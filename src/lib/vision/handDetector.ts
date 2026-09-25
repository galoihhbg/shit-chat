import { getToiletVision } from '../../../modules/toilet-vision';
import type { Hand, Handedness, Landmark } from '../gesture/landmarks';
import { LANDMARK_COUNT } from '../gesture/landmarks';
import { ensureModel, HAND_MODEL } from './models';
import { VisionUnavailableError, type HandLandmarkDetector } from './types';

/** Both hands, in case somebody is being clever with two. */
const MAX_HANDS = 2;

function toLandmark(p: { x: number; y: number; z: number }): Landmark {
  return { x: p.x, y: p.y, z: p.z };
}

export const mediaPipeHandDetector: HandLandmarkDetector = {
  async detect(imageUri: string): Promise<Hand[]> {
    const native = getToiletVision();
    if (!native) {
      throw new VisionUnavailableError(
        'no-native-module',
        'Hand detection needs a development build.'
      );
    }

    const modelPath = await ensureModel(HAND_MODEL);

    let raw;
    try {
      raw = await native.detectHands(imageUri, modelPath, MAX_HANDS);
    } catch (err) {
      throw new VisionUnavailableError(
        'failed',
        err instanceof Error ? err.message : 'Hand detection failed.'
      );
    }

    return (raw?.hands ?? [])
      .filter((h) => Array.isArray(h.landmarks) && h.landmarks.length === LANDMARK_COUNT)
      .map((h) => ({
        landmarks: h.landmarks.map(toLandmark),
        handedness: (h.handedness === 'Left' ? 'Left' : 'Right') as Handedness,
        score: h.score ?? 0,
      }));
  },
};
