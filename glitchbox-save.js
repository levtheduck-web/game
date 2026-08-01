/* ==========================================================================
   GLITCHBOX — shared save/continue system  (signed-in players only)
   --------------------------------------------------------------------------
   Load this in a game's <head> — NOT deferred, and NOT at the bottom:
       <script src="glitchbox-save.js"></script>
   It must execute before the game's own inline script so that `GBSave` already
   exists when that script registers. (Nothing here touches the DOM until
   DOMContentLoaded, so running early is safe.)

   Then, inside the game's own script, tell it how to snapshot itself:

       GBSave.register({
         save: function () { return { cash: cash, day: day, grid: grid }; },
         load: function (d) { cash = d.cash; day = d.day; grid = d.grid; redraw(); },
         autosave: 30            // optional: also save every 30s
       });

   `save()` returns any JSON-able value, or null/undefined when there is
   nothing worth saving yet (title screen, run not started). `load(d)` gets
   back exactly what `save()` returned.

   Design notes:
   - Gated on sign-in, per the arcade's rules: a save belongs to a Google
     account (`glitchbox_user`, written by the hub), never to "the browser".
     Signed-out players get the button but it explains where to sign in
     instead of silently doing nothing.
   - Saves are keyed by account `sub` AND game id, so two people sharing a
     laptop never overwrite each other's colony.
   - Writes go to localStorage first (instant, always works) and are then
     mirrored to the Worker when one is deployed — so this whole file keeps
     working today and turns into cross-device sync later with no game edits.
   - Same shadow-root + fixed-position approach as glitchbox-menu.js, and it
     self-positions just outboard of that button using the same `data-pos`.
   ========================================================================== */
