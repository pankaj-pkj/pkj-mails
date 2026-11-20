/**
 * Makes a mail's HTML safe to show: no scripts, no forms, no event handlers, no javascript: links.
 * The page also shows it inside a sandboxed frame that cannot run scripts, so there are two walls.
 */
const sanitizeHtml = require('sanitize-html');

const OPTIONS = {
  allowedTags: [
    'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt',
    'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's',
    'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'style'
  ],
  allowedAttributes: {
    '*': ['style', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'dir', 'title', 'class', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    font: ['face', 'size', 'color']
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel', 'cid'],
  allowedSchemesByTag: { img: ['http', 'https', 'data', 'cid'] },
  allowProtocolRelative: false,
  allowVulnerableTags: true, // <style> is allowed; it only styles the mail inside its own sandboxed frame
  transformTags: {
    a: (tag, attribs) => ({ tagName: 'a', attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' } })
  },
  exclusiveFilter: frame => frame.tag === 'style' && /@import|expression\s*\(|javascript:/i.test(frame.text || '')
};

function sanitizeMailHtml(html) {
  return sanitizeHtml(String(html || ''), OPTIONS);
}

/** Plain text of a mail, for the snippet in the list. */
function htmlToText(html) {
  return sanitizeHtml(String(html || '').replace(/<(br|\/p|\/div|\/tr|\/h\d)\b[^>]*>/gi, '\n'), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function makeSnippet(text, html) {
  return String(text || htmlToText(html) || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function textToHtml(text) {
  return escapeHtml(text || '').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\r?\n/g, '<br>');
}

module.exports = { sanitizeMailHtml, htmlToText, makeSnippet, textToHtml, escapeHtml };
