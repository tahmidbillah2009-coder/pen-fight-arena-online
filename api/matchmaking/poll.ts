/**
 * POST /api/matchmaking/poll
 *
 * Cheap polling endpoint used by the search UI. Returns `searching`, `matched` (with the match id
 * to subscribe to) or `expired`.
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
import { pollQueue } from '../_lib/matchmaking';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method && req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }
    const { uid } = await requireUser(req);
    rateLimit(uid, 'matchmaking-poll', 300);
    await requireProfile(uid);

    const snapshot = await pollQueue(uid);
    ok(res, snapshot);
  } catch (error) {
    fail(res, error);
  }
}
