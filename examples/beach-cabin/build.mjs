#!/usr/bin/env node
// "Beach Cabin" example mod, drawn entirely with the project's own px ops (no vanilla pixels reused):
//  - exterior: beach_cabin_exterior.png (7x7 tiles) -> Beach EditMap patch (roof on Front, body on Buildings, door = Warp)
//  - interior: beach_cabin_interior.png tilesheet -> new location "BeachCabin"
//  - outputs: Content Patcher mod in mods/[CP] Beach Cabin, web/CLI copy in web/data/mods/beach-cabin
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOps } from '../../web/core/pixel.mjs';
import { newImg } from '../../web/core/raster.mjs';
import { mapToTmx } from '../../web/core/tmx.mjs';
import { GameMap } from '../../web/core/map.mjs';
import { writePNG } from '../../lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MOD = path.join(ROOT, 'mods/[CP] Beach Cabin'), WEB = path.join(ROOT, 'web/data/mods/beach-cabin'), IMG = path.join(ROOT, 'web/data/img/mods/beach-cabin');
for (const d of [path.join(MOD, 'assets'), WEB, IMG]) fs.mkdirSync(d, { recursive: true });

// placement on the Beach (checked with: sdv fit Beach 18 9 7 4 --door 21,12)
const PLACE = { map: 'Beach', x: 18, y: 6, w: 7, h: 7 };
const DOOR = [[3, 6], [3, 5]];
const INSIDE = { name: 'BeachCabin', arrive: [5, 9] };

// hand-picked ramps (dark -> light): weathered driftwood like the vanilla beach shacks, one faded sea-green accent
const RAMP = {
  wall: '#2a160e,#4a2814,#73401c,#9a5a26,#c07d38', roof: '#22140e,#3e2617,#5e3c22,#80552e,#a4723e',
  post: '#24130c,#432414,#6a3a1c,#8e5228,#b06c34', teal: '#1b2f2c,#2c4a44,#466e62,#6b9282,#90b29e',
  floor: '#3e1e14,#6e3a22,#9c5c32,#c48448,#e0b070', inwall: '#3a2416,#5e3c24,#845a36,#a8784a,#c89a64',
};
const PAL = `pal o #2a160e; pal O #3e2617; pal d #3a1c14; pal D #6a3420; pal w #9a5530; pal W #c47c42; pal y #e0a862;
pal v #160c0a; pal V #2a1a16; pal r #6e2a22; pal R #a84434; pal Q #d8c8b0; pal q #b0a088;
pal m #3a3a40; pal M #5d5f66; pal I #8a8d94; pal k #f4d070; pal K #d89a30; pal Z #ffe0a0;
pal l #2e3a1a; pal L #4a5e24; pal e #6e8a30; pal E #a0b050; pal n #c9a66b; pal N #8a6a3a;
pal z #e08040; pal c #c05a34; pal C #e08a58; pal x #8a3322; pal s #e0b0a0; pal S #f8dcd0;
pal g #1e4a78; pal G #3e86b8; pal h #7fc4e6; pal H #d4f0ff; pal b #d83a3a; pal t #f4eedc; pal T #d8d0bc; pal j #4e1a12; pal u #2c4a44; pal a #466e62; pal A #6b9282; pal U #90b29e`;

