import { requireOptionalNativeModule } from 'expo';

/**
 * Raw bridge to the local MediaPipe module.
 *
 * `requireOptionalNativeModule` returns null instead of throwing when the
 * native side is absent -- which is the case in Expo Go and on web. Callers
 * must handle null; see src/lib/vision.
 */

export type NativeLandmark = { x: number; y: number; z: number };

export type NativeHand = {
  handedness: string;
  score: number;
  landmarks: NativeLandmark[];
};

export type NativeObject = { label: string; score: number };

export type ToiletVisionNativeModule = {
  detectHands(imageUri: string, modelPath: string, maxHands: number): Promise<{ hands: NativeHand[] }>;
  detectObjects(imageUri: string, modelPath: string, threshold: number): Promise<{ objects: NativeObject[] }>;
  release(): void;
};

const ToiletVision = requireOptionalNativeModule<ToiletVisionNativeModule>('ToiletVision');

export function getToiletVision(): ToiletVisionNativeModule | null {
  return ToiletVision;
}

export const isToiletVisionAvailable = ToiletVision !== null;

export default ToiletVision;
