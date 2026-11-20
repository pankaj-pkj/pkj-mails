// Runs before the page draws, so a dark-mode user never sees a white flash.
(function () {
  var t = 'system';
  try { t = localStorage.getItem('pkj-theme') || 'system'; } catch (_) {}
  var dark = t === 'dark' || (t === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
