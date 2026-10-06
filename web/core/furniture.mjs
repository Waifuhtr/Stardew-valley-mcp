// Furniture, seats, wallpaper/flooring — rules mirrored from the game (Furniture.updateRotation, GetSeatPositions,
// GetSittingDirection, isPassable, Data/ChairTiles). Browser + Node. Coordinates in tiles unless noted.

export const TYPES = ['chair', 'bench', 'couch', 'armchair', 'dresser', 'long table', 'painting', 'lamp', 'decor', 'other',
  'bookcase', 'table', 'rug', 'window', 'fireplace', 'bed', 'torch', 'sconce'];
const DEF_SPRITE = { chair: [1, 2], bench: [2, 2], couch: [3, 2], armchair: [2, 2], dresser: [2, 2], 'long table': [5, 3], painting: [2, 2],
  lamp: [1, 3], decor: [1, 2], bookcase: [2, 3], table: [2, 3], rug: [3, 2], window: [1, 2], fireplace: [2, 5], torch: [1, 2], sconce: [1, 2] };
const DEF_BOX = { chair: [1, 1], bench: [2, 1], couch: [3, 1], armchair: [2, 1], dresser: [2, 1], 'long table': [5, 2], painting: [2, 2],
  lamp: [1, 1], decor: [1, 1], bookcase: [2, 1], table: [2, 1], rug: [3, 2], window: [1, 2], fireplace: [2, 1], torch: [1, 1], sconce: [1, 1] };
const ROT_OFF = { couch: [-1, 1], armchair: [-1, 1], 'long table': [-1, 0] };
export const SEAT_TYPES = new Set(['chair', 'bench', 'couch', 'armchair']);
export const WALL_TYPES = new Set(['painting', 'window', 'sconce']);
export const DIR_NAMES = ['up', 'right', 'down', 'left'];

// Data/Furniture line -> catalog entry
export function parseFurniture(id, line, names = {}, namesTr = {}) {
  const p = line.split('/');
  const type = p[1];
  const size = (s, def) => (s && s !== '-1' ? s.split(' ').map(Number) : def || [1, 2]);
  const key = /Strings\\+Furniture:(\w+)/.exec(p[7] || '')?.[1];
  const tex = (p[9] || 'TileSheets\\furniture').replace(/\\+/g, '/');
  const sprite = p[8] !== undefined && p[8] !== '' ? +p[8] : +id;
  return { id, n: (key && names[key]) || p[0], tr: key && namesTr[key] || undefined, t: type, s: size(p[2], DEF_SPRITE[type]), b: size(p[3], DEF_BOX[type] || [1, 1]),
    r: +p[4] || 1, p: +p[5] || 0, pr: +p[6], tex, i: isNaN(sprite) ? 0 : sprite, off: p[10] === 'true' || undefined };
}

// sprite rect (px) + bounding box (tiles) + flip for a rotation — same math as Furniture.updateRotation
export function layout(f, rot = 0, texW = 512) {
  const cols = Math.floor(texW / 16);
  const d = { x: (f.i % cols) * 16, y: Math.floor(f.i / cols) * 16, w: f.s[0] * 16, h: f.s[1] * 16 };
  let [bw, bh] = f.b; rot = ((rot % 4) + 4) % 4;
  if (f.r === 1) rot = 0;
  if (f.r === 2 && rot === 3) rot = 1;
  const twoSize = f.t === 'long table' || f.t === 'rug' || f.id === '724' || f.id === '727';
  if (twoSize && rot === 2) rot = 1;
  const rotateRect = bw !== bh;
  const [ox, oy] = ROT_OFF[f.t] || [0, 0];
  const ss = f.t === 'rug' ? [1, -1] : [0, 0];
  let src = { ...d }, flip = false;
  if (rot) {
    if (rotateRect) {
      if (rot === 1 || rot === 3) [bw, bh] = [bh + oy, bw + ox];
      if (rot === 1 || rot === 3) src = { x: d.x + d.w, y: d.y, w: d.h - 16 + oy * 16 + ss[0] * 16, h: d.w + 16 + ox * 16 + ss[1] * 16 };
      if (rot === 2) src = { x: d.x + d.w + d.h - 16 + oy * 16 + ss[0] * 16, y: d.y, w: d.w, h: d.h };
      flip = rot === 3;
    } else {
      flip = rot === 3;
      const k = f.r === 2 ? (rot === 2 ? 1 : 0) : rot === 3 ? 1 : rot;
      src = { x: d.x + k * d.w, y: d.y, w: d.w, h: d.h };
    }
  }
  return { rot, src, flip, bw, bh };
}

