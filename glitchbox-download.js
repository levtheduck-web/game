/* ==========================================================================
   GLITCHBOX - download a game to keep
   --------------------------------------------------------------------------
   GBDownload.start('haymaker.html', 'Haymaker') packs the game into ONE .html
   file and saves it. Everything the game loads goes inside that file: the
   arcade's shared scripts, its sounds and models, its fonts, the world maps,
   and the three.js engine for the 3D games. Double-click the file and it
   plays, with no internet (online rooms still need a connection, of course).

   Packing happens in the browser at click time from the live files, so a
   download is always the version on the site and the repo never stores copies.

   Games that are real apps rather than web pages (APPS below) offer their
   Windows / Mac builds instead.

   How the packed file finds its files: a small script at the top of <head>
   (offlineShim) holds every packed file and answers fetch(), XMLHttpRequest
   and img/audio src for those names; <script src>, stylesheets and the
   three.js modules (through the import map) are swapped for data: URLs.
   window.GLITCHBOX_OFFLINE tells glitchbox-menu.js / glitchbox-save.js that
   they're in a downloaded copy (no ban pings, no terms bounce, local saves).

   Self-test: load any page that has this script with #dlcheck in the URL.
   ========================================================================== */
(function () {
  'use strict';
  if (window.GBDownload) return;

  // The arcade's folder (where index.html and every game live), from this script's own URL.
  var ME = (document.currentScript && document.currentScript.src) || location.href;
  var HERE = new URL('.', ME).href;

  // ── games that ship as apps ──
  var MM = 'https://github.com/glitchbox-games/glitchbox-games.github.io/releases/download/moving-mountains-1/';
  var APPS = {
    'moving-mountains.html': [
      { os: 'Windows', icon: '🪟', url: MM + 'MovingMountains-Windows.zip', size: '84 MB',
        how: 'Unzip it and run MovingMountains.exe. If Windows says it protected your PC, click More info, then Run anyway.' },
      { os: 'Mac', icon: '🍎', url: MM + 'MovingMountains-Mac.zip', size: '85 MB',
        how: 'Unzip it and open MovingMountains. The first time, macOS blocks it: go to System Settings, Privacy & Security, scroll down and click Open Anyway.' }
    ]
  };

  // Files a game builds the name of while it runs, so the scan below can't spot them.
  var EXTRA = {
    'shape-conquest.html': ['https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
                            'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json']
  };

  var MIME = { js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
    m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', glb: 'model/gltf-binary',
    gltf: 'model/gltf+json', bin: 'application/octet-stream', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', txt: 'text/plain',
    csv: 'text/csv', wasm: 'application/wasm', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };
  function mimeOf(u) {
    var m = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(u);
    return (m && MIME[m[1].toLowerCase()]) || 'application/octet-stream';
  }
  function isSite(u) { return u.indexOf(HERE) === 0; }

  // ── fetching + encoding ──
  function fetchOk(url) {
    // The arcade's own files skip the cache so a download is the newest build.
    return fetch(url, isSite(url) ? { cache: 'no-store' } : {}).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + url);
      return r;
    });
  }
  function getText(url) { return fetchOk(url).then(function (r) { return r.text(); }); }
  function getBytes(url) { return fetchOk(url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return new Uint8Array(b); }); }
  function b64(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function b64text(t) { return b64(new TextEncoder().encode(t)); }
  function jsData(t) { return 'data:text/javascript;charset=utf-8;base64,' + b64text(t); }

  // Links back to the arcade (quit buttons, "back to GLITCHBOX") would point at a
  // missing index.html next to the downloaded file, so aim them at the real site.
  function fixHome(t) { return t.replace(/(["'`]\s*)(?:\.\/)?index\.html/g, '$1' + HERE + 'index.html'); }

  // ES module import / export / import() specifiers, minified or not.
  var IMP = /(^|[^.\w$])(import|export)(\s*(?:(?:[\w$]+\s*,?\s*)?(?:\*\s*as\s+[\w$]+|\*|\{[^}]*\})?\s*from\s*)?)(["'])([^"'\n]+)\4/g;
  var DYN = /(^|[^.\w$])(import\s*\(\s*)(["'])([^"'\n]+)\3(\s*\))/g;

  // ══════════════════ PACK ONE GAME ══════════════════
  // onStep(done, total) reports progress. Resolves { html, missed: [what still needs the internet],
  // online: whether the game has online rooms }.
  async function pack(file, onStep) {
    var page = new URL(file, HERE).href;
    var html = await getText(page + '?v=' + Date.now());
    var files = {};          // shim table: key -> [mime, base64]
    var missed = [];
    var jobs = 0, done = 0;
    function track(p) { jobs++; tick(); return p.then(function (v) { done++; tick(); return v; }, function (e) { done++; tick(); throw e; }); }
    function tick() { if (onStep) onStep(done, jobs); }

    var scan = [html];       // every bit of source, searched for asset names afterwards
    var online = /WebSocket|GBHostNet|GLITCHBOX_WS/.test(html);   // has online rooms

    // ── 1. <script src> → data: URLs (attributes like defer / data-pos are kept) ──
    html = fixHome(html);
    var SCRIPT = /<script\b([^>]*?)\ssrc\s*=\s*(["'])(.*?)\2([^>]*)>\s*<\/script>/gi;
    var scripts = [], m;
    while ((m = SCRIPT.exec(html))) scripts.push({ all: m[0], pre: m[1], src: m[3], post: m[4] });
    var moduleRoots = [];    // [spec, resolvedUrl] from module scripts
    await Promise.all(scripts.map(function (s) {
      var url = new URL(s.src, page).href, mod = /type\s*=\s*["']?module/i.test(s.pre + s.post);
      if (mod) { s.mod = url; return; }
      return track(getText(url)).then(function (t) {
        if (isSite(url)) { t = fixHome(t); scan.push(t); }
        s.out = '<script' + (s.pre + s.post).replace(/\s(integrity|crossorigin)(\s*=\s*(["'])[^"']*\3)?/gi, '') +
          ' src="' + jsData(t) + '"></' + 'script>';
      }, function () { missed.push(url); });
    }));

    // ── 2. stylesheets (Google Fonts included: latin letters only) → <style> with fonts inside ──
    var LINK = /<link\b[^>]*>/gi, links = [];
    while ((m = LINK.exec(html))) {
      if (!/rel\s*=\s*["']?stylesheet/i.test(m[0])) continue;
      var h = /href\s*=\s*(["'])(.*?)\1/i.exec(m[0]);
      if (h) links.push({ all: m[0], href: h[2] });
    }
    await Promise.all(links.map(function (l) {
      var url = new URL(l.href.replace(/&amp;/g, '&'), page).href;
      return track(getText(url)).then(function (css) {
        if (/fonts\.googleapis\.com/.test(url) && /\/\*\s*latin\s*\*\//.test(css)) {
          css = (css.match(/\/\*\s*latin\s*\*\/\s*@font-face\s*\{[^}]*\}/g) || []).join('\n');
        }
        var urls = [], U = /url\(\s*(["']?)([^"')]+)\1\s*\)/g, u;
        while ((u = U.exec(css))) if (!/^data:/.test(u[2])) urls.push(u[2]);
        return Promise.all(urls.map(function (raw) {
          var abs = new URL(raw, url).href;
          return track(getBytes(abs)).then(function (b) {
            css = css.split(raw).join('data:' + mimeOf(abs) + ';base64,' + b64(b));
          }, function () { /* that one font weight stays online */ });
        })).then(function () { l.out = '<style>\n' + css + '\n</style>'; });
      }, function () { missed.push(url); });
    }));

    // ── 3. the module graph (three.js and friends) → one import map of data: URLs ──
    var mapM = /<script\b[^>]*type\s*=\s*["']?importmap["']?[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    var imap = {};
    try { imap = mapM ? (JSON.parse(mapM[1]).imports || {}) : {}; } catch (e) { imap = {}; }
    function resolve(spec, parent) {
      if (Object.prototype.hasOwnProperty.call(imap, spec)) return new URL(imap[spec], page).href;
      var best = '';
      for (var k in imap) if (k.slice(-1) === '/' && spec.indexOf(k) === 0 && k.length > best.length) best = k;
      if (best) return new URL(imap[best] + spec.slice(best.length), page).href;
      if (/^(\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i.test(spec)) return new URL(spec, parent).href;
      return null;   // a bare name nobody mapped: leave it alone
    }
    function specsIn(code, cb) {
      code.replace(IMP, function (a, p, k, mid, q, spec) { cb(spec); return a; });
      code.replace(DYN, function (a, p, k, q, spec) { cb(spec); return a; });
    }
    var INLINE_MOD = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    while ((m = INLINE_MOD.exec(html))) {
      if (!/type\s*=\s*["']?module/i.test(m[1]) || /\ssrc\s*=/i.test(m[1])) continue;
      var code = m[2];
      if (/import/.test(code)) specsIn(code, function (spec) { var u = resolve(spec, page); if (u) moduleRoots.push([spec, u]); });
    }
    scripts.forEach(function (s) { if (s.mod) moduleRoots.push([null, s.mod, s]); });

    var modText = {}, seen = {}, modFail = false;
    async function crawl(url) {
      if (seen[url]) return;
      seen[url] = 1;
      var r = await track(fetchOk(url)), base = r.url || url, src = await r.text();
      if (isSite(url)) { src = fixHome(src); scan.push(src); }
      var deps = [];
      function swap(spec) { var u = resolve(spec, base); if (u) { deps.push(u); return u; } return spec; }
      src = src.replace(IMP, function (a, p, k, mid, q, spec) { return p + k + mid + q + swap(spec) + q; })
               .replace(DYN, function (a, p, k, q, spec, e) { return p + k + q + swap(spec) + q + e; });
      modText[url] = src;
      await Promise.all(deps.map(crawl));
    }
    if (moduleRoots.length) {
      try { await Promise.all(moduleRoots.map(function (r) { return crawl(r[1]); })); }
      catch (e) { modFail = true; missed.push('the 3D engine'); }
    }
    var mapOut = null;
    if (moduleRoots.length && !modFail) {
      var data = {}, imports = {};
      Object.keys(imap).forEach(function (k) { imports[k] = imap[k]; });       // prefix fallbacks
      Object.keys(modText).forEach(function (u) { data[u] = jsData(modText[u]); imports[u] = data[u]; });
      moduleRoots.forEach(function (r) {
        if (r[0]) imports[r[0]] = data[r[1]];
        else r[2].out = '<script' + (r[2].pre + r[2].post).replace(/\s(integrity|crossorigin)(\s*=\s*(["'])[^"']*\3)?/gi, '') +
          ' src="' + data[r[1]] + '"></' + 'script>';
      });
      mapOut = '<script type="importmap">' + JSON.stringify({ imports: imports }).replace(/</g, '\\u003c') + '</' + 'script>';
    }

    // ── 4. sounds, models, server code, map data: anything the source names ──
    var want = {};
    var REL = /["'`(]\s*((?:\.\/)?(?:[\w-]+\/)*[\w.-]+\.(?:m4a|mp3|ogg|wav|glb|gltf|bin|png|jpe?g|webp|gif|svg|json|txt|csv|wasm|js))(?=[?#"'`)])/gi;
    var ABS = /https:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)\/[^\s"'`)$]+?\.json(?=[?#"'`)])/g;
    scan.forEach(function (t) {
      var a;
      while ((a = REL.exec(t))) {
        var p = a[1];
        // .js only for the arcade's own pieces (hostnet servers); anything else is a module name
        if (/\.js$/i.test(p) && !/(^|\/)[\w-]+-server\.js$/i.test(p)) continue;
        var u = new URL(p, page).href;
        if (isSite(u) && !/\.html?$/i.test(u)) want[u] = 1;
      }
      while ((a = ABS.exec(t))) want[a[0]] = 1;
    });
    (EXTRA[file] || []).forEach(function (u) { want[u] = 1; });
    await Promise.all(Object.keys(want).map(function (u) {
      return track(getBytes(u)).then(function (b) {
        var k = isSite(u) ? u.slice(HERE.length) : u;
        files[k] = [mimeOf(u), b64(b)];
      }, function () { /* named in the code but not on the site: nothing to pack */ });
    }));

    // ── 5. stitch it together ──
    scripts.forEach(function (s) { if (s.out) html = html.split(s.all).join(s.out); });
    links.forEach(function (l) { if (l.out) html = html.split(l.all).join(l.out); });
    if (mapOut) {
      if (mapM) html = html.replace(mapM[0], function () { return mapOut; });
      else html = html.replace(/<script\b[^>]*type\s*=\s*["']?module/i, function (a) { return mapOut + '\n' + a; });
    }
    var cfg = { from: HERE, file: file, saved: new Date().toISOString().slice(0, 10), files: files };
    var shim = '<meta charset="utf-8">\n<script>(' + offlineShim.toString() + ')(' +
      JSON.stringify(cfg).replace(/</g, '\\u003c') + ');</' + 'script>\n';
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, function (a) { return a + '\n' + shim; });
    else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, function (a) { return a + '\n' + shim; });
    else html = shim + html;
    var note = '<!-- Downloaded from GLITCHBOX (' + HERE + ') on ' + cfg.saved + '. Open this file in a browser to play. -->\n';
    if (/^\s*<!doctype[^>]*>/i.test(html)) html = html.replace(/^\s*<!doctype[^>]*>/i, function (a) { return a + '\n' + note; });
    else html = note + html;
    return { html: html, missed: missed, online: online };
  }

  // ══════════════════ RUNS INSIDE THE DOWNLOADED FILE ══════════════════
  // Serialised into the packed page with toString(), so it must stand alone.
  function offlineShim(cfg) {
    var F = cfg.files, from = cfg.from, bin = {}, made = {};
    window.GLITCHBOX_OFFLINE = { from: from, file: cfg.file, saved: cfg.saved };
    var dir = location.href.replace(/[?#].*$/, '').replace(/[^\/]*$/, '');
    function key(u) {
      try {
        if (u && typeof u === 'object') u = u.url || u.href || String(u);
        u = String(u);
        if (!u || /^(data|blob):/i.test(u)) return null;
        if (u.indexOf(dir) === 0) u = u.slice(dir.length);
        var k = new URL(u, from).href;
        if (k.indexOf(from) === 0) k = k.slice(from.length);
        k = k.replace(/#.*$/, '');
        if (F[k]) return k;
        k = k.replace(/\?.*$/, '');
        return F[k] ? k : null;
      } catch (e) { return null; }
    }
    function bytes(k) {
      if (!bin[k]) {
        var s = atob(F[k][1]), a = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
        bin[k] = a;
      }
      return bin[k];
    }
    function blobUrl(k) { return made[k] || (made[k] = URL.createObjectURL(new Blob([bytes(k)], { type: F[k][0] }))); }
    var realFetch = window.fetch;
    if (realFetch) window.fetch = function (input) {
      var k = key(input);
      if (k) return Promise.resolve(new Response(new Blob([bytes(k)], { type: F[k][0] }),
        { status: 200, headers: { 'Content-Type': F[k][0] } }));
      return realFetch.apply(this, arguments);
    };
    var xo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      var k = key(u), a = [].slice.call(arguments);
      if (k) a[1] = blobUrl(k);
      return xo.apply(this, a);
    };
    function hook(proto, prop) {
      var d = proto && Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.set) return;
      Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: d.get,
        set: function (v) { var k = key(v); d.set.call(this, k ? blobUrl(k) : v); } });
    }
    hook(window.HTMLImageElement && HTMLImageElement.prototype, 'src');
    hook(window.HTMLMediaElement && HTMLMediaElement.prototype, 'src');
    hook(window.HTMLSourceElement && HTMLSourceElement.prototype, 'src');
    hook(window.HTMLScriptElement && HTMLScriptElement.prototype, 'src');
    var sa = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (n, v) {
      if (/^(src|href)$/i.test(n) && /^(IMG|AUDIO|VIDEO|SOURCE|SCRIPT|LINK)$/.test(this.tagName)) {
        var k = key(v); if (k) v = blobUrl(k);
      }
      return sa.call(this, n, v);
    };
    var RA = window.Audio;
    if (RA) {
      var A = function (src) { var a = new RA(); if (src !== undefined) a.src = src; return a; };
      A.prototype = RA.prototype;
      window.Audio = A;
    }
  }

  // ══════════════════ THE DIALOG ══════════════════
  var box = null;
  function dialog() {
    if (box) return box;
    var host = document.createElement('div');
    host.id = 'glitchbox-download-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:none;';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML =
      '<style>' +
      ':host,*{box-sizing:border-box}' +
      '.bg{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;' +
        'background:rgba(3,4,10,.78);backdrop-filter:blur(3px);font:500 14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#d0d8f0}' +
      '.card{width:min(440px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#0a0d18;border:1px solid rgba(0,245,255,.45);' +
        'box-shadow:0 10px 40px rgba(0,0,0,.7),0 0 26px rgba(0,245,255,.14);padding:20px 20px 18px;' +
        'clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px))}' +
      '.k{font:700 11px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.2em;color:#00f5ff;text-shadow:0 0 8px rgba(0,245,255,.6)}' +
      'h3{margin:8px 0 6px;font-size:20px;font-weight:800;color:#fff;letter-spacing:.3px}' +
      'p{margin:6px 0;color:#9aa6c4}' +
      '.bar{height:8px;margin:14px 0 6px;background:#141a2e;overflow:hidden}' +
      '.bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#00f5ff,#ff0080);transition:width .2s}' +
      '.small{font-size:12px;color:#5d6890}' +
      '.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}' +
      'a.b,button.b{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border:1px solid rgba(0,245,255,.35);' +
        'background:transparent;color:#d0d8f0;font:700 13px system-ui,sans-serif;letter-spacing:.6px;text-decoration:none;cursor:pointer}' +
      'a.b:hover,button.b:hover{border-color:#00f5ff;color:#00f5ff}' +
      '.go{background:#00f5ff!important;color:#001014!important;border-color:#00f5ff!important}' +
      '.go:hover{box-shadow:0 0 16px rgba(0,245,255,.5)}' +
      '.app{margin-top:12px;padding:12px;border:1px solid rgba(0,245,255,.14);background:#080b14}' +
      '.app a.b{width:100%;justify-content:center}' +
      '.app p{font-size:12.5px;margin:8px 0 0}' +
      '</style><div class="bg"><div class="card" role="dialog" aria-modal="true"></div></div>';
    (document.body || document.documentElement).appendChild(host);
    var card = root.querySelector('.card');
    root.querySelector('.bg').addEventListener('pointerdown', function (e) { if (e.target === e.currentTarget) close(); });
    function close() { host.style.display = 'none'; }
    function show(htmlStr) {
      card.innerHTML = htmlStr;
      host.style.display = 'block';
      var c = card.querySelector('[data-close]');
      if (c) c.addEventListener('click', close);
      return card;
    }
    document.addEventListener('keydown', function (e) { if (host.style.display !== 'none' && e.key === 'Escape') close(); }, true);
    // the dialog has to stay visible when a game is fullscreen
    document.addEventListener('fullscreenchange', function () {
      (document.fullscreenElement || document.body || document.documentElement).appendChild(host);
    });
    box = { show: show, close: close, host: host };
    return box;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function mb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function nameOf(file) {
    var g = (window.GAMES || []).filter(function (x) { return x.file === file; })[0];
    return g ? g.name : file.replace(/\.html$/, '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  var busy = false;
  function start(file, name) {
    file = String(file || '').split(/[?#]/)[0].split('/').pop();
    name = name || nameOf(file);
    var d = dialog();
    if (APPS[file]) {
      d.show('<div class="k">⬇ DOWNLOAD</div><h3>' + esc(name) + '</h3>' +
        '<p>Get the full game for your computer. You can still play it right here in the browser too.</p>' +
        APPS[file].map(function (a) {
          return '<div class="app"><a class="b go" href="' + esc(a.url) + '" rel="noopener">' + a.icon + ' ' + esc(a.os) +
            ' <span style="font-weight:600;opacity:.7">' + esc(a.size) + '</span></a><p>' + esc(a.how) + '</p></div>';
        }).join('') +
        '<div class="row"><button class="b" data-close>Close</button></div>');
      return Promise.resolve({ app: true });
    }
    if (busy) return Promise.resolve(null);
    busy = true;
    var card = d.show('<div class="k">⬇ DOWNLOAD</div><h3>' + esc(name) + '</h3>' +
      '<p class="st">Packing the game, its sounds and its graphics into one file...</p>' +
      '<div class="bar"><i></i></div><div class="small cnt">&nbsp;</div>');
    var bar = card.querySelector('.bar i'), cnt = card.querySelector('.cnt');
    return pack(file, function (done, total) {
      bar.style.width = Math.round(100 * (done + 1) / (total + 1)) + '%';
      cnt.textContent = done + ' / ' + total + ' files';
    }).then(function (res) {
      busy = false;
      var blob = new Blob([res.html], { type: 'text/html' });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = file; a.style.display = 'none';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 60000);
      var online = res.missed.length
        ? '<p class="small">Still needs the internet for: ' + esc(res.missed.map(function (u) {
            return /^https?:/.test(u) ? new URL(u).hostname : u; }).join(', ')) + '.</p>' : '';
      d.show('<div class="k">⬇ DOWNLOADED</div><h3>' + esc(name) + '</h3>' +
        '<p>Saved <b style="color:#fff">' + esc(file) + '</b> (' + mb(blob.size) + ') to your Downloads.</p>' +
        '<p>Double-click it to play, even with no internet.' + (res.online ? ' Playing online with friends still needs a connection.' : '') + '</p>' + online +
        '<div class="row"><button class="b go" data-close>OK</button></div>');
      return { file: file, size: blob.size, missed: res.missed, html: res.html };
    }, function (err) {
      busy = false;
      console.warn('GBDownload', err);
      var c = d.show('<div class="k">⬇ DOWNLOAD</div><h3>' + esc(name) + '</h3>' +
        '<p>Couldn\'t pack this game. Check your connection and try again.</p>' +
        '<div class="row"><button class="b go" data-retry>Try again</button><button class="b" data-close>Close</button></div>');
      c.querySelector('[data-retry]').addEventListener('click', function () { start(file, name); });
      return null;
    });
  }

  window.GBDownload = { start: start, pack: pack, apps: APPS, isApp: function (f) { return !!APPS[f]; } };

  // #dlcheck - pack this page's game (or ?g= on play.html) without saving, and report
  if (/dlcheck/.test(location.hash)) {
    var f = new URLSearchParams(location.search).get('g') || (location.pathname.split('/').pop() || '');
    pack(f).then(function (r) {
      console.log('GBDL OK ' + f + ' bytes=' + r.html.length + ' missed=' + JSON.stringify(r.missed));
      window.__gbdl = r;
    }, function (e) { console.log('GBDL FAIL ' + f + ' ' + e); });
  }
})();
