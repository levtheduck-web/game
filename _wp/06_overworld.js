/* ---------- global run state ---------- */
const G = {
  st:'TITLE', round:0, night:1, room:'CH1',
  px:160, py:190, facing:'down', animDist:0, animIdle:0, running:false,
  shape:'BLOB', pose:'STAND', spot:null, spotIdx:0,
  grid:null, gridW:0, gridH:0,
  slots:new Uint8Array([31,31,31,31,31,31,31,31]), slot:0,
  slotTag:['','','','','','','',''],
  tags:new Set(), score:0, bars:null, prevSlot:1,
  prep:75, coneHit:false,
  caught:0, survived:0, history:[],
  tool:{ size:1, mirror:false, dither:false }, ghostMode:1,
  fade:0, fadeDir:0, fadeThen:null,
  best:0, seenIntro:{},
};

/* ---------- fade helper ---------- */
function fadeTo(fn, dur){
  G.fadeDir = 1; G.fadeThen = fn; G.fadeDur = dur || 0.35; G.fadeT = 0;
}
function fadeUpdate(dt){
  if (!G.fadeDir) return;
  G.fadeT += dt;
  const p = Math.min(1, G.fadeT / G.fadeDur);
  if (G.fadeDir === 1){
    G.fade = p * 16;
    if (p >= 1){ const f = G.fadeThen; G.fadeThen = null; G.fadeDir = -1; G.fadeT = 0; if (f) f(); }
  } else {
    G.fade = (1 - p) * 16;
    if (p >= 1){ G.fadeDir = 0; G.fade = 0; }
  }
}

/* ---------- the Looker patrolling the room ---------- */
const Looker = { x:0, y:0, wp:0, t:0, facing:'down', showPath:0, barked:false };
function lookerInit(room){
  const w = room.waypoints;
  if (!w){ Looker.x = -99; Looker.y = -99; return; }
  Looker.x = w[0][0]; Looker.y = w[0][1]; Looker.wp = 1; Looker.showPath = 1.5; Looker.barked = false;
}
function lookerUpdate(dt, room){
  const w = room.waypoints; if (!w) return;
  if (Looker.showPath > 0) Looker.showPath -= dt;
  const t = w[Looker.wp];
  const dx = t[0] - Looker.x, dy = t[1] - Looker.y;
  const d = Math.hypot(dx, dy);
  if (d < 1.5){ Looker.wp = (Looker.wp + 1) % w.length; return; }
  const sp = 40 * dt;
  Looker.x += dx / d * sp; Looker.y += dy / d * sp;
  Looker.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}
/* 60-degree, 72px cone drawn on the floor */
function inCone(x, y){
  const dx = x - Looker.x, dy = y - Looker.y;
  const d = Math.hypot(dx, dy);
  if (d > 72 || d < 1) return false;
  const fv = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[Looker.facing];
  const dot = (dx/d) * fv[0] + (dy/d) * fv[1];
  return dot > 0.866;                                  // half-angle 30 deg
}
function drawCone(c){
  if (Looker.x < 0) return;
  const fv = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[Looker.facing];
  for (let r = 8; r < 72; r += 2){
    const halfw = Math.round(r * 0.577);
    for (let s = -halfw; s <= halfw; s += 2){
      const px = Math.round(Looker.x + fv[0]*r - fv[1]*s);
      const py = Math.round(Looker.y + fv[1]*r + fv[0]*s);
      if ((px + py) % 4 === 0) rect(c, px, py, 1, 1, UI.GHOST);
    }
  }
}
function drawLooker(c){
  if (Looker.x < 0) return;
  const x = Math.round(Looker.x) - 7, y = Math.round(Looker.y) - 24;
  const bob = Math.sin(performance.now() / 420) > 0 ? 0 : 1;
  rect(c, x+1, y+bob, 13, 24, UI.BLACK);
  rect(c, x+2, y+1+bob, 11, 22, UI.DIM);
  rect(c, x+4, y+4+bob, 7, 5, UI.BLACK);
  rect(c, x+5, y+5+bob, 2, 2, UI.WHITE);
  rect(c, x+9, y+5+bob, 2, 2, UI.WHITE);
  rect(c, x+3, y+14+bob, 9, 1, UI.BLACK);
}

