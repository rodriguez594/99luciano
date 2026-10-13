(function () {
  var $ = function (id) { return document.getElementById(id); };
  var all = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  var STORE = 'luciano:entries';
  var NOTIFY_STORE = 'luciano:notify';
  var LEN = CAMPAIGN.snippetSeconds || 30;
  var POLL = 30000;
  var IG_URL = 'https://instagram.com/' + CAMPAIGN.instagram;

  var view = null;       // 'locked' | 'open' | 'done' | 'closed'
  var selected = null;   // song id picked for the vote
  var playing = null;    // song id loaded in the player
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

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; }
  }
  function save(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  }

  function show(name) {
    if (view === name) return;
    view = name;
    $('intro').hidden = name === 'done' || name === 'closed';
    ['locked', 'open', 'done', 'closed'].forEach(function (id) { $(id).hidden = id !== name; });
    $('intro-label').textContent = name === 'open' ? 'Giveaway · Åben' : 'Giveaway';
    if (name === 'done' || name === 'closed') window.scrollTo(0, 0);
  }

  // ---------- static text ----------

  $('prize').textContent = CAMPAIGN.prize;
  $('ends').textContent = new Date(CAMPAIGN.endsAt).toLocaleDateString('da-DK', { day: 'numeric', month: 'long' });
  all('.ig-handle').forEach(function (el) { el.textContent = '@' + CAMPAIGN.instagram; });
  all('.ig-link').forEach(function (el) { el.href = IG_URL; });
  all('.goal').forEach(function (el) { el.textContent = CAMPAIGN.goal; });

  // ---------- share the Instagram profile ----------

  all('.share-ig').forEach(function (btn) {
    var label = btn.innerHTML;
    btn.addEventListener('click', function () {
      var text = 'Følg @' + CAMPAIGN.instagram + ' på Instagram';
      if (navigator.share) {
        navigator.share({ title: '99 LUCIANO', text: text, url: IG_URL }).catch(function () {});
        return;
      }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(IG_URL).then(function () {
          btn.textContent = 'Link kopieret';
          setTimeout(function () { btn.innerHTML = label; }, 2500);
        });
      }
    });
  });

  // ---------- locked: follower count ----------

  var shown = null;
  function renderCount(followers, goal) {
    var el = $('count');
    var from = shown == null ? 0 : shown;
    shown = followers;
    $('bar').style.transform = 'scaleX(' + Math.min(1, followers / goal) + ')';
    // Count up to the new number
    var start = performance.now();
    (function step(now) {
      var p = Math.min(1, (now - start) / 900);
      el.textContent = Math.round(from + (followers - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    })(start);
  }

  function apply(status) {
    if (!status) return;
    if (status.closed) { if (view !== 'done') show('closed'); return; }
    if (view === 'done') return;
    renderCount(status.followers, status.goal);
    $('lock-note').textContent = 'Opdateres hvert 30. sekund';
    show(status.unlocked ? 'open' : 'locked');
  }

  var timer = 0;
  function poll() {
    clearTimeout(timer);
    giveawayStatus()
      .then(apply, function () {
        if (!view) show('locked');
        $('lock-note').textContent = 'Kunne ikke hente antal følgere. Prøver igen om lidt.';
      })
      .then(function () {
        if (view !== 'done' && view !== 'closed') timer = setTimeout(poll, POLL);
      });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && view !== 'done' && view !== 'closed') poll();
  });

  // ---------- locked: notify me ----------

  function showNotified(contact) {
    $('notify-form').hidden = true;
    $('notify-done').hidden = false;
    $('notify-contact').textContent = contact;
  }

  var NOTIFY_ERRORS = {
    bad_contact: 'Skriv en email eller et telefonnummer.',
    too_many: 'For mange tilmeldinger fra dette netværk.',
    open: 'Giveawayen er allerede åben. Stem herunder.'
  };

  function notify() {
    var value = $('contact').value.trim();
    var note = $('notify-note');
    if (!value) {
      note.textContent = NOTIFY_ERRORS.bad_contact;
      note.classList.add('is-error');
      $('contact').focus();
      return;
    }
    var btn = $('notify');
    btn.disabled = true;
    btn.textContent = 'Sender…';
    rpc('luciano_notify_me', { p_campaign: CAMPAIGN.id, p_contact: value })
      .then(function (result) {
        if (result === 'ok' || result === 'already') {
          var saved = load(NOTIFY_STORE);
          saved[CAMPAIGN.id] = value;
          save(NOTIFY_STORE, saved);
          showNotified(value);
          return;
        }
        note.textContent = NOTIFY_ERRORS[result] || 'Noget gik galt. Prøv igen.';
        note.classList.add('is-error');
        if (result === 'open') poll();
      }, function (e) {
        note.textContent = e.message === 'offline' ? 'Ingen forbindelse. Prøv igen.' : e.message;
        note.classList.add('is-error');
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = 'Giv mig besked';
      });
  }

  $('notify').addEventListener('click', notify);
  $('contact').addEventListener('keydown', function (e) { if (e.key === 'Enter') notify(); });
  $('contact').addEventListener('input', function () {
    $('notify-note').classList.remove('is-error');
    $('notify-note').textContent = 'Vi bruger det kun til at sige til, når giveawayen åbner.';
  });
  var notified = load(NOTIFY_STORE)[CAMPAIGN.id];
  if (notified) showNotified(notified);

  // ---------- open: follow + username ----------

  $('follow').addEventListener('click', function () { $('follow').classList.add('is-done'); });

  var input = $('handle');
  var handleNote = $('handle-note');
  function handleError(show) {
    handleNote.classList.toggle('is-error', show);
    handleNote.textContent = show
      ? 'Det ligner ikke et Instagram-brugernavn.'
      : 'Vi tjekker, at du følger, før vinderen bliver trukket.';
  }
  input.addEventListener('input', function () { if (handleNote.classList.contains('is-error')) handleError(false); });
  input.addEventListener('blur', function () { handleError(!!input.value.trim() && !normalizeHandle(input.value)); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });

  // ---------- open: snippets ----------

  CAMPAIGN.songs.forEach(function (s) {
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'track';
    btn.dataset.id = s.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.innerHTML = '<span class="track__btn" aria-hidden="true"></span><span class="track__name"></span>' +
      '<span class="track__time">' + fmt(LEN) + '</span><span class="track__pick" hidden>Din stemme</span><span class="track__bar"></span>';
    btn.querySelector('.track__name').textContent = s.title;
    btn.addEventListener('click', function () { tap(s); });
    li.appendChild(btn);
    $('tracks').appendChild(li);
  });

  function row(id) { return document.querySelector('.track[data-id="' + id + '"]'); }

  function tap(s) {
    selected = s.id;
    all('.track').forEach(function (el) {
      var on = el.dataset.id === s.id;
      el.setAttribute('aria-checked', String(on));
      el.querySelector('.track__pick').hidden = !on;
    });
    $('submit').disabled = false;
    $('submit').textContent = 'Stem på ' + s.title;
    $('msg').hidden = true;

    if (playing === s.id && !audio.paused) { audio.pause(); return; }
    if (playing !== s.id) {
      stopRow(playing);
      playing = s.id;
      audio.src = s.file;
    }
    audio.play().catch(function () { setTime(s.id, 'Kan ikke afspilles'); });
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
    setTime(playing, 'Kan ikke afspilles');
  });

  // ---------- open: vote ----------

  var VOTE_ERRORS = {
    bad_handle: 'Det ligner ikke et Instagram-brugernavn.',
    bad_song: 'Vælg et af numrene.',
    closed: 'Giveawayen er lukket.',
    locked: 'Giveawayen er ikke åben endnu.',
    too_many: 'For mange stemmer fra dette netværk.'
  };

  function showMsg(text) {
    $('msg').textContent = text;
    $('msg').hidden = false;
  }

  $('submit').addEventListener('click', function () {
    var handle = normalizeHandle(input.value);
    if (!handle) {
      handleError(!!input.value.trim());
      if (!input.value.trim()) showMsg('Skriv dit Instagram-brugernavn ovenfor.');
      input.focus();
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (!selected) return;

    var btn = $('submit');
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sender…';
    $('msg').hidden = true;

    rpc('luciano_vote', { p_campaign: CAMPAIGN.id, p_handle: handle, p_song: selected })
      .then(function (result) {
        if (result !== 'ok' && result !== 'already') {
          showMsg(VOTE_ERRORS[result] || 'Noget gik galt. Prøv igen.');
          if (result === 'closed' || result === 'locked') poll();
          return;
        }
        var entries = load(STORE);
        entries[CAMPAIGN.id] = { handle: handle, song: result === 'ok' ? selected : null, already: result === 'already' };
        save(STORE, entries);
        audio.pause();
        showDone(entries[CAMPAIGN.id]);
      }, function (e) {
        showMsg(e.message === 'offline' ? 'Ingen forbindelse. Prøv igen.' : e.message);
      })
      .then(function () {
        btn.disabled = !selected;
        btn.textContent = label;
      });
  });

  // ---------- done ----------

  function showDone(entry) {
    var s = song(entry.song);
    $('done-handle').textContent = '@' + entry.handle;
    $('done-song').textContent = s ? s.title : '';
    $('done-song-row').hidden = !s;
    $('done-already').hidden = !entry.already;
    $('done-already').textContent = '@' + entry.handle + ' har allerede stemt, så du er allerede med. Én stemme per person.';
    clearTimeout(timer);
    show('done');
  }

  // ---------- start ----------

  var entry = load(STORE)[CAMPAIGN.id];
  if (entry) showDone(entry);
  else if (Date.now() > Date.parse(CAMPAIGN.endsAt)) show('closed');
  else poll();
})();
