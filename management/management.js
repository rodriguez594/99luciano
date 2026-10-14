// /management: log in with an email link (Supabase Auth), then edit the giveaway,
// its songs (covers and snippets go to the "luciano" storage bucket), see votes and draw a winner.
// Only emails in the luciano_admins table get access; the database enforces that, not this page.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var BUCKET = 'luciano';
  var sb = null;
  var user = null;
  var campaign = null;   // the luciano_campaigns row
  var songs = [];        // luciano_songs rows, in order

  function show(id) {
    ['login', 'denied', 'panel'].forEach(function (x) { $(x).hidden = x !== id; });
    $('logout').hidden = id === 'login';
    $('title').textContent = id === 'login' ? 'Log ind' : id === 'denied' ? 'Ingen adgang' : 'Giveaway';
  }

  function err(e) {
    var m = (e && e.message) || String(e);
    if (/unauthorized|row-level security|permission denied/i.test(m)) return 'Du har ikke adgang til det.';
    if (/fetch|network/i.test(m)) return 'Ingen forbindelse. Prøv igen.';
    return m;
  }

  function download(name, rows) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = name;
    a.click();
  }

  // ---------- login ----------

  function init() {
    if (!SUPABASE.url || !SUPABASE.anonKey || !window.supabase) {
      show('login');
      $('login-note').textContent = 'Supabase er ikke sat op endnu (campaigns/config.js).';
      $('send').disabled = true;
      return;
    }
    sb = window.supabase.createClient(SUPABASE.url, SUPABASE.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    sb.auth.getSession().then(function (res) {
      if (/access_token=|error_description=/.test(location.hash)) {
        if (/error_description=/.test(location.hash) && !res.data.session) {
          $('login-note').textContent = 'Linket er udløbet eller allerede brugt. Send et nyt.';
        }
        history.replaceState(null, '', location.pathname + location.search);
      }
      setUser(res.data.session ? res.data.session.user : null);
    });
    sb.auth.onAuthStateChange(function (_e, session) {
      var next = session ? session.user : null;
      if ((next && next.id) !== (user && user.id)) setUser(next);
    });
  }

  function setUser(u) {
    user = u;
    if (!user) return show('login');
    sb.rpc('luciano_is_admin').then(function (res) {
      if (res.data === true) { show('panel'); loadAll(); }
      else { $('denied-email').textContent = user.email; show('denied'); }
    });
  }

  // The link in the email often opens in a new tab; this tab picks up the session it saved.
  var waiting = 0;
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('email').value.trim();
    var note = $('login-note');
    if (!/^\S+@\S+\.\S+$/.test(email)) { note.textContent = 'Skriv din email.'; return; }
    $('send').disabled = true;
    note.textContent = 'Sender…';
    sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } })
      .then(function (res) {
        $('send').disabled = false;
        if (res.error) {
          note.textContent = /rate|seconds/i.test(res.error.message) ? 'For mange emails lige nu. Vent et minut.' : res.error.message;
          return;
        }
        $('send').textContent = 'Send et nyt link';
        note.textContent = 'Sendt til ' + email + '. Åbn emailen og tryk på linket. Siden logger dig ind af sig selv.';
        clearInterval(waiting);
        var tries = 0;
        waiting = setInterval(function () {
          if (user || ++tries > 360) return clearInterval(waiting);
          sb.auth.getSession().then(function (r) { if (r.data.session && !user) setUser(r.data.session.user); });
        }, 2500);
      });
  });

  $('logout').addEventListener('click', function () {
    sb.auth.signOut().then(function () { setUser(null); });
  });

  // ---------- load ----------

  function loadAll() {
    loadCampaign().then(function () {
      loadSongs();
      loadStatus();
      loadResults();
      loadSignups();
    });
  }

  function loadCampaign() {
    return sb.from('luciano_campaigns').select('*').eq('id', CAMPAIGN.id).maybeSingle().then(function (res) {
      if (res.error) { $('settings-note').textContent = err(res.error); return; }
      if (!res.data) {
        // First time: create the giveaway with the defaults
        return sb.from('luciano_campaigns').insert({ id: CAMPAIGN.id }).select().single().then(function (r) {
          if (r.error) { $('settings-note').textContent = err(r.error); return; }
          campaign = r.data;
          fillSettings();
        });
      }
      campaign = res.data;
      fillSettings();
    });
  }

  function loadStatus() {
    giveawayStatus().then(function (s) {
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
    $('s-max-ip').value = campaign.max_per_ip;
    $('s-closed').checked = !campaign.open;
  }

  $('settings').addEventListener('submit', function (e) {
    e.preventDefault();
    var note = $('settings-note');
    var goal = parseInt($('s-goal').value, 10);
    var maxIp = parseInt($('s-max-ip').value, 10);
    if (!(goal >= 0)) { note.textContent = 'Skriv et antal følgere.'; return; }
    if (!(maxIp >= 1)) { note.textContent = 'Stemmer per netværk skal være mindst 1.'; return; }
    var patch = {
      prize: $('s-prize').value.trim(),
      artist: $('s-artist').value.trim() || '99 LUCIANO',
      ends_at: $('s-ends').value ? new Date($('s-ends').value).toISOString() : null,
      goal: goal,
      max_per_ip: maxIp,
      open: !$('s-closed').checked
    };
    note.textContent = 'Gemmer…';
    sb.from('luciano_campaigns').update(patch).eq('id', CAMPAIGN.id).select().single().then(function (res) {
      if (res.error) { note.textContent = err(res.error); return; }
      campaign = res.data;
      note.textContent = 'Gemt.';
      loadStatus();
      renderSongs();
    });
  });

  $('set-followers').addEventListener('click', function () {
    var n = parseInt($('manual').value, 10);
    if (!(n >= 0)) return;
    sb.rpc('luciano_admin_followers', { p_followers: n }).then(function (res) {
      if (res.error) $('state').textContent = err(res.error);
      else { $('manual').value = ''; loadStatus(); }
    });
  });

  $('open-now').addEventListener('click', function () {
    if (!confirm('Åbn giveawayen nu, uanset antal følgere?')) return;
    sb.rpc('luciano_admin_unlock', { p_campaign: CAMPAIGN.id }).then(function (res) {
      if (res.error) $('state').textContent = err(res.error);
      else loadStatus();
    });
  });

  // ---------- songs ----------

  function loadSongs() {
    return sb.from('luciano_songs').select('*').eq('campaign', CAMPAIGN.id)
      .order('position', { ascending: true }).order('created_at', { ascending: true })
      .then(function (res) {
        if (res.error) return;
        songs = res.data;
        renderSongs();
      });
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
      state.textContent = visible ? 'Vises på siden' : 'Skjult: mangler ' + (s.title.trim() ? 'klip' : 'titel');

      function saveField(field, value) {
        var patch = {};
        patch[field] = value;
        state.textContent = 'Gemmer…';
        update(s, patch).then(function () { state.textContent = 'Gemt'; }, function (e) { state.textContent = err(e); });
      }
      title.addEventListener('change', function () { saveField('title', title.value.trim()); });
      artist.addEventListener('change', function () { saveField('artist', artist.value.trim() || null); });

      li.querySelector('.m-cover-input').addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        state.textContent = 'Uploader cover…';
        squareJpeg(file, 1000).then(function (blob) {
          return replaceFile(s, 'cover_url', 'cover.jpg', blob, 'image/jpeg');
        }).catch(function (e) { state.textContent = err(e); });
      });

      li.querySelector('.m-snippet-input').addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) { state.textContent = 'Filen er for stor (max 15 MB).'; return; }
        var ext = (file.name.split('.').pop() || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp3';
        state.textContent = 'Uploader klip…';
        replaceFile(s, 'snippet_url', 'snippet.' + ext, file, file.type || 'audio/mpeg')
          .catch(function (e) { state.textContent = err(e); });
      });

      var up = li.querySelector('.m-up');
      var down = li.querySelector('.m-down');
      up.disabled = i === 0;
      down.disabled = i === songs.length - 1;
      up.addEventListener('click', function () { move(i, -1); });
      down.addEventListener('click', function () { move(i, 1); });

      li.querySelector('.m-del').addEventListener('click', function () {
        if (!confirm('Slet "' + (s.title || 'sang') + '"?')) return;
        sb.from('luciano_songs').delete().eq('id', s.id).then(function (res) {
          if (res.error) {
            state.textContent = res.error.code === '23503' ? 'Har stemmer, kan ikke slettes' : err(res.error);
            return;
          }
          removeFile(s.cover_url);
          removeFile(s.snippet_url);
          loadSongs();
        });
      });

      list.appendChild(li);
    });
  }

  function update(s, patch) {
    return sb.from('luciano_songs').update(patch).eq('id', s.id).select().single().then(function (res) {
      if (res.error) throw res.error;
      Object.assign(s, res.data);
      return s;
    });
  }

  // Uploads a new file under a fresh name (so phones never show a cached old cover), then removes the old one.
  function replaceFile(s, field, name, body, type) {
    var path = CAMPAIGN.id + '/' + s.id + '/' + Date.now() + '-' + name;
    return sb.storage.from(BUCKET).upload(path, body, { contentType: type, cacheControl: '31536000', upsert: false })
      .then(function (res) {
        if (res.error) throw res.error;
        var old = s[field];
        var patch = {};
        patch[field] = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
        return update(s, patch).then(function () {
          removeFile(old);
          renderSongs();
        });
      });
  }

  function removeFile(url) {
    var marker = '/object/public/' + BUCKET + '/';
    if (!url || url.indexOf(marker) < 0) return;
    sb.storage.from(BUCKET).remove([decodeURIComponent(url.split(marker)[1])]);
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
    Promise.all(order.map(function (s, n) {
      return s.position === n ? null : update(s, { position: n });
    })).catch(function () { loadSongs(); });
  }

  $('add-song').addEventListener('click', function () {
    var pos = songs.length ? Math.max.apply(null, songs.map(function (s) { return s.position; })) + 1 : 0;
    sb.from('luciano_songs').insert({ campaign: CAMPAIGN.id, title: '', position: pos }).select().single().then(function (res) {
      if (res.error) return alert(err(res.error));
      songs.push(res.data);
      renderSongs();
      var inputs = document.querySelectorAll('.m-title');
      inputs[inputs.length - 1].focus();
    });
  });

  // ---------- votes, sign-ups, winner ----------

  function loadResults() {
    sb.rpc('luciano_results', { p_campaign: CAMPAIGN.id }).then(function (res) {
      if (res.error) return;
      var rows = res.data, total = 0, verified = 0, max = 1;
      rows.forEach(function (r) { total += r.votes; verified += r.verified; max = Math.max(max, r.votes); });
      $('totals').textContent = total + ' stemmer · ' + verified + ' følger';
      $('results').innerHTML = '';
      rows.slice().sort(function (a, b) { return b.votes - a.votes; }).forEach(function (r) {
        var div = document.createElement('div');
        div.className = 'result';
        div.innerHTML = '<h3></h3><span>' + r.votes + ' stemmer<br>' + r.verified + ' følger</span><i></i>';
        div.querySelector('h3').textContent = r.title || 'Uden titel';
        div.querySelector('i').style.transform = 'scaleX(' + r.votes / max + ')';
        $('results').appendChild(div);
      });
    });
  }

  var signups = [];
  function loadSignups() {
    sb.rpc('luciano_signups', { p_campaign: CAMPAIGN.id }).then(function (res) {
      if (res.error) return;
      signups = res.data;
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
    });
  }

  $('refresh').addEventListener('click', function () { loadResults(); loadSignups(); loadStatus(); });

  $('export').addEventListener('click', function () {
    sb.rpc('luciano_entries', { p_campaign: CAMPAIGN.id }).then(function (res) {
      if (res.error) return;
      download(CAMPAIGN.id + '-stemmer.csv', ['brugernavn,nummer,foelger,tidspunkt'].concat(res.data.map(function (r) {
        return [r.handle, '"' + (r.title || '').replace(/"/g, '""') + '"', r.verified ? 'ja' : 'nej', r.created_at].join(',');
      })));
    });
  });

  $('export-signups').addEventListener('click', function () {
    download(CAMPAIGN.id + '-besked.csv', ['type,kontakt,tilmeldt,sendt'].concat(signups.map(function (r) {
      return [r.kind, r.kind === 'sms' ? '+' + r.contact : r.contact, r.created_at, r.notified_at || ''].join(',');
    })));
  });

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
    sb.rpc('luciano_verify', { p_campaign: CAMPAIGN.id, p_followers: list }).then(function (res) {
      if (res.error) { $('verify-note').textContent = err(res.error); return; }
      $('verify-note').textContent = 'Tjekket mod ' + list.length + ' følgere. ' + res.data + ' stemmer følger.';
      loadResults();
    });
  });

  $('draw').addEventListener('click', function () {
    sb.rpc('luciano_draw', { p_campaign: CAMPAIGN.id }).then(function (res) {
      if (res.error) { $('winner-note').textContent = err(res.error); return; }
      if (!res.data.length) {
        $('winner').textContent = '';
        $('winner-note').textContent = 'Ingen stemmer fra følgere endnu. Tjek følgere først.';
        return;
      }
      var w = res.data[0];
      $('winner').textContent = '@' + w.handle;
      $('winner-note').textContent = 'Ud af ' + w.pool + ' stemmer · stemte på ' + w.title + ' · ' + new Date(w.created_at).toLocaleString('da-DK');
    });
  });

  init();
})();
