CREATE TABLE IF NOT EXISTS votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign   TEXT    NOT NULL,
  handle     TEXT    NOT NULL,           -- normalized Instagram username
  song       TEXT    NOT NULL,
  ip_hash    TEXT,
  verified   INTEGER NOT NULL DEFAULT 0, -- 1 = confirmed follower
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (campaign, handle)
);

CREATE INDEX IF NOT EXISTS votes_campaign_ip ON votes (campaign, ip_hash);
