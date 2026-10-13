import { json, normalizeHandle, loadCampaign, isAdmin } from "../../../lib/util.js";

// All admin routes require `Authorization: Bearer <ADMIN_TOKEN>`.
//   GET  /api/admin/results          vote tallies
//   POST /api/admin/verify           { followers: [...] } -> marks matching entries as verified
//   POST /api/admin/draw             picks a random verified entry
//   GET  /api/admin/export           CSV of all entries
export async function onRequest(context) {
  const { request, env, params } = context;
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401);

  const campaign = await loadCampaign(context);
  const route = `${request.method} ${(params.path || []).join("/")}`;

  switch (route) {
    case "GET results": return results(env, campaign);
    case "POST verify": return verify(env, campaign, request);
    case "POST draw": return draw(env, campaign);
    case "GET export": return exportCsv(env, campaign);
    default: return json({ error: "Not found" }, 404);
  }
}

async function results(env, campaign) {
  const { results: rows } = await env.DB.prepare(
    "SELECT song, COUNT(*) AS votes, SUM(verified) AS verified FROM votes WHERE campaign = ? GROUP BY song"
  )
    .bind(campaign.id)
    .all();
  const bySong = campaign.songs.map((s) => {
    const r = rows.find((x) => x.song === s.id) || {};
    return { id: s.id, title: s.title, votes: r.votes || 0, verified: r.verified || 0 };
  });
  return json({
    campaign: campaign.id,
    total: bySong.reduce((a, s) => a + s.votes, 0),
    verified: bySong.reduce((a, s) => a + s.verified, 0),
    bySong,
  });
}

async function verify(env, campaign, request) {
  const body = await request.json().catch(() => ({}));
  const handles = [...new Set((body.followers || []).map(normalizeHandle).filter(Boolean))];
  if (!handles.length) return json({ error: "No valid usernames in the list." }, 400);

  // Reset, then mark everyone in the current follower list (so unfollows drop out).
  const stmts = [env.DB.prepare("UPDATE votes SET verified = 0 WHERE campaign = ?").bind(campaign.id)];
  for (let i = 0; i < handles.length; i += 90) {
    const chunk = handles.slice(i, i + 90);
    stmts.push(
      env.DB.prepare(
        `UPDATE votes SET verified = 1 WHERE campaign = ? AND handle IN (${chunk.map(() => "?").join(",")})`
      ).bind(campaign.id, ...chunk)
    );
  }
  await env.DB.batch(stmts);
  return results(env, campaign);
}

async function draw(env, campaign) {
  const { results: rows } = await env.DB.prepare(
    "SELECT handle, song, created_at FROM votes WHERE campaign = ? AND verified = 1"
  )
    .bind(campaign.id)
    .all();
  if (!rows.length) return json({ error: "No verified entries yet. Upload your follower list first." }, 400);
  const pick = crypto.getRandomValues(new Uint32Array(1))[0] % rows.length;
  return json({ winner: rows[pick], pool: rows.length });
}

async function exportCsv(env, campaign) {
  const { results: rows } = await env.DB.prepare(
    "SELECT handle, song, verified, created_at FROM votes WHERE campaign = ? ORDER BY id"
  )
    .bind(campaign.id)
    .all();
  const csv = ["handle,song,verified,created_at", ...rows.map((r) => `${r.handle},${r.song},${r.verified},${r.created_at}`)].join("\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${campaign.id}.csv"`,
      "cache-control": "no-store",
    },
  });
}
