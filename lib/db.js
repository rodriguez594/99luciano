// D1 database (binding DB) and file store (KV binding FILES).
// The tables are created automatically the first time the site talks to the database,
// so there is no SQL to run by hand.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS campaigns (
    id          TEXT PRIMARY KEY,
    prize       TEXT NOT NULL DEFAULT 'Gavekort på 150 kr. til hvad du vil',
    artist      TEXT NOT NULL DEFAULT '99 LUCIANO',
    ends_at     TEXT,                       -- ISO time; empty = no end date
    open        INTEGER NOT NULL DEFAULT 1, -- 0 closes voting right away
    goal        INTEGER NOT NULL DEFAULT 150, -- Instagram followers needed before voting opens
    unlocked_at TEXT                        -- set when voting opened; stays open after that
  )`,
  `CREATE TABLE IF NOT EXISTS songs (
    id          TEXT PRIMARY KEY,
    campaign    TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    artist      TEXT,                       -- empty = the campaign's artist
    cover_key   TEXT,                       -- key in the FILES store
    snippet_key TEXT,                       -- songs without a snippet are hidden on the page
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS songs_campaign ON songs (campaign, position)`,
  `CREATE TABLE IF NOT EXISTS votes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign   TEXT NOT NULL,
    handle     TEXT NOT NULL,               -- Instagram username, lowercase, no @
    song       TEXT NOT NULL,
    ip_hash    TEXT,
    device     TEXT,                        -- hash of the random id the browser keeps
    cleared    INTEGER NOT NULL DEFAULT 0,  -- you decided this flagged vote is its own person
    verified   INTEGER NOT NULL DEFAULT 0,  -- found in the follower list
    created_at TEXT NOT NULL,
    UNIQUE (campaign, handle)
  )`,
  `CREATE TABLE IF NOT EXISTS notify (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign    TEXT NOT NULL,
    kind        TEXT NOT NULL,              -- 'email' or 'sms'
    contact     TEXT NOT NULL,              -- lowercase email, or phone digits with country code
    ip_hash     TEXT,
    created_at  TEXT NOT NULL,
    notified_at TEXT,
    tries       INTEGER NOT NULL DEFAULT 0,
    UNIQUE (campaign, contact)
  )`,
  `CREATE TABLE IF NOT EXISTS ig (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),
    followers          INTEGER NOT NULL DEFAULT 0,
    checked_at         TEXT,
    token              TEXT,
    token_refreshed_at TEXT
  )`,
  `INSERT OR IGNORE INTO ig (id, followers) VALUES (1, 0)`,
];

let ready = null;

export async function getDb(env) {
  if (!env.DB) throw new HttpError(500, 'Databasen er ikke koblet på (D1-binding "DB").');
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => {
      ready = null;
      throw e;
    });
  }
  await ready;
  return env.DB;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// Wraps a handler so thrown HttpErrors become JSON error responses.
export function handle(fn) {
  return async (context) => {
    try {
      return await fn(context);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e && e.stack ? e.stack : String(e));
      return json({ error: 'Noget gik galt på serveren.' }, 500);
    }
  };
}

export async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Ugyldig forespørgsel.');
  }
}

export const now = () => new Date().toISOString();

export function isCampaignId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id);
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Hash of the visitor's IP (the IP itself is never stored), used to flag shared networks.
export async function ipHash(request, env, campaign) {
  const ip = request.headers.get('cf-connecting-ip');
  return ip ? (await sha256(`${env.IP_SALT || '99luciano'}:${campaign}:${ip}`)).slice(0, 32) : null;
}

// Reads the giveaway, creating it with the defaults (open, no end date) the first time.
export async function getCampaign(DB, id) {
  if (!isCampaignId(id)) throw new HttpError(404, 'Ukendt giveaway.');
  let c = await DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!c) {
    await DB.prepare('INSERT OR IGNORE INTO campaigns (id, unlocked_at) VALUES (?, ?)').bind(id, now()).run();
    c = await DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  }
  return c;
}

export function isClosed(c) {
  return !c.open || (c.ends_at && Date.now() > Date.parse(c.ends_at));
}

export const fileUrl = (key) => (key ? '/files/' + key.split('/').map(encodeURIComponent).join('/') : null);
