// Y2K shuttle cockpit: pearl plastic, liquid chrome, aqua back-lit dials, teal LCD bricks, jelly buttons.
import { THREE, PI, TAU, clamp, lerp, rng, Maps, rep, mkCanvas, canvasTex, grayTex, fbm, seg7, glow, ticks, arc, dialNums, microText, sh, rr, rrHole, circ, poly, plate, box, cyl, lathe, bezelRing, dome, needleMesh, quad, disc, cable, screwKit, Screen, decal, glassMat, makeEnv } from './core.js';

const AQ = '#7fe9ff', AQW = '#e2fbff', ICE = '#b9f3ff', RED = '#ff4d5e', LCD_BG = '#0c3b38', LCD_FG = '#8dffe0';
const aq = a => `rgba(127,233,255,${a})`;
const F_D = 'Michroma, "Arial Black", sans-serif', F_P = 'VT323, "Courier New", monospace', F_L = 'Rajdhani, "Arial Narrow", sans-serif';
const txt = (g, s, x, y, font, color, align = 'left', base = 'alphabetic') => { g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = base; g.fillText(s, x, y); };
const line = (g, pts, close = false) => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); if (close) g.closePath(); g.stroke(); };
const blob = (pts, n = 200) => new THREE.Shape(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], 0)), true, 'centripetal').getPoints(n).map(p => new THREE.Vector2(p.x, p.y)));
const SHUTTLE = [[0, .55], [.1, .4], [.3, .3], [.42, .08], [.6, .06], [.72, .28], [.9, .36], [1, .56], [.96, .72], [.8, .8], [.16, .8], [.03, .7]];
function shuttle(g, x, y, w, h, color, lw = 2) { g.strokeStyle = color; g.lineWidth = lw; g.lineJoin = 'round'; const P = p => [x + p[0] * w, y + p[1] * h]; line(g, SHUTTLE.map(P), true); line(g, [[.3, .3], [.72, .28]].map(P)); line(g, [[.1, .5], [.9, .5]].map(P)); line(g, [[.44, .12], [.46, .28]].map(P)); line(g, [[.58, .1], [.59, .28]].map(P)); g.beginPath(); g.ellipse(x + .24 * w, y + .8 * h, .07 * w, .12 * h, 0, 0, TAU); g.stroke(); g.beginPath(); g.ellipse(x + .76 * w, y + .8 * h, .07 * w, .12 * h, 0, 0, TAU); g.stroke(); }

