// 打包：生成可独立分发的 dist/ 文件夹
//   dist/index.html        代码与样式全部内联的单页
//   dist/assets/           实拍贴图、HDRI 天空（Poly Haven CC0）、模型
//       首次打开只下载压缩版：贴图 .avif、模型 .glb.gz、天空 .hdr.gz（都由 src/core/pack.js 在浏览器端处理）；
//       同名的 .jpg / .glb / .hdr 是给不支持 AVIF 或 DecompressionStream 的旧浏览器的后备，平时不会被下载。
//       加 --lean 不带后备文件（文件夹小四十多 MB，旧浏览器会退回程序化贴图 / 模型）。
//   dist/manifest.webmanifest + dist/sw.js   PWA：可安装到主屏幕；素材按内容指纹缓存，装好后可离线运行（模板在 tools/sw.template.js）
//   dist/serve.mjs         零依赖静态服务器
//   dist/启动游戏.command   双击启动（macOS）
//   dist/.assetsignore     部署到 Cloudflare 时排除上面两个本地文件
// 浏览器不允许 file:// 页面读取贴图像素与 HDR 文件，所以要通过本地服务器打开；
// 直接双击 index.html 也能运行，但会退回到纯程序化的贴图与天空。
import { build } from 'esbuild';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });

// 1) 页面：JS / CSS 内联
const res = await build({ entryPoints: [path.join(root, 'src/main.js')], bundle: true, format: 'esm', minify: true, target: 'es2022', write: false, legalComments: 'none', define: { __BUILD__: '"dist"' } });   // __BUILD__：只有打包版才注册离线缓存
const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
html = html.replace(/<script type="module" src="src\/main.js"><\/script>/, () => `<script type="module">\n${js}\n</script>`);
fs.writeFileSync(path.join(out, 'index.html'), html);

// 2) 素材
const copyDir = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true }); let bytes = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) bytes += copyDir(s, d); else { fs.copyFileSync(s, d); bytes += fs.statSync(s).size; }
  }
  return bytes;
};
const assetBytes = copyDir(path.join(root, 'assets'), path.join(out, 'assets'));

// 2.5) 压缩版：模型直接 gzip；天空先把 RGBE 重排再 gzip（无损，约为原文件的三分之一）
const gz = (buf) => zlib.gzipSync(buf, { level: 9 });
// Radiance .hdr（行程编码）→ 'KHDR' + 宽 + 高 + 四个平面 [R−G, G, B−G, E]，每个平面逐行水平差分。还原在 src/core/pack.js 的 fetchHDR
function packHDR(d) {
  let p = d.indexOf('\n\n') + 2; const e = d.indexOf('\n', p); const m = /-Y (\d+) \+X (\d+)/.exec(d.subarray(p, e).toString('latin1')); if (!m) throw new Error('不认识的 HDR 文件头');
  const h = +m[1], w = +m[2], n = w * h; p = e + 1; const px = Buffer.alloc(n * 4);
  for (let y = 0; y < h; y++) {
    if (d[p] !== 2 || d[p + 1] !== 2 || ((d[p + 2] << 8) | d[p + 3]) !== w) throw new Error('HDR 不是新式行程编码'); p += 4;
    for (let c = 0; c < 4; c++) for (let x = 0; x < w;) { let k = d[p++]; if (k > 128) { k -= 128; const v = d[p++]; while (k--) px[(y * w + x++) * 4 + c] = v; } else while (k--) px[(y * w + x++) * 4 + c] = d[p++]; }
  }
  if (px[0] === 2 && px[1] === 2 && !(px[2] & 0x80)) throw new Error('首个像素会被误判成行程编码');   // 还原出来的是不带行程编码的 .hdr
  const o = Buffer.alloc(12 + n * 4); o.write('KHDR'); o.writeUInt32LE(w, 4); o.writeUInt32LE(h, 8);
  for (let c = 0; c < 4; c++) for (let y = 0; y < h; y++) { let prev = 0; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const v = c === 1 ? px[i + 1] : c === 3 ? px[i + 3] : (px[i + (c === 0 ? 0 : 2)] - px[i + 1]) & 255; o[12 + c * n + y * w + x] = (v - prev) & 255; prev = v; } }
  return o;
}
let packed = 0, fallback = 0; const lean = process.argv.includes('--lean');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
for (const f of walk(path.join(out, 'assets'))) {
  const ext = path.extname(f); if (ext === '.gz' || !fs.existsSync(f)) continue; const size = fs.statSync(f).size;
  if (ext === '.glb' || ext === '.hdr' || ext === '.kmap') {   // .kmap：导入地图的地形数据，同样直接 gzip
    let z = null; try { z = gz(ext === '.hdr' ? packHDR(fs.readFileSync(f)) : fs.readFileSync(f)); } catch (err) { console.warn('未压缩', path.basename(f), err.message); }
    if (z) { fs.writeFileSync(f + '.gz', z); packed += z.length; if (lean) fs.rmSync(f); else fallback += size; } else packed += size;
  } else if (ext === '.jpg' && fs.existsSync(f.slice(0, -4) + '.avif')) { if (lean) fs.rmSync(f); else fallback += size; }
  else if (!f.includes(path.sep + 'icons' + path.sep)) packed += size;
}

