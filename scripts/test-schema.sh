#!/usr/bin/env bash
# Apply supabase/schema.sql to a throwaway Postgres and exercise find_match.
#
# Exists because a `returns table (room_id ...)` column silently shadowed
# `sessions.room_id`, making matchmaking fail with 42702 in production while
# looking perfectly fine in review. Requires docker.
set -euo pipefail

CONTAINER=shitchat-schema-test
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "starting postgres..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=pg postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

# Supabase ships these roles; plain Postgres does not.
docker exec "$CONTAINER" psql -U postgres -q -c "create role anon; create role authenticated;"

echo "applying schema..."
docker cp "$ROOT/supabase/schema.sql" "$CONTAINER:/schema.sql" >/dev/null
docker exec "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 -f /schema.sql

echo "testing matchmaking..."
docker exec -i "$CONTAINER" psql -U postgres -q -t -A -v ON_ERROR_STOP=1 <<'SQL' > /tmp/shitchat-schema-test.out
truncate public.sessions, public.messages;
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

expect() {
  if grep -qx "$1" /tmp/shitchat-schema-test.out; then
    echo "  ok   $1"
  else
    echo "  FAIL expected '$1', got: $(grep "^${1%%:*}:" /tmp/shitchat-schema-test.out || echo '<nothing>')"
    FAILED=1
  fi
}

FAILED=0
expect "matched:1"          # A got a room
expect "paired:2"           # ...and so did B, the same one
expect "idempotent:1"       # asking twice returns the same room
expect "alone:0"            # nobody to match with
expect "expired_ignored:0"  # dead sessions are not partners
expect "headcount:1"        # only the live one counts

if [ "$FAILED" = "1" ]; then
  echo "schema tests FAILED"
  exit 1
fi
echo "schema tests passed"
