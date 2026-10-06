// Minimal PNG encode/decode (RGBA8 out) using node:zlib. Zero dependencies.
import zlib from 'node:zlib';
import fs from 'node:fs';

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePNG({ width, height, data }) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function decodePNG(buf) {
  let p = 8, w, h, depth, ctype, inter, pal, trns; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; inter = d[12]; }
    else if (type === 'PLTE') pal = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const bpp = Math.max(1, (ch * depth) >> 3);
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h * 4);
  const scale = depth < 8 && ctype !== 3 ? 255 / ((1 << depth) - 1) : 1;
  let off = 0;
  // decode one (sub)image of pw x ph and write its pixels to (x0 + x*dx, y0 + y*dy)
  const pass = (pw, ph, x0, y0, dx, dy) => {
    if (!pw || !ph) return;
    const stride = (pw * ch * depth + 7) >> 3, cur = Buffer.alloc(stride * ph);
    for (let y = 0; y < ph; y++) {
      const f = raw[off + y * (stride + 1)], src = raw.subarray(off + y * (stride + 1) + 1, off + (y + 1) * (stride + 1));
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? cur[y * stride + x - bpp] : 0, b = y ? cur[(y - 1) * stride + x] : 0, c = y && x >= bpp ? cur[(y - 1) * stride + x - bpp] : 0;
        let v = src[x];
        if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        cur[y * stride + x] = v;
      }
    }
    off += (stride + 1) * ph;
    const sample = (row, i) => {
      if (depth === 8) return cur[row * stride + i];
      if (depth === 16) return cur[row * stride + i * 2];
      const per = 8 / depth, byte = cur[row * stride + Math.floor(i / per)];
      return (byte >> (8 - depth * (i % per + 1))) & ((1 << depth) - 1);
    };
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const o = ((y0 + y * dy) * w + x0 + x * dx) * 4;
      if (ctype === 3) { const i = sample(y, x); out[o] = pal[i * 3]; out[o + 1] = pal[i * 3 + 1]; out[o + 2] = pal[i * 3 + 2]; out[o + 3] = trns && i < trns.length ? trns[i] : 255; }
      else if (ctype === 0 || ctype === 4) { const g = sample(y, x * ch) * scale; out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = ctype === 4 ? sample(y, x * ch + 1) : 255; }
      else { for (let c = 0; c < 3; c++) out[o + c] = sample(y, x * ch + c); out[o + 3] = ctype === 6 ? sample(y, x * ch + 3) : 255; }
    }
  };
  if (!inter) pass(w, h, 0, 0, 1, 1);
  else for (const [x0, y0, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]])
    pass(Math.ceil((w - x0) / dx), Math.ceil((h - y0) / dy), x0, y0, dx, dy);
  return { width: w, height: h, data: out };
}

export const readPNG = (f) => decodePNG(fs.readFileSync(f));
export const writePNG = (f, img) => fs.writeFileSync(f, encodePNG(img));
