// 99luciano.dk/vault: unreleased songs that can be played only for a set time (set at /management/vault).
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var audio = new Audio();
  audio.preload = 'none';
  var drops = [], playing = null, counted = {}, nextAt = null, tickTimer = 0, poll = 0;

  function load() {
    fetch('/api/vault', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error();
      return r.json();
    }).then(render, function () {
      $('vault-note').textContent = 'Vaulten kunne ikke åbnes lige nu. Prøv igen om lidt.';
    });
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }

  // "23:59:12" or "2 dage 04:10:00"
  function left(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, x = s % 60;
    var hms = ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2) + ':' + ('0' + x).slice(-2);
    return d ? d + (d === 1 ? ' dag ' : ' dage ') + hms : hms;
  }

  function danish(iso) {
    return new Date(iso).toLocaleString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  }

  function render(d) {
    $('vault-note').textContent = '';
    // Keep playing if the same song is still open
    var keep = playing && d.live.some(function (x) { return x.id === playing; });
    if (!keep) stop();
    drops = d.live;
    nextAt = d.next ? Date.parse(d.next) : null;
    var box = $('vault-live');
    box.innerHTML = '';
    drops.forEach(function (x) { box.appendChild(card(x)); });
    $('vault-locked').hidden = drops.length > 0;
    $('vault-next').hidden = !nextAt;
    $('next-when').textContent = nextAt ? danish(d.next) : '';
    $('vault-follow').hidden = !!nextAt && false;
    if (keep) markPlaying();
    tick();
    clearTimeout(poll);
    poll = setTimeout(load, 60000);
  }

  function card(x) {
    var el = $('drop-tpl').content.firstElementChild.cloneNode(true);
    el.dataset.id = x.id;
    var cover = el.querySelector('.drop__cover');
    if (x.cover) cover.style.backgroundImage = 'url("' + x.cover + '")';
    else cover.classList.add('is-blank');
    el.querySelector('.drop__artist').textContent = x.artist || '99 LUCIANO';
    el.querySelector('.drop__title').textContent = x.title;
    el.querySelector('.drop__note').textContent = x.note || '';
    el.querySelector('.drop__note').hidden = !x.note;
    el.querySelector('.drop__play').addEventListener('click', function () { toggle(x); });
    var bar = el.querySelector('.drop__bar');
    bar.addEventListener('click', function (e) {
      if (playing !== x.id || !audio.duration) return;
      var r = bar.getBoundingClientRect();
      audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
    });
    return el;
  }

  function toggle(x) {
    if (playing === x.id) {
      if (audio.paused) audio.play(); else audio.pause();
      return;
    }
    stop();
    playing = x.id;
    audio.src = x.audio;
    audio.play().catch(function () {
      $('vault-note').textContent = 'Sangen kunne ikke afspilles. Den er måske lige forsvundet.';
      load();
    });
    if (!counted[x.id]) {
      counted[x.id] = true;
      fetch('/api/vault/play/' + encodeURIComponent(x.id), { method: 'POST' }).catch(function () {});
    }
    markPlaying();
  }

  function stop() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    playing = null;
    markPlaying();
  }

  function markPlaying() {
    Array.prototype.forEach.call(document.querySelectorAll('.drop'), function (el) {
      var on = el.dataset.id === playing;
      el.classList.toggle('is-playing', on && !audio.paused);
      el.classList.toggle('is-loaded', on);
      el.querySelector('.drop__play').setAttribute('aria-label', on && !audio.paused ? 'Pause' : 'Afspil');
      if (!on) {
        el.querySelector('.drop__bar i').style.transform = 'scaleX(0)';
        el.querySelector('.drop__time').textContent = '0:00';
      }
    });
  }

  ['play', 'pause', 'ended'].forEach(function (t) { audio.addEventListener(t, markPlaying); });
  audio.addEventListener('timeupdate', function () {
    var el = document.querySelector('.drop[data-id="' + playing + '"]');
    if (!el) return;
    el.querySelector('.drop__bar i').style.transform = 'scaleX(' + (audio.duration ? audio.currentTime / audio.duration : 0) + ')';
    el.querySelector('.drop__time').textContent = fmt(audio.currentTime) + (audio.duration && isFinite(audio.duration) ? ' / ' + fmt(audio.duration) : '');
  });

  // Countdowns, once a second. A song whose time is up disappears (and stops).
  function tick() {
    clearTimeout(tickTimer);
    var t = Date.now(), gone = false;
    drops.forEach(function (x) {
      var ms = Date.parse(x.ends_at) - t;
      var el = document.querySelector('.drop[data-id="' + x.id + '"] .drop__left');
      if (el) el.textContent = left(ms);
      if (ms <= 0) gone = true;
    });
    if (nextAt) {
      var s = Math.max(0, Math.floor((nextAt - t) / 1000));
      var parts = { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
      Array.prototype.forEach.call(document.querySelectorAll('[data-n]'), function (el) {
        var k = el.dataset.n;
        el.textContent = k === 'd' ? parts.d : ('0' + parts[k]).slice(-2);
      });
      if (s <= 0) gone = true;
    }
    if (gone) { load(); return; }
    tickTimer = setTimeout(tick, 1000 - (t % 1000) + 20);
  }

  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') load(); });
  // No right-click "save audio" on the player
  document.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('.drop')) e.preventDefault(); });

  load();
})();
