#!/usr/bin/env node
// STANDALONE script. Does not import anything from your project's src/
// folder, and does not need "three" installed. It reimplements the same
// isodistant-truncated-icosahedron math directly, using plain numbers, so
// nothing else in your project needs to be modified for this to run.
//
// Usage:
//   node scripts/export-plate.mjs --face 11 --diameter 5 --csv scorpius.csv [--asterism Scorpius] [--min-dot 1.5] [--max-dot 4]

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'src', 'assets');
const EPSILON = 1e-6;
const PHI = (1 + Math.sqrt(5)) / 2;

// ---------- tiny 3D vector helpers (no external library needed) ----------
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const scl = (a, s) => [a[0]*s, a[1]*s, a[2]*s];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => Math.sqrt(dot(a, a));
const normalize = a => scl(a, 1 / norm(a));
const dist = (a, b) => norm(sub(a, b));
const lerp = (a, b, t) => add(a, scl(sub(b, a), t));

// ---------- build the icosahedron the truncation starts from ----------
function buildIcosahedronVertices() {
  const verts = [];
  const addEvenPerms = (a, b, c) => { verts.push([a,b,c]); verts.push([b,c,a]); verts.push([c,a,b]); };
  for (const s1 of [1, -1]) for (const s2 of [1, -1]) addEvenPerms(0, s1 * 1, s2 * PHI);
  return verts;
}
function buildIcosahedronEdges(verts) {
  let edgeLen = Infinity;
  for (let i = 0; i < verts.length; i++) for (let j = i+1; j < verts.length; j++) edgeLen = Math.min(edgeLen, dist(verts[i], verts[j]));
  const edges = [];
  for (let i = 0; i < verts.length; i++) for (let j = i+1; j < verts.length; j++) if (Math.abs(dist(verts[i], verts[j]) - edgeLen) < 1e-6) edges.push([i, j]);
  return edges;
}
function buildIcosahedronFaces(verts, edges) {
  const adj = verts.map(() => new Set());
  for (const [i,j] of edges) { adj[i].add(j); adj[j].add(i); }
  const seen = new Set(), faces = [];
  for (const [i,j] of edges) {
    for (const k of adj[i]) {
      if (k === j || !adj[j].has(k)) continue;
      const key = [i,j,k].sort((a,b)=>a-b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const a = verts[i], b = verts[j], c = verts[k];
      const outward = normalize(scl(add(add(a,b),c), 1/3));
      const fnormal = normalize(cross(sub(b,a), sub(c,a)));
      faces.push(dot(fnormal, outward) >= 0 ? [i,j,k] : [i,k,j]);
    }
  }
  return faces;
}
function sortedNeighborsByAngle(verts, edges) {
  const adj = verts.map(() => []);
  for (const [i,j] of edges) { adj[i].push(j); adj[j].push(i); }
  return adj.map((neighbors, vi) => {
    const fnormal = normalize(verts[vi]);
    const ref = sub(verts[neighbors[0]], verts[vi]);
    const u = normalize(sub(ref, scl(fnormal, dot(ref, fnormal))));
    const v = normalize(cross(fnormal, u));
    return neighbors
      .map(ni => { const diff = sub(verts[ni], verts[vi]); return { index: ni, angle: Math.atan2(dot(diff,v), dot(diff,u)) }; })
      .sort((a,b) => a.angle - b.angle)
      .map(e => e.index);
  });
}
function buildTruncationPoints(verts, edges, t) {
  const points = new Map();
  for (const [i,j] of edges) { points.set(`${i}->${j}`, lerp(verts[i], verts[j], t)); points.set(`${j}->${i}`, lerp(verts[j], verts[i], t)); }
  return points;
}
const buildPentagons = (neighborOrder, points) => neighborOrder.map((neighbors, vi) => neighbors.map(ni => points.get(`${vi}->${ni}`)));
const buildHexagons = (faces, points) => faces.map(([a,b,c]) => [
  points.get(`${a}->${b}`), points.get(`${b}->${a}`), points.get(`${b}->${c}`), points.get(`${c}->${b}`), points.get(`${c}->${a}`), points.get(`${a}->${c}`)
]);
function planeDistanceFromOrigin(p0, p1, p2) {
  const n = normalize(cross(sub(p1,p0), sub(p2,p0)));
  return Math.abs(dot(p0, n));
}
function solveIsodistantT(icoVerts, edges, faces, neighborOrder) {
  const distances = t => {
    const points = buildTruncationPoints(icoVerts, edges, t);
    const pent = buildPentagons(neighborOrder, points)[0];
    const hex = buildHexagons(faces, points)[0];
    return { pentDist: planeDistanceFromOrigin(...pent.slice(0,3)), hexDist: planeDistanceFromOrigin(...hex.slice(0,3)) };
  };
  let lo = 0.25, hi = 0.49;
  for (let i = 0; i < 60; i++) {
    const t = (lo + hi) / 2;
    const { pentDist, hexDist } = distances(t);
    if (pentDist > hexDist) lo = t; else hi = t;
  }
  return (lo + hi) / 2;
}

function rotateVector(v, axis, angle) {
  // Rodrigues' rotation formula - same result as three.js Matrix4.makeRotationAxis
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const term1 = scl(v, cosA);
  const term2 = scl(cross(axis, v), sinA);
  const term3 = scl(axis, dot(axis, v) * (1 - cosA));
  return add(add(term1, term2), term3);
}

function buildGeometry() {
  const icoVerts = buildIcosahedronVertices();
  const edges = buildIcosahedronEdges(icoVerts);
  const faces = buildIcosahedronFaces(icoVerts, edges);
  const neighborOrder = sortedNeighborsByAngle(icoVerts, edges);
  const t = solveIsodistantT(icoVerts, edges, faces, neighborOrder);
  const points = buildTruncationPoints(icoVerts, edges, t);
  const rawPentagons = buildPentagons(neighborOrder, points);
  const rawHexagons = buildHexagons(faces, points);
  const pentDist = planeDistanceFromOrigin(...rawPentagons[0].slice(0,3));

  // Normalize so the pentagon face-plane distance from center = 1 (matches
  // the convention used elsewhere in this project). Polygon order: pentagons
  // first (0-11), then hexagons (12-31) - matches the app's own builder.
  const scaleUnit = f => f.map(p => scl(p, 1 / pentDist));
  let faceGroups = [...rawPentagons.map(scaleUnit), ...rawHexagons.map(scaleUnit)];

  // Replicate Topology.js's rotation: rotate the WHOLE shape so polygon 0's
  // (the first pentagon's) outward normal points to world "up" (0,1,0).
  // Without this, face indices don't line up with the same real-sky
  // directions the actual app uses.
  const p0 = faceGroups[0];
  const p0Center = scl(p0.reduce((a,b) => add(a,b)), 1 / p0.length);
  let p0Normal = normalize(cross(sub(p0[1], p0[0]), sub(p0[2], p0[0])));
  if (dot(p0Normal, p0Center) < 0) p0Normal = scl(p0Normal, -1); // ensure outward

  const up = [0, 1, 0];
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(p0Normal, up))));
  let axis = cross(p0Normal, up);
  if (norm(axis) > 1e-9) {
    axis = normalize(axis);
    faceGroups = faceGroups.map(pts => pts.map(p => rotateVector(p, axis, angle)));
  }
  // (if norm(axis) ~ 0, p0Normal is already aligned with up - no rotation needed)

  const polygons = faceGroups.map((pts, index) => {
    const center = scl(pts.reduce((a,b) => add(a,b)), 1 / pts.length);
    const normal = normalize(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
    const outNormal = dot(normal, center) >= 0 ? normal : scl(normal, -1);
    return { index, points: pts, center, normal: outNormal };
  });
  return polygons;
}

