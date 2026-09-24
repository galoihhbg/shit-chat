import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const DEVICE_KEY = 'shitchat.deviceId';

const ADJECTIVES = [
  'Silent', 'Explosive', 'Anonymous', 'Damp', 'Majestic', 'Nervous', 'Rapid',
  'Grumpy', 'Mysterious', 'Legendary', 'Soggy', 'Turbo', 'Humble', 'Feral',
];

const NOUNS = [
  'Plunger', 'Log', 'Bidet', 'Cheeks', 'Porcelain', 'Flusher', 'Squatter',
  'Gremlin', 'Dumpling', 'Wizard', 'Pigeon', 'Nugget', 'Goblin', 'Cistern',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** A fresh silly name every session. Not a profile. Nobody can find you. */
export function randomNickname(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

/** Stable per-install id, so one phone cannot spam a hundred sessions. */
export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const fresh = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_KEY, fresh);
  return fresh;
}
