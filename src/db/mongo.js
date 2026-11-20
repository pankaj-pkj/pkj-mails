/** MongoDB (Atlas free tier works). Collections: pkj_messages (one document per mail) and pkj_kv. */
const { summary, normalizeQuery, emptyCounts } = require('./query');
const { needPackage } = require('./sql');

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = s => ({ $regex: esc(s), $options: 'i' });

function filterFor(nq) {
  const f = {};
  const and = [];
  if (nq.folder) f.folder = nq.folder; else f.folder = { $nin: ['trash', 'spam'] };
  if (nq.starred) f.starred = true;
  if (nq.label) f.labels = nq.label;
  const s = nq.search;
  if (s) {
    if (s.from) and.push({ $or: [{ from: has(s.from) }, { fromName: has(s.from) }] });
    if (s.to) and.push({ to: has(s.to) });
    if (s.subject) and.push({ subject: has(s.subject) });
    if (s.label) and.push({ labels: { $regex: `^${esc(s.label)}$`, $options: 'i' } });
    if (s.unread === true) and.push({ read: false });
    if (s.unread === false) and.push({ read: true });
    if (s.starred) and.push({ starred: true });
    if (s.hasAttachment) and.push({ hasAttachments: true });
    for (const t of s.text) and.push({ $or: ['from', 'fromName', 'to', 'subject', 'snippet'].map(k => ({ [k]: has(t) })) });
  }
  if (and.length) f.$and = and;
  return f;
}

const out = d => { if (!d) return null; const { _id, ...rest } = d; return { id: _id, ...rest }; };
const LIST_PROJ = { text: 0, html: 0, attachments: 0, cc: 0, bcc: 0 };

function createMongoAdapter(url) {
  const { MongoClient } = needPackage('mongodb', 'mongodb');
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 10000 });
  let msgs;
  let kv;
  return {
    name: 'mongodb',
    async init() {
      await client.connect();
      const db = client.db(); // the database named in the link (or "test")
      msgs = db.collection('pkj_messages');
      kv = db.collection('pkj_kv');
      await msgs.createIndex({ folder: 1, date: -1 });
      await msgs.createIndex({ messageId: 1 });
    },
    async close() { await client.close(); },
    async kvGet(k) { const d = await kv.findOne({ _id: k }); return d ? d.v : null; },
    async kvSet(k, v) { await kv.updateOne({ _id: k }, { $set: { v } }, { upsert: true }); },
    async kvDel(k) { await kv.deleteOne({ _id: k }); },
    async insert(msg) {
      const { id, ...rest } = msg;
      await msgs.insertOne({ _id: id, ...rest, hasAttachments: Boolean(msg.attachments && msg.attachments.length) || Boolean(msg.hasAttachments) });
      return msg;
    },
    async get(id) { return out(await msgs.findOne({ _id: id })); },
    async update(id, patch) {
      const { id: _drop, ...p } = patch;
      const r = await msgs.findOneAndUpdate({ _id: id }, { $set: p }, { returnDocument: 'after' });
      return out(r && r.value !== undefined && r.ok !== undefined ? r.value : r);
    },
    async remove(id) { await msgs.deleteOne({ _id: id }); return true; },
    async list(opts) {
      const nq = normalizeQuery(opts);
      const f = filterFor(nq);
      const [total, docs] = await Promise.all([
        msgs.countDocuments(f),
        msgs.find(f, { projection: LIST_PROJ }).sort({ date: -1 }).skip(nq.offset).limit(nq.limit).toArray()
      ]);
      return { total, items: docs.map(d => summary(out(d))) };
    },
    async counts() {
      const c = emptyCounts();
      const rows = await msgs.aggregate([{ $group: { _id: '$folder', n: { $sum: 1 }, u: { $sum: { $cond: ['$read', 0, 1] } } } }]).toArray();
      for (const r of rows) if (c[r._id]) c[r._id] = { total: r.n, unread: r.u };
      const st = await msgs.aggregate([{ $match: { starred: true, folder: { $nin: ['trash', 'spam'] } } }, { $group: { _id: null, n: { $sum: 1 }, u: { $sum: { $cond: ['$read', 0, 1] } } } }]).toArray();
      if (st[0]) c.starred = { total: st[0].n, unread: st[0].u };
      return c;
    },
    async findByMessageId(mid) { return mid ? out(await msgs.findOne({ messageId: mid })) : null; },
    async idsInFolderOlderThan(folder, ms) {
      const docs = await msgs.find({ folder, $or: [{ trashedAt: { $lt: ms } }, { trashedAt: { $exists: false }, date: { $lt: ms } }] }, { projection: { _id: 1 } }).toArray();
      return docs.map(d => d._id);
    }
  };
}

module.exports = { createMongoAdapter };
