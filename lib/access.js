// /management login through Cloudflare Access. Access sits in front of /management and
// /api/admin and asks for a one-time code by email. Every admin request carries a token
// signed by Cloudflare; this checks the signature, the audience and the expiry, so the
// admin API is closed unless Access is set up (ACCESS_TEAM_DOMAIN + ACCESS_AUD).
import { HttpError } from './db.js';

let certs = null;
let certsAt = 0;

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

// The Access team, e.g. https://99luciano.cloudflareaccess.com. ACCESS_TEAM_DOMAIN may be the
// team name ("99luciano"), the full team domain, or left out; then the team named in the
// login token is used (the token's audience must still match ACCESS_AUD exactly).
const TEAM_RE = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/;
function teamFromEnv(env) {
  let t = String(env.ACCESS_TEAM_DOMAIN || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!t) return null;
  if (!t.includes('.')) t += '.cloudflareaccess.com';
  t = 'https://' + t;
  return TEAM_RE.test(t) ? t : 'invalid';
}

async function getCerts(team) {
  if (!certs || certs.team !== team || Date.now() - certsAt > 3600_000) {
    const res = await fetch(team + '/cdn-cgi/access/certs').catch(() => null);
    if (!res || !res.ok) {
      throw new HttpError(503, 'Kunne ikke hente Cloudflare Access-nøgler fra ' + team +
        '. Tjek ACCESS_TEAM_DOMAIN: den skal være dit team-navn (Zero Trust → Settings → Team name), fx 99luciano.');
    }
    certs = { team, keys: (await res.json()).keys || [] };
    certsAt = Date.now();
  }
  return certs.keys;
}

export async function adminEmail(request, env) {
  // Local development only: `wrangler pages dev` on localhost with DEV_ADMIN_EMAIL in .dev.vars
  const host = new URL(request.url).hostname;
  if (env.DEV_ADMIN_EMAIL && (host === 'localhost' || host === '127.0.0.1')) return env.DEV_ADMIN_EMAIL.toLowerCase();

  if (!env.ACCESS_AUD) throw new HttpError(401, 'setup');
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) throw new HttpError(401, 'login');

  const [h, p, s] = token.split('.');
  let header, payload;
  try {
    header = decodeJson(h);
    payload = decodeJson(p);
  } catch {
    throw new HttpError(401, 'login');
  }
  const issuer = String(payload.iss || '');
  if (!TEAM_RE.test(issuer)) throw new HttpError(401, 'login');
  const configured = teamFromEnv(env);
  if (configured && configured !== 'invalid' && configured !== issuer) {
    throw new HttpError(503, 'ACCESS_TEAM_DOMAIN passer ikke med dit Cloudflare Access-team. Sæt den til ' +
      issuer.replace('https://', '').replace('.cloudflareaccess.com', '') + ' (eller slet den) og deploy igen.');
  }
  const team = issuer;

  let jwk = (await getCerts(team)).find((k) => k.kid === header.kid);
  if (!jwk) {
    certs = null; // keys rotated: fetch them again once
    jwk = (await getCerts(team)).find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new HttpError(401, 'login');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(h + '.' + p));
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!ok || !aud.includes(String(env.ACCESS_AUD).trim()) || !(payload.exp * 1000 > Date.now())) {
    throw new HttpError(401, 'login');
  }
  const email = String(payload.email || '').toLowerCase();
  // Optional extra list on top of the Access policy
  const allowed = String(env.ADMIN_EMAILS || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (!email || (allowed.length && !allowed.includes(email))) throw new HttpError(403, 'denied');
  return email;
}
