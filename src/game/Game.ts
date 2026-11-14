import * as THREE from 'three';
import { AIController } from '../ai/AIController';
import { AudioManager } from '../audio/AudioManager';
import { AbilitySystem } from './Abilities';
import { AbilityPreviewSource, AimController } from './AimController';
import { CameraManager } from './CameraManager';
import { ComputedShot, DragController } from './DragController';
import { GameSettings, GameStateManager, PlayerId } from './GameState';
import { MultiplayerMatchConfig, TURN_TIMER_OPTIONS, TurnTimerOption } from './MultiplayerTypes';
import { applyPenStates } from '../online/physicsBridge';
import type { MatchRecord, ShotResult, ShotSubmission } from '../online/types';
import { ParticleSystem } from './ParticleSystem';
import { PenModel } from './Pen';
import { PerformanceMonitor } from './PerformanceMonitor';
import { ensureRapierInitialized, BodyPose, PhysicsManager } from './PhysicsManager';
import { QualityController } from './QualityController';
import { detectRecommendedQuality, SceneManager } from './SceneManager';
import { ShotTrailSystem } from './ShotTrails';
import { TableEnvironment } from './Table';
import { TurnManager } from './TurnManager';
import {
  ArenaId,
  ArenaOrientation,
  DEFAULT_DESHI_VARIANT,
  isArenaId,
  PenTypeId,
  resolveArenaOrientation,
} from '../utils/Constants';

/** The AI always fields the same pen class so the match-up stays fair and consistent. */
const BOT_PEN_TYPE = 'IRON_FORCE' as const;

export class PenFightGame {
  private readonly container: HTMLElement;
  public readonly state: GameStateManager;
  public readonly audio = new AudioManager();
  /** Live rendering/physics telemetry for the on-screen performance panel. */
  public readonly monitor = new PerformanceMonitor();

  private settings: GameSettings;
  private sceneManager!: SceneManager;
  private cameraManager!: CameraManager;
  private tableEnv!: TableEnvironment;
  private penModels: Map<string, PenModel> = new Map();
  private penTypes: Map<string, PenTypeId> = new Map();
  private currentMatchConfig: MultiplayerMatchConfig | null = null;
  /** Non-null while this engine instance is bound to an authoritative online match. */
  private onlineMatch: MatchRecord | null = null;
  private onlineLocalPenId: string | null = null;
  /** Highest authoritative shot sequence already reflected in the local rigid bodies. */
  private onlineLastSeq = -1;
  /** Injected by the React layer: forwards a captured shot to the authoritative server. */
  private onlineShotSubmitter:
    | ((shot: ShotSubmission) => Promise<ShotResult | null>)
    | null = null;
  /** Online matches share the host's arena orientation; null means "follow the viewport". */
  private orientationOverride: ArenaOrientation | null = null;
  /** Arena pinned by an online match, restored when the binding is released. */
  private onlinePinnedArenaId: ArenaId | null = null;
  private playerPen!: PenModel;
  private botPen!: PenModel;
  private particles!: ParticleSystem;
  private trailSystem!: ShotTrailSystem;
  private physics!: PhysicsManager;
  private aimController!: AimController;
  private dragController!: DragController;
  private aiController!: AIController;
  private turnManager!: TurnManager;
  private abilitySystem!: AbilitySystem;
  private qualityController!: QualityController;

  private readonly clock = new THREE.Clock();
  /** rAF handle — kept separate from the software-GL timeout handle so both can be cancelled. */
  private rafId = 0;
  private timeoutId = 0;
  private disposed = false;
  private initialized = false;
  /** True while a full-screen overlay hides the arena; the loop is halted instead of burning GPU. */
  private suspended = false;
  private hitstopTimer = 0;
  private telemetryTimer = 0;
  private statsTimer = 0;
  /** Collisions counted between diagnostics flushes, so impacts never re-render React per hit. */
  private pendingCollisions = 0;
  /** Resolved Motion Effects preference (camera shake / hitstop / shot-follow). */
  private motionEnabled = true;
  private abilityPreviewActive = false;
  private arenaOrientation: ArenaOrientation = 'horizontal';
  private readonly trailTip = new THREE.Vector3();
  private readonly shotFocus = new THREE.Vector3();
  private resizeObserver: ResizeObserver | null = null;
  private onContextLostChange?: (lost: boolean) => void;

  constructor(
    container: HTMLElement,
    initialSettings: GameSettings,
    initialWins = 0,
    initialLosses = 0,
    onContextLostChange?: (lost: boolean) => void
  ) {
    this.container = container;
    this.settings = { ...initialSettings };
    this.state = new GameStateManager(initialWins, initialLosses, initialSettings.playerPenType);
    this.onContextLostChange = onContextLostChange;
  }

