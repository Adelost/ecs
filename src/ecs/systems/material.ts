import { World } from '../world';
import { Renderable, Orientation, BakedVertexColors, CloudBakedColors, MaterialTag, Style } from '../components';
import { Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, MeshPhongMaterial, MeshStandardMaterial, TextureLoader, Vector3, Quaternion } from 'three';

function getNonIndexedPositions(mesh: Mesh) {
  const geom = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  return geom.getAttribute('position') as Float32BufferAttribute;
}

function hexToRgb(hex: string): [number, number, number] { const c = new Color(hex); return [c.r, c.g, c.b]; }

// Posterize luminance into a small number of bands, keep hue by scaling RGB
// sRGB <-> linear helpers
function linearToSrgb(c: number) { return c <= 0.0031308 ? 12.92*c : (1.055*Math.pow(c, 1/2.4) - 0.055); }

// OKLab inverse (to linear RGB), see https://bottosson.github.io/posts/oklab/
function oklabToRgb(L: number, A: number, B: number): [number, number, number] {
  const l_ = L + 0.3963377774*A + 0.2158037573*B;
  const m_ = L - 0.1055613458*A - 0.0638541728*B;
  const s_ = L - 0.0894841775*A - 1.2914855480*B;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const rl = + 4.0767416621*l - 3.3077115913*m + 0.2309699292*s;
  const gl = - 1.2684380046*l + 2.6097574011*m - 0.3413193965*s;
  const bl = - 0.0041960863*l - 0.7034186147*m + 1.7076147010*s;
  // convert to sRGB
  const r = linearToSrgb(Math.max(0, Math.min(1, rl)));
  const g = linearToSrgb(Math.max(0, Math.min(1, gl)));
  const b = linearToSrgb(Math.max(0, Math.min(1, bl)));
  return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
}

// Posterize in OKLab L dimension only (keeps hue/chroma more stable).
function posterizeOKLab(r: number, g: number, b: number, bands = 5): [number, number, number] {
  const [L, a, bb] = rgbToOklab(r, g, b);
  // Quantize L (avoid hitting exact 1.0 to reduce whitening)
  const qLraw = Math.round(L * (bands - 1)) / (bands - 1);
  const qL = Math.min(qLraw, 0.98);
  return oklabToRgb(qL, a, bb);
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

// latitude banding removed — kept auto palette only

function computeUniformColor(mesh: Mesh, hex: string): Float32Array {
  const pos = getNonIndexedPositions(mesh);
  const count = pos.count; if ((count % 3) !== 0) return new Float32Array(0);
  const colors = new Float32Array(count * 3);
  const c = new Color(hex);
  for (let i = 0; i < count * 3; i += 3) {
    colors[i + 0] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  return colors;
}

function bakeTextureQuantized(mesh: Mesh, axis: Vector3, textureUrl: string, bands = 6, palette: string[] | null = null, onDone?: (colors: Float32Array)=>void) {
  const pos = getNonIndexedPositions(mesh);
  const count = pos.count; if ((count % 3) !== 0) { onDone && onDone(new Float32Array(0)); return; }
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
    // Auto palette extraction if requested
    let activePalette: string[] = palette ?? extractAutoPaletteFromCanvas(ctx, canvas, 8);
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
        const [rp,gp,bp] = posterizeOKLab(rS, gS, bS, 5);
        const c2 = nearestPaletteOKLab(rp, gp, bp, activePalette);
        samples.push(c2);
        paletteHits.set(c2.getHexString(), (paletteHits.get(c2.getHexString()) ?? 0) + 1);
      }
      // Choose dominant palette color
      let bestHex = samples[0].getHexString(), bestCount = 0;
      paletteHits.forEach((count, hex) => { if (count > bestCount) { bestCount = count; bestHex = hex; } });
      const chosen = new Color(`#${bestHex}`);
      for (let k=0;k<3;k++){ colors[3*(i+k)+0]=chosen.r; colors[3*(i+k)+1]=chosen.g; colors[3*(i+k)+2]=chosen.b; }
    }
    onDone && onDone(colors);
  };
  img.src = textureUrl;
}

