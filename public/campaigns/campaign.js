(function () {
  var $ = function (id) { return document.getElementById(id); };
  var all = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  var STORE = 'luciano:entries';
  var NOTIFY_STORE = 'luciano:notify';
  var LEN = CAMPAIGN.snippetSeconds || 30;
  var POLL = 30000;
  var IG_URL = 'https://instagram.com/' + CAMPAIGN.instagram;

  var view = null;       // 'locked' | 'open' | 'done' | 'closed'
  var songs = [];        // from the database (edited at /management)
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
    for (var i = 0; i < songs.length; i++) if (songs[i].id === id) return songs[i];
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

  // Cookies sit next to localStorage so clearing one of them doesn't reset the vote.
  // (Some embedded browsers refuse cookies outright, so every access is wrapped.)
  function getCookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function setCookie(name, value) {
    try {
      document.cookie = name + '=' + encodeURIComponent(value) + '; Max-Age=31536000; Path=/; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) {}
  }

  // A random id for this browser, so /management can flag several usernames from one device.
  function deviceId() {
    var ok = function (v) { return /^[a-f0-9]{32}$/.test(v || '') ? v : null; };
    var id = ok(getCookie('luciano_device'));
    try { id = id || ok(localStorage.getItem('luciano:device')); } catch (e) {}
    if (!id) {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    setCookie('luciano_device', id);
    try { localStorage.setItem('luciano:device', id); } catch (e) {}
    return id;
  }

  // The saved vote for this giveaway, from storage or the cookie.
  function savedEntry() {
    var entry = load(STORE)[CAMPAIGN.id];
    if (entry) return entry;
    try { return JSON.parse(getCookie('luciano_vote_' + CAMPAIGN.id)); } catch (e) { return null; }
  }
  function saveEntry(entry) {
    var entries = load(STORE);
    entries[CAMPAIGN.id] = entry;
    save(STORE, entries);
    setCookie('luciano_vote_' + CAMPAIGN.id, JSON.stringify(entry));
  }

  function show(name) {
    if (view === name) return;
    view = name;
    $('intro').hidden = name === 'done' || name === 'closed';
    ['locked', 'open', 'done', 'closed'].forEach(function (id) { $(id).hidden = id !== name; });
    $('intro-label').textContent = name === 'open' ? 'Giveaway · Åben' : 'Giveaway';
    if (name === 'done' || name === 'closed') window.scrollTo(0, 0);
  }

  // ---------- text ----------

  function renderSettings(status) {
    $('prize').textContent = status.prize || '–';
    $('ends').textContent = status.ends_at
      ? new Date(status.ends_at).toLocaleDateString('da-DK', { day: 'numeric', month: 'long' })
      : '–';
    all('.goal').forEach(function (el) { el.textContent = status.goal; });
  }

  all('.ig-handle').forEach(function (el) { el.textContent = '@' + CAMPAIGN.instagram; });
  all('.ig-link').forEach(function (el) { el.href = IG_URL; });

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
    renderSettings(status);
    renderSongs(status.songs || []);
    if (status.closed) { if (view !== 'done') show('closed'); return; }
    if (view === 'done') return;
    renderCount(status.followers, status.goal);
    $('lock-note').textContent = 'Opdateres hvert 30. sekund';
    show(status.unlocked ? 'open' : 'locked');
  }

  var timer = 0;
  function poll() {
    clearTimeout(timer);
    API.status()
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
    API.notify(value)
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

  // ---------- open: snippets (record sleeves) ----------

  // Album art, or a plain 99 sleeve until the cover is added.
  function art(el, s) {
    el.classList.toggle('is-blank', !s.cover);
    el.style.backgroundImage = s.cover ? 'url("' + s.cover + '")' : '';
    if (el.classList.contains('sleeve') || el.classList.contains('cover__art')) el.textContent = s.cover ? '' : s.title;
  }

  // Builds the grid of covers. Only redraws when the songs actually changed.
  var songsKey = '';
  function renderSongs(list) {
    var key = JSON.stringify(list);
    if (key === songsKey) return;
    songsKey = key;
    songs = list;
    $('covers').innerHTML = '';
    $('no-songs').hidden = list.length > 0;
    list.forEach(addCover);
    if (selected && !song(selected)) {
      selected = null;
      $('submit').disabled = true;
      $('submit').textContent = 'Vælg et nummer';
    }
    if (selected) all('.cover').forEach(function (el) { el.setAttribute('aria-checked', String(el.dataset.id === selected)); });
    if (playing && !song(playing)) {
      audio.pause();
      playing = null;
      $('player').hidden = true;
    }
  }

  function addCover(s) {
    var li = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cover';
    btn.dataset.id = s.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.innerHTML = '<span class="cover__art art"></span><span class="cover__pick">Din stemme</span>' +
      '<span class="cover__title"></span><span class="cover__artist"></span>';
    art(btn.querySelector('.cover__art'), s);
    btn.querySelector('.cover__title').textContent = s.title;
    btn.querySelector('.cover__artist').textContent = s.artist;
    btn.addEventListener('click', function () { tap(s); });
    li.appendChild(btn);
    $('covers').appendChild(li);
  }

  var deck = $('deck');
  var swapTimer = 0;

  // Puts a song on the deck: the old record slides back in, the new one slides out.
  function putOnDeck(s) {
    var wasOut = deck.classList.contains('is-out');
    $('player').hidden = false;
    deck.classList.remove('is-out', 'is-spinning');
    clearTimeout(swapTimer);
    swapTimer = setTimeout(function () {
      art($('sleeve'), s);
      art($('record-label'), s);
      $('player-artist').textContent = s.artist;
      $('player-title').textContent = s.title;
      deck.offsetWidth; // restart the slide
      deck.classList.add('is-out');
      if (!audio.paused) deck.classList.add('is-spinning');
    }, wasOut ? 380 : 0);
    var box = $('player').getBoundingClientRect();
    if (box.top < 70 || box.top > window.innerHeight * 0.5) {
      $('player').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function tap(s) {
    selected = s.id;
    all('.cover').forEach(function (el) { el.setAttribute('aria-checked', String(el.dataset.id === s.id)); });
    $('submit').disabled = false;
    $('submit').textContent = 'Stem på ' + s.title;
    $('msg').hidden = true;

    if (playing === s.id) { toggle(); return; }
    playing = s.id;
    putOnDeck(s);
    resetTime();
    audio.src = s.file;
    // play() has to start inside the tap, or phones block it
    audio.play().catch(function () { $('player-time').textContent = 'Kan ikke afspilles'; });
  }

  function toggle() {
    if (!playing) return;
    if (audio.paused) audio.play().catch(function () {});
    else audio.pause();
  }
  deck.addEventListener('click', toggle);
  $('player-toggle').addEventListener('click', toggle);

  function length() {
    return isFinite(audio.duration) && audio.duration > 0 ? Math.min(audio.duration, LEN) : LEN;
  }

  function resetTime() {
    $('player-bar').style.transform = 'scaleX(0)';
    $('player-time').textContent = fmt(0) + ' / ' + fmt(LEN);
  }

  var raf = 0;
  function tick() {
    var len = length();
    if (audio.currentTime >= len) {
      audio.pause();
      audio.currentTime = 0;
      resetTime();
      return;
    }
    $('player-bar').style.transform = 'scaleX(' + audio.currentTime / len + ')';
    $('player-time').textContent = fmt(audio.currentTime) + ' / ' + fmt(len);
    if (!audio.paused) raf = requestAnimationFrame(tick);
  }

  function setPlaying(on) {
    if (on && deck.classList.contains('is-out')) deck.classList.add('is-spinning');
    deck.classList.toggle('is-paused', !on);
    $('player-toggle').textContent = on ? 'Pause' : 'Afspil';
    all('.cover').forEach(function (el) { el.classList.toggle('is-playing', on && el.dataset.id === playing); });
  }

  audio.addEventListener('playing', function () {
    setPlaying(true);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  });
  audio.addEventListener('pause', function () {
    cancelAnimationFrame(raf);
    setPlaying(false);
  });
  audio.addEventListener('ended', function () { setPlaying(false); resetTime(); });
  audio.addEventListener('error', function () {
    if (!playing) return;
    setPlaying(false);
    $('player-time').textContent = 'Kan ikke afspilles';
  });

  // ---------- open: vote ----------

  var VOTE_ERRORS = {
    bad_handle: 'Det ligner ikke et Instagram-brugernavn.',
    bad_song: 'Vælg et af numrene.',
    closed: 'Giveawayen er lukket.',
    locked: 'Giveawayen er ikke åben endnu.'
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

    API.vote(handle, selected, deviceId())
      .then(function (result) {
        if (result !== 'ok' && result !== 'already') {
          showMsg(VOTE_ERRORS[result] || 'Noget gik galt. Prøv igen.');
          if (result === 'closed' || result === 'locked') poll();
          return;
        }
        var picked = song(selected);
        var entry = { handle: handle, title: result === 'ok' && picked ? picked.title : null, already: result === 'already' };
        saveEntry(entry);
        audio.pause();
        showDone(entry);
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
    $('done-handle').textContent = '@' + entry.handle;
    $('done-song').textContent = entry.title || '';
    $('done-song-row').hidden = !entry.title;
    $('done-already').hidden = !entry.already;
    $('done-already').textContent = '@' + entry.handle + ' har allerede stemt, så du er allerede med. Én stemme per person.';
    clearTimeout(timer);
    show('done');
  }

  // ---------- start ----------

  deviceId();
  var entry = savedEntry();
  if (entry) {
    saveEntry(entry); // write it back to both places
    showDone(entry);
  }
  else poll();
})();
