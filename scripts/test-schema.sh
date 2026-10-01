#!/usr/bin/env bash
# Apply supabase/schema.sql to a throwaway Postgres and exercise the RPCs.
#
# Exists because a `returns table (room_id ...)` column silently shadowed
# sessions.room_id, making matchmaking fail with 42702 in production while
# looking perfectly fine in review. The game rules live in SQL too, so they
# are checked the same way. Requires docker.
set -euo pipefail

CONTAINER=shitchat-schema-test
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT=/tmp/shitchat-schema-test.out

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
: > "$OUT"

echo "starting postgres..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=pg postgres:16-alpine >/dev/null
# Readiness is genuinely fiddly here. During initdb the image starts a
# temporary server on the same socket, runs setup, then shuts it down and
# starts the real one -- so both pg_isready and a successful `select 1` can
# pass against a server that is about to disappear. Wait for the image's own
# "init process complete" marker first, then for a query to work.
for _ in $(seq 1 90); do
  if docker logs "$CONTAINER" 2>&1 | grep -q 'init process complete'; then break; fi
  sleep 1
done

ready=0
for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" psql -U postgres -q -c 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  echo "postgres never accepted connections. Container log:"
  docker logs "$CONTAINER" 2>&1 | tail -20
  exit 1
fi

# Supabase ships these roles; plain Postgres does not.
docker exec "$CONTAINER" psql -U postgres -q -c "create role anon; create role authenticated;"

echo "applying schema..."
docker cp "$ROOT/supabase/schema.sql" "$CONTAINER:/schema.sql" >/dev/null
docker exec "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 -f /schema.sql

# Assertions arrive two ways: plain selects on stdout, and RAISE NOTICE (which
# psql writes to stderr) from the plpgsql blocks. Fold both into "key:value".
SQL_ERRORS=0
run_sql() {
  local raw
  # `|| true`: a failing block must still report, not kill the run via set -e.
  raw="$(docker exec -i "$CONTAINER" psql -U postgres -q -t -A -v ON_ERROR_STOP=1 2>&1)" || true
  if grep -q '^ERROR:' <<<"$raw"; then
    echo "  SQL ERROR (aborts the rest of this block):"
    grep '^ERROR:' <<<"$raw" | sed 's/^/    /'
    SQL_ERRORS=1
  fi
  sed -e 's/^NOTICE:  CHECK //' <<<"$raw" | grep -E '^[a-z_]+:' >> "$OUT" || true
}

echo "testing matchmaking..."
run_sql <<'SQL'
truncate public.sessions, public.messages, public.games;
insert into public.sessions (device_id, nickname) values ('devA','A'), ('devB','B'), ('devC','C');

-- Asking first when nobody else has asked matches nobody, but raises my hand.
select 'first_ask:' || count(*) from public.find_match((select id from public.sessions where device_id='devA'));
select 'now_seeking:' || count(*) from public.sessions where device_id='devA' and seeking;

-- The second person to ask finds the first.
select 'second_ask:' || count(*) from public.find_match((select id from public.sessions where device_id='devB'));

select 'paired:' || count(*) from public.sessions
 where room_id = (select room_id from public.sessions where device_id='devA')
   and room_id is not null;

-- C never asked, so C is still sitting in the lobby, unmatched and untouched.
select 'bystander_free:' || count(*) from public.sessions
 where device_id='devC' and room_id is null and not seeking;

-- Matching lowers both hands.
select 'hands_down:' || count(*) from public.sessions
 where device_id in ('devA','devB') and not seeking;

select 'idempotent:' || count(*) from public.find_match((select id from public.sessions where device_id='devA'));

truncate public.sessions;
insert into public.sessions (device_id, nickname) values ('solo','S');
select 'alone:' || count(*) from public.find_match((select id from public.sessions where device_id='solo'));

-- An expired session is no partner, even with its hand up.
insert into public.sessions (device_id, nickname, expires_at, seeking)
values ('dead','D', now() - interval '1 minute', true);
select 'expired_ignored:' || count(*) from public.find_match((select id from public.sessions where device_id='solo'));

select 'headcount:' || public.active_count();
SQL

echo "testing tic-tac-toe..."
run_sql <<'SQL'
truncate public.sessions, public.messages, public.games;
insert into public.sessions (device_id, nickname, room_id)
values ('devA','A','11111111-1111-1111-1111-111111111111'),
       ('devB','B','11111111-1111-1111-1111-111111111111');

