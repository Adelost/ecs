// Object-form spawn helper to match CHAT.md style.
import { World } from './world';
import { Transform, Orientation, Parent, Orbit, Rotation, Renderable, Trail, Style } from './components';

declare module './world' {
  interface World {
    spawnWith(spec: Partial<{
      transform: typeof Transform extends infer _ ? any : never;
      orientation: typeof Orientation extends infer _ ? any : never;
      parent: { parentEid: number };
      orbit: typeof Orbit extends infer _ ? any : never;
      rotation: typeof Rotation extends infer _ ? any : never;
      renderable: typeof Renderable extends infer _ ? any : never;
      trail: typeof Trail extends infer _ ? any : never;
      style: { mode: 'realistic' | 'imphenzia' };
    }>): number;
  }
}

World.prototype.spawnWith = function (spec) {
  const e = this.spawn();
  if (spec.transform) this.attach(e, Transform as any, spec.transform);
  if (spec.orientation) this.attach(e, Orientation as any, spec.orientation);
  if (spec.parent) this.attach(e, Parent as any, spec.parent);
  if (spec.orbit) this.attach(e, Orbit as any, spec.orbit);
  if (spec.rotation) this.attach(e, Rotation as any, spec.rotation);
  if (spec.renderable) this.attach(e, Renderable as any, spec.renderable);
  if (spec.trail) this.attach(e, Trail as any, spec.trail);
  if (spec.style) this.attach(e, Style as any, spec.style);
  return e;
};