// ---------------------------------------------------------------- exterior (112 x 112)
const ext = applyOps(newImg(112, 112), `${PAL}
// --- roof: boards running down each slope (chevron at the ridge), deep overhang
mask poly 55 2 -1 57 -1 62 16 62 55 22
dplanks 0 0 56 62 135 5 ${RAMP.roof} 11
unmask
mask poly 56 2 112 57 112 62 95 62 56 22
dplanks 56 0 56 62 45 5 ${RAMP.roof} 12
unmask
// fascia (barge boards) along the inner edge: lit top, dark underside
line 16 62 55 22 W; line 17 62 55 23 w; line 18 62 55 24 D
line 95 62 56 22 W; line 94 62 56 23 w; line 93 62 56 24 D
line 0 61 16 61 D; line 95 61 111 61 D; line 0 62 16 62 o; line 95 62 111 62 o
// ridge cap boards
fpoly 55 0 46 10 49 10 55 4 61 10 64 10 56 0 w; line 46 10 55 0 W; line 56 0 64 10 D; line 49 10 55 4 d; line 55 4 61 10 d
// --- gable: horizontal boards, dark vent with slats, heavy shadow under the fascia
mask poly 55 25 19 62 92 62
planks 18 24 76 38 h 6 ${RAMP.wall} 21
fpoly 55 25 19 62 27 62 55 33 84 62 92 62 #1a0c0670
fpoly 55 29 46 39 64 39 V; line 47 37 63 37 O; line 49 35 61 35 O; line 51 33 59 33 O; line 46 39 64 39 o
unmask
// hanging buoy (faded red/white) on the gable
line 32 46 32 49 N; fcircle 32 53 4 Q; mask poly 32 53 36 49 36 57; fcircle 32 53 4 R; unmask; mask poly 32 53 28 49 28 57; fcircle 32 53 4 R; unmask
fcircle 32 53 1 V; circle 32 53 4 o
// --- walls: horizontal weathered boards, posts, big shadow under the eaves
planks 12 62 88 40 h 6 ${RAMP.wall} 5
frect 12 62 88 5 #1a0c0690; frect 12 67 88 3 #1a0c0650
planks 11 60 5 42 v 5 ${RAMP.post} 31
planks 96 60 5 42 v 5 ${RAMP.post} 32
line 11 60 11 101 o; line 100 60 100 101 o
// --- windows: dark interior, thin warm reflection, faded sea-green shutters
frect 20 73 18 16 d; frect 22 75 14 12 v; line 28 75 28 86 D; line 22 80 35 80 D
px 24 76 V; px 25 76 V; px 24 77 V; px 31 82 V; px 32 81 V; px 33 76 W
frect 16 72 4 18 ${RAMP.teal.split(',')[2]}; line 16 72 16 89 ${RAMP.teal.split(',')[3]}; line 17 74 18 74 ${RAMP.teal.split(',')[1]}; line 17 78 18 78 ${RAMP.teal.split(',')[1]}; line 17 82 18 82 ${RAMP.teal.split(',')[1]}; line 17 86 18 86 ${RAMP.teal.split(',')[1]}
frect 38 72 4 18 ${RAMP.teal.split(',')[2]}; line 41 72 41 89 ${RAMP.teal.split(',')[1]}; line 38 74 40 74 ${RAMP.teal.split(',')[1]}; line 38 78 40 78 ${RAMP.teal.split(',')[1]}; line 38 82 40 82 ${RAMP.teal.split(',')[1]}; line 38 86 40 86 ${RAMP.teal.split(',')[1]}
frect 19 89 23 3 W; line 19 91 41 91 D; rect 15 71 28 22 o
frect 74 73 18 16 d; frect 76 75 14 12 v; line 82 75 82 86 D; line 76 80 89 80 D
px 78 76 V; px 79 76 V; px 78 77 V; px 86 82 V; px 87 81 V; px 87 76 W
frect 70 72 4 18 ${RAMP.teal.split(',')[2]}; line 70 72 70 89 ${RAMP.teal.split(',')[3]}; line 71 74 72 74 ${RAMP.teal.split(',')[1]}; line 71 78 72 78 ${RAMP.teal.split(',')[1]}; line 71 82 72 82 ${RAMP.teal.split(',')[1]}; line 71 86 72 86 ${RAMP.teal.split(',')[1]}
frect 92 72 4 18 ${RAMP.teal.split(',')[2]}; line 95 72 95 89 ${RAMP.teal.split(',')[1]}; line 92 74 94 74 ${RAMP.teal.split(',')[1]}; line 92 78 94 78 ${RAMP.teal.split(',')[1]}; line 92 82 94 82 ${RAMP.teal.split(',')[1]}; line 92 86 94 86 ${RAMP.teal.split(',')[1]}
frect 73 89 23 3 W; line 73 91 95 91 D; rect 69 71 28 22 o
// --- door: faded sea-green boards in a dark frame, brass knob, starfish above
frect 46 69 20 33 D; line 46 69 65 69 W
planks 48 71 16 31 v 4 ${RAMP.teal} 41
line 48 71 63 71 V; rect 45 68 22 34 o; px 61 86 k; px 61 87 K
px 56 63 z; px 55 64 z; px 57 64 z; px 56 64 C; px 54 65 z; px 58 65 z; px 56 65 z; px 55 66 z; px 57 66 z
// --- lantern (warm glow)
fcircle 70 76 7 #ffc86022
line 68 69 72 69 d; line 70 69 70 71 d; frect 68 71 5 7 o; frect 69 72 3 5 k; px 69 72 Z; line 68 78 72 78 d
// --- stovepipe through the right slope
mask poly 80 4 87 4 87 34 80 27
frect 80 4 7 31 M; line 81 4 81 34 I; line 86 4 86 34 m; line 80 14 86 14 m; line 80 24 86 24 m
unmask
frect 78 1 11 3 m; line 78 1 88 1 I; rect 77 0 13 5 o; line 79 4 79 27 o; line 87 4 87 34 o
outline o
// --- ground: step, barrel, leaning rod, rope, grass tufts, contact shadow on the sand
frect 46 102 20 4 w; line 46 102 65 102 W; line 46 105 65 105 D; rect 45 101 22 6 o
planks 2 86 10 16 v 2 ${RAMP.post} 51
line 2 89 11 89 m; line 2 97 11 97 m; line 2 86 11 86 W; rect 1 85 12 18 o
line 106 101 101 63 N; line 107 101 102 63 o; px 101 62 I; frect 104 93 3 2 m
fcircle 39 100 3 n; circle 39 100 3 N; px 39 100 N; circle 39 100 1 N
line 15 101 13 95 L; line 16 101 16 94 e; line 17 101 19 96 E; line 18 101 21 98 L; line 14 101 11 98 e
line 92 101 90 96 e; line 93 101 94 94 E; line 94 101 97 97 L; line 95 101 96 98 e
gradient 4 102 104 6 #4a2a1060 transparent
`);
writePNG(path.join(MOD, 'assets/beach_cabin_exterior.png'), ext);
writePNG(path.join(IMG, 'beach_cabin_exterior.png'), ext);

