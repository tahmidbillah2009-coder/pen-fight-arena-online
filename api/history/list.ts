/**
 * GET /api/history/list
 *
 * Returns the caller's recent online matches plus their lifetime statistics. The uid always comes
 * from the verified token, so a player can only ever read their own history.
 */

import {
  clampInt,
  fail,
  HttpError,
  ok,
  requireProfile,
  requireUser,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/core';
import { adminDb, DEFAULT_STATS } from '../_lib/core';
import type { MatchHistoryEntry, PlayerStats } from '../../src/online/types';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method && req.method !== 'GET') {
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }
    const { uid } = await requireUser(req);
    await requireProfile(uid);

    const limit = clampInt(
      typeof req.query?.limit === 'string' ? req.query.limit : undefined,
      1,
      50,
      20
    );

    const db = adminDb();
    const [historySnap, statsSnap] = await Promise.all([
      db.ref(`matchHistory/${uid}`).get(),
      db.ref(`playerStats/${uid}`).get(),
    ]);

    const raw = (historySnap.val() as Record<string, MatchHistoryEntry> | null) ?? {};
    const matches = Object.values(raw)
      .filter((entry) => entry && typeof entry.completedAt === 'number')
      .sort((a, b) => b.completedAt - a.completedAt)
      .slice(0, limit);

    const stats: PlayerStats =
      (statsSnap.val() as PlayerStats | null) ?? {
        uid,
        ...DEFAULT_STATS,
        updatedAt: Date.now(),
      };

    ok(res, { matches, stats });
  } catch (error) {
    fail(res, error);
  }
}
