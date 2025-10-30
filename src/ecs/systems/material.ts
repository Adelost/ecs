import { World } from '../world';
import { Renderable, Orientation, Style } from '../components';
import { Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, MeshPhongMaterial, MeshStandardMaterial, TextureLoader, Vector3, Quaternion } from 'three';
import { MATERIAL_PALETTE } from '../../palettes';

function toNonIndexed(mesh: Mesh) {
  if (mesh.geometry.index) mesh.geometry = mesh.geometry.toNonIndexed();
}

function hexToRgb(hex: string): [number, number, number] { const c = new Color(hex); return [c.r, c.g, c.b]; }

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

function bakeTextureQuantized(mesh: Mesh, axis: Vector3, textureUrl: string, bands = 6, palette = MATERIAL_PALETTE, opts?: { iceLat?: number; iceColor?: string }) {
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
      const x = Math.min(canvas.width-1, Math.floor(((uSph%1+1)%1) * canvas.width));
      const y = Math.min(canvas.height-1, Math.floor(vSph * canvas.height));
      const data = ctx.getImageData(x, y, 1, 1).data;
      // Polar override only if the sampled pixel is truly near white
      const iceLat = opts?.iceLat ?? -1;
      const isPolar = iceLat >= 0 && (lat01 >= iceLat || lat01 <= (1 - iceLat));
      let usedOverride = false;
      if (isPolar && opts?.iceColor) {
        const r = data[0]/255, g = data[1]/255, b = data[2]/255;
        const maxc = Math.max(r,g,b), minc = Math.min(r,g,b);
        const chroma = maxc - minc;                    // colorfulness
        const luminance = 0.2126*r + 0.7152*g + 0.0722*b; // perceived brightness
        if (luminance > 0.9 && chroma < 0.08) { // truly close to white
          const c2 = new Color(opts.iceColor);
          for (let k=0;k<3;k++){ colors[3*(i+k)+0]=c2.r; colors[3*(i+k)+1]=c2.g; colors[3*(i+k)+2]=c2.b; }
          usedOverride = true;
        }
      }
      if (!usedOverride) {
        // Quantize to nearest palette color
        let bestIdx = 0, bestD = 1e9;
        const rS = data[0]/255, gS = data[1]/255, bS = data[2]/255;
        for (let p=0;p<palette.length;p++){
          const c = new Color(palette[p]);
          const dr = c.r - rS, dg = c.g - gS, db = c.b - bS;
          const d = dr*dr + dg*dg + db*db;
          if (d < bestD){ bestD = d; bestIdx = p; }
        }
        const c2 = new Color(palette[bestIdx]);
        for (let k=0;k<3;k++){ colors[3*(i+k)+0]=c2.r; colors[3*(i+k)+1]=c2.g; colors[3*(i+k)+2]=c2.b; }
      }
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
