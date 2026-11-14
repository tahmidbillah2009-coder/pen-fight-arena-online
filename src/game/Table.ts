import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  ArenaId,
  ArenaOrientation,
  DEFAULT_ARENA,
  EDGE_WARNING_DISTANCE,
  FLOOR_Y,
  TABLE_DEPTH,
  TABLE_HALF_D,
  TABLE_HALF_W,
  TABLE_THICKNESS,
  TABLE_WIDTH,
} from '../utils/Constants';
import {
  createClassroomFloorTexture,
  createDeskSurfaceMaps,
  createLibraryDeskSurfaceMaps,
  createLibraryFloorTexture,
  createScienceLabFloorTexture,
  createScienceLabSurfaceMaps,
} from './DeskTextures';
import { EdgeDangerLevel } from './GameState';

const SHADOW_PLANE_W = TABLE_WIDTH + 4.5;
const SHADOW_PLANE_D = TABLE_DEPTH + 4.0;

export class TableEnvironment {
  public readonly group = new THREE.Group();
  private readonly deskGroup = new THREE.Group();
  private readonly wallGroup = new THREE.Group();
  private readonly floorGroup = new THREE.Group();
  private readonly maxAnisotropy: number;
  private arenaId: ArenaId;
  private orientation: ArenaOrientation = 'horizontal';
  private readonly disposables: Array<{ dispose: () => void }> = [];
  private edgeStrips!: {
    left: THREE.MeshBasicMaterial;
    right: THREE.MeshBasicMaterial;
    top: THREE.MeshBasicMaterial;
    bottom: THREE.MeshBasicMaterial;
  };
  private readonly _warnColor = new THREE.Color(0xf59e0b);
  private readonly _dangerColor = new THREE.Color(0xef4444);

  constructor(maxAnisotropy: number, initialArena: ArenaId = DEFAULT_ARENA) {
    this.maxAnisotropy = maxAnisotropy;
    this.arenaId = initialArena;
    this.group.add(this.floorGroup);
    this.group.add(this.deskGroup);
    this.group.add(this.wallGroup);
    this.buildArena(initialArena);
  }

  public getArena(): ArenaId {
    return this.arenaId;
  }

  public setArena(arenaId: ArenaId): void {
    if (this.arenaId === arenaId) return;
    this.arenaId = arenaId;
    this.clearArenaMeshes();
    this.buildArena(arenaId);
    // Re-apply current orientation to freshly built desk & wall groups
    this.deskGroup.rotation.y = this.orientation === 'vertical' ? Math.PI * 0.5 : 0;
    this.wallGroup.position.z = this.orientation === 'vertical' ? -3.8 : 0;
  }