// where a placed piece is drawn (px, top-left) — sprite bottom sits on the bounding box bottom
export const drawPos = (pl, lay) => ({ x: pl.x * 16, y: (pl.y + lay.bh) * 16 - lay.src.h });

// seats [{x,y,dir}] (x/y may be .5 for couches) — Furniture.GetSeatPositions + GetSittingDirection
export function seats(f, pl, lay) {
  if (!SEAT_TYPES.has(f.t)) return [];
  const dir = ['down', 'right', 'up', 'left'][lay.rot];
  const out = [], X = pl.x, Y = pl.y;
  if (f.t === 'chair') out.push([X, Y]);
  else if (f.t === 'bench') { for (let x = 0; x < lay.bw; x++) for (let y = 0; y < lay.bh; y++) out.push([X + x, Y + y]); }
  else if (f.t === 'couch') {
    const w = f.b[0] - 1;
    if (lay.rot === 0 || lay.rot === 2) for (let i = 0; i < w; i++) out.push([X + i + 0.5, Y]);
    else for (let j = 0; j < w; j++) out.push([X + (lay.rot === 1 ? 1 : 0), Y + j]);
  } else if (f.t === 'armchair') out.push(lay.rot === 0 || lay.rot === 2 ? [X + 0.5, Y] : [X + (lay.rot === 1 ? 1 : 0), Y]);
  return out.map(([x, y]) => ({ x, y, dir, stool: /Stool/.test(f.n) || undefined }));
}

// Data/ChairTiles: "sheet/x/y" -> "w/h/dir/type/drawX/drawY/seasonal" ; returns seats found in a map
export function mapChairSeats(map, chairTiles) {
  const out = [];
  if (!chairTiles) return out;
  for (const L of map.layerOrder.filter(l => /^Buildings/.test(l))) {
    const arr = map.layers[L];
    for (let i = 0; i < arr.length; i++) {
      const g = arr[i]; if (!g) continue;
      const s = map.sheetOf(g); if (!s) continue;
      const base = s.sheet.img.split('/').pop().replace(/^(summer|fall|winter)_/, 'spring_');
      const cols = s.sheet.cols, tx = s.idx % cols, ty = Math.floor(s.idx / cols);
      const v = chairTiles[`${base}/${tx}/${ty}`]; if (!v) continue;
      const [w, h, dir, type] = v.split('/');
      const x = i % map.w, y = Math.floor(i / map.w);
      for (let a = 0; a < +w; a++) for (let b = 0; b < +h; b++) out.push({ x: x + a, y: y + b, dir, type, map: true });
    }
  }
  return out;
}

// wall rows of an interior: for every floor tile with a non-floor tile above, the 3 tiles above are wall
export function wallTiles(map) {
  const set = new Set();
  for (let y = 1; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (!map.walkable(x, y) || map.walkable(x, y - 1)) continue;
    for (let k = 1; k <= 3 && y - k >= 0; k++) { if (map.walkable(x, y - k) || !map.gid('Buildings', x, y - k)) break; set.add(`${x},${y - k}:${3 - k}`); }
  }
  return [...set].map(s => { const [xy, part] = s.split(':'); const [x, y] = xy.split(',').map(Number); return { x, y, part: +part }; });
}

