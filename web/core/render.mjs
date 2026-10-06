// Software map renderer (Node / headless). The browser uses canvas but follows the same rules.
import { newImg, blit, fillRect, text } from './raster.mjs';

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
  const drawActors = () => {
    for (const a of opts.actors || []) {
      const fw = a.fw || 16, fh = a.fh || 32, row = DIRS[a.dir || 'down'] ?? 0;
      const cols = Math.floor(a.img.width / fw);
      const fi = row * cols + (a.frame || 0);
      blit(out, a.img, (fi % cols) * fw, Math.floor(fi / cols) * fh, fw, fh,
        (a.x - rx) * T + (T - fw * S) / 2, (a.y - ry + 1) * T - fh * S, S);
    }
  };
  let actorsDone = false;
  for (const id of map.layerOrder) {
    if (!isDrawnLayer(id) || opts.hideLayers?.includes(id)) continue;
    if (isFrontLayer(id) && !actorsDone) { drawActors(); actorsDone = true; }
    drawLayer(id);
  }
  if (!actorsDone) drawActors();
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
