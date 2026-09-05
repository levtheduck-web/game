#!/usr/bin/env node
// gen-thumbs.js — generate AI thumbnail art for every GLITCHBOX game via OpenAI.
//
//   OPENAI_API_KEY=sk-...  node gen-thumbs.js            all games missing a thumb
//   OPENAI_API_KEY=sk-...  node gen-thumbs.js gridlock   just one game (force redo)
//
// Key can also live in ~/.openai-key (chmod 600).
// Writes thumbs/<gid>.png (640x400). The hub falls back to canvas art when absent.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KEY = process.env.OPENAI_API_KEY ||
  (fs.existsSync(path.join(os.homedir(), '.openai-key'))
    ? fs.readFileSync(path.join(os.homedir(), '.openai-key'), 'utf8').trim() : '');
if (!KEY) { console.error('No OpenAI key. Put it in $OPENAI_API_KEY or ~/.openai-key'); process.exit(1); }

const STYLE = 'Moody dark retro-arcade key art, glowing neon on near-black, subtle CRT scanlines and bloom, ' +
  'cinematic lighting, crisp vector-like shapes, no text, no words, no letters, no logos, no UI, no watermark. ' +
  'Wide 3:2 composition with one bold focal subject.';

// One line of scene direction per game — the part that makes each card its own.
const SCENES = {
  'gridlock':            'Two neon light cycles racing head-to-head on an endless glowing grid, cyan and magenta light trails walling off the arena behind them',
  'patch-notes':         'A glowing trading card being rewritten mid-air, green terminal glyph energy peeling off it and striking a second identical card, balance scales silhouette behind',
  'seven-liars':         'Seven noir suspect silhouettes in a dark manor hallway lit by one hanging bulb, one silhouette casting a blood-red shadow',
  'fatespine':           'A lone runner leaping across burning rooftop platforms while a translucent ghostly echo of themself runs the opposite way, rewinding clock spiral in the sky',
  'blast-radius':        'Two artillery tanks on jagged destructible neon terrain trading glowing projectile arcs under a dark sky, explosion blooming mid-map',
  'neon-frag':           'First-person neon arena corridor with a glowing railgun beam streaking toward a distant silhouetted rival, cyan and orange lighting',
  'mic-drop':            'A glowing microphone on a dark stage with pitch waveforms rising off it like neon sound ribbons under a spotlight',
  'wet-paint':           'Bright glowing paint splatter fight, two rollers flinging luminous cyan and pink paint across a dark wall',
  'magic-wand':          'A sparking magic wand tracing glowing rune trails in darkness, stardust particles swirling',
  'neon-putt':           'A neon minigolf hole at night, glowing ball rolling past a spinning windmill obstacle over ultraviolet turf',
  'barrier':             'A lone figure projecting a glowing hexagonal energy shield against a storm of incoming neon projectiles',
  'quoridor':            'A glowing maze board seen from above, two pawn pieces separated by luminous walls, one path snaking to the exit',
  'pixel-war':           'A pixel-art battle tank and fighter jet clashing over a burning battlefield, tracer fire and explosions, retro military palette',
  'pixelwar':            'Pixel-art armored column advancing under an air battle, missiles crossing a smoky orange sky',
  'pixelwar-solo':       'A single pixel-art tank holding a ridge at dusk against incoming silhouetted vehicles, long glowing tracer lines',
  'war-combined':        'A combined-arms pixel battle: submarine surfacing, destroyer firing, jet and helicopter overhead, one chaotic front line',
  'nuclear':             'A glowing DEFCON war-room world map with arcing missile trajectories crossing the ocean, deep red alert lighting',
  'spaceship-solo':      'The lit cockpit interior of a lone starship flying through deep space, warm console glow against cold starfield',
  'spaceship-mp':        'Two crewmates rushing through a damaged starship corridor with sparks venting, warp streaks outside the viewport',
  'build-a-bridge':      'A glowing truss bridge of neon beams spanning a dark canyon while a small truck crosses, stress points glowing hot',
  'mars-colony':         'A domed Mars colony at dusk, connected habitat modules glowing warm against red dunes and a thin blue sunset',
  'national-park-tycoon':'A lush national park valley at golden hour, winding trails, a ranger tower, distant bison by a river',
  'national-park-simulator':'An overhead park map coming alive, trails and campsites lighting up between forests and lakes at dusk',
  'virus':               'A stylized dark world map with glowing red infection tendrils spreading between continents from one origin point',
  'pathogen':            'A microscopic view of a glowing virus cell splitting apart, evolving spikes, cold laboratory blue-green palette',
  'last-transmission':   'A lone astronaut silhouette before a wall of static-filled monitors, one screen showing a distant signal waveform',
  'last-transmission-3d':'A derelict space station interior lit by emergency red, an astronaut helmet reflecting a flickering transmission',
  'cheese-heist-3d':     'A cartoon mouse in a tiny heist mask sneaking through laser tripwires toward a glowing wedge of cheese on a pedestal',
  'fib-factory':         'A retro game-show podium under neon lights, one glowing truth card among a fan of counterfeit cards, spotlight drama',
  'yellowstone-carnage': 'A geyser erupting through chaos as pixel wildlife stampedes through a burning campsite, absurd action-movie energy',
  'speed-stars':         'Sprinters as glowing light streaks crossing a night stadium finish line, motion-blurred star trails behind them',
  'hacker':              'A dark terminal screen world, cascading green code forming a city skyline, one cursor blinking like a beacon',
  'dj':                  'Glowing turntables under club lasers, a waveform ribbon flowing off the vinyl into darkness',
  'decision-roulette':   'A giant glowing roulette wheel of doors spinning in a void, one door lit gold',
  'case-board':          'A detective corkboard at night, photos and notes linked by glowing red string converging on one empty frame',
  'roach-rave':          'Cartoon cockroaches dancing under a disco ball on a kitchen floor at night, tiny neon party lights',
  'nothing':             'A vast empty black void with a single tiny glowing white dot in the center, absolute minimalism',
};

