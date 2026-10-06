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

// hand-picked ramps (dark -> light), saturated like vanilla art
const RAMP = {
  wall: '#1f3f4a,#2f6a6e,#47958e,#6cbcaa,#a3dcc6', gable: '#24484f,#357678,#50a196,#79c6b2,#b0e3cc',
  roof: '#1c2252,#2b3f86,#3d64b0,#5a8fd0,#8fbfe8', wood: '#3a1c14,#6a3420,#9a5530,#c47c42,#e0a862',
  trim: '#6f6a60,#a8a092,#d8d0bc,#f4eedc', stone: '#3e3430,#665850,#8e8070,#b4a894',
  floor: '#3e1e14,#6e3a22,#9c5c32,#c48448,#e0b070', inwall: '#5f6f6c,#8aa29c,#b4cbc4,#d6e6df,#eef7f2',
};
const PAL = `pal o #2b1c22; pal O #4a2a2c; pal t #f4eedc; pal T #d8d0bc; pal q #a8a092; pal d #3a1c14; pal D #6a3420; pal w #9a5530; pal W #c47c42; pal y #e0a862;
pal g #1e4a78; pal G #3e86b8; pal h #7fc4e6; pal H #d4f0ff; pal b #d83a3a; pal B #8e1f2a; pal k #f4d070; pal K #d89a30; pal m #9a5a18;
pal l #183a22; pal L #2a6a34; pal e #45a043; pal E #7cd05a; pal c #c05a34; pal C #e08a58; pal x #8a3322; pal s #e0b0a0; pal S #f8dcd0;
pal n #c9a66b; pal N #8a6a3a; pal z #f08a3a; pal Z #ffc070; pal j #4e1a12`;