-- Line detection, independent of any game row.
select 'win_row:'  || coalesce(public.ttt_winner('XXX--O-O-'), 'none');
select 'win_col:'  || coalesce(public.ttt_winner('X-OX-OX--'), 'none');
select 'win_diag:' || coalesce(public.ttt_winner('O--XO--XO'), 'none');
select 'win_none:' || coalesce(public.ttt_winner('XOXOXOOXO'), 'none');

do $$
declare
  a uuid; b uuid; g public.games; g2 public.games; x uuid; o uuid;
begin
  select id into a from public.sessions where device_id = 'devA';
  select id into b from public.sessions where device_id = 'devB';

  g := public.start_game(a);
  x := g.player_x; o := g.player_o;
  raise notice 'CHECK fresh_board:%', g.board;

  -- Asking again joins the running game rather than dealing a second one.
  if (public.start_game(b)).id = g.id then
    raise notice 'CHECK join_existing:1';
  else raise notice 'CHECK join_existing:0'; end if;

  begin perform public.make_move(o, g.id, 0);
    raise notice 'CHECK wrong_turn_blocked:0';
  exception when others then raise notice 'CHECK wrong_turn_blocked:1'; end;

  begin perform public.make_move(gen_random_uuid(), g.id, 0);
    raise notice 'CHECK stranger_blocked:0';
  exception when others then raise notice 'CHECK stranger_blocked:1'; end;

  perform public.make_move(x, g.id, 0);

  begin perform public.make_move(o, g.id, 0);
    raise notice 'CHECK occupied_blocked:0';
  exception when others then raise notice 'CHECK occupied_blocked:1'; end;

  begin perform public.make_move(o, g.id, 9);
    raise notice 'CHECK offboard_blocked:0';
  exception when others then raise notice 'CHECK offboard_blocked:1'; end;

  -- X takes the top row against O on the middle row.
  perform public.make_move(o, g.id, 3);
  perform public.make_move(x, g.id, 1);
  perform public.make_move(o, g.id, 4);
  g := public.make_move(x, g.id, 2);

  raise notice 'CHECK won_status:%', g.status;
  raise notice 'CHECK won_by:%', g.winner;
  raise notice 'CHECK won_board:%', g.board;

  begin perform public.make_move(o, g.id, 5);
    raise notice 'CHECK move_after_end_blocked:0';
  exception when others then raise notice 'CHECK move_after_end_blocked:1'; end;

  g2 := public.start_game(a);
  if g2.id <> g.id and g2.board = '---------' and g2.status = 'active' then
    raise notice 'CHECK rematch_fresh:1';
  else raise notice 'CHECK rematch_fresh:0'; end if;
end $$;

-- A full board with no line is a draw, not a win.
do $$
declare a uuid; g public.games; x uuid; o uuid; i integer;
  -- Moves alternate, so the sequence is X,O,X,O,... and lands on
  --   X O X
  --   X O O
  --   O X X
  -- which fills the board without ever completing a line.
  seq integer[] := array[0, 1, 2, 4, 3, 5, 7, 6, 8];
begin
  truncate public.games;
  select id into a from public.sessions where device_id = 'devA';
  g := public.start_game(a);
  x := g.player_x; o := g.player_o;
  for i in 1 .. array_length(seq, 1) loop
    g := public.make_move(case when i % 2 = 1 then x else o end, g.id, seq[i]);
  end loop;
  raise notice 'CHECK draw_status:%', g.status;
  raise notice 'CHECK draw_board:%', g.board;
  raise notice 'CHECK draw_winner:%', coalesce(g.winner, 'none');
end $$;

-- An expired session cannot play, or start anything new.
do $$
declare a uuid; g public.games;
begin
  truncate public.games;
  select id into a from public.sessions where device_id = 'devA';
  g := public.start_game(a);
  update public.sessions set expires_at = now() - interval '1 minute';

  begin perform public.make_move(g.player_x, g.id, 0);
    raise notice 'CHECK expired_move_blocked:0';
  exception when others then raise notice 'CHECK expired_move_blocked:1'; end;

  begin perform public.start_game(a);
    raise notice 'CHECK expired_start_blocked:0';
  exception when others then raise notice 'CHECK expired_start_blocked:1'; end;
end $$;
SQL

echo "testing leave room vs end session..."
run_sql <<'SQL'
truncate public.sessions, public.messages, public.games;
insert into public.sessions (device_id, nickname) values ('devA','A'), ('devB','B');

