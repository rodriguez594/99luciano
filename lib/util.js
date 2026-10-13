export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

// Instagram usernames: 1–30 chars of letters, digits, "." and "_".
// Accepts "@name", "name", or a pasted profile URL.
export function normalizeHandle(input) {
  if (typeof input !== "string") return null;
  let h = input.trim().toLowerCase();
  const url = h.match(/instagram\.com\/([^/?#]+)/);
  if (url) h = url[1];
  h = h.replace(/^@+/, "");
  if (!/^[a-z0-9._]{1,30}$/.test(h) || h.startsWith(".") || h.endsWith(".") || h.includes("..")) return null;
  return h;
}

export async function loadCampaign(context) {
  const url = new URL("/campaigns/campaign.json", context.request.url);
  const res = await context.env.ASSETS.fetch(url);
  if (!res.ok) throw new Error("campaign.json missing");
  return res.json();
}

export function isOpen(campaign, now = Date.now()) {
  if (!campaign.open) return false;
  if (campaign.endsAt && now > Date.parse(campaign.endsAt)) return false;
  return true;
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAdmin(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  return Boolean(env.ADMIN_TOKEN) && timingSafeEqual(token, env.ADMIN_TOKEN);
}

export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true; // Turnstile not configured
  if (!token) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const data = await res.json();
  return data.success === true;
}
