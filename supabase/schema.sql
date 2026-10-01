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

-- Added after launch: you are only matchable once you ask to be. Without
-- this, find_match grabbed anyone idle in the lobby and yanked them into a
-- room they never agreed to join.
alter table public.sessions add column if not exists seeking boolean not null default false;

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

  -- Calling this IS the request to be matched, so raise my own hand first.
  -- It stays raised between polls, which is how the other side finds me.
  update public.sessions s set seeking = true where s.id = p_session;

  select s.* into v_partner
  from public.sessions s
  where s.id <> p_session
    and s.room_id is null
    and s.seeking = true
    and s.expires_at > now()
  order by random()
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  v_room := gen_random_uuid();

  -- Matched: both hands come down.
  update public.sessions s
     set room_id = v_room, partner_nickname = v_partner.nickname, seeking = false
   where s.id = v_me.id;

  update public.sessions s
     set room_id = v_room, partner_nickname = v_me.nickname, seeking = false
   where s.id = v_partner.id;

  return query select v_room, v_partner.nickname;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tic-tac-toe, played inside an existing match.
--
-- The board is nine characters of '-', 'X' or 'O', read left to right, top to
-- bottom. One string is atomic to update and trivial to validate, which beats
-- a cell table for a game this small.
--
-- Every rule is enforced here rather than in the app: the client is a display
-- and nothing more.
-- ---------------------------------------------------------------------------
create table if not exists public.games (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid        not null,
  player_x   uuid        not null,
  player_o   uuid        not null,
  board      text        not null default '---------' check (char_length(board) = 9),
  turn       text        not null default 'X'         check (turn in ('X', 'O')),
  status     text        not null default 'active'    check (status in ('active', 'won', 'draw', 'abandoned')),
  winner     text                                     check (winner in ('X', 'O')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists games_room_idx on public.games (room_id, created_at desc);

-- Widen the status check on databases created before 'abandoned' existed.
-- `create table if not exists` above leaves an existing table alone, so this
-- is how the constraint catches up.
alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check
  check (status in ('active', 'won', 'draw', 'abandoned'));

-- Which symbol, if any, owns a completed line.
create or replace function public.ttt_winner(p_board text)
returns text
language sql
immutable
as $$
  select substr(p_board, l.a, 1)
  from (values (1,2,3), (4,5,6), (7,8,9),
               (1,4,7), (2,5,8), (3,6,9),
               (1,5,9), (3,5,7)) as l(a, b, c)
  where substr(p_board, l.a, 1) <> '-'
    and substr(p_board, l.a, 1) = substr(p_board, l.b, 1)
    and substr(p_board, l.a, 1) = substr(p_board, l.c, 1)
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Start a game, or join the one already running in this room.
--
-- Also serves as REMATCH: a finished game is never 'active', so asking again
-- deals a new one. Both players mashing the button at once is fine -- the
-- advisory lock serialises the room, so the second caller joins the first
-- caller's game instead of creating a duplicate.
-- ---------------------------------------------------------------------------
create or replace function public.start_game(p_session uuid)
returns public.games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      public.sessions%rowtype;
  v_partner public.sessions%rowtype;
  v_game    public.games%rowtype;
  v_x       uuid;
  v_o       uuid;
begin
  select s.* into v_me
  from public.sessions s
  where s.id = p_session and s.expires_at > now();

  if not found then
    raise exception 'Your toilet session has expired.' using errcode = 'P0001';
  end if;

  if v_me.room_id is null then
    raise exception 'You are not matched with anyone yet.' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_me.room_id::text, 0));

  select g.* into v_game
  from public.games g
  where g.room_id = v_me.room_id and g.status = 'active'
  order by g.created_at desc
  limit 1;

  if found then
    return v_game;
  end if;

  select s.* into v_partner
  from public.sessions s
  where s.room_id = v_me.room_id
    and s.id <> p_session
    and s.expires_at > now()
  limit 1;

  if not found then
    raise exception 'Your partner has left.' using errcode = 'P0001';
  end if;

  -- Coin flip for who is X, and X always moves first.
  if random() < 0.5 then
    v_x := v_me.id;      v_o := v_partner.id;
  else
    v_x := v_partner.id; v_o := v_me.id;
  end if;

  insert into public.games (room_id, player_x, player_o)
  values (v_me.room_id, v_x, v_o)
  returning * into v_game;

  return v_game;
end;
$$;

