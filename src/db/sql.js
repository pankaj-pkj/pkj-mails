/**
 * One adapter for SQLite, PostgreSQL and MySQL. Each database only differs in a few words of SQL,
 * so a tiny "driver" gives the differences and everything else is shared.
 *
 * Table messages: the columns a list needs are real columns (fast to filter and sort);
 * the rest of the message (body, attachments, cc...) is one JSON text column.
 */
const { summary, normalizeQuery, emptyCounts } = require('./query');

const LIST_COLS = 'id, folder, from_addr, from_name, to_addrs, subject, snippet, date_ms, is_read, starred, labels, has_att';
const BODY_KEYS = ['cc', 'bcc', 'replyTo', 'text', 'html', 'attachments', 'inReplyTo', 'references', 'prevFolder', 'trashedAt'];

function toRow(m) {
  const body = {};
  for (const k of BODY_KEYS) if (m[k] !== undefined) body[k] = m[k];
  return {
    id: m.id,
    folder: m.folder,
    from_addr: m.from || '',
    from_name: m.fromName || '',
    to_addrs: (m.to || []).join(', '),
    subject: m.subject || '',
    snippet: m.snippet || '',
    date_ms: Number(m.date) || 0,
    is_read: m.read ? 1 : 0,
    starred: m.starred ? 1 : 0,
    labels: ',' + (m.labels || []).join(',') + ',',
    has_att: (m.attachments && m.attachments.length) || m.hasAttachments ? 1 : 0,
    message_id: m.messageId || '',
    body: JSON.stringify(body)
  };
}
function fromRow(r) {
  if (!r) return null;
  let body = {};
  try { body = r.body ? JSON.parse(r.body) : {}; } catch (_) {}
  return {
    id: r.id,
    folder: r.folder,
    from: r.from_addr,
    fromName: r.from_name,
    to: r.to_addrs ? String(r.to_addrs).split(', ').filter(Boolean) : [],
    subject: r.subject,
    snippet: r.snippet,
    date: Number(r.date_ms),
    read: Boolean(Number(r.is_read)),
    starred: Boolean(Number(r.starred)),
    labels: String(r.labels || '').split(',').filter(Boolean),
    hasAttachments: Boolean(Number(r.has_att)),
    messageId: r.message_id || '',
    ...body
  };
}

function whereFor(nq) {
  const w = [];
  const p = [];
  if (nq.folder) { w.push('folder = ?'); p.push(nq.folder); }
  else w.push("folder NOT IN ('trash', 'spam')");
  if (nq.starred) w.push('starred = 1');
  if (nq.label) { w.push('labels LIKE ?'); p.push('%,' + nq.label + ',%'); }
  const s = nq.search;
  if (s) {
    if (s.from) { w.push('(LOWER(from_addr) LIKE ? OR LOWER(from_name) LIKE ?)'); p.push(`%${s.from}%`, `%${s.from}%`); }
    if (s.to) { w.push('LOWER(to_addrs) LIKE ?'); p.push(`%${s.to}%`); }
    if (s.subject) { w.push('LOWER(subject) LIKE ?'); p.push(`%${s.subject}%`); }
    if (s.label) { w.push('LOWER(labels) LIKE ?'); p.push(`%,${s.label},%`); }
    if (s.unread === true) w.push('is_read = 0');
    if (s.unread === false) w.push('is_read = 1');
    if (s.starred) w.push('starred = 1');
    if (s.hasAttachment) w.push('has_att = 1');
    for (const t of s.text) {
      w.push('(LOWER(from_addr) LIKE ? OR LOWER(from_name) LIKE ? OR LOWER(to_addrs) LIKE ? OR LOWER(subject) LIKE ? OR LOWER(snippet) LIKE ?)');
      p.push(`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`);
    }
  }
  return { sql: w.length ? 'WHERE ' + w.join(' AND ') : '', params: p };
}

/**
 * driver = { name, schema: [sql...], upsertKv: sql, run(sql, params), all(sql, params), close() }
 * Every sql uses "?" placeholders; the Postgres driver turns them into $1, $2...
 */
