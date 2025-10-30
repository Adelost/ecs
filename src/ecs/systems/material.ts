import { World } from '../world';
import { Renderable, Orientation, Style } from '../components';
import { Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, MeshPhongMaterial, MeshStandardMaterial, TextureLoader, Vector3, Quaternion } from 'three';
import { MATERIAL_PALETTE } from '../../palettes';

function toNonIndexed(mesh: Mesh) {
  if (mesh.geometry.index) mesh.geometry = mesh.geometry.toNonIndexed();
}

function hexToRgb(hex: string): [number, number, number] { const c = new Color(hex); return [c.r, c.g, c.b]; }

// Posterize luminance into a small number of bands, keep hue by scaling RGB
function posterizeRGB(r: number, g: number, b: number, bands = 5): [number, number, number] {
  const lum = 0.2126*r + 0.7152*g + 0.0722*b; // sRGB luminance
  if (lum <= 1e-6) return [0,0,0];
  const q = Math.round(lum * (bands-1)) / (bands-1);
  const s = Math.max(0, Math.min(3, q / lum));
  return [Math.max(0, Math.min(1, r*s)), Math.max(0, Math.min(1, g*s)), Math.max(0, Math.min(1, b*s))];
}

// OKLab conversion (sRGB -> linear -> OKLab), see https://bottosson.github.io/posts/oklab/
function srgbToLinear(c: number) { return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
  const l_ = 0.4122214708*rl + 0.5363325363*gl + 0.0514459929*bl;
  const m_ = 0.2119034982*rl + 0.6806995451*gl + 0.1073969566*bl;
  const s_ = 0.0883024619*rl + 0.2817188376*gl + 0.6299787005*bl;
  const l = Math.cbrt(l_), m = Math.cbrt(m_), s = Math.cbrt(s_);
  const L = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s;
  const A = 1.9779984951*l - 2.4285922050*m + 0.4505937099*s;
  const B = 0.0259040371*l + 0.7827717662*m - 0.8086757660*s;
  return [L, A, B];
}
function nearestPaletteOKLab(r: number, g: number, b: number, palette: string[]): Color {
  const [L, A, B] = rgbToOklab(r, g, b);
  let best = 0, bestD = Infinity;
  for (let i=0;i<palette.length;i++){
    const c = new Color(palette[i]);
    const [L2, A2, B2] = rgbToOklab(c.r, c.g, c.b);
    const d = (L-L2)*(L-L2) + (A-A2)*(A-A2) + (B-B2)*(B-B2);
    if (d < bestD) { bestD = d; best = i; }
  }
  return new Color(palette[best]);
}

function bakeLatitude(mesh: Mesh, axis: Vector3, bands = 10, palette = MATERIAL_PALETTE) {
  toNonIndexed(mesh);
  const geom = mesh.geometry;
  const pos = geom.getAttribute('position') as Float32BufferAttribute;
  const count = pos.count; if ((count % 3) !== 0) return;
  const colors = new Float32Array(count * 3);
  const north = axis.clone().normalize();
  const qBase = new Quaternion().setFromUnitVectors(new Vector3(0,1,0), north);
  for (let i = 0; i < count; i += 3) {
    const cx = (pos.getX(i+0) + pos.getX(i+1) + pos.getX(i+2)) / 3;
    const cy = (pos.getY(i+0) + pos.getY(i+1) + pos.getY(i+2)) / 3;
    const cz = (pos.getZ(i+0) + pos.getZ(i+1) + pos.getZ(i+2)) / 3;
    const unitLocal = new Vector3(cx, cy, cz).normalize();
    const unitWorld = unitLocal.clone().applyQuaternion(qBase);
    const lat01 = 0.5 * (north.dot(unitWorld) + 1);
    const step = Math.round(lat01 * Math.max(1, bands - 1)) / Math.max(1, bands - 1);
    const idx = Math.min(palette.length - 1, Math.floor(step * (palette.length - 1)));
    const [r,g,b] = hexToRgb(palette[idx]);
    for (let k=0;k<3;k++){ colors[3*(i+k)+0]=r; colors[3*(i+k)+1]=g; colors[3*(i+k)+2]=b; }
  }
  geom.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

function bakeTextureQuantized(mesh: Mesh, axis: Vector3, textureUrl: string, bands = 6, palette = MATERIAL_PALETTE) {
  toNonIndexed(mesh);
  const geom = mesh.geometry;
  const pos = geom.getAttribute('position') as Float32BufferAttribute;
  const count = pos.count; if ((count % 3) !== 0) return;
  const canvas = document.createElement('canvas');
  // Hint to browsers that we will call getImageData frequently during baking
  const ctx = canvas.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const colors = new Float32Array(count * 3);
    const north = axis.clone().normalize();
    const qBase = new Quaternion().setFromUnitVectors(new Vector3(0,1,0), north);
    const ref = Math.abs(north.y) < 0.99 ? new Vector3(0,1,0) : new Vector3(1,0,0);
    const Uaxis = new Vector3().crossVectors(ref, north).normalize();
    const Vaxis = new Vector3().crossVectors(north, Uaxis).normalize();
    for (let i=0;i<count;i+=3) {
      const cx = (pos.getX(i+0)+pos.getX(i+1)+pos.getX(i+2))/3;
      const cy = (pos.getY(i+0)+pos.getY(i+1)+pos.getY(i+2))/3;
      const cz = (pos.getZ(i+0)+pos.getZ(i+1)+pos.getZ(i+2))/3;
      const unitLocal = new Vector3(cx,cy,cz).normalize();
      const unitWorld = unitLocal.clone().applyQuaternion(qBase);
      const dotN = Math.max(-1, Math.min(1, unitWorld.dot(north)));
      const vSph = Math.acos(dotN) / Math.PI; // 0 at north pole, 1 at south pole
      const lat01 = 1 - vSph; // 1 at north, 0 at south
      const uProjU = unitWorld.dot(Uaxis);
      const uProjV = unitWorld.dot(Vaxis);
      const uAngle = Math.atan2(uProjV, uProjU);
      const uSph = (uAngle + Math.PI) / (2*Math.PI);
      // Sample 4 points (v1,v2,v3,centroid), posterize, then find nearest in OKLab; choose dominant
      const idxs = [i+0, i+1, i+2];
      const samples: Color[] = [];
      const uvs: Array<{x:number,y:number}> = [];
      // vertices
      for (const j of idxs) {
        const vx = pos.getX(j), vy = pos.getY(j), vz = pos.getZ(j);
        const uw = new Vector3(vx,vy,vz).normalize().applyQuaternion(qBase);
        const upu = uw.dot(Uaxis), upv = uw.dot(Vaxis);
        const ang = Math.atan2(upv, upu);
        const uu = (ang + Math.PI) / (2*Math.PI);
        const dd = Math.acos(Math.max(-1, Math.min(1, uw.dot(north)))) / Math.PI;
        const vv = dd;
        uvs.push({ x: Math.min(canvas.width-1, Math.floor(((uu%1+1)%1) * canvas.width)), y: Math.min(canvas.height-1, Math.floor(vv * canvas.height)) });
      }
      // centroid
      uvs.push({ x: Math.min(canvas.width-1, Math.floor(((uSph%1+1)%1) * canvas.width)), y: Math.min(canvas.height-1, Math.floor(vSph * canvas.height)) });
      const paletteHits = new Map<string, number>();
      for (const uv of uvs) {
        const data = ctx.getImageData(uv.x, uv.y, 1, 1).data;
        const rS = data[0]/255, gS = data[1]/255, bS = data[2]/255;
        const [rp,gp,bp] = posterizeRGB(rS, gS, bS, 5);
        const c2 = nearestPaletteOKLab(rp, gp, bp, palette);
        samples.push(c2);
        paletteHits.set(c2.getHexString(), (paletteHits.get(c2.getHexString()) ?? 0) + 1);
      }
      // Choose dominant palette color
      let bestHex = samples[0].getHexString(), bestCount = 0;
      paletteHits.forEach((count, hex) => { if (count > bestCount) { bestCount = count; bestHex = hex; } });
      const chosen = new Color(`#${bestHex}`);
      for (let k=0;k<3;k++){ colors[3*(i+k)+0]=chosen.r; colors[3*(i+k)+1]=chosen.g; colors[3*(i+k)+2]=chosen.b; }
    }
    geom.setAttribute('color', new Float32BufferAttribute(colors, 3));
    // Switch mesh material to vertexColors
    mesh.material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0, roughness: 1 });
    (mesh.material as any).needsUpdate = true;
  };
  img.src = textureUrl;
}

