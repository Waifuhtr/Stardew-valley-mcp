import { layout, seats } from './furniture.mjs';
// Token-cheap text views of a map. Works in browser and Node.

export const LEGEND = ". floor  # blocked  ~ water  (space) void  D door/warp-in  W edge warp  ! action  @ actor  * path  ? overlay";

// opts: {x,y,w,h, step (downsample), marks:[[x,y,ch]], path:[[x,y]], ruler:true}
export function asciiMap(map, opts = {}) {
  const x0 = Math.max(0, opts.x | 0), y0 = Math.max(0, opts.y | 0);
  const x1 = Math.min(map.w, x0 + (opts.w || map.w)), y1 = Math.min(map.h, y0 + (opts.h || map.h));
  const step = Math.max(1, opts.step | 0 || 1);
  const ch = new Map();
  const put = (x, y, c) => ch.set(y * map.w + x, c);
  for (const [x, y, , , , k] of map.warps) if (map.in(x, y)) put(x, y, k === 'w' ? 'W' : 'D');
  if (opts.actions !== false) for (const [x, y, , v] of map.actions()) {
    const k = ch.get(y * map.w + x);
    if (!k && !/^(Warp|LockedDoorWarp|MagicWarp|Door)\b/.test(v)) put(x, y, '!');
  }
  if (map.furniture?.length && map.catalog) for (const pl of map.furniture) {
    const f = map.catalog[pl.id]; if (!f || f.t === 'rug' || /painting|window|sconce/.test(f.t)) continue;
    const l = layout(f, pl.rot || 0); for (let y = 0; y < l.bh; y++) for (let x = 0; x < l.bw; x++) put(pl.x + x, pl.y + y, 'f');
    for (const s of seats(f, pl, l)) put(Math.floor(s.x), s.y, 'h');
  }
  for (const [x, y] of opts.path || []) put(x, y, '*');
  for (const [x, y, c] of opts.marks || []) put(x, y, c);
  const base = ' .#~D';
  const lines = [];
  if (opts.ruler !== false) {
    let r = '    ';
    for (let x = x0; x < x1; x += step) r += (x % 10 < step ? String(Math.floor(x / 10) % 10) : ' ');
    lines.push(r);
  }
  for (let y = y0; y < y1; y += step) {
    let s = opts.ruler !== false ? String(y).padStart(3) + ' ' : '';
    for (let x = x0; x < x1; x += step) {
      let c = null;
      if (step === 1) c = ch.get(y * map.w + x) || base[map.cell(x, y)];
      else { // downsample: priority marks > W/D > # > ~ > . > void
        const pri = '*@?WDhf!#~.  ';
        let best = ' ';
        for (let yy = y; yy < Math.min(y + step, y1); yy++) for (let xx = x; xx < Math.min(x + step, x1); xx++) {
          const k = ch.get(yy * map.w + xx) || base[map.cell(xx, yy)];
          if (pri.indexOf(k) < pri.indexOf(best)) best = k;
        }
        c = best;
      }
      s += c;
    }
    lines.push(s.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}
