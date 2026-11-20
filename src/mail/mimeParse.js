/**
 * Reads a raw email (as it arrives from an inbound webhook or IMAP) into the parts the inbox shows: who sent it, to
 * whom, the subject, the text and HTML bodies and the attachments.
 *
 * Written by hand so it needs no extra package. It handles what real
 * mail uses: nested multipart, base64 and quoted-printable, any charset the platform knows, encoded headers
 * (=?utf-8?B?...?=) and file names (filename*=utf-8''...). Anything it cannot read becomes an attachment, never an error.
 *
 * The raw bytes are kept as a "latin1" string while parsing: one character per byte, so slicing never breaks a
 * multi-byte character, and every piece goes back to bytes exactly.
 */

const MAX_DEPTH = 8;
const MAX_PARTS = 60;

function decodeCharset(buf, charset) {
  const cs = String(charset || 'utf-8').trim().toLowerCase().replace(/^["']|["']$/g, '');
  const name = cs === 'utf8' ? 'utf-8' : cs === 'ascii' || cs === 'us-ascii' ? 'utf-8' : cs;
  try {
    return new TextDecoder(name, { fatal: false }).decode(buf);
  } catch (_) {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
}

/** Quoted-printable to bytes. */
function qpDecode(str) {
  const s = str.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) {
      out.push(parseInt(s.substr(i + 1, 2), 16));
      i += 2;
    } else {
      out.push(s.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** Encoded words in a header: =?charset?B?...?= and =?charset?Q?...?= */
function decodeWords(value) {
  const v = String(value || '');
  // whitespace between two encoded words is not part of the text
  return v
    .replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?[^?]+\?[bBqQ]\?[^?]*\?=)/g, '$1')
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([bBqQ])\?([^?]*)\?=/g, (_, charset, enc, data) => {
      try {
        const bytes = enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : qpDecode(data.replace(/_/g, ' '));
        return decodeCharset(bytes, charset);
      } catch (_) {
        return data;
      }
    });
}

/** Header block (latin1 string) to a map of lower-case names to arrays of values, unfolded and decoded. */
function parseHeaders(block) {
  const headers = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    // headers may hold raw UTF-8 (SMTPUTF8); read the bytes as UTF-8, then the encoded words
    const raw = Buffer.from(line.slice(i + 1).trim(), 'latin1').toString('utf8');
    (headers[name] = headers[name] || []).push(raw);
  }
  return headers;
}
const first = (h, name) => (h[name] && h[name][0]) || '';

/** "text/html; charset=utf-8; name=..." to { value, params } (RFC 2231 continuations and charset'd values too). */
function parseParams(value) {
  const parts = [];
  let cur = '';
  let quoted = false;
  for (const ch of String(value || '')) {
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const params = {};
  const star = {};
  for (const p of parts.slice(1)) {
    const i = p.indexOf('=');
    if (i <= 0) continue;
    const key = p.slice(0, i).trim().toLowerCase();
    let val = p.slice(i + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\(.)/g, '$1');
    const m = key.match(/^([^*]+)\*(\d+)?(\*)?$/);
    if (m) {
      (star[m[1]] = star[m[1]] || []).push({ n: Number(m[2] || 0), enc: Boolean(m[3]) || (!m[2] && key.endsWith('*')), val });
    } else {
      params[key] = decodeWords(val);
    }
  }
  for (const [key, list] of Object.entries(star)) {
    list.sort((a, b) => a.n - b.n);
    let charset = 'utf-8';
    let joined = '';
    list.forEach((piece, idx) => {
      let v = piece.val;
      if (piece.enc) {
        if (idx === 0) {
          const q = v.split("'");
          if (q.length >= 3) { charset = q[0] || 'utf-8'; v = q.slice(2).join("'"); }
        }
        v = v.replace(/%([0-9A-Fa-f]{2})/g, (_, hx) => String.fromCharCode(parseInt(hx, 16)));
      }
      joined += v;
    });
    params[key] = decodeCharset(Buffer.from(joined, 'latin1'), charset);
  }
  return { value: String(parts[0] || '').trim().toLowerCase(), params };
}

/** "A <a@x.com>, \"B, Jr\" <b@y.com>, c@z.com" to [{ name, address }] */
function parseAddressList(value) {
  const v = decodeWords(value);
  const out = [];
  let cur = '';
  let quoted = false;
  let angle = 0;
  for (const ch of v) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '<') angle++;
    if (!quoted && ch === '>') angle = Math.max(0, angle - 1);
    if (ch === ',' && !quoted && angle === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const m = s.match(/^(.*)<([^>]+)>\s*$/);
      const address = (m ? m[2] : s).trim().replace(/^mailto:/i, '').toLowerCase();
      const name = m ? m[1].trim().replace(/^"|"$/g, '').trim() : '';
      return { name, address };
    })
    .filter(a => /^[^\s@<>]+@[^\s@<>]+$/.test(a.address));
}

