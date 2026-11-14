/**
 * Online session state.
 *
 * Owns the currently joined room and the currently running match, keeps both mirrored from the
 * Realtime Database, and exposes the server actions the UI needs. All listeners live here so
 * there is exactly one place that has to clean them up.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useOnlineAuth } from './OnlineAuthContext';
import { useRealtimeValue, useSelfPresence } from './useRealtimeValue';
import {
  abandonMatch,
  createRoom as createRoomApi,
  joinRoom as joinRoomApi,
  leaveRoom as leaveRoomApi,
  setRoomPen,
  setRoomReady,
  startRoom,
  submitShot as submitShotApi,
  type CreateRoomInput,
} from './onlineService';
import { ApiError } from './onlineApi';
import type { MatchRecord, RoomRecord, ShotResult, ShotSubmission } from './types';

interface OnlineSessionValue {
  uid: string | null;
  roomCode: string | null;
  room: RoomRecord | null;
  roomLoading: boolean;
  matchId: string | null;
  match: MatchRecord | null;
  matchLoading: boolean;
  busy: boolean;
  error: string | null;
  createRoom: (input: CreateRoomInput) => Promise<void>;
  joinRoom: (code: string, penType: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  setReady: (ready: boolean) => Promise<void>;
  changePen: (penType: string) => Promise<void>;
  startMatch: () => Promise<void>;
  /** Called when matchmaking (or a deep link) hands us a match id with no room. */
  enterMatchById: (matchId: string) => void;
  quitMatch: (reason: 'quit' | 'disconnect') => Promise<void>;
  /** Drops the local room/match binding (returning to the online menu) without the server call. */
  clearMatch: () => void;
  /** Forwards one locally-captured shot to the authoritative server. */
  submitShot: (shot: ShotSubmission) => Promise<ShotResult | null>;
  clearError: () => void;
}

const OnlineSessionContext = createContext<OnlineSessionValue | null>(null);

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export const OnlineSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { uid, getIdToken, status } = useOnlineAuth();
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [explicitMatchId, setExplicitMatchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Presence is only published while signed in.
  useSelfPresence(uid);

  const { value: room, loading: roomLoading } = useRealtimeValue<RoomRecord>(
    roomCode ? `rooms/${roomCode}` : null
  );

  // The room record carries the match id once the host starts, so a joined lobby follows
  // automatically without the guest having to do anything.
  const matchId = explicitMatchId ?? room?.matchId ?? null;
  const { value: match, loading: matchLoading } = useRealtimeValue<MatchRecord>(
    matchId ? `matches/${matchId}` : null
  );

  // If the room we are watching disappears (host left, code expired, rules denied) drop it.
  useEffect(() => {
    if (roomCode && !roomLoading && room === null) {
      setRoomCode(null);
    }
  }, [roomCode, room, roomLoading]);

  // Signing out must not leave a dangling session behind.
  useEffect(() => {
    if (status !== 'ready') {
      setRoomCode(null);
      setExplicitMatchId(null);
    }
  }, [status]);

  const run = useCallback(async <T,>(action: (token: string | null) => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken();
      return await action(token);
    } catch (actionError) {
      setError(toMessage(actionError));
      return null;
    } finally {
      setBusy(false);
    }
  }, [getIdToken]);

  const createRoom = useCallback(
    async (input: CreateRoomInput) => {
      const result = await run((token) => createRoomApi(token, input));
      if (result) {
        setExplicitMatchId(null);
        setRoomCode(result.code);
      }
    },
    [run]
  );

  const joinRoom = useCallback(
    async (code: string, penType: string) => {
      const result = await run((token) => joinRoomApi(token, code.toUpperCase(), penType));
      if (result) {
        setExplicitMatchId(null);
        setRoomCode(result.code);
      }
    },
    [run]
  );

  const leaveRoom = useCallback(async () => {
    const code = roomCode;
    setRoomCode(null);
    setExplicitMatchId(null);
    if (!code) return;
    await run((token) => leaveRoomApi(token, code));
  }, [roomCode, run]);

  const setReady = useCallback(
    async (ready: boolean) => {
      if (!roomCode) return;
      await run((token) => setRoomReady(token, roomCode, ready));
    },
    [roomCode, run]
  );

  const changePen = useCallback(
    async (penType: string) => {
      if (!roomCode) return;
      await run((token) => setRoomPen(token, roomCode, penType));
    },
    [roomCode, run]
  );

  const startMatch = useCallback(async () => {
    if (!roomCode) return;
    const result = await run((token) => startRoom(token, roomCode));
    if (result) setExplicitMatchId(result.matchId);
  }, [roomCode, run]);

  const enterMatchById = useCallback((id: string) => {
    setRoomCode(null);
    setExplicitMatchId(id);
  }, []);

  const quitMatch = useCallback(
    async (reason: 'quit' | 'disconnect') => {
      const id = explicitMatchId ?? room?.matchId ?? null;
      if (!id) return;
      await run((token) => abandonMatch(token, id, reason));
    },
    [explicitMatchId, room, run]
  );

  const submitShot = useCallback(
    async (shot: ShotSubmission) => run((token) => submitShotApi(token, shot)),
    [run]
  );

  const clearMatch = useCallback(() => {
    setRoomCode(null);
    setExplicitMatchId(null);
  }, []);

  const value = useMemo<OnlineSessionValue>(
    () => ({
      uid,
      roomCode,
      room,
      roomLoading,
      matchId,
      match,
      matchLoading,
      busy,
      error,
      createRoom,
      joinRoom,
      leaveRoom,
      setReady,
      changePen,
      startMatch,
      enterMatchById,
      quitMatch,
      clearMatch,
      submitShot,
      clearError: () => setError(null),
    }),
    [
      uid,
      roomCode,
      room,
      roomLoading,
      matchId,
      match,
      matchLoading,
      busy,
      error,
      createRoom,
      joinRoom,
      leaveRoom,
      setReady,
      changePen,
      startMatch,
      enterMatchById,
      quitMatch,
      clearMatch,
      submitShot,
    ]
  );

  return <OnlineSessionContext.Provider value={value}>{children}</OnlineSessionContext.Provider>;
};

export function useOnlineSession(): OnlineSessionValue {
  const ctx = useContext(OnlineSessionContext);
  if (!ctx) throw new Error('useOnlineSession must be used inside <OnlineSessionProvider>.');
  return ctx;
}
