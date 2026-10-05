import { NodeInfo } from "./regions.js";
import { gauss, mulberry32 } from "./rng.js";

export const HULL = { cx: 0, cy: -16, cz: 18, rx: 68, ry: 90, rz: 62 };

export type Vec3 = [number, number, number];

/** Gyri: meandering ridge lines, 1 on a gyral crest, 0 in a sulcus. */
export function ridge(x: number, y: number, z: number): number {
  const r1 = 1 - Math.abs(Math.sin(0.46 * x + 0.29 * z + 1.7 * Math.sin(0.13 * y + 0.17 * z)));
  const r2 = 1 - Math.abs(Math.sin(0.39 * y - 0.32 * z + 1.5 * Math.sin(0.19 * x + 0.11 * y)));
  return 0.6 * r1 + 0.4 * r2;
}

/** Point on the (deformed) cerebral surface for a unit direction in "scaled" space. */
export function hullPoint(u: Vec3): Vec3 {
  const [ux, uy, uz] = u;
  let x = ux * HULL.rx;
  let y = uy * HULL.ry;
  let z = uz * HULL.rz;
  if (uz < 0) z *= 0.8;                                                   // flatter underside
  // side profile (radial in the front-back/up-down plane, so the SILHOUETTE changes, not just the width):
  // temporal lobes hang below the rest of the brain, with a notch (lateral fissure) where they meet the frontal lobe
  const ang = (Math.atan2(uz, uy) * 180) / Math.PI;
  const gs = (c: number, sd: number) => { const d = ((ang - c + 540) % 360) - 180; return Math.exp(-(d * d) / (2 * sd * sd)); };
  const tl = gs(-96, 24);
  const prof = 1 + 0.23 * tl - 0.17 * gs(-52, 8) + 0.05 * gs(180, 16) - 0.06 * gs(15, 22);
  x *= prof * (1 + 0.1 * tl); y *= prof; z *= prof;
  // frontal lobe narrower, occipital pole tapers
  x *= uy > 0 ? 1 - 0.27 * uy * uy : 1 - 0.2 * uy * uy;
  // folds: push crests out and sulci in
  const f = ridge(x, y, z);
  const w = 1 + 0.055 * (f - 0.5);
  x *= w; y *= w; z *= w;
  // longitudinal fissure
  x += (x >= 0 ? 1 : -1) * 3.2;
  return [HULL.cx + x, HULL.cy + y, HULL.cz + z];
}

/** How likely a surface point is to carry a neuron: crowded on gyri, sparse in sulci, so the folds show. */
export function foldDensity(p: Vec3): number {
  const f = ridge(p[0] - HULL.cx, p[1] - HULL.cy, p[2] - HULL.cz);
  return 0.18 + 0.82 * Math.pow(f, 1.4);
}

/** Direction in scaled space (what hullPoint expects) for an MNI-style coordinate. */
export function dirOf(p: Vec3): Vec3 {
  const sx = (p[0] - HULL.cx) / HULL.rx;
  const sy = (p[1] - HULL.cy) / HULL.ry;
  const sz = (p[2] - HULL.cz) / HULL.rz;
  const n = Math.hypot(sx, sy, sz) || 1;
  return [sx / n, sy / n, sz / n];
}

/** 0 at the centre, 1 on the surface (for sanity-checking deep structures). */
export function hullDepth(p: Vec3): number {
  return Math.hypot((p[0] - HULL.cx) / HULL.rx, (p[1] - HULL.cy) / HULL.ry, (p[2] - HULL.cz) / HULL.rz);
}

export interface NeuronCloud {
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** node index each neuron belongs to */
  node: Uint16Array;
  /** brightness from the folds: gyral crests bright, sulci dim (1 for deep structures) */
  crest: Float32Array;
  /** neurons [0, shellCount) are cortex, in random order, so any prefix is an even sample */
  shellCount: number;
}

function randomUnit(rnd: () => number): Vec3 {
  const z = rnd() * 2 - 1;
  const t = rnd() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}

