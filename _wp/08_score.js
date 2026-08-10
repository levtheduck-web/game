/* ---------- scoring: five bars, deterministic, no RNG ---------- */
function stdev(arr){
  if (!arr.length) return 0;
  let m = 0; for (const v of arr) m += v; m /= arr.length;
  let s = 0; for (const v of arr) s += (v - m) * (v - m);
  return Math.sqrt(s / arr.length);
}

function computeScore(){
  if (!G.spot || !G.grid) return { total:0, paint:0, texture:0, pose:0, spot:0, nerve:0, cellM:null };
  const m = maskFor(G.shape, G.pose);
  const sc = getScene(G.room), a = G.spot.anchors[G.pose], tex = G.spot.textured;

  // 1. PAINT (50) — edge cells count triple
  let num = 0, den = 0;
  const cellM = new Float32Array(m.w * m.h).fill(-1);
  const bodyL = [], wallL = [];
  for (const cell of m.cells){
    const wall = sc.at(a[0] + cell.cx, a[1] + cell.cy);
    const mine = G.grid[cell.i];
    const mv = match(mine, wall, tex);
    cellM[cell.i] = mv;
    const w = cell.edge ? 3 : 1;
    num += w * mv; den += w;
    bodyL.push(LUM[mine]); wallL.push(LUM[wall]);
  }
  const raw = den ? num / den : 0;                  // unclamped weighted match, 0..1
  let paint = 50 * raw;
  // flattening only helps if there is actually something to flatten:
  // a single-colour base coat earns no craft bonus.
  const distinct = new Set(); for (const cell of m.cells) distinct.add(G.grid[cell.i]);
  if (G.pose === 'FLATTEN' && distinct.size > 1) paint *= 1.15;
  paint = Math.min(50, paint);

  // 2. TEXTURE (12) — does your roughness match the surface's?
  // a flat body over a varied surface reads as a sticker — punish it hard
  const texture = 12 * (1 - Math.min(1, Math.abs(stdev(bodyL) - stdev(wallL)) / 18));

  // 3. POSE (20)
  const poseFit = (G.shape === G.spot.wantShape && G.pose === G.spot.wantPose) ? 1.00
                : (G.pose === G.spot.wantPose) ? 0.65
                : (G.shape === G.spot.wantShape) ? 0.50 : 0.20;
  const pose = 20 * poseFit;

  // 4. SPOT (12) — plausibility: does your body actually fit here?
  const sp = G.spot;
  let overhang = 0;
  overhang += Math.max(0, sp.coverX - a[0]);
  overhang += Math.max(0, (a[0] + m.w) - (sp.coverX + sp.coverW));
  overhang += Math.max(0, sp.coverY - a[1]);
  overhang += Math.max(0, (a[1] + m.h) - (sp.coverY + sp.coverH));
  const slack = (sp.coverW - m.w) + (sp.coverH - m.h);
  let pl;
  if (sp.absurd.indexOf(G.pose) >= 0) pl = 0.15;
  else if (overhang > 2) pl = 0.15;
  else if (overhang > 0 || slack > 26) pl = 0.60;
  else pl = 1.00;
  const spot = 12 * pl;

  // 5. NERVE (6) — you get paid for choosing danger
  const nerve = 6 * (sp.exposure / 5);

  const total = Math.round(paint + texture + pose + spot + nerve);
  return { total, paint, texture, pose, spot:spot, nerve, poseFit, pl, cellM, raw,
           overhang, wantShape:sp.wantShape, wantPose:sp.wantPose };
}

const GRADES = [[92,'THE WALL ITSELF'],[80,'A'],[66,'B'],[50,'C'],[34,'D'],[-1,'IS THAT A GUY']];
function gradeFor(s){ for (const [t, g] of GRADES) if (s >= t) return g; return 'IS THAT A GUY'; }
const GRADEWORD = s => s >= 92 ? 'SEAMLESS' : s >= 80 ? 'CLOSE' : s >= 66 ? 'PASSABLE'
                     : s >= 50 ? 'ROUGH' : s >= 34 ? 'OBVIOUS' : 'A WHITE SHAPE';

/* which bar leaked the most points — drives the critique line and the bark */
function worstCategory(b){
  const loss = [['PAINT', 50 - b.paint], ['TEXTURE', 12 - b.texture], ['POSE', 20 - b.pose],
                ['SPOT', 12 - b.spot], ['NERVE', 6 - b.nerve]];
  loss.sort((x, y) => y[1] - x[1]);
  return loss[0][0];
}
function critiqueLine(b){
  const w = worstCategory(b);
  if (w === 'PAINT')   return 'YOUR COLOUR IS THE PROBLEM. THE EDGES MOST OF ALL.';
  if (w === 'TEXTURE') return b.texture < 6
                              ? 'FLAT PAINT ON A ROUGH SURFACE. IT READS AS A STICKER.'
                              : 'YOUR ROUGHNESS DOES NOT MATCH THIS SURFACE.';
  if (w === 'POSE')    return 'WRONG SHAPE FOR THIS PLACE. TRY ' + b.wantShape + ' + ' + b.wantPose + '.';
  if (w === 'SPOT')    return 'YOU DO NOT FIT HERE. PARTS OF YOU ARE SIMPLY OUT IN THE OPEN.';
  return 'SAFE CHOICE. SAFE DOES NOT PAY.';
}

/* worst 5x5 window — the double-take zooms here */
function worstWindow(){
  const m = maskFor(G.shape, G.pose), b = computeScore();
  let best = null, bestV = 2;
  for (let y = 0; y <= m.h - 5; y++) for (let x = 0; x <= m.w - 5; x++){
    let s = 0, n = 0;
    for (let oy = 0; oy < 5; oy++) for (let ox = 0; ox < 5; ox++){
      const v = b.cellM[(y+oy)*m.w + (x+ox)];
      if (v >= 0){ s += v; n++; }
    }
    if (n < 6) continue;
    const mean = s / n;
    if (mean < bestV){ bestV = mean; best = { x, y, mean }; }
  }
  return best || { x:0, y:0, mean:1 };
}
