/* ---------- headless self-test: #smoke ---------- */
function runSmoke(){
  const out = [];
  const ok = (n, c) => out.push((c ? 'PASS  ' : 'FAIL  ') + n);
  const guard = (n, fn) => { try { fn(); ok(n, true); } catch(e){ ok(n + ' -> ' + e.message, false); } };

  for (const [n, c] of paletteAudit()) ok(n, c);
  ok('font has 95 glyphs', FONTDATA.blob.length === 95 * 7);
  ok('atlas bakes', atlas(UI.WHITE).width === 96 && atlas(UI.WHITE).height === 48);

  let maskOk = true, edgeOk = true;
  for (const sh of ['BLOB','CUBE']) for (const po of ['STAND','CURL','LIE','FLATTEN']){
    const m = maskFor(sh, po);
    if (m.count < 100 || m.count > m.w * m.h) maskOk = false;
    if (m.edges < 20) edgeOk = false;
  }
  ok('all 8 masks have sane cell counts', maskOk);
  ok('all 8 masks have edge cells', edgeOk);

  // maps
  let fits = true, walkOk = true, bad = '';
  for (const key of MAPS){
    const room = ROOMS[key], sc = getScene(key);
    for (const s of room.spots){
      const m = maskFor(s.wantShape, s.wantPose);
      if (m.w > s.coverW || m.h > s.coverH){ fits = false; bad = key + '/' + s.id; }
      for (const p in s.anchors){
        const a = s.anchors[p], mm = maskFor(s.wantShape, p);
        if (a[0] < 0 || a[1] < 0 || a[0]+mm.w > VW || a[1]+mm.h > VH){ fits = false; bad = key+'/'+s.id+'/'+p; }
      }
      if (sc.solidAt(s.walk[0], s.walk[1])){ walkOk = false; bad = key+'/'+s.id+' walk'; }
    }
    if (room.spots.length < 4){ fits = false; bad = key + ' too few spots'; }
  }
  ok('every ideal pose fits its cover rect' + (bad ? ' (' + bad + ')' : ''), fits);
  ok('every spot is reachable on foot' + (!walkOk ? ' (' + bad + ')' : ''), walkOk);
  ok('5 maps', MAPS.length === 5);

  let flat = '', offPal = false;
  for (const key of MAPS){
    const sc = getScene(key), seen = new Set();
    for (let i = 0; i < sc.idx.length; i += 7){ seen.add(sc.idx[i]); if (sc.idx[i] > 31) offPal = true; }
    if (seen.size < 4) flat = key;
  }
  ok('no map is flat' + (flat ? ' (' + flat + ')' : ''), !flat);
  ok('every scene pixel is inside the 32-colour palette', !offPal);

  // ---- scoring ----
  G.round = 0; newRound(); Dlg.active = false;
  const room = ROOMS.CH1;
  G.spot = room.spots[0];
  setPose(G.spot.wantShape, G.spot.wantPose);
  const white = computeScore();
  const m0 = maskFor(G.shape, G.pose), a0 = G.spot.anchors[G.pose], sc0 = getScene('CH1');
  for (const cell of m0.cells) G.grid[cell.i] = sc0.at(a0[0]+cell.cx, a0[1]+cell.cy);
  blankDirty = true;
  const perfect = computeScore();
  ok('a pure white body scores badly (' + white.total + ')', white.total < 45);
  ok('copying the wall exactly scores high (' + perfect.total + ')', perfect.total >= 88);

  const edgeCell = m0.cells.find(c => c.edge), midCell = m0.cells.find(c => !c.edge);
  const bak = G.grid.slice();
  G.grid[edgeCell.i] = WHITE_IDX; const dEdge = perfect.raw - computeScore().raw;
  G.grid = bak.slice();
  G.grid[midCell.i] = WHITE_IDX; const dMid = perfect.raw - computeScore().raw;
  G.grid = bak.slice();
  ok('an edge cell is worth ~3x an interior one (' + dEdge.toFixed(4) + ' vs ' + dMid.toFixed(4) + ')',
     dMid > 0 && dEdge/dMid > 2.5 && dEdge/dMid < 3.5);

  setPose('BLOB','LIE');
  const wrong = computeScore();
  ok('the wrong pose is a disaster (' + wrong.total + ')', wrong.total < perfect.total - 20);
  setPose(room.spots[0].wantShape, room.spots[0].wantPose);
  G.grid = bak.slice(); blankDirty = true;

  const wallIdx = sc0.at(a0[0] + (m0.w>>1), a0[1] + (m0.h>>1));
  for (const cell of m0.cells) G.grid[cell.i] = wallIdx;
  const flatCoat = computeScore();
  ok('base coat alone caps below 67 (' + flatCoat.total + ')', flatCoat.total < 67);
  G.grid = bak.slice(); blankDirty = true;

  // ---- the hide phase is where camo pays off ----
  const runHide = (grid, holdBreath) => {
    G.grid = grid.slice(); blankDirty = true;
    G.spot = room.spots[0]; setPose(room.spots[0].wantShape, room.spots[0].wantPose);
    hideBegin(); Dlg.active = false;
    held.no = !!holdBreath;
    let steps = 0;
    while (!HIDE.over && steps < 60 * 200){ hideUpdate(STEP); steps++; }
    held.no = false;
    return { found: HIDE.found, secs: steps/60, score: G.score };
  };
  const whiteGrid = new Uint8Array(m0.w*m0.h).fill(WHITE_IDX);
  const rBad = runHide(whiteGrid, false);
  const rGood = runHide(bak, false);
  ok('a pure white body gets found (camo ' + rBad.score + ')', rBad.found);
  ok('a wall-perfect body survives the round (camo ' + rGood.score + ')', !rGood.found);
  ok('the round always ends', rBad.secs < 200 && rGood.secs < 200);

  const rBadBreath = runHide(whiteGrid, true);
  ok('holding your breath buys real time (' + rBad.secs.toFixed(1) + 's vs ' + rBadBreath.secs.toFixed(1) + 's)',
     rBadBreath.secs > rBad.secs + 1);

  // the seeker really does patrol and check spots (needs a body that survives long enough)
  G.grid = bak.slice(); blankDirty = true;
  hideBegin(); Dlg.active = false;
  const startX = HIDE.sk.x, startY = HIDE.sk.y;
  const visited = new Set();
  for (let i = 0; i < 60*60; i++){
    hideUpdate(STEP);
    if (HIDE.sk.mode === 'INSPECT') visited.add(HIDE.sk.target.id);
    if (HIDE.over) break;
  }
  ok('the seeker walks (moved from its start)', Math.hypot(HIDE.sk.x-startX, HIDE.sk.y-startY) > 20);
  ok('the seeker inspects several hiding places (' + visited.size + ')', visited.size >= 3);

  // rivals hide, and the worst of them gets found
  G.grid = bak.slice(); blankDirty = true;
  hideBegin(); Dlg.active = false;
  ok('three other Blanks hide too', HIDE.rivals.length === 3);
  ok('rivals occupy real spots', HIDE.rivals.every(r => r.spot && r.spot !== G.spot));
  for (let i = 0; i < 60*200 && !HIDE.over; i++) hideUpdate(STEP);
  ok('the worst-painted rival gets found', HIDE.rivals.find(r => r.name === 'SPLOTCH').found);

  // relocating while unobserved
  hideBegin(); Dlg.active = false;
  HIDE.sk.x = 10; HIDE.sk.y = 232; HIDE.sk.mode = 'WALK'; HIDE.sk.fx = -1; HIDE.sk.fy = 0;
  const before = G.spot;
  buffered.ok = BUFFER; hideUpdate(STEP);
  ok('you can move spots while it is not looking', G.spot !== before);
  // ...and cannot slip away while it is stood there studying your spot
  hideBegin(); Dlg.active = false;
  HIDE.sk.mode = 'INSPECT'; HIDE.sk.target = G.spot;
  HIDE.sk.x = G.spot.walk[0]; HIDE.sk.y = G.spot.walk[1];
  const pinned = G.spot;
  buffered.ok = BUFFER; hideUpdate(STEP);
  ok('you cannot slip away mid-inspection', G.spot === pinned);

  guard('every map has a seeker with a full bark set', () => {
    for (const key of MAPS){
      const r = ROOMS[key];
      if (!LOOKERS[r.looker]) throw new Error(key + ' has no seeker');
      const L = LOOKERS[r.looker];
      for (const k of ['PAINT','TEXTURE','POSE','SPOT','NERVE','near','great'])
        if (!L.barks[k]) throw new Error(r.looker + ' missing bark ' + k);
      if (!L.intro || !L.capture || !L.depart) throw new Error(r.looker + ' missing lines');
    }
  });
  guard('grades cover the whole 0..100 range', () => {
    for (let s = 0; s <= 100; s += 5) if (!gradeFor(s)) throw new Error('no grade at ' + s);
  });
  guard('rounds cycle through every map and roll into night 2', () => {
    titleReset();
    for (let i = 0; i < MAPS.length; i++){
      G.round = i; newRound();
      if (G.room !== MAPS[i]) throw new Error('round ' + i + ' -> ' + G.room);
    }
    G.round = MAPS.length; newRound();
    if (G.room !== MAPS[0] || G.night !== 2) throw new Error('did not wrap into night 2');
  });

  // run every screen
  const screens = ['TITLE','PAINT','EDITOR','HIDE','RESULT'];
  for (const s of screens){
    guard('600 steps + render on ' + s, () => {
      G.round = 0; newRound(); Dlg.active = false;
      G.spot = ROOMS.CH1.spots[0]; setPose('CUBE','FLATTEN');
      G.grid = bak.slice(); blankDirty = true;
      G.bars = computeScore(); G.score = G.bars.total;
      if (s === 'EDITOR') edOpen();
      if (s === 'HIDE'){ hideBegin(); Dlg.active = false; }
      if (s === 'RESULT'){ hideBegin(); Dlg.active = false; hideEnd(false); Dlg.active = false; resultsBegin(); }
      G.st = s;
      for (let i = 0; i < 600; i++){ update(STEP); render(); }
    });
  }
  guard('the eyedropper screen runs', () => {
    G.round = 0; newRound(); Dlg.active = false;
    G.spot = ROOMS.CH1.spots[0];
    G.st = 'EDITOR'; edOpen(); ED.dropper = true;
    for (let i = 0; i < 120; i++){ update(STEP); render(); }
    ED.dropper = false;
  });
  guard('being found resolves to the result screen', () => {
    G.round = 0; newRound(); Dlg.active = false;
    G.spot = ROOMS.CH1.spots[0]; setPose('CUBE','FLATTEN');
    G.grid = new Uint8Array(G.grid.length).fill(WHITE_IDX); blankDirty = true;
    hideBegin(); Dlg.active = false;
    for (let i = 0; i < 60*200 && !HIDE.over; i++) hideUpdate(STEP);
    if (!HIDE.found) throw new Error('a white body was not found');
    Dlg.active = false; resultsBegin();
    for (let i = 0; i < 200; i++){ update(STEP); render(); }
  });

  titleReset(); G.st = 'TITLE';
  const fails = out.filter(l => l.startsWith('FAIL'));
  console.log('%c' + out.join('\n'), 'font-family:monospace');
  const box = document.createElement('div');
  box.id = 'smokeout';
  box.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:#000;color:#0f0;'
    + 'font:11px monospace;padding:6px;white-space:pre;max-height:100vh;overflow:auto';
  box.textContent = out.join('\n') + '\n\n' + (fails.length ? fails.length + ' FAILURES' : 'ALL ' + out.length + ' PASSED');
  document.body.appendChild(box);
}
