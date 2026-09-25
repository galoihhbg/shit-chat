/**
 * MediaPipe Hand Landmarker topology.
 *
 * The model returns 21 landmarks per hand, normalised to 0..1 in image space
 * (x right, y DOWN, z towards the camera). Index order is fixed by MediaPipe:
 * https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
 */

export type Landmark = { x: number; y: number; z: number };

export type Handedness = 'Left' | 'Right';

export type Hand = {
  landmarks: Landmark[];
  handedness: Handedness;
  /** Detector confidence, 0..1. */
  score: number;
};

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

export const LANDMARK_COUNT = 21;

/** Euclidean distance in the x/y plane. z is noisy on a single frame. */
export function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
