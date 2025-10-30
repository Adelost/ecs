import { World, NO_PARENT } from '../world';
import { Transform, Orbit } from '../components';

export function OrbitSystem(dt: number, _t: number, w: World) {
  // Cached query for hot loop
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (OrbitSystem as any)._q = (OrbitSystem as any)._q || w.cached(Transform, Orbit);
  const q = (OrbitSystem as any)._q as () => [number, any, any][];
  for (const [_e, t, o] of q()) {
    o.angle += o.angularSpeed * dt;
    const hasParent = o.parentEid !== NO_PARENT;
    const px = hasParent ? (w.get(o.parentEid, Transform)?.x ?? 0) : 0;
    const py = hasParent ? (w.get(o.parentEid, Transform)?.y ?? 0) : 0;
    t.x = px + Math.cos(o.angle) * o.radius;
    t.y = py + Math.sin(o.angle) * o.radius;
  }
}
