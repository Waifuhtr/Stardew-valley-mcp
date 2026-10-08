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
- CP `EditMap` default `PatchMode: ReplaceByLayer` ERASES target tiles under empty patch cells (black void behind a
  building). Use `Overlay` for buildings/props on existing ground; `sdv patch` warns about this.
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
5. In-game look: `sdv render Town --region 40,55,10,8 --place item.png@45,60`. Spec `file.png@x,y[@fw,fh,i][@top]`
   (bottom-left of the image on tile x,y, fractional ok; `@fw,fh,i` = one frame of a sheet; `@top` = above Front
   layers, for effects). Every place prints its pixel rect + % visible / % hidden behind Front and warns when nothing
   shows. Unknown frame size → `px frames sheet.png` (from transparent gaps + Stardew conventions).

Other: `px read sheet.png --frame 16,32,0` (PNG → PXT), `px layers f.pxt [-o dir]`, `px draw f.pxt --layer hat` /
`--hide hat`, `px snap in.png --pal TileSheets/weapons`, `px new npc -o f.png`, `px check f.png --as npc`,
`px preview f.png --frames 16,32,0,1,2,3`, `px slice`/`px pack`, `px ops-help` (px line rect frect circle fill replace
outline flip rot shift mirror hue sat light quantize dither paste frame copy move copyframe remap snap).

