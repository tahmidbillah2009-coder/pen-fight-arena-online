/**
 * POST /api/profile/username-availability
 *
 * Availability is advisory UI feedback only. Profile setup repeats the ownership checks and
 * reserves the normalized username transactionally before committing the profile.
 */

import {
  fail,
  HttpError,
  isUsernameAvailable,
  ok,
  rateLimit,
  readJsonBody,
  requireUser,
  sanitizeUsername,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/core';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method && req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }
    const { uid } = await requireUser(req);
    rateLimit(uid, 'username-availability', 60);

    const body = readJsonBody(req);
    const username = sanitizeUsername(body.username);
    const available = await isUsernameAvailable(uid, username);
    ok(res, { available });
  } catch (error) {
    fail(res, error);
  }
}
