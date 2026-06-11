// Assembles spaceship-solo.html: embeds the server simulation into the client
// page via a loopback (fake socket), so the game runs with NO network/server.
const fs = require('fs');

const mp = fs.readFileSync('spaceship-mp.html', 'utf8');
const srvText = fs.readFileSync('spaceship-server.js', 'utf8');

// Server sim body = everything from the first sim constant through the end of
// broadcast(), located by markers so it survives edits that shift line numbers.
// (constants, world, all update functions, tick(), buildSnapshot(), broadcast() —
// no node-only deps in this range.)
const simStart = srvText.indexOf('const PORT = 8098;');
const simEndMarker = '// ── HTTP + WebSocket';
const simEnd = srvText.indexOf(simEndMarker);
if (simStart < 0 || simEnd < 0) { console.error('FAILED: could not locate sim slice markers'); process.exit(1); }
const simBody = srvText.slice(simStart, simEnd).trimEnd();

// --- Build the LocalServer module (IIFE so its globals can't collide with client) ---
const localServer = `<script>
/* ===== Embedded simulation (from spaceship-server.js) — runs in-page, no network ===== */
const LocalServer = (function () {
${simBody}

  // ---- Loopback glue: replaces the HTTP/WebSocket layer ----
  let _loopStarted = false;
  function _startLoops() {
    if (_loopStarted) return;
    _loopStarted = true;
    setInterval(tick, 1000 / TICK_HZ);
    setInterval(broadcast, 1000 / NET_HZ);
  }

  // Called when the client "opens" a connection. serverWs is a fake socket whose
  // .send(str) pushes a message to the client; addPlayer stores it as p.ws so all
  // existing p.ws.send(...) calls (snapshots, boss events) reach the client.
  function connect(serverWs) {
    const p = addPlayer(serverWs);
    serverWs._player = p;
    serverWs.send(JSON.stringify({ type: 'welcome', id: p.id, color: p.color, anomalies }));
    const sun = curMW().sun;
    const safe = Math.max(sun.r, sun.pullRange || 0) + 1500;
    const ang = (p.id * 1.2) % (Math.PI * 2);
    p.x = sun.x + Math.cos(ang) * safe;
    p.y = sun.y + Math.sin(ang) * safe;
    p.a = ang + Math.PI;
    _startLoops();
    return p;
  }

  // Mirror of the server's ws 'message' handler — applies a client packet to its player.
  function fromClient(serverWs, msg) {
    const p = serverWs._player;
    if (!p) return;
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
      p.warpRegenMul = 1; p.upgradesTaken.clear();
      for (const sn of p.singularityTaken) { const sp = SINGULARITY_MW.planets.find(pl => pl.name === sn); if (sp && UPGRADES[sp.upgrade]) UPGRADES[sp.upgrade].apply(p); }
    } else if (msg.type === 'travel' && msg.tiers && typeof msg.tiers === 'object') {
      p.travelTiers = { 0: !!msg.tiers[0], 1: !!msg.tiers[1], 2: !!msg.tiers[2], 3: !!msg.tiers[3] };
    } else if (msg.type === 'voice' && typeof msg.on === 'boolean') {
      p.voice = msg.on;
    } else if (msg.type === 'install' && typeof msg.planet === 'string') {
      if (!p.alive) return;
      const planet = planetsState.find(pl => pl.name === msg.planet);
      if (!planet || !planet.upgrade) return;
      // Generous range + per-planet keying (see spaceship-server.js): several
      // planets share an upgrade key, so keying by planet name lets each be installed.
      const inRange = Math.hypot(planet.x - p.x, planet.y - p.y) - planet.r < 360;
      if (!inRange) return;
      // Singularity installs go in a permanent set (no re-farming); else per-region.
      const taken = inSingularity ? p.singularityTaken : p.upgradesTaken;
      if (taken.has(planet.name)) return;
      const up = UPGRADES[planet.upgrade];
      if (!up) return;
      up.apply(p);
      taken.add(planet.name);
    }
    // 'rtc' (voice signaling) intentionally ignored — solo has no peers.
  }

  return { connect, fromClient };
})();

// A fake WebSocket pair linking the client (clientSocket) to LocalServer (serverWs).
function createLoopback() {
  const L = { open: [], message: [], close: [], error: [] };
  const clientSocket = {
    readyState: 0,
    addEventListener: (ev, fn) => { (L[ev] || (L[ev] = [])).push(fn); },
    send: (str) => { let m; try { m = JSON.parse(str); } catch { return; } LocalServer.fromClient(serverWs, m); },
    close: () => { clientSocket.readyState = 3; for (const fn of L.close) fn(); },
  };
  const serverWs = {
    readyState: 1,
    send: (str) => { for (const fn of L.message) fn({ data: str }); },
  };
  clientSocket._fireOpen = () => { clientSocket.readyState = 1; for (const fn of L.open) fn(); };
  return { clientSocket, serverWs };
}
</script>
`;

let out = mp.replace('<script>', localServer + '<script>'); // inject before first (main) script

// --- Rewire connect(): swap the WebSocket for the loopback, start the sim ---
out = out.replace(
`  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const host = location.host || ('localhost:8098');
  ws = new WebSocket(\`\${proto}://\${host}/\`);
  document.getElementById('connStatus').textContent = 'Connecting…';`,
`  const { clientSocket, serverWs } = createLoopback();
  ws = clientSocket;
  document.getElementById('connStatus').textContent = 'Connecting…';`
);

// At the end of connect()'s message listener, kick off the local connection.
out = out.replace(
`    } else if (msg.type === 'rtc') {
      handleSignal(msg.from, msg.payload);
    }
  });
}`,
`    } else if (msg.type === 'rtc') {
      handleSignal(msg.from, msg.payload);
    }
  });
  LocalServer.connect(serverWs);
  setTimeout(() => clientSocket._fireOpen(), 0);
}`
);

// Cosmetic: solo branding
out = out.replace('<title>Spaceship — Co-op</title>', '<title>Spaceship — Solo (offline)</title>');
out = out.replace('🚀 Spaceship Co-op', '🚀 Spaceship — Solo');

fs.writeFileSync('spaceship-solo.html', out);
fs.writeFileSync('spaceship.html', out);   // keep both single-player filenames in sync

// --- Sanity checks ---
const checks = [
  ['LocalServer injected', out.includes('const LocalServer = (function ()')],
  ['loopback created', out.includes('createLoopback()')],
  ['no live WebSocket ctor', !out.includes('new WebSocket(')],
  ['connect wired', out.includes('LocalServer.connect(serverWs)')],
  ['buildSnapshot present', out.includes('function buildSnapshot()')],
  ['UNIVERSES present', out.includes('const UNIVERSES')],
];
let ok = true;
for (const [name, pass] of checks) { if (!pass) ok = false; console.log((pass ? 'OK  ' : 'FAIL') + ' ' + name); }
console.log(ok ? '\\nAssembled spaceship-solo.html (' + out.length + ' bytes)' : '\\nASSEMBLY FAILED');
process.exit(ok ? 0 : 1);
