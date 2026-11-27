// Cyberpunk spinner cockpit: wet gunmetal, cyan/magenta emissive glass, rain-smeared neon city behind.
import { THREE, PI, TAU, clamp, lerp, rng, Maps, rep, mkCanvas, canvasTex, seg7, glow, ticks, arc, dialNums, microText, sh, rr, rrHole, circ, poly, plate, box, cyl, lathe, bezelRing, dome, needleMesh, quad, disc, cable, screwKit, Screen, decal, glassMat, makeEnv } from './core.js';

const CY = '#3fe9ff', CYW = '#c4f9ff', MG = '#ff2e93', AM = '#ffa53a';
const cy = a => `rgba(63,233,255,${a})`, mg = a => `rgba(255,46,147,${a})`;
const F_D = 'Orbitron, "Arial Black", sans-serif', F_L = 'Rajdhani, "Arial Narrow", sans-serif', F_M = '"Share Tech Mono", Consolas, monospace';

const scanCache = new Map();
function scan(g, W, H, a = 0.22) {
  const k = W + 'x' + H + a; let c = scanCache.get(k);
  if (!c) { c = mkCanvas(W, H); const s = c.getContext('2d'); s.fillStyle = `rgba(0,0,0,${a})`; for (let y = 0; y < H; y += 3) s.fillRect(0, y, W, 1); const v = s.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)'); s.fillStyle = v; s.fillRect(0, 0, W, H); scanCache.set(k, c); }
  g.drawImage(c, 0, 0);
}
const line = (g, pts, close = false) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (close) g.closePath(); g.stroke(); };
const txt = (g, s, x, y, font, color, align = 'left', base = 'alphabetic') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = base; g.fillText(s, x, y); };

const SHIP_SIDE = [[0, .62], [.07, .42], [.28, .26], [.4, .06], [.58, .04], [.7, .22], [.86, .3], [1, .5], [.97, .7], [.78, .82], [.2, .84], [.03, .76]];
const SHIP_TOP = [[0, 0], [.1, .14], [.15, .42], [.3, .58], [.31, .9], [.15, .96], [.1, .84], [-.1, .84], [-.15, .96], [-.31, .9], [-.3, .58], [-.15, .42], [-.1, .14]];
function shipSide(g, x, y, w, h, color, lw = 1.5) {
  g.strokeStyle = color; g.lineWidth = lw; const P = p => [x + p[0] * w, y + p[1] * h];
  line(g, SHIP_SIDE.map(P), true);
  line(g, [[.28, .26], [.7, .22]].map(P)); line(g, [[.07, .42], [.86, .46], [1, .5]].map(P)); line(g, [[.2, .84], [.24, .6], [.74, .6], [.78, .82]].map(P));
  line(g, [[.42, .1], [.44, .24]].map(P)); line(g, [[.56, .08], [.57, .23]].map(P));
  g.beginPath(); g.ellipse(x + .22 * w, y + .84 * h, .07 * w, .13 * h, 0, 0, TAU); g.stroke(); g.beginPath(); g.ellipse(x + .76 * w, y + .84 * h, .07 * w, .13 * h, 0, 0, TAU); g.stroke();
}
function shipTop(g, cx, y, w, h, color, lw = 1.5) {
  g.strokeStyle = color; g.lineWidth = lw; const P = p => [cx + p[0] * w, y + p[1] * h];
  line(g, SHIP_TOP.map(P), true);
  line(g, [[0, .08], [0, .84]].map(P)); line(g, [[-.1, .14], [.1, .14]].map(P)); line(g, [[-.15, .42], [.15, .42]].map(P)); line(g, [[-.3, .58], [.3, .58]].map(P)); line(g, [[-.1, .3], [-.06, .2], [.06, .2], [.1, .3], [.08, .4], [-.08, .4]].map(P), true);
  for (const s of [-1, 1]) for (const yy of [.2, .7]) { const px = cx + s * (yy < .5 ? .2 : .36) * w, py = y + yy * h; g.strokeRect(px - .05 * w, py - .07 * h, .1 * w, .14 * h); line(g, [[px - .05 * w, py], [px + .05 * w, py]]); }
}

/* ---------- display painters ---------- */
function navPainter() {
  const W = 1024, H = 288, base = mkCanvas(W, H), b = base.getContext('2d'), r = rng(77);
  b.fillStyle = '#01080d'; b.fillRect(0, 0, W, H);
  b.save(); b.translate(W / 2, H * 0.66); b.transform(1, 0, -0.5, 0.52, 0, 0); b.rotate(-0.3);
  for (let i = -16; i < 16; i++) for (let j = -12; j < 12; j++) {
    if (r() < 0.1) continue; const bw = 46 * (0.55 + r() * 0.45), bh = 36 * (0.55 + r() * 0.45), l = 8 + r() * 30;
    b.fillStyle = `rgb(${l * 0.35 | 0},${l * 1.25 | 0},${l * 1.6 | 0})`; b.fillRect(i * 58 + 6, j * 48 + 6, bw, bh);
    b.strokeStyle = cy(0.25); b.lineWidth = 1; b.strokeRect(i * 58 + 6, j * 48 + 6, bw, bh);
  }
  b.strokeStyle = cy(0.4); b.lineWidth = 1.5;
  for (let i = -16; i < 16; i++) line(b, [[i * 58, -600], [i * 58, 600]]); for (let j = -12; j < 12; j++) line(b, [[-1000, j * 48], [1000, j * 48]]);
  glow(b, MG, 10, () => { b.strokeStyle = MG; b.lineWidth = 3.5; line(b, [[-900, 96], [-232, 96], [-232, -48], [116, -48], [116, -240], [600, -240]]); line(b, [[-174, 500], [-174, 144], [290, 144], [290, -96], [900, -96]]); });
  b.restore();
  const route = [[512, 300], [512, 226], [520, 176], [566, 128], [640, 100], [704, 66], [742, 46]];
  glow(b, CY, 14, () => { b.strokeStyle = CYW; b.lineWidth = 7; b.lineJoin = 'round'; b.lineCap = 'round'; line(b, route); });
  for (const [x0, x1] of [[0, 190], [W - 230, W]]) { const gr = b.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(x0 ? 1 : 0, 'rgba(1,8,13,0.92)'); gr.addColorStop(x0 ? 0 : 1, 'rgba(1,8,13,0)'); b.fillStyle = gr; b.fillRect(x0, 0, x1 - x0, H); }
  txt(b, 'RA  14h 29m 43s', W - 34, 50, `26px ${F_M}`, CYW, 'right'); txt(b, 'DEC −62° 40′ 46″', W - 34, 82, `26px ${F_M}`, CYW, 'right');
  microText(b, 40, 78, 120, 2, r, cy(0.55)); microText(b, 40, 236, 220, 3, r, cy(0.5), 12); microText(b, 420, 252, 160, 2, r, cy(0.45), 12); microText(b, W - 250, 236, 210, 3, r, cy(0.5), 12);
  b.strokeStyle = cy(0.6); b.lineWidth = 2; for (let i = 0; i < 9; i++) line(b, [[14, 96 + i * 14], [i % 4 ? 22 : 30, 96 + i * 14]]);
  b.strokeStyle = cy(0.5); b.strokeRect(3, 3, W - 6, H - 6);
  return new Screen(W, H, (g, t) => {
    g.drawImage(base, 0, 0);
    glow(g, CY, 10, () => { g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.setLineDash([10, 26]); g.lineDashOffset = -t * 60; line(g, route); g.setLineDash([]); });
    glow(g, CY, 16, () => { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(512, 196); g.lineTo(530, 246); g.lineTo(512, 236); g.lineTo(494, 246); g.closePath(); g.fill(); });
    for (const [px, py, ph] of [[742, 46, 0], [300, 54, 1.3]]) {
      const k = (t * 0.8 + ph) % 1; g.strokeStyle = cy(1 - k); g.lineWidth = 2; g.beginPath(); g.arc(px, py, 8 + k * 22, 0, TAU); g.stroke();
      glow(g, CY, 12, () => { g.fillStyle = CYW; g.beginPath(); g.arc(px, py, 7, 0, TAU); g.fill(); g.fillStyle = '#01080d'; g.beginPath(); g.arc(px, py, 3, 0, TAU); g.fill(); });
    }
    glow(g, CY, 8, () => txt(g, (t % 1 < 0.5) ? '23:47' : '23 47', 38, 58, `500 40px ${F_D}`, CYW));
    scan(g, W, H);
  }, { fps: 14, intensity: 2.3 });
}

