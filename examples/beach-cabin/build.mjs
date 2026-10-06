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

// Ramps (dark -> light) tuned after reading vanilla tiles with `px read`: few, saturated, warm tones;
// ramp[0] doubles as board gap and outline (never black); interiors are brighter and lower contrast.
const RAMP = {
  wall: '#4e2a0a,#7a4404,#965206,#b86c10,#d89036', roof: '#4a2a0a,#62380a,#7e4a10,#9c6214,#bc8030',
  post: '#3e2008,#5e3206,#7a4208,#9a5a0e,#bc7826', teal: '#123a32,#1d5a48,#2a7a5e,#3d9a74,#62bc8e',
  floor: '#b06033,#c87838,#dc8e3e,#f0a84c,#ffc466', inwall: '#5a2c16,#7e4020,#9a5428,#b46a32,#d08a40',
};
const PAL = `pal o #3a1e08; pal d #4e2a0a; pal D #7a4404; pal w #965206; pal W #b86c10; pal y #d89036; pal Y #f0b860;
pal v #2a1408; pal V #4a2410; pal R #b8322a; pal r #7e1e1c; pal Q #f0e6d0; pal q #c8b898;
pal m #2e2c34; pal M #4a4852; pal I #6e6c78; pal i #9a98a4; pal k #f8d468; pal K #d8a030; pal Z #fff0b0;
pal l #2e5a14; pal L #4a7a1e; pal e #6aa02a; pal E #94c83a; pal n #d8b878; pal N #a07a40;
pal z #e87838; pal c #b8502c; pal C #e08048; pal x #7e3020; pal s #e8c0a0; pal S #fff0dc;
pal g #3a7ac0; pal G #5aa0e0; pal h #8cccf4; pal H #d8f4ff; pal b #c83a3a; pal t #f0e6d0; pal T #c8b898; pal j #5a2414;
pal u #123a32; pal U #1d5a48; pal a #2a7a5e; pal A #3d9a74; pal B #62bc8e; pal f #4a2418; pal F #21000060`;

