export type Challenge = {
  id: string;
  emoji: string;
  name: string;
  /** Shown to the user right before the camera opens. */
  instruction: string;
};

const CHALLENGES: Challenge[] = [
  { id: 'peace',   emoji: '✌️', name: 'PEACE',          instruction: 'Two fingers. Like you are at war and losing.' },
  { id: 'thumb',   emoji: '👍', name: 'THUMBS UP',      instruction: 'Approve of what is happening.' },
  { id: 'ok',      emoji: '👌', name: 'OK SIGN',        instruction: 'Everything is fine. Everything is under control.' },
  { id: 'rock',    emoji: '🤘', name: 'ROCK ON',        instruction: 'This is a metal moment.' },
  { id: 'shaka',   emoji: '🤙', name: 'CALL ME',        instruction: 'Hang loose. Very loose.' },
  { id: 'fist',    emoji: '✊',       name: 'FIST',           instruction: 'Show strength. You will need it.' },
  { id: 'palm',    emoji: '🖐️', name: 'OPEN PALM', instruction: 'Five fingers. Count them.' },
  { id: 'point',   emoji: '☝️', name: 'POINT UP',       instruction: 'Point at the ceiling. Ask it why.' },
  { id: 'vulcan',  emoji: '🖖', name: 'VULCAN SALUTE',  instruction: 'Live long and evacuate.' },
  { id: 'crossed', emoji: '🤞', name: 'CROSSED FINGERS', instruction: 'Hope. Pure hope.' },
];

export function randomChallenge(previousId?: string): Challenge {
  const pool = previousId ? CHALLENGES.filter((c) => c.id !== previousId) : CHALLENGES;
  return pool[Math.floor(Math.random() * pool.length)];
}
