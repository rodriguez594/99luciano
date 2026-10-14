// Background work done while answering /api/status, at most every 30 seconds for all
// visitors together: refresh the Instagram follower count (only if a token is saved) and
// send the "it's open" messages that are due (email via Resend, SMS via GatewayAPI, each
// only if its key is set). All optional; the site works without any of it.
import { now } from './db.js';

const WEEK = 7 * 24 * 3600 * 1000;

export async function backgroundWork(DB, env, origin) {
  // Claim the check, so only one request does it per 30 seconds
  const cutoff = new Date(Date.now() - 30_000).toISOString();
  const claim = await DB.prepare('UPDATE ig SET checked_at = ? WHERE id = 1 AND (checked_at IS NULL OR checked_at < ?)')
    .bind(now(), cutoff).run();
  if (!claim.meta.changes) return;

  await refreshFollowers(DB).catch((e) => console.error('instagram', String(e)));
  await sendDue(DB, env, origin).catch((e) => console.error('notify', String(e)));
}

async function refreshFollowers(DB) {
  const row = await DB.prepare('SELECT token, token_refreshed_at FROM ig WHERE id = 1').first();
  if (!row || !row.token) return;
  let token = row.token;

  // Long-lived Instagram tokens last 60 days; renew weekly so it never runs out
  if (!row.token_refreshed_at || Date.now() - Date.parse(row.token_refreshed_at) > WEEK) {
    const r = await fetch('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(token));
    const b = await r.json().catch(() => ({}));
    if (r.ok && b.access_token) {
      token = b.access_token;
      await DB.prepare('UPDATE ig SET token = ?, token_refreshed_at = ? WHERE id = 1').bind(token, now()).run();
    } else {
      console.error('token refresh failed', r.status, JSON.stringify(b));
    }
  }

  const r = await fetch('https://graph.instagram.com/me?fields=followers_count&access_token=' + encodeURIComponent(token));
  const b = await r.json().catch(() => ({}));
  if (!r.ok || typeof b.followers_count !== 'number') {
    console.error('instagram failed', r.status, JSON.stringify(b));
    return;
  }
  await setFollowers(DB, b.followers_count);
}

// Stores a follower count and opens every giveaway whose goal it reaches.
export async function setFollowers(DB, n) {
  n = Math.max(0, Math.floor(n));
  await DB.batch([
    DB.prepare('UPDATE ig SET followers = ? WHERE id = 1').bind(n),
    DB.prepare('UPDATE campaigns SET unlocked_at = ? WHERE unlocked_at IS NULL AND goal <= ?').bind(now(), n),
  ]);
}

async function sendDue(DB, env, origin) {
  const kinds = [env.RESEND_API_KEY && 'email', env.GATEWAYAPI_TOKEN && 'sms'].filter(Boolean);
  if (!kinds.length) return;
  const due = await DB.prepare(
    `SELECT n.id, n.kind, n.contact FROM notify n JOIN campaigns c ON c.id = n.campaign
     WHERE c.unlocked_at IS NOT NULL AND n.notified_at IS NULL AND n.tries < 3
       AND n.kind IN (${kinds.map(() => '?').join(',')})
     ORDER BY n.id LIMIT 50`
  ).bind(...kinds).all();

  const link = (env.SITE_URL || origin).replace(/\/$/, '') + '/';
  for (const n of due.results) {
    // Claim it first, so it's sent once even if two requests overlap
    const claim = await DB.prepare('UPDATE notify SET notified_at = ?, tries = tries + 1 WHERE id = ? AND notified_at IS NULL')
      .bind(now(), n.id).run();
    if (!claim.meta.changes) continue;
    try {
      if (n.kind === 'email') await sendEmail(env, n.contact, link);
      else await sendSms(env, n.contact, link);
    } catch (e) {
      console.error('send failed', n.id, String(e));
      await DB.prepare('UPDATE notify SET notified_at = NULL WHERE id = ?').bind(n.id).run();
    }
  }
}

async function sendEmail(env, to, link) {
  const text =
    'Hej!\n\nGiveawayen hos 99 LUCIANO er åben nu.\n\n' +
    'Hør klippene, stem på næste single, og vær med i lodtrækningen:\n' + link + '\n\n' +
    'Du får kun denne ene besked.\n\n99 LUCIANO';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || '99 LUCIANO <giveaway@99luciano.dk>', to: [to], subject: 'Giveawayen er åben', text }),
  });
  if (!r.ok) throw new Error('resend ' + r.status + ' ' + (await r.text()));
}

async function sendSms(env, msisdn, link) {
  const r = await fetch('https://gatewayapi.com/rest/mtsms', {
    method: 'POST',
    headers: { Authorization: 'Token ' + env.GATEWAYAPI_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: env.SMS_SENDER || '99LUCIANO',
      message: '99 LUCIANO: Giveawayen er åben! Hør klippene, stem på næste single og vær med i lodtrækningen: ' + link,
      recipients: [{ msisdn: Number(msisdn) }],
    }),
  });
  if (!r.ok) throw new Error('gatewayapi ' + r.status + ' ' + (await r.text()));
}
