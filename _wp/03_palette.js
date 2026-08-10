/* ---------- the 32-colour world palette (index = ramp*4 + value) ---------- */
const RAMPS = ['BRICK','OCHRE','MOSS','TEAL','SLATE','PLUM','SUGAR','PAPER'];
const PAL = [
  '#3B1F1A','#6E3A2C','#A85C3E','#D18C63',   // BRICK
  '#3A2E12','#6E5A22','#A88A38','#D8BE66',   // OCHRE
  '#16281A','#2C4A2E','#4E7C47','#86AF63',   // MOSS
  '#10262A','#1F4A50','#357C82','#6FB2B4',   // TEAL
  '#14161C','#2C313D','#4E5666','#838C9E',   // SLATE
  '#241428','#46264E','#6E3E7C','#A272B0',   // PLUM
  '#4A1F3A','#8A3763','#C2618E','#F0A0BE',   // SUGAR
  '#9C948A','#C7C0B2','#E8E4DA','#FFFFFF',   // PAPER
];
const WHITE_IDX = 31;                          // the unpainted Blank
const SHADEWORD = ['DEEP','SHADE','MID','LIGHT'];
const palName = i => RAMPS[i >> 2] + ' ' + (i & 3);

/* rgb + luminance per index */
const RGB = PAL.map(h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]);
const LUM = RGB.map(([r,g,b]) => 0.299*r + 0.587*g + 0.114*b);

/* ramp similarity, hand-authored, symmetric */
const RS_RAW = [
//BRICK OCHRE MOSS  TEAL  SLATE PLUM  SUGAR PAPER
  [1.00, 0.55, 0.12, 0.05, 0.10, 0.35, 0.30, 0.18],
  [0.55, 1.00, 0.35, 0.08, 0.10, 0.12, 0.18, 0.28],
  [0.12, 0.35, 1.00, 0.45, 0.22, 0.06, 0.05, 0.12],
  [0.05, 0.08, 0.45, 1.00, 0.50, 0.15, 0.08, 0.14],
  [0.10, 0.10, 0.22, 0.50, 1.00, 0.30, 0.18, 0.40],
  [0.35, 0.12, 0.06, 0.15, 0.30, 1.00, 0.60, 0.16],
  [0.30, 0.18, 0.05, 0.08, 0.18, 0.60, 1.00, 0.30],
  [0.18, 0.28, 0.12, 0.14, 0.40, 0.16, 0.30, 1.00],
];
const VSTEP = [1.00, 0.72, 0.26, 0.00];

const MATCH = new Float32Array(32 * 32);
(function bakeMatch(){
  for (let a = 0; a < 32; a++) for (let b = 0; b < 32; b++){
    let m;
    if (a === b) m = 1;
    else {
      m = VSTEP[Math.abs((a & 3) - (b & 3))] * RS_RAW[a >> 2][b >> 2];
      if (m < 0.05) m = 0;
    }
    MATCH[a * 32 + b] = m;
  }
})();
const matchRaw = (a,b) => MATCH[a * 32 + b];
const match = (a,b,textured) => textured ? Math.min(1, MATCH[a*32+b] + 0.10) : MATCH[a*32+b];

/* heat buckets for the results overlay */
function heatColour(m){
  if (m >= 0.95) return PAL[31];
  if (m >= 0.70) return PAL[10];
  if (m >= 0.40) return PAL[7];
  return PAL[2];
}

/* palette assertions the smoke test enforces */
function paletteAudit(){
  const out = [];
  out.push(['exact match is 1.00', matchRaw(13,13) === 1]);
  let s = 0, n = 0;
  for (let r = 0; r < 8; r++) for (let v = 0; v < 3; v++){ s += matchRaw(r*4+v, r*4+v+1); n++; }
  const sameRamp = s / n;
  out.push(['same-ramp dv=1 mean in [.66,.78] (' + sameRamp.toFixed(3) + ')', sameRamp >= 0.66 && sameRamp <= 0.78]);
  s = 0; n = 0;
  for (let r = 0; r < 7; r++) for (let v = 0; v < 4; v++){ s += matchRaw(r*4+v, (r+1)*4+v); n++; }
  const adj = s / n;
  out.push(['adjacent-ramp dv=0 mean in [.20,.58] (' + adj.toFixed(3) + ')', adj >= 0.20 && adj <= 0.58]);
  s = 0; n = 0;
  for (let a = 0; a < 32; a++) for (let b = 0; b < 32; b++)
    if (RS_RAW[a>>2][b>>2] < 0.15){ s += matchRaw(a,b); n++; }
  const far = n ? s / n : 0;
  out.push(['far-ramp mean < .12 (' + far.toFixed(3) + ')', far < 0.12]);
  out.push(['palette is 32 entries', PAL.length === 32]);
  out.push(['index 31 is white', PAL[31] === '#FFFFFF']);
  return out;
}
