/* ---------- the encounter screen ---------- */
const ARENA_STATES = {
  MENU:[246,78], WIDE:[246,78], SQUARE:[94,94], TALL:[70,94], PINCH:[50,50]
};
const AR = {
  cx:160, cy:140, iw:246, ih:78, tw:246, th:78,
  soulX:160, soulY:140, iT:0, spawnFreeze:0,
};
function arenaSet(state, instant){
  const [w, h] = ARENA_STATES[state];
  AR.tw = w; AR.th = h;
  if (instant){ AR.iw = w; AR.ih = h; }
  AR.state = state;
}
function arenaStep(dt){
  const rate = 180 * dt;
  if (AR.iw !== AR.tw){ const d = Math.sign(AR.tw - AR.iw); AR.iw = Math.abs(AR.tw-AR.iw) <= rate ? AR.tw : AR.iw + d*rate; }
  if (AR.ih !== AR.th){ const d = Math.sign(AR.th - AR.ih); AR.ih = Math.abs(AR.th-AR.ih) <= rate ? AR.th : AR.ih + d*rate; }
  AR.iw = Math.max(40, Math.min(270, AR.iw)); AR.ih = Math.max(40, Math.min(94, AR.ih));
  clampSoul();
}
function inner(){
  const w = Math.round(AR.iw), h = Math.round(AR.ih);
  return { x: Math.round(AR.cx - w/2), y: Math.round(AR.cy - h/2), w, h };
}
function clampSoul(){
  const r = inner();
  let lo = r.x + 3, hi = r.x + r.w - 3;
  if (G.pose === 'FLATTEN'){                       // flattening halves your range
    const q = r.w / 4; lo = r.x + q + 3; hi = r.x + r.w - q - 3;
  }
  AR.soulX = Math.max(lo, Math.min(hi, AR.soulX));
  AR.soulY = Math.max(r.y + 3, Math.min(r.y + r.h - 3, AR.soulY));
}
function soulMove(dt){
  const [ax, ay] = axis();
  const sp = (down('no') ? 55 : 110) * dt;
  const px = AR.soulX, py = AR.soulY;
  AR.soulX += ax * sp; AR.soulY += ay * sp;
  clampSoul();
  return Math.hypot(AR.soulX - px, AR.soulY - py);
}

/* ---------- the 3x spot composite: the arena floor IS your paint job ---------- */
let spotView = null, spotViewT = 0;
function bakeSpotView(){
  const m = maskFor(G.shape, G.pose), a = G.spot.anchors[G.pose], sc = getScene(G.room);
  const pad = 46;
  const sx = Math.max(0, a[0] - pad), sy = Math.max(0, a[1] - pad);
  const sw = Math.min(VW - sx, m.w + pad*2), sh = Math.min(VH - sy, m.h + pad*2);
  const cv = document.createElement('canvas');
  cv.width = sw * 3; cv.height = sh * 3;
  const c = cv.getContext('2d', { alpha:false }); nosmooth(c);
  c.drawImage(sc.cv, sx, sy, sw, sh, 0, 0, sw*3, sh*3);
  if (blankDirty) bakeBlank();
  c.drawImage(blankSprite, 0, 0, m.w, m.h,
              (a[0]-sx)*3, (a[1]-sy)*3, m.w*3, m.h*3);
  spotView = { cv, sx, sy, bodyX:(a[0]-sx)*3, bodyY:(a[1]-sy)*3, bw:m.w*3, bh:m.h*3 };
}
function drawSpotView(c, r){
  if (!spotView) bakeSpotView();
  const bcx = spotView.bodyX + spotView.bw/2, bcy = spotView.bodyY + spotView.bh/2;
  c.save(); c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
  rect(c, r.x, r.y, r.w, r.h, UI.BLACK);
  c.drawImage(spotView.cv, Math.round(r.x + r.w/2 - bcx), Math.round(r.y + r.h/2 - bcy));
  c.restore();
}
/* map the soul's arena position back onto a body cell (for smudging) */
function soulToCell(){
  if (!spotView) bakeSpotView();
  const r = inner();
  const bcx = spotView.bodyX + spotView.bw/2, bcy = spotView.bodyY + spotView.bh/2;
  const ox = Math.round(r.x + r.w/2 - bcx), oy = Math.round(r.y + r.h/2 - bcy);
  const vx = AR.soulX - ox, vy = AR.soulY - oy;
  return { cx: Math.floor((vx - spotView.bodyX) / 3), cy: Math.floor((vy - spotView.bodyY) / 3) };
}

