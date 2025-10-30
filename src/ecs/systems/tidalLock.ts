import { World } from '../world';
import { Rotation, Orbit, TidalLock } from '../components';

// Synchronize spin with orbital motion for tidally locked bodies.
// - Sets Rotation.spinRate = Orbit.angularSpeed each frame (keeps sign for retrograde)
// - Leaves Rotation.angle evolution to RotationSystem (preserves any initial phase)
export function TidalLockSystem(_dt: number, _t: number, w: World) {
  const entries = w.query(Rotation, Orbit, TidalLock);
  for (const [_e, rot, orb] of entries) {
    rot.spinRate = orb.angularSpeed;
  }
}

