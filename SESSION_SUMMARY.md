# 99 LUCIANO (99luciano.dk) Session Summary — 14 October 2026

Paste this into a new Claude chat to continue exactly where we left off.

## What This Project Is

The artist website for **99 LUCIANO** (Instagram `@99luciano0`, TikTok `@99luciano0`, part of the "99" family with 99MGMT, 99ENT and 99WRLDWIDE). The homepage is a minimal portfolio. **99luciano.dk/vote** runs a giveaway where fans listen to 15–60 second snippets of unreleased songs, vote for the next single (one vote each), and get entered in a draw for a **150 kr. gift card**. **/management** is a login-protected admin page for songs, settings, votes, flags and the winner draw.

- **Repo:** `rodriguez594/99luciano` (GitHub), local path `/home/user/99luciano`
- **Branches:** work happens on `claude/99luciano-giveaway-site-ij3yeu`, and every change is ALSO pushed to `main`. The user approved this, and Cloudflare deploys `main`. Push with `git push origin HEAD:main` plus `git push origin claude/99luciano-giveaway-site-ij3yeu`.
- **Stack:** plain HTML/CSS/JS with no build step, on **Cloudflare Pages** with Pages Functions (`functions/`), **D1** (database, binding `DB`), **KV** (uploaded files, binding `FILES`) and **Cloudflare Access** (login for /management). No framework.
- **Language/style:** all site text is in **Danish**. The look is white on black, **Montserrat bold uppercase** everywhere, **no italics**. The only serif is the "99" logo mark (`assets/mark.png`, a white Bodoni-style 99 on transparent, taken from the 99wrldwide repo).
- **User:** writes in English and Danish and is not very technical. Give click-by-click dashboard steps. Keep answers short.
- **Hosting rule the user agreed:** projects that need a database go on Cloudflare (Pages + D1); showcase-only sites stay on GitHub Pages.

