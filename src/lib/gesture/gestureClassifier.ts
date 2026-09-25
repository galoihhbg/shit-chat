/**
 * Hand gesture classification from MediaPipe hand landmarks.
 *
 * Pure geometry, no model, no I/O -- so it is unit testable off-device
 * (see scripts/gesture-test.js).
 *
 * Everything is scale- and rotation-tolerant where it can be: finger
 * extension is measured as "is the tip further from the wrist than the
 * knuckle", not "is the tip higher up the screen". The one exception is
 * THUMBS_UP, which is *defined* by pointing up and so must look at image
 * orientation. That is called out where it happens.
 */

import { dist, LM, LANDMARK_COUNT, type Landmark } from './landmarks';

/** Gesture ids. These double as Challenge ids -- see lib/challenges.ts. */
export type GestureId =
  | 'peace'   // TWO_FINGERS   index + middle
  | 'three'   // THREE_FINGERS index + middle + ring
  | 'four'    // FOUR_FINGERS  everything except the thumb
  | 'palm'    // OPEN_PALM     all five
  | 'fist'    // FIST          none
  | 'thumb'   // THUMBS_UP     thumb only, pointing up
  | 'ok'      // OK            thumb and index pinched, rest extended
  | 'point';  // ONE_FINGER    index only

export const GESTURE_IDS: GestureId[] = [
  'peace', 'three', 'four', 'palm', 'fist', 'thumb', 'ok', 'point',
];

export type FingerStates = {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
};

/**
 * A finger counts as extended when its tip is meaningfully further from the
 * wrist than its PIP joint. Curling a finger brings the tip back toward the
 * palm, so this flips cleanly and does not care which way the hand is turned.
 */
const EXTEND_MARGIN = 1.04;

/** Thumb tip vs thumb IP, measured against the far side of the palm. */
const THUMB_MARGIN = 1.04;

/** Thumb/index tip separation that counts as a pinch, relative to palm size. */
const PINCH_RATIO = 0.42;

/** How far above the wrist a thumb has to sit to read as "up", vs palm size. */
const THUMB_UP_RATIO = 0.4;

export function isValidHand(landmarks: Landmark[] | null | undefined): boolean {
  return (
    Array.isArray(landmarks) &&
    landmarks.length === LANDMARK_COUNT &&
    landmarks.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  );
}

/**
 * Palm size, used to turn absolute distances into ratios. Wrist to middle
 * knuckle is stable regardless of which fingers are curled.
 */
export function palmScale(l: Landmark[]): number {
  return dist(l[LM.WRIST], l[LM.MIDDLE_MCP]);
}

function fingerExtended(l: Landmark[], pip: number, tip: number): boolean {
  const wrist = l[LM.WRIST];
  return dist(wrist, l[tip]) > dist(wrist, l[pip]) * EXTEND_MARGIN;
}

/**
 * The thumb does not curl toward the wrist, it folds across the palm. So it
 * is measured against the pinky knuckle: sticking out moves the tip away
 * from that corner, tucking in moves it closer.
 */
function thumbExtended(l: Landmark[]): boolean {
  const anchor = l[LM.PINKY_MCP];
  return dist(l[LM.THUMB_TIP], anchor) > dist(l[LM.THUMB_IP], anchor) * THUMB_MARGIN;
}

export function fingerStates(l: Landmark[]): FingerStates {
  return {
    thumb: thumbExtended(l),
    index: fingerExtended(l, LM.INDEX_PIP, LM.INDEX_TIP),
    middle: fingerExtended(l, LM.MIDDLE_PIP, LM.MIDDLE_TIP),
    ring: fingerExtended(l, LM.RING_PIP, LM.RING_TIP),
    pinky: fingerExtended(l, LM.PINKY_PIP, LM.PINKY_TIP),
  };
}

/** Thumb and index fingertips touching, as in an OK sign. */
export function isPinching(l: Landmark[]): boolean {
  const scale = palmScale(l);
  if (scale <= 0) return false;
  return dist(l[LM.THUMB_TIP], l[LM.INDEX_TIP]) < scale * PINCH_RATIO;
}

/**
 * Is the thumb pointing up the image?
 *
 * ORIENTATION DEPENDENT ON PURPOSE. A thumbs up that points sideways is a
 * different gesture, so this one check reads image space, where y grows
 * downward. It assumes the photo is upright, which is the case for a phone
 * held normally in portrait.
 */
export function isThumbUp(l: Landmark[]): boolean {
  const scale = palmScale(l);
  if (scale <= 0) return false;
  return l[LM.WRIST].y - l[LM.THUMB_TIP].y > scale * THUMB_UP_RATIO;
}

function countExtended(f: FingerStates): number {
  return (
    Number(f.index) + Number(f.middle) + Number(f.ring) + Number(f.pinky)
  );
}

/**
 * Classify a single hand. Returns null when the shape does not cleanly match
 * any supported gesture -- we would rather say "wrong gesture" than guess.
 */
export function classifyGesture(landmarks: Landmark[]): GestureId | null {
  if (!isValidHand(landmarks)) return null;

  const f = fingerStates(landmarks);
  const fingers = countExtended(f);

  // OK is checked first: the pinch collapses index extension, so it would
  // otherwise be misread as "three fingers".
  if (isPinching(landmarks) && f.middle && f.ring && f.pinky) {
    return 'ok';
  }

  if (fingers === 0) {
    // Thumb alone, pointing up, is a thumbs up. Thumb alone pointing
    // sideways is just a fist with an opinion.
    if (f.thumb && isThumbUp(landmarks)) return 'thumb';
    if (!f.thumb) return 'fist';
    return null;
  }

  if (fingers === 1 && f.index) return 'point';
  if (fingers === 2 && f.index && f.middle) return 'peace';
  if (fingers === 3 && f.index && f.middle && f.ring) return 'three';
  if (fingers === 4) return f.thumb ? 'palm' : 'four';

  return null;
}

/**
 * Pick the best gesture out of however many hands were found. Somebody may
 * have both hands in frame; any hand doing the right thing counts.
 */
export function classifyBestGesture(
  hands: { landmarks: Landmark[] }[],
  wanted: GestureId
): { matched: boolean; seen: GestureId | null } {
  let seen: GestureId | null = null;

  for (const hand of hands) {
    const g = classifyGesture(hand.landmarks);
    if (g === wanted) return { matched: true, seen: g };
    if (g && !seen) seen = g;
  }

  return { matched: false, seen };
}
