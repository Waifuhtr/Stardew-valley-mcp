// Shared command layer for the `sdv` / `px` CLIs and the MCP server. Every command returns
// {text, image?:{path,png(Buffer)}} and keeps text output small (token budget matters).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readPNG, writePNG, encodePNG } from '../lib/png.mjs';
import { GameMap, findPath, pathToMoves, pathToWarp } from '../web/core/map.mjs';
import { applyPatch, newProblems } from '../web/core/patch.mjs';
import { asciiMap, LEGEND } from '../web/core/ascii.mjs';
import { route, incoming, mapOf, isVariant } from '../web/core/world.mjs';
import { renderMap, SEASONS } from '../web/core/render.mjs';
import { tmxToJson, mapToTmx } from '../web/core/tmx.mjs';
import { checkMap, checkFootprint, nearestWalkable, connectivityDiff } from '../web/core/check.mjs';
import { parsePxt, toPxt, toLayeredPxt, flatten, applyOps, palette, checkSprite, SPECS, OPS_HELP, strip, snapToPalette, ramp, frameDiff, onion } from '../web/core/pixel.mjs';
import { newImg, blit, text as drawText, fillRect } from '../web/core/raster.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = process.env.SDV_DATA || path.join(ROOT, 'web/data');
let INDEX = null;
const index = () => (INDEX ||= JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8')));
const mapCache = new Map(), imgCache = new Map();

export function loadMap(name) {
  if (!name) throw new Error('map name required (try: sdv maps)');
  if (/\.(tmx|json)$/i.test(name)) throw new Error('use await loadAnyMap for files');
  const n = mapOf(name, index().maps);
  if (!index().maps[n]) {
    const low = n.toLowerCase(), hit = Object.keys(index().maps).find(k => k.toLowerCase() === low);
    if (!hit) throw new Error(`unknown map "${name}". Close: ${Object.keys(index().maps).filter(k => k.toLowerCase().includes(low.slice(0, 4))).slice(0, 8).join(' ')}`);
    return loadMap(hit);
  }
  if (!mapCache.has(n)) mapCache.set(n, new GameMap(JSON.parse(fs.readFileSync(path.join(DATA, 'maps', n + '.json'), 'utf8'))));
  return mapCache.get(n);
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
function getImg(key) {
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
ascii <map> [x y w h] [--step n] [--at x,y] [--no-ruler]   ${LEGEND}
tile <map> x y                     layers/tile index/properties at tile
path <map> x1 y1 x2 y2 [--ascii]   A* walk (moves like "R5 D3")
go <map> x y <target> [tx ty]      multi-map walk through doors/warps
route <from> <to>                  location hops
find <text>                        search warps/actions/props in all maps
render <map|file.tmx> [-o f.png] [--region x,y,w,h] [--scale n] [--season s] [--actor x,y[,dir]] [--sprite f.png] [--place img.png@x,y;...] [--grid] [--pass] [--path x1,y1,x2,y2]
sheet <img> [--idx i] [-o f.png --grid]   tilesheet info / index grid image
tmx <map> -o f.tmx                 export vanilla map to Tiled TMX (mod template)
check <file.tmx|map> [--locs A,B]  validate a custom map (layers, sheets, warps, connectivity)
fit <map> x y w h [--door x,y]     can a w*h structure go here? (blocking, cut paths, door reachability)
patch <map> <patch.tmx> x y [--mode Replace] [-o f.png]   EditMap preview: apply, check, render area`;

export async function sdv(argv) {
  const { pos, fl } = parseArgs(argv);
  const [cmd, ...p] = pos;
  const ix = index();
  switch (cmd) {
    case undefined: case 'help': return { text: SDV_HELP };
    case 'maps': {
      const f = (p[0] || '').toLowerCase();
      return { text: Object.entries(ix.maps).filter(([k]) => k.toLowerCase().includes(f)).map(([k, v]) => `${k} ${v.w}x${v.h}${v.out ? ' o' : ''}`).join('\n') };
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
      if (fl.place) for (const spec of String(fl.place).split(';')) { // file.png@x,y : bottom-left of image on tile x,y
        const [f, xy] = spec.split('@'), [px, py] = nums(xy), im = loadImgFile(f);
        actors.push({ img: im, x: px + (im.width / 16 - 1) / 2, y: py, fw: im.width, fh: im.height });
      }
      let marks = [];
      if (fl.path) { const [a, b, c, d] = nums(fl.path); const pt = findPath(m, a, b, c, d); if (pt) marks = pt.map(([x, y]) => [x, y, [255, 230, 0, 150]]); }
      const season = SEASONS.includes(fl.season) ? fl.season : 'spring';
      const img = renderMap(m, { getImg, textures: ix.textures, season, region, scale: +fl.scale || 1, actors, grid: !!fl.grid, overlay: fl.pass ? 'pass' : null, marks });
      const o = fl.o || path.join(process.env.TMPDIR || '/tmp', `sdv-${m.name.replace(/\W/g, '_')}.png`);
      const png = encodePNG(img); fs.writeFileSync(o, png);
      return { text: `wrote ${o} ${img.width}x${img.height}`, image: { path: o, png } };
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
      const m = applyPatch(base, pm, x, y, fl.mode || 'ReplaceByLayer');
      const lm = (n) => { try { return loadMap(n); } catch { return null; } };
      const r = newProblems(checkMap(base, { index: ix, loadMap: lm }), checkMap(m, { index: ix, loadMap: lm }));
      const cd = connectivityDiff(base, m);
      if (cd.lostWarps.length) r.errors.push(`warps cut off from the main area: ${cd.lostWarps.join(' ')}`);
      if (cd.lostTiles) r.warnings.push(`${cd.lostTiles} walkable tiles became unreachable (enclosed area)`);
      const o = fl.o || path.join(process.env.TMPDIR || '/tmp', `sdv-patch-${base.name}.png`);
      const pad = 4, region = [Math.max(0, x - pad), Math.max(0, y - pad), Math.min(m.w - Math.max(0, x - pad), pm.w + pad * 2), Math.min(m.h - Math.max(0, y - pad), pm.h + pad * 2)];
      const img = renderMap(m, { getImg, textures: ix.textures, season: fl.season || 'spring', region, scale: +fl.scale || 1, overlay: fl.pass ? 'pass' : null });
      const png = encodePNG(img); fs.writeFileSync(o, png);
      return { text: [`patched ${base.name} with ${pm.name} ${pm.w}x${pm.h} at ${x},${y}`,
        before.warpsIn.length ? `W covers vanilla warps: ${before.warpsIn.map(fmtW).join('; ')}` : '',
        before.actions.length ? `W covers vanilla actions: ${before.actions.map(a => `${a[0]},${a[1]} ${a[3]}`).join('; ')}` : '',
        ...r.errors.map(e => 'E ' + e), ...r.warnings.map(e => 'W ' + e),
        Object.keys(pm.props).length ? `i patch map properties not copied (use CP MapProperties/AddWarps): ${Object.keys(pm.props).join(',')}` : '',
        asciiMap(m, { x: region[0], y: region[1], w: region[2], h: region[3] }), `wrote ${o}`].filter(Boolean).join('\n'), image: { path: o, png } };
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
