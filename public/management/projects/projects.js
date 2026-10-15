// /management/projects: projects with goals, and a tracker of songs, versions and album art.
// /management/projects/       → all projects
// /management/projects/?id=…  → one project
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var api = Admin.api, el = Admin.el;
  var projectId = new URLSearchParams(location.search).get('id');
  var project = null;
  var opened = {};      // song id → details open (survives redrawing)
  var view = 'grid';    // 'grid' (square covers, 3 per row) | 'list'
  var sheetSong = null; // song shown in the song sheet
  var mode = null;      // upload: 'new' or 'existing'
  var target = null;    // upload: the song new versions go to
  var pending = [];     // files read, waiting for the review sheet
  try { view = localStorage.getItem('luciano:tracker-view2') || 'grid'; } catch (e) {}

  // ---------- all projects ----------

  function loadList() {
    $('list-view').hidden = false;
    api('GET', 'projects').then(function (list) {
      var active = list.filter(function (p) { return p.status !== 'done'; });
      var done = list.filter(function (p) { return p.status === 'done'; });
      var sum = function (f) { return list.reduce(function (a, p) { return a + f(p); }, 0); };
      $('all-projects').textContent = active.length;
      $('all-songs').textContent = sum(function (p) { return p.counts.songs; });
      $('all-versions').textContent = sum(function (p) { return p.counts.versions; });
      $('all-goals').textContent = sum(function (p) { return p.goals.filter(function (g) { return g.done; }).length; }) + '/' + sum(function (p) { return p.goals.length; });
      var box = $('projects');
      box.innerHTML = '';
      if (!list.length) box.appendChild(el('p', 'step__note', 'Ingen projekter endnu. Giv dit første et navn herover.'));
      active.forEach(function (p) { box.appendChild(ProjectCards.card(p, '?id=' + encodeURIComponent(p.id))); });
      $('done-label').hidden = !done.length;
      $('projects-done').innerHTML = '';
      done.forEach(function (p) { $('projects-done').appendChild(ProjectCards.card(p, '?id=' + encodeURIComponent(p.id))); });
    }, function (e) { $('list-note').textContent = e.message; });
  }

  $('new-title').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    createProject();
  });
  $('new-project').addEventListener('submit', function (e) {
    e.preventDefault();
    createProject();
  });
  function createProject() {
    if ($('new-btn').disabled) return;
    var title = $('new-title').value.trim();
    if (!title) { $('new-title').focus(); return; }
    $('new-btn').disabled = true;
    api('POST', 'projects', { title: title }).then(function (p) {
      location.href = '?id=' + encodeURIComponent(p.id);
    }, function (e) {
      $('new-btn').disabled = false;
      $('list-note').textContent = e.message;
    });
  }

  // ---------- one project ----------

  var allProjects = [];
  function loadProject() {
    $('detail-view').hidden = false;
    api('GET', 'projects').then(function (list) { allProjects = list; if (project) render(); }, function () {});
    $('title').textContent = 'Projekt';
    return api('GET', 'projects/' + encodeURIComponent(projectId)).then(function (p) {
      setProject(p);
      // Opened from the dashboard's "latest versions": jump to the song
      var m = /^#song-(.+)$/.exec(location.hash);
      if (m && document.getElementById('song-' + m[1])) {
        opened[m[1]] = true;
        render();
        document.getElementById('song-' + m[1]).scrollIntoView({ block: 'center' });
      }
    }, function (e) {
      $('p-note').textContent = e.status === 404 ? 'Projektet findes ikke længere.' : e.message;
    });
  }

  function setProject(p) {
    project = p;
    document.title = '99 LUCIANO | ' + (p.title || 'Projekt');
    render();
  }

  function render() {
    var p = project;
    $('title').textContent = p.title || 'Projekt';
    if (document.activeElement !== $('p-title')) $('p-title').value = p.title;
    if (document.activeElement !== $('p-notes')) $('p-notes').value = p.notes;
    $('p-due').value = p.due ? p.due.slice(0, 10) : '';
    $('p-done').checked = p.status === 'done';
    renderGoals();
    renderSongs();
  }

  function save(patch, note) {
    $('p-note').textContent = 'Gemmer…';
    return api('PATCH', 'projects/' + encodeURIComponent(project.id), patch).then(function (p) {
      setProject(p);
      $('p-note').textContent = note || 'Gemt.';
    }, function (e) { $('p-note').textContent = e.message; });
  }

  $('p-title').addEventListener('change', function () { save({ title: $('p-title').value.trim() }); });
  $('p-notes').addEventListener('change', function () { save({ notes: $('p-notes').value }); });
  $('p-due').addEventListener('change', function () { save({ due: $('p-due').value ? $('p-due').value + 'T12:00:00Z' : null }); });
  $('p-done').addEventListener('change', function () {
    save({ status: $('p-done').checked ? 'done' : 'active' }, $('p-done').checked ? 'Markeret som færdigt.' : 'Aktivt igen.');
  });

  $('p-delete').addEventListener('click', function () {
    if (!confirm('Slet "' + project.title + '" med alle mål, sange, versioner og covers? Det kan ikke fortrydes.')) return;
    api('DELETE', 'projects/' + encodeURIComponent(project.id)).then(function () {
      location.href = './';
    }, function (e) { $('p-note').textContent = e.message; });
  });

  // ---------- goals ----------

  function renderGoals() {
    var box = $('goals');
    box.innerHTML = '';
    if (!project.goals.length) box.appendChild(el('p', 'step__note', 'Ingen mål endnu. Et mål for sange eller versioner tæller selv op, når du lægger filer i trackeren.'));
    project.goals.forEach(function (g) {
      var row = el('div', 'm-goal-row');
      row.appendChild(ProjectCards.goalBar(g));
      var meta = el('p', 'm-goal__meta', [
        g.kind === 'manual' ? 'Du tæller selv' : 'Tæller ' + ProjectCards.KIND_NAMES[g.kind].toLowerCase() + ' automatisk',
        g.due ? 'deadline ' + Admin.date(g.due) : ''
      ].filter(Boolean).join(' · '));
      row.appendChild(meta);
      var actions = el('div', 'm-song__actions');
      if (g.kind === 'manual') {
        actions.appendChild(button('−', function () { patchGoal(g, { current: Math.max(0, g.current - 1) }); }, 'Én mindre'));
        actions.appendChild(button('+', function () { patchGoal(g, { current: g.current + 1 }); }, 'Én mere'));
      }
      actions.appendChild(button('Ret antal', function () {
        var n = parseInt(prompt('Hvor mange skal der til?', g.target), 10);
        if (n >= 1) patchGoal(g, { target: n });
      }));
      actions.appendChild(button('Slet', function () {
        if (!confirm('Slet målet "' + (g.title || ProjectCards.KIND_NAMES[g.kind]) + '"?')) return;
        api('DELETE', 'goals/' + encodeURIComponent(g.id)).then(setProject, fail);
      }, null, 'm-del'));
      row.appendChild(actions);
      box.appendChild(row);
    });
  }

  function patchGoal(g, patch) {
    api('PATCH', 'goals/' + encodeURIComponent(g.id), patch).then(setProject, fail);
  }

  // Suggest a title like "12 sange" until one is typed
  function autoTitle() {
    var t = $('g-title');
    if (t.value && !t.dataset.auto) return;
    var n = $('g-target').value || 10;
    t.value = { songs: n + ' sange', versions: n + ' versioner', art: n + ' covers', manual: '' }[$('g-kind').value];
    t.dataset.auto = t.value ? '1' : '';
  }
  $('g-kind').addEventListener('change', autoTitle);
  $('g-target').addEventListener('input', autoTitle);
  autoTitle();
  $('g-title').addEventListener('input', function () { $('g-title').dataset.auto = ''; });

  $('goal-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = parseInt($('g-target').value, 10);
    if (!(n >= 1)) { $('g-target').focus(); return; }
    api('POST', 'goals', {
      project: project.id,
      title: $('g-title').value.trim(),
      kind: $('g-kind').value,
      target: n,
      due: $('g-due').value ? $('g-due').value + 'T12:00:00Z' : null
    }).then(function (p) {
      setProject(p);
      $('goal-form').reset();
      $('g-title').dataset.auto = '1';
      autoTitle();
      $('add-goal').open = false;
    }, fail);
  });

  // ---------- song tracker ----------

  function renderOverview() {
    var c = project.counts, done = project.goals.filter(function (g) { return g.done; }).length;
    $('ov-songs').textContent = c.songs;
    $('ov-versions').textContent = c.versions;
    $('ov-art').textContent = c.art + '/' + c.songs;
    $('ov-goals').textContent = done + '/' + project.goals.length;
    var missing = [];
    if (c.songs - c.art) missing.push((c.songs - c.art) + (c.songs - c.art === 1 ? ' sang mangler cover' : ' sange mangler cover'));
    if (c.songs - (c.linked || 0)) missing.push((c.songs - c.linked) + (c.songs - c.linked === 1 ? ' sang mangler link' : ' sange mangler link'));
    $('ov-note').textContent = missing.join(' · ');
  }

  function renderSongs() {
    renderOverview();
    var songs = project.songs;
    $('tracker-count').textContent = songs.length + (songs.length === 1 ? ' sang' : ' sange') + ' · ' +
      project.counts.versions + (project.counts.versions === 1 ? ' version' : ' versioner');
    document.querySelectorAll('.m-view .m-chip').forEach(function (c) { c.classList.toggle('is-on', c.dataset.view === view); });
    var box = $('songs');
    box.innerHTML = '';
    box.className = 'm-tracks' + (view === 'grid' ? ' is-grid' : '');
    if (!songs.length) {
      box.appendChild(el('p', 'step__note', 'Tryk på + for at lægge din første sang i trackeren.'));
      return;
    }
    songs.forEach(function (s) { box.appendChild(view === 'grid' ? songTile(s) : songCard(s)); });
    $('drag-hint').hidden = view !== 'grid' || songs.length < 2;
    // Keep the open song sheet up to date
    if (sheetSong && $('song-sheet').open) {
      var cur = songs.filter(function (x) { return x.id === sheetSong; })[0];
      if (cur) fillSheet(cur); else $('song-sheet').close();
    }
  }

  function fillSheet(s) {
    sheetSong = s.id;
    opened[s.id] = true;
    var body = $('song-sheet-body');
    body.innerHTML = '';
    body.appendChild(songCard(s));
  }
  $('song-sheet').addEventListener('close', function () { sheetSong = null; });

  document.querySelectorAll('.m-view .m-chip').forEach(function (c) {
    c.addEventListener('click', function () {
      view = c.dataset.view;
      try { localStorage.setItem('luciano:tracker-view2', view); } catch (e) {}
      renderSongs();
    });
  });

  function latest(s) { return s.versions[0] || null; }

  function songMeta(s) {
    var v = latest(s);
    return [
      s.versions.length + (s.versions.length === 1 ? ' version' : ' versioner'),
      v ? 'seneste ' + v.label + ' · ' + Admin.date(v.file_date) : '',
      s.art.length > 1 ? s.art.length + ' covers' : ''
    ].filter(Boolean).join(' · ');
  }

  // A tap-to-upload album art box. hint set = a plain "+ Cover" tile instead of the current art.
  function artBox(s, cls, hint) {
    var url = hint ? null : s.art_url;
    var art = el('label', cls + (hint ? '' : ' art' + (url ? '' : ' is-blank')));
    art.title = 'Tilføj album art';
    if (url) art.style.backgroundImage = 'url("' + url + '")';
    var input = el('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', function () {
      var file = input.files[0];
      input.value = '';
      if (file) uploadArt(s, file);
    });
    art.appendChild(input);
    art.appendChild(el('span', 'm-cover-hint', hint || (url ? 'Nyt cover' : 'Cover')));
    return art;
  }

  // Covers view: a grid of album art; tap one to open it in the list
  // A square tile: the cover with the title on it. Tap opens the song; drag moves it.
  function songTile(s) {
    var tile = el('button', 'm-tile' + (s.art_url ? '' : ' is-blank'));
    tile.type = 'button';
    tile.dataset.id = s.id;
    if (s.art_url) tile.style.backgroundImage = 'url("' + s.art_url + '")';
    var cap = el('span', 'm-tile__cap');
    cap.appendChild(el('b', null, s.title));
    var v = latest(s);
    cap.appendChild(el('small', null, v ? v.label + ' · ' + Admin.date(v.file_date) : 'Ingen versioner'));
    tile.appendChild(cap);
    var playable = s.versions.filter(function (x) { return x.link; })[0];
    if (playable) {
      var pl = playLink(playable.link, '▶');
      pl.className = 'm-tile__play';
      pl.setAttribute('aria-label', 'Afspil ' + s.title + ' ' + playable.label);
      pl.addEventListener('click', function (e) { e.stopPropagation(); });
      tile.appendChild(pl);
    }
    tile.addEventListener('click', function () {
      if (justDragged) return;
      fillSheet(s);
      $('song-sheet').showModal();
    });
    return tile;
  }

  // ---------- drag and drop: reorder the covers ----------

  var justDragged = false;
  (function sortable(box) {
    var drag = null;

    box.addEventListener('pointerdown', function (e) {
      var tile = e.target.closest('.m-tile');
      if (!tile || e.target.closest('.m-tile__play') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { tile: tile, id: e.pointerId, x: e.clientX, y: e.clientY, active: false, touch: e.pointerType !== 'mouse', timer: 0 };
      // On a phone: hold the finger still to pick it up, so scrolling still works
      if (drag.touch) drag.timer = setTimeout(begin, 280);
    });

    function begin() {
      if (!drag) return;
      drag.active = true;
      drag.tile.classList.add('is-dragging');
      box.classList.add('is-sorting');
      try { drag.tile.setPointerCapture(drag.id); } catch (e) {}
      if (navigator.vibrate) navigator.vibrate(12);
    }

    box.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dist = Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
      if (!drag.active) {
        if (drag.touch) { if (dist > 10) end(false); return; }
        if (dist < 6) return;
        begin();
      }
      e.preventDefault();
      // Move the tile to where the pointer is
      drag.tile.style.visibility = 'hidden';
      var under = document.elementFromPoint(e.clientX, e.clientY);
      drag.tile.style.visibility = '';
      var over = under && under.closest('.m-tile');
      if (!over || over === drag.tile || over.parentNode !== box) return;
      var tiles = Array.prototype.slice.call(box.children);
      box.insertBefore(drag.tile, tiles.indexOf(over) > tiles.indexOf(drag.tile) ? over.nextSibling : over);
    });

    // Stop the page from scrolling while a tile is held
    box.addEventListener('touchmove', function (e) { if (drag && drag.active) e.preventDefault(); }, { passive: false });
    box.addEventListener('contextmenu', function (e) { if (drag) e.preventDefault(); });

    function end(save) {
      if (!drag) return;
      clearTimeout(drag.timer);
      var was = drag.active;
      drag.tile.classList.remove('is-dragging');
      box.classList.remove('is-sorting');
      drag = null;
      if (!was) return;
      justDragged = true;
      setTimeout(function () { justDragged = false; }, 50);
      if (!save) return;
      var ids = Array.prototype.map.call(box.querySelectorAll('.m-tile'), function (t) { return t.dataset.id; });
      if (ids.join() === project.songs.map(function (x) { return x.id; }).join()) return;
      api('POST', 'track-order', { project: project.id, ids: ids }).then(function (p) {
        setProject(p);
        note('Rækkefølgen er gemt.');
      }, function (e) { fail(e); renderSongs(); });
    }
    box.addEventListener('pointerup', function (e) { if (drag && e.pointerId === drag.id) end(true); });
    box.addEventListener('pointercancel', function (e) { if (drag && e.pointerId === drag.id) end(true); });
  })($('songs'));

  // ---------- drag and drop: audio files onto the tracker ----------

  (function dropFiles(zone) {
    var depth = 0;
    var hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; };
    zone.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      $('dropzone').hidden = false;
      zone.classList.add('is-drop');
    });
    zone.addEventListener('dragover', function (e) { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    zone.addEventListener('dragleave', function () {
      if (--depth > 0) return;
      depth = 0;
      $('dropzone').hidden = true;
      zone.classList.remove('is-drop');
    });
    zone.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      $('dropzone').hidden = true;
      zone.classList.remove('is-drop');
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      var skipped = files.filter(function (f) { return !SongFile.isAudio(f); });
      var read = files.filter(SongFile.isAudio).map(function (f) {
        var r = SongFile.parse(f.name, f.lastModified);
        return { title: r.title, label: r.label || '', date: r.date, link: '', file_name: f.name, file_type: f.type || r.ext, file_size: f.size };
      });
      if (!read.length) { note('Det var ikke lydfiler.'); return; }
      mode = 'new';
      target = null;
      pending = read;
      openReview(skipped);
    });
  })($('tracker'));

  function songCard(s) {
    var card = el('article', 'm-track');
    card.id = 'song-' + s.id;
    card.appendChild(artBox(s, 'm-track__art'));

    var body = el('div', 'm-track__body');
    var title = el('input', 'm-in m-title');
    title.type = 'text';
    title.maxLength = 80;
    title.value = s.title;
    title.setAttribute('aria-label', 'Sangens titel');
    title.addEventListener('change', function () {
      if (!title.value.trim()) { title.value = s.title; return; }
      api('PATCH', 'tracks/' + encodeURIComponent(s.id), { title: title.value.trim() }).then(setProject, fail);
    });
    body.appendChild(title);
    body.appendChild(el('p', 'm-track__meta', songMeta(s)));
    var playable = s.versions.filter(function (v) { return v.link; })[0];
    if (playable) {
      var pl = playLink(playable.link, '▶ Afspil ' + playable.label);
      pl.classList.add('m-mini--solid', 'm-track__play');
      body.appendChild(pl);
    }

    var det = el('details', 'm-track__more');
    det.open = !!opened[s.id];
    det.addEventListener('toggle', function () { opened[s.id] = det.open; });
    det.appendChild(el('summary', null, 'Versioner og covers'));

    // Versions, newest first
    var list = el('ol', 'm-versions');
    s.versions.forEach(function (v, i) {
      var li = el('li', 'm-version' + (i === 0 ? ' is-latest' : ''));
      var label = el('input', 'm-in m-version__label');
      label.value = v.label;
      label.maxLength = 40;
      label.setAttribute('aria-label', 'Version');
      label.addEventListener('change', function () {
        if (!label.value.trim()) { label.value = v.label; return; }
        api('PATCH', 'versions/' + encodeURIComponent(v.id), { label: label.value.trim() }).then(setProject, fail);
      });
      li.appendChild(label);
      var info = el('span', 'm-version__info');
      info.appendChild(el('b', null, Admin.date(v.file_date) + (i === 0 ? ' · seneste' : '')));
      info.appendChild(el('small', null, [v.file_name, v.file_size ? size(v.file_size) : '', v.link ? host(v.link) : 'intet link'].filter(Boolean).join(' · ')));
      li.appendChild(info);
      var acts = el('span', 'm-version__acts');
      if (v.link) acts.appendChild(playLink(v.link, '▶'));
      acts.appendChild(button(v.link ? 'Link' : '+ Link', function () {
        var u = prompt('Link til ' + v.label + ' (Dropbox, Google Drive …). Tomt = fjern linket.', v.link || '');
        if (u === null) return;
        api('PATCH', 'versions/' + encodeURIComponent(v.id), { link: u.trim() }).then(setProject, fail);
      }, 'Link til versionen'));
      li.appendChild(acts);
      acts.appendChild(button('×', function () {
        if (!confirm('Fjern ' + v.label + (v.file_name ? ' (' + v.file_name + ')' : '') + ' fra trackeren?')) return;
        api('DELETE', 'versions/' + encodeURIComponent(v.id)).then(setProject, fail);
      }, 'Fjern version'));
      list.appendChild(li);
    });
    if (!s.versions.length) list.appendChild(el('li', 'step__note', 'Ingen versioner.'));
    det.appendChild(list);

    // Album art: every upload is kept; the marked one is shown
    det.appendChild(el('p', 'm-sublabel', 'Album art'));
    var gallery = el('div', 'm-gallery');
    s.art.forEach(function (a) {
      var item = el('div', 'm-gallery__item' + (a.id === s.art_id ? ' is-current' : ''));
      var pick = el('button', 'm-gallery__img art');
      pick.type = 'button';
      pick.style.backgroundImage = 'url("' + a.url + '")';
      pick.title = a.id === s.art_id ? 'Vises nu' : 'Vis dette cover';
      pick.setAttribute('aria-label', pick.title + ' (' + Admin.date(a.added_at) + ')');
      pick.addEventListener('click', function () {
        if (a.id === s.art_id) { window.open(a.url, '_blank', 'noopener'); return; }
        api('PATCH', 'tracks/' + encodeURIComponent(s.id), { art_id: a.id }).then(setProject, fail);
      });
      item.appendChild(pick);
      item.appendChild(el('small', null, a.id === s.art_id ? 'Vises' : Admin.date(a.added_at)));
      var del = el('button', 'm-gallery__del', '×');
      del.type = 'button';
      del.setAttribute('aria-label', 'Slet cover');
      del.addEventListener('click', function () {
        if (!confirm('Slet dette cover?')) return;
        api('DELETE', 'art/' + encodeURIComponent(a.id)).then(setProject, fail);
      });
      item.appendChild(del);
      gallery.appendChild(item);
    });
    gallery.appendChild(artBox(s, 'm-gallery__add', '+ Cover'));
    det.appendChild(gallery);

    // Move to another project
    var moveRow = el('label', 'm-field m-move');
    moveRow.appendChild(el('span', null, 'Flyt til projekt'));
    var sel = el('select', 'm-select');
    var here = el('option', null, project.title + ' (her)');
    here.value = '';
    sel.appendChild(here);
    allProjects.filter(function (p) { return p.id !== project.id; }).forEach(function (p) {
      var o = el('option', null, p.title + (p.status === 'done' ? ' (færdigt)' : ''));
      o.value = p.id;
      sel.appendChild(o);
    });
    sel.disabled = allProjects.length < 2;
    if (sel.disabled) here.textContent = 'Opret et projekt mere for at flytte sange';
    sel.addEventListener('change', function () {
      if (!sel.value) return;
      var to = allProjects.filter(function (p) { return p.id === sel.value; })[0];
      if (!confirm('Flyt "' + s.title + '" med versioner og covers til ' + to.title + '?')) { sel.value = ''; return; }
      api('PATCH', 'tracks/' + encodeURIComponent(s.id), { project: to.id }).then(function (p) {
        if ($('song-sheet').open) $('song-sheet').close();
        setProject(p);
        note('"' + s.title + '" er flyttet til ' + to.title + '.');
      }, fail);
    });
    moveRow.appendChild(sel);
    det.appendChild(moveRow);

    var actions = el('div', 'm-song__actions');
    actions.appendChild(button('+ Ny version', function () { chooseFiles('existing', s); }, null, 'm-mini--solid'));
    actions.appendChild(button('Slet sang', function () {
      if (!confirm('Slet "' + s.title + '" med alle versioner og covers?')) return;
      api('DELETE', 'tracks/' + encodeURIComponent(s.id)).then(setProject, fail);
    }, null, 'm-del'));
    det.appendChild(actions);

    body.appendChild(det);
    card.appendChild(body);
    return card;
  }

  function uploadArt(s, file) {
    note('Uploader cover…');
    Admin.squareJpeg(file, 1400).then(function (blob) {
      return api('POST', 'art?track=' + encodeURIComponent(s.id), undefined, blob);
    }).then(function (p) {
      before(p);
      note('Cover gemt til "' + s.title + '". Tidligere covers er gemt under Versioner og covers.');
    }, fail);
  }

  // ---------- the + button ----------

  var menu = $('plus-menu'), plus = $('plus');
  function closeMenu() { menu.hidden = true; plus.setAttribute('aria-expanded', 'false'); plus.classList.remove('is-open'); }
  plus.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = menu.hidden;
    menu.hidden = !open;
    plus.setAttribute('aria-expanded', String(open));
    plus.classList.toggle('is-open', open);
  });
  document.addEventListener('click', function (e) { if (!menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

  menu.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () {
      closeMenu();
      if (b.dataset.mode === 'new') return chooseFiles('new', null);
      if (!project.songs.length) {
        note('Der er ingen sange endnu. Vælg "Tilføj ny sang" først.');
        return;
      }
      // Which song gets the new version?
      var list = $('pick-list');
      list.innerHTML = '';
      project.songs.forEach(function (s) {
        var row = el('button', 'm-pick__row');
        row.type = 'button';
        var art = el('span', 'm-pick__art art' + (s.art_url ? '' : ' is-blank'));
        if (s.art_url) art.style.backgroundImage = 'url("' + s.art_url + '")';
        row.appendChild(art);
        var t = el('span', 'm-pick__text');
        t.appendChild(el('b', null, s.title));
        t.appendChild(el('small', null, songMeta(s)));
        row.appendChild(t);
        row.addEventListener('click', function () {
          $('pick').close();
          chooseFiles('existing', s);
        });
        list.appendChild(row);
      });
      $('pick').showModal();
    });
  });

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  // Opens the add form: name (for a new song), version, link and date. A file can fill it in.
  function chooseFiles(m, song) {
    mode = m;
    target = song;
    pending = [{ title: '', label: '', date: today(), link: '', file_name: '', file_type: null, file_size: null }];
    openReview([]);
    var first = $('review-list').querySelector('input');
    if (first) setTimeout(function () { first.focus(); }, 50);
  }

  $('review-files').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = '';
    if (!files.length) return;
    var keepLink = pending.length === 1 ? pending[0].link : '';
    var skipped = files.filter(function (f) { return !SongFile.isAudio(f); });
    var read = files.filter(SongFile.isAudio).map(function (f) {
      var r = SongFile.parse(f.name, f.lastModified);
      return { title: r.title, label: r.label || '', date: r.date, link: '', file_name: f.name, file_type: f.type || r.ext, file_size: f.size };
    });
    if (!read.length) {
      $('review-note').textContent = 'Det var ikke en lydfil' + (skipped.length ? ' (' + skipped.map(function (f) { return f.name; }).join(', ') + ').' : '.');
      return;
    }
    if (read.length === 1) read[0].link = keepLink;
    pending = read;
    openReview(skipped);
  });

  function openReview(skipped) {
    $('review-title').textContent = mode === 'existing' ? 'Ny version af ' + target.title : 'Ny sang';
    $('review-note').textContent = 'Tom version bliver næste nummer. Linket kan være fra Dropbox, Google Drive eller hvor sangen ellers ligger.' +
      (skipped.length ? ' Sprunget over (ikke lyd): ' + skipped.map(function (f) { return f.name; }).join(', ') + '.' : '');
    $('review-ok').textContent = pending.length === 1 ? 'Tilføj' : 'Tilføj ' + pending.length + ' sange';
    var list = $('review-list');
    list.innerHTML = '';
    pending.forEach(function (f) {
      var row = el('div', 'm-review__row');
      if (f.file_name) row.appendChild(el('p', 'm-review__file', f.file_name));
      var fields = el('div', 'm-review__fields');
      var hint = el('small', 'm-review__hint');
      if (mode === 'new') {
        var t = field('Sang', 'text', f.title, function (v) { f.title = v; match(); });
        t.querySelector('input').maxLength = 80;
        t.querySelector('input').placeholder = 'Fx Natlys';
        t.querySelector('input').required = true;
        t.classList.add('m-review__title');
        fields.appendChild(t);
      }
      var l = field('Version', 'text', f.label, function (v) { f.label = v; });
      l.querySelector('input').placeholder = 'Næste nr.';
      l.querySelector('input').maxLength = 40;
      fields.appendChild(l);
      fields.appendChild(field('Dato', 'date', f.date || '', function (v) { f.date = v; }));
      var lk = field('Link (Dropbox, Google Drive …)', 'url', f.link || '', function (v) { f.link = v; });
      lk.querySelector('input').placeholder = 'https://…';
      lk.querySelector('input').inputMode = 'url';
      lk.classList.add('m-review__title');
      fields.appendChild(lk);
      row.appendChild(fields);
      row.appendChild(hint);
      // A title the project already has becomes a new version of that song
      function match() {
        var hit = mode === 'new' && project.songs.some(function (s) { return s.title.toLowerCase() === f.title.trim().toLowerCase(); });
        hint.textContent = hit ? '"' + f.title.trim() + '" findes allerede, så filen bliver en ny version af den.' : '';
      }
      match();
      list.appendChild(row);
    });
    $('review').showModal();
  }

  function field(label, type, value, onInput) {
    var l = el('label', 'm-field');
    l.appendChild(el('span', null, label));
    var i = el('input');
    i.type = type;
    i.value = value;
    i.addEventListener('input', function () { onInput(i.value); });
    l.appendChild(i);
    return l;
  }

  $('review').addEventListener('close', function () {
    if ($('review').returnValue !== 'ok' || !pending.length) return;
    var files = pending.map(function (f) {
      return {
        title: mode === 'new' ? f.title.trim() : '',
        label: f.label.trim(),
        file_name: f.file_name,
        file_type: f.file_type,
        file_size: f.file_size,
        file_date: f.date ? f.date + 'T12:00:00Z' : null,
        link: (f.link || '').trim()
      };
    });
    if (mode === 'new' && files.some(function (f) { return !f.title; })) { note('Skriv sangens navn.'); return; }
    pending = [];
    note('Tilføjer…');
    api('POST', 'import', { project: project.id, track: mode === 'existing' ? target.id : null, files: files }).then(function (r) {
      var reached = before(r.project);
      var parts = [];
      if (r.created) parts.push(r.created + (r.created === 1 ? ' ny sang' : ' nye sange'));
      if (r.added) parts.push(r.added + (r.added === 1 ? ' version' : ' versioner') + ' tilføjet');
      if (r.skipped) parts.push(r.skipped + ' fandtes allerede');
      note(parts.join(' · ') + '.' + (project.goals.some(function (g) { return g.kind !== 'manual'; }) ? ' Målene er opdateret.' : '') +
        (reached.length ? ' Mål nået: ' + reached.join(', ') + '!' : ''));
    }, fail);
  });

  // Sets the new project and returns the goals it just reached
  function before(p) {
    var was = {};
    project.goals.forEach(function (g) { was[g.id] = g.done; });
    setProject(p);
    return p.goals.filter(function (g) { return g.done && !was[g.id]; }).map(function (g) { return g.title || ProjectCards.KIND_NAMES[g.kind]; });
  }

  // ---------- helpers ----------

  function button(text, onClick, label, cls) {
    var b = el('button', 'm-mini' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  // ▶ opens the song's link (Dropbox, Google Drive …) in a new tab / the app
  function playLink(url, text) {
    var a = el('a', 'm-mini', text);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = 'Åbn ' + host(url);
    return a;
  }

  function host(url) {
    try {
      var h = new URL(url).hostname.replace(/^www\./, '');
      return /dropbox/.test(h) ? 'Dropbox' : /drive\.google|docs\.google/.test(h) ? 'Google Drive' : /icloud/.test(h) ? 'iCloud' : /wetransfer/.test(h) ? 'WeTransfer' : /soundcloud/.test(h) ? 'SoundCloud' : h;
    } catch (e) { return 'link'; }
  }

  function size(bytes) {
    return bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + ' GB' : bytes >= 1e6 ? (bytes / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1e3)) + ' KB';
  }

  function note(text) { $('tracker-note').textContent = text; }
  function fail(e) { note(e.message); $('p-note').textContent = ''; }

  Admin.start(function () { projectId ? loadProject() : loadList(); });
})();
