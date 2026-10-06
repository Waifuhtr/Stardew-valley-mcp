// XNB reader (LZ4/uncompressed) for Texture2D and xTile (tBIN10) maps. Zero dependencies.

export function lz4Block(src, outSize) {
  const out = new Uint8Array(outSize);
  let s = 0, d = 0;
  while (s < src.length) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
    out.set(src.subarray(s, s + lit), d); s += lit; d += lit;
    if (s >= src.length) break;
    const off = src[s] | (src[s + 1] << 8); s += 2;
    let len = token & 15;
    if (len === 15) { let b; do { b = src[s++]; len += b; } while (b === 255); }
    len += 4;
    for (let i = 0; i < len; i++, d++) out[d] = out[d - off];
  }
  return out;
}

class Reader {
  constructor(buf, pos = 0) { this.b = buf; this.p = pos; this.v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  u8() { return this.b[this.p++]; }
  i32() { const x = this.v.getInt32(this.p, true); this.p += 4; return x; }
  u32() { const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
  f32() { const x = this.v.getFloat32(this.p, true); this.p += 4; return x; }
  bytes(n) { const x = this.b.subarray(this.p, this.p + n); this.p += n; return x; }
  v7() { let r = 0, sh = 0, b; do { b = this.u8(); r |= (b & 127) << sh; sh += 7; } while (b & 128); return r; }
  str7() { return new TextDecoder().decode(this.bytes(this.v7())); }
  str32() { return new TextDecoder().decode(this.bytes(this.i32())); }
}

export function readXnb(buf) {
  if (buf[0] !== 0x58 || buf[1] !== 0x4e || buf[2] !== 0x42) throw new Error('not XNB');
  const flags = buf[5];
  const r0 = new Reader(buf, 6);
  r0.u32(); // file size
  let body;
  if (flags & 0x40) { const n = r0.u32(); body = lz4Block(buf.subarray(14), n); }
  else if (flags & 0x80) throw new Error('LZX compressed XNB not supported (use PC unpacked or Android LZ4)');
  else body = buf.subarray(10);
  const r = new Reader(body);
  const readers = [];
  const n = r.v7();
  for (let i = 0; i < n; i++) { readers.push(r.str7()); r.i32(); }
  r.v7(); // shared resources
  const id = r.v7();
  const type = readers[id - 1] || '';
  if (type.includes('Texture2DReader')) return { type: 'texture', ...readTexture(r) };
  if (type.includes('TideReader')) { const len = r.i32(); return { type: 'map', ...readTbin(r.bytes(len)) }; }
  return { type: 'other', reader: type };
}

function readTexture(r) {
  const fmt = r.i32(), rw = r.u32(), rh = r.u32(), mips = r.u32();
  if (fmt !== 0) throw new Error('unsupported surface format ' + fmt);
  // Android builds pack "real size << 16 | power-of-two storage size"
  const sw = rw > 0xffff ? rw & 0xffff : rw, sh = rh > 0xffff ? rh & 0xffff : rh;
  const w = rw > 0xffff ? rw >>> 16 : rw, h = rh > 0xffff ? rh >>> 16 : rh;
  const size = r.u32();
  const all = r.bytes(size);
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) px.set(all.subarray(y * sw * 4, y * sw * 4 + w * 4), y * w * 4);
  // XNA content is premultiplied; restore straight alpha
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a > 0 && a < 255) for (let c = 0; c < 3; c++) px[i + c] = Math.min(255, Math.round(px[i + c] * 255 / a));
  }
  return { width: w, height: h, data: px, mips };
}

function readProps(r) {
  const n = r.i32(), o = {};
  for (let i = 0; i < n; i++) {
    const k = r.str32(), t = r.u8();
    o[k] = t === 0 ? !!r.u8() : t === 1 ? r.i32() : t === 2 ? r.f32() : r.str32();
  }
  return o;
}

export function readTbin(buf) {
  const r = new Reader(buf);
  const magic = new TextDecoder().decode(r.bytes(6));
  if (magic !== 'tBIN10') throw new Error('bad tbin ' + magic);
  const map = { id: r.str32(), desc: r.str32(), props: readProps(r), sheets: [], layers: [] };
  const ns = r.i32();
  for (let i = 0; i < ns; i++) {
    map.sheets.push({ id: r.str32(), desc: r.str32(), image: r.str32(), cols: r.i32(), rows: r.i32(),
      tw: r.i32(), th: r.i32(), margin: [r.i32(), r.i32()], spacing: [r.i32(), r.i32()], props: readProps(r) });
  }
  const nl = r.i32();
  for (let i = 0; i < nl; i++) {
    const L = { id: r.str32(), visible: !!r.u8(), desc: r.str32(), w: r.i32(), h: r.i32(), tw: r.i32(), th: r.i32(), props: readProps(r) };
    const tiles = new Array(L.w * L.h).fill(null);
    let sheet = null;
    const readTile = () => {
      for (;;) {
        const c = String.fromCharCode(r.u8());
        if (c === 'T') { sheet = r.str32(); continue; }
        if (c === 'S') { const idx = r.i32(); r.u8(); const p = readProps(r); return { s: sheet, i: idx, p }; }
        if (c === 'A') {
          const interval = r.i32(), fc = r.i32(), frames = [];
          for (let k = 0; k < fc; k++) frames.push(readTile());
          const p = readProps(r);
          return { s: frames[0].s, i: frames[0].i, p, anim: { interval, frames: frames.map(f => [f.s, f.i]) } };
        }
        throw new Error('bad tile code ' + c);
      }
    };
    for (let y = 0; y < L.h; y++) {
      let x = 0;
      while (x < L.w) {
        const c = String.fromCharCode(r.u8());
        if (c === 'T') { sheet = r.str32(); continue; }
        if (c === 'N') { x += r.i32(); continue; }
        r.p--;
        tiles[y * L.w + x] = readTile();
        x++;
      }
    }
    L.tiles = tiles;
    map.layers.push(L);
  }
  return map;
}
