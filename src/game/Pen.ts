import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BOT_ACCENT_HEX,
  BOT_COLOR_HEX,
  DEFAULT_DESHI_VARIANT,
  DeshiColorVariantId,
  getDeshiColorVariantSpec,
  PEN_SPECS,
  PenPhysicsSpec,
  PenTypeId,
  TABLE_HALF_D,
  TABLE_HALF_W,
} from '../utils/Constants';
import { getPenSkinSpec, PenSkinId } from './MultiplayerTypes';
import { PlayerId } from './GameState';

const _zAxisTmp = new THREE.Vector3();

// Shared procedural contact shadow texture & geometry across all PenModel instances
// Minimizes GPU memory and draw state overhead on Intel HD 4600 / integrated graphics.
let _sharedPenShadowTexture: THREE.CanvasTexture | null = null;
let _sharedPenShadowGeometry: THREE.BufferGeometry | null = null;
let _sharedTextureUsers = 0;

/**
 * Creates a physically-accurate, soft contact shadow texture for a cylindrical pen.
 *
 * Characteristics:
 * - A dark, defined contact seam along the central longitudinal axis where the cylinder touches the desk.
 * - A smooth monotonic falloff across the pen radius representing ambient occlusion under the curved barrel.
 * - A gentle diffused outer penumbra extending softly beyond the pen silhouette.
 * - Perfectly rounded capsule ends at the nib and rear cap.
 * - Warm dark umber tone that naturally blends with the wooden tabletop without gray/blue tinting.
 */
function getSharedPenShadowTexture(): THREE.CanvasTexture {
  if (_sharedPenShadowTexture) return _sharedPenShadowTexture;

  const w = 128;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const imgData = ctx.createImageData(w, h);
  const data = imgData.data;

  // Calibrated capsule dimensions:
  // rCore: tight dark contact seam right where cylinder touches the desk
  // rBody: cylinder radius boundary in texture space
  // rOuter: soft outer ambient penumbra
  // halfSeg: half-length of uniform cylinder barrel
  const rCore = 6;
  const rBody = 22;
  const rOuter = 42;
  const halfSeg = 210;

  for (let y = 0; y < h; y++) {
    const dy = Math.max(0, Math.abs(y - 256) - halfSeg);
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - 64);
      const dist = Math.sqrt(dx * dx + dy * dy);

      let alpha = 0;
      if (dist <= rCore) {
        // Tight, defined contact seam: dark and anchored
        const t = dist / rCore;
        alpha = 0.88 * (1 - t) + 0.68 * t;
      } else if (dist <= rBody) {
        // Occlusion gradient underneath the curved cylinder barrel
        const t = (dist - rCore) / (rBody - rCore);
        const smooth = t * t * (3 - 2 * t);
        alpha = 0.68 * (1 - smooth) + 0.28 * smooth;
      } else if (dist <= rOuter) {
        // Soft diffused penumbra falling off gently to 0
        const t = (dist - rBody) / (rOuter - rBody);
        alpha = 0.28 * Math.pow(1 - t, 2.2);
      }

      if (alpha > 0) {
        const idx = (y * w + x) * 4;
        // Warm dark umber/walnut occlusion tone matching classroom wooden desk
        data[idx] = 16;
        data[idx + 1] = 11;
        data[idx + 2] = 7;
        data[idx + 3] = Math.round(alpha * 255);
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  _sharedPenShadowTexture = tex;
  return tex;
}

function getSharedPenShadowGeometry(): THREE.BufferGeometry {
  if (_sharedPenShadowGeometry) return _sharedPenShadowGeometry;

  // PlaneGeometry(1, 1):
  // rotateX(-PI/2) and rotateY(PI) so that normal is +Y (up on tabletop)
  // and local length is along +Z (matching the pen's forward direction).
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI * 0.5);
  geo.rotateY(Math.PI);
  _sharedPenShadowGeometry = geo;
  return geo;
}

export class PenModel {
  public readonly id: PlayerId;
  public readonly group = new THREE.Group();
  public raycastProxy!: THREE.Mesh;
  public readonly contactShadow: THREE.Mesh;
  public visualMeshes: THREE.Object3D[] = [];
  public penType: PenTypeId;
  public team: 'blue' | 'red';
  public skinId: PenSkinId;
  public deshiVariant: DeshiColorVariantId;

  /**
   * Removable rear cap, kept as its own sub-group so a future removal feature can detach,
   * reattach or animate it independently without rebuilding the rest of the pen.
   */
  public readonly capGroup = new THREE.Group();
  private capAttached = true;

  private readonly maxAnisotropy: number;
  private highlightGlow!: THREE.Mesh;
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private readonly shadowDisposables: Array<{ dispose: () => void }> = [];
  private currentRestY = PEN_SPECS.GRIP_MASTER.radius + 0.005;
  private baseShadowWidth = 0.5;
  private baseShadowLength = 3.5;

