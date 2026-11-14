/**
 * POST /api/match/shot
 *
 * The single authoritative entry point for gameplay. The client only ever describes the drag it
 * performed; the server authenticates the player, verifies membership and turn ownership,
 * validates the shot envelope, replays it through the project's original Rapier simulation and
 * commits the verified result. Clients can never decide an outcome.
 *
 * Exactly-once is guaranteed by the `seq` contract: the shot carries the sequence number it
 * believes it is, and it is only ever committed if the stored match is still one step behind.
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
import { applyShotToMatch } from '../_lib/matchEngine';
import { loadMatch, matchRef, recordMatchCompletion, shotResultFrom } from '../_lib/matches';
import { validateShotParameters } from '../../src/online/physicsBridge';
import { isValidVec3, type MatchRecord, type MatchShotEvent, type Vec3 } from '../../src/online/types';
import type { PenTypeId } from '../../src/utils/PenCatalog';

function finiteNumber(value: unknown, field: string, fallback?: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (fallback !== undefined) return fallback;
  throw new HttpError(400, `Missing or invalid numeric field: ${field}.`, 'bad_field');
}

function readVec3(value: unknown, field: string): Vec3 {
  if (!isValidVec3(value)) {
    throw new HttpError(400, `Missing or invalid vector field: ${field}.`, 'bad_field');
  }
  return { x: value.x, y: value.y, z: value.z };
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    if (req.method && req.method !== 'POST') {
      throw new HttpError(405, 'Method not allowed.', 'method_not_allowed');
    }
    const { uid } = await requireUser(req);
    rateLimit(uid, 'match-shot', 120);
    await requireProfile(uid);

    const body = readJsonBody(req);
    const matchId = sanitizeMatchId(body.matchId);
    const seq = Math.round(finiteNumber(body.seq, 'seq'));
    const impulse = readVec3(body.impulse, 'impulse');
    const applyPoint = readVec3(body.applyPoint, 'applyPoint');
    const powerRatio = finiteNumber(body.powerRatio, 'powerRatio');
    const spinFactor = finiteNumber(body.spinFactor, 'spinFactor', 0);
    const dragDistance = finiteNumber(body.dragDistance, 'dragDistance');

    const match = await loadMatch(matchId);

    // 1. Membership — a non-participant cannot shoot in this match, ever.
    const penId = match.uidToPenId?.[uid];
    const shooter = penId ? match.players?.[penId] : undefined;
    if (!penId || !shooter) {
      throw new HttpError(403, 'You are not a player in this match.', 'not_a_member');
    }
    // 2. Match must still be live.
    if (match.status === 'finished' || match.status === 'abandoned') {
      ok(res, shotResultFrom(match, false));
      return;
    }
    // 3. Turn ownership — only the active player may shoot.
    if (match.activePlayerId !== penId) {
      throw new HttpError(409, 'It is not your turn.', 'not_your_turn');
    }
    // 4. Duplicate / out-of-order suppression.
    if (!Number.isFinite(seq) || seq !== match.seq + 1) {
      ok(res, shotResultFrom(match, false));
      return;
    }
    // 5. Legitimacy of the shot envelope (forged impulses are rejected, not clamped).
    const penPos = match.pens?.[penId]?.pos ?? { x: 0, y: 0, z: 0 };
    const verdict = validateShotParameters(
      shooter.penType as PenTypeId,
      { impulse, applyPoint, dragDistance, powerRatio },
      penPos
    );
    if (!verdict.ok) {
      throw new HttpError(400, verdict.error, 'invalid_shot');
    }

    const shotEvent: MatchShotEvent = {
      seq,
      byUid: uid,
      byPenId: penId,
      powerRatio,
      spinFactor,
      impulse,
      applyPoint,
      at: Date.now(),
    };

    // 6. Authoritative physics replay (outside the transaction — it is the expensive part).
    const application = await applyShotToMatch(match, shotEvent);

    // 7. Commit — only if the stored match is still exactly one sequence behind. A concurrent
    //    duplicate (same client retrying, or a replay attack) fails this guard and is ignored.
    const committed = await matchRef(matchId).transaction((current) => {
      const stored = current as MatchRecord | null;
      if (!stored) return undefined;
      if (stored.seq !== shotEvent.seq - 1) return undefined;
      if (stored.activePlayerId !== penId) return undefined;
      if (stored.status === 'finished' || stored.status === 'abandoned') return undefined;

      const now = Date.now();
      const next: MatchRecord = {
        ...stored,
        status: application.winner ? 'finished' : 'active',
        updatedAt: now,
        finishedAt: application.winner ? now : null,
        players: application.players,
        pens: application.pens,
        activePlayerId: application.nextActivePlayerId,
        turnNumber: application.turnNumber,
        seq: shotEvent.seq,
        lastShot: shotEvent,
        scores: application.scores,
        winner: application.winner,
        winReason: application.winReason,
      };
      return next;
    });

    if (!committed.committed) {
      // Somebody else's shot (or a duplicate) already advanced the match. Return the truth.
      const latest = (await matchRef(matchId).get()).val() as MatchRecord | null;
      if (!latest) throw new HttpError(404, 'Match not found.', 'match_not_found');
      ok(res, shotResultFrom(latest, false));
      return;
    }

    const next = committed.snapshot.val() as MatchRecord;
    if (next.status === 'finished') {
      await recordMatchCompletion(next);
    }
    ok(res, shotResultFrom(next, true));
  } catch (error) {
    fail(res, error);
  }
}