export function MaterialSystem(_dt: number, _t: number, w: World) {
  const render = w.getResource<{ getInst: (id: number) => any }>('render') as any;
  if (!render) return;
  // Cached query for perf
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (MaterialSystem as any)._q = (MaterialSystem as any)._q || w.cached(Renderable, Orientation, Style);
  const q = (MaterialSystem as any)._q as () => [number, any, any, any][];
  for (const [eid, r, o, s] of q()) {
    const inst = render.getInst(eid);
    if (!inst) continue;
    const desired = s.mode;
    if ((inst as any).currentStyle === desired) continue;
    const axis = new Vector3(o.axis.x, o.axis.y, o.axis.z).normalize();
    if (desired === 'realistic') {
      // Rebuild map material from Renderable
      if (r.material?.type === 'map') {
        const tl = new TextureLoader();
        if (r.material.usePhong || r.material.specular) {
          const mat = new MeshPhongMaterial({ map: r.material.map ? tl.load(r.material.map) : undefined });
          if (r.material.bump) { mat.bumpMap = tl.load(r.material.bump); (mat as any).bumpScale = 0.02; }
          if (r.material.specular) { (mat as any).specularMap = tl.load(r.material.specular); }
          inst.mesh.material = mat;
        } else {
          const mat = new MeshStandardMaterial({ map: r.material.map ? tl.load(r.material.map) : undefined, metalness: 0.0, roughness: 1.0 });
          if (r.material.bump) { (mat as any).bumpMap = tl.load(r.material.bump); (mat as any).bumpScale = 0.02; }
          inst.mesh.material = mat;
        }
      } else {
        inst.mesh.material = new MeshStandardMaterial({ color: 0x9e9e9e, flatShading: true, metalness: 0, roughness: 1 });
      }
      (inst as any).currentStyle = 'realistic';
      continue;
    }
    // Imphenzia: choose latitude for gas giants, texture quant for others
    const id = r.id.toLowerCase();
    const isGiant = ['jupiter','saturn','uranus','neptune'].some(n => id.includes(n));
    if (isGiant) {
      bakeLatitude(inst.mesh, axis, 11, MATERIAL_PALETTE);
      inst.mesh.material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0, roughness: 1 });
      (inst as any).currentStyle = 'imphenzia';
    } else if (r.material?.type === 'map' && r.material.map) {
      const ice = id.includes('earth') ? { iceLat: 0.78, iceColor: '#ffffff' } : undefined;
      bakeTextureQuantized(inst.mesh, axis, r.material.map, 6, MATERIAL_PALETTE, ice);
      (inst as any).currentStyle = 'imphenzia';
    } else {
      bakeLatitude(inst.mesh, axis, 6, MATERIAL_PALETTE);
      inst.mesh.material = new MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0, roughness: 1 });
      (inst as any).currentStyle = 'imphenzia';
    }
  }
}
