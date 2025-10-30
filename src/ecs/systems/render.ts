import { Group, Mesh, Quaternion, Vector3, SphereGeometry, IcosahedronGeometry, RingGeometry, MeshStandardMaterial, MeshPhongMaterial, TextureLoader, MeshBasicMaterial, Sprite, SpriteMaterial, CanvasTexture, Color, AdditiveBlending, PointLight, DoubleSide, Float32BufferAttribute } from 'three';
import type { Engine } from '../../engine';
import { ENGINE_DEFAULTS } from '../../types';
import { World } from '../world';
import { Transform, Orientation, Renderable, BakedVertexColors, Style, CloudBakedColors } from '../components';

type RingInst = { mesh: Mesh; qEq: Quaternion };
type Inst = { group: Group; mesh: Mesh; baseQuat: Quaternion; spinAxis: Vector3; rings?: RingInst[]; clouds?: Mesh; cloudSpin?: number; label?: Sprite; baseMat: MeshStandardMaterial | MeshPhongMaterial | MeshBasicMaterial; vcolMat: MeshStandardMaterial; cloudBaseMat?: MeshStandardMaterial; cloudVcolMat?: MeshStandardMaterial; geomKind: 'uv' | 'ico'; icoSubdiv?: number };

export class RenderSystem {
  private map = new Map<number, Inst>();
  private icoSubdivisions = 4;
  constructor(private engine: Engine) {}

  getInst(eid: number): Inst | undefined { return this.map.get(eid); }

  drawLine(x1: number, y1: number, x2: number, y2: number) {
    return this.engine.drawLine(x1, y1, x2, y2);
  }

  private root?: Group;
  private ensureRoot(engine: Engine) {
    if (!this.root) {
      this.root = new Group();
      this.root.name = 'ecs-root';
      engine.scene.add(this.root);
    }
  }

