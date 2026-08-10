/* ---------- title ---------- */
const TITLE = { t:0 };
function titleReset(){
  TITLE.t = 0;
  G.round = 0; G.night = 1; G.caught = 0; G.survived = 0; G.history = [];
  G.tags = new Set(); G.best = 0; G.seenIntro = {};
  G.slots = new Uint8Array([31,31,31,31,31,31,31,31]);
  G.slotTag = ['','','','','','','',''];
  G.spot = null;
  setPose('BLOB','STAND');
  enterRoom('CH1');
}
function titleUpdate(dt){
  TITLE.t += dt;
  if (hit('ok')){
    Dlg.queue([{t:'YOU ARE A BLANK. PURE WHITE, STRAIGHT OUT OF THE TIN.'},
               {t:'THE RULES ARE SIMPLE. PAINT YOURSELF TO MATCH SOMETHING.'},
               {t:'THEN GET INTO IT AND DO NOT MOVE WHILE THEY LOOK.'}],
              { voice:VOICE.plain, onEnd(){ newRound(); } });
    G.st = 'PAINT';
  }
}
function titleDraw(c){
  rect(c, 0, 0, VW, VH, UI.BLACK);
  const sc = getScene('CH1');
  c.drawImage(sc.cv, 0, 56, 320, 128, 0, 56, 320, 128);
  wash(c, 9);
  txtC(c, 'WET PAINT', 160, 34, UI.WHITE, 3);
  txtC(c, 'PAINT YOURSELF. HOLD STILL.', 160, 68, UI.GOLD);
  // a Blank half-painted into the brick
  const bob = Math.round(Math.sin(TITLE.t * 2));
  for (let y = 0; y < 20; y++) for (let x = 0; x < 11; x++){
    if (x === 0 && y === 0) continue;
    const painted = y > 9;
    rect(c, 155 + x, 118 + y + bob, 1, 1, painted ? PAL[1 + (x % 2)] : PAL[31]);
  }
  if (Math.floor(TITLE.t * 2) % 2) txtC(c, 'PRESS Z', 160, 182, UI.WHITE);
  txtC(c, 'ARROWS MOVE   Z CONFIRM   X CANCEL / HOLD BREATH', 160, 208, UI.DIM);
  txtC(c, 'AN ORIGINAL GAME  —  NO ASSETS, NO NETWORK', 160, 222, UI.GHOST);
  Dlg.draw(c);
}

/* ---------- pause ---------- */
let paused = false;
function pauseDraw(c){
  wash(c, 12);
  panel(c, 84, 78, 152, 84, 2, UI.WHITE);
  txtC(c, 'PAUSED', 160, 90, UI.GOLD);
  txtC(c, 'Z  RESUME', 160, 110, UI.WHITE);
  txtC(c, 'M  ' + (Audio_.muted ? 'UNMUTE' : 'MUTE'), 160, 124, UI.WHITE);
  txtC(c, 'X  QUIT TO TITLE', 160, 138, UI.DIM);
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
  if (hit('pause') && (G.st === 'PAINT' || G.st === 'HIDE') && !Dlg.active){ paused = true; return; }

  switch(G.st){
    case 'TITLE':  titleUpdate(dt); break;
    case 'PAINT':
      if (!Dlg.active && G.spot !== null) { /* timer only runs once you can act */ }
      if (!Dlg.active){
        G.prep -= dt;
        if (G.prep <= 0){ G.prep = 0; if (G.spot) { readyUp(); break; }
                          else { G.spot = ROOMS[G.room].spots[0]; readyUp(); break; } }
      }
      owUpdate(dt); break;
    case 'EDITOR':
      if (!Dlg.active){
        G.prep -= dt;
        if (G.prep <= 0){ G.prep = 0; closeEditor(); readyUp(); break; }
      }
      edUpdate(dt); break;
    case 'HIDE':   hideUpdate(dt); break;
    case 'RESULT': resultsUpdate(dt); break;
  }
  shakeUpdate(dt);
  for (const k in buffered) if (buffered[k] > 0) buffered[k] -= dt;
}
function render(){
  switch(G.st){
    case 'TITLE':  titleDraw(ctx); break;
    case 'PAINT':  owDraw(ctx); break;
    case 'EDITOR': edDraw(ctx); break;
    case 'HIDE':   hideDraw(ctx); break;
    case 'RESULT': resultsDraw(ctx); break;
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
  for (const k of MAPS) getScene(k);
  enterRoom('CH1');
  G.st = 'TITLE';
  const h = location.hash;
  const m = h.match(/^#m(\d)$/);
  if (m){
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= MAPS.length){ G.round = n - 1; newRound(); }
  }
  if (h === '#paint'){
    G.round = 0; newRound();
    G.spot = ROOMS.CH1.spots[0]; G.st = 'EDITOR'; edOpen();
  }
  requestAnimationFrame(loop);
  if (location.hash === '#smoke') runSmoke();
}
