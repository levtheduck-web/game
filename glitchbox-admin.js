/* ==========================================================================
   GLITCHBOX - OWNER CONSOLE
   --------------------------------------------------------------------------
   Admin tools for the one account that owns the arcade. Lives in its own file
   so index.html only needs a single <script> tag, and so the console can be
   dropped or reloaded without touching the hub.

   Opens with Ctrl+Shift+A, or the ⚙ OWNER item that appears in the sidebar once
   the server confirms you're the owner. Server-backed tabs (Players, Reports)
   call /api/admin/*, which re-checks ownership on every request - the button
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
  // isMod: a moderator - the people tools only, with limits the server enforces anyway.
  let built = false, isOwner = false, isMod = false, tab = 'overview';
  let appeals = null, stats = null;
  let players = null, reports = null, overview = null, filter = '', logRows = null, guests = null;
  let giftTo = null;   // { sub, name } while the gift form is open; sub '*' = everyone
  // Questions are asked in the panel, never with prompt()/confirm(): Chrome can
  // suppress those, and a suppressed prompt reads as "cancel" - a ban that silently
  // never happens. `ask` is { text, yes, input?, run(value) }; `notice` shows the
  // last result or error at the top of the panel.
  let ask = null, notice = null, gameFilter = '';
  // The 👁 View panel: { target:'u:<sub>'|'g:<gid>', name } while open; `watch` is its data.
  let viewing = null, watch = null;
  // Moderators' ban requests (loaded with the Reports tab). The owner approves or denies them.
  let banReqs = [];

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

  function gameName(file) {
    const g = (typeof GAMES !== 'undefined' ? GAMES : []).find(x => x.file === file);
    return g ? (g.emoji ? g.emoji + ' ' : '') + g.name : String(file || '').replace(/\.html$/, '');
  }
  function when(ts) { return new Date(ts).toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }
  function ago(ts) {
    if (!ts) return '-';
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
    .adm-av[data-act] { cursor:pointer; }
    .adm-av[data-act]:hover { border-color:#00f5ff; box-shadow:0 0 10px rgba(0,245,255,.5); }
    .adm-btn.view { background:#ff0080; color:#fff; }
    .adm-btn.view:hover { box-shadow:0 0 12px rgba(255,0,128,.6); }
    .adm-now { display:flex; align-items:center; gap:16px; padding:16px 18px; background:#0e1422; border:1px solid rgba(0,255,136,.35); margin-bottom:14px; }
    .adm-now.off { border-color:rgba(139,149,168,.3); }
    .adm-now .big { font-size:34px; line-height:1; }
    .adm-now b { display:block; font-size:19px; color:#fff; }
    .adm-tl { display:grid; grid-template-columns:auto auto 1fr; gap:6px 14px; align-items:center; font-size:13px; }
    .adm-tl .t { color:#8b95a8; white-space:nowrap; }
    .adm-tl .d { color:#8b95a8; font-size:11px; white-space:nowrap; }
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
      if (b) { tab = b.dataset.tab; ask = null; notice = null; viewing = null; watch = null; render(); }
    });
    $('adm-body').addEventListener('click', onAction);
  }

  const TABS = [
    { id:'overview', label:'Overview' },
    { id:'players',  label:'Players' },
    { id:'guests',   label:'Guests' },
    { id:'reports',  label:'Reports' },
    { id:'appeals',  label:'Appeals' },
    { id:'stats',    label:'Stats', owner:true },
    { id:'arcade',   label:'Arcade', owner:true },
    { id:'log',      label:'Log' },
    { id:'god',      label:'God Mode', owner:true },
    { id:'dev',      label:'Dev', owner:true },
  ];
  const staff = () => isOwner || isMod;
  const tabsNow = () => TABS.filter(t => isOwner || !t.owner);

  function render() {
    const who = (typeof currentUser !== 'undefined' && currentUser)
      ? currentUser.name + ' · ' + currentUser.email : 'not signed in';
    $('adm-who').textContent = who + (isOwner ? ' · OWNER' : isMod ? ' · MODERATOR' : '');
    if (!tabsNow().some(t => t.id === tab)) tab = 'overview';
    $('adm-tabs').innerHTML = tabsNow().map(t =>
      '<button class="adm-tab' + (tab === t.id ? ' on' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>').join('');
    const body = $('adm-body');
    const view = viewing ? viewWatch() : tab === 'overview' ? viewOverview() : tab === 'players' ? viewPlayers() : tab === 'guests' ? viewGuests()
      : tab === 'reports' ? viewReports() : tab === 'appeals' ? viewAppeals() : tab === 'stats' ? viewStats()
      : tab === 'arcade' ? viewArcade() : tab === 'log' ? viewLog()
      : tab === 'god' ? viewGod() : viewDev();
    body.innerHTML = askBar() + view;
    const s = $('adm-search');
    if (s) s.value = filter;
    if (ask) {
      $('adm-ask').scrollIntoView({ block:'nearest' });
      const i = $('adm-ask-in');
      if (i) i.focus();
    } else if (s) s.focus();
  }

  function askBar() {
    let h = '';
    if (notice) h += '<div class="adm-note" id="adm-notice" style="color:' + (notice.bad ? '#ff0080' : '#00ff88') +
      ';border:1px solid currentColor;padding:9px 12px">' + esc(notice.text) + '</div>';
    if (ask) h += '<div id="adm-ask" style="border:1px solid rgba(255,0,128,.5);background:rgba(255,0,128,.07);padding:12px;margin-bottom:14px">' +
      '<div class="adm-name" style="margin-bottom:8px;white-space:pre-line">' + esc(ask.text) + '</div>' +
      '<div class="adm-actions" style="margin:0">' +
        (ask.input != null ? '<input class="adm-in" id="adm-ask-in" placeholder="' + esc(ask.input) + '" value="' +
          esc(ask.value || '') + '" style="flex:1;min-width:180px">' : '') +
        (ask.choices ? '<select class="adm-in" id="adm-ask-sel" style="width:auto">' + ask.choices.map(c =>
          '<option value="' + esc(c[0]) + '">' + esc(c[1]) + '</option>').join('') + '</select>' : '') +
        '<button class="adm-btn danger" data-act="askyes">' + esc(ask.yes) + '</button>' +
        '<button class="adm-btn warn" data-act="askno">Cancel</button></div></div>';
    return h;
  }
  function askFor(a) { ask = a; notice = null; render(); }

  // ── tabs ───────────────────────────────────────────────────────────────────
  function viewOverview() {
    if (!staff()) return claimPanel();
    if (!overview) { loadOverview(); return '<div class="adm-empty">Loading…</div>'; }
    const c = overview.counts;
    const stat = (k, label) => '<div class="adm-stat"><b>' + c[k] + '</b><span>' + label + '</span></div>';
    const live = overview.live || [], liveG = overview.liveGuests || [];
    const status = (isMod ? '<div class="adm-note">You\'re a <b>moderator</b>: you can view, message and kick players and guests, turn down appeals, ' +
        'and ask the owner to ban someone. A ban only happens once the owner approves it. ' +
        'Real names, emails, networks and devices stay hidden from you.</div>' : '') + (overview.maintenance ? '<div class="adm-note" style="color:#ffc800;border:1px solid currentColor;padding:9px 12px">' +
        '🛠 Maintenance mode is ON - the arcade is closed to everyone but you. <a href="#" data-act="goarcade" style="color:inherit">Arcade tab →</a></div>' : '') +
      (overview.announce ? '<div class="adm-note" style="color:#00f5ff;border:1px solid currentColor;padding:9px 12px">📣 Live announcement: “' +
        esc(overview.announce.text) + '”</div>' : '');
    return status + '<div class="adm-grid">' +
        stat('players','Players') + stat('online','Online now') + stat('newToday','New today') +
        stat('friendships','Friendships') + stat('invites','Live invites') + stat('saves','Cloud saves') +
        stat('reports','Reports') + stat('banned','Banned') +
        stat('guestsOnline','Guests online') + stat('guestsToday','Guests today') +
        stat('appeals','Open appeals') + stat('mods','Moderators') +
      '</div>' +
      '<div class="adm-actions" style="margin-top:12px">' +
        (c.appeals ? '<button class="adm-btn warn" data-act="goappeals">⚖ ' + c.appeals + ' appeal' + (c.appeals > 1 ? 's' : '') + ' waiting</button>' : '') +
        (isOwner && c.banRequests ? '<button class="adm-btn warn" data-act="goreports">⛔ ' + c.banRequests + ' ban request' + (c.banRequests > 1 ? 's' : '') + ' from moderators</button>' : '') +
        ('Notification' in window && Notification.permission !== 'granted'
          ? '<button class="adm-btn" data-act="alerts">🔔 Turn on desktop alerts</button>'
          : '<span class="adm-meta" style="align-self:center">🔔 New reports and appeals pop up as alerts' + ('Notification' in window ? ', even when this tab is in the background' : '') + '.</span>') +
      '</div>' +
      '<div class="adm-h">// LIVE NOW · ' + (live.length + liveG.length) + '</div>' +
      (isOwner && live.length + liveG.length ? '<div class="adm-actions"><button class="adm-btn warn" data-act="popall">✉ Message everyone online</button>' +
        '<button class="adm-btn" data-act="energyall">⚡ Energy to everyone</button>' +
        '<button class="adm-btn danger" data-act="kickall">👢 Kick everyone</button></div>' : '') +
      (live.length ? live.map(u =>
        '<div class="adm-row"><div class="adm-av" data-act="view" data-target="u:' + esc(u.sub) + '" data-name="' + esc(u.name) + '">' + avatar(u) + '</div><div class="adm-grow"><div class="adm-name">' + esc(u.name) +
        ' <span style="color:#00ff88">●</span></div><div class="adm-meta">' +
        (u.playing ? '▶ playing ' + esc(gameName(u.playing)) : 'in the hub') + ' · ' + ago(u.last_seen) + '</div></div>' +
        viewBtn('u:' + u.sub, u.name) +
        '<button class="adm-btn warn" data-act="msg" data-sub="' + esc(u.sub) + '" data-name="' + esc(u.name) + '">✉ Message</button>' +
        energyBtn('u:' + u.sub, u.name) +
        (u.sub === myId() ? '' : kickBtn('u:' + u.sub, u.name)) + '</div>').join('') +
        liveG.map(g =>
        '<div class="adm-row" style="border-left-color:rgba(255,180,0,.5)"><div class="adm-av" data-act="view" data-target="g:' + esc(g.gid) + '" data-name="' + esc(g.name) + '">👤</div><div class="adm-grow"><div class="adm-name">' + esc(g.name) +
        ' <span class="adm-tag" style="background:rgba(255,180,0,.12);color:#ffb400;border-color:rgba(255,180,0,.3)">guest</span> <span style="color:#00ff88">●</span></div><div class="adm-meta">' +
        (g.playing ? '▶ playing ' + esc(gameName(g.playing)) : 'in the hub') + ' · ' + ago(g.last_seen) + '</div></div>' +
        viewBtn('g:' + g.gid, g.name) +
        '<button class="adm-btn warn" data-act="pop" data-target="g:' + esc(g.gid) + '" data-name="' + esc(g.name) + '">✉ Message</button>' +
        energyBtn('g:' + g.gid, g.name) +
        kickBtn('g:' + g.gid, g.name) + '</div>').join('')
        : '<div class="adm-empty">Nobody online right now.</div>') +
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
    if (!staff()) return claimPanel();
    if (giftTo) return viewGift();
    const head = '<div class="adm-actions">' +
      '<input class="adm-in" id="adm-search" data-act="search" placeholder="Search name, email or friend code…" style="flex:1;min-width:200px">' +
      '<button class="adm-btn" data-act="reload">↻</button>' +
        (isOwner ? '<button class="adm-btn warn" data-act="give" data-sub="*">🎁 Give everyone</button>' +
          '<button class="adm-btn" data-act="energyall">⚡ Energy to everyone</button>' : '') + '</div>';
    if (players === null) { loadPlayers(); return head + '<div class="adm-empty">Loading…</div>'; }
    if (!players.length) return head + '<div class="adm-empty">No players match.</div>';
    const me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.sub : '';
    return head + players.map(p => {
      const self = p.sub === me;
      return '<div class="adm-row' + (p.banned ? ' ban' : '') + '">' +
        '<div class="adm-av" data-act="view" data-target="u:' + esc(p.sub) + '" data-name="' + esc(p.name) + '" title="View what ' + esc(p.name) + ' is doing">' + avatar(p) + '</div>' +
        '<div class="adm-grow"><div class="adm-name">' + esc(p.name) +
          (self ? ' <span class="adm-tag" style="background:rgba(0,245,255,.14);color:#00f5ff;border-color:rgba(0,245,255,.3)">you</span>' : '') +
          (p.banned ? ' <span class="adm-tag">' + (p.ban_until ? 'banned until ' + when(p.ban_until) : 'banned') + '</span>' : '') +
          (p.role === 'mod' ? ' <span class="adm-tag" style="background:rgba(255,230,0,.12);color:#ffe600;border-color:rgba(255,230,0,.35)">⭐ mod</span>' : '') +
          (p.isOwner ? ' <span class="adm-tag" style="background:rgba(0,245,255,.14);color:#00f5ff;border-color:rgba(0,245,255,.3)">owner</span>' : '') +
          (p.playing != null ? ' <span style="color:#00ff88" title="online">●</span> <span class="adm-meta">' +
            (p.playing ? '▶ ' + esc(gameName(p.playing)) : 'in the hub') + '</span>' : '') + '</div>' +
        '<div class="adm-meta">' + (p.real_name ? '👤 ' + esc(p.real_name) + ' · ' : '') + (p.email ? esc(p.email) + ' · ' : '') + 'code ' + esc(p.code || '-') +
          (p.tag_set ? '' : ' · <span style="color:#ffb400">🏷️ hasn\'t picked a nametag</span>') + '</div>' +
        '<div class="adm-meta">' + (p.friends != null ? p.friends + ' friends · ' + p.saves + ' saves · ' : '') + (p.reports || 0) +
          ' reports · seen ' + ago(p.last_seen) + (p.gifts ? ' · ' + p.gifts + ' gift' + (p.gifts > 1 ? 's' : '') + ' waiting' : '') +
          (p.ban_reason ? ' · “' + esc(p.ban_reason) + '”' : '') + '</div>' +
        (isOwner ? '<div class="adm-meta">' + (p.tos_at ? '📜 agreed to the terms (' + esc(p.tos_version) + ') ' + ago(p.tos_at)
          : '<span style="color:#ffb400">📜 hasn\'t agreed to the terms yet</span>') + '</div>' : '') + '</div>' +
        viewBtn('u:' + p.sub, p.name) +
        (isOwner ? '<button class="adm-btn" data-act="give" data-sub="' + esc(p.sub) + '">🎁 Give</button>' : '') +
        (p.banned ? '' : energyBtn('u:' + p.sub, p.name)) +
        (self ? '' : msgBtn(p.sub, p.name, '✉')) +
        (self || (!isOwner && (p.role === 'mod' || p.isOwner)) ? '' : '<button class="adm-btn warn" data-act="resettag" data-sub="' + esc(p.sub) + '" data-name="' + esc(p.name) + '" title="Give them a random nametag and make them pick a new one">🏷️ Reset tag</button>') +
        (self || p.playing == null || (!isOwner && (p.role === 'mod' || p.isOwner)) ? '' : kickBtn('u:' + p.sub, p.name)) +
        (self || (!isOwner && (p.role === 'mod' || p.isOwner)) ? '' : banBtn(p.sub, p.name, p.banned) +
          (isOwner ? '<button class="adm-btn warn" data-act="setmod" data-sub="' + esc(p.sub) + '" data-name="' + esc(p.name) + '" data-on="' + (p.role === 'mod' ? 0 : 1) + '">' +
            (p.role === 'mod' ? 'Remove mod' : '⭐ Make mod') + '</button>' +
            '<button class="adm-btn danger" data-act="del" data-sub="' + esc(p.sub) + '">Delete</button>' : '')) +
        '</div>';
    }).join('');
  }

  // Gifts are queued on the server and banked by the player's hub on its next
  // poll - the wallet itself only exists in their browser.
  function viewGift() {
    const all = giftTo.sub === '*';
    const paid = (typeof GAMES !== 'undefined' ? GAMES : []).filter(g => g.price);
    const sets = (typeof ICON_SETS !== 'undefined' && typeof ICON_PRICE !== 'undefined')
      ? ICON_SETS.filter(s => ICON_PRICE[s.cat]) : [];
    const box = (name, val, label) =>
      '<label class="adm-meta" style="display:inline-flex;gap:6px;align-items:center;margin:0 14px 8px 0;cursor:pointer">' +
      '<input type="checkbox" name="' + name + '" value="' + esc(val) + '">' + label + '</label>';
    return '<div class="adm-h">// GIFT → ' + esc(all ? 'EVERY PLAYER' : giftTo.name) + '</div>' +
      '<div class="adm-note">Tokens (negative takes them away):</div>' +
      '<div class="adm-actions"><input class="adm-in" id="adm-gtok" type="number" placeholder="0" style="max-width:160px">' +
        [100, 500, 1000, 10000].map(n => '<button class="adm-btn warn" data-act="gtok" data-n="' + n + '">' + n + '</button>').join('') +
      '</div>' +
      '<div class="adm-note">⚡ Idle Universe energy' + (all ? ' (goes to guests too)' : '') + ' - 5000, 2.5m, 1b, 3t, 1e15…:</div>' +
      '<div class="adm-actions"><input class="adm-in" id="adm-genergy" placeholder="0" style="max-width:160px">' +
        ['1m', '1b', '1t', '1e15'].map(n => '<button class="adm-btn" data-act="genergy" data-n="' + n + '">' + n + '</button>').join('') +
      '</div>' +
      (paid.length ? '<div class="adm-note">Unlock games:</div><div id="adm-ggames">' +
        paid.map(g => box('g', g.file, esc(g.name) + ' <span style="opacity:.6">(' + g.price + ')</span>')).join('') + '</div>' : '') +
      (sets.length ? '<div class="adm-note">Unlock icon sets:</div><div id="adm-gicons">' +
        sets.map(s => box('i', s.cat, esc(s.cat) + ' <span style="opacity:.6">(' + s.icons.length + ')</span>')).join('') + '</div>' : '') +
      '<div class="adm-note">Message they\'ll see (optional):</div>' +
      '<div class="adm-actions"><input class="adm-in" id="adm-gnote" maxlength="120" placeholder="e.g. thanks for the bug report"></div>' +
      '<div class="adm-actions"><button class="adm-btn" data-act="giftsend">Send gift</button>' +
        '<button class="adm-btn danger" data-act="giftcancel">Cancel</button></div>' +
      '<div class="adm-note" id="adm-gmsg">' + (all ? 'Goes to every player who isn\'t banned. ' : '') +
        'It lands the next time their hub checks in (within about 20 seconds if they\'re online).</div>';
  }

  const DURATIONS = [['0','until I take it down'],['1','for 1 hour'],['6','for 6 hours'],['24','for 1 day'],['72','for 3 days'],['168','for 1 week']];
  function viewArcade() {
    if (!isOwner) return claimPanel();
    const feat = overview && overview.featured;
    if (!overview) { loadOverview(); return '<div class="adm-empty">Loading…</div>'; }
    const a = overview.announce, m = overview.maintenance, offList = overview.disabled || [];
    const sel = (id, opts) => '<select class="adm-in" id="' + id + '" style="width:auto">' +
      opts.map(o => '<option value="' + o[0] + '">' + esc(o[1]) + '</option>').join('') + '</select>';
    return '<div class="adm-h">// ANNOUNCEMENT</div>' +
      '<div class="adm-note">A banner across the top of every player\'s hub (guests too). Players can hide it; a new one shows again.</div>' +
      (a ? '<div class="adm-row"><div class="adm-grow"><div class="adm-name">“' + esc(a.text) + '”</div><div class="adm-meta">' +
          esc(a.tone) + ' · ' + (a.until ? 'ends ' + when(a.until) : 'until you take it down') + '</div></div>' +
          '<button class="adm-btn danger" data-act="annoff">Take down</button></div>' : '<div class="adm-empty">No announcement up.</div>') +
      '<div class="adm-actions"><input class="adm-in" id="adm-an-text" maxlength="240" placeholder="e.g. Double tokens this weekend!" style="flex:1;min-width:220px"></div>' +
      '<div class="adm-actions">' + sel('adm-an-tone', [['info','📣 Info'],['party','🎉 Party'],['warn','⚠️ Warning']]) +
        sel('adm-an-hours', DURATIONS) + '<button class="adm-btn" data-act="announce">' + (a ? 'Replace' : 'Post') + '</button></div>' +
      '<div class="adm-h">// MAINTENANCE MODE</div>' +
      '<div class="adm-note">Closes the arcade: the hub shows a closed sign and open games send players back to it within a few ' +
        'seconds. You still get in. ' + (m ? '<b style="color:#ffc800">ON since ' + when(m.since) + '.</b>' : 'Currently <b>off</b>.') + '</div>' +
      (m ? '<div class="adm-actions"><button class="adm-btn" data-act="mainoff">Reopen the arcade</button></div>'
         : '<div class="adm-actions"><input class="adm-in" id="adm-mt-text" maxlength="240" placeholder="Message on the closed sign (optional)" style="flex:1;min-width:220px">' +
           '<button class="adm-btn danger" data-act="mainon">Close the arcade</button></div>') +
      '<div class="adm-h">// FEATURED GAME</div>' +
      '<div class="adm-note">The big banner at the top of the arcade. Now: <b>' + esc(feat ? gameName(feat) : 'Pixel War (default)') + '</b></div>' +
      '<div class="adm-actions"><select class="adm-in" id="adm-feat" style="flex:1;min-width:200px"><option value="">Pixel War (default)</option>' +
        (typeof GAMES !== 'undefined' ? GAMES : []).slice().sort((x, y) => x.name.localeCompare(y.name)).map(g =>
          '<option value="' + esc(g.file) + '"' + (g.file === feat ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') +
      '</select><button class="adm-btn" data-act="feature">Feature it</button></div>' +
      '<div class="adm-h">// PUSH AN UPDATE</div>' +
      '<div class="adm-note">Every open hub and game page reloads itself within a few seconds - so players get your latest ' +
        'changes without refreshing. Anyone mid-game loses unsaved progress.</div>' +
      '<div class="adm-actions"><button class="adm-btn warn" data-act="reloadall">↻ Reload everyone</button></div>' +
      '<div class="adm-h">// GUEST PLAY</div>' +
      '<div class="adm-note">' + (overview.guestsLocked ? '<b style="color:#ffc800">OFF</b> - everyone has to sign in to play.'
        : '<b>ON</b> - people can play free games without signing in.') + ' More on the Guests tab.</div>' +
      '<div class="adm-actions"><button class="adm-btn ' + (overview.guestsLocked ? '' : 'danger') + '" data-act="guestlock" data-on="' +
        (overview.guestsLocked ? '0' : '1') + '">' + (overview.guestsLocked ? '✅ Let guests play again' : '🚫 Turn guest play off') + '</button></div>' +
      '<div class="adm-h">// GAMES · ' + offList.length + ' switched off</div>' +
      '<div class="adm-note">A switched-off game disappears from the home screen, nobody but you can open it, and players already in it are sent back to the hub. ' +
        'Handy when a game is broken. Use Open to test one while it\'s off.</div>' +
      '<div class="adm-actions"><input class="adm-in" id="adm-gsearch" placeholder="Filter games…" style="flex:1;min-width:180px" value="' + esc(gameFilter) + '">' +
        (offList.length ? '<button class="adm-btn warn" data-act="allon">Switch all back on</button>' : '') + '</div>' +
      (typeof GAMES !== 'undefined' ? GAMES : []).filter(g => !gameFilter || (g.name || g.file).toLowerCase().indexOf(gameFilter.toLowerCase()) !== -1)
        .map(g => {
          const off = offList.indexOf(g.file) !== -1;
          return '<div class="adm-row' + (off ? ' ban' : '') + '"><div class="adm-grow"><div class="adm-name">' + esc(gameName(g.file)) +
            (off ? ' <span class="adm-tag">off</span>' : '') + '</div></div>' +
            (off ? '<a class="adm-btn" style="text-decoration:none" href="' + esc(typeof gameURL === 'function' ? gameURL(g.file) : g.file) + '">Open</a>' : '') +
            '<button class="adm-btn ' + (off ? '' : 'danger') + '" data-act="gametoggle" data-file="' + esc(g.file) + '">' + (off ? 'Switch on' : 'Switch off') + '</button></div>';
        }).join('');
  }

  // "2.5m" → 2500000. Accepts plain numbers, 1e15, and k/m/b/t/qa/qi suffixes.
  function parseEnergy(t) {
    const m = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)\s*(k|m|b|t|qa|qi)?\s*$/i.exec(String(t || '').replace(/,/g, ''));
    if (!m) return 0;
    const mul = { k:1e3, m:1e6, b:1e9, t:1e12, qa:1e15, qi:1e18 }[(m[2] || '').toLowerCase()] || 1;
    const n = parseFloat(m[1]) * mul;
    return isFinite(n) && n > 0 && n <= 1e300 ? n : 0;
  }
  function myId() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser.sub : ''; }
  // Owners message players through the gift inbox (lands on their hub); moderators
  // can't send gifts, so theirs is a pop-up.
  function msgBtn(sub, name, label) {
    return isOwner ? '<button class="adm-btn warn" data-act="msg" data-sub="' + esc(sub) + '" data-name="' + esc(name) + '">' + label + '</button>'
      : '<button class="adm-btn warn" data-act="pop" data-target="u:' + esc(sub) + '" data-name="' + esc(name) + '">' + label + '</button>';
  }
  function viewBtn(target, name) {
    return '<button class="adm-btn view" data-act="view" data-target="' + esc(target) + '" data-name="' + esc(name) + '" title="See what ' + esc(name) + ' is doing">👁 View</button>';
  }

  function viewWatch() {
    const back = '<div class="adm-actions"><button class="adm-btn warn" data-act="unview">◀ Back</button>' +
      '<span class="adm-meta" style="align-self:center">updates by itself every few seconds</span></div>';
    if (!watch) { loadWatch(); return back + '<div class="adm-empty">Loading ' + esc(viewing.name) + '…</div>'; }
    const w = watch.who;
    const guest = w.kind === 'guest', target = viewing.target;
    const nowBox = w.online
      ? '<div class="adm-now"><div class="big">' + (w.playing ? '🎮' : '🏠') + '</div><div><span class="adm-meta">RIGHT NOW</span>' +
        '<b>' + esc(w.playing ? 'Playing ' + gameName(w.playing) : 'In the hub, picking a game') + '</b>' +
        '<span class="adm-meta">last check-in ' + ago(w.last_seen) + '</span></div></div>'
      : '<div class="adm-now off"><div class="big">💤</div><div><span class="adm-meta">RIGHT NOW</span><b>Offline</b>' +
        '<span class="adm-meta">last seen ' + ago(w.last_seen) + (w.last_seen ? ' (' + when(w.last_seen) + ')' : '') + '</span></div></div>';
    const me = target === 'u:' + myId();
    const actions = '<div class="adm-actions">' +
      (guest ? (w.online ? '<button class="adm-btn warn" data-act="pop" data-target="' + esc(target) + '" data-name="' + esc(w.name) + '">✉ Message</button>' : '')
             : msgBtn(w.sub, w.name, '✉ Message') +
               (isOwner ? '<button class="adm-btn" data-act="give" data-sub="' + esc(w.sub) + '" data-name="' + esc(w.name) + '">🎁 Give</button>' : '')) +
      (w.banned ? '' : energyBtn(target, w.name)) +
      (w.online && !me && !(isMod && w.isMod) ? kickBtn(target, w.name) : '') +
      (me || (isMod && w.isMod) || (w.banned && !isOwner) ? '' : guest
        ? '<button class="adm-btn ' + (w.banned ? 'warn' : 'danger') + '" data-act="' + (w.banned ? 'gunban' : 'gban') + '" data-gid="' + esc(w.gid) +
          '" data-name="' + esc(w.name) + '">' + (w.banned ? 'Unban' : isOwner ? 'Ban' : 'Ask to ban') + '</button>'
        : banBtn(w.sub, w.name, w.banned)) + '</div>';
    const row = (k, v) => v === '' || v == null || v === '?' ? '' : '<div class="adm-meta"><b style="color:#e8eefc;display:inline-block;min-width:88px">' + k + '</b> ' + v + '</div>';
    // Moderators get no device, network, email, counts or history (the server leaves them out).
    const details = (isOwner ? row('Device', esc(device(w.ua))) + row('Network', esc(netCode(w.ip))) : '') +
      (guest ? row('First seen', ago(w.created)) :
        (isOwner ? row('Google name', esc(w.real_name || '')) + row('Email', esc(w.email || '')) : '') +
        row('Friend code', esc(w.code || '-')) + row('Joined', ago(w.created)) +
        (w.friends != null ? row('Friends', w.friends + ' · ' + w.saves + ' cloud saves · ' + w.reports + ' reports about them')
          : row('Reports', (w.reports || 0) + ' about them'))) +
      (isOwner ? row('Terms', w.tos_version ? 'agreed (' + esc(w.tos_version) + ')' + (w.tos_at ? ' ' + ago(w.tos_at) : '') : '<span style="color:#ffb400">not agreed yet</span>') : '') +
      (w.banned ? row('Banned', (w.ban_until ? 'until ' + when(w.ban_until) : 'permanently') + (w.ban_reason ? ' - “' + esc(w.ban_reason) + '”' : '')) : '');
    return back +
      '<div class="adm-row" style="margin-bottom:12px"><div class="adm-av" style="width:44px;height:44px;font-size:20px">' + (guest ? '👤' : avatar(w)) + '</div>' +
        '<div class="adm-grow"><div class="adm-name" style="font-size:18px">' + esc(w.name) +
        (guest ? ' <span class="adm-tag" style="background:rgba(255,180,0,.12);color:#ffb400;border-color:rgba(255,180,0,.3)">guest</span>' : '') +
        (w.online ? ' <span style="color:#00ff88">● online</span>' : '') + (w.banned ? ' <span class="adm-tag">banned</span>' : '') + '</div>' +
        '<div class="adm-meta">' + (guest ? 'playing without an account' : isOwner ? esc([w.real_name, w.email].filter(Boolean).join(' · '))
          : 'friend code ' + esc(w.code || '-')) + '</div></div></div>' +
      nowBox + actions +
      '<div class="adm-h">// DETAILS</div>' + details +
      trades(watch.trades, w.sub);
  }
  async function loadWatch() {
    if (!viewing) return;
    const t = viewing.target;
    try { const r = await call('/api/admin/view?target=' + encodeURIComponent(t)); if (viewing && viewing.target === t) { watch = r; render(); } }
    catch (e) { fail(e); }
  }

  // Owner-only: drop Idle Universe energy into someone's bank (lands next time they're in it).
  function energyBtn(target, name) {
    return isOwner ? '<button class="adm-btn" data-act="energy" data-target="' + esc(target) + '" data-name="' + esc(name) + '" title="Gift Idle Universe energy">⚡ Energy</button>' : '';
  }
  // Owner: Ban / Unban. Moderator: "Ask to ban" (the owner approves it), and no Unban.
  function banBtn(sub, name, banned) {
    if (banned) return isOwner ? '<button class="adm-btn warn" data-act="unban" data-sub="' + esc(sub) + '" data-name="' + esc(name) + '">Unban</button>' : '';
    return '<button class="adm-btn danger" data-act="ban" data-sub="' + esc(sub) + '" data-name="' + esc(name) + '">' + (isOwner ? 'Ban' : 'Ask to ban') + '</button>';
  }
  function kickBtn(target, name) {
    return '<button class="adm-btn warn" data-act="kick" data-target="' + esc(target) + '" data-name="' + esc(name) + '">👢 Kick</button>';
  }
  // "net:3fa9c1d2…" → "3FA9-C1D2": a network's scrambled code, short enough to compare by eye.
  function netCode(ip) {
    const m = /^net:([0-9a-f]{8})/.exec(String(ip || ''));
    return m ? m[1].toUpperCase().replace(/^(.{4})/, '$1-') : String(ip || '');
  }
  // Tokens this player sent or got from friends this week (owner only).
  function trades(list, sub) {
    if (!isOwner || !list || !list.length) return '';
    return '<div class="adm-h">// TOKENS SENT AND RECEIVED · LAST 7 DAYS</div>' + list.map(x => {
      const out = x.from_sub === sub;
      return '<div class="adm-row"><div class="adm-grow"><div class="adm-name">' + (out ? '➡ sent ' : '⬅ got ') + x.tokens + ' 🪙 ' +
        (out ? 'to ' + esc(x.to_name || 'a deleted player') : 'from ' + esc(x.from_name || 'a deleted player')) + '</div></div>' +
        '<span class="adm-meta">' + ago(x.created) + '</span></div>';
    }).join('');
  }
  // "Mozilla/5.0 (iPhone; …) … Safari" → "iPhone · Safari": enough to tell devices apart.
  function device(ua) {
    ua = String(ua || '');
    if (ua && !/[/;(]/.test(ua)) return ua;   // the server keeps just the kind of device now
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
      : /CrOS/.test(ua) ? 'Chromebook' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '?';
    const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return os + (br ? ' · ' + br : '');
  }
  const BAN_CHOICES = [['0','This device - permanently'],['24','This device - 1 day'],['168','This device - 1 week'],
    ['0ip','Device + their network - permanently'],['24ip','Device + their network - 1 day'],['168ip','Device + their network - 1 week']];

  function viewGuests() {
    if (!staff()) return claimPanel();
    if (guests === null) { loadGuests(); return '<div class="adm-empty">Loading…</div>'; }
    const list = guests.guests || [], bans = guests.ipBans || [];
    const locked = !!guests.guestsLocked;
    const online = list.filter(g => g.online && !g.banned).length;
    return '<div class="adm-note">Guests are people playing without signing in. Each browser gets its own id, so a guest who ' +
        'clears their browser comes back as a new one - that\'s what a <b>network</b> ban is for. Network bans hit everyone on ' +
        'that internet connection (a whole house or school), so use them on troublemakers only.</div>' +
      '<div class="adm-actions"><button class="adm-btn" data-act="reload">↻ Refresh</button>' +
        (isOwner ? '<button class="adm-btn ' + (locked ? '' : 'danger') + '" data-act="guestlock" data-on="' + (locked ? '0' : '1') + '">' +
          (locked ? '✅ Let guests play again' : '🚫 Turn guest play off') + '</button>' : '') +
        (online ? '<button class="adm-btn danger" data-act="kickguests">👢 Kick all ' + online + ' online guest' + (online > 1 ? 's' : '') + '</button>' : '') +
      '</div>' +
      (locked ? '<div class="adm-note" style="color:#ffc800;border:1px solid currentColor;padding:9px 12px">🚫 Guest play is OFF - ' +
        'everyone has to sign in to play.</div>' : '') +
      '<div class="adm-h">// GUESTS · ' + list.length + ' in the last 30 days · ' + online + ' online</div>' +
      (list.length ? list.map(g =>
        '<div class="adm-row' + (g.banned ? ' ban' : '') + '" style="' + (g.banned ? '' : 'border-left-color:rgba(255,180,0,.5)') + '">' +
          '<div class="adm-av" data-act="view" data-target="g:' + esc(g.gid) + '" data-name="' + esc(g.name) + '" title="View what ' + esc(g.name) + ' is doing">👤</div>' +
          '<div class="adm-grow"><div class="adm-name">' + esc(g.name) +
            (g.online ? ' <span style="color:#00ff88" title="online">●</span> <span class="adm-meta">' +
              (g.playing ? '▶ ' + esc(gameName(g.playing)) : 'in the hub') + '</span>' : '') +
            (g.banned ? ' <span class="adm-tag">' + (g.ban_until ? 'banned until ' + when(g.ban_until) : 'banned') + '</span>' : '') +
            (g.ipBanned ? ' <span class="adm-tag">network banned</span>' : '') +
            (g.sameAsYou ? ' <span class="adm-tag" style="background:rgba(0,245,255,.14);color:#00f5ff;border-color:rgba(0,245,255,.3)">your network</span>' : '') +
          '</div>' +
          '<div class="adm-meta">' + (isOwner ? esc(device(g.ua)) + (g.ip ? ' · network ' + esc(netCode(g.ip)) : '') + ' · ' : '') +
            'first seen ' + ago(g.created) + ' · last seen ' + ago(g.last_seen) + '</div>' +
          (isOwner ? '<div class="adm-meta">' + (g.tos_version ? '📜 agreed to the terms (' + esc(g.tos_version) + ')'
            : '<span style="color:#ffb400">📜 hasn\'t agreed to the terms</span>') + '</div>' : '') +
          (g.alsoOnIp && g.alsoOnIp.length ? '<div class="adm-meta">same network as: ' + esc(g.alsoOnIp.slice(0, 5).join(', ')) + '</div>' : '') +
          (g.ban_reason ? '<div class="adm-meta">“' + esc(g.ban_reason) + '”</div>' : '') + '</div>' +
          viewBtn('g:' + g.gid, g.name) +
          (isOwner ? '<button class="adm-btn warn" data-act="glabel" data-gid="' + esc(g.gid) + '" data-name="' + esc(g.name) + '" title="Give this guest a name you\'ll recognise">✏</button>' : '') +
          (g.banned ? '' : energyBtn('g:' + g.gid, g.name)) +
          (g.online && !g.banned ? '<button class="adm-btn warn" data-act="pop" data-target="g:' + esc(g.gid) + '" data-name="' + esc(g.name) + '">✉</button>' +
            kickBtn('g:' + g.gid, g.name) : '') +
          (g.banned && !isOwner ? '' : '<button class="adm-btn ' + (g.banned ? 'warn' : 'danger') + '" data-act="' + (g.banned ? 'gunban' : 'gban') +
            '" data-gid="' + esc(g.gid) + '" data-name="' + esc(g.name) + '" data-same="' + (g.sameAsYou ? 1 : 0) + '">' + (g.banned ? 'Unban' : isOwner ? 'Ban' : 'Ask to ban') + '</button>') +
        '</div>').join('') : '<div class="adm-empty">No guests yet.</div>') +
      (!isOwner ? '' : '<div class="adm-h">// NETWORK BANS · ' + bans.length + '</div>' +
      (bans.length ? bans.map(b =>
        '<div class="adm-row ban"><div class="adm-grow"><div class="adm-name">' + esc(netCode(b.ip)) + (b.label ? ' <span class="adm-meta">(' + esc(b.label) + ')</span>' : '') + '</div>' +
        '<div class="adm-meta">' + (b.until ? 'until ' + when(b.until) : 'permanent') + ' · since ' + ago(b.created) + (b.reason ? ' · “' + esc(b.reason) + '”' : '') + '</div></div>' +
        '<button class="adm-btn warn" data-act="ipunban" data-ip="' + esc(b.ip) + '">Unban</button></div>').join('')
        : '<div class="adm-empty">No networks banned.</div>') +
      '<div class="adm-actions" style="margin-top:10px"><input class="adm-in" id="adm-ip" placeholder="Ban an IP by hand, e.g. 203.0.113.7" style="flex:1;min-width:200px">' +
        '<button class="adm-btn danger" data-act="ipban">Ban IP</button></div>' +
      '<div class="adm-note">IP addresses are never stored. Each network shows as a scrambled code that matches itself, so bans ' +
        'still work, but nobody (you included) can read the real address.</div>' +
      (guests.myIp ? '<div class="adm-note">Your own network is ' + esc(netCode(guests.myIp)) + ' - it can\'t be banned.</div>' : ''));
  }

  function viewAppeals() {
    if (!staff()) return claimPanel();
    if (appeals === null) { loadAppeals(); return '<div class="adm-empty">Loading…</div>'; }
    const open = appeals.filter(a => a.status === 'open');
    return '<div class="adm-note">Banned players and guests can ask to be let back in from their ban screen. ' +
        (isOwner ? 'Accepting lifts the ban (and any network ban on them); your reply shows on their screen.</div>'
          : 'Only the owner can lift a ban. You can turn an appeal down with a reply; it shows on their screen.</div>') +
      '<div class="adm-actions"><button class="adm-btn" data-act="reload">↻ Refresh</button></div>' +
      '<div class="adm-h">// WAITING · ' + open.length + '</div>' +
      (appeals.length ? appeals.map(a => {
        const tag = a.status === 'open' ? '<span class="adm-tag" style="background:rgba(255,200,0,.12);color:#ffc800;border-color:rgba(255,200,0,.35)">waiting</span>'
          : a.status === 'accepted' ? '<span class="adm-tag" style="background:rgba(0,255,136,.1);color:#00ff88;border-color:rgba(0,255,136,.3)">accepted</span>'
          : '<span class="adm-tag">rejected</span>';
        const ban = a.ban ? (a.ban.until ? 'banned until ' + when(a.ban.until) : 'banned permanently') + (a.ban.reason ? ' for “' + esc(a.ban.reason) + '”' : '') : (a.status === 'open' ? 'not banned any more' : '');
        return '<div class="adm-row' + (a.status === 'open' ? '' : ' ban') + '" style="' + (a.status === 'open' ? 'border-left-color:#ffc800' : '') + '">' +
          '<div class="adm-grow"><div class="adm-name">' + esc(a.name) + ' <span class="adm-meta">(' + a.kind + ')</span> ' + tag + '</div>' +
          '<div class="adm-meta">“' + esc(a.text) + '”</div>' +
          '<div class="adm-meta">sent ' + ago(a.created) + (ban ? ' · ' + ban : '') + (a.networkBan ? ' · their network is banned' : '') + '</div>' +
          (a.reply ? '<div class="adm-meta">reply: “' + esc(a.reply) + '”</div>' : '') + '</div>' +
          viewBtn(a.who, a.name) +
          (a.status === 'open' ? (isOwner ? '<button class="adm-btn" data-act="appeal" data-id="' + a.id + '" data-ok="1" data-name="' + esc(a.name) + '">✅ Unban</button>' : '') +
            '<button class="adm-btn danger" data-act="appeal" data-id="' + a.id + '" data-ok="0" data-name="' + esc(a.name) + '">Keep ban</button>' : '') +
          '</div>';
      }).join('') : '<div class="adm-empty">No appeals yet.</div>');
  }

  // Bar charts as inline SVG - no chart library needed for four small graphs.
  function bars(vals, opts) {
    opts = opts || {};
    const W = 600, H = opts.h || 120, n = vals.length, max = Math.max(1, ...vals.map(v => (v.a || 0) + (v.b || 0)));
    const bw = W / n;
    return '<svg viewBox="0 0 ' + W + ' ' + (H + 18) + '" style="width:100%;height:auto;display:block;margin:4px 0 6px" role="img" aria-label="' + esc(opts.label || '') + '">' +
      vals.map((v, i) => {
        const ha = (v.a || 0) / max * H, hb = (v.b || 0) / max * H, x = i * bw + bw * 0.12, w = bw * 0.76;
        return '<g><title>' + esc(v.tip) + '</title>' +
          '<rect x="' + x + '" y="' + (H - ha) + '" width="' + w + '" height="' + ha + '" fill="#00f5ff"/>' +
          (hb ? '<rect x="' + x + '" y="' + (H - ha - hb) + '" width="' + w + '" height="' + hb + '" fill="#ff0080"/>' : '') +
          (v.label ? '<text x="' + (x + w / 2) + '" y="' + (H + 13) + '" fill="#8b95a8" font-size="9" text-anchor="middle" font-family="sans-serif">' + esc(v.label) + '</text>' : '') + '</g>';
      }).join('') + '</svg>';
  }
  function viewStats() {
    if (!isOwner) return claimPanel();
    if (stats === null) { loadStats(); return '<div class="adm-empty">Loading…</div>'; }
    const d = stats, T = d.totals, today = d.days[d.days.length - 1];
    const tile = (v, l) => '<div class="adm-stat"><b>' + v + '</b><span>' + l + '</span></div>';
    const lab = i => i % 5 === 4 || i === d.days.length - 1;
    const days = d.days.map((x, i) => ({ a: x.players, b: x.guests, tip: x.day + ': ' + x.players + ' players, ' + x.guests + ' guests', label: lab(i) ? x.day.slice(5) : '' }));
    const ups = d.days.map((x, i) => ({ a: x.signups, tip: x.day + ': ' + x.signups + ' new accounts', label: lab(i) ? x.day.slice(5) : '' }));
    return '<div class="adm-note">GLITCHBOX doesn\'t record which games people play or for how long. These are just head counts: ' +
        'how many players and guests visited each day (UTC days).</div>' +
      '<div class="adm-grid">' + tile(T.players, 'Players · 30d') + tile(T.guests, 'Guests · 30d') +
        tile(today.players + today.guests, 'Visitors today') + tile(d.days.reduce((a, x) => a + x.signups, 0), 'New accounts · 30d') + '</div>' +
      '<div class="adm-h">// VISITORS EACH DAY</div><div class="adm-meta"><span style="color:#00f5ff">■</span> players &nbsp; <span style="color:#ff0080">■</span> guests · hover a bar for numbers</div>' +
      bars(days, { label: 'visitors per day' }) +
      '<div class="adm-h">// NEW ACCOUNTS</div>' + bars(ups, { h: 60, label: 'new accounts per day' }) +
      '<div class="adm-actions" style="margin-top:14px"><button class="adm-btn" data-act="reload">↻ Refresh</button></div>';
  }

  function viewLog() {
    if (!staff()) return claimPanel();
    if (logRows === null) { loadLog(); return '<div class="adm-empty">Loading…</div>'; }
    const icon = { ban:'⛔', unban:'✅', delete:'🗑', gift:'🎁', message:'✉', announce:'📣', 'announce-off':'📣',
                   'maintenance-on':'🛠', 'maintenance-off':'🛠', 'dismiss-report':'🧹',
                   kick:'👢', popup:'✉', 'ban-guest':'⛔', 'unban-guest':'✅', 'ban-ip':'🌐', 'unban-ip':'🌐',
                   'reload-all':'↻', games:'⏸', 'guests-off':'🚫', 'guests-on':'✅',
                   'mod-add':'⭐', 'mod-remove':'⭐', 'appeal-accept':'⚖', 'appeal-reject':'⚖', featured:'🌟', 'self-delete':'🗑',
                   'ban-request':'⛔', 'ban-request-denied':'✋' };
    return '<div class="adm-actions"><button class="adm-btn" data-act="reload">↻ Refresh</button></div>' +
      (logRows.length ? logRows.map(r =>
        '<div class="adm-row"><div class="adm-grow"><div class="adm-name">' + (icon[r.action] || '•') + ' ' + esc(r.action) +
          (r.target ? ' <span class="adm-meta">→ ' + esc(r.target) + '</span>' : '') + '</div>' +
        '<div class="adm-meta">' + when(r.at) + (r.detail ? ' · ' + esc(r.detail) : '') + '</div></div></div>').join('')
        : '<div class="adm-empty">Nothing logged yet - bans, gifts, announcements and so on show up here.</div>');
  }

  function viewReports() {
    if (!staff()) return claimPanel();
    if (reports === null) { loadReports(); return '<div class="adm-empty">Loading…</div>'; }
    const open = banReqs.filter(b => b.status === 'open');
    const reqs = banReqs.length ? '<div class="adm-h">// BAN REQUESTS FROM MODERATORS · ' + open.length + ' waiting</div>' +
      (isOwner ? '' : '<div class="adm-note">Your ban requests wait here until the owner approves or denies them.</div>') +
      banReqs.slice(0, 30).map(b => {
        const tag = b.status === 'open' ? '<span class="adm-tag" style="background:rgba(255,200,0,.12);color:#ffc800;border-color:rgba(255,200,0,.35)">waiting</span>'
          : b.status === 'approved' ? '<span class="adm-tag">approved - banned</span>'
          : '<span class="adm-tag" style="background:rgba(0,255,136,.1);color:#00ff88;border-color:rgba(0,255,136,.3)">denied</span>';
        return '<div class="adm-row' + (b.status === 'open' ? '' : ' ban') + '" style="' + (b.status === 'open' ? 'border-left-color:#ffc800' : '') + '">' +
          '<div class="adm-grow"><div class="adm-name">' + esc(b.name) + ' <span class="adm-meta">(' + b.kind + ')</span> ' + tag + '</div>' +
          '<div class="adm-meta">' + esc(b.by_name || 'a moderator') + ' asked for a ' + (b.hours < 24 ? b.hours + 'h' : '1 day') + ' ban · ' + ago(b.created) + '</div>' +
          '<div class="adm-meta">' + (b.reason ? '“' + esc(b.reason) + '”' : 'no reason given') + '</div></div>' +
          viewBtn(b.who, b.name) +
          (isOwner && b.status === 'open' ? '<button class="adm-btn danger" data-act="breq" data-id="' + b.id + '" data-ok="1" data-name="' + esc(b.name) + '">⛔ Approve ban</button>' +
            '<button class="adm-btn" data-act="breq" data-id="' + b.id + '" data-ok="0" data-name="' + esc(b.name) + '">Deny</button>' : '') +
          '</div>';
      }).join('') + '<div class="adm-h">// REPORTS</div>' : '';
    if (!reports.length) return reqs + '<div class="adm-empty">No reports. Quiet arcade.</div>';
    return reqs + reports.map(r =>
      '<div class="adm-row">' +
        '<div class="adm-grow"><div class="adm-name">' + esc(r.reported || '(deleted)') +
          (r.banned ? ' <span class="adm-tag">banned</span>' : '') + '</div>' +
        '<div class="adm-meta">reported by ' + esc(r.reporter || '(deleted)') + ' · ' + ago(r.created) + '</div>' +
        '<div class="adm-meta">' + (r.reason ? '“' + esc(r.reason) + '”' : 'no reason given') + '</div></div>' +
        (r.reported_sub && !r.banned ? banBtn(r.reported_sub, r.reported || '', false) : '') +
        '<button class="adm-btn warn" data-act="dismiss" data-id="' + r.id + '">Dismiss</button>' +
      '</div>').join('');
  }

  function viewGod() {
    const on = hasTokens();
    const icons = (typeof ICON_BY_ID !== 'undefined') ? Object.keys(ICON_BY_ID).length : 0;
    return '<div class="adm-note">God mode rewrites <b>this device only</b> - it never touches the server or ' +
        'anyone else\'s progress.</div>' +
      (on
        ? '<div class="adm-h">// WALLET</div>' +
          '<div class="adm-actions">' +
            '<button class="adm-btn" data-act="tok" data-n="100">+100 tokens</button>' +
            '<button class="adm-btn" data-act="tok" data-n="1000">+1000 tokens</button>' +
            '<button class="adm-btn warn" data-act="tokset">Set exact…</button>' +
            '<button class="adm-btn danger" data-act="tokzero">Zero it</button>' +
          '</div><div class="adm-note">Balance now: <b>' + tokens() + '</b></div>'
        : '<div class="adm-note">This build has no token economy - games and icons are already unlocked for everyone.</div>') +
      '<div class="adm-h">// UNLOCKS</div>' +
      '<div class="adm-actions">' +
        '<button class="adm-btn" data-act="unlockgames">Unlock every game</button>' +
        '<button class="adm-btn" data-act="unlockicons">Unlock all ' + icons + ' icons</button>' +
        '<button class="adm-btn danger" data-act="wipeecon">Reset economy</button>' +
      '</div>' +
      '<div class="adm-note">Reset sets tokens to 0 and clears unlocks, daily streak and play history on this device. ' +
        'To give another player something, use 🎁 on the Players tab.</div>';
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
      return '<div class="adm-empty">Sign in first - the console follows the account, not the browser.</div>';
    // The hub never got your account back from the server (expired sign-in, server error,
    // offline). Then we know nothing about ownership, so say that instead of guessing.
    const st = (typeof lastState !== 'undefined' && lastState) || {};
    if (!st.profile) {
      const er = window.__meErr;
      const expired = er && er.status === 401;
      return '<div class="adm-h">// ACCOUNT NOT LOADED</div>' +
        '<div class="adm-note">The server hasn\'t confirmed who you are, so this console can\'t tell yet whether you\'re the owner.</div>' +
        '<div class="adm-note">' + (expired
          ? 'Your sign-in has expired (they last 30 days). Sign out with ⏻ next to your name and sign back in with Google.'
          : er ? 'The server answered: <b>' + esc(er.msg) + '</b>' + (er.status ? ' (HTTP ' + er.status + ')' : '') + '. Reload the page; if it keeps saying this, note the message.'
               : 'Still loading. Give it a few seconds, or reload the page.') + '</div>';
    }
    // OWNER_EMAIL is set on the Worker: one account owns this arcade and the claim
    // code is dead, so offering an input here would just be a box that always fails.
    if (st.ownerPinned) {
      const oc = st.ownerCheck || {};
      return '<div class="adm-h">// OWNER ONLY</div>' +
        '<div class="adm-note">This arcade is pinned to a single owner account. You are signed in as ' +
          '<b>' + esc(oc.email || currentUser.email || currentUser.name) + '</b>, which is not it.</div>' +
        (oc.email && oc.emailMatches && !oc.emailVerified ? '<div class="adm-note">That is the owner address, but Google hasn\'t marked it verified on this account.</div>' : '') +
        '<div class="adm-note">Sign out and sign back in with the owner\'s Google account - the server ' +
          're-checks the address on every request, so there is nothing to unlock from this side.</div>';
    }
    return '<div class="adm-h">// CLAIM OWNERSHIP</div>' +
      '<div class="adm-note">This account isn\'t the owner yet. Enter the claim code (a Worker secret) once and ' +
        'this account becomes the permanent owner - the claim can\'t be repeated afterwards.</div>' +
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
  async function loadLog() {
    try { logRows = (await call('/api/admin/log')).log || []; render(); }
    catch (e) { fail(e); }
  }
  async function loadAppeals() { try { appeals = (await call('/api/admin/appeals')).appeals || []; render(); } catch (e) { fail(e); } }
  async function loadStats() { try { stats = await call('/api/admin/stats'); render(); } catch (e) { fail(e); } }
  async function loadGuests() { try { guests = await call('/api/admin/guests'); render(); } catch (e) { fail(e); } }
  async function loadReports() {
    try {
      const [r, b] = await Promise.all([call('/api/admin/reports'), call('/api/admin/ban-requests').catch(() => ({ requests: [] }))]);
      reports = r.reports || []; banReqs = b.requests || []; render();
    }
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
      if (act === 'reload') { overview = null; players = null; reports = null; logRows = null; guests = null; appeals = null; stats = null; render(); }
      else if (act === 'goappeals') { e.preventDefault(); tab = 'appeals'; render(); }
      else if (act === 'goreports') { e.preventDefault(); tab = 'reports'; reports = null; render(); }
      else if (act === 'alerts') {
        const r = window.GBSocial ? await GBSocial.enableAlerts() : 'unsupported';
        notice = { text: r === 'granted' ? '🔔 Desktop alerts are on.' : r === 'denied' ? 'Your browser blocked notifications - allow them for this site in its settings.' : 'This browser can\'t show desktop alerts.', bad: r !== 'granted' };
        render();
      }
      else if (act === 'appeal') {
        const ok = el.dataset.ok === '1', name = el.dataset.name || 'them';
        askFor({ text: (ok ? 'Unban ' : 'Keep the ban on ') + name + '? Your reply shows on their ban screen.', input: ok ? 'Reply (optional), e.g. OK - be nice' : 'Reply (optional), e.g. Sorry, the ban stays',
                 yes: ok ? 'Unban ' + name : 'Keep the ban', run: async reply => {
          const r = await call('/api/admin/appeal-decide', { method:'POST', body:{ id: +el.dataset.id, accept: ok, reply } });
          appeals = null; players = null; guests = null; overview = null; logRows = null;
          notice = { text: (ok ? '✅ ' + name + ' is unbanned' : '⚖ The ban on ' + name + ' stays') + (r.note || '') + '.' };
        }});
      }
      else if (act === 'resettag') {
        const name = el.dataset.name || 'them';
        askFor({ text:'Reset ' + name + '\'s nametag?\nThey get a random one now and must pick a new nametag next time they open the arcade.', yes:'Reset nametag', run: async () => {
          const r = await call('/api/admin/reset-tag', { method:'POST', body:{ sub: el.dataset.sub } });
          players = null; logRows = null; notice = { text:'🏷️ ' + name + ' is now ' + r.name + ' until they pick a new nametag.' };
        }});
      }
      else if (act === 'setmod') {
        const on = el.dataset.on === '1', name = el.dataset.name || 'them';
        const go = async () => {
          await call('/api/admin/set-mod', { method:'POST', body:{ sub: el.dataset.sub, on } });
          players = null; logRows = null; notice = { text: on ? '⭐ ' + name + ' is a moderator.' : name + ' is no longer a moderator.' };
        };
        if (on) askFor({ text:'Make ' + name + ' a moderator?\nThey can view, message, kick and ban players and guests for up to a day, and answer appeals. ' +
          'They can kick players and ask you to ban someone (you approve or deny it). They never see real names, emails, networks or devices, ' +
          'and can\'t give tokens, delete accounts or change the arcade.', yes:'Make mod', run: go });
        else { await go(); render(); }
      }
      else if (act === 'feature') {
        const f = $('adm-feat').value;
        const r = await call('/api/admin/featured', { method:'POST', body:{ file: f } });
        if (overview) overview.featured = r.featured;
        if (typeof applyFeatured === 'function') applyFeatured(r.featured);
        logRows = null; notice = { text:'🌟 Featured: ' + (r.featured ? gameName(r.featured) : 'Pixel War (default)') + '.' }; render();
      }
      else if (act === 'view') { viewing = { target: el.dataset.target, name: el.dataset.name || 'them' }; watch = null; ask = null; notice = null; render(); $('adm-wrap').scrollTop = 0; }
      else if (act === 'unview') { viewing = null; watch = null; notice = null; render(); }
      else if (act === 'kick' || act === 'kickall' || act === 'kickguests') {
        const all = act !== 'kick', name = all ? (act === 'kickguests' ? 'every online guest' : 'everyone online') : (el.dataset.name || 'them');
        askFor({ text:'Kick ' + name + '? They\'re sent back to the hub with your message. It isn\'t a ban - they can come straight back.',
                 input:'Reason (optional)', yes:'Kick', run: async reason => {
          if (act === 'kickguests') {
            const ids = ((guests && guests.guests) || []).filter(g => g.online && !g.banned).map(g => 'g:' + g.gid);
            for (const target of ids) await call('/api/admin/kick', { method:'POST', body:{ target, reason } });
            notice = { text:'👢 Kicked ' + ids.length + ' guest' + (ids.length === 1 ? '' : 's') + '.' };
          } else {
            const r = await call('/api/admin/kick', { method:'POST', body:{ target: all ? '*' : el.dataset.target, reason } });
            notice = { text:'👢 Kicked ' + (all ? r.kicked + ' player' + (r.kicked === 1 ? '' : 's') : name) + ' - it lands within a few seconds.' };
          }
          logRows = null; overview = null; guests = null;
        }});
      }
      else if (act === 'energy' || act === 'energyall') {
        const all = act === 'energyall', name = all ? 'every player and guest' : (el.dataset.name || 'them');
        askFor({ text:'Gift Idle Universe energy to ' + name + '. It lands within a few seconds if they\'re playing it, or the next time they open it.' +
                      '\nType an amount - 5000, 2.5m, 1b, 3t or 1e15 all work.',
                 input:'Amount of energy', yes:'⚡ Send energy', run: async text => {
          const n = parseEnergy(text);
          if (!n) throw new Error('Type an amount, like 1m or 5e12.');
          const r = await call('/api/admin/game-gift', { method:'POST', body:{ target: all ? '*' : el.dataset.target, game:'idle-universe.html', amount:n } });
          logRows = null; notice = { text:'⚡ Sent ' + text.trim() + ' energy to ' + (all ? r.sent + ' player' + (r.sent === 1 ? '' : 's') + ' and guests' : name) + '.' };
        }});
      }
      else if (act === 'pop' || act === 'popall') {
        const all = act === 'popall', name = all ? 'everyone online' : (el.dataset.name || 'them');
        askFor({ text:'Message ' + name + ' - it pops up on their screen right away, even mid-game.', input:'Your message',
                 yes:'Send', run: async text => {
          if (!text) throw new Error('Type a message first.');
          const r = await call('/api/admin/popup', { method:'POST', body:{ target: all ? '*' : el.dataset.target, text } });
          logRows = null; notice = { text:'✉ Sent to ' + (all ? r.sent + ' player' + (r.sent === 1 ? '' : 's') : name) + '.' };
        }});
      }
      else if (act === 'gban') {
        const name = el.dataset.name || 'this guest', gid = el.dataset.gid;
        const same = el.dataset.same === '1';
        askFor({ text:(isOwner ? 'Ban ' + name + '? They\'re kicked out within a few seconds, even mid-game.'
                       : 'Ask the owner to ban ' + name + '? Nothing happens until the owner approves it.') +
                      (same ? '\nThey\'re on YOUR network, so only their device can be banned.' : ''),
                 input:'Reason (optional)', choices: !isOwner ? [['24','This device - 1 day'],['1','This device - 1 hour'],['6','This device - 6 hours']]
                   : same ? BAN_CHOICES.filter(c => !/ip$/.test(c[0])) : BAN_CHOICES,
                 yes: isOwner ? 'Ban ' + name : 'Send request', run: async (reason, pick) => {
          const ip = /ip$/.test(pick), hours = parseInt(pick, 10) || 0;
          const r = await call('/api/admin/guest-ban', { method:'POST', body:{ gid, banned:true, reason, hours, ip } });
          guests = null; overview = null; logRows = null;
          notice = { text: r && r.pending ? '⛔ Sent to the owner. ' + name + ' is only banned if they approve it.'
            : name + ' is banned' + (ip ? ' (device + network)' : '') + '.' };
        }});
      }
      else if (act === 'gunban') {
        await call('/api/admin/guest-ban', { method:'POST', body:{ gid: el.dataset.gid, banned:false } });
        guests = null; logRows = null; watch = null; notice = { text: (el.dataset.name || 'Guest') + ' is unbanned.' }; render();
      }
      else if (act === 'glabel') {
        askFor({ text:'Name this guest (only you see it):', input:'e.g. Sam\'s iPad', value: /^Guest /.test(el.dataset.name) ? '' : el.dataset.name,
                 yes:'Save', run: async label => {
          await call('/api/admin/guest-label', { method:'POST', body:{ gid: el.dataset.gid, label } });
          guests = null; notice = { text: label ? 'Saved - they show as ' + label + '.' : 'Name cleared.' };
        }});
      }
      else if (act === 'ipban') {
        const ip = ($('adm-ip').value || '').trim();
        if (!ip) { notice = { text:'Type an IP address first.', bad:true }; render(); return; }
        askFor({ text:'Ban the network ' + ip + '? Everyone on it is locked out - guests and signed-in players alike (except you).',
                 input:'Reason (optional)', choices:[['0','Permanently'],['24','for 1 day'],['168','for 1 week']], yes:'Ban network',
                 run: async (reason, hours) => {
          await call('/api/admin/ip-ban', { method:'POST', body:{ ip, banned:true, reason, hours:+hours || 0 } });
          guests = null; logRows = null; notice = { text:'🌐 ' + netCode(ip) + ' is banned.' };
        }});
      }
      else if (act === 'ipunban') {
        await call('/api/admin/ip-ban', { method:'POST', body:{ ip: el.dataset.ip, banned:false } });
        guests = null; logRows = null; notice = { text:'🌐 ' + netCode(el.dataset.ip) + ' is unbanned.' }; render();
      }
      else if (act === 'guestlock') {
        const on = el.dataset.on === '1';
        const go = async () => {
          await call('/api/admin/guests-lock', { method:'POST', body:{ on } });
          guests = null; overview = null; logRows = null;
          notice = { text: on ? '🚫 Guest play is off - guests are asked to sign in.' : '✅ Guests can play again.' };
        };
        if (on) askFor({ text:'Turn guest play off? Everyone not signed in is sent to the sign-in screen.', yes:'Turn it off', run: go });
        else { await go(); render(); }
      }
      else if (act === 'reloadall') {
        askFor({ text:'Reload every open GLITCHBOX page? Anyone mid-game loses unsaved progress.', yes:'Reload everyone', run: async () => {
          await call('/api/admin/reload-all', { method:'POST', body:{} });
          logRows = null; notice = { text:'↻ Every open page reloads within a few seconds.' };
        }});
      }
      else if (act === 'gametoggle' || act === 'allon') {
        const cur = (overview && overview.disabled) || [];
        const f = el.dataset.file;
        const next = act === 'allon' ? [] : cur.indexOf(f) !== -1 ? cur.filter(x => x !== f) : cur.concat([f]);
        const r = await call('/api/admin/games', { method:'POST', body:{ disabled: next } });
        if (overview) overview.disabled = r.disabled || next;
        if (typeof setDisabled === 'function') setDisabled(r.disabled || next);   // home screen updates now, not on the next ping
        logRows = null;
        notice = { text: act === 'allon' ? 'Every game is back on.' : gameName(f) + (next.indexOf(f) !== -1 ? ' is switched off.' : ' is back on.') };
        render();
      }
      else if (act === 'goarcade') { e.preventDefault(); tab = 'arcade'; render(); }
      else if (act === 'msg') {
        const name = el.dataset.name || 'this player';
        askFor({ text:'Message ' + name + ' - it pops up on their screen next time their hub checks in.', input:'Your message',
                 yes:'Send', run: async text => {
          if (!text) throw new Error('Type a message first.');
          await call('/api/admin/gift', { method:'POST', body:{ sub, note:text } });
          logRows = null; notice = { text:'✉ Sent to ' + name + '.' };
        }});
      }
      else if (act === 'announce') {
        const text = ($('adm-an-text').value || '').trim();
        if (!text) { notice = { text:'Write the announcement first.', bad:true }; render(); return; }
        await call('/api/admin/announce', { method:'POST', body:{ text, tone:$('adm-an-tone').value, hours:+$('adm-an-hours').value } });
        overview = null; logRows = null; notice = { text:'📣 Announcement is live.' }; render();
      }
      else if (act === 'annoff') {
        await call('/api/admin/announce', { method:'POST', body:{ text:'' } });
        overview = null; logRows = null; notice = { text:'Announcement taken down.' }; render();
      }
      else if (act === 'mainon') {
        const text = ($('adm-mt-text').value || '').trim();
        askFor({ text:'Close the arcade to everyone but you?', yes:'Close it', run: async () => {
          await call('/api/admin/maintenance', { method:'POST', body:{ on:true, text } });
          overview = null; logRows = null; notice = { text:'🛠 The arcade is closed. Players are sent to the closed sign.' };
          if (typeof pollArcade === 'function') pollArcade();
        }});
      }
      else if (act === 'mainoff') {
        await call('/api/admin/maintenance', { method:'POST', body:{ on:false } });
        overview = null; logRows = null; notice = { text:'The arcade is open again.' };
        if (typeof pollArcade === 'function') pollArcade();
        render();
      }
      else if (act === 'claim') {
        const code = ($('adm-code').value || '').trim();
        try {
          await call('/api/admin/claim', { method:'POST', body:{ code } });
          isOwner = true; overview = null; players = null; reports = null;
          navItem(); render();
        } catch (err) { $('adm-claim-msg').textContent = err.message; }
      }
      else if (act === 'ban') {
        // Reachable from the Reports tab too, where the player list may never have loaded.
        const p = (players || []).find(x => x.sub === sub);
        const r = (reports || []).find(x => x.reported_sub === sub);
        const name = (p && p.name) || (r && r.reported) || el.dataset.name || 'this player';
        askFor({ text: isOwner ? 'Ban ' + name + '? They are kicked out within a few seconds, even mid-game.'
                   : 'Ask the owner to ban ' + name + '? Nothing happens until the owner approves it.', input:'Reason (optional)',
                 choices: isOwner ? [['0','Permanently'],['1','for 1 hour'],['24','for 1 day'],['72','for 3 days'],['168','for 1 week']]
                   : [['24','for 1 day'],['1','for 1 hour'],['6','for 6 hours']],
                 yes: isOwner ? 'Ban ' + name : 'Send request', run: async (reason, hours) => {
          const r = await call('/api/admin/ban', { method:'POST', body:{ sub, banned:true, reason, hours:+hours || 0 } });
          players = null; reports = null; overview = null; logRows = null;
          notice = { text: r && r.pending ? '⛔ Sent to the owner. ' + name + ' is only banned if they approve it.'
            : name + ' is banned' + (+hours ? ' for ' + (+hours < 24 ? hours + 'h' : (+hours / 24) + ' day' + (+hours > 24 ? 's' : '')) : '') + '.' };
        }});
      }
      else if (act === 'breq') {
        const ok = el.dataset.ok === '1', name = el.dataset.name || 'them';
        askFor({ text: ok ? 'Approve the ban on ' + name + '? They are kicked out within a few seconds.' : 'Deny the request to ban ' + name + '?',
                 yes: ok ? 'Approve ban' : 'Deny', run: async () => {
          await call('/api/admin/ban-decide', { method:'POST', body:{ id: +el.dataset.id, approve: ok } });
          reports = null; players = null; guests = null; overview = null; logRows = null;
          notice = { text: ok ? '⛔ ' + name + ' is banned.' : 'Request denied - ' + name + ' isn\'t banned.' };
        }});
      }
      else if (act === 'askno') { ask = null; render(); }
      else if (act === 'askyes') {
        const a = ask, i = $('adm-ask-in'), sel = $('adm-ask-sel');
        if (!a) return;
        el.disabled = true;
        try { await a.run(i ? i.value.trim() : '', sel ? sel.value : ''); ask = null; if (viewing) watch = null; }
        catch (err) { ask = null; notice = { text: err.message || 'request failed', bad:true }; }
        render();
      }
      else if (act === 'unban') {
        await call('/api/admin/ban', { method:'POST', body:{ sub, banned:false } });
        const p = (players || []).find(x => x.sub === sub);
        players = null; overview = null; watch = null; notice = { text: ((p && p.name) || el.dataset.name || 'Player') + ' is unbanned.' };
        render();
      }
      else if (act === 'del') {
        const p = (players || []).find(x => x.sub === sub);
        const name = (p && p.name) || 'this player';
        askFor({ text:'Delete ' + name + ' permanently?\nTheir account, friendships, invites and cloud saves are ' +
                      'erased. This cannot be undone.', yes:'Delete ' + name, run: async () => {
          await call('/api/admin/delete', { method:'POST', body:{ sub } });
          players = null; overview = null; notice = { text: name + ' was deleted.' };
        }});
      }
      else if (act === 'give') {
        const p = (players || []).find(x => x.sub === sub);
        giftTo = { sub, name: sub === '*' ? 'everyone' : ((p && p.name) || el.dataset.name || 'this player') };
        if (viewing) { viewing = null; watch = null; tab = 'players'; }
        render();
      }
      else if (act === 'gtok') { $('adm-gtok').value = el.dataset.n; }
      else if (act === 'genergy') { $('adm-genergy').value = el.dataset.n; }
      else if (act === 'giftcancel') { giftTo = null; render(); }
      else if (act === 'giftsend') {
        const checked = n => [...$('adm-body').querySelectorAll('input[name="' + n + '"]:checked')].map(i => i.value);
        const cats = checked('i');
        const icons = (typeof ICON_SETS !== 'undefined' ? ICON_SETS : [])
          .filter(s => cats.indexOf(s.cat) !== -1).reduce((a, s) => a.concat(s.icons.map(ic => ic.id)), []);
        const body = { sub: giftTo.sub, tokens: parseInt($('adm-gtok').value, 10) || 0,
                       games: checked('g'), icons, note: ($('adm-gnote').value || '').trim() };
        const etext = ($('adm-genergy').value || '').trim(), energy = parseEnergy(etext);
        if (etext && !energy) { $('adm-gmsg').textContent = 'That energy amount doesn\'t read right - try 1m, 5b or 1e15.'; return; }
        const stuff = body.tokens || body.games.length || body.icons.length;
        if (!stuff && !energy) { $('adm-gmsg').textContent = 'Nothing to give - add tokens, energy or tick something.'; return; }
        const who = giftTo.name;
        const send = async () => {
          const r = stuff ? await call('/api/admin/gift', { method:'POST', body }) : null;
          const e = energy ? await call('/api/admin/game-gift', { method:'POST', body:{ target: body.sub === '*' ? '*' : 'u:' + body.sub,
            game:'idle-universe.html', amount: energy, note: body.note } }) : null;
          giftTo = null; players = null; logRows = null;
          notice = { text: '🎁 Gift queued for ' + (body.sub === '*' ? (r ? r.players : e.sent) + ' players' : who) +
            (energy ? ' - ⚡ ' + etext + ' energy lands next time they\'re in Idle Universe' : '') + '.' };
        };
        if (body.sub === '*') askFor({ text:'Send this gift to every player?', yes:'Send to everyone', run: send });
        else { await send(); render(); }
      }
      else if (act === 'dismiss') {
        await call('/api/admin/dismiss-report', { method:'POST', body:{ id: el.dataset.id } });
        reports = null; render();
      }
      else if (act === 'tok')     { setTokens(tokens() + (+el.dataset.n || 0)); repaint(); }
      else if (act === 'tokset')  {
        askFor({ text:'Set this device\'s token balance to:', input:'Tokens', value:String(tokens()), yes:'Set',
                 run: async n => { setTokens(parseInt(n, 10) || 0); repaint(); } });
      }
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
        askFor({ text:'Reset tokens, unlocks and play history on this device?', yes:'Reset economy', run: async () => {
          if (typeof resetEconomy === 'function') resetEconomy();
          else Object.keys(K).forEach(k => localStorage.removeItem(K[k]));
          notice = { text:'Economy reset - balance 0.' };
          repaint();
        }});
      }
      else if (act === 'jump')    { const s = $('adm-jump'); if (s && s.value) location.href = s.value; }
      else if (act === 'refresh') { if (typeof refreshState === 'function') await refreshState(); render(); }
      else if (act === 'copyme')  {
        const txt = JSON.stringify(typeof lastState !== 'undefined' ? lastState : {}, null, 2);
        try { await navigator.clipboard.writeText(txt); el.textContent = 'Copied ✓'; }
        catch (err) { el.textContent = 'Clipboard blocked'; }
      }
      else if (act === 'nuke') {
        askFor({ text:'Clear ALL GLITCHBOX data on this device (including your sign-in)?', yes:'Clear everything',
                 run: async () => {
          Object.keys(localStorage).filter(k => k.indexOf('glitchbox') === 0).forEach(k => localStorage.removeItem(k));
          location.reload();
        }});
      }
    } catch (err) { notice = { text: err.message || 'request failed', bad:true }; render(); }
  }

  // Search is debounced through the same delegated listener the buttons use.
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'adm-gsearch') {
      gameFilter = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const g = $('adm-gsearch'); if (g) { g.focus(); g.setSelectionRange(pos, pos); }
      return;
    }
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
    const old = $('adm-nav-item');
    if (old && !staff()) { old.parentNode.parentNode.removeChild(old.parentNode); return; }
    if (old) { old.querySelector('.nav-text').textContent = isOwner ? 'Owner Console' : 'Mod Console';
               old.parentNode.querySelector('.sidebar-label').textContent = isOwner ? 'OWNER' : 'MODERATOR'; return; }
    if (!staff()) return;
    const anchor = document.getElementById('sidebar-user');
    if (!anchor || !anchor.parentNode) return;
    const a = document.createElement('a');
    a.id = 'adm-nav-item';
    a.className = 'nav-item adm-nav';
    a.href = '#';
    // .nav-text is what the hover-to-unfold sidebar fades; a bare text node would
    // stay visible and get clipped mid-word in the 64px rail.
    a.innerHTML = '<span class="nav-icon">⚙</span><span class="nav-text">' + (isOwner ? 'Owner Console' : 'Mod Console') + '</span>';
    a.addEventListener('click', ev => { ev.preventDefault(); open(); });
    const sec = document.createElement('div');
    sec.className = 'sidebar-section';
    sec.style.paddingTop = '6px';
    sec.innerHTML = '<div class="sidebar-label">' + (isOwner ? 'OWNER' : 'MODERATOR') + '</div>';
    sec.appendChild(a);
    // Right under the logo, not above the account block at the bottom: the sidebar is
    // taller than most laptop windows and its scrollbar is hidden, so down there the
    // console link sat below the screen edge and looked like it had vanished.
    const logo = anchor.parentNode.querySelector('.sidebar-logo');
    if (logo && logo.parentNode === anchor.parentNode) anchor.parentNode.insertBefore(sec, logo.nextSibling);
    else anchor.parentNode.insertBefore(sec, anchor);
  }

  // The server decides who the owner is; /api/me carries the verdict, so the console
  // link appears on its own once you're signed in as that account.
  setInterval(() => {
    const owner = (typeof lastState !== 'undefined' && lastState && !!lastState.isOwner);
    const mod = !owner && (typeof lastState !== 'undefined' && lastState && !!lastState.isMod);
    if (owner !== isOwner || mod !== isMod) {
      isOwner = owner; isMod = mod;
      navItem();
      if (built && $('adm-wrap').classList.contains('show')) render();
    }
  }, 1500);

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target && e.target.id === 'adm-ask-in') { const y = document.querySelector('[data-act="askyes"]'); if (y) y.click(); return; }
    if (e.key === 'Escape' && ask && built && $('adm-wrap').classList.contains('show')) { ask = null; render(); return; }
    if (e.key === 'Escape' && built && $('adm-wrap').classList.contains('show')) { close(); return; }
    // Ctrl+Shift+A only - Cmd+Shift+A is Chrome's own tab search on a Mac.
    if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) { e.preventDefault(); toggle(); }
  });

  // Keep the View panel live while it's open (and not mid-question).
  setInterval(() => {
    if (!viewing || !watch || ask || document.hidden || !built || !$('adm-wrap').classList.contains('show')) return;
    const top = $('adm-wrap').scrollTop;
    loadWatch().then(() => { $('adm-wrap').scrollTop = top; });
  }, 5000);

  window.glitchAdmin = { open, close, toggle };

  // ── #adminsmoke ── clicks every button in the console against a fake server.
  if (location.hash.indexOf('adminsmoke') !== -1) window.addEventListener('load', () => setTimeout(async () => {
    let pass = 0, fail = 0;
    const lines = [], sent = [], dialogs = [];
    const t = (name, cond) => { if (cond) { pass++; lines.push('ok   ' + name); } else { fail++; lines.push('FAIL ' + name); } };
    const wait = () => new Promise(r => setTimeout(r, 30));
    const now = Date.now();
    const db = {
      players: [
        { sub:'me', name:'Owner', email:'o@x.com', code:'OOOO', friends:0, saves:0, reports:0, gifts:0, created:now, last_seen:now },
        { sub:'s1', name:'Dave',  email:'d@x.com', code:'AAAA', friends:1, saves:2, reports:1, gifts:1, created:now, last_seen:now, playing:'gridlock.html' },
        { sub:'s2', name:'Eve',   email:'e@x.com', code:'BBBB', friends:0, saves:0, reports:0, gifts:0, created:now, last_seen:now, banned:1, ban_reason:'rude', ban_until:now + 86400000 },
      ],
      reports: [{ id:7, reason:'cheating', created:now, reporter:'Eve', reported:'Dave', reported_sub:'s1', banned:0 }],
    };
    const arcade = { announce:null, maintenance:null, disabled:[], guestsLocked:false };
    const gdb = { guests:[
        { gid:'gaaaa1111', name:'Guest 1111', ip:'net:1a2b3c4d00000000', ua:'iPhone', created:now, last_seen:now, online:true, playing:'neon-putt.html', alsoOnIp:['Dave'] },
        { gid:'gbbbb2222', name:'Guest 2222', ip:'net:9a9a9a9a00000000', ua:'Windows PC', created:now, last_seen:now, online:true, sameAsYou:true },
        { gid:'gcccc3333', name:'Guest 3333', ip:'5.5.5.5', ua:'', created:now, last_seen:now - 9e6, banned:1, ban_reason:'spam' } ],
      ipBans:[{ ip:'net:6b6b6b6b00000000', reason:'raid', until:0, created:now, label:'' }], myIp:'net:9a9a9a9a00000000' };
    window.api = async (path, opts) => {
      sent.push({ path, body: opts && opts.body });
      if (path === '/api/admin/announce') { arcade.announce = opts.body.text ? { id:1, text:opts.body.text, tone:opts.body.tone, until:0 } : null; return { ok:true }; }
      if (path === '/api/admin/maintenance') { arcade.maintenance = opts.body.on ? { on:true, text:opts.body.text, since:now } : null; return { ok:true }; }
      if (path === '/api/admin/log') return { log:[{ id:1, at:now, action:'ban', target:'Dave <d@x.com>', detail:'for 24h - spam' }] };
      if (path.indexOf('/api/admin/players') === 0) return { players: db.players };
      if (path === '/api/admin/overview') return { counts:{ players:3, online:1, newToday:1, friendships:0, invites:0,
        saves:2, reports:1, banned:1, banRequests:1 }, recent:[{ name:'Dave', created:now }], topGames:[{ game:'gridlock', players:2 }],
        live:[{ sub:'s1', name:'Dave', last_seen:now, playing:'gridlock.html' }, { sub:'s3', name:'Kim', last_seen:now, playing:'' }],
        liveGuests:[{ gid:'gaaaa1111', name:'Guest 1111', last_seen:now, playing:'' }],
        announce: arcade.announce, maintenance: arcade.maintenance, disabled: arcade.disabled.slice(), guestsLocked: arcade.guestsLocked };
      if (path === '/api/admin/reports') return { reports: db.reports };
      if (path === '/api/admin/game-gift') return { ok:true, sent: opts.body.target === '*' ? 5 : 1 };
      if (path === '/api/admin/gift') return { ok:true, players: opts.body.sub === '*' ? 2 : 1 };
      if (path === '/api/admin/guests') return Object.assign({ guestsLocked: arcade.guestsLocked }, gdb);
      if (path === '/api/admin/appeals') return { appeals: [
        { id: 11, who: 'u:s2', name: 'Eve', kind: 'player', text: 'I was not rude, honest', created: now, status: 'open', ban: { reason: 'rude', until: now + 864e5 } },
        { id: 10, who: 'g:gcccc3333', name: 'Guest 3333', kind: 'guest', text: 'sorry', created: now - 9e6, status: 'rejected', reply: 'no' }] };
      if (path === '/api/admin/appeal-decide') return { ok: true, note: '' };
      if (path === '/api/admin/featured') { arcade.featured = opts.body.file || null; return { ok: true, featured: arcade.featured }; }
      if (path.indexOf('/api/admin/stats') === 0) return { totals: { players: 4, guests: 7 },
        days: Array.from({ length: 30 }, (_, i) => ({ day: '2026-09-' + String(i + 1).padStart(2, '0'), players: i % 4, guests: i % 3, signups: i % 2 })) };
      if (path === '/api/admin/ban-requests') return { requests: [
        { id: 7, who: 'u:s2', name: 'Eve', kind: 'player', reason: 'spamming invites', hours: 24, by_name: 'Kim', created: now, status: 'open' },
        { id: 6, who: 'g:gcccc3333', name: 'Guest 3333', kind: 'guest', reason: '', hours: 6, by_name: 'Kim', created: now - 9e6, status: 'denied' }] };
      if (path === '/api/admin/ban-decide') return { ok: true };
      if (path === '/api/admin/ban' || path === '/api/admin/guest-ban') return lastState.isMod && opts.body.banned ? { ok: true, pending: true } : { ok: true };
      if (path.indexOf('/api/admin/view') === 0) {
        const tg = decodeURIComponent(path.split('target=')[1] || '');
        return tg.indexOf('g:') === 0
          ? { now, who:{ kind:'guest', gid:'gaaaa1111', name:'Guest 1111', ip:'net:1a2b3c4d00000000', ua:'iPhone', created:now, last_seen:now - 5e6, online:false, playing:null } }
          : { now, who:{ kind:'player', sub:'s1', name:'Dave', real_name:'Dave Smith', email:'d@x.com', code:'AAAA', created:now, last_seen:now, online:true, playing:'gridlock.html',
                ip:'net:1a2b3c4d00000000', ua:'Windows PC', friends:1, saves:2, reports:0, tos_version:'2026-10-07', tos_at:now } };
      }
      if (path === '/api/admin/kick') return { ok:true, kicked: opts.body.target === '*' ? 3 : 1 };
      if (path === '/api/admin/popup') return { ok:true, sent: opts.body.target === '*' ? 3 : 1 };
      if (path === '/api/admin/games') { arcade.disabled = opts.body.disabled; return { ok:true, disabled: arcade.disabled }; }
      if (path === '/api/admin/guests-lock') { arcade.guestsLocked = opts.body.on; return { ok:true }; }
      return { ok:true };
    };
    // Native dialogs must never be used - a suppressed prompt() silently cancels.
    window.prompt = window.confirm = window.alert = m => { dialogs.push('NATIVE ' + m); return null; };
    const answer = async (text) => {
      const i = $('adm-ask-in'); if (i && text != null) i.value = text;
      await click('[data-act="askyes"]');
    };
    const click = async sel => { const el = document.querySelector('#adm-body ' + sel); if (el) el.click(); await wait(); await wait(); return !!el; };
    const bodyHas = re => re.test($('adm-body').textContent);
    const post = p => sent.filter(s => s.path === p).pop();
    const alerts = () => dialogs.filter(d => /^NATIVE/.test(d));

    currentUser = { sub:'me', name:'Owner', email:'o@x.com' };
    lastState.isOwner = true;
    await new Promise(r => setTimeout(r, 1600));      // let the owner poll notice
    t('the sidebar gets an owner item', !!$('adm-nav-item'));
    open(); await wait(); await wait();
    t('overview loads its counts', bodyHas(/Online now/) && bodyHas(/gridlock/));
    t('the owner sees waiting ban requests', !!document.querySelector('#adm-body [data-act="goreports"]') && bodyHas(/1 ban request from moderators/));
    t('refresh reloads the overview', await click('[data-act="reload"]') && bodyHas(/Players/));
    t('live now shows who is playing what', bodyHas(/LIVE NOW · 3/) && bodyHas(/playing .*Gridlock/i) && bodyHas(/in the hub/));
    sent.length = 0;
    await click('[data-act="msg"][data-sub="s1"]');
    await answer('');
    t('an empty message is refused', !post('/api/admin/gift') && /Type a message/.test(($('adm-notice') || {}).textContent || ''));
    await click('[data-act="msg"][data-sub="s1"]');
    await answer('gg');
    t('message sends a note-only gift', post('/api/admin/gift') && post('/api/admin/gift').body.note === 'gg' && !post('/api/admin/gift').body.tokens);

    tab = 'players'; render(); await wait(); await wait();
    t('players are listed', bodyHas(/Dave/) && bodyHas(/Eve/));
    t('pending gifts show on the row', bodyHas(/1 gift waiting/));
    t('a timed ban shows its end', bodyHas(/banned until/));
    t('the row shows the game being played', bodyHas(/▶ .*Gridlock/i));
    t('you get no ban button on yourself', !document.querySelector('#adm-body [data-act="ban"][data-sub="me"]'));
    sent.length = 0;
    await click('[data-act="ban"][data-sub="s1"]');
    t('ban asks in the panel, not a pop-up', !!$('adm-ask-in') && /Ban Dave/.test($('adm-ask').textContent) && !post('/api/admin/ban'));
    $('adm-ask-sel').value = '24';
    await answer('spam');
    t('a ban can be timed', post('/api/admin/ban') && post('/api/admin/ban').body.hours === 24 && /for 1 day/.test(($('adm-notice') || {}).textContent || ''));
    t('ban posts the player and reason', post('/api/admin/ban') && post('/api/admin/ban').body.sub === 's1' &&
      post('/api/admin/ban').body.banned === true && post('/api/admin/ban').body.reason === 'spam');
    await click('[data-act="unban"][data-sub="s2"]');
    t('unban clears the flag', post('/api/admin/ban').body.sub === 's2' && post('/api/admin/ban').body.banned === false);
    t('the result shows in the panel', /unbanned/.test(($('adm-notice') || {}).textContent || ''));
    await click('[data-act="ban"][data-sub="s1"]');
    sent.length = 0;
    await click('[data-act="askno"]');
    t('cancel sends nothing', !post('/api/admin/ban') && !$('adm-ask'));
    await click('[data-act="del"][data-sub="s1"]');
    t('delete asks first', !post('/api/admin/delete') && !!$('adm-ask'));
    await answer();
    t('delete confirms and posts', post('/api/admin/delete') && post('/api/admin/delete').body.sub === 's1');

    await click('[data-act="give"][data-sub="s1"]');
    t('give opens the gift form for that player', bodyHas(/GIFT → Dave/));
    await click('[data-act="gtok"][data-n="1000"]');
    t('a preset fills the amount', $('adm-gtok').value === '1000');
    const gbox = document.querySelector('#adm-body input[name="g"]'), ibox = document.querySelector('#adm-body input[name="i"]');
    if (gbox) gbox.checked = true;
    if (ibox) ibox.checked = true;
    $('adm-gnote').value = 'nice';
    await click('[data-act="giftsend"]');
    const gift = post('/api/admin/gift');
    t('the gift carries tokens, a game, icons and the note', gift && gift.body.sub === 's1' && gift.body.tokens === 1000 &&
      gift.body.games.length === (gbox ? 1 : 0) && (!ibox || gift.body.icons.length > 0) && gift.body.note === 'nice');
    t('sending closes the form', !bodyHas(/GIFT →/));
    t('the Players list has an energy button', !!document.querySelector('#adm-body [data-act="energy"][data-target="u:s1"]'));
    sent.length = 0;
    await click('[data-act="give"][data-sub="s1"]');
    await click('[data-act="genergy"][data-n="1b"]');
    $('adm-gnote').value = 'enjoy';
    await click('[data-act="giftsend"]');
    t('energy alone from the Give form sends only energy', !post('/api/admin/gift') && post('/api/admin/game-gift') &&
      post('/api/admin/game-gift').body.target === 'u:s1' && post('/api/admin/game-gift').body.amount === 1e9 && post('/api/admin/game-gift').body.note === 'enjoy');
    await click('[data-act="give"][data-sub="s1"]');
    $('adm-genergy').value = 'heaps';
    sent.length = 0;
    await click('[data-act="giftsend"]');
    t('a bad energy amount is refused', !post('/api/admin/game-gift') && bodyHas(/doesn't read right/));
    await click('[data-act="giftcancel"]');
    await click('[data-act="give"][data-sub="*"]');
    $('adm-gtok').value = '0';
    sent.length = 0;
    await click('[data-act="giftsend"]');
    t('an empty gift is refused', !post('/api/admin/gift') && bodyHas(/Nothing to give/));
    $('adm-gtok').value = '50';
    await click('[data-act="giftsend"]');
    await answer();
    t('give everyone posts sub *', post('/api/admin/gift') && post('/api/admin/gift').body.sub === '*');
    await click('[data-act="give"][data-sub="s1"]');
    await click('[data-act="giftcancel"]');
    t('cancel closes the gift form', !bodyHas(/GIFT →/) && bodyHas(/Dave/));

    // Reports, opened cold: the player list has never been fetched this session.
    players = null; tab = 'reports'; render(); await wait(); await wait();
    t('reports are listed', bodyHas(/cheating/));
    players = null; sent.length = 0; dialogs.length = 0;
    await click('[data-act="ban"][data-sub="s1"]');
    t('and names the reported player', /Ban Dave/.test(($('adm-ask') || {}).textContent || ''));
    await answer('');
    t('ban from reports works with no player list loaded', post('/api/admin/ban') && post('/api/admin/ban').body.sub === 's1' && !alerts().length);
    reports = null; render(); await wait(); await wait();
    t('moderators\' ban requests are listed for the owner', bodyHas(/BAN REQUESTS FROM MODERATORS · 1 waiting/) && bodyHas(/Kim asked for a 1 day ban/) &&
      bodyHas(/spamming invites/) && !!document.querySelector('[data-act="breq"][data-id="7"][data-ok="1"]'));
    t('answered requests show how they ended', bodyHas(/denied/) && !document.querySelector('[data-act="breq"][data-id="6"]'));
    sent.length = 0;
    await click('[data-act="breq"][data-id="7"][data-ok="1"]');
    t('approving asks first', /Approve the ban on Eve/.test(($('adm-ask') || {}).textContent || ''));
    await answer();
    t('then approves it on the server', post('/api/admin/ban-decide') && post('/api/admin/ban-decide').body.id === 7 && post('/api/admin/ban-decide').body.approve === true);
    reports = null; render(); await wait(); await wait(); sent.length = 0;
    await click('[data-act="breq"][data-id="7"][data-ok="0"]'); await answer();
    t('or denies it', post('/api/admin/ban-decide') && post('/api/admin/ban-decide').body.approve === false);
    await click('[data-act="dismiss"]');
    t('dismiss posts the report id', post('/api/admin/dismiss-report') && post('/api/admin/dismiss-report').body.id === '7');

    // ── Arcade tab ──
    overview = null; tab = 'arcade'; render(); await wait(); await wait();
    t('arcade tab shows no announcement yet', bodyHas(/No announcement up/));
    sent.length = 0;
    await click('[data-act="announce"]');
    t('an empty announcement is refused', !post('/api/admin/announce'));
    $('adm-an-text').value = 'Double tokens!'; $('adm-an-tone').value = 'party'; $('adm-an-hours').value = '24';
    await click('[data-act="announce"]'); await wait();
    const an = post('/api/admin/announce');
    t('posting sends text, tone and duration', an && an.body.text === 'Double tokens!' && an.body.tone === 'party' && an.body.hours === 24);
    t('and it shows as live', bodyHas(/Double tokens!/) && !!document.querySelector('#adm-body [data-act="annoff"]'));
    await click('[data-act="annoff"]'); await wait();
    t('take down clears it', post('/api/admin/announce').body.text === '' && bodyHas(/No announcement up/));
    $('adm-mt-text').value = 'back at 5';
    await click('[data-act="mainon"]');
    t('closing the arcade asks first', !post('/api/admin/maintenance') && !!$('adm-ask'));
    await answer(); await wait(); await wait();
    t('then closes it with the message', post('/api/admin/maintenance') && post('/api/admin/maintenance').body.on === true &&
      post('/api/admin/maintenance').body.text === 'back at 5');
    t('the tab shows it is on', bodyHas(/ON since/) && !!document.querySelector('#adm-body [data-act="mainoff"]'));
    tab = 'overview'; render(); await wait(); await wait();
    t('the overview warns maintenance is on', bodyHas(/Maintenance mode is ON/));
    await click('[data-act="goarcade"]');
    t('and links to the arcade tab', tab === 'arcade');
    await click('[data-act="mainoff"]'); await wait();
    t('reopen turns it off', post('/api/admin/maintenance').body.on === false && bodyHas(/Currently off/));

    // ── kicks + pop-ups from the overview ──
    tab = 'overview'; overview = null; render(); await wait(); await wait();
    t('live guests are listed', bodyHas(/Guest 1111/) && bodyHas(/Guests online/));
    sent.length = 0;
    await click('[data-act="kick"][data-target="u:s1"]');
    t('kick asks first', !post('/api/admin/kick') && /Kick Dave/.test(($('adm-ask') || {}).textContent || ''));
    await answer('lag'); await wait();
    t('kick posts the target and reason', post('/api/admin/kick') && post('/api/admin/kick').body.target === 'u:s1' && post('/api/admin/kick').body.reason === 'lag');
    tab = 'overview'; overview = null; render(); await wait(); await wait();
    await click('[data-act="kick"][data-target="g:gaaaa1111"]'); await answer(''); await wait();
    t('a guest can be kicked', post('/api/admin/kick').body.target === 'g:gaaaa1111');
    tab = 'overview'; overview = null; render(); await wait(); await wait();
    await click('[data-act="kickall"]'); await answer(''); await wait();
    t('kick everyone posts *', post('/api/admin/kick').body.target === '*' && /Kicked 3/.test(($('adm-notice') || {}).textContent || ''));
    tab = 'overview'; overview = null; render(); await wait(); await wait();
    await click('[data-act="pop"][data-target="g:gaaaa1111"]'); await answer('hi there'); await wait();
    t('a guest gets a pop-up', post('/api/admin/popup') && post('/api/admin/popup').body.target === 'g:gaaaa1111' && post('/api/admin/popup').body.text === 'hi there');
    tab = 'overview'; overview = null; render(); await wait(); await wait();
    await click('[data-act="popall"]'); await answer('brb'); await wait();
    t('message everyone posts *', post('/api/admin/popup').body.target === '*');
    tab = 'overview'; overview = null; render(); await wait(); await wait();
    await click('[data-act="energy"][data-target="g:gaaaa1111"]'); await answer('2.5m'); await wait();
    t('a guest gets Idle Universe energy', post('/api/admin/game-gift') && post('/api/admin/game-gift').body.target === 'g:gaaaa1111' &&
      post('/api/admin/game-gift').body.amount === 2.5e6 && post('/api/admin/game-gift').body.game === 'idle-universe.html');
    tab = 'overview'; overview = null; render(); await wait(); await wait();
    await click('[data-act="energy"][data-target="u:s1"]'); await answer('1e15'); await wait();
    t('a player gets energy', post('/api/admin/game-gift').body.target === 'u:s1' && post('/api/admin/game-gift').body.amount === 1e15);
    tab = 'overview'; overview = null; render(); await wait(); await wait();
    await click('[data-act="energyall"]'); await answer('3t'); await wait();
    t('energy to everyone posts *', post('/api/admin/game-gift').body.target === '*' && post('/api/admin/game-gift').body.amount === 3e12);
    t('energy amounts parse', parseEnergy('5,000') === 5000 && parseEnergy('1b') === 1e9 && !parseEnergy('lots') && !parseEnergy('-5'));

    // ── 👁 View ──
    tab = 'players'; players = null; render(); await wait(); await wait();
    t('every player row has a View button', !!document.querySelector('#adm-body .adm-btn.view[data-target="u:s1"]'));
    await click('.adm-btn.view[data-target="u:s1"]'); await wait();
    t('View shows what they are doing right now', bodyHas(/RIGHT NOW/) && bodyHas(/Playing .*Gridlock/i));
    t('with their details', bodyHas(/Windows PC/) && bodyHas(/1A2B-3C4D/) && bodyHas(/Dave Smith/) && bodyHas(/d@x\.com/) && bodyHas(/agreed \(2026-10-07\)/));
    t('but no play history or play time', !bodyHas(/BEEN DOING/) && !bodyHas(/MOST PLAYED/) && !bodyHas(/for \d+m/));
    sent.length = 0;
    await click('[data-act="kick"][data-target="u:s1"]'); await answer('afk'); await wait(); await wait();
    t('you can kick from the View panel', post('/api/admin/kick') && post('/api/admin/kick').body.target === 'u:s1' && bodyHas(/RIGHT NOW/));
    await click('[data-act="unview"]');
    t('Back returns to the list', bodyHas(/Eve/) && !bodyHas(/RIGHT NOW/));
    await click('.adm-av[data-target="u:s1"]'); await wait();
    t('clicking the player icon opens View too', bodyHas(/RIGHT NOW/));
    tab = 'guests'; viewing = null; guests = null; render(); await wait(); await wait();
    await click('.adm-btn.view[data-target="g:gaaaa1111"]'); await wait();
    t('guests can be viewed', bodyHas(/Guest 1111/) && bodyHas(/Offline/) && bodyHas(/iPhone/));
    t('switching tabs leaves View', ($('adm-tabs').querySelector('[data-tab="players"]').click(), !bodyHas(/RIGHT NOW/)));

    // ── Guests tab ──
    tab = 'guests'; guests = null; render(); await wait(); await wait();
    t('guests are listed with device and network code', bodyHas(/Guest 1111/) && bodyHas(/iPhone/) && bodyHas(/1A2B-3C4D/) && !bodyHas(/net:/));
    t('a shared network is pointed out', bodyHas(/same network as: Dave/) && bodyHas(/your network/));
    t('network bans are listed by code', bodyHas(/6B6B-6B6B/) && bodyHas(/raid/) && bodyHas(/never stored/));
    sent.length = 0;
    await click('[data-act="gban"][data-gid="gaaaa1111"]');
    t('guest ban asks first', !post('/api/admin/guest-ban') && !!$('adm-ask-sel'));
    $('adm-ask-sel').value = '24ip';
    await answer('spam'); await wait();
    const gb = post('/api/admin/guest-ban');
    t('guest ban can take the network too', gb && gb.body.gid === 'gaaaa1111' && gb.body.banned === true && gb.body.ip === true && gb.body.hours === 24 && gb.body.reason === 'spam');
    await wait(); await wait();
    await click('[data-act="gban"][data-gid="gbbbb2222"]');
    t('a guest on your own network can only be device-banned', ![...$('adm-ask-sel').options].some(o => /ip$/.test(o.value)));
    await click('[data-act="askno"]');
    await click('[data-act="gunban"][data-gid="gcccc3333"]'); await wait();
    t('guest unban posts', post('/api/admin/guest-ban').body.gid === 'gcccc3333' && post('/api/admin/guest-ban').body.banned === false);
    await wait(); await wait();
    await click('[data-act="glabel"][data-gid="gaaaa1111"]'); await answer('Sam'); await wait();
    t('a guest can be named', post('/api/admin/guest-label') && post('/api/admin/guest-label').body.label === 'Sam');
    await wait(); await wait();
    $('adm-ip').value = '7.7.7.7';
    await click('[data-act="ipban"]'); await answer('raid'); await wait();
    t('an IP can be banned by hand', post('/api/admin/ip-ban') && post('/api/admin/ip-ban').body.ip === '7.7.7.7' && post('/api/admin/ip-ban').body.banned === true);
    await wait(); await wait();
    await click('[data-act="ipunban"][data-ip="net:6b6b6b6b00000000"]'); await wait();
    t('a network ban can be lifted', post('/api/admin/ip-ban').body.ip === 'net:6b6b6b6b00000000' && post('/api/admin/ip-ban').body.banned === false);
    await wait(); await wait();
    await click('[data-act="guestlock"][data-on="1"]');
    t('turning guest play off asks first', !post('/api/admin/guests-lock') && !!$('adm-ask'));
    await answer(); await wait(); await wait();
    t('then switches it off', post('/api/admin/guests-lock') && post('/api/admin/guests-lock').body.on === true && bodyHas(/Guest play is OFF/));
    await click('[data-act="guestlock"][data-on="0"]'); await wait(); await wait();
    t('and back on', post('/api/admin/guests-lock').body.on === false);

    // ── Arcade tab: reload + game switches ──
    tab = 'arcade'; overview = null; render(); await wait(); await wait();
    await click('[data-act="reloadall"]');
    t('reload everyone asks first', !post('/api/admin/reload-all') && !!$('adm-ask'));
    await answer(); await wait();
    t('then posts', !!post('/api/admin/reload-all'));
    tab = 'arcade'; overview = null; render(); await wait(); await wait();
    const g0 = GAMES[0].file;
    await click('[data-act="gametoggle"][data-file="' + g0 + '"]'); await wait();
    t('a game can be switched off', post('/api/admin/games') && post('/api/admin/games').body.disabled.indexOf(g0) !== -1 && bodyHas(/1 switched off/));
    await click('[data-act="gametoggle"][data-file="' + g0 + '"]'); await wait();
    t('and back on', post('/api/admin/games').body.disabled.indexOf(g0) === -1);
    await click('[data-act="gametoggle"][data-file="' + g0 + '"]'); await wait();
    await click('[data-act="allon"]'); await wait();
    t('switch all back on clears the list', post('/api/admin/games').body.disabled.length === 0);

    // ── Appeals ──
    tab = 'appeals'; appeals = null; render(); await wait(); await wait();
    t('appeals are listed with what they said', bodyHas(/I was not rude, honest/) && bodyHas(/WAITING · 1/) && bodyHas(/banned until/));
    t('answered appeals show the reply', bodyHas(/reply: “no”/));
    sent.length = 0;
    await click('[data-act="appeal"][data-ok="1"]');
    t('unbanning from an appeal asks first', !post('/api/admin/appeal-decide') && /Unban Eve/.test(($('adm-ask') || {}).textContent || ''));
    await answer('ok be nice'); await wait();
    t('then answers it with the reply', post('/api/admin/appeal-decide') && post('/api/admin/appeal-decide').body.accept === true &&
      post('/api/admin/appeal-decide').body.reply === 'ok be nice' && post('/api/admin/appeal-decide').body.id === 11);
    await wait(); await wait();
    await click('[data-act="appeal"][data-ok="0"]'); await answer(''); await wait();
    t('keeping the ban answers no', post('/api/admin/appeal-decide').body.accept === false);

    // ── Stats ──
    tab = 'stats'; stats = null; render(); await wait(); await wait();
    t('stats are head counts only: two charts, no play time or games', bodyHas(/Players · 30d/) && bodyHas(/Visitors today/) &&
      $('adm-body').querySelectorAll('svg').length === 2 && !bodyHas(/MOST PLAYED/) && !bodyHas(/Hours played/) && !bodyHas(/BUSIEST/));
    t('the bars carry their numbers', !!$('adm-body').querySelector('svg title') && /players,/.test($('adm-body').querySelector('svg title').textContent));

    // ── Featured + mods ──
    tab = 'arcade'; overview = null; render(); await wait(); await wait();
    $('adm-feat').value = 'gridlock.html';
    sent.length = 0;
    await click('[data-act="feature"]'); await wait();
    t('the featured game can be picked', post('/api/admin/featured') && post('/api/admin/featured').body.file === 'gridlock.html' && /Featured: .*Gridlock/i.test(($('adm-notice') || {}).textContent || ''));
    tab = 'players'; players = null; render(); await wait(); await wait();
    await click('[data-act="setmod"][data-sub="s1"]');
    t('making a mod explains what they can do', /never see real names, emails/.test(($('adm-ask') || {}).textContent || ''));
    await answer(); await wait();
    t('then sets the role', post('/api/admin/set-mod') && post('/api/admin/set-mod').body.sub === 's1' && post('/api/admin/set-mod').body.on === true);

    // ── moderator mode ──
    lastState.isOwner = false; lastState.isMod = true; await new Promise(r => setTimeout(r, 1600));
    tab = 'players'; players = null; render(); await wait(); await wait();
    const tabNames = [...$('adm-tabs').querySelectorAll('.adm-tab')].map(b => b.dataset.tab).join();
    t('mods get the people tabs only', tabNames === 'overview,players,guests,reports,appeals,log');
    t('the sidebar says Mod Console', /Mod Console/.test(($('adm-nav-item') || {}).textContent || ''));
    t('mods get no Give, Delete or Make-mod', !document.querySelector('#adm-body [data-act="give"]') && !document.querySelector('#adm-body [data-act="del"]') &&
      !document.querySelector('#adm-body [data-act="setmod"]'));
    t('mods get "Ask to ban", never Unban', bodyHas(/Ask to ban/) && !document.querySelector('#adm-body [data-act="unban"]'));
    await click('[data-act="ban"][data-sub="s1"]');
    t('mod bans top out at a day', ![...$('adm-ask-sel').options].some(o => o.value === '0' || +o.value > 24));
    t('and are only a request to the owner', /Ask the owner to ban/.test(($('adm-ask') || {}).textContent || ''));
    sent.length = 0; await answer('rude'); await wait();
    t('the request goes to the server and the mod is told it waits for the owner', post('/api/admin/ban') && post('/api/admin/ban').body.sub === 's1' &&
      bodyHas(/Sent to the owner/));
    sent.length = 0;
    await click('[data-act="pop"][data-target="u:s1"]'); await answer('hey'); await wait();
    t('mods message by pop-up, not gift', post('/api/admin/popup') && !post('/api/admin/gift'));
    t('mods get no energy gifts', !document.querySelector('#adm-body [data-act="energy"]') && !document.querySelector('#adm-body [data-act="energyall"]'));
    tab = 'players'; players = null; viewing = null; render(); await wait(); await wait();
    await click('.adm-btn.view[data-target="u:s1"]'); await wait();
    t('a mod\'s View has no real name, email, network, device or history', !bodyHas(/Dave Smith/) && !bodyHas(/d@x\.com/) &&
      !bodyHas(/1A2B-3C4D/) && !bodyHas(/Windows PC/) && bodyHas(/friend code AAAA/));
    viewing = null; watch = null;
    tab = 'guests'; guests = null; render(); await wait(); await wait();
    t('a mod\'s guest list has no device or network', !bodyHas(/1A2B-3C4D/) && !bodyHas(/iPhone/));
    t('mods see no network bans or guest-play switch', !bodyHas(/NETWORK BANS/) && !document.querySelector('#adm-body [data-act="guestlock"]'));
    await click('[data-act="gban"][data-gid="gaaaa1111"]');
    t('mods can only ban a guest device for a day', ![...$('adm-ask-sel').options].some(o => /ip$/.test(o.value) || o.value === '0'));
    await click('[data-act="askno"]');
    tab = 'reports'; reports = null; render(); await wait(); await wait();
    t('mods see ban requests but can\'t approve them', bodyHas(/BAN REQUESTS FROM MODERATORS/) && bodyHas(/wait here until the owner/) &&
      !document.querySelector('[data-act="breq"]'));
    tab = 'appeals'; appeals = null; render(); await wait(); await wait();
    t('mods can turn appeals down but not unban', !!document.querySelector('[data-act="appeal"][data-ok="0"]') &&
      !document.querySelector('[data-act="appeal"][data-ok="1"]') && bodyHas(/Only the owner can lift a ban/));
    tab = 'stats'; render();
    t('mods cannot open owner tabs', tab === 'overview');
    lastState.isMod = false; lastState.isOwner = true; await new Promise(r => setTimeout(r, 1600));

    // ── Log tab ──
    tab = 'log'; logRows = null; render(); await wait(); await wait();
    t('the log lists owner actions', bodyHas(/for 24h - spam/) && bodyHas(/Dave/));

    tab = 'god'; render(); await wait();
    if (hasTokens()) {
      const was = tokens(), K = tokKeys(), snap = {};
      Object.keys(K).forEach(k => snap[k] = localStorage.getItem(K[k]));
      setTokens(10);
      await click('[data-act="tok"][data-n="100"]');
      t('+100 adds', tokens() === 110);
      await click('[data-act="tokset"]'); await answer('777');
      t('set exact sets the balance', tokens() === 777);
      await click('[data-act="tokset"]'); await answer('rubbish');
      t('set exact with rubbish zeroes rather than NaN', tokens() === 0);
      await click('[data-act="tok"][data-n="1000"]');
      await click('[data-act="tokzero"]');
      t('zero it zeroes', tokens() === 0);
      await click('[data-act="unlockgames"]');
      t('unlock every game', GAMES.filter(g => g.price).every(g => isOwned(g.file)));
      await click('[data-act="unlockicons"]');
      t('unlock every icon', Object.keys(ICON_BY_ID).every(id => iconsOwned().indexOf(id) !== -1));
      setTokens(500);
      await click('[data-act="wipeecon"]'); await answer();
      t('reset economy leaves 0 and relocks', tokens() === 0 && GAMES.filter(g => g.price).every(g => !isOwned(g.file)));
      Object.keys(K).forEach(k => snap[k] === null ? localStorage.removeItem(K[k]) : localStorage.setItem(K[k], snap[k]));
      void was;
    }

    tab = 'dev'; render(); await wait();
    t('dev lists games to jump to', document.querySelectorAll('#adm-jump option').length === GAMES.length);
    await click('[data-act="refresh"]');
    t('force refresh does not throw', !alerts().length);

    lastState.isOwner = false; await new Promise(r => setTimeout(r, 1600));
    tab = 'players'; render(); await wait();
    t('a non-owner sees the claim/owner panel instead', !bodyHas(/Dave/));
    // a server error lands in the panel instead of an alert
    const realApi = window.api;
    window.api = async () => { const e = new Error('not the owner'); e.status = 403; throw e; };
    lastState.isOwner = true; await new Promise(r => setTimeout(r, 1600));
    tab = 'players'; players = []; render(); await wait();
    db.players = []; await click('[data-act="reload"]');
    window.api = realApi;
    t('a server error shows in the panel', /not the owner/.test($('adm-body').textContent));
    t('no native pop-up was ever used', !alerts().length || (lines.push('   native: ' + alerts().join(' | ')), false));

    close();
    const out = document.createElement('pre');
    out.id = 'smokeout';
    out.textContent = lines.join('\n') + '\n\nSMOKE ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail);
    document.body.appendChild(out);
    document.title = 'SMOKE ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail);
  }, 600));
})();