function createSqlAdapter(driver) {
  const one = async (sql, params) => (await driver.all(sql, params))[0] || null;
  return {
    name: driver.name,
    async init() { for (const s of driver.schema) await driver.run(s, []); },
    async close() { await driver.close(); },
    async kvGet(k) {
      const r = await one('SELECT v FROM pkj_kv WHERE k = ?', [k]);
      if (!r) return null;
      try { return JSON.parse(r.v); } catch (_) { return null; }
    },
    async kvSet(k, v) { await driver.run(driver.upsertKv, [k, JSON.stringify(v)]); },
    async kvDel(k) { await driver.run('DELETE FROM pkj_kv WHERE k = ?', [k]); },
    async insert(msg) {
      const r = toRow(msg);
      const cols = Object.keys(r);
      await driver.run(`INSERT INTO pkj_messages (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(c => r[c]));
      return msg;
    },
    async get(id) { return fromRow(await one('SELECT * FROM pkj_messages WHERE id = ?', [id])); },
    async update(id, patch) {
      const cur = await this.get(id);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      const r = toRow(next);
      const cols = Object.keys(r).filter(c => c !== 'id');
      await driver.run(`UPDATE pkj_messages SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`, [...cols.map(c => r[c]), id]);
      return next;
    },
    async remove(id) { await driver.run('DELETE FROM pkj_messages WHERE id = ?', [id]); return true; },
    async list(opts) {
      const nq = normalizeQuery(opts);
      const { sql, params } = whereFor(nq);
      const total = Number((await one(`SELECT COUNT(*) AS n FROM pkj_messages ${sql}`, params)).n);
      const rows = await driver.all(`SELECT ${LIST_COLS} FROM pkj_messages ${sql} ORDER BY date_ms DESC LIMIT ${nq.limit} OFFSET ${nq.offset}`, params);
      return { total, items: rows.map(r => summary(fromRow(r))) };
    },
    async counts() {
      const c = emptyCounts();
      const rows = await driver.all('SELECT folder, COUNT(*) AS n, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS u FROM pkj_messages GROUP BY folder', []);
      for (const r of rows) if (c[r.folder]) c[r.folder] = { total: Number(r.n), unread: Number(r.u) || 0 };
      const st = await one("SELECT COUNT(*) AS n, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS u FROM pkj_messages WHERE starred = 1 AND folder NOT IN ('trash', 'spam')", []);
      c.starred = { total: Number(st.n) || 0, unread: Number(st.u) || 0 };
      return c;
    },
    async findByMessageId(mid) {
      if (!mid) return null;
      return fromRow(await one('SELECT * FROM pkj_messages WHERE message_id = ?', [mid]));
    },
    async idsInFolderOlderThan(folder, ms) {
      const rows = await driver.all('SELECT id, body, date_ms FROM pkj_messages WHERE folder = ?', [folder]);
      return rows.map(fromRow).filter(m => (m.trashedAt || m.date) < ms).map(m => m.id);
    }
  };
}

const commonSchema = (text, key, big) => [
  `CREATE TABLE IF NOT EXISTS pkj_kv (k ${key} PRIMARY KEY, v ${big})`,
  `CREATE TABLE IF NOT EXISTS pkj_messages (
    id ${key} PRIMARY KEY, folder VARCHAR(16) NOT NULL, from_addr ${text}, from_name ${text}, to_addrs ${text},
    subject ${text}, snippet ${text}, date_ms BIGINT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0,
    starred INTEGER NOT NULL DEFAULT 0, labels ${text}, has_att INTEGER NOT NULL DEFAULT 0,
    message_id VARCHAR(255), body ${big})`
];

function sqliteDriver(file) {
  const fs = require('fs');
  const path = require('path');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  // node:sqlite ships with Node 22.5+, so SQLite needs nothing to install
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  return {
    name: 'sqlite',
    schema: [...commonSchema('TEXT', 'TEXT', 'TEXT'),
      'CREATE INDEX IF NOT EXISTS pkj_msg_folder_date ON pkj_messages (folder, date_ms)',
      'CREATE INDEX IF NOT EXISTS pkj_msg_mid ON pkj_messages (message_id)'],
    upsertKv: 'INSERT INTO pkj_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v',
    async run(sql, params) { db.prepare(sql).run(...params); },
    async all(sql, params) { return db.prepare(sql).all(...params); },
    async close() { db.close(); }
  };
}

function postgresDriver(url) {
  const { Pool } = needPackage('pg', 'postgres');
  const pool = new Pool({ connectionString: url, ssl: /sslmode=require|neon\.tech|supabase|render\.com/.test(url) ? { rejectUnauthorized: false } : undefined, max: 5 });
  const conv = sql => { let n = 0; return sql.replace(/\?/g, () => '$' + ++n); };
  return {
    name: 'postgres',
    schema: [...commonSchema('TEXT', 'VARCHAR(191)', 'TEXT'),
      'CREATE INDEX IF NOT EXISTS pkj_msg_folder_date ON pkj_messages (folder, date_ms)',
      'CREATE INDEX IF NOT EXISTS pkj_msg_mid ON pkj_messages (message_id)'],
    upsertKv: 'INSERT INTO pkj_kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v',
    async run(sql, params) { await pool.query(conv(sql), params); },
    async all(sql, params) { return (await pool.query(conv(sql), params)).rows; },
    async close() { await pool.end(); }
  };
}

function mysqlDriver(url) {
  const mysql = needPackage('mysql2/promise', 'mysql');
  const pool = mysql.createPool({ uri: url, connectionLimit: 5, charset: 'utf8mb4' });
  return {
    name: 'mysql',
    // MySQL cannot index TEXT without a length and cannot "CREATE INDEX IF NOT EXISTS", so the index is inline
    schema: [
      'CREATE TABLE IF NOT EXISTS pkj_kv (k VARCHAR(191) PRIMARY KEY, v LONGTEXT) CHARACTER SET utf8mb4',
      `CREATE TABLE IF NOT EXISTS pkj_messages (
        id VARCHAR(191) PRIMARY KEY, folder VARCHAR(16) NOT NULL, from_addr TEXT, from_name TEXT, to_addrs TEXT,
        subject TEXT, snippet TEXT, date_ms BIGINT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0,
        starred INTEGER NOT NULL DEFAULT 0, labels TEXT, has_att INTEGER NOT NULL DEFAULT 0,
        message_id VARCHAR(255), body LONGTEXT,
        INDEX pkj_msg_folder_date (folder, date_ms), INDEX pkj_msg_mid (message_id)) CHARACTER SET utf8mb4`
    ],
    upsertKv: 'INSERT INTO pkj_kv (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
    async run(sql, params) { await pool.query(sql, params); },
    async all(sql, params) { return (await pool.query(sql, params))[0]; },
    async close() { await pool.end(); }
  };
}

function needPackage(name, dbType) {
  try { return require(name); } catch (_) {
    throw new Error(`DB_TYPE=${dbType} needs the "${name.split('/')[0]}" package. Run:  npm install ${name.split('/')[0]}`);
  }
}

module.exports = { createSqlAdapter, sqliteDriver, postgresDriver, mysqlDriver, needPackage, toRow, fromRow };
