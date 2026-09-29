import { Share } from 'react-native';
import { buildShareText, type SessionStats } from './sessionStats';

/**
 * Sharing, via the platform share sheet. No upload, no SDK, no analytics.
 */

export async function shareSession(stats: SessionStats): Promise<boolean> {
  try {
    const result = await Share.share({ message: buildShareText(stats) });
    return result.action !== Share.dismissedAction;
  } catch {
    return false;
  }
}

/**
 * Image version of the share card. Deliberately not implemented.
 *
 * Rendering a PNG on device needs react-native-view-shot (or expo-gl), which
 * is native and would drag another dependency plus a rebuild into a feature
 * whose text form already works. It is isolated here so adding it later means
 * filling in this one function and switching shareSession to attach a `url`.
 */
export async function renderShareCard(_stats: SessionStats): Promise<string | null> {
  return null;
}
