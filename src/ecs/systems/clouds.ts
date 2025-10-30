import { World } from '../world';
import { Renderable } from '../components';
import { Vector3 } from 'three';

// Apply cloud drift around local +Y; parent orientation is already applied by RenderSystem
export function CloudsSystem(dt: number, _t: number, w: World) {
  const render = w.getResource<{ getInst: (id: number) => any }>('render') as any;
  if (!render) return;
  // Cached query for Renderable entities
  (CloudsSystem as any)._q = (CloudsSystem as any)._q || w.cached(Renderable);
  const q = (CloudsSystem as any)._q as () => [number, any][];
  const entries = q();
  for (const [e, r] of entries) {
    const inst = render.getInst(e);
    if (!inst) continue;
    if (inst.clouds && inst.cloudSpin) {
      inst.clouds.rotateOnAxis(new Vector3(0, 1, 0), dt * inst.cloudSpin * Math.PI * 2);
    }
  }
}
