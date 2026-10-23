// /api/admin/releases …  Singles, EPs and albums (released and upcoming) with cover, tracklist,
// links and a flag for the countdown page.
import { json, body, now, fileUrl, HttpError } from './db.js';

export const RELEASE_SECTIONS = new Set(['releases', 'release-cover', 'release-tracks', 'release-order']);
const KINDS = ['single', 'ep', 'album'];
const LINKS = ['spotify', 'apple', 'youtube', 'presave'];
const MAX_COVER = 15 * 1024 * 1024;

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function dateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) throw new HttpError(400, 'Ugyldig dato.');
  return d.toISOString();
}

function cleanLinks(v, old = {}) {
  const out = { ...old };
  for (const k of LINKS) {
    if (!(k in (v || {}))) continue;
    const s = text(v[k], 1000);
    if (!s) { delete out[k]; continue; }
    let u;
    try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); } catch { throw new HttpError(400, 'Linket ser forkert ud.'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, 'Linket skal starte med https://');
    out[k] = u.toString();
  }
  return out;
}

async function getRelease(DB, id) {
  const r = id && (await DB.prepare('SELECT * FROM releases WHERE id = ?').bind(String(id)).first());
  if (!r) throw new HttpError(404, 'Udgivelsen findes ikke.');
  return r;
}

export async function releaseList(DB) {
  const [rs, ts] = await Promise.all([
    DB.prepare('SELECT * FROM releases ORDER BY COALESCE(release_at, created_at) DESC').all(),
    DB.prepare('SELECT * FROM release_tracks ORDER BY position, created_at').all(),
  ]);
  return rs.results.map((r) => {
    let links = {};
    try { links = JSON.parse(r.links || '{}'); } catch {}
    const tracks = ts.results.filter((t) => t.release_id === r.id).map((t) => ({ id: t.id, title: t.title, feat: t.feat, duration: t.duration }));
    return {
      id: r.id, kind: r.kind, title: r.title, artist: r.artist, release_at: r.release_at, cover_url: fileUrl(r.cover_key),
      links, notes: r.notes, countdown: !!r.countdown, countdown_title: r.countdown_title, created_at: r.created_at, updated_at: r.updated_at,
      tracks, duration: tracks.reduce((a, t) => a + (t.duration || 0), 0),
    };
  });
}

async function one(DB, id) {
  return (await releaseList(DB)).find((r) => r.id === id);
}

