/**
 * The PKJ Mails web server: the API under /api and the inbox page from /public.
 * createApp() takes a ready database adapter, so the tests can run it with any database.
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const sec = require('./security');
const { parseMail, parseAddressList } = require('./mail/mimeParse');
const { sanitizeMailHtml, makeSnippet, textToHtml } = require('./mail/sanitize');
const { loadSettings, saveSettings, publicSettings } = require('./mail/settings');
const { makeTransport, testSmtp, testImap, fetchNewImap, friendlyError } = require('./mail/transport');
const { FOLDERS, LABEL_RE, newId, cleanPatch } = require('./db/query');

const EMAIL_RE = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/;
const MAX_RECIPIENTS = 50;
const KEEP_ATTACH_BYTES = 8 * 1024 * 1024;
const INLINE_IMAGE_BYTES = 600 * 1024;
const TRASH_DAYS = 30;
const LABEL_COLORS = ['#1a73e8', '#188038', '#e37400', '#d93025', '#9334e6', '#007b83', '#b06000', '#c5221f'];

function createApp({ db, env = process.env, secret, log = console, setupCode } = {}) {
  if (!secret || String(secret).length < 32) throw new Error('APP_SECRET must be at least 32 characters.');
  const app = express();
  const sessions = sec.createSessions(db);
  const code = String(env.SETUP_CODE || setupCode || crypto.randomBytes(4).toString('hex')).trim();
  const settings = () => loadSettings(db, env, secret);

  if (/^(1|true)$/i.test(String(env.TRUST_PROXY || ''))) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(sec.securityHeaders);

  // ------------------------------------------------------------ helpers
  const envAdmin = () => (env.ADMIN_EMAIL && env.ADMIN_PASSWORD ? { email: String(env.ADMIN_EMAIL).trim().toLowerCase(), password: String(env.ADMIN_PASSWORD) } : null);
  async function admin() {
    const e = envAdmin();
    if (e) return { email: e.email, fromEnv: true };
    return db.kvGet('admin');
  }
  async function isSetupDone() {
    const s = await db.kvGet('setup');
    if (s && s.done) return true;
    return Boolean(envAdmin() && env.SMTP_HOST);
  }
  const ok = (res, data = {}) => res.json({ ok: true, ...data });
  const fail = (res, status, error, extra = {}) => res.status(status).json({ ok: false, error, ...extra });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ------------------------------------------------------------ api guards
  const api = express.Router();
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(sec.rateLimit({ windowMs: 60000, max: 600 }));
  // CSRF wall 1: every change must carry a custom header, which a form or image on another site cannot send
  api.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.path === '/inbound') return next();
    if (req.headers['x-pkj'] !== '1') return fail(res, 403, 'Forbidden');
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      try { if (new URL(origin).host !== req.headers.host) return fail(res, 403, 'Forbidden (wrong origin)'); } catch (_) { return fail(res, 403, 'Forbidden'); }
    }
    next();
  });
  const json = express.json({ limit: '30mb' });

  async function auth(req, res, next) {
    const sid = sec.readCookie(req);
    const s = await sessions.read(sid);
    if (!s) return fail(res, 401, 'Please sign in.', { code: 'SIGNED_OUT' });
    // CSRF wall 2: changes need this session's own token
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-csrf-token'] !== s.csrf) return fail(res, 403, 'Your session token is out of date. Reload the page.');
    req.session = s;
    req.sid = sid;
    next();
  }
  const codeLimiter = sec.rateLimit({ windowMs: 15 * 60000, max: 20, message: 'Too many tries with the setup code. Wait 15 minutes.' });
  async function setupGuard(req, res, next) {
    if (await isSetupDone()) return fail(res, 409, 'Setup is already finished. Sign in instead.');
    if (!req.body || !sec.safeEqual(String(req.body.code || '').trim(), code)) return fail(res, 403, 'The setup code is wrong. Look for "Setup code" in the server log (the black window or your host\'s Logs tab).');
    next();
  }

  // ------------------------------------------------------------ status, setup, login
  api.get('/status', wrap(async (req, res) => {
    const s = await sessions.read(sec.readCookie(req));
    const a = await admin();
    const st = s ? await settings() : null;
    ok(res, {
      app: 'PKJ Mails',
      setupDone: await isSetupDone(),
      adminFromEnv: Boolean(envAdmin()),
      smtpFromEnv: Boolean(env.SMTP_HOST),
      signedIn: Boolean(s),
      email: s ? s.email : null,
      csrf: s ? s.csrf : null,
      db: db.name,
      address: st ? st.smtp.from : null,
      name: st ? st.smtp.fromName : null,
      hasAdmin: Boolean(a)
    });
  }));

  api.post('/setup/check', codeLimiter, json, wrap(setupGuard), (req, res) => ok(res));
  api.post('/setup/test-smtp', codeLimiter, json, wrap(setupGuard), wrap(async (req, res) => {
    const smtp = mergeSmtp(await settings(), req.body.smtp);
    try { await testSmtp(smtp, req.body.to && EMAIL_RE.test(req.body.to) ? req.body.to : null); ok(res); } catch (e) { fail(res, 400, e.message); }
  }));
  api.post('/setup/test-imap', codeLimiter, json, wrap(setupGuard), wrap(async (req, res) => {
    const imap = mergeImap(await settings(), req.body.imap);
    try { ok(res, await testImap(imap)); } catch (e) { fail(res, 400, e.message); }
  }));
  api.post('/setup/finish', codeLimiter, json, wrap(setupGuard), wrap(async (req, res) => {
    const b = req.body;
    if (!envAdmin()) {
      const email = String((b.admin && b.admin.email) || '').trim().toLowerCase();
      const password = String((b.admin && b.admin.password) || '');
      if (!EMAIL_RE.test(email)) return fail(res, 400, 'Enter a valid admin email.');
      if (password.length < 10) return fail(res, 400, 'The password must be at least 10 characters.');
      await db.kvSet('admin', { email, hash: sec.hashPassword(password) });
    }
    if (!env.SMTP_HOST) {
      const smtp = b.smtp || {};
      if (!smtp.host) return fail(res, 400, 'Fill in the SMTP settings so you can send mail.');
      if (!EMAIL_RE.test(String(smtp.from || smtp.user || '').trim())) return fail(res, 400, 'Enter the address mail is sent from.');
    }
    await saveSettings(db, secret, { smtp: env.SMTP_HOST ? undefined : b.smtp, imap: b.imap && b.imap.host ? b.imap : undefined });
    await db.kvSet('setup', { done: true, at: Date.now() });
    if (!(await db.kvGet('labels'))) await db.kvSet('labels', [{ name: 'Work', color: LABEL_COLORS[0] }, { name: 'Personal', color: LABEL_COLORS[1] }]);
    await db.insert(welcomeMail(b.smtp && b.smtp.from));
    imap.kick();
    ok(res);
  }));

  const loginLimiter = sec.rateLimit({ windowMs: 15 * 60000, max: 10, message: 'Too many sign-in tries. Wait 15 minutes and try again.' });
  api.post('/login', loginLimiter, json, wrap(async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');
    const e = envAdmin();
    let good = false;
    if (e) good = sec.safeEqual(email, e.email) && sec.safeEqual(password, e.password);
    else {
      const a = await db.kvGet('admin');
      good = Boolean(a && a.email === email && sec.verifyPassword(password, a.hash));
    }
    if (!good) return fail(res, 401, 'Wrong email or password.');
    const { sid, session } = await sessions.create(email);
    sec.setSessionCookie(req, res, sid, sec.SESSION_MS);
    ok(res, { csrf: session.csrf, email });
  }));
  api.post('/logout', wrap(async (req, res) => {
    await sessions.destroy(sec.readCookie(req));
    sec.setSessionCookie(req, res, '', 0);
    ok(res);
  }));
  api.post('/password', json, wrap(auth), wrap(async (req, res) => {
    if (envAdmin()) return fail(res, 400, 'The password is set in the .env file (ADMIN_PASSWORD). Change it there.');
    const a = await db.kvGet('admin');
    if (!a || !sec.verifyPassword(String(req.body.current || ''), a.hash)) return fail(res, 400, 'The current password is wrong.');
    if (String(req.body.next || '').length < 10) return fail(res, 400, 'The new password must be at least 10 characters.');
    await db.kvSet('admin', { ...a, hash: sec.hashPassword(String(req.body.next)) });
    ok(res);
  }));

  // ------------------------------------------------------------ settings
  function mergeSmtp(st, input = {}) {
    const port = Number(input.port) || st.smtp.port;
    return {
      host: String(input.host || st.smtp.host || '').trim(),
      port,
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
  api.get('/settings', wrap(auth), wrap(async (req, res) => {
    const st = await settings();
    ok(res, { settings: publicSettings(st), inbound: { enabled: Boolean(env.INBOUND_SECRET), path: '/api/inbound' }, adminFromEnv: Boolean(envAdmin()) });
  }));
  api.put('/settings', json, wrap(auth), wrap(async (req, res) => {
    const b = req.body || {};
    await saveSettings(db, secret, { smtp: b.smtp && !env.SMTP_HOST ? b.smtp : undefined, imap: b.imap && !env.IMAP_HOST ? b.imap : undefined, signature: b.signature });
    imap.kick();
    ok(res, { settings: publicSettings(await settings()) });
  }));
  api.post('/settings/test-smtp', json, wrap(auth), wrap(async (req, res) => {
    const smtp = mergeSmtp(await settings(), req.body.smtp);
    try { await testSmtp(smtp, req.body.to && EMAIL_RE.test(req.body.to) ? req.body.to : null); ok(res); } catch (e) { fail(res, 400, e.message); }
  }));
  api.post('/settings/test-imap', json, wrap(auth), wrap(async (req, res) => {
    try { ok(res, await testImap(mergeImap(await settings(), req.body.imap))); } catch (e) { fail(res, 400, e.message); }
  }));

  // ------------------------------------------------------------ labels
  async function labels() { return (await db.kvGet('labels')) || []; }
  api.get('/labels', wrap(auth), wrap(async (req, res) => ok(res, { labels: await labels() })));
  api.post('/labels', json, wrap(auth), wrap(async (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    if (!LABEL_RE.test(name)) return fail(res, 400, 'A label can have letters, numbers, spaces, - and _ (up to 40).');
    const list = await labels();
    if (list.some(l => l.name.toLowerCase() === name.toLowerCase())) return fail(res, 400, 'That label already exists.');
    if (list.length >= 50) return fail(res, 400, 'You can have up to 50 labels.');
    list.push({ name, color: LABEL_COLORS[list.length % LABEL_COLORS.length] });
    await db.kvSet('labels', list);
    ok(res, { labels: list });
  }));
  api.delete('/labels/:name', wrap(auth), wrap(async (req, res) => {
    const list = (await labels()).filter(l => l.name !== req.params.name);
    await db.kvSet('labels', list);
    ok(res, { labels: list });
  }));

  // ------------------------------------------------------------ messages
  api.get('/counts', wrap(auth), wrap(async (req, res) => ok(res, { counts: await db.counts() })));
  api.get('/messages', wrap(auth), wrap(async (req, res) => {
    const q = req.query;
    const page = Math.max(1, Number(q.page) || 1);
    const limit = 50;
    const r = await db.list({
      folder: String(q.folder || ''),
      starred: q.folder === 'starred',
      label: q.label ? String(q.label) : null,
      q: q.q ? String(q.q) : '',
      limit,
      offset: (page - 1) * limit
    });
    ok(res, { ...r, page, limit });
  }));

  function forBrowser(m) {
    const atts = (m.attachments || []).map((a, n) => ({ n, name: a.name, type: a.type, size: a.size, inline: Boolean(a.inline), kept: Boolean(a.data) }));
    let html = m.html ? sanitizeMailHtml(m.html) : textToHtml(m.text || '');
    // inline images (cid:) become data: links so they show inside the sandboxed frame
    html = html.replace(/(["'])cid:([^"']+)\1/gi, (all, q, cid) => {
      const a = (m.attachments || []).find(x => x.cid && x.cid === cid && x.data && /^image\//.test(x.type) && x.size <= INLINE_IMAGE_BYTES);
      return a ? `${q}data:${a.type};base64,${a.data}${q}` : all;
    });
    const { attachments, text, html: _h, ...rest } = m;
    return { ...rest, text: text || '', html, attachments: atts };
  }

  api.get('/messages/:id', wrap(auth), wrap(async (req, res) => {
    let m = await db.get(req.params.id);
    if (!m) return fail(res, 404, 'This mail is gone.');
    if (!m.read) m = await db.update(m.id, { read: true });
    ok(res, { message: forBrowser(m) });
  }));
  api.get('/messages/:id/attachments/:n', wrap(auth), wrap(async (req, res) => {
    const m = await db.get(req.params.id);
    const a = m && (m.attachments || [])[Number(req.params.n)];
    if (!a || !a.data) return fail(res, 404, 'This attachment was not kept.');
    const name = String(a.name || 'file').replace(/[^\w.\- ()]/g, '_');
    res.setHeader('Content-Type', 'application/octet-stream'); // always a download, never shown in the page
    res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(a.name || 'file')}`);
    res.send(Buffer.from(a.data, 'base64'));
  }));

  async function applyAction(id, action, label) {
    const m = await db.get(id);
    if (!m) return null;
    switch (action) {
      case 'read': return db.update(id, { read: true });
      case 'unread': return db.update(id, { read: false });
      case 'star': return db.update(id, { starred: true });
      case 'unstar': return db.update(id, { starred: false });
      case 'spam': return db.update(id, { folder: 'spam', prevFolder: m.folder === 'spam' ? m.prevFolder : m.folder });
      case 'notspam': return db.update(id, { folder: 'inbox' });
      case 'trash':
        if (m.folder === 'trash') { await db.remove(id); return { deleted: true }; }
        return db.update(id, { folder: 'trash', prevFolder: m.folder, trashedAt: Date.now() });
      case 'restore': return db.update(id, { folder: m.prevFolder && m.prevFolder !== 'trash' ? m.prevFolder : 'inbox', trashedAt: null });
      case 'delete': await db.remove(id); return { deleted: true };
      case 'label-add': return LABEL_RE.test(label || '') ? db.update(id, { labels: [...new Set([...(m.labels || []), label])] }) : m;
      case 'label-remove': return db.update(id, { labels: (m.labels || []).filter(l => l !== label) });
      case 'move': return FOLDERS.includes(label) ? db.update(id, { folder: label }) : m;
      default: return m;
    }
  }
  api.patch('/messages/:id', json, wrap(auth), wrap(async (req, res) => {
    const patch = cleanPatch(req.body);
    const m = await db.update(req.params.id, patch);
    if (!m) return fail(res, 404, 'This mail is gone.');
    ok(res);
  }));
  api.post('/messages/bulk', json, wrap(auth), wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).slice(0, 500) : [];
    const action = String(req.body.action || '');
    for (const id of ids) await applyAction(id, action, req.body.label ? String(req.body.label) : '');
    ok(res, { done: ids.length });
  }));
  api.delete('/messages/:id', wrap(auth), wrap(async (req, res) => {
    const r = await applyAction(req.params.id, 'trash');
    if (!r) return fail(res, 404, 'This mail is gone.');
    ok(res, { deleted: Boolean(r.deleted) });
  }));

  // ------------------------------------------------------------ compose, drafts, send
  function readRecipients(v) {
    const list = Array.isArray(v) ? v.join(',') : String(v || '');
    return parseAddressList(list).map(a => a.address);
  }
  function readAttachments(list) {
    const out = [];
    let total = 0;
    for (const a of Array.isArray(list) ? list.slice(0, 20) : []) {
      const data = String(a.data || '').replace(/^data:[^,]*,/, '');
      const size = Math.floor((data.length * 3) / 4);
      total += size;
      if (total > 20 * 1024 * 1024) throw new Error('Attachments are too big (20 MB in total at most).');
      out.push({ name: String(a.name || 'file').slice(0, 180), type: String(a.type || 'application/octet-stream').slice(0, 100), size, data });
    }
    return out;
  }
  function draftFrom(b, st) {
    const html = String(b.html || '').slice(0, 2 * 1024 * 1024);
    return {
      folder: 'drafts',
      from: st.smtp.from,
      fromName: st.smtp.fromName,
      to: readRecipients(b.to),
      cc: readRecipients(b.cc),
      bcc: readRecipients(b.bcc),
      subject: String(b.subject || '').slice(0, 300),
      html,
      text: String(b.text || '').slice(0, 1024 * 1024),
      snippet: makeSnippet(b.text, html),
      date: Date.now(),
      read: true,
      starred: false,
      labels: [],
      inReplyTo: String(b.inReplyTo || '').slice(0, 300),
      references: String(b.references || '').slice(0, 2000),
      attachments: readAttachments(b.attachments)
    };
  }
  api.post('/drafts', json, wrap(auth), wrap(async (req, res) => {
    const st = await settings();
    let d;
    try { d = draftFrom(req.body || {}, st); } catch (e) { return fail(res, 400, e.message); }
    const id = req.body.id && (await db.get(String(req.body.id))) ? String(req.body.id) : null;
    if (id) { await db.update(id, d); return ok(res, { id }); }
    const nid = newId();
    await db.insert({ id: nid, ...d });
    ok(res, { id: nid });
  }));

  const sendLimiter = sec.rateLimit({ windowMs: 60 * 60000, max: 200, message: 'You sent a lot of mail in the last hour. Wait a bit before sending more.' });
  api.post('/send', sendLimiter, json, wrap(auth), wrap(async (req, res) => {
    const st = await settings();
    if (!st.smtp.host) return fail(res, 400, 'Sending is not set up. Open Settings and fill in SMTP.');
    let d;
    try { d = draftFrom(req.body || {}, st); } catch (e) { return fail(res, 400, e.message); }
    const all = [...d.to, ...d.cc, ...d.bcc];
    if (!all.length) return fail(res, 400, 'Add at least one recipient.');
    if (all.length > MAX_RECIPIENTS) return fail(res, 400, `Up to ${MAX_RECIPIENTS} recipients per mail.`);
    if (!all.every(a => EMAIL_RE.test(a))) return fail(res, 400, 'One of the addresses is not valid.');
    const messageId = `<${newId()}.${crypto.randomBytes(4).toString('hex')}@${(st.smtp.from.split('@')[1] || 'pkj-mails.local')}>`;
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
    const sent = { ...d, folder: 'sent', messageId, date: Date.now(), attachments: d.attachments.map(a => (a.size <= KEEP_ATTACH_BYTES ? a : { ...a, data: '' })) };
    const id = newId();
    await db.insert({ id, ...sent });
    if (req.body.draftId) { const dr = await db.get(String(req.body.draftId)); if (dr && dr.folder === 'drafts') await db.remove(dr.id); }
    ok(res, { id });
  }));

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
    const head = rawStr.slice(0, rawStr.search(/\r?\n\r?\n/) >>> 0);
    const spam = /^x-spam-(flag|status):\s*yes/im.test(head);
    const id = newId(Math.min(p.date, Date.now()));
    await db.insert({
      id,
      folder: spam && folder === 'inbox' ? 'spam' : folder,
      from: p.from.address,
      fromName: p.from.name,
      to: p.to.map(a => a.address),
      cc: p.cc.map(a => a.address),
      replyTo: p.replyTo ? p.replyTo.address : '',
      subject: p.subject.slice(0, 500),
      text: (p.text || '').slice(0, 1024 * 1024),
      html: (p.html || '').slice(0, 2 * 1024 * 1024),
      snippet: makeSnippet(p.text, p.html),
      date: Math.min(p.date, Date.now()),
      read: false,
      starred: false,
      labels: [],
      messageId: p.messageId,
      inReplyTo: p.inReplyTo,
      references: p.references,
      attachments
    });
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
  api.get('/imap/status', wrap(auth), (req, res) => ok(res, { error: imap.status() }));

  // the bin empties itself after 30 days
  const cleaner = setInterval(async () => {
    try { for (const id of await db.idsInFolderOlderThan('trash', Date.now() - TRASH_DAYS * 86400000)) await db.remove(id); } catch (_) {}
  }, 6 * 3600000);
  cleaner.unref();

  api.use((req, res) => fail(res, 404, 'Not found'));
  api.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return fail(res, 413, 'That is too big. Try smaller attachments.');
    log.error('[api] ' + (err && err.stack ? err.stack : err));
    fail(res, 500, 'Something went wrong on the server. Look at the server log for details.');
  });

  app.use('/api', api);
  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub, { index: false, maxAge: 0, etag: true })); // always fresh after an update
  app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));

  return {
    app,
    setupCode: code,
    storeRaw,
    startBackground: () => imap.start(),
    stop() { imap.stop(); clearInterval(cleaner); }
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

function welcomeMail(to) {
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#202124">
<h2 style="margin:0 0 8px">Welcome to PKJ Mails 👋</h2>
<p>Your inbox is ready. A few tips:</p>
<ul>
<li>Click <b>Compose</b> (bottom-left on phones) to write a mail.</li>
<li>Click the ☆ star to keep important mails in <b>Starred</b>.</li>
<li>Search like <code>from:ana is:unread has:attachment</code>.</li>
<li>Open <b>Settings</b> (gear icon) to change sending (SMTP) or receiving (IMAP) settings at any time.</li>
<li>Press <b>c</b> to compose, <b>/</b> to search, <b>j</b>/<b>k</b> to move between mails.</li>
</ul>
<p>Enjoy!</p></div>`;
  return {
    id: newId(), folder: 'inbox', from: 'welcome@pkj-mails.local', fromName: 'PKJ Mails', to: to ? [to] : [],
    subject: 'Welcome to your new inbox', html, text: '', snippet: 'Your inbox is ready. A few tips: Click Compose to write a mail…',
    date: Date.now(), read: false, starred: false, labels: [], attachments: []
  };
}

module.exports = { createApp, buildSimpleMime };