function splitHeadBody(str) {
  const m = str.match(/\r?\n\r?\n/);
  if (!m) return { head: str, body: '' };
  return { head: str.slice(0, m.index), body: str.slice(m.index + m[0].length) };
}

function decodeBody(body, encoding) {
  const enc = String(encoding || '').trim().toLowerCase();
  if (enc === 'base64') return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (enc === 'quoted-printable') return qpDecode(body);
  return Buffer.from(body, 'latin1');
}

/** Walks one part; fills `acc` with text, html and attachments. */
function walk(str, acc, depth) {
  if (depth > MAX_DEPTH || acc.count++ > MAX_PARTS) return;
  const { head, body } = splitHeadBody(str);
  const h = parseHeaders(head);
  const ct = parseParams(first(h, 'content-type') || 'text/plain; charset=us-ascii');
  const cd = parseParams(first(h, 'content-disposition'));
  const encoding = first(h, 'content-transfer-encoding');

  if (ct.value.startsWith('multipart/') && ct.params.boundary) {
    const b = '--' + ct.params.boundary;
    const pieces = body.split(b);
    // pieces[0] is the preamble; the last one starts with "--" (the end marker)
    for (let i = 1; i < pieces.length; i++) {
      let piece = pieces[i];
      if (piece.startsWith('--')) break;
      piece = piece.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n$/, '');
      walk(piece, acc, depth + 1);
    }
    return;
  }

  const filename = cd.params.filename || ct.params.name || '';
  const isAttachment = cd.value === 'attachment' || (filename && !ct.value.startsWith('text/'));
  const bytes = decodeBody(body, encoding);
  const cid = first(h, 'content-id').replace(/^<|>$/g, '').trim();

  if (!isAttachment && ct.value === 'text/plain' && acc.text === null) {
    acc.text = decodeCharset(bytes, ct.params.charset);
  } else if (!isAttachment && ct.value === 'text/html' && acc.html === null) {
    acc.html = decodeCharset(bytes, ct.params.charset);
  } else if (!isAttachment && ct.value.startsWith('text/') && acc.text === null) {
    acc.text = decodeCharset(bytes, ct.params.charset);
  } else {
    acc.attachments.push({
      name: String(filename || (ct.value === 'message/rfc822' ? 'message.eml' : 'attachment')).replace(/[\\/\r\n"]/g, '_').slice(0, 180),
      type: ct.value || 'application/octet-stream',
      size: bytes.length,
      cid,
      inline: cd.value === 'inline' || Boolean(cid),
      data: bytes
    });
  }
}

function parseMail(raw) {
  const str = Buffer.isBuffer(raw) ? raw.toString('latin1') : Buffer.from(raw).toString('latin1');
  const { head } = splitHeadBody(str);
  const h = parseHeaders(head);
  const acc = { text: null, html: null, attachments: [], count: 0 };
  walk(str, acc, 0);
  const from = parseAddressList(first(h, 'from'))[0] || { name: '', address: '' };
  const dateMs = Date.parse(first(h, 'date'));
  return {
    from,
    to: parseAddressList((h.to || []).join(', ')),
    cc: parseAddressList((h.cc || []).join(', ')),
    replyTo: parseAddressList(first(h, 'reply-to'))[0] || null,
    subject: decodeWords(first(h, 'subject')).replace(/\s+/g, ' ').trim(),
    date: Number.isFinite(dateMs) ? dateMs : Date.now(),
    messageId: first(h, 'message-id').trim(),
    inReplyTo: first(h, 'in-reply-to').trim(),
    references: first(h, 'references').trim(),
    autoSubmitted: /auto-(generated|replied)/i.test(first(h, 'auto-submitted')) || /bulk|list|junk/i.test(first(h, 'precedence')),
    text: acc.text,
    html: acc.html,
    attachments: acc.attachments
  };
}

module.exports = { parseMail, parseAddressList, decodeWords, qpDecode, parseParams };
