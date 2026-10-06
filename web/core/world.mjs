// Warp graph between locations. Works in browser and Node.

// Location name (as used in warps) -> map asset name, where they differ.
export const LOC_ALIAS = {
  CommunityCenter: 'CommunityCenter_Ruins', IslandSouth: 'Island_S', IslandNorth: 'Island_N', IslandWest: 'Island_W',
  IslandEast: 'Island_E', IslandSouthEast: 'Island_SE', IslandHut: 'Island_Hut', IslandShrine: 'Island_Shrine',
  IslandFieldOffice: 'Island_FieldOffice', IslandFarmCave: 'Island_FarmCave', CaptainRoom: 'Island_CaptainRoom',
  IslandSecret: 'Island_Secret', UndergroundMine: 'Mines/1', VolcanoDungeon0: 'Mines/VolcanoTemplate', VolcanoDungeon9: 'Mines/VolcanoTemplate',
  VolcanoEntrance: 'Mines/VolcanoTemplate', Caldera: 'Caldera',
  BeachNightMarket: 'Beach-NightMarket', FarmHouse: 'FarmHouse1', Cabin: 'FarmHouse1', IslandFarmHouse: 'IslandFarmHouse',
  BathHouse_Entry: 'BathHouse_Entry', MovieTheater: 'MovieTheater', DesertFestival: 'Desert-Festival',
};
export const mapOf = (loc, maps) => (maps && maps[loc] ? loc : LOC_ALIAS[loc] || loc);

const num = (s) => parseInt(s, 10);

// Extract warps from a map JSON (props + tile props). Returns [[x,y,target,tx,ty,kind]].
// kind: w=map edge/prop warp, d=door (action warp), t=touch warp
export function mapWarps(j) {
  const out = [];
  const w = (j.props?.Warp || '').trim().split(/\s+/);
  for (let i = 0; i + 4 < w.length; i += 5) out.push([num(w[i]), num(w[i + 1]), w[i + 2], num(w[i + 3]), num(w[i + 4]), 'w']);
  for (const [layer, tiles] of Object.entries(j.tp || {})) {
    for (const [xy, p] of Object.entries(tiles)) {
      const [x, y] = xy.split(',').map(Number);
      const a = (p.Action || '').split(' '), t = (p.TouchAction || '').split(' ');
      if (a[0] === 'Warp' || a[0] === 'LockedDoorWarp') out.push([x, y, a[3], num(a[1]), num(a[2]), 'd']);
      else if (a[0] === 'MagicWarp') out.push([x, y, a[1], num(a[2]), num(a[3]), 'd']);
      else if (a[0] === 'WarpCommunityCenter') out.push([x, y, 'CommunityCenter', 32, 23, 'd']);
      else if (a[0] === 'EnterSewer') out.push([x, y, 'Sewer', 16, 11, 'd']);
      else if (a[0] === 'WarpWomensLocker') out.push([x, y, 'BathHouse_WomensLocker', 15, 16, 'd']);
      else if (a[0] === 'WarpMensLocker') out.push([x, y, 'BathHouse_MensLocker', 15, 16, 'd']);
      else if (a[0] === 'Mine' && j.name === 'Mine') out.push([x, y, 'UndergroundMine', 0, 0, 'd']);
      else if (a[0] === 'WarpBoatTunnel') out.push([x, y, 'BoatTunnel', 6, 11, 'd']);
      else if (a[0] === 'Warp_Sunroom_Door') out.push([x, y, 'Sunroom', 5, 13, 'd']);
      else if (a[0] === 'WizardHatch') out.push([x, y, 'WizardHouseBasement', 4, 4, 'd']);
      else if (a[0] === 'Theater_Entrance') out.push([x, y, 'MovieTheater', 13, 15, 'd']);
      if (t[0] === 'Warp' && t.length >= 4) out.push([x, y, t[1], num(t[2]), num(t[3]), 't']);
      else if (t[0] === 'MagicWarp' && t.length >= 4) out.push([x, y, t[1], num(t[2]), num(t[3]), 't']);
    }
  }
  return out;
}

// festival / patch / alternative versions of a base map (Beach-Luau, Mountain_Shortcuts, Farm_Combat...)
export function isVariant(name, maps) {
  const m = /^([A-Za-z]+)[-_]/.exec(name);
  return !!(m && maps[m[1]] && m[1] !== name);
}

// BFS over the warp graph: returns list of hops [{from, x, y, to, tx, ty}] or null
export function route(index, from, to) {
  const maps = index.maps;
  const start = mapOf(from, maps), goal = mapOf(to, maps);
  const prev = { [start]: null }, q = [start];
  while (q.length) {
    const m = q.shift();
    if (m === goal) break;
    for (const [x, y, t, tx, ty] of maps[m]?.warps || []) {
      const n = mapOf(t, maps);
      if (!maps[n] || n in prev || (n !== goal && isVariant(n, maps))) continue;
      prev[n] = { from: m, x, y, to: n, tx, ty };
      q.push(n);
    }
  }
  if (!(goal in prev)) return null;
  const hops = [];
  for (let c = goal; prev[c]; c = prev[c].from) hops.unshift(prev[c]);
  return hops;
}

// Who links into this map? [[fromMap,x,y,tx,ty]]
export function incoming(index, name, { variants = false } = {}) {
  const res = [], seen = new Set();
  for (const [m, info] of Object.entries(index.maps)) {
    if (!variants && m !== name && isVariant(m, index.maps)) continue;
    for (const [x, y, t, tx, ty] of info.warps) {
      if (mapOf(t, index.maps) !== name) continue;
      const k = `${m}>${tx},${ty}`; if (seen.has(k)) continue; seen.add(k);
      res.push([m, x, y, tx, ty]);
    }
  }
  return res;
}
