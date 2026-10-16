// The vault: /management/vault uploads unreleased songs with a time window;
// 99luciano.dk/vault plays them only while the window is open.
import { json, body, now, fileUrl, HttpError } from './db.js';

export const VAULT_SECTIONS = new Set(['vault', 'vault-upload']);
const MAX_AUDIO = 24 * 1024 * 1024; // KV values can be at most 25 MiB
const MAX_COVER = 15 * 1024 * 1024;

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function time(v, what) {
  const d = new Date(v);
  if (!v || isNaN(d)) throw new HttpError(400, 'Ugyldigt tidspunkt for ' + what + '.');
  return d.toISOString();
}

export function vaultState(v, at = Date.now()) {
  if (!v.audio_key) return 'missing';
  if (at < Date.parse(v.starts_at)) return 'scheduled';
  if (at >= Date.parse(v.ends_at)) return 'ended';
  return 'live';
}

function out(v) {
  return {
    id: v.id, title: v.title, artist: v.artist, note: v.note, starts_at: v.starts_at, ends_at: v.ends_at,
    plays: v.plays, created_at: v.created_at, cover_url: fileUrl(v.cover_key), has_audio: !!v.audio_key,
    audio_type: v.audio_type, state: vaultState(v),
  };
}

async function getDrop(DB, id) {
  const v = id && (await DB.prepare('SELECT * FROM vault WHERE id = ?').bind(String(id)).first());
  if (!v) throw new HttpError(404, 'Sangen findes ikke i vaulten.');
  return v;
}

async function list(DB) {
  const [r, s] = await Promise.all([
    DB.prepare('SELECT * FROM vault ORDER BY starts_at DESC').all(),
    // Listens of at least 3 seconds count
    DB.prepare(
      `SELECT drop_id, COUNT(*) AS listens, COUNT(DISTINCT COALESCE(listener, id)) AS listeners, SUM(seconds) AS seconds,
         SUM(CASE WHEN duration > 0 AND max_pos >= duration * 0.9 THEN 1 ELSE 0 END) AS finished
       FROM vault_listens WHERE seconds >= 3 GROUP BY drop_id`
    ).all(),
  ]);
  const stats = new Map(s.results.map((x) => [x.drop_id, x]));
  return r.results.map((v) => {
    const x = stats.get(v.id) || { listens: 0, listeners: 0, seconds: 0, finished: 0 };
    return { ...out(v), listens: x.listens, listeners: x.listeners, listen_seconds: Math.round(x.seconds || 0), finished: x.finished };
  });
}

// Everything about how one song was listened to
async function listenStats(DB, id) {
  const r = await DB.prepare(
    'SELECT listener, seconds, max_pos, duration, started_at, last_at FROM vault_listens WHERE drop_id = ? AND seconds >= 3 ORDER BY started_at DESC'
  ).bind(id).all();
  const rows = r.results;
  const people = new Map();
  for (const x of rows) {
    const k = x.listener || x.started_at;
    const p = people.get(k) || { seconds: 0, listens: 0, best: 0, duration: x.duration };
    p.seconds += x.seconds;
    p.listens++;
    p.best = Math.max(p.best, x.duration ? x.max_pos / x.duration : 0);
    p.duration = p.duration || x.duration;
    people.set(k, p);
  }
  const buckets = [0, 0, 0, 0]; // furthest point each listener reached: 0–25 %, 25–50 %, 50–75 %, 75–100 %
  for (const p of people.values()) buckets[Math.min(3, Math.floor(p.best * 4))]++;
  const total = rows.reduce((a, x) => a + x.seconds, 0);
  const duration = rows.find((x) => x.duration)?.duration || null;
  return {
    listens: rows.length,
    listeners: people.size,
    seconds: Math.round(total),
    avg_per_listener: people.size ? Math.round(total / people.size) : 0,
    avg_per_listen: rows.length ? Math.round(total / rows.length) : 0,
    finished: [...people.values()].filter((p) => p.best >= 0.9).length,
    repeat: [...people.values()].filter((p) => p.listens > 1).length,
    duration,
    buckets,
    recent: rows.slice(0, 30).map((x) => ({
      started_at: x.started_at, seconds: Math.round(x.seconds), max_pos: Math.round(x.max_pos), duration: x.duration ? Math.round(x.duration) : null,
    })),
  };
}

