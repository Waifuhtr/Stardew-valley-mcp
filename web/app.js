import { GameMap, findPath, pathToWarp } from './core/map.mjs';
import { mapOf, route, isVariant, mapWarps } from './core/world.mjs';
import { seasonImg, DIRS } from './core/render.mjs';
import { tmxToJson, mapToTmx } from './core/tmx.mjs';
import { checkMap, connectivityDiff, checkFootprint } from './core/check.mjs';
import { applyPatch, newProblems } from './core/patch.mjs';
import { initPixel } from './pixel.js';

const $ = (s) => document.querySelector(s);
const status = (t) => ($('#status').textContent = t);
const S = {
  index: null, map: null, season: 'spring', zoom: innerWidth < 600 ? 2 : 3, cam: { x: 0, y: 0 }, follow: true,
  imgs: new Map(), customImgs: {}, customMaps: {}, overrides: {}, extraWarps: {},
  below: null, above: null, overlay: null, animCells: [], sprite: null, speed: 5,
  P: { x: 0, y: 0, px: 0, py: 0, dir: 'down', moving: false, from: null, to: null, t: 0, path: [], walkT: 0 },
  plan: null, held: null,
};
const dpr = () => window.devicePixelRatio || 1;

// ---------- tabs ----------
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'help') loadHelp();
  window.dispatchEvent(new Event('resize'));
});

// ---------- assets ----------
function loadImage(key) {
  if (S.imgs.has(key)) return S.imgs.get(key);
  const p = new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im); im.onerror = () => res(null);
    im.src = S.customImgs[key] || `data/img/${key}.png`;
  });
  S.imgs.set(key, p);
  return p;
}
async function getMap(name) {
  if (S.overrides[name]) return S.overrides[name];
  const j = S.customMaps[name] || await (await fetch(`data/maps/${name}.json`)).json();
  const m = new GameMap(j);
  for (const w of S.extraWarps[name] || []) m.warps.push(w);
  return m;
}
const known = (name) => !!S.index.maps[mapOf(name, S.index.maps)];

// ---------- map building ----------
const groupOf = (id) => /^(Front|AlwaysFront)/.test(id) ? 'above' : /^(Back|Buildings)/.test(id) ? 'below' : null;
const orderedLayers = (m, g) => {
  const pri = (id) => ['Back', 'Buildings', 'Front', 'AlwaysFront'].findIndex(p => new RegExp('^' + p + '\\d*$').test(id));
  return m.layerOrder.filter(id => groupOf(id) === g).sort((a, b) => pri(a) - pri(b));
};
async function buildMap(m) {
  const keys = [...new Set(m.sheets.map(s => seasonImg(s.img, S.season, S.index.textures)))];
  const imgs = {};
  await Promise.all(m.sheets.map(async s => {
    const k = seasonImg(s.img, S.season, S.index.textures);
    imgs[s.id] = (await loadImage(k)) || (await loadImage(s.img));
  }));
  status(`${m.name} ${m.w}×${m.h} • ${keys.length} tilesheet`);
  const mk = () => { const c = document.createElement('canvas'); c.width = m.w * 16; c.height = m.h * 16; return c; };
  const below = mk(), above = mk();
  S.sheetImgs = imgs;
  const groups = { below: orderedLayers(m, 'below'), above: orderedLayers(m, 'above') };
  for (const g of ['below', 'above']) {
    const ctx = (g === 'below' ? below : above).getContext('2d');
    for (const L of groups[g]) for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) drawTile(ctx, m, L, x, y, 0);
  }
  S.below = below; S.above = above; S.groups = groups; S.map = m;
  // animated cells
  const cells = new Map();
  for (const [L, a] of Object.entries(m.anim)) { const g = groupOf(L); if (!g) continue; for (const xy of Object.keys(a)) cells.set(g + ':' + xy, [g, ...xy.split(',').map(Number)]); }
  S.animCells = [...cells.values()]; S.animState = new Map();
  buildOverlay(m);
}
function drawTile(ctx, m, L, x, y, t) {
  const a = m.anim[L]?.[x + ',' + y];
  const g = a ? a[1][Math.floor(t / a[0]) % a[1].length] : m.layers[L][y * m.w + x];
  if (!g) return;
  const s = m.sheetOf(g); if (!s) return;
  const im = S.sheetImgs[s.sheet.id]; if (!im) return;
  const cols = Math.floor(im.width / 16);
  ctx.drawImage(im, (s.idx % cols) * 16, Math.floor(s.idx / cols) * 16, 16, 16, x * 16, y * 16, 16, 16);
}
function tickAnim(t) {
  const m = S.map; if (!m) return;
  for (const [g, x, y] of S.animCells) {
    let key = '';
    for (const L of S.groups[g]) { const a = m.anim[L]?.[x + ',' + y]; if (a) key += Math.floor(t / a[0]) % a[1].length + ','; }
    const id = g + x + ',' + y;
    if (S.animState.get(id) === key) continue;
    S.animState.set(id, key);
    const ctx = (g === 'below' ? S.below : S.above).getContext('2d');
    ctx.clearRect(x * 16, y * 16, 16, 16);
    for (const L of S.groups[g]) drawTile(ctx, m, L, x, y, t);
  }
}
function buildOverlay(m) {
  const c = document.createElement('canvas'); c.width = m.w * 16; c.height = m.h * 16;
  const ctx = c.getContext('2d');
  const col = { 0: '#0008', 2: '#ff282866', 3: '#2878ff66', 4: '#ffdc0077' };
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const k = m.cell(x, y); if (col[k]) { ctx.fillStyle = col[k]; ctx.fillRect(x * 16, y * 16, 16, 16); } }
  S.overlay = c;
}

