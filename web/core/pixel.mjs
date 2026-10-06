// Pixel-art core: text sprite format (PXT), drawing ops, palette tools, Stardew sprite specs. Browser + Node.
import { newImg, cloneImg, blit, hex, toHex } from './raster.mjs';

export const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!$%&*+=?@^~<>/|:;_';

/* PXT format (token-cheap, LLM-editable):
   pxt 16x16            <- optional header (required when using layers)
   . transparent        <- palette: <char> <#rgb|#rrggbb|#rrggbbaa|transparent>
   k #222034
   --                   <- separator
   ....kkkk....         <- one row per line, one char per pixel; "4k" = kkkk (run-length, optional)
   @layer hair 3 0      <- optional: start a layer named "hair" at offset x=3 y=0 (add "hidden" to skip)
   .kkk.                   layer rows can be smaller than the canvas; '.' is transparent
*/
export function parsePxt(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const pal = { '.': [0, 0, 0, 0] }, blocks = [];
  let w = 0, h = 0, inRows = false, cur = null;
  const block = (name, x = 0, y = 0, hidden = false) => { cur = { name, x, y, hidden, rows: [] }; blocks.push(cur); };
  for (const raw of lines) {
    const l = raw.replace(/\s+#\s.*$/, '');
    if (!inRows) {
      if (!l.trim() || l.startsWith('//')) continue;
      const hd = /^pxt\s+(\d+)x(\d+)/i.exec(l); if (hd) { w = +hd[1]; h = +hd[2]; continue; }
      if (/^-{2,}\s*$/.test(l)) { inRows = true; continue; }
      const p = /^(\S)\s+(\S+)/.exec(l);
      if (p && p[1].length === 1 && /^(#|transparent)/.test(p[2])) { pal[p[1]] = hex(p[2]); continue; }
      inRows = true; // rows without separator
    }
    if (!l.trim() || l.startsWith('//')) continue;
    const ly = /^@layer\s+(\S+)(?:\s+(-?\d+)\s+(-?\d+))?(\s+hidden)?/.exec(l.trim());
    if (ly) { block(ly[1], +(ly[2] || 0), +(ly[3] || 0), !!ly[4]); continue; }
    if (!cur) block('base');
    cur.rows.push(l.trim().replace(/(\d+)(\D)/g, (_, n, c) => c.repeat(+n)));
  }
  if (!blocks.length) block('base');
  w = w || Math.max(1, ...blocks.map(b => b.x + Math.max(0, ...b.rows.map(r => r.length))));
  h = h || Math.max(1, ...blocks.map(b => b.y + b.rows.length));
  const unknown = new Set();
  const layers = blocks.map(b => {
    const lw = Math.max(1, ...b.rows.map(r => r.length)), img = newImg(lw, Math.max(1, b.rows.length));
    b.rows.forEach((r, y) => [...r].forEach((c, x) => { const col = pal[c]; if (!col) { unknown.add(c); return; } img.data.set(col, (y * lw + x) * 4); }));
    return { name: b.name, x: b.x, y: b.y, hidden: b.hidden, img };
  });
  const im = flatten(layers, w, h);
  if (unknown.size) im.warnings = [`unknown palette chars: ${[...unknown].join('')}`];
  im.palette = pal; im.layers = layers;
  return im;
}

// layers [{name,x,y,hidden,img}] -> one image (first layer = bottom)
export function flatten(layers, w, h) {
  const out = newImg(w, h);
  for (const L of layers) if (!L.hidden) blit(out, L.img, 0, 0, L.img.width, L.img.height, L.x, L.y);
  return out;
}

// bounding box of opaque pixels [x,y,w,h] or null
export function bbox(im, rect) {
  const [x0, y0, w, h] = rect || [0, 0, im.width, im.height];
  let a = Infinity, b = Infinity, c = -1, d = -1;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (im.data[(y * im.width + x) * 4 + 3]) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
  return c < 0 ? null : [a, b, c - a + 1, d - b + 1];
}

// layered PXT: shared palette, every layer cropped to its content (cheap to read & edit one part)
export function toLayeredPxt(layers, w, h, opts = {}) {
  const all = newImg(1, 1); const parts = [];
  for (const L of layers) { const bb = bbox(L.img); parts.push({ L, bb }); }
  // shared palette from all layers
  const pal = new Map([['transparent', '.']]); let ci = 0;
  for (const { L } of parts) for (const [k] of palette(L.img)) if (!pal.has(k)) { if (ci >= CHARS.length) throw new Error('too many colors'); pal.set(k, CHARS[ci++]); }
  const out = [`pxt ${w}x${h}`, ...[...pal].map(([k, c]) => `${c} ${k}`), '--'];
  for (const { L, bb } of parts) {
    if (!bb) { out.push(`@layer ${L.name} 0 0${L.hidden ? ' hidden' : ''}`); continue; }
    out.push(`@layer ${L.name} ${L.x + bb[0]} ${L.y + bb[1]}${L.hidden ? ' hidden' : ''}`);
    for (let y = bb[1]; y < bb[1] + bb[3]; y++) {
      let r = '';
      for (let x = bb[0]; x < bb[0] + bb[2]; x++) { const i = (y * L.img.width + x) * 4, a = L.img.data[i + 3]; r += pal.get(a ? toHex(L.img.data[i], L.img.data[i + 1], L.img.data[i + 2], a) : 'transparent'); }
      out.push(opts.rle ? r.replace(/(.)\1{2,}/g, (s, c) => s.length + c) : r);
    }
  }
  void all;
  return out.join('\n');
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
quantize n | dither x y w h c1 c2 | paste file x y [sx sy w h] | frame fw fh i (select frame as canvas origin) | endframe
copy sx sy w h dx dy | move sx sy w h dx dy | copyframe fw fh src dst [flipx] | remap c1,c2,.. d1,d2,.. | snap [c1,c2,..] (to locked palette)
fpoly x1 y1 x2 y2 ... c | mask x y w h | mask poly x1 y1 ... | mask opaque | unmask  (mask clips every later op; add "and" to intersect)
textures (RAMP = c1,c2,.. dark->light or ramp:#hex): planks x y w h h|v size RAMP [seed] | dplanks x y w h angle size RAMP [seed] (boards at any angle, e.g. roof slopes) | shingles x y w h sw sh RAMP [seed]
bricks x y w h bw bh mortar RAMP [seed] | gradient x y w h c1 c2 [v|h] (dithered; transparent side is skipped) | noise x y w h c amount [seed]
colors may have alpha (#00000055) -> blended (shadows, glow)`;

// apply ops script. loadImg(path) needed for 'paste'.
export function applyOps(im, script, { loadImg, lockPal } = {}) {
  let img = cloneImg(im);
  const pal = { ...(im.palette || {}) };
  const C = (s) => (s && s.length === 1 && pal[s] ? pal[s] : hex(s));
  let base = null, ox = 0, oy = 0, clip = null; // frame mode, clip mask
  const P = (x, y, c) => { const X = x + ox, Y = y + oy; if (clip && !clip[Y * img.width + X]) return; if (c[3] && c[3] < 255) { if (X < 0 || Y < 0 || X >= img.width || Y >= img.height) return; const i = (Y * img.width + X) * 4, a = c[3] / 255; for (let k = 0; k < 3; k++) img.data[i + k] = Math.round(img.data[i + k] * (1 - a) + c[k] * a); img.data[i + 3] = Math.max(img.data[i + 3], c[3]); return; } set(img, X, Y, c); };
  const R = (spec) => (/^ramp:/.test(spec) ? ramp(spec.slice(5), 5) : spec.split(',')).map(C); // dark..light
  const rng = (seed) => { let t = (seed | 0) + 0x6d2b79f5; return () => { t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const inPoly = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) { const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
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
      case 'copy': case 'move': { const [sx, sy, w, h, dx, dy] = n, src = cloneImg(img); if (op === 'move') for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(img, sx + i + ox, sy + j + oy, [0, 0, 0, 0]); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const c = get(src, sx + i + ox, sy + j + oy); if (c[3] || op === 'move') P(dx + i, dy + j, c); } break; }
      case 'copyframe': { const [fw, fh, fa, fb] = n, flip = a[4] === 'flipx', cols = Math.floor(img.width / fw), src = cloneImg(img);
        const ax = (fa % cols) * fw, ay = Math.floor(fa / cols) * fh, bx = (fb % cols) * fw, by = Math.floor(fb / cols) * fh;
        for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) set(img, bx + (flip ? fw - 1 - i : i), by + j, get(src, ax + i, ay + j)); break; }
      case 'remap': { const from = a[0].split(',').map(C), to = a[1].split(',').map(C); for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const c = get(img, x, y); const k = from.findIndex(f => same(f, c)); if (k >= 0 && to[k]) set(img, x, y, to[k]); } break; }
      case 'snap': { const cols = a.length ? a.join(' ').split(/[ ,]+/).map(C) : (lockPal || []); img = snapToPalette(img, cols).img; break; }
      case 'fpoly': { const pts = n.slice(0, -1), c = C(a[a.length - 1]); const xs = pts.filter((_, i) => !(i % 2)), ys = pts.filter((_, i) => i % 2);
        for (let y = Math.min(...ys); y <= Math.max(...ys); y++) for (let x = Math.min(...xs); x <= Math.max(...xs); x++) if (inPoly(pts, x + .5, y + .5)) P(x, y, c); break; }
      case 'mask': { // mask rect x y w h | mask poly x1 y1 ... | mask opaque (current pixels)
        const m = new Uint8Array(img.width * img.height);
        if (a[0] === 'poly') { const pts = n.slice(1); for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) m[y * img.width + x] = inPoly(pts, x - ox + .5, y - oy + .5) ? 1 : 0; }
        else if (a[0] === 'opaque') { for (let i = 0; i < m.length; i++) m[i] = img.data[i * 4 + 3] ? 1 : 0; }
        else { const [x, y, w, h] = a[0] === 'rect' ? n.slice(1) : n; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i + ox >= 0 && j + oy >= 0 && i + ox < img.width && j + oy < img.height) m[(j + oy) * img.width + i + ox] = 1; }
        clip = clip && a.includes('and') ? clip.map((v, i) => v & m[i]) : m; break; }
      case 'unmask': clip = null; break;
      case 'gradient': { // gradient x y w h c1 c2 [v|h] : dithered (4x4 Bayer) between two colors
        const [x, y, w, h] = n, c1 = C(a[4]), c2 = C(a[5]), hor = a[6] === 'h', B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const t = hor ? i / Math.max(1, w - 1) : j / Math.max(1, h - 1), c = t * 16 > B[((y + j) & 3) * 4 + ((x + i) & 3)] + .5 ? c2 : c1; if (c[3]) P(x + i, y + j, c); } break; }
      case 'noise': { // noise x y w h c amount seed : sparse speckles (only on opaque pixels)
        const [x, y, w, h] = n, c = C(a[4]), amt = +a[5] || 0.08, r = rng(+a[6] || 1);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = r(); if (v < amt && get(img, x + i + ox, y + j + oy)[3]) P(x + i, y + j, c); } break; }
      case 'planks': case 'dplanks': {
        // planks x y w h h|v size RAMP [seed] | dplanks x y w h angle size RAMP [seed]
        // boards: lit top edge, dark gap at the bottom, butt joints, short knot dashes (no random single pixels)
        const [x, y, w, h] = n, ang = op === 'planks' ? (a[4] === 'v' ? 90 : 0) : +a[4];
        const sz = +a[5] || 4, rp = R(a[6]), seed = +a[7] || 7, L = rp.length, rad = ang * Math.PI / 180, ca = Math.cos(rad), sa = Math.sin(rad);
        const hsh = (p, q) => { let t = Math.imul(p * 374761393 + q * 668265263 + seed * 2246822519, 1274126177); t ^= t >>> 13; t = Math.imul(t, 1103515245); return ((t ^ (t >>> 16)) >>> 0) / 4294967296; };
        for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
          const t = px * ca + py * sa, u = -px * sa + py * ca, b = Math.floor(u / sz), k = u - b * sz;
          const tone = Math.min(L - 2, Math.max(1, Math.round((L - 1) / 2 + (hsh(b, 0) - 0.5) * 1.5)));
          const seg = 14 + Math.floor(hsh(b, 1) * 26), off = Math.floor(hsh(b, 2) * seg), tt = Math.floor(t) + off, jt = ((tt % seg) + seg) % seg;
          let c = rp[tone];
          if (k >= sz - 1) c = rp[0];
          else if (k < 1) c = rp[Math.min(L - 1, tone + 1)];
          else if (jt === 0) c = rp[0];
          else if (jt === 1) c = rp[Math.min(L - 1, tone + 1)];
          else if (sz >= 4 && ang % 90 === 0 && Math.abs(k - sz / 2) < 0.6) { const kn = Math.floor(tt / 5); if (hsh(b, kn + 9) < 0.14) c = rp[Math.max(0, tone - 1)]; }
          P(px, py, c);
        }
        break; }
      case 'shingles': { // shingles x y w h sw sh ramp [seed] : staggered shingles, light top-left, dark bottom
        const [x, y, w, h, sw, sh] = n, rp = R(a[6]), r = rng(+a[7] || 3), L = rp.length;
        for (let row = 0; row * sh < h; row++) {
          const off = row % 2 ? Math.floor(sw / 2) : 0;
          for (let col = -1; col * sw < w; col++) {
            const tone = Math.min(L - 2, Math.max(1, Math.round((L - 1) / 2 + (r() - 0.5) * 1.4)));
            for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
              const px = x + col * sw + off + i, py = y + row * sh + j; if (px < x || px >= x + w || py >= y + h) continue;
              let c = rp[tone];
              if (j === sh - 1) c = rp[0]; else if (i === 0) c = rp[Math.max(0, tone - 1)]; else if (j === 0 || i === 1) c = rp[Math.min(L - 1, tone + 1)];
              P(px, py, c);
            }
          }
        }
        break; }
      case 'bricks': { // bricks x y w h bw bh mortar ramp [seed]
        const [x, y, w, h, bw, bh] = n, mort = C(a[6]), rp = R(a[7]), r = rng(+a[8] || 5), L = rp.length;
        for (let row = 0; row * bh < h; row++) { const off = row % 2 ? Math.floor(bw / 2) : 0;
          for (let col = -1; col * bw < w; col++) { const tone = Math.min(L - 2, Math.max(1, Math.round((L - 1) / 2 + (r() - 0.5) * 2)));
            for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) { const px = x + col * bw + off + i, py = y + row * bh + j; if (px < x || px >= x + w || py >= y + h) continue;
              P(px, py, j === bh - 1 || i === bw - 1 ? mort : j === 0 || i === 0 ? rp[Math.min(L - 1, tone + 1)] : j === bh - 2 ? rp[Math.max(0, tone - 1)] : rp[tone]); } } }
        break; }
      case 'frame': { const [fw, fh, i] = n, cols = Math.floor(img.width / fw); ox = (i % cols) * fw; oy = Math.floor(i / cols) * fh; base = [fw, fh]; break; }
      case 'endframe': ox = oy = 0; base = null; break;
      default: throw new Error(`unknown op "${op}"\n${OPS_HELP}`);
    }
  }
  if (lockPal) { const r = snapToPalette(img, lockPal); img = r.img; img.snapped = r.changed; }
  img.palette = pal;
  return img;
}

