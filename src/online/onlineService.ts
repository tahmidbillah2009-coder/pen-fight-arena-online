/**
 * Typed wrappers for every online endpoint.
 *
 * The UI never talks to `fetch` directly — it calls these helpers with the Firebase ID token, so
 * authentication and error handling stay in one place and the server stays the only authority.
 */

import { apiGet, apiPost } from './onlineApi';
import type {
  ArenaOrientation,
  MatchHistoryEntry,
  MatchRecord,
  PlayerStats,
  RoomRecord,
  ShotResult,
  ShotSubmission,
} from './types';

// ── Rooms ───────────────────────────────────────────────────────────────────

export interface CreateRoomInput {
  arenaId: string;
  penType: string;
  turnTimerSeconds: number;
  orientation: ArenaOrientation;
}

export function checkUsernameAvailability(
  token: string | null,
  username: string
): Promise<{ available: boolean }> {
  return apiPost('/profile/username-availability', { username }, token);
}

export function createRoom(
  token: string | null,
  input: CreateRoomInput
): Promise<{ code: string; room: RoomRecord }> {
  return apiPost('/rooms/create', input, token);
}

export function joinRoom(
  token: string | null,
  code: string,
  penType: string
): Promise<{ code: string; room: RoomRecord }> {
  return apiPost('/rooms/join', { code, penType }, token);
}

export function leaveRoom(
  token: string | null,
  code: string
): Promise<{ closed: boolean }> {
  return apiPost('/rooms/leave', { code }, token);
}

export function setRoomReady(
  token: string | null,
  code: string,
  ready: boolean
): Promise<{ room: RoomRecord }> {
  return apiPost('/rooms/ready', { code, ready }, token);
}

export function setRoomPen(
  token: string | null,
  code: string,
  penType: string
): Promise<{ room: RoomRecord }> {
  return apiPost('/rooms/pen', { code, penType }, token);
}

export function startRoom(
  token: string | null,
  code: string
): Promise<{ matchId: string; match: MatchRecord; room: RoomRecord }> {
  return apiPost('/rooms/start', { code }, token);
}

// ── Matchmaking ─────────────────────────────────────────────────────────────

export interface QueueSnapshot {
  status: 'searching' | 'matched' | 'expired';
  matchId: string | null;
}

export function joinMatchmaking(
  token: string | null,
  input: { penType: string; arenaId: string }
): Promise<QueueSnapshot> {
  return apiPost('/matchmaking/join', input, token);
}

export function pollMatchmaking(token: string | null): Promise<QueueSnapshot> {
  return apiPost('/matchmaking/poll', {}, token);
}

export function cancelMatchmaking(token: string | null): Promise<{ cancelled: boolean }> {
  return apiPost('/matchmaking/cancel', {}, token);
}

// ── Match ───────────────────────────────────────────────────────────────────

export function submitShot(token: string | null, shot: ShotSubmission): Promise<ShotResult> {
  return apiPost('/match/shot', shot, token);
}

export function sendMatchPresence(
  token: string | null,
  matchId: string,
  connected: boolean
): Promise<{ ok: boolean; status: string }> {
  return apiPost('/match/presence', { matchId, connected }, token);
}

export function abandonMatch(
  token: string | null,
  matchId: string,
  reason: 'quit' | 'disconnect'
): Promise<ShotResult> {
  return apiPost('/match/abandon', { matchId, reason }, token);
}

// ── History & stats ─────────────────────────────────────────────────────────

export function listHistory(
  token: string | null
): Promise<{ matches: MatchHistoryEntry[]; stats: PlayerStats }> {
  return apiGet('/history/list', token);
}