/* ---------- buttons ---------- */
const BTNS = ['PAINT','POSE','SPOT','HOLD'];
const BTN_X = [15, 89, 163, 237];
let btnSel = 3;
function drawButtons(c, enabled){
  for (let i = 0; i < 4; i++){
    const x = BTN_X[i], y = 208, sel = i === btnSel;
    const on = !enabled || enabled[i];
    const col = !on ? UI.GHOST : sel ? UI.GOLD : UI.WHITE;
    frame(c, x, y, 68, 28, 2, col);
    txt(c, BTNS[i], x + 22, y + 11, col);
    if (sel) drawEmber(c, x + 12, y + 14, UI.SOUL);
  }
}
function buttonNav(enabled){
  if (hit('left')){
    for (let i = btnSel-1; i >= 0; i--) if (!enabled || enabled[i]){ btnSel = i; Audio_.sfx('menu'); break; }
  }
  if (hit('right')){
    for (let i = btnSel+1; i < 4; i++) if (!enabled || enabled[i]){ btnSel = i; Audio_.sfx('menu'); break; }
  }
}

/* ---------- generic submenu inside the arena ---------- */
const SUB = { open:false, items:[], sel:0, title:'', onPick:null };
function subOpen(title, items, onPick){
  SUB.open = true; SUB.items = items; SUB.sel = 0; SUB.title = title; SUB.onPick = onPick;
}
function subUpdate(){
  if (!SUB.open) return false;
  const n = SUB.items.length;
  if (hit('down')){ SUB.sel = (SUB.sel + 1) % n; Audio_.sfx('menu'); }
  if (hit('up')){ SUB.sel = (SUB.sel - 1 + n) % n; Audio_.sfx('menu'); }
  if (hit('right') && n > 3){ SUB.sel = Math.min(n-1, SUB.sel + Math.ceil(n/2)); Audio_.sfx('menu'); }
  if (hit('left')  && n > 3){ SUB.sel = Math.max(0, SUB.sel - Math.ceil(n/2)); Audio_.sfx('menu'); }
  if (hit('no')){ SUB.open = false; Audio_.sfx('back'); return true; }
  if (hit('ok')){
    const it = SUB.items[SUB.sel];
    if (it.disabled){ Audio_.sfx('bad'); return true; }
    SUB.open = false; Audio_.sfx('confirm');
    if (SUB.onPick) SUB.onPick(it, SUB.sel);
  }
  return true;
}
function subDraw(c){
  if (!SUB.open) return;
  const r = inner();
  rect(c, r.x, r.y, r.w, r.h, UI.BLACK);
  txt(c, SUB.title, r.x + 10, r.y + 4, UI.DIM);
  const half = Math.ceil(SUB.items.length / 2);
  for (let i = 0; i < SUB.items.length; i++){
    const col = i < half ? 0 : 1;
    const row = i % half;
    const x = r.x + 26 + col * (r.w/2 - 6), y = r.y + 16 + row * 14;
    const it = SUB.items[i];
    txt(c, it.label, x, y, it.disabled ? UI.GHOST : (i === SUB.sel ? UI.GOLD : UI.WHITE));
    if (i === SUB.sel) drawEmber(c, x - 10, y + 3, UI.SOUL);
  }
}

