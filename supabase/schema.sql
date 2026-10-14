-- 99 LUCIANO giveaway. Run in Supabase → SQL Editor (safe to run again).
--
-- Visitors never touch the tables directly; the giveaway page only calls the public
-- functions below. People listed in luciano_admins can log in at /management and edit
-- the giveaway, the songs and the files in the "luciano" storage bucket.

create extension if not exists pgcrypto;

-- Tables -------------------------------------------------------------------

create table if not exists public.luciano_campaigns (
  id          text primary key,
  prize       text not null default 'Gavekort på 150 kr. til hvad du vil',
  artist      text not null default '99 LUCIANO', -- shown under songs that don't have their own
  ends_at     timestamptz,
  open        boolean not null default true,      -- false closes voting right away
  goal        int not null default 150,           -- Instagram followers needed before voting opens
  unlocked_at timestamptz                         -- set the first time the goal is reached; stays open after that
);
alter table public.luciano_campaigns drop column if exists max_per_ip;

create table if not exists public.luciano_songs (
  id          uuid primary key default gen_random_uuid(),
  campaign    text not null references public.luciano_campaigns (id) on delete cascade,
  title       text not null default '',
  artist      text,                               -- empty = the campaign's artist
  cover_url   text,
  snippet_url text,                               -- songs without a snippet are hidden on the page
  position    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists luciano_songs_campaign on public.luciano_songs (campaign, position);

create table if not exists public.luciano_votes (
  id         bigint generated always as identity primary key,
  campaign   text not null references public.luciano_campaigns (id),
  handle     text not null,          -- Instagram username, lowercase, no @
  song       uuid not null references public.luciano_songs (id), -- a song with votes can't be deleted
  ip_hash    text,
  device     text,                   -- hash of the random id the voter's browser keeps (cookie + storage)
  cleared    boolean not null default false,  -- you looked at a flag and decided this is its own person
  verified   boolean not null default false,  -- true = found in the follower list
  created_at timestamptz not null default now(),
  unique (campaign, handle)
);
alter table public.luciano_votes add column if not exists device text;
alter table public.luciano_votes add column if not exists cleared boolean not null default false;
create index if not exists luciano_votes_ip on public.luciano_votes (campaign, ip_hash);
drop index if exists public.luciano_votes_device;
create index if not exists luciano_votes_dev on public.luciano_votes (campaign, device);

-- People who want a message when the giveaway opens.
create table if not exists public.luciano_notify (
  id          bigint generated always as identity primary key,
  campaign    text not null references public.luciano_campaigns (id),
  kind        text not null check (kind in ('email', 'sms')),
  contact     text not null,          -- lowercase email, or phone number as digits with country code
  ip_hash     text,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  tries       int not null default 0,
  unique (campaign, contact)
);

-- One row: the Instagram follower count, kept fresh by the luciano-status edge function.
create table if not exists public.luciano_ig (
  id                 int primary key default 1 check (id = 1),
  followers          int not null default 0,
  checked_at         timestamptz,
  token              text,           -- Instagram access token (see README)
  token_refreshed_at timestamptz
);
insert into public.luciano_ig (id) values (1) on conflict do nothing;

-- Who can log in at /management.
create table if not exists public.luciano_admins (
  email text primary key check (email = lower(email))
);

alter table public.luciano_campaigns enable row level security;
alter table public.luciano_songs enable row level security;
alter table public.luciano_votes enable row level security;
alter table public.luciano_notify enable row level security;
alter table public.luciano_ig enable row level security;
alter table public.luciano_admins enable row level security;
revoke all on public.luciano_campaigns, public.luciano_songs, public.luciano_votes, public.luciano_notify,
  public.luciano_ig, public.luciano_admins
  from anon, authenticated;


-- Helpers ------------------------------------------------------------------

-- Is the logged-in user on the luciano_admins list?
create or replace function public.luciano_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from luciano_admins where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

create or replace function public.luciano_require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not luciano_is_admin() then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
end;
$$;

-- Hash of the visitor's IP, used to cap entries per network.
create or replace function public.luciano_ip_hash(p_campaign text)
returns text
language plpgsql
stable
as $$
declare
  headers json := nullif(current_setting('request.headers', true), '')::json;
  ip text := coalesce(headers ->> 'cf-connecting-ip', split_part(headers ->> 'x-forwarded-for', ',', 1));
begin
  if coalesce(trim(ip), '') = '' then return null; end if;
  return md5(p_campaign || ':' || trim(ip));
end;
$$;

-- Stores a new follower count and opens every campaign whose goal it reaches.
create or replace function public.luciano_set_followers(p_followers int)
returns void
language sql
security definer
set search_path = public
as $$
  update luciano_ig set followers = greatest(p_followers, 0), checked_at = now() where id = 1;
  update luciano_campaigns set unlocked_at = now() where unlocked_at is null and goal <= p_followers;
$$;


-- Management (logged-in admins edit these two tables directly) --------------

grant select, insert, update, delete on public.luciano_campaigns, public.luciano_songs to authenticated;

drop policy if exists luciano_campaigns_admin on public.luciano_campaigns;
create policy luciano_campaigns_admin on public.luciano_campaigns
  for all to authenticated using (public.luciano_is_admin()) with check (public.luciano_is_admin());

drop policy if exists luciano_songs_admin on public.luciano_songs;
create policy luciano_songs_admin on public.luciano_songs
  for all to authenticated using (public.luciano_is_admin()) with check (public.luciano_is_admin());

-- Covers and snippets live in a public bucket; only admins can add, replace or remove files.
insert into storage.buckets (id, name, public) values ('luciano', 'luciano', true) on conflict (id) do nothing;

-- (Removing or replacing a file also needs read access to it.)
drop policy if exists luciano_files_select on storage.objects;
create policy luciano_files_select on storage.objects
  for select to authenticated using (bucket_id = 'luciano' and public.luciano_is_admin());
drop policy if exists luciano_files_insert on storage.objects;
create policy luciano_files_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'luciano' and public.luciano_is_admin());
drop policy if exists luciano_files_update on storage.objects;
create policy luciano_files_update on storage.objects
  for update to authenticated using (bucket_id = 'luciano' and public.luciano_is_admin());