  private createGlowSprite(colorHex: string, intensity: number) {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    // Simple 2D glow; not readback-heavy, but set hint for consistency
    const ctx = canvas.getContext('2d', { willReadFrequently: false } as any)!;
    const r = size / 2;
    const col = new Color(colorHex);
    const rgb = `rgba(${Math.round(col.r * 255)}, ${Math.round(col.g * 255)}, ${Math.round(col.b * 255)},`;
    const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, `${rgb} ${Math.min(1, 0.8 * intensity)})`);
    gradient.addColorStop(0.6, `${rgb} ${Math.min(1, 0.25 * intensity)})`);
    gradient.addColorStop(1, `${rgb} 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({ map: texture, transparent: true, opacity: 1 });
    const sprite = new Sprite(material);
    sprite.material.depthTest = false;
    sprite.material.depthWrite = false;
    (sprite.material as any).blending = AdditiveBlending;
    return sprite;
  }

  private ensureNonIndexedMesh(mesh: Mesh) {
    if (mesh.geometry.index) mesh.geometry = mesh.geometry.toNonIndexed();
  }

  private applyCloudBakedOrFallback(inst: Inst, baked: { colors: Float32Array; alpha?: Float32Array } | undefined, mode: 'auto' | 'textured', r: any) {
    if (!inst.clouds) return;
    const mesh = inst.clouds;
    if (mode === 'auto') {
      this.ensureNonIndexedMesh(mesh);
      const posAttr: any = mesh.geometry.getAttribute('position');
      const expected = posAttr.count * 3;
      if (!baked || !baked.colors || baked.colors.length !== expected) {
        // Temporary low-poly fallback during re-bake
        const tmp = new Float32Array(expected);
        for (let i = 0; i < expected; i += 3) { tmp[i]=0.9; tmp[i+1]=0.9; tmp[i+2]=0.9; }
        (mesh.geometry as any).setAttribute('color', new Float32BufferAttribute(tmp, 3));
        // Provide a sane default alpha so clouds remain semi-transparent while re-baking
        const alphaArr = new Float32Array(posAttr.count).fill(0.4);
        (mesh.geometry as any).setAttribute('alphaAttr', new Float32BufferAttribute(alphaArr, 1));
        if (inst.cloudVcolMat && mesh.material !== inst.cloudVcolMat) mesh.material = inst.cloudVcolMat;
        return;
      }
      (mesh.geometry as any).setAttribute('color', new Float32BufferAttribute(baked.colors, 3));
      // Apply graded transparency if provided; otherwise use a reasonable default band
      const alphaSrc = (baked.alpha && baked.alpha.length === posAttr.count)
        ? baked.alpha
        : new Float32Array(posAttr.count).fill(0.4);
      (mesh.geometry as any).setAttribute('alphaAttr', new Float32BufferAttribute(alphaSrc, 1));
      if (inst.cloudVcolMat && mesh.material !== inst.cloudVcolMat) mesh.material = inst.cloudVcolMat;
    } else {
      // Textured: remove vertex colors and restore base cloud mat
      if ((mesh.geometry as any).getAttribute('color')) (mesh.geometry as any).deleteAttribute('color');
      if ((mesh.geometry as any).getAttribute('alphaAttr')) (mesh.geometry as any).deleteAttribute('alphaAttr');
      if (inst.cloudBaseMat && mesh.material !== inst.cloudBaseMat) mesh.material = inst.cloudBaseMat;
    }
  }

  setAutoSubdiv(level: number) {
    const l = Math.max(0, Math.min(20, Math.floor(level)));
    this.icoSubdivisions = l;
  }

  // getAutoSubdiv already exposed via world resource (see solarSystem.ts)

  // Apply baked vertex colors when available; otherwise keep a low‑poly fallback in auto mode
  private applyBakedOrFallback(inst: Inst, baked: { colors: Float32Array } | undefined, styleMode: 'auto' | 'textured') {
    if (baked && baked.colors && baked.colors.length > 0) {
      const posAttr: any = inst.mesh.geometry.getAttribute('position');
      if (inst.mesh.geometry.index) {
        inst.mesh.geometry = inst.mesh.geometry.toNonIndexed();
      }
      const posAttr2: any = inst.mesh.geometry.getAttribute('position');
      const expected2 = posAttr2.count * 3;
      if (baked.colors.length !== expected2) {
        // Geometry/detail changed; show temporary low‑poly color until re‑bake completes
        const tmp = new Float32Array(expected2);
        for (let i = 0; i < expected2; i += 3) { tmp[i] = 0.6; tmp[i+1] = 0.6; tmp[i+2] = 0.6; }
        (inst.mesh.geometry as any).setAttribute('color', new Float32BufferAttribute(tmp, 3));
        if (inst.mesh.material !== inst.vcolMat) inst.mesh.material = inst.vcolMat;
        return;
      }
      (inst.mesh.geometry as any).setAttribute('color', new Float32BufferAttribute(baked.colors, 3));
      if (inst.mesh.material !== inst.vcolMat) inst.mesh.material = inst.vcolMat;
      return;
    }
    // No baked colors yet
    if (styleMode === 'auto') {
      if (inst.mesh.geometry.index) inst.mesh.geometry = inst.mesh.geometry.toNonIndexed();
      const posAttr3: any = inst.mesh.geometry.getAttribute('position');
      const n = posAttr3.count * 3;
      const tmp = new Float32Array(n);
      for (let i = 0; i < n; i += 3) { tmp[i] = 0.6; tmp[i+1] = 0.6; tmp[i+2] = 0.6; }
      (inst.mesh.geometry as any).setAttribute('color', new Float32BufferAttribute(tmp, 3));
      if (inst.mesh.material !== inst.vcolMat) inst.mesh.material = inst.vcolMat;
    } else {
      if ((inst.mesh.geometry as any).getAttribute('color')) (inst.mesh.geometry as any).deleteAttribute('color');
      if (inst.mesh.material !== inst.baseMat) inst.mesh.material = inst.baseMat;
    }
  }

  getAutoSubdiv(): number {
    return this.icoSubdivisions;
  }

  private ensure(e: number, r: any, axisVec: Vector3, styleMode: 'auto' | 'textured'): Inst {
    let inst = this.map.get(e);
    if (inst) {
      // Use Icosahedron for both styles; rebuild only when subdivision changes
      const desired: 'uv' | 'ico' = 'ico';
      if (inst.geomKind !== desired || inst.icoSubdiv !== this.icoSubdivisions) {
        const subdivisions = this.icoSubdivisions;
        // Rebuild planet geometry
        (inst.mesh.geometry as any)?.dispose?.();
        inst.mesh.geometry = new IcosahedronGeometry(r.size / 2, subdivisions);
        // Rebuild cloud geometry (if present) to keep vertex counts in sync
        if (inst.clouds) {
          (inst.clouds.geometry as any)?.dispose?.();
          const cloudRadius = (r.size / 2) * (r.atmosphere?.scale ?? 1.03);
          inst.clouds.geometry = new IcosahedronGeometry(cloudRadius, subdivisions);
        }
        inst.icoSubdiv = subdivisions;
        inst.geomKind = desired;
      }
      return inst;
    }
    this.ensureRoot(this.engine);
    const group = new Group();
    group.name = `ecs-${r.id}`;
    this.root!.add(group);
    // Place geometry layer z for correct render ordering
    group.position.z = ENGINE_DEFAULTS.layers.geometry.z;
    // Geometry: use Icosahedron for both styles so everything is subdivided uniformly
    const subdivisions = this.icoSubdivisions;
    const geom: any = new IcosahedronGeometry(r.size / 2, subdivisions);
    const geomKind: 'uv' | 'ico' = 'ico';
    let meshMat: MeshStandardMaterial | MeshPhongMaterial | MeshBasicMaterial;
    const tl = new TextureLoader();
    if (r.material?.type === 'map') {
      if (r.material.usePhong || r.material.specular) {
        const mat = new MeshPhongMaterial({ map: r.material.map ? tl.load(r.material.map) : undefined });
        if (r.material.bump) { mat.bumpMap = tl.load(r.material.bump); mat.bumpScale = 0.02; }
        if (r.material.specular) { mat.specularMap = tl.load(r.material.specular); }
        meshMat = mat;
      } else {
        const mat = new MeshStandardMaterial({ map: r.material.map ? tl.load(r.material.map) : undefined, metalness: 0.0, roughness: 1.0 });
        if (r.material.bump) { mat.bumpMap = tl.load(r.material.bump); mat.bumpScale = 0.02; }
        meshMat = mat;
      }
    } else {
      // Fallback for palette mode (we ignore palette baking here)
      meshMat = new MeshStandardMaterial({ color: 0x9e9e9e, flatShading: true, metalness: 0, roughness: 1 });
    }
    const mesh = new Mesh(geom, meshMat);
    group.add(mesh);

    // Glow + light (e.g., sun)
    if (r.glow) {
      const sprite = this.createGlowSprite(r.glow.color ?? '#FFA726', r.glow.intensity ?? 1);
      const glowSize = r.glow.size ?? r.size * 12;
      sprite.scale.set(glowSize, glowSize, 1);
      sprite.position.set(0, 0, 0);
      group.add(sprite);
      if (r.glow.light) {
        const lc = r.glow.light;
        const light = new PointLight(lc.color ?? '#ffffff', lc.intensity ?? 8.0, lc.distance ?? 0, lc.decay ?? 1);
        light.castShadow = true;
        if (lc.shadow) {
          light.shadow.mapSize.set(lc.shadow.mapSize ?? 4096, lc.shadow.mapSize ?? 4096);
          light.shadow.bias = lc.shadow.bias ?? -0.00005;
          light.shadow.normalBias = lc.shadow.normalBias ?? 0.03;
          light.shadow.camera.near = lc.shadow.near ?? 0.1;
          light.shadow.camera.far = lc.shadow.far ?? 500;
        }
        group.add(light);
      }
    }

    // Base orientation from axis
    const qBase = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axisVec);
    // Rings
    let rings: RingInst[] | undefined;
    if (r.rings) {
      const inner = (r.rings.inner ?? 1.5) * (r.size / 2);
      const outer = Math.max(inner + (r.size * 0.12), (r.rings.outer ?? 2.8) * (r.size / 2));
      const geo = new RingGeometry(inner, outer, 256);
      // Radial UV mapping: U from inner->outer, V = 0.5
      const pos = geo.getAttribute('position');
      const count = pos.count;
      const data = new Float32Array(count * 2);
      const rSpan = Math.max(1e-6, outer - inner);
      for (let i = 0; i < count; i++) {
        const x = (pos as any).getX(i);
        const y = (pos as any).getY(i);
        const rLen = Math.sqrt(x * x + y * y);
        const u = (rLen - inner) / rSpan;
        data[2 * i + 0] = Math.min(1, Math.max(0, u));
        data[2 * i + 1] = 0.5;
      }
      if ((geo as any).getAttribute('uv')) (geo as any).deleteAttribute('uv');
      (geo as any).setAttribute('uv', new (pos as any).constructor(data, 2));
      const baseMat = new MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false });
      const baseRing = new Mesh(geo, baseMat);
      const qEq = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(0, 1, 0));
      // Inst ring orientation in RingsSystem; here just add to group
      group.add(baseRing);
      rings = [{ mesh: baseRing, qEq }];
      if (r.rings.texture) {
        const tex = tl.load(r.rings.texture);
        const ringMat = new MeshBasicMaterial({ map: tex, transparent: true, side: DoubleSide, depthWrite: false });
        const ring = new Mesh(geo, ringMat);
        group.add(ring);
        rings.push({ mesh: ring, qEq });
      }
    }

    // Clouds
    let clouds: Mesh | undefined; let cloudSpin: number | undefined;
    let cloudBaseMat: MeshStandardMaterial | undefined;
    let cloudVcolMat: MeshStandardMaterial | undefined;
    if (r.atmosphere && (r.atmosphere.map || r.atmosphere.alpha)) {
      const cloudsGeo = new IcosahedronGeometry((r.size / 2) * (r.atmosphere.scale ?? 1.03), this.icoSubdivisions);
      // Cache both materials once: base textured and low-poly vertex-color variant
      cloudBaseMat = new MeshStandardMaterial({ map: r.atmosphere.map ? tl.load(r.atmosphere.map) : undefined, alphaMap: r.atmosphere.alpha ? tl.load(r.atmosphere.alpha) : undefined, transparent: true, depthWrite: false, roughness: 1.0, metalness: 0.0 });
      cloudVcolMat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, depthWrite: false, roughness: 1.0, metalness: 0.0 });
      cloudVcolMat.onBeforeCompile = (shader: any) => {
        // Vertex: pass alphaAttr to fragment as vAlpha
        shader.vertexShader = shader.vertexShader
          .replace('void main() {', 'attribute float alphaAttr;\n varying float vAlpha;\n void main() {')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n vAlpha = alphaAttr;');
        // Fragment: multiply computed alpha by vAlpha close to the output stage.
        // This is robust across Three versions by hooking into dithering_fragment include.
        shader.fragmentShader = shader.fragmentShader
          .replace('void main() {', 'varying float vAlpha;\n void main() {')
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.a *= vAlpha;');
      };
      clouds = new Mesh(cloudsGeo, cloudBaseMat);
      cloudSpin = r.atmosphere.spinSpeed ?? 0.02;
      // Parent clouds under the planet mesh so they inherit daily spin;
      // drift is applied by CloudsSystem on top of that.
      mesh.add(clouds);
    }

    const vcolMat = new MeshStandardMaterial({ vertexColors: true, flatShading: true, metalness: 0, roughness: 1 });
    inst = { group, mesh, baseQuat: qBase, spinAxis: axisVec.clone(), rings, clouds, cloudSpin, baseMat: meshMat, vcolMat, cloudBaseMat, cloudVcolMat, geomKind, icoSubdiv: this.icoSubdivisions } as Inst;
    this.map.set(e, inst);
    return inst;
  }

  private q: (() => [number, any, any, any, any][]) | null = null;
  update(w: World) {
    if (!this.q) this.q = w.cached(Transform, Orientation, Renderable, Style);
    const entries = this.q();
    const present = new Set<number>();
    for (const [e, t, o, r, s] of entries) {
      present.add(e);
      const axis = new Vector3(o.axis.x, o.axis.y, o.axis.z).normalize();
      const mode: 'auto' | 'textured' = (s?.mode === 'textured') ? 'textured' : 'auto';
      const inst = this.ensure(e, r, axis, mode);
      inst.group.position.set(t.x, t.y, inst.group.position.z);
      const qSpin = new Quaternion().setFromAxisAngle(axis, o.angle);
      inst.mesh.quaternion.multiplyQuaternions(qSpin, inst.baseQuat);
      // Do not override clouds quaternion here; clouds inherit mesh rotation and
      // CloudsSystem adds gentle drift around local +Y.
      // Apply baked vertex colors if present; else keep low‑poly fallback in auto mode
      const baked = (w as any).get(e, BakedVertexColors as any) as { colors: Float32Array } | undefined;
      this.applyBakedOrFallback(inst, baked, mode);
      // Clouds: apply baked or fallback for clouds too
      const cloudBaked = (w as any).get(e, CloudBakedColors as any) as { colors: Float32Array; alpha?: Float32Array } | undefined;
      this.applyCloudBakedOrFallback(inst, cloudBaked, mode, r);
    }
    // GC any instances that no longer have required components
    for (const [eid, inst] of this.map.entries()) {
      if (!present.has(eid)) {
        if (inst.group.parent) inst.group.parent.remove(inst.group);
        // Best-effort disposal
        (inst.mesh.geometry as any)?.dispose?.();
        const mat: any = inst.mesh.material as any;
        if (mat?.map) mat.map.dispose?.();
        mat?.dispose?.();
        if (inst.rings) inst.rings.forEach(r => { (r.mesh.geometry as any)?.dispose?.(); (r.mesh.material as any)?.dispose?.(); r.mesh.parent && r.mesh.parent.remove(r.mesh); });
        if (inst.clouds) {
          (inst.clouds.geometry as any)?.dispose?.();
          (inst.clouds.material as any)?.dispose?.();
          inst.clouds.parent && inst.clouds.parent.remove(inst.clouds);
        }
        // Dispose cached cloud materials
        if (inst.cloudBaseMat) {
          const m: any = inst.cloudBaseMat;
          if (m.map) m.map.dispose?.(); if (m.alphaMap) m.alphaMap.dispose?.(); m.dispose?.();
        }
        if (inst.cloudVcolMat) inst.cloudVcolMat.dispose?.();
        if (inst.label) { const m: any = inst.label.material; if (m?.map) m.map.dispose?.(); m?.dispose?.(); inst.label.parent && inst.label.parent.remove(inst.label); }
        this.map.delete(eid);
      }
    }
  }
}
