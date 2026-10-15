# 99 LUCIANO

Artist site for 99 LUCIANO, part of 99 (with 99MGMT, 99ENT and 99WRLDWIDE). In Danish, white on black: the 99 mark with bold uppercase Montserrat. Plain HTML/CSS/JS, no build step.

**Hosting rule for 99 projects:** sites that need a database run on Cloudflare (Pages + D1). Sites that only show things (like 99WRLDWIDE and 99MGMT) stay on GitHub Pages.

This one runs on **Cloudflare Pages**:

- `public/`: the website
  - `index.html`: the front page of 99luciano.dk, a portfolio with app icons for the socials (`SOCIALS` in `giveaway/config.js`; add the Spotify link there when it exists). While a vote is running it also shows "Stem på min næste single og vind et gavekort på 150 kr.", linking to /vote
  - `vote/`: the giveaway at 99luciano.dk/vote (vote for the next single). `/campaigns` and `/giveaway` redirect here
  - `giveaway/`: the giveaway's scripts; `giveaway/config.js` says which giveaway is shown and lists the socials
  - `management/`: 99luciano.dk/management (opens /management/dashboard): `dashboard/` (overview), `vote/` (edit and publish the vote, see votes, draw the winner) and `projects/` (projects, goals and the song tracker)
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
   - `ACCESS_TEAM_DOMAIN` = your team name, e.g. `99luciano` (the part before `.cloudflareaccess.com`). Optional: if it's left out, the team is read from the login itself, and if it's wrong, /management says what to set it to
   - `ACCESS_AUD` = the AUD tag
5. Redeploy (as in step 2.4).

Now 99luciano.dk/management asks for your email, sends a code, and lets you in. The server checks Cloudflare's signed login on every admin request, so the admin API stays closed if Access isn't set up. The `….pages.dev` address has no login, so /management only works on 99luciano.dk.

### Optional
- **Messages when a locked giveaway opens:** set `RESEND_API_KEY` and `MAIL_FROM` (email via [Resend](https://resend.com)) and/or `GATEWAYAPI_TOKEN` (SMS via [GatewayAPI](https://gatewayapi.com)) as variables. Without them, sign-ups are still saved and can be downloaded as CSV.
- **Live Instagram follower count** (only needed to lock a giveaway behind a follower goal): put an Instagram API access token in the database from the D1 console: `UPDATE ig SET token = 'IGAA…' WHERE id = 1;`. It renews itself weekly. Without it, type the count at /management.

## How the giveaway works

- New giveaways start as an **unpublished draft**: /vote says "Afstemningen åbner snart" until you press **Udgiv** at /management/vote. "Skjul" hides it again.
- /vote shows the release plan: 1st place as the next single, 2nd place 2 weeks after, then a new vote with three songs 1 week after (text in `public/vote/index.html`, the `podium` list).
- **Gift cards for voting every time:** votes are counted per Instagram username across all giveaways. Everyone who has voted in at least 3 (changeable under "Gavekort 500 kr." at /management/vote) is in a random draw for gift cards of 300, 150 and 50 kr. After voting, people see how many rounds they have. Every draw is saved.
- /vote shows a live **countdown** to the end date, and the time of the **draw on Instagram Live** with the rule that the winner has to be in the livestream within 5 minutes.
- People can leave an email or phone number to **hear when the winner is drawn**. These are only saved for now (list and CSV under Besked); nothing is sent until an email/SMS service is connected.
- **Double chance:** after voting, people get a story picture to share (or save) and tag the account, then press "Jeg har delt". They show up under **Reposter** at /management/vote; press "Godkend" once you've seen the story and their entry counts double in the draw. You can also add a username by hand, even before they vote (the double chance applies when they do).
- The follower lock is optional: set "Følgere før den åbner" at /management and use "Åbn giveaway nu" to open it by hand.
- People follow, type their Instagram username and tap a cover: it grows, the other two in the row move aside, and the record slides out and spins while the clip plays. Then they vote. The same username twice is one vote.
- **Flagging instead of blocking:** nobody is turned away. Each vote stores a random device id (cookie + local storage) and a hash of the network (the IP itself isn't stored). Votes that share one are grouped under **Flag** at /management, and a group counts as **one entry** in the draw. If someone in a group is clearly a different person (a family on the same wifi), press "Egen person".
- **Winner:** download your follower list from Instagram (Settings → Accounts Centre → Your information and permissions → Download your information → Followers and following, JSON), upload `followers_1.json` under Vinder, then press "Træk". It picks among entries from people who follow, and tells you if the winner was flagged with anyone.

## At /management

- **Dashboard:** the vote (status, votes, songs ready, sign-ups, top songs), active projects with their goals, and the latest versions.
- **Afstemning → Udgiv / Skjul:** publish the vote (needs at least one song with a title and a clip).
- **Indstillinger:** prize, artist name, end date (the countdown), the Instagram Live draw time, follower goal, "Luk for stemmer nu".
- **Sange:** add songs, set title and artist (empty = the giveaway's artist), and upload a cover (cropped to a square and shrunk automatically). No cover means a white sleeve with a black record. Reorder with the arrows. A song shows up once it has a title and a clip. Deleting a song also deletes its votes, so those people can vote again.
- **Clips:** press "Vælg sang" and pick the whole song (MP3, WAV, M4A…). Choose 15, 30, 45 or 60 seconds, drag the window on the waveform to the part you want, press "Lyt" to hear it, then "Gem klip". The clip is cut and turned into an MP3 in your browser, with a short fade in and out. Only the clip is uploaded, never the whole song.
- **Stemmer / Flag / Besked / Vinder:** votes per song (and people, when some are flagged), flagged groups, notification sign-ups, follower check and the draw. Votes and sign-ups download as CSV.

### Projekter

- Create a project, then add **goals**: a number of songs, versions or songs with album art (these count themselves) or a manual count with − / +.
- **Song tracker:** press **+** → "Tilføj ny sang" or "Tilføj eksisterende sang" (a new version). A form asks for the name, version, date and a **link** (Dropbox, Google Drive …); "▶ Afspil" opens that link, so the songs are never on the site. "Vælg lydfil" fills in the form from a file's name instead (`Natlys v3.wav`, `Natlys_master.mp3`, `Natlys (version 2).m4a`; dates like `2026-10-12`), reading only the name, never the audio. Several files at once give one row each. A new-song title the project already has becomes a new version of that song. Links can be added or changed later on each version.
- **Covers view:** songs are square covers, 3 per row. Drag a cover to change the order (on a phone, hold your finger on it first); drag audio files onto the tracker to add them. Tap a cover to open the song, where "Flyt til projekt" moves it (with versions and covers) to another project. Each project and the projects page show an overview: songs, versions, covers and goals reached.
- **Album art:** tap the cover on a song. Every cover is kept; pick which one shows under "Versioner og covers". "Covers" switches to a grid of all album art.

For the next giveaway, change `CAMPAIGN.id` in `public/giveaway/config.js` to a new id. Votes, songs and sign-ups start from zero.

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
