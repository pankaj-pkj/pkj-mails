/**
 * Firebase Realtime Database through its REST API (no package needed).
 *
 *   <root>/index/<id>   the small list row of each mail (kept in memory after the first read, so lists are fast)
 *   <root>/body/<id>    the rest of the mail, read only when it is opened
 *   <root>/kv/<key>     settings and sessions
 */
const { summary, normalizeQuery, matches, emptyCounts, addToCounts } = require('./query');

const INDEX_KEYS = ['threadId', 'folder', 'from', 'fromName', 'to', 'subject', 'snippet', 'date', 'read', 'starred', 'labels', 'hasAttachments', 'messageId', 'trashedAt'];
// Firebase keys cannot hold . $ # [ ] /
const keyOf = k => encodeURIComponent(String(k)).replace(/\./g, '%2E');

function createFirebaseAdapter({ url, secret, root = 'pkjmails' }) {
  if (!/^https:\/\/[^/]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/.test(String(url || ''))) {
    throw new Error('FIREBASE_DB_URL must look like https://your-project-default-rtdb.firebaseio.com');
  }
  const base = String(url).replace(/\/$/, '');
  const auth = secret ? `?auth=${encodeURIComponent(secret)}` : '';
  let index = null;

  async function call(method, path, value) {
    const res = await fetch(`${base}/${root}/${path}.json${auth}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error(`Firebase ${method} ${path.split('/')[0]} failed (${res.status}). Check FIREBASE_DB_URL, FIREBASE_DB_SECRET and the database rules.`);
    return res.json();
  }
  const split = m => {
    const row = {};
    const body = {};
    for (const [k, v] of Object.entries(m)) {
      if (k === 'id') continue;
      (INDEX_KEYS.includes(k) ? row : body)[k] = v;
    }
    row.hasAttachments = Boolean((m.attachments && m.attachments.length) || m.hasAttachments);
    return { row, body };
  };
  async function loadIndex() {
    if (!index) {
      const all = (await call('GET', 'index')) || {};
      index = new Map(Object.entries(all).map(([id, r]) => [id, { id, ...r, to: r.to || [], labels: r.labels || [] }]));
    }
    return index;
  }

  return {
    name: 'firebase',
    async init() { await loadIndex(); },
    async close() {},
    async kvGet(k) { return call('GET', `kv/${keyOf(k)}`); },
    async kvSet(k, v) { await call('PUT', `kv/${keyOf(k)}`, v); },
    async kvDel(k) { await call('DELETE', `kv/${keyOf(k)}`); },
    async insert(msg) {
      await loadIndex();
      const { row, body } = split(msg);
      await call('PUT', `body/${msg.id}`, body);
      await call('PUT', `index/${msg.id}`, row);
      index.set(msg.id, { id: msg.id, ...row });
      return msg;
    },
    async get(id) {
      await loadIndex();
      const row = index.get(id);
      if (!row) return null;
      const body = (await call('GET', `body/${id}`)) || {};
      return { ...row, ...body, id, threadId: row.threadId || id };
    },
    async update(id, patch) {
      await loadIndex();
      const cur = await this.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch, id };
      const { row, body } = split(next);
      await call('PUT', `index/${id}`, row);
      if (Object.keys(patch).some(k => !INDEX_KEYS.includes(k))) await call('PUT', `body/${id}`, body);
      index.set(id, { id, ...row });
      return next;
    },
    async remove(id) {
      await loadIndex();
      index.delete(id);
      await Promise.all([call('DELETE', `index/${id}`), call('DELETE', `body/${id}`)]);
      return true;
    },
    async list(opts) {
      const nq = normalizeQuery(opts);
      const all = [...(await loadIndex()).values()].filter(m => matches(m, nq)).sort((a, b) => b.date - a.date);
      return { total: all.length, items: all.slice(nq.offset, nq.offset + nq.limit).map(summary) };
    },
    async counts() {
      const c = emptyCounts();
      for (const m of (await loadIndex()).values()) addToCounts(c, m);
      return c;
    },
    async findByMessageId(mid) {
      if (!mid) return null;
      for (const m of (await loadIndex()).values()) if (m.messageId === mid) return this.get(m.id);
      return null;
    },
    async idsInFolderOlderThan(folder, ms) {
      return [...(await loadIndex()).values()].filter(m => m.folder === folder && (m.trashedAt || m.date) < ms).map(m => m.id);
    }
  };
}

module.exports = { createFirebaseAdapter };
