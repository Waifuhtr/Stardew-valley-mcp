# Stardew Sim — map simulator & pixel toolkit for AI modding

**Web:** https://waifuhtr.github.io/Stardew-valley-mcp/ (mobile friendly)

Every vanilla Stardew Valley map — 259 maps including all building interiors, mines, Ginger Island and festival
variants — extracted into a compact format and made *simulatable*: collision, doors/warps between locations,
pathfinding, an NPC walking through it, and consistency checks for new locations. Plus a pixel-art toolkit that lets
an AI read/write sprites as text.

The goal: AI assistants making Stardew mods stop guessing coordinates and stop needing screenshots.

| | |
|---|---|
| `web/` | Web app: map viewer + walkable NPC simulation (tap-to-walk, D-pad, enters buildings), TMX mod testing, pixel editor |
| `cli/sdv.mjs` | Map CLI: `find info ascii tile path go route render sheet tmx check fit patch` |
| `cli/px.mjs` | Pixel CLI: `draw read ops palette preview spec check slice pack` (PXT text sprites) |
| `mcp/server.mjs` | Zero-dependency MCP server: tools `sdv` and `px` (one `args` string each → tiny schema) |
| `tools/extract.mjs` | XNB (Android LZ4 / uncompressed) or unpacked TMX+PNG → `web/data` |
| `AGENTS.md` | Token-efficient workflow guide for AI agents |

## Quick start

```bash
node cli/sdv.mjs find saloon
node cli/sdv.mjs ascii SeedShop
node cli/sdv.mjs go Farm 64 15 Saloon 10 20
node cli/sdv.mjs render Town --region 40,50,20,15 --actor 45,60,left --grid -o town.png
node cli/px.mjs read web/data/img/extra/sprites.png --frame 16,32,0
node tools/serve.mjs 8080        # web app locally
node tools/test.mjs              # smoke tests
```

MCP (Claude Code):

```bash
claude mcp add --scope user stardew-sim -- node /abs/path/Stardew-valley-mcp/mcp/server.mjs
```

No npm dependencies; Node ≥ 18.

## Türkçe

Tüm Stardew haritası (bina içleri dahil) çıkarıldı ve simüle edilebilir: çarpışma, kapılar/warp'lar, yol bulma,
NPC yürütme, yeni konum/bina eklerken tutarlılık kontrolü (`check`, `fit`, `patch`). Piksel aracı (`px` + web editör)
sprite'ları metin (PXT) olarak okuyup yazmayı sağlar — yapay zeka için az token, kullanıcı için web'den önizleme.
Web sürümü mobil uyumludur: dokun-yürü, D-pad, iki parmakla yakınlaştırma.

Game assets © ConcernedApe. This repository is an unofficial modding reference; it is not affiliated with or endorsed
by ConcernedApe.
