# 99 LUCIANO

Artist site for 99 LUCIANO, part of 99 (with 99MGMT, 99ENT and 99WRLDWIDE). In Danish, white on black: the 99 mark with bold uppercase Montserrat. Plain HTML/CSS/JS, no build step.

- `index.html`: homepage
- `campaigns/`: the giveaway at 99luciano.dk/campaigns
- `campaigns/config.js`: **edit this.** Songs, prize, end date, follower goal and the Supabase keys
- `campaigns/snippets/`: the MP3 snippets
- `campaigns/admin.html`: follower count, votes, notification list, follower check and winner draw
- `supabase/schema.sql`: tables and functions the site calls
- `supabase/functions/luciano-status/`: fetches the Instagram follower count and sends the "it's open" messages

This repo is public (needed for free GitHub Pages), so anything in it, including the snippets, is public.

## How the giveaway works

1. **Locked** until @99luciano0 has 150 followers. The page shows the count, updated every 30 seconds, and two things:
   - sign up with an email or phone number to get a message when it opens
   - a button to share the Instagram profile
2. **Open** once the goal is reached. It stays open even if followers drop again. People follow, enter their username, listen to the snippets and vote. One vote per username.
3. When it ends, check followers and draw the winner on the admin page.

## Setup

### 1. Supabase (votes, sign-ups, follower count)

Same setup as 99MS. You can use the 99MS project; every table here starts with `luciano_`.

1. Supabase → SQL Editor. Open `supabase/schema.sql` and set the campaign row at the bottom (id, song ids, end date, goal) to match `campaigns/config.js`. Uncomment the `luciano_admin` line and put in a long password for the admin page. Run it.
2. Supabase → Project Settings → API. Copy the project URL and the anon key into `SUPABASE` in `campaigns/config.js`.
3. Deploy the edge function:
   ```sh
   supabase functions deploy luciano-status --no-verify-jwt
   ```

### 2. Instagram follower count

The follower count comes from Instagram's official API, which needs a professional account:

1. In the Instagram app: Settings → Account type and tools → switch to a **Creator** (or Business) account. It's free and can be switched back.
2. At developers.facebook.com, create an app, add the **Instagram** product and choose "API setup with Instagram login".
3. Add @99luciano0 as an Instagram tester under app roles, accept the invite in the Instagram app, then generate an access token for it.
4. Save the token in Supabase (SQL Editor):
   ```sql
   update luciano_ig set token = 'IGAA...', token_refreshed_at = now() where id = 1;
   ```

The edge function renews the token every week, so it doesn't expire. Until a token is set, you can type the follower count on the admin page, or press "Åbn giveaway nu" to open it by hand.

### 3. Messages when it opens (optional)

People who sign up get an email or SMS when the giveaway opens. The edge function sends them, but only for a channel whose key is set:

- **Email** through [Resend](https://resend.com) (free up to 3,000 emails a month). Add and verify the domain 99luciano.dk there, then run:
  `supabase secrets set RESEND_API_KEY=re_... MAIL_FROM="99 LUCIANO <giveaway@99luciano.dk>"`
- **SMS** through [GatewayAPI](https://gatewayapi.com) (Danish, roughly 25 øre per SMS). Create an API token, then run:
  `supabase secrets set GATEWAYAPI_TOKEN=...`

Without the keys, sign-ups are still saved. The admin page lists them and can export them as CSV so you can message people yourself.

### 4. Publishing

Deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.
One-time setup: repo Settings → Pages → Source: **GitHub Actions**.

### 5. Domain (99luciano.dk)

1. At the DNS provider for 99luciano.dk, add `A` records for `99luciano.dk` → 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153, and a `CNAME` `www` → `rodriguez594.github.io`.
2. Repo Settings → Pages → Custom domain: `99luciano.dk`. Tick "Enforce HTTPS" once GitHub has issued the certificate.

## Running a giveaway

1. Put the snippets in `campaigns/snippets/` and list them in `campaigns/config.js` (id, title, file).
2. Make sure the id, song ids, end date and goal match the `luciano_campaigns` row in Supabase. The server checks against that row.
3. Push to `main`.

To close early, run `update luciano_campaigns set open = false where id = '...'` in Supabase.
For the next giveaway, use a new id so votes and sign-ups start from zero.

### Checking followers and drawing the winner

Instagram's API gives the follower count but not who follows, so the check uses your own follower list:

1. When the giveaway ends, go to Instagram → Settings → Accounts Centre → Your information and permissions → Download your information → Followers and following, format JSON.
2. Open 99luciano.dk/campaigns/admin.html, log in with the admin password and upload `followers_1.json`. Every vote is marked as following or not.
3. Press "Træk". It picks a random vote from people who follow.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.
