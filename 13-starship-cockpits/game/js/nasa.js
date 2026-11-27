// NASA-punk command module: chipped blue-grey paint, cream analog dials, amber seven-segment clocks, fluorescent overhead light.
import { THREE, PI, TAU, clamp, lerp, rng, Maps, rep, mkCanvas, canvasTex, seg7, ticks, arc, dialNums, microText, wear, sh, rr, rrHole, circHole, poly, plate, box, cyl, lathe, bezelRing, dome, needleMesh, quad, disc, cable, Instancer, screwKit, toggleKit, knob, lamp, Screen, sheet, decal, glassMat, makeEnv } from './core.js';

const CREAM = '#dcd4bb', NAVY = '#1b3552', BLUE = '#2f74aa', ORG = '#e3641c', INK = '#15171a', WHT = '#ece9df', AMB = '#ffb23a';
const F_N = '"Barlow Condensed", "Arial Narrow", sans-serif', F_M = '"Share Tech Mono", Consolas, monospace';
const txt = (g, s, x, y, font, color, align = 'center', base = 'middle') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = base; g.fillText(s, x, y); };
const line = (g, pts, close = false) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (close) g.closePath(); g.stroke(); };
const wedge = (g, c, r0, r1, a0, a1, col) => { g.fillStyle = col; g.beginPath(); g.arc(c, c, r1, -a0 * PI / 180, -a1 * PI / 180, true); g.arc(c, c, r0, -a1 * PI / 180, -a0 * PI / 180, false); g.closePath(); g.fill(); };

