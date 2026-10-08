#!/usr/bin/env node
import { sdv, px } from './commands.mjs';
const tool = process.argv[1].endsWith('px.mjs') || process.argv[1].endsWith('/px') ? px : sdv;
const readStdin = async () => { if (process.stdin.isTTY) return ''; let s = ''; for await (const c of process.stdin) s += c; return s; };
try {
  const args = process.argv.slice(2);
  const stdin = tool === px && (args[1] === '-' || (args[0] === 'ops' && args.length <= 4 && !args.slice(1).some(a => / /.test(a)))) ? await readStdin() : '';
  const r = await tool(args, stdin);
  console.log(r.text);
} catch (e) { console.error('error: ' + e.message); process.exit(1); }
