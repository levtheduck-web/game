/* ---------- round result ---------- */
const RES = { heat:false, t:0, bars:0, verdict:'' };
function resultsBegin(){
  G.st = 'RESULT'; RES.heat = false; RES.t = 0; RES.bars = 0;
  if (G.score > G.best) G.best = G.score;
  G.history.push({ map: ROOMS[G.room].label, score: G.score, found: HIDE.found });
  const S = SIENNA_VERDICTS;
  const v = G.score >= 88 ? S.great : G.score >= 66 ? S.ok : G.score >= 40 ? S.poor : S.awful;
  RES.verdict = v[G.round % v.length];
  Audio_.sfx(HIDE.found ? 'meh' : 'win');
}
function resultsUpdate(dt){
  RES.t += dt; RES.bars = Math.min(1, RES.t / 0.7);
  if (Dlg.active){ Dlg.update(dt); return; }
  if (hit('menu')) RES.heat = !RES.heat;
  if (hit('ok') && RES.t > 0.4) nextRound();
}
function resultsDraw(c){
  rect(c, 0, 0, VW, VH, UI.BLACK);
  const found = HIDE.found;
  txt(c, 'ROUND ' + (G.round+1) + '  —  ' + ROOMS[G.room].label, 8, 6, UI.DIM);
  txtC(c, found ? 'FOUND' : 'NOT FOUND', 160, 16, found ? UI.SOUL : UI.GOLD, 2);
  txtC(c, G.spot.name, 160, 34, UI.DIM);
  txtC(c, 'CAMO ' + G.score + '   ' + gradeFor(G.score), 160, 46, UI.WHITE);

  const bars = [['PAINT', G.bars.paint, 50], ['TEXTURE', G.bars.texture, 12],
                ['POSE', G.bars.pose, 20], ['SPOT', G.bars.spot, 12], ['NERVE', G.bars.nerve, 6]];
  const reasons = ['COLOUR AND EDGES', 'ROUGHNESS MATCH',
                   G.bars.wantShape + ' ' + G.bars.wantPose + ' WANTED',
                   'DO YOU FIT HERE', 'EXPOSURE ' + G.spot.exposure + '/5'];
  for (let i = 0; i < bars.length; i++){
    const [n, v, mx] = bars[i], y = 62 + i*14;
    txt(c, n, 10, y, UI.WHITE);
    rect(c, 62, y, 92, 8, UI.BLOOD);
    rect(c, 62, y, Math.round(92 * (v/mx) * RES.bars), 8, UI.GOLD);
    txt(c, Math.round(v) + '/' + mx, 158, y, UI.DIM);
    txt(c, reasons[i], 194, y, UI.GHOST);
  }
  rect(c, 8, 134, 304, 1, UI.GHOST);

  const crit = critiqueLine(G.bars), cw = [];
  { let line = '';
    for (const w of crit.split(' ')){
      if ((line + ' ' + w).trim().length > 50){ cw.push(line); line = w; }
      else line = (line + ' ' + w).trim();
    }
    if (line) cw.push(line); }
  for (let i = 0; i < Math.min(2, cw.length); i++) txt(c, cw[i], 10, 140 + i*10, UI.CYAN);

  // the other Blanks
  txt(c, 'THE OTHER BLANKS', 10, 164, UI.DIM);
  const rows = HIDE.rivals.map(r => ({ name:r.name, s:r.score, found:r.found }));
  rows.push({ name:'YOU', s:G.score, found:HIDE.found, you:true });
  rows.sort((a,b) => b.s - a.s);
  for (let i = 0; i < rows.length; i++){
    const r = rows[i], y = 176 + i*10;
    txt(c, (i+1) + '. ' + r.name, 10, y, r.you ? UI.GOLD : UI.WHITE);
    txt(c, String(r.s), 92, y, r.you ? UI.GOLD : UI.DIM);
    txt(c, r.found ? 'FOUND' : 'SURVIVED', 122, y, r.found ? UI.SOUL : UI.GHOST);
  }

  // your body / heat map
  const m = maskFor(G.shape, G.pose);
  const s = Math.max(1, Math.min(3, Math.floor(56 / Math.max(m.w, m.h))));
  const ox = 320 - m.w*s - 12, oy = 160;
  panel(c, ox-3, oy-3, m.w*s+6, m.h*s+6, 1, UI.GHOST);
  for (const cell of m.cells){
    const col = RES.heat ? heatColour(G.bars.cellM[cell.i]) : PAL[G.grid[cell.i]];
    rect(c, ox+cell.cx*s, oy+cell.cy*s, s, s, col);
  }
  txt(c, RES.heat ? '[C] PAINT' : '[C] HEAT', ox-3, oy + m.h*s + 7, UI.DIM);

  txt(c, 'SURVIVED ' + G.survived + '   FOUND ' + G.caught + '   BEST ' + G.best
       + '   TAGS ' + G.tags.size, 10, 218, UI.DIM);
  if (!Dlg.active) txtC(c, '[Z] NEXT ROUND', 160, 228, UI.WHITE);
  Dlg.draw(c);
}
