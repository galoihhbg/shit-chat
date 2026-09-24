import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as base64 from 'base64-js';
import * as jpeg from 'jpeg-js';
import type { Challenge } from './challenges';
import { analyzePixels, judge, type ProofResult, type ProofStats } from './proofMath';
import { shred } from './shred';

/**
 * LOCAL proof checking. Nothing here touches the network.
 *
 * The photo is downscaled in memory, decoded to raw pixels, measured, and
 * thrown away. The bytes never leave the phone.
 */

export type { ProofResult, ProofStats };

/** Analysis resolution. Small on purpose: fast, and plenty for these checks. */
const SAMPLE_WIDTH = 128;

async function measure(uri: string): Promise<ProofStats> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: SAMPLE_WIDTH });
  const rendered = await context.renderAsync();
  const shrunk = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.7,
    base64: true,
  });

  // The downscaled copy lives on disk for a moment. Kill it immediately.
  shred(shrunk.uri);

  if (!shrunk.base64) throw new Error('could not read the photo');

  const raw = jpeg.decode(base64.toByteArray(shrunk.base64), { useTArray: true });
  return analyzePixels(raw.data as Uint8Array, raw.width, raw.height);
}

export async function verifyProof(uri: string, challenge: Challenge): Promise<ProofResult> {
  let stats: ProofStats;

  try {
    stats = await measure(uri);
  } catch {
    return { ok: false, reason: 'That photo refused to be read. Try again.', stats: null };
  }

  return judge(stats, challenge);
}
