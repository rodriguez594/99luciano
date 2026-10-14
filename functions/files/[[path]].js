// GET /files/…  Covers and snippets uploaded at /management (stored in the KV binding FILES).
// Every upload gets a new name, so files can be cached for a year.
export async function onRequestGet({ env, params, request }) {
  if (!env.FILES) return new Response('Not found', { status: 404 });
  const key = (params.path || []).join('/');
  const obj = await env.FILES.getWithMetadata(key, { type: 'arrayBuffer', cacheTtl: 3600 });
  if (!obj || !obj.value) return new Response('Not found', { status: 404 });

  const type = (obj.metadata && obj.metadata.type) || 'application/octet-stream';
  const data = obj.value;
  const headers = {
    'content-type': type,
    'cache-control': 'public, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
  };

  // Audio players (Safari especially) ask for byte ranges
  const range = request.headers.get('range');
  const m = range && range.match(/^bytes=(\d*)-(\d*)$/);
  if (m) {
    const size = data.byteLength;
    let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
    let end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start < 0) start = 0;
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    return new Response(data.slice(start, end + 1), {
      status: 206,
      headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) },
    });
  }
  return new Response(data, { headers: { ...headers, 'content-length': String(data.byteLength) } });
}
