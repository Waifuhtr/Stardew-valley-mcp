#!/usr/bin/env node
// Beach House: one location with themed rooms, built only with simulator commands (what an AI would run).
// Run after examples/beach-cabin/build.mjs (exterior). Needs the imported decor packs (tools/import-mods.mjs).
import { sdv } from '../../cli/commands.mjs';
const M = ['--mod', 'beach-cabin'];
const run = async (...a) => { const r = await sdv(a.flat().map(String)); const bad = /^(NO|E )/m.test(r.text); if (bad || process.env.V) console.log(r.text.split('\n').slice(0, 4).join('\n')); return r; };

// rooms left -> right; the Hall (entry) is in the middle, under it the door to the beach
const ROOMS = 'Tea:10x8,Wizard:10x8,Bedroom:12x8,Hall:14x8,Bakery:14x8,Greenhouse:12x8,Workshop:12x8,Junimo:10x8';
console.log((await run('house', 'BeachCabin', '--rooms', ROOMS, '--entry', 'Hall', '--exit', 'Beach,21,13', M)).text);
// plain numbers = the game's walls_and_floors sheet (shown with Hojichas' art when that pack is installed)
const JP = 'AT.Asterisk.Narianka.AT.Japanese', CC = 'AT.DatGrayFox.AT.CottageCoreWallsAndFloors', GGFW = 'skellady.GGF.GreenGroveWallpapers', GGFF = 'skellady.GGF.GreenGroveFlooring';
const decor = {
  Tea: [`${JP}:9`, `${JP}:10`], Wizard: [`${CC}:50`, `${CC}:24`], Bedroom: ['59', '20'], Hall: [`${GGFW}:25`, `${GGFF}:0`],
  Bakery: ['93', '23'], Greenhouse: ['AT.soren.AT.botanicalwalls:17', `${CC}:28`], Workshop: ['67', 'AT.Molamole.WallpaperandFlooring.AT:11'], Junimo: [`${CC}:40`, `${CC}:9`],
};
for (const [room, [w, f]] of Object.entries(decor)) await run('decorate', 'BeachCabin', '--room', room, '--wallpaper', w, '--floor', f, '--save', M);
export { run, M };

