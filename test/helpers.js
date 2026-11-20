/** Starts the real server on a free port with an in-memory database and a fake mail sender (SMTP_HOST=test). */
const { createAdapter } = require('../src/db');
const { createApp } = require('../src/app');

const SECRET = 'x'.repeat(40);
const INBOUND = 'inbound-secret-for-tests-123';
const SMTP = { host: 'test', port: 587, secure: false, user: 'me@example.com', pass: 'app-password', from: 'me@example.com', fromName: 'Me' };

async function start(envExtra = {}) {
  const db = createAdapter({ DB_TYPE: 'memory' });
  await db.init();
  const env = { INBOUND_SECRET: INBOUND, ...envExtra };
  const made = createApp({ db, env, secret: SECRET, setupCode: 'code1234', log: { warn() {}, error() {} } });
  const server = await new Promise(r => { const s = made.app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  let csrf = '';
  /** headers.cookie, when given, replaces the stored cookie for this one call (to try an old cookie). */
  async function call(path, { method = 'GET', body, headers = {}, raw } = {}) {
    const h = { 'x-pkj': '1', ...headers };
    if (cookie && !headers.cookie) h.cookie = cookie;
    if (csrf) h['x-csrf-token'] = csrf;
    if (body !== undefined && raw === undefined) h['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers: h, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set && !headers.cookie) cookie = set.split(';')[0];
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, json };
  }
  return {
    call, db,
    cookie: () => cookie,
    setCsrf: v => { csrf = v; },
    clearCookie: () => { cookie = ''; csrf = ''; },
    stop: () => { made.stop(); server.close(); }
  };
}

/** A server that is set up, with a signed-in admin. */
async function signedIn(envExtra) {
  const s = await start(envExtra);
  await s.call('/setup/finish', { method: 'POST', body: { code: 'code1234', admin: { email: 'me@example.com', password: 'a-long-password' }, smtp: SMTP } });
  const r = await s.call('/login', { method: 'POST', body: { email: 'me@example.com', password: 'a-long-password' } });
  s.setCsrf(r.json.csrf);
  return s;
}

module.exports = { start, signedIn, SECRET, INBOUND, SMTP };
