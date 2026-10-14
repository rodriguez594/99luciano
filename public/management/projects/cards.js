// A project as a card (cover mosaic, counts and goal bars), used on the dashboard and the projects list.
(function () {
  var el = Admin.el;

  function goalBar(g) {
    var row = el('div', 'm-goal' + (g.done ? ' is-done' : ''));
    var head = el('div', 'm-goal__head');
    head.appendChild(el('span', 'm-goal__title', g.title || KIND_NAMES[g.kind]));
    head.appendChild(el('span', 'm-goal__num', g.value + ' / ' + g.target + (g.done ? ' ✓' : '')));
    row.appendChild(head);
    var bar = el('div', 'm-bar');
    var fill = el('i');
    fill.style.width = g.pct + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    return row;
  }

  var KIND_NAMES = { songs: 'Sange', versions: 'Versioner', art: 'Sange med cover', manual: 'Manuelt' };

  function projectCard(p, href) {
    var a = el('a', 'm-pcard' + (p.status === 'done' ? ' is-done' : ''));
    a.href = href;
    var art = el('div', 'm-pcard__art' + (p.covers.length ? '' : ' is-blank'));
    p.covers.slice(0, 4).forEach(function (u) {
      var i = el('span');
      i.style.backgroundImage = 'url("' + u + '")';
      art.appendChild(i);
    });
    art.dataset.n = Math.min(4, p.covers.length);
    a.appendChild(art);
    var body = el('div', 'm-pcard__body');
    body.appendChild(el('h3', null, p.title || 'Uden titel'));
    body.appendChild(el('p', 'm-pcard__meta', [
      p.counts.songs + (p.counts.songs === 1 ? ' sang' : ' sange'),
      p.counts.versions + (p.counts.versions === 1 ? ' version' : ' versioner'),
      p.status === 'done' ? 'færdig' : p.due ? 'deadline ' + Admin.date(p.due) : ''
    ].filter(Boolean).join(' · ')));
    p.goals.slice(0, 3).forEach(function (g) { body.appendChild(goalBar(g)); });
    if (p.goals.length > 3) body.appendChild(el('p', 'm-pcard__meta', '+ ' + (p.goals.length - 3) + ' mål mere'));
    a.appendChild(body);
    return a;
  }

  window.ProjectCards = { card: projectCard, goalBar: goalBar, KIND_NAMES: KIND_NAMES };
})();
