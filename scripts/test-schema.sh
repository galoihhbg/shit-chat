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
ready=0
for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
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
  raw="$(docker exec -i "$CONTAINER" psql -U postgres -q -t -A -v ON_ERROR_STOP=1 2>&1)"
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
insert into public.sessions (device_id, nickname) values ('devA','A'), ('devB','B');

select 'matched:' || count(*) from public.find_match((select id from public.sessions where device_id='devA'));

select 'paired:' || count(*) from public.sessions
 where room_id = (select room_id from public.sessions where device_id='devA')
   and room_id is not null;

select 'idempotent:' || count(*) from public.find_match((select id from public.sessions where device_id='devA'));

truncate public.sessions;
insert into public.sessions (device_id, nickname) values ('solo','S');
select 'alone:' || count(*) from public.find_match((select id from public.sessions where device_id='solo'));

insert into public.sessions (device_id, nickname, expires_at)
values ('dead','D', now() - interval '1 minute');
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
expect "matched:1"
expect "paired:2"
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

if [ "$SQL_ERRORS" = "1" ]; then FAILED=1; fi
if [ "$FAILED" = "1" ]; then
  echo "schema tests FAILED"
  exit 1
fi
echo "schema tests passed"
