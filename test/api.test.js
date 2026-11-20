/** Runs the real server on a free port with an in-memory database and a fake mail sender (SMTP_HOST=test). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeMailHtml } = require('../src/mail/sanitize');
const { hashPassword, verifyPassword, encrypt, decrypt } = require('../src/security');
const { start, SECRET, INBOUND, SMTP } = require('./helpers');

test('setup, sign in, send, receive, folders', async t => {
  const s = await start();
  t.after(s.stop);

  let r = await s.call('/status');
  assert.equal(r.json.setupDone, false);

  r = await s.call('/setup/check', { method: 'POST', body: { code: 'wrong' } });
  assert.equal(r.status, 403, 'a wrong setup code is refused');
  r = await s.call('/setup/test-smtp', { method: 'POST', body: { code: 'code1234', smtp: SMTP, to: 'me@example.com' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await s.call('/setup/finish', { method: 'POST', body: { code: 'code1234', admin: { email: 'Me@Example.com', password: 'short' }, smtp: SMTP } });
  assert.equal(r.status, 400, 'short password refused');
  r = await s.call('/setup/finish', { method: 'POST', body: { code: 'code1234', admin: { email: 'Me@Example.com', password: 'a-long-password' }, smtp: SMTP } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await s.call('/setup/finish', { method: 'POST', body: { code: 'code1234', admin: { email: 'evil@x.com', password: 'a-long-password' }, smtp: SMTP } });
  assert.equal(r.status, 409, 'setup cannot run twice');

  // the password is stored hashed, the SMTP password encrypted
  const admin = await s.db.kvGet('admin');
  assert.ok(admin.hash.startsWith('scrypt$') && !JSON.stringify(admin).includes('a-long-password'));
  assert.ok(!JSON.stringify(await s.db.kvGet('settings')).includes('app-password'));

  r = await s.call('/messages');
  assert.equal(r.status, 401);
  r = await s.call('/login', { method: 'POST', body: { email: 'me@example.com', password: 'nope-nope-nope' } });
  assert.equal(r.status, 401);
  r = await s.call('/login', { method: 'POST', body: { email: 'me@example.com', password: 'a-long-password' } });
  assert.equal(r.status, 200);
  const csrf = r.json.csrf;

  // CSRF: a change without the session token is refused, even with the cookie
  r = await s.call('/labels', { method: 'POST', body: { name: 'Clients' } });
  assert.equal(r.status, 403);
  r = await s.call('/labels', { method: 'POST', body: { name: 'Clients' }, headers: { 'x-pkj': '' } });
  assert.equal(r.status, 403);
  s.setCsrf(csrf);
  r = await s.call('/labels', { method: 'POST', body: { name: 'Clients' } });
  assert.equal(r.status, 200);
  assert.ok(r.json.labels.some(l => l.name === 'Clients'));

  // welcome mail is in the inbox
  r = await s.call('/messages?folder=inbox');
  assert.equal(r.json.total, 1);

  // send
  r = await s.call('/send', { method: 'POST', body: { to: 'friend@example.com', subject: 'Hi there', html: '<p>Hello <b>friend</b></p>', text: 'Hello friend', attachments: [{ name: 'n.txt', type: 'text/plain', data: Buffer.from('note').toString('base64') }] } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await s.call('/messages?folder=sent');
  assert.equal(r.json.total, 1);
  assert.equal(r.json.items[0].subject, 'Hi there');
  r = await s.call('/send', { method: 'POST', body: { to: 'not-an-address', subject: 'x' } });
  assert.equal(r.status, 400);

  // drafts
  r = await s.call('/drafts', { method: 'POST', body: { to: 'a@b.co', subject: 'Later' } });
  const draftId = r.json.id;
  r = await s.call('/counts');
  assert.equal(r.json.counts.drafts.total, 1);
  r = await s.call('/send', { method: 'POST', body: { draftId, to: 'a@b.co', subject: 'Later', text: 'done' } });
  assert.equal(r.status, 200);
  assert.equal((await s.call('/counts')).json.counts.drafts.total, 0, 'sending removes the draft');

  // receive through the webhook
  const raw = [
    'From: "Ana Lima" <ana@example.com>', 'To: me@example.com', 'Subject: =?utf-8?B?' + Buffer.from('Olá 👋').toString('base64') + '?=',
    'Message-ID: <m1@example.com>', 'Date: ' + new Date().toUTCString(), 'Content-Type: text/html; charset=utf-8', '',
    '<p onclick="alert(1)">Hi <script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="https://example.com/a.png"></p>'
  ].join('\r\n');
  r = await s.call('/inbound', { method: 'POST', raw, headers: { 'content-type': 'message/rfc822' } });
  assert.equal(r.status, 401, 'webhook needs the key');
  r = await s.call('/inbound', { method: 'POST', raw, headers: { 'content-type': 'message/rfc822', authorization: 'Bearer ' + INBOUND } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json.id;
  r = await s.call('/inbound', { method: 'POST', raw, headers: { 'content-type': 'message/rfc822', authorization: 'Bearer ' + INBOUND } });
  assert.equal(r.json.duplicate, true, 'same Message-ID is stored once');
  r = await s.call('/inbound?key=' + INBOUND, { method: 'POST', body: { from: 'Zed <zed@example.com>', to: 'me@example.com', subject: 'JSON mail', text: 'plain body' } });
  assert.equal(r.status, 200);

  r = await s.call('/messages/' + id);
  assert.equal(r.json.message.subject, 'Olá 👋');
  assert.equal(r.json.message.fromName, 'Ana Lima');
  const html = r.json.message.html;
  assert.ok(!/script|onclick|javascript:/i.test(html), 'mail HTML is sanitized: ' + html);
  assert.ok(/<img src="https:\/\/example.com\/a.png"/.test(html));
  assert.equal(r.json.message.read, true, 'opening marks it read');

  // search, star, labels, spam, trash
  r = await s.call('/messages?q=from:ana');
  assert.equal(r.json.total, 1);
  await s.call('/messages/' + id, { method: 'PATCH', body: { starred: true } });
  assert.equal((await s.call('/messages?folder=starred')).json.total, 1);
  await s.call('/messages/bulk', { method: 'POST', body: { ids: [id], action: 'label-add', label: 'Clients' } });
  assert.equal((await s.call('/messages?label=Clients')).json.total, 1);
  await s.call('/messages/bulk', { method: 'POST', body: { ids: [id], action: 'spam' } });
  assert.equal((await s.call('/messages?folder=spam')).json.total, 1);
  await s.call('/messages/bulk', { method: 'POST', body: { ids: [id], action: 'notspam' } });
  r = await s.call('/messages/' + id, { method: 'DELETE' });
  assert.equal(r.json.deleted, false);
  assert.equal((await s.call('/messages?folder=trash')).json.total, 1);
  await s.call('/messages/bulk', { method: 'POST', body: { ids: [id], action: 'restore' } });
  assert.equal((await s.call('/messages?folder=inbox')).json.items.some(m => m.id === id), true);

  // settings never return passwords
  r = await s.call('/settings');
  assert.equal(r.json.settings.smtp.pass, undefined);
  assert.equal(r.json.settings.smtp.hasPass, true);

  // sign out ends the session
  await s.call('/logout', { method: 'POST' });
  assert.equal((await s.call('/messages')).status, 401);
});

test('sign-in tries are rate limited', async t => {
  const s = await start({ ADMIN_EMAIL: 'boss@example.com', ADMIN_PASSWORD: 'from-env-password', SMTP_HOST: 'test' });
  t.after(s.stop);
  assert.equal((await s.call('/status')).json.setupDone, true, 'env admin + SMTP_HOST skips setup');
  let last;
  for (let i = 0; i < 11; i++) last = await s.call('/login', { method: 'POST', body: { email: 'boss@example.com', password: 'wrong' } });
  assert.equal(last.status, 429);
});

test('requests from another site are refused', async t => {
  const s = await start();
  t.after(s.stop);
  const r = await s.call('/login', { method: 'POST', body: { email: 'a@b.co', password: 'x' }, headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('security helpers', () => {
  const h = hashPassword('correct horse');
  assert.ok(verifyPassword('correct horse', h));
  assert.ok(!verifyPassword('wrong', h));
  const e = encrypt('secret value', SECRET);
  assert.ok(e.startsWith('enc1:') && !e.includes('secret'));
  assert.equal(decrypt(e, SECRET), 'secret value');
  assert.equal(decrypt(e, 'y'.repeat(40)), '');
  const clean = sanitizeMailHtml('<div style="color:red">ok</div><iframe src="x"></iframe><form><input></form><style>@import url(x)</style><a href="https://a.b">l</a>');
  assert.ok(!/iframe|form|input|@import/.test(clean), clean);
  assert.ok(/target="_blank"/.test(clean) && /rel="noopener noreferrer nofollow"/.test(clean));
});
