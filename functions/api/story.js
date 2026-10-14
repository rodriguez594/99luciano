// POST /api/story { campaign, handle }  The voter says they shared the vote on their Instagram
// story (for a double chance). This only puts them on the list at /management/vote; the double
// chance counts once you've seen the story and pressed "Godkend".
// Returns { result: 'ok' | 'not_found' | 'closed' }.
import { getDb, getCampaign, isClosed, json, body, handle, now } from '../../lib/db.js';
import { normalizeHandle } from './vote.js';

export const onRequestPost = handle(async ({ request, env }) => {
  const DB = await getDb(env);
  const b = await body(request);
  const c = await getCampaign(DB, b.campaign);
  if (isClosed(c)) return json({ result: 'closed' });
  const h = normalizeHandle(b.handle);
  if (!h) return json({ result: 'not_found' });
  const res = await DB.prepare('UPDATE votes SET story_claimed = 1 WHERE campaign = ? AND handle = ?').bind(c.id, h).run();
  if (!res.meta.changes) return json({ result: 'not_found' });
  await DB.prepare(
    `INSERT INTO reposts (campaign, handle, claimed, created_at) VALUES (?, ?, 1, ?)
     ON CONFLICT (campaign, handle) DO UPDATE SET claimed = 1`
  ).bind(c.id, h, now()).run();
  return json({ result: 'ok' });
});
