#!/usr/bin/env node
// Zero-dependency MCP stdio server exposing two tools: sdv (maps/simulation) and px (pixel art).
import readline from 'node:readline';
import { sdv, px, tokenize, SDV_HELP, PX_HELP } from '../cli/commands.mjs';

const TOOLS = [
  { name: 'sdv', description: `Stardew Valley map simulator (all vanilla maps + interiors). args = one command line.\n${SDV_HELP}\nStart with: maps / info <map> / ascii <map> x y w h. Use render only when you need to see pixels.`,
    inputSchema: { type: 'object', properties: { args: { type: 'string' }, image: { type: 'boolean', description: 'return rendered PNG inline (default true for render/sheet)' } }, required: ['args'] } },
  { name: 'px', description: `Pixel art / sprite tool for Stardew mods. args = one command line; input = PXT text or ops script.\n${PX_HELP}`,
    inputSchema: { type: 'object', properties: { args: { type: 'string' }, input: { type: 'string' }, image: { type: 'boolean' } }, required: ['args'] } },
];

const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  try {
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stardew-sim', version: '1.0.0' } } });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/call') {
      const { name, arguments: a = {} } = params;
      const fn = name === 'px' ? px : sdv;
      const r = await fn(tokenize(a.args || ''), a.input || '');
      const content = [{ type: 'text', text: r.text }];
      if (r.image && a.image !== false) content.push({ type: 'image', data: r.image.png.toString('base64'), mimeType: 'image/png' });
      return send({ jsonrpc: '2.0', id, result: { content } });
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
  } catch (e) {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'error: ' + e.message }], isError: true } });
  }
});