// In-flight bake guard and auto-palette cache to prevent repeated work and flicker
const _inflight = new Set<string>();
const _inflightClouds = new Set<string>();
const _autoPaletteCache = new Map<string, string[]>();

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
    // Two styles: 'auto' (palette) and 'textured'. For 'auto', include current subdiv in key to force re-bake when geometry detail changes.
    const isTextured = (s?.mode === 'textured');
    const subdiv = (render?.getAutoSubdiv ? render.getAutoSubdiv() : 0) as number;
    const styleKey = isTextured ? 'textured' : `auto:subdiv${subdiv}`;
    const tag = w.get(eid, MaterialTag as any) as { appliedKey: string } | undefined;
    if (tag && tag.appliedKey === styleKey) continue;
    const inflightKey = `${eid}:${styleKey}`;
    if (_inflight.has(inflightKey)) continue;
    const axis = new Vector3(o.axis.x, o.axis.y, o.axis.z).normalize();
    if (styleKey === 'textured') {
      // Remove baked colors; RenderSystem will restore base material.
      if (w.get(eid, BakedVertexColors as any)) { w.detach(eid, BakedVertexColors as any); }
      // Also remove cloud baked data so clouds revert to base textured material
      if (w.get(eid, CloudBakedColors as any)) { w.detach(eid, CloudBakedColors as any); }
      if (tag) w.mutate(eid, MaterialTag as any, t => { (t as any).appliedKey = styleKey; }); else w.attach(eid, MaterialTag as any, { appliedKey: styleKey });
      _inflight.delete(inflightKey);
      continue;
    }
    // Auto: texture quant for textured, uniform for non-textured; skip sun
    const id = r.id.toLowerCase();
    if (id.includes('sun')) {
      // Do not bake sun; ensure any previous bake is removed
      if (w.get(eid, BakedVertexColors as any)) w.detach(eid, BakedVertexColors as any);
      if (tag) w.mutate(eid, MaterialTag as any, t => { (t as any).appliedKey = styleKey; }); else w.attach(eid, MaterialTag as any, { appliedKey: styleKey });
      continue;
    }
    if (r.material?.type === 'map' && r.material.map) {
      _inflight.add(inflightKey);
      const done = (colors: Float32Array) => {
        if (w.get(eid, BakedVertexColors as any)) w.mutate(eid, BakedVertexColors as any, (bv: any) => { bv.colors = colors; });
        else w.attach(eid, BakedVertexColors as any, { colors });
        if (tag) w.mutate(eid, MaterialTag as any, t => { (t as any).appliedKey = styleKey; }); else w.attach(eid, MaterialTag as any, { appliedKey: styleKey });
        _inflight.delete(inflightKey);
      };
      // Use cached auto palette if available to avoid recomputation jitter
      const cacheKey = `${r.id}:${r.material.map}`;
      const cached = _autoPaletteCache.get(cacheKey);
      if (cached && cached.length > 0) {
        bakeTextureQuantized(inst.mesh, axis, r.material.map, 6, cached, done);
      } else {
        // Extract once, cache, then apply
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true } as any)!;
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const pal = extractAutoPaletteFromCanvas(ctx as any, canvas as any, 8);
          _autoPaletteCache.set(cacheKey, pal);
          bakeTextureQuantized(inst.mesh, axis, r.material.map, 6, pal, done);
        };
        img.onerror = () => {
          // Fallback to a small neutral palette if texture fails to load
          const neutral = ['#FFFFFF','#CCCCCC','#888888','#444444','#000000'];
          bakeTextureQuantized(inst.mesh, axis, r.material.map, 6, neutral, done);
        };
        img.src = r.material.map;
      }
      // Also bake clouds if present (compute-only; RenderSystem will apply)
      const inst2 = render.getInst(eid);
      if (inst2 && inst2.clouds) {
        const cloudTex = r.atmosphere?.map;
        // In-flight guard for clouds to avoid repeated re-bakes while geometry/detail toggles
        const cloudKey = `cloud:${eid}:${styleKey}`;
        if (_inflightClouds.has(cloudKey)) {
          // already baking this entity's clouds this style; skip this frame
        } else {
          _inflightClouds.add(cloudKey);
          const doneCloudBakeWithAlpha = (colors: Float32Array, alpha: Float32Array) => {
            if (w.get(eid, CloudBakedColors as any)) w.mutate(eid, CloudBakedColors as any, (cv: any) => { cv.colors = colors; cv.alpha = alpha; });
            else w.attach(eid, CloudBakedColors as any, { colors, alpha });
            _inflightClouds.delete(cloudKey);
          };
        const deriveBands = (vals: number[]): { alpha: Float32Array } => {
          // Coverage-driven banding: off below threshold, otherwise split mid/high by median.
          // Slightly higher off threshold increases fully transparent regions.
          const arr = [...vals].sort((a,b)=>a-b);
          const offT = 0.3;
          const nz = arr.filter(v=>v>offT);
          const median = nz.length ? nz[Math.floor(nz.length/2)] : 0.5;
          return { alpha: new Float32Array(vals.map(v => v<=offT ? 0.0 : (v<=median ? 0.4 : 0.8))) };
        };
        const computeAlphaFromImage = (mesh: Mesh, img: HTMLImageElement) => {
          const geom = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
          const pos = geom.getAttribute('position') as Float32BufferAttribute;
          const count = pos.count;
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true } as any)!;
          canvas.width = img.naturalWidth || img.width; canvas.height = img.naturalHeight || img.height;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const north = axis.clone().normalize();
          const qBase = new Quaternion().setFromUnitVectors(new Vector3(0,1,0), north);
          const ref = Math.abs(north.y) < 0.99 ? new Vector3(0,1,0) : new Vector3(1,0,0);
          const Uaxis = new Vector3().crossVectors(ref, north).normalize();
          const Vaxis = new Vector3().crossVectors(north, Uaxis).normalize();
          const faceAlpha: number[] = [];
          for (let i=0;i<count;i+=3) {
            const cx = (pos.getX(i+0)+pos.getX(i+1)+pos.getX(i+2))/3;
            const cy = (pos.getY(i+0)+pos.getY(i+1)+pos.getY(i+2))/3;
            const cz = (pos.getZ(i+0)+pos.getZ(i+1)+pos.getZ(i+2))/3;
            const unitLocal = new Vector3(cx,cy,cz).normalize();
            const unitWorld = unitLocal.clone().applyQuaternion(qBase);
            const upu = unitWorld.dot(Uaxis), upv = unitWorld.dot(Vaxis);
            const ang = Math.atan2(upv, upu);
            const uu = (ang + Math.PI) / (2*Math.PI);
            const dd = Math.acos(Math.max(-1, Math.min(1, unitWorld.dot(north)))) / Math.PI;
            const vv = dd;
            const x = Math.min(canvas.width-1, Math.floor(((uu%1+1)%1) * canvas.width));
            const y = Math.min(canvas.height-1, Math.floor(vv * canvas.height));
            const d = ctx.getImageData(x, y, 1, 1).data;
            // Always use luminance for coverage: many cloud alpha maps are grayscale with alpha=255.
            // Black (0) => fully transparent; white (1) => opaque band, gray => mid band.
            const a = (0.299*d[0]+0.587*d[1]+0.114*d[2])/255;
            faceAlpha.push(a);
          }
          // Convert per-face values to per-vertex bands
          const bands = deriveBands(faceAlpha);
          const vcount = count; const out = new Float32Array(vcount);
          for (let i=0, f=0; i<count; i+=3, f++) {
            const a = bands.alpha[f]; out[i]=a; out[i+1]=a; out[i+2]=a;
          }
          return out;
        };
        if (cloudTex) {
          // Bake cloud colors from the cloud texture using a constrained off‑white palette to avoid hue bleed.
          const CLOUD_PALETTE = ['#ffffff','#f6f7f9','#eceff1','#e0e3e7','#cfd8dc'];
          bakeTextureQuantized(inst2.clouds, axis, cloudTex, 5, CLOUD_PALETTE, (bakedColors) => {
            // Derive graded alpha from explicit alpha map if present, else from cloud texture luminance
            const g = inst2.clouds.geometry.index ? inst2.clouds.geometry.toNonIndexed() : inst2.clouds.geometry;
            const pos = g.getAttribute('position') as Float32BufferAttribute;
            const src = r.atmosphere?.alpha ?? cloudTex;
            if (src) {
              const imgAny = new Image(); imgAny.crossOrigin='anonymous';
              imgAny.onload = () => { const alphaArr = computeAlphaFromImage(inst2.clouds as Mesh, imgAny); doneCloudBakeWithAlpha(bakedColors, alphaArr); };
              imgAny.onerror = () => { const alphaArr = new Float32Array(pos.count).fill(0.4); doneCloudBakeWithAlpha(bakedColors, alphaArr); };
              imgAny.src = src;
            } else {
              const alphaArr = new Float32Array(pos.count).fill(0.4); doneCloudBakeWithAlpha(bakedColors, alphaArr);
            }
          });
        } else {
          const g = inst2.clouds.geometry.index ? inst2.clouds.geometry.toNonIndexed() : inst2.clouds.geometry;
          const pos = g.getAttribute('position') as Float32BufferAttribute;
          const colors = new Float32Array(pos.count * 3).fill(1.0);
          const alphaArr = new Float32Array(pos.count).fill(0.4);
          doneCloudBakeWithAlpha(colors, alphaArr);
        }
        }
      }
    } else {
      // No texture: use a neutral uniform color to keep low-poly clean.
      const colors = computeUniformColor(inst.mesh, '#9e9e9e');
      if (w.get(eid, BakedVertexColors as any)) w.mutate(eid, BakedVertexColors as any, (bv: any) => { bv.colors = colors; });
      else w.attach(eid, BakedVertexColors as any, { colors });
      if (tag) w.mutate(eid, MaterialTag as any, t => { (t as any).appliedKey = styleKey; }); else w.attach(eid, MaterialTag as any, { appliedKey: styleKey });
      // not async; ensure we clear any accidental inflight flag
      _inflight.delete(inflightKey);
      // Clouds without texture handled by CloudBakedColors above
    }
  }
}
// Removed planet-specific and universal palettes: auto palette extraction only.

