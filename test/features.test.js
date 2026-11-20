/** Conversations, archive, branding, sessions and attack checks. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, signedIn, INBOUND } = require('./helpers');

const H = { 'content-type': 'message/rfc822', authorization: 'Bearer ' + INBOUND };
// headers carry whole seconds, so test mails get dates a little apart (the server caps a future date at "now")
const mime = (id, subject, extra = [], ahead = 0) => ['From: Ana <ana@example.com>', 'To: me@example.com', 'Subject: ' + subject, 'Message-ID: ' + id, ...extra, 'Date: ' + new Date(Date.now() + ahead).toUTCString(), '', 'body of ' + subject].join('\r\n');

test('conversations, archive, All Mail, contacts', async t => {
  const s = await signedIn();
  t.after(s.stop);
  const first = (await s.call('/inbound', { method: 'POST', raw: mime('<t1@example.com>', 'Plan', [], -5000), headers: H })).json.id;
  // my reply joins the conversation
  let r = await s.call('/send', { method: 'POST', body: { to: 'ana@example.com', subject: 'Re: Plan', text: 'ok', inReplyTo: '<t1@example.com>', references: '<t1@example.com>' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const sent = await s.db.get(r.json.id);
  assert.equal(sent.threadId, first, 'reply is in the same thread');
  // and her answer too
  await s.call('/inbound', { method: 'POST', raw: mime('<t2@example.com>', 'Re: Plan', ['In-Reply-To: ' + sent.messageId, 'References: <t1@example.com> ' + sent.messageId], 5000), headers: H });
  r = await s.call('/messages?folder=inbox');
  const row = r.json.items.find(i => i.threadId === first);
  assert.equal(row.count, 2, 'two inbox mails folded into one row');
  assert.equal(row.ids.length, 2);
  r = await s.call('/threads/' + first);
  assert.deepEqual(r.json.thread.messages.map(m => m.folder), ['inbox', 'sent', 'inbox'], 'thread shows inbox and sent mails, oldest first');

  // archive leaves the inbox but stays in All Mail; the sent copy is untouched
  await s.call('/messages/bulk', { method: 'POST', body: { ids: r.json.thread.messages.map(m => m.id), action: 'archive' } });
  assert.ok(!(await s.call('/messages?folder=inbox')).json.items.some(i => i.threadId === first));
  assert.ok((await s.call('/messages?folder=all')).json.items.some(i => i.threadId === first));
  assert.equal((await s.db.get(sent.id)).folder, 'sent');
  await s.call('/messages/bulk', { method: 'POST', body: { ids: [first], action: 'inbox' } });
  assert.equal((await s.db.get(first)).folder, 'inbox');

  // contacts learned from sending and receiving
  r = await s.call('/contacts?q=ana');
  assert.equal(r.json.contacts[0].address, 'ana@example.com');

  // a program as attachment is refused
  r = await s.call('/send', { method: 'POST', body: { to: 'a@b.co', subject: 'x', attachments: [{ name: 'setup.exe', data: 'TVo=' }] } });
  assert.equal(r.status, 400);
});

test('branding: name, colour, logo must be a real picture', async t => {
  const s = await signedIn();
  t.after(s.stop);
  const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
  let r = await s.call('/brand', { method: 'PUT', body: { name: 'Acme <b>Mail</b>', color: '#ff0000', logo: png } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.brand.name, 'Acme bMail/b', 'no HTML in the name');
  assert.equal(r.json.brand.color, '#ff0000');
  assert.equal(r.json.brand.hasLogo, true);
  r = await s.call('/brand', { method: 'PUT', body: { logo: 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') } });
  assert.equal(r.status, 400, 'a renamed file is refused');
  r = await s.call('/brand', { method: 'PUT', body: { logo: 'data:image/svg+xml;base64,PHN2Zz4=' } });
  assert.equal(r.status, 400, 'SVG (can carry scripts) is refused');
  r = await s.call('/brand', { method: 'PUT', body: { color: 'red;background:url(x)' } });
  assert.equal(r.json.brand.color, '', 'only #rrggbb colours');
  s.clearCookie();
  r = await s.call('/status');
  assert.equal(r.json.brand.name, 'Acme bMail/b', 'the sign-in page shows the brand');
  assert.equal(r.json.db, undefined, 'visitors do not learn the database type');
  r = await s.call('/brand', { method: 'PUT', body: { name: 'Hacked' } });
  assert.equal(r.status, 401, 'only the admin can change the brand');
});

test('sessions end on password change and on "sign out everywhere"', async t => {
  const s = await signedIn();
  t.after(s.stop);
  const stolen = s.cookie();
  let r = await s.call('/password', { method: 'POST', body: { current: 'a-long-password', next: 'another-long-password' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  s.setCsrf(r.json.csrf);
  assert.equal((await s.call('/counts')).status, 200, 'this browser stays signed in');
  assert.equal((await s.call('/counts', { headers: { cookie: stolen } })).status, 401, 'an old (stolen) cookie stops working');
  const second = s.cookie();
  r = await s.call('/sessions/end-all', { method: 'POST' });
  s.setCsrf(r.json.csrf);
  assert.equal((await s.call('/counts')).status, 200);
  assert.equal((await s.call('/counts', { headers: { cookie: second } })).status, 401);
});

test('attacks: bad ids, huge bodies before sign-in, fake IP addresses', async t => {
  const s = await signedIn({ TRUST_PROXY: '1' });
  t.after(s.stop);
  assert.equal((await s.call('/messages/..%2Fkv%2Fadmin')).status, 404);
  assert.equal((await s.call('/threads/' + encodeURIComponent('x" OR 1=1'))).status, 404);
  s.clearCookie();
  let r = await s.call('/login', { method: 'POST', raw: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200000) }), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 413, 'big bodies are refused before any work');
  r = await s.call('/send', { method: 'POST', raw: JSON.stringify({ to: 'x'.repeat(100000) }), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 401, 'not signed in: the body is not even read');
  // a new X-Forwarded-For on every try does not get around the lock
  let last;
  for (let i = 0; i < 31; i++) last = await s.call('/login', { method: 'POST', body: { email: 'me@example.com', password: 'guess' + i }, headers: { 'x-forwarded-for': '10.0.' + i + '.1' } });
  assert.equal(last.status, 429);
  r = await s.call('/login', { method: 'POST', body: { email: 'me@example.com', password: 'a-long-password' }, headers: { 'x-forwarded-for': '10.9.9.9' } });
  assert.equal(r.status, 429, 'paused for everybody until the hour passes');
});

test('a short SETUP_CODE is not used', async t => {
  const s = await start({ SETUP_CODE: 'abc' });
  t.after(s.stop);
  assert.equal((await s.call('/setup/check', { method: 'POST', body: { code: 'abc' } })).status, 403);
});
