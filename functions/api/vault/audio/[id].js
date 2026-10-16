// GET /api/vault/audio/<id>  The song, only while its vault window is open. Not cached, so it
// can't be played from a cache after the time is up.
import { getDb, handle, HttpError } from '../../../../lib/db.js';
import { vaultState } from '../../../../lib/vault.js';

export const onRequestGet = handle(async ({ env, params, request }) => {
  const DB = await getDb(env);
  const v = await DB.prepare('SELECT * FROM vault WHERE id = ?').bind(String(params.id || '')).first();
  if (!v || vaultState(v) !== 'live' || !env.FILES) throw new HttpError(404, 'Sangen er ikke i vaulten lige nu.');
  const obj = await env.FILES.getWithMetadata(v.audio_key, { type: 'arrayBuffer' });
  if (!obj || !obj.value) throw new HttpError(404, 'Sangen er ikke i vaulten lige nu.');

  const data = obj.value;
  const headers = {
    'content-type': (obj.metadata && obj.metadata.type) || v.audio_type || 'audio/mpeg',
    'cache-control': 'private, no-store',
    'accept-ranges': 'bytes',
    'content-disposition': 'inline',
    'x-robots-tag': 'noindex',
  };
  const m = (request.headers.get('range') || '').match(/^bytes=(\d*)-(\d*)$/);
  if (m) {
    const size = data.byteLength;
    let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
    const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start < 0) start = 0;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    return new Response(data.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) },
    });
  }
  return new Response(data, { headers: { ...headers, 'content-length': String(data.byteLength) } });
});
