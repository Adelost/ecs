import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  TorusGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  PointLight,
  PCFSoftShadowMap,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RingGeometry,
  Quaternion,
  TextureLoader,
  Raycaster,
  Object3D,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  AdditiveBlending,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type {
  AnimationState,
  EngineConfig,
  GridConfig,
  LayerKey,
  LightConfig,
  MaterialConfig,
  PaletteMaterial,
  ObjectConfig,
  ObjectType,
  Theme,
  Vec2,
} from './types';
import { MATERIAL_PALETTE, nearestPaletteColor } from './palettes';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ENGINE_DEFAULTS, Layers, normalizePosition } from './types';
import { updateRingsForHost } from './systems/rings';
import { updateCloudsForHost } from './systems/clouds';

// Debug toggles (off for production)
const DEBUG_EQUATOR = false;
const DEBUG_EQUATOR_BIG = false; // big equator band ~2x radius
const DEBUG_RING_GUIDE = false;  // world-XY guide at ring extents
const DEBUG_AXIS = false;

import { createUI, type UIManager } from './ui';

export interface Engine {
  readonly renderer: WebGLRenderer;
  readonly composer: EffectComposer;
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  readonly grid: { snap(p: Vec2): Vec2 } | null;
  readonly objects: ReturnType<typeof createObjectSystem>;
  readonly ui: UIManager;
  addTextLabel(text: string, position: Vec2, options?: { color?: string; fontSize?: number; fontFamily?: string; worldHeight?: number; padding?: number; background?: string; center?: boolean }): Sprite;
  drawLine(x1: number, y1: number, x2: number, y2: number, color?: string, opacity?: number): Line;
  render(): void;
  setCanvasSize(width: number, height: number): void;
  setView(offset: Vec2, zoom?: number): void;
  getView(): { offset: Vec2; zoom: number; size: { width: number; height: number } };
  dispose(): void;
}

function materialsOf(obj: Mesh | Line | Sprite): Material[] {
  const base = (obj as Mesh).material as Material | Material[] | undefined;
  if (!base) return [];
  return Array.isArray(base) ? base : [base];
}

function applyLayer(object: Mesh | Line | Sprite, layerKey: LayerKey, themeLayers = ENGINE_DEFAULTS.layers, material?: Material | Material[]) {
  const layer = themeLayers[layerKey as keyof typeof themeLayers];
  object.position.z = layer.z;
  const mats: Material[] = material ? (Array.isArray(material) ? material : [material]) : materialsOf(object);
  mats.forEach(m => {
    m.depthTest = layer.depthTest;
    m.depthWrite = layerKey === Layers.GEOMETRY;
  });
}

function resolveMaterialPreset(config?: MaterialConfig) {
  const presets = {
    default: { metalness: 0.3, roughness: 0.5, flatShading: true },
    shiny: { metalness: 0.8, roughness: 0.2, flatShading: true },
    matte: { metalness: 0.1, roughness: 0.8, flatShading: true },
    metal: { metalness: 1.0, roughness: 0.3, flatShading: true }
  } as const;
  if (!config || config === 'default') return presets.default;
  if (typeof config === 'string') return presets[config] ?? presets.default;
  if ('preset' in config) {
    const presetKey = (config as { preset: keyof typeof presets }).preset;
    return { ...presets[presetKey] ?? presets.default, ...config };
  }
  return config;
}

function toNonIndexed(geometry: BufferGeometry): BufferGeometry {
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

function setRingRadialUV(geometry: RingGeometry, inner: number, outer: number) {
  // Map UV so that U=radial [0..1] from inner to outer, V fixed at 0.5
  const pos = geometry.getAttribute('position') as Float32BufferAttribute;
  let uv = geometry.getAttribute('uv') as Float32BufferAttribute | null;
  const count = pos.count;
  const data = new Float32Array(count * 2);
  const rSpan = Math.max(1e-6, outer - inner);
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.sqrt(x * x + y * y);
    const u = (r - inner) / rSpan; // 0 at inner, 1 at outer
    data[2 * i + 0] = Math.min(1, Math.max(0, u));
    data[2 * i + 1] = 0.5;
  }
  if (uv) (geometry as any).deleteAttribute('uv');
  geometry.setAttribute('uv', new Float32BufferAttribute(data, 2));
}

