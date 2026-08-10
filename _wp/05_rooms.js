/* ---------- spots: cover rect in world px; 1 body cell = 1 world pixel ---------- */
const MASK_SIZE = { STAND:[11,20], CURL:[15,14], LIE:[22,9], FLATTEN:[16,16] };

function mkSpot(o){
  const a = {};
  for (const p in MASK_SIZE){
    const [mw, mh] = MASK_SIZE[p];
    const cx = o.coverX + (o.coverW - mw) / 2;
    const cy = (p === 'FLATTEN') ? o.coverY + (o.coverH - mh) / 2
                                 : o.coverY + o.coverH - mh;
    a[p] = [Math.round(cx), Math.round(cy)];
  }
  o.anchors = a;
  o.absurd = o.absurd || [];
  o.textured = !!o.textured;
  return o;
}

const ROOMS = {};

/* ============================ CH1 — THE ALLEY ============================ */
ROOMS.CH1 = {
  name:'UNDERCOAT ALLEY', label:'THE ALLEY', prep:75, target:60, looker:'BIB',
  start:[160,196], maxhp:20,
  build(s){
    s.under('UNDERCOAT BRICK', () => s.bricks(0,0,320,158, 1,2,0, 18,11, 1));
    s.under('THE MORTAR', () => { for (let y=10;y<158;y+=11) s.pf(0,y,320,1, 0); });
    s.under('THE COBBLES', () => { s.speck(0,158,320,82, 16,[17,4,12], 2, 0.22);
      for (let y=164;y<240;y+=9) s.pf(0,y,320,1, 12); });
    // drainpipe
    s.under('EAST GUTTER', () => {
      s.pf(246,0,12,158, 17); s.pf(248,0,3,158, 19); s.pf(255,0,2,158, 16);
      s.pf(244,44,16,7, 18); s.pf(244,112,16,7, 18);
    });
    // three bins
    s.under('THE BINS', () => {
      for (let i=0;i<3;i++){
        const bx = 30 + i*30;
        s.pf(bx,112,26,46, 13); s.pf(bx+2,114,22,42, 14);
        s.pf(bx,106,26,8, 15); s.pf(bx+8,102,10,5, 13);
        for (let k=0;k<5;k++) s.pf(bx+3,120+k*7,20,1, 12);
      }
    });
    // flyer stack
    s.under('THE FLYERS', () => {
      for (let i=0;i<9;i++){
        const fy = 96 + i*3, w = 34 - (i%3)*2;
        s.pf(146+(i%2),fy,w,3, i%2?30:29);
      }
      s.pf(146,124,36,4, 28);
    });
    // doorstep + door
    s.under('THE DOORSTEP', () => {
      s.pf(190,60,52,98, 4); s.pf(194,64,44,88, 18);
      s.grain(194,64,44,88, 18, 17, 4, 0.55, 'THE DOORSTEP');
      s.pf(190,150,56,10, 30); s.pf(190,158,56,4, 29);
    });
    s.block(30,106,86,52); s.block(190,60,56,98); s.block(244,0,16,158); s.block(0,0,320,156);
  },
  waypoints:[[40,190],[150,206],[268,190],[150,178]],
  props:[{ x:150, y:96, w:36, h:32, name:'FLYERS', talk:'CH1_FLYERS' },
         { x:30, y:100, w:86, h:20, name:'BINS', talk:'CH1_BINS' }],
  spots:[
    mkSpot({ id:'WALL', name:'THE FLAT WALL', coverX:96, coverY:60, coverW:36, coverH:40,
      wantShape:'CUBE', wantPose:'FLATTEN', exposure:3, textured:false, walk:[112,178],
      tagline:'* JUST WALL. NOTHING TO HIDE BEHIND. NOTHING TO GET WRONG.' }),
    mkSpot({ id:'BINS', name:'BEHIND THE BINS', coverX:58, coverY:112, coverW:30, coverH:44,
      wantShape:'BLOB', wantPose:'CURL', exposure:1, textured:false, walk:[72,182], absurd:['STAND'],
      tagline:'* THREE BINS AND A GAP. THE GAP IS THE POINT.' }),
    mkSpot({ id:'PIPE', name:'AGAINST THE DRAINPIPE', coverX:242, coverY:56, coverW:22, coverH:46,
      wantShape:'CUBE', wantPose:'STAND', exposure:4, textured:false, walk:[236,180],
      tagline:'* A TALL DARK STRIPE. YOU COULD BE A TALL DARK STRIPE.' }),
    mkSpot({ id:'FLYER', name:'IN THE FLYER STACK', coverX:146, coverY:98, coverW:36, coverH:28,
      wantShape:'CUBE', wantPose:'LIE', exposure:2, textured:true, walk:[164,178], absurd:['STAND'],
      tagline:'* PAPER. LOTS OF IT. NOBODY READS ANY OF IT.' }),
    mkSpot({ id:'STEP', name:'ON THE DOORSTEP', coverX:196, coverY:128, coverW:32, coverH:30,
      wantShape:'BLOB', wantPose:'CURL', exposure:5, textured:false, walk:[212,180],
      tagline:'* THIS IS WHERE HE STOPS TO WRITE THINGS DOWN.' }),
  ],
};

