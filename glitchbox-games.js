// ══════════════════ GLITCHBOX GAME CATALOG + THUMBNAILS ══════════════════
// Shared by the hub (index.html) and the framed play page (play.html) so the
// roster and its canvas art only ever live in one place.

const GAMES=[
  {name:'Fatespine',           file:'fatespine.html',              emoji:'\u23f3',color:['#0a0410','#24103a'],category:'action',     tags:['new','hot']},
  {name:'Blast Radius',        file:'blast-radius.html',            emoji:'💥',color:['#03040c','#141d44'],category:'multiplayer',tags:['new','hot','mp']},
  {name:'Neon Frag',           file:'neon-frag.html',              emoji:'🔫',color:['#05070e','#101b33'],category:'multiplayer',tags:['new','hot','mp']},
  {name:'Mic Drop',            file:'mic-drop.html',               emoji:'🎤',color:['#12061f','#2a0f4a'],category:'multiplayer',tags:['new','mp']},
  {name:'Wet Paint',           file:'wet-paint.html',              emoji:'🎨',color:['#1a0e08','#2e1a10'],category:'adventure',  tags:['new','hot']},
  {name:'Magic Wand',          file:'magic-wand.html',             emoji:'🪄',color:['#0a0616','#1a0f33'],category:'other',      tags:['new','hot']},
  {name:'Neon Putt',           file:'neon-putt.html',              emoji:'⛳',color:['#04120f','#0a2620'],category:'puzzle',     tags:['new','hot']},
  {name:'Barrier',             file:'barrier.html',                emoji:'🚧',color:['#02140f','#04241b'],category:'action',     tags:['new','hot']},
  {name:'Quoridor',            file:'quoridor.html',               emoji:'🧱',color:['#0a1428','#12233f'],category:'strategy',   tags:['new','mp']},
  {name:'Pixel War',           file:'pixel-war.html',              emoji:'🪖',color:['#0a1800','#1a3008'],category:'action',     tags:['hot']},
  {name:'Pixel War Alt',       file:'pixelwar.html',               emoji:'⚔️',color:['#100a20','#201030'],category:'action',     tags:[]},
  {name:'Pixel War Solo',      file:'pixelwar-solo.html',          emoji:'🚀',color:['#00101a','#001828'],category:'action',     tags:[]},
  {name:'War Combined',        file:'war-combined.html',           emoji:'🛡️',color:['#180000','#300808'],category:'action',     tags:['hot'],price:120,blurb:'Two arsenals in one battlefield — subs, carriers, jets and armor'},
  {name:'Nuclear DEFCON',      file:'nuclear.html',                emoji:'☢️',color:['#141000','#242000'],category:'strategy',   tags:['hot']},
  {name:'Spaceship',           file:'spaceship-solo.html',         emoji:'🚀',color:['#020510','#060f28'],category:'action',     tags:['hot']},
  {name:'Spaceship MP',        file:'spaceship-mp.html',           emoji:'🛸',color:['#040610','#080f26'],category:'multiplayer',tags:['mp']},
  {name:'Build a Bridge',      file:'build-a-bridge.html',         emoji:'🌉',color:['#060c18','#0c1830'],category:'puzzle',     tags:['hot']},
  {name:'Red Horizon',         file:'mars-colony.html',            emoji:'🔴',color:['#180400','#301000'],category:'simulation', tags:['new'],price:90,blurb:'Red Horizon — build a colony that survives the Martian night'},
  {name:'Untamed',             file:'national-park-tycoon.html',   emoji:'🏞️',color:['#041200','#082400'],category:'simulation', tags:['new']},
  {name:'Park Simulator',      file:'national-park-simulator.html',emoji:'⛺',color:['#060e00','#0e1c00'],category:'simulation', tags:[]},
  {name:'Virus',               file:'virus.html',                  emoji:'🦠',color:['#0a0414','#180828'],category:'strategy',   tags:['hot']},
  {name:'Pathogen',            file:'pathogen.html',               emoji:'🧬',color:['#041208','#081e0e'],category:'strategy',   tags:[]},
  {name:'Last Transmission',   file:'last-transmission.html',      emoji:'📡',color:['#040a14','#081424'],category:'adventure',  tags:['new']},
  {name:'Last Transmission 3D',file:'last-transmission-3d.html',   emoji:'🌌',color:['#02040e','#060c1e'],category:'adventure',  tags:['new'],price:100,blurb:'The deep-space story, rebuilt in 3D'},
  {name:'Cheese Heist 3D',     file:'cheese-heist-3d.html',        emoji:'🧀',color:['#1a1500','#2a2200'],category:'action',     tags:[],price:80,blurb:'Full 3D stealth heist — grab the cheese, stay out of sight'},
  {name:'Fib Factory',         file:'fib-factory.html',            emoji:'🎭',color:['#1a001a','#2a002a'],category:'multiplayer',tags:['mp']},
  {name:'Yellowstone Carnage', file:'yellowstone-carnage.html',    emoji:'🌋',color:['#1a0a00','#2a1500'],category:'action',     tags:['new'],price:60,blurb:'Supervolcano chaos, no survivors guaranteed'},
  {name:'Speed Stars',         file:'speed-stars.html',            emoji:'🏎️',color:['#000a1a','#001030'],category:'action',     tags:[]},
  {name:'Hacker',              file:'hacker.html',                 emoji:'💻',color:['#001a00','#003300'],category:'puzzle',     tags:[]},
  {name:'DJ',                  file:'dj.html',                     emoji:'🎧',color:['#0a001a','#15002a'],category:'other',      tags:[]},
  {name:'Decision Roulette',   file:'decision-roulette.html',      emoji:'🎰',color:['#1a0000','#2a0a00'],category:'other',      tags:[]},
  {name:'Case Board',          file:'case-board.html',             emoji:'🔎',color:['#0a0a0a','#141414'],category:'puzzle',     tags:[]},
  {name:'Roach Rave',          file:'roach-rave.html',             emoji:'🪳',color:['#0d0a00','#1a1400'],category:'other',      tags:[],price:40,blurb:'Paste a YouTube link, watch roaches dance to it'},
  {name:'Nothing',             file:'nothing.html',                emoji:'⬜',color:['#080808','#101010'],category:'other',      tags:[]},
];

// ── CANVAS DRAWING HELPERS ──
const _F=(c,x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(x,y,w,h)};
const _C=(c,x,y,r,col)=>{c.fillStyle=col;c.beginPath();c.arc(x,y,r,0,6.28);c.fill()};
const _L=(c,x1,y1,x2,y2,col,lw=1)=>{c.strokeStyle=col;c.lineWidth=lw;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke()};
const _GV=(c,x,y,w,h,...s)=>{const g=c.createLinearGradient(x,y,x,y+h);s.forEach((v,i)=>g.addColorStop(i/(s.length-1),v));c.fillStyle=g;c.fillRect(x,y,w,h)};
const _ST=(c,n=35)=>{for(let i=0;i<n;i++){const x=(i*137.5)%320,y=(i*97.3)%200,s=i%7<1?2:1;c.fillStyle=`rgba(255,255,255,${.3+i%4*.17})`;c.fillRect(x,y,s,s)}};
const _SC=(c)=>{for(let y=0;y<200;y+=4){c.fillStyle='rgba(0,0,0,0.1)';c.fillRect(0,y+2,320,2)}};