// placement check: returns {ok, errors[], warnings[], tiles[[x,y]]}
export function canPlace(map, f, pl, { placed = [], catalog } = {}) {
  const lay = layout(f, pl.rot || 0), E = [], W = [];
  const tiles = []; for (let y = 0; y < lay.bh; y++) for (let x = 0; x < lay.bw; x++) tiles.push([pl.x + x, pl.y + y]);
  const outdoors = !!map.props.Outdoors;
  const pr = f.pr === -1 || isNaN(f.pr) ? (f.t === 'torch' ? 2 : 0) : f.pr;
  if (pr === 0 && outdoors) E.push('indoor-only furniture on an outdoor map');
  if (pr === 1 && !outdoors) E.push('outdoor-only furniture on an indoor map');
  const wall = WALL_TYPES.has(f.t);
  if (wall) {
    const walls = new Set(wallTiles(map).map(t => t.x + ',' + t.y));
    const bad = tiles.filter(([x, y]) => !walls.has(x + ',' + y));
    if (bad.length) E.push(`wall item must be fully on wall tiles (not wall: ${bad.map(t => t.join(',')).join(' ')})`);
  } else {
    const bad = tiles.filter(([x, y]) => !map.in(x, y) || !map.baseWalkable(x, y));
    if (bad.length) E.push(`not on free floor: ${bad.map(t => t.join(',') + '=' + ['void', 'floor', 'blocked', 'water', 'door'][map.cell(...t)]).join(' ')}`);
    const warps = map.warps.filter(([x, y]) => tiles.some(t => t[0] === x && t[1] === y));
    if (warps.length) E.push('covers a warp/door tile');
  }
  for (const o of placed) {
    if (o === pl) continue;
    const of = catalog?.[o.id]; if (!of) continue;
    const ol = layout(of, o.rot || 0);
    if (WALL_TYPES.has(of.t) !== wall) continue;
    if (of.t === 'rug' && f.t !== 'rug') continue;
    if (f.t === 'rug' && of.t !== 'rug') continue;
    const hit = tiles.some(([x, y]) => x >= o.x && y >= o.y && x < o.x + ol.bw && y < o.y + ol.bh);
    if (hit) E.push(`overlaps ${of.n} at ${o.x},${o.y}`);
  }
  return { ok: !E.length, errors: E, warnings: W, tiles, lay };
}

// blocked tiles added by furniture (rugs and wall items don't block)
export function furnitureBlocks(placed, catalog) {
  const s = new Set();
  for (const p of placed) {
    const f = catalog[p.id]; if (!f || f.t === 'rug' || WALL_TYPES.has(f.t)) continue;
    const l = layout(f, p.rot || 0);
    for (let y = 0; y < l.bh; y++) for (let x = 0; x < l.bw; x++) s.add(`${p.x + x},${p.y + y}`);
  }
  return s;
}

// wallpaper / flooring tile indices (16 px tiles) inside their textures
// wallpapers: 16x48 strips, 16 per row; floors: 32x32 squares, 8 per row (walls_and_floors floors start at y=336)
export function wallpaperTile(n, part, texW = 256) { const per = texW / 16; return (Math.floor(n / per) * 3 + part) * per + (n % per); }
export function floorTile(n, dx, dy, texW = 256, startRow = 21) { const per = texW / 32, cols = texW / 16; return (startRow + Math.floor(n / per) * 2 + dy) * cols + (n % per) * 2 + dx; }
// "12" -> vanilla walls_and_floors ; "MoreWalls:3" -> Maps/wallpapers_2
export function resolveDecor(spec, kind, extra = []) {
  const [set, num] = String(spec).includes(':') ? String(spec).split(':') : [null, spec];
  if (!set) return { tex: 'Maps/walls_and_floors', n: +num, startRow: 21 };
  const e = extra.find(x => x.Id === set);
  if (!e) throw new Error(`unknown set ${set}`);
  if (e.IsFlooring !== (kind === 'floor')) throw new Error(`${set} is not a ${kind} set`);
  return { tex: e.Texture, n: +num, startRow: 0, max: e.Count };
}