drop policy if exists luciano_files_delete on storage.objects;
create policy luciano_files_delete on storage.objects
  for delete to authenticated using (bucket_id = 'luciano' and public.luciano_is_admin());


-- Public -------------------------------------------------------------------

-- Everything the giveaway page needs: settings, songs, follower count and whether voting is open.
create or replace function public.luciano_status(p_campaign text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'prize', c.prize,
    'artist', c.artist,
    'ends_at', c.ends_at,
    'followers', i.followers,
    'goal', c.goal,
    'unlocked', c.unlocked_at is not null,
    'closed', not c.open or (c.ends_at is not null and now() > c.ends_at),
    'songs', coalesce((
      select json_agg(json_build_object(
               'id', s.id, 'title', s.title, 'artist', coalesce(nullif(s.artist, ''), c.artist),
               'cover', s.cover_url, 'file', s.snippet_url)
             order by s.position, s.created_at)
      from luciano_songs s
      where s.campaign = c.id and s.snippet_url is not null and s.title <> ''
    ), '[]'::json)
  )
  from luciano_campaigns c, luciano_ig i
  where c.id = p_campaign and i.id = 1;
$$;

-- Nothing is blocked: every username gets in (the same username twice is still one vote).
-- The device id (p_device, a random id the browser keeps in a cookie and in storage) and
-- the network are stored so /management can flag votes that look like the same person.
-- Returns 'ok', 'already', 'locked', 'closed', 'bad_handle' or 'bad_song'.
drop function if exists public.luciano_vote(text, text, text);
create or replace function public.luciano_vote(p_campaign text, p_handle text, p_song text, p_device text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c luciano_campaigns;
  h text;
  song_id uuid;
  ip text := luciano_ip_hash(p_campaign);
  dev text;
  n int;
begin
  select * into c from luciano_campaigns where id = p_campaign;
  if not found or not c.open or (c.ends_at is not null and now() > c.ends_at) then
    return 'closed';
  end if;
  if c.unlocked_at is null then
    return 'locked';
  end if;

  h := lower(regexp_replace(trim(coalesce(p_handle, '')), '^@+', ''));
  if h !~ '^[a-z0-9._]{1,30}$' or h ~ '(^\.|\.$|\.\.)' then
    return 'bad_handle';
  end if;

  if coalesce(p_song, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'bad_song';
  end if;
  select s.id into song_id from luciano_songs s
  where s.id = p_song::uuid and s.campaign = c.id and s.snippet_url is not null;
  if song_id is null then
    return 'bad_song';
  end if;

  if coalesce(p_device, '') ~ '^[a-f0-9]{32}$' then
    dev := md5(c.id || ':' || p_device);
  end if;

  insert into luciano_votes (campaign, handle, song, ip_hash, device)
  values (c.id, h, song_id, ip, dev)
  on conflict (campaign, handle) do nothing;
  get diagnostics n = row_count;
  return case when n = 1 then 'ok' else 'already' end;
end;
$$;

-- Sign up for a message when the giveaway opens. Takes an email or a phone number
-- (8 digits are read as Danish). Returns 'ok', 'already', 'open' or 'bad_contact'.
create or replace function public.luciano_notify_me(p_campaign text, p_contact text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c luciano_campaigns;
  v text := lower(trim(coalesce(p_contact, '')));
  kind text;
  ip text := luciano_ip_hash(p_campaign);
  n int;
begin
  select * into c from luciano_campaigns where id = p_campaign;
  if not found then return 'bad_contact'; end if;
  if c.unlocked_at is not null then return 'open'; end if;

  if v ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' and length(v) <= 200 then
    kind := 'email';
  else
    v := regexp_replace(v, '[\s\-().]', '', 'g');
    v := regexp_replace(v, '^(\+|00)', '');
    if v ~ '^[0-9]{8}$' then v := '45' || v; end if;
    if v !~ '^[1-9][0-9]{7,14}$' then return 'bad_contact'; end if;
    kind := 'sms';
  end if;

  insert into luciano_notify (campaign, kind, contact, ip_hash)
  values (c.id, kind, v, ip)
  on conflict (campaign, contact) do nothing;
  get diagnostics n = row_count;
  return case when n = 1 then 'ok' else 'already' end;
end;
$$;


-- Used by the luciano-status edge function (service role only) -----------------

-- Lets one caller at a time refresh the follower count, at most every 30 seconds.
create or replace function public.luciano_claim_check()
returns table (token text, token_refreshed_at timestamptz)
language sql
security definer
set search_path = public
as $$
  update luciano_ig i set checked_at = now()
  where i.id = 1 and (i.checked_at is null or i.checked_at < now() - interval '30 seconds')
  returning i.token, i.token_refreshed_at;
$$;

create or replace function public.luciano_save_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update luciano_ig set token = p_token, token_refreshed_at = now() where id = 1;
$$;

-- Hands out messages that are due (campaign open, not sent yet) and marks them sent.
-- p_kinds: the channels that are set up ('email', 'sms').
drop function if exists public.luciano_claim_notifications(int);
create or replace function public.luciano_claim_notifications(p_kinds text[], p_limit int default 50)
returns table (id bigint, kind text, contact text)
language sql
security definer
set search_path = public
as $$
  update luciano_notify n set notified_at = now(), tries = n.tries + 1
  where n.id in (
    select x.id from luciano_notify x
    join luciano_campaigns c on c.id = x.campaign
    where c.unlocked_at is not null and x.notified_at is null and x.tries < 3 and x.kind = any (p_kinds)
    order by x.id
    limit p_limit
    for update of x skip locked
  )
  returning n.id, n.kind, n.contact;
$$;

-- Puts a message back in the queue when sending failed (tried at most 3 times).
create or replace function public.luciano_unclaim_notification(p_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update luciano_notify set notified_at = null where id = p_id;
$$;


-- Admin functions (used by /management; the caller must be in luciano_admins) ---

-- Groups votes that look like the same person: votes that share a device or a network
-- (directly or through each other) end up in one group. Each group is one entry in the draw.
-- Votes you've cleared at /management always count as their own group.
create or replace function public.luciano_groups(p_campaign text)
returns table (vote_id bigint, grp bigint)
language sql
stable
security definer
set search_path = public
as $$
  with recursive v as (
    select id, device, ip_hash, cleared from luciano_votes where campaign = p_campaign
  ),
  edges as (
    select a.id as a, b.id as b
    from v a join v b on a.id <> b.id
    where not a.cleared and not b.cleared
      and ((a.device is not null and a.device = b.device) or (a.ip_hash is not null and a.ip_hash = b.ip_hash))
  ),
  reach (id, root) as (
    select id, id from v
    union
    select e.b, r.root from reach r join edges e on e.a = r.id
  )
  select id, min(root) from reach group by id;
$$;

-- votes = all votes, verified = from followers, people = distinct groups (flagged duplicates count once)
drop function if exists public.luciano_results(text);
create or replace function public.luciano_results(p_campaign text)
returns table (song uuid, title text, votes bigint, verified bigint, people bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_require_admin();
  return query
    select s.id, s.title, count(v.id), count(v.id) filter (where v.verified), count(distinct g.grp)
    from luciano_songs s
    left join luciano_votes v on v.song = s.id
    left join luciano_groups(p_campaign) g on g.vote_id = v.id
    where s.campaign = p_campaign
    group by s.id
    order by s.position, s.created_at;
end;
$$;

-- Every vote that shares a device or a network with another vote, grouped, so you can look
-- them over. same_device / same_network say why (ignoring whether you cleared it).
create or replace function public.luciano_flags(p_campaign text)
returns table (vote_id bigint, grp bigint, handle text, title text, verified boolean, cleared boolean,
               same_device boolean, same_network boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_require_admin();
  return query
    with v as (select * from luciano_votes x where x.campaign = p_campaign),
    f as (
      select v.id,
        exists (select 1 from v o where o.id <> v.id and v.device is not null and o.device = v.device) as dev,
        exists (select 1 from v o where o.id <> v.id and v.ip_hash is not null and o.ip_hash = v.ip_hash) as net
      from v
    )
    select v.id, g.grp, v.handle, s.title, v.verified, v.cleared, f.dev, f.net, v.created_at
    from v
    join f on f.id = v.id
    join luciano_groups(p_campaign) g on g.vote_id = v.id
    join luciano_songs s on s.id = v.song
    where f.dev or f.net
    order by g.grp, v.created_at;
end;
$$;

-- Mark a flagged vote as its own person (true) or put it back in its group (false).
create or replace function public.luciano_set_cleared(p_vote bigint, p_cleared boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_require_admin();
  update luciano_votes set cleared = p_cleared where id = p_vote;
end;
$$;

-- Marks votes whose handle is in the follower list. Everyone else becomes unverified,
-- so running it again with a fresh export drops people who unfollowed.
create or replace function public.luciano_verify(p_campaign text, p_followers text[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform luciano_require_admin();
  update luciano_votes v
     set verified = v.handle = any (select lower(regexp_replace(trim(f), '^@+', '')) from unnest(p_followers) f)
   where v.campaign = p_campaign;
  select count(*) into n from luciano_votes where campaign = p_campaign and verified;
  return n;
end;
$$;

-- Draws among people, not votes: each group of flagged votes is one entry. Only votes from
-- followers count. Returns the winning vote plus every username in its group.
drop function if exists public.luciano_draw(text);
create or replace function public.luciano_draw(p_campaign text)
returns table (handle text, title text, created_at timestamptz, pool bigint, group_handles text[])
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_require_admin();
  return query
    with g as materialized (
      select gg.vote_id, gg.grp, v.handle, v.song, v.verified, v.created_at
      from luciano_groups(p_campaign) gg join luciano_votes v on v.id = gg.vote_id
    ),
    pick as materialized (
      select x.grp from (select distinct g.grp from g where g.verified) x order by random() limit 1
    )
    select g.handle, s.title, g.created_at,
      (select count(distinct g2.grp) from g g2 where g2.verified),
      (select array_agg(g3.handle order by g3.created_at) from g g3 where g3.grp = (select grp from pick))
    from g
    join luciano_songs s on s.id = g.song
    where g.grp = (select grp from pick) and g.verified
    order by random()
    limit 1;
end;
$$;

drop function if exists public.luciano_entries(text);
create or replace function public.luciano_entries(p_campaign text)
returns table (handle text, title text, verified boolean, flagged boolean, grp bigint, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_require_admin();
  return query
    select v.handle, s.title, v.verified,
      (select count(*) from luciano_groups(p_campaign) g2 where g2.grp = g.grp) > 1,
      g.grp, v.created_at
    from luciano_votes v
    join luciano_songs s on s.id = v.song
    join luciano_groups(p_campaign) g on g.vote_id = v.id
    where v.campaign = p_campaign
    order by v.id;
end;
$$;

create or replace function public.luciano_signups(p_campaign text)
returns table (kind text, contact text, created_at timestamptz, notified_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_require_admin();
  return query
    select n.kind, n.contact, n.created_at, n.notified_at
    from luciano_notify n
    where n.campaign = p_campaign
    order by n.id;
end;
$$;

-- Set the follower count by hand (when there's no Instagram token) or open the giveaway now.
create or replace function public.luciano_admin_followers(p_followers int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_require_admin();
  perform luciano_set_followers(p_followers);
end;
$$;

create or replace function public.luciano_admin_unlock(p_campaign text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_require_admin();
  update luciano_campaigns set unlocked_at = coalesce(unlocked_at, now()) where id = p_campaign;
end;
$$;


-- Who can call what ----------------------------------------------------------

revoke execute on function
  public.luciano_is_admin(),
  public.luciano_require_admin(),
  public.luciano_ip_hash(text),
  public.luciano_set_followers(int),
  public.luciano_status(text),
  public.luciano_vote(text, text, text, text),
  public.luciano_notify_me(text, text),
  public.luciano_claim_check(),
  public.luciano_save_token(text),
  public.luciano_claim_notifications(text[], int),
  public.luciano_unclaim_notification(bigint),
  public.luciano_groups(text),
  public.luciano_results(text),
  public.luciano_flags(text),
  public.luciano_set_cleared(bigint, boolean),
  public.luciano_verify(text, text[]),
  public.luciano_draw(text),
  public.luciano_entries(text),
  public.luciano_signups(text),
  public.luciano_admin_followers(int),
  public.luciano_admin_unlock(text)
from public, anon, authenticated;

grant execute on function
  public.luciano_status(text),
  public.luciano_vote(text, text, text, text),
  public.luciano_notify_me(text, text)
to anon, authenticated;

grant execute on function
  public.luciano_is_admin(),
  public.luciano_results(text),
  public.luciano_flags(text),
  public.luciano_set_cleared(bigint, boolean),
  public.luciano_verify(text, text[]),
  public.luciano_draw(text),
  public.luciano_entries(text),
  public.luciano_signups(text),
  public.luciano_admin_followers(int),
  public.luciano_admin_unlock(text)
to authenticated;


-- Setup: edit these, then run --------------------------------------------------

-- The giveaway. Its id must match CAMPAIGN.id in campaigns/config.js.
-- Prize, end date, goal and songs are edited at /management after that.
-- It starts open (unlocked_at = now). To lock it behind a follower goal instead, set unlocked_at to null.
insert into public.luciano_campaigns (id, ends_at, unlocked_at)
values ('next-single-2026', '2026-11-15 23:59 Europe/Copenhagen', now())
on conflict (id) do nothing;

-- Who can log in at /management (lowercase email). Add a line per person.
-- insert into public.luciano_admins (email) values ('din@email.dk') on conflict do nothing;