// ---------------------------------------------------------------- exterior (112 x 112)
const ext = applyOps(newImg(112, 112), `${PAL}
// --- roof: boards down each slope, lit edge before each gap (vanilla roof structure)
mask poly 55 2 -1 57 -1 62 16 62 55 22
dplanks 0 0 56 62 135 5 ${RAMP.roof} 11
unmask
mask poly 56 2 112 57 112 62 95 62 56 22
dplanks 56 0 56 62 45 5 ${RAMP.roof} 12
unmask
// thick fascia boards on the gable edge, board ends at the eaves
line 16 62 55 23 y; line 17 62 55 24 W; line 18 62 55 25 w; line 19 62 55 26 D
line 95 62 56 23 W; line 94 62 56 24 w; line 93 62 56 25 D; line 92 62 56 26 D
frect 0 59 16 4 D; line 0 59 15 59 W; line 0 62 15 62 d; frect 96 59 16 4 D; line 96 59 111 59 w; line 96 62 111 62 d
fpoly 55 0 45 11 49 11 55 5 61 11 65 11 56 0 W; line 45 11 55 0 y; line 56 0 65 11 D; line 49 11 55 5 d; line 55 5 61 11 d
// --- gable boards + vent + shadow under the fascia
mask poly 55 26 20 62 91 62
planks 18 24 76 38 h 6 ${RAMP.wall} 21
fpoly 55 26 20 62 28 62 55 34 83 62 91 62 F
fpoly 55 31 47 40 63 40 v; line 48 38 62 38 V; line 50 36 60 36 V; line 52 34 58 34 V; line 47 40 63 40 d
unmask
// buoy on the gable
line 32 47 32 49 N; fcircle 32 53 4 Q; mask poly 32 53 36 49 36 57; fcircle 32 53 4 R; unmask; mask poly 32 53 28 49 28 57; fcircle 32 53 4 R; unmask
px 30 50 S; fcircle 32 53 1 v; circle 32 53 4 d
// --- walls, corner posts, eave shadow
planks 12 62 88 40 h 6 ${RAMP.wall} 5
frect 12 62 88 4 F; frect 12 66 88 2 #21000030
planks 10 60 5 42 v 5 ${RAMP.post} 31
planks 97 60 5 42 v 5 ${RAMP.post} 32
line 10 60 10 101 o; line 101 60 101 101 o; line 11 60 11 101 y
// --- windows: dark panes + warm glint, sea-green shutters, sill
frrect 20 72 18 18 d; frect 21 73 16 16 W; frect 22 74 14 14 v; line 28 74 28 87 D; line 22 80 35 80 D
px 23 75 V; px 24 75 V; px 23 76 V; px 30 81 V; px 31 81 V; px 30 82 V
planks 15 72 5 18 v 5 ${RAMP.teal} 61; planks 38 72 5 18 v 5 ${RAMP.teal} 62
rect 15 72 5 18 d; rect 38 72 5 18 d
frect 18 90 22 3 y; line 18 92 39 92 D; line 18 90 39 90 Y; rrect 17 89 24 5 d
frrect 74 72 18 18 d; frect 75 73 16 16 W; frect 76 74 14 14 v; line 82 74 82 87 D; line 76 80 89 80 D
px 77 75 V; px 78 75 V; px 77 76 V; px 84 81 V; px 85 81 V; px 84 82 V
planks 69 72 5 18 v 5 ${RAMP.teal} 63; planks 92 72 5 18 v 5 ${RAMP.teal} 64
rect 69 72 5 18 d; rect 92 72 5 18 d
frect 72 90 22 3 y; line 72 92 93 92 D; line 72 90 93 90 Y; rrect 71 89 24 5 d
// --- door: sea-green boards, light frame, knob, starfish
frect 46 68 20 34 W; line 46 68 65 68 Y; line 46 68 46 101 y; line 65 68 65 101 D
planks 48 70 16 32 v 4 ${RAMP.teal} 41
line 48 70 63 70 u; rect 45 67 22 35 d; px 60 86 k; px 60 87 K
px 56 62 z; px 55 63 z; px 57 63 z; px 56 63 C; px 54 64 z; px 58 64 z; px 56 64 z; px 55 65 z; px 57 65 z
// --- lantern
fcircle 70 76 7 #ffd06020
line 68 69 72 69 d; line 70 69 70 71 d; frrect 68 71 5 8 d; frect 69 72 3 5 k; px 69 72 Z; line 68 79 72 79 d
// --- stovepipe
mask poly 80 4 87 4 87 34 80 27
frect 80 4 7 31 M; line 81 4 81 34 i; line 82 4 82 34 I; line 86 4 86 34 m; line 80 14 86 14 m; line 80 24 86 24 m
unmask
frrect 78 1 11 4 M; line 79 1 87 1 i; line 79 4 87 4 m; rrect 77 0 13 6 o; line 79 5 79 27 o; line 87 5 87 34 o
outline o
// --- ground props + contact shadow
frect 46 102 20 4 w; line 46 102 65 102 y; line 46 105 65 105 D; rrect 45 101 22 6 o
frrect 2 86 10 16 w; planks 3 87 8 14 v 2 ${RAMP.post} 51; line 2 89 11 89 M; line 2 97 11 97 M; line 3 87 10 87 y; rrect 1 85 12 18 o
line 106 101 101 63 N; line 107 101 102 63 d; px 101 62 i; frect 104 93 3 2 M
fcircle 39 100 3 n; circle 39 100 3 N; circle 39 100 1 N
line 15 101 13 95 L; line 16 101 16 94 e; line 17 101 19 96 E; line 18 101 21 98 L; line 14 101 11 98 e; px 16 94 E
line 92 101 90 96 e; line 93 101 94 94 E; line 94 101 97 97 L; line 95 101 96 98 e; px 94 94 E
frect 6 102 100 3 #21000038; frect 10 105 92 2 #21000020
`);
writePNG(path.join(MOD, 'assets/beach_cabin_exterior.png'), ext);
writePNG(path.join(IMG, 'beach_cabin_exterior.png'), ext);

