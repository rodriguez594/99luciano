// /management: edit the giveaway and its songs (covers and snippets are uploaded to the site),
// see votes, review flagged votes and draw a winner. The login is Cloudflare Access, which
// sits in front of this page and /api/admin; the server checks it on every request.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var campaign = null;   // giveaway settings
  var songs = [];        // in order
  var editors = {};      // song id → clip being picked (survives the list redrawing)
  var C = encodeURIComponent(CAMPAIGN.id);

  // ---------- talking to /api/admin ----------

  function admin(method, path, data, raw) {
    var opts = { method: method, headers: {} };
    if (raw) {
      opts.body = raw;
      opts.headers['content-type'] = raw.type || 'application/octet-stream';
    } else if (data !== undefined) {
      opts.body = JSON.stringify(data);
      opts.headers['content-type'] = 'application/json';
    }
    return fetch('/api/admin/' + path, opts).then(function (res) {
      var isJson = (res.headers.get('content-type') || '').indexOf('application/json') === 0;
      if (!isJson) {
        // Access answers with its login page (or a redirect) when the session ran out
        var e = new Error(res.status === 404 ? 'noapi' : 'login');
        e.status = res.status;
        throw e;
      }
      return res.json().then(function (out) {
        if (!res.ok) {
          var e = new Error(out.error || 'Noget gik galt.');
          e.status = res.status;
          throw e;
        }
        return out;
      });
    }, function () {
      throw new Error('Ingen forbindelse. Prøv igen.');
    });
  }

  function show(id) {
    $('login').hidden = id !== 'login';
    $('panel').hidden = id !== 'panel';
    $('logout').hidden = id !== 'panel';
  }

  function download(name, rows) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = name;
    a.click();
  }

  // ---------- start ----------

  function init() {
    show('login');
    admin('GET', 'me').then(function () {
      show('panel');
      loadAll();
    }, function (e) {
      var note = $('login-note');
      $('title').textContent = 'Log ind';
      if (e.message === 'setup' || e.message === 'noapi') {
        note.textContent = 'Login er ikke sat op endnu. Slå Cloudflare Access til for /management og /api/admin, ' +
          'og sæt ACCESS_TEAM_DOMAIN og ACCESS_AUD på Pages-projektet (se README).';
      } else if (e.message === 'denied') {
        $('title').textContent = 'Ingen adgang';
        note.textContent = 'Din email har ikke adgang. Tilføj den i Cloudflare Access-reglen for /management.';
      } else if (e.message === 'login') {
        note.innerHTML = 'Du er ikke logget ind. <a href="" style="text-decoration:underline">Genindlæs siden</a> for at logge ind.';
      } else {
        note.textContent = e.message;
      }
    });
  }

  function loadAll() {
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
      renderSongs();
    }, function (e) { $('settings-note').textContent = e.message; });
  }

  function loadStatus() {
    admin('GET', 'status?campaign=' + C).then(function (s) {
      $('followers').textContent = s.followers;
      $('goal-now').textContent = s.goal;
      $('state').textContent = s.closed ? 'Lukket.' : s.unlocked ? 'Åben for stemmer.' : 'Låst indtil ' + s.goal + ' følgere.';
    }, function () {});
  }

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
      goal: goal,
      open: !$('s-closed').checked
    }).then(function (c) {
      campaign = c;
      note.textContent = 'Gemt.';
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
        if (!confirm('Slet "' + (s.title || 'sang') + '"?')) return;
        admin('DELETE', 'songs/' + s.id).then(loadSongs, function (e) { state.textContent = e.message; });
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

  // Crops to a centred square and shrinks to size×size, so covers load fast on phones.
  function squareJpeg(file, size) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var side = Math.min(img.naturalWidth, img.naturalHeight);
        var out = Math.min(size, side);
        var c = document.createElement('canvas');
        c.width = c.height = out;
        c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
        URL.revokeObjectURL(img.src);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Kunne ikke læse billedet.')); }, 'image/jpeg', 0.88);
      };
      img.onerror = function () { reject(new Error('Kunne ikke læse billedet.')); };
      img.src = URL.createObjectURL(file);
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
      $('totals').textContent = total + ' stemmer · ' + verified + ' følger';
      $('results').innerHTML = '';
      rows.slice().sort(function (a, b) { return b.votes - a.votes; }).forEach(function (r) {
        var dupes = r.votes - r.people;
        var div = document.createElement('div');
        div.className = 'result';
        div.innerHTML = '<h3></h3><span>' + r.votes + ' stemmer' + (dupes ? ' (' + r.people + ' personer)' : '') +
          '<br>' + r.verified + ' følger</span><i></i>';
        div.querySelector('h3').textContent = r.title || 'Uden titel';
        div.querySelector('i').style.transform = 'scaleX(' + r.votes / max + ')';
        $('results').appendChild(div);
      });
    }, function () {});
  }

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

  var signups = [];
  function loadSignups() {
    admin('GET', 'signups?campaign=' + C).then(function (rows) {
      signups = rows;
      $('signup-count').textContent = signups.length + ' vil have besked';
      $('signups').innerHTML = '';
      signups.forEach(function (r) {
        var div = document.createElement('div');
        div.className = 'signup';
        div.innerHTML = '<span></span><span></span>';
        div.firstChild.textContent = r.kind === 'sms' ? '+' + r.contact : r.contact;
        div.lastChild.textContent = r.notified_at ? 'Sendt' : r.kind === 'sms' ? 'SMS' : 'Email';
        $('signups').appendChild(div);
      });
    }, function () {});
  }

  $('refresh').addEventListener('click', function () { loadResults(); loadFlags(); loadSignups(); loadStatus(); loadSongs(); });

  $('export').addEventListener('click', function () {
    admin('GET', 'entries?campaign=' + C).then(function (rows) {
      download(CAMPAIGN.id + '-stemmer.csv', ['brugernavn,nummer,foelger,flaget,gruppe,tidspunkt'].concat(rows.map(function (r) {
        return [r.handle, '"' + (r.title || '').replace(/"/g, '""') + '"', r.verified ? 'ja' : 'nej', r.flagged ? 'ja' : 'nej', r.grp, r.created_at].join(',');
      })));
    });
  });

  $('export-signups').addEventListener('click', function () {
    download(CAMPAIGN.id + '-besked.csv', ['type,kontakt,tilmeldt,sendt'].concat(signups.map(function (r) {
      return [r.kind, r.kind === 'sms' ? '+' + r.contact : r.contact, r.created_at, r.notified_at || ''].join(',');
    })));
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
      $('winner-note').textContent = 'Ud af ' + w.pool + ' lod · stemte på ' + w.title + ' · ' + new Date(w.created_at).toLocaleString('da-DK') +
        (others.length ? ' · Flaget sammen med @' + others.join(', @') + '. Tjek dem under Flag.' : '');
    }, function (e) { $('winner-note').textContent = e.message; });
  });

  init();
})();
