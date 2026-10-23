// /management/dashboard: the vote and the projects at a glance.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var el = Admin.el;

  function load() {
    Admin.api('GET', 'dashboard?campaign=' + encodeURIComponent(CAMPAIGN.id)).then(render, function (e) {
      $('dash-note').textContent = e.message;
    });
  }

  function render(d) {
    var v = d.vote;
    var ended = v.ends_at && Date.parse(v.ends_at) < Date.now();
    var ready = v.songs.filter(function (s) { return s.ready; }).length;
    var state = $('vote-state');
    state.textContent = !v.published ? 'Kladde' : !v.open || ended ? 'Slut' : 'Live';
    state.classList.toggle('is-live', v.published && !v.closed);
    $('vote-votes').textContent = v.votes;
    $('vote-songs').textContent = ready;
    $('vote-signups').textContent = v.signups;
    $('vote-ends').textContent = v.ends_at
      ? (ended ? 'Sluttede ' : 'Slutter ') + Admin.date(v.ends_at, true)
      : 'Ingen slutdato sat.';

    var box = $('vote-results');
    box.innerHTML = '';
    var max = 1;
    v.songs.forEach(function (s) { max = Math.max(max, s.votes); });
    v.songs.slice().sort(function (a, b) { return b.votes - a.votes; }).slice(0, 5).forEach(function (s) {
      var row = el('div', 'm-mini-result');
      row.appendChild(el('span', null, s.title || 'Uden titel'));
      row.appendChild(el('b', null, String(s.votes)));
      var bar = el('i');
      bar.style.transform = 'scaleX(' + s.votes / max + ')';
      row.appendChild(bar);
      box.appendChild(row);
    });

    var nr = d.next_release;
    $('rel-counts').textContent = d.releases.upcoming + ' kommende · ' + d.releases.released + ' udgivet';
    var rc = $('rel-cover');
    rc.classList.toggle('is-blank', !(nr && nr.cover_url));
    rc.style.backgroundImage = nr && nr.cover_url ? 'url("' + nr.cover_url + '")' : '';
    $('rel-title').textContent = nr ? nr.title : 'Ingen kommende udgivelse';
    $('rel-when').textContent = nr ? ({ single: 'Single', ep: 'EP', album: 'Album' }[nr.kind]) + ' · ' + Admin.date(nr.release_at, true) : 'Tilføj en under Udgivelser.';
    clearInterval(window.__relTimer);
    if (nr) {
      var tickRel = function () {
        var s = Math.max(0, Math.floor((Date.parse(nr.release_at) - Date.now()) / 1000));
        var p2 = function (n) { return ('0' + n).slice(-2); };
        $('rel-cd').textContent = 'Om ' + (s >= 86400 ? Math.floor(s / 86400) + 'd ' : '') + p2(Math.floor(s / 3600) % 24) + ':' + p2(Math.floor(s / 60) % 60) + ':' + p2(s % 60);
      };
      tickRel();
      window.__relTimer = setInterval(tickRel, 1000);
    } else $('rel-cd').textContent = '';

    $('nf-total').textContent = v.signups + (v.signups === 1 ? ' tilmeldt' : ' tilmeldte');
    var nf = $('nf-latest');
    nf.innerHTML = '';
    if (!d.notify_latest.length) nf.appendChild(el('p', 'step__note', 'Ingen har bedt om besked endnu.'));
    d.notify_latest.forEach(function (r) {
      var row = el('div', 'signup');
      row.appendChild(el('span', null, (r.handle ? '@' + r.handle + ' · ' : '') + (r.kind === 'sms' ? '+' + r.contact : r.contact)));
      row.appendChild(el('span', null, Admin.date(r.created_at, true)));
      nf.appendChild(row);
    });

    var active = d.projects.filter(function (p) { return p.status !== 'done'; });
    var songs = 0, versions = 0;
    d.projects.forEach(function (p) { songs += p.counts.songs; versions += p.counts.versions; });
    $('tot-projects').textContent = active.length;
    $('tot-songs').textContent = songs;
    $('tot-versions').textContent = versions;

    var list = $('proj-list');
    list.innerHTML = '';
    if (!active.length) {
      var empty = el('a', 'm-empty', 'Intet aktivt projekt. Opret et under Projekter →');
      empty.href = '../projects/';
      list.appendChild(empty);
    }
    active.forEach(function (p) {
      list.appendChild(ProjectCards.card(p, '../projects/?id=' + encodeURIComponent(p.id)));
    });

    var recent = $('recent');
    recent.innerHTML = '';
    if (!d.recent.length) recent.appendChild(el('p', 'step__note', 'Ingen versioner endnu.'));
    d.recent.forEach(function (r) {
      var a = el('a', 'm-recent');
      a.href = '../projects/?id=' + encodeURIComponent(r.project_id) + '#song-' + r.track;
      var who = el('span', 'm-recent__who');
      who.appendChild(el('b', null, r.song + ' · ' + r.label));
      who.appendChild(el('small', null, r.project + ' · ' + r.file_name));
      a.appendChild(who);
      a.appendChild(el('span', 'm-recent__when', Admin.date(r.file_date)));
      recent.appendChild(a);
    });
  }

  Admin.start(load);
})();
