import { IcosahedronGeometry } from 'three';

function statsFor(detail) {
  const g = new IcosahedronGeometry(1, detail);
  const faces = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
  const verts = g.getAttribute('position').count;
  return { faces, verts };
}

function theo(detail) {
  // For an icosphere: faces = 20 * 4^detail, verts = 10 * 4^detail + 2
  const f = 20n * (4n ** BigInt(detail));
  const v = 10n * (4n ** BigInt(detail)) + 2n;
  return { faces: f, verts: v };
}

const max = Number(process.argv[2] ?? 10);
for (let d = 0; d <= max; d++) {
  try {
    const s = statsFor(d);
    const t = theo(d);
    console.log(`detail ${d}: actual faces=${s.faces.toLocaleString()} verts=${s.verts.toLocaleString()} | theo faces=${t.faces.toString()} verts=${t.verts.toString()}`);
  } catch (e) {
    console.log(`detail ${d}: ERROR ${e?.message || e}`);
    break;
  }
}

