/* ==========================================================================
   GLITCHBOX — OWNER COMMAND LINE
   --------------------------------------------------------------------------
   A drop-down console for the one account that owns the arcade. Opens with the
   ` (backtick) key, or Ctrl+Shift+K. Type `help` for the command list.

   Who can use it
   --------------
   The console only builds itself once /api/me comes back with isOwner — the
   same server verdict the ⚙ Owner Console uses. Two honest caveats:

   • Server commands (players, ban, delete, reports…) are genuinely protected.
     /api/admin/* re-checks the owner on every single request, so a forged
     client gets a 403 no matter what it renders.
   • Local commands (tokens, unlock, wipe) only rewrite THIS browser's
     localStorage. Hiding them behind the owner check is convenience, not
     security — any player could already edit their own localStorage by hand.
     Nothing here leaks onto the server or another player's device.

   Lives in its own file so it can be dropped or reloaded without touching the
   hub or the older click-driven console in glitchbox-admin.js.

   #cmdsmoke runs the self-tests headlessly (result in document.title).
   ========================================================================== */
(function () {
  'use strict';

  const SMOKE = location.hash.indexOf('cmdsmoke') !== -1;

  let built = false, shown = false, isOwner = false;
  let hist = [], histIdx = 0, pending = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const ownerNow = () => (typeof lastState !== 'undefined' && lastState && !!lastState.isOwner);
  const hasTokens = () => typeof tokens === 'function' && typeof setTokens === 'function';
  const tokKeys = () => (typeof TOK !== 'undefined' && TOK) ? TOK : {
    bal:'glitchbox.tokens', own:'glitchbox.owned', icons:'glitchbox.icons',
    seen:'glitchbox.seen', ts:'glitchbox.playts', daily:'glitchbox.daily',
    streak:'glitchbox.streak', queue:'glitchbox.queue', fpaid:'glitchbox.fpaid' };

  async function call(path, opts) {
    if (typeof window.api === 'function') return window.api(path, opts);
    const base = window.GLITCHBOX_API || '';
    const headers = { 'Authorization': 'Bearer ' + (localStorage.getItem('glitchbox_session') || '') };
    let body;
    if (opts && opts.body) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
    const r = await fetch(base + path, { method: (opts && opts.method) || 'GET', headers, body });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return data;
  }

  // ── output ─────────────────────────────────────────────────────────────────
  const OUT = [];                       // kept even when the DOM isn't built (tests)
  function say(text, cls) {
    OUT.push({ text: String(text == null ? '' : text), cls: cls || '' });
    if (OUT.length > 400) OUT.shift();
    const log = $('gbc-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'gbc-line' + (cls ? ' ' + cls : '');
    div.innerHTML = esc(text) || '&nbsp;';
    log.appendChild(div);
    log.scrollTop = 1e6;
  }
  const ok   = t => say(t, 'ok');
  const bad  = t => say(t, 'bad');
  const warn = t => say(t, 'warn');
  const head = t => say(t, 'head');

  // ── helpers ────────────────────────────────────────────────────────────────
  // Quote-aware so reasons can be one argument: ban dave "spawn camping"
  function parse(line) {
    const out = [], re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
    return out;
  }
  function gameList() { return (typeof GAMES !== 'undefined' && GAMES) ? GAMES : []; }
  const gid = g => g.file.replace('.html', '');
  // Exact id, then exact name, then a substring on either — so `play grid` works.
  function findGame(q) {
    const s = String(q || '').toLowerCase().replace(/\.html$/, '');
    if (!s) return null;
    const L = gameList();
    return L.find(g => gid(g).toLowerCase() === s)
        || L.find(g => (g.name || '').toLowerCase() === s)
        || L.find(g => gid(g).toLowerCase().indexOf(s) !== -1)
        || L.find(g => (g.name || '').toLowerCase().indexOf(s) !== -1)
        || null;
  }
  function repaint() {
    if (typeof paintTokens === 'function') paintTokens();
    if (typeof renderGames === 'function') renderGames();
    if (typeof renderIconPicker === 'function') renderIconPicker();
  }
  function ago(ts) {
    if (!ts) return '—';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }
  function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }

  // One player from a loose query. Prints the candidates and returns null when
  // the query is ambiguous — never guesses at a target for a ban or a delete.
  async function pickPlayer(q) {
    if (!q) { bad('name somebody — a name, email or friend code'); return null; }
    const list = (await call('/api/admin/players?q=' + encodeURIComponent(q))).players || [];
    if (!list.length) { bad('no player matches "' + q + '"'); return null; }
    const lq = String(q).toLowerCase();
    const exact = list.find(p => (p.code || '').toLowerCase() === lq)
               || list.find(p => (p.email || '').toLowerCase() === lq)
               || list.find(p => (p.name || '').toLowerCase() === lq);
    if (exact) return exact;
    if (list.length === 1) return list[0];
    warn(list.length + ' players match "' + q + '" — be more specific:');
    list.slice(0, 12).forEach(p => say('   ' + pad(p.name, 18) + ' ' + pad(p.email, 28) + ' ' + (p.code || '—')));
    return null;
  }

  // Typo help. A prefix filter alone misses the common case — one wrong letter
  // in the middle — so this ranks by edit distance and keeps the closest few.
  function editDistance(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, i) => i), cur = new Array(n + 1);
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++)
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      const swap = prev; prev = cur; cur = swap;
    }
    return prev[n];
  }
  function nearest(name) {
    const budget = Math.max(1, Math.min(3, Math.ceil(name.length / 2)));
    return Object.keys(CMDS)
      .map(k => ({ k, d: editDistance(name, k) }))
      .filter(x => x.d <= budget || x.k.indexOf(name) === 0)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map(x => x.k);
  }

  function askConfirm(what, run) {
    pending = { what, run };
    warn('⚠ ' + what);
    warn('   type  confirm  to go ahead — anything else cancels');
  }

  // ── commands ───────────────────────────────────────────────────────────────
  // One registry drives execution, `help` and tab-completion, so they can't drift.
  const CMDS = {
    help: { usage:'help [command]', about:'list the commands, or explain one', run(a) {
      if (a[0]) {
        const c = CMDS[a[0].toLowerCase()];
        if (!c) { bad('no command called "' + a[0] + '"'); return; }
        head(c.usage); say('   ' + c.about + (c.owner ? '   (server · owner only)' : '   (this device only)'));
        return;
      }
      // An alias points at the same object as its canonical command; listing by
      // usage keeps `jump` from showing up as a second, identical `play` line.
      const canon = k => CMDS[k].usage.split(' ')[0] === k;
      head('// SERVER — owner-checked on every request');
      Object.keys(CMDS).filter(k => canon(k) && CMDS[k].owner).forEach(k => say('  ' + pad(CMDS[k].usage, 26) + CMDS[k].about));
      head('// THIS DEVICE — local storage only');
      Object.keys(CMDS).filter(k => canon(k) && !CMDS[k].owner).forEach(k => say('  ' + pad(CMDS[k].usage, 26) + CMDS[k].about));
      const aliases = Object.keys(CMDS).filter(k => !canon(k));
      if (aliases.length) say('  ' + pad('aliases', 26) + aliases.map(k => k + ' → ' + CMDS[k].usage.split(' ')[0]).join(', '));
      say('');
      say('  ` or Ctrl+Shift+K toggles this console · Esc closes · ↑/↓ history · Tab completes');
    }},

    whoami: { usage:'whoami', about:'who this browser is signed in as', run() {
      const u = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
      if (!u) { bad('not signed in'); return; }
      head('// ' + (u.name || '?'));
      say('  email    ' + (u.email || '—'));
      say('  sub      ' + String(u.sub || '—').slice(0, 28) + '…');
      say('  owner    ' + (ownerNow() ? 'yes — the server says so' : 'no'));
      if (hasTokens()) {
        const owned = (() => { try { return (JSON.parse(localStorage.getItem(tokKeys().own)) || []).length; } catch (e) { return 0; } })();
        const ics = (() => { try { return (JSON.parse(localStorage.getItem(tokKeys().icons)) || []).length; } catch (e) { return 0; } })();
        say('  tokens   ' + tokens() + '   ·   ' + owned + ' games unlocked   ·   ' + ics + ' icons');
      }
    }},

    tokens: { usage:'tokens [n|+n|-n]', about:'show or set this device\'s balance', run(a) {
      if (!hasTokens()) { bad('this build has no token economy'); return; }
      if (!a.length) { ok('balance: ' + tokens()); return; }
      const raw = String(a[0]), n = parseInt(raw, 10);
      if (isNaN(n)) { bad('tokens wants a number, like  tokens 9999  or  tokens +500'); return; }
      const next = /^[+-]/.test(raw) ? tokens() + n : n;
      setTokens(next); repaint();
      ok('balance: ' + tokens());
    }},

    unlock: { usage:'unlock [games|icons|all]', about:'unlock everything on this device', run(a) {
      const what = (a[0] || 'all').toLowerCase(), K = tokKeys();
      if (['games','icons','all'].indexOf(what) === -1) { bad('unlock games, icons or all'); return; }
      if (what !== 'icons') {
        const files = gameList().map(g => g.file);
        localStorage.setItem(K.own, JSON.stringify(files));
        ok(files.length + ' games unlocked');
      }
      if (what !== 'games') {
        const ids = (typeof ICON_BY_ID !== 'undefined' && ICON_BY_ID) ? Object.keys(ICON_BY_ID) : [];
        localStorage.setItem(K.icons, JSON.stringify(ids));
        ok(ids.length + ' icons unlocked');
      }
      repaint();
    }},

    lock: { usage:'lock [games|icons|all]', about:'put the unlocks back (tokens untouched)', run(a) {
      const what = (a[0] || 'all').toLowerCase(), K = tokKeys();
      if (['games','icons','all'].indexOf(what) === -1) { bad('lock games, icons or all'); return; }
      if (what !== 'icons') { localStorage.removeItem(K.own); ok('games relocked'); }
      if (what !== 'games') { localStorage.removeItem(K.icons); ok('icons relocked'); }
      repaint();
    }},

    games: { usage:'games [filter]', about:'list game ids (what play/jump accept)', run(a) {
      const f = (a[0] || '').toLowerCase();
      let L = gameList();
      if (f) L = L.filter(g => gid(g).toLowerCase().indexOf(f) !== -1 || (g.name || '').toLowerCase().indexOf(f) !== -1);
      if (!L.length) { bad('nothing matches "' + f + '"'); return; }
      head('// ' + L.length + ' games');
      L.forEach(g => say('  ' + pad(gid(g), 26) + (g.name || '') + (g.price ? '   [' + g.price + ' tokens]' : '')));
    }},

    play: { usage:'play <game>', about:'launch a game by id or name', run(a) {
      const g = findGame(a.join(' '));
      if (!g) { bad('no game matches "' + a.join(' ') + '" — try  games'); return; }
      ok('launching ' + (g.name || gid(g)) + '…');
      if (!SMOKE) location.href = g.file;
    }},

    reset: { usage:'reset', about:'clear tokens, unlocks, streak and play history', run() {
      askConfirm('Reset the whole economy on this device?', () => {
        const K = tokKeys();
        Object.keys(K).forEach(k => localStorage.removeItem(K[k]));
        repaint();
        ok('economy reset');
      });
    }},

    wipe: { usage:'wipe', about:'clear ALL glitchbox data here, sign-in included', run() {
      askConfirm('Erase every glitchbox.* key on this device and sign out?', () => {
        Object.keys(localStorage).filter(k => k.indexOf('glitchbox') === 0).forEach(k => localStorage.removeItem(k));
        ok('device cleared — reloading');
        if (!SMOKE) setTimeout(() => location.reload(), 500);
      });
    }},

    session: { usage:'session', about:'decode the stored session token (no signature)', run() {
      try {
        const t = localStorage.getItem('glitchbox_session') || '';
        if (!t) { bad('no session stored'); return; }
        const p = JSON.parse(atob(t.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
        head('// SESSION'); say('  ' + JSON.stringify(p));
      } catch (e) { bad('session token unreadable'); }
    }},

    sync: { usage:'sync', about:'re-fetch /api/me right now', async run() {
      if (typeof refreshState !== 'function') { bad('the hub has no refreshState()'); return; }
      await refreshState();
      ok('state refreshed · owner: ' + (ownerNow() ? 'yes' : 'no'));
    }},

    clear: { usage:'clear', about:'clear this console', run() {
      OUT.length = 0;
      const log = $('gbc-log'); if (log) log.innerHTML = '';
    }},

    exit: { usage:'exit', about:'close the console', run() { close(); } },

    // ── server side ──
    stats: { usage:'stats', about:'arcade totals at a glance', owner:true, async run() {
      const o = await call('/api/admin/overview'), c = o.counts || {};
      head('// ARCADE');
      Object.keys(c).forEach(k => say('  ' + pad(k, 14) + c[k]));
      if (o.recent && o.recent.length) {
        head('// NEWEST');
        o.recent.slice(0, 8).forEach(u => say('  ' + pad(u.name, 20) + 'joined ' + ago(u.created)));
      }
    }},

    players: { usage:'players [query]', about:'list or search players', owner:true, async run(a) {
      const q = a.join(' ');
      const list = (await call('/api/admin/players?q=' + encodeURIComponent(q))).players || [];
      if (!list.length) { bad(q ? 'nobody matches "' + q + '"' : 'no players yet'); return; }
      head('// ' + list.length + ' player' + (list.length === 1 ? '' : 's'));
      list.forEach(p => say('  ' + (p.banned ? '⛔ ' : '   ') + pad(p.name, 18) + pad(p.email, 28) +
        pad(p.code || '—', 8) + 'seen ' + ago(p.last_seen), p.banned ? 'warn' : ''));
    }},

    who: { usage:'who <query>', about:'everything about one player', owner:true, async run(a) {
      const p = await pickPlayer(a.join(' '));
      if (!p) return;
      head('// ' + p.name + (p.banned ? '   ⛔ BANNED' : ''));
      say('  email    ' + (p.email || '—'));
      say('  code     ' + (p.code || '—'));
      say('  sub      ' + String(p.sub).slice(0, 28) + '…');
      say('  joined   ' + ago(p.created) + '     last seen ' + ago(p.last_seen));
      say('  friends  ' + p.friends + '     saves ' + p.saves + '     reports ' + p.reports);
      if (p.ban_reason) say('  reason   "' + p.ban_reason + '"');
    }},

    ban: { usage:'ban <query> [reason]', about:'ban a player, killing their invites', owner:true, async run(a) {
      const p = await pickPlayer(a[0]);
      if (!p) return;
      const reason = a.slice(1).join(' ');
      await call('/api/admin/ban', { method:'POST', body:{ sub:p.sub, banned:true, reason } });
      ok('banned ' + p.name + (reason ? ' — "' + reason + '"' : ''));
    }},

    unban: { usage:'unban <query>', about:'lift a ban', owner:true, async run(a) {
      const p = await pickPlayer(a.join(' '));
      if (!p) return;
      await call('/api/admin/ban', { method:'POST', body:{ sub:p.sub, banned:false } });
      ok('unbanned ' + p.name);
    }},

    'delete': { usage:'delete <query>', about:'erase an account, saves and all', owner:true, async run(a) {
      const p = await pickPlayer(a.join(' '));
      if (!p) return;
      askConfirm('Delete ' + p.name + ' (' + p.email + ') permanently? Friendships, invites and cloud saves go too.',
        async () => {
          await call('/api/admin/delete', { method:'POST', body:{ sub:p.sub } });
          ok('deleted ' + p.name);
        });
    }},

    reports: { usage:'reports', about:'open player reports', owner:true, async run() {
      const list = (await call('/api/admin/reports')).reports || [];
      if (!list.length) { ok('no reports — quiet arcade'); return; }
      head('// ' + list.length + ' report' + (list.length === 1 ? '' : 's'));
      list.forEach(r => {
        say('  #' + pad(r.id, 5) + pad(r.reported || '(deleted)', 18) + 'by ' + pad(r.reporter || '(deleted)', 18) + ago(r.created),
          r.banned ? 'warn' : '');
        if (r.reason) say('        "' + r.reason + '"');
      });
      say('  dismiss <id> to clear one');
    }},

    dismiss: { usage:'dismiss <id>', about:'clear one report', owner:true, async run(a) {
      if (!a[0]) { bad('which report? try  reports'); return; }
      await call('/api/admin/dismiss-report', { method:'POST', body:{ id:a[0] } });
      ok('report #' + a[0] + ' dismissed');
    }},
  };
  CMDS.jump = CMDS.play;        // muscle memory from the old console's Dev tab

  // ── execution ──────────────────────────────────────────────────────────────
  async function run(line) {
    line = String(line || '').trim();
    if (!line) return;

    if (pending) {
      const p = pending; pending = null;
      if (/^(confirm|yes|y)$/i.test(line)) { try { await p.run(); } catch (e) { bad(e.message || 'failed'); } }
      else say('cancelled');
      return;
    }

    const parts = parse(line), name = (parts[0] || '').toLowerCase(), args = parts.slice(1);
    const cmd = CMDS[name];
    if (!cmd) {
      bad('no command called "' + name + '"');
      const near = nearest(name);
      if (near.length) say('did you mean: ' + near.join(', '));
      else say('type  help  for the list');
      return;
    }
    // Owner-only commands are refused here for a clean message; the server
    // refuses them again regardless of what this client believes.
    if (cmd.owner && !ownerNow()) { bad('owner only — the server has to vouch for you first'); return; }
    try { await cmd.run(args, line); }
    catch (e) {
      const m = e.message || 'that failed';
      // "Failed to fetch" is what a browser says for offline, CORS and a dead
      // Worker alike; none of those are worth showing in that shape.
      if (/failed to fetch|networkerror|load failed/i.test(m)) bad("couldn't reach the arcade server — offline, or the Worker is down");
      else if (e.status === 403) bad('the server refused that — it does not consider this account the owner');
      else bad(m);
    }
  }

  // ── shell ──────────────────────────────────────────────────────────────────
  function build() {
    if (built) return;
    built = true;
    const css = `
    .gbc-wrap { position:fixed; left:0; right:0; top:0; z-index:13000; display:none;
      flex-direction:column; height:min(46vh,420px); background:rgba(4,6,12,.96);
      border-bottom:1px solid rgba(0,245,255,.35); box-shadow:0 14px 40px rgba(0,0,0,.6),0 0 60px rgba(0,245,255,.06);
      backdrop-filter:blur(6px); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
    .gbc-wrap.show { display:flex; }
    .gbc-bar { display:flex; align-items:center; gap:10px; padding:7px 12px;
      border-bottom:1px solid rgba(0,245,255,.16); background:linear-gradient(100deg,#12001a,#04121a); flex-shrink:0; }
    .gbc-tag { font-family:'Press Start 2P',monospace; font-size:9px; color:#ff0080; text-shadow:0 0 10px rgba(255,0,128,.6); }
    .gbc-who { font-size:11px; color:#6b7690; flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .gbc-x { background:transparent; border:1px solid rgba(0,245,255,.3); color:#00f5ff; width:22px; height:22px;
      cursor:pointer; font-size:12px; line-height:1; flex-shrink:0; }
    .gbc-log { flex:1; overflow-y:auto; padding:10px 14px; font-size:12px; line-height:1.55; color:#b9c4dc; }
    .gbc-line { white-space:pre-wrap; word-break:break-word; }
    .gbc-line.cmd  { color:#00f5ff; }
    .gbc-line.ok   { color:#5bf0a6; }
    .gbc-line.bad  { color:#ff5c8a; }
    .gbc-line.warn { color:#ffc24a; }
    .gbc-line.head { color:#ff0080; margin-top:8px; }
    .gbc-form { display:flex; align-items:center; gap:8px; padding:8px 14px; flex-shrink:0;
      border-top:1px solid rgba(0,245,255,.16); background:#05080f; }
    .gbc-caret { color:#ff0080; font-size:13px; }
    .gbc-in { flex:1; background:transparent; border:none; outline:none; color:#e8eefc;
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; }`;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    const wrap = document.createElement('div');
    wrap.className = 'gbc-wrap';
    wrap.id = 'gbc-wrap';
    wrap.innerHTML =
      '<div class="gbc-bar"><span class="gbc-tag">OWNER CMD</span>' +
        '<span class="gbc-who" id="gbc-who"></span>' +
        '<button class="gbc-x" id="gbc-x" title="Close (Esc)">✕</button></div>' +
      '<div class="gbc-log" id="gbc-log"></div>' +
      '<form class="gbc-form" id="gbc-form"><span class="gbc-caret">&gt;</span>' +
        '<input class="gbc-in" id="gbc-in" autocomplete="off" spellcheck="false" ' +
          'placeholder="help — or start typing and hit Tab"></form>';
    document.body.appendChild(wrap);

    // Replay anything printed before the DOM existed.
    const log = $('gbc-log');
    OUT.forEach(l => {
      const d = document.createElement('div');
      d.className = 'gbc-line' + (l.cls ? ' ' + l.cls : '');
      d.innerHTML = esc(l.text) || '&nbsp;';
      log.appendChild(d);
    });

    $('gbc-x').addEventListener('click', close);
    $('gbc-form').addEventListener('submit', ev => {
      ev.preventDefault();
      const inp = $('gbc-in'), line = inp.value;
      inp.value = '';
      if (!line.trim()) return;
      say('> ' + line, 'cmd');
      hist.push(line); if (hist.length > 60) hist.shift();
      histIdx = hist.length;
      run(line);
    });
    $('gbc-in').addEventListener('keydown', ev => {
      if (ev.key === 'ArrowUp')   { ev.preventDefault(); if (histIdx > 0) $('gbc-in').value = hist[--histIdx] || ''; }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); histIdx = Math.min(hist.length, histIdx + 1); $('gbc-in').value = hist[histIdx] || ''; }
      if (ev.key === 'Tab')       { ev.preventDefault(); complete(); }
    });
  }

  // Completes a command name, or a game id once the verb takes one.
  function complete() {
    const inp = $('gbc-in'), v = inp.value, parts = parse(v);
    const trailing = /\s$/.test(v);
    if (parts.length <= 1 && !trailing) {
      const hits = Object.keys(CMDS).filter(k => k.indexOf((parts[0] || '').toLowerCase()) === 0);
      if (hits.length === 1) inp.value = hits[0] + ' ';
      else if (hits.length > 1) say('   ' + hits.join('   '));
      return;
    }
    const verb = (parts[0] || '').toLowerCase();
    if (verb === 'play' || verb === 'jump' || verb === 'games') {
      const frag = (trailing ? '' : parts[parts.length - 1] || '').toLowerCase();
      const hits = gameList().map(gid).filter(id => id.toLowerCase().indexOf(frag) === 0);
      if (hits.length === 1) inp.value = verb + ' ' + hits[0] + ' ';
      else if (hits.length > 1) say('   ' + hits.slice(0, 14).join('   '));
    }
  }

  function open() {
    build();
    $('gbc-wrap').classList.add('show');
    shown = true;
    $('gbc-who').textContent = (typeof currentUser !== 'undefined' && currentUser)
      ? currentUser.name + ' · ' + currentUser.email + (ownerNow() ? ' · OWNER' : '')
      : 'not signed in';
    if (!OUT.length) {
      head('// GLITCHBOX OWNER CONSOLE');
      say('type  help  for commands. Local commands touch this device only.');
    }
    setTimeout(() => { const i = $('gbc-in'); if (i) i.focus(); }, 20);
  }
  function close() { if (built) { $('gbc-wrap').classList.remove('show'); shown = false; } }
  function toggle() { if (shown) close(); else open(); }

  // The server decides who the owner is; until /api/me says so, the console won't
  // open. A stray backtick still reveals nothing, but the deliberate Ctrl+Shift+K
  // chord says why it refused — a hotkey that does *literally* nothing reads as a
  // bug, and the first person to hit it is the owner wondering what broke.
  setInterval(() => { isOwner = ownerNow(); }, 1500);
  isOwner = ownerNow();

  // Self-contained so the console keeps working if the hub never loads.
  function refused() {
    let t = $('gbc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'gbc-toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:13000;' +
        'max-width:min(460px,92vw);padding:12px 16px;background:#080b14;border:1px solid rgba(255,0,128,.45);' +
        "box-shadow:0 0 26px rgba(255,0,128,.2);font-family:'Rajdhani',sans-serif;font-weight:600;font-size:13px;" +
        'color:#e8eefc;line-height:1.45;transition:opacity .25s;';
      document.body.appendChild(t);
    }
    const signedIn = typeof currentUser !== 'undefined' && !!currentUser;
    t.innerHTML = signedIn
      ? '<b style="color:#ff0080">OWNER CONSOLE LOCKED</b><br>Signed in as ' +
        esc((currentUser.email || currentUser.name)) + ', which the server does not recognise as the owner.'
      : '<b style="color:#ff0080">OWNER CONSOLE LOCKED</b><br>Sign in first — the console follows the account, not the browser.';
    t.style.opacity = '1';
    clearTimeout(window.__gbcToastT);
    window.__gbcToastT = setTimeout(() => { t.style.opacity = '0'; }, 3200);
  }

  // Caller already swallowed the event (Ctrl+Shift+K is Firefox's web console).
  function hotkey() {
    if (!ownerNow() && !shown) { refused(); return; }
    toggle();
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && shown) { close(); return; }
    const typing = e.target && (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable);
    const ours = e.target && e.target.id === 'gbc-in';
    if (e.key === '`' && (!typing || ours)) {
      // Backtick is easy to hit by accident, so a non-owner gets silence, not a hint.
      if (!ownerNow() && !shown) return;
      e.preventDefault(); toggle(); return;
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'K' || e.key === 'k')) { e.preventDefault(); hotkey(); }
  });

  window.glitchCmd = { open, close, toggle, run, CMDS, _parse: parse, _findGame: findGame, _out: OUT };

  // ── self-test (#cmdsmoke) ──────────────────────────────────────────────────
  if (SMOKE) window.addEventListener('load', () => setTimeout(async () => {
    let pass = 0, fail = 0;
    const lines = [];
    const t = (name, cond) => { if (cond) { pass++; lines.push('ok   ' + name); } else { fail++; lines.push('FAIL ' + name); } };
    const last = () => (OUT.length ? OUT[OUT.length - 1].text : '');
    const said = re => OUT.some(l => re.test(l.text));

    // a fake server, so the suite never touches the real one
    const seen = [];
    window.api = async (path, opts) => {
      seen.push({ path, body: opts && opts.body });
      if (path.indexOf('/api/admin/players') === 0) {
        const q = decodeURIComponent(path.split('q=')[1] || '').toLowerCase();
        const all = [
          { sub:'s1', name:'Dave',  email:'dave@x.com',  code:'AAAA', friends:2, saves:1, reports:0, created:Date.now(), last_seen:Date.now() },
          { sub:'s2', name:'Davina',email:'davina@x.com',code:'BBBB', friends:0, saves:0, reports:1, created:Date.now(), last_seen:Date.now(), banned:1, ban_reason:'rude' },
        ];
        return { players: all.filter(p => !q || p.name.toLowerCase().indexOf(q) !== -1 || p.email.toLowerCase().indexOf(q) !== -1 || p.code.toLowerCase() === q) };
      }
      if (path === '/api/admin/overview') return { counts:{ players:2, online:1 }, recent:[], topGames:[] };
      if (path === '/api/admin/reports')  return { reports:[{ id:7, reason:'cheating', created:Date.now(), reporter:'Dave', reported:'Davina', reported_sub:'s2' }] };
      return { ok:true };
    };

    // ── parsing ──
    t('bare words split into arguments', parse('ban dave rude').length === 3);
    t('a quoted reason stays one argument', parse('ban dave "spawn camping"')[2] === 'spawn camping');
    t('extra whitespace collapses', parse('  help   tokens ').length === 2);

    // ── the registry ──
    t('every command has a usage line', Object.keys(CMDS).every(k => CMDS[k].usage));
    t('every command explains itself', Object.keys(CMDS).every(k => CMDS[k].about));
    t('every command is runnable', Object.keys(CMDS).every(k => typeof CMDS[k].run === 'function'));
    t('jump is an alias of play', CMDS.jump === CMDS.play);

    // ── owner gating ──
    lastState.isOwner = false;
    await run('players');
    t('a non-owner is refused a server command', /owner only/.test(last()));
    await run('tokens');
    t('but local commands still work', !/owner only/.test(last()));
    lastState.isOwner = true;
    await run('stats');
    t('the owner gets the server command', said(/ARCADE/));

    // ── unknown input ──
    await run('bnn dave');
    t('an unknown command says so', said(/no command called "bnn"/));
    t('and suggests the near miss', said(/did you mean: ban/));

    // ── tokens ──
    if (hasTokens()) {
      setTokens(100);
      await run('tokens +50');  t('tokens +n adds', tokens() === 150);
      await run('tokens -20');  t('tokens -n subtracts', tokens() === 130);
      await run('tokens 7');    t('a bare number sets', tokens() === 7);
      await run('tokens nope'); t('rubbish is refused', tokens() === 7 && /wants a number/.test(last()));
    }

    // ── unlocks ──
    await run('unlock games');
    const owned = JSON.parse(localStorage.getItem(tokKeys().own) || '[]');
    t('unlock games unlocks every game', owned.length === gameList().length && owned.length > 0);
    await run('lock games');
    t('lock games puts them back', !localStorage.getItem(tokKeys().own));

    // ── game lookup ──
    t('an exact id matches', findGame('gridlock') && findGame('gridlock').file === 'gridlock.html');
    t('a partial id matches', findGame('grid') && findGame('grid').file === 'gridlock.html');
    t('a display name matches', !!findGame('Seven Liars'));
    t('a .html suffix is tolerated', findGame('gridlock.html') && findGame('gridlock.html').file === 'gridlock.html');
    t('nonsense matches nothing', findGame('zzzznope') === null);

    // ── picking a player ──
    await run('who dav');            // matches Dave and Davina, is neither
    t('an ambiguous name refuses to guess', said(/2 players match/));
    await run('who dave@x.com');
    t('an exact email resolves', said(/dave@x\.com/));
    await run('who AAAA');
    t('a friend code resolves', OUT.some(l => /^\/\/ Dave/.test(l.text)));
    await run('who nobodyhere');
    t('an unknown player is reported', said(/no player matches/));

    // ── destructive commands need a confirmation ──
    seen.length = 0;
    await run('delete dave@x.com');
    t('delete asks first', said(/type  confirm/));
    t('and sends nothing yet', !seen.some(s => s.path === '/api/admin/delete'));
    await run('nope');
    t('anything else cancels', said(/cancelled/) && !seen.some(s => s.path === '/api/admin/delete'));
    await run('delete dave@x.com');
    await run('confirm');
    t('confirm goes through', seen.some(s => s.path === '/api/admin/delete' && s.body.sub === 's1'));

    // ── ban carries its reason ──
    seen.length = 0;
    await run('ban dave@x.com "spawn camping"');
    const ban = seen.find(s => s.path === '/api/admin/ban');
    t('ban targets the right account', ban && ban.body.sub === 's1' && ban.body.banned === true);
    t('ban keeps the quoted reason whole', ban && ban.body.reason === 'spawn camping');
    seen.length = 0;
    await run('unban davina@x.com');
    const unban = seen.find(s => s.path === '/api/admin/ban');
    t('unban clears the flag', unban && unban.body.banned === false);

    // ── reports ──
    await run('reports');
    t('reports lists what came back', said(/cheating/));
    seen.length = 0;
    await run('dismiss 7');
    t('dismiss posts the id', seen.some(s => s.path === '/api/admin/dismiss-report' && s.body.id === '7'));

    // ── help ──
    await run('help');
    t('help lists the server commands', said(/SERVER/));
    t('help lists the local commands', said(/THIS DEVICE/));
    await run('help ban');
    t('help explains one command', said(/ban <query>/));

    const out = document.createElement('pre');
    out.id = 'smokeout';
    out.textContent = lines.join('\n') + '\n\nSMOKE ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail);
    document.body.appendChild(out);
    document.title = 'SMOKE ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail);
  }, 600));
})();
