/* ---------- scene baking: one wrapper fills pixels, indices and tags ---------- */
const TAGNAMES = ['NOTHING'];
function tagId(name){
  let i = TAGNAMES.indexOf(name);
  if (i < 0){ i = TAGNAMES.length; TAGNAMES.push(name); }
  return i;
}

/* deterministic hash noise so scenes bake identically every time */
function nz(x, y, seed){
  let h = (x * 374761393 + y * 668265263 + (seed|0) * 1442695040888963407) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

class Scene {
  constructor(w, h){
    this.w = w; this.h = h;
    this.cv = document.createElement('canvas'); this.cv.width = w; this.cv.height = h;
    this.c = this.cv.getContext('2d', { alpha:false }); nosmooth(this.c);
    this.idx = new Uint8Array(w * h).fill(WHITE_IDX);
    this.tag = new Uint8Array(w * h);
    this.solid = new Uint8Array(w * h);          // collision mask
    this.tagStack = [0];
  }
  /* paint-fill: the ONLY way scene pixels are written */
  pf(x, y, w, h, pi, tag){
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    if (w <= 0 || h <= 0) return;
    const t = tag === undefined ? this.tagStack[this.tagStack.length-1] : (typeof tag === 'string' ? tagId(tag) : tag);
    this.c.fillStyle = PAL[pi];
    this.c.fillRect(x, y, w, h);
    const x0 = Math.max(0,x), x1 = Math.min(this.w, x+w);
    const y0 = Math.max(0,y), y1 = Math.min(this.h, y+h);
    for (let yy = y0; yy < y1; yy++){
      const row = yy * this.w;
      this.idx.fill(pi, row + x0, row + x1);
      this.tag.fill(t, row + x0, row + x1);
    }
  }
  px(x, y, pi, tag){ this.pf(x, y, 1, 1, pi, tag); }
  under(tag, fn){ this.tagStack.push(typeof tag === 'string' ? tagId(tag) : tag); fn(this); this.tagStack.pop(); }
  block(x, y, w, h){                              // collision only, no pixels
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, x + Math.round(w)), y1 = Math.min(this.h, y + Math.round(h));
    for (let yy = y; yy < y1; yy++) this.solid.fill(1, yy * this.w + x, yy * this.w + x1);
  }
  at(x, y){
    x = Math.max(0, Math.min(this.w-1, x|0)); y = Math.max(0, Math.min(this.h-1, y|0));
    return this.idx[y * this.w + x];
  }
  tagAt(x, y){
    x = Math.max(0, Math.min(this.w-1, x|0)); y = Math.max(0, Math.min(this.h-1, y|0));
    return this.tag[y * this.w + x];
  }
  solidAt(x, y){
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 1;
    return this.solid[(y|0) * this.w + (x|0)];
  }

  /* ---- texture helpers: no backdrop may be a flat rectangle ---- */
  grain(x, y, w, h, base, alt, seed, density, tag){   // horizontal plank grain
    this.pf(x, y, w, h, base, tag);
    for (let yy = 0; yy < h; yy++){
      if ((yy + (nz(0,yy,seed) * 3 | 0)) % 4) continue;
      for (let xx = 0; xx < w; xx++)
        if (nz(xx, yy, seed) < (density || 0.72)) this.px(x+xx, y+yy, alt, tag);
    }
  }
  speck(x, y, w, h, base, alts, seed, density, tag){  // noisy stone / soil
    this.pf(x, y, w, h, base, tag);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++){
      const r = nz(x+xx, y+yy, seed);
      if (r < density) this.px(x+xx, y+yy, alts[(r * 977 | 0) % alts.length], tag);
    }
  }
  checker(x, y, w, h, a, b, cell, tag){
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++)
      this.px(x+xx, y+yy, ((((x+xx)/cell)|0) + (((y+yy)/cell)|0)) % 2 ? b : a, tag);
  }
  stripe(x, y, w, h, a, b, wid, tag){
    for (let xx = 0; xx < w; xx++)
      this.pf(x+xx, y, 1, h, (((x+xx)/wid)|0) % 2 ? b : a, tag);
  }
  bricks(x, y, w, h, faceA, faceB, mortar, bw, bh, seed, tag){
    this.pf(x, y, w, h, mortar, tag);
    for (let ry = 0; ry * bh < h; ry++){
      const off = (ry % 2) * (bw >> 1);
      for (let rx = -1; rx * bw < w + bw; rx++){
        const bx = x + rx * bw + off + 1, by = y + ry * bh + 1;
        const f = nz(rx, ry, seed) < 0.42 ? faceB : faceA;
        const cx0 = Math.max(x, bx), cy0 = Math.max(y, by);
        const cx1 = Math.min(x + w, bx + bw - 1), cy1 = Math.min(y + h, by + bh - 1);
        if (cx1 > cx0 && cy1 > cy0) this.pf(cx0, cy0, cx1-cx0, cy1-cy0, f, tag);
        // weathering, so no brick is ever a flat rectangle
        for (let k = 0; k < 3; k++){
          if (nz(rx, ry, seed + 7 + k*5) > 0.72) continue;
          const wx = bx + 1 + (nz(rx, ry+k, seed+9) * (bw-3) | 0);
          const wy = by + (nz(rx+k, ry, seed+11) * (bh-2) | 0);
          if (wx >= x && wx < x+w && wy >= y && wy < y+h)
            this.px(wx, wy, k === 2 ? mortar : (f === faceA ? faceB : faceA), tag);
        }
      }
    }
  }
  vgrad(x, y, w, h, idxs, tag){                    // banded vertical ramp
    const n = idxs.length;
    for (let i = 0; i < n; i++){
      const y0 = y + Math.floor(h * i / n), y1 = y + Math.floor(h * (i+1) / n);
      this.pf(x, y0, w, y1-y0, idxs[i], tag);
    }
  }
}
