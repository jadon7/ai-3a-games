// hud.js - 商场突袭 / MALL STRIKE HUD, a real-time Canvas2D port of scripts/composite.py.
//
// No dependencies, no build step.
//
//   import { HUD } from './hud.js';
//   const hud = new HUD(canvas);
//   hud.resize(innerWidth, innerHeight, devicePixelRatio);
//   requestAnimationFrame(function loop() { hud.draw(state); requestAnimationFrame(loop); });
//
// Coordinate system: everything is laid out in composite.py's 1920x1080 pixel units ("design
// units"). The uniform scale k = cssH / 1080 maps design units to CSS pixels, so the HUD height
// always spans 1080 units and the width spans VW = cssW / k units. Every element keeps the
// screen edge it is anchored to in composite.py (left: x, right: VW - x, centre: VW / 2).
// Frame timings from composite.py (30 fps) are converted to seconds and driven by s.t.
//
// PIL conventions reproduced here: an inclusive rectangle (x0, y0, x1, y1) covers
// [x0, x1 + 1) x [y0, y1 + 1); a line of odd width w is centred on pixel centres (+0.5),
// even width on the pixel edge after it (+1); text anchors 'mm' / 'lm' / 'rm' use the font's
// (ascent - descent) / 2, 'ls' / 'rs' the baseline. The whole HUD layer gets composite.py's
// soft drop shadow (alpha blurred by sigma 2, x0.45, offset +2,+2).

const F = 1 / 30; // one composite.py frame, in seconds
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const DH = 1080; // design height

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rgb = (r, g, b) => `rgb(${r},${g},${b})`;
const rgba = (r, g, b, a) => `rgba(${r},${g},${b},${(a / 255).toFixed(4)})`;
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

// ------------------------------------------------------------------ colours (composite.py)
const COL = {
  white: rgb(240, 240, 236), // WHITE
  pure: rgb(255, 255, 255),
  black: rgb(0, 0, 0),
  amber: rgb(255, 214, 90),
  ammoLow: rgb(255, 210, 90),
  blue: rgb(110, 190, 255),
  blueBar: rgb(70, 170, 255),
  red: rgb(255, 95, 85),
  hit: rgb(255, 60, 50),
  tag: rgb(255, 70, 60),
  grey: rgb(200, 200, 196),
  panel: rgb(12, 14, 16),
  feed: rgb(10, 12, 14),
  lvText: rgb(20, 20, 20),
  arc: rgb(230, 30, 25),
  dotFill: rgb(235, 40, 35),
  dotLine: rgb(255, 160, 150),
  deadX: rgb(235, 60, 50),
  medal: rgb(200, 40, 35),
  medalText: rgb(255, 240, 220),
  disc: rgb(10, 12, 14),
  ring: rgb(230, 232, 228),
  nDisc: rgb(20, 22, 24),
};

// ------------------------------------------------------------------ fonts
// composite.py: DIN Alternate Bold (numbers / Latin) and Hiragino Sans GB ttc index 1, which is
// the hidden '.Hiragino Sans GB Interface' W3 face. Browsers can only select the regular
// 'Hiragino Sans GB' W3 face, whose glyphs render at 1/0.923 the size of the Interface face, so
// CJK fonts are requested at 0.923x their composite.py size to keep the same text widths.
const DIN_STACK = '"DIN Alternate", "DINAlternate-Bold", "DIN Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';
const CN_STACK = '"Hiragino Sans GB", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';
const CN_SCALE = 0.923;

class Font {
  constructor(kind, size, bold) {
    this.kind = kind;
    this.size = size; // composite.py / design size in px
    const em = kind === 'cn' ? size * CN_SCALE : size;
    this.css = `${bold ? 'bold' : 'normal'} ${+em.toFixed(2)}px ${kind === 'cn' ? CN_STACK : DIN_STACK}`;
    // fallback for (ascent - descent) / 2 if measureText lacks fontBoundingBox*; values from PIL
    this.mid = (kind === 'cn' ? 0.35 : 0.355) * size;
    this.w = new Map(); // text -> advance width in design units
  }
}

const FN = { xs: new Font('din', 18), s: new Font('din', 22), m: new Font('din', 28), l: new Font('din', 40), xl: new Font('din', 64), xxl: new Font('din', 84) };
const FC = { xs: new Font('cn', 18), s: new Font('cn', 22), m: new Font('cn', 28), l: new Font('cn', 36) };
// screens / extras
const FX = {
  pop: new Font('din', 48), // kill popup "+100" (scaled by the pop factor)
  fps: new Font('din', 15),
  kc: new Font('din', 20), // key caps
  kcCn: new Font('cn', 19),
  tag: new Font('din', 30),
  tagS: new Font('din', 16),
  big: new Font('din', 96),
  score: new Font('din', 84),
  vs: new Font('din', 28),
  killer: new Font('din', 32),
  title: new Font('cn', 128, true),
  head: new Font('cn', 96, true),
  result: new Font('cn', 140, true),
  prompt: new Font('cn', 40),
  cn24: new Font('cn', 24),
  cn22: new Font('cn', 22),
  cn20: new Font('cn', 20),
  cn18: new Font('cn', 18),
  killerCn: new Font('cn', 30),
};
const ALL_FONTS = [...Object.values(FN), ...Object.values(FC), ...Object.values(FX)];

const CJK_RE = /[⺀-鿿豈-﫿＀-￯]/;

// ------------------------------------------------------------------ mall map (world metres, composite.py)
const MAP_RECTS = [ // (x0, y0, x1, y1, kind)
  [-11, -12, 11, 62, 'floor'],
  [-17, -12, -11, 62, 'store'], [11, -12, 17, 62, 'store'],
  [-1.7, 19.3, 1.7, 20.7, 'obj'], [-2.2, 1.6, 2.2, 3.2, 'obj'], [-1.7, 36, 1.7, 44.7, 'esc'],
];
const MAP_FILL = {
  floor: rgba(120, 130, 135, 90), store: rgba(60, 66, 70, 160),
  obj: rgba(170, 176, 180, 140), esc: rgba(90, 96, 100, 170),
};
const UNIT_B = [-12, -3, 6, 15, 24, 33, 42, 51, 62];
const COLS = [];
for (const s of [-1, 1]) for (const y of [0, 9, 18, 27, 36, 45, 54]) COLS.push([s * 5.15, y]);
const MALL = [-17, -12, 17, 62]; // footprint
const MM = { cx: 190, cy: 190, R: 150, sc: 4.2, pad: 14 }; // minimap: centre, radius, px per metre

const COMPASS_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const MEDALS = { 1: ['击杀', ''], 2: ['双杀', 'DOUBLE'], 3: ['三杀', 'TRIPLE'], 4: ['四杀', 'QUAD'] };
const CONTROLS = [['WASD', '移动'], ['Shift', '冲刺'], ['鼠标', '瞄准'], ['左键', '射击'],
  ['右键', '开镜'], ['R', '换弹'], ['C', '蹲下'], ['Esc', '暂停']];