const gamesSrc = fs.readFileSync(path.join(__dirname, 'glitchbox-games.js'), 'utf8');
const ids = [...gamesSrc.matchAll(/file:'([^']+)\.html'/g)].map(m => m[1]);

const only = process.argv[2];
const outDir = path.join(__dirname, 'thumbs');
fs.mkdirSync(outDir, { recursive: true });

async function gen(gid) {
  const scene = SCENES[gid];
  if (!scene) { console.log(`skip ${gid} (no scene direction — add one to SCENES)`); return; }
  const out = path.join(outDir, gid + '.png');
  if (!only && fs.existsSync(out)) { console.log(`have ${gid}`); return; }
  process.stdout.write(`gen  ${gid} … `);
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-1', prompt: scene + '. ' + STYLE,
                           size: '1536x1024', quality: 'medium', n: 1 }),
  });
  if (!r.ok) { console.log('FAILED ' + r.status + ' ' + (await r.text()).slice(0, 300)); return; }
  const j = await r.json();
  const raw = out + '.raw.png';
  fs.writeFileSync(raw, Buffer.from(j.data[0].b64_json, 'base64'));
  // 1536x1024 → 640x427 → center-crop 640x400 (the hub's 8:5 card)
  execFileSync('sips', ['--resampleWidth', '640', raw], { stdio: 'ignore' });
  execFileSync('sips', ['--cropToHeightWidth', '400', '640', raw], { stdio: 'ignore' });
  fs.renameSync(raw, out);
  console.log('ok → thumbs/' + gid + '.png');
}

(async () => {
  const todo = only ? [only] : ids;
  for (const gid of todo) {
    try { await gen(gid); } catch (e) { console.log(`FAILED ${gid}: ${e.message}`); }
  }
})();
