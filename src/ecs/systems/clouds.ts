import { World } from '../world';
import { Renderable } from '../components';
import { Vector3 } from 'three';

// Apply cloud drift around local +Y; parent orientation is already applied by RenderSystem
export function CloudsSystem(dt: number, _t: number, w: World) {
  const entries = w.query(Renderable);
  for (const [e, r] of entries) {
    const render = w.getResource<{ getInst: (id: string) => any }>('render') as any;
    if (!render) continue;
    const inst = render.getInst(e);
    if (!inst) continue;
    // Mark engine to skip its cloud updates
    (inst.objRef as any).ecsControlClouds = true;
    // Rotate any child with __cloudSpin property
    inst.objRef.mesh.children.forEach((child: any) => {
      const s: number | undefined = child.__cloudSpin;
      if (s) {
        child.rotateOnAxis(new Vector3(0, 1, 0), dt * s * Math.PI * 2);
      }
    });
  }
}

