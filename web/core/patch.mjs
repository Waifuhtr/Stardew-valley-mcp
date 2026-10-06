// Content Patcher style EditMap: overlay a patch map onto a target at (x,y). Browser + Node.
import { GameMap } from './map.mjs';

// diff two check results -> only problems introduced by the patch
export const newProblems = (before, after) => ({ errors: after.errors.filter(e => !before.errors.includes(e)), warnings: after.warnings.filter(e => !before.warnings.includes(e)), info: [] });

// mode: 'ReplaceByLayer' (default: non-empty patch tiles replace), 'Replace' (whole area per patch layer), 'Overlay' (same as ReplaceByLayer here)
export function applyPatch(target, patch, x, y, mode = 'ReplaceByLayer') {
  const j = { name: target.name, w: target.w, h: target.h, props: { ...target.props }, sheets: target.sheets.map(s => ({ ...s })), anim: structuredClone(target.anim), tp: structuredClone(target.tp) };
  // merge tilesheets by image (CP adds missing ones with a z_ prefix)
  let next = Math.max(...j.sheets.map(s => s.first + s.cols * s.rows));
  const remap = new Map(); // patch sheet -> target sheet
  for (const ps of patch.sheets) {
    let t = j.sheets.find(s => s.img === ps.img);
    if (!t) { t = { ...ps, id: 'z_' + ps.id, first: next }; next += ps.cols * ps.rows; j.sheets.push(t); }
    remap.set(ps, t);
  }
  const conv = (g) => { const s = patch.sheetOf(g); if (!s) return 0; const t = remap.get(s.sheet); return t.first + s.idx; };
  const layers = Object.fromEntries(target.layerOrder.map(id => [id, new Uint16Array(target.layers[id])]));
  const order = [...target.layerOrder];
  for (const id of patch.layerOrder) {
    if (!layers[id]) { layers[id] = new Uint16Array(target.w * target.h); order.push(id); }
    const src = patch.layers[id], dst = layers[id];
    for (let py = 0; py < patch.h; py++) for (let px = 0; px < patch.w; px++) {
      const tx = x + px, ty = y + py; if (tx < 0 || ty < 0 || tx >= target.w || ty >= target.h) continue;
      const g = src[py * patch.w + px], k = `${tx},${ty}`;
      if (!g && mode !== 'Replace') continue;
      dst[ty * target.w + tx] = conv(g);
      if (j.anim[id]) delete j.anim[id][k];
      if (j.tp[id]) delete j.tp[id][k];
      const a = patch.anim[id]?.[`${px},${py}`]; if (a) (j.anim[id] ||= {})[k] = [a[0], a[1].map(conv)];
    }
  }
  for (const [id, t] of Object.entries(patch.tp)) for (const [xy, p] of Object.entries(t)) {
    const [px, py] = xy.split(',').map(Number); (j.tp[id] ||= {})[`${px + x},${py + y}`] = p;
  }
  // map properties of the patch are not merged (CP only edits them via MapProperties / AddWarps)
  j.layers = order.map(id => ({ id, vis: true, arr: layers[id] }));
  return new GameMap(j);
}
