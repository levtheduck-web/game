#!/usr/bin/env node
// Spaceship co-op server — players share a single world, server owns the simulation.
//
//   npm install ws
//   node spaceship-server.js
//
// Players connect via ws://<host>:8098/ — see spaceship-mp.html for the client.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

function getLocalIPs() {
  const ips = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

const PORT = 8098;
const TICK_HZ = 60;
const NET_HZ = 30;  // broadcast snapshots 30× per second so client can extrapolate smoothly

// ── World state ──────────────────────────────────────────────────────
const players = new Map();        // id -> player
const enemies = [];
const bullets = [];
let nextPlayerId = 1;
let nextEntityId = 1;
let spawnTimer = 3;
let sector = 1;
let totalKills = 0;

const loot = [];
let asteroids = [];
let boss = null;
let bossKillCounter = 0;

// ── Hierarchy: UNIVERSES → galaxies → milkyWays → (sun + orbiting planets) ──
const _S = (name, r, color, hot, type, pullRange) =>
  ({ name, x: 0, y: 0, r, color, hot, type: type || 'sun', pullRange: pullRange || 0 });
const _P = (name, orbitRadius, orbitAngle, orbitSpeed, r, color, upgrade, upgradeName, upgradeDesc) =>
  ({ name, orbitRadius, orbitAngle, orbitSpeed, r, color, x: 0, y: 0, upgrade, upgradeName, upgradeDesc });
// Map of upgrade key → modifier function that mutates a player's stats
const UPGRADES = {
  hull:      { name: 'Heat-Resistant Plating', desc: '+25 max HULL', apply: p => { p.maxHp += 25; p.hp = p.maxHp; } },
  warpCap:   { name: 'Warp Capacitor',         desc: '+150 max warp + refill', apply: p => { p.maxWarpCharge += 150; p.warpCharge = p.maxWarpCharge; } },
  shields:   { name: 'Reinforced Shield Array',desc: '+50 max SHIELD',         apply: p => { p.maxShield += 50; p.shield = p.maxShield; p.shieldRegen = (p.shieldRegen || 14) + 6; } },
  fireRate:  { name: 'Plasma Cannon Retrofit', desc: '+50% fire rate',         apply: p => { p.fireRateMul = (p.fireRateMul || 1) * 1.5; } },
  damage:    { name: 'Military Munitions',     desc: '+50% damage',            apply: p => { p.dmgMul = (p.dmgMul || 1) * 1.5; } },
  warpSpeed: { name: 'Crystal-Tuned Warp',     desc: '+50% warp speed/regen',  apply: p => { p.warpSpeedMul = (p.warpSpeedMul || 1) * 1.5; p.warpRegenMul = (p.warpRegenMul || 1) * 1.5; } },
};

const BOSS_EVERY = 15;
const MAX_ENEMIES = 20;   // single source of truth for the live-enemy cap
const CLASSES = {
  fighter: { maxHp: 50,  maxShield: 60,  fireRateMul: 1.6,  speedMul: 1.3,  warpSpeedMul: 1.2, shieldRegen: 10, dmgMul: 1.2, maxWarpCharge: 600 },
  tank:    { maxHp: 220, maxShield: 130, fireRateMul: 0.65, speedMul: 0.72, warpSpeedMul: 0.8, shieldRegen: 20, dmgMul: 0.9, maxWarpCharge: 300 },
  support: { maxHp: 110, maxShield: 110, fireRateMul: 0.85, speedMul: 1.05, warpSpeedMul: 1.0, shieldRegen: 25, dmgMul: 0.8, maxWarpCharge: 300 },
  gunship: { maxHp: 120, maxShield: 80,  fireRateMul: 1.0,  speedMul: 1.0,  warpSpeedMul: 1.0, shieldRegen: 14, dmgMul: 1.0, maxWarpCharge: 300 },
};

// Active ability per class — triggered with F (one-shot, cooldown-gated). See fireAbility().
const ABILITIES = {
  fighter: { name: 'Blink',        cool: 6  },   // teleport forward + brief i-frames
  gunship: { name: 'Barrage',      cool: 7  },   // 360° bullet burst
  tank:    { name: 'Shockwave',    cool: 11 },   // AoE damage + knockback + damage-resist window
  support: { name: 'Repair Pulse', cool: 9  },   // heal + refill shield for self & nearby allies
};

const LOOT_TYPES = ['hp', 'shield', 'ammo', 'speed', 'warp'];

const UNIVERSES = [
  { name: 'Local Universe', galaxies: [
    { name: 'Andromeda Cluster', milkyWays: [
      { name: 'Andromeda Reach', sun: _S('Andromeda Sun', 400, '#ffd54d', '#ffeb88'), planets: [
        _P('Helios Prime', 8000, 0.2, 0.025, 90, '#ffb86b', 'hull', UPGRADES.hull.name, UPGRADES.hull.desc),
        _P('Vega Station', 14000, 1.8, 0.018, 70, '#7c5cff', 'warpCap', UPGRADES.warpCap.name, UPGRADES.warpCap.desc),
        _P('Nereus', 21000, 3.4, 0.013, 100, '#00d4a0', 'shields', UPGRADES.shields.name, UPGRADES.shields.desc),
        _P('Krylo', 28000, 5.0, 0.009, 110, '#ff6b6b', 'fireRate', UPGRADES.fireRate.name, UPGRADES.fireRate.desc),
      ]},
      { name: 'Frontier Belt', sun: _S('Frontier Sun', 280, '#a8d8ff', '#ddedff'), planets: [
        _P('Bastion', 7500, 0.5, 0.027, 80, '#8b97c4', 'damage', UPGRADES.damage.name, UPGRADES.damage.desc),
        _P('Vellam', 13500, 2.0, 0.018, 95, '#c47cff', 'warpSpeed', UPGRADES.warpSpeed.name, UPGRADES.warpSpeed.desc),
        _P('Calix', 20500, 3.7, 0.013, 90, '#ffd56b', 'hull', UPGRADES.hull.name, UPGRADES.hull.desc),
        _P('Pyranthe', 27500, 5.4, 0.010, 110, '#ff5b5b', 'damage', UPGRADES.damage.name, UPGRADES.damage.desc),
      ]},
    ]},
    { name: 'Sirius Cluster', milkyWays: [
      { name: 'Calix System', sun: _S('Calix Sun', 320, '#ffd56b', '#ffe9aa'), planets: [
        _P('Calix Outpost', 9000, 0.4, 0.024, 90, '#ffd56b'),
        _P('Pyranthe', 15500, 1.9, 0.018, 110, '#ff5b5b'),
        _P('Orisa-7-Calix', 22500, 3.6, 0.013, 80, '#5cd6ff'),
        _P('Mirror Loop', 29500, 5.4, 0.009, 95, '#e6edf3'),
      ]},
      { name: 'Mirror Drift', sun: _S('Mirror Sun', 360, '#a0ff7c', '#d6ffaa'), planets: [
        _P('Helga\'s Drift', 8500, 0.3, 0.026, 100, '#a0ff7c'),
        _P('Mirrorhaven', 15000, 2.0, 0.017, 95, '#e6edf3'),
        _P('Glimmer', 22000, 3.7, 0.013, 75, '#cccccc'),
        _P('Spar', 29000, 5.4, 0.009, 90, '#ffaaee'),
      ]},
    ]},
    { name: 'Pegasus Spur', milkyWays: [
      { name: 'Pegasus Hub', sun: _S('Pegasi Sun', 500, '#ff8b5b', '#ffb088'), planets: [
        _P('Orisa-7', 9000, 0.7, 0.024, 80, '#5cd6ff'),
        _P('Helga\'s Drift', 16000, 2.3, 0.017, 100, '#a0ff7c'),
        _P('Mirrorhaven', 23000, 4.1, 0.012, 95, '#e6edf3'),
        _P('Tarsis', 30000, 5.8, 0.009, 85, '#ff9bd6'),
      ]},
      { name: 'Lyra Drift', sun: _S('Lyra Sun', 350, '#6ba8ff', '#aacfff'), planets: [
        _P('Orion\'s Anvil', 8000, 0.4, 0.026, 95, '#ffaa44'),
        _P('Vega\'s Crown', 15000, 2.0, 0.018, 100, '#5cffd6'),
        _P('Magnetic Hub', 22000, 3.6, 0.013, 80, '#ffd956'),
        _P('Polaris', 29000, 5.3, 0.009, 75, '#dddddd'),
      ]},
    ]},
  ]},
  { name: 'Outer Universe', galaxies: [
    { name: 'Void Reaches', milkyWays: [
      { name: 'Aphelion Edge', sun: _S('Void Sun', 700, '#7c5cff', '#c47cff'), planets: [
        _P('Aphelion', 10000, 0.3, 0.022, 70, '#c47cff'),
        _P('Null Station', 17000, 2.0, 0.016, 60, '#7c5cff'),
        _P('Last Light', 24000, 3.7, 0.012, 130, '#ffb86b'),
        _P('Echoes', 31000, 5.4, 0.009, 85, '#aabbff'),
      ]},
    ]},
    { name: 'Phoenix Arm', milkyWays: [
      { name: 'Phoenix Drift', sun: _S('Phoenix Sun', 500, '#ff6b1a', '#ffaa44'), planets: [
        _P('Embertail', 9000, 0.6, 0.024, 90, '#ff6b1a'),
        _P('Lupus', 16000, 2.2, 0.017, 100, '#aa4ad6'),
        _P('Pyre', 23000, 3.9, 0.012, 75, '#ff447a'),
        _P('Flarewatch', 30000, 5.5, 0.009, 95, '#ffcc44'),
      ]},
    ]},
    { name: 'Hydra Sweep', milkyWays: [
      { name: 'Hydra Veil', sun: _S('Hydra Sun', 380, '#3cf08a', '#88ffba'), planets: [
        _P('Snake Reef', 8500, 0.5, 0.025, 110, '#3cf08a'),
        _P('Hydra\'s Eye', 15500, 2.1, 0.017, 95, '#ffcc44'),
        _P('Coilstead', 22500, 3.8, 0.012, 75, '#7ca0ff'),
        _P('Serpent\'s Eye', 29500, 5.5, 0.009, 100, '#aaffaa'),
      ]},
      { name: 'Crescent Arc', sun: _S('Crescent Sun', 250, '#bbe6ff', '#ddf0ff'), planets: [
        _P('Moonshade', 7500, 0.4, 0.026, 85, '#aabbcc'),
        _P('Frostfall', 14500, 2.0, 0.018, 95, '#aaeeff'),
        _P('Tideglass', 21500, 3.6, 0.013, 110, '#88ddee'),
        _P('Arcwell', 28500, 5.3, 0.010, 85, '#ddddff'),
      ]},
    ]},
  ]},
  { name: 'Deep Universe', galaxies: [
    { name: 'Cygnus Spiral', milkyWays: [
      { name: 'Cygnus Heart', sun: _S('Cygnus Sun', 800, '#5cd6ff', '#aaeeff'), planets: [
        _P('Centerstone', 11000, 0.3, 0.020, 130, '#5cd6ff'),
        _P('Black Hub', 18000, 2.0, 0.015, 70, '#7c5cff'),
        _P('Singularity', 25000, 3.7, 0.011, 90, '#ff447a'),
        _P('Twilight', 32000, 5.4, 0.008, 100, '#c47cff'),
      ]},
      { name: 'Far Reach', sun: _S('Reach Sun', 350, '#ff6b6b', '#ff9988'), planets: [
        _P('Whisper', 9000, 0.5, 0.024, 85, '#aaffff'),
        _P('Outpost-99', 16000, 2.1, 0.017, 95, '#ff447a'),
        _P('Vortex', 23000, 3.8, 0.012, 105, '#7ca0ff'),
        _P('Nightfall', 30000, 5.5, 0.009, 95, '#444466'),
      ]},
    ]},
    { name: 'Cassiopeia Drift', milkyWays: [
      { name: 'Cassiopeia Pearl', sun: _S('Cassiopeia Sun', 550, '#ff88cc', '#ffaadd'), planets: [
        _P('The Pearl', 9500, 0.4, 0.024, 110, '#ffd6f0'),
        _P('Riftrim', 16500, 2.0, 0.017, 105, '#d6ffaa'),
        _P('Lighthouse', 23500, 3.7, 0.012, 75, '#ffeeaa'),
        _P('Crown Drift', 30500, 5.4, 0.009, 100, '#ffaadd'),
      ]},
      { name: 'Endrim', sun: _S('Endrim Star', 1000, '#ffffff', '#ffffff'), planets: [
        _P('Endsong', 12000, 0.5, 0.019, 140, '#ffffff'),
        _P('Ashveil', 19000, 2.1, 0.014, 95, '#aaaaaa'),
        _P('Lastpoint', 26000, 3.7, 0.011, 85, '#7c5cff'),
        _P('Trueblood', 33000, 5.3, 0.008, 100, '#ff447a'),
      ]},
    ]},
  ]},
  { name: 'The Omniverse', galaxies: [
    { name: 'Chaos Spiral', milkyWays: [
      { name: 'Void Heart', sun: _S('Void Sphere', 500, '#000000', '#7c5cff', 'blackhole', 2500), planets: [
        _P('Endpoint', 9000, 0.3, 0.026, 90, '#7c5cff'),
        _P('Final', 16000, 1.9, 0.018, 100, '#ff447a'),
        _P('Maw', 23000, 3.6, 0.013, 85, '#ff6b1a'),
        _P('Ash', 30000, 5.3, 0.009, 105, '#aaaaaa'),
      ]},
      { name: 'Annihilation Arc', sun: _S('Annihilator', 700, '#000000', '#ff6b1a', 'blackhole', 3000), planets: [
        _P('Rest', 10000, 0.4, 0.024, 95, '#ffd6f0'),
        _P('Quiet', 17000, 2.0, 0.017, 80, '#aaffff'),
        _P('Truth', 24000, 3.7, 0.012, 100, '#5cffd6'),
        _P('Beginning', 31000, 5.4, 0.009, 120, '#ffffff'),
      ]},
    ]},
  ]},
];
const OMNIVERSE_INDEX = UNIVERSES.length - 1;
const NORMAL_UNIVERSES = UNIVERSES.length - 1;

// ◈ The Singularity ◈ — a hidden pocket dimension reachable ONLY by surviving a
// black hole down to 1 HP. A calm, enemy-free reward zone with its own exotic
// sun and four upgrade planets. Not part of the normal hyperjump cycle.
const SINGULARITY_MW = {
  name: 'The Singularity',
  sun: _S('Singularity Core', 360, '#c9a8ff', '#ece0ff', 'sun', 0),
  planets: [
    _P('Eventide',   8000,  0.5, 0.020,  95, '#b388ff', 'shields',  UPGRADES.shields.name,  UPGRADES.shields.desc),
    _P('Paradox',    12000, 2.2, 0.016, 110, '#e0c8ff', 'warpCap',  UPGRADES.warpCap.name,  UPGRADES.warpCap.desc),
    _P('Hollow',     16000, 3.8, 0.013,  90, '#9a7cff', 'fireRate', UPGRADES.fireRate.name, UPGRADES.fireRate.desc),
    _P('Zero Point', 21000, 5.1, 0.011, 130, '#ffffff', 'damage',   UPGRADES.damage.name,   UPGRADES.damage.desc),
  ],
};

let currentUniverse = 0, currentGalaxy = 0, currentMilkyWay = 0;
let inSingularity = false;
let pendingSingularity = false;
function curMW() {
  if (inSingularity) return SINGULARITY_MW;
  return UNIVERSES[currentUniverse].galaxies[currentGalaxy].milkyWays[currentMilkyWay];
}
function locationLabel() {
  if (inSingularity) return '◈ The Singularity — Pocket Void ◈';
  const u = UNIVERSES[currentUniverse], g = u.galaxies[currentGalaxy], m = g.milkyWays[currentMilkyWay];
  return `🌌 ${m.name} — ${g.name}`;
}

let planetsState = [];
const UPGRADE_KEYS = Object.keys(UPGRADES);
const ROGUE_NAMES = ['Wanderer', 'Nomad', 'Drifter', 'Outcast', 'Exile', 'Vagrant', 'Stray', 'Forsaken', 'Errant', 'Pariah'];
function loadCurrentMilkyWay() {
  planetsState = curMW().planets.map(p => ({ ...p }));
  const sun = curMW().sun;
  planetsState.forEach((p, i) => {
    p.x = sun.x + Math.cos(p.orbitAngle) * p.orbitRadius;
    p.y = sun.y + Math.sin(p.orbitAngle) * p.orbitRadius;
    // Every planet should be dockable. Most milky ways ship no hand-authored
    // upgrades, which made other universes dead ends — you couldn't interact with
    // anything. Assign a deterministic upgrade (by planet name) to any planet that
    // lacks one so all 64 planets across every universe are interactable.
    if (!p.upgrade) {
      let h = i;
      for (let k = 0; k < p.name.length; k++) h = (h * 31 + p.name.charCodeAt(k)) >>> 0;
      const key = UPGRADE_KEYS[h % UPGRADE_KEYS.length];
      p.upgrade = key;
      p.upgradeName = UPGRADES[key].name;
      p.upgradeDesc = UPGRADES[key].desc;
    }
  });
  // Rogue planets — 2 per milky way that orbit nothing: fixed, motionless points in
  // deep space (no orbit ring). Deterministic per region so they're stable across visits.
  let seed = (currentUniverse * 7919 + currentGalaxy * 131 + currentMilkyWay * 17 + 1) >>> 0;
  for (const ch of sun.name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  for (let r = 0; r < 2; r++) {
    const h = (seed + r * 104729) >>> 0;
    const ang = (h % 3600) * Math.PI / 1800;
    const dist = 22000 + (h % 13000);                         // deep-space, still reachable
    const key = UPGRADE_KEYS[(h >>> 5) % UPGRADE_KEYS.length];
    planetsState.push({
      name: ROGUE_NAMES[(h >>> 3) % ROGUE_NAMES.length] + (r ? ' II' : ' I'),
      rogue: true,
      x: sun.x + Math.cos(ang) * dist, y: sun.y + Math.sin(ang) * dist,
      orbitRadius: 0, orbitAngle: ang, orbitSpeed: 0,
      r: 70 + (h % 50), color: '#5a6072',                     // cold, unlit grey-blue
      upgrade: key, upgradeName: UPGRADES[key].name, upgradeDesc: UPGRADES[key].desc,
    });
  }
  asteroids = generateAsteroids();
}

function generateAsteroids() {
  const list = [];
  // Fix 35: reduced count for performance; fix 36: min dist clears sun radius + pullRange
  const sun = curMW().sun;
  const sunClear = Math.max(sun.r, sun.pullRange || 0) + 1800;
  const count = 15 + Math.floor(Math.random() * 11);
  for (let i = 0; i < count; i++) {
    const r = 22 + Math.random() * 58;
    const angle = Math.random() * Math.PI * 2;
    const dist = sunClear + Math.random() * 26000;
    list.push({
      id: nextEntityId++,
      x: Math.cos(angle) * dist, y: Math.sin(angle) * dist,
      vx: (Math.random() - 0.5) * 22, vy: (Math.random() - 0.5) * 22,
      r, hp: Math.round(r * 2.5), maxHp: Math.round(r * 2.5),
      seed: Math.floor(Math.random() * 100000),
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.4,
    });
  }
  return list;
}

function updatePlanetOrbits(dt) {
  const sun = curMW().sun;
  for (const p of planetsState) {
    if (p.rogue) continue;   // rogue planets orbit nothing — fixed in space
    p.orbitAngle += p.orbitSpeed * dt;
    p.x = sun.x + Math.cos(p.orbitAngle) * p.orbitRadius;
    p.y = sun.y + Math.sin(p.orbitAngle) * p.orbitRadius;
  }
}

// Procedurally generated anomalies (BH, wormholes, nebulas). Static — generated once.
function generateAnomalies() {
  let seed = Math.floor(Math.random() * 1e9);
  const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const list = [];
  const placeAway = (range) => {
    for (let t = 0; t < 16; t++) {
      const x = (rng() - 0.5) * range, y = (rng() - 0.5) * range;
      if (Math.hypot(x, y) > 2000) return [x, y];
    }
    return [(rng() - 0.5) * range, (rng() - 0.5) * range];
  };
  // 2-3 black holes
  const bhCount = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < bhCount; i++) {
    const [x, y] = placeAway(60000);
    list.push({ id: nextEntityId++, type: 'blackhole', x, y, r: 80 + rng() * 80, pullRange: 1400 + rng() * 600 });
  }
  // 1-2 wormhole pairs
  const whPairs = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < whPairs; i++) {
    const [x1, y1] = placeAway(50000);
    const [x2, y2] = placeAway(50000);
    list.push({ id: nextEntityId++, type: 'wormhole', x: x1, y: y1, r: 40, destX: x2, destY: y2 });
    list.push({ id: nextEntityId++, type: 'wormhole', x: x2, y: y2, r: 40, destX: x1, destY: y1 });
  }
  // 1-2 nebulas
  const nebulaColors = ['#5cd6ff', '#c47cff', '#ff5b5b', '#3cf08a', '#ffd66b'];
  const neb = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < neb; i++) {
    list.push({
      id: nextEntityId++, type: 'nebula',
      x: (rng() - 0.5) * 60000, y: (rng() - 0.5) * 60000,
      r: 1500 + rng() * 1200,
      color: nebulaColors[Math.floor(rng() * nebulaColors.length)],
    });
  }
  return list;
}
let anomalies = generateAnomalies();
loadCurrentMilkyWay();