/* ---------- displays ---------- */
function dialFace(nums, unit, sub, red) {
  const S = 1024, c = 512, cv = mkCanvas(S, S), g = cv.getContext('2d'), A0 = 225, A1 = -45, A = v => A0 + (A1 - A0) * v;
  const bg = g.createRadialGradient(c, c, 30, c, c, 512); bg.addColorStop(0, '#0b2a48'); bg.addColorStop(0.5, '#051427'); bg.addColorStop(0.86, '#020914'); bg.addColorStop(1, '#0a3046'); g.fillStyle = bg; g.fillRect(0, 0, S, S);
  for (const [rr_, a] of [[120, .22], [190, .14], [262, .12], [330, .1]]) arc(g, c, c, rr_, 0, 360, { w: 1.5, color: aq(a) });
  g.strokeStyle = aq(0.07); g.lineWidth = 1; for (let i = 0; i < 36; i++) { const a = i / 36 * TAU; line(g, [[c + Math.cos(a) * 120, c + Math.sin(a) * 120], [c + Math.cos(a) * 330, c + Math.sin(a) * 330]]); }
  glow(g, AQ, 34, () => arc(g, c, c, 486, 0, 360, { w: 14, color: aq(0.9) })); glow(g, '#fff', 8, () => arc(g, c, c, 486, 0, 360, { w: 4, color: AQW }));
  glow(g, AQ, 14, () => arc(g, c, c, 446, A0, A(red), { w: 5, color: AQW }));
  glow(g, RED, 18, () => arc(g, c, c, 446, A(red), A1, { w: 12, color: RED }));
  ticks(g, c, c, 400, 430, A0, A1, (nums.length - 1) * (nums.length > 10 ? 2 : 5), { w: 3, color: aq(0.85) });
  glow(g, AQ, 10, () => ticks(g, c, c, 384, 434, A0, A1, nums.length - 1, { w: 7, color: '#fff' }));
  glow(g, AQ, 14, () => dialNums(g, c, c, 322, A0, A1, nums, `${nums.length > 10 ? 44 : 56}px ${F_D}`, '#f4fdff'));
  glow(g, AQ, 8, () => { txt(g, unit, c, 700, `34px ${F_D}`, AQW, 'center'); if (sub) txt(g, sub, c, 330, `24px ${F_D}`, aq(0.8), 'center'); });
  return canvasTex(cv);
}
function miniFace(a, b, icon) {
  const S = 256, c = 128, cv = mkCanvas(S, S), g = cv.getContext('2d');
  const bg = g.createRadialGradient(c, c, 10, c, c, 128); bg.addColorStop(0, '#0a2742'); bg.addColorStop(0.8, '#030c18'); bg.addColorStop(1, '#0b3348'); g.fillStyle = bg; g.fillRect(0, 0, S, S);
  glow(g, AQ, 14, () => arc(g, c, c, 116, 0, 360, { w: 6, color: AQW }));
  glow(g, AQ, 8, () => { arc(g, c, c, 88, 210, -30, { w: 4, color: AQW }); ticks(g, c, c, 74, 96, 210, -30, 8, { w: 3, color: AQW }); });
  glow(g, RED, 8, () => arc(g, c, c, 88, 0, -30, { w: 7, color: RED }));
  glow(g, AQ, 8, () => { txt(g, a, 62, 204, `26px ${F_D}`, AQW, 'center'); txt(g, b, 194, 204, `26px ${F_D}`, AQW, 'center'); g.strokeStyle = AQW; g.lineWidth = 4; icon(g, c, 160); });
  return canvasTex(cv);
}
const lcdGrid = new Map();
function lcdFinish(g, W, H) {
  const k = W + 'x' + H; let c = lcdGrid.get(k);
  if (!c) { c = mkCanvas(W, H); const s = c.getContext('2d'); s.fillStyle = 'rgba(0,20,18,0.28)'; for (let y = 0; y < H; y += 3) s.fillRect(0, y, W, 1); for (let x = 0; x < W; x += 3) s.fillRect(x, 0, 1, H); const v = s.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.7); v.addColorStop(0, 'rgba(160,255,230,0.06)'); v.addColorStop(1, 'rgba(0,10,10,0.5)'); s.fillStyle = v; s.fillRect(0, 0, W, H); lcdGrid.set(k, c); }
  g.drawImage(c, 0, 0);
}
function lcdMap(g, x, y, w, h, seed, t, route) {
  const r = rng(seed); g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.fillStyle = '#0f4a45'; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(141,255,224,0.35)'; g.lineWidth = 2; for (let i = 0; i < 9; i++) { line(g, [[x + r() * w, y], [x + r() * w, y + h]]); line(g, [[x, y + r() * h], [x + w, y + r() * h]]); }
  g.fillStyle = 'rgba(141,255,224,0.12)'; for (let i = 0; i < 16; i++) g.fillRect(x + r() * w, y + r() * h, 20 + r() * 50, 14 + r() * 40);
  g.strokeStyle = LCD_FG; g.lineWidth = 5; g.lineJoin = 'round'; g.shadowColor = LCD_FG; g.shadowBlur = 10; line(g, route.map(p => [x + p[0] * w, y + p[1] * h]));
  const [px, py] = route[route.length - 1]; const k = (t * 0.7) % 1; g.lineWidth = 3; g.beginPath(); g.arc(x + px * w, y + py * h, 9 + k * 14, 0, TAU); g.globalAlpha = 1 - k; g.stroke(); g.globalAlpha = 1; g.beginPath(); g.arc(x + px * w, y + py * h, 7, 0, TAU); g.stroke();
  g.restore(); g.strokeStyle = LCD_FG; g.lineWidth = 2; g.strokeRect(x, y, w, h);
}
function monitorL() {
  const W = 512, H = 400;
  return new Screen(W, H, (g, t) => {
    g.fillStyle = LCD_BG; g.fillRect(0, 0, W, H);
    g.shadowColor = LCD_FG; g.shadowBlur = 6; shuttle(g, 20, 14, 62, 40, LCD_FG, 3); txt(g, 'READY', 98, 34, `34px ${F_P}`, LCD_FG); txt(g, 'NORMAL', 98, 62, `34px ${F_P}`, LCD_FG);
    for (let i = 0; i < 3; i++) { g.fillStyle = LCD_FG; g.fillRect(W - 110 + i * 30, 22, 22, 8); } g.shadowBlur = 0;
    lcdMap(g, 20, 78, 290, 236, 4, t, [[0.1, 0.9], [0.3, 0.62], [0.5, 0.56], [0.52, 0.3], [0.5, 0.56], [0.8, 0.5], [0.5, 0.56]]);
    g.shadowColor = LCD_FG; g.shadowBlur = 5;
    [['ODO', '000000 km'], ['RANGE', '620 Mm'], ['CELL', (78 - (Math.floor(t / 30) % 2)) + '%'], ['HULL OK', '']].forEach(([a, b], i) => { txt(g, a, 326, 104 + i * 56, `30px ${F_P}`, LCD_FG); if (b) txt(g, b, 326, 130 + i * 56, `30px ${F_P}`, LCD_FG); });
    for (let i = 0; i < 5; i++) { const x = 24 + i * 94; g.strokeStyle = LCD_FG; g.lineWidth = 3; g.strokeRect(x, 332, 76, 50); const cx = x + 38, cy = 357; if (i === 0) g.strokeRect(cx - 18, cy - 10, 36, 20); if (i === 1) { g.strokeRect(cx - 16, cy - 12, 32, 24); line(g, [[cx - 8, cy], [cx + 8, cy]]); } if (i === 2) { g.beginPath(); g.arc(cx, cy, 13, 0, TAU); g.stroke(); line(g, [[cx, cy], [cx + 8, cy - 8]]); } if (i === 3) shuttle(g, cx - 20, cy - 14, 40, 28, LCD_FG, 2.5); if (i === 4) { for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + t; g.beginPath(); g.ellipse(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8, 9, 5, a, 0, TAU); g.stroke(); } } }
    g.shadowBlur = 0; lcdFinish(g, W, H);
  }, { fps: 6, intensity: 1.15 });
}
function monitorR() {
  const W = 512, H = 400;
  return new Screen(W, H, (g, t) => {
    g.fillStyle = LCD_BG; g.fillRect(0, 0, W, H); g.shadowColor = LCD_FG; g.shadowBlur = 5;
    microText(g, 24, 16, 120, 1, rng(3), LCD_FG, 9); microText(g, W - 150, 16, 120, 1, rng(5), LCD_FG, 9); g.shadowBlur = 0;
    lcdMap(g, 20, 34, W - 40, 196, 9, t, [[0.2, 0.95], [0.34, 0.7], [0.5, 0.62], [0.5, 0.36], [0.68, 0.3], [0.5, 0.36]]);
    g.shadowColor = LCD_FG; g.shadowBlur = 5;
    g.strokeStyle = LCD_FG; g.lineWidth = 3; g.strokeRect(26, 244, 30, 44); line(g, [[26, 258], [56, 258]]); line(g, [[26, 272], [56, 272]]);
    ['AIRLOCK OK', 'CARGO CLOSED', 'TRIM AUTO'].forEach((s, i) => txt(g, s, 72, 262 + i * 26, `28px ${F_P}`, LCD_FG));
    shuttle(g, 316, 244, 150, 62, LCD_FG, 3);
    txt(g, 'ODO  000000 km', 26, 352, `28px ${F_P}`, LCD_FG); txt(g, 'FUEL 65%', 26, 380, `28px ${F_P}`, LCD_FG); txt(g, 'RANGE 580 Mm', W - 26, 352, `28px ${F_P}`, LCD_FG, 'right'); txt(g, 'CELL 65%', W - 26, 380, `28px ${F_P}`, LCD_FG, 'right');
    g.shadowBlur = 0; lcdFinish(g, W, H);
  }, { fps: 6, intensity: 1.15 });
}
function centerLcd() {
  const W = 320, H = 420;
  return new Screen(W, H, (g, t) => {
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#04121f'); bg.addColorStop(1, '#0a3246'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    seg7(g, '000000', W / 2, 62, 58, { color: AQW, off: aq(0.06), glow: 14, align: 'center', gap: 0.22, skew: 0 });
    seg7(g, t % 2 < 1 ? '00:00' : '00 00', W / 2, 142, 52, { color: AQW, off: aq(0.06), glow: 14, align: 'center', gap: 0.22, skew: 0 });
    glow(g, AQ, 10, () => shuttle(g, 62, 232, 196, 86, AQW, 3));
    g.strokeStyle = aq(0.4); g.lineWidth = 1; for (let i = 0; i < 9; i++) line(g, [[20, 240 + i * 12], [W - 20, 240 + i * 12]]);
    glow(g, AQ, 6, () => { g.fillStyle = AQW; g.fillRect(30, 366, 34, 22); g.fillRect(74, 366, 8, 22); g.fillRect(90, 380, 30, 8); txt(g, 'P', W - 44, 390, `28px ${F_D}`, AQW, 'center'); });
    lcdFinish(g, W, H);
  }, { fps: 2, intensity: 1.3 });
}
function climateLcd() {
  const W = 512, H = 176;
  return new Screen(W, H, (g, t) => {
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#031320'); bg.addColorStop(1, '#083040'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    seg7(g, t % 2 < 1 ? '16:00' : '16 00', 300, 18, 58, { color: AQW, off: aq(0.06), glow: 12, align: 'center', gap: 0.24 });
    seg7(g, '22.0', 316, 98, 58, { color: AQW, off: aq(0.06), glow: 12, align: 'center', gap: 0.24 });
    glow(g, AQ, 8, () => { txt(g, '°C', 418, 152, `30px ${F_D}`, AQW); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { g.fillStyle = i + j < 4 ? AQW : aq(0.2); g.fillRect(36 + i * 14, 104 + j * 14, 10, 10); } txt(g, '1', 96, 142, `26px ${F_D}`, AQW); });
    lcdFinish(g, W, H);
  }, { fps: 2, intensity: 1.3 });
}

