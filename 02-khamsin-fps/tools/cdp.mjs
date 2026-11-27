// 开发用：极简的 Chrome 调试协议客户端，驱动无头 Chrome 做自动化测试（手机仿真、真实触摸、截图、离线启动）。只连本机。
// 先起一个静音的无头 Chrome（用独立的临时配置目录，别动自己平时用的那份）：
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9333 \
//       --user-data-dir=<临时目录> --no-first-run --mute-audio --window-size=1280,720 about:blank
// 然后在测试脚本里：
//   import { openTab } from './cdp.mjs';
//   const t = await openTab(); await t.send('Page.navigate', { url: 'http://localhost:5173/?mute' });
//   await t.waitFor('!!window.__dbg'); console.log(await t.ev('return __dbg.game.state')); await t.shot('a.jpg'); t.close();
import fs from 'node:fs';
export const PORT = Number(process.env.CDP_PORT || 9333);
export async function openTab(url = 'about:blank') {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map(), logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend.has(d.id)) { const [r, j] = pend.get(d.id); pend.delete(d.id); if (d.error) j(new Error(d.error.message)); else r(d.result); }
    else if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.type + ': ' + d.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise((r, j) => { pend.set(++id, [r, j]); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  // 在页面里执行一段异步函数体（用 return 返回结果）
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, ms = 120000, step = 500) => { const t0 = Date.now(); for (;;) { try { const v = await ev(`return ${expr}`); if (v) return v; } catch (e) { /* 页面正在跳转 */ } if (Date.now() - t0 > ms) throw new Error('等待超时：' + expr); await sleep(step); } };
  const shot = async (file, quality = 86) => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file; };
  // 手机仿真：视口尺寸 + 触摸
  const metrics = (w, h, dpr = 2, mobile = true) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile, screenOrientation: mobile ? { type: w > h ? 'landscapePrimary' : 'portraitPrimary', angle: w > h ? 90 : 0 } : undefined });
  // 真实触摸：pts = [{ x, y, id }]
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id || 0, radiusX: 8, radiusY: 8, force: 1 })) });
  const tap = async (x, y, hold = 60) => { await touch('touchStart', [{ x, y }]); await sleep(hold); await touch('touchEnd', []); await sleep(60); };
  const errors = () => logs.filter((l) => /^(error|EXC)|khamsin:(error|reject|fatal)/.test(l));
  // 关掉这个标签页（不关的话它会一直在后台跑游戏循环，拖慢后面的测试）
  const close = () => { fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {}); ws.close(); };
  return { send, ev, sleep, waitFor, shot, metrics, touch, tap, logs, errors, close, id: t.id };
}
