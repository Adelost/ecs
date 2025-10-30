import { World } from '../world';
import { Transform, Renderable } from '../components';

// Create/update text labels for ECS entities using engine's text layer.
export function LabelSystem(_dt: number, _t: number, w: World) {
  const render = w.getResource<{ getInst: (id: number) => any; addTextLabel: (text: string, pos: { x: number; y: number }, opts?: any) => any }>('render') as any;
  if (!render) return;
  // Cached query for Transform + Renderable
  (LabelSystem as any)._q = (LabelSystem as any)._q || w.cached(Transform, Renderable);
  const q = (LabelSystem as any)._q as () => [number, any, any][];
  const entries = q();
  for (const [e, t, r] of entries) {
    if (!r.label) continue;
    const inst = render.getInst(e);
    if (!inst) continue;
    // Ensure label sprite exists
    if (!inst.label) {
      inst.label = render.addTextLabel(r.label, { x: t.x, y: t.y }, { color: '#ffffff', worldHeight: 0.8, center: false });
    }
    // Position label above the object by a simple offset
    const offY = (r.size ?? 1) * 0.7 + 0.8 * 0.6;
    inst.label.position.set(t.x, t.y + offY, inst.label.position.z);
  }
}
