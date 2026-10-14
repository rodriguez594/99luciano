// GET /api/status?campaign=…  Everything the giveaway page needs: settings, songs,
// follower count and whether voting is open. The page asks every 30 seconds.
import { getDb, getCampaign, isClosed, fileUrl, json, handle } from '../../lib/db.js';
import { backgroundWork } from '../../lib/background.js';

export const onRequestGet = handle(async ({ request, env, waitUntil }) => {
  const DB = await getDb(env);
  const url = new URL(request.url);
  const c = await getCampaign(DB, url.searchParams.get('campaign'));
  waitUntil(backgroundWork(DB, env, url.origin).catch((e) => console.error(String(e))));

  const [ig, songs] = await Promise.all([
    DB.prepare('SELECT followers FROM ig WHERE id = 1').first(),
    DB.prepare(
      `SELECT id, title, artist, cover_key, snippet_key FROM songs
       WHERE campaign = ? AND snippet_key IS NOT NULL AND title <> ''
       ORDER BY position, created_at`
    ).bind(c.id).all(),
  ]);

  return json({
    prize: c.prize,
    artist: c.artist,
    ends_at: c.ends_at,
    followers: ig ? ig.followers : 0,
    goal: c.goal,
    unlocked: !!c.unlocked_at,
    closed: !!isClosed(c),
    songs: songs.results.map((s) => ({
      id: s.id,
      title: s.title,
      artist: s.artist || c.artist,
      cover: fileUrl(s.cover_key),
      file: fileUrl(s.snippet_key),
    })),
  });
});
