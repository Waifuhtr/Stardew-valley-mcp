# Stardew Sim — guide for AI agents

All vanilla Stardew Valley maps (259 incl. every building interior, mines, island, festival variants) extracted to
`web/data/` and exposed through two token-cheap tools. Use them instead of asking the user for screenshots.

- CLI: `node cli/sdv.mjs <cmd>` (maps / simulation) and `node cli/px.mjs <cmd>` (pixel art). No dependencies, Node ≥ 18.
- MCP: `node mcp/server.mjs` → tools `sdv` and `px`, each takes one `args` string (same syntax as the CLI).
  `render`, `sheet`, `px draw/ops/preview` also return the PNG inline so you can look at it.
- Web: `web/` (GitHub Pages). Deep link: `.../#SeedShop@6,29/fall` = map@tileX,tileY/season.

Coordinates are always **tiles** (1 tile = 16 px), origin top-left. Warps use location names (`Town`, `SeedShop`);
`sdv` resolves names that differ from map assets (e.g. `CommunityCenter` → `CommunityCenter_Ruins`, `IslandSouth` → `Island_S`).

## Cheap → expensive workflow

1. `sdv find <text>` / `sdv maps <filter>` — locate a place (≈1 line per hit).
2. `sdv info <map>` — size, properties, grouped warps in/out, action tiles.
3. `sdv ascii <map> x y w h` — collision view of only the area you need. Legend:
   `.` floor `#` blocked `~` water ` ` void `D` door/warp-in `W` edge warp `!` action tile `@` actor `*` path.
   For a whole big map use `--step 2` (or 3) first.
4. `sdv tile <map> x y` — exact layers, tilesheet index, properties of one tile.
5. `sdv render ... --region x,y,w,h` — pixels, only when you must see art. Keep regions small (≤ 40×30 tiles).

## Simulating the NPC

- `sdv path <map> x1 y1 x2 y2 [--ascii]` → `len 32: U2 R1 U3 ...` (A*, 4-dir, same passability as the game:
  Back tile required, no Buildings tile unless `Passable`, Water blocks, `Door` tiles pass).
- `sdv go <map> x y <targetMap> [tx ty]` → walks through doors/edge warps across maps, one line per map.
- `sdv render <map> --region ... --actor x,y,dir --path x1,y1,x2,y2` → the sample NPC (`web/data/img/extra/sprites.png`,
  override with `--sprite file.png`) drawn in place, path highlighted. Directions: down/right/up/left.

## Adding / editing locations consistently

- New building or object in an existing map: `sdv fit Town x y w h --door dx,dy` → FITS / CONFLICT with covered
  warps/actions, cut-off areas, door reachability, plus an ASCII preview.
- Start a new location from a vanilla template: `sdv tmx <map> -o MyPlace.tmx` (Tiled TMX, xTile TileData objects,
  tilesheet names kept so the game resolves them).
- Validate: `sdv check MyPlace.tmx [--locs MyPlace,Other]` → missing layers, non-vanilla tilesheets, warp targets
  outside/blocked, incoming warps landing on walls, disconnected warp areas.
- Preview a Content Patcher `EditMap` (`FromFile` + `ToArea`): `sdv patch Town Patch.tmx x y [--pass]`.
- `sdv sheet spring_town --idx 993` → tile index ↔ column/row; `sdv sheet spring_town -o grid.png --grid` → numbered sheet.

Rules worth remembering: layers `Back`, `Buildings`, `Front` (+`AlwaysFront`, `Paths`, numbered `Back2`...);
outdoor maps reference `spring_*` sheets (the game swaps season); door = `Action LockedDoorWarp tx ty Location open close`
on a Buildings tile; edge warp = map property `Warp: x y Location tx ty` with x/y = -1 or width/height.

## Pixel art (`px`)

PXT text sprite (what you write/read instead of pixels):
```
pxt 16x16
. transparent
k #222034
s #f0c8a0
--
......kkkk......
@layer hat 4 0        <- optional layers: name + offset; rows may be smaller than the canvas
.kkkk.
```
Rows: one char per pixel, `4k` = `kkkk`. Palette chars: any non-digit. Layers are cropped to content, so editing
one part (hair, outfit) means reading/writing only that block.

Cheap workflow for a sprite:
1. `px spec npc` (sizes/rows) → `px pal weapons --top 16` or `px ramp #8e6fd1 5` (pick colors, one line).
2. Write PXT → `px draw - -o out.png --scale 8 --lock weapons` (lock = snap to palette, reports off-palette px).
3. Look at the preview only once; fix by editing rows or with ops instead of rewriting.
4. Animation: draw frame 0, then `px ops sheet.png -o sheet.png "copyframe 16 32 0 1; frame 16 32 1; move 4 20 3 6 4 19"`
   and verify with `px diff sheet.png --frame 16,32,0,1` (changed pixels grouped by color, no image needed)
   or `px onion sheet.png --frame 16,32,1 -o o.png` (frame over faint neighbours).
5. In-game look: `sdv render Town --region 40,55,10,8 --place item.png@45,60`.

Other: `px read sheet.png --frame 16,32,0` (PNG → PXT), `px layers f.pxt [-o dir]`, `px draw f.pxt --layer hat` /
`--hide hat`, `px snap in.png --pal TileSheets/weapons`, `px new npc -o f.png`, `px check f.png --as npc`,
`px preview f.png --frames 16,32,0,1,2,3`, `px slice`/`px pack`, `px ops-help` (px line rect frect circle fill replace
outline flip rot shift mirror hue sat light quantize dither paste frame copy move copyframe remap snap).

NPC sheet: 64 px wide, 16×32 frames, rows = down, right, up, left (4 walk frames each). Portraits: 64×64, 2 columns.
The web editor (🎨 tab) mirrors all of this for the human to check: layers, onion skin, select/move/copy, palette lock,
ramp, Stardew row labels, live `check`, PXT import/export ("PXT → yeni katman" overlays an AI suggestion).

## Data

`web/data/index.json` → `{maps:{name:{w,h,out,warps:[[x,y,target,tx,ty,kind]]}}, textures:{key:[w,h]}}`
(kind: `w` edge/prop warp, `d` door/action warp, `t` touch warp). `web/data/maps/<name>.json` holds layers as base64
Uint16 gids, `sheets[{id,img,cols,rows,first,tp}]`, `anim`, `tp` (tile props). Prefer the CLI over reading these.
Re-extract from your own game files: `node tools/extract.mjs <folder with Maps/ TileSheets/ ...> web/data`
(Android LZ4 / uncompressed XNB, or a PC folder unpacked with StardewXnbHack: .tmx + .png). PC LZX-compressed XNB must be unpacked first.