// ---------------------------------------------------------------- interior tilesheet (8 x 6 tiles)
// 0 void | 1,2 floor | 3 floor w/ wall shadow | 4 doormat | 5 wall top | 6 wall mid | 7 wall bottom
// 8,9,16,17 window (2x2) | 10 shelf | 11 lamp | bed 18,19,26,27,34,35 | table 20,21,28,29 | plant 22,30 | rug 36,37,38,44,45,46
const wallTop = `planks 0 0 16 16 v 4 ${RAMP.inwall} 3; frect 0 0 16 3 D; line 0 0 15 0 W; line 0 3 15 3 #00000040`;
const wallMid = `planks 0 0 16 16 v 4 ${RAMP.inwall} 4`;
const wallBot = `planks 0 0 16 16 v 4 ${RAMP.inwall} 6; frect 0 11 16 5 w; line 0 11 15 11 W; line 0 15 15 15 d`;
const sheet = applyOps(newImg(128, 96), `${PAL}
frame 16 16 0; frect 0 0 16 16 #0e0a0c
frame 16 16 1; planks 0 0 16 16 h 4 ${RAMP.floor} 71
frame 16 16 2; planks 0 0 16 16 h 4 ${RAMP.floor} 72
frame 16 16 3; planks 0 0 16 16 h 4 ${RAMP.floor} 73; gradient 0 0 16 6 #00000066 transparent
frame 16 16 4; planks 0 0 16 16 h 4 ${RAMP.floor} 74; frect 1 3 14 10 x; frect 2 4 12 8 c; line 2 6 13 6 C; line 2 9 13 9 C; line 1 3 1 12 j
frame 16 16 5; ${wallTop}
frame 16 16 6; ${wallMid}
frame 16 16 7; ${wallBot}
frame 16 16 8; ${wallTop}
frame 16 16 9; ${wallTop}
frame 16 16 16; ${wallMid}
frame 16 16 17; ${wallMid}
endframe
frect 3 21 26 22 D; frect 4 22 24 20 W; gradient 5 23 22 12 H h; frect 5 35 22 6 G; line 5 35 26 35 H; px 9 38 h; px 20 37 h
line 16 23 16 40 w; line 5 30 26 30 w; rect 2 20 28 24 o; frect 1 43 30 2 W; line 1 44 30 44 D
frect 5 23 3 18 S; line 7 23 7 40 s; frect 24 23 3 18 S; line 24 23 24 40 s
frame 16 16 10; ${wallMid}; frect 1 10 14 2 W; line 1 11 14 11 D; frect 2 5 2 5 L; px 2 4 e; px 3 4 e; frect 6 7 4 3 S; px 7 6 s; px 8 6 S; frect 11 6 2 4 G; px 11 5 h
frame 16 16 11; ${wallMid}; fcircle 8 8 6 #ffd86630; line 6 3 10 3 d; frect 6 4 5 7 o; frect 7 5 3 5 k; px 7 5 Z; line 6 11 10 11 d
endframe
mask rect 32 32 32 48
frect 33 32 30 6 w; line 33 32 62 32 y; rect 32 31 32 8 o; px 34 33 W; px 61 33 W
frect 35 38 26 7 t; line 35 44 60 44 T; frect 36 39 10 5 H; frect 50 39 10 5 H; rect 34 37 28 9 o
frect 34 45 28 28 u; frect 34 49 28 3 a; frect 34 56 28 3 a; frect 34 63 28 3 a; frect 34 70 28 3 a
line 34 45 61 45 U; line 34 45 34 72 A; rect 33 44 30 30 o
frect 33 73 30 5 w; line 33 73 62 73 y; line 33 77 62 77 d; rect 32 72 32 7 o
unmask
fcircle 80 42 12 o; fcircle 80 42 11 w; fcircle 80 41 10 W; circle 80 41 9 y
frect 70 53 3 10 D; frect 87 53 3 10 D; line 70 53 70 62 w; line 87 53 87 62 w; frect 78 54 4 8 D
frect 69 62 5 1 o; frect 86 62 5 1 o
frect 76 37 8 4 S; line 76 40 83 40 s; fcircle 80 36 2 b; px 79 35 C; fcircle 77 37 1 z
frect 99 52 10 10 c; line 99 52 108 52 C; line 99 61 108 61 x; rect 98 51 12 12 o
line 104 51 98 38 L; line 104 51 101 36 e; line 105 51 106 35 e; line 105 51 111 40 L; line 104 51 102 42 E
line 105 51 109 44 E; line 104 51 97 45 e; px 98 38 E; px 111 40 E; px 101 36 E; px 106 35 E; line 103 51 100 48 L
mask poly 66 70 72 65 104 65 110 70 110 89 104 94 72 94 66 89
frect 64 64 48 32 a; frect 64 68 48 3 S; frect 64 74 48 3 n; frect 64 80 48 3 S; frect 64 86 48 3 n
unmask
line 66 70 72 65 o; line 72 65 104 65 o; line 104 65 110 70 o; line 110 70 110 89 o; line 110 89 104 94 o; line 104 94 72 94 o; line 72 94 66 89 o; line 66 89 66 70 o
`);
writePNG(path.join(MOD, 'assets/beach_cabin_interior.png'), sheet);
writePNG(path.join(IMG, 'beach_cabin_interior.png'), sheet);

