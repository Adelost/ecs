"""
Extract uniform planet textures from a 3x3 grid image (planets.jpg).

- Detects the rectangular texture area within each cell of the grid
- Crops all nine textures to a common size (slightly conservative to avoid labels/borders)
- Saves named textures (earth, moon, mars, jupiter, saturn, mercury, neptune, uranus, venus)

Usage:
  python3 extract_textures_from_planets_grid.py [--out planets] [--save-rc]

Options:
  --out DIR     Output directory (default: planets)
  --save-rc     Also save row/col debug copies (rX_cY.png)

Dependencies:
  - Pillow (PIL)
"""

from PIL import Image
import os
from statistics import mean, pstdev
import argparse

IMG_PATH = 'planets.jpg'


def gray(img):
    return img.convert('L')


def get_row_dark_frac(gimg, thr=240):
    w, h = gimg.size
    px = gimg.load()
    fracs = []
    for y in range(h):
        dark = 0
        for x in range(w):
            if px[x, y] < thr:
                dark += 1
        fracs.append(dark / w)
    return fracs


def get_col_dark_frac(gimg, thr=240):
    w, h = gimg.size
    px = gimg.load()
    fracs = []
    for x in range(w):
        dark = 0
        for y in range(h):
            if px[x, y] < thr:
                dark += 1
        fracs.append(dark / h)
    return fracs


def find_texture_bounds(cell_img):
    """Earlier conservative method (used when results looked good, 1184x722).

    - Search right ~55% of the cell
    - Skip top ~14% for labels
    - Use dark-pixel fractions with adaptive thresholds and a relax fallback
    """
    cw, ch = cell_img.size
    xs = int(cw * 0.45)
    xe = int(cw * 0.98)
    ys = int(ch * 0.14)
    ye = int(ch * 0.98)
    xs = max(0, min(xs, cw - 1))
    xe = max(xs + 1, min(xe, cw))
    ys = max(0, min(ys, ch - 1))
    ye = max(ys + 1, min(ye, ch))

    roi = cell_img.crop((xs, ys, xe, ye))
    g = gray(roi)

    row_fracs = get_row_dark_frac(g, thr=240)
    col_fracs = get_col_dark_frac(g, thr=240)

    rf_base = max(0.02, sorted(row_fracs)[int(0.6 * len(row_fracs))] * 0.5)
    cf_base = max(0.02, sorted(col_fracs)[int(0.6 * len(col_fracs))] * 0.5)

    y0_rel = 0
    while y0_rel < len(row_fracs) and row_fracs[y0_rel] < rf_base:
        y0_rel += 1
    y1_rel = len(row_fracs) - 1
    while y1_rel > y0_rel and row_fracs[y1_rel] < rf_base:
        y1_rel -= 1

    x0_rel = 0
    while x0_rel < len(col_fracs) and col_fracs[x0_rel] < cf_base:
        x0_rel += 1
    x1_rel = len(col_fracs) - 1
    while x1_rel > x0_rel and col_fracs[x1_rel] < cf_base:
        x1_rel -= 1

    def relax(fracs, base, lo, hi):
        if hi - lo < 50:
            base = max(0.01, base * 0.5)
            lo2 = 0
            while lo2 < len(fracs) and fracs[lo2] < base:
                lo2 += 1
            hi2 = len(fracs) - 1
            while hi2 > lo2 and fracs[hi2] < base:
                hi2 -= 1
            return lo2, hi2
        return lo, hi

    x0_rel, x1_rel = relax(col_fracs, cf_base, x0_rel, x1_rel)
    y0_rel, y1_rel = relax(row_fracs, rf_base, y0_rel, y1_rel)

    x0 = xs + x0_rel + 2
    x1 = xs + x1_rel - 2
    y0 = ys + y0_rel + 2
    y1 = ys + y1_rel - 2

    x0 = max(0, min(x0, cw - 2))
    x1 = max(x0 + 1, min(x1, cw))
    y0 = max(0, min(y0, ch - 2))
    y1 = max(y0 + 1, min(y1, ch))

    return (x0, y0, x1, y1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='planets', help='Output directory (default: planets)')
    parser.add_argument('--save-rc', action='store_true', help='Also save rX_cY debug images')
    args = parser.parse_args()

    out_dir = args.out
    save_rc = args.save_rc

    os.makedirs(out_dir, exist_ok=True)
    im = Image.open(IMG_PATH).convert('RGB')
    W, H = im.size

    cols = [0, round(W / 3), round(2 * W / 3), W]
    rows = [0, round(H / 3), round(2 * H / 3), H]

    cell_w = [cols[i + 1] - cols[i] for i in range(3)]
    cell_h = [rows[j + 1] - rows[j] for j in range(3)]

    print(f"Grid {W}x{H}; col widths {cell_w}; row heights {cell_h}")

    # Detect bounds for each cell
    bboxes = []
    for r in range(3):
        for c in range(3):
            x0c, x1c = cols[c], cols[c + 1]
            y0c, y1c = rows[r], rows[r + 1]
            cell = im.crop((x0c, y0c, x1c, y1c))
            bx0, by0, bx1, by1 = find_texture_bounds(cell)
            bboxes.append(((r, c), (bx0, by0, bx1, by1)))
            print(f"Cell r{r}c{c} bbox in-cell: ({bx0},{by0})-({bx1},{by1}) size {bx1-bx0}x{by1-by0}")

    min_w = min(bx1 - bx0 for (_, _), (bx0, by0, bx1, by1) in bboxes)
    min_h = min(by1 - by0 for (_, _), (bx0, by0, bx1, by1) in bboxes)

    # Conservative inset to ensure uniform crop avoids any border/label
    min_w = max(8, min_w - 4)
    min_h = max(8, min_h - 4)
    print(f"Uniform crop size: {min_w}x{min_h}")

    names_grid = [
        ["earth", "moon", "mars"],
        ["jupiter", "saturn", "mercury"],
        ["neptune", "uranus", "venus"],
    ]

    # Offsets: shift textures to the right for the first column (earth/jupiter/neptune)
    # to avoid the left border seen previously. Adjust value if needed after review.
    # Fine-tuned offsets based on staged inspection of left-border width
    X_OFFSETS = {
        (0, 0): 48,  # earth (was 12; +36 more)
        (1, 0): 35,  # jupiter (was 12; +23 more)
        (2, 0): 24,  # neptune (was 12; +12 more)
    }

    for r in range(3):
        for c in range(3):
            x0c, x1c = cols[c], cols[c + 1]
            y0c, y1c = rows[r], rows[r + 1]
            bx0, by0, bx1, by1 = [b for (rc, b) in bboxes if rc == (r, c)][0]
            # Apply optional x offset for specific cells, clamped to stay within bbox
            offx = X_OFFSETS.get((r, c), 0)
            max_left = bx1 - min_w
            bx0_off = min(max_left, bx0 + max(0, offx))
            crop_rel = (bx0_off, by0, bx0_off + min_w, by0 + min_h)
            abs_box = (
                x0c + crop_rel[0],
                y0c + crop_rel[1],
                x0c + crop_rel[2],
                y0c + crop_rel[3],
            )
            tex = im.crop(abs_box)
            if save_rc:
                rc_name = f"r{r}_c{c}.png"
                tex.save(os.path.join(out_dir, rc_name))
            pname = names_grid[r][c]
            tex.save(os.path.join(out_dir, f"{pname}.png"))
            if save_rc:
                print(f"Saved {pname}.png ({tex.size}) and {rc_name}")
            else:
                print(f"Saved {pname}.png ({tex.size})")


if __name__ == '__main__':
    main()
