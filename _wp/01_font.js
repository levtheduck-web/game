/* ---------- 5x7 bitmap font baked into colour atlases ---------- */
const FW = 5, FH = 7, CW = 6, CH = 8;      // glyph 5x7 inside a 6x8 cell

function glyphRows(ch){
  const code = ch.charCodeAt(0);
  if (code < FONTDATA.first || code > FONTDATA.first + 94) return null;
  const off = (code - FONTDATA.first) * FH;
  const rows = [];
  for (let r = 0; r < FH; r++){
    const v = FONTDATA.alph.indexOf(FONTDATA.blob[off + r]);
    rows.push(v);                            // 5 bits, msb = leftmost pixel
  }
  return rows;
}

const ATLAS = {};                            // colour -> canvas of 16x6 cells
function bakeAtlas(colour){
  const cols = 16, rows = 6;
  const cv = document.createElement('canvas');
  cv.width = cols * CW; cv.height = rows * CH;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.fillStyle = colour;
  for (let i = 0; i < 95; i++){
    const ch = String.fromCharCode(FONTDATA.first + i);
    const g = glyphRows(ch); if (!g) continue;
    const ox = (i % cols) * CW, oy = ((i / cols) | 0) * CH;
    for (let y = 0; y < FH; y++){
      const bits = g[y];
      for (let x = 0; x < FW; x++)
        if (bits & (1 << (FW - 1 - x))) c.fillRect(ox + x, oy + y, 1, 1);
    }
  }
  return cv;
}
function atlas(colour){
  if (!ATLAS[colour]) ATLAS[colour] = bakeAtlas(colour);
  return ATLAS[colour];
}

/* draw text with the baked atlas — never fillText */
function txt(c, s, x, y, colour, scale){
  colour = colour || UI.WHITE; scale = scale || 1;
  const a = atlas(colour);
  x = Math.round(x); y = Math.round(y);
  for (let i = 0; i < s.length; i++){
    const code = s.charCodeAt(i) - FONTDATA.first;
    if (code < 0 || code > 94){ x += CW * scale; continue; }
    if (code !== 0){                              // skip blitting spaces
      const sx = (code % 16) * CW, sy = ((code / 16) | 0) * CH;
      c.drawImage(a, sx, sy, CW, CH, x, y, CW * scale, CH * scale);
    }
    x += CW * scale;
  }
  return x;
}
const txtW = (s, scale) => s.length * CW * (scale || 1);
function txtC(c, s, cx, y, colour, scale){      // centred
  txt(c, s, Math.round(cx - txtW(s, scale) / 2), y, colour, scale);
}
