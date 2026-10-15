// Which giveaway this page shows. Everything else (prize, end date, songs, covers and
// snippets) is edited at /management and stored in Cloudflare D1.
var CAMPAIGN = {
  id: 'next-single-2026',
  instagram: '99luciano0'
};

// Shown as app icons on the front page when no giveaway is running (and in the footer).
// Leave url empty to hide one; add the Spotify artist link when it exists.
var SOCIALS = [
  { name: 'Instagram', url: 'https://instagram.com/99luciano0' },
  { name: 'TikTok', url: 'https://www.tiktok.com/@99luciano0' },
  { name: 'Spotify', url: '' }
];

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
  // How many rounds this username has voted in (for the gift card draw)
  rounds: function (handle) {
    return apiFetch('/api/rounds?handle=' + encodeURIComponent(handle || ''));
  },
  // The voter shared the vote on their Instagram story (double chance once it's confirmed at /management)
  story: function (handle) {
    return apiFetch('/api/story', { campaign: CAMPAIGN.id, handle: handle })
      .then(function (r) { return r.result; });
  },
  // purpose: 'open' (tell me when the giveaway opens) or 'winner' (tell me when the winner is drawn)
  // extra: { handle, device } so /management can show who it is
  notify: function (contact, purpose, extra) {
    extra = extra || {};
    return apiFetch('/api/notify', { campaign: CAMPAIGN.id, contact: contact, purpose: purpose || 'open', handle: extra.handle, device: extra.device })
      .then(function (r) { return r.result; });
  }
};
