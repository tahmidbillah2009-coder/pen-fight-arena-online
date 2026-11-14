import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { User } from 'firebase/auth';
import type { Unsubscribe } from 'firebase/database';
import { getFirebaseEnvStatus, getFirebaseClient, isFirebaseConfigured } from './firebaseClient';
import { apiPost } from './onlineApi';
import { checkUsernameAvailability } from './onlineService';
import type { OnlineGender, OnlineUserProfile } from './types';

export type OnlineAuthStatus =
  | 'unconfigured'
  | 'loading'
  | 'signedOut'
  | 'needsProfile'
  | 'ready';

export interface OnlineAuthContextValue {
  status: OnlineAuthStatus;
  user: User | null;
  profile: OnlineUserProfile | null;
  uid: string | null;
  error: string | null;
  abandonedSession: boolean;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  saveProfile: (input: {
    displayName: string;
    username: string;
    gender: OnlineGender;
  }) => Promise<void>;
  checkUsername: (username: string) => Promise<boolean>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  clearError: () => void;
}

const OnlineAuthContext = createContext<OnlineAuthContextValue | null>(null);

export const OnlineAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const configured = isFirebaseConfigured();
  const [status, setStatus] = useState<OnlineAuthStatus>(configured ? 'loading' : 'unconfigured');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<OnlineUserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abandonedSession, setAbandonedSession] = useState(false);
  /** Tracks whether we ever saw a signed-in user, to distinguish "expired" from "signed out". */
  const hadSessionRef = useRef(false);

  // ── Auth state subscription ────────────────────────────────────────────────
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    let unsubAuth: Unsubscribe | null = null;
    let unsubDb: Unsubscribe | null = null;

    const boot = async () => {
      try {
        const { auth, db } = await getFirebaseClient();
        if (cancelled) return;
        const authModule = await import('firebase/auth');
        const dbModule = await import('firebase/database');

        unsubAuth = authModule.onAuthStateChanged(
          auth,
          (nextUser) => {
            if (cancelled) return;
            unsubDb?.();
            unsubDb = null;
            setUser(nextUser);
            if (!nextUser) {
              setProfile(null);
              if (hadSessionRef.current) {
                setAbandonedSession(true);
                setError('Your session expired. Please sign in again.');
              }
              hadSessionRef.current = false;
              setStatus('signedOut');
              return;
            }
            hadSessionRef.current = true;
            setAbandonedSession(false);
            setStatus('loading');
            const profileRef = dbModule.ref(db, `users/${nextUser.uid}`);
            unsubDb = dbModule.onValue(profileRef, (snapshot) => {
              if (cancelled) return;
              const value = snapshot.val() as OnlineUserProfile | null;
              setProfile(value);
              setStatus(value?.profileComplete ? 'ready' : 'needsProfile');
            });
          },
          (authError) => {
            if (cancelled) return;
            setError(authError.message);
            setStatus('signedOut');
          }
        );
      } catch (bootError) {
        if (cancelled) return;
        setError(bootError instanceof Error ? bootError.message : 'Firebase failed to initialise.');
        setStatus('unconfigured');
      }
    };

    void boot();
    return () => {
      cancelled = true;
      unsubAuth?.();
      unsubDb?.();
    };
  }, [configured]);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    try {
      const { auth } = await getFirebaseClient();
      const authModule = await import('firebase/auth');
      const provider = new authModule.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await authModule.signInWithPopup(auth, provider);
      } catch (popupError) {
        const code = (popupError as { code?: string }).code ?? '';
        // Popups are blocked on some mobile browsers — fall back to a full-page redirect.
        if (
          code === 'auth/popup-blocked' ||
          code === 'auth/operation-not-supported-in-this-environment' ||
          code === 'auth/cancelled-popup-request'
        ) {
          await authModule.signInWithRedirect(auth, provider);
          return;
        }
        throw popupError;
      }
    } catch (signInError) {
      const code = (signInError as { code?: string }).code ?? '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return; // User dismissed the dialog — not an error worth shouting about.
      }
      setError(describeAuthError(signInError));
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setError(null);
    try {
      const { auth } = await getFirebaseClient();
      const authModule = await import('firebase/auth');
      await authModule.signOut(auth);
      setProfile(null);
      setStatus('signedOut');
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : 'Sign out failed.');
    }
  }, []);

  const saveProfile = useCallback(
    async (input: { displayName: string; username: string; gender: OnlineGender }) => {
      const current = user ?? (await (await getFirebaseClient()).auth.currentUser);
      if (!current) throw new Error('You must be signed in to save a profile.');
      const token = await current.getIdToken();
      const saved = await apiPost<OnlineUserProfile>('/profile/setup', input, token);
      setProfile(saved);
      setStatus(saved.profileComplete ? 'ready' : 'needsProfile');
    },
    [user]
  );

  const checkUsername = useCallback(
    async (username: string) => {
      const current = user ?? (await (await getFirebaseClient()).auth.currentUser);
      if (!current) throw new Error('You must be signed in to check a username.');
      const token = await current.getIdToken();
      const result = await checkUsernameAvailability(token, username);
      return result.available;
    },
    [user]
  );

  const getIdToken = useCallback(
    async (forceRefresh = false) => {
      if (!configured) return null;
      try {
        const { auth } = await getFirebaseClient();
        const current = auth.currentUser;
        if (!current) return null;
        return await current.getIdToken(forceRefresh);
      } catch {
        return null;
      }
    },
    [configured]
  );

  const value = useMemo<OnlineAuthContextValue>(
    () => ({
      status,
      user,
      profile,
      uid: user?.uid ?? null,
      error,
      abandonedSession,
      signInWithGoogle,
      signOutUser,
      saveProfile,
      checkUsername,
      getIdToken,
      clearError: () => setError(null),
    }),
    [
      status,
      user,
      profile,
      error,
      abandonedSession,
      signInWithGoogle,
      signOutUser,
      saveProfile,
      checkUsername,
      getIdToken,
    ]
  );

  return <OnlineAuthContext.Provider value={value}>{children}</OnlineAuthContext.Provider>;
};

export function useOnlineAuth(): OnlineAuthContextValue {
  const ctx = useContext(OnlineAuthContext);
  if (!ctx) throw new Error('useOnlineAuth must be used inside <OnlineAuthProvider>.');
  return ctx;
}

/** Human-readable explanation for the auth failures we can actually do something about. */
export function describeAuthError(error: unknown): string {
  const code = (error as { code?: string }).code ?? '';
  switch (code) {
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in popup. Allow popups and try again.';
    case 'auth/network-request-failed':
      return 'Network error while contacting Google. Check your connection.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Please wait a moment and retry.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorised for Google sign-in in the Firebase console.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled for this Firebase project.';
    default:
      return error instanceof Error ? error.message : 'Sign-in failed. Please try again.';
  }
}

export function firebaseSetupHint(): string {
  const status = getFirebaseEnvStatus();
  if (status.configured) {
    return 'Firebase is configured. Make sure Google sign-in is enabled in the Firebase console.';
  }
  return `Set these environment variables to enable online play: ${status.missing.join(', ')}`;
}
