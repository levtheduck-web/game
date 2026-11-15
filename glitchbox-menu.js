/* ==========================================================================
   GLITCHBOX - shared "quit to menu" button
   --------------------------------------------------------------------------
   Drop this into any game with:
       <script src="glitchbox-menu.js" defer></script>
   Optional corner override (default top-left):
       <script src="glitchbox-menu.js" data-pos="bottom-left" defer></script>
       positions: top-left | top-right | bottom-left | bottom-right

   Design notes:
   - Lives in a shadow root so no game's CSS (resets, `a{}` rules, `*{}`)
     can reach in and break it, and none of its CSS leaks back out.
   - Rests as a small 30px corner dot so it covers as little of the game's
     own HUD as possible; expands to a labelled pill on hover/focus.
   - Clicking asks for confirmation first - an accidental brush during a
     mouse-driven game must never throw away someone's run.
   - Re-parents itself into the fullscreen element so it survives games
     that call requestFullscreen() on their own container.

   Self-tests (load any game with these hashes):
       #menucheck  button is present, topmost and clickable
       #menuquit   drives a real MENU -> QUIT pointer sequence and navigates
   ========================================================================== */
(function () {
  if (window.__glitchboxMenu) return;            // never inject twice
  window.__glitchboxMenu = true;

  // A downloaded copy (glitchbox-download.js) sets this. There's no arcade next to
  // the file and no account, so: no ban/terms bounces, no pings, no favorites.
  var OFFLINE = window.GLITCHBOX_OFFLINE || null;
  // This script's own folder, where glitchbox-download.js lives too.
  var MENU_SRC = (document.currentScript && document.currentScript.src) || '';

  // A banned player gets bounced back to the hub, which shows them the ban screen.
  // Same key the hub writes when the server answers "banned".
  try { if (!OFFLINE && localStorage.getItem('glitchbox.banned') !== null) { location.replace('index.html'); return; } }
  catch (_) {}
  // Nobody plays until they've agreed to the current terms - signed in or guest. The
  // hub shows them, then brings you straight back here (room code and all).
  // Keep TOS_VERSION in step with index.html.
  var TOS_VERSION = '2026-10-11.1';
  try {
    var tu = JSON.parse(localStorage.getItem('glitchbox_user') || 'null');
    var tid = tu && tu.sub ? tu.sub : 'guest';
    // Newest version ever agreed on this device; anything at or past ours counts.
    var have = [localStorage.getItem('glitchbox.tos.' + tid), localStorage.getItem('glitchbox.tosv.' + tid)]
      .filter(Boolean).sort(function (a, b) { return b.localeCompare(a, undefined, { numeric: true }); })[0] || '';
    var agreed = !!have && have.localeCompare(TOS_VERSION, undefined, { numeric: true }) >= 0;
    if (!agreed && !OFFLINE && !/smoke|check|debug|menuquit/.test(location.hash)) {
      location.replace('index.html#terms:' + encodeURIComponent((location.pathname.split('/').pop() || '') + location.hash));
      return;
    }
  } catch (_) {}
  // The hub isn't open mid-game, so the game page asks the server itself - on load
  // (so a refresh catches a ban) and every few seconds after. The ping also tells
  // the owner console which game you're in, and closes the game during maintenance
  // (for everyone but the owner). Self-test hashes stay offline.
  var BAN_API = window.GLITCHBOX_API || 'https://glitchbox-api.levtheduck.workers.dev';
  var PING_GAME = OFFLINE ? OFFLINE.file : (location.pathname.split('/').pop() || '');
  // A guest has no account, so this random device id is what lets the owner see,
  // kick and ban them. Same key and format as index.html's guestId().
  function guestId() {
    try {
      var g = localStorage.getItem('glitchbox.gid') || '';
      if (!/^g[a-z0-9]{8,24}$/.test(g)) {
        g = 'g' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem('glitchbox.gid', g);
      }
      return g;
    } catch (_) { return ''; }
  }
  // Back to the hub with a reason, which the hub shows on arrival.
  function bounce(why) {
    try { localStorage.setItem('glitchbox.kicked', why || ''); } catch (_) {}
    location.replace('index.html');
  }
  // An owner message, shown over the game without pausing it.
  function popup(text) {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:min(440px,90vw);' +
      'background:#0a0d18;border:1px solid #ff0080;box-shadow:0 0 24px rgba(255,0,128,.4);color:#e8eefc;padding:12px 16px;' +
      'font:600 14px/1.4 system-ui,sans-serif;cursor:pointer';
    d.innerHTML = '<div style="color:#ff0080;font-size:11px;letter-spacing:2px;margin-bottom:4px">📨 MESSAGE FROM THE OWNER</div>';
    d.appendChild(document.createTextNode(text));
    d.title = 'Click to dismiss';
    d.onclick = function () { d.remove(); };
    (document.fullscreenElement || document.body || document.documentElement).appendChild(d);
    setTimeout(function () { d.remove(); }, 15000);
  }
  var reloadSeen = null;   // the owner's "reload everyone" stamp as of our first ping

  // Which multiplayer room this page is in, so friends can join from the hub. Every
  // relay game connects to <api>/ws?room=CODE, so watching WebSocket URLs finds it with
  // no change to any game; a #room=CODE link covers games that connected before this ran.
  var roomNow = '';
  try {
    var RealWS = window.WebSocket;
    if (RealWS && !RealWS.__gbWrapped) {
      var Wrapped = function (url, protocols) {
        var m = /[?&]room=([A-Za-z0-9]{3,8})/.exec(String(url || ''));
        var ws = protocols === undefined ? new RealWS(url) : new RealWS(url, protocols);
        if (m) {
          roomNow = m[1].toUpperCase();
          ws.addEventListener('close', function () { if (roomNow === m[1].toUpperCase()) roomNow = ''; });
        }
        return ws;
      };
      Wrapped.prototype = RealWS.prototype;
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { Wrapped[k] = RealWS[k]; });
      Wrapped.__gbWrapped = true;
      window.WebSocket = Wrapped;
    }
  } catch (_) {}
  function currentRoom() {
    if (roomNow) return roomNow;
    var m = /[#&]room=([A-Za-z0-9]{3,8})/.exec(location.hash);
    return m ? m[1].toUpperCase() : '';
  }

  // Games report a score with GLITCHBOX.score(n) - or GLITCHBOX.score(n, { low:true })
  // when lower is better (golf strokes, race times). Only counts for signed-in players;
  // the server keeps each player's best and the 🏆 Leaderboards show the top ten.
  window.GLITCHBOX = window.GLITCHBOX || {};
  window.GLITCHBOX.score = function (n, opts) {
    var s = ''; try { s = localStorage.getItem('glitchbox_session') || ''; } catch (_) {}
    if (OFFLINE || !s || !window.fetch || !isFinite(+n)) return Promise.resolve(null);
    return fetch(BAN_API + '/api/score', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s },
      body: JSON.stringify({ game: PING_GAME, score: +n, low: !!(opts && opts.low) }) })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
  };
  function banCheck() {
    var s = '';
    try { s = localStorage.getItem('glitchbox_session') || ''; } catch (_) {}
    if (OFFLINE || document.hidden || !window.fetch || /smoke|check|debug|menuquit/.test(location.hash)) return;
    var tosv = ''; try { tosv = localStorage.getItem('glitchbox.tosv.guest') || localStorage.getItem('glitchbox.tos.guest') || ''; } catch (_) {}
    fetch(BAN_API + '/api/ping?game=' + encodeURIComponent(PING_GAME) + (currentRoom() ? '&room=' + currentRoom() : '') +
          '&gid=' + guestId() + (s ? '' : '&tos=' + encodeURIComponent(tosv)),
          s ? { headers: { Authorization: 'Bearer ' + s } } : {}).then(function (r) {
      return r.json().then(function (d) {
        if (r.status === 403) {
          var m = /^banned:([\s\S]*)$/.exec((d && d.error) || '');
          if (!m) return;
          try {
            localStorage.setItem('glitchbox.banned', m[1]); localStorage.removeItem('glitchbox_session');
            // A guest/network ban is lifted by the next clean guest ping, not by /api/me.
            if (!s) localStorage.setItem('glitchbox.bannedBy', 'guest');
          } catch (_) {}
          location.replace('index.html');
          return;
        }
        if (!d) return;
        (d.messages || []).forEach(popup);
        // In-game gifts from the owner (e.g. Idle Universe energy): the game listens for these.
        (d.gameGifts || []).forEach(function (g) {
          try { window.dispatchEvent(new CustomEvent('glitchbox-gift', { detail: g })); } catch (_) {}
        });
        if (d.isOwner) return;
        if (d.kick != null) bounce(d.kick ? 'Kicked by the owner: ' + d.kick : 'The owner kicked you out of this game.');
        else if (d.maintenance) location.replace('index.html');       // the hub shows the closed sign
        else if ((d.disabled || []).indexOf(PING_GAME) !== -1) bounce('The owner switched this game off for now.');
        else if (d.guestsLocked && !s) bounce('Guest play is switched off - sign in to keep playing.');
        else if (reloadSeen === null) reloadSeen = d.reload || 0;
        else if ((d.reload || 0) > reloadSeen) location.reload();
      });
    }).catch(function () {});
  }
  banCheck();
  setInterval(banCheck, 8000);
  document.addEventListener('visibilitychange', banCheck);

  var pos = (document.currentScript && document.currentScript.dataset.pos) || 'top-left';

  // Favorites are shared with the hub (index.html): same localStorage key, same
  // shape - a JSON array of game filenames. Keep the two in step.
  var FAV_KEY = 'glitchbox.favs';
  var GAME_FILE = OFFLINE ? OFFLINE.file : (location.pathname.split('/').pop() || '');
  function favList() {
    try { var v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return v instanceof Array ? v : []; }
    catch (_) { return []; }
  }
  // Favorites are an account perk - guests get the button, but it sends them to sign in.
  function isGuest() {
    try { var u = JSON.parse(localStorage.getItem('glitchbox_user') || 'null'); return !(u && u.email); }
    catch (_) { return true; }
  }
  function isFav() { return !isGuest() && favList().indexOf(GAME_FILE) !== -1; }
  function toggleFav() {
    var l = favList(), i = l.indexOf(GAME_FILE);
    if (i === -1) l.push(GAME_FILE); else l.splice(i, 1);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(l)); } catch (_) {}
    return i === -1;
  }

  function build() {
    var host = document.createElement('div');
    host.id = 'glitchbox-menu-host';
    // Float above everything the game draws. Deliberately no `contain` and no
    // transform/filter here: either would make the host a containing block and
    // the fixed-position button inside would anchor to it instead of the
    // viewport (it ends up off-screen in games with a tall document).
    host.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;' +
      'z-index:2147483647;pointer-events:none;';

    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var vert = pos.indexOf('bottom') === 0 ? 'bottom:10px;' : 'top:10px;';
    var horz = pos.indexOf('right') > -1 ? 'right:10px;'  : 'left:10px;';
    var popV = pos.indexOf('bottom') === 0 ? 'bottom:44px;' : 'top:44px;';
    var popH = pos.indexOf('right') > -1 ? 'right:0;' : 'left:0;';

    var css =
      ':host,*{box-sizing:border-box}' +
      '.wrap{position:fixed;' + vert + horz + 'pointer-events:auto;' +
        "font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;}" +
      // At rest the button is a see-through ring: several games put a logo or a
      // status readout in this corner, and an opaque chip would blank it out.
      // The glyph carries its own dark halo so it stays legible on any backdrop.
      // width:auto + max-width so the pill sizes to its own label instead of a
      // hard-coded px value that clips under a different font.
      '.btn{display:flex;align-items:center;gap:0;height:30px;width:auto;max-width:30px;padding:0;' +
        'border:1px solid rgba(0,245,255,.45);border-radius:15px;background:transparent;' +
        'color:#00f5ff;font-size:13px;line-height:1;cursor:pointer;opacity:.55;' +
        'overflow:hidden;white-space:nowrap;' +
        'transition:max-width .18s ease,opacity .18s ease,background .18s ease,' +
        'box-shadow .18s ease,padding .18s ease;}' +
      '.wrap:hover .btn{background:rgba(6,8,16,.94);border-color:rgba(0,245,255,.75);}' +
      '.btn .ico{flex:0 0 28px;text-align:center;font-size:13px;' +
        'text-shadow:0 0 4px #000,0 0 8px #000;}' +
      '.btn .lbl{font-size:10px;letter-spacing:.14em;font-weight:600;opacity:0;' +
        'transition:opacity .12s ease;}' +
      '.wrap:hover .btn,.btn:focus-visible{max-width:200px;opacity:1;padding-right:12px;' +
        'box-shadow:0 0 14px rgba(0,245,255,.45);}' +
      '.wrap:hover .btn .lbl,.btn:focus-visible .lbl{opacity:1}' +
      '.btn:active{transform:scale(.95)}' +
      // touch devices get no hover, so keep it legible and tappable there
      '@media (hover:none){.btn{max-width:200px;opacity:.7;padding-right:12px;background:rgba(6,8,16,.8)}' +
        '.btn .lbl{opacity:1}}' +
      '.pop{position:absolute;' + popV + popH + 'display:none;padding:12px 13px;' +
        'border:1px solid rgba(0,245,255,.45);border-radius:8px;background:rgba(6,8,16,.96);' +
        'box-shadow:0 8px 30px rgba(0,0,0,.7),0 0 20px rgba(0,245,255,.16);backdrop-filter:blur(4px);}' +
      '.pop.on{display:block}' +
      '.pop p{margin:0 0 10px;font-size:11px;letter-spacing:.1em;color:#d0d8f0;white-space:nowrap}' +
      '.pop .row{display:flex;gap:7px}' +
      '.pop button,.pop a{font:inherit;font-size:10px;letter-spacing:.12em;padding:7px 12px;' +
        'border-radius:5px;cursor:pointer;border:1px solid rgba(0,245,255,.35);' +
        'background:transparent;color:#4a5580;text-decoration:none;display:inline-block;line-height:1.3}' +
      '.pop button:hover,.pop a:hover{color:#d0d8f0;border-color:rgba(0,245,255,.6)}' +
      '.pop .go{background:#00f5ff;border-color:#00f5ff;color:#04121b;font-weight:700}' +
      '.pop .go:hover{box-shadow:0 0 14px rgba(0,245,255,.55);color:#04121b}' +
      // .pop .fav outranks the generic .pop button rule above (two classes beats
      // one class + an element), so these colours actually stick
      '.pop .fav{display:flex;align-items:center;gap:7px;width:100%;margin:0 0 10px;' +
        'padding:7px 10px;border:1px solid rgba(255,230,0,.3);color:#8a7f4a;' +
        'background:transparent;text-align:left}' +
      '.pop .fav:hover{color:#ffe600;border-color:rgba(255,230,0,.6)}' +
      '.pop .fav.on{color:#ffe600;border-color:rgba(255,230,0,.6);' +
        'box-shadow:0 0 10px rgba(255,230,0,.2)}' +
      '.pop .fav .st{font-size:13px;line-height:1}' +
      '.pop .dl{display:flex;align-items:center;gap:7px;width:100%;margin:0 0 10px;padding:7px 10px;text-align:left}' +
      '.pop .dl .st{font-size:13px;line-height:1}' +
      '.pop .off .fav,.pop .off .dl{display:none}';

    var wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML =
      '<button class="btn" type="button" title="Quit to GLITCHBOX menu" aria-label="Quit to menu">' +
        '<span class="ico">\u25C0</span><span class="lbl">MENU</span>' +
      '</button>' +
      '<div class="pop' + (OFFLINE ? ' off' : '') + '" role="dialog" aria-label="Game menu">' +
        // \u escapes, not literal stars: this file is loaded without a charset
        // over file://, where literal non-ASCII comes through as mojibake
        '<button class="fav" type="button"><span class="st">\u2606</span>' +
          '<span class="ft">FAVORITE</span></button>' +
        // keep a copy of the game: packed into one file by glitchbox-download.js
        '<button class="dl" type="button"><span class="st">\u2B07</span>' +
          '<span>DOWNLOAD</span></button>' +
        '<p>Quit to menu?</p>' +
        // a real link, not a button: it still navigates if a game interferes
        // with scripted clicks, and supports middle/ctrl-click to open a tab
        '<div class="row"><a class="go" href="index.html">QUIT</a>' +
        '<button class="no" type="button">CANCEL</button></div>' +
      '</div>';

    var style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);
    root.appendChild(wrap);

    var pop = wrap.querySelector('.pop');
    var favBtn = wrap.querySelector('.fav');
    var open = false;

    function paintFav() {
      var on = isFav();
      favBtn.classList.toggle('on', on);
      favBtn.querySelector('.st').textContent = on ? '\u2605' : '\u2606';
      favBtn.querySelector('.ft').textContent = on ? 'FAVORITED' : 'FAVORITE';
      favBtn.setAttribute('aria-pressed', on);
    }

    function setOpen(v) {
      open = v;
      // re-read on open: another tab may have changed it since we last looked
      if (v) paintFav();
      pop.classList.toggle('on', v);
      // Hand keyboard focus back to the page when we close. A real click
      // focuses the button, and a focused button would otherwise keep
      // receiving the game's keys (arrows, space) instead of the game.
      if (!v) { try { wrap.querySelector('.btn').blur(); } catch (_) {} }
    }

    wrap.querySelector('.btn').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); setOpen(!open);
    });
    wrap.querySelector('.no').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); setOpen(false);
    });
    favBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (isGuest()) { location.href = 'index.html#signin'; return; }
      toggleFav(); paintFav();          // stays open: favoriting is not quitting
    });
    wrap.querySelector('.dl').addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      setOpen(false);
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
      // the page title's first part makes a fine name ("RHYME BOMB \u2014 Rhyme It..." -> "Rhyme Bomb")
      var nm = (document.title || '').split(/\s+[\u2014\u2013|\u00b7-]\s+/)[0].trim();
      if (nm && nm === nm.toUpperCase()) nm = nm.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      var go = function () { window.GBDownload.start(GAME_FILE, nm || undefined); };
      if (window.GBDownload) return go();
      var sc = document.createElement('script');
      sc.src = new URL('glitchbox-download.js', MENU_SRC || location.href).href;
      sc.onload = go;
      document.head.appendChild(sc);
    });
    wrap.querySelector('.go').addEventListener('click', function (e) {
      e.stopPropagation();
      // deliberately no preventDefault - the anchor's own navigation is the
      // thing that gets you home, so it works even if scripting is hampered
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
      fadeOut();
    });
    // Clicking anywhere ELSE dismisses the confirm. This must ignore pointers
    // landing on our own UI: it runs in the capture phase, so without the guard
    // it hid the popover on pointerdown and the QUIT click never landed.
    document.addEventListener('pointerdown', function (e) {
      if (!open) return;
      var path = e.composedPath ? e.composedPath() : [];
      if (e.target === host || path.indexOf(host) !== -1) return;
      setOpen(false);
    }, true);

    // Swallow pointer input so a click on the menu never also reaches the game
    // canvas underneath. Key events are deliberately NOT swallowed: the button
    // holds focus after a click, so doing so would deafen the game's controls.
    ['pointerdown', 'mousedown', 'touchstart', 'wheel'].forEach(function (t) {
      wrap.addEventListener(t, function (e) { e.stopPropagation(); });
    });

    // Escape closes the confirm - and only then, so games keep their own Esc.
    document.addEventListener('keydown', function (e) {
      if (open && (e.key === 'Escape' || e.key === 'Esc')) {
        e.stopPropagation(); e.preventDefault(); setOpen(false);
      }
    }, true);

    (document.body || document.documentElement).appendChild(host);

    // follow the game into fullscreen
    document.addEventListener('fullscreenchange', function () {
      var fs = document.fullscreenElement;
      (fs || document.body || document.documentElement).appendChild(host);
    });

    // #menuquit - end-to-end: drive a real pointer sequence through MENU then
    // QUIT and let it navigate. Catches breakage that a scripted .click() misses.
    if (location.hash === '#menuquit') {
      setTimeout(function () {
        var fire = function (el, t) {
          var r = el.getBoundingClientRect();
          var C = t.indexOf('pointer') === 0 ? PointerEvent : MouseEvent;
          el.dispatchEvent(new C(t, { bubbles: true, cancelable: true, composed: true,
            clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }));
        };
        var seq = ['pointerdown', 'mousedown', 'mouseup', 'click'];
        seq.forEach(function (t) { fire(wrap.querySelector('.btn'), t); });
        console.log('GBQUIT confirm_open=' + pop.classList.contains('on'));
        seq.forEach(function (t) { fire(wrap.querySelector('.go'), t); });
      }, 500);
    }

    // #menucheck - verify the button is present, on top and clickable in this game
    if (location.hash === '#menucheck') {
      setTimeout(function () {
        var b = wrap.querySelector('.btn').getBoundingClientRect();
        var hitTop = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === host;
        wrap.querySelector('.btn').click();
        var popped = pop.classList.contains('on');
        setOpen(false);
        console.log('GBMENU ' + (hitTop && popped ? 'OK' : 'PROBLEM') +
          ' pos=' + pos + ' rect=' + Math.round(b.left) + ',' + Math.round(b.top) +
          ' ' + Math.round(b.width) + 'x' + Math.round(b.height) +
          ' topmost=' + hitTop + ' confirm=' + popped);
      }, 600);
    }
  }

  // Quitting fades to the arcade's dark instead of a hard cut (navigation still
  // happens on its own - this only paints over the game while it does).
  function fadeOut() {
    try {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var f = document.createElement('div');
      f.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#04050a;opacity:0;transition:opacity .18s ease-in;pointer-events:none';
      (document.body || document.documentElement).appendChild(f);
      requestAnimationFrame(function () { f.style.opacity = '1'; });
    } catch (_) {}
  }

  // ── keyboard-only games on phones ── a game that can't be played without a keyboard
  // declares <meta name="glitchbox-input" content="keyboard">; on a touch-only device the
  // player gets told so, instead of a game that silently ignores every tap.
  try {
    var needs = document.querySelector('meta[name="glitchbox-input"]');
    var touchOnly = matchMedia('(pointer:coarse)').matches && !matchMedia('(any-pointer:fine)').matches;
    if (needs && /keyboard/.test(needs.content) && touchOnly && !/smoke|check/.test(location.hash)) {
      var showKb = function () {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;inset:0;z-index:2147483645;display:flex;align-items:center;justify-content:center;padding:20px;' +
          'background:rgba(5,7,14,.94);color:#d0d8f0;font:500 15px/1.5 system-ui,sans-serif;text-align:center';
        d.innerHTML = '<div style="max-width:420px"><div style="font-size:46px">⌨️</div>' +
          '<div style="font:800 20px system-ui,sans-serif;color:#00f5ff;margin:8px 0 10px">THIS GAME NEEDS A KEYBOARD</div>' +
          '<div>It\'s played with the keys, so it won\'t work on a phone or tablet on its own. Try it on a computer - or connect a keyboard.</div>' +
          '<div style="margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
          '<a href="index.html" style="padding:11px 20px;background:#00f5ff;color:#001014;font-weight:800;text-decoration:none">◀ BACK TO THE ARCADE</a>' +
          '<button style="padding:11px 16px;background:transparent;border:1px solid #3a4a6a;color:#8b95a8;font:700 14px system-ui">Try anyway</button></div></div>';
        d.querySelector('button').onclick = function () { d.remove(); };
        document.body.appendChild(d);
      };
      if (document.body) showKb(); else document.addEventListener('DOMContentLoaded', showKb);
    }
  } catch (_) {}

  // ── 3D games on devices without WebGL ── some school Chromebooks and older PCs
  // have 3D graphics switched off, and three.js games then die on a blank screen.
  // Catch that one failure and explain it instead.
  var webglShown = false;
  function webglHelp() {
    if (webglShown) return;
    webglShown = true;
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:2147483645;display:flex;align-items:center;justify-content:center;padding:20px;' +
      'background:radial-gradient(ellipse at 50% 30%,rgba(0,245,255,.12),transparent 60%),#05070e;color:#d0d8f0;font:500 15px/1.5 system-ui,sans-serif;text-align:center';
    d.innerHTML = '<div style="max-width:440px"><div style="font-size:46px">🧊</div>' +
      '<div style="font:800 20px system-ui,sans-serif;color:#00f5ff;margin:8px 0 10px;letter-spacing:.5px">THIS GAME NEEDS 3D GRAPHICS</div>' +
      '<div>Your browser has 3D graphics (WebGL) turned off, so this game can\'t start here.</div>' +
      '<div style="margin-top:10px;color:#8b95a8;font-size:13px">On Chrome: Settings → System → turn on <b>Use graphics acceleration when available</b>, then restart Chrome. ' +
      'Or try another device.</div>' +
      '<a href="index.html" style="display:inline-block;margin-top:18px;padding:11px 22px;background:#00f5ff;color:#001014;font-weight:800;text-decoration:none;letter-spacing:1px">◀ BACK TO THE ARCADE</a></div>';
    (document.body || document.documentElement).appendChild(d);
  }
  addEventListener('error', function (e) {
    var m = String((e && (e.message || (e.error && e.error.message))) || '');
    if (/webgl|WebGL context/i.test(m)) webglHelp();
  });
  // The game's own module usually runs (and fails) before this script, so also
  // check up front on any page that loads three.js.
  try {
    var usesThree = [].some.call(document.scripts, function (sc) {
      return /three/i.test(sc.src || '') || (sc.type === 'importmap' && /three/i.test(sc.textContent || ''));
    });
    if (usesThree && !/smoke|check/.test(location.hash)) {
      var tc = document.createElement('canvas');
      if (!(tc.getContext('webgl2') || tc.getContext('webgl'))) {
        if (document.body) webglHelp(); else document.addEventListener('DOMContentLoaded', webglHelp);
      }
    }
  } catch (_) {}
  addEventListener('unhandledrejection', function (e) {
    var m = String((e && e.reason && (e.reason.message || e.reason)) || '');
    if (/webgl|WebGL context/i.test(m)) webglHelp();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
