/* ---------- the reveal beat, then the results ---------- */
const RV = { t:0, walk:0, flash:0, stage:0 };
function revealBegin(){
  RV.t = 0; RV.walk = -30; RV.flash = 0; RV.stage = 0;
  G.st = 'REVEAL';
  Audio_.music('reveal', 84);
  const L = LOOKERS[ROOMS[G.room].looker];
  const cat = worstCategory(G.bars);
  const line = G.score >= 88 ? L.barks.great
             : G.score >= 74 ? L.barks.near
             : (L.barks[cat] || L.barks.PAINT);
  Dlg.queue([{ t: line }], { voice:L.voice, mono:true, colour:UI.DIM, onEnd(){ RV.stage = 1; RV.flash = 1.2; } });
}
function revealUpdate(dt){
  RV.t += dt; RV.walk += 40 * dt;
  Dlg.update(dt);
  if (RV.stage === 1){
    RV.flash -= dt;
    if (RV.flash <= 0){
      const L = LOOKERS[ROOMS[G.room].looker];
      RV.stage = 2;
      Dlg.queue(L.depart, { voice:L.voice, onEnd(){ resultsBegin(); } });
    }
  }
}
function revealDraw(c){
  const sc = getScene(G.room), a = G.spot.anchors[G.pose];
  c.drawImage(sc.cv, 0, 0);
  if (blankDirty) bakeBlank();
  c.drawImage(blankSprite, a[0], a[1]);
  const m = maskFor(G.shape, G.pose);
  if (RV.stage >= 1 && Math.floor(RV.flash * 8) % 2)
    frame(c, a[0]-1, a[1]-1, m.w+2, m.h+2, 1, PAL[2]);
  // the Looker strolls past
  const lx = Math.min(VW + 20, RV.walk);
  Looker.x = lx; Looker.y = 196; Looker.facing = 'right';
  drawLooker(c);
  Dlg.draw(c);
}

/* ---------- results ---------- */
const RES = { heat:false, t:0, bars:0, rivals:[] };
function resultsBegin(){
  G.st = 'RESULTS'; RES.heat = false; RES.t = 0; RES.bars = 0;
  RES.rivals = rollRivals();
  G.chapterScores[G.chapter] = G.score;
  G.grades[G.chapter] = gradeFor(G.score);
  if (G.score > G.best) G.best = G.score;
  Audio_.sfx(G.score >= 66 ? 'win' : 'meh');
}
function rollRivals(){
  // three rivals, scored by the same yardstick; SPLOTCH is always found
  const seedy = (n) => Math.abs(Math.sin((G.chapter+1) * 12.9898 + n * 78.233) * 43758.5453) % 1;
  const base = 46 + G.chapter * 6;
  const rows = [
    { name:'TWOCOAT', s: Math.round(base + seedy(1) * 34) },
    { name:'HALFTONE', s: Math.round(base + seedy(2) * 30) },
    { name:'SPLOTCH', s: Math.round(12 + seedy(3) * 14) },
  ];
  rows.push({ name:'YOU', s:G.score, you:true });
  rows.sort((a,b) => b.s - a.s);
  return rows;
}
function resultsUpdate(dt){
  RES.t += dt; RES.bars = Math.min(1, RES.t / 0.7);
  if (Dlg.active){ Dlg.update(dt); return; }
  if (hit('menu')) RES.heat = !RES.heat;
  if (hit('ok')){
    const S = SIENNA_VERDICTS;
    const v = G.score >= 88 ? S.great : G.score >= 66 ? S.ok : G.score >= 40 ? S.poor : S.awful;
    Dlg.queue([{ t: v[(G.chapter) % v.length] }], { voice:VOICE.sienna, onEnd(){ chapterDone(); } });
  }
}
function resultsDraw(c){
  rect(c, 0, 0, VW, VH, UI.BLACK);
  txt(c, 'RESULTS — ' + G.spot.name, 8, 6, UI.DIM);
  txtC(c, String(G.score), 160, 16, UI.GOLD, 3);
  txtC(c, gradeFor(G.score), 160, 42, UI.WHITE);

  const bars = [['PAINT', G.bars.paint, 50], ['TEXTURE', G.bars.texture, 12],
                ['POSE', G.bars.pose, 20], ['SPOT', G.bars.spot, 12], ['NERVE', G.bars.nerve, 6]];
  const reasons = ['COLOUR AND EDGES', 'ROUGHNESS MATCH', G.bars.wantShape+' '+G.bars.wantPose+' WANTED',
                   'DO YOU FIT HERE', 'EXPOSURE ' + G.spot.exposure + '/5'];
  for (let i = 0; i < bars.length; i++){
    const [n, v, mx] = bars[i], y = 60 + i*15;
    txt(c, n, 10, y, UI.WHITE);
    rect(c, 62, y, 92, 8, UI.BLOOD);
    rect(c, 62, y, Math.round(92 * (v/mx) * RES.bars), 8, UI.GOLD);
    txt(c, Math.round(v) + '/' + mx, 158, y, UI.DIM);
    txt(c, reasons[i], 194, y, UI.GHOST);
  }
  rect(c, 8, 136, 304, 1, UI.GHOST);
  // the critique, wrapped so it never runs off the screen
  const crit = critiqueLine(G.bars);
  const cw = [];
  { let line = '';
    for (const word of crit.split(' ')){
      if ((line + ' ' + word).trim().length > 50){ cw.push(line); line = word; }
      else line = (line + ' ' + word).trim();
    }
    if (line) cw.push(line); }
  for (let i = 0; i < Math.min(2, cw.length); i++) txt(c, cw[i], 10, 142 + i*10, UI.CYAN);

  // rivals (left)
  txt(c, 'THE OTHER BLANKS', 10, 164, UI.DIM);
  for (let i = 0; i < RES.rivals.length; i++){
    const r = RES.rivals[i], y = 176 + i*10;
    txt(c, (i+1) + '. ' + r.name, 10, y, r.you ? UI.GOLD : UI.WHITE);
    txt(c, String(r.s), 92, y, r.you ? UI.GOLD : UI.DIM);
    txt(c, r.s < 25 ? 'FOUND IN 4S' : r.s < 50 ? 'FOUND' : r.s < 70 ? 'NEARLY' : 'NOT FOUND',
        122, y, UI.GHOST);
  }

  // heat map / your body (right, clear of the bars and the rivals)
  const m = maskFor(G.shape, G.pose);
  const s = Math.max(1, Math.min(3, Math.floor(56 / Math.max(m.w, m.h))));
  const ox = 320 - m.w*s - 12, oy = 160;
  panel(c, ox-3, oy-3, m.w*s+6, m.h*s+6, 1, UI.GHOST);
  for (const cell of m.cells){
    const col = RES.heat ? heatColour(G.bars.cellM[cell.i]) : PAL[G.grid[cell.i]];
    rect(c, ox+cell.cx*s, oy+cell.cy*s, s, s, col);
  }
  txt(c, RES.heat ? '[C] PAINT' : '[C] HEAT', ox-3, oy + m.h*s + 7, UI.DIM);
  txt(c, 'STYLE ' + G.style + '   TAGS ' + G.tags.size, 10, 218, UI.DIM);
  if (!Dlg.active) txtC(c, '[Z] CONTINUE', 160, 228, UI.WHITE);
  Dlg.draw(c);
}