  private clearArenaMeshes(): void {
    this.floorGroup.clear();
    this.deskGroup.clear();
    this.wallGroup.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  private buildArena(arenaId: ArenaId): void {
    if (arenaId === 'LIBRARY_DESK') {
      this.buildLibraryDesk(this.maxAnisotropy);
      this.edgeStrips = this.buildEdgeWarningStrips();
      this.buildLibraryBackdrop(this.maxAnisotropy);
    } else if (arenaId === 'SCIENCE_LAB') {
      this.buildScienceLabBench(this.maxAnisotropy);
      this.edgeStrips = this.buildEdgeWarningStrips();
      this.buildScienceLabBackdrop(this.maxAnisotropy);
    } else {
      this.buildDesk(this.maxAnisotropy);
      this.edgeStrips = this.buildEdgeWarningStrips();
      this.buildClassroomBackdrop(this.maxAnisotropy);
    }
  }

  public setOrientation(orientation: ArenaOrientation): void {
    if (this.orientation === orientation) return;
    this.orientation = orientation;
    // Rotate entire desk assembly +90° around Y so its 19.5 long axis runs vertically (Z)
    // and Player 1's half maps cleanly to +Z (bottom), Player 2's to -Z (top).
    this.deskGroup.rotation.y = orientation === 'vertical' ? Math.PI * 0.5 : 0;
    // Slide back wall back by 3.8u when vertical so the chalkboard clears the -9.75 table edge.
    this.wallGroup.position.z = orientation === 'vertical' ? -3.8 : 0;
  }

  private createChalkboardTexture(maxAnisotropy: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#254236';
    ctx.fillRect(0, 0, 1024, 512);

    // Subtle chalk dust smudge
    const rad = ctx.createRadialGradient(512, 256, 40, 512, 256, 460);
    rad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    rad.addColorStop(1, 'rgba(0, 0, 0, 0.16)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, 1024, 512);

    // Clean geometric chalk diagrams (physics trajectories & angles)
    ctx.strokeStyle = 'rgba(241, 245, 249, 0.34)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(240, 260, 75, 0, Math.PI * 1.4);
    ctx.stroke();

    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(420, 340);
    ctx.quadraticCurveTo(590, 120, 810, 290);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = 'bold 42px sans-serif';
    ctx.fillStyle = 'rgba(248, 250, 252, 0.42)';
    ctx.textAlign = 'center';
    ctx.fillText('F = m · a', 720, 175);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    this.disposables.push(texture);
    return texture;
  }

  /**
   * Builds a beveled, rounded-corner wooden tabletop split into:
   * - `topDeckGeo`: flat playing surface strictly at Y = 0 plus the upper beveled lip (tangent-mapped for normalMap)
   * - `edgeUndersideGeo`: vertical laminated edge banding, lower bevel & unfinished underside board
   */
  private createBeveledTabletopGeometries(): {
    topDeckGeo: THREE.BufferGeometry;
    edgeUndersideGeo: THREE.BufferGeometry;
  } {
    const bevel = 0.04;
    const cornerR = 0.14;
    const innerHalfW = TABLE_HALF_W - bevel;
    const innerHalfD = TABLE_HALF_D - bevel;
    const r = Math.max(0.02, cornerR - bevel);

    const shape = new THREE.Shape();
    shape.moveTo(-innerHalfW + r, -innerHalfD);
    shape.lineTo(innerHalfW - r, -innerHalfD);
    shape.quadraticCurveTo(innerHalfW, -innerHalfD, innerHalfW, -innerHalfD + r);
    shape.lineTo(innerHalfW, innerHalfD - r);
    shape.quadraticCurveTo(innerHalfW, innerHalfD, innerHalfW - r, innerHalfD);
    shape.lineTo(-innerHalfW + r, innerHalfD);
    shape.quadraticCurveTo(-innerHalfW, innerHalfD, -innerHalfW, innerHalfD - r);
    shape.lineTo(-innerHalfW, -innerHalfD + r);
    shape.quadraticCurveTo(-innerHalfW, -innerHalfD, -innerHalfW + r, -innerHalfD);

    const raw = new THREE.ExtrudeGeometry(shape, {
      depth: TABLE_THICKNESS - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 4,
    });
    raw.rotateX(-Math.PI * 0.5);
    raw.computeBoundingBox();
    const box = raw.boundingBox!;
    const cx = (box.min.x + box.max.x) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;
    // Align top playing face strictly to Y = 0
    raw.translate(-cx, -box.max.y, -cz);
    raw.computeVertexNormals();

    const posAttr = raw.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = raw.getAttribute('normal') as THREE.BufferAttribute;

    const topPos: number[] = [];
    const topNorm: number[] = [];
    const topUv: number[] = [];

    const edgePos: number[] = [];
    const edgeNorm: number[] = [];
    const edgeUv: number[] = [];

    const ax = new THREE.Vector3();
    const bx = new THREE.Vector3();
    const cxv = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const faceN = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i += 3) {
      ax.fromBufferAttribute(posAttr, i);
      bx.fromBufferAttribute(posAttr, i + 1);
      cxv.fromBufferAttribute(posAttr, i + 2);
      ab.subVectors(bx, ax);
      ac.subVectors(cxv, ax);
      faceN.crossVectors(ab, ac).normalize();

      if (faceN.y > 0.35) {
        for (let k = 0; k < 3; k++) {
          const idx = i + k;
          const vx = posAttr.getX(idx);
          const vy = posAttr.getY(idx);
          const vz = posAttr.getZ(idx);
          topPos.push(vx, vy, vz);
          topNorm.push(normAttr.getX(idx), normAttr.getY(idx), normAttr.getZ(idx));
          topUv.push((vx + TABLE_HALF_W) / TABLE_WIDTH, 1 - (vz + TABLE_HALF_D) / TABLE_DEPTH);
        }
      } else {
        const isBottom = faceN.y <= -0.7;
        for (let k = 0; k < 3; k++) {
          const idx = i + k;
          const vx = posAttr.getX(idx);
          const vy = posAttr.getY(idx);
          const vz = posAttr.getZ(idx);
          edgePos.push(vx, vy, vz);
          edgeNorm.push(normAttr.getX(idx), normAttr.getY(idx), normAttr.getZ(idx));
          if (isBottom) {
            edgeUv.push(
              (vx + TABLE_HALF_W) / TABLE_WIDTH,
              0.02 + 0.45 * ((vz + TABLE_HALF_D) / TABLE_DEPTH)
            );
          } else {
            const along =
              Math.abs(faceN.z) >= Math.abs(faceN.x)
                ? (vx + TABLE_HALF_W) / 4.2
                : (vz + TABLE_HALF_D) / 4.2;
            const heightFrac = Math.max(0, Math.min(1, (vy + TABLE_THICKNESS) / TABLE_THICKNESS));
            edgeUv.push(along, 0.53 + 0.45 * heightFrac);
          }
        }
      }
    }

    raw.dispose();

    const topRaw = new THREE.BufferGeometry();
    topRaw.setAttribute('position', new THREE.Float32BufferAttribute(topPos, 3));
    topRaw.setAttribute('normal', new THREE.Float32BufferAttribute(topNorm, 3));
    topRaw.setAttribute('uv', new THREE.Float32BufferAttribute(topUv, 2));
    const topDeckGeo = BufferGeometryUtils.mergeVertices(topRaw, 1e-4);
    topRaw.dispose();
    topDeckGeo.computeTangents();

    const edgeRaw = new THREE.BufferGeometry();
    edgeRaw.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
    edgeRaw.setAttribute('normal', new THREE.Float32BufferAttribute(edgeNorm, 3));
    edgeRaw.setAttribute('uv', new THREE.Float32BufferAttribute(edgeUv, 2));
    const edgeUndersideGeo = BufferGeometryUtils.mergeVertices(edgeRaw, 1e-4);
    edgeRaw.dispose();

    return { topDeckGeo, edgeUndersideGeo };
  }

  private buildDesk(maxAnisotropy: number): void {
    // Leg anchor coordinates (slight outward classroom stance from mounting corners down to rubber feet)
    const legTopOffsetX = TABLE_HALF_W - 0.95;
    const legTopOffsetZ = TABLE_HALF_D - 0.85;
    const legFootOffsetX = legTopOffsetX + 0.22;
    const legFootOffsetZ = legTopOffsetZ + 0.16;

    const legSpecs: Array<{ tx: number; tz: number; fx: number; fz: number }> = [
      { tx: -legTopOffsetX, tz: -legTopOffsetZ, fx: -legFootOffsetX, fz: -legFootOffsetZ },
      { tx: legTopOffsetX, tz: -legTopOffsetZ, fx: legFootOffsetX, fz: -legFootOffsetZ },
      { tx: -legTopOffsetX, tz: legTopOffsetZ, fx: -legFootOffsetX, fz: legFootOffsetZ },
      { tx: legTopOffsetX, tz: legTopOffsetZ, fx: legFootOffsetX, fz: legFootOffsetZ },
    ];

    const legFootNormalizedPositions = legSpecs.map(({ fx, fz }) => ({
      nx: (fx + SHADOW_PLANE_W * 0.5) / SHADOW_PLANE_W,
      nz: (fz + SHADOW_PLANE_D * 0.5) / SHADOW_PLANE_D,
    }));

    const maps = createDeskSurfaceMaps(maxAnisotropy, legFootNormalizedPositions);
    this.disposables.push(
      maps.albedo,
      maps.roughness,
      maps.normal,
      maps.edgeUnderside,
      maps.contactShadow
    );

    // 1. Beveled wooden tabletop slab (playing surface sits strictly at Y = 0)
    const { topDeckGeo, edgeUndersideGeo } = this.createBeveledTabletopGeometries();

    const topMat = new THREE.MeshStandardMaterial({
      map: maps.albedo,
      roughnessMap: maps.roughness,
      roughness: 1.0,
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.28, 0.28),
      metalness: 0.02,
      envMapIntensity: 0.48,
    });
    const tabletop = new THREE.Mesh(topDeckGeo, topMat);
    tabletop.receiveShadow = true;
    tabletop.castShadow = true;
    this.deskGroup.add(tabletop);
    this.disposables.push(topDeckGeo, topMat);

    // 2. Worn laminated hardwood edge banding & raw underside wood board
    const edgeMat = new THREE.MeshStandardMaterial({
      map: maps.edgeUnderside,
      roughness: 0.66,
      metalness: 0.03,
      envMapIntensity: 0.35,
    });
    const edgeMesh = new THREE.Mesh(edgeUndersideGeo, edgeMat);
    edgeMesh.receiveShadow = true;
    edgeMesh.castShadow = true;
    this.deskGroup.add(edgeMesh);
    this.disposables.push(edgeUndersideGeo, edgeMat);

    // 3. Structural steel underframe: recessed apron rails, cross-ribs, gusset plates, splayed legs & stretchers
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x2f3a47,
      roughness: 0.42,
      metalness: 0.66,
      envMapIntensity: 0.72,
    });
    const steelGeometries: THREE.BufferGeometry[] = [];
    const hardwareGeometries: THREE.BufferGeometry[] = [];
    const glideGeometries: THREE.BufferGeometry[] = [];

    const railY = -TABLE_THICKNESS - 0.15;
    const railSpanX = legTopOffsetX * 2 + 0.18;
    const railSpanZ = legTopOffsetZ * 2 + 0.18;

    // Front & back recessed apron rails
    for (const sz of [-legTopOffsetZ, legTopOffsetZ]) {
      const fbRail = new THREE.BoxGeometry(railSpanX, 0.3, 0.15);
      fbRail.translate(0, railY, sz);
      steelGeometries.push(fbRail);
    }
    // Left & right recessed apron rails
    for (const sx of [-legTopOffsetX, legTopOffsetX]) {
      const lrRail = new THREE.BoxGeometry(0.15, 0.3, railSpanZ);
      lrRail.translate(sx, railY, 0);
      steelGeometries.push(lrRail);
    }
    // Two internal steel under-table stiffening ribs
    for (const rx of [-3.4, 3.4]) {
      const rib = new THREE.BoxGeometry(0.1, 0.2, railSpanZ - 0.2);
      rib.translate(rx, railY + 0.04, 0);
      steelGeometries.push(rib);
    }

    // Splayed tubular steel legs, mounting gusset plates, weld collars, side stretchers, fasteners & rubber glides
    const upVec = new THREE.Vector3(0, 1, 0);
    const legTopY = -TABLE_THICKNESS - 0.04;
    const legBottomY = FLOOR_Y + 0.12;
    const topVec = new THREE.Vector3();
    const botVec = new THREE.Vector3();
    const dirVec = new THREE.Vector3();
    const midVec = new THREE.Vector3();
    const quat = new THREE.Quaternion();

    for (const { tx, tz, fx, fz } of legSpecs) {
      // Corner gusset mounting plate flush under the desk
      const gusset = new THREE.BoxGeometry(0.62, 0.05, 0.62);
      gusset.translate(tx, -TABLE_THICKNESS - 0.025, tz);
      steelGeometries.push(gusset);

      // Weld collar right below corner plate
      const collar = new THREE.CylinderGeometry(0.245, 0.225, 0.16, 14);
      collar.translate(tx, -TABLE_THICKNESS - 0.1, tz);
      steelGeometries.push(collar);

      // Angled tubular steel leg
      topVec.set(tx, legTopY, tz);
      botVec.set(fx, legBottomY, fz);
      dirVec.subVectors(botVec, topVec);
      const legLen = dirVec.length();
      dirVec.normalize();
      quat.setFromUnitVectors(upVec, dirVec);
      midVec.addVectors(topVec, botVec).multiplyScalar(0.5);

      const legGeo = new THREE.CylinderGeometry(0.21, 0.16, legLen, 14);
      legGeo.applyQuaternion(quat);
      legGeo.translate(midVec.x, midVec.y, midVec.z);
      steelGeometries.push(legGeo);

      // Non-slip rubber floor glide resting cleanly at FLOOR_Y
      const glideGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.14, 14);
      glideGeo.translate(fx, FLOOR_Y + 0.07, fz);
      glideGeometries.push(glideGeo);

      // Corner mounting hex bolts under gusset plate
      const sx = Math.sign(tx);
      const sz = Math.sign(tz);
      for (const [bx, bz] of [
        [tx - sx * 0.2, tz - sz * 0.2],
        [tx + sx * 0.18, tz - sz * 0.2],
        [tx - sx * 0.2, tz + sz * 0.18],
      ]) {
        const bolt = new THREE.CylinderGeometry(0.04, 0.04, 0.035, 6);
        bolt.translate(bx, -TABLE_THICKNESS - 0.06, bz);
        hardwareGeometries.push(bolt);
      }
    }

    // Side H-stretcher tie bars connecting front & back legs on left and right sides
    const stretcherY = FLOOR_Y + 1.45;
    const stretcherFrac = (legTopY - stretcherY) / (legTopY - legBottomY);
    const stretcherZ = THREE.MathUtils.lerp(legTopOffsetZ, legFootOffsetZ, stretcherFrac);
    const stretcherX = THREE.MathUtils.lerp(legTopOffsetX, legFootOffsetX, stretcherFrac);
    for (const sx of [-1, 1]) {
      const bar = new THREE.CylinderGeometry(0.08, 0.08, stretcherZ * 2, 10);
      bar.rotateX(Math.PI * 0.5);
      bar.translate(sx * stretcherX, stretcherY, 0);
      steelGeometries.push(bar);
    }

    const mergedSteelGeo = BufferGeometryUtils.mergeGeometries(steelGeometries, false) ?? steelGeometries[0];
    for (const g of steelGeometries) {
      if (g !== mergedSteelGeo) g.dispose();
    }
    const steelMesh = new THREE.Mesh(mergedSteelGeo, steelMat);
    steelMesh.receiveShadow = true;
    steelMesh.castShadow = true;
    this.deskGroup.add(steelMesh);
    this.disposables.push(mergedSteelGeo, steelMat);

    // Merged zinc bolts & hardware
    const hardwareMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.34,
      metalness: 0.85,
    });
    const mergedHardwareGeo =
      BufferGeometryUtils.mergeGeometries(hardwareGeometries, false) ?? hardwareGeometries[0];
    for (const g of hardwareGeometries) {
      if (g !== mergedHardwareGeo) g.dispose();
    }
    const hardwareMesh = new THREE.Mesh(mergedHardwareGeo, hardwareMat);
    this.deskGroup.add(hardwareMesh);
    this.disposables.push(mergedHardwareGeo, hardwareMat);

    // Merged rubber floor glides
    const glideMat = new THREE.MeshStandardMaterial({
      color: 0x1e2530,
      roughness: 0.9,
      metalness: 0.04,
    });
    const mergedGlideGeo = BufferGeometryUtils.mergeGeometries(glideGeometries, false) ?? glideGeometries[0];
    for (const g of glideGeometries) {
      if (g !== mergedGlideGeo) g.dispose();
    }
    const glideMesh = new THREE.Mesh(mergedGlideGeo, glideMat);
    this.deskGroup.add(glideMesh);
    this.disposables.push(mergedGlideGeo, glideMat);

    // 4. Combined soft contact shadow beneath desk & 4 feet on classroom floor
    const shadowGeo = new THREE.PlaneGeometry(SHADOW_PLANE_W, SHADOW_PLANE_D);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: maps.contactShadow,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    });
    const deskFloorShadow = new THREE.Mesh(shadowGeo, shadowMat);
    deskFloorShadow.rotation.x = -Math.PI * 0.5;
    deskFloorShadow.position.set(0, FLOOR_Y + 0.015, 0);
    this.deskGroup.add(deskFloorShadow);
    this.disposables.push(shadowGeo, shadowMat);
  }

  private buildEdgeWarningStrips(): {
    left: THREE.MeshBasicMaterial;
    right: THREE.MeshBasicMaterial;
    top: THREE.MeshBasicMaterial;
    bottom: THREE.MeshBasicMaterial;
  } {
    const stripThick = 0.22;
    const makeMat = () => {
      const m = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      this.disposables.push(m);
      return m;
    };

    const leftMat = makeMat();
    const rightMat = makeMat();
    const topMat = makeMat();
    const bottomMat = makeMat();

    const sideGeo = new THREE.PlaneGeometry(stripThick, TABLE_DEPTH - stripThick * 2);
    sideGeo.rotateX(-Math.PI * 0.5);
    const frontGeo = new THREE.PlaneGeometry(TABLE_WIDTH, stripThick);
    frontGeo.rotateX(-Math.PI * 0.5);
    this.disposables.push(sideGeo, frontGeo);

    const leftMesh = new THREE.Mesh(sideGeo, leftMat);
    leftMesh.position.set(-TABLE_HALF_W + stripThick * 0.5, 0.008, 0);

    const rightMesh = new THREE.Mesh(sideGeo, rightMat);
    rightMesh.position.set(TABLE_HALF_W - stripThick * 0.5, 0.008, 0);

    const topMesh = new THREE.Mesh(frontGeo, topMat);
    topMesh.position.set(0, 0.008, -TABLE_HALF_D + stripThick * 0.5);

    const bottomMesh = new THREE.Mesh(frontGeo, bottomMat);
    bottomMesh.position.set(0, 0.008, TABLE_HALF_D - stripThick * 0.5);

    this.deskGroup.add(leftMesh, rightMesh, topMesh, bottomMesh);
    return { left: leftMat, right: rightMat, top: topMat, bottom: bottomMat };
  }

  private toDeskLocalX(pos: { x: number; z: number }): number {
    return this.orientation === 'vertical' ? -pos.z : pos.x;
  }

  private toDeskLocalZ(pos: { x: number; z: number }): number {
    return this.orientation === 'vertical' ? pos.x : pos.z;
  }

  public updateEdgeWarning(
    playerPos: { x: number; y: number; z: number },
    botPos: { x: number; y: number; z: number },
    playerLevel: EdgeDangerLevel,
    botLevel: EdgeDangerLevel,
    nowMs: number
  ): void {
    const pulse = 0.65 + 0.35 * Math.sin(nowMs * 0.012);

    const px = this.toDeskLocalX(playerPos);
    const pz = this.toDeskLocalZ(playerPos);
    const bx = this.toDeskLocalX(botPos);
    const bz = this.toDeskLocalZ(botPos);

    const pLeft = TABLE_HALF_W + px;
    const pRight = TABLE_HALF_W - px;
    const pTop = TABLE_HALF_D + pz;
    const pBottom = TABLE_HALF_D - pz;

    const bLeft = TABLE_HALF_W + bx;
    const bRight = TABLE_HALF_W - bx;
    const bTop = TABLE_HALF_D + bz;
    const bBottom = TABLE_HALF_D - bz;

    this.applyEdgeStrip(this.edgeStrips.left, pLeft, playerLevel, bLeft, botLevel, pulse);
    this.applyEdgeStrip(this.edgeStrips.right, pRight, playerLevel, bRight, botLevel, pulse);
    this.applyEdgeStrip(this.edgeStrips.top, pTop, playerLevel, bTop, botLevel, pulse);
    this.applyEdgeStrip(this.edgeStrips.bottom, pBottom, playerLevel, bBottom, botLevel, pulse);
  }

  public updateEdgeWarningPens(
    pens: Array<{ pos: { x: number; y: number; z: number }; level: EdgeDangerLevel }>,
    nowMs: number
  ): void {
    if (pens.length === 0) return;
    const pulse = 0.65 + 0.35 * Math.sin(nowMs * 0.012);

    const evalEdge = (mat: THREE.MeshBasicMaterial, getDist: (p: { x: number; y: number; z: number }) => number) => {
      let bestDist = Infinity;
      let bestLevel: EdgeDangerLevel = 'SAFE';
      for (const pen of pens) {
        if (pen.level === 'SAFE') continue;
        const d = getDist(pen.pos);
        if (d < bestDist) {
          bestDist = d;
          bestLevel = pen.level;
        }
      }
      this.applyEdgeStrip(mat, bestDist, bestLevel, Infinity, 'SAFE', pulse);
    };

    evalEdge(this.edgeStrips.left, (p) => TABLE_HALF_W + this.toDeskLocalX(p));
    evalEdge(this.edgeStrips.right, (p) => TABLE_HALF_W - this.toDeskLocalX(p));
    evalEdge(this.edgeStrips.top, (p) => TABLE_HALF_D + this.toDeskLocalZ(p));
    evalEdge(this.edgeStrips.bottom, (p) => TABLE_HALF_D - this.toDeskLocalZ(p));
  }

  /**
   * Tints one edge strip from whichever pen is closest to that edge. Written without closures or
   * temporary objects because it runs for four edges on every single rendered frame.
   */
  private applyEdgeStrip(
    mat: THREE.MeshBasicMaterial,
    playerDist: number,
    playerLevel: EdgeDangerLevel,
    botDist: number,
    botLevel: EdgeDangerLevel,
    pulse: number
  ): void {
    const playerCloser = playerDist <= botDist;
    const dist = playerCloser ? playerDist : botDist;
    const level = playerCloser ? playerLevel : botLevel;

    if (level === 'SAFE' || dist > EDGE_WARNING_DISTANCE) {
      mat.opacity = 0;
      return;
    }
    const norm = Math.max(0, Math.min(1, 1 - dist / EDGE_WARNING_DISTANCE));
    if (level === 'DANGER') {
      mat.color.copy(this._dangerColor);
      mat.opacity = (0.28 + 0.42 * norm) * pulse;
    } else {
      mat.color.copy(this._warnColor);
      mat.opacity = 0.14 + 0.28 * norm;
    }
  }

  private buildClassroomBackdrop(maxAnisotropy: number): void {
    // 1. Classroom floor
    const floorTex = createClassroomFloorTexture(maxAnisotropy);
    this.disposables.push(floorTex);
    const floorGeo = new THREE.PlaneGeometry(90, 90);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.84,
      metalness: 0.02,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI * 0.5;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.floorGroup.add(floor);
    this.disposables.push(floorGeo, floorMat);

    // 2. Back classroom wall (warm cream plaster) & baseboard
    const wallGeo = new THREE.BoxGeometry(64, 24, 0.8);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xefe6d5,
      roughness: 0.9,
      metalness: 0.0,
    });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, FLOOR_Y + 12, -13.5);
    backWall.receiveShadow = true;
    this.wallGroup.add(backWall);
    this.disposables.push(wallGeo, wallMat);

    // 3. Stylized Chalkboard mounted on back wall
    const chalkTex = this.createChalkboardTexture(maxAnisotropy);
    const boardGeo = new THREE.BoxGeometry(14.5, 6.2, 0.16);
    const boardMat = new THREE.MeshStandardMaterial({
      map: chalkTex,
      roughness: 0.85,
      metalness: 0.02,
    });
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.set(-1.5, FLOOR_Y + 8.8, -13.0);
    this.wallGroup.add(board);
    this.disposables.push(boardGeo, boardMat);

    // Merged classroom wood trims (baseboard + chalkboard frame + chalk ledge)
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x8b6240,
      roughness: 0.68,
      metalness: 0.04,
    });
    const baseboardGeo = new THREE.BoxGeometry(64, 0.8, 0.9);
    baseboardGeo.translate(0, FLOOR_Y + 0.4, -13.45);

    const frameGeo = new THREE.BoxGeometry(15.1, 6.8, 0.12);
    frameGeo.translate(-1.5, FLOOR_Y + 8.8, -13.08);

    const chalkTrayGeo = new THREE.BoxGeometry(15.1, 0.16, 0.34);
    chalkTrayGeo.translate(-1.5, FLOOR_Y + 5.5, -12.9);

    const mergedTrimGeo =
      BufferGeometryUtils.mergeGeometries([baseboardGeo, frameGeo, chalkTrayGeo], false) ?? baseboardGeo;
    baseboardGeo.dispose();
    frameGeo.dispose();
    chalkTrayGeo.dispose();
    const mergedTrimMesh = new THREE.Mesh(mergedTrimGeo, trimMat);
    this.wallGroup.add(mergedTrimMesh);
    this.disposables.push(mergedTrimGeo, trimMat);

    // 4. Sunlit Classroom Window Frame on upper right of back wall
    const winFrameMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.5,
      metalness: 0.05,
    });
    const winFrameGeo = new THREE.BoxGeometry(6.8, 7.6, 0.18);
    winFrameGeo.translate(11.5, FLOOR_Y + 9.2, -13.06);

    const mullionVGeo = new THREE.BoxGeometry(0.18, 6.8, 0.22);
    mullionVGeo.translate(11.5, FLOOR_Y + 9.2, -12.92);

    const mullionHGeo = new THREE.BoxGeometry(6.0, 0.18, 0.22);
    mullionHGeo.translate(11.5, FLOOR_Y + 9.2, -12.92);

    const mergedWindowGeo =
      BufferGeometryUtils.mergeGeometries([winFrameGeo, mullionVGeo, mullionHGeo], false) ?? winFrameGeo;
    winFrameGeo.dispose();
    mullionVGeo.dispose();
    mullionHGeo.dispose();
    const winFrame = new THREE.Mesh(mergedWindowGeo, winFrameMat);
    this.wallGroup.add(winFrame);
    this.disposables.push(mergedWindowGeo, winFrameMat);

    const paneGeo = new THREE.PlaneGeometry(6.0, 6.8);
    const paneMat = new THREE.MeshBasicMaterial({
      color: 0xfff6dc,
    });
    const pane = new THREE.Mesh(paneGeo, paneMat);
    pane.position.set(11.5, FLOOR_Y + 9.2, -12.95);
    this.wallGroup.add(pane);
    this.disposables.push(paneGeo, paneMat);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ARENA 2: LIBRARY DESK
  // ══════════════════════════════════════════════════════════════════════════════

  private buildLibraryDesk(maxAnisotropy: number): void {
    const legOffsetX = TABLE_HALF_W - 1.05;
    const legOffsetZ = TABLE_HALF_D - 0.9;

    const legSpecs = [
      { x: -legOffsetX, z: -legOffsetZ },
      { x: legOffsetX, z: -legOffsetZ },
      { x: -legOffsetX, z: legOffsetZ },
      { x: legOffsetX, z: legOffsetZ },
    ];
    const legFootNormalizedPositions = legSpecs.map(({ x, z }) => ({
      nx: (x + SHADOW_PLANE_W * 0.5) / SHADOW_PLANE_W,
      nz: (z + SHADOW_PLANE_D * 0.5) / SHADOW_PLANE_D,
    }));

    const maps = createLibraryDeskSurfaceMaps(maxAnisotropy, legFootNormalizedPositions);
    this.disposables.push(
      maps.albedo,
      maps.roughness,
      maps.normal,
      maps.edgeUnderside,
      maps.contactShadow
    );

    const { topDeckGeo, edgeUndersideGeo } = this.createBeveledTabletopGeometries();

    const topMat = new THREE.MeshStandardMaterial({
      map: maps.albedo,
      roughnessMap: maps.roughness,
      roughness: 1.0,
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.26, 0.26),
      metalness: 0.02,
      envMapIntensity: 0.42,
    });
    const tabletop = new THREE.Mesh(topDeckGeo, topMat);
    tabletop.receiveShadow = true;
    tabletop.castShadow = true;
    this.deskGroup.add(tabletop);
    this.disposables.push(topDeckGeo, topMat);

    const edgeMat = new THREE.MeshStandardMaterial({
      map: maps.edgeUnderside,
      roughness: 0.72,
      metalness: 0.02,
      envMapIntensity: 0.3,
    });
    const edgeMesh = new THREE.Mesh(edgeUndersideGeo, edgeMat);
    edgeMesh.receiveShadow = true;
    edgeMesh.castShadow = true;
    this.deskGroup.add(edgeMesh);
    this.disposables.push(edgeUndersideGeo, edgeMat);

    // Classic aged oak library underframe: deep apron rails, recessed study drawers, sturdy wooden legs & stretchers
    const woodFrameMat = new THREE.MeshStandardMaterial({
      color: 0x6b4424,
      roughness: 0.68,
      metalness: 0.03,
      envMapIntensity: 0.34,
    });
    const woodGeometries: THREE.BufferGeometry[] = [];
    const brassGeometries: THREE.BufferGeometry[] = [];
    const glideGeometries: THREE.BufferGeometry[] = [];

    const apronH = 0.68;
    const apronY = -TABLE_THICKNESS - apronH * 0.5;
    const spanX = legOffsetX * 2 + 0.36;
    const spanZ = legOffsetZ * 2 + 0.36;

    for (const sz of [-legOffsetZ, legOffsetZ]) {
      const rail = new THREE.BoxGeometry(spanX, apronH, 0.24);
      rail.translate(0, apronY, sz);
      woodGeometries.push(rail);
    }
    for (const sx of [-legOffsetX, legOffsetX]) {
      const rail = new THREE.BoxGeometry(0.24, apronH, spanZ);
      rail.translate(sx, apronY, 0);
      woodGeometries.push(rail);
    }

    // Two subtle front/back study drawer faces + aged brass cup pulls
    for (const sz of [-legOffsetZ - 0.14, legOffsetZ + 0.14]) {
      for (const dx of [-3.6, 3.6]) {
        const drawerFace = new THREE.BoxGeometry(4.2, 0.44, 0.06);
        drawerFace.translate(dx, apronY, sz);
        woodGeometries.push(drawerFace);

        const pullPlate = new THREE.BoxGeometry(0.55, 0.14, 0.05);
        pullPlate.translate(dx, apronY, sz + Math.sign(sz) * 0.045);
        brassGeometries.push(pullPlate);
      }
    }

    // Solid tapered square library legs + brass ferrules + felt glides
    const legTopY = -TABLE_THICKNESS;
    const legBotY = FLOOR_Y + 0.14;
    const legH = legTopY - legBotY;
    const legMidY = (legTopY + legBotY) * 0.5;

    for (const { x, z } of legSpecs) {
      const legGeo = new THREE.CylinderGeometry(0.32, 0.23, legH, 4);
      legGeo.rotateY(Math.PI * 0.25);
      legGeo.translate(x, legMidY, z);
      woodGeometries.push(legGeo);

      const ferrule = new THREE.CylinderGeometry(0.235, 0.22, 0.24, 4);
      ferrule.rotateY(Math.PI * 0.25);
      ferrule.translate(x, FLOOR_Y + 0.22, z);
      brassGeometries.push(ferrule);

      const glide = new THREE.CylinderGeometry(0.21, 0.22, 0.1, 8);
      glide.translate(x, FLOOR_Y + 0.05, z);
      glideGeometries.push(glide);
    }

    // Lower wooden H-stretchers
    const stretcherY = FLOOR_Y + 1.35;
    for (const sx of [-legOffsetX, legOffsetX]) {
      const sideBar = new THREE.BoxGeometry(0.18, 0.22, legOffsetZ * 2);
      sideBar.translate(sx, stretcherY, 0);
      woodGeometries.push(sideBar);
    }
    const centerBar = new THREE.BoxGeometry(legOffsetX * 2, 0.2, 0.22);
    centerBar.translate(0, stretcherY, 0);
    woodGeometries.push(centerBar);

    const mergedWoodGeo = BufferGeometryUtils.mergeGeometries(woodGeometries, false) ?? woodGeometries[0];
    for (const g of woodGeometries) if (g !== mergedWoodGeo) g.dispose();
    const woodMesh = new THREE.Mesh(mergedWoodGeo, woodFrameMat);
    woodMesh.castShadow = true;
    woodMesh.receiveShadow = true;
    this.deskGroup.add(woodMesh);
    this.disposables.push(mergedWoodGeo, woodFrameMat);

    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xb8924a,
      roughness: 0.36,
      metalness: 0.78,
      envMapIntensity: 0.7,
    });
    const mergedBrassGeo = BufferGeometryUtils.mergeGeometries(brassGeometries, false) ?? brassGeometries[0];
    for (const g of brassGeometries) if (g !== mergedBrassGeo) g.dispose();
    const brassMesh = new THREE.Mesh(mergedBrassGeo, brassMat);
    this.deskGroup.add(brassMesh);
    this.disposables.push(mergedBrassGeo, brassMat);

    const glideMat = new THREE.MeshStandardMaterial({
      color: 0x26211c,
      roughness: 0.92,
      metalness: 0.02,
    });
    const mergedGlideGeo = BufferGeometryUtils.mergeGeometries(glideGeometries, false) ?? glideGeometries[0];
    for (const g of glideGeometries) if (g !== mergedGlideGeo) g.dispose();
    const glideMesh = new THREE.Mesh(mergedGlideGeo, glideMat);
    this.deskGroup.add(glideMesh);
    this.disposables.push(mergedGlideGeo, glideMat);

    const shadowGeo = new THREE.PlaneGeometry(SHADOW_PLANE_W, SHADOW_PLANE_D);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: maps.contactShadow,
      transparent: true,
      opacity: 0.64,
      depthWrite: false,
    });
    const floorShadow = new THREE.Mesh(shadowGeo, shadowMat);
    floorShadow.rotation.x = -Math.PI * 0.5;
    floorShadow.position.set(0, FLOOR_Y + 0.015, 0);
    this.deskGroup.add(floorShadow);
    this.disposables.push(shadowGeo, shadowMat);
  }

  private buildLibraryBackdrop(maxAnisotropy: number): void {
    // 1. Warm oak parquet library floor
    const floorTex = createLibraryFloorTexture(maxAnisotropy);
    this.disposables.push(floorTex);
    const floorGeo = new THREE.PlaneGeometry(90, 90);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.76,
      metalness: 0.02,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI * 0.5;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.floorGroup.add(floor);
    this.disposables.push(floorGeo, floorMat);

    // 2. Warm parchment library back wall
    const wallGeo = new THREE.BoxGeometry(64, 24, 0.8);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xe6dac4,
      roughness: 0.9,
      metalness: 0.0,
    });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, FLOOR_Y + 12, -13.5);
    backWall.receiveShadow = true;
    this.wallGroup.add(backWall);
    this.disposables.push(wallGeo, wallMat);

    // 3. Wooden wainscot dado paneling & tall flanking bookshelves (merged wood geometry)
    const shelfWoodMat = new THREE.MeshStandardMaterial({
      color: 0x664022,
      roughness: 0.72,
      metalness: 0.03,
    });
    const shelfGeos: THREE.BufferGeometry[] = [];
    const bookBackGeos: THREE.BufferGeometry[] = [];

    // Baseboard + wainscot chair rail
    const baseboard = new THREE.BoxGeometry(64, 0.85, 0.9);
    baseboard.translate(0, FLOOR_Y + 0.425, -13.45);
    shelfGeos.push(baseboard);

    const dadoRail = new THREE.BoxGeometry(64, 0.28, 0.92);
    dadoRail.translate(0, FLOOR_Y + 3.4, -13.42);
    shelfGeos.push(dadoRail);

    // Lower wainscot backing band
    const wainscotBacking = new THREE.BoxGeometry(64, 2.8, 0.2);
    wainscotBacking.translate(0, FLOOR_Y + 1.9, -13.06);
    const wainscotMat = new THREE.MeshStandardMaterial({
      color: 0x7b5230,
      roughness: 0.78,
      metalness: 0.02,
    });
    const wainscotMesh = new THREE.Mesh(wainscotBacking, wainscotMat);
    this.wallGroup.add(wainscotMesh);
    this.disposables.push(wainscotBacking, wainscotMat);

    // Two library bookcases on left and right of center
    const shelfCentersX = [-10.8, 10.8];
    const shelfW = 8.4;
    const shelfBottomY = FLOOR_Y + 0.85;
    const shelfH = 12.2;
    const shelfD = 1.15;
    const shelfZ = -12.65;

    const bookPaletteGeos: THREE.BufferGeometry[][] = [[], [], []];

    for (const bx of shelfCentersX) {
      // Dark inner backing panel
      const back = new THREE.BoxGeometry(shelfW - 0.3, shelfH - 0.3, 0.14);
      back.translate(bx, shelfBottomY + shelfH * 0.5, shelfZ - shelfD * 0.42);
      bookBackGeos.push(back);

      // Left & right side stiles + crown + plinth
      for (const side of [-1, 1]) {
        const stile = new THREE.BoxGeometry(0.26, shelfH, shelfD);
        stile.translate(bx + side * (shelfW * 0.5 - 0.13), shelfBottomY + shelfH * 0.5, shelfZ);
        shelfGeos.push(stile);
      }
      const crown = new THREE.BoxGeometry(shelfW + 0.35, 0.42, shelfD + 0.18);
      crown.translate(bx, shelfBottomY + shelfH + 0.15, shelfZ + 0.04);
      shelfGeos.push(crown);

      // 5 horizontal shelves
      const levels = [0.2, 2.8, 5.4, 8.0, 10.6];
      for (let li = 0; li < levels.length; li++) {
        const sy = shelfBottomY + levels[li];
        const plank = new THREE.BoxGeometry(shelfW - 0.4, 0.2, shelfD - 0.06);
        plank.translate(bx, sy, shelfZ);
        shelfGeos.push(plank);

        // Add subtle stacked & standing vintage books on upper visible shelves
        if (li >= 1 && li <= 3) {
          let cursorX = bx - shelfW * 0.5 + 0.55;
          const endX = bx + shelfW * 0.5 - 0.55;
          let bookIdx = 0;
          while (cursorX < endX - 0.6) {
            // Every 5th group on middle shelf: a small neat horizontal book stack
            if (li === 2 && bookIdx === 5) {
              for (let st = 0; st < 3; st++) {
                const bw = 1.05 - st * 0.08;
                const bh = 0.24;
                const bGeo = new THREE.BoxGeometry(bw, bh, 0.72);
                bGeo.translate(cursorX + bw * 0.5, sy + 0.1 + st * bh + bh * 0.5, shelfZ + 0.06);
                bookPaletteGeos[(bookIdx + st) % 3].push(bGeo);
              }
              cursorX += 1.32;
              bookIdx++;
              continue;
            }
            const bw = 0.26 + ((bookIdx * 13 + li * 7) % 5) * 0.04;
            const bh = 1.48 + ((bookIdx * 17 + li * 11) % 6) * 0.12;
            const bd = 0.68 + ((bookIdx + li) % 3) * 0.05;
            const bGeo = new THREE.BoxGeometry(bw, bh, bd);
            bGeo.translate(cursorX + bw * 0.5, sy + 0.1 + bh * 0.5, shelfZ + 0.06);
            bookPaletteGeos[(bookIdx + li) % 3].push(bGeo);
            cursorX += bw + 0.035;
            bookIdx++;
          }
        }
      }
    }

    const mergedShelfGeo = BufferGeometryUtils.mergeGeometries(shelfGeos, false) ?? shelfGeos[0];
    for (const g of shelfGeos) if (g !== mergedShelfGeo) g.dispose();
    const shelfMesh = new THREE.Mesh(mergedShelfGeo, shelfWoodMat);
    this.wallGroup.add(shelfMesh);
    this.disposables.push(mergedShelfGeo, shelfWoodMat);

    const bookBackMat = new THREE.MeshStandardMaterial({
      color: 0x3b2615,
      roughness: 0.88,
      metalness: 0.02,
    });
    const mergedBookBackGeo = BufferGeometryUtils.mergeGeometries(bookBackGeos, false) ?? bookBackGeos[0];
    for (const g of bookBackGeos) if (g !== mergedBookBackGeo) g.dispose();
    const bookBackMesh = new THREE.Mesh(mergedBookBackGeo, bookBackMat);
    this.wallGroup.add(bookBackMesh);
    this.disposables.push(mergedBookBackGeo, bookBackMat);

    const bookColors = [0x6e3531, 0x3c5240, 0x3c4d63];
    for (let c = 0; c < 3; c++) {
      if (bookPaletteGeos[c].length === 0) continue;
      const bMat = new THREE.MeshStandardMaterial({
        color: bookColors[c],
        roughness: 0.82,
        metalness: 0.04,
      });
      const mergedBooks = BufferGeometryUtils.mergeGeometries(bookPaletteGeos[c], false) ?? bookPaletteGeos[c][0];
      for (const g of bookPaletteGeos[c]) if (g !== mergedBooks) g.dispose();
      const bMesh = new THREE.Mesh(mergedBooks, bMat);
      this.wallGroup.add(bMesh);
      this.disposables.push(mergedBooks, bMat);
    }

    // 4. Centered warm library window & brass sconce shades for quiet reading atmosphere
    const winFrameMat = new THREE.MeshStandardMaterial({
      color: 0x5c391e,
      roughness: 0.65,
      metalness: 0.05,
    });
    const wfOuter = new THREE.BoxGeometry(7.2, 8.2, 0.2);
    wfOuter.translate(0, FLOOR_Y + 9.2, -13.05);
    const wfV = new THREE.BoxGeometry(0.18, 7.4, 0.24);
    wfV.translate(0, FLOOR_Y + 9.2, -12.92);
    const wfH = new THREE.BoxGeometry(6.4, 0.18, 0.24);
    wfH.translate(0, FLOOR_Y + 9.4, -12.92);
    const mergedWinGeo = BufferGeometryUtils.mergeGeometries([wfOuter, wfV, wfH], false) ?? wfOuter;
    wfOuter.dispose();
    wfV.dispose();
    wfH.dispose();
    const winFrameMesh = new THREE.Mesh(mergedWinGeo, winFrameMat);
    this.wallGroup.add(winFrameMesh);
    this.disposables.push(mergedWinGeo, winFrameMat);

    const winPaneGeo = new THREE.PlaneGeometry(6.4, 7.4);
    const winPaneMat = new THREE.MeshBasicMaterial({ color: 0xfdf0d2 });
    const winPane = new THREE.Mesh(winPaneGeo, winPaneMat);
    winPane.position.set(0, FLOOR_Y + 9.2, -12.94);
    this.wallGroup.add(winPane);
    this.disposables.push(winPaneGeo, winPaneMat);

    // Warm brass reading sconce shades beside window
    const sconceShadeMat = new THREE.MeshStandardMaterial({
      color: 0xfbe5b6,
      emissive: 0xd99b43,
      emissiveIntensity: 0.35,
      roughness: 0.5,
      metalness: 0.05,
    });
    const sconceGeos: THREE.BufferGeometry[] = [];
    for (const sx of [-4.9, 4.9]) {
      const shade = new THREE.CylinderGeometry(0.28, 0.46, 0.56, 12);
      shade.translate(sx, FLOOR_Y + 9.2, -12.65);
      sconceGeos.push(shade);
    }
    const mergedSconce = BufferGeometryUtils.mergeGeometries(sconceGeos, false) ?? sconceGeos[0];
    for (const g of sconceGeos) if (g !== mergedSconce) g.dispose();
    const sconceMesh = new THREE.Mesh(mergedSconce, sconceShadeMat);
    this.wallGroup.add(sconceMesh);
    this.disposables.push(mergedSconce, sconceShadeMat);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ARENA 3: SCIENCE LAB
  // ══════════════════════════════════════════════════════════════════════════════

  private buildScienceLabBench(maxAnisotropy: number): void {
    const legOffsetX = TABLE_HALF_W - 0.92;
    const legOffsetZ = TABLE_HALF_D - 0.85;

    const legSpecs = [
      { x: -legOffsetX, z: -legOffsetZ },
      { x: legOffsetX, z: -legOffsetZ },
      { x: -legOffsetX, z: legOffsetZ },
      { x: legOffsetX, z: legOffsetZ },
    ];
    const legFootNormalizedPositions = legSpecs.map(({ x, z }) => ({
      nx: (x + SHADOW_PLANE_W * 0.5) / SHADOW_PLANE_W,
      nz: (z + SHADOW_PLANE_D * 0.5) / SHADOW_PLANE_D,
    }));

    const maps = createScienceLabSurfaceMaps(maxAnisotropy, legFootNormalizedPositions);
    this.disposables.push(
      maps.albedo,
      maps.roughness,
      maps.normal,
      maps.edgeUnderside,
      maps.contactShadow
    );

    const { topDeckGeo, edgeUndersideGeo } = this.createBeveledTabletopGeometries();

    const topMat = new THREE.MeshStandardMaterial({
      map: maps.albedo,
      roughnessMap: maps.roughness,
      roughness: 1.0,
      normalMap: maps.normal,
      normalScale: new THREE.Vector2(0.2, 0.2),
      metalness: 0.04,
      envMapIntensity: 0.45,
    });
    const tabletop = new THREE.Mesh(topDeckGeo, topMat);
    tabletop.receiveShadow = true;
    tabletop.castShadow = true;
    this.deskGroup.add(tabletop);
    this.disposables.push(topDeckGeo, topMat);

    const edgeMat = new THREE.MeshStandardMaterial({
      map: maps.edgeUnderside,
      roughness: 0.58,
      metalness: 0.14,
      envMapIntensity: 0.42,
    });
    const edgeMesh = new THREE.Mesh(edgeUndersideGeo, edgeMat);
    edgeMesh.receiveShadow = true;
    edgeMesh.castShadow = true;
    this.deskGroup.add(edgeMesh);
    this.disposables.push(edgeUndersideGeo, edgeMat);

    // Heavy-duty powder-coated steel laboratory support frame
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x383f47,
      roughness: 0.44,
      metalness: 0.62,
      envMapIntensity: 0.65,
    });
    const metalGeometries: THREE.BufferGeometry[] = [];
    const chromeGeometries: THREE.BufferGeometry[] = [];

    const railY = -TABLE_THICKNESS - 0.18;
    const spanX = legOffsetX * 2 + 0.3;
    const spanZ = legOffsetZ * 2 + 0.3;

    // Box-section top frame apron + mid cross-ribs
    for (const sz of [-legOffsetZ, legOffsetZ]) {
      const fb = new THREE.BoxGeometry(spanX, 0.34, 0.22);
      fb.translate(0, railY, sz);
      metalGeometries.push(fb);
    }
    for (const sx of [-legOffsetX, legOffsetX]) {
      const lr = new THREE.BoxGeometry(0.22, 0.34, spanZ);
      lr.translate(sx, railY, 0);
      metalGeometries.push(lr);
    }
    for (const rx of [-3.6, 0, 3.6]) {
      const rib = new THREE.BoxGeometry(0.14, 0.24, spanZ - 0.24);
      rib.translate(rx, railY + 0.04, 0);
      metalGeometries.push(rib);
    }

    // Heavy square steel legs + lower industrial stretcher frame + leveling feet
    const legTopY = -TABLE_THICKNESS;
    const legBotY = FLOOR_Y + 0.16;
    const legH = legTopY - legBotY;
    const legMidY = (legTopY + legBotY) * 0.5;

    for (const { x, z } of legSpecs) {
      const leg = new THREE.BoxGeometry(0.32, legH, 0.32);
      leg.translate(x, legMidY, z);
      metalGeometries.push(leg);

      // Steel gusset bracket
      const gusset = new THREE.BoxGeometry(0.56, 0.08, 0.56);
      gusset.translate(x, -TABLE_THICKNESS - 0.04, z);
      metalGeometries.push(gusset);

      // Brushed steel leveling stem & rubber foot pad
      const stem = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8);
      stem.translate(x, FLOOR_Y + 0.12, z);
      chromeGeometries.push(stem);

      const footPad = new THREE.CylinderGeometry(0.22, 0.24, 0.08, 12);
      footPad.translate(x, FLOOR_Y + 0.04, z);
      chromeGeometries.push(footPad);
    }

    // Lower steel H-frame crossbars
    const lowerRailY = FLOOR_Y + 1.25;
    for (const sx of [-legOffsetX, legOffsetX]) {
      const sideBar = new THREE.BoxGeometry(0.2, 0.2, legOffsetZ * 2);
      sideBar.translate(sx, lowerRailY, 0);
      metalGeometries.push(sideBar);
    }
    const longCrossBar = new THREE.BoxGeometry(legOffsetX * 2, 0.2, 0.2);
    longCrossBar.translate(0, lowerRailY, -legOffsetZ * 0.45);
    metalGeometries.push(longCrossBar);

    const mergedMetalGeo = BufferGeometryUtils.mergeGeometries(metalGeometries, false) ?? metalGeometries[0];
    for (const g of metalGeometries) if (g !== mergedMetalGeo) g.dispose();
    const metalMesh = new THREE.Mesh(mergedMetalGeo, frameMat);
    metalMesh.castShadow = true;
    metalMesh.receiveShadow = true;
    this.deskGroup.add(metalMesh);
    this.disposables.push(mergedMetalGeo, frameMat);

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0x9aa4ae,
      roughness: 0.32,
      metalness: 0.82,
      envMapIntensity: 0.75,
    });
    const mergedChromeGeo = BufferGeometryUtils.mergeGeometries(chromeGeometries, false) ?? chromeGeometries[0];
    for (const g of chromeGeometries) if (g !== mergedChromeGeo) g.dispose();
    const chromeMesh = new THREE.Mesh(mergedChromeGeo, chromeMat);
    this.deskGroup.add(chromeMesh);
    this.disposables.push(mergedChromeGeo, chromeMat);

    const shadowGeo = new THREE.PlaneGeometry(SHADOW_PLANE_W, SHADOW_PLANE_D);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: maps.contactShadow,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    const floorShadow = new THREE.Mesh(shadowGeo, shadowMat);
    floorShadow.rotation.x = -Math.PI * 0.5;
    floorShadow.position.set(0, FLOOR_Y + 0.015, 0);
    this.deskGroup.add(floorShadow);
    this.disposables.push(shadowGeo, shadowMat);
  }

  private createLabChartTexture(maxAnisotropy: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#f6f8fa';
    ctx.fillRect(0, 0, 512, 384);

    // Header band
    ctx.fillStyle = '#335c75';
    ctx.fillRect(16, 16, 480, 40);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PERIODIC REFERENCE · LAB SAFETY', 256, 42);

    // Simplified periodic table element cells (clean visual silhouette, no tiny unreadable clutter)
    const cols = 14;
    const cellW = 30;
    const cellH = 28;
    const startX = 46;
    const startY = 82;
    const groupColors = ['#dbeafe', '#dcfce7', '#fef3c7', '#e2e8f0', '#fae8ff'];

    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c > 0 && c < cols - 1) continue;
        if ((r === 1 || r === 2) && c > 1 && c < cols - 5) continue;
        const x = startX + c * (cellW + 2);
        const y = startY + r * (cellH + 2);
        ctx.fillStyle = groupColors[(c + r) % groupColors.length];
        ctx.fillRect(x, y, cellW, cellH);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cellW, cellH);
      }
    }

    // Lab safety strip along bottom
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(24, 300, 464, 58);
    ctx.strokeStyle = '#64748b';
    ctx.strokeRect(24, 300, 464, 58);
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('CALIBRATION STANDARD · 20°C · 101.3 kPa', 256, 334);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAnisotropy;
    this.disposables.push(tex);
    return tex;
  }

  private buildScienceLabBackdrop(maxAnisotropy: number): void {
    // 1. Clean speckled grey laboratory vinyl tile floor
    const floorTex = createScienceLabFloorTexture(maxAnisotropy);
    this.disposables.push(floorTex);
    const floorGeo = new THREE.PlaneGeometry(90, 90);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.78,
      metalness: 0.03,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI * 0.5;
    floor.position.y = FLOOR_Y;
    floor.receiveShadow = true;
    this.floorGroup.add(floor);
    this.disposables.push(floorGeo, floorMat);

    // 2. Clean neutral laboratory back wall + baseboard
    const wallGeo = new THREE.BoxGeometry(64, 24, 0.8);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xe6eaed,
      roughness: 0.88,
      metalness: 0.01,
    });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, FLOOR_Y + 12, -13.5);
    backWall.receiveShadow = true;
    this.wallGroup.add(backWall);
    this.disposables.push(wallGeo, wallMat);

    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x646e78,
      roughness: 0.62,
      metalness: 0.16,
    });
    const baseboard = new THREE.BoxGeometry(64, 0.7, 0.9);
    baseboard.translate(0, FLOOR_Y + 0.35, -13.45);
    const rail = new THREE.BoxGeometry(64, 0.16, 0.88);
    rail.translate(0, FLOOR_Y + 4.4, -13.42);
    const mergedTrim = BufferGeometryUtils.mergeGeometries([baseboard, rail], false) ?? baseboard;
    baseboard.dispose();
    rail.dispose();
    const trimMesh = new THREE.Mesh(mergedTrim, trimMat);
    this.wallGroup.add(trimMesh);
    this.disposables.push(mergedTrim, trimMat);

    // 3. Left wall-mounted & base laboratory cabinets (warm birch/laminate doors + steel handles)
    const cabBodyMat = new THREE.MeshStandardMaterial({
      color: 0xd0d5d9,
      roughness: 0.7,
      metalness: 0.08,
    });
    const cabDoorMat = new THREE.MeshStandardMaterial({
      color: 0xd8bd96,
      roughness: 0.66,
      metalness: 0.03,
    });
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x8b959e,
      roughness: 0.3,
      metalness: 0.85,
    });

    const cabBodyGeos: THREE.BufferGeometry[] = [];
    const cabDoorGeos: THREE.BufferGeometry[] = [];
    const handleGeos: THREE.BufferGeometry[] = [];

    // Upper wall cabinet bank on left
    const upperCab = new THREE.BoxGeometry(8.2, 3.6, 1.0);
    upperCab.translate(-10.8, FLOOR_Y + 10.6, -12.6);
    cabBodyGeos.push(upperCab);

    for (let i = 0; i < 4; i++) {
      const dx = -13.8 + i * 2.0;
      const door = new THREE.BoxGeometry(1.88, 3.32, 0.1);
      door.translate(dx, FLOOR_Y + 10.6, -12.06);
      cabDoorGeos.push(door);

      const handle = new THREE.BoxGeometry(0.08, 0.55, 0.08);
      const hSide = i % 2 === 0 ? 0.68 : -0.68;
      handle.translate(dx + hSide, FLOOR_Y + 10.1, -11.98);
      handleGeos.push(handle);
    }

    // Lower laboratory counter cabinet on left
    const lowerCab = new THREE.BoxGeometry(8.4, 3.8, 1.35);
    lowerCab.translate(-10.8, FLOOR_Y + 2.25, -12.42);
    cabBodyGeos.push(lowerCab);
    for (let i = 0; i < 4; i++) {
      const dx = -13.85 + i * 2.04;
      const door = new THREE.BoxGeometry(1.9, 2.75, 0.1);
      door.translate(dx, FLOOR_Y + 1.85, -11.7);
      cabDoorGeos.push(door);

      const handle = new THREE.BoxGeometry(0.08, 0.5, 0.08);
      handle.translate(dx + (i % 2 === 0 ? 0.68 : -0.68), FLOOR_Y + 2.55, -11.62);
      handleGeos.push(handle);
    }

    // Right wall-mounted open reagent shelves
    const shelfBoardMat = new THREE.MeshStandardMaterial({
      color: 0x7c8690,
      roughness: 0.52,
      metalness: 0.35,
    });
    const labShelfGeos: THREE.BufferGeometry[] = [];
    for (const sy of [FLOOR_Y + 8.0, FLOOR_Y + 10.4]) {
      const shelf = new THREE.BoxGeometry(7.2, 0.18, 0.95);
      shelf.translate(10.8, sy, -12.62);
      labShelfGeos.push(shelf);
    }
    for (const bx of [7.8, 13.8]) {
      const bracket = new THREE.BoxGeometry(0.14, 3.8, 0.22);
      bracket.translate(bx, FLOOR_Y + 9.2, -13.0);
      labShelfGeos.push(bracket);
    }
    const mergedLabShelf = BufferGeometryUtils.mergeGeometries(labShelfGeos, false) ?? labShelfGeos[0];
    for (const g of labShelfGeos) if (g !== mergedLabShelf) g.dispose();
    const labShelfMesh = new THREE.Mesh(mergedLabShelf, shelfBoardMat);
    this.wallGroup.add(labShelfMesh);
    this.disposables.push(mergedLabShelf, shelfBoardMat);

    // Lightweight stylized glassware & reagent jars on the back wall shelves (never on the workbench!)
    const glassGeos: THREE.BufferGeometry[] = [];
    const stopperGeos: THREE.BufferGeometry[] = [];
    const vesselXs = [8.4, 9.6, 11.1, 12.6];
    for (let i = 0; i < vesselXs.length; i++) {
      const vx = vesselXs[i];
      const baseY = FLOOR_Y + 8.09;
      if (i % 2 === 0) {
        // Erlenmeyer-style tapered flask
        const body = new THREE.CylinderGeometry(0.16, 0.42, 0.85, 10);
        body.translate(vx, baseY + 0.425, -12.55);
        glassGeos.push(body);
        const neck = new THREE.CylinderGeometry(0.14, 0.16, 0.32, 10);
        neck.translate(vx, baseY + 1.0, -12.55);
        glassGeos.push(neck);
      } else {
        // Cylindrical beaker / reagent bottle
        const jar = new THREE.CylinderGeometry(0.32, 0.32, 0.92, 10);
        jar.translate(vx, baseY + 0.46, -12.55);
        glassGeos.push(jar);
        const cap = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 10);
        cap.translate(vx, baseY + 1.0, -12.55);
        stopperGeos.push(cap);
      }
    }
    // Upper shelf jars
    for (const vx of [8.9, 10.4, 12.1]) {
      const baseY = FLOOR_Y + 10.49;
      const jar = new THREE.CylinderGeometry(0.28, 0.28, 0.82, 10);
      jar.translate(vx, baseY + 0.41, -12.55);
      glassGeos.push(jar);
      const cap = new THREE.CylinderGeometry(0.22, 0.22, 0.14, 10);
      cap.translate(vx, baseY + 0.89, -12.55);
      stopperGeos.push(cap);
    }

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xcbe5ef,
      roughness: 0.22,
      metalness: 0.08,
      transparent: true,
      opacity: 0.78,
    });
    const mergedGlass = BufferGeometryUtils.mergeGeometries(glassGeos, false) ?? glassGeos[0];
    for (const g of glassGeos) if (g !== mergedGlass) g.dispose();
    const glassMesh = new THREE.Mesh(mergedGlass, glassMat);
    this.wallGroup.add(glassMesh);
    this.disposables.push(mergedGlass, glassMat);

    const stopperMat = new THREE.MeshStandardMaterial({
      color: 0x3b4956,
      roughness: 0.6,
      metalness: 0.1,
    });
    const mergedStopper = BufferGeometryUtils.mergeGeometries(stopperGeos, false) ?? stopperGeos[0];
    for (const g of stopperGeos) if (g !== mergedStopper) g.dispose();
    const stopperMesh = new THREE.Mesh(mergedStopper, stopperMat);
    this.wallGroup.add(stopperMesh);
    this.disposables.push(mergedStopper, stopperMat);

    const mergedCabBody = BufferGeometryUtils.mergeGeometries(cabBodyGeos, false) ?? cabBodyGeos[0];
    for (const g of cabBodyGeos) if (g !== mergedCabBody) g.dispose();
    const cabBodyMesh = new THREE.Mesh(mergedCabBody, cabBodyMat);
    this.wallGroup.add(cabBodyMesh);
    this.disposables.push(mergedCabBody, cabBodyMat);

    const mergedCabDoor = BufferGeometryUtils.mergeGeometries(cabDoorGeos, false) ?? cabDoorGeos[0];
    for (const g of cabDoorGeos) if (g !== mergedCabDoor) g.dispose();
    const cabDoorMesh = new THREE.Mesh(mergedCabDoor, cabDoorMat);
    this.wallGroup.add(cabDoorMesh);
    this.disposables.push(mergedCabDoor, cabDoorMat);

    const mergedHandles = BufferGeometryUtils.mergeGeometries(handleGeos, false) ?? handleGeos[0];
    for (const g of handleGeos) if (g !== mergedHandles) g.dispose();
    const handlesMesh = new THREE.Mesh(mergedHandles, handleMat);
    this.wallGroup.add(handlesMesh);
    this.disposables.push(mergedHandles, handleMat);

    // 4. Centered Periodic / Lab Reference Chart on back wall
    const chartTex = this.createLabChartTexture(maxAnisotropy);
    const chartFrameGeo = new THREE.BoxGeometry(8.8, 6.4, 0.14);
    const chartFrameMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.5,
      metalness: 0.35,
    });
    const chartFrame = new THREE.Mesh(chartFrameGeo, chartFrameMat);
    chartFrame.position.set(0, FLOOR_Y + 9.2, -13.06);
    this.wallGroup.add(chartFrame);
    this.disposables.push(chartFrameGeo, chartFrameMat);

    const chartFaceGeo = new THREE.PlaneGeometry(8.2, 5.8);
    const chartFaceMat = new THREE.MeshStandardMaterial({
      map: chartTex,
      roughness: 0.78,
      metalness: 0.02,
    });
    const chartFace = new THREE.Mesh(chartFaceGeo, chartFaceMat);
    chartFace.position.set(0, FLOOR_Y + 9.2, -12.98);
    this.wallGroup.add(chartFace);
    this.disposables.push(chartFaceGeo, chartFaceMat);
  }

  public dispose(): void {
    this.clearArenaMeshes();
  }
}