  constructor(
    id: PlayerId,
    maxAnisotropy: number,
    penType: PenTypeId = 'GRIP_MASTER',
    team: 'blue' | 'red' = (id === 'bot' || id.startsWith('red') ? 'red' : 'blue'),
    skinId: PenSkinId = 'team_default',
    deshiVariant: DeshiColorVariantId = DEFAULT_DESHI_VARIANT
  ) {
    this.id = id;
    this.maxAnisotropy = maxAnisotropy;
    this.penType = penType;
    this.team = team;
    this.skinId = skinId;
    this.deshiVariant = deshiVariant;

    // Contact shadow plane positioned directly beneath pen on the tabletop
    _sharedTextureUsers++;
    const shadowTex = getSharedPenShadowTexture();
    const shadowGeo = getSharedPenShadowGeometry();
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      toneMapped: false,
    });
    this.contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.contactShadow.renderOrder = 1;
    this.shadowDisposables.push(shadowMat);

    this.buildGeometry(penType);
  }

  public setPenType(penType: PenTypeId): void {
    if (this.penType === penType) return;
    this.penType = penType;
    this.clearModelParts();
    this.buildGeometry(penType);
  }

  public setDeshiVariant(deshiVariant: DeshiColorVariantId): void {
    if (this.deshiVariant === deshiVariant) return;
    this.deshiVariant = deshiVariant;
    if (this.penType === 'DESHI_PEN') {
      this.clearModelParts();
      this.buildGeometry(this.penType);
    }
  }

  public setAppearance(
    penType: PenTypeId,
    team: 'blue' | 'red',
    skinId: PenSkinId,
    deshiVariant: DeshiColorVariantId = this.deshiVariant
  ): void {
    if (
      this.penType === penType &&
      this.team === team &&
      this.skinId === skinId &&
      this.deshiVariant === deshiVariant
    ) {
      return;
    }
    this.penType = penType;
    this.team = team;
    this.skinId = skinId;
    this.deshiVariant = deshiVariant;
    this.clearModelParts();
    this.buildGeometry(penType);
  }

  private clearModelParts(): void {
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }
    while (this.capGroup.children.length > 0) {
      this.capGroup.remove(this.capGroup.children[0]);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
    this.visualMeshes = [];
  }

  private buildGeometry(penType: PenTypeId): void {
    const isBlueTeam = this.team === 'blue';
    const spec = PEN_SPECS[penType];
    const style = spec.visualStyle;
    const lenScale = spec.length / 3.2;
    const radius = spec.radius;
    const halfLen = spec.length * 0.5;
    this.currentRestY =
      Math.max(
        radius,
        radius * spec.cap.radiusScale,
        spec.frontCap ? radius * spec.frontCap.radiusScale : 0
      ) + 0.005;

    // Calibrate contact shadow scale based on pen dimensions & procedural texture fractions:
    // Barrel section in texture is 210 * 2 / 512 = 0.8203125
    // Cylinder body diameter in texture is 22 * 2 / 128 = 0.34375
    const bodyFraction = (210 * 2) / 512;
    const widthFraction = (22 * 2) / 128;
    const shadowBarrelLen = Math.max(0.1, spec.length - radius * 2);
    this.baseShadowLength = shadowBarrelLen / bodyFraction;
    this.baseShadowWidth = (radius * 2) / widthFraction;
    this.contactShadow.scale.set(this.baseShadowWidth, 1, this.baseShadowLength);

    if (style === 'DESHI_CLASSIC') {
      this.buildDeshiPenGeometry(spec, isBlueTeam);
      return;
    }

    const skinSpec = getPenSkinSpec(this.skinId);
    const hasCustomSkin = skinSpec.id !== 'team_default' && skinSpec.primaryColorHex !== undefined;
    const primaryColor = hasCustomSkin
      ? skinSpec.primaryColorHex!
      : isBlueTeam
        ? spec.primaryColorHex
        : BOT_COLOR_HEX;
    const accentColor = hasCustomSkin
      ? (skinSpec.accentColorHex ?? (isBlueTeam ? spec.accentColorHex : BOT_ACCENT_HEX))
      : isBlueTeam
        ? spec.accentColorHex
        : BOT_ACCENT_HEX;
    const gripColor = hasCustomSkin
      ? (skinSpec.gripColorHex ?? 0x181a20)
      : isBlueTeam
        ? spec.gripColorHex
        : 0x181a20;

    // 1. Barrel texture with subtle racing stripe & precision team-identity band
    const teamStripeHex = isBlueTeam ? 0x38bdf8 : 0xf43f5e;
    const barrelTex = this.createBarrelTexture(
      primaryColor,
      accentColor,
      teamStripeHex,
      hasCustomSkin,
      this.maxAnisotropy
    );
    const barrelMat = new THREE.MeshStandardMaterial({
      map: barrelTex,
      roughness: spec.roughness,
      metalness: spec.metalness,
    });

    const gripMat = new THREE.MeshStandardMaterial({
      color: gripColor,
      roughness: 0.88,
      metalness: 0.02,
    });

    const metalMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      roughness: 0.2,
      metalness: 0.92,
    });

    const nibMat = new THREE.MeshStandardMaterial({
      color: isBlueTeam ? spec.nibColorHex : 0x94a3b8,
      roughness: 0.14,
      metalness: 0.95,
    });

    const darkInkMat = new THREE.MeshStandardMaterial({
      color: 0x090b10,
      roughness: 0.25,
      metalness: 0.4,
    });

    this.disposables.push(barrelTex, barrelMat, gripMat, metalMat, nibMat, darkInkMat);

    // Note: Cylinders in Three.js are Y-aligned; rotateX(Math.PI / 2) aligns +Y -> +Z (front tip).
    // 1) Main barrel
    const barrelLen = 1.65 * lenScale;
    const barrelGeo = new THREE.CylinderGeometry(radius, radius, barrelLen, 16);
    barrelGeo.rotateX(Math.PI * 0.5);
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.z = -0.35 * lenScale;
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    this.group.add(barrel);
    this.visualMeshes.push(barrel);
    this.disposables.push(barrelGeo);

    // 2) Ergonomic ribbed rubber grip sleeve (per-style bulk)
    const gripLen = (style === 'SLIM_LIGHT' ? 0.5 : style === 'HEAVY_BRASS' ? 0.74 : 0.68) * lenScale;
    const gripGeo = new THREE.CylinderGeometry(radius * 1.04, radius * 1.02, gripLen, 16);
    gripGeo.rotateX(Math.PI * 0.5);
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.z = 0.78 * lenScale;
    grip.castShadow = true;
    grip.receiveShadow = true;
    this.group.add(grip);
    this.visualMeshes.push(grip);
    this.disposables.push(gripGeo);

    // Collect ALL main-body metal components to merge into 1 draw call:
    // (tactile rings, center collar, nose cone, nib, clip, and style accents)
    const metalGeos: THREE.BufferGeometry[] = [];

    // 3) Grip tactile rings
    const ringCount =
      style === 'SPIN_RIDGED' ? 7 : style === 'ARMORED' ? 6 : style === 'SLIM_LIGHT' ? 3 : 5;
    const ringStart = -(ringCount - 1) / 2;
    for (let i = 0; i < ringCount; i++) {
      const ringG = new THREE.TorusGeometry(radius * 1.03, 0.013, 6, 16);
      ringG.translate(0, 0, (0.78 + (ringStart + i) * 0.1) * lenScale);
      metalGeos.push(ringG);
    }

    // 4) Center chrome/brass/gunmetal collar ring
    const collarGeo = new THREE.CylinderGeometry(radius * 1.07, radius * 1.07, 0.1 * lenScale, 16);
    collarGeo.rotateX(Math.PI * 0.5);
    collarGeo.translate(0, 0, 0.42 * lenScale);
    metalGeos.push(collarGeo);

    // 4b) Style-specific silhouette details
    this.addStyleDetails(style, spec, metalGeos, gripMat, radius, lenScale);

    // 5) Tapered metallic nose cone via LatheGeometry
    const lathePts = [
      new THREE.Vector2(radius * 1.01, 0),
      new THREE.Vector2(radius * 0.88, 0.12 * lenScale),
      new THREE.Vector2(radius * 0.48, 0.34 * lenScale),
      new THREE.Vector2(radius * 0.22, 0.46 * lenScale),
      new THREE.Vector2(0.015, 0.48 * lenScale),
    ];
    const coneGeo = new THREE.LatheGeometry(lathePts, 16);
    coneGeo.rotateX(Math.PI * 0.5);
    coneGeo.translate(0, 0, 1.11 * lenScale);
    metalGeos.push(coneGeo);

    // 6) Precision ballpoint nib & ink sphere at +Z tip
    const nibGeo = new THREE.ConeGeometry(0.032, 0.11, 10);
    nibGeo.rotateX(Math.PI * 0.5);
    nibGeo.translate(0, 0, halfLen - 0.02);
    metalGeos.push(nibGeo);

    // 7) Beveled Pocket Clip (ExtrudeGeometry)
    const capRadiusVis = radius * spec.cap.radiusScale;
    const clipLen = (style === 'HEAVY_BRASS' || style === 'ARMORED' ? 0.6 : 0.88) * lenScale;
    const clipShape = new THREE.Shape();
    clipShape.moveTo(0, 0);
    clipShape.lineTo(clipLen, 0);
    clipShape.lineTo(clipLen * 1.09, 0.04);
    clipShape.lineTo(clipLen * 1.045, 0.08);
    clipShape.lineTo(clipLen * 0.068, 0.07);
    clipShape.lineTo(0, 0.04);
    clipShape.closePath();

    const clipGeo = new THREE.ExtrudeGeometry(clipShape, {
      depth: 0.07,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.01,
      bevelSegments: 1,
    });
    clipGeo.rotateY(-Math.PI * 0.5);
    clipGeo.translate(0.035, capRadiusVis * 0.86, -1.25 * lenScale);
    metalGeos.push(clipGeo);

    // Merge all main body metal parts into 1 single draw call!
    // Note: ExtrudeGeometry (clip) is non-indexed, while Torus/Cylinder/Lathe are indexed.
    // mergeVertices() indexes unindexed geometries so mergeGeometries succeeds seamlessly!
    const sanitizedMetalGeos = metalGeos.map((g) => (g.index ? g : BufferGeometryUtils.mergeVertices(g)));
    const mergedMetalGeo = BufferGeometryUtils.mergeGeometries(sanitizedMetalGeos, false) ?? metalGeos[0];
    for (const g of metalGeos) {
      if (g !== mergedMetalGeo) g.dispose();
    }
    for (const g of sanitizedMetalGeos) {
      if (g !== mergedMetalGeo && !metalGeos.includes(g)) g.dispose();
    }
    const metalMesh = new THREE.Mesh(mergedMetalGeo, metalMat);
    metalMesh.castShadow = true;
    metalMesh.receiveShadow = true;
    this.group.add(metalMesh);
    this.visualMeshes.push(metalMesh);
    this.disposables.push(mergedMetalGeo);

    // Ballpoint ink sphere
    const ballGeo = new THREE.SphereGeometry(0.016, 8, 8);
    const ball = new THREE.Mesh(ballGeo, darkInkMat);
    ball.position.z = halfLen + 0.028;
    this.group.add(ball);
    this.visualMeshes.push(ball);
    this.disposables.push(ballGeo);

    // 8) Removable rear cap
    const capLen = spec.length * spec.cap.lengthRatio;
    const capCenterZ = spec.length * spec.cap.centerZRatio;

    const capBodyMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      roughness: spec.roughness + 0.04,
      metalness: spec.metalness,
      side: THREE.DoubleSide,
    });
    this.disposables.push(capBodyMat);

    const capProfile = [
      new THREE.Vector2(capRadiusVis * 0.97, 0),
      new THREE.Vector2(capRadiusVis, capLen * 0.06),
      new THREE.Vector2(capRadiusVis, capLen * 0.68),
      new THREE.Vector2(capRadiusVis * 0.985, capLen * 0.78),
      new THREE.Vector2(capRadiusVis * 0.9, capLen * 0.87),
      new THREE.Vector2(capRadiusVis * 0.66, capLen * 0.94),
      new THREE.Vector2(capRadiusVis * 0.34, capLen * 0.985),
      new THREE.Vector2(0.0, capLen),
    ];
    const capShellGeo = new THREE.LatheGeometry(capProfile, 18);
    capShellGeo.rotateX(-Math.PI * 0.5);
    capShellGeo.translate(0, 0, capCenterZ + capLen * 0.5);
    const capShell = new THREE.Mesh(capShellGeo, capBodyMat);
    capShell.castShadow = true;
    capShell.receiveShadow = true;
    this.capGroup.add(capShell);
    this.disposables.push(capShellGeo);

    const capRimGeo = new THREE.CylinderGeometry(
      capRadiusVis * 1.012,
      capRadiusVis * 1.012,
      0.05 * lenScale,
      18,
      1,
      true
    );
    capRimGeo.rotateX(Math.PI * 0.5);
    const capRim = new THREE.Mesh(capRimGeo, metalMat);
    capRim.position.z = capCenterZ + capLen * 0.5 - 0.018 * lenScale;
    capRim.castShadow = true;
    this.capGroup.add(capRim);
    this.disposables.push(capRimGeo);

    this.capGroup.visible = this.capAttached;
    this.group.add(this.capGroup);
    this.visualMeshes.push(capShell, capRim);

    // 9) Active-turn aura ring under/around pen
    const glowGeo = new THREE.CylinderGeometry(radius * 1.48, radius * 1.48, spec.length * 0.96, 16);
    glowGeo.rotateX(Math.PI * 0.5);
    const glowMat = new THREE.MeshBasicMaterial({
      color: isBlueTeam ? 0x38bdf8 : 0xf43f5e,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.highlightGlow = new THREE.Mesh(glowGeo, glowMat);
    this.group.add(this.highlightGlow);
    this.disposables.push(glowGeo, glowMat);

    // 10) Invisible cylindrical proxy mesh for raycasting
    const proxyGeo = new THREE.CylinderGeometry(radius * 2.6, radius * 2.6, spec.length + 0.42, 12);
    proxyGeo.rotateX(Math.PI * 0.5);
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    this.raycastProxy = new THREE.Mesh(proxyGeo, proxyMat);
    this.raycastProxy.userData.penId = this.id;
    this.group.add(this.raycastProxy);
    this.disposables.push(proxyGeo, proxyMat);
  }

  /**
   * Builds the multi-part collectible Deshi Pen model:
   * - Slim smooth glossy cylindrical plastic barrel
   * - Distinctive rear-end cap (mounted in `capGroup` so it behaves with the rear collider)
   * - Metal-colored nib assembly (ferrule collar, tapered metal cone, fine tip & tungsten ball)
   * - Internal cap details (colored locking ring, frosted inner nib-seal cup, internal ribs)
   * - Realistic transparent curved protective front cap & pocket clip
   */
  private buildDeshiPenGeometry(spec: PenPhysicsSpec, isBlueTeam: boolean): void {
    const variant = getDeshiColorVariantSpec(this.deshiVariant);
    const radius = spec.radius;
    const halfLen = spec.length * 0.5; // 1.71
    const rearCapLen = spec.length * spec.cap.lengthRatio; // ~0.445
    const rearCapRadius = radius * spec.cap.radiusScale; // ~0.134
    const rearJoinZ = -halfLen + rearCapLen; // ~-1.265
    const neckStartZ = 0.59;
    const neckEndZ = 0.87;

    // 1. Glossy injection-molded plastic materials (zero text or branding)
    const barrelMat = new THREE.MeshPhysicalMaterial({
      color: variant.bodyColorHex,
      roughness: 0.14,
      metalness: 0.02,
      clearcoat: 0.96,
      clearcoatRoughness: 0.05,
      reflectivity: 0.85,
      envMapIntensity: 1.25,
    });

    const rearCapMat = new THREE.MeshPhysicalMaterial({
      color: variant.bodyColorHex,
      roughness: 0.16,
      metalness: 0.02,
      clearcoat: 0.92,
      clearcoatRoughness: 0.06,
      reflectivity: 0.8,
      envMapIntensity: 1.2,
      side: THREE.DoubleSide,
    });

    const seamMat = new THREE.MeshStandardMaterial({
      color: variant.innerSleeveHex,
      roughness: 0.34,
      metalness: 0.06,
    });

    const nibMetalMat = new THREE.MeshStandardMaterial({
      color: spec.nibColorHex,
      roughness: 0.16,
      metalness: 0.94,
      envMapIntensity: 1.35,
    });

    const tungstenBallMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.15,
      metalness: 0.85,
    });

    const inkCoreMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.35,
      metalness: 0.1,
    });

    const innerCapAccentMat = new THREE.MeshPhysicalMaterial({
      color: variant.capAccentHex,
      roughness: 0.22,
      metalness: 0.04,
      clearcoat: 0.6,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    });

    const innerSealCupMat = new THREE.MeshPhysicalMaterial({
      color: variant.innerSleeveHex,
      roughness: 0.3,
      metalness: 0.02,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const innerRibMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.24,
      metalness: 0.04,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });

    const clearCapMat = new THREE.MeshPhysicalMaterial({
      color: 0xf8fafc,
      roughness: 0.06,
      metalness: 0.0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      ior: 1.49,
      reflectivity: 0.95,
      envMapIntensity: 1.55,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.disposables.push(
      barrelMat,
      rearCapMat,
      seamMat,
      nibMetalMat,
      tungstenBallMat,
      inkCoreMat,
      innerCapAccentMat,
      innerSealCupMat,
      innerRibMat,
      clearCapMat
    );

    // 2. Slim, smooth glossy plastic barrel with snap-ridge and tapered front shoulder
    const barrelPts = [
      new THREE.Vector2(radius * 0.86, rearJoinZ),
      new THREE.Vector2(radius * 0.99, rearJoinZ + 0.02),
      new THREE.Vector2(radius, rearJoinZ + 0.06),
      new THREE.Vector2(radius, neckStartZ - 0.02),
      // Subtle molded cap-snap ring & groove where the protective cap clicks shut
      new THREE.Vector2(radius * 1.035, neckStartZ),
      new THREE.Vector2(radius * 0.96, neckStartZ + 0.03),
      new THREE.Vector2(radius * 0.95, neckStartZ + 0.06),
      new THREE.Vector2(radius * 0.86, neckEndZ - 0.08),
      new THREE.Vector2(radius * 0.66, neckEndZ),
      new THREE.Vector2(radius * 0.42, neckEndZ),
    ];
    const barrelGeo = new THREE.LatheGeometry(barrelPts, 24);
    barrelGeo.rotateX(Math.PI * 0.5);
    const barrelMesh = new THREE.Mesh(barrelGeo, barrelMat);
    barrelMesh.castShadow = true;
    barrelMesh.receiveShadow = true;
    this.group.add(barrelMesh);
    this.visualMeshes.push(barrelMesh);
    this.disposables.push(barrelGeo);

    // Subtle recessed ink refill visible at neck entrance
    const inkStemGeo = new THREE.CylinderGeometry(radius * 0.24, radius * 0.24, 0.16, 12);
    inkStemGeo.rotateX(Math.PI * 0.5);
    const inkStem = new THREE.Mesh(inkStemGeo, inkCoreMat);
    inkStem.position.z = neckEndZ - 0.04;
    this.group.add(inkStem);
    this.visualMeshes.push(inkStem);
    this.disposables.push(inkStemGeo);

    // 3. Small metal-colored nib assembly visible inside the transparent front cap
    const metalGeos: THREE.BufferGeometry[] = [];

    // Brushed metal ferrule collar seated on the plastic barrel neck
    const ferruleGeo = new THREE.CylinderGeometry(radius * 0.64, radius * 0.66, 0.085, 18);
    ferruleGeo.rotateX(Math.PI * 0.5);
    ferruleGeo.translate(0, 0, neckEndZ + 0.04);
    metalGeos.push(ferruleGeo);

    // Tapered metallic nib cone
    const nibConePts = [
      new THREE.Vector2(radius * 0.62, neckEndZ + 0.082),
      new THREE.Vector2(radius * 0.54, neckEndZ + 0.14),
      new THREE.Vector2(radius * 0.27, neckEndZ + 0.29),
      new THREE.Vector2(radius * 0.14, neckEndZ + 0.36),
      new THREE.Vector2(0.015, neckEndZ + 0.46),
    ];
    const nibConeGeo = new THREE.LatheGeometry(nibConePts, 18);
    nibConeGeo.rotateX(Math.PI * 0.5);
    metalGeos.push(nibConeGeo);

    const sanitizedMetal = metalGeos.map((g) => (g.index ? g : BufferGeometryUtils.mergeVertices(g)));
    const mergedNibGeo = BufferGeometryUtils.mergeGeometries(sanitizedMetal, false) ?? metalGeos[0];
    for (const g of metalGeos) {
      if (g !== mergedNibGeo) g.dispose();
    }
    for (const g of sanitizedMetal) {
      if (g !== mergedNibGeo && !metalGeos.includes(g)) g.dispose();
    }
    const nibMesh = new THREE.Mesh(mergedNibGeo, nibMetalMat);
    nibMesh.castShadow = true;
    nibMesh.receiveShadow = true;
    nibMesh.renderOrder = 2;
    this.group.add(nibMesh);
    this.visualMeshes.push(nibMesh);
    this.disposables.push(mergedNibGeo);

    // Fine writing ball at nib tip
    const tipBallGeo = new THREE.SphereGeometry(0.015, 10, 10);
    const tipBall = new THREE.Mesh(tipBallGeo, tungstenBallMat);
    tipBall.position.z = neckEndZ + 0.468;
    tipBall.renderOrder = 2;
    this.group.add(tipBall);
    this.visualMeshes.push(tipBall);
    this.disposables.push(tipBallGeo);

    // 4. Distinctive rear-end cap (mounted inside capGroup so it stays synced with rear collider)
    const rearProfile = [
      new THREE.Vector2(0.0, -halfLen),
      new THREE.Vector2(rearCapRadius * 0.48, -halfLen + 0.008),
      new THREE.Vector2(rearCapRadius * 0.86, -halfLen + 0.045),
      new THREE.Vector2(rearCapRadius * 0.98, -halfLen + 0.105),
      new THREE.Vector2(rearCapRadius, -halfLen + 0.15),
      new THREE.Vector2(rearCapRadius, rearJoinZ - 0.03),
      new THREE.Vector2(rearCapRadius * 0.96, rearJoinZ),
      new THREE.Vector2(radius * 0.96, rearJoinZ),
    ];
    const rearCapGeo = new THREE.LatheGeometry(rearProfile, 24);
    rearCapGeo.rotateX(Math.PI * 0.5);
    const rearCapMesh = new THREE.Mesh(rearCapGeo, rearCapMat);
    rearCapMesh.castShadow = true;
    rearCapMesh.receiveShadow = true;
    this.capGroup.add(rearCapMesh);
    this.disposables.push(rearCapGeo);

    // Accent seam collar at the rear-cap junction
    const rearSeamGeo = new THREE.TorusGeometry(rearCapRadius * 0.98, 0.009, 8, 24);
    const rearSeam = new THREE.Mesh(rearSeamGeo, seamMat);
    rearSeam.position.z = rearJoinZ - 0.01;
    this.capGroup.add(rearSeam);
    this.disposables.push(rearSeamGeo);

    // Subtle recessed rear end button ring
    const tailPlugGeo = new THREE.TorusGeometry(rearCapRadius * 0.56, 0.007, 8, 20);
    const tailPlug = new THREE.Mesh(tailPlugGeo, seamMat);
    tailPlug.position.z = -halfLen + 0.014;
    this.capGroup.add(tailPlug);
    this.disposables.push(tailPlugGeo);

    this.capGroup.visible = this.capAttached;
    this.group.add(this.capGroup);
    this.visualMeshes.push(rearCapMesh, rearSeam, tailPlug);

    // 5. Internal cap details clearly visible through the transparent protective cap (renderOrder: 2)
    const frontCapRadius = radius * (spec.frontCap?.radiusScale ?? 1.1);
    const frontCapStartZ = neckStartZ - 0.03; // +0.56

    // 5a) Internal snap-fit locking ring inside cap mouth
    const lockCollarGeo = new THREE.CylinderGeometry(
      frontCapRadius * 0.94,
      frontCapRadius * 0.94,
      0.075,
      20,
      1,
      true
    );
    lockCollarGeo.rotateX(Math.PI * 0.5);
    const lockCollar = new THREE.Mesh(lockCollarGeo, innerCapAccentMat);
    lockCollar.position.z = frontCapStartZ + 0.055;
    lockCollar.renderOrder = 2;
    this.group.add(lockCollar);
    this.visualMeshes.push(lockCollar);
    this.disposables.push(lockCollarGeo);

    // 5b) Internal nib-seal cup / inner sleeve cradling the metallic nib tip
    const sealCupPts = [
      new THREE.Vector2(radius * 0.72, neckEndZ + 0.41),
      new THREE.Vector2(radius * 0.68, neckEndZ + 0.45),
      new THREE.Vector2(radius * 0.58, neckEndZ + 0.61),
      new THREE.Vector2(radius * 0.45, neckEndZ + 0.72),
      new THREE.Vector2(0.0, neckEndZ + 0.74),
    ];
    const sealCupGeo = new THREE.LatheGeometry(sealCupPts, 18);
    sealCupGeo.rotateX(Math.PI * 0.5);
    const sealCup = new THREE.Mesh(sealCupGeo, innerSealCupMat);
    sealCup.renderOrder = 2;
    this.group.add(sealCup);
    this.visualMeshes.push(sealCup);
    this.disposables.push(sealCupGeo);

    // 5c) Internal longitudinal reinforcement ribs lining the transparent cap interior
    const ribGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
      const ribGeo = new THREE.BoxGeometry(0.011, 0.014, 0.58);
      ribGeo.translate(0, frontCapRadius * 0.87, frontCapStartZ + 0.41);
      ribGeo.rotateZ(angle);
      ribGeos.push(ribGeo);
    }
    const mergedRibsGeo = BufferGeometryUtils.mergeGeometries(ribGeos, false) ?? ribGeos[0];
    for (const g of ribGeos) {
      if (g !== mergedRibsGeo) g.dispose();
    }
    const innerRibs = new THREE.Mesh(mergedRibsGeo, innerRibMat);
    innerRibs.renderOrder = 2;
    this.group.add(innerRibs);
    this.visualMeshes.push(innerRibs);
    this.disposables.push(mergedRibsGeo);

    // 6. Transparent curved protective front cap & curved pocket clip (renderOrder: 4)
    const frontCapProfile = [
      new THREE.Vector2(frontCapRadius * 1.03, frontCapStartZ),
      new THREE.Vector2(frontCapRadius * 1.035, frontCapStartZ + 0.04),
      new THREE.Vector2(frontCapRadius, frontCapStartZ + 0.075),
      new THREE.Vector2(frontCapRadius, frontCapStartZ + 0.56),
      new THREE.Vector2(frontCapRadius * 0.94, frontCapStartZ + 0.78),
      new THREE.Vector2(frontCapRadius * 0.8, frontCapStartZ + 0.94),
      new THREE.Vector2(frontCapRadius * 0.56, frontCapStartZ + 1.06),
      new THREE.Vector2(frontCapRadius * 0.28, halfLen - 0.025),
      new THREE.Vector2(0.0, halfLen),
    ];
    const clearCapGeo = new THREE.LatheGeometry(frontCapProfile, 28);
    clearCapGeo.rotateX(Math.PI * 0.5);
    const clearCap = new THREE.Mesh(clearCapGeo, clearCapMat);
    clearCap.castShadow = true;
    clearCap.renderOrder = 4;
    this.group.add(clearCap);
    this.visualMeshes.push(clearCap);
    this.disposables.push(clearCapGeo);

    // Slim curved transparent pocket clip attached near the cap dome
    const clipProfile = new THREE.Shape();
    clipProfile.moveTo(0, 0);
    clipProfile.lineTo(0.68, 0.008);
    clipProfile.quadraticCurveTo(0.75, 0.018, 0.74, 0.036);
    clipProfile.lineTo(0.05, 0.044);
    clipProfile.quadraticCurveTo(-0.02, 0.036, 0, 0);
    clipProfile.closePath();

    const capClipGeo = new THREE.ExtrudeGeometry(clipProfile, {
      depth: 0.042,
      bevelEnabled: true,
      bevelThickness: 0.007,
      bevelSize: 0.007,
      bevelSegments: 2,
    });
    capClipGeo.rotateY(Math.PI * 0.5);
    capClipGeo.translate(-0.021, frontCapRadius * 0.88, frontCapStartZ + 0.86);
    const capClip = new THREE.Mesh(capClipGeo, clearCapMat);
    capClip.castShadow = true;
    capClip.renderOrder = 4;
    this.group.add(capClip);
    this.visualMeshes.push(capClip);
    this.disposables.push(capClipGeo);

    // 7. Active-turn aura ring under/around pen
    const glowGeo = new THREE.CylinderGeometry(radius * 1.48, radius * 1.48, spec.length * 0.96, 16);
    glowGeo.rotateX(Math.PI * 0.5);
    const glowMat = new THREE.MeshBasicMaterial({
      color: isBlueTeam ? 0x38bdf8 : 0xf43f5e,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.BackSide,
    });
    this.highlightGlow = new THREE.Mesh(glowGeo, glowMat);
    this.group.add(this.highlightGlow);
    this.disposables.push(glowGeo, glowMat);

    // 8. Invisible cylindrical proxy mesh for raycasting
    const proxyGeo = new THREE.CylinderGeometry(radius * 2.6, radius * 2.6, spec.length + 0.42, 12);
    proxyGeo.rotateX(Math.PI * 0.5);
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    this.raycastProxy = new THREE.Mesh(proxyGeo, proxyMat);
    this.raycastProxy.userData.penId = this.id;
    this.group.add(this.raycastProxy);
    this.disposables.push(proxyGeo, proxyMat);
  }

  /**
   * Per-style silhouette details. Every pen in the catalog has a genuinely different
   * outer shape (not just a different colour) so the six models read as distinct objects
   * both in the 3D selector preview and on the desk during a match.
   *
   * Metal elements are accumulated into `metalGeos` and merged into a single draw call.
   */
  private addStyleDetails(
    style: PenPhysicsSpec['visualStyle'],
    spec: PenPhysicsSpec,
    metalGeos: THREE.BufferGeometry[],
    gripMat: THREE.Material,
    radius: number,
    lenScale: number
  ): void {
    const addNonMetalMesh = (mesh: THREE.Mesh, geo: THREE.BufferGeometry) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.visualMeshes.push(mesh);
      this.disposables.push(geo);
    };

    if (style === 'GRIP_RINGS') {
      // Wide knurled grip collar + two accent bands: the "grip specialist" read.
      const knurlGeo = new THREE.CylinderGeometry(radius * 1.07, radius * 1.07, 0.2 * lenScale, 16);
      knurlGeo.rotateX(Math.PI * 0.5);
      knurlGeo.translate(0, 0, -0.12 * lenScale);
      const knurl = new THREE.Mesh(knurlGeo, gripMat);
      addNonMetalMesh(knurl, knurlGeo);

      for (const z of [-0.78, 0.06]) {
        const bandGeo = new THREE.TorusGeometry(radius * 1.06, 0.012, 6, 16);
        bandGeo.translate(0, 0, z * lenScale);
        metalGeos.push(bandGeo);
      }
      return;
    }

    if (style === 'HEAVY_BRASS') {
      // Brass choke rings along the barrel plus a dense tail weight — reads as high mass.
      for (const z of [-1.12, -0.86, -0.6]) {
        const ringGeo = new THREE.TorusGeometry(radius * 1.1, 0.024, 6, 16);
        ringGeo.translate(0, 0, z * lenScale);
        metalGeos.push(ringGeo);
      }

      const weightGeo = new THREE.CylinderGeometry(radius * 1.14, radius * 1.1, 0.17 * lenScale, 16);
      weightGeo.rotateX(Math.PI * 0.5);
      weightGeo.translate(0, 0, -1.3 * lenScale);
      metalGeos.push(weightGeo);
      return;
    }

    if (style === 'SLIM_LIGHT') {
      // Minimal, skeletal gel-pen shell: a slim translucent sleeve and two fine grooves.
      const sleeveMat = new THREE.MeshStandardMaterial({
        color: spec.accentColorHex,
        roughness: 0.25,
        metalness: 0.1,
        transparent: true,
        opacity: 0.55,
      });
      const sleeveGeo = new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, 1.0 * lenScale, 16);
      sleeveGeo.rotateX(Math.PI * 0.5);
      const sleeve = new THREE.Mesh(sleeveGeo, sleeveMat);
      sleeve.position.z = -0.55 * lenScale;
      sleeve.castShadow = false;
      this.group.add(sleeve);
      this.visualMeshes.push(sleeve);
      this.disposables.push(sleeveGeo, sleeveMat);

      for (const z of [-0.32, -0.92]) {
        const grooveGeo = new THREE.TorusGeometry(radius * 1.045, 0.006, 6, 14);
        grooveGeo.translate(0, 0, z * lenScale);
        metalGeos.push(grooveGeo);
      }
      return;
    }

    if (style === 'PRECISION') {
      // Machined chamfer band, two etched index lines and a top-level window.
      const chamferGeo = new THREE.CylinderGeometry(radius * 1.06, radius * 1.0, 0.14 * lenScale, 16);
      chamferGeo.rotateX(Math.PI * 0.5);
      chamferGeo.translate(0, 0, 0.2 * lenScale);
      metalGeos.push(chamferGeo);

      for (const z of [-0.42, -0.88]) {
        const etchGeo = new THREE.TorusGeometry(radius * 1.05, 0.007, 6, 16);
        etchGeo.translate(0, 0, z * lenScale);
        metalGeos.push(etchGeo);
      }

      const windowMat = new THREE.MeshStandardMaterial({
        color: spec.nibColorHex,
        roughness: 0.1,
        metalness: 0.4,
        emissive: new THREE.Color(spec.nibColorHex),
        emissiveIntensity: 0.22,
      });
      const windowGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.012, 12);
      const vial = new THREE.Mesh(windowGeo, windowMat);
      vial.position.set(0, radius * 1.02, -0.2 * lenScale);
      this.group.add(vial);
      this.visualMeshes.push(vial);
      this.disposables.push(windowGeo, windowMat);
      return;
    }

    if (style === 'SPIN_RIDGED') {
      // Rear turbine fins + a governor ring: emphasises rotational inertia.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const bladeGeo = new THREE.BoxGeometry(radius * 0.62, 0.02, 0.4 * lenScale);
        bladeGeo.rotateZ(a);
        bladeGeo.translate(
          Math.cos(a) * radius * 1.28,
          Math.sin(a) * radius * 1.28,
          -1.02 * lenScale
        );
        metalGeos.push(bladeGeo);
      }

      const govGeo = new THREE.TorusGeometry(radius * 1.12, 0.02, 6, 18);
      govGeo.translate(0, 0, -1.26 * lenScale);
      metalGeos.push(govGeo);
      return;
    }

    // ARMORED — layered shoulder guard, twin raised armour ribs and a reinforced tail ring.
    const guardGeo = new THREE.CylinderGeometry(radius * 1.16, radius * 1.13, 0.3 * lenScale, 8);
    guardGeo.rotateX(Math.PI * 0.5);
    guardGeo.translate(0, 0, -0.16 * lenScale);
    const guard = new THREE.Mesh(guardGeo, gripMat);
    addNonMetalMesh(guard, guardGeo);

    for (const z of [-0.72, -1.02]) {
      const ribGeo = new THREE.TorusGeometry(radius * 1.15, 0.03, 6, 8);
      ribGeo.translate(0, 0, z * lenScale);
      metalGeos.push(ribGeo);
    }

    const tailRingGeo = new THREE.CylinderGeometry(
      radius * spec.cap.radiusScale * 1.03,
      radius * spec.cap.radiusScale * 1.0,
      0.08 * lenScale,
      14,
      1,
      true
    );
    tailRingGeo.rotateX(Math.PI * 0.5);
    tailRingGeo.translate(0, 0, -1.18 * lenScale);
    metalGeos.push(tailRingGeo);
  }

  private createBarrelTexture(
    primaryHex: number,
    accentHex: number,
    teamStripeHex: number,
    showTeamBand: boolean,
    maxAnisotropy: number
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    const baseColor = '#' + new THREE.Color(primaryHex).getHexString();
    const accentColor = '#' + new THREE.Color(accentHex).getHexString();
    const teamColor = '#' + new THREE.Color(teamStripeHex).getHexString();

    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, 512, 512);

    // Subtle longitudinal sheen band
    const grad = ctx.createLinearGradient(0, 0, 512, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.0)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.16)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.08)');
    grad.addColorStop(1, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Crisp stripe detail near rear of barrel
    ctx.fillStyle = accentColor;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 90, 512, 16);
    ctx.fillRect(0, 120, 512, 6);
    if (showTeamBand) {
      ctx.fillStyle = teamColor;
      ctx.globalAlpha = 0.95;
      ctx.fillRect(0, 390, 512, 24);
    }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    return tex;
  }

  public setHighlight(opacity: number, color?: number): void {
    const mat = this.highlightGlow.material as THREE.MeshBasicMaterial;
    mat.opacity = opacity;
    if (typeof color === 'number') {
      mat.color.setHex(color);
    }
  }

  /** True while the removable rear cap is seated on the barrel. */
  public isCapAttached(): boolean {
    return this.capAttached;
  }

  /**
   * Architecture hook for the future removable-cap feature. Today it only toggles the cap
   * sub-group's visibility and this advisory flag — the cap stays fused to the pen's single
   * rigid body, so aiming, dragging, throwing and collision behaviour are unaffected. A later
   * version can split the cap collider in PhysicsManager into its own dynamic body and drive
   * its local transform here.
   */
  public setCapAttached(attached: boolean): void {
    if (this.capAttached === attached) return;
    this.capAttached = attached;
    this.capGroup.visible = attached;
  }

  public syncTransform(
    pos: { x: number; y: number; z: number },
    rot: { x: number; y: number; z: number; w: number },
    halfW = TABLE_HALF_W,
    halfD = TABLE_HALF_D
  ): void {
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    // Compute pen's longitudinal forward axis in world space (+Z is pen front tip)
    _zAxisTmp.set(0, 0, 1).applyQuaternion(this.group.quaternion);
    const horizLen = Math.hypot(_zAxisTmp.x, _zAxisTmp.z);

    // Update contact shadow position, orientation, scale & opacity directly underneath the pen
    const shadowMat = this.contactShadow.material as THREE.MeshBasicMaterial;
    if (pos.y < -0.35) {
      shadowMat.opacity = 0;
    } else {
      // Rotation matches pen yaw angle exactly around world Y (table normal)
      if (horizLen > 0.001) {
        const yaw = Math.atan2(_zAxisTmp.x, _zAxisTmp.z);
        this.contactShadow.rotation.set(0, yaw, 0);
      }

      // Height above tabletop resting position
      const restY = this.currentRestY;
      const h = Math.max(0, pos.y - restY);

      // Natural spread responding to pen height (ambient occlusion diffusion)
      const spread = 1.0 + Math.min(0.55, h * 1.4);
      // Foreshortening along pen length responding to vertical pitch (tilt)
      const pitchFactor = Math.max(0.2, horizLen);
      this.contactShadow.scale.set(
        this.baseShadowWidth * spread,
        1,
        this.baseShadowLength * pitchFactor * spread
      );

      // Contact shadow plane sits directly on the desk surface (Y = 0.003 prevents z-fighting with tabletop)
      this.contactShadow.position.set(pos.x, 0.003, pos.z);

      // Smooth height fade and graceful boundary edge falloff
      const heightFade = Math.max(0, 1.0 - h * 1.8);
      const edgeDistX = halfW - Math.abs(pos.x);
      const edgeDistZ = halfD - Math.abs(pos.z);
      const edgeFade = THREE.MathUtils.clamp(Math.min(edgeDistX, edgeDistZ) / 0.5 + 0.5, 0, 1);

      shadowMat.opacity = 0.62 * heightFade * edgeFade;
    }
  }

  public dispose(): void {
    this.clearModelParts();
    for (const d of this.shadowDisposables) {
      d.dispose();
    }
    this.shadowDisposables.length = 0;
    _sharedTextureUsers--;
    if (_sharedTextureUsers <= 0) {
      _sharedTextureUsers = 0;
      _sharedPenShadowTexture?.dispose();
      _sharedPenShadowTexture = null;
      _sharedPenShadowGeometry?.dispose();
      _sharedPenShadowGeometry = null;
    }
  }
}
