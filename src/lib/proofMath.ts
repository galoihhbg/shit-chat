/**
 * Cheap pixel sanity checks, run before the models.
 *
 * No Expo imports on purpose: this file is runnable (and testable) outside
 * the app. It answers one question -- "is this even a photograph of
 * something?" -- so we do not spend ~12 MB of model inference on a black
 * frame or a pocket shot.
 *
 * Deciding whether a hand or a toilet is present is NOT done here any more.
 * That is src/lib/vision, backed by MediaPipe.
 */

export type ProofStats = {
  width: number;
  height: number;
  /** 0..255 average perceived brightness. */
  meanLuma: number;
  /** Spread of brightness. Flat surfaces and covered lenses score near zero. */
  lumaStdDev: number;
};

export type FrameVerdict = { ok: true } | { ok: false; reason: string };

export const MIN_LUMA = 18;      // pitch black / lens covered
export const MAX_LUMA = 245;     // pointed at a lamp
export const DIM_LUMA = 60;      // lit, but only just

/**
 * How much brightness variation counts as "an actual scene".
 *
 * This has to be relative, not absolute. A dim bathroom has a genuinely
 * compressed dynamic range, so a fixed threshold rejects every real photo
 * taken in bad lighting -- which is most of them. A flat surface scores
 * near zero at any brightness, so a ratio separates the two cleanly.
 */
/**
 * Floor of 4, not 7. Flat surfaces score 0.0-0.4 even after JPEG, while a
 * real but dimly lit bathroom lands around 6. A floor of 7 sat inside that
 * gap and rejected genuine photos.
 */
export const MIN_DETAIL_ABS = 4;
export const MIN_DETAIL_RATIO = 0.06;

export function requiredDetail(meanLuma: number): number {
  return Math.max(MIN_DETAIL_ABS, MIN_DETAIL_RATIO * meanLuma);
}

/** Reduce an RGBA buffer to the handful of numbers we actually judge. */
export function analyzePixels(data: Uint8Array, width: number, height: number): ProofStats {
  const pixels = width * height;
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const luma = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    sum += luma;
    sumSq += luma * luma;
  }

  const meanLuma = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - meanLuma * meanLuma);

  return { width, height, meanLuma, lumaStdDev: Math.sqrt(variance) };
}

/** Is this worth running the models on? */
export function judgeFrameQuality(stats: ProofStats): FrameVerdict {
  if (stats.meanLuma < MIN_LUMA) {
    return { ok: false, reason: 'Way too dark. Is your thumb on the lens?' };
  }
  if (stats.meanLuma > MAX_LUMA) {
    return { ok: false, reason: 'Blindingly bright. Stop photographing the light.' };
  }
  if (stats.lumaStdDev < requiredDetail(stats.meanLuma)) {
    // Same measurement, two very different user problems.
    return {
      ok: false,
      reason:
        stats.meanLuma < DIM_LUMA
          ? 'Too dark to make anything out. Turn a light on.'
          : 'That is a blank wall. Point it at the toilet.',
    };
  }
  return { ok: true };
}
