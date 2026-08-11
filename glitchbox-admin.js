/* ==========================================================================
   GLITCHBOX — OWNER CONSOLE
   --------------------------------------------------------------------------
   Admin tools for the one account that owns the arcade. Lives in its own file
   so index.html only needs a single <script> tag, and so the console can be
   dropped or reloaded without touching the hub.

   Opens with Ctrl+Shift+A, or the ⚙ OWNER item that appears in the sidebar once
   the server confirms you're the owner. Server-backed tabs (Players, Reports)
   call /api/admin/*, which re-checks ownership on every request — the button
   showing up is a convenience, never the permission itself. God mode is purely
   local: it rewrites this device's localStorage and nobody else's.
   ========================================================================== */
(function () {
  'use strict';

  const KEYS = { bal:'glitchbox.tokens', own:'glitchbox.owned', icons:'glitchbox.icons',
                 seen:'glitchbox.seen', ts:'glitchbox.playts', daily:'glitchbox.daily',
                 streak:'glitchbox.streak', queue:'glitchbox.queue', fpaid:'glitchbox.fpaid' };
  // The token economy is a separate feature that may not exist in this build; every
  // god-mode action feature-detects instead of assuming.
  function tokKeys() { return (typeof TOK !== 'undefined' && TOK) ? Object.assign({}, KEYS, TOK) : KEYS; }
  function hasTokens() { return typeof tokens === 'function' && typeof setTokens === 'function'; }

  // null means "not fetched yet"; an empty array means "fetched, nothing there".
  let built = false, isOwner = false, tab = 'overview';
  let players = null, reports = null, overview = null, filter = '';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const $ = id => document.getElementById(id);

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

  function ago(ts) {
    if (!ts) return '—';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }
  function avatar(u) {
    if (typeof avatarHTML === 'function') {
      const h = avatarHTML(u, true);
      if (h) return h;
    }
    return esc(((u && u.name) || '?').charAt(0).toUpperCase());
  }

  // ── shell ──────────────────────────────────────────────────────────────────
  function styles() {
    const css = `
    .adm-wrap { position:fixed; inset:0; z-index:12000; display:none; align-items:flex-start;
      justify-content:center; padding:34px 18px; overflow-y:auto; background:rgba(2,4,10,.86); backdrop-filter:blur(7px); }
    .adm-wrap.show { display:flex; }
    .adm-card { position:relative; width:100%; max-width:960px; background:#080b14;
      border:1px solid rgba(255,0,128,.35); box-shadow:0 0 50px rgba(255,0,128,.15),0 0 90px rgba(0,245,255,.06);
      clip-path:polygon(0 0,calc(100% - 22px) 0,100% 22px,100% 100%,22px 100%,0 calc(100% - 22px)); }
    .adm-top { display:flex; align-items:center; gap:14px; padding:16px 22px;
      border-bottom:1px solid rgba(255,0,128,.22); background:linear-gradient(100deg,#1a0016,#06121a); }
    .adm-title { font-family:'Press Start 2P',monospace; font-size:12px; color:#ff0080; text-shadow:0 0 12px rgba(255,0,128,.6); }
    .adm-who { font-size:12px; color:#8b95a8; flex:1; }
    .adm-x { background:transparent; border:1px solid rgba(255,0,128,.4); color:#ff0080; width:30px; height:30px;
      cursor:pointer; font-size:15px; line-height:1; }
    .adm-x:hover { background:rgba(255,0,128,.15); }
    .adm-tabs { display:flex; flex-wrap:wrap; gap:2px; padding:10px 18px 0; border-bottom:1px solid rgba(0,245,255,.12); }
    .adm-tab { background:transparent; border:none; border-bottom:2px solid transparent; color:#8b95a8; cursor:pointer;
      font-family:'Rajdhani',sans-serif; font-weight:700; font-size:13px; letter-spacing:1.2px; text-transform:uppercase;
      padding:9px 14px; }
    .adm-tab:hover { color:#e8eefc; }
    .adm-tab.on { color:#00f5ff; border-bottom-color:#00f5ff; text-shadow:0 0 8px rgba(0,245,255,.5); }
    .adm-body { padding:20px 22px 26px; font-family:'Rajdhani',sans-serif; color:#e8eefc; font-weight:600; }
    .adm-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; }
    .adm-stat { background:#0e1422; border:1px solid rgba(0,245,255,.12); padding:14px 10px; text-align:center; }
    .adm-stat b { display:block; font-family:'Press Start 2P',monospace; font-size:17px; color:#00f5ff; text-shadow:0 0 10px rgba(0,245,255,.4); }
    .adm-stat span { font-size:10px; letter-spacing:1.4px; text-transform:uppercase; color:#8b95a8; }
    .adm-h { font-family:'Press Start 2P',monospace; font-size:9px; letter-spacing:2px; color:#ff0080; margin:22px 0 10px; }
    .adm-h:first-child { margin-top:0; }
    .adm-row { display:flex; align-items:center; gap:11px; padding:9px 11px; background:#0e1422;
      border-left:2px solid rgba(0,245,255,.4); margin-bottom:6px; }
    .adm-row.ban { border-left-color:#ff0080; opacity:.72; }
    .adm-av { width:30px; height:30px; flex-shrink:0; border:1px solid rgba(0,245,255,.4); background:#060911;
      display:flex; align-items:center; justify-content:center; color:#00f5ff; font-weight:800; overflow:hidden; }
    .adm-av img { width:100%; height:100%; object-fit:cover; }
    .adm-name { font-size:14px; font-weight:700; color:#fff; }
    .adm-meta { font-size:11px; color:#8b95a8; }
    .adm-grow { flex:1; min-width:0; overflow:hidden; }
    .adm-tag { font-size:10px; letter-spacing:1px; text-transform:uppercase; padding:2px 7px; background:rgba(255,0,128,.16);
      color:#ff0080; border:1px solid rgba(255,0,128,.3); }
    .adm-btn { border:none; cursor:pointer; padding:6px 11px; font-family:'Rajdhani',sans-serif; font-weight:700;
      font-size:12px; letter-spacing:.6px; text-transform:uppercase; background:#00f5ff; color:#001014; flex-shrink:0; }
    .adm-btn:hover { box-shadow:0 0 12px rgba(0,245,255,.5); }
    .adm-btn.warn { background:transparent; border:1px solid rgba(255,180,0,.5); color:#ffb400; }
    .adm-btn.danger { background:transparent; border:1px solid rgba(255,0,128,.5); color:#ff0080; }
    .adm-btn.danger:hover, .adm-btn.warn:hover { background:rgba(255,255,255,.06); box-shadow:none; }
    .adm-in { background:#0e1422; border:1px solid rgba(0,245,255,.2); color:#e8eefc; padding:9px 12px;
      font-family:'Rajdhani',sans-serif; font-weight:600; font-size:13px; outline:none; width:100%; }
    .adm-in:focus { border-color:#00f5ff; }
    .adm-actions { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
    .adm-note { font-size:12px; color:#8b95a8; margin:10px 0; line-height:1.5; }
    .adm-pre { background:#060911; border:1px solid rgba(0,245,255,.14); padding:12px; font-family:ui-monospace,monospace;
      font-size:11px; color:#7dd3fc; white-space:pre-wrap; word-break:break-all; max-height:260px; overflow:auto; }
    .adm-empty { color:#8b95a8; font-size:13px; padding:16px; text-align:center; }
    .nav-item.adm-nav { color:#ff0080; }
    .nav-item.adm-nav:hover { background:rgba(255,0,128,.08); }
    @media (max-width:620px) { .adm-row { flex-wrap:wrap; } }`;
    const el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
  }

  function build() {
    if (built) return;
    built = true;
    styles();
    const wrap = document.createElement('div');
    wrap.className = 'adm-wrap';
    wrap.id = 'adm-wrap';
    wrap.innerHTML =
      '<div class="adm-card">' +
        '<div class="adm-top"><span class="adm-title">⚙ OWNER CONSOLE</span>' +
        '<span class="adm-who" id="adm-who"></span>' +
        '<button class="adm-x" id="adm-x" title="Close (Esc)">✕</button></div>' +
        '<div class="adm-tabs" id="adm-tabs"></div>' +
        '<div class="adm-body" id="adm-body"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    $('adm-x').addEventListener('click', close);
    $('adm-tabs').addEventListener('click', e => {
      const b = e.target.closest('.adm-tab');
      if (b) { tab = b.dataset.tab; render(); }
    });
    $('adm-body').addEventListener('click', onAction);
  }

  const TABS = [
    { id:'overview', label:'Overview' },
    { id:'players',  label:'Players' },
    { id:'reports',  label:'Reports' },
    { id:'god',      label:'God Mode' },
    { id:'dev',      label:'Dev' },
  ];

  function render() {
    const who = (typeof currentUser !== 'undefined' && currentUser)
      ? currentUser.name + ' · ' + currentUser.email : 'not signed in';
    $('adm-who').textContent = who + (isOwner ? ' · OWNER' : '');
    $('adm-tabs').innerHTML = TABS.map(t =>
      '<button class="adm-tab' + (tab === t.id ? ' on' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>').join('');
    const body = $('adm-body');
    if (tab === 'overview') body.innerHTML = viewOverview();
    else if (tab === 'players') { body.innerHTML = viewPlayers(); const s = $('adm-search'); if (s) { s.value = filter; s.focus(); } }
    else if (tab === 'reports') body.innerHTML = viewReports();
    else if (tab === 'god') body.innerHTML = viewGod();
    else body.innerHTML = viewDev();
  }

  // ── tabs ───────────────────────────────────────────────────────────────────
  function viewOverview() {
    if (!isOwner) return claimPanel();
    if (!overview) { loadOverview(); return '<div class="adm-empty">Loading…</div>'; }
    const c = overview.counts;
    const stat = (k, label) => '<div class="adm-stat"><b>' + c[k] + '</b><span>' + label + '</span></div>';
    return '<div class="adm-grid">' +
        stat('players','Players') + stat('online','Online now') + stat('newToday','New today') +
        stat('friendships','Friendships') + stat('invites','Live invites') + stat('saves','Cloud saves') +
        stat('reports','Reports') + stat('banned','Banned') +
      '</div>' +
      '<div class="adm-h">// NEWEST PLAYERS</div>' +
      (overview.recent.length ? overview.recent.map(u =>
        '<div class="adm-row"><div class="adm-grow"><div class="adm-name">' + esc(u.name) + '</div>' +
        '<div class="adm-meta">joined ' + ago(u.created) + '</div></div></div>').join('')
        : '<div class="adm-empty">Nobody yet.</div>') +
      '<div class="adm-h">// CLOUD SAVES BY GAME</div>' +
      (overview.topGames.length ? overview.topGames.map(g =>
        '<div class="adm-row"><div class="adm-grow"><div class="adm-name">' + esc(g.game) + '</div></div>' +
        '<span class="adm-meta">' + g.players + ' player' + (g.players === 1 ? '' : 's') + '</span></div>').join('')
        : '<div class="adm-empty">No cloud saves yet.</div>') +
      '<div class="adm-actions" style="margin-top:18px"><button class="adm-btn" data-act="reload">↻ Refresh</button></div>';
  }

  function viewPlayers() {
    if (!isOwner) return claimPanel();
    const head = '<div class="adm-actions">' +
      '<input class="adm-in" id="adm-search" data-act="search" placeholder="Search name, email or friend code…" style="flex:1;min-width:200px">' +
      '<button class="adm-btn" data-act="reload">↻</button></div>';
    if (players === null) { loadPlayers(); return head + '<div class="adm-empty">Loading…</div>'; }
    if (!players.length) return head + '<div class="adm-empty">No players match.</div>';
    const me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.sub : '';
    return head + players.map(p => {
      const self = p.sub === me;
      return '<div class="adm-row' + (p.banned ? ' ban' : '') + '">' +
        '<div class="adm-av">' + avatar(p) + '</div>' +
        '<div class="adm-grow"><div class="adm-name">' + esc(p.name) +
          (self ? ' <span class="adm-tag" style="background:rgba(0,245,255,.14);color:#00f5ff;border-color:rgba(0,245,255,.3)">you</span>' : '') +
          (p.banned ? ' <span class="adm-tag">banned</span>' : '') + '</div>' +
        '<div class="adm-meta">' + esc(p.email) + ' · code ' + esc(p.code || '—') + '</div>' +
        '<div class="adm-meta">' + p.friends + ' friends · ' + p.saves + ' saves · ' + p.reports +
          ' reports · seen ' + ago(p.last_seen) + (p.ban_reason ? ' · “' + esc(p.ban_reason) + '”' : '') + '</div></div>' +
        (self ? '' :
          '<button class="adm-btn ' + (p.banned ? 'warn' : 'danger') + '" data-act="' + (p.banned ? 'unban' : 'ban') +
            '" data-sub="' + esc(p.sub) + '">' + (p.banned ? 'Unban' : 'Ban') + '</button>' +
          '<button class="adm-btn danger" data-act="del" data-sub="' + esc(p.sub) + '">Delete</button>') +
        '</div>';
    }).join('');
  }

  function viewReports() {
    if (!isOwner) return claimPanel();
    if (reports === null) { loadReports(); return '<div class="adm-empty">Loading…</div>'; }
    if (!reports.length) return '<div class="adm-empty">No reports. Quiet arcade.</div>';
    return reports.map(r =>
      '<div class="adm-row">' +
        '<div class="adm-grow"><div class="adm-name">' + esc(r.reported || '(deleted)') +
          (r.banned ? ' <span class="adm-tag">banned</span>' : '') + '</div>' +
        '<div class="adm-meta">reported by ' + esc(r.reporter || '(deleted)') + ' · ' + ago(r.created) + '</div>' +
        '<div class="adm-meta">' + (r.reason ? '“' + esc(r.reason) + '”' : 'no reason given') + '</div></div>' +
        (r.reported_sub && !r.banned
          ? '<button class="adm-btn danger" data-act="ban" data-sub="' + esc(r.reported_sub) + '">Ban</button>' : '') +
        '<button class="adm-btn warn" data-act="dismiss" data-id="' + r.id + '">Dismiss</button>' +
      '</div>').join('');
  }

  function viewGod() {
    const on = hasTokens();
    const icons = (typeof ICON_BY_ID !== 'undefined') ? Object.keys(ICON_BY_ID).length : 0;
    return '<div class="adm-note">God mode rewrites <b>this device only</b> — it never touches the server or ' +
        'anyone else\'s progress.</div>' +
      (on
        ? '<div class="adm-h">// WALLET</div>' +
          '<div class="adm-actions">' +
            '<button class="adm-btn" data-act="tok" data-n="100">+100 tokens</button>' +
            '<button class="adm-btn" data-act="tok" data-n="1000">+1000 tokens</button>' +
            '<button class="adm-btn warn" data-act="tokset">Set exact…</button>' +
            '<button class="adm-btn danger" data-act="tokzero">Zero it</button>' +
          '</div><div class="adm-note">Balance now: <b>' + tokens() + '</b></div>'
        : '<div class="adm-note">This build has no token economy — games and icons are already unlocked for everyone.</div>') +
      '<div class="adm-h">// UNLOCKS</div>' +
      '<div class="adm-actions">' +
        '<button class="adm-btn" data-act="unlockgames">Unlock every game</button>' +
        '<button class="adm-btn" data-act="unlockicons">Unlock all ' + icons + ' icons</button>' +
        '<button class="adm-btn danger" data-act="wipeecon">Reset economy</button>' +
      '</div>' +
      '<div class="adm-note">Reset clears tokens, unlocks, daily streak and play history on this device.</div>';
  }

  function viewDev() {
    const list = (typeof GAMES !== 'undefined' ? GAMES : []);
    let sess = '(none)';
    try {
      const t = localStorage.getItem('glitchbox_session') || '';
      sess = t ? JSON.stringify(JSON.parse(atob(t.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')))) : '(none)';
    } catch (e) { sess = '(unreadable)'; }
    return '<div class="adm-h">// JUMP TO GAME</div>' +
      '<div class="adm-actions"><select class="adm-in" id="adm-jump" style="flex:1;min-width:200px">' +
        list.map(g => '<option value="' + esc(g.file) + '">' + esc(g.name || g.file) + '</option>').join('') +
      '</select><button class="adm-btn" data-act="jump">Launch</button></div>' +
      '<div class="adm-h">// STATE</div>' +
      '<div class="adm-actions">' +
        '<button class="adm-btn" data-act="refresh">Force refresh</button>' +
        '<button class="adm-btn warn" data-act="copyme">Copy /api/me JSON</button>' +
        '<button class="adm-btn danger" data-act="nuke">Clear this device</button>' +
      '</div>' +
      '<div class="adm-note">Session payload (signature withheld): <code>' + esc(sess) + '</code></div>' +
      '<div class="adm-pre">' + esc(JSON.stringify(typeof lastState !== 'undefined' ? lastState : {}, null, 2)) + '</div>';
  }

  function claimPanel() {
    if (typeof currentUser === 'undefined' || !currentUser)
      return '<div class="adm-empty">Sign in first — the console follows the account, not the browser.</div>';
    return '<div class="adm-h">// CLAIM OWNERSHIP</div>' +
      '<div class="adm-note">This account isn\'t the owner yet. Enter the claim code (a Worker secret) once and ' +
        'this account becomes the permanent owner — the claim can\'t be repeated afterwards.</div>' +
      '<div class="adm-actions"><input class="adm-in" id="adm-code" placeholder="CLAIM CODE" style="flex:1;min-width:180px">' +
      '<button class="adm-btn" data-act="claim">Claim</button></div>' +
      '<div class="adm-note" id="adm-claim-msg"></div>';
  }

  // ── data ───────────────────────────────────────────────────────────────────
  function fail(e) {
    const b = $('adm-body');
    if (b) b.innerHTML = '<div class="adm-empty">' + esc(e.message || 'request failed') + '</div>';
  }
  async function loadOverview() { try { overview = await call('/api/admin/overview'); render(); } catch (e) { fail(e); } }
  async function loadPlayers() {
    try { players = (await call('/api/admin/players?q=' + encodeURIComponent(filter))).players || []; render(); }
    catch (e) { fail(e); }
  }
  async function loadReports() {
    try { reports = (await call('/api/admin/reports')).reports || []; render(); }
    catch (e) { fail(e); }
  }

  // ── actions ────────────────────────────────────────────────────────────────
  async function onAction(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, sub = el.dataset.sub;
    const K = tokKeys();
    const repaint = () => {
      if (typeof paintTokens === 'function') paintTokens();
      if (typeof renderGames === 'function') renderGames();
      if (typeof renderIconPicker === 'function') renderIconPicker();
      render();
    };
    try {
      if (act === 'reload') { overview = null; players = null; reports = null; render(); }
      else if (act === 'claim') {
        const code = ($('adm-code').value || '').trim();
        try {
          await call('/api/admin/claim', { method:'POST', body:{ code } });
          isOwner = true; overview = null; players = null; reports = null;
          navItem(); render();
        } catch (err) { $('adm-claim-msg').textContent = err.message; }
      }
      else if (act === 'ban') {
        const p = players.find(x => x.sub === sub);
        const reason = prompt('Ban ' + ((p && p.name) || 'this player') + ' — reason (optional):');
        if (reason === null) return;
        await call('/api/admin/ban', { method:'POST', body:{ sub, banned:true, reason } });
        players = null; reports = null; render();
      }
      else if (act === 'unban') {
        await call('/api/admin/ban', { method:'POST', body:{ sub, banned:false } });
        players = null; render();
      }
      else if (act === 'del') {
        const p = players.find(x => x.sub === sub);
        const name = (p && p.name) || 'this player';
        if (!confirm('Delete ' + name + ' permanently?\n\nTheir account, friendships, invites and cloud saves are ' +
                     'erased. This cannot be undone.')) return;
        await call('/api/admin/delete', { method:'POST', body:{ sub } });
        players = null; overview = null; render();
      }
      else if (act === 'dismiss') {
        await call('/api/admin/dismiss-report', { method:'POST', body:{ id: el.dataset.id } });
        reports = null; render();
      }
      else if (act === 'tok')     { setTokens(tokens() + (+el.dataset.n || 0)); repaint(); }
      else if (act === 'tokset')  { const n = prompt('Set token balance to:', tokens()); if (n !== null) { setTokens(parseInt(n, 10) || 0); repaint(); } }
      else if (act === 'tokzero') { setTokens(0); repaint(); }
      else if (act === 'unlockgames') {
        const files = (typeof GAMES !== 'undefined' ? GAMES : []).map(g => g.file);
        localStorage.setItem(K.own, JSON.stringify(files));
        repaint();
      }
      else if (act === 'unlockicons') {
        const ids = (typeof ICON_BY_ID !== 'undefined') ? Object.keys(ICON_BY_ID) : [];
        localStorage.setItem(K.icons, JSON.stringify(ids));
        repaint();
      }
      else if (act === 'wipeecon') {
        if (!confirm('Reset tokens, unlocks and play history on this device?')) return;
        Object.keys(K).forEach(k => localStorage.removeItem(K[k]));
        repaint();
      }
      else if (act === 'jump')    { const s = $('adm-jump'); if (s && s.value) location.href = s.value; }
      else if (act === 'refresh') { if (typeof refreshState === 'function') await refreshState(); render(); }
      else if (act === 'copyme')  {
        const txt = JSON.stringify(typeof lastState !== 'undefined' ? lastState : {}, null, 2);
        try { await navigator.clipboard.writeText(txt); el.textContent = 'Copied ✓'; }
        catch (err) { el.textContent = 'Clipboard blocked'; }
      }
      else if (act === 'nuke') {
        if (!confirm('Clear ALL GLITCHBOX data on this device (including your sign-in)?')) return;
        Object.keys(localStorage).filter(k => k.indexOf('glitchbox') === 0).forEach(k => localStorage.removeItem(k));
        location.reload();
      }
    } catch (err) { alert(err.message); }
  }

  // Search is debounced through the same delegated listener the buttons use.
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'adm-search') {
      filter = e.target.value;
      clearTimeout(window.__admT);
      window.__admT = setTimeout(() => { players = null; loadPlayers(); }, 260);
    }
  });

  // ── open / close ───────────────────────────────────────────────────────────
  function open() { build(); $('adm-wrap').classList.add('show'); render(); }
  function close() { if (built) $('adm-wrap').classList.remove('show'); }
  function toggle() {
    build();
    if ($('adm-wrap').classList.contains('show')) close(); else open();
  }

  function navItem() {
    if (!isOwner || $('adm-nav-item')) return;
    const anchor = document.getElementById('sidebar-user');
    if (!anchor || !anchor.parentNode) return;
    const a = document.createElement('a');
    a.id = 'adm-nav-item';
    a.className = 'nav-item adm-nav';
    a.href = '#';
    a.innerHTML = '<span class="nav-icon">⚙</span> Owner Console';
    a.addEventListener('click', ev => { ev.preventDefault(); open(); });
    anchor.parentNode.insertBefore(a, anchor);
  }

  // The server decides who the owner is; /api/me carries the verdict, so the console
  // link appears on its own once you're signed in as that account.
  setInterval(() => {
    const owner = (typeof lastState !== 'undefined' && lastState && !!lastState.isOwner);
    if (owner !== isOwner) {
      isOwner = owner;
      navItem();
      if (built && $('adm-wrap').classList.contains('show')) render();
    }
  }, 1500);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && built && $('adm-wrap').classList.contains('show')) { close(); return; }
    // Ctrl+Shift+A only — Cmd+Shift+A is Chrome's own tab search on a Mac.
    if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) { e.preventDefault(); toggle(); }
  });

  window.glitchAdmin = { open, close, toggle };
})();