/* ---------- printed dial faces (lit by the cabin, not self-luminous) ---------- */
function face(S, bg, fn, seed = 1) {
  const c = mkCanvas(S, S), g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, S, S); fn(g, S / 2, S / 512);
  const v = g.createRadialGradient(S / 2, S / 2, S * 0.22, S / 2, S / 2, S * 0.5); v.addColorStop(0, 'rgba(40,24,0,0)'); v.addColorStop(1, 'rgba(40,24,0,0.28)'); g.fillStyle = v; g.fillRect(0, 0, S, S);
  const r = rng(seed); for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(30,20,8,${r() * 0.2})`; g.beginPath(); g.arc(r() * S, r() * S, r() * 1.8 * S / 512, 0, TAU); g.fill(); }
  return canvasTex(c);
}
const fAttitude = (v = 0) => face(512, CREAM, (g, c, k) => {
  ticks(g, c, c, 222 * k, 240 * k, 0, 360, 72, { w: 2 * k, color: INK }); ticks(g, c, c, 210 * k, 240 * k, 0, 360, 12, { w: 4 * k, color: INK });
  dialNums(g, c, c, 188 * k, 90, -240, [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33], `600 ${24 * k}px ${F_N}`, INK);
  g.fillStyle = NAVY; g.beginPath(); g.arc(c, c, 158 * k, 0, TAU); g.fill();
  if (v === 1) { wedge(g, c, 60 * k, 158 * k, 60, -20, ORG); wedge(g, c, 0, 158 * k, 200, 260, BLUE); }
  if (v === 2) { wedge(g, c, 0, 158 * k, 100, 190, BLUE); wedge(g, c, 0, 158 * k, -60, 10, ORG); }
  for (const rr_ of [52, 105]) arc(g, c, c, rr_ * k, 0, 360, { w: 1.5 * k, color: 'rgba(236,233,223,0.55)' });
  g.strokeStyle = WHT; g.lineWidth = 2.5 * k; line(g, [[c - 158 * k, c], [c + 158 * k, c]]); line(g, [[c, c - 158 * k], [c, c + 158 * k]]);
  ticks(g, c, c, 140 * k, 156 * k, 0, 360, 36, { w: 1.5 * k, color: WHT });
}, 3 + v);
const fRadar = () => face(512, CREAM, (g, c, k) => {
  ticks(g, c, c, 224 * k, 240 * k, 0, 360, 60, { w: 2 * k, color: INK });
  g.fillStyle = '#16212c'; g.beginPath(); g.arc(c, c, 206 * k, 0, TAU); g.fill();
  for (const rr_ of [40, 82, 124, 166]) arc(g, c, c, rr_ * k, 0, 360, { w: 1.5 * k, color: 'rgba(236,233,223,0.5)' });
  g.strokeStyle = 'rgba(236,233,223,0.45)'; g.lineWidth = 1.5 * k; for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; line(g, [[c, c], [c + Math.cos(a) * 204 * k, c + Math.sin(a) * 204 * k]]); }
  arc(g, c, c, 124 * k, 20, 110, { w: 9 * k, color: ORG }); arc(g, c, c, 166 * k, -60, 10, { w: 7 * k, color: ORG }); arc(g, c, c, 82 * k, 180, 250, { w: 6 * k, color: ORG });
  g.fillStyle = WHT; for (const [a, rr_] of [[40, 150], [200, 95], [300, 130]]) { g.beginPath(); g.arc(c + Math.cos(a * PI / 180) * rr_ * k, c - Math.sin(a * PI / 180) * rr_ * k, 5 * k, 0, TAU); g.fill(); }
}, 9);
const fPressure = () => face(512, '#d9601b', (g, c, k) => {
  arc(g, c, c, 236 * k, 0, 360, { w: 6 * k, color: '#f1e9d6' });
  ticks(g, c, c, 196 * k, 222 * k, 225, -45, 50, { w: 2.5 * k, color: '#f6efe0' }); ticks(g, c, c, 182 * k, 222 * k, 225, -45, 10, { w: 6 * k, color: '#f6efe0' });
  dialNums(g, c, c, 150 * k, 225, -45, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], `600 ${34 * k}px ${F_N}`, '#fff6e6');
  arc(g, c, c, 108 * k, 0, 360, { w: 2 * k, color: 'rgba(255,240,220,0.6)' });
  txt(g, 'PRESSURE', c, c + 150 * k, `600 ${28 * k}px ${F_N}`, '#fff6e6'); txt(g, 'PSIA', c, c - 70 * k, `600 ${22 * k}px ${F_N}`, '#fff6e6');
}, 11);
const fCream = (label, nums, redFrom = 0.8) => face(256, CREAM, (g, c, k) => {
  arc(g, c, c, 204 * k, 210 - 240 * redFrom, -30, { w: 14 * k, color: ORG });
  ticks(g, c, c, 190 * k, 214 * k, 210, -30, (nums.length - 1) * 5, { w: 3 * k, color: INK }); ticks(g, c, c, 176 * k, 214 * k, 210, -30, nums.length - 1, { w: 6 * k, color: INK });
  dialNums(g, c, c, 138 * k, 210, -30, nums, `600 ${46 * k}px ${F_N}`, INK); txt(g, label, c, c + 120 * k, `600 ${40 * k}px ${F_N}`, INK);
}, label.length);
const fDark = (label, nums, a0 = 0.6, a1 = 0.9) => face(384, '#111417', (g, c, k) => {
  arc(g, c, c, 238 * k, 0, 360, { w: 4 * k, color: 'rgba(236,233,223,0.5)' });
  arc(g, c, c, 206 * k, 220 - 260 * a0, 220 - 260 * a1, { w: 18 * k, color: ORG });
  ticks(g, c, c, 192 * k, 216 * k, 220, -40, (nums.length - 1) * 5, { w: 2.5 * k, color: WHT }); ticks(g, c, c, 178 * k, 216 * k, 220, -40, nums.length - 1, { w: 5 * k, color: WHT });
  dialNums(g, c, c, 144 * k, 220, -40, nums, `600 ${36 * k}px ${F_N}`, WHT);
  label.split('\n').forEach((s, i) => txt(g, s, c, c + (108 + i * 38) * k, `600 ${34 * k}px ${F_N}`, WHT));
}, label.length + 20);
const fFlight = (big = false) => face(768, CREAM, (g, c, k) => {
  k = c / 256; ticks(g, c, c, 226 * k, 242 * k, 0, 360, 120, { w: 1.6 * k, color: INK }); ticks(g, c, c, 214 * k, 242 * k, 0, 360, 24, { w: 3.4 * k, color: INK });
  g.fillStyle = NAVY; g.beginPath(); g.arc(c, c, 204 * k, 0, TAU); g.fill();
  wedge(g, c, 0, 204 * k, big ? 100 : 195, big ? 180 : 250, BLUE); wedge(g, c, 0, big ? 204 * k : 150 * k, big ? -55 : 150, big ? 20 : 195, ORG);
  for (const rr_ of [50, 100, 152]) arc(g, c, c, rr_ * k, 0, 360, { w: 1.4 * k, color: 'rgba(236,233,223,0.6)' });
  g.strokeStyle = 'rgba(236,233,223,0.55)'; g.lineWidth = 1.4 * k; for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; line(g, [[c + Math.cos(a) * 50 * k, c + Math.sin(a) * 50 * k], [c + Math.cos(a) * 204 * k, c + Math.sin(a) * 204 * k]]); }
  g.strokeStyle = WHT; g.lineWidth = 2.4 * k; line(g, [[c - 204 * k, c], [c + 204 * k, c]]); line(g, [[c, c - 204 * k], [c, c + 204 * k]]);
  if (!big) { g.save(); g.translate(c, c); const s = 'FLIGHT PATH'; g.font = `600 ${22 * k}px ${F_N}`; g.fillStyle = WHT; g.textAlign = 'center'; g.textBaseline = 'middle'; for (let i = 0; i < s.length; i++) { const a = (-90 + (i - (s.length - 1) / 2) * 6.4) * PI / 180; g.save(); g.translate(Math.cos(a) * 178 * k, Math.sin(a) * 178 * k); g.rotate(a + PI / 2); g.fillText(s[i], 0, 0); g.restore(); } g.restore(); }
}, big ? 31 : 32);

/* ---------- self-luminous displays ---------- */
function crtPainter(W = 560, H = 480, small = false) {
  const r0 = rng(small ? 6 : 5), base = mkCanvas(W, H), b = base.getContext('2d');
  b.fillStyle = '#08131d'; b.fillRect(0, 0, W, H);
  const ox = W * 0.5, oy = H * 0.56;
  b.strokeStyle = 'rgba(150,200,235,0.28)'; b.lineWidth = 1.2; for (let i = 1; i < 7; i++) { b.beginPath(); b.arc(ox - W * 0.3, oy + H * 0.34, i * W * 0.13, -PI / 2 - 0.2, 0.15); b.stroke(); }
  for (let i = 0; i < 7; i++) { const a = -PI / 2 - 0.2 + i * 0.3; line(b, [[ox - W * 0.3, oy + H * 0.34], [ox - W * 0.3 + Math.cos(a) * W, oy + H * 0.34 + Math.sin(a) * W]]); }
  microText(b, 18, 16, W * 0.3, 2, r0, 'rgba(200,225,240,0.7)', 9); microText(b, W * 0.62, 16, W * 0.3, 2, r0, 'rgba(200,225,240,0.7)', 9); microText(b, 18, H - 30, W * 0.25, 2, r0, 'rgba(200,225,240,0.6)', 9); microText(b, W * 0.68, H - 30, W * 0.26, 2, r0, 'rgba(200,225,240,0.6)', 9);
  const sc = mkCanvas(W, H), s = sc.getContext('2d'); s.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < H; y += 3) s.fillRect(0, y, W, 1);
  const vg = s.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, W * 0.66); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.6)'); s.fillStyle = vg; s.fillRect(0, 0, W, H);
  return new Screen(W, H, (g, t) => {
    g.drawImage(base, 0, 0);
    const sw = (small ? 0.5 : 0.25) + 0.12 * Math.sin(t * 0.25);
    g.fillStyle = 'rgba(52,134,196,0.92)'; g.shadowColor = '#3a9be0'; g.shadowBlur = 14; g.beginPath(); g.moveTo(ox, oy); g.arc(ox, oy, H * (small ? 0.4 : 0.36), -PI / 2 - (small ? 1.2 : 0) + sw * 0.2, -0.28 + sw * 0.5 - (small ? 0.9 : 0)); g.closePath(); g.fill(); g.shadowBlur = 0;
    g.strokeStyle = 'rgba(8,19,29,0.5)'; g.lineWidth = 1.5; for (let i = 1; i < 4; i++) { g.beginPath(); g.arc(ox, oy, H * 0.1 * i, -PI / 2 - 1.3, 0.3); g.stroke(); }
    g.fillStyle = '#ff8a3c'; g.shadowColor = '#ff7a2a'; g.shadowBlur = 8;
    for (let i = 0; i < 26; i++) { const u = i / 25, x = ox - W * 0.26 + u * W * 0.5, y = oy + H * 0.02 - Math.sin(u * 2.2 + 0.3) * H * 0.07 + u * u * H * 0.22; if (u < 0.45 || i % 2 === 0) g.fillRect(x, y, u < 0.45 ? 9 : 4, 3); }
    const k = (t * 0.12) % 1, bx = ox - W * 0.26 + k * W * 0.5, by = oy + H * 0.02 - Math.sin(k * 2.2 + 0.3) * H * 0.07 + k * k * H * 0.22; g.beginPath(); g.arc(bx, by, 5, 0, TAU); g.fill();
    g.shadowColor = '#fff'; g.strokeStyle = '#f2f6f8'; g.lineWidth = 3; line(g, [[ox - 20, oy], [ox + 20, oy]]); line(g, [[ox, oy - 20], [ox, oy + 20]]); g.shadowBlur = 0;
    g.fillStyle = `rgba(160,210,240,${0.03 + 0.02 * Math.sin(t * 50)})`; g.fillRect(0, ((t * 60) % (H + 80)) - 80, W, 80);
    g.drawImage(sc, 0, 0);
  }, { fps: 12, intensity: 1.7 });
}
function trajectoryPainter() {
  const W = 640, H = 500, r = rng(8);
  return new Screen(W, H, g => {
    g.fillStyle = '#1b232b'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(225,232,236,0.22)'; g.lineWidth = 1; for (let x = 40; x < W; x += 40) line(g, [[x, 0], [x, H]]); for (let y = 30; y < H; y += 40) line(g, [[0, y], [W, y]]);
    const cx = 360, cy = 250; g.strokeStyle = 'rgba(232,238,240,0.85)'; g.lineWidth = 1.6;
    for (const rr_ of [70, 120, 172]) { g.beginPath(); g.arc(cx, cy, rr_, 0, TAU); g.stroke(); }
    line(g, [[cx - 230, cy], [cx + 220, cy]]); line(g, [[cx, cy - 200], [cx, cy + 200]]); line(g, [[cx - 200, cy + 160], [cx + 190, cy - 170]]); line(g, [[cx - 170, cy - 150], [cx + 190, cy + 150]]);
    g.beginPath(); g.ellipse(cx - 20, cy + 10, 215, 120, -0.35, 0, TAU); g.stroke();
    g.strokeStyle = '#ff8a3c'; g.lineWidth = 4; g.shadowColor = '#ff7a2a'; g.shadowBlur = 8; line(g, [[cx - 96, cy + 96], [cx - 8, cy + 6]]); g.fillStyle = '#ff8a3c'; for (const [x, y] of [[cx - 96, cy + 96], [cx - 8, cy + 6], [cx - 30, cy - 58], [cx + 84, cy - 10]]) { g.beginPath(); g.arc(x, y, 5, 0, TAU); g.fill(); } g.shadowBlur = 0;
    txt(g, 'TRAJECTORY', 150, 36, `600 26px ${F_N}`, '#eef2f2'); txt(g, 'RANGE', 52, 228, `600 20px ${F_N}`, '#eef2f2', 'left'); txt(g, '000.0', 52, 252, `20px ${F_M}`, '#eef2f2', 'left');
    txt(g, 'TARGET', 190, 418, `600 20px ${F_N}`, '#eef2f2'); txt(g, 'HORIZON', 340, 470, `600 20px ${F_N}`, '#eef2f2');
    microText(g, 430, 30, 170, 3, r, 'rgba(232,238,240,0.55)', 9); microText(g, 40, 100, 90, 4, r, 'rgba(232,238,240,0.5)', 9); microText(g, 150, 432, 110, 2, r, 'rgba(232,238,240,0.5)', 8);
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)'); g.fillStyle = v; g.fillRect(0, 0, W, H);
  }, { fps: 0, intensity: 0.95 });
}
const metString = t => { const s = 3 * 3600 + 47 * 60 + 21 + Math.floor(t); return String(Math.floor(s / 3600)).padStart(3, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
function clockPainter(W, H, hgt, str, round = false) {
  return new Screen(W, H, (g, t) => {
    g.fillStyle = round ? '#0d0f11' : '#0a0806'; g.fillRect(0, 0, W, H);
    if (round) { arc(g, W / 2, H / 2, W * 0.47, 0, 360, { w: 3, color: 'rgba(236,233,223,0.6)' }); ticks(g, W / 2, H / 2, W * 0.4, W * 0.45, 0, 360, 60, { w: 2, color: 'rgba(236,233,223,0.7)' }); txt(g, 'MISSION', W / 2, H * 0.27, `600 ${H * 0.085}px ${F_N}`, WHT); txt(g, 'ELAPSED TIME', W / 2, H * 0.36, `600 ${H * 0.07}px ${F_N}`, WHT); g.fillStyle = '#0a0806'; g.fillRect(W * 0.14, H * 0.42, W * 0.72, H * 0.24); }
    const s = typeof str === 'function' ? str(t) : str, y = round ? H * 0.46 : (H - hgt) / 2;
    seg7(g, s, W / 2, y, hgt, { color: AMB, off: 'rgba(255,170,50,0.07)', glow: hgt * 0.25, align: 'center', thick: 0.11, gap: 0.2 });
    seg7(g, s, W / 2, y, hgt, { color: '#ffd9a0', align: 'center', thick: 0.07, gap: 0.2 });
  }, { fps: typeof str === 'function' ? 2 : 0, intensity: 2.2 });
}

export function build(app) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x040506);
  const screens = [], hide = [], needles = [], R = rng(1969);

  scene.environment = makeEnv(app.renderer, ({ card, sky }) => {
    sky([[0, '#1a1c1e'], [0.4, '#0b0c0d'], [1, '#050505']], 1);
    card(2.4, 0.16, 0xfff0d2, 26, [-0.5, 2.6, 1.6]); card(2.4, 0.16, 0xfff0d2, 26, [1.1, 2.6, 1.4]); card(4, 1.2, 0xffe6c0, 1.6, [0, 3.2, 0.2]);
    card(0.9, 1.3, 0x7fa6d8, 2.2, [-4, 1.4, 1.5]); card(0.9, 1.3, 0x7fa6d8, 1.8, [4, 1.6, 1.2]); card(3, 1.6, 0x4a4036, 1.2, [0, 0.6, 5]);
    card(0.5, 0.3, 0xffb060, 7, [1.6, 0.3, 4]); card(0.25, 0.25, 0xff4030, 8, [-2.2, -0.2, 3.6]); card(1.6, 0.1, 0xfff0d2, 9, [-1.2, 1.9, 4]);
  });
  scene.environmentIntensity = 0.55;

  /* materials */
  const br = Maps.brushed();
  const mkPaint = (hex, rough = 0.62, seed = 41) => new THREE.MeshStandardMaterial({ color: hex, metalness: 0.15, roughness: rough, roughnessMap: rep(Maps.roughWorn(7), 2.6), normalMap: rep(Maps.peel(), 16), normalScale: new THREE.Vector2(0.22, 0.22), map: rep(Maps.grime(seed, 0.75), 1.7) });
  const paint = mkPaint(0x66737d), paintD = mkPaint(0x3f4950, 0.7, 43), paintL = mkPaint(0x7d8a93, 0.58, 44);
  const edge = new THREE.MeshStandardMaterial({ color: 0xb4bcc2, metalness: 1, roughness: 0.42, roughnessMap: rep(Maps.roughGloss(5), 6) });
  const cream = new THREE.MeshStandardMaterial({ color: 0xcfc8b2, metalness: 0.1, roughness: 0.5, roughnessMap: rep(Maps.roughWorn(8), 3), map: rep(Maps.grime(45, 0.8), 6) });
  const alu = new THREE.MeshStandardMaterial({ color: 0xb9bec2, metalness: 1, roughness: 0.36, roughnessMap: rep(br.rough, 1, 4), normalMap: rep(br.normal, 1, 4), normalScale: new THREE.Vector2(0.3, 0.3) });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a5, metalness: 1, roughness: 0.38, roughnessMap: rep(Maps.roughGloss(5), 2) });
  const bake = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, metalness: 0, roughness: 0.38, roughnessMap: rep(Maps.roughGloss(6), 2) });
  const blackM = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.8 });
  const markM = new THREE.MeshStandardMaterial({ color: 0xe9e4d4, roughness: 0.6 });
  const orangeM = new THREE.MeshStandardMaterial({ color: 0xd9581a, roughness: 0.55 });
  const glass = glassMat({ opacity: 0.12, rough: 0.06, env: 1.4, tint: 0x0a0a0a, smudgeRep: 1.3 });
  const faceMat = tex => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.78, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.1 });
  const ndl = { org: orangeM, wht: markM, blk: new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.5 }) };
  const sk = screwKit('slot', steel), tu = toggleKit(alu, 1), td = toggleKit(alu, -1);

  /* a board = one flat face of the cockpit with its own silkscreen and hardware instances */
  class Board {
    constructor(group, x0, y0, x1, y1, z, ppm = 2100) { Object.assign(this, { group, x0, y0, x1, y1, z, ppm }); this.marks = []; this.scr = new Instancer(sk.geo, sk.mat); this.tu = new Instancer(tu.geo, tu.mat); this.td = new Instancer(td.geo, td.mat); }
    L(text, x, y, size = 0.0068, o = {}) { this.marks.push((g, T) => T(text, x, y, size, { font: F_N, weight: 600, color: WHT, ls: 0.08, ...o })); return this; }
    rect(x0, y0, x1, y1, lw = 0.0007) { this.marks.push(g => { g.strokeStyle = WHT; g.lineWidth = lw; g.strokeRect(x0, y0, x1 - x0, y1 - y0); }); return this; }
    ln(pts, lw = 0.0007) { this.marks.push(g => { g.strokeStyle = WHT; g.lineWidth = lw; line(g, pts); }); return this; }
    panel(x0, y0, x1, y1, { d = 0.014, r = 0.006, m = paint, z = this.z - 0.014, screws = true } = {}) {
      const w = x1 - x0 - 0.004, h = y1 - y0 - 0.004, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      this.group.add(plate(rr(w, h, r), { d, bevel: 0.0013, mat: m, edge, x: cx, y: cy, z })); if (screws) this.scr.corners(cx, cy, w, h, 0.009, z + d, 0.0034); return this;
    }
    gauge(x, y, r, tex, { bezel = cream, bw = r * 0.2, bh = 0.012, nd = null, z = this.z, bulge = r * 0.12, label = null, glassOn = true } = {}) {
      const g = new THREE.Group(); g.position.set(x, y, z); this.group.add(g);
      g.add(bezelRing(r, bw, bh, 0, bezel)); const f = disc(r, tex.isTexture ? faceMat(tex) : tex.mat); f.position.z = 0.0008; f.receiveShadow = true; g.add(f); if (!tex.isTexture) screens.push(tex);
      if (nd) { const n = needleMesh(r * (nd.len ?? 0.84), r * (nd.w ?? 0.07), ndl[nd.c ?? 'org'], { tail: 0.2, thick: 0.0012 }); n.position.z = bh * 0.34; g.add(n); const hub = cyl(r * 0.11, r * 0.13, bh * 0.5, nd.hub ?? bake, 24); g.add(hub); needles.push({ mesh: n, fn: nd.fn }); }
      if (glassOn) { const gl = dome(r * 0.995, bulge, glass); gl.position.z = bh * 0.7; g.add(gl); hide.push(gl); }
      this.scr.ring(x, y, r + bw + 0.007, 4, z, 0.0026, PI / 4);
      if (label) this.L(label, x, y - r - bw - 0.012);
      return g;
    }
    tog(x, y, up = true, label = null) { (up ? this.tu : this.td).add(x, y, this.z, 0.0052, R() * TAU); if (label) this.L(label, x, y + 0.017, 0.0052); return this; }
    knob(x, y, r = 0.011, a = R() * 4 - 2, label = null) { const k = knob(r, r * 1.3, bake, markM, a); k.position.set(x, y, this.z); this.group.add(k); this.marks.push(g => { g.strokeStyle = WHT; g.lineWidth = 0.0007; for (let i = 0; i <= 6; i++) { const an = (210 - i * 40) * PI / 180; line(g, [[x + Math.cos(an) * r * 1.5, y + Math.sin(an) * r * 1.5], [x + Math.cos(an) * r * 1.85, y + Math.sin(an) * r * 1.85]]); } }); if (label) this.L(label, x, y - r * 2.2 - 0.004, 0.0052); return this; }
    lamp(x, y, color, on = true, r = 0.0048, k = 3) { const l = lamp(r, color, k, steel, on); l.position.set(x, y, this.z); this.group.add(l); return this; }
    lit(x, y, w, h, draw, k = 1.6, pxk = 1800) { // back-lit legend / annunciator in a black frame
      const s = rr(w + 0.012, h + 0.012, 0.004); s.holes.push(rrHole(w, h, 0.002, 0, 0)); this.group.add(plate(s, { d: 0.007, bevel: 0.001, mat: bake, edge: steel, x, y, z: this.z }));
      const d = decal(w, h, Math.round(w * pxk), Math.round(h * pxk), draw, { emissive: k }); d.position.set(x, y, this.z + 0.003); this.group.add(d); return d;
    }
    display(x, y, w, h, scr, { fw = 0.008, d = 0.008 } = {}) {
      const s = rr(w + fw * 2, h + fw * 2, 0.005); s.holes.push(rrHole(w, h, 0.003, 0, 0)); this.group.add(plate(s, { d, bevel: 0.001, mat: bake, edge: steel, x, y, z: this.z }));
      const q = quad(w, h, scr.mat); q.position.set(x, y, this.z + 0.002); this.group.add(q); screens.push(scr);
      const gl = quad(w, h, glass); gl.position.set(x, y, this.z + d - 0.002); gl.renderOrder = 5; this.group.add(gl); hide.push(gl);
    }
    done(wearAmt = 0.4) { this.scr.build(this.group); this.tu.build(this.group); this.td.build(this.group); this.group.add(sheet(this.x0, this.y0, this.x1, this.y1, this.ppm, (g, T) => this.marks.forEach(f => f(g, T)), { z: this.z + 0.0005, wearAmt, rough: 0.62, seed: Math.round(this.x0 * 100 + 7) })); }
  }
  const wob = (base, amp, w, ph = 0) => t => (220 - 260 * (base + amp * Math.sin(t * w + ph) + amp * 0.4 * Math.sin(t * w * 2.7 + ph * 2)) - 90) * PI / 180;
  const spinFn = (rate, ph = 0) => t => ph + Math.sin(t * rate) * 0.35 + t * rate * 0.1;

  /* ================= main wall ================= */
  const main = new THREE.Group(); scene.add(main);
  const ZP = 0.034, M = new Board(main, -0.44, -0.26, 0.78, 0.39, ZP);
  main.add(plate(poly([[-0.45, -0.25], [0.78, -0.25], [0.78, 0.372], [-0.45, 0.372]], 0.012), { d: 0.02, bevel: 0.002, mat: paintD, edge, z: 0 }));
  // A: attitude row
  M.panel(-0.42, 0.168, 0.05, 0.366);
  M.gauge(-0.33, 0.288, 0.056, fAttitude(0), { nd: { c: 'org', fn: spinFn(0.21, 0.4), len: 0.7 } });
  M.gauge(-0.185, 0.288, 0.056, fAttitude(1), { nd: { c: 'org', fn: spinFn(0.17, 2.2), len: 0.7 } });
  M.gauge(-0.04, 0.286, 0.052, fRadar(), { nd: { c: 'wht', fn: spinFn(0.3, 1), len: 0.8, w: 0.04 }, bezel: alu });
  ['MODE', 'ATTITUDE', 'ARM'].forEach((s, i) => M.L(s, -0.385 + i * 0.055, 0.196, i === 1 ? 0.0075 : 0.005)); ['RESET', 'ATTITUDE', 'TEST'].forEach((s, i) => M.L(s, -0.24 + i * 0.055, 0.196, i === 1 ? 0.0075 : 0.005)); ['SCE', 'VELOCITY'].forEach((s, i) => M.L(s, -0.085 + i * 0.05, 0.198, i === 1 ? 0.0075 : 0.005));
  M.tog(-0.385, 0.181, true).tog(-0.275, 0.181, false).tog(-0.24, 0.181, true).tog(-0.13, 0.181, true).tog(-0.085, 0.181, false);
  M.lamp(-0.33, 0.181, 0xff7a20, false); M.lamp(-0.212, 0.181, 0xff7a20, true, 0.0048, 4); M.lamp(-0.158, 0.181, 0xe8e0c8, false); M.lamp(-0.058, 0.181, 0xff7a20, true, 0.0048, 4); M.lamp(-0.012, 0.181, 0xe8e0c8, false);
  // B: pressure
  M.panel(0.054, 0.168, 0.392, 0.366);
  { const s = rr(0.16, 0.16, 0.014); s.holes.push(circHole(0, 0, 0.066)); main.add(plate(s, { d: 0.014, bevel: 0.002, mat: cream, edge, x: 0.142, y: 0.276, z: ZP })); M.scr.corners(0.142, 0.276, 0.16, 0.16, 0.012, ZP + 0.014, 0.0036);
    const g = M.gauge(0.142, 0.276, 0.066, fPressure(), { bezel: alu, bw: 0.006, bh: 0.012, nd: { c: 'wht', fn: wob(0.42, 0.012, 0.5), hub: steel, w: 0.09 } }); g.position.z = ZP + 0.002; }
  [[0.27, 0.322, 'CABIN PRESS', [0, 5, 10], 0.55], [0.345, 0.322, 'TEMP', [0, 50, 100], 0.4], [0.27, 0.232, 'OXYGEN', [0, 50, 100], 0.82], [0.345, 0.232, 'FUEL', [0, 50, 100], 0.66]].forEach(([x, y, lb, nums, v], i) => M.gauge(x, y, 0.028, fCream('', nums), { nd: { c: 'blk', fn: t => (210 - 240 * (v + 0.01 * Math.sin(t * 0.6 + i)) - 90) * PI / 180, w: 0.09, hub: steel }, label: lb, bh: 0.009 }));
  // C: flight path
  M.panel(0.396, 0.064, 0.704, 0.366, { m: paintL });
  M.gauge(0.55, 0.218, 0.112, fFlight(), { bw: 0.017, bh: 0.016, nd: { c: 'wht', fn: spinFn(0.12, 3.6), len: 0.9, w: 0.03, hub: steel } });
  M.display(0.612, 0.118, 0.062, 0.024, clockPainter(160, 62, 40, '000.0'), { fw: 0.005, d: 0.006 });
  M.L('FLIGHT PATH', 0.468, 0.342, 0.0075).L('DEG', 0.612, 0.092, 0.005); M.knob(0.672, 0.094, 0.012, 0.6).tog(0.43, 0.09, true, 'CAGE').tog(0.468, 0.09, false, 'SLEW');
  M.panel(0.708, 0.19, 0.775, 0.366); for (let i = 0; i < 4; i++) M.tog(0.742, 0.33 - i * 0.036, i % 2 === 0); M.L('BUS', 0.742, 0.352, 0.005);
  // D: launch sequence + roll / yaw
  M.panel(-0.42, -0.232, -0.17, 0.164);
  M.lit(-0.295, 0.118, 0.142, 0.052, (g, W, H) => { g.fillStyle = '#d9581a'; g.fillRect(0, 0, W, H); const v = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6); v.addColorStop(0, 'rgba(255,170,90,0.5)'); v.addColorStop(1, 'rgba(120,30,0,0.35)'); g.fillStyle = v; g.fillRect(0, 0, W, H); txt(g, 'LAUNCH', W / 2, H * 0.3, `600 ${H * 0.36}px ${F_N}`, '#fff3e2'); txt(g, 'SEQUENCE', W / 2, H * 0.7, `600 ${H * 0.36}px ${F_N}`, '#fff3e2'); }, 1.5);
  ['SEQ', 'ARM', 'GND'].forEach((s, i) => M.knob(-0.345 + i * 0.05, 0.062, 0.0095, i - 1, s));
  M.gauge(-0.342, -0.02, 0.04, fDark('FUEL', [0, 2, 4, 6, 8], 0.0, 0.25), { nd: { fn: wob(0.62, 0.008, 0.4) }, label: 'ROLL' });
  M.gauge(-0.236, -0.012, 0.038, fDark('RATE', [0, 1, 2, 3, 4], 0.7, 1), { nd: { fn: wob(0.35, 0.02, 0.9, 1) }, label: 'YAW' });
  M.gauge(-0.236, -0.112, 0.036, fDark('', [0, 5, 10, 15, 20], 0.55, 0.9), { nd: { fn: wob(0.48, 0.015, 0.7, 2) }, label: 'PITCH' });
  for (let i = 0; i < 3; i++) M.tog(-0.378 + i * 0.036, -0.112, i !== 1, ['FDAI', 'GDC', 'SCS'][i]); for (let i = 0; i < 4; i++) M.knob(-0.38 + i * 0.058, -0.2, 0.0085, R() * 3 - 1.5, ['GAIN', 'RATE', 'DBAND', 'TRIM'][i]);
  // E: centre CRT
  M.panel(-0.166, -0.232, 0.162, 0.164, { m: paintL });
  for (let i = 0; i < 9; i++) { const on = i === 4; const d = decal(0.026, 0.02, 52, 40, (g, W, H) => { g.fillStyle = on ? '#ff9a3c' : (i % 3 === 0 ? '#3b3f42' : '#c9c4b2'); g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(6, H - 12, W - 12, 3); g.fillRect(6, 9, (W - 12) * 0.6, 3); }, on ? { emissive: 2.4 } : { rough: 0.5 }); const x = -0.132 + i * 0.033; main.add(plate(rr(0.028, 0.022, 0.003), { d: 0.007, bevel: 0.001, mat: bake, edge: steel, x, y: 0.128, z: ZP })); d.position.set(x, 0.128, ZP + 0.0074); main.add(d); }
  { const s = rr(0.306, 0.262, 0.012); s.holes.push(rrHole(0.256, 0.218, 0.022, 0, 0)); main.add(plate(s, { d: 0.02, bevel: 0.0025, seg: 3, mat: paint, edge, x: -0.002, y: -0.045, z: ZP })); M.scr.corners(-0.002, -0.045, 0.306, 0.262, 0.01, ZP + 0.02, 0.0036);
    const s2 = rr(0.262, 0.224, 0.022); s2.holes.push(rrHole(0.236, 0.2, 0.026, 0, 0)); main.add(plate(s2, { d: 0.012, bevel: 0.003, seg: 3, mat: bake, x: -0.002, y: -0.045, z: ZP }));
    const crt = crtPainter(); const q = quad(0.24, 0.204, crt.mat, 0.026); q.position.set(-0.002, -0.045, ZP + 0.003); main.add(q); screens.push(crt);
    const gl = quad(0.24, 0.204, glass, 0.026); gl.position.set(-0.002, -0.045, ZP + 0.009); gl.renderOrder = 5; main.add(gl); hide.push(gl);
    for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) main.add(plate(rr(0.011, 0.016, 0.002), { d: 0.005, bevel: 0.001, mat: i === 2 && sx > 0 ? cream : paintD, edge: steel, x: -0.002 + sx * 0.143, y: 0.04 - i * 0.034, z: ZP + 0.02 }));
    const l = new THREE.PointLight(0x5aa8e8, 0.07, 0.8, 2); l.position.set(0, -0.045, ZP + 0.12); main.add(l); }
  M.knob(-0.142, -0.202, 0.012, 0.8).knob(0.138, -0.202, 0.012, -1.1);
  for (let i = 0; i < 6; i++) { const lit = i === 4; const x = -0.085 + i * 0.034; main.add(plate(rr(0.02, 0.014, 0.002), { d: 0.006, bevel: 0.001, mat: lit ? new THREE.MeshStandardMaterial({ color: 0xffb060, emissive: 0xff9a40, emissiveIntensity: 2.2, roughness: 0.4 }) : cream, edge: steel, x, y: -0.202, z: ZP })); }
  // F: mission elapsed time
  M.panel(0.166, -0.086, 0.392, 0.164);
  M.gauge(0.268, 0.082, 0.06, clockPainter(384, 384, 62, metString, true), { bezel: alu, bw: 0.01, bh: 0.014 });
  M.scr.ring(0.268, 0.082, 0.064, 6, ZP + 0.014, 0.0028, 0.3);
  M.gauge(0.215, -0.04, 0.03, fDark('', [0, 1, 2, 3], 0.7, 1), { nd: { fn: wob(0.3, 0.02, 1.3) }, label: 'DELTA V', bh: 0.009 });
  M.lit(0.32, -0.036, 0.086, 0.05, (g, W, H) => { g.fillStyle = '#d9581a'; g.fillRect(0, 0, W, H); const v = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6); v.addColorStop(0, 'rgba(255,170,90,0.5)'); v.addColorStop(1, 'rgba(120,30,0,0.35)'); g.fillStyle = v; g.fillRect(0, 0, W, H); txt(g, 'GNC-7', W / 2, H * 0.3, `600 ${H * 0.36}px ${F_N}`, '#fff3e2'); txt(g, 'READY', W / 2, H * 0.7, `600 ${H * 0.36}px ${F_N}`, '#fff3e2'); }, 1.5);
  M.tog(0.36, 0.12, true, 'MET').tog(0.36, 0.05, false, 'HOLD').knob(0.195, 0.14, 0.008, 0.4);
  // G: communications
  M.panel(0.396, -0.086, 0.775, 0.06);
  M.L('COMMUNICATIONS', 0.415, 0.042, 0.0072, { align: 'left' }).lamp(0.75, 0.042, 0xff9a30, true, 0.004, 4);
  for (let i = 0; i < 5; i++) { const col = i < 3 ? 0 : 1, row = i < 3 ? i : i - 3, x = 0.415 + col * 0.18, y = 0.018 - row * 0.024; M.L('CH 0' + (i + 1), x, y, 0.0058, { align: 'left' });
    M.marks.push(g => { g.fillStyle = '#0c0d0e'; g.fillRect(x + 0.034, y - 0.004, 0.09, 0.008); g.fillStyle = WHT; g.fillRect(x + 0.04 + R() * 0.06, y - 0.0048, 0.01, 0.0096); g.fillStyle = 'rgba(236,233,223,0.6)'; for (let k = 0; k < 9; k++) g.fillRect(x + 0.038 + k * 0.01, y + 0.0055, 0.0006, 0.002); });
    M.lamp(x + 0.14, y, i === 1 || i === 4 ? 0xffa030 : 0xe8e0c8, i === 1 || i === 4, 0.0032, 4); }
  for (let i = 0; i < 6; i++) (i % 2 ? M.knob(0.43 + i * 0.062, -0.064, 0.0075, R() * 3 - 1.5) : M.tog(0.43 + i * 0.062, -0.064, i !== 2));
  // H/I/J: lower right
  M.panel(0.166, -0.232, 0.268, -0.09); M.L('SYS STATUS', 0.217, -0.103, 0.005);
  M.display(0.217, -0.128, 0.064, 0.02, clockPainter(160, 50, 30, '- 0 4 -'), { fw: 0.004, d: 0.005 }); M.knob(0.196, -0.17, 0.008, 0.3).knob(0.238, -0.17, 0.008, -0.8).lamp(0.196, -0.21, 0xff3020, false).lamp(0.217, -0.21, 0x60ff60, true, 0.0048, 3).lamp(0.238, -0.21, 0xffa030, false);
  M.panel(0.272, -0.232, 0.468, -0.09, { m: paintL });
  { const s = rr(0.17, 0.118, 0.008); s.holes.push(rrHole(0.14, 0.092, 0.012, 0, 0)); main.add(plate(s, { d: 0.014, bevel: 0.002, mat: bake, edge: steel, x: 0.37, y: -0.152, z: ZP }));
    const c2 = crtPainter(420, 276, true); const q = quad(0.14, 0.092, c2.mat, 0.012); q.position.set(0.37, -0.152, ZP + 0.003); main.add(q); screens.push(c2);
    const gl = quad(0.14, 0.092, glass, 0.012); gl.position.set(0.37, -0.152, ZP + 0.011); gl.renderOrder = 5; main.add(gl); hide.push(gl);
    for (let i = 0; i < 6; i++) main.add(plate(rr(0.014, 0.008, 0.0015), { d: 0.004, bevel: 0.0008, mat: i === 3 ? orangeM : cream, edge: steel, x: 0.31 + i * 0.024, y: -0.22, z: ZP })); }
  M.panel(0.472, -0.232, 0.775, -0.09);
  M.gauge(0.548, -0.158, 0.056, fDark('ENGINE\nPRESS', [0, 20, 40, 60, 80], 0.05, 0.4), { nd: { fn: wob(0.56, 0.01, 0.8) }, bezel: alu, bw: 0.008 });
  M.gauge(0.69, -0.158, 0.056, fDark('PROP\nPRESS', [0, 2, 4, 6, 8], 0.5, 0.95), { nd: { fn: wob(0.47, 0.014, 0.6, 2) }, bezel: alu, bw: 0.008 });
  M.done(0.45);

  /* ================= port wing: trajectory plot, charts, range dial ================= */
  const port = new THREE.Group(); port.position.set(-0.455, 0, 0.0); port.rotation.y = 0.34; scene.add(port);
  const PB = new Board(port, -0.6, -0.3, 0, 0.4, 0.02, 1900);
  port.add(plate(poly([[-0.62, -0.3], [0, -0.3], [0, 0.4], [-0.5, 0.4], [-0.62, 0.2]], 0.02), { d: 0.02, bevel: 0.002, mat: paintD, edge, z: 0 }));
  // taped charts
  const paper = (w, h, x, y, rot, seed) => { const d = decal(w, h, Math.round(w * 1500), Math.round(h * 1500), (g, W, H) => { const r = rng(seed); g.fillStyle = '#d6cfba'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(40,50,70,0.75)'; g.lineWidth = 1; g.strokeRect(10, 10, W - 20, H - 20);
      for (let i = 0; i < 3; i++) { const cx = W * (0.25 + r() * 0.5), cy = H * (0.25 + r() * 0.5), rad = W * (0.08 + r() * 0.16); g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.stroke(); g.beginPath(); g.ellipse(cx, cy, rad * 1.8, rad * 0.8, r() * 3, 0, TAU); g.stroke(); line(g, [[cx - rad * 2, cy], [cx + rad * 2, cy]]); line(g, [[cx, cy - rad * 2], [cx, cy + rad * 2]]); }
      for (let i = 0; i < 8; i++) microText(g, 18 + r() * W * 0.6, 18 + r() * (H - 40), W * 0.25, 2, r, 'rgba(30,36,50,0.6)', 6);
      const st = g.createLinearGradient(0, 0, W, H); st.addColorStop(0, 'rgba(90,60,20,0.18)'); st.addColorStop(0.5, 'rgba(90,60,20,0)'); st.addColorStop(1, 'rgba(60,40,10,0.25)'); g.fillStyle = st; g.fillRect(0, 0, W, H); }, { rough: 0.92 });
    d.position.set(x, y, 0.0206); d.rotation.z = rot; d.material.polygonOffsetFactor = -1; port.add(d);
    for (const [tx, ty] of [[-w * 0.4, h * 0.46], [w * 0.38, h * 0.47]]) { const t = box(0.03, 0.012, 0.0004, new THREE.MeshStandardMaterial({ color: 0xcdbb8a, roughness: 0.5, transparent: true, opacity: 0.85 })); t.position.set(x + tx * Math.cos(rot) - ty * Math.sin(rot), y + tx * Math.sin(rot) + ty * Math.cos(rot), 0.0212); t.rotation.z = rot + (R() - 0.5) * 0.5; t.castShadow = false; port.add(t); } };
  paper(0.3, 0.2, -0.17, 0.21, 0.02, 3); paper(0.25, 0.1, -0.16, -0.14, -0.03, 4);
  // vent grille
  PB.panel(-0.105 - 0.09, 0.262, -0.105 + 0.09, 0.34, { m: paint, z: 0.02, d: 0.008 }); for (let i = 0; i < 7; i++) port.add(box(0.15, 0.0045, 0.004, blackM, -0.105, 0.28 + i * 0.007, 0.03));
  // trajectory plotter
  { const hex = [[-0.38, -0.1], [-0.07, -0.13], [-0.03, -0.09], [-0.03, 0.11], [-0.07, 0.15], [-0.34, 0.15], [-0.4, 0.06]];
    port.add(plate(poly(hex, 0.012), { d: 0.03, bevel: 0.003, seg: 3, mat: paint, edge, z: 0.02 }));
    const inner = hex.map(([x, y]) => [(x + 0.212) * 0.9 - 0.212, (y - 0.012) * 0.86 + 0.012]); const s = poly(hex.map(([x, y]) => [(x + 0.212) * 0.95 - 0.212, (y - 0.012) * 0.93 + 0.012]), 0.01); s.holes.push(poly(inner, 0.01, THREE.Path));
    port.add(plate(s, { d: 0.008, bevel: 0.0015, mat: bake, edge: steel, z: 0.05 }));
    const tr = trajectoryPainter(); const g = new THREE.ShapeGeometry(poly(inner, 0.01)); const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 0.385) / 0.36, (p.getY(i) + 0.125) / 0.27);
    const q = new THREE.Mesh(g, tr.mat); q.position.z = 0.0515; port.add(q); screens.push(tr);
    const gl = new THREE.Mesh(g, glass); gl.position.z = 0.056; gl.renderOrder = 5; port.add(gl); hide.push(gl);
    const pos = [[-0.37, -0.085], [-0.08, -0.115], [-0.045, 0.1], [-0.33, 0.135]]; pos.forEach(([x, y]) => PB.scr.add(x, y, 0.05, 0.0038)); }
  PB.panel(-0.5, 0.0, -0.42, 0.09, { z: 0.02, d: 0.012 }); for (const [x, y, on] of [[-0.478, 0.066, 0], [-0.444, 0.066, 0], [-0.478, 0.03, 1], [-0.444, 0.03, 1]]) { const l = lamp(0.0055, 0xff2a18, 3.5, steel, !!on); l.position.set(x, y, 0.032); port.add(l); }
  { const k = knob(0.022, 0.012, alu, blackM, 0.5, { skirt: 1.1, flute: 30 }); k.position.set(0.0 - 0.02, -0.01, 0.05); port.add(k); PB.panel(-0.05, -0.05, 0.0, 0.03, { z: 0.02, d: 0.03, m: paintL, screws: false }); }
  // lower switch box
  PB.panel(-0.3, -0.29, -0.01, -0.155, { z: 0.02, d: 0.016, m: paintL }); PB.z = 0.036;
  ['SYSTEMS', 'STANDBY', 'POWER'].forEach((s, i) => PB.L(s, -0.255 + i * 0.07, -0.17, 0.005));
  for (let i = 0; i < 3; i++) PB.lamp(-0.262 + i * 0.03, -0.196, 0xff2a18, i === 0, 0.0052, 3.5);
  for (let i = 0; i < 3; i++) PB.tog(-0.262 + i * 0.03, -0.24, i !== 1); for (let i = 0; i < 4; i++) PB.knob(-0.15 + i * 0.038, -0.2, 0.0085, R() * 3 - 1.5); for (let i = 0; i < 4; i++) PB.tog(-0.15 + i * 0.038, -0.255, i % 2 === 0);
  PB.lamp(-0.03, -0.255, 0xff2a18, true, 0.004, 4); PB.z = 0.02; PB.done(0.5);
  // range dial pod
  const pod = new THREE.Group(); pod.position.set(-0.44, -0.165, 0.05); pod.rotation.set(-0.1, 0.12, 0); port.add(pod);
  pod.add(plate(rr(0.26, 0.25, 0.02), { d: 0.05, bevel: 0.004, seg: 3, mat: paint, edge, z: -0.03 }));
  const PD = new Board(pod, -0.13, -0.125, 0.13, 0.125, 0.02, 1800);
  PD.gauge(0, 0.012, 0.094, fFlight(true), { bw: 0.018, bh: 0.018, nd: { c: 'wht', fn: spinFn(0.1, 0.9), len: 0.86, w: 0.035, hub: steel } });
  PD.display(0.012, -0.068, 0.062, 0.024, clockPainter(160, 62, 40, '020.4'), { fw: 0.005, d: 0.02 }); PD.scr.corners(0, 0, 0.26, 0.25, 0.014, 0.02, 0.004); PD.knob(-0.098, -0.098, 0.011, 0.4); PD.done(0.4);

  /* ================= starboard wing: mission timer, go / no-go ================= */
  const star = new THREE.Group(); star.position.set(0.785, 0, 0.0); star.rotation.y = -0.42; scene.add(star);
  const SB = new Board(star, 0, -0.3, 0.3, 0.4, 0.034, 2000);
  star.add(plate(poly([[0, -0.3], [0.34, -0.3], [0.34, 0.2], [0.24, 0.4], [0, 0.4]], 0.02), { d: 0.02, bevel: 0.002, mat: paintD, edge, z: 0 }));
  SB.panel(0.012, -0.262, 0.2, 0.11, { m: paintL });
  SB.L('MISSION TIMER', 0.03, 0.094, 0.0068, { align: 'left' }); SB.display(0.106, 0.058, 0.136, 0.04, clockPainter(400, 120, 68, metString), { fw: 0.007 });
  const pb = (x, y, s, col, on) => SB.lit(x, y, 0.046, 0.02, (g, W, H) => { g.fillStyle = on ? col : '#3a3632'; g.fillRect(0, 0, W, H); txt(g, s, W / 2, H / 2 + 1, `600 ${H * 0.56}px ${F_N}`, on ? '#fff' : '#b9b3a4'); }, on ? 1.9 : 0.25);
  pb(0.062, 0.006, 'GO', '#2f9a4a', true); pb(0.15, 0.006, 'NO GO', '#3a3632', false); pb(0.062, -0.03, 'STAGE', '#3a3632', false); pb(0.15, -0.03, 'HOLD', '#c9372a', true); pb(0.062, -0.066, 'CHECK', '#3a3632', false); pb(0.15, -0.066, 'ABORT', '#c9372a', true);
  SB.L('SEPARATION', 0.03, -0.096, 0.005, { align: 'left' }); { const g = new THREE.Group(); g.position.set(0.062, -0.14, 0.034); star.add(g); g.add(plate(rr(0.03, 0.05, 0.004), { d: 0.004, bevel: 0.001, mat: bake, edge: steel })); const t = box(0.012, 0.022, 0.012, markM, 0, 0.008, 0.009); g.add(t); }
  { const c = plate(rr(0.036, 0.036, 0.004), { d: 0.012, bevel: 0.002, mat: cream, edge, x: 0.15, y: -0.14, z: 0.034 }); star.add(c); }
  SB.knob(0.062, -0.215, 0.012, 0.9).L('GUIDANCE', 0.14, -0.196, 0.005); SB.lamp(0.135, -0.222, 0xff2a18, true, 0.0052, 4); SB.lamp(0.162, -0.222, 0xff2a18, false);
  SB.panel(0.012, 0.118, 0.2, 0.3); SB.L('TELEMETRY', 0.03, 0.283, 0.005, { align: 'left' }); for (let i = 0; i < 4; i++) { SB.tog(0.045 + i * 0.04, 0.24, i % 3 !== 0); SB.lamp(0.045 + i * 0.04, 0.19, i === 1 ? 0x60ff60 : 0xffa030, i < 2, 0.0042, 3.5); SB.knob(0.045 + i * 0.04, 0.148, 0.0075, R() * 3); }
  SB.done(0.45);

  /* ================= sloping console shelf ================= */
  const shelf = new THREE.Group(); shelf.position.set(0, -0.25, 0.02); shelf.rotation.x = -1.02; scene.add(shelf);
  const SH = new Board(shelf, -0.46, -0.24, 1.0, 0.0, 0.014, 1900);
  shelf.add(plate(rr(1.5, 0.26, 0.01, 0.27, -0.125), { d: 0.014, bevel: 0.002, mat: paint, edge, z: 0 }));
  SH.rect(-0.3, -0.07, 0.18, -0.012); for (let i = 0; i < 6; i++) SH.gauge(-0.26 + i * 0.076, -0.04, 0.024, fDark('', [0, '', '', ''], 0.6, 1), { nd: { fn: wob(0.2 + R() * 0.6, 0.01, 0.5 + R(), i), w: 0.1 }, bh: 0.008, bezel: alu, bw: 0.004 });
  ['BATTERY', 'INVERTER', 'RADIO', 'UPLINK', 'CAMERA', 'ANTENNA'].forEach((s, i) => { const x = -0.27 + i * 0.094; SH.L(s, x, -0.092, 0.0056); SH.rect(x - 0.042, -0.21, x + 0.042, -0.084); SH.tog(x - 0.02, -0.125, i % 2 === 0); if (i % 3 === 1) SH.knob(x + 0.016, -0.125, 0.0085, R() * 3); else SH.lamp(x + 0.018, -0.125, i === 4 ? 0xff2a18 : 0xffa030, i === 4 || i === 0, 0.0045, 3.5); SH.knob(x - 0.012, -0.176, 0.009, R() * 3 - 1.5); SH.tog(x + 0.022, -0.176, i % 3 === 0); });
  shelf.add(plate(rr(0.25, 0.1, 0.006), { d: 0.01, bevel: 0.0015, mat: paintL, edge, x: 0.44, y: -0.062, z: 0.014 })); SH.scr.corners(0.44, -0.062, 0.25, 0.1, 0.008, 0.024, 0.0032);
  for (let i = 0; i < 5; i++) { const on = i === 1 || i === 2; shelf.add(plate(rr(0.026, 0.016, 0.002), { d: 0.006, bevel: 0.001, mat: on ? new THREE.MeshStandardMaterial({ color: 0xff8030, emissive: 0xff6a20, emissiveIntensity: 2.4, roughness: 0.4 }) : cream, edge: steel, x: 0.345 + i * 0.034, y: -0.038, z: 0.024 })); }
  SH.z = 0.024; for (let i = 0; i < 4; i++) SH.tog(0.36 + i * 0.05, -0.085, i % 2 === 1); SH.lamp(0.545, -0.04, 0xff2a18, true, 0.0045, 4); SH.z = 0.014;
  for (let i = 0; i < 3; i++) { const x = 0.63 + i * 0.1; SH.rect(x - 0.045, -0.2, x + 0.045, -0.02); SH.knob(x - 0.018, -0.06, 0.01, R() * 3 - 1.5).knob(x + 0.02, -0.06, 0.01, R() * 3 - 1.5); SH.tog(x - 0.018, -0.12, i !== 1).tog(x + 0.02, -0.12, i === 1); SH.L(['S-BAND', 'VHF', 'RECORDER'][i], x, -0.158, 0.0056); SH.lamp(x, -0.182, 0xffa030, i === 0, 0.004, 3.5); }
  SH.done(0.5);
  // indicator strip left of shelf
  const ind = new THREE.Group(); ind.position.set(-0.72, -0.33, 0.2); ind.rotation.set(-1.02, 0.3, 0.1); scene.add(ind);
  ind.add(plate(rr(0.36, 0.14, 0.01), { d: 0.02, bevel: 0.002, mat: paint, edge }));
  [0xff2a18, 0xff2a18, 0x60ff60, 0x60ff60, 0xffa030, 0xff2a18].forEach((c, i) => { const l = lamp(0.006, c, 3.6, steel, i !== 4); l.position.set(-0.14 + i * 0.03, 0.03, 0.02); ind.add(l); });
  for (let i = 0; i < 3; i++) { const k = knob(0.014, 0.018, bake, markM, R() * 3); k.position.set(-0.06 + i * 0.06, -0.03, 0.02); ind.add(k); }

  /* ================= throttle quadrant ================= */
  const thr = new THREE.Group(); thr.position.set(-0.5, -0.45, 0.36); thr.rotation.set(-0.42, 0.1, 0); scene.add(thr);
  thr.add(plate(poly([[-0.14, -0.2], [0.14, -0.2], [0.15, 0.06], [0.1, 0.13], [-0.1, 0.13], [-0.15, 0.06]], 0.015), { d: 0.14, bevel: 0.004, seg: 3, mat: paint, edge, z: -0.07 }));
  const slotM = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 });
  const ribN = rep(Maps.knurl(), 1, 9); ribN.rotation = PI / 2; ribN.needsUpdate = true;
  const grip = new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 0.42, roughnessMap: rep(Maps.roughGloss(6), 2), normalMap: ribN, normalScale: new THREE.Vector2(0.9, 0.9) });
  [[-0.05, 0.22], [0.055, -0.1]].forEach(([x, tilt], i) => {
    thr.add(box(0.028, 0.2, 0.004, slotM, x, -0.03, 0.0715));
    const lv = new THREE.Group(); lv.position.set(x, -0.03, 0.02); lv.rotation.x = 0.72 - tilt; thr.add(lv);
    lv.add(box(0.014, 0.19, 0.022, alu, 0, 0.11, 0));
    const gp = cyl(0.021, 0.024, 0.1, grip, 28); gp.rotation.x = -PI / 2; gp.position.set(0, 0.19, 0); lv.add(gp);
    const cap = lathe([[0.024, 0], [0.025, 0.012], [0.02, 0.024], [0.01, 0.03], [0.0001, 0.031]], cream, 28); cap.rotation.x = -PI / 2; cap.position.set(0, 0.29, 0); lv.add(cap);
  });
  { const d = decal(0.2, 0.16, 400, 320, (g, W, H) => { txt(g, 'THRUST', W * 0.72, H * 0.3, `600 26px ${F_N}`, WHT); txt(g, 'MAX', W * 0.68, H * 0.47, `600 24px ${F_N}`, WHT); txt(g, 'IDLE', W * 0.78, H * 0.66, `600 22px ${F_N}`, WHT); txt(g, 'ENGINE 1', W * 0.22, H * 0.42, `600 22px ${F_N}`, WHT); txt(g, 'FAST', W * 0.2, H * 0.68, `600 20px ${F_N}`, WHT); txt(g, 'ENGINE 2', W * 0.3, H * 0.88, `600 24px ${F_N}`, WHT); txt(g, 'ABORT', W * 0.8, H * 0.88, `600 20px ${F_N}`, WHT); g.strokeStyle = WHT; g.lineWidth = 2; for (let i = 0; i < 6; i++) line(g, [[W * 0.56, H * (0.2 + i * 0.1)], [W * 0.6, H * (0.2 + i * 0.1)]]); }, { wearAmt: 0.5, seed: 9 }); d.position.set(0, -0.06, 0.0712); thr.add(d);
    for (const [x, y, c] of [[0.12, 0.04, 0xff2a18], [0.115, -0.04, 0xff2a18], [0.105, -0.12, 0x60ff60]]) { const l = lamp(0.007, c, 3.2, steel); l.position.set(x, y, 0.07); thr.add(l); } }

  /* ================= cabin structure ================= */
  const arch = plate(poly([[-1.5, 0.385], [1.5, 0.385], [1.5, 0.5], [1.05, 0.62], [-1.05, 0.62], [-1.5, 0.5]], 0.05), { d: 0.34, bevel: 0.006, seg: 3, mat: paintD, edge, z: -0.06 }); scene.add(arch);
  { const d = decal(0.74, 0.095, 1480, 190, (g, W, H) => { g.fillStyle = 'rgba(8,10,12,0.55)'; g.fillRect(0, 0, W, H); const col = '#d9c9a4'; g.font = `600 58px ${F_N}`; try { g.letterSpacing = '14px'; } catch (e) { /* ignore */ } g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('COMMAND MODULE', W / 2 + 7, 66); g.font = `500 28px ${F_N}`; try { g.letterSpacing = '9px'; } catch (e) { /* ignore */ } g.fillText('GUIDANCE · NAVIGATION · CONTROL', W / 2 + 4, 132);
      for (const x of [W * 0.07, W * 0.93]) { g.save(); g.translate(x, 132); g.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, rr_ = i % 2 ? 4 : 15; g.lineTo(Math.cos(a) * rr_, Math.sin(a) * rr_); } g.fill(); g.restore(); } }, { wearAmt: 0.25, seed: 4, rough: 0.5 }); d.position.set(0.03, 0.452, 0.281); scene.add(d);
    for (const x of [-0.42, 0.5]) { scene.add(box(0.14, 0.03, 0.01, blackM, x, 0.45, 0.281)); } }
  const tubeM = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 6.1, 4.6) });
  for (const [x, w] of [[-0.19, 0.4], [0.36, 0.36]]) { scene.add(box(w + 0.03, 0.02, 0.05, steel, x, 0.39, 0.13)); const t = box(w, 0.012, 0.03, tubeM, x, 0.378, 0.135); t.castShadow = false; scene.add(t); const l = new THREE.PointLight(0xffe2b4, 0.32, 1.6, 2); l.position.set(x, 0.36, 0.2); scene.add(l); }
  scene.add(box(4, 1.2, 0.1, paintD, 0, -0.95, -0.06)); scene.add(box(4, 0.06, 1.6, paintD, 0, -0.84, 0.6));
  { const b = plate(rr(0.4, 0.26, 0.016), { d: 0.34, bevel: 0.006, seg: 3, mat: paint, edge, x: 0.16, y: -0.64, z: 0.2 }); scene.add(b); const lid = plate(rr(0.34, 0.2, 0.012), { d: 0.012, bevel: 0.002, mat: paintL, edge, x: 0.16, y: -0.64, z: 0.54 }); scene.add(lid);
    const top = plate(rr(0.36, 0.3, 0.014), { d: 0.012, bevel: 0.002, mat: paintL, edge }); top.rotation.x = -PI / 2; top.position.set(0.16, -0.508, 0.38); scene.add(top);
    const d = decal(0.12, 0.016, 240, 32, (g, W, H) => txt(g, 'ACCESS PANEL', W / 2, H / 2, `600 22px ${F_N}`, WHT), { wearAmt: 0.5 }); d.rotation.x = -PI / 2; d.position.set(0.16, -0.4955, 0.42); scene.add(d);
    const ox = plate(rr(0.34, 0.3, 0.02), { d: 0.3, bevel: 0.008, seg: 3, mat: paintL, edge, x: 0.66, y: -0.7, z: 0.24 }); scene.add(ox);
    const d2 = decal(0.1, 0.02, 200, 40, (g, W, H) => txt(g, 'OXYGEN', W / 2, H / 2, `600 28px ${F_N}`, '#22262a'), { wearAmt: 0.4 }); d2.position.set(0.62, -0.6, 0.541); scene.add(d2); }
  for (const s of [-1, 1]) { const w = box(0.5, 2.4, 0.12, paintD, s * 1.55, 0.2, 0.25); w.rotation.y = -s * 0.9; scene.add(w); const st = box(0.09, 1.6, 0.09, steel, s * 1.2, 0.95, -0.1); st.rotation.z = s * 0.55; scene.add(st);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.035, 0.07) })); win.position.set(s * 1.35, 0.5, -0.3); win.rotation.y = -s * 0.8; scene.add(win); }
  scene.add(box(4, 0.5, 0.1, paintD, 0, 0.95, -0.2));
  for (const [pts, rad] of [[[[-0.95, -0.3, 0.1], [-1.05, -0.4, 0.2], [-1.0, -0.6, 0.3], [-1.1, -0.9, 0.3]], 0.008], [[[0.98, -0.28, 0.15], [1.08, -0.4, 0.2], [1.05, -0.7, 0.25]], 0.007]]) scene.add(cable(pts, rad, bake));

  /* ================= lights ================= */
  const key = new THREE.SpotLight(0xffe7c4, 16, 6, 0.75, 0.9, 2); key.position.set(0.15, 1.25, 1.15); key.target.position.set(0, -0.12, 0.05); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.0012; key.shadow.camera.near = 0.5; key.shadow.camera.far = 4; scene.add(key, key.target);
  const fill = new THREE.PointLight(0x8fb0d8, 0.5, 4, 2); fill.position.set(-1.3, 0.5, 1.2); scene.add(fill);
  const warm = new THREE.PointLight(0xffb878, 0.35, 3, 2); warm.position.set(1.0, -0.3, 1.0); scene.add(warm);
  scene.add(new THREE.HemisphereLight(0x51565c, 0x0c0a08, 0.5));

  for (const s of screens) s.update(0);
  return {
    scene, hide,
    look: { exposure: 1.12, tone: THREE.AgXToneMapping, contrast: 1.14, sat: 1.06, sharp: 0.55, bloom: [0.26, 0.55, 1.0], focus: 2.02, aperture: 1.5, maxBlur: 18, ca: 0.004, distort: 0.03, vig: 0.7, grain: 0.06, lift: 0.004, ao: { radius: 0.045, intensity: 1 }, cam: [0, 0.07, 2.04], target: [0.02, -0.012, 0], tint: [1.03, 1.0, 0.95], frameW: 1.96, frameH: 1.125 },
    update(t) {
      for (const s of screens) s.update(t);
      for (const n of needles) n.mesh.rotation.z = n.fn(t);
      tubeM.color.setRGB(7, 6.1, 4.6).multiplyScalar(0.97 + 0.03 * Math.sin(t * 120) * Math.sin(t * 7.3));
    },
  };
}
