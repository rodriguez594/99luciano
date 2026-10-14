# 99 LUCIANO

Artist site for 99 LUCIANO, part of 99 (with 99MGMT, 99ENT and 99WRLDWIDE). In Danish, white on black: the 99 mark with bold uppercase Montserrat. Plain HTML/CSS/JS, no build step.

- `index.html`: homepage
- `campaigns/`: the giveaway at 99luciano.dk/campaigns
- `management/`: 99luciano.dk/management. Log in to edit the giveaway and its songs, see votes and draw the winner
- `campaigns/config.js`: which giveaway is shown, the Instagram handle and the Supabase keys
- `supabase/schema.sql`: tables, access rules and functions
- `supabase/functions/luciano-status/`: fetches the Instagram follower count and sends the "it's open" messages

The repo is public (needed for free GitHub Pages). Songs, covers and snippets are not in it: they're uploaded at /management and stored in Supabase.

## How the giveaway works

1. **Locked** until @99luciano0 has enough followers (150 by default). The page shows the count, updated every 30 seconds, and two things:
   - sign up with an email or phone number to get a message when it opens
   - a button to share the Instagram profile
2. **Open** once the goal is reached. It stays open even if followers drop again. People follow, enter their username, tap a cover to hear the snippet, and vote.
3. When it ends, check followers and draw the winner at /management.

### Flagging instead of blocking

Nobody is turned away. Every username that votes is in (the same username twice is still one vote). But each vote stores two things, so you can spot one person using several usernames:

- **Device:** the browser gets a random id, kept in both a cookie and local storage.
- **Network:** a hash of the IP address (the IP itself isn't stored).

Votes that share a device or a network are **flagged** and grouped at /management → Flag. A group counts as **one entry** in the draw, however many usernames are in it. Those people are still in the giveaway, just with one entry together. The vote counts per song show both all votes and people.

Same network can be a family on the same wifi or a mobile carrier, so look the groups over yourself. If someone in a group is clearly a different person, press "Egen person" and they get their own entry ("Fortryd" puts them back).

The winner is only drawn among votes from real followers (see below), and the draw tells you if the winner was flagged with anyone.

## Setup

### 1. Supabase

Same setup as 99MS. You can use the 99MS project; everything here starts with `luciano_`.

1. Supabase → SQL Editor. Open `supabase/schema.sql`, put your email in the `luciano_admins` line at the bottom and uncomment it. Run it. This also creates the `luciano` storage bucket for covers and snippets.
2. Supabase → Project Settings → API. Copy the project URL and the anon key into `SUPABASE` in `campaigns/config.js`.
3. Supabase → Authentication → URL Configuration → Redirect URLs: add `https://99luciano.dk/management/` (the login link goes there).
4. Deploy the edge function:
   ```sh
   supabase functions deploy luciano-status --no-verify-jwt
   ```

To give someone else access, add their email: `insert into luciano_admins (email) values ('navn@email.dk');`

### 2. Instagram follower count

The follower count comes from Instagram's official API, which needs a professional account:

1. In the Instagram app: Settings → Account type and tools → switch to a **Creator** (or Business) account. It's free and can be switched back.
2. At developers.facebook.com, create an app, add the **Instagram** product and choose "API setup with Instagram login".
3. Add @99luciano0 as an Instagram tester under app roles, accept the invite in the Instagram app, then generate an access token for it.
4. Save the token in Supabase (SQL Editor):
   ```sql
   update luciano_ig set token = 'IGAA...', token_refreshed_at = now() where id = 1;
   ```

The edge function renews the token every week, so it doesn't expire. Until a token is set, you can type the follower count at /management, or press "Åbn giveaway nu".

### 3. Messages when it opens (optional)

People who sign up get an email or SMS when the giveaway opens. The edge function sends them, but only for a channel whose key is set:

- **Email** through [Resend](https://resend.com) (free up to 3,000 emails a month). Add and verify the domain 99luciano.dk there, then run:
  `supabase secrets set RESEND_API_KEY=re_... MAIL_FROM="99 LUCIANO <giveaway@99luciano.dk>"`
- **SMS** through [GatewayAPI](https://gatewayapi.com) (Danish, roughly 25 øre per SMS). Create an API token, then run:
  `supabase secrets set GATEWAYAPI_TOKEN=...`

Without the keys, sign-ups are still saved. /management lists them and can export them as CSV.

### 4. Publishing

Deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.
One-time setup: repo Settings → Pages → Source: **GitHub Actions**.

### 5. Domain (99luciano.dk)

1. At the DNS provider for 99luciano.dk, add `A` records for `99luciano.dk` → 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153, and a `CNAME` `www` → `rodriguez594.github.io`.
2. Repo Settings → Pages → Custom domain: `99luciano.dk`. Tick "Enforce HTTPS" once GitHub has issued the certificate.

## Running a giveaway (at /management)

- **Giveaway:** prize, artist name, end date, follower goal, and "Luk for stemmer nu".
- **Sange:** add songs, set title and artist (empty = the giveaway's artist), upload a cover (cropped to a square and shrunk automatically) and a snippet (MP3, max 15 MB), reorder with the arrows. A song shows up on the page once it has a title and a snippet. A song that has votes can't be deleted.
- **Stemmer / Flag / Besked:** votes per song, flagged groups to review, and the notification sign-ups. Votes and sign-ups can be downloaded as CSV.
- **Vinder:** check followers and draw the winner.

For the next giveaway, change `CAMPAIGN.id` in `campaigns/config.js` to a new id. The giveaway is created the first time you open /management, and votes, sign-ups and songs start from zero.

### Checking followers and drawing the winner

Instagram's API gives the follower count but not who follows, so the check uses your own follower list:

1. When the giveaway ends, go to Instagram → Settings → Accounts Centre → Your information and permissions → Download your information → Followers and following, format JSON.
2. At /management → Vinder, upload `followers_1.json`. Every vote is marked as following or not.
3. Press "Træk". It picks a random entry among people who follow, where each flagged group is one entry.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000. Logging in at /management needs `http://localhost:8000/management/` in Supabase's redirect URLs.