const SP0 = 222, SP1 = -42, SPMAX = 320;
function speedoPainter(val) {
  const S = 1024, c = 512, base = mkCanvas(S, S), b = base.getContext('2d');
  const bg = b.createRadialGradient(c, c, 40, c, c, 512); bg.addColorStop(0, '#052029'); bg.addColorStop(0.55, '#020d13'); bg.addColorStop(1, '#000407'); b.fillStyle = bg; b.fillRect(0, 0, S, S);
  b.strokeStyle = cy(0.07); b.lineWidth = 1; for (let i = 0; i < 48; i++) { const a = i / 48 * TAU; line(b, [[c + Math.cos(a) * 150, c + Math.sin(a) * 150], [c + Math.cos(a) * 480, c + Math.sin(a) * 480]]); }
  for (const [rr_, a] of [[150, .3], [215, .14], [300, .2], [372, .12]]) arc(b, c, c, rr_, 0, 360, { w: 1.5, color: cy(a) });
  arc(b, c, c, 258, 0, 360, { w: 2, color: cy(0.3), dash: [3, 9] });
  const A = v => SP0 + (SP1 - SP0) * v;
  arc(b, c, c, 446, SP0, SP1, { w: 12, color: cy(0.13) });
  glow(b, CY, 22, () => arc(b, c, c, 446, SP0, A(0.578), { w: 12, color: CYW, cap: 'round' }));
  ticks(b, c, c, 404, 424, SP0, SP1, 64, { w: 2, color: cy(0.75) });
  glow(b, CY, 8, () => ticks(b, c, c, 392, 428, SP0, SP1, 8, { w: 5, color: CYW }));
  glow(b, CY, 10, () => dialNums(b, c, c, 344, SP0, SP1, [0, 40, 80, 120, 160, 200, 240, 280, 320], `500 34px ${F_D}`, CYW));
  glow(b, MG, 26, () => { arc(b, c, c, 446, A(0.845), SP1, { w: 16, color: MG }); arc(b, c, c, 474, A(0.7), A(1.08), { w: 4, color: MG }); });
  arc(b, c, c, 492, 0, 360, { w: 2, color: cy(0.5) }); arc(b, c, c, 502, 200, 340, { w: 3, color: cy(0.8) }); arc(b, c, c, 502, 20, 160, { w: 3, color: cy(0.35), dash: [14, 8] });
  glow(b, CY, 12, () => txt(b, 'VEL', c, 392, `700 50px ${F_D}`, CYW, 'center'));
  txt(b, 'M / S', c, 660, `600 36px ${F_L}`, CYW, 'center');
  b.fillStyle = 'rgba(63,233,255,0.07)'; b.fillRect(c - 62, 690, 124, 80); txt(b, '0453', c, 722, `30px ${F_M}`, cy(0.7), 'center'); txt(b, '0453', c, 760, `30px ${F_M}`, cy(0.7), 'center');
  b.strokeStyle = cy(0.35); b.lineWidth = 1.5; line(b, [[c - 190, c], [c - 150, c]]); line(b, [[c + 150, c], [c + 190, c]]);
  return new Screen(S, S, (g, t) => {
    g.drawImage(base, 0, 0);
    const s = String(Math.round(val(t))).padStart(3, ' ');
    seg7(g, s, c, 432, 168, { color: '#eaffff', off: cy(0.07), glow: 26, align: 'center', thick: 0.13, gap: 0.24 });
    seg7(g, s, c, 432, 168, { color: '#ffffff', align: 'center', thick: 0.13, gap: 0.24 });
  }, { fps: 5, intensity: 1.7 });
}

function hudRing(seed, dense) {
  return decal(0.84, 0.84, 1024, 1024, (g, S) => {
    const r = rng(seed), c = S / 2;
    for (let i = 0; i < (dense ? 22 : 14); i++) {
      const rad = c * lerp(0.6, 0.985, r()), a0 = r() * 360, len = 8 + r() * r() * 150, w = r() < 0.25 ? 5 + r() * 5 : 1 + r() * 2, m = r() < 0.14;
      glow(g, m ? MG : CY, w > 4 ? 10 : 5, () => arc(g, c, c, rad, a0, a0 + len, { w, color: m ? mg(0.5 + r() * 0.5) : cy(0.25 + r() * 0.7) }));
    }
    arc(g, c, c, c * (dense ? 0.69 : 0.9), 0, 360, { w: 1.5, color: cy(0.35), dash: dense ? [2, 7] : [18, 5, 3, 5] });
    for (let i = 0; i < 5; i++) { const a = r() * 360; ticks(g, c, c, c * 0.78, c * 0.82, a, a + 18, 9, { w: 1.5, color: cy(0.6) }); }
  }, { emissive: 1.15, additive: true });
}
function hudStatic() {
  return decal(0.84, 0.84, 1024, 1024, (g, S) => {
    const c = S / 2;
    for (const [a0, n] of [[196, 9], [-74, 7]]) for (let i = 0; i < 14; i++) { const a = a0 + i * 3.6; const on = a0 > 0 ? i >= 14 - n : i < n; glow(g, CY, on ? 10 : 0, () => arc(g, c, c, c * 0.75, a, a + 2.5, { w: 34, color: on ? CYW : cy(0.12) })); }
    glow(g, MG, 14, () => { g.strokeStyle = MG; g.lineWidth = 4; line(g, [[4, c], [c * 0.42, c]]); line(g, [[S - 4, c], [S - c * 0.42, c]]); });
    for (const a of [228, -48]) { const x = c + Math.cos(a * PI / 180) * c * 0.9, y = c - Math.sin(a * PI / 180) * c * 0.9; glow(g, CY, 8, () => { arc(g, x, y, 12, 0, 360, { w: 3, color: CYW }); arc(g, x, y, 4, 0, 360, { w: 2, color: CYW }); }); }
    g.strokeStyle = cy(0.3); g.lineWidth = 1; for (let i = 0; i < 40; i++) { const a = i / 40 * TAU; line(g, [[c + Math.cos(a) * c * 0.6, c + Math.sin(a) * c * 0.6], [c + Math.cos(a) * c * 0.64, c + Math.sin(a) * c * 0.64]]); }
    const r = rng(9); g.strokeStyle = mg(0.7); g.lineWidth = 2; g.strokeRect(S * 0.83, S * 0.2, S * 0.15, S * 0.12); microText(g, S * 0.845, S * 0.215, S * 0.12, 6, r, mg(0.6), 9);
    g.strokeStyle = cy(0.5); g.strokeRect(S * 0.02, S * 0.16, S * 0.2, S * 0.17); microText(g, S * 0.03, S * 0.175, S * 0.17, 9, r, cy(0.5), 9);
  }, { emissive: 1.2, additive: true });
}

