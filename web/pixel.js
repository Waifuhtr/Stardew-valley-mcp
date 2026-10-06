// Web pixel editor = test bench for the `px` CLI (same PXT format, layers, palettes, Stardew specs).
import { parsePxt, toPxt, toLayeredPxt, flatten, palette, checkSprite, SPECS, ramp, snapToPalette } from './core/pixel.mjs';
import { newImg, hex, toHex } from './core/raster.mjs';

const $ = (s) => document.querySelector(s);
const LABELS = {
  npc: { by: 'row', names: ['aşağı', 'sağ', 'yukarı', 'sol'] },
  portrait: { by: 'frame', names: ['nötr', 'mutlu', 'üzgün', 'özel', 'aşk', 'kızgın'] },
};
const KIND_SIZE = { npc: [64, 128], portrait: [128, 192], object: [16, 16], craftable: [16, 32] };

export function initPixel({ status, sampleUrl }) {
  const cv = $('#pxCv'), ctx = cv.getContext('2d'), stage = $('#pxStage');
  const E = { W: 16, H: 32, layers: [], active: 0, tool: 'pen', color: [59, 42, 74, 255], zoom: 12, ox: 20, oy: 20, mirror: false,
    undo: [], redo: [], sel: 0, selRect: null, clip: null, lockPal: null, extraPal: [] };
  const buf = document.createElement('canvas'), bctx = buf.getContext('2d');
  const onionC = document.createElement('canvas'), octx = onionC.getContext('2d');
  const dpr = () => window.devicePixelRatio || 1;
  const L = () => E.layers[E.active];
  const flat = () => flatten(E.layers.map(l => ({ ...l, x: 0, y: 0 })), E.W, E.H);
  const fwh = () => [+$('#pxFW').value || E.W, +$('#pxFH').value || E.H];
  const cols = () => Math.max(1, Math.floor(E.W / fwh()[0]));

  // ---------- project ----------
  function setProject(layers, W, H) {
    E.W = W; E.H = H; E.layers = layers; E.active = layers.length - 1; E.undo = []; E.redo = []; E.sel = 0; E.selRect = null;
    $('#pxW').value = W; $('#pxH').value = H; refreshLayers(); sync(); resize(); fit();
  }
  const blank = (name) => ({ name, hidden: false, img: newImg(E.W, E.H) });
  function refreshLayers() {
    $('#pxLayer').innerHTML = E.layers.map((l, i) => `<option value="${i}" ${i === E.active ? 'selected' : ''}>${l.hidden ? '◌ ' : ''}${l.name}</option>`).reverse().join('');
  }
  let checkTimer = 0;
  function sync() {
    const f = flat();
    buf.width = E.W; buf.height = E.H;
    bctx.putImageData(new ImageData(new Uint8ClampedArray(f.data), E.W, E.H), 0, 0);
    buildOnion(f); drawPal(f);
    clearTimeout(checkTimer); checkTimer = setTimeout(() => runCheck(f), 250);
  }
  function runCheck(f) {
    const kind = $('#pxKind').value, msgs = checkSprite(f, kind);
    if (E.lockPal) { const n = snapToPalette(f, E.lockPal).changed; msgs.unshift(n ? `⚠ ${n} px palet dışı` : '✓ palete uygun'); }
    $('#pxCheck').textContent = msgs.join(' | ');
  }
  function buildOnion(f) {
    if (!$('#pxOnion').checked) return;
    const [fw, fh] = fwh(), c = cols(); onionC.width = fw; onionC.height = fh; octx.clearRect(0, 0, fw, fh);
    const total = c * Math.floor(E.H / fh), img = octx.createImageData(fw, fh);
    for (const [k, t] of [[E.sel - 1, [255, 80, 80]], [E.sel + 1, [80, 140, 255]]]) {
      if (k < 0 || k >= total) continue;
      const sx = (k % c) * fw, sy = Math.floor(k / c) * fh;
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) if (f.data[((sy + y) * E.W + sx + x) * 4 + 3]) img.data.set([...t, 110], (y * fw + x) * 4);
    }
    octx.putImageData(img, 0, 0);
  }

  // ---------- view ----------
  function resize() { const r = stage.getBoundingClientRect(); cv.width = r.width * dpr(); cv.height = r.height * dpr(); }
  function fit() { const r = stage.getBoundingClientRect(); if (!r.width) return; E.zoom = Math.max(1, Math.floor(Math.min((r.width - 20) / E.W, (r.height - 20) / E.H))); E.ox = (r.width - E.W * E.zoom) / 2; E.oy = (r.height - E.H * E.zoom) / 2; }
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    const z = E.zoom * dpr(), ox = E.ox * dpr(), oy = E.oy * dpr(), [fw, fh] = fwh(), c = cols();
    ctx.imageSmoothingEnabled = false;
    if ($('#pxOnion').checked) ctx.drawImage(onionC, ox + (E.sel % c) * fw * z, oy + Math.floor(E.sel / c) * fh * z, fw * z, fh * z);
    ctx.drawImage(buf, ox, oy, E.W * z, E.H * z);
    if (E.float) ctx.drawImage(E.float.canvas, ox + E.float.x * z, oy + E.float.y * z, E.float.w * z, E.float.h * z);
    if ($('#pxGrid').checked && E.zoom >= 6) {
      ctx.strokeStyle = '#ffffff1c'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= E.W; x++) { ctx.moveTo(ox + x * z + .5, oy); ctx.lineTo(ox + x * z + .5, oy + E.H * z); }
      for (let y = 0; y <= E.H; y++) { ctx.moveTo(ox, oy + y * z + .5); ctx.lineTo(ox + E.W * z, oy + y * z + .5); }
      ctx.stroke();
    }
    ctx.strokeStyle = '#e8a33b99'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let x = 0; x <= E.W; x += fw) { ctx.moveTo(ox + x * z, oy); ctx.lineTo(ox + x * z, oy + E.H * z); }
    for (let y = 0; y <= E.H; y += fh) { ctx.moveTo(ox, oy + y * z); ctx.lineTo(ox + E.W * z, oy + y * z); }
    ctx.stroke();
    const lab = LABELS[$('#pxKind').value]; // Stardew template labels
    if (lab) {
      ctx.font = `${10 * dpr()}px system-ui`; ctx.textBaseline = 'top';
      const rows = Math.floor(E.H / fh);
      for (let r = 0; r < rows; r++) for (let k = 0; k < c; k++) {
        const i = r * c + k, name = lab.by === 'row' ? (k === 0 ? lab.names[r] : null) : lab.names[i];
        if (!name) continue;
        const tx = ox + k * fw * z + 2, ty = oy + r * fh * z + 2;
        ctx.fillStyle = '#000a'; ctx.fillRect(tx - 1, ty - 1, ctx.measureText(name).width + 3, 12 * dpr()); ctx.fillStyle = '#ffd166'; ctx.fillText(name, tx, ty);
      }
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(ox + (E.sel % c) * fw * z, oy + Math.floor(E.sel / c) * fh * z, fw * z, fh * z);
    if (E.selRect) { const [x, y, w, h] = E.selRect; ctx.setLineDash([4, 3]); ctx.strokeStyle = '#0ff'; ctx.strokeRect(ox + x * z, oy + y * z, w * z, h * z); ctx.setLineDash([]); }
    if (E.preview) { ctx.fillStyle = toHex(...E.color); for (const [x, y] of E.preview) ctx.fillRect(ox + x * z, oy + y * z, z, z); }
  }
  const raf = () => { draw(); requestAnimationFrame(raf); };

  // ---------- pixel ops on active layer ----------
  const idx = (x, y) => (y * E.W + x) * 4;
  const inb = (x, y) => x >= 0 && y >= 0 && x < E.W && y < E.H;
  const get = (x, y) => [...L().img.data.subarray(idx(x, y), idx(x, y) + 4)];
  function put(x, y, c) {
    if (!inb(x, y) || L().hidden) return;
    L().img.data.set(c, idx(x, y));
    if (E.mirror) { const fw = fwh()[0], fx = Math.floor(x / fw) * fw, mx = fx + fw - 1 - (x - fx); if (inb(mx, y)) L().img.data.set(c, idx(mx, y)); }
  }
  const lineCells = (x0, y0, x1, y1) => { const out = [], dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy; for (;;) { out.push([x0, y0]); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } } return out; };
  const rectCells = (x0, y0, x1, y1) => { const out = [], [a, b] = [Math.min(x0, x1), Math.max(x0, x1)], [c, d] = [Math.min(y0, y1), Math.max(y0, y1)]; for (let x = a; x <= b; x++) out.push([x, c], [x, d]); for (let y = c; y <= d; y++) out.push([a, y], [b, y]); return out; };
  function flood(x, y, c) {
    const t = get(x, y), same = (q) => q.every((v, i) => v === t[i]) || (q[3] === 0 && t[3] === 0);
    if (same(c)) return;
    const st = [[x, y]];
    while (st.length) { const [a, b] = st.pop(); if (!inb(a, b) || !same(get(a, b))) continue; L().img.data.set(c, idx(a, b)); st.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]); }
  }
  const state = () => ({ W: E.W, H: E.H, active: E.active, layers: E.layers.map(l => ({ name: l.name, hidden: l.hidden, img: { width: l.img.width, height: l.img.height, data: new Uint8Array(l.img.data) } })) });
  const restore = (s) => { E.W = s.W; E.H = s.H; E.layers = s.layers; E.active = Math.min(s.active, s.layers.length - 1); refreshLayers(); sync(); };
  const snapshot = () => { E.undo.push(state()); if (E.undo.length > 60) E.undo.shift(); E.redo = []; };
  $('#pxUndo').onclick = () => { if (!E.undo.length) return; E.redo.push(state()); restore(E.undo.pop()); };
  $('#pxRedo').onclick = () => { if (!E.redo.length) return; E.undo.push(state()); restore(E.redo.pop()); };

  // selection helpers
  const grab = ([x, y, w, h]) => { const d = new Uint8Array(w * h * 4); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (inb(x + i, y + j)) d.set(get(x + i, y + j), (j * w + i) * 4); return { w, h, data: d }; };
  const clearRect = ([x, y, w, h]) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (inb(x + i, y + j)) L().img.data.set([0, 0, 0, 0], idx(x + i, y + j)); };
  const stamp = (c, x, y) => { for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) { const o = (j * c.w + i) * 4; if (c.data[o + 3] && inb(x + i, y + j)) L().img.data.set(c.data.subarray(o, o + 4), idx(x + i, y + j)); } };
  const floatOf = (c, x, y) => { const cc = document.createElement('canvas'); cc.width = c.w; cc.height = c.h; cc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(c.data), c.w, c.h), 0, 0); return { ...c, x, y, canvas: cc }; };
  $('#pxCopy').onclick = () => { if (E.selRect) { E.clip = grab(E.selRect); status(`kopyalandı ${E.clip.w}×${E.clip.h}`); } };
  $('#pxPaste').onclick = () => {
    if (!E.clip) return;
    const [fw, fh] = fwh(), c = cols(), x = E.selRect ? E.selRect[0] : (E.sel % c) * fw, y = E.selRect ? E.selRect[1] : Math.floor(E.sel / c) * fh;
    snapshot(); stamp(E.clip, x, y); E.selRect = [x, y, E.clip.w, E.clip.h]; sync();
  };
  $('#pxDelSel').onclick = () => { if (E.selRect) { snapshot(); clearRect(E.selRect); sync(); } };
  $('#pxFlipSel').onclick = () => { if (!E.selRect) return; snapshot(); const c = grab(E.selRect), f = { w: c.w, h: c.h, data: new Uint8Array(c.data.length) }; for (let j = 0; j < c.h; j++) for (let i = 0; i < c.w; i++) f.data.set(c.data.subarray((j * c.w + i) * 4, (j * c.w + i) * 4 + 4), (j * c.w + c.w - 1 - i) * 4); clearRect(E.selRect); stamp(f, E.selRect[0], E.selRect[1]); sync(); };

  // ---------- pointer ----------
  const toPx = (e) => { const r = cv.getBoundingClientRect(); return [Math.floor((e.clientX - r.left - E.ox) / E.zoom), Math.floor((e.clientY - r.top - E.oy) / E.zoom)]; };
  const ptrs = new Map(); let g = null;
  const curColor = () => E.tool === 'erase' ? [0, 0, 0, 0] : E.color;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { if (g?.drew) $('#pxUndo').onclick(); const [a, b] = [...ptrs.values()]; g = { kind: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: E.zoom, ox: E.ox, oy: E.oy, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; E.preview = null; E.float = null; return; }
    const [x, y] = toPx(e), [fw, fh] = fwh();
    if (inb(x, y)) { const ns = Math.floor(y / fh) * cols() + Math.floor(x / fw); if (ns !== E.sel) { E.sel = ns; buildOnion(flat()); } }
    if (E.tool === 'pan') { g = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: E.ox, oy: E.oy }; return; }
    if (E.tool === 'pick') { if (inb(x, y)) { const f = flat(), i = idx(x, y); setColor([...f.data.subarray(i, i + 4)]); } return; }
    if (E.tool === 'select') {
      const r = E.selRect;
      if (r && x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]) { // lift & move
        snapshot(); const c = grab(r); clearRect(r); sync();
        E.float = floatOf(c, r[0], r[1]); g = { kind: 'move', sx: x, sy: y, x0: r[0], y0: r[1] };
      } else g = { kind: 'sel', x0: x, y0: y };
      return;
    }
    snapshot();
    g = { kind: 'draw', x0: x, y0: y, lx: x, ly: y, drew: true };
    if (E.tool === 'fill') { if (inb(x, y)) flood(x, y, E.color); sync(); g = null; return; }
    if (E.tool === 'pen' || E.tool === 'erase') { put(x, y, curColor()); sync(); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId) || !g) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (g.kind === 'pinch' && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const nz = Math.max(1, Math.min(64, g.z * d / g.d)), r = cv.getBoundingClientRect();
      const px = (g.mx - r.left - g.ox) / g.z, py = (g.my - r.top - g.oy) / g.z;
      E.zoom = nz; E.ox = mx - r.left - px * nz; E.oy = my - r.top - py * nz; return;
    }
    if (g.kind === 'pan') { E.ox = g.ox + e.clientX - g.sx; E.oy = g.oy + e.clientY - g.sy; return; }
    const [x, y] = toPx(e);
    if (g.kind === 'sel') { E.selRect = [Math.min(g.x0, x), Math.min(g.y0, y), Math.abs(x - g.x0) + 1, Math.abs(y - g.y0) + 1]; return; }
    if (g.kind === 'move') { E.float.x = g.x0 + x - g.sx; E.float.y = g.y0 + y - g.sy; return; }
    if (E.tool === 'pen' || E.tool === 'erase') { for (const [a, b] of lineCells(g.lx, g.ly, x, y)) put(a, b, curColor()); g.lx = x; g.ly = y; sync(); }
    else if (E.tool === 'line') E.preview = lineCells(g.x0, g.y0, x, y);
    else if (E.tool === 'rect') E.preview = rectCells(g.x0, g.y0, x, y);
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (g?.kind === 'draw' && E.preview) { for (const [a, b] of E.preview) put(a, b, E.color); E.preview = null; sync(); }
    if (g?.kind === 'move' && E.float) { stamp(E.float, E.float.x, E.float.y); E.selRect = [E.float.x, E.float.y, E.float.w, E.float.h]; E.float = null; sync(); }
    if (!ptrs.size) g = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, px = (mx - E.ox) / E.zoom, py = (my - E.oy) / E.zoom; E.zoom = Math.max(1, Math.min(64, E.zoom * (e.deltaY < 0 ? 1.2 : 0.83))); E.ox = mx - px * E.zoom; E.oy = my - py * E.zoom; }, { passive: false });
  addEventListener('keydown', (e) => {
    if (!$('#tab-px').classList.contains('on') || e.target.matches('input,textarea,select')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); (e.shiftKey ? $('#pxRedo') : $('#pxUndo')).onclick(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'c') $('#pxCopy').onclick();
    else if ((e.ctrlKey || e.metaKey) && k === 'v') $('#pxPaste').onclick();
    else if (k === 'delete' || k === 'backspace') $('#pxDelSel').onclick();
  });

  // ---------- tools / palette ----------
  document.querySelectorAll('#tab-px [data-t]').forEach(b => b.onclick = () => {
    E.tool = b.dataset.t; document.querySelectorAll('#tab-px [data-t]').forEach(x => x.classList.toggle('on', x === b));
    $('#pxSelOps').hidden = E.tool !== 'select'; if (E.tool !== 'select') E.selRect = null;
  });
  $('#pxMirror').onclick = () => { E.mirror = !E.mirror; $('#pxMirror').classList.toggle('on', E.mirror); };
  const nearest = (c) => E.lockPal ? snapToPalette({ width: 1, height: 1, data: new Uint8Array([c[0], c[1], c[2], 255]) }, E.lockPal).img.data : c;
  function setColor(c) { if (!c[3]) { E.color = [0, 0, 0, 0]; return drawPal(); } const n = nearest(c); E.color = [n[0], n[1], n[2], 255]; $('#pxColor').value = toHex(n[0], n[1], n[2]); drawPal(); }
  $('#pxColor').oninput = (e) => setColor(hex(e.target.value));
  function drawPal(f = flat()) {
    const list = E.lockPal ? E.lockPal.map(c => toHex(...c)) : [...new Set([...E.extraPal, ...palette(f).filter(([k]) => k !== 'transparent').slice(0, 40).map(([k]) => k)])];
    const cur = toHex(...E.color);
    $('#pxPal').innerHTML = list.map(k => `<i style="background:${k}" data-c="${k}" class="${k === cur ? 'on' : ''} ${E.lockPal ? 'lock' : ''}" title="${k}"></i>`).join('');
  }
  $('#pxPal').onclick = (e) => { if (e.target.dataset.c) setColor(hex(e.target.dataset.c)); };
  $('#pxRamp').onclick = () => { const r = ramp(toHex(...E.color), 5); E.extraPal = [...r, ...E.extraPal.filter(c => !r.includes(c))].slice(0, 20); drawPal(); status('ramp: ' + r.join(' ') + (E.lockPal ? ' (palet kilidi açıkken görünmez)' : '')); };
  $('#pxLock').onchange = async (e) => {
    const v = e.target.value;
    if (!v) E.lockPal = null;
    else {
      const src = v === '@self' ? flat() : await imgFromUrl(`data/img/${v}.png`).catch(() => null);
      if (!src) { status('palet yüklenemedi'); E.lockPal = null; }
      else E.lockPal = palette(src).filter(([k]) => k.length === 7).slice(0, 32).map(([k]) => hex(k));
    }
    if (E.lockPal) setColor(E.color); sync();
  };

  // ---------- layers ----------
  $('#pxLayer').onchange = (e) => { E.active = +e.target.value; };
  $('#pxLAdd').onclick = () => { snapshot(); E.layers.splice(E.active + 1, 0, blank('katman' + (E.layers.length + 1))); E.active++; refreshLayers(); };
  $('#pxLDel').onclick = () => { if (E.layers.length < 2) return; snapshot(); E.layers.splice(E.active, 1); E.active = Math.max(0, E.active - 1); refreshLayers(); sync(); };
  $('#pxLVis').onclick = () => { L().hidden = !L().hidden; refreshLayers(); sync(); };
  $('#pxLUp').onclick = () => { if (E.active >= E.layers.length - 1) return; snapshot(); const a = E.active; [E.layers[a], E.layers[a + 1]] = [E.layers[a + 1], E.layers[a]]; E.active++; refreshLayers(); sync(); };
  $('#pxLMerge').onclick = () => { if (!E.active) return; snapshot(); const top = L(), below = E.layers[E.active - 1]; below.img = flatten([{ ...below, x: 0, y: 0, hidden: false }, { ...top, x: 0, y: 0 }], E.W, E.H); E.layers.splice(E.active, 1); E.active--; refreshLayers(); sync(); };
  $('#pxOnion').onchange = () => sync();

  // ---------- kind / size / io ----------
  $('#pxKind').onchange = (e) => { const sp = SPECS[e.target.value]; if (sp) { $('#pxFW').value = sp.frame[0]; $('#pxFH').value = sp.frame[1]; } sync(); };
  $('#pxPreset').onchange = (e) => {
    const v = e.target.value; if (!v) return;
    const [w, h] = KIND_SIZE[v] || v.split('x').map(Number);
    if (SPECS[v]) { $('#pxKind').value = v; $('#pxFW').value = SPECS[v].frame[0]; $('#pxFH').value = SPECS[v].frame[1]; }
    else { $('#pxFW').value = w; $('#pxFH').value = h; }
    $('#pxFrames').value = v === 'npc' ? '0,1,2,3' : '0';
    E.W = w; E.H = h; setProject([blank('taban')], w, h); e.target.value = '';
  };
  $('#pxResize').onclick = () => {
    const w = +$('#pxW').value, h = +$('#pxH').value;
    snapshot();
    for (const l of E.layers) { const out = newImg(w, h); for (let y = 0; y < Math.min(h, E.H); y++) out.data.set(l.img.data.subarray(y * E.W * 4, y * E.W * 4 + Math.min(w, E.W) * 4), y * w * 4); l.img = out; }
    E.W = w; E.H = h; sync(); fit();
  };
  const imgFromUrl = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); res({ width: im.width, height: im.height, data: new Uint8Array(x.getImageData(0, 0, im.width, im.height).data) }); }; im.onerror = rej; im.src = url; });
  const fromImg = (im, name = 'taban') => setProject([{ name, hidden: false, img: im }], im.width, im.height);
  $('#pxOpen').onchange = async (e) => { const f = e.target.files[0]; if (f) fromImg(await imgFromUrl(URL.createObjectURL(f)), f.name.replace(/\.png$/i, '')); };
  $('#pxSample').onclick = async () => { $('#pxKind').value = 'npc'; $('#pxFW').value = 16; $('#pxFH').value = 32; $('#pxFrames').value = '0,1,2,3'; fromImg(await imgFromUrl(sampleUrl), 'npc'); };
  $('#pxSave').onclick = () => buf.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'sprite.png'; a.click(); });
  $('#pxUse').onclick = () => { const c = document.createElement('canvas'); c.width = buf.width; c.height = buf.height; c.getContext('2d').drawImage(buf, 0, 0); window.dispatchEvent(new CustomEvent('sprite', { detail: c })); document.querySelector('nav [data-tab=map]').click(); };

  // ---------- PXT (same format as the px CLI) ----------
  $('#pxToText').onclick = () => {
    const [fw, fh] = fwh(), c = cols(), x = (E.sel % c) * fw, y = Math.floor(E.sel / c) * fh;
    $('#pxTX').value = x; $('#pxTY').value = y;
    try { $('#pxText').value = toPxt(flat(), { rect: [x, y, Math.min(fw, E.W - x), Math.min(fh, E.H - y)] }); } catch (err) { status(err.message); }
  };
  $('#pxAllText').onclick = () => {
    try { $('#pxText').value = E.layers.length > 1 ? toLayeredPxt(E.layers.map(l => ({ ...l, x: 0, y: 0 })), E.W, E.H) : toPxt(flat()); $('#pxTX').value = 0; $('#pxTY').value = 0; } catch (err) { status(err.message); }
  };
  const fullLayer = (pl, W, H, dx = 0, dy = 0) => { const img = newImg(W, H); for (let y = 0; y < pl.img.height; y++) for (let x = 0; x < pl.img.width; x++) { const X = pl.x + x + dx, Y = pl.y + y + dy, o = (y * pl.img.width + x) * 4; if (X >= 0 && Y >= 0 && X < W && Y < H && pl.img.data[o + 3]) img.data.set(pl.img.data.subarray(o, o + 4), (Y * W + X) * 4); } return { name: pl.name, hidden: pl.hidden, img }; };
  $('#pxFromText').onclick = () => {
    const p = parsePxt($('#pxText').value), X = +$('#pxTX').value || 0, Y = +$('#pxTY').value || 0;
    if (p.warnings) status(p.warnings.join(' '));
    if ((p.layers.length > 1 || p.width > E.W || p.height > E.H) && X === 0 && Y === 0) return setProject(p.layers.map(l => fullLayer(l, p.width, p.height)), p.width, p.height);
    snapshot(); stamp({ w: p.width, h: p.height, data: p.data }, X, Y); sync();
  };
  $('#pxAsLayer').onclick = () => {
    const p = parsePxt($('#pxText').value), X = +$('#pxTX').value || 0, Y = +$('#pxTY').value || 0;
    snapshot();
    const l = fullLayer({ name: p.layers.length === 1 && p.layers[0].name !== 'base' ? p.layers[0].name : 'ai', x: 0, y: 0, img: p }, E.W, E.H, X, Y);
    E.layers.push(l); E.active = E.layers.length - 1; refreshLayers(); sync();
  };

  // ---------- animation preview ----------
  const an = $('#pxAnim'), actx = an.getContext('2d'); let ai = 0, at = 0;
  function anim(t) {
    const fps = +$('#pxFps').value || 6;
    if (t - at > 1000 / fps) {
      at = t;
      const frames = $('#pxFrames').value.split(/[ ,]+/).map(Number).filter(n => !isNaN(n)), [fw, fh] = fwh(), c = cols();
      an.width = fw; an.height = fh; actx.clearRect(0, 0, fw, fh);
      if (frames.length) { const f = frames[ai++ % frames.length]; actx.drawImage(buf, (f % c) * fw, Math.floor(f / c) * fh, fw, fh, 0, 0, fw, fh); }
    }
    requestAnimationFrame(anim);
  }

  new ResizeObserver(() => { resize(); const r = stage.getBoundingClientRect(); if (r.width && !E.fitted) { E.fitted = true; fit(); } }).observe(stage);
  setProject([blank('taban')], 16, 32);
  requestAnimationFrame(raf); requestAnimationFrame(anim);
}