// ---------- load / warp ----------
async function loadMap(name, x, y, dir) {
  name = mapOf(name, S.index.maps);
  if (!known(name)) { status(`bilinmeyen harita: ${name}`); return false; }
  status(`${name} yükleniyor…`);
  const m = await getMap(name);
  S.loading = true;
  await buildMap(m);
  S.loading = false;
  const P = S.P;
  if (x === undefined) [x, y] = guessSpawn(m);
  Object.assign(P, { x, y, px: x * 16, py: y * 16, moving: false, path: [], dir: dir || P.dir });
  $('#mapInput').value = name;
  updateHash();
  if (S.follow) centerCam();
  return true;
}
function guessSpawn(m) {
  // the tile an incoming warp lands on, else first walkable near the center
  for (const [, info] of Object.entries(S.index.maps)) for (const w of info.warps) if (mapOf(w[2], S.index.maps) === m.name && m.walkable(w[3], w[4])) return [w[3], w[4]];
  for (let r = 0; r < Math.max(m.w, m.h); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = (m.w >> 1) + dx, y = (m.h >> 1) + dy; if (m.walkable(x, y)) return [x, y]; }
  return [0, 0];
}
async function warp(w) {
  const [, , target, tx, ty] = w;
  if (!known(target)) { status(`warp hedefi yok: ${target}`); S.P.path = []; return; }
  await loadMap(target, tx, ty);
  continuePlan();
}

// ---------- simulation / movement ----------
const DV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const dirOf = (dx, dy) => dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
function tryStep(nx, ny) {
  const P = S.P, m = S.map;
  P.dir = dirOf(nx - P.x, ny - P.y);
  const w = m.warps.find(w => w[0] === nx && w[1] === ny);
  if (w) { S.warping = true; warp(w).finally(() => (S.warping = false)); return true; }
  if (!m.walkable(nx, ny)) return false;
  Object.assign(P, { moving: true, from: [P.x, P.y], to: [nx, ny], t: 0 });
  return true;
}
function update(dt) {
  const P = S.P; if (!S.map || S.warping) return;
  if (P.moving) {
    P.t += dt * S.speed; P.walkT += dt * S.speed;
    if (P.t >= 1) { P.x = P.to[0]; P.y = P.to[1]; P.moving = false; P.px = P.x * 16; P.py = P.y * 16; if (!P.path.length && !S.held) updateHash(); }
    else { P.px = (P.from[0] + (P.to[0] - P.from[0]) * P.t) * 16; P.py = (P.from[1] + (P.to[1] - P.from[1]) * P.t) * 16; }
  }
  if (!P.moving) {
    if (S.held) { P.path = []; S.plan = null; const [dx, dy] = DV[S.held]; if (!tryStep(P.x + dx, P.y + dy)) P.dir = S.held; }
    else if (P.path.length) { const [nx, ny] = P.path.shift(); if (!tryStep(nx, ny)) { P.path = []; status('yol tıkandı'); } }
  }
  if (S.follow) centerCam();
}
function continuePlan() {
  const pl = S.plan, m = S.map, P = S.P; if (!pl) return;
  if (m.name === pl.goal) {
    if (pl.x != null && !isNaN(pl.x)) { const p = findPath(m, P.x, P.y, pl.x, pl.y); P.path = p ? p.slice(1) : []; status(p ? `hedef: ${pl.x},${pl.y} (${p.length - 1} adım)` : 'hedefe yol yok'); }
    else status(`vardı: ${m.name} ${P.x},${P.y}`);
    S.plan = null; return;
  }
  const hops = route(S.index, m.name, pl.goal);
  if (!hops) { status('rota yok'); S.plan = null; return; }
  const h = hops[0];
  const p = pathToWarp(m, P.x, P.y, h.x, h.y);
  if (!p) { status(`${m.name}: ${h.to} kapısına yol yok`); S.plan = null; return; }
  P.path = p.slice(1);
  status(`rota: ${[m.name, ...hops.map(h => h.to)].join(' → ')}`);
}
function walkTo(x, y) {
  const m = S.map, P = S.P;
  const w = m.warps.find(w => w[0] === x && w[1] === y);
  let p = w ? pathToWarp(m, P.x, P.y, x, y) : findPath(m, P.x, P.y, x, y);
  if (!p && !w) { p = findPath(m, P.x, P.y, x, y, { allowBlockedGoal: true }); if (p) p.pop(); }
  S.plan = null;
  P.path = p ? p.slice(1) : [];
}

