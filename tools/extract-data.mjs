#!/usr/bin/env node
// Usage: node tools/extract-data.mjs <dir with Furniture.xnb, ChairTiles.xnb, AdditionalWallpaperFlooring.xnb, Strings/Furniture*.xnb> [outDir=web/data]
// Builds web/data/furniture.json: furniture catalog (EN+TR names, type, sizes, rotations, texture/sprite), map seats, wallpaper/floor sets.
import fs from 'node:fs';
import path from 'node:path';
import { readXnbData } from '../lib/xnb.mjs';
import { parseFurniture } from '../web/core/furniture.mjs';

const src = process.argv[2], out = process.argv[3] || path.join(path.dirname(new URL(import.meta.url).pathname), '../web/data');
if (!src) { console.error('usage: extract-data.mjs <dir> [outDir]'); process.exit(1); }
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(src);
const find = (re) => files.find(f => re.test(f.replace(/\\/g, '/')));
const load = (re) => { const f = find(re); return f ? readXnbData(fs.readFileSync(f)) : null; };

const names = load(/(^|\/)(Strings|string)\/Furniture\.xnb$/i) || {};
const namesTr = load(/(^|\/)(Strings|string)\/Furniture\.tr-TR\.xnb$/i) || {};
const furn = load(/(^|\/)(Data\/)?Furniture\.xnb$/i);
const chairs = load(/ChairTiles\.xnb$/i) || {};
const extra = load(/AdditionalWallpaperFlooring\.xnb$/i) || [];
if (!furn) throw new Error('Furniture.xnb not found');

const items = {};
const idx = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
for (const [id, line] of Object.entries(furn)) { const f = items[id] = parseFurniture(id, line, names, namesTr); if (idx.textures[f.tex]) f.tw = idx.textures[f.tex][0]; }
const missingTex = [...new Set(Object.values(items).map(f => f.tex))].filter(t => !idx.textures[t]);
const data = { version: 1, items, chairTiles: chairs,
  wallpaper: [{ Id: '', Texture: 'Maps/walls_and_floors', Count: 112 }, ...extra.filter(e => !e.IsFlooring)],
  flooring: [{ Id: '', Texture: 'Maps/walls_and_floors', Count: 56 }, ...extra.filter(e => e.IsFlooring)] };
fs.writeFileSync(path.join(out, 'furniture.json'), JSON.stringify(data));
console.log(`furniture: ${Object.keys(items).length}, seats on maps: ${Object.keys(chairs).length}, extra sets: ${extra.map(e => e.Id).join(',')}`);
if (missingTex.length) console.log('missing textures:', missingTex.join(' '));