function dialPainter({ label, value, unit = '', nums, red = 0.75, size = 512, sub = null, fps = 2 }) {
  const S = size, c = S / 2, k = S / 512, base = mkCanvas(S, S), b = base.getContext('2d');
  const bg = b.createRadialGradient(c, c, 10, c, c, c); bg.addColorStop(0, '#04161d'); bg.addColorStop(1, '#00060a'); b.fillStyle = bg; b.fillRect(0, 0, S, S);
  const A0 = 220, A1 = -40, A = v => A0 + (A1 - A0) * v;
  arc(b, c, c, 218 * k, A0, A1, { w: 5 * k, color: cy(0.16) });
  glow(b, CY, 10 * k, () => arc(b, c, c, 218 * k, A0, A(red), { w: 5 * k, color: CY }));
  glow(b, MG, 14 * k, () => arc(b, c, c, 218 * k, A(red), A1, { w: 9 * k, color: MG }));
  ticks(b, c, c, 190 * k, 206 * k, A0, A1, (nums.length - 1) * 5, { w: 2 * k, color: cy(0.7) }); ticks(b, c, c, 182 * k, 208 * k, A0, A1, nums.length - 1, { w: 4 * k, color: CYW });
  glow(b, CY, 6 * k, () => dialNums(b, c, c, 148 * k, A0, A1, nums, `500 ${30 * k}px ${F_D}`, CYW));
  arc(b, c, c, 240 * k, 0, 360, { w: 2 * k, color: cy(0.4) }); arc(b, c, c, 96 * k, 0, 360, { w: 1.5 * k, color: cy(0.2) });
  if (label) txt(b, label, c, 214 * k, `600 ${32 * k}px ${F_L}`, CYW, 'center');
  if (sub) txt(b, sub, c, 470 * k, `${22 * k}px ${F_M}`, cy(0.6), 'center');
  return new Screen(S, S, (g, t) => { g.drawImage(base, 0, 0); if (value) glow(g, CY, 14 * k, () => txt(g, value(t) + unit, c, 396 * k, `500 ${50 * k}px ${F_D}`, '#eaffff', 'center')); }, { fps: value ? fps : 0, intensity: 2 });
}
function lcdPainter() {
  const S = 384, c = S / 2;
  return new Screen(S, S, (g, t) => {
    const bg = g.createRadialGradient(c, c, 10, c, c, c); bg.addColorStop(0, '#062a33'); bg.addColorStop(1, '#00080c'); g.fillStyle = bg; g.fillRect(0, 0, S, S);
    arc(g, c, c, 176, 0, 360, { w: 2, color: cy(0.5) }); ticks(g, c, c, 160, 172, 150, 390, 40, { w: 2, color: cy(0.6) });
    glow(g, CY, 12, () => { for (let i = 0; i < 7; i++) { const on = i < 5 + (Math.sin(t * 0.6) > 0.6 ? 1 : 0); g.fillStyle = on ? CYW : cy(0.12); g.fillRect(96, 110 + i * 15, 192 * (on ? 1 : 0.7), 10); } });
    g.fillStyle = cy(0.5); for (let i = 0; i < 8; i++) g.fillRect(64, 112 + i * 13, 14, 5);
    glow(g, CY, 12, () => txt(g, '78%', c, 296, `500 52px ${F_D}`, '#eaffff', 'center'));
    scan(g, S, S, 0.16);
  }, { fps: 1, intensity: 2.2 });
}
function musicPainter() {
  const W = 640, H = 368, N = 56, lv = new Float32Array(N), r = rng(3), ph = Array.from({ length: N }, () => r() * TAU);
  return new Screen(W, H, (g, t) => {
    g.fillStyle = '#020b10'; g.fillRect(0, 0, W, H);
    glow(g, CY, 8, () => txt(g, 'NEON WAVES', 30, 52, `700 34px ${F_L}`, '#eaffff'));
    txt(g, 'CYBERDRIVE', 30, 82, `500 22px ${F_L}`, CYW);
    microText(g, W - 130, 30, 100, 4, rng(8), cy(0.5), 9);
    glow(g, CY, 6, () => { arc(g, 348, 118, 16, 0, 360, { w: 2, color: CYW }); arc(g, 348, 118, 6, 0, 360, { w: 2, color: CYW }); g.strokeStyle = cy(0.5); g.lineWidth = 1; line(g, [[320, 118], [376, 118]]); line(g, [[348, 92], [348, 144]]); });
    const beat = Math.pow(Math.max(0, Math.sin(t * PI * 87 / 60)), 6);
    for (let i = 0; i < N; i++) {
      const env = 0.35 + 0.65 * Math.exp(-(((i - 14) / 13) ** 2)) + 0.5 * Math.exp(-(((i - 40) / 8) ** 2));
      const target = clamp(env * (0.32 + 0.4 * Math.abs(Math.sin(t * (2.1 + i * 0.13) + ph[i])) + 0.3 * beat * (i < 16 ? 1 : 0.4)) * (0.75 + 0.25 * Math.sin(t * 7 + ph[i] * 3)));
      lv[i] += (target - lv[i]) * 0.55; const h = lv[i] * 150, x = 30 + i * 10.3, u = i / N;
      const col = u < 0.42 ? `hsl(${186 - u * 60},100%,62%)` : u < 0.62 ? `hsl(${150 - (u - 0.42) * 420},100%,60%)` : u < 0.8 ? `hsl(${66 - (u - 0.62) * 80},100%,60%)` : `hsl(${96 + (u - 0.8) * 100},100%,62%)`;
      g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 8; g.fillRect(x, 262 - h, 6.2, h);
      if (i % 3 === 0) { g.fillStyle = MG; g.shadowColor = MG; g.fillRect(x, 262 - h * (0.9 + 0.5 * beat) - 8, 6.2, 3); }
    }
    g.shadowBlur = 0; g.fillStyle = cy(0.5); for (let i = 0; i < N; i++) g.fillRect(30 + i * 10.3, 268, 6.2, 2);
    txt(g, '⊹ 87 BPM', 30, 312, `22px ${F_M}`, CYW); txt(g, 'FREQ 44.1 kHz', 232, 312, `22px ${F_M}`, CYW); txt(g, '− -6.2   -6.1', W - 30, 312, `22px ${F_M}`, CYW, 'right');
    g.strokeStyle = cy(0.3); g.lineWidth = 1; line(g, [[30, 326], [W - 30, 326]]);
    g.fillStyle = CYW; const y = 346; g.fillRect(310, y - 9, 5, 18); g.fillRect(320, y - 9, 5, 18);
    for (const [x, d] of [[250, -1], [390, 1]]) { g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 12 * d, y); g.lineTo(x, y + 8); g.fill(); g.fillRect(x + 13 * d - (d < 0 ? 3 : 0), y - 8, 3, 16); }
    g.fillStyle = cy(0.6); g.fillRect(30, y - 2, 60, 3); g.fillStyle = CYW; g.fillRect(30, y - 2, 60 * ((t * 0.02) % 1), 3);
    g.strokeStyle = cy(0.45); g.lineWidth = 2; g.strokeRect(2, 2, W - 4, H - 4); scan(g, W, H);
  }, { fps: 20, intensity: 2.2 });
}
function thrusterPainter() {
  const W = 640, H = 400, r0 = rng(12);
  return new Screen(W, H, (g, t) => {
    g.fillStyle = '#020b10'; g.fillRect(0, 0, W, H);
    g.strokeStyle = cy(0.07); g.lineWidth = 1; for (let x = 0; x < W; x += 32) line(g, [[x, 0], [x, H]]); for (let y = 0; y < H; y += 32) line(g, [[0, y], [W, y]]);
    glow(g, CY, 6, () => txt(g, 'THRUSTER PRESSURE', 28, 46, `600 28px ${F_L}`, '#eaffff'));
    microText(g, W - 110, 30, 80, 2, rng(4), cy(0.5), 9);
    glow(g, CY, 10, () => shipTop(g, 372, 84, 210, 270, CYW, 2));
    const vals = [2.5, 2.6, 2.5, 2.7].map((v, i) => (v + (Math.sin(t * 0.4 + i * 2) > 0.92 ? 0.1 : 0)).toFixed(1));
    for (const [i, x, y, al, lx] of [[0, 268, 138, 'right', 322], [1, 480, 144, 'left', 422], [2, 268, 300, 'right', 296], [3, 484, 306, 'left', 448]]) {
      glow(g, CY, 6, () => txt(g, vals[i] + ' bar', x, y, `600 27px ${F_L}`, '#eaffff', al)); g.strokeStyle = cy(0.6); g.lineWidth = 1.5; line(g, [[x + (al === 'right' ? 8 : -8), y - 8], [lx, y - 8]]);
      microText(g, al === 'right' ? x - 90 : x, y + 10, 90, 2, rng(20 + i), cy(0.35), 8);
    }
    glow(g, CY, 6, () => { arc(g, 84, 136, 36, 0, 360, { w: 2, color: CYW }); for (let i = 0; i < 3; i++) { const a = t * 1.5 + i * TAU / 3; g.strokeStyle = CYW; g.lineWidth = 2; line(g, [[84, 136], [84 + Math.cos(a) * 28, 136 + Math.sin(a) * 28]]); } arc(g, 84, 136, 8, 0, 360, { w: 2, color: CYW }); });
    glow(g, CY, 6, () => { arc(g, 84, 286, 40, 0, 360, { w: 2, color: cy(0.8) }); g.strokeStyle = CYW; g.lineWidth = 2; g.beginPath(); for (let i = 0; i <= 20; i++) { const x = 52 + i * 3.2, y = 296 - 20 * Math.abs(Math.sin(i * 0.5 + t * 0.6)) * (0.4 + 0.6 * Math.sin(i * 0.9) ** 2); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); });
    microText(g, 28, 366, 180, 2, r0, cy(0.5), 10); g.fillStyle = AM; g.fillRect(W - 60, 370, 30, 6); g.fillStyle = CY; g.fillRect(W - 100, 370, 30, 6);
    g.strokeStyle = cy(0.45); g.lineWidth = 2; g.strokeRect(2, 2, W - 4, H - 4); scan(g, W, H);
  }, { fps: 6, intensity: 2.1 });
}
function sidePainter() {
  const W = 800, H = 184;
  return new Screen(W, H, (g, t) => {
    g.fillStyle = '#020b10'; g.fillRect(0, 0, W, H); const r = rng(31);
    glow(g, CY, 8, () => shipSide(g, 70, 44, 250, 100, CYW, 2));
    microText(g, 30, 22, 110, 1, r, cy(0.7), 9);
    g.strokeStyle = cy(0.4); g.lineWidth = 1; line(g, [[400, 20], [400, H - 20]]); line(g, [[530, 20], [530, H - 20]]);
    for (let i = 0; i < 7; i++) { const w = 90 * (0.3 + 0.7 * Math.abs(Math.sin(i * 1.7 + Math.floor(t * 1.5) * 0.7))); g.fillStyle = i === 2 ? MG : cy(0.85); g.fillRect(420, 34 + i * 18, w, 7); }
    microText(g, 550, 30, 210, 3, r, cy(0.6), 10);
    glow(g, CY, 6, () => { g.strokeStyle = CYW; g.lineWidth = 2; line(g, [[556, 132], [770, 132]]); arc(g, 580, 132, 16, 0, 360, { w: 2, color: CYW }); arc(g, 744, 132, 16, 0, 360, { w: 2, color: CYW }); });
    g.strokeStyle = cy(0.45); g.lineWidth = 2; g.strokeRect(2, 2, W - 4, H - 4); scan(g, W, H);
  }, { fps: 1.5, intensity: 2 });
}
function basePainter() {
  const W = 1024, H = 216;
  return new Screen(W, H, (g, t) => {
    g.fillStyle = '#020b10'; g.fillRect(0, 0, W, H); const r = rng(55);
    glow(g, CY, 10, () => txt(g, 'MANUAL', W / 2, 52, `600 42px ${F_L}`, '#eaffff', 'center'));
    glow(g, CY, 8, () => shipSide(g, 70, 36, 180, 70, CYW, 2));
    glow(g, CY, 6, () => { for (const [x, y] of [[308, 46], [308, 112]]) { arc(g, x, y, 15, 0, 360, { w: 3, color: CYW }); ticks(g, x, y, 17, 23, 0, 360, 8, { w: 4, color: CYW }); } shipTop(g, 716, 24, 60, 96, CYW, 1.6); g.strokeStyle = CYW; g.lineWidth = 2; g.strokeRect(858, 30, 62, 46); line(g, [[866, 76], [866, 88]]); line(g, [[912, 76], [912, 88]]); });
    glow(g, AM, 10, () => { g.strokeStyle = AM; g.lineWidth = 3; g.lineJoin = 'round'; line(g, [[952, 112], [972, 78], [992, 112]], true); txt(g, '!', 972, 108, `700 20px ${F_L}`, AM, 'center'); });
    g.strokeStyle = cy(0.5); g.lineWidth = 1.5; line(g, [[400, 118], [470, 82], [554, 82], [624, 118]]); g.strokeRect(476, 92, 72, 22); microText(g, 70, 124, 170, 2, r, cy(0.5), 9);
    g.fillStyle = CYW; g.fillRect(118, 160, 4, 30); g.fillRect(126, 166, 18, 3); txt(g, '⛽', 0, 0, '1px sans-serif', 'rgba(0,0,0,0)');
    for (let i = 0; i < 12; i++) { g.fillStyle = i < 8 ? (i < 2 ? AM : CYW) : cy(0.15); g.fillRect(164 + i * 13, 160, 9, 12); g.fillRect(164 + i * 13, 178, 9, 12); }
    txt(g, 'RANGE', 388, 190, `600 30px ${F_L}`, CYW); glow(g, CY, 12, () => txt(g, String(482 - Math.floor(t / 20) % 5), 484, 191, `700 40px ${F_L}`, '#fff')); txt(g, 'LS', 570, 190, `600 30px ${F_L}`, CYW);
    microText(g, 700, 164, 180, 3, r, cy(0.45), 10);
    glow(g, AM, 8, () => { g.strokeStyle = AM; g.lineWidth = 2.5; line(g, [[906, 192], [920, 168], [934, 192]], true); });
    g.strokeStyle = cy(0.45); g.lineWidth = 2; g.strokeRect(2, 2, W - 4, H - 4); scan(g, W, H);
  }, { fps: 1, intensity: 2.1 });
}
const ICONS = {
  ship: g => { line(g, [[20, 62], [28, 44], [40, 34], [56, 34], [68, 44], [76, 62], [20, 62]]); line(g, [[32, 46], [64, 46]]); g.strokeRect(24, 62, 10, 8); g.strokeRect(62, 62, 10, 8); },
  wave: g => { for (let i = 0; i < 9; i++) { const h = [6, 14, 26, 12, 30, 16, 24, 10, 6][i]; line(g, [[20 + i * 7, 48 - h / 2], [20 + i * 7, 48 + h / 2]]); } },
  fan: g => { for (let i = 0; i < 4; i++) { const a = i * PI / 2 + 0.3; g.beginPath(); g.ellipse(48 + Math.cos(a) * 13, 48 + Math.sin(a) * 13, 14, 7, a + 0.9, 0, TAU); g.stroke(); } g.beginPath(); g.arc(48, 48, 4, 0, TAU); g.stroke(); },
  seat: g => { line(g, [[38, 22], [32, 58], [62, 58], [66, 66], [30, 66]]); line(g, [[38, 22], [46, 24], [42, 52]]); line(g, [[36, 66], [34, 76]]); line(g, [[60, 66], [62, 76]]); },
  bolt: g => { line(g, [[54, 20], [34, 50], [48, 50], [42, 76], [64, 44], [50, 44], [54, 20]]); },
};

