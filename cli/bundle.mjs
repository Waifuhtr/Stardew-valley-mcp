// Personal test builds: copy every third-party (or Alternative-Textures-skinned) furniture piece a mod uses into the
// mod's own tilesheets with new ids, so the [CP] pack works without the decor packs installed. Functions move along:
// Calcifer-style actions are re-keyed to the new ids, pack catalogues become own Data/Shops entries, vanilla items
// whose function the game ties to their id (catalogues, calendar) keep it through an explicit action.
import { layout, skinSource, isBed, NATIVE_ACTIONS } from '../web/core/furniture.mjs';
import { newImg } from '../web/core/raster.mjs';

// vanilla behaviour bound to the qualified item id with no action equivalent (Furniture.cs): keep the vanilla id, drop the skin
const ID_BOUND = /^(Cauldron|UprightPiano|DarkPiano|BirdHouse|1971|1369|1440|1309|704|709|714|719)$/;
const W = 512;

export const bundleKey = (pl) => pl.id + (pl.skin ? '@' + pl.skin : '');

// placements: [{id,skin}], returns null when nothing needs bundling
export function bundleFurniture(placements, { items, skins = {}, textures = {}, actions = {}, getImg, uid }) {
  const tex = `Mods\\${uid}\\Furniture`, pick = new Map(), kept = [];
  for (const pl of placements) {
    const f = items[pl.id], k = bundleKey(pl);
    if (!f || pick.has(k) || (!f.mod && !pl.skin)) continue;
    if (!f.mod && ID_BOUND.test(f.id)) { kept.push(`${f.id} (${pl.skin}): vanilla id kept for its function, skin dropped`); continue; }
    pick.set(k, { f, pl });
  }
  if (!pick.size) return null;
  // sprite strip = union of every rotation's source rect (beds also draw their blanket at x + width)
  const strips = [];
  for (const [k, { f, pl }] of pick) {
    const base = layout(f, 0).base; let w = base.w, h = base.h;
    for (let r = 0; r < 4; r++) { const s = layout(f, r).src; w = Math.max(w, s.x - base.x + s.w); h = Math.max(h, s.y - base.y + s.h); }
    if (isBed(f)) w = Math.max(w, base.w * 2);
    let img = getImg(f.tex), sx = base.x, sy = base.y;
    const sk = pl.skin && skinSource(f, layout(f, 0), pl.skin, skins, textures);
    if (sk) { img = getImg(sk.key); sx = sk.src.x; sy = sk.src.y; }
    if (!img) { kept.push(`${k}: texture missing, not bundled`); continue; }
    strips.push({ k, f, pl, img, front: getImg(f.tex + 'Front'), sx, sy, w: Math.ceil(w / 16) * 16, h: Math.ceil(h / 16) * 16 });
  }
  // shelf packing on a 16 px grid
  strips.sort((a, b) => b.h - a.h || b.w - a.w);
  let x = 0, y = 0, rowH = 0;
  for (const s of strips) {
    if (x + s.w > W) { x = 0; y += rowH; rowH = 0; }
    s.x = x; s.y = y; x += s.w; rowH = Math.max(rowH, s.h);
  }
  const H = y + rowH, sheet = newImg(W, H), front = newImg(W, H);
  // exact pixel copy (blending onto transparent would round semi-transparent alpha)
  const copy = (dst, im, sx, sy, w, h, dx, dy) => { for (let yy = 0; yy < Math.min(h, im.height - sy); yy++) for (let xx = 0; xx < Math.min(w, im.width - sx); xx++) {
    const j = ((sy + yy) * im.width + sx + xx) * 4; dst.data.set(im.data.subarray(j, j + 4), ((dy + yy) * dst.width + dx + xx) * 4); } };
  const ids = new Map(), data = {}, packOf = {}, out = { actions: {}, shops: {} };
  for (const s of strips) {
    copy(sheet, s.img, s.sx, s.sy, s.w, s.h, s.x, s.y);
    if (s.front) copy(front, s.front, s.sx, s.sy, s.w, s.h, s.x, s.y);
    const f = s.f, id = `${uid}_${f.id}${s.pl.skin ? '_' + s.pl.skin : ''}`.replace(/[^\w.-]+/g, '_'), name = String(f.n || f.id).replace(/\//g, '-');
    ids.set(s.k, id);
    data[id] = [name, f.rawType || f.t, f.s.join(' '), f.b.join(' '), f.r, f.p || 0, isNaN(f.pr) ? -1 : f.pr, name, (s.y / 16) * (W / 16) + s.x / 16, tex, 'true'].join('/');
    if (f.mod) (packOf[f.mod] ||= []).push(id);
    const act = actions[f.id] || (!f.mod && NATIVE_ACTIONS[f.id] ? [NATIVE_ACTIONS[f.id]] : null);
    if (act) out.actions[id] = act;
  }
  // pack catalogues ("OpenShop <pack shop>") -> our own shop with the bundled pieces of that pack, free like a catalogue
  const shopIds = {};
  for (const s of strips) {
    const id = ids.get(s.k), a = out.actions[id]; if (!a || !s.f.mod) continue;
    out.actions[id] = a.map(v => {
      const m = /^OpenShop\s+(\S+)(.*)$/.exec(v); if (!m) return v;
      const shop = shopIds[m[1]] ||= `${uid}_${m[1]}`.replace(/[^\w.-]+/g, '_');
      out.shops[shop] ||= { Items: packOf[s.f.mod].map(i => ({ Id: i, ItemId: `(F)${i}`, Price: 0 })) };
      return `OpenShop ${shop}${m[2]}`;
    });
  }
  return { ids, data, sheet, front, tex, actions: out.actions, shops: out.shops, shopIds, notes: kept, count: strips.length };
}