// snap every opaque pixel to the nearest palette color. returns {img, changed}
export function snapToPalette(im, cols) {
  const out = cloneImg(im); let changed = 0;
  const P = cols.map(c => (Array.isArray(c) ? c : hex(c)));
  for (let i = 0; i < out.data.length; i += 4) {
    if (!out.data[i + 3]) continue;
    let best = P[0], bd = Infinity;
    for (const c of P) { const d = 2 * (c[0] - out.data[i]) ** 2 + 4 * (c[1] - out.data[i + 1]) ** 2 + 3 * (c[2] - out.data[i + 2]) ** 2; if (d < bd) { bd = d; best = c; } }
    if (bd) { changed++; out.data[i] = best[0]; out.data[i + 1] = best[1]; out.data[i + 2] = best[2]; out.data[i + 3] = 255; }
  }
  return { img: out, changed };
}

// pixel-art shade ramp: darker shades shift hue toward blue/purple, lighter toward yellow (classic hue shifting)
export function ramp(base, n = 5) {
  const [r, g, b] = hex(base), [h, s, l] = rgb2hsl(r, g, b), mid = (n - 1) / 2, out = [];
  const toward = (h0, target, deg) => { let d = ((target - h0 + 540) % 360) - 180; return (h0 + Math.sign(d) * Math.min(Math.abs(d), deg) + 360) % 360; };
  for (let i = 0; i < n; i++) {
    const t = mid ? (i - mid) / mid : 0; // -1 darkest .. +1 lightest
    const hh = t < 0 ? toward(h * 360, 250, -t * 20) : toward(h * 360, 55, t * 14);
    const ll = Math.max(0.05, Math.min(0.95, l + t * (t < 0 ? l * 0.6 : (1 - l) * 0.7)));
    const ss = Math.max(0, Math.min(1, s + (t < 0 ? 0.06 : -0.12) * Math.abs(t)));
    out.push(toHex(...hsl2rgb(hh / 360, ss, ll)));
  }
  return out;
}

