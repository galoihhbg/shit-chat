const jpeg = require('jpeg-js');
const { analyzePixels, judge } = require('../.proof-tmp/proofMath.js');
const { randomChallenge } = require('../.proof-tmp/challenges.js');

const W = 128, H = 96;
const challenge = { id: 'peace', emoji: 'x', name: 'PEACE', instruction: '' };

function build(fn) {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = fn(x, y);
    const o = (y * W + x) * 4;
    data[o] = r; data[o+1] = g; data[o+2] = b; data[o+3] = 255;
  }
  // round-trip through JPEG so we measure what the app really decodes
  const enc = jpeg.encode({ data, width: W, height: H }, 70);
  const dec = jpeg.decode(new Uint8Array(enc.data), { useTArray: true });
  return analyzePixels(dec.data, dec.width, dec.height);
}

const noise = (x, y) => ((x * 37 + y * 101) % 61);

const cases = {
  'lens covered (black)':      () => [4, 4, 5],
  'blank white wall':          () => [235, 233, 228],
  'blank beige wall':          () => [198, 186, 170],
  'blown out / lamp':          () => [252, 252, 251],
  'detailed bathroom, no hand':(x, y) => {
    const n = noise(x, y);
    // greys and blue-ish tile: never satisfies r>g && r>b by a margin
    return [120 + n, 124 + n, 130 + n];
  },
  'bathroom + hand in frame':  (x, y) => {
    const n = noise(x, y) / 3;
    const hand = x > 70 && y > 30 && y < 80;
    return hand ? [205 + n, 150 + n, 125 + n] : [120 + n, 124 + n, 130 + n];
  },
  'very dim bathroom + hand':  (x, y) => {
    const n = noise(x, y) / 6;
    const hand = x > 80 && y > 40 && y < 85;
    return hand ? [72 + n, 48 + n, 38 + n] : [30 + n, 33 + n, 36 + n];
  },
  'textured beige wall':       (x, y) => {
    const n = (noise(x, y) % 7);
    return [198 + n, 186 + n, 170 + n];
  },
  'dim bathroom + hand':       (x, y) => {
    const n = noise(x, y) / 4;
    const hand = x > 80 && y > 40 && y < 85;
    return hand ? [130 + n, 88 + n, 70 + n] : [60 + n, 64 + n, 70 + n];
  },
};

let pad = 0;
for (const k of Object.keys(cases)) pad = Math.max(pad, k.length);

for (const [name, fn] of Object.entries(cases)) {
  const stats = build(fn);
  const v = judge(stats, challenge);
  console.log(
    name.padEnd(pad),
    '|', v.ok ? 'PASS' : 'FAIL',
    '| luma', stats.meanLuma.toFixed(1).padStart(5),
    '| sd', stats.lumaStdDev.toFixed(1).padStart(5),
    '| skin', (stats.skinFraction * 100).toFixed(1).padStart(5) + '%',
    v.ok ? '' : '| ' + v.reason
  );
}

// Synthetic frames only -- this pins the thresholds so a tweak that starts
// rejecting real photos in dim bathrooms shows up immediately.
const expected = {
  'lens covered (black)': false,
  'blank white wall': false,
  'blank beige wall': false,
  'blown out / lamp': false,
  'detailed bathroom, no hand': false,
  'bathroom + hand in frame': true,
  'very dim bathroom + hand': true,
  'textured beige wall': false,
  'dim bathroom + hand': true,
};

let failed = 0;
for (const [name, fn] of Object.entries(cases)) {
  const got = judge(build(fn), challenge).ok;
  if (got !== expected[name]) {
    console.error(`\nEXPECTATION BROKEN: "${name}" expected ${expected[name]}, got ${got}`);
    failed++;
  }
}
console.log(failed ? `\n${failed} case(s) regressed.` : '\nAll proof thresholds behave as expected.');
process.exit(failed ? 1 : 0);
