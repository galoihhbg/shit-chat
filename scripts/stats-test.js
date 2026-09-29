/** Unit tests for the end-of-session summary maths and copy. */
const test = require('node:test');
const assert = require('node:assert');

const {
  emptyStats, durationSeconds, formatDuration, rank, statLines, buildShareText,
} = require('../.stats-tmp/sessionStats.js');

const T0 = 1_700_000_000_000;

function stats(over = {}) {
  return { ...emptyStats(T0), endedAt: T0 + 522_000, peopleMet: 1, ...over };
}

test('duration is derived from the session window', () => {
  assert.strictEqual(durationSeconds(stats()), 522);
  assert.strictEqual(durationSeconds(emptyStats(T0)), 0);
  // A clock skew backwards must not produce a negative session.
  assert.strictEqual(durationSeconds({ ...emptyStats(T0), endedAt: T0 - 5000 }), 0);
});

test('durations read the way a human would say them', () => {
  assert.strictEqual(formatDuration(522), '8m 42s');
  assert.strictEqual(formatDuration(42), '42s');
  assert.strictEqual(formatDuration(60), '1m 0s');
  assert.strictEqual(formatDuration(900), '15m 0s');
  assert.strictEqual(formatDuration(-10), '0s');
});

test('rank reflects what actually happened', () => {
  assert.strictEqual(rank(stats({ gamesPlayed: 3, gamesWon: 2 })), 'Toilet Champion');
  assert.strictEqual(rank(stats({ gamesPlayed: 1, gamesWon: 1 })), 'Certified Shitter');
  assert.strictEqual(rank(stats({ gamesPlayed: 1, gamesLost: 1 })), 'Flushed With Shame');
  assert.strictEqual(rank(stats()), 'Social Shitter');
  assert.strictEqual(rank(emptyStats(T0)), 'Lone Wolf');
});

test('stat lines are singular or plural correctly', () => {
  assert.deepStrictEqual(statLines(stats({ peopleMet: 1 })), ['8m 42s', '1 person met']);
  assert.deepStrictEqual(statLines(stats({ peopleMet: 2 })), ['8m 42s', '2 people met']);
  assert.deepStrictEqual(
    statLines(stats({ gamesPlayed: 1, gamesWon: 1 })),
    ['8m 42s', '1 person met', '1 game played', '1 game won']
  );
  // Games played but none won: no "0 games won" line.
  assert.deepStrictEqual(
    statLines(stats({ gamesPlayed: 2, gamesLost: 2 })),
    ['8m 42s', '1 person met', '2 games played']
  );
});

test('share text carries the brand, the numbers and the title', () => {
  const text = buildShareText(stats({ gamesPlayed: 1, gamesWon: 1 }));
  assert.match(text, /^SHITCHAT\n/);
  assert.match(text, /TOILET SESSION COMPLETE/);
  assert.match(text, /8m 42s/);
  assert.match(text, /1 person met/);
  assert.match(text, /1 game played/);
  assert.match(text, /"Certified Shitter"/);
  // No links, no tracking, nothing that needs a server.
  assert.doesNotMatch(text, /https?:\/\//);
});