function hashNoise(x: number, y: number, z: number, seed = 0): number {
  // Simple deterministic smooth noise in [0,1)
  const t = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 19.19) * 43758.5453;
  return t - Math.floor(t);
}
function noise3(x: number, y: number, z: number, seed = 0): number {
  return hashNoise(x, y, z, seed);
}
function fbmNoise(x: number, y: number, z: number, seed = 0, octaves = 5, lacunarity = 2.0, gain = 0.5): number {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + i * 13.37);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / Math.max(1e-6, norm);
}
function ridgedNoise(x: number, y: number, z: number, seed = 0, octaves = 4): number {
  // Produces sharper features for mountains
  let sum = 0;
  let amp = 0.5;
  let freq = 1.0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = noise3(x * freq, y * freq, z * freq, seed + i * 7.7);
    const r = 1 - Math.abs(2 * n - 1);
    sum += r * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / Math.max(1e-6, norm);
}
function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / Math.max(1e-6, (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hexToRgb(hex: string): [number, number, number] {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

function applyPaletteVertexColors(geometry: BufferGeometry, cfg: PaletteMaterial) {
  const geom = toNonIndexed(geometry);
  const pos = geom.getAttribute('position') as Float32BufferAttribute;
  const count = pos.count; // vertices
  if ((count % 3) !== 0) return;
  const colors = new Float32Array(count * 3);

  const mode = cfg.mode ?? 'ndotL';
  const lightingMode = (cfg.lighting ?? 'unlit') as 'unlit' | 'lit' | 'quantized';
  const light = new Vector3(cfg.lightDir?.x ?? 0, cfg.lightDir?.y ?? 0, cfg.lightDir?.z ?? 1).normalize();
  // 'north' (spin axis): default to +Z (untilted axis), matching rotation axis when tilt=0.
  const north = new Vector3(cfg.axis?.x ?? 0, cfg.axis?.y ?? 0, cfg.axis?.z ?? 1).normalize();
  const palette = (cfg.palette && cfg.palette.length > 0)
    ? cfg.palette
    : MATERIAL_PALETTE;
  const bands = Math.max(1, cfg.bands ?? palette.length);
  const lit = (cfg.lighting ?? 'unlit') !== 'unlit';

  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const tmpC = new Vector3();
  const edge1 = new Vector3();
  const edge2 = new Vector3();
  const faceN = new Vector3();

  const earthOcean = ['#0b3d91', '#165aa9', '#2a7abf', '#4a9bd3', '#8cc5e7'];
  const earthCoast = ['#2a7abf', '#3a8fc8', '#5aa6d4', '#78bbdf', '#a7d1e9'];
  const earthLand = ['#2e7d32', '#388e3c', '#43a047', '#66bb6a', '#9ccc65'];
  const earthDesert = ['#c2b280', '#c8b27e', '#d1b97e', '#d8be85', '#e0c68d'];
  const earthMountain = ['#6d4c41', '#8d6e63', '#a1887f', '#c9b8a1', '#e0e0e0'];
  const earthIce = ['#e6f2ff', '#ffffff', '#cfe8ff'];

  for (let i = 0; i < count; i += 3) {
    // triangle vertices
    tmpA.fromBufferAttribute(pos, i + 0);
    tmpB.fromBufferAttribute(pos, i + 1);
    tmpC.fromBufferAttribute(pos, i + 2);

    // face normal
    edge1.subVectors(tmpB, tmpA);
    edge2.subVectors(tmpC, tmpA);
    faceN.crossVectors(edge1, edge2).normalize();

    // centroid
    const cx = (tmpA.x + tmpB.x + tmpC.x) / 3;
    const cy = (tmpA.y + tmpB.y + tmpC.y) / 3;
    const cz = (tmpA.z + tmpB.z + tmpC.z) / 3;
    const centroid = new Vector3(cx, cy, cz);
    const unit = centroid.clone().normalize();

    let chosenHex: string;
    if (mode === 'earth') {
      // latitude ~ [-1..1] via dot with chosen axis
      const lat = Math.max(-1, Math.min(1, north.dot(unit)));
      // Base continents from fBm low frequency
      const baseScale = 1.2;
      const n = fbmNoise(unit.x * baseScale, unit.y * baseScale, unit.z * baseScale, cfg.seed ?? 3, 5, 2.1, 0.5);
      // Adjust threshold to roughly control land fraction, add subtle lat trend
      const landBias = -0.05 + 0.1 * (Math.abs(lat) - 0.3);
      const landScore = n + landBias - 0.5;
      const isLand = landScore > 0;

      // Mountains from ridged noise
      const m = ridgedNoise(unit.x * 6.0, unit.y * 6.0, unit.z * 6.0, (cfg.seed ?? 3) + 17, 4);
      const mountain = isLand && m > 0.64;

      // Deserts more likely around ±30 deg latitude
      const desertLat = smoothstep(0.2, 0.65, Math.abs(lat));
      const aridityNoise = fbmNoise(unit.x * 3.0, unit.y * 3.0, unit.z * 3.0, (cfg.seed ?? 3) + 7, 3, 2.0, 0.5);
      const desert = isLand && (0.6 * desertLat + 0.4 * aridityNoise) > 0.58 && !mountain;

      // Coast proximity: how close to threshold
      const coastProx = clamp01(0.5 - Math.abs(landScore));

      // Shade amount from N·L (fake sun dir)
      const ndl = 0.5 + 0.5 * Math.max(-1, Math.min(1, faceN.dot(light)));

      if (!isLand) {
        // Oceans: deepen color away from coasts, lighten near coasts
        const oceanBlend = clamp01(coastProx * 3.0);
        const pal = oceanBlend > 0.2 ? earthCoast : earthOcean;
        const idx = lit ? Math.floor(pal.length / 2) : Math.min(pal.length - 1, Math.round(ndl * (pal.length - 1)));
        chosenHex = pal[idx];
      } else if (Math.abs(lat) > 0.78) {
        // Polar ice caps
        const idx = lit ? Math.floor(earthIce.length / 2) : Math.min(earthIce.length - 1, Math.round(ndl * (earthIce.length - 1)));
        chosenHex = earthIce[idx];
      } else if (mountain) {
        const idx = lit ? Math.floor(earthMountain.length / 2) : Math.min(earthMountain.length - 1, Math.round(ndl * (earthMountain.length - 1)));
        chosenHex = earthMountain[idx];
      } else if (desert) {
        const idx = lit ? Math.floor(earthDesert.length / 2) : Math.min(earthDesert.length - 1, Math.round(ndl * (earthDesert.length - 1)));
        chosenHex = earthDesert[idx];
      } else {
        const idx = lit ? Math.floor(earthLand.length / 2) : Math.min(earthLand.length - 1, Math.round(ndl * (earthLand.length - 1)));
        chosenHex = earthLand[idx];
      }
    } else if (mode === 'latitude') {
      // Quantize by latitude bands w.r.t spin axis ('north')
      // north is provided via cfg.axis or derived upstream
      const north = new Vector3(cfg.axis?.x ?? 0, cfg.axis?.y ?? 0, cfg.axis?.z ?? 1).normalize();
      // lat01 in [0,1]: 1 at north pole, 0 at south pole
      const lat01 = 0.5 * (north.dot(unit) + 1);
      const b = Math.max(1, bands - 1);
      const step = Math.round(lat01 * b) / Math.max(1, b);
      const idx = Math.min(palette.length - 1, Math.floor(step * (palette.length - 1)));
      chosenHex = palette[idx];
    } else {
      // Quantize N·L against provided palette
      const ndl = 0.5 + 0.5 * Math.max(-1, Math.min(1, faceN.dot(light)));
      let idx: number;
      if (lightingMode === 'unlit') {
        // Flat: pick a stable mid color
        idx = Math.floor(palette.length / 2);
      } else {
        // 'quantized' or 'lit': quantize into bands
        const step = Math.round(ndl * Math.max(1, bands - 1));
        idx = Math.min(palette.length - 1, Math.floor(step * (palette.length / Math.max(1, bands))));
      }
      chosenHex = palette[idx];
    }

    const [r, g, b] = hexToRgb(chosenHex);
    // assign same face color to all three vertices
    for (let k = 0; k < 3; k++) {
      colors[3 * (i + k) + 0] = r;
      colors[3 * (i + k) + 1] = g;
      colors[3 * (i + k) + 2] = b;
    }
  }

  geom.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

function sampleTextureColorAtUV(ctx: CanvasRenderingContext2D, width: number, height: number, u: number, v: number): string {
  // wrap u in [0,1), clamp v in [0,1]
  const uu = ((u % 1) + 1) % 1;
  const vv = v < 0 ? 0 : v > 1 ? 1 : v;
  const x = Math.min(width - 1, Math.floor(uu * width));
  // Canvas coordinates: y=0 top; for standard equirectangular images, v=0 is north (top).
  // Since we sample the image directly (not via WebGL Texture.flipY), do NOT flip v here.
  const y = Math.min(height - 1, Math.floor(vv * height));
  const img = ctx.getImageData(x, y, 1, 1).data;
  const r = img[0], g = img[1], b = img[2];
  const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  return hex;
}

function applyTexturePaletteVertexColors(geometry: BufferGeometry, image: HTMLImageElement, cfg: PaletteMaterial) {
  const geom = toNonIndexed(geometry);
  const pos = geom.getAttribute('position') as Float32BufferAttribute;
  const count = pos.count;
  if ((count % 3) !== 0) return;

  const palette = (cfg.palette && cfg.palette.length > 0) ? cfg.palette : MATERIAL_PALETTE;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const colors = new Float32Array(count * 3);
  const rect = cfg.textureRect ?? { u0: 0, v0: 0, u1: 1, v1: 1 };
  const du = rect.u1 - rect.u0;
  const dv = rect.v1 - rect.v0;
  const clamp01 = (t: number) => t < 0 ? 0 : t > 1 ? 1 : t;
  // Mapping axis: world spin axis; default to +Z when not provided (untilted axis)
  const north = new Vector3(cfg.axis?.x ?? 0, cfg.axis?.y ?? 0, cfg.axis?.z ?? 1).normalize();
  // Choose a stable reference not colinear with north to define longitude zero direction.
  const ref = Math.abs(north.y) < 0.99 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  // Build tangent basis on equatorial plane: U around-equator axis, V 90° ahead.
  const Uaxis = new Vector3().crossVectors(ref, north).normalize();
  const Vaxis = new Vector3().crossVectors(north, Uaxis).normalize();
  for (let i = 0; i < count; i += 3) {
    // Compute spherical UV from face centroid in local space relative to 'north'
    const vx = (pos.getX(i + 0) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const vy = (pos.getY(i + 0) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const vz = (pos.getZ(i + 0) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const len = Math.max(1e-6, Math.sqrt(vx*vx + vy*vy + vz*vz));
    const nx = vx / len, ny = vy / len, nz = vz / len;
    const N = new Vector3(nx, ny, nz);
    // v from angle to north (0 at north pole, 1 at south)
    const dotN = Math.max(-1, Math.min(1, N.dot(north)));
    const vSph = Math.acos(dotN) / Math.PI;
    // u from projection onto equatorial basis (Uaxis,Vaxis)
    const uProjU = N.dot(Uaxis);
    const uProjV = N.dot(Vaxis);
    const uAngle = Math.atan2(uProjV, uProjU); // [-pi, pi]
    const uSph = (uAngle + Math.PI) / (2 * Math.PI);
    const u = rect.u0 + uSph * du;
    const v = rect.v0 + vSph * dv;
    const hex = sampleTextureColorAtUV(ctx, canvas.width, canvas.height, u, v);
    const qHex = nearestPaletteColor(hex, palette);
    const c = new Color(qHex);
    for (let k = 0; k < 3; k++) {
      colors[3 * (i + k) + 0] = c.r;
      colors[3 * (i + k) + 1] = c.g;
      colors[3 * (i + k) + 2] = c.b;
    }
  }
  geom.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

function createGrid(group: Group, theme: Theme, config: GridConfig) {
  const { spacing, extent } = config;
  for (let x = -extent; x <= extent; x += spacing) {
    const isMajor = Math.abs(x % (spacing * config.major.every)) < 0.001;
    group.add(createGridLine(x, -extent, x, extent, theme, config, isMajor));
  }
  for (let y = -extent; y <= extent; y += spacing) {
    const isMajor = Math.abs(y % (spacing * config.major.every)) < 0.001;
    group.add(createGridLine(-extent, y, extent, y, theme, config, isMajor));
  }
}

function createGridLine(x1: number, y1: number, x2: number, y2: number, theme: Theme, cfg: GridConfig, major: boolean) {
  if (major) {
    const isVertical = Math.abs(x1 - x2) < 1e-6;
    const width = isVertical ? cfg.major.width : Math.abs(x2 - x1);
    const height = isVertical ? Math.abs(y2 - y1) : cfg.major.width;
    const geom = new PlaneGeometry(width, height);
    const mat = new MeshBasicMaterial({ color: new Color(theme.grid), opacity: cfg.major.opacity, transparent: true, side: DoubleSide });
    const mesh = new Mesh(geom, mat);
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
    applyLayer(mesh, Layers.GRID, ENGINE_DEFAULTS.layers, mat);
    return mesh;
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute([x1, y1, 0, x2, y2, 0], 3));
  const mat = new LineBasicMaterial({ color: new Color(theme.grid), opacity: cfg.normal.opacity, transparent: true });
  const line = new Line(geom, mat);
  applyLayer(line, Layers.GRID, ENGINE_DEFAULTS.layers, mat);
  return line;
}

function createGlowSprite(colorHex: string, intensity: number) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  const col = new Color(colorHex);
  const rgb = `rgba(${Math.round(col.r * 255)}, ${Math.round(col.g * 255)}, ${Math.round(col.b * 255)},`;
  gradient.addColorStop(0, `${rgb} ${Math.min(1, 0.8 * intensity)})`);
  gradient.addColorStop(0.6, `${rgb} ${Math.min(1, 0.25 * intensity)})`);
  gradient.addColorStop(1, `${rgb} 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  const material = new SpriteMaterial({ map: texture, transparent: true, opacity: 1 });
  const sprite = new Sprite(material);
  return sprite;
}

function createTextSprite(text: string, opts?: { color?: string; fontSize?: number; fontFamily?: string; padding?: number; background?: string; center?: boolean }) {
  const color = opts?.color ?? '#ffffff';
  const fontSize = Math.max(8, Math.floor(opts?.fontSize ?? 32));
  const fontFamily = opts?.fontFamily ?? 'Inter, Arial, sans-serif';
  const padding = Math.max(0, Math.floor(opts?.padding ?? 8));

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(text);
  const m = metrics as TextMetrics & { actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number };
  const ascent = (m.actualBoundingBoxAscent !== undefined ? m.actualBoundingBoxAscent : fontSize * 0.8);
  const descent = (m.actualBoundingBoxDescent !== undefined ? m.actualBoundingBoxDescent : fontSize * 0.2);
  const textWidth = Math.ceil(metrics.width);
  const textHeight = Math.ceil(ascent + descent);
  canvas.width = textWidth + padding * 2;
  canvas.height = textHeight + padding * 2;

  const ctx2 = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx2.font = `bold ${fontSize}px ${fontFamily}`;
  ctx2.textBaseline = 'top';
  if (opts?.background) {
    ctx2.fillStyle = opts.background;
    ctx2.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx2.fillStyle = color;
  const x = padding;
  const y = padding + (textHeight - ascent - descent) / 2;
  ctx2.fillText(text, x, y);

  const texture = new CanvasTexture(canvas);
  const material = new SpriteMaterial({ map: texture, transparent: true });
  const sprite = new Sprite(material);
  if (opts?.center) sprite.center.set(0.5, 0.5); else sprite.center.set(0, 1);
  return { sprite, pixelSize: { w: canvas.width, h: canvas.height } };
}

function updateAnimation(state: AnimationState, dt: number, inst: { group: Group; mesh: Mesh; baseQuat?: Quaternion; spinAxis?: Vector3 }) {
  if (state.paused) return;
  state.time += dt * state.speed;
  const config = state.config;
  switch (config.type) {
    case 'rotate': {
      const cycles = config.speed ?? 1;
      const w = cycles * Math.PI * 2;
      const angle = state.time * w;
      const axisVec = new Vector3(config.axis.x, config.axis.y, config.axis.z);
      if (axisVec.lengthSq() === 0) return;
      const axis = axisVec.normalize();
      if (inst.baseQuat && inst.spinAxis) {
        const qSpin = new Quaternion().setFromAxisAngle(inst.spinAxis, angle);
        // Compose as spin · base so base orientation is applied first,
        // then spin occurs around the world-space axis.
        inst.mesh.quaternion.multiplyQuaternions(qSpin, inst.baseQuat);
      } else {
        inst.mesh.setRotationFromAxisAngle(axis, angle);
      }
      break;
    }
    case 'orbit': {
      const axisVec = new Vector3(config.axis.x, config.axis.y, config.axis.z);
      if (axisVec.lengthSq() === 0) return;
      const axis = axisVec.normalize();
      const radius = config.radius ?? 3;
      const speed = (config.speed ?? 1) * Math.PI * 2;
      const u = new Vector3();
      if (Math.abs(axis.y) < 0.9) u.set(0, 1, 0).cross(axis).normalize();
      else u.set(1, 0, 0).cross(axis).normalize();
      const v = new Vector3().copy(axis).cross(u).normalize();
      const angle = state.time * speed;
      const offsetU = u.clone().multiplyScalar(Math.cos(angle) * radius);
      const offsetV = v.clone().multiplyScalar(Math.sin(angle) * radius);
      inst.group.position.set(offsetU.x + offsetV.x, offsetU.y + offsetV.y, inst.group.position.z);
      if (config.lockRotation) inst.mesh.rotation.z = angle;
      break;
    }
    case 'oscillate': {
      const dirVec = new Vector3(config.axis.x, config.axis.y, config.axis.z);
      if (dirVec.lengthSq() === 0) return;
      const direction = dirVec.normalize();
      const amplitude = config.amplitude ?? 1;
      const frequency = (config.speed ?? 1) * Math.PI * 2;
      const offset = Math.sin(state.time * frequency) * amplitude;
      const displacement = direction.clone().multiplyScalar(offset);
      inst.group.position.set(displacement.x, displacement.y, inst.group.position.z);
      break;
    }
  }
}

function createObjectSystem(
  scene: Scene,
  theme: Theme,
  drawSegment: (x1: number, y1: number, x2: number, y2: number) => Line,
  textLayer: Group,
  getZoom: () => number
) {
  type Instance = {
    id: string;
    group: Group;
    mesh: Mesh;
    glow?: Sprite;
    light?: PointLight;
    label?: { sprite: Sprite; offset: Vec2 };
    config: ObjectConfig;
    animations: AnimationState[];
    baseColor: string;
    selected: boolean;
    controller?: (inst: Instance, t: number) => void;
    baseQuat?: Quaternion;
    spinAxis?: Vector3;
    trail?: { last: Vector3 | null; acc: number; interval: number; lines?: Line[]; max?: number };
    ringsWorld?: Array<{ mesh: Mesh; qEq: Quaternion }>;
    ringsSpinRate?: number;
    ringsSpinAngle?: number;
    cloudsWorld?: Array<{ mesh: Mesh; driftRate: number; driftAngle: number }>;
    update: (dt: number) => void;
    updateTheme: () => void;
  };
  const instances: Instance[] = [];
  const instanceMap = new Map<string, Instance>();

  const typeSpecs: Record<ObjectType, { defaultSize: number; create: (size: number, obj: ObjectConfig) => BufferGeometry } > = {
    box: { defaultSize: 1.5, create: (s) => new BoxGeometry(s, s, s) },
    sphere: { defaultSize: 1.2, create: (s, obj) => { const ws = obj.segments?.width ?? 32; const hs = obj.segments?.height ?? 16; const g = new SphereGeometry(s / 2, ws, hs); return g; } },
    cylinder: { defaultSize: 1.6, create: (s) => new CylinderGeometry(s / 2, s / 2, s, 8) },
    torus: { defaultSize: 1.8, create: (s) => new TorusGeometry(s / 3, s / 8, 8, 16) },
  };

  function addLight(config: LightConfig) {
    if (config.type === 'ambient') scene.add(new AmbientLight(config.color, config.intensity));
    else {
      const light = new DirectionalLight(config.color, config.intensity);
      light.position.set(...config.position);
      scene.add(light);
    }
  }

  function createObject(objCfg: ObjectConfig) {
    const spec = typeSpecs[objCfg.type as keyof typeof typeSpecs];
    if (!spec) return null;
    const size = objCfg.size ?? spec.defaultSize;
    let geometry = spec.create(size, objCfg);
    // Accumulators for child components to attach on instance
    let pendingRings: Array<{ mesh: Mesh; qEq: Quaternion }> | undefined;
    let pendingClouds: Array<{ mesh: Mesh; driftRate: number; driftAngle: number }> | undefined;

    let material: MeshStandardMaterial | MeshBasicMaterial | MeshPhongMaterial;
    const matCfg = objCfg.material;
    let usesVertexColors = false;
    const finalColor = objCfg.color ? objCfg.color : theme[(objCfg.colorKey ?? 'geometry') as keyof Theme] as string;
    let mesh: Mesh;

    if (matCfg && typeof matCfg === 'object' && (matCfg as PaletteMaterial).type === 'palette') {
      geometry = toNonIndexed(geometry);
      let pm = { ...(matCfg as PaletteMaterial) } as PaletteMaterial;
      // Derive north-south axis for mapping if not provided: use rotate animation axis if present, else Z.
      if (!pm.axis) {
        const rotAnim = (objCfg.animations ?? []).find(a => a.type === 'rotate');
        if (rotAnim) {
          const a = rotAnim.axis;
          pm.axis = { x: a.x, y: a.y, z: a.z };
        } else {
          pm.axis = { x: 0, y: 0, z: 1 };
        }
        // No baked rotation on sphere geometry; axis can be used directly.
      }
      const lit = (pm.lighting ?? 'unlit') !== 'unlit';
      // If textureSrc provided, attempt to load and palette-map it; fall back to procedural palette
      if (pm.textureSrc) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          applyTexturePaletteVertexColors(geometry, img, pm);
          const colAttr = mesh.geometry.getAttribute('color') as Float32BufferAttribute | undefined;
          if (colAttr) colAttr.needsUpdate = true;
          mesh.material.needsUpdate = true;
        };
        img.onerror = () => {
          applyPaletteVertexColors(geometry, pm);
          mesh.material.needsUpdate = true;
        };
        img.src = pm.textureSrc;
      } else {
        applyPaletteVertexColors(geometry, pm);
      }
      material = lit
        ? new MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0, roughness: 1 })
        : new MeshBasicMaterial({ vertexColors: true, flatShading: true });
      usesVertexColors = true;
    } else {
      const materialProps = resolveMaterialPreset(objCfg.material as any);
      // Support explicit map-based materials
      if (matCfg && typeof matCfg === 'object' && (matCfg as any).type === 'map') {
        const m = matCfg as { map: string; bump?: string; specular?: string; normal?: string; metalness?: number; roughness?: number; usePhong?: boolean };
        const loader = new TextureLoader();
        const baseMap = loader.load(m.map);
        if (m.specular || m.usePhong) {
          const phong = new MeshPhongMaterial({ map: baseMap });
          if (m.bump) { phong.bumpMap = loader.load(m.bump); phong.bumpScale = 0.02; }
          if (m.specular) { phong.specularMap = loader.load(m.specular); }
          material = phong;
        } else {
          const std = new MeshStandardMaterial({ map: baseMap, metalness: m.metalness ?? 0.0, roughness: m.roughness ?? 1.0 });
          if (m.bump) { std.bumpMap = loader.load(m.bump); std.bumpScale = 0.02; }
          material = std;
        }
      } else {
        material = new MeshStandardMaterial({ color: finalColor, ...(materialProps as any) });
      }
    }
    mesh = new Mesh(geometry, material);
    const group = new Group();
    group.add(mesh);
    const pos = normalizePosition(objCfg.position);
    group.position.set(pos.x, pos.y, ENGINE_DEFAULTS.layers.geometry.z);
    material.depthTest = ENGINE_DEFAULTS.layers.geometry.depthTest;
    material.depthWrite = true;
    const isLightSource = objCfg.glow?.light !== undefined;
    mesh.castShadow = !isLightSource;
    mesh.receiveShadow = !isLightSource;
    (mesh as unknown as { userData: { type: string; id: string; rootGroup: Group } }).userData = { type: 'object', id: objCfg.id, rootGroup: group };

    // For spheres, align geometry Y to spin axis and add pole markers
    if (objCfg.type === 'sphere') {
      const rotAnim = (objCfg.animations ?? []).find(a => a.type === 'rotate');
      const ax = rotAnim ? new Vector3(rotAnim.axis.x, rotAnim.axis.y, rotAnim.axis.z) : new Vector3(0, 0, 1);
      const axis = ax.lengthSq() > 0 ? ax.clone().normalize() : new Vector3(0, 0, 1);
      // Base orientation: map local +Y to the spin axis
      const baseQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);
      mesh.quaternion.copy(baseQuat);
      // Store for spin animation use
      // These will be used by updateAnimation to spin around the correct axis
      // even after the base orientation is applied
      // (set on the instance below)
      const radius = (size) / 2;
      const lift = radius * 1.02;
      const len = Math.max(0.05, radius * 0.2);

      // Build pole markers in LOCAL space so they follow mesh orientation correctly.
      // Local +Y is the texture north; baseQuat aligns it to the world spin axis.
      const Ulocal = new Vector3(1, 0, 0); // any vector perpendicular to local +Y
      function addPoleLineLocal(centerLocal: Vector3, color: string) {
        const p1 = new Vector3().copy(centerLocal).add(Ulocal.clone().multiplyScalar(len / 2));
        const p2 = new Vector3().copy(centerLocal).add(Ulocal.clone().multiplyScalar(-len / 2));
        const g = new BufferGeometry();
        g.setAttribute('position', new Float32BufferAttribute([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z], 3));
        const m = new LineBasicMaterial({ color: new Color(color) });
        const l = new Line(g, m);
        mesh.add(l); // rotate with mesh
      }

      // Centers along local +Y and -Y
      addPoleLineLocal(new Vector3(0, lift, 0), '#ff3b30');   // north
      addPoleLineLocal(new Vector3(0, -lift, 0), '#ffffff');  // south
      // Attach baseQuat and spin axis to be used later
      (mesh as any).__baseQuat = baseQuat;
      (mesh as any).__spinAxis = axis;

      // Debug equator ring (thin ring in equatorial plane)
      if (DEBUG_EQUATOR) {
        const inner = (size / 2) * 0.995;
        const outer = (size / 2) * 1.005;
        const ringGeo = new RingGeometry(inner, outer, 128);
        const ringMat = new MeshBasicMaterial({ color: 0xffff00, side: DoubleSide, transparent: true, opacity: 0.9, depthWrite: false });
        const equator = new Mesh(ringGeo, ringMat);
        const qeq = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, 1, 0));
        equator.quaternion.copy(qeq);
        mesh.add(equator);
      }

      // Big yellow equator at ~2x planet radius for clear visual verification
      // Only draw on bodies that actually have rings configured (e.g., Saturn, Uranus)
      if (DEBUG_EQUATOR_BIG && objCfg.rings) {
        const bigInner = (size / 2) * 1.9;  // 2x radius minus margin
        const bigOuter = (size / 2) * 2.1;  // 2x radius plus margin
        const bigGeo = new RingGeometry(bigInner, bigOuter, 128);
        const bigMat = new MeshBasicMaterial({ color: 0xffff00, side: DoubleSide, transparent: true, opacity: 0.85, depthWrite: false });
        const bigEq = new Mesh(bigGeo, bigMat);
        const qeq = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, 1, 0));
        bigEq.quaternion.copy(qeq);
        mesh.add(bigEq);
      }

      // Debug axis arrow (short line along axis)
      if (DEBUG_AXIS) {
        const a1 = axis.clone().multiplyScalar(radius * 1.05);
        const a2 = axis.clone().multiplyScalar(-radius * 1.05);
        const g = new BufferGeometry();
        g.setAttribute('position', new Float32BufferAttribute([a1.x, a1.y, a1.z, a2.x, a2.y, a2.z], 3));
        const m = new LineBasicMaterial({ color: 0x00ffff });
        const line = new Line(g, m);
        mesh.add(line);
      }

      // Atmosphere/clouds layer if configured
      if (objCfg.atmosphere && (objCfg.atmosphere.map || objCfg.atmosphere.alpha)) {
        const loader = new TextureLoader();
        const cloudsGeo = new SphereGeometry((size / 2) * (objCfg.atmosphere.scale ?? 1.03), objCfg.segments?.width ?? 32, objCfg.segments?.height ?? 16);
        const cloudsMat = new MeshStandardMaterial({
          map: objCfg.atmosphere.map ? loader.load(objCfg.atmosphere.map) : undefined,
          alphaMap: objCfg.atmosphere.alpha ? loader.load(objCfg.atmosphere.alpha) : undefined,
          transparent: true,
          depthWrite: false,
          roughness: 1.0,
          metalness: 0.0
        });
        const clouds = new Mesh(cloudsGeo, cloudsMat);
        // Important: do NOT copy baseQuat to clouds. The planet mesh already has baseQuat,
        // and clouds inherit the parent’s orientation. Copying baseQuat here would double-tilt.
        // Register clouds for CloudSystem update (drift around local +Y)
        if (!pendingClouds) pendingClouds = [];
        pendingClouds.push({ mesh: clouds, driftRate: objCfg.atmosphere.spinSpeed ?? 0.02, driftAngle: 0 });
        mesh.add(clouds);
      }

      // Rings if configured (equatorial plane)
    // Collect world-attached rings to orient after inst is constructed
    if (objCfg.rings) {
        if (!pendingRings) pendingRings = [];
        const loader = new TextureLoader();
        const inner = (objCfg.rings.inner ?? 1.5) * (size / 2);
        const outer = Math.max(inner + (size * 0.12), (objCfg.rings.outer ?? 2.8) * (size / 2));
        const ringGeo = new RingGeometry(inner, outer, 256);
        setRingRadialUV(ringGeo, inner, outer);
        // Base equatorial ring (always visible). We attach to the non-rotating group
        // and orient it each frame to tilt with the axis but not spin.
        const qEq = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, 1, 0));
        const baseMat = new MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false });
        const baseRing = new Mesh(ringGeo, baseMat);
        group.add(baseRing);
        // Optional textured layer above base for detail
        if (objCfg.rings.texture) {
          const tex = loader.load(objCfg.rings.texture);
          const ringMat = new MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, side: DoubleSide, depthWrite: false });
          const ring = new Mesh(ringGeo, ringMat);
          group.add(ring);
          pendingRings.push({ mesh: ring, qEq });
        }
        pendingRings.push({ mesh: baseRing, qEq });
        // Optional: world-XY guide for visibility comparison
        if (DEBUG_RING_GUIDE) {
          const guideGeo = new RingGeometry(inner, outer, 128);
          const guideMat = new MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.25, side: DoubleSide, depthWrite: false, depthTest: false });
          const guide = new Mesh(guideGeo, guideMat);
          guide.position.set(0, 0, (size / 2) * 0.004);
          guide.renderOrder = 5;
          group.add(guide);
        }
      }
    }
    scene.add(group);
  const inst: Instance = {
      id: objCfg.id,
      group,
      mesh,
      config: objCfg,
      animations: [],
      baseColor: finalColor,
      selected: false,
      baseQuat: (mesh as any).__baseQuat as Quaternion | undefined,
      spinAxis: (mesh as any).__spinAxis as Vector3 | undefined,
      ringsWorld: (pendingRings && pendingRings.length) ? pendingRings : undefined,
      ringsSpinRate: objCfg.rings?.spin ?? 0,
      ringsSpinAngle: 0,
      cloudsWorld: (pendingClouds && pendingClouds.length) ? pendingClouds : undefined,
      update: (dt: number) => {
        inst.animations.forEach(a => updateAnimation(a, dt, inst));
        // Rings and clouds handled by dedicated systems in outer update.
        // Trail handled by TrailSystem (real-time throttled)
        if (inst.label) {
          const wp = new Vector3();
          inst.group.getWorldPosition(wp);
          const off = inst.label.offset;
          inst.label.sprite.position.set(wp.x + off.x, wp.y + off.y, inst.label.sprite.position.z);
        }
      },
      updateTheme: () => {
        if (!objCfg.color && !usesVertexColors) {
          const key = objCfg.colorKey ?? 'geometry';
          const colorValue: string = theme[key as keyof Theme] as string;
          (material as MeshStandardMaterial | MeshBasicMaterial).color.set(colorValue);
          inst.baseColor = colorValue;
          material.needsUpdate = true;
        }
      }
    };

    
    
    if (objCfg.glow) {
      const glowColor = objCfg.glow.color ?? finalColor;
      const glowIntensity = Math.max(0, objCfg.glow.intensity ?? 1);
      const glowSize = objCfg.glow.size ?? size * 12;
      const sprite = createGlowSprite(glowColor, glowIntensity);
      sprite.scale.set(glowSize, glowSize, 1);
      sprite.position.set(0, 0, 0);
      applyLayer(sprite, Layers.LINE, ENGINE_DEFAULTS.layers, sprite.material as Material);
      const sm = sprite.material as SpriteMaterial;
      sm.depthTest = false;
      sm.depthWrite = false;
      sm.blending = AdditiveBlending;
      group.add(sprite);
      inst.glow = sprite;

      const lc = objCfg.glow.light ?? {};
      const sc = lc.shadow ?? {};
      const lightColor: string = (lc as { color?: string }).color ?? glowColor;
      const light = new PointLight(lightColor, lc.intensity ?? 8.0, lc.distance ?? 0, lc.decay ?? 1);
      light.castShadow = true;
      light.shadow.mapSize.set(sc.mapSize ?? 4096, sc.mapSize ?? 4096);
      light.shadow.bias = sc.bias ?? -0.00005;
      light.shadow.normalBias = sc.normalBias ?? 0.03;
      light.shadow.camera.near = sc.near ?? 0.1;
      light.shadow.camera.far = sc.far ?? 500;
      group.add(light);
      inst.light = light;
    }

    const labelCfg = objCfg.label === undefined ? { text: objCfg.id } : objCfg.label;
    if (labelCfg !== false) {
      const cfg = typeof labelCfg === 'string' ? { text: labelCfg } : (labelCfg ?? { text: objCfg.id });
      const labelText = cfg.text ?? objCfg.id;
      const worldHeight = Math.max(0.1, cfg.worldHeight ?? 0.8);
      const { sprite, pixelSize } = createTextSprite(labelText, { color: cfg.color ?? '#ffffff', fontSize: cfg.fontSize ?? 64, fontFamily: cfg.fontFamily, padding: cfg.padding, background: cfg.background });
      const aspect = pixelSize.w / Math.max(1, pixelSize.h);
      sprite.scale.set(worldHeight * aspect, worldHeight, 1);
      sprite.center.set(0.5, 0);
      applyLayer(sprite, Layers.TEXT, ENGINE_DEFAULTS.layers, sprite.material as Material);
      const sm = sprite.material as SpriteMaterial;
      sm.depthTest = false;
      sm.depthWrite = false;
      textLayer.add(sprite);
      let offset: Vec2 = { x: 0, y: (objCfg.size ?? 1) * 0.7 + worldHeight * 0.6 };
      if (cfg.offset) {
        const p = normalizePosition(cfg.offset);
        offset = { x: p.x, y: p.y };
      }
      inst.label = { sprite, offset };
    }

    
    if (objCfg.trail) {
      const interval = typeof objCfg.trail === 'object' && objCfg.trail.interval ? objCfg.trail.interval : 0.1;
      inst.trail = { last: null, acc: 0, interval, lines: [], max: 300 };
    }

    instances.push(inst);
    instanceMap.set(objCfg.id, inst);
    return inst;
  }

  let elapsed = 0;
  function update(dt: number, realDt: number = dt) {
    elapsed += dt;
    // Core per-entity update
    instances.forEach(inst => {
      inst.update(dt);
      if (inst.controller) inst.controller(inst, elapsed);
    });
    // RingSystem: orient rings (skip if controlled by ECS)
    instances.forEach(inst => { if (!(inst as any).ecsControlRings) updateRingsForHost(inst as any, dt); });
    // CloudSystem: apply cloud drift (skip if controlled by ECS)
    instances.forEach(inst => { if (!(inst as any).ecsControlClouds) updateCloudsForHost(inst as any, dt); });
    // TrailSystem: draw segments every ~20px at STANDARD zoom (independent of time/speed and current zoom)
    // Convert 20 px at standard zoom (ENGINE_DEFAULTS.viewport.zoom.initial) into a constant world step.
    instances.forEach(inst => {
      if (!inst.trail) return;
      if ((inst as any).ecsControlTrails) return;
      const wp = new Vector3();
      inst.group.getWorldPosition(wp);
      const trail: any = inst.trail as any;
      if (!trail.last) { trail.last = wp.clone(); return; }
      const last = trail.last as Vector3;
      const step = 20 / ENGINE_DEFAULTS.viewport.zoom.initial; // constant world units for 20 px at standard zoom
      let dx = wp.x - last.x;
      let dy = wp.y - last.y;
      let dist = Math.hypot(dx, dy);
      if (dist < step) return;
      const ux = dx / dist;
      const uy = dy / dist;
      // add segments at fixed ~step spacing toward wp (leave remainder to accumulate next frame)
      while (dist >= step) {
        const nx = last.x + ux * step;
        const ny = last.y + uy * step;
        const seg = drawSegment(last.x, last.y, nx, ny);
        if (trail.lines) {
          trail.lines.push(seg);
          const max = trail.max ?? 300;
          while (trail.lines.length > max) {
            const old = trail.lines.shift();
            if (old) {
              old.geometry.dispose();
              (old.material as Material).dispose();
              if (old.parent) old.parent.remove(old);
            }
          }
          // Apply fade across the buffer so oldest is faint, newest is bright.
          const len = trail.lines.length;
          if (len > 0) {
            const minAlpha = 0.08;
            const maxAlpha = 0.95;
            const gamma = 1.0; // adjust curve if needed
            for (let i = 0; i < len; i++) {
              const t = Math.pow((i + 1) / len, gamma); // oldest i=0 -> small, newest i=len-1 -> 1
              const a = minAlpha + (maxAlpha - minAlpha) * t;
              const m = trail.lines[i].material as LineBasicMaterial;
              m.transparent = true;
              m.opacity = a;
              m.needsUpdate = true;
            }
          }
        }
        last.set(nx, ny, 0);
        dx = wp.x - last.x;
        dy = wp.y - last.y;
        dist = Math.hypot(dx, dy);
      }
    });
  }

  function updateTheme() {
    instances.forEach(inst => inst.updateTheme());
  }

  function getObject(id: string) { return instanceMap.get(id) ?? null; }

  function selectObject(id: string | null) {
    instances.forEach(inst => {
      inst.selected = inst.id === id;
      const mat = inst.mesh.material as Material;
      if (mat instanceof MeshStandardMaterial) {
        if (inst.selected) { mat.emissive.set('#FFD700'); mat.emissiveIntensity = 0.3; }
        else { mat.emissive.set(0x000000); mat.emissiveIntensity = 0; }
        mat.needsUpdate = true;
      } else if (mat instanceof MeshBasicMaterial) {
        // For basic materials, fake a highlight by adjusting color slightly
        if (inst.selected) {
          const c = new Color(inst.baseColor || '#ffffff');
          const hi = c.clone().lerp(new Color('#FFD700'), 0.4);
          mat.color.set(hi);
        } else {
          const key = inst.config.color ? inst.config.color : theme[(inst.config.colorKey ?? 'geometry') as keyof Theme] as string;
          mat.color.set(key as string);
        }
        mat.needsUpdate = true;
      }
    });
  }

  function getSelected() { return instances.find(i => i.selected); }

  function raycast(raycaster: Raycaster) {
    const meshes = instances.map(inst => inst.mesh);
    const intersects = raycaster.intersectObjects(meshes, true);
    if (intersects.length === 0) return null;
    let obj: Object3D = intersects[0].object;
    type RootUD = { rootGroup?: Group };
    while (obj && !(obj as unknown as { userData?: RootUD }).userData?.rootGroup && obj.parent) obj = obj.parent;
    const root = (obj as unknown as { userData?: RootUD }).userData?.rootGroup as Group | undefined;
    if (!root) return null;
    const inst = instances.find(i => i.group === root);
    return inst?.id ?? null;
  }

  function removeObject(id: string) {
    const idx = instances.findIndex(i => i.id === id);
    if (idx === -1) return false;
    const inst = instances[idx];
    // Dispose trail segments if any
    if (inst.trail && (inst.trail as any).lines) {
      const lines: Line[] = (inst.trail as any).lines;
      lines.forEach(seg => {
        seg.geometry.dispose();
        (seg.material as Material).dispose();
        if (seg.parent) seg.parent.remove(seg);
      });
      (inst.trail as any).lines = [];
    }
    inst.mesh.geometry.dispose();
    (inst.mesh.material as Material).dispose();
    if (inst.glow) {
      const mat = inst.glow.material as SpriteMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
      inst.group.remove(inst.glow);
    }
    if (inst.label) {
      const mat = inst.label.sprite.material as SpriteMaterial;
      if (mat.map) mat.map.dispose();
      mat.dispose();
      textLayer.remove(inst.label.sprite);
    }
    if (inst.light) {
      inst.group.remove(inst.light);
    }
    scene.remove(inst.group);
    instances.splice(idx, 1);
    instanceMap.delete(id);
    return true;
  }

  function addObject(objCfg: ObjectConfig) { return createObject(objCfg); }
  function pauseAll() { instances.forEach(i => i.animations.forEach(a => a.paused = true)); }
  function resumeAll() { instances.forEach(i => i.animations.forEach(a => a.paused = false)); }
  function setGlobalSpeed(speed: number) { instances.forEach(i => i.animations.forEach(a => a.speed = speed)); }

  function wireParenting(objs: ObjectConfig[]) {
    objs.forEach(objCfg => {
      if (!objCfg.parent) return;
      const child = instanceMap.get(objCfg.id);
      const parent = instanceMap.get(objCfg.parent);
      if (child && parent) {
        parent.group.add(child.group);
        const pos = normalizePosition(objCfg.position);
        child.group.position.set(pos.x, pos.y, ENGINE_DEFAULTS.layers.geometry.z);
      }
    });
  }

  function attachAnimations(objs: ObjectConfig[]) {
    objs.forEach(objCfg => {
      const inst = instanceMap.get(objCfg.id);
      if (!inst) return;
      if (objCfg.animations && objCfg.animations.length) {
        inst.animations = objCfg.animations.map(anim => ({ config: anim, time: 0, speed: 1, paused: false }));
      }
    });
  }

  function setController(id: string, fn: (inst: Instance, t: number) => void) {
    const inst = instanceMap.get(id);
    if (inst) inst.controller = fn;
  }

  return { addLight, createObject, addObject, removeObject, getObject, update, updateTheme, raycast, selectObject, getSelected, pauseAll, resumeAll, setGlobalSpeed, wireParenting, attachAnimations, setController };
}

export function createEngine(config: EngineConfig): Engine {
  if (!config.container) throw new Error('Invalid container');
  const theme = config.theme;
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.style.cursor = 'crosshair';
  config.container.appendChild(renderer.domElement);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const state: { size: { width: number; height: number }; offset: Vec2; zoom: number } = {
    size: { width: config.container.clientWidth, height: config.container.clientHeight },
    offset: { x: 0, y: 0 },
    zoom: ENGINE_DEFAULTS.viewport.zoom.initial
  };
  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1, 0, 1, ENGINE_DEFAULTS.camera.near, ENGINE_DEFAULTS.camera.far);
  const layers = { grid: new Group(), draw: new Group(), text: new Group() };
  scene.add(layers.grid, layers.draw, layers.text);

  renderer.setSize(state.size.width, state.size.height, true);
  camera.position.set(0, 0, ENGINE_DEFAULTS.camera.z);

  // Postprocessing with bloom
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new Vector2(state.size.width, state.size.height), 0.7, 0.0, 0.9);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

  

  function addLine(x1: number, y1: number, x2: number, y2: number, color?: string, opacity = 1) {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute([x1, y1, 0, x2, y2, 0], 3));
    const mat = new LineBasicMaterial({ color: new Color(color ?? theme.line), transparent: true, opacity });
    const seg = new Line(geom, mat);
    applyLayer(seg, Layers.LINE, ENGINE_DEFAULTS.layers, mat);
    layers.draw.add(seg);
    return seg;
  }

  function addDot(x: number, y: number, color?: string, size = 0.16) {
    const geom = new PlaneGeometry(size, size);
    const mat = new MeshBasicMaterial({ color: new Color(color ?? theme.dot), side: DoubleSide, transparent: true });
    const mesh = new Mesh(geom, mat);
    mesh.position.set(x, y, 0);
    applyLayer(mesh, Layers.DOT, ENGINE_DEFAULTS.layers, mat);
    mesh.userData = { ...(mesh.userData || {}), type: 'dot' };
    layers.draw.add(mesh);
    return mesh;
  }

  const gridConfig: GridConfig | false = config.grid === undefined ? ENGINE_DEFAULTS.grid : config.grid;
  if (gridConfig) {
    createGrid(layers.grid, theme, gridConfig);
  }
  function gridSnap(world: Vec2): Vec2 {
    const spacing = gridConfig === false ? ENGINE_DEFAULTS.grid.spacing : gridConfig.spacing;
    return { x: Math.round(world.x / spacing) * spacing, y: Math.round(world.y / spacing) * spacing };
  }
  const grid = gridConfig === false ? null : { snap: gridSnap };

  function addTextLabel(text: string, position: Vec2, options?: { color?: string; fontSize?: number; fontFamily?: string; worldHeight?: number; padding?: number; background?: string; center?: boolean }): Sprite {
    const { sprite, pixelSize } = createTextSprite(text, options);
    const worldHeight = Math.max(0.1, options?.worldHeight ?? 3);
    const aspect = pixelSize.w / Math.max(1, pixelSize.h);
    sprite.scale.set(worldHeight * aspect, worldHeight, 1);
    sprite.position.set(position.x, position.y, 0);
    applyLayer(sprite, Layers.TEXT, ENGINE_DEFAULTS.layers, sprite.material as Material);
    const sm = sprite.material as SpriteMaterial;
    sm.depthTest = false;
    sm.depthWrite = false;
    layers.text.add(sprite);
    return sprite;
  }

  function centerCamera() {
    state.offset = { x: -state.size.width / (2 * state.zoom), y: -state.size.height / (2 * state.zoom) };
    updateCamera();
  }
  function updateCamera() {
    const viewSize = { width: state.size.width / state.zoom, height: state.size.height / state.zoom };
    camera.left = state.offset.x;
    camera.right = state.offset.x + viewSize.width;
    camera.top = state.offset.y + viewSize.height;
    camera.bottom = state.offset.y;
    camera.updateProjectionMatrix();
  }
  function setCanvasSize(width: number, height: number) {
    state.size = { width, height };
    renderer.setSize(width, height, true);
    composer.setSize(width, height);
    centerCamera();
  }
  function setView(offset: Vec2, zoom?: number) {
    state.offset = { ...offset };
    if (zoom !== undefined) state.zoom = Math.max(zoom, 1e-3);
    updateCamera();
  }
  function getView() {
    return { offset: { ...state.offset }, zoom: state.zoom, size: { width: state.size.width / state.zoom, height: state.size.height / state.zoom } };
  }
  function screenToWorld(screenX: number, screenY: number): Vec2 {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((screenY - rect.top) / rect.height) * 2 - 1);
    const vec = new Vector3(nx, ny, 0);
    vec.unproject(camera);
    return { x: vec.x, y: vec.y };
  }

  const objects = createObjectSystem(
    scene,
    theme,
    (x1, y1, x2, y2) => addLine(x1, y1, x2, y2),
    layers.text,
    () => getView().zoom
  );

  function refreshTheme() {
    scene.background = new Color(theme.background);
    layers.grid.children.forEach(child => {
      if (child instanceof Line) { (child.material as LineBasicMaterial).color.set(theme.grid); child.material.needsUpdate = true; }
      else if (child instanceof Mesh) { (child.material as MeshBasicMaterial).color.set(theme.grid); child.material.needsUpdate = true; }
    });
    objects.updateTheme();
  }

  centerCamera();
  refreshTheme();

  const raycaster = new Raycaster();
  let panAnchor: { pointer: Vec2; offset: Vec2 } | null = null;
  let drawPath: { x: number; y: number } | null = null;
  

  const canvas = renderer.domElement;
function updateCursor(e?: PointerEvent) {
  if (panAnchor) { canvas.style.cursor = 'grabbing'; return; }
  const opts = config.interactions ?? {};
  if (e?.ctrlKey && (opts.enableSelection ?? true)) { canvas.style.cursor = 'pointer'; return; }
  if (e?.shiftKey) { canvas.style.cursor = 'not-allowed'; return; }
  canvas.style.cursor = 'crosshair';
}

  const onPointerDown = (e: PointerEvent) => {

    
    if (e.shiftKey) {
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(((e.clientX - rect.left) / canvas.clientWidth) * 2 - 1, -(((e.clientY - rect.top) / canvas.clientHeight) * 2 - 1));
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(layers.draw.children, true);
      const hit = intersects.find(it => {
        const obj = it.object as Mesh;
        const ud = obj.userData as { type?: string };
        return ud?.type === 'dot';
      });
      if (hit) {
        const obj = hit.object as Mesh;
        obj.geometry.dispose();
        (obj.material as Material).dispose();
        layers.draw.remove(obj);
      }
      return;
    }

    
    if (e.ctrlKey) {
      const rect = canvas.getBoundingClientRect();
      const mouse = new Vector2(((e.clientX - rect.left) / canvas.clientWidth) * 2 - 1, -(((e.clientY - rect.top) / canvas.clientHeight) * 2 - 1));
      raycaster.setFromCamera(mouse, camera);
      const hitId = objects.raycast(raycaster);
      objects.selectObject(hitId);
      return;
    }

    
    if (e.button === 0) {
      panAnchor = { pointer: { x: e.clientX, y: e.clientY }, offset: getView().offset };
      canvas.setPointerCapture(e.pointerId);
      updateCursor(e);
      return;
    }

    
    if (e.button === 2 && (config.interactions?.enableDrawing ?? false)) {
      const world = screenToWorld(e.clientX, e.clientY);
      const snapped = e.altKey && grid ? grid.snap(world) : world;
      if (!drawPath) { addDot(snapped.x, snapped.y); }
      else { addLine(drawPath.x, drawPath.y, snapped.x, snapped.y); addDot(snapped.x, snapped.y); }
      drawPath = snapped;
      return;
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (panAnchor) {
      const { zoom } = getView();
      const dx = (e.clientX - panAnchor.pointer.x) / zoom;
      const dy = (e.clientY - panAnchor.pointer.y) / zoom;
      setView({ x: panAnchor.offset.x - dx, y: panAnchor.offset.y + dy }, zoom);
      return;
    }
    updateCursor(e);
  };
  const endPan = (e: PointerEvent) => {
    if (!panAnchor) return;
    panAnchor = null;
    updateCursor(e);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  const onPointerUp = (e: PointerEvent) => { endPan(e); };
  const onPointerCancel = (e: PointerEvent) => { endPan(e); };
  const onWheel = (e: WheelEvent) => {
    if (config.interactions?.enableZoom === false) return;
    e.preventDefault();
    const { zoom, offset, size } = getView();
    const factor = Math.exp(-e.deltaY * ENGINE_DEFAULTS.viewport.wheelSensitivity);
    const nextZoom = Math.max(ENGINE_DEFAULTS.viewport.zoom.min, Math.min(ENGINE_DEFAULTS.viewport.zoom.max, zoom * factor));
    if (Math.abs(nextZoom - zoom) < 1e-4) return;
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    const nyInv = 1 - ny;
    const worldPt = { x: offset.x + nx * size.width, y: offset.y + nyInv * size.height };
    const newSize = { width: renderer.getSize(new Vector2()).x / nextZoom, height: renderer.getSize(new Vector2()).y / nextZoom };
    setView({ x: worldPt.x - nx * newSize.width, y: worldPt.y - nyInv * newSize.height }, nextZoom);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { drawPath = null; objects.selectObject(null); }
    if (e.key === 'Delete' || e.key === 'Backspace') { const selected = objects.getSelected(); if (selected) objects.removeObject(selected.id); }
    if (e.key === ' ') { e.preventDefault(); const selected = objects.getSelected(); if (selected) { const allPaused = selected.animations.every(a => a.paused); selected.animations.forEach(a => a.paused = !allPaused); } }
  };

  const onContextMenu = (e: Event) => { e.preventDefault(); };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  function render() { composer.render(); }
  function dispose() {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    renderer.dispose();
    // Tear down UI overlays
    ui.destroy();
    config.container.removeChild(renderer.domElement);
  }

  // UI manager (DOM overlay controls)
  const ui = createUI(document);

  return { renderer, composer, scene, camera, grid, objects, ui, addTextLabel, drawLine: addLine, render, setCanvasSize, setView, getView, dispose };
}