**SECURITY:** `.dev.vars` (gitignored, local only) holds `DEV_ADMIN_EMAIL`, which bypasses login on localhost only. Never commit it. There are no other secrets in the repo; `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `RESEND_API_KEY` and `GATEWAYAPI_TOKEN` live in Cloudflare Pages variables. Don't put the user's email in the repo, which is public.

## Current State

### Site structure (live URLs)
- `/`: the portfolio. Big 99 mark, "LUCIANO", white rounded app icons (Instagram, TikTok; Spotify is hidden until a URL is set). While a vote is open (not closed, unlocked, and has songs) it also shows a white CTA: **"Stem på min næste single / og vind et gavekort på 150 kr."**, linking to `/vote/`. The amount is parsed from the prize text.
- `/vote/`: the giveaway. Headline "Stem på min næste single.", a white **gift card** visual (GAVEKORT / 150 KR. / TIL HVAD DU VIL, parsed from the prize), and "Afstemning slutter <weekday date kl. time>". Then the steps:
  1. Follow on Instagram.
  2. Instagram username.
  3. Listen & vote.

  Songs are sleeves, **3 per row**. Tapping one makes it grow (flex-grow 2.7) while the other two shrink and fade, and its record slides out (`translateX(68%)`) and spins, with the album art on the label. A now-playing bar sits under the grid. The submit bar is sticky. When the vote is closed: "Afstemningen er slut." plus the app icons.
- `/management/`: protected by Cloudflare Access. Sections: Giveaway settings (prize, artist, end date, follower goal, "Luk for stemmer nu", manual follower count, "Åbn giveaway nu"), Sange (song editor), Stemmer (results + CSV), Flag (flagged groups), Besked (notification signups + CSV), Vinder (follower check + draw).
- Redirects (`public/_redirects`): `/campaigns`, `/campaign`, `/giveaway`, `/stem` → `/vote/`; `/admin` → `/management/`.

### Giveaway rules and behaviour
- **Campaign id:** `next-single-2026` (in `public/giveaway/config.js`). The campaign row is auto-created on first access with defaults: open, `unlocked_at = now`, no end date, prize "Gavekort på 150 kr. til hvad du vil", artist "99 LUCIANO", goal 150.
- **Follower lock (150 followers):** built, but OFF in practice because the account already has 150+ followers and new campaigns start unlocked. The locked view shows a live follower count (polled every 30 s), an email/phone signup for an "it's open" message, and a share-profile button.
- **No blocking, only flagging.** The user explicitly asked for this.
  - Each Instagram username votes once (same username again → "already").
  - Each vote stores a device hash (random 32-hex id kept in a cookie `luciano_device` plus localStorage `luciano:device`) and an IP hash (SHA-256 of salt, campaign and IP; the raw IP is never stored).
  - Votes sharing a device or a network are grouped (union-find, transitive). **Each group = one entry in the draw.**
  - The admin can mark a vote "Egen person" (`cleared = 1`) to give it its own entry.
- **Draw:** random among groups that contain at least one verified (follower) vote, then a random verified vote within the group. It returns the group's other handles so the admin can check them.
- **Follower verification:** the admin uploads Instagram's `followers_1.json` export (or pastes usernames) and votes get `verified = 1/0`.
- **Voted state:** remembered in localStorage `luciano:entries` plus a cookie `luciano_vote_<campaign>`, so a returning voter sees "Tak. Du er med." Once the vote closes they see the closed view.
- **Clips:** the admin picks the full song in the browser, chooses 15/30/45/60 s (default 30), and drags a window over the waveform. It's cut with a 0.4 s fade, encoded to MP3 at 160 kbps in the browser with vendored `lamejs`, and **only the clip is uploaded**. `clip_start` and `clip_length` are stored. In testing, 15 s ≈ 300 KB and encoding took about 1.5 s.
- **Covers:** cropped to a square, max 1000 px, JPEG 0.88, in the browser. With no cover, the sleeve is white with a printed black record, and the record that slides out has a plain white label with no logo.
- **Preview mode** (`giveaway/demo.js`): turns on with `?demo`, `window.LUCIANO_DEMO`, or automatically when `/api/status` returns non-JSON (a static host). It uses 3 demo songs (song 3 has no cover) and shows a DEMO bar with Låst / Åben / Slut / Forfra.

### Deployment status (as of the end of the session)
- **Cloudflare Pages project `99luciano` is created** and connected to GitHub, building `main`.
  - Build settings: framework None, empty build command, **output directory `public`**.
  - `99luciano.pages.dev` works.
- **Custom domain `99luciano.dk`:** the user added it. Earlier it gave `DNS_PROBE_FINISHED_NXDOMAIN`; the user then did the nameserver/Punktum dk (MitID) steps. Presumably it works now, since the user reached /management.
- **Cloudflare Access:** working. The user got past login.
  - The earlier error "Kunne ikke hente Cloudflare Access-nøgler" was fixed in code: the team is read from the token's `iss` when `ACCESS_TEAM_DOMAIN` is missing or invalid, and a mismatch gives a message naming the right team.
- **CURRENT BLOCKER:** /management shows **"Databasen er ikke koblet på (D1-binding "DB")."** The D1 binding is not active in Production. The user asked "what kv pairs" and was told: **none**; leave KV and D1 empty, and only create them and bind them.
  - D1 `99luciano` → variable `DB`.
  - KV `99luciano-files` → variable `FILES`.
  - Both in the **Production** environment (Settings → Bindings), then **Retry deployment** (or the user says "redeploy" and Claude pushes an empty commit to main).
- **Not set up (optional):** Instagram API token (only needed for the follower lock), `RESEND_API_KEY`/`MAIL_FROM` (email notifications), `GATEWAYAPI_TOKEN` (SMS), Spotify URL.
- The sandbox **cannot reach** `*.pages.dev`, `99luciano.dk`, DNS-over-HTTPS or Cloudflare APIs (proxy 403). Claude can't test the live site unless the user adds those hosts under the environment's Allowed domains.

### Release plan the user asked about
- The single's release date is **Friday 23 October 2026**.
- Recommended: **vote ends Friday 16 October 2026 at 12:00**, so the winner can be uploaded to the distributor that afternoon, 7 days ahead, which also meets Spotify's 7-day pitch window. The user must set this under "Afstemning slutter" in /management.
- Have all candidate songs mastered, with artwork, ready in advance.
- The gift-card draw can wait; suggest announcing the winner on release day.
- The absolute latest to close is Monday 19 October, at the risk of not being live everywhere.

## Critical Fixes Applied (This Session)

- **Cloudflare built an empty site.** Problem: all work was on the claude branch while `main` only had the README. Fix: fast-forwarded `main` to the work branch; all changes now go to both.
- **"Ingen forbindelse" on /management.** Problem: Access redirected `fetch('/api/admin/me')` cross-origin, so it failed like a network error. Fix: admin fetches use `redirect:'manual'`; an opaque redirect → navigate to `/api/admin/login?return=/management/` (a GET route behind Access that 302s back, same-origin paths only), at most once per minute (sessionStorage `luciano:admin-login`).
- **"Kunne ikke hente Cloudflare Access-nøgler".** Problem: a wrong `ACCESS_TEAM_DOMAIN` (e.g. `99luciano.dk`) built a bad certs URL. Fix in `lib/access.js`: the team is taken from the token `iss` (must match `https://<x>.cloudflareaccess.com`); a configured team that differs → 503 with the correct name; `ACCESS_AUD` is trimmed. Signature (RS256 via team certs), audience, issuer form and expiry are still enforced. Unit-tested: forged, foreign-team, wrong-AUD, expired and fake-issuer tokens are refused.
- **Cookie access throwing** in sandboxed/embedded browsers → all `document.cookie` access is wrapped in try/catch.
- **Name collision** between `load()` (storage helper) and a deck function in `campaign.js` → renamed.
- **Records barely visible** → active sleeve `width: 60%`, record `translateX(68%)`, so the label art shows.
- **Clip editor default length** was 15 s → now 30 s if it fits, else the longest that fits.
- **Restoring the voted state** from cookie or storage writes back to both, so clearing one doesn't reset it.
- **Storage deletes need SELECT permission** (Supabase era, now moot): an admin select policy was added before the move to Cloudflare.

