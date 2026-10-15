// /management/vote: publish the vote, edit the giveaway and its songs (covers and snippets are uploaded to the site),
// see votes, review flagged votes and draw a winner. The login is Cloudflare Access, which
// sits in front of this page and /api/admin; the server checks it on every request.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var campaign = null;   // giveaway settings
  var songs = [];        // in order
  var editors = {};      // song id → clip being picked (survives the list redrawing)
  var C = encodeURIComponent(CAMPAIGN.id);

  var admin = Admin.api;
  var download = Admin.download;
  var squareJpeg = Admin.squareJpeg;

  function loadAll() {
    loadLoyalty();
    loadStories();
    loadCampaign();
    loadSongs();
    loadStatus();
    loadResults();
    loadFlags();
    loadSignups();
  }

  function loadCampaign() {
    return admin('GET', 'campaign?campaign=' + C).then(function (c) {
      campaign = c;
      fillSettings();
      renderPublish();
      renderSongs();
    }, function (e) { $('settings-note').textContent = e.message; });
  }

  function loadStatus() {
    admin('GET', 'status?campaign=' + C).then(function (s) {
      $('followers').textContent = s.followers;
      $('goal-now').textContent = s.goal;
      $('state').textContent = !s.published ? 'Ikke udgivet.' : s.closed ? 'Lukket.' : s.unlocked ? 'Åben for stemmer.' : 'Låst indtil ' + s.goal + ' følgere.';
    }, function () {});
  }

  // ---------- publish ----------

  function renderPublish() {
    if (!campaign) return;
    var ready = songs.filter(function (s) { return s.title.trim() && s.snippet_url; }).length;
    var ended = campaign.ends_at && Date.parse(campaign.ends_at) < Date.now();
    var state = $('pub-state'), note = $('pub-note'), btn = $('pub-toggle');
    $('publish').classList.toggle('is-live', campaign.published);
    btn.disabled = false;
    if (campaign.published) {
      state.textContent = !campaign.open ? 'Udgivet · lukket for stemmer' : ended ? 'Udgivet · slut' : 'Udgivet · live';
      note.textContent = 'Kan ses på 99luciano.dk/vote' + (campaign.open && !ended ? ', og knappen vises på forsiden.' : '.');
      btn.textContent = 'Skjul';
      btn.classList.remove('btn--solid');
    } else {
      state.textContent = 'Kladde · ikke udgivet';
      note.textContent = ready
        ? ready + (ready === 1 ? ' sang er klar' : ' sange er klar') + '. Ingen kan se afstemningen, før du udgiver den.'
        : 'Tilføj mindst én sang med titel og klip, før du udgiver.';
      btn.textContent = 'Udgiv';
      btn.classList.add('btn--solid');
      btn.disabled = !ready;
    }
  }

  $('pub-toggle').addEventListener('click', function () {
    var on = !campaign.published;
    if (on && campaign.ends_at && Date.parse(campaign.ends_at) < Date.now() &&
      !confirm('Slutdatoen er allerede passeret, så afstemningen vises som slut. Udgiv alligevel?')) return;
    if (!on && !confirm('Skjul afstemningen? Siden viser "Afstemningen åbner snart", indtil du udgiver igen.')) return;
    var btn = $('pub-toggle');
    btn.disabled = true;
    admin('POST', 'publish', { campaign: CAMPAIGN.id, published: on }).then(function (c) {
      campaign = c;
      renderPublish();
      loadStatus();
    }, function (e) { btn.disabled = false; $('pub-note').textContent = e.message; });
  });

  // ---------- giveaway settings ----------

  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var pad = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fillSettings() {
    $('s-prize').value = campaign.prize || '';
    $('s-artist').value = campaign.artist || '';
    $('s-ends').value = toLocalInput(campaign.ends_at);
    $('s-draw').value = toLocalInput(campaign.draw_at);
    $('s-goal').value = campaign.goal;
    $('s-closed').checked = !campaign.open;
  }

  $('settings').addEventListener('submit', function (e) {
    e.preventDefault();
    var note = $('settings-note');
    var goal = parseInt($('s-goal').value, 10);
    if (!(goal >= 0)) { note.textContent = 'Skriv et antal følgere.'; return; }
    note.textContent = 'Gemmer…';
    admin('PUT', 'campaign', {
      campaign: CAMPAIGN.id,
      prize: $('s-prize').value.trim(),
      artist: $('s-artist').value.trim() || '99 LUCIANO',
      ends_at: $('s-ends').value ? new Date($('s-ends').value).toISOString() : null,
      draw_at: $('s-draw').value ? new Date($('s-draw').value).toISOString() : null,
      goal: goal,
      open: !$('s-closed').checked
    }).then(function (c) {
      campaign = c;
      note.textContent = 'Gemt.';
      renderPublish();
      loadStatus();
      renderSongs();
    }, function (e) { note.textContent = e.message; });
  });

  $('set-followers').addEventListener('click', function () {
    var n = parseInt($('manual').value, 10);
    if (!(n >= 0)) return;
    admin('POST', 'followers', { followers: n }).then(function () {
      $('manual').value = '';
      loadStatus();
    }, function (e) { $('state').textContent = e.message; });
  });

  $('open-now').addEventListener('click', function () {
    if (!confirm('Åbn giveawayen nu, uanset antal følgere?')) return;
    admin('POST', 'unlock', { campaign: CAMPAIGN.id }).then(loadStatus, function (e) { $('state').textContent = e.message; });
  });

  // ---------- songs ----------

  function loadSongs() {
    return admin('GET', 'songs?campaign=' + C).then(function (list) {
      songs = list;
      renderSongs();
    }, function () {});
  }

  function replaceSong(s) {
    songs = songs.map(function (x) { return x.id === s.id ? s : x; });
  }

  function renderSongs() {
    renderPublish();
    var list = $('songs');
    list.innerHTML = '';
    songs.forEach(function (s, i) {
      var li = $('song-tpl').content.firstElementChild.cloneNode(true);
      li.dataset.id = s.id;
      var state = li.querySelector('.m-song__state');
      var cover = li.querySelector('.m-cover');
      cover.classList.toggle('is-blank', !s.cover_url);
      cover.style.backgroundImage = s.cover_url ? 'url("' + s.cover_url + '")' : '';

      var title = li.querySelector('.m-title');
      var artist = li.querySelector('.m-artist');
      title.value = s.title;
      artist.value = s.artist || '';
      artist.placeholder = (campaign && campaign.artist) || '99 LUCIANO';

      var audioBox = li.querySelector('.m-audio');
      if (s.snippet_url) {
        var a = document.createElement('audio');
        a.controls = true;
        a.preload = 'none';
        a.src = s.snippet_url;
        audioBox.appendChild(a);
        if (s.clip_length) {
          var info = document.createElement('p');
          info.className = 'm-audio__info';
          info.textContent = s.clip_length + ' sek, fra ' + fmt(s.clip_start || 0) + ' i sangen';
          audioBox.appendChild(info);
        }
      } else {
        audioBox.textContent = 'Intet klip endnu. Vælg sangen herunder.';
      }

      var visible = s.title.trim() && s.snippet_url;
      li.classList.toggle('is-hidden', !visible);
      state.textContent = (visible ? 'Vises på siden' : 'Skjult: mangler ' + (s.title.trim() ? 'klip' : 'titel')) +
        (s.votes ? ' · ' + s.votes + (s.votes === 1 ? ' stemme' : ' stemmer') : '');

      function saveField(field, value) {
        var patch = {};
        patch[field] = value;
        state.textContent = 'Gemmer…';
        admin('PATCH', 'songs/' + s.id, patch).then(function (updated) {
          replaceSong(updated);
          state.textContent = 'Gemt';
          if (field === 'title') setTimeout(renderSongs, 600);
        }, function (e) { state.textContent = e.message; });
      }
      title.addEventListener('change', function () { saveField('title', title.value.trim()); });
      artist.addEventListener('change', function () { saveField('artist', artist.value.trim()); });

      li.querySelector('.m-cover-input').addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        state.textContent = 'Uploader cover…';
        squareJpeg(file, 1000).then(function (blob) {
          return upload(s, 'cover', blob);
        }).catch(function (e) { state.textContent = e.message; });
      });

      li.querySelector('.m-snippet-input').addEventListener('change', function (e) {
        var file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        state.textContent = 'Læser sangen…';
        decode(file).then(function (buffer) {
          // 30 seconds by default, or the longest length that fits a short song
          var fits = lengths(buffer.duration);
          var len = fits.indexOf(30) >= 0 ? 30 : (fits[fits.length - 1] || Math.floor(buffer.duration));
          editors[s.id] = { buffer: buffer, len: len, start: Math.max(0, Math.min(buffer.duration - len, buffer.duration * 0.3)) };
          renderSongs();
        }, function () {
          state.textContent = 'Kunne ikke læse filen. Prøv en MP3, WAV eller M4A.';
        });
      });

      if (editors[s.id]) mountEditor(li, s, editors[s.id]);

      var up = li.querySelector('.m-up');
      var down = li.querySelector('.m-down');
      up.disabled = i === 0;
      down.disabled = i === songs.length - 1;
      up.addEventListener('click', function () { move(i, -1); });
      down.addEventListener('click', function () { move(i, 1); });

      li.querySelector('.m-del').addEventListener('click', function () {
        var name = s.title || 'sang';
        if (!confirm(s.votes
          ? 'Slet "' + name + '" og dens ' + s.votes + (s.votes === 1 ? ' stemme' : ' stemmer') + '? De, der stemte på den, kan stemme igen.'
          : 'Slet "' + name + '"?')) return;
        admin('DELETE', 'songs/' + s.id).then(function () {
          loadSongs();
          loadResults();
          loadFlags();
        }, function (e) { state.textContent = e.message; });
      });

      list.appendChild(li);
    });
  }

  function upload(s, kind, blob, extra) {
    return admin('POST', 'upload?song=' + encodeURIComponent(s.id) + '&kind=' + kind + (extra || ''), undefined, blob).then(function (updated) {
      replaceSong(updated);
      renderSongs();
    });
  }

  // ---------- clip editor ----------

  var LENGTHS = [15, 30, 45, 60];
  var ctx = null;
  function audioCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }

  // Clip lengths that fit in a song of this duration
  function lengths(duration) {
    return LENGTHS.filter(function (l) { return l <= duration + 0.5; });
  }

  function decode(file) {
    return file.arrayBuffer().then(function (data) {
      return new Promise(function (resolve, reject) {
        var p = audioCtx().decodeAudioData(data, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
    });
  }

  var preview = null; // { source, raf, songId }
  function stopPreview() {
    if (!preview) return;
    try { preview.source.stop(); } catch (e) {}
    cancelAnimationFrame(preview.raf);
    var head = document.querySelector('.m-song[data-id="' + preview.songId + '"] .m-clip__head');
    if (head) head.style.opacity = 0;
    var btn = document.querySelector('.m-song[data-id="' + preview.songId + '"] .m-clip-play');
    if (btn) btn.textContent = 'Lyt';
    preview = null;
  }

  function mountEditor(li, s, ed) {
    var box = li.querySelector('.m-clip');
    var wave = box.querySelector('.m-clip__wave');
    var canvas = wave.querySelector('canvas');
    var win = box.querySelector('.m-clip__win');
    var head = box.querySelector('.m-clip__head');
    var info = box.querySelector('.m-clip__info');
    var playBtn = box.querySelector('.m-clip-play');
    var saveBtn = box.querySelector('.m-clip-save');
    var state = li.querySelector('.m-song__state');
    var dur = ed.buffer.duration;
    box.hidden = false;

    var fits = lengths(dur);
    if (!fits.length) fits = [Math.floor(dur)];
    if (fits.indexOf(ed.len) < 0) ed.len = fits[fits.length - 1];

    box.querySelectorAll('.m-chip').forEach(function (chip) {
      var l = Number(chip.dataset.len);
      chip.disabled = l > dur + 0.5;
      chip.classList.toggle('is-on', l === ed.len);
      chip.addEventListener('click', function () {
        ed.len = l;
        ed.start = Math.min(ed.start, Math.max(0, dur - l));
        box.querySelectorAll('.m-chip').forEach(function (c) { c.classList.toggle('is-on', c === chip); });
        stopPreview();
        place();
      });
    });

    function place() {
      win.style.left = (ed.start / dur * 100) + '%';
      win.style.width = (Math.min(ed.len, dur) / dur * 100) + '%';
      info.textContent = fmt(ed.start) + ' – ' + fmt(ed.start + Math.min(ed.len, dur)) + ' af ' + fmt(dur) + ' · træk feltet hen til det stykke, der skal høres';
    }

    // Waveform: the loudest sample in each column
    requestAnimationFrame(function () {
      var w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      var g = canvas.getContext('2d');
      var chans = [];
      for (var c = 0; c < Math.min(2, ed.buffer.numberOfChannels); c++) chans.push(ed.buffer.getChannelData(c));
      var n = chans[0].length, cols = canvas.width, step = Math.max(1, Math.floor(n / cols));
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (var x = 0; x < cols; x++) {
        var peak = 0, from = Math.floor(x * n / cols);
        for (var i = from; i < from + step && i < n; i += 4) {
          for (var k = 0; k < chans.length; k++) { var v = Math.abs(chans[k][i]); if (v > peak) peak = v; }
        }
        var bar = Math.max(1, peak * canvas.height * 0.95);
        g.fillRect(x, (canvas.height - bar) / 2, 1, bar);
      }
    });

    // Drag the window (or tap the waveform to move it there)
    var dragFrom = null;
    function timeAt(ev) {
      var r = wave.getBoundingClientRect();
      return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * dur;
    }
    wave.addEventListener('pointerdown', function (ev) {
      wave.setPointerCapture(ev.pointerId);
      var t = timeAt(ev);
      if (t < ed.start || t > ed.start + ed.len) ed.start = t - ed.len / 2;
      dragFrom = { t: t, start: ed.start };
      ed.start = Math.max(0, Math.min(dur - ed.len, ed.start));
      stopPreview();
      place();
    });
    wave.addEventListener('pointermove', function (ev) {
      if (!dragFrom) return;
      ed.start = Math.max(0, Math.min(dur - ed.len, dragFrom.start + timeAt(ev) - dragFrom.t));
      place();
    });
    wave.addEventListener('pointerup', function () { dragFrom = null; });
    wave.addEventListener('pointercancel', function () { dragFrom = null; });

    playBtn.addEventListener('click', function () {
      if (preview && preview.songId === s.id) { stopPreview(); return; }
      stopPreview();
      var ac = audioCtx();
      if (ac.state === 'suspended') ac.resume();
      var src = ac.createBufferSource();
      src.buffer = ed.buffer;
      src.connect(ac.destination);
      var len = Math.min(ed.len, dur - ed.start), t0 = ac.currentTime;
      src.start(0, ed.start, len);
      preview = { source: src, songId: s.id, raf: 0 };
      playBtn.textContent = 'Stop';
      head.style.opacity = 1;
      (function move() {
        var t = ed.start + Math.min(len, ac.currentTime - t0);
        head.style.left = (t / dur * 100) + '%';
        if (ac.currentTime - t0 < len) preview.raf = requestAnimationFrame(move);
      })();
      src.onended = function () { if (preview && preview.source === src) stopPreview(); };
    });

    box.querySelector('.m-clip-cancel').addEventListener('click', function () {
      stopPreview();
      delete editors[s.id];
      renderSongs();
    });

    saveBtn.addEventListener('click', function () {
      stopPreview();
      saveBtn.disabled = true;
      state.textContent = 'Laver klip…';
      encodeClip(ed.buffer, ed.start, Math.min(ed.len, dur - ed.start)).then(function (blob) {
        state.textContent = 'Uploader klip…';
        return upload(s, 'snippet', blob, '&start=' + ed.start.toFixed(2) + '&length=' + ed.len).then(function () {
          delete editors[s.id];
          renderSongs();
        });
      }).catch(function (e) {
        saveBtn.disabled = false;
        state.textContent = e.message || 'Kunne ikke lave klippet.';
      });
    });

    place();
  }

  // Cuts the chosen part, fades it in and out, and encodes it to MP3 (160 kbps) in the browser.
  function encodeClip(buffer, start, len) {
    return new Promise(function (resolve, reject) {
      if (!window.lamejs) return reject(new Error('MP3-encoderen kunne ikke indlæses. Genindlæs siden.'));
      var rate = buffer.sampleRate;
      var channels = Math.min(2, buffer.numberOfChannels);
      var from = Math.floor(start * rate), count = Math.floor(len * rate);
      var fade = Math.min(Math.floor(rate * 0.4), Math.floor(count / 4));
      var pcm = [];
      for (var c = 0; c < channels; c++) {
        var src = buffer.getChannelData(c).subarray(from, from + count);
        var out = new Int16Array(src.length);
        for (var i = 0; i < src.length; i++) {
          var gain = i < fade ? i / fade : i > src.length - fade ? (src.length - i) / fade : 1;
          var v = Math.max(-1, Math.min(1, src[i] * gain));
          out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        pcm.push(out);
      }
      var enc;
      try { enc = new lamejs.Mp3Encoder(channels, rate, 160); } catch (e) { return reject(new Error('Lydformatet kan ikke laves om til MP3.')); }
      var parts = [], pos = 0, BLOCK = 1152 * 40;
      // Encode in slices so the page stays responsive
      (function next() {
        try {
          var end = Math.min(pos + BLOCK, count);
          for (var p = pos; p < end; p += 1152) {
            var l = pcm[0].subarray(p, Math.min(p + 1152, end));
            var buf = channels === 2 ? enc.encodeBuffer(l, pcm[1].subarray(p, Math.min(p + 1152, end))) : enc.encodeBuffer(l);
            if (buf.length) parts.push(new Uint8Array(buf));
          }
          pos = end;
          if (pos < count) return setTimeout(next, 0);
          var last = enc.flush();
          if (last.length) parts.push(new Uint8Array(last));
          resolve(new Blob(parts, { type: 'audio/mpeg' }));
        } catch (e) {
          reject(new Error('Kunne ikke lave klippet.'));
        }
      })();
    });
  }

  function move(i, dir) {
    var j = i + dir;
    if (j < 0 || j >= songs.length) return;
    var order = songs.slice();
    order.splice(j, 0, order.splice(i, 1)[0]);
    songs = order;
    renderSongs();
    admin('POST', 'order', { campaign: CAMPAIGN.id, ids: order.map(function (s) { return s.id; }) })
      .then(function (list) { songs = list; renderSongs(); }, function () { loadSongs(); });
  }

  $('add-song').addEventListener('click', function () {
    admin('POST', 'songs', { campaign: CAMPAIGN.id }).then(function (s) {
      songs.push(s);
      renderSongs();
      var inputs = document.querySelectorAll('.m-title');
      inputs[inputs.length - 1].focus();
    }, function (e) { alert(e.message); });
  });

  // ---------- votes ----------

  function loadResults() {
    admin('GET', 'results?campaign=' + C).then(function (rows) {
      var total = 0, verified = 0, max = 1;
      rows.forEach(function (r) { total += r.votes; verified += r.verified; max = Math.max(max, r.votes); });
      var stories = 0;
      rows.forEach(function (r) { stories += r.stories || 0; });
      $('totals').textContent = total + ' stemmer · ' + verified + ' følger' + (stories ? ' · ' + stories + ' story' : '');
      $('results').innerHTML = '';
      rows.slice().sort(function (a, b) { return b.votes - a.votes; }).forEach(function (r) {
        var dupes = r.votes - r.people;
        var div = document.createElement('div');
        div.className = 'result';
        div.innerHTML = '<h3></h3><span>' + r.votes + ' stemmer' + (dupes ? ' (' + r.people + ' personer)' : '') +
          '<br>' + r.verified + ' følger</span><i></i>';
        div.querySelector('h3').textContent = r.title || 'Uden titel';
        div.querySelector('i').style.transform = 'scaleX(' + r.votes / max + ')';
        // Tap a song to see who voted for it
        div.classList.add('is-link');
        div.title = 'Se hvem der stemte på ' + (r.title || 'sangen');
        div.addEventListener('click', function () {
          voterSong = r.title || '';
          renderVoters();
          $('voters-count').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        $('results').appendChild(div);
      });
    }, function () {});
    loadVoters();
  }

  // ---------- who voted for what ----------

  var voters = [], voterSong = null, voterLimit = 100, voterNotFollowing = false;
  function loadVoters() {
    admin('GET', 'entries?campaign=' + C).then(function (rows) {
      voters = rows.slice().reverse(); // newest first
      renderVoters();
      renderQueue();
    }, function () {});
  }

  function renderVoters() {
    var q = $('voters-search').value.trim().toLowerCase().replace(/^@/, '');
    var titles = [];
    voters.forEach(function (v) { if (titles.indexOf(v.title) < 0) titles.push(v.title); });
    if (voterSong !== null && titles.indexOf(voterSong) < 0) voterSong = null;

    var chips = $('voters-songs');
    chips.innerHTML = '';
    [null].concat(titles).forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'm-chip' + (t === voterSong ? ' is-on' : '');
      var n = voters.filter(function (v) { return t === null || v.title === t; }).length;
      b.textContent = (t === null ? 'Alle' : t || 'Uden titel') + ' · ' + n;
      b.addEventListener('click', function () { voterSong = t; voterLimit = 100; renderVoters(); });
      chips.appendChild(b);
    });

    var nf = document.createElement('button');
    nf.type = 'button';
    nf.className = 'm-chip' + (voterNotFollowing ? ' is-on' : '');
    nf.textContent = 'Mangler tjek · ' + voters.filter(function (v) { return !v.checked; }).length;
    nf.addEventListener('click', function () { voterNotFollowing = !voterNotFollowing; renderVoters(); });
    chips.appendChild(nf);

    $('q-votes').textContent = voters.length;
    $('q-followers').textContent = voters.filter(function (v) { return v.verified; }).length;

    var list = voters.filter(function (v) {
      return (voterSong === null || v.title === voterSong) && (!q || v.handle.indexOf(q) >= 0) && (!voterNotFollowing || !v.checked);
    });
    $('voters-count').textContent = 'Alle stemmer · ' + (list.length === voters.length ? voters.length : list.length + ' af ' + voters.length);
    var box = $('voters');
    box.innerHTML = '';
    if (!list.length) box.innerHTML = '<p class="step__note">' + (voters.length ? 'Ingen matcher.' : 'Ingen stemmer endnu.') + '</p>';
    list.slice(0, voterLimit).forEach(function (v) {
      var row = document.createElement('div');
      row.className = 'm-voter';
      row.innerHTML = '<a target="_blank" rel="noopener"></a><span class="m-voter__song"></span><small></small>' +
        '<button type="button" class="m-mini m-voter__follow"></button>';
      var fb = row.querySelector('.m-voter__follow');
      fb.textContent = v.verified ? 'Følger ✓' : v.checked ? 'Følger ikke ✗' : 'Følger';
      fb.classList.toggle('m-mini--solid', !!v.verified);
      fb.title = v.verified ? 'Markeret som følger. Tryk for at fjerne.' : 'Tryk, når du har tjekket at de følger dig';
      fb.addEventListener('click', function () {
        fb.disabled = true;
        setFollower(v, !v.verified, true).catch(function (e) { fb.disabled = false; alert(e.message); });
      });
      var a = row.querySelector('a');
      a.textContent = '@' + v.handle;
      a.href = 'https://instagram.com/' + encodeURIComponent(v.handle);
      row.querySelector('.m-voter__song').textContent = v.title || 'Uden titel';
      row.querySelector('small').textContent = [
        new Date(v.created_at).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        v.verified ? 'følger' : v.checked ? 'følger ikke' : '',
        v.story ? 'story ✓' : v.story_claimed ? 'story venter' : '',
        v.flagged ? 'flaget' : ''
      ].filter(Boolean).join(' · ');
      box.appendChild(row);
    });
    $('voters-more').hidden = list.length <= voterLimit;
  }

  function setFollower(v, verified, checked) {
    return admin('POST', 'follower', { campaign: CAMPAIGN.id, vote: v.id, verified: verified, checked: checked }).then(function () {
      v.verified = verified;
      v.checked = checked;
      renderVoters();
      renderQueue();
      loadResults();
    });
  }

  // ---------- check followers one at a time ----------

  var skipped = {}, lastAnswered = null, awayAt = 0;
  function queue() {
    // Oldest first, so the list is worked through in voting order
    return voters.filter(function (v) { return !v.checked; }).slice().reverse();
  }

  function current() {
    var q = queue();
    return q.filter(function (v) { return !skipped[v.id]; })[0] || q[0] || null;
  }

  function renderQueue() {
    var total = voters.length, done = voters.filter(function (v) { return v.checked; }).length;
    $('fq-count').textContent = 'Tjek følgere · ' + done + ' af ' + total;
    $('fq-bar').style.width = (total ? done / total * 100 : 0) + '%';
    $('fq-undo').hidden = !lastAnswered;
    var v = current();
    $('fq-card').hidden = !v;
    $('fq-done').hidden = !!v;
    $('fq-done').textContent = total ? 'Alle ' + total + ' er tjekket. ' + voters.filter(function (x) { return x.verified; }).length + ' følger.' : 'Ingen stemmer endnu.';
    if (!v) return;
    $('fq-handle').textContent = '@' + v.handle;
    $('fq-meta').textContent = 'Stemte på ' + (v.title || 'en sang') + ' · ' +
      new Date(v.created_at).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) +
      (queue().length > 1 ? ' · ' + (queue().length - 1) + ' mere bagefter' : '');
    $('fq-open').href = 'https://instagram.com/' + encodeURIComponent(v.handle);
    $('fq').classList.remove('is-back');
  }

  function answer(verified) {
    var v = current();
    if (!v) return;
    ['fq-yes', 'fq-no'].forEach(function (id) { $(id).disabled = true; });
    setFollower(v, verified, true).then(function () {
      lastAnswered = v;
      delete skipped[v.id];
      renderQueue();
    }, function (e) { alert(e.message); }).then(function () {
      ['fq-yes', 'fq-no'].forEach(function (id) { $(id).disabled = false; });
    });
  }

  $('fq-yes').addEventListener('click', function () { answer(true); });
  $('fq-no').addEventListener('click', function () { answer(false); });
  $('fq-skip').addEventListener('click', function () {
    var v = current();
    if (!v) return;
    skipped[v.id] = true;
    // Everyone skipped: start over with the skipped ones
    if (queue().every(function (x) { return skipped[x.id]; })) skipped = {};
    renderQueue();
  });
  $('fq-undo').addEventListener('click', function () {
    var v = lastAnswered;
    if (!v) return;
    lastAnswered = null;
    setFollower(v, false, false).catch(function (e) { alert(e.message); });
  });
  // Back from Instagram: highlight the answer buttons
  $('fq-open').addEventListener('click', function () { awayAt = Date.now(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && awayAt && Date.now() - awayAt > 800) {
      $('fq').classList.add('is-back');
      $('fq-ask').scrollIntoView({ block: 'center' });
      awayAt = 0;
    }
  });

  $('voters-search').addEventListener('input', function () { voterLimit = 100; renderVoters(); });
  $('voters-more').addEventListener('click', function () { voterLimit += 200; renderVoters(); });

  // ---------- gift cards for voting in several rounds ----------

  function loadLoyalty() {
    admin('GET', 'loyalty').then(function (d) {
      if (document.activeElement !== $('loy-min')) $('loy-min').value = d.min;
      var eligible = d.people.filter(function (p) { return p.eligible; });
      $('loy-rounds').textContent = d.rounds.length;
      $('loy-eligible').textContent = eligible.length;
      $('loy-close').textContent = d.people.filter(function (p) { return p.rounds === d.min - 1; }).length;
      $('loy-count').textContent = 'Gavekort for 500 kr. · ' + eligible.length + (eligible.length === 1 ? ' er med' : ' er med');
      $('loy-draw').disabled = !eligible.length;
      if (d.draws.length) showLoyaltyWinners(d.draws[0]);
      var box = $('loy-people');
      box.innerHTML = '';
      if (!d.people.length) box.innerHTML = '<p class="step__note">Ingen stemmer endnu.</p>';
      d.people.slice(0, 300).forEach(function (p) {
        var row = document.createElement('div');
        row.className = 'm-voter m-repost' + (p.eligible ? ' is-ok' : '');
        row.innerHTML = '<a target="_blank" rel="noopener"></a><span class="m-voter__song"></span><small></small>';
        var a = row.querySelector('a');
        a.textContent = '@' + p.handle;
        a.href = 'https://instagram.com/' + encodeURIComponent(p.handle);
        row.querySelector('.m-voter__song').textContent = p.rounds + ' / ' + d.min;
        row.querySelector('small').textContent = (p.eligible ? 'Er med' : 'Mangler ' + (d.min - p.rounds)) +
          ' · stemte sidst ' + new Date(p.last).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' }) + (p.verified ? ' · følger' : '');
        box.appendChild(row);
      });
    }, function () {});
  }

  function showLoyaltyWinners(draw) {
    var box = $('loy-winners');
    box.innerHTML = '';
    draw.winners.forEach(function (w) {
      var row = document.createElement('div');
      row.className = 'm-loy-winner';
      row.innerHTML = '<span class="m-loy-winner__prize"></span><a target="_blank" rel="noopener"></a><small></small>';
      row.querySelector('.m-loy-winner__prize').textContent = w.prize + ' kr.';
      var a = row.querySelector('a');
      a.textContent = '@' + w.handle;
      a.href = 'https://instagram.com/' + encodeURIComponent(w.handle);
      row.querySelector('small').textContent = w.place + '. præmie · stemte ' + w.rounds + ' gange';
      box.appendChild(row);
    });
    $('loy-note').textContent = 'Trukket ' + new Date(draw.created_at).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) +
      ' blandt ' + draw.pool + (draw.pool === 1 ? ' person' : ' personer') + ' (mindst ' + draw.min_rounds + ' afstemninger).' +
      (draw.winners.length < 3 ? ' Der var ikke nok deltagere til alle tre gavekort.' : '');
  }

  $('loy-save').addEventListener('click', function () {
    var n = parseInt($('loy-min').value, 10);
    admin('PUT', 'loyalty', { min: n }).then(function () {
      $('loy-note').textContent = 'Gemt. Man skal nu have stemt ' + n + ' gange for at være med.';
      loadLoyalty();
    }, function (e) { $('loy-note').textContent = e.message; });
  });

  $('loy-draw').addEventListener('click', function () {
    if (!confirm('Træk 3 tilfældige vindere af gavekortene nu?')) return;
    $('loy-draw').disabled = true;
    admin('POST', 'loyalty-draw').then(function (r) {
      showLoyaltyWinners({ winners: r.winners, pool: r.pool, min_rounds: r.min, created_at: new Date().toISOString() });
      $('loy-draw').disabled = false;
      $('loy-draw').textContent = 'Træk igen';
    }, function (e) { $('loy-note').textContent = e.message; $('loy-draw').disabled = false; });
  });

  // ---------- reposters (double chance) ----------

  var reposts = [], rpFilter = 'all';
  function loadStories() {
    admin('GET', 'stories?campaign=' + C).then(function (rows) {
      reposts = rows;
      renderReposts();
    }, function () {});
  }

  function renderReposts() {
    var ok = reposts.filter(function (r) { return r.story; }).length;
    var wait = reposts.filter(function (r) { return !r.story; }).length;
    var novote = reposts.filter(function (r) { return !r.voted; }).length;
    $('rp-ok').textContent = ok;
    $('rp-wait').textContent = wait;
    $('rp-novote').textContent = novote;
    $('story-count').textContent = 'Reposter · ' + reposts.length;
    $('q-reposts').textContent = reposts.length;
    document.querySelectorAll('#rp-filter .m-chip').forEach(function (c) { c.classList.toggle('is-on', c.dataset.f === rpFilter); });

    var list = reposts.filter(function (r) {
      return rpFilter === 'all' || (rpFilter === 'ok' && r.story) || (rpFilter === 'wait' && !r.story) || (rpFilter === 'novote' && !r.voted);
    });
    var box = $('stories');
    box.innerHTML = '';
    if (!list.length) box.innerHTML = '<p class="step__note">' + (reposts.length ? 'Ingen her.' : 'Ingen reposter endnu.') + '</p>';
    var fmt = function (iso) { return new Date(iso).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
    list.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'm-voter m-repost' + (r.story ? ' is-ok' : '');
      row.innerHTML = '<a target="_blank" rel="noopener"></a><span class="m-repost__actions"></span><small></small>';
      var a = row.querySelector('a');
      a.textContent = '@' + r.handle;
      a.href = 'https://instagram.com/' + encodeURIComponent(r.handle);
      row.querySelector('small').textContent = [
        r.story ? 'Godkendt' + (r.confirmed_at ? ' ' + fmt(r.confirmed_at) : '') + (r.voted ? ' · tæller dobbelt' : ' · dobbelt, når de stemmer') : r.claimed ? 'Siger de har delt · ' + fmt(r.created_at) : 'Tilføjet af dig',
        r.voted ? 'stemte på ' + (r.title || 'en sang') : 'har ikke stemt endnu',
        r.verified ? 'følger' : ''
      ].filter(Boolean).join(' · ');
      var actions = row.querySelector('.m-repost__actions');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'm-mini' + (r.story ? '' : ' m-mini--solid');
      btn.textContent = r.story ? 'Fortryd' : 'Godkend';
      btn.addEventListener('click', function () {
        btn.disabled = true;
        setStory({ handle: r.handle, story: !r.story });
      });
      actions.appendChild(btn);
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'm-mini m-del';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Fjern @' + r.handle);
      del.addEventListener('click', function () {
        if (!confirm('Fjern @' + r.handle + ' fra reposter-listen?')) return;
        admin('DELETE', 'story?campaign=' + C + '&handle=' + encodeURIComponent(r.handle)).then(function () {
          loadStories();
          loadResults();
        }, function (e) { $('story-note').textContent = e.message; });
      });
      actions.appendChild(del);
      box.appendChild(row);
    });
  }

  document.querySelectorAll('#rp-filter .m-chip').forEach(function (c) {
    c.addEventListener('click', function () { rpFilter = c.dataset.f; renderReposts(); });
  });

  function setStory(data) {
    data.campaign = CAMPAIGN.id;
    return admin('POST', 'story', data).then(function (r) {
      $('story-note').textContent = r && !r.voted && data.story
        ? '@' + r.handle + ' har ikke stemt endnu. De får dobbelt chance, så snart de stemmer.' : '';
      loadStories();
      loadResults();
    }, function (e) { $('story-note').textContent = e.message; loadStories(); });
  }

  $('story-add').addEventListener('click', function () {
    var h = $('story-handle').value.trim().replace(/^@/, '');
    if (!h) return;
    setStory({ handle: h, story: true }).then(function () { $('story-handle').value = ''; });
  });
  $('story-handle').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('story-add').click(); });

  // Votes that share a device or a network, grouped. Each group is one entry in the draw.
  function loadFlags() {
    admin('GET', 'flags?campaign=' + C).then(function (rows) {
      var groups = [];
      rows.forEach(function (r) {
        var g = groups[groups.length - 1];
        if (!g || g.id !== r.grp) groups.push(g = { id: r.grp, rows: [] });
        g.rows.push(r);
      });
      var flagged = groups.filter(function (g) { return g.rows.length > 1; }).length;
      $('flag-count').textContent = flagged ? 'Flaget · ' + flagged + (flagged === 1 ? ' gruppe' : ' grupper') : 'Flaget · ingen';
      var box = $('flags');
      box.innerHTML = '';
      if (!rows.length) {
        box.innerHTML = '<p class="step__note">Intet at vise endnu.</p>';
        return;
      }
      groups.forEach(function (g) {
        var div = document.createElement('div');
        div.className = 'm-flag' + (g.rows.length > 1 ? '' : ' is-cleared');
        var head = document.createElement('p');
        head.className = 'm-flag__head';
        var why = [];
        if (g.rows.some(function (r) { return r.same_device; })) why.push('samme enhed');
        if (g.rows.some(function (r) { return r.same_network; })) why.push('samme netværk');
        head.textContent = g.rows.length > 1
          ? g.rows.length + ' brugernavne · ' + why.join(' + ') + ' · tæller som 1 lod'
          : 'Egen person (godkendt af dig)';
        div.appendChild(head);
        g.rows.forEach(function (r) {
          var row = document.createElement('div');
          row.className = 'm-flag__row';
          row.innerHTML = '<span class="m-flag__who"><b></b><small></small></span><button type="button" class="m-mini"></button>';
          row.querySelector('b').textContent = '@' + r.handle;
          row.querySelector('small').textContent = r.title + ' · ' +
            new Date(r.created_at).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) +
            (r.verified ? ' · følger' : '') + (r.same_device ? ' · enhed' : '') + (r.same_network ? ' · netværk' : '');
          var btn = row.querySelector('button');
          btn.textContent = r.cleared ? 'Fortryd' : 'Egen person';
          btn.addEventListener('click', function () {
            btn.disabled = true;
            admin('POST', 'clear', { vote: r.vote_id, cleared: !r.cleared }).then(function () {
              loadFlags();
              loadResults();
            }, function (e) { btn.disabled = false; alert(e.message); });
          });
          div.appendChild(row);
        });
        box.appendChild(div);
      });
    }, function () {});
  }

  var signups = [], winnerSignups = [];
  // Newest first: Instagram username (when known), email/phone, and when they signed up
  function signupRows(box, rows) {
    box.innerHTML = '';
    if (!rows.length) box.innerHTML = '<p class="step__note">Ingen endnu.</p>';
    rows.slice().reverse().forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'm-voter m-signup';
      div.innerHTML = '<span class="m-signup__who"></span><span class="m-voter__song"></span><small></small>';
      var who = div.querySelector('.m-signup__who');
      if (r.handle) {
        var a = document.createElement('a');
        a.target = '_blank';
        a.rel = 'noopener';
        a.href = 'https://instagram.com/' + encodeURIComponent(r.handle);
        a.textContent = '@' + r.handle;
        who.appendChild(a);
      } else {
        who.textContent = 'Ukendt brugernavn';
        who.classList.add('is-unknown');
      }
      div.querySelector('.m-voter__song').textContent = r.kind === 'sms' ? '+' + r.contact : r.contact;
      div.querySelector('small').textContent = (r.notified_at ? 'Sendt' : r.kind === 'sms' ? 'SMS' : 'Email') + ' · tilmeldt ' +
        new Date(r.created_at).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      box.appendChild(div);
    });
  }

  function renderNotifCounts() {
    var all = winnerSignups.concat(signups);
    var unique = {};
    all.forEach(function (r) { unique[r.contact] = r.kind; });
    var kinds = Object.keys(unique).map(function (k) { return unique[k]; });
    $('nf-winner').textContent = winnerSignups.length;
    $('nf-email').textContent = kinds.filter(function (k) { return k === 'email'; }).length;
    $('nf-sms').textContent = kinds.filter(function (k) { return k === 'sms'; }).length;
    $('notif-count').textContent = 'Notifikationer · ' + kinds.length;
    $('tab-notif').textContent = 'Notifikationer' + (kinds.length ? ' (' + kinds.length + ')' : '');
    $('q-notif').textContent = kinds.length;
  }

  function copyList(kind) {
    var list = winnerSignups.filter(function (r) { return r.kind === kind; })
      .map(function (r) { return kind === 'sms' ? '+' + r.contact : r.contact; });
    var note = $('copy-note');
    if (!list.length) { note.textContent = kind === 'sms' ? 'Ingen numre endnu.' : 'Ingen emails endnu.'; return; }
    var text = list.join(kind === 'sms' ? '\n' : ', ');
    var done = function () { note.textContent = list.length + (kind === 'sms' ? ' numre' : ' emails') + ' kopieret.'; };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { prompt('Kopiér:', text); });
    else prompt('Kopiér:', text);
  }
  $('copy-emails').addEventListener('click', function () { copyList('email'); });
  $('copy-phones').addEventListener('click', function () { copyList('sms'); });

  function loadSignups() {
    admin('GET', 'signups?campaign=' + C).then(function (rows) {
      signups = rows;
      $('signup-count').textContent = 'Besked når den åbner · ' + rows.length;
      signupRows($('signups'), rows);
      renderNotifCounts();
    }, function () {});
    admin('GET', 'winner-signups?campaign=' + C).then(function (rows) {
      winnerSignups = rows;
      $('winner-count').textContent = 'Besked om vinderen · ' + rows.length;
      signupRows($('winner-signups'), rows);
      renderNotifCounts();
    }, function () {});
  }

  function signupCsv(rows) {
    return ['brugernavn,type,kontakt,tilmeldt,sendt'].concat(rows.map(function (r) {
      return [r.handle || '', r.kind, r.kind === 'sms' ? '+' + r.contact : r.contact, r.created_at, r.notified_at || ''].join(',');
    }));
  }

  $('export-winner').addEventListener('click', function () {
    download(CAMPAIGN.id + '-besked-vinder.csv', signupCsv(winnerSignups));
  });

  $('refresh').addEventListener('click', function () { loadStories(); loadResults(); loadFlags(); loadSignups(); loadStatus(); loadSongs(); });

  $('export').addEventListener('click', function () {
    admin('GET', 'entries?campaign=' + C).then(function (rows) {
      download(CAMPAIGN.id + '-stemmer.csv', ['brugernavn,nummer,foelger,story,flaget,gruppe,tidspunkt'].concat(rows.map(function (r) {
        return [r.handle, '"' + (r.title || '').replace(/"/g, '""') + '"', r.verified ? 'ja' : 'nej', r.story ? 'ja' : r.story_claimed ? 'venter' : 'nej', r.flagged ? 'ja' : 'nej', r.grp, r.created_at].join(',');
      })));
    });
  });

  $('export-signups').addEventListener('click', function () {
    download(CAMPAIGN.id + '-besked.csv', signupCsv(signups));
  });

  // ---------- winner ----------

  // Pulls usernames out of Instagram's export (JSON or HTML) or a plain list.
  function extract(text) {
    var out = {};
    try {
      (function walk(v) {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          if (typeof v.value === 'string') out[v.value] = 1;
          if (typeof v.title === 'string' && v.title) out[v.title] = 1;
          Object.keys(v).forEach(function (k) { walk(v[k]); });
        }
      })(JSON.parse(text));
      if (Object.keys(out).length) return Object.keys(out);
    } catch (e) {}
    var re = /instagram\.com\/(?:_u\/)?([A-Za-z0-9._]{1,30})/g, m;
    while ((m = re.exec(text))) out[m[1]] = 1;
    if (Object.keys(out).length) return Object.keys(out);
    return text.split(/[\s,;]+/).map(function (s) { return s.replace(/^@/, ''); }).filter(Boolean);
  }

  $('file').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    file.text().then(function (text) {
      var list = extract(text);
      $('followers-list').value = list.join('\n');
      $('verify-note').textContent = list.length + ' brugernavne hentet fra ' + file.name + '.';
    });
  });

  $('verify').addEventListener('click', function () {
    var list = extract($('followers-list').value);
    if (!list.length) { $('verify-note').textContent = 'Listen er tom.'; return; }
    admin('POST', 'verify', { campaign: CAMPAIGN.id, followers: list }).then(function (r) {
      $('verify-note').textContent = 'Tjekket mod ' + list.length + ' følgere. ' + r.verified + ' stemmer følger.';
      loadResults();
      loadFlags();
    }, function (e) { $('verify-note').textContent = e.message; });
  });

  $('draw').addEventListener('click', function () {
    admin('POST', 'draw', { campaign: CAMPAIGN.id }).then(function (r) {
      var w = r.winner;
      if (!w) {
        $('winner').textContent = '';
        $('winner-note').textContent = 'Ingen stemmer fra følgere endnu. Tjek følgere først.';
        return;
      }
      var others = (w.group_handles || []).filter(function (h) { return h !== w.handle; });
      $('winner').textContent = '@' + w.handle;
      $('winner-note').textContent = 'Ud af ' + w.pool + ' personer (' + (w.lots || w.pool) + ' lod med dobbelt chance)' +
        (w.story ? ' · delte på story' : '') + ' · stemte på ' + w.title + ' · ' + new Date(w.created_at).toLocaleString('da-DK') +
        (others.length ? ' · Flaget sammen med @' + others.join(', @') + '. Tjek dem under Flag.' : '');
    }, function (e) { $('winner-note').textContent = e.message; });
  });

  Admin.start(loadAll);
})();
