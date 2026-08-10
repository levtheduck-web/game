/* ---------- title ---------- */
const TITLE = { t:0 };
function titleReset(){
  TITLE.t = 0;
  G.chapter = 0; G.chapterScores = []; G.grades = []; G.caught = 0;
  G.tags = new Set(); G.best = 0; G.style = 0; G.seenIntro = {};
  G.slots = new Uint8Array([31,31,31,31,31,31,31,31]);
  G.slotTag = ['','','','','','','',''];
  setPose('BLOB','STAND');
  enterRoom('HUB');
}
function titleUpdate(dt){
  TITLE.t += dt;
  if (hit('ok')){
    G.st = 'OVERWORLD';
    Audio_.music('hub', 96);
    Dlg.queue([{t:'YOU ARE A BLANK. THEY MAKE YOU WHITE AND THEY ASSIGN YOU A COLOUR LATER.'},
               {t:'YOURS WAS DUE ON TUESDAY. YOU HAVE DECIDED TO CHOOSE YOUR OWN.'},
               {t:'FIVE ROOMS BETWEEN HERE AND THE DOOR. SOMEONE IS LOOKING IN EACH OF THEM.'},
               {t:'TALK TO SIENNA. THEN TAKE THE DOOR.'}], { voice:VOICE.plain });
  }
}
function titleDraw(c){
  rect(c, 0, 0, VW, VH, UI.BLACK);
  const sc = getScene('CH1');
  c.drawImage(sc.cv, 0, 60, 320, 120, 0, 60, 320, 120);
  wash(c, 9);
  txtC(c, 'WET PAINT', 160, 40, UI.WHITE, 3);
  txtC(c, 'HIDE BY HAND', 160, 74, UI.GOLD);
  // a Blank half-painted into the brick
  const bob = Math.round(Math.sin(TITLE.t * 2));
  for (let y = 0; y < 20; y++) for (let x = 0; x < 11; x++){
    if (x === 0 && y === 0) continue;
    const painted = y > 9;
    rect(c, 155 + x, 120 + y + bob, 1, 1, painted ? PAL[1 + (x % 2)] : PAL[31]);
  }
  if (Math.floor(TITLE.t * 2) % 2) txtC(c, 'PRESS Z', 160, 186, UI.WHITE);
  txtC(c, 'ARROWS MOVE   Z CONFIRM   X CANCEL   M MUTE', 160, 210, UI.DIM);
  txtC(c, 'AN ORIGINAL GAME  —  NO ASSETS, NO NETWORK', 160, 224, UI.GHOST);
}

/* ---------- HOLDIN: the cut to black before the sweep ---------- */
function holdinUpdate(dt){
  G.holdT += dt;
  if (G.holdT >= 2.0){ sweepBegin(); }
}
function holdinDraw(c){
  const sc = getScene(G.room), a = G.spot.anchors[G.pose];
  c.drawImage(sc.cv, 0, 0);
  if (blankDirty) bakeBlank();
  c.drawImage(blankSprite, a[0], a[1]);
  wash(c, Math.min(14, G.holdT / 2.0 * 18));
  if (G.holdT > 0.9) txtC(c, GRADEWORD(G.score), 160, 112, UI.WHITE, 2);
  if (G.holdT > 1.4) txtC(c, 'FOOTSTEPS.', 160, 136, UI.DIM);
}

/* ---------- ENTRY: 0.9s drop into the encounter ---------- */
function entryUpdate(dt){
  G.entryT += dt;
  if (G.entryT >= 0.9){ G.st = 'PREP'; }
}
function entryDraw(c){
  const p = G.entryT / 0.9;
  const sc = getScene(G.room);
  c.drawImage(sc.cv, 0, 0);
  wash(c, Math.min(16, p * 22));
  if (p > 0.45){
    const q = (p - 0.45) / 0.55;
    const w = Math.round(246 * q), h = Math.round(78 * q);
    frame(c, 160 - w/2 - 5, 140 - h/2 - 5, w + 10, h + 10, 5, UI.WHITE);
  }
}

