export type Vec2 = { x: number; y: number };
export type Position = readonly [number, number] | Vec2;

export interface Theme {
  background: string;
  grid: string;
  line: string;
  dot: string;
  geometry: string;
  selection: string;
}

export const ObjectTypes = {
  BOX: 'box',
  SPHERE: 'sphere',
  CYLINDER: 'cylinder',
  TORUS: 'torus'
} as const;
export type ObjectType = typeof ObjectTypes[keyof typeof ObjectTypes];

export const Materials = {
  DEFAULT: 'default',
  SHINY: 'shiny',
  MATTE: 'matte',
  METAL: 'metal'
} as const;
export type MaterialPreset = typeof Materials[keyof typeof Materials];

export const Animations = {
  ROTATE: 'rotate',
  ORBIT: 'orbit',
  OSCILLATE: 'oscillate'
} as const;
export type AnimationType = typeof Animations[keyof typeof Animations];

export const Layers = {
  GRID: 'grid',
  IMAGE: 'image',
  GEOMETRY: 'geometry',
  LINE: 'line',
  DOT: 'dot',
  TEXT: 'text'
} as const;
export type LayerKey = typeof Layers[keyof typeof Layers];

export const Axis = {
  X: { x: 1, y: 0, z: 0 } as const,
  Y: { x: 0, y: 1, z: 0 } as const,
  Z: { x: 0, y: 0, z: 1 } as const,
  tilted: (degrees: number, around: 'x' | 'y' | 'z' = 'z'): { x: number; y: number; z: number } => {
    const rad = (degrees * Math.PI) / 180;
    if (around === 'z') return { x: Math.sin(rad), y: 0, z: Math.cos(rad) };
    if (around === 'y') return { x: 0, y: Math.cos(rad), z: Math.sin(rad) };
    return { x: Math.cos(rad), y: Math.sin(rad), z: 0 };
  }
} as const;

export type PaletteMaterial = {
  type: 'palette';
  // Mode 'ndotL' quantizes N·L to palette; 'earth' assigns land/ocean/ice with simple procedural noise
  mode?: 'ndotL' | 'earth';
  // Lighting model: unlit = baked colors (MeshBasic), lit = use scene lights (MeshStandard), quantized = lit with banding (optional)
  lighting?: 'unlit' | 'lit' | 'quantized';
  // Optional custom palette (used in 'ndotL', ignored for 'earth' unless you want to override defaults)
  palette?: string[];
  // Optional source texture to sample colors from and then quantize to the palette
  textureSrc?: string;
  // Optional sub-rectangle of the texture atlas to sample from (normalized 0..1 in full texture space)
  textureRect?: { u0: number; v0: number; u1: number; v1: number };
  // Light direction for 'ndotL' shading
  lightDir?: { x: number; y: number; z: number };
  // Axis used as "north-south" for palette mapping (default aligns to sphere's Z axis in this engine)
  axis?: { x: number; y: number; z: number };
  // Number of steps/bands for quantization (defaults to palette length)
  bands?: number;
  // Seed for procedural noise in 'earth' mode
  seed?: number;
};

export type TextureMaterial = {
  type: 'map';
  map: string;
  bump?: string;
  specular?: string;
  normal?: string;
  metalness?: number;
  roughness?: number;
  usePhong?: boolean; // if true or if specular is present, use MeshPhongMaterial
};

export type AtmosphereConfig = {
  map?: string; // color/clouds map
  alpha?: string; // alpha mask
  scale?: number; // relative to planet radius (1.02..1.1 typical)
  spinSpeed?: number; // rotations per second for cloud layer
};

export type RingsConfig = {
  texture: string; // ring texture with alpha
  inner?: number; // inner radius multiplier w.r.t planet radius (default 1.4)
  outer?: number; // outer radius multiplier (default 2.6)
  spin?: number;  // optional spin (rotations per second) around axis
};

export type MaterialConfig =
  | MaterialPreset
  | { metalness?: number; roughness?: number; flatShading?: boolean }
  | { preset: MaterialPreset; metalness?: number; roughness?: number; flatShading?: boolean }
  | PaletteMaterial;

export interface AnimationConfig {
  type: AnimationType;
  axis: { x: number; y: number; z: number };
  speed?: number;
  radius?: number;
  amplitude?: number;
  lockRotation?: boolean;
}

export interface AnimationState {
  config: AnimationConfig;
  time: number;
  speed: number;
  paused: boolean;
}

export interface ObjectConfig {
  id: string;
  type: ObjectType;
  parent?: string;
  position: Position;
  size?: number;
  // Optional geometry detail (used by sphere)
  segments?: { width?: number; height?: number };
  color?: string;
  colorKey?: keyof Theme;
  material?: MaterialConfig | TextureMaterial;
  animations?: AnimationConfig[];
  label?:
    | string
    | {
        text?: string;
        color?: string;
        worldHeight?: number;
        fontSize?: number;
        fontFamily?: string;
        padding?: number;
        background?: string;
        offset?: Position;
      }
    | false;
  trail?: boolean | { interval?: number };
  atmosphere?: AtmosphereConfig;
  rings?: RingsConfig;
  glow?: {
    size?: number;
    intensity?: number;
    color?: string;
    light?: {
      color?: string;
      intensity?: number;
      distance?: number;
      decay?: number;
      shadow?: {
        mapSize?: number;
        near?: number;
        far?: number;
        bias?: number;
        normalBias?: number;
      };
    };
  };
}

export type LightConfig =
  | { type: 'ambient'; color: number; intensity: number }
  | { type: 'directional'; color: number; intensity: number; position: [number, number, number] };

export interface GridConfig {
  spacing: number;
  extent: number;
  normal: { opacity: number; width: number };
  major: { every: number; width: number; opacity: number };
}

export interface InteractionOptions {
  enableSelection?: boolean;
  enableDrawing?: boolean;
  enablePan?: boolean;
  enableZoom?: boolean;
}

export interface EngineConfig {
  container: HTMLElement;
  theme: Theme;
  grid?: GridConfig | false;
  interactions?: InteractionOptions;
}

export const ENGINE_DEFAULTS = {
  camera: { near: 0.1, far: 1000, z: 200 },
  viewport: { zoom: { min: 10, max: 400, initial: 100 }, wheelSensitivity: 0.0015 },
  grid: { spacing: 2, extent: 128, normal: { opacity: 0.35, width: 0.02 }, major: { every: 10, width: 0.06, opacity: 0.9 } },
  layers: {
    grid: { z: -10, depthTest: true },
    image: { z: -8, depthTest: true },
    geometry: { z: -5, depthTest: true },
    line: { z: 0, depthTest: false },
    dot: { z: 1, depthTest: false },
    text: { z: 2, depthTest: false }
  }
} as const;

export function clamp(v: number, min: number, max: number) {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

export function normalizePosition(pos: Position): Vec2 {
  if (Array.isArray(pos)) {
    const [x, y] = pos as readonly [number, number];
    return { x, y };
  }
  const { x, y } = pos as { x: number; y: number };
  return { x, y };
}
