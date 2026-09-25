import { getToiletVision } from '../../../modules/toilet-vision';
import { ensureModel, OBJECT_MODEL } from './models';
import { VisionUnavailableError, type DetectionResult, type ToiletDetector } from './types';

/**
 * EfficientDet-Lite0 is a generic COCO detector. COCO has exactly one
 * relevant category, "toilet", which covers the bowl and seat. Anything else
 * it sees (person, sink, bottle) is ignored.
 */
const TOILET_LABELS = new Set(['toilet']);

/** Below this the detector is mostly hallucinating on bathroom texture. */
export const TOILET_MIN_SCORE = 0.35;

/** Passed to the model; lower than our own bar so we can see near misses. */
const MODEL_THRESHOLD = 0.2;

export function pickToilet(
  objects: { label: string; score: number }[],
  minScore = TOILET_MIN_SCORE
): DetectionResult {
  let best: { label: string; score: number } | null = null;

  for (const o of objects) {
    if (!TOILET_LABELS.has(o.label.toLowerCase())) continue;
    if (!best || o.score > best.score) best = o;
  }

  return {
    toiletDetected: !!best && best.score >= minScore,
    score: best?.score ?? 0,
    label: best?.label ?? null,
  };
}

export const mediaPipeToiletDetector: ToiletDetector = {
  async detect(imageUri: string): Promise<DetectionResult> {
    const native = getToiletVision();
    if (!native) {
      throw new VisionUnavailableError(
        'no-native-module',
        'Toilet detection needs a development build.'
      );
    }

    const modelPath = await ensureModel(OBJECT_MODEL);

    let raw;
    try {
      raw = await native.detectObjects(imageUri, modelPath, MODEL_THRESHOLD);
    } catch (err) {
      throw new VisionUnavailableError(
        'failed',
        err instanceof Error ? err.message : 'Toilet detection failed.'
      );
    }

    return pickToilet(raw?.objects ?? []);
  },
};