export function build(app) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a1420);
  const dash = new THREE.Group(); dash.rotation.x = -0.04; scene.add(dash);
  const screens = [], hide = [], needles = [], R = rng(2000);

  scene.environment = makeEnv(app.renderer, ({ card, sky }) => {
    sky([[0, '#9fc4e6'], [0.3, '#4f7fb0'], [0.48, '#1c3558'], [0.52, '#0a1422'], [1, '#05080c']], 0.7);
    card(5, 2.2, 0xffffff, 3, [0, 4.2, 0.4]); card(2.6, 0.35, 0xdaf3ff, 16, [-1.6, 2.6, 3]); card(2.2, 0.3, 0xdaf3ff, 14, [2.2, 2.2, 2.6]);
    card(1.4, 2.2, 0x9fd8ff, 3, [-4.5, 1, 0.4]); card(1.4, 2.2, 0x9fd8ff, 3, [4.5, 1, 0.4]); card(8, 3, 0x7fb8ff, 1.6, [0, 2.6, -5]);
    card(6, 0.5, 0x04070b, 1, [0, 0.9, 5]); card(2.4, 1.0, 0x6f98c0, 1.2, [0.6, 0.5, 5.5]); card(0.5, 0.5, 0x7fe9ff, 14, [1.4, -0.3, 4]);
  });
  scene.environmentIntensity = 0.6;

  /* materials */
  const speck = (() => { const S = 512, a = fbm(S, { oct: 1, base: 256, seed: 5 }), b = fbm(S, { oct: 4, base: 6, seed: 6 }), o = new Float32Array(S * S); for (let i = 0; i < o.length; i++) o[i] = clamp(0.93 + (b[i] - 0.5) * 0.12 - (a[i] > 0.82 ? (a[i] - 0.82) * 2.2 : 0)); const t = grayTex(o, S, { srgb: true }); return t; })();
  const pearl = new THREE.MeshPhysicalMaterial({ color: 0xdfe4e8, roughness: 0.42, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.28, sheen: 0.4, sheenColor: new THREE.Color(0x9fd0ff), sheenRoughness: 0.5, map: rep(speck, 5), roughnessMap: rep(Maps.roughWorn(9), 2), normalMap: rep(Maps.grainN(2.5), 22), normalScale: new THREE.Vector2(0.25, 0.25) });
  const putty = new THREE.MeshPhysicalMaterial({ color: 0xc3c8ca, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4, map: rep(speck, 7), normalMap: rep(Maps.grainN(2.5), 26), normalScale: new THREE.Vector2(0.3, 0.3) });
  const satin = new THREE.MeshStandardMaterial({ color: 0xb4bec8, metalness: 0.55, roughness: 0.4, roughnessMap: rep(Maps.roughGloss(5), 2), normalMap: rep(Maps.micro(), 8), normalScale: new THREE.Vector2(0.15, 0.15) });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xf4f7fa, metalness: 1, roughness: 0.07, roughnessMap: rep(Maps.roughGloss(5), 1.5) });
  const black = new THREE.MeshPhysicalMaterial({ color: 0x05080d, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, roughnessMap: rep(Maps.roughGloss(6), 3) });
  const softDark = new THREE.MeshPhysicalMaterial({ color: 0x0c1017, roughness: 0.7, sheen: 0.6, sheenColor: new THREE.Color(0x4a6a90), sheenRoughness: 0.6, normalMap: rep(Maps.grainN(3), 30), normalScale: new THREE.Vector2(0.5, 0.5) });
  const grey = new THREE.MeshStandardMaterial({ color: 0x7c858d, roughness: 0.62, normalMap: rep(Maps.grainN(3), 24), normalScale: new THREE.Vector2(0.4, 0.4) });
  const jelly = new THREE.MeshPhysicalMaterial({ color: 0x9fe6ff, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0x2ab8ee, emissiveIntensity: 0.22, transparent: true, opacity: 0.92 });
  const glass = glassMat({ opacity: 0.1, rough: 0.04, env: 0.7, smudgeRep: 0.8 });
  const neon = (hex, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
  const screws = screwKit('cross', satin);

  /* body */
  dash.add(plate(blob([[-1.04, 0.0], [-0.99, 0.2], [-0.7, 0.3], [-0.3, 0.335], [0, 0.35], [0.3, 0.335], [0.7, 0.3], [0.99, 0.2], [1.04, 0.0], [0.98, -0.2], [0.72, -0.275], [0.42, -0.29], [0.34, -0.385], [0, -0.41], [-0.34, -0.385], [-0.42, -0.29], [-0.72, -0.275], [-0.98, -0.2]]), { d: 0.07, bevel: 0.024, seg: 6, mat: pearl, z: -0.04 }));
  const EX = 0.905, EY = 0.232, ECY = -0.012;
  dash.add(plate(new THREE.Shape().absellipse(0, ECY, EX, EY, 0, TAU), { d: 0.008, bevel: 0.003, seg: 3, mat: satin, z: 0.03, curve: 80 }));
  { const pts = []; for (let i = 0; i < 160; i++) { const a = i / 160 * TAU; pts.push(new THREE.Vector3(Math.cos(a) * EX, ECY + Math.sin(a) * EY, 0)); }
    const ring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 320, 0.013, 14, true), chrome); ring.position.z = 0.04; ring.scale.z = 0.8; dash.add(sh(ring)); }
  const Z1 = 0.038;
  // vents
  dash.add(plate(rr(0.32, 0.034, 0.016), { d: 0.01, bevel: 0.003, seg: 3, mat: satin, x: 0, y: 0.272, z: 0.026 })); for (let i = 0; i < 3; i++) dash.add(box(0.085, 0.012, 0.006, softDark, -0.1 + i * 0.1, 0.272, 0.034));
  for (const s of [-1, 1]) { const v = plate(rr(0.22, 0.02, 0.01), { d: 0.008, bevel: 0.003, seg: 3, mat: softDark, x: s * 0.5, y: 0.262, z: 0.027 }); v.rotation.z = -s * 0.07; dash.add(v); }

  /* twin dials in a gloss-black binnacle */
  dash.add(plate(rr(0.76, 0.318, 0.159), { d: 0.012, bevel: 0.004, seg: 4, mat: black, x: 0, y: 0.036, z: Z1, curve: 40 }));
  { const pts = []; const W2 = 0.76 / 2 - 0.159, RR = 0.159; for (let i = 0; i <= 60; i++) { const a = -PI / 2 + i / 60 * PI; pts.push(new THREE.Vector3(W2 + Math.cos(a) * RR, 0.036 + Math.sin(a) * RR, 0)); } for (let i = 0; i <= 60; i++) { const a = PI / 2 + i / 60 * PI; pts.push(new THREE.Vector3(-W2 + Math.cos(a) * RR, 0.036 + Math.sin(a) * RR, 0)); }
    const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.2), 300, 0.007, 12, true), chrome); t.position.z = Z1 + 0.011; dash.add(sh(t)); }
  const ZB = Z1 + 0.012;
  function bigDial(x, tex, fn, hubK = 1) {
    const g = new THREE.Group(); g.position.set(x, 0.036, ZB); dash.add(g);
    g.add(bezelRing(0.127, 0.017, 0.03, 0, chrome, 120)); g.add(lathe([[0.127, 0.02], [0.121, 0.012], [0.12, 0.002]], black, 96));
    const f = disc(0.121, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.25, 1.25, 1.25) }), 96); f.position.z = 0.002; g.add(f);
    const n = needleMesh(0.104, 0.007, neon(0xd8f8ff, 4), { tail: 0.18, thick: 0.0012, tip: 0.35 }); n.position.z = 0.011; n.castShadow = false; g.add(n); needles.push({ mesh: n, fn });
    g.add(lathe([[0.02, 0.004], [0.02, 0.012], [0.016, 0.017], [0.0001, 0.018]], chrome, 40));
    const gl = dome(0.126, 0.014, glass); gl.position.z = 0.021; g.add(gl); hide.push(gl);
    const l = new THREE.PointLight(0x6fdcff, 0.07, 1.0, 2); l.position.set(0, 0, 0.16); g.add(l);
  }
  const A = v => (225 - 270 * v - 90) * PI / 180;
  bigDial(-0.212, dialFace([0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240], 'km/s', 'VELOCITY', 0.92), t => A(0.335 + 0.006 * Math.sin(t * 0.5) + 0.002 * Math.sin(t * 2.3)));
  bigDial(0.212, dialFace([0, 1, 2, 3, 4, 5, 6, 7, 8], 'x1000 kN', 'THRUST', 0.82), t => A(0.36 + 0.012 * Math.sin(t * 0.8 + 1) + 0.004 * Math.sin(t * 3.1)));
  { const s = centerLcd(); const w = 0.118, h = 0.155; dash.add(plate((() => { const sp = rr(w + 0.012, h + 0.012, 0.012); sp.holes.push(rrHole(w, h, 0.008, 0, 0)); return sp; })(), { d: 0.008, bevel: 0.002, mat: black, edge: chrome, x: 0, y: 0.03, z: ZB }));
    const q = quad(w, h, s.mat, 0.008); q.position.set(0, 0.03, ZB + 0.002); dash.add(q); screens.push(s); const gl = quad(w, h, glass, 0.008); gl.position.set(0, 0.03, ZB + 0.0065); gl.renderOrder = 5; dash.add(gl); hide.push(gl); }

  /* small dials */
  function miniDial(x, y, r, tex, v) {
    const g = new THREE.Group(); g.position.set(x, y, Z1); dash.add(g);
    g.add(bezelRing(r, r * 0.2, 0.014, 0, chrome, 64)); const f = disc(r, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.2, 1.2, 1.2) })); f.position.z = 0.001; g.add(f);
    const n = needleMesh(r * 0.7, r * 0.09, neon(0xd8f8ff, 3.5), { tail: 0.15, thick: 0.001 }); n.position.z = 0.005; n.castShadow = false; g.add(n); needles.push({ mesh: n, fn: t => (210 - 240 * (v + 0.01 * Math.sin(t * 0.6 + x * 5)) - 90) * PI / 180 });
    g.add(cyl(r * 0.12, r * 0.14, 0.008, chrome, 20)); const gl = dome(r * 0.99, r * 0.14, glass); gl.position.z = 0.01; g.add(gl); hide.push(gl);
  }
  const thermo = (g, c, y) => { line(g, [[c, y - 30], [c, y - 4]]); g.beginPath(); g.arc(c, y + 4, 8, 0, TAU); g.stroke(); line(g, [[c + 6, y - 24], [c + 14, y - 24]]); line(g, [[c + 6, y - 14], [c + 14, y - 14]]); };
  const pump = (g, c, y) => { g.strokeRect(c - 12, y - 26, 20, 34); line(g, [[c + 8, y - 16], [c + 18, y - 10], [c + 18, y + 6]]); line(g, [[c - 8, y - 16], [c + 4, y - 16]]); };
  miniDial(-0.782, -0.02, 0.043, miniFace('H', 'C', thermo), 0.45); miniDial(0.782, -0.02, 0.043, miniFace('B', 'F', thermo), 0.6);
  miniDial(-0.372, -0.092, 0.04, miniFace('E', 'F', pump), 0.65); miniDial(0.372, -0.092, 0.04, miniFace('E', 'F', pump), 0.7); miniDial(0.762, -0.105, 0.024, miniFace('', '', pump), 0.5);

  /* LCD bricks */
  function monitor(x, scr) {
    const g = new THREE.Group(); g.position.set(x, -0.012, Z1); g.rotation.y = -Math.sign(x) * 0.06; dash.add(g);
    g.add(plate(rr(0.29, 0.25, 0.022), { d: 0.045, bevel: 0.009, seg: 5, mat: putty, z: -0.005 }));
    const w = 0.208, h = 0.163, cy = 0.018; const s = rr(w + 0.03, h + 0.03, 0.014); s.holes.push(rrHole(w, h, 0.008, 0, 0)); g.add(plate(s, { d: 0.008, bevel: 0.003, seg: 3, mat: grey, x: 0, y: cy, z: 0.04 }));
    const q = quad(w, h, scr.mat, 0.008); q.position.set(0, cy, 0.0415); g.add(q); screens.push(scr);
    const gl = quad(w, h, glassMat({ opacity: 0.16, rough: 0.09, env: 0.8, smudgeRep: 1.2 }), 0.008); gl.position.set(0, cy, 0.046); gl.renderOrder = 5; g.add(gl); hide.push(gl);
    for (let i = 0; i < 4; i++) g.add(plate(rr(0.034, 0.011, 0.005), { d: 0.006, bevel: 0.002, seg: 3, mat: satin, x: -0.062 + i * 0.041, y: -0.098, z: 0.04 }));
    g.add(plate(rr(0.05, 0.008, 0.004), { d: 0.004, bevel: 0.0015, mat: grey, x: 0, y: 0.112, z: 0.04 }));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const c = cyl(0.0042, 0.005, 0.003, satin, 16); c.position.set(sx * 0.128, sy * 0.108, 0.04); g.add(c); }
    const l = new THREE.PointLight(0x70ffd8, 0.05, 0.9, 2); l.position.set(0, 0, 0.18); g.add(l);
  }
  monitor(-0.572, monitorL()); monitor(0.572, monitorR());
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) dash.add(plate(rr(0.03, 0.009, 0.004), { d: 0.005, bevel: 0.002, seg: 3, mat: satin, x: s * (0.36 + i * 0.038), y: -0.172 - Math.abs(i - 2) * 0.004 + 0.0, z: Z1 }));

  /* jelly button cluster */
  dash.add(plate(poly([[-0.3, -0.108], [0.3, -0.108], [0.215, -0.248], [-0.215, -0.248]], 0.05), { d: 0.012, bevel: 0.005, seg: 4, mat: satin, z: Z1 - 0.002 }));
  const ZJ = Z1 + 0.01;
  const jbtn = (x, y, w, label, rot = 0) => {
    const b = plate(rr(w, 0.027, 0.011), { d: 0.012, bevel: 0.0045, seg: 4, mat: jelly, x, y, z: ZJ }); b.rotation.z = rot; b.castShadow = false; dash.add(b);
    const d = decal(w * 0.82, 0.02, Math.round(w * 2400), 60, (g, W, H) => { g.shadowColor = '#fff'; g.shadowBlur = 6; if (label.length > 1) txt(g, label, W / 2, H / 2 + 1, `24px ${F_D}`, '#f6feff', 'center', 'middle'); else { g.strokeStyle = '#f6feff'; g.lineWidth = 4; g.lineJoin = 'round'; const c = W / 2, m = H / 2; ({ a: () => line(g, [[c - 22, m + 6], [c - 10, m - 10], [c + 10, m - 10], [c + 22, m + 6], [c - 22, m + 6]]), b: () => { line(g, [[c - 16, m], [c + 12, m]]); line(g, [[c + 4, m - 8], [c + 14, m], [c + 4, m + 8]]); }, c: () => shuttle(g, c - 24, m - 15, 48, 30, '#f6feff', 3), d: () => { line(g, [[c - 14, m + 8], [c, m - 10], [c + 14, m + 8]], true); }, e: () => { g.beginPath(); g.arc(c, m, 10, 0, TAU); g.stroke(); line(g, [[c, m - 16], [c, m - 4]]); }, f: () => { for (let k = 0; k < 3; k++) { const a2 = k * TAU / 3; g.beginPath(); g.ellipse(c + Math.cos(a2) * 8, m + Math.sin(a2) * 8, 9, 5, a2, 0, TAU); g.stroke(); } }, g: () => { line(g, [[c - 16, m - 6], [c - 4, m + 6], [c + 16, m - 8]]); }, h: () => { g.beginPath(); g.arc(c, m + 2, 11, PI, 0); g.stroke(); line(g, [[c - 16, m + 2], [c + 16, m + 2]]); } })[label](); } }, { emissive: 1.25, additive: true });
    d.position.set(x, y, ZJ + 0.0126); d.rotation.z = rot; dash.add(d);
  };
  [['MODE', -0.086], ['SET', 0], ['RESET', 0.086]].forEach(([s, x]) => jbtn(x, -0.134, 0.078, s, -x * 0.5));
  ['a', 'b', 'c', 'g', 'h'].forEach((s, i) => jbtn(-0.164 + i * 0.082, -0.171 - Math.abs(i - 2) * 0.0, i === 2 ? 0.09 : 0.066, s, -(i - 2) * 0.05));
  ['d', 'a', 'e', 'f'].forEach((s, i) => jbtn(-0.14 + i * 0.093 + (i > 1 ? 0.0 : 0), -0.208, i === 1 || i === 2 ? 0.09 : 0.07, s, -(i - 1.5) * 0.06));
  { const l = new THREE.PointLight(0x58d8ff, 0.035, 0.8, 2); l.position.set(0, -0.17, ZJ + 0.1); dash.add(l); }

  /* climate strip */
  dash.add(plate(rr(0.66, 0.1, 0.03), { d: 0.014, bevel: 0.006, seg: 4, mat: satin, x: 0, y: -0.318, z: 0.022 })); const ZC = 0.036;
  { const s = climateLcd(), w = 0.165, h = 0.057; const sp = rr(w + 0.014, h + 0.014, 0.008); sp.holes.push(rrHole(w, h, 0.004, 0, 0)); dash.add(plate(sp, { d: 0.007, bevel: 0.002, mat: black, edge: chrome, x: 0, y: -0.318, z: ZC }));
    const q = quad(w, h, s.mat, 0.004); q.position.set(0, -0.318, ZC + 0.002); dash.add(q); screens.push(s); const gl = quad(w, h, glass, 0.004); gl.position.set(0, -0.318, ZC + 0.0055); gl.renderOrder = 5; dash.add(gl); hide.push(gl);
    const l = new THREE.PointLight(0x6fdcff, 0.03, 0.6, 2); l.position.set(0, -0.318, ZC + 0.1); dash.add(l); }
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * 0.185, -0.318, ZC); dash.add(g);
    g.add(lathe([[0.04, 0], [0.04, 0.006], [0.036, 0.01], [0.031, 0.01]], chrome, 48)); g.add(lathe([[0.03, 0.0], [0.03, 0.02], [0.026, 0.026], [0.012, 0.027], [0.0001, 0.026]], satin, 48));
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.0335, 0.0022, 8, 48), neon(0x6fdcff, 2.6)); t.position.z = 0.009; g.add(t);
    const m = box(0.004, 0.014, 0.002, neon(0xd8f8ff, 3), 0, 0.017, 0.027); m.castShadow = false; g.add(m); g.rotation.z = s * 0.5;
    for (const [dx, dy] of [[0.068, 0.02], [0.068, -0.02], [0.112, 0.02], [0.112, -0.02]]) dash.add(plate(rr(0.032, 0.026, 0.008), { d: 0.008, bevel: 0.003, seg: 3, mat: dx > 0.1 ? satin : jelly, x: s * (0.185 + dx), y: -0.318 + dy, z: ZC }));
  }

  /* foreground yoke, out of focus */
  const yoke = new THREE.Group(); yoke.position.set(0, 0, 0.82); scene.add(yoke);
  for (const s of [-1, 1]) yoke.add(cable([[s * 0.08, -0.5, 0], [s * 0.17, -0.4, 0.01], [s * 0.27, -0.3, 0.02], [s * 0.31, -0.2, 0.03], [s * 0.3, -0.115, 0.04]], 0.034, softDark, 40));
  { const hub = new THREE.Mesh(new THREE.SphereGeometry(0.17, 40, 24), softDark); hub.scale.set(1.25, 0.8, 0.5); hub.position.set(0, -0.46, 0); yoke.add(sh(hub));
    const badge = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.005, 10, 40), chrome); badge.position.set(0, -0.42, 0.083); yoke.add(badge); }

  /* cabin */
  const cowl = plate(rr(3.0, 1.3, 0.2), { d: 0.06, bevel: 0.02, seg: 4, mat: grey }); cowl.rotation.x = -PI / 2 + 0.1; cowl.position.set(0, 0.26, -0.72); scene.add(cowl);
  scene.add(box(3.4, 0.9, 0.3, softDark, 0, -0.92, -0.1));
  for (const s of [-1, 1]) {
    const door = plate(rr(1.2, 0.9, 0.12), { d: 0.1, bevel: 0.03, seg: 4, mat: pearl }); door.position.set(s * 1.3, -0.52, 0.55); door.rotation.y = -s * 1.15; scene.add(door);
    const sill = box(1.3, 0.1, 0.16, softDark, s * 1.32, -0.02, 0.5); sill.rotation.y = -s * 1.15; scene.add(sill);
    const pil = box(0.14, 2.4, 0.16, softDark, s * 1.36, 1.0, -0.6); pil.rotation.z = -s * 0.42; pil.rotation.y = s * 0.3; scene.add(pil);
    const handle = plate(rr(0.2, 0.06, 0.03), { d: 0.03, bevel: 0.01, seg: 4, mat: chrome }); handle.position.set(s * 1.12, -0.18, 0.72); handle.rotation.y = -s * 1.15; scene.add(handle);
  }
  scene.add(box(3.6, 0.3, 0.4, softDark, 0, 1.5, -0.4));
  { const W = 1024, H = 512, c = mkCanvas(W, H), g = c.getContext('2d'), r = rng(8);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#0a1626'); gr.addColorStop(0.4, '#1d3d5e'); gr.addColorStop(0.7, '#2b587c'); gr.addColorStop(1, '#0b1a2a'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const sun = g.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, 260); sun.addColorStop(0, 'rgba(210,240,255,1)'); sun.addColorStop(0.12, 'rgba(120,190,255,0.8)'); sun.addColorStop(0.5, 'rgba(60,120,190,0.25)'); sun.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = sun; g.fillRect(0, 0, W, H);
    try { g.filter = 'blur(10px)'; } catch (e) { /* ignore */ }
    for (let i = 0; i < 40; i++) { g.globalAlpha = 0.08 + r() * 0.2; g.fillStyle = ['#bfe6ff', '#8fd0ff', '#ffffff', '#7fe9ff'][i % 4]; g.beginPath(); g.arc(r() * W, H * (0.3 + r() * 0.6), 6 + r() * 26, 0, TAU); g.fill(); }
    for (let i = 0; i < 9; i++) { g.globalAlpha = 0.12; g.fillStyle = '#dff3ff'; g.fillRect(r() * W, H * (0.45 + r() * 0.3), 80 + r() * 200, 14 + r() * 30); }
    g.filter = 'none'; g.globalAlpha = 1;
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(22, 11), new THREE.MeshBasicMaterial({ map: canvasTex(c), color: new THREE.Color(0.85, 0.85, 0.85) })); sky.position.set(0, 2.6, -9); scene.add(sky); }

  /* lights */
  const key = new THREE.SpotLight(0xe6f4ff, 11, 9, 0.6, 1, 2); key.position.set(0.5, 2.0, 1.9); key.target.position.set(0, -0.08, 0); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.002; key.shadow.camera.near = 0.8; key.shadow.camera.far = 5; key.shadow.radius = 3; scene.add(key, key.target);
  const back = new THREE.DirectionalLight(0x9fd0ff, 0.9); back.position.set(0, 2, -2); scene.add(back);
  scene.add(new THREE.HemisphereLight(0x9cc4f0, 0x0a1018, 0.35));
  const f1 = new THREE.PointLight(0x7fc8ff, 0.3, 3, 2); f1.position.set(-1.2, 0.2, 1.0); scene.add(f1);

  for (const s of screens) s.update(0);
  return {
    scene, hide,
    look: { exposure: 0.92, tone: THREE.ACESFilmicToneMapping, contrast: 1.06, sat: 1.05, sharp: 0.4, bloom: [0.34, 0.8, 1.0], focus: 2.0, aperture: 2.6, maxBlur: 26, ca: 0.005, distort: 0.035, vig: 0.65, grain: 0.045, lift: 0.01, ao: { radius: 0.06, intensity: 1 }, cam: [0, 0.0, 2.0], target: [0, -0.035, 0], tint: [0.96, 1.0, 1.06], parallax: [0.12, 0.05] },
    update(t) { for (const s of screens) s.update(t); for (const n of needles) n.mesh.rotation.z = n.fn(t); jelly.emissiveIntensity = 0.22 + 0.03 * Math.sin(t * 1.3); },
  };
}
