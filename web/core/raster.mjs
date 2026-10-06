// Software RGBA raster ops shared by renderer and pixel tools. img = {width,height,data:Uint8Array RGBA}
export const newImg = (w, h, fill) => {
  const d = new Uint8Array(w * h * 4);
  if (fill) for (let i = 0; i < d.length; i += 4) d.set(fill, i);
  return { width: w, height: h, data: d };
};
export const cloneImg = (im) => ({ width: im.width, height: im.height, data: new Uint8Array(im.data) });

export function blend(dst, i, r, g, b, a) {
  if (a === 255) { dst[i] = r; dst[i + 1] = g; dst[i + 2] = b; dst[i + 3] = 255; return; }
  if (!a) return;
  const da = dst[i + 3] / 255, sa = a / 255, oa = sa + da * (1 - sa);
  dst[i] = (r * sa + dst[i] * da * (1 - sa)) / oa; dst[i + 1] = (g * sa + dst[i + 1] * da * (1 - sa)) / oa;
  dst[i + 2] = (b * sa + dst[i + 2] * da * (1 - sa)) / oa; dst[i + 3] = oa * 255;
}

// draw src rect (sx,sy,w,h) at (dx,dy) with integer scale and optional flipX
export function blit(dst, src, sx, sy, w, h, dx, dy, scale = 1, flipX = false) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((sy + y) * src.width + sx + (flipX ? w - 1 - x : x)) * 4;
    if (sx + x >= src.width || sy + y >= src.height) continue;
    const a = src.data[si + 3]; if (!a) continue;
    for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < scale; xx++) {
      const px = dx + x * scale + xx, py = dy + y * scale + yy;
      if (px < 0 || py < 0 || px >= dst.width || py >= dst.height) continue;
      blend(dst.data, (py * dst.width + px) * 4, src.data[si], src.data[si + 1], src.data[si + 2], a);
    }
  }
}

export function fillRect(im, x, y, w, h, [r, g, b, a = 255]) {
  for (let yy = Math.max(0, y); yy < Math.min(im.height, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(im.width, x + w); xx++) blend(im.data, (yy * im.width + xx) * 4, r, g, b, a);
}

// 3x5 font: digits, a few letters, punctuation
const FONT = {
  '0': 0x7b6f, '1': 0x2c97, '2': 0x73e7, '3': 0x73cf, '4': 0x5bc9, '5': 0x79cf, '6': 0x79ef, '7': 0x7249, '8': 0x7bef, '9': 0x7bcf,
  ',': 0x0014, '-': 0x01c0, ':': 0x0410, 'x': 0x02aa, 'D': 0x6b6e, 'W': 0x5bfd, ' ': 0,
};
export function text(im, s, x, y, color = [255, 255, 255, 255], scale = 1, bg = [0, 0, 0, 160]) {
  s = String(s);
  if (bg) fillRect(im, x - 1, y - 1, s.length * 4 * scale + 1, 5 * scale + 2, bg);
  for (const c of s) {
    const bits = FONT[c] ?? 0;
    for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++)
      if (bits & (1 << (14 - (r * 3 + k)))) fillRect(im, x + k * scale, y + r * scale, scale, scale, color);
    x += 4 * scale;
  }
}

export const hex = (h) => {
  if (h == null || h === 'transparent' || h === '') return [0, 0, 0, 0];
  if (Array.isArray(h)) return h;
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return h.length === 8 ? [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};
export const toHex = (r, g, b, a = 255) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('') + (a === 255 ? '' : a.toString(16).padStart(2, '0'));
