// Giveaway settings. The id, song ids and end date must match the row in
// supabase/schema.sql (luciano_campaigns), which is what the server checks.
var CAMPAIGN = {
  id: 'next-single-2026',
  instagram: '99luciano',
  prize: 'Signed vinyl + 2 tickets to the release show',
  prizeDa: 'Signeret vinyl + 2 billetter til releasen',
  endsAt: '2026-11-15T23:59:00+01:00',
  snippetSeconds: 30,
  songs: [
    { id: 'song-1', title: 'Song One', file: 'snippets/song-1.mp3' },
    { id: 'song-2', title: 'Song Two', file: 'snippets/song-2.mp3' },
    { id: 'song-3', title: 'Song Three', file: 'snippets/song-3.mp3' }
  ]
};

// Supabase: Project Settings → API (the same project as 99MS works fine; the giveaway
// tables are all prefixed luciano_). The anon key is meant to be public.
var SUPABASE = {
  url: '',
  anonKey: ''
};

// Calls a Postgres function from supabase/schema.sql.
function rpc(name, args) {
  if (!SUPABASE.url || !SUPABASE.anonKey) return Promise.reject(new Error('Supabase is not set up yet (campaigns/config.js).'));
  return fetch(SUPABASE.url + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE.anonKey,
      authorization: 'Bearer ' + SUPABASE.anonKey
    },
    body: JSON.stringify(args)
  }).then(function (res) {
    return res.json().catch(function () { return null; }).then(function (data) {
      if (!res.ok) throw new Error((data && data.message) || 'Request failed');
      return data;
    });
  }, function () {
    throw new Error('offline');
  });
}
