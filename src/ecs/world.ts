// Minimal ECS world with entities, component stores, and systems.
// Focused on DX for our solar-system demo; hot loops should use direct writes.

export type Eid = number;

export type ComponentKey<T> = symbol & { __type?: T };

export function component<T>(name: string): ComponentKey<T> {
  return Symbol.for(`comp:${name}`) as ComponentKey<T>;
}

export type ComponentStore = Map<ComponentKey<any>, Map<Eid, any>>;

export type SystemFn = (dt: number, t: number, w: World) => void;

type Phase = 'early' | 'update' | 'late';

export class World {
  private nextEid: Eid = 1;
  private stores: ComponentStore = new Map();
  private systems: { fn: SystemFn; phase: Phase; name: string }[] = [];
  private t = 0;
  private resources = new Map<string | symbol, any>();

  // Entities
  spawn(): Eid { return this.nextEid++; }
  despawn(e: Eid) {
    for (const store of this.stores.values()) store.delete(e);
  }

  // Components
  attach<T>(e: Eid, key: ComponentKey<T>, data: T) {
    let store = this.stores.get(key);
    if (!store) { store = new Map(); this.stores.set(key, store); }
    store.set(e, data);
  }
  get<T>(e: Eid, key: ComponentKey<T>): T | undefined {
    const store = this.stores.get(key);
    return store ? (store.get(e) as T | undefined) : undefined;
  }
  has(e: Eid, key: ComponentKey<any>): boolean { return !!this.get(e, key); }
  detach(e: Eid, key: ComponentKey<any>) { const s = this.stores.get(key); if (s) s.delete(e); }

  // Queries (simple; for performance we can add caching later)
  query<T1>(c1: ComponentKey<T1>): [Eid, T1][];
  query<T1, T2>(c1: ComponentKey<T1>, c2: ComponentKey<T2>): [Eid, T1, T2][];
  query<T1, T2, T3>(c1: ComponentKey<T1>, c2: ComponentKey<T2>, c3: ComponentKey<T3>): [Eid, T1, T2, T3][];
  query(...comps: ComponentKey<any>[]): any[] {
    if (comps.length === 0) return [];
    const [head, ...rest] = comps;
    const headStore = this.stores.get(head);
    if (!headStore) return [];
    const out: any[] = [];
    headStore.forEach((headVal, eid) => {
      const tuple: any[] = [eid, headVal];
      for (const c of rest) {
        const s = this.stores.get(c);
        if (!s) return; // skip
        const v = s.get(eid);
        if (v === undefined) return;
        tuple.push(v);
      }
      if (tuple.length === comps.length + 1) out.push(tuple as any);
    });
    return out;
  }

  // Scheduling
  system(fn: SystemFn, phase: Phase = 'update', name = 'anon'): this {
    this.systems.push({ fn, phase, name });
    return this;
  }

  step(dt: number) {
    this.t += dt;
    const run = (phase: Phase) => {
      for (const s of this.systems) if (s.phase === phase) s.fn(dt, this.t, this);
    };
    run('early');
    run('update');
    run('late');
  }

  setResource<T>(key: string | symbol, value: T) { this.resources.set(key, value); }
  getResource<T>(key: string | symbol): T { return this.resources.get(key); }
}