let hyperjumping = null;       // null OR { tier, age, maxAge }

// ── Black-hole mergers ──────────────────────────────────────────────────
// Two black holes spawn, spiral together, and slam into one bigger hole that
// fires a gravitational shockwave (push + damage). Random in normal galaxies;
// every ~10s in the Omniverse. The pocket Singularity stays calm (none there).
let mergeEvent = null;          // null OR { a, b, cx, cy, baseAng, sep, age, maxAge }
let mergeTimer = 14;            // seconds until the next merger
let mergeHoles = [];            // persistent black holes left behind by mergers (capped)
const MAX_MERGE_HOLES = 4;
function scheduleNextMerge() {
  mergeTimer = (currentUniverse === OMNIVERSE_INDEX && !inSingularity) ? 10 : rand(28, 65);
}
function removeAnoms(list) {
  for (const x of list) { const i = anomalies.indexOf(x); if (i >= 0) anomalies.splice(i, 1); }
}
function startMerge() {
  const alive = [...players.values()].filter(p => p.alive);
  let cx = 0, cy = 0;
  if (alive.length) {
    // Form NEAR a player, not on top of them, so they can see it and dodge.
    const t = alive[Math.floor(Math.random() * alive.length)];
    const oa = Math.random() * Math.PI * 2;
    cx = t.x + Math.cos(oa) * 2800; cy = t.y + Math.sin(oa) * 2800;
  }
  // Nudge the center off the sun so the holes don't spawn inside the star.
  const sun = curMW().sun;
  const dsun = Math.hypot(cx - sun.x, cy - sun.y);
  if (dsun < (sun.pullRange || sun.r || 0) + 2500) { const a = Math.random() * Math.PI * 2; cx = sun.x + Math.cos(a) * 4000; cy = sun.y + Math.sin(a) * 4000; }
  const sep = 1700, baseAng = Math.random() * Math.PI * 2;
  const mk = (sign) => ({ id: nextEntityId++, type: 'blackhole', merge: true,
    x: cx + Math.cos(baseAng) * sep * sign, y: cy + Math.sin(baseAng) * sep * sign, r: 170, pullRange: 1000, color: '#7c5cff' });
  const a = mk(1), b = mk(-1);
  anomalies.push(a, b);
  mergeEvent = { a, b, cx, cy, baseAng, sep, age: 0, maxAge: 3.4, merged: null, mergedLife: 0 };
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'merge_start' }));
}
function mergeShockwave(cx, cy, R) {
  for (const p of players.values()) {
    if (!p.alive) continue;
    const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1;
    if (d < R) {
      const k = 1 - d / R;
      p.vx += (dx / d) * 6500 * k; p.vy += (dy / d) * 6500 * k;   // hurled outward
      if (p.invuln <= 0) {
        let dmg = 42 * k; if (p.abilityActive > 0) dmg *= 0.4;
        if (p.shield > 0) { const ab = Math.min(p.shield, dmg); p.shield -= ab; dmg -= ab; }
        p.hp -= dmg;
        if (p.hp <= 0 && p.alive) { p.alive = false; p.respawnTimer = 4; p.warpActive = false; }
      }
    }
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i], dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy) || 1;
    if (d < R) { const k = 1 - d / R; e.vx += (dx / d) * 5500 * k; e.vy += (dy / d) * 5500 * k; e.hp -= 80 * k; if (e.hp <= 0) enemies.splice(i, 1); }
  }
  if (boss) { const d = Math.hypot(boss.x - cx, boss.y - cy); if (d < R) boss.hp -= 130 * (1 - d / R); }
  for (let i = bullets.length - 1; i >= 0; i--) { const b = bullets[i]; if ((b.x - cx) ** 2 + (b.y - cy) ** 2 < R * R * 0.55) bullets.splice(i, 1); }
}
function updateMerge(dt) {
  if (inSingularity) { if (mergeEvent) { removeAnoms([mergeEvent.a, mergeEvent.b]); mergeEvent = null; } return; }
  if (!mergeEvent) {
    mergeTimer -= dt;
    if (mergeTimer <= 0 && players.size > 0) { startMerge(); scheduleNextMerge(); }
    return;
  }
  const e = mergeEvent;
  e.age += dt;
  const t = Math.min(1, e.age / e.maxAge);
  const rad = e.sep * (1 - t * t);                 // ease inward
  const ang = e.baseAng + t * Math.PI * 3.5;       // ~1.75 rotations
  e.a.x = e.cx + Math.cos(ang) * rad;       e.a.y = e.cy + Math.sin(ang) * rad;
  e.b.x = e.cx + Math.cos(ang + Math.PI) * rad; e.b.y = e.cy + Math.sin(ang + Math.PI) * rad;
  if (t >= 1) {
    // The two holes fuse into one bigger black hole that STAYS (a lasting hazard).
    removeAnoms([e.a, e.b]);
    const merged = { id: nextEntityId++, type: 'blackhole', merge: true, x: e.cx, y: e.cy, r: 300, pullRange: 1600, color: '#b06bff' };
    anomalies.push(merged);
    mergeHoles.push(merged);
    // Cap how many persistent merge-holes can pile up (the omniverse merges every 10s).
    while (mergeHoles.length > MAX_MERGE_HOLES) { removeAnoms([mergeHoles.shift()]); }
    mergeShockwave(e.cx, e.cy, 2000);
    for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'merge', x: Math.round(e.cx), y: Math.round(e.cy) }));
    mergeEvent = null;   // event over — the merged hole persists in `anomalies`
  }
}

