import { Vector3 } from 'three';

const FACE_INDEX = 11;
const TARGET_DIAMETER_CM = 5;
const TARGET_RADIUS_CM = TARGET_DIAMETER_CM / 2;

export function getFace11CoordinateSystem(topology) {

  const face = topology.polygons[FACE_INDEX];

  if (!face) {
    throw new Error(`Face ${FACE_INDEX} does not exist`);
  }

  // --------------------------------------------------
  // Origin = center of face 11
  // --------------------------------------------------
  const center = face.center.clone();

  // --------------------------------------------------
  // Z axis = normal to face
  // --------------------------------------------------
  const zAxis = face.plane.normal.clone().normalize();

  // --------------------------------------------------
  // X axis = direction from face center to first vertex
  // --------------------------------------------------
  const xAxis = face.points[0]
    .clone()
    .sub(center)
    .normalize();

  // --------------------------------------------------
  // Y axis = perpendicular direction within the face
  // --------------------------------------------------
  const yAxis = zAxis
    .clone()
    .cross(xAxis)
    .normalize();

  // --------------------------------------------------
  // Circumscribed radius of face 11
  // --------------------------------------------------
  const circumradius = Math.max(
    ...face.points.map(point =>
      point.distanceTo(center)
    )
  );

  // --------------------------------------------------
  // Scale face so circumradius = 2.5 cm
  // --------------------------------------------------
  const scale = TARGET_RADIUS_CM / circumradius;

  return {
    face,
    center,
    xAxis,
    yAxis,
    zAxis,
    circumradius,
    diameter: circumradius * 2,
    scale
  };
}


export function pointToFace11Coordinates(
  point,
  coordinateSystem
) {

  const {
    center,
    xAxis,
    yAxis,
    scale
  } = coordinateSystem;

  const relative = point.clone().sub(center);

  return {
    x: relative.dot(xAxis) * scale,
    y: relative.dot(yAxis) * scale
  };
}