/* ---------- the Blank's world sprite (baked from the paint grid) ---------- */
let blankSprite = null, blankDirty = true;
function bakeBlank(){
  const m = maskFor(G.shape, G.pose);
  const cv = document.createElement('canvas');
  cv.width = m.w; cv.height = m.h;
  const c = cv.getContext('2d'); nosmooth(c);
  for (const cell of m.cells){
    c.fillStyle = PAL[G.grid[cell.i]];
    c.fillRect(cell.cx, cell.cy, 1, 1);
  }
  blankSprite = cv; blankDirty = false;
}
/* silhouette outline: only on boundary cells that differ from the world behind them */
function drawBlank(c, wx, wy, scene, outline){
  if (blankDirty) bakeBlank();
  const m = maskFor(G.shape, G.pose);
  c.drawImage(blankSprite, Math.round(wx), Math.round(wy));
  if (!outline || !scene) return;
  for (const cell of m.cells){
    if (!cell.edge) continue;
    const bx = Math.round(wx) + cell.cx, by = Math.round(wy) + cell.cy;
    const mine = G.grid[cell.i];
    // compare against the world pixel just outside the silhouette
    for (const [ox,oy] of [[-1,0],[1,0],[0,-1],[0,1]]){
      if (m.liveAt(cell.cx+ox, cell.cy+oy)) continue;
      const wcol = scene.at(bx+ox, by+oy);
      if (matchRaw(mine, wcol) < 0.55) rect(c, bx, by, 1, 1, PAL[mine]);
    }
  }
}

/* ---------- overworld ---------- */
const OW = { hint:'', hintT:0, prompt:null };

function enterRoom(key, spawn){
  G.room = key;
  const room = ROOMS[key];
  getScene(key);
  const st = spawn || room.start;
  G.px = st[0]; G.py = st[1];
  lookerInit(room);
  OW.prompt = null;
}

function owUpdate(dt){
  const room = ROOMS[G.room], scene = getScene(G.room);
  if (Dlg.active){ Dlg.update(dt); return; }
  if (room.waypoints) lookerUpdate(dt, room);

  const [ax, ay] = axis();
  G.running = down('no');
  const sp = (G.running ? 160 : 90) * dt;
  const d = topDir(); if (d) G.facing = d;

  const feetW = 12, feetH = 8;
  const canStand = (x, y) => {
    const x0 = Math.round(x - feetW/2), y0 = Math.round(y - feetH);
    for (let yy = y0; yy < y0 + feetH; yy++)
      for (let xx = x0; xx < x0 + feetW; xx++)
        if (scene.solidAt(xx, yy)) return false;
    return x0 >= 0 && x0 + feetW <= VW && y0 >= 0 && y0 + feetH <= VH;
  };
  let nx = G.px + ax * sp, ny = G.py;
  if (ax && canStand(nx, ny)) G.px = nx;
  ny = G.py + ay * sp;
  if (ay && canStand(G.px, ny)) G.py = ny;
  if (ax || ay){ G.animDist += Math.abs(ax*sp) + Math.abs(ay*sp); G.animIdle = 0; }
  else { G.animIdle += dt; }

  // the Looker's cone costs prep time, once
  if (room.waypoints && !G.coneHit && inCone(G.px, G.py - 6)){
    G.coneHit = true;
    OW.hint = '-15s  ' + (LOOKERS[room.looker] ? LOOKERS[room.looker].coneBark : 'SEEN.');
    OW.hintT = 2.4;
    Audio_.sfx('bad');
  }

  // interaction probe
  OW.prompt = null;
  const fv = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[G.facing];
  const probe = { x: G.px - 6 + fv[0]*12, y: G.py - 12 + fv[1]*12, w:12, h:12 };
  let best = null, bestOv = 0;
  const cands = [];
  for (const p of (room.props || [])) cands.push({ kind:'prop', r:p, p });
  for (const s of (room.spots || [])) cands.push({ kind:'spot', r:{ x:s.walk[0]-9, y:s.walk[1]-16, w:18, h:18 }, p:s });
  for (const cd of cands){
    const ov = Math.max(0, Math.min(probe.x+probe.w, cd.r.x+cd.r.w) - Math.max(probe.x, cd.r.x)) *
               Math.max(0, Math.min(probe.y+probe.h, cd.r.y+cd.r.h) - Math.max(probe.y, cd.r.y));
    if (ov > bestOv){ bestOv = ov; best = cd; }
  }
  if (best) OW.prompt = best;

  if (OW.hintT > 0) OW.hintT -= dt;

  if (hit('ok') && best){
    if (best.kind === 'spot'){
      if (G.spot === best.p) { readyUp(); }
      else { G.spot = best.p; G.st = 'EDITOR'; edOpen(); Audio_.sfx('confirm'); }
      return;
    }
    const p = best.p;
    if (p.talk) talkProp(p.talk);
  }
}