export async function releaseRoutes(context, DB, route, id) {
  const { request, env } = context;
  const q = (k) => new URL(request.url).searchParams.get(k);

  switch (route) {
    case 'GET releases':
      return json(await releaseList(DB));

    case 'POST releases': {
      const b = await body(request);
      const rid = crypto.randomUUID();
      const t = now();
      await DB.prepare('INSERT INTO releases (id, kind, title, artist, release_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(rid, KINDS.includes(b.kind) ? b.kind : 'single', text(b.title, 120) || 'Uden titel', text(b.artist, 80) || null, dateOrNull(b.release_at), t, t).run();
      // A single starts with one track named like the release
      if ((b.kind || 'single') === 'single') {
        await DB.prepare('INSERT INTO release_tracks (id, release_id, position, title, created_at) VALUES (?, ?, 0, ?, ?)')
          .bind(crypto.randomUUID(), rid, text(b.title, 120) || 'Uden titel', t).run();
      }
      return json(await one(DB, rid), 201);
    }

    case 'PATCH releases/:id': {
      const b = await body(request);
      const r = await getRelease(DB, id);
      let links = {};
      try { links = JSON.parse(r.links || '{}'); } catch {}
      await DB.prepare(
        `UPDATE releases SET kind = ?, title = ?, artist = ?, release_at = ?, links = ?, notes = ?, countdown = ?, countdown_title = ?, updated_at = ? WHERE id = ?`
      ).bind(
        'kind' in b && KINDS.includes(b.kind) ? b.kind : r.kind,
        'title' in b ? text(b.title, 120) || r.title : r.title,
        'artist' in b ? text(b.artist, 80) || null : r.artist,
        'release_at' in b ? dateOrNull(b.release_at) : r.release_at,
        JSON.stringify('links' in b ? cleanLinks(b.links, links) : links),
        'notes' in b ? text(b.notes, 4000) : r.notes,
        'countdown' in b ? (b.countdown ? 1 : 0) : r.countdown,
        'countdown_title' in b ? text(b.countdown_title, 120) || null : r.countdown_title,
        now(), r.id).run();
      return json(await one(DB, r.id));
    }

    case 'DELETE releases/:id': {
      const r = await getRelease(DB, id);
      await DB.batch([
        DB.prepare('DELETE FROM release_tracks WHERE release_id = ?').bind(r.id),
        DB.prepare('DELETE FROM releases WHERE id = ?').bind(r.id),
      ]);
      if (r.cover_key && env.FILES) await env.FILES.delete(r.cover_key).catch(() => {});
      return json({ ok: true });
    }

    // POST /release-cover?id=…  (the image is the request body)
    case 'POST release-cover': {
      if (!env.FILES) throw new HttpError(500, 'Fillageret er ikke koblet på (KV-binding "FILES").');
      const r = await getRelease(DB, q('id'));
      const type = (request.headers.get('content-type') || '').split(';')[0].trim();
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
      if (!ext) throw new HttpError(400, 'Cover skal være et billede.');
      const data = await request.arrayBuffer();
      if (!data.byteLength) throw new HttpError(400, 'Filen er tom.');
      if (data.byteLength > MAX_COVER) throw new HttpError(413, 'Filen er for stor (max 15 MB).');
      const key = `releases/${r.id}/${Date.now()}-cover.${ext}`;
      await env.FILES.put(key, data, { metadata: { type } });
      await DB.prepare('UPDATE releases SET cover_key = ?, updated_at = ? WHERE id = ?').bind(key, now(), r.id).run();
      if (r.cover_key) await env.FILES.delete(r.cover_key).catch(() => {});
      return json(await one(DB, r.id));
    }

    // Tracklist
    case 'POST release-tracks': {
      const b = await body(request);
      const r = await getRelease(DB, b.release);
      const last = await DB.prepare('SELECT MAX(position) AS p FROM release_tracks WHERE release_id = ?').bind(r.id).first();
      await DB.prepare('INSERT INTO release_tracks (id, release_id, position, title, feat, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), r.id, last && last.p != null ? last.p + 1 : 0, text(b.title, 120), text(b.feat, 120) || null,
          Number(b.duration) > 0 ? Math.floor(Number(b.duration)) : null, now()).run();
      await DB.prepare('UPDATE releases SET updated_at = ? WHERE id = ?').bind(now(), r.id).run();
      return json(await one(DB, r.id));
    }

    case 'PATCH release-tracks/:id': {
      const b = await body(request);
      const t = await DB.prepare('SELECT * FROM release_tracks WHERE id = ?').bind(String(id)).first();
      if (!t) throw new HttpError(404, 'Nummeret findes ikke.');
      await DB.prepare('UPDATE release_tracks SET title = ?, feat = ?, duration = ? WHERE id = ?').bind(
        'title' in b ? text(b.title, 120) : t.title,
        'feat' in b ? text(b.feat, 120) || null : t.feat,
        'duration' in b ? (Number(b.duration) > 0 ? Math.floor(Number(b.duration)) : null) : t.duration,
        t.id).run();
      return json(await one(DB, t.release_id));
    }

    case 'DELETE release-tracks/:id': {
      const t = await DB.prepare('SELECT * FROM release_tracks WHERE id = ?').bind(String(id)).first();
      if (!t) throw new HttpError(404, 'Nummeret findes ikke.');
      await DB.prepare('DELETE FROM release_tracks WHERE id = ?').bind(t.id).run();
      return json(await one(DB, t.release_id));
    }

    case 'POST release-order': {
      const b = await body(request);
      const r = await getRelease(DB, b.release);
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 200);
      if (ids.length) await DB.batch(ids.map((tid, i) => DB.prepare('UPDATE release_tracks SET position = ? WHERE id = ? AND release_id = ?').bind(i, tid, r.id)));
      return json(await one(DB, r.id));
    }
  }
  throw new HttpError(404, 'Ukendt adresse.');
}
