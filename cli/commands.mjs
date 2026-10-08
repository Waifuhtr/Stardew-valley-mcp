// Shared command layer for the `sdv` / `px` CLIs and the MCP server. Every command returns
// {text, image?:{path,png(Buffer)}} and keeps text output small (token budget matters).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readPNG, writePNG, encodePNG } from '../lib/png.mjs';
import { GameMap, findPath, pathToMoves, pathToWarp } from '../web/core/map.mjs';
import { applyPatch, newProblems, applyDecor, applyStates, WORLD_STATES } from '../web/core/patch.mjs';
import { bakeFurniture } from './bake.mjs';
import { layout, seats as furnSeats, mapChairSeats, canPlace, furnitureBlocks, resolveDecor, wallTiles, skinsFor, bedSpot, NATIVE_ACTIONS, SEAT_TYPES, WALL_TYPES } from '../web/core/furniture.mjs';
import { asciiMap, LEGEND } from '../web/core/ascii.mjs';
import { route, incoming, mapOf, isVariant, mapWarps } from '../web/core/world.mjs';
import { renderMap, SEASONS, seasonImg } from '../web/core/render.mjs';
import { tmxToJson, mapToTmx } from '../web/core/tmx.mjs';
import { checkMap, checkFootprint, nearestWalkable, connectivityDiff } from '../web/core/check.mjs';
import { parsePxt, toPxt, toLayeredPxt, flatten, applyOps, palette, checkSprite, SPECS, OPS_HELP, strip, snapToPalette, ramp, frameDiff, onion } from '../web/core/pixel.mjs';
import { newImg, blit, text as drawText, fillRect } from '../web/core/raster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = process.env.SDV_DATA || path.join(ROOT, 'web/data');
let INDEX = null;
const mapCache = new Map(), imgCache = new Map();
// mods in web/data/mods (new locations + EditMap patches) are applied on top of vanilla; SDV_VANILLA=1 disables
const MODS = { locs: {}, patches: {}, furniture: {}, decor: {}, states: [] };
let FURN = null;
export function furnData() {
  if (FURN) return FURN;
  FURN = fs.existsSync(path.join(DATA, 'furniture.json')) ? JSON.parse(fs.readFileSync(path.join(DATA, 'furniture.json'), 'utf8')) : { items: {}, chairTiles: {}, wallpaper: [], flooring: [] };
  // third-party content packs imported with tools/import-mods.mjs (local only); SDV_VANILLA=1 skips them
  const tp = path.join(DATA, 'thirdparty/furniture.json');
  if (!process.env.SDV_VANILLA && !process.env.SDV_NO_THIRDPARTY && fs.existsSync(tp)) {
    const t = JSON.parse(fs.readFileSync(tp, 'utf8'));
    Object.assign(FURN.items, t.items); FURN.wallpaper.push(...t.wallpaper); FURN.flooring.push(...t.flooring);
    Object.assign(FURN, { actions: t.actions, props: t.props, skins: t.skins, mods: t.mods, buildings: t.buildings, overrides: t.overrides, machines: t.machines }); Object.assign(index().textures, t.textures);
  }
  FURN.actions = { ...(FURN.actions || {}), ...(index() && MODS.actions || {}) };
  return FURN;
}
function index() {
  if (INDEX) return INDEX;
  INDEX = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
  INDEX.textures['stardewsim/room_kit'] = [128, 96];
  const list = path.join(DATA, 'mods/index.json');
  if (!process.env.SDV_VANILLA && fs.existsSync(list)) {
    for (const id of JSON.parse(fs.readFileSync(list, 'utf8'))) {
      const m = JSON.parse(fs.readFileSync(path.join(DATA, 'mods', id, 'mod.json'), 'utf8'));
      Object.assign(INDEX.textures, m.images || {});
      for (const [n, f] of Object.entries(m.locations || {})) {
        const j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
        MODS.locs[n] = j; INDEX.maps[n] = { w: j.w, h: j.h, out: j.props.Outdoors ? 1 : 0, warps: mapWarps(j), mod: id };
      }
      for (const p of m.patches || []) (MODS.patches[p.target] ||= []).push({ ...p, mod: id });
      for (const [mp, list] of Object.entries(m.furniture || {})) for (const f of list) (MODS.furniture[mp] ||= []).push({ ...f, mod: id });
      for (const [mp, d] of Object.entries(m.decor || {})) MODS.decor[mp] = Array.isArray(d) ? d : { ...d, mod: id };
      for (const st of m.states || []) if (!MODS.states.includes(st)) MODS.states.push(st);
      for (const [k, v] of Object.entries(m.actions || {})) (MODS.actions ||= {})[k] = v;
    }
    for (const t of new Set([...Object.keys(MODS.patches), ...MODS.states.map(s => WORLD_STATES[s]?.map).filter(Boolean)])) { const mm = loadMap(t); INDEX.maps[t].warps = mm.warps; INDEX.maps[t].mod = (MODS.patches[t] || []).map(p => p.mod).join(',') || INDEX.maps[t].mod; }
  }
  return INDEX;
}

export function loadMap(name) {
  if (!name) throw new Error('map name required (try: sdv maps)');
  if (/\.(tmx|json)$/i.test(name)) throw new Error('use await loadAnyMap for files');
  const n = mapOf(name, index().maps);
  if (!index().maps[n]) {
    const low = n.toLowerCase(), hit = Object.keys(index().maps).find(k => k.toLowerCase() === low);
    if (!hit) throw new Error(`unknown map "${name}". Close: ${Object.keys(index().maps).filter(k => k.toLowerCase().includes(low.slice(0, 4))).slice(0, 8).join(' ')}`);
    return loadMap(hit);
  }
  if (!mapCache.has(n)) {
    let m = new GameMap(MODS.locs[n] || JSON.parse(fs.readFileSync(path.join(DATA, 'maps', n + '.json'), 'utf8')));
    m = applyStates(m, MODS.states);
    for (const p of MODS.patches[n] || []) m = applyPatch(m, new GameMap(JSON.parse(fs.readFileSync(path.join(DATA, p.file), 'utf8'))), p.x, p.y, p.mode || 'ReplaceByLayer');
    if (MODS.decor[n]) m = decorMap(m, MODS.decor[n]);
    setFurn(m, MODS.furniture[n] || []);
    mapCache.set(n, m);
  }
  return mapCache.get(n);
}
// decor = {wallpaper, floor} for the whole map, or a list of {area:[x,y,w,h], wallpaper, floor} (one per room)
function decorMap(m, d) {
  const fd = furnData(); let out = m, walls = 0, floors = 0;
  const warnings = [];
  for (const e of Array.isArray(d) ? d : [d]) {
    const res = (spec, kind, sets) => { if (spec == null) return null; try { return resolveDecor(spec, kind, sets); } catch (err) { warnings.push(`${kind} ${spec}: ${err.message} (pack not imported?)`); return null; } };
    out = applyDecor(out, { wallpaper: res(e.wallpaper, 'wallpaper', fd.wallpaper), floor: res(e.floor, 'floor', fd.flooring) }, index().textures, e.area || null);
    walls += out.decorStats.walls; floors += out.decorStats.floors;
  }
  out.decorStats = { walls, floors }; out.decorWarnings = warnings;
  return out;
}
function setFurn(m, list) { const cat = furnData().items; m.setFurniture(list, cat, furnitureBlocks(list, cat)); }
// user edits persist in web/data/mods/<mod>/mod.json (default mod "user") so CLI, MCP and web share them
function editMod(id, fn) {
  const dir = path.join(DATA, 'mods', id), f = path.join(dir, 'mod.json'), list = path.join(DATA, 'mods/index.json');
  fs.mkdirSync(dir, { recursive: true });
  const m = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { id, title: id };
  fn(m); fs.writeFileSync(f, JSON.stringify(m, null, 1));
  const ids = fs.existsSync(list) ? JSON.parse(fs.readFileSync(list, 'utf8')) : [];
  if (!ids.includes(id)) fs.writeFileSync(list, JSON.stringify([...ids, id]));
  INDEX = null; mapCache.clear(); for (const k of Object.keys(MODS)) MODS[k] = k === 'states' ? [] : {}; FURN = null;
}
export function bakeLocation(name, sheetName) {
  const m = loadMap(name), sn = sheetName || 'z_' + m.name.replace(/\W/g, '_').toLowerCase() + '_furniture';
  return { ...bakeFurniture(m, furnData().items, getImg, sn, { skins: furnData().skins, textures: index().textures, actions: furnData().actions || {} }), sheetName: sn };
}
// how much of a --place image is actually visible: inside the region and not hidden by Front/AlwaysFront tiles
function placeReport(m, pl, [rx, ry, rw, rh], season) {
  const { im, left, topY } = pl, X0 = rx * 16, Y0 = ry * 16, X1 = (rx + rw) * 16, Y1 = (ry + rh) * 16;
  const fronts = m.layerOrder.filter(id => /^(Front|AlwaysFront)/.test(id));
  let total = 0, inside = 0, covered = 0;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    if (!im.data[(y * im.width + x) * 4 + 3]) continue; total++;
    const wx = Math.round(left) + x, wy = Math.round(topY) + y;
    if (wx < X0 || wy < Y0 || wx >= X1 || wy >= Y1) continue; inside++;
    if (pl.top) continue;
    const tx = Math.floor(wx / 16), ty = Math.floor(wy / 16);
    for (const L of fronts) {
      const g = m.gid(L, tx, ty); if (!g) continue; const s = m.sheetOf(g); if (!s) continue;
      const t = getImg(seasonImg(s.sheet.img, season, index().textures)) || getImg(s.sheet.img); if (!t) continue;
      const cols = Math.floor(t.width / 16), sx = (s.idx % cols) * 16 + (wx - tx * 16), sy = Math.floor(s.idx / cols) * 16 + (wy - ty * 16);
      if (t.data[(sy * t.width + sx) * 4 + 3] > 128) { covered++; break; }
    }
  }
  const pct = (a) => total ? Math.round(a * 100 / total) + '%' : '0%';
  const rect = `px ${Math.round(left)},${Math.round(topY)} ${im.width}x${im.height} (tiles ${(left / 16).toFixed(2)},${(topY / 16).toFixed(2)}..${((left + im.width) / 16).toFixed(2)},${((topY + im.height) / 16).toFixed(2)})`;
  const warn = !total ? 'W image is fully transparent' : !inside ? 'W NOTHING VISIBLE: the image lies outside the rendered region' : inside < total * 0.25 ? 'W mostly outside the region' : covered > inside * 0.5 ? 'W mostly hidden behind Front layers (add @top to draw above)' : '';
  return `place ${pl.spec}${pl.top ? ' @top' : ''}: ${rect}; visible ${pct(inside - covered)} (in region ${pct(inside)}, behind Front ${pct(covered)})${warn ? '\n' + warn : ''}`;
}
const fname = (f) => f.tr ? `${f.tr} / ${f.n}` : f.n;
const fline = (f) => `${f.id} ${fname(f)} | ${f.t} ${f.s.join('x')} box ${f.b.join('x')} r${f.r} ${f.p}g${f.mod ? ' [' + f.mod + ']' : f.tex !== 'TileSheets/furniture' ? ' ' + f.tex.split('/').pop() : ''}${furnData().actions?.[f.id] ? ' act:' + furnData().actions[f.id].join(',') : ''}${skinsFor(f, furnData().skins).length ? ' skins:' + skinsFor(f, furnData().skins).length : ''}`;
function findFurn(q) {
  const items = furnData().items; if (items[q]) return items[q];
  const l = String(q).toLowerCase(), hit = Object.values(items).find(f => f.n.toLowerCase() === l || (f.tr || '').toLowerCase() === l);
  if (!hit) throw new Error(`unknown furniture "${q}" (try: sdv furni find ${q})`);
  return hit;
}
function allSeats(m) {
  const cat = furnData().items, out = mapChairSeats(m, furnData().chairTiles).map(s => ({ ...s, name: 'map ' + s.type }));
  for (const pl of m.furniture || []) { const f = cat[pl.id]; if (f) for (const s of furnSeats(f, pl, layout(f, pl.rot || 0))) out.push({ ...s, name: fname(f), at: `${pl.x},${pl.y}` }); }
  return out;
}

