// Curated Material Design-like palette (approximate sRGB hex values)
// Focus on balanced hues at mid/strong tones for stylized look
export const MATERIAL_PALETTE: string[] = [
  // Blues
  '#1E88E5', '#42A5F5', '#64B5F6',
  // Teals/Cyans
  '#00897B', '#00ACC1', '#26C6DA',
  // Greens
  '#2E7D32', '#43A047', '#66BB6A',
  // Limes/Yellows/Amber
  '#9CCC65', '#FBC02D', '#FFB300', '#FFA000',
  // Oranges/Reds
  '#FB8C00', '#F4511E', '#E53935',
  // Purples/Indigo
  '#8E24AA', '#5E35B1', '#3949AB',
  // Neutrals
  '#8D6E63', '#9E9E9E', '#607D8B'
];

export function nearestPaletteColor(hex: string, palette: string[]): string {
  const [r, g, b] = hexToRgb(hex);
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = hexToRgb(palette[i]);
    const dr = r - pr, dg = g - pg, db = b - pb;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return palette[best];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
}
