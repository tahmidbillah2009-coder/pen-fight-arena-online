import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { DragStateView } from './DragController';
import type { PhysicsManager } from './PhysicsManager';

/** The per-step program `PhysicsManager.predictAbilityTrajectory` replays for a Special Shot. */
export type AbilityProgramApply = Parameters<
  PhysicsManager['predictAbilityTrajectory']
>[0]['apply'];

/**
 * Special Shot visual metadata passed into the aim overlay while a Special Shot is armed.
 */
export interface AbilityPreviewSource {
  colorHex: number;
  durationSeconds: number;
  coastSeconds: number;
  createProgram: (dirX: number, dirZ: number) => AbilityProgramApply;
}

export class AimController {
  public readonly group = new THREE.Group();

  // Grab anchor reticle
  private readonly grabGroup = new THREE.Group();
  private readonly grabRing: THREE.Mesh;
  private readonly grabPin: THREE.Mesh;
  private readonly grabMat: THREE.MeshBasicMaterial;

  // Pull tension tether
  private readonly pullLine: THREE.Line;
  private readonly pullLineGeo: THREE.BufferGeometry;
  private readonly pullLineMat: THREE.LineBasicMaterial;

  // Sleek direction arrow
  private readonly arrowShaft: THREE.Mesh;
  private readonly arrowHead: THREE.Mesh;
  private readonly arrowMat: THREE.MeshBasicMaterial;

  private readonly disposables: Array<{ dispose: () => void }> = [];

  private abilityPreview: AbilityPreviewSource | null = null;

  private readonly _colorZoneLow = new THREE.Color(0x0284c7);
  private readonly _colorZoneMed = new THREE.Color(0x059669);
  private readonly _colorZoneHigh = new THREE.Color(0xd97706);
  private readonly _colorZoneMax = new THREE.Color(0xdc2626);
  private readonly _activeColor = new THREE.Color();

  constructor() {
    this.group.visible = false;

    // 1. Grab-point tactical anchor crosshair
    this.grabMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const grabDarkMat = new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const grabBackGeo = new THREE.RingGeometry(0.15, 0.27, 28);
    grabBackGeo.rotateX(-Math.PI * 0.5);
    const grabBack = new THREE.Mesh(grabBackGeo, grabDarkMat);
    grabBack.position.y = -0.002;

    const ringGeo = new THREE.RingGeometry(0.17, 0.22, 28);
    ringGeo.rotateX(-Math.PI * 0.5);
    this.grabRing = new THREE.Mesh(ringGeo, this.grabMat);

    const grabTickGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const g = new THREE.PlaneGeometry(0.038, 0.11);
      g.rotateX(-Math.PI * 0.5);
      const angle = (i * Math.PI) / 2;
      const dist = 0.27;
      g.rotateY(angle);
      g.translate(Math.sin(angle) * dist, 0.001, Math.cos(angle) * dist);
      grabTickGeos.push(g);
    }
    const mergedGrabTickGeo = BufferGeometryUtils.mergeGeometries(grabTickGeos, false) ?? grabTickGeos[0];
    for (const g of grabTickGeos) if (g !== mergedGrabTickGeo) g.dispose();
    const grabTicksMesh = new THREE.Mesh(mergedGrabTickGeo, this.grabMat);
    this.grabGroup.add(grabTicksMesh);

    const pinGeo = new THREE.SphereGeometry(0.068, 12, 12);
    const pinMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    this.grabPin = new THREE.Mesh(pinGeo, pinMat);

    this.grabGroup.add(grabBack, this.grabRing);
    this.group.add(this.grabGroup, this.grabPin);
    this.disposables.push(
      grabBackGeo,
      ringGeo,
      mergedGrabTickGeo,
      pinGeo,
      this.grabMat,
      grabDarkMat,
      pinMat
    );

    // 2. Pull displacement tether line
    this.pullLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    this.pullLineMat = new THREE.LineBasicMaterial({
      color: 0x475569,
      transparent: true,
      opacity: 0.85,
    });
    this.pullLine = new THREE.Line(this.pullLineGeo, this.pullLineMat);
    this.group.add(this.pullLine);
    this.disposables.push(this.pullLineGeo, this.pullLineMat);

