/**
 * Unit tests for the pure gesture classifier.
 *
 * Hands are synthesised rather than captured: we lay out anatomically
 * plausible landmarks in a wrist-origin frame and optionally rotate them.
 * That exercises the geometry and pins the thresholds, but it does NOT
 * prove behaviour against real MediaPipe output -- see README limitations.
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  classifyGesture,
  fingerStates,
  isPinching,
  isThumbUp,
  palmScale,
  classifyBestGesture,
} = require('../.gesture-tmp/gestureClassifier.js');
const { LM } = require('../.gesture-tmp/landmarks.js');

// --- synthetic hand -------------------------------------------------------
// Wrist at the origin, palm pointing up the image (up = -y), thumb on +x.
// Distances are in "screen fractions", the same units MediaPipe normalises to.

const MCP_Y = -0.4;
const MCP_X = { index: 0.09, middle: 0.02, ring: -0.05, pinky: -0.12 };

function finger(name, extended) {
  const x = MCP_X[name];
  if (extended) {
    return [
      { x, y: MCP_Y },
      { x, y: MCP_Y - 0.16 },
      { x, y: MCP_Y - 0.26 },
      { x, y: MCP_Y - 0.34 },
    ];
  }
  // Curled: the tip folds back toward the palm, ending up nearer the wrist.
  return [
    { x, y: MCP_Y },
    { x, y: MCP_Y - 0.14 },
    { x: x + 0.02, y: MCP_Y - 0.08 },
    { x: x + 0.03, y: MCP_Y + 0.06 },
  ];
}

function thumb(mode) {
  // [CMC, MCP, IP, TIP]
  if (mode === 'extended') {
    return [
      { x: 0.08, y: -0.08 },
      { x: 0.17, y: -0.15 },
      { x: 0.25, y: -0.22 },
      { x: 0.34, y: -0.32 },
    ];
  }
  if (mode === 'up') {
    return [
      { x: 0.08, y: -0.10 },
      { x: 0.10, y: -0.26 },
      { x: 0.10, y: -0.42 },
      { x: 0.10, y: -0.55 },
    ];
  }
  if (mode === 'pinch') {
    // Reaching across to meet the index fingertip.
    return [
      { x: 0.08, y: -0.10 },
      { x: 0.13, y: -0.26 },
      { x: 0.15, y: -0.40 },
      { x: 0.16, y: -0.52 },
    ];
  }
  // tucked across the palm
  return [
    { x: 0.08, y: -0.08 },
    { x: 0.12, y: -0.18 },
    { x: 0.12, y: -0.24 },
    { x: 0.02, y: -0.30 },
  ];
}

function hand(spec) {
  const pts = [{ x: 0, y: 0 }, ...thumb(spec.thumb || 'tucked')];
  for (const name of ['index', 'middle', 'ring', 'pinky']) {
    pts.push(...finger(name, !!spec[name]));
  }
  // OK sign: the index fingertip curls down to touch the thumb tip.
  if (spec.thumb === 'pinch') {
    pts[LM.INDEX_TIP] = { x: 0.19, y: -0.52 };
    pts[LM.INDEX_DIP] = { x: 0.16, y: -0.60 };
  }
  // Shift into a plausible image position and add z.
  return pts.map((p) => ({ x: p.x + 0.5, y: p.y + 0.9, z: 0 }));
}

function rotate(landmarks, degrees) {
  const r = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(r), Math.sin(r)];
  const o = landmarks[LM.WRIST];
  return landmarks.map((p) => {
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    return { x: o.x + dx * cos - dy * sin, y: o.y + dx * sin + dy * cos, z: p.z };
  });
}

const POSES = {
  fist:  { thumb: 'tucked' },
  point: { thumb: 'tucked', index: true },
  peace: { thumb: 'tucked', index: true, middle: true },
  three: { thumb: 'tucked', index: true, middle: true, ring: true },
  four:  { thumb: 'tucked', index: true, middle: true, ring: true, pinky: true },
  palm:  { thumb: 'extended', index: true, middle: true, ring: true, pinky: true },
  thumb: { thumb: 'up' },
  ok:    { thumb: 'pinch', middle: true, ring: true, pinky: true },
};

// --- tests ----------------------------------------------------------------

test('each pose classifies as itself', () => {
  for (const [expected, spec] of Object.entries(POSES)) {
    assert.strictEqual(classifyGesture(hand(spec)), expected, `pose ${expected}`);
  }
});

test('poses are distinct from each other', () => {
  const got = Object.entries(POSES).map(([k, s]) => [k, classifyGesture(hand(s))]);
  const values = got.map(([, v]) => v);
  assert.strictEqual(new Set(values).size, values.length, `collision: ${JSON.stringify(got)}`);
});

test('rotation does not change rotation-invariant gestures', () => {
  const invariant = ['fist', 'point', 'peace', 'three', 'four', 'palm', 'ok'];
  for (const angle of [-40, -15, 25, 55]) {
    for (const name of invariant) {
      const rotated = rotate(hand(POSES[name]), angle);
      assert.strictEqual(classifyGesture(rotated), name, `${name} @ ${angle}deg`);
    }
  }
});

test('thumbs up is orientation dependent by design', () => {
  assert.strictEqual(classifyGesture(hand(POSES.thumb)), 'thumb');
  // Turned on its side it is no longer "up", so it must not pass as THUMBS_UP.
  assert.notStrictEqual(classifyGesture(rotate(hand(POSES.thumb), 90)), 'thumb');
  assert.strictEqual(isThumbUp(hand(POSES.thumb)), true);
  assert.strictEqual(isThumbUp(rotate(hand(POSES.thumb), 90)), false);
});

test('finger states are read correctly', () => {
  const f = fingerStates(hand(POSES.peace));
  assert.deepStrictEqual(f, { thumb: false, index: true, middle: true, ring: false, pinky: false });

  const p = fingerStates(hand(POSES.palm));
  assert.deepStrictEqual(p, { thumb: true, index: true, middle: true, ring: true, pinky: true });
});

test('pinch detects the OK sign, and open hands do not pinch', () => {
  assert.strictEqual(isPinching(hand(POSES.ok)), true);
  for (const name of ['peace', 'palm', 'four', 'point', 'three']) {
    assert.strictEqual(isPinching(hand(POSES[name])), false, `${name} should not pinch`);
  }
});

test('a fist pinches too, so pinch alone cannot mean OK', () => {
  // In a real fist the thumb wraps over the curled index, so the tips really
  // are close together. That is why classifyGesture requires the other three
  // fingers to be extended before calling something an OK sign.
  assert.strictEqual(isPinching(hand(POSES.fist)), true);
  assert.strictEqual(classifyGesture(hand(POSES.fist)), 'fist');
  assert.strictEqual(classifyGesture(hand(POSES.ok)), 'ok');
});

test('malformed input is rejected rather than guessed', () => {
  assert.strictEqual(classifyGesture([]), null);
  assert.strictEqual(classifyGesture(null), null);
  assert.strictEqual(classifyGesture(hand(POSES.peace).slice(0, 10)), null);
  const nan = hand(POSES.peace);
  nan[LM.INDEX_TIP] = { x: NaN, y: NaN, z: 0 };
  assert.strictEqual(classifyGesture(nan), null);
});

test('palmScale is positive and scales with the hand', () => {
  const small = hand(POSES.palm);
  const big = small.map((p) => ({ x: p.x * 2, y: p.y * 2, z: p.z }));
  assert.ok(palmScale(small) > 0);
  assert.ok(Math.abs(palmScale(big) - palmScale(small) * 2) < 1e-9);
});

test('scaling the hand does not change classification', () => {
  for (const [name, spec] of Object.entries(POSES)) {
    for (const k of [0.4, 2.5]) {
      const scaled = hand(spec).map((p) => ({ x: p.x * k, y: p.y * k, z: p.z }));
      assert.strictEqual(classifyGesture(scaled), name, `${name} @ scale ${k}`);
    }
  }
});

test('classifyBestGesture matches any hand in frame', () => {
  const wrong = { landmarks: hand(POSES.fist) };
  const right = { landmarks: hand(POSES.peace) };

  assert.deepStrictEqual(classifyBestGesture([wrong, right], 'peace'), { matched: true, seen: 'peace' });
  assert.deepStrictEqual(classifyBestGesture([wrong], 'peace'), { matched: false, seen: 'fist' });
  assert.deepStrictEqual(classifyBestGesture([], 'peace'), { matched: false, seen: null });
});
