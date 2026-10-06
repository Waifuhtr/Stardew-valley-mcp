// Pixel-art core: text sprite format (PXT), drawing ops, palette tools, Stardew sprite specs. Browser + Node.
import { newImg, cloneImg, blit, hex, toHex } from './raster.mjs';

export const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!$%&*+=?@^~<>/|:;_';

/* PXT format (token-cheap, LLM-editable):
   pxt 16x16            <- optional header
   . transparent        <- palette: <char> <#rgb|#rrggbb|#rrggbbaa|transparent>
   k #222034
   --                   <- separator
   ....kkkk....         <- one row per line, one char per pixel; "4k" = kkkk (run-length, optional)
*/
export function parsePxt(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const pal = { '.': [0, 0, 0, 0] }, rows = [];
  let w = 0, h = 0, inRows = false;
  for (let raw of lines) {
    const l = raw.replace(/\s+#\s.*$/, '');
    if (!inRows) {
      if (!l.trim() || l.startsWith('//')) continue;
      const hd = /^pxt\s+(\d+)x(\d+)/i.exec(l); if (hd) { w = +hd[1]; h = +hd[2]; continue; }
      if (/^-{2,}\s*$/.test(l)) { inRows = true; continue; }
      const p = /^(\S)\s+(\S+)/.exec(l);
      if (p && p[1].length === 1 && /^(#|transparent)/.test(p[2])) { pal[p[1]] = hex(p[2]); continue; }
      inRows = true; // rows without separator
    }
    if (!l.trim() && !rows.length) continue;
    if (!l.trim()) continue;
    rows.push(l.trim().replace(/(\d+)(\D)/g, (_, n, c) => c.repeat(+n)));
  }
  w = w || Math.max(...rows.map(r => r.length)); h = h || rows.length;
  const im = newImg(w, h);
  const unknown = new Set();
  rows.slice(0, h).forEach((r, y) => [...r].slice(0, w).forEach((c, x) => {
    const col = pal[c]; if (!col) { unknown.add(c); return; }
    im.data.set(col, (y * w + x) * 4);
  }));
  if (unknown.size) im.warnings = [`unknown palette chars: ${[...unknown].join('')}`];
  im.palette = pal;
  return im;
}

export function palette(im, rect) {
  const [x0, y0, w, h] = rect || [0, 0, im.width, im.height];
  const m = new Map();
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * im.width + x) * 4, a = im.data[i + 3];
    const k = a === 0 ? 'transparent' : toHex(im.data[i], im.data[i + 1], im.data[i + 2], a);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

// img -> PXT text. opts: rect [x,y,w,h], rle (bool), pal (existing {char:rgba} to reuse)
export function toPxt(im, opts = {}) {
  const [x0, y0, w, h] = opts.rect || [0, 0, im.width, im.height];
  const cols = palette(im, [x0, y0, w, h]).filter(([k]) => k !== 'transparent');
  const map = new Map([['transparent', '.']]);
  const used = new Set(['.']);
  if (opts.pal) for (const [c, rgba] of Object.entries(opts.pal)) if (c !== '.') { map.set(rgba[3] ? toHex(...rgba) : 'transparent', c); used.add(c); }
  let ci = 0;
  for (const [k] of cols) {
    if (map.has(k)) continue;
    while (ci < CHARS.length && used.has(CHARS[ci])) ci++;
    if (ci >= CHARS.length) throw new Error(`too many colors (${cols.length}); quantize first (px ops ... "quantize 32")`);
    map.set(k, CHARS[ci]); used.add(CHARS[ci]);
  }
  const out = [`pxt ${w}x${h}`];
  for (const [k, c] of map) out.push(`${c} ${k}`);
  out.push('--');
  for (let y = y0; y < y0 + h; y++) {
    let r = '';
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * im.width + x) * 4, a = im.data[i + 3];
      r += map.get(a === 0 ? 'transparent' : toHex(im.data[i], im.data[i + 1], im.data[i + 2], a));
    }
    out.push(opts.rle ? r.replace(/(.)\1{2,}/g, (s, c) => s.length + c) : r);
  }
  return out.join('\n');
}

const get = (im, x, y) => { const i = (y * im.width + x) * 4; return [...im.data.subarray(i, i + 4)]; };
const set = (im, x, y, c) => { if (x < 0 || y < 0 || x >= im.width || y >= im.height) return; im.data.set(c, (y * im.width + x) * 4); };
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] || (a[3] === 0 && b[3] === 0);

