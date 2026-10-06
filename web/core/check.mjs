// Consistency checks for custom / edited maps and footprints. Browser + Node.
import { reachable } from './map.mjs';
import { mapOf, incoming } from './world.mjs';

// loadMap(name) -> GameMap|null for vanilla targets. Returns {errors:[], warnings:[], info:[]}
export function checkMap(map, { index, loadMap, extraLocations = [] } = {}) {
  const E = [], Wn = [], I = [];
  const ids = map.layerOrder;
  for (const req of ['Back', 'Buildings', 'Front']) if (!ids.includes(req)) E.push(`missing layer ${req}`);
  for (const id of ids) if (!/^(Back|Buildings|Front|AlwaysFront|Paths)\d*$/.test(id)) Wn.push(`layer "${id}" is not a game layer name (ignored by the game unless numbered like Back2)`);
  for (const sh of map.sheets) {
    if (sh.missing) Wn.push(`tilesheet "${sh.id}" image "${sh.src || sh.img}" is not vanilla: ship it in your mod (Maps/ folder or assets/) and keep the name`);
    if (/^(summer|fall|winter)_/.test(sh.img.split('/').pop())) Wn.push(`tilesheet ${sh.id} uses ${sh.img}: use the spring_ version, the game swaps seasons automatically`);
  }
  // tile index range
  const maxGid = Math.max(0, ...map.sheets.map(s => s.first + s.cols * s.rows - 1));
  for (const id of ids) {
    let bad = 0; for (const g of map.layers[id]) if (g > maxGid) bad++;
    if (bad) E.push(`layer ${id}: ${bad} tiles reference a tile index outside every tilesheet`);
  }
  // visual holes: something drawn on Buildings/Front without Back below
  let holes = 0;
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++)
    if (!map.gid('Back', x, y) && map.gid('Buildings', x, y)) holes++;
  if (holes) I.push(`${holes} Buildings tiles have no Back tile under (normal for interior walls; make sure those tiles are fully opaque)`);
  // warps
  const known = new Set([...(index ? Object.keys(index.maps) : []), ...extraLocations]);
  for (const [x, y, t, tx, ty, k] of map.warps) {
    const tag = `warp ${x},${y}->${t} ${tx},${ty}`;
    const edge = x < 0 || y < 0 || x >= map.w || y >= map.h;
    if (!edge && k === 'w' && x > 0 && y > 0 && x < map.w - 1 && y < map.h - 1) I.push(`${tag}: warp tile is inside the map (fine for doors/holes, unusual for paths)`);
    const cx = Math.min(Math.max(x, 0), map.w - 1), cy = Math.min(Math.max(y, 0), map.h - 1);
    const srcOk = map.walkable(cx, cy) || [[0, 1], [1, 0], [-1, 0], [0, -1]].some(([dx, dy]) => map.walkable(cx + dx, cy + dy));
    if (!srcOk) { I.push(`${tag}: unreachable (no walkable tile at/next to it)`); continue; }
    const tm = mapOf(t, index?.maps);
    if (!known.has(tm) && !known.has(t)) { Wn.push(`${tag}: target location unknown (custom location? add it via Data/Locations)`); continue; }
    const target = loadMap?.(tm);
    if (target) {
      if (!target.in(tx, ty)) E.push(`${tag}: target tile outside ${tm} (${target.w}x${target.h})`);
      else if (!target.walkable(tx, ty)) E.push(`${tag}: target tile is blocked in ${tm} (cell=${target.cell(tx, ty)})`);
    }
  }
  // connectivity between warp landing spots inside this map
  const spots = map.warps.map(([x, y]) => [Math.min(Math.max(x, 0), map.w - 1), Math.min(Math.max(y, 0), map.h - 1)])
    .map(([x, y]) => nearestWalkable(map, x, y)).filter(Boolean);
  if (spots.length > 1) {
    const r = reachable(map, ...spots[0]);
    const cut = spots.filter(([x, y]) => !r[y * map.w + x]);
    if (cut.length) Wn.push(`warp areas not connected to warp at ${spots[0]}: ${cut.map(s => s.join(',')).join(' ')}`);
  }
  if (index && loadMap) {
    const inc = incoming(index, map.name).filter(([, , , tx, ty]) => !map.in(tx, ty) || !map.walkable(tx, ty)).map(([m, , , tx, ty]) => `${m}->${tx},${ty}`);
    if (inc.length) E.push(`incoming warps land on blocked/outside tiles: ${inc.join(' ')}`);
  }
  I.push(`${map.w}x${map.h}, layers: ${ids.join(',')}, sheets: ${map.sheets.map(s => s.id + '=' + s.img).join(', ')}`);
  return { errors: E, warnings: Wn, info: I };
}