// ---------- point-in-convex-polygon test (all points assumed coplanar) ----------
function polygonContains(polygon, p) {
  const { points, normal } = polygon;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i+1) % points.length];
    const edgeCross = cross(sub(b, a), sub(p, a));
    if (dot(edgeCross, normal) < -1e-9) return false;
  }
  return true;
}

// Cast a ray from the origin in `direction`; find which polygon it hits.
function projectToFace(polygons, direction) {
  for (const polygon of polygons) {
    const denom = dot(polygon.normal, direction);
    if (denom <= 0) continue; // ray moving away from this face's outward side
    const planeDist = dot(polygon.normal, polygon.points[0]);
    const tHit = planeDist / denom;
    const hit = scl(direction, tHit);
    if (polygonContains(polygon, hit)) return { polygonId: polygon.index, point: hit };
  }
  return null;
}

function vectorFromAngles(theta, phi) {
  return [Math.cos(phi) * Math.sin(theta), Math.sin(phi), Math.cos(phi) * Math.cos(theta)];
}

function magnitudeToDiameter(mags, minDot, maxDot) {
  const brightness = m => Math.pow(10, -0.2 * m);
  const values = mags.map(brightness);
  const bMin = Math.min(...values), bMax = Math.max(...values);
  return m => {
    if (bMax === bMin) return maxDot;
    const t = (brightness(m) - bMin) / (bMax - bMin);
    return minDot + t * (maxDot - minDot);
  };
}