function rgb2hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
function hsl2rgb(h, s, l) { const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; if (!s) return [l * 255, l * 255, l * 255].map(Math.round); const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map(v => Math.round(v * 255)); }
function eachOpaque(im, fn) { for (let i = 0; i < im.data.length; i += 4) if (im.data[i + 3]) { const r = fn(im.data[i], im.data[i + 1], im.data[i + 2]); im.data[i] = r[0]; im.data[i + 1] = r[1]; im.data[i + 2] = r[2]; } }

export const OPS_HELP = `ops (one per line or ';'-separated; colors: #hex, transparent, or a palette char defined by 'pal'):
pal k #222034 | px x y c | line x1 y1 x2 y2 c | rect x y w h c | frect x y w h c | circle cx cy r c | fcircle cx cy r c
fill x y c (flood) | replace c1 c2 | outline c [diag] | clear | canvas w h [ox oy] | crop x y w h | scale n
flipx | flipy | rot (90 cw) | shift dx dy | mirror (left half -> right) | hue deg | sat f | light f | bright n
quantize n | dither x y w h c1 c2 | paste file x y [sx sy w h] | frame fw fh i (select frame as canvas origin) | endframe`;

// apply ops script. loadImg(path) needed for 'paste'.
export function applyOps(im, script, { loadImg } = {}) {
  let img = cloneImg(im);
  const pal = { ...(im.palette || {}) };
  const C = (s) => (s && s.length === 1 && pal[s] ? pal[s] : hex(s));
  let base = null, ox = 0, oy = 0; // frame mode
  const P = (x, y, c) => set(img, x + ox, y + oy, c);
  const lines = script.split(/[;\n]/).map(s => s.trim()).filter(s => s && !s.startsWith('//'));
  for (const line of lines) {
    const [op, ...a] = line.split(/\s+/), n = a.map(Number);
    switch (op) {
      case 'pal': pal[a[0]] = hex(a[1]); break;
      case 'px': P(n[0], n[1], C(a[2])); break;
      case 'line': { let [x0, y0, x1, y1] = n; const c = C(a[4]), dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy; for (;;) { P(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } } break; }
      case 'rect': { const [x, y, w, h] = n, c = C(a[4]); for (let i = 0; i < w; i++) { P(x + i, y, c); P(x + i, y + h - 1, c); } for (let j = 0; j < h; j++) { P(x, y + j, c); P(x + w - 1, y + j, c); } break; }
      case 'frect': { const [x, y, w, h] = n, c = C(a[4]); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P(x + i, y + j, c); break; }
      case 'circle': case 'fcircle': { const [cx, cy, r] = n, c = C(a[3]); for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = x * x + y * y; if (op === 'fcircle' ? d <= r * r + r : d <= r * r + r && d >= r * r - r) P(cx + x, cy + y, c); } break; }
      case 'fill': { const sx = n[0] + ox, sy = n[1] + oy, c = C(a[2]), t = get(img, sx, sy); if (same(t, c)) break; const st = [[sx, sy]]; while (st.length) { const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= img.width || y >= img.height || !same(get(img, x, y), t)) continue; set(img, x, y, c); st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); } break; }
      case 'replace': { const c1 = C(a[0]), c2 = C(a[1]); for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (same(get(img, x, y), c1)) set(img, x, y, c2); break; }
      case 'outline': { const c = C(a[0]), diag = a[1] === 'diag', src = cloneImg(img), nb = diag ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (!src.data[(y * img.width + x) * 4 + 3] && nb.some(([dx, dy]) => { const X = x + dx, Y = y + dy; return X >= 0 && Y >= 0 && X < img.width && Y < img.height && src.data[(Y * img.width + X) * 4 + 3]; })) set(img, x, y, c); break; }
      case 'clear': img.data.fill(0); break;
      case 'canvas': { const out = newImg(n[0], n[1]); blit(out, img, 0, 0, img.width, img.height, n[2] || 0, n[3] || 0); img = out; break; }
      case 'crop': { const out = newImg(n[2], n[3]); blit(out, img, n[0], n[1], n[2], n[3], 0, 0); img = out; break; }
      case 'scale': { const out = newImg(img.width * n[0], img.height * n[0]); blit(out, img, 0, 0, img.width, img.height, 0, 0, n[0]); img = out; break; }
      case 'flipx': case 'flipy': case 'rot': case 'shift': case 'mirror': {
        const src = cloneImg(img); const W = img.width, H = img.height;
        if (op === 'rot') img = newImg(H, W);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const c = get(src, x, y);
          if (op === 'flipx') set(img, W - 1 - x, y, c); else if (op === 'flipy') set(img, x, H - 1 - y, c);
          else if (op === 'rot') set(img, H - 1 - y, x, c);
          else if (op === 'mirror') { if (x < W / 2) set(img, W - 1 - x, y, c); }
          else set(img, (x + n[0] + W) % W, (y + n[1] + H) % H, c);
        }
        break;
      }
      case 'hue': eachOpaque(img, (r, g, b) => { const [h, s, l] = rgb2hsl(r, g, b); return hsl2rgb((h + n[0] / 360 + 1) % 1, s, l); }); break;
      case 'sat': eachOpaque(img, (r, g, b) => { const [h, s, l] = rgb2hsl(r, g, b); return hsl2rgb(h, Math.min(1, s * n[0]), l); }); break;
      case 'light': eachOpaque(img, (r, g, b) => { const [h, s, l] = rgb2hsl(r, g, b); return hsl2rgb(h, s, Math.min(1, l * n[0])); }); break;
      case 'bright': eachOpaque(img, (r, g, b) => [r, g, b].map(v => Math.max(0, Math.min(255, v + n[0])))); break;
      case 'quantize': img = quantize(img, n[0]); break;
      case 'dither': { const [x, y, w, h] = n, c1 = C(a[4]), c2 = C(a[5]); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) P(x + i, y + j, (i + j) % 2 ? c2 : c1); break; }
      case 'paste': { if (!loadImg) throw new Error('paste needs a loader'); const s = loadImg(a[0]); const [x, y, sx = 0, sy = 0, w = s.width, h = s.height] = n.slice(1); blit(img, s, sx, sy, w, h, x + ox, y + oy); break; }
      case 'frame': { const [fw, fh, i] = n, cols = Math.floor(img.width / fw); ox = (i % cols) * fw; oy = Math.floor(i / cols) * fh; base = [fw, fh]; break; }
      case 'endframe': ox = oy = 0; base = null; break;
      default: throw new Error(`unknown op "${op}"\n${OPS_HELP}`);
    }
  }
  img.palette = pal;
  return img;
}