function triggerHyperjump(tier) {
  if (hyperjumping) return;
  hyperjumping = { tier, age: 0, maxAge: 0.8 + tier * 0.35 };
  // End any active warps; clients see the flash
  for (const p of players.values()) {
    p.warpActive = false;
    p.warpHoldTime = 0;
    // Clear the rising-edge latches so a player still holding Shift/F across the
    // jump can warp/use abilities again without releasing the key first.
    p.shiftWasDown = false;
    p.abilityWasDown = false;
  }
}

function doHyperjump(tier) {
  inSingularity = false;   // warping always returns you to normal space
  if (tier === 3) {
    // Bug 29 fix: tier-3 toggled to Omniverse OR back — was a one-way trap
    currentUniverse = (currentUniverse === OMNIVERSE_INDEX) ? 0 : OMNIVERSE_INDEX;
    currentGalaxy = 0; currentMilkyWay = 0;
  } else if (tier === 2) {
    // Bug 30 fix: removed dead code check — modulo NORMAL_UNIVERSES can never equal OMNIVERSE_INDEX
    currentUniverse = (currentUniverse + 1) % NORMAL_UNIVERSES;
    currentGalaxy = 0; currentMilkyWay = 0;
  } else if (tier === 1) {
    const gs = UNIVERSES[currentUniverse].galaxies;
    currentGalaxy = (currentGalaxy + 1) % gs.length;
    currentMilkyWay = 0;
  } else {
    const ms = UNIVERSES[currentUniverse].galaxies[currentGalaxy].milkyWays;
    currentMilkyWay = (currentMilkyWay + 1) % ms.length;
  }
  loadCurrentMilkyWay();
  anomalies = generateAnomalies();
  mergeEvent = null; mergeHoles = []; scheduleNextMerge();   // fresh region — drop mergers
  enemies.length = 0;
  bullets.length = 0;
  loot.length = 0;
  boss = null;
  bossKillCounter = 0;
  sector = 1;
  totalKills = 0;
  spawnTimer = 3;
  // Reset all players to a safe ring around the new sun, fully revived
  const sun = curMW().sun;
  const safe = Math.max(sun.r, sun.pullRange || 0) + 1500;
  let i = 0;
  for (const p of players.values()) {
    const ang = (i++ * 1.2);
    p.x = sun.x + Math.cos(ang) * safe;
    p.y = sun.y + Math.sin(ang) * safe;
    p.a = ang + Math.PI;
    p.vx = 0; p.vy = 0;
    p.warpCharge = p.maxWarpCharge;
    p.warpActive = false;
    p.warpHoldTime = 0;
    p.shiftWasDown = false;
    p.fireCool = 0;
    p.wormholeCool = 0;
    p.hp = p.maxHp; p.shield = p.maxShield;
    p.alive = true;          // revive anyone who was respawning
    p.respawnTimer = 0;
    // Reset upgrades + base stats fully (each region is its own progression)
    p.upgradesTaken.clear();
    p.buffs = [];
    const cls = CLASSES[p.shipClass] || CLASSES.gunship;
    p.fireRateMul = cls.fireRateMul; p.dmgMul = cls.dmgMul;
    p.warpSpeedMul = cls.warpSpeedMul; p.warpRegenMul = 1;
    p.shieldRegen = cls.shieldRegen; p.speedMul = cls.speedMul;
    p.maxHp = cls.maxHp; p.hp = cls.maxHp;
    p.maxShield = cls.maxShield; p.shield = cls.maxShield;
    p.maxWarpCharge = cls.maxWarpCharge || 300; p.warpCharge = p.maxWarpCharge;
    p.abilityMaxCool = (ABILITIES[p.shipClass] || ABILITIES.gunship).cool;
    p.abilityCool = 0; p.invuln = 0; p.abilityActive = 0; p.abilityFlash = 0; p.abilityWasDown = false;
    // Re-apply permanent Singularity upgrades — they survive the per-region reset
    // (one-time-ever reward), so they persist after you warp back to normal space.
    for (const name of p.singularityTaken) {
      const sp = SINGULARITY_MW.planets.find(pl => pl.name === name);
      if (sp && UPGRADES[sp.upgrade]) UPGRADES[sp.upgrade].apply(p);
    }
    p.aimAngle = null;
  }
}