## Known Remaining Issues

- **The D1/KV bindings aren't active yet** (the current blocker, above). Nothing else can be tested until they are.
- **Nothing in production has been verified by Claude**, because of the network block. Real-world Access, D1 and KV behaviour has only been tested locally with `wrangler pages dev` (miniflare) and a simulated Access redirect.
- **Comment in `config.js`** above `SOCIALS` still says "Shown as app icons on the front page when no giveaway is running". The homepage now always shows them; the comment is cosmetic.
- **Network flags are noisy.** IP-based grouping can lump real people together on mobile carrier NAT or shared wifi. That's by design (the admin reviews and uses "Egen person"), but on a mobile-heavy audience many votes may share networks.
- **Re-cutting a clip** requires picking the full song file again (it's never stored).
- **No `.dk` redirect for `www`:** the user was told to add `www.99luciano.dk` as a custom domain too; unconfirmed.
- **Private preview artifact:** https://claude.ai/artifact/UJmAZo1h3Rvqk9Hh2ussgb (built from an older layout where the giveaway was on `/`). It isn't updated for the `/vote` split; republish if needed. The build script inlined CSS/JS and data-URI demo assets and set `window.LUCIANO_DEMO = true`.

## Key Files

**Website (`public/`, the Pages output dir)**
- `public/index.html`: homepage portfolio, plus an inline script that shows the vote CTA via `API.status()`
- `public/vote/index.html`: giveaway page markup (intro, gift card, locked/open/done/closed views, steps)
- `public/giveaway/config.js`: **edit here**: `CAMPAIGN` (`id`, `instagram`), `SOCIALS` (add the Spotify URL), `apiFetch`, `API.status/vote/notify`
- `public/giveaway/campaign.js`: all giveaway page logic (status polling every 30 s, renderPrize, sleeves/record animation, audio player, vote, notify, done/closed, device id + cookies)
- `public/giveaway/socials.js`: app-icon SVG glyphs (Instagram, TikTok, Spotify) and `renderSocials()`, used by `/` and `/vote`
- `public/giveaway/demo.js`, `public/giveaway/demo/`: preview mode with 2 cover JPGs and 3 WAV snippets
- `public/management/index.html`, `management.js`, `management.css`: admin UI (settings, song editor with waveform clip picker, results, flags, signups, verify, draw)
- `public/management/vendor/lame.min.js`: lamejs 1.2.1 (LGPL), unmodified
- `public/styles.css`: the whole look (tokens: `--bg #000`, `--text #fff`, `--muted #7d7d7d`, `--font Montserrat`); sections for giveaway, sleeves, gift card, portfolio, demo bar
- `public/main.js`: reveal-on-scroll, nav scroll state, year, and rewriting folder links to `index.html` when served as `.html` files
- `public/_headers`, `public/_redirects`, `public/404.html`

**Server (Pages Functions)**
- `functions/api/status.js`: `GET /api/status?campaign=`: settings, songs (only with snippet and title), followers, unlocked, closed; triggers background work
- `functions/api/vote.js`: `POST /api/vote {campaign, handle, song, device}` → `ok | already | locked | closed | bad_handle | bad_song`; exports `normalizeHandle`
- `functions/api/notify.js`: `POST /api/notify {campaign, contact}` → `ok | already | open | bad_contact` (8 digits = Danish, `45` prefix)
- `functions/files/[[path]].js`: serves KV files with 1-year immutable cache and byte ranges for audio
- `functions/api/admin/_middleware.js`: runs `adminEmail()` for every `/api/admin/*` request
- `functions/api/admin/[[path]].js`: admin router. Routes:
  - `GET me`, `GET login`
  - `GET/PUT campaign`, `GET status`, `POST followers`, `POST unlock`
  - `GET/POST songs`, `PATCH/DELETE songs/:id` (409 if the song has votes), `POST order`, `POST upload?song=&kind=cover|snippet&start=&length=` (max 15 MB)
  - `GET results` (votes/verified/people), `GET flags`, `POST clear`, `POST verify`, `POST draw`, `GET entries`, `GET signups`
- `lib/db.js`: schema, auto-created via `CREATE TABLE IF NOT EXISTS`. Tables:
  - `campaigns`
  - `songs` (with `clip_start`, `clip_length`)
  - `votes` (`ip_hash`, `device`, `cleared`, `verified`)
  - `notify`
  - `ig`

  Also helpers: `getCampaign` (auto-create), `isClosed`, `ipHash`, `fileUrl` → `/files/<key>`
- `lib/groups.js`: `groupVotes` (union-find on device/ip, skipping cleared), `flagReasons`, `randomInt` (unbiased)
- `lib/access.js`: Cloudflare Access JWT verification (described above); `DEV_ADMIN_EMAIL` bypass only on localhost/127.0.0.1
- `lib/background.js`: at most once per 30 s (claimed via `ig.checked_at`), refreshes the Instagram follower count if `ig.token` is set (weekly token refresh), `setFollowers` (latches `unlocked_at`), and sends due notifications via Resend (email) / GatewayAPI (SMS). Links point to `/vote/`.
- `README.md`: setup steps (Pages, D1/KV bindings, domain, Access) and how the giveaway works
- `package.json` (`"type": "module"`, wrangler devDependency), `.dev.vars.example`

## Commands Reference

```sh
# Local dev with a local D1 + KV (http://localhost:8788); /management works on localhost via .dev.vars
cd /home/user/99luciano
npm install
cp .dev.vars.example .dev.vars        # DEV_ADMIN_EMAIL=...
npx wrangler pages dev public --d1 DB --kv FILES --port 8788

# Reset local data
rm -rf .wrangler

# Stop local servers (avoid pkill -f patterns that match the shell itself)
ps -eo pid,args | grep -E "[w]rangler-dist|[b]in/wrangler|[w]orkerd" | awk '{print $1}' | xargs -r kill

# Deploy = push to main (Cloudflare auto-builds); keep the work branch in sync
git push origin HEAD:main && git push origin claude/99luciano-giveaway-site-ij3yeu

# Force a rebuild (e.g. after the user changes Cloudflare bindings/variables)
git commit --allow-empty -m "Redeploy" && git push origin HEAD:main

# Static preview (triggers demo mode automatically)
cd public && python3 -m http.server 8001   # open /vote/index.html
```

Commit trailer used on every commit:
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Chkctc54KTjJ3ZuwsytqSs
```

Testing: Playwright with `executablePath: '/opt/pw-browsers/chromium'` (`playwright-core` installed in the scratchpad `pw/` dir); Deno at scratchpad `denobin/`. Test scripts lived in the session scratchpad (not in the repo).

## Architecture Flow

```
Visitor phone ──► 99luciano.dk (Cloudflare Pages, output dir public/)
                   ├─ /            portfolio ── GET /api/status ─┐ (shows vote CTA if open)
                   ├─ /vote/       giveaway  ── GET /api/status (every 30 s)
                   │                         ── POST /api/vote, /api/notify
                   │                         ── GET /files/<key> (covers, MP3 clips)
                   │
Admin ─► Cloudflare Access (email one-time PIN) ─► /management/ + /api/admin/*
                   │   (signed Cf-Access-Jwt-Assertion checked in lib/access.js)
                   │
           Pages Functions (functions/, lib/)
                   ├─ D1  "DB"     campaigns, songs, votes, notify, ig
                   ├─ KV  "FILES"  <campaign>/<songId>/<ts>-cover.jpg | -snippet.mp3
                   └─ background (≤ every 30 s): Instagram followers (optional token),
                      Resend email / GatewayAPI SMS "giveaway is open" (optional keys)
```

## Next Steps

1. **Unblock D1/KV:** the user binds D1 `99luciano` as `DB` and KV `99luciano-files` as `FILES` under **Production** bindings and retries the deployment. Then /management loads.
2. **In /management:**
   - Set "Afstemning slutter" to **Friday 16 Oct 2026 12:00** (Copenhagen).
   - Confirm the prize "Gavekort på 150 kr. til hvad du vil".
   - Add the songs: title, optional cover, "Vælg sang" → length → drag window → "Gem klip".
3. **Test live:** vote once on a phone via 99luciano.dk/vote, and check that the homepage CTA appears.
4. **Share** 99luciano.dk/vote on Instagram stories until Friday 12:00.
5. **Friday 16 Oct:** read the winner under Stemmer, then upload it to the distributor with release date 23 Oct. Optionally verify followers (Instagram export) and draw the gift-card winner; announce on release day.
6. **Later:**
   - Add the Spotify artist URL to `SOCIALS` in `public/giveaway/config.js`.
   - Optionally update the `SOCIALS` comment.
   - Optionally republish the preview artifact.
   - For future giveaways, change `CAMPAIGN.id` to start fresh.
