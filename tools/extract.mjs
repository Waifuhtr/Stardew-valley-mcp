#!/usr/bin/env node
// Usage: node tools/extract.mjs <Content dir: Android LZ4/uncompressed .xnb, or StardewXnbHack-unpacked .tmx/.png> [outDir=web/data]
// Converts XNB textures -> PNG and xTile maps -> compact JSON + index.json (warp graph).
import fs from 'node:fs';
import path from 'node:path';
import { readXnb } from '../lib/xnb.mjs';
import { writePNG, readPNG } from '../lib/png.mjs';
import zlib from 'node:zlib';
import { mapWarps } from '../web/core/world.mjs';
import { tmxToJson } from '../web/core/tmx.mjs';

const src = process.argv[2];
const out = process.argv[3] || path.join(path.dirname(new URL(import.meta.url).pathname), '../web/data');
if (!src) { console.error('usage: extract.mjs <contentDir> [outDir]'); process.exit(1); }

const LOCALE = /\.[a-z]{2}-[A-Z]{2}$|_international$/;
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(src);

const textures = {}, maps = {}, tmxFiles = [];
for (const f of files) {
  const rel = path.relative(src, f).replace(/\\/g, '/');
  if (rel.endsWith('.png') && rel.includes('/') && !LOCALE.test(rel.slice(0, -4))) { // unpacked game texture (StardewXnbHack output)
    const key = rel.slice(0, -4), dst = path.join(out, 'img', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(f, dst);
    const im = readPNG(f); textures[key] = [im.width, im.height];
    continue;
  }
  if (rel.endsWith('.tmx')) { tmxFiles.push([rel, f]); continue; }
  if (rel.endsWith('.png')) { // loose PNGs at the root (custom sprites/portraits) go to img/extra
    const dst = path.join(out, 'img/extra', path.basename(rel));
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(f, dst);
    const im = readPNG(f); textures['extra/' + path.basename(rel, '.png')] = [im.width, im.height];
    continue;
  }
  if (!rel.endsWith('.xnb')) continue;
  const key = rel.slice(0, -4);
  if (LOCALE.test(key)) continue;
  let x;
  try { x = readXnb(fs.readFileSync(f)); } catch (e) { console.warn('skip', rel, e.message); continue; }
  if (x.type === 'texture') {
    const dst = path.join(out, 'img', key + '.png');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    writePNG(dst, x);
    textures[key] = [x.width, x.height];
  } else if (x.type === 'map') maps[key] = x;
}

// unpacked .tmx maps (PC: StardewXnbHack) -> same shape as tbin maps
for (const [rel, f] of tmxFiles) {
  if (LOCALE.test(rel.slice(0, -4))) continue;
  const { json } = await tmxToJson(fs.readFileSync(f, 'utf8'), { name: rel.slice(0, -4).replace(/^Maps\//, ''), textures, inflate: async (b, k) => new Uint8Array(k === 'gzip' ? zlib.gunzipSync(b) : zlib.inflateSync(b)) });
  json.fromTmx = true; maps[rel.slice(0, -4)] = json;
}

// resolve an xTile image source (relative to the map's folder) to a texture key
function resolveImg(mapKey, img) {
  img = img.replace(/\\/g, '/');
  const dir = path.posix.dirname(mapKey);
  const cands = [path.posix.normalize(path.posix.join(dir, img)), path.posix.normalize('Maps/' + img), img];
  for (const c of cands) if (textures[c.replace(/\.png$/, '')]) return c.replace(/\.png$/, '');
  const base = path.posix.basename(img);
  return Object.keys(textures).find(k => path.posix.basename(k) === base) || null;
}

const index = { version: 1, maps: {}, textures, missing: {} };
fs.mkdirSync(path.join(out, 'maps'), { recursive: true });
for (const [key, m] of Object.entries(maps)) {
  const name = key.replace(/^Maps\//, '');
  if (m.fromTmx) {
    delete m.fromTmx;
    for (const s of m.sheets) if (s.missing) (index.missing[s.img] ||= []).push(name);
    const dst = path.join(out, 'maps', name + '.json');
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, JSON.stringify(m));
    index.maps[name] = { w: m.w, h: m.h, out: m.props.Outdoors ? 1 : 0, warps: mapWarps(m) };
    continue;
  }
  let gid = 1;
  const sheets = m.sheets.map(s => {
    const img = resolveImg(key, s.image);
    if (!img) (index.missing[s.image] ||= []).push(name);
    const tp = {};
    for (const [k, v] of Object.entries(s.props)) {
      const mm = /^@TileIndex@(\d+)@(.+)$/.exec(k);
      if (mm) (tp[mm[1]] ||= {})[mm[2]] = v;
    }
    const sh = { id: s.id, img: img || s.image, cols: s.cols, rows: s.rows, first: gid, tp };
    if (!img) sh.missing = true;
    gid += s.cols * s.rows;
    return sh;
  });
  if (gid > 65535) throw new Error('gid overflow in ' + name);
  const sid = Object.fromEntries(sheets.map(s => [s.id, s]));
  const toGid = (s, i) => sid[s].first + i;
  const layers = [], anim = {}, tp = {};
  for (const L of m.layers) {
    const arr = new Uint16Array(L.w * L.h);
    L.tiles.forEach((t, i) => {
      if (!t) return;
      arr[i] = toGid(t.s, t.i);
      const xy = `${i % L.w},${Math.floor(i / L.w)}`;
      if (t.anim) (anim[L.id] ||= {})[xy] = [t.anim.interval, t.anim.frames.map(([s, i]) => toGid(s, i))];
      if (Object.keys(t.p).length) (tp[L.id] ||= {})[xy] = t.p;
    });
    layers.push({ id: L.id, vis: L.visible, data: Buffer.from(arr.buffer).toString('base64') });
  }
  const j = { name, w: m.layers[0]?.w || 0, h: m.layers[0]?.h || 0, props: m.props, sheets, layers, anim, tp };
  const dst = path.join(out, 'maps', name + '.json');
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, JSON.stringify(j));
  index.maps[name] = { w: j.w, h: j.h, out: m.props.Outdoors ? 1 : 0, warps: mapWarps(j) };
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index));
console.log(`maps: ${Object.keys(maps).length}, textures: ${Object.keys(textures).length}`);
if (Object.keys(index.missing).length) console.log('missing tilesheet images:', JSON.stringify(index.missing));
