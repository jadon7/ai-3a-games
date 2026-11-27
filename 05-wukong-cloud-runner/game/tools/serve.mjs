// 极简静态文件服务器（开发和游玩都用它）。用法：node tools/serve.mjs [端口=8765]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.glsl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

export function startServer(port = 8765, quiet = false) {
  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end('not found'); return; }
        const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
        const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
        if (range) {
          const s = range[1] ? parseInt(range[1]) : 0, e = range[2] ? parseInt(range[2]) : st.size - 1;
          res.writeHead(206, { ...headers, 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1 });
          fs.createReadStream(file, { start: s, end: e }).pipe(res);
        } else {
          res.writeHead(200, { ...headers, 'Content-Length': st.size });
          fs.createReadStream(file).pipe(res);
        }
      });
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => { if (!quiet) console.log(`筋斗云驾驶模拟器: http://localhost:${server.address().port}/`); resolve(server); });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 命令行：node tools/serve.mjs [端口] [--open]   端口被占用时自动往后找
  const args = process.argv.slice(2);
  const wantOpen = args.includes('--open');
  let port = parseInt(args.find(a => /^\d+$/.test(a)) || process.env.PORT || '8765');
  for (let i = 0; i < 20; i++) {
    try {
      const server = await startServer(port + i);
      if (wantOpen) {
        const { spawn } = await import('node:child_process');
        const url = `http://localhost:${server.address().port}/`;
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
        spawn(cmd, process.platform === 'win32' ? ['/c', 'start', url] : [url], { stdio: 'ignore', detached: true }).unref();
      }
      console.log('关闭这个窗口（或按 Ctrl+C）即可退出游戏服务。');
      break;
    } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
}
