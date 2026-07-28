import { Face3, Geometry, Vector3 } from 'three';

/**
 * Golden ratio
 */
const PHI = (1 + Math.sqrt(5)) / 2;

/**
 * Generate all 60 vertices of a truncated icosahedron.
 *
 * The vertices are all even permutations of:
 *   (0, ±1, ±3φ)
 *   (±2, ±(1+2φ), ±φ)
 *   (±1, ±(2+φ), ±2φ)
 *
 * where φ = (1+√5)/2
 *
 * Then normalized to unit circumscribed radius.
 */
function generateVertices() {
  const coords = [];

  // Helper: even permutations of (a, b, c) are (a,b,c), (b,c,a), (c,a,b)
  function addEvenPermutations(a, b, c) {
    coords.push([a, b, c]);
    coords.push([b, c, a]);
    coords.push([c, a, b]);
  }

  // (0, ±1, ±3φ)
  for (const s1 of [1, -1]) {
    for (const s2 of [1, -1]) {
      addEvenPermutations(0, s1 * 1, s2 * 3 * PHI);
    }
  }

  // (±2, ±(1+2φ), ±φ)
  for (const s1 of [1, -1]) {
    for (const s2 of [1, -1]) {
      for (const s3 of [1, -1]) {
        addEvenPermutations(s1 * 2, s2 * (1 + 2 * PHI), s3 * PHI);
      }
    }
  }

  // (±1, ±(2+φ), ±2φ)
  for (const s1 of [1, -1]) {
    for (const s2 of [1, -1]) {
      for (const s3 of [1, -1]) {
        addEvenPermutations(s1 * 1, s2 * (2 + PHI), s3 * 2 * PHI);
      }
    }
  }

  // Remove duplicates (floating point comparison with epsilon)
  const unique = [];
  const eps = 1e-6;
  for (const c of coords) {
    if (!unique.find(u =>
      Math.abs(u[0] - c[0]) < eps &&
      Math.abs(u[1] - c[1]) < eps &&
      Math.abs(u[2] - c[2]) < eps
    )) {
      unique.push(c);
    }
  }

  // Normalize to unit circumscribed radius
  const radius = Math.sqrt(unique[0][0] ** 2 + unique[0][1] ** 2 + unique[0][2] ** 2);

  return unique.map(([x, y, z]) => new Vector3(x / radius, y / radius, z / radius));
}

/**
 * Find all polygon faces (pentagons and hexagons) of the truncated icosahedron.
 *
 * Strategy:
 * 1. Compute the edge length (minimum distance between any two vertices).
 * 2. Build an adjacency graph (vertices connected by edges).
 * 3. For each directed edge, walk the face cycle (always turning to the
 *    leftmost neighbor when viewed from outside) to trace pentagonal and
 *    hexagonal faces.
 */
function findFaces(vertices) {
  const n = vertices.length;
  const eps = 1e-6;

  // Find edge length = minimum pairwise distance
  let edgeLength = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = vertices[i].distanceTo(vertices[j]);
      if (d < edgeLength) edgeLength = d;
    }
  }

  // Build adjacency: vertices within edgeLength * (1 + small tolerance)
  const adj = vertices.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(vertices[i].distanceTo(vertices[j]) - edgeLength) < eps * 100) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  // Sort adjacency lists by angle for consistent face-cycle walking.
  // For each vertex, project neighbors onto the tangent plane and sort CCW
  // when viewed from outside (along the vertex normal = vertex direction since
  // the polyhedron is centered at origin).
  const sortedAdj = adj.map((neighbors, vi) => {
    const normal = vertices[vi].clone().normalize();

    // Build a local coordinate frame on the tangent plane
    const ref = neighbors.length > 0
      ? vertices[neighbors[0]].clone().sub(vertices[vi])
      : new Vector3(1, 0, 0);
    const u = ref.clone().sub(normal.clone().multiplyScalar(ref.dot(normal))).normalize();
    const v = new Vector3().crossVectors(normal, u).normalize();

    return neighbors
      .map(ni => {
        const diff = vertices[ni].clone().sub(vertices[vi]);
        const angle = Math.atan2(diff.dot(v), diff.dot(u));
        return { index: ni, angle };
      })
      .sort((a, b) => a.angle - b.angle)
      .map(entry => entry.index);
  });

  // Walk face cycles using the "next edge in face" rule:
  // Given directed edge (prev -> current), the next edge in the face is
  // (current -> next) where next is the neighbor of current that comes
  // JUST BEFORE prev in the CCW-sorted adjacency of current (i.e., the
  // first CW neighbor after prev, which gives the leftmost turn).
  const visitedEdges = new Set();
  const faces = [];

  for (let i = 0; i < n; i++) {
    for (const j of sortedAdj[i]) {
      const edgeKey = `${i}-${j}`;
      if (visitedEdges.has(edgeKey)) continue;

      // Walk the face starting with directed edge i -> j
      const face = [];
      let prev = i;
      let curr = j;
      let safety = 0;

      do {
        face.push(curr);
        visitedEdges.add(`${prev}-${curr}`);

        // Find index of prev in curr's sorted adjacency
        const adjCurr = sortedAdj[curr];
        const prevIdx = adjCurr.indexOf(prev);

        // Next vertex: the neighbor just BEFORE prev in CCW order
        // (which is the CW-next, giving the left turn for the face)
        const nextIdx = (prevIdx - 1 + adjCurr.length) % adjCurr.length;
        const next = adjCurr[nextIdx];

        prev = curr;
        curr = next;
        safety++;
      } while (curr !== face[0] && safety < 20);

      // Only keep valid pentagons and hexagons
      if (face.length === 5 || face.length === 6) {
        faces.push(face);
      }
    }
  }

  return faces;
}

/**
 * Create a THREE.Geometry for a truncated icosahedron.
 *
 * @returns {THREE.Geometry} with vertices and triangulated faces
 */
export default function createTruncatedIcosahedronGeometry() {
  const vertices = generateVertices();
  const polygonFaces = findFaces(vertices);

  const geometry = new Geometry();
  geometry.vertices = vertices;

  // Triangulate each polygon face using fan triangulation.
  // All faces are convex, so fan from vertex 0 works.
  for (const face of polygonFaces) {
    // Compute face center to determine winding
    const center = face
      .reduce((sum, vi) => sum.add(vertices[vi]), new Vector3())
      .divideScalar(face.length);

    // The outward normal should point away from origin
    const outward = center.clone().normalize();

    // Fan triangulation: face[0] -> face[i] -> face[i+1]
    for (let i = 1; i < face.length - 1; i++) {
      const a = face[0];
      const b = face[i];
      const c = face[i + 1];

      // Check winding: compute triangle normal
      const ab = vertices[b].clone().sub(vertices[a]);
      const ac = vertices[c].clone().sub(vertices[a]);
      const triNormal = ab.cross(ac);

      // If triangle normal points inward, flip winding
      if (triNormal.dot(outward) < 0) {
        geometry.faces.push(new Face3(a, c, b));
      } else {
        geometry.faces.push(new Face3(a, b, c));
      }
    }
  }

  geometry.computeFaceNormals();

  return geometry;
}