// Auto palette extraction via simple k-means clustering in sRGB (then OKLab match during bake)
function extractAutoPaletteFromCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, k: number = 8): string[] {
  // Deterministic grid sampling to avoid palette jitter across frames
  const S = Math.min(1024, Math.max(64, Math.floor(canvas.width * canvas.height / 80)));
  const n = Math.max(4, Math.floor(Math.sqrt(S)));
  const samples: Array<[number, number, number]> = [];
  const dx = canvas.width / n;
  const dy = canvas.height / n;
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const x = Math.min(canvas.width - 1, Math.floor(gx * dx + dx * 0.5));
      const y = Math.min(canvas.height - 1, Math.floor(gy * dy + dy * 0.5));
      const d = ctx.getImageData(x, y, 1, 1).data;
      samples.push([d[0]/255, d[1]/255, d[2]/255]);
    }
  }
  // Deterministic initialization: evenly spaced seeds
  const centroids: Array<[number, number, number]> = [];
  for (let i = 0; i < k; i++) {
    const idx = Math.floor((i + 0.5) * samples.length / k) % samples.length;
    centroids.push(samples[idx].slice(0) as [number, number, number]);
  }
  const iter = 6;
  for (let it = 0; it < iter; it++) {
    const sums = new Array(k).fill(0).map(() => [0,0,0,0]);
    for (const s of samples) {
      let bi = 0, bd = Infinity;
      for (let ci = 0; ci < k; ci++) {
        const c = centroids[ci];
        const dr = c[0]-s[0], dg = c[1]-s[1], db = c[2]-s[2];
        const d = dr*dr + dg*dg + db*db;
        if (d < bd) { bd = d; bi = ci; }
      }
      const acc = sums[bi]; acc[0] += s[0]; acc[1] += s[1]; acc[2] += s[2]; acc[3] += 1;
    }
    for (let ci = 0; ci < k; ci++) {
      const acc = sums[ci];
      if (acc[3] > 0) centroids[ci] = [acc[0]/acc[3], acc[1]/acc[3], acc[2]/acc[3]];
      else {
        const idx = Math.floor(ci * (samples.length / k)) % samples.length;
        centroids[ci] = samples[idx];
      }
    }
  }
  // Convert to hex strings, then filter out excessive near-white entries
  const hex = centroids.map(c => new Color(c[0], c[1], c[2]).getHexString());
  const uniq = Array.from(new Set(hex)).map(h => `#${h}`);
  const filtered: string[] = [];
  let whiteCount = 0;
  for (const h of uniq) {
    const c = new Color(h);
    const [L, a, b] = rgbToOklab(c.r, c.g, c.b);
    const chroma = Math.sqrt(a*a + b*b);
    const isNearWhite = (L > 0.85) && (chroma < 0.045);
    if (isNearWhite) {
      if (whiteCount >= 1) continue; // keep at most one near-white entry
      whiteCount++;
    }
    filtered.push(h);
  }
  return filtered.length > 0 ? filtered : uniq;
}