Vanilla look (learned by reading vanilla tiles with `px read --rect`; do that first for any new material):
- one material family per object, max one accent; no pure white/black. Wood = saturated orange-browns (#935000 range).
- interiors: brighter, low-contrast floors (#d98f3b range, gaps only one step darker); orange room frame around the black void.
- shadows are flat semi-transparent bands (#21000040..60), not dithered gradients.
- hand-picked 5-step ramps per material; dark outline = darkest wood tone (#2a160e), never black.
- boards: lit top edge + dark gap + butt joints + short knot dashes (`planks`/`dplanks`); no random single-pixel noise.
- roofs: boards run down each slope (`dplanks` 135/45 under a `mask poly`), thick fascia, deep solid shadow under eaves.
- windows look dark from outside (interior), tiny reflection; ground it: contact shadow, grass tufts, props at the base.
- compare against a vanilla neighbour with `sdv render <map> --region ...` before finishing.

NPC sheet: 64 px wide, 16×32 frames, rows = down, right, up, left (4 walk frames each). Portraits: 64×64, 2 columns.
The web editor (🎨 tab) mirrors all of this for the human to check: layers, onion skin, select/move/copy, palette lock,
ramp, Stardew row labels, live `check`, PXT import/export ("PXT → yeni katman" overlays an AI suggestion).

## Real furniture, wallpaper, floors, seats

Catalog `web/data/furniture.json` (645 vanilla furniture, EN+TR names, from Data/Furniture + Strings/Furniture;
map seats from Data/ChairTiles; wallpaper/floor sets incl. AdditionalWallpaperFlooring). Rotation sprites, bounding
boxes and seats follow the game's own rules (Furniture.updateRotation / GetSeatPositions).
- `sdv furni find koltuk` / `--type rug` → `id name | type sprite box rotations price` (one line each).
- `sdv furni info <id|name>` → per rotation: sprite, box, seats with facing. `furni show` only if you must see it.
- `sdv place <map> <id> x y --rot 0-3` → OK/NO with reasons (floor vs wall item, overlaps, doors, cut-off paths);
  `--save [--mod id]` persists into web/data/mods/<id>/mod.json (default `user`); `unplace` removes; `furni list <map>`.
- `sdv walls wallpaper|floor` + `-o` swatch → `sdv decorate <map> --wallpaper 104 --floor 18 [--save]`
  (sets: plain number = vanilla walls_and_floors, `MoreWalls:N` / `MoreFloors:N`).
- `sdv seats <map>` (furniture + vanilla map benches), `sdv sit <map> x y` renders the NPC seated (front sprite over it).
- ascii shows `f` furniture, `h` seat. Rugs/wall items don't block.
- Shipping: `sdv bake <map> -o dir` → TMX + furniture tilesheet + `ChairTiles.json` (seats work in game via
  `EditData Data/ChairTiles`, the mechanism vanilla benches use; lamps/windows add `Light`). Beds baked this way
  are decoration only (no sleeping) — that needs real Furniture objects (SMAPI mod).

## New buildings, interiors and shipping them

- `sdv room <Name> <w> <h> --exit Map,x,y --mod id` → new interior (w×h floor, 3-tile walls, frame, bottom exit).
- `sdv building <map> x y --texture "Buildings/Beach Cabin" --rect 160,0,80,112 --door 2,5 --to <Name> --mod id`
  → exterior from any game texture (roof rows on Front, rest Buildings, mat in front of the door walkable), door warp,
  and the room's exit is pointed back at the door. Check the spot first with `SDV_VANILLA=1 sdv fit ...`.
- `sdv state beachBridgeFixed --mod id` when the place needs progress the game applies in code (east beach bridge).
- `sdv furni act <id> kitchen --mod id` only for furniture that should do something (fridge/oven → kitchen,
  calendar → Billboard, jukebox → Jukebox). Seats, beds, lamps, dressers, fish tanks work natively by type.
- `sdv cp-export <mod> -o dist` → `[CP] <title>` (Content Patcher: locations, Data/Locations, EditMap, baked furniture
  + Data/ChairTiles as fallback) and `[SS] <title>` (layout for the SMAPI bridge: real Furniture objects).
  `sdv ss-import exports/<loc>.json --mod save` brings a real in-game room (exported by the bridge on save) into the simulator.

## Stardew Sim Bridge (SMAPI, `smapi/StardewSim`, Android SMAPI 4.3 / game 1.6.15, .NET 9, no Harmony)

Places `[SS]` layouts as real furniture once per save (player may move/remove them), applies wallpaper/floor in
decoratable locations, performs furniture tile actions when Calcifer isn't installed, exports the current room + home
to `exports/*.json` on save. Build: `node tools/build-smapi.mjs` (needs .NET 9 SDK + game DLLs in ~/sdv-libs).

## Third-party decor packs

`node tools/import-mods.mjs <folder of mod folders>` imports CP furniture packs (Data/Furniture, textures, i18n,
Calcifer/MMAP/SpaceCore extras) and Alternative Textures packs (skins: `furni skins <id>`, `place --skin pack:n`;
AT wallpapers become `decorate --wallpaper AT.<pack>:n`). Output stays local (`web/data/thirdparty`, gitignored —
redistribution needs the authors' permission). `furni mods` lists what's imported; modded items show `[modId]`.

## Mods in the simulator

`web/data/mods/<id>/mod.json` lists new locations and EditMap patches; CLI, MCP and web load them on top of vanilla
(`sdv maps` marks them `mod:<id>`; `SDV_VANILLA=1` disables them, e.g. for `fit` against the untouched map).
Example: `examples/beach-cabin/build.mjs` draws a beach cabin with px ops only (exterior + interior tilesheet), builds
the patch + interior location, and writes an installable Content Patcher mod to `mods/[CP] Beach Cabin/`.
Pattern to copy for any new building: `fit` (vanilla) → draw with texture ops → patch (roof rows on Front, body on
Buildings, door tile `Action Warp x y Location`) → interior map with exit `Warp` back → `check` → `go` to walk it.

## Data

`web/data/index.json` → `{maps:{name:{w,h,out,warps:[[x,y,target,tx,ty,kind]]}}, textures:{key:[w,h]}}`
(kind: `w` edge/prop warp, `d` door/action warp, `t` touch warp). `web/data/maps/<name>.json` holds layers as base64
Uint16 gids, `sheets[{id,img,cols,rows,first,tp}]`, `anim`, `tp` (tile props). Prefer the CLI over reading these.
Re-extract from your own game files: `node tools/extract.mjs <folder with Maps/ TileSheets/ ...> web/data`
(Android LZ4 / uncompressed XNB, or a PC folder unpacked with StardewXnbHack: .tmx + .png). PC LZX-compressed XNB must be unpacked first.
