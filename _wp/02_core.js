/* ---------- engine spine: canvas, timestep, input, dialogue ---------- */
const VW = 320, VH = 240, STEP = 1 / 60;
const UI = { BLACK:'#000000', WHITE:'#FFFFFF', DIM:'#B4B4B4', GHOST:'#5A5A5A',
             SOUL:'#FF4444', GOLD:'#F5D648', BLOOD:'#6E1B1B', CYAN:'#59D8E6' };

const view = document.getElementById('view');
const vctx = view.getContext('2d');
const buf  = document.createElement('canvas'); buf.width = VW; buf.height = VH;
const ctx  = buf.getContext('2d', { alpha:false });

let SCALE = 1;
function nosmooth(c){
  c.imageSmoothingEnabled = false;
  c.webkitImageSmoothingEnabled = false;
  c.mozImageSmoothingEnabled = false;
  c.msImageSmoothingEnabled = false;
}
function resize(){
  SCALE = Math.max(1, Math.floor(Math.min(innerWidth / VW, innerHeight / VH)));
  view.width = VW * SCALE; view.height = VH * SCALE;
  view.style.width = (VW * SCALE) + 'px'; view.style.height = (VH * SCALE) + 'px';
  nosmooth(vctx); nosmooth(ctx);
}
addEventListener('resize', resize);

/* ---------- input ---------- */
const KEYMAP = {
  ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right',
  KeyW:'up', KeyS:'down', KeyA:'left', KeyD:'right',
  KeyZ:'ok', Enter:'ok', KeyX:'no', ShiftLeft:'no', ShiftRight:'no',
  Backspace:'undo', KeyC:'menu', Escape:'pause', KeyM:'mute', KeyG:'ghost',
  KeyF:'fill', KeyQ:'dither', Tab:'peek', Space:'ok',
  Digit1:'s1', Digit2:'s2', Digit3:'s3', Digit4:'s4',
  Digit5:'s5', Digit6:'s6', Digit7:'s7', Digit8:'s8',
  BracketLeft:'brushdn', BracketRight:'brushup',
  KeyP:'pose', KeyO:'shape',
  Comma:'shadedn', Period:'shadeup', KeyE:'mirror', KeyR:'sig',
};
const held = {}, pressed = {}, buffered = {};
const BUFFER = 0.12;
let anyKeyYet = false;

function down(a){ return !!held[a]; }
function hit(a){                                  // consumes a buffered press
  if (buffered[a] > 0){ buffered[a] = 0; return true; }
  return false;
}
function peekHit(a){ return buffered[a] > 0; }
function clearHits(){ for (const k in buffered) buffered[k] = 0; }

addEventListener('keydown', e => {
  const a = KEYMAP[e.code];
  if (a === 'peek' || e.code === 'Space' || e.code.startsWith('Arrow') ||
      e.code === 'KeyZ' || e.code === 'KeyX' || e.code === 'Enter' ||
      e.code === 'Backspace') e.preventDefault();
  if (!anyKeyYet){ anyKeyYet = true; document.getElementById('boot').className = 'gone';
                   Audio_.start(); }
  if (e.repeat) return;                           // ignore auto-repeat entirely
  if (!a) return;
  held[a] = true; pressed[a] = true; buffered[a] = BUFFER;
  if (a === 'left' || a === 'right' || a === 'up' || a === 'down') dirPush(a);
  if (a === 'mute') Audio_.toggleMute();
});
addEventListener('keyup', e => {
  const a = KEYMAP[e.code]; if (!a) return;
  held[a] = false;
  if (a === 'left' || a === 'right' || a === 'up' || a === 'down') dirPop(a);
});
addEventListener('blur', () => { for (const k in held) held[k] = false; dirStack.length = 0; });

/* facing follows the press-order stack */
const dirStack = [];
function dirPush(d){ const i = dirStack.indexOf(d); if (i >= 0) dirStack.splice(i,1); dirStack.push(d); }
function dirPop(d){ const i = dirStack.indexOf(d); if (i >= 0) dirStack.splice(i,1); }
function topDir(){ return dirStack.length ? dirStack[dirStack.length-1] : null; }

function axis(){
  let ax = (down('right') ? 1 : 0) - (down('left') ? 1 : 0);
  let ay = (down('down')  ? 1 : 0) - (down('up')   ? 1 : 0);
  if (ax && ay){ ax *= 0.70711; ay *= 0.70711; }
  return [ax, ay];
}

/* ---------- primitives (no strokeRect, no gradients, no blur) ---------- */
function rect(c,x,y,w,h,col){ c.fillStyle = col; c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h)); }
function frame(c,x,y,w,h,t,col){                  // border as four fillRects
  x=Math.round(x); y=Math.round(y); w=Math.round(w); h=Math.round(h);
  rect(c,x,y,w,t,col); rect(c,x,y+h-t,w,t,col);
  rect(c,x,y+t,t,h-2*t,col); rect(c,x+w-t,y+t,t,h-2*t,col);
}
function panel(c,x,y,w,h,t,col){ rect(c,x,y,w,h,UI.BLACK); frame(c,x,y,w,h,t,col||UI.WHITE); }

/* 17-step ordered-dither wash, baked once — never globalAlpha */
const BAYER = [ 0, 8, 2,10, 12, 4,14, 6, 3,11, 1, 9, 15, 7,13, 5 ];
const DITHER = [];
function bakeDither(){
  for (let s = 0; s <= 16; s++){
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 4;
    const c = cv.getContext('2d'); c.fillStyle = '#000';
    for (let i = 0; i < 16; i++) if (BAYER[i] < s) c.fillRect(i % 4, (i / 4) | 0, 1, 1);
    DITHER.push(c.createPattern(cv, 'repeat'));
  }
}
function wash(c, step){                            // step 0..16 of blackness
  step = Math.max(0, Math.min(16, Math.round(step)));
  if (!step) return;
  if (step >= 16){ rect(c,0,0,VW,VH,UI.BLACK); return; }
  c.fillStyle = DITHER[step]; c.fillRect(0,0,VW,VH);
}

