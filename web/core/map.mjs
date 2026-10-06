// Decoded map model + Stardew-like passability. Works in browser and Node.
import { mapWarps } from './world.mjs';

const b64 = (s) => {
  const bin = atob(s), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Uint16Array(u8.buffer);
};

export class GameMap {
  constructor(j) {
    this.j = j; this.name = j.name; this.w = j.w; this.h = j.h; this.props = j.props || {};
    this.sheets = j.sheets;
    this.layers = {};
    this.layerOrder = j.layers.map(l => l.id);
    for (const l of j.layers) this.layers[l.id] = l.arr || b64(l.data);
    this.anim = j.anim || {}; this.tp = j.tp || {};
    this.warps = mapWarps(j);
    this._pass = null;
  }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  gid(layer, x, y) { const L = this.layers[layer]; return L && this.in(x, y) ? L[y * this.w + x] : 0; }
  sheetOf(gid) {
    if (!gid) return null;
    for (let i = this.sheets.length - 1; i >= 0; i--) if (gid >= this.sheets[i].first) return { sheet: this.sheets[i], idx: gid - this.sheets[i].first };
    return null;
  }
  // tile props merged with tilesheet index props
  tprops(layer, x, y) {
    const s = this.sheetOf(this.gid(layer, x, y));
    const ip = s ? s.sheet.tp[s.idx] : null, tp = this.tp[layer]?.[x + ',' + y];
    return ip || tp ? { ...ip, ...tp } : null;
  }
  // 0 void, 1 floor, 2 blocked, 3 water, 4 door(passable action warp/Door)
  cell(x, y) {
    if (!this.in(x, y) || !this.gid('Back', x, y)) return 0;
    const bp = this.tprops('Back', x, y) || {};
    const bg = this.gid('Buildings', x, y);
    if (bg) {
      const p = this.tprops('Buildings', x, y) || {};
      const a = (p.Action || '').split(' ')[0];
      if (a === 'Door' || a === 'ConditionalDoor') return 4;
      if (!('Passable' in p) && !('Shadow' in p)) return 2;
    }
    if (bp.Water !== undefined && bp.Water !== 'F') return 3;
    if ('Passable' in bp) return 2;
    if (bp.NPCBarrier) return 1;
    return 1;
  }
  // furniture: [{id,x,y,rot}] + catalog (furniture.json items); blocks tiles except rugs / wall items
  setFurniture(list, catalog, blocks) { this.furniture = list; this.catalog = catalog; this._fblocks = blocks; this._pass = null; }
  baseWalkable(x, y) { return this.in(x, y) && this.baseGrid()[y * this.w + x] === 1; }
  passGrid() {
    if (this._pass) return this._pass;
    const g = new Uint8Array(this.baseGrid());
    for (const k of this._fblocks || []) { const [x, y] = k.split(',').map(Number); if (this.in(x, y)) g[y * this.w + x] = 0; }
    return (this._pass = g);
  }
  baseGrid() {
    if (this._base) return this._base;
    const g = new Uint8Array(this.w * this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const c = this.cell(x, y); g[y * this.w + x] = c === 1 || c === 4 ? 1 : 0; }
    // warp tiles inside the map are walkable targets
    for (const [x, y] of this.warps) if (this.in(x, y)) g[y * this.w + x] = 1;
    return (this._base = g);
  }
  walkable(x, y) { return this.in(x, y) && this.passGrid()[y * this.w + x] === 1; }
  // interactive tiles (Action / TouchAction), as [x,y,layer,value]
  actions() {
    const out = [];
    for (const [layer, t] of Object.entries(this.tp))
      for (const [xy, p] of Object.entries(t)) {
        const [x, y] = xy.split(',').map(Number);
        if (p.Action) out.push([x, y, layer, p.Action]);
        if (p.TouchAction) out.push([x, y, layer, 'Touch:' + p.TouchAction]);
      }
    return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }
}

// A* on 4-neighborhood. Returns [[x,y],...] incl. start & goal, or null.
export function findPath(map, sx, sy, gx, gy, opts = {}) {
  const W = map.w, H = map.h, pass = map.passGrid();
  const ok = (x, y) => (x === gx && y === gy) || (x >= 0 && y >= 0 && x < W && y < H && pass[y * W + x]);
  if (!ok(gx, gy) && !opts.allowBlockedGoal) return null;
  const N = W * H, g = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = []; const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const s = sy * W + sx, goal = gy * W + gx;
  g[s] = 0; push(Math.abs(gx - sx) + Math.abs(gy - sy), s);
  while (heap.length) {
    const [, i] = pop();
    if (closed[i]) continue; closed[i] = 1;
    if (i === goal) break;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy; if (!ok(nx, ny)) continue;
      const n = ny * W + nx, ng = g[i] + 1;
      if (ng < g[n]) { g[n] = ng; from[n] = i; push(ng + Math.abs(gx - nx) + Math.abs(gy - ny), n); }
    }
  }
  if (g[goal] === Infinity) return null;
  const p = []; for (let i = goal; i !== -1; i = from[i]) p.push([i % W, (i / W) | 0]);
  return p.reverse();
}

// flood fill reachable tiles from (x,y)
export function reachable(map, x, y) {
  const W = map.w, pass = map.passGrid(), seen = new Uint8Array(W * map.h), st = [y * W + x];
  if (!map.in(x, y)) return seen;
  seen[st[0]] = 1;
  while (st.length) {
    const i = st.pop(), cx = i % W, cy = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, n = ny * W + nx;
      if (nx >= 0 && ny >= 0 && nx < W && ny < map.h && !seen[n] && pass[n]) { seen[n] = 1; st.push(n); }
    }
  }
  return seen;
}

// Path to 'dirs' string (R/L/U/D with run-lengths) – compact for LLMs
export function pathToMoves(p) {
  const out = []; let last = '', n = 0;
  for (let i = 1; i < p.length; i++) {
    const dx = p[i][0] - p[i - 1][0], dy = p[i][1] - p[i - 1][1];
    const d = dx > 0 ? 'R' : dx < 0 ? 'L' : dy > 0 ? 'D' : 'U';
    if (d === last) n++; else { if (n) out.push(last + n); last = d; n = 1; }
  }
  if (n) out.push(last + n);
  return out.join(' ');
}

// path onto a warp tile (may be blocked door tile or outside the map edge like x=-1)
export function pathToWarp(map, sx, sy, wx, wy) {
  const cx = Math.min(Math.max(wx, 0), map.w - 1), cy = Math.min(Math.max(wy, 0), map.h - 1);
  const outside = cx !== wx || cy !== wy;
  let p = findPath(map, sx, sy, cx, cy, { allowBlockedGoal: true });
  if (!p) return null;
  if (outside) p.push([wx, wy]);
  return p;
}
