/* ---------- voices ---------- */
const VOICE = {
  plain:  { type:'square',   freq:520, dur:0.045, gain:0.08 },
  bib:    { type:'square',   freq:680, dur:0.040, gain:0.08 },
  tackle: { type:'square',   freq:760, dur:0.034, gain:0.075 },
  fondant:{ type:'triangle', freq:240, dur:0.060, gain:0.11 },
  grit:   { type:'sawtooth', freq:140, dur:0.055, gain:0.07 },
  curator:{ type:'sine',     freq:330, dur:0.070, gain:0.09 },
  sienna: { type:'triangle', freq:420, dur:0.048, gain:0.09 },
};

/* ---------- the Lookers (original characters) ---------- */
/* a seeker: head, torso, arms, feet — silhouette first, then features */
function seekerBody(c, x, y, h, w, col, hat, o){
  o = o || {};
  const headW = o.headW || Math.round(w * 0.52), headH = o.headH || Math.round(h * 0.30);
  const torsoH = h - headH - 6;
  const bx = x - (w >> 1), by = y - h;
  const hx = x - (headW >> 1);
  // feet
  rect(c, bx + 6, y - 6, 10, 6, UI.BLACK);
  rect(c, bx + w - 16, y - 6, 10, 6, UI.BLACK);
  rect(c, bx + 7, y - 5, 8, 4, UI.GHOST);
  rect(c, bx + w - 15, y - 5, 8, 4, UI.GHOST);
  // torso
  rect(c, bx, by + headH, w, torsoH, UI.BLACK);
  rect(c, bx + 2, by + headH + 2, w - 4, torsoH - 4, col);
  // arms
  rect(c, bx - 5, by + headH + 6, 6, torsoH - 16, UI.BLACK);
  rect(c, bx + w - 1, by + headH + 6, 6, torsoH - 16, UI.BLACK);
  rect(c, bx - 4, by + headH + 7, 4, torsoH - 18, col);
  rect(c, bx + w, by + headH + 7, 4, torsoH - 18, col);
  // head
  rect(c, hx, by, headW, headH + 2, UI.BLACK);
  rect(c, hx + 2, by + 2, headW - 4, headH - 2, col);
  // eyes
  const ey = by + Math.round(headH * 0.45);
  rect(c, hx + 5, ey, 4, 4, UI.BLACK);
  rect(c, hx + headW - 9, ey, 4, 4, UI.BLACK);
  rect(c, hx + 6, ey + 1, 2, 2, UI.WHITE);
  rect(c, hx + headW - 8, ey + 1, 2, 2, UI.WHITE);
  if (o.mouth) rect(c, hx + 7, by + headH - 5, headW - 14, 2, UI.BLACK);
  if (hat){ rect(c, hx - 4, by - 5, headW + 8, 6, UI.BLACK); rect(c, hx - 2, by - 4, headW + 4, 4, hat); }
  return { bx, by, w, h, hx, headW, headH };
}
const LOOKERS = {
  BIB: {
    worldCol:UI.DIM, hatCol:UI.GOLD,
    name:'BIB', voice:VOICE.bib,
    coneBark:'MORNING! DO NOT MIND ME.',
    draw(c,x,y){ const b = seekerBody(c,x,y,72,54,UI.DIM,UI.GOLD,{mouth:true});
      // the clipboard, held out in front
      rect(c,x+24,y-40,16,20,UI.BLACK); rect(c,x+26,y-38,12,16,PAL[30]);
      rect(c,x+28,y-35,8,1,UI.BLACK); rect(c,x+28,y-31,8,1,UI.BLACK); rect(c,x+28,y-27,5,1,UI.BLACK);
      rect(c,x+29,y-41,6,2,UI.GOLD);
      // the bib
      rect(c,b.hx+1,b.by+b.headH+2,b.headW-2,9,PAL[31]); },
    intro:[{t:'MORNING! I AM BIB.'},{t:'I HAVE BEEN GIVEN A CLIPBOARD AND A CORRIDOR.'},
           {t:'PLEASE DO NOT BE IN IT.'}],
    barks:{ PAINT:'that brick is a slightly different brick. bricks do that.',
            TEXTURE:'smooth patch. someone has been sanding. good for them.',
            POSE:'tall brick. load-bearing, probably.',
            SPOT:'something is sticking out. the wall is sticking out. fine.',
            NERVE:'right by the step. bold of the wall.',
            near:'hm. ...hm. no. nothing. moving on. moving on.',
            great:'wall. lovely wall. ten out of ten wall.' },
    capture:[{t:'OH! A SCULPTURE!'},{t:'...IS IT MINE? IT IS TAGGED NOW. SORRY.'}],
    depart:[{t:'NOTHING IN THIS ALLEY. AS USUAL. AS ALWAYS.'},{t:'GOODBYE, ALLEY.'}],
  },
  TACKLE: {
    worldCol:UI.DIM, hatCol:PAL[10],
    name:'TACKLE', voice:VOICE.tackle,
    coneBark:'IF YOU ARE FLAT, YOU ARE A POSTER.',
    draw(c,x,y){ seekerBody(c,x,y,66,48,UI.DIM,PAL[10],{headW:22});
      // a bandolier of pins
      for(let i=0;i<6;i++){ rect(c,x-20+i*8,y-34,1,7,UI.WHITE); rect(c,x-21+i*8,y-35,3,2,UI.GOLD); } },
    intro:[{t:'IF YOU ARE FLAT, YOU ARE A POSTER.'},{t:'IF YOU ARE A POSTER, YOU ARE MINE.'},
           {t:'I HAVE A LOT OF PINS.'}],
    barks:{ PAINT:'plank. grain going the wrong way, but a plank.',
            TEXTURE:'sanded. in here. nobody sands in here.',
            POSE:'someone stacked these badly. i will allow it.',
            SPOT:'that is a poster i do not remember hanging. i hang everything. so i hung it.',
            NERVE:'on the rail. right where i look. brave shelf.',
            near:'...that knot has moved. knots do not move. do they.',
            great:'good shed. correct shed. nothing to pin.' },
    capture:[{t:'A NEW POSTER! WHAT DOES IT SAY?'},{t:'...OH. IT SAYS "HELP".'}],
    depart:[{t:'SHED: HUNG. SHED: CORRECT.'}],
  },
  FONDANT: {
    worldCol:PAL[29], hatCol:PAL[26],
    name:'FONDANT', voice:VOICE.fondant,
    coneBark:'MMM. SOMETHING IS UNDERCOATED.',
    draw(c,x,y){ const b = seekerBody(c,x,y,76,64,PAL[29],PAL[26],{headW:34,mouth:true});
      // apron, and a fork
      rect(c,x-16,y-32,32,26,PAL[31]); rect(c,x-16,y-32,32,1,PAL[27]);
      rect(c,x+30,y-46,2,20,UI.GHOST);
      for(let i=0;i<3;i++) rect(c,x+28+i*2,y-52,1,7,UI.GHOST); },
    intro:[{t:'I IDENTIFY THINGS BY TASTE.'},{t:'IT IS NOT THE APPROVED METHOD.'},
           {t:'IT IS, HOWEVER, MINE.'}],
    barks:{ PAINT:'stripes off by one. the bakery is to blame. bakeries are like that.',
            TEXTURE:'wallpaper. tastes like wallpaper.',
            POSE:'a very square cake. i have seen worse cakes.',
            SPOT:'too sweet. everything in here is too sweet. including the walls.',
            NERVE:'on the stand. under the glass. confident pastry.',
            near:'one of these is not sugar. ...no. all sugar. all of it.',
            great:'nothing but parlour. delicious parlour.' },
    capture:[{t:'MMM. UNDERCOATED.'},{t:'YOU NEED ANOTHER LAYER, LOVE.'}],
    depart:[{t:'CLEAN. STICKY, BUT CLEAN.'}],
  },
  GRIT: {
    worldCol:PAL[18], hatCol:PAL[16],
    name:'GRIT', voice:VOICE.grit,
    coneBark:'ROUGH. GOOD.',
    draw(c,x,y){ seekerBody(c,x,y,72,70,PAL[18],PAL[16],{headW:30,headH:18});
      // heavy belt and a lamp
      rect(c,x-33,y-30,66,5,UI.BLACK); rect(c,x-6,y-31,12,7,PAL[16]);
      rect(c,x+34,y-50,10,12,UI.BLACK); rect(c,x+36,y-48,6,8,UI.GOLD); },
    intro:[{t:'ROUGH.'},{t:'ALL OF IT.'},{t:'GOOD.'}],
    barks:{ PAINT:'wrong dark. there are four darks down here. that is the third one.',
            TEXTURE:'too smooth. nothing down here is smooth. hm.',
            POSE:'lumpy where it should be square. the damp does that.',
            SPOT:'sticking out of the stone. stone does not do that.',
            NERVE:'in the puddle. in MY puddle.',
            near:'damp. lumpy. ...correct? correct.',
            great:'damp. lumpy. correct.' },
    capture:[{t:'SANDED.'},{t:'SORRY. HABIT.'}],
    depart:[{t:'STILL ROUGH. STILL GOOD.'}],
  },
  CURATOR: {
    worldCol:PAL[31], hatCol:PAL[28],
    name:'THE CURATOR', voice:VOICE.curator,
    coneBark:'EVERY BLANK IS ASSIGNED A COLOUR.',
    draw(c,x,y){ seekerBody(c,x,y,88,46,PAL[31],PAL[28],{headW:20,headH:24});
      // long white coat, white gloves, a blank label
      rect(c,x-21,y-52,42,44,PAL[30]); rect(c,x-1,y-52,2,44,PAL[29]);
      rect(c,x-27,y-40,6,6,PAL[31]); rect(c,x+21,y-40,6,6,PAL[31]);
      rect(c,x+26,y-64,16,11,UI.BLACK); rect(c,x+28,y-62,12,7,PAL[31]); },
    intro:[{t:'YOU WERE DUE A COLOUR ON TUESDAY.'},{t:'INSTEAD YOU WENT AND GOT SEVERAL.'},
           {t:'FROM A GUTTER. FROM A SACK. FROM A PUDDLE.'},
           {t:'THIS IS THE WHITE GALLERY. THERE IS NOTHING HERE TO STEAL.'}],
    barks:{ PAINT:'colour. in my white room. colour.',
            TEXTURE:'a rough patch on a smooth wall. someone has been busy.',
            POSE:'that is not the shape of anything i hung.',
            SPOT:'on the plinth. i left the plinth empty on purpose.',
            NERVE:'in the frame. of course in the frame.',
            near:'...the wall has a seam. the wall has never had a seam.',
            great:'wall. only wall. i built this room to be only wall.' },
    capture:[{t:'THERE YOU ARE.'},{t:'HOLD STILL. THIS WILL ONLY TAKE ONE COAT.'}],
    depart:[{t:'...NOTHING.'},{t:'NOTHING AT ALL.'}],
  },
};

