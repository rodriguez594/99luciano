// /api/admin/projects, goals, tracks, versions, art, import  — the project tracker at
// /management/projects. Songs ("tracks") belong to a project and have versions (only the
// file's name, label and date are stored, never the audio) and album art (every upload is kept).
import { json, body, now, fileUrl, HttpError } from './db.js';

export const PROJECT_SECTIONS = new Set(['projects', 'goals', 'tracks', 'versions', 'art', 'import', 'track-order']);

const KINDS = ['songs', 'versions', 'art', 'manual'];
const MAX_ART = 15 * 1024 * 1024;

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

// A link to where the song lives (Dropbox, Google Drive, …). Only http(s); empty = none.
function linkOrNull(v) {
  const s = text(v, 1000);
  if (!s) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : 'https://' + s); } catch { throw new HttpError(400, 'Linket ser forkert ud.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, 'Linket skal starte med https://');
  return u.toString();
}
const int = (v, min, max) => Math.max(min, Math.min(max, Math.floor(Number(v)) || 0));

function dateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) throw new HttpError(400, 'Ugyldig dato.');
  return d.toISOString();
}

export async function projectRoutes(context, DB, route, id) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = (k) => url.searchParams.get(k);

  switch (route) {
    // ---------- projects ----------
    case 'GET projects':
      return json(await projectList(DB));

    case 'POST projects': {
      const b = await body(request);
      const pid = crypto.randomUUID();
      const t = now();
      await DB.prepare('INSERT INTO projects (id, title, notes, due, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(pid, text(b.title, 80) || 'Nyt projekt', text(b.notes, 2000), dateOrNull(b.due), t, t).run();
      return json(await projectFull(DB, pid), 201);
    }

    case 'GET projects/:id':
      return json(await projectFull(DB, id));

    case 'PATCH projects/:id': {
      const b = await body(request);
      const p = await getRow(DB, 'projects', id, 'Projektet findes ikke.');
      await DB.prepare('UPDATE projects SET title = ?, notes = ?, status = ?, due = ?, updated_at = ? WHERE id = ?').bind(
        'title' in b ? text(b.title, 80) || p.title : p.title,
        'notes' in b ? text(b.notes, 2000) : p.notes,
        'status' in b ? (b.status === 'done' ? 'done' : 'active') : p.status,
        'due' in b ? dateOrNull(b.due) : p.due,
        now(), p.id).run();
      return json(await projectFull(DB, p.id));
    }

    case 'DELETE projects/:id': {
      const p = await getRow(DB, 'projects', id, 'Projektet findes ikke.');
      const art = await DB.prepare('SELECT a.file_key FROM track_art a JOIN tracks t ON t.id = a.track WHERE t.project = ?').bind(p.id).all();
      await DB.batch([
        DB.prepare('DELETE FROM track_art WHERE track IN (SELECT id FROM tracks WHERE project = ?)').bind(p.id),
        DB.prepare('DELETE FROM track_versions WHERE track IN (SELECT id FROM tracks WHERE project = ?)').bind(p.id),
        DB.prepare('DELETE FROM tracks WHERE project = ?').bind(p.id),
        DB.prepare('DELETE FROM goals WHERE project = ?').bind(p.id),
        DB.prepare('DELETE FROM projects WHERE id = ?').bind(p.id),
      ]);
      await removeFiles(env, art.results.map((a) => a.file_key));
      return json({ ok: true });
    }

    // ---------- goals ----------
    case 'POST goals': {
      const b = await body(request);
      const p = await getRow(DB, 'projects', b.project, 'Projektet findes ikke.');
      await DB.prepare('INSERT INTO goals (id, project, title, kind, target, current, due, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), p.id, text(b.title, 80), KINDS.includes(b.kind) ? b.kind : 'manual',
          int(b.target, 1, 100000) || 1, int(b.current, 0, 100000), dateOrNull(b.due), now()).run();
      return json(await touch(DB, p.id));
    }

    case 'PATCH goals/:id': {
      const b = await body(request);
      const g = await getRow(DB, 'goals', id, 'Målet findes ikke.');
      await DB.prepare('UPDATE goals SET title = ?, kind = ?, target = ?, current = ?, due = ? WHERE id = ?').bind(
        'title' in b ? text(b.title, 80) : g.title,
        'kind' in b && KINDS.includes(b.kind) ? b.kind : g.kind,
        'target' in b ? int(b.target, 1, 100000) || 1 : g.target,
        'current' in b ? int(b.current, 0, 100000) : g.current,
        'due' in b ? dateOrNull(b.due) : g.due,
        g.id).run();
      return json(await touch(DB, g.project));
    }

    case 'DELETE goals/:id': {
      const g = await getRow(DB, 'goals', id, 'Målet findes ikke.');
      await DB.prepare('DELETE FROM goals WHERE id = ?').bind(g.id).run();
      return json(await touch(DB, g.project));
    }

    // ---------- songs and versions ----------

    // POST /import {project, track?, files: [{title, label, file_name, file_type, file_size, file_date}]}
    // With track: every file is a new version of that song. Without: files are grouped by title into
    // songs; a title the project already has becomes a new version of that song.
    case 'POST import': {
      const b = await body(request);
      const p = await getRow(DB, 'projects', b.project, 'Projektet findes ikke.');
      const files = (Array.isArray(b.files) ? b.files : []).slice(0, 200);
      if (!files.length) throw new HttpError(400, 'Ingen filer valgt.');
      const fixed = b.track ? await getRow(DB, 'tracks', b.track, 'Sangen findes ikke.') : null;
      if (fixed && fixed.project !== p.id) throw new HttpError(400, 'Sangen hører til et andet projekt.');

      const existing = await DB.prepare('SELECT id, title FROM tracks WHERE project = ?').bind(p.id).all();
      const byTitle = new Map(existing.results.map((t) => [t.title.toLowerCase(), t.id]));
      const t = now();
      const stmts = [];
      const touched = new Set();
      const labels = new Map(); // track id → labels already used
      let created = 0, added = 0, skipped = 0;

      const labelsFor = async (trackId) => {
        if (!labels.has(trackId)) {
          const r = await DB.prepare('SELECT label, file_name, file_date FROM track_versions WHERE track = ?').bind(trackId).all();
          labels.set(trackId, r.results);
        }
        return labels.get(trackId);
      };

      for (const f of files) {
        const fileName = text(f.file_name, 200);
        const fileDate = dateOrNull(f.file_date) || t;
        let trackId = fixed && fixed.id;
        if (!trackId) {
          const title = text(f.title, 80) || fileName.replace(/\.[^.]+$/, '');
          if (!title) throw new HttpError(400, 'Skriv sangens navn.');
          trackId = byTitle.get(title.toLowerCase());
          if (!trackId) {
            trackId = crypto.randomUUID();
            byTitle.set(title.toLowerCase(), trackId);
            labels.set(trackId, []);
            // New songs go last
            stmts.push(DB.prepare(
              `INSERT INTO tracks (id, project, title, position, created_at, updated_at)
               VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(position), -1) + 1 FROM tracks WHERE project = ?2), ?4, ?4)`
            ).bind(trackId, p.id, title, t));
            created++;
          }
        }
        const have = await labelsFor(trackId);
        // The same file twice (same name and date) is skipped
        if (fileName && have.some((v) => v.file_name === fileName && v.file_date === fileDate)) { skipped++; continue; }
        const label = text(f.label, 40) || nextLabel(have.map((v) => v.label));
        have.push({ label, file_name: fileName, file_date: fileDate });
        stmts.push(DB.prepare(
          'INSERT INTO track_versions (id, track, label, file_name, file_type, file_size, file_date, link, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(crypto.randomUUID(), trackId, label, fileName, text(f.file_type, 80) || null,
          f.file_size != null && Number.isFinite(Number(f.file_size)) ? Math.max(0, Math.floor(Number(f.file_size))) : null, fileDate, linkOrNull(f.link), t));
        touched.add(trackId);
        added++;
      }
      for (const tid of touched) stmts.push(DB.prepare('UPDATE tracks SET updated_at = ? WHERE id = ?').bind(t, tid));
      for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
      const out = await touch(DB, p.id);
      return json({ project: out, created, added, skipped });
    }

    // POST /track-order {project, ids}: the songs in their new order (drag and drop)
    case 'POST track-order': {
      const b = await body(request);
      const p = await getRow(DB, 'projects', b.project, 'Projektet findes ikke.');
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 1000);
      const stmts = ids.map((tid, i) => DB.prepare('UPDATE tracks SET position = ? WHERE id = ? AND project = ?').bind(i, tid, p.id));
      for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
      return json(await touch(DB, p.id));
    }

    case 'PATCH tracks/:id': {
      const b = await body(request);
      const tr = await getRow(DB, 'tracks', id, 'Sangen findes ikke.');
      let art = tr.art_id;
      if ('art_id' in b) {
        const a = b.art_id && (await DB.prepare('SELECT id FROM track_art WHERE id = ? AND track = ?').bind(String(b.art_id), tr.id).first());
        if (!a) throw new HttpError(404, 'Billedet findes ikke.');
        art = a.id;
      }
      await DB.prepare('UPDATE tracks SET title = ?, art_id = ?, updated_at = ? WHERE id = ?')
        .bind('title' in b ? text(b.title, 80) || tr.title : tr.title, art, now(), tr.id).run();
      // Move the song (with its versions and covers) to another project, at the end
      if (b.project && b.project !== tr.project) {
        const to = await getRow(DB, 'projects', b.project, 'Projektet findes ikke.');
        await DB.prepare(
          `UPDATE tracks SET project = ?1, position = (SELECT COALESCE(MAX(position), -1) + 1 FROM tracks WHERE project = ?1) WHERE id = ?2`
        ).bind(to.id, tr.id).run();
        await DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now(), to.id).run();
      }
      return json(await touch(DB, tr.project));
    }

    case 'DELETE tracks/:id': {
      const tr = await getRow(DB, 'tracks', id, 'Sangen findes ikke.');
      const art = await DB.prepare('SELECT file_key FROM track_art WHERE track = ?').bind(tr.id).all();
      await DB.batch([
        DB.prepare('DELETE FROM track_art WHERE track = ?').bind(tr.id),
        DB.prepare('DELETE FROM track_versions WHERE track = ?').bind(tr.id),
        DB.prepare('DELETE FROM tracks WHERE id = ?').bind(tr.id),
      ]);
      await removeFiles(env, art.results.map((a) => a.file_key));
      return json(await touch(DB, tr.project));
    }

    case 'PATCH versions/:id': {
      const b = await body(request);
      const v = await getRow(DB, 'track_versions', id, 'Versionen findes ikke.');
      await DB.prepare('UPDATE track_versions SET label = ?, file_date = ?, link = ? WHERE id = ?')
        .bind('label' in b ? text(b.label, 40) || v.label : v.label, 'file_date' in b ? dateOrNull(b.file_date) || v.file_date : v.file_date,
          'link' in b ? linkOrNull(b.link) : v.link, v.id).run();
      const tr = await getRow(DB, 'tracks', v.track, 'Sangen findes ikke.');
      return json(await touch(DB, tr.project));
    }

    case 'DELETE versions/:id': {
      const v = await getRow(DB, 'track_versions', id, 'Versionen findes ikke.');
      await DB.prepare('DELETE FROM track_versions WHERE id = ?').bind(v.id).run();
      const tr = await getRow(DB, 'tracks', v.track, 'Sangen findes ikke.');
      return json(await touch(DB, tr.project));
    }

    // ---------- album art ----------

    // POST /art?track=…  (the image is the request body). The new art is shown; older ones are kept.
    case 'POST art': {
      if (!env.FILES) throw new HttpError(500, 'Fillageret er ikke koblet på (KV-binding "FILES").');
      const tr = await getRow(DB, 'tracks', q('track'), 'Sangen findes ikke.');
      const type = (request.headers.get('content-type') || '').split(';')[0].trim();
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
      if (!ext) throw new HttpError(400, 'Album art skal være et billede.');
      const data = await request.arrayBuffer();
      if (!data.byteLength) throw new HttpError(400, 'Filen er tom.');
      if (data.byteLength > MAX_ART) throw new HttpError(413, 'Filen er for stor (max 15 MB).');
      const artId = crypto.randomUUID();
      const key = `projects/${tr.project}/${tr.id}/${Date.now()}-art.${ext}`;
      await env.FILES.put(key, data, { metadata: { type } });
      await DB.batch([
        DB.prepare('INSERT INTO track_art (id, track, file_key, added_at) VALUES (?, ?, ?, ?)').bind(artId, tr.id, key, now()),
        DB.prepare('UPDATE tracks SET art_id = ?, updated_at = ? WHERE id = ?').bind(artId, now(), tr.id),
      ]);
      return json(await touch(DB, tr.project));
    }

    case 'DELETE art/:id': {
      const a = await getRow(DB, 'track_art', id, 'Billedet findes ikke.');
      const tr = await getRow(DB, 'tracks', a.track, 'Sangen findes ikke.');
      await DB.prepare('DELETE FROM track_art WHERE id = ?').bind(a.id).run();
      if (tr.art_id === a.id) {
        const latest = await DB.prepare('SELECT id FROM track_art WHERE track = ? ORDER BY added_at DESC LIMIT 1').bind(tr.id).first();
        await DB.prepare('UPDATE tracks SET art_id = ? WHERE id = ?').bind(latest ? latest.id : null, tr.id).run();
      }
      await removeFiles(env, [a.file_key]);
      return json(await touch(DB, tr.project));
    }
  }
  throw new HttpError(404, 'Ukendt adresse.');
}

