# 💩 ShitChat

Anonymous 15-minute chat for people who are currently on the toilet. You cannot
get in without photographing yourself doing a randomly assigned hand sign next
to a toilet. The photo is checked on your phone and deleted. It is never uploaded.

Expo + React Native + TypeScript + Supabase.

## Run it

**1. Database**

Create a Supabase project, open the SQL editor, paste all of
[`supabase/schema.sql`](supabase/schema.sql), run it. That creates the two
tables, the two RPCs, the realtime publications and the (wide open, MVP-only)
RLS policies.

**2. Keys**

```bash
cp .env.example .env
# fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
```

**3. Go**

```bash
npm install
npx expo start -c      # -c matters the first time, to pick up .env
```

If that dies with `EMFILE: too many open files`, that is an OS watcher limit,
not the app — see [Troubleshooting](#troubleshooting) for the one-line fix and a
no-sudo fallback.

Scan the QR code with Expo Go. The camera does not work in the iOS Simulator —
use a real phone, or the web build (see Testing).

To actually test the matchmaking you need **two devices** (or one phone plus a
second one running the same dev server). One person taps match, the other gets
pulled into the room automatically.

## The loop

1. Home screen shows a headcount and one button: **I'M SHITTING**.
2. Tapping it rolls a random hand sign — peace, thumbs up, vulcan salute, etc.
3. Camera opens. You photograph the toilet plus the hand sign.
4. The photo is verified **locally** (see below) and deleted.
5. On success you get a 15-minute session and a silly throwaway nickname.
6. **MATCH ME WITH A STRANGER** pairs you with another live session.
7. Realtime anonymous chat until the clock runs out.
8. At 0:00 the session is deleted and everyone goes home.

## About the photo

It never leaves the device. There is no storage bucket, no upload, no base64 in
any table. The flow is: capture → downscale in memory → decode to pixels →
measure → `delete()` the file. Both the original capture and the downscaled copy
are removed in a `finally` block, so they go even if verification throws.

### What the local check actually does

`src/lib/proofMath.ts` measures three things and rejects the photo if any fail:

| Check | Rejects |
|---|---|
| mean brightness within 18–245 | black frames, thumb over the lens, photos of a lamp |
| brightness variation ≥ `max(7, 0.06 × mean)` | blank walls, ceilings, pocket shots |
| ≥1.5% skin-tone pixels | frames with no hand in them |

The variation threshold is **relative to brightness on purpose**. Bathrooms are
dim, dim scenes have genuinely compressed contrast, and a fixed threshold
rejected real photos taken in bad light. A flat surface scores near zero at any
brightness, so the ratio separates the two.

`npm run test:proof` runs these thresholds against synthetic frames (black,
blank, blown out, textured wall, dim-with-hand, etc.) and fails if a tweak
starts rejecting real-looking photos.

### What it does NOT do

**It cannot tell a peace sign from a thumbs up.** `classifyGesture()` in
`src/lib/proofMath.ts` is a stub that returns `true`.

Real per-gesture recognition needs 21-point hand landmarks — MediaPipe Hands or
a TFLite hand-landmarker — which needs a custom dev build and does not fit in an
Expo Go prototype. The checks above still block the lazy cheats (black screen,
pointing at a wall, photographing nothing), but a determined liar can hold up
any hand at all. To make it real, replace that one function and compare finger
extension against `challenge.id`; nothing else in the app changes.

Also worth knowing: the skin heuristic matches beige and wooden surfaces. It is
the brightness-variation check that stops a plain beige wall from passing.

## Testing it

### Without a phone, right now

```bash
npm run test:proof     # pins the photo-check thresholds against synthetic frames
npm run typecheck
npx expo-doctor
```

### Without a phone, in a browser

The app builds and runs on web, which is the fastest way to exercise matchmaking
and chat without owning two phones:

```bash
npx expo start --web          # if the dev server works on your machine
npm run web:preview           # if it does not -- see Troubleshooting (EMFILE)
```

Open it in **two different browsers** (or one normal + one private window) so
each gets its own device id, and drive both sides.

Caveat: the home/session/chat screens are confirmed working on web, but the
**camera step on web is unverified** — it goes through `getUserMedia` and a
different `expo-image-manipulator` backend than the phone does. If it misbehaves,
use the `judge()` bypass below to get past it and test everything downstream, and
do your real camera testing on a phone.

### On a phone

```bash
npx expo start -c
```

Scan with Expo Go. The camera step needs a real device or a browser — it does
not work in the iOS Simulator.

### Faking a second person

You do not need a second device to test matching and chat. Insert a ghost
session in the Supabase SQL editor:

```sql
insert into public.sessions (device_id, nickname)
values ('ghost-tester', 'Grumpy Plunger');
```

Now tap **MATCH ME WITH A STRANGER** on your device — `find_match` will pair you
with the ghost. To make the ghost talk back (this arrives over realtime, so it
should pop into your chat instantly):

```sql
insert into public.messages (room_id, sender_session, nickname, body)
select room_id, id, nickname, 'i am also pooping'
from public.sessions where device_id = 'ghost-tester';
```

Add a few more ghosts to watch the home-screen headcount move. Clean up with:

```sql
delete from public.sessions where device_id like 'ghost-%';
```

### Testing the bits that take 15 minutes

- **Session expiry:** drop `SESSION_MINUTES` in [`src/lib/session.ts`](src/lib/session.ts)
  to `0.5`. The client sends an explicit `expires_at`, so that one constant is
  enough — you do not need to touch the schema default.
- **Skipping the camera** while iterating on later screens: make `judge()` in
  [`src/lib/proofMath.ts`](src/lib/proofMath.ts) return `{ ok: true, stats }`
  as its first line. Put it back before you trust any verification result.

### What to actually check

| | Expect |
|---|---|
| Point camera at a dark surface / cover the lens | rejected, "is your thumb on the lens?" |
| Point at a blank wall | rejected, "that is a blank wall" |
| Toilet + your hand in frame | accepted, session starts |
| Two clients, one taps match | **both** land in the chat, the second without tapping anything |
| Send from either side | appears on the other within a second |
| Let the clock run out | both sides hit the expired screen, row is deleted |

Note that the gesture itself is not checked — any hand passes. See above.

## Troubleshooting

### `Error: EMFILE: too many open files, watch` on `expo start`

Metro's file watcher runs out of inotify instances before it finishes walking
`node_modules`. This kills **every** form of `expo start` — web and phone alike —
and it is an OS limit, not a problem with the app.

It happens when `watchman` is not installed (Metro falls back to a watcher that
burns an inotify instance per directory) and `fs.inotify.max_user_instances` is
at a low default like 128.

**Fix it properly** (needs your sudo password, gives you back hot reload):

```bash
sudo sysctl -w fs.inotify.max_user_instances=1024
sudo sysctl -w fs.inotify.max_user_watches=524288
npx expo start -c
```

Make it stick across reboots:

```bash
echo -e "fs.inotify.max_user_instances=1024\nfs.inotify.max_user_watches=524288" \
  | sudo tee /etc/sysctl.d/99-metro.conf
sudo sysctl --system
```

Installing `watchman` also fixes it, and is what React Native expects on Linux.

**Or skip the dev server entirely** (no sudo, no hot reload):

```bash
npm run web:preview     # builds to dist/ and serves it on :8080
```

That path uses no file watcher at all, so the limit never comes up. It is a
production-style build, so rerun `npm run web:preview` after each code change.
This is the quickest way to get two clients side by side for testing
matchmaking — open the URL in two different browsers.

## Before this is anything but a prototype

The RLS policies let the anon key read and write every row, which means anyone
with the key can read every message. That is deliberate for an MVP with no
accounts, and it is the first thing to fix. Swap in Supabase anonymous auth and
scope the policies to `auth.uid()` / room membership.

Expired rows are filtered out of every query but not deleted. There is a
commented-out `pg_cron` sweeper at the bottom of the schema if the table grows.

## Layout

```
App.tsx                  route state machine + the 15-minute kill timer
src/lib/proofMath.ts     pure pixel math and thresholds (testable in node)
src/lib/verify.ts        decode the photo, hand it to proofMath
src/lib/shred.ts         delete temp images off disk
src/lib/session.ts       sessions, headcount, matchmaking, messages, realtime
src/lib/challenges.ts    the hand signs
src/lib/identity.ts      per-install id + throwaway nicknames
src/screens/             home, challenge, camera, session, chat
supabase/schema.sql      run this once
scripts/proof-check.js   threshold regression test
```

Not implemented, on purpose: profiles, friends, notifications, moderation,
payments, clever matchmaking.
