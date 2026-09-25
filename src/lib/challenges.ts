import type { GestureId } from './gesture/gestureClassifier';

export type Challenge = {
  /** Doubles as the gesture id the classifier must return. */
  id: GestureId;
  emoji: string;
  name: string;
  /** Shown to the user right before the camera opens. */
  instruction: string;
};

/**
 * One entry per gesture the classifier can actually recognise. If you add a
 * gesture here, add it to GestureId and teach classifyGesture about it --
 * otherwise the challenge is impossible to pass.
 *
 * Note on emoji: THREE and FOUR use digits rather than 🤟, because 🤟 is a
 * different gesture (thumb + index + pinky) and would tell people to do the
 * wrong thing.
 */
const CHALLENGES: Challenge[] = [
  { id: 'peace', emoji: '✌️',  name: 'PEACE',      instruction: 'Two fingers. Like you are at war and losing.' },
  { id: 'three', emoji: '3️⃣',  name: 'THREE',      instruction: 'Index, middle, ring. No thumb. Concentrate.' },
  { id: 'four',  emoji: '4️⃣',  name: 'FOUR',       instruction: 'Four fingers, thumb tucked in. Like a tiny wave.' },
  { id: 'palm',  emoji: '🖐️', name: 'OPEN PALM',  instruction: 'All five. Count them.' },
  { id: 'fist',  emoji: '✊',   name: 'FIST',       instruction: 'Show strength. You will need it.' },
  { id: 'thumb', emoji: '👍',  name: 'THUMBS UP',  instruction: 'Approve of what is happening. Point it upward.' },
  { id: 'ok',    emoji: '👌',  name: 'OK SIGN',    instruction: 'Everything is fine. Everything is under control.' },
  { id: 'point', emoji: '☝️',  name: 'POINT UP',   instruction: 'One finger at the ceiling. Ask it why.' },
];

export function randomChallenge(previousId?: string): Challenge {
  const pool = previousId ? CHALLENGES.filter((c) => c.id !== previousId) : CHALLENGES;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function challengeById(id: GestureId): Challenge | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

export const ALL_CHALLENGES = CHALLENGES;
