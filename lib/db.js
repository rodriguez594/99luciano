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
    published   INTEGER NOT NULL DEFAULT 0, -- 0 = a draft only /management sees
    draw_at     TEXT,                       -- when the winner is drawn on Instagram Live (shown on /vote)
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
    clip_start  REAL,                       -- where in the full song the snippet was cut from (seconds)
    clip_length INTEGER,                    -- snippet length: 15, 30, 45 or 60 seconds
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
    story_claimed INTEGER NOT NULL DEFAULT 0, -- the voter says they shared the vote on their Instagram story
    story      INTEGER NOT NULL DEFAULT 0,  -- you saw the story: their entry counts double in the draw
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
  // Who reposted the vote on their Instagram story. A confirmed repost gives the vote with the same
  // username a double chance (votes.story), also when they vote after you confirmed it.
  `CREATE TABLE IF NOT EXISTS reposts (
    campaign     TEXT NOT NULL,
    handle       TEXT NOT NULL,             -- Instagram username, lowercase, no @
    claimed      INTEGER NOT NULL DEFAULT 0, -- they pressed "Jeg har delt"
    confirmed    INTEGER NOT NULL DEFAULT 0, -- you saw the story
    created_at   TEXT NOT NULL,
    confirmed_at TEXT,
    PRIMARY KEY (campaign, handle)
  )`,
  // "Tell me when the winner is drawn". Only saved for now, until email/SMS sending is connected.
  `CREATE TABLE IF NOT EXISTS winner_notify (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign    TEXT NOT NULL,
    kind        TEXT NOT NULL,              -- 'email' or 'sms'
    contact     TEXT NOT NULL,              -- lowercase email, or phone digits with country code
    ip_hash     TEXT,
    created_at  TEXT NOT NULL,
    notified_at TEXT,
    UNIQUE (campaign, contact)
  )`,

  // Projects at /management/projects: goals, and a tracker of songs, their versions and album art.
  // Only a version's name, label and date are kept; the audio itself is never uploaded.
  `CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'active', -- 'active' or 'done'
    due        TEXT,                          -- ISO date; empty = no deadline
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS goals (
    id         TEXT PRIMARY KEY,
    project    TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    kind       TEXT NOT NULL DEFAULT 'manual', -- 'songs' | 'versions' | 'art' count themselves; 'manual' uses current
    target     INTEGER NOT NULL DEFAULT 1,
    current    INTEGER NOT NULL DEFAULT 0,
    due        TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS goals_project ON goals (project)`,
  `CREATE TABLE IF NOT EXISTS tracks (
    id         TEXT PRIMARY KEY,
    project    TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    art_id     TEXT,                          -- the album art shown; older ones are kept
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS tracks_project ON tracks (project)`,
  `CREATE TABLE IF NOT EXISTS track_versions (
    id        TEXT PRIMARY KEY,
    track     TEXT NOT NULL,
    label     TEXT NOT NULL,                  -- e.g. v3, Master, Demo
    file_name TEXT NOT NULL DEFAULT '',
    file_type TEXT,
    file_size INTEGER,
    file_date TEXT NOT NULL,                  -- from the file name, or when the file was last saved
    added_at  TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS track_versions_track ON track_versions (track)`,
  `CREATE TABLE IF NOT EXISTS track_art (
    id       TEXT PRIMARY KEY,
    track    TEXT NOT NULL,
    file_key TEXT NOT NULL,                   -- key in the FILES store
    added_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS track_art_track ON track_art (track)`,
];

// Columns added after the first version of a table (CREATE TABLE IF NOT EXISTS skips existing tables)
// Each can carry a one-off statement to run right after the column is added.
const COLUMNS = [
  ['campaigns', 'published', 'INTEGER NOT NULL DEFAULT 0'],
  ['votes', 'story_claimed', 'INTEGER NOT NULL DEFAULT 0'],
  ['votes', 'story', 'INTEGER NOT NULL DEFAULT 0'],
  ['campaigns', 'draw_at', 'TEXT', `UPDATE campaigns SET draw_at = '2026-10-22T22:00:00.000Z' WHERE id = 'next-single-2026'`],
];

// Starting draw time for a giveaway, changeable at /management/vote.
// The first one: Instagram Live, Friday 23 October 2026 at 00:00 Danish time.
const FIRST_DRAW = { 'next-single-2026': '2026-10-22T22:00:00.000Z' };

async function migrate(DB) {
  for (const [table, col, type, after] of COLUMNS) {
    const info = await DB.prepare(`PRAGMA table_info(${table})`).all();
    if (info.results.some((c) => c.name === col)) continue;
    const added = await DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run().then(() => true, (e) => {
      if (!/duplicate column/i.test(String(e && e.message))) throw e;
      return false; // another request added it at the same moment
    });
    if (added && after) await DB.prepare(after).run();
  }
}

let ready = null;

export async function getDb(env) {
  if (!env.DB) throw new HttpError(500, 'Databasen er ikke koblet på (D1-binding "DB").');
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).then(() => migrate(env.DB)).catch((e) => {
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

// Reads the giveaway, creating it with the defaults (an unpublished draft, no end date) the first time.
export async function getCampaign(DB, id) {
  if (!isCampaignId(id)) throw new HttpError(404, 'Ukendt giveaway.');
  let c = await DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!c) {
    await DB.prepare('INSERT OR IGNORE INTO campaigns (id, unlocked_at, draw_at) VALUES (?, ?, ?)').bind(id, now(), FIRST_DRAW[id] || null).run();
    c = await DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  }
  return c;
}

// Closed to visitors: not published yet, closed by hand, or past the end date
export function isClosed(c) {
  return !c.published || !c.open || (c.ends_at && Date.now() > Date.parse(c.ends_at));
}

export const fileUrl = (key) => (key ? '/files/' + key.split('/').map(encodeURIComponent).join('/') : null);
