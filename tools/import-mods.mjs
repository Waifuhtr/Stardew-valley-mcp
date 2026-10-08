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
import { readPNG, writePNG } from '../lib/png.mjs';

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

const cat = { mods: [], items: {}, actions: {}, props: {}, anims: {}, skins: {}, wallpaper: [], flooring: [], buildings: {}, maps: {} };
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
  const i18n = (lang) => { const f = ci(path.join(dir, 'i18n', lang + '.json')); return fs.existsSync(f) ? json5(f) : {}; };
  const en = i18n('default'), tr = i18n('tr');
  const root = json5(path.join(dir, 'content.json'));
  // config tokens use their schema defaults (what a fresh install shows)
  const config = Object.fromEntries(Object.entries(root.ConfigSchema || {}).map(([k, v]) => [k.toLowerCase(), String(v.Default ?? (v.AllowValues || '').split(',')[0] ?? '').trim()]));
  for (const t of root.DynamicTokens || []) if (!t.When && t.Name && t.Value != null) config[t.Name.toLowerCase()] ??= String(t.Value);
  // innermost tokens first: "{{i18n: {{BUILDING_NAME}}.name}}"
  const tok = (s, extra = {}, lang = en) => { let cur = String(s), prev; do { prev = cur; cur = tok1(cur, extra, lang); } while (cur !== prev && /\{\{/.test(cur)); return cur; };
  const tok1 = (s, extra, lang) => String(s).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, t0) => {
    const t = t0.trim();
    if (/^ModId$/i.test(t)) return id;
    const k = /^i18n\s*:\s*(.+)$/i.exec(t); if (k) { const key = tok(k[1], extra, lang).trim(); return lang[key] ?? en[key] ?? key; }
    if (extra[t] != null) return extra[t];
    if (config[t.toLowerCase()] != null) return config[t.toLowerCase()];
    return m;
  });
  // When: config tokens are evaluated with defaults; HasMod/Query/unknown tokens are assumed true (recorded as needs)
  const whenOk = (when, extra) => Object.entries(when || {}).every(([k0, v]) => {
    const k = tok(k0, extra), m = /^\s*([\w.]+)\s*:?\s*(?:\|\s*contains\s*=\s*(.+))?$/i.exec(k);
    if (!m) return true;
    const name = m[1].toLowerCase();
    if (name === 'hasmod' || name === 'query' || config[name] == null) return true;
    const cur = config[name].toLowerCase().split(',').map(x => x.trim());
    if (m[2] != null) { const any = m[2].split(',').some(x => cur.includes(x.trim().toLowerCase())); return String(v).toLowerCase() === String(any); }
    return String(tok(String(v), extra)).toLowerCase().split(',').map(x => x.trim()).some(x => cur.includes(x));
  });
  const needsOf = (when, extra) => Object.entries(when || {}).filter(([k]) => /hasmod/i.test(k)).map(([k, v]) => `${tok(k, extra)}=${v}`).join(';');
  const assets = {}; // normalized asset name -> file
  const furn = {}, when = {}, edits = [];
  const visit = (file, cond, extra = {}) => {
    if (!fs.existsSync(file)) { console.warn(`  ${id}: missing ${path.relative(dir, file)}`); return; }
    const j = json5(file);
    for (const ch of j.Changes || []) {
      if (ch.When && !whenOk(ch.When, extra)) continue;
      const c = needsOf(ch.When, extra) || cond, ex = { ...extra, ...Object.fromEntries(Object.entries(ch.LocalTokens || {}).map(([k, v]) => [k, tok(v, extra)])) };
      if (ch.Action === 'Include') for (const f of String(tok(ch.FromFile, ex)).split(',')) visit(ci(path.join(dir, f.trim())), c, ex);
      else if (ch.Action === 'Load') for (const t of String(tok(ch.Target, ex)).split(',').map(x => x.trim()).filter(Boolean)) {
        const tw = t.split(/[\\/]/).pop(), from = ci(path.join(dir, tok(ch.FromFile, { ...ex, TargetWithoutPath: tw, Target: t, TargetPathOnly: t.split(/[\\/]/).slice(0, -1).join('/') })));
        if (fs.existsSync(from) && /\.png$/i.test(from)) assets[norm(t)] = from;
        else if (fs.existsSync(from) && /\.tmx$/i.test(from)) (cat.maps ||= {})[t.replace(/^Maps[\\/]/i, '')] = { mod: id, file: from };
      } else if (ch.Action === 'EditImage') {
        for (const t of String(tok(ch.Target, ex)).split(',').map(x => x.trim()).filter(Boolean)) edits.push({ target: norm(t), from: ci(path.join(dir, tok(ch.FromFile, ex))), from_area: ch.FromArea, to: ch.ToArea, mode: ch.PatchMode || 'Replace' });
      } else if (ch.Action === 'EditData') {
        const target = norm(tok(ch.Target, ex));
        const entries = Array.isArray(ch.Entries) ? Object.fromEntries(ch.Entries.map((e, i) => [e.ID || e.Id || i, e])) : ch.Entries || {};
        if (target === 'data/buildings' && ch.TargetField) { // e.g. [bldId, "IndoorItems"]
          const [bid, field] = ch.TargetField.map(x => tok(x, ex)); ((cat.buildingExtra ||= {})[bid] ||= {})[field] = Object.values(entries); continue;
        }
        for (const [k0, v0] of Object.entries(entries)) {
          const k = tok(k0, ex), v = typeof v0 === 'string' ? v0 : JSON.parse(tok(JSON.stringify(v0), ex));
          if (target === 'data/furniture' && typeof v0 === 'string') { furn[k] = { en: tok(v0, ex), tr: tok(v0, ex, tr) }; when[k] = c; }
          else if (target === 'sophie.calcifer/furnitureactions') cat.actions[k.replace(/^\(F\)/, '')] = (v.TileActions || []).map(a => a.TileAction).filter(Boolean);
          else if (target === 'mushymato.mmap/furnitureproperties') cat.props[k] = { ...(cat.props[k] || {}), ...v.CustomFields };
          else if (target === 'spacechase0.spacecore/textureoverrides') cat.anims[norm(v.TargetTexture)] = { rect: v.TargetRect, source: v.SourceTexture };
          else if (target === 'data/additionalwallpaperflooring') awf.push({ Id: v.ID || v.Id || k, Texture: v.Texture, IsFlooring: !!v.IsFlooring, Count: v.Count || 1, mod: id });
          else if (target === 'data/buildings') bld.push({ key: k, v, nameTr: (() => { try { return JSON.parse(tok(JSON.stringify(v0), ex, tr)).Name; } catch { return undefined; } })() });
          else if (target === 'data/machines') (cat.machines ||= {})[k] = { mod: id, outputs: (v.OutputRules || []).length };
        }
      }
    }
  };
  const awf = [], bld = [];
  visit(path.join(dir, 'content.json'));
  // EditImage onto loaded assets (only patches whose When matched the default config)
  const patched = {};
  for (const e of edits) {
    const base = assets[e.target]; if (!base || !fs.existsSync(e.from)) continue;
    const img = patched[e.target] || readPNG(base), src = readPNG(e.from);
    const fa = e.from_area || { X: 0, Y: 0, Width: src.width, Height: src.height }, ta = e.to || { X: 0, Y: 0, Width: fa.Width, Height: fa.Height };
    for (let y = 0; y < ta.Height; y++) for (let x = 0; x < ta.Width; x++) {
      const si = ((fa.Y + y) * src.width + fa.X + x) * 4, di = ((ta.Y + y) * img.width + ta.X + x) * 4;
      if (fa.X + x >= src.width || fa.Y + y >= src.height || ta.X + x >= img.width || ta.Y + y >= img.height) continue;
      if (/overlay/i.test(e.mode) && !src.data[si + 3]) continue;
      img.data.set(src.data.subarray(si, si + 4), di);
    }
    patched[e.target] = img;
  }
  const copied = {};
  const texKey = (asset) => {
    const a = norm(asset); if (copied[a] !== undefined) return copied[a];
    const f = assets[a]; if (!f) return (copied[a] = null);
    const name = a.split('/').pop().replace(/[^\w.-]/g, '_') + '.png';
    if (patched[a]) writePNG(path.join(imgDir(id), name), patched[a]); else fs.copyFileSync(f, path.join(imgDir(id), name));
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
    if (key) { f.tex = key; const im = readPNG(path.join(out, 'img', key + '.png')); f.tw = im.width; }
    f.mod = id; if (when[k]) f.needs = when[k];
    cat.items[k] = f; n++;
  }
  // wallpaper/flooring: Data/AdditionalWallpaperFlooring sets, and full replacements of the vanilla sheet
  for (const w of awf) { const key = texKey(w.Texture); if (!key) continue; (w.IsFlooring ? cat.flooring : cat.wallpaper).push({ ...w, Texture: key }); }
  if (assets['maps/walls_and_floors']) {
    const key = texKey('Maps/walls_and_floors');
    (cat.overrides ||= {})['Maps/walls_and_floors'] = key; // the game shows this instead of the vanilla sheet everywhere
    cat.wallpaper.push({ Id: id, Texture: key, Count: 112, IsFlooring: false, mod: id, replacesVanilla: true });
    cat.flooring.push({ Id: id, Texture: key, Count: 56, IsFlooring: true, startRow: 21, mod: id, replacesVanilla: true });
  }
  for (const { key: k, v, nameTr } of bld) {
    const tex = v.Texture ? texKey(v.Texture) : null;
    cat.buildings ||= {};
    cat.buildings[k] = { id: k, mod: id, n: v.Name, tr: nameTr !== v.Name ? nameTr : undefined, desc: v.Description, size: [v.Size?.X || 1, v.Size?.Y || 1], tex,
      rect: v.SourceRect ? [v.SourceRect.X, v.SourceRect.Y, v.SourceRect.Width, v.SourceRect.Height] : null, indoor: v.IndoorMap || undefined, builder: v.Builder,
      door: v.HumanDoor ? [v.HumanDoor.X, v.HumanDoor.Y] : undefined, skins: (v.Skins || []).map(s => ({ id: s.Id, n: s.Name, tex: s.Texture ? texKey(s.Texture) : null })).filter(s => s.tex),
      items: (cat.buildingExtra?.[k]?.IndoorItems || v.IndoorItems || []).length || undefined };
  }
  console.log(`CP ${man.Name}: ${n} furniture, ${Object.keys(assets).length} textures${awf.length ? `, ${awf.length} wallpaper/floor sets` : ''}${bld.length ? `, ${bld.length} buildings` : ''}${assets['maps/walls_and_floors'] ? ', replaces vanilla walls_and_floors' : ''}`);
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
      const isF = /floor/i.test(target), list = isF ? cat.flooring : cat.wallpaper, base = `AT.${id}`;
      const ent = { Id: list.some(e => e.Id === base) ? `${base}.${t.replace(/\W/g, '')}` : base, Texture: keys[0], Count: variations.length, IsFlooring: isF, mod: id, names: variations.map(v => v.name), files: keys.length > 1 ? keys : undefined };
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
delete cat.buildingExtra;
for (const m of Object.values(cat.maps)) m.file = path.relative(out, m.file);
fs.writeFileSync(path.join(out, 'thirdparty/furniture.json'), JSON.stringify(cat));
console.log(`total: ${Object.keys(cat.items).length} modded furniture, ${Object.keys(cat.skins).length} skinned items, ${Object.keys(cat.actions).length} actions, wallpaper sets ${cat.wallpaper.length}, floor sets ${cat.flooring.length}, buildings ${Object.keys(cat.buildings).length}`);
