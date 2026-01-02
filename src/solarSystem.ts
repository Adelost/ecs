import { createEngine } from './engine';
import { Axis, type ObjectConfig, type LightConfig, type PaletteMaterial, type AtmosphereConfig, type RingsConfig } from './types';
import { World, NO_PARENT } from './ecs/world';

const BASE = import.meta.env.BASE_URL;
// Ensure World.prototype.spawnWith is registered
import './ecs/extensions';
import { ENGINE_DEFAULTS } from './types';
import { Style as CEStyle } from './ecs/components';
import { Transform as CTransform, Orientation as COrientation, Orbit as COrbit, Rotation as CRotation, Renderable as CRenderable, Parent as CParent, TidalLock as CTidalLock, Trail as CETrail } from './ecs/components';
import { OrbitSystem } from './ecs/systems/orbit';
import { RotationSystem } from './ecs/systems/rotation';
import { TidalLockSystem } from './ecs/systems/tidalLock';
import { RenderSystem } from './ecs/systems/render';
import { RingsSystem } from './ecs/systems/rings';
import { CloudsSystem } from './ecs/systems/clouds';
import { TrailSystem } from './ecs/systems/trail';
import { LabelSystem } from './ecs/systems/label';
import { MaterialSystem } from './ecs/systems/material';
// Stylized mode (no ephemerides): we use our animation system

// Time configuration
// One Earth day = 2 minutes real time (default), everything else derived from that.
const REAL_SECONDS_PER_EARTH_DAY = 10; // 1 day = 10 seconds
const EARTH_DAYS_PER_YEAR = 365.25;         // Earth rotations per orbit

// Derived speeds (in rotations per real second)
const TIME_SCALE = 1.0; // Simulation time factor (leave at 1 for real time)
const EARTH_ROTATION_SPEED = 1 / REAL_SECONDS_PER_EARTH_DAY; // 1 rotation per 20 min
const EARTH_YEAR_SECONDS = REAL_SECONDS_PER_EARTH_DAY * EARTH_DAYS_PER_YEAR;
const EARTH_ORBIT_SPEED = 1 / EARTH_YEAR_SECONDS; // 1 orbit per (365.25 * 20 min)

// Orbital periods (relative to Earth = 1.0)
const ORBIT_FREQ = {
  mercury: 4.158,
  venus: 1.626,
  earth: 1.0,
  mars: 0.532,
  jupiter: 0.0844,
  saturn: 0.034,
  uranus: 0.0119,
  neptune: 0.00606,
  pluto: 0.00404
} as const;

// Rotation periods (sidereal day length in Earth days)
const ROTATION_PERIOD_EARTH_DAYS = {
  mercury: 58.646,
  venus: 243.018,
  earth: 1.0,
  mars: 1.026,
  jupiter: 0.414,
  saturn: 0.444,
  uranus: 0.718,
  neptune: 0.671,
  pluto: 6.387,
  moon: 27.32 // Moon is tidally locked, but this is its orbital period
} as const;

// Calculate rotation speeds (rotations per real second)
const ROTATION_SPEED = {
  mercury: EARTH_ROTATION_SPEED / ROTATION_PERIOD_EARTH_DAYS.mercury,
  venus: -EARTH_ROTATION_SPEED / ROTATION_PERIOD_EARTH_DAYS.venus, // retrograde
  earth: EARTH_ROTATION_SPEED,
  mars: EARTH_ROTATION_SPEED / ROTATION_PERIOD_EARTH_DAYS.mars,
  jupiter: EARTH_ROTATION_SPEED / ROTATION_PERIOD_EARTH_DAYS.jupiter,
  saturn: EARTH_ROTATION_SPEED / ROTATION_PERIOD_EARTH_DAYS.saturn,
  uranus: EARTH_ROTATION_SPEED / ROTATION_PERIOD_EARTH_DAYS.uranus,
  neptune: EARTH_ROTATION_SPEED / ROTATION_PERIOD_EARTH_DAYS.neptune,
  pluto: EARTH_ROTATION_SPEED / ROTATION_PERIOD_EARTH_DAYS.pluto
} as const;

// Moon orbital speed (orbits Earth once per 27.32 Earth days)
const MOON_ORBIT_SPEED = EARTH_ROTATION_SPEED / ROTATION_PERIOD_EARTH_DAYS.moon;

// Interesting moons: orbital periods in Earth days (approx). Speeds derive from baseline (1 day = 2 minutes)
const MOON_PERIOD_DAYS = {
  io: 1.769,
  europa: 3.551,
  ganymede: 7.155,
  callisto: 16.689,
  titan: 15.945,
  triton: 5.877 // retrograde
} as const;
const speedFromDays = (d: number) => EARTH_ROTATION_SPEED / d;
const MOON_EXTRA_SPEED = {
  io: speedFromDays(MOON_PERIOD_DAYS.io),
  europa: speedFromDays(MOON_PERIOD_DAYS.europa),
  ganymede: speedFromDays(MOON_PERIOD_DAYS.ganymede),
  callisto: speedFromDays(MOON_PERIOD_DAYS.callisto),
  titan: speedFromDays(MOON_PERIOD_DAYS.titan),
  triton: -speedFromDays(MOON_PERIOD_DAYS.triton) // retrograde orbit
} as const;

