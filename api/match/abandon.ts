/**
 * POST /api/match/abandon
 *
 * Two ways a match ends without a knockout:
 *   • `reason: 'quit'`     — the caller deliberately leaves; the opponent is awarded the win.
 *   • `reason: 'disconnect'` — the caller claims the win because the opponent has been gone past
 *                              the reconnect grace period. The server verifies the opponent really
 *                              is stale before awarding anything, so a short network blip can
 *                              never be used to steal a match.
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
import { isPeerDisconnected } from '../_lib/matchEngine';
import { loadMatch, matchRef, recordMatchCompletion, shotResultFrom, teamOf } from '../_lib/matches';
import type { MatchRecord, OnlineTeam } from '../../src/online/types';

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method && req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }
    const { uid } = await requireUser(req);
    rateLimit(uid, 'match-abandon', 30);
    await requireProfile(uid);

    const body = readJsonBody(req);
    const matchId = sanitizeMatchId(body.matchId);
    const reason = body.reason === 'disconnect' ? 'disconnect' : 'quit';

    const match = await loadMatch(matchId);
    const myTeam = teamOf(match, uid);
    if (!myTeam) throw new HttpError(403, 'You are not a player in this match.', 'not_a_member');

    if (match.status === 'finished' || match.status === 'abandoned') {
      ok(res, shotResultFrom(match, false));
      return;
    }

    const opponent = Object.values(match.players).find((p) => p.uid !== uid);
    if (reason === 'disconnect') {
      if (!opponent || !isPeerDisconnected(match, opponent.uid)) {
        throw new HttpError(409, 'Your opponent is still connected.', 'opponent_present');
      }
    }

    const winner: OnlineTeam = myTeam === 'blue' ? 'red' : 'blue';
    const winReason =
      reason === 'disconnect'
        ? 'Opponent could not reconnect in time — match forfeited.'
        : 'Opponent left the match.';

    const committed = await matchRef(matchId).transaction((current) => {
      const stored = current as MatchRecord | null;
      if (!stored) return undefined;
      if (stored.status === 'finished' || stored.status === 'abandoned') return undefined;
      const now = Date.now();
      const next: MatchRecord = {
        ...stored,
        status: 'finished',
        updatedAt: now,
        finishedAt: now,
        winner,
        winReason,
      };
      return next;
    });

    if (!committed.committed) {
      const latest = (await matchRef(matchId).get()).val() as MatchRecord | null;
      if (!latest) throw new HttpError(404, 'Match not found.', 'match_not_found');
      ok(res, shotResultFrom(latest, false));
      return;
    }

    const next = committed.snapshot.val() as MatchRecord;
    await recordMatchCompletion(next);
    ok(res, shotResultFrom(next, true));
  } catch (error) {
    fail(res, error);
  }
}
