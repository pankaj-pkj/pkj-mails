/**
 * Starts PKJ Mails:  npm start
 * Reads .env, opens the database, prints the setup code on the first run.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Hide Node's "SQLite is experimental" note: it is only noise for people running the app.
const emit = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : emit.call(process, w, ...rest));

loadDotEnv(path.join(__dirname, '..', '.env'));

const { createAdapter } = require('./db');
const { createApp } = require('./app');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

/** No APP_SECRET? Make one and keep it in data/secret.key so logins survive a restart. */
function appSecret() {
  if (process.env.APP_SECRET && process.env.APP_SECRET.length >= 32) return process.env.APP_SECRET;
  if (process.env.APP_SECRET) console.warn('! APP_SECRET is shorter than 32 characters, so a generated one is used instead.');
  const file = path.join(__dirname, '..', 'data', 'secret.key');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, s, { mode: 0o600 });
  console.warn('! No APP_SECRET in .env, so one was made and saved in data/secret.key. On hosting sites, set APP_SECRET instead.');
  return s;
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    console.error(`PKJ Mails needs Node.js 22 or newer. You have ${process.versions.node}. Download the LTS version from https://nodejs.org`);
    process.exit(1);
  }
  let db;
  try {
    db = createAdapter(process.env);
    await db.init();
  } catch (err) {
    console.error('\nCould not open the database (' + (process.env.DB_TYPE || 'sqlite') + '):\n  ' + err.message + '\n');
    console.error('Check DB_TYPE and DATABASE_URL in your .env file. See docs/TROUBLESHOOTING.md\n');
    process.exit(1);
  }
  const { app, setupCode, startBackground } = createApp({ db, env: process.env, secret: appSecret() });
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, async () => {
    console.log('\n  PKJ Mails is running');
    console.log(`  Open:     http://localhost:${port}`);
    console.log(`  Database: ${db.name}`);
    const done = (await db.kvGet('setup').catch(() => null)) || null;
    if (!(done && done.done) && !(process.env.ADMIN_EMAIL && process.env.SMTP_HOST)) {
      console.log(`\n  Setup code: ${setupCode}   (the setup page asks for it)\n`);
    }
    startBackground();
  });
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Close the other app or set PORT=3001 in .env.`);
    else console.error(err);
    process.exit(1);
  });
  const shutdown = () => server.close(() => db.close().finally(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
