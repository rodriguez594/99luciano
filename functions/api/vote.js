import { json, normalizeHandle, loadCampaign, isOpen, sha256, verifyTurnstile } from "../../lib/util.js";

// Max entries from one IP per campaign (shared wifi / households are fine, farms are not).
const MAX_PER_IP = 8;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }

  const campaign = await loadCampaign(context);
  if (!isOpen(campaign)) return json({ error: "The giveaway is closed." }, 403);

  const handle = normalizeHandle(body.handle);
  if (!handle) return json({ error: "That doesn't look like an Instagram username." }, 400);

  const song = campaign.songs.find((s) => s.id === body.song);
  if (!song) return json({ error: "Pick one of the songs." }, 400);

  const ip = request.headers.get("cf-connecting-ip") || "";
  if (!(await verifyTurnstile(env, body.turnstile, ip))) {
    return json({ error: "Couldn't verify you're human. Refresh and try again." }, 403);
  }

  const ipHash = ip ? await sha256(`${env.IP_SALT || ""}:${ip}`) : null;
  if (ipHash) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM votes WHERE campaign = ? AND ip_hash = ?")
      .bind(campaign.id, ipHash)
      .first();
    if (row && row.n >= MAX_PER_IP) return json({ error: "Too many entries from this network." }, 429);
  }

  const result = await env.DB.prepare(
    "INSERT INTO votes (campaign, handle, song, ip_hash) VALUES (?, ?, ?, ?) ON CONFLICT (campaign, handle) DO NOTHING"
  )
    .bind(campaign.id, handle, song.id, ipHash)
    .run();

  if (result.meta.changes === 0) {
    return json({ ok: true, alreadyVoted: true, handle }, 200);
  }
  return json({ ok: true, handle, song: song.id }, 201);
}