function rand(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function addPlayer(ws) {
  const id = nextPlayerId++;
  const p = {
    id, ws,
    name: `Pilot ${id}`,
    // Real spawn position is computed in the welcome handler based on the current sun
    x: 0, y: 0,
    vx: 0, vy: 0,
    a: 0,
    hp: 120, maxHp: 120,
    shield: 80, maxShield: 80,
    fireCool: 0,
    kills: 0,
    color: ['#7c5cff', '#ff6b6b', '#00d4a0', '#ffb86b'][(id - 1) % 4],
    keys: {},
    turretAngle: null,       // cursor-controlled turret aim (null = fire toward ship facing)
    alive: true,
    respawnTimer: 0,
    // Warp
    warpActive: false,
    warpCharge: 300, maxWarpCharge: 300,
    warpJustEngaged: false,
    shiftWasDown: false,
    wormholeCool: 0,
    warpHoldTime: 0,  // Bug 25 fix: was undefined — caused (undefined||0)+dt on first warp
    voice: false,
    shipClass: 'gunship',
    speedMul: 1,
    buffs: [],
    // Per-player upgrade modifiers (default neutral)
    fireRateMul: 1, dmgMul: 1, warpSpeedMul: 1, warpRegenMul: 1, shieldRegen: 14,
    upgradesTaken: new Set(),
    // Singularity upgrades are permanent & one-time-ever — never cleared on hyperjump,
    // so you can't farm them by bouncing in and out of the pocket dimension.
    singularityTaken: new Set(),
    // Active ability state
    abilityCool: 0, abilityMaxCool: 7, abilityWasDown: false,
    invuln: 0, abilityActive: 0, abilityFlash: 0, abilityKind: null,
    // Which hyperjump scopes this pilot has enabled: 0=milky way,1=galaxy,2=universe,3=omniverse.
    travelTiers: { 0: true, 1: true, 2: true, 3: true },
  };
  players.set(id, p);
  return p;
}

function removePlayer(id) {
  players.delete(id);
  // Bug 32 fix: remove orphaned friendly bullets from disconnected player so they don't
  // float and credit kills to a missing player object
  for (let i = bullets.length - 1; i >= 0; i--) {
    if (bullets[i].friendly && bullets[i].ownerId === id) bullets.splice(i, 1);
  }
}

function spawnEnemy() {
  const alive = [...players.values()].filter(p => p.alive);
  if (alive.length === 0) return;
  const target = alive[Math.floor(Math.random() * alive.length)];
  const angle = rand(0, Math.PI * 2);
  // Bug 26 fix: enemies could spawn inside the sun — enforce minimum clearance
  const sun = curMW().sun;
  const sunClear = Math.max(sun.r, sun.pullRange || 0) + 500;
  const d = Math.max(700 + rand(0, 400), sunClear);
  const r = Math.random();
  let kind;
  // Tougher kinds unlock as the sector climbs so early game stays gentle.
  if      (sector >= 4 && r < 0.12) kind = 'kamikaze';
  else if (sector >= 5 && r < 0.22) kind = 'sniper';
  else if (sector >= 3 && r < 0.34) kind = 'swarm';
  else if (r < 0.55) kind = 'scout';
  else if (r < 0.85) kind = 'gunship';
  else kind = 'heavy';
  const baseHp = 30 + sector * 6;
  const profile = {
    scout:    { hp: baseHp * 0.5, speed: 110 + sector * 10, fireDelay: [0.5, 1.2], bulletSp: 480, size: 0.7,  dmg: 8 },
    gunship:  { hp: baseHp,        speed: 60  + sector * 8,  fireDelay: [1.2, 2.6], bulletSp: 420, size: 1.0,  dmg: 8 },
    heavy:    { hp: baseHp * 2.2,  speed: 35  + sector * 4,  fireDelay: [2.0, 3.4], bulletSp: 360, size: 1.5,  dmg: 12 },
    kamikaze: { hp: baseHp * 0.7,  speed: 210 + sector * 12, fireDelay: [99, 99],   bulletSp: 0,   size: 0.75, dmg: 0,  ram: true },
    sniper:   { hp: baseHp * 0.8,  speed: 80  + sector * 5,  fireDelay: [1.8, 2.8], bulletSp: 950, size: 0.95, dmg: 20, range: 1300, keepDist: 850 },
    swarm:    { hp: baseHp * 0.3,  speed: 170 + sector * 10, fireDelay: [0.8, 1.6], bulletSp: 460, size: 0.5,  dmg: 6 },
  }[kind];
  // Swarm arrives as a small pack; everything else is a single ship.
  const count = kind === 'swarm' ? 4 : 1;
  for (let s = 0; s < count; s++) {
    if (enemies.length >= MAX_ENEMIES) break;
    const offD = s === 0 ? 0 : rand(-180, 180);
    const offA = s === 0 ? 0 : rand(-0.4, 0.4);
    enemies.push({
      id: nextEntityId++,
      x: target.x + Math.cos(angle + offA) * (d + offD),
      y: target.y + Math.sin(angle + offA) * (d + offD),
      vx: 0, vy: 0, a: 0,
      kind,
      hp: profile.hp, maxHp: profile.hp,
      fireCool: rand(profile.fireDelay[0], profile.fireDelay[1]),
      fireDelay: profile.fireDelay,
      speed: profile.speed,
      bulletSp: profile.bulletSp,
      size: profile.size,
      dmg: profile.dmg,
      ram: !!profile.ram,
      range: profile.range || 700,
      keepDist: profile.keepDist || 0,
    });
  }
}

function nearestPlayerTo(x, y) {
  let best = null, bestD = Infinity;
  for (const p of players.values()) {
    if (!p.alive) continue;
    const dx = p.x - x, dy = p.y - y;
    const d = dx*dx + dy*dy;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function spawnBoss() {
  if (boss) return;
  const alive = [...players.values()].filter(p => p.alive);
  if (!alive.length) return;
  const target = alive[Math.floor(Math.random() * alive.length)];
  const ang = Math.random() * Math.PI * 2;
  // Pick a boss archetype: bruiser / fast-glass-cannon / minion-summoner.
  const kind = ['dreadnought', 'interceptor', 'carrier'][Math.floor(Math.random() * 3)];
  const hpBase = 1200 + sector * 150;
  const hp = kind === 'interceptor' ? hpBase * 0.7 : kind === 'carrier' ? hpBase * 0.9 : hpBase;
  // Fix 37: spawn offset must clear sun radius+pullRange so boss doesn't appear inside star
  const sun = curMW().sun;
  const spawnDist = Math.max(1800, (sun.pullRange || sun.r || 0) + 1500);
  boss = { id: nextEntityId++, kind, x: target.x + Math.cos(ang) * spawnDist, y: target.y + Math.sin(ang) * spawnDist,
    vx: 0, vy: 0, a: 0, hp, maxHp: hp, fireCool: 2, minCool: 6, phase: 1 };
  for (const p of players.values()) {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'boss_spawn' }));
  }
}

function updateBoss(dt) {
  if (!boss) return;
  if (boss.hp <= 0) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      loot.push({ id: nextEntityId++, x: boss.x + Math.cos(a)*70, y: boss.y + Math.sin(a)*70,
        type: ['hp','shield','ammo','speed','warp'][Math.floor(Math.random()*5)], life: 20 });
    }
    for (const p of players.values()) if (p.alive) p.kills += 2;
    // Fix 38: broadcast boss_dead so client HUD clears immediately, not after next 30Hz snapshot
    for (const p of players.values()) {
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'boss_dead' }));
    }
    boss = null;
    return;
  }
  if (boss.phase === 1 && boss.hp < boss.maxHp * 0.5) {
    boss.phase = 2;
    for (const p of players.values()) {
      if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'boss_phase2' }));
    }
  }
  const target = nearestPlayerTo(boss.x, boss.y);
  if (!target) return;
  const dx = target.x - boss.x, dy = target.y - boss.y;
  const d = Math.hypot(dx, dy);
  const targetA = Math.atan2(dy, dx);
  let dA = targetA - boss.a;
  while (dA > Math.PI) dA -= Math.PI*2;
  while (dA < -Math.PI) dA += Math.PI*2;
  const enraged = boss.phase === 2;
  const kind = boss.kind || 'dreadnought';

  // Turn + move — interceptors are nimble and close in; carriers hang back.
  const turnSp = (kind === 'interceptor' ? 1.8 : kind === 'carrier' ? 0.7 : 0.9) * (enraged ? 1.5 : 1);
  boss.a += clamp(dA, -turnSp*dt, turnSp*dt);
  const closeDist = kind === 'interceptor' ? 260 : kind === 'carrier' ? 700 : 400;
  if (d > closeDist) {
    const spd = (kind === 'interceptor' ? 90 : kind === 'carrier' ? 34 : 42) * (enraged ? 1.4 : 1);
    boss.vx += Math.cos(boss.a) * spd * dt * 1.6;
    boss.vy += Math.sin(boss.a) * spd * dt * 1.6;
  } else if (kind === 'carrier' && d < closeDist - 150) {
    boss.vx -= Math.cos(boss.a) * 30 * dt * 1.6;   // back off to keep range
    boss.vy -= Math.sin(boss.a) * 30 * dt * 1.6;
  }
  const maxSp = (kind === 'interceptor' ? 210 : kind === 'carrier' ? 80 : 90) * (enraged ? 1.45 : 1);
  const sp = Math.hypot(boss.vx, boss.vy);
  if (sp > maxSp) { boss.vx *= maxSp/sp; boss.vy *= maxSp/sp; }
  boss.x += boss.vx*dt; boss.y += boss.vy*dt;

  boss.fireCool -= dt;
  if (boss.fireCool <= 0 && d < 1100 && Math.abs(dA) < 0.7) {
    let offsets, bsp, cool;
    if (kind === 'interceptor') {            // tight, rapid bursts
      offsets = enraged ? [-0.08, 0.08] : [0]; bsp = 560; cool = enraged ? 0.5 : 0.8;
    } else if (kind === 'carrier') {         // wide slow spread
      offsets = enraged ? [-0.4,-0.2,0,0.2,0.4] : [-0.25,0,0.25]; bsp = 340; cool = enraged ? 1.3 : 1.9;
    } else {                                  // dreadnought (original)
      offsets = enraged ? [-0.3,-0.15,0,0.15,0.3] : [-0.2,0,0.2]; bsp = 390; cool = enraged ? 1.1 : 1.7;
    }
    for (const off of offsets) {
      const a = boss.a + off;
      // Fix 46: ownerId:-1 marks boss bullets (rendered orange)
      bullets.push({ id: nextEntityId++, x: boss.x+Math.cos(a)*55, y: boss.y+Math.sin(a)*55,
        vx: Math.cos(a)*bsp, vy: Math.sin(a)*bsp, life: 2.5, friendly: false, ownerId: -1, dmg: 14 });
    }
    boss.fireCool = cool;
  }

  // Minions — carriers summon from the start; others only when enraged.
  if (kind === 'carrier' || enraged) {
    boss.minCool -= dt;
    // Fix 39/40: cap enemy count + require alive players
    const aliveCount = [...players.values()].filter(p => p.alive).length;
    const cap = kind === 'carrier' ? MAX_ENEMIES : MAX_ENEMIES - 2;
    if (boss.minCool <= 0 && enemies.length < cap && aliveCount > 0) {
      const n = kind === 'carrier' ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const a = Math.random()*Math.PI*2;
        enemies.push({ id: nextEntityId++, x: boss.x+Math.cos(a)*130, y: boss.y+Math.sin(a)*130,
          vx:0,vy:0,a:0, kind:'scout', hp:20,maxHp:20, fireCool:1, fireDelay:[0.5,1.2],
          speed:120+sector*10, bulletSp:480, size:0.7, dmg:8 });
      }
      boss.minCool = kind === 'carrier' ? 4 : 5;
    } else if (boss.minCool <= 0) {
      boss.minCool = 2; // retry sooner if capped
    }
  }
}

