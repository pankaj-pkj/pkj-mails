/**
 * Shared pieces every storage adapter uses: the message shape, the search parser and an in-JS matcher
 * (used by the memory and Firebase adapters; the SQL and MongoDB adapters turn the same query into their own language).
 */
const crypto = require('crypto');

const FOLDERS = ['inbox', 'sent', 'drafts', 'spam', 'trash', 'archive'];
const LABEL_RE = /^[\p{L}\p{N} _-]{1,40}$/u;
const ID_RE = /^[a-z0-9]{6,40}$/;
const HIDDEN = ['trash', 'spam']; // views like Starred, a label or All Mail leave these out

/** Time-ordered id, safe as a key in every database. */
function newId(dateMs = Date.now()) {
  return Math.max(0, Math.floor(dateMs)).toString(36).padStart(9, '0') + crypto.randomBytes(5).toString('hex');
}
const isId = v => typeof v === 'string' && ID_RE.test(v);

/** The small row a list shows (no body, no attachment bytes). */
function summary(m) {
  return {
    id: m.id,
    threadId: m.threadId || m.id,
    folder: m.folder,
    from: m.from || '',
    fromName: m.fromName || '',
    to: Array.isArray(m.to) ? m.to : [],
    subject: m.subject || '',
    snippet: m.snippet || '',
    date: Number(m.date) || 0,
    read: Boolean(m.read),
    starred: Boolean(m.starred),
    labels: Array.isArray(m.labels) ? m.labels : [],
    hasAttachments: Boolean(m.hasAttachments || (m.attachments && m.attachments.length))
  };
}

/**
 * "from:ana is:unread invoice" -> { text: ['invoice'], from: 'ana', unread: true }
 * Supported: from: to: subject: label: in: is:unread is:read is:starred has:attachment, and plain words.
 */
function parseSearch(q) {
  const out = { text: [] };
  const re = /(\w+):("[^"]*"|\S+)|"([^"]+)"|(\S+)/g;
  let m;
  const s = String(q || '').slice(0, 200);
  while ((m = re.exec(s))) {
    if (m[1]) {
      const key = m[1].toLowerCase();
      const val = m[2].replace(/^"|"$/g, '').toLowerCase();
      if (key === 'from' || key === 'to' || key === 'subject' || key === 'label') out[key] = val;
      else if (key === 'in' && FOLDERS.includes(val)) out.in = val;
      else if (key === 'is' && val === 'unread') out.unread = true;
      else if (key === 'is' && val === 'read') out.unread = false;
      else if (key === 'is' && val === 'starred') out.starred = true;
      else if (key === 'has' && /^attach/.test(val)) out.hasAttachment = true;
      else out.text.push(m[0].toLowerCase());
    } else {
      out.text.push((m[3] || m[4]).toLowerCase());
    }
  }
  return out;
}

/**
 * The list query: { folder, starred, all, label, thread, q, limit, offset }.
 * Starred, a label, All Mail and a search look everywhere except spam and trash (unless "in:spam" etc.).
 * A thread looks in every folder.
 */
function normalizeQuery(opts = {}) {
  const search = opts.q ? parseSearch(opts.q) : null;
  let folder = FOLDERS.includes(opts.folder) ? opts.folder : null;
  if (opts.starred || opts.label || opts.all) folder = null;
  if (search && search.in) folder = search.in;
  else if (search && !opts.folder) folder = null;
  if (!folder && !opts.starred && !opts.label && !opts.all && !search && !opts.thread) folder = 'inbox';
  return {
    folder,
    anyFolder: Boolean(opts.thread),
    thread: opts.thread ? String(opts.thread) : null,
    starred: Boolean(opts.starred),
    label: opts.label ? String(opts.label) : null,
    search,
    limit: Math.min(1000, Math.max(1, Number(opts.limit) || 50)),
    offset: Math.max(0, Number(opts.offset) || 0)
  };
}

const lc = v => String(v || '').toLowerCase();

function matches(m, nq) {
  if (nq.thread && (m.threadId || m.id) !== nq.thread) return false;
  if (nq.folder) { if (m.folder !== nq.folder) return false; }
  else if (!nq.anyFolder && HIDDEN.includes(m.folder)) return false;
  if (nq.starred && !m.starred) return false;
  if (nq.label && !(m.labels || []).includes(nq.label)) return false;
  const s = nq.search;
  if (s) {
    if (s.from && !(lc(m.from).includes(s.from) || lc(m.fromName).includes(s.from))) return false;
    if (s.to && !lc((m.to || []).join(' ')).includes(s.to)) return false;
    if (s.subject && !lc(m.subject).includes(s.subject)) return false;
    if (s.label && !(m.labels || []).some(l => lc(l) === s.label)) return false;
    if (s.unread === true && m.read) return false;
    if (s.unread === false && !m.read) return false;
    if (s.starred && !m.starred) return false;
    if (s.hasAttachment && !summary(m).hasAttachments) return false;
    const hay = lc([m.from, m.fromName, (m.to || []).join(' '), m.subject, m.snippet].join(' '));
    for (const w of s.text) if (!hay.includes(w)) return false;
  }
  return true;
}

function emptyCounts() {
  const c = {};
  for (const f of FOLDERS) c[f] = { total: 0, unread: 0 };
  c.starred = { total: 0, unread: 0 };
  return c;
}
function addToCounts(c, m) {
  if (!c[m.folder]) return;
  c[m.folder].total++;
  if (!m.read) c[m.folder].unread++;
  if (m.starred && !HIDDEN.includes(m.folder)) {
    c.starred.total++;
    if (!m.read) c.starred.unread++;
  }
}

/** Fields a PATCH may change. */
function cleanPatch(p = {}) {
  const out = {};
  if (p.read !== undefined) out.read = Boolean(p.read);
  if (p.starred !== undefined) out.starred = Boolean(p.starred);
  if (p.folder !== undefined && FOLDERS.includes(p.folder)) out.folder = p.folder;
  if (Array.isArray(p.labels)) out.labels = [...new Set(p.labels.map(String).filter(l => LABEL_RE.test(l)))].slice(0, 20);
  return out;
}

/** Folds a newest-first list of mails into conversations (newest conversation first). */
function groupThreads(items) {
  const map = new Map();
  for (const m of items) {
    const key = m.threadId || m.id;
    let t = map.get(key);
    if (!t) {
      t = { ...m, ids: [], count: 0, read: true, starred: false, hasAttachments: false, names: [], labels: [] };
      map.set(key, t);
    }
    t.ids.push(m.id);
    t.count++;
    if (!m.read) t.read = false;
    if (m.starred) t.starred = true;
    if (m.hasAttachments) t.hasAttachments = true;
    for (const l of m.labels || []) if (!t.labels.includes(l)) t.labels.push(l);
    const name = m.folder === 'sent' || m.folder === 'drafts' ? 'me' : (m.fromName || m.from || '').split(' ')[0];
    if (name && !t.names.includes(name)) t.names.push(name);
  }
  return [...map.values()];
}

module.exports = { FOLDERS, HIDDEN, LABEL_RE, ID_RE, isId, newId, summary, parseSearch, normalizeQuery, matches, emptyCounts, addToCounts, cleanPatch, groupThreads };
