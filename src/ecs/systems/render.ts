import { Group, Mesh, Quaternion, Vector3 } from 'three';
import type { Engine } from '../../src/engine';
import { World } from '../world';
import { Transform, Orientation, Renderable } from '../components';

type Inst = { group: Group; mesh: Mesh; objRef: any };

export class RenderSystem {
  private map = new Map<number, Inst>();
  constructor(private engine: Engine) {}

  getInst(eid: number): Inst | undefined { return this.map.get(eid); }

  drawLine(x1: number, y1: number, x2: number, y2: number) {
    return this.engine.drawLine(x1, y1, x2, y2);
  }

  private ensure(e: number, r: any, axisVec: Vector3): Inst {
    let inst = this.map.get(e);
    if (inst) return inst;
    // Create via existing engine object system for consistency
    this.engine.objects.createObject({
      id: r.id,
      type: 'sphere',
      position: [0, 0],
      size: r.size,
      color: undefined,
      material: r.material,
      label: r.label ?? r.id,
      segments: r.material?.segments,
      rings: r.rings,
      atmosphere: r.atmosphere,
      glow: r.glow,
      trail: r.trail ?? true
    } as any);
    this.engine.objects.wireParenting([]); // no-op but keeps parity
    const obj = this.engine.objects.getObject(r.id);
    if (!obj) throw new Error('failed to create render object for ' + r.id);
    const qBase = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axisVec);
    // Populate engine instance fields used by ring/orbit helpers
    (obj as any).baseQuat = qBase;
    (obj as any).spinAxis = axisVec.clone();
    ((obj as any).mesh as any).__baseQuat = qBase;
    ((obj as any).mesh as any).__spinAxis = axisVec.clone();
    inst = { group: (obj as any).group, mesh: (obj as any).mesh, objRef: obj };
    this.map.set(e, inst);
    return inst;
  }

  update(w: World) {
    const entries = w.query(Transform, Orientation, Renderable);
    for (const [e, t, o, r] of entries) {
      const axis = new Vector3(o.axis.x, o.axis.y, o.axis.z).normalize();
      const inst = this.ensure(e, r, axis);
      inst.group.position.set(t.x, t.y, inst.group.position.z);
      // Compose quaternion: spin around axis then base (+Y → axis)
      const qSpin = new Quaternion().setFromAxisAngle(axis, o.angle);
      const qBase = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);
      inst.mesh.quaternion.multiplyQuaternions(qSpin, qBase);
    }
  }
}
