// POST /api/vault/listen {drop, session, device, seconds, pos, duration}
// Sent every few seconds while a vault song plays (and when it stops), so /management/vault can show
// how many listened and for how long. Only counted while the song is open (plus a few minutes).
import { getDb, json, body, handle, now, sha256 } from '../../../lib/db.js';

export const onRequestPost = handle(async ({ request, env }) => {
  const DB = await getDb(env);
  const b = await body(request);
  const session = /^[a-f0-9]{32}$/.test(b.session || '') ? b.session : null;
  if (!session) return json({ ok: false });
  const v = await DB.prepare('SELECT id, starts_at, ends_at FROM vault WHERE id = ?').bind(String(b.drop || '')).first();
  const t = Date.now();
  if (!v || t < Date.parse(v.starts_at) || t > Date.parse(v.ends_at) + 10 * 60000) return json({ ok: false });

  const duration = Number(b.duration) > 0 && Number(b.duration) < 6 * 3600 ? Number(b.duration) : null;
  const cap = duration ? duration * 3 : 3 * 3600; // can't listen longer than a few times through in one go
  const seconds = Math.max(0, Math.min(cap, Number(b.seconds) || 0));
  const pos = Math.max(0, Math.min(duration || 6 * 3600, Number(b.pos) || 0));
  const listener = /^[a-f0-9]{32}$/.test(b.device || '') ? (await sha256('vault:' + b.device)).slice(0, 32) : null;
  const at = now();
  await DB.prepare(
    `INSERT INTO vault_listens (id, drop_id, listener, seconds, max_pos, duration, started_at, last_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT (id) DO UPDATE SET seconds = MAX(seconds, ?4), max_pos = MAX(max_pos, ?5), duration = COALESCE(?6, duration), last_at = ?7
     WHERE drop_id = ?2`
  ).bind(session, v.id, listener, seconds, pos, duration, at).run();
  return json({ ok: true });
});
