#!/usr/bin/env node
// gen-thumbs.js — generate AI thumbnail art for every GLITCHBOX game.
//
// Works with either provider; whichever key it finds wins (Gemini first).
//
//   node gen-thumbs.js --probe        check the key and list usable image models
//   node gen-thumbs.js                every game that has no thumb yet
//   node gen-thumbs.js gridlock       just one game (redoes it even if present)
//   node gen-thumbs.js --provider openai
//
// Keys, in order of preference:
//   Gemini  $GEMINI_API_KEY  or  ~/.gemini-key
//   OpenAI  $OPENAI_API_KEY  or  ~/.openai-key
//
// Writes thumbs/<gid>.png (640x400). The hub falls back to its canvas art
// whenever a file is missing, so a partial run is always safe to ship.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const flag = n => { const i = argv.indexOf('--' + n); return i === -1 ? null : (argv[i + 1] || true); };
const PROBE = argv.includes('--probe');

function readKey(env, file) {
  if (process.env[env]) return process.env[env].trim();
  const p = path.join(os.homedir(), file);
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : ''; } catch (e) { return ''; }
}
const GEM_KEY = readKey('GEMINI_API_KEY', '.gemini-key');
const OAI_KEY = readKey('OPENAI_API_KEY', '.openai-key');

let PROVIDER = flag('provider') || (GEM_KEY ? 'gemini' : OAI_KEY ? 'openai' : '');
const KEY = PROVIDER === 'gemini' ? GEM_KEY : OAI_KEY;
if (!KEY) {
  console.error('No API key found. Add one of these and re-run:\n' +
    "  echo 'AIza…' > ~/.gemini-key && chmod 600 ~/.gemini-key      (Gemini)\n" +
    "  echo 'sk-…'  > ~/.openai-key && chmod 600 ~/.openai-key      (OpenAI)");
  process.exit(1);
}

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

const only = argv.find(a => a[0] !== '-' && argv[argv.indexOf(a) - 1] !== '--provider');
const outDir = path.join(__dirname, 'thumbs');
fs.mkdirSync(outDir, { recursive: true });

const GEM = 'https://generativelanguage.googleapis.com/v1beta';

// ── providers ──────────────────────────────────────────────────────────────
// Each returns raw image bytes for one prompt. Model names move around, so the
// Gemini path asks the API what this key can actually use instead of guessing.
let gemModel = flag('model') || null;

async function gemImageModels() {
  const r = await fetch(`${GEM}/models?key=${KEY}&pageSize=200`);
  if (!r.ok) throw new Error('models list: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const all = (await r.json()).models || [];
  // Anything that can return an image: the flash-image line via generateContent,
  // or an Imagen model via :predict.
  return all.filter(m => /image/i.test(m.name) && !/embed/i.test(m.name))
            .map(m => ({ name: m.name.replace(/^models\//, ''),
                         methods: m.supportedGenerationMethods || [] }));
}

async function pickGemModel() {
  if (gemModel) return gemModel;
  const models = await gemImageModels();
  if (!models.length) throw new Error('this key has no image-capable models');
  // Prefer the cheap conversational image model, then Imagen, then anything.
  const pref = models.find(m => /gemini.*flash.*image/.test(m.name) && m.methods.includes('generateContent'))
            || models.find(m => /imagen/.test(m.name) && m.methods.includes('predict'))
            || models[0];
  gemModel = pref.name;
  console.log('using Gemini model: ' + gemModel);
  return gemModel;
}

async function genGemini(prompt) {
  const model = await pickGemModel();
  // Imagen models speak :predict; the gemini-*-image line speaks :generateContent.
  if (/imagen/.test(model)) {
    const r = await fetch(`${GEM}/models/${model}:predict?key=${KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [{ prompt }],
                             parameters: { sampleCount: 1, aspectRatio: '16:9' } }),
    });
    if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 300));
    const p = (await r.json()).predictions || [];
    if (!p[0] || !p[0].bytesBase64Encoded) throw new Error('no image in response');
    return Buffer.from(p[0].bytesBase64Encoded, 'base64');
  }
  const r = await fetch(`${GEM}/models/${model}:generateContent?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  const img = parts.find(p => p.inlineData && p.inlineData.data);
  if (!img) {
    const why = (j.promptFeedback && j.promptFeedback.blockReason) ||
                parts.map(p => p.text).filter(Boolean).join(' ').slice(0, 160) || 'no image in response';
    throw new Error(why);
  }
  return Buffer.from(img.inlineData.data, 'base64');
}

async function genOpenAI(prompt) {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: flag('model') || 'gpt-image-1', prompt,
                           size: '1536x1024', quality: 'medium', n: 1 }),
  });
  if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 300));
  return Buffer.from((await r.json()).data[0].b64_json, 'base64');
}

const generate = p => (PROVIDER === 'gemini' ? genGemini(p) : genOpenAI(p));

// ── one game ───────────────────────────────────────────────────────────────
async function gen(gid) {
  const scene = SCENES[gid];
  if (!scene) { console.log(`skip ${gid} (no scene direction — add one to SCENES)`); return; }
  const out = path.join(outDir, gid + '.png');
  if (!only && fs.existsSync(out)) { console.log(`have ${gid}`); return; }
  process.stdout.write(`gen  ${gid} … `);
  const bytes = await generate(scene + '. ' + STYLE);
  const raw = out + '.raw.png';
  fs.writeFileSync(raw, bytes);
  // Whatever came back → 640 wide → center-crop to the hub's 8:5 card.
  execFileSync('sips', ['--resampleWidth', '640', raw], { stdio: 'ignore' });
  execFileSync('sips', ['--cropToHeightWidth', '400', '640', raw], { stdio: 'ignore' });
  fs.renameSync(raw, out);
  console.log('ok → thumbs/' + gid + '.png');
}

(async () => {
  console.log('provider: ' + PROVIDER);
  if (PROBE) {
    if (PROVIDER !== 'gemini') {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + KEY } });
      console.log(r.ok ? 'key works' : 'key rejected: ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return;
    }
    const models = await gemImageModels();
    if (!models.length) { console.log('key works, but no image-capable models are visible to it'); return; }
    console.log('image-capable models on this key:');
    models.forEach(m => console.log('  ' + m.name + '   [' + m.methods.join(', ') + ']'));
    return;
  }
  const todo = only ? [only] : ids;
  let made = 0, failed = 0;
  for (const gid of todo) {
    try { await gen(gid); made++; }
    catch (e) { failed++; console.log(`FAILED ${gid}: ${e.message}`); }
  }
  console.log(`\ndone — ${made} handled, ${failed} failed`);
})().catch(e => {
  // A bad key or a dead network shouldn't land as a stack trace.
  const m = String(e.message || e);
  if (/API key not valid|API_KEY_INVALID|\b400\b/.test(m)) console.error('That key was rejected by the provider.');
  else if (/PERMISSION_DENIED|\b403\b/.test(m)) console.error('The key is valid but not allowed to use this API — enable it in the console.');
  else if (/fetch failed|ENOTFOUND|ETIMEDOUT/.test(m)) console.error('Could not reach the provider — check the network.');
  else console.error(m.split('\n')[0]);
  process.exit(1);
});