// small string caches so the per-frame path does not build strings
const NUM = [];
const num = (n) => {
  n = Math.trunc(n);
  if (n >= 0 && n < 1000) return NUM[n] || (NUM[n] = String(n));
  return String(n);
};
const HEAD3 = [];
for (let i = 0; i < 360; i++) HEAD3.push(String(i).padStart(3, '0'));
const TIMER = [];
const timer = (secs) => {
  if (secs < 6000) return TIMER[secs] || (TIMER[secs] = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
};
const RESERVE = [];
const reserveStr = (n) => (n >= 0 && n < 1000 ? RESERVE[n] || (RESERVE[n] = `/ ${n}`) : `/ ${n}`);
const FPS_STR = [];
const LV = [];
const lvStr = (n) => (n >= 0 && n < 1000 ? LV[n] || (LV[n] = `LV ${n}`) : `LV ${n}`);
const POPS = [];
const popStr = (n) => POPS[n] || (POPS[n] = [`+${100 + (n - 1) * 50}`,
  MEDALS[Math.min(n, 4)][0] + (MEDALS[Math.min(n, 4)][1] ? `  ${MEDALS[Math.min(n, 4)][1]} KILL` : '  敌人已消灭'), `×${n}`]);

// separable box blur (3 passes ~ Gaussian), edge-clamped like PIL's GaussianBlur
function boxesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const out = [];
  for (let i = 0; i < n; i++) out.push(i < m ? wl : wu);
  return out;
}
function boxPass(src, dst, w, h, r, horiz) {
  const n = horiz ? w : h, lines = horiz ? h : w, step = horiz ? 1 : w, lstep = horiz ? w : 1;
  const inv = 1 / (2 * r + 1);
  for (let l = 0; l < lines; l++) {
    const base = l * lstep;
    const first = src[base], last = src[base + (n - 1) * step];
    let acc = first * (r + 1);
    for (let i = 0; i < r; i++) acc += src[base + Math.min(i, n - 1) * step];
    for (let i = 0; i < n; i++) {
      const ia = i + r, ib = i - r - 1;
      acc += ia < n ? src[base + ia * step] : last;
      acc -= ib >= 0 ? src[base + ib * step] : first;
      dst[base + i * step] = acc * inv;
    }
  }
}
function gaussBlur(a, w, h, sigma) {
  const tmp = new Float32Array(a.length);
  for (const b of boxesForGauss(sigma, 3)) {
    const r = (b - 1) / 2;
    boxPass(a, tmp, w, h, r, true);
    boxPass(tmp, a, w, h, r, false);
  }
  return a;
}

