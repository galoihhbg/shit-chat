/**
 * Local computer-vision contracts.
 *
 * The rest of the app talks to these interfaces only -- never to MediaPipe,
 * a model file, or a native module directly. Swapping the implementation
 * (different model, different runtime, a web build) should not touch
 * anything outside src/lib/vision.
 */

import type { Hand } from '../gesture/landmarks';

export type { Hand };

/** Why a detector could not answer, as opposed to answering "no". */
export type VisionUnavailableReason =
  | 'no-native-module'   // running in Expo Go or on web
  | 'model-missing'      // model file not downloaded yet
  | 'failed';            // the model ran and threw

export class VisionUnavailableError extends Error {
  constructor(
    public readonly reason: VisionUnavailableReason,
    message: string
  ) {
    super(message);
    this.name = 'VisionUnavailableError';
  }
}

export interface HandLandmarkDetector {
  /** Returns one entry per hand found. Empty array means "no hands". */
  detect(imageUri: string): Promise<Hand[]>;
}

export type DetectionResult = {
  /** True when a toilet or toilet seat is visible. */
  toiletDetected: boolean;
  /** Confidence of the best toilet-ish detection, 0..1. */
  score: number;
  /** Raw model label that satisfied the check, for debugging. */
  label: string | null;
};

export interface ToiletDetector {
  detect(imageUri: string): Promise<DetectionResult>;
}