// ---------------------------------------------------------------- interior tilesheet (8 x 6 tiles)
// 0 void | 1,2 floor | 3 floor w/ wall shadow | 4 doormat | 5 wall top | 6 wall mid | 7 wall bottom
// 8,9,16,17 window (2x2) | 10 shelf | 11 lamp | bed 18,19,26,27,34,35 | table 20,21,28,29 | plant 22,30 | rug 36,37,38,44,45,46
const wallTop = `planks 0 0 16 16 v 5 ${RAMP.inwall} 3; frect 0 0 16 4 j; line 0 4 15 4 x; frect 0 5 16 2 #21000040`;
const wallMid = `planks 0 0 16 16 v 5 ${RAMP.inwall} 4`;
const wallBot = `planks 0 0 16 16 v 5 ${RAMP.inwall} 6; frect 0 10 16 6 D; line 0 10 15 10 y; line 0 11 15 11 W; line 0 15 15 15 d`;
const sheet = applyOps(newImg(128, 96), `${PAL}
frame 16 16 0; frect 0 0 16 16 #0e0a0c
frame 16 16 1; planks 0 0 16 16 v 4 ${RAMP.floor} 71
frame 16 16 2; planks 0 0 16 16 v 4 ${RAMP.floor} 72
frame 16 16 3; planks 0 0 16 16 v 4 ${RAMP.floor} 73; frect 0 0 16 4 #4a201050; frect 0 4 16 2 #4a201028
frame 16 16 4; planks 0 0 16 16 v 4 ${RAMP.floor} 74; frrect 1 3 14 10 x; frrect 2 4 12 8 c; line 3 6 12 6 C; line 3 9 12 9 C; line 2 11 13 11 x
frame 16 16 5; ${wallTop}
frame 16 16 6; ${wallMid}
frame 16 16 7; ${wallBot}
frame 16 16 8; ${wallTop}
frame 16 16 9; ${wallTop}
frame 16 16 16; ${wallMid}
frame 16 16 17; ${wallMid}
endframe
frrect 3 22 26 22 f; frect 4 23 24 20 y; frect 5 24 22 18 W
frect 6 25 20 8 h; frect 6 25 20 3 H; frect 6 33 20 3 G; frect 6 36 20 4 g; line 6 36 25 36 h; px 9 38 h; px 18 37 h; px 21 39 G
line 16 25 16 39 y; line 6 31 25 31 y; line 6 40 25 40 D
frect 6 25 3 15 S; line 8 25 8 39 s; frect 23 25 3 15 S; line 23 25 23 39 s
frect 2 44 28 3 y; line 2 44 29 44 Y; line 2 46 29 46 D; rrect 1 43 30 5 f
frame 16 16 10; ${wallMid}; frect 1 10 14 2 W; line 1 10 14 10 y; line 1 12 14 12 d; frect 2 5 2 5 L; px 2 4 E; px 3 4 e; frrect 6 7 4 3 S; px 7 6 s; px 8 6 S; frect 11 5 2 5 a; px 11 4 B; px 12 6 B
frame 16 16 11; ${wallMid}; fcircle 8 8 6 #ffd06030; line 6 3 10 3 d; frrect 6 4 5 8 f; frect 7 5 3 6 k; px 7 5 Z; line 6 12 10 12 d
endframe
frrect 33 32 30 7 f; frect 34 33 28 5 w; line 34 33 61 33 y; line 34 37 61 37 D
frrect 34 38 28 9 f; frect 35 39 26 7 S; line 35 45 60 45 q; frrect 36 39 11 5 t; frrect 49 39 11 5 t; line 37 43 45 43 q; line 50 43 58 43 q
frrect 33 46 30 28 f; frect 34 47 28 26 U
mask rect 34 47 28 26; frect 34 47 7 6 a; frect 48 47 7 6 a; frect 41 53 7 6 a; frect 55 53 7 6 a; frect 34 59 7 6 a; frect 48 59 7 6 a; frect 41 65 7 6 a; frect 55 65 7 6 a; unmask
line 34 47 61 47 B; line 34 72 61 72 u
frrect 33 72 30 6 f; frect 34 73 28 4 w; line 34 73 61 73 y; line 34 76 61 76 D
fcircle 80 45 12 f; fcircle 80 45 11 D; fcircle 80 44 10 w; fcircle 79 43 8 W; fcircle 78 42 5 y; px 76 39 Y; px 77 39 Y
frect 70 53 3 10 w; frect 87 53 3 10 w; line 70 53 70 62 y; line 72 53 72 62 D; line 87 53 87 62 y; line 89 53 89 62 D; frect 78 54 4 8 D; line 78 54 78 61 w
line 69 62 73 62 f; line 86 62 90 62 f; rrect 69 52 5 11 f; rrect 86 52 5 11 f
frrect 75 39 10 5 S; line 76 43 83 43 s; fcircle 80 38 2 R; px 79 37 C; fcircle 77 39 1 z; px 83 38 E
frrect 99 52 10 10 c; line 100 52 107 52 C; line 100 61 107 61 x; rrect 98 51 12 12 f; line 99 54 108 54 x
line 104 51 98 38 L; line 104 51 101 36 e; line 105 51 106 35 e; line 105 51 111 40 L; line 104 51 102 42 E
line 105 51 109 44 E; line 104 51 97 45 e; px 98 38 E; px 111 40 E; px 101 36 E; px 106 35 E; line 103 51 100 48 l
mask poly 67 70 72 65 104 65 109 70 109 89 104 94 72 94 67 89
frect 64 64 48 32 U; frect 70 69 36 21 a; frect 74 73 28 13 t; frect 78 76 20 7 A; frect 84 78 8 3 Q
line 64 67 111 67 B; line 64 91 111 91 u
unmask
line 67 70 72 65 f; line 72 65 104 65 f; line 104 65 109 70 f; line 109 70 109 89 f; line 109 89 104 94 f; line 104 94 72 94 f; line 72 94 67 89 f; line 67 89 67 70 f
// room frame (Front layer over the black void): 12 left, 13 right, 14 bottom, 15 top, corners 39 TL 47 TR 23 BL 31 BR, 40/41 corridor joints
frame 16 16 12; line 13 0 13 15 w; line 14 0 14 15 y; line 15 0 15 15 d
frame 16 16 13; line 0 0 0 15 d; line 1 0 1 15 y; line 2 0 2 15 w
frame 16 16 14; line 0 0 15 0 d; line 0 1 15 1 y; line 0 2 15 2 w
frame 16 16 15; line 0 13 15 13 w; line 0 14 15 14 y; line 0 15 15 15 d
frame 16 16 39; frect 13 13 3 3 w; line 14 14 15 14 y; line 14 14 14 15 y; px 15 15 d
frame 16 16 47; frect 0 13 3 3 w; line 0 14 1 14 y; line 1 14 1 15 y; px 0 15 d
frame 16 16 23; frect 13 0 3 3 w; line 14 1 15 1 y; line 14 0 14 1 y; px 15 0 d
frame 16 16 31; frect 0 0 3 3 w; line 0 1 1 1 y; line 1 0 1 1 y; px 0 0 d
frame 16 16 40; line 0 0 15 0 d; line 0 1 15 1 y; line 0 2 15 2 w; line 13 0 13 15 w; line 14 1 14 15 y; line 15 0 15 15 d
frame 16 16 41; line 0 0 15 0 d; line 0 1 15 1 y; line 0 2 15 2 w; line 0 0 0 15 d; line 1 1 1 15 y; line 2 0 2 15 w
endframe
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
  for (let y = 1; y <= 9; y++) { set(Front, 0, y, 12); set(Front, W - 1, y, 13); }                                       // room frame
  for (let x = 1; x <= W - 2; x++) { set(Front, x, 0, 15); if (x !== door) set(Front, x, 10, 14); }
  set(Front, 0, 0, 39); set(Front, W - 1, 0, 47); set(Front, 0, 10, 23); set(Front, W - 1, 10, 31);
  set(Front, door - 1, 10, 40); set(Front, door + 1, 10, 41); set(Front, door - 1, 11, 12); set(Front, door + 1, 11, 13);
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
