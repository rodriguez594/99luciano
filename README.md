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

**Stay logged in longer:** Zero Trust → Access → Applications → the app → Edit → Session duration (e.g. 1 month), and Settings → Authentication → Global session timeout. If the session runs out while a page is open, the page sends you through the login and back.

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

## Live draw (/management/draw)

A 3D scene (three.js, vendored in `public/management/vendor/three/`, meant for a computer): a white table with a glass bowl full of folded paper notes, and a small red audio interface (inspired by a Scarlett Solo) whose buttons run the draw: **TRÆK** (draw a note), **ÅBN**, **TILBAGE**, **VINDER**, **FJERN** (not in the live) and **RYD**; the big knob shakes the bowl. Its LEDs light up when a button can be used. Press TRÆK (or T, or Space, or click anywhere in the scene) to draw a note, or drag one out of the bowl onto the table, then open it. An empty bowl says why and offers to put everyone who voted in it. Camera angles: Oversigt, Skålen, Bordet, Oppefra, Mixer, Rundt (slow orbit) and Fri (drag to look around). The same buttons sit under the scene, and there are keyboard shortcuts (Space open, W winner, R remove, B back, C clear, S shake).

Who a note is gets decided at random the moment it's picked, weighted by notes: a vote with a confirmed story = 2 notes, a confirmed repost without a vote = 1 note. Flagged votes (same person) share one entry. "Kun følgere" (on by default) keeps only checked followers. Winners and removed people are saved and listed below, with undo.

- **Demo** (or `/management/draw/?demo`): 24 made-up names, nothing is sent to the server.
- **Filmisk** (on by default): opening plays a ~13 second reveal: the room dims, the camera moves in low, "Og vinderen er…", the note teases open, the name sharpens out of a blur over a heartbeat, a riser and a drumroll, then a hit with a flash. All sound is generated in the browser (`draw/cinema.js`), no music files. **Lyd** turns the sound off; "Spring over" skips to the end.
- **Fuld skærm** fills the screen with the scene, for the Instagram Live.

## Vault (99luciano.dk/vault)

Unreleased songs that can be played only for a set time. At **/management/vault**: pick the song (MP3/M4A up to 24 MB go up as they are; WAV/AIFF/FLAC or bigger files are turned into an MP3 in the browser first), give it a title and optionally a cover and a line of text, choose when it opens (now or later) and for how long (1, 6, 12, 24, 48 hours, 7 days or your own end time). Live songs can be extended (+24 hours) or closed; ended songs can be opened again. Under **Statistik** on each song: listeners (one per browser), plays, total listening time, average per listener, how many heard the whole song, how far people got (0–25 % … 75–100 %) and the latest plays. The player reports real playing time every 10 seconds and when it stops; plays under 3 seconds don't count.

/vault plays the song with a countdown until it disappears. The audio is only served by `/api/vault/audio/<id>` while the window is open, never cached, and is gone the moment the time is up. When nothing is open, /vault says it's locked and counts down to the next song (without its title). The front page shows a "Vaulten er åben" button while something is live. Anything that plays in a browser can be recorded, so the vault makes it hard, not impossible, to keep a copy.

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
