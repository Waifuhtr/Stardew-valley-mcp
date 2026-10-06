#!/usr/bin/env node
// Build + package the Stardew Sim Bridge SMAPI mod into dist/Stardew Sim Bridge (+ zip).
// Needs .NET 9 SDK (~/.dotnet) and the game/SMAPI assemblies in ~/sdv-libs (or SDV_LIBS).
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { furnData } from '../cli/commands.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const proj = path.join(ROOT, 'smapi/StardewSim'), out = path.join(ROOT, 'dist/Stardew Sim Bridge');
const dotnet = fs.existsSync(path.join(process.env.HOME, '.dotnet/dotnet')) ? path.join(process.env.HOME, '.dotnet/dotnet') : 'dotnet';
execSync(`"${dotnet}" build -c Release ${process.env.SDV_LIBS ? `-p:SdvLibs="${process.env.SDV_LIBS}"` : ''}`, { cwd: proj, stdio: 'inherit', env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' } });
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.copyFileSync(path.join(proj, 'bin/Release/net9.0/StardewSim.dll'), path.join(out, 'StardewSim.dll'));
fs.copyFileSync(path.join(proj, 'manifest.json'), path.join(out, 'manifest.json'));
// default furniture actions for imported decor packs (only used when Calcifer isn't installed)
fs.writeFileSync(path.join(out, 'assets/actions.json'), JSON.stringify({ Locations: {}, Actions: furnData().actions || {} }, null, 1));
console.log(`packaged ${out} (${Object.keys(furnData().actions || {}).length} default actions)`);
