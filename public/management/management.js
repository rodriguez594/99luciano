// /management: edit the giveaway and its songs (covers and snippets are uploaded to the site),
// see votes, review flagged votes and draw a winner. The login is Cloudflare Access, which
// sits in front of this page and /api/admin; the server checks it on every request.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var campaign = null;   // giveaway settings
  var songs = [];        // in order
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
      } else {
        audioBox.textContent = 'Intet klip endnu';
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
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) { state.textContent = 'Filen er for stor (max 15 MB).'; return; }
        state.textContent = 'Uploader klip…';
        var blob = file.type ? file : new Blob([file], { type: 'audio/mpeg' });
        upload(s, 'snippet', blob).catch(function (e) { state.textContent = e.message; });
      });

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

  function upload(s, kind, blob) {
    return admin('POST', 'upload?song=' + encodeURIComponent(s.id) + '&kind=' + kind, undefined, blob).then(function (updated) {
      replaceSong(updated);
      renderSongs();
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
