(function () {
  var $ = function (id) { return document.getElementById(id); };
  var key = '';
  try { key = sessionStorage.getItem('luciano:admin') || ''; } catch (e) {}

  function call(name, args) {
    var body = { p_key: key, p_campaign: CAMPAIGN.id };
    Object.keys(args || {}).forEach(function (k) { body[k] = args[k]; });
    return rpc(name, body).catch(function (e) {
      throw new Error(e.message === 'unauthorized' ? 'Wrong password.' : e.message === 'offline' ? 'No connection.' : e.message);
    });
  }

  function title(id) {
    for (var i = 0; i < CAMPAIGN.songs.length; i++) if (CAMPAIGN.songs[i].id === id) return CAMPAIGN.songs[i].title;
    return id;
  }

  function render(rows) {
    var total = 0, verified = 0, max = 1;
    rows.forEach(function (r) { total += r.votes; verified += r.verified; max = Math.max(max, r.votes); });
    $('totals').textContent = total + ' entries · ' + verified + ' following';
    $('results').innerHTML = '';
    rows.slice().sort(function (a, b) { return b.votes - a.votes; }).forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'result';
      div.innerHTML = '<h3></h3><span>' + r.votes + ' votes<br>' + r.verified + ' following</span><i></i>';
      div.querySelector('h3').textContent = title(r.song);
      div.querySelector('i').style.transform = 'scaleX(' + r.votes / max + ')';
      $('results').appendChild(div);
    });
  }

  function load() {
    return call('luciano_results').then(render);
  }

  function unlock() {
    load().then(function () {
      try { sessionStorage.setItem('luciano:admin', key); } catch (e) {}
      $('login').hidden = true;
      $('panel').hidden = false;
    }, function (e) {
      $('login-note').textContent = e.message;
    });
  }

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

  $('unlock').addEventListener('click', function () { key = $('key').value.trim(); unlock(); });
  $('key').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('unlock').click(); });
  $('refresh').addEventListener('click', load);

  $('export').addEventListener('click', function () {
    call('luciano_entries').then(function (rows) {
      var csv = ['handle,song,following,created_at'].concat(rows.map(function (r) {
        return [r.handle, r.song, r.verified ? 'yes' : 'no', r.created_at].join(',');
      })).join('\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = CAMPAIGN.id + '.csv';
      a.click();
    });
  });

  $('file').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    file.text().then(function (text) {
      var list = extract(text);
      $('followers').value = list.join('\n');
      $('verify-note').textContent = list.length + ' usernames loaded from ' + file.name + '.';
    });
  });

  $('verify').addEventListener('click', function () {
    var list = extract($('followers').value);
    if (!list.length) { $('verify-note').textContent = 'The list is empty.'; return; }
    call('luciano_verify', { p_followers: list }).then(function (n) {
      $('verify-note').textContent = 'Checked against ' + list.length + ' followers. ' + n + ' entries follow.';
      return load();
    }, function (e) { $('verify-note').textContent = e.message; });
  });

  $('draw').addEventListener('click', function () {
    call('luciano_draw').then(function (rows) {
      if (!rows.length) {
        $('winner').textContent = '';
        $('winner-note').textContent = 'No entries that follow yet. Check followers first.';
        return;
      }
      var w = rows[0];
      $('winner').textContent = '@' + w.handle;
      $('winner-note').textContent = 'Out of ' + w.pool + ' entries · voted for ' + title(w.song) + ' · ' + new Date(w.created_at).toLocaleString('da-DK');
    }, function (e) { $('winner-note').textContent = e.message; });
  });

  if (key) unlock();
})();
