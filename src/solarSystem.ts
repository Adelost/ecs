import { createEngine } from './engine';
import { Axis, type ObjectConfig, type LightConfig, type PaletteMaterial, type AtmosphereConfig, type RingsConfig } from './types';
import { World } from './ecs/world';
import { Transform as CTransform, Orientation as COrientation, Orbit as COrbit, Rotation as CRotation, Renderable as CRenderable, Parent as CParent, TidalLock as CTidalLock } from './ecs/components';
import { OrbitSystem } from './ecs/systems/orbit';
import { RotationSystem } from './ecs/systems/rotation';
import { TidalLockSystem } from './ecs/systems/tidalLock';
import { RenderSystem } from './ecs/systems/render';
import { RingsSystem } from './ecs/systems/rings';
import { CloudsSystem } from './ecs/systems/clouds';
// Stylized mode (no ephemerides): we use our animation system

// Time configuration
// One Earth day = 2 minutes real time (default), everything else derived from that.
const REAL_SECONDS_PER_EARTH_DAY = 2 * 60; // 2 minutes
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
    
    Templates.planet('mercury', 'sun', 5, ORBIT_FREQ.mercury * EARTH_ORBIT_SPEED, { size: 0.5, tilt: 0.03, spinSpeed: ROTATION_SPEED.mercury, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/planets/mercury.png', bump: '/assets/planets/mercury-bump.jpg', usePhong: true } as any }),
    Templates.planet('venus', 'sun', 7, ORBIT_FREQ.venus * EARTH_ORBIT_SPEED, { size: 0.9, tilt: 177.36, spinSpeed: ROTATION_SPEED.venus, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/planets/venus.png', bump: '/assets/planets/venus-bump.jpg', usePhong: true } as any }),
    Templates.planet('earth', 'sun', 10, ORBIT_FREQ.earth * EARTH_ORBIT_SPEED, { size: 1, tilt: 23.44, spinSpeed: ROTATION_SPEED.earth, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/planets/earth.png', bump: '/assets/planets/earth-bump.jpg', specular: '/assets/planets/earth-specular.jpg', usePhong: true } as any, atmosphere: { map: '/assets/planets/earth-clouds.jpg', alpha: '/assets/planets/earth-clouds-alpha.jpg', scale: 1.03, spinSpeed: 0.005 } }),
    // Moon with proper texture and bump; tidally locked by equal orbit/spin speeds
    Templates.planet('moon', 'earth', 1.8, MOON_ORBIT_SPEED, {
      size: 0.3,
      tilt: 6.68,
      spinSpeed: MOON_ORBIT_SPEED,
      segments: { width: 48, height: 24 },
      material: { type: 'map', map: '/assets/planets/moon.png', bump: '/assets/planets/moon-bump.jpg', usePhong: true } as any
    }),
    Templates.planet('mars', 'sun', 13, ORBIT_FREQ.mars * EARTH_ORBIT_SPEED, { size: 0.7, tilt: 25.19, spinSpeed: ROTATION_SPEED.mars, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/planets/mars.png', bump: '/assets/planets/mars-bump.jpg', usePhong: true } as any }),
    Templates.planet('jupiter', 'sun', 18, ORBIT_FREQ.jupiter * EARTH_ORBIT_SPEED, { size: 2.2, tilt: 3.13, spinSpeed: ROTATION_SPEED.jupiter, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/planets/jupiter.png', usePhong: true } as any }),
    // Jupiter's Galilean moons (tidally locked)
    Templates.planet('io', 'jupiter', 1.4, MOON_EXTRA_SPEED.io, { size: 0.35, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.io, segments: { width: 48, height: 24 }, material: { type: 'map', map: '/assets/moons/io.jpg', usePhong: true } as any }),
    Templates.planet('europa', 'jupiter', 1.8, MOON_EXTRA_SPEED.europa, { size: 0.32, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.europa, segments: { width: 48, height: 24 }, material: { type: 'map', map: '/assets/moons/europa.jpg', usePhong: true } as any }),
    Templates.planet('ganymede', 'jupiter', 2.3, MOON_EXTRA_SPEED.ganymede, { size: 0.50, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.ganymede, segments: { width: 48, height: 24 }, material: { type: 'map', map: '/assets/moons/ganymede.jpg', usePhong: true } as any }),
    Templates.planet('callisto', 'jupiter', 2.8, MOON_EXTRA_SPEED.callisto, { size: 0.46, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.callisto, segments: { width: 48, height: 24 }, material: { type: 'map', map: '/assets/moons/callisto.jpg', usePhong: true } as any }),
    Templates.planet('saturn', 'sun', 24, ORBIT_FREQ.saturn * EARTH_ORBIT_SPEED, { size: 1.9, tilt: 26.73, spinSpeed: ROTATION_SPEED.saturn, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/planets/saturn.png', usePhong: true } as any, rings: { texture: '/assets/rings/saturn.png', inner: 1.23, outer: 2.30 } }),
    Templates.planet('titan', 'saturn', 2.4, MOON_EXTRA_SPEED.titan, { size: 0.45, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.titan, segments: { width: 48, height: 24 }, material: { type: 'map', map: '/assets/moons/titan.webp', usePhong: true } as any }),
    Templates.planet('uranus', 'sun', 30, ORBIT_FREQ.uranus * EARTH_ORBIT_SPEED, { size: 1.4, tilt: 97.77, spinSpeed: ROTATION_SPEED.uranus, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/planets/uranus.png', usePhong: true } as any, rings: { texture: '/assets/rings/uranus.png', inner: 1.70, outer: 2.05 } }),
    Templates.planet('neptune', 'sun', 36, ORBIT_FREQ.neptune * EARTH_ORBIT_SPEED, { size: 1.3, tilt: 28.32, spinSpeed: ROTATION_SPEED.neptune, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/planets/neptune.png', usePhong: true } as any }),
    Templates.planet('triton', 'neptune', 1.8, MOON_EXTRA_SPEED.triton, { size: 0.30, tilt: 0, spinSpeed: MOON_EXTRA_SPEED.triton, segments: { width: 48, height: 24 }, material: { type: 'map', map: '/assets/moons/triton.jpg', usePhong: true } as any }),
    Templates.planet('pluto', 'sun', 42, ORBIT_FREQ.pluto * EARTH_ORBIT_SPEED, { size: 0.4, color: '#8D6E63', tilt: 120, spinSpeed: ROTATION_SPEED.pluto })
  ],
  lighting: [
    { type: 'ambient', color: 0xffffff, intensity: 0.08 }
  ] as LightConfig[]
};

// Style flag: default to Imphenzia (palette) look, allow override via ?style=realistic
function isImphenziaDefault() {
  const params = new URLSearchParams(window.location.search);
  const style = (params.get('style') || '').toLowerCase();
  if (style === 'realistic') return false;
  if (style === 'imph' || style === 'imphenzia' || style === 'palette') return true;
  return false; // default OFF until fully tuned
}

function mapToImphenziaMaterial(id: string, mat: any): PaletteMaterial | null {
  // Sun and rings/cloud sprites: skip
  if (id === 'sun') return null;
  // Prefer quantized from existing texture to preserve recognizable features
  let textureSrc: string | undefined;
  if (mat && typeof mat === 'object' && (mat as any).type === 'map' && (mat as any).map) {
    textureSrc = (mat as any).map as string;
  }
  // Gas giants: latitude bands (no textureSrc), higher band count
  if (id === 'jupiter' || id === 'saturn' || id === 'uranus' || id === 'neptune') {
    return {
      type: 'palette',
      mode: 'latitude',
      lighting: 'quantized',
      bands: 11
    } as PaletteMaterial;
  }
  // Others: quantize from texture for recognizable features
  return {
    type: 'palette',
    mode: 'ndotL',
    lighting: 'quantized',
    bands: 6,
    ...(textureSrc ? { textureSrc } : {})
  } as PaletteMaterial;
}

function withStyle(objects: ObjectConfig[], imphenzia: boolean): ObjectConfig[] {
  if (!imphenzia) return objects;
  // Override map materials with palette materials for spheres (except sun).
  return objects.map(o => {
    if (o.type !== 'sphere') return o;
    const m = mapToImphenziaMaterial(o.id, o.material);
    if (!m) return o;
    return { ...o, material: m } as ObjectConfig;
  });
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
    interactions: { enableDrawing: true, enableSelection: true, enablePan: true, enableZoom: true }
  });

  document.body.style.backgroundColor = theme.background;
  document.documentElement.style.backgroundColor = theme.background;

  // Minimal speed UI with labeled marks and reverse toggle
  setupSpeedUI();

  SOLAR_SYSTEM.lighting.forEach(light => { engine.objects.addLight(light); });
  const enableImph = isImphenziaDefault();
  const styledObjects = withStyle(SOLAR_SYSTEM.objects, enableImph);

  // ECS world setup
  const world = new World();
  const renderSystem = new RenderSystem(engine);
  // Register systems
  world.system((dt,t,w)=>OrbitSystem(dt,t,w), 'update', 'Orbit');
  world.system((dt,t,w)=>TidalLockSystem(dt,t,w), 'update', 'TidalLock');
  world.system((dt,t,w)=>RotationSystem(dt,t,w), 'update', 'Rotation');
  world.system((dt,t,w)=>RingsSystem(dt,t,w), 'update', 'Rings');
  world.system((dt,t,w)=>CloudsSystem(dt,t,w), 'update', 'Clouds');
  world.setResource('render', { getInst: (eid: number)=> renderSystem.getInst(eid) });
  world.system((_dt,_t,w)=>{ renderSystem.update(w); }, 'late', 'Render');

  // Create entities from styledObjects
  const idToEid = new Map<string, number>();
  for (const obj of styledObjects) {
    const e = world.spawn();
    idToEid.set(obj.id, e);
    // Transform + Orientation
    world.attach(e, CTransform, { x: 0, y: 0 });
    // Rotation axis from tilt
    let axis = { x: 0, y: 0, z: 1 };
    const rotAnim = (obj.animations ?? []).find(a => a.type === 'rotate');
    if (rotAnim) axis = { x: rotAnim.axis.x, y: rotAnim.axis.y, z: rotAnim.axis.z };
    world.attach(e, COrientation, { axis, angle: 0 });
    // Rotation spin
    const spinSpeed = (rotAnim?.speed ?? 0) * Math.PI * 2; // rot/sec → rad/s
    world.attach(e, CRotation, { axis, spinRate: spinSpeed, angle: 0 });
    // Orbit (if parent)
    if (obj.parent) {
      const orbitAnim = (obj.animations ?? []).find(a => a.type === 'orbit');
      const radius = orbitAnim?.radius ?? 0;
      const angSpeed = (orbitAnim?.speed ?? 0) * Math.PI * 2;
      world.attach(e, COrbit, { parent: null, radius, angularSpeed: angSpeed, angle: 0 });
      world.attach(e, CParent, { parent: null });
      // Heuristic: attach TidalLock if rotate and orbit speeds match (within small epsilon)
      if (rotAnim && orbitAnim) {
        const rotRps = rotAnim.speed ?? 0;
        const orbRps = orbitAnim.speed ?? 0;
        if (Math.abs(rotRps - orbRps) < 1e-6) {
          world.attach(e, CTidalLock, {});
        }
      }
    }
    // Renderable
    const size = obj.size ?? 1;
    const material = obj.material as any;
    world.attach(e, CRenderable, { id: obj.id, size, material, label: (typeof obj.label === 'string' ? obj.label : undefined), rings: obj.rings as any, atmosphere: obj.atmosphere as any, trail: !!obj.trail, glow: (obj as any).glow });
  }
  // Resolve parents
  for (const obj of styledObjects) {
    if (!obj.parent) continue;
    const child = idToEid.get(obj.id)!;
    const parent = idToEid.get(obj.parent)!;
    const o = world.get(child, COrbit); if (o) o.parent = parent;
    const p = world.get(child, CParent); if (p) p.parent = parent;
  }


  window.addEventListener('resize', () => { engine.setCanvasSize(container.clientWidth, container.clientHeight); });

  let lastTime = 0;
  function animate(time: number) {
    const rawDt = Math.min((time - lastTime) / 1000, 0.1);
    const dt = rawDt * SOLAR_SYSTEM.timeScale;
    lastTime = time;
    // Pass both dt (sim time) and rawDt (real time) so trail sampling can throttle by real-time seconds
    // Step ECS (orbits/rotations), then update render system in 'late' phase
    world.step(dt);
    // Keep engine systems (rings/trails/labels) updating
    engine.objects.update(dt, rawDt);
    engine.render();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

bootstrap();

function setupSpeedUI() {
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '12px';
  wrap.style.bottom = '12px';
  wrap.style.padding = '8px 10px';
  wrap.style.background = 'rgba(0,0,0,0.35)';
  wrap.style.borderRadius = '6px';
  wrap.style.color = '#eee';
  wrap.style.font = '12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  wrap.style.zIndex = '1000';

  const label = document.createElement('div');
  label.textContent = 'Speed';
  label.style.marginBottom = '6px';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.001';
  slider.style.width = '280px';
  slider.style.display = 'block';

  const readout = document.createElement('div');
  readout.style.marginTop = '4px';
  readout.style.whiteSpace = 'pre';

  const marks = document.createElement('div');
  marks.style.position = 'relative';
  marks.style.width = slider.style.width;
  marks.style.height = '18px';
  marks.style.marginTop = '4px';

  wrap.appendChild(label);
  wrap.appendChild(slider);
  wrap.appendChild(marks);
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
    const yearSec = EARTH_YEAR_SECONDS / scaleAbs;
    const fmt = (s: number) => (s >= 60 ? (s/60).toFixed(1) + 'm' : s.toFixed(1) + 's');
    const sign = reverse ? '-' : '';
    readout.textContent = `Earth: day ${fmt(daySec)}  •  year ${fmt(yearSec)}  (${sign}×${scaleAbs.toFixed(3)})`;
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

  // Preset marks
  const presets: Array<{ label: string; scale: number } >= [
    { label: 'real-time', scale: REALTIME_SCALE },
    { label: '1d/min', scale: REAL_SECONDS_PER_EARTH_DAY / 60 },
    { label: '1d/2s',  scale: DAY_PER_2S_SCALE },
    { label: '1d/s',   scale: REAL_SECONDS_PER_EARTH_DAY / 1 },
    { label: '1y/min', scale: EARTH_YEAR_SECONDS / 60 },
    { label: '1y/s',   scale: FAST_TIMESCALE },
  ];

  function addMark(labelText: string, t: number, onClick: () => void) {
    const tick = document.createElement('div');
    tick.style.position = 'absolute';
    tick.style.left = `${(t * 100).toFixed(2)}%`;
    tick.style.top = '0';
    tick.style.width = '0';
    tick.style.height = '8px';
    tick.style.borderLeft = '2px solid #bbb';
    tick.style.transform = 'translateX(-1px)';

    const lbl = document.createElement('div');
    lbl.textContent = labelText;
    lbl.style.position = 'absolute';
    lbl.style.top = '8px';
    lbl.style.transform = 'translateX(-50%)';
    lbl.style.color = '#ddd';
    lbl.style.cursor = 'pointer';
    lbl.style.userSelect = 'none';
    lbl.style.fontSize = '11px';
    lbl.addEventListener('click', () => { onClick(); });

    const holder = document.createElement('div');
    holder.style.position = 'absolute';
    holder.style.left = `${(t * 100).toFixed(2)}%`;
    holder.style.width = '0';
    holder.appendChild(tick);
    holder.appendChild(lbl);
    marks.appendChild(holder);
  }

  presets.forEach(p => {
    const t = timescaleToSlider(p.scale);
    addMark(p.label, t, () => {
      slider.value = `${t}`;
      applyScaleFromSlider();
    });
  });

  // Reverse toggle
  const reverseBtn = document.createElement('button');
  reverseBtn.textContent = 'Reverse time';
  reverseBtn.style.marginTop = '6px';
  reverseBtn.style.padding = '2px 6px';
  reverseBtn.style.border = '1px solid #888';
  reverseBtn.style.borderRadius = '4px';
  reverseBtn.style.background = 'rgba(255,255,255,0.08)';
  reverseBtn.style.color = '#eee';
  reverseBtn.style.cursor = 'pointer';
  reverseBtn.addEventListener('click', () => {
    reverse = !reverse;
    reverseBtn.style.background = reverse ? 'rgba(255,80,80,0.25)' : 'rgba(255,255,255,0.08)';
    // Re-apply with same magnitude
    const t = parseFloat(slider.value);
    const scaleAbs = sliderToTimescale(t);
    updateReadout(scaleAbs);
  });
  wrap.appendChild(reverseBtn);

  // Style toggle (Imphenzia vs Realistic) – default ON
  const styleWrap = document.createElement('div');
  styleWrap.style.marginTop = '6px';
  const styleLabel = document.createElement('label');
  styleLabel.style.cursor = 'pointer';
  const styleCheckbox = document.createElement('input');
  styleCheckbox.type = 'checkbox';
  styleCheckbox.checked = isImphenziaDefault();
  styleCheckbox.style.marginRight = '6px';
  styleLabel.appendChild(styleCheckbox);
  styleLabel.appendChild(document.createTextNode('Imphenzia style'));
  styleWrap.appendChild(styleLabel);
  wrap.appendChild(styleWrap);

  styleCheckbox.addEventListener('change', () => {
    const params = new URLSearchParams(window.location.search);
    params.set('style', styleCheckbox.checked ? 'imph' : 'realistic');
    const url = `${window.location.pathname}?${params.toString()}`;
    window.location.replace(url);
  });

  // Initialize: set slider to default 1 day / 2 seconds and update
  slider.value = `${timescaleToSlider(DAY_PER_2S_SCALE)}`;
  applyScaleFromSlider();
}
