// Tiled TMX <-> map JSON (same shape as data/maps/*.json). Browser + Node.
// inflate(bytes, 'zlib'|'gzip') -> Promise<Uint8Array> must be supplied for compressed layers.

function parseXml(src) {
  const root = { tag: '#root', attrs: {}, kids: [], text: '' }, stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += ent(m[6]);
    else if (m[3]) {
      if (m[2]) { stack.pop(); continue; }
      const attrs = {};
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = ent(a[2] ?? a[3]);
      const el = { tag: m[3], attrs, kids: [], text: '' };
      top.kids.push(el);
      if (!m[5]) stack.push(el);
    }
  }
  return root;
}
const kids = (el, tag) => el.kids.filter(k => k.tag === tag);
const kid = (el, tag) => el.kids.find(k => k.tag === tag);
const propsOf = (el) => {
  const p = kid(el, 'properties'); if (!p) return {};
  return Object.fromEntries(kids(p, 'property').map(q => [q.attrs.name, q.attrs.value ?? q.text]));
};
const fromB64 = (s) => { const b = atob(s.replace(/\s+/g, '')), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

// textures: index.textures (to resolve image names to vanilla keys)
export async function tmxToJson(src, { name = 'Custom', textures = {}, inflate } = {}) {
  const map = kid(parseXml(src), 'map');
  if (!map) throw new Error('not a TMX map');
  const W = +map.attrs.width, H = +map.attrs.height, warnings = [];
  if (+map.attrs.tilewidth !== 16 || +map.attrs.tileheight !== 16) warnings.push(`tile size ${map.attrs.tilewidth}x${map.attrs.tileheight} (Stardew needs 16x16)`);
  const sheets = [], anim = {}, tp = {};
  const tsAnim = {};
  for (const ts of kids(map, 'tileset')) {
    if (ts.attrs.source) { warnings.push(`external tileset ${ts.attrs.source} not supported; embed it`); continue; }
    const im = kid(ts, 'image') || { attrs: {} };
    const imgSrc = (im.attrs.source || '').replace(/\\/g, '/');
    const base = imgSrc.split('/').pop().replace(/\.png$/i, '');
    const key = Object.keys(textures).find(k => k.split('/').pop() === base);
    const cols = +ts.attrs.columns || Math.floor((+im.attrs.width || 0) / 16);
    const rows = Math.ceil((+ts.attrs.tilecount || cols) / cols);
    const sh = { id: ts.attrs.name, img: key || base, cols, rows, first: +ts.attrs.firstgid, tp: {} };
    if (!key) { sh.missing = true; sh.src = imgSrc; }
    for (const t of kids(ts, 'tile')) {
      const p = propsOf(t); if (Object.keys(p).length) sh.tp[t.attrs.id] = p;
      const a = kid(t, 'animation');
      if (a) tsAnim[sh.first + +t.attrs.id] = kids(a, 'frame').map(f => [sh.first + +f.attrs.tileid, +f.attrs.duration]);
    }
    sheets.push(sh);
  }
  sheets.sort((a, b) => a.first - b.first);
  const layers = [];
  for (const L of kids(map, 'layer')) {
    const d = kid(L, 'data'), arr = new Uint16Array(W * H);
    let vals;
    if (d.attrs.encoding === 'csv') vals = d.text.trim().split(/[\s,]+/).map(Number);
    else if (d.attrs.encoding === 'base64') {
      let bytes = fromB64(d.text.trim());
      if (d.attrs.compression) {
        if (!inflate) throw new Error('compressed TMX layer needs inflate()');
        bytes = await inflate(bytes, d.attrs.compression);
      }
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      vals = Array.from({ length: W * H }, (_, i) => dv.getUint32(i * 4, true));
    } else vals = kids(d, 'tile').map(t => +(t.attrs.gid || 0));
    vals.forEach((g, i) => {
      g = g & 0x1fffffff; if (i >= arr.length) return; arr[i] = g;
      if (g && tsAnim[g]) {
        const fr = tsAnim[g];
        (anim[L.attrs.name] ||= {})[`${i % W},${Math.floor(i / W)}`] = [fr[0][1], fr.map(f => f[0])];
      }
    });
    layers.push({ id: L.attrs.name, vis: L.attrs.visible !== '0', data: toB64(new Uint8Array(arr.buffer)) });
  }
  // xTile convention: objectgroup named like a layer, objects named TileData carry tile properties
  for (const og of kids(map, 'objectgroup')) for (const o of kids(og, 'object')) {
    const p = propsOf(o); if (!Object.keys(p).length) continue;
    const x0 = Math.floor(+o.attrs.x / 16), y0 = Math.floor(+o.attrs.y / 16);
    const w = Math.max(1, Math.round((+o.attrs.width || 16) / 16)), h = Math.max(1, Math.round((+o.attrs.height || 16) / 16));
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) (tp[og.attrs.name] ||= {})[`${x},${y}`] = p;
  }
  return { json: { name, w: W, h: H, props: propsOf(map), sheets, layers, anim, tp }, warnings };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const propXml = (p, ind) => {
  const e = Object.entries(p || {}); if (!e.length) return '';
  return `${ind}<properties>\n${e.map(([k, v]) => `${ind} <property name="${esc(k)}"${typeof v === 'boolean' ? ' type="bool"' : typeof v === 'number' ? (Number.isInteger(v) ? ' type="int"' : ' type="float"') : ''} value="${esc(v)}"/>`).join('\n')}\n${ind}</properties>\n`;
};

// GameMap -> TMX string. Image sources are written as "<basename>.png" (the game resolves them relative to Maps/).
export function mapToTmx(map) {
  const animBy = {};
  for (const [, a] of Object.entries(map.anim)) for (const v of Object.values(a)) animBy[v[1][0]] = v;
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.10" tiledversion="1.10.2" orientation="orthogonal" renderorder="right-down" width="${map.w}" height="${map.h}" tilewidth="16" tileheight="16" infinite="0" nextlayerid="${map.layerOrder.length + 1}" nextobjectid="1">\n`;
  s += propXml(map.props, ' ');
  for (const sh of map.sheets) {
    const base = sh.img.split('/').pop();
    s += ` <tileset firstgid="${sh.first}" name="${esc(sh.id)}" tilewidth="16" tileheight="16" tilecount="${sh.cols * sh.rows}" columns="${sh.cols}">\n  <image source="${esc(base)}.png" width="${sh.cols * 16}" height="${sh.rows * 16}"/>\n`;
    const ids = new Set([...Object.keys(sh.tp).map(Number)]);
    for (const g of Object.keys(animBy)) if (g >= sh.first && g < sh.first + sh.cols * sh.rows) ids.add(g - sh.first);
    for (const id of [...ids].sort((a, b) => a - b)) {
      const a = animBy[id + sh.first];
      s += `  <tile id="${id}">\n${propXml(sh.tp[id], '   ')}${a ? `   <animation>\n${a[1].map(g => `    <frame tileid="${g - sh.first}" duration="${a[0]}"/>`).join('\n')}\n   </animation>\n` : ''}  </tile>\n`;
    }
    s += ` </tileset>\n`;
  }
  let id = 1, oid = 1;
  for (const L of map.layerOrder) {
    const arr = map.layers[L], rows = [];
    for (let y = 0; y < map.h; y++) rows.push(Array.from(arr.subarray(y * map.w, (y + 1) * map.w)).join(','));
    s += ` <layer id="${id++}" name="${esc(L)}" width="${map.w}" height="${map.h}">\n  <data encoding="csv">\n${rows.join(',\n')}\n</data>\n </layer>\n`;
  }
  for (const [L, t] of Object.entries(map.tp)) {
    s += ` <objectgroup id="${id++}" name="${esc(L)}">\n`;
    for (const [xy, p] of Object.entries(t)) {
      const [x, y] = xy.split(',').map(Number);
      s += `  <object id="${oid++}" name="TileData" x="${x * 16}" y="${y * 16}" width="16" height="16">\n${propXml(p, '   ')}  </object>\n`;
    }
    s += ` </objectgroup>\n`;
  }
  return s.replace(/nextobjectid="1"/, `nextobjectid="${oid}"`) + '</map>\n';
}
