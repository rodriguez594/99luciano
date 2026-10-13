# 99 LUCIANO

Artist site for 99 LUCIANO, part of 99 (with 99MGMT, 99ENT and 99WRLDWIDE). It uses the same look as the other 99 sites, black on white. Plain HTML/CSS/JS, no build step.

- `index.html`: homepage
- `campaigns/`: the giveaway at 99luciano.dk/campaigns. Follow on Instagram, enter your username, listen to the snippets, vote. One vote per username.
- `campaigns/config.js`: **edit this.** Songs, prize, end date and the Supabase keys
- `campaigns/snippets/`: the MP3 snippets
- `campaigns/admin.html`: results, follower check and winner draw
- `main.js`: Danish translations and the language switch (English text lives in the HTML)
- `styles.css`: the 99 look, black on white
- `supabase/schema.sql`: the votes table and the functions the site calls

This repo is public (needed for free GitHub Pages), so anything in it, including the snippets, is public.

## Votes (Supabase)

GitHub Pages can't store anything, so votes go to Supabase, the same setup as 99MS. You can use the 99MS project; every table here starts with `luciano_`.

1. Supabase → SQL Editor. Open `supabase/schema.sql` and set the campaign row at the bottom (id, song ids, end date) to match `campaigns/config.js`. Uncomment the `luciano_admin` line and put in a long password for the admin page. Run it.
2. Supabase → Project Settings → API. Copy the project URL and the anon key into `SUPABASE` in `campaigns/config.js`.

The tables are locked. The site can only call the `luciano_*` functions, and those enforce one vote per username, the end date and at most 8 votes per network.

## Running a giveaway

1. Put the snippets in `campaigns/snippets/` and list them in `campaigns/config.js` (id, title, file).
2. Make sure the id, song ids and end date match the `luciano_campaigns` row in Supabase. The server checks against that row.
3. Push to `main`.

To close early, run `update luciano_campaigns set open = false where id = '...'` in Supabase.
For the next giveaway, use a new id so votes start from zero.

### Checking followers and drawing the winner

Instagram doesn't let a website check whether someone follows you. Bots that scrape Instagram can get the account restricted, so the check uses your own follower list:

1. When the giveaway ends, go to Instagram → Settings → Accounts Centre → Your information and permissions → Download your information → Followers and following, format JSON.
2. Open 99luciano.dk/campaigns/admin.html, enter the admin password and upload `followers_1.json`. Every entry is marked as following or not.
3. Press Draw. It picks a random entry from people who follow.

The results also show how many votes each song got from people who actually follow.

## Publishing

Deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`.
One-time setup: repo Settings → Pages → Source: **GitHub Actions**.

## Domain (99luciano.dk)

1. At the DNS provider for 99luciano.dk, add `A` records for `99luciano.dk` → 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153, and a `CNAME` `www` → `rodriguez594.github.io`.
2. Repo Settings → Pages → Custom domain: `99luciano.dk`. Tick "Enforce HTTPS" once GitHub has issued the certificate.

## Run locally

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.
