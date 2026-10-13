-- 99 LUCIANO giveaway. Run in Supabase → SQL Editor (safe to run again).
-- The tables are locked (row level security on, no policies). The site can only
-- reach them through the functions below.

create table if not exists public.luciano_campaigns (
  id      text primary key,
  songs   text[] not null,          -- song ids, must match CAMPAIGN.songs in campaigns/config.js
  ends_at timestamptz,
  open    boolean not null default true
);

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

create table if not exists public.luciano_admin (
  key text primary key
);

alter table public.luciano_campaigns enable row level security;
alter table public.luciano_votes enable row level security;
alter table public.luciano_admin enable row level security;
revoke all on public.luciano_campaigns, public.luciano_votes, public.luciano_admin from anon, authenticated;


-- Vote ---------------------------------------------------------------------
-- Returns 'ok', 'already', 'closed', 'bad_handle', 'bad_song' or 'too_many'.

create or replace function public.luciano_vote(p_campaign text, p_handle text, p_song text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c luciano_campaigns;
  h text;
  headers json;
  ip text;
  n int;
begin
  select * into c from luciano_campaigns where id = p_campaign;
  if not found or not c.open or (c.ends_at is not null and now() > c.ends_at) then
    return 'closed';
  end if;

  h := lower(regexp_replace(trim(coalesce(p_handle, '')), '^@+', ''));
  if h !~ '^[a-z0-9._]{1,30}$' or h ~ '(^\.|\.$|\.\.)' then
    return 'bad_handle';
  end if;

  if not (p_song = any (c.songs)) then
    return 'bad_song';
  end if;

  -- At most 8 entries per network, so one person can't flood the vote.
  headers := nullif(current_setting('request.headers', true), '')::json;
  ip := coalesce(headers ->> 'cf-connecting-ip', split_part(headers ->> 'x-forwarded-for', ',', 1));
  if coalesce(ip, '') <> '' then
    ip := md5(c.id || ':' || trim(ip));
    select count(*) into n from luciano_votes where campaign = c.id and ip_hash = ip;
    if n >= 8 then
      return 'too_many';
    end if;
  else
    ip := null;
  end if;

  insert into luciano_votes (campaign, handle, song, ip_hash)
  values (c.id, h, p_song, ip)
  on conflict (campaign, handle) do nothing;
  get diagnostics n = row_count;
  return case when n = 1 then 'ok' else 'already' end;
end;
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

revoke execute on function public.luciano_vote(text, text, text),
                           public.luciano_check_key(text),
                           public.luciano_results(text, text),
                           public.luciano_verify(text, text, text[]),
                           public.luciano_draw(text, text),
                           public.luciano_entries(text, text)
  from public;
grant execute on function public.luciano_vote(text, text, text),
                          public.luciano_results(text, text),
                          public.luciano_verify(text, text, text[]),
                          public.luciano_draw(text, text),
                          public.luciano_entries(text, text)
  to anon, authenticated;
revoke execute on function public.luciano_check_key(text) from anon, authenticated;


-- Setup: edit these two, then run --------------------------------------------

-- The giveaway: same id, song ids and end date as CAMPAIGN in campaigns/config.js.
-- To close it early: update luciano_campaigns set open = false where id = 'next-single-2026';
insert into public.luciano_campaigns (id, songs, ends_at)
values ('next-single-2026', array['song-1', 'song-2', 'song-3'], '2026-11-15 23:59 Europe/Copenhagen')
on conflict (id) do update set songs = excluded.songs, ends_at = excluded.ends_at;

-- Password for campaigns/admin.html. Use something long. To change it later:
-- delete from luciano_admin; then run this line again with the new one.
-- insert into public.luciano_admin (key) values ('CHANGE-ME-to-a-long-random-password');
