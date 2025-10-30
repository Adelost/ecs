#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SRC = path.resolve('public/assets/planets.jpg');
// Simple arg parsing for --out <dir> or --out=<dir>
let outDirArg = null;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--out' && i + 1 < process.argv.length) { outDirArg = process.argv[++i]; continue; }
  const m = /^--out=(.+)$/.exec(a);
  if (m) { outDirArg = m[1]; }
}
const OUT_DIR = path.resolve(outDirArg || 'public/assets/planets');

const GRID = { cols: 3, rows: 3 };
// Order of tiles in the atlas grid (row-major)
const NAMES = [
  'earth', 'moon', 'mars',
  'saturn', 'mercury', 'neptune',
  'jupiter', 'venus', 'uranus'
];

// Map area within each tile (normalized). We compute a 2:1 crop centered at cy.
const MAP_RECT = { left: 0.40, right: 0.985, cy: 0.57 };

async function main() {
  try {
    await fs.access(SRC);
  } catch {
    console.error(`Source not found: ${SRC}`);
    process.exit(1);
  }
  await fs.mkdir(OUT_DIR, { recursive: true });

  const base = sharp(SRC);
  const meta = await base.metadata();
  const W = meta.width, H = meta.height;
  if (!W || !H) throw new Error('Unable to read image dimensions');

  const colWidths = [Math.floor(W / GRID.cols), Math.floor(W / GRID.cols), W - Math.floor(W / GRID.cols) * 2];
  const rowHeights = [Math.floor(H / GRID.rows), Math.floor(H / GRID.rows), H - Math.floor(H / GRID.rows) * 2];

  let y = 0;
  for (let r = 0; r < GRID.rows; r++) {
    let x = 0;
    for (let c = 0; c < GRID.cols; c++) {
      const idx = r * GRID.cols + c;
      const name = NAMES[idx];
      const tileW = colWidths[c];
      const tileH = rowHeights[r];
      const tileX = x;
      const tileY = y;

      const left = tileX + Math.round(tileW * MAP_RECT.left);
      const right = tileX + Math.round(tileW * MAP_RECT.right);
      const width = Math.max(2, right - left);
      const idealHeight = Math.round(width / 2); // equirectangular 2:1
      const cy = tileY + Math.round(tileH * MAP_RECT.cy);
      let top = cy - Math.floor(idealHeight / 2);
      // Clamp to tile bounds
      if (top < tileY) top = tileY;
      if (top + idealHeight > tileY + tileH) top = tileY + tileH - idealHeight;
      const extract = { left, top, width, height: idealHeight };

      const outFile = path.join(OUT_DIR, `${name}.png`);
      await base.clone().extract(extract).png().toFile(outFile);
      console.log(`${name}:`, extract);

      x += tileW;
    }
    y += rowHeights[r];
  }

  console.log(`Done. Wrote PNGs to ${OUT_DIR}`);
}

main().catch(err => { console.error(err); process.exit(1); });
