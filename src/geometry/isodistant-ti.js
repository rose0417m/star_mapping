import { Face3, Geometry, Vector3 } from 'three';

const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Build the 12 icosahedron vertices.
 */
function buildIcosahedronVertices() {
  const verts = [];
  function addEvenPerms(a, b, c) {
    verts.push(new Vector3(a, b, c));
    verts.push(new Vector3(b, c, a));
    verts.push(new Vector3(c, a, b));
  }
  for (const s1 of [1, -1]) {
    for (const s2 of [1, -1]) {
      addEvenPerms(0, s1 * 1, s2 * PHI);
    }
  }
  return verts; // 12 vertices, fixed index order
}

/**
 * Build the 30 icosahedron edges (as [i, j] index pairs, i < j) using
 * minimum pairwise distance. This is reliable here because we're only
 * working with the 12 base vertices — small, uniform, well-separated.
 */
function buildIcosahedronEdges(verts) {
  const eps = 1e-6;
  let edgeLen = Infinity;
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      edgeLen = Math.min(edgeLen, verts[i].distanceTo(verts[j]));
    }
  }
  const edges = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      if (Math.abs(verts[i].distanceTo(verts[j]) - edgeLen) < eps) {
        edges.push([i, j]);
      }
    }
  }
  return edges;
}

/**
 * Build the 20 triangular faces from vertex+edge topology (not from the
 * truncated cloud). For each edge (i,j), any k connected to both i and j
 * forms a triangle. Each triangle appears twice this way (once per edge
 * scan) so we dedupe by sorted index key.
 *
 * Each face is wound CCW as seen from outside (normal points away from
 * origin), which downstream hexagon construction depends on.
 */
function buildIcosahedronFaces(verts, edges) {
  const adj = verts.map(() => new Set());
  for (const [i, j] of edges) {
    adj[i].add(j);
    adj[j].add(i);
  }

  const seen = new Set();
  const faces = [];

  for (const [i, j] of edges) {
    for (const k of adj[i]) {
      if (k === j) continue;
      if (!adj[j].has(k)) continue;

      const key = [i, j, k].sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);

      // Determine CCW winding (outward-facing) for [i, j, k]
      const a = verts[i], b = verts[j], c = verts[k];
      const center = a.clone().add(b).add(c).divideScalar(3);
      const outward = center.clone().normalize();
      const normal = new Vector3()
        .crossVectors(b.clone().sub(a), c.clone().sub(a))
        .normalize();

      faces.push(normal.dot(outward) >= 0 ? [i, j, k] : [i, k, j]);
    }
  }

  return faces; // 20 faces
}

/**
 * For each icosahedron vertex, get its neighbors sorted CCW (viewed from
 * outside) — needed to build pentagon vertex order correctly.
 */
function sortedNeighborsByAngle(verts, edges) {
  const adj = verts.map(() => []);
  for (const [i, j] of edges) {
    adj[i].push(j);
    adj[j].push(i);
  }

  return adj.map((neighbors, vi) => {
    const normal = verts[vi].clone().normalize();
    const ref = verts[neighbors[0]].clone().sub(verts[vi]);
    const u = ref.clone().sub(normal.clone().multiplyScalar(ref.dot(normal))).normalize();
    const v = new Vector3().crossVectors(normal, u).normalize();

    return neighbors
      .map(ni => {
        const diff = verts[ni].clone().sub(verts[vi]);
        const angle = Math.atan2(diff.dot(v), diff.dot(u));
        return { index: ni, angle };
      })
      .sort((a, b) => a.angle - b.angle)
      .map(e => e.index);
  });
}

/**
 * Given truncation parameter t, build a map of directed truncation points:
 * key `${from}->${to}` gives the point at fraction t from `from` toward `to`.
 * This guarantees the SAME Vector3 instance is reused by both the pentagon
 * (at `from`) and the hexagon edge that needs it — no duplicate/rediscovery.
 */
function buildTruncationPoints(verts, edges, t) {
  const points = new Map();
  for (const [i, j] of edges) {
    points.set(`${i}->${j}`, verts[i].clone().lerp(verts[j], t));
    points.set(`${j}->${i}`, verts[j].clone().lerp(verts[i], t));
  }
  return points;
}

/**
 * Build pentagon faces directly from vertex topology: one pentagon per
 * icosahedron vertex, made of the 5 truncation points nearest that vertex,
 * in the correct CCW order from the original neighbor ordering.
 */
function buildPentagons(neighborOrder, points) {
  return neighborOrder.map((neighbors, vi) =>
    neighbors.map(ni => points.get(`${vi}->${ni}`))
  );
}

/**
 * Build hexagon faces directly from face topology: one hexagon per
 * icosahedron triangle, made of 2 truncation points per edge of that
 * triangle, in order, preserving the triangle's CCW winding.
 */
