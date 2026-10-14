// POST /api/vote { campaign, handle, song, device }
// Nobody is turned away: every valid username gets in (the same username twice is one vote).
// The device id and a hash of the network are stored so /management can flag votes that
// look like the same person. Returns { result: 'ok' | 'already' | 'locked' | 'closed' | 'bad_handle' | 'bad_song' }.
import { getDb, getCampaign, isClosed, ipHash, sha256, json, body, handle, now } from '../../lib/db.js';

export function normalizeHandle(input) {
  let h = String(input || '').trim().toLowerCase();
  const url = h.match(/instagram\.com\/([^/?#]+)/);
  if (url) h = url[1];
  h = h.replace(/^@+/, '');
  if (!/^[a-z0-9._]{1,30}$/.test(h) || /^\.|\.$|\.\./.test(h)) return null;
  return h;
}

export const onRequestPost = handle(async ({ request, env }) => {
  const DB = await getDb(env);
  const b = await body(request);
  const c = await getCampaign(DB, b.campaign);
  if (isClosed(c)) return json({ result: 'closed' });
  if (!c.unlocked_at) return json({ result: 'locked' });

  const h = normalizeHandle(b.handle);
  if (!h) return json({ result: 'bad_handle' });

  const song = await DB.prepare('SELECT id FROM songs WHERE id = ? AND campaign = ? AND snippet_key IS NOT NULL')
    .bind(String(b.song || ''), c.id).first();
  if (!song) return json({ result: 'bad_song' });

  const device = /^[a-f0-9]{32}$/.test(b.device || '') ? (await sha256(c.id + ':' + b.device)).slice(0, 32) : null;
  const res = await DB.prepare(
    `INSERT INTO votes (campaign, handle, song, ip_hash, device, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (campaign, handle) DO NOTHING`
  ).bind(c.id, h, song.id, await ipHash(request, env, c.id), device, now()).run();

  return json({ result: res.meta.changes ? 'ok' : 'already', handle: h });
});
