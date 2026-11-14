/**
 * POST /api/profile/setup
 *
 * Creates or updates the caller's online profile. The uid always comes from the verified
 * Firebase ID token — a client can never write another player's profile. Usernames are unique
 * across the whole project and are reserved through a transaction.
 */

import {
  adminDb,
  ensureStats,
  fail,
  HttpError,
  loadProfile,
  ok,
  rateLimit,
  readJsonBody,
  releaseUsername,
  requireUser,
  reserveUsername,
  sanitizeDisplayName,
  sanitizeGender,
  sanitizeUsername,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/core';
import type { OnlineUserProfile } from '../../src/online/types';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method && req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }
    const { uid, name, picture } = await requireUser(req);
    rateLimit(uid, 'profile-setup', 12);

    const body = readJsonBody(req);
    const displayName = sanitizeDisplayName(body.displayName ?? name);
    const username = sanitizeUsername(body.username);
    const gender = sanitizeGender(body.gender);

    const now = Date.now();
    let reserved = false;
    const transactionInfo: { previousUsername: string | null } = { previousUsername: null };
    let savedProfile: OnlineUserProfile | null = null;

    try {
      // Always reserve, including for an existing profile. This also safely migrates legacy
      // profiles whose username exists but whose index entry does not.
      await reserveUsername(uid, username);
      reserved = true;

      const result = await adminDb()
        .ref(`users/${uid}`)
        .transaction((current) => {
          const liveProfile = current as OnlineUserProfile | null;
          transactionInfo.previousUsername = liveProfile?.username ?? null;
          const nextProfile: OnlineUserProfile = {
            ...(liveProfile ?? {}),
            uid,
            displayName,
            username,
            gender,
            avatarUrl: picture || liveProfile?.avatarUrl || '',
            profileComplete: true,
            createdAt: liveProfile?.createdAt ?? now,
            updatedAt: Date.now(),
          };
          savedProfile = nextProfile;
          return nextProfile;
        });

      if (!result.committed) {
        throw new HttpError(500, 'Could not save your profile. Please try again.', 'profile_save_failed');
      }
      savedProfile = result.snapshot.val() as OnlineUserProfile;
    } catch (error) {
      if (reserved) {
        // Roll back only if no committed profile now depends on this reservation. This protects
        // a concurrent successful save by the same account.
        const liveProfile = await loadProfile(uid).catch(() => null);
        if (liveProfile?.username.trim().toLowerCase() !== username) {
          await releaseUsername(username, uid).catch(() => undefined);
        }
      }
      throw error;
    }

    const previousUsername = transactionInfo.previousUsername;
    if (previousUsername && previousUsername.trim().toLowerCase() !== username) {
      await releaseUsername(previousUsername, uid).catch(() => undefined);
    }
    await ensureStats(uid).catch(() => undefined);

    ok(res, savedProfile);
  } catch (error) {
    fail(res, error);
  }
}
