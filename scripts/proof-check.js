/**
 * Threshold checks for the cheap pixel prefilter (src/lib/proofMath.ts).
 *
 * This no longer decides whether a hand or toilet is present -- MediaPipe
 * does that now. All this has to get right is "is the photo usable at all",
 * without rejecting real photos taken in dim bathrooms.
 */
const jpeg = require('jpeg-js');
const { analyzePixels, judgeFrameQuality } = require('../.proof-tmp/proofMath.js');

const W = 128, H = 96;

function build(fn) {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = fn(x, y);
    const o = (y * W + x) * 4;
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  }
  // Round-trip through JPEG so we measure what the app really decodes.
  const enc = jpeg.encode({ data, width: W, height: H }, 70);
  const dec = jpeg.decode(new Uint8Array(enc.data), { useTArray: true });
  return analyzePixels(dec.data, dec.width, dec.height);
}

const noise = (x, y) => ((x * 37 + y * 101) % 61);
const scene = (x, y) => { const n = noise(x, y); return [120 + n, 124 + n, 130 + n]; };

const cases = {
  'lens covered (black)':       () => [4, 4, 5],
  'blank white wall':           () => [235, 233, 228],
  'blank beige wall':           () => [198, 186, 170],
  'blown out / lamp':           () => [252, 252, 251],
  'textured beige wall':        (x, y) => { const n = noise(x, y) % 7; return [198 + n, 186 + n, 170 + n]; },
  'detailed bathroom':          scene,
  // Low light darkens a scene; it does not flatten it. Scale the real scene.
  'dim bathroom':               (x, y) => scene(x, y).map((c) => c * 0.45),
  'nearly pitch dark':          (x, y) => scene(x, y).map((c) => c * 0.22),
};

// A usable photo is one worth spending model inference on. Whether it
// contains a hand or a toilet is decided later, by MediaPipe.
const expected = {
  'lens covered (black)': false,
  'blank white wall': false,
  'blank beige wall': false,
  'blown out / lamp': false,
  'textured beige wall': false,
  'detailed bathroom': true,
  'dim bathroom': true,
  // Below this there is genuinely nothing for a model to work with.
  'nearly pitch dark': false,
};

let pad = 0;
for (const k of Object.keys(cases)) pad = Math.max(pad, k.length);

let failed = 0;
for (const [name, fn] of Object.entries(cases)) {
  const stats = build(fn);
  const v = judgeFrameQuality(stats);
  const ok = v.ok === expected[name];
  if (!ok) failed++;
  console.log(
    name.padEnd(pad),
    '|', v.ok ? 'USABLE ' : 'REJECT ',
    '| luma', stats.meanLuma.toFixed(1).padStart(5),
    '| sd', stats.lumaStdDev.toFixed(1).padStart(5),
    ok ? '' : `  <-- EXPECTED ${expected[name] ? 'USABLE' : 'REJECT'}`,
    v.ok ? '' : '| ' + v.reason
  );
}

console.log(failed ? `\n${failed} case(s) regressed.` : '\nAll frame-quality thresholds behave as expected.');
process.exit(failed ? 1 : 0);