// ---------------------------------------------------------------- furniture (real game / pack items; every placement is checked)
// rooms (x range, floor y4..11, walls y1..3); doorways at rows 9-10 next to every partition must stay free
const B = 'KatyDTK.BakingLoversDecor_', G = 'skellady.GGF.', PL = 'HXW.PlantLoversFurni_', V = 'VintageIndustrialDecor_', C = 'CreamyCozyDecor_', BO = 'SoftBohoDecor_Boho', POT = 'sirrobertsmom.DecorativePots_';
const JS = 'idaidaJunimoFurnitureRecolor.AT:0', WS = 'idaidaWizardFurnitureRecolor.AT:0';
const ROOM_FURNITURE = {
  Tea: [ // x1..10 — Japanese tea room
    [PL + 'PlantyBookcase2', 1, 4], ['1748', 4, 4], ['1748', 7, 4], ['1369', 9, 4], ['1369', 3, 4],
    ['1755', 4, 9], [PL + 'LowTeaTablewithBook', 4, 7], [G + 'PineStool', 3, 7], [G + 'PineStool', 7, 7], [G + 'PineStool', 5, 8], [PL + 'TeaSet', 2, 10],
    [PL + 'SmallPlantTrio1', 9, 7], [PL + 'TallPlantStool', 1, 8],
  ],
  Wizard: [ // x12..21 — wizard study (vanilla wizard set + IDAIDA recolors); Wizard Catalogue = vanilla shop
    ['WizardFireplace', 13, 4, 0, WS], ['LargeWizardBookcase', 15, 4, 0, WS], ['WizardCatalogue', 18, 4], ['SmallWizardBookcase', 19, 4, 0, WS],
    ['StarryMoonRug', 14, 8, 0, WS], ['WizardTable', 15, 8, 0, WS], ['WizardChair', 14, 8, 1, WS], ['WizardChair', 17, 8, 3, WS],
    ['Cauldron', 19, 7, 0, WS], ['WizardLamp', 13, 10, 0, WS], ['AmethystCrystalBall', 20, 10], ['ElixirShelf', 19, 2, 0, WS],
  ],
  Bedroom: [ // x23..34 — soft boho bedroom
    [BO + 'LargeBed', 24, 4], [BO + 'NightstandLight', 26, 4], [BO + 'Nightstand', 23, 4], [BO + 'Dresser', 30, 4], [BO + 'LargeVase', 32, 4],
    [BO + 'LysRug', 27, 8], [BO + 'RosieCouch', 29, 8, 0], [BO + 'CoffeeTable', 30, 10], [BO + 'DecorChair', 25, 9], [BO + 'RoundVase', 33, 8],
    [BO + 'RosePainting', 27, 2], [BO + 'HangingPlant', 33, 1], [C + 'Calendar1', 31, 1], [BO + 'SmallRug', 24, 11],
  ],
  Hall: [ // x36..49 — green grove lounge, entry/exit at 43,11; Green Grove catalogue opens its shop
    [G + 'GreenGroveCatalogue', 37, 4], [G + 'JadeCushionedCouch', 41, 4], [G + 'BigRoundishTeaTable', 41, 6], [G + 'JadeCushionedArmchair', 38, 6, 1], [G + 'JadeCushionedArmchair', 45, 6, 3],
    [G + 'SquareJadeRug', 40, 9], [G + 'TinyPlants', 36, 4], [G + 'TinyPlant1', 49, 4], [G + 'GreenGrovePainting', 41, 1], [G + 'MultiColoredCandles', 47, 4],
    ['1449', 39, 4], ['1449', 46, 4],
  ],
  Bakery: [ // x51..64 — bakery (moved from the old east-beach building); oven/fridge -> cooking
    [B + 'LongMenu', 52, 1], [B + 'SmallShelf_a', 63, 1], [B + 'Oven', 52, 4], [B + 'Sink', 53, 4], [B + 'Fridge', 54, 4], [B + 'BagsOfFlour', 55, 4],
    [B + 'Display_a', 57, 4], [B + 'SmallDisplay_a', 61, 4], [B + 'Catalogue', 63, 4],
    [B + 'CreamWoodCounter_a', 55, 6], [B + 'CreamWoodCounter_b', 56, 6], [B + 'CreamWoodCounter_b', 57, 6], [B + 'CreamWoodCashier', 58, 6], [B + 'CreamWoodCounter_b', 59, 6], [B + 'CreamWoodCounter_c', 60, 6],
    [B + 'BasketOfBaguettes', 62, 6], ['VintageIndustrialDecor_RoundTable', 54, 9], [V + 'Chair', 53, 9, 1], [V + 'Chair', 56, 9, 3],
    [V + 'RoundTable', 60, 9], [V + 'Chair', 59, 9, 1], [V + 'Chair', 62, 9, 3], [BO + 'MediumRug', 57, 10],
  ],
  Greenhouse: [ // x66..77 — plant lovers + decorative pots; Plant Lovers catalogue opens its shop
    [PL + 'PlantCubbyBookcase3x3', 67, 4], [PL + 'Catalogue', 70, 4], [PL + 'PlantStands2x3', 71, 4], [PL + 'PlantyBookcase', 74, 4], [PL + 'OvergrownFireplace', 76, 4],
    [PL + 'PlantPillowBench', 69, 8], [PL + 'LgBookPlantPile', 73, 8], [PL + 'SmallPlantTrio2', 72, 8],
    [POT + '1', 67, 7], [POT + '5', 68, 10], [POT + '12', 73, 10], [POT + '20', 75, 7], [POT + '33', 76, 10], [PL + 'TallPlantStool', 70, 11],
  ],
  Workshop: [ // x79..90 — vintage industrial workshop; calendar -> Billboard, fridge -> cooking
    [V + 'StudyTable', 80, 4], [V + 'Bookshelf1', 84, 4], [V + 'Fridge', 89, 4], [V + 'Closet', 87, 4],
    [V + 'Chair', 81, 6, 2], [V + 'Calendar', 83, 1], [V + 'WallClock1', 88, 1], [V + 'Hanglamp', 80, 8], [V + 'Hanglamp', 89, 8],
    [V + 'FloorTable', 83, 8], [V + 'Cushion', 82, 8], [V + 'Cushion1', 86, 8], [V + 'Armchair', 84, 10],
  ],
  Junimo: [ // x92..101 — junimo room (vanilla junimo set + IDAIDA recolors); Junimo Catalogue = vanilla shop
    ['JunimoCatalogue', 93, 4], ['JunimoBookcase', 95, 4, 0, JS], ['JunimoBed', 98, 4, 0, JS], ['JunimoLamp', 97, 4, 0, JS],
    ['CircularJunimoRug', 95, 8, 0, JS], ['JunimoTeaTable', 95, 8, 0, JS], ['JunimoChair', 94, 8, 1, JS], ['JunimoChair', 97, 8, 3, JS],
    ['JunimoPlant', 99, 8, 0, JS], ['GreenSleepingJunimo', 101, 10], ['LittleBuddies', 98, 1, 0, JS], ['Stardrop', 93, 1, 0, JS], ['JunimoFlower', 101, 7, 0, JS],
  ],
};
// start clean, then place everything through the same checks the AI uses
import fs from 'node:fs';
const modFile = new URL('../../web/data/mods/beach-cabin/mod.json', import.meta.url);
const mm = JSON.parse(fs.readFileSync(modFile, 'utf8')); delete mm.furniture; delete mm.actions; fs.writeFileSync(modFile, JSON.stringify(mm, null, 1));
let ok = 0, bad = 0;
for (const [room, list] of Object.entries(ROOM_FURNITURE)) for (const [id, x, y, rot = 0, skin] of list) {
  const r = await run('place', 'BeachCabin', id, x, y, '--rot', rot, ...(skin ? ['--skin', skin] : []), '--save', M);
  if (/^OK/.test(r.text)) ok++; else { bad++; console.log(`  [${room}] ${id} @${x},${y}`); }
}
// functions only where the item is meant to do something (catalogues/vanilla items already work natively)
await run('furni', 'act', B + 'Fridge', 'kitchen', M);
console.log(`placed ${ok}, rejected ${bad}`);