(function () {
  if (window.GBSave) return;                     // never inject twice

  var pos = (document.currentScript && document.currentScript.dataset.pos) || 'top-left';
  var VERSION = 1;
  var MAX_BYTES = 3 * 1024 * 1024;               // stay well inside the ~5MB origin quota

  // ── account ────────────────────────────────────────────────────────────
  // Same keys the hub (index.html) writes. Games are same-origin with it on
  // GitHub Pages, so reading them here needs no extra plumbing.
  function user() {
    try { return JSON.parse(localStorage.getItem('glitchbox_user') || 'null'); }
    catch (_) { return null; }
  }
  function session() { try { return localStorage.getItem('glitchbox_session') || ''; } catch (_) { return ''; } }

  function gameId() {
    var f = (location.pathname.split('/').pop() || 'game').replace(/\.html?$/i, '');
    return f || 'game';
  }
  function key(sub) { return 'gbsave:' + sub + ':' + gameId(); }

  // ── storage ────────────────────────────────────────────────────────────
  function readLocal(sub) {
    try {
      var raw = localStorage.getItem(key(sub));
      if (!raw) return null;
      var box = JSON.parse(raw);
      return box && box.data !== undefined ? box : null;
    } catch (_) { return null; }
  }
  function writeLocal(sub, box) {
    var raw = JSON.stringify(box);
    if (raw.length > MAX_BYTES) throw new Error('save too big (' + Math.round(raw.length / 1024) + 'KB)');
    localStorage.setItem(key(sub), raw);
  }

  // Cloud mirror — only attempted once the Worker URL is real. Every call is
  // best-effort: a dead backend must never cost someone their local save.
  function cloudOn() { return !!(window.GLITCHBOX_BACKEND_READY && session()); }
  function cloudPush(box) {
    if (!cloudOn()) return Promise.resolve(false);
    return fetch(window.GLITCHBOX_API + '/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session() },
      body: JSON.stringify({ game: gameId(), box: box })
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }
  function cloudPull() {
    if (!cloudOn()) return Promise.resolve(null);
    return fetch(window.GLITCHBOX_API + '/api/load?game=' + encodeURIComponent(gameId()), {
      headers: { Authorization: 'Bearer ' + session() }
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.box ? j.box : null; })
      .catch(function () { return null; });
  }
  function cloudDrop() {
    if (!cloudOn()) return Promise.resolve(false);
    return fetch(window.GLITCHBOX_API + '/api/save-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session() },
      body: JSON.stringify({ game: gameId() })
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  // ── the widget ─────────────────────────────────────────────────────────
  var adapter = null;      // { save, load, autosave }
  var ui = null;           // { setOpen, render, flash }
  var autosaveTimer = null;

  function build() {
    var host = document.createElement('div');
    host.id = 'glitchbox-save-host';
    // No transform/filter/contain here — any of them would make this a
    // containing block and the fixed-position child would anchor to it.
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;' +
      'z-index:2147483646;pointer-events:none;';

    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var bottom = pos.indexOf('bottom') === 0;
    var right = pos.indexOf('right') > -1;
    // Sit just outboard of the 30px MENU dot (10px inset + 30px + 8px gap).
    var vert = bottom ? 'bottom:10px;' : 'top:10px;';
    var horz = right ? 'right:48px;' : 'left:48px;';
    var popV = bottom ? 'bottom:44px;' : 'top:44px;';
    var popH = right ? 'right:0;' : 'left:0;';

    var css =
      ':host,*{box-sizing:border-box}' +
      '.wrap{position:fixed;' + vert + horz + 'pointer-events:auto;' +
        "font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;}" +
      // Rests as a transparent ring like the menu dot so it never blanks out
      // a game's own corner HUD; expands to a labelled pill on hover/focus.
      '.btn{display:flex;align-items:center;gap:0;height:30px;width:auto;max-width:30px;padding:0;' +
        'border:1px solid rgba(255,0,128,.45);border-radius:15px;background:transparent;' +
        'color:#ff4fa3;font-size:13px;line-height:1;cursor:pointer;opacity:.55;' +
        'overflow:hidden;white-space:nowrap;' +
        'transition:max-width .18s ease,opacity .18s ease,background .18s ease,' +
        'box-shadow .18s ease,padding .18s ease;}' +
      '.wrap:hover .btn{background:rgba(6,8,16,.94);border-color:rgba(255,0,128,.75);}' +
      '.btn .ico{flex:0 0 28px;text-align:center;font-size:13px;text-shadow:0 0 4px #000,0 0 8px #000;}' +
      '.btn .lbl{font-size:10px;letter-spacing:.14em;font-weight:600;opacity:0;transition:opacity .12s ease;}' +
      '.wrap:hover .btn,.btn:focus-visible{max-width:200px;opacity:1;padding-right:12px;' +
        'box-shadow:0 0 14px rgba(255,0,128,.45);}' +
      '.wrap:hover .btn .lbl,.btn:focus-visible .lbl{opacity:1}' +
      '.btn:active{transform:scale(.95)}' +
      '.btn.ok{border-color:rgba(0,255,140,.8);color:#3dffa2;opacity:1;max-width:200px;padding-right:12px}' +
      '.btn.ok .lbl{opacity:1}' +
      '@media (hover:none){.btn{max-width:200px;opacity:.7;padding-right:12px;background:rgba(6,8,16,.8)}' +
        '.btn .lbl{opacity:1}}' +
      '.pop{position:absolute;' + popV + popH + 'display:none;padding:13px;min-width:206px;' +
        'border:1px solid rgba(255,0,128,.45);border-radius:8px;background:rgba(6,8,16,.96);' +
        'box-shadow:0 8px 30px rgba(0,0,0,.7),0 0 20px rgba(255,0,128,.16);backdrop-filter:blur(4px);}' +
      '.pop.on{display:block}' +
      '.pop h4{margin:0 0 3px;font-size:10px;letter-spacing:.14em;color:#ff4fa3;font-weight:700}' +
      '.pop p{margin:0 0 11px;font-size:11px;line-height:1.5;color:#8b93b5;letter-spacing:.02em}' +
      '.pop p b{color:#d0d8f0;font-weight:600}' +
      '.pop .row{display:flex;gap:7px;flex-wrap:wrap}' +
      '.pop button,.pop a{font:inherit;font-size:10px;letter-spacing:.12em;padding:7px 12px;' +
        'border-radius:5px;cursor:pointer;border:1px solid rgba(255,0,128,.35);' +
        'background:transparent;color:#8b93b5;text-decoration:none;display:inline-block;line-height:1.3}' +
      '.pop button:hover:not(:disabled),.pop a:hover{color:#fff;border-color:rgba(255,0,128,.7)}' +
      '.pop button:disabled{opacity:.35;cursor:default}' +
      '.pop .go{background:#ff2e88;border-color:#ff2e88;color:#12040b;font-weight:700}' +
      '.pop .go:hover{box-shadow:0 0 14px rgba(255,0,128,.55);color:#12040b}' +
      '.pop .wipe{border-color:rgba(255,255,255,.14);color:#5a6288;padding:7px 10px}' +
      '.pop .note{margin:10px 0 0;font-size:10px;color:#5a6288;letter-spacing:.02em}';

    var wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML =
      '<button class="btn" type="button" title="Save your progress" aria-label="Save progress">' +
        '<span class="ico">💾</span><span class="lbl">SAVE</span>' +
      '</button>' +
      '<div class="pop" role="dialog" aria-label="Save progress"><div class="body"></div></div>';

    var style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);
    root.appendChild(wrap);

    var btn = wrap.querySelector('.btn');
    var pop = wrap.querySelector('.pop');
    var body = pop.querySelector('.body');
    var open = false;

    function setOpen(v) {
      open = v;
      pop.classList.toggle('on', v);
      if (v) render();
      // Give focus back to the page on close, or the focused button keeps
      // eating the game's arrow/space keys.
      else { try { btn.blur(); } catch (_) {} }
    }

    function flash(text, cls) {
      btn.querySelector('.lbl').textContent = text;
      btn.classList.add(cls || 'ok');
      clearTimeout(flash._t);
      flash._t = setTimeout(function () {
        btn.classList.remove('ok');
        btn.querySelector('.lbl').textContent = 'SAVE';
      }, 1800);
    }

    function render() {
      var u = user();
      if (!u) {
        body.innerHTML =
          '<h4>SIGN IN TO SAVE</h4>' +
          '<p>Saving keeps your progress tied to your Google account, so you ' +
          'can pick this run back up later.</p>' +
          '<div class="row"><a class="go" href="index.html">SIGN IN</a>' +
          '<button class="no" type="button">NOT NOW</button></div>';
        body.querySelector('.no').addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation(); setOpen(false);
        });
        return;
      }

      var existing = readLocal(u.sub);
      var name = (u.name || '').split(' ')[0] || 'player';
      var canSave = !!(adapter && adapter.save);

      body.innerHTML =
        '<h4>' + esc(name.toUpperCase()) + '’S SAVE</h4>' +
        '<p>' + (existing
          ? 'Last saved <b>' + esc(ago(existing.at)) + '</b>.'
          : (canSave ? 'No save yet for this game.' : 'This game has nothing to save.')) + '</p>' +
        '<div class="row">' +
          '<button class="go do-save" type="button"' + (canSave ? '' : ' disabled') + '>SAVE</button>' +
          '<button class="do-load" type="button"' + (existing ? '' : ' disabled') + '>CONTINUE</button>' +
          (existing ? '<button class="wipe do-wipe" type="button" title="Delete this save">✕</button>' : '') +
        '</div>' +
        (cloudOn() ? '' : '<p class="note">Saved on this device · this browser only</p>');

      body.querySelector('.do-save').addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation(); doSave(true);
      });
      body.querySelector('.do-load').addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation(); doLoad();
      });
      var w = body.querySelector('.do-wipe');
      if (w) w.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        try { localStorage.removeItem(key(u.sub)); } catch (_) {}
        cloudDrop();
        render();
      });
    }

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function doSave(fromClick) {
      var u = user();
      if (!u) { if (fromClick) setOpen(true); return false; }
      if (!adapter || !adapter.save) return false;
      var data;
      try { data = adapter.save(); } catch (err) {
        console.warn('[GBSave] save() threw:', err);
        if (fromClick) flash('SAVE FAILED');
        return false;
      }
      // A game returns null while there is genuinely nothing to keep (title
      // screen, run not begun) — don't clobber a good save with an empty one.
      if (data === null || data === undefined) {
        if (fromClick) { flash('NOTHING YET'); }
        return false;
      }
      var box = { v: VERSION, at: Date.now(), game: gameId(), data: data };
      try { writeLocal(u.sub, box); } catch (err) {
        console.warn('[GBSave] could not write save:', err);
        if (fromClick) flash('TOO BIG');
        return false;
      }
      cloudPush(box);
      if (fromClick) { flash('SAVED'); setOpen(false); }
      return true;
    }

    function doLoad() {
      var u = user();
      if (!u) return false;
      var box = readLocal(u.sub);
      if (!box || !adapter || !adapter.load) return false;
      try { adapter.load(box.data); } catch (err) {
        console.warn('[GBSave] load() threw:', err);
        flash('LOAD FAILED');
        return false;
      }
      flash('LOADED');
      setOpen(false);
      return true;
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); setOpen(!open);
    });
    // Click elsewhere dismisses. Capture phase, so it must ignore pointers
    // landing on our own UI or the popover's buttons never get their click.
    document.addEventListener('pointerdown', function (e) {
      if (!open) return;
      var path = e.composedPath ? e.composedPath() : [];
      if (e.target === host || path.indexOf(host) !== -1) return;
      setOpen(false);
    }, true);
    // Swallow pointer input so a click here never also reaches the game canvas.
    // Key events are deliberately left alone — the button holds focus after a
    // click and stopping keys would deafen the game's controls.
    ['pointerdown', 'mousedown', 'touchstart', 'wheel'].forEach(function (t) {
      wrap.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    document.addEventListener('keydown', function (e) {
      if (open && (e.key === 'Escape' || e.key === 'Esc')) {
        e.stopPropagation(); e.preventDefault(); setOpen(false);
      }
    }, true);

    (document.body || document.documentElement).appendChild(host);
    document.addEventListener('fullscreenchange', function () {
      var fs = document.fullscreenElement;
      (fs || document.body || document.documentElement).appendChild(host);
    });

    // Last-ditch save when the tab goes away. Only for games that opted into
    // autosave — otherwise an explicit SAVE is the only thing that writes.
    window.addEventListener('pagehide', function () {
      if (adapter && adapter.autosave) doSave(false);
    });

    ui = { setOpen: setOpen, render: render, flash: flash, doSave: doSave, doLoad: doLoad };
    return ui;
  }

  // ── public API ─────────────────────────────────────────────────────────
  var API = {
    /** Tell the save button how to snapshot and restore this game. */
    register: function (opts) {
      adapter = opts || null;
      if (adapter && adapter.autosave) {
        clearInterval(autosaveTimer);
        autosaveTimer = setInterval(function () {
          if (ui) ui.doSave(false);
        }, Math.max(5, adapter.autosave) * 1000);
      }
      if (ui) ui.render();
      return API;
    },
    /** True when a signed-in player has a save waiting for this game. */
    has: function () { var u = user(); return !!(u && readLocal(u.sub)); },
    /** The saved payload (what save() returned), or null. */
    peek: function () { var u = user(); var b = u && readLocal(u.sub); return b ? b.data : null; },
    /** When it was written, as ms since epoch, or 0. */
    savedAt: function () { var u = user(); var b = u && readLocal(u.sub); return b ? b.at : 0; },
    /** Save now. Returns true if something was written. */
    save: function () { return ui ? ui.doSave(false) : false; },
    /** Restore the save into the running game. Returns true on success. */
    load: function () { return ui ? ui.doLoad() : false; },
    /** The signed-in account, or null. */
    user: user,
    /** Pull a cloud save down into local storage (no-op until the Worker is live). */
    sync: function () {
      var u = user();
      if (!u) return Promise.resolve(false);
      return cloudPull().then(function (box) {
        if (!box) return false;
        var mine = readLocal(u.sub);
        if (mine && mine.at >= box.at) return false;   // local is newer — keep it
        try { writeLocal(u.sub, box); } catch (_) { return false; }
        if (ui) ui.render();
        return true;
      });
    }
  };
  window.GBSave = API;

  function start() {
    build();
    API.sync();                                  // no-op while the Worker is a placeholder

    // #savecheck — verify the button is present, topmost and clickable here.
    if (location.hash === '#savecheck') {
      setTimeout(function () {
        var host = document.getElementById('glitchbox-save-host');
        var b = host.shadowRoot.querySelector('.btn');
        var r = b.getBoundingClientRect();
        var hitTop = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === host;
        b.click();
        var popped = host.shadowRoot.querySelector('.pop').classList.contains('on');
        ui.setOpen(false);
        console.log('GBSAVE ' + (hitTop && popped ? 'OK' : 'PROBLEM') +
          ' game=' + gameId() + ' adapter=' + !!adapter +
          ' signedin=' + !!user() + ' topmost=' + hitTop + ' popover=' + popped);
      }, 700);
    }

    // #saveroundtrip — save, mutate nothing, reload the save back in and report.
    if (location.hash === '#saveroundtrip') {
      setTimeout(function () {
        var wrote = API.save();
        var read = wrote ? API.load() : false;
        console.log('GBSAVE roundtrip game=' + gameId() +
          ' signedin=' + !!user() + ' wrote=' + wrote + ' read=' + read +
          ' bytes=' + JSON.stringify(API.peek() || null).length);
      }, 1500);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
