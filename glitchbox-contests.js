/* ==========================================================================
   GLITCHBOX - CONTESTS
   --------------------------------------------------------------------------
   The owner runs contests from the hub; winners are paid automatically.

     • best score  - the best GLITCHBOX.score() a player posts in that game
                     while the contest runs (games that report scores only)
     (• most played - gone since 2026-10-13: GLITCHBOX no longer records play time.
        Old ones still display.)

   When the clock runs out the server (settleContests) drops the prizes into
   the winners' gift inbox, so tokens / an unlocked game land on their hub.
   Guests can watch but only signed-in players can place.

   Adds: a 🏆 Contests nav item, a live-contest strip above the hub, and the
   contests window (with create / end controls for the owner).
   Self-test: index.html#contestsmoke (fake server, result in document.title).
   ========================================================================== */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const games = () => (typeof GAMES !== 'undefined' ? GAMES : []);
  const gameOf = f => games().find(g => g.file === f);
  const gname = f => f === '*' ? '🏟️ the whole arcade' : (gameOf(f) ? (gameOf(f).emoji ? gameOf(f).emoji + ' ' : '') + gameOf(f).name : String(f || '').replace(/\.html$/, ''));
  const signedIn = () => typeof currentUser !== 'undefined' && !!currentUser;
  const isOwner = () => typeof lastState !== 'undefined' && lastState && !!lastState.isOwner;
  const PLACES = ['🥇', '🥈', '🥉', '4th', '5th'];
  // Games that report a score with GLITCHBOX.score(); `low` = lower is better.
  const SCORE_GAMES = [{ file: 'neon-putt.html', low: true, unit: 'strokes' }, { file: 'haymaker.html', unit: 'survival wins in a row' }, { file: 'frontline.html', unit: "days of today's orders in a row" }, { file: 'rocket-roadster.html', low: true, unit: 'seconds to the summit' }];
  const scoreInfo = f => SCORE_GAMES.find(g => g.file === f) || {};

  let data = { live: [], past: [] }, skew = 0, open = false, busy = false, form = false;

  async function call(path, opts) {
    if (typeof window.api !== 'function') throw new Error('The arcade server isn\'t reachable.');
    return window.api(path, opts || {});
  }
  function left(ends) {
    const ms = Math.max(0, ends - (Date.now() + skew)), s = Math.floor(ms / 1000);
    if (s <= 0) return 'ending…';
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm ' + (s % 60) + 's';
  }
  function val(c, n) {
    if (c.kind === 'time') { n = Math.round(n || 0); return n < 60 ? n + ' min' : Math.floor(n / 60) + 'h ' + (n % 60) + 'm'; }
    return E(n) + (scoreInfo(c.game).unit ? ' <span class="gbc-dim">' + E(scoreInfo(c.game).unit) + '</span>' : '');
  }
  function what(c) {
    return c.kind === 'time' ? 'Most time played in ' + gname(c.game)
      : (c.low ? 'Lowest score' : 'Best score') + ' in ' + gname(c.game);
  }
  function prizeLine(c) {
    return (c.prizes || []).map((p, i) => '<span class="gbc-prize">' + PLACES[i] + ' ' + (p ? '🪙 ' + p : '') +
      (i === 0 && c.prizeGame ? (p ? ' + ' : '') + '🔓 ' + E(gname(c.prizeGame)) : '') + '</span>').join('');
  }

  function styles() {
    if ($('gbc-style')) return;
    const st = document.createElement('style');
    st.id = 'gbc-style';
    st.textContent = `
#gbc-strip{display:none;margin:0 0 18px;padding:12px 16px;border:1px solid rgba(255,230,0,.35);background:linear-gradient(90deg,rgba(255,230,0,.08),rgba(255,0,128,.06));
  cursor:pointer;align-items:center;gap:14px;flex-wrap:wrap;position:relative;z-index:1}
#gbc-strip.on{display:flex}
#gbc-strip:hover{border-color:rgba(255,230,0,.7)}
#gbc-strip .big{font-size:26px;filter:drop-shadow(0 0 8px rgba(255,230,0,.5))}
#gbc-strip .t{font-family:'Press Start 2P',monospace;font-size:9px;color:#ffe600;letter-spacing:1px}
#gbc-strip .grow{flex:1;min-width:180px}
#gbc-strip .d{color:#d0d8f0;font-size:15px;margin-top:4px}
#gbc-strip .clock{font-family:'Press Start 2P',monospace;font-size:10px;color:#00f5ff}
#gbc-ov{position:fixed;inset:0;z-index:9000;background:rgba(2,4,10,.82);display:none;align-items:flex-start;justify-content:center;overflow:auto;padding:40px 16px}
#gbc-ov.on{display:flex}
#gbc-box{width:100%;max-width:620px;background:#080b14;border:1px solid rgba(255,230,0,.3);box-shadow:0 0 40px rgba(255,230,0,.08);padding:22px;color:#d0d8f0;font-family:Rajdhani,sans-serif;font-size:15px;position:relative}
#gbc-box .x{position:absolute;top:10px;right:12px;background:none;border:0;color:#4a5580;font-size:22px;cursor:pointer}
.gbc-title{font-family:'Press Start 2P',monospace;font-size:13px;color:#ffe600;margin-bottom:6px;letter-spacing:1px}
.gbc-h{font-family:'Press Start 2P',monospace;font-size:8px;color:#4a5580;margin:20px 0 8px;letter-spacing:1px}
.gbc-dim{color:#4a5580}
.gbc-card{border:1px solid rgba(0,245,255,.12);background:rgba(0,245,255,.02);padding:14px;margin-bottom:12px}
.gbc-card.done{border-color:rgba(255,255,255,.07)}
.gbc-name{font-size:18px;font-weight:700;color:#fff}
.gbc-row{display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.gbc-row.me{color:#00ff88}
.gbc-row .r{width:34px;text-align:center}
.gbc-row .g{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gbc-av{width:24px;height:24px;border-radius:50%;object-fit:cover;background:#0f1425;display:inline-flex;align-items:center;justify-content:center;font-size:12px}
.gbc-prize{display:inline-block;margin:6px 10px 0 0;padding:3px 8px;border:1px solid rgba(255,230,0,.25);color:#ffe600;font-size:13px}
.gbc-btn{background:transparent;border:1px solid rgba(0,245,255,.4);color:#00f5ff;padding:7px 12px;font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;cursor:pointer;text-decoration:none;display:inline-block}
.gbc-btn:hover{background:rgba(0,245,255,.08)}
.gbc-btn.y{border-color:rgba(255,230,0,.5);color:#ffe600}
.gbc-btn.r{border-color:rgba(255,0,128,.5);color:#ff0080}
.gbc-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.gbc-in{background:#0a0d18;border:1px solid rgba(0,245,255,.2);color:#d0d8f0;padding:7px 9px;font-family:Rajdhani,sans-serif;font-size:15px;width:100%;box-sizing:border-box}
.gbc-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.gbc-grid label,.gbc-lab{display:block;font-size:12px;color:#4a5580;margin-bottom:3px;letter-spacing:1px}
.gbc-err{color:#ff0080;margin-top:8px;min-height:18px}
@media (max-width:560px){.gbc-grid{grid-template-columns:1fr}}`;
    document.head.appendChild(st);
  }

  // ── hub bits: nav item + live strip ──
  function mount() {
    styles();
    if (!$('nav-contests')) {
      const boards = [...document.querySelectorAll('.nav-item')].find(a => /openBoards/.test(a.getAttribute('onclick') || ''));
      if (boards) {
        const a = document.createElement('a');
        a.className = 'nav-item special'; a.id = 'nav-contests'; a.href = '#';
        a.innerHTML = '<span class="nav-icon">🏅</span><span class="nav-text">Contests</span><span class="nav-count" id="cnt-contests"></span>';
        a.onclick = e => { e.preventDefault(); openContests(); };
        boards.parentNode.insertBefore(a, boards);
      }
    }
    if (!$('gbc-strip')) {
      const rr = $('recent-row');
      if (rr) { const d = document.createElement('div'); d.id = 'gbc-strip'; d.onclick = () => openContests(); rr.parentNode.insertBefore(d, rr); }
    }
    if (!$('gbc-ov')) {
      const ov = document.createElement('div');
      ov.id = 'gbc-ov';
      ov.innerHTML = '<div id="gbc-box"></div>';
      ov.addEventListener('click', e => { if (e.target === ov) closeContests(); });
      document.body.appendChild(ov);
    }
  }
  function renderStrip() {
    const el = $('gbc-strip'), cnt = $('cnt-contests');
    if (cnt) cnt.textContent = data.live.length ? data.live.length : '';
    if (!el) return;
    const c = data.live[0];
    if (!c) { el.classList.remove('on'); el.innerHTML = ''; return; }
    el.classList.add('on');
    el.innerHTML = '<div class="big">🏆</div><div class="grow"><div class="t">// LIVE CONTEST' + (data.live.length > 1 ? 'S · ' + data.live.length : '') + '</div>' +
      '<div class="d"><b>' + E(c.title) + '</b> - ' + E(what(c)) + '</div><div>' + prizeLine(c) + '</div></div>' +
      '<div style="text-align:right"><div class="clock" data-ends="' + c.ends + '">' + left(c.ends) + '</div>' +
      '<div class="gbc-dim" style="font-size:13px;margin-top:6px">' + (c.mine ? 'you\'re #' + c.mine.rank : c.entrants + ' in it') + ' · tap to see</div></div>';
  }

  async function refresh() {
    try {
      const d = await call('/api/contests');
      data = d; skew = (d.now || Date.now()) - Date.now();
      renderStrip();
      if (open && !form) render();
    } catch (e) { /* offline: keep what we have */ }
  }

  // ── the contests window ──
  function openContests() { mount(); open = true; form = false; $('gbc-ov').classList.add('on'); render(); refresh(); }
  function closeContests() { open = false; form = false; const ov = $('gbc-ov'); if (ov) ov.classList.remove('on'); }
  function av(x) { return x.picture ? '<img class="gbc-av" src="' + E(x.picture) + '" alt="" referrerpolicy="no-referrer">' : '<span class="gbc-av">👤</span>'; }
  function liveCard(c) {
    const me = signedIn() ? currentUser.sub : '';
    const rows = (c.standings || []).map((x, i) => '<div class="gbc-row' + (x.sub === me ? ' me' : '') + '"><span class="r">' + (i < 3 ? PLACES[i] : i + 1) + '</span>' + av(x) +
      '<span class="g">' + E(x.name) + (x.sub === me ? ' (you)' : '') + '</span><span>' + val(c, x.score) + '</span></div>').join('');
    const how = c.kind === 'time'
      ? 'Play ' + (c.game === '*' ? 'anything in the arcade' : gname(c.game)) + ' - every minute until the clock runs out counts.'
      : 'Play ' + gname(c.game) + ' - your ' + (c.low ? 'lowest' : 'best') + ' score from the start of the contest counts.';
    return '<div class="gbc-card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div class="gbc-name">' + E(c.title) + '</div>' +
      '<div class="clock" data-ends="' + c.ends + '" style="font-family:\'Press Start 2P\',monospace;font-size:10px;color:#00f5ff">' + left(c.ends) + '</div></div>' +
      '<div>' + E(what(c)) + '</div>' + (c.note ? '<div class="gbc-dim" style="margin-top:4px">' + E(c.note) + '</div>' : '') +
      '<div>' + prizeLine(c) + '</div>' +
      '<div class="gbc-h">// STANDINGS · ' + (c.entrants || 0) + ' IN IT</div>' +
      (rows || '<div class="gbc-dim">Nobody yet - first one in is winning.</div>') +
      (c.mine && c.mine.rank > 10 ? '<div class="gbc-row me"><span class="r">' + c.mine.rank + '</span><span class="g">you</span><span>' + val(c, c.mine.score) + '</span></div>' : '') +
      '<div class="gbc-dim" style="margin-top:10px;font-size:13px">' + E(how) + (signedIn() ? '' : ' <b style="color:#ffe600">Sign in to enter - guests can\'t win prizes.</b>') + '</div>' +
      '<div class="gbc-acts">' + (c.game !== '*' && typeof gameURL === 'function' ? '<a class="gbc-btn y" href="' + E(gameURL(c.game)) + '">▶ Play ' + E(gname(c.game)) + '</a>' : '') +
      (isOwner() ? '<button class="gbc-btn" data-gbc="end" data-id="' + c.id + '">🏁 End now &amp; pay out</button>' +
        '<button class="gbc-btn r" data-gbc="cancel" data-id="' + c.id + '">✕ Cancel</button>' : '') + '</div></div>';
  }
  function pastCard(c) {
    const w = c.winners || [];
    return '<div class="gbc-card done"><div class="gbc-name" style="font-size:16px">' + E(c.title) + '</div>' +
      '<div class="gbc-dim">' + E(what(c)) + ' · ended ' + new Date(c.ends).toLocaleDateString([], { month: 'short', day: 'numeric' }) + '</div>' +
      (w.length ? w.map(x => '<div class="gbc-row"><span class="r">' + PLACES[x.place - 1] + '</span>' + av(x) + '<span class="g">' + E(x.name) + '</span><span>' + val(c, x.score) +
        '</span><span style="color:#ffe600;margin-left:8px">' + (x.tokens ? '🪙 ' + x.tokens : '') + (x.game ? ' 🔓' : '') + '</span></div>').join('')
        : '<div class="gbc-dim" style="margin-top:6px">Nobody entered.</div>') + '</div>';
  }
  function render() {
    const box = $('gbc-box');
    if (!box) return;
    if (form) { box.innerHTML = formHTML(); return; }
    box.innerHTML = '<button class="x" data-gbc="close" aria-label="Close">×</button>' +
      '<div class="gbc-title">🏆 CONTESTS</div><div class="gbc-dim">Win the contest, win the prize - it lands in your hub automatically when the clock runs out.</div>' +
      (isOwner() ? '<div class="gbc-acts"><button class="gbc-btn y" data-gbc="new">＋ New contest</button></div>' : '') +
      '<div class="gbc-h">// LIVE NOW</div>' + (data.live.length ? data.live.map(liveCard).join('') : '<div class="gbc-dim">No contest running right now - check back soon.</div>') +
      (data.past.length ? '<div class="gbc-h">// RECENT WINNERS</div>' + data.past.map(pastCard).join('') : '');
  }

  // ── owner: create ──
  function formHTML() {
    const opt = (v, t, sel) => '<option value="' + E(v) + '"' + (sel ? ' selected' : '') + '>' + E(t) + '</option>';
    const special = games().filter(g => g.price);
    return '<button class="x" data-gbc="back" aria-label="Back">×</button><div class="gbc-title">＋ NEW CONTEST</div>' +
      '<div class="gbc-lab" style="margin-top:12px">NAME</div><input class="gbc-in" id="gbc-title" maxlength="80" placeholder="e.g. Weekend Putt-Off">' +
      '<div class="gbc-grid" style="margin-top:10px"><div><label>TYPE</label><select class="gbc-in" id="gbc-kind">' +
        opt('score', 'Best score', true) + '</select></div>' +
      '<div><label>GAME</label><select class="gbc-in" id="gbc-game"></select></div></div>' +
      '<div class="gbc-grid" style="margin-top:10px"><div><label>RUNS FOR</label><select class="gbc-in" id="gbc-hours">' +
        opt('1', '1 hour') + opt('6', '6 hours') + opt('24', '1 day', true) + opt('72', '3 days') + opt('168', '1 week') + opt('336', '2 weeks') + '</select></div>' +
      '<div><label>1ST ALSO UNLOCKS (OPTIONAL)</label><select class="gbc-in" id="gbc-pgame">' + opt('', '- nothing -') +
        special.map(g => opt(g.file, (g.emoji ? g.emoji + ' ' : '') + g.name)).join('') + '</select></div></div>' +
      '<div class="gbc-lab" style="margin-top:10px">TOKEN PRIZES - 1ST / 2ND / 3RD (0 = no prize for that place)</div>' +
      '<div class="gbc-grid" style="grid-template-columns:1fr 1fr 1fr"><input class="gbc-in" id="gbc-p1" type="number" min="0" value="500">' +
        '<input class="gbc-in" id="gbc-p2" type="number" min="0" value="250"><input class="gbc-in" id="gbc-p3" type="number" min="0" value="100"></div>' +
      '<div class="gbc-lab" style="margin-top:10px">NOTE (OPTIONAL)</div><input class="gbc-in" id="gbc-note" maxlength="200" placeholder="e.g. Ties go to whoever got there first">' +
      '<div class="gbc-err" id="gbc-err"></div>' +
      '<div class="gbc-acts"><button class="gbc-btn y" data-gbc="create">🏆 Start contest</button><button class="gbc-btn r" data-gbc="back">Cancel</button></div>';
  }
  function fillGames() {
    const sel = $('gbc-game'), kind = $('gbc-kind');
    if (!sel || !kind) return;
    const list = kind.value === 'score'
      ? SCORE_GAMES.filter(g => gameOf(g.file)).map(g => [g.file, gname(g.file) + (g.low ? ' (lowest wins)' : '')])
      : [['*', '🏟️ Anywhere in the arcade']].concat(games().slice().sort((a, b) => a.name.localeCompare(b.name)).map(g => [g.file, gname(g.file)]));
    sel.innerHTML = list.map(o => '<option value="' + E(o[0]) + '">' + E(o[1]) + '</option>').join('');
  }
  async function create() {
    const err = $('gbc-err');
    const kind = $('gbc-kind').value, game = $('gbc-game').value;
    const body = { title: $('gbc-title').value.trim(), kind, game, hours: +$('gbc-hours').value,
                   low: kind === 'score' && !!scoreInfo(game).low,
                   prizes: ['gbc-p1', 'gbc-p2', 'gbc-p3'].map(id => Math.max(0, parseInt($(id).value, 10) || 0)),
                   prizeGame: $('gbc-pgame').value, note: $('gbc-note').value.trim() };
    if (!body.title) { err.textContent = 'Give it a name.'; return; }
    if (!body.prizes.some(Boolean) && !body.prizeGame) { err.textContent = 'Add at least one prize.'; return; }
    try {
      const d = await call('/api/admin/contest', { method: 'POST', body });
      data = d; form = false; render(); renderStrip();
      if (typeof noticeToast === 'function') noticeToast('🏆 CONTEST LIVE', body.title + ' is running - everyone sees it on the hub.', 5000);
    } catch (e) { err.textContent = e.message; }
  }

  document.addEventListener('click', async e => {
    const el = e.target.closest && e.target.closest('[data-gbc]');
    if (!el || busy) return;
    const a = el.dataset.gbc;
    if (a === 'close') closeContests();
    else if (a === 'new') { form = true; render(); fillGames(); $('gbc-kind').onchange = fillGames; }
    else if (a === 'back') { form = false; render(); }
    else if (a === 'create') { busy = true; try { await create(); } finally { busy = false; } }
    else if (a === 'end' || a === 'cancel') {
      const c = data.live.find(x => String(x.id) === el.dataset.id);
      if (!c || !confirmIt(a === 'end' ? 'End "' + c.title + '" now and pay the prizes to whoever is winning?' : 'Cancel "' + c.title + '"? Nobody gets a prize.')) return;
      busy = true;
      try { data = await call('/api/admin/contest-end', { method: 'POST', body: { id: c.id, cancel: a === 'cancel' } }); render(); renderStrip(); }
      catch (err) { if (typeof noticeToast === 'function') noticeToast('⚠️', err.message, 5000); }
      finally { busy = false; }
    }
  });
  const confirmIt = m => (window.__gbcConfirm || window.confirm)(m);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) closeContests(); });

  // Countdowns tick every second without re-rendering anything else.
  setInterval(() => {
    document.querySelectorAll('[data-ends]').forEach(el => { el.textContent = left(+el.dataset.ends); });
    if (data.live.some(c => c.ends - (Date.now() + skew) < -3000) && !refresh.pending) { refresh.pending = true; refresh().finally(() => { refresh.pending = false; }); }
  }, 1000);

  const SMOKE = location.hash.indexOf('contestsmoke') !== -1;
  function boot() { mount(); if (!SMOKE) { refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 60000); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.GBContests = { open: openContests, close: closeContests, refresh };

  // ── #contestsmoke ── drives the window against a fake server.
  if (SMOKE) addEventListener('load', () => setTimeout(async () => {
    let pass = 0, fail = 0; const lines = [], sent = [];
    const t = (n, c) => { if (c) { pass++; lines.push('ok   ' + n); } else { fail++; lines.push('FAIL ' + n); } };
    const wait = () => new Promise(r => setTimeout(r, 30));
    const now = Date.now();
    const live = { id: 7, title: 'Putt-Off', game: 'neon-putt.html', kind: 'score', low: true, starts: now - 1000, ends: now + 90061000,
      prizes: [500, 250, 100], prizeGame: 'gridlock.html', note: 'ties: first wins', status: 'live',
      standings: [{ sub: 's1', name: 'Dave S.', score: 41 }, { sub: 'me', name: 'Me T.', score: 44 }], entrants: 2, mine: { rank: 2, score: 44 } };
    const past = { id: 3, title: 'Grind Week', game: '*', kind: 'time', starts: now - 9e8, ends: now - 1e6, prizes: [300], status: 'done',
      winners: [{ sub: 's1', name: 'Dave S.', score: 125, place: 1, tokens: 300, game: '' }] };
    let fake = { live: [live], past: [past], now };
    window.api = async (path, opts) => {
      sent.push({ path, body: opts && opts.body });
      if (path === '/api/contests') return fake;
      if (path === '/api/admin/contest') { fake = { live: [live, Object.assign({}, live, { id: 8, title: opts.body.title, standings: [], entrants: 0, mine: null })], past: [past], now }; return fake; }
      if (path === '/api/admin/contest-end') { fake = { live: [], past: [past], now }; return fake; }
      throw new Error('unexpected ' + path);
    };
    window.currentUser = { sub: 'me', name: 'Me Tester' };
    window.lastState = { isOwner: false };
    window.__gbcConfirm = () => true;
    try {
      await refresh(); await wait();
      t('nav item added', !!$('nav-contests'));
      t('nav shows the live count', ($('cnt-contests') || {}).textContent === '1');
      t('live strip shows on the hub', $('gbc-strip').classList.contains('on') && /Putt-Off/.test($('gbc-strip').textContent));
      t('strip tells you your rank', /you're #2/.test($('gbc-strip').textContent));
      t('countdown formats days', /^1d 1h$/.test($('gbc-strip').querySelector('[data-ends]').textContent));
      openContests(); await wait(); await wait();
      const box = () => $('gbc-box').textContent;
      t('window opens', $('gbc-ov').classList.contains('on') && /CONTESTS/.test(box()));
      t('shows what wins', /Lowest score in/.test(box()));
      t('shows prizes incl. the unlock', /🪙 500/.test(box()) && /🔓/.test(box()) && /Gridlock/.test(box()));
      t('standings list with you highlighted', !!$('gbc-box').querySelector('.gbc-row.me') && /Dave S\./.test(box()));
      t('score unit shown', /strokes/.test(box()));
      t('past winners listed', /RECENT WINNERS/.test(box()) && /Grind Week/.test(box()) && /2h 5m/.test(box()));
      t('players get a Play button', !!$('gbc-box').querySelector('a.gbc-btn'));
      t('players get no owner controls', !$('gbc-box').querySelector('[data-gbc="new"]') && !$('gbc-box').querySelector('[data-gbc="end"]'));
      window.currentUser = null; render();
      t('guests are told to sign in', /Sign in to enter/.test(box()));
      window.currentUser = { sub: 'me', name: 'Me Tester' };
      window.lastState.isOwner = true; render();
      t('owner sees New / End / Cancel', !!$('gbc-box').querySelector('[data-gbc="new"]') && !!$('gbc-box').querySelector('[data-gbc="end"]'));
      $('gbc-box').querySelector('[data-gbc="new"]').click(); await wait();
      t('form opens', !!$('gbc-title') && $('gbc-game').options.length === SCORE_GAMES.filter(g => gameOf(g.file)).length);
      t('neon putt is marked lowest-wins', /lowest wins/.test($('gbc-game').options[0].textContent));
      t('only best-score contests can be made (play time isn\'t recorded)', $('gbc-kind').options.length === 1 && $('gbc-kind').value === 'score');
      const g0 = $('gbc-game').value;
      $('gbc-box').querySelector('[data-gbc="create"]').click(); await wait();
      t('nameless contest refused', /name/.test($('gbc-err').textContent) && !sent.some(s => s.path === '/api/admin/contest'));
      $('gbc-title').value = 'Grind 2'; ['gbc-p1', 'gbc-p2', 'gbc-p3'].forEach(id => $(id).value = '0');
      $('gbc-box').querySelector('[data-gbc="create"]').click(); await wait();
      t('prize-less contest refused', /prize/.test($('gbc-err').textContent));
      $('gbc-p1').value = '1000'; $('gbc-hours').value = '72';
      $('gbc-box').querySelector('[data-gbc="create"]').click(); await wait(); await wait();
      const c = (sent.filter(s => s.path === '/api/admin/contest').pop() || {}).body || {};
      t('create posts the contest', c.title === 'Grind 2' && c.kind === 'score' && c.game === g0 && c.hours === 72 && c.prizes[0] === 1000 && c.prizes[1] === 0);
      t('back on the list with the new contest', /Grind 2/.test(box()) && ($('cnt-contests') || {}).textContent === '2');
      $('gbc-box').querySelector('[data-gbc="end"]').click(); await wait(); await wait();
      t('end posts and clears live', sent.some(s => s.path === '/api/admin/contest-end' && s.body.id === 7 && !s.body.cancel) && !$('gbc-strip').classList.contains('on'));
      closeContests();
      t('window closes', !$('gbc-ov').classList.contains('on'));
    } catch (e) { fail++; lines.push('EXCEPTION ' + (e.stack || e)); }
    const res = 'SMOKE ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail);
    const pre = document.createElement('pre'); pre.id = 'contest-smoke'; pre.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;color:#0f0;overflow:auto;padding:12px;margin:0';
    pre.textContent = res + '\n\n' + lines.join('\n'); document.body.appendChild(pre); document.title = res;
  }, 300));
})();
