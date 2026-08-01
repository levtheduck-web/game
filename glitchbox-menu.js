/* ==========================================================================
   GLITCHBOX — shared "quit to menu" button
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
   - Clicking asks for confirmation first — an accidental brush during a
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

  var pos = (document.currentScript && document.currentScript.dataset.pos) || 'top-left';

  // Favorites are shared with the hub (index.html): same localStorage key, same
  // shape — a JSON array of game filenames. Keep the two in step.
  var FAV_KEY = 'glitchbox.favs';
  var GAME_FILE = (location.pathname.split('/').pop() || '');
  function favList() {
    try { var v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); return v instanceof Array ? v : []; }
    catch (_) { return []; }
  }
  function isFav() { return favList().indexOf(GAME_FILE) !== -1; }
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
      '.pop .fav .st{font-size:13px;line-height:1}';

    var wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML =
      '<button class="btn" type="button" title="Quit to GLITCHBOX menu" aria-label="Quit to menu">' +
        '<span class="ico">\u25C0</span><span class="lbl">MENU</span>' +
      '</button>' +
      '<div class="pop" role="dialog" aria-label="Game menu">' +
        // \u escapes, not literal stars: this file is loaded without a charset
        // over file://, where literal non-ASCII comes through as mojibake
        '<button class="fav" type="button"><span class="st">\u2606</span>' +
          '<span class="ft">FAVORITE</span></button>' +
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
      toggleFav(); paintFav();          // stays open: favoriting is not quitting
    });
    wrap.querySelector('.go').addEventListener('click', function (e) {
      e.stopPropagation();
      // deliberately no preventDefault — the anchor's own navigation is the
      // thing that gets you home, so it works even if scripting is hampered
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
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

    // Escape closes the confirm — and only then, so games keep their own Esc.
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

    // #menuquit — end-to-end: drive a real pointer sequence through MENU then
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

    // #menucheck — verify the button is present, on top and clickable in this game
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
