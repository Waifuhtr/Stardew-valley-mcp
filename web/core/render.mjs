// Software map renderer (Node / headless). The browser uses canvas but follows the same rules.
import { newImg, blit, fillRect, text } from './raster.mjs';
import { layout, drawPos, SEAT_TYPES, skinSource } from './furniture.mjs';

export const SEASONS = ['spring', 'summer', 'fall', 'winter'];

// seasonal tilesheet swap the way the game does it ("spring_" prefix in the image name)
export function seasonImg(img, season, textures) {
  if (!season || season === 'spring') return img;
  const alt = img.replace(/(^|\/)spring_/, `$1${season}_`);
  return alt !== img && (!textures || textures[alt]) ? alt : img;
}

export const isDrawnLayer = (id) => !/^Paths/.test(id);
export const isFrontLayer = (id) => /^(Front|AlwaysFront)/.test(id);

// NPC sprite sheet convention: 16x32 frames, 4 columns; rows down,right,up,left
export const DIRS = { down: 0, right: 1, up: 2, left: 3 };

// opts: {getImg(key)->img, textures, season, region:[x,y,w,h], scale, actors:[{img,x,y,dir,frame}], grid, overlay:'pass', labels, marks:[[x,y,rgba]]}
export function renderMap(map, opts) {
  const [rx, ry, rw, rh] = opts.region || [0, 0, map.w, map.h];
  const S = opts.scale || 1, T = 16 * S;
  const out = newImg(rw * T, rh * T, [0, 0, 0, 255]);
  const cache = new Map();
  const sheetImg = (sh) => {
    const key = seasonImg(sh.img, opts.season, opts.textures);
    if (!cache.has(key)) cache.set(key, opts.getImg(key) || opts.getImg(sh.img));
    return cache.get(key);
  };
  const drawLayer = (id) => {
    const L = map.layers[id];
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
      const g = L[y * map.w + x]; if (!g) continue;
      const s = map.sheetOf(g); if (!s) continue;
      const im = sheetImg(s.sheet); if (!im) continue;
      const cols = Math.floor(im.width / 16) || s.sheet.cols;
      blit(out, im, (s.idx % cols) * 16, Math.floor(s.idx / cols) * 16, 16, 16, (x - rx) * T, (y - ry) * T, S);
    }
  };
  const actorOne = (a) => {
    const fw = a.fw || 16, fh = a.fh || 32, row = DIRS[a.dir || 'down'] ?? 0;
    const cols = Math.floor(a.img.width / fw);
    const fi = row * cols + (a.frame || 0);
    blit(out, a.img, (fi % cols) * fw, Math.floor(fi / cols) * fh, fw, fh,
      Math.round((a.x - rx) * T + (T - fw * S) / 2), Math.round((a.y - ry + 1) * T - fh * S - (a.seated ? 5 * S : 0)), S);
  };
  // furniture (opts.furniture = [{id,x,y,rot}], opts.catalog) y-sorted with actors; seat fronts drawn over sitters
  const drawActors = () => {
    const cat = opts.catalog || {}, objs = [], fronts = [];
    for (const pl of opts.furniture || []) {
      const f = cat[pl.id]; if (!f) continue;
      let lay = layout(f, pl.rot || 0), tex = opts.getImg(f.tex);
      const sk = skinSource(f, lay, pl.skin, opts.skins, opts.textures);
      if (sk && opts.getImg(sk.key)) { tex = opts.getImg(sk.key); lay = { ...lay, src: sk.src }; }
      if (!tex) continue;
      const pos = drawPos(pl, lay), item = { kind: 'f', f, lay, tex, pos, z: f.t === 'rug' ? -1e9 : pl.y + lay.bh };
      objs.push(item);
      if (SEAT_TYPES.has(f.t)) { const ft = opts.getImg(f.tex + 'Front'); if (ft) fronts.push({ ...item, tex: ft }); }
    }
    for (const a of opts.actors || []) objs.push({ kind: 'a', a, z: a.y + 1 + (a.seated ? 0.01 : 0) });
    objs.sort((p, q) => p.z - q.z);
    const drawF = (o) => blit(out, o.tex, o.lay.src.x, o.lay.src.y, o.lay.src.w, o.lay.src.h, Math.round(o.pos.x * S - rx * T), Math.round(o.pos.y * S - ry * T), S, o.lay.flip);
    for (const o of objs) o.kind === 'a' ? actorOne(o.a) : drawF(o);
    if ((opts.actors || []).some(a => a.seated)) for (const o of fronts) drawF(o);
  };
  let actorsDone = false;
  for (const id of map.layerOrder) {
    if (!isDrawnLayer(id) || opts.hideLayers?.includes(id)) continue;
    if (isFrontLayer(id) && !actorsDone) { drawActors(); actorsDone = true; }
    drawLayer(id);
  }
  if (!actorsDone) drawActors();
  // images drawn above every map layer (opts.overlays = [{img, x, y}] in map pixels)
  for (const o of opts.overlays || []) blit(out, o.img, 0, 0, o.img.width, o.img.height, Math.round(o.x * S - rx * T), Math.round(o.y * S - ry * T), S);
  if (opts.overlay === 'pass') {
    const col = { 0: [0, 0, 0, 140], 2: [255, 40, 40, 90], 3: [40, 120, 255, 90], 4: [255, 220, 0, 110] };
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
      const c = map.cell(x, y); if (col[c]) fillRect(out, (x - rx) * T, (y - ry) * T, T, T, col[c]);
    }
    for (const [x, y, , , , k] of map.warps) if (x >= rx && y >= ry && x < rx + rw && y < ry + rh)
      fillRect(out, (x - rx) * T, (y - ry) * T, T, T, k === 'w' ? [0, 255, 120, 140] : [255, 0, 255, 140]);
  }
  for (const [x, y, c] of opts.marks || []) fillRect(out, (x - rx) * T + 2, (y - ry) * T + 2, T - 4, T - 4, c);
  if (opts.grid) {
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      fillRect(out, x * T, y * T, T, 1, [0, 0, 0, 50]); fillRect(out, x * T, y * T, 1, T, [0, 0, 0, 50]);
    }
    const every = opts.labelEvery || (S >= 2 ? 5 : 10);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const gx = x + rx, gy = y + ry;
      if (gx % every === 0 && gy % every === 0) text(out, `${gx},${gy}`, x * T + 1, y * T + 1, [255, 255, 255, 255], Math.max(1, S >> 1));
    }
  }
  return out;
}