// 2.6) PWA：清单原样复制；Service Worker 里写入「首次打开会用到的素材 → 内容指纹」和本次打包的指纹
fs.copyFileSync(path.join(root, 'manifest.webmanifest'), path.join(out, 'manifest.webmanifest'));
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
const files = {};
for (const f of walk(path.join(out, 'assets')).sort()) {
  const ext = path.extname(f), rel = path.relative(out, f).split(path.sep).join('/');
  const used = ext === '.avif' || ext === '.gz' || (ext === '.jpg' && !fs.existsSync(f.slice(0, -4) + '.avif')) || ((ext === '.glb' || ext === '.hdr' || ext === '.kmap') && !fs.existsSync(f + '.gz'));   // 有压缩版时原文件只是后备，不进缓存清单
  if (used) files[rel] = sha(fs.readFileSync(f));
}
const swTpl = fs.readFileSync(path.join(root, 'tools/sw.template.js'), 'utf8');
const buildId = sha(html + JSON.stringify(files) + swTpl);
const sw = swTpl.replace("'__BUILD__'", () => JSON.stringify(buildId)).replace('= __FILES__;', () => '= ' + JSON.stringify(files) + ';');
if (sw.includes('__FILES__') || sw.includes('__BUILD__')) throw new Error('sw.template.js 的占位符没有填上');
fs.writeFileSync(path.join(out, 'sw.js'), sw);

// 3) 服务器与启动脚本
fs.writeFileSync(path.join(out, 'serve.mjs'), `// KHAMSIN 本地服务器（零依赖）：node serve.mjs [端口]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || process.argv[2] || 5173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.avif': 'image/avif', '.md': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('KHAMSIN: http://localhost:' + port));
`);
const cmd = path.join(out, '启动游戏.command');
fs.writeFileSync(cmd, `#!/bin/bash
# 双击启动：开一个本地服务器并在默认浏览器里打开游戏（推荐 Chrome）。关掉这个终端窗口即停止。
cd "$(dirname "$0")"
PORT=5173
(sleep 1; open "http://localhost:$PORT/") &
if command -v node >/dev/null 2>&1; then node serve.mjs $PORT; else python3 -m http.server $PORT --bind 127.0.0.1; fi
`);
fs.chmodSync(cmd, 0o755);

// 4) 部署到 Cloudflare（wrangler deploy，见 wrangler.jsonc）时不上传本地用的服务器和启动脚本
fs.writeFileSync(path.join(out, '.assetsignore'), 'serve.mjs\n启动游戏.command\n');

const kb = (n) => (n / 1024).toFixed(0) + ' KB', mb = (n) => (n / 1048576).toFixed(1) + ' MB';
console.log('dist/index.html', kb(fs.statSync(path.join(out, 'index.html')).size));
console.log('dist/sw.js      离线缓存清单', Object.keys(files).length, '个素材，打包指纹', buildId);
console.log('dist/assets     首次打开要下载', mb(packed) + (lean ? '（--lean：不带后备文件）' : '，另有旧浏览器用的后备原文件 ' + mb(fallback)));
