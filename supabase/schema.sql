-- 99 LUCIANO giveaway. Run in Supabase → SQL Editor (safe to run again).
-- The tables are locked (row level security on, no policies). The site can only
-- reach them through the functions below.

create table if not exists public.luciano_campaigns (
  id          text primary key,
  songs       text[] not null,        -- song ids, must match CAMPAIGN.songs in campaigns/config.js
  ends_at     timestamptz,
  open        boolean not null default true,
  goal        int not null default 150, -- Instagram followers needed before voting opens
  unlocked_at timestamptz             -- set the first time the goal is reached; stays open after that
);
alter table public.luciano_campaigns add column if not exists goal int not null default 150;
alter table public.luciano_campaigns add column if not exists unlocked_at timestamptz;

create table if not exists public.luciano_votes (
  id         bigint generated always as identity primary key,
  campaign   text not null references public.luciano_campaigns (id),
  handle     text not null,          -- Instagram username, lowercase, no @
  song       text not null,
  ip_hash    text,
  verified   boolean not null default false,  -- true = found in the follower list
  created_at timestamptz not null default now(),
  unique (campaign, handle)
);
create index if not exists luciano_votes_ip on public.luciano_votes (campaign, ip_hash);

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

create table if not exists public.luciano_admin (
  key text primary key
);

alter table public.luciano_campaigns enable row level security;
alter table public.luciano_votes enable row level security;
alter table public.luciano_notify enable row level security;
alter table public.luciano_ig enable row level security;
alter table public.luciano_admin enable row level security;
revoke all on public.luciano_campaigns, public.luciano_votes, public.luciano_notify, public.luciano_ig, public.luciano_admin
  from anon, authenticated;


-- Helpers ------------------------------------------------------------------

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


-- Public -------------------------------------------------------------------

-- What the page shows: follower count, goal, and whether voting is open.
create or replace function public.luciano_status(p_campaign text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'followers', i.followers,
    'goal', c.goal,
    'unlocked', c.unlocked_at is not null,
    'closed', not c.open or (c.ends_at is not null and now() > c.ends_at)
  )
  from luciano_campaigns c, luciano_ig i
  where c.id = p_campaign and i.id = 1;
$$;

