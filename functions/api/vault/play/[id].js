// POST /api/vault/play/<id>  Counts a play (shown at /management/vault).
import { getDb, json, handle, now } from '../../../../lib/db.js';

export const onRequestPost = handle(async ({ env, params }) => {
  const DB = await getDb(env);
  const t = now();
  await DB.prepare('UPDATE vault SET plays = plays + 1 WHERE id = ? AND starts_at <= ? AND ends_at > ?').bind(String(params.id || ''), t, t).run();
  return json({ ok: true });
});
