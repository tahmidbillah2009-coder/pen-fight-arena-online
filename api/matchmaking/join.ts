/**
 * POST /api/matchmaking/join
 *
 * Places the caller in the 1v1 queue (idempotent) and pairs them with the earliest waiting
 * opponent if one exists. The client never decides who it is matched with.
 */

import {
  fail,
  HttpError,
  ok,
  rateLimit,
  readJsonBody,
  requireProfile,
  requireUser,
  sanitizeArenaId,
  sanitizePenType,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/core';
import { joinQueue } from '../_lib/matchmaking';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method && req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }
    const { uid } = await requireUser(req);
    rateLimit(uid, 'matchmaking-join', 60);
    const profile = await requireProfile(uid);

    const body = readJsonBody(req);
    const penType = sanitizePenType(body.penType);
    const arenaId = sanitizeArenaId(body.arenaId);

    const snapshot = await joinQueue(profile, penType, arenaId);
    ok(res, snapshot);
  } catch (error) {
    fail(res, error);
  }
}