// v1, v2, … after the highest numbered label used so far
export function nextLabel(used) {
  let n = 0;
  for (const l of used) {
    const m = /^v(?:er(?:sion)?)?\.?\s*(\d+)/i.exec(String(l));
    if (m) n = Math.max(n, Number(m[1]));
  }
  return 'v' + (n + 1);
}

async function getRow(DB, table, id, missing) {
  const r = id && (await DB.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(String(id)).first());
  if (!r) throw new HttpError(404, missing);
  return r;
}

async function touch(DB, projectId) {
  await DB.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now(), projectId).run();
  return projectFull(DB, projectId);
}

function progress(goal, counts) {
  const value = goal.kind === 'manual' ? goal.current : counts[goal.kind] || 0;
  return {
    id: goal.id, title: goal.title, kind: goal.kind, target: goal.target, current: goal.current, due: goal.due,
    value, done: value >= goal.target, pct: Math.min(100, Math.round((value / Math.max(1, goal.target)) * 100)),
  };
}

export async function projectFull(DB, id) {
  const p = await getRow(DB, 'projects', id, 'Projektet findes ikke.');
  const [goals, tracks, versions, art] = await Promise.all([
    DB.prepare('SELECT * FROM goals WHERE project = ? ORDER BY created_at').bind(p.id).all(),
    DB.prepare('SELECT * FROM tracks WHERE project = ? ORDER BY position, created_at').bind(p.id).all(),
    DB.prepare('SELECT v.* FROM track_versions v JOIN tracks t ON t.id = v.track WHERE t.project = ? ORDER BY v.file_date DESC, v.added_at DESC').bind(p.id).all(),
    DB.prepare('SELECT a.* FROM track_art a JOIN tracks t ON t.id = a.track WHERE t.project = ? ORDER BY a.added_at DESC').bind(p.id).all(),
  ]);
  const songs = tracks.results.map((t) => {
    const vs = versions.results.filter((v) => v.track === t.id).map((v) => ({
      id: v.id, label: v.label, file_name: v.file_name, file_type: v.file_type, file_size: v.file_size, file_date: v.file_date, link: v.link, added_at: v.added_at,
    }));
    const arts = art.results.filter((a) => a.track === t.id).map((a) => ({ id: a.id, url: fileUrl(a.file_key), added_at: a.added_at }));
    const cur = arts.find((a) => a.id === t.art_id) || null;
    return {
      id: t.id, title: t.title, created_at: t.created_at, updated_at: t.updated_at,
      art_id: cur && cur.id, art_url: cur && cur.url, art: arts, versions: vs,
    };
  });
  const counts = {
    songs: songs.length,
    versions: versions.results.length,
    art: songs.filter((s) => s.art_url).length,
    linked: songs.filter((s) => s.versions.some((v) => v.link)).length,
  };
  return {
    id: p.id, title: p.title, notes: p.notes, status: p.status, due: p.due, created_at: p.created_at, updated_at: p.updated_at,
    counts, goals: goals.results.map((g) => progress(g, counts)), songs,
  };
}

