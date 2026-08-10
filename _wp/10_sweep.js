/* ---------- the sweep: your camo score IS the difficulty dial ---------- */
const SW = {
  pass:0, passes:2, t:0, len:0, active:0, phase:'CMD',
  motes:[], beams:[], telegraph:[], moteAcc:0, beamAcc:0,
  moteEvery:1, beamCount:0, grey:false, stillT:0, nextCut:0,
  steady:null, dropletFX:[], dmgFX:[], ko:0, koT:0, doubleT:0, worst:null,
};

function sweepBegin(){
  const s = G.score;
  const CERT = Math.max(5, Math.min(95, 100 - s));
  SW.passes = 2 + Math.floor(CERT / 22);                 // 2..6
  SW.pass = 0; SW.phase = 'CMD';
  SW.motes = []; SW.beams = []; SW.telegraph = []; SW.dropletFX = []; SW.dmgFX = [];
  SW.grey = s >= 70;
  G.notice = Math.max(0, Math.min(40, (CERT - 45) * 0.6));
  SW.ko = 0; SW.doubleT = 0;
  AR.iT = 0;
  arenaSet('MENU', true);
  btnSel = 3;
  G.st = 'SWEEP';
  Audio_.music('sweep', 96 + (100 - s) * 0.6);
}
const PASS_LEN = [8.0, 8.0, 9.5, 9.5, 11.0, 11.0];
const PASS_STATE = ['WIDE','WIDE','SQUARE','SQUARE','TALL','PINCH'];

function passBegin(){
  const s = G.score, CERT = Math.max(5, Math.min(95, 100 - s));
  const len = PASS_LEN[Math.min(5, SW.pass)];
  const threatTotal = Math.max(8, Math.min(40, 8 + 32 * (1 - s/100)));
  let sum = 0; for (let i = 0; i < SW.passes; i++) sum += PASS_LEN[Math.min(5,i)];
  SW.len = len;
  SW.active = Math.min(len - 0.5, threatTotal * len / sum);
  SW.t = 0; SW.moteAcc = 0; SW.beamAcc = 0;
  SW.moteEvery = Math.max(0.22, 1.45 - CERT / 90) * (SW.perfectBonus ? 1.33 : 1);
  SW.perfectBonus = false;
  SW.beamCount = Math.round(1 + CERT / 28);
  SW.speed = 0.70 + CERT / 120;
  arenaSet(PASS_STATE[Math.min(5, SW.pass)]);
  SW.phase = 'WAVE';
  SW.telegraph.push({ t:0.45, x:inner().x + inner().w/2, side:'top' });
}

/* ---------- attacks ---------- */
function spawnMote(heavy){
  const r = inner();
  const side = Math.floor(Math.random() * 4);
  let x, y, vx, vy;
  const sp = (heavy ? 34 : 52) * SW.speed;
  if (side === 0){ x = r.x + Math.random()*r.w; y = r.y - 4; }
  else if (side === 1){ x = r.x + r.w + 4; y = r.y + Math.random()*r.h; }
  else if (side === 2){ x = r.x + Math.random()*r.w; y = r.y + r.h + 4; }
  else { x = r.x - 4; y = r.y + Math.random()*r.h; }
  // never spawn within 14px of the soul
  if (Math.hypot(x - AR.soulX, y - AR.soulY) < 14) return;
  const tx = r.x + 8 + Math.random() * (r.w - 16), ty = r.y + 8 + Math.random() * (r.h - 16);
  const d = Math.hypot(tx - x, ty - y) || 1;
  vx = (tx - x) / d * sp; vy = (ty - y) / d * sp;
  SW.motes.push({ x, y, vx, vy, heavy, r: heavy ? 4 : 3, life: 6 });
}
function spawnBeam(){
  const r = inner();
  const vertical = Math.random() < 0.5;
  SW.beams.push({ vertical, p: vertical ? r.x + 10 : r.y + 8,
                  v: (vertical ? 26 : 18) * SW.speed * (Math.random() < 0.5 ? 1 : -1),
                  life: 5.5, w: 3 });
}