-- ---------------------------------------------------------------------------
-- Play one cell. p_cell is 0..8 to match the JavaScript side; SQL strings are
-- 1-indexed, so it is shifted once, here.
--
-- Rejects, in order: a bad cell, an unknown game, a finished game, an expired
-- session, someone who is not a player, playing out of turn, and an occupied
-- cell. `for update` means two simultaneous moves are serialised rather than
-- both reading the same stale board.
-- ---------------------------------------------------------------------------
create or replace function public.make_move(p_session uuid, p_game uuid, p_cell integer)
returns public.games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game   public.games%rowtype;
  v_symbol text;
  v_pos    integer;
  v_board  text;
  v_winner text;
  v_status text;
  v_turn   text;
begin
  if p_cell is null or p_cell < 0 or p_cell > 8 then
    raise exception 'That square does not exist.' using errcode = 'P0001';
  end if;
  v_pos := p_cell + 1;

  select g.* into v_game from public.games g where g.id = p_game for update;
  if not found then
    raise exception 'That game is gone.' using errcode = 'P0001';
  end if;

  if v_game.status <> 'active' then
    raise exception 'That game is already over.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.sessions s where s.id = p_session and s.expires_at > now()
  ) then
    raise exception 'Your toilet session has expired.' using errcode = 'P0001';
  end if;

  if p_session = v_game.player_x then
    v_symbol := 'X';
  elsif p_session = v_game.player_o then
    v_symbol := 'O';
  else
    raise exception 'You are not in this game.' using errcode = 'P0001';
  end if;

  if v_game.turn <> v_symbol then
    raise exception 'Not your turn.' using errcode = 'P0001';
  end if;

  if substr(v_game.board, v_pos, 1) <> '-' then
    raise exception 'That square is taken.' using errcode = 'P0001';
  end if;

  v_board  := overlay(v_game.board placing v_symbol from v_pos for 1);
  v_winner := public.ttt_winner(v_board);

  if v_winner is not null then
    v_status := 'won';
    v_turn   := v_game.turn;
  elsif position('-' in v_board) = 0 then
    v_status := 'draw';
    v_turn   := v_game.turn;
  else
    v_status := 'active';
    v_turn   := case when v_symbol = 'X' then 'O' else 'X' end;
  end if;

  update public.games
     set board = v_board, turn = v_turn, status = v_status,
         winner = v_winner, updated_at = now()
   where id = p_game
  returning * into v_game;

  return v_game;
end;
$$;

-- ---------------------------------------------------------------------------
-- Leave the current room, keeping the toilet session alive.
--
-- This is the whole point of the session/room split: the session row survives,
-- only its room is cleared, so the user drops back to the lobby without
-- re-verifying and the 15 minute clock keeps running.
--
-- Both sides are returned to the lobby. The partner finds out through the
-- realtime UPDATE on their own session row -- there is nobody left to talk to,
-- so leaving them sitting in a dead room would be worse than moving them.
-- ---------------------------------------------------------------------------
create or replace function public.leave_room(p_session uuid)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   public.sessions%rowtype;
  v_room uuid;
begin
  select s.* into v_me from public.sessions s where s.id = p_session;

  if not found then
    raise exception 'That session is gone.' using errcode = 'P0001';
  end if;

  v_room := v_me.room_id;

  -- Already in the lobby. Nothing to do, and no error either.
  if v_room is null then
    return v_me;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_room::text, 0));

  -- Anything still being played in there is over now. Finished games keep
  -- their result; only a live one is abandoned.
  update public.games g
     set status = 'abandoned', updated_at = now()
   where g.room_id = v_room and g.status = 'active';

  update public.sessions s
     set room_id = null, partner_nickname = null, seeking = false
   where s.room_id = v_room;

  select s.* into v_me from public.sessions s where s.id = p_session;
  return v_me;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: the partner needs to find out they got matched, and both sides
-- need to see messages land.
-- ---------------------------------------------------------------------------
alter table public.sessions replica identity full;
alter table public.games    replica identity full;

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
  begin
    alter publication supabase_realtime add table public.games;
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
alter table public.games    enable row level security;

drop policy if exists "mvp_sessions_all" on public.sessions;
create policy "mvp_sessions_all" on public.sessions
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "mvp_messages_all" on public.messages;
create policy "mvp_messages_all" on public.messages
  for all to anon, authenticated using (true) with check (true);

-- Games are readable and writable by the anon key like everything else, but
-- the RPCs above are the only sane way in: they are the rule engine.
drop policy if exists "mvp_games_all" on public.games;
create policy "mvp_games_all" on public.games
  for all to anon, authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Optional janitor. Expired rows are already filtered out everywhere, this
-- just stops the table growing forever. Requires pg_cron.
-- ---------------------------------------------------------------------------
-- select cron.schedule('shitchat-sweep', '*/15 * * * *', $$
--   delete from public.games    where updated_at < now() - interval '1 hour';
--   delete from public.messages where created_at < now() - interval '1 hour';
--   delete from public.sessions where expires_at  < now() - interval '1 hour';
-- $$);
