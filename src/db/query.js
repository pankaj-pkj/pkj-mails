/**
 * Shared pieces every storage adapter uses: the message shape, the search parser and an in-JS matcher
 * (used by the memory and Firebase adapters; the SQL and MongoDB adapters turn the same query into their own language).
 */
const crypto = require('crypto');

const FOLDERS = ['inbox', 'sent', 'drafts', 'spam', 'trash'];
const LABEL_RE = /^[\p{L}\p{N} _-]{1,40}$/u;

/** Time-ordered id, safe as a key in every database. */
function newId(dateMs = Date.now()) {
  return Math.max(0, Math.floor(dateMs)).toString(36).padStart(9, '0') + crypto.randomBytes(5).toString('hex');
}

/** The small row a list shows (no body, no attachment bytes). */
function summary(m) {
  return {
    id: m.id,
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
 * Supported: from: to: subject: label: is:unread is:read is:starred has:attachment, and plain words.
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
 * The list query: { folder, starred, label, q, limit, offset }.
 * folder "starred" or a label means "anywhere except spam and trash".
 */
function normalizeQuery(opts = {}) {
  const folder = FOLDERS.includes(opts.folder) ? opts.folder : null;
  return {
    folder: opts.starred || opts.label ? null : folder || (opts.q ? null : 'inbox'),
    starred: Boolean(opts.starred),
    label: opts.label ? String(opts.label) : null,
    search: opts.q ? parseSearch(opts.q) : null,
    limit: Math.min(200, Math.max(1, Number(opts.limit) || 50)),
    offset: Math.max(0, Number(opts.offset) || 0)
  };
}

const lc = v => String(v || '').toLowerCase();

function matches(m, nq) {
  if (nq.folder) { if (m.folder !== nq.folder) return false; }
  else if (m.folder === 'trash' || m.folder === 'spam') {
    // a search with no folder looks everywhere except the bin and spam
    return false;
  }
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
  if (m.starred && m.folder !== 'trash' && m.folder !== 'spam') {
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
  if (p.prevFolder !== undefined) out.prevFolder = p.prevFolder;
  if (p.trashedAt !== undefined) out.trashedAt = p.trashedAt;
  return out;
}

module.exports = { FOLDERS, LABEL_RE, newId, summary, parseSearch, normalizeQuery, matches, emptyCounts, addToCounts, cleanPatch };