// ------------------------------------------------------------------ HUD
export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layer = document.createElement('canvas'); // HUD layer, composited with the drop shadow
    this.lctx = this.layer.getContext('2d');
    this.mini = document.createElement('canvas'); // per-frame minimap composition
    this.mctx = this.mini.getContext('2d');
    this.mapCache = document.createElement('canvas'); // static mall map in world space
    this.vig = document.createElement('canvas'); // red edge vignette (alpha at al = 1)
    this._m = document.createElement('canvas').getContext('2d'); // text measuring
    this.shadows = true; // composite.py's soft drop shadow under the whole HUD layer
    this.minimapQuality = 'low'; // smoothing for the rotated map cache ('low' | 'medium' | 'high'), applied on resize

    this._nameFont = new Map();
    this._etrack = new Map();
    this._resetTrackers();
    this._measureFonts();
    if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
      document.fonts.addEventListener('loadingdone', () => this._measureFonts());
    }
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    this.resize((r && r.width) || canvas.width || 1920, (r && r.height) || canvas.height || 1080,
      (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  }

  _resetTrackers() {
    this._pt = NaN; this._px = NaN; this._py = NaN;
    this._speed = 0; this._spread = 0;
    this._lastShotT = -1e9; this._prevAmmo = -1;
    this._reloadStart = -1;
    this._deadTotal = 0; this._wasDead = false;
    this._etrack.clear();
  }

  _measureFonts() {
    const m = this._m;
    for (const f of ALL_FONTS) {
      m.font = f.css;
      const mt = m.measureText('Hg国');
      // PIL 'm' anchor = (ascent - descent) / 2 above the baseline (CSS px == design units here)
      if (mt.fontBoundingBoxAscent > 0) f.mid = (mt.fontBoundingBoxAscent - mt.fontBoundingBoxDescent) / 2;
      f.w.clear();
    }
    for (const c of [this.ctx, this.lctx, this.mctx]) if (c) c._f = null;
  }

  // ---------------------------------------------------------------- layout
  resize(cssW, cssH, dpr = 1) {
    cssW = Math.max(1, cssW); cssH = Math.max(1, cssH); dpr = dpr || 1;
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
    const bw = Math.max(1, Math.round(cssW * dpr)), bh = Math.max(1, Math.round(cssH * dpr));
    this.bw = bw; this.bh = bh;
    this.canvas.width = bw; this.canvas.height = bh; // CSS size is left to the page (e.g. 100vw x 100vh)
    this.layer.width = bw; this.layer.height = bh;
    this.k = cssH / DH; // design unit -> CSS px
    this.kd = this.k * dpr; // design unit -> device px
    this.VW = cssW / this.k; // design width
    // bilinear is enough for the (smooth) vignette upscale; 'high' costs ~25 ms/frame without a GPU
    for (const c of [this.ctx, this.lctx]) { c._f = null; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'low'; }

    // minimap composition canvas, device-pixel aligned
    const kd = this.kd, P = MM.pad;
    this._mox = Math.floor((MM.cx - MM.R - P) * kd);
    this._moy = Math.floor((MM.cy - MM.R - P) * kd);
    this.mini.width = Math.ceil((MM.cx + MM.R + P + 1) * kd) - this._mox;
    this.mini.height = Math.ceil((MM.cy + MM.R + P + 1) * kd) - this._moy;
    this.mctx._f = null;
    this.mctx.imageSmoothingEnabled = true; this.mctx.imageSmoothingQuality = this.minimapQuality || 'low';
    this._buildMapCache();
    this._buildVignette();
    // screens: shrink to fit narrow (portrait) windows
    this._sS = Math.min(1, this.VW / 760);
  }

  // Static mall map, drawn once per resize in world space (axis-aligned, so every primitive is a
  // pixel-snapped rect and composite.py's "replace" drawing order is reproduced exactly with
  // clearRect + fillRect). The margin is filled with the minimap disc colour so the rotated map
  // never shows a seam inside the circle.
  _buildMapCache() {
    const sc = MM.sc, marg = (MM.R + 6) / sc + 1;
    const X0 = MALL[0] - marg, Y0 = MALL[1] - marg, X1 = MALL[2] + marg, Y1 = MALL[3] + marg;
    let S = sc * this.kd * 2; // cache px per metre (2x supersampled)
    S = Math.min(S, 2048 / (Y1 - Y0), 2048 / (X1 - X0));
    const c = this.mapCache;
    c.width = Math.ceil((X1 - X0) * S); c.height = Math.ceil((Y1 - Y0) * S);
    const g = c.getContext('2d');
    const px = (x) => Math.round((x - X0) * S), py = (y) => Math.round((y - Y0) * S);
    const put = (x0, y0, x1, y1, fill) => {
      const a = px(Math.min(x0, x1)), b = py(Math.min(y0, y1));
      const w = Math.max(1, px(Math.max(x0, x1)) - a), h = Math.max(1, py(Math.max(y0, y1)) - b);
      g.clearRect(a, b, w, h); g.fillStyle = fill; g.fillRect(a, b, w, h);
    };
    g.fillStyle = rgba(10, 12, 14, 150); g.fillRect(0, 0, c.width, c.height);
    for (const [x0, y0, x1, y1, kind] of MAP_RECTS) put(x0, y0, x1, y1, MAP_FILL[kind]);
    const lw2 = 2 / sc / 2, lw1 = 1 / sc / 2; // half widths in metres of 2 px / 1 px lines
    for (const s of [-1, 1]) {
      for (const yb of UNIT_B) put(s * 11, yb - lw2, s * 17, yb + lw2, rgba(150, 156, 160, 140));
      put(s * 11 - lw2, -12, s * 11 + lw2, 62, rgba(190, 196, 200, 170));
      put(s * 4.5 - lw1, -12, s * 4.5 + lw1, 62, rgba(150, 160, 165, 90));
    }
    const rr = 2.75 / sc * S;
    for (const [x, y] of COLS) {
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.arc((x - X0) * S, (y - Y0) * S, rr, 0, TAU); g.fill();
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = rgba(200, 205, 208, 150); g.fill();
    }
    this._map = { X0, Y0, w: c.width / S, h: c.height / S };
  }

  // composite.py damage_indicator vignette: quarter-res L mask = 70 outside an ellipse slightly
  // larger than the frame, GaussianBlur(6), upscaled, coloured (140, 0, 0). Cached at al = 1;
  // the per-frame alpha is applied with globalAlpha (the operation is linear in al).
  _buildVignette() {
    const sw = Math.max(16, Math.round(this.VW / 4)), sh = DH / 4;
    const a = new Float32Array(sw * sh);
    const cx = sw / 2, cy = sh / 2, ex = sw * 0.58, ey = sh * 0.6;
    for (let j = 0; j < sh; j++) {
      const dy = (j + 0.5 - cy) / ey;
      for (let i = 0; i < sw; i++) {
        const dx = (i + 0.5 - cx) / ex;
        a[j * sw + i] = dx * dx + dy * dy <= 1 ? 0 : 70;
      }
    }
    gaussBlur(a, sw, sh, 6);
    const v = this.vig;
    v.width = sw; v.height = sh;
    const g = v.getContext('2d');
    const img = g.createImageData(sw, sh);
    for (let i = 0; i < a.length; i++) {
      img.data[i * 4] = 140; img.data[i * 4 + 3] = Math.round(a[i]);
    }
    g.putImageData(img, 0, 0);
  }

  // ---------------------------------------------------------------- helpers
  _tw(f, s) {
    let w = f.w.get(s);
    if (w === undefined) {
      if (f.w.size > 600) f.w.clear();
      this._m.font = f.css;
      w = this._m.measureText(s).width;
      f.w.set(s, w);
    }
    return w;
  }

  _fontFor(s, latin, cjk) {
    let isC = this._nameFont.get(s);
    if (isC === undefined) {
      if (this._nameFont.size > 400) this._nameFont.clear();
      isC = CJK_RE.test(s); this._nameFont.set(s, isC);
    }
    return isC ? cjk : latin;
  }

  // align: 'left' | 'center' | 'right'; mid: true = PIL 'm' vertical anchor, false = baseline
  _text(c, f, s, x, y, align, mid, color, a255) {
    if (a255 <= 0.5) return;
    if (c._f !== f) { c.font = f.css; c._f = f; }
    c.textAlign = align;
    c.fillStyle = color;
    c.globalAlpha = a255 >= 255 ? 1 : a255 / 255;
    c.fillText(s, x, mid ? y + f.mid : y);
  }

  _fill(c, color, a255) { c.fillStyle = color; c.globalAlpha = a255 >= 255 ? 1 : a255 / 255; }

  // PIL inclusive rectangle
  _rect(c, x0, y0, x1, y1) { c.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1); }

  _rrectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // PIL inclusive rounded rectangle
  _rrect(c, x0, y0, x1, y1, r) { this._rrectPath(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, r); c.fill(); }

  // PIL line of width w (odd: pixel centres, even: next pixel edge)
  _seg(c, x0, y0, x1, y1, w) {
    const o = w % 2 === 1 ? 0.5 : 1;
    c.lineWidth = w;
    c.beginPath(); c.moveTo(x0 + o, y0 + o); c.lineTo(x1 + o, y1 + o); c.stroke();
  }

  _snap(x) { return Math.floor(x * this.kd + 1e-6) / this.kd; } // PIL truncates line coordinates

  _now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; }

  // ---------------------------------------------------------------- per-frame tracking
  _update(s) {
    const t = s.t || 0, p = s.player || {};
    if (t < this._pt - 0.5) this._resetTrackers(); // match restarted
    const dt = t - this._pt;

    // movement speed (m/s) -> crosshair spread; player.speed overrides the derived value
    if (typeof p.speed === 'number') this._speed = p.speed;
    else if (dt > 0 && dt < 0.25 && Number.isFinite(this._px)) {
      const inst = Math.hypot(p.x - this._px, p.y - this._py) / dt;
      if (inst < 20) this._speed += (inst - this._speed) * (1 - Math.exp(-dt * 10));
    }
    if (dt > 0 && dt < 0.25) {
      // the video walks at ~1.5 m/s with the base 12 px gap; open up beyond that, more when sprinting
      const target = (p.sprint ? 14 : 0) + 10 * clamp((this._speed - 1.6) / 3.4, 0, 1);
      this._spread += (target - this._spread) * (1 - Math.exp(-dt * 12));
    }
    if (dt !== 0 || !Number.isFinite(this._pt)) { this._px = p.x; this._py = p.y; this._pt = t; }

    // shot bloom: player.lastShotT if provided, else detect ammo going down
    const reloading = typeof p.reloading === 'number' ? p.reloading : -1;
    if (typeof p.lastShotT === 'number') this._lastShotT = p.lastShotT;
    else if (this._prevAmmo >= 0 && p.ammo < this._prevAmmo && reloading < 0) this._lastShotT = t;
    this._prevAmmo = typeof p.ammo === 'number' ? p.ammo : -1;

    if (reloading >= 0) { if (this._reloadStart < 0 || t < this._reloadStart) this._reloadStart = t; }
    else this._reloadStart = -1;

    if (s.mode === 'dead') {
      if (!this._wasDead) this._deadTotal = 0;
      this._deadTotal = Math.max(this._deadTotal, s.respawnIn || 0);
      this._wasDead = true;
    } else this._wasDead = false;

    // minimap spotting: composite.py SPOT windows -> fade in 4 f after spotted, hold 25 f after the
    // last spotted frame (or the kill), then fade out over 20 f
    const list = s.enemies;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const alive = e.alive !== false;
        let tr = this._etrack.get(e.id);
        if (!tr) { tr = { s0: -1e9, s1: -1e9, alive }; this._etrack.set(e.id, tr); }
        if (alive) {
          if (!tr.alive) { tr.s0 = -1e9; tr.s1 = -1e9; } // respawned
          if (e.spotted) { if (t - tr.s1 > 45 * F) tr.s0 = t; tr.s1 = t; }
        } else if (tr.alive && t - tr.s1 <= 45 * F) {
          tr.s1 = t; // died while on the map: show the red X
        }
        tr.alive = alive;
      }
    }
  }

  // ---------------------------------------------------------------- draw
  draw(s) {
    const c = this.ctx;
    this._update(s);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.clearRect(0, 0, this.bw, this.bh);
    const mode = s.mode || 'playing';

    if (mode === 'playing' || mode === 'dead') {
      this._drawLayer(s);
      if (this.shadows) {
        c.shadowColor = 'rgba(0,0,0,0.45)';
        c.shadowBlur = 4 * this.kd; // canvas sigma = blur / 2 -> PIL GaussianBlur(2)
        c.shadowOffsetX = 2 * this.kd; c.shadowOffsetY = 2 * this.kd;
      }
      c.globalAlpha = mode === 'dead' ? 0.38 : 1;
      c.drawImage(this.layer, 0, 0);
      c.shadowColor = 'rgba(0,0,0,0)'; c.shadowBlur = 0; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
      c.globalAlpha = 1;
    }
    if (mode === 'dead') this._screenDead(s);
    else if (mode === 'menu') this._screenMenu(s);
    else if (mode === 'victory') this._screenVictory(s);
    else if (mode === 'paused') this._screenPaused(s);

    if (typeof s.fps === 'number') {
      c.setTransform(this.kd, 0, 0, this.kd, 0, 0);
      const n = clamp(Math.round(s.fps), 0, 999);
      this._text(c, FX.fps, FPS_STR[n] || (FPS_STR[n] = `${n} FPS`), 12, 20, 'left', true, COL.grey, 170);
      c.globalAlpha = 1;
    }
  }

  _drawLayer(s) {
    const L = this.lctx, kd = this.kd;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.globalAlpha = 1;
    L.clearRect(0, 0, this.bw, this.bh);
    L.setTransform(kd, 0, 0, kd, 0, 0);
    // same order as composite.py hud()
    this._damage(L, s);
    this._minimap(s);
    L.setTransform(1, 0, 0, 1, 0, 0); L.globalAlpha = 1;
    L.drawImage(this.mini, this._mox, this._moy);
    L.setTransform(kd, 0, 0, kd, 0, 0);
    this._compass(L, s);
    this._scoreboard(L, s);
    this._killfeed(L, s);
    this._weapon(L, s);
    this._health(L, s);
    this._nametags(L, s);
    this._crosshair(L, s);
    this._hitmarkers(L, s);
    this._killPopup(L, s);
    this._reloadText(L, s);
    this._xpBar(L, s);
    L.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- minimap
  _minimap(s) {
    const g = this.mctx, kd = this.kd, p = s.player;
    const { cx, cy, R, sc } = MM;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.mini.width, this.mini.height);
    g.setTransform(kd, 0, 0, kd, -this._mox, -this._moy);
    const th = p.yaw * DEG;
    const fx = Math.cos(th), fy = Math.sin(th), rx = Math.sin(th), ry = -Math.cos(th);
    const ox = cx + 0.5, oy = cy + 0.5;

    g.save();
    g.beginPath(); g.arc(ox, oy, R + 0.5, 0, TAU); g.clip();
    g.fillStyle = COL.disc; g.globalAlpha = 150 / 255;
    g.fillRect(cx - R - 1, cy - R - 1, 2 * R + 3, 2 * R + 3);
    g.globalAlpha = 1;
    // world -> minimap: u = d.right, v = -d.forward (forward is up); a reflection (det = -1)
    g.save();
    g.transform(rx * sc, -fx * sc, ry * sc, -fy * sc,
      ox - (p.x * rx + p.y * ry) * sc, oy + (p.x * fx + p.y * fy) * sc);
    const m = this._map;
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(m.X0, m.Y0, m.w, m.h);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.mapCache, m.X0, m.Y0, m.w, m.h);
    g.restore();

    // view cone (replaces what is under it, as PIL did)
    g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox - 70, oy - 120); g.lineTo(ox + 70, oy - 120); g.closePath();
    g.globalCompositeOperation = 'destination-out'; g.fill();
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = COL.pure; g.globalAlpha = 22 / 255; g.fill();

    // spotted enemies (drawn above the cone so enemies in front stay visible)
    const list = s.enemies, t = s.t;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const e = list[i], tr = this._etrack.get(e.id);
        if (!tr || t - tr.s1 > 45 * F || t < tr.s0) continue;
        const al = smooth((t - tr.s0) / (4 * F)) * (1 - smooth((t - tr.s1 - 25 * F) / (20 * F)));
        if (al <= 0.003) continue;
        const dx = e.x - p.x, dy = e.y - p.y;
        const a = cx + (dx * rx + dy * ry) * sc, b = cy - (dx * fx + dy * fy) * sc;
        if ((a - cx) ** 2 + (b - cy) ** 2 > (R - 8) ** 2) continue;
        if (e.alive !== false) {
          g.beginPath(); g.arc(a + 0.5, b + 0.5, 6.5, 0, TAU);
          this._fill(g, COL.dotFill, 235 * al); g.fill();
          g.strokeStyle = COL.dotLine; g.globalAlpha = (200 * al) / 255; g.lineWidth = 1;
          g.beginPath(); g.arc(a + 0.5, b + 0.5, 6, 0, TAU); g.stroke();
        } else {
          g.strokeStyle = COL.deadX; g.globalAlpha = (220 * al) / 255;
          this._seg(g, a - 6, b - 6, a + 6, b + 6, 3);
          this._seg(g, a - 6, b + 6, a + 6, b - 6, 3);
        }
      }
    }
    // player arrow
    g.globalAlpha = 1; g.fillStyle = COL.amber;
    g.beginPath(); g.moveTo(ox, oy - 11); g.lineTo(ox - 8, oy + 8); g.lineTo(ox, oy + 4); g.lineTo(ox + 8, oy + 8);
    g.closePath(); g.fill();
    g.restore();
    g._f = null;

    // ring (2 px, inside the disc edge, replacing)
    g.lineWidth = 2;
    g.beginPath(); g.arc(ox, oy, R - 0.5, 0, TAU);
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1; g.stroke();
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = COL.ring; g.globalAlpha = 120 / 255; g.stroke();
    // north marker: world +Y
    const bearing = (90 - p.yaw) * DEG;
    const nx = cx + Math.sin(-bearing) * (R - 2), ny = cy - Math.cos(-bearing) * (R - 2);
    g.beginPath(); g.arc(nx + 0.5, ny + 0.5, 11.5, 0, TAU);
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1; g.fill();
    g.globalCompositeOperation = 'source-over';
    this._fill(g, COL.nDisc, 220); g.fill();
    this._text(g, FN.xs, 'N', nx, ny, 'center', true, COL.white, 255);
  }

  // ---------------------------------------------------------------- compass
  _compass(c, s) {
    const cx = this.VW / 2, y = 44, half = 330, ppd = 6;
    const heading = (((90 - s.player.yaw) % 360) + 360) % 360;
    this._fill(c, COL.pure, 60);
    c.fillRect(cx - half, y - 2, 2 * half + 1, 2);
    for (let deg = 0; deg < 360; deg += 5) {
      const diff = ((deg - heading + 540) % 360) - 180;
      const ad = Math.abs(diff) * ppd;
      if (ad > half) continue;
      const x = cx + diff * ppd, xs = this._snap(x);
      const al = 255 * (1 - (ad / half) ** 3);
      if (deg % 45 === 0) {
        this._text(c, FN.m, COMPASS_LABELS[deg / 45], x, y + 16, 'center', true, COL.white, al);
        this._fill(c, COL.pure, al); c.fillRect(xs, y, 2, 5);
      } else if (deg % 15 === 0) {
        this._text(c, FN.xs, num(deg), x, y + 14, 'center', true, COL.grey, al * 0.8);
        this._fill(c, COL.pure, al * 0.7); c.fillRect(xs, y, 1, 4);
      } else {
        this._fill(c, COL.pure, al * 0.45); c.fillRect(xs, y, 1, 7);
      }
    }
    this._fill(c, COL.amber, 230);
    c.beginPath(); c.moveTo(cx - 7 + 0.5, y - 10 + 0.5); c.lineTo(cx + 7 + 0.5, y - 10 + 0.5); c.lineTo(cx + 0.5, y - 2 + 0.5);
    c.closePath(); c.fill();
    this._text(c, FN.s, HEAD3[Math.round(heading) % 360], cx, y + 40, 'center', true, COL.white, 210);
  }

  // ---------------------------------------------------------------- scoreboard (team deathmatch)
  _scoreboard(c, s) {
    const sc = s.score || {};
    const x1 = this.VW - 40, y = 40;
    const us = sc.us | 0, them = sc.them | 0, limit = sc.limit || 75;
    const secs = Math.max(0, Math.ceil(sc.timeLeft || 0));
    this._fill(c, COL.panel, 140); this._rrect(c, x1 - 300, y, x1, y + 58, 6);
    this._fill(c, COL.blueBar, 230); this._rect(c, x1 - 300, y, x1 - 296, y + 58);
    this._text(c, FN.l, num(us), x1 - 282, y + 29, 'left', true, COL.blue, 255);
    this._text(c, FC.xs, '团队死斗', x1 - 150, y + 18, 'center', true, COL.white, 220);
    this._text(c, FN.s, timer(secs), x1 - 150, y + 41, 'center', true, COL.white, 230);
    this._text(c, FN.l, num(them), x1 - 18, y + 29, 'right', true, COL.red, 255);
    this._fill(c, COL.blue, 200); this._rect(c, x1 - 300, y + 62, x1 - 300 + Math.trunc(300 * clamp(us / limit, 0, 1)), y + 66);
    this._fill(c, COL.red, 200); this._rect(c, x1 - 300, y + 70, x1 - 300 + Math.trunc(300 * clamp(them / limit, 0, 1)), y + 74);
  }

  // ---------------------------------------------------------------- killfeed
  _killfeed(c, s) {
    const kf = s.killfeed;
    if (!kf || !kf.length) return;
    const x1 = this.VW - 40, y = 130, t = s.t, me = (s.player && s.player.name) || '大师';
    let row = 0;
    for (let i = kf.length - 1; i >= 0 && row < 5; i--) {
      const e = kf[i], age = t - e.t;
      if (age < 0 || age >= 150 * F) continue;
      const al = smooth(age / (5 * F)) * (1 - smooth((age - 130 * F) / (20 * F)));
      const yy = y + row * 38; row++;
      const killer = e.killer || '', victim = e.victim || '';
      const fK = this._fontFor(killer, FN.s, FC.s), fV = this._fontFor(victim, FN.s, FC.s);
      const wK = this._tw(fK, killer), wV = this._tw(fV, victim);
      const hs = e.headshot ? 24 : 0;
      const x0 = x1 - (wK + wV + 90 + hs);
      this._fill(c, COL.feed, 150 * al); this._rrect(c, x0 - 12, yy, x1, yy + 32, 4);
      this._text(c, fK, killer, x0, yy + 16, 'left', true, killer === me ? COL.blue : COL.red, 255 * al);
      const gx = x0 + wK + 14;
      this._fill(c, COL.white, 230 * al); // small rifle glyph
      this._rect(c, gx, yy + 13, gx + 44, yy + 18);
      this._rect(c, gx + 14, yy + 18, gx + 19, yy + 26);
      this._rect(c, gx + 26, yy + 18, gx + 30, yy + 24);
      this._rect(c, gx - 6, yy + 12, gx, yy + 20);
      if (hs) { // headshot marker (not in composite.py, which had no headshot data)
        const hx = gx + 60.5, hy = yy + 16.5;
        c.strokeStyle = COL.amber; c.globalAlpha = (240 * al) / 255; c.lineWidth = 2;
        c.beginPath(); c.arc(hx, hy, 6.5, 0, TAU); c.stroke();
        this._fill(c, COL.amber, 240 * al); c.beginPath(); c.arc(hx, hy, 2.5, 0, TAU); c.fill();
      }
      this._text(c, fV, victim, x1 - 8, yy + 16, 'right', true, victim === me ? COL.blue : COL.red, 255 * al);
    }
  }

  // ---------------------------------------------------------------- weapon panel
  _weapon(c, s) {
    const p = s.player, x1 = this.VW - 50, y1 = DH - 50;
    const ammo = Math.max(0, p.ammo | 0), mag = p.mag || 30, reserve = Math.max(0, p.reserve | 0);
    const aS = num(ammo);
    this._text(c, FN.xxl, aS, x1, y1 - 30, 'right', false, ammo <= 8 ? COL.ammoLow : COL.white, 255);
    const wAm = this._tw(FN.xxl, aS);
    this._text(c, FN.m, reserveStr(reserve), x1 - wAm - 12, y1 - 36, 'right', false, COL.white, 200);
    this._text(c, FC.s, p.weapon || 'AR-15 卡宾枪', x1, y1 - 2, 'right', false, COL.white, 230);
    this._text(c, FC.xs, p.fireMode || '全自动', x1 - 260, y1 - 2, 'left', false, COL.grey, 210);
    for (let i = 0; i < mag; i++) {
      const x = x1 - 4 - i * 7;
      if (i < ammo) this._fill(c, COL.white, 230); else this._fill(c, COL.pure, 50);
      this._rect(c, x - 4, y1 - 128, x, y1 - 112);
    }
    const nades = typeof p.grenades === 'number' ? p.grenades : 2;
    c.strokeStyle = COL.white; c.lineWidth = 3;
    for (let i = 0; i < nades; i++) {
      const gx = x1 - 340 - i * 36;
      c.globalAlpha = 220 / 255;
      c.beginPath(); c.arc(gx + 0.5, y1 - 29 + 0.5, 10, 0, TAU); c.stroke();
      this._fill(c, COL.white, 220); this._rect(c, gx - 4, y1 - 46, gx + 4, y1 - 40);
    }
  }

  // ---------------------------------------------------------------- health
  _health(c, s) {
    const p = s.player, x0 = 50, y1 = DH - 50;
    const name = p.name || '大师', level = p.level == null ? 55 : p.level | 0;
    this._text(c, FC.m, name, x0, y1 - 44, 'left', false, COL.white, 240);
    const lv = lvStr(level);
    const bx = x0 + Math.max(80, this._tw(FC.m, name) + 28);
    const bw = Math.max(48, Math.ceil(this._tw(FN.xs, lv)) + 8); // 'LV 55' (39.6 px) -> composite.py's 48
    this._fill(c, COL.amber, 230); this._rrect(c, bx, y1 - 62, bx + bw, y1 - 40, 4);
    this._text(c, FN.xs, lv, bx + bw / 2, y1 - 51, 'center', true, COL.lvText, 255);
    const hp = clamp(Math.round(p.health == null ? 100 : p.health), 0, 100);
    const low = hp <= 30; // low-health tint (the video never dropped below 100)
    this._fill(c, COL.pure, 45); this._rect(c, x0, y1 - 26, x0 + 300, y1 - 16);
    if (hp > 0) { this._fill(c, low ? COL.red : COL.white, 230); this._rect(c, x0, y1 - 26, x0 + Math.trunc((300 * hp) / 100), y1 - 16); }
    this._text(c, FN.s, num(hp), x0 + 312, y1 - 13, 'left', false, low ? COL.red : COL.white, 230);
  }

  // ---------------------------------------------------------------- enemy name tags
  _nametags(c, s) {
    const list = s.enemies;
    if (!list) return;
    const k = this.k, ccx = this.VW / 2, ccy = DH / 2;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.alive === false || !e.head || !e.chest) continue;
      const off = Math.hypot(e.chest.x / k - ccx, e.chest.y / k - ccy);
      if (off > 140) continue;
      const al = 1 - smooth((off - 60) / 80);
      const sx = e.head.x / k, y = e.head.y / k - 18;
      const name = e.name || '';
      const f = this._fontFor(name, FN.s, FC.s);
      const hw = this._tw(f, name) / 2;
      this._fill(c, COL.hit, 240 * al);
      c.beginPath();
      c.moveTo(sx - hw - 16 + 0.5, y + 0.5); c.lineTo(sx - hw - 10 + 0.5, y - 6 + 0.5);
      c.lineTo(sx - hw - 4 + 0.5, y + 0.5); c.lineTo(sx - hw - 10 + 0.5, y + 6 + 0.5);
      c.closePath(); c.fill();
      this._text(c, f, name, sx + 4, y, 'center', true, COL.tag, 250 * al);
    }
  }

  // ---------------------------------------------------------------- crosshair
  _crosshair(c, s) {
    const p = s.player;
    let al = Math.max(0, 1 - (p.ads || 0) * 2.2);
    if (typeof p.reloading === 'number' && p.reloading >= 0) al *= 0.5;
    if (al <= 0.01) return;
    const dt = s.t - this._lastShotT;
    const bloom = dt >= 0 && dt < 10 * F ? 14 * Math.exp(-dt / (3 * F)) : 0;
    const cx = this.VW / 2, cy = DH / 2, g = 12 + bloom + this._spread, L = 14;
    // shadow (width 3, offset 1) then the 2 px arm, as filled rects matching PIL's coverage
    this._fill(c, COL.black, 110 * al);
    c.fillRect(cx + g + 1, cy, L + 1, 3); c.fillRect(cx - g - L + 1, cy, L + 1, 3);
    c.fillRect(cx, cy + g + 1, 3, L + 1); c.fillRect(cx, cy - g - L + 1, 3, L + 1);
    this._fill(c, COL.white, 230 * al);
    c.fillRect(cx + g, cy, L + 1, 2); c.fillRect(cx - g - L, cy, L + 1, 2);
    c.fillRect(cx, cy + g, 2, L + 1); c.fillRect(cx, cy - g - L, 2, L + 1);
    c.beginPath(); c.arc(cx + 0.5, cy + 0.5, 2.5, 0, TAU); c.fill();
  }

  // ---------------------------------------------------------------- hit markers
  _hitmarkers(c, s) {
    const hits = s.hits;
    if (!hits || !hits.length) return;
    const cx = this.VW / 2, cy = DH / 2, g = 8, t = s.t;
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i], age = t - h.t;
      if (age < 0 || age >= 9 * F) continue;
      const al = 1 - smooth(age / (9 * F));
      const sz = (h.kill ? 20 : 14) + (age / F) * 1.2;
      for (let q = 0; q < 4; q++) {
        const sx = q & 1 ? -1 : 1, sy = q & 2 ? -1 : 1;
        c.strokeStyle = COL.black; c.globalAlpha = (120 * al) / 255;
        this._seg(c, cx + sx * g, cy + sy * g, cx + sx * (g + sz), cy + sy * (g + sz), 5);
        c.strokeStyle = h.kill ? COL.hit : COL.white; c.globalAlpha = al;
        this._seg(c, cx + sx * g, cy + sy * g, cx + sx * (g + sz), cy + sy * (g + sz), 3);
      }
    }
  }

  // ---------------------------------------------------------------- kill popup + medals
  _killPopup(c, s) {
    const kills = s.kills;
    if (!kills || !kills.length) return;
    const t = s.t;
    let k = null; // newest active popup only (composite.py's kills never overlapped)
    for (let i = kills.length - 1; i >= 0; i--) {
      const age = t - kills[i].t;
      if (age >= 0 && age < 60 * F) { k = kills[i]; break; }
    }
    if (!k) return;
    const age = t - k.t, af = age / F;
    const n = Math.max(1, k.streak | 0);
    const cx = this.VW / 2, cy = Math.trunc(DH * 0.755);
    const al = smooth(af / 4) * (1 - smooth((af - 45) / 15));
    const pop = 1 + 0.35 * Math.exp(-af / 3);
    const [pts, line2, xn] = popStr(n);
    const kd = this.kd;
    c.setTransform(kd * pop, 0, 0, kd * pop, cx * kd, cy * kd);
    this._text(c, FX.pop, pts, 0, 0, 'center', true, COL.amber, 255 * al);
    c.setTransform(kd, 0, 0, kd, 0, 0);
    this._text(c, FC.s, line2, cx, cy + 46, 'center', true, COL.white, 235 * al);
    if (n >= 2) {
      const r = 34 * pop, hx = cx - 150, hy = cy + 16;
      c.beginPath();
      for (let j = 0; j < 6; j++) {
        const a = (60 * j + 30) * DEG, x = hx + r * Math.cos(a) + 0.5, y = hy + r * Math.sin(a) + 0.5;
        if (j) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.closePath();
      this._fill(c, COL.medal, 220 * al); c.fill();
      c.strokeStyle = COL.amber; c.globalAlpha = al; c.lineWidth = 1; c.stroke();
      this._text(c, FN.l, xn, hx, hy, 'center', true, COL.medalText, 255 * al);
    }
  }

  // ---------------------------------------------------------------- damage direction + vignette
  _damage(c, s) {
    const dm = s.damage;
    if (!dm || !dm.length) return;
    const p = s.player, t = s.t, cx = this.VW / 2, cy = DH / 2;
    let vig = 0, nArcs = 0;
    const drawn = this._arcDirs || (this._arcDirs = new Float64Array(8));
    c.strokeStyle = COL.arc; c.lineWidth = 10;
    // newest first; like composite.py (one arc for the latest shot) an older hit from about the
    // same direction is skipped instead of stacking a second, more opaque arc on top
    for (let i = dm.length - 1; i >= 0; i--) {
      const d = dm[i], age = t - d.t;
      if (age < 0 || age >= 30 * F) continue;
      const al = 1 - smooth(age / (30 * F));
      if (al > vig) vig = al;
      const rel = wrap180(Math.atan2(d.srcY - p.y, d.srcX - p.x) / DEG - p.yaw); // + = left
      let dup = false;
      for (let j = 0; j < nArcs; j++) if (Math.abs(wrap180(rel - drawn[j])) < 30) { dup = true; break; }
      if (dup) continue;
      if (nArcs < drawn.length) drawn[nArcs++] = rel;
      const centre = (-90 - rel) * DEG; // canvas angles: clockwise from +x, screen up = -90
      c.globalAlpha = (200 * al) / 255;
      c.beginPath(); c.arc(cx + 0.5, cy + 0.5, 185.5, centre - 22 * DEG, centre + 22 * DEG); c.stroke();
    }
    if (vig > 0) { c.globalAlpha = vig; c.drawImage(this.vig, 0, 0, this.VW, DH); }
  }

  // ---------------------------------------------------------------- reload
  _reloadText(c, s) {
    const p = s.player;
    const prog = typeof p.reloading === 'number' ? p.reloading : -1;
    if (prog < 0 || this._reloadStart < 0) return;
    // composite.py faded the text with the reload pose (in over ~10 f, out over ~10 f)
    const env = Math.min(1, (s.t - this._reloadStart) / (10 * F)) * (prog > 0.9 ? Math.max(0, (1 - prog) / 0.1) : 1);
    if (env <= 0.1) return;
    const al = Math.min(1, env * 2), cx = this.VW / 2, cy = DH / 2;
    this._text(c, FC.m, '装填中', cx, cy + 70, 'center', true, COL.white, 230 * al);
    this._fill(c, COL.pure, 45 * al); c.fillRect(cx - 50, cy + 92, 100, 3);
    this._fill(c, COL.white, 210 * al); c.fillRect(cx - 50, cy + 92, 100 * clamp(prog, 0, 1), 3);
  }

  // ---------------------------------------------------------------- xp bar
  _xpBar(c, s) {
    const xp = clamp(s.player.xp == null ? 0 : s.player.xp, 0, 1);
    this._fill(c, COL.black, 90); c.fillRect(0, DH - 6, this.VW, 7);
    if (xp > 0) { this._fill(c, COL.amber, 200); c.fillRect(0, DH - 6, Math.trunc(this.VW * xp) + 1, 7); }
  }

  // ================================================================ screens
  // Same visual language: dark translucent panels (rgb 12,14,16), a coloured accent bar, white
  // text, amber highlights, DIN numerals and Hiragino Chinese. Laid out around the centre in
  // design units; shrunk uniformly when the window is narrower than 760 units.
  _screenBegin(alpha) {
    const c = this.ctx, ks = this.kd * this._sS;
    const SW = this.bw / ks, SH = this.bh / ks, top = (SH - DH) / 2;
    c.setTransform(ks, 0, 0, ks, 0, top * ks);
    if (alpha > 0) {
      c.globalAlpha = alpha; c.fillStyle = 'rgb(6,8,10)';
      c.fillRect(0, -top, SW, SH);
      // soft darkening towards the edges
      const gr = c.createRadialGradient(SW / 2, DH / 2, DH * 0.25, SW / 2, DH / 2, Math.max(SW, SH) * 0.75);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
      c.globalAlpha = 1; c.fillStyle = gr; c.fillRect(0, -top, SW, SH);
    }
    return { c, cx: SW / 2, SW, SH, top };
  }

  _spaced(c, f, str, x, y, spacing, align, color, a255) {
    // letter-spaced Latin caption
    let w = 0;
    for (let i = 0; i < str.length; i++) w += this._tw(f, str[i]) + (i ? spacing : 0);
    let xx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    for (let i = 0; i < str.length; i++) {
      this._text(c, f, str[i], xx, y, 'left', true, color, a255);
      xx += this._tw(f, str[i]) + spacing;
    }
  }

  _prompt(c, str, cx, y) {
    const pulse = 0.5 + 0.5 * Math.sin(this._now() * TAU * 0.8);
    const w = this._tw(FX.prompt, str) + 150, h = 74;
    this._fill(c, COL.panel, 150); this._rrectPath(c, cx - w / 2, y - h / 2, w, h, 6); c.fill();
    c.strokeStyle = COL.amber; c.globalAlpha = 0.35 + 0.45 * pulse; c.lineWidth = 1.5; c.stroke();
    this._text(c, FX.prompt, str, cx, y, 'center', true, COL.white, 255 * (0.7 + 0.3 * pulse));
    // chevrons
    const dx = w / 2 - 34 + 4 * pulse;
    this._fill(c, COL.amber, 235);
    for (const sgn of [-1, 1]) {
      const x = cx + sgn * dx;
      c.beginPath(); c.moveTo(x - sgn * 8, y - 9); c.lineTo(x + sgn * 4, y); c.lineTo(x - sgn * 8, y + 9); c.closePath(); c.fill();
    }
  }

  _panel(c, x, y, w, h, accent) {
    this._fill(c, COL.panel, 165); this._rrectPath(c, x, y, w, h, 6); c.fill();
    if (accent) { this._fill(c, accent, 230); c.fillRect(x, y, 5, h); }
  }

  _controls(c, cx, y) {
    const pw = 640, ph = 262, x0 = cx - pw / 2;
    this._panel(c, x0, y, pw, ph, COL.amber);
    this._text(c, FX.cn20, '操作说明', x0 + 32, y + 34, 'left', true, COL.white, 230);
    this._spaced(c, FX.tagS, 'CONTROLS', x0 + pw - 28, y + 34, 4, 'right', COL.grey, 140);
    this._fill(c, COL.pure, 30); c.fillRect(x0 + 28, y + 54, pw - 56, 1);
    for (let i = 0; i < CONTROLS.length; i++) {
      const [key, act] = CONTROLS[i];
      const col = i < 4 ? 0 : 1, row = i % 4;
      const kx = x0 + 32 + col * (pw / 2 - 8), ky = y + 72 + row * 46, kh = 32;
      const f = this._fontFor(key, FX.kc, FX.kcCn);
      const kw = Math.max(48, this._tw(f, key) + 24);
      this._fill(c, COL.pure, 18); this._rrectPath(c, kx, ky, kw, kh, 5); c.fill();
      c.strokeStyle = COL.white; c.globalAlpha = 0.55; c.lineWidth = 1.5; c.stroke();
      this._text(c, f, key, kx + kw / 2, ky + kh / 2, 'center', true, COL.white, 245);
      this._text(c, FX.cn22, act, kx + kw + 18, ky + kh / 2, 'left', true, COL.white, 225);
    }
  }

  _screenMenu(s) {
    const { c, cx } = this._screenBegin(0.62);
    this._spaced(c, FX.tag, 'MALL STRIKE', cx, 250, 10, 'center', COL.amber, 255);
    this._text(c, FX.title, '商场突袭', cx, 390, 'center', false, COL.white, 255);
    this._fill(c, COL.amber, 230); c.fillRect(cx - 40, 418, 80, 4);
    this._prompt(c, '点击开始', cx, 520);
    this._text(c, FX.cn18, '鼠标将被锁定，按 Esc 暂停', cx, 584, 'center', true, COL.grey, 170);
    this._controls(c, cx, 640);
    const limit = (s.score && s.score.limit) || 75;
    this._text(c, FX.cn20, `团队死斗 · 先到 ${limit} 分获胜`, cx, 1000, 'center', true, COL.grey, 190);
    c.globalAlpha = 1;
  }

  _screenPaused(s) {
    const { c, cx } = this._screenBegin(0.6);
    this._spaced(c, FX.tag, 'PAUSED', cx, 270, 10, 'center', COL.amber, 255);
    this._text(c, FX.head, '已暂停', cx, 400, 'center', false, COL.white, 255);
    this._fill(c, COL.amber, 230); c.fillRect(cx - 40, 426, 80, 4);
    this._prompt(c, '点击继续', cx, 520);
    this._controls(c, cx, 620);
    c.globalAlpha = 1;
  }

  _screenDead(s) {
    const { c, cx, SW, SH, top } = this._screenBegin(0);
    // red-dark wash + the damage vignette at full strength + a dark band behind the text block
    c.globalAlpha = 0.42; c.fillStyle = 'rgb(26,4,4)'; c.fillRect(0, -top, SW, SH);
    c.globalAlpha = 1; c.drawImage(this.vig, 0, -top, SW, SH);
    const band = c.createLinearGradient(0, 270, 0, 800);
    band.addColorStop(0, 'rgba(6,8,10,0)'); band.addColorStop(0.22, 'rgba(6,8,10,0.6)');
    band.addColorStop(0.78, 'rgba(6,8,10,0.6)'); band.addColorStop(1, 'rgba(6,8,10,0)');
    c.fillStyle = band; c.fillRect(0, 270, SW, 530);
    const me = (s.player && s.player.name) || '大师';
    let killer = null;
    const kf = s.killfeed;
    if (kf) for (let i = kf.length - 1; i >= 0; i--) if (kf[i].victim === me) { killer = kf[i]; break; }

    this._spaced(c, FX.tag, 'KILLED IN ACTION', cx, 340, 8, 'center', COL.red, 255);
    this._text(c, FX.head, '你已阵亡', cx, 460, 'center', false, COL.white, 255);
    if (killer) {
      const name = killer.killer || '';
      const fK = this._fontFor(name, FX.killer, FX.killerCn);
      const lw = this._tw(FX.cn22, '击杀者'), nw = this._tw(fK, name), hsw = killer.headshot ? 70 : 0;
      const w = lw + nw + hsw + 120, x0 = cx - w / 2, y0 = 500;
      this._panel(c, x0, y0, w, 56, COL.red);
      this._text(c, FX.cn22, '击杀者', x0 + 34, y0 + 28, 'left', true, COL.grey, 220);
      // rifle glyph like the killfeed
      const gx = x0 + 34 + lw + 18;
      this._fill(c, COL.white, 200);
      c.fillRect(gx, y0 + 25, 30, 4); c.fillRect(gx + 9, y0 + 29, 4, 6); c.fillRect(gx - 4, y0 + 24, 4, 6);
      this._text(c, fK, name, x0 + 34 + lw + 62, y0 + 28, 'left', true, COL.red, 255);
      if (hsw) {
        const hx = x0 + 34 + lw + 62 + nw + 16;
        this._fill(c, COL.amber, 230); this._rrectPath(c, hx, y0 + 15, 54, 26, 4); c.fill();
        this._text(c, FX.cn18, '爆头', hx + 27, y0 + 28, 'center', true, COL.lvText, 255);
      }
    }
    const r = Math.max(0, s.respawnIn || 0);
    this._text(c, FX.cn22, '重生倒计时', cx, 622, 'center', true, COL.grey, 220);
    if (r > 0) this._text(c, FX.big, num(Math.ceil(r)), cx, 726, 'center', false, COL.amber, 255);
    else this._text(c, FX.cn24, '即将重生', cx, 700, 'center', true, COL.amber, 255);
    const total = Math.max(this._deadTotal, r, 0.001);
    this._fill(c, COL.pure, 40); c.fillRect(cx - 180, 752, 360, 4);
    this._fill(c, COL.amber, 230); c.fillRect(cx - 180, 752, 360 * clamp(1 - r / total, 0, 1), 4);
    c.globalAlpha = 1;
  }

  _screenVictory(s) {
    const { c, cx } = this._screenBegin(0.64);
    const sc = s.score || {}, us = sc.us | 0, them = sc.them | 0, limit = sc.limit || 75;
    const res = us > them ? ['VICTORY', '胜利', COL.amber] : us < them ? ['DEFEAT', '失败', COL.red] : ['DRAW', '平局', COL.white];
    this._spaced(c, FX.tag, res[0], cx, 240, 12, 'center', res[2], 255);
    this._text(c, FX.result, res[1], cx, 390, 'center', false, res[2], 255);
    // final score, scoreboard style
    const w = 560, x0 = cx - w / 2, y0 = 440, h = 140;
    this._panel(c, x0, y0, w, h, COL.blueBar);
    this._text(c, FX.cn22, '我方', cx - 150, y0 + 34, 'center', true, COL.blue, 230);
    this._text(c, FX.score, num(us), cx - 150, y0 + 92, 'center', true, COL.blue, 255);
    this._text(c, FX.cn22, '敌方', cx + 150, y0 + 34, 'center', true, COL.red, 230);
    this._text(c, FX.score, num(them), cx + 150, y0 + 92, 'center', true, COL.red, 255);
    this._text(c, FX.cn18, '团队死斗', cx, y0 + 34, 'center', true, COL.white, 200);
    this._text(c, FX.vs, 'VS', cx, y0 + 92, 'center', true, COL.grey, 200);
    this._fill(c, COL.blue, 200); c.fillRect(x0, y0 + h + 6, w * clamp(us / limit, 0, 1), 5);
    this._fill(c, COL.red, 200); c.fillRect(x0, y0 + h + 15, w * clamp(them / limit, 0, 1), 5);
    this._text(c, FX.cn20, `目标 ${limit} 分`, cx, y0 + h + 52, 'center', true, COL.grey, 190);
    this._prompt(c, '点击再来一局', cx, 760);
    c.globalAlpha = 1;
  }
}

export default HUD;
