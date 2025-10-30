import { World } from '../world';
import { Trail, Renderable } from '../components';
import { Vector3 } from 'three';
import { ENGINE_DEFAULTS } from '../../types';

// Draws trail segments every fixed world distance equivalent to 20 px at standard zoom.
export function TrailSystem(_dt: number, _t: number, w: World) {
  const render = w.getResource<{ getInst: (id: number) => any; drawLine: (x1:number,y1:number,x2:number,y2:number)=>any }>('render') as any;
  if (!render) return;
  const entries = w.query(Trail, Renderable);
  const step = 20 / ENGINE_DEFAULTS.viewport.zoom.initial;
  for (const [eid, trail, r] of entries) {
    const inst = render.getInst(eid);
    if (!inst) continue;
    // gate engine trail updates
    (inst.objRef as any).ecsControlTrails = true;
    const wp = new Vector3();
    inst.objRef.group.getWorldPosition(wp);
    if (!trail.last) { trail.last = { x: wp.x, y: wp.y }; continue; }
    let dx = wp.x - trail.last.x;
    let dy = wp.y - trail.last.y;
    let dist = Math.hypot(dx, dy);
    if (dist < step) continue;
    const ux = dx / dist;
    const uy = dy / dist;
    while (dist >= step) {
      const nx = trail.last.x + ux * step;
      const ny = trail.last.y + uy * step;
      const seg = render.drawLine(trail.last.x, trail.last.y, nx, ny);
      trail.lines.push(seg);
      // cap and dispose oldest
      while (trail.lines.length > trail.cap) {
        const old = trail.lines.shift();
        if (old) {
          old.geometry?.dispose?.();
          old.material?.dispose?.();
          old.parent && old.parent.remove(old);
        }
      }
      // fade across buffer
      const len = trail.lines.length;
      if (len > 0) {
        const minA = 0.08, maxA = 0.95;
        for (let i = 0; i < len; i++) {
          const t = (i + 1) / len;
          const a = minA + (maxA - minA) * t;
          const m = trail.lines[i].material; m.transparent = true; m.opacity = a; m.needsUpdate = true;
        }
      }
      trail.last = { x: nx, y: ny };
      dx = wp.x - trail.last.x;
      dy = wp.y - trail.last.y;
      dist = Math.hypot(dx, dy);
    }
  }
}

