// Bake placed furniture (+ wallpaper/floor already applied) into plain map tiles so a Content Patcher mod can ship it:
//  rugs -> Back2, wall items -> Buildings2, furniture bounding-box rows -> Buildings (collision), rows above -> Front,
//  seat "front" sprites -> Front2. Overlaps are composited, identical tiles deduped into one tilesheet PNG.
//  Seats become Data/ChairTiles entries (the vanilla mechanism used by map benches), lamps become Light map properties.
import { GameMap } from '../web/core/map.mjs';
import { layout, drawPos, seats as furnSeats, skinSource, isBed, bedSpot, NATIVE_ACTIONS, SEAT_TYPES, WALL_TYPES } from '../web/core/furniture.mjs';
import { newImg, blit } from '../web/core/raster.mjs';

export function bakeFurniture(map, catalog, getImg, sheetName, { skins, textures, actions = {} } = {}) {
  const tileProps = { Buildings: {}, Back: {} }; // functions kept without the SMAPI bridge: map tile actions + beds
  const cells = new Map(); // "layer|x|y" -> 16x16 img
  const cell = (L, x, y) => { const k = `${L}|${x}|${y}`; if (!cells.has(k)) cells.set(k, newImg(16, 16)); return cells.get(k); };
  const items = (map.furniture || []).map(pl => ({ pl, f: catalog[pl.id] })).filter(o => o.f)
    .map(o => ({ ...o, lay: layout(o.f, o.pl.rot || 0) })).sort((a, b) => (a.f.t === 'rug' ? -1e9 : a.pl.y + a.lay.bh) - (b.f.t === 'rug' ? -1e9 : b.pl.y + b.lay.bh));
  const chairs = [], lights = [];
  const stamp = (tex, lay, pos, layerOf) => {
    const { src, flip } = lay;
    for (let py = 0; py < src.h; py++) for (let px = 0; px < src.w; px++) {
      const sx = src.x + (flip ? src.w - 1 - px : px), si = ((src.y + py) * tex.width + sx) * 4;
      if (!tex.data[si + 3]) continue;
      const wx = pos.x + px, wy = pos.y + py, tx = Math.floor(wx / 16), ty = Math.floor(wy / 16);
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
      const L = layerOf(ty); const c = cell(L, tx, ty); blit(c, { width: 1, height: 1, data: tex.data.subarray(si, si + 4) }, 0, 0, 1, 1, wx - tx * 16, wy - ty * 16);
    }
  };
  for (const { pl, f, lay } of items) {
    let tex = getImg(f.tex);
    const sk = skinSource(f, lay, pl.skin, skins, textures);
    if (sk && getImg(sk.key)) { tex = getImg(sk.key); lay.src = sk.src; }
    if (!tex) continue;
    const pos = drawPos(pl, lay);
    if (f.t === 'rug') stamp(tex, lay, pos, () => 'Back2');
    else if (WALL_TYPES.has(f.t)) stamp(tex, lay, pos, () => 'Buildings2');
    else if (isBed(f)) stamp(tex, lay, pos, (ty) => (ty === pl.y + 1 ? 'Front' : ty >= pl.y && ty < pl.y + lay.bh ? 'Buildings' : 'Front')); // you lie in row 1
    else stamp(tex, lay, pos, (ty) => (ty >= pl.y && ty < pl.y + lay.bh ? 'Buildings' : 'Front'));
    const act = actions[f.id]?.[0] || NATIVE_ACTIONS[f.id];
    if (act) for (let y = 0; y < lay.bh; y++) for (let x = 0; x < lay.bw; x++) tileProps.Buildings[`${pl.x + x},${pl.y + y}`] = { Action: act };
    const z = bedSpot(f, pl);
    if (z) { for (let x = 0; x < lay.bw; x++) tileProps.Back[`${pl.x + x},${pl.y + 1}`] = { Bed: 'T' }; tileProps.Back[`${z.x},${z.y}`] = { Bed: 'T', TouchAction: 'Sleep' }; }
    if (SEAT_TYPES.has(f.t)) {
      const ft = getImg(f.tex + 'Front'); if (ft) stamp(ft, lay, pos, () => 'Front2');
      for (const s of furnSeats(f, pl, lay)) chairs.push({ x: Math.floor(s.x), y: s.y, dir: s.dir, type: f.t === 'chair' ? 'chair' : 'bench' });
    }
    if (f.t === 'lamp' || f.t === 'sconce' || f.t === 'torch') lights.push(`${pl.x} ${pl.y} 4`);
    if (f.t === 'window') lights.push(`${pl.x} ${pl.y + 1} 4`);
  }
  // dedupe tiles into a sheet
  const uniq = [], keyOf = new Map(), place = [];
  for (const [k, img] of cells) {
    const sig = Buffer.from(img.data).toString('base64');
    let i = keyOf.get(sig); if (i === undefined) { i = uniq.length; uniq.push(img); keyOf.set(sig, i); }
    const [L, x, y] = k.split('|'); place.push([L, +x, +y, i]);
  }
  const cols = 16, rows = Math.max(1, Math.ceil(uniq.length / cols)), sheet = newImg(cols * 16, rows * 16);
  uniq.forEach((img, i) => blit(sheet, img, 0, 0, 16, 16, (i % cols) * 16, Math.floor(i / cols) * 16));
  // new map json
  const first = Math.max(...map.sheets.map(s => s.first + s.cols * s.rows));
  const sh = { id: sheetName, img: sheetName, cols, rows, first, tp: {}, missing: true };
  const order = [...map.layerOrder];
  const layers = Object.fromEntries(order.map(id => [id, new Uint16Array(map.layers[id])]));
  const ensure = (L, after) => { if (layers[L]) return; layers[L] = new Uint16Array(map.w * map.h); order.splice(order.indexOf(after) + 1, 0, L); };
  ensure('Back2', 'Back'); ensure('Buildings2', 'Buildings'); ensure('Front2', 'Front');
  for (const [L, x, y, i] of place) layers[L][y * map.w + x] = first + i;
  const chairTiles = {};
  for (const c of chairs) {
    const i = place.find(p => p[0] === 'Buildings' && p[1] === c.x && p[2] === c.y)?.[3];
    if (i === undefined) continue;
    const v = `1/1/${c.dir}/${c.type}/-1/-1/false`, xy = `${i % cols}/${Math.floor(i / cols)}`;
    chairTiles[`${sheetName}/${xy}`] = v; chairTiles[`${sheetName}.png/${xy}`] = v; // SMAPI may keep the extension in ImageSource
  }
  const props = { ...map.props };
  if (lights.length) props.Light = ((props.Light || '') + ' ' + lights.join(' ')).trim();
  const tp = structuredClone(map.tp || {});
  for (const [L, t] of Object.entries(tileProps)) for (const [xy, pr] of Object.entries(t)) (tp[L] ||= {})[xy] = { ...(tp[L]?.[xy] || {}), ...pr };
  const j = { name: map.name, w: map.w, h: map.h, props, sheets: [...map.sheets.map(s => ({ ...s })), sh], anim: map.anim, tp,
    layers: order.map(id => ({ id, vis: true, arr: layers[id] })) };
  return { map: new GameMap(j), sheet, chairTiles, tiles: uniq.length, lights: lights.length };
}
