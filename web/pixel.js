// Mobile-friendly pixel editor sharing the PXT text format with the `px` CLI.
import { parsePxt, toPxt, palette } from './core/pixel.mjs';
import { newImg, hex, toHex } from './core/raster.mjs';

const $ = (s) => document.querySelector(s);

export function initPixel({ status, sampleUrl }) {
  const cv = $('#pxCv'), ctx = cv.getContext('2d'), stage = $('#pxStage');
  const E = { img: newImg(16, 32), tool: 'pen', color: [59, 42, 74, 255], zoom: 12, ox: 20, oy: 20, mirror: false, undo: [], redo: [], sel: 0 };
  const buf = document.createElement('canvas'), bctx = buf.getContext('2d');
  const dpr = () => window.devicePixelRatio || 1;

  function sync() { buf.width = E.img.width; buf.height = E.img.height; bctx.putImageData(new ImageData(new Uint8ClampedArray(E.img.data), E.img.width, E.img.height), 0, 0); $('#pxW').value = E.img.width; $('#pxH').value = E.img.height; drawPal(); }
  function resize() { const r = stage.getBoundingClientRect(); cv.width = r.width * dpr(); cv.height = r.height * dpr(); }
  function fit() { const r = stage.getBoundingClientRect(); E.zoom = Math.max(1, Math.floor(Math.min((r.width - 20) / E.img.width, (r.height - 20) / E.img.height))); E.ox = (r.width - E.img.width * E.zoom) / 2; E.oy = (r.height - E.img.height * E.zoom) / 2; }
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    const z = E.zoom * dpr(), ox = E.ox * dpr(), oy = E.oy * dpr();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, ox, oy, E.img.width * z, E.img.height * z);
    const W = E.img.width, H = E.img.height;
    if ($('#pxGrid').checked && E.zoom >= 6) {
      ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x <= W; x++) { ctx.moveTo(ox + x * z + .5, oy); ctx.lineTo(ox + x * z + .5, oy + H * z); }
      for (let y = 0; y <= H; y++) { ctx.moveTo(ox, oy + y * z + .5); ctx.lineTo(ox + W * z, oy + y * z + .5); }
      ctx.stroke();
    }
    const fw = +$('#pxFW').value || W, fh = +$('#pxFH').value || H;
    ctx.strokeStyle = '#e8a33b99'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let x = 0; x <= W; x += fw) { ctx.moveTo(ox + x * z, oy); ctx.lineTo(ox + x * z, oy + H * z); }
    for (let y = 0; y <= H; y += fh) { ctx.moveTo(ox, oy + y * z); ctx.lineTo(ox + W * z, oy + y * z); }
    ctx.stroke();
    const cols = Math.max(1, Math.floor(W / fw));
    ctx.strokeStyle = '#fff'; ctx.strokeRect(ox + (E.sel % cols) * fw * z, oy + Math.floor(E.sel / cols) * fh * z, fw * z, fh * z);
    if (E.preview) { ctx.fillStyle = toHex(...E.color); for (const [x, y] of E.preview) ctx.fillRect(ox + x * z, oy + y * z, z, z); }
  }
  const raf = () => { draw(); requestAnimationFrame(raf); };

  // --- pixel ops
  const idx = (x, y) => (y * E.img.width + x) * 4;
  const inb = (x, y) => x >= 0 && y >= 0 && x < E.img.width && y < E.img.height;
  const get = (x, y) => [...E.img.data.subarray(idx(x, y), idx(x, y) + 4)];
  function put(x, y, c) {
    if (!inb(x, y)) return;
    E.img.data.set(c, idx(x, y));
    if (E.mirror) { const fw = +$('#pxFW').value || E.img.width, fx = Math.floor(x / fw) * fw, mx = fx + fw - 1 - (x - fx); if (inb(mx, y)) E.img.data.set(c, idx(mx, y)); }
  }
  const lineCells = (x0, y0, x1, y1) => { const out = [], dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy; for (;;) { out.push([x0, y0]); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } } return out; };
  const rectCells = (x0, y0, x1, y1) => { const out = [], [a, b] = [Math.min(x0, x1), Math.max(x0, x1)], [c, d] = [Math.min(y0, y1), Math.max(y0, y1)]; for (let x = a; x <= b; x++) out.push([x, c], [x, d]); for (let y = c; y <= d; y++) out.push([a, y], [b, y]); return out; };
  function flood(x, y, c) {
    const t = get(x, y), same = (q) => q.every((v, i) => v === t[i]) || (q[3] === 0 && t[3] === 0);
    if (same(c)) return;
    const st = [[x, y]];
    while (st.length) { const [a, b] = st.pop(); if (!inb(a, b) || !same(get(a, b))) continue; E.img.data.set(c, idx(a, b)); st.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]); }
  }
  const snapshot = () => { E.undo.push(new Uint8Array(E.img.data)); if (E.undo.length > 60) E.undo.shift(); E.redo = []; };
  $('#pxUndo').onclick = () => { if (!E.undo.length) return; E.redo.push(E.img.data); E.img.data = E.undo.pop(); sync(); };
  $('#pxRedo').onclick = () => { if (!E.redo.length) return; E.undo.push(E.img.data); E.img.data = E.redo.pop(); sync(); };

  // --- pointer
  const toPx = (e) => { const r = cv.getBoundingClientRect(); return [Math.floor((e.clientX - r.left - E.ox) / E.zoom), Math.floor((e.clientY - r.top - E.oy) / E.zoom)]; };
  const ptrs = new Map(); let g = null;
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { if (g?.drew) $('#pxUndo').onclick(); const [a, b] = [...ptrs.values()]; g = { kind: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: E.zoom, ox: E.ox, oy: E.oy, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 }; E.preview = null; return; }
    const [x, y] = toPx(e);
    const fw = +$('#pxFW').value || E.img.width, fh = +$('#pxFH').value || E.img.height;
    if (inb(x, y)) E.sel = Math.floor(y / fh) * Math.max(1, Math.floor(E.img.width / fw)) + Math.floor(x / fw);
    if (E.tool === 'pan') { g = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: E.ox, oy: E.oy }; return; }
    if (E.tool === 'pick') { if (inb(x, y)) setColor(get(x, y)); return; }
    snapshot();
    g = { kind: 'draw', x0: x, y0: y, lx: x, ly: y, drew: true };
    if (E.tool === 'fill') { if (inb(x, y)) flood(x, y, E.color); sync(); g = null; return; }
    if (E.tool === 'pen' || E.tool === 'erase') { put(x, y, E.tool === 'erase' ? [0, 0, 0, 0] : E.color); sync(); }
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
    if (E.tool === 'pen' || E.tool === 'erase') { for (const [a, b] of lineCells(g.lx, g.ly, x, y)) put(a, b, E.tool === 'erase' ? [0, 0, 0, 0] : E.color); g.lx = x; g.ly = y; sync(); }
    else if (E.tool === 'line') E.preview = lineCells(g.x0, g.y0, x, y);
    else if (E.tool === 'rect') E.preview = rectCells(g.x0, g.y0, x, y);
  });
  const up = (e) => {
    ptrs.delete(e.pointerId);
    if (g?.kind === 'draw' && E.preview) { for (const [a, b] of E.preview) put(a, b, E.color); E.preview = null; sync(); }
    if (!ptrs.size) g = null;
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, px = (mx - E.ox) / E.zoom, py = (my - E.oy) / E.zoom; E.zoom = Math.max(1, Math.min(64, E.zoom * (e.deltaY < 0 ? 1.2 : 0.83))); E.ox = mx - px * E.zoom; E.oy = my - py * E.zoom; }, { passive: false });

  // --- tools & palette
  document.querySelectorAll('#tab-px [data-t]').forEach(b => b.onclick = () => { E.tool = b.dataset.t; document.querySelectorAll('#tab-px [data-t]').forEach(x => x.classList.toggle('on', x === b)); });
  $('#pxMirror').onclick = () => { E.mirror = !E.mirror; $('#pxMirror').classList.toggle('on', E.mirror); };
  function setColor(c) { E.color = c[3] ? [c[0], c[1], c[2], 255] : [0, 0, 0, 0]; if (c[3]) $('#pxColor').value = toHex(c[0], c[1], c[2]); drawPal(); }
  $('#pxColor').oninput = (e) => { E.color = hex(e.target.value); drawPal(); };
  function drawPal() {
    const pal = palette(E.img).filter(([k]) => k !== 'transparent').slice(0, 40);
    const cur = toHex(...E.color);
    $('#pxPal').innerHTML = pal.map(([k]) => `<i style="background:${k}" data-c="${k}" class="${k === cur ? 'on' : ''}" title="${k}"></i>`).join('');
  }
  $('#pxPal').onclick = (e) => { if (e.target.dataset.c) setColor(hex(e.target.dataset.c)); };

  // --- size / io
  function setImg(im) { E.img = { width: im.width, height: im.height, data: new Uint8Array(im.data) }; E.undo = []; E.redo = []; E.sel = 0; sync(); resize(); fit(); }
  $('#pxPreset').onchange = (e) => {
    const v = e.target.value; if (!v) return;
    const [w, h] = v.split('x').map(Number);
    if (w === 64 && h === 128) { $('#pxFW').value = 16; $('#pxFH').value = 32; $('#pxFrames').value = '0,1,2,3'; }
    else if (w === 128) { $('#pxFW').value = 64; $('#pxFH').value = 64; $('#pxFrames').value = '0'; }
    else { $('#pxFW').value = w; $('#pxFH').value = h; $('#pxFrames').value = '0'; }
    setImg(newImg(w, h)); e.target.value = '';
  };
  $('#pxResize').onclick = () => {
    const w = +$('#pxW').value, h = +$('#pxH').value, out = newImg(w, h);
    for (let y = 0; y < Math.min(h, E.img.height); y++) for (let x = 0; x < Math.min(w, E.img.width); x++) out.data.set(E.img.data.subarray(idx(x, y), idx(x, y) + 4), (y * w + x) * 4);
    setImg(out);
  };
  const imgFromUrl = (url) => new Promise((res, rej) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); res({ width: im.width, height: im.height, data: new Uint8Array(x.getImageData(0, 0, im.width, im.height).data) }); }; im.onerror = rej; im.src = url; });
  $('#pxOpen').onchange = async (e) => { const f = e.target.files[0]; if (f) setImg(await imgFromUrl(URL.createObjectURL(f))); };
  $('#pxSample').onclick = async () => { setImg(await imgFromUrl(sampleUrl)); $('#pxFW').value = 16; $('#pxFH').value = 32; $('#pxFrames').value = '0,1,2,3'; };
  $('#pxSave').onclick = () => buf.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'sprite.png'; a.click(); });
  $('#pxUse').onclick = () => { const c = document.createElement('canvas'); c.width = buf.width; c.height = buf.height; c.getContext('2d').drawImage(buf, 0, 0); window.dispatchEvent(new CustomEvent('sprite', { detail: c })); document.querySelector('nav [data-tab=map]').click(); };
  $('#pxToText').onclick = () => {
    const fw = +$('#pxFW').value || E.img.width, fh = +$('#pxFH').value || E.img.height, cols = Math.max(1, Math.floor(E.img.width / fw));
    const x = (E.sel % cols) * fw, y = Math.floor(E.sel / cols) * fh;
    $('#pxTX').value = x; $('#pxTY').value = y;
    try { $('#pxText').value = toPxt(E.img, { rect: [x, y, Math.min(fw, E.img.width - x), Math.min(fh, E.img.height - y)] }); } catch (err) { status(err.message); }
  };
  $('#pxAllText').onclick = () => { try { $('#pxText').value = toPxt(E.img); $('#pxTX').value = 0; $('#pxTY').value = 0; } catch (err) { status(err.message); } };
  $('#pxFromText').onclick = () => {
    const p = parsePxt($('#pxText').value), X = +$('#pxTX').value || 0, Y = +$('#pxTY').value || 0;
    if (p.warnings) status(p.warnings.join(' '));
    if (X === 0 && Y === 0 && (p.width > E.img.width || p.height > E.img.height)) return setImg(p);
    snapshot();
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) if (inb(X + x, Y + y)) E.img.data.set(p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4), idx(X + x, Y + y));
    sync();
  };

  // --- animation preview
  const an = $('#pxAnim'), actx = an.getContext('2d'); let ai = 0, at = 0;
  function anim(t) {
    const fps = +$('#pxFps').value || 6;
    if (t - at > 1000 / fps) {
      at = t;
      const frames = $('#pxFrames').value.split(/[ ,]+/).map(Number).filter(n => !isNaN(n));
      const fw = +$('#pxFW').value || E.img.width, fh = +$('#pxFH').value || E.img.height, cols = Math.max(1, Math.floor(E.img.width / fw));
      an.width = fw; an.height = fh; actx.clearRect(0, 0, fw, fh);
      if (frames.length) { const f = frames[ai++ % frames.length]; actx.drawImage(buf, (f % cols) * fw, Math.floor(f / cols) * fh, fw, fh, 0, 0, fw, fh); }
    }
    requestAnimationFrame(anim);
  }

  window.addEventListener('resize', () => { resize(); });
  new ResizeObserver(() => { resize(); const r = stage.getBoundingClientRect(); if (r.width && !E.fitted) { E.fitted = true; fit(); } }).observe(stage);
  sync(); resize(); fit(); requestAnimationFrame(raf); requestAnimationFrame(anim);
}