/* ============================ CH2 — THE POTTING SHED ============================ */
ROOMS.CH2 = {
  name:'THE POTTING SHED', label:'THE SHED', prep:70, target:65, looker:'TACKLE',
  start:[160,200], maxhp:22,
  build(s){
    s.under('A PLANK THAT HELD', () => s.grain(0,0,320,150, 5,4, 21, 0.68));
    for (let x=0;x<320;x+=54) s.under('THE UPRIGHT', () => s.pf(x,0,3,150, 3));
    s.under('THE SHED FLOOR', () => s.speck(0,150,320,90, 4,[5,0], 22, 0.22));
    // potting bench
    s.under('POTTING BENCH', () => {
      s.pf(16,116,120,8, 6); s.pf(16,124,6,34, 5); s.pf(130,124,6,34, 5);
      s.grain(16,116,120,8, 6,5, 23, 0.7, 'POTTING BENCH');
      for (let i=0;i<4;i++){ const px=24+i*28;
        s.pf(px,100,20,16, 2); s.pf(px-2,97,24,5, 3); s.pf(px+3,102,14,9, 1); }
    });
    // seed trays
    s.under('SIX HUNDRED BROWNS', () => {
      s.pf(150,126,60,26, 4);
      s.speck(152,128,56,22, 1,[0,5,4], 24, 0.5, 'SIX HUNDRED BROWNS');
      for (let i=1;i<4;i++) s.pf(150+i*15,126,1,26, 5);
    });
    // tool rail
    s.under('THE TOOL RAIL', () => {
      s.pf(224,40,86,4, 17);
      const tool=(x,h,c)=>{ s.pf(x,44,3,h,c); s.pf(x-3,44+h,9,5,c); };
      tool(234,26,18); tool(252,34,19); tool(272,22,16); tool(292,30,18);
    });
    // sack pile
    s.under('THE SACKS', () => {
      for (let i=0;i<3;i++){ const sx=232+i*22, sy=118+(i%2)*10;
        s.pf(sx,sy,26,34, 29); s.pf(sx+2,sy+2,22,30, 28);
        s.speck(sx+2,sy+2,22,30, 28,[29,30], 25+i, 0.25, 'THE SACKS'); }
    });
    // the door
    s.under('THE SHED DOOR', () => { s.pf(150,30,58,86, 5); s.grain(153,33,52,80, 6,4, 26, 0.6, 'THE SHED DOOR'); });
    s.block(16,96,120,62); s.block(150,120,60,34); s.block(232,112,70,44); s.block(0,0,320,150);
  },
  waypoints:[[36,192],[152,210],[276,192],[160,176]],
  props:[{ x:224, y:34, w:86, h:24, name:'RAIL', talk:'CH2_RAIL' }],
  spots:[
    mkSpot({ id:'PLANKS', name:'IN THE PLANK STACK', coverX:60, coverY:58, coverW:44, coverH:26,
      wantShape:'CUBE', wantPose:'LIE', exposure:2, textured:true, walk:[80,178], absurd:['STAND'],
      tagline:'* GRAIN GOES ACROSS. SO SHOULD YOU.' }),
    mkSpot({ id:'SACKS', name:'UNDER THE SACKS', coverX:238, coverY:116, coverW:32, coverH:38,
      wantShape:'BLOB', wantPose:'CURL', exposure:1, textured:true, walk:[252,182], absurd:['STAND'],
      tagline:'* LUMPY. FORGIVING. BORING.' }),
    mkSpot({ id:'BENCH', name:'ON THE BENCH', coverX:44, coverY:92, coverW:30, coverH:26,
      wantShape:'BLOB', wantPose:'STAND', exposure:4, textured:true, walk:[58,176],
      tagline:'* AMONG THE POTS. BE A POT.' }),
    mkSpot({ id:'TOOLS', name:'ON THE TOOL RAIL', coverX:264, coverY:42, coverW:30, coverH:30,
      wantShape:'CUBE', wantPose:'FLATTEN', exposure:5, textured:false, walk:[278,172],
      tagline:'* HE HANGS THINGS HERE. HE CHECKS WHAT HE HUNG.' }),
    mkSpot({ id:'TRAY', name:'IN A SEED TRAY', coverX:154, coverY:126, coverW:30, coverH:26,
      wantShape:'BLOB', wantPose:'CURL', exposure:3, textured:true, walk:[168,182], absurd:['STAND'],
      tagline:'* SOIL. SIX HUNDRED SHADES OF NEARLY-BROWN.' }),
    mkSpot({ id:'DOOR', name:'FLAT ON THE DOOR', coverX:160, coverY:46, coverW:36, coverH:36,
      wantShape:'CUBE', wantPose:'FLATTEN', exposure:3, textured:true, walk:[178,172],
      tagline:'* THE DOOR IS PLANKS TOO. BUT VERTICAL.' }),
  ],
};

