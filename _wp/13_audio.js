/* ---------- audio: everything synthesised, nothing sampled ---------- */
const Audio_ = {
  ctx:null, master:null, muted:false, voices:0, track:null, bpm:96,
  nextNote:0, step:0, timer:null,

  start(){
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 6; comp.ratio.value = 8;
    comp.attack.value = 0.003; comp.release.value = 0.12;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    this.timer = setInterval(() => this.scheduler(), 25);
  },
  toggleMute(){
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
  },
  tone(type, freq, dur, gain, when, slideTo){
    if (!this.ctx || this.muted) return;
    if (this.voices > 8) return;
    const t = when || this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
    this.voices++;
    o.onended = () => { this.voices--; };
  },
  noise(dur, gain, when, f0, f1){
    if (!this.ctx || this.muted) return;
    const t = when || this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random()*2-1) * (1 - i/n);
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(f0 || 1200, t);
    if (f1) bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(bp); bp.connect(g); g.connect(this.master);
    s.start(t); s.stop(t + dur);
  },
  blip(v){
    v = v || VOICE.plain;
    const det = 1 + (Math.random()*0.07 - 0.035);
    this.tone(v.type, v.freq * det, v.dur, v.gain);
  },
  sfx(k){
    const C = this.ctx; if (!C) return;
    const t = C.currentTime;
    switch(k){
      case 'menu':     this.tone('square', 440, 0.04, 0.06); break;
      case 'confirm':  this.tone('square', 660, 0.06, 0.08); this.tone('square', 880, 0.06, 0.05, t+0.05); break;
      case 'back':     this.tone('square', 300, 0.07, 0.06); break;
      case 'brush':    this.noise(0.03, 0.035, t, 2600); break;
      case 'fill':     this.noise(0.14, 0.05, t, 500, 2000); break;
      case 'drop':     this.tone('sine', 900, 0.14, 0.11, t, 280); this.noise(0.04, 0.05, t, 1800); break;
      case 'drain':    this.tone('sine', 700, 0.30, 0.10, t, 180); this.noise(0.04, 0.04, t+0.02, 900); break;
      case 'commit':   this.tone('triangle', 220, 0.20, 0.10); this.tone('triangle', 330, 0.20, 0.07, t+0.06); break;
      case 'encounter':this.tone('square', 180, 0.10, 0.10); this.tone('square', 150, 0.16, 0.10, t+0.10);
                       this.noise(0.12, 0.05, t, 800, 2400); break;
      case 'hurt':     this.tone('sawtooth', 200, 0.16, 0.13, t, 90); this.noise(0.09, 0.07, t, 400); break;
      case 'heal':     this.tone('sine', 520, 0.10, 0.09); this.tone('sine', 780, 0.12, 0.07, t+0.08); break;
      case 'perfect':  [523,659,784,1047].forEach((f,i) => this.tone('square', f, 0.09, 0.08, t+i*0.05)); break;
      case 'good':     this.tone('square', 523, 0.08, 0.07); this.tone('square', 659, 0.09, 0.06, t+0.06); break;
      case 'bad':      this.tone('sawtooth', 150, 0.16, 0.09, t, 80); break;
      case 'ko':       this.tone('sawtooth', 330, 0.9, 0.13, t, 80);
                       for (let i = 0; i < 8; i++) this.noise(0.05, 0.05, t + i*0.03, 1600); break;
      case 'win':      [392,523,659,784].forEach((f,i) => this.tone('triangle', f, 0.16, 0.09, t+i*0.09)); break;
      case 'meh':      this.tone('triangle', 330, 0.2, 0.08); this.tone('triangle', 262, 0.3, 0.08, t+0.16); break;
    }
  },
  music(name, bpm){ this.track = name; this.bpm = bpm || 96; this.step = 0; this.nextNote = 0; },
  scheduler(){
    const C = this.ctx; if (!C || this.muted || !this.track) return;
    const spb = 60 / this.bpm / 2;                       // eighth notes
    if (!this.nextNote) this.nextNote = C.currentTime;
    while (this.nextNote < C.currentTime + 0.1){
      this.playStep(this.step, this.nextNote);
      this.step++; this.nextNote += spb;
    }
  },
  playStep(s, t){
    const A = [220,246.94,261.63,293.66,329.63,349.23,392];    // A natural minor
    const bar = s % 16;
    if (this.track === 'sweep'){
      if (bar % 2 === 0) this.tone('square', A[(s*3) % 7] * 2, 0.07, 0.035, t);
      if (bar % 8 === 0) this.tone('triangle', A[s % 3] / 2, 0.28, 0.075, t);
      if (bar % 4 === 2) this.noise(0.03, 0.022, t, 5200);
    } else if (this.track === 'reveal'){
      if (bar % 4 === 0) this.tone('triangle', A[(s*2) % 7], 0.30, 0.055, t);
      if (bar % 8 === 4) this.tone('sine', A[(s) % 7] * 2, 0.24, 0.035, t);
    } else if (this.track === 'coda'){
      if (bar % 8 === 0) this.tone('sine', A[(s/8) % 7 | 0], 1.2, 0.05, t);
    } else if (this.track === 'hub'){
      if (bar % 6 === 0) this.tone('triangle', A[(s*5) % 7], 0.22, 0.045, t);
      if (bar % 16 === 0) this.tone('sine', A[0] / 2, 0.8, 0.04, t);
    }
  },
};
