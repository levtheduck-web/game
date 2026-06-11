// 🪳 Roach Rave — paste a YouTube link, the cockroaches dance to the audio.
// This server pulls the video's audio with yt-dlp and serves it to the page,
// which runs a Web Audio FFT to drive the dancing roaches.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = 8099;
const YTDLP = path.join(__dirname, 'bin', 'yt-dlp');
const CACHE = path.join(os.tmpdir(), 'roachrave');
fs.mkdirSync(CACHE, { recursive: true });

// Pull the 11-char YouTube id out of any common link shape.
function videoId(url) {
  const m = String(url).match(/(?:v=|\/shorts\/|youtu\.be\/|\/embed\/|\/v\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(url) ? url : null);
}

function findCached(id) {
  for (const ext of ['m4a', 'webm', 'mp3', 'opus']) {
    const p = path.join(CACHE, id + '.' + ext);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
  }
  return null;
}

// Download the audio-only track for a video id (no ffmpeg needed). Cached.
function fetchAudio(id) {
  return new Promise((resolve, reject) => {
    const cached = findCached(id);
    if (cached) return resolve(cached);
    const out = path.join(CACHE, id + '.%(ext)s');
    const args = ['-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
      '--no-playlist', '--no-part', '-o', out,
      'https://www.youtube.com/watch?v=' + id];
    const proc = spawn(YTDLP, args);
    let err = '';
    proc.stderr.on('data', d => { err += d; });
    proc.on('error', e => reject(e));
    proc.on('close', code => {
      const p = findCached(id);
      if (p) resolve(p);
      else reject(new Error('yt-dlp failed (' + code + '): ' + err.split('\n').filter(l => /ERROR/i.test(l)).join(' ').slice(0, 300)));
    });
  });
}

const TYPES = { m4a: 'audio/mp4', mp3: 'audio/mpeg', webm: 'audio/webm', opus: 'audio/ogg' };

// Serve a file with range support so the <audio> element can seek/buffer smoothly.
function serveFile(req, res, file) {
  const stat = fs.statSync(file);
  const ext = path.extname(file).slice(1);
  const type = TYPES[ext] || 'audio/mpeg';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
    res.writeHead(206, {
      'content-type': type, 'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${stat.size}`,
      'content-length': end - start + 1,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': stat.size });
    fs.createReadStream(file).pipe(res);
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/' || u.pathname === '/index.html') {
    fs.readFile(path.join(__dirname, 'roach-rave.html'), (e, data) => {
      if (e) { res.writeHead(404); res.end('roach-rave.html not found'); return; }
      res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  if (u.pathname === '/audio') {
    const id = videoId(u.searchParams.get('url') || '');
    if (!id) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Not a valid YouTube link.' })); return; }
    try {
      const file = await fetchAudio(id);
      serveFile(req, res, file);
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => {
  console.log(`🪳 Roach Rave running:  http://localhost:${PORT}/`);
  console.log(`   audio cache: ${CACHE}`);
});