// ---------------------------------------------------------------- maps
const b64 = (arr) => Buffer.from(new Uint16Array(arr).buffer).toString('base64');
const makeMap = (name, w, h, sheets, layers, props = {}, tp = {}) => ({ name, w, h, props, sheets, layers: Object.entries(layers).map(([id, a]) => ({ id, vis: true, data: b64(a) })), anim: {}, tp });

{ // exterior patch: rows 0-2 Front (walk behind the roof), rows 3-6 Buildings
  const S = { id: 'z_beach_cabin', img: 'mods/beach-cabin/beach_cabin_exterior', cols: 7, rows: 7, first: 1, tp: {} };
  const N = 49, Front = new Array(N).fill(0), Buildings = new Array(N).fill(0);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) (y < 3 ? Front : Buildings)[y * 7 + x] = 1 + y * 7 + x;
  const tp = { Buildings: {} };
  for (const [x, y] of DOOR) tp.Buildings[`${x},${y}`] = { Action: `Warp ${INSIDE.arrive[0]} ${INSIDE.arrive[1]} ${INSIDE.name}` };
  const j = makeMap('BeachCabin_Exterior', 7, 7, [S], { Back: new Array(N).fill(0), Buildings, Front }, {}, tp);
  fs.writeFileSync(path.join(WEB, 'BeachCabin_Exterior.json'), JSON.stringify(j));
  fs.writeFileSync(path.join(MOD, 'assets/BeachCabin_Exterior.tmx'), mapToTmx(new GameMap(j)));
}

