import { File } from 'expo-file-system';

/**
 * Delete a temporary image off disk.
 *
 * expo-camera and expo-image-manipulator both write into the app cache. The
 * promise of this app is that proof photos are never kept, so we remove them
 * the moment we are done measuring.
 */
export function shred(uri?: string | null): void {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {
    // Already gone, or not a file:// uri. Either way there is nothing to keep.
  }
}