export async function projectList(DB) {
  const [projects, goals, counts, covers] = await Promise.all([
    DB.prepare('SELECT * FROM projects ORDER BY status, updated_at DESC').all(),
    DB.prepare('SELECT * FROM goals ORDER BY created_at').all(),
    DB.prepare(
      `SELECT t.project,
         COUNT(DISTINCT t.id) AS songs,
         COUNT(v.id) AS versions,
         COUNT(DISTINCT CASE WHEN t.art_id IS NOT NULL THEN t.id END) AS art
       FROM tracks t LEFT JOIN track_versions v ON v.track = t.id GROUP BY t.project`
    ).all(),
    DB.prepare(
      `SELECT t.project, a.file_key FROM tracks t JOIN track_art a ON a.id = t.art_id ORDER BY t.updated_at DESC`
    ).all(),
  ]);
  return projects.results.map((p) => {
    const c = counts.results.find((r) => r.project === p.id) || { songs: 0, versions: 0, art: 0 };
    const n = { songs: c.songs, versions: c.versions, art: c.art };
    return {
      id: p.id, title: p.title, notes: p.notes, status: p.status, due: p.due, updated_at: p.updated_at, counts: n,
      goals: goals.results.filter((g) => g.project === p.id).map((g) => progress(g, n)),
      covers: covers.results.filter((r) => r.project === p.id).slice(0, 4).map((r) => fileUrl(r.file_key)),
    };
  });
}

// The latest versions across all projects, for the dashboard
export async function recentVersions(DB, limit = 8) {
  const r = await DB.prepare(
    `SELECT v.label, v.file_name, v.file_date, v.added_at, t.title AS song, t.id AS track, p.title AS project, p.id AS project_id
     FROM track_versions v JOIN tracks t ON t.id = v.track JOIN projects p ON p.id = t.project
     ORDER BY v.added_at DESC, v.file_date DESC LIMIT ?`
  ).bind(limit).all();
  return r.results;
}

async function removeFiles(env, keys) {
  if (!env.FILES) return;
  await Promise.all(keys.filter(Boolean).map((k) => env.FILES.delete(k).catch(() => {})));
}
