// Giveaway settings. The id, song ids, end date and goal must match the row in
// supabase/schema.sql (luciano_campaigns), which is what the server checks.
var CAMPAIGN = {
  id: 'next-single-2026',
  instagram: '99luciano0',
  prize: 'Gavekort på 150 kr. til hvad du vil',
  goal: 150,                 // followers needed before voting opens
  endsAt: '2026-11-15T23:59:00+01:00',
  snippetSeconds: 30,
  songs: [
    { id: 'song-1', title: 'Sang et', file: 'snippets/song-1.mp3' },
    { id: 'song-2', title: 'Sang to', file: 'snippets/song-2.mp3' },
    { id: 'song-3', title: 'Sang tre', file: 'snippets/song-3.mp3' }
  ]
};

// Supabase: Project Settings → API (the same project as 99MS works fine; the giveaway
// tables are all prefixed luciano_). The anon key is meant to be public.
var SUPABASE = {
  url: '',
  anonKey: ''
};

function supabaseFetch(path, options) {
  if (!SUPABASE.url || !SUPABASE.anonKey) return Promise.reject(new Error('Supabase er ikke sat op endnu (campaigns/config.js).'));
  options = options || {};
  options.headers = {
    'content-type': 'application/json',
    apikey: SUPABASE.anonKey,
    authorization: 'Bearer ' + SUPABASE.anonKey
  };
  return fetch(SUPABASE.url + path, options).then(function (res) {
    return res.json().catch(function () { return null; }).then(function (data) {
      if (!res.ok) throw new Error((data && (data.message || data.error)) || 'Request failed');
      return data;
    });
  }, function () {
    throw new Error('offline');
  });
}

// Calls a Postgres function from supabase/schema.sql.
function rpc(name, args) {
  return supabaseFetch('/rest/v1/rpc/' + name, { method: 'POST', body: JSON.stringify(args) });
}

// Follower count and lock. The edge function refreshes the count from Instagram;
// if it isn't deployed, this falls back to the last stored count.
function giveawayStatus() {
  return supabaseFetch('/functions/v1/luciano-status?campaign=' + encodeURIComponent(CAMPAIGN.id))
    .catch(function () { return rpc('luciano_status', { p_campaign: CAMPAIGN.id }); });
}