// ---------- camera / drawing ----------
const cv = $('#cv'), ctx = cv.getContext('2d');
function resize() { const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * dpr()); cv.height = Math.round(r.height * dpr()); }
window.addEventListener('resize', resize);
function viewSize() { return [cv.width / (S.zoom * dpr()), cv.height / (S.zoom * dpr())]; }
function centerCam() {
  const m = S.map; if (!m) return;
  const [vw, vh] = viewSize(), P = S.P;
  const cx = P.px + 8 - vw / 2, cy = P.py - vh / 2;
  S.cam.x = m.w * 16 <= vw ? (m.w * 16 - vw) / 2 : Math.max(0, Math.min(m.w * 16 - vw, cx));
  S.cam.y = m.h * 16 <= vh ? (m.h * 16 - vh) / 2 : Math.max(0, Math.min(m.h * 16 - vh, cy));
}
function draw(t) {
  const m = S.map;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (!m) return;
  const z = S.zoom * dpr();
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(z, 0, 0, z, Math.round(-S.cam.x * z), Math.round(-S.cam.y * z));
  ctx.drawImage(S.below, 0, 0);
  // path preview
  if (S.P.path.length) { ctx.fillStyle = '#ffe60088'; for (const [x, y] of S.P.path) ctx.fillRect(x * 16 + 5, y * 16 + 5, 6, 6); }
  drawActor(t);
  if ($('#optFront').checked) ctx.drawImage(S.above, 0, 0);
  if ($('#optPass').checked) ctx.drawImage(S.overlay, 0, 0);
  if ($('#optWarps').checked) for (const [x, y, , , , k] of m.warps) {
    ctx.fillStyle = k === 'w' ? '#00ff7899' : '#ff00ff99';
    ctx.fillRect(Math.max(-1, Math.min(m.w, x)) * 16 + 3, Math.max(-1, Math.min(m.h, y)) * 16 + 3, 10, 10);
  }
  if ($('#optGrid').checked) drawGrid(z);
  if (S.sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / S.zoom; ctx.strokeRect(S.sel[0] * 16 + .5, S.sel[1] * 16 + .5, 15, 15); }
}
function drawActor(t) {
  const P = S.P, im = S.sprite; if (!im) return;
  const cols = Math.floor(im.width / 16), row = DIRS[P.dir] ?? 0;
  const f = P.moving || P.path.length ? Math.floor(P.walkT * 2) % 4 : 0;
  const fi = row * cols + f;
  ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(P.px + 8, P.py + 14, 6, 3, 0, 0, 7); ctx.fill();
  ctx.drawImage(im, (fi % cols) * 16, Math.floor(fi / cols) * 32, 16, 32, P.px, P.py - 16 - 2, 16, 32);
}
function drawGrid(z) {
  const m = S.map, [vw, vh] = viewSize();
  const x0 = Math.max(0, Math.floor(S.cam.x / 16)), y0 = Math.max(0, Math.floor(S.cam.y / 16));
  const x1 = Math.min(m.w, Math.ceil((S.cam.x + vw) / 16)), y1 = Math.min(m.h, Math.ceil((S.cam.y + vh) / 16));
  ctx.strokeStyle = '#0006'; ctx.lineWidth = 1 / S.zoom; ctx.beginPath();
  for (let x = x0; x <= x1; x++) { ctx.moveTo(x * 16, y0 * 16); ctx.lineTo(x * 16, y1 * 16); }
  for (let y = y0; y <= y1; y++) { ctx.moveTo(x0 * 16, y * 16); ctx.lineTo(x1 * 16, y * 16); }
  ctx.stroke();
  const every = S.zoom >= 3 ? 2 : S.zoom >= 1.5 ? 5 : 10;
  ctx.font = `${10 / S.zoom * dpr()}px monospace`; ctx.textBaseline = 'top';
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (x % every === 0 && y % every === 0) {
    const s = `${x},${y}`; ctx.fillStyle = '#000a'; ctx.fillRect(x * 16, y * 16, ctx.measureText(s).width + 1, 10 / S.zoom * dpr()); ctx.fillStyle = '#fff'; ctx.fillText(s, x * 16 + .5, y * 16);
  }
}
let last = performance.now();
function loop(t) {
  const dt = Math.min(0.1, (t - last) / 1000); last = t;
  requestAnimationFrame(loop);
  if (S.loading) return;
  try { update(dt); tickAnim(t); draw(t); } catch (e) { console.error(e); }
}