const Templates = {
  star: (id: string, size = 3, color = '#FFA726'): ObjectConfig => ({
    id,
    type: 'sphere',
    position: [0, 0] as const,
    size,
    color,
    label: 'Sun',
    material: 'shiny',
    glow: {
      size: size * 2,
      intensity: 1.2,
      color: color,
      light: { color: '#ffffff', intensity: 12, distance: 0, decay: 1, shadow: { mapSize: 4096, near: 0.1, far: 500, bias: -0.00005, normalBias: 0.03 } }
    },
    animations: [{ type: 'rotate', axis: Axis.Z, speed: 0.1 }]
  }),
  planet: (
    id: string,
    parent: string,
    orbitRadius: number,
    orbitSpeed: number,
    config: { size?: number; color?: string; tilt?: number; spinSpeed?: number; material?: ('default' | 'shiny' | 'matte' | 'metal') | PaletteMaterial; segments?: { width?: number; height?: number }; atmosphere?: AtmosphereConfig; rings?: RingsConfig }
  ): ObjectConfig => ({
    id,
    parent,
    type: 'sphere',
    position: [0, 0] as const,
    size: config.size ?? 1,
    color: config.color,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    material: config.material ?? 'default',
    segments: config.segments,
    animations: [
      { type: 'orbit', axis: Axis.Z, radius: orbitRadius, speed: orbitSpeed },
      { type: 'rotate', axis: (() => { if (!config.tilt) return Axis.Z; const r = (config.tilt * Math.PI) / 180; return { x: 0, y: Math.sin(r), z: Math.cos(r) }; })(), speed: (config.spinSpeed ?? 2) }
    ],
    trail: true,
    atmosphere: config.atmosphere,
    rings: config.rings
  }),
  moon: (id: string, parent: string, radius: number, speed: number, size = 0.3, color = '#BDBDBD'): ObjectConfig => ({
    id,
    parent,
    type: 'sphere',
    position: [0, 0] as const,
    size,
    color,
    label: 'Moon',
    material: 'matte',
    animations: [
      { type: 'orbit', axis: Axis.Z, radius, speed },
      { type: 'rotate', axis: Axis.Z, speed }
    ],
    trail: true
  })
};

const SOLAR_SYSTEM = {
  timeScale: TIME_SCALE,
  objects: [
    Templates.star('sun', 3, '#FFA726'),
    
    Templates.planet('mercury', 'sun', 5, ORBIT_FREQ.mercury * EARTH_ORBIT_SPEED, { size: 0.5, tilt: 0.03, spinSpeed: ROTATION_SPEED.mercury, material: { type: 'map', map: `${BASE}assets/planets/mercury.png`, bump: `${BASE}assets/planets/mercury-bump.jpg`, usePhong: true } as any }),
    Templates.planet('venus', 'sun', 7, ORBIT_FREQ.venus * EARTH_ORBIT_SPEED, { size: 0.9, tilt: 177.36, spinSpeed: ROTATION_SPEED.venus, material: { type: 'map', map: `${BASE}assets/planets/venus.png`, bump: `${BASE}assets/planets/venus-bump.jpg`, usePhong: true } as any }),
    Templates.planet('earth', 'sun', 10, ORBIT_FREQ.earth * EARTH_ORBIT_SPEED, { size: 1, tilt: 23.44, spinSpeed: ROTATION_SPEED.earth, material: { type: 'map', map: `${BASE}assets/planets/earth.png`, bump: `${BASE}assets/planets/earth-bump.jpg`, specular: `${BASE}assets/planets/earth-specular.jpg`, usePhong: true } as any, atmosphere: { map: `${BASE}assets/planets/earth-clouds.jpg`, alpha: `${BASE}assets/planets/earth-clouds-alpha.jpg`, scale: 1.03, spinSpeed: 0.005 } }),
    // Moon with proper texture and bump; tidally locked by equal orbit/spin speeds
    Templates.planet('moon', 'earth', 1.8, MOON_ORBIT_SPEED, {
      size: 0.3,
      tilt: 6.68,
      spinSpeed: MOON_ORBIT_SPEED,
      material: { type: 'map', map: `${BASE}assets/planets/moon.png`, bump: `${BASE}assets/planets/moon-bump.jpg`, usePhong: true } as any
    }),
    Templates.planet('mars', 'sun', 13, ORBIT_FREQ.mars * EARTH_ORBIT_SPEED, { size: 0.7, tilt: 25.19, spinSpeed: ROTATION_SPEED.mars, material: { type: 'map', map: `${BASE}assets/planets/mars.png`, bump: `${BASE}assets/planets/mars-bump.jpg`, usePhong: true } as any }),
    Templates.planet('jupiter', 'sun', 18, ORBIT_FREQ.jupiter * EARTH_ORBIT_SPEED, { size: 2.2, tilt: 3.13, spinSpeed: ROTATION_SPEED.jupiter, material: { type: 'map', map: `${BASE}assets/planets/jupiter.png`, usePhong: true } as any }),
    // Jupiter's Galilean moons (tidally locked)
    Templates.planet('io', 'jupiter', 1.4, MOON_EXTRA_SPEED.io, { size: 0.35, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.io, material: { type: 'map', map: `${BASE}assets/moons/io.jpg`, usePhong: true } as any }),
    Templates.planet('europa', 'jupiter', 1.8, MOON_EXTRA_SPEED.europa, { size: 0.32, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.europa, material: { type: 'map', map: `${BASE}assets/moons/europa.jpg`, usePhong: true } as any }),
    Templates.planet('ganymede', 'jupiter', 2.3, MOON_EXTRA_SPEED.ganymede, { size: 0.50, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.ganymede, material: { type: 'map', map: `${BASE}assets/moons/ganymede.jpg`, usePhong: true } as any }),
    Templates.planet('callisto', 'jupiter', 2.8, MOON_EXTRA_SPEED.callisto, { size: 0.46, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.callisto, material: { type: 'map', map: `${BASE}assets/moons/callisto.jpg`, usePhong: true } as any }),
    Templates.planet('saturn', 'sun', 24, ORBIT_FREQ.saturn * EARTH_ORBIT_SPEED, { size: 1.9, tilt: 26.73, spinSpeed: ROTATION_SPEED.saturn, material: { type: 'map', map: `${BASE}assets/planets/saturn.png`, usePhong: true } as any, rings: { texture: `${BASE}assets/rings/saturn.png`, inner: 1.23, outer: 2.30 } }),
    Templates.planet('titan', 'saturn', 2.4, MOON_EXTRA_SPEED.titan, { size: 0.45, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.titan, material: { type: 'map', map: `${BASE}assets/moons/titan.webp`, usePhong: true } as any }),
    Templates.planet('uranus', 'sun', 30, ORBIT_FREQ.uranus * EARTH_ORBIT_SPEED, { size: 1.4, tilt: 97.77, spinSpeed: ROTATION_SPEED.uranus, material: { type: 'map', map: `${BASE}assets/planets/uranus.png`, usePhong: true } as any, rings: { texture: `${BASE}assets/rings/uranus.png`, inner: 1.70, outer: 2.05 } }),
    Templates.planet('neptune', 'sun', 36, ORBIT_FREQ.neptune * EARTH_ORBIT_SPEED, { size: 1.3, tilt: 28.32, spinSpeed: ROTATION_SPEED.neptune, material: { type: 'map', map: `${BASE}assets/planets/neptune.png`, usePhong: true } as any }),
    Templates.planet('triton', 'neptune', 1.8, MOON_EXTRA_SPEED.triton, { size: 0.30, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.triton, material: { type: 'map', map: `${BASE}assets/moons/triton.jpg`, usePhong: true } as any }),
    Templates.planet('pluto', 'sun', 42, ORBIT_FREQ.pluto * EARTH_ORBIT_SPEED, { size: 0.4, color: '#8D6E63', tilt: 120, spinSpeed: ROTATION_SPEED.pluto })
  ],
  lighting: [
    { type: 'ambient', color: 0xffffff, intensity: 0.08 }
  ] as LightConfig[]
};

