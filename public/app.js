/* PKJ Mails - the whole inbox page. Plain JavaScript, no build step. Talks only to /api.
   Safety rule for this file: text from mails is only ever put on the page as text (textContent), never as HTML.
   A mail's own HTML is shown only inside a sandboxed frame that cannot run scripts. */
(function () {
  'use strict';

  // ------------------------------------------------------------------ tiny helpers
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const ICONS = {
    menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
    search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    pencil: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    inbox: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H5V5h14v10z',
    star: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
    starFill: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
    send: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
    draft: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
    spam: 'M15.73 3H8.27L3 8.27v7.46L8.27 21h7.46L21 15.73V8.27L15.73 3zM12 17.3c-.72 0-1.3-.58-1.3-1.3s.58-1.3 1.3-1.3 1.3.58 1.3 1.3-.58 1.3-1.3 1.3zm1-4.3h-2V7h2v6z',
    trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
    label: 'M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z',
    plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
    refresh: 'M17.65 6.35A7.958 7.958 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
    replyAll: 'M7 8V5l-7 7 7 7v-3l-4-4 4-4zm6 1V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
    forward: 'M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z',
    unread: 'M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z',
    read: 'M21.99 8c0-.72-.37-1.35-.94-1.7L12 1 2.95 6.3C2.38 6.65 2 7.28 2 8v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2l-.01-10zM12 13 3.74 7.84 12 3l8.26 4.84L12 13z',
    archive: 'M20.54 5.23 19.15 3.55C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5 6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z',
    unarchive: 'M20.55 5.22 19.16 3.54C18.89 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.15.55L3.46 5.22C3.17 5.57 3 6.01 3 6.5V19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.49-.17-.93-.45-1.28zM12 9.5l5.5 5.5H14v2h-4v-2H6.5L12 9.5zM5.12 5l.82-1h12l.93 1H5.12z',
    allmail: 'M22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6zm-2 0-8 5-8-5h16zm0 12H4V8l8 5 8-5v10z',
    settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
    moon: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z',
    sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM2 13h2a1 1 0 0 0 0-2H2a1 1 0 0 0 0 2zm18 0h2a1 1 0 0 0 0-2h-2a1 1 0 0 0 0 2zM11 2v2a1 1 0 0 0 2 0V2a1 1 0 0 0-2 0zm0 18v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-2 0zM5.99 4.58a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41L5.99 4.58zm12.37 12.37a1 1 0 0 0-1.41 1.41l1.06 1.06a1 1 0 0 0 1.41-1.41l-1.06-1.06zm1.06-10.96a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06zM7.05 18.36a1 1 0 0 0-1.41-1.41l-1.06 1.06a1 1 0 0 0 1.41 1.41l1.06-1.06z',
    logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
    attach: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
    min: 'M6 19h12v2H6z',
    max: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    restore: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18z',
    bold: 'M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z',
    italic: 'M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4z',
    underline: 'M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zm-7 2v2h14v-2H5z',
    list: 'M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z',
    link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
    more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    left: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
    right: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
    file: 'M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z',
    notspam: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
    bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z'
  };
  const icon = (name, cls = 'ic') => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', cls);
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', ICONS[name] || '');
    s.append(p);
    return s;
  };
  const iconBtn = (name, title, onclick, cls = '') => h('button', { class: 'icon-btn ' + cls, title, 'aria-label': title, type: 'button', onclick }, icon(name));

  const AVATAR = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#007b83', '#c5221f', '#b06000', '#5f6368', '#e8710a', '#0b8043', '#3f51b5'];
  const avatarColor = s => AVATAR[[...String(s || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR.length];
  const initial = s => (String(s || '?').trim()[0] || '?').toUpperCase();
  const avatar = (name, cls = '') => h('div', { class: 'avatar ' + cls, style: `background:${avatarColor(name)}` }, initial(name));
  const fmtBytes = n => (n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  function shortTime(ms) {
    const d = new Date(ms); const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' hours ago';
    return Math.round(s / 86400) + ' days ago';
  }
  const longTime = ms => new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  };
  /** Mail HTML going into the compose box (part of this page): drop everything but plain formatting. */
  function safeQuote(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script,style,link,meta,base,iframe,frame,object,embed,form,input,button,textarea,select,svg,math,template,noscript').forEach(e => e.remove());
    doc.querySelectorAll('*').forEach(el => {
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        const v = a.value.replace(/\s/g, '').toLowerCase();
        if (n.startsWith('on') || n === 'class' || n === 'id' || ((n === 'href' || n === 'src') && !/^(https?:|mailto:|data:image\/)/.test(v))) el.removeAttribute(a.name);
      }
    });
    return doc.body ? doc.body.innerHTML : '';
  }

  // ------------------------------------------------------------------ api
  let csrf = null;
  async function api(path, { method = 'GET', body } = {}) {
    const init = { method, credentials: 'same-origin', cache: 'no-store', headers: { 'x-pkj': '1' } };
    if (csrf) init.headers['x-csrf-token'] = csrf;
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetch('/api' + path, init); } catch (_) { return { ok: false, status: 0, error: 'No connection to the server. Check your internet, or that the app is running.' }; }
    let j = {};
    try { j = await res.json(); } catch (_) {}
    if (res.status === 401 && j.code === 'SIGNED_OUT' && state.signedIn) { state.signedIn = false; csrf = null; boot(); }
    return { ...j, ok: res.ok && j.ok !== false, status: res.status, error: j.error || (res.ok ? '' : 'Error ' + res.status) };
  }

  // ------------------------------------------------------------------ state
  const state = {
    signedIn: false, email: '', address: '', name: '', signature: '',
    brand: { name: 'PKJ Mails', color: '', hasLogo: false, v: 0 },
    view: { folder: 'inbox', label: null, q: '', page: 1 },
    items: [], total: 0, counts: {}, labels: [], threads: true,
    selected: new Set(), openId: null, open: null,
    collapsed: store.get('pkj-collapsed', false)
  };
  const FOLDERS = [
    { id: 'inbox', name: 'Inbox', icon: 'inbox', badge: 'unread' },
    { id: 'starred', name: 'Starred', icon: 'star' },
    { id: 'sent', name: 'Sent', icon: 'send' },
    { id: 'drafts', name: 'Drafts', icon: 'draft', badge: 'total' },
    { id: 'all', name: 'All Mail', icon: 'allmail' },
    { id: 'spam', name: 'Spam', icon: 'spam', badge: 'unread' },
    { id: 'trash', name: 'Trash', icon: 'trash' }
  ];
  const root = () => document.getElementById('root');
  const keyOf = m => m.threadId || m.id; // one row = one conversation

  // ------------------------------------------------------------------ theme and branding
  function setTheme(t) {
    store.set('pkj-theme-raw', t);
    try { localStorage.setItem('pkj-theme', t); } catch (_) {}
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    if (state.open) renderReader();
  }
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';
  const logoUrl = () => '/brand/logo?v=' + (state.brand.v || 0);
  function applyBrand(b) {
    if (b) state.brand = b;
    const de = document.documentElement;
    if (state.brand.color) { de.style.setProperty('--brand', state.brand.color); de.setAttribute('data-brand', ''); }
    else { de.style.removeProperty('--brand'); de.removeAttribute('data-brand'); }
    let fav = document.querySelector('link[rel="icon"]');
    if (fav) { fav.href = logoUrl(); fav.removeAttribute('type'); }
    document.querySelectorAll('[data-brand-logo]').forEach(i => { i.src = logoUrl(); });
    document.querySelectorAll('[data-brand-name]').forEach(e => { e.textContent = state.brand.name; });
  }
  const brandLogo = cls => h('img', { class: cls, src: logoUrl(), alt: '', 'data-brand-logo': '' });

  // ------------------------------------------------------------------ toast, menu, dialog
  let toastTimer;
  function toast(text, action, ms) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = h('div', { class: 'toast', role: 'status' }, h('span', null, text), action ? h('button', { onclick: () => { t.remove(); action.run(); } }, action.label) : null,
      h('button', { class: 'toast-x', 'aria-label': 'Close', onclick: () => t.remove() }, '✕'));
    document.body.append(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), ms || (action ? 7000 : 4000));
    return t;
  }
  function closeMenus() { document.querySelectorAll('.menu').forEach(m => m.remove()); }
  function menu(anchor, items, at) {
    closeMenus();
    const m = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map(it => it === '-' ? h('hr') : h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenus(); it.run(); } }, it.icon ? icon(it.icon) : h('span', { class: 'ic' }), it.label)));
    document.body.append(m);
    const r = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y } : anchor.getBoundingClientRect();
    const w = m.offsetWidth; const hgt = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    m.style.top = (r.bottom + hgt + 8 > innerHeight ? Math.max(8, r.top - hgt - 4) : r.bottom + 4) + 'px';
    setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
  }
  function dialog(content) {
    const s = h('div', { class: 'scrim', onclick: e => { if (e.target === s) close(); } }, h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, content));
    function close() { s.remove(); document.removeEventListener('keydown', esc); }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    document.body.append(s);
    return close;
  }
  function inp(label, props = {}, hint) {
    const { tag, options, ...rest } = props;
    const el = tag === 'textarea' ? h('textarea', rest) : tag === 'select' ? h('select', rest, (options || []).map(o => h('option', { value: o[0] }, o[1]))) : h('input', rest);
    if (tag === 'select' || tag === 'textarea') el.value = rest.value || '';
    return { wrap: h('label', { class: 'inp' }, h('span', null, label), el, hint ? h('small', null, hint) : null), el };
  }
  const note = (text, kind = '') => h('div', { class: 'note ' + kind }, text);

  // ------------------------------------------------------------------ mail settings form (setup page + settings dialog)
  const PRESETS = {
    Gmail: { smtp: { host: 'smtp.gmail.com', port: 465, secure: true }, imap: { host: 'imap.gmail.com', port: 993 }, hint: 'Use your full Gmail address as username and a Gmail "App password" (Google Account > Security > 2-Step Verification > App passwords). Your normal password will not work.' },
    Outlook: { smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false }, imap: { host: 'outlook.office365.com', port: 993 }, hint: 'Username is your full Outlook address.' },
    Zoho: { smtp: { host: 'smtp.zoho.com', port: 465, secure: true }, imap: { host: 'imap.zoho.com', port: 993 }, hint: 'Zoho needs IMAP turned on in Zoho Mail settings.' },
    Brevo: { smtp: { host: 'smtp-relay.brevo.com', port: 587, secure: false }, hint: 'Brevo > SMTP & API > SMTP tab: the login and an SMTP key. The From address must be a sender verified in Brevo.' },
    Resend: { smtp: { host: 'smtp.resend.com', port: 465, secure: true, user: 'resend' }, hint: 'Username is "resend", password is your Resend API key. The From domain must be verified in Resend.' },
    Yahoo: { smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true }, imap: { host: 'imap.mail.yahoo.com', port: 993 }, hint: 'Yahoo needs an app password from Account security.' }
  };
  function mailForm(current = {}, { testSmtp, testImap, lockSmtp, lockImap } = {}) {
    const s = current.smtp || {}; const i = current.imap || {};
    const f = {
      host: inp('SMTP server (host)', { value: s.host || '', placeholder: 'smtp.gmail.com', autocomplete: 'off' }),
      port: inp('Port', { value: s.port || 465, type: 'number', min: 1, max: 65535 }),
      user: inp('Username', { value: s.user || '', placeholder: 'you@gmail.com', autocomplete: 'off' }),
      pass: inp('Password / App password / API key', { type: 'password', placeholder: s.hasPass ? '•••••••• saved (leave empty to keep)' : '', autocomplete: 'new-password' }),
      from: inp('Send from (your email address)', { value: s.from || '', placeholder: 'you@gmail.com', type: 'email' }),
      fromName: inp('Your name (shown to people)', { value: s.fromName || '', placeholder: 'Your Name' }),
      ihost: inp('IMAP server (host)', { value: i.host || '', placeholder: 'imap.gmail.com (leave empty to skip)', autocomplete: 'off' }),
      iport: inp('Port', { value: i.port || 993, type: 'number' }),
      iuser: inp('Username', { value: i.user || '', autocomplete: 'off' }),
      ipass: inp('Password / App password', { type: 'password', placeholder: i.hasPass ? '•••••••• saved (leave empty to keep)' : '', autocomplete: 'new-password' })
    };
    const secure = h('input', { type: 'checkbox', checked: s.secure !== undefined ? s.secure : true });
    const hint = h('div', { class: 'note hidden' });
    const smtpMsg = h('div'); const imapMsg = h('div');
    f.port.el.addEventListener('change', () => { const p = Number(f.port.el.value); if (p === 465) secure.checked = true; if (p === 587 || p === 25 || p === 2525) secure.checked = false; });
    f.user.el.addEventListener('input', () => { if (!f.from.el.dataset.touched && /@/.test(f.user.el.value)) f.from.el.value = f.user.el.value; if (!f.iuser.el.dataset.touched) f.iuser.el.value = f.user.el.value; });
    f.from.el.addEventListener('input', () => { f.from.el.dataset.touched = '1'; });
    f.iuser.el.addEventListener('input', () => { f.iuser.el.dataset.touched = '1'; });
    function applyPreset(name) {
      const p = PRESETS[name];
      f.host.el.value = p.smtp.host; f.port.el.value = p.smtp.port; secure.checked = p.smtp.secure;
      if (p.smtp.user) f.user.el.value = p.smtp.user;
      if (p.imap) { f.ihost.el.value = p.imap.host; f.iport.el.value = p.imap.port; } else { f.ihost.el.value = ''; }
      hint.textContent = p.hint; hint.classList.remove('hidden');
    }
    const values = () => ({
      smtp: { host: f.host.el.value.trim(), port: Number(f.port.el.value), secure: secure.checked, user: f.user.el.value.trim(), pass: f.pass.el.value, from: f.from.el.value.trim(), fromName: f.fromName.el.value.trim() },
      imap: { host: f.ihost.el.value.trim(), port: Number(f.iport.el.value), secure: true, user: f.iuser.el.value.trim(), pass: f.ipass.el.value }
    });
    async function runTest(kind, btn) {
      const box = kind === 'smtp' ? smtpMsg : imapMsg;
      btn.disabled = true; box.replaceChildren(note('Testing… this can take up to 30 seconds.'));
      const v = values();
      const r = kind === 'smtp' ? await testSmtp(v.smtp, v.smtp.from) : await testImap(v.imap);
      btn.disabled = false;
      box.replaceChildren(r.ok ? note(kind === 'smtp' ? `✓ Sending works. A test mail was sent to ${v.smtp.from}.` : `✓ Receiving works. ${r.messages} mails found in the mailbox; new ones will appear in your inbox.`, 'good') : note('✗ ' + r.error, 'err'));
    }
    const smtpPart = lockSmtp ? note('Sending (SMTP) is set in the .env file on the server. Change it there.') : h('div', { class: 'form' },
      h('div', null, h('div', { class: 'inp' }, h('span', null, 'Quick fill for your provider')), h('div', { class: 'presets' }, Object.keys(PRESETS).map(n => h('button', { class: 'btn', type: 'button', onclick: () => applyPreset(n) }, n)))),
      hint,
      h('div', { class: 'two' }, f.host.wrap, f.port.wrap),
      h('label', { class: 'switch' }, secure, 'Secure connection (SSL) — ON for port 465, OFF for 587'),
      f.user.wrap, f.pass.wrap, f.from.wrap, f.fromName.wrap,
      h('div', null, h('button', { class: 'btn', type: 'button', onclick: e => runTest('smtp', e.currentTarget) }, 'Send a test mail')), smtpMsg);
    const imapPart = lockImap ? note('Receiving (IMAP) is set in the .env file on the server.') : h('div', { class: 'form' },
      h('p', { class: 'sub', style: 'margin:0' }, 'Optional. The app checks this mailbox every minute and copies new mail into your inbox. You can also receive mail with a webhook instead (see the README).'),
      h('div', { class: 'two' }, f.ihost.wrap, f.iport.wrap), f.iuser.wrap, f.ipass.wrap, h('div', null, h('button', { class: 'btn', type: 'button', onclick: e => runTest('imap', e.currentTarget) }, 'Test receiving')), imapMsg);
    return { smtpPart, imapPart, values };
  }

  // ------------------------------------------------------------------ first-run setup
  function renderSetup(status) {
    document.body.classList.add('scroll');
    let step = 0;
    let code = '';
    const data = { admin: {}, smtp: null, imap: null, brandName: '' };
    const card = h('div', { class: 'card wide' });
    root().replaceChildren(h('div', { class: 'center-page' }, card));
    const testSmtp = (smtp, to) => api('/setup/test-smtp', { method: 'POST', body: { code, smtp, to } });
    const testImap = imap => api('/setup/test-imap', { method: 'POST', body: { code, imap } });
    const steps = ['code', status.adminFromEnv ? 'name' : 'admin', status.smtpFromEnv ? null : 'send', 'receive', 'done'].filter(Boolean);
    let form = null;
    function draw() {
      const name = steps[step];
      const bar = h('div', { class: 'steps' }, steps.map((_, i) => h('i', { class: i <= step ? 'on' : '' })));
      const err = h('div');
      const head = (t, sub) => [brandLogo('logo'), h('h1', null, t), h('p', { class: 'sub' }, sub), bar];
      const next = h('button', { class: 'btn primary', type: 'submit' }, name === 'receive' ? 'Finish setup' : 'Next');
      const back = step > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => { step--; draw(); } }, 'Back') : null;
      let body; let onNext;
      if (name === 'code') {
        const c = inp('Setup code', { value: code, autocomplete: 'off', required: true, placeholder: 'for example 3f9a1c2b7d10' }, 'Find it in the server log: the black window where you ran "npm start", or the Logs tab on Render. It is printed as "Setup code: ...". You can also set SETUP_CODE in .env.');
        body = [c.wrap];
        onNext = async () => {
          code = c.el.value.trim();
          const r = await api('/setup/check', { method: 'POST', body: { code } });
          if (!r.ok) throw new Error(r.error);
          return true;
        };
        setTimeout(() => c.el.focus(), 0);
        card.replaceChildren(...head('Welcome!', 'Let\'s set up your own mail app. It takes about 3 minutes.'));
      } else if (name === 'admin' || name === 'name') {
        const n = inp('Name of your mail app', { value: data.brandName || state.brand.name, maxLength: 40 }, 'Shown at the top of the page and on the sign-in screen. You can change it, the logo and the colour later in Settings > Branding.');
        const e = inp('Your email (used to sign in)', { type: 'email', value: data.admin.email || '', required: true, autocomplete: 'username' });
        const p = inp('Choose a password', { type: 'password', required: true, minLength: 10, maxLength: 200, autocomplete: 'new-password' }, 'At least 10 characters. Keep it safe: this protects all your mail.');
        const p2 = inp('Type the password again', { type: 'password', required: true, autocomplete: 'new-password' });
        body = name === 'admin' ? [n.wrap, e.wrap, p.wrap, p2.wrap] : [n.wrap];
        onNext = async () => {
          data.brandName = n.el.value.trim();
          if (name === 'name') return true;
          if (p.el.value.length < 10) throw new Error('The password must be at least 10 characters.');
          if (p.el.value !== p2.el.value) throw new Error('The two passwords are not the same.');
          data.admin = { email: e.el.value.trim(), password: p.el.value };
          return true;
        };
        card.replaceChildren(...head(name === 'admin' ? 'Create your admin login' : 'Name your mail app', name === 'admin' ? 'Only this login can open the inbox.' : 'The admin login is set in the .env file.'));
      } else if (name === 'send') {
        form = form || mailForm({ smtp: { from: data.admin.email, user: data.admin.email } }, { testSmtp, testImap });
        body = [form.smtpPart];
        onNext = async () => {
          const v = form.values();
          if (!v.smtp.host || !v.smtp.from) throw new Error('Fill in at least the SMTP server and the "Send from" address.');
          data.smtp = v.smtp;
          return true;
        };
        card.replaceChildren(...head('How should mail be sent?', 'Pick your provider below, then fill the username and password. Press "Send a test mail" to check it.'));
      } else if (name === 'receive') {
        form = form || mailForm({}, { testSmtp, testImap, lockSmtp: true });
        body = [form.imapPart];
        onNext = async () => {
          const v = form.values();
          data.imap = v.imap.host ? v.imap : null;
          const r = await api('/setup/finish', { method: 'POST', body: { code, admin: data.admin, smtp: data.smtp, imap: data.imap, brandName: data.brandName } });
          if (!r.ok) throw new Error(r.error);
          return true;
        };
        card.replaceChildren(...head('How should mail arrive?', 'Optional: connect a mailbox by IMAP. You can skip this and set it later in Settings.'));
      } else {
        card.replaceChildren(...head('All done! 🎉', 'Your inbox is ready. Sign in with the email and password you just chose.'),
          h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => boot() }, 'Go to sign in')));
        return;
      }
      card.append(h('form', { class: 'form', onsubmit: async ev => {
        ev.preventDefault(); err.replaceChildren(); next.disabled = true;
        try { if (await onNext()) { step++; draw(); } } catch (x) { err.replaceChildren(note(x.message, 'err')); } finally { next.disabled = false; }
      } }, body, err, h('div', { class: 'actions' }, back, next)));
    }
    draw();
  }

  // ------------------------------------------------------------------ sign in
  function renderLogin() {
    document.body.classList.add('scroll');
    const e = inp('Email', { type: 'email', required: true, autocomplete: 'username' });
    const p = inp('Password', { type: 'password', required: true, autocomplete: 'current-password' });
    const show = h('label', { class: 'switch' }, h('input', { type: 'checkbox', onchange: ev => { p.el.type = ev.target.checked ? 'text' : 'password'; } }), 'Show password');
    const err = h('div');
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
    const form = h('form', { class: 'form', onsubmit: async ev => {
      ev.preventDefault(); btn.disabled = true; err.replaceChildren();
      const r = await api('/login', { method: 'POST', body: { email: e.el.value, password: p.el.value } });
      btn.disabled = false;
      if (!r.ok) { err.replaceChildren(note(r.error, 'err')); return; }
      boot();
    } }, e.wrap, p.wrap, show, err, h('div', { class: 'actions' }, btn));
    root().replaceChildren(h('div', { class: 'center-page' }, h('div', { class: 'card' },
      brandLogo('logo'), h('h1', null, 'Sign in'), h('p', { class: 'sub' }, 'to continue to ', h('b', { 'data-brand-name': '' }, state.brand.name)), form,
      h('p', { class: 'foot-links' }, 'Forgot the password? See "Reset the admin password" in the README.'))));
    setTimeout(() => e.el.focus(), 0);
  }

  // ------------------------------------------------------------------ the inbox shell
  const els = {};
  function renderShell() {
    document.body.classList.remove('scroll');
    const search = h('input', { type: 'search', placeholder: 'Search mail', 'aria-label': 'Search mail', value: state.view.q, onkeydown: e => {
      if (e.key === 'Enter') { go({ folder: null, q: search.value.trim() }); search.blur(); }
      if (e.key === 'Escape') { search.value = ''; search.blur(); }
    } });
    const themeBtn = () => { const b = iconBtn(isDark() ? 'sun' : 'moon', 'Switch light / dark', () => { setTheme(isDark() ? 'light' : 'dark'); b.replaceWith(themeBtn()); }); return b; };
    const me = h('button', { class: 'icon-btn', title: state.email, 'aria-label': 'Account', onclick: e => menu(e.currentTarget, [
      { label: state.email, run: () => {} }, '-',
      { icon: 'settings', label: 'Settings', run: () => openSettings() },
      { icon: 'logout', label: 'Sign out', run: async () => { await api('/logout', { method: 'POST' }); csrf = null; state.signedIn = false; boot(); } }
    ]) }, avatar(state.name || state.email));
    els.app = h('div', { class: 'app' + (state.collapsed ? ' collapsed' : '') },
      h('header', { class: 'topbar' },
        iconBtn('menu', 'Main menu', () => {
          if (innerWidth <= 760) els.app.classList.toggle('drawer');
          else { state.collapsed = !state.collapsed; store.set('pkj-collapsed', state.collapsed); els.app.classList.toggle('collapsed', state.collapsed); }
        }),
        h('a', { class: 'brand', href: '#inbox' }, brandLogo(''), h('b', { 'data-brand-name': '' }, state.brand.name)),
        h('div', { class: 'search', role: 'search' }, iconBtn('search', 'Search', () => go({ folder: null, q: search.value.trim() })), search,
          iconBtn('close', 'Clear search', () => { search.value = ''; go({ folder: 'inbox', q: '' }); }, 'sm')),
        h('div', { class: 'top-right' }, h('span', { class: 'hide-sm' }, themeBtn()), h('span', { class: 'hide-sm' }, iconBtn('settings', 'Settings', () => openSettings())), me)),
      els.side = h('nav', { class: 'sidebar', 'aria-label': 'Folders', onclick: e => { if (e.target.closest('a')) els.app.classList.remove('drawer'); } }),
      els.main = h('main', { class: 'main' },
        els.listPane = h('section', { class: 'pane list-pane' }),
        els.readPane = h('section', { class: 'pane read-pane hidden' })),
      h('button', { class: 'compose-btn fab', onclick: () => compose() }, icon('pencil'), h('span', null, 'Compose')));
    els.search = search;
    els.app.addEventListener('click', e => { if (e.target === els.app && els.app.classList.contains('drawer')) els.app.classList.remove('drawer'); });
    els.dock = h('div', { class: 'compose-dock' });
    root().replaceChildren(els.app, els.dock);
    renderSide();
  }

  function renderSide() {
    const v = state.view;
    const c = state.counts || {};
    const link = f => {
      const n = c[f.id] ? (f.badge === 'total' ? c[f.id].total : f.badge === 'unread' ? c[f.id].unread : 0) : 0;
      return h('li', null, h('a', { href: '#' + f.id, class: (!v.label && !v.q && v.folder === f.id ? 'active ' : '') + (f.id === 'inbox' && n ? 'bold' : ''), title: f.name }, icon(f.icon), h('span', { class: 'name' }, f.name), n ? h('span', { class: 'count' }, n > 999 ? '999+' : n) : null));
    };
    els.side.replaceChildren(
      h('button', { class: 'compose-btn', onclick: () => compose() }, icon('pencil'), h('span', null, 'Compose')),
      h('ul', { class: 'nav' }, FOLDERS.map(link)),
      h('div', { class: 'side-head' }, h('span', null, 'Labels'), iconBtn('plus', 'Create new label', newLabel, 'sm')),
      h('ul', { class: 'nav' }, state.labels.map(l => h('li', null, h('a', { href: '#label/' + encodeURIComponent(l.name), class: v.label === l.name ? 'active' : '', title: l.name,
        oncontextmenu: e => { e.preventDefault(); menu(e.currentTarget, [{ icon: 'trash', label: `Delete label "${l.name}"`, run: () => deleteLabel(l.name) }], { x: e.clientX, y: e.clientY }); } },
        h('span', { class: 'dot', style: `background:${l.color}` }), h('span', { class: 'name' }, l.name))))));
  }

  function newLabel(then) {
    const i = inp('Label name', { maxLength: 40, required: true, placeholder: 'e.g. Clients' });
    const err = h('div');
    const close = dialog(h('form', { class: 'form', onsubmit: async e => {
      e.preventDefault();
      const r = await api('/labels', { method: 'POST', body: { name: i.el.value.trim() } });
      if (!r.ok) return err.replaceChildren(note(r.error, 'err'));
      state.labels = r.labels; renderSide(); close();
      if (typeof then === 'function') then(i.el.value.trim());
    } }, h('h2', null, 'New label'), i.wrap, err, h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn primary' }, 'Create'))));
    setTimeout(() => i.el.focus(), 0);
  }
  async function deleteLabel(name) {
    if (!confirm(`Delete the label "${name}"? Mails keep their place; only the label goes.`)) return;
    const r = await api('/labels/' + encodeURIComponent(name), { method: 'DELETE' });
    if (r.ok) { state.labels = r.labels; if (state.view.label === name) go({ folder: 'inbox' }); else renderSide(); }
  }

  // ------------------------------------------------------------------ routing (#inbox, #label/Work, #search/x, #inbox/<threadId>)
  function parseHash() {
    const raw = location.hash.replace(/^#/, '');
    const [a, b, c] = raw.split('/');
    const dec = s => { try { return decodeURIComponent(s || ''); } catch (_) { return ''; } };
    if (a === 'label') return { folder: null, label: dec(b), q: '', id: c || null };
    if (a === 'search') return { folder: null, label: null, q: dec(b), id: c || null };
    return { folder: FOLDERS.some(f => f.id === a) ? a : 'inbox', label: null, q: '', id: b || null };
  }
  function viewHash(v) { return v.label ? 'label/' + encodeURIComponent(v.label) : v.q ? 'search/' + encodeURIComponent(v.q) : v.folder || 'inbox'; }
  function go(next) {
    const v = { folder: next.folder === undefined ? state.view.folder : next.folder, label: next.label || null, q: next.q || '' };
    if (!v.label && !v.q && !v.folder) v.folder = 'inbox';
    location.hash = viewHash(v);
  }
  const backToList = () => { location.hash = viewHash(state.view); };
  async function onRoute() {
    if (!state.signedIn) return;
    const r = parseHash();
    const changed = r.folder !== state.view.folder || r.label !== state.view.label || r.q !== state.view.q;
    if (changed) { state.view = { folder: r.folder, label: r.label, q: r.q, page: 1 }; state.selected.clear(); if (els.search) els.search.value = r.q; }
    renderSide();
    if (changed || !state.items.length) await loadList();
    if (r.id) openThread(r.id); else closeReader();
  }

  // ------------------------------------------------------------------ list
  let lastInboxUnread = null;
  async function loadList(quiet) {
    const v = state.view;
    const qs = new URLSearchParams({ page: v.page });
    if (v.folder) qs.set('folder', v.folder);
    if (v.label) qs.set('label', v.label);
    if (v.q) qs.set('q', v.q);
    if (!quiet && !state.items.length) els.listPane.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
    const [r, c] = await Promise.all([api('/messages?' + qs), api('/counts')]);
    if (!r.ok) { if (!quiet) els.listPane.replaceChildren(h('div', { class: 'empty' }, r.error)); return; }
    state.items = r.items; state.total = r.total; state.threads = r.threads;
    const keys = new Set(state.items.map(keyOf));
    for (const k of [...state.selected]) if (!keys.has(k)) state.selected.delete(k);
    if (c.ok) state.counts = c.counts;
    const unread = state.counts.inbox ? state.counts.inbox.unread : 0;
    lastInboxUnread = unread;
    document.title = (unread ? `(${unread}) ` : '') + viewTitle() + ' - ' + state.brand.name;
    renderList(); renderSide();
  }
  const viewTitle = () => state.view.label || (state.view.q ? 'Search results' : (FOLDERS.find(f => f.id === state.view.folder) || FOLDERS[0]).name);
  const selectedIds = () => state.items.filter(m => state.selected.has(keyOf(m))).flatMap(m => m.ids || [m.id]);

  function renderList() {
    const v = state.view;
    const items = state.items;
    const sel = state.selected;
    const all = h('input', { type: 'checkbox', class: 'cb', title: 'Select all', 'aria-label': 'Select all', checked: items.length > 0 && items.every(m => sel.has(keyOf(m))) });
    all.indeterminate = sel.size > 0 && !all.checked;
    all.addEventListener('change', () => { if (all.checked) items.forEach(m => sel.add(keyOf(m))); else sel.clear(); renderList(); });
    const from = (v.page - 1) * 50 + 1;
    const to = Math.min(state.total, v.page * 50);
    const bulk = sel.size ? actionButtons(selectedIds, { list: true }) : [iconBtn('refresh', 'Refresh', () => { api('/imap/check', { method: 'POST' }); loadList(); }),
      h('button', { class: 'icon-btn', title: 'More', 'aria-label': 'More', onclick: e => menu(e.currentTarget, [{ icon: 'read', label: 'Mark all as read', run: () => bulkAction('read', items.flatMap(m => m.ids || [m.id])) }]) }, icon('more'))];
    const pager = state.total ? [h('span', { class: 'range' }, `${from}–${to} of ${state.total}`),
      iconBtn('left', 'Newer', () => { if (v.page > 1) { v.page--; loadList(); } }), iconBtn('right', 'Older', () => { if (to < state.total) { v.page++; loadList(); } })] : [];
    const list = h('div', { class: 'list', role: 'list' });
    if (!items.length) {
      list.append(h('div', { class: 'empty' }, h('div', { class: 'big' }, v.q ? '🔍' : v.folder === 'trash' ? '🗑️' : v.folder === 'inbox' ? '🎉' : '📭'),
        v.q ? `No mail matched "${v.q}".` : v.folder === 'inbox' ? 'You\'re all done! Nothing in the Inbox.' : v.folder === 'spam' ? 'Hooray, no spam here!' : v.folder === 'trash' ? 'No mail in Trash. Mail here is deleted forever after 30 days.' : 'Nothing here yet.'));
    }
    for (const m of items) list.append(rowFor(m));
    const head = v.folder === 'trash' && items.length ? note('Mail in Trash is deleted forever after 30 days.') : v.folder === 'spam' && items.length ? note('Mail in Spam stays here until you delete it or mark it "Not spam".') : null;
    if (head) head.style.cssText = 'margin:8px 12px;';
    els.listPane.replaceChildren(...[h('div', { class: 'toolbar' }, all, ...bulk, h('div', { class: 'spacer' }), ...pager), head, list].filter(Boolean));
  }

  function rowFor(m) {
    const sel = state.selected;
    const k = keyOf(m);
    const ids = m.ids || [m.id];
    const isDraft = m.folder === 'drafts';
    // one person: full name; a conversation with several: first names, like "Neha, me"
    const names = (m.names || []).length > 1 ? m.names : [m.folder === 'sent' ? 'me' : m.fromName || m.from || '(unknown)'];
    const who = isDraft ? h('span', { class: 'draft-word' }, 'Draft') : (state.view.folder === 'sent' ? 'To: ' + (m.to.join(', ') || '(nobody)') : names.slice(0, 3).join(', '));
    const cb = h('input', { type: 'checkbox', class: 'cb', checked: sel.has(k), 'aria-label': 'Select', onclick: e => e.stopPropagation(), onchange: e => { if (e.target.checked) sel.add(k); else sel.delete(k); renderList(); } });
    const star = h('button', { class: 'star' + (m.starred ? ' on' : ''), title: m.starred ? 'Starred' : 'Not starred', 'aria-label': 'Star', onclick: async e => {
      e.stopPropagation(); m.starred = !m.starred; renderList();
      await api('/messages/bulk', { method: 'POST', body: { ids: m.starred ? [ids[0]] : ids, action: m.starred ? 'star' : 'unstar' } }); loadCountsOnly();
    } }, icon(m.starred ? 'starFill' : 'star'));
    const labelChips = (m.labels || []).filter(l => l !== state.view.label).map(l => h('span', { class: 'chip', style: `background:${labelColor(l)}22;color:${labelColor(l)}` }, l));
    const folderChip = (state.view.q || state.view.folder === 'all') && m.folder === 'inbox' ? h('span', { class: 'chip' }, 'Inbox') : state.view.q && m.folder !== 'inbox' ? h('span', { class: 'chip' }, m.folder) : null;
    const quick = h('div', { class: 'hover-actions' },
      m.folder === 'inbox' ? iconBtn('archive', 'Archive', e => { e.stopPropagation(); bulkAction('archive', ids); }, 'sm') : null,
      iconBtn('trash', 'Delete', e => { e.stopPropagation(); bulkAction('trash', ids); }, 'sm'),
      iconBtn(m.read ? 'unread' : 'read', m.read ? 'Mark as unread' : 'Mark as read', e => { e.stopPropagation(); bulkAction(m.read ? 'unread' : 'read', ids); }, 'sm'));
    return h('div', { class: 'row' + (m.read ? '' : ' unread') + (sel.has(k) ? ' selected' : '') + (state.openId === k ? ' current' : ''), role: 'listitem', tabindex: 0, 'data-id': k,
      onclick: () => (isDraft ? openDraft(m.id) : (location.hash = viewHash(state.view) + '/' + k)),
      onkeydown: e => { if (e.key === 'Enter') e.currentTarget.click(); },
      oncontextmenu: e => { e.preventDefault(); rowMenu(m, { x: e.clientX, y: e.clientY }); } },
      cb, star, h('div', { class: 'av' }, avatar(m.fromName || m.from)),
      h('div', { class: 'who' }, who, m.count > 1 ? h('span', { class: 'cnt' }, ' ' + m.count) : null),
      h('div', { class: 'what' }, folderChip, labelChips, h('span', { class: 'subj' }, m.subject || '(no subject)'), m.snippet ? h('span', { class: 'snip' }, ' - ' + m.snippet) : null),
      h('div', { class: 'when' }, m.hasAttachments ? icon('attach', 'ic') : null, shortTime(m.date)),
      quick);
  }
  function rowMenu(m, at) {
    const ids = m.ids || [m.id];
    menu(null, [
      m.folder === 'inbox' ? { icon: 'archive', label: 'Archive', run: () => bulkAction('archive', ids) } : null,
      m.folder === 'archive' ? { icon: 'unarchive', label: 'Move to Inbox', run: () => bulkAction('inbox', ids) } : null,
      { icon: 'trash', label: m.folder === 'trash' ? 'Delete forever' : 'Delete', run: () => bulkAction('trash', ids) },
      { icon: m.read ? 'unread' : 'read', label: m.read ? 'Mark as unread' : 'Mark as read', run: () => bulkAction(m.read ? 'unread' : 'read', ids) },
      { icon: 'starFill', label: m.starred ? 'Remove star' : 'Add star', run: () => bulkAction(m.starred ? 'unstar' : 'star', m.starred ? ids : [ids[0]]) },
      m.folder === 'spam' ? { icon: 'notspam', label: 'Not spam', run: () => bulkAction('notspam', ids) } : { icon: 'spam', label: 'Report spam', run: () => bulkAction('spam', ids) },
      '-',
      ...state.labels.map(l => ({ icon: 'label', label: (m.labels || []).includes(l.name) ? `Remove "${l.name}"` : `Label "${l.name}"`, run: () => bulkAction((m.labels || []).includes(l.name) ? 'label-remove' : 'label-add', ids, l.name) }))
    ], at);
  }
  const labelColor = name => ((state.labels.find(l => l.name === name) || {}).color || '#5f6368');

  /** The action buttons for selected rows (list) or the open conversation (reader). */
  function actionButtons(getIds, { list, folders } = {}) {
    const f = state.view.folder;
    const here = folders || new Set(state.items.filter(m => state.selected.has(keyOf(m))).map(m => m.folder));
    const btns = [];
    if (here.has('inbox')) btns.push(iconBtn('archive', 'Archive', () => bulkAction('archive', getIds())));
    if (here.has('archive') || (here.has('spam') && f !== 'spam')) btns.push(iconBtn('unarchive', 'Move to Inbox', () => bulkAction('inbox', getIds())));
    if (f === 'trash') btns.push(iconBtn('restore', 'Restore', () => bulkAction('restore', getIds())), h('button', { class: 'btn danger', style: 'height:32px', onclick: () => { if (confirm('Delete forever? This cannot be undone.')) bulkAction('delete', getIds()); } }, 'Delete forever'));
    else if (f === 'spam') btns.push(iconBtn('notspam', 'Not spam', () => bulkAction('notspam', getIds())), iconBtn('trash', 'Delete', () => bulkAction('trash', getIds())));
    else btns.push(iconBtn('spam', 'Report spam', () => bulkAction('spam', getIds())), iconBtn('trash', 'Delete', () => bulkAction('trash', getIds())));
    btns.push(h('span', { class: 'tsep' }));
    if (list) btns.push(iconBtn('read', 'Mark as read', () => bulkAction('read', getIds())));
    btns.push(iconBtn('unread', 'Mark as unread', async () => { await bulkAction('unread', getIds()); if (!list) backToList(); }));
    btns.push(h('button', { class: 'icon-btn', title: 'Labels', 'aria-label': 'Labels', onclick: e => labelMenu(e.currentTarget, getIds()) }, icon('label')));
    btns.push(h('button', { class: 'icon-btn', title: 'More', 'aria-label': 'More', onclick: e => menu(e.currentTarget, [
      { icon: 'starFill', label: 'Add star', run: () => bulkAction('star', getIds()) },
      { icon: 'star', label: 'Remove star', run: () => bulkAction('unstar', getIds()) }
    ]) }, icon('more')));
    return btns;
  }
  function labelMenu(anchor, ids) {
    const has = new Set(state.items.filter(m => (m.ids || [m.id]).some(i => ids.includes(i))).flatMap(m => m.labels || []));
    if (state.open) state.open.messages.forEach(m => (m.labels || []).forEach(l => has.add(l)));
    menu(anchor, [
      ...state.labels.map(l => ({ icon: 'label', label: (has.has(l.name) ? '✓ ' : '') + l.name, run: () => bulkAction(has.has(l.name) ? 'label-remove' : 'label-add', ids, l.name) })),
      '-', { icon: 'plus', label: 'Create new label', run: () => newLabel(name => bulkAction('label-add', ids, name)) }
    ]);
  }
  async function bulkAction(action, ids, label) {
    if (!ids.length) return;
    const r = await api('/messages/bulk', { method: 'POST', body: { ids, action, label } });
    if (!r.ok) return toast(r.error);
    const what = n => (n > 1 ? `${n} conversations` : 'Conversation');
    const count = new Set(state.items.filter(m => (m.ids || [m.id]).some(i => ids.includes(i))).map(keyOf)).size || 1;
    const words = {
      archive: `${what(count)} archived.`, inbox: `${what(count)} moved to Inbox.`,
      trash: state.view.folder === 'trash' ? `${what(count)} deleted forever.` : `${what(count)} moved to Trash.`, delete: `${what(count)} deleted forever.`,
      spam: `${what(count)} marked as spam.`, notspam: `${what(count)} moved to Inbox.`, restore: `${what(count)} restored.`,
      'label-add': `Label "${label}" added.`, 'label-remove': `Label "${label}" removed.`
    };
    const undo = { trash: 'restore', spam: 'notspam', archive: 'inbox' }[action];
    if (words[action]) toast(words[action], undo && state.view.folder !== 'trash' ? { label: 'Undo', run: () => bulkAction(undo, ids) } : null);
    state.selected.clear();
    const leaves = ['trash', 'delete', 'spam', 'notspam', 'restore', 'archive', 'inbox'].includes(action);
    const openIds = state.open ? state.open.messages.map(m => m.id) : [];
    if (state.openId && openIds.some(i => ids.includes(i))) {
      if (leaves && !(action === 'inbox' && state.view.folder === 'all')) backToList();
      else openThread(state.openId, true);
    }
    await loadList(true);
  }
  async function loadCountsOnly() { const c = await api('/counts'); if (c.ok) { state.counts = c.counts; renderSide(); } }

  // ------------------------------------------------------------------ reader (a whole conversation)
  function closeReader() {
    state.openId = null; state.open = null;
    els.readPane.classList.add('hidden'); els.main.classList.remove('split'); els.listPane.classList.remove('hidden');
    renderList();
  }
  const imagesAllowed = from => store.get('pkj-img-ok', []).includes(String(from || '').toLowerCase());
  async function openThread(id, quiet) {
    state.openId = id;
    els.readPane.classList.remove('hidden');
    els.main.classList.toggle('split', innerWidth > 1100 && store.get('pkj-split', false));
    if (!els.main.classList.contains('split')) els.listPane.classList.add('hidden');
    if (!quiet) els.readPane.replaceChildren(h('div', { class: 'empty' }, 'Opening…'));
    const r = await api('/threads/' + encodeURIComponent(id) + '?view=' + encodeURIComponent(state.view.folder || ''));
    if (state.openId !== id) return;
    if (!r.ok) { els.readPane.replaceChildren(h('div', { class: 'toolbar' }, iconBtn('back', 'Back', backToList)), h('div', { class: 'empty' }, r.error)); return; }
    const prev = state.open && state.open.id === id ? state.open : null;
    state.open = r.thread;
    const msgs = state.open.messages;
    // open: the newest mail, plus any that were unread; keep what you opened before
    msgs.forEach((m, i) => { m._open = prev ? Boolean((prev.messages.find(x => x.id === m.id) || { _open: i === msgs.length - 1 })._open) : i === msgs.length - 1 || !m.read; m._img = imagesAllowed(m.from); });
    const row = state.items.find(m => keyOf(m) === id);
    if (row && !row.read) { row.read = true; loadCountsOnly(); }
    renderReader(); renderList();
  }
  function frameDoc(html, images) {
    // the mail keeps its own colours; remote pictures stay blocked until allowed (they can tell the sender you opened it)
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${images ? '* data:' : 'data:'}; style-src 'unsafe-inline'; font-src data:">` +
      `<base target="_blank"><style>html,body{margin:0;padding:0}body{font:14px/1.5 Arial,Helvetica,sans-serif;color:#202124;background:#fff;word-wrap:break-word;overflow-wrap:anywhere;padding:${isDark() ? '16px' : '0'}}img{max-width:100%;height:auto}pre{white-space:pre-wrap}blockquote{margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex}table{max-width:100%}</style></head><body>${html}</body></html>`;
  }
  function mailFrame(m) {
    const frame = h('iframe', { class: 'mail-frame', title: 'Mail content', sandbox: 'allow-popups allow-popups-to-escape-sandbox allow-same-origin', referrerpolicy: 'no-referrer' });
    frame.srcdoc = frameDoc(m.html || '', m._img);
    // the body's own height (the page's height would never be less than the frame's starting 150px)
    const fit = () => { try { const d = frame.contentDocument; if (d && d.body) frame.style.height = Math.max(24, Math.ceil(d.body.getBoundingClientRect().height) + (isDark() ? 0 : 8)) + 'px'; } catch (_) {} };
    frame.addEventListener('load', () => { fit(); try { frame.contentDocument.querySelectorAll('img').forEach(i => i.addEventListener('load', fit)); } catch (_) {} setTimeout(fit, 400); });
    return frame;
  }
  function messageCard(m, isLast) {
    const me = m.folder === 'sent' || m.folder === 'drafts';
    const name = me ? 'me' : m.fromName || m.from;
    if (!m._open) {
      return h('div', { class: 'msg collapsed', tabindex: 0, onclick: () => { m._open = true; renderReader(); }, onkeydown: e => { if (e.key === 'Enter') e.currentTarget.click(); } },
        avatar(m.fromName || m.from, 'lg'), h('div', { class: 'msg-line' }, h('b', null, name), m.folder === 'drafts' ? h('span', { class: 'draft-word' }, ' Draft') : null, h('span', { class: 'snip' }, m.snippet || '')),
        h('div', { class: 'when' }, m.attachments.length ? icon('attach') : null, shortTime(m.date)));
    }
    const star = h('button', { class: 'star' + (m.starred ? ' on' : ''), title: m.starred ? 'Starred' : 'Not starred', onclick: async e => {
      e.stopPropagation(); m.starred = !m.starred; renderReader(); await api('/messages/' + m.id, { method: 'PATCH', body: { starred: m.starred } }); loadList(true);
    } }, icon(m.starred ? 'starFill' : 'star'));
    const atts = (m.attachments || []).filter(a => !(a.inline && /^image\//.test(a.type) && a.kept));
    const imgBar = m.hasRemoteImages && !m._img ? h('div', { class: 'img-bar' }, icon('image'), h('span', null, 'Images are hidden to protect your privacy. '),
      h('button', { class: 'link-btn', onclick: () => { m._img = true; renderReader(); } }, 'Show images'), ' · ',
      h('button', { class: 'link-btn', onclick: () => { store.set('pkj-img-ok', [...store.get('pkj-img-ok', []), String(m.from).toLowerCase()].slice(-500)); state.open.messages.forEach(x => { if (x.from === m.from) x._img = true; }); renderReader(); } }, 'Always show from ' + m.from)) : null;
    return h('div', { class: 'msg' },
      h('div', { class: 'msg-head', onclick: e => { if (!isLast && !e.target.closest('button')) { m._open = false; renderReader(); } } },
        avatar(m.fromName || m.from, 'lg'),
        h('div', { class: 'meta' },
          h('div', null, h('span', { class: 'n' }, me ? (m.fromName || 'me') : m.fromName || m.from), ' ', h('span', { class: 'e' }, `<${m.from}>`), m.folder === 'drafts' ? h('span', { class: 'draft-word' }, ' Draft') : null),
          h('div', { class: 't' }, 'to ' + ((m.to || []).join(', ') || 'me') + ((m.cc || []).length ? ', cc ' + m.cc.join(', ') : ''))),
        h('div', { class: 'side' }, h('span', { title: longTime(m.date) }, shortTime(m.date) + ' (' + ago(m.date) + ')'), star,
          m.folder === 'drafts' ? iconBtn('pencil', 'Edit draft', () => openDraft(m.id)) : iconBtn('reply', 'Reply', () => replyTo(m, 'reply')),
          h('button', { class: 'icon-btn', title: 'More', 'aria-label': 'More', onclick: e => menu(e.currentTarget, [
            { icon: 'reply', label: 'Reply', run: () => replyTo(m, 'reply') },
            { icon: 'replyAll', label: 'Reply all', run: () => replyTo(m, 'all') },
            { icon: 'forward', label: 'Forward', run: () => replyTo(m, 'forward') }, '-',
            { icon: 'trash', label: 'Delete this message', run: () => bulkAction('trash', [m.id]) },
            { icon: 'unread', label: 'Mark unread from here', run: async () => { const i = state.open.messages.indexOf(m); await bulkAction('unread', state.open.messages.slice(i).map(x => x.id)); backToList(); } }
          ]) }, icon('more')))),
      imgBar,
      h('div', { class: 'mail-body' }, mailFrame(m)),
      atts.length ? h('div', { class: 'atts' }, atts.map(a => a.kept
        ? h('a', { class: 'att', href: `/api/messages/${m.id}/attachments/${a.n}`, download: a.name }, icon('file'), h('div', { style: 'min-width:0' }, h('div', { class: 'an' }, a.name), h('div', { class: 'as' }, fmtBytes(a.size))))
        : h('div', { class: 'att', title: 'Too big to keep' }, icon('file'), h('div', { style: 'min-width:0' }, h('div', { class: 'an' }, a.name), h('div', { class: 'as' }, fmtBytes(a.size) + ' · not kept'))))) : null);
  }
  function renderReader() {
    const t = state.open;
    if (!t) return;
    const msgs = t.messages;
    const ids = () => msgs.map(m => m.id);
    const folders = new Set(msgs.map(m => m.folder));
    const last = [...msgs].reverse().find(m => m.folder !== 'drafts') || msgs[msgs.length - 1];
    const labels = [...new Set(msgs.flatMap(m => m.labels || []))];
    const idx = state.items.findIndex(m => keyOf(m) === state.openId);
    const toolbar = h('div', { class: 'toolbar' },
      iconBtn('back', 'Back to ' + viewTitle(), backToList),
      ...actionButtons(ids, { folders }),
      h('div', { class: 'spacer' }),
      idx >= 0 ? h('span', { class: 'range' }, `${(state.view.page - 1) * 50 + idx + 1} of ${state.total}`) : null,
      iconBtn('left', 'Newer', () => { const n = state.items[idx - 1]; if (n) location.hash = viewHash(state.view) + '/' + keyOf(n); }),
      iconBtn('right', 'Older', () => { const n = state.items[idx + 1]; if (n) location.hash = viewHash(state.view) + '/' + keyOf(n); }),
      innerWidth > 1100 ? h('button', { class: 'btn', style: 'height:30px;font-size:12px;margin-left:6px', title: 'Show the list next to the mail', onclick: () => { store.set('pkj-split', !store.get('pkj-split', false)); openThread(state.openId, true); } }, store.get('pkj-split', false) ? 'Full width' : 'Split view') : null);
    // many mails: show the first, a "N more" bar, and the last two
    const shown = [];
    const hiddenCount = msgs.length > 4 && !t._expandAll ? msgs.slice(1, -2).filter(m => !m._open).length : 0;
    msgs.forEach((m, i) => {
      if (hiddenCount > 1 && i > 0 && i < msgs.length - 2 && !m._open) {
        if (!shown.some(x => x.dataset && x.dataset.more)) shown.push(h('button', { class: 'more-bar', 'data-more': '1', onclick: () => { t._expandAll = true; renderReader(); } }, h('span', null, String(hiddenCount)), ` more message${hiddenCount > 1 ? 's' : ''}`));
        return;
      }
      shown.push(messageCard(m, i === msgs.length - 1));
    });
    els.readPane.replaceChildren(toolbar, h('div', { class: 'reader' },
      h('h1', null, h('span', null, t.subject || '(no subject)'), [...folders].filter(f => f !== 'sent' && f !== 'drafts').map(f => h('span', { class: 'chip' }, f === 'archive' ? 'Archived' : f[0].toUpperCase() + f.slice(1))),
        labels.map(l => h('span', { class: 'chip', style: `background:${labelColor(l)}22;color:${labelColor(l)}` }, l, h('button', { class: 'chip-x', title: 'Remove label', onclick: () => bulkAction('label-remove', ids(), l) }, '✕')))),
      h('div', { class: 'thread' }, shown),
      last && last.folder !== 'drafts' ? h('div', { class: 'reply-bar' },
        h('button', { class: 'btn', onclick: () => replyTo(last, 'reply') }, icon('reply'), 'Reply'),
        (last.cc || []).length || (last.to || []).length > 1 ? h('button', { class: 'btn', onclick: () => replyTo(last, 'all') }, icon('replyAll'), 'Reply all') : null,
        h('button', { class: 'btn', onclick: () => replyTo(last, 'forward') }, icon('forward'), 'Forward')) : null));
  }

  function replyTo(m, kind) {
    const me = (state.address || '').toLowerCase();
    const quoteHead = `On ${longTime(m.date)}, ${escapeHtml(m.fromName || m.from)} &lt;${escapeHtml(m.from)}&gt; wrote:`;
    const body = safeQuote(m.html || escapeHtml(m.text || ''));
    const subj = m.subject || '';
    const refs = [m.references, m.messageId].filter(Boolean).join(' ');
    if (kind === 'forward') {
      return compose({ subject: /^fwd?:/i.test(subj) ? subj : 'Fwd: ' + subj,
        html: `<br><br><div>---------- Forwarded message ---------<br>From: ${escapeHtml(m.fromName || '')} &lt;${escapeHtml(m.from)}&gt;<br>Date: ${escapeHtml(longTime(m.date))}<br>Subject: ${escapeHtml(subj)}<br>To: ${escapeHtml((m.to || []).join(', '))}</div><br>${body}` });
    }
    const target = m.folder === 'sent' ? (m.to || []) : [m.replyTo || m.from];
    const cc = kind === 'all' ? [...(m.to || []), ...(m.cc || [])].filter(a => a && a.toLowerCase() !== me && !target.includes(a)) : [];
    compose({ to: target.join(', '), cc: cc.join(', '), subject: /^re:/i.test(subj) ? subj : 'Re: ' + subj, html: `<br><br><div>${quoteHead}</div><blockquote>${body}</blockquote>`, inReplyTo: m.messageId || '', references: refs });
  }

  // ------------------------------------------------------------------ compose
  const windows = [];
  async function openDraft(id) {
    const open = windows.find(w => w.draftId() === id);
    if (open) return open.focus();
    const r = await api('/messages/' + id);
    if (!r.ok) return toast(r.error);
    const d = r.message;
    compose({ draftId: d.id, to: (d.to || []).join(', '), cc: (d.cc || []).join(', '), bcc: (d.bcc || []).join(', '), subject: d.subject, html: safeQuote(d.html), inReplyTo: d.inReplyTo, references: d.references });
  }
  /** Suggests people from your contacts while you type an address. */
  function suggest(input) {
    const box = h('div', { class: 'suggest hidden', role: 'listbox' });
    let items = []; let pick = 0; let timer;
    const token = () => { const v = input.value; const i = Math.max(v.lastIndexOf(','), v.lastIndexOf(';')); return v.slice(i + 1).trim(); };
    function choose(c) {
      const v = input.value; const i = Math.max(v.lastIndexOf(','), v.lastIndexOf(';'));
      input.value = (i >= 0 ? v.slice(0, i + 1) + ' ' : '') + (c.name ? `${c.name} <${c.address}>` : c.address) + ', ';
      box.classList.add('hidden'); input.focus(); input.dispatchEvent(new Event('input'));
    }
    function draw() {
      box.replaceChildren(...items.map((c, i) => h('div', { class: 'sg' + (i === pick ? ' on' : ''), role: 'option', onmousedown: e => { e.preventDefault(); choose(c); } }, avatar(c.name || c.address), h('div', null, h('div', null, c.name || c.address), c.name ? h('div', { class: 'e' }, c.address) : null))));
      box.classList.toggle('hidden', !items.length);
    }
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const t = token();
      if (!t || t.includes('<') || /,\s*$/.test(input.value)) { items = []; draw(); return; }
      timer = setTimeout(async () => { const r = await api('/contacts?q=' + encodeURIComponent(t)); items = r.ok ? r.contacts.filter(c => c.address !== t.toLowerCase()) : []; pick = 0; draw(); }, 120);
    });
    input.addEventListener('keydown', e => {
      if (box.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); pick = (pick + 1) % items.length; draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); pick = (pick - 1 + items.length) % items.length; draw(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(items[pick]); }
      else if (e.key === 'Escape') { e.stopPropagation(); box.classList.add('hidden'); }
    });
    input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 150));
    return box;
  }
  function compose(init = {}) {
    if (windows.length >= 3) windows[0].close(true);
    let draftId = init.draftId || null;
    const attachments = [];
    let dirty = false; let saving = null;
    const to = h('input', { value: init.to || '', 'aria-label': 'To', autocomplete: 'off' });
    const cc = h('input', { value: init.cc || '', 'aria-label': 'Cc', autocomplete: 'off' });
    const bcc = h('input', { value: init.bcc || '', 'aria-label': 'Bcc', autocomplete: 'off' });
    const subject = h('input', { value: init.subject || '', placeholder: 'Subject', 'aria-label': 'Subject' });
    const editor = h('div', { class: 'editor', contenteditable: 'true', 'data-placeholder': 'Write your message…', role: 'textbox', 'aria-multiline': 'true' });
    editor.innerHTML = (init.html || '') + (state.signature && !init.draftId ? `<br><br>-- <br>${escapeHtml(state.signature).replace(/\n/g, '<br>')}` : ''); // init.html is always safeQuote()d
    const field = (label, input, extra) => h('div', { class: 'field' }, h('label', null, label), h('div', { class: 'fwrap' }, input, suggest(input)), extra);
    const ccRow = field('Cc', cc); const bccRow = field('Bcc', bcc);
    if (!init.cc && !init.bcc) ccRow.classList.add('hidden');
    if (!init.bcc) bccRow.classList.add('hidden');
    const title = h('span', { class: 't' }, init.subject || 'New Message');
    const attBox = h('div', { class: 'compose-atts' });
    async function addFiles(files) {
      for (const f of files) {
        if (f.size > 15 * 1024 * 1024) { toast(`${f.name} is too big (15 MB max).`); continue; }
        const data = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.readAsDataURL(f); });
        attachments.push({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, data });
      }
      drawAtts(); dirty = true;
    }
    const file = h('input', { type: 'file', multiple: true, class: 'hidden', onchange: async () => { await addFiles([...file.files]); file.value = ''; } });
    function drawAtts() { attBox.replaceChildren(...attachments.map((a, i) => h('span', { class: 'chip' }, icon('attach'), `${a.name} (${fmtBytes(a.size)})`, h('button', { type: 'button', title: 'Remove', onclick: () => { attachments.splice(i, 1); drawAtts(); dirty = true; } }, icon('close', 'ic'))))); }
    const cmd = (c, v) => { editor.focus(); document.execCommand(c, false, v); };
    const sendBtn = h('button', { class: 'btn primary send-btn', type: 'button', onclick: () => send() }, 'Send');
    const savedNote = h('span', { class: 'saved' });
    const win = h('div', { class: 'compose', role: 'dialog', 'aria-label': 'New message' },
      h('div', { class: 'compose-head', onclick: e => { if (!e.target.closest('button')) win.classList.toggle('min'); } }, title,
        iconBtn('min', 'Minimise', () => win.classList.toggle('min')),
        iconBtn('max', 'Full screen', () => { win.classList.remove('min'); win.classList.toggle('max'); }),
        iconBtn('close', 'Save & close', () => close())),
      field('To', to, h('span', { class: 'ccbcc' }, h('button', { class: 'link', type: 'button', onclick: () => ccRow.classList.toggle('hidden') }, 'Cc'), h('button', { class: 'link', type: 'button', onclick: () => bccRow.classList.toggle('hidden') }, 'Bcc'))),
      ccRow, bccRow,
      h('div', { class: 'field' }, subject),
      editor, attBox,
      h('div', { class: 'fmt' }, iconBtn('bold', 'Bold (Ctrl+B)', () => cmd('bold')), iconBtn('italic', 'Italic (Ctrl+I)', () => cmd('italic')), iconBtn('underline', 'Underline (Ctrl+U)', () => cmd('underline')),
        iconBtn('list', 'Bulleted list', () => cmd('insertUnorderedList')),
        iconBtn('link', 'Insert link', () => { const u = prompt('Link address (https://…)'); if (u && /^(https?:|mailto:)/i.test(u.trim())) cmd('createLink', u.trim()); })),
      h('div', { class: 'compose-foot' }, sendBtn, iconBtn('attach', 'Attach files', () => file.click()), file, savedNote, h('div', { class: 'spacer' }),
        iconBtn('trash', 'Discard draft', discard)));
    // drop files anywhere on the window
    win.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); win.classList.add('drop'); } });
    win.addEventListener('dragleave', e => { if (!win.contains(e.relatedTarget)) win.classList.remove('drop'); });
    win.addEventListener('drop', e => { if (e.dataTransfer.files.length) { e.preventDefault(); win.classList.remove('drop'); addFiles([...e.dataTransfer.files]); } });
    editor.addEventListener('paste', e => {
      // pasted text arrives as plain text, so nothing foreign lands in this page
      const text = e.clipboardData && e.clipboardData.getData('text/plain');
      if (text !== undefined && text !== null && !(e.clipboardData.files && e.clipboardData.files.length)) { e.preventDefault(); document.execCommand('insertText', false, text); }
    });
    [to, cc, bcc, subject].forEach(i => i.addEventListener('input', () => { dirty = true; if (i === subject) title.textContent = subject.value || 'New Message'; }));
    editor.addEventListener('input', () => { dirty = true; });
    win.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send(); if (e.key === 'Escape') close(); });
    const autosave = setInterval(() => { if (dirty) save(); }, 10000);
    const self = { close: silent => close(silent), draftId: () => draftId, focus: () => { win.classList.remove('min'); editor.focus(); } };
    windows.push(self);
    els.dock.prepend(win);
    setTimeout(() => (init.to ? editor : to).focus(), 0);
    if (init.to) { const r = document.createRange(); r.setStart(editor, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

    function payload() {
      return { draftId, id: draftId, to: to.value, cc: cc.value, bcc: bcc.value, subject: subject.value, html: editor.innerHTML, text: editor.innerText, attachments, inReplyTo: init.inReplyTo || '', references: init.references || '' };
    }
    async function save() {
      if (saving) return saving;
      dirty = false;
      saving = api('/drafts', { method: 'POST', body: payload() }).then(r => { if (r.ok) { draftId = r.id; savedNote.textContent = 'Draft saved'; } else savedNote.textContent = r.error; return r; }).finally(() => { saving = null; });
      return saving;
    }
    function detach() { clearInterval(autosave); win.remove(); const i = windows.indexOf(self); if (i >= 0) windows.splice(i, 1); }
    async function close(silent) {
      const empty = !to.value.trim() && !subject.value.trim() && !editor.innerText.trim() && !attachments.length;
      detach();
      if (dirty && !empty) { await save(); if (!silent) toast('Draft saved.'); }
      if (state.view.folder === 'drafts') loadList(true); else loadCountsOnly();
    }
    async function discard() {
      detach();
      if (draftId) await api('/messages/bulk', { method: 'POST', body: { ids: [draftId], action: 'delete' } });
      toast('Draft discarded.');
      if (state.view.folder === 'drafts') loadList(true); else loadCountsOnly();
    }
    /** Like real mail apps: the mail waits a few seconds so you can still Undo. */
    async function send() {
      if (!to.value.trim() && !cc.value.trim() && !bcc.value.trim()) { toast('Please specify at least one recipient.'); to.focus(); return; }
      if (!subject.value.trim() && !editor.innerText.trim() && !confirm('Send this message without a subject or text?')) return;
      if (/attach/i.test(editor.innerText.split(/\n--\s*\n|On .* wrote:/)[0]) && !attachments.length && !confirm('You wrote about an attachment, but none is attached. Send anyway?')) return;
      await saving;
      const body = payload();
      detach();
      let undone = false;
      const delay = Number(store.get('pkj-undo-seconds', 5)) * 1000;
      const t = delay ? toast('Sending…', { label: 'Undo', run: () => { undone = true; clearTimeout(timer); windows.push(self); els.dock.prepend(win); self.focus(); toast('Sending undone.'); } }, delay + 500) : null;
      const timer = setTimeout(async () => {
        if (undone) return;
        if (t) t.remove();
        const r = await api('/send', { method: 'POST', body });
        if (!r.ok) { windows.push(self); els.dock.prepend(win); self.focus(); toast('Not sent: ' + r.error); return; }
        toast('Message sent.', { label: 'View message', run: () => { location.hash = 'sent/' + (r.threadId || r.id); } });
        if (state.openId && r.threadId === state.openId) openThread(state.openId, true);
        if (['sent', 'drafts', 'all'].includes(state.view.folder) || state.openId) loadList(true); else loadCountsOnly();
      }, delay);
    }
    return self;
  }

  // ------------------------------------------------------------------ settings
  async function openSettings(startTab) {
    const r = await api('/settings');
    if (!r.ok) return toast(r.error);
    const st = r.settings;
    const content = h('div');
    const tabs = ['General', 'Branding', 'Sending', 'Receiving', 'Security'];
    let tab = startTab || 'General';
    const form = mailForm(st, {
      testSmtp: (smtp, to) => api('/settings/test-smtp', { method: 'POST', body: { smtp, to } }),
      testImap: imap => api('/settings/test-imap', { method: 'POST', body: { imap } }),
      lockSmtp: st.smtp.fromEnv, lockImap: st.imap.fromEnv
    });
    const sig = inp('Signature (added to new mails)', { tag: 'textarea', value: st.signature || '' });
    const theme = inp('Theme', { tag: 'select', value: store.get('pkj-theme-raw', 'system'), options: [['system', 'Same as my device'], ['light', 'Light'], ['dark', 'Dark']] });
    theme.el.addEventListener('change', () => setTheme(theme.el.value));
    const undoSel = inp('Undo Send period', { tag: 'select', value: String(store.get('pkj-undo-seconds', 5)), options: [['0', 'Off'], ['5', '5 seconds'], ['10', '10 seconds'], ['20', '20 seconds'], ['30', '30 seconds']] });
    undoSel.el.addEventListener('change', () => store.set('pkj-undo-seconds', Number(undoSel.el.value)));
    const notifyMsg = h('small');
    const notifyBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!('Notification' in window)) { notifyMsg.textContent = 'This browser cannot show notifications.'; return; }
      const p = await Notification.requestPermission();
      notifyMsg.textContent = p === 'granted' ? 'On. You will get a notification when new mail arrives while this tab is in the background.' : 'Blocked. Allow notifications for this site in the browser settings.';
    } }, icon('bell'), 'Turn on desktop notifications');
    if ('Notification' in window && Notification.permission === 'granted') notifyMsg.textContent = 'Desktop notifications are on.';

    // branding
    const b = r.brand;
    const bName = inp('App name', { value: b.name, maxLength: 40 }, 'Shown in the top bar, the browser tab and the sign-in page.');
    const bColor = h('input', { type: 'color', value: b.color || '#0b57d0', 'aria-label': 'Main colour' });
    let colorOn = Boolean(b.color);
    const swatches = ['#0b57d0', '#188038', '#d93025', '#e37400', '#9334e6', '#007b83', '#e0408f', '#202124'];
    let logoData; // undefined = keep, null = remove, string = new
    const preview = h('img', { class: 'brand-preview', src: logoUrl(), alt: 'Logo preview' });
    const logoMsg = h('div');
    const logoFile = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', class: 'hidden', onchange: () => {
      const f = logoFile.files[0];
      if (!f) return;
      if (f.size > 300 * 1024) { logoMsg.replaceChildren(note('The logo must be 300 KB or smaller.', 'err')); return; }
      const rd = new FileReader();
      rd.onload = () => { logoData = String(rd.result); preview.src = logoData; logoMsg.replaceChildren(); };
      rd.readAsDataURL(f);
    } });
    const colorRow = h('div', { class: 'swatches' }, swatches.map(c => h('button', { type: 'button', class: 'sw', style: `background:${c}`, title: c, onclick: () => { bColor.value = c; colorOn = true; } })), bColor,
      h('button', { class: 'btn', type: 'button', onclick: () => { colorOn = false; } }, 'Default'));
    bColor.addEventListener('input', () => { colorOn = true; });
    const brandPart = h('div', { class: 'form' }, bName.wrap,
      h('div', { class: 'inp' }, h('span', null, 'Logo (PNG, JPG, WEBP or GIF, up to 300 KB; square works best)'),
        h('div', { class: 'logo-row' }, preview, h('button', { class: 'btn', type: 'button', onclick: () => logoFile.click() }, 'Upload logo'), h('button', { class: 'btn', type: 'button', onclick: () => { logoData = null; preview.src = '/logo.svg'; } }, 'Use default'), logoFile), logoMsg),
      h('div', { class: 'inp' }, h('span', null, 'Main colour (buttons, Compose, selected folder)'), colorRow));
    async function saveBranding() {
      const body = { name: bName.el.value.trim(), color: colorOn ? bColor.value : '' };
      if (logoData !== undefined) body.logo = logoData;
      const x = await api('/brand', { method: 'PUT', body });
      if (!x.ok) throw new Error(x.error);
      applyBrand(x.brand);
      document.title = viewTitle() + ' - ' + state.brand.name;
    }

    // security
    const cur = inp('Current password', { type: 'password', autocomplete: 'current-password' });
    const nw = inp('New password (10+ characters)', { type: 'password', autocomplete: 'new-password' });
    const pwMsg = h('div');
    const endMsg = h('div');
    const secPart = h('div', { class: 'form' },
      r.adminFromEnv ? note('Your password is set in the .env file (ADMIN_PASSWORD). Change it there and restart the app.') : h('div', { class: 'form' }, h('div', { class: 'inp' }, h('span', null, 'Change password')), cur.wrap, nw.wrap, pwMsg, h('div', null, h('button', { class: 'btn', type: 'button', onclick: async () => {
        const x = await api('/password', { method: 'POST', body: { current: cur.el.value, next: nw.el.value } });
        if (x.ok) { csrf = x.csrf; cur.el.value = ''; nw.el.value = ''; }
        pwMsg.replaceChildren(x.ok ? note('Password changed. You were signed out on every other device.', 'good') : note(x.error, 'err'));
      } }, 'Change password'))),
      h('div', { class: 'inp' }, h('span', null, 'Signed-in devices')),
      h('p', { class: 'sub', style: 'margin:0' }, 'Lost a phone or used a shared computer? Sign out everywhere else. This browser stays signed in.'),
      h('div', null, h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        const x = await api('/sessions/end-all', { method: 'POST' });
        if (x.ok) csrf = x.csrf;
        endMsg.replaceChildren(x.ok ? note('Done. Every other device is signed out.', 'good') : note(x.error, 'err'));
      } }, 'Sign out all other devices')), endMsg);

    const origin = location.origin;
    const inboundPart = h('div', { class: 'form', style: 'margin-top:20px' }, h('div', { class: 'inp' }, h('span', null, 'Receiving by webhook')),
      r.inbound.enabled ? note(h('span', null, 'Webhook is ON. Send raw mail (or JSON) with POST to ', h('code', null, origin + '/api/inbound'), ' and the header ', h('code', null, 'Authorization: Bearer <INBOUND_SECRET>'), '. See the README.'))
        : note('Webhook is OFF. Put INBOUND_SECRET=<a long random text> in .env to turn it on.'));
    const tabBar = h('div', { class: 'tabs', role: 'tablist' });
    function draw() {
      tabBar.replaceChildren(...tabs.map(t => h('button', { class: t === tab ? 'on' : '', role: 'tab', type: 'button', onclick: () => { tab = t; draw(); } }, t)));
      content.replaceChildren(tab === 'General' ? h('div', { class: 'form' }, theme.wrap, undoSel.wrap, sig.wrap, h('div', { class: 'inp' }, h('span', null, 'Notifications'), h('div', null, notifyBtn), notifyMsg))
        : tab === 'Branding' ? brandPart : tab === 'Sending' ? form.smtpPart : tab === 'Receiving' ? h('div', null, form.imapPart, inboundPart) : secPart);
      saveBtn.classList.toggle('hidden', tab === 'Security');
    }
    const msg = h('div');
    const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      saveBtn.disabled = true; msg.replaceChildren();
      try {
        const v = form.values();
        const res = await api('/settings', { method: 'PUT', body: { smtp: st.smtp.fromEnv ? undefined : v.smtp, imap: st.imap.fromEnv ? undefined : v.imap, signature: sig.el.value } });
        if (!res.ok) throw new Error(res.error);
        await saveBranding();
        state.signature = sig.el.value;
        close(); toast('Settings saved.');
      } catch (e) { msg.replaceChildren(note(e.message, 'err')); } finally { saveBtn.disabled = false; }
    } }, 'Save changes');
    const close = dialog([h('h2', null, 'Settings'), h('p', { class: 'sub' }, 'Signed in as ' + state.email), tabBar, content, msg,
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Close'), saveBtn)]);
    draw();
  }

  // ------------------------------------------------------------------ live new mail
  let events = null;
  function listen() {
    if (events || !('EventSource' in window)) return;
    events = new EventSource('/api/events');
    events.addEventListener('mail', e => {
      let d = {};
      try { d = JSON.parse(e.data); } catch (_) {}
      loadList(true);
      if (state.openId && d.threadId === state.openId) openThread(state.openId, true);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(String(d.from || 'New mail').slice(0, 80), { body: String(d.subject || '').slice(0, 140), icon: logoUrl(), tag: 'pkj-mail' });
          n.onclick = () => { window.focus(); location.hash = 'inbox/' + d.threadId; n.close(); };
        } catch (_) {}
      }
    });
    events.onerror = () => { if (!state.signedIn) { events.close(); events = null; } };
  }

  // ------------------------------------------------------------------ keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (!state.signedIn || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (document.querySelector('.scrim')) return;
    const idx = state.items.findIndex(m => keyOf(m) === state.openId);
    const cur = state.open ? state.open.messages : null;
    const last = cur ? [...cur].reverse().find(m => m.folder !== 'drafts') : null;
    const k = e.key;
    if (k === 'c') { e.preventDefault(); compose(); }
    else if (k === '/') { e.preventDefault(); els.search && els.search.focus(); }
    else if (k === 'j' || k === 'k') {
      const n = state.items[Math.max(0, Math.min(state.items.length - 1, idx + (k === 'j' ? 1 : -1)))];
      if (n) location.hash = viewHash(state.view) + '/' + keyOf(n);
    } else if ((k === 'u' || k === 'Escape') && state.openId) backToList();
    else if (k === 'e' && cur) bulkAction('archive', cur.map(m => m.id));
    else if (k === 'e' && state.selected.size) bulkAction('archive', selectedIds());
    else if (k === '#' && cur) bulkAction('trash', cur.map(m => m.id));
    else if (k === '#' && state.selected.size) bulkAction('trash', selectedIds());
    else if (k === '!' && cur) bulkAction('spam', cur.map(m => m.id));
    else if (k === 's' && last) { last.starred = !last.starred; renderReader(); api('/messages/' + last.id, { method: 'PATCH', body: { starred: last.starred } }).then(() => loadList(true)); }
    else if (k === 'r' && last) { e.preventDefault(); replyTo(last, 'reply'); }
    else if (k === 'a' && last) { e.preventDefault(); replyTo(last, 'all'); }
    else if (k === 'f' && last) { e.preventDefault(); replyTo(last, 'forward'); }
    else if (k === '?') { dialog([h('h2', null, 'Keyboard shortcuts'), h('div', { class: 'keys' }, [['c', 'Compose'], ['/', 'Search'], ['j / k', 'Older / newer conversation'], ['u or Esc', 'Back to the list'], ['e', 'Archive'], ['#', 'Delete'], ['!', 'Report spam'], ['s', 'Star'], ['r', 'Reply'], ['a', 'Reply all'], ['f', 'Forward'], ['Ctrl + Enter', 'Send (in Compose)']].map(([a, b]) => h('div', null, h('kbd', null, a), h('span', null, b))))]); }
  });

  // ------------------------------------------------------------------ start
  let poll;
  async function boot() {
    clearInterval(poll);
    if (events) { events.close(); events = null; }
    const s = await api('/status');
    if (!s.ok) { root().replaceChildren(h('div', { class: 'center-page' }, h('div', { class: 'card' }, h('h1', null, 'Cannot reach the server'), h('p', { class: 'sub' }, s.error), h('button', { class: 'btn primary', onclick: boot }, 'Try again')))); return; }
    applyBrand(s.brand);
    document.title = state.brand.name;
    if (!s.setupDone) return renderSetup(s);
    if (!s.signedIn) { state.signedIn = false; return renderLogin(); }
    csrf = s.csrf; state.signedIn = true; state.email = s.email; state.address = s.address || ''; state.name = s.name || '';
    const [l, st] = await Promise.all([api('/labels'), api('/settings')]);
    state.labels = l.ok ? l.labels : [];
    state.signature = st.ok ? st.settings.signature : '';
    state.items = [];
    renderShell();
    state.view = { folder: '__', label: null, q: '', page: 1 };
    await onRoute();
    listen();
    // a slow safety net; new mail normally arrives at once through the live connection
    poll = setInterval(() => { if (!document.hidden && state.signedIn) loadList(true); }, 60000);
  }
  addEventListener('hashchange', onRoute);
  addEventListener('resize', () => { if (state.openId && els.main) { const split = innerWidth > 1100 && store.get('pkj-split', false); els.main.classList.toggle('split', split); els.listPane.classList.toggle('hidden', !split); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.signedIn) loadList(true); });
  boot();
})();