// ---------- input ----------
const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
addEventListener('keydown', e => { if (e.target.matches('input,textarea,select') || !$('#tab-map').classList.contains('on')) return; if (KEYS[e.code]) { S.held = KEYS[e.code]; S.follow = true; $('#optFollow').checked = true; e.preventDefault(); } if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') interact(); });
addEventListener('keyup', e => { if (KEYS[e.code] === S.held) S.held = null; });
document.querySelectorAll('#dpad button').forEach(b => {
  const d = b.dataset.d;
  b.onpointerdown = (e) => { e.preventDefault(); if (d === 'act') return interact(); S.held = d; S.follow = true; $('#optFollow').checked = true; b.setPointerCapture(e.pointerId); };
  b.onpointerup = b.onpointercancel = () => { if (S.held === d) S.held = null; };
});
function interact() {
  const [dx, dy] = DV[S.P.dir], x = S.P.x + dx, y = S.P.y + dy;
  showTile(x, y);
}
$('#btnCenter').onclick = () => { S.follow = true; $('#optFollow').checked = true; centerCam(); };
$('#zoom').onclick = (e) => { const z = +e.target.dataset.z; if (z) setZoom(S.zoom * (z > 0 ? 1.25 : 0.8)); };
function setZoom(z, sx, sy) {
  const [vw, vh] = viewSize();
  sx ??= cv.width / 2; sy ??= cv.height / 2;
  const gx = S.cam.x + sx / (S.zoom * dpr()), gy = S.cam.y + sy / (S.zoom * dpr());
  S.zoom = Math.max(0.25, Math.min(10, z));
  S.cam.x = gx - sx / (S.zoom * dpr()); S.cam.y = gy - sy / (S.zoom * dpr());
  if (S.follow) centerCam();
}
cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); setZoom(S.zoom * (e.deltaY < 0 ? 1.15 : 0.87), (e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr()); }, { passive: false });
const ptrs = new Map(); let gesture = null;
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) gesture = { kind: 'tap', sx: e.clientX, sy: e.clientY, cam: { ...S.cam }, t: performance.now() };
  else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), z: S.zoom }; }
});
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;
  if (gesture.kind === 'pinch' && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], r = cv.getBoundingClientRect();
    setZoom(gesture.z * Math.hypot(a.x - b.x, a.y - b.y) / gesture.d, ((a.x + b.x) / 2 - r.left) * dpr(), ((a.y + b.y) / 2 - r.top) * dpr());
  } else if (gesture.kind !== 'pinch') {
    const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
    if (gesture.kind === 'tap' && Math.hypot(dx, dy) > 8) { gesture.kind = 'pan'; S.follow = false; $('#optFollow').checked = false; }
    if (gesture.kind === 'pan') { S.cam.x = gesture.cam.x - dx / S.zoom; S.cam.y = gesture.cam.y - dy / S.zoom; }
  }
});
const endPtr = (e) => {
  ptrs.delete(e.pointerId);
  if (gesture?.kind === 'tap' && ptrs.size === 0 && S.map) {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((S.cam.x + (e.clientX - r.left) / S.zoom) / 16), y = Math.floor((S.cam.y + (e.clientY - r.top) / S.zoom) / 16);
    showTile(x, y); walkTo(x, y);
  }
  if (ptrs.size === 0) gesture = null;
};
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);

