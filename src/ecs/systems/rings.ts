import { World } from '../world';
import { Orientation, Renderable } from '../components';
import { Quaternion, Vector3 } from 'three';

// Orient ring meshes in engine instances based on ECS Orientation/Renderable
export function RingsSystem(dt: number, _t: number, w: World) {
  const entries = w.query(Orientation, Renderable);
  for (const [e, o, r] of entries) {
    // Access engine instance via RenderSystem resource
    const render = w.getResource<{ getInst: (id: string) => any }>('render') as any;
    if (!render) continue;
    const inst = render.getInst(e);
    if (!inst) continue;
    if (!inst.rings || !inst.baseQuat) continue;
    const axis = new Vector3(o.axis.x, o.axis.y, o.axis.z).normalize();
    // Optional ring spin (from config): currently 0 by default
    const rate = 0;
    (inst as any).ringsSpinAngle = ((inst as any).ringsSpinAngle ?? 0) + rate * dt * Math.PI * 2;
    const qSpinWorld = rate !== 0 ? new Quaternion().setFromAxisAngle(axis, (inst as any).ringsSpinAngle) : null;
    inst.rings.forEach((rinfo: { mesh: any; qEq: Quaternion }) => {
      const baseEq = new Quaternion().multiplyQuaternions(inst.baseQuat as any, rinfo.qEq);
      if (qSpinWorld) rinfo.mesh.quaternion.multiplyQuaternions(qSpinWorld, baseEq);
      else rinfo.mesh.quaternion.copy(baseEq);
    });
  }
}