/* ---------- PREP ---------- */
function beginPrep(spot){
  G.spot = spot;
  G.spotIdx = ROOMS[G.room].spots.indexOf(spot);
  setPose(spot.wantShape === 'CUBE' ? 'CUBE' : 'BLOB', 'STAND');
  whiteReset();
  G.notice = 0; G.style = 0; G.streak = 0; G.bolted = false; G.shifted = false;
  G.hp = G.maxhp;
  btnSel = 3; arenaSet('MENU', true);
  AR.soulX = 160; AR.soulY = 140;
  spotView = null;
  G.st = 'ENTRY'; G.entryT = 0;
  if (!G.coneHit) { G.prep += 10; OW.hint = '+10s  UNSEEN'; OW.hintT = 2; }
  Audio_.sfx('encounter');
}
function prepUpdate(dt){
  if (Dlg.active){ Dlg.update(dt); return; }
  if (SUB.open){ subUpdate(); return; }
  arenaStep(dt);
  G.prep -= dt;
  if (G.prep <= 0){ G.prep = 0; commitHold(); return; }
  buttonNav();
  if (hit('ok')){
    Audio_.sfx('confirm');
    if (btnSel === 0){ G.st = 'EDITOR'; edOpen(); }
    else if (btnSel === 1) openPoseMenu();
    else if (btnSel === 2) openSpotMenu();
    else commitHold();
  }
}
function openPoseMenu(){
  const items = [];
  for (const sh of ['BLOB','CUBE']) for (const po of ['STAND','CURL','LIE','FLATTEN'])
    items.push({ label: sh.slice(0,4) + ' ' + po, sh, po });
  subOpen('SHAPE + POSE', items, it => {
    setPose(it.sh, it.po); spotView = null;
  });
}
function openSpotMenu(){
  const items = ROOMS[G.room].spots.map(s => ({ label: s.name.slice(0,22), s }));
  subOpen('MOVE TO', items, it => {
    G.spot = it.s; G.spotIdx = ROOMS[G.room].spots.indexOf(it.s); spotView = null;
  });
}
function commitHold(){
  const b = computeScore();
  G.bars = b; G.score = b.total;
  bakeSpotView();
  G.st = 'HOLDIN'; G.holdT = 0;
  Audio_.sfx('commit');
}

function closeEditor(){ G.st = 'PREP'; spotView = null; Audio_.sfx('back'); }

/* ---------- shared encounter chrome ---------- */
function drawChrome(c, seekerName, showNotice){
  rect(c, 0, 0, VW, VH, UI.BLACK);
  txt(c, seekerName, 8, 6, UI.DIM);
  if (showNotice){
    txt(c, 'NOTICE ' + Math.round(G.notice), 8, 66, UI.WHITE);
    rect(c, 8, 76, 88, 6, UI.BLOOD);
    const w = Math.round(88 * G.notice / 100);
    const flash = G.notice >= 85 && (frameCount % 4 < 2);
    rect(c, 8, 76, w, 6, flash ? UI.WHITE : UI.GOLD);
  } else {
    txt(c, 'PREP ' + fmtClock(Math.max(0, Math.ceil(G.prep))), 8, 66, UI.WHITE);
  }
  txt(c, 'STYLE ' + G.style, 16, 196, UI.DIM);
  txt(c, 'BLANK', 96, 196, UI.WHITE);
  txt(c, 'HP', 152, 196, UI.WHITE);
  rect(c, 170, 196, 96, 9, UI.BLOOD);
  rect(c, 170, 196, Math.round(96 * Math.max(0,G.hp) / G.maxhp), 9, UI.GOLD);
  txt(c, Math.max(0,Math.round(G.hp)) + '/' + G.maxhp, 272, 196, UI.WHITE);
}
function drawArenaFrame(c, withComposite){
  const r = inner();
  if (withComposite) drawSpotView(c, r); else rect(c, r.x, r.y, r.w, r.h, UI.BLACK);
  frame(c, r.x - 5, r.y - 5, r.w + 10, r.h + 10, 5, UI.WHITE);
}
function drawSoul(c, hidden){
  if (hidden) return;
  if (AR.iT > 0 && Math.floor(AR.iT * 60 / 4) % 2) return;   // 4 on / 4 off
  drawEmber(c, AR.soulX, AR.soulY, UI.SOUL);
}

function prepDraw(c){
  drawChrome(c, LOOKERS[ROOMS[G.room].looker].name + '  —  PREPARING', false);
  drawArenaFrame(c, true);
  if (SUB.open) subDraw(c);
  else {
    const r = inner();
    rect(c, r.x, r.y + r.h - 12, r.w, 12, UI.BLACK);
    txt(c, G.spot.name + '   ' + G.shape + ' ' + G.pose, r.x + 6, r.y + r.h - 10, UI.DIM);
  }
  drawButtons(c);
  Dlg.draw(c);
}