// ── THUMBNAIL DRAW FUNCTIONS ──
const DRAW={

'fatespine':(c)=>{
  _GV(c,0,0,320,200,'#050308','#12061f','#24103a');
  // the Spine: a branching graph of nights, drawn behind everything
  const nodes=[[42,150],[78,132],[114,150],[152,128],[190,146],[228,124],[264,142],[290,112]];
  c.strokeStyle='rgba(122,80,180,.55)'; c.lineWidth=1.5;
  for(let i=0;i<nodes.length-1;i++){
    c.beginPath(); c.moveTo(nodes[i][0],nodes[i][1]);
    c.bezierCurveTo((nodes[i][0]+nodes[i+1][0])/2,nodes[i][1],
                    (nodes[i][0]+nodes[i+1][0])/2,nodes[i+1][1],
                    nodes[i+1][0],nodes[i+1][1]);
    c.stroke();
  }
  // the one edge that only exists because you changed something
  c.strokeStyle='#ffd24a'; c.lineWidth=2; c.setLineDash([4,3]);
  c.beginPath(); c.moveTo(152,128); c.lineTo(150,74); c.stroke(); c.setLineDash([]);
  const hex=(x,y,r,fill,stroke)=>{
    c.beginPath();
    for(let k=0;k<6;k++){const a=k/6*6.283; const px=x+Math.cos(a)*r, py=y+Math.sin(a)*r; k?c.lineTo(px,py):c.moveTo(px,py);}
    c.closePath(); c.fillStyle=fill; c.fill(); c.strokeStyle=stroke; c.lineWidth=1.5; c.stroke();
  };
  for(const n of nodes) hex(n[0],n[1],7,'#1c1430','#5a76a8');
  hex(152,128,8,'#2a1a08','#ffd24a');
  // the amber Fracture hanging off it
  c.save(); c.translate(150,70); c.rotate(0.785);
  _F(c,-7,-7,14,14,'#3a2a08');
  c.strokeStyle='#ffb01f'; c.lineWidth=2; c.strokeRect(-7,-7,14,14); c.restore();
  // neon ledges
  _F(c,24,176,120,2,'#ff3ad0'); _F(c,196,176,104,2,'#ff3ad0');
  _F(c,96,44,86,2,'rgba(255,58,208,.45)');
  // you, and the two of you that came before
  const vek=(x,y,col,al)=>{
    c.globalAlpha=al; c.fillStyle=col;
    c.beginPath(); c.moveTo(x-8,y); c.lineTo(x-7,y-26); c.lineTo(x-2,y-33);
    c.lineTo(x+3,y-33); c.lineTo(x+8,y-25); c.lineTo(x+9,y); c.closePath(); c.fill();
    c.fillStyle='#ffffff'; c.globalAlpha=al*0.9; _F(c,x+1,y-28,3,2,'#ffffff');
    c.globalAlpha=1;
  };
  vek(52,176,'#2ec6ff',.28); vek(80,176,'#3ad8ff',.42); vek(112,176,'#48e8ff',1);
  // the rewind tear
  c.globalAlpha=.5; _F(c,0,88,320,3,'#ff0044'); _F(c,4,91,320,2,'#00ffee'); c.globalAlpha=1;
  // chrono filmstrip
  for(let i=0;i<5;i++){
    _F(c,120+i*17,12,14,8,i<3?'#ff3ad0':'#1a1030');
    _F(c,120+i*17,10,14,1,'#0a0614');
  }
  _SC(c);
},

'blast-radius':(c)=>{
  _GV(c,0,0,320,200,'#03040c','#080e22','#141d44');
  _ST(c,24);
  // moon with a soft halo
  const mg=c.createRadialGradient(258,34,0,258,34,46);
  mg.addColorStop(0,'rgba(255,240,200,.26)'); mg.addColorStop(1,'rgba(255,240,200,0)');
  c.fillStyle=mg; c.beginPath(); c.arc(258,34,46,0,6.28); c.fill();
  _C(c,258,34,13,'#f6efd6'); _C(c,262,30,4,'rgba(120,130,160,.3)');
  // rolling ground, deep band under a neon crest
  const hy=x=>146+Math.sin(x*0.0195+0.6)*16+Math.sin(x*0.052+2.1)*6;
  const fillTo=(off,col)=>{ c.beginPath(); c.moveTo(0,200);
    for(let x=0;x<=320;x+=4) c.lineTo(x,hy(x)+off);
    c.lineTo(320,200); c.closePath(); c.fillStyle=col; c.fill(); };
  fillTo(0,'#12313f'); fillTo(9,'#0a1e2c');
  c.save(); c.shadowColor='rgba(60,255,190,.85)'; c.shadowBlur=8;
  c.strokeStyle='#3dffc0'; c.lineWidth=2; c.beginPath();
  for(let x=0;x<=320;x+=4){ if(x) c.lineTo(x,hy(x)); else c.moveTo(x,hy(x)); }
  c.stroke(); c.restore();
  // the shell's arc, mid-flight
  for(let i=0;i<=22;i++){ const t=i/22, x=48+t*180, y=hy(48)-10-88*Math.sin(Math.PI*t)+t*14;
    c.fillStyle='rgba(255,208,90,'+(0.22+0.62*(1-t)).toFixed(2)+')'; c.fillRect(x-1.5,y-1.5,3,3); }
  // impact
  const ex=234, ey=hy(234)-3;
  const eg=c.createRadialGradient(ex,ey,0,ex,ey,36);
  eg.addColorStop(0,'#fff6d8'); eg.addColorStop(.32,'#ffb03a');
  eg.addColorStop(.68,'rgba(255,80,20,.42)'); eg.addColorStop(1,'rgba(255,60,0,0)');
  c.fillStyle=eg; c.beginPath(); c.arc(ex,ey,36,0,6.28); c.fill();
  for(let i=0;i<11;i++){ const a=i*0.62, r=17+(i*7)%15;
    _F(c,ex+Math.cos(a)*r,ey+Math.sin(a)*r*0.8,2,2,'#ffe600'); }
  // the duellists
  const tank=(x,col,fill,ang)=>{
    const y=hy(x)+2;
    c.save(); c.strokeStyle=col; c.lineWidth=4; c.lineCap='round';
    c.shadowColor=col; c.shadowBlur=9;
    c.beginPath(); c.moveTo(x,y-11); c.lineTo(x+Math.cos(ang)*21,y-11-Math.sin(ang)*21); c.stroke(); c.restore();
    c.fillStyle=fill; c.strokeStyle=col; c.lineWidth=2;
    c.beginPath(); c.moveTo(x-15,y-3); c.lineTo(x-11,y-12); c.lineTo(x+11,y-12); c.lineTo(x+15,y-3);
    c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.arc(x,y-12,6,Math.PI,0); c.fill(); c.stroke();
    _F(c,x-15,y-3,30,4,'#0b1220');
    for(let i=0;i<5;i++) _F(c,x-12+i*6,y-2,2,2,col);
  };
  tank(48,'#00f5ff','#063a49',0.85);
  tank(268,'#ff0080','#4a0327',Math.PI-0.85);
  _SC(c);
},

'neon-frag':(c)=>{
  _GV(c,0,0,320,100,'#0a0f22','#1b2448');
  _GV(c,0,100,320,100,'#0b1020','#050810');
  // corridor walls in one-point perspective, meeting at the vanishing point
  const vp=[160,100];
  [[0,-1],[320,1]].forEach(([x,dir])=>{
    c.fillStyle=dir<0?'#0d5f80':'#0a4a66';
    c.beginPath(); c.moveTo(x,20); c.lineTo(x,180);
    c.lineTo(vp[0]-dir*54,vp[1]+34); c.lineTo(vp[0]-dir*54,vp[1]-34); c.closePath(); c.fill();
  });
  _F(c,106,66,108,68,'#7a0f3e');                       // back wall
  _F(c,106,66,108,4,'#ff2b8a');
  for(let i=1;i<5;i++) _L(c,0,100+i*i*3,320,100+i*i*3,'rgba(0,245,255,.09)',1);
  _C(c,160,104,7,'#ff2b8a');                            // opponent, mid-corridor
  _F(c,155,104,10,20,'#c9145f');
  // crosshair + gun
  _L(c,160,88,160,96,'#00f5ff',2); _L(c,160,112,160,120,'#00f5ff',2);
  _L(c,148,104,156,104,'#00f5ff',2); _L(c,164,104,172,104,'#00f5ff',2);
  c.fillStyle='#0d1526'; c.strokeStyle='#00f5ff'; c.lineWidth=2;
  c.beginPath(); c.moveTo(196,200); c.lineTo(204,158); c.lineTo(232,146);
  c.lineTo(250,152); c.lineTo(246,178); c.lineTo(258,200); c.closePath(); c.fill(); c.stroke();
  _SC(c);
},

'mic-drop':(c)=>{
  _GV(c,0,0,320,200,'#3a1160','#07030f');
  _ST(c,22);
  // note highway
  [[18,120,52],[78,96,38],[124,140,46],[178,74,56],[240,110,60]].forEach(([x,y,w],i)=>{
    c.fillStyle=i===3?'#ffe600':'#a44bff';
    c.globalAlpha=i===3?1:.75;
    c.beginPath(); c.roundRect ? c.roundRect(x,y,w,11,6) : c.rect(x,y,w,11); c.fill();
  });
  c.globalAlpha=1;
  _L(c,96,44,96,168,'rgba(255,255,255,.5)',2);          // now-line
  _C(c,96,101,6,'#00f5ff');
  // mic
  c.fillStyle='#e9e2ff'; c.beginPath(); c.roundRect ? c.roundRect(268,120,20,38,10) : c.rect(268,120,20,38); c.fill();
  _F(c,276,158,4,18,'#8a7fb0'); _F(c,266,176,24,5,'#8a7fb0');
  c.fillStyle='rgba(255,0,128,.25)'; c.beginPath(); c.arc(278,139,26,0,6.28); c.fill();
  c.fillStyle='#ffe600'; c.font='bold 15px monospace'; c.textAlign='left';
  c.fillText('♪  ♫   ♪', 16, 34);
  _SC(c);
},

'wet-paint':(c)=>{
  // brick wall, and a Blank half-painted into it
  _F(c,0,0,320,200,'#6E3A2C');
  const BR=['#6E3A2C','#A85C3E','#3B1F1A'];
  for(let ry=0;ry<12;ry++){
    const off=(ry%2)*16;
    for(let rx=-1;rx<12;rx++){
      const bx=rx*32+off, by=ry*18;
      _F(c,bx+1,by+1,30,16,((rx*7+ry*3)%5<2)?BR[0]:BR[1]);
      _F(c,bx+3+((rx*5+ry)%22),by+4+((rx+ry*3)%10),2,2,BR[2]);
    }
    _F(c,0,ry*18,320,1,BR[2]);
  }
  // the body: left half painted to match, right half still primer white
  const BX=118,BY=54,BW=84,BH=104;
  for(let y=0;y<BH;y++)for(let x=0;x<BW;x++){
    const wx=BX+x, wy=BY+y;
    if(x<BW*0.52){
      const ry=((wy/18)|0), rx=(((wx-(ry%2)*16)/32)|0);
      c.fillStyle=(((wy%18)===0)?BR[2]:(((rx*7+ry*3)%5<2)?BR[0]:BR[1]));
    } else c.fillStyle='#FFFFFF';
    c.fillRect(wx,wy,1,1);
  }
  // eyes, so it reads as a creature
  _F(c,BX+52,BY+22,8,10,'#111'); _F(c,BX+70,BY+22,8,10,'#111');
  // a dripping brush and three sampled swatches
  _F(c,26,120,10,54,'#3B1F1A'); _F(c,24,112,14,10,'#838C9E');
  _F(c,27,168,8,16,'#A85C3E'); _F(c,29,186,3,8,'#A85C3E');
  ['#A85C3E','#4E7C47','#357C82'].forEach((col,i)=>{
    _F(c,258,20+i*24,40,18,'#000'); _F(c,260,22+i*24,36,14,col);
  });
  // title plate
  _F(c,0,0,320,22,'rgba(0,0,0,0.72)');
  c.fillStyle='#F5D648';c.font='bold 15px ui-monospace,monospace';
  c.fillText('WET PAINT',10,16);
  c.fillStyle='#B4B4B4';c.font='11px ui-monospace,monospace';
  c.fillText('HIDE BY HAND',196,16);
},

'magic-wand':(c)=>{
  _GV(c,0,0,320,200,'#1a0f33','#05030a');
  // glow behind the tip
  const g=c.createRadialGradient(96,72,0,96,72,90);
  g.addColorStop(0,'rgba(255,214,138,0.55)');g.addColorStop(.45,'rgba(199,125,255,0.18)');
  g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(0,0,320,200);
  // wand, tip upper-left → handle lower-right
  c.save();c.translate(96,72);c.rotate(0.72);
  const wg=c.createLinearGradient(0,0,84,0);
  wg.addColorStop(0,'#6b4a2a');wg.addColorStop(.5,'#3a2515');wg.addColorStop(1,'#1d120a');
  c.fillStyle=wg;
  c.beginPath();c.moveTo(2,-3.4);c.lineTo(46,-4.6);c.lineTo(84,-5.6);
  c.lineTo(84,5.6);c.lineTo(46,4.6);c.lineTo(2,3.4);c.closePath();c.fill();
  c.fillStyle='#c9a24a';c.fillRect(42,-5.2,5,10.4);c.fillRect(72,-6,6,12);
  c.restore();
  // sparkle stars trailing from the tip
  const star=(x,y,r,col)=>{c.save();c.translate(x,y);c.fillStyle=col;
    c.shadowColor=col;c.shadowBlur=r*2.4;c.beginPath();
    for(let i=0;i<8;i++){const a=i*Math.PI/4,rr=(i%2)?r*.2:r;
      const px=Math.cos(a)*rr,py=Math.sin(a)*rr;i?c.lineTo(px,py):c.moveTo(px,py)}
    c.closePath();c.fill();c.restore()};
  star(96,72,15,'#fff6de');
  [[142,42,6],[168,64,4],[126,26,4],[60,40,5],[42,74,3],[186,36,3],[74,18,3]]
    .forEach(([x,y,r],i)=>star(x,y,r,i%2?'#ffd48a':'#ff9de0'));
  // little terminal window getting sped up
  _F(c,180,104,116,66,'rgba(6,4,12,0.9)');
  c.strokeStyle='rgba(255,160,90,0.35)';c.lineWidth=1;c.strokeRect(180.5,104.5,115,65);
  _F(c,180,104,116,11,'rgba(255,255,255,0.07)');
  _C(c,187,109.5,2.4,'#ff5f57');_C(c,195,109.5,2.4,'#febc2e');_C(c,203,109.5,2.4,'#28c840');
  ['#ffb37a','#7dffb0','#7dffb0','#b9aee0'].forEach((col,i)=>
    _F(c,186,122+i*10,[70,54,84,40][i],3,col));
  _F(c,186,162,8,4,'#ffb37a');
  // speed bar
  _F(c,24,182,272,8,'rgba(255,255,255,0.06)');
  const sg=c.createLinearGradient(24,0,250,0);
  sg.addColorStop(0,'#6b5cff');sg.addColorStop(.5,'#ff9de0');sg.addColorStop(1,'#ffd48a');
  c.fillStyle=sg;c.fillRect(24,182,226,8);
},

'neon-putt':(c)=>{
  _GV(c,0,0,320,200,'#05080f','#080d16');
  // neon green with a dogleg wall
  c.fillStyle='#0d2b2a';c.fillRect(24,34,272,132);
  c.save();c.beginPath();c.rect(24,34,272,132);c.clip();
  c.strokeStyle='rgba(80,255,200,0.05)';c.lineWidth=1;
  for(let y=-140;y<200;y+=12){_L(c,20,y,300,y+280,'rgba(80,255,200,0.05)',1);}
  c.restore();
  c.save();c.shadowColor='rgba(60,255,190,0.8)';c.shadowBlur=9;
  c.strokeStyle='#3dffc0';c.lineWidth=2.5;c.strokeRect(24,34,272,132);c.restore();
  // sand bunker + block
  c.fillStyle='rgba(226,190,110,0.20)';c.fillRect(96,116,54,38);
  c.strokeStyle='rgba(255,214,130,0.45)';c.lineWidth=1;c.strokeRect(96,116,54,38);
  c.fillStyle='#0a1626';c.fillRect(150,44,22,54);
  c.strokeStyle='#4fa8ff';c.lineWidth=2;c.strokeRect(150,44,22,54);
  // pink bumper
  c.save();c.shadowColor='#ff4fd8';c.shadowBlur=12;
  _C(c,206,132,13,'#2a0a20');c.strokeStyle='#ff4fd8';c.lineWidth=2.5;
  c.beginPath();c.arc(206,132,13,0,6.28);c.stroke();c.restore();
  // cup + flag
  c.save();c.shadowColor='#ffe98f';c.shadowBlur=10;
  _C(c,254,74,9,'#02060a');c.strokeStyle='#ffe27a';c.lineWidth=2;
  c.beginPath();c.arc(254,74,9,0,6.28);c.stroke();c.restore();
  _L(c,254,72,254,44,'#dfe9f2',2);
  c.fillStyle='#ff4f6b';c.beginPath();c.moveTo(255,44);c.lineTo(271,49);c.lineTo(255,55);c.fill();
  // aim line from ball
  c.fillStyle='rgba(180,245,255,0.55)';
  for(let i=0;i<7;i++)_C(c,78+i*13,110-i*4.5,2.4-i*0.18,'rgba(180,245,255,'+(0.6-i*0.06)+')');
  c.save();c.shadowColor='#bfefff';c.shadowBlur=10;_C(c,70,116,6,'#ffffff');c.restore();
  _SC(c);
},

'pixel-war':(c)=>{
  _GV(c,0,0,320,115,'#0c1a00','#1e3200');
  _GV(c,0,115,320,85,'#142800','#0e1e00');
  c.fillStyle='#0d2200';c.beginPath();c.moveTo(0,140);c.quadraticCurveTo(70,85,160,145);c.lineTo(160,200);c.lineTo(0,200);c.fill();
  c.beginPath();c.moveTo(320,135);c.quadraticCurveTo(250,88,160,145);c.lineTo(160,200);c.lineTo(320,200);c.fill();
  const tank=(tx,ty,dir,b,t)=>{
    _F(c,tx,ty,72,34,b);_F(c,tx+14,ty-18,38,20,t);
    _F(c,dir>0?tx+44:tx-30,ty-11,34,9,t);_F(c,tx-1,ty+30,74,13,'#111a08');
    for(let i=0;i<4;i++)_C(c,tx+10+i*18,ty+37,6,'#0a1006');
  };
  tank(28,93,1,'#4a5a2e','#363f22');tank(204,93,-1,'#5c3020','#402018');
  _C(c,162,92,30,'rgba(255,80,0,0.5)');_C(c,162,92,18,'rgba(255,160,0,0.7)');_C(c,162,92,8,'#ffe040');
  for(let i=0;i<8;i++){const a=i*Math.PI/4,r=42;_F(c,162+Math.cos(a)*r-2,92+Math.sin(a)*r-2,4,4,'#ff6600');}
  _SC(c);
},

'pixelwar':(c)=>{
  _GV(c,0,0,320,120,'#020408','#040810');_ST(c,25);
  _GV(c,0,120,320,80,'#0e1800','#0a1200');
  const tank=(tx,ty,dir,col)=>{_F(c,tx,ty,68,32,col);_F(c,tx+12,ty-16,36,18,col);_F(c,dir>0?tx+42:tx-28,ty-10,32,8,col);_F(c,tx-1,ty+28,70,12,'#050a02');};
  tank(30,95,1,'#223318');tank(200,95,-1,'#1e3320');tank(115,90,1,'#2a4022');
  _C(c,200,100,15,'rgba(255,150,0,0.7)');_C(c,200,100,7,'rgba(255,220,0,0.9)');
  _L(c,200,100,244,98,'rgba(255,200,0,0.5)',2);_SC(c);
},

'pixelwar-solo':(c)=>{
  _GV(c,0,0,320,130,'#040a00','#0e1c00');_GV(c,0,130,320,70,'#081400','#050e00');
  const rx=160,ry=95;
  c.strokeStyle='rgba(0,255,80,0.7)';c.lineWidth=1.5;c.beginPath();c.arc(rx,ry,42,0,6.28);c.stroke();
  [[rx-58,ry,rx-46,ry],[rx+46,ry,rx+58,ry],[rx,ry-58,rx,ry-46],[rx,ry+46,rx,ry+58]].forEach(([x1,y1,x2,y2])=>_L(c,x1,y1,x2,y2,'rgba(0,255,80,0.7)',1.5));
  _C(c,rx,ry,3,'rgba(0,255,80,0.8)');
  _F(c,143,78,28,13,'#5c3020');_F(c,148,68,16,11,'#402018');
  _F(c,114,148,68,28,'#4a5a2e');_F(c,127,130,36,18,'#363f22');_F(c,157,136,32,8,'#363f22');
  _SC(c);
},

'war-combined':(c)=>{
  _GV(c,0,0,320,90,'#040810','#080f20');_ST(c,15);
  _GV(c,0,90,320,110,'#041830','#020e1e');
  for(let w=0;w<3;w++){c.strokeStyle=`rgba(0,80,160,${0.2+w*0.1})`;c.lineWidth=1;c.beginPath();for(let x=0;x<=320;x+=20)c.lineTo(x,96+w*10+Math.sin(x*0.18)*3);c.stroke();}
  // Plane
  c.fillStyle='#607090';c.beginPath();c.moveTo(230,32);c.lineTo(170,38);c.lineTo(190,32);c.lineTo(170,26);c.fill();
  _F(c,170,31,6,2,'#8090a8');
  // Carrier
  _F(c,50,86,130,18,'#4a5060');_F(c,70,74,65,12,'#3a3f50');_F(c,90,68,8,8,'#2a3040');
  // Submarine
  _F(c,40,130,95,20,'#2a3820');_C(c,90,130,10,'#2a3820');_F(c,46,122,6,8,'#222c18');_F(c,48,110,2,12,'#222c18');
  // Tank on deck
  _F(c,210,84,52,18,'#4a5a2e');_F(c,218,75,28,12,'#363f22');_F(c,240,80,26,6,'#363f22');
  _SC(c);
},

'nuclear':(c)=>{
  _F(c,0,0,320,200,'#020408');_ST(c,50);
  const gx=160,gy=110,gr=72;
  c.save();c.beginPath();c.arc(gx,gy,gr,0,6.28);c.clip();
  _C(c,gx,gy,gr,'#051030');
  c.strokeStyle='rgba(30,60,140,0.3)';c.lineWidth=0.5;
  for(let i=1;i<4;i++){c.beginPath();c.ellipse(gx,gy,gr,gr*i/4,0,0,6.28);c.stroke();}
  for(let i=1;i<6;i++){c.beginPath();c.ellipse(gx,gy,gr*i/6,gr,0,0,6.28);c.stroke();}
  c.fillStyle='rgba(20,70,15,0.8)';
  c.beginPath();c.ellipse(gx-28,gy-5,18,30,-0.3,0,6.28);c.fill();
  c.beginPath();c.ellipse(gx+14,gy-8,13,22,0.2,0,6.28);c.fill();
  c.beginPath();c.ellipse(gx+48,gy-8,16,18,-0.1,0,6.28);c.fill();
  c.restore();
  c.strokeStyle='rgba(50,100,200,0.5)';c.lineWidth=1;c.beginPath();c.arc(gx,gy,gr,0,6.28);c.stroke();
  [[45,25,gx+25,gy+35,'#ff3333'],[280,15,gx-15,gy+35,'#ff6600'],[gx-10,8,gx-35,gy+25,'#ff2200']].forEach(([x1,y1,x2,y2,col])=>{
    c.strokeStyle=col;c.lineWidth=1.5;c.shadowColor=col;c.shadowBlur=6;
    c.beginPath();c.moveTo(x1,y1);c.quadraticCurveTo((x1+x2)/2+18,6,x2,y2);c.stroke();
    _C(c,x2,y2,5,col);c.shadowBlur=0;
  });
  c.fillStyle='#ff2200';c.font='bold 9px monospace';c.textAlign='left';c.fillText('DEFCON 1',10,20);
  _SC(c);
},

'spaceship-solo':(c)=>{
  _F(c,0,0,320,200,'#05060d');_ST(c,50);
  const ng=c.createRadialGradient(260,80,0,260,80,100);ng.addColorStop(0,'rgba(0,80,120,0.2)');ng.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=ng;c.fillRect(0,0,320,200);
  const sx=108,sy=100;
  c.fillStyle='#00d4a0';c.beginPath();c.moveTo(sx+44,sy);c.lineTo(sx,sy-22);c.lineTo(sx+8,sy);c.lineTo(sx,sy+22);c.fill();
  c.fillStyle='rgba(0,200,160,0.35)';c.beginPath();c.moveTo(sx+8,sy-8);c.lineTo(sx-16,sy);c.lineTo(sx+8,sy+8);c.fill();
  c.strokeStyle='#00ffaa';c.lineWidth=2;c.shadowColor='#00ffaa';c.shadowBlur=8;
  _L(c,sx+44,sy,292,sy,'#00ffaa',2);c.shadowBlur=0;
  [[238,68,'#ff4422'],[262,104,'#cc2200'],[248,138,'#ff4422']].forEach(([ex,ey,col])=>{
    c.fillStyle=col;c.beginPath();c.moveTo(ex-26,ey);c.lineTo(ex,ey-14);c.lineTo(ex+5,ey);c.lineTo(ex,ey+14);c.fill();
  });
  _C(c,262,104,11,'rgba(255,100,0,0.5)');_C(c,262,104,5,'rgba(255,200,0,0.7)');
  c.strokeStyle='rgba(0,212,160,0.3)';c.lineWidth=1;c.beginPath();
  for(let i=0;i<6;i++){const a=i*Math.PI/3-Math.PI/6;c.lineTo(26+20*Math.cos(a),26+20*Math.sin(a));}
  c.closePath();c.stroke();_SC(c);
},

'spaceship-mp':(c)=>{
  _F(c,0,0,320,200,'#05060d');_ST(c,60);
  const ng=c.createRadialGradient(160,100,0,160,100,140);ng.addColorStop(0,'rgba(40,0,80,0.3)');ng.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=ng;c.fillRect(0,0,320,200);
  [[88,68,'#00d4a0','#00ffaa'],[148,103,'#2288ff','#44aaff'],[88,138,'#00d4a0','#00ffaa']].forEach(([sx,sy,col,laser])=>{
    c.fillStyle=col;c.beginPath();c.moveTo(sx+34,sy);c.lineTo(sx,sy-17);c.lineTo(sx+6,sy);c.lineTo(sx,sy+17);c.fill();
    c.strokeStyle=laser;c.lineWidth=1.5;c.shadowColor=laser;c.shadowBlur=5;
    _L(c,sx+34,sy,sx+80,sy,laser,1.5);c.shadowBlur=0;
  });
  [[238,83,'#ff3322'],[258,100,'#cc2200'],[238,117,'#ff4433']].forEach(([ex,ey,col])=>{
    c.fillStyle=col;c.beginPath();c.moveTo(ex-20,ey);c.lineTo(ex,ey-12);c.lineTo(ex+4,ey);c.lineTo(ex,ey+12);c.fill();
  });
  _SC(c);
},

'build-a-bridge':(c)=>{
  _GV(c,0,0,320,100,'#0d2a4a','#1a3a5a');
  for(let i=0;i<8;i++){c.fillStyle=`rgba(150,180,220,${0.08+i%3*0.04})`;c.beginPath();c.ellipse(28+i*38,28+i%3*14,18+i%3*6,5,0,0,6.28);c.fill();}
  _GV(c,0,155,320,45,'#041830','#082040');
  for(let w=0;w<3;w++){c.strokeStyle=`rgba(0,120,200,${0.2+w*0.1})`;c.lineWidth=1;c.beginPath();for(let x=0;x<=320;x+=16)c.lineTo(x,159+w*8+Math.sin(x*0.2)*3);c.stroke();}
  c.fillStyle='#1a1a1a';
  c.beginPath();c.moveTo(0,200);c.lineTo(0,88);c.lineTo(58,98);c.lineTo(74,155);c.lineTo(0,155);c.fill();
  c.beginPath();c.moveTo(320,200);c.lineTo(320,88);c.lineTo(262,98);c.lineTo(246,155);c.lineTo(320,155);c.fill();
  c.strokeStyle='#7dd3fc';c.lineWidth=2;
  _L(c,74,93,160,73,'#7dd3fc',2);_L(c,160,73,246,93,'#7dd3fc',2);
  for(let i=0;i<7;i++){const bx=84+i*24,yc=73+Math.pow((i-3)/3,2)*20;_L(c,bx,yc,bx,133,'rgba(125,211,252,0.6)',1);}
  _F(c,74,131,172,9,'#334455');_F(c,74,137,172,4,'#2a3a4a');
  _F(c,142,121,28,11,'#ff6600');_F(c,145,114,22,8,'#ff8800');
  _SC(c);
},

'mars-colony':(c)=>{
  _GV(c,0,0,320,90,'#120808','#2a1006');_GV(c,0,90,320,110,'#3a1505','#260e04');
  for(let i=0;i<20;i++){const x=(i*137)%320,y=(i*97)%78;c.fillStyle='rgba(255,200,150,0.4)';c.fillRect(x,y,1,1);}
  c.fillStyle='#200a04';c.beginPath();c.moveTo(0,100);c.lineTo(40,78);c.lineTo(80,95);c.lineTo(120,72);c.lineTo(160,90);c.lineTo(200,70);c.lineTo(240,88);c.lineTo(280,75);c.lineTo(320,92);c.lineTo(320,100);c.fill();
  const dome=(cx,cy,r,col)=>{
    c.fillStyle=col+'22';c.beginPath();c.arc(cx,cy,r,Math.PI,0);c.fill();
    c.strokeStyle=col;c.lineWidth=1.5;c.beginPath();c.arc(cx,cy,r,Math.PI,0);c.stroke();
    _L(c,cx-r,cy,cx+r,cy,col,1.5);
    for(let s=1;s<4;s++){c.strokeStyle=col+'55';c.lineWidth=0.5;c.beginPath();c.arc(cx,cy,r*s/4,Math.PI,0);c.stroke();}
  };
  dome(130,142,48,'#f0a43c');dome(220,147,32,'#f0a43c');dome(55,150,22,'#cc8830');
  [[168,154,38,8,'#1a3050'],[172,164,38,8,'#1a3050'],[68,156,26,6,'#1a3050']].forEach(([x,y,w,h,col])=>{_F(c,x,y,w,h,col);for(let i=1;i<4;i++)_L(c,x+w*i/4,y,x+w*i/4,y+h,'rgba(0,150,255,0.3)',0.5);});
  _SC(c);
},

'national-park-tycoon':(c)=>{
  _GV(c,0,0,320,80,'#0a1a3a','#0c2040');_GV(c,0,80,320,120,'#061408','#091a0a');
  c.fillStyle='#0e2010';c.beginPath();c.moveTo(0,95);c.lineTo(50,55);c.lineTo(100,85);c.lineTo(160,45);c.lineTo(220,80);c.lineTo(270,50);c.lineTo(320,75);c.lineTo(320,100);c.lineTo(0,100);c.fill();
  c.fillStyle='rgba(200,220,255,0.25)';c.beginPath();c.moveTo(148,45);c.lineTo(160,40);c.lineTo(172,45);c.lineTo(163,50);c.lineTo(157,50);c.fill();
  const tree=(tx,ty,h,col)=>{c.fillStyle=col;c.beginPath();c.moveTo(tx,ty-h);c.lineTo(tx+h*.35,ty);c.lineTo(tx-h*.35,ty);c.fill();c.beginPath();c.moveTo(tx,ty-h*.65);c.lineTo(tx+h*.45,ty+h*.1);c.lineTo(tx-h*.45,ty+h*.1);c.fill();_F(c,tx-3,ty,6,10,'#2a1a08');};
  [[40,155,28,'#0d3010'],[70,160,24,'#122a0e'],[100,157,27,'#0d3010'],[190,155,30,'#0f2e0c'],[222,162,22,'#122a0e'],[256,157,26,'#0d3010'],[292,160,23,'#112808']].forEach(a=>tree(...a));
  c.fillStyle='rgba(180,140,80,0.3)';c.beginPath();c.moveTo(128,200);c.quadraticCurveTo(148,164,158,150);c.quadraticCurveTo(168,136,198,130);c.lineTo(202,134);c.quadraticCurveTo(172,140,162,153);c.quadraticCurveTo(152,168,132,200);c.fill();
  c.fillStyle='rgba(120,80,40,0.55)';c.beginPath();c.ellipse(164,166,12,7,0.2,0,6.28);c.fill();c.beginPath();c.ellipse(172,158,5,6,-0.2,0,6.28);c.fill();
  c.strokeStyle='rgba(100,60,20,0.5)';c.lineWidth=1.5;_L(c,174,153,171,147,'rgba(100,60,20,0.5)',1.5);_L(c,171,147,168,143,'rgba(100,60,20,0.5)',1.5);_L(c,171,147,173,143,'rgba(100,60,20,0.5)',1.5);
  _SC(c);
},

'national-park-simulator':(c)=>{
  _F(c,0,0,320,200,'#0a1a0a');
  [[20,20,80,60,'#0f2a0f'],[120,10,90,50,'#122e12'],[220,30,80,70,'#0e280e'],[30,100,70,70,'#102212'],[150,90,100,80,'#0d2010'],[250,110,60,70,'#112612']].forEach(([x,y,w,h,col])=>_F(c,x,y,w,h,col));
  _C(c,90,80,30,'rgba(10,60,120,0.55)');_C(c,240,150,20,'rgba(10,60,120,0.55)');
  c.strokeStyle='rgba(180,150,80,0.45)';c.lineWidth=3;c.beginPath();c.moveTo(0,100);c.quadraticCurveTo(160,80,320,120);c.stroke();c.beginPath();c.moveTo(160,0);c.quadraticCurveTo(150,100,155,200);c.stroke();
  [[145,92,10,8,'#f0a43c'],[155,96,8,8,'#f0a43c'],[148,104,12,6,'#cc8830']].forEach(([x,y,w,h,col])=>_F(c,x,y,w,h,col));
  [[60,50],[240,70],[180,160],[100,140],[280,90]].forEach(([x,y])=>_C(c,x,y,4,'#8B6914'));
  _SC(c);
},

'virus':(c)=>{
  _F(c,0,0,320,200,'#030a04');_ST(c,20);
  c.fillStyle='rgba(10,60,15,0.8)';
  c.beginPath();c.roundRect(30,60,45,100,5);c.fill();c.beginPath();c.roundRect(40,85,30,80,5);c.fill();
  c.beginPath();c.roundRect(118,50,36,60,5);c.fill();c.beginPath();c.roundRect(124,110,30,70,5);c.fill();
  c.beginPath();c.roundRect(158,46,100,74,5);c.fill();c.beginPath();c.roundRect(220,140,40,34,5);c.fill();
  [[80,90,'#80ff80',25],[140,70,'#80ff80',18],[182,66,'#00ff80',30],[242,80,'#66ff66',20],[262,152,'#80ff80',15],[132,142,'#40ff60',22]].forEach(([x,y,col,r])=>{
    _C(c,x,y,r,'rgba(0,255,80,0.1)');
    c.strokeStyle=col;c.lineWidth=1.5;c.shadowColor=col;c.shadowBlur=7;c.beginPath();c.arc(x,y,r,0,6.28);c.stroke();c.shadowBlur=0;
    _C(c,x,y,3,col);
  });
  c.strokeStyle='rgba(0,255,80,0.12)';c.lineWidth=1;[[80,90,140,70],[140,70,182,66],[182,66,242,80]].forEach(([x1,y1,x2,y2])=>{c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();});
  c.fillStyle='#80ff80';c.font='bold 8px monospace';c.textAlign='left';c.fillText('INFECTED: 2.4B',10,18);_SC(c);
},

'pathogen':(c)=>{
  _GV(c,0,0,320,200,'#02050c','#040c10');_ST(c,15);
  const cx=160,cy=108;
  const cg=c.createRadialGradient(cx,cy,50,cx,cy,78);cg.addColorStop(0,'rgba(0,255,136,0)');cg.addColorStop(.8,'rgba(0,255,136,0.1)');cg.addColorStop(1,'rgba(0,255,136,0)');c.fillStyle=cg;c.fillRect(82,30,156,156);
  c.strokeStyle='rgba(0,255,136,0.6)';c.lineWidth=2;c.shadowColor='#00ff88';c.shadowBlur=10;c.beginPath();c.arc(cx,cy,68,0,6.28);c.stroke();c.shadowBlur=0;
  c.fillStyle='rgba(0,40,20,0.35)';c.beginPath();c.arc(cx,cy,68,0,6.28);c.fill();
  c.strokeStyle='rgba(0,200,100,0.5)';c.lineWidth=1.5;c.beginPath();c.arc(cx,cy,26,0,6.28);c.stroke();c.fillStyle='rgba(0,80,40,0.5)';c.beginPath();c.arc(cx,cy,26,0,6.28);c.fill();
  for(let i=0;i<12;i++){const t=i/12*6.28,hx=cx+Math.cos(t)*14,hy=cy-22+i*3.6;_C(c,hx,hy,2.5,i%2?'#00ff88':'#00ddbb');if(i<11)_L(c,hx,hy,cx+Math.cos((i+1)/12*6.28)*14,cy-22+(i+1)*3.6,'rgba(0,180,100,0.4)',1);}
  [[240,60],[282,90],[202,172],[98,162],[58,78],[302,142]].forEach(([vx,vy])=>{
    _C(c,vx,vy,7,'rgba(255,34,0,0.15)');c.strokeStyle='rgba(255,34,0,0.65)';c.lineWidth=1;c.beginPath();c.arc(vx,vy,7,0,6.28);c.stroke();
    for(let s=0;s<6;s++){const sa=s*Math.PI/3;_L(c,vx+Math.cos(sa)*7,vy+Math.sin(sa)*7,vx+Math.cos(sa)*12,vy+Math.sin(sa)*12,'rgba(255,34,0,0.5)',1);}
  });
  _SC(c);
},

'last-transmission':(c)=>{
  _F(c,0,0,320,200,'#050810');
  [[180,70,88,'rgba(0,80,100,0.22)'],[118,130,68,'rgba(40,0,80,0.18)'],[250,110,58,'rgba(0,60,80,0.2)']].forEach(([x,y,r,col])=>{c.fillStyle=col;c.beginPath();c.arc(x,y,r,0,6.28);c.fill();});
  _ST(c,55);
  const ox=90,oy=100;
  [20,40,60,80,100].forEach((r,i)=>{c.strokeStyle=`rgba(111,214,200,${.5-i*.08})`;c.lineWidth=1;c.shadowColor='rgba(111,214,200,0.4)';c.shadowBlur=4;c.beginPath();c.arc(ox,oy,r,0,6.28);c.stroke();c.shadowBlur=0;});
  c.fillStyle='#4a5a6a';c.beginPath();c.moveTo(ox+12,oy);c.lineTo(ox-10,oy-8);c.lineTo(ox-5,oy);c.lineTo(ox-10,oy+8);c.fill();
  c.strokeStyle='#6fd6c8';c.lineWidth=1.5;c.beginPath();c.arc(ox+8,oy,10,Math.PI*1.2,Math.PI*1.8);c.stroke();_L(c,ox+8,oy,ox+8,oy-12,'#6fd6c8',1);
  c.fillStyle='rgba(111,214,200,0.65)';c.font='8px monospace';c.textAlign='left';
  ['> SIGNAL LOST','> SCANNING...','> FREQ: 2.4GHz','> ..........'].forEach((t,i)=>c.fillText(t,165,58+i*18));
  _F(c,165,130,40,2,'rgba(111,214,200,0.5)');_SC(c);
},

'last-transmission-3d':(c)=>{
  _F(c,0,0,320,200,'#040608');_ST(c,30);
  const vx=160,vy=100;
  c.strokeStyle='rgba(40,80,120,0.35)';c.lineWidth=1;
  for(let i=0;i<=7;i++){const x=i*46-12;_L(c,x,200,vx,vy,'rgba(40,80,120,0.25)',1);}
  for(let d=0;d<5;d++){const t=d/5,w2=(1-t)*155;c.strokeStyle=`rgba(40,80,120,${0.1+d*.04})`;c.lineWidth=0.5;c.strokeRect(vx-w2,vy+(1-t)*98-6,w2*2,6);}
  const pg=c.createRadialGradient(vx,vy,0,vx,vy,38);pg.addColorStop(0,'rgba(0,180,200,0.5)');pg.addColorStop(.5,'rgba(0,100,150,0.2)');pg.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=pg;c.fillRect(vx-38,vy-38,76,76);
  c.strokeStyle='rgba(0,200,220,0.6)';c.lineWidth=1.5;c.shadowColor='#00c8dc';c.shadowBlur=10;c.beginPath();c.arc(vx,vy,15,0,6.28);c.stroke();c.shadowBlur=0;
  c.fillStyle='rgba(60,80,100,0.8)';c.beginPath();c.moveTo(188,200);c.lineTo(150,158);c.lineTo(160,147);c.lineTo(170,158);c.lineTo(132,200);c.fill();
  _SC(c);
},

'cheese-heist-3d':(c)=>{
  _F(c,0,0,320,200,'#080808');
  for(let x=0;x<8;x++)for(let y=0;y<5;y++){if((x+y)%2===0)_F(c,x*40,y*40,40,40,'#0d0d0d');}
  const sg=c.createRadialGradient(160,0,0,160,0,130);sg.addColorStop(0,'rgba(255,220,100,0.22)');sg.addColorStop(.7,'rgba(255,200,80,0.05)');sg.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=sg;c.fillRect(0,0,320,200);
  _GV(c,128,138,64,44,'#1a1a1a','#0d0d0d');_F(c,118,178,84,9,'#0f0f0f');
  c.fillStyle='#d4a010';c.beginPath();c.moveTo(128,138);c.lineTo(192,138);c.lineTo(176,98);c.lineTo(144,98);c.fill();
  [[154,116,6],[168,128,4],[147,130,5]].forEach(([x,y,r])=>_C(c,x,y,r,'#a07800'));
  c.strokeStyle='#ffe040';c.lineWidth=1;c.beginPath();c.moveTo(128,138);c.lineTo(192,138);c.lineTo(176,98);c.lineTo(144,98);c.closePath();c.stroke();
  c.fillStyle='rgba(0,255,208,0.12)';c.beginPath();c.ellipse(248,158,15,22,0,0,6.28);c.fill();c.beginPath();c.arc(248,128,12,0,6.28);c.fill();
  c.strokeStyle='rgba(0,255,208,0.38)';c.lineWidth=1;c.beginPath();c.arc(248,128,12,0,6.28);c.stroke();_L(c,248,140,248,180,'rgba(0,255,208,0.18)',1);
  _SC(c);
},

'fib-factory':(c)=>{
  _GV(c,0,0,320,200,'#0d0015','#180025','#0d001a');_GV(c,0,152,320,48,'#100018','#08000f');
  _F(c,48,28,224,92,'rgba(255,93,143,0.08)');c.strokeStyle='rgba(255,93,143,0.45)';c.lineWidth=1.5;c.strokeRect(48,28,224,92);
  c.fillStyle='rgba(255,255,255,0.75)';c.font='bold 9px monospace';c.textAlign='center';
  c.fillText('What year was the',160,52);c.fillText('Eiffel Tower built?',160,68);
  [[54,132,'#ff5d8f','1887'],[162,132,'#ffd24c','1889'],[54,163,'#5d8fff','1900'],[162,163,'#5dff8f','1901']].forEach(([x,y,col,txt])=>{
    c.fillStyle=col+'18';c.fillRect(x,y,96,23);c.strokeStyle=col;c.lineWidth=1;c.strokeRect(x,y,96,23);
    c.fillStyle=col;c.font='bold 8px monospace';c.textAlign='center';c.fillText(txt,x+48,y+14);
  });
  [[48,153,'#ff5d8f'],[128,156,'#ffd24c'],[208,152,'#5d8fff'],[274,154,'#5dff8f']].forEach(([px,py,col])=>{_F(c,px,py,30,40,col+'12');c.strokeStyle=col;c.lineWidth=1;c.strokeRect(px,py,30,40);_C(c,px+15,py+11,8,col+'38');});
  _SC(c);
},

'yellowstone-carnage':(c)=>{
  _GV(c,0,0,320,110,'#0d0800','#200c00','#3a1000');_GV(c,0,110,320,90,'#1a0f00','#0d0800');
  c.fillStyle='#0a0600';c.beginPath();c.moveTo(0,200);c.lineTo(0,130);c.lineTo(40,110);c.lineTo(80,90);c.lineTo(120,105);c.lineTo(160,60);c.lineTo(200,90);c.lineTo(240,85);c.lineTo(280,100);c.lineTo(320,110);c.lineTo(320,200);c.fill();
  const vg=c.createRadialGradient(160,60,0,160,60,58);vg.addColorStop(0,'rgba(255,150,0,0.9)');vg.addColorStop(.3,'rgba(255,80,0,0.5)');vg.addColorStop(.7,'rgba(200,30,0,0.2)');vg.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=vg;c.fillRect(100,0,120,130);
  [[154,57,3,'#ff8800'],[147,44,4,'#ffaa00'],[167,49,3,'#ff6600'],[139,37,2,'#ff4400'],[171,33,3,'#ffcc00'],[133,54,2,'#ff8800'],[179,46,3,'#ff5500'],[161,28,2,'#ffdd00'],[144,23,4,'#ff6600']].forEach(([x,y,r,col])=>_C(c,x,y,r,col));
  c.strokeStyle='rgba(255,80,0,0.55)';c.lineWidth=2;c.beginPath();c.moveTo(160,60);c.quadraticCurveTo(140,100,124,130);c.stroke();c.beginPath();c.moveTo(160,60);c.quadraticCurveTo(175,96,190,126);c.stroke();
  for(let i=0;i<5;i++){c.fillStyle=`rgba(50,30,10,${.18+i*.04})`;c.beginPath();c.arc(154+i*12,44-i*5,14+i*5,0,6.28);c.fill();}
  _SC(c);
},

'speed-stars':(c)=>{
  _F(c,0,0,320,200,'#000408');_ST(c,30);
  c.strokeStyle='rgba(0,255,208,0.28)';c.lineWidth=3;c.beginPath();c.roundRect(18,18,284,164,58);c.stroke();
  c.strokeStyle='rgba(0,255,208,0.18)';c.lineWidth=2;c.beginPath();c.roundRect(68,52,184,96,28);c.stroke();
  c.fillStyle='rgba(0,20,40,0.45)';c.beginPath();c.roundRect(18,18,284,164,58);c.fill();
  c.fillStyle='rgba(0,40,10,0.45)';c.beginPath();c.roundRect(68,52,184,96,28);c.fill();
  for(let i=0;i<5;i++)_F(c,157+i*7-17,i%2===0?14:19,7,10,i%2===0?'#fff':'#222');
  const rcar=(cx,cy,ang,col)=>{c.save();c.translate(cx,cy);c.rotate(ang);_F(c,-10,-5,20,10,col);_F(c,-6,-7,5,14,'rgba(0,0,0,0.45)');c.restore();};
  rcar(88,100,-0.2,'#00ffd0');rcar(128,40,0.5,'#ff3366');rcar(228,82,-2.8,'#ffcc00');
  c.strokeStyle='rgba(0,255,208,0.14)';c.lineWidth=1;[[78,98,50,96],[74,103,44,101],[82,107,54,105]].forEach(([x1,y1,x2,y2])=>{c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();});
  c.fillStyle='#00ffd0';c.font='bold 8px monospace';c.textAlign='right';c.fillText('340 km/h',310,20);
  _SC(c);
},

'hacker':(c)=>{
  _F(c,0,0,320,200,'#000000');
  const lines=['01001000 41 4B 45 52','> BREACH DETECTED...','DECRYPTING AES-256...','[####......] 42%','> ROOT ACCESS: OK','FIREWALL: BYPASSED','DOWNLOADING...........','> sudo rm -rf /logs','TRACE ROUTE: BOUNCE','IDENTITY: MASKED'];
  lines.forEach((t,i)=>{
    const alpha=i<2?0.9:i<5?0.7:i<8?0.5:0.3;
    c.fillStyle=`rgba(0,${i<5?255:180},${i<5?65:50},${alpha})`;
    c.font=`${i<2?'bold ':''}9px monospace`;c.textAlign='left';c.fillText(t,12,20+i*17);
  });
  c.fillStyle='rgba(0,255,65,0.12)';c.fillRect(8,48,114,16);c.strokeStyle='rgba(0,255,65,0.38)';c.lineWidth=1;c.strokeRect(8,48,114,16);
  _F(c,12,156,8,13,'rgba(0,255,65,0.75)');
  for(let y=0;y<200;y+=2)_F(c,0,y,320,1,'rgba(0,0,0,0.14)');
},

'dj':(c)=>{
  _GV(c,0,0,320,200,'#060609','#0a060f');
  _F(c,98,68,124,104,'#0d0d18');c.strokeStyle='rgba(139,92,246,0.28)';c.lineWidth=1;c.strokeRect(98,68,124,104);
  const turntable=(cx,cy,r)=>{
    _C(c,cx,cy,r,'#0a0a14');c.strokeStyle='rgba(139,92,246,0.38)';c.lineWidth=1.5;c.beginPath();c.arc(cx,cy,r,0,6.28);c.stroke();
    for(let gr=r*.3;gr<r*.95;gr+=r*.12){c.strokeStyle=`rgba(139,92,246,${.08+gr/r*.14})`;c.lineWidth=0.5;c.beginPath();c.arc(cx,cy,gr,0,6.28);c.stroke();}
    _C(c,cx,cy,r*.25,'#8b5cf6');_C(c,cx,cy,r*.08,'#060609');
    c.strokeStyle='rgba(6,214,245,0.55)';c.lineWidth=2;c.beginPath();c.moveTo(cx+r,cy-r*.7);c.lineTo(cx+r*.4,cy-r*.15);c.stroke();_C(c,cx+r*.4,cy-r*.15,3,'#06d6f5');
  };
  turntable(64,100,54);turntable(256,100,54);
  c.strokeStyle='rgba(6,214,245,0.65)';c.lineWidth=1.5;c.shadowColor='rgba(6,214,245,0.45)';c.shadowBlur=4;c.beginPath();c.moveTo(110,120);
  for(let i=0;i<=20;i++){const wx=110+i*5,amp=(8+Math.abs(Math.sin(i*.7))*18)*.5;c.lineTo(wx,120+(i%2===0?amp:-amp));}
  c.stroke();c.shadowBlur=0;
  [[107,140,'#8b5cf6'],[119,131,'#8b5cf6'],[131,143,'#8b5cf6'],[143,127,'#06d6f5'],[155,138,'#8b5cf6'],[167,124,'#8b5cf6'],[179,140,'#06d6f5'],[191,130,'#8b5cf6'],[203,141,'#8b5cf6']].forEach(([fx,fh,col])=>{_F(c,fx,fh,7,60,'rgba(255,255,255,0.04)');_F(c,fx,fh,7,4,col);});
  [[64,38,'#ff00ff'],[113,38,'#8b5cf6'],[163,38,'#06d6f5'],[213,38,'#ff00ff'],[262,38,'#8b5cf6']].forEach(([lx,ly,col],i)=>{if(i%2===0){c.shadowColor=col;c.shadowBlur=8;}_C(c,lx,ly,6,i%2===0?col:col+'88');c.shadowBlur=0;});
  _SC(c);
},

'decision-roulette':(c)=>{
  _GV(c,0,0,320,200,'#0d0010','#180018');
  const wx=160,wy=108,wr=82;
  const segs=[['#ff3366','YES'],['#ff6b35','NO'],['#ffd60a','MAYBE'],['#7209b7','HELL YES'],['#3a0ca3','NEVER'],['#4361ee','SURE'],['#4cc9f0','AGAIN?'],['#ff006e','YES!']];
  segs.forEach(([col,label],i)=>{
    const a1=i/segs.length*6.28-Math.PI/2,a2=(i+1)/segs.length*6.28-Math.PI/2;
    c.fillStyle=col+'cc';c.beginPath();c.moveTo(wx,wy);c.arc(wx,wy,wr,a1,a2);c.fill();
    c.strokeStyle='rgba(0,0,0,0.35)';c.lineWidth=1;c.beginPath();c.moveTo(wx,wy);c.arc(wx,wy,wr,a1,a2);c.stroke();
    const la=(a1+a2)/2;c.fillStyle='rgba(255,255,255,0.88)';c.font='bold 7px monospace';c.textAlign='center';c.textBaseline='middle';
    c.fillText(label,wx+Math.cos(la)*wr*.65,wy+Math.sin(la)*wr*.65);
  });
  c.strokeStyle='rgba(255,51,102,0.65)';c.lineWidth=3;c.shadowColor='#ff3366';c.shadowBlur=12;c.beginPath();c.arc(wx,wy,wr,0,6.28);c.stroke();c.shadowBlur=0;
  _C(c,wx,wy,11,'#0d0010');c.strokeStyle='#ff3366';c.lineWidth=2;c.beginPath();c.arc(wx,wy,11,0,6.28);c.stroke();
  c.fillStyle='#ffffff';c.beginPath();c.moveTo(wx,wy-wr-13);c.lineTo(wx-8,wy-wr+4);c.lineTo(wx+8,wy-wr+4);c.fill();
  _SC(c);
},

'case-board':(c)=>{
  _GV(c,0,0,320,200,'#2a1a08','#1e1206');
  for(let i=0;i<40;i++){c.fillStyle=`rgba(160,100,40,${.04+i%4*.02})`;c.fillRect((i*73)%310+5,(i*51)%190+5,i%3*7+4,2);}
  const note=(x,y,w,h,rot,col,lines)=>{c.save();c.translate(x+w/2,y+h/2);c.rotate(rot);_F(c,-w/2,-h/2,w,h,col);c.strokeStyle='rgba(0,0,0,0.1)';c.lineWidth=1;c.strokeRect(-w/2,-h/2,w,h);c.fillStyle='rgba(50,30,10,0.6)';c.font='7px monospace';c.textAlign='left';c.textBaseline='alphabetic';lines.forEach((l,i)=>c.fillText(l,-w/2+6,-h/2+14+i*12));c.restore();};
  note(18,14,100,80,-.05,'#f5e8c8',['SUSPECT #1','John Doe','Last seen 8pm','ALIBI: ???']);
  note(133,10,90,65,.04,'#e8d4a8',['CRIME SCENE','Warehouse 7','Evidence: key','fingerprints']);
  note(238,18,72,56,.03,'#f0ddb0',['TIMELINE','8:00 PM','10:30 PM','12:00 AM']);
  note(24,114,86,66,.02,'#dcc89a',['MOTIVE:','$2.4M missing','Swiss account']);
  note(184,100,90,70,-.03,'#e5d0a0',['WITNESS','M. Smith','Dark car','near alley']);
  [[68,54,'#ff3333'],[178,42,'#3366ff'],[274,46,'#33ff66'],[67,147,'#ff3333'],[229,135,'#ffcc00']].forEach(([px,py,col])=>{_C(c,px,py,5,col);_C(c,px,py,2,'rgba(255,255,255,0.5)');});
  c.strokeStyle='rgba(180,0,0,0.45)';c.lineWidth=1;[[68,54,178,42],[178,42,274,46],[68,54,67,147],[178,42,229,135],[67,147,229,135]].forEach(([x1,y1,x2,y2])=>{c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();});
  _SC(c);
},

'roach-rave':(c)=>{
  _GV(c,0,0,320,200,'#0a0612','#060310');
  for(let x=0;x<8;x++)for(let y=3;y<5;y++){const h=(x+y)*45%360;_F(c,x*40,y*40,40,40,`hsla(${h},55%,12%,0.7)`);c.strokeStyle=`hsla(${h},55%,22%,0.25)`;c.lineWidth=0.5;c.strokeRect(x*40,y*40,40,40);}
  _C(c,160,24,18,'#c0c8d0');for(let i=0;i<6;i++)for(let j=0;j<3;j++){const a=i/6*6.28,d=j/3*3.14;c.fillStyle=`rgba(255,255,255,${.08+i%2*.14})`;c.fillRect(160+Math.cos(a)*14-2,24+Math.sin(d)*10-1,5,3);}
  [['#ff2bd6',45],['#2bf0ff',100],['#b6ff3b',155],['#ff2bd6',210],['#2bf0ff',265]].forEach(([col,lx])=>{c.strokeStyle=col+'44';c.lineWidth=2;c.shadowColor=col;c.shadowBlur=5;c.beginPath();c.moveTo(160,30);c.lineTo(lx,185);c.stroke();c.shadowBlur=0;});
  const roach=(rx,ry,ang)=>{c.save();c.translate(rx,ry);c.rotate(ang);c.fillStyle='#1a1206';c.beginPath();c.ellipse(0,0,13,7,0,0,6.28);c.fill();c.beginPath();c.ellipse(4,-2,7,5,.3,0,6.28);c.fill();c.strokeStyle='#0f0c06';c.lineWidth=1;_L(c,9,-2,20,-9,'#0f0c06',1);_L(c,9,-2,22,-4,'#0f0c06',1);for(let l=0;l<3;l++){_L(c,-3+l*5,7,-9+l*5,15,'#0f0c06',1);_L(c,-3+l*5,-7,-9+l*5,-15,'#0f0c06',1);}c.restore();};
  [[58,140,0.3],[108,163,-0.2],[158,150,.3],[208,160,.4],[258,143,-0.3],[84,178,Math.PI],[198,173,Math.PI*.9],[140,168,Math.PI*1.8]].forEach(([rx,ry,a])=>roach(rx,ry,a));
  _SC(c);
},

'nothing':(c)=>{
  _F(c,0,0,320,200,'#f0f0f0');
  c.fillStyle='rgba(180,180,180,0.5)';c.font='12px monospace';c.textAlign='center';c.textBaseline='middle';c.fillText('nothing.',160,100);
},

fallback:(c,g)=>{
  _GV(c,0,0,320,200,g.color[0],g.color[1]);
  c.fillStyle='rgba(255,255,255,0.08)';c.font='56px sans-serif';c.textAlign='center';c.textBaseline='middle';
  c.fillText(g.emoji,160,100);_SC(c);
},
};
