/* ---------- THE HIDE: the seeker walks the room and checks the hiding places ---------- */
const HIDE = {
  t:0, len:75, susp:0, breath:100, found:false, over:false, overT:0,
  sk:{ x:0, y:0, fx:0, fy:1, mode:'WALK', target:null, pauseT:0, order:[], oi:0, pass:1 },
  rivals:[], msgs:[], stare:0, relocT:0, doubleT:0, lastInspect:null, canMove:false,
};

function hideBegin(){
  const room = ROOMS[G.room];
  const b = computeScore(); G.bars = b; G.score = b.total;
  HIDE.t = 0; HIDE.len = room.hideLen || 75;
  HIDE.susp = 0; HIDE.breath = 100; HIDE.found = false; HIDE.over = false; HIDE.overT = 0;
  HIDE.msgs = []; HIDE.stare = 0; HIDE.relocT = 0; HIDE.doubleT = 0; HIDE.lastInspect = null;

  // the other Blanks hide too, and are scored by the same yardstick
  const others = room.spots.filter(s => s !== G.spot);
  HIDE.rivals = RIVAL_NAMES.map((n, i) => ({
    name: n,
    score: n === 'SPLOTCH' ? 14 + ((G.round * 7 + i * 13) % 12)
                           : 44 + ((G.round * 11 + i * 29) % 40),
    spot: others[(i * 2 + G.round) % others.length],
    found: false,
  }));

  // the seeker checks every spot, in a shuffled order
  const order = room.spots.map((s, i) => i);
  for (let i = order.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  const sk = HIDE.sk;
  sk.order = order; sk.oi = 0; sk.pass = 1; sk.mode = 'WALK'; sk.pauseT = 0;
  sk.x = room.start[0]; sk.y = room.start[1] + 8;
  sk.target = room.spots[order[0]];
  G.st = 'HIDE';
  Audio_.music('hunt', 92 + (100 - G.score) * 0.35);
  pushMsg(LOOKERS[room.looker].name + ' IS LOOKING.');
}
function pushMsg(s){ HIDE.msgs.unshift({ s, t: 3.2 }); if (HIDE.msgs.length > 3) HIDE.msgs.pop(); }

/* is the seeker's cone on a point? */
function skSees(x, y){
  const sk = HIDE.sk;
  const dx = x - sk.x, dy = y - sk.y, d = Math.hypot(dx, dy);
  if (d > 84 || d < 1) return 0;
  const dot = (dx/d) * sk.fx + (dy/d) * sk.fy;
  if (dot < 0.80) return 0;
  return 1 - d / 84;                                   // 0..1, closer = stronger
}

function hideUpdate(dt){
  if (HIDE.over){
    HIDE.overT += dt;
    if (Dlg.active){ Dlg.update(dt); return; }
    if (HIDE.overT > 0.6 && hit('ok')) resultsBegin();
    return;
  }
  if (Dlg.active){ Dlg.update(dt); return; }

  HIDE.t += dt;
  const room = ROOMS[G.room], sk = HIDE.sk;
  const myAnchor = G.spot.anchors[G.pose];
  const myX = myAnchor[0] + G.gridW/2, myY = myAnchor[1] + G.gridH/2;

  // ---- breath ----
  const holding = down('no') && HIDE.breath > 0;
  if (holding){ HIDE.breath = Math.max(0, HIDE.breath - 34*dt); }
  else HIDE.breath = Math.min(100, HIDE.breath + 14*dt);

  // ---- relocate: only when it is not looking anywhere near you ----
  const seen = skSees(myX, myY);
  const inspectingMe = sk.mode === 'INSPECT' && sk.target === G.spot;
  // you may only slip away when it is far off AND not stood there studying your spot
  const canMove = !seen && !inspectingMe && Math.hypot(sk.x - myX, sk.y - myY) > 92;
  HIDE.canMove = canMove;
  if (HIDE.relocT > 0) HIDE.relocT -= dt;
  if (canMove && HIDE.relocT <= 0 && hit('ok')){
    const list = room.spots;
    let i = list.indexOf(G.spot);
    for (let k = 1; k <= list.length; k++){
      const cand = list[(i + k) % list.length];
      if (HIDE.rivals.some(r => !r.found && r.spot === cand)) continue;
      G.spot = cand; break;
    }
    const b = computeScore(); G.bars = b; G.score = b.total;
    HIDE.relocT = 1.2; HIDE.susp = Math.min(100, HIDE.susp + 8);
    pushMsg('YOU MOVED TO ' + G.spot.name + '.');
    Audio_.sfx('brush');
  }

  // ---- seeker ----
  if (sk.mode === 'WALK'){
    const t = sk.target;
    const tx = t.walk[0], ty = t.walk[1];
    const dx = tx - sk.x, dy = ty - sk.y, d = Math.hypot(dx, dy);
    if (d < 2){
      sk.mode = 'INSPECT'; sk.pauseT = 0;
      // face the spot it came to check
      const cdx = (t.coverX + t.coverW/2) - sk.x, cdy = (t.coverY + t.coverH/2) - sk.y;
      const cd = Math.hypot(cdx, cdy) || 1; sk.fx = cdx/cd; sk.fy = cdy/cd;
      HIDE.lastInspect = t;
    } else {
      const sp = 46 * dt;
      sk.x += dx/d * sp; sk.y += dy/d * sp;
      sk.fx = dx/d; sk.fy = dy/d;
    }
  } else if (sk.mode === 'INSPECT'){
    sk.pauseT += dt;
    const t = sk.target;
    // rivals hidden here get resolved
    for (const r of HIDE.rivals){
      if (r.found || r.spot !== t) continue;
      if (sk.pauseT > 1.1){
        const bar = 34 + HIDE.t * 0.55 + (sk.pass - 1) * 18;
        if (r.score < bar){
          r.found = true;
          pushMsg(r.name + ' WAS FOUND.');
          Audio_.sfx('bad');
        }
      }
    }
    // you
    if (t === G.spot){
      HIDE.stare = 1;
      // a great paint job is looked straight at and survives it; a bad one does not
      const miss = Math.max(0, 1 - G.score/100);
      const base = 54 * Math.pow(miss, 1.6) + (sk.pass - 1) * 3;
      let rate = base;
      if (holding) rate *= 0.42;
      HIDE.susp += rate * dt;
      if (down('left') || down('right') || down('up') || down('down')){
        HIDE.susp += 30 * dt;                          // flinching is fatal
      }
    }
    if (sk.pauseT > 2.2){
      sk.mode = 'WALK'; sk.oi++;
      if (sk.oi >= sk.order.length){ sk.oi = 0; sk.pass++; }
      sk.target = room.spots[sk.order[sk.oi]];
      // a near miss makes it come back
      if (t === G.spot && HIDE.susp > 55 && HIDE.doubleT === 0){
        HIDE.doubleT = 1; sk.target = t; sk.oi--;
        pushMsg('...IT IS COMING BACK.');
      }
    }
  }

  // passive attention while it merely walks past
  if (sk.mode === 'WALK' && seen > 0){
    let rate = 20 * Math.pow(Math.max(0, 1 - G.score/100), 1.6) * seen;
    if (holding) rate *= 0.42;
    HIDE.susp += rate * dt;
    HIDE.stare = Math.max(HIDE.stare, seen);
  } else if (sk.mode !== 'INSPECT' || sk.target !== G.spot){
    HIDE.susp -= 4 * dt;
    HIDE.stare = Math.max(0, HIDE.stare - dt * 2);
  }
  HIDE.susp = Math.max(0, HIDE.susp);

  for (const m of HIDE.msgs) m.t -= dt;
  HIDE.msgs = HIDE.msgs.filter(m => m.t > 0);

  if (HIDE.susp >= 100) return hideEnd(true);
  if (HIDE.t >= HIDE.len) return hideEnd(false);
}

function hideEnd(found){
  HIDE.found = found; HIDE.over = true; HIDE.overT = 0;
  G.st = 'HIDE';
  Audio_.music(null);
  const L = LOOKERS[ROOMS[G.room].looker];
  if (found){
    G.caught++;
    Audio_.sfx('ko');
    Dlg.queue(L.capture, { voice:L.voice });
  } else {
    G.survived++;
    Audio_.sfx('win');
    const cat = worstCategory(G.bars);
    const line = G.score >= 88 ? L.barks.great : G.score >= 74 ? L.barks.near
               : (L.barks[cat] || L.barks.PAINT);
    Dlg.queue([{ t: line }, ...L.depart], { voice:L.voice, mono:false });
  }
}

/* ---------- drawing ---------- */
function hideDraw(c){
  const room = ROOMS[G.room], sc = getScene(G.room), sk = HIDE.sk;
  c.drawImage(sc.cv, 0, 0);

  // every hidden Blank is actually in the room
  for (const r of HIDE.rivals){
    if (r.found) continue;
    drawRival(c, r);
  }
  if (blankDirty) bakeBlank();
  const a = G.spot.anchors[G.pose];
  c.drawImage(blankSprite, a[0], a[1]);

  drawSkCone(c);
  drawSeekerWorld(c, sk.x, sk.y, LOOKERS[room.looker]);

  // found rivals get a marker where they were
  for (const r of HIDE.rivals){
    if (!r.found) continue;
    const ra = r.spot.anchors[r.spot.wantPose];
    txt(c, 'X', ra[0] + 4, ra[1] + 4, UI.SOUL);
  }

  // ---- HUD ----
  rect(c, 0, 0, VW, 22, UI.BLACK);
  txt(c, 'SUSPICION', 4, 2, UI.WHITE);
  rect(c, 4, 12, 108, 7, UI.BLOOD);
  const sw = Math.round(108 * Math.min(100, HIDE.susp) / 100);
  const hot = HIDE.susp >= 80 && (frameCount % 6 < 3);
  rect(c, 4, 12, sw, 7, hot ? UI.WHITE : (HIDE.susp > 55 ? UI.SOUL : UI.GOLD));

  txt(c, 'BREATH', 124, 2, HIDE.breath > 25 ? UI.DIM : UI.SOUL);
  rect(c, 124, 12, 64, 7, UI.BLOOD);
  rect(c, 124, 12, Math.round(64 * HIDE.breath / 100), 7, UI.CYAN);

  const left = Math.max(0, Math.ceil(HIDE.len - HIDE.t));
  txt(c, 'TIME ' + fmtClock(left), 202, 2, UI.WHITE);
  const alive = HIDE.rivals.filter(r => !r.found).length + 1;
  txt(c, 'HIDING ' + alive + '/' + (HIDE.rivals.length + 1), 202, 12, UI.DIM);
  txt(c, 'CAMO ' + G.score, 268, 2, UI.GOLD);

  // messages
  for (let i = 0; i < HIDE.msgs.length; i++){
    const s2 = HIDE.msgs[i].s, y = 25 + i*11;
    rect(c, 2, y - 1, txtW(s2) + 4, 10, UI.BLACK);
    txt(c, s2, 4, y, i === 0 ? UI.WHITE : UI.GHOST);
  }

  // the tense bit
  if (HIDE.stare > 0.05 && !HIDE.over){
    const y = 200;
    rect(c, 0, y, VW, 12, UI.BLACK);
    txtC(c, HIDE.sk.mode === 'INSPECT' && HIDE.sk.target === G.spot
            ? 'IT IS LOOKING RIGHT AT YOU. HOLD STILL.'
            : 'IT IS LOOKING THIS WAY.', 160, y + 2, UI.SOUL);
    if (frameCount % 30 < 15) frame(c, 0, 0, VW, VH, 1, UI.SOUL);
  }

  rect(c, 0, 226, VW, 14, UI.BLACK);
  if (HIDE.over){
    txtC(c, HIDE.found ? 'FOUND.' : 'NOT FOUND.', 160, 228, HIDE.found ? UI.SOUL : UI.GOLD);
  } else {
    txtC(c, 'X HOLD BREATH' + (HIDE.canMove ? '    Z MOVE SPOTS' : '    DO NOT MOVE'),
         160, 228, UI.DIM);
  }
  Dlg.draw(c);
}
function drawSkCone(c){
  const sk = HIDE.sk;
  // brighter while it has actually stopped to look at something
  const staring = sk.mode === 'INSPECT';
  const col = staring ? UI.WHITE : UI.GHOST;
  const gap = staring ? 3 : 4;
  for (let r = 10; r < 84; r += 2){
    const halfw = Math.round(r * 0.62);
    for (let s = -halfw; s <= halfw; s += 2){
      const px = Math.round(sk.x + sk.fx*r - sk.fy*s);
      const py = Math.round(sk.y + sk.fy*r + sk.fx*s);
      if (px < 0 || py < 0 || px >= VW || py >= VH) continue;
      if ((px + py) % gap === 0) rect(c, px, py, 1, 1, col);
    }
  }
}
function drawSeekerWorld(c, x, y, L){
  x = Math.round(x); y = Math.round(y);
  const bob = HIDE.sk.mode === 'WALK' ? (Math.floor(HIDE.t * 6) % 2) : 0;
  const col = L.worldCol || UI.DIM;
  rect(c, x-8, y-26+bob, 16, 26, UI.BLACK);
  rect(c, x-7, y-25+bob, 14, 24, col);
  rect(c, x-5, y-21+bob, 10, 6, UI.BLACK);
  rect(c, x-4, y-20+bob, 3, 3, UI.WHITE);
  rect(c, x+2, y-20+bob, 3, 3, UI.WHITE);
  rect(c, x-9, y-28+bob, 18, 4, UI.BLACK);
  rect(c, x-7, y-27+bob, 14, 2, L.hatCol || UI.GOLD);
  rect(c, x-6, y-2, 5, 3, UI.BLACK); rect(c, x+2, y-2, 5, 3, UI.BLACK);
}
function drawRival(c, r){
  const m = maskFor(r.spot.wantShape, r.spot.wantPose);
  const a = r.spot.anchors[r.spot.wantPose];
  const sc = getScene(G.room);
  // rivals are painted about as well as they scored
  for (const cell of m.cells){
    const wall = sc.at(a[0]+cell.cx, a[1]+cell.cy);
    const good = ((cell.cx * 7 + cell.cy * 13 + r.score) % 100) < r.score;
    rect(c, a[0]+cell.cx, a[1]+cell.cy, 1, 1, good ? PAL[wall] : PAL[WHITE_IDX]);
  }
}
const RIVAL_NAMES = ['TWOCOAT','HALFTONE','SPLOTCH'];
