(function () {
  var $ = function (id) { return document.getElementById(id); };
  var key = '';
  try { key = sessionStorage.getItem('luciano:admin') || ''; } catch (e) {}

  function call(name, args, withCampaign) {
    var body = { p_key: key };
    if (withCampaign !== false) body.p_campaign = CAMPAIGN.id;
    Object.keys(args || {}).forEach(function (k) { body[k] = args[k]; });
    return rpc(name, body).catch(function (e) {
      throw new Error(e.message === 'unauthorized' ? 'Forkert adgangskode.' : e.message === 'offline' ? 'Ingen forbindelse.' : e.message);
    });
  }

  function title(id) {
    for (var i = 0; i < CAMPAIGN.songs.length; i++) if (CAMPAIGN.songs[i].id === id) return CAMPAIGN.songs[i].title;
    return id;
  }

  function download(name, rows) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = name;
    a.click();
  }

  function renderStatus(s) {
    $('followers').textContent = s.followers;
    $('goal').textContent = s.goal;
    $('lock-state').textContent = s.closed ? 'Giveawayen er lukket.' : s.unlocked ? 'Giveawayen er åben.' : 'Låst indtil ' + s.goal + ' følgere.';
  }

  function renderResults(rows) {
    var total = 0, verified = 0, max = 1;
    rows.forEach(function (r) { total += r.votes; verified += r.verified; max = Math.max(max, r.votes); });
    $('totals').textContent = total + ' stemmer · ' + verified + ' følger';
    $('results').innerHTML = '';
    rows.slice().sort(function (a, b) { return b.votes - a.votes; }).forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'result';
      div.innerHTML = '<h3></h3><span>' + r.votes + ' stemmer<br>' + r.verified + ' følger</span><i></i>';
      div.querySelector('h3').textContent = title(r.song);
      div.querySelector('i').style.transform = 'scaleX(' + r.votes / max + ')';
      $('results').appendChild(div);
    });
  }

  var signups = [];
  function renderSignups(rows) {
    signups = rows;
    $('signup-count').textContent = rows.length + ' vil have besked';
    $('signups').innerHTML = '';
    rows.forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'signup';
      div.innerHTML = '<span></span><span></span>';
      div.firstChild.textContent = r.kind === 'sms' ? '+' + r.contact : r.contact;
      div.lastChild.textContent = r.notified_at ? 'Sendt' : r.kind === 'sms' ? 'SMS' : 'Email';
      $('signups').appendChild(div);
    });
  }

  function load() {
    return Promise.all([
      call('luciano_results').then(renderResults),
      call('luciano_signups').then(renderSignups),
      giveawayStatus().then(renderStatus, function () {})
    ]);
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

  $('set-followers').addEventListener('click', function () {
    var n = parseInt($('manual').value, 10);
    if (!(n >= 0)) return;
    call('luciano_admin_followers', { p_followers: n }, false).then(load, function (e) { $('lock-state').textContent = e.message; });
  });
  $('open-now').addEventListener('click', function () {
    if (!confirm('Åbn giveawayen nu, uanset antal følgere?')) return;
    call('luciano_admin_unlock').then(load, function (e) { $('lock-state').textContent = e.message; });
  });

  $('export').addEventListener('click', function () {
    call('luciano_entries').then(function (rows) {
      download(CAMPAIGN.id + '-stemmer.csv', ['brugernavn,nummer,foelger,tidspunkt'].concat(rows.map(function (r) {
        return [r.handle, title(r.song), r.verified ? 'ja' : 'nej', r.created_at].join(',');
      })));
    });
  });

  $('export-signups').addEventListener('click', function () {
    download(CAMPAIGN.id + '-besked.csv', ['type,kontakt,tilmeldt,sendt'].concat(signups.map(function (r) {
      return [r.kind, r.kind === 'sms' ? '+' + r.contact : r.contact, r.created_at, r.notified_at || ''].join(',');
    })));
  });

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
    call('luciano_verify', { p_followers: list }).then(function (n) {
      $('verify-note').textContent = 'Tjekket mod ' + list.length + ' følgere. ' + n + ' stemmer følger.';
      return load();
    }, function (e) { $('verify-note').textContent = e.message; });
  });

  $('draw').addEventListener('click', function () {
    call('luciano_draw').then(function (rows) {
      if (!rows.length) {
        $('winner').textContent = '';
        $('winner-note').textContent = 'Ingen stemmer fra følgere endnu. Tjek følgere først.';
        return;
      }
      var w = rows[0];
      $('winner').textContent = '@' + w.handle;
      $('winner-note').textContent = 'Ud af ' + w.pool + ' stemmer · stemte på ' + title(w.song) + ' · ' + new Date(w.created_at).toLocaleString('da-DK');
    }, function (e) { $('winner-note').textContent = e.message; });
  });

  if (key) unlock();
})();