function sweepUpdate(dt){
  if (SW.ko > 0) return koUpdate(dt);
  if (Dlg.active){ Dlg.update(dt); return; }
  arenaStep(dt);

  if (SW.phase === 'CMD'){ cmdUpdate(dt); return; }
  if (SW.phase === 'STEADY'){ steadyUpdate(dt); return; }
  if (SW.phase === 'DOUBLE'){ doubleUpdate(dt); return; }

  // ---- WAVE ----
  SW.t += dt;
  if (AR.iT > 0) AR.iT -= dt;
  if (AR.spawnFreeze > 0) AR.spawnFreeze -= dt;

  const moved = soulMove(dt);
  G.notice += moved * (down('no') ? 0.018 : 0.036);
  if (moved < 0.01){ SW.stillT += dt; if (SW.stillT >= 1) G.notice -= 3 * dt; }
  else SW.stillT = 0;

  const threatOn = SW.t < SW.active;
  if (threatOn && AR.spawnFreeze <= 0){
    SW.moteAcc += dt;
    while (SW.moteAcc >= SW.moteEvery){
      SW.moteAcc -= SW.moteEvery;
      spawnMote(Math.random() < 0.18 && G.score < 60);
    }
    SW.beamAcc += dt;
    if (SW.beams.length < SW.beamCount && SW.beamAcc > 1.6){ SW.beamAcc = 0; spawnBeam(); }
  }

  const r = inner();
  for (const m of SW.motes){
    m.x += m.vx * dt; m.y += m.vy * dt; m.life -= dt;
    if (m.x < r.x - 6 || m.x > r.x + r.w + 6) m.vx *= -1;
    if (m.y < r.y - 6 || m.y > r.y + r.h + 6) m.vy *= -1;
    if (AR.iT <= 0 && Math.abs(m.x - AR.soulX) < m.r + 2 && Math.abs(m.y - AR.soulY) < m.r + 2)
      takeHit(m.heavy ? 4 : 3, m.heavy);
  }
  SW.motes = SW.motes.filter(m => m.life > 0);

  for (const b of SW.beams){
    b.p += b.v * dt; b.life -= dt;
    const lim = b.vertical ? [r.x + 4, r.x + r.w - 4] : [r.y + 4, r.y + r.h - 4];
    if (b.p < lim[0] || b.p > lim[1]) b.v *= -1;
    // a beam over a badly-matched region raises notice
    const cell = soulToCell();
    const m = maskFor(G.shape, G.pose);
    if (G.bars && cell.cx >= 0 && cell.cy >= 0 && cell.cx < m.w && cell.cy < m.h){
      const mv = G.bars.cellM[cell.cy*m.w + cell.cx];
      const onBeam = b.vertical ? Math.abs(AR.soulX - b.p) < 6 : Math.abs(AR.soulY - b.p) < 6;
      if (onBeam && mv >= 0 && mv < 0.5){ G.notice += 8 * dt; G.style += Math.round(60 * dt); }
    }
  }
  SW.beams = SW.beams.filter(b => b.life > 0);

  for (const t of SW.telegraph) t.t -= dt;
  SW.telegraph = SW.telegraph.filter(t => t.t > 0);
  for (const d of SW.dropletFX){ d.y += 40*dt; d.t -= dt; }
  SW.dropletFX = SW.dropletFX.filter(d => d.t > 0);
  for (const d of SW.dmgFX) d.t -= dt;
  SW.dmgFX = SW.dmgFX.filter(d => d.t > 0);

  G.notice = Math.max(0, Math.min(100, G.notice));
  if (G.notice >= 100 || G.hp <= 0) return startKO();

  if (SW.t >= SW.len){
    SW.motes = []; SW.beams = [];
    SW.pass++;
    if (SW.pass >= SW.passes){
      if (G.score < 78){ beginDoubleTake(); }
      else { G.st = 'REVEAL'; revealBegin(); }
      return;
    }
    SW.phase = 'CMD'; arenaSet('MENU'); btnSel = 3;
  }
}

