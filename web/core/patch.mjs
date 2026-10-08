// Content Patcher style EditMap: overlay a patch map onto a target at (x,y). Browser + Node.
import { GameMap } from './map.mjs';

// diff two check results -> only problems introduced by the patch
export const newProblems = (before, after) => ({ errors: after.errors.filter(e => !before.errors.includes(e)), warnings: after.warnings.filter(e => !before.warnings.includes(e)), info: [] });

// Content Patcher EditMap PatchMode semantics:
//  'Overlay'        only non-empty patch tiles replace target tiles
//  'ReplaceByLayer' (CP default) every tile of the area is replaced on layers the patch has — empty patch tiles CLEAR the target
//  'Replace'        like ReplaceByLayer, and layers missing from the patch are cleared in the area too
export function applyPatch(target, patch, x, y, mode = 'ReplaceByLayer') {
  const j = { name: target.name, w: target.w, h: target.h, props: { ...target.props }, sheets: target.sheets.map(s => ({ ...s })), anim: structuredClone(target.anim), tp: structuredClone(target.tp) };
  // merge tilesheets by image (CP adds missing ones with a z_ prefix)
  let next = Math.max(...j.sheets.map(s => s.first + s.cols * s.rows));
  const remap = new Map(); // patch sheet -> target sheet
  for (const ps of patch.sheets) {
    let t = j.sheets.find(s => s.img === ps.img);
    if (!t) { t = { ...ps, id: 'z_' + ps.id, first: next }; next += ps.cols * ps.rows; j.sheets.push(t); }
    remap.set(ps, t);
  }
  const conv = (g) => { const s = patch.sheetOf(g); if (!s) return 0; const t = remap.get(s.sheet); return t.first + s.idx; };
  const layers = Object.fromEntries(target.layerOrder.map(id => [id, new Uint16Array(target.layers[id])]));
  const order = [...target.layerOrder];
  for (const id of patch.layerOrder) {
    if (!layers[id]) { layers[id] = new Uint16Array(target.w * target.h); order.push(id); }
    const src = patch.layers[id], dst = layers[id];
    for (let py = 0; py < patch.h; py++) for (let px = 0; px < patch.w; px++) {
      const tx = x + px, ty = y + py; if (tx < 0 || ty < 0 || tx >= target.w || ty >= target.h) continue;
      const g = src[py * patch.w + px], k = `${tx},${ty}`;
      if (!g && mode === 'Overlay') continue;
      dst[ty * target.w + tx] = conv(g);
      if (j.anim[id]) delete j.anim[id][k];
      if (j.tp[id]) delete j.tp[id][k];
      const a = patch.anim[id]?.[`${px},${py}`]; if (a) (j.anim[id] ||= {})[k] = [a[0], a[1].map(conv)];
    }
  }
  if (mode === 'Replace') for (const id of order) if (!patch.layers[id]) for (let py = 0; py < patch.h; py++) for (let px = 0; px < patch.w; px++) {
    const tx = x + px, ty = y + py; if (tx < 0 || ty < 0 || tx >= target.w || ty >= target.h) continue; layers[id][ty * target.w + tx] = 0;
  }
  for (const [id, t] of Object.entries(patch.tp)) for (const [xy, p] of Object.entries(t)) {
    const [px, py] = xy.split(',').map(Number); (j.tp[id] ||= {})[`${px + x},${py + y}`] = p;
  }
  // map properties of the patch are not merged (CP only edits them via MapProperties / AddWarps)
  j.layers = order.map(id => ({ id, vis: true, arr: layers[id] }));
  return new GameMap(j);
}

// wallpaper / flooring like DecoratableLocation: wall strips (3 tiles) over each floor column, 2x2 floor pattern.
// decor = {wallpaper:{tex,n,startRow}, floor:{tex,n,startRow}} (see furniture.resolveDecor); textures = index.textures
import { wallTiles, wallpaperTile, floorTile } from './furniture.mjs';
export function applyDecor(map, decor, textures = {}, area = null) {
  const inA = (x, y) => !area || (x >= area[0] && y >= area[1] && x < area[0] + area[2] && y < area[1] + area[3]);
  const j = { name: map.name, w: map.w, h: map.h, props: { ...map.props }, sheets: map.sheets.map(s => ({ ...s })), anim: map.anim, tp: map.tp };
  const layers = Object.fromEntries(map.layerOrder.map(id => [id, new Uint16Array(map.layers[id])]));
  const sheetFor = (tex) => {
    let s = j.sheets.find(x => x.img === tex);
    if (!s) { const [w, h] = textures[tex] || [256, 688]; const first = Math.max(...j.sheets.map(x => x.first + x.cols * x.rows)); s = { id: 'z_' + tex.replace(/^thirdparty\//, '').replace(/[^\w.-]+/g, '_'), img: tex, cols: w / 16, rows: h / 16, first, tp: {} }; j.sheets.push(s); }
    return s;
  };
  let walls = 0, floors = 0;
  if (decor.wallpaper) {
    const s = sheetFor(decor.wallpaper.tex), W = s.cols * 16;
    for (const t of wallTiles(map)) { if (!inA(t.x, t.y)) continue; layers.Buildings[t.y * map.w + t.x] = s.first + wallpaperTile(decor.wallpaper.n, t.part, W); walls++; }
  }
  if (decor.floor) {
    const s = sheetFor(decor.floor.tex), W = s.cols * 16;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (!inA(x, y) || !map.baseWalkable(x, y) || !map.gid('Back', x, y) || map.gid('Buildings', x, y)) continue;
      layers.Back[y * map.w + x] = s.first + floorTile(decor.floor.n, x % 2, y % 2, W, decor.floor.startRow); floors++;
    }
  }
  j.layers = map.layerOrder.map(id => ({ id, vis: true, arr: layers[id] }));
  const out = new GameMap(j); out.decorStats = { walls, floors };
  return out;
}

// World states the game applies in code (not via map files). Applied when a loaded mod lists them in "states".
export const WORLD_STATES = {
  // Beach.fixBridge(): planks on 58-61,13 (Back 301) and the broken ends removed — east beach becomes reachable
  beachBridgeFixed: { map: 'Beach', sheet: 'untitled tile sheet', edits: [['Back', 58, 13, 301], ['Back', 59, 13, 301], ['Back', 60, 13, 301], ['Back', 61, 13, 301], ['Buildings', 58, 13, null], ['Buildings', 61, 13, null]] },
};
export function applyStates(map, states = []) {
  const todo = states.map(s => WORLD_STATES[s]).filter(s => s && s.map === map.name);
  if (!todo.length) return map;
  const layers = Object.fromEntries(map.layerOrder.map(id => [id, new Uint16Array(map.layers[id])]));
  const tp = structuredClone(map.tp);
  for (const st of todo) {
    const sh = map.sheets.find(s => s.id === st.sheet) || map.sheets[0];
    for (const [L, x, y, idx] of st.edits) { layers[L][y * map.w + x] = idx == null ? 0 : sh.first + idx; if (tp[L]) delete tp[L][`${x},${y}`]; }
  }
  return new GameMap({ name: map.name, w: map.w, h: map.h, props: map.props, sheets: map.sheets, anim: map.anim, tp, layers: map.layerOrder.map(id => ({ id, vis: true, arr: layers[id] })) });
}