function applyLoot(p, type) {
  if      (type==='hp')     p.hp     = Math.min(p.maxHp,     p.hp     + 40);
  else if (type==='shield') p.shield = Math.min(p.maxShield, p.shield + 50);
  else if (type==='warp')   p.warpCharge = Math.min(p.maxWarpCharge, p.warpCharge + 120);
  else if (type==='ammo') {
    // Fix 42: don't stack duplicate ammo buffs — replace existing one
    p.buffs = p.buffs.filter(b => b.type !== 'ammo');
    p.buffs.push({ type:'ammo', timeLeft: 8 });
  }
  else if (type==='speed') {
    // Fix 43: same for speed — replace, don't stack
    p.buffs = p.buffs.filter(b => b.type !== 'speed');
    p.buffs.push({ type:'speed', timeLeft: 6 });
  }
}

function updateLoot(dt) {
  for (let i = loot.length-1; i >= 0; i--) {
    loot[i].life -= dt;
    if (loot[i].life <= 0) { loot.splice(i,1); continue; }
    const l = loot[i];
    for (const p of players.values()) {
      if (!p.alive) continue;
      if (Math.hypot(l.x-p.x, l.y-p.y) < 28) { applyLoot(p, l.type); loot.splice(i,1); break; }
    }
  }
}

function updateAsteroids(dt) {
  for (const a of asteroids) {
    a.x += a.vx*dt; a.y += a.vy*dt;
    a.angle += a.spin*dt;
    // Damage players on collision
    for (const p of players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(a.x-p.x, a.y-p.y);
      if (d < a.r + 12) {
        let dmg = 18*dt;
        if (p.shield>0) { const ab=Math.min(p.shield,dmg); p.shield-=ab; dmg-=ab; }
        p.hp -= dmg;
        // Bug 31 fix: asteroid death didn't reset warpActive — ship showed as warping while dead
        if (p.hp<=0 && p.alive) { p.alive=false; p.respawnTimer=4; p.warpActive=false; }
      }
    }
  }
}

// Shared enemy-death bookkeeping: credit kill, advance sector, trigger boss, drop loot.
function onEnemyKilled(e, owner) {
  if (owner) owner.kills++;
  totalKills++;
  bossKillCounter++;
  if (totalKills % 5 === 0 && sector < 30) sector++;
  if (bossKillCounter >= BOSS_EVERY && !boss) { spawnBoss(); bossKillCounter = 0; }
  if (loot.length < 40 && Math.random() < 0.3) {
    loot.push({ id: nextEntityId++, x: e.x, y: e.y, type: LOOT_TYPES[Math.floor(Math.random() * LOOT_TYPES.length)], life: 12 });
  }
}

// Trigger a class's active ability. Sets cooldown + a short visual flash the client renders.
function fireAbility(p) {
  const cfg = ABILITIES[p.shipClass] || ABILITIES.gunship;
  p.abilityCool = cfg.cool;
  p.abilityFlash = 0.45;
  p.abilityKind = p.shipClass;
  if (p.shipClass === 'fighter') {
    // Blink: jump forward, with brief invulnerability to punch through fire
    p.x += Math.cos(p.a) * 680;
    p.y += Math.sin(p.a) * 680;
    p.invuln = 0.8;
  } else if (p.shipClass === 'gunship') {
    // Barrage: 360° ring of bullets
    const N = 18;
    for (let i = 0; i < N; i++) {
      const a = p.a + (i / N) * Math.PI * 2;
      bullets.push({ id: nextEntityId++, x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16,
        vx: Math.cos(a) * 820 + p.vx, vy: Math.sin(a) * 820 + p.vy, life: 1.3, friendly: true, ownerId: p.id });
    }
  } else if (p.shipClass === 'tank') {
    // Shockwave: damage + knockback enemies, wipe nearby hostile bullets, gain a resist window
    const R = 440;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < R) {
        e.hp -= 70 * (p.dmgMul || 1);
        const k = (1 - d / R) * 1100;
        e.vx += (dx / d) * k; e.vy += (dy / d) * k;
        if (e.hp <= 0) { enemies.splice(j, 1); onEnemyKilled(e, p); }
      }
    }
    if (boss) { const dx = boss.x - p.x, dy = boss.y - p.y; if (Math.hypot(dx, dy) < R) boss.hp -= 90 * (p.dmgMul || 1); }
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (!b.friendly && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < R * R) bullets.splice(i, 1);
    }
    p.abilityActive = 3;          // damage-resist window
    p.shockR = R;
  } else if (p.shipClass === 'support') {
    // Repair Pulse: heal + refill shield for self and nearby allies
    p.hp = Math.min(p.maxHp, p.hp + 70);
    p.shield = p.maxShield;
    for (const o of players.values()) {
      if (o.id === p.id || !o.alive) continue;
      if (Math.hypot(o.x - p.x, o.y - p.y) < 460) { o.hp = Math.min(o.maxHp, o.hp + 70); o.shield = o.maxShield; }
    }
  }
}