/* ============================ CH3 — THE SUGAR PARLOUR ============================ */
ROOMS.CH3 = {
  name:'THE SUGAR PARLOUR', label:'THE PARLOUR', prep:65, target:70, looker:'FONDANT',
  start:[160,204], maxhp:24,
  build(s){
    s.under('SUGAR STRIPE', () => s.stripe(0,0,320,140, 27,26, 5));
    s.under('THE PICTURE RAIL', () => { s.pf(0,138,320,5, 25); s.pf(0,143,320,2, 24); });
    s.under('THE CHECKED FLOOR', () => s.checker(0,145,320,95, 30,25, 8));
    // cake stand
    s.under('THE CAKE STAND', () => {
      s.pf(44,104,44,5, 31); s.pf(62,109,8,26, 30); s.pf(48,133,36,6, 31);
      s.pf(50,84,32,20, 28); s.pf(54,80,24,6, 31);
      for (let i=0;i<4;i++) s.pf(54+i*7,88,4,10, 29);
    });
    // booth
    s.under('THE BOOTH', () => {
      s.pf(214,92,96,52, 21); s.pf(218,96,88,44, 22);
      for (let i=0;i<7;i++) s.pf(220+i*12,96,2,44, 21);
      s.pf(214,138,96,8, 20);
    });
    // jar shelf
    s.under('THE JAR SHELF', () => {
      s.pf(120,58,84,5, 25);
      for (let i=0;i<5;i++){ const jx=124+i*16;
        s.pf(jx,36,12,22, 15); s.pf(jx+2,38,8,18, 14); s.pf(jx+1,32,10,5, 30); }
    });
    // menu board
    s.under('CHALK ON NEARLY-BLACK', () => {
      s.pf(226,26,74,52, 21); s.pf(230,30,66,44, 20);
      for (let i=0;i<5;i++) s.pf(236,36+i*8, 20+((i*13)%34), 1, 30);
    });
    s.block(44,80,44,60); s.block(214,88,96,58); s.block(120,54,84,10); s.block(0,0,320,145);
  },
  waypoints:[[40,200],[150,216],[280,196],[160,182]],
  props:[{ x:226, y:26, w:74, h:52, name:'MENU', talk:'CH3_MENU' }],
  spots:[
    mkSpot({ id:'STRIPE', name:'AGAINST THE STRIPES', coverX:100, coverY:80, coverW:34, coverH:38,
      wantShape:'CUBE', wantPose:'FLATTEN', exposure:3, textured:false, walk:[116,178],
      tagline:'* THE STRIPES ARE FIVE CELLS WIDE. COUNT THEM.' }),
    mkSpot({ id:'CAKE', name:'ON THE CAKE STAND', coverX:50, coverY:82, coverW:32, coverH:24,
      wantShape:'BLOB', wantPose:'CURL', exposure:5, textured:false, walk:[66,176], absurd:['STAND','LIE'],
      tagline:'* A DOME UNDER GLASS. HE LOOKS HERE FIRST. HE ALWAYS LOOKS HERE FIRST.' }),
    mkSpot({ id:'BOOTH', name:'IN THE BOOTH SEAT', coverX:230, coverY:100, coverW:36, coverH:32,
      wantShape:'BLOB', wantPose:'LIE', exposure:1, textured:true, walk:[248,182], absurd:['STAND'],
      tagline:'* VELVET. NOBODY HAS SAT HERE IN A DECADE.' }),
    mkSpot({ id:'JARS', name:'ON THE JAR SHELF', coverX:156, coverY:34, coverW:26, coverH:26,
      wantShape:'CUBE', wantPose:'STAND', exposure:4, textured:false, walk:[168,170],
      tagline:'* BE A JAR. JARS ARE CYLINDERS. YOU ARE NOT. TRY ANYWAY.' }),
    mkSpot({ id:'FLOOR', name:'ON THE CHECKED FLOOR', coverX:132, coverY:186, coverW:40, coverH:24,
      wantShape:'CUBE', wantPose:'LIE', exposure:2, textured:false, walk:[152,214], absurd:['STAND'],
      tagline:'* EIGHT-PIXEL CHECKS. GET THE PHASE RIGHT OR DO NOT BOTHER.' }),
    mkSpot({ id:'SIGN', name:'BEHIND THE MENU BOARD', coverX:238, coverY:32, coverW:34, coverH:36,
      wantShape:'CUBE', wantPose:'FLATTEN', exposure:2, textured:true, walk:[258,172],
      tagline:'* CHALK DUST ON BLACK. NEARLY BLACK. NOT QUITE.' }),
  ],
};

