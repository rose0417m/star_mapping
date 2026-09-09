
import { SphereGeometry } from 'three';

export default function createSphereGeometry() {
  const geometry = new SphereGeometry(1, 64, 32);

  geometry.userData = {
    isSphere: true
  };

  return geometry;
}