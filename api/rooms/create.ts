/**
 * POST /api/rooms/create
 *
 * The authenticated (and profiled) caller becomes Player 1 / host. The 6-character code is
 * generated and validated here — clients can never choose their own code.
 */

import {
  clampInt,
  fail,
  HttpError,
  ok,
  rateLimit,
  readJsonBody,
  requireProfile,
  requireUser,
  sanitizeArenaId,
  sanitizeOrientation,
  sanitizePenType,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/core';
import { createRoom } from '../_lib/rooms';
import { ONLINE_MAX_PLAYERS, type CreateRoomResponse, type RoomSettings } from '../../src/online/types';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method && req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }
    const { uid } = await requireUser(req);
    rateLimit(uid, 'room-create', 20);
    const profile = await requireProfile(uid);

    const body = readJsonBody(req);
    // `arenaId` / `penType` are optional — a missing/invalid value falls back to the defaults.
    const settings: RoomSettings = {
      mode: '1v1',
      maxPlayers: ONLINE_MAX_PLAYERS as 2,
      arenaId: sanitizeArenaId(body.arenaId),
      turnTimerSeconds: clampInt(body.turnTimerSeconds, 5, 90, 30),
      orientation: sanitizeOrientation(body.orientation),
    };
    const penType = sanitizePenType(body.penType);

    const room = await createRoom(profile, settings, penType);
    const payload: CreateRoomResponse = { code: room.code, room };
    ok(res, payload);
  } catch (error) {
    fail(res, error);
  }
}
