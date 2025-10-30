import { createEngine } from './engine';
import { Axis, type ObjectConfig, type LightConfig, type PaletteMaterial, type AtmosphereConfig, type RingsConfig } from './types';
// Stylized mode (no ephemerides): we use our animation system

// Time configuration
const REAL_SECONDS_PER_EARTH_YEAR = 600; // 10 minutes real time = 1 Earth year
const EARTH_DAYS_PER_YEAR = 365.25; // Earth rotations per orbit

// Derived speeds (in rotations per simulation-second)
const TIME_SCALE = 1.0; // Simulation runs at real-time speed now
const EARTH_ORBIT_SPEED = 1 / REAL_SECONDS_PER_EARTH_YEAR;
const EARTH_ROTATION_SPEED = EARTH_ORBIT_SPEED * EARTH_DAYS_PER_YEAR;

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

// Calculate rotation speeds (rotations per simulation-second)
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
    
    Templates.planet('mercury', 'sun', 5, ORBIT_FREQ.mercury * EARTH_ORBIT_SPEED, { size: 0.5, tilt: 0.03, spinSpeed: ROTATION_SPEED.mercury, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/raw/solar-system/mercury.jpg', bump: '/assets/raw/solar-system/mercury-bump.jpg', usePhong: true } as any }),
    Templates.planet('venus', 'sun', 7, ORBIT_FREQ.venus * EARTH_ORBIT_SPEED, { size: 0.9, tilt: 177.36, spinSpeed: ROTATION_SPEED.venus, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/raw/solar-system/venus.jpg', bump: '/assets/raw/solar-system/venus-bump.jpg', usePhong: true } as any }),
    Templates.planet('earth', 'sun', 10, ORBIT_FREQ.earth * EARTH_ORBIT_SPEED, { size: 1, tilt: 23.44, spinSpeed: ROTATION_SPEED.earth, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/raw/solar-system/earth.jpg', bump: '/assets/raw/solar-system/earth-bump.jpg', specular: '/assets/raw/solar-system/earth-specular.jpg', usePhong: true } as any, atmosphere: { map: '/assets/raw/solar-system/earth-clouds.jpg', alpha: '/assets/raw/solar-system/earth-clouds-alpha.jpg', scale: 1.03, spinSpeed: 0.005 } }),
    Templates.moon('moon', 'earth', 1.8, MOON_ORBIT_SPEED, 0.3),
    Templates.planet('mars', 'sun', 13, ORBIT_FREQ.mars * EARTH_ORBIT_SPEED, { size: 0.7, tilt: 25.19, spinSpeed: ROTATION_SPEED.mars, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/raw/solar-system/mars.jpg', bump: '/assets/raw/solar-system/mars-bump.jpg', usePhong: true } as any }),
    Templates.planet('jupiter', 'sun', 18, ORBIT_FREQ.jupiter * EARTH_ORBIT_SPEED, { size: 2.2, tilt: 3.13, spinSpeed: ROTATION_SPEED.jupiter, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/raw/solar-system/jupiter.jpg', usePhong: true } as any }),
    Templates.planet('saturn', 'sun', 24, ORBIT_FREQ.saturn * EARTH_ORBIT_SPEED, { size: 1.9, tilt: 26.73, spinSpeed: ROTATION_SPEED.saturn, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/raw/solar-system/saturn.jpg', usePhong: true } as any, rings: { texture: '/assets/raw/solar-system/saturn-ring.png', inner: 1.23, outer: 2.30 } }),
    Templates.planet('uranus', 'sun', 30, ORBIT_FREQ.uranus * EARTH_ORBIT_SPEED, { size: 1.4, tilt: 97.77, spinSpeed: ROTATION_SPEED.uranus, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/raw/solar-system/uranus.jpg', usePhong: true } as any, rings: { texture: '/assets/raw/planetarium/fbx/0.5k_saturn_ring_alpha.png', inner: 1.70, outer: 2.05 } }),
    Templates.planet('neptune', 'sun', 36, ORBIT_FREQ.neptune * EARTH_ORBIT_SPEED, { size: 1.3, tilt: 28.32, spinSpeed: ROTATION_SPEED.neptune, segments: { width: 64, height: 32 }, material: { type: 'map', map: '/assets/raw/solar-system/neptune.jpg', usePhong: true } as any }),
    Templates.planet('pluto', 'sun', 42, ORBIT_FREQ.pluto * EARTH_ORBIT_SPEED, { size: 0.4, color: '#8D6E63', tilt: 120, spinSpeed: ROTATION_SPEED.pluto })
  ],
  lighting: [
    { type: 'ambient', color: 0xffffff, intensity: 0.08 }
  ] as LightConfig[]
};

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

  SOLAR_SYSTEM.lighting.forEach(light => { engine.objects.addLight(light); });
  SOLAR_SYSTEM.objects.forEach(config => { engine.objects.createObject(config); });
  engine.objects.wireParenting(SOLAR_SYSTEM.objects);
  engine.objects.attachAnimations(SOLAR_SYSTEM.objects);


  window.addEventListener('resize', () => { engine.setCanvasSize(container.clientWidth, container.clientHeight); });

  let lastTime = 0;
  function animate(time: number) {
    const rawDt = Math.min((time - lastTime) / 1000, 0.1);
    const dt = rawDt * SOLAR_SYSTEM.timeScale;
    lastTime = time;
    engine.objects.update(dt);
    engine.render();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

bootstrap();
