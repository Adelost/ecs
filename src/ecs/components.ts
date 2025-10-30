import { component } from './world';
import type { Eid } from './world';

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

// Core spatial (rotation handled by Orientation/Rotation)
export const Transform = component<{ x: number; y: number }>('Transform');
export const Orientation = component<{ axis: Vec3; angle: number }>('Orientation');
export const Parent = component<{ parentEid: Eid }>('Parent');

// Motion
// angle: radians, angularSpeed: rad/s
export const Orbit = component<{ parentEid: Eid; radius: number; angularSpeed: number; angle: number }>('Orbit');
// angle: radians, spinRate: rad/s
export const Rotation = component<{ axis: Vec3; spinRate: number; angle: number }>('Rotation');
export const TidalLock = component<{}>('TidalLock');

// Visuals
export type TextureMaterial = { type: 'map'; map: string; bump?: string; specular?: string; usePhong?: boolean; segments?: { width?: number; height?: number } };
export type PaletteMat = { type: 'palette'; mode?: 'ndotL' | 'earth' | 'latitude'; lighting?: 'unlit' | 'lit' | 'quantized'; bands?: number; textureSrc?: string };
export const Renderable = component<{ id: string; size: number; material: TextureMaterial | PaletteMat; label?: string; rings?: { texture?: string; inner?: number; outer?: number }; atmosphere?: { map?: string; alpha?: string; scale?: number; spinSpeed?: number }; trail?: boolean; glow?: { size?: number; intensity?: number; color?: string; light?: { color?: string; intensity?: number; distance?: number; decay?: number; shadow?: { mapSize?: number; near?: number; far?: number; bias?: number; normalBias?: number } } } }>('Renderable');

// Trail data for ECS-managed trails
export const Trail = component<{ step: number; cap: number; lines: any[]; last?: { x: number; y: number } }>('Trail');

// Style
export const Style = component<{ mode: 'realistic' | 'imphenzia'; paletteMode?: 'planet' | 'universal' | 'auto' }>('Style');
