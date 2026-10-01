/**
 * End-to-end flow test: two real browsers, one real Supabase.
 *
 * This exists because a bug survived typechecking, 42 schema checks and 28
 * unit tests: find_match wrote to a session row twice, and the client read the
 * first write -- room still null -- as "my partner left", bouncing the second
 * player straight back out of the room they had just joined. Only driving two
 * clients at once showed it.
 *
 *   npm run web:build && npm run web:serve     # in one terminal
 *   npm run test:flow                          # in another
 *
 * Needs a Chrome/Chromium on the machine. Point CHROME_PATH at it if it is
 * not in the usual place, and APP_URL at the server if it is not on :8080.
 */
const fs = require('fs');
const { chromium } = require('playwright-core');

const URL = process.env.APP_URL || 'http://localhost:8080';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!CHROME) {
  console.log('No Chrome found. Set CHROME_PATH to run the flow test.');
  process.exit(0);
}

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  <-- ' + detail}`);
  if (!cond) failures++;
}
const tap = async (p, t) => {
  const el = p.getByText(t, { exact: false }).first();
  await el.waitFor({ timeout: 15000 });
  await el.click();
};
const text = async (p) => (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const has = async (p, t) => (await text(p)).includes(t);

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const errors = [];
  const pages = {};
  for (const name of ['A', 'B']) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    pages[name] = p;
  }
  const { A, B } = pages;

  for (const p of [A, B]) {
    await p.goto(URL, { waitUntil: 'networkidle' });
    await tap(p, "I'M SHITTING");
    await tap(p, 'SKIP CAMERA');
  }
  await A.waitForTimeout(2000);

  console.log('\n[match]');
  await tap(A, 'MATCH ME WITH A STRANGER');
  await A.waitForTimeout(1500);
  await tap(B, 'MATCH ME WITH A STRANGER');
  await B.waitForTimeout(3500);
  check('first tapper enters the room', await has(A, 'Leave Room'), await text(A));
  check('second tapper enters the room', await has(B, 'Leave Room'), await text(B));
  check('second tapper is not bounced out', !(await has(B, 'They left the room')));

  console.log('\n[chat]');
  await A.getByPlaceholder('type something regrettable').fill('oi');
  await tap(A, 'SEND');
  await B.waitForTimeout(2500);
  check('message arrives on the other side', await has(B, 'oi'), await text(B));

  console.log('\n[game]');
  await tap(A, 'PLAY');
  await tap(A, 'PLAY A GAME');
  await A.waitForTimeout(2500);
  check('challenger sees the board', await has(A, 'TURN'), await text(A));
  check('other side is told they were challenged', await has(B, "YOU'VE BEEN CHALLENGED"), await text(B));

  await tap(B, 'PLAY');
  await B.waitForTimeout(1500);
  const aTurn = await has(A, 'YOUR TURN');
  const mover = aTurn ? A : B;
  const waiter = aTurn ? B : A;
  check('exactly one player has the turn', aTurn !== (await has(B, 'YOUR TURN')));

  // A disabled Pressable hands the hit to its parent on react-native-web, so
  // the out-of-turn guard is asserted rather than clicked.
  const waiterDisabled = await waiter.getByTestId('cell-0').getAttribute('aria-disabled');
  check('out-of-turn player cannot tap a cell', waiterDisabled === 'true', `aria-disabled=${waiterDisabled}`);
  const moverEnabled = await mover.getByTestId('cell-0').getAttribute('aria-disabled');
  check('player in turn can tap a cell', moverEnabled !== 'true', `aria-disabled=${moverEnabled}`);

  await mover.getByTestId('cell-0').click();
  await mover.waitForTimeout(2500);
  check('a legal move syncs to the other side', await has(waiter, 'YOUR TURN'), await text(waiter));
  check('the move is drawn on the mover too', await has(mover, 'THEIR TURN'), await text(mover));

  console.log('\n[leave room]');
  await tap(A, 'BACK TO CHAT');
  await tap(A, 'Leave Room');
  await A.waitForTimeout(3000);
  check('leaver is back in the lobby', await has(A, 'SESSION ACTIVE'), await text(A));
  check('leaver keeps the toilet session', await has(A, 'MATCH ME WITH A STRANGER'));
  check('partner is told they left', await has(B, 'They left the room'), await text(B));
  check('partner keeps the toilet session', await has(B, 'SESSION ACTIVE'));
  check('no re-verification demanded', !(await has(A, "I'M SHITTING")));

  console.log('\n[match again, same session]');
  await tap(A, 'MATCH ME WITH A STRANGER');
  await A.waitForTimeout(1500);
  await tap(B, 'MATCH ME WITH A STRANGER');
  await B.waitForTimeout(3500);
  check('they can pair again without verifying', await has(A, 'Leave Room'), await text(A));
  check('both are in the new room', await has(B, 'Leave Room'), await text(B));

  console.log('\n[done]');
  await tap(A, "I'm Done");
  await A.waitForTimeout(800);
  check('ending asks for confirmation', await has(A, "Are you sure you're done"), await text(A));
  // Exact match: "I'M DONE" in the dialog, not the chat screen's "I'm Done"
  // sitting behind the overlay.
  await A.getByText("I'M DONE", { exact: true }).first().click();
  await A.waitForTimeout(2000);
  const summary = await text(A);
  check('summary is shown', summary.includes('SESSION COMPLETE'), summary);
  check('summary counts both rooms', summary.includes('2 people met'), summary);

  if (errors.length) { console.log('\n[browser errors]'); errors.forEach(e => console.log('  ' + e)); failures += errors.length; }
  console.log(failures ? `\n${failures} FAILED` : '\nall flow checks passed');
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('DRIVER FAILED:', e.message); process.exit(1); });
