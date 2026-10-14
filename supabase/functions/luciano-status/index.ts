// 99 LUCIANO giveaway status: Instagram follower count, the lock, and the "it's open" messages.
//
// The giveaway page calls this every 30 seconds. At most once per 30 seconds (for all
// visitors together) it asks Instagram for the follower count and stores it. Reaching the
// goal opens the giveaway for good. It then sends any messages that are due: email through
// Resend, SMS through GatewayAPI, each only if its key is set.
//
// Deploy:  supabase functions deploy luciano-status --no-verify-jwt
// Token:   put the Instagram access token in luciano_ig.token (see README). It's renewed here weekly.
// Optional secrets: RESEND_API_KEY + MAIL_FROM, GATEWAYAPI_TOKEN (+ SMS_SENDER), SITE_URL, ALLOWED_ORIGIN

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";
const SITE = (Deno.env.get("SITE_URL") || "https://99luciano.dk").replace(/\/$/, "");
const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
const MAIL_FROM = Deno.env.get("MAIL_FROM") || "99 LUCIANO <giveaway@99luciano.dk>";
const SMS_TOKEN = Deno.env.get("GATEWAYAPI_TOKEN");
const SMS_SENDER = Deno.env.get("SMS_SENDER") || "99LUCIANO";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Supabase errors are plain objects, so String() alone prints [object Object].
const why = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

const WEEK = 7 * 24 * 60 * 60 * 1000;
const LINK = `${SITE}/campaigns/`;
const SMS_TEXT = `99 LUCIANO: Giveawayen er åben! Hør klippene, stem på næste single og vær med i lodtrækningen: ${LINK}`;
const MAIL_SUBJECT = "Giveawayen er åben";
const MAIL_TEXT =
  `Hej!\n\nGiveawayen hos 99 LUCIANO er åben nu.\n\n` +
  `Hør klippene, stem på næste single, og vær med i lodtrækningen:\n${LINK}\n\n` +
  `Du får kun denne ene besked.\n\n99 LUCIANO`;

// Asks Instagram for the follower count (and renews the token once a week).
async function refreshFollowers() {
  const { data, error } = await db.rpc("luciano_claim_check");
  if (error) throw error;
  const row = data?.[0];
  if (!row) return false; // someone else checked in the last 30 seconds
  if (!row.token) return true;

  let token: string = row.token;
  if (!row.token_refreshed_at || Date.now() - Date.parse(row.token_refreshed_at) > WEEK) {
    const r = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
    );
    const body = await r.json().catch(() => ({}));
    if (r.ok && body.access_token) {
      token = body.access_token;
      await db.rpc("luciano_save_token", { p_token: token });
    } else {
      console.error("token refresh failed", r.status, JSON.stringify(body));
    }
  }

  const r = await fetch(`https://graph.instagram.com/me?fields=followers_count&access_token=${encodeURIComponent(token)}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok || typeof body.followers_count !== "number") {
    console.error("instagram failed", r.status, JSON.stringify(body));
    return true;
  }
  await db.rpc("luciano_set_followers", { p_followers: body.followers_count });
  return true;
}

async function sendEmail(to: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: MAIL_SUBJECT, text: MAIL_TEXT }),
  });
  if (!r.ok) throw new Error(`resend ${r.status} ${await r.text()}`);
}

async function sendSms(msisdn: string) {
  const r = await fetch("https://gatewayapi.com/rest/mtsms", {
    method: "POST",
    headers: { Authorization: `Token ${SMS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sender: SMS_SENDER, message: SMS_TEXT, recipients: [{ msisdn: Number(msisdn) }] }),
  });
  if (!r.ok) throw new Error(`gatewayapi ${r.status} ${await r.text()}`);
}

// Sends the "it's open" messages that are due. Each one is claimed first, so it goes out once.
async function sendDue() {
  const kinds = [RESEND_KEY && "email", SMS_TOKEN && "sms"].filter(Boolean);
  if (!kinds.length) return;
  const { data, error } = await db.rpc("luciano_claim_notifications", { p_kinds: kinds, p_limit: 50 });
  if (error) throw error;
  for (const n of data || []) {
    try {
      if (n.kind === "email") await sendEmail(n.contact);
      else await sendSms(n.contact);
    } catch (e) {
      console.error("send failed", n.id, why(e));
      await db.rpc("luciano_unclaim_notification", { p_id: n.id });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const campaign = new URL(req.url).searchParams.get("campaign") || "";

  try {
    const checked = await refreshFollowers();
    if (checked) {
      const work = sendDue().catch((e) => console.error("sendDue", why(e)));
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
      else await work;
    }
  } catch (e) {
    console.error("refresh", why(e));
  }

  const { data, error } = await db.rpc("luciano_status", { p_campaign: campaign });
  if (error || !data) return json({ error: "not_found" }, 404);
  return json(data);
});
