import { World } from '../world';
import { Transform, Orbit } from '../components';

export function OrbitSystem(dt: number, _t: number, w: World) {
  const entries = w.query(Transform, Orbit);
  for (const [e, t, o] of entries) {
    o.angle += o.angularSpeed * dt;
    const px = (o.parent && w.get(o.parent, Transform)?.x) ?? 0;
    const py = (o.parent && w.get(o.parent, Transform)?.y) ?? 0;
    t.x = px + Math.cos(o.angle) * o.radius;
    t.y = py + Math.sin(o.angle) * o.radius;
  }
}

