import { World } from '../world';
import { Rotation, Orientation } from '../components';

export function RotationSystem(dt: number, _t: number, w: World) {
  // Cached query for hot loop
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (RotationSystem as any)._q = (RotationSystem as any)._q || w.cached(Rotation, Orientation);
  const q = (RotationSystem as any)._q as () => [number, any, any][];
  for (const [_e, rot, orient] of q()) {
    rot.angle += rot.spinRate * dt;
    // Keep orientation axis in sync with rotation axis
    orient.axis = rot.axis;
    orient.angle = rot.angle;
  }
}
