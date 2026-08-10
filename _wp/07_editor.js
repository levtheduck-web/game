/* ---------- body masks: 2 shapes x 4 poses, generated, then cached ---------- */
const MASKS = {};
function maskFor(shape, pose){
  const key = shape + '_' + pose;
  if (MASKS[key]) return MASKS[key];
  const [w, h] = MASK_SIZE[pose];
  const live = new Uint8Array(w * h);
  const R = { STAND:[3,1], CURL:[6,2], LIE:[4,1], FLATTEN:[4,1] }[pose];
  const r = shape === 'BLOB' ? R[0] : R[1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    let on = true;
    const corners = [[r-1, r-1, x < r, y < r], [w-r, r-1, x >= w-r, y < r],
                     [r-1, h-r, x < r, y >= h-r], [w-r, h-r, x >= w-r, y >= h-r]];
    for (const [ccx, ccy, inx, iny] of corners){
      if (inx && iny && Math.hypot(x - ccx, y - ccy) > r + 0.35) on = false;
    }
    if (shape === 'CUBE' && x === 0 && y === 0) on = false;      // 1-cell chamfer
    if (shape === 'BLOB' && pose === 'STAND'){                    // narrow the head
      if (y < 3 && (x < 2 || x >= w-2)) on = false;
      if (y >= 4 && y <= 5 && (x === 0 || x === w-1)) on = false; // a suggestion of a neck
    }
    if (shape === 'BLOB' && pose === 'LIE' && y === 0 && (x < 3 || x >= w-3)) on = false;
    live[y*w + x] = on ? 1 : 0;
  }
  const liveAt = (x,y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : live[y*w + x];
  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    if (!live[y*w + x]) continue;
    const edge = !liveAt(x-1,y) || !liveAt(x+1,y) || !liveAt(x,y-1) || !liveAt(x,y+1);
    cells.push({ cx:x, cy:y, i:y*w + x, edge });
  }
  const m = { w, h, live, liveAt, cells, count:cells.length,
              edges:cells.filter(c => c.edge).length };
  MASKS[key] = m; return m;
}

/* ---------- the paint grid ---------- */
function newGrid(shape, pose){
  const m = maskFor(shape, pose);
  return new Uint8Array(m.w * m.h).fill(WHITE_IDX);
}
function resampleGrid(oldGrid, oldShape, oldPose, shape, pose){
  const a = maskFor(oldShape, oldPose), b = maskFor(shape, pose);
  const out = new Uint8Array(b.w * b.h).fill(WHITE_IDX);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++){
    const sx = Math.min(a.w-1, Math.round((x + 0.5) / b.w * a.w - 0.5));
    const sy = Math.min(a.h-1, Math.round((y + 0.5) / b.h * a.h - 0.5));
    out[y*b.w + x] = oldGrid[sy*a.w + sx];
  }
  return out;
}
function setPose(shape, pose){
  if (G.grid) G.grid = resampleGrid(G.grid, G.shape, G.pose, shape, pose);
  else G.grid = newGrid(shape, pose);
  G.shape = shape; G.pose = pose;
  const m = maskFor(shape, pose); G.gridW = m.w; G.gridH = m.h;
  blankDirty = true;
}
/* the wall pixel under body cell (cx,cy) at the committed spot */
function wallAt(cx, cy){
  const sc = getScene(G.room), a = G.spot.anchors[G.pose];
  return sc.at(a[0] + cx, a[1] + cy);
}

/* the animated white reset — the ritual at the top of every round */
const Drain = { t:0, drops:[] };
function whiteReset(){
  const m = maskFor(G.shape, G.pose);
  Drain.t = 0.8; Drain.drops = [];
  for (let i = 0; i < 26; i++)
    Drain.drops.push({ x: Math.random()*m.w, y: Math.random()*m.h,
                       v: 26 + Math.random()*40, c: G.grid ? G.grid[(Math.random()*G.grid.length)|0] : 2 });
  G.grid = newGrid(G.shape, G.pose);
  blankDirty = true;
  Audio_.sfx('drain');
}

