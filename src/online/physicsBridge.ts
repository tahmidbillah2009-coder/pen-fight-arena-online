/**
 * Online physics bridge.
 *
 * The uploaded project already contains a completely self-contained Rapier simulation
 * (`PhysicsManager` + `CollisionManager` + `Constants` + `PenCatalog`). None of those modules
 * touch the DOM, the renderer or React, so the EXACT same physics can be executed headlessly on
 * the server.
 *
 * This module is the adapter the specification asks for: it never rewrites, rebalances or
 * re-parameterises the original simulation. It only:
 *   • constructs a `PhysicsManager` for a 1v1 match the same way `TurnManager` does,
 *   • reads / writes rigid-body state (through the public `getBody` accessor),
 *   • replays one validated shot and reports the outcome.
 *
 * Both the browser client and the serverless function import this exact file, which guarantees
 * the online match uses one single physics configuration.
 */

import {
  FALL_Y_THRESHOLD,
  MAX_LAUNCH_SPEED,
  MAX_SHOT_SECONDS,
  MIN_DRAG_THRESHOLD,
  OOB_CONFIRM_SECONDS,
  PEN_SPECS,
  PenTypeId,
  PHYSICS_FIXED_DT,
  SETTLE_ANG_SPEED,
  SETTLE_HOLD_SECONDS,
  SETTLE_LIN_SPEED,
} from '../utils/Constants';
import { computeMultiplayerSpawn } from '../game/MultiplayerTypes';
import { ensureRapierInitialized, PhysicsManager } from '../game/PhysicsManager';
import {
  ArenaOrientation,
  OnlineTeam,
  PEN_ID_BLUE,
  PEN_ID_RED,
  PenPhysicsState,
  Vec3,
} from './types';

export interface OnlinePenConfig {
  penId: string;
  team: OnlineTeam;
  penType: PenTypeId;
}

export interface ShotSimulationInput {
  shooterPenId: string;
  impulse: Vec3;
  applyPoint: Vec3;
}

export interface ShotSimulationOutcome {
  pens: Record<string, PenPhysicsState>;
  /** Pen ids that left the desk during this shot. */
  eliminated: string[];
  /** Total simulated seconds spent resolving the shot. */
  simulatedSeconds: number;
}

export function teamToPenId(team: OnlineTeam): string {
  return team === 'blue' ? PEN_ID_BLUE : PEN_ID_RED;
}

export function penIdToTeam(penId: string): OnlineTeam {
  return penId.startsWith('red') ? 'red' : 'blue';
}

/** Identical spawn maths to `TurnManager.startNewMatch` for a 1v1 roster. */
export function buildPenSpawns(
  pens: OnlinePenConfig[],
  orientation: ArenaOrientation
): Array<{ id: string; penType: PenTypeId; spawn: { x: number; y: number; z: number; yaw: number } }> {
  const blueCount = pens.filter((p) => p.team === 'blue').length || 1;
  const redCount = pens.filter((p) => p.team === 'red').length || 1;
  return pens.map((p) => {
    const teamIdx = pens.filter((o) => o.team === p.team).findIndex((o) => o.penId === p.penId);
    const spawn = computeMultiplayerSpawn(
      p.team,
      Math.max(0, teamIdx),
      p.team === 'blue' ? blueCount : redCount,
      PEN_SPECS[p.penType].radius,
      orientation
    );
    return { id: p.penId, penType: p.penType, spawn };
  });
}

/** Creates a live 1v1 world with both pens at their resting spawns. */
export async function createMatchPhysics(
  pens: OnlinePenConfig[],
  orientation: ArenaOrientation
): Promise<PhysicsManager> {
  await ensureRapierInitialized();
  const physics = new PhysicsManager(pens[0]?.penType ?? 'GRIP_MASTER', pens[1]?.penType ?? 'IRON_FORCE');
  physics.setOrientation(orientation);
  physics.configurePens(buildPenSpawns(pens, orientation));
  physics.resetPens();
  return physics;
}

/** Serialises every pen's rigid-body state into a plain, storable snapshot. */
export function readPenStates(
  physics: PhysicsManager,
  penIds: string[]
): Record<string, PenPhysicsState> {
  const out: Record<string, PenPhysicsState> = {};
  for (const id of penIds) {
    const pose = physics.getPose(id);
    out[id] = {
      pos: { ...pose.pos },
      rot: { ...pose.rot },
      linvel: { ...pose.linvel },
      angvel: { ...pose.angvel },
    };
  }
  return out;
}

/**
 * Writes an authoritative snapshot back onto the live rigid bodies. Used by the client for
 * reconciliation (keeping its presentation sim locked to the server) and by the server when
 * restoring a match before replaying a shot.
 */
export function applyPenStates(
  physics: PhysicsManager,
  states: Record<string, PenPhysicsState>
): void {
  for (const [id, state] of Object.entries(states)) {
    const body = physics.getBody(id);
    if (!body) continue;
    body.setTranslation(state.pos, true);
    body.setRotation(state.rot, true);
    body.setLinvel(state.linvel, true);
    body.setAngvel(state.angvel, true);
  }
}

