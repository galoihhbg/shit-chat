import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as base64 from 'base64-js';
import * as jpeg from 'jpeg-js';
import type { Challenge } from './challenges';
import { classifyBestGesture } from './gesture/gestureClassifier';
import { analyzePixels, judgeFrameQuality, type ProofStats } from './proofMath';
import { shred } from './shred';
import { mediaPipeHandDetector } from './vision/handDetector';
import { mediaPipeToiletDetector } from './vision/toiletDetector';
import { VisionUnavailableError } from './vision/types';

/**
 * LOCAL proof checking. Nothing here uploads the photo.
 *
 * The capture is normalised into a small working copy, that copy is measured
 * and run through two on-device MediaPipe models, and every file produced
 * along the way is deleted before this returns. The only thing that leaves
 * this module is a boolean and a reason string.
 */

export type { ProofStats };

export type ProofStepKey = 'frame' | 'hand' | 'gesture' | 'toilet';
export type ProofStepState = 'pending' | 'running' | 'pass' | 'fail';

export type ProofStep = {
  key: ProofStepKey;
  label: string;
  state: ProofStepState;
};

export type ProofResult =
  | { ok: true; stats: ProofStats | null; steps: ProofStep[] }
  | { ok: false; reason: string; stats: ProofStats | null; steps: ProofStep[] };

export type VerifyOptions = {
  /** Called as each step starts and settles, so the UI can tick them off. */
  onProgress?: (steps: ProofStep[]) => void;
};

/** Analysis resolution. Big enough for the models, small enough to be quick. */
const WORK_WIDTH = 640;
/** Pixel-stats resolution. Tiny on purpose. */
const SAMPLE_WIDTH = 128;

const STEP_LABELS: Record<ProofStepKey, string> = {
  frame: 'Photo usable',
  hand: 'Hand detected',
  gesture: 'Correct gesture',
  toilet: 'Toilet detected',
};

function freshSteps(): ProofStep[] {
  return (['frame', 'hand', 'gesture', 'toilet'] as ProofStepKey[]).map((key) => ({
    key,
    label: STEP_LABELS[key],
    state: 'pending' as ProofStepState,
  }));
}

/**
 * Downscale the capture once and reuse it for every check.
 *
 * This also normalises orientation, which matters: THUMBS_UP is defined by
 * pointing up, so a photo carrying a rotation flag would classify wrongly.
 */
async function prepareFrame(uri: string, width: number): Promise<{ uri: string; base64?: string }> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.8,
    base64: width <= SAMPLE_WIDTH,
  });
  return { uri: saved.uri, base64: saved.base64 ?? undefined };
}

async function measure(uri: string): Promise<ProofStats> {
  const small = await prepareFrame(uri, SAMPLE_WIDTH);
  shred(small.uri);

  if (!small.base64) throw new Error('could not read the photo');

  const raw = jpeg.decode(base64.toByteArray(small.base64), { useTArray: true });
  return analyzePixels(raw.data as Uint8Array, raw.width, raw.height);
}

export async function verifyProof(
  uri: string,
  challenge: Challenge,
  options: VerifyOptions = {}
): Promise<ProofResult> {
  const steps = freshSteps();
  const stepMap = new Map(steps.map((s) => [s.key, s]));

  const set = (key: ProofStepKey, state: ProofStepState) => {
    const step = stepMap.get(key);
    if (step) step.state = state;
    options.onProgress?.(steps.map((s) => ({ ...s })));
  };

  const fail = (key: ProofStepKey, reason: string, stats: ProofStats | null): ProofResult => {
    set(key, 'fail');
    return { ok: false, reason, stats, steps: steps.map((s) => ({ ...s })) };
  };

  let stats: ProofStats | null = null;
  /** The normalised working copy. Deleted in the finally block, always. */
  let workUri: string | null = null;

  try {
    // 1. Is this a photograph of anything at all?
    set('frame', 'running');
    try {
      stats = await measure(uri);
    } catch {
      return fail('frame', 'That photo refused to be read. Try again.', null);
    }

    const frame = judgeFrameQuality(stats);
    if (!frame.ok) return fail('frame', frame.reason, stats);
    set('frame', 'pass');

    try {
      workUri = (await prepareFrame(uri, WORK_WIDTH)).uri;
    } catch {
      return fail('frame', 'Could not prepare the photo. Try again.', stats);
    }

    // 2. Is there a hand?
    set('hand', 'running');
    let hands;
    try {
      hands = await mediaPipeHandDetector.detect(workUri);
    } catch (err) {
      return fail('hand', describeVisionError(err), stats);
    }

    if (hands.length === 0) {
      return fail('hand', 'No hand detected. Get it in the shot.', stats);
    }
    set('hand', 'pass');

    // 3. Is it the hand sign we asked for, this attempt?
    set('gesture', 'running');
    const { matched, seen } = classifyBestGesture(hands, challenge.id);
    if (!matched) {
      const sawSomething = seen ? ` That looked like ${seen.toUpperCase()}.` : '';
      return fail('gesture', `Wrong hand gesture. We asked for ${challenge.name}.${sawSomething}`, stats);
    }
    set('gesture', 'pass');

    // 4. Is there a toilet?
    set('toilet', 'running');
    let toilet;
    try {
      toilet = await mediaPipeToiletDetector.detect(workUri);
    } catch (err) {
      return fail('toilet', describeVisionError(err), stats);
    }

    if (!toilet.toiletDetected) {
      return fail('toilet', 'No toilet detected. We need to see the bowl.', stats);
    }
    set('toilet', 'pass');

    return { ok: true, stats, steps: steps.map((s) => ({ ...s })) };
  } finally {
    // The working copy does not survive this function, whatever happened.
    shred(workUri);
  }
}

function describeVisionError(err: unknown): string {
  if (err instanceof VisionUnavailableError) {
    if (err.reason === 'no-native-module') {
      return 'Proof checking needs a development build. See the README.';
    }
    if (err.reason === 'model-missing') {
      return 'Still downloading the detector. Try again in a moment.';
    }
  }
  return 'The detector fell over. Try that photo again.';
}
