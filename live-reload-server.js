// Live-reload dev server.
// Serves files from /Users/lev and auto-refreshes any open browser tab
// the moment a watched file changes on disk. Share the tunnel URL with your
// friend and you both see edits to the game instantly.
//
//   node live-reload-server.js [port]
//   default port: 8096   ->  open http://localhost:8096/war-combined.html

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/lev';
const PORT = parseInt(process.argv[2] || '8096', 10);

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ico': 'image/x-icon',
};

// All connected browsers waiting for a reload signal (Server-Sent Events).
const clients = new Set();

// Script injected into every HTML page. Opens an SSE connection; when the
// server says "reload", the page refreshes itself.
const INJECT = `
<script>
(function () {
  var es = new EventSource('/__livereload');
  es.onmessage = function (e) { if (e.data === 'reload') location.reload(); };
  es.onerror = function () { /* server restarting; browser auto-retries */ };
})();
</script>`;

// Browser code editor. Loads a file, lets you edit it, saves back to disk.
// __FILE__ is replaced with the target filename per request.
const EDITOR_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>Edit __FILE__</title>
<style>
  html,body{margin:0;height:100%;background:#1e1e1e;color:#ddd;font-family:monospace}
  #bar{display:flex;gap:10px;align-items:center;padding:8px 12px;background:#252526;border-bottom:1px solid #333}
  #bar b{color:#4ec9b0}
  button{background:#0e639c;color:#fff;border:0;padding:7px 16px;border-radius:4px;cursor:pointer;font-size:13px}
  button:hover{background:#1177bb}
  #status{color:#888;font-size:12px}
  #ta{position:absolute;top:45px;bottom:0;left:0;right:0;width:100%;border:0;outline:0;
      background:#1e1e1e;color:#d4d4d4;font-family:monospace;font-size:13px;line-height:1.5;
      padding:12px;box-sizing:border-box;resize:none;white-space:pre;overflow:auto;tab-size:2}
</style></head><body>
<div id="bar">
  <b>__FILE__</b>
  <button onclick="save()">💾 Save (Ctrl/Cmd+S)</button>
  <span id="status">loading…</span>
</div>
<textarea id="ta" spellcheck="false"></textarea>
<script>
  var file='__FILE__', ta=document.getElementById('ta'), st=document.getElementById('status');
  fetch('/__file?path='+encodeURIComponent(file)).then(r=>r.text()).then(t=>{ta.value=t;st.textContent='loaded';});
  // Tab inserts two spaces instead of moving focus.
  ta.addEventListener('keydown',function(e){
    if(e.key==='Tab'){e.preventDefault();var s=ta.selectionStart,en=ta.selectionEnd;
      ta.value=ta.value.slice(0,s)+'  '+ta.value.slice(en);ta.selectionStart=ta.selectionEnd=s+2;}
  });
  function save(){
    st.textContent='saving…';
    fetch('/__save',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({path:file,content:ta.value})})
      .then(r=>r.ok?st.textContent='✅ saved '+new Date().toLocaleTimeString():st.textContent='❌ save failed')
      .catch(()=>st.textContent='❌ network error');
  }
  document.addEventListener('keydown',function(e){
    if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();save();}
  });
</script></body></html>`;

const server = http.createServer((req, res) => {
  // SSE channel: keep the connection open and register the client.
  if (req.url === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Load a file's raw text for the editor.
  if (req.url.startsWith('/__file')) {
    const q = new URL(req.url, 'http://x').searchParams.get('path') || 'war-combined.html';
    const fp = path.join(ROOT, q);
    if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(fp, 'utf8', (err, data) => {
      if (err) { res.writeHead(404); res.end(''); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // Save edited text back to disk (this fires the file-watch -> reload).
  if (req.url === '/__save' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 50e6) req.destroy(); });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); } catch (e) { res.writeHead(400); res.end('bad json'); return; }
      const fp = path.join(ROOT, payload.path || '');
      if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
      // Timestamped backup before every save, so nobody clobbers work irreversibly.
      try { fs.copyFileSync(fp, fp + '.bak'); } catch (e) {}
      fs.writeFile(fp, payload.content, 'utf8', (err) => {
        if (err) { res.writeHead(500); res.end('write failed'); return; }
        console.log('saved via editor:', payload.path);
        res.writeHead(200); res.end('ok');
      });
    });
    return;
  }

  // The browser-based editor UI.
  if (req.url.startsWith('/edit')) {
    const file = new URL(req.url, 'http://x').searchParams.get('file') || 'war-combined.html';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(EDITOR_HTML.replace('__FILE__', file));
    return;
  }

  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/war-combined.html';

  // Keep requests inside ROOT (no path traversal).
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + urlPath); return; }
    const ext = path.extname(filePath).toLowerCase();
    const type = TYPES[ext] || 'application/octet-stream';

    // Inject the live-reload script into HTML pages.
    if (ext === '.html') {
      let html = data.toString();
      html = html.includes('</body>')
        ? html.replace('</body>', INJECT + '</body>')
        : html + INJECT;
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(html);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(data);
    }
  });
});

// Tell every open browser to reload.
function triggerReload(file) {
  console.log('changed -> reloading:', file);
  for (const res of clients) res.write('data: reload\n\n');
}

// Watch the whole folder (recursive) but debounce: editors fire several
// events per save, so collapse them into one reload.
let timer = null;
fs.watch(ROOT, { recursive: true }, (evt, file) => {
  if (!file) return;
  if (/\.(html|js|css|json)$/i.test(file) && !file.startsWith('.')) {
    clearTimeout(timer);
    timer = setTimeout(() => triggerReload(file), 120);
  }
});

server.listen(PORT, () => {
  console.log('Live-reload server running:');
  console.log('  http://localhost:' + PORT + '/war-combined.html');
  console.log('Edit any .html/.js/.css in ' + ROOT + ' and the page auto-refreshes.');
});