export async function vaultRoutes(context, DB, route, id) {
  const { request, env } = context;
  const q = (k) => new URL(request.url).searchParams.get(k);

  switch (route) {
    case 'GET vault':
      return json(await list(DB));

    case 'GET vault/:id':
      await getDrop(DB, id);
      return json(await listenStats(DB, id));

    // POST /vault {title, artist, note, starts_at, ends_at} → the new drop; upload the audio after
    case 'POST vault': {
      const b = await body(request);
      const starts = time(b.starts_at || now(), 'start');
      const ends = time(b.ends_at, 'slut');
      if (Date.parse(ends) <= Date.parse(starts)) throw new HttpError(400, 'Sluttidspunktet skal være efter starten.');
      const vid = crypto.randomUUID();
      await DB.prepare('INSERT INTO vault (id, title, artist, note, starts_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(vid, text(b.title, 80) || 'Uden titel', text(b.artist, 60) || null, text(b.note, 300), starts, ends, now()).run();
      return json(out(await getDrop(DB, vid)), 201);
    }

    case 'PATCH vault/:id': {
      const b = await body(request);
      const v = await getDrop(DB, id);
      const starts = 'starts_at' in b ? time(b.starts_at, 'start') : v.starts_at;
      const ends = 'ends_at' in b ? time(b.ends_at, 'slut') : v.ends_at;
      if (Date.parse(ends) <= Date.parse(starts)) throw new HttpError(400, 'Sluttidspunktet skal være efter starten.');
      await DB.prepare('UPDATE vault SET title = ?, artist = ?, note = ?, starts_at = ?, ends_at = ? WHERE id = ?').bind(
        'title' in b ? text(b.title, 80) || v.title : v.title,
        'artist' in b ? text(b.artist, 60) || null : v.artist,
        'note' in b ? text(b.note, 300) : v.note,
        starts, ends, v.id).run();
      return json(out(await getDrop(DB, v.id)));
    }

    case 'DELETE vault/:id': {
      const v = await getDrop(DB, id);
      await DB.batch([
        DB.prepare('DELETE FROM vault WHERE id = ?').bind(v.id),
        DB.prepare('DELETE FROM vault_listens WHERE drop_id = ?').bind(v.id),
      ]);
      if (env.FILES) await Promise.all([v.audio_key, v.cover_key].filter(Boolean).map((k) => env.FILES.delete(k).catch(() => {})));
      return json({ ok: true });
    }

    // POST /vault-upload?id=…&kind=audio|cover  (the file is the request body)
    case 'POST vault-upload': {
      if (!env.FILES) throw new HttpError(500, 'Fillageret er ikke koblet på (KV-binding "FILES").');
      const v = await getDrop(DB, q('id'));
      const kind = q('kind');
      const type = (request.headers.get('content-type') || '').split(';')[0].trim();
      if (kind === 'audio' && !/^audio\//.test(type)) throw new HttpError(400, 'Det skal være en lydfil.');
      if (kind === 'cover' && !/^image\/(jpeg|png|webp)$/.test(type)) throw new HttpError(400, 'Cover skal være et billede.');
      if (kind !== 'audio' && kind !== 'cover') throw new HttpError(400, 'Ukendt filtype.');
      const data = await request.arrayBuffer();
      if (!data.byteLength) throw new HttpError(400, 'Filen er tom.');
      const max = kind === 'audio' ? MAX_AUDIO : MAX_COVER;
      if (data.byteLength > max) throw new HttpError(413, 'Filen er for stor (max ' + Math.round(max / 1048576) + ' MB).');
      const ext = (type.split('/')[1] || 'bin').replace(/[^a-z0-9]/g, '').replace('mpeg', 'mp3') || 'bin';
      const key = `vault/${v.id}/${Date.now()}-${kind}.${ext}`;
      await env.FILES.put(key, data, { metadata: { type } });
      const col = kind === 'audio' ? 'audio_key' : 'cover_key';
      await DB.prepare(`UPDATE vault SET ${col} = ?${kind === 'audio' ? ', audio_type = ?' : ''} WHERE id = ?`)
        .bind(...(kind === 'audio' ? [key, type, v.id] : [key, v.id])).run();
      if (v[col]) await env.FILES.delete(v[col]).catch(() => {});
      return json(out(await getDrop(DB, v.id)));
    }
  }
  throw new HttpError(404, 'Ukendt adresse.');
}

// For the public page: what's open now, and when the next one opens (no title, to keep it a surprise)
export async function publicVault(DB) {
  const t = now();
  const [live, next] = await Promise.all([
    DB.prepare('SELECT * FROM vault WHERE audio_key IS NOT NULL AND starts_at <= ? AND ends_at > ? ORDER BY ends_at').bind(t, t).all(),
    DB.prepare('SELECT starts_at FROM vault WHERE audio_key IS NOT NULL AND starts_at > ? ORDER BY starts_at LIMIT 1').bind(t).first(),
  ]);
  return {
    now: t,
    live: live.results.map((v) => ({
      id: v.id, title: v.title, artist: v.artist, note: v.note, ends_at: v.ends_at, starts_at: v.starts_at,
      cover: fileUrl(v.cover_key), audio: '/api/vault/audio/' + v.id,
    })),
    next: next ? next.starts_at : null,
  };
}