function owDraw(c){
  const room = ROOMS[G.room], scene = getScene(G.room);
  c.drawImage(scene.cv, 0, 0);
  if (room.waypoints && Looker.showPath > 0){
    const w = room.waypoints;
    for (let i = 0; i < w.length; i++){
      const a = w[i], b = w[(i+1) % w.length];
      const steps = Math.hypot(b[0]-a[0], b[1]-a[1]) / 5 | 0;
      for (let k = 0; k <= steps; k++){
        if (k % 2) continue;
        rect(c, a[0] + (b[0]-a[0]) * k/steps, a[1] + (b[1]-a[1]) * k/steps, 1, 1, UI.WHITE);
      }
    }
  }
  if (room.waypoints) drawCone(c);

  // spot markers
  for (const s of (room.spots || [])){
    const on = OW.prompt && OW.prompt.kind === 'spot' && OW.prompt.p === s;
    const mine = G.spot === s;
    frame(c, s.coverX-1, s.coverY-1, s.coverW+2, s.coverH+2, 1,
          on ? UI.GOLD : mine ? UI.CYAN : UI.GHOST);
    if (mine) txt(c, 'YOURS', s.coverX, s.coverY - 10, UI.CYAN);
  }

  const m = maskFor(G.shape, G.pose);
  drawBlank(c, G.px - m.w/2, G.py - m.h, scene, true);
  if (room.waypoints) drawLooker(c);

  // header
  rect(c, 0, 0, VW, 11, UI.BLACK);
  txt(c, room.label, 4, 2, UI.DIM);
  if (!room.hub){
    const t = Math.max(0, Math.ceil(G.prep));
    txt(c, 'PAINT ' + fmtClock(t), 254, 2, t < 11 ? UI.SOUL : UI.WHITE);
    txt(c, 'R' + (G.round+1) + '/N' + G.night, 96, 2, UI.DIM);
    if (G.spot) txt(c, 'CAMO ' + computeScore().total, 148, 2, UI.GOLD);
  }

  if (OW.hintT > 0){ rect(c, 0, 226, VW, 12, UI.BLACK); txtC(c, OW.hint, 160, 228, UI.GOLD); }
  else if (OW.prompt){
    rect(c, 0, 226, VW, 12, UI.BLACK);
    const p = OW.prompt;
    const label = p.kind === 'spot'
      ? (G.spot === p.p ? ('[Z] HIDE HERE  —  ' + p.p.name) : ('[Z] PAINT FOR: ' + p.p.name))
      : ('[Z] ' + p.p.name);
    txtC(c, label, 160, 228, UI.WHITE);
  }
  Dlg.draw(c);
}

const fmtClock = t => Math.floor(t/60) + ':' + String(Math.floor(t%60)).padStart(2,'0');