function parseArgs(argv) {
  const args = { face: null, diameter: null, csv: null, asterism: null, minDot: 1.5, maxDot: 4 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--face') args.face = parseInt(argv[++i], 10);
    if (argv[i] === '--diameter') args.diameter = parseFloat(argv[++i]);
    if (argv[i] === '--csv') args.csv = argv[++i];
    if (argv[i] === '--asterism') args.asterism = argv[++i];
    if (argv[i] === '--min-dot') args.minDot = parseFloat(argv[++i]);
    if (argv[i] === '--max-dot') args.maxDot = parseFloat(argv[++i]);
  }
  if (args.face === null || args.diameter === null) {
    console.error('Usage: node scripts/export-plate.mjs --face <index> --diameter <cm> --csv out.csv [--asterism Name] [--min-dot mm] [--max-dot mm]');
    process.exit(1);
  }
  return args;
}

function main() {
  const { face: faceIndex, diameter: targetDiameterCm, csv, asterism: asterismFilter, minDot, maxDot } = parseArgs(process.argv.slice(2));

  const polygons = buildGeometry();
  const face = polygons.find(p => p.index === faceIndex);
  if (!face) throw new Error(`No face with index ${faceIndex} (valid range 0-${polygons.length - 1})`);

  const radii = face.points.map(p => dist(p, face.center));
  const maxR = Math.max(...radii), minR = Math.min(...radii);
  if (maxR - minR > 1e-4) {
    throw new Error(`Face ${faceIndex} isn't cyclic (vertex distances ${minR.toFixed(6)}-${maxR.toFixed(6)}); can't use circumscribed diameter for it.`);
  }

  const scale = targetDiameterCm / (2 * maxR); // cm per unit
  const xAxis = normalize(sub(face.points[0], face.center));
  const yAxis = normalize(cross(face.normal, xAxis));

  const toLocalMm = point3d => {
    const rel = sub(point3d, face.center);
    return { x: dot(rel, xAxis) * scale * 10, y: dot(rel, yAxis) * scale * 10 };
  };

  const rows = [];
  face.points.forEach((p, i) => {
    const { x, y } = toLocalMm(p);
    rows.push({ type: 'vertex', label: `v${i}`, hd: '', mag: '', x, y });
  });

  const asterisms = JSON.parse(readFileSync(join(ASSETS, 'asterisms.json')));
  const catalog = JSON.parse(readFileSync(join(ASSETS, 'hd_asterisms.json')));

  const matchedStars = [];
  for (const asterism of asterisms) {
    if (asterismFilter && asterism.name !== asterismFilter) continue;
    const starIds = [...new Set(asterism.stars)];
    for (const hd of starIds) {
      const star = catalog.find(s => s.hd === hd);
      if (!star) continue;
      const direction = vectorFromAngles(star.rarad, star.decrad);
      const result = projectToFace(polygons, direction);
      if (!result || result.polygonId !== faceIndex) continue;
      matchedStars.push({ star, point: result.point, asterism: asterism.name });
    }
  }

  const diameterFor = magnitudeToDiameter(matchedStars.map(m => m.star.mag), minDot, maxDot);
  matchedStars.forEach(({ star, point, asterism }) => {
    const { x, y } = toLocalMm(point);
    rows.push({ type: 'star', label: star.proper || `HD${star.hd}`, hd: star.hd, mag: star.mag, dotDiameterMm: diameterFor(star.mag), x, y, asterism });
  });

  console.log(`Face ${faceIndex}: ${face.points.length}-sided, circumscribed diameter locked to ${targetDiameterCm}cm\n`);
  rows.forEach(r => {
    const tag = r.type === 'star' ? `[${r.asterism}] ${r.label} (mag ${r.mag})` : r.label;
    const dot = r.type === 'star' ? `  dot=${r.dotDiameterMm.toFixed(2)}mm` : '';
    console.log(`  ${r.type.padEnd(6)} ${tag.padEnd(28)} x=${r.x.toFixed(3)}mm  y=${r.y.toFixed(3)}mm${dot}`);
  });

  if (csv) {
    const header = 'type,label,hd_id,magnitude,dot_diameter_mm,asterism,x_mm,y_mm';
    const lines = rows.map(r => [r.type, r.label, r.hd, r.mag, r.dotDiameterMm ? r.dotDiameterMm.toFixed(3) : '', r.asterism || '', r.x.toFixed(3), r.y.toFixed(3)].join(','));
    writeFileSync(csv, [
      `# Face ${faceIndex} - local plate coordinates, origin at face center`,
      `# +X: toward v0. +Y: normal x X (right-handed, viewed from outside).`,
      `# Circumscribed circle diameter: ${targetDiameterCm}cm`,
      `# dot_diameter_mm: brighter stars get bigger dots, scaled ${minDot}mm-${maxDot}mm`,
      '#', header, ...lines
    ].join('\n'));
    console.log(`\nWrote ${csv}`);
  }
}

main();
