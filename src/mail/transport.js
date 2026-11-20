/** Sending (SMTP through nodemailer) and receiving (IMAP polling through imapflow). */
const nodemailer = require('nodemailer');

/** SMTP_HOST=test (used by the tests) keeps mail in memory instead of sending it. */
function makeTransport(smtp) {
  if (smtp.host === 'test') return nodemailer.createTransport({ jsonTransport: true });
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  });
}

/** Turns a raw error into a sentence a non-technical person can act on. */
function friendlyError(err, kind = 'SMTP') {
  const m = String((err && (err.response || err.message)) || err || '');
  const code = err && err.code;
  if (code === 'EAUTH' || /535|auth|credentials|username and password|invalid login/i.test(m)) {
    return `${kind} login failed. Check the username and password. For Gmail you must use an "App password", not your normal password.`;
  }
  if (code === 'ENOTFOUND' || /getaddrinfo/i.test(m)) return `${kind} server name not found. Check the host (for example smtp.gmail.com).`;
  if (code === 'ECONNREFUSED') return `${kind} server refused the connection. Check the port number.`;
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || /timeout/i.test(m)) return `${kind} server did not answer. Check the port and the "secure" switch (465 = secure ON, 587 = secure OFF). Some hosts block mail ports.`;
  if (/wrong version number|ssl/i.test(m)) return `The "secure" switch does not match the port. Use secure ON with port 465 (or 993 for IMAP), OFF with 587.`;
  if (/sender|from address|not verified|domain/i.test(m)) return `The provider did not accept the "From" address. Use an address your provider has verified.`;
  return `${kind} error: ${m.slice(0, 200)}`;
}

async function testSmtp(smtp, to) {
  if (!smtp.host) throw new Error('Fill in the SMTP host first.');
  const t = makeTransport(smtp);
  try {
    if (smtp.host !== 'test') await t.verify();
    if (to) {
      await t.sendMail({
        from: smtp.fromName ? { name: smtp.fromName, address: smtp.from } : smtp.from,
        to,
        subject: 'PKJ Mails test',
        text: 'If you can read this, sending mail from PKJ Mails works.'
      });
    }
  } catch (err) {
    throw new Error(friendlyError(err, 'SMTP'));
  } finally {
    t.close();
  }
}

function loadImapFlow() {
  try { return require('imapflow').ImapFlow; } catch (_) { throw new Error('IMAP needs the "imapflow" package. Run:  npm install imapflow'); }
}
function imapClient(imap) {
  const ImapFlow = loadImapFlow();
  return new ImapFlow({ host: imap.host, port: imap.port, secure: imap.secure, auth: { user: imap.user, pass: imap.pass }, logger: false, socketTimeout: 60000 });
}

async function testImap(imap) {
  if (!imap.host) throw new Error('Fill in the IMAP host first.');
  const c = imapClient(imap);
  try {
    await c.connect();
    const box = await c.mailboxOpen('INBOX', { readOnly: true });
    return { messages: box.exists };
  } catch (err) {
    throw new Error(friendlyError(err, 'IMAP'));
  } finally {
    try { await c.logout(); } catch (_) {}
  }
}

/**
 * Fetches mail newer than the last one seen. The first run only takes the newest `firstRunLimit`
 * mails so an old mailbox does not flood the inbox.
 */
async function fetchNewImap(imap, state, onMessage, firstRunLimit = 50) {
  const c = imapClient(imap);
  await c.connect();
  try {
    const lock = await c.getMailboxLock('INBOX');
    try {
      const box = c.mailbox;
      let lastUid = state.uidValidity === String(box.uidValidity) ? Number(state.lastUid) || 0 : 0;
      if (!lastUid && box.uidNext > 1) lastUid = Math.max(0, box.uidNext - 1 - firstRunLimit);
      let maxUid = lastUid;
      if (box.uidNext - 1 > lastUid) {
        for await (const msg of c.fetch({ uid: `${lastUid + 1}:*` }, { uid: true, source: true }, { uid: true })) {
          if (msg.uid <= lastUid) continue;
          await onMessage(msg.source);
          maxUid = Math.max(maxUid, msg.uid);
        }
      }
      return { uidValidity: String(box.uidValidity), lastUid: maxUid };
    } finally {
      lock.release();
    }
  } finally {
    try { await c.logout(); } catch (_) {}
  }
}

module.exports = { makeTransport, testSmtp, testImap, fetchNewImap, friendlyError };