const inflate = async (b, kind) => new Uint8Array(kind === 'gzip' ? zlib.gunzipSync(b) : zlib.inflateSync(b));
async function loadAnyMap(spec) {
  if (/\.tmx$/i.test(spec)) {
    const { json, warnings } = await tmxToJson(fs.readFileSync(spec, 'utf8'), { name: path.basename(spec, '.tmx'), textures: index().textures, inflate });
    const m = new GameMap(json); m.loadWarnings = warnings; m.file = spec; return m;
  }
  if (/\.json$/i.test(spec)) return new GameMap(JSON.parse(fs.readFileSync(spec, 'utf8')));
  return loadMap(spec);
}
// texture replacements from imported packs (e.g. Hojichas replaces Maps/walls_and_floors) — the game shows those everywhere
function getImg(key0) {
  const key = (!process.env.SDV_VANILLA && furnData().overrides?.[key0]) || key0;
  if (imgCache.has(key)) return imgCache.get(key);
  let im = null;
  const f = path.join(DATA, 'img', key + '.png');
  if (fs.existsSync(f)) im = readPNG(f);
  imgCache.set(key, im);
  return im;
}
const loadImgFile = (f) => (/^[\w/ -]+$/.test(f) && !fs.existsSync(f) && getImg(f)) || readPNG(f);

