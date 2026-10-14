# 99 LUCIANO

Artist site for 99 LUCIANO, part of 99 (with 99MGMT, 99ENT and 99WRLDWIDE). In Danish, white on black: the 99 mark with bold uppercase Montserrat. Plain HTML/CSS/JS, no build step.

**Hosting rule for 99 projects:** sites that need a database run on Cloudflare (Pages + D1). Sites that only show things (like 99WRLDWIDE and 99MGMT) stay on GitHub Pages.

This one runs on **Cloudflare Pages**:

- `public/`: the website
  - `index.html`: homepage
  - `campaigns/`: the giveaway at 99luciano.dk/campaigns (`config.js` says which giveaway is shown)
  - `management/`: 99luciano.dk/management, where you edit the giveaway and songs, see votes and draw the winner
- `functions/`: the server code (Cloudflare Pages Functions), `/api/...` and `/files/...`
- `lib/`: code shared by the functions

Data lives in Cloudflare:

- **D1** (database `DB`): giveaway settings, songs, votes, sign-ups. The tables create themselves the first time the site runs.
- **KV** (namespace `FILES`): the covers and snippets you upload at /management.
- **Access**: the login in front of /management.

## Setup (once, in the Cloudflare dashboard)

### 1. Pages project
1. **Workers & Pages → Create → Pages → Connect to Git**, and pick `rodriguez594/99luciano`.
2. Production branch: the branch with this code. Framework preset **None**. Build command: empty. **Build output directory: `public`**.
3. **Save and Deploy**. You get a `….pages.dev` address.

### 2. Database and file store
1. **Storage & Databases → D1 → Create database**, named `99luciano`.
2. **Storage & Databases → KV → Create namespace**, named `99luciano-files`.
3. Pages project → **Settings → Bindings → Add**:
   - D1 database: variable name **`DB`**, database `99luciano`.
   - KV namespace: variable name **`FILES`**, namespace `99luciano-files`.
4. **Deployments → … → Retry deployment**, so the bindings take effect.

### 3. Domain
Pages project → **Custom domains → Set up a custom domain** → `99luciano.dk`, then `www.99luciano.dk`. DNS is set up automatically because the domain is on Cloudflare.

### 4. Login for /management (Cloudflare Access, free)
1. **Zero Trust** (left menu). The first time, pick a team name (e.g. `99luciano`) and the **Free** plan.
2. **Access → Applications → Add an application → Self-hosted**.
   - Name: `99 LUCIANO management`.
   - Add two destinations: domain `99luciano.dk` with path `management`, and domain `99luciano.dk` with path `api/admin`.
   - Policy: **Allow**, include **Emails**, and add your own email (and anyone else who should get in).
   - Login method: **One-time PIN** (a code by email).
3. Open the application again and copy its **Application Audience (AUD) Tag**.
4. Pages project → **Settings → Variables and Secrets**. Add:
   - `ACCESS_TEAM_DOMAIN` = your team name, e.g. `99luciano` (the part before `.cloudflareaccess.com`)
   - `ACCESS_AUD` = the AUD tag
5. Redeploy (as in step 2.4).

Now 99luciano.dk/management asks for your email, sends a code, and lets you in. The server checks Cloudflare's signed login on every admin request, so the admin API stays closed if Access isn't set up. The `….pages.dev` address has no login, so /management only works on 99luciano.dk.

### Optional
- **Messages when a locked giveaway opens:** set `RESEND_API_KEY` and `MAIL_FROM` (email via [Resend](https://resend.com)) and/or `GATEWAYAPI_TOKEN` (SMS via [GatewayAPI](https://gatewayapi.com)) as variables. Without them, sign-ups are still saved and can be downloaded as CSV.
- **Live Instagram follower count** (only needed to lock a giveaway behind a follower goal): put an Instagram API access token in the database from the D1 console: `UPDATE ig SET token = 'IGAA…' WHERE id = 1;`. It renews itself weekly. Without it, type the count at /management.

## How the giveaway works

- New giveaways **start open**. The follower lock is optional: set "Følgere før den åbner" at /management and use "Åbn giveaway nu" to open it by hand.
- People follow, type their Instagram username and tap a cover: it grows, the other two in the row move aside, and the record slides out and spins while the clip plays. Then they vote. The same username twice is one vote.
- **Flagging instead of blocking:** nobody is turned away. Each vote stores a random device id (cookie + local storage) and a hash of the network (the IP itself isn't stored). Votes that share one are grouped under **Flag** at /management, and a group counts as **one entry** in the draw. If someone in a group is clearly a different person (a family on the same wifi), press "Egen person".
- **Winner:** download your follower list from Instagram (Settings → Accounts Centre → Your information and permissions → Download your information → Followers and following, JSON), upload `followers_1.json` under Vinder, then press "Træk". It picks among entries from people who follow, and tells you if the winner was flagged with anyone.

## At /management

- **Giveaway:** prize, artist name, end date, follower goal, "Luk for stemmer nu".
- **Sange:** add songs, set title and artist (empty = the giveaway's artist), and upload a cover (cropped to a square and shrunk automatically). No cover means a white sleeve with a black record. Reorder with the arrows. A song shows up once it has a title and a clip, and a song with votes can't be deleted.
- **Clips:** press "Vælg sang" and pick the whole song (MP3, WAV, M4A…). Choose 15, 30, 45 or 60 seconds, drag the window on the waveform to the part you want, press "Lyt" to hear it, then "Gem klip". The clip is cut and turned into an MP3 in your browser, with a short fade in and out. Only the clip is uploaded, never the whole song.
- **Stemmer / Flag / Besked / Vinder:** votes per song (and people, when some are flagged), flagged groups, notification sign-ups, follower check and the draw. Votes and sign-ups download as CSV.

For the next giveaway, change `CAMPAIGN.id` in `public/campaigns/config.js` to a new id. Votes, songs and sign-ups start from zero.

## Preview mode

Served without the server code (any plain file host), or with `?demo` in the address, the giveaway runs on three example songs and saves nothing. A small DEMO bar switches between the locked and the open giveaway.

## Run locally

```sh
npm install
cp .dev.vars.example .dev.vars   # lets /management work on localhost without Access
npm run dev                      # http://localhost:8788, with a local D1 and KV
```

## Credits

Clips are encoded with [lamejs](https://github.com/zhuker/lamejs), a JavaScript port of [LAME](https://lame.sourceforge.io) (LGPL), shipped unmodified in `public/management/vendor/`.