{ // interior 12x12
  const W = 12, H = 12, N = W * H, T = { id: 'z_beach_cabin_interior', img: 'mods/beach-cabin/beach_cabin_interior', cols: 8, rows: 6, first: 1, tp: {} };
  const Back = new Array(N).fill(0), Back2 = new Array(N).fill(0), Buildings = new Array(N).fill(0), Front = new Array(N).fill(0);
  const set = (L, x, y, i) => { L[y * W + x] = i + 1; };
  const door = 5;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const room = x >= 1 && x <= W - 2 && y >= 1 && y <= 9, exit = x === door && y >= 10;
    if (!room && !exit) { set(Buildings, x, y, 0); continue; }
    if (y >= 4 || exit) set(Back, x, y, y === 4 ? 3 : (x + y * 3) % 5 ? 1 : 2);
    else set(Buildings, x, y, [5, 6, 7][y - 1]);
  }
  for (const [x, y, i] of [[2, 1, 8], [3, 1, 9], [2, 2, 16], [3, 2, 17], [8, 1, 8], [9, 1, 9], [8, 2, 16], [9, 2, 17], [6, 2, 10], [5, 2, 11], [10, 2, 11]]) set(Buildings, x, y, i);
  for (const [x, y, i] of [[1, 4, 18], [2, 4, 19], [1, 5, 26], [2, 5, 27], [1, 6, 34], [2, 6, 35]]) set(Buildings, x, y, i); // bed
  for (const [x, y, i] of [[8, 5, 20], [9, 5, 21], [8, 6, 28], [9, 6, 29]]) set(Buildings, x, y, i);                      // table
  set(Front, 10, 4, 22); set(Buildings, 10, 5, 30);                                                                        // potted palm
  for (const [x, y, i] of [[4, 6, 36], [5, 6, 37], [6, 6, 38], [4, 7, 44], [5, 7, 45], [6, 7, 46]]) set(Back2, x, y, i);   // rug
  set(Back2, door, 9, 4);                                                                                                  // doormat
  const props = { Warp: `${door} 12 Beach ${PLACE.x + DOOR[0][0]} ${PLACE.y + DOOR[0][1] + 1}`, AmbientLight: '90 90 60' };
  const j = makeMap(INSIDE.name, W, H, [T], { Back, Back2, Buildings, Front }, props, {});
  fs.writeFileSync(path.join(WEB, 'BeachCabin.json'), JSON.stringify(j));
  fs.writeFileSync(path.join(MOD, 'assets/BeachCabin.tmx'), mapToTmx(new GameMap(j)));
}

// ---------------------------------------------------------------- manifests (web/CLI mod + Content Patcher)
fs.writeFileSync(path.join(WEB, 'mod.json'), JSON.stringify({
  id: 'beach-cabin', title: 'Plaj Kabini',
  images: { 'mods/beach-cabin/beach_cabin_exterior': [112, 112], 'mods/beach-cabin/beach_cabin_interior': [128, 96] },
  locations: { [INSIDE.name]: 'mods/beach-cabin/BeachCabin.json' },
  patches: [{ target: PLACE.map, file: 'mods/beach-cabin/BeachCabin_Exterior.json', x: PLACE.x, y: PLACE.y }],
}, null, 1));
const list = path.join(ROOT, 'web/data/mods/index.json');
const ids = fs.existsSync(list) ? JSON.parse(fs.readFileSync(list, 'utf8')) : [];
if (!ids.includes('beach-cabin')) fs.writeFileSync(list, JSON.stringify([...ids, 'beach-cabin']));
fs.writeFileSync(path.join(MOD, 'manifest.json'), JSON.stringify({
  Name: 'Beach Cabin', Author: 'Waifuhtr', Version: '1.0.0', Description: 'A small enterable cabin on the beach (made with Stardew Sim).',
  UniqueID: 'Waifuhtr.BeachCabin', UpdateKeys: [], ContentPackFor: { UniqueID: 'Pathoschild.ContentPatcher' },
}, null, 2));
fs.writeFileSync(path.join(MOD, 'content.json'), JSON.stringify({
  Format: '2.0.0',
  Changes: [
    { Action: 'Load', Target: `Maps/${INSIDE.name}`, FromFile: 'assets/BeachCabin.tmx' },
    { Action: 'EditData', Target: 'Data/Locations', Entries: { [INSIDE.name]: { DisplayName: 'Beach Cabin', DefaultArrivalTile: { X: INSIDE.arrive[0], Y: INSIDE.arrive[1] }, CreateOnLoad: { MapPath: `Maps/${INSIDE.name}` } } } },
    { Action: 'EditMap', Target: 'Maps/Beach', FromFile: 'assets/BeachCabin_Exterior.tmx', ToArea: { X: PLACE.x, Y: PLACE.y, Width: PLACE.w, Height: PLACE.h }, PatchMode: 'ReplaceByLayer' },
  ],
}, null, 2));
console.log('built beach cabin');