export function nearestWalkable(map, x, y, max = 3) {
  for (let r = 0; r <= max; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++)
    if (Math.abs(dx) + Math.abs(dy) === r && map.walkable(x + dx, y + dy)) return [x + dx, y + dy];
  return null;
}

// Would blocking rect (x,y,w,h) on this map break anything? (placing a building/structure/new area)
export function checkFootprint(map, x, y, w, h, { door } = {}) {
  const counts = { void: 0, floor: 0, blocked: 0, water: 0, door: 0 }, names = ['void', 'floor', 'blocked', 'water', 'door'];
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) counts[names[map.cell(xx, yy)]]++;
  const inside = (px, py) => px >= x && py >= y && px < x + w && py < y + h;
  const warpsIn = map.warps.filter(([px, py]) => inside(px, py));
  const acts = map.actions().filter(([px, py]) => inside(px, py));
  // connectivity before/after
  const spots = map.warps.map(([px, py]) => nearestWalkable(map, Math.min(Math.max(px, 0), map.w - 1), Math.min(Math.max(py, 0), map.h - 1))).filter(Boolean);
  const before = spots.length ? reachable(map, ...spots[0]) : null;
  const saved = map._pass; const g = new Uint8Array(map.passGrid());
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (map.in(xx, yy)) g[yy * map.w + xx] = 0;
  if (door) g[door[1] * map.w + door[0]] = 1;
  map._pass = g;
  const start = spots.find(([px, py]) => !inside(px, py));
  const after = start ? reachable(map, ...start) : null;
  map._pass = saved;
  const lost = [];
  if (before && after) for (const [px, py] of spots) if (before[py * map.w + px] && !after[py * map.w + px] && !inside(px, py)) lost.push(`${px},${py}`);
  let cutTiles = 0;
  if (before && after) for (let i = 0; i < before.length; i++) if (before[i] && !after[i] && !inside(i % map.w, (i / map.w) | 0)) cutTiles++;
  let doorOk = null;
  if (door && after) doorOk = !!after[door[1] * map.w + door[0]] || [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => after[(door[1] + dy) * map.w + door[0] + dx]);
  return { counts, warpsIn, actions: acts, lostWarps: lost, cutTiles, doorReachable: doorOk };
}

// after editing a map: which warp spots / tiles stopped being reachable from the main entrance?
export function connectivityDiff(before, after) {
  const spots = (m) => m.warps.map(([x, y]) => nearestWalkable(m, Math.min(Math.max(x, 0), m.w - 1), Math.min(Math.max(y, 0), m.h - 1))).filter(Boolean);
  const sb = spots(before); if (!sb.length) return { lostWarps: [], lostTiles: 0 };
  const start = sb.find(([x, y]) => after.walkable(x, y)); if (!start) return { lostWarps: sb.map(s => s.join(',')), lostTiles: 0 };
  const rb = reachable(before, ...start), ra = reachable(after, ...start);
  const lostWarps = sb.filter(([x, y]) => rb[y * before.w + x] && !ra[y * after.w + x]).map(s => s.join(','));
  let lostTiles = 0; for (let i = 0; i < rb.length; i++) if (rb[i] && !ra[i] && after.passGrid()[i]) lostTiles++;
  return { lostWarps: [...new Set(lostWarps)], lostTiles };
}
