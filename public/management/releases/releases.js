// /management/releases: singles, EPs and albums, released and upcoming. Cover, tracklist, links,
// notes, a live countdown, and a flag that puts a release on the countdown page.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var api = Admin.api, el = Admin.el;
  var releases = [], editing = null, newKind = 'single';
  var KIND = { single: 'Single', ep: 'EP', album: 'Album' };

  function load() {
    return api('GET', 'releases').then(function (list) { releases = list; render(); }, function (e) { note(e.message); });
  }
  function note(t) { $('note').textContent = t; }
  function upcoming(r) { return r.release_at && Date.parse(r.release_at) > Date.now(); }
  function released(r) { return r.release_at && Date.parse(r.release_at) <= Date.now(); }
  function pad(n) { return ('0' + n).slice(-2); }
  function localInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function when(iso) { return new Date(iso).toLocaleString('da-DK', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function dur(s) { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + pad(s % 60); }
  function left(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return { d: Math.floor(s / 86400), h: Math.floor(s / 3600) % 24, m: Math.floor(s / 60) % 60, s: s % 60 };
  }
  function shortLeft(ms) {
    var l = left(ms);
    return (l.d ? l.d + 'd ' : '') + pad(l.h) + ':' + pad(l.m) + ':' + pad(l.s);
  }

  // ---------- overview ----------

  function render() {
    var up = releases.filter(upcoming).sort(function (a, b) { return a.release_at.localeCompare(b.release_at); });
    var nodate = releases.filter(function (r) { return !r.release_at; });
    var done = releases.filter(released).sort(function (a, b) { return b.release_at.localeCompare(a.release_at); });
    $('s-upcoming').textContent = up.length + nodate.length;
    $('s-released').textContent = done.length;
    $('s-tracks').textContent = releases.reduce(function (a, r) { return a + r.tracks.length; }, 0);
    $('s-countdown').textContent = releases.filter(function (r) { return r.countdown && upcoming(r); }).length;

    var next = up[0];
    $('next').hidden = !next;
    if (next) {
      cover($('next-cover'), next.cover_url);
      $('next-title').textContent = next.title;
      $('next-meta').textContent = KIND[next.kind] + ' · ' + when(next.release_at) + (next.tracks.length > 1 ? ' · ' + next.tracks.length + ' numre' : '') + (next.countdown ? ' · på nedtælling' : '');
      $('next-cd').dataset.at = next.release_at;
      $('next-open').onclick = function () { open(next.id); };
    }

    $('up-count').textContent = 'Kommende · ' + (up.length + nodate.length);
    $('rel-count').textContent = 'Udgivet · ' + done.length;
    grid($('up-list'), up.concat(nodate), 'Ingen kommende udgivelser. Tilføj en herover.');
    grid($('rel-list'), done, 'Intet udgivet endnu.');
    tick();
  }

  function cover(node, url) {
    node.classList.toggle('is-blank', !url);
    node.style.backgroundImage = url ? 'url("' + url + '")' : '';
  }

  function grid(box, list, empty) {
    box.innerHTML = '';
    if (!list.length) box.appendChild(el('p', 'step__note', empty));
    list.forEach(function (r) {
      var card = el('button', 'r-card');
      card.type = 'button';
      var art = el('span', 'r-card__cover art');
      cover(art, r.cover_url);
      art.appendChild(el('span', 'r-badge', KIND[r.kind]));
      if (r.countdown && upcoming(r)) art.appendChild(el('span', 'r-badge r-badge--cd', '⏱'));
      card.appendChild(art);
      card.appendChild(el('b', 'r-card__title', r.title));
      card.appendChild(el('small', 'r-card__meta', [
        r.release_at ? new Date(r.release_at).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Ingen dato endnu',
        r.tracks.length ? r.tracks.length + (r.tracks.length === 1 ? ' nummer' : ' numre') : ''
      ].filter(Boolean).join(' · ')));
      if (upcoming(r)) {
        var cd = el('span', 'r-card__cd');
        cd.dataset.at = r.release_at;
        card.appendChild(cd);
      }
      card.addEventListener('click', function () { open(r.id); });
      box.appendChild(card);
    });
  }

  // Countdowns, once a second
  var timer = 0;
  function tick() {
    clearTimeout(timer);
    var now = Date.now(), flipped = false;
    Array.prototype.forEach.call(document.querySelectorAll('.r-card__cd'), function (n) {
      var ms = Date.parse(n.dataset.at) - now;
      n.textContent = ms > 0 ? 'Om ' + shortLeft(ms) : 'Ude nu';
      if (ms <= 0) flipped = true;
    });
    var big = $('next-cd');
    if (big.dataset.at) {
      var l = left(Date.parse(big.dataset.at) - now);
      Array.prototype.forEach.call(big.querySelectorAll('[data-u]'), function (b) {
        var u = b.dataset.u;
        b.textContent = u === 'd' ? l.d : pad(l[u]);
      });
      if (Date.parse(big.dataset.at) <= now) flipped = true;
    }
    if (flipped && !editing) { render(); return; }
    timer = setTimeout(tick, 1000 - (now % 1000) + 20);
  }

  // ---------- new release ----------

  Array.prototype.forEach.call(document.querySelectorAll('#new-kind .m-chip'), function (c) {
    c.addEventListener('click', function () {
      newKind = c.dataset.kind;
      Array.prototype.forEach.call(document.querySelectorAll('#new-kind .m-chip'), function (x) { x.classList.toggle('is-on', x === c); });
    });
  });
  $('new').addEventListener('submit', function (e) {
    e.preventDefault();
    var title = $('new-title').value.trim();
    if (!title) { $('new-title').focus(); return; }
    $('new-btn').disabled = true;
    api('POST', 'releases', {
      kind: newKind, title: title,
      release_at: $('new-date').value ? new Date($('new-date').value).toISOString() : null
    }).then(function (r) {
      $('new').reset();
      releases.push(r);
      render();
      open(r.id);
    }, function (err) { note(err.message); }).then(function () { $('new-btn').disabled = false; });
  });

  // ---------- editing ----------

  function find(id) { return releases.filter(function (r) { return r.id === id; })[0]; }
  function replace(r) {
    releases = releases.map(function (x) { return x.id === r.id ? r : x; });
    if (editing === r.id) fill(r);
  }
  function save(patch, msg) {
    var id = editing;
    $('e-note').textContent = 'Gemmer…';
    return api('PATCH', 'releases/' + encodeURIComponent(id), patch).then(function (r) {
      replace(r);
      $('e-note').textContent = msg || 'Gemt.';
    }, function (e) { $('e-note').textContent = e.message; });
  }

  function open(id) {
    editing = id;
    fill(find(id));
    $('e-note').textContent = '';
    if (!$('edit').open) $('edit').showModal();
  }

  function fill(r) {
    cover($('e-cover'), r.cover_url);
    Array.prototype.forEach.call(document.querySelectorAll('#e-kind .m-chip'), function (c) { c.classList.toggle('is-on', c.dataset.kind === r.kind); });
    if (document.activeElement !== $('e-title')) $('e-title').value = r.title;
    if (document.activeElement !== $('e-artist')) $('e-artist').value = r.artist || '';
    if (document.activeElement !== $('e-date')) $('e-date').value = localInput(r.release_at);
    $('e-status').textContent = !r.release_at ? 'Ingen dato endnu' : upcoming(r) ? 'Kommende · om ' + shortLeft(Date.parse(r.release_at) - Date.now()) : 'Udgivet ' + when(r.release_at);
    $('e-countdown').checked = r.countdown;
    $('e-cd-title-row').hidden = !r.countdown;
    if (document.activeElement !== $('e-cd-title')) $('e-cd-title').value = r.countdown_title || '';
    Array.prototype.forEach.call(document.querySelectorAll('[data-link]'), function (i) {
      if (document.activeElement !== i) i.value = r.links[i.dataset.link] || '';
    });
    if (document.activeElement !== $('e-notes')) $('e-notes').value = r.notes || '';
    $('e-tracks-label').textContent = 'Tracklist · ' + r.tracks.length + (r.tracks.length === 1 ? ' nummer' : ' numre') + (r.duration ? ' · ' + dur(r.duration) : '');
    tracks(r);
  }

  function tracks(r) {
    var box = $('e-tracks');
    var focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    box.innerHTML = '';
    r.tracks.forEach(function (t, i) {
      var li = el('li', 'r-track');
      li.appendChild(el('span', 'r-track__no', String(i + 1)));
      var title = input(t.title, 'Titel', 120, 'title:' + t.id);
      title.classList.add('r-track__title');
      title.addEventListener('change', function () { patchTrack(t.id, { title: title.value.trim() }); });
      var feat = input(t.feat || '', 'feat.', 120, 'feat:' + t.id);
      feat.classList.add('r-track__feat');
      feat.addEventListener('change', function () { patchTrack(t.id, { feat: feat.value.trim() }); });
      var len = input(t.duration ? dur(t.duration) : '', '0:00', 6, 'len:' + t.id);
      len.classList.add('r-track__len');
      len.inputMode = 'numeric';
      len.addEventListener('change', function () {
        var m = len.value.trim().match(/^(\d+)(?::(\d{1,2}))?$/);
        patchTrack(t.id, { duration: m ? (m[2] !== undefined ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1])) : null });
      });
      li.appendChild(title); li.appendChild(feat); li.appendChild(len);
      li.appendChild(mini('↑', i === 0, function () { move(r, i, -1); }, 'Flyt op'));
      li.appendChild(mini('↓', i === r.tracks.length - 1, function () { move(r, i, 1); }, 'Flyt ned'));
      li.appendChild(mini('×', false, function () {
        if (!confirm('Fjern "' + (t.title || 'nummer') + '" fra tracklisten?')) return;
        api('DELETE', 'release-tracks/' + encodeURIComponent(t.id)).then(replace, err);
      }, 'Fjern'));
      box.appendChild(li);
    });
    if (focused) {
      var f = box.querySelector('[data-key="' + focused + '"]');
      if (f) f.focus();
    }
  }

  function input(value, ph, max, key) {
    var i = el('input', 'm-in');
    i.type = 'text'; i.value = value; i.placeholder = ph; i.maxLength = max;
    i.dataset.key = key;
    return i;
  }
  function mini(text, disabled, fn, label) {
    var b = el('button', 'm-mini', text);
    b.type = 'button'; b.disabled = disabled;
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', fn);
    return b;
  }
  function err(e) { $('e-note').textContent = e.message; }
  function patchTrack(id, data) { api('PATCH', 'release-tracks/' + encodeURIComponent(id), data).then(replace, err); }
  function move(r, i, dir) {
    var ids = r.tracks.map(function (t) { return t.id; });
    ids.splice(i + dir, 0, ids.splice(i, 1)[0]);
    api('POST', 'release-order', { release: r.id, ids: ids }).then(replace, err);
  }

  $('e-addtrack').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('e-newtrack').value.trim();
    if (!t) { $('e-newtrack').focus(); return; }
    api('POST', 'release-tracks', { release: editing, title: t }).then(function (r) {
      $('e-newtrack').value = '';
      replace(r);
      $('e-newtrack').focus();
    }, err);
  });

  Array.prototype.forEach.call(document.querySelectorAll('#e-kind .m-chip'), function (c) {
    c.addEventListener('click', function () { save({ kind: c.dataset.kind }); });
  });
  $('e-title').addEventListener('change', function () { save({ title: $('e-title').value.trim() }); });
  $('e-artist').addEventListener('change', function () { save({ artist: $('e-artist').value.trim() }); });
  $('e-date').addEventListener('change', function () { save({ release_at: $('e-date').value ? new Date($('e-date').value).toISOString() : null }); });
  $('e-countdown').addEventListener('change', function () {
    save({ countdown: $('e-countdown').checked }, $('e-countdown').checked ? 'Kommer på nedtællingssiden.' : 'Fjernet fra nedtællingssiden.');
  });
  $('e-cd-title').addEventListener('change', function () { save({ countdown_title: $('e-cd-title').value.trim() }); });
  $('e-notes').addEventListener('change', function () { save({ notes: $('e-notes').value }); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-link]'), function (i) {
    i.addEventListener('change', function () { var l = {}; l[i.dataset.link] = i.value.trim(); save({ links: l }); });
  });
  $('e-cover-input').addEventListener('change', function () {
    var file = this.files[0];
    this.value = '';
    if (!file) return;
    $('e-note').textContent = 'Uploader cover…';
    Admin.squareJpeg(file, 1600).then(function (blob) {
      return api('POST', 'release-cover?id=' + encodeURIComponent(editing), undefined, blob);
    }).then(function (r) { replace(r); $('e-note').textContent = 'Cover gemt.'; }, err);
  });
  $('e-delete').addEventListener('click', function () {
    var r = find(editing);
    if (!confirm('Slet "' + r.title + '" med cover og tracklist?')) return;
    api('DELETE', 'releases/' + encodeURIComponent(r.id)).then(function () {
      releases = releases.filter(function (x) { return x.id !== r.id; });
      $('edit').close();
      note('"' + r.title + '" er slettet.');
    }, err);
  });
  $('e-close').addEventListener('click', function () { $('edit').close(); });
  $('edit').addEventListener('close', function () { editing = null; render(); });

  Admin.start(load);
})();