  public async init(): Promise<void> {
    await ensureRapierInitialized();
    if (this.disposed) return;

    const rect = this.container.getBoundingClientRect();
    const width = Math.round(rect.width) || this.container.clientWidth || window.innerWidth;
    const height = Math.round(rect.height) || this.container.clientHeight || window.innerHeight;

    this.sceneManager = new SceneManager(this.container);
    this.sceneManager.onContextLostChange = this.onContextLostChange;
    // Profile the device once; AUTO quality starts here and never climbs above this tier.
    this.qualityController = new QualityController(detectRecommendedQuality());

    this.arenaOrientation = resolveArenaOrientation(width, height);
    this.cameraManager = new CameraManager(width, height, this.arenaOrientation);
    this.tableEnv = new TableEnvironment(this.sceneManager.maxAnisotropy, this.settings.arenaId);
    this.tableEnv.setOrientation(this.arenaOrientation);
    this.sceneManager.setArenaAtmosphere(this.settings.arenaId);
    this.sceneManager.scene.add(this.tableEnv.group);

    this.playerPen = new PenModel(
      'player',
      this.sceneManager.maxAnisotropy,
      this.settings.playerPenType,
      'blue',
      'team_default',
      this.settings.deshiVariant
    );
    this.botPen = new PenModel('bot', this.sceneManager.maxAnisotropy, BOT_PEN_TYPE, 'red');
    this.sceneManager.scene.add(
      this.playerPen.group,
      this.playerPen.contactShadow,
      this.botPen.group,
      this.botPen.contactShadow
    );
    this.penModels.set('player', this.playerPen);
    this.penModels.set('bot', this.botPen);
    this.penTypes.set('player', this.settings.playerPenType);
    this.penTypes.set('bot', BOT_PEN_TYPE);

    this.particles = new ParticleSystem();
    this.sceneManager.scene.add(this.particles.group);

    this.trailSystem = new ShotTrailSystem();
    this.sceneManager.scene.add(this.trailSystem.group);

    this.physics = new PhysicsManager(this.settings.playerPenType, BOT_PEN_TYPE);
    this.physics.setOrientation(this.arenaOrientation);
    this.physics.resetPens();
    this.state.update({ arenaOrientation: this.arenaOrientation });
    this.abilitySystem = new AbilitySystem(
      this.physics,
      (id: PlayerId) => this.penTypes.get(id) ?? (id === 'bot' || id.startsWith('red') ? BOT_PEN_TYPE : this.settings.playerPenType),
      {
        canActivate: (id: PlayerId) => this.canActivateAbility(id),
        onActivate: (id: PlayerId) => this.onAbilityActivated(id),
        onReady: (id: PlayerId) => this.onAbilityReady(id),
      }
    );
    this.aimController = new AimController();
    this.sceneManager.scene.add(this.aimController.group);

    this.aiController = new AIController(this.physics);

    this.turnManager = new TurnManager(this.state, this.physics, {
      onCountdownTick: (val) => {
        this.audio.playCountdownTick(val === 0);
      },
      onStartPlayerTurn: (activeId: string) => {
        for (const [id, model] of this.penModels.entries()) {
          if (id === activeId) {
            const teamColor = model.team === 'red' ? 0xfb7185 : 0x60a5fa;
            model.setHighlight(0.42, teamColor);
          } else {
            model.setHighlight(0);
          }
        }
        const activeModel = this.penModels.get(activeId);
        if (activeModel) {
          this.dragController.setActivePen(activeId, activeModel);
        }
        this.applyAbilityPreview();
      },
      onStartBotTurn: () => {
        for (const [id, model] of this.penModels.entries()) {
          if (id === 'bot') {
            model.setHighlight(0.24);
          } else {
            model.setHighlight(0);
          }
        }
        this.aiController.startTurn(this.settings.difficulty, {
          onLaunch: (powerRatio: number) => {
            this.penModels.get('bot')?.setHighlight(0);
            this.audio.playRelease(powerRatio);
            this.turnManager.notifyShotLaunched('bot', powerRatio);
          },
          onSpecialShot: () => false,
          canUseSpecialShot: () => false,
        });
      },
      onPenFell: (penId: PlayerId) => {
        const pose = this.physics.getPose(penId);
        const fallSpeed = Math.hypot(pose.linvel.x, pose.linvel.y, pose.linvel.z);
        this.audio.playFall(fallSpeed);
        const pen = this.penModels.get(penId);
        const burstColor = pen?.team === 'red' ? 0xf87171 : 0x60a5fa;
        this.particles.spawnBurst(
          new THREE.Vector3(pose.pos.x, 0.1, pose.pos.z),
          16,
          burstColor,
          4.0
        );
      },
      onTurnTimeout: (timedOutId: string) => {
        this.dragController.cancelDrag();
        this.abilitySystem.disarm(timedOutId);
        this.applyAbilityPreview();
        this.audio.playTimeExpired();
      },
      onTurnTransition: (player) => {
        this.audio.playTurnSwitch();
        for (const [id, model] of this.penModels.entries()) {
          if (id === player.id) {
            const teamColor = model.team === 'red' ? 0xfb7185 : 0x60a5fa;
            model.setHighlight(0.45, teamColor);
          } else {
            model.setHighlight(0);
          }
        }
      },
      onTimerWarning: (secondsRemaining: number) => {
        if (secondsRemaining <= 5 && secondsRemaining > 0) {
          this.audio.playTimerWarning(secondsRemaining <= 3);
        }
      },
      onMatchOver: (winner: PlayerId) => {
        for (const model of this.penModels.values()) {
          model.setHighlight(0);
        }
        if (winner === 'player' || winner === 'blue') {
          this.audio.playVictory();
          this.particles.spawnConfetti(new THREE.Vector3(0, 1.8, 0));
        } else {
          this.audio.playDefeat();
        }
      },
    });

    this.dragController = new DragController(
      this.sceneManager.renderer.domElement,
      this.cameraManager.camera,
      this.physics,
      this.playerPen,
      {
        canDrag: () => {
          const snap = this.state.getSnapshot();
          return snap.matchState === 'PLAYER_TURN' && !snap.isTurnTimeoutNotice;
        },
        canAcceptShot: () => this.turnManager.canAcceptShot(),
        onGrabStart: () => {
          this.audio.unlock();
          this.audio.playGrab();
          this.turnManager.dismissTurnTransition();
          const activeId = this.turnManager.getActivePlayerId();
          const activeModel = this.penModels.get(activeId);
          if (activeModel) {
            const teamColor = activeModel.team === 'red' ? 0xfb7185 : 0x60a5fa;
            activeModel.setHighlight(0.48, teamColor);
          }
        },
        onTelemetry: (telemetry) => {
          this.state.updateDragTelemetry(telemetry);
        },
        onShotLaunch: (powerRatio) => {
          const activeId = this.turnManager.getActivePlayerId();
          this.penModels.get(activeId)?.setHighlight(0);
          this.audio.playRelease(powerRatio);
          this.turnManager.notifyShotLaunched(activeId, powerRatio);
        },
        onShotComputed: (shot: ComputedShot) => {
          this.submitOnlineShot(shot);
        },
        onDragCancel: () => {
          if (this.state.getSnapshot().matchState === 'PLAYER_TURN') {
            const activeId = this.turnManager.getActivePlayerId();
            this.penModels.get(activeId)?.setHighlight(0.32);
          }
        },
        isAbilityArmed: () => {
          const activeId = this.turnManager.getActivePlayerId();
          return this.abilitySystem.isArmed(activeId);
        },
        onAbilityLaunch: (dirX, dirZ) => {
          const activeId = this.turnManager.getActivePlayerId();
          return this.abilitySystem.activate(activeId, dirX, dirZ);
        },
      }
    );

    this.applySettings(this.settings);
    this.syncVisualTransforms();
    this.sceneManager.precompile(this.cameraManager.camera);

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        let w = 0;
        let h = 0;
        if (entry.contentBoxSize && entry.contentBoxSize.length > 0) {
          w = entry.contentBoxSize[0].inlineSize;
          h = entry.contentBoxSize[0].blockSize;
        } else if (entry.contentRect) {
          w = entry.contentRect.width;
          h = entry.contentRect.height;
        }
        if (!w || !h) {
          const rect = this.container.getBoundingClientRect();
          w = rect.width;
          h = rect.height;
        }
        w = Math.round(w);
        h = Math.round(h);
        if (w > 0 && h > 0) {
          this.applyViewportMetrics(w, h, false);
        }
      }
    });
    this.resizeObserver.observe(this.container);

    window.addEventListener('resize', this.handleViewportResize);
    window.addEventListener('orientationchange', this.handleOrientationChange);

    this.initialized = true;
    this.clock.start();
    this.tick();
  }

  private applyViewportMetrics(width: number, height: number, snapCamera: boolean): void {
    // An online match pins the desk to the host's orientation so both clients share one arena.
    const nextOrientation =
      this.orientationOverride ?? resolveArenaOrientation(width, height, this.arenaOrientation);
    if (nextOrientation !== this.arenaOrientation) {
      const angleRad = nextOrientation === 'vertical' ? Math.PI * 0.5 : -Math.PI * 0.5;
      this.dragController.cancelDrag();
      this.aiController.rotatePlannedShot(angleRad);

      this.arenaOrientation = nextOrientation;
      this.tableEnv.setOrientation(nextOrientation);
      this.physics.setOrientation(nextOrientation);
      this.cameraManager.setArenaOrientation(nextOrientation, snapCamera);

      this.syncVisualTransforms();
      this.sceneManager.requestShadowUpdate();
      this.state.update({ arenaOrientation: nextOrientation });
    }
    this.cameraManager.resize(width, height);
    this.sceneManager.resize(width, height);
  }

  private handleViewportResize = (): void => {
    if (!this.initialized || this.disposed) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.round(rect.width) || this.container.clientWidth || window.innerWidth;
    const h = Math.round(rect.height) || this.container.clientHeight || window.innerHeight;
    if (w > 0 && h > 0) {
      this.applyViewportMetrics(w, h, false);
    }
  };

  private handleOrientationChange = (): void => {
    // Settle dimensions immediately, next frame, and after mobile browser URL bar / viewport transition completes
    this.handleViewportResize();
    requestAnimationFrame(() => {
      this.handleViewportResize();
    });
    setTimeout(this.handleViewportResize, 100);
    setTimeout(this.handleViewportResize, 250);
  };

  public startMatch(multiplayerConfig?: MultiplayerMatchConfig): void {
    if (!this.initialized) return;
    this.currentMatchConfig = multiplayerConfig ?? null;
    this.audio.unlock();
    this.dragController.cancelDrag();
    this.aiController.cancel();

    // 1. Clean up old pen models
    for (const model of this.penModels.values()) {
      this.sceneManager.scene.remove(model.group);
      this.sceneManager.scene.remove(model.contactShadow);
      model.dispose();
    }
    this.penModels.clear();
    this.penTypes.clear();

    // 2. Setup new pen models
    if (multiplayerConfig && multiplayerConfig.mode !== 'VS_AI' && multiplayerConfig.mode !== 'PRACTICE') {
      for (const p of multiplayerConfig.players) {
        this.penTypes.set(p.id, p.penType);
        const model = new PenModel(
          p.id,
          this.sceneManager.maxAnisotropy,
          p.penType,
          p.team,
          p.skinId ?? 'team_default',
          p.deshiVariant ?? DEFAULT_DESHI_VARIANT
        );
        this.sceneManager.scene.add(model.group, model.contactShadow);
        this.penModels.set(p.id, model);
      }
      this.turnManager.startNewMatch(multiplayerConfig);
      this.abilitySystem.reset(multiplayerConfig.players.map((p) => p.id));
    } else {
      this.penTypes.set('player', this.settings.playerPenType);
      this.penTypes.set('bot', BOT_PEN_TYPE);

      const pModel = new PenModel(
        'player',
        this.sceneManager.maxAnisotropy,
        this.settings.playerPenType,
        'blue',
        'team_default',
        this.settings.deshiVariant
      );
      const bModel = new PenModel('bot', this.sceneManager.maxAnisotropy, BOT_PEN_TYPE, 'red');
      this.sceneManager.scene.add(pModel.group, pModel.contactShadow, bModel.group, bModel.contactShadow);
      this.penModels.set('player', pModel);
      this.penModels.set('bot', bModel);
      this.playerPen = pModel;
      this.botPen = bModel;

      this.turnManager.startNewMatch(
        multiplayerConfig,
        this.settings.playerPenType,
        BOT_PEN_TYPE
      );
      this.abilitySystem.reset(['player', 'bot']);
    }

    const firstId = this.turnManager.getActivePlayerId();
    const firstModel = this.penModels.get(firstId) ?? this.penModels.values().next().value;
    if (firstModel) {
      this.dragController.setActivePen(firstId, firstModel);
    }

    this.trailSystem.reset();
    this.aimController.setAbilityPreview(null);
    this.abilityPreviewActive = false;
    this.monitor.reset();
    this.pendingCollisions = 0;
    this.statsTimer = 0;
    this.cameraManager.setMenuMode(false);
    this.sceneManager.requestShadowUpdate();
    this.syncVisualTransforms();
  }

  public restartMatch(): void {
    if (this.currentMatchConfig) {
      this.startMatch(this.currentMatchConfig);
    } else {
      this.startMatch();
    }
  }

  // ── Online (server-authoritative) binding ──────────────────────────────────
  // The original pen physics is never touched. Online only replaces WHO decides the outcome:
  // the local loop still simulates, drags and renders, while the server supplies turn
  // ownership, eliminations and the final result. See `TurnManager.setAuthoritative`.

  public isOnlineMatch(): boolean {
    return this.onlineMatch !== null;
  }

  /** React injects the network call; the engine owns capture → submit → reconcile. */
  public setOnlineShotSubmitter(
    submit: ((shot: ShotSubmission) => Promise<ShotResult | null>) | null
  ): void {
    this.onlineShotSubmitter = submit;
  }

  /**
   * Binds the engine to an authoritative online match. Pen models and rigid bodies are built
   * through the exact same `startMatch` path the offline modes use, so the online arena runs on
   * identical physics; only turn ownership is handed to the server afterwards.
   */
  public beginOnlineMatch(record: MatchRecord, localUid: string | null): void {
    if (!this.initialized) return;
    this.lockOnlineArena(record);
    this.onlineMatch = record;
    this.onlineLocalPenId = localUid ? record.uidToPenId?.[localUid] ?? null : null;
    this.onlineLastSeq = -1;
    // The server stores the turn timer as a plain number; snap it back to a supported option.
    const turnTimerSeconds: TurnTimerOption =
      TURN_TIMER_OPTIONS.find((option) => option.value === record.turnTimerSeconds)?.value ?? 15;
    this.startMatch({
      mode: '1v1',
      players: Object.values(record.players).map((p) => ({
        id: p.penId,
        name: p.displayName,
        team: p.team,
        penType: p.penType as PenTypeId,
      })),
      turnTimerSeconds,
      startingPlayerId: record.activePlayerId,
    });
    this.turnManager.setAuthoritative(true);
    this.applyOnlineState(record);
  }

  /** Applies a fresh authoritative record: turn ownership, eliminations, result, reconciliation. */
  public applyOnlineMatchRecord(record: MatchRecord, localUid: string | null): void {
    if (!this.onlineMatch) return;
    this.onlineMatch = record;
    if (localUid && record.uidToPenId?.[localUid]) {
      this.onlineLocalPenId = record.uidToPenId[localUid];
    }
    this.applyOnlineState(record);
  }

  /** Releases the online binding and restores the default solo desk. */
  public endOnlineMatch(): void {
    this.onlineShotSubmitter = null;
    this.orientationOverride = null;
    if (this.onlineMatch) this.returnToMenu();
    this.handleViewportResize();
  }

  /**
   * Pushes the server's view into the turn manager and, whenever a new shot has been committed,
   * snaps the local rigid bodies to the authoritative snapshot. No outcome is ever decided
   * locally while online.
   */
  private applyOnlineState(record: MatchRecord): void {
    if (record.seq !== this.onlineLastSeq) {
      this.onlineLastSeq = record.seq;
      applyPenStates(this.physics, record.pens);
      this.syncVisualTransforms();
    }
    this.turnManager.applyAuthoritativeView({
      activePlayerId: record.activePlayerId,
      eliminated: Object.values(record.players)
        .filter((p) => p.eliminated)
        .map((p) => p.penId),
      status: record.status,
      winnerTeam: record.winner,
      reason: record.winReason || 'Match complete',
      localPenId: this.onlineLocalPenId,
    });
  }

  /** Forwards one locally captured shot to the server and reconciles with its verdict. */
  private submitOnlineShot(shot: ComputedShot): void {
    const record = this.onlineMatch;
    const submit = this.onlineShotSubmitter;
    if (!record || !submit) return;
    void submit({
      matchId: record.matchId,
      seq: record.seq + 1,
      localAnchor: shot.localAnchor,
      impulse: shot.impulse,
      applyPoint: shot.applyPoint,
      powerRatio: shot.powerRatio,
      spinFactor: shot.spinFactor,
      dragDistance: shot.dragDistance,
    })
      .then((result) => {
        if (result) this.applyOnlineShotResult(result);
      })
      .catch(() => {
        // The session surfaces the error; the next authoritative record reconciles the desk.
      });
  }

  private applyOnlineShotResult(result: ShotResult): void {
    if (!this.onlineMatch) return;
    applyPenStates(this.physics, result.pens);
    this.syncVisualTransforms();
    this.onlineLastSeq = Math.max(this.onlineLastSeq, result.seq);
    this.turnManager.applyAuthoritativeView({
      activePlayerId: result.activePlayerId,
      eliminated: result.eliminated,
      status: result.matchStatus,
      winnerTeam: result.winner,
      reason: result.winReason || 'Match complete',
      localPenId: this.onlineLocalPenId,
    });
  }

  /** Pins the desk to the host's arena + orientation so both clients share one arena layout. */
  private lockOnlineArena(record: MatchRecord): void {
    if (record.arenaId && isArenaId(record.arenaId)) {
      this.onlinePinnedArenaId = record.arenaId;
      if (record.arenaId !== this.settings.arenaId) {
        this.tableEnv.setArena(record.arenaId);
        this.sceneManager.setArenaAtmosphere(record.arenaId);
      }
    }
    const orientation = record.orientation;
    this.orientationOverride = orientation;
    if (this.arenaOrientation === orientation) return;
    const angleRad = orientation === 'vertical' ? Math.PI * 0.5 : -Math.PI * 0.5;
    this.dragController.cancelDrag();
    this.aiController.rotatePlannedShot(angleRad);
    this.arenaOrientation = orientation;
    this.tableEnv.setOrientation(orientation);
    this.physics.setOrientation(orientation);
    this.cameraManager.setArenaOrientation(orientation, false);
    this.syncVisualTransforms();
    this.sceneManager.requestShadowUpdate();
    this.state.update({ arenaOrientation: orientation });
  }

  public dismissTurnTransition(): void {
    if (!this.initialized) return;
    this.turnManager?.dismissTurnTransition();
  }

  /** Active Special Shots are disabled; only passive pen skills remain active. */
  public activatePlayerAbility(): boolean {
    return false;
  }

  /** Cancels any primed Special Shot without firing it. */
  public cancelPlayerAbility(): boolean {
    return false;
  }

  /** Active Special Shots are disabled; passives remain always on. */
  private canActivateAbility(_id: PlayerId): boolean {
    return false;
  }

  /** Raised the instant any pen's Special Shot actually starts — audio, particles, trail, camera. */
  private onAbilityActivated(id: PlayerId): void {
    this.audio.playAbilityActivate();
    const pose = this.physics.getPose(id);
    const shot = this.physics.getPenSpec(id)?.specialShot;
    if (!shot) return;
    const origin = new THREE.Vector3(pose.pos.x, Math.max(0.06, pose.pos.y), pose.pos.z);
    this.particles.spawnAbilityRing(
      origin,
      shot.colorHex,
      shot.physics.radialRadius > 0 ? 5.4 : 3.6
    );
    this.trailSystem.begin(id, shot.colorHex);
    if (id === this.turnManager?.getActivePlayerId() || id === 'player') {
      this.applyAbilityPreview();
    }
  }

  /** Raised the moment a pen's cooldown finishes so the HUD can chime that the shot is ready. */
  private onAbilityReady(id: PlayerId): void {
    if (id === this.turnManager?.getActivePlayerId() || id === 'player') {
      this.audio.playAbilityReady();
    }
  }

  /**
   * Points the aim overlay at the player's Special Shot physics while it is armed, and back at
   * the normal launch arc when it is not. Only called on a real arming transition so the preview
   * prediction cache is never needlessly invalidated.
   */
  private applyAbilityPreview(): void {
    if (!this.aimController) return;
    const activeId = this.turnManager?.getActivePlayerId() ?? 'player';
    const armed = this.abilitySystem.isArmed(activeId);
    if (armed === this.abilityPreviewActive) return;
    this.abilityPreviewActive = armed;
    if (!armed) {
      this.aimController.setAbilityPreview(null);
      return;
    }
    const shot = this.physics.getPenSpec(activeId)?.specialShot;
    if (!shot) return;
    const source: AbilityPreviewSource = {
      colorHex: shot.colorHex,
      durationSeconds: shot.durationSeconds,
      coastSeconds: 1.8,
      createProgram: (dirX: number, dirZ: number) =>
        this.abilitySystem.createPredictionProgram(activeId, dirX, dirZ),
    };
    this.aimController.setAbilityPreview(source);
  }

  /** SHOCKWAVE impact feedback: expanding ring + burst + a short camera kick. */
  private spawnShockwaveFeedback(id: PlayerId, point: { x: number; y: number; z: number }): void {
    const style = this.abilitySystem.getShockwaveStyle(id);
    if (!style) return;
    const origin = new THREE.Vector3(point.x, Math.max(0.06, point.y), point.z);
    this.particles.spawnAbilityRing(origin, style.colorHex, Math.max(4.2, style.radius * 2.4));
    this.particles.spawnBurst(origin, 18, style.colorHex, 4.6);
    if (this.motionEnabled) this.cameraManager.addShake(0.2);
  }

  /**
   * Replication entry point for a future multiplayer server: applies authoritative ability
   * windows / cooldowns so remote activations have identical physical consequences locally.
   */
  public applyRemoteAbilityState(state: Parameters<AbilitySystem['applyNetworkState']>[0]): void {
    if (!this.initialized) return;
    this.abilitySystem.applyNetworkState(state);
  }

  public returnToMenu(): void {
    if (!this.initialized) return;
    const wasMultiplayer = Boolean(this.turnManager?.getMultiplayerConfig());
    this.currentMatchConfig = null;

    // Leaving any match also drops a server-authority binding and restores the local arena.
    if (this.onlineMatch || this.onlinePinnedArenaId) {
      this.onlineMatch = null;
      this.onlineLocalPenId = null;
      this.onlineLastSeq = -1;
      this.orientationOverride = null;
      this.turnManager.setAuthoritative(false);
      if (this.onlinePinnedArenaId && this.onlinePinnedArenaId !== this.settings.arenaId) {
        this.tableEnv.setArena(this.settings.arenaId);
        this.sceneManager.setArenaAtmosphere(this.settings.arenaId);
        this.sceneManager.requestShadowUpdate();
      }
      this.onlinePinnedArenaId = null;
    }

    this.dragController.cancelDrag();
    this.aiController.cancel();

    if (wasMultiplayer || !this.penModels.has('player') || this.penModels.size > 2) {
      for (const model of this.penModels.values()) {
        this.sceneManager.scene.remove(model.group);
        this.sceneManager.scene.remove(model.contactShadow);
        model.dispose();
      }
      this.penModels.clear();
      this.penTypes.clear();

      this.penTypes.set('player', this.settings.playerPenType);
      this.penTypes.set('bot', BOT_PEN_TYPE);

      const pModel = new PenModel(
        'player',
        this.sceneManager.maxAnisotropy,
        this.settings.playerPenType,
        'blue',
        'team_default',
        this.settings.deshiVariant
      );
      const bModel = new PenModel('bot', this.sceneManager.maxAnisotropy, BOT_PEN_TYPE, 'red');
      this.sceneManager.scene.add(pModel.group, pModel.contactShadow, bModel.group, bModel.contactShadow);
      this.penModels.set('player', pModel);
      this.penModels.set('bot', bModel);
      this.playerPen = pModel;
      this.botPen = bModel;
      this.dragController.setActivePen('player', pModel);
    }

    this.turnManager.returnToMenu(this.settings.playerPenType, BOT_PEN_TYPE);
    this.abilitySystem.reset(['player', 'bot']);
    this.trailSystem.reset();
    this.aimController.setAbilityPreview(null);
    this.abilityPreviewActive = false;
    for (const model of this.penModels.values()) {
      model.setHighlight(0);
    }
    this.cameraManager.setMenuMode(true);
    this.sceneManager.requestShadowUpdate();
    this.syncVisualTransforms();
  }

  public applySettings(next: GameSettings): void {
    const penChanged = this.settings.playerPenType !== next.playerPenType;
    const deshiVariantChanged = this.settings.deshiVariant !== next.deshiVariant;
    const arenaChanged = this.settings.arenaId !== next.arenaId;
    const canSwitchArena = this.state.getSnapshot().matchState === 'MENU';
    const resolvedArenaId: ArenaId =
      arenaChanged && !canSwitchArena ? this.settings.arenaId : next.arenaId;
    this.settings = { ...next, arenaId: resolvedArenaId };
    this.audio.setSfxEnabled(next.sfxEnabled);
    this.audio.setMusicEnabled(next.musicEnabled);
    if (this.sceneManager && this.qualityController) {
      this.applyQualityProfile();
    }
    if (arenaChanged && canSwitchArena && this.tableEnv && this.sceneManager) {
      this.tableEnv.setArena(resolvedArenaId);
      this.sceneManager.setArenaAtmosphere(resolvedArenaId);
      this.sceneManager.requestShadowUpdate();
      if (!this.sceneManager.isSoftwareGl) {
        this.sceneManager.precompile(this.cameraManager.camera);
      }
    }
    const isMultiplayer = Boolean(this.turnManager?.getMultiplayerConfig());
    if (penChanged && this.physics && this.playerPen && !isMultiplayer) {
      this.penTypes.set('player', next.playerPenType);
      this.dragController?.cancelDrag();
      this.abilitySystem?.disarm('player');
      this.physics.setPenType('player', next.playerPenType);
      this.playerPen.setAppearance(next.playerPenType, 'blue', 'team_default', next.deshiVariant);
      // Rebuild the ability state: re-applies the new pen's passive to the freshly created rigid
      // body and clears any stale cooldown / active window carried over from the previous pen.
      this.abilitySystem?.reset(['player', 'bot']);
      this.applyAbilityPreview();
      this.state.updateAbility('player', this.abilitySystem.getState('player'));
      this.syncVisualTransforms();
      this.sceneManager.requestShadowUpdate();
      this.dragController?.emitTelemetry();
    } else if (deshiVariantChanged && this.playerPen && !isMultiplayer) {
      this.playerPen.setDeshiVariant(next.deshiVariant);
      this.sceneManager?.requestShadowUpdate();
    }
  }

  /**
   * Resolves the player's quality preference + per-feature ceilings into one concrete profile and
   * pushes it to every rendering subsystem. Called on settings changes and whenever AUTO mode
   * moves a tier, so it must stay cheap and idempotent — each subsystem diffs internally.
   */
  private applyQualityProfile(): void {
    const profile = this.qualityController.resolve(this.settings);
    this.sceneManager.applyProfile(profile);
    this.particles?.setQuality(profile.particles);
    this.trailSystem?.setQuality(profile.particles);
    this.motionEnabled = profile.motion;
    if (!profile.motion) {
      this.cameraManager?.setShotFocus(null);
    }
    this.monitor.latest.quality = this.qualityController.label(this.settings.graphicsQuality);
  }

  /**
   * Copies each pen's rigid-body transform onto its visual model. Returns the poses it read so
   * the caller can reuse them (edge warnings, camera) instead of paying for a second poll of the
   * physics world in the same frame.
   */
  private syncVisualTransforms(): { player: BodyPose; bot: BodyPose } {
    const { halfW, halfD } = this.physics.getArenaBounds();
    for (const [id, model] of this.penModels.entries()) {
      const pose = this.physics.getPose(id);
      model.syncTransform(pose.pos, pose.rot, halfW, halfD);
    }
    const playerPose = this.physics.getPose(
      this.penModels.has('player') ? 'player' : this.turnManager?.getActivePlayerId() ?? 'blue_1'
    );
    const botPose = this.physics.getPose(this.penModels.has('bot') ? 'bot' : 'red_1');
    return { player: playerPose, bot: botPose };
  }

  /**
   * Feeds the pooled Special Shot trails from each pen's writing tip while its shot is running,
   * dissolves them when it ends, and eases the camera to follow the acting pen. Pure visuals —
   * no physics state is touched here.
   */
  private updateAbilityVisuals(dt: number): void {
    let focusId: PlayerId | null = null;
    for (const id of this.penModels.keys()) {
      if (this.abilitySystem.isActive(id)) {
        const pose = this.physics.getPose(id);
        const fwd = this.physics.getForwardAxis(id);
        const spec = this.physics.getPenSpec(id);
        const halfLen = (spec?.length ?? 3.2) * 0.5;
        this.trailTip.set(
          pose.pos.x + fwd.x * halfLen,
          Math.max(0.05, pose.pos.y),
          pose.pos.z + fwd.z * halfLen
        );
        const color = this.abilitySystem.getActiveColor(id) ?? 0xffffff;
        this.trailSystem.push(id, this.trailTip.x, this.trailTip.y, this.trailTip.z, color);
        if (focusId === null) {
          focusId = id;
          this.shotFocus.set(pose.pos.x, pose.pos.y, pose.pos.z);
        }
      } else {
        this.trailSystem.end(id);
      }
    }
    this.trailSystem.update(dt);
    this.cameraManager.setShotFocus(this.motionEnabled && focusId ? this.shotFocus : null);
  }

  private tick = (frameTime?: number): void => {
    if (this.disposed) return;
    const tickStart = performance.now();
    // rAF hands us a real frame timestamp; the software-GL timeout path has none.
    const now = typeof frameTime === 'number' ? frameTime : tickStart;

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);

    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    } else {
      // Advance physics simulation (fixed-timestep accumulator lives inside PhysicsManager)
      const physicsStart = performance.now();
      this.physics.step(
        dt,
        (substepDt) => {
          this.dragController.applySubstepForce(substepDt);
          this.aiController.applySubstepForce();
          this.abilitySystem.onSubstep(substepDt);
        },
        {
          onPenPenImpact: (point, normal, speed, penA, penB) => {
            this.audio.playPenCollision(speed);
            if (penA && penB) {
              this.turnManager.recordPenContact(penA, penB, speed);
              if (this.abilitySystem.onImpact(penA, point, speed)) {
                this.spawnShockwaveFeedback(penA, point);
              }
              if (this.abilitySystem.onImpact(penB, point, speed)) {
                this.spawnShockwaveFeedback(penB, point);
              }
            } else {
              if (this.abilitySystem.onImpact('player', point, speed)) {
                this.spawnShockwaveFeedback('player', point);
              }
              if (this.abilitySystem.onImpact('bot', point, speed)) {
                this.spawnShockwaveFeedback('bot', point);
              }
            }
            // Accumulate instead of emitting a React snapshot per impact — the counter is
            // flushed at the 4 Hz diagnostics cadence, so a pile-up of collisions stays cheap.
            this.pendingCollisions += 1;
            this.particles.spawnCollisionBurst(point, normal, speed);
            if (this.motionEnabled && speed > 4.5) {
              this.cameraManager.addShake(Math.min(0.28, speed * 0.02));
              this.hitstopTimer = 0.036; // Crisp 36ms impact hitstop
            }
          },
          onPenTableImpact: (_penId, surface, point, speed) => {
            this.audio.playTableImpact(speed, surface);
            if (surface === 'table' && speed > 2.8) {
              this.particles.spawnBurst(point, 5, 0xe7d3b5, 2.2);
            }
          },
        }
      );
      this.monitor.latest.physicsMs = performance.now() - physicsStart;

      this.abilitySystem.update(dt);
      const activeId = this.turnManager?.getActivePlayerId() ?? 'player';
      if (this.abilitySystem.isArmed(activeId) && !this.abilitySystem.canActivate(activeId)) {
        this.abilitySystem.disarm(activeId);
      }
      this.applyAbilityPreview();
      this.dragController.setInputSteadying(this.abilitySystem.getSteadying(activeId));
      for (const id of this.penModels.keys()) {
        this.state.updateAbility(id, this.abilitySystem.getState(id));
      }

      this.aiController.update(dt);
      this.turnManager.update(dt);
    }

    this.updateAbilityVisuals(dt);
    // One physics poll per frame: the poses read here are reused for the edge-warning visuals.
    const poses = this.syncVisualTransforms();
    const snap = this.state.getSnapshot();
    if (snap.multiplayer) {
      const mpPens = snap.multiplayer.players
        .filter((p) => !p.isEliminated)
        .map((p) => ({
          pos: this.physics.getPose(p.id).pos,
          level: this.physics.getEdgeProximity(p.id).level,
        }));
      this.tableEnv.updateEdgeWarningPens(mpPens, now);
    } else {
      this.tableEnv.updateEdgeWarning(
        poses.player.pos,
        poses.bot.pos,
        snap.edgeWarning.player,
        snap.edgeWarning.bot,
        now
      );
    }

    const dragView = this.dragController.getStateView();
    if (snap.matchState === 'PLAYER_TURN' && !dragView.isDragging) {
      const activeId = this.turnManager.getActivePlayerId();
      const activeModel = this.penModels.get(activeId);
      if (activeModel) {
        const pulse = 0.28 + 0.2 * (0.5 + 0.5 * Math.sin(now * 0.0065));
        const teamColor = activeModel.team === 'red' ? 0xfb7185 : 0x60a5fa;
        activeModel.setHighlight(pulse, teamColor);
      }
    }
    this.aimController.update(dragView);
    if (dragView.isDragging) {
      this.telemetryTimer += dt;
      if (this.telemetryTimer >= 0.045) {
        this.telemetryTimer = 0;
        this.dragController.emitTelemetry();
      }
    } else {
      this.telemetryTimer = 0;
    }
    this.particles.update(dt);
    this.cameraManager.update(dt);

    // On-demand dynamic shadows: request shadow map pass only when objects are moving or active
    const dragActive = dragView.isDragging;
    const pensSettled = this.physics ? this.physics.arePensSettled(0.03, 0.06) : true;
    if (dragActive || !pensSettled || this.hitstopTimer > 0) {
      this.sceneManager.requestShadowUpdate();
    }

    this.sceneManager.render(this.cameraManager.camera);

    // ---- Performance telemetry & adaptive quality (never re-renders React per frame) --------
    const renderStats = this.sceneManager.getRenderStats();
    this.monitor.latest.drawCalls = renderStats.calls;
    this.monitor.latest.triangles = renderStats.triangles;
    const res = this.sceneManager.getRenderResolution();
    this.monitor.latest.resolution = `${res.width}x${res.height} (${Math.round(res.scale * 100)}%)`;
    this.monitor.latest.cpuMs = performance.now() - tickStart;

    this.statsTimer += rawDt;
    if (this.statsTimer >= 0.25) {
      this.statsTimer = 0;
      // Rigid-body / collider counts are polled at the panel's own cadence, not per frame.
      const physStats = this.physics.getStats();
      this.monitor.latest.bodies = physStats.bodies;
      this.monitor.latest.colliders = physStats.colliders;
      this.monitor.latest.awakeBodies = physStats.awakeBodies;
      if (this.pendingCollisions > 0) {
        const prev = this.state.getSnapshot().stats;
        this.state.update({
          stats: { ...prev, collisions: prev.collisions + this.pendingCollisions },
        });
        this.pendingCollisions = 0;
      }
    }

    // Publishing happens inside frame(); the stats above are therefore sampled with this frame.
    this.monitor.frame(now);

    if (this.monitor.hasSamples) {
      const changed = this.qualityController.updateAdvanced(
        dt,
        this.monitor.latest.avgFps,
        this.monitor.latest.frameMs,
        this.monitor.latest.physicsMs,
        this.settings.graphicsQuality === 'AUTO'
      );
      if (changed) {
        this.applyQualityProfile();
      }
    }

    if (this.sceneManager.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  /**
   * Software-GL path: wait for the GPU to actually finish the frame before queueing the next one.
   * Keeps CPU work off the software rasteriser's back instead of stacking frames it cannot clear.
   */
  private afterDraw(cb: (frameTime?: number) => void): void {
    if (this.suspended) return;
    const gl = this.sceneManager.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || !gl.fenceSync) {
      this.timeoutId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed || this.suspended) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
      if (state === gl.UNSIGNALED) {
        this.timeoutId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.timeoutId = window.setTimeout(cb, 80);
      }
    };
    this.timeoutId = window.setTimeout(poll, 5);
  }

  /**
   * Halts the render/physics loop while a full-screen overlay (settings, help, pen selector) hides
   * the arena. The GPU and CPU are fully released, and the wall-clock gap is discarded on resume so
   * the first frame back is not treated as an enormous delta.
   */
  public setSuspended(suspended: boolean): void {
    if (!this.initialized || this.disposed || suspended === this.suspended) return;
    this.suspended = suspended;
    this.turnManager?.setPaused(suspended);
    if (suspended) {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = 0;
      }
      this.monitor.latest.physicsMs = 0;
      return;
    }
    this.clock.getDelta(); // discard the paused gap
    this.tick();
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.handleViewportResize);
    window.removeEventListener('orientationchange', this.handleOrientationChange);

    if (this.initialized) {
      this.dragController.dispose();
      this.aimController.dispose();
      this.tableEnv.dispose();
      for (const model of this.penModels.values()) {
        model.dispose();
      }
      this.penModels.clear();
      this.particles.dispose();
      this.trailSystem.dispose();
      this.physics.dispose();
      this.sceneManager.dispose();
    }
    this.audio.dispose();
  }
}