export function buildCloud(nodes: NodeInfo[], density = 1, seed = 1337): NeuronCloud {
  const rnd = mulberry32(seed);
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], ns: number[] = [], cs: number[] = [];
  const push = (p: Vec3, n: number, c = 1) => { xs.push(p[0]); ys.push(p[1]); zs.push(p[2]); ns.push(n); cs.push(c); };

  // ---- cortex: tile the whole cortical surface by weighted nearest anchor ----
  const shell = nodes.filter((n) => n.region.kind === "shell");
  const anchors = shell.map((n) => {
    const d = dirOf(n.region.pos);
    if (n.hemi === "R") d[0] = -d[0];
    return { n: n.index, d, w: n.region.weight ?? 1 };
  });
  const SHELL_POINTS = Math.round(30000 * density);
  let accepted = 0, guard = 0;
  while (accepted < SHELL_POINTS && guard++ < SHELL_POINTS * 12) {
    const u = randomUnit(rnd);
    let best = -1, bestScore = Infinity;
    for (let a = 0; a < anchors.length; a++) {
      const an = anchors[a];
      const dx = an.d[0] - u[0], dy = an.d[1] - u[1], dz = an.d[2] - u[2];
      // anchors only compete on their own side of the fissure
      if ((an.d[0] < 0) !== (u[0] < 0)) continue;
      const score = Math.sqrt(dx * dx + dy * dy + dz * dz) / an.w;
      if (score < bestScore) { bestScore = score; best = an.n; }
    }
    if (best < 0) continue;
    const hp = hullPoint(u);
    const fr = ridge(hp[0] - HULL.cx, hp[1] - HULL.cy, hp[2] - HULL.cz);
    if (rnd() > 0.32 + 0.68 * Math.pow(fr, 1.2)) continue;
    push(hp, best, 0.58 + 0.7 * fr);
    accepted++;
  }

  const shellCount = xs.length;
  // ---- deep structures -------------------------------------------------------
  for (const n of nodes) {
    const r = n.region;
    if (r.kind === "shell") continue;
    const sign = n.hemi === "R" ? -1 : 1;
    const count = Math.max(10, Math.round(r.neurons * 3 * density));
    const [rx, ry, rz] = r.radii ?? [4, 4, 4];
    for (let i = 0; i < count; i++) {
      let p: Vec3;
      if (r.kind === "cerebellum") {
        // folded shell of an ellipsoid, slightly flattened underneath
        let u = randomUnit(rnd);
        for (let t = 0; t < 8; t++) {                                   // folia: keep points on parallel stripes
          if (Math.abs(Math.sin(u[2] * 17 + u[0] * 2)) > 0.45 || rnd() < 0.15) break;
          u = randomUnit(rnd);
        }
        const f = 0.9 + 0.1 * rnd();
        p = [r.pos[0] + u[0] * rx * f, r.pos[1] + u[1] * ry * f, r.pos[2] + u[2] * rz * f * (u[2] < 0 ? 0.8 : 1)];
      } else {
        let gx = gauss(rnd), gy = gauss(rnd), gz = gauss(rnd);
        const m = Math.hypot(gx, gy, gz);
        if (m > 1.9) { const k = 1.9 / m; gx *= k; gy *= k; gz *= k; }
        p = [r.pos[0] + gx * rx * 0.55, r.pos[1] + gy * ry * 0.55, r.pos[2] + gz * rz * 0.55];
      }
      if (n.hemi === "R") p[0] = -p[0];
      if (n.hemi === "M") p[0] = (r.midline ? 0 : r.pos[0]) + (p[0] - r.pos[0]);
      void sign;
      push(p, n.index);
    }
  }

  // brainstem and spinal cord: a tapering, slightly curved tube leaving the underside
  const rf = nodes.find((n) => n.region.id === "RF");
  if (rf) {
    const m = Math.round(450 * density);
    for (let i = 0; i < m; i++) {
      const t = Math.pow(rnd(), 0.85);
      const cy = -30 - 6 * t + 2 * Math.sin(t * 3), cz = -26 - 24 * t;     // short stub: about 2 cm below the brain
      const rad = 7.5 - 2.5 * t, a = rnd() * Math.PI * 2, r = rad * Math.sqrt(rnd());
      push([r * Math.cos(a), cy + r * Math.sin(a) * 0.8, cz], rf.index, 0.8 + 0.3 * rnd());
    }
  }

  return {
    count: xs.length,
    x: Float32Array.from(xs), y: Float32Array.from(ys), z: Float32Array.from(zs),
    node: Uint16Array.from(ns),
    crest: Float32Array.from(cs),
    shellCount,
  };
}

export interface Fibres {
  count: number;
  a: Uint32Array;   // neuron index at one end
  b: Uint32Array;   // neuron index at the other end
}

/** White-matter tracts: arcs that dip through the interior between cortical neurons (some cross the midline like the corpus callosum). */
export function buildFibres(cloud: NeuronCloud, nodes: NodeInfo[], count = 340, seed = 77): Fibres {
  const rnd = mulberry32(seed);
  const cortex: number[] = [];
  for (let i = 0; i < cloud.count; i++) if (nodes[cloud.node[i]].region.kind === "shell") cortex.push(i);
  const A: number[] = [], B: number[] = [];
  let guard = 0;
  while (A.length < count && guard++ < count * 60) {
    const i = cortex[Math.floor(rnd() * cortex.length)];
    const commissural = rnd() < 0.4;
    let best = -1, bestErr = Infinity;
    for (let t = 0; t < 40; t++) {
      const j = cortex[Math.floor(rnd() * cortex.length)];
      const sameSide = (cloud.x[i] - HULL.cx) * (cloud.x[j] - HULL.cx) > 0;
      if (commissural === sameSide) continue;
      const d = Math.hypot(cloud.x[i] - cloud.x[j], cloud.y[i] - cloud.y[j], cloud.z[i] - cloud.z[j]);
      // association fibres are mid-length; callosal fibres join roughly mirrored points
      const err = commissural ? Math.hypot(cloud.x[i] + cloud.x[j] - 2 * HULL.cx, cloud.y[i] - cloud.y[j], cloud.z[i] - cloud.z[j]) : Math.abs(d - 60);
      if (err < bestErr) { bestErr = err; best = j; }
    }
    if (best < 0 || (commissural ? bestErr > 22 : bestErr > 30)) continue;
    A.push(i); B.push(best);
  }
  return { count: A.length, a: Uint32Array.from(A), b: Uint32Array.from(B) };
}

/**
 * Corpus callosum: the big arched bundle joining the two hemispheres.
 * 9 numbers per fibre: start (left), control (above the midline), end (right), all in centred mm.
 */
export function buildCallosum(count = 90, seed = 5): Float32Array {
  const rnd = mulberry32(seed);
  const out = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    const t = rnd();                                              // 0 = back (splenium) .. 1 = front (genu)
    const yAbs = -34 + 64 * t;
    const zAbs = 16 + 13 * Math.pow(Math.sin(Math.PI * t), 0.6);   // the arch
    const y = yAbs - HULL.cy + (rnd() - 0.5) * 3, z = zAbs - HULL.cz + (rnd() - 0.5) * 3;
    const reach = 24 + 32 * rnd();                                // how far it fans out into each hemisphere
    out.set([-reach, y, z - 6 - 6 * rnd(), 0, y, z + 6, reach, y, z - 6 - 6 * rnd()], i * 9);
  }
  return out;
}