function updatePlayers(dt) {
  // Defer hyperjump trigger until after the player loop finishes —
  // triggerHyperjump mutates every player's warp state which would
  // race with this iteration.
  let pendingJumpTier = -1;
  // Bug fix: reset the per-tick heal flag so each ally is healed by at most ONE
  // support per tick (the original "Bug 35 fix" set the flag but never read it,
  // so N supports still stacked N× healing).
  for (const p of players.values()) p._healedThisTick = false;
  for (const p of players.values()) {
    if (!p.alive) {
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        // Respawn at a safe ring around the current sun, not the origin
        // (which could be inside a big sun or central black hole)
        p.alive = true;
        p.hp = p.maxHp; p.shield = p.maxShield;
        const sun = curMW().sun;
        const safe = Math.max(sun.r, sun.pullRange || 0) + 1500;
        const ang = Math.random() * Math.PI * 2;
        p.x = sun.x + Math.cos(ang) * safe;
        p.y = sun.y + Math.sin(ang) * safe;
        p.a = ang + Math.PI;
        p.vx = 0; p.vy = 0;
        // Defensive: reset transient fields so a stale aim/warpHold doesn't carry
        p.fireCool = 0;
        p.warpActive = false;
        p.warpHoldTime = 0;
        p.shiftWasDown = false;
        p.aimAngle = null;
        p.wormholeCool = 0;
      }
      continue;
    }
    // Warp drive (afterburner)
    if (p.wormholeCool > 0) p.wormholeCool = Math.max(0, p.wormholeCool - dt);
    const shiftDown = !!p.keys.warp;
    const justPressed = shiftDown && !p.shiftWasDown;
    p.shiftWasDown = shiftDown;
    if (justPressed && !p.warpActive && p.warpCharge >= 60) {
      p.warpActive = true;
      p.warpJustEngaged = true;
      // Instant burst forward
      p.vx += Math.cos(p.a) * 8000;
      p.vy += Math.sin(p.a) * 8000;
    }
    if (p.warpActive) {
      if (!shiftDown || p.warpCharge <= 0) {
        const heldFor = p.warpHoldTime || 0;
        p.warpActive = false;
        p.warpHoldTime = 0;
        // Hyperjump tier check when any player releases warp
        let reached = -1;
        if (heldFor >= 12.5)     reached = 3;
        else if (heldFor >= 6.5) reached = 2;
        else if (heldFor >= 4.5) reached = 1;
        else if (heldFor >= 2.5) reached = 0;
        // Downgrade to the highest scope this pilot has ENABLED (so you can turn off
        // jumping to galaxies/universes/omniverses and only travel where you want).
        const tt = p.travelTiers || { 0: true, 1: true, 2: true, 3: true };
        let tier = -1;
        for (let k = reached; k >= 0; k--) { if (tt[k]) { tier = k; break; } }
        if (tier > pendingJumpTier) pendingJumpTier = tier;
      } else {
        p.warpCharge = Math.max(0, p.warpCharge - 100 * dt);
        p.warpHoldTime = (p.warpHoldTime || 0) + dt;
      }
    } else {
      p.warpCharge = Math.min(p.maxWarpCharge, p.warpCharge + 25 * dt * (p.warpRegenMul || 1));
    }
    // Active ability (F) — fires once on rising edge when off cooldown
    const abilityDown = !!p.keys.ability;
    if (abilityDown && !p.abilityWasDown && p.abilityCool <= 0) fireAbility(p);
    p.abilityWasDown = abilityDown;
    if (p.abilityCool   > 0) p.abilityCool   = Math.max(0, p.abilityCool   - dt);
    if (p.invuln        > 0) p.invuln        = Math.max(0, p.invuln        - dt);
    if (p.abilityActive > 0) p.abilityActive = Math.max(0, p.abilityActive - dt);
    if (p.abilityFlash  > 0) p.abilityFlash  = Math.max(0, p.abilityFlash  - dt);
    // Black hole gravity (also caps speed near event horizon)
    let bhInf = 0;
    for (const a of anomalies) {
      if (a.type !== 'blackhole') continue;
      const dx = a.x - p.x, dy = a.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < a.pullRange) {
        const pull = 2800 * (1 - d / a.pullRange);
        p.vx += (dx / d) * pull * dt;
        p.vy += (dy / d) * pull * dt;
        const t = 1 - Math.max(0, (d - a.r) / Math.max(1, a.pullRange - a.r));
        if (t > bhInf) bhInf = t;
      }
      if (d < a.r && p.invuln <= 0) {
        let dmg = 60 * dt;
        if (p.abilityActive > 0) dmg *= 0.4;   // Tank shockwave resist applies to hazards too
        if (p.shield > 0) { const ab = Math.min(p.shield, dmg); p.shield -= ab; dmg -= ab; }
        p.hp -= dmg;
        // Survive to 1 HP inside the hole → it spits you into The Singularity.
        if (p.hp <= 1 && !inSingularity) { p.hp = 1; pendingSingularity = true; }
      }
    }
    // Bug 13: also slow warp near a CENTRAL black hole (omniverse milky ways)
    {
      const c = curMW().sun;
      if (c.type === 'blackhole') {
        const pr = c.pullRange || 1500;
        const d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < pr) {
          const t = 1 - Math.max(0, (d - c.r) / Math.max(1, pr - c.r));
          if (t > bhInf) bhInf = t;
        }
      }
    }
    const bhSlowdown = 1 - 0.9 * bhInf;
    // Steering + thrust (slowed near black holes)
    const turnRate = p.warpActive ? 1.0 : 3.4;
    if (p.keys.left)  p.a -= turnRate * dt;
    if (p.keys.right) p.a += turnRate * dt;
    // Touch joystick aim: smoothly turn toward the target angle if no keyboard turn pressed
    if (p.aimAngle != null && !p.keys.left && !p.keys.right) {
      let dA = p.aimAngle - p.a;
      while (dA > Math.PI)  dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
      p.a += clamp(dA, -turnRate * dt, turnRate * dt);
    }
    // Buff timers
    for (let i = p.buffs.length-1; i >= 0; i--) {
      p.buffs[i].timeLeft -= dt;
      if (p.buffs[i].timeLeft <= 0) p.buffs.splice(i,1);
    }
    const speedBuff  = p.buffs.some(b => b.type==='speed') ? 2 : 1;
    const effSpeedMul = (p.speedMul||1) * speedBuff;
    const thrustAccel = (p.warpActive ? 12000 : 300 * effSpeedMul) * bhSlowdown;
    if (p.keys.thrust) {
      p.vx += Math.cos(p.a) * thrustAccel * dt;
      p.vy += Math.sin(p.a) * thrustAccel * dt;
    }
    if (!p.warpActive) {
      const drag = p.keys.brake ? 1.4 : 0.05;
      p.vx -= p.vx * drag * dt * 1.6;
      p.vy -= p.vy * drag * dt * 1.6;
    }
    const sp = Math.hypot(p.vx, p.vy);
    const normalMax = 380 * effSpeedMul;
    let MAX;
    if (p.warpActive) {
      // Black-hole gravity drags light-speed down toward normal cruising speed.
      // At the event horizon (bhInf→1) warp is throttled all the way to a normal
      // aircraft's top speed, so you can't just warp straight out of the well.
      const warpMax = 22000 * (p.warpSpeedMul || 1);
      MAX = warpMax + (normalMax - warpMax) * bhInf;
    } else {
      MAX = normalMax * bhSlowdown;
    }
    if (sp > MAX) { p.vx *= MAX / sp; p.vy *= MAX / sp; }
    // Support heal — Bug 35 fix: each support player healed independently, so 3 supports gave 3×
    // the heal. Now cap the heal received per ally per tick regardless of how many supports are near.
    if (p.shipClass === 'support') {
      for (const other of players.values()) {
        if (other.id===p.id || !other.alive || other._healedThisTick) continue;
        if (Math.hypot(other.x-p.x, other.y-p.y) < 350) {
          other.hp = Math.min(other.maxHp, other.hp + 5*dt);
          other._healedThisTick = true;
        }
      }
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    // Wormhole teleport
    if (p.wormholeCool <= 0) {
      for (const a of anomalies) {
        if (a.type !== 'wormhole') continue;
        if (Math.hypot(a.x - p.x, a.y - p.y) < a.r + 14) {
          const speed = Math.hypot(p.vx, p.vy);
          const ux = speed > 1 ? p.vx / speed : Math.cos(p.a);
          const uy = speed > 1 ? p.vy / speed : Math.sin(p.a);
          // Bug 36 fix: exit offset was a.r+30 — player exiting toward the destination wormhole
          // could immediately re-enter it. Use a larger offset (a.r + 200) to clear the wormhole.
          const off = a.r + 200;
          p.x = a.destX + ux * off; p.y = a.destY + uy * off;
          p.vx *= 0.4; p.vy *= 0.4;
          p.wormholeCool = 1.5; // also increased from 1.0 to 1.5s for extra safety
          break;
        }
      }
    }
    if (p.hp <= 0 && p.alive) { p.alive = false; p.respawnTimer = 4; p.warpActive = false; }

    // Fire
    p.fireCool -= dt;
    if (p.keys.fire && p.fireCool <= 0) {
      // Fire toward the cursor-controlled turret (falls back to ship facing for touch).
      const fa = (p.turretAngle != null) ? p.turretAngle : p.a;
      bullets.push({
        id: nextEntityId++,
        x: p.x + Math.cos(fa) * 16, y: p.y + Math.sin(fa) * 16,
        vx: Math.cos(fa) * 700 + p.vx,
        vy: Math.sin(fa) * 700 + p.vy,
        life: 1.5, friendly: true, ownerId: p.id,
      });
      const ammoBuff = p.buffs.some(b => b.type==='ammo') ? 2 : 1;
      p.fireCool = 0.18 / ((p.fireRateMul||1) * ammoBuff);
    }
    // Shield regen
    p.shield = clamp(p.shield + (p.shieldRegen || 14) * dt, 0, p.maxShield);
    // Bug 12: clamp HP/shield so they never go negative
    if (p.hp < 0) p.hp = 0;
    if (p.shield < 0) p.shield = 0;
    // Safety: never let physics drift to NaN/Infinity (would spin/teleport the ship)
    if (!isFinite(p.a)) p.a = 0;
    if (!isFinite(p.vx)) p.vx = 0;
    if (!isFinite(p.vy)) p.vy = 0;
    if (!isFinite(p.x) || !isFinite(p.y)) { const s = curMW().sun; p.x = s.x + 1500; p.y = s.y; }
  }
  if (pendingJumpTier >= 0) triggerHyperjump(pendingJumpTier);
}

