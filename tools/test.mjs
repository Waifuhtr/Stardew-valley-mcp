#!/usr/bin/env node
// Smoke tests for CLI commands, MCP server and core modules. Exit code 1 on failure.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sdv, px } from '../cli/commands.mjs';

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