// what changed between two frames (or two images): compact text for animation work
export function frameDiff(A, ra, B, rb) {
  const [ax, ay, w, h] = ra, [bx, by] = rb, ch = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((ay + y) * A.width + ax + x) * 4, j = ((by + y) * B.width + bx + x) * 4;
    const ca = A.data.subarray(i, i + 4), cb = B.data.subarray(j, j + 4);
    if (ca[3] === 0 && cb[3] === 0) continue;
    if (ca[0] !== cb[0] || ca[1] !== cb[1] || ca[2] !== cb[2] || ca[3] !== cb[3]) ch.push([x, y, cb[3] ? toHex(cb[0], cb[1], cb[2], cb[3]) : 'transparent']);
  }
  return ch;
}

// onion skin view: frame i with frame i-1 (red tint) and i+1 (blue tint) faintly behind
export function onion(im, fw, fh, i, alpha = 90) {
  const cols = Math.floor(im.width / fw), out = newImg(fw, fh);
  const frameAt = (k) => [(k % cols) * fw, Math.floor(k / cols) * fh];
  const total = cols * Math.floor(im.height / fh);
  for (const [k, tint] of [[i - 1, [255, 80, 80]], [i + 1, [80, 140, 255]]]) {
    if (k < 0 || k >= total) continue;
    const [sx, sy] = frameAt(k);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) { const s = ((sy + y) * im.width + sx + x) * 4; if (im.data[s + 3]) { const o = (y * fw + x) * 4; out.data[o] = tint[0]; out.data[o + 1] = tint[1]; out.data[o + 2] = tint[2]; out.data[o + 3] = alpha; } }
  }
  const [sx, sy] = frameAt(i);
  blit(out, im, sx, sy, fw, fh, 0, 0);
  return out;
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
