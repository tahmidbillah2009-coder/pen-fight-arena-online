/**
 * Single Firebase entry point for the whole app.
 *
 * There is exactly ONE `initializeApp` call in this project (guarded by `getApps()`), so the
 * online module never duplicates Firebase initialisation. Everything is loaded lazily via
 * dynamic `import()` which means:
 *   • the offline game bundle never pays for the Firebase SDK,
 *   • if no Firebase configuration is present the offline modes keep working untouched.
 */

import type { FirebaseApp } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import type { Database } from 'firebase/database';

export interface FirebaseEnvStatus {
  configured: boolean;
  missing: string[];
  projectId: string;
}

const ENV_KEYS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  databaseURL: 'VITE_FIREBASE_DATABASE_URL',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  appId: 'VITE_FIREBASE_APP_ID',
} as const;

function readEnv(key: string): string {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function getFirebaseConfig() {
  return {
    apiKey: readEnv(ENV_KEYS.apiKey),
    authDomain: readEnv(ENV_KEYS.authDomain),
    databaseURL: readEnv(ENV_KEYS.databaseURL),
    projectId: readEnv(ENV_KEYS.projectId),
    appId: readEnv(ENV_KEYS.appId),
  };
}

export function getFirebaseEnvStatus(): FirebaseEnvStatus {
  const config = getFirebaseConfig();
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  return {
    configured: missing.length === 0,
    missing,
    projectId: config.projectId,
  };
}

export function isFirebaseConfigured(): boolean {
  return getFirebaseEnvStatus().configured;
}

let clientPromise: Promise<{ app: FirebaseApp; auth: Auth; db: Database }> | null = null;

/**
 * Lazily boots the Firebase SDK. Throws a readable error when the env vars are absent so the
 * caller can surface a clear "online features require configuration" message instead of a
 * cryptic SDK failure.
 */
export function getFirebaseClient(): Promise<{ app: FirebaseApp; auth: Auth; db: Database }> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const status = getFirebaseEnvStatus();
    if (!status.configured) {
      throw new Error(
        `Firebase is not configured. Missing environment variables: ${status.missing.join(', ')}`
      );
    }
    const [{ initializeApp, getApps, getApp }, authModule, dbModule] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/database'),
    ]);
    const app = getApps().length > 0 ? getApp() : initializeApp(getFirebaseConfig());
    // Firebase requires the Auth instance to exist before the Realtime Database instance.
    const auth = authModule.getAuth(app);
    const db = dbModule.getDatabase(app);
    return { app, auth, db };
  })();
  // A failed boot must not poison the cache — the user may fix the env vars and retry.
  clientPromise.catch(() => {
    clientPromise = null;
  });
  return clientPromise;
}

export async function getFirebaseAuth(): Promise<Auth> {
  return (await getFirebaseClient()).auth;
}

export async function getFirebaseDb(): Promise<Database> {
  return (await getFirebaseClient()).db;
}

export type { User };