/* ---------- pause ---------- */
let paused = false;
function pauseDraw(c){
  wash(c, 12);
  panel(c, 84, 78, 152, 84, 2, UI.WHITE);
  txtC(c, 'PAUSED', 160, 90, UI.GOLD);
  txtC(c, 'Z  RESUME', 160, 110, UI.WHITE);
  txtC(c, 'M  ' + (Audio_.muted ? 'UNMUTE' : 'MUTE'), 160, 124, UI.WHITE);
  txtC(c, 'X  GIVE UP', 160, 138, UI.DIM);
}

/* ---------- main loop ---------- */
let frameCount = 0, last = 0, acc = 0;
function update(dt){
  fadeUpdate(dt);
  if (G.fadeDir) return;
  if (paused){
    if (hit('ok') || hit('pause')) paused = false;
    if (hit('no')){ paused = false; G.st = 'TITLE'; titleReset(); }
    return;
  }
  if (hit('pause') && ['OVERWORLD','PREP','SWEEP'].indexOf(G.st) >= 0 && !Dlg.active && G.st !== 'EDITOR'){
    paused = true; return;
  }
  switch(G.st){
    case 'TITLE':     titleUpdate(dt); break;
    case 'OVERWORLD': owUpdate(dt); break;
    case 'ENTRY':     entryUpdate(dt); break;
    case 'PREP':      prepUpdate(dt); break;
    case 'EDITOR':    G.prep -= dt; if (G.prep <= 0){ G.prep = 0; closeEditor(); commitHold(); }
                      else edUpdate(dt); break;
    case 'HOLDIN':    holdinUpdate(dt); break;
    case 'SWEEP':     sweepUpdate(dt); break;
    case 'TOUCHUP':   touchUpdate(dt); break;
    case 'REVEAL':    revealUpdate(dt); break;
    case 'RESULTS':   resultsUpdate(dt); break;
    case 'ENDING':    endingUpdate(dt); break;
  }
  shakeUpdate(dt);
  for (const k in buffered) if (buffered[k] > 0) buffered[k] -= dt;
}
function render(){
  switch(G.st){
    case 'TITLE':     titleDraw(ctx); break;
    case 'OVERWORLD': owDraw(ctx); break;
    case 'ENTRY':     entryDraw(ctx); break;
    case 'PREP':      prepDraw(ctx); break;
    case 'EDITOR':    edDraw(ctx); break;
    case 'HOLDIN':    holdinDraw(ctx); break;
    case 'SWEEP':     sweepDraw(ctx); break;
    case 'TOUCHUP':   touchDraw(ctx); break;
    case 'REVEAL':    revealDraw(ctx); break;
    case 'RESULTS':   resultsDraw(ctx); break;
    case 'ENDING':    endingDraw(ctx); break;
  }
  if (paused) pauseDraw(ctx);
  if (G.fade > 0) wash(ctx, G.fade);
  vctx.fillStyle = '#000'; vctx.fillRect(0, 0, view.width, view.height);
  vctx.drawImage(buf, 0, 0, VW, VH, shakeX*SCALE, shakeY*SCALE, VW*SCALE, VH*SCALE);
}
function loop(now){
  requestAnimationFrame(loop);
  if (!last) last = now;
  let dt = (now - last) / 1000; last = now;
  acc += Math.min(dt, 0.25);
  let steps = 0;
  while (acc >= STEP && steps < 5){
    if (hitstop > 0) hitstop -= STEP; else update(STEP);
    acc -= STEP; steps++; frameCount++;
  }
  render();
}

/* ---------- boot ---------- */
function boot(){
  bakeDither();
  resize();
  setPose('BLOB','STAND');
  for (const k in ROOMS) getScene(k);
  enterRoom('HUB');
  G.st = 'TITLE';
  const h = location.hash;
  if (h.startsWith('#c')){
    const n = parseInt(h.slice(2), 10);
    if (n >= 1 && n <= CHAPTERS.length){
      G.chapter = n - 1; G.st = 'OVERWORLD'; enterChapterFromHub();
    }
  }
  if (h === '#paint'){
    G.st = 'OVERWORLD'; G.chapter = 0;
    const room = ROOMS.CH1; G.prep = room.prep; G.maxhp = room.maxhp; G.hp = room.maxhp;
    enterRoom('CH1'); beginPrep(room.spots[0]); G.st = 'EDITOR'; edOpen();
  }
  requestAnimationFrame(loop);
  if (location.hash === '#smoke') runSmoke();
}
