/**
 * Development escape hatches, driven by .env. All default to off.
 *
 * These are read at bundle time (EXPO_PUBLIC_* is inlined, not runtime), so
 * changing them needs a rebuild: `npm run web:preview`.
 */

/**
 * Skip the camera and proof check entirely, going straight from the challenge
 * screen into a live session. For looking at the session/chat UI without
 * repeatedly photographing a toilet.
 */
export const SKIP_CAMERA = process.env.EXPO_PUBLIC_SKIP_CAMERA === '1';

/** True if any bypass is active, so the UI can admit it out loud. */
export const DEV_BYPASS_ACTIVE = SKIP_CAMERA;
