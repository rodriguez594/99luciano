// Which giveaway this page shows. Everything else (prize, end date, follower goal,
// songs, covers and snippets) is edited at /management and stored in Supabase.
var CAMPAIGN = {
  id: 'next-single-2026',
  instagram: '99luciano0',
  snippetSeconds: 30        // snippets stop after this many seconds
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