/* ---------- scene ---------- */
export function build(app) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x010204);
  const dash = new THREE.Group(); dash.rotation.x = -0.05; scene.add(dash);
  const screens = [], hide = [], needles = [], spin = [];
  const R = rng(2077);

  scene.environment = makeEnv(app.renderer, ({ scene: s, card, sky }) => {
    sky([[0, '#0b1626'], [0.45, '#05080e'], [1, '#020305']], 1);
    card(3.2, 0.22, 0x30e0ff, 16, [-2.6, 2.4, 2.6]); card(2.6, 0.2, 0xff2a90, 14, [3, 1.3, 3]);
    card(5, 1.4, 0x8fb8ff, 1.5, [0, 3.6, 1.2]); card(1.2, 2.4, 0xff3a70, 3.5, [4.6, 0.8, -0.4]); card(1.2, 2.4, 0x20c0ff, 3.2, [-4.6, 0.7, -0.4]);
    card(7, 2.6, 0x3458a8, 1.1, [0, 2.4, -5]); card(2.5, 0.12, 0xff8a3a, 8, [1.2, 2.9, 3.2]);
    card(1.3, 0.5, 0x30e0ff, 1.1, [-1.5, 0.3, 4.6]); card(0.3, 1.7, 0xff2a90, 2.0, [2.2, 0.5, 4.3]); card(2.4, 1.0, 0x1c2c48, 0.7, [0.6, 1.1, 5]);
    const r = rng(4); for (let i = 0; i < 54; i++) { const a = r() * TAU, e = -0.1 + r() * 1.1; card(0.12, 0.12, [0x30e0ff, 0xff2a90, 0xffd0a0, 0x9060ff, 0xffffff][i % 5], 60, [Math.cos(a) * 5 * Math.cos(e), 5 * Math.sin(e), Math.abs(Math.sin(a)) * 5 * Math.cos(e) + 0.5]); }
  });
  scene.environmentIntensity = 1.0;

  /* materials */
  const dr = Maps.drops(), br = Maps.brushed();
  const gun = new THREE.MeshStandardMaterial({ color: 0x242a31, metalness: 0.9, roughness: 0.55, roughnessMap: rep(Maps.roughWorn(3), 2.3), normalMap: rep(Maps.micro(), 10), normalScale: new THREE.Vector2(0.35, 0.35), map: rep(Maps.grime(41, 0.7), 1.4) });
  const gunWet = new THREE.MeshStandardMaterial({ color: 0x222830, metalness: 0.9, roughness: 0.46, roughnessMap: rep(dr.rough, 1.5), normalMap: rep(dr.normal, 1.5), normalScale: new THREE.Vector2(0.9, 0.9) });
  const edge = new THREE.MeshStandardMaterial({ color: 0x9fb0c0, metalness: 1, roughness: 0.34, roughnessMap: rep(Maps.roughGloss(5), 5) });
  const chrome = new THREE.MeshStandardMaterial({ color: 0x8f98a0, metalness: 1, roughness: 0.3, roughnessMap: rep(br.rough, 1, 5), normalMap: rep(br.normal, 1, 5), normalScale: new THREE.Vector2(0.25, 0.25) });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b949c, metalness: 1, roughness: 0.42, roughnessMap: rep(Maps.roughGloss(5), 3) });
  const black = new THREE.MeshStandardMaterial({ color: 0x06080a, metalness: 0.3, roughness: 0.42, roughnessMap: rep(Maps.roughGloss(6), 4) });
  const matte = new THREE.MeshStandardMaterial({ color: 0x0b0d10, metalness: 0.2, roughness: 0.85, normalMap: rep(Maps.grainN(), 14), normalScale: new THREE.Vector2(0.4, 0.4) });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.62, roughnessMap: rep(dr.rough, 3, 6), normalMap: rep(dr.normal, 3, 6) });
  const glass = glassMat({ opacity: 0.16, rough: 0.05, env: 0.8 });
  const glassD = glassMat({ opacity: 0.1, rough: 0.04, env: 0.65, smudgeRep: 0.7 });
  const neon = (hex, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
  const bolts = screwKit('hex', steel);

  /* shell + plates */
  dash.add(plate(poly([[-0.95, -0.22], [-0.85, -0.51], [0.85, -0.51], [0.95, -0.22], [0.95, 0.24], [0.80, 0.40], [-0.72, 0.40], [-0.93, 0.16]], 0.05), { d: 0.03, bevel: 0.004, seg: 3, mat: gunWet, edge, z: 0 }));
  const P1 = 0.03, P2 = 0.04;
  const plates = [
    [[-0.90, -0.215], [-0.90, 0.11], [-0.73, 0.325], [-0.385, 0.325], [-0.385, -0.215]],
    [[-0.795, -0.49], [-0.375, -0.49], [-0.375, -0.24], [-0.885, -0.24]],
    [[0.385, -0.24], [0.885, -0.24], [0.885, 0.2], [0.80, 0.29], [0.385, 0.29]],
    [[0.795, -0.49], [0.885, -0.265], [0.375, -0.265], [0.375, -0.49]],
  ];
  plates.forEach((p, i) => { dash.add(plate(poly(p, 0.03), { d: 0.01, bevel: 0.0016, mat: gun, edge, z: P1 })); p.forEach(([x, y]) => bolts.add(x * 0.93 + (i === 0 || i === 1 ? -0.045 : 0.045), y * 0.9 + 0.0, P2, 0.0055)); });
  // hud glass disc + bolt ring
  dash.add(plate(circ(0.405, 0, -0.08), { d: 0.005, bevel: 0.001, mat: black, edge: steel, z: P1, curve: 48 }));
  dash.add(sh(bezelRing(0.398, 0.014, 0.012, 0, steel)).translateX(0).translateY(-0.08).translateZ(P1));
  bolts.ring(0, -0.08, 0.405, 12, P1 + 0.012, 0.0045, 0.26);

  /* mounts */
  function mountScreen(x, y, w, h, scr, { fw = 0.013, r = 0.012, z = P2, d = 0.013, lightC = null, lightI = 0.3 } = {}) {
    const s = rr(w + fw * 2, h + fw * 2, r + fw * 0.7); s.holes.push(rrHole(w, h, r * 0.7, 0, 0));
    dash.add(plate(s, { d, bevel: 0.0016, mat: black, edge, z, x, y }));
    const back = quad(w + fw, h + fw, matte); back.position.set(x, y, z + 0.0015); dash.add(back);
    const q = quad(w, h, scr.mat, r * 0.7); q.position.set(x, y, z + 0.004); dash.add(q);
    const gl = quad(w, h, glass, r * 0.7); gl.position.set(x, y, z + d - 0.0025); gl.renderOrder = 5; dash.add(gl); hide.push(gl);
    bolts.corners(x, y, w + fw * 2, h + fw * 2, fw * 0.55, z + d, 0.003);
    screens.push(scr);
    if (lightC) { const l = new THREE.PointLight(lightC, lightI, 1.2, 2); l.position.set(x, y, z + 0.14); dash.add(l); }
  }
  function mountGauge(x, y, r, scr, { bw = r * 0.17, bh = 0.016, z = P2, bezel = chrome, needle = null, bulge = r * 0.14 } = {}) {
    const g = new THREE.Group(); g.position.set(x, y, z); dash.add(g);
    g.add(bezelRing(r, bw, bh, 0, bezel)); g.add(lathe([[r + bw * 1.5, 0], [r + bw * 1.5, bh * 0.25], [r + bw, bh * 0.3]], black, 64));
    const f = disc(r, scr.mat); f.position.z = 0.0008; g.add(f); screens.push(scr);
    let n = null;
    if (needle) {
      n = needleMesh(r * (needle.len ?? 0.82), r * 0.07, neon(needle.color ?? 0xbdf6ff, needle.k ?? 2.6), { tail: needle.tail ?? 0.12, thick: 0.001 }); n.position.z = bh * 0.3; n.castShadow = false; g.add(n);
      const hub = cyl(r * 0.1, r * 0.12, bh * 0.42, black, 24); hub.position.z = 0.001; g.add(hub);
      needles.push({ mesh: n, fn: needle.fn });
    }
    const gl = dome(r * 0.995, bulge, glassD); gl.position.z = bh * 0.72; g.add(gl); hide.push(gl);
    return g;
  }

  /* nav housing (stands proud, tilted toward pilot) */
  const navScr = navPainter();
  const nav = new THREE.Group(); nav.position.set(0, 0.362, 0.03); nav.rotation.x = 0.07; dash.add(nav);
  nav.add(plate(rr(0.76, 0.236, 0.022), { d: 0.03, bevel: 0.003, seg: 3, mat: gun, edge, z: 0 }));
  { const s = rr(0.735, 0.21, 0.016); s.holes.push(rrHole(0.7, 0.178, 0.008, 0, 0)); nav.add(plate(s, { d: 0.01, bevel: 0.0015, mat: black, edge: steel, z: 0.03 }));
    const q = quad(0.7, 0.178, navScr.mat, 0.008); q.position.z = 0.033; nav.add(q); screens.push(navScr);
    const gl = quad(0.7, 0.178, glass, 0.008); gl.position.z = 0.0385; gl.renderOrder = 5; nav.add(gl); hide.push(gl);
    const l = new THREE.PointLight(0x40e0ff, 0.35, 1.2, 2); l.position.set(0, -0.05, 0.2); nav.add(l);
    const lens = cyl(0.011, 0.013, 0.012, black, 24); lens.position.set(-0.395, 0.03, 0.02); lens.rotation.y = -PI / 2; nav.add(lens); }

  /* centre speedometer */
  const vel = t => 187 + 2.4 * Math.sin(t * 0.55) + 1.1 * Math.sin(t * 1.7 + 1) + 0.5 * Math.sin(t * 4.3);
  const sp = new THREE.Group(); sp.position.set(0, -0.08, P1 + 0.005); dash.add(sp);
  const hs = hudStatic(); hs.position.z = 0.0006; sp.add(hs);
  const h1 = hudRing(5, false), h2 = hudRing(9, true); h1.position.z = 0.0012; h2.position.z = 0.0018; sp.add(h1, h2); spin.push([h1, 0.05], [h2, -0.08]);
  sp.add(lathe([[0.262, 0], [0.262, 0.012], [0.256, 0.018], [0.246, 0.018], [0.244, 0.01]], gun, 96));
  const cb = bezelRing(0.208, 0.036, 0.034, 0, chrome, 120); sp.add(cb);
  sp.add(lathe([[0.208, 0.022], [0.196, 0.016], [0.193, 0.002]], black, 96));
  bolts.ring(0, -0.08, 0.253, 8, P1 + 0.005 + 0.018, 0.0042, 0.39);
  const spScr = speedoPainter(vel); const face = disc(0.196, spScr.mat, 96); face.position.z = 0.002; sp.add(face); screens.push(spScr);
  const ndl = needleMesh(0.176, 0.006, neon(0xaef4ff, 4.5), { tail: -0.36, thick: 0.001, tip: 0.5 }); ndl.position.z = 0.012; ndl.castShadow = false; sp.add(ndl);
  needles.push({ mesh: ndl, fn: t => (SP0 + (SP1 - SP0) * vel(t) / SPMAX - 90) * PI / 180 });
  const gl0 = dome(0.207, 0.022, glassD); gl0.position.z = 0.024; sp.add(gl0); hide.push(gl0);
  const cl = new THREE.PointLight(0x35e4ff, 0.26, 1.4, 2); cl.position.set(0, 0, 0.22); sp.add(cl);

  /* left cluster */
  mountGauge(-0.52, 0.185, 0.104, dialPainter({ label: 'COOLANT', nums: [0, 20, 40, 60, 80, 100, 120, 140, 160], red: 0.72, value: t => 102 + (Math.sin(t * 0.3) > 0.8 ? 1 : 0), unit: '°C' }), { bh: 0.02, needle: { fn: t => (220 - 260 * (0.64 + 0.008 * Math.sin(t * 0.9)) - 90) * PI / 180 } });
  mountGauge(-0.69, -0.005, 0.074, lcdPainter(), { bh: 0.014 });
  mountGauge(-0.505, -0.048, 0.056, dialPainter({ label: 'CELL', nums: [0, 25, 50, 75, 100], red: 0.86, value: () => '78', unit: '%', size: 384 }), { bh: 0.012, needle: { fn: t => (220 - 260 * (0.78 + 0.004 * Math.sin(t * 1.3)) - 90) * PI / 180 } });
  mountScreen(-0.615, -0.166, 0.345, 0.078, sidePainter(), { fw: 0.01, r: 0.008, d: 0.01, lightC: 0x40e0ff, lightI: 0.12 });
  const btn = (x, y, icon, color = CYW) => {
    dash.add(plate(rr(0.052, 0.052, 0.009), { d: 0.009, bevel: 0.0016, mat: black, edge: steel, z: P2, x, y }));
    const d = decal(0.046, 0.046, 96, 96, g => { g.fillStyle = 'rgba(8,40,50,0.9)'; g.fillRect(6, 6, 84, 84); g.strokeStyle = color; g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round'; g.shadowColor = color; g.shadowBlur = 8; g.strokeRect(8, 8, 80, 80); ICONS[icon](g); }, { emissive: 1.9 });
    d.position.set(x, y, P2 + 0.0094); dash.add(d);
  };
  ['ship', 'wave', 'fan', 'seat'].forEach((ic, i) => btn(-0.81 + i * 0.062, -0.285, ic));
  ['wave', 'ship', 'bolt'].forEach((ic, i) => btn(0.652 + i * 0.062, -0.305, ic));

  /* right cluster */
  mountScreen(0.60, 0.17, 0.37, 0.212, musicPainter(), { lightC: 0xff3aa0, lightI: 0.16 });
  mountScreen(0.60, -0.105, 0.37, 0.232, thrusterPainter(), { lightC: 0x40e0ff, lightI: 0.2 });
  // warning strip
  dash.add(plate(rr(0.40, 0.078, 0.02), { d: 0.012, bevel: 0.0016, mat: gun, edge, z: P1, x: 0.585, y: 0.345 }));
  { const w = decal(0.06, 0.055, 128, 118, (g, W, H) => { g.strokeStyle = MG; g.lineWidth = 9; g.lineJoin = 'round'; g.shadowColor = MG; g.shadowBlur = 14; line(g, [[14, H - 14], [W / 2, 12], [W - 14, H - 14]], true); g.fillStyle = MG; g.fillRect(W / 2 - 4, 46, 8, 30); g.fillRect(W / 2 - 4, 84, 8, 8); }, { emissive: 3, additive: true }); w.position.set(0.44, 0.347, P1 + 0.0125); dash.add(w);
    const a = decal(0.04, 0.03, 96, 72, g => { g.fillStyle = AM; g.shadowColor = AM; g.shadowBlur = 10; g.fillRect(14, 12, 68, 12); g.fillRect(14, 32, 68, 12); g.fillStyle = '#ff5a2a'; g.fillRect(14, 52, 68, 10); }, { emissive: 2.6, additive: true }); a.position.set(0.525, 0.349, P1 + 0.0125); dash.add(a);
    for (const x of [0.62, 0.70]) { const g = new THREE.Group(); g.position.set(x, 0.345, P1 + 0.012); dash.add(g); g.add(lathe([[0.03, 0], [0.03, 0.006], [0.027, 0.009], [0.017, 0.009], [0.016, 0.002]], black, 40)); const t = new THREE.Mesh(new THREE.TorusGeometry(0.0215, 0.0028, 10, 48), neon(0xff2e93, 3.4)); t.position.z = 0.0085; g.add(t); g.add(cyl(0.013, 0.014, 0.008, black, 28)); }
    const l = new THREE.PointLight(0xff2e93, 0.14, 0.8, 2); l.position.set(0.62, 0.34, P1 + 0.1); dash.add(l); }

  /* base console */
  dash.add(plate(poly([[-0.36, -0.492], [0.36, -0.492], [0.335, -0.30], [-0.335, -0.30]], 0.03), { d: 0.016, bevel: 0.002, mat: gun, edge, z: P1 }));
  mountScreen(0, -0.392, 0.60, 0.126, basePainter(), { z: P1 + 0.016, fw: 0.011, r: 0.01, d: 0.011, lightC: 0x40e0ff, lightI: 0.18 });
  const small = (x, r, num, v) => mountGauge(x, -0.405, r, dialPainter({ nums: ['', '', '', '', ''], red: 0.8, size: 256, sub: null, label: null, value: () => num, fps: 0.5 }), { bh: 0.012, needle: { fn: t => (220 - 260 * (v + 0.012 * Math.sin(t * (1 + r * 9) + x * 7)) - 90) * PI / 180 } });
  small(-0.69, 0.05, '100', 0.42); small(-0.47, 0.056, '5800', 0.66); small(0.47, 0.054, '220', 0.33); small(0.69, 0.048, '5.2V', 0.52);
  for (const s of [-1, 1]) {
    const d = decal(0.085, 0.085, 192, 192, g => { const r = rng(s + 5); g.fillStyle = '#01090d'; g.fillRect(0, 0, 192, 192); for (let i = 0; i < 4; i++) { g.fillStyle = [CY, CY, AM, MG][i]; g.fillRect(16 + i * 22, 18, 14, 8); } g.shadowColor = CY; g.shadowBlur = 8; txt(g, '0.8', 96, 98, `600 44px ${F_L}`, '#eaffff', 'center'); g.shadowBlur = 0; for (let i = 0; i < 9; i++) { g.fillStyle = i < 6 ? CYW : cy(0.15); g.fillRect(18 + i * 18, 126, 12, 16); } microText(g, 18, 158, 150, 2, r, cy(0.5), 10); }, { emissive: 1.8 });
    d.position.set(s * 0.58, -0.405, P2 + 0.0105); dash.add(plate(rr(0.094, 0.094, 0.008), { d: 0.01, bevel: 0.0014, mat: black, edge: steel, z: P2, x: s * 0.58, y: -0.405 })); dash.add(d);
  }
  bolts.build(dash);

  /* mechanical clutter on the port side */
  const ribs = []; for (let i = 0; i < 9; i++) { const z = i * 0.011; ribs.push([0.03, z], [0.04, z + 0.002], [0.04, z + 0.006], [0.03, z + 0.008]); }
  const motor = lathe([[0.001, -0.004], [0.03, -0.004], ...ribs, [0.03, 0.1], [0.018, 0.108], [0.001, 0.108]], steel, 40); motor.rotation.y = -PI / 2 + 0.25; motor.position.set(-0.86, 0.05, 0.055); dash.add(motor);
  for (const [pts, rad] of [
    [[[-0.93, 0.02, 0.05], [-1.0, -0.04, 0.09], [-1.05, -0.2, 0.06], [-1.02, -0.42, 0.0], [-1.1, -0.62, -0.05]], 0.012],
    [[[-0.9, 0.12, 0.04], [-0.98, 0.14, 0.08], [-1.08, 0.02, 0.07], [-1.12, -0.2, 0.02], [-1.2, -0.5, -0.04]], 0.008],
    [[[-0.88, -0.3, 0.035], [-0.97, -0.32, 0.07], [-1.02, -0.45, 0.05], [-1.0, -0.62, 0.0]], 0.006],
    [[[0.93, -0.05, 0.03], [1.0, -0.1, 0.06], [1.04, -0.3, 0.04], [1.02, -0.6, 0.0]], 0.009],
    [[[0.9, 0.22, 0.02], [1.0, 0.2, 0.05], [1.08, 0.05, 0.03], [1.12, -0.3, 0.0]], 0.006],
  ]) dash.add(cable(pts, rad, rubber));
  for (const [x, y, w, h] of [[-0.905, 0.2, 0.07, 0.05], [0.9, -0.36, 0.06, 0.09], [-0.9, -0.4, 0.05, 0.06]]) dash.add(plate(rr(w, h, 0.006), { d: 0.03, bevel: 0.002, mat: gun, edge, x, y, z: 0.0 }));

  /* cockpit surroundings */
  const cowl = box(2.8, 0.05, 1.1, gunWet, 0, 0.44, -0.56); cowl.rotation.x = 0.06; scene.add(cowl);
  const sill = box(3.2, 0.9, 0.2, matte, 0, -0.98, -0.12); scene.add(sill);
  const floor = box(3.4, 0.03, 1.6, gunWet, 0, -0.565, 0.72); scene.add(floor);
  for (const s of [-1, 1]) { const p = box(0.16, 2.6, 0.2, matte, s * 1.46, 0.9, -0.5); p.rotation.z = -s * 0.5; p.rotation.y = s * 0.3; scene.add(p); const w = box(0.7, 1.5, 0.08, gun, s * 1.42, -0.1, 0.25); w.rotation.y = -s * 1.1; scene.add(w); }
  const header = box(3.6, 0.3, 0.3, matte, 0, 1.52, -0.3); scene.add(header);

  /* rain-smeared city */
  { const W = 1024, H = 512, c = mkCanvas(W, H), g = c.getContext('2d'), r = rng(5);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#04060c'); gr.addColorStop(0.55, '#0a1424'); gr.addColorStop(1, '#03050a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    try { g.filter = 'blur(7px)'; } catch (e) { /* no filter support */ }
    for (let i = 0; i < 46; i++) { const w = 30 + r() * 90, h = 120 + r() * 360; g.fillStyle = `rgba(${6 + r() * 10 | 0},${10 + r() * 16 | 0},${18 + r() * 26 | 0},0.9)`; g.fillRect(r() * W - w / 2, H - h, w, h); }
    g.globalCompositeOperation = 'lighter';
    const pal = ['#22e6ff', '#ff2e93', '#ff4a5a', '#1fd0c0', '#ffb060', '#7a6cff', '#22e6ff', '#ff2e93'];
    for (let i = 0; i < 34; i++) { g.filter = `blur(${5 + r() * 12}px)`; g.fillStyle = pal[(r() * pal.length) | 0]; g.globalAlpha = 0.25 + r() * 0.6; const v = r() < 0.55; g.fillRect(r() * W, H * (0.15 + r() * 0.7), v ? 8 + r() * 22 : 50 + r() * 170, v ? 40 + r() * 150 : 6 + r() * 16); }
    for (let i = 0; i < 190; i++) { g.filter = `blur(${0.8 + r() * 1.6}px)`; const col = pal[(r() * pal.length) | 0], rad = 3 + r() * r() * 17, x = r() * W, y = H * (0.2 + r() * 0.78); g.globalAlpha = 0.1 + r() * 0.42; g.fillStyle = col; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill(); g.globalAlpha *= 0.8; g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, rad - 0.6, 0, TAU); g.stroke(); }
    g.filter = 'none'; g.globalAlpha = 1;
    const city = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: canvasTex(c), color: new THREE.Color(1.9, 1.9, 1.9) })); city.position.set(0, 2.2, -9); scene.add(city);
    const c2 = mkCanvas(1024, 512), d = c2.getContext('2d');
    for (let i = 0; i < 900; i++) { const x = r() * 1024, y = r() * 512, rad = 1 + r() * r() * 7, col = pal[(r() * pal.length) | 0]; const rg = d.createRadialGradient(x, y + rad * 0.35, 0, x, y, rad); rg.addColorStop(0, col); rg.addColorStop(0.5, 'rgba(120,160,200,0.25)'); rg.addColorStop(1, 'rgba(0,0,0,0)'); d.globalAlpha = 0.25 + r() * 0.6; d.fillStyle = rg; d.beginPath(); d.arc(x, y, rad, 0, TAU); d.fill(); }
    for (let i = 0; i < 60; i++) { const x = r() * 1024, y = r() * 400; const lg = d.createLinearGradient(0, y, 0, y + 90); lg.addColorStop(0, 'rgba(160,200,255,0)'); lg.addColorStop(1, 'rgba(160,200,255,0.25)'); d.fillStyle = lg; d.globalAlpha = 0.6; d.fillRect(x, y, 1.5, 40 + r() * 70); }
    const rain = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2), new THREE.MeshBasicMaterial({ map: canvasTex(c2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.5, 1.5, 1.5) })); rain.position.set(0, 1.3, -1.25); rain.rotation.x = -0.5; scene.add(rain);
  }

  /* lights */
  const key = new THREE.SpotLight(0xbcd4ff, 38, 9, 0.55, 1, 2); key.position.set(-0.7, 1.7, 2.0); key.target.position.set(0, -0.1, 0); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.0015; key.shadow.camera.near = 0.8; key.shadow.camera.far = 5; scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x78aaff, 2.4); rim.position.set(0.6, 2, -1.6); scene.add(rim);
  const m1 = new THREE.PointLight(0xff2e93, 0.5, 2.5, 2); m1.position.set(1.0, 0.5, 0.6); scene.add(m1);
  const c1 = new THREE.PointLight(0x30e0ff, 0.45, 2.5, 2); c1.position.set(-1.1, 0.4, 0.6); scene.add(c1);
  const low = new THREE.PointLight(0xff3a90, 0.22, 2, 2); low.position.set(0.2, -0.7, 0.6); scene.add(low);

  for (const s of screens) s.update(0);
  return {
    scene, hide,
    look: { exposure: 1.05, tone: THREE.ACESFilmicToneMapping, contrast: 1.06, sat: 1.04, sharp: 0.45, bloom: [0.3, 0.7, 1.0], focus: 2.0, aperture: 2.4, maxBlur: 18, ca: 0.0045, distort: 0.035, vig: 0.75, grain: 0.055, lift: 0.006, ao: { radius: 0.045, intensity: 1 }, cam: [0, 0.01, 2.0], target: [0, -0.01, 0], tint: [0.98, 1.0, 1.04] },
    update(t, dt) {
      for (const s of screens) s.update(t);
      for (const n of needles) n.mesh.rotation.z = n.fn(t);
      for (const [m, w] of spin) m.rotation.z += w * dt;
      const fl = 0.92 + 0.08 * Math.sin(t * 13) * Math.sin(t * 2.3); cl.intensity = 0.26 * fl;
    },
  };
}
