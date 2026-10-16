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
  const r = await DB.prepare('SELECT * FROM vault ORDER BY starts_at DESC').all();
  return r.results.map(out);
}

export async function vaultRoutes(context, DB, route, id) {
  const { request, env } = context;
  const q = (k) => new URL(request.url).searchParams.get(k);

  switch (route) {
    case 'GET vault':
      return json(await list(DB));

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
      await DB.prepare('DELETE FROM vault WHERE id = ?').bind(v.id).run();
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