// ---------- info ----------
const CELL = ['boşluk', 'zemin', 'engel', 'su', 'kapı'];
function showTile(x, y) {
  const m = S.map; if (!m) return;
  S.sel = [x, y];
  const lines = [`${m.name} ${x},${y} ${CELL[m.cell(x, y)] || 'dışarı'}${m.walkable(x, y) ? ' (yürünür)' : ''}`];
  for (const L of m.layerOrder) {
    const g = m.gid(L, x, y); if (!g) continue;
    const s = m.sheetOf(g), p = m.tprops(L, x, y);
    lines.push(`${L}: ${s.sheet.id}#${s.idx}${p ? ' ' + JSON.stringify(p) : ''}`);
  }
  for (const w of m.warps) if (w[0] === x && w[1] === y) lines.push(`warp → ${w[2]} ${w[3]},${w[4]}`);
  $('#infoText').textContent = lines.join('\n');
}
$('#btnCopy').onclick = () => navigator.clipboard?.writeText($('#infoText').textContent).then(() => status('kopyalandı'));

// ---------- UI wiring ----------
function fillList() {
  const dl = $('#mapList'), v = $('#optVariants').checked;
  dl.innerHTML = Object.keys(S.index.maps).filter(n => v || !isVariant(n, S.index.maps)).sort().map(n => `<option value="${n}">`).join('');
}
$('#optVariants').onchange = fillList;
$('#mapInput').onchange = (e) => { if (known(e.target.value)) loadMap(e.target.value); };
$('#mapInput').onfocus = (e) => e.target.select();
$('#season').onchange = async (e) => { S.season = e.target.value; S.imgs.clear(); if (S.map) await buildMap(S.map); updateHash(); };
$('#btnMenu').onclick = () => ($('#menu').hidden = !$('#menu').hidden);
$('#optFollow').onchange = (e) => { S.follow = e.target.checked; };
$('#btnGo').onclick = () => {
  const g = $('#goMap').value || S.map.name;
  if (!known(g)) return status('hedef harita yok');
  S.plan = { goal: mapOf(g, S.index.maps), x: parseInt($('#goX').value), y: parseInt($('#goY').value) };
  S.follow = true; $('#menu').hidden = true; continuePlan();
};
$('#btnRun').onclick = () => { S.speed = S.speed === 5 ? 10 : 5; $('#btnRun').classList.toggle('on', S.speed > 5); };
$('#btnStop').onclick = () => { S.plan = null; S.P.path = []; };
function updateHash() {
  if (!S.map) return;
  const h = `#${encodeURIComponent(S.map.name)}@${S.P.x},${S.P.y}${S.season !== 'spring' ? '/' + S.season : ''}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}
function parseHash() {
  const m = /^#([^@/]+)(?:@(-?\d+),(-?\d+))?(?:\/(\w+))?/.exec(decodeURIComponent(location.hash));
  return m ? { name: m[1], x: m[2] != null ? +m[2] : undefined, y: m[3] != null ? +m[3] : undefined, season: m[4] } : null;
}
addEventListener('hashchange', () => { const h = parseHash(); if (h && (h.name !== S.map?.name || h.x !== S.P.x || h.y !== S.P.y)) loadMap(h.name, h.x, h.y); });

// ---------- mod testing: TMX ----------
const inflate = async (bytes, kind) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(kind === 'gzip' ? 'gzip' : 'deflate'))).arrayBuffer());
function showReport(title, r, extra = []) {
  $('#infoText').innerHTML = [`<b>${title}</b> ${r.errors.length ? '<span class="err">HATA</span>' : '<span class="ok">OK</span>'}`,
    ...r.errors.map(e => `<span class="err">E ${esc(e)}</span>`), ...extra.concat(r.warnings).map(e => `<span class="warn">W ${esc(e)}</span>`), ...r.info.map(e => `i ${esc(e)}`)].join('\n');
}
const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
$('#tmxFile').onchange = async (e) => {
  const files = [...e.target.files]; if (!files.length) return;
  const tmx = files.find(f => /\.tmx$/i.test(f.name));
  for (const f of files.filter(f => /\.png$/i.test(f.name))) { const k = f.name.replace(/\.png$/i, ''); S.customImgs[k] = URL.createObjectURL(f); S.imgs.delete(k); }
  if (!tmx) return status('PNG yüklendi; şimdi TMX seç');
  try {
    const name = tmx.name.replace(/\.tmx$/i, '').replace(/\W/g, '_');
    const { json, warnings } = await tmxToJson(await tmx.text(), { name, textures: S.index.textures, inflate });
    for (const s of json.sheets) if (s.missing && S.customImgs[s.img]) delete s.missing;
    const mode = document.querySelector('input[name=tmxMode]:checked').value;
    const lm = (n) => null;
    if (mode === 'loc') {
      S.customMaps[name] = json;
      S.index.maps[name] = { w: json.w, h: json.h, out: json.props.Outdoors ? 1 : 0, warps: mapWarps(json) };
      fillList();
      const m = await getMap(name);
      const preload = {}; for (const [, , t] of m.warps) { const n = mapOf(t, S.index.maps); if (known(n) && !preload[n]) preload[n] = await getMap(n); }
      const r = checkMap(m, { index: S.index, loadMap: (n) => preload[n] || null });
      await loadMap(name); showReport(`Yeni konum ${name}`, r, warnings);
    } else {
      const target = mapOf($('#patchMap').value || S.map.name, S.index.maps);
      const x = parseInt($('#patchX').value) || 0, y = parseInt($('#patchY').value) || 0;
      delete S.overrides[target];
      const base = await getMap(target), patched = applyPatch(base, new GameMap(json), x, y);
      S.overrides[target] = patched; S.index.maps[target].warps = patched.warps;
      const r = newProblems(checkMap(base, { index: S.index, loadMap: lm }), checkMap(patched, { index: S.index, loadMap: lm }));
      const fp = checkFootprint(base, x, y, json.w, json.h);
      for (const w of fp.warpsIn) r.warnings.push(`vanilla warp'ı örtüyor: ${w[0]},${w[1]} → ${w[2]}`);
      for (const a of fp.actions) r.warnings.push(`vanilla aksiyonu örtüyor: ${a[0]},${a[1]} ${a[3]}`);
      const cd = connectivityDiff(base, patched);
      if (cd.lostWarps.length) r.errors.push(`ana alandan kopan warp'lar: ${cd.lostWarps.join(' ')}`);
      if (cd.lostTiles) r.warnings.push(`${cd.lostTiles} yürünebilir karo erişilemez oldu`);
      await loadMap(target, x + (json.w >> 1), y + json.h + 1); showReport(`Yama ${name} → ${target} @${x},${y}`, r, warnings);
    }
    $('#menu').hidden = true;
  } catch (err) { status('TMX hatası: ' + err.message); console.error(err); }
};
$('#btnEnt').onclick = async () => {
  const from = mapOf($('#entMap').value || S.map.name, S.index.maps);
  const w = [parseInt($('#entX').value), parseInt($('#entY').value), S.map.name, parseInt($('#entTX').value), parseInt($('#entTY').value), 'd'];
  if (w.some(v => typeof v === 'number' && isNaN(v))) return status('x y tx ty gerekli');
  (S.extraWarps[from] ||= []).push(w);
  S.index.maps[from].warps.push(w);
  if (S.overrides[from]) S.overrides[from].warps.push(w);
  status(`${from} ${w[0]},${w[1]} → ${w[2]} ${w[3]},${w[4]} eklendi`);
};
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
$('#btnTmxExport').onclick = () => S.map && download(new Blob([mapToTmx(S.map)], { type: 'application/xml' }), S.map.name.replace(/\W/g, '_') + '.tmx');
$('#btnShot').onclick = () => {
  const c = document.createElement('canvas'); c.width = S.below.width; c.height = S.below.height;
  const x = c.getContext('2d'); x.drawImage(S.below, 0, 0); x.drawImage(S.above, 0, 0);
  if ($('#optPass').checked) x.drawImage(S.overlay, 0, 0);
  c.toBlob(b => download(b, S.map.name + '.png'));
};

// ---------- help ----------
let helpLoaded = false;
async function loadHelp() {
  if (helpLoaded) return; helpLoaded = true;
  $('#helpBody').innerHTML = await (await fetch('help.html')).text();
}

// ---------- boot ----------
(async () => {
  resize();
  S.index = await (await fetch('data/index.json')).json();
  fillList();
  S.sprite = await loadImage('extra/sprites');
  window.addEventListener('sprite', (e) => { S.sprite = e.detail; status('sprite haritada'); });
  initPixel({ status, sampleUrl: 'data/img/extra/sprites.png' });
  const h = parseHash();
  if (h?.season) { S.season = h.season; $('#season').value = h.season; }
  if (h?.name && known(h.name)) await loadMap(h.name, h.x, h.y);
  else await loadMap('Town', 43, 60);
  requestAnimationFrame(loop);
})();