const SIENNA_VERDICTS = {
  great:['A MASTERPIECE, AND NOBODY WILL EVER SEE IT. THAT IS THE JOB.',
         'YOU MADE A WALL. A REAL ONE. I AM A LITTLE JEALOUS.',
         'PERFECT. SPIRITUALLY A COWARD, BUT PERFECT.'],
  ok:   ['DECENT. YOUR EDGES ARE STILL SHOUTING, THOUGH.',
         'IT HELD. IT WAS NOT PRETTY, BUT IT HELD.',
         'FINE WORK IN THE MIDDLE. NOBODY LOOKS AT THE MIDDLE.'],
  poor: ['YOU PAINTED A BLANK. YOU DID NOT PAINT A WALL.',
         'BOLD USE OF ONE COLOUR. VERY BOLD. ONE COLOUR.',
         'I HAVE SEEN WET CEMENT WITH MORE OPINIONS.'],
  awful:['THAT IS NOT CAMOUFLAGE. THAT IS A SIGNATURE.',
         'YOU WENT OUT THERE ESSENTIALLY NUDE.',
         'NEXT TIME, TRY LOOKING AT THE WALL. EVEN ONCE.'],
};

/* ---------- flavour props ---------- */
const PROP_TALK = {
  CH1_FLYERS:[{t:'A STACK OF FLYERS. THE TOP ONE SAYS "COLOUR ASSIGNMENT: TUESDAY".'},
              {t:'IT IS WEDNESDAY.'}],
  CH1_BINS:[{t:'THREE BINS. ONE SMELLS OF TURPENTINE AND REGRET.'}],
  CH2_RAIL:[{t:'A RAIL OF TOOLS, EACH ON ITS OWN PAINTED OUTLINE.'},
            {t:'THERE IS AN OUTLINE WITH NOTHING IN IT. IT IS ROUGHLY YOUR SIZE.'}],
  CH3_MENU:[{t:'THE BOARD LISTS ELEVEN CAKES AND ONE RULE.'},
            {t:'THE RULE IS "NOTHING WHITE ON THE PREMISES".'}],
  CH4_COAL:[{t:'COAL. BLACK, BLACK, BLACK — AND ONE LUMP OF SURPRISING BLUE.'},
            {t:'YOU TAKE THE BLUE. OBVIOUSLY YOU TAKE THE BLUE.'}],
};
function talkProp(key){
  const p = PROP_TALK[key]; if (!p) return;
  Dlg.queue(p, { voice:VOICE.plain });
}

/* ---------- the round loop ---------- */
const MAPS = ['CH1','CH2','CH3','CH4','CH5'];

function newRound(){
  const key = MAPS[G.round % MAPS.length];
  G.night = 1 + Math.floor(G.round / MAPS.length);
  const room = ROOMS[key];
  G.prep = Math.max(30, room.prep - (G.night - 1) * 10);
  G.coneHit = false;
  G.spot = null;
  enterRoom(key);
  setPose('BLOB', 'STAND');
  whiteReset();                       // the ritual: you always start pure white
  G.st = 'PAINT';
  Audio_.music('hub', 96);
  const L = LOOKERS[room.looker];
  if (!G.seenIntro[key]){ G.seenIntro[key] = true; Dlg.queue(L.intro, { voice:L.voice }); }
  else Dlg.queue([{ t: 'ROUND ' + (G.round+1) + '. ' + L.name + ' IS SEEKING. PAINT YOURSELF.' }],
                 { voice:VOICE.plain });
}
function readyUp(){
  if (!G.spot) return;
  fadeTo(() => { hideBegin(); });
}
function nextRound(){
  fadeTo(() => { G.round++; newRound(); });
}
