/**
 * Picks the storage adapter from DB_TYPE. Every adapter has the same methods:
 *
 *   init() close()
 *   kvGet(key) kvSet(key, value) kvDel(key)          settings and sessions
 *   insert(msg) get(id) update(id, patch) remove(id)  mails
 *   list({ folder, starred, label, q, limit, offset }) -> { total, items }
 *   counts() -> { inbox: { total, unread }, ... }
 *   findByMessageId(id) idsInFolderOlderThan(folder, ms)
 *
 * To add a new database, copy memory.js and fill in the same methods.
 */
const { createMemoryAdapter } = require('./memory');
const { createSqlAdapter, sqliteDriver, postgresDriver, mysqlDriver } = require('./sql');

function createAdapter(env = process.env) {
  const type = String(env.DB_TYPE || 'sqlite').trim().toLowerCase();
  const url = String(env.DATABASE_URL || '').trim();
  const needUrl = () => { if (!url) throw new Error(`DB_TYPE=${type} needs DATABASE_URL in your .env file.`); };
  switch (type) {
    case 'sqlite':
      return createSqlAdapter(sqliteDriver(env.SQLITE_FILE || './data/pkj-mails.db'));
    case 'postgres': case 'postgresql': case 'pg':
      needUrl(); return createSqlAdapter(postgresDriver(url));
    case 'mysql': case 'mariadb':
      needUrl(); return createSqlAdapter(mysqlDriver(url));
    case 'mongodb': case 'mongo':
      needUrl(); return require('./mongo').createMongoAdapter(url);
    case 'firebase':
      return require('./firebase').createFirebaseAdapter({ url: env.FIREBASE_DB_URL, secret: env.FIREBASE_DB_SECRET });
    case 'memory':
      return createMemoryAdapter();
    default:
      throw new Error(`DB_TYPE "${type}" is not known. Use one of: sqlite, mongodb, postgres, mysql, firebase.`);
  }
}

module.exports = { createAdapter };
