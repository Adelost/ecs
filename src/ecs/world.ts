// Minimal ECS world with entities, component stores, and systems.
// Focused on DX for our solar-system demo; hot loops should use direct writes.

export type Eid = number;

export type ComponentKey<T> = symbol & { __type?: T };

export function component<T>(name: string): ComponentKey<T> {
  return Symbol.for(`comp:${name}`) as ComponentKey<T>;
}

type StoreRecord = { store: Map<Eid, any>; version: number };
export type ComponentStore = Map<ComponentKey<any>, StoreRecord>;

export type SystemFn = (dt: number, t: number, w: World) => void;

type Phase = 'early' | 'update' | 'late';

export class World {
  private nextEid: Eid = 1;
  private stores: ComponentStore = new Map();
  private systems: { fn: SystemFn; phase: Phase; name: string }[] = [];
  private t = 0;
  private frame = 0;
  private resources = new Map<string | symbol, any>();
  // Observers
  private onAttachMap = new Map<ComponentKey<any>, Set<(e: Eid) => void>>();
  private onDetachMap = new Map<ComponentKey<any>, Set<(e: Eid) => void>>();
  private onChangeMap = new Map<ComponentKey<any>, Set<(e: Eid) => void>>();
  // Cached queries
  private cachedQueries: Array<{ comps: ComponentKey<any>[]; get: () => any[] }> = [];
  // Profiler
  private profilerEnabled = false;
  private profile: Map<string, { lastMs: number; avgMs: number; count: number }> = new Map();

  // Entities
  spawn(): Eid { return this.nextEid++; }
  despawn(e: Eid) {
    for (const rec of this.stores.values()) rec.store.delete(e);
  }

  // Components
  attach<T>(e: Eid, key: ComponentKey<T>, data: T) {
    let rec = this.stores.get(key);
    if (!rec) { rec = { store: new Map(), version: 0 }; this.stores.set(key, rec); }
    rec.store.set(e, data);
    rec.version++;
    this.emitObs(this.onAttachMap, key, e);
  }
  get<T>(e: Eid, key: ComponentKey<T>): T | undefined {
    const rec = this.stores.get(key);
    return rec ? (rec.store.get(e) as T | undefined) : undefined;
  }
  has(e: Eid, key: ComponentKey<any>): boolean { return !!this.get(e, key); }
  detach(e: Eid, key: ComponentKey<any>) {
    const rec = this.stores.get(key);
    if (rec && rec.store.delete(e)) {
      rec.version++;
      this.emitObs(this.onDetachMap, key, e);
    }
  }
  mutate<T>(e: Eid, key: ComponentKey<T>, fn: (data: T) => void) {
    const rec = this.stores.get(key); if (!rec) return;
    const v = rec.store.get(e); if (v === undefined) return;
    fn(v);
    rec.version++;
    this.emitObs(this.onChangeMap, key, e);
  }
  touch(e: Eid, key: ComponentKey<any>) {
    const rec = this.stores.get(key); if (!rec) return;
    rec.version++;
    this.emitObs(this.onChangeMap, key, e);
  }

  // Queries (simple; for performance we can add caching later)
  query<T1>(c1: ComponentKey<T1>): [Eid, T1][];
  query<T1, T2>(c1: ComponentKey<T1>, c2: ComponentKey<T2>): [Eid, T1, T2][];
  query<T1, T2, T3>(c1: ComponentKey<T1>, c2: ComponentKey<T2>, c3: ComponentKey<T3>): [Eid, T1, T2, T3][];
  query(...comps: ComponentKey<any>[]): any[] {
    if (comps.length === 0) return [];
    const [head, ...rest] = comps;
    const headStore = this.stores.get(head)?.store;
    if (!headStore) return [];
    const out: any[] = [];
    headStore.forEach((headVal, eid) => {
      const tuple: any[] = [eid, headVal];
      for (const c of rest) {
        const rec = this.stores.get(c);
        if (!rec) return;
        const v = rec.store.get(eid);
        if (v === undefined) return;
        tuple.push(v);
      }
      if (tuple.length === comps.length + 1) out.push(tuple as any);
    });
    return out;
  }

