-- ShitChat MVP schema.
-- Paste this whole file into the Supabase SQL editor and run it.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- A toilet session. Lives for 15 minutes, then it is dead to us.
-- No proof image is ever stored here. Nothing is uploaded. Ever.
-- ---------------------------------------------------------------------------
create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  device_id        text        not null,
  nickname         text        not null,
  room_id          uuid,
  partner_nickname text,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '15 minutes'
);

create index if not exists sessions_expires_at_idx on public.sessions (expires_at);
create index if not exists sessions_room_id_idx    on public.sessions (room_id);

-- ---------------------------------------------------------------------------
-- Anonymous chat messages, scoped to a room.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id             bigserial primary key,
  room_id        uuid        not null,
  sender_session uuid        not null,
  nickname       text        not null,
  body           text        not null check (char_length(body) between 1 and 500),
  created_at     timestamptz not null default now()
);

create index if not exists messages_room_created_idx on public.messages (room_id, created_at);

-- ---------------------------------------------------------------------------
-- How many people are on the toilet right now.
-- ---------------------------------------------------------------------------
create or replace function public.active_count()
returns integer
language sql
stable
as $$
  select count(*)::int from public.sessions where expires_at > now();
$$;

-- ---------------------------------------------------------------------------
-- Dumb random matchmaking: grab any other unmatched live session, put both
-- of us in a fresh room. Returns nothing if nobody else is available.
-- ---------------------------------------------------------------------------
create or replace function public.find_match(p_session uuid)
returns table (room_id uuid, partner_nickname text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      public.sessions%rowtype;
  v_partner public.sessions%rowtype;
  v_room    uuid;
begin
  -- NOTE: every column reference below is alias-qualified on purpose.
  -- `returns table (room_id ...)` puts `room_id` and `partner_nickname` in
  -- scope as PL/pgSQL variables, so a bare `room_id` is ambiguous (42702).
  select s.* into v_me
  from public.sessions s
  where s.id = p_session and s.expires_at > now();

  if not found then
    return;
  end if;

  -- Already matched? Just hand back the existing room.
  if v_me.room_id is not null then
    return query select v_me.room_id, v_me.partner_nickname;
    return;
  end if;

  select s.* into v_partner
  from public.sessions s
  where s.id <> p_session
    and s.room_id is null
    and s.expires_at > now()
  order by random()
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  v_room := gen_random_uuid();

  update public.sessions s
     set room_id = v_room, partner_nickname = v_partner.nickname
   where s.id = v_me.id;

  update public.sessions s
     set room_id = v_room, partner_nickname = v_me.nickname
   where s.id = v_partner.id;

  return query select v_room, v_partner.nickname;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: the partner needs to find out they got matched, and both sides
-- need to see messages land.
-- ---------------------------------------------------------------------------
alter table public.sessions replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.sessions;
  exception when duplicate_object or undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object or undefined_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- RLS.
-- MVP ONLY: there are no accounts, so the anon key is allowed to do everything.
-- This is fine for a prototype and NOT fine for anything real -- anyone with
-- the anon key can read every message. See the README before shipping.
-- ---------------------------------------------------------------------------
alter table public.sessions enable row level security;
alter table public.messages enable row level security;

drop policy if exists "mvp_sessions_all" on public.sessions;
create policy "mvp_sessions_all" on public.sessions
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "mvp_messages_all" on public.messages;
create policy "mvp_messages_all" on public.messages
  for all to anon, authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Optional janitor. Expired rows are already filtered out everywhere, this
-- just stops the table growing forever. Requires pg_cron.
-- ---------------------------------------------------------------------------
-- select cron.schedule('shitchat-sweep', '*/15 * * * *', $$
--   delete from public.messages where created_at < now() - interval '1 hour';
--   delete from public.sessions where expires_at  < now() - interval '1 hour';
-- $$);