-- Returns 'ok', 'already', 'locked', 'closed', 'bad_handle', 'bad_song' or 'too_many'.
create or replace function public.luciano_vote(p_campaign text, p_handle text, p_song text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c luciano_campaigns;
  h text;
  ip text := luciano_ip_hash(p_campaign);
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

  if not (p_song = any (c.songs)) then
    return 'bad_song';
  end if;

  -- At most 8 entries per network, so one person can't flood the vote.
  if ip is not null then
    select count(*) into n from luciano_votes where campaign = c.id and ip_hash = ip;
    if n >= 8 then
      return 'too_many';
    end if;
  end if;

  insert into luciano_votes (campaign, handle, song, ip_hash)
  values (c.id, h, p_song, ip)
  on conflict (campaign, handle) do nothing;
  get diagnostics n = row_count;
  return case when n = 1 then 'ok' else 'already' end;
end;
$$;

-- Sign up for a message when the giveaway opens. Takes an email or a phone number
-- (8 digits are read as Danish). Returns 'ok', 'already', 'open', 'bad_contact' or 'too_many'.
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

  if ip is not null then
    select count(*) into n from luciano_notify where campaign = c.id and ip_hash = ip;
    if n >= 8 then return 'too_many'; end if;
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


-- Admin (used by campaigns/admin.html, protected by the key in luciano_admin) ---

create or replace function public.luciano_check_key(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_key is null or not exists (select 1 from luciano_admin where key = p_key) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
end;
$$;

create or replace function public.luciano_results(p_key text, p_campaign text)
returns table (song text, votes bigint, verified bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_check_key(p_key);
  return query
    select s.id, count(v.id), count(v.id) filter (where v.verified)
    from luciano_campaigns c
    cross join lateral unnest(c.songs) with ordinality as s (id, pos)
    left join luciano_votes v on v.campaign = c.id and v.song = s.id
    where c.id = p_campaign
    group by s.id, s.pos
    order by s.pos;
end;
$$;

-- Marks entries whose handle is in the follower list. Everyone else becomes unverified,
-- so running it again with a fresh export drops people who unfollowed.
create or replace function public.luciano_verify(p_key text, p_campaign text, p_followers text[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  perform luciano_check_key(p_key);
  update luciano_votes v
     set verified = v.handle = any (select lower(regexp_replace(trim(f), '^@+', '')) from unnest(p_followers) f)
   where v.campaign = p_campaign;
  select count(*) into n from luciano_votes where campaign = p_campaign and verified;
  return n;
end;
$$;

create or replace function public.luciano_draw(p_key text, p_campaign text)
returns table (handle text, song text, created_at timestamptz, pool bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_check_key(p_key);
  return query
    select v.handle, v.song, v.created_at, count(*) over ()
    from luciano_votes v
    where v.campaign = p_campaign and v.verified
    order by random()
    limit 1;
end;
$$;

create or replace function public.luciano_entries(p_key text, p_campaign text)
returns table (handle text, song text, verified boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_check_key(p_key);
  return query
    select v.handle, v.song, v.verified, v.created_at
    from luciano_votes v
    where v.campaign = p_campaign
    order by v.id;
end;
$$;

create or replace function public.luciano_signups(p_key text, p_campaign text)
returns table (kind text, contact text, created_at timestamptz, notified_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_check_key(p_key);
  return query
    select n.kind, n.contact, n.created_at, n.notified_at
    from luciano_notify n
    where n.campaign = p_campaign
    order by n.id;
end;
$$;

-- Set the follower count by hand (when there's no Instagram token) or open the giveaway now.
create or replace function public.luciano_admin_followers(p_key text, p_followers int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_check_key(p_key);
  perform luciano_set_followers(p_followers);
end;
$$;

create or replace function public.luciano_admin_unlock(p_key text, p_campaign text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform luciano_check_key(p_key);
  update luciano_campaigns set unlocked_at = coalesce(unlocked_at, now()) where id = p_campaign;
end;
$$;


-- Who can call what ----------------------------------------------------------

revoke execute on function
  public.luciano_ip_hash(text),
  public.luciano_set_followers(int),
  public.luciano_status(text),
  public.luciano_vote(text, text, text),
  public.luciano_notify_me(text, text),
  public.luciano_claim_check(),
  public.luciano_save_token(text),
  public.luciano_claim_notifications(text[], int),
  public.luciano_unclaim_notification(bigint),
  public.luciano_check_key(text),
  public.luciano_results(text, text),
  public.luciano_verify(text, text, text[]),
  public.luciano_draw(text, text),
  public.luciano_entries(text, text),
  public.luciano_signups(text, text),
  public.luciano_admin_followers(text, int),
  public.luciano_admin_unlock(text, text)
from public, anon, authenticated;

grant execute on function
  public.luciano_status(text),
  public.luciano_vote(text, text, text),
  public.luciano_notify_me(text, text),
  public.luciano_results(text, text),
  public.luciano_verify(text, text, text[]),
  public.luciano_draw(text, text),
  public.luciano_entries(text, text),
  public.luciano_signups(text, text),
  public.luciano_admin_followers(text, int),
  public.luciano_admin_unlock(text, text)
to anon, authenticated;


-- Setup: edit these, then run --------------------------------------------------

-- The giveaway: same id, song ids and end date as CAMPAIGN in campaigns/config.js.
-- To close it early: update luciano_campaigns set open = false where id = 'next-single-2026';
insert into public.luciano_campaigns (id, songs, ends_at, goal)
values ('next-single-2026', array['song-1', 'song-2', 'song-3'], '2026-11-15 23:59 Europe/Copenhagen', 150)
on conflict (id) do update set songs = excluded.songs, ends_at = excluded.ends_at, goal = excluded.goal;

-- Password for campaigns/admin.html. Use something long. To change it later:
-- delete from luciano_admin; then run this line again with the new one.
-- insert into public.luciano_admin (key) values ('CHANGE-ME-to-a-long-random-password');
