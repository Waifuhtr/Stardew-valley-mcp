#!/usr/bin/env node
// Import furniture content packs into the simulator catalog.
// Usage: node tools/import-mods.mjs <folder with mod folders (manifest.json)> [outDataDir=web/data]
//  - Content Patcher packs: Load (incl. comma targets, {{TargetWithoutPath}}), Include, EditData Data/Furniture,
//    tokens {{ModId}} / {{i18n:key}} (default + tr), framework extras: sophie.Calcifer/FurnitureActions,
//    mushymato.MMAP/FurnitureProperties, spacechase0.SpaceCore/TextureOverrides (recorded, not required)
//  - Alternative Textures packs: furniture skins + wallpaper/flooring sets
// Output (kept out of git — third-party art): <out>/thirdparty/furniture.json and <out>/img/thirdparty/<mod>/*.png
import fs from 'node:fs';
import path from 'node:path';
import { parseFurniture } from '../web/core/furniture.mjs';
import { readPNG } from '../lib/png.mjs';

const src = process.argv[2], out = process.argv[3] || path.join(path.dirname(new URL(import.meta.url).pathname), '../web/data');
if (!src) { console.error('usage: import-mods.mjs <modsDir> [outDataDir]'); process.exit(1); }

const json5 = (file) => {
  let s = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  s = s.replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m, str) => str || '');
  s = s.replace(/([\[{])\s*,/g, '$1').replace(/,(\s*,)+/g, ',').replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(s);
};
const manifests = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.toLowerCase() === 'manifest.json') manifests.push(p); } })(src);

const cat = { mods: [], items: {}, actions: {}, props: {}, anims: {}, skins: {}, wallpaper: [], flooring: [] };
const imgDir = (id) => { const d = path.join(out, 'img/thirdparty', id.replace(/[^\w.-]/g, '_')); fs.mkdirSync(d, { recursive: true }); return d; };
const keyOf = (id, file) => `thirdparty/${id.replace(/[^\w.-]/g, '_')}/${file}`;
// case-insensitive path resolve (packs are authored on Windows/Android where case doesn't matter)
function ci(p) {
  if (fs.existsSync(p)) return p;
  const parts = path.resolve(p).split(path.sep); let cur = parts[0] || path.sep;
  for (const part of parts.slice(1)) {
    if (!part) continue;
    const hit = fs.existsSync(cur) && fs.statSync(cur).isDirectory() ? fs.readdirSync(cur).find(f => f.toLowerCase() === part.toLowerCase()) : null;
    if (!hit) return p; cur = path.join(cur, hit);
  }
  return cur;
}
const norm = (a) => a.replace(/\\+/g, '/').toLowerCase();

for (const mf of manifests) {
  const dir = path.dirname(mf), man = json5(mf), id = man.UniqueID, pack = man.ContentPackFor?.UniqueID || '';
  if (/ContentPatcher/i.test(pack)) importCP(dir, man);
  else if (/AlternativeTextures/i.test(pack)) importAT(dir, man);
  else continue;
  cat.mods.push({ id, name: man.Name, author: man.Author, version: man.Version, kind: /ContentPatcher/i.test(pack) ? 'CP' : 'AT', nexus: (man.UpdateKeys || []).join(' ') || undefined });
}