function withStyle(objects: ObjectConfig[], stylized: boolean): ObjectConfig[] {
  // ECS MaterialSystem handles stylized mode; do not override materials here.
  return objects;
}

function bootstrap() {
  const container = document.getElementById('app');
  if (!(container instanceof HTMLDivElement)) throw new Error('Missing #app container');

  const theme = {
    background: '#34495e',
    grid: '#23313f',
    line: '#1abc9c',
    dot: '#e74c3c',
    geometry: '#e74c3c',
    selection: '#FFD700'
  };

  const engine = createEngine({
    container,
    theme,
    grid: { spacing: 2, extent: 128, normal: { opacity: 0.35, width: 0.02 }, major: { every: 10, width: 0.06, opacity: 0.9 } },
    interactions: { enableDrawing: false, enableSelection: true, enablePan: true, enableZoom: true }
  });

  document.body.style.backgroundColor = theme.background;
  document.documentElement.style.backgroundColor = theme.background;

  // Minimal speed UI with labeled marks and reverse toggle (after world exists)

  SOLAR_SYSTEM.lighting.forEach(light => { engine.objects.addLight(light); });
  const styledObjects = SOLAR_SYSTEM.objects;

  // ECS world setup
  const world = new World();
  const renderSystem = new RenderSystem(engine);
  // Register systems
  world.system(OrbitSystem, 'update', 'Orbit');
  world.system(TidalLockSystem, 'update', 'TidalLock');
  world.system(RotationSystem, 'update', 'Rotation');
  world.system(RingsSystem, 'update', 'Rings');
  world.system(CloudsSystem, 'update', 'Clouds');
  world.system(TrailSystem, 'update', 'Trail');
  // Render first so geometry/detail changes are applied before material baking
  world.setResource('render', { getInst: (eid: number)=> renderSystem.getInst(eid), drawLine: (x1:number,y1:number,x2:number,y2:number)=> renderSystem.drawLine(x1,y1,x2,y2), addTextLabel: (text:string,pos:any,opts?:any)=> engine.addTextLabel(text,pos,opts), setAutoSubdiv: (n:number)=> renderSystem.setAutoSubdiv(n), getAutoSubdiv: ()=> (renderSystem as any).icoSubdivisions });
  world.system((_dt,_t,w)=>{ renderSystem.update(w); }, 'late', 'Render');
  // Then bake materials for the now-current geometry
  world.system(MaterialSystem, 'late', 'Material');
  world.system((_dt,_t,w)=>{ LabelSystem(_dt,_t,w); }, 'late', 'Labels');
  // Build UI now that world exists (engine-level UI toolkit)
  setupControls(engine, world);

  // Create entities from styledObjects using batch and spawnWith
  const idToEid = new Map<string, number>();
  world.batch(() => {
    for (const obj of styledObjects) {
      // Rotation axis from tilt
      let axis = { x: 0, y: 0, z: 1 };
      const rotAnim = (obj.animations ?? []).find(a => a.type === 'rotate');
      if (rotAnim) axis = { x: rotAnim.axis.x, y: rotAnim.axis.y, z: rotAnim.axis.z };
      const spinRate = (rotAnim?.speed ?? 0) * Math.PI * 2;
      const orbitAnim = (obj.animations ?? []).find(a => a.type === 'orbit');
      const radius = orbitAnim?.radius ?? 0;
      const angSpeed = (orbitAnim?.speed ?? 0) * Math.PI * 2;
      const size = obj.size ?? 1;
      const material = obj.material as any;
      const e = (world as any).spawnWith({
        transform: { x: 0, y: 0 },
        orientation: { axis, angle: 0 },
        rotation: { axis, spinRate, angle: 0 },
        orbit: obj.parent ? { parentEid: NO_PARENT, radius, angularSpeed: angSpeed, angle: 0 } : undefined,
        parent: obj.parent ? { parentEid: NO_PARENT } : undefined,
        renderable: { id: obj.id, size, material, label: (typeof obj.label === 'string' ? obj.label : undefined), rings: obj.rings as any, atmosphere: obj.atmosphere as any, trail: !!obj.trail, glow: (obj as any).glow },
        style: { mode: 'auto' },
        trail: obj.trail ? { step: 20 / ENGINE_DEFAULTS.viewport.zoom.initial, cap: 300, lines: [] } : undefined
      });
      idToEid.set(obj.id, e);
      // Heuristic tidal lock
      if (rotAnim && orbitAnim && obj.parent && Math.abs((rotAnim.speed ?? 0) - (orbitAnim.speed ?? 0)) < 1e-6) {
        world.attach(e, CTidalLock, {});
      }
    }
  });
  // Resolve parents
  for (const obj of styledObjects) {
    if (!obj.parent) continue;
    const child = idToEid.get(obj.id)!;
    const parent = idToEid.get(obj.parent)!;
    const o = world.get(child, COrbit); if (o) o.parentEid = parent;
    const p = world.get(child, CParent); if (p) p.parentEid = parent;
  }


  window.addEventListener('resize', () => { engine.setCanvasSize(container.clientWidth, container.clientHeight); });

  // Center camera on Earth (at distance 10 from sun) with higher zoom
  const view = engine.getView();
  const earthX = 10;
  engine.setView({ x: earthX - view.size.width / 2, y: -view.size.height / 2 }, 200);

  let lastTime = 0;
  function animate(time: number) {
    const rawDt = Math.min((time - lastTime) / 1000, 0.1);
    const dt = rawDt * SOLAR_SYSTEM.timeScale;
    lastTime = time;
    // Step ECS (orbits/rotations); RenderSystem runs in 'late' phase
    world.step(dt);
    engine.render();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

bootstrap();

// New, engine-integrated UI controls (reusable across demos)
function setupControls(engine: ReturnType<typeof createEngine>, world: World) {
  const panel = engine.ui.createPanel({ position: 'bottom-left', title: 'Time Speed', minWidth: 260 });
  const presetRow = document.createElement('div'); presetRow.className = 'ui-row'; panel.el.appendChild(presetRow);
  const sliderCtl = panel.addSlider({ min: 0, max: 1, step: 0.001 });
  const readout = panel.addText({ text: '' });

  // Timescale definitions
  const FAST_TIMESCALE = EARTH_YEAR_SECONDS; // 1y/s
  const REALTIME_SCALE = REAL_SECONDS_PER_EARTH_DAY / (24 * 60 * 60);
  const DAY_PER_2S_SCALE = REAL_SECONDS_PER_EARTH_DAY / 2;
  let reverse = false;

  function updateReadout(scaleAbs: number) {
    const signed = reverse ? -scaleAbs : scaleAbs;
    const daySec = REAL_SECONDS_PER_EARTH_DAY / scaleAbs;
    const fmt = (s: number) => { if (s >= 3600) return `${(s/3600).toFixed(1)}h`; if (s >= 60) return `${(s/60).toFixed(1)}m`; return `${s.toFixed(1)}s`; };
    if (reverse) readout.innerHTML = `<span style="color: #ff6b6b;">← REVERSE</span> • 1 day = ${fmt(daySec)}`;
    else readout.textContent = `1 day = ${fmt(daySec)}`;
    SOLAR_SYSTEM.timeScale = signed;
  }
  function sliderToTimescale(t: number) { const a = Math.log(FAST_TIMESCALE); const b = Math.log(REALTIME_SCALE); return Math.exp(a * t + b * (1 - t)); }
  function timescaleToSlider(scale: number) { const a = Math.log(FAST_TIMESCALE); const b = Math.log(REALTIME_SCALE); const s = Math.max(Math.min(scale, FAST_TIMESCALE), REALTIME_SCALE); return Math.max(0, Math.min(1, (Math.log(s) - b) / (a - b))); }
  function applyScaleFromSlider() { const t = parseFloat(sliderCtl.input.value); const scaleAbs = sliderToTimescale(t); updateReadout(scaleAbs); }
  sliderCtl.input.addEventListener('input', applyScaleFromSlider);

  // Presets + reverse
  const presets: Array<{ label: string; scale: number }> = [
    { label: '1d/min', scale: REAL_SECONDS_PER_EARTH_DAY / 60 },
    { label: '1d/s',   scale: REAL_SECONDS_PER_EARTH_DAY / 1 },
    { label: '1y/min', scale: EARTH_YEAR_SECONDS / 60 },
  ];
  function createChip(labelText: string, scale: number) { const chip = document.createElement('button'); chip.className='ui-chip'; chip.textContent=labelText; chip.addEventListener('click',()=>{ const t = timescaleToSlider(scale); sliderCtl.input.value = `${t}`; applyScaleFromSlider(); }); return chip; }
  const reverseChip = document.createElement('button'); reverseChip.className='ui-chip'; reverseChip.textContent='← Reverse'; presetRow.appendChild(reverseChip);
  reverseChip.addEventListener('click',(e)=>{ e.stopPropagation(); reverse=!reverse; const t = parseFloat(sliderCtl.input.value); const scaleAbs = sliderToTimescale(t); updateReadout(scaleAbs); reverseChip.style.background = reverse? 'rgba(255,107,107,0.4)': 'rgba(255,255,255,0.1)'; reverseChip.style.borderColor = reverse? 'rgba(255,107,107,0.7)':'rgba(255,255,255,0.3)'; reverseChip.style.color = reverse? '#ffcccc':'#fff'; });
  presets.forEach(p => presetRow.appendChild(createChip(p.label, p.scale)));

  panel.addDivider();
  const styleRow = document.createElement('div'); styleRow.className='ui-row'; panel.el.appendChild(styleRow);
  const styleLabel = document.createElement('div'); styleLabel.textContent='Style:'; styleLabel.style.fontSize='11px'; styleLabel.style.opacity='0.7'; styleLabel.style.marginRight='4px';
  function mkStyleBtn(text: string) { const b = document.createElement('button'); b.className='ui-chip'; b.style.flex='1'; b.textContent=text; return b; }
  const texturedBtn = mkStyleBtn('Textured'); const autoBtn = mkStyleBtn('Low-poly');
  autoBtn.style.background = 'rgba(29,185,84,0.3)'; autoBtn.style.borderColor = 'rgba(29,185,84,0.6)';
  texturedBtn.addEventListener('click', (e)=>{ e.stopPropagation(); texturedBtn.style.background='rgba(29,185,84,0.3)'; texturedBtn.style.borderColor='rgba(29,185,84,0.6)'; autoBtn.style.background='rgba(255,255,255,0.1)'; autoBtn.style.borderColor='rgba(255,255,255,0.3)'; const entries = (world as any).query(CEStyle, CRenderable) as Array<[number, any, any]>; for (const [eid] of entries) { (world as any).mutate(eid, CEStyle, (s: any) => { s.mode = 'textured'; }); } });
  autoBtn.addEventListener('click', (e)=>{ e.stopPropagation(); autoBtn.style.background='rgba(29,185,84,0.3)'; autoBtn.style.borderColor='rgba(29,185,84,0.6)'; texturedBtn.style.background='rgba(255,255,255,0.1)'; texturedBtn.style.borderColor='rgba(255,255,255,0.3)'; const entries = (world as any).query(CEStyle, CRenderable) as Array<[number, any, any]>; for (const [eid] of entries) { (world as any).mutate(eid, CEStyle, (s: any) => { s.mode = 'auto'; }); } });
  styleRow.appendChild(styleLabel); styleRow.appendChild(texturedBtn); styleRow.appendChild(autoBtn);

  panel.addHeader('Detail');
  const detailSliderCtl = panel.addSlider({ min: 0, max: 20, step: 1, value: 4 });
  const detailInfo = document.createElement('div'); detailInfo.style.fontSize='11px'; detailInfo.style.opacity='0.8'; detailInfo.style.textAlign='center'; detailInfo.style.marginTop='4px'; panel.el.appendChild(detailInfo);
  function updateDetailInfo(){ const n = parseInt(detailSliderCtl.input.value, 10); const faces = 20 * (n + 1) * (n + 1); const label = n === 0 ? 'Icosahedron' : `Subdiv ${n}`; detailInfo.textContent = `${label} • triangles ${faces.toLocaleString()}`; }
  detailSliderCtl.input.addEventListener('input', ()=>{ const n = parseInt(detailSliderCtl.input.value, 10); const res:any = (world as any).getResource('render'); if (res?.setAutoSubdiv) res.setAutoSubdiv(n); updateDetailInfo(); }); updateDetailInfo();

  panel.addProfiler(
    () => ((world as any).getProfilerSnapshot() as Array<{ system: string; lastMs: number; avgMs: number }>).map(r => ({ system: r.system, avgMs: r.avgMs })),
    (on: boolean) => { (world as any).enableProfiler(on); }
  );

  sliderCtl.input.value = `${timescaleToSlider(DAY_PER_2S_SCALE)}`; applyScaleFromSlider();
}

/* Legacy UI (deprecated): replaced by setupControls using engine.ui */
function setupSpeedUI(world: World) {
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '12px';
  wrap.style.bottom = '12px';
  wrap.style.padding = '12px';
  wrap.style.background = 'rgba(0,0,0,0.6)';
  wrap.style.borderRadius = '8px';
  wrap.style.color = '#fff';
  wrap.style.font = '13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  wrap.style.zIndex = '1000';
  wrap.style.backdropFilter = 'blur(8px)';
  wrap.style.minWidth = '240px';

  // Header with label
  const header = document.createElement('div');
  header.style.marginBottom = '8px';
  header.style.fontSize = '11px';
  header.style.textTransform = 'uppercase';
  header.style.letterSpacing = '0.5px';
  header.style.opacity = '0.7';
  header.textContent = 'Time Speed';

  // Preset chips
  const presetRow = document.createElement('div');
  presetRow.style.display = 'flex';
  presetRow.style.gap = '6px';
  presetRow.style.marginBottom = '10px';
  presetRow.style.flexWrap = 'wrap';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.001';
  slider.style.width = '100%';
  slider.style.display = 'block';
  slider.style.margin = '8px 0';
  slider.style.cursor = 'pointer';
  // CRITICAL: Set explicit height for proper track rendering
  slider.style.height = '6px';
  slider.style.padding = '0';
  slider.style.boxSizing = 'border-box';

  // Complete slider styles - all pseudo-elements needed for visibility
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    /* Base slider element */
    input[type="range"] {
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      width: 100%;
      height: 6px;
      background: transparent;
      outline: none;
      padding: 0;
      margin: 8px 0;
    }

    /* Webkit (Chrome/Safari/Edge) Track */
    input[type="range"]::-webkit-slider-runnable-track {
      width: 100%;
      height: 6px;
      background: rgba(255,255,255,0.6) !important;
      border-radius: 3px;
      cursor: pointer;
    }

    /* Webkit Thumb */
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      background: #fff;
      border-radius: 50%;
      cursor: pointer;
      border: 2px solid rgba(0,0,0,0.3);
      margin-top: -7px;
      position: relative;
    }

    input[type="range"]::-webkit-slider-thumb:hover {
      background: #ffffff;
      box-shadow: 0 0 6px rgba(255,255,255,0.8);
    }

    /* Firefox Track */
    input[type="range"]::-moz-range-track {
      width: 100%;
      height: 6px;
      background: rgba(255,255,255,0.6) !important;
      border-radius: 3px;
      cursor: pointer;
    }

    /* Firefox Thumb */
    input[type="range"]::-moz-range-thumb {
      width: 20px;
      height: 20px;
      background: #fff;
      border: 2px solid rgba(0,0,0,0.3);
      border-radius: 50%;
      cursor: pointer;
    }

    input[type="range"]::-moz-range-thumb:hover {
      background: #ffffff;
      box-shadow: 0 0 6px rgba(255,255,255,0.8);
    }

    /* Edge/IE Track (legacy) */
    input[type="range"]::-ms-track {
      width: 100%;
      height: 6px;
      background: transparent;
      border-color: transparent;
      color: transparent;
      cursor: pointer;
    }

    input[type="range"]::-ms-fill-lower {
      background: rgba(255,255,255,0.6);
      border-radius: 3px;
    }

    input[type="range"]::-ms-fill-upper {
      background: rgba(255,255,255,0.6);
      border-radius: 3px;
    }

    input[type="range"]::-ms-thumb {
      width: 20px;
      height: 20px;
      background: #fff;
      border: 2px solid rgba(0,0,0,0.3);
      border-radius: 50%;
      cursor: pointer;
      margin-top: 0;
    }
  `;
  document.head.appendChild(styleEl);

  const readout = document.createElement('div');
  readout.style.fontSize = '12px';
  readout.style.opacity = '0.9';
  readout.style.marginTop = '6px';
  readout.style.textAlign = 'center';

  wrap.appendChild(header);
  wrap.appendChild(presetRow);
  wrap.appendChild(slider);
  wrap.appendChild(readout);
  document.body.appendChild(wrap);

  // Timescale definitions
  // Fast end = 1 year / 1s (compress a full year into one second)
  const FAST_TIMESCALE = EARTH_YEAR_SECONDS; // 1y/s
  // Slow end = real-time: Earth day takes 24h = 86400s
  const REALTIME_SCALE = REAL_SECONDS_PER_EARTH_DAY / (24 * 60 * 60);
  // Preset target for default: 1 day takes 2 seconds
  const DAY_PER_2S_SCALE = REAL_SECONDS_PER_EARTH_DAY / 2;
  // Slider spans [REALTIME .. FAST] with right = faster (t=0 slow, t=1 fast)

  let reverse = false;

  function updateReadout(scaleAbs: number) {
    const signed = reverse ? -scaleAbs : scaleAbs;
    const daySec = REAL_SECONDS_PER_EARTH_DAY / scaleAbs;
    const fmt = (s: number) => {
      if (s >= 3600) return `${(s/3600).toFixed(1)}h`;
      if (s >= 60) return `${(s/60).toFixed(1)}m`;
      return `${s.toFixed(1)}s`;
    };
    if (reverse) {
      readout.innerHTML = `<span style="color: #ff6b6b;">← REVERSE</span> • 1 day = ${fmt(daySec)}`;
    } else {
      readout.textContent = `1 day = ${fmt(daySec)}`;
    }
    SOLAR_SYSTEM.timeScale = signed;
  }

  function sliderToTimescale(t: number) {
    // t in [0..1]; t=0 => SLOW (real-time), t=1 => FAST (1y/min)
    // Use exponential (log) interpolation for a smoother feel across large range
    const a = Math.log(FAST_TIMESCALE);
    const b = Math.log(REALTIME_SCALE);
    const v = Math.exp(a * t + b * (1 - t));
    return v;
  }

  function timescaleToSlider(scale: number) {
    const a = Math.log(FAST_TIMESCALE);
    const b = Math.log(REALTIME_SCALE);
    const s = Math.max(Math.min(scale, FAST_TIMESCALE), REALTIME_SCALE);
    const t = (Math.log(s) - b) / (a - b);
    return Math.max(0, Math.min(1, t));
  }

  function applyScaleFromSlider() {
    const t = parseFloat(slider.value);
    const scaleAbs = sliderToTimescale(t);
    updateReadout(scaleAbs);
  }

  slider.addEventListener('input', applyScaleFromSlider);

  // Preset chips (minimal set)
  const presets: Array<{ label: string; scale: number } >= [
    { label: '1d/min', scale: REAL_SECONDS_PER_EARTH_DAY / 60 },
    { label: '1d/s',   scale: REAL_SECONDS_PER_EARTH_DAY / 1 },
    { label: '1y/min', scale: EARTH_YEAR_SECONDS / 60 },
  ];

  function createChip(labelText: string, scale: number) {
    const chip = document.createElement('button');
    chip.textContent = labelText;
    chip.style.padding = '4px 10px';
    chip.style.border = '1px solid rgba(255,255,255,0.3)';
    chip.style.borderRadius = '12px';
    chip.style.background = 'rgba(255,255,255,0.1)';
    chip.style.color = '#fff';
    chip.style.cursor = 'pointer';
    chip.style.fontSize = '11px';
    chip.style.fontWeight = '500';
    chip.style.transition = 'all 0.2s';
    chip.style.userSelect = 'none';
    chip.addEventListener('mouseenter', () => {
      chip.style.background = 'rgba(255,255,255,0.2)';
      chip.style.borderColor = 'rgba(255,255,255,0.5)';
    });
    chip.addEventListener('mouseleave', () => {
      chip.style.background = 'rgba(255,255,255,0.1)';
      chip.style.borderColor = 'rgba(255,255,255,0.3)';
    });
    chip.addEventListener('click', () => {
      const t = timescaleToSlider(scale);
      slider.value = `${t}`;
      applyScaleFromSlider();
    });
    return chip;
  }

  // Reverse toggle as chip (create without default click handler) - add FIRST
  const reverseChip = document.createElement('button');
  reverseChip.textContent = '← Reverse';
  reverseChip.style.padding = '4px 10px';
  reverseChip.style.border = '1px solid rgba(255,255,255,0.3)';
  reverseChip.style.borderRadius = '12px';
  reverseChip.style.background = 'rgba(255,255,255,0.1)';
  reverseChip.style.color = '#fff';
  reverseChip.style.cursor = 'pointer';
  reverseChip.style.fontSize = '11px';
  reverseChip.style.fontWeight = '500';
  reverseChip.style.transition = 'all 0.2s';
  reverseChip.style.userSelect = 'none';

  reverseChip.addEventListener('mouseenter', () => {
    if (!reverse) {
      reverseChip.style.background = 'rgba(255,255,255,0.2)';
      reverseChip.style.borderColor = 'rgba(255,255,255,0.5)';
    }
  });
  reverseChip.addEventListener('mouseleave', () => {
    if (!reverse) {
      reverseChip.style.background = 'rgba(255,255,255,0.1)';
      reverseChip.style.borderColor = 'rgba(255,255,255,0.3)';
    }
  });
  reverseChip.addEventListener('click', (e) => {
    e.stopPropagation();
    reverse = !reverse;
    if (reverse) {
      reverseChip.style.background = 'rgba(255,107,107,0.4)';
      reverseChip.style.borderColor = 'rgba(255,107,107,0.7)';
      reverseChip.style.color = '#ffcccc';
    } else {
      reverseChip.style.background = 'rgba(255,255,255,0.1)';
      reverseChip.style.borderColor = 'rgba(255,255,255,0.3)';
      reverseChip.style.color = '#fff';
    }
    const t = parseFloat(slider.value);
    const scaleAbs = sliderToTimescale(t);
    updateReadout(scaleAbs);
  });
  presetRow.appendChild(reverseChip);

  // Add speed presets after reverse
  presets.forEach(p => {
    presetRow.appendChild(createChip(p.label, p.scale));
  });

  // Style toggle as divider
  const divider = document.createElement('div');
  divider.style.borderTop = '1px solid rgba(255,255,255,0.15)';
  divider.style.margin = '10px 0 8px 0';
  wrap.appendChild(divider);

  const styleRow = document.createElement('div');
  styleRow.style.display = 'flex';
  styleRow.style.gap = '6px';
  styleRow.style.alignItems = 'center';

  const styleLabel = document.createElement('div');
  styleLabel.textContent = 'Style:';
  styleLabel.style.fontSize = '11px';
  styleLabel.style.opacity = '0.7';
  styleLabel.style.marginRight = '4px';

  function mkStyleBtn(text: string) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.padding = '4px 10px';
    btn.style.border = '1px solid rgba(255,255,255,0.3)';
    btn.style.borderRadius = '12px';
    btn.style.background = 'rgba(255,255,255,0.1)';
    btn.style.color = '#fff';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '11px';
    btn.style.fontWeight = '500';
    btn.style.transition = 'all 0.2s';
    btn.style.userSelect = 'none';
    btn.style.flex = '1';
    return btn;
  }

  const texturedBtn = mkStyleBtn('Textured');
  const autoBtn = mkStyleBtn('Low-poly');
  // Default selected: Low-poly
  autoBtn.style.background = 'rgba(29,185,84,0.3)';
  autoBtn.style.borderColor = 'rgba(29,185,84,0.6)';

  texturedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    texturedBtn.style.background = 'rgba(29,185,84,0.3)';
    texturedBtn.style.borderColor = 'rgba(29,185,84,0.6)';
    autoBtn.style.background = 'rgba(255,255,255,0.1)';
    autoBtn.style.borderColor = 'rgba(255,255,255,0.3)';
    const entries = (world as any).query(CEStyle, CRenderable) as Array<[number, any, any]>;
    for (const [eid] of entries) {
      (world as any).mutate(eid, CEStyle, (s: any) => { s.mode = 'textured'; });
    }
  });

  autoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    autoBtn.style.background = 'rgba(29,185,84,0.3)';
    autoBtn.style.borderColor = 'rgba(29,185,84,0.6)';
    texturedBtn.style.background = 'rgba(255,255,255,0.1)';
    texturedBtn.style.borderColor = 'rgba(255,255,255,0.3)';
    const entries = (world as any).query(CEStyle, CRenderable) as Array<[number, any, any]>;
    for (const [eid] of entries) {
      (world as any).mutate(eid, CEStyle, (s: any) => { s.mode = 'auto'; });
    }
  });

  styleRow.appendChild(styleLabel);
  styleRow.appendChild(texturedBtn);
  styleRow.appendChild(autoBtn);
  wrap.appendChild(styleRow);

  // Detail slider (auto mode only): looks like the time slider
  const detailHeader = document.createElement('div');
  detailHeader.style.marginTop = '10px';
  detailHeader.style.marginBottom = '6px';
  detailHeader.style.fontSize = '11px';
  detailHeader.style.textTransform = 'uppercase';
  detailHeader.style.letterSpacing = '0.5px';
  detailHeader.style.opacity = '0.7';
  detailHeader.textContent = 'Detail';
  const detailSlider = document.createElement('input');
  detailSlider.type = 'range';
  detailSlider.min = '0';
  detailSlider.max = '20';
  detailSlider.step = '1';
  detailSlider.value = '4';
  detailSlider.style.width = '100%';
  detailSlider.style.display = 'block';
  detailSlider.style.margin = '8px 0';
  detailSlider.style.cursor = 'pointer';
  const detailInfo = document.createElement('div');
  detailInfo.style.fontSize = '11px';
  detailInfo.style.opacity = '0.8';
  detailInfo.style.textAlign = 'center';
  detailInfo.style.marginTop = '4px';
  function updateDetailInfo() {
    const n = parseInt(detailSlider.value, 10);
    // three@r169 IcosahedronGeometry detail grows ~quadratically:
    // triangles ≈ 20 * (detail + 1)^2
    const faces = 20 * (n + 1) * (n + 1);
    const label = n === 0 ? 'Icosahedron' : `Subdiv ${n}`;
    detailInfo.textContent = `${label} • triangles ${faces.toLocaleString()}`;
  }
  detailSlider.addEventListener('input', () => {
    const n = parseInt(detailSlider.value, 10);
    const res: any = (world as any).getResource('render');
    if (res?.setAutoSubdiv) res.setAutoSubdiv(n);
    updateDetailInfo();
  });
  wrap.appendChild(detailHeader);
  wrap.appendChild(detailSlider);
  wrap.appendChild(detailInfo);
  updateDetailInfo();

  // Profiler toggle
  const profChip = createChip('⚡ Profiler', 0);
  profChip.style.marginTop = '10px';
  profChip.style.width = '100%';
  const profPanel = document.createElement('pre');
  profPanel.style.margin = '6px 0 0 0';
  profPanel.style.padding = '8px';
  profPanel.style.background = 'rgba(0,0,0,0.4)';
  profPanel.style.borderRadius = '6px';
  profPanel.style.maxHeight = '140px';
  profPanel.style.overflow = 'auto';
  profPanel.style.display = 'none';
  profPanel.style.fontSize = '10px';
  profPanel.style.lineHeight = '1.4';
  profPanel.style.fontFamily = 'monospace';
  wrap.appendChild(profChip);
  wrap.appendChild(profPanel);

  let profEnabled = false;
  let profTimer: number | null = null;
  function refreshProfiler() {
    const rows = (world as any).getProfilerSnapshot() as Array<{ system: string; lastMs: number; avgMs: number }>;
    const lines = rows.map(r => `${r.system.padEnd(12)} ${r.avgMs.toFixed(2)}ms`);
    profPanel.textContent = lines.join('\n') || 'No data...';
  }
  profChip.addEventListener('click', (e) => {
    e.stopPropagation();
    profEnabled = !profEnabled;
    profChip.style.background = profEnabled ? 'rgba(252,211,77,0.3)' : 'rgba(255,255,255,0.1)';
    profChip.style.borderColor = profEnabled ? 'rgba(252,211,77,0.6)' : 'rgba(255,255,255,0.3)';
    (world as any).enableProfiler(profEnabled);
    profPanel.style.display = profEnabled ? 'block' : 'none';
    if (profTimer) { clearInterval(profTimer); profTimer = null; }
    if (profEnabled) {
      refreshProfiler();
      profTimer = window.setInterval(refreshProfiler, 1000) as unknown as number;
    }
  });

  // Initialize: set slider to default 1 day / 2 seconds and update
  slider.value = `${timescaleToSlider(DAY_PER_2S_SCALE)}`;
  applyScaleFromSlider();
}