function takeHit(dmg, heavy){
  G.hp -= dmg; AR.iT = 1.10; AR.spawnFreeze = 0.35;
  G.notice += heavy ? 14 : 10;
  freeze(0.10); shake(3);
  SW.dmgFX.push({ t:0.7, v:dmg, x:AR.soulX, y:AR.soulY });
  Audio_.sfx('hurt');
  smudge(heavy ? 8 : 5);
}
/* SMUDGE — damage lands on the painting, where your soul was standing */
function smudge(n){
  const m = maskFor(G.shape, G.pose);
  const cell = soulToCell();
  let cx = cell.cx, cy = cell.cy;
  if (!m.liveAt(cx, cy)){                            // snap to the nearest live cell
    let bd = 1e9;
    for (const c of m.cells){ const d = Math.hypot(c.cx-cx, c.cy-cy); if (d < bd){ bd = d; cx = c.cx; cy = c.cy; } }
  }
  const hitCells = [];
  const q = [[cx,cy]], seen = new Set();
  while (q.length && hitCells.length < n){
    const [x,y] = q.shift(); const k = y*m.w+x;
    if (seen.has(k) || !m.liveAt(x,y)) continue;
    seen.add(k);
    if (G.grid[k] !== WHITE_IDX) hitCells.push(k);
    q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
  for (const k of hitCells){
    G.grid[k] = WHITE_IDX;
    SW.dropletFX.push({ x: AR.soulX + (Math.random()*8-4), y: AR.soulY, t:0.6 });
  }
  blankDirty = true;
  const b = computeScore(); G.bars = b; G.score = b.total;
  spotViewT = 0; bakeSpotView();
}

/* ---------- command phase between passes ---------- */
function cmdUpdate(dt){
  if (SUB.open){ subUpdate(); return; }
  buttonNav();
  if (!hit('ok')) return;
  Audio_.sfx('confirm');
  if (btnSel === 3){ beginSteady(); return; }
  if (btnSel === 0){
    subOpen('PAINT', [
      { label:'TOUCH UP  +12 NOTICE', k:'touch' },
      { label:'RAG  +9 HP  (' + G.rags + ')', k:'rag', disabled: G.rags <= 0 },
    ], it => {
      if (it.k === 'touch'){ G.notice += 12; G.st = 'TOUCHUP'; touchBegin(); }
      else { G.rags--; G.hp = Math.min(G.maxhp, G.hp + 9); G.notice += 6; smudge(6); Audio_.sfx('heal'); }
    });
  } else if (btnSel === 1){
    subOpen('POSE', [{ label: G.shifted ? 'SHIFT  (SPENT)' : 'SHIFT  +22 NOTICE', k:'shift', disabled:G.shifted }],
      () => { G.shifted = true; G.notice += 22; openPoseMenuSweep(); });
  } else {
    const scramble = G.notice > 80;
    subOpen('SPOT', [{ label: scramble ? 'SCRAMBLE  END ROUND' : 'BOLT  +30 NOTICE',
                       k:'bolt', disabled: ROOMS[G.room].finale }], () => {
      if (scramble){ G.score = Math.max(20, G.score - 25); G.st = 'REVEAL'; revealBegin(); }
      else { G.notice += 30; openSpotMenuSweep(); }
    });
  }
}
function openPoseMenuSweep(){
  const items = [];
  for (const sh of ['BLOB','CUBE']) for (const po of ['STAND','CURL','LIE','FLATTEN'])
    items.push({ label: sh.slice(0,4) + ' ' + po, sh, po });
  subOpen('SHIFT TO', items, it => {
    setPose(it.sh, it.po);
    const b = computeScore(); G.bars = b; G.score = b.total; bakeSpotView();
  });
}
function openSpotMenuSweep(){
  const items = ROOMS[G.room].spots.map(s => ({ label:s.name.slice(0,22), s }));
  subOpen('BOLT TO', items, it => {
    G.spot = it.s; const b = computeScore(); G.bars = b; G.score = b.total; bakeSpotView();
  });
}

/* ---------- TOUCH UP: a tiny live-timer editor inside the arena ---------- */
const TU = { t:0, cells:0, cx:0, cy:0 };
function touchBegin(){ TU.t = 6.0; TU.cells = 0; const m = maskFor(G.shape,G.pose); TU.cx = m.w>>1; TU.cy = m.h>>1; }
function touchUpdate(dt){
  TU.t -= dt;
  const m = maskFor(G.shape, G.pose);
  const maxc = G.chapter >= 3 ? 12 : 8;
  for (const [k,dx,dy] of [['left',-1,0],['right',1,0],['up',0,-1],['down',0,1]])
    if (hit(k)){ TU.cx = Math.max(0, Math.min(m.w-1, TU.cx+dx)); TU.cy = Math.max(0, Math.min(m.h-1, TU.cy+dy)); }
  for (let i = 0; i < 8; i++) if (hit('s'+(i+1))) G.slot = i;
  if (hit('ok') && TU.cells < maxc && m.liveAt(TU.cx, TU.cy)){
    G.grid[TU.cy*m.w + TU.cx] = G.slots[G.slot]; TU.cells++;
    blankDirty = true; Audio_.sfx('brush');
  }
  if (TU.t <= 0 || hit('pause') || hit('no') || TU.cells >= maxc){
    const b = computeScore(); G.bars = b; G.score = b.total; bakeSpotView();
    SW.grey = G.score >= 70;
    G.st = 'SWEEP'; SW.phase = 'CMD';
  }
}
function touchDraw(c){
  drawChrome(c, 'TOUCHING UP', true);
  const r = inner();
  drawArenaFrame(c, false);
  const m = maskFor(G.shape, G.pose);
  const s = 3, ox = r.x + (r.w - m.w*s)/2, oy = r.y + (r.h - m.h*s)/2;
  for (const cell of m.cells) rect(c, ox+cell.cx*s, oy+cell.cy*s, s, s, PAL[G.grid[cell.i]]);
  frame(c, ox+TU.cx*s-1, oy+TU.cy*s-1, s+2, s+2, 1, UI.WHITE);
  txt(c, 'CELLS ' + TU.cells + '/' + (G.chapter>=3?12:8) + '   ' + TU.t.toFixed(1) + 'S', r.x+6, r.y-16, UI.GOLD);
  drawButtons(c);
}

/* ---------- STEADY: your paint job is the size of the window ---------- */
function beginSteady(){
  const r = inner();
  const W = Math.round(18 + 62 * G.score / 100);
  const core = Math.max(11, Math.round(0.30 * W));
  const trackX = r.x + 13, trackW = 220;
  SW.steady = { x:trackX, w:trackW, W, core,
                zone: trackX + 24 + Math.random() * Math.max(1, trackW - W - 32),
                mx: trackX, done:false, result:'', t:0 };
  SW.phase = 'STEADY';
  arenaSet('MENU');
}
function steadyUpdate(dt){
  const s = SW.steady;
  if (s.done){
    s.t += dt;
    if (s.t > 0.9){
      SW.steady = null;
      if (SW.pass === 0 && !SW.started){ SW.started = true; }
      passBegin();
    }
    return;
  }
  s.mx += 220 * dt;
  if (hit('ok')){
    const centre = s.zone + s.W/2;
    const d = Math.abs(s.mx - centre);
    if (d <= s.core/2){
      s.result = 'STILL AS PAINT';
      G.notice -= 20 + 18 * G.score/100;
      G.streak = Math.min(5, G.streak + 1);
      G.style += 120 * G.streak;
      SW.perfectBonus = true;
      Audio_.sfx('perfect');
    } else if (s.mx >= s.zone && s.mx <= s.zone + s.W){
      s.result = 'STEADY';
      G.notice -= 10 + 12 * G.score/100;
      Audio_.sfx('good');
    } else {
      s.result = 'SLIP'; G.notice += 6; G.streak = 0; Audio_.sfx('bad');
    }
    G.notice = Math.max(0, Math.min(100, G.notice));
    s.done = true; s.t = 0;
    return;
  }
  if (s.mx > s.x + s.w){ s.result = 'SLIP'; G.notice += 6; G.streak = 0; s.done = true; s.t = 0; Audio_.sfx('bad'); }
}
function steadyDraw(c){
  const s = SW.steady, r = inner();
  frame(c, s.zone, r.y + 10, s.W, r.h - 20, 2, UI.GOLD);
  rect(c, s.zone + s.W/2, r.y + 10, 1, r.h - 20, UI.GOLD);
  rect(c, Math.round(s.mx), r.y + 10, 4, r.h - 20, UI.WHITE);
  if (s.done) txtC(c, s.result, 160, r.y + r.h/2 - 4, s.result === 'SLIP' ? UI.SOUL : UI.GOLD);
  else txtC(c, 'HOLD STILL — PRESS Z IN THE GOLD', 160, r.y - 16, UI.DIM);
}

/* ---------- the double-take ---------- */
function beginDoubleTake(){
  SW.phase = 'DOUBLE'; SW.doubleT = 0; SW.worst = worstWindow();
  arenaSet('PINCH');
  Audio_.sfx('encounter');
}
function doubleUpdate(dt){
  SW.doubleT += dt;
  const moved = soulMove(dt);
  G.notice += moved * 0.036;
  if (moved < 0.01) G.notice -= 3 * dt;
  const m = maskFor(G.shape, G.pose);
  const prog = Math.min(1, SW.doubleT / 3.0);
  const col = Math.floor(prog * 5), cellIdx = (SW.worst.y + 2) * m.w + (SW.worst.x + col);
  const mv = G.bars ? G.bars.cellM[cellIdx] : 1;
  if (mv >= 0 && mv < 0.5) G.notice += 8 * dt;
  G.notice = Math.max(0, Math.min(100, G.notice));
  if (G.notice >= 100) return startKO();
  if (SW.doubleT >= 3.4){ G.st = 'REVEAL'; revealBegin(); }
}

/* ---------- caught ---------- */
function startKO(){
  SW.ko = 1; SW.koT = 0; SW.motes = []; SW.beams = [];
  SW.shards = [];
  for (let i = 0; i < 8; i++)
    SW.shards.push({ x:AR.soulX, y:AR.soulY, vx:(Math.random()*130-65), vy:-(60+Math.random()*85) });
  freeze(0.15); Audio_.sfx('ko'); Audio_.music(null);
}
function koUpdate(dt){
  SW.koT += dt;
  for (const s of SW.shards){ s.x += s.vx*dt; s.y += s.vy*dt; s.vy += 330*dt; }
  if (SW.koT > 2.2 && !Dlg.active && SW.ko === 1){
    SW.ko = 2;
    const L = LOOKERS[ROOMS[G.room].looker];
    G.caught++;
    Dlg.queue(L.capture, { voice:L.voice, onEnd(){
      G.hp = G.maxhp; G.notice = 0; G.prep = ROOMS[G.room].prep;
      G.st = 'PREP'; btnSel = 3; arenaSet('MENU', true); SW.ko = 0;
      spotView = null; bakeSpotView();
    }});
  }
  if (SW.ko === 2) Dlg.update(dt);
}

/* ---------- sweep rendering ---------- */
function sweepDraw(c){
  const L = LOOKERS[ROOMS[G.room].looker];
  drawChrome(c, L.name, true);
  drawSeeker(c, L);
  const r = inner();

  if (SW.ko){
    drawArenaFrame(c, false);
    for (const s of SW.shards) rect(c, s.x, s.y, 2, 2, UI.SOUL);
    if (SW.koT > 1.1) wash(c, Math.min(16, (SW.koT - 1.1) / 0.5 * 16));
    if (SW.koT > 2.2){ Dlg.draw(c); }
    return;
  }

  drawArenaFrame(c, true);
  c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
  const bcol = SW.grey ? UI.DIM : UI.WHITE;
  for (const m of SW.motes){
    rect(c, m.x - m.r - 1, m.y - m.r - 1, m.r*2 + 2, m.r*2 + 2, UI.BLACK);
    rect(c, m.x - m.r + 1, m.y - m.r + 1, m.r*2 - 2, m.r*2 - 2, m.heavy ? UI.CYAN : bcol);
  }
  for (const b of SW.beams){
    if (b.vertical){ rect(c, b.p-1, r.y, b.w+2, r.h, UI.BLACK); rect(c, b.p, r.y, b.w, r.h, bcol); }
    else { rect(c, r.x, b.p-1, r.w, b.w+2, UI.BLACK); rect(c, r.x, b.p, r.w, b.w, bcol); }
  }
  for (const d of SW.dropletFX) rect(c, d.x, d.y, 1, 3, UI.WHITE);
  if (SW.phase === 'STEADY' && SW.steady) steadyDraw(c);
  if (SW.phase === 'DOUBLE'){
    const prog = Math.min(1, SW.doubleT / 3.0);
    rect(c, r.x + prog * r.w, r.y, 2, r.h, UI.CYAN);
  }
  drawSoul(c);
  c.restore();

  for (const t of SW.telegraph)
    if (Math.floor(t.t * 8) % 2) rect(c, t.x - 3, r.y - 12, 6, 3, UI.WHITE);
  for (const d of SW.dmgFX){
    const p = 1 - d.t / 0.7;
    txtC(c, '-' + d.v, d.x, d.y - 18 * (1 - (1-p)*(1-p)), UI.WHITE);
  }

  if (SW.phase === 'CMD' && !SUB.open){
    rect(c, r.x, r.y + r.h - 12, r.w, 12, UI.BLACK);
    txt(c, 'PASS ' + (SW.pass+1) + ' OF ' + SW.passes + '   HOLD STILL, OR FIX SOMETHING.',
        r.x + 6, r.y + r.h - 10, UI.DIM);
  }
  if (SUB.open) subDraw(c);
  drawButtons(c);
}
function drawSeeker(c, L){
  const bob = Math.round(Math.sin(performance.now() / 800));
  const x = 160, y = 86 + bob;
  L.draw(c, x, y);
}
