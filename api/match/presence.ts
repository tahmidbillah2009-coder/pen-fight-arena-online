/**
 * POST /api/match/presence
 *
 * Heartbeat that records the caller's liveness on the match record. The grace-period logic on the
 * server reads this; a client can only ever report its OWN presence (uid comes from the token).
 */

import {
  fail,
  HttpError,
  ok,
  rateLimit,
  readJsonBody,
  requireProfile,
  requireUser,
  sanitizeMatchId,
  type ApiRequest,
  type ApiResponse,
} from '../_lib/core';
import { loadMatch, matchRef } from '../_lib/matches';
import type { MatchRecord } from '../../src/online/types';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method && req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }
    const { uid } = await requireUser(req);
    rateLimit(uid, 'match-presence', 240);
    await requireProfile(uid);

    const body = readJsonBody(req);
    const matchId = sanitizeMatchId(body.matchId);
    const connected = body.connected !== false;

    const match = await loadMatch(matchId);
    if (!match.uidToPenId?.[uid]) {
      throw new HttpError(403, 'You are not a player in this match.', 'not_a_member');
    }

    const now = Date.now();
    const presence = { ...(match.presence ?? {}) };
    presence[uid] = { connected, lastSeen: now };

    const player = match.players[match.uidToPenId[uid]];
    const players = player
      ? { ...match.players, [player.penId]: { ...player, connected, lastSeen: now } }
      : match.players;

    await matchRef(matchId).transaction((current) => {
      const stored = current as MatchRecord | null;
      if (!stored) return undefined;
      return { ...stored, presence, players, updatedAt: now };
    });

    ok(res, { ok: true, status: match.status });
  } catch (error) {
    fail(res, error);
  }
}
