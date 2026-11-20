/**
 * Mail settings come from two places: the .env file (wins) and the setup page (saved in the database,
 * with passwords encrypted). This file merges them.
 */
const { encrypt, decrypt } = require('../security');

const bool = v => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d);

async function loadSettings(db, env, secret) {
  const saved = (await db.kvGet('settings')) || {};
  const s = saved.smtp || {};
  const i = saved.imap || {};
  const smtpHost = env.SMTP_HOST || s.host || '';
  const smtpPort = num(env.SMTP_PORT, num(s.port, 587));
  return {
    smtp: {
      host: smtpHost,
      port: smtpPort,
      secure: env.SMTP_SECURE ? bool(env.SMTP_SECURE) : s.secure !== undefined ? Boolean(s.secure) : smtpPort === 465,
      user: env.SMTP_USER || s.user || '',
      pass: env.SMTP_PASS || decrypt(s.pass, secret),
      from: (env.MAIL_FROM || s.from || env.SMTP_USER || s.user || '').trim(),
      fromName: (env.MAIL_FROM_NAME || s.fromName || '').trim(),
      fromEnv: Boolean(env.SMTP_HOST)
    },
    imap: {
      host: env.IMAP_HOST || i.host || '',
      port: num(env.IMAP_PORT, num(i.port, 993)),
      secure: i.secure !== undefined ? Boolean(i.secure) : true,
      user: env.IMAP_USER || i.user || '',
      pass: env.IMAP_PASS || decrypt(i.pass, secret),
      pollSeconds: Math.max(20, num(env.IMAP_POLL_SECONDS, num(i.pollSeconds, 60))),
      fromEnv: Boolean(env.IMAP_HOST)
    },
    signature: saved.signature || ''
  };
}

/** Saves what the setup or settings page sent. An empty password keeps the saved one. */
async function saveSettings(db, secret, input = {}) {
  const saved = (await db.kvGet('settings')) || {};
  const next = { ...saved };
  if (input.smtp) {
    const s = input.smtp;
    next.smtp = {
      host: String(s.host || '').trim().slice(0, 200),
      port: num(s.port, 587),
      secure: Boolean(s.secure),
      user: String(s.user || '').trim().slice(0, 200),
      pass: s.pass ? encrypt(String(s.pass), secret) : (saved.smtp && saved.smtp.pass) || '',
      from: String(s.from || '').trim().slice(0, 200),
      fromName: String(s.fromName || '').trim().slice(0, 80)
    };
  }
  if (input.imap) {
    const i = input.imap;
    next.imap = {
      host: String(i.host || '').trim().slice(0, 200),
      port: num(i.port, 993),
      secure: i.secure === undefined ? true : Boolean(i.secure),
      user: String(i.user || '').trim().slice(0, 200),
      pass: i.pass ? encrypt(String(i.pass), secret) : (saved.imap && saved.imap.pass) || '',
      pollSeconds: Math.max(20, num(i.pollSeconds, 60))
    };
  }
  if (input.signature !== undefined) next.signature = String(input.signature).slice(0, 2000);
  await db.kvSet('settings', next);
  return next;
}

/** What the browser may see: everything except the passwords. */
function publicSettings(st) {
  const strip = o => { const { pass, ...rest } = o; return { ...rest, hasPass: Boolean(pass) }; };
  return { smtp: strip(st.smtp), imap: strip(st.imap), signature: st.signature };
}

module.exports = { loadSettings, saveSettings, publicSettings, bool, num };
