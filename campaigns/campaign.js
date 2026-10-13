(function () {
  var $ = function (id) { return document.getElementById(id); };
  var STORE = 'luciano:entries';
  var LEN = CAMPAIGN.snippetSeconds || 30;

  var selected = null;   // song id picked for the vote
  var playing = null;    // song id loaded in the player
  var entry = null;      // saved entry once voted
  var audio = new Audio();
  audio.preload = 'none';

  // ---------- helpers ----------

  function normalizeHandle(v) {
    var h = String(v || '').trim().toLowerCase();
    var url = h.match(/instagram\.com\/([^/?#]+)/);
    if (url) h = url[1];
    h = h.replace(/^@+/, '');
    if (!/^[a-z0-9._]{1,30}$/.test(h) || /^\.|\.$|\.\./.test(h)) return null;
    return h;
  }

  function song(id) {
    for (var i = 0; i < CAMPAIGN.songs.length; i++) if (CAMPAIGN.songs[i].id === id) return CAMPAIGN.songs[i];
    return null;
  }

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
  }
  function writeStore(data) {
    try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) {}
  }

  function row(id) { return document.querySelector('.track[data-id="' + id + '"]'); }

  // ---------- text that depends on the language ----------

  function renderText() {
    var da = window.lang() === 'da';
    $('prize').textContent = (da && CAMPAIGN.prizeDa) || CAMPAIGN.prize;
    $('ends').textContent = new Date(CAMPAIGN.endsAt).toLocaleDateString(da ? 'da-DK' : 'en-GB', { day: 'numeric', month: 'long' });

    var s = song(selected);
    $('submit').textContent = s ? t('vote.for', 'Vote for “{song}”', { song: s.title }) : t('vote.pick', 'Pick a track');
    document.querySelectorAll('.track__pick').forEach(function (el) { el.textContent = t('vote.yours', 'Your vote'); });

    if (entry) renderDone();
  }

  // ---------- step 1 + 2 ----------

  var ig = 'https://instagram.com/' + CAMPAIGN.instagram;
  $('follow').href = ig;
  $('follow-handle').textContent = '@' + CAMPAIGN.instagram;
  $('closed-ig').href = ig;
  $('closed-ig').textContent = '@' + CAMPAIGN.instagram;
  $('follow').addEventListener('click', function () { $('follow').classList.add('is-done'); });

  var input = $('handle');
  var note = $('handle-note');

  function handleError(show) {
    note.classList.toggle('is-error', show);
    note.innerHTML = show
      ? t('vote.err.bad_handle', "That doesn't look like an Instagram username.")
      : t('c.s2.note', 'We check that you follow before the winner is drawn.');
  }
  input.addEventListener('input', function () { if (note.classList.contains('is-error')) handleError(false); });
  input.addEventListener('blur', function () { handleError(!!input.value.trim() && !normalizeHandle(input.value)); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });

  // ---------- step 3: snippets ----------

  CAMPAIGN.songs.forEach(function (s) {
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'track';
    btn.dataset.id = s.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.innerHTML = '<span class="track__btn" aria-hidden="true"></span><span class="track__name"></span>' +
      '<span class="track__time">' + fmt(LEN) + '</span><span class="track__pick" hidden></span><span class="track__bar"></span>';
    btn.querySelector('.track__name').textContent = s.title;
    btn.addEventListener('click', function () { tap(s); });
    li.appendChild(btn);
    $('tracks').appendChild(li);
  });

  function tap(s) {
    selected = s.id;
    document.querySelectorAll('.track').forEach(function (el) {
      var on = el.dataset.id === s.id;
      el.setAttribute('aria-checked', String(on));
      el.querySelector('.track__pick').hidden = !on;
    });
    $('submit').disabled = false;
    $('msg').hidden = true;
    renderText();

    if (playing === s.id && !audio.paused) { audio.pause(); return; }
    if (playing !== s.id) {
      stopRow(playing);
      playing = s.id;
      audio.src = s.file;
    }
    audio.play().catch(function () { setTime(s.id, t('vote.err.unavailable', 'Snippet unavailable')); });
  }

  function setTime(id, text) {
    var el = row(id);
    if (el) el.querySelector('.track__time').textContent = text;
  }

  function stopRow(id) {
    var el = row(id);
    if (!el) return;
    el.classList.remove('is-playing');
    el.querySelector('.track__bar').style.transform = 'scaleX(0)';
    setTime(id, fmt(LEN));
  }

  function length() {
    return isFinite(audio.duration) && audio.duration > 0 ? Math.min(audio.duration, LEN) : LEN;
  }

  var raf = 0;
  function tick() {
    var len = length();
    if (audio.currentTime >= len) {
      audio.pause();
      audio.currentTime = 0;
      stopRow(playing);
      return;
    }
    var el = row(playing);
    if (el) {
      el.querySelector('.track__bar').style.transform = 'scaleX(' + audio.currentTime / len + ')';
      setTime(playing, fmt(audio.currentTime) + ' / ' + fmt(len));
    }
    if (!audio.paused) raf = requestAnimationFrame(tick);
  }

  audio.addEventListener('playing', function () {
    var el = row(playing);
    if (el) el.classList.add('is-playing');
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  });
  audio.addEventListener('pause', function () {
    cancelAnimationFrame(raf);
    var el = row(playing);
    if (el) el.classList.remove('is-playing');
  });
  audio.addEventListener('ended', function () { stopRow(playing); });
  audio.addEventListener('error', function () {
    if (!playing) return;
    stopRow(playing);
    setTime(playing, t('vote.err.unavailable', 'Snippet unavailable'));
  });

  // ---------- vote ----------

  var ERRORS = {
    bad_handle: "That doesn't look like an Instagram username.",
    bad_song: 'Pick one of the tracks.',
    closed: 'The giveaway is closed.',
    too_many: 'Too many votes from this network.'
  };

  function showMsg(key, fallback) {
    $('msg').textContent = t(key, fallback);
    $('msg').hidden = false;
  }

  $('submit').addEventListener('click', function () {
    var handle = normalizeHandle(input.value);
    if (!handle) {
      handleError(!!input.value.trim());
      if (!input.value.trim()) showMsg('vote.err.handle', 'Add your Instagram username above.');
      input.focus();
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!selected) return;

    var btn = $('submit');
    btn.disabled = true;
    btn.textContent = t('vote.sending', 'Sending…');
    $('msg').hidden = true;

    rpc('luciano_vote', { p_campaign: CAMPAIGN.id, p_handle: handle, p_song: selected })
      .then(function (result) {
        if (result !== 'ok' && result !== 'already') {
          showMsg('vote.err.' + result, ERRORS[result] || 'Something went wrong. Try again.');
          if (result === 'closed') setTimeout(showClosed, 1500);
          return;
        }
        var all = readStore();
        all[CAMPAIGN.id] = { handle: handle, song: result === 'ok' ? selected : null, already: result === 'already' };
        writeStore(all);
        audio.pause();
        showDone(all[CAMPAIGN.id]);
      })
      .catch(function (e) {
        if (e.message === 'offline') showMsg('vote.err.net', 'No connection. Try again.');
        else { $('msg').textContent = e.message; $('msg').hidden = false; }
      })
      .then(function () {
        btn.disabled = !selected;
        renderText();
      });
  });

  // ---------- done / closed ----------

  function renderDone() {
    var s = song(entry.song);
    $('done-handle').textContent = '@' + entry.handle;
    $('done-song').textContent = s ? s.title : '';
    $('done-song-row').hidden = !s;
    $('done-already').hidden = !entry.already;
    $('done-already').textContent = t('vote.already', "@{handle} has already voted, so you're already in. One vote per person.", { handle: entry.handle });
    $('done-announce').textContent = t('vote.announce', 'The winner is announced on Instagram when the giveaway ends.');
  }

  function showDone(e) {
    entry = e;
    renderDone();
    $('enter').hidden = true;
    $('closed').hidden = true;
    $('done').hidden = false;
    window.scrollTo(0, 0);
  }

  function showClosed() {
    $('enter').hidden = true;
    $('closed').hidden = false;
    window.scrollTo(0, 0);
  }

  $('share').addEventListener('click', function () {
    var url = location.href.split('#')[0].split('?')[0];
    if (navigator.share) {
      navigator.share({ title: '99 LUCIANO', url: url }).catch(function () {});
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { $('share').textContent = t('vote.copied', 'Link copied'); });
    }
  });

  // ---------- start ----------

  document.addEventListener('langchange', renderText);
  renderText();

  var saved = readStore()[CAMPAIGN.id];
  if (saved) showDone(saved);
  else if (Date.now() > Date.parse(CAMPAIGN.endsAt)) showClosed();
})();
