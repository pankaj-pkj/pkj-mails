/**
 * The PKJ Mails web server: the API under /api and the inbox page from /public.
 * createApp() takes a ready database adapter, so the tests can run it with any database.
 *
 * Security model in short (the code is public, so nothing here relies on being secret except the values in .env):
 *   - one admin login; password hashed with scrypt (or kept only in .env)
 *   - session = random 256-bit id in an HttpOnly SameSite=Strict cookie; only its hash is stored; it ends when the
 *     password changes or on "sign out everywhere"
 *   - every change needs the x-pkj header AND the session's CSRF token; a matching Origin when the browser sends one
 *   - sign-in and setup-code guesses are limited per IP and for everybody together (fake IPs do not help)
 *   - mail HTML is cleaned on the server and shown in a sandboxed frame without scripts; remote images are blocked
 *     until you allow them; attachments are always downloads
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const sec = require('./security');
const { parseMail, parseAddressList } = require('./mail/mimeParse');
const { sanitizeMailHtml, makeSnippet, textToHtml } = require('./mail/sanitize');
const { loadSettings, saveSettings, publicSettings } = require('./mail/settings');
const { makeTransport, testSmtp, testImap, fetchNewImap, friendlyError } = require('./mail/transport');
const { FOLDERS, LABEL_RE, isId, newId, cleanPatch, groupThreads } = require('./db/query');

const EMAIL_RE = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/;
const MAX_RECIPIENTS = 50;
const KEEP_ATTACH_BYTES = 8 * 1024 * 1024;
const INLINE_IMAGE_BYTES = 600 * 1024;
const TRASH_DAYS = 30;
const PAGE = 50;
const LABEL_COLORS = ['#1a73e8', '#188038', '#e37400', '#d93025', '#9334e6', '#007b83', '#b06000', '#c5221f'];
const BLOCKED_FILES = /\.(exe|bat|cmd|com|scr|pif|vbs|vbe|js|jse|wsf|wsh|msi|msp|jar|ps1|psm1|hta|cpl|lnk|reg|dll|iso|img|vhd)$/i;
const LOGO_TYPES = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/gif': [0x47, 0x49, 0x46], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
const DEFAULT_NAME = 'PKJ Mails';

function createApp({ db, env = process.env, secret, log = console, setupCode } = {}) {
  if (!secret || String(secret).length < 32) throw new Error('APP_SECRET must be at least 32 characters.');
  const app = express();
  const envCode = String(env.SETUP_CODE || '').trim();
  if (envCode && envCode.length < 8) log.warn('! SETUP_CODE is shorter than 8 characters, so a random code is used instead.');
  const code = envCode.length >= 8 ? envCode : String(setupCode || crypto.randomBytes(6).toString('hex'));
  const settings = () => loadSettings(db, env, secret);

  if (/^(1|true)$/i.test(String(env.TRUST_PROXY || ''))) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(sec.securityHeaders);

  // ------------------------------------------------------------ admin, sessions
  const envAdmin = () => (env.ADMIN_EMAIL && env.ADMIN_PASSWORD ? { email: String(env.ADMIN_EMAIL).trim().toLowerCase(), password: String(env.ADMIN_PASSWORD) } : null);
  let adminCache = null; // the saved admin record, read once
  async function savedAdmin() { if (!adminCache) adminCache = (await db.kvGet('admin')) || {}; return adminCache.email ? adminCache : null; }
  async function setSavedAdmin(v) { await db.kvSet('admin', v); adminCache = v; }
  const kvMem = new Map();
  async function kvCached(k) { if (!kvMem.has(k)) kvMem.set(k, await db.kvGet(k)); return kvMem.get(k); }
  async function kvSave(k, v) { await db.kvSet(k, v); kvMem.set(k, v); }
  async function sessionTag() {
    const e = envAdmin();
    const a = e ? null : await savedAdmin();
    const epoch = a ? a.epoch || 0 : (await kvCached('epoch')) || 0;
    return crypto.createHash('sha256').update(`${e ? 'env:' + e.email + ':' + e.password : 'db:' + (a ? a.email + ':' + a.hash : '')}:${epoch}`).digest('base64url').slice(0, 22);
  }
  const sessions = sec.createSessions(db, sessionTag);

  async function isSetupDone() {
    const s = await kvCached('setup');
    if (s && s.done) return true;
    return Boolean(envAdmin() && env.SMTP_HOST);
  }
  const ok = (res, data = {}) => res.json({ ok: true, ...data });
  const fail = (res, status, error, extra = {}) => res.status(status).json({ ok: false, error, ...extra });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ------------------------------------------------------------ branding (name, logo, colour)
  async function brand() {
    const b = (await kvCached('brand')) || {};
    return { name: b.name || String(env.APP_NAME || '').trim().slice(0, 40) || DEFAULT_NAME, color: b.color || '', hasLogo: Boolean(b.logo), v: b.v || 0 };
  }
  app.get('/brand/logo', wrap(async (req, res) => {
    const b = (await kvCached('brand')) || {};
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (!b.logo) return res.sendFile(path.join(__dirname, '..', 'public', 'logo.svg'));
    res.setHeader('Content-Type', b.logo.type);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(Buffer.from(b.logo.data, 'base64'));
  }));

  // ------------------------------------------------------------ api guards
  const api = express.Router();
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex'); next(); });
  api.use(sec.rateLimit({ windowMs: 60000, max: 900 }));
  // CSRF wall 1: every change must carry a custom header (a form or image on another site cannot send one)
  // and, when the browser says where the request comes from, it must be this site
  api.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.path === '/inbound') return next();
    if (req.headers['x-pkj'] !== '1') return fail(res, 403, 'Forbidden');
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) return fail(res, 403, 'Forbidden (wrong origin)'); } catch (_) { return fail(res, 403, 'Forbidden'); }
    }
    next();
  });
  // ids in links are checked before they reach any database
  api.param('id', (req, res, next, id) => (isId(id) ? next() : fail(res, 404, 'Not found')));
  const small = express.json({ limit: '64kb' }); // anything a visitor can send before signing in
  const big = express.json({ limit: '30mb' }); // only after the session is checked

  async function auth(req, res, next) {
    const sid = sec.readCookie(req);
    const s = await sessions.read(sid);
    if (!s) return fail(res, 401, 'Please sign in.', { code: 'SIGNED_OUT' });
    // CSRF wall 2: changes need this session's own token
    if (req.method !== 'GET' && req.method !== 'HEAD' && !sec.safeEqual(req.headers['x-csrf-token'] || '', s.csrf)) return fail(res, 403, 'Your session token is out of date. Reload the page.');
    req.session = s;
    req.sid = sid;
    next();
  }
  const A = wrap(auth);

  const codeLimiter = sec.rateLimit({ windowMs: 15 * 60000, max: 20, message: 'Too many tries with the setup code. Wait 15 minutes.' });
  const codeGlobal = sec.globalLimit({ windowMs: 60 * 60000, max: 60 });
  async function setupGuard(req, res, next) {
    if (await isSetupDone()) return fail(res, 409, 'Setup is already finished. Sign in instead.');
    const wait = codeGlobal.blockedFor();
    if (wait) return fail(res, 429, `Too many wrong setup codes. Try again in ${Math.ceil(wait / 60)} minutes.`);
    if (!req.body || !sec.safeEqual(String(req.body.code || '').trim(), code)) {
      codeGlobal.fail();
      return fail(res, 403, 'The setup code is wrong. Look for "Setup code" in the server log (the black window or your host\'s Logs tab).');
    }
    next();
  }

  // ------------------------------------------------------------ status, setup, login
  api.get('/status', wrap(async (req, res) => {
    const s = await sessions.read(sec.readCookie(req));
    const base = { app: 'PKJ Mails', brand: await brand(), setupDone: await isSetupDone(), signedIn: Boolean(s) };
    if (!s) return ok(res, { ...base, adminFromEnv: Boolean(envAdmin()), smtpFromEnv: Boolean(env.SMTP_HOST) });
    const st = await settings();
    ok(res, { ...base, email: s.email, csrf: s.csrf, db: db.name, address: st.smtp.from, name: st.smtp.fromName });
  }));

  api.post('/setup/check', codeLimiter, small, wrap(setupGuard), (req, res) => ok(res));
  api.post('/setup/test-smtp', codeLimiter, small, wrap(setupGuard), wrap(async (req, res) => {
    const smtp = mergeSmtp(await settings(), req.body.smtp);
    try { await testSmtp(smtp, req.body.to && EMAIL_RE.test(req.body.to) ? req.body.to : null); ok(res); } catch (e) { fail(res, 400, e.message); }
  }));
  api.post('/setup/test-imap', codeLimiter, small, wrap(setupGuard), wrap(async (req, res) => {
    try { ok(res, await testImap(mergeImap(await settings(), req.body.imap))); } catch (e) { fail(res, 400, e.message); }
  }));
  api.post('/setup/finish', codeLimiter, small, wrap(setupGuard), wrap(async (req, res) => {
    const b = req.body;
    if (!envAdmin()) {
      const email = String((b.admin && b.admin.email) || '').trim().toLowerCase();
      const password = String((b.admin && b.admin.password) || '');
      if (!EMAIL_RE.test(email)) return fail(res, 400, 'Enter a valid admin email.');
      if (password.length < 10) return fail(res, 400, 'The password must be at least 10 characters.');
      if (password.length > 200) return fail(res, 400, 'The password is too long (200 characters at most).');
      await setSavedAdmin({ email, hash: sec.hashPassword(password), epoch: 0 });
    }
    if (!env.SMTP_HOST) {
      const smtp = b.smtp || {};
      if (!smtp.host) return fail(res, 400, 'Fill in the SMTP settings so you can send mail.');
      if (!EMAIL_RE.test(String(smtp.from || smtp.user || '').trim())) return fail(res, 400, 'Enter the address mail is sent from.');
    }
    await saveSettings(db, secret, { smtp: env.SMTP_HOST ? undefined : b.smtp, imap: b.imap && b.imap.host ? b.imap : undefined });
    if (b.brandName) await saveBrand({ name: b.brandName });
    await kvSave('setup', { done: true, at: Date.now() });
    if (!(await db.kvGet('labels'))) await db.kvSet('labels', [{ name: 'Work', color: LABEL_COLORS[0] }, { name: 'Personal', color: LABEL_COLORS[1] }]);
    await db.insert(welcomeMail((await brand()).name, b.smtp && b.smtp.from));
    imap.kick();
    ok(res);
  }));

  const loginLimiter = sec.rateLimit({ windowMs: 15 * 60000, max: 10, message: 'Too many sign-in tries. Wait 15 minutes and try again.' });
  const loginGlobal = sec.globalLimit({ windowMs: 60 * 60000, max: 30 });
  api.post('/login', loginLimiter, small, wrap(async (req, res) => {
    const wait = loginGlobal.blockedFor();
    if (wait) return fail(res, 429, `Too many wrong passwords were tried. Sign-in is paused for ${Math.ceil(wait / 60)} minutes.`);
    const email = String((req.body && req.body.email) || '').trim().toLowerCase().slice(0, 200);
    const password = String((req.body && req.body.password) || '').slice(0, 300);
    const e = envAdmin();
    let good;
    if (e) good = Boolean(sec.safeEqual(email, e.email) & sec.safeEqual(password, e.password)); // both checked, always
    else {
      const a = await savedAdmin();
      const passOk = sec.verifyPassword(password, a && a.hash); // runs even with no account, so timing says nothing
      good = Boolean(a && a.email === email && passOk);
    }
    if (!good) {
      loginGlobal.fail();
      log.warn(`[login] failed sign-in from ${req.ip}`);
      await new Promise(r => setTimeout(r, 400));
      return fail(res, 401, 'Wrong email or password.');
    }
    const { sid, session } = await sessions.create(email, { ua: req.headers['user-agent'] });
    sec.setSessionCookie(req, res, sid, sec.SESSION_MS);
    ok(res, { csrf: session.csrf, email });
  }));
  api.post('/logout', wrap(async (req, res) => {
    await sessions.destroy(sec.readCookie(req));
    sec.setSessionCookie(req, res, '', 0);
    ok(res);
  }));
  /** Ends every other session (lost phone, shared computer) and keeps this one. */
  api.post('/sessions/end-all', A, wrap(async (req, res) => {
    if (envAdmin()) await kvSave('epoch', ((await kvCached('epoch')) || 0) + 1);
    else { const a = await savedAdmin(); await setSavedAdmin({ ...a, epoch: (a.epoch || 0) + 1 }); }
    sessions.clearCache();
    const { sid, session } = await sessions.create(req.session.email, { ua: req.headers['user-agent'] });
    sec.setSessionCookie(req, res, sid, sec.SESSION_MS);
    ok(res, { csrf: session.csrf });
  }));
  api.post('/password', A, small, wrap(async (req, res) => {
    if (envAdmin()) return fail(res, 400, 'The password is set in the .env file (ADMIN_PASSWORD). Change it there.');
    const a = await savedAdmin();
    if (!a || !sec.verifyPassword(String(req.body.current || ''), a.hash)) return fail(res, 400, 'The current password is wrong.');
    const next = String(req.body.next || '');
    if (next.length < 10 || next.length > 200) return fail(res, 400, 'The new password must be 10 to 200 characters.');
    await setSavedAdmin({ ...a, hash: sec.hashPassword(next) }); // every other session ends with the old password
    sessions.clearCache();
    const { sid, session } = await sessions.create(a.email, { ua: req.headers['user-agent'] });
    sec.setSessionCookie(req, res, sid, sec.SESSION_MS);
    ok(res, { csrf: session.csrf });
  }));

  // ------------------------------------------------------------ settings
  function mergeSmtp(st, input = {}) {
    return {
      host: String(input.host || st.smtp.host || '').trim(),
      port: Number(input.port) || st.smtp.port,
      secure: input.secure !== undefined ? Boolean(input.secure) : st.smtp.secure,
      user: String(input.user !== undefined ? input.user : st.smtp.user).trim(),
      pass: input.pass || st.smtp.pass,
      from: String(input.from || st.smtp.from || input.user || '').trim(),
      fromName: String(input.fromName !== undefined ? input.fromName : st.smtp.fromName || '').trim()
    };
  }
  function mergeImap(st, input = {}) {
    return {
      host: String(input.host || st.imap.host || '').trim(),
      port: Number(input.port) || st.imap.port,
      secure: input.secure !== undefined ? Boolean(input.secure) : st.imap.secure,
      user: String(input.user !== undefined ? input.user : st.imap.user).trim(),
      pass: input.pass || st.imap.pass,
      pollSeconds: Number(input.pollSeconds) || st.imap.pollSeconds
    };
  }
  api.get('/settings', A, wrap(async (req, res) => {
    const st = await settings();
    ok(res, { settings: publicSettings(st), brand: await brand(), inbound: { enabled: Boolean(env.INBOUND_SECRET), path: '/api/inbound' }, adminFromEnv: Boolean(envAdmin()) });
  }));
  api.put('/settings', A, small, wrap(async (req, res) => {
    const b = req.body || {};
    await saveSettings(db, secret, { smtp: b.smtp && !env.SMTP_HOST ? b.smtp : undefined, imap: b.imap && !env.IMAP_HOST ? b.imap : undefined, signature: b.signature });
    imap.kick();
    ok(res, { settings: publicSettings(await settings()) });
  }));
  api.post('/settings/test-smtp', A, small, wrap(async (req, res) => {
    try { await testSmtp(mergeSmtp(await settings(), req.body.smtp), req.body.to && EMAIL_RE.test(req.body.to) ? req.body.to : null); ok(res); } catch (e) { fail(res, 400, e.message); }
  }));
  api.post('/settings/test-imap', A, small, wrap(async (req, res) => {
    try { ok(res, await testImap(mergeImap(await settings(), req.body.imap))); } catch (e) { fail(res, 400, e.message); }
  }));

  async function saveBrand(input) {
    const cur = (await db.kvGet('brand')) || {};
    const next = { ...cur, v: (cur.v || 0) + 1 };
    if (input.name !== undefined) next.name = String(input.name).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
    if (input.color !== undefined) next.color = /^#[0-9a-f]{6}$/i.test(String(input.color)) ? String(input.color) : '';
    if (input.logo === null) delete next.logo;
    else if (input.logo !== undefined) {
      const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(input.logo));
      if (!m) throw new Error('The logo must be a PNG, JPG, GIF or WEBP picture.');
      const bytes = Buffer.from(m[2], 'base64');
      if (bytes.length > 300 * 1024) throw new Error('The logo is too big (300 KB at most).');
      // the file must really be that kind of picture, not something renamed
      if (!LOGO_TYPES[m[1]].every((b, i) => bytes[i] === b)) throw new Error('That file is not a real picture.');
      next.logo = { type: m[1], data: m[2] };
    }
    await kvSave('brand', next);
  }
  api.put('/brand', A, express.json({ limit: '600kb' }), wrap(async (req, res) => {
    try { await saveBrand(req.body || {}); } catch (e) { return fail(res, 400, e.message); }
    ok(res, { brand: await brand() });
  }));

  // ------------------------------------------------------------ labels, contacts
  async function labels() { return (await db.kvGet('labels')) || []; }
  api.get('/labels', A, wrap(async (req, res) => ok(res, { labels: await labels() })));
  api.post('/labels', A, small, wrap(async (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    if (!LABEL_RE.test(name)) return fail(res, 400, 'A label can have letters, numbers, spaces, - and _ (up to 40).');
    const list = await labels();
    if (list.some(l => l.name.toLowerCase() === name.toLowerCase())) return fail(res, 400, 'That label already exists.');
    if (list.length >= 50) return fail(res, 400, 'You can have up to 50 labels.');
    list.push({ name, color: LABEL_COLORS[list.length % LABEL_COLORS.length] });
    await db.kvSet('labels', list);
    ok(res, { labels: list });
  }));
  api.delete('/labels/:name', A, wrap(async (req, res) => {
    const list = (await labels()).filter(l => l.name !== req.params.name);
    await db.kvSet('labels', list);
    ok(res, { labels: list });
  }));

  /** People you write to or hear from, for the "To" suggestions. */
  async function rememberContacts(people) {
    const book = { ...((await kvCached('contacts')) || {}) };
    let changed = false;
    for (const p of people) {
      const addr = String(p.address || '').toLowerCase();
      if (!EMAIL_RE.test(addr) || /no-?reply|mailer-daemon|notifications?@/i.test(addr)) continue;
      const c = book[addr] || { n: 0, name: '' };
      book[addr] = { name: String(p.name || c.name || '').slice(0, 80), n: c.n + (p.weight || 1), at: Date.now() };
      changed = true;
    }
    if (!changed) return;
    const keys = Object.keys(book);
    if (keys.length > 2000) keys.sort((a, b) => book[a].at - book[b].at).slice(0, keys.length - 2000).forEach(k => delete book[k]);
    await kvSave('contacts', book);
  }
  api.get('/contacts', A, wrap(async (req, res) => {
    const q = String(req.query.q || '').toLowerCase().trim().slice(0, 100);
    const book = (await kvCached('contacts')) || {};
    const list = Object.entries(book)
      .filter(([a, c]) => !q || a.includes(q) || String(c.name || '').toLowerCase().includes(q))
      .sort((x, y) => y[1].n - x[1].n || y[1].at - x[1].at)
      .slice(0, 8)
      .map(([address, c]) => ({ address, name: c.name }));
    ok(res, { contacts: list });
  }));

  // ------------------------------------------------------------ messages and conversations
  api.get('/counts', A, wrap(async (req, res) => ok(res, { counts: await db.counts() })));

  function viewQuery(q) {
    const folder = String(q.folder || '');
    return { folder: FOLDERS.includes(folder) ? folder : '', starred: folder === 'starred', all: folder === 'all', label: q.label ? String(q.label) : null, q: q.q ? String(q.q).slice(0, 200) : '' };
  }
  api.get('/messages', A, wrap(async (req, res) => {
    const page = Math.max(1, Math.min(200, Number(req.query.page) || 1));
    const view = viewQuery(req.query);
    if (view.folder === 'drafts' || req.query.threads === '0') {
      const r = await db.list({ ...view, limit: PAGE, offset: (page - 1) * PAGE });
      return ok(res, { total: r.total, items: r.items.map(m => ({ ...m, ids: [m.id], count: 1, names: [] })), page, limit: PAGE, threads: false });
    }
    // conversations: the newest 1000 mails of the view, folded together, then one page of conversations
    const r = await db.list({ ...view, limit: 1000, offset: 0 });
    const threads = groupThreads(r.items);
    ok(res, { total: threads.length, items: threads.slice((page - 1) * PAGE, page * PAGE), page, limit: PAGE, threads: true, capped: r.total > 1000 });
  }));

  function forBrowser(m) {
    const atts = (m.attachments || []).map((a, n) => ({ n, name: a.name, type: a.type, size: a.size, inline: Boolean(a.inline), kept: Boolean(a.data) }));
    let html = m.html ? sanitizeMailHtml(m.html) : textToHtml(m.text || '');
    // inline images (cid:) become data: links so they show inside the sandboxed frame
    html = html.replace(/(["'])cid:([^"']+)\1/gi, (all, q, cid) => {
      const a = (m.attachments || []).find(x => x.cid && x.cid === cid && x.data && /^image\//.test(x.type) && x.size <= INLINE_IMAGE_BYTES);
      return a ? `${q}data:${a.type.replace(/[^\w/+.-]/g, '')};base64,${a.data}${q}` : all;
    });
    const { attachments, text, html: _h, ...rest } = m;
    return { ...rest, threadId: m.threadId || m.id, text: text || '', html, hasRemoteImages: /<img[^>]+src=["']?https?:/i.test(html), attachments: atts };
  }

  api.get('/messages/:id', A, wrap(async (req, res) => {
    let m = await db.get(req.params.id);
    if (!m) return fail(res, 404, 'This mail is gone.');
    if (!m.read) m = await db.update(m.id, { read: true });
    ok(res, { message: forBrowser(m) });
  }));
  /** A whole conversation, oldest first. Mails in Trash/Spam are left out unless you opened it from there. */
  api.get('/threads/:id', A, wrap(async (req, res) => {
    const view = String(req.query.view || '');
    const r = await db.list({ thread: req.params.id, limit: 100 });
    let rows = r.items.filter(m => (view === 'trash' || m.folder !== 'trash') && (view === 'spam' || m.folder !== 'spam'));
    if (!rows.length) rows = r.items;
    if (!rows.length) return fail(res, 404, 'This conversation is gone.');
    const full = [];
    for (const row of rows.sort((a, b) => a.date - b.date)) {
      let m = await db.get(row.id);
      if (!m) continue;
      if (!m.read) m = await db.update(m.id, { read: true });
      full.push(forBrowser(m));
    }
    ok(res, { thread: { id: req.params.id, subject: (full.find(m => m.folder !== 'drafts') || full[0]).subject, messages: full } });
  }));
  api.get('/messages/:id/attachments/:n', A, wrap(async (req, res) => {
    const m = await db.get(req.params.id);
    const a = m && (m.attachments || [])[Number(req.params.n)];
    if (!a || !a.data) return fail(res, 404, 'This attachment was not kept.');
    const name = String(a.name || 'file').replace(/[^\w.\- ()]/g, '_');
    // always a download, never shown on this site: a file someone mailed you can never run as this page
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(a.name || 'file')}`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(Buffer.from(a.data, 'base64'));
  }));

  async function applyAction(id, action, label) {
    if (!isId(id)) return null;
    const m = await db.get(id);
    if (!m) return null;
    switch (action) {
      case 'read': return db.update(id, { read: true });
      case 'unread': return db.update(id, { read: false });
      case 'star': return db.update(id, { starred: true });
      case 'unstar': return db.update(id, { starred: false });
      case 'archive': return m.folder === 'inbox' ? db.update(id, { folder: 'archive' }) : m;
      case 'inbox': return ['archive', 'spam'].includes(m.folder) ? db.update(id, { folder: 'inbox' }) : m;
      case 'spam': return ['sent', 'drafts'].includes(m.folder) ? m : db.update(id, { folder: 'spam', prevFolder: m.folder === 'spam' ? m.prevFolder : m.folder });
      case 'notspam': return m.folder === 'spam' ? db.update(id, { folder: 'inbox' }) : m;
      case 'trash':
        if (m.folder === 'trash') { await db.remove(id); return { deleted: true }; }
        return db.update(id, { folder: 'trash', prevFolder: m.folder, trashedAt: Date.now() });
      case 'restore': return m.folder === 'trash' ? db.update(id, { folder: m.prevFolder && m.prevFolder !== 'trash' ? m.prevFolder : 'inbox', trashedAt: null }) : m;
      case 'delete': await db.remove(id); return { deleted: true };
      case 'label-add': return LABEL_RE.test(label || '') ? db.update(id, { labels: [...new Set([...(m.labels || []), label])] }) : m;
      case 'label-remove': return db.update(id, { labels: (m.labels || []).filter(l => l !== label) });
      default: return m;
    }
  }
  api.patch('/messages/:id', A, small, wrap(async (req, res) => {
    const m = await db.update(req.params.id, cleanPatch(req.body));
    if (!m) return fail(res, 404, 'This mail is gone.');
    ok(res);
  }));
  api.post('/messages/bulk', A, small, wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).filter(isId).slice(0, 1000) : [];
    const action = String(req.body.action || '');
    for (const id of ids) await applyAction(id, action, req.body.label ? String(req.body.label) : '');
    ok(res, { done: ids.length });
  }));
  api.delete('/messages/:id', A, wrap(async (req, res) => {
    const r = await applyAction(req.params.id, 'trash');
    if (!r) return fail(res, 404, 'This mail is gone.');
    ok(res, { deleted: Boolean(r.deleted) });
  }));

  // ------------------------------------------------------------ compose, drafts, send
  async function threadFor(inReplyTo, references) {
    const ids = [inReplyTo, ...String(references || '').split(/\s+/).reverse()].map(s => String(s || '').trim()).filter(Boolean).slice(0, 6);
    for (const mid of ids) {
      const p = await db.findByMessageId(mid);
      if (p) return p.threadId || p.id;
    }
    return null;
  }
  const readRecipients = v => parseAddressList(Array.isArray(v) ? v.join(',') : String(v || '')).map(a => a.address);
  function readAttachments(list) {
    const out = [];
    let total = 0;
    for (const a of Array.isArray(list) ? list.slice(0, 20) : []) {
      const data = String(a.data || '').replace(/^data:[^,]*,/, '').replace(/[^A-Za-z0-9+/=]/g, '');
      const size = Math.floor((data.length * 3) / 4);
      const name = String(a.name || 'file').replace(/[\\/\r\n"]/g, '_').slice(0, 180);
      if (BLOCKED_FILES.test(name)) throw new Error(`${name}: this file type is blocked for safety (programs and scripts). Zip it first if you must send it.`);
      total += size;
      if (total > 20 * 1024 * 1024) throw new Error('Attachments are too big (20 MB in total at most).');
      out.push({ name, type: String(a.type || 'application/octet-stream').slice(0, 100), size, data });
    }
    return out;
  }
  function draftFrom(b, st) {
    const html = String(b.html || '').slice(0, 2 * 1024 * 1024);
    return {
      folder: 'drafts', from: st.smtp.from, fromName: st.smtp.fromName,
      to: readRecipients(b.to), cc: readRecipients(b.cc), bcc: readRecipients(b.bcc),
      subject: String(b.subject || '').replace(/[\r\n]+/g, ' ').slice(0, 300),
      html, text: String(b.text || '').slice(0, 1024 * 1024), snippet: makeSnippet(b.text, html),
      date: Date.now(), read: true, starred: false, labels: [],
      inReplyTo: String(b.inReplyTo || '').slice(0, 300), references: String(b.references || '').slice(0, 2000),
      attachments: readAttachments(b.attachments)
    };
  }
  api.post('/drafts', A, big, wrap(async (req, res) => {
    const st = await settings();
    let d;
    try { d = draftFrom(req.body || {}, st); } catch (e) { return fail(res, 400, e.message); }
    const tid = await threadFor(d.inReplyTo, d.references);
    const oldId = String(req.body.id || '');
    const old = isId(oldId) ? await db.get(oldId) : null;
    if (old && old.folder === 'drafts') { await db.update(old.id, { ...d, threadId: tid || old.threadId || old.id }); return ok(res, { id: old.id }); }
    const id = newId();
    await db.insert({ id, ...d, threadId: tid || id });
    ok(res, { id });
  }));

  const sendLimiter = sec.rateLimit({ windowMs: 60 * 60000, max: 200, message: 'You sent a lot of mail in the last hour. Wait a bit before sending more.' });
  api.post('/send', A, sendLimiter, big, wrap(async (req, res) => {
    const st = await settings();
    if (!st.smtp.host) return fail(res, 400, 'Sending is not set up. Open Settings and fill in SMTP.');
    let d;
    try { d = draftFrom(req.body || {}, st); } catch (e) { return fail(res, 400, e.message); }
    const all = [...d.to, ...d.cc, ...d.bcc];
    if (!all.length) return fail(res, 400, 'Add at least one recipient.');
    if (all.length > MAX_RECIPIENTS) return fail(res, 400, `Up to ${MAX_RECIPIENTS} recipients per mail.`);
    const bad = all.find(a => !EMAIL_RE.test(a));
    if (bad) return fail(res, 400, `"${bad}" is not a valid address.`);
    const messageId = `<${newId()}.${crypto.randomBytes(4).toString('hex')}@${(st.smtp.from.split('@')[1] || 'pkj-mails.local').replace(/[^\w.-]/g, '')}>`;
    const transport = makeTransport(st.smtp);
    try {
      await transport.sendMail({
        from: st.smtp.fromName ? { name: st.smtp.fromName, address: st.smtp.from } : st.smtp.from,
        to: d.to, cc: d.cc, bcc: d.bcc,
        subject: d.subject || '(no subject)',
        html: d.html || undefined,
        text: d.text || undefined,
        messageId,
        inReplyTo: d.inReplyTo || undefined,
        references: d.references || undefined,
        attachments: d.attachments.map(a => ({ filename: a.name, contentType: a.type, content: Buffer.from(a.data, 'base64') }))
      });
    } catch (e) {
      log.warn('[send] ' + (e && e.message));
      return fail(res, 502, friendlyError(e, 'SMTP'));
    } finally {
      transport.close();
    }
    const id = newId();
    const threadId = (await threadFor(d.inReplyTo, d.references)) || id;
    await db.insert({ id, ...d, threadId, folder: 'sent', messageId, date: Date.now(), attachments: d.attachments.map(a => (a.size <= KEEP_ATTACH_BYTES ? a : { ...a, data: '' })) });
    const draftId = String(req.body.draftId || '');
    if (isId(draftId)) { const dr = await db.get(draftId); if (dr && dr.folder === 'drafts') await db.remove(dr.id); }
    rememberContacts(all.map(address => ({ address, weight: 3 }))).catch(() => {});
    ok(res, { id, threadId });
  }));

  // ------------------------------------------------------------ live updates (Server-Sent Events)
  const listeners = new Set();
  function emit(event, data) {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of listeners) { try { res.write(line); } catch (_) {} }
  }
  api.get('/events', A, (req, res) => {
    if (listeners.size >= 20) return fail(res, 429, 'Too many open windows.');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('X-Accel-Buffering', 'no'); // nginx: send each event at once
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    const end = setTimeout(() => res.end(), 30 * 60000); // the browser reconnects; a signed-out session then stops
    req.on('close', () => { clearInterval(ping); clearTimeout(end); listeners.delete(res); });
  });

  // ------------------------------------------------------------ receiving
  /** Stores one raw mail (from the webhook or IMAP). Returns the new id, or null for a duplicate. */
  async function storeRaw(raw, folder = 'inbox') {
    const p = parseMail(raw);
    if (p.messageId && (await db.findByMessageId(p.messageId))) return null;
    let kept = 0;
    const attachments = p.attachments.slice(0, 30).map(a => {
      const keep = a.size <= KEEP_ATTACH_BYTES && kept + a.size <= 25 * 1024 * 1024;
      if (keep) kept += a.size;
      return { name: a.name, type: a.type, size: a.size, cid: a.cid, inline: a.inline, data: keep ? a.data.toString('base64') : '' };
    });
    const rawStr = Buffer.isBuffer(raw) ? raw.toString('latin1') : String(raw);
    const cut = rawStr.search(/\r?\n\r?\n/);
    const head = cut >= 0 ? rawStr.slice(0, cut) : rawStr.slice(0, 20000);
    const spam = /^x-spam-(flag|status):\s*yes/im.test(head);
    const date = Math.min(p.date, Date.now());
    const id = newId(date);
    const threadId = (await threadFor(p.inReplyTo, p.references)) || id;
    const msg = {
      id, threadId,
      folder: spam && folder === 'inbox' ? 'spam' : folder,
      from: p.from.address, fromName: p.from.name,
      to: p.to.map(a => a.address), cc: p.cc.map(a => a.address),
      replyTo: p.replyTo ? p.replyTo.address : '',
      subject: p.subject.slice(0, 500),
      text: (p.text || '').slice(0, 1024 * 1024),
      html: (p.html || '').slice(0, 2 * 1024 * 1024),
      snippet: makeSnippet(p.text, p.html),
      date, read: false, starred: false, labels: [],
      messageId: p.messageId, inReplyTo: p.inReplyTo, references: p.references,
      attachments
    };
    await db.insert(msg);
    if (msg.folder === 'inbox') {
      rememberContacts([{ address: p.from.address, name: p.from.name }]).catch(() => {});
      emit('mail', { id, threadId, from: p.from.name || p.from.address, subject: msg.subject.slice(0, 120) });
    }
    return id;
  }

  const inboundLimiter = sec.rateLimit({ windowMs: 60000, max: 120 });
  api.post('/inbound', inboundLimiter, express.raw({ type: () => true, limit: '30mb' }), wrap(async (req, res) => {
    const want = String(env.INBOUND_SECRET || '');
    if (want.length < 16) return fail(res, 503, 'Inbound mail is off. Set INBOUND_SECRET (16+ characters) in .env.');
    const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.query.key || '');
    if (!sec.safeEqual(given, want)) return fail(res, 401, 'Wrong inbound key.');
    let raw = req.body;
    if (/json/i.test(String(req.headers['content-type'] || ''))) {
      let j;
      try { j = JSON.parse(raw.toString('utf8')); } catch (_) { return fail(res, 400, 'Bad JSON.'); }
      if (j.raw) raw = Buffer.from(String(j.raw), j.encoding === 'base64' ? 'base64' : 'utf8');
      else raw = Buffer.from(buildSimpleMime(j), 'utf8');
    }
    if (!raw || !raw.length) return fail(res, 400, 'Empty mail.');
    const id = await storeRaw(raw);
    ok(res, { id, duplicate: !id });
  }));

  /** IMAP polling: runs in the background, reads the settings on each round. */
  const imap = (() => {
    let timer = null;
    let running = false;
    let stopped = true;
    let lastError = '';
    async function tick() {
      if (running) return;
      running = true;
      let wait = 60;
      try {
        const st = await settings();
        wait = st.imap.pollSeconds;
        if (st.imap.host && st.imap.user && st.imap.pass && (await isSetupDone())) {
          const state = (await db.kvGet('imapState')) || {};
          const next = await fetchNewImap(st.imap, state, raw => storeRaw(raw));
          await db.kvSet('imapState', next);
          lastError = '';
        }
      } catch (e) {
        const msg = friendlyError(e, 'IMAP');
        if (msg !== lastError) log.warn('[imap] ' + msg);
        lastError = msg;
      } finally {
        running = false;
        if (!stopped) timer = setTimeout(tick, wait * 1000);
      }
    }
    return {
      start() { stopped = false; clearTimeout(timer); timer = setTimeout(tick, 3000); },
      kick() { if (!stopped) { clearTimeout(timer); timer = setTimeout(tick, 1000); } },
      stop() { stopped = true; clearTimeout(timer); },
      status: () => lastError
    };
  })();
  api.get('/imap/status', A, (req, res) => ok(res, { error: imap.status() }));
  api.post('/imap/check', A, (req, res) => { imap.kick(); ok(res); });

  // the bin empties itself after 30 days
  const cleaner = setInterval(async () => {
    try { for (const id of await db.idsInFolderOlderThan('trash', Date.now() - TRASH_DAYS * 86400000)) await db.remove(id); } catch (_) {}
  }, 6 * 3600000);
  cleaner.unref();

  api.use((req, res) => fail(res, 404, 'Not found'));
  api.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return fail(res, 413, 'That is too big. Try smaller attachments.');
    if (err && err.type === 'entity.parse.failed') return fail(res, 400, 'Bad request.');
    log.error('[api] ' + (err && err.stack ? err.stack : err));
    fail(res, 500, 'Something went wrong on the server. Look at the server log for details.');
  });

  app.use('/api', api);
  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub, { index: false, maxAge: 0, etag: true }));
  app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));

  return {
    app,
    setupCode: code,
    storeRaw,
    startBackground: () => imap.start(),
    stop() { imap.stop(); clearInterval(cleaner); for (const r of listeners) r.end(); }
  };
}

/** For inbound webhooks that post JSON fields instead of a raw mail. */
function buildSimpleMime(j) {
  const hdr = v => String(v || '').replace(/[\r\n]+/g, ' ');
  const lines = [
    `From: ${hdr(j.from)}`,
    `To: ${hdr(Array.isArray(j.to) ? j.to.join(', ') : j.to)}`,
    `Subject: =?utf-8?B?${Buffer.from(hdr(j.subject)).toString('base64')}?=`,
    `Date: ${new Date(j.date || Date.now()).toUTCString()}`,
    j.messageId ? `Message-ID: ${hdr(j.messageId)}` : null,
    j.inReplyTo ? `In-Reply-To: ${hdr(j.inReplyTo)}` : null,
    'MIME-Version: 1.0'
  ].filter(Boolean);
  if (j.html) {
    const b = 'pkj' + crypto.randomBytes(8).toString('hex');
    return [...lines, `Content-Type: multipart/alternative; boundary="${b}"`, '',
      `--${b}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(String(j.text || '')).toString('base64'),
      `--${b}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(String(j.html)).toString('base64'),
      `--${b}--`, ''].join('\r\n');
  }
  return [...lines, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(String(j.text || '')).toString('base64'), ''].join('\r\n');
}

function welcomeMail(appName, to) {
  const name = String(appName).replace(/[<>&"]/g, '');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#202124">
<h2 style="margin:0 0 8px">Welcome to ${name} 👋</h2>
<p>Your inbox is ready. A few tips:</p>
<ul>
<li>Click <b>Compose</b> to write a mail. You get a few seconds to <b>Undo</b> after pressing Send.</li>
<li>Replies stay together in one <b>conversation</b>.</li>
<li><b>Archive</b> clears a mail out of the Inbox without deleting it; find it in <b>All Mail</b>.</li>
<li>Search like <code>from:ana is:unread has:attachment</code>.</li>
<li>Open <b>Settings</b> (gear icon) to change the app name, logo and colour, or your mail settings.</li>
<li>Shortcuts: <b>c</b> compose, <b>/</b> search, <b>j</b>/<b>k</b> next/previous, <b>e</b> archive, <b>r</b> reply, <b>#</b> delete.</li>
</ul>
<p>Enjoy!</p></div>`;
  const id = newId();
  return {
    id, threadId: id, folder: 'inbox', from: 'welcome@pkj-mails.local', fromName: name, to: to ? [to] : [],
    subject: 'Welcome to your new inbox', html, text: '', snippet: 'Your inbox is ready. A few tips: Click Compose to write a mail…',
    date: Date.now(), read: false, starred: false, labels: [], attachments: []
  };
}

module.exports = { createApp, buildSimpleMime };