/* ============================ CH4 — THE DAMP ============================ */
ROOMS.CH4 = {
  name:'THE DAMP', label:'THE DAMP', prep:60, target:72, looker:'GRIT',
  start:[160,200], maxhp:26,
  build(s){
    s.under('THE DAMP', () => s.speck(0,0,320,152, 16,[17,0,12], 31, 0.44));
    s.under('THE COURSES', () => { for (let y=18;y<152;y+=22) s.pf(0,y,320,1, 12); });
    s.under('THE WET FLOOR', () => s.speck(0,152,320,88, 12,[16,0], 32, 0.26));
    // puddle
    s.under('THE PUDDLE', () => {
      s.pf(112,184,84,26, 13); s.pf(116,186,76,22, 14);
      for (let i=0;i<7;i++) s.pf(122+i*10,190+((i*7)%12),6,1, 15);
    });
    // pipes
    s.under('WET METAL', () => {
      for (let i=0;i<2;i++){ const px=228+i*30;
        s.pf(px,0,14,152, 17); s.pf(px+2,0,3,152, 19); s.pf(px+10,0,2,152, 16);
        s.pf(px-2,58,18,8, 18); }
    });
    // coal heap
    s.under('THE COAL', () => {
      for (let i=0;i<26;i++){
        const cx=24+((i*37)%76), cy=126+((i*23)%30), w=5+((i*11)%6);
        s.pf(cx,cy,w,w-1, (i%7===0)?12:(i%3?0:16));
      }
      s.pf(20,152,90,8, 0);
    });
    // broken crate
    s.under('SPLINTERS', () => {
      s.pf(146,110,54,44, 4); s.pf(150,114,46,36, 5);
      s.grain(150,114,46,36, 5,4, 33, 0.6, 'SPLINTERS');
      s.pf(160,110,6,44, 0); s.pf(182,118,4,36, 0);
    });
    s.block(20,120,90,36); s.block(146,110,54,44); s.block(226,0,62,152); s.block(0,0,320,150);
  },
  waypoints:[[40,196],[160,214],[286,192],[150,178]],
  props:[{ x:20, y:120, w:90, h:22, name:'COAL', talk:'CH4_COAL' }],
  spots:[
    mkSpot({ id:'STONE', name:'IN THE STONEWORK', coverX:60, coverY:52, coverW:36, coverH:38,
      wantShape:'CUBE', wantPose:'FLATTEN', exposure:3, textured:true, walk:[78,176],
      tagline:'* NOISE. GLORIOUS NOISE. FLAT COLOUR WILL DIE HERE.' }),
    mkSpot({ id:'COAL', name:'IN THE COAL HEAP', coverX:44, coverY:124, coverW:34, coverH:30,
      wantShape:'BLOB', wantPose:'CURL', exposure:2, textured:true, walk:[62,180], absurd:['STAND'],
      tagline:'* BLACK, BLACK, BLACK AND ONE SURPRISING BLUE.' }),
    mkSpot({ id:'PIPES', name:'BETWEEN THE PIPES', coverX:242, coverY:70, coverW:24, coverH:44,
      wantShape:'CUBE', wantPose:'STAND', exposure:4, textured:false, walk:[254,178],
      tagline:'* WET METAL. IT HAS A HIGHLIGHT. YOU WILL NEED ONE.' }),
    mkSpot({ id:'PUDDLE', name:'LYING IN THE PUDDLE', coverX:126, coverY:186, coverW:44, coverH:22,
      wantShape:'BLOB', wantPose:'LIE', exposure:5, textured:true, walk:[148,214], absurd:['STAND'],
      tagline:'* HE WALKS THROUGH THIS. WITH BOOTS.' }),
    mkSpot({ id:'CRATE', name:'IN THE BROKEN CRATE', coverX:152, coverY:116, coverW:34, coverH:32,
      wantShape:'CUBE', wantPose:'CURL', exposure:1, textured:true, walk:[170,180],
      tagline:'* SPLINTERS AND SHADOW. EASY. CHEAP.' }),
  ],
};

