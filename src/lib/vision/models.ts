import { Directory, File, Paths } from 'expo-file-system';

/**
 * Model files are fetched once and kept in the app's document directory.
 *
 * They are NOT bundled into the repo or the APK: together they are ~12 MB,
 * and shipping binaries in git is miserable. The download is a one-off on
 * first use.
 *
 * Note what crosses the network here: the model comes DOWN. The proof photo
 * never goes up. There is no upload path anywhere in this module.
 */

export type ModelSpec = {
  key: 'hands' | 'objects';
  fileName: string;
  url: string;
  /** Expected size in bytes, used to spot a truncated download. */
  bytes: number;
};

export const HAND_MODEL: ModelSpec = {
  key: 'hands',
  fileName: 'hand_landmarker.task',
  url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  bytes: 7819105,
};

export const OBJECT_MODEL: ModelSpec = {
  key: 'objects',
  fileName: 'efficientdet_lite0.tflite',
  url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/latest/efficientdet_lite0.tflite',
  bytes: 4602795,
};

export const ALL_MODELS: ModelSpec[] = [HAND_MODEL, OBJECT_MODEL];

const DIR_NAME = 'vision-models';

function modelsDir(): Directory {
  const dir = new Directory(Paths.document, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * MediaPipe wants a plain filesystem path, not a file:// URL.
 */
export function toNativePath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri;
}

function localFile(spec: ModelSpec): File {
  return new File(modelsDir(), spec.fileName);
}

export function isModelDownloaded(spec: ModelSpec): boolean {
  try {
    const file = localFile(spec);
    // A half-finished download is worse than none: it fails deep inside
    // MediaPipe with an unhelpful message.
    return file.exists && (file.size ?? 0) >= spec.bytes * 0.95;
  } catch {
    return false;
  }
}

export function areModelsReady(): boolean {
  return ALL_MODELS.every(isModelDownloaded);
}

/** Downloads the model if needed and returns a native filesystem path. */
export async function ensureModel(spec: ModelSpec): Promise<string> {
  const file = localFile(spec);

  if (isModelDownloaded(spec)) return toNativePath(file.uri);

  // Clear a partial file so the download does not fail on "already exists".
  try {
    if (file.exists) file.delete();
  } catch {
    // Nothing to clean up.
  }

  const downloaded = await File.downloadFileAsync(spec.url, file);

  if (!downloaded.exists || (downloaded.size ?? 0) < spec.bytes * 0.95) {
    try {
      downloaded.delete();
    } catch {
      // Best effort.
    }
    throw new Error(`Download of ${spec.fileName} came back incomplete`);
  }

  return toNativePath(downloaded.uri);
}

export async function ensureAllModels(): Promise<void> {
  for (const spec of ALL_MODELS) {
    await ensureModel(spec);
  }
}
