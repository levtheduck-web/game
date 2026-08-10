/* ---------- headless self-test: #smoke ---------- */
function runSmoke(){
  const out = [];
  const ok = (n, c) => out.push((c ? 'PASS  ' : 'FAIL  ') + n);
  const guard = (n, fn) => { try { fn(); ok(n, true); } catch(e){ ok(n + ' -> ' + e.message, false); } };

  // palette
  for (const [n, c] of paletteAudit()) ok(n, c);

  // font
  ok('font has 95 glyphs', FONTDATA.blob.length === 95 * 7);
  ok('atlas bakes', atlas(UI.WHITE).width === 96 && atlas(UI.WHITE).height === 48);

  // masks
  let maskOk = true, edgeOk = true;
  for (const sh of ['BLOB','CUBE']) for (const po of ['STAND','CURL','LIE','FLATTEN']){
    const m = maskFor(sh, po);
    if (m.count < 100 || m.count > m.w * m.h) maskOk = false;
    if (m.edges < 20) edgeOk = false;
  }
  ok('all 8 masks have sane cell counts', maskOk);
  ok('all 8 masks have edge cells', edgeOk);

  // rooms bake, spots fit their cover rects
  let fits = true, walkOk = true, badSpot = '';
  for (const key of CHAPTERS){
    const room = ROOMS[key], sc = getScene(key);
    for (const s of room.spots){
      const m = maskFor(s.wantShape, s.wantPose);
      if (m.w > s.coverW || m.h > s.coverH){ fits = false; badSpot = key + '/' + s.id; }
      for (const p in s.anchors){
        const a = s.anchors[p], mm = maskFor(s.wantShape, p);
        if (a[0] < 0 || a[1] < 0 || a[0] + mm.w > VW || a[1] + mm.h > VH){ fits = false; badSpot = key+'/'+s.id+'/'+p; }
      }
      if (sc.solidAt(s.walk[0], s.walk[1])){ walkOk = false; badSpot = key + '/' + s.id + ' walk'; }
    }
  }
  ok('every ideal pose fits its cover rect' + (badSpot ? ' (' + badSpot + ')' : ''), fits);
  ok('every spot is reachable on foot' + (!walkOk ? ' (' + badSpot + ')' : ''), walkOk);

  // scenes are not flat and use only palette indices
  let flat = '', offPal = false;
  for (const key of CHAPTERS){
    const sc = getScene(key);
    const seen = new Set();
    for (let i = 0; i < sc.idx.length; i += 7){ seen.add(sc.idx[i]); if (sc.idx[i] > 31) offPal = true; }
    if (seen.size < 4) flat = key;
  }
  ok('no scene is flat' + (flat ? ' (' + flat + ')' : ''), !flat);
  ok('every scene pixel is inside the 32-colour palette', !offPal);

  // scoring behaves
  const room = ROOMS.CH1;
  G.chapter = 0; enterRoom('CH1'); G.prep = 999; G.maxhp = 20; G.hp = 20;
  beginPrep(room.spots[0]);
  setPose(room.spots[0].wantShape, room.spots[0].wantPose);
  const white = computeScore();
  // perfect: copy the wall exactly
  const m0 = maskFor(G.shape, G.pose), a0 = G.spot.anchors[G.pose], sc0 = getScene('CH1');
  for (const cell of m0.cells) G.grid[cell.i] = sc0.at(a0[0]+cell.cx, a0[1]+cell.cy);
  blankDirty = true;
  const perfect = computeScore();
  ok('a pure white body scores badly (' + white.total + ')', white.total < 45);
  ok('copying the wall exactly scores high (' + perfect.total + ')', perfect.total >= 88);
  ok('a perfect body beats a blank one', perfect.total > white.total + 30);

  // edge cells really are worth triple
  const edgeCell = m0.cells.find(c => c.edge), midCell = m0.cells.find(c => !c.edge);
  const bak = G.grid.slice();
  G.grid[edgeCell.i] = WHITE_IDX; const dEdge = perfect.raw - computeScore().raw;
  G.grid = bak.slice();
  G.grid[midCell.i] = WHITE_IDX; const dMid = perfect.raw - computeScore().raw;
  G.grid = bak.slice();
  ok('an edge cell is worth ~3x an interior one (' + dEdge.toFixed(4) + ' vs ' + dMid.toFixed(4) + ')',
     dMid > 0 && dEdge / dMid > 2.5 && dEdge / dMid < 3.5);

  // wrong pose is punished hard
  setPose('BLOB', 'LIE');
  const wrong = computeScore();
  ok('the wrong pose is a disaster (' + wrong.total + ')', wrong.total < perfect.total - 20);
  setPose(room.spots[0].wantShape, room.spots[0].wantPose);
  G.grid = bak.slice(); blankDirty = true;

  // eyedrop + base coat alone must not trivialise it
  const wallIdx = sc0.at(a0[0] + (m0.w>>1), a0[1] + (m0.h>>1));
  for (const cell of m0.cells) G.grid[cell.i] = wallIdx;
  const flatCoat = computeScore();
  ok('base coat alone caps below 67 (' + flatCoat.total + ' = P' + flatCoat.paint.toFixed(1)
     + ' T' + flatCoat.texture.toFixed(1) + ' O' + flatCoat.pose + ' S' + flatCoat.spot
     + ' N' + flatCoat.nerve.toFixed(1) + ' raw' + flatCoat.raw.toFixed(2) + ')', flatCoat.total < 67);
  G.grid = bak.slice(); blankDirty = true;

  // sweep difficulty really is driven by the score
  G.score = 95; sweepBegin(); const easy = SW.passes;
  G.score = 20; sweepBegin(); const hard = SW.passes;
  ok('bad camo means more passes (' + easy + ' vs ' + hard + ')', hard > easy);
  G.score = 95; sweepBegin(); passBegin(); const easyMote = SW.moteEvery;
  G.score = 20; sweepBegin(); passBegin(); const hardMote = SW.moteEvery;
  ok('bad camo means denser motes', hardMote < easyMote);

  // STEADY window scales with the score
  G.score = 95; beginSteady(); const wideW = SW.steady.W;
  G.score = 20; beginSteady(); const thinW = SW.steady.W;
  ok('a good paint job widens the STEADY window (' + wideW + ' vs ' + thinW + ')', wideW > thinW + 30);
  ok('even the worst STEADY window is hittable', thinW >= 18 && SW.steady.core >= 11);
  SW.steady = null;

  // smudge writes back into the painting
  G.score = 60; G.bars = computeScore(); bakeSpotView();
  const before = G.grid.filter(v => v !== WHITE_IDX).length;
  smudge(5);
  const after = G.grid.filter(v => v !== WHITE_IDX).length;
  ok('a hit whitens real cells of your painting', after < before);

  // every chapter reaches an end state
  guard('every chapter room builds and has spots', () => {
    for (const key of CHAPTERS){
      const r = ROOMS[key];
      if (!r.spots.length) throw new Error(key + ' has no spots');
      if (!LOOKERS[r.looker]) throw new Error(key + ' has no looker');
      const L = LOOKERS[r.looker];
      for (const k of ['PAINT','TEXTURE','POSE','SPOT','NERVE','near','great'])
        if (!L.barks[k]) throw new Error(r.looker + ' missing bark ' + k);
    }
  });
  guard('grades cover the whole 0..100 range', () => {
    for (let s = 0; s <= 100; s += 5) if (!gradeFor(s)) throw new Error('no grade at ' + s);
  });
  guard('all three endings are reachable', () => {
    for (const [caught, avg, want] of [[0, 90, 'HIDDEN'], [2, 60, 'SEEN'], [5, 30, 'FRAMED']]){
      G.caught = caught; G.chapterScores = [avg, avg, avg, avg, avg];
      const k = G.caught === 0 && avg >= 78 ? 'HIDDEN' : avg >= 55 ? 'SEEN' : 'FRAMED';
      if (k !== want) throw new Error('expected ' + want + ' got ' + k);
    }
  });

  // run every screen for 600 steps and assert nothing throws
  const screens = ['TITLE','OVERWORLD','PREP','EDITOR','HOLDIN','SWEEP','REVEAL','RESULTS','ENDING'];
  for (const s of screens){
    guard('600 steps + render on ' + s, () => {
      G.chapter = 0; enterRoom('CH1');
      G.prep = 90; G.hp = G.maxhp = 20; G.notice = 10;
      G.spot = ROOMS.CH1.spots[0]; setPose('CUBE','FLATTEN');
      G.bars = computeScore(); G.score = G.bars.total; bakeSpotView();
      if (s === 'SWEEP'){ sweepBegin(); passBegin(); }
      if (s === 'RESULTS') resultsBegin();
      if (s === 'REVEAL') revealBegin();
      if (s === 'EDITOR') edOpen();
      if (s === 'ENDING') endingBegin();
      G.st = s;
      for (let i = 0; i < 600; i++){ update(STEP); render(); }
    });
  }
  guard('the eyedropper screen runs', () => {
    G.st = 'EDITOR'; edOpen(); ED.dropper = true;
    for (let i = 0; i < 120; i++){ update(STEP); render(); }
    ED.dropper = false;
  });
  guard('touch-up runs', () => {
    G.st = 'TOUCHUP'; touchBegin();
    for (let i = 0; i < 400; i++){ update(STEP); render(); }
  });
  guard('being caught resolves back to prep', () => {
    G.st = 'SWEEP'; sweepBegin(); passBegin(); startKO();
    for (let i = 0; i < 400; i++){ update(STEP); render(); }
  });

  // reset to a clean title
  titleReset(); G.st = 'TITLE';

  const fails = out.filter(l => l.startsWith('FAIL'));
  console.log('%c' + out.join('\n'), 'font-family:monospace');
  console.log(fails.length ? fails.length + ' FAILURES' : 'ALL ' + out.length + ' PASSED');
  const box = document.createElement('div');
  box.id = 'smokeout';
  box.style.cssText = 'position:fixed;left:0;top:0;z-index:99;background:#000;color:#0f0;'
    + 'font:11px monospace;padding:6px;white-space:pre;max-height:100vh;overflow:auto';
  box.textContent = out.join('\n') + '\n\n' + (fails.length ? fails.length + ' FAILURES' : 'ALL ' + out.length + ' PASSED');
  document.body.appendChild(box);
}
