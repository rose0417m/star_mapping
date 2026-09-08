import { SphereGeometry } from 'three';

export default function createSphereGeometry() {
  return new SphereGeometry(1, 32, 16);
}