/* ---------- editor ---------- */
const ED = {
  cx:0, cy:0, rep:0, meter:0, meterT:0, undo:[], painting:false,
  lastX:0, lastY:0, peek:0, dropper:false, dx:0, dy:0, sampled:null, recent:[],
};
function edOpen(){
  const m = maskFor(G.shape, G.pose);
  ED.cx = m.w >> 1; ED.cy = m.h >> 1; ED.undo = []; ED.dropper = false;
  ED.dx = G.spot.anchors[G.pose][0] + m.w/2; ED.dy = G.spot.anchors[G.pose][1] + m.h/2;
  edMeter();
}
function edPushUndo(){
  ED.undo.push(G.grid.slice());
  if (ED.undo.length > 16) ED.undo.shift();
}
function edPaintAt(x, y, col){
  const m = maskFor(G.shape, G.pose);
  const sz = G.tool.size;
  for (let oy = 0; oy < sz; oy++) for (let ox = 0; ox < sz; ox++){
    const px = x + ox - ((sz-1) >> 1), py = y + oy - ((sz-1) >> 1);
    if (!m.liveAt(px, py)) continue;
    let c = col;
    if (G.tool.dither) c = ((px + py) % 2) ? G.slots[G.prevSlot] : G.slots[G.slot];
    G.grid[py*m.w + px] = c;
    if (G.tool.mirror){
      const mx = m.w - 1 - px;
      if (m.liveAt(mx, py)) G.grid[py*m.w + mx] = G.tool.dither ? (((mx+py)%2) ? G.slots[G.prevSlot] : G.slots[G.slot]) : c;
    }
  }
  blankDirty = true;
}
function edMeter(){
  const s = computeScore();
  ED.meter = Math.max(0, Math.min(5, Math.round(s.total / 20)));
}

function edUpdate(dt){
  if (ED.dropper) return dropperUpdate(dt);
  const m = maskFor(G.shape, G.pose);

  if (hit('pause')){ closeEditor(); return; }
  if (down('peek')) ED.peek = Math.min(1.2, ED.peek + dt); else ED.peek = Math.max(0, ED.peek - dt*3);

  // cursor with auto-repeat
  const dirs = [['left',-1,0],['right',1,0],['up',0,-1],['down',0,1]];
  let moved = false;
  for (const [k, dx, dy] of dirs){
    if (hit(k)){ ED.cx += dx; ED.cy += dy; ED.rep = -0.14; moved = true; }
  }
  if (!moved){
    let ax = (down('right')?1:0) - (down('left')?1:0);
    let ay = (down('down')?1:0) - (down('up')?1:0);
    if (ax || ay){
      ED.rep += dt;
      while (ED.rep >= 1/12){ ED.rep -= 1/12; ED.cx += ax; ED.cy += ay; moved = true; }
    } else ED.rep = 0;
  }
  ED.cx = Math.max(0, Math.min(m.w-1, ED.cx));
  ED.cy = Math.max(0, Math.min(m.h-1, ED.cy));

  // paint (hold Z, interpolated so fast strokes leave no gaps)
  if (down('ok')){
    if (!ED.painting){ edPushUndo(); ED.painting = true; ED.lastX = ED.cx; ED.lastY = ED.cy; }
    const steps = Math.max(1, Math.round(Math.hypot(ED.cx-ED.lastX, ED.cy-ED.lastY)));
    for (let i = 1; i <= steps; i++){
      edPaintAt(Math.round(ED.lastX + (ED.cx-ED.lastX)*i/steps),
                Math.round(ED.lastY + (ED.cy-ED.lastY)*i/steps), G.slots[G.slot]);
    }
    ED.lastX = ED.cx; ED.lastY = ED.cy;
    if (moved) Audio_.sfx('brush');
  } else if (ED.painting){ ED.painting = false; }

  if (hit('no')){ ED.dropper = true; Audio_.sfx('menu'); return; }

  for (let i = 0; i < 8; i++) if (hit('s'+(i+1))){
    if (i !== G.slot){ G.prevSlot = G.slot; G.slot = i; Audio_.sfx('menu'); }
  }
  if (hit('fill')){
    edPushUndo();
    if (down('no')){ for (const c of m.cells) G.grid[c.i] = G.slots[G.slot]; }   // BASE COAT
    else floodFill(ED.cx, ED.cy, G.slots[G.slot]);
    blankDirty = true; Audio_.sfx('fill');
  }
  if (hit('brushdn')) G.tool.size = Math.max(1, G.tool.size - 1);
  if (hit('brushup')) G.tool.size = Math.min(3, G.tool.size + 1);
  if (hit('mirror')) G.tool.mirror = !G.tool.mirror;
  if (hit('dither')) G.tool.dither = !G.tool.dither;
  if (hit('shadedn')){ const s = G.slots[G.slot]; G.slots[G.slot] = (s & ~3) | Math.max(0, (s&3)-1); }
  if (hit('shadeup')){ const s = G.slots[G.slot]; G.slots[G.slot] = (s & ~3) | Math.min(3, (s&3)+1); }
  if (hit('ghost')) G.ghostMode = (G.ghostMode + 1) % 3;
  if (hit('undo') && ED.undo.length){ G.grid = ED.undo.pop(); blankDirty = true; Audio_.sfx('menu'); }

  ED.meterT += dt;
  if (ED.meterT >= 0.25){ ED.meterT = 0; edMeter(); }
}
function floodFill(x, y, col){
  const m = maskFor(G.shape, G.pose);
  const target = G.grid[y*m.w + x];
  if (target === col) return;
  const q = [[x,y]];
  while (q.length){
    const [cx, cy] = q.pop();
    if (!m.liveAt(cx,cy)) continue;
    if (G.grid[cy*m.w + cx] !== target) continue;
    G.grid[cy*m.w + cx] = col;
    q.push([cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]);
  }
}

