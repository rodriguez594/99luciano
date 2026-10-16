// /management/vault: put unreleased songs in 99luciano.dk/vault for a set time.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var api = Admin.api, el = Admin.el;
  var drops = [], when = 'now', hours = 24, audioFile = null, coverFile = null;
  var MAX = 24 * 1024 * 1024;

  function load() {
    api('GET', 'vault').then(function (list) { drops = list; render(); }, function (e) { $('vs-note').textContent = e.message; });
  }

  // ---------- helpers ----------

  function pad(n) { return ('0' + n).slice(-2); }
  function localInput(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function when2(iso) { return new Date(iso).toLocaleString('da-DK', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function left(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
    return (d ? d + 'd ' : '') + h + 't ' + pad(m) + 'm';
  }
  function state(v) {
    var t = Date.now();
    if (!v.has_audio) return 'missing';
    if (t < Date.parse(v.starts_at)) return 'scheduled';
    if (t >= Date.parse(v.ends_at)) return 'ended';
    return 'live';
  }

  // ---------- the list ----------

  function render() {
    var live = drops.filter(function (v) { return state(v) === 'live'; });
    var next = drops.filter(function (v) { return state(v) === 'scheduled'; }).sort(function (a, b) { return a.starts_at.localeCompare(b.starts_at); })[0];
    $('vault-status').classList.toggle('is-live', live.length > 0);
    $('vs-state').textContent = live.length ? 'Åben · ' + live.length + (live.length === 1 ? ' sang' : ' sange') : 'Låst';
    $('vs-note').textContent = live.length
      ? live.map(function (v) { return v.title + ' forsvinder om ' + left(Date.parse(v.ends_at) - Date.now()); }).join(' · ')
      : next ? 'Næste: ' + next.title + ' åbner ' + when2(next.starts_at) : 'Ingen sange åbne lige nu.';
    $('list-count').textContent = 'Sange i vaulten · ' + drops.length;

    var box = $('drops');
    box.innerHTML = '';
    if (!drops.length) box.appendChild(el('p', 'step__note', 'Ingen endnu.'));
    var order = { live: 0, scheduled: 1, missing: 2, ended: 3 };
    drops.slice().sort(function (a, b) { return order[state(a)] - order[state(b)] || b.starts_at.localeCompare(a.starts_at); }).forEach(function (v) {
      box.appendChild(row(v));
    });
  }

  function row(v) {
    var st = state(v);
    var r = el('article', 'm-drop is-' + st);
    var art = el('div', 'm-drop__art art' + (v.cover_url ? '' : ' is-blank'));
    if (v.cover_url) art.style.backgroundImage = 'url("' + v.cover_url + '")';
    r.appendChild(art);
    var body = el('div', 'm-drop__body');
    var head = el('div', 'm-drop__head');
    head.appendChild(el('h3', null, v.title));
    head.appendChild(el('span', 'm-pill' + (st === 'live' ? ' is-live' : ''),
      { live: 'Live', scheduled: 'Planlagt', ended: 'Udløbet', missing: 'Mangler lyd' }[st]));
    body.appendChild(head);
    var t = Date.now();
    body.appendChild(el('p', 'm-drop__meta', [
      st === 'live' ? 'Forsvinder om ' + left(Date.parse(v.ends_at) - t) + ' (' + when2(v.ends_at) + ')' :
        st === 'scheduled' ? 'Åbner ' + when2(v.starts_at) + ' · i ' + left(Date.parse(v.ends_at) - Date.parse(v.starts_at)) :
          'Var oppe ' + when2(v.starts_at) + ' – ' + when2(v.ends_at),
      v.listeners + (v.listeners === 1 ? ' lytter' : ' lyttere') + ' · ' + v.listens + (v.listens === 1 ? ' afspilning' : ' afspilninger') +
        (v.listen_seconds ? ' · ' + dur(v.listen_seconds) + ' i alt' : '')
    ].join(' · ')));

    // Listening stats, loaded when opened
    var det = el('details', 'm-drop__stats');
    det.open = !!openStats[v.id];
    det.appendChild(el('summary', null, 'Statistik'));
    var statBox = el('div', 'm-vstats');
    det.appendChild(statBox);
    det.addEventListener('toggle', function () {
      openStats[v.id] = det.open;
      if (det.open) loadStats(v, statBox);
    });
    if (det.open) loadStats(v, statBox);
    body.appendChild(det);

    var acts = el('div', 'm-song__actions');
    var patch = function (data, msg) {
      return api('PATCH', 'vault/' + encodeURIComponent(v.id), data).then(function () { note(msg); load(); }, function (e) { note(e.message); });
    };
    if (st === 'live') {
      acts.appendChild(btn('+24 timer', function () { patch({ ends_at: new Date(Date.parse(v.ends_at) + 864e5).toISOString() }, v.title + ' er forlænget med 24 timer.'); }));
      acts.appendChild(btn('Luk nu', function () {
        if (confirm('Luk "' + v.title + '" nu? Den forsvinder fra /vault med det samme.')) patch({ ends_at: new Date().toISOString() }, v.title + ' er lukket.');
      }));
    }
    if (st === 'scheduled') {
      acts.appendChild(btn('Åbn nu', function () {
        var dur = Date.parse(v.ends_at) - Date.parse(v.starts_at);
        patch({ starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + dur).toISOString() }, v.title + ' er åben nu.');
      }));
    }
    if (st === 'ended') {
      acts.appendChild(btn('Åbn igen i 24 timer', function () {
        patch({ starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 864e5).toISOString() }, v.title + ' er åben igen i 24 timer.');
      }));
    }
    acts.appendChild(btn('Skift tid', function () {
      var end = prompt('Hvornår skal den forsvinde? Skriv fx "' + localInput(new Date(Date.now() + 864e5)).replace('T', ' ') + '"', localInput(new Date(v.ends_at)).replace('T', ' '));
      if (!end) return;
      var d = new Date(end.trim().replace(' ', 'T'));
      if (isNaN(d)) { note('Det tidspunkt forstod jeg ikke.'); return; }
      patch({ ends_at: d.toISOString() }, 'Tiden er ændret.');
    }));
    acts.appendChild(btn('Slet', function () {
      if (!confirm('Slet "' + v.title + '" helt (også lydfilen)?')) return;
      api('DELETE', 'vault/' + encodeURIComponent(v.id)).then(function () { note(v.title + ' er slettet.'); load(); }, function (e) { note(e.message); });
    }, 'm-del'));
    body.appendChild(acts);
    r.appendChild(body);
    return r;
  }

  var openStats = {};
  function dur(s) {
    s = Math.round(s || 0);
    var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
    return h ? h + 't ' + pad(m) + 'm' : m + ':' + pad(x);
  }

  function loadStats(v, box) {
    if (!box.firstChild) box.appendChild(el('p', 'step__note', 'Henter…'));
    api('GET', 'vault/' + encodeURIComponent(v.id)).then(function (s) {
      box.innerHTML = '';
      if (!s.listens) { box.appendChild(el('p', 'step__note', 'Ingen har lyttet endnu.')); return; }
      var grid = el('div', 'm-stats m-stats--4');
      [
        [s.listeners, s.listeners === 1 ? 'Lytter' : 'Lyttere'],
        [s.listens, 'Afspilninger'],
        [dur(s.seconds), 'Lyttetid i alt'],
        [dur(s.avg_per_listener), 'Gns. pr. lytter']
      ].forEach(function (x) {
        var d = el('div');
        d.appendChild(el('b', null, String(x[0])));
        d.appendChild(el('span', null, x[1]));
        grid.appendChild(d);
      });
      box.appendChild(grid);
      box.appendChild(el('p', 'm-drop__meta',
        s.finished + ' af ' + s.listeners + ' hørte hele sangen' +
        (s.listeners ? ' (' + Math.round(s.finished / s.listeners * 100) + ' %)' : '') +
        (s.repeat ? ' · ' + s.repeat + ' lyttede mere end én gang' : '') +
        (s.duration ? ' · sangen er ' + dur(s.duration) + ' lang' : '')));

      // How far people got
      box.appendChild(el('p', 'm-sublabel', 'Hvor langt nåede de'));
      var max = Math.max.apply(null, s.buckets.concat([1]));
      ['0–25 %', '25–50 %', '50–75 %', '75–100 %'].forEach(function (label, i) {
        var r = el('div', 'm-vbar');
        r.appendChild(el('span', null, label));
        var bar = el('div', 'm-bar');
        var fill = el('i');
        fill.style.width = (s.buckets[i] / max * 100) + '%';
        bar.appendChild(fill);
        r.appendChild(bar);
        r.appendChild(el('b', null, String(s.buckets[i])));
        box.appendChild(r);
      });

      box.appendChild(el('p', 'm-sublabel', 'Seneste afspilninger'));
      var list = el('div', 'm-list');
      s.recent.forEach(function (x) {
        var row = el('div', 'signup');
        row.appendChild(el('span', null, new Date(x.started_at).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })));
        row.appendChild(el('span', null, 'lyttede ' + dur(x.seconds) + (x.duration ? ' · nåede ' + Math.min(100, Math.round(x.max_pos / x.duration * 100)) + ' %' : '')));
        list.appendChild(row);
      });
      box.appendChild(list);
    }, function (e) { box.innerHTML = ''; box.appendChild(el('p', 'step__note', e.message)); });
  }

  function btn(text, fn, cls) {
    var b = el('button', 'm-mini' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  }
  function note(t) { $('d-note-out').textContent = t; }

  // ---------- the form ----------

  $('d-audio').addEventListener('change', function () {
    audioFile = this.files[0] || null;
    if (!audioFile) return;
    $('audio-name').textContent = audioFile.name + ' · ' + (audioFile.size / 1048576).toFixed(1) + ' MB';
    $('pick-audio').classList.add('m-mini--solid');
    if (!$('d-title').value) $('d-title').value = audioFile.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  });
  $('d-cover').addEventListener('change', function () {
    coverFile = this.files[0] || null;
    $('cover-name').textContent = coverFile ? coverFile.name : 'Bliver beskåret til et kvadrat';
  });

  Array.prototype.forEach.call(document.querySelectorAll('#d-when .m-chip'), function (c) {
    c.addEventListener('click', function () {
      when = c.dataset.when;
      Array.prototype.forEach.call(document.querySelectorAll('#d-when .m-chip'), function (x) { x.classList.toggle('is-on', x === c); });
      $('d-start-row').hidden = when !== 'later';
      if (when === 'later' && !$('d-start').value) $('d-start').value = localInput(new Date(Date.now() + 36e5));
      summary();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('#d-dur .m-chip'), function (c) {
    c.addEventListener('click', function () {
      hours = c.dataset.h === 'custom' ? 'custom' : Number(c.dataset.h);
      Array.prototype.forEach.call(document.querySelectorAll('#d-dur .m-chip'), function (x) { x.classList.toggle('is-on', x === c); });
      $('d-end-row').hidden = hours !== 'custom';
      if (hours === 'custom' && !$('d-end').value) $('d-end').value = localInput(new Date(startTime().getTime() + 864e5));
      summary();
    });
  });
  ['d-start', 'd-end'].forEach(function (id) { $(id).addEventListener('input', summary); });

  function startTime() { return when === 'later' && $('d-start').value ? new Date($('d-start').value) : new Date(); }
  function endTime() { return hours === 'custom' ? new Date($('d-end').value) : new Date(startTime().getTime() + hours * 36e5); }
  function summary() {
    var s = startTime(), e = endTime();
    $('d-summary').textContent = isNaN(e) ? '' : 'Åbner ' + (when === 'now' ? 'med det samme' : when2(s.toISOString())) + ' og forsvinder ' + when2(e.toISOString()) + '.';
  }
  summary();

  $('new-drop').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!audioFile) { note('Vælg sangen først.'); return; }
    var s = startTime(), end = endTime();
    if (isNaN(end) || end <= s) { note('Sluttidspunktet skal være efter starten.'); return; }
    var btnSave = $('d-save');
    btnSave.disabled = true;
    var created = null;
    prepareAudio(audioFile).then(function (blob) {
      note('Opretter…');
      return api('POST', 'vault', {
        title: $('d-title').value.trim(), artist: $('d-artist').value.trim(), note: $('d-note').value.trim(),
        starts_at: s.toISOString(), ends_at: end.toISOString()
      }).then(function (v) {
        created = v;
        note('Uploader sangen…');
        return upload('vault-upload?id=' + encodeURIComponent(v.id) + '&kind=audio', blob);
      });
    }).then(function () {
      if (!coverFile) return;
      note('Uploader cover…');
      return Admin.squareJpeg(coverFile, 1200).then(function (b) { return api('POST', 'vault-upload?id=' + encodeURIComponent(created.id) + '&kind=cover', undefined, b); });
    }).then(function () {
      note('"' + created.title + '" er i vaulten' + (when === 'now' ? ' nu.' : '.') + ' Den forsvinder ' + when2(end.toISOString()) + '.');
      $('new-drop').reset();
      audioFile = coverFile = null;
      $('audio-name').textContent = 'MP3, WAV, M4A … · max 24 MB, større WAV bliver lavet om til MP3';
      $('cover-name').textContent = 'Bliver beskåret til et kvadrat';
      $('pick-audio').classList.remove('m-mini--solid');
      document.querySelector('#d-when [data-when=now]').click();
      document.querySelector('#d-dur [data-h="24"]').click();
      load();
    }).catch(function (err) {
      note(err.message || 'Noget gik galt.');
      // A drop without audio is no use: remove it again
      if (created) api('DELETE', 'vault/' + encodeURIComponent(created.id)).then(load, load);
    }).then(function () {
      btnSave.disabled = false;
      $('d-progress').hidden = true;
    });
  });

  // Upload with progress (big files)
  function upload(path, blob) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', '/api/admin/' + path);
      x.setRequestHeader('content-type', blob.type || 'audio/mpeg');
      $('d-progress').hidden = false;
      x.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          $('d-progress').querySelector('i').style.width = Math.round(e.loaded / e.total * 100) + '%';
          note('Uploader sangen… ' + Math.round(e.loaded / e.total * 100) + '%');
        }
      };
      x.onload = function () {
        var out = {};
        try { out = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) resolve(out);
        else reject(new Error(out.error || 'Upload fejlede (' + x.status + ').'));
      };
      x.onerror = function () { reject(new Error('Ingen forbindelse under upload. Prøv igen.')); };
      x.send(blob);
    });
  }

  // MP3/M4A/AAC under 24 MB go up as they are; anything else (or bigger) becomes an MP3 here first
  function prepareAudio(file) {
    var type = file.type || '';
    var compressed = /mpeg|mp3|mp4|m4a|aac|x-m4a|ogg|opus/.test(type) || /\.(mp3|m4a|aac|ogg|opus)$/i.test(file.name);
    if (compressed && file.size <= MAX) {
      return Promise.resolve(type ? file : new Blob([file], { type: /\.m4a$/i.test(file.name) ? 'audio/mp4' : 'audio/mpeg' }));
    }
    note('Laver sangen om til MP3…');
    return file.arrayBuffer().then(function (data) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      return new Promise(function (resolve, reject) {
        var p = ctx.decodeAudioData(data, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      }).then(function (buf) { if (ctx.close) ctx.close(); return encode(buf); });
    }).catch(function (e) {
      throw new Error(e && e.message && /MP3|stor/.test(e.message) ? e.message : 'Filen kunne ikke læses. Prøv at gemme den som MP3 først.');
    });
  }

  function encode(buffer) {
    return new Promise(function (resolve, reject) {
      if (!window.lamejs) return reject(new Error('MP3-encoderen kunne ikke indlæses. Genindlæs siden.'));
      var rate = buffer.sampleRate, channels = Math.min(2, buffer.numberOfChannels), count = buffer.length;
      var kbps = buffer.duration > 600 ? 128 : 192;
      var enc;
      try { enc = new lamejs.Mp3Encoder(channels, rate, kbps); } catch (e) { return reject(new Error('Lydformatet kan ikke laves om til MP3.')); }
      var src = [];
      for (var c = 0; c < channels; c++) src.push(buffer.getChannelData(c));
      var parts = [], pos = 0, BLOCK = 1152 * 60;
      var toInt = function (f, from, to) {
        var out = new Int16Array(to - from);
        for (var i = from; i < to; i++) { var v = Math.max(-1, Math.min(1, f[i])); out[i - from] = v < 0 ? v * 0x8000 : v * 0x7fff; }
        return out;
      };
      (function next() {
        try {
          var end = Math.min(pos + BLOCK, count);
          for (var p = pos; p < end; p += 1152) {
            var to = Math.min(p + 1152, end);
            var l = toInt(src[0], p, to);
            var mp3 = channels === 2 ? enc.encodeBuffer(l, toInt(src[1], p, to)) : enc.encodeBuffer(l);
            if (mp3.length) parts.push(new Uint8Array(mp3));
          }
          pos = end;
          note('Laver sangen om til MP3… ' + Math.round(pos / count * 100) + '%');
          if (pos < count) return setTimeout(next, 0);
          var last = enc.flush();
          if (last.length) parts.push(new Uint8Array(last));
          var blob = new Blob(parts, { type: 'audio/mpeg' });
          if (blob.size > MAX) return reject(new Error('Sangen er for stor, selv som MP3 (max 24 MB).'));
          resolve(blob);
        } catch (e) { reject(new Error('Kunne ikke lave MP3.')); }
      })();
    });
  }

  setInterval(function () { if (drops.length) render(); }, 30000);
  Admin.start(load);
})();