// ---- arg parsing --------------------------------------------------------
export function tokenize(s) { return (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(t => t.replace(/^(["'])(.*)\1$/, '$2')); }
function parseArgs(argv) {
  const pos = [], fl = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); if (v !== undefined) fl[k] = v; else if (argv[i + 1] !== undefined && (!argv[i + 1].startsWith('-') || /^-\d/.test(argv[i + 1]))) fl[k] = argv[++i]; else fl[k] = true; }
    else if (a === '-o') fl.o = argv[++i];
    else pos.push(a);
  }
  return { pos, fl };
}
const nums = (s) => String(s).split(/[ ,x]+/).map(Number);
const fmtW = ([x, y, t, tx, ty, k]) => `${k === 'w' ? 'edge' : k === 't' ? 'touch' : 'door'} ${x},${y}>${t} ${tx},${ty}`;

function groupWarps(ws) { // collapse runs of edge warps
  const out = [];
  for (const w of [...ws].sort((a, b) => (a[2] + a[5]).localeCompare(b[2] + b[5]) || a[0] - b[0] || a[1] - b[1])) {
    const l = out[out.length - 1];
    if (l && l.t === w[2] && l.k === w[5] && ((l.x0 === w[0] && l.x1 === w[0] && w[1] === l.y1 + 1) || (l.y0 === w[1] && l.y1 === w[1] && w[0] === l.x1 + 1))) { l.x1 = w[0]; l.y1 = w[1]; continue; }
    out.push({ x0: w[0], y0: w[1], x1: w[0], y1: w[1], t: w[2], tx: w[3], ty: w[4], k: w[5] });
  }
  return out.map(g => `${g.k === 'w' ? 'edge' : g.k === 't' ? 'touch' : 'door'} ${g.x0 === g.x1 ? g.x0 : g.x0 + '..' + g.x1},${g.y0 === g.y1 ? g.y0 : g.y0 + '..' + g.y1}>${g.t} ${g.tx},${g.ty}`);
}

// ---- sdv ----------------------------------------------------------------
export const SDV_HELP = `sdv <cmd> ... (coords are tiles; 1 tile=16px)
maps [filter]                      list locations (WxH, o=outdoors)
info <map> [--full]                size, props, warps out/in, actions
ascii <map> [x y w h] [--step n] [--at x,y] [--no-ruler]   ${LEGEND} f furniture h seat
tile <map> x y                     layers/tile index/properties at tile
path <map> x1 y1 x2 y2 [--ascii]   A* walk (moves like "R5 D3")
go <map> x y <target> [tx ty]      multi-map walk through doors/warps
route <from> <to>                  location hops
find <text>                        search warps/actions/props in all maps
render <map|file.tmx> [-o f.png] [--region x,y,w,h] [--scale n] [--season s] [--actor x,y[,dir]] [--sprite f.png] [--place img.png@x,y[@fw,fh,i][@top];...] [--grid] [--pass] [--path x1,y1,x2,y2]
sheet <img> [--idx i] [-o f.png --grid]   tilesheet info / index grid image
tmx <map> -o f.tmx                 export vanilla map to Tiled TMX (mod template)
check <file.tmx|map> [--locs A,B]  validate a custom map (layers, sheets, warps, connectivity)
fit <map> x y w h [--door x,y]     can a w*h structure go here? (blocking, cut paths, door reachability)
patch <map> <patch.tmx> x y [--mode Overlay|ReplaceByLayer|Replace] [-o f.png]   EditMap preview (CP semantics; default ReplaceByLayer erases under empty cells)
furni find <text> [--type chair] | furni info <id|name> | furni show <id|name> [-o f.png] | furni list <map> | furni skins <id> | furni mods   game + imported mod furniture (TR/EN)
place <map> <id|name> x y [--rot 0-3] [--skin mod:n] [--save] [--mod id]   check placement (floor/wall/overlap/doors/paths); --save keeps it
unplace <map> x y [--mod id]       remove saved furniture covering x,y
seats <map> | sit <map> x y [-o f.png]   seats (furniture + map benches/Data/ChairTiles) + bed sleep spots; sit renders the NPC seated
bake <map> -o dir [--name sheet]  export decorated map for a mod: TMX + furniture tilesheet + Data/ChairTiles entries (seats work in game)
house <Name> --rooms A:14x8,B:12x8,... --exit Map,x,y [--entry A] [--mod id]   several rooms side by side (doorways between, exit under the entry room)
room <Name> <w> <h> --exit Map,x,y [--mod id]   new interior location (w x h floor, 3-tile walls, frame, bottom exit)
building <map> x y --texture key --rect sx,sy,w,h --door dx,dy --to <Loc> [--roof rows] [--mod id]   exterior from a game texture + door warp
bld find <text> | bld info <id> | bld show <id> [-o f.png]   farm buildings from imported packs
state <name> [--mod id] [--off]    require a world state the game sets in code (${Object.keys(WORLD_STATES).join(', ')})
furni act <id> <TileAction|none> [--mod id]   give furniture a function in game (kitchen, Billboard, Jukebox…) via the SMAPI bridge
cp-export <mod> -o dir             installable Content Patcher mod (+ [SS] pack: real furniture when the SMAPI bridge is installed)
ss-export <mod> -o dir [--name "[SS] X"]   simulator mod -> Stardew Sim Bridge content pack (real furniture in game via SMAPI)
ss-import <export.json> [--mod id]   layout exported by the SMAPI mod (exports/*.json) -> simulator mod
walls [wallpaper|floor] [-o f.png] [--set Id] [--from n --count n] | decorate <map> [--room R|--area x,y,w,h] [--wallpaper N|Set:N] [--floor N|Set:N] [--save] [--mod id]`;

export async function sdv(argv) {
  const { pos, fl } = parseArgs(argv);
  const [cmd, ...p] = pos;
  const ix = index();
  switch (cmd) {
    case undefined: case 'help': return { text: SDV_HELP };
    case 'maps': {
      const f = (p[0] || '').toLowerCase();
      return { text: Object.entries(ix.maps).filter(([k]) => k.toLowerCase().includes(f)).map(([k, v]) => `${k} ${v.w}x${v.h}${v.out ? ' o' : ''}${v.mod ? ' mod:' + v.mod : ''}`).join('\n') };
    }
    case 'info': {
      const m = await loadAnyMap(p[0]);
      const props = Object.entries(m.props).filter(([k]) => k !== 'Warp').map(([k, v]) => `${k}=${String(v).length > 60 && !fl.full ? String(v).slice(0, 57) + '...' : v}`);
      const acts = {};
      for (const [x, y, , v] of m.actions()) { const k = v.split(' ')[0]; if (/^(Warp|LockedDoorWarp|MagicWarp)$/.test(k)) continue; (acts[k] ||= []).push(fl.full ? `${x},${y}:${v.slice(k.length + 1)}` : `${x},${y}`); }
      const inc = incoming(ix, m.name);
      return { text: [`${m.name} ${m.w}x${m.h}${m.props.Outdoors ? ' outdoors' : ''}`,
        `props: ${props.join('; ') || '-'}`,
        `sheets: ${m.sheets.map(s => `${s.id}=${s.img}`).join(', ')}`,
        `layers: ${m.layerOrder.join(',')}`,
        `warps out:\n  ${groupWarps(m.warps).join('\n  ') || '-'}`,
        `warps in:\n  ${inc.map(([f, x, y, tx, ty]) => `${f} ${x},${y} > ${tx},${ty}`).join('\n  ') || '-'}`,
        `actions:\n  ${Object.entries(acts).map(([k, v]) => `${k}: ${v.length > 12 && !fl.full ? v.slice(0, 12).join(' ') + ` (+${v.length - 12})` : v.join(' ')}`).join('\n  ') || '-'}`].join('\n') };
    }
    case 'ascii': {
      const m = await loadAnyMap(p[0]); const [x, y, w, h] = p.slice(1).map(Number);
      const marks = fl.at ? [[...nums(fl.at).slice(0, 2), '@']] : [];
      return { text: asciiMap(m, { x, y, w, h, step: +fl.step || 1, marks, ruler: !fl['no-ruler'] }) };
    }
    case 'tile': {
      const m = await loadAnyMap(p[0]); const x = +p[1], y = +p[2];
      const lines = [`${m.name} ${x},${y} cell=${['void', 'floor', 'blocked', 'water', 'door'][m.cell(x, y)]} walkable=${m.walkable(x, y)}`];
      for (const L of m.layerOrder) {
        const g = m.gid(L, x, y); if (!g) continue;
        const s = m.sheetOf(g), pr = m.tprops(L, x, y);
        const an = m.anim[L]?.[`${x},${y}`];
        lines.push(`${L}: ${s.sheet.id}#${s.idx} (${s.sheet.img})${pr ? ' ' + JSON.stringify(pr) : ''}${an ? ` anim ${an[0]}ms x${an[1].length}` : ''}`);
      }
      for (const w of m.warps) if (w[0] === x && w[1] === y) lines.push('warp: ' + fmtW(w));
      return { text: lines.join('\n') };
    }
    case 'path': {
      const m = await loadAnyMap(p[0]); const [x1, y1, x2, y2] = p.slice(1).map(Number);
      const pt = findPath(m, x1, y1, x2, y2);
      if (!pt) return { text: `no path ${x1},${y1} -> ${x2},${y2} (start walkable=${m.walkable(x1, y1)}, goal walkable=${m.walkable(x2, y2)})` };
      let t = `len ${pt.length - 1}: ${pathToMoves(pt)}`;
      if (fl.ascii) {
        const xs = pt.map(q => q[0]), ys = pt.map(q => q[1]);
        const bx = Math.max(0, Math.min(...xs) - 2), by = Math.max(0, Math.min(...ys) - 2);
        t += '\n' + asciiMap(m, { x: bx, y: by, w: Math.max(...xs) - bx + 3, h: Math.max(...ys) - by + 3, path: pt, marks: [[x1, y1, '@']] });
      }
      return { text: t };
    }
    case 'route': {
      const r = route(ix, p[0], p[1]);
      return { text: r ? r.map(h => `${h.from} ${h.x},${h.y} > ${h.to} ${h.tx},${h.ty}`).join('\n') : 'no route' };
    }
    case 'go': {
      let m = loadMap(p[0]), x = +p[1], y = +p[2];
      const hops = route(ix, m.name, p[3]);
      if (!hops) return { text: 'no route' };
      const out = [];
      for (const h of hops) {
        const pt = pathToWarp(m, x, y, h.x, h.y);
        out.push(`${m.name} ${x},${y} -> ${h.x},${h.y} [${h.to}]: ${pt ? pathToMoves(pt) + ` (${pt.length - 1})` : 'NO PATH'}`);
        m = loadMap(h.to); x = h.tx; y = h.ty;
      }
      if (p[4] !== undefined) {
        const pt = findPath(m, x, y, +p[4], +p[5]);
        out.push(`${m.name} ${x},${y} -> ${p[4]},${p[5]}: ${pt ? pathToMoves(pt) + ` (${pt.length - 1})` : 'NO PATH'}`);
      } else out.push(`arrive ${m.name} ${x},${y}`);
      return { text: out.join('\n') };
    }
    case 'find': {
      const q = p.join(' ').toLowerCase(), out = [], hits = new Map();
      const add = (k, xy) => { if (!hits.has(k)) hits.set(k, []); if (xy) hits.get(k).push(xy); };
      const names = Object.keys(ix.maps).filter(n => fl.all || !isVariant(n, ix.maps));
      for (const name of names) {
        const info = ix.maps[name];
        if (name.toLowerCase().includes(q)) add(`${name} (map ${info.w}x${info.h})`);
        for (const w of info.warps) if (w[2].toLowerCase().includes(q)) add(`${name} ${w[5] === 'w' ? 'edge' : 'door'}>${w[2]} ${w[3]},${w[4]} at`, `${w[0]},${w[1]}`);
      }
      if (q.length > 2) for (const name of names) {
        const m = loadMap(name);
        for (const [x, y, , v] of m.actions()) if (v.toLowerCase().includes(q) && !/Warp/.test(v)) add(`${name} ${v} at`, `${x},${y}`);
        for (const [k, v] of Object.entries(m.props)) if ((k + ' ' + v).toLowerCase().includes(q) && k !== 'Warp') add(`${name} prop ${k}=${String(v).slice(0, 60)}`);
      }
      for (const [k, xy] of hits) out.push(xy.length ? `${k} ${xy.join(' ')}` : k);
      return { text: out.slice(0, +fl.limit || 80).join('\n') || 'nothing' };
    }
    case 'render': {
      const m = await loadAnyMap(p[0]);
      const region = fl.region ? nums(fl.region) : null;
      if (!region && m.w * m.h > 90 * 90 && !fl.full) return { text: `map is ${m.w}x${m.h}; pass --region x,y,w,h (or --full). Tip: ascii first to find the area.` };
      const actors = [];
      if (fl.actor) { const [ax, ay, dir] = String(fl.actor).split(','); actors.push({ img: readPNG(fl.sprite || path.join(DATA, 'img/extra/sprites.png')), x: +ax, y: +ay, dir: dir || 'down' }); }
      // --place "file.png@x,y[@fw,fh,i][@top]" (';' separated). Bottom-left of the image sits on the bottom-left of tile x,y
      // (fractional tiles allowed); @fw,fh,i picks one frame of a sprite sheet; @top draws above all map layers.
      const placed = [], overlays = [];
      if (fl.place) for (const spec of String(fl.place).split(';').map(x => x.trim()).filter(Boolean)) {
        const parts = spec.split('@'), f = parts[0], [px, py] = nums(parts[1] || ''), top = parts.includes('top');
        if (!f || isNaN(px) || isNaN(py)) throw new Error(`bad --place "${spec}" (expected file.png@x,y[@fw,fh,i][@top])`);
        let im = loadImgFile(f);
        const fr = parts.slice(2).find(q => /^\d+,\d+,\d+$/.test(q));
        if (fr) { const [fw, fh, i] = nums(fr), cols = Math.max(1, Math.floor(im.width / fw)), c = newImg(fw, fh);
          if ((i + 1) > cols * Math.floor(im.height / fh)) throw new Error(`frame ${i} outside ${f} (${cols}x${Math.floor(im.height / fh)} frames of ${fw}x${fh})`);
          blit(c, im, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh, 0, 0); im = c; }
        const left = px * 16, topY = (py + 1) * 16 - im.height;
        if (top) overlays.push({ img: im, x: left, y: topY }); else actors.push({ img: im, x: px + (im.width / 16 - 1) / 2, y: py, fw: im.width, fh: im.height });
        placed.push({ spec: f.split('/').pop() + (fr ? '#' + fr.split(',')[2] : ''), im, left, topY, top });
      }
      let marks = [];
      if (fl.path) { const [a, b, c, d] = nums(fl.path); const pt = findPath(m, a, b, c, d); if (pt) marks = pt.map(([x, y]) => [x, y, [255, 230, 0, 150]]); }
      const season = SEASONS.includes(fl.season) ? fl.season : 'spring';
      const img = renderMap(m, { getImg, textures: ix.textures, season, region, scale: +fl.scale || 1, actors, overlays, grid: !!fl.grid, overlay: fl.pass ? 'pass' : null, marks, furniture: m.furniture, catalog: furnData().items, skins: furnData().skins });
      const o = fl.o || path.join(process.env.TMPDIR || '/tmp', `sdv-${m.name.replace(/\W/g, '_')}.png`);
      const png = encodePNG(img); fs.writeFileSync(o, png);
      const report = placed.map(pl => placeReport(m, pl, region || [0, 0, m.w, m.h], season));
      return { text: [`wrote ${o} ${img.width}x${img.height}`, ...report].join('\n'), image: { path: o, png } };
    }
    case 'sheet': {
      const key = Object.keys(ix.textures).find(k => k === p[0] || k.split('/').pop() === p[0]);
      if (!key) return { text: `unknown image. e.g.: ${Object.keys(ix.textures).slice(0, 10).join(' ')} ...` };
      const [W, H] = ix.textures[key], cols = W / 16;
      let t = `${key} ${W}x${H}px cols=${cols} rows=${H / 16} (index = row*${cols}+col)`;
      if (fl.idx !== undefined) { const i = +fl.idx; t += `\n#${i}: col ${i % cols} row ${Math.floor(i / cols)} px ${(i % cols) * 16},${Math.floor(i / cols) * 16}`; }
      if (fl.o) {
        const src = getImg(key), S = 2, out = newImg(W * S, H * S, [40, 40, 40, 255]);
        blit(out, src, 0, 0, W, H, 0, 0, S);
        if (fl.grid) for (let r = 0; r < H / 16; r++) for (let c = 0; c < cols; c++) {
          fillRect(out, c * 32, r * 32, 32, 1, [255, 0, 255, 90]); fillRect(out, c * 32, r * 32, 1, 32, [255, 0, 255, 90]);
          drawText(out, r * cols + c, c * 32 + 1, r * 32 + 1, [255, 255, 0, 255], 1);
        }
        const png = encodePNG(out); fs.writeFileSync(fl.o, png); t += `\nwrote ${fl.o}`;
        return { text: t, image: { path: fl.o, png } };
      }
      return { text: t };
    }
    case 'tmx': {
      const m = loadMap(p[0]); const o = fl.o || m.name.replace(/\W/g, '_') + '.tmx';
      fs.writeFileSync(o, mapToTmx(m));
      return { text: `wrote ${o} (tilesheet PNGs: ${[...new Set(m.sheets.map(s => s.img))].map(k => path.join(DATA, 'img', k + '.png')).join(' ')})` };
    }
    case 'check': {
      const m = await loadAnyMap(p[0]);
      const r = checkMap(m, { index: ix, loadMap: (n) => { try { return loadMap(n); } catch { return null; } }, extraLocations: fl.locs ? String(fl.locs).split(',') : [] });
      const w = [...(m.loadWarnings || []), ...r.warnings];
      return { text: [`${r.errors.length ? 'FAIL' : 'OK'} ${m.name}`, ...r.errors.map(e => 'E ' + e), ...w.map(e => 'W ' + e), ...r.info.map(e => 'i ' + e)].join('\n') };
    }
    case 'fit': {
      const m = loadMap(p[0]); const [x, y, w, h] = p.slice(1).map(Number);
      const door = fl.door ? nums(fl.door) : null;
      const r = checkFootprint(m, x, y, w, h, { door });
      const ok = r.counts.blocked === 0 && r.counts.water === 0 && r.counts.void === 0 && !r.warpsIn.length && !r.lostWarps.length && r.cutTiles === 0 && r.doorReachable !== false;
      const marks = []; for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) marks.push([xx, yy, '?']);
      if (door) marks.push([door[0], door[1], 'D']);
      return { text: [`${ok ? 'FITS' : 'CONFLICT'} ${m.name} ${x},${y} ${w}x${h}`,
        `tiles: ${Object.entries(r.counts).filter(([, v]) => v).map(([k, v]) => k + '=' + v).join(' ')}`,
        r.warpsIn.length ? `covers warps: ${r.warpsIn.map(fmtW).join('; ')}` : '',
        r.actions.length ? `covers actions: ${r.actions.map(a => `${a[0]},${a[1]} ${a[3]}`).join('; ')}` : '',
        r.lostWarps.length ? `cuts off warp areas: ${r.lostWarps.join(' ')}` : '',
        r.cutTiles ? `${r.cutTiles} walkable tiles become unreachable` : '',
        r.doorReachable === false ? 'door tile not reachable after placing' : '',
        asciiMap(m, { x: Math.max(0, x - 4), y: Math.max(0, y - 4), w: w + 8, h: h + 8, marks })].filter(Boolean).join('\n') };
    }
    case 'patch': {
      const base = loadMap(p[0]), pm = await loadAnyMap(p[1]), x = +p[2], y = +p[3];
      const before = checkFootprint(base, x, y, pm.w, pm.h);
      const mode = fl.mode || 'ReplaceByLayer', m = applyPatch(base, pm, x, y, mode);
      const wiped = {}; // tiles CP will erase: ReplaceByLayer copies empty patch cells too
      if (mode !== 'Overlay') for (const id of pm.layerOrder) for (let py = 0; py < pm.h; py++) for (let px = 0; px < pm.w; px++)
        if (!pm.gid(id, px, py) && base.gid(id, x + px, y + py)) wiped[id] = (wiped[id] || 0) + 1;
      const lm = (n) => { try { return loadMap(n); } catch { return null; } };
      const r = newProblems(checkMap(base, { index: ix, loadMap: lm }), checkMap(m, { index: ix, loadMap: lm }));
      const cd = connectivityDiff(base, m);
      if (cd.lostWarps.length) r.errors.push(`warps cut off from the main area: ${cd.lostWarps.join(' ')}`);
      if (cd.lostTiles) r.warnings.push(`${cd.lostTiles} walkable tiles became unreachable (enclosed area)`);
      const o = fl.o || path.join(process.env.TMPDIR || '/tmp', `sdv-patch-${base.name}.png`);
      const pad = 4, region = [Math.max(0, x - pad), Math.max(0, y - pad), Math.min(m.w - Math.max(0, x - pad), pm.w + pad * 2), Math.min(m.h - Math.max(0, y - pad), pm.h + pad * 2)];
      const img = renderMap(m, { getImg, textures: ix.textures, season: fl.season || 'spring', region, scale: +fl.scale || 1, overlay: fl.pass ? 'pass' : null });
      const png = encodePNG(img); fs.writeFileSync(o, png);
      return { text: [`patched ${base.name} with ${pm.name} ${pm.w}x${pm.h} at ${x},${y} (PatchMode ${mode})`,
        ...Object.entries(wiped).map(([id, n]) => `W ${mode} erases ${n} existing ${id} tiles (empty patch cells) — use --mode Overlay / PatchMode "Overlay" unless that's intended`),
        before.warpsIn.length ? `W covers vanilla warps: ${before.warpsIn.map(fmtW).join('; ')}` : '',
        before.actions.length ? `W covers vanilla actions: ${before.actions.map(a => `${a[0]},${a[1]} ${a[3]}`).join('; ')}` : '',
        ...r.errors.map(e => 'E ' + e), ...r.warnings.map(e => 'W ' + e),
        Object.keys(pm.props).length ? `i patch map properties not copied (use CP MapProperties/AddWarps): ${Object.keys(pm.props).join(',')}` : '',
        asciiMap(m, { x: region[0], y: region[1], w: region[2], h: region[3] }), `wrote ${o}`].filter(Boolean).join('\n'), image: { path: o, png } };
    }
    case 'furni': {
      const sub = p[0], cat = furnData().items;
      if (sub === 'find') {
        const q = p.slice(1).join(' ').toLowerCase(), t = fl.type ? String(fl.type).toLowerCase() : null;
        const hits = Object.values(cat).filter(f => (!t || f.t === t) && (!q || f.id === q || f.n.toLowerCase().includes(q) || (f.tr || '').toLowerCase().includes(q) || f.t === q));
        return { text: hits.slice(0, +fl.limit || 40).map(fline).join('\n') + (hits.length > (+fl.limit || 40) ? `\n(+${hits.length - (+fl.limit || 40)} more, use --limit)` : '') || 'nothing' };
      }
      if (sub === 'info') {
        const f = findFurn(p.slice(1).join(' '));
        const rots = [0, 1, 2, 3].slice(0, f.r === 1 ? 1 : f.r === 2 ? 2 : 4).map(r => { const l = layout(f, r); const st = furnSeats(f, { x: 0, y: 0 }, l); return `rot${r}: sprite ${l.src.w / 16}x${l.src.h / 16} @${l.src.x},${l.src.y}${l.flip ? ' flipped' : ''} box ${l.bw}x${l.bh}${st.length ? ' seats ' + st.map(s => `${s.x},${s.y}>${s.dir}`).join(' ') : ''}`; });
        const pr = { '-1': 'default (indoors)', 0: 'indoors', 1: 'outdoors', 2: 'anywhere' }[f.pr] || f.pr;
        const native = NATIVE_ACTIONS[f.id] ? `function (vanilla): ${NATIVE_ACTIONS[f.id]}` : /^bed/.test(f.t) ? 'function (vanilla): sleep (BedFurniture)' : f.t === 'dresser' ? 'function (vanilla): storage' : f.t === 'fireplace' || f.t === 'torch' ? 'function (vanilla): toggle fire/light' : f.t === 'lamp' || f.t === 'sconce' || f.t === 'window' ? 'function (vanilla): light' : f.t === 'fishtank' ? 'function (vanilla): fish tank' : '';
        const extra = [native, furnData().actions?.[f.id] ? `function (Calcifer): ${furnData().actions[f.id].join(', ')}` : '', furnData().props?.[f.id] ? `MMAP: ${JSON.stringify(furnData().props[f.id])}` : '', f.needs ? `needs: ${f.needs}` : ''].filter(Boolean);
        return { text: [fline(f), ...extra, `texture ${f.tex} sprite#${f.i}, placement ${pr}${WALL_TYPES.has(f.t) ? ', wall-mounted' : f.t === 'rug' ? ', walkable rug' : ''}${SEAT_TYPES.has(f.t) ? ', sittable' : ''}`, ...rots].join('\n') };
      }
      if (sub === 'show') {
        const f = findFurn(p.slice(1).join(' ')), tex = getImg(f.tex), n = f.r === 1 ? 1 : f.r === 2 ? 2 : 4;
        const ls = [0, 1, 2, 3].slice(0, n).map(r => layout(f, r)), W = ls.reduce((a, l) => a + l.src.w + 4, 0), H = Math.max(...ls.map(l => l.src.h)) + 8;
        const img = newImg(W * 3, H * 3, [40, 40, 40, 255]); let x = 0;
        for (const [r, l] of ls.entries()) { blit(img, tex, l.src.x, l.src.y, l.src.w, l.src.h, x * 3, (H - l.src.h) * 3, 3, l.flip); drawText(img, r, x * 3 + 1, 1, [255, 255, 0, 255], 2); x += l.src.w + 4; }
        const o = fl.o || path.join(process.env.TMPDIR || '/tmp', `furni-${f.id}.png`), png = encodePNG(img); fs.writeFileSync(o, png);
        return { text: `${fline(f)}\nwrote ${o} (rotations 0..${n - 1} left to right)`, image: { path: o, png } };
      }
      if (sub === 'skins') {
        const f = findFurn(p.slice(1).join(' ')), sk = skinsFor(f, furnData().skins);
        return { text: sk.length ? sk.map(s => `${s.mod}: ${s.variations.map(v => v.id + (v.name ? '=' + v.name : '')).join(', ')}  (use --skin ${s.mod}:<n>)`).join('\n') : 'no skins' };
      }
      if (sub === 'act') {
        const f = findFurn(p[1]), act = p[2];
        editMod(fl.mod || 'user', mm => { mm.actions ||= {}; if (!act || act === 'none') delete mm.actions[f.id]; else mm.actions[f.id] = [act]; });
        return { text: `${fname(f)}: ${act && act !== 'none' ? 'action ' + act : 'no action'} (mods/${fl.mod || 'user'})` };
      }
      if (sub === 'mods') return { text: (furnData().mods || []).map(m => `${m.kind} ${m.id} ${m.name} v${m.version} by ${m.author}`).join('\n') || 'no third-party packs (tools/import-mods.mjs)' };
      if (sub === 'list') {
        const m = loadMap(p[1]);
        return { text: (m.furniture || []).map(pl => `${pl.x},${pl.y} rot${pl.rot || 0} ${fline(cat[pl.id])}${pl.mod ? ' [' + pl.mod + ']' : ''}`).join('\n') || 'no furniture' };
      }
      throw new Error('furni find|info|show|list');
    }
    case 'place': {
      const m = loadMap(p[0]), f = findFurn(p[1]), pl = { id: f.id, x: +p[2], y: +p[3], rot: +fl.rot || 0, ...(fl.skin ? { skin: String(fl.skin) } : {}) };
      const r = canPlace(m, f, pl, { placed: m.furniture || [], catalog: furnData().items });
      const lines = [`${r.ok ? 'OK' : 'NO'} ${fname(f)} at ${pl.x},${pl.y} rot${r.lay.rot} box ${r.lay.bw}x${r.lay.bh}`, ...r.errors.map(e => 'E ' + e), ...r.warnings.map(e => 'W ' + e)];
      const st = furnSeats(f, pl, r.lay); if (st.length) lines.push('seats: ' + st.map(s => `${s.x},${s.y}>${s.dir}`).join(' '));
      if (r.ok && !WALL_TYPES.has(f.t) && f.t !== 'rug') {
        const after = m.furniture.concat([pl]); const t = new GameMap(m.j); t.setFurniture(after, furnData().items, furnitureBlocks(after, furnData().items));
        const cd = connectivityDiff(m, t); if (cd.lostWarps.length) lines.push(`E blocks the way to warps ${cd.lostWarps.join(' ')}`); if (cd.lostTiles) lines.push(`W ${cd.lostTiles} floor tiles become unreachable`);
      }
      if (fl.save && r.ok) { editMod(fl.mod || 'user', mm => { ((mm.furniture ||= {})[m.name] ||= []).push(pl); }); lines.push(`saved to mods/${fl.mod || 'user'}`); }
      const marks = r.tiles.map(([x, y]) => [x, y, '?']);
      lines.push(asciiMap(fl.save && r.ok ? loadMap(p[0]) : m, { x: Math.max(0, pl.x - 4), y: Math.max(0, pl.y - 4), w: r.lay.bw + 8, h: r.lay.bh + 8, marks: fl.save ? [] : marks }));
      return { text: lines.join('\n') };
    }
    case 'unplace': {
      const m = loadMap(p[0]), x = +p[1], y = +p[2], cat = furnData().items, id = fl.mod || 'user'; let removed = null;
      editMod(id, mm => { const list = mm.furniture?.[m.name] || []; const k = list.findIndex(pl => { const l = layout(cat[pl.id], pl.rot || 0); return x >= pl.x && y >= pl.y && x < pl.x + l.bw && y < pl.y + l.bh; }); if (k >= 0) removed = list.splice(k, 1)[0]; });
      return { text: removed ? `removed ${fname(cat[removed.id])} at ${removed.x},${removed.y} from mods/${id}` : `nothing of mods/${id} at ${x},${y}` };
    }
    case 'seats': {
      const m = loadMap(p[0]);
      const beds = (m.furniture || []).map(pl => { const f = furnData().items[pl.id]; const z = f && bedSpot(f, pl); return z ? `${z.x},${z.y} sleep ${fname(f)} @${pl.x},${pl.y}` : null; }).filter(Boolean);
      return { text: [...allSeats(m).map(s => `${s.x},${s.y} >${s.dir} ${s.name}${s.at ? ' @' + s.at : ''}`), ...beds].join('\n') || 'no seats' };
    }
    case 'sit': {
      const m = loadMap(p[0]), x = +p[1], y = +p[2];
      const st = allSeats(m).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
      if (!st || Math.hypot(st.x - x, st.y - y) > 2) return { text: `no seat near ${x},${y}. sdv seats ${m.name}` };
      const region = [Math.max(0, Math.floor(st.x) - 4), Math.max(0, Math.floor(st.y) - 5), 9, 8];
      const img = renderMap(m, { getImg, textures: ix.textures, region, scale: +fl.scale || 3, furniture: m.furniture, catalog: furnData().items, skins: furnData().skins,
        actors: [{ img: readPNG(fl.sprite || path.join(DATA, 'img/extra/sprites.png')), x: st.x, y: st.y, dir: st.dir, seated: true }] });
      const o = fl.o || path.join(process.env.TMPDIR || '/tmp', `sit-${m.name}.png`), png = encodePNG(img); fs.writeFileSync(o, png);
      const near = [[0, 1], [1, 0], [-1, 0], [0, -1]].map(([dx, dy]) => [Math.round(st.x) + dx, Math.round(st.y) + dy]).filter(q => m.walkable(...q));
      return { text: `sits on ${st.name} at ${st.x},${st.y} facing ${st.dir}; reachable from ${near.map(q => q.join(',')).join(' ') || 'nowhere!'}\nwrote ${o}`, image: { path: o, png } };
    }
    case 'walls': {
      const kind = p[0] === 'floor' ? 'flooring' : 'wallpaper', sets = furnData()[kind];
      let t = sets.map(e => `${e.Id || '(vanilla)'} ${e.Texture} ids ${e.Id ? e.Id + ':' : ''}0..${e.Count - 1}`).join('\n');
      if (fl.o) {
        const e = sets.find(x => (x.Id || '') === (fl.set || '')) || sets[0], tex = getImg(e.Texture), isF = kind === 'flooring';
        if (fl.set && (e.Id || '') !== fl.set) throw new Error(`unknown set ${fl.set}`);
        const from = +fl.from || 0, n = Math.min(e.Count - from, +fl.count || 64), cw = isF ? 32 : 16, ch = isF ? 32 : 48, per = isF ? 8 : 16, S = 2, img = newImg(per * (cw + 4) * S, Math.ceil(n / per) * (ch + 10) * S, [30, 30, 30, 255]);
        const row0 = (e.startRow ?? (e.Id ? 0 : isF ? 21 : 0)) * 16;
        for (let k = 0; k < n; k++) { const i = from + k, pr = tex.width / cw, sx = (i % pr) * cw, sy = row0 + Math.floor(i / pr) * ch; const dx = (k % per) * (cw + 4) * S, dy = Math.floor(k / per) * (ch + 10) * S; drawText(img, i, dx + 1, dy + 1, [255, 255, 0, 255], 1); blit(img, tex, sx, sy, cw, ch, dx, dy + 8 * S, S); }
        const png = encodePNG(img); fs.writeFileSync(fl.o, png); t += `\nwrote ${fl.o}`; return { text: t, image: { path: fl.o, png } };
      }
      return { text: t + '\nuse: walls wallpaper -o w.png [--set MoreWalls] to see them' };
    }
    case 'bake': {
      const r = bakeLocation(p[0], fl.name), dir = fl.o || 'baked';
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, r.map.name.replace(/\W/g, '_') + '.tmx'), mapToTmx(r.map));
      writePNG(path.join(dir, r.sheetName + '.png'), r.sheet);
      fs.writeFileSync(path.join(dir, 'ChairTiles.json'), JSON.stringify(r.chairTiles, null, 1));
      const ext = [...new Set(r.map.sheets.filter(s => !s.missing && !/^Maps\//.test(s.img)).map(s => s.img))];
      return { text: `baked ${r.map.name}: ${r.tiles} furniture tiles, ${Object.keys(r.chairTiles).length / 2} seats, ${r.lights} lights -> ${dir}/\nCP: Load Maps/<name> FromFile the .tmx (ship ${r.sheetName}.png${ext.length ? ' + ' + ext.join(', ') : ''} next to it) and EditData Data/ChairTiles with ChairTiles.json` };
    }
    case 'bld': { // farm buildings from imported packs (Data/Buildings) — built via Robin in game, functional by their own data
      const sub = p[0], all = Object.values(furnData().buildings || {});
      const line = (b) => `${b.id} ${b.tr || b.n} | ${b.size.join('x')} tiles${b.indoor ? ' interior ' + b.indoor : ''}${b.skins?.length ? ' skins:' + b.skins.length : ''}${b.items ? ' furnished:' + b.items : ''} [${b.mod}]`;
      if (sub === 'find') { const q = p.slice(1).join(' ').toLowerCase(); return { text: all.filter(b => !q || (b.id + b.n + (b.tr || '')).toLowerCase().includes(q)).map(line).join('\n') || 'no buildings (import packs with tools/import-mods.mjs)' }; }
      const b = all.find(x => x.id === p[1] || x.n === p.slice(1).join(' ')); if (!b) throw new Error('bld find|info <id>|show <id> [-o f.png]');
      if (sub === 'info') return { text: [line(b), b.desc ? 'desc: ' + String(b.desc).slice(0, 160) : '', `texture ${b.tex} rect ${(b.rect || []).join(',')}${b.door ? ' door ' + b.door.join(',') : ''}${b.builder ? ' builder ' + b.builder : ''}`, 'preview on a map: sdv render Farm --region ... --place web/data/img/' + b.tex + '.png@x,y'].filter(Boolean).join('\n') };
      if (sub === 'show') { const im = getImg(b.tex); const [x, y, w, h] = b.rect || [0, 0, im.width, im.height]; const out = newImg(w * 3, h * 3); blit(out, im, x, y, w, h, 0, 0, 3); const o = fl.o || path.join(process.env.TMPDIR || '/tmp', `bld-${b.id.replace(/\W/g, '_')}.png`), png = encodePNG(out); fs.writeFileSync(o, png); return { text: `${line(b)}\nwrote ${o}`, image: { path: o, png } }; }
      throw new Error('bld find|info|show');
    }
    case 'state': {
      if (!WORLD_STATES[p[0]]) throw new Error(`unknown state; known: ${Object.keys(WORLD_STATES).join(', ')}`);
      editMod(fl.mod || 'user', mm => { const st = new Set(mm.states || []); fl.off ? st.delete(p[0]) : st.add(p[0]); mm.states = [...st]; });
      return { text: `${fl.off ? 'removed' : 'requires'} ${p[0]} in mods/${fl.mod || 'user'}` };
    }
    case 'room': {
      const [name, w, h] = [p[0], +p[1], +p[2]], id = fl.mod || 'user';
      if (!name || !w || !h) throw new Error('room <Name> <w> <h> --exit Map,x,y');
      const W = w + 2, H = h + 6, N = W * H, cx = Math.floor(W / 2), floorEnd = 3 + h;
      const T = { id: 'z_room_kit', img: 'stardewsim/room_kit', cols: 8, rows: 6, first: 1, tp: {} };
      const L = { Back: new Uint16Array(N), Back2: new Uint16Array(N), Buildings: new Uint16Array(N), Front: new Uint16Array(N) };
      const set = (l, x, y, i) => { L[l][y * W + x] = i + 1; };
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const room = x >= 1 && x <= W - 2 && y >= 1 && y <= floorEnd, exit = x === cx && y > floorEnd;
        if (!room && !exit) { set('Buildings', x, y, 0); continue; }
        if (y >= 4 || exit) set('Back', x, y, y === 4 ? 3 : (x + y * 3) % 5 ? 1 : 2); else set('Buildings', x, y, [5, 6, 7][y - 1]);
      }
      for (let y = 1; y <= floorEnd; y++) { set('Front', 0, y, 12); set('Front', W - 1, y, 13); }
      for (let x = 1; x <= W - 2; x++) { set('Front', x, 0, 15); if (x !== cx) set('Front', x, floorEnd + 1, 14); }
      set('Front', 0, 0, 39); set('Front', W - 1, 0, 47); set('Front', 0, floorEnd + 1, 23); set('Front', W - 1, floorEnd + 1, 31);
      set('Front', cx - 1, floorEnd + 1, 40); set('Front', cx + 1, floorEnd + 1, 41); for (let y = floorEnd + 2; y < H; y++) { set('Front', cx - 1, y, 12); set('Front', cx + 1, y, 13); }
      const [em, ex, ey] = String(fl.exit || 'Town,0,0').split(',');
      const j = { name, w: W, h: H, props: { Warp: `${cx} ${H} ${em} ${+ex} ${+ey}`, StardewSimArrival: `${cx} ${floorEnd}` }, sheets: [T], anim: {}, tp: {},
        layers: Object.entries(L).map(([lid, a]) => ({ id: lid, vis: true, data: Buffer.from(a.buffer).toString('base64') })) };
      const file = `mods/${id}/${name}.json`;
      fs.mkdirSync(path.join(DATA, 'mods', id), { recursive: true }); fs.writeFileSync(path.join(DATA, file), JSON.stringify(j));
      editMod(id, mm => { (mm.locations ||= {})[name] = file; });
      return { text: `room ${name} ${W}x${H} (floor x1..${W - 2}, y4..${floorEnd}; walls y1..3) arrival ${cx},${floorEnd}, exit ${cx},${H} -> ${em} ${ex},${ey}\n` + asciiMap(loadMap(name)) };
    }
    case 'building': {
      const target = loadMap(p[0]), X = +p[1], Y = +p[2], id = fl.mod || 'user', tex = String(fl.texture), [sx, sy, sw, sh] = nums(fl.rect), [dx, dy] = nums(fl.door), to = String(fl.to);
      const tsz = ix.textures[tex]; if (!tsz) throw new Error(`unknown texture ${tex}`);
      const w = sw / 16, h = sh / 16, roof = fl.roof != null ? +fl.roof : h - 3, cols = tsz[0] / 16, N = w * h;
      const room = loadMap(to), arr = String(room.props.StardewSimArrival || '').split(' ').map(Number);
      const L = { Back: new Uint16Array(N), Back2: new Uint16Array(N), Buildings: new Uint16Array(N), Front: new Uint16Array(N) };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const gid = 1 + (sy / 16 + y) * cols + sx / 16 + x;
        const layer = y < roof ? 'Front' : x === dx && y === dy + 1 ? 'Back2' : 'Buildings';
        L[layer][y * w + x] = gid;
      }
      const j = { name: `${to}_Exterior`, w, h, props: {}, anim: {}, sheets: [{ id: 'z_' + tex.split('/').pop().replace(/\W/g, '_'), img: tex, cols, rows: tsz[1] / 16, first: 1, tp: {} }],
        tp: { Buildings: { [`${dx},${dy}`]: { Action: `Warp ${arr[0]} ${arr[1]} ${to}` } } }, layers: Object.entries(L).map(([lid, a]) => ({ id: lid, vis: true, data: Buffer.from(a.buffer).toString('base64') })) };
      const file = `mods/${id}/${to}_Exterior.json`;
      fs.writeFileSync(path.join(DATA, file), JSON.stringify(j));
      // point the room's exit at the tile in front of the door
      const rf = path.join(DATA, `mods/${id}/${to}.json`);
      if (fs.existsSync(rf)) { const rj = JSON.parse(fs.readFileSync(rf, 'utf8')); const wp = rj.props.Warp.split(' '); rj.props.Warp = `${wp[0]} ${wp[1]} ${target.name} ${X + dx} ${Y + dy + 1}`; fs.writeFileSync(rf, JSON.stringify(rj)); }
      const fit = checkFootprint(target, X, Y + roof, w, h - roof, { door: [X + dx, Y + dy + 1] });
      editMod(id, mm => { mm.patches = (mm.patches || []).filter(q => q.file !== file); mm.patches.push({ target: target.name, file, x: X, y: Y, mode: 'Overlay' }); });
      return { text: [`building ${to} entrance on ${target.name} at ${X},${Y} (${w}x${h}, roof rows ${roof}), door ${X + dx},${Y + dy} -> ${to} ${arr.join(',')}`,
        `footprint: ${Object.entries(fit.counts).filter(([, v]) => v).map(([k, v]) => k + '=' + v).join(' ')}${fit.warpsIn.length ? ' COVERS WARPS' : ''}${fit.cutTiles ? ` cuts ${fit.cutTiles} tiles` : ''}`,
        asciiMap(loadMap(target.name), { x: Math.max(0, X - 3), y: Math.max(0, Y + roof - 2), w: w + 6, h: h - roof + 5 })].join('\n') };
    }
    case 'cp-export': {
      const id = p[0], mf = path.join(DATA, 'mods', id, 'mod.json');
      if (!fs.existsSync(mf)) throw new Error(`no simulator mod ${id}`);
      const m = JSON.parse(fs.readFileSync(mf, 'utf8')), title = m.title || id, uid = `StardewSim.${id.replace(/[^\w]/g, '')}`;
      const dir = path.join(fl.o || 'dist', `[CP] ${title}`), A = path.join(dir, 'assets'); fs.mkdirSync(A, { recursive: true });
      const changes = [], chairs = {}, images = new Set(), notes = [];
      const deps = [...new Set(Object.values(m.furniture || {}).flat().map(pl => furnData().items[pl.id]?.mod).filter(Boolean))];
      // real furniture only when the bridge AND every decor pack are installed; otherwise the baked copy (art + seats) is used
      const useBridge = { Name: 'UseBridge', Value: 'true', When: Object.fromEntries(['Waifuhtr.StardewSim', ...deps].map(u => [`HasMod |contains=${u}`, true])) };
      const BRIDGE = { UseBridge: true }, BAKED = { UseBridge: false };
      // non-vanilla tilesheets get unique file names (several packs ship e.g. "Wallpaper_texture.png")
      const flat = (img) => /^Maps\//.test(img) ? img : img.replace(/[^\w.-]+/g, '_');
      const writeTmx = (map, file) => {
        const m2 = Object.create(map); m2.sheets = map.sheets.map(s => ({ ...s, img: s.missing ? s.img : flat(s.img) }));
        fs.writeFileSync(path.join(A, file), mapToTmx(m2)); for (const s of map.sheets) if (!/^Maps\//.test(s.img) && !s.missing) images.add(s.img); };
      for (const name of Object.keys(m.locations || {})) {
        const lm = loadMap(name), bare = new GameMap(lm.j), baked = bakeLocation(name);
        writeTmx(bare, `${name}_Bare.tmx`); writeTmx(baked.map, `${name}.tmx`); writePNG(path.join(A, baked.sheetName + '.png'), baked.sheet);
        Object.assign(chairs, baked.chairTiles);
        const arr = String(lm.props.StardewSimArrival || '0 0').split(' ').map(Number);
        changes.push({ Action: 'Load', Target: `Maps/${name}`, FromFile: `assets/${name}.tmx`, When: BAKED },
          { Action: 'Load', Target: `Maps/${name}`, FromFile: `assets/${name}_Bare.tmx`, When: BRIDGE },
          { Action: 'EditData', Target: 'Data/Locations', Entries: { [name]: { DisplayName: m.names?.[name] || name, DefaultArrivalTile: { X: arr[0], Y: arr[1] }, CreateOnLoad: { MapPath: `Maps/${name}` } } } });
      }
      if (Object.keys(chairs).length) changes.push({ Action: 'EditData', Target: 'Data/ChairTiles', Entries: chairs, When: BAKED });
      for (const pt of m.patches || []) {
        const pm = new GameMap(JSON.parse(fs.readFileSync(path.join(DATA, pt.file), 'utf8'))), f = path.basename(pt.file, '.json') + '.tmx';
        writeTmx(pm, f);
        changes.push({ Action: 'EditMap', Target: `Maps/${pt.target}`, FromFile: `assets/${f}`, ToArea: { X: pt.x, Y: pt.y, Width: pm.w, Height: pm.h }, PatchMode: pt.mode || 'ReplaceByLayer' });
      }
      for (const img of images) { const src = path.join(DATA, 'img', img + '.png'); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(A, flat(img) + '.png')); }
      if ((m.states || []).length) notes.push(`needs in-game progress: ${m.states.join(', ')} (e.g. repair the beach bridge)`);
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ Name: `[CP] ${title}`, Author: 'Stardew Sim', Version: '1.0.2', Description: `Made with Stardew Sim. ${notes.join(' ')}`.trim(), UniqueID: uid, ...(m.manifest || {}),
        ContentPackFor: { UniqueID: 'Pathoschild.ContentPatcher' }, Dependencies: [...deps.map(u => ({ UniqueID: u, IsRequired: false })), { UniqueID: 'Waifuhtr.StardewSim', IsRequired: false }] }, null, 2));
      fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ Format: '2.0.0', DynamicTokens: [{ Name: 'UseBridge', Value: 'false' }, useBridge], Changes: changes }, null, 2));
      const ss = await sdv(['ss-export', id, '-o', fl.o || 'dist', '--name', `[SS] ${title}`]);
      return { text: `wrote ${dir} (${changes.length} changes, ${images.size} images${deps.length ? ', requires ' + deps.join(', ') : ''})\n${ss.text}${notes.length ? '\nnote: ' + notes.join(' ') : ''}` };
    }
    case 'ss-export': {
      const id = p[0], f = path.join(DATA, 'mods', id, 'mod.json');
      if (!fs.existsSync(f)) throw new Error(`no simulator mod ${id}`);
      const m = JSON.parse(fs.readFileSync(f, 'utf8')), fd = furnData(), locs = {}, actions = {};
      const names = new Set([...Object.keys(m.furniture || {}), ...Object.keys(m.decor || {})]);
      for (const n of names) {
        const d = Array.isArray(m.decor?.[n]) ? {} : m.decor?.[n] || {};
        locs[n] = { Wallpaper: d.wallpaper != null && !String(d.wallpaper).includes(':') ? String(d.wallpaper) : undefined, Floor: d.floor != null && !String(d.floor).includes(':') ? String(d.floor) : undefined,
          Furniture: (m.furniture?.[n] || []).map(pl => ({ Id: pl.id, X: pl.x, Y: pl.y, Rotation: pl.rot || 0, Skin: pl.skin })) };
        for (const pl of m.furniture?.[n] || []) if (m.actions?.[pl.id] || fd.actions?.[pl.id]) actions[pl.id] = m.actions?.[pl.id] || fd.actions[pl.id];
      }
      const name = fl.name || `[SS] ${m.title || id}`, dir = path.join(fl.o || 'dist', name);
      fs.mkdirSync(dir, { recursive: true });
      const needs = [...new Set(names.size ? [...names].flatMap(n => (m.furniture?.[n] || []).map(pl => fd.items[pl.id]?.mod).filter(Boolean)) : [])];
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ Name: name, Author: 'Stardew Sim', Version: '1.0.2', Description: `Real furniture layout for ${[...names].join(', ')}`, UniqueID: `StardewSim.${id.replace(/[^\w.]/g, '')}`,
        ContentPackFor: { UniqueID: 'Waifuhtr.StardewSim' }, Dependencies: needs.map(u => ({ UniqueID: u, IsRequired: false })) }, null, 2));
      fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify({ RequiresMods: needs, Locations: locs, Actions: actions }, null, 1));
      return { text: `wrote ${dir}: ${[...names].map(n => `${n} ${locs[n].Furniture.length} furniture`).join(', ')}${Object.keys(actions).length ? `, ${Object.keys(actions).length} actions` : ''}${needs.length ? `\nrequires: ${needs.join(', ')}` : ''}` };
    }
    case 'ss-import': {
      const j = JSON.parse(fs.readFileSync(p[0], 'utf8')), id = fl.mod || 'save'; let n = 0;
      editMod(id, mm => { for (const [loc, L] of Object.entries(j.Locations || {})) {
        (mm.furniture ||= {})[loc] = (L.Furniture || []).map(f => ({ id: f.Id, x: f.X, y: f.Y, rot: f.Rotation || 0, ...(f.Skin ? { skin: f.Skin } : {}) })); n += mm.furniture[loc].length;
        if (L.Wallpaper || L.Floor) (mm.decor ||= {})[loc] = { ...(L.Wallpaper ? { wallpaper: L.Wallpaper } : {}), ...(L.Floor ? { floor: L.Floor } : {}) };
      } });
      return { text: `imported ${n} furniture into mods/${id} (${Object.keys(j.Locations || {}).join(', ')})` };
    }
    case 'decorate': {
      let m = loadMap(p[0]);
      if (fl.wallpaper == null && fl.floor == null) return { text: `wall tiles: ${wallTiles(m).length}; pass --wallpaper N and/or --floor N [--area x,y,w,h] (see: sdv walls)` };
      const area = fl.area ? nums(fl.area) : (fl.room ? (m.props.StardewSimRooms || '').split(';').map(r => r.split(':')).find(r => r[0] === fl.room)?.[1]?.split(',').map(Number) : null);
      if (fl.room && !area) throw new Error(`no room ${fl.room} in ${m.name} (rooms: ${(m.props.StardewSimRooms || '').split(';').map(r => r.split(':')[0]).join(', ')})`);
      const d = { ...(area ? { area } : {}), wallpaper: fl.wallpaper != null ? String(fl.wallpaper) : undefined, floor: fl.floor != null ? String(fl.floor) : undefined };
      const out = decorMap(m, d);
      if (out.decorWarnings.length) throw new Error(out.decorWarnings.join('; '));
      let t = `${m.name}${area ? ' area ' + area.join(',') : ''}: ${out.decorStats.walls} wall tiles, ${out.decorStats.floors} floor tiles`;
      if (fl.save) {
        editMod(fl.mod || 'user', mm => {
          mm.decor ||= {};
          if (area) { let list = mm.decor[m.name]; list = Array.isArray(list) ? list : list ? [list] : []; const k = list.findIndex(e => (e.area || []).join() === area.join()); const old = k >= 0 ? list[k] : {}; const e = { ...old, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v != null)) }; if (k >= 0) list[k] = e; else list.push(e); mm.decor[m.name] = list; }
          else mm.decor[m.name] = { ...(Array.isArray(mm.decor[m.name]) ? {} : mm.decor[m.name] || {}), ...Object.fromEntries(Object.entries(d).filter(([, v]) => v != null)) };
        });
        t += ` — saved to mods/${fl.mod || 'user'}`;
      }
      if (fl.o) { setFurn(out, m.furniture || []); const img = renderMap(out, { getImg, textures: ix.textures, scale: +fl.scale || 2, region: area ? [area[0], Math.max(0, area[1] - 1), area[2], area[3] + 2] : null, furniture: out.furniture, catalog: furnData().items, skins: furnData().skins }); const png = encodePNG(img); fs.writeFileSync(fl.o, png); t += `\nwrote ${fl.o}`; return { text: t, image: { path: fl.o, png } }; }
      return { text: t };
    }
    case 'house': { // several rooms side by side in one location, doorways in the partitions, exit under the entry room
      const name = p[0], id = fl.mod || 'user';
      const rooms = String(fl.rooms || '').split(',').map(r => { const [n, wh] = r.split(':'); const [w, h] = wh.split('x').map(Number); return { n, w, h }; });
      if (!name || !rooms.length || rooms.some(r => !r.w || !r.h)) throw new Error('house <Name> --rooms Hall:14x8,Kitchen:12x8 --exit Map,x,y [--entry Hall] [--mod id]');
      const H0 = Math.max(...rooms.map(r => r.h)), W = rooms.reduce((a, r) => a + r.w, 0) + rooms.length + 1, floorEnd = 3 + H0, H = floorEnd + 3, N = W * H;
      const T = { id: 'z_room_kit', img: 'stardewsim/room_kit', cols: 8, rows: 6, first: 1, tp: {} };
      const L = { Back: new Uint16Array(N), Back2: new Uint16Array(N), Buildings: new Uint16Array(N), Front: new Uint16Array(N), Front2: new Uint16Array(N) };
      const set = (l, x, y, i) => { L[l][y * W + x] = i + 1; }, clr = (l, x, y) => { L[l][y * W + x] = 0; };
      let x0 = 1; const placed = [];
      for (const r of rooms) { placed.push({ ...r, x: x0, y: 4 }); x0 += r.w + 1; }
      const entry = placed.find(r => r.n === (fl.entry || placed[0].n)) || placed[0], cx = entry.x + Math.floor(entry.w / 2);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const inside = x >= 1 && x <= W - 2 && y >= 1 && y <= floorEnd, exit = x === cx && y > floorEnd;
        if (!inside && !exit) { set('Buildings', x, y, 0); continue; }
        if (y >= 4 || exit) set('Back', x, y, y === 4 ? 3 : (x + y * 3) % 5 ? 1 : 2); else set('Buildings', x, y, [5, 6, 7][y - 1]);
      }
      // outer frame
      for (let y = 1; y <= floorEnd; y++) { set('Front', 0, y, 12); set('Front', W - 1, y, 13); }
      for (let x = 1; x <= W - 2; x++) { set('Front', x, 0, 15); if (x !== cx) set('Front', x, floorEnd + 1, 14); }
      set('Front', 0, 0, 39); set('Front', W - 1, 0, 47); set('Front', 0, floorEnd + 1, 23); set('Front', W - 1, floorEnd + 1, 31);
      set('Front', cx - 1, floorEnd + 1, 40); set('Front', cx + 1, floorEnd + 1, 41); for (let y = floorEnd + 2; y < H; y++) { set('Front', cx - 1, y, 12); set('Front', cx + 1, y, 13); }
      // partitions between rooms (void column with rims both sides) and a 2-tile doorway near the bottom
      const doors = [];
      for (let k = 0; k < placed.length - 1; k++) {
        const px = placed[k].x + placed[k].w, d1 = floorEnd - 2, d2 = floorEnd - 1;
        for (let y = 4; y <= floorEnd; y++) {
          if (y >= d1 && y <= d2) continue; // doorway keeps its floor
          clr('Back', px, y); set('Buildings', px, y, 0); set('Front', px, y, 13); set('Front2', px, y, 12);
        }
        set('Front2', px, d1 - 1, 15); // cap above the doorway
        if (d2 + 1 <= floorEnd) set('Front2', px, d2 + 1, 14);
        doors.push(`${placed[k].n}<>${placed[k + 1].n}@${px},${d1}..${d2}`);
      }
      const [em, ex, ey] = String(fl.exit || 'Town,0,0').split(',');
      const props = { Warp: `${cx} ${H} ${em} ${+ex} ${+ey}`, StardewSimArrival: `${cx} ${floorEnd}`, StardewSimRooms: placed.map(r => `${r.n}:${r.x},1,${r.w},${floorEnd}`).join(';') };
      const j = { name, w: W, h: H, props, sheets: [T], anim: {}, tp: {}, layers: Object.entries(L).map(([lid, a]) => ({ id: lid, vis: true, data: Buffer.from(a.buffer).toString('base64') })) };
      const file = `mods/${id}/${name}.json`;
      fs.mkdirSync(path.join(DATA, 'mods', id), { recursive: true }); fs.writeFileSync(path.join(DATA, file), JSON.stringify(j));
      // re-point doors in this mod that lead here (e.g. the exterior patch) at the new arrival tile
      editMod(id, mm => { (mm.locations ||= {})[name] = file;
        for (const pt of mm.patches || []) { const pf = path.join(DATA, pt.file); if (!fs.existsSync(pf)) continue; const pj = JSON.parse(fs.readFileSync(pf, 'utf8')); let ch = false;
          for (const t of Object.values(pj.tp || {})) for (const pr of Object.values(t)) if (pr.Action && new RegExp(`^(Warp|LockedDoorWarp) \\d+ \\d+ ${name}\\b`).test(pr.Action)) { const a = pr.Action.split(' '); a[1] = cx; a[2] = floorEnd; pr.Action = a.join(' '); ch = true; }
          if (ch) fs.writeFileSync(pf, JSON.stringify(pj)); } });
      return { text: [`house ${name} ${W}x${H}: ${placed.map(r => `${r.n} x${r.x}..${r.x + r.w - 1} (floor y4..${floorEnd}, walls y1..3)`).join('; ')}`, `doorways: ${doors.join(' ')}`, `arrival ${cx},${floorEnd}; exit ${cx},${H} -> ${em} ${ex},${ey}`, `decorate per room: sdv decorate ${name} --room <Room> --wallpaper N --floor N --save --mod ${id}`].join('\n') };
    }
    default: throw new Error(`unknown command ${cmd}\n${SDV_HELP}`);
  }
}