  // Cached queries: returns a function that returns cached result until any component store version changes
  cached<T1>(c1: ComponentKey<T1>): () => [Eid, T1][];
  cached<T1, T2>(c1: ComponentKey<T1>, c2: ComponentKey<T2>): () => [Eid, T1, T2][];
  cached<T1, T2, T3>(c1: ComponentKey<T1>, c2: ComponentKey<T2>, c3: ComponentKey<T3>): () => [Eid, T1, T2, T3][];
  cached(...comps: ComponentKey<any>[]) {
    const getVersions = () => comps.map(c => this.stores.get(c)?.version ?? 0).join('|');
    let ver = '';
    let data: any[] = [];
    let lastFrame = -1;
    let rebuildsInFrame = 0;
    const getter = () => {
      const now = getVersions();
      if (now !== ver) { ver = now; data = this.query(...comps); }
      // Watchdog: warn if we rebuild same query too many times in the same frame
      if (this.frame === lastFrame) rebuildsInFrame++; else { lastFrame = this.frame; rebuildsInFrame = 1; }
      if (rebuildsInFrame > 3) {
        console.warn('[ECS] Cached query rebuilt', rebuildsInFrame, 'times in one frame for comps:', comps.map(c=>String(c)).join(','));
      }
      return data;
    };
    this.cachedQueries.push({ comps, get: getter });
    return getter;
  }

  // Scheduling
  system(fn: SystemFn, phase: Phase = 'update', name = 'anon'): this {
    this.systems.push({ fn, phase, name });
    return this;
  }

  step(dt: number) {
    this.t += dt;
    const run = (phase: Phase) => {
      for (const s of this.systems) if (s.phase === phase) {
        if (!this.profilerEnabled) { s.fn(dt, this.t, this); }
        else {
          const t0 = performance.now();
          s.fn(dt, this.t, this);
          const t1 = performance.now();
          const ms = t1 - t0;
          const rec = this.profile.get(s.name) ?? { lastMs: 0, avgMs: 0, count: 0 };
          rec.lastMs = ms;
          rec.count += 1;
          rec.avgMs = rec.avgMs === 0 ? ms : (rec.avgMs * 0.9 + ms * 0.1);
          this.profile.set(s.name, rec);
        }
      }
    };
    this.frame++;
    run('early');
    run('update');
    run('late');
  }

  setResource<T>(key: string | symbol, value: T) { this.resources.set(key, value); }
  getResource<T>(key: string | symbol): T { return this.resources.get(key); }

  // Observers
  onAttach<T>(Comp: ComponentKey<T>, fn: (e: Eid) => void) { return this.addObs(this.onAttachMap, Comp, fn); }
  onDetach<T>(Comp: ComponentKey<T>, fn: (e: Eid) => void) { return this.addObs(this.onDetachMap, Comp, fn); }
  onChange<T>(Comp: ComponentKey<T>, fn: (e: Eid) => void) { return this.addObs(this.onChangeMap, Comp, fn); }
  private addObs<T>(map: Map<ComponentKey<any>, Set<(e: Eid) => void>>, key: ComponentKey<T>, fn: (e: Eid) => void) {
    let set = map.get(key); if (!set) { set = new Set(); map.set(key, set); }
    set.add(fn);
    return () => set!.delete(fn);
  }

  // Batching: defer observer firing during bulk changes
  private batchDepth = 0;
  private pendingObs: Array<{ map: Map<ComponentKey<any>, Set<(e: Eid) => void>>; key: ComponentKey<any>; eid: Eid }> = [];
  batch(fn: () => void) {
    this.batchDepth++;
    try { fn(); } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) {
        const events = this.pendingObs.slice();
        this.pendingObs.length = 0;
        for (const ev of events) {
          const set = ev.map.get(ev.key); if (!set) continue;
          set.forEach(cb => cb(ev.eid));
        }
      }
    }
  }
  private emitObs(map: Map<ComponentKey<any>, Set<(e: Eid) => void>>, key: ComponentKey<any>, eid: Eid) {
    if (this.batchDepth > 0) { this.pendingObs.push({ map, key, eid }); return; }
    const set = map.get(key); if (!set) return; set.forEach(cb => cb(eid));
  }

  // Profiler
  enableProfiler(on: boolean = true) { this.profilerEnabled = on; }
  getProfilerSnapshot(): Array<{ system: string; lastMs: number; avgMs: number }> {
    const rows: Array<{ system: string; lastMs: number; avgMs: number }> = [];
    this.profile.forEach((v, k) => { rows.push({ system: k, lastMs: v.lastMs, avgMs: v.avgMs }); });
    return rows.sort((a, b) => b.avgMs - a.avgMs);
  }

  // (Optional) object-form spawn helper can be added later following project schema
}

// Sentinel parent id
export const NO_PARENT: Eid = 0xFFFFFFFF as number;
