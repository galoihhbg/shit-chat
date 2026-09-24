/**
 * Pure pixel math for local proof checking. No Expo imports on purpose:
 * this file is runnable (and testable) outside the app.
 */

import type { Challenge } from './challenges';

export type ProofStats = {
  width: number;
  height: number;
  /** 0..255 average perceived brightness. */
  meanLuma: number;
  /** Spread of brightness. Flat surfaces and covered lenses score near zero. */
  lumaStdDev: number;
  /** 0..1 share of pixels that look like human skin. */
  skinFraction: number;
};

export type ProofResult =
  | { ok: true; stats: ProofStats }
  | { ok: false; reason: string; stats: ProofStats | null };

export const MIN_LUMA = 18;      // pitch black / lens covered
export const MAX_LUMA = 245;     // pointed at a lamp
export const MIN_SKIN = 0.015;   // no hand anywhere in frame

/**
 * How much brightness variation counts as "an actual scene".
 *
 * This has to be relative, not absolute. A dim bathroom has a genuinely
 * compressed dynamic range, so a fixed threshold rejects every real photo
 * taken in bad lighting -- which is most of them. A flat surface scores
 * near zero at any brightness, so a ratio separates the two cleanly.
 */
export const MIN_DETAIL_ABS = 7;
export const MIN_DETAIL_RATIO = 0.06;

export function requiredDetail(meanLuma: number): number {
  return Math.max(MIN_DETAIL_ABS, MIN_DETAIL_RATIO * meanLuma);
}

/**
 * Classic Peer et al. RGB skin rule, loosened because bathrooms have
 * terrible yellow lighting.
 */
export function isSkin(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (
    r > 60 && g > 30 && b > 15 &&
    max - min > 10 &&
    Math.abs(r - g) > 10 &&
    r > g && r > b
  );
}

/** Reduce an RGBA buffer to the handful of numbers we actually judge. */
export function analyzePixels(data: Uint8Array, width: number, height: number): ProofStats {
  const pixels = width * height;
  let sum = 0;
  let sumSq = 0;
  let skin = 0;

  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += luma;
    sumSq += luma * luma;
    if (isSkin(r, g, b)) skin++;
  }

  const meanLuma = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - meanLuma * meanLuma);

  return {
    width,
    height,
    meanLuma,
    lumaStdDev: Math.sqrt(variance),
    skinFraction: skin / pixels,
  };
}

/**
 * Which hand sign is this?
 *
 * ---------------------------------------------------------------------------
 * MVP STUB. This does not actually tell a peace sign from a thumbs up.
 * Real per-gesture recognition needs hand landmarks (21 keypoints), which
 * means a native model -- MediaPipe Hands or a TFLite hand-landmarker via
 * a dev build. That does not fit in an Expo Go prototype.
 *
 * What we DO enforce locally, in `judge`: a real, lit, detailed frame with
 * visible skin in it. That already rejects a black screen, a pocket shot,
 * a blank wall, and a screenshot of a blank wall.
 *
 * To make it real, swap this one function for a landmark model and compare
 * finger-extension patterns against `challenge.id`. Nothing else changes.
 * ---------------------------------------------------------------------------
 */
export function classifyGesture(_stats: ProofStats, _challenge: Challenge): boolean {
  return true;
}

/** Turn measurements into a verdict plus something rude to say about it. */
export function judge(stats: ProofStats, challenge: Challenge): ProofResult {
  if (stats.meanLuma < MIN_LUMA) {
    return { ok: false, reason: 'Way too dark. Is your thumb on the lens?', stats };
  }
  if (stats.meanLuma > MAX_LUMA) {
    return { ok: false, reason: 'Blindingly bright. Stop photographing the light.', stats };
  }
  if (stats.lumaStdDev < requiredDetail(stats.meanLuma)) {
    return { ok: false, reason: 'That is a blank wall. We need the toilet.', stats };
  }
  if (stats.skinFraction < MIN_SKIN) {
    return { ok: false, reason: `No hand detected. Where is the ${challenge.name}?`, stats };
  }
  if (!classifyGesture(stats, challenge)) {
    return { ok: false, reason: `Wrong sign. We asked for ${challenge.name}.`, stats };
  }
  return { ok: true, stats };
}