// ---- px -----------------------------------------------------------------
export const PX_HELP = `px <cmd> ... (pixel art; PXT = text sprite: palette "<char> #hex", "--", rows; "4k"=kkkk; "@layer name x y" starts a layer)
new <kind|WxH> -o f.png [--pxt]               blank canvas with Stardew size (kind: px spec)
draw <f.pxt|-> -o out.png [--scale n] [--layer a,b] [--hide a,b] [--lock PAL]   PXT -> PNG ("-" = stdin/input)
read <img.png> [--rect x,y,w,h] [--frame fw,fh,i] [--rle]   PNG region -> PXT
layers <f.pxt|-> [-o dir]                     list layers (offset, size, colors); -o: one PNG per layer
ops <in.png|new:WxH> -o out.png "<op; op>" [--lock PAL]   edit (px ops-help: copy/move/copyframe/remap/snap...)
pal <img|texture key|#a,#b> [--top n]         palette on one line (texture key e.g. TileSheets/weapons)
snap <in.png> --pal PAL -o out.png            force colors onto a palette (PAL = like pal)
ramp <#hex> [n]                               hue-shifted shade ramp dark->light
diff <a.png> [b.png] [--frame fw,fh,i,j]      changed pixels between frames/images, grouped by color
onion <sheet.png> --frame fw,fh,i -o out.png  frame i over faint i-1 (red) / i+1 (blue)
frames <img.png>                              guess frame size of a sprite sheet from transparent gaps
preview <img.png> -o out.png [--scale n] [--grid] [--frames fw,fh,i,j,...]
spec [kind] | check <img.png> --as <kind> | slice <img.png> fw fh -o dir | pack -o out.png --cols n f1.png ...
Ingame look: sdv render <map> --region ... --place item.png@x,y`;