do $$
declare a uuid; b uuid; g public.games; room uuid; started timestamptz; expires timestamptz;
begin
  select id into a from public.sessions where device_id='devA';
  select id into b from public.sessions where device_id='devB';

  perform public.find_match(a);
  perform public.find_match(b);
  select room_id, created_at, expires_at into room, started, expires
    from public.sessions where id = a;

  -- Play a game, then walk out mid-game.
  g := public.start_game(a);
  perform public.make_move(g.player_x, g.id, 0);
  perform public.leave_room(a);

  raise notice 'CHECK left_game_abandoned:%',
    (select status from public.games where id = g.id);

  -- The session itself is untouched: still alive, same clock, same row.
  raise notice 'CHECK session_survives:%',
    (select count(*) from public.sessions where id = a and expires_at > now());
  raise notice 'CHECK clock_untouched:%',
    (select count(*) from public.sessions where id = a and expires_at = expires and created_at = started);

  -- Both sides are back in the lobby, neither is still seeking.
  raise notice 'CHECK both_in_lobby:%',
    (select count(*) from public.sessions where id in (a,b) and room_id is null and not seeking);

  -- The abandoned game is dead to everyone.
  begin
    perform public.make_move(g.player_x, g.id, 4);
    raise notice 'CHECK stale_game_blocked:0';
  exception when others then raise notice 'CHECK stale_game_blocked:1'; end;

  -- No room, so no game to start.
  begin
    perform public.start_game(a);
    raise notice 'CHECK start_without_room_blocked:0';
  exception when others then raise notice 'CHECK start_without_room_blocked:1'; end;

  -- And straight back into matchmaking, no re-verification anywhere.
  perform public.find_match(a);
  perform public.find_match(b);
  raise notice 'CHECK rematched_after_leaving:%',
    (select count(*) from public.sessions where id in (a,b) and room_id is not null);
  raise notice 'CHECK new_room:%',
    (select case when (select room_id from public.sessions where id=a) <> room then 1 else 0 end);

  -- Leaving when already in the lobby is a no-op, not an error.
  perform public.leave_room(a);
  perform public.leave_room(a);
  raise notice 'CHECK leave_twice_ok:1';
end $$;

-- A finished game keeps its result when the room is later left.
do $$
declare a uuid; b uuid; g public.games; x uuid; o uuid;
begin
  truncate public.games;
  select id into a from public.sessions where device_id='devA';
  select id into b from public.sessions where device_id='devB';
  -- The previous block left both of them in the lobby, so pair them again.
  perform public.find_match(a);
  perform public.find_match(b);
  g := public.start_game(a);
  x := g.player_x; o := g.player_o;
  perform public.make_move(x, g.id, 0);
  perform public.make_move(o, g.id, 3);
  perform public.make_move(x, g.id, 1);
  perform public.make_move(o, g.id, 4);
  g := public.make_move(x, g.id, 2);
  perform public.leave_room(a);
  raise notice 'CHECK finished_game_kept:%',
    (select status from public.games where id = g.id);
end $$;
SQL

FAILED=0
expect() {
  if grep -qx "$1" "$OUT"; then
    echo "  ok   $1"
  else
    echo "  FAIL expected '$1', got: $(grep "^${1%%:*}:" "$OUT" || echo '<nothing>')"
    FAILED=1
  fi
}

# matchmaking
expect "first_ask:0"
expect "now_seeking:1"
expect "second_ask:1"
expect "paired:2"
expect "bystander_free:1"
expect "hands_down:2"
expect "idempotent:1"
expect "alone:0"
expect "expired_ignored:0"
expect "headcount:1"

# tic-tac-toe
expect "win_row:X"
expect "win_col:X"
expect "win_diag:O"
expect "win_none:none"
expect "fresh_board:---------"
expect "join_existing:1"
expect "wrong_turn_blocked:1"
expect "stranger_blocked:1"
expect "occupied_blocked:1"
expect "offboard_blocked:1"
expect "won_status:won"
expect "won_by:X"
expect "won_board:XXXOO----"
expect "move_after_end_blocked:1"
expect "rematch_fresh:1"
expect "draw_status:draw"
expect "draw_board:XOXXOOOXX"
expect "draw_winner:none"
expect "expired_move_blocked:1"
expect "expired_start_blocked:1"

# leave room vs end session
expect "left_game_abandoned:abandoned"
expect "session_survives:1"
expect "clock_untouched:1"
expect "both_in_lobby:2"
expect "stale_game_blocked:1"
expect "start_without_room_blocked:1"
expect "rematched_after_leaving:2"
expect "new_room:1"
expect "leave_twice_ok:1"
expect "finished_game_kept:won"

if [ "$SQL_ERRORS" = "1" ]; then FAILED=1; fi
if [ "$FAILED" = "1" ]; then
  echo "schema tests FAILED"
  exit 1
fi
echo "schema tests passed"
