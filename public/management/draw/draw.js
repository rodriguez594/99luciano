// /management/draw: the live draw. A glass bowl with one folded note per entry (two with a confirmed
// story). Drag a note out onto the table (or tap one), open it, then: winner, remove (not in the live),
// or put it back. Which person a note is gets decided at random the moment it's picked.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var api = Admin.api, el = Admin.el;
  var C = encodeURIComponent(CAMPAIGN.id);
  var onlyFollowers = true;
  var pool = [];        // entries still in the bowl: {key, handles, notes, others}
  var current = null;   // {entry, handle, slip}
  var MAX_NOTES = 180;  // notes drawn in the bowl (the draw itself always uses everyone)
  var demo = /[?&]demo\b/.test(location.search);
  var demoOut = {};     // demo: handle → 1 removed | 2 winner (nothing goes to the server)
  var cinema = pref('cinema', true), sound = pref('sound', true);

  function pref(k, def) {
    try { var v = localStorage.getItem('luciano:draw-' + k); return v === null ? def : v === '1'; } catch (e) { return def; }
  }
  function setPref(k, v) { try { localStorage.setItem('luciano:draw-' + k, v ? '1' : '0'); } catch (e) {} }

  // Made-up people for demo mode: some with a story (2 notes), some reposts without a vote
  var DEMO = ['mathilde.k', 'oliver_dk', 'freja99', 'noahhh', 'ida.sofie', 'lucas_cph', 'emma.lund', 'william.b', 'clara.mm',
    'victor_07', 'alma.r', 'karl.jensen', 'sofie_aa', 'oscar.dk', 'ella.n', 'magnus.v', 'agnes__', 'elias.h', 'laura.pp',
    'malthe_', 'josefine.x', 'august.k', 'nora.l', 'arthur99'];
  function demoData() {
    var pool = [], removed = [], winners = [];
    DEMO.forEach(function (h, i) {
      var e = { key: 'demo:' + h, handles: [h], notes: i % 4 === 1 ? 2 : 1, repost_only: i % 9 === 5, others: [] };
      if (e.repost_only) e.notes = 1;
      if (demoOut[h] === 1) removed.push(e); else if (demoOut[h] === 2) winners.push(e); else pool.push(e);
    });
    return { pool: pool, removed: removed, winners: winners, votes: DEMO.length, followers: DEMO.length };
  }
  function getPool() {
    if (demo) return Promise.resolve(demoData());
    return api('GET', 'draw-pool?campaign=' + C + '&followers=' + (onlyFollowers ? 1 : 0));
  }
  function setState(handle, state) {
    if (demo) {
      if (state) demoOut[handle] = state; else delete demoOut[handle];
      return Promise.resolve();
    }
    return api('POST', 'draw-mark', { campaign: CAMPAIGN.id, handle: handle, state: state });
  }

  function rand(n) {
    var a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  }

  // ---------- loading ----------

  function load() {
    document.body.classList.toggle('is-demo', demo);
    getPool().then(function (d) {
      pool = d.pool;
      renderBowl();
      renderLists(d);
      var notes = pool.reduce(function (a, e) { return a + e.notes; }, 0);
      $('d-count').textContent = notes + (notes === 1 ? ' seddel' : ' sedler') + ' · ' + pool.length + (pool.length === 1 ? ' deltager' : ' deltagere');
      $('d-note').textContent = demo ? 'Prøv løs: træk sedler, åbn, fjern og vælg vindere. Slå Demo fra for den rigtige skål.' : !pool.length
        ? (onlyFollowers && d.votes && !d.followers
          ? 'Ingen er markeret som følger endnu. Tjek følgere under Afstemning, eller slå "Kun følgere" fra.'
          : 'Skålen er tom.')
        : (onlyFollowers ? 'Kun dem, du har markeret som følgere, er i skålen.' : 'Alle, der har stemt, er i skålen.') +
          ' Stemt + godkendt story = 2 sedler. Godkendt repost uden stemme = 1 seddel.';
    }, function (e) { $('d-note').textContent = e.message; });
  }

  // ---------- the bowl ----------

  // A random spot in the pile at the bottom of the bowl (in % of the bowl box)
  function spot() {
    for (var i = 0; i < 40; i++) {
      var x = Math.random() * 2 - 1, y = Math.random() * 2 - 1;
      if (x * x + y * y > 1) continue;
      y = 1 - Math.pow(1 - (y + 1) / 2, 1.6) * 2; // more notes near the bottom
      return { x: 50 + x * 31, y: 70 + y * 17 };
    }
    return { x: 50, y: 75 };
  }

  function placeNote(n, p) {
    p = p || spot();
    n.style.left = p.x + '%';
    n.style.top = p.y + '%';
    n.style.transform = 'rotate(' + (Math.random() * 70 - 35) + 'deg)';
    n.style.zIndex = Math.round(p.y * 10);
  }

  function makeNote() {
    var n = el('div', 'd-note');
    n.setAttribute('role', 'button');
    n.setAttribute('aria-label', 'Seddel');
    n.addEventListener('pointerdown', grab);
    return n;
  }

  function renderBowl() {
    var box = $('notes');
    box.innerHTML = '';
    var total = Math.min(MAX_NOTES, pool.reduce(function (a, e) { return a + e.notes; }, 0));
    for (var i = 0; i < total; i++) {
      var n = makeNote();
      placeNote(n);
      box.appendChild(n);
    }
  }

  // Take away some notes (a removed person's notes), with a little fade
  function dropNotes(count) {
    var all = Array.prototype.slice.call($('notes').children).filter(function (n) { return !n.classList.contains('is-gone'); });
    var left = pool.reduce(function (a, e) { return a + e.notes; }, 0);
    // Keep showing the cap when there are more notes than we draw
    var keep = Math.min(MAX_NOTES, left);
    var remove = Math.max(0, Math.min(count, all.length - keep));
    for (var i = 0; i < remove; i++) {
      var n = all.splice(rand(all.length), 1)[0];
      n.classList.add('is-gone');
      setTimeout(n.remove.bind(n), 450);
    }
  }

  $('d-shake').addEventListener('click', function () {
    var bowl = $('bowl');
    bowl.classList.remove('is-shaking');
    void bowl.offsetWidth;
    bowl.classList.add('is-shaking');
    Array.prototype.forEach.call($('notes').children, function (n, i) {
      setTimeout(function () { placeNote(n); }, 80 + (i % 12) * 25);
    });
  });

  // ---------- dragging a note ----------

  var drag = null;

  function stageXY(e) {
    var r = $('stage').getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function overTable(e) {
    var r = $('table').getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function grab(e) {
    if (current || !pool.length || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    var n = e.currentTarget;
    var nr = n.getBoundingClientRect(), sr = $('stage').getBoundingClientRect();
    // Move it to the float layer at the same place on screen
    $('float').appendChild(n);
    n.style.zIndex = 10;
    n.style.left = (nr.left + nr.width / 2 - sr.left) + 'px';
    n.style.top = (nr.top + nr.height / 2 - sr.top) + 'px';
    n.classList.add('is-held');
    n.style.transform = 'scale(1.25) rotate(' + (Math.random() * 10 - 5) + 'deg)';
    drag = { n: n, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try { n.setPointerCapture(e.pointerId); } catch (x) {}
    n.addEventListener('pointermove', move);
    n.addEventListener('pointerup', release);
    n.addEventListener('pointercancel', release);
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) drag.moved = true;
    var p = stageXY(e);
    drag.n.style.left = p.x + 'px';
    drag.n.style.top = p.y + 'px';
    $('table').classList.toggle('is-over', overTable(e));
  }

  function release(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var n = drag.n, moved = drag.moved;
    drag = null;
    n.removeEventListener('pointermove', move);
    n.removeEventListener('pointerup', release);
    n.removeEventListener('pointercancel', release);
    $('table').classList.remove('is-over');
    n.classList.remove('is-held');
    if (!moved || (e.type === 'pointerup' && overTable(e))) land(n);
    else backToBowl(n);
  }

  // Fly a note from the float layer back into the bowl
  function backToBowl(n) {
    var br = $('bowl').getBoundingClientRect(), sr = $('stage').getBoundingClientRect();
    var p = spot();
    n.classList.add('is-flying');
    n.style.left = (br.left - sr.left + br.width * p.x / 100) + 'px';
    n.style.top = (br.top - sr.top + br.height * p.y / 100) + 'px';
    n.style.transform = 'scale(' + (br.width * 0.13 / 64) + ') rotate(' + (Math.random() * 70 - 35) + 'deg)';
    setTimeout(function () {
      n.classList.remove('is-flying');
      n.style.zIndex = '';
      $('notes').appendChild(n);
      placeNote(n, p);
    }, 560);
  }

  // ---------- the table ----------

  function land(n) {
    // Who is it? Decided now, at random, weighted by number of notes
    var tickets = [];
    pool.forEach(function (e, i) { for (var k = 0; k < e.notes; k++) tickets.push(i); });
    var entry = pool[tickets[rand(tickets.length)]];
    var handle = entry.handles[rand(entry.handles.length)];

    var spotR = $('spot').getBoundingClientRect(), sr = $('stage').getBoundingClientRect();
    n.classList.add('is-flying');
    n.style.left = (spotR.left + spotR.width / 2 - sr.left) + 'px';
    n.style.top = (spotR.top + spotR.height * 0.75 - sr.top) + 'px';
    n.style.transform = 'scale(1.4) rotate(0deg)';
    $('stage').classList.add('is-busy');
    setTimeout(function () {
      n.remove();
      var slip = makeSlip(entry, handle);
      $('spot').appendChild(slip);
      $('table').classList.add('has-slip');
      requestAnimationFrame(function () { requestAnimationFrame(function () { slip.classList.remove('is-landing'); }); });
      current = { entry: entry, handle: handle, slip: slip };
      showActions('folded');
      // On a phone the table may be below the screen: bring it into view
      var tr = $('table').getBoundingClientRect();
      if (tr.bottom > window.innerHeight || tr.top < 0) $('table').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 520);
  }

  function makeSlip(entry, handle) {
    var s = el('div', 'd-slip is-landing');
    var name = '@' + handle;
    var others = entry.handles.filter(function (h) { return h !== handle; }).concat(entry.others || []);
    s.innerHTML =
      '<div class="d-slip__half d-slip__bottom"><p class="d-slip__name"></p><p class="d-slip__same"></p></div>' +
      '<div class="d-slip__half d-slip__top">' +
      '  <div class="d-slip__face d-slip__face--in"><p class="d-slip__name"></p></div>' +
      '  <div class="d-slip__face d-slip__face--out"><img src="../../assets/mark-160.png" alt=""></div>' +
      '</div><span class="d-slip__stamp">Vinder</span>';
    Array.prototype.forEach.call(s.querySelectorAll('.d-slip__name'), function (p) { p.textContent = name; });
    s.querySelector('.d-slip__same').textContent = others.length ? 'Samme person som @' + others.join(', @')
      : entry.notes > 1 ? '2 sedler · stemte og delte på story' : entry.repost_only ? 'Delte på story · har ikke stemt' : '';
    return s;
  }

  function showActions(stage) {
    $('actions').hidden = !stage;
    $('a-reveal').hidden = stage !== 'folded';
    $('a-back').hidden = stage !== 'folded' && stage !== 'open';
    $('a-win').hidden = stage !== 'open';
    $('a-remove').hidden = stage !== 'open';
    $('a-clear').hidden = stage !== 'winner';
  }

  function clearTable() {
    current = null;
    $('table').classList.remove('has-slip');
    $('stage').classList.remove('is-busy');
    showActions(null);
  }

  $('a-reveal').addEventListener('click', function () {
    if (!current) return;
    if (!cinema || !window.DrawCinema) {
      current.slip.classList.add('is-open');
      showActions('open');
      return;
    }
    var c = current;
    showActions(null);
    DrawCinema.play(c.slip, { sound: sound }).then(function () {
      if (current === c) showActions('open');
    });
  });

  // Put back: the slip folds up and flies into the bowl
  $('a-back').addEventListener('click', function () {
    if (!current) return;
    var slip = current.slip;
    slip.classList.remove('is-open');
    setTimeout(function () {
      var r = slip.getBoundingClientRect(), sr = $('stage').getBoundingClientRect();
      var n = makeNote();
      n.style.left = (r.left + r.width / 2 - sr.left) + 'px';
      n.style.top = (r.top + r.height * 0.75 - sr.top) + 'px';
      n.style.transform = 'scale(1.4)';
      $('float').appendChild(n);
      slip.remove();
      clearTable();
      requestAnimationFrame(function () { backToBowl(n); });
    }, current.slip.classList.contains('is-open') ? 650 : 0);
  });

  // Not in the live: crumple it, take their notes out of the bowl
  $('a-remove').addEventListener('click', function () {
    if (!current) return;
    var c = current;
    mark(c, 1).then(function () {
      c.slip.classList.add('is-crumple');
      setTimeout(function () { c.slip.remove(); }, 720);
      clearTable();
      takeOut(c.entry);
      note('@' + c.handle + ' er fjernet fra konkurrencen.');
    });
  });

  $('a-win').addEventListener('click', function () {
    if (!current) return;
    var c = current;
    mark(c, 2).then(function () {
      c.slip.classList.add('is-winner');
      confetti();
      takeOut(c.entry);
      showActions('winner');
      note('@' + c.handle + ' har vundet!');
    });
  });

  $('a-clear').addEventListener('click', function () {
    if (!current) return;
    var slip = current.slip;
    slip.classList.add('is-away');
    setTimeout(function () { slip.remove(); }, 620);
    clearTable();
  });

  function takeOut(entry) {
    var i = pool.indexOf(entry);
    if (i >= 0) pool.splice(i, 1);
    // The note on the table is already out; any extra notes of theirs go too
    dropNotes(entry.notes - 1);
    var notes = pool.reduce(function (a, e) { return a + e.notes; }, 0);
    $('d-count').textContent = notes + (notes === 1 ? ' seddel' : ' sedler') + ' · ' + pool.length + (pool.length === 1 ? ' deltager' : ' deltagere');
  }

  function mark(c, state) {
    ['a-win', 'a-remove', 'a-back'].forEach(function (id) { $(id).disabled = true; });
    return setState(c.handle, state).then(function () {
      refreshLists();
    }, function (e) { note(e.message); throw e; }).finally(function () {
      ['a-win', 'a-remove', 'a-back'].forEach(function (id) { $(id).disabled = false; });
    });
  }

  function note(t) { $('d-note').textContent = t; }

  // ---------- winners and removed ----------

  function refreshLists() {
    getPool().then(renderLists, function () {});
  }

  function renderLists(d) {
    $('w-count').textContent = 'Vindere · ' + d.winners.length;
    $('r-count').textContent = 'Fjernet · ' + d.removed.length;
    list($('winners'), d.winners, 'Fortryd', 'Vinder');
    list($('removed'), d.removed, 'Læg i skålen igen', 'Ikke i live');
  }

  function list(box, rows, undo, what) {
    box.innerHTML = '';
    if (!rows.length) box.appendChild(el('p', 'step__note', 'Ingen endnu.'));
    rows.forEach(function (r) {
      var row = el('div', 'm-voter m-repost is-ok');
      var a = el('a', null, '@' + r.handles.join(', @'));
      a.href = 'https://instagram.com/' + encodeURIComponent(r.handles[0]);
      a.target = '_blank';
      a.rel = 'noopener';
      row.appendChild(a);
      var b = el('button', 'm-mini', undo);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (current) { note('Ryd bordet først.'); return; }
        b.disabled = true;
        setState(r.handles[0], 0).then(load, function (e) { b.disabled = false; note(e.message); });
      });
      row.appendChild(b);
      row.appendChild(el('small', null, what));
      box.appendChild(row);
    });
  }

  // ---------- extras ----------

  function chip(id, on) {
    $(id).classList.toggle('is-on', on);
    $(id).setAttribute('aria-pressed', String(on));
  }
  chip('d-demo', demo);
  chip('d-cinema', cinema);
  chip('d-sound', sound);
  $('d-sound').hidden = !cinema;

  $('d-demo').addEventListener('click', function () {
    if (current) { note('Ryd bordet først.'); return; }
    demo = !demo;
    demoOut = {};
    chip('d-demo', demo);
    history.replaceState(null, '', location.pathname + (demo ? '?demo' : ''));
    load();
  });
  $('d-cinema').addEventListener('click', function () {
    cinema = !cinema;
    setPref('cinema', cinema);
    chip('d-cinema', cinema);
    $('d-sound').hidden = !cinema;
  });
  $('d-sound').addEventListener('click', function () {
    sound = !sound;
    setPref('sound', sound);
    chip('d-sound', sound);
  });

  $('d-followers').addEventListener('click', function () {
    if (current) { note('Ryd bordet først.'); return; }
    onlyFollowers = !onlyFollowers;
    this.classList.toggle('is-on', onlyFollowers);
    this.setAttribute('aria-pressed', String(onlyFollowers));
    load();
  });

  $('d-focus').addEventListener('click', function () {
    var on = !document.body.classList.contains('is-focus');
    document.body.classList.toggle('is-focus', on);
    this.textContent = on ? 'Luk fuld skærm' : 'Fuld skærm';
    var root = document.documentElement;
    try {
      if (on && root.requestFullscreen) root.requestFullscreen().catch(function () {});
      else if (!on && document.fullscreenElement) document.exitFullscreen();
    } catch (e) {}
  });
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && document.body.classList.contains('is-focus')) {
      document.body.classList.remove('is-focus');
      $('d-focus').textContent = 'Fuld skærm';
    }
  });

  function confetti() {
    var colors = ['#fff', '#fff', '#e8e0cf', '#bdbdbd', '#d4af37'];
    for (var i = 0; i < 90; i++) {
      var c = el('div', 'd-confetti');
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
      document.body.appendChild(c);
      var dx = (Math.random() - 0.5) * 200, dur = 1800 + Math.random() * 1600;
      c.animate([
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: 'translate(' + dx + 'px,' + (window.innerHeight + 40) + 'px) rotate(' + (Math.random() * 900 - 450) + 'deg)', opacity: 0.9 }
      ], { duration: dur, delay: Math.random() * 400, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' });
      setTimeout(c.remove.bind(c), dur + 500);
    }
  }

  Admin.start(load);
})();
