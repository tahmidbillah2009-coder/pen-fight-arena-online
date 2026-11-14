import * as THREE from 'three';

/** Deterministic Mulberry32 PRNG so classroom wear stays consistent across sessions. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export interface DeskSurfaceMaps {
  albedo: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  edgeUnderside: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
}

/**
 * Generates coordinated PBR textures for a lived-in wooden classroom desk:
 * - Multi-plank oak/beech butcher-block wood grain with natural plank color shifts & seams
 * - Palm-rubbed varnish wear, matte scuffed corners, faint cup halo & sun fading
 * - Fine scratches, pinprick dents, faint ballpoint ink spots, erased graphite smudges & subtle margin scribbles
 * - Matched roughness map (smooth palm-worn satin vs dull scratched varnish)
 * - Tangent-space normal map computed via Sobel gradient from a synchronized height canvas
 * - Laminated edge & underside wood patina texture
 * - Combined desk + 4-leg floor contact shadow texture
 */
export function createDeskSurfaceMaps(
  maxAnisotropy: number,
  legFootNormalizedPositions: Array<{ nx: number; nz: number }>
): DeskSurfaceMaps {
  const rng = createRng(4827193);

  const SIZE = 1024;
  const DATA_SIZE = 512;
  const DS = DATA_SIZE / SIZE; // 0.5 scale factor between albedo and roughness/height canvases

  // 1. Albedo canvas (SRGB)
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = SIZE;
  albedoCanvas.height = SIZE;
  const aCtx = albedoCanvas.getContext('2d')!;

  // 2. Roughness canvas (linear: 0 = glossy, 255 = matte)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = DATA_SIZE;
  roughCanvas.height = DATA_SIZE;
  const rCtx = roughCanvas.getContext('2d')!;

  // 3. Height canvas (linear: 128 = flat, <128 recessed groove/dent/scratch, >128 raised fiber)
  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = DATA_SIZE;
  heightCanvas.height = DATA_SIZE;
  const hCtx = heightCanvas.getContext('2d')!;

  // Base varnish roughness (~0.64 satin school lacquer) & neutral height
  rCtx.fillStyle = 'rgb(164, 164, 164)';
  rCtx.fillRect(0, 0, DATA_SIZE, DATA_SIZE);

  hCtx.fillStyle = 'rgb(128, 128, 128)';
  hCtx.fillRect(0, 0, DATA_SIZE, DATA_SIZE);

  // --- A. Butcher-block oak/beech planks along X axis ---
  const plankBounds = [0, 168, 344, 514, 686, 854, SIZE];
  const plankPalettes: Array<[string, string, string]> = [
    ['#c6915a', '#bc854d', '#b37b44'],
    ['#bd864f', '#b47c45', '#ab743e'],
    ['#c99660', '#c08b53', '#b68049'],
    ['#be8851', '#b67e48', '#ad7641'],
    ['#c48f58', '#ba834c', '#b07943'],
    ['#b9824b', '#b07842', '#a8713c'],
  ];

  for (let p = 0; p < plankBounds.length - 1; p++) {
    const y0 = plankBounds[p];
    const y1 = plankBounds[p + 1];
    const ph = y1 - y0;
    const [c0, c1, c2] = plankPalettes[p % plankPalettes.length];

    const grad = aCtx.createLinearGradient(0, y0, SIZE, y1);
    grad.addColorStop(0, c0);
    grad.addColorStop(0.55, c1);
    grad.addColorStop(1, c2);
    aCtx.fillStyle = grad;
    aCtx.fillRect(0, y0, SIZE, ph);

    // Subtle board-to-board roughness shift
    const plankRough = clampByte(156 + (rng() - 0.5) * 18);
    rCtx.fillStyle = `rgb(${plankRough}, ${plankRough}, ${plankRough})`;
    rCtx.fillRect(0, y0 * DS, DATA_SIZE, ph * DS);

    // Wood grain fibers within plank
    const fiberCount = Math.floor(ph * 0.72);
    for (let f = 0; f < fiberCount; f++) {
      const fy = y0 + 2 + (f / fiberCount) * (ph - 4) + (rng() - 0.5) * 2.5;
      const isDark = rng() < 0.62;
      const alpha = isDark ? 0.035 + rng() * 0.065 : 0.025 + rng() * 0.045;
      aCtx.strokeStyle = isDark ? `rgba(82, 46, 19, ${alpha})` : `rgba(240, 206, 158, ${alpha})`;
      aCtx.lineWidth = 0.8 + rng() * 2.2;

      const waveA = (rng() - 0.5) * 12;
      const waveB = (rng() - 0.5) * 12;
      const endDy = (rng() - 0.5) * 6;
      aCtx.beginPath();
      aCtx.moveTo(0, fy);
      aCtx.bezierCurveTo(340, fy + waveA, 680, fy + waveB, SIZE, fy + endDy);
      aCtx.stroke();

      // Mirror stronger grain waves lightly into height canvas for tactile wood grain normal
      if (f % 3 === 0) {
        const hv = isDark ? 120 : 134;
        hCtx.strokeStyle = `rgba(${hv}, ${hv}, ${hv}, 0.24)`;
        hCtx.lineWidth = 0.9;
        hCtx.beginPath();
        hCtx.moveTo(0, fy * DS);
        hCtx.bezierCurveTo(
          340 * DS,
          (fy + waveA) * DS,
          680 * DS,
          (fy + waveB) * DS,
          DATA_SIZE,
          (fy + endDy) * DS
        );
        hCtx.stroke();
      }
    }

    // Subtle cathedral / growth ring arches on select planks
    if (p === 1 || p === 3 || p === 4) {
      const cx = 180 + rng() * 640;
      const cy = y0 + ph * (0.35 + rng() * 0.3);
      for (let r = 0; r < 9; r++) {
        const rx = 65 + r * 32;
        const ry = 10 + r * 5.2;
        aCtx.strokeStyle = `rgba(92, 52, 22, ${0.045 - r * 0.003})`;
        aCtx.lineWidth = 1.3;
        aCtx.beginPath();
        aCtx.ellipse(cx, cy, rx, ry, (rng() - 0.5) * 0.04, 0, Math.PI * 2);
        aCtx.stroke();
      }
    }

    // Fine horizontal oak pore flecks
    for (let k = 0; k < 140; k++) {
      const px = rng() * SIZE;
      const py = y0 + 3 + rng() * (ph - 6);
      const len = 3 + rng() * 11;
      aCtx.fillStyle = `rgba(74, 41, 16, ${0.07 + rng() * 0.09})`;
      aCtx.fillRect(px, py, len, 1.1);
      if (k % 2 === 0) {
        hCtx.fillStyle = 'rgba(104, 104, 104, 0.35)';
        hCtx.fillRect(px * DS, py * DS, Math.max(1.2, len * DS), 0.9);
      }
    }
  }

  // Plank glue joints
  for (let p = 1; p < plankBounds.length - 1; p++) {
    const sy = plankBounds[p];
    aCtx.fillStyle = 'rgba(62, 34, 14, 0.26)';
    aCtx.fillRect(0, sy - 0.8, SIZE, 1.6);
    aCtx.fillStyle = 'rgba(236, 202, 152, 0.12)';
    aCtx.fillRect(0, sy + 1, SIZE, 1.2);

    hCtx.fillStyle = 'rgba(92, 92, 92, 0.55)';
    hCtx.fillRect(0, sy * DS - 0.6, DATA_SIZE, 1.3);

    rCtx.fillStyle = 'rgba(208, 208, 208, 0.55)';
    rCtx.fillRect(0, sy * DS - 0.8, DATA_SIZE, 1.8);
  }

  // Two subtle tight wood knots in outer margins (realistic timber character without clutter)
  const knots = [
    { x: 145, y: 245, rx: 14, ry: 7.5 },
    { x: 855, y: 765, rx: 12, ry: 6.5 },
  ];
  for (const knot of knots) {
    for (let ring = 4; ring >= 1; ring--) {
      const s = ring / 4;
      aCtx.fillStyle = ring === 1 ? 'rgba(64, 34, 14, 0.42)' : `rgba(88, 49, 21, ${0.14})`;
      aCtx.beginPath();
      aCtx.ellipse(knot.x, knot.y, knot.rx * s, knot.ry * s, 0.08, 0, Math.PI * 2);
      aCtx.fill();
    }
    rCtx.fillStyle = 'rgba(195, 195, 195, 0.35)';
    rCtx.beginPath();
    rCtx.ellipse(knot.x * DS, knot.y * DS, knot.rx * DS, knot.ry * DS, 0.08, 0, Math.PI * 2);
    rCtx.fill();
  }

  // --- B. Uneven aging, palm/wrist wear zones & perimeter patina ---
  // Soft perimeter aging & slightly sun-faded center
  const edgeShade = aCtx.createRadialGradient(512, 512, 210, 512, 512, 740);
  edgeShade.addColorStop(0, 'rgba(248, 224, 185, 0.07)');
  edgeShade.addColorStop(0.62, 'rgba(180, 124, 70, 0.0)');
  edgeShade.addColorStop(1, 'rgba(64, 36, 15, 0.19)');
  aCtx.fillStyle = edgeShade;
  aCtx.fillRect(0, 0, SIZE, SIZE);

  // Frequently touched palm / wrist wear zones (soft faded color & smoother satin sheen)
  const wearZones = [
    { x: 255, y: 690, r: 175, fadeAlpha: 0.085, roughRgb: 128 },
    { x: 765, y: 335, r: 165, fadeAlpha: 0.075, roughRgb: 132 },
    { x: 510, y: 845, r: 190, fadeAlpha: 0.07, roughRgb: 134 },
  ];
  for (const wz of wearZones) {
    const wg = aCtx.createRadialGradient(wz.x, wz.y, 18, wz.x, wz.y, wz.r);
    wg.addColorStop(0, `rgba(236, 200, 152, ${wz.fadeAlpha})`);
    wg.addColorStop(1, 'rgba(236, 200, 152, 0)');
    aCtx.fillStyle = wg;
    aCtx.fillRect(wz.x - wz.r, wz.y - wz.r, wz.r * 2, wz.r * 2);

    const rg = rCtx.createRadialGradient(
      wz.x * DS,
      wz.y * DS,
      10,
      wz.x * DS,
      wz.y * DS,
      wz.r * DS
    );
    rg.addColorStop(0, `rgba(${wz.roughRgb}, ${wz.roughRgb}, ${wz.roughRgb}, 0.55)`);
    rg.addColorStop(1, `rgba(${wz.roughRgb}, ${wz.roughRgb}, ${wz.roughRgb}, 0)`);
    rCtx.fillStyle = rg;
    rCtx.fillRect((wz.x - wz.r) * DS, (wz.y - wz.r) * DS, wz.r * 2 * DS, wz.r * 2 * DS);
  }

  // Worn matte varnish scuff patches near corners & edges
  const scuffCorners = [
    { x: 72, y: 72, r: 95 },
    { x: 952, y: 78, r: 90 },
    { x: 78, y: 948, r: 105 },
    { x: 945, y: 945, r: 100 },
  ];
  for (const sc of scuffCorners) {
    const sg = aCtx.createRadialGradient(sc.x, sc.y, 8, sc.x, sc.y, sc.r);
    sg.addColorStop(0, 'rgba(220, 182, 134, 0.14)');
    sg.addColorStop(1, 'rgba(220, 182, 134, 0)');
    aCtx.fillStyle = sg;
    aCtx.fillRect(sc.x - sc.r, sc.y - sc.r, sc.r * 2, sc.r * 2);

    const srg = rCtx.createRadialGradient(sc.x * DS, sc.y * DS, 4, sc.x * DS, sc.y * DS, sc.r * DS);
    srg.addColorStop(0, 'rgba(222, 222, 222, 0.72)');
    srg.addColorStop(1, 'rgba(222, 222, 222, 0)');
    rCtx.fillStyle = srg;
    rCtx.fillRect((sc.x - sc.r) * DS, (sc.y - sc.r) * DS, sc.r * 2 * DS, sc.r * 2 * DS);
  }

  // Subtle old water-cup condensation halo near upper-right corner
  aCtx.strokeStyle = 'rgba(78, 46, 22, 0.075)';
  aCtx.lineWidth = 3.2;
  aCtx.beginPath();
  aCtx.arc(886, 138, 34, 0.2, Math.PI * 1.88);
  aCtx.stroke();
  rCtx.strokeStyle = 'rgba(205, 205, 205, 0.35)';
  rCtx.lineWidth = 2;
  rCtx.beginPath();
  rCtx.arc(886 * DS, 138 * DS, 34 * DS, 0.2, Math.PI * 1.88);
  rCtx.stroke();

  // --- C. Engraved classroom desk arena markings (preserved subtly & tactilely) ---
  // Carved outer border groove
  aCtx.strokeStyle = 'rgba(66, 36, 15, 0.25)';
  aCtx.lineWidth = 3.6;
  aCtx.strokeRect(24, 24, 976, 976);
  hCtx.strokeStyle = 'rgba(84, 84, 84, 0.65)';
  hCtx.lineWidth = 2.0;
  hCtx.strokeRect(24 * DS, 24 * DS, 976 * DS, 976 * DS);

  // Faint center divider line (subtly rubbed in the middle)
  aCtx.strokeStyle = 'rgba(246, 232, 206, 0.16)';
  aCtx.lineWidth = 2;
  aCtx.setLineDash([12, 12]);
  aCtx.beginPath();
  aCtx.moveTo(512, 36);
  aCtx.lineTo(512, 988);
  aCtx.stroke();
  aCtx.setLineDash([]);

  // Subtle carved ruler ticks along front edge
  aCtx.fillStyle = 'rgba(62, 33, 14, 0.34)';
  hCtx.fillStyle = 'rgba(90, 90, 90, 0.5)';
  for (let x = 64; x <= 960; x += 28) {
    const tall = (x - 64) % 140 === 0 ? 18 : 10;
    aCtx.fillRect(x, 986 - tall, 2, tall);
    hCtx.fillRect(x * DS, (986 - tall) * DS, 1.2, tall * DS);
  }

  // --- D. Scratches, dents, old writing impressions, pencil/ink marks & corner doodles ---
  // 1. Hairline surface scratches (most dense near front & edges, sparse in center)
  for (let i = 0; i < 68; i++) {
    // Bias ~60% of scratches toward edges/front while keeping natural random scatter
    let sx = 30 + rng() * 964;
    let sy = 30 + rng() * 964;
    if (i % 5 !== 0) {
      if (rng() < 0.5) {
        sy = rng() < 0.65 ? 720 + rng() * 270 : 35 + rng() * 210;
      } else {
        sx = rng() < 0.5 ? 35 + rng() * 230 : 760 + rng() * 230;
      }
    }
    const len = 14 + rng() * 58;
    const angle = (rng() - 0.5) * Math.PI;
    const ex = sx + Math.cos(angle) * len;
    const ey = sy + Math.sin(angle) * len;
    const mx = (sx + ex) * 0.5 + (rng() - 0.5) * 6;
    const my = (sy + ey) * 0.5 + (rng() - 0.5) * 6;

    const freshScratch = rng() < 0.45;
    aCtx.strokeStyle = freshScratch
      ? `rgba(235, 198, 146, ${0.14 + rng() * 0.12})`
      : `rgba(74, 42, 18, ${0.12 + rng() * 0.14})`;
    aCtx.lineWidth = 0.7 + rng() * 0.9;
    aCtx.beginPath();
    aCtx.moveTo(sx, sy);
    aCtx.quadraticCurveTo(mx, my, ex, ey);
    aCtx.stroke();

    // Recessed groove in height + matte varnish break in roughness
    hCtx.strokeStyle = 'rgba(72, 72, 72, 0.5)';
    hCtx.lineWidth = 0.8 + rng() * 0.5;
    hCtx.beginPath();
    hCtx.moveTo(sx * DS, sy * DS);
    hCtx.quadraticCurveTo(mx * DS, my * DS, ex * DS, ey * DS);
    hCtx.stroke();

    rCtx.strokeStyle = 'rgba(225, 225, 225, 0.5)';
    rCtx.lineWidth = 1.1;
    rCtx.beginPath();
    rCtx.moveTo(sx * DS, sy * DS);
    rCtx.quadraticCurveTo(mx * DS, my * DS, ex * DS, ey * DS);
    rCtx.stroke();
  }

  // 2. Tiny surface dents & compass pinpricks
  for (let d = 0; d < 28; d++) {
    const dx = 45 + rng() * 934;
    const dy = 45 + rng() * 934;
    const radius = 1.2 + rng() * 2.4;

    aCtx.fillStyle = `rgba(68, 38, 16, ${0.16 + rng() * 0.16})`;
    aCtx.beginPath();
    aCtx.ellipse(dx, dy, radius, radius * (0.65 + rng() * 0.45), rng() * Math.PI, 0, Math.PI * 2);
    aCtx.fill();

    hCtx.fillStyle = 'rgba(54, 54, 54, 0.65)';
    hCtx.beginPath();
    hCtx.arc(dx * DS, dy * DS, Math.max(1.0, radius * DS), 0, Math.PI * 2);
    hCtx.fill();

    rCtx.fillStyle = 'rgba(218, 218, 218, 0.55)';
    rCtx.beginPath();
    rCtx.arc(dx * DS, dy * DS, Math.max(1.1, radius * DS * 1.2), 0, Math.PI * 2);
    rCtx.fill();
  }

  // 3. Faint old writing impressions (groove-only micro strokes in height + faint darkening)
  for (let w = 0; w < 10; w++) {
    const wx = 120 + rng() * 760;
    const wy = 110 + rng() * 800;
    const strokeCount = 3 + Math.floor(rng() * 4);
    for (let s = 0; s < strokeCount; s++) {
      const ox = wx + s * 10;
      const oy = wy + (rng() - 0.5) * 4;
      hCtx.strokeStyle = 'rgba(98, 98, 98, 0.35)';
      hCtx.lineWidth = 0.85;
      hCtx.beginPath();
      hCtx.moveTo(ox * DS, oy * DS);
      hCtx.quadraticCurveTo((ox + 4) * DS, (oy - 6) * DS, (ox + 8) * DS, (oy + 1) * DS);
      hCtx.stroke();

      aCtx.strokeStyle = 'rgba(84, 49, 22, 0.045)';
      aCtx.lineWidth = 1.0;
      aCtx.beginPath();
      aCtx.moveTo(ox, oy);
      aCtx.quadraticCurveTo(ox + 4, oy - 6, ox + 8, oy + 1);
      aCtx.stroke();
    }
  }

  // 4. Faint blue & black ballpoint ink dots/smudges (very subtle, authentic wear)
  const inkSpots = [
    { x: 162, y: 814, r: 4.5, blue: true, smudge: true },
    { x: 171, y: 821, r: 2.2, blue: true, smudge: false },
    { x: 834, y: 205, r: 3.4, blue: true, smudge: true },
    { x: 742, y: 888, r: 2.8, blue: false, smudge: true },
    { x: 288, y: 118, r: 2.3, blue: false, smudge: false },
  ];
  for (const ink of inkSpots) {
    const col = ink.blue ? '28, 62, 138' : '32, 34, 42';
    aCtx.fillStyle = `rgba(${col}, 0.17)`;
    aCtx.beginPath();
    aCtx.arc(ink.x, ink.y, ink.r, 0, Math.PI * 2);
    aCtx.fill();

    if (ink.smudge) {
      const sg = aCtx.createRadialGradient(ink.x + 5, ink.y + 2, 1, ink.x + 5, ink.y + 2, ink.r * 3.8);
      sg.addColorStop(0, `rgba(${col}, 0.09)`);
      sg.addColorStop(1, `rgba(${col}, 0)`);
      aCtx.fillStyle = sg;
      aCtx.fillRect(ink.x - ink.r * 3, ink.y - ink.r * 3, ink.r * 8, ink.r * 8);
    }
  }

  // Tiny faint pen test scribble loop near front-left margin
  aCtx.strokeStyle = 'rgba(30, 64, 142, 0.14)';
  aCtx.lineWidth = 1.1;
  aCtx.beginPath();
  aCtx.moveTo(108, 864);
  aCtx.bezierCurveTo(118, 855, 132, 872, 120, 876);
  aCtx.bezierCurveTo(108, 879, 122, 858, 138, 865);
  aCtx.stroke();

  // 5. Faint graphite pencil marks, erased rubber smudge & subtle corner geometry/tallies
  // Erased smudge smear near lower-left
  const eraserGrad = aCtx.createLinearGradient(145, 735, 225, 765);
  eraserGrad.addColorStop(0, 'rgba(65, 62, 58, 0.0)');
  eraserGrad.addColorStop(0.45, 'rgba(65, 62, 58, 0.085)');
  eraserGrad.addColorStop(1, 'rgba(65, 62, 58, 0.0)');
  aCtx.fillStyle = eraserGrad;
  aCtx.beginPath();
  aCtx.ellipse(185, 750, 42, 13, -0.22, 0, Math.PI * 2);
  aCtx.fill();

  // Faint tiny pencil right-triangle geometry doodle near upper-left corner
  aCtx.strokeStyle = 'rgba(56, 54, 50, 0.13)';
  aCtx.lineWidth = 1.2;
  aCtx.beginPath();
  aCtx.moveTo(86, 112);
  aCtx.lineTo(86, 152);
  aCtx.lineTo(134, 152);
  aCtx.closePath();
  aCtx.stroke();
  // tiny right-angle square
  aCtx.strokeRect(86, 143, 9, 9);

  // Faint compass arc near upper-right edge
  aCtx.strokeStyle = 'rgba(58, 55, 50, 0.11)';
  aCtx.lineWidth = 1.0;
  aCtx.beginPath();
  aCtx.arc(898, 842, 24, Math.PI * 0.85, Math.PI * 1.65);
  aCtx.stroke();

  // Faint 5-bar pencil tally marks near lower-right corner
  aCtx.strokeStyle = 'rgba(56, 52, 46, 0.14)';
  aCtx.lineWidth = 1.2;
  for (let t = 0; t < 4; t++) {
    const tx = 865 + t * 6;
    aCtx.beginPath();
    aCtx.moveTo(tx, 902);
    aCtx.lineTo(tx - 1, 922);
    aCtx.stroke();
  }
  aCtx.beginPath();
  aCtx.moveTo(860, 918);
  aCtx.lineTo(888, 905);
  aCtx.stroke();

  // Thin stray graphite pencil lines near margins
  aCtx.strokeStyle = 'rgba(55, 52, 48, 0.11)';
  aCtx.lineWidth = 1.0;
  aCtx.beginPath();
  aCtx.moveTo(712, 86);
  aCtx.lineTo(768, 82);
  aCtx.moveTo(222, 932);
  aCtx.lineTo(265, 929);
  aCtx.stroke();

  // --- Build Sobel Tangent-Space Normal Map from heightCanvas ---
  const normalCanvas = buildNormalCanvasFromHeight(heightCanvas, 2.2);

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = maxAnisotropy;

  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.anisotropy = maxAnisotropy;

  const normal = new THREE.CanvasTexture(normalCanvas);
  normal.anisotropy = maxAnisotropy;

  const edgeUnderside = createEdgeAndUndersideTexture(maxAnisotropy);
  const contactShadow = createDeskAndLegShadowTexture(legFootNormalizedPositions);

  return { albedo, roughness, normal, edgeUnderside, contactShadow };
}

