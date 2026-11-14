/**
 * Shared Online Multiplayer contracts.
 *
 * This module is intentionally free of any DOM / Three.js / React imports so it can be used
 * unchanged by BOTH the browser client and the Node serverless functions (which run the
 * authoritative simulation). Everything here is plain JSON-serialisable data.
 */

export type OnlineGender = 'male' | 'female' | 'prefer_not_to_say';

export type OnlineTeam = 'blue' | 'red';

export type ArenaOrientation = 'horizontal' | 'vertical';

export type RoomStatus = 'waiting' | 'ready' | 'starting' | 'closed';

export type MatchStatus = 'countdown' | 'active' | 'finished' | 'abandoned';

export type MatchmakingStatus = 'searching' | 'matched' | 'expired';

/** Result of the client-side shot capture, validated and replayed by the server. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PenPhysicsState {
  pos: Vec3;
  rot: Quat;
  linvel: Vec3;
  angvel: Vec3;
}

// ── Profiles ────────────────────────────────────────────────────────────────

export interface OnlineUserProfile {
  uid: string;
  displayName: string;
  username: string;
  gender: OnlineGender;
  avatarUrl: string;
  profileComplete: boolean;
  createdAt: number;
  updatedAt: number;
}

// ── Rooms ───────────────────────────────────────────────────────────────────

export interface RoomSettings {
  mode: '1v1';
  maxPlayers: 2;
  arenaId: string;
  turnTimerSeconds: number;
  orientation: ArenaOrientation;
}

export interface RoomPlayer {
  uid: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  penType: string;
  team: OnlineTeam;
  ready: boolean;
  /** Mirrored from Realtime Database presence so the lobby can flag a dropped peer. */
  connected: boolean;
  joinedAt: number;
}

export interface RoomRecord {
  code: string;
  hostUid: string;
  status: RoomStatus;
  createdAt: number;
  updatedAt: number;
  settings: RoomSettings;
  /** Keyed by uid. Never more than `settings.maxPlayers` entries. */
  players: Record<string, RoomPlayer>;
  matchId: string | null;
}

// ── Matchmaking ─────────────────────────────────────────────────────────────

export interface MatchmakingEntry {
  uid: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  penType: string;
  arenaId: string;
  joinedAt: number;
  status: MatchmakingStatus;
  matchId: string | null;
  roomCode: string | null;
}

// ── Matches ─────────────────────────────────────────────────────────────────

export interface MatchPlayerState {
  uid: string;
  penId: string;
  team: OnlineTeam;
  displayName: string;
  username: string;
  avatarUrl: string;
  penType: string;
  eliminated: boolean;
  shotsCount: number;
  knockoutsCount: number;
  connected: boolean;
  lastSeen: number;
}

export interface MatchShotEvent {
  seq: number;
  byUid: string;
  byPenId: string;
  powerRatio: number;
  spinFactor: number;
  impulse: Vec3;
  applyPoint: Vec3;
  at: number;
}

export interface MatchScores {
  blueScore: number;
  redScore: number;
  blueKnockouts: number;
  redKnockouts: number;
}

export interface MatchRecord {
  matchId: string;
  roomCode: string;
  mode: '1v1';
  arenaId: string;
  orientation: ArenaOrientation;
  turnTimerSeconds: number;
  status: MatchStatus;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  finishedAt: number | null;
  /** Keyed by pen id (`blue_1` / `red_1`). */
  players: Record<string, MatchPlayerState>;
  uidToPenId: Record<string, string>;
  /** Index into the turn queue (`blue_1` → `red_1`), authoritative. */
  activePlayerId: string;
  turnNumber: number;
  /** Monotonic shot sequence — the last shot the server has committed. */
  seq: number;
  lastShot: MatchShotEvent | null;
  pens: Record<string, PenPhysicsState>;
  scores: MatchScores;
  winner: OnlineTeam | null;
  winReason: string;
  /** Wall-clock epoch ms of the last heartbeat from each uid (grace-period logic). */
  presence: Record<string, { connected: boolean; lastSeen: number }>;
}

// ── Match history & stats ───────────────────────────────────────────────────

export interface MatchHistoryEntry {
  matchId: string;
  opponentName: string;
  opponentUsername: string;
  opponentAvatarUrl: string;
  result: 'win' | 'loss';
  mode: '1v1';
  arenaId: string;
  blueScore: number;
  redScore: number;
  reason: string;
  completedAt: number;
}

export interface PlayerStats {
  uid: string;
  onlineWins: number;
  onlineLosses: number;
  onlineMatches: number;
  knockouts: number;
  currentStreak: number;
  bestStreak: number;
  updatedAt: number;
}

// ── Wire payloads ───────────────────────────────────────────────────────────

/** Sent by the active player at drag release. */
export interface ShotSubmission {
  matchId: string;
  /** Expected next sequence number — the server rejects replays / out-of-order shots. */
  seq: number;
  localAnchor: Vec3;
  impulse: Vec3;
  applyPoint: Vec3;
  powerRatio: number;
  spinFactor: number;
  dragDistance: number;
}

/** Authoritative outcome of one committed shot. */
export interface ShotResult {
  seq: number;
  /** False when the server rejected the shot (stale seq / not this player's turn). */
  applied: boolean;
  pens: Record<string, PenPhysicsState>;
  activePlayerId: string;
  turnNumber: number;
  eliminated: string[];
  scores: MatchScores;
  winner: OnlineTeam | null;
  winReason: string;
  matchStatus: MatchStatus;
}

export interface CreateRoomRequest {
  arenaId: string;
  penType: string;
  turnTimerSeconds: number;
  orientation: ArenaOrientation;
}

export interface CreateRoomResponse {
  code: string;
  room: RoomRecord;
}

export interface JoinRoomRequest {
  code: string;
  penType: string;
}

export interface ApiOk<T> {
  ok: true;
  data: T;
}

export interface ApiErr {
  ok: false;
  error: string;
  code?: string;
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

// ── Constants shared by client and server ───────────────────────────────────

/** Six-character A–Z0–9 code, generated server-side only. */
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const ONLINE_MAX_PLAYERS = 2;

/** Reconnect grace window before a dropped peer may be force-forfeited. */
export const DISCONNECT_GRACE_MS = 30_000;

/** Matchmaking entries older than this are garbage-collected by the server. */
export const MATCHMAKING_TTL_MS = 120_000;

export const PEN_ID_BLUE = 'blue_1';
export const PEN_ID_RED = 'red_1';

export function otherTeam(team: OnlineTeam): OnlineTeam {
  return team === 'blue' ? 'red' : 'blue';
}

export function isValidVec3(value: unknown): value is Vec3 {
  if (!value || typeof value !== 'object') return false;
  const v = value as Vec3;
  return (
    Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
  );
}

export function isValidQuat(value: unknown): value is Quat {
  if (!value || typeof value !== 'object') return false;
  const q = value as Quat;
  return (
    Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w)
  );
}

export function isValidPenPhysicsState(value: unknown): value is PenPhysicsState {
  if (!value || typeof value !== 'object') return false;
  const s = value as PenPhysicsState;
  return (
    isValidVec3(s.pos) &&
    isValidQuat(s.rot) &&
    isValidVec3(s.linvel) &&
    isValidVec3(s.angvel)
  );
}
