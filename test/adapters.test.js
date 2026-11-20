/**
 * The same checks run against every storage adapter.
 * memory and sqlite always run. MongoDB, PostgreSQL, MySQL and Firebase run only when you give a test database:
 *   TEST_MONGODB_URL, TEST_POSTGRES_URL, TEST_MYSQL_URL, TEST_FIREBASE_URL (+ TEST_FIREBASE_SECRET)
 * Use an EMPTY test database: the tests write to it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createAdapter } = require('../src/db');
const { newId, parseSearch } = require('../src/db/query');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkj-test-'));
const targets = [
  ['memory', { DB_TYPE: 'memory' }],
  ['sqlite', { DB_TYPE: 'sqlite', SQLITE_FILE: path.join(tmp, 'a.db') }],
  ['mongodb', process.env.TEST_MONGODB_URL && { DB_TYPE: 'mongodb', DATABASE_URL: process.env.TEST_MONGODB_URL }],
  ['postgres', process.env.TEST_POSTGRES_URL && { DB_TYPE: 'postgres', DATABASE_URL: process.env.TEST_POSTGRES_URL }],
  ['mysql', process.env.TEST_MYSQL_URL && { DB_TYPE: 'mysql', DATABASE_URL: process.env.TEST_MYSQL_URL }],
  ['firebase', process.env.TEST_FIREBASE_URL && { DB_TYPE: 'firebase', FIREBASE_DB_URL: process.env.TEST_FIREBASE_URL, FIREBASE_DB_SECRET: process.env.TEST_FIREBASE_SECRET }]
];

function mail(over = {}) {
  return {
    id: newId(over.date || Date.now()), folder: 'inbox', from: 'ana@example.com', fromName: 'Ana', to: ['me@example.com'],
    subject: 'Hello', snippet: 'Just saying hi', text: 'Just saying hi', html: '<p>Just saying hi</p>',
    date: Date.now(), read: false, starred: false, labels: [], attachments: [], messageId: '<' + Math.random() + '@x>', ...over
  };
}

for (const [name, env] of targets) {
  test(`adapter: ${name}`, { skip: !env && `set TEST_${name.toUpperCase()}_URL to run` }, async t => {
    const db = createAdapter(env);
    await db.init();
    t.after(() => db.close());

    await t.test('key/value store', async () => {
      assert.equal(await db.kvGet('nope'), null);
      await db.kvSet('settings', { a: 1, b: { c: 'x.y' } });
      assert.deepEqual(await db.kvGet('settings'), { a: 1, b: { c: 'x.y' } });
      await db.kvSet('settings', { a: 2 });
      assert.deepEqual(await db.kvGet('settings'), { a: 2 });
      await db.kvSet('sess:abc', { exp: 5 });
      await db.kvDel('sess:abc');
      assert.equal(await db.kvGet('sess:abc'), null);
    });

    const a = mail({ date: Date.now() - 3000, subject: 'Invoice for March', attachments: [{ name: 'a.pdf', type: 'application/pdf', size: 3, data: 'YWJj' }] });
    const b = mail({ date: Date.now() - 2000, from: 'bob@example.com', fromName: 'Bob', subject: 'Lunch?', read: true });
    const c = mail({ date: Date.now() - 1000, folder: 'sent', from: 'me@example.com', to: ['zed@example.com'], subject: 'Report', read: true });

    await t.test('insert, get, list order', async () => {
      for (const m of [a, b, c]) await db.insert(m);
      const got = await db.get(a.id);
      assert.equal(got.subject, 'Invoice for March');
      assert.equal(got.html, '<p>Just saying hi</p>');
      assert.equal(got.attachments[0].data, 'YWJj');
      const inbox = await db.list({ folder: 'inbox' });
      assert.equal(inbox.total, 2);
      assert.deepEqual(inbox.items.map(i => i.id), [b.id, a.id]); // newest first
      assert.equal(inbox.items[0].html, undefined); // lists carry no body
      assert.equal(inbox.items[1].hasAttachments, true);
    });

    await t.test('update, star, labels, counts', async () => {
      await db.update(a.id, { starred: true, labels: ['Work'] });
      assert.equal((await db.list({ starred: true })).total, 1);
      assert.equal((await db.list({ label: 'Work' })).items[0].id, a.id);
      const counts = await db.counts();
      assert.equal(counts.inbox.total, 2);
      assert.equal(counts.inbox.unread, 1);
      assert.equal(counts.sent.total, 1);
      assert.equal(counts.starred.total, 1);
    });

    await t.test('search', async () => {
      assert.deepEqual((await db.list({ q: 'invoice' })).items.map(i => i.id), [a.id]);
      assert.deepEqual((await db.list({ q: 'from:bob' })).items.map(i => i.id), [b.id]);
      assert.deepEqual((await db.list({ q: 'to:zed' })).items.map(i => i.id), [c.id]);
      assert.deepEqual((await db.list({ q: 'is:unread' })).items.map(i => i.id), [a.id]);
      assert.deepEqual((await db.list({ q: 'has:attachment' })).items.map(i => i.id), [a.id]);
      assert.equal((await db.list({ q: 'nothing-matches-this' })).total, 0);
    });

    await t.test('trash, find by message id, remove, paging', async () => {
      await db.update(b.id, { folder: 'trash', trashedAt: Date.now() - 40 * 86400000 });
      assert.equal((await db.list({ q: 'lunch' })).total, 0); // search skips the bin
      assert.deepEqual(await db.idsInFolderOlderThan('trash', Date.now() - 30 * 86400000), [b.id]);
      assert.equal((await db.findByMessageId(c.messageId)).id, c.id);
      await db.remove(b.id);
      assert.equal(await db.get(b.id), null);
      const page = await db.list({ folder: 'inbox', limit: 1, offset: 0 });
      assert.equal(page.items.length, 1);
    });
  });
}

test('search parser', () => {
  assert.deepEqual(parseSearch('from:ana is:unread "big deal" x'), { text: ['big deal', 'x'], from: 'ana', unread: true });
  assert.deepEqual(parseSearch('has:attachment subject:"Q1 plan"'), { text: [], hasAttachment: true, subject: 'q1 plan' });
});
