// 宣传片采集：帧接收服务（只监听 127.0.0.1，带 CORS）。
// 用法：node tools/promo/receiver.mjs <输出根目录> [端口=5191]
//   POST /frame?shot=<镜头名>&i=<序号>   body = JPEG      -> <根>/frames/<镜头名>/<序号6位>.jpg
//   POST /file?name=<文件名>             body = 任意二进制 -> <根>/<文件名>（例如 json 日志、webm 录音）
//   GET  /stat                                           -> 已收文件数与字节数
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 5191);
const safe = (s) => String(s || '').replace(/[^\w一-龥.-]/g, '_').slice(0, 80);
let nFiles = 0, nBytes = 0;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/stat') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ nFiles, nBytes })); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    let file;
    if (u.pathname === '/frame') {
      const dir = path.join(root, 'frames', safe(u.searchParams.get('shot')));
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, String(Number(u.searchParams.get('i')) | 0).padStart(6, '0') + '.jpg');
    } else if (u.pathname === '/file') {
      file = path.join(root, safe(u.searchParams.get('name')));
    } else { res.writeHead(404); res.end(); return; }
    fs.writeFile(file, buf, (err) => {
      if (err) { res.writeHead(500); res.end(String(err)); return; }
      nFiles++; nBytes += buf.length; res.writeHead(200); res.end('ok');
    });
  });
}).listen(port, '127.0.0.1', () => console.log('promo receiver: http://127.0.0.1:' + port + ' -> ' + root));
