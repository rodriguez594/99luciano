// GET /api/rounds?handle=…  How many rounds (giveaways) this Instagram username has voted in,
// and how many it takes to join the gift card draw.
import { getDb, json, handle, loyaltyMin } from '../../lib/db.js';
import { normalizeHandle } from './vote.js';

export const onRequestGet = handle(async ({ request, env }) => {
  const DB = await getDb(env);
  const h = normalizeHandle(new URL(request.url).searchParams.get('handle'));
  const needed = await loyaltyMin(DB);
  if (!h) return json({ rounds: 0, needed });
  const r = await DB.prepare('SELECT COUNT(DISTINCT campaign) AS n FROM votes WHERE handle = ?').bind(h).first();
  return json({ rounds: r.n, needed });
});
