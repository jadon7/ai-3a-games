import { buildTrack, HALF_W } from '../src/track.js';
import fs from 'node:fs';
const T = buildTrack().buildRacingLine();
const v = T.speedProfile();
const b = T.bounds;
console.log('L =', T.L.toFixed(1), 'N =', T.N, 'solved straights =', T.solved.map(x => x.toFixed(1)).join(', '));
console.log('bounds', Object.values(b).map(x => x.toFixed(0)).join(' '), 'size', (b.maxx - b.minx).toFixed(0), 'x', (b.maxy - b.miny).toFixed(0));
for (const r of T.ranges) console.log(r.type, r.s0.toFixed(0).padStart(5), '→', r.s1.toFixed(0).padStart(5), r.type === 'A' ? `R${r.R} ${(r.ang * 180 / Math.PI).toFixed(0)}° ${r.name || ''}` : `len ${r.len.toFixed(0)}`);
// 相邻赛段间距检查：任一侧护栏点不得侵入其它赛段的护栏范围
let worst = 1e9, wi = 0, wj = 0;
for (let i = 0; i < T.N; i += 2) for (const side of [1, -1]) {
  const off = side > 0 ? T.dL[i] : T.dR[i];
  const bx = T.px[i] - T.hy[i] * off * side, by = T.py[i] + T.hx[i] * off * side;
  for (let j = 0; j < T.N; j += 2) {
    let dsj = Math.abs(i - j); dsj = Math.min(dsj, T.N - dsj); if (dsj < 70) continue;
    const dx = bx - T.px[j], dy = by - T.py[j];
    const along = dx * T.hx[j] + dy * T.hy[j]; if (Math.abs(along) > 2) continue;
    const lat = -dx * T.hy[j] + dy * T.hx[j];
    const clear = Math.abs(lat) - (lat > 0 ? T.dL[j] : T.dR[j]);
    if (clear < worst) { worst = clear; wi = i; wj = j; }
  }
}
console.log('min clearance between sections:', worst.toFixed(1), 'm at s=', wi, wj);
let lap = 0; for (let i = 0; i < T.N; i++) lap += T.ds / v[i];
console.log('ideal AI lap ≈', lap.toFixed(1), 's; vmin', (Math.min(...v) * 3.6).toFixed(0), 'vmax', (Math.max(...v) * 3.6).toFixed(0), 'km/h');
// SVG
const pad = 60, W = b.maxx - b.minx + pad * 2, H = b.maxy - b.miny + pad * 2, sc = 1.45;
const X = x => ((x - b.minx + pad) * sc).toFixed(1), Y = y => ((b.maxy - y + pad) * sc).toFixed(1);
const path = (fn, close = true) => { let d = ''; for (let i = 0; i < T.N; i += 2) { const p = fn(i); d += (i ? 'L' : 'M') + X(p.x) + ' ' + Y(p.y); } return d + (close ? 'Z' : ''); };
const off = (i, d) => ({ x: T.px[i] - T.hy[i] * d, y: T.py[i] + T.hx[i] * d });
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * sc}" height="${H * sc}" style="background:#2c3a22">`;
svg += `<path d="${path(i => off(i, T.dL[i]))}" fill="none" stroke="#bbb" stroke-width="2"/>`;
svg += `<path d="${path(i => off(i, -T.dR[i]))}" fill="none" stroke="#bbb" stroke-width="2"/>`;
svg += `<path d="${path(i => off(i, 0))}" fill="none" stroke="#333" stroke-width="${11 * sc}"/>`;
for (const kb of T.kerbs) { let d = ''; let first = true; for (let s = kb.s0; s <= kb.s1; s += 2) { const p = T.offset(s, kb.side * (HALF_W + 0.6)); d += (first ? 'M' : 'L') + X(p.x) + ' ' + Y(p.y); first = false; } svg += `<path d="${d}" fill="none" stroke="${kb.kind === 'apex' ? '#e33' : '#f96'}" stroke-width="3"/>`; }
for (const g of T.gravel) { let d = ''; let first = true; for (let s = g.s0; s <= g.s1; s += 2) { const bb = g.side > 0 ? T.barrierL(s) : T.barrierR(s); const p = T.offset(s, g.side * (HALF_W + 2.6 + (bb - HALF_W - 4) / 2)); d += (first ? 'M' : 'L') + X(p.x) + ' ' + Y(p.y); first = false; } svg += `<path d="${d}" fill="none" stroke="#c8b48a" stroke-width="6" opacity="0.7"/>`; }
svg += `<path d="${path(i => ({ x: T.lineX[i], y: T.lineY[i] }))}" fill="none" stroke="#4cf" stroke-width="1.5"/>`;
for (let s = 0; s < T.L; s += 100) { const p = T.offset(s, 0); svg += `<text x="${X(p.x)}" y="${Y(p.y)}" fill="#fff" font-size="16">${s}</text>`; }
for (const r of T.ranges) if (r.type === 'A') svg += `<text x="${X(r.cx)}" y="${Y(r.cy)}" fill="#ff8" font-size="15" text-anchor="middle">${r.name}</text>`;
const st = T.offset(0, 0); svg += `<circle cx="${X(st.x)}" cy="${Y(st.y)}" r="8" fill="#fff"/>`;
svg += '</svg>';
fs.writeFileSync(new URL('./track_preview.svg', import.meta.url), svg);
