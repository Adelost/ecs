import { World } from '../world';
import { Rotation, Orientation } from '../components';

export function RotationSystem(dt: number, _t: number, w: World) {
  const entries = w.query(Rotation, Orientation);
  for (const [e, rot, orient] of entries) {
    rot.angle += rot.spinRate * dt;
    // Keep orientation axis in sync with rotation axis
    orient.axis = rot.axis;
    orient.angle = rot.angle;
  }
}