/**
 * Upper bound on a legal impulse for a pen. The drag controller derives its impulse from
 * `MAX_LAUNCH_SPEED` and the pen mass, so anything meaningfully above this is a forged shot.
 */
export function maxImpulseFor(penType: PenTypeId): number {
  const spec = PEN_SPECS[penType];
  const maxSpeedForPen = MAX_LAUNCH_SPEED / Math.pow(Math.max(0.4, spec.mass), 0.26);
  return maxSpeedForPen * spec.mass * 1.12;
}

/** Maximum legal distance between the apply point and the pen's centre of mass. */
export function maxAnchorReach(penType: PenTypeId): number {
  const spec = PEN_SPECS[penType];
  return spec.length * 0.5 + spec.radius + 0.05;
}

/**
 * Applies one validated shot to an already-positioned world and advances the simulation until
 * the desk settles, a pen leaves the table, or the shot watchdog expires — mirroring the exact
 * loop `TurnManager.update` runs during `SHOT_IN_PROGRESS`.
 */
export function simulateShot(
  physics: PhysicsManager,
  penIds: string[],
  input: ShotSimulationInput
): ShotSimulationOutcome {
  const body = physics.getBody(input.shooterPenId);
  if (!body) {
    return { pens: readPenStates(physics, penIds), eliminated: [], simulatedSeconds: 0 };
  }

  body.resetForces(true);
  body.resetTorques(true);
  const pos = body.translation();
  body.wakeUp();
  body.applyImpulseAtPoint(
    { x: input.impulse.x, y: input.impulse.y, z: input.impulse.z },
    { x: input.applyPoint.x, y: pos.y, z: input.applyPoint.z },
    true
  );

  const oobTimers: Record<string, number> = {};
  const eliminated: string[] = [];
  const alreadyOut: Record<string, boolean> = {};
  for (const id of penIds) {
    oobTimers[id] = 0;
    const pose = physics.getPose(id);
    alreadyOut[id] = pose.pos.y < FALL_Y_THRESHOLD;
  }

  let simulated = 0;
  let settleTimer = 0;
  const maxSeconds = MAX_SHOT_SECONDS + 0.5;

  while (simulated < maxSeconds) {
    physics.step(PHYSICS_FIXED_DT);
    simulated += PHYSICS_FIXED_DT;

    let anyPendingOob = false;
    for (const id of penIds) {
      if (alreadyOut[id]) continue;
      const pose = physics.getPose(id);
      const proximity = physics.getEdgeProximity(id);
      let timer = oobTimers[id];
      if (pose.pos.y < FALL_Y_THRESHOLD) {
        timer = OOB_CONFIRM_SECONDS;
      } else if (proximity.isOutsideBounds) {
        timer += PHYSICS_FIXED_DT;
      } else {
        timer = 0;
      }
      oobTimers[id] = timer;
      if (timer >= OOB_CONFIRM_SECONDS) {
        alreadyOut[id] = true;
        eliminated.push(id);
      } else if (timer > 0) {
        anyPendingOob = true;
      }
    }

    const settled = physics.arePensSettled(SETTLE_LIN_SPEED, SETTLE_ANG_SPEED);
    if (settled && !anyPendingOob) {
      settleTimer += PHYSICS_FIXED_DT;
    } else {
      settleTimer = 0;
    }

    // An early knockout resolves quickly, exactly like the local turn manager.
    const quickFall = eliminated.length > 0 && simulated > 0.85;
    if (settleTimer >= SETTLE_HOLD_SECONDS || quickFall || simulated >= MAX_SHOT_SECONDS) {
      break;
    }
  }

  return {
    pens: readPenStates(physics, penIds),
    eliminated,
    simulatedSeconds: simulated,
  };
}

/** Server-side legitimacy check for the shot parameters captured by the client. */
export function validateShotParameters(
  penType: PenTypeId,
  shot: { impulse: Vec3; applyPoint: Vec3; dragDistance: number; powerRatio: number },
  penPos: Vec3
): { ok: true } | { ok: false; error: string } {
  const magnitude = Math.hypot(shot.impulse.x, shot.impulse.y, shot.impulse.z);
  const limit = maxImpulseFor(penType);
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return { ok: false, error: 'Shot impulse is not a finite vector.' };
  }
  if (magnitude > limit) {
    return { ok: false, error: 'Shot impulse exceeds the pen launch envelope.' };
  }
  if (Math.abs(shot.impulse.y) > limit * 0.25) {
    return { ok: false, error: 'Shot impulse has an illegal vertical component.' };
  }

  const reach = Math.hypot(shot.applyPoint.x - penPos.x, shot.applyPoint.z - penPos.z);
  if (reach > maxAnchorReach(penType)) {
    return { ok: false, error: 'Shot apply point is outside the pen body.' };
  }

  if (!Number.isFinite(shot.dragDistance) || shot.dragDistance < MIN_DRAG_THRESHOLD - 0.05) {
    return { ok: false, error: 'Shot drag distance is below the launch threshold.' };
  }
  if (!Number.isFinite(shot.powerRatio) || shot.powerRatio < 0 || shot.powerRatio > 1.0001) {
    return { ok: false, error: 'Shot power ratio is out of range.' };
  }
  return { ok: true };
}