function updateEnemies(dt) {
  // Index loop so kamikazes can splice themselves on detonation.
  for (let idx = enemies.length - 1; idx >= 0; idx--) {
    const e = enemies[idx];
    const target = nearestPlayerTo(e.x, e.y);
    if (!target) continue;
    const dx = target.x - e.x, dy = target.y - e.y;
    const d = Math.hypot(dx, dy);
    const targetA = Math.atan2(dy, dx);
    let dA = targetA - e.a;
    while (dA > Math.PI) dA -= Math.PI*2;
    while (dA < -Math.PI) dA += Math.PI*2;
    const turn = e.kind === 'kamikaze' ? 3.2 : 2.2;
    e.a += clamp(dA, -turn*dt, turn*dt);
    if (e.kind === 'sniper') {
      // Snipers hold range: back off when crowded, ease in when too far, else strafe.
      const kd = e.keepDist || 850;
      if (d < kd - 80) { e.vx -= Math.cos(e.a) * e.speed * dt * 1.6; e.vy -= Math.sin(e.a) * e.speed * dt * 1.6; }
      else if (d > kd + 120) { e.vx += Math.cos(e.a) * e.speed * dt * 1.6; e.vy += Math.sin(e.a) * e.speed * dt * 1.6; }
      else { e.vx += Math.cos(e.a + Math.PI/2) * 50 * dt; e.vy += Math.sin(e.a + Math.PI/2) * 50 * dt; }
    } else if (e.kind === 'kamikaze') {
      e.vx += Math.cos(e.a) * e.speed * dt * 2.2;   // full-throttle ram
      e.vy += Math.sin(e.a) * e.speed * dt * 2.2;
    } else if (d > 220) {
      e.vx += Math.cos(e.a) * e.speed * dt * 1.6;
      e.vy += Math.sin(e.a) * e.speed * dt * 1.6;
    } else {
      e.vx += Math.cos(e.a + Math.PI/2) * 40 * dt;
      e.vy += Math.sin(e.a + Math.PI/2) * 40 * dt;
    }
    const sp = Math.hypot(e.vx, e.vy);
    // Per-kind speed caps (Bug 27 fix kept; new kinds added)
    const maxEsp = e.kind === 'kamikaze' ? 360 : e.kind === 'scout' ? 280 : e.kind === 'swarm' ? 300
      : e.kind === 'heavy' ? 120 : e.kind === 'sniper' ? 200 : 180;
    if (sp > maxEsp) { e.vx *= maxEsp/sp; e.vy *= maxEsp/sp; }
    e.x += e.vx * dt; e.y += e.vy * dt;
    // Kamikaze detonates on contact (i-frames negate it)
    if (e.ram && d < 26 + e.size * 14) {
      if (target.invuln <= 0) {
        let dmg = 42 + sector * 2;
        if (target.shield > 0) { const ab = Math.min(target.shield, dmg); target.shield -= ab; dmg -= ab; }
        target.hp -= dmg;
        if (target.hp <= 0 && target.alive) { target.alive = false; target.respawnTimer = 4; target.warpActive = false; }
      }
      enemies.splice(idx, 1);
      continue;
    }
    e.fireCool -= dt;
    if (!e.ram && e.fireCool <= 0 && d < (e.range || 700) && Math.abs(dA) < 0.4) {
      const shots = e.kind === 'heavy' ? [-0.18, 0.18] : [0];
      for (const off of shots) {
        const ang = e.a + off;
        bullets.push({
          id: nextEntityId++,
          x: e.x + Math.cos(ang) * 14, y: e.y + Math.sin(ang) * 14,
          vx: Math.cos(ang) * e.bulletSp, vy: Math.sin(ang) * e.bulletSp,
          life: e.kind === 'sniper' ? 2.6 : 2.0, friendly: false, ownerId: 0, dmg: e.dmg || 8,
        });
      }
      e.fireCool = rand(e.fireDelay[0], e.fireDelay[1]);
    }
  }
  // Spawn
  spawnTimer -= dt;
  // The Singularity is a peaceful reward pocket — no enemies spawn there.
  if (inSingularity) { spawnTimer = 3; }
  // Fix 41: cap enemies at 20 so the game doesn't become unplayable
  else if (spawnTimer <= 0 && players.size > 0 && enemies.length < MAX_ENEMIES) {
    spawnEnemy();
    spawnTimer = Math.max(2, 8 - sector * 0.3 - players.size * 0.5);
  } else if (spawnTimer <= 0) {
    spawnTimer = 2;
  }
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    // Bug fix: black hole gravity also pulls bullets, and event horizon consumes them
    for (const a of anomalies) {
      if (a.type !== 'blackhole') continue;
      const dx = a.x - b.x, dy = a.y - b.y;
      const bd = Math.hypot(dx, dy);
      if (bd > 0 && bd < a.pullRange) {
        const pull = 500 * (1 - bd / a.pullRange);
        b.vx += (dx / bd) * pull * dt;
        b.vy += (dy / bd) * pull * dt;
      }
      if (bd < a.r) { b.life = 0; break; }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0) { bullets.splice(i, 1); continue; }
    // Asteroid collision (all bullets)
    let asteroidHit = false;
    for (let j = asteroids.length-1; j >= 0; j--) {
      const a = asteroids[j];
      if ((b.x-a.x)**2+(b.y-a.y)**2 < a.r*a.r) {
        const owner = b.friendly ? players.get(b.ownerId) : null;
        a.hp -= 8 * (owner ? (owner.dmgMul||1) : 0.5);
        if (a.hp <= 0) {
          // Fix 47-48: respect loot cap for asteroid drops (richer inside the Singularity)
          if (loot.length < 40 && Math.random() < (inSingularity ? 0.75 : 0.35)) loot.push({ id:nextEntityId++, x:a.x, y:a.y,
            type:['hp','shield','ammo','speed','warp'][Math.floor(Math.random()*5)], life:12 });
          asteroids.splice(j,1);
        }
        bullets.splice(i,1); asteroidHit=true; break;
      }
    }
    if (asteroidHit) continue;
    // Boss collision (friendly bullets only)
    if (b.friendly && boss) {
      const dx=b.x-boss.x, dy=b.y-boss.y;
      if (dx*dx+dy*dy < 55*55) {
        const owner = players.get(b.ownerId);
        boss.hp -= 12 * (owner ? (owner.dmgMul||1) : 1);
        bullets.splice(i,1); continue;
      }
    }
    if (b.friendly) {
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        const dx = b.x - e.x, dy = b.y - e.y;
        if (dx*dx + dy*dy < 18*18) {
          const owner = players.get(b.ownerId);
          e.hp -= 12 * (owner ? (owner.dmgMul || 1) : 1);
          bullets.splice(i, 1);
          if (e.hp <= 0) { enemies.splice(j, 1); onEnemyKilled(e, owner); }
          break;
        }
      }
    } else {
      for (const p of players.values()) {
        if (!p.alive) continue;
        const dx = b.x - p.x, dy = b.y - p.y;
        if (dx*dx + dy*dy < 16*16) {
          if (p.invuln > 0) { bullets.splice(i, 1); break; }   // Blink i-frames
          let dmg = (b.dmg || 8);
          if (p.abilityActive > 0) dmg *= 0.4;                 // Tank shockwave resist window
          if (p.shield > 0) {
            const absorbed = Math.min(p.shield, dmg);
            p.shield -= absorbed; dmg -= absorbed;
          }
          p.hp -= dmg;
          bullets.splice(i, 1);
          if (p.hp <= 0) {
            p.alive = false;
            p.respawnTimer = 4;
          }
          break;
        }
      }
    }
  }
}

function updateSunCollision(dt) {
  const c = curMW().sun;
  for (const p of players.values()) {
    if (!p.alive) continue;
    const dx = c.x - p.x, dy = c.y - p.y;
    const d = Math.hypot(dx, dy);
    if (c.type === 'blackhole') {
      const pr = c.pullRange || 1500;
      if (d > 0 && d < pr) {
        // Match the strong anomaly-black-hole pull so the omniverse's central
        // black holes are just as inescapable (warp also throttles to normal here).
        const pull = 2800 * (1 - d / pr);
        p.vx += (dx / d) * pull * dt;
        p.vy += (dy / d) * pull * dt;
      }
      if (d < c.r && p.invuln <= 0) {
        let dmg = 80 * dt;
        if (p.abilityActive > 0) dmg *= 0.4;   // Tank shockwave resist applies to hazards too
        if (p.shield > 0) { const ab = Math.min(p.shield, dmg); p.shield -= ab; dmg -= ab; }
        p.hp -= dmg;
        // Survive to 1 HP inside the hole → it spits you into The Singularity.
        if (p.hp <= 1 && !inSingularity) { p.hp = 1; pendingSingularity = true; }
        else if (p.hp <= 0 && p.alive) { p.alive = false; p.respawnTimer = 4; }
      }
    } else if (d < c.r + 12) {
      let dmg = 80 * dt;
      if (p.shield > 0) { const ab = Math.min(p.shield, dmg); p.shield -= ab; dmg -= ab; }
      p.hp -= dmg;
      const ux = dx / (d || 1), uy = dy / (d || 1);
      p.vx -= ux * 400 * dt; p.vy -= uy * 400 * dt;
      if (p.hp <= 0 && p.alive) { p.alive = false; p.respawnTimer = 4; }
    }
    // Bug 15: clamp after sun damage too
    if (p.hp < 0) p.hp = 0;
    if (p.shield < 0) p.shield = 0;
  }

  // Enemies and the boss take the same environmental damage (sun + black holes)
  // and get pulled by black-hole gravity, just like the player.
  function applyHazards(ent) {
    // Central sun / black hole
    const dx = c.x - ent.x, dy = c.y - ent.y;
    const d = Math.hypot(dx, dy);
    if (c.type === 'blackhole') {
      const pr = c.pullRange || 1500;
      if (d > 0 && d < pr) { const pull = 2800 * (1 - d / pr); ent.vx += (dx / d) * pull * dt; ent.vy += (dy / d) * pull * dt; }
      if (d < c.r) ent.hp -= 80 * dt;
    } else if (d < c.r + 12) {
      ent.hp -= 80 * dt;
    }
    // Anomaly black holes
    for (const a of anomalies) {
      if (a.type !== 'blackhole') continue;
      const adx = a.x - ent.x, ady = a.y - ent.y;
      const ad = Math.hypot(adx, ady);
      if (ad > 0 && ad < a.pullRange) { const pull = 2800 * (1 - ad / a.pullRange); ent.vx += (adx / ad) * pull * dt; ent.vy += (ady / ad) * pull * dt; }
      if (ad < a.r) ent.hp -= 60 * dt;
    }
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    applyHazards(enemies[i]);
    if (enemies[i].hp <= 0) enemies.splice(i, 1);   // burned up / crushed — no kill credit
  }
  if (boss) applyHazards(boss);   // boss death handled in updateBoss when hp <= 0
}

function updateHyperjump(dt) {
  if (!hyperjumping) return;
  hyperjumping.age += dt;
  if (hyperjumping.age >= hyperjumping.maxAge) {
    doHyperjump(hyperjumping.tier);
    hyperjumping = null;
  }
}

// Yank everyone into The Singularity — triggered when a black hole drains a player
// to 1 HP. Clears the field, drops a reward loot ring, heals + repositions players.
function enterSingularity() {
  inSingularity = true;
  loadCurrentMilkyWay();
  anomalies = [];          // calm pocket — no black holes to re-trap you
  mergeEvent = null; mergeHoles = [];   // no mergers in the Singularity
  enemies.length = 0;
  bullets.length = 0;
  loot.length = 0;
  if (boss) { for (const pl of players.values()) if (pl.ws.readyState === 1) pl.ws.send(JSON.stringify({ type: 'boss_dead' })); }
  boss = null;
  bossKillCounter = 0;
  const sun = curMW().sun;
  // Reward loot ring (richer than normal drops)
  const types = ['hp', 'hp', 'shield', 'shield', 'warp', 'ammo', 'speed', 'hp'];
  for (let i = 0; i < types.length; i++) {
    const a = (i / types.length) * Math.PI * 2;
    loot.push({ id: nextEntityId++, x: sun.x + Math.cos(a) * 900, y: sun.y + Math.sin(a) * 900, type: types[i], life: 90 });
  }
  // Players arrived on the brink — reposition, heal, and grant brief grace.
  const safe = sun.r + 1400;
  let i = 0;
  for (const p of players.values()) {
    const ang = (i++ * 1.4);
    p.x = sun.x + Math.cos(ang) * safe;
    p.y = sun.y + Math.sin(ang) * safe;
    p.a = ang + Math.PI;
    p.vx = 0; p.vy = 0;
    p.alive = true; p.respawnTimer = 0;
    p.hp = p.maxHp; p.shield = p.maxShield;
    p.warpActive = false; p.warpHoldTime = 0; p.warpCharge = p.maxWarpCharge;
    p.invuln = 1.5;
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify({ type: 'singularity' }));
  }
}