/* ---------- the eyedropper: the whole scene, a roaming crosshair ---------- */
function dropperUpdate(dt){
  const [ax, ay] = axis();
  ED.dx = Math.max(0, Math.min(VW-1, ED.dx + ax * 176 * dt));
  ED.dy = Math.max(0, Math.min(VH-1, ED.dy + ay * 176 * dt));
  if (hit('ok')){
    const sc = getScene(G.room);
    const idx = sc.at(ED.dx, ED.dy), tg = sc.tagAt(ED.dx, ED.dy);
    G.slots[G.slot] = idx;
    G.slotTag[G.slot] = TAGNAMES[tg];
    G.tags.add(TAGNAMES[tg]);
    ED.sampled = { idx, tag:TAGNAMES[tg] };
    ED.recent.unshift(idx); if (ED.recent.length > 8) ED.recent.pop();
    Audio_.sfx('drop');
  }
  for (let i = 0; i < 8; i++) if (hit('s'+(i+1))){ G.prevSlot = G.slot; G.slot = i; Audio_.sfx('menu'); }
  if (hit('no') || hit('pause')){ ED.dropper = false; Audio_.sfx('menu'); }
}

/* ---------- editor rendering ---------- */
const CELL = 8, GX = 8, GY = 10;
function edDraw(c){
  rect(c, 0, 0, VW, VH, UI.BLACK);
  if (ED.dropper) return dropperDraw(c);

  const m = maskFor(G.shape, G.pose), sc = getScene(G.room), a = G.spot.anchors[G.pose];
  const scale = Math.min(CELL, Math.floor(176 / m.w), Math.floor(160 / m.h));

  // the wall patch behind the grid
  if (G.ghostMode === 2 || G.ghostMode === 1)
    c.drawImage(sc.cv, a[0], a[1], m.w, m.h, GX, GY, m.w*scale, m.h*scale);

  for (const cell of m.cells){
    const x = GX + cell.cx*scale, y = GY + cell.cy*scale;
    const mine = G.grid[cell.i], wall = sc.at(a[0]+cell.cx, a[1]+cell.cy);
    if (G.ghostMode === 0){ rect(c, x, y, scale, scale, PAL[mine]); }
    else if (G.ghostMode === 1){
      // WEAVE: 2px checker of your colour against the wall's
      for (let yy = 0; yy < scale; yy += 2) for (let xx = 0; xx < scale; xx += 2)
        rect(c, x+xx, y+yy, 2, 2, (((xx>>1)+(yy>>1)) % 2) ? PAL[wall] : PAL[mine]);
    } else { /* WALL mode: leave the patch visible */ }
  }
  // cover rect + cursor
  frame(c, GX-1, GY-1, m.w*scale+2, m.h*scale+2, 1, UI.GHOST);
  const curX = GX + ED.cx*scale, curY = GY + ED.cy*scale;
  frame(c, curX-1, curY-1, scale+2, scale+2, 1, UI.WHITE);
  drawEmber(c, curX + scale/2, curY + scale/2, PAL[G.slots[G.slot]]);
  if (G.tool.mirror){
    const mx = GX + (m.w-1-ED.cx)*scale;
    frame(c, mx-1, curY-1, scale+2, scale+2, 1, UI.GHOST);
  }

  // right-hand panel
  panel(c, 192, 10, 32, 32, 2, UI.WHITE);
  rect(c, 194, 12, 28, 28, PAL[G.slots[G.slot]]);
  txt(c, 'SLOT ' + (G.slot+1), 228, 14, UI.WHITE);
  txt(c, palName(G.slots[G.slot]), 228, 26, UI.DIM);
  const tag = G.slotTag[G.slot] || 'MIXED BY HAND';
  txt(c, tag.slice(0,21), 192, 46, UI.DIM);
  txt(c, '/ ' + SHADEWORD[G.slots[G.slot] & 3], 192, 56, UI.DIM);

  for (let i = 0; i < 8; i++){
    const sx = 192 + (i%4)*16, sy = 70 + ((i/4)|0)*16;
    rect(c, sx, sy, 14, 14, PAL[G.slots[i]]);
    if (i === G.slot) frame(c, sx-1, sy-1, 16, 16, 1, UI.GOLD);
    else frame(c, sx, sy, 14, 14, 1, UI.GHOST);
  }
  // coarse blend meter
  for (let i = 0; i < 5; i++)
    rect(c, 192+i*24, 110, 22, 8, i < ED.meter ? UI.GOLD : UI.BLOOD);
  txt(c, fmtClock(Math.max(0, Math.ceil(G.prep))), 192, 124, UI.WHITE);
  txt(c, ['BODY','WEAVE','WALL'][G.ghostMode], 232, 124, UI.CYAN);
  txt(c, 'SIZE ' + G.tool.size, 192, 140, UI.DIM);
  txt(c, 'MIRR ' + (G.tool.mirror?'ON':'OFF'), 192, 152, G.tool.mirror?UI.GOLD:UI.DIM);
  txt(c, 'DITH ' + (G.tool.dither?'ON':'OFF'), 192, 164, G.tool.dither?UI.GOLD:UI.DIM);

  // 1:1 preview of the real thing
  panel(c, 248, 136, 60, 60, 2, UI.WHITE);
  drawPreview(c, 250, 138, 56);

  txt(c, 'Z PAINT  X DROPPER  F FILL  SH+F COAT', 8, 210, UI.DIM);
  txt(c, 'G VIEW  E MIRROR  Q DITH  , . SHADE  ESC', 8, 222, UI.DIM);
  if (ED.peek > 0) drawFullPreview(c);
}
function drawPreview(c, x, y, size){
  const m = maskFor(G.shape, G.pose), sc = getScene(G.room), a = G.spot.anchors[G.pose];
  const cx = a[0] + m.w/2, cy = a[1] + m.h/2;
  const sx = Math.round(cx - size/2), sy = Math.round(cy - size/2);
  c.save(); c.beginPath(); c.rect(x, y, size, size); c.clip();
  c.drawImage(sc.cv, sx, sy, size, size, x, y, size, size);
  if (blankDirty) bakeBlank();
  c.drawImage(blankSprite, x + a[0] - sx, y + a[1] - sy);
  c.restore();
}
function drawFullPreview(c){
  const sc = getScene(G.room), a = G.spot.anchors[G.pose];
  c.drawImage(sc.cv, 0, 0);
  if (blankDirty) bakeBlank();
  c.drawImage(blankSprite, a[0], a[1]);
  txtC(c, 'RELEASE TAB', 160, 226, UI.DIM);
}
function dropperDraw(c){
  const sc = getScene(G.room);
  c.drawImage(sc.cv, 0, 0);
  const m = maskFor(G.shape, G.pose), a = G.spot.anchors[G.pose];
  if (blankDirty) bakeBlank();
  c.drawImage(blankSprite, a[0], a[1]);
  const x = Math.round(ED.dx), y = Math.round(ED.dy);
  rect(c, x-2, y, 5, 1, UI.BLACK); rect(c, x, y-2, 1, 5, UI.BLACK);
  rect(c, x-3, y, 2, 1, UI.WHITE); rect(c, x+2, y, 2, 1, UI.WHITE);
  rect(c, x, y-3, 1, 2, UI.WHITE); rect(c, x, y+2, 1, 2, UI.WHITE);
  // 3x3 magnified tile
  const flip = x > 240, px = flip ? x - 66 : x + 10, py = Math.max(2, Math.min(VH-70, y - 28));
  panel(c, px, py, 56, 56, 2, UI.WHITE);
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++)
    rect(c, px+3+(ox+1)*17, py+3+(oy+1)*17, 17, 17, PAL[sc.at(x+ox, y+oy)]);
  const nm = TAGNAMES[sc.tagAt(x,y)];
  rect(c, 0, 210, VW, 30, UI.BLACK);
  txt(c, nm + ' / ' + SHADEWORD[sc.at(x,y)&3], 8, 212, UI.WHITE);
  txt(c, 'Z SAMPLE INTO SLOT ' + (G.slot+1) + '   1-8 SLOT   X BACK', 8, 224, UI.DIM);
  for (let i = 0; i < 8; i++){
    const sx2 = 232 + (i%8)*11;
    rect(c, sx2, 212, 9, 9, PAL[G.slots[i]]);
    if (i === G.slot) frame(c, sx2-1, 211, 11, 11, 1, UI.GOLD);
  }
}
/* the 7x7 ember: brush tip here, soul in the arena */
const EMBER = ['...#...','..###..','.#####.','##.#.##','.#####.','..###..','...#...'];
function drawEmber(c, cx, cy, col){
  const x = Math.round(cx) - 3, y = Math.round(cy) - 3;
  for (let r = 0; r < 7; r++) for (let q = 0; q < 7; q++){
    if (EMBER[r][q] !== '#') continue;
    rect(c, x+q, y+r, 1, 1, (r === 3 && q === 3) ? UI.WHITE : col);
  }
}