/* ============================ CH5 — THE WHITE GALLERY ============================ */
ROOMS.CH5 = {
  name:'THE WHITE GALLERY', label:'THE GALLERY', prep:45, target:78, looker:'CURATOR',
  start:[160,204], maxhp:32, finale:true,
  build(s){
    s.under('GALLERY WALL', () => s.pf(0,0,320,150, 31));
    s.under('THE SHADOW BAND', () => { s.pf(0,52,320,3, 30); s.pf(0,55,320,1, 29); });
    s.under('THE GALLERY FLOOR', () => {
      s.pf(0,150,320,90, 30);
      for (let i=0;i<6;i++) s.pf(0,152+i*15,320,1, 29);
    });
    s.under('EMPTY FRAME', () => {
      for (let i=0;i<7;i++){ const fx=14+i*44;
        s.pf(fx,64,34,44, 29); s.pf(fx+3,67,28,38, 28); s.pf(fx+5,69,24,34, 31);
        s.pf(fx+10,112,14,3, 30); }
    });
    s.under('THE PLINTH', () => {
      s.pf(136,120,48,34, 30); s.pf(140,116,40,6, 29); s.pf(144,122,32,28, 31);
    });
    s.block(136,116,48,38); s.block(0,0,320,150);
  },
  waypoints:[[40,196],[160,212],[286,192],[160,176]],
  props:[],
  spots:[
    mkSpot({ id:'WHITE', name:'AGAINST THE WHITE WALL', coverX:196, coverY:80, coverW:36, coverH:40,
      wantShape:'CUBE', wantPose:'FLATTEN', exposure:3, textured:false, walk:[214,176],
      tagline:'* NOTHING. THERE IS NOTHING HERE TO MATCH.' }),
    mkSpot({ id:'RAIL6', name:'UNDER THE PICTURE RAIL', coverX:250, coverY:40, coverW:34, coverH:24,
      wantShape:'CUBE', wantPose:'FLATTEN', exposure:4, textured:false, walk:[266,170],
      tagline:'* A BAND OF SHADOW. THREE PIXELS. ONE SHADE DOWN.' }),
    mkSpot({ id:'FRAME', name:'INSIDE THE EMPTY FRAME', coverX:63, coverY:69, coverW:24, coverH:34,
      wantShape:'CUBE', wantPose:'STAND', exposure:5, textured:false, walk:[76,172],
      tagline:'* THERE IS A LABEL UNDER IT. THE LABEL IS BLANK.' }),
    mkSpot({ id:'PLINTH', name:'ON THE PLINTH', coverX:144, coverY:122, coverW:32, coverH:28,
      wantShape:'BLOB', wantPose:'CURL', exposure:5, textured:false, walk:[160,180], absurd:['LIE'],
      tagline:'* HE PUT IT HERE THIS MORNING. FOR SOMETHING.' }),
  ],
};


/* bake a room's three buffers once */
const SCENES = {};
function getScene(key){
  if (!SCENES[key]){
    const s = new Scene(VW, VH);
    ROOMS[key].build(s);
    SCENES[key] = s;
  }
  return SCENES[key];
}
