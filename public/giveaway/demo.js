// Preview mode: the page runs on example songs and a fake follower count, and nothing is saved.
// It turns on with ?demo in the URL, or by itself when the page is served without the server
// code (a plain file host, before Cloudflare is set up). A small DEMO bar switches between the
// locked and the open giveaway.
(function () {
  var forced = window.LUCIANO_DEMO || /[?&]demo\b/.test(location.search);
  var realStatus = API.status;
  var active = false;

  // Without ?demo: try the real server first, and only fall back when there is none.
  if (!forced) {
    API.status = function () {
      if (active) return fakeStatus();
      return realStatus().catch(function (e) {
        if (!e.noApi) throw e;
        start();
        return fakeStatus();
      });
    };
  }

  var mode = /[?&]locked\b/.test(location.search) ? '0' : '1';   // 0 locked, 1 open, 2 ended (portfolio)
  try { mode = sessionStorage.getItem('luciano:demo-open') || mode; } catch (e) {}
  var open = mode !== '0';
  var followers = 87;
  var songs = [
    { id: 'demo-1', title: 'Natlys', artist: '99 LUCIANO', cover: '/giveaway/demo/cover-1.jpg', file: '/giveaway/demo/snippet-1.wav', length: 15 },
    { id: 'demo-2', title: 'Rødt lys', artist: '99 LUCIANO', cover: '/giveaway/demo/cover-2.jpg', file: '/giveaway/demo/snippet-2.wav', length: 15 },
    { id: 'demo-3', title: 'Sommer i byen', artist: '99 LUCIANO', cover: null, file: '/giveaway/demo/snippet-3.wav', length: 15 }
  ];

  function fakeStatus() {
    if (!open) followers = Math.min(149, followers + Math.floor(Math.random() * 3));
    return Promise.resolve({
      prize: 'Gavekort på 150 kr. til hvad du vil',
      artist: '99 LUCIANO',
      ends_at: '2026-11-15T22:59:00Z',
      draw_at: '2026-11-20T23:00:00Z',
      followers: open ? 162 : followers,
      goal: 150,
      unlocked: open,
      closed: mode === '2',
      songs: songs
    });
  };

  function later(value) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, 450); });
  }

  function start() {
    if (active) return;
    active = true;
    API.status = fakeStatus;
    API.vote = function () { return later('ok'); };
    API.notify = function (contact) {
      var v = String(contact || '');
      return later(/@.+\./.test(v) || v.replace(/\D/g, '').length >= 8 ? 'ok' : 'bad_contact');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addBar);
    else addBar();
  }

  function reset() {
    try {
      Object.keys(localStorage).forEach(function (k) { if (/^luciano:/.test(k)) localStorage.removeItem(k); });
    } catch (e) {}
    try {
      document.cookie.split('; ').forEach(function (c) {
        var name = c.split('=')[0];
        if (/^luciano_/.test(name)) document.cookie = name + '=; Max-Age=0; Path=/';
      });
    } catch (e) {}
  }

  function setMode(v) {
    try { sessionStorage.setItem('luciano:demo-open', v); } catch (e) {}
    reset();
    location.reload();
  }

  function addBar() {
    var bar = document.createElement('div');
    bar.className = 'demo-bar';
    bar.innerHTML = '<b>Demo</b><button type="button" data-v="0">Låst</button><button type="button" data-v="1">Åben</button><button type="button" data-v="2">Slut</button><button type="button" data-reset>Forfra</button>';
    bar.querySelector('[data-v="' + mode + '"]').classList.add('is-on');
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-reset')) { reset(); location.reload(); }
      else setMode(b.getAttribute('data-v'));
    });
    document.body.appendChild(bar);
  }

  if (forced) start();
})();
