/**
 * Passwords (scrypt), sessions (random id in an HttpOnly cookie, only its hash is stored), CSRF tokens,
 * rate limits and encryption of saved mail passwords (AES-256-GCM with a key made from APP_SECRET).
 */
const crypto = require('crypto');

// ---------------------------------------------------------------- passwords
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'base64');
  const want = Buffer.from(parts[3], 'base64');
  const got = crypto.scryptSync(String(password), salt, want.length, { N, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, want);
}
/** Compares two strings in constant time (for passwords kept in .env). */
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// ---------------------------------------------------------------- encryption of saved secrets
function keyFrom(secret) {
  return crypto.createHash('sha256').update('pkj-mails|' + String(secret)).digest();
}
function encrypt(text, secret) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'enc1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(blob, secret) {
  if (!blob || !String(blob).startsWith('enc1:')) return '';
  try {
    const raw = Buffer.from(String(blob).slice(5), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch (_) {
    return ''; // APP_SECRET changed: the saved password must be entered again
  }
}

// ---------------------------------------------------------------- sessions
const COOKIE = 'pkj_sid';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function createSessions(db) {
  const cache = new Map(); // hash -> session, so each request does not hit the database
  return {
    async create(email) {
      const sid = crypto.randomBytes(32).toString('base64url');
      const s = { email, exp: Date.now() + SESSION_MS, csrf: crypto.randomBytes(24).toString('base64url'), at: Date.now() };
      await db.kvSet('sess:' + sha(sid), s);
      cache.set(sha(sid), s);
      return { sid, session: s };
    },
    async read(sid) {
      if (!sid || sid.length > 100) return null;
      const h = sha(sid);
      let s = cache.get(h);
      if (!s) { s = await db.kvGet('sess:' + h); if (s) cache.set(h, s); }
      if (!s) return null;
      if (!(s.exp > Date.now())) { await this.destroy(sid); return null; }
      return s;
    },
    async destroy(sid) {
      if (!sid) return;
      const h = sha(sid);
      cache.delete(h);
      await db.kvDel('sess:' + h);
    },
    clearCache() { cache.clear(); }
  };
}

function readCookie(req, name = COOKIE) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { return ''; }
    }
  }
  return '';
}
function setSessionCookie(req, res, value, maxAgeMs) {
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// ---------------------------------------------------------------- rate limits
/** Allows `max` hits per `windowMs` for each key (usually the visitor's IP). */
function rateLimit({ windowMs, max, message = 'Too many tries. Please wait a few minutes and try again.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, Math.min(windowMs, 60000)).unref();
  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset < now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
    e.n++;
    if (e.n > max) {
      res.setHeader('Retry-After', Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({ ok: false, error: message });
    }
    next();
  };
}

// ---------------------------------------------------------------- headers
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // scripts only from this site; mail images may come from anywhere (they are shown inside a sandboxed frame)
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", 'img-src * data: blob:',
    "font-src 'self' data:", "connect-src 'self'", "frame-src 'self' blob: data:", "frame-ancestors 'none'",
    "form-action 'self'", "base-uri 'none'", "object-src 'none'"
  ].join('; '));
  next();
}

module.exports = { hashPassword, verifyPassword, safeEqual, encrypt, decrypt, createSessions, readCookie, setSessionCookie, rateLimit, securityHeaders, COOKIE, SESSION_MS };
