/**
 * POST /api/matchmaking/cancel
 *
 * Removes the caller from the queue. A pair that has already been claimed is never torn down by a
 * cancel, so a cancel racing a successful match cannot strand the opponent.
 */

import {
  fail,
  HttpError,
  ok,
  rateLimit,
  requireProfile,
  requireUser,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/core';
import { cancelQueue } from '../_lib/matchmaking';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method && req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }
    const { uid } = await requireUser(req);
    rateLimit(uid, 'matchmaking-cancel', 60);
    await requireProfile(uid);

    const result = await cancelQueue(uid);
    ok(res, result);
  } catch (error) {
    fail(res, error);
  }
}