function buildHexagons(faces, points) {
  return faces.map(([a, b, c]) => [
    points.get(`${a}->${b}`), points.get(`${b}->${a}`),
    points.get(`${b}->${c}`), points.get(`${c}->${b}`),
    points.get(`${c}->${a}`), points.get(`${a}->${c}`),
  ]);
}

/**
 * Plane distance from origin, given any 3 (assumed coplanar) points.
 */
function planeDistanceFromOrigin(p0, p1, p2) {
  const normal = new Vector3()
    .crossVectors(p1.clone().sub(p0), p2.clone().sub(p0))
    .normalize();
  return Math.abs(p0.dot(normal));
}

/**
 * Solve for the truncation t that makes pentagon and hexagon planes
 * equidistant from the origin, using the FIRST pentagon/hexagon as the
 * reference (by symmetry, the result is the same for all of them).
 */
function solveIsodistantT(icoVerts, edges, faces, neighborOrder) {
  function distances(t) {
    const points = buildTruncationPoints(icoVerts, edges, t);
    const pent = buildPentagons(neighborOrder, points)[0];
    const hex = buildHexagons(faces, points)[0];
    return {
      pentDist: planeDistanceFromOrigin(pent[0], pent[1], pent[2]),
      hexDist: planeDistanceFromOrigin(hex[0], hex[1], hex[2]),
    };
  }

  let lo = 0.25, hi = 0.49;
  for (let iter = 0; iter < 60; iter++) {
    const t = (lo + hi) / 2;
    const { pentDist, hexDist } = distances(t);
    if (pentDist > hexDist) lo = t; else hi = t;
  }
  return (lo + hi) / 2;
}

/**
 * Build the full isodistant truncated icosahedron: vertices + explicit
 * pentagon/hexagon face lists, all derived from preserved topology.
 */
function buildIsodistantTruncatedIcosahedron() {
  const icoVerts = buildIcosahedronVertices();
  const edges = buildIcosahedronEdges(icoVerts);
  const faces = buildIcosahedronFaces(icoVerts, edges);
  const neighborOrder = sortedNeighborsByAngle(icoVerts, edges);

  const t = solveIsodistantT(icoVerts, edges, faces, neighborOrder);
  console.log(`Isodistant truncation parameter t = ${t.toFixed(6)}`);

  const points = buildTruncationPoints(icoVerts, edges, t);
  const pentagons = buildPentagons(neighborOrder, points); // 12 pentagons
  const hexagons = buildHexagons(faces, points);            // 20 hexagons

  // Sanity check: verify isodistance actually achieved
  const pentDist = planeDistanceFromOrigin(...pentagons[0].slice(0, 3));
  const hexDist = planeDistanceFromOrigin(...hexagons[0].slice(0, 3));
  console.log(`pentDist=${pentDist.toFixed(8)} hexDist=${hexDist.toFixed(8)} diff=${Math.abs(pentDist - hexDist).toExponential(2)}`);

  // Build unique vertex list + index lookup (so shared truncation points
  // map to the SAME index across pentagons and hexagons — no seams)
  const vertexList = [];
  const indexOf = new Map();
  function getIndex(p) {
    // points.Map values are already deduplicated by construction (same
    // Vector3 instance reused), so we can key off object identity directly
    if (!indexOf.has(p)) {
      indexOf.set(p, vertexList.length);
      vertexList.push(p);
    }
    return indexOf.get(p);
  }

  const pentagonIdx = pentagons.map(face => face.map(getIndex));
  const hexagonIdx = hexagons.map(face => face.map(getIndex));

  // Normalize so face (panel) distance = 1
  const scaled = vertexList.map(v => v.clone().divideScalar(pentDist));

  return { vertices: scaled, pentagons: pentagonIdx, hexagons: hexagonIdx };
}

/**
 * Create a THREE.Geometry for the isodistant truncated icosahedron,
 * triangulated via fan triangulation from explicit face lists.
 */
export default function createIsodistantTruncatedIcosahedronGeometry() {
  const { vertices, pentagons, hexagons } = buildIsodistantTruncatedIcosahedron();

  const geometry = new Geometry();
  geometry.vertices = vertices;

  function addFan(faceIdx) {
    const center = faceIdx
      .reduce((sum, vi) => sum.add(vertices[vi]), new Vector3())
      .divideScalar(faceIdx.length);
    const outward = center.clone().normalize();

    for (let i = 1; i < faceIdx.length - 1; i++) {
      const a = faceIdx[0], b = faceIdx[i], c = faceIdx[i + 1];
      const ab = vertices[b].clone().sub(vertices[a]);
      const ac = vertices[c].clone().sub(vertices[a]);
      const triNormal = ab.cross(ac);

      geometry.faces.push(
        triNormal.dot(outward) < 0 ? new Face3(a, c, b) : new Face3(a, b, c)
      );
    }
  }

  for (const face of pentagons) addFan(face);
  for (const face of hexagons) addFan(face);

  geometry.computeFaceNormals();
  return geometry;
}