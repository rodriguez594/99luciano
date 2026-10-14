// /api/admin/…  used by /management. The middleware has already checked the login.
import { getDb, getCampaign, isClosed, fileUrl, json, body, handle, now, HttpError } from '../../../lib/db.js';
import { groupVotes, flagReasons, randomInt } from '../../../lib/groups.js';
import { setFollowers } from '../../../lib/background.js';
import { normalizeHandle } from '../vote.js';
import { PROJECT_SECTIONS, projectRoutes, projectList, recentVersions } from '../../../lib/projects.js';

const MAX_FILE = 15 * 1024 * 1024;

export const onRequest = handle(async (context) => {
  const { request, env, params, data } = context;
  const DB = await getDb(env);
  const url = new URL(request.url);
  const [section, id] = params.path || [];
  const route = request.method + ' ' + (section || '') + (id ? '/:id' : '');
  const q = (k) => url.searchParams.get(k);

  if (PROJECT_SECTIONS.has(section)) return projectRoutes(context, DB, route, id);

  switch (route) {
    case 'GET me':
      return json({ email: data.email });

    // Opened as a normal page so Cloudflare Access can show its login for /api/admin,
    // then sends you back to /management.
    case 'GET login': {
      const back = q('return') || '/management/dashboard/';
      const safe = back.startsWith('/') && !back.startsWith('//') && !back.startsWith('/\\') ? back : '/management/dashboard/';
      return Response.redirect(new URL(safe, url.origin).toString(), 302);
    }

    // ---------- giveaway settings ----------
    case 'GET campaign':
      return json(campaignOut(await getCampaign(DB, q('campaign'))));

    case 'PUT campaign': {
      const b = await body(request);
      const c = await getCampaign(DB, b.campaign);
      const goal = Math.max(0, Math.floor(Number(b.goal)));
      if (!Number.isFinite(goal)) throw new HttpError(400, 'Skriv et antal følgere.');
      const ends = b.ends_at ? new Date(b.ends_at) : null;
      if (ends && isNaN(ends)) throw new HttpError(400, 'Ugyldig slutdato.');
      const draw = b.draw_at ? new Date(b.draw_at) : null;
      if (draw && isNaN(draw)) throw new HttpError(400, 'Ugyldigt tidspunkt for lodtrækningen.');
      await DB.prepare('UPDATE campaigns SET prize = ?, artist = ?, ends_at = ?, draw_at = ?, goal = ?, open = ? WHERE id = ?')
        .bind(String(b.prize || '').slice(0, 120), String(b.artist || '').trim().slice(0, 60) || '99 LUCIANO',
          ends ? ends.toISOString() : null, draw ? draw.toISOString() : null, goal, b.open ? 1 : 0, c.id).run();
      return json(campaignOut(await getCampaign(DB, c.id)));
    }

    // Publish puts the vote on 99luciano.dk/vote (and the button on the front page); unpublish hides it again
    case 'POST publish': {
      const b = await body(request);
      const c = await getCampaign(DB, b.campaign);
      await DB.prepare('UPDATE campaigns SET published = ? WHERE id = ?').bind(b.published ? 1 : 0, c.id).run();
      return json(campaignOut(await getCampaign(DB, c.id)));
    }

    // Everything /management/dashboard shows
    case 'GET dashboard': {
      const c = await getCampaign(DB, q('campaign'));
      const [votes, songs, signups, projects, recent] = await Promise.all([
        DB.prepare('SELECT COUNT(*) AS n FROM votes WHERE campaign = ?').bind(c.id).first(),
        DB.prepare(
          `SELECT s.id, s.title, s.cover_key, s.snippet_key, (SELECT COUNT(*) FROM votes v WHERE v.song = s.id) AS votes
           FROM songs s WHERE s.campaign = ? ORDER BY s.position, s.created_at`
        ).bind(c.id).all(),
        DB.prepare('SELECT (SELECT COUNT(*) FROM notify WHERE campaign = ?1) + (SELECT COUNT(*) FROM winner_notify WHERE campaign = ?1) AS n').bind(c.id).first(),
        projectList(DB),
        recentVersions(DB),
      ]);
      return json({
        vote: {
          ...campaignOut(c), closed: !!isClosed(c), votes: votes.n, signups: signups.n,
          songs: songs.results.map((s) => ({
            id: s.id, title: s.title, votes: s.votes, cover_url: fileUrl(s.cover_key), ready: !!(s.title && s.snippet_key),
          })),
        },
        projects,
        recent,
      });
    }

    case 'POST followers': {
      const b = await body(request);
      const n = Number(b.followers);
      if (!(n >= 0)) throw new HttpError(400, 'Skriv et antal følgere.');
      await setFollowers(DB, n);
      return json({ ok: true });
    }

    case 'POST unlock': {
      const b = await body(request);
      const c = await getCampaign(DB, b.campaign);
      await DB.prepare('UPDATE campaigns SET unlocked_at = COALESCE(unlocked_at, ?) WHERE id = ?').bind(now(), c.id).run();
      return json({ ok: true });
    }

    case 'GET status': {
      const c = await getCampaign(DB, q('campaign'));
      const ig = await DB.prepare('SELECT followers FROM ig WHERE id = 1').first();
      return json({ followers: ig ? ig.followers : 0, goal: c.goal, unlocked: !!c.unlocked_at, closed: !!isClosed(c), published: !!c.published });
    }

    // ---------- songs ----------
    case 'GET songs': {
      const c = await getCampaign(DB, q('campaign'));
      return json(await songsOut(DB, c.id));
    }

    case 'POST songs': {
      const b = await body(request);
      const c = await getCampaign(DB, b.campaign);
      const last = await DB.prepare('SELECT MAX(position) AS p FROM songs WHERE campaign = ?').bind(c.id).first();
      const songId = crypto.randomUUID();
      await DB.prepare('INSERT INTO songs (id, campaign, title, position, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(songId, c.id, '', (last && last.p != null ? last.p + 1 : 0), now()).run();
      return json((await songsOut(DB, c.id)).find((s) => s.id === songId), 201);
    }

    case 'PATCH songs/:id': {
      const b = await body(request);
      const s = await getSong(DB, id);
      const title = 'title' in b ? String(b.title || '').trim().slice(0, 80) : s.title;
      const artist = 'artist' in b ? (String(b.artist || '').trim().slice(0, 60) || null) : s.artist;
      await DB.prepare('UPDATE songs SET title = ?, artist = ? WHERE id = ?').bind(title, artist, s.id).run();
      return json((await songsOut(DB, s.campaign)).find((x) => x.id === s.id));
    }

    case 'DELETE songs/:id': {
      const s = await getSong(DB, id);
      // The song's votes go with it, so those voters can vote again on another song
      await DB.batch([
        DB.prepare('DELETE FROM votes WHERE song = ?').bind(s.id),
        DB.prepare('DELETE FROM songs WHERE id = ?').bind(s.id),
      ]);
      await removeFiles(env, [s.cover_key, s.snippet_key]);
      return json({ ok: true });
    }

    case 'POST order': {
      const b = await body(request);
      const c = await getCampaign(DB, b.campaign);
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
      await DB.batch(ids.map((sid, i) => DB.prepare('UPDATE songs SET position = ? WHERE id = ? AND campaign = ?').bind(i, sid, c.id)));
      return json(await songsOut(DB, c.id));
    }

    // POST /api/admin/upload?song=…&kind=cover|snippet  (the file is the request body)
    case 'POST upload': {
      if (!env.FILES) throw new HttpError(500, 'Fillageret er ikke koblet på (KV-binding "FILES").');
      const s = await getSong(DB, q('song'));
      const kind = q('kind');
      const type = (request.headers.get('content-type') || '').split(';')[0].trim();
      if (kind === 'cover' && !/^image\/(jpeg|png|webp)$/.test(type)) throw new HttpError(400, 'Cover skal være et billede.');
      if (kind === 'snippet' && !/^audio\//.test(type)) throw new HttpError(400, 'Klippet skal være en lydfil.');
      if (kind !== 'cover' && kind !== 'snippet') throw new HttpError(400, 'Ukendt filtype.');
      const data = await request.arrayBuffer();
      if (!data.byteLength) throw new HttpError(400, 'Filen er tom.');
      if (data.byteLength > MAX_FILE) throw new HttpError(413, 'Filen er for stor (max 15 MB).');

      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type] ||
        ((type.split('/')[1] || 'mp3').replace(/[^a-z0-9]/g, '').replace('mpeg', 'mp3') || 'mp3');
      const key = `${s.campaign}/${s.id}/${Date.now()}-${kind}.${ext}`;
      await env.FILES.put(key, data, { metadata: { type } });
      const col = kind === 'cover' ? 'cover_key' : 'snippet_key';
      await DB.prepare(`UPDATE songs SET ${col} = ? WHERE id = ?`).bind(key, s.id).run();
      if (kind === 'snippet') {
        // Where the clip was cut from, so /management can show it
        const start = Math.max(0, Number(q('start')) || 0);
        const length = [15, 30, 45, 60].includes(Number(q('length'))) ? Number(q('length')) : null;
        await DB.prepare('UPDATE songs SET clip_start = ?, clip_length = ? WHERE id = ?').bind(start, length, s.id).run();
      }
      await removeFiles(env, [s[col]]);
      return json((await songsOut(DB, s.campaign)).find((x) => x.id === s.id));
    }

    // ---------- votes ----------
    case 'GET results': {
      const c = await getCampaign(DB, q('campaign'));
      const { votes, groups } = await votesWithGroups(DB, c.id);
      const songs = await DB.prepare('SELECT id, title FROM songs WHERE campaign = ? ORDER BY position, created_at').bind(c.id).all();
      return json(songs.results.map((s) => {
        const mine = votes.filter((v) => v.song === s.id);
        return {
          song: s.id,
          title: s.title,
          votes: mine.length,
          verified: mine.filter((v) => v.verified).length,
          stories: mine.filter((v) => v.story).length,
          people: new Set(mine.map((v) => groups.get(v.id))).size,
        };
      }));
    }

    case 'GET flags': {
      const c = await getCampaign(DB, q('campaign'));
      const { votes, groups, titles } = await votesWithGroups(DB, c.id);
      const why = flagReasons(votes);
      return json(votes
        .filter((v) => why.get(v.id).same_device || why.get(v.id).same_network)
        .map((v) => ({
          vote_id: v.id, grp: groups.get(v.id), handle: v.handle, title: titles.get(v.song) || '',
          verified: !!v.verified, cleared: !!v.cleared, ...why.get(v.id), created_at: v.created_at,
        }))
        .sort((a, b) => a.grp - b.grp || a.created_at.localeCompare(b.created_at)));
    }

    // Votes that shared on their story (claimed by the voter, or confirmed by you)
    // Everyone who reposted: pressed "Jeg har delt", or you added/confirmed them
    case 'GET stories': {
      const c = await getCampaign(DB, q('campaign'));
      // Votes marked before the reposts list existed
      await DB.prepare(
        `INSERT OR IGNORE INTO reposts (campaign, handle, claimed, confirmed, created_at, confirmed_at)
         SELECT campaign, handle, story_claimed, story, created_at, CASE WHEN story = 1 THEN created_at END
         FROM votes WHERE campaign = ? AND (story_claimed = 1 OR story = 1)`
      ).bind(c.id).run();
      const r = await DB.prepare(
        `SELECT r.handle, r.claimed, r.confirmed, r.created_at, r.confirmed_at,
           v.id AS vote_id, v.verified, s.title
         FROM reposts r
         LEFT JOIN votes v ON v.campaign = r.campaign AND v.handle = r.handle
         LEFT JOIN songs s ON s.id = v.song
         WHERE r.campaign = ? ORDER BY r.confirmed, r.created_at DESC`
      ).bind(c.id).all();
      return json(r.results.map((x) => ({
        handle: x.handle, claimed: !!x.claimed, story: !!x.confirmed, voted: x.vote_id != null, vote_id: x.vote_id,
        verified: !!x.verified, title: x.title || '', created_at: x.created_at, confirmed_at: x.confirmed_at,
      })));
    }

    // Confirm (or undo) a repost by username. Works before they vote too.
    case 'POST story': {
      const b = await body(request);
      const c = await getCampaign(DB, b.campaign);
      let h = b.handle != null ? normalizeHandle(b.handle) : null;
      if (!h && b.vote != null) {
        const v = await DB.prepare('SELECT handle FROM votes WHERE campaign = ? AND id = ?').bind(c.id, Number(b.vote)).first();
        h = v && v.handle;
      }
      if (!h) throw new HttpError(400, 'Skriv et Instagram-brugernavn.');
      const on = b.story ? 1 : 0;
      await DB.batch([
        DB.prepare(
          `INSERT INTO reposts (campaign, handle, confirmed, created_at, confirmed_at) VALUES (?1, ?2, ?3, ?4, CASE WHEN ?3 = 1 THEN ?4 END)
           ON CONFLICT (campaign, handle) DO UPDATE SET confirmed = ?3, confirmed_at = CASE WHEN ?3 = 1 THEN ?4 END`
        ).bind(c.id, h, on, now()),
        DB.prepare('UPDATE votes SET story = ? WHERE campaign = ? AND handle = ?').bind(on, c.id, h),
      ]);
      const v = await DB.prepare('SELECT id FROM votes WHERE campaign = ? AND handle = ?').bind(c.id, h).first();
      return json({ ok: true, handle: h, voted: !!v });
    }

    // Take someone off the reposters list (and their double chance)
    case 'DELETE story': {
      const c = await getCampaign(DB, q('campaign'));
      const h = normalizeHandle(q('handle'));
      if (!h) throw new HttpError(400, 'Ukendt brugernavn.');
      await DB.batch([
        DB.prepare('DELETE FROM reposts WHERE campaign = ? AND handle = ?').bind(c.id, h),
        DB.prepare('UPDATE votes SET story = 0, story_claimed = 0 WHERE campaign = ? AND handle = ?').bind(c.id, h),
      ]);
      return json({ ok: true });
    }

    case 'POST clear': {
      const b = await body(request);
      await DB.prepare('UPDATE votes SET cleared = ? WHERE id = ?').bind(b.cleared ? 1 : 0, Number(b.vote)).run();
      return json({ ok: true });
    }

    case 'POST verify': {
      const b = await body(request);
      const c = await getCampaign(DB, b.campaign);
      const list = new Set((Array.isArray(b.followers) ? b.followers : []).map(normalizeHandle).filter(Boolean));
      const votes = await DB.prepare('SELECT id, handle FROM votes WHERE campaign = ?').bind(c.id).all();
      const stmts = votes.results.map((v) => DB.prepare('UPDATE votes SET verified = ? WHERE id = ?').bind(list.has(v.handle) ? 1 : 0, v.id));
      for (let i = 0; i < stmts.length; i += 100) await DB.batch(stmts.slice(i, i + 100));
      return json({ verified: votes.results.filter((v) => list.has(v.handle)).length });
    }

    // Draws among people, not votes: each flagged group is one entry. Only followers count.
    // A confirmed story counts double: the group gets 2 lots, and that vote is twice as likely within it.
    case 'POST draw': {
      const b = await body(request);
      const c = await getCampaign(DB, b.campaign);
      const { votes, groups, titles } = await votesWithGroups(DB, c.id);
      const verified = votes.filter((v) => v.verified);
      const weight = new Map();
      for (const v of verified) weight.set(groups.get(v.id), Math.max(weight.get(groups.get(v.id)) || 0, v.story ? 2 : 1));
      if (!weight.size) return json({ winner: null });
      const grp = pickWeighted([...weight.entries()]);
      const inGroup = votes.filter((v) => groups.get(v.id) === grp);
      const w = pickWeighted(inGroup.filter((v) => v.verified).map((v) => [v, v.story ? 2 : 1]));
      const lots = [...weight.values()].reduce((a, n) => a + n, 0);
      return json({
        winner: {
          handle: w.handle, title: titles.get(w.song) || '', created_at: w.created_at, story: !!w.story,
          pool: weight.size, lots, group_handles: inGroup.map((v) => v.handle),
        },
      });
    }

    case 'GET entries': {
      const c = await getCampaign(DB, q('campaign'));
      const { votes, groups, titles } = await votesWithGroups(DB, c.id);
      const size = new Map();
      for (const g of groups.values()) size.set(g, (size.get(g) || 0) + 1);
      return json(votes.map((v) => ({
        handle: v.handle, title: titles.get(v.song) || '', verified: !!v.verified, story: !!v.story, story_claimed: !!v.story_claimed,
        flagged: size.get(groups.get(v.id)) > 1, grp: groups.get(v.id), created_at: v.created_at,
      })));
    }

    case 'GET signups': {
      const c = await getCampaign(DB, q('campaign'));
      const r = await DB.prepare('SELECT kind, contact, created_at, notified_at FROM notify WHERE campaign = ? ORDER BY id').bind(c.id).all();
      return json(r.results);
    }

    // "Tell me when the winner is drawn"
    case 'GET winner-signups': {
      const c = await getCampaign(DB, q('campaign'));
      const r = await DB.prepare('SELECT kind, contact, created_at, notified_at FROM winner_notify WHERE campaign = ? ORDER BY id').bind(c.id).all();
      return json(r.results);
    }
  }
  throw new HttpError(404, 'Ukendt adresse.');
});

// [[item, weight], …] → one item, chosen with chance weight / total
function pickWeighted(items) {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = randomInt(total);
  for (const [item, w] of items) {
    if (r < w) return item;
    r -= w;
  }
  return items[items.length - 1][0];
}

function campaignOut(c) {
  return {
    id: c.id, prize: c.prize, artist: c.artist, ends_at: c.ends_at, draw_at: c.draw_at, goal: c.goal, open: !!c.open,
    published: !!c.published, unlocked_at: c.unlocked_at,
  };
}

async function getSong(DB, id) {
  const s = id && (await DB.prepare('SELECT * FROM songs WHERE id = ?').bind(String(id)).first());
  if (!s) throw new HttpError(404, 'Sangen findes ikke.');
  return s;
}

async function songsOut(DB, campaign) {
  const r = await DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM votes v WHERE v.song = s.id) AS votes
     FROM songs s WHERE s.campaign = ? ORDER BY s.position, s.created_at`
  ).bind(campaign).all();
  return r.results.map((s) => ({
    id: s.id, title: s.title, artist: s.artist, position: s.position, votes: s.votes,
    clip_start: s.clip_start, clip_length: s.clip_length,
    cover_url: fileUrl(s.cover_key), snippet_url: fileUrl(s.snippet_key),
  }));
}

async function votesWithGroups(DB, campaign) {
  const [v, s] = await Promise.all([
    DB.prepare('SELECT * FROM votes WHERE campaign = ? ORDER BY id').bind(campaign).all(),
    DB.prepare('SELECT id, title FROM songs WHERE campaign = ?').bind(campaign).all(),
  ]);
  return { votes: v.results, groups: groupVotes(v.results), titles: new Map(s.results.map((x) => [x.id, x.title])) };
}

async function removeFiles(env, keys) {
  if (!env.FILES) return;
  await Promise.all(keys.filter(Boolean).map((k) => env.FILES.delete(k).catch(() => {})));
}