/* ---------- screen shake ---------- */
let shakeAmp = 0, shakeT = 0, shakeX = 0, shakeY = 0, shakeAcc = 0;
function shake(amp){ shakeAmp = Math.max(shakeAmp, amp); shakeT = 0.25; }
function shakeUpdate(dt){
  if (shakeT <= 0){ shakeX = shakeY = 0; shakeAmp = 0; return; }
  shakeT -= dt; shakeAcc += dt;
  if (shakeAcc >= 1/30){
    shakeAcc = 0;
    const a = shakeAmp * Math.max(0, shakeT / 0.25);
    shakeX = Math.round(a * (Math.random()*2-1));
    shakeY = Math.round(a * (Math.random()*2-1));
  }
}

/* ---------- hitstop ---------- */
let hitstop = 0;
const freeze = t => { hitstop = Math.max(hitstop, t); };

/* ---------- typewriter dialogue ---------- */
const BOX = { x:16, y:152, w:288, h:72, tx:28, ty:163, lh:14, lines:3, wrap:44, cwrap:42 };
const Dlg = {
  pages:[], page:0, lines:[], shown:0, total:0, acc:0, done:false, active:false,
  rate:30, voice:null, lock:0, pause:0, chevron:0, onEnd:null, colour:UI.WHITE, mono:false,

  wrap(s, bullet){
    const out = [];
    const first = bullet ? BOX.wrap : BOX.cwrap;
    let words = s.split(' '), line = bullet ? '* ' : '';
    const limit = () => (out.length === 0 && bullet) ? first : BOX.cwrap;
    for (const w of words){
      const cand = line.length ? line + ' ' + w : (out.length===0&&bullet ? '* ' + w : w);
      if (cand.length > limit() && line.length){ out.push(line); line = w; }
      else line = cand;
    }
    if (line.length) out.push(line);
    return out;
  },
  queue(pages, opts){
    opts = opts || {};
    this.pages = pages.map(p => typeof p === 'string' ? { t:p } : p);
    this.page = -1; this.active = true; this.onEnd = opts.onEnd || null;
    this.voice = opts.voice || VOICE.plain;
    this.colour = opts.colour || UI.WHITE;
    this.mono = !!opts.mono;                        // lowercase inner monologue
    this.rate = opts.rate || (this.mono ? 24 : 30);
    this.next();
  },
  next(){
    this.page++;
    if (this.page >= this.pages.length){
      this.active = false;
      const f = this.onEnd; this.onEnd = null; if (f) f();
      return;
    }
    const p = this.pages[this.page];
    this.lines = this.wrap(p.t, !this.mono);
    if (this.lines.length > BOX.lines) this.lines = this.lines.slice(0, BOX.lines);
    this.total = this.lines.reduce((a,l) => a + l.length, 0);
    this.shown = 0; this.acc = 0; this.done = false; this.chevron = 0; this.pause = 0;
    if (p.voice) this.voice = p.voice;
  },
  update(dt){
    if (!this.active) return;
    if (this.lock > 0) this.lock -= dt;
    const fast = down('ok') || down('no');
    if (this.pause > 0){ this.pause -= dt * (fast ? 4 : 1); return; }
    if (!this.done){
      const rate = this.rate * (fast ? 4 : 1);
      this.acc += dt;
      while (this.acc >= 1 / rate && !this.done){
        this.acc -= 1 / rate;
        const ch = this.charAt(this.shown);
        this.shown++;
        if (this.shown >= this.total){ this.done = true; break; }
        if (ch !== ' '){
          if (!fast || this.shown % 3 === 0) Audio_.blip(this.voice);
        }
        const nx = this.charAt(this.shown);
        if (nx === ' ' || nx === undefined){
          if (ch === ',') this.pause = 0.08;
          else if (ch === ';' || ch === ':') this.pause = 0.10;
          else if (ch === '.' || ch === '!' || ch === '?') this.pause = 0.16;
        }
        if (this.pause > 0) break;
      }
    } else {
      this.chevron += dt;
      if (hit('ok') && this.lock <= 0) this.next();
    }
    if (!this.done && hit('ok') && this.lock <= 0){
      this.shown = this.total; this.done = true; this.lock = 0.12;
    }
  },
  charAt(i){
    let n = 0;
    for (const l of this.lines){
      if (i < n + l.length) return l[i - n];
      n += l.length;
    }
    return undefined;
  },
  draw(c){
    if (!this.active) return;
    panel(c, BOX.x, BOX.y, BOX.w, BOX.h, 2, UI.WHITE);
    let n = 0;
    for (let li = 0; li < this.lines.length; li++){
      const l = this.lines[li];
      const vis = Math.max(0, Math.min(l.length, this.shown - n));
      const indent = (li > 0 && !this.mono) ? 12 : 0;
      txt(c, l.slice(0, vis), BOX.tx + indent, BOX.ty + li * BOX.lh, this.colour);
      n += l.length;
    }
    if (this.done && this.chevron > 0.25){
      const bob = [0,0,1,2,2,1][Math.floor(this.chevron / 0.1) % 6];
      const y = 211 + bob;
      rect(c, 288, y,   7, 1, UI.WHITE);
      rect(c, 289, y+1, 5, 1, UI.WHITE);
      rect(c, 290, y+2, 3, 1, UI.WHITE);
      rect(c, 291, y+3, 1, 1, UI.WHITE);
    }
  }
};
