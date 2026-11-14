/**
 * Realtime Database subscription helpers.
 *
 * Every listener created here is torn down on unmount / path change, which is the single place
 * responsible for the "clean up listeners when leaving rooms" requirement.
 */

import { useEffect, useRef, useState } from 'react';
import type { Unsubscribe } from 'firebase/database';
import { getFirebaseClient, isFirebaseConfigured } from './firebaseClient';

export interface RealtimeValue<T> {
  value: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Subscribes to a Realtime Database path. Pass `null` to stay detached (e.g. no room selected).
 */
export function useRealtimeValue<T>(path: string | null): RealtimeValue<T> {
  const [state, setState] = useState<RealtimeValue<T>>({
    value: null,
    loading: Boolean(path),
    error: null,
  });
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (!path || !isFirebaseConfigured()) {
      setState({ value: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    let unsubscribe: Unsubscribe | null = null;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const attach = async () => {
      try {
        const { db } = await getFirebaseClient();
        const dbModule = await import('firebase/database');
        if (cancelled) return;
        unsubscribe = dbModule.onValue(
          dbModule.ref(db, path),
          (snapshot) => {
            if (cancelled) return;
            setState({ value: (snapshot.val() as T | null) ?? null, loading: false, error: null });
          },
          (error) => {
            if (cancelled) return;
            setState({ value: null, loading: false, error: error.message });
          }
        );
      } catch (error) {
        if (cancelled) return;
        setState({
          value: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Realtime listener failed.',
        });
      }
    };

    void attach();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [path]);

  return state;
}

/**
 * Publishes this client's liveness to `/presence/{uid}` and clears it automatically when the
 * socket drops. This is what lets the lobby and the match HUD flag a disconnected peer within
 * seconds, without any polling.
 */
export function useSelfPresence(uid: string | null): void {
  useEffect(() => {
    if (!uid || !isFirebaseConfigured()) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    const attach = async () => {
      try {
        const { db } = await getFirebaseClient();
        const dbModule = await import('firebase/database');
        if (cancelled) return;
        const node = dbModule.ref(db, `presence/${uid}`);
        const markOnline = dbModule.onDisconnect(node);
        void markOnline.set({ connected: false, lastSeen: dbModule.serverTimestamp() });
        const connectedRef = dbModule.ref(db, '.info/connected');
        const connectedUnsub = dbModule.onValue(connectedRef, (snap) => {
          if (snap.val() === true) {
            void dbModule
              .set(node, { connected: true, lastSeen: dbModule.serverTimestamp() })
              .catch(() => undefined);
          }
        });
        cleanup = () => {
          void markOnline.cancel().catch(() => undefined);
          connectedUnsub();
          void dbModule.set(node, { connected: false, lastSeen: dbModule.serverTimestamp() }).catch(
            () => undefined
          );
        };
      } catch {
        // Presence is best-effort — never block the UI on it.
      }
    };

    void attach();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [uid]);
}

export interface PeerPresence {
  connected: boolean;
  lastSeen: number;
}

/** Watches a set of peer uids and reports their live connection state. */
export function usePeerPresence(uids: string[]): Record<string, PeerPresence> {
  const key = uids.filter(Boolean).sort().join(',');
  const { value } = useRealtimeValue<Record<string, PeerPresence>>(
    key ? 'presence' : null
  );
  if (!value) return {};
  const out: Record<string, PeerPresence> = {};
  for (const uid of uids) {
    const entry = value[uid];
    if (entry) out[uid] = { connected: Boolean(entry.connected), lastSeen: Number(entry.lastSeen) || 0 };
  }
  return out;
}