function buildNormalCanvasFromHeight(heightCanvas: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = heightCanvas.width;
  const h = heightCanvas.height;
  const srcCtx = heightCanvas.getContext('2d')!;
  const src = srcCtx.getImageData(0, 0, w, h).data;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d')!;
  const outImg = outCtx.createImageData(w, h);
  const dst = outImg.data;

  const sample = (x: number, y: number): number => {
    const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return src[(cy * w + cx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dX = tr + 2 * r + br - (tl + 2 * l + bl);
      const dY = bl + 2 * b + br - (tl + 2 * t + tr);

      let nx = -dX * strength;
      let ny = -dY * strength;
      let nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * w + x) * 4;
      dst[idx] = clampByte((nx * 0.5 + 0.5) * 255);
      dst[idx + 1] = clampByte((ny * 0.5 + 0.5) * 255);
      dst[idx + 2] = clampByte((nz * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return outCanvas;
}

/**
 * Generates an edge & underside texture:
 * - Upper half (v: 0..0.5): laminated beech/oak edge banding with corner scuffs & chipped varnish
 * - Lower half (v: 0.5..1): darker unfinished school-desk underside wood ply
 */
function createEdgeAndUndersideTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const rng = createRng(99123);
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Edge banding region (top half of canvas -> v in [0.5, 1.0] in Three.js bottom-up UV)
  const edgeGrad = ctx.createLinearGradient(0, 0, 0, 128);
  edgeGrad.addColorStop(0, '#9a683a');
  edgeGrad.addColorStop(0.45, '#8c5c31');
  edgeGrad.addColorStop(1, '#714724');
  ctx.fillStyle = edgeGrad;
  ctx.fillRect(0, 0, w, 128);

  // Subtle horizontal laminated veneer lines
  for (let i = 0; i < 16; i++) {
    const ly = 6 + i * 7.5 + (rng() - 0.5) * 2;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(65, 38, 16, 0.18)' : 'rgba(214, 174, 122, 0.14)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.lineTo(w, ly + (rng() - 0.5) * 3);
    ctx.stroke();
  }

  // Worn edge scuffs & tiny varnish chips along top lip of side edge
  for (let c = 0; c < 26; c++) {
    const cx = rng() * w;
    const cy = 6 + rng() * 34;
    const cw = 3 + rng() * 14;
    const ch = 2 + rng() * 6;
    ctx.fillStyle = rng() < 0.6 ? 'rgba(222, 186, 138, 0.24)' : 'rgba(58, 34, 14, 0.24)';
    ctx.fillRect(cx, cy, cw, ch);
  }

  // Underside raw wood / particleboard panel (bottom half -> v in [0, 0.5])
  ctx.fillStyle = '#7b5839';
  ctx.fillRect(0, 128, w, 128);
  for (let i = 0; i < 240; i++) {
    const px = rng() * w;
    const py = 130 + rng() * 124;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(58, 38, 22, 0.18)' : 'rgba(176, 138, 98, 0.14)';
    ctx.fillRect(px, py, 3 + rng() * 10, 1.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Generates a single 512x512 floor shadow texture containing both:
 * - Broad soft rectangular ambient shadow under the desk
 * - Four crisp contact-shadow pools aligned with the flared tubular desk feet
 */
function createDeskAndLegShadowTexture(
  legFootNormalizedPositions: Array<{ nx: number; nz: number }>
): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Broad soft ambient desk shadow
  const deskShadow = ctx.createRadialGradient(256, 256, 48, 256, 256, 245);
  deskShadow.addColorStop(0, 'rgba(24, 16, 10, 0.42)');
  deskShadow.addColorStop(0.58, 'rgba(24, 16, 10, 0.22)');
  deskShadow.addColorStop(1, 'rgba(24, 16, 10, 0)');
  ctx.fillStyle = deskShadow;
  ctx.fillRect(0, 0, size, size);

  // Per-leg contact shadow pools
  for (const { nx, nz } of legFootNormalizedPositions) {
    const cx = nx * size;
    const cy = nz * size;
    const footGrad = ctx.createRadialGradient(cx, cy, 3, cx, cy, 34);
    footGrad.addColorStop(0, 'rgba(18, 12, 8, 0.72)');
    footGrad.addColorStop(0.35, 'rgba(18, 12, 8, 0.36)');
    footGrad.addColorStop(1, 'rgba(18, 12, 8, 0)');
    ctx.fillStyle = footGrad;
    ctx.fillRect(cx - 38, cy - 38, 76, 76);
  }

  return new THREE.CanvasTexture(canvas);
}

/** Subtle matte classroom vinyl floor tile texture with realistic tile flecks & slight wear. */
export function createClassroomFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const rng = createRng(77319);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#d3c6b2';
  ctx.fillRect(0, 0, 512, 512);

  const tileSize = 128;
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 4; gy++) {
      const shade = (gx + gy) % 2 === 0 ? '#d8cbb8' : '#cec0ac';
      ctx.fillStyle = shade;
      ctx.fillRect(gx * tileSize + 2, gy * tileSize + 2, tileSize - 4, tileSize - 4);
    }
  }

  // Subtle terrazzo / vinyl mineral speckles so tiles feel tangible
  for (let i = 0; i < 650; i++) {
    const x = rng() * 512;
    const y = rng() * 512;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(120, 104, 84, 0.08)' : 'rgba(255, 250, 242, 0.12)';
    ctx.fillRect(x, y, 1.8, 1.8);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(9, 9);
  texture.anisotropy = maxAnisotropy;
  return texture;
}

/**
 * Generates coordinated PBR textures for the Library Desk arena:
 * - Aged warm walnut/oak planks with faded vintage varnish & natural grain
 * - Subtle pencil scratches, old ink marks, very faint erased notes & student study wear
 * - Clean central reading surface so pens remain crisply visible
 */
export function createLibraryDeskSurfaceMaps(
  maxAnisotropy: number,
  legFootNormalizedPositions: Array<{ nx: number; nz: number }>
): DeskSurfaceMaps {
  const rng = createRng(9182734);

  const SIZE = 1024;
  const DATA_SIZE = 512;
  const DS = DATA_SIZE / SIZE;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = SIZE;
  albedoCanvas.height = SIZE;
  const aCtx = albedoCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = DATA_SIZE;
  roughCanvas.height = DATA_SIZE;
  const rCtx = roughCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = DATA_SIZE;
  heightCanvas.height = DATA_SIZE;
  const hCtx = heightCanvas.getContext('2d')!;

  // Vintage hand-rubbed faded satin varnish (~0.68 base roughness)
  rCtx.fillStyle = 'rgb(174, 174, 174)';
  rCtx.fillRect(0, 0, DATA_SIZE, DATA_SIZE);

  hCtx.fillStyle = 'rgb(128, 128, 128)';
  hCtx.fillRect(0, 0, DATA_SIZE, DATA_SIZE);

  // Aged oak/walnut planks running horizontally along X
  const plankBounds = [0, 172, 340, 512, 684, 856, SIZE];
  const plankPalettes: Array<[string, string, string]> = [
    ['#a7784c', '#9d6e43', '#92633a'],
    ['#9e6f45', '#95663d', '#8c5d35'],
    ['#ae7f53', '#a37449', '#97693f'],
    ['#a27247', '#98693f', '#8e5f36'],
    ['#aa7b4f', '#9f7045', '#94653c'],
    ['#9a6a40', '#906138', '#875831'],
  ];

  for (let p = 0; p < plankBounds.length - 1; p++) {
    const y0 = plankBounds[p];
    const y1 = plankBounds[p + 1];
    const ph = y1 - y0;
    const [c0, c1, c2] = plankPalettes[p % plankPalettes.length];

    const grad = aCtx.createLinearGradient(0, y0, SIZE, y1);
    grad.addColorStop(0, c0);
    grad.addColorStop(0.5, c1);
    grad.addColorStop(1, c2);
    aCtx.fillStyle = grad;
    aCtx.fillRect(0, y0, SIZE, ph);

    const plankRough = clampByte(168 + (rng() - 0.5) * 18);
    rCtx.fillStyle = `rgb(${plankRough}, ${plankRough}, ${plankRough})`;
    rCtx.fillRect(0, y0 * DS, DATA_SIZE, ph * DS);

    const fiberCount = Math.floor(ph * 0.78);
    for (let f = 0; f < fiberCount; f++) {
      const fy = y0 + 2 + (f / fiberCount) * (ph - 4) + (rng() - 0.5) * 2.4;
      const isDark = rng() < 0.65;
      const alpha = isDark ? 0.045 + rng() * 0.07 : 0.025 + rng() * 0.04;
      aCtx.strokeStyle = isDark ? `rgba(58, 32, 14, ${alpha})` : `rgba(226, 186, 138, ${alpha})`;
      aCtx.lineWidth = 0.8 + rng() * 2.1;

      const waveA = (rng() - 0.5) * 14;
      const waveB = (rng() - 0.5) * 14;
      const endDy = (rng() - 0.5) * 6;
      aCtx.beginPath();
      aCtx.moveTo(0, fy);
      aCtx.bezierCurveTo(340, fy + waveA, 680, fy + waveB, SIZE, fy + endDy);
      aCtx.stroke();

      if (f % 3 === 0) {
        const hv = isDark ? 119 : 134;
        hCtx.strokeStyle = `rgba(${hv}, ${hv}, ${hv}, 0.25)`;
        hCtx.lineWidth = 0.9;
        hCtx.beginPath();
        hCtx.moveTo(0, fy * DS);
        hCtx.bezierCurveTo(
          340 * DS,
          (fy + waveA) * DS,
          680 * DS,
          (fy + waveB) * DS,
          DATA_SIZE,
          (fy + endDy) * DS
        );
        hCtx.stroke();
      }
    }

    // Subtle oak grain cathedral rings
    if (p === 0 || p === 2 || p === 4) {
      const cx = 200 + rng() * 620;
      const cy = y0 + ph * (0.35 + rng() * 0.3);
      for (let r = 0; r < 8; r++) {
        aCtx.strokeStyle = `rgba(60, 34, 15, ${0.05 - r * 0.0035})`;
        aCtx.lineWidth = 1.3;
        aCtx.beginPath();
        aCtx.ellipse(cx, cy, 62 + r * 30, 9 + r * 4.8, (rng() - 0.5) * 0.04, 0, Math.PI * 2);
        aCtx.stroke();
      }
    }

    // Fine oak medullary flecks
    for (let k = 0; k < 130; k++) {
      const px = rng() * SIZE;
      const py = y0 + 3 + rng() * (ph - 6);
      const len = 3 + rng() * 10;
      aCtx.fillStyle = `rgba(54, 30, 12, ${0.08 + rng() * 0.08})`;
      aCtx.fillRect(px, py, len, 1.1);
      if (k % 2 === 0) {
        hCtx.fillStyle = 'rgba(104, 104, 104, 0.32)';
        hCtx.fillRect(px * DS, py * DS, Math.max(1.2, len * DS), 0.9);
      }
    }
  }

  // Plank seams
  for (let p = 1; p < plankBounds.length - 1; p++) {
    const sy = plankBounds[p];
    aCtx.fillStyle = 'rgba(46, 25, 10, 0.32)';
    aCtx.fillRect(0, sy - 0.9, SIZE, 1.8);
    aCtx.fillStyle = 'rgba(220, 182, 134, 0.1)';
    aCtx.fillRect(0, sy + 1, SIZE, 1.1);

    hCtx.fillStyle = 'rgba(88, 88, 88, 0.55)';
    hCtx.fillRect(0, sy * DS - 0.6, DATA_SIZE, 1.3);
    rCtx.fillStyle = 'rgba(212, 212, 212, 0.55)';
    rCtx.fillRect(0, sy * DS - 0.8, DATA_SIZE, 1.8);
  }

  // Faded vintage varnish & warm center reading wear
  const varnishFade = aCtx.createRadialGradient(512, 500, 180, 512, 512, 740);
  varnishFade.addColorStop(0, 'rgba(232, 196, 150, 0.1)');
  varnishFade.addColorStop(0.58, 'rgba(155, 105, 62, 0.0)');
  varnishFade.addColorStop(1, 'rgba(46, 26, 12, 0.24)');
  aCtx.fillStyle = varnishFade;
  aCtx.fillRect(0, 0, SIZE, SIZE);

  // Subtle inlaid brass/dark-wood study desk border frame
  aCtx.strokeStyle = 'rgba(48, 28, 12, 0.34)';
  aCtx.lineWidth = 4;
  aCtx.strokeRect(24, 24, 976, 976);
  aCtx.strokeStyle = 'rgba(206, 168, 108, 0.22)';
  aCtx.lineWidth = 1.6;
  aCtx.strokeRect(32, 32, 960, 960);

  hCtx.strokeStyle = 'rgba(86, 86, 86, 0.6)';
  hCtx.lineWidth = 2;
  hCtx.strokeRect(24 * DS, 24 * DS, 976 * DS, 976 * DS);

  // Faint center reading line
  aCtx.strokeStyle = 'rgba(236, 214, 178, 0.15)';
  aCtx.lineWidth = 2;
  aCtx.setLineDash([10, 12]);
  aCtx.beginPath();
  aCtx.moveTo(512, 42);
  aCtx.lineTo(512, 982);
  aCtx.stroke();
  aCtx.setLineDash([]);

  // Palm-rubbed varnish polish zones & faded study corners
  const studyWear = [
    { x: 260, y: 700, r: 170, alpha: 0.09, rough: 136 },
    { x: 750, y: 310, r: 165, alpha: 0.08, rough: 138 },
    { x: 512, y: 845, r: 185, alpha: 0.08, rough: 140 },
  ];
  for (const wz of studyWear) {
    const wg = aCtx.createRadialGradient(wz.x, wz.y, 16, wz.x, wz.y, wz.r);
    wg.addColorStop(0, `rgba(222, 184, 138, ${wz.alpha})`);
    wg.addColorStop(1, 'rgba(222, 184, 138, 0)');
    aCtx.fillStyle = wg;
    aCtx.fillRect(wz.x - wz.r, wz.y - wz.r, wz.r * 2, wz.r * 2);

    const rg = rCtx.createRadialGradient(wz.x * DS, wz.y * DS, 8, wz.x * DS, wz.y * DS, wz.r * DS);
    rg.addColorStop(0, `rgba(${wz.rough}, ${wz.rough}, ${wz.rough}, 0.55)`);
    rg.addColorStop(1, `rgba(${wz.rough}, ${wz.rough}, ${wz.rough}, 0)`);
    rCtx.fillStyle = rg;
    rCtx.fillRect((wz.x - wz.r) * DS, (wz.y - wz.r) * DS, wz.r * 2 * DS, wz.r * 2 * DS);
  }

  // Subtle pencil scratches & book-corner scuffs
  for (let i = 0; i < 62; i++) {
    let sx = 40 + rng() * 944;
    let sy = 40 + rng() * 944;
    if (i % 4 !== 0) {
      if (rng() < 0.5) {
        sy = rng() < 0.65 ? 730 + rng() * 255 : 40 + rng() * 200;
      } else {
        sx = rng() < 0.5 ? 40 + rng() * 220 : 760 + rng() * 220;
      }
    }
    const len = 12 + rng() * 52;
    const angle = (rng() - 0.5) * Math.PI;
    const ex = sx + Math.cos(angle) * len;
    const ey = sy + Math.sin(angle) * len;
    const mx = (sx + ex) * 0.5 + (rng() - 0.5) * 5;
    const my = (sy + ey) * 0.5 + (rng() - 0.5) * 5;

    aCtx.strokeStyle =
      rng() < 0.45
        ? `rgba(220, 184, 136, ${0.12 + rng() * 0.1})`
        : `rgba(54, 30, 14, ${0.13 + rng() * 0.12})`;
    aCtx.lineWidth = 0.7 + rng() * 0.8;
    aCtx.beginPath();
    aCtx.moveTo(sx, sy);
    aCtx.quadraticCurveTo(mx, my, ex, ey);
    aCtx.stroke();

    hCtx.strokeStyle = 'rgba(78, 78, 78, 0.48)';
    hCtx.lineWidth = 0.85;
    hCtx.beginPath();
    hCtx.moveTo(sx * DS, sy * DS);
    hCtx.quadraticCurveTo(mx * DS, my * DS, ex * DS, ey * DS);
    hCtx.stroke();

    rCtx.strokeStyle = 'rgba(224, 224, 224, 0.48)';
    rCtx.lineWidth = 1.0;
    rCtx.beginPath();
    rCtx.moveTo(sx * DS, sy * DS);
    rCtx.quadraticCurveTo(mx * DS, my * DS, ex * DS, ey * DS);
    rCtx.stroke();
  }

  // Very faint erased writing & graphite smudge patches (subtle margin study traces)
  const erasedPatches = [
    { x: 175, y: 785, rx: 48, ry: 14, rot: -0.14 },
    { x: 825, y: 215, rx: 44, ry: 12, rot: 0.18 },
    { x: 245, y: 155, rx: 38, ry: 11, rot: -0.08 },
  ];
  for (const ep of erasedPatches) {
    aCtx.save();
    aCtx.translate(ep.x, ep.y);
    aCtx.rotate(ep.rot);
    const eg = aCtx.createRadialGradient(0, 0, 4, 0, 0, ep.rx);
    eg.addColorStop(0, 'rgba(64, 58, 52, 0.095)');
    eg.addColorStop(0.6, 'rgba(210, 180, 142, 0.055)');
    eg.addColorStop(1, 'rgba(64, 58, 52, 0)');
    aCtx.fillStyle = eg;
    aCtx.beginPath();
    aCtx.ellipse(0, 0, ep.rx, ep.ry, 0, 0, Math.PI * 2);
    aCtx.fill();

    // Very faint ghosted erased letter strokes
    aCtx.strokeStyle = 'rgba(48, 42, 36, 0.08)';
    aCtx.lineWidth = 0.9;
    for (let s = -3; s <= 3; s++) {
      const lx = s * 9;
      aCtx.beginPath();
      aCtx.moveTo(lx, 3);
      aCtx.quadraticCurveTo(lx + 3, -5, lx + 6, 2);
      aCtx.stroke();
    }
    aCtx.restore();

    hCtx.strokeStyle = 'rgba(102, 102, 102, 0.34)';
    hCtx.lineWidth = 0.8;
    hCtx.beginPath();
    hCtx.moveTo((ep.x - 20) * DS, ep.y * DS);
    hCtx.lineTo((ep.x + 20) * DS, (ep.y - 2) * DS);
    hCtx.stroke();
  }

  // Old fountain / ballpoint ink drops & faint margin bookmarks
  const inkSpots = [
    { x: 134, y: 842, r: 4.8, col: '24, 44, 96' },
    { x: 145, y: 849, r: 2.1, col: '24, 44, 96' },
    { x: 874, y: 162, r: 3.6, col: '32, 30, 38' },
    { x: 862, y: 876, r: 3.1, col: '26, 48, 104' },
    { x: 196, y: 122, r: 2.5, col: '30, 30, 36' },
  ];
  for (const ink of inkSpots) {
    aCtx.fillStyle = `rgba(${ink.col}, 0.2)`;
    aCtx.beginPath();
    aCtx.arc(ink.x, ink.y, ink.r, 0, Math.PI * 2);
    aCtx.fill();

    const sg = aCtx.createRadialGradient(ink.x + 3, ink.y + 2, 1, ink.x + 3, ink.y + 2, ink.r * 3.4);
    sg.addColorStop(0, `rgba(${ink.col}, 0.085)`);
    sg.addColorStop(1, `rgba(${ink.col}, 0)`);
    aCtx.fillStyle = sg;
    aCtx.fillRect(ink.x - ink.r * 3, ink.y - ink.r * 3, ink.r * 7, ink.r * 7);
  }

  // Faint pencil margin underline & study tally marks near lower-right edge
  aCtx.strokeStyle = 'rgba(48, 44, 40, 0.14)';
  aCtx.lineWidth = 1.1;
  aCtx.beginPath();
  aCtx.moveTo(780, 916);
  aCtx.lineTo(842, 914);
  aCtx.moveTo(782, 922);
  aCtx.lineTo(828, 921);
  aCtx.stroke();

  const normalCanvas = buildNormalCanvasFromHeight(heightCanvas, 2.1);

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = maxAnisotropy;

  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.anisotropy = maxAnisotropy;

  const normal = new THREE.CanvasTexture(normalCanvas);
  normal.anisotropy = maxAnisotropy;

  const edgeUnderside = createLibraryEdgeAndUndersideTexture(maxAnisotropy);
  const contactShadow = createDeskAndLegShadowTexture(legFootNormalizedPositions);

  return { albedo, roughness, normal, edgeUnderside, contactShadow };
}

function createLibraryEdgeAndUndersideTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const rng = createRng(55219);
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const edgeGrad = ctx.createLinearGradient(0, 0, 0, 128);
  edgeGrad.addColorStop(0, '#784e2a');
  edgeGrad.addColorStop(0.5, '#684121');
  edgeGrad.addColorStop(1, '#523217');
  ctx.fillStyle = edgeGrad;
  ctx.fillRect(0, 0, w, 128);

  for (let i = 0; i < 16; i++) {
    const ly = 6 + i * 7.5 + (rng() - 0.5) * 2;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(40, 22, 8, 0.22)' : 'rgba(182, 134, 88, 0.14)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, ly);
    ctx.lineTo(w, ly + (rng() - 0.5) * 2.5);
    ctx.stroke();
  }

  for (let c = 0; c < 22; c++) {
    const cx = rng() * w;
    const cy = 6 + rng() * 32;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(196, 150, 102, 0.2)' : 'rgba(42, 24, 10, 0.24)';
    ctx.fillRect(cx, cy, 3 + rng() * 12, 2 + rng() * 5);
  }

  ctx.fillStyle = '#5c3c22';
  ctx.fillRect(0, 128, w, 128);
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(38, 22, 10, 0.2)' : 'rgba(148, 108, 72, 0.14)';
    ctx.fillRect(rng() * w, 130 + rng() * 124, 3 + rng() * 9, 1.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/** Warm wooden parquet floor texture for the Library Desk arena. */
export function createLibraryFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const rng = createRng(66104);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#a8845c';
  ctx.fillRect(0, 0, 512, 512);

  const plankH = 64;
  const plankW = 128;
  for (let row = 0; row < 8; row++) {
    const offset = (row % 2) * 64;
    for (let col = -1; col < 5; col++) {
      const x = col * plankW + offset;
      const y = row * plankH;
      const shade = 152 + Math.floor((rng() - 0.5) * 18);
      ctx.fillStyle = `rgb(${shade}, ${Math.round(shade * 0.76)}, ${Math.round(shade * 0.52)})`;
      ctx.fillRect(x + 1.5, y + 1.5, plankW - 3, plankH - 3);

      // Fine wood lines per plank
      ctx.strokeStyle = 'rgba(72, 44, 22, 0.09)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 4; g++) {
        const gy = y + 10 + g * 14 + (rng() - 0.5) * 3;
        ctx.beginPath();
        ctx.moveTo(x + 2, gy);
        ctx.lineTo(x + plankW - 2, gy + (rng() - 0.5) * 3);
        ctx.stroke();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.anisotropy = maxAnisotropy;
  return texture;
}

/**
 * Generates coordinated PBR textures for the Science Lab workbench arena:
 * - Light grey / muted stone phenolic resin laboratory bench top
 * - Subtle millimeter/centimeter measurement markings & reference crosshairs
 * - Fine scratches, worn workbench perimeter & subtle lab-use patina
 */
export function createScienceLabSurfaceMaps(
  maxAnisotropy: number,
  legFootNormalizedPositions: Array<{ nx: number; nz: number }>
): DeskSurfaceMaps {
  const rng = createRng(3348192);

  const SIZE = 1024;
  const DATA_SIZE = 512;
  const DS = DATA_SIZE / SIZE;

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = SIZE;
  albedoCanvas.height = SIZE;
  const aCtx = albedoCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = DATA_SIZE;
  roughCanvas.height = DATA_SIZE;
  const rCtx = roughCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = DATA_SIZE;
  heightCanvas.height = DATA_SIZE;
  const hCtx = heightCanvas.getContext('2d')!;

  // Smooth matte-satin phenolic resin (~0.56 roughness)
  rCtx.fillStyle = 'rgb(144, 144, 144)';
  rCtx.fillRect(0, 0, DATA_SIZE, DATA_SIZE);

  hCtx.fillStyle = 'rgb(128, 128, 128)';
  hCtx.fillRect(0, 0, DATA_SIZE, DATA_SIZE);

  // Clean muted stone-grey / light putty-grey resin base
  const baseGrad = aCtx.createLinearGradient(0, 0, SIZE, SIZE);
  baseGrad.addColorStop(0, '#cfd4d7');
  baseGrad.addColorStop(0.5, '#c7ccd0');
  baseGrad.addColorStop(1, '#bfc5c9');
  aCtx.fillStyle = baseGrad;
  aCtx.fillRect(0, 0, SIZE, SIZE);

  // Subtle composite resin mineral micro-speckle
  for (let i = 0; i < 2600; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const sz = 1 + rng() * 1.6;
    aCtx.fillStyle =
      rng() < 0.55 ? `rgba(92, 100, 106, ${0.04 + rng() * 0.05})` : `rgba(248, 250, 252, ${0.06 + rng() * 0.07})`;
    aCtx.fillRect(x, y, sz, sz);
  }

  // Subtle worn perimeter shading & gentle center sheen
  const edgeWear = aCtx.createRadialGradient(512, 512, 230, 512, 512, 740);
  edgeWear.addColorStop(0, 'rgba(244, 247, 249, 0.07)');
  edgeWear.addColorStop(0.68, 'rgba(195, 200, 204, 0.0)');
  edgeWear.addColorStop(1, 'rgba(116, 124, 130, 0.16)');
  aCtx.fillStyle = edgeWear;
  aCtx.fillRect(0, 0, SIZE, SIZE);

  // Regular lab use matte wear zones
  const labWear = [
    { x: 265, y: 695, r: 165, rough: 174 },
    { x: 760, y: 320, r: 155, rough: 170 },
    { x: 512, y: 840, r: 185, rough: 178 },
  ];
  for (const lw of labWear) {
    const rg = rCtx.createRadialGradient(lw.x * DS, lw.y * DS, 12, lw.x * DS, lw.y * DS, lw.r * DS);
    rg.addColorStop(0, `rgba(${lw.rough}, ${lw.rough}, ${lw.rough}, 0.55)`);
    rg.addColorStop(1, `rgba(${lw.rough}, ${lw.rough}, ${lw.rough}, 0)`);
    rCtx.fillStyle = rg;
    rCtx.fillRect((lw.x - lw.r) * DS, (lw.y - lw.r) * DS, lw.r * 2 * DS, lw.r * 2 * DS);
  }

  // Subtle measurement markings (clean perimeter calibration lines, center axis, & ruler scale)
  aCtx.strokeStyle = 'rgba(72, 82, 92, 0.22)';
  aCtx.lineWidth = 2.2;
  aCtx.strokeRect(26, 26, 972, 972);

  // Subtle faint 4-quadrant calibration grid lines (very low contrast so pens pop)
  aCtx.strokeStyle = 'rgba(78, 88, 98, 0.08)';
  aCtx.lineWidth = 1.2;
  for (let gx = 128; gx < 1024; gx += 128) {
    aCtx.beginPath();
    aCtx.moveTo(gx, 36);
    aCtx.lineTo(gx, 988);
    aCtx.stroke();
  }
  for (let gy = 128; gy < 1024; gy += 128) {
    aCtx.beginPath();
    aCtx.moveTo(36, gy);
    aCtx.lineTo(988, gy);
    aCtx.stroke();
  }

  // Center dashed measurement axis
  aCtx.strokeStyle = 'rgba(66, 78, 90, 0.24)';
  aCtx.lineWidth = 2;
  aCtx.setLineDash([10, 10]);
  aCtx.beginPath();
  aCtx.moveTo(512, 36);
  aCtx.lineTo(512, 988);
  aCtx.stroke();
  aCtx.setLineDash([]);

  // Crisp millimeter/centimeter ruler scale along front edge
  aCtx.fillStyle = 'rgba(60, 70, 80, 0.38)';
  aCtx.font = 'bold 11px monospace';
  aCtx.textAlign = 'center';
  hCtx.fillStyle = 'rgba(98, 98, 98, 0.42)';
  for (let i = 0; i <= 64; i++) {
    const x = 64 + i * 14;
    const isMajor = i % 10 === 0;
    const isMid = i % 5 === 0 && !isMajor;
    const tall = isMajor ? 20 : isMid ? 14 : 8;
    const thick = isMajor ? 2.0 : 1.3;
    aCtx.fillRect(x, 990 - tall, thick, tall);
    if (isMajor) {
      aCtx.fillText(`${i}`, x + 1, 964);
    }
    if (isMajor || isMid) {
      hCtx.fillRect(x * DS, (990 - tall) * DS, 1.1, tall * DS);
    }
  }

  // Subtle top-edge degree / vernier ticks
  for (let i = 0; i <= 32; i++) {
    const x = 128 + i * 24;
    const tall = i % 4 === 0 ? 12 : 6;
    aCtx.fillRect(x, 32, 1.4, tall);
  }

  // Subtle beaker heat halo & water stain near upper-right margin
  aCtx.strokeStyle = 'rgba(130, 126, 118, 0.14)';
  aCtx.lineWidth = 3.0;
  aCtx.beginPath();
  aCtx.arc(872, 148, 32, 0.15, Math.PI * 1.9);
  aCtx.stroke();
  rCtx.strokeStyle = 'rgba(202, 202, 202, 0.45)';
  rCtx.lineWidth = 2;
  rCtx.beginPath();
  rCtx.arc(872 * DS, 148 * DS, 32 * DS, 0.15, Math.PI * 1.9);
  rCtx.stroke();

  // Small scratches & tool scuffs on the workbench
  for (let i = 0; i < 58; i++) {
    let sx = 40 + rng() * 944;
    let sy = 40 + rng() * 944;
    if (i % 4 !== 0) {
      if (rng() < 0.5) {
        sy = rng() < 0.65 ? 730 + rng() * 255 : 40 + rng() * 200;
      } else {
        sx = rng() < 0.5 ? 40 + rng() * 220 : 760 + rng() * 220;
      }
    }
    const len = 10 + rng() * 44;
    const angle = (rng() - 0.5) * Math.PI;
    const ex = sx + Math.cos(angle) * len;
    const ey = sy + Math.sin(angle) * len;

    aCtx.strokeStyle =
      rng() < 0.5
        ? `rgba(248, 250, 252, ${0.18 + rng() * 0.14})`
        : `rgba(82, 90, 98, ${0.12 + rng() * 0.12})`;
    aCtx.lineWidth = 0.7 + rng() * 0.8;
    aCtx.beginPath();
    aCtx.moveTo(sx, sy);
    aCtx.lineTo(ex, ey);
    aCtx.stroke();

    hCtx.strokeStyle = 'rgba(84, 84, 84, 0.45)';
    hCtx.lineWidth = 0.8;
    hCtx.beginPath();
    hCtx.moveTo(sx * DS, sy * DS);
    hCtx.lineTo(ex * DS, ey * DS);
    hCtx.stroke();

    rCtx.strokeStyle = 'rgba(218, 218, 218, 0.48)';
    rCtx.lineWidth = 1.0;
    rCtx.beginPath();
    rCtx.moveTo(sx * DS, sy * DS);
    rCtx.lineTo(ex * DS, ey * DS);
    rCtx.stroke();
  }

  // Slightly worn bevel edge scuffs in albedo + roughness
  for (let c = 0; c < 36; c++) {
    const horizontal = rng() < 0.5;
    const wx = horizontal ? 30 + rng() * 964 : rng() < 0.5 ? 6 + rng() * 14 : 1002 + rng() * 14;
    const wy = horizontal ? (rng() < 0.5 ? 6 + rng() * 14 : 1002 + rng() * 14) : 30 + rng() * 964;
    aCtx.fillStyle = rng() < 0.5 ? 'rgba(94, 102, 110, 0.16)' : 'rgba(242, 245, 247, 0.18)';
    aCtx.fillRect(wx, wy, 4 + rng() * 14, 3 + rng() * 8);
  }

  const normalCanvas = buildNormalCanvasFromHeight(heightCanvas, 1.8);

  const albedo = new THREE.CanvasTexture(albedoCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = maxAnisotropy;

  const roughness = new THREE.CanvasTexture(roughCanvas);
  roughness.anisotropy = maxAnisotropy;

  const normal = new THREE.CanvasTexture(normalCanvas);
  normal.anisotropy = maxAnisotropy;

  const edgeUnderside = createScienceLabEdgeAndUndersideTexture(maxAnisotropy);
  const contactShadow = createDeskAndLegShadowTexture(legFootNormalizedPositions);

  return { albedo, roughness, normal, edgeUnderside, contactShadow };
}

function createScienceLabEdgeAndUndersideTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const rng = createRng(88301);
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Dark slate/charcoal protective phenolic workbench edge band
  const edgeGrad = ctx.createLinearGradient(0, 0, 0, 128);
  edgeGrad.addColorStop(0, '#5a626a');
  edgeGrad.addColorStop(0.5, '#464d54');
  edgeGrad.addColorStop(1, '#343a40');
  ctx.fillStyle = edgeGrad;
  ctx.fillRect(0, 0, w, 128);

  // Subtle edge wear scuffs
  for (let c = 0; c < 30; c++) {
    const cx = rng() * w;
    const cy = 6 + rng() * 34;
    ctx.fillStyle = rng() < 0.55 ? 'rgba(168, 176, 184, 0.22)' : 'rgba(30, 34, 38, 0.28)';
    ctx.fillRect(cx, cy, 4 + rng() * 16, 2 + rng() * 5);
  }

  // Industrial coated underside panel
  ctx.fillStyle = '#50575e';
  ctx.fillRect(0, 128, w, 128);
  for (let i = 0; i < 180; i++) {
    ctx.fillStyle = rng() < 0.5 ? 'rgba(32, 36, 40, 0.16)' : 'rgba(140, 148, 156, 0.12)';
    ctx.fillRect(rng() * w, 130 + rng() * 124, 3 + rng() * 10, 1.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/** Clean light-grey speckled laboratory linoleum floor tile texture. */
export function createScienceLabFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const rng = createRng(44920);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#c9cfd3';
  ctx.fillRect(0, 0, 512, 512);

  const tileSize = 128;
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 4; gy++) {
      const shade = (gx + gy) % 2 === 0 ? '#d2d7da' : '#c6ccd0';
      ctx.fillStyle = shade;
      ctx.fillRect(gx * tileSize + 2, gy * tileSize + 2, tileSize - 4, tileSize - 4);
    }
  }

  for (let i = 0; i < 750; i++) {
    const x = rng() * 512;
    const y = rng() * 512;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(92, 100, 108, 0.08)' : 'rgba(248, 250, 252, 0.14)';
    ctx.fillRect(x, y, 1.8, 1.8);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(9, 9);
  texture.anisotropy = maxAnisotropy;
  return texture;
}

