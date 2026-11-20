/** Keeps everything in memory. Used by the tests; everything is lost when the app stops. */
const { summary, normalizeQuery, matches, emptyCounts, addToCounts } = require('./query');

const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function createMemoryAdapter() {
  const messages = new Map();
  const kv = new Map();
  return {
    name: 'memory',
    async init() {},
    async close() {},
    async kvGet(k) { return kv.has(k) ? clone(kv.get(k)) : null; },
    async kvSet(k, v) { kv.set(k, clone(v)); },
    async kvDel(k) { kv.delete(k); },
    async insert(msg) { messages.set(msg.id, clone(msg)); return clone(msg); },
    async get(id) { return messages.has(id) ? clone(messages.get(id)) : null; },
    async update(id, patch) {
      if (!messages.has(id)) return null;
      const next = { ...messages.get(id), ...clone(patch) };
      messages.set(id, next);
      return clone(next);
    },
    async remove(id) { return messages.delete(id); },
    async list(opts) {
      const nq = normalizeQuery(opts);
      const all = [...messages.values()].filter(m => matches(m, nq)).sort((a, b) => b.date - a.date);
      return { total: all.length, items: all.slice(nq.offset, nq.offset + nq.limit).map(summary) };
    },
    async counts() {
      const c = emptyCounts();
      for (const m of messages.values()) addToCounts(c, m);
      return c;
    },
    async findByMessageId(mid) {
      for (const m of messages.values()) if (m.messageId && m.messageId === mid) return clone(m);
      return null;
    },
    async idsInFolderOlderThan(folder, ms) {
      return [...messages.values()].filter(m => m.folder === folder && (m.trashedAt || m.date) < ms).map(m => m.id);
    }
  };
}

module.exports = { createMemoryAdapter };
