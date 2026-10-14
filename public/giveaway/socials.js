// App icons for the socials in SOCIALS (giveaway/config.js): fills every .apps box with icons
// and every .footer__socials with text links.
(function () {
  var all = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var GLYPHS = {
    Instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none"/></svg>',
    TikTok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 2.5c.4 2.4 1.9 4 4.4 4.3v3.3c-1.6.1-3.1-.4-4.4-1.2v6.6c0 3.5-2.7 6-6.1 6-3.3 0-6-2.5-6-5.8 0-3.6 3.1-6.2 6.8-5.7v3.4c-1.7-.4-3.5.6-3.5 2.4 0 1.5 1.2 2.5 2.7 2.5 1.6 0 2.7-1.1 2.7-2.9V2.5h3.4z"/></svg>',
    Spotify: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M7 9.4c3.5-1 7.4-.7 10.4 1" stroke="#fff" stroke-width="1.9"/><path d="M7.6 12.6c2.9-.8 5.9-.5 8.5.9" stroke="#fff" stroke-width="1.6"/><path d="M8.2 15.5c2.3-.6 4.5-.4 6.6.7" stroke="#fff" stroke-width="1.4"/></svg>'
  };

  function renderSocials() {
    var list = (window.SOCIALS || []).filter(function (x) { return x.url; });
    all('.apps').forEach(function (box) {
      box.innerHTML = '';
      list.forEach(function (x) {
        var a = document.createElement('a');
        a.className = 'app';
        a.href = x.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.setAttribute('aria-label', x.name);
        a.title = x.name;
        a.innerHTML = GLYPHS[x.name] || '';
        box.appendChild(a);
      });
    });
    all('.footer__socials').forEach(function (box) {
      box.innerHTML = '';
      list.forEach(function (x) {
        var a = document.createElement('a');
        a.href = x.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = x.name;
        box.appendChild(a);
      });
    });
  }

  renderSocials();
})();