function importCP(dir, man) {
  const id = man.UniqueID;
  const i18n = (lang) => { const f = path.join(dir, 'i18n', lang + '.json'); return fs.existsSync(f) ? json5(f) : {}; };
  const en = i18n('default'), tr = i18n('tr');
  const tok = (s, extra = {}, lang = en) => String(s).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, t) => {
    if (/^ModId$/i.test(t)) return id;
    const k = /^i18n\s*:\s*(.+)$/i.exec(t); if (k) return lang[k[1]] ?? en[k[1]] ?? k[1];
    return extra[t] ?? m;
  });
  const assets = {}; // normalized asset name -> file
  const furn = {}, when = {};
  const visit = (file, cond) => {
    const j = json5(file);
    for (const ch of j.Changes || []) {
      const c = ch.When ? Object.entries(ch.When).map(([k, v]) => `${k}=${v}`).join(';') : cond;
      if (ch.Action === 'Include') for (const f of String(ch.FromFile).split(',')) visit(ci(path.join(dir, tok(f.trim()))), c);
      else if (ch.Action === 'Load') for (const t of String(tok(ch.Target)).split(',').map(x => x.trim()).filter(Boolean)) {
        const tw = t.split(/[\\/]/).pop(), from = ci(path.join(dir, tok(ch.FromFile, { TargetWithoutPath: tw, Target: t, TargetPathOnly: t.split(/[\\/]/).slice(0, -1).join('/') })));
        if (fs.existsSync(from) && /\.png$/i.test(from)) assets[norm(t)] = from;
      } else if (ch.Action === 'EditData') {
        const target = norm(tok(ch.Target));
        for (const [k0, v] of Object.entries(ch.Entries || {})) {
          const k = tok(k0);
          if (target === 'data/furniture' && typeof v === 'string') { furn[k] = { en: tok(v), tr: tok(v, {}, tr) }; when[k] = c; }
          else if (target === 'sophie.calcifer/furnitureactions') cat.actions[k.replace(/^\(F\)/, '')] = (v.TileActions || []).map(a => a.TileAction).filter(Boolean);
          else if (target === 'mushymato.mmap/furnitureproperties') cat.props[k] = { ...(cat.props[k] || {}), ...v.CustomFields };
          else if (target === 'spacechase0.spacecore/textureoverrides') cat.anims[norm(tok(v.TargetTexture))] = { rect: v.TargetRect, source: tok(v.SourceTexture) };
        }
      }
    }
  };
  visit(path.join(dir, 'content.json'));
  const copied = {};
  const texKey = (asset) => {
    const a = norm(asset); if (copied[a] !== undefined) return copied[a];
    const f = assets[a]; if (!f) return (copied[a] = null);
    const name = a.split('/').pop().replace(/[^\w.-]/g, '_') + '.png';
    fs.copyFileSync(f, path.join(imgDir(id), name));
    const front = assets[a + 'front']; // optional seat front sprite -> same key + "Front"
    if (front) fs.copyFileSync(front, path.join(imgDir(id), name.replace(/\.png$/, 'Front.png')));
    return (copied[a] = keyOf(id, name.replace(/\.png$/, '')));
  };
  let n = 0;
  for (const [k, { en: line, tr: trLine }] of Object.entries(furn)) {
    const f = parseFurniture(k, line);
    const p = line.split('/'), tp = trLine.split('/');
    f.n = p[7] || p[0]; if (tp[7] && tp[7] !== p[7]) f.tr = tp[7]; else delete f.tr;
    const asset = (p[9] || '').trim();
    const key = asset ? texKey(asset) : null;
    if (asset && !key) { console.warn(`  ${id}: ${k} texture ${asset} not found`); continue; }
    if (key) {
      f.tex = key; const im = readPNG(path.join(out, 'img', key + '.png')); f.tw = im.width;
    }
    f.mod = id; if (when[k]) f.needs = when[k];
    cat.items[k] = f; n++;
  }
  console.log(`CP ${man.Name}: ${n} furniture, ${Object.keys(assets).length} textures`);
}

function importAT(dir, man) {
  const id = man.UniqueID, tdir = path.join(dir, 'Textures'); let n = 0;
  if (!fs.existsSync(tdir)) return;
  for (const t of fs.readdirSync(tdir)) {
    const tj = path.join(tdir, t, 'texture.json'); if (!fs.existsSync(tj)) continue;
    const j = json5(tj), files = fs.readdirSync(path.join(tdir, t)).filter(f => /^texture(_\d+)?\.png$/i.test(f)).sort((a, b) => (+(/_(\d+)/.exec(a)?.[1] ?? -1)) - (+(/_(\d+)/.exec(b)?.[1] ?? -1)));
    const keys = files.map(f => { const name = `${t}_${f}`.replace(/[^\w.-]/g, '_'); fs.copyFileSync(path.join(tdir, t, f), path.join(imgDir(id), name)); return keyOf(id, name.replace(/\.png$/i, '')); });
    const target = j.ItemId || j.ItemName, type = j.Type;
    const variations = j.ManualVariations ? j.ManualVariations.map(v => ({ id: v.Id, name: v.Name })) : Array.from({ length: j.Variations || 1 }, (_, i) => ({ id: i }));
    if (type === 'Decoration' && /wallpaper|floor/i.test(target)) {
      const isF = /floor/i.test(target), ent = { Id: `AT.${id}`, Texture: keys[0], Count: variations.length, IsFlooring: isF, mod: id, names: variations.map(v => v.name) };
      (isF ? cat.flooring : cat.wallpaper).push(ent); n++; continue;
    }
    (cat.skins[target] ||= []).push({ mod: id, w: j.TextureWidth, h: j.TextureHeight, files: keys, single: files.length === 1 && /^texture\.png$/i.test(files[0]), variations, anim: !!j.ManualVariations?.some(v => v.Animation) || undefined });
    n++;
  }
  console.log(`AT ${man.Name}: ${n} texture sets`);
}

fs.mkdirSync(path.join(out, 'thirdparty'), { recursive: true });
cat.textures = {};
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.png$/i.test(f)) { const im = readPNG(p); cat.textures[path.relative(path.join(out, 'img'), p).replace(/\\/g, '/').replace(/\.png$/i, '')] = [im.width, im.height]; } } })(path.join(out, 'img/thirdparty'));
// skins may target items by display name (vanilla "China Cabinet") or id
fs.writeFileSync(path.join(out, 'thirdparty/furniture.json'), JSON.stringify(cat));
console.log(`total: ${Object.keys(cat.items).length} modded furniture, ${Object.keys(cat.skins).length} skinned items, ${Object.keys(cat.actions).length} actions, wallpaper sets ${cat.wallpaper.length}`);
