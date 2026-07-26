// Quoridor online server: serves the game + relays moves between two players in a room.
// One port serves both static HTML and WebSocket, so a single tunnel URL works for everything.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8102;
const ROOT = __dirname;

const MIME = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.ico':'image/x-icon' };

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/' || url === '') url = '/quoridor.html';
  const file = path.join(ROOT, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

const rooms = new Map(); // code -> { host, guest }
function code4() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function peerOf(ws) {
  const room = rooms.get(ws.room);
  if (!room) return null;
  return ws === room.host ? room.guest : room.host;
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'create') {
      let code; do { code = code4(); } while (rooms.has(code));
      rooms.set(code, { host: ws, guest: null });
      ws.room = code; ws.role = 'blue';
      send(ws, { t: 'created', code, color: 'blue' });

    } else if (m.t === 'join') {
      const room = rooms.get((m.code || '').toUpperCase());
      if (!room) return send(ws, { t: 'error', msg: 'No game with that code.' });
      if (room.guest) return send(ws, { t: 'error', msg: 'That game is full.' });
      room.guest = ws; ws.room = m.code.toUpperCase(); ws.role = 'red';
      send(ws, { t: 'joined', color: 'red' });
      send(room.host, { t: 'start' });
      send(room.guest, { t: 'start' });

    } else if (m.t === 'action' || m.t === 'rematch') {
      const p = peerOf(ws);
      if (p) send(p, m);
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.room);
    if (!room) return;
    const p = peerOf(ws);
    if (p) send(p, { t: 'left' });
    rooms.delete(ws.room);
  });
});

server.listen(PORT, () => console.log('Quoridor server on http://localhost:' + PORT + '  (ws /ws)'));