// median-cut-ish quantizer (simple popularity + nearest merge)
export function quantize(im, n) {
  const pal = palette(im).filter(([k]) => k !== 'transparent');
  if (pal.length <= n) return cloneImg(im);
  const keep = pal.slice(0, n).map(([k]) => hex(k));
  const out = cloneImg(im);
  for (let i = 0; i < out.data.length; i += 4) {
    if (!out.data[i + 3]) continue;
    let best = keep[0], bd = Infinity;
    for (const c of keep) { const d = (c[0] - out.data[i]) ** 2 + (c[1] - out.data[i + 1]) ** 2 + (c[2] - out.data[i + 2]) ** 2; if (d < bd) { bd = d; best = c; } }
    out.data.set(best, i);
  }
  return out;
}

// Stardew sprite conventions (sizes in px)
export const SPECS = {
  npc: { frame: [16, 32], cols: 4, note: 'Characters/<Name>.png. 16x32 frames, 4 per row. Row0 walk down, Row1 walk right, Row2 walk up, Row3 walk left (frame 0 = idle). Extra rows: custom animations. Width must be 64.' },
  portrait: { frame: [64, 64], cols: 2, note: 'Portraits/<Name>.png. 64x64, 2 columns. 0 neutral, 1 happy, 2 sad, 3 unique, 4 love, 5 angry, 6+ custom ($0..$5 in dialogue).' },
  farmer_hat: { frame: [20, 20], cols: 12, note: 'Characters/Farmer/hats. 20x20, 4 directions stacked vertically per hat (down,right,left,up).' },
  object: { frame: [16, 16], cols: 24, note: 'Maps/springobjects (Objects). 16x16 items, 24 per row in vanilla sheet. Custom: own texture + SpriteIndex.' },
  craftable: { frame: [16, 32], cols: 8, note: 'TileSheets/Craftables (BigCraftables). 16x32.' },
  crop: { frame: [16, 32], cols: 16, note: 'TileSheets/crops. 16x32 per stage, 2 crops per row (8 frames each).' },
  tree: { frame: [48, 96], cols: 3, note: 'TerrainFeatures/tree_*: 48x96 tree, plus stump/sapling frames.' },
  fruittree: { frame: [48, 80], cols: 9, note: 'TileSheets/fruitTrees: rows of 48x80.' },
  furniture: { frame: [16, 16], cols: 32, note: 'TileSheets/furniture. Multiples of 16; size in tiles set in Data/Furniture.' },
  tile: { frame: [16, 16], cols: 0, note: 'Map tilesheets: 16x16 tiles, sheet width multiple of 16. Seasonal: spring_/summer_/fall_/winter_ prefixes.' },
  building: { frame: [16, 16], cols: 0, note: 'Buildings/<Name>.png: width = tilesWide*16, height includes roof (taller than footprint).' },
  emote: { frame: [16, 16], cols: 4, note: 'TileSheets/emotes: 16x16, 4-frame rows.' },
};

