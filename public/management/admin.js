// Shared by every /management page: talking to /api/admin, the login (Cloudflare Access sits in
// front of /management and /api/admin, and the server checks it on every request) and small helpers.
(function () {
  var $ = function (id) { return document.getElementById(id); };

  function api(method, path, data, raw) {
    // Access answers a logged-out request with a redirect to its login page; don't follow it
    var opts = { method: method, headers: {}, redirect: 'manual' };
    if (raw) {
      opts.body = raw;
      opts.headers['content-type'] = raw.type || 'application/octet-stream';
    } else if (data !== undefined) {
      opts.body = JSON.stringify(data);
      opts.headers['content-type'] = 'application/json';
    }
    return fetch('/api/admin/' + path, opts).then(function (res) {
      if (res.type === 'opaqueredirect' || res.status === 0) {
        var r = new Error('login');
        r.status = 401;
        throw r;
      }
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

  // Checks the login, then calls ready(). Explains what to do when the login isn't set up.
  function start(ready) {
    show('login');
    api('GET', 'me').then(function (me) {
      show('panel');
      ready(me);
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
        // Log in for /api/admin as a normal page visit, then come back (at most once a minute, so it can't loop)
        var back = location.pathname + location.search;
        var last = 0;
        try { last = Number(sessionStorage.getItem('luciano:admin-login')) || 0; } catch (x) {}
        if (Date.now() - last > 60000) {
          try { sessionStorage.setItem('luciano:admin-login', String(Date.now())); } catch (x) {}
          note.textContent = 'Logger ind…';
          location.href = '/api/admin/login?return=' + encodeURIComponent(back);
          return;
        }
        note.innerHTML = 'Login virker ikke endnu. Tjek at Cloudflare Access-reglen dækker både /management og /api/admin ' +
          'med din email, og <a style="text-decoration:underline">prøv igen</a>.';
        note.querySelector('a').href = '/api/admin/login?return=' + encodeURIComponent(back);
      } else {
        note.textContent = e.message;
      }
    });
  }

  function download(name, rows) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    a.download = name;
    a.click();
  }

  // Crops to a centred square and shrinks to size×size, so images load fast on phones.
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

  // "14. okt. 2026"
  function date(iso, withTime) {
    if (!iso) return '';
    var o = { day: 'numeric', month: 'short', year: 'numeric' };
    if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return new Date(iso).toLocaleString('da-DK', o);
  }

  // A small element: el('p', 'class', 'text')
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  window.Admin = { api: api, start: start, download: download, squareJpeg: squareJpeg, date: date, el: el };
})();
