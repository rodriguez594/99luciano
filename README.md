# 99luciano.dk

Official site for 99 Luciano. Right now it's a homepage plus a giveaway at **/campaigns**:

1. Follow @99luciano on Instagram and enter your username
2. Listen to the 20–30 s snippets, then vote for the next release (one vote per username)
3. You're in

Built as plain HTML/CSS/JS on **Cloudflare Pages**. Votes are stored in **Cloudflare D1** (a free SQLite database).
There's no framework and no build step.

```
public/                     static site (what visitors see)
  index.html                homepage
  campaigns/index.html      giveaway flow (mobile-first)
  campaigns/campaign.json   ← edit this: songs, prize, end date, open/closed
  campaigns/snippets/       ← put the snippet MP3s here
  campaigns/admin.html      results, follower check, winner draw
  assets/logo.svg           ← replace with the real 99 logo
functions/api/              backend (Cloudflare Pages Functions)
  vote.js                   POST /api/vote
  admin/[[path]].js         /api/admin/* (token protected)
schema.sql                  database table
```

## Why Cloudflare (not GitHub Pages)

GitHub Pages can only serve static files. The giveaway has to **store votes and enforce one vote per person**,
so it needs a backend. Cloudflare Pages gives you static hosting, serverless functions and a database in one place.
It's free at this scale and has fast CDN delivery for the audio snippets. It also handles DNS for the .dk domain.

## Setup (one time, ~15 min)

1. **Cloudflare account**: sign up at dash.cloudflare.com.
2. **Point the domain to Cloudflare**: in Cloudflare choose *Add a domain* → `99luciano.dk` → Free plan.
   Cloudflare shows two nameservers. Log in where you bought the domain (e.g. Simply, One.com, or
   via Punktum dk) and replace the nameservers with Cloudflare's. This can take a few hours to take effect.
3. **Create the database** (from this folder, needs Node 18+):
   ```sh
   npm install
   npx wrangler login
   npx wrangler d1 create 99luciano        # copy the database_id into wrangler.toml
   npm run db:init                          # creates the votes table
   ```
4. **Deploy**:
   ```sh
   npm run deploy                           # first time: creates the "99luciano" Pages project
   ```
   Alternatively, in the dashboard go to *Workers & Pages → Create → Pages → Connect to Git*, pick this repo,
   set the build output directory to `public` and leave the build command empty. After that, every push to `main` deploys automatically.
   If you use Git deploys, check under *Settings → Bindings* that the D1 database is bound as `DB`.
5. **Secrets**: in the Pages project go to *Settings → Variables and Secrets* and add these as encrypted values:
   - `ADMIN_TOKEN`: a long random password for the admin page
   - `IP_SALT`: any random string
6. **Custom domain**: go to Pages project → *Custom domains* → add `99luciano.dk` (and `www.99luciano.dk`).

## Running a giveaway

- Edit `public/campaigns/campaign.json`:
  - `songs`: id, title and snippet path for each track (2–5 work best on a phone)
  - `prize`, `headline`, `endsAt` (UTC), `announce`
  - `open: false` closes voting immediately (the server enforces it too)
  - `id`: change it for each new giveaway so votes start fresh
- Add the MP3 snippets to `public/campaigns/snippets/`. Use 128–192 kbps so they load fast on mobile data.
- Deploy.

### Checking followers and drawing a winner

Instagram's API does not let a website check whether a given user follows you. Unofficial "follow checker" bots
scrape Instagram and can get your account restricted. This site uses a safe approach instead:

1. People enter their username when they vote.
2. When the giveaway closes, request your data from Instagram: *Settings → Accounts Centre → Your information
   and permissions → Download your information → Followers and following → JSON format*.
3. Open **99luciano.dk/campaigns/admin**, enter your `ADMIN_TOKEN` and upload `followers_1.json`.
   Each entry is marked as verified or not verified.
4. Press **Draw winner**. It picks a random *verified* entry, so only real followers can win.
   The admin page shows each song's vote count with verified followers counted separately.

You can re-run step 3 at any time with a fresh export. Anyone who unfollowed drops out.

## Anti-spam

- Each Instagram username can vote once (enforced by the database).
- Each network/IP is capped at 8 entries per giveaway.
- Fake usernames can't win because the draw only uses verified followers.
- Optional: **Cloudflare Turnstile** (a free, mostly invisible CAPTCHA). Create a widget in the dashboard,
  put the site key in `campaign.json` → `turnstileSiteKey` and the secret in a `TURNSTILE_SECRET` variable.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars
npm run db:init:local
npm run dev            # http://localhost:8788
```
