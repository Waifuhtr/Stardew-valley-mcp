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
// Style matched to vanilla cabin interiors (compared side by side with ElliottHouse): wide low-contrast floor boards,
// fine wall battens with beam + baseboard, thick rounded room frame, warm-lit windows with sun patches, 3/4 furniture.
// 0 void | 1,2 floor | 3 floor under wall | 4 doormat | 5 wall top | 6 wall mid | 7 wall bottom | 8,9,16,17 window
// 10 shelf | 11 sconce | 12-15,23,31,39,47,40,41 frame | bed 18,19,26,27,34,35 | table 20,21,28,29 | plant 22,30
// rug 36-38,44-46 | 24,25 sun patch | 32 picture | 33 ceiling lamp | 42 stool | 43 sea chest
const IN = { floor: '#3a1a0c,#5a2c12,#6e3a18,#80481e,#985a26', wall: '#2e180c,#46260f,#563014,#643a18,#74441e',
  hog: '#3a100c,#5a1c14,#7a2a1c,#983a24,#b4502e', blue: '#121a4a,#1c2a7a,#2a40a8,#4a64c8,#7a94e0' };
const K = ['#3a1e0c', '#8a5a26', '#b07a3a', '#6a3e18', '#2a1408']; // frame: inner -> outer
const wallTop = `planks 0 0 16 16 v 3 ${IN.wall} 3; frect 0 0 16 4 #8a5a26; line 0 0 15 0 #b07a3a; line 0 3 15 3 #3a1e0c; frect 0 4 16 2 #21000050`;
const wallMid = `planks 0 0 16 16 v 3 ${IN.wall} 4`;
const wallBot = `planks 0 0 16 16 v 3 ${IN.wall} 6; frect 0 11 16 5 #3a1e0c; line 0 11 15 11 #8a5a26; line 0 12 15 12 #6a3e18`;
const ring = (cx, cy, mx, my) => `mask rect ${mx} ${my} 5 5; ${[4, 3, 2, 1].map(r => `fcircle ${cx} ${cy} ${r} ${K[r]}`).join('; ')}; px ${cx} ${cy} ${K[0]}; unmask`;
const sheet = applyOps(newImg(128, 96), `${PAL}
frame 16 16 0; frect 0 0 16 16 #0e0a0c
frame 16 16 1; planks 0 0 16 16 h 8 ${IN.floor} 71
frame 16 16 2; planks 0 0 16 16 h 8 ${IN.floor} 72
frame 16 16 3; planks 0 0 16 16 h 8 ${IN.floor} 73; frect 0 0 16 3 #21000060; frect 0 3 16 2 #21000030
frame 16 16 4; planks 0 0 16 16 h 8 ${IN.floor} 74; frrect 1 3 14 10 #5a2414; frrect 2 4 12 8 #8a3a22; line 3 6 12 6 #a8502c; line 3 9 12 9 #a8502c; line 2 11 13 11 #5a2414; frect 1 13 14 1 #21000040
frame 16 16 5; ${wallTop}
frame 16 16 6; ${wallMid}
frame 16 16 7; ${wallBot}
frame 16 16 8; ${wallTop}
frame 16 16 9; ${wallTop}
frame 16 16 16; ${wallMid}
frame 16 16 17; ${wallMid}
endframe
// window (2x2): wood frame, warm daylight panes, muntins, sill
frrect 6 19 20 27 f; frect 7 20 18 25 W; line 7 20 24 20 y; frect 9 22 14 21 #f8f0c8; frect 9 33 14 10 #f0d890; line 9 42 22 42 #d8b060
line 16 22 16 42 W; line 9 32 22 32 W; line 15 22 15 42 #d8b060; px 10 23 #ffffff; px 11 23 #ffffff; px 10 24 #ffffff
frect 4 45 24 3 y; line 4 45 27 45 Y; line 4 47 27 47 D; rrect 3 44 26 5 f
// shelf + sconce
frame 16 16 10; ${wallMid}; frect 1 10 14 2 W; line 1 10 14 10 y; line 1 12 14 12 d; frect 2 5 2 5 L; px 2 4 E; px 3 4 e; frrect 6 7 4 3 S; px 7 6 s; px 8 6 S; frect 11 5 2 5 a; px 11 4 B; px 12 6 B
frame 16 16 11; ${wallMid}; fcircle 8 8 6 #ffd06030; line 6 3 10 3 d; frrect 6 4 5 8 f; frect 7 5 3 6 k; px 7 5 Z; line 6 12 10 12 d
// room frame
frame 16 16 12; ${[4, 3, 2, 1, 0].map((k, i) => `line ${11 + i} 0 ${11 + i} 15 ${K[k]}`).join('; ')}
frame 16 16 13; ${[0, 1, 2, 3, 4].map((k, i) => `line ${i} 0 ${i} 15 ${K[k]}`).join('; ')}
frame 16 16 14; ${[0, 1, 2, 3, 4].map((k, i) => `line 0 ${i} 15 ${i} ${K[k]}`).join('; ')}
frame 16 16 15; ${[4, 3, 2, 1, 0].map((k, i) => `line 0 ${11 + i} 15 ${11 + i} ${K[k]}`).join('; ')}
frame 16 16 39; ${ring(15, 15, 11, 11)}
frame 16 16 47; ${ring(0, 15, 0, 11)}
frame 16 16 23; ${ring(15, 0, 11, 0)}
frame 16 16 31; ${ring(0, 0, 0, 0)}
frame 16 16 40; ${[0, 1, 2, 3, 4].map((k, i) => `line 0 ${i} 15 ${i} ${K[k]}`).join('; ')}; ${[0, 1, 2, 3, 4].map(k => `line ${15 - k} ${k + 1} ${15 - k} 15 ${K[k]}`).join('; ')}
frame 16 16 41; ${[0, 1, 2, 3, 4].map((k, i) => `line 0 ${i} 15 ${i} ${K[k]}`).join('; ')}; ${[0, 1, 2, 3, 4].map(k => `line ${k} ${k + 1} ${k} 15 ${K[k]}`).join('; ')}
// picture (seascape) + ceiling lamp
frame 16 16 32; ${wallMid}; frect 2 2 12 10 #21000040; frrect 2 1 12 10 f; frect 3 2 10 8 #c88a3a; frect 4 3 8 6 #8cccf4; frect 4 6 8 3 #3a7ac0; line 4 6 11 6 #d8f4ff; px 9 4 #fff0a0; px 10 4 #fff0a0; px 6 8 #5aa0e0
frame 16 16 33; ${wallTop}; fcircle 8 11 7 #ffd06024; line 8 0 8 6 #2a1408; frrect 5 6 7 3 #3a1e0c; frect 6 9 5 4 k; px 6 9 Z; line 5 13 11 13 d; px 8 14 d
// stool + sea chest
frame 16 16 42; frect 4 14 9 2 #21000040; frrect 3 5 10 4 f; frect 4 6 8 2 W; line 4 6 11 6 y; frect 4 9 2 6 D; frect 10 9 2 6 D; line 5 12 10 12 w
frame 16 16 43; frect 1 14 14 2 #21000040; frrect 1 4 14 11 f; frect 2 5 12 4 ${IN.hog.split(',')[3]}; line 2 5 13 5 ${IN.hog.split(',')[4]}; frect 2 9 12 5 ${IN.hog.split(',')[2]}; line 2 9 13 9 f; line 2 13 13 13 ${IN.hog.split(',')[1]}; frect 7 8 2 3 k; px 7 8 Z; px 2 5 K; px 13 5 K; px 2 13 K; px 13 13 K
// sun patches (Back2, semi-transparent)
endframe
fpoly 5 49 26 49 28 59 7 59 #fff0b05a; line 16 49 17 59 #a0602030; line 6 54 27 54 #a0602030
// bed 2x3 (3/4 view): carved headboard, pillows, quilt with folds, footboard
frect 33 32 3 44 f; frect 60 32 3 44 f; frect 34 33 1 42 ${IN.hog.split(',')[4]}; frect 61 33 1 42 ${IN.hog.split(',')[3]}
frrect 35 33 26 12 f; frect 36 34 24 10 ${IN.hog.split(',')[2]}; line 36 34 59 34 ${IN.hog.split(',')[4]}; frrect 39 36 18 6 ${IN.hog.split(',')[1]}; line 39 36 56 36 f; px 47 35 k; px 48 35 k
frrect 37 41 11 6 f; frect 38 42 9 4 t; line 38 45 46 45 T; frrect 48 41 11 6 f; frect 49 42 9 4 t; line 49 45 57 45 T
frect 35 47 26 3 t; line 35 49 60 49 T; frect 35 50 26 18 ${IN.blue.split(',')[2]}; line 35 50 60 50 ${IN.blue.split(',')[3]}
line 41 51 40 66 ${IN.blue.split(',')[1]}; line 42 51 41 66 ${IN.blue.split(',')[3]}; line 54 51 55 66 ${IN.blue.split(',')[1]}; line 53 51 54 66 ${IN.blue.split(',')[3]}
frect 35 64 26 4 ${IN.blue.split(',')[1]}; line 35 64 60 64 ${IN.blue.split(',')[3]}; line 36 59 46 58 ${IN.blue.split(',')[4]}
frrect 34 67 28 10 f; frect 35 68 26 8 ${IN.hog.split(',')[2]}; line 35 68 60 68 ${IN.hog.split(',')[4]}; frrect 38 70 20 4 ${IN.hog.split(',')[1]}; line 38 70 57 70 f
frect 34 77 3 2 f; frect 59 77 3 2 f; frect 36 78 24 1 #21000040
// table 2x2 (3/4 view): top, apron, legs, jar of shells, book
frect 68 61 24 2 #21000040
frrect 66 40 28 11 f; frect 67 41 26 9 W; line 67 41 92 41 Y; line 67 44 92 44 w; line 67 47 92 47 w; px 72 45 D; px 85 42 D
frect 67 50 26 4 D; line 67 53 92 53 d; frect 67 54 3 8 w; line 67 54 67 61 y; frect 90 54 3 8 w; line 92 54 92 61 d; rrect 66 49 28 6 f
frrect 72 33 7 9 #2a5a5a; frect 73 34 5 7 #bfe4e0; line 73 34 73 40 #ffffff; px 75 38 C; px 76 37 S; px 74 39 z; frect 72 32 7 2 D
frrect 82 38 9 4 f; frect 83 39 7 2 R; line 83 39 89 39 #e05a4a
// potted palm (2 tall)
frrect 99 52 10 10 c; line 100 52 107 52 C; line 100 61 107 61 x; rrect 98 51 12 12 f; line 99 54 108 54 x; frect 99 62 10 2 #21000040
fpoly 104 51 96 42 98 40 105 49 e; fpoly 104 51 99 35 102 35 105 50 L; fpoly 105 51 110 38 112 40 106 51 e; fpoly 105 51 108 34 110 36 106 50 E
fpoly 104 51 97 47 97 45 104 49 L; line 104 51 98 41 l; line 105 51 109 37 l; px 99 35 E; px 109 34 E
// rug 3x2
mask poly 67 70 72 65 104 65 109 70 109 89 104 94 72 94 67 89
frect 64 64 48 32 U; frect 70 69 36 21 a; frect 74 73 28 13 t; frect 78 76 20 7 A; frect 84 78 8 3 Q
line 64 67 111 67 B; line 64 91 111 91 u
unmask
line 67 70 72 65 f; line 72 65 104 65 f; line 104 65 109 70 f; line 109 70 109 89 f; line 109 89 104 94 f; line 104 94 72 94 f; line 72 94 67 89 f; line 67 89 67 70 f
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
  // furniture + wallpaper/floor are real game items, kept in web/data/mods/beach-cabin/mod.json (sdv place/decorate --save --mod beach-cabin)
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
const prev = fs.existsSync(path.join(WEB, 'mod.json')) ? JSON.parse(fs.readFileSync(path.join(WEB, 'mod.json'), 'utf8')) : {};
fs.writeFileSync(path.join(WEB, 'mod.json'), JSON.stringify({
  id: 'beach-cabin', title: 'Plaj Kabini', furniture: prev.furniture, decor: prev.decor,
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
// bake real furniture + wallpaper/floor (from mod.json) into the CP interior; seats via Data/ChairTiles
const { bakeLocation, loadMap: simMap, sdv } = await import('../../cli/commands.mjs');
const baked = bakeLocation(INSIDE.name, 'z_beach_cabin_furniture');
// "bare" room (wallpaper/floor only) used when the Stardew Sim Bridge SMAPI mod places real furniture objects
fs.writeFileSync(path.join(MOD, 'assets/BeachCabin_Bare.tmx'), mapToTmx(new GameMap(simMap(INSIDE.name).j)));
await sdv(['ss-export', 'beach-cabin', '-o', path.join(ROOT, 'mods'), '--name', '[SS] Beach Cabin Furniture']);
fs.writeFileSync(path.join(MOD, 'assets/BeachCabin.tmx'), mapToTmx(baked.map).replace(/source="(z_beach_cabin_interior)\.png"/, 'source="beach_cabin_interior.png"'));
writePNG(path.join(MOD, 'assets/z_beach_cabin_furniture.png'), baked.sheet);
fs.writeFileSync(path.join(MOD, 'content.json'), JSON.stringify({
  Format: '2.0.0',
  Changes: [
    { Action: 'Load', Target: `Maps/${INSIDE.name}`, FromFile: 'assets/BeachCabin.tmx', When: { 'HasMod |contains=Waifuhtr.StardewSim': false } },
    { Action: 'Load', Target: `Maps/${INSIDE.name}`, FromFile: 'assets/BeachCabin_Bare.tmx', When: { HasMod: 'Waifuhtr.StardewSim' } },
    { Action: 'EditData', Target: 'Data/Locations', Entries: { [INSIDE.name]: { DisplayName: 'Beach Cabin', DefaultArrivalTile: { X: INSIDE.arrive[0], Y: INSIDE.arrive[1] }, CreateOnLoad: { MapPath: `Maps/${INSIDE.name}` } } } },
    { Action: 'EditData', Target: 'Data/ChairTiles', Entries: baked.chairTiles, When: { 'HasMod |contains=Waifuhtr.StardewSim': false } },
    { Action: 'EditMap', Target: 'Maps/Beach', FromFile: 'assets/BeachCabin_Exterior.tmx', ToArea: { X: PLACE.x, Y: PLACE.y, Width: PLACE.w, Height: PLACE.h }, PatchMode: 'ReplaceByLayer' },
  ],
}, null, 2));
console.log('built beach cabin');
