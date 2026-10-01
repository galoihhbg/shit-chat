# 💩 ShitChat

Anonymous 15-minute chat for people who are currently on the toilet. You cannot
get in without photographing yourself doing a randomly assigned hand sign next
to a toilet. The photo is checked on your phone and deleted. It is never uploaded.

Expo + React Native + TypeScript + Supabase.

## Run it

**1. Database**

Create a Supabase project, open the SQL editor, paste all of
[`supabase/schema.sql`](supabase/schema.sql), run it. That creates the three
tables (`sessions`, `messages`, `games`), the RPCs, the realtime publications
and the (wide open, MVP-only) RLS policies.

**Already had it running?** Re-run the whole file. It is idempotent —
`create table if not exists`, `create or replace function`, `drop policy if
exists` — so existing rows survive, and it is the only way to pick up the
`games` table and the tic-tac-toe RPCs.

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

This project needs a **development build** — Expo Go cannot load the native
MediaPipe module. See [Requires a development build](#requires-a-development-build).
The camera does not work in the iOS Simulator; use a real phone.

To actually test the matchmaking you need **two devices** (or one phone plus a
second one running the same dev server). One person taps match, the other gets
pulled into the room automatically.

## The loop

1. Home screen shows a headcount and one button: **I'M SHITTING**.
2. Tapping it rolls a random hand sign — peace, thumbs up, OK, etc.
3. Camera opens. You photograph the toilet plus the hand sign.
4. Two on-device models check hand, gesture and toilet. The photo is then deleted.
5. On success you get a 15-minute session and a silly throwaway nickname.
6. **MATCH ME WITH A STRANGER** — both sides have to tap it. Being on the
   toilet does not make you matchable; asking does.
7. Realtime anonymous chat, with a round of tic-tac-toe if you want one.
8. At 0:00 the session is deleted and you get a summary you can share.

## Proof verification

Two on-device MediaPipe models decide whether you get a session. Nothing is
uploaded, and no external API is called.

| check | how | fails with |
|---|---|---|
| Photo usable | pixel stats, [`proofMath.ts`](src/lib/proofMath.ts) | "too dark", "blank wall", "too bright" |
| Hand detected | MediaPipe Hand Landmarker, 21 keypoints | "No hand detected" |
| Correct gesture | landmark geometry, [`gestureClassifier.ts`](src/lib/gesture/gestureClassifier.ts) | "Wrong hand gesture" |
| Toilet detected | EfficientDet-Lite0, COCO `toilet` class | "No toilet detected" |

The cheap pixel check runs first so a black frame does not cost 12 MB of model
inference.

### Gestures

Eight, all classified from finger geometry rather than a gesture model:

`peace` ✌️ · `three` · `four` · `palm` 🖐️ · `fist` ✊ · `thumb` 👍 · `ok` 👌 · `point` ☝️

Finger extension is measured as "is the fingertip further from the wrist than
its knuckle", which is rotation- and scale-invariant — verified by the tests.
The one exception is THUMBS_UP, which is *defined* by pointing upward, so it
deliberately reads image orientation.

`npm run test:gesture` runs 11 unit tests over synthetic hands.

### Models

Downloaded once on first launch into the app's document directory, not bundled
into git or the APK:

- `hand_landmarker.task` (float16) — 7.8 MB
- `efficientdet_lite0.tflite` (int8, COCO) — 4.6 MB

Note the direction of travel: the **model comes down**, the photo never goes up.

### Privacy

The photo never leaves the device. There is no storage bucket, no upload call,
no base64 in any table. The flow is capture → downscale → analyse → delete.
Three files are shredded: the original capture, the 640px working copy, and the
128px stats copy. All in `finally` blocks, so they go even when a check throws.

On success the server is told only that a session started — `device_id`,
a throwaway nickname and an expiry. It is not told which gesture was used or
that a photo ever existed.

### What this does NOT do

- **It is not a security boundary.** Verification is client-side by design for
  this MVP. A determined person can patch the bundle. Nothing here is trusted
  for anything that matters.
- **The toilet detector is generic COCO.** It knows "toilet", not "your toilet",
  and not "a toilet you are currently using". A photo of any toilet passes, as
  does a picture of a picture of a toilet.
- **Gesture classification is geometric.** It reads a clear, front-on hand well.
  Heavy foreshortening, a hand edge-on to the camera, or partial occlusion will
  make it return "no clear gesture" and fail the attempt.
- **THUMBS_UP assumes an upright photo.** Shoot in portrait.
- **Unverified on real hardware.** The pure logic is unit tested, but the native
  MediaPipe integration has not been run on a physical device — see the build
  notes below.

## Playing a game

Chat and tic-tac-toe live in the same screen. The **PLAY** button in the chat
header swaps the view; **BACK TO CHAT** swaps it back. Both the chat and game
subscriptions stay mounted the whole time, so messages keep arriving while you
play and the board keeps up while you type.

Whoever taps PLAY first deals the game; the other side gets
**🚽 YOU'VE BEEN CHALLENGED** and a red dot on the PLAY button. Asking again
after a result is the rematch — same call, new board.

### The server is the referee

Every rule lives in [`supabase/schema.sql`](supabase/schema.sql), not in the
app. `make_move` rejects, in order: an out-of-range cell, an unknown game, a
finished game, an expired session, a player who is not in this game, a move out
of turn, and an occupied square. It takes `for update` on the row first, so two
simultaneous moves serialise instead of both reading the same stale board.

The client mirrors those checks in `canPlay()` purely to avoid a pointless
round trip. Deleting that mirror would change nothing about what is possible.

`start_game` takes a per-room advisory lock, so both players mashing PLAY at
the same moment join one game rather than creating two.

The board is nine characters (`XOXXOOOXX`), which makes it one atomic column to
update and trivial to validate in SQL.

### Session expiry

There is no second timer. The game uses the existing session clock:

- The app's kill timer in [`App.tsx`](App.tsx) ends the session, which unmounts
  the chat and game and drops both subscriptions.
- `make_move` and `start_game` both re-check `expires_at > now()`, so a client
  that missed the clock still cannot play.
- The TTL comes from `SESSION_MINUTES` in
  [`src/lib/session.ts`](src/lib/session.ts). Change it there and the game
  follows.

## Session summary and sharing

When the session ends — clock or early exit — you get a summary: duration,
people met, games played and won, and a title. Everything is derived from what
the app already knew; nothing is tracked server side for it.

**SHARE** uses the platform share sheet with plain text. No upload, no image
host, no SDK. The image-card version is deliberately unimplemented and isolated
in `renderShareCard()` in
[`src/lib/share/shareCard.ts`](src/lib/share/shareCard.ts) — rendering a PNG on
device needs another native dependency, and the text form already works.

## Toilet proof: the replay weakness

The current check is **single-frame**, so it can be beaten by holding a real
hand in front of a photo of a toilet. Both checks pass because both only ever
look at one still.

This is known and not fixed in this round. Fixing it properly means temporal
capture, and adding an untested multi-frame flow on top of a native module that
has not yet been compiled would put the riskiest part of the app at more risk.
The pieces, if you want it next:

| file | what changes |
|---|---|
| [`src/lib/challenges.ts`](src/lib/challenges.ts) | add `randomChallengeSequence(n)` returning 2–3 gestures |
| [`src/screens/CameraScreen.tsx`](src/screens/CameraScreen.tsx) | `capture()` takes a burst of 2–3 stills ~700 ms apart, prompting a new gesture between each |
| [`src/lib/verify.ts`](src/lib/verify.ts) | split the per-frame body of `verifyProof` into `verifyFrame(uri, gesture)`, add `verifyProofSequence(uris, gestures)` |
| [`src/lib/verify.ts`](src/lib/verify.ts) | cross-frame checks: toilet in **every** frame, gestures match the sequence in order, and the hand landmark centroid actually moves |
| [`modules/toilet-vision/`](modules/toilet-vision/) | nothing — `detectHands` and `detectObjects` are already per-image |

Worth noting: this needs **no video recording**. A burst of timed stills with a
changing required gesture defeats photo replay, and reuses the existing
per-image pipeline unchanged. Video would mean frame extraction and a much
larger native surface for no extra security here.

The objective would be stopping trivial replay, not perfect anti-cheat. A
determined person with two phones still gets through.

## Requires a development build

Adding native MediaPipe means **Expo Go no longer works**. The app now needs a
development build.

```bash
npx expo install --check        # confirm dependencies line up
npx expo prebuild --clean       # generate android/ and ios/
npx expo run:android            # build + install on a connected device
```

For iOS you also need `npx pod-install` and a Mac. Or build in the cloud:

```bash
npx eas-cli@latest build --profile development --platform android
```

`android/` and `ios/` are generated (Continuous Native Generation) — never edit
them by hand; change `app.json` instead. The local module lives in
[`modules/toilet-vision/`](modules/toilet-vision/) and is autolinked.

The web build still runs, but the camera step cannot: there is no native module
there, so verification fails closed with "needs a development build". Use
`EXPO_PUBLIC_SKIP_CAMERA=1` to keep testing chat in a browser.


## Testing it

### Without a phone, right now

```bash
npm test               # typecheck + gesture + tic-tac-toe + stats + pixel checks
npm run test:schema    # applies schema.sql to a throwaway Postgres (needs docker)
npx expo-doctor
```

`test:schema` is the one that matters most for the game: it plays real moves
through the real RPCs and asserts that out-of-turn moves, moves by strangers,
occupied squares, off-board cells, moves after the result, and moves from an
expired session are all rejected.

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
**proof flow cannot run on web at all** — there is no native MediaPipe module
there, so verification fails closed with "needs a development build". To test
chat in a browser,
set `EXPO_PUBLIC_SKIP_CAMERA=1` to get past it and test everything downstream,
and do your real camera testing on a phone.

### On a phone

Expo Go cannot run this any more — see [Requires a development build](#requires-a-development-build).

```bash
npx expo run:android      # first time: builds and installs
npx expo start --dev-client   # afterwards
```

The camera step needs a real device; it does not work in the iOS Simulator.

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
- **Skipping the camera** while iterating on later screens: set
  `EXPO_PUBLIC_SKIP_CAMERA=1` in `.env` and rebuild. This bypasses proof
  entirely, so set it back to `0` before you trust any verification result.

### What to actually check

| | Expect |
|---|---|
| Cover the lens | rejected at step 1, "is your thumb on the lens?" |
| Point at a blank wall | rejected at step 1, "that is a blank wall" |
| Toilet, no hand in frame | ✓ usable, ✗ **No hand detected** |
| Hand doing the wrong sign | ✓ hand, ✗ **Wrong hand gesture** (names what it saw) |
| Correct sign, no toilet | ✓ hand, ✓ gesture, ✗ **No toilet detected** |
| Correct sign + toilet | all four tick, 🚽 VERIFIED, session starts |
| Tap PLAY on one client | other client shows **YOU'VE BEEN CHALLENGED** |
| Play a full game | result on both sides, REMATCH deals a fresh board |
| BACK TO CHAT mid-game | chat still live, messages sent while playing are there |
| Let the clock run out during a game | both sides land on the summary |
| One client taps match, the other does not | nothing happens — matching is opt-in on both sides |
| Both clients tap match | **both** land in the chat |
| Send from either side | appears on the other within a second |
| Let the clock run out | both sides hit the expired screen, row is deleted |

Each attempt gets a freshly rolled challenge, and the only image source is the
camera — there is no gallery picker — so an old photo cannot be reused.

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
src/lib/proofMath.ts     cheap pixel prefilter, thresholds (testable in node)
src/lib/verify.ts        orchestrates the four checks, shreds every temp file
src/lib/gesture/         landmark topology + pure gesture classifier
src/lib/vision/          detector interfaces, model download, MediaPipe impls
src/lib/game/            tic-tac-toe rules mirror, RPC wrapper, realtime hook
src/lib/share/           session stats maths + share sheet
modules/toilet-vision/   local Expo module: MediaPipe Kotlin + Swift
src/lib/shred.ts         delete temp images off disk
src/lib/session.ts       sessions, headcount, matchmaking, messages, realtime
src/lib/challenges.ts    the hand signs
src/lib/identity.ts      per-install id + throwaway nicknames
src/screens/             home, challenge, camera, session, chat, game, summary
supabase/schema.sql      run this once
scripts/proof-check.js   pixel threshold regression test
scripts/gesture-test.js  gesture classifier unit tests
scripts/ttt-test.js      tic-tac-toe board + turn logic tests
scripts/stats-test.js    session summary + share text tests
scripts/test-schema.sh   matchmaking and game rules, against real Postgres
```

Not implemented, on purpose: profiles, friends, notifications, moderation,
payments, clever matchmaking.
