#!/usr/bin/env node
// Smoke tests for CLI commands, MCP server and core modules. Exit code 1 on failure.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sdv, px, loadMap } from '../cli/commands.mjs';
import { applyStates } from '../web/core/patch.mjs';

let fail = 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sdvtest-'));
async function t(name, fn, re) {
  try {
    const r = await fn();
    if (re && !re.test(r.text)) throw new Error('unexpected output:\n' + r.text.slice(0, 400));
    console.log('ok  ', name);
  } catch (e) { fail++; console.log('FAIL', name, e.message); }
}
const S = (s) => sdv(s.split(' ')), P = (s, inp) => px(s.split(' '), inp);

await t('maps', () => S('maps Seed'), /SeedShop 48x32/);
await t('info', () => S('info Town'), /door 43\.\.44,56>SeedShop 6,29/);
await t('ascii', () => S('ascii SeedShop 0 28 10 4'), /W/);
await t('tile', () => S('tile Town 43 57'), /cell=floor/);
await t('path', () => S('path SeedShop 6 29 5 20'), /^len \d+: /);
await t('route', () => S('route Farm Saloon'), /Town 45,70 > Saloon/);
await t('go', () => S('go Farm 64 15 Saloon 10 20'), /Saloon 14,24 -> 10,20: /);
await t('find', () => S('find Bookseller'), /Town Bookseller at 109,26/);
await t('render', () => S(`render SeedShop --region 0,20,12,12 --actor 6,29 --grid -o ${tmp}/r.png`), /wrote .* 192x192/);
await t('sheet', () => S('sheet spring_town --idx 993'), /col 1 row 31/);
await t('fit', () => S('fit Town 60 75 5 4 --door 62,78'), /CONFLICT|FITS/);
await t('tmx+check', async () => { await S(`tmx JoshHouse -o ${tmp}/j.tmx`); return S(`check ${tmp}/j.tmx`); }, /^OK j/);
await t('patch', async () => { await S(`tmx Shed -o ${tmp}/shed.tmx`); return S(`patch Town ${tmp}/shed.tmx 60 75 -o ${tmp}/p.png`); }, /patched Town/);
const pxt = 'pxt 4x4\n. transparent\nk #222034\nr #e33\n--\n.kk.\nkrrk\nkrrk\n.kk.';
await t('px draw', () => P(`draw - -o ${tmp}/a.png --scale 4`, pxt), /wrote .*4x4/);
await t('px read', () => P(`read ${tmp}/a.png`), /abba/);
await t('px ops', () => P(`ops ${tmp}/a.png -o ${tmp}/b.png`.split(' ').join(' ') + ' canvas 6 6 1 1; outline #000', ''), /6x6/);
await t('px check', () => P('check web/data/img/extra/sprites.png --as npc'), /ok: \d+ frames of 16x32/);
const lay = 'pxt 6x4\nk #222034\nr #e33\n--\n@layer a\nkkkk\n@layer b 2 1\nrr';
await t('px layers', () => P('layers -', lay), /b @2,1 2x1/);
await t('px draw layer', () => P(`draw - -o ${tmp}/l.png --hide b --lock #222034`, lay), /wrote .*6x4/);
await t('px ramp', () => P('ramp #8e6fd1 3'), /^#\w{6} #8e6fd1 #\w{6}$/);
await t('px diff', () => P('diff web/data/img/extra/sprites.png --frame 16,32,0,1'), /px differ/);
await t('px pal', () => P('pal weapons --top 4'), /^#\w{6}( #\w{6}){3}$/);
await t('px copyframe', () => P(`ops new:32x16 -o ${tmp}/cf.png px 0 0 #fff; copyframe 16 16 0 1 flipx`), /32x16/);
await t('render place', () => S(`render Town --region 40,55,10,8 --place examples/amethyst_sword.png@45,60 -o ${tmp}/pl.png`), /160x128/);
await t('furni find', () => S('furni find koltuk'), /288 Mavi Koltuk \/ Blue Armchair \| armchair/);
await t('furni info', () => S('furni info 416'), /rot1: sprite 2x3 @48,208 box 2x2 seats 1,0>right/);
await t('place', () => S('place BeachCabin 0 7 8'), /^OK Meşe Sandalye/);
await t('place wall', () => S('place BeachCabin 1614 4 5'), /^NO .*\nE wall item/);
await t('seats', () => S('seats BeachCabin'), /14,8 >right .*Wizard Chair[\s\S]*sleep/);
await t('map seats', () => S('seats Town'), /map bench/);
await t('sit', () => S(`sit BeachCabin 17 8 -o ${tmp}/sit.png`), /facing left/);
await t('decorate', () => S('decorate BeachCabin --room Tea --wallpaper 3 --floor 2'), /area 1,1,10,\d+: 30 wall tiles, 80 floor tiles/);
await t('bake', () => S(`bake BeachCabin -o ${tmp}/bake`), /seats/);
await t('house go', () => S('go Town 54 100 BeachCabin 96 11'), /BeachCabin 43,11 -> 96,11: /);
await t('state bridge (Passable T)', async () => ({ text: String(applyStates(loadMap('Beach'), ['beachBridgeFixed']).walkable(58, 13)) }), /true/);
await t('cp-export', () => S(`cp-export beach-cabin -o ${tmp}/dist`), /\[SS\] Beach House: BeachCabin \d+ furniture/);
await t('cp-export bundle', async () => {
  const L = JSON.parse(fs.readFileSync(`${tmp}/dist/[SS] Beach House/layout.json`, 'utf8')), C = JSON.parse(fs.readFileSync(`${tmp}/dist/[CP] Beach House/content.json`, 'utf8'));
  const own = Object.keys(C.Changes.find(c => c.Target === 'Data/Furniture')?.Entries || {}), ids = Object.values(L.Locations).flatMap(l => l.Furniture.map(f => f.Id));
  const foreign = ids.filter(i => !own.includes(i) && !process.env.SDV_NO_THIRDPARTY && fs.existsSync('web/data/thirdparty/furniture.json') && JSON.parse(fs.readFileSync('web/data/thirdparty/furniture.json', 'utf8')).items[i]);
  const shops = Object.values(L.Actions).flat().filter(a => a.startsWith('OpenShop ')).map(a => a.split(' ')[1]), shopData = C.Changes.find(c => c.Target === 'Data/Shops')?.Entries || {};
  return { text: `foreign ${foreign.length} missingShops ${shops.filter(s => !shopData[s] && !/FurnitureCatalogue$/.test(s)).length} deps ${C.DynamicTokens[1].When ? Object.keys(C.DynamicTokens[1].When).length : 0}` };
}, /^foreign 0 missingShops 0 deps 1$/);
await t('place report', () => S(`render BusStop --region 0,0,30,20 --place web/data/img/extra/sprites.png@-9,10 -o ${tmp}/pr.png`), /NOTHING VISIBLE/);
await t('place frame top', () => S(`render BusStop --region 0,0,30,20 --place web/data/img/extra/sprites.png@10,10@16,32,1@top -o ${tmp}/pt.png`), /#1 @top: .* visible 100%/);
await t('px frames', () => P('frames web/data/img/extra/sprites.png'), /npc 16x32/);
await t('px spec', () => P('spec npc'), /16x32/);

// MCP handshake
await t('mcp', () => new Promise((res, rej) => {
  const p = spawn(process.execPath, ['mcp/server.mjs']);
  let out = '';
  p.stdout.on('data', d => { out += d; if (out.split('\n').length > 3) { p.kill(); res({ text: out }); } });
  p.on('error', rej);
  const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sdv', arguments: { args: 'path SeedShop 6 29 5 20' } } });
  setTimeout(() => { p.kill(); rej(new Error('timeout: ' + out)); }, 15000);
}), /"len \d+: /);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