export function checkSprite(im, kind) {
  const s = SPECS[kind]; if (!s) return [`unknown kind; known: ${Object.keys(SPECS).join(', ')}`];
  const out = [], [fw, fh] = s.frame;
  if (im.width % fw || im.height % fh) out.push(`size ${im.width}x${im.height} is not a multiple of ${fw}x${fh}`);
  if (kind === 'npc' && im.width !== 64) out.push(`NPC sheets must be 64px wide (got ${im.width})`);
  let semi = 0; for (let i = 3; i < im.data.length; i += 4) if (im.data[i] && im.data[i] < 255) semi++;
  if (semi) out.push(`${semi} semi-transparent pixels (ok for shadows, otherwise use 0/255 alpha)`);
  const cols = palette(im).length - 1;
  if (cols > 48 && fw <= 32) out.push(`${cols} colors: vanilla sprites usually use < 32 per sheet`);
  const frames = Math.floor(im.width / fw) * Math.floor(im.height / fh);
  let empty = 0;
  for (let f = 0; f < frames; f++) {
    const fx = (f % Math.floor(im.width / fw)) * fw, fy = Math.floor(f / Math.floor(im.width / fw)) * fh;
    let any = false; for (let y = fy; y < fy + fh && !any; y++) for (let x = fx; x < fx + fw; x++) if (im.data[(y * im.width + x) * 4 + 3]) { any = true; break; }
    if (!any) empty++;
  }
  out.push(`ok: ${frames} frames of ${fw}x${fh}, ${empty} empty, ${cols} colors. ${s.note}`);
  return out;
}

// frames -> horizontal strip (for previews)
export function strip(im, fw, fh, indices, gap = 1) {
  const cols = Math.floor(im.width / fw);
  const out = newImg(indices.length * (fw + gap), fh);
  indices.forEach((f, k) => blit(out, im, (f % cols) * fw, Math.floor(f / cols) * fh, fw, fh, k * (fw + gap), 0));
  return out;
}