    // 3. Sleek launch direction arrow (shaft + sharp chevron head)
    this.arrowMat = new THREE.MeshBasicMaterial({
      color: 0x059669,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const shaftGeo = new THREE.PlaneGeometry(0.095, 1.0);
    shaftGeo.rotateX(-Math.PI * 0.5);
    shaftGeo.translate(0, 0, 0.5);
    this.arrowShaft = new THREE.Mesh(shaftGeo, this.arrowMat);

    const headShape = new THREE.Shape();
    headShape.moveTo(0, 0.34);
    headShape.lineTo(-0.22, -0.04);
    headShape.lineTo(0, 0.06);
    headShape.lineTo(0.22, -0.04);
    headShape.closePath();
    const headGeo = new THREE.ShapeGeometry(headShape);
    headGeo.rotateX(Math.PI * 0.5);
    this.arrowHead = new THREE.Mesh(headGeo, this.arrowMat);

    this.group.add(this.arrowShaft, this.arrowHead);
    this.disposables.push(shaftGeo, headGeo, this.arrowMat);
  }

  public setAbilityPreview(source: AbilityPreviewSource | null): void {
    this.abilityPreview = source;
  }

  public update(drag: DragStateView): void {
    if (!drag.isDragging) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    const now = performance.now();

    // Highlighted grab crosshair locked onto the pen's live world anchor
    this.grabGroup.position.set(
      drag.worldAnchor.x,
      Math.max(0.035, drag.worldAnchor.y - 0.075),
      drag.worldAnchor.z
    );
    this.grabGroup.rotation.y = now * 0.0009;
    this.grabPin.position.set(drag.worldAnchor.x, drag.worldAnchor.y + 0.145, drag.worldAnchor.z);

    // Dynamic pull tension tether from grabbed anchor to pointer world target
    const posAttr = this.pullLineGeo.getAttribute('position') as THREE.BufferAttribute;
    posAttr.setXYZ(0, drag.worldAnchor.x, 0.055, drag.worldAnchor.z);
    posAttr.setXYZ(1, drag.pointerWorldPos.x, 0.055, drag.pointerWorldPos.z);
    posAttr.needsUpdate = true;

    if (!drag.canLaunch) {
      this.arrowShaft.visible = false;
      this.arrowHead.visible = false;
      return;
    }

    // 4-zone power color mapping: Low (0-30%), Medium (31-60%), High (61-85%), Maximum (86-100%).
    if (this.abilityPreview) {
      this._activeColor.setHex(this.abilityPreview.colorHex);
    } else if (drag.powerZone === 'LOW') {
      this._activeColor.copy(this._colorZoneLow);
    } else if (drag.powerZone === 'MEDIUM') {
      this._activeColor.copy(this._colorZoneMed);
    } else if (drag.powerZone === 'HIGH') {
      this._activeColor.copy(this._colorZoneHigh);
    } else {
      this._activeColor.copy(this._colorZoneMax);
    }
    this.arrowMat.color.copy(this._activeColor);
    this.pullLineMat.color.copy(this._activeColor);

    // Sleek launch direction arrow from grabbed point
    const arrowLen = 0.65 + drag.powerRatio * 1.95;
    const yaw = Math.atan2(drag.launchDir.x, drag.launchDir.z);

    this.arrowShaft.visible = true;
    this.arrowShaft.position.set(drag.worldAnchor.x, 0.048, drag.worldAnchor.z);
    this.arrowShaft.rotation.y = yaw;
    this.arrowShaft.scale.set(1, 1, arrowLen);

    this.arrowHead.visible = true;
    this.arrowHead.position.set(
      drag.worldAnchor.x + drag.launchDir.x * arrowLen,
      0.049,
      drag.worldAnchor.z + drag.launchDir.z * arrowLen
    );
    this.arrowHead.rotation.y = yaw;
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
