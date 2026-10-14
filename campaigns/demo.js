// Preview mode: runs when Supabase isn't set up yet (or with ?demo in the URL).
// The page uses example songs and a fake follower count, and nothing is saved anywhere.
// A small DEMO bar lets you switch between the locked and the open giveaway.
(function () {
  if (SUPABASE.url && SUPABASE.anonKey && !/[?&]demo\b/.test(location.search)) return;

  var open = /[?&]open\b/.test(location.search);
  try { open = open || sessionStorage.getItem('luciano:demo-open') === '1'; } catch (e) {}
  var followers = 87;
  var songs = [
    { id: 'demo-1', title: 'Natlys', artist: '99 LUCIANO', cover: 'demo/cover-1.jpg', file: 'demo/snippet-1.wav' },
    { id: 'demo-2', title: 'Rødt lys', artist: '99 LUCIANO', cover: 'demo/cover-2.jpg', file: 'demo/snippet-2.wav' },
    { id: 'demo-3', title: 'Sommer i byen', artist: '99 LUCIANO', cover: 'demo/cover-3.jpg', file: 'demo/snippet-3.wav' }
  ];

  window.giveawayStatus = function () {
    if (!open) followers = Math.min(149, followers + Math.floor(Math.random() * 3));
    return Promise.resolve({
      prize: 'Gavekort på 150 kr. til hvad du vil',
      artist: '99 LUCIANO',
      ends_at: '2026-11-15T22:59:00Z',
      followers: open ? 162 : followers,
      goal: 150,
      unlocked: open,
      closed: false,
      songs: songs
    });
  };

  window.rpc = function (name, args) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (name === 'luciano_notify_me') {
          var v = String(args.p_contact || '');
          resolve(/@.+\./.test(v) || v.replace(/\D/g, '').length >= 8 ? 'ok' : 'bad_contact');
        } else {
          resolve('ok');
        }
      }, 450);
    });
  };

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

  function setOpen(v) {
    try { sessionStorage.setItem('luciano:demo-open', v ? '1' : '0'); } catch (e) {}
    reset();
    location.reload();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.className = 'demo-bar';
    bar.innerHTML = '<b>Demo</b><button type="button" data-v="0">Låst</button><button type="button" data-v="1">Åben</button><button type="button" data-reset>Forfra</button>';
    bar.querySelector('[data-v="' + (open ? 1 : 0) + '"]').classList.add('is-on');
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-reset')) { reset(); location.reload(); }
      else setOpen(b.getAttribute('data-v') === '1');
    });
    document.body.appendChild(bar);
  });
})();
