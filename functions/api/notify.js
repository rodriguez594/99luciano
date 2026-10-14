// POST /api/notify { campaign, contact }  Sign up for a message when the giveaway opens.
// Takes an email or a phone number (8 digits are read as Danish).
// Returns { result: 'ok' | 'already' | 'open' | 'bad_contact' }.
import { getDb, getCampaign, ipHash, json, body, handle, now } from '../../lib/db.js';

export function normalizeContact(input) {
  let v = String(input || '').trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(v) && v.length <= 200) return { kind: 'email', contact: v };
  v = v.replace(/[\s\-().]/g, '').replace(/^(\+|00)/, '');
  if (/^[0-9]{8}$/.test(v)) v = '45' + v;
  if (!/^[1-9][0-9]{7,14}$/.test(v)) return null;
  return { kind: 'sms', contact: v };
}

export const onRequestPost = handle(async ({ request, env }) => {
  const DB = await getDb(env);
  const b = await body(request);
  const c = await getCampaign(DB, b.campaign);
  if (c.unlocked_at) return json({ result: 'open' });

  const n = normalizeContact(b.contact);
  if (!n) return json({ result: 'bad_contact' });

  const res = await DB.prepare(
    `INSERT INTO notify (campaign, kind, contact, ip_hash, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (campaign, contact) DO NOTHING`
  ).bind(c.id, n.kind, n.contact, await ipHash(request, env, c.id), now()).run();
  return json({ result: res.meta.changes ? 'ok' : 'already' });
});