function tick() {
  const dt = 1 / TICK_HZ;
  updateHyperjump(dt);
  if (hyperjumping) return;
  updatePlanetOrbits(dt);
  updateSunCollision(dt);
  updatePlayers(dt);
  updateEnemies(dt);
  updateBullets(dt);
  updateBoss(dt);
  updateLoot(dt);
  updateAsteroids(dt);
  updateMerge(dt);
  if (pendingSingularity) { pendingSingularity = false; enterSingularity(); }
}

function buildSnapshot() {
  const sun = curMW().sun;
  return {
    type: 'state',
    sector,
    location: locationLabel(),
    sun: { x: sun.x, y: sun.y, r: sun.r, color: sun.color, hot: sun.hot, name: sun.name, type: sun.type, pullRange: sun.pullRange },
    planets: planetsState.map(p => {
      // Tangent velocity of the orbit so the client can extrapolate planet
      // position between snapshots (otherwise they visibly stutter at 30Hz).
      const tangent = p.orbitSpeed * p.orbitRadius;
      const vx = Math.round(-Math.sin(p.orbitAngle) * tangent);
      const vy = Math.round( Math.cos(p.orbitAngle) * tangent);
      return { name: p.name, x: Math.round(p.x), y: Math.round(p.y), vx, vy, r: p.r, color: p.color, orbitRadius: p.orbitRadius, rogue: p.rogue, upgrade: p.upgrade, upgradeName: p.upgradeName, upgradeDesc: p.upgradeDesc };
    }),
    hyperjumping: hyperjumping ? { tier: hyperjumping.tier, t: hyperjumping.age / hyperjumping.maxAge } : null,
    anomalies,
    players: [...players.values()].map(p => {
      const justEng = p.warpJustEngaged; p.warpJustEngaged = false;
      return {
        id: p.id, name: p.name, color: p.color,
        turret: +(p.turretAngle != null ? p.turretAngle : p.a).toFixed(3),
        x: Math.round(p.x), y: Math.round(p.y), a: +p.a.toFixed(3),
        vx: Math.round(p.vx), vy: Math.round(p.vy),
        hp: Math.round(p.hp), maxHp: p.maxHp,
        shield: Math.round(p.shield), maxShield: p.maxShield,
        kills: p.kills, alive: p.alive,
        respawnTimer: p.alive ? 0 : +p.respawnTimer.toFixed(1),
        warpActive: p.warpActive,
        warpCharge: Math.round(p.warpCharge),
        maxWarpCharge: p.maxWarpCharge,
        warpJustEngaged: justEng,
        voice: p.voice,
        shipClass: p.shipClass,
        buffs: p.buffs.map(b => ({ type: b.type, timeLeft: +b.timeLeft.toFixed(1) })),
        upgradesTaken: [...p.upgradesTaken, ...p.singularityTaken],
        abilityCool: +p.abilityCool.toFixed(1),
        abilityMaxCool: p.abilityMaxCool,
        invuln: p.invuln > 0,
        abilityFlash: +(p.abilityFlash || 0).toFixed(2),
        abilityKind: p.abilityKind,
      };
    }),
    enemies: enemies.map(e => ({
      id: e.id, x: Math.round(e.x), y: Math.round(e.y), a: +e.a.toFixed(3),
      vx: Math.round(e.vx), vy: Math.round(e.vy),
      kind: e.kind, hp: Math.round(e.hp), maxHp: e.maxHp,
    })),
    bullets: bullets.map(b => ({
      id: b.id, x: Math.round(b.x), y: Math.round(b.y),
      vx: Math.round(b.vx), vy: Math.round(b.vy),
      friendly: b.friendly, ownerId: b.ownerId,
    })),
    boss: boss ? { id: boss.id, kind: boss.kind, x: Math.round(boss.x), y: Math.round(boss.y), a: +boss.a.toFixed(3),
      vx: Math.round(boss.vx), vy: Math.round(boss.vy), hp: Math.round(boss.hp), maxHp: boss.maxHp, phase: boss.phase } : null,
    loot: loot.map(l => ({ id: l.id, x: Math.round(l.x), y: Math.round(l.y), type: l.type })),
    asteroids: asteroids.map(a => ({ id: a.id, x: Math.round(a.x), y: Math.round(a.y),
      r: a.r, hp: Math.round(a.hp), maxHp: a.maxHp, seed: a.seed, angle: +a.angle.toFixed(3) })),
  };
}

function broadcast() {
  const snap = JSON.stringify(buildSnapshot());
  for (const p of players.values()) {
    if (p.ws.readyState === 1) p.ws.send(snap);
  }
}

// ── HTTP + WebSocket ─────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/info') {
    const ips = getLocalIPs();
    // Bug 34 fix: cache the QR code — was regenerated on every request (slow crypto operation)
    if (!getLocalIPs._qrCache) {
      const url = ips.length ? `http://${ips[0]}:${PORT}/` : `http://localhost:${PORT}/`;
      QRCode.toDataURL(url, { width: 200, margin: 2 }, (err, dataUrl) => {
        getLocalIPs._qrCache = err ? null : dataUrl;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ips, port: PORT, qr: getLocalIPs._qrCache }));
      });
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ips, port: PORT, qr: getLocalIPs._qrCache }));
    }
    return;
  }
  // Serve the multiplayer client at /
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(path.join(__dirname, 'spaceship-mp.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('client not found'); return; }
      // Never cache the HTML so players always get the latest build (no hard-refresh needed).
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache, no-store, must-revalidate', 'pragma': 'no-cache', 'expires': '0' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const p = addPlayer(ws);
  ws.send(JSON.stringify({ type: 'welcome', id: p.id, color: p.color, anomalies }));
  // Spawn newcomer in a safe spot around the current sun
  const sun = curMW().sun;
  const safe = Math.max(sun.r, sun.pullRange || 0) + 1500;
  const ang = (p.id * 1.2) % (Math.PI * 2);
  p.x = sun.x + Math.cos(ang) * safe;
  p.y = sun.y + Math.sin(ang) * safe;
  p.a = ang + Math.PI;
  console.log(`[+] player ${p.id} connected (total: ${players.size})`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'input' && msg.keys) {
      p.keys = msg.keys;
      p.aimAngle = (typeof msg.aim === 'number') ? msg.aim : null;
      if (typeof msg.turret === 'number') p.turretAngle = msg.turret;
    } else if (msg.type === 'name' && typeof msg.name === 'string') {
      p.name = msg.name.slice(0, 20);
      const cls = CLASSES[msg.class] || CLASSES.gunship;
      p.shipClass = msg.class in CLASSES ? msg.class : 'gunship';
      p.hp = cls.maxHp; p.maxHp = cls.maxHp;
      p.shield = cls.maxShield; p.maxShield = cls.maxShield;
      p.fireRateMul = cls.fireRateMul; p.dmgMul = cls.dmgMul;
      p.warpSpeedMul = cls.warpSpeedMul; p.shieldRegen = cls.shieldRegen;
      p.speedMul = cls.speedMul;
      p.maxWarpCharge = cls.maxWarpCharge || 300; p.warpCharge = p.maxWarpCharge;
      p.abilityMaxCool = (ABILITIES[p.shipClass] || ABILITIES.gunship).cool;
      // A class change is a full stat reset — clear region upgrades and reset the
      // warp-regen modifier, then re-apply permanent Singularity bonuses (mirrors doHyperjump).
      p.warpRegenMul = 1; p.upgradesTaken.clear();
      for (const sn of p.singularityTaken) { const sp = SINGULARITY_MW.planets.find(pl => pl.name === sn); if (sp && UPGRADES[sp.upgrade]) UPGRADES[sp.upgrade].apply(p); }
    } else if (msg.type === 'travel' && msg.tiers && typeof msg.tiers === 'object') {
      // Pilot toggled which hyperjump scopes are enabled (milky way/galaxy/universe/omniverse).
      p.travelTiers = { 0: !!msg.tiers[0], 1: !!msg.tiers[1], 2: !!msg.tiers[2], 3: !!msg.tiers[3] };
    } else if (msg.type === 'voice' && typeof msg.on === 'boolean') {
      p.voice = msg.on;
    } else if (msg.type === 'install' && typeof msg.planet === 'string') {
      // Bug 33 fix: dead players could send install messages — reject them
      if (!p.alive) return;
      const planet = planetsState.find(pl => pl.name === msg.planet);
      if (!planet || !planet.upgrade) return;
      // Generous dock range so a planet drifting along its orbit between docking
      // and pressing Q never silently rejects the install.
      const inRange = Math.hypot(planet.x - p.x, planet.y - p.y) - planet.r < 360;
      if (!inRange) return;
      // Track installs PER PLANET (not per upgrade key). Several planets share the
      // same upgrade key (two 'hull', two 'damage'), so keying by upgrade made the
      // second planet silently un-installable — that was the "can't install on some
      // planets" bug. Per-planet keying lets every planet be installed once.
      // Inside the Singularity, installs are tracked in a permanent set so they
      // can't be re-farmed by leaving and coming back; elsewhere they reset per region.
      const taken = inSingularity ? p.singularityTaken : p.upgradesTaken;
      if (taken.has(planet.name)) return;
      const up = UPGRADES[planet.upgrade];
      if (!up) return;
      up.apply(p);
      taken.add(planet.name);
    } else if (msg.type === 'rtc' && typeof msg.to === 'number' && msg.payload) {
      // Pure signaling relay — server forwards SDP/ICE between two peers, doesn't peek
      const target = players.get(msg.to);
      if (target && target.ws.readyState === 1) {
        target.ws.send(JSON.stringify({ type: 'rtc', from: p.id, payload: msg.payload }));
      }
    }
  });

  ws.on('close', () => {
    removePlayer(p.id);
    console.log(`[-] player ${p.id} disconnected (total: ${players.size})`);
  });
});

setInterval(tick, 1000 / TICK_HZ);
setInterval(broadcast, 1000 / NET_HZ);

server.listen(PORT, () => {
  const ips = getLocalIPs();
  console.log(`Spaceship server listening on :${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}/`);
  for (const ip of ips) console.log(`  Network: http://${ip}:${PORT}/`);
});
