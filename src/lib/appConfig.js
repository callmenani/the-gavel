/**
 * Central feature flags driven by environment.
 *
 * The app is designed to run with a ZERO backend: solo auctions are 100%
 * device-local and require no server. Multiplayer (Firebase RTDB cluster) and
 * the public room directory (Cloudflare D1) are only enabled when their keys
 * are present. Without keys the UI hides those surfaces so a fresh deploy
 * never hangs or errors.
 */
const rawEnv =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env
    : typeof process !== 'undefined'
      ? process.env
      : {};

// A real Firebase API key (the repo ships a placeholder for CI/tests).
const DUMMY_KEY = 'AIzaSyDummyKeyForNodeTestEnvironment00';
const firebaseKey = rawEnv.VITE_FIREBASE_API_KEY || '';
export const isFirebaseConfigured =
  Boolean(firebaseKey) && firebaseKey !== DUMMY_KEY;

// Cloudflare D1 directory / edge worker (public lobby list, platform stats).
export const isDirectoryConfigured = Boolean((rawEnv.VITE_DIRECTORY_API_URL || '').trim());

// Multiplayer lives or dies with Firebase.
export const FEATURE_MULTIPLAYER = isFirebaseConfigured;

// AdSense is only shown when a publisher id is configured.
export const FEATURE_ADS = Boolean(rawEnv.VITE_ADSENSE_CLIENT_ID);

export default {
  isFirebaseConfigured,
  isDirectoryConfigured,
  FEATURE_MULTIPLAYER,
  FEATURE_ADS,
};