// ---------------------------------------------------------------- exterior (112 x 112)
const ext = applyOps(newImg(112, 112), `${PAL}
// roof band (inverted V) with staggered shingles
mask poly 55 1 -1 51 -1 56 12 56 55 18 99 56 112 56 112 51 56 1
shingles 0 0 112 56 6 4 ${RAMP.roof} 11
gradient 0 0 112 20 #ffffff30 transparent
unmask
// gable wall: vertical board & batten + shadow under the roof
mask poly 55 19 13 56 98 56
planks 13 18 86 38 v 4 ${RAMP.gable} 21
fpoly 55 19 13 56 19 56 55 25 92 56 98 56 #10202a66
unmask
// fishing net draped over the left gable, with a starfish and a shell
mask poly 22 40 46 30 48 41 36 53 22 52
line 20 30 44 54 n; line 26 30 50 54 n; line 32 30 56 54 n; line 38 30 62 54 n; line 14 30 38 54 n
line 48 30 24 54 n; line 42 30 18 54 n; line 36 30 12 54 n; line 54 30 30 54 n
unmask
line 22 40 46 30 N; line 46 30 48 41 N; line 22 40 22 52 N
px 31 44 z; px 30 45 z; px 32 45 z; px 31 45 Z; px 29 46 z; px 33 46 z; px 31 46 z; px 30 47 z; px 32 47 z
px 40 46 S; px 41 46 S; px 40 47 s; px 41 47 S; px 39 47 s; px 42 47 s
// fascia trim along the roof's inner edge + ridge cap
line 12 56 55 18 t; line 13 56 55 19 T; line 55 18 99 56 t; line 55 19 98 56 T
line 11 56 55 17 o; line 55 17 100 56 o
fpoly 55 0 49 7 55 5 61 7 W; line 49 7 55 0 o; line 55 0 61 7 o; px 55 3 y
// porthole window with brass rim
fcircle 55 36 7 o; fcircle 55 36 6 K; circle 55 36 5 k; px 52 32 k; fcircle 55 36 4 G
gradient 51 32 9 9 h G; mask poly 51 40 59 32 60 33 52 41; frect 50 30 12 12 H; unmask; px 53 34 H
// walls: painted clapboard with weathering, shadow under the eave
planks 10 56 92 42 h 5 ${RAMP.wall} 5
gradient 10 56 92 8 #0c182066 transparent
noise 10 60 92 36 #a3dcc6 0.015 9
noise 10 60 92 36 #2f6a6e 0.02 10
// corner boards
frect 9 56 4 42 T; line 9 56 9 97 t; line 12 56 12 97 q
frect 99 56 4 42 T; line 99 56 99 97 t; line 102 56 102 97 q
// eave ends sticking out
frect 1 55 11 3 W; line 1 57 11 57 D; frect 100 55 11 3 W; line 100 57 110 57 D
// windows (frame, sea view through the glass, curtains, muntins, sill)
frect 18 62 18 20 D; frect 19 63 16 18 W
gradient 20 64 14 16 h G; frect 20 74 14 6 g; line 20 74 33 74 H; px 23 77 h; px 29 76 h
frect 20 64 3 16 S; line 22 64 22 79 s; frect 31 64 3 16 S; line 31 64 31 79 s
line 27 64 27 79 w; line 20 71 33 71 w; rect 17 61 20 22 o
frect 16 82 22 3 W; line 16 84 37 84 D; line 16 82 37 82 y
frect 76 62 18 20 D; frect 77 63 16 18 W
gradient 78 64 14 16 h G; frect 78 74 14 6 g; line 78 74 91 74 H; px 81 76 h; px 88 77 h
frect 78 64 3 16 S; line 80 64 80 79 s; frect 89 64 3 16 S; line 89 64 89 79 s
line 85 64 85 79 w; line 78 71 91 71 w; rect 75 61 20 22 o
frect 74 82 22 3 W; line 74 84 95 84 D; line 74 82 95 82 y
// flower box under the left window
frect 18 85 18 6 w; line 18 85 35 85 W; line 18 90 35 90 D; rect 17 84 20 8 o
px 20 83 e; px 21 82 E; px 22 83 e; px 23 84 L; px 26 83 e; px 27 82 E; px 30 83 e; px 31 82 e; px 33 83 E; px 34 84 L
px 21 81 b; px 24 82 k; px 27 81 b; px 29 82 S; px 32 81 k; px 34 82 b; px 25 83 L; px 28 84 L
// door: vertical boards, trim, life buoy, brass knob
frect 46 61 20 37 T; line 46 61 65 61 t; line 46 61 46 97 t; line 65 61 65 97 q
planks 48 63 16 35 v 4 ${RAMP.wood} 31
line 48 63 63 63 d; rect 45 60 22 38 o
fcircle 56 74 7 o; fcircle 56 74 6 t
mask poly 56 74 64 70 64 78; fcircle 56 74 6 b; unmask
mask poly 56 74 48 70 48 78; fcircle 56 74 6 b; unmask
mask poly 56 74 52 66 60 66; fcircle 56 74 6 b; unmask
mask poly 56 74 52 82 60 82; fcircle 56 74 6 b; unmask
fcircle 56 74 3 D; circle 56 74 3 o; px 53 70 S; px 54 69 S
px 61 84 k; px 61 85 K
// lantern beside the door
fcircle 70 70 6 #ffd86628
line 68 64 72 64 d; line 70 64 70 66 d; frect 68 66 5 7 o; frect 69 67 3 5 k; px 69 67 Z; line 68 73 72 73 d
// deck: board tops + front fascia, stilts, steps, crate, potted palm
planks 1 97 110 4 v 7 ${RAMP.wood} 41
line 1 97 110 97 y
planks 1 101 110 4 h 2 ${RAMP.wood} 42
line 1 104 110 104 d; rect 0 96 112 10 o
frect 5 106 4 6 D; line 5 106 5 111 w; frect 31 106 4 6 D; line 31 106 31 111 w
frect 77 106 4 6 D; line 77 106 77 111 w; frect 103 106 4 6 D; line 103 106 103 111 w
frect 46 106 20 3 W; line 46 106 65 106 y; line 46 108 65 108 D; frect 48 109 16 3 w; line 48 109 63 109 W; line 48 111 63 111 D
rect 45 105 22 8 o
planks 1 87 9 9 h 3 ${RAMP.wood} 51
rect 0 86 11 11 o; line 1 91 9 91 d; px 4 85 S; px 5 85 s; px 6 85 S
frect 101 90 8 7 c; line 101 90 108 90 C; line 101 96 108 96 x; rect 100 89 10 9 o
line 104 89 98 78 L; line 104 89 101 76 e; line 105 89 106 76 e; line 105 89 110 79 L; line 104 89 103 80 E
line 105 89 108 82 E; line 104 89 99 84 e; px 98 78 E; px 110 79 E; px 101 76 E; px 106 76 E
// chimney (stone) poking out of the right roof slope
mask poly 79 6 92 6 92 37 79 26
bricks 79 6 13 32 5 4 #2e2622 ${RAMP.stone} 61
unmask
line 79 6 79 26 o; line 92 6 92 37 o
frect 77 3 17 4 q; line 77 3 93 3 t; line 77 6 93 6 O; rect 76 2 19 6 o
outline o
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
frect 34 45 28 28 g; frect 34 49 28 3 h; frect 34 56 28 3 h; frect 34 63 28 3 h; frect 34 70 28 3 h
line 34 45 61 45 H; line 34 45 34 72 G; rect 33 44 30 30 o
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
frect 64 64 48 32 G; frect 64 68 48 3 S; frect 64 74 48 3 n; frect 64 80 48 3 S; frect 64 86 48 3 n
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
