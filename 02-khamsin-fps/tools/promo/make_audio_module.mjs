// 生成“只做离线渲染”的音频引擎副本：读取 src/core/audio.js（不修改它），打三处补丁后写到 <build>/promo-audio/audio.js。
//   1) AudioContext 改为 globalThis.__PromoAC（页面里把它设成返回 OfflineAudioContext 的工厂）——离线上下文永远不会接到扬声器
//   2) init 里“上下文没在运行就 resume / 等用户手势解锁”的分支关掉
//   3) update 里“上下文不在 running 就跳过”的判断去掉（离线渲染用 suspend/resume 逐帧推进，回调时状态是 suspended）
// 用法：node tools/promo/make_audio_module.mjs <promo-build 目录>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../src/core/audio.js');
const outDir = path.join(path.resolve(process.argv[2] || '.'), 'promo-audio');
let s = fs.readFileSync(src, 'utf8');
const patch = (from, to) => { if (!s.includes(from)) throw new Error('补丁位置没找到：' + from); s = s.replace(from, to); };
patch('const AC = globalThis.AudioContext || globalThis.webkitAudioContext;', 'const AC = globalThis.__PromoAC;');
patch("if (ctx.state !== 'running') {\n", 'if (false) {\n');
patch("if (ctx.state !== 'running') return;", '');
if (/\bctx\.destination\b/.test(s) && !/lim\.connect\(ctx\.destination\)/.test(s)) throw new Error('出现了未预期的 destination 连接');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'audio.js'), s);
console.log('written', path.join(outDir, 'audio.js'));
