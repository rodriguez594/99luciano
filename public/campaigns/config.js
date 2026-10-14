// Which giveaway this page shows. Everything else (prize, end date, songs, covers and
// snippets) is edited at /management and stored in Cloudflare D1.
var CAMPAIGN = {
  id: 'next-single-2026',
  instagram: '99luciano0'
};

// Talks to the site's own server code (functions/api). Errors carry .noApi when the page
// is served without it (a plain file host), which switches the page to preview mode.
function apiFetch(path, data) {
  var opts = data === undefined ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data)
  };
  return fetch(path, opts).then(function (res) {
    var isJson = (res.headers.get('content-type') || '').indexOf('application/json') === 0;
    if (!isJson) {
      var e = new Error('Serveren svarer ikke.');
      e.noApi = true;
      throw e;
    }
    return res.json().then(function (out) {
      if (!res.ok) throw new Error(out.error || 'Noget gik galt. Prøv igen.');
      return out;
    });
  }, function () {
    throw new Error('offline');
  });
}

var API = {
  status: function () {
    return apiFetch('/api/status?campaign=' + encodeURIComponent(CAMPAIGN.id));
  },
  vote: function (handle, song, device) {
    return apiFetch('/api/vote', { campaign: CAMPAIGN.id, handle: handle, song: song, device: device })
      .then(function (r) { return r.result; });
  },
  notify: function (contact) {
    return apiFetch('/api/notify', { campaign: CAMPAIGN.id, contact: contact })
      .then(function (r) { return r.result; });
  }
};