// palette spec -> [#hex...]: "#a,#b", image path, or vanilla texture key ("TileSheets/weapons", "weapons")
function resolvePal(spec, top = 32) {
  if (!spec) return null;
  if (/^#/.test(spec)) return spec.split(/[ ,]+/).filter(Boolean);
  let img = null;
  if (fs.existsSync(spec)) img = readPNG(spec);
  else { const key = Object.keys(index().textures).find(k => k === spec || k.split('/').pop() === spec); if (key) img = getImg(key); }
  if (!img) throw new Error(`palette "${spec}" not found (use #hex list, a PNG path or a texture key)`);
  return palette(img).filter(([k]) => k !== 'transparent' && k.length === 7).slice(0, top).map(([k]) => k);
}

export async function px(argv, stdinText) {
  const { pos, fl } = parseArgs(argv);
  const [cmd, ...p] = pos;
  const save = (img, o) => { const png = encodePNG(img); fs.writeFileSync(o, png); return { text: `wrote ${o} ${img.width}x${img.height}${img.warnings ? '\n' + img.warnings.join('\n') : ''}`, image: { path: o, png } }; };
  const up = (img, s) => { if (!s || s === 1) return img; const o = newImg(img.width * s, img.height * s); blit(o, img, 0, 0, img.width, img.height, 0, 0, s); return o; };
  const readText = (a) => { const t = !a || a === '-' ? stdinText : fs.readFileSync(a, 'utf8'); if (!t) throw new Error('no PXT input'); return t; };
  const lock = fl.lock ? resolvePal(String(fl.lock), +fl.top || 32) : null;
  const sizeOf = (k) => { if (/^\d+x\d+$/.test(k)) return k.split('x').map(Number); const sp = SPECS[k]; if (!sp) throw new Error(`unknown kind; ${Object.keys(SPECS).join(' ')}`); const sz = { npc: [64, 128], portrait: [128, 192], craftable: [16, 32], crop: [128, 32], tree: [48, 96], fruittree: [48, 80], object: [16, 16], tile: [16, 16], furniture: [16, 32], building: [48, 48], emote: [64, 16], farmer_hat: [20, 80] }; return sz[k] || sp.frame; };
  switch (cmd) {
    case undefined: case 'help': return { text: PX_HELP };
    case 'ops-help': return { text: OPS_HELP };
    case 'spec': return { text: p[0] ? `${p[0]}: frame ${SPECS[p[0]]?.frame.join('x')} - ${SPECS[p[0]]?.note}` : Object.entries(SPECS).map(([k, v]) => `${k}: ${v.frame.join('x')} ${v.note}`).join('\n') };
    case 'draw': {
      const im = parsePxt(readText(p[0])); const o = fl.o || 'out.png';
      let img = im;
      if (fl.layer || fl.hide) {
        const only = fl.layer ? String(fl.layer).split(',') : null, hide = fl.hide ? String(fl.hide).split(',') : [];
        img = flatten(im.layers.map(L => ({ ...L, hidden: L.hidden || (only && !only.includes(L.name)) || hide.includes(L.name) })), im.width, im.height);
        img.warnings = im.warnings;
      }
      let note = '';
      if (lock) { const r = snapToPalette(img, lock); img = Object.assign(r.img, { warnings: img.warnings }); note = `\nlock: ${r.changed} px snapped to palette`; }
      const r = save(img, o); r.text += note + (im.layers.length > 1 ? `\nlayers: ${im.layers.map(L => L.name + (L.hidden ? '(hidden)' : '')).join(',')}` : '');
      if (+fl.scale > 1) { const pv = o.replace(/\.png$/, '') + `@${fl.scale}x.png`; const png = encodePNG(up(img, +fl.scale)); fs.writeFileSync(pv, png); r.text += `\npreview ${pv}`; r.image = { path: pv, png }; }
      return r;
    }
    case 'new': {
      const [w, h] = sizeOf(p[0] || '16x16'), img = newImg(w, h);
      if (fl.pxt) return { text: `pxt ${w}x${h}\n. transparent\n--\n` + Array(h).fill('.'.repeat(w)).join('\n') };
      const r = save(img, fl.o || 'new.png'); if (SPECS[p[0]]) r.text += `\n${SPECS[p[0]].note}`; delete r.image; return r;
    }
    case 'layers': {
      const im = parsePxt(readText(p[0]));
      const lines = im.layers.map(L => `${L.name} @${L.x},${L.y} ${L.img.width}x${L.img.height} ${palette(L.img).length - 1}c${L.hidden ? ' hidden' : ''}`);
      if (fl.o) { fs.mkdirSync(fl.o, { recursive: true }); for (const L of im.layers) writePNG(path.join(fl.o, L.name + '.png'), flatten([{ ...L, hidden: false }], im.width, im.height)); lines.push(`wrote ${im.layers.length} PNGs to ${fl.o}/`); }
      return { text: `${im.width}x${im.height}\n` + lines.join('\n') };
    }
    case 'pal': return { text: resolvePal(p.join(' '), +fl.top || 32).join(' ') };
    case 'snap': {
      const r = snapToPalette(loadImgFile(p[0]), resolvePal(String(fl.pal), +fl.top || 32));
      const out = save(r.img, fl.o || 'snapped.png'); out.text += `\n${r.changed} px changed`; return out;
    }
    case 'ramp': return { text: ramp(p[0], +p[1] || 5).join(' ') };
    case 'diff': {
      let A = loadImgFile(p[0]), B = p[1] ? loadImgFile(p[1]) : A, ra, rb;
      if (fl.frame) { const [fw, fh, i, j] = nums(fl.frame), cols = Math.floor(A.width / fw); ra = [(i % cols) * fw, Math.floor(i / cols) * fh, fw, fh]; rb = [(j % cols) * fw, Math.floor(j / cols) * fh]; }
      else { if (!p[1]) throw new Error('diff needs two images or --frame fw,fh,i,j'); ra = [0, 0, Math.min(A.width, B.width), Math.min(A.height, B.height)]; rb = [0, 0]; }
      const ch = frameDiff(A, ra, B, rb);
      if (!ch.length) return { text: 'identical' };
      const by = {}; for (const [x, y, c] of ch) (by[c] ||= []).push(`${x},${y}`);
      return { text: `${ch.length} px differ (coords relative to frame):\n` + Object.entries(by).map(([c, xs]) => `${c}: ${xs.join(' ')}`).join('\n') };
    }
    case 'frames': { // guess sprite-sheet frame size from fully transparent gaps (rows and columns)
      const im = loadImgFile(p[0]);
      const axis = (len, other, at) => { const used = []; for (let a = 0; a < len; a++) { let u = 0; for (let b = 0; b < other && !u; b++) if (at(a, b)) u = 1; used.push(u); }
        const runs = []; let s0 = null; used.forEach((u, a) => { if (u && s0 === null) s0 = a; if (!u && s0 !== null) { runs.push([s0, a - 1]); s0 = null; } }); if (s0 !== null) runs.push([s0, len - 1]);
        const sizes = []; for (let n = 1; n <= Math.min(64, len); n++) { if (len % n) continue; const w = len / n; if (runs.every(([x0, x1]) => Math.floor(x0 / w) === Math.floor(x1 / w))) sizes.push(w); }
        return { runs: runs.length, sizes }; };
      const A = (x, y) => im.data[(y * im.width + x) * 4 + 3] > 0;
      const cx = axis(im.width, im.height, (x, y) => A(x, y)), cy = axis(im.height, im.width, (y, x) => A(x, y));
      const pick = (c) => c.sizes.filter(w => w >= 8).sort((a, b) => a - b)[0] ?? c.sizes[c.sizes.length - 1];
      const fw = pick(cx), fh = pick(cy);
      const conv = Object.entries(SPECS).filter(([, v]) => im.width % v.frame[0] === 0 && im.height % v.frame[1] === 0 && (v.cols ? im.width === v.frame[0] * v.cols : true) && v.frame[0] * v.frame[1] > 16 * 16)
        .map(([k, v]) => `${k} ${v.frame.join('x')}`).slice(0, 4);
      return { text: `${im.width}x${im.height}: ${cx.runs} column groups, ${cy.runs} row groups${conv.length ? `\nStardew conventions that fit: ${conv.join(', ')} (frames touching each other can't be split by gaps)` : ''}\nlikely frame ${fw}x${fh} -> ${im.width / fw}x${im.height / fh} = ${(im.width / fw) * (im.height / fh)} frames (other widths: ${cx.sizes.filter(w => w !== fw).slice(-4).join(',') || '-'})\nuse: --frame ${fw},${fh},i  |  sdv render --place file.png@x,y@${fw},${fh},i` };
    }
    case 'onion': {
      const [fw, fh, i] = nums(fl.frame || '16,32,0');
      return save(up(onion(loadImgFile(p[0]), fw, fh, i), +fl.scale || 8), fl.o || 'onion.png');
    }
    case 'read': {
      const img = loadImgFile(p[0]);
      let rect = fl.rect ? nums(fl.rect) : null;
      if (fl.frame) { const [fw, fh, i] = nums(fl.frame), cols = Math.floor(img.width / fw); rect = [(i % cols) * fw, Math.floor(i / cols) * fh, fw, fh]; }
      if (!rect && img.width * img.height > 64 * 64) return { text: `${img.width}x${img.height} is large; pass --rect or --frame (e.g. --frame 16,32,0)` };
      return { text: toPxt(img, { rect, rle: !!fl.rle }) };
    }
    case 'ops': {
      let img;
      if (/^new:/.test(p[0])) { const [w, h] = nums(p[0].slice(4)); img = newImg(w, h); } else img = loadImgFile(p[0]);
      const script = p.slice(1).join(' ') || stdinText || '';
      const res = applyOps(img, script, { loadImg: loadImgFile, lockPal: lock });
      const r = save(res, fl.o || 'out.png'); if (lock) r.text += `\nlock: ${res.snapped} px snapped`; return r;
    }
    case 'palette': {
      const img = loadImgFile(p[0]);
      const pal = palette(img, fl.rect ? nums(fl.rect) : null).slice(0, +fl.top || 32);
      if (fl.line) return { text: pal.filter(([k]) => k !== 'transparent').map(([k]) => k).join(' ') };
      return { text: pal.map(([k, n]) => `${k} ${n}`).join('\n') };
    }
    case 'preview': {
      const img = loadImgFile(p[0]); const s = +fl.scale || 6;
      let src = img;
      if (fl.frames) { const [fw, fh, ...idx] = nums(fl.frames); src = strip(img, fw, fh, idx); }
      const out = up(src, s);
      if (fl.grid) for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) { fillRect(out, x * s, y * s, s, 1, [0, 0, 0, 40]); fillRect(out, x * s, y * s, 1, s, [0, 0, 0, 40]); }
      return save(out, fl.o || 'preview.png');
    }
    case 'check': {
      const img = loadImgFile(p[0]);
      return { text: `${img.width}x${img.height}\n` + checkSprite(img, fl.as || 'npc').join('\n') };
    }
    case 'slice': {
      const img = loadImgFile(p[0]); const fw = +p[1], fh = +p[2], dir = fl.o || 'frames';
      fs.mkdirSync(dir, { recursive: true });
      const cols = Math.floor(img.width / fw), rows = Math.floor(img.height / fh);
      for (let i = 0; i < cols * rows; i++) { const f = newImg(fw, fh); blit(f, img, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh, 0, 0); writePNG(path.join(dir, `${i}.png`), f); }
      return { text: `wrote ${cols * rows} frames to ${dir}/` };
    }
    case 'pack': {
      const imgs = p.map(loadImgFile), cols = +fl.cols || 4, fw = Math.max(...imgs.map(i => i.width)), fh = Math.max(...imgs.map(i => i.height));
      const out = newImg(cols * fw, Math.ceil(imgs.length / cols) * fh);
      imgs.forEach((im, i) => blit(out, im, 0, 0, im.width, im.height, (i % cols) * fw, Math.floor(i / cols) * fh));
      return save(out, fl.o || 'sheet.png');
    }
    default: throw new Error(`unknown command ${cmd}\n${PX_HELP}`);
  }
}
