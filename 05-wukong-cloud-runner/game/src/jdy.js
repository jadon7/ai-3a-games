// 筋斗云 + 水汽尾流。createJDY(app) → { group, update(dt, state), uniforms, params }，group 加到 app.sceneFx。
//   state = { position（云顶面上悟空站的那一点，世界坐标）, quaternion（本地 -Z 为前、+Y 为上）, velocity, speed, boost（0..1）,
//             sink（脚底在云顶面以下多深，米；主程序把角色整体下沉了这么多。默认 0 = 脚底就在 position）,
//             flip（可选，翻筋斗进度 0..1，0 = 不在翻；传了的话起跳 / 落回时云头会下沉回弹，腾空时腿边的云不再裹着） }
//
// 脚下的云：一个跟着悟空走的包围盒，片元里做光线步进。形状 = 扁椭球云头 + 向后拖出的锥形尾流，
//   用共享的 3D 噪声做翻卷和侵蚀；噪声在本地空间向后流动（尾部更快、沿气流方向拉长），速度越快拖得越长。
//   每个采样点朝太阳走 3 小步算自阴影；逆光时薄的地方透亮（银边）。用场景深度截断步进，所以脚会“踩进”云里。
// 尾流：留在世界空间的一串“圆柱小段”（按飞过的距离出生，每段的轴向 = 当时的飞行方向，半长 = 段间距）。
//   每段沿轴向用 Hann 窗加权，相邻两段的窗正好加起来等于 1，所以无论速度多快、段距多大，拼起来都是一条
//   粗细连续的水汽，不会出现一节一节的竹节纹。片元里解析求视线与圆柱的相交区间，取两点采世界空间噪声算光学厚度
//   （各种淡出都乘在光学厚度里，不乘在不透明度上，重叠的两段才能精确相加）。
//   形态：离开云头时是细细一缕（半径 trailR0），按时间慢慢散开；贴着云头处浓，前 1/5 寿命里就被噪声啃碎成一缕一缕、
//   能透出背景，之后慢慢散尽；粗细沿尾流平滑起伏。飞得越快水汽摊得越稀、寿命越短（最长拖 trailReach 米）。
//   顺着尾流方向看（追尾视角）时，离相机 13 m 以内的部分会减淡，免得把脚下糊成一片白。
//   加速（boost）时出生的小段更粗、更浓、活得更久（“氮气拖尾”，165 m/s 时拖 800 多米），开始加速的瞬间鼓一个包；
//   贴着云海飞时云头两侧再各出一串同样的小段当飞沫（云顶高度问 atmosphere.js 的 seaQuery）。
//   占屏很大时（粗拖尾贴近镜头、长焦顺着看）自动改画到缩小的缓冲再按深度贴回来，开销大致封顶。
// 人陷在云里：state.sink > 0 时腿周围的云面踩低一圈、贴着腿裹上去、云絮顺着腿往上舔，人在云上有投影和接触阴影。
// 两者都按距离向雾色靠（和大气模块同一套雾函数），钻进云海时按高度图估算遮挡向云色靠。
import * as THREE from 'three';
import { SUN_DIR, SUN_COLOR, SUN_INTENSITY, SCENE_DEPTH_GLSL, QUALITY_NAME, num } from './common.js';
import { getNoise3D, fogUniforms, FOG_GLSL, seaUniforms, SEA_VEIL_GLSL, seaQuery } from './atmosphere.js';

export const JDY = {
  // 云体光线步进的包围盒（本地坐标）。云的密度在离盒壁 0.25 m 以内被平滑压到 0、尾巴在后壁前一定收完，
  // 所以无论拉伸 / 鼓包到多大，都只会在盒壁附近柔和地淡掉，不会被裁出直边或平面
  boxMin: new THREE.Vector3(-1.95, -1.85, -2.40), boxMax: new THREE.Vector3(1.95, 0.95, 6.60),
  sigma: 7.5,                 // 云体消光（1/米）
  riderHeight: 1.45, riderRadius: 0.24,   // 人的大致身高 / 半径（米）：只用来在云上算接触阴影和投影
  trailMax: 640,              // 小段总上限（主尾流最多用 380，其余留给两侧的飞沫）
  trailSpacing: 0.70,         // 每飞这么远放一段（米）；约 225 m/s 以上才会自动加大（段数不超过上限），加大也不会出竹节
  trailLife: 2.6,             // 寿命上限（秒）
  trailReach: 170,            // 尾流最长拖多远（米）：飞得快时寿命 = trailReach / 速度（不低于 trailLifeMin），
  trailLifeMin: 1.0,          //   同样多的水汽被摊到更长的一段上 → 越快越稀、撕碎得越早
  // 加速（boost → 1）时的“氮气拖尾”：寿命、粗细、浓度都按出生那一刻的 boost 从巡航值过渡到下面这些
  boostLife: 5.2,             // 寿命（秒）：110 m/s 时约 570 m 长
  boostThick: 2.3,            // 粗细倍数（半径 0.65 → 3.7 m）
  boostStrength: 1.25,        // 浓度（巡航时是 0.6~1.15，越快越稀；加速时不再变稀）
  burst: 0.9,                 // 加速瞬间出生的那一小段再额外膨胀这么多（“爆开”一下）
  // 贴着云海飞（离云顶 sprayAlt 米以内）时甩起的水花：每飞过一段随机的距离（平均 sprayGap 米，飞得快时更稀），
  // 在随机的一侧抛出一簇 2~5 个大小不一的小云团，向外向上抛出去再落回来，不到一秒散尽
  sprayAlt: 12, spraySide: 1.9, sprayLife: 0.85, sprayGap: 7,
  trailBudgetPx: 650000,      // 尾流每帧大约能画这么多像素（约 1.4 ms）；估算超出时自动改画到低分辨率缓冲再贴回来
  trailR0: 0.28, trailR1: 1.60, // 刚离开云头 / 散开后的半径（米）：按 sqrt(出生后的秒数 / trailLife) 长粗，实际粗细还会沿尾流起伏（0.6~1.5 倍）
  trailSigma: 2.8,            // 尾流消光（1/米）
  emitBack: 1.15, emitDown: 0.55,   // 尾流出生点：脚底后方 / 下方（米），在云头后半截里面，衔接处看不到头
};

const COMMON = /* glsl */`
precision highp sampler3D;
uniform sampler3D tNoise; uniform vec3 uSunLight, uAmb, uSunW;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

const BODY_VERT = /* glsl */`
varying vec3 vLocal;
void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const BODY_FRAG = COMMON + SCENE_DEPTH_GLSL + FOG_GLSL + SEA_VEIL_GLSL + /* glsl */`
uniform vec3 uCamLocal, uSunLocal, uBoxMin, uBoxMax; uniform mat4 uModel;
uniform vec4 uAnim;            // x: 拉伸(0..1.4), y: 噪声向后流过的距离(米), z: 翻滚时间, w: 加速
uniform vec4 uRide;            // x: 云体的上下偏移(米), y: “人陷在云里”的强度(0..1), z: 人头顶的高度, w: 人脚底的高度（都是本地坐标）
varying vec3 vLocal;
const float RIDER_R = ${JDY.riderRadius.toFixed(2)};
// 以下形状函数里的 p 都是“云体坐标”= 本地坐标减去上下偏移（云顶面、即密度一半处，在云体坐标 y ≈ 0.13）
float field(vec3 p, out float tail) {
  vec3 q = (p - vec3(0.0, -0.56, 0.05)) / vec3(1.08, 0.62, 1.48);        // 云头：扁椭球（约 2.2 × 1.2 × 3 m）
  float fb = 1.0 - length(q);
  float zt = p.z - 0.7, zp = max(zt, 0.0);
  float L = 0.9 + 2.6 * uAnim.x;                                           // 尾部长度随速度
  vec2 wob = vec2(sin(p.z * 1.9 - uAnim.y * 2.3) + 0.6 * sin(p.z * 3.7 - uAnim.y * 4.1 + 1.3), sin(p.z * 2.6 - uAnim.y * 3.0 + 2.0)) * (0.10 * zp / (1.0 + zp));   // 越往后摆得越开
  vec2 cq = vec2(p.x + wob.x, p.y + 0.55 - 0.05 * zp + 0.6 * wob.y) / vec2(0.82, 0.42) * (1.0 + 0.9 * zp / L);
  float ft = (1.0 - length(cq)) - 0.9 * zp / L - 2.0 * (1.0 - smoothstep(-0.6, 0.4, zt));
  ft -= 3.0 * smoothstep(uBoxMax.z - 2.0, uBoxMax.z - 0.35, p.z);            // 拉得再长，尾巴也在碰到包围盒后壁之前收完
  tail = smoothstep(0.6, 2.2, p.z);
  // 腿周围鼓起一小团（身后一侧被气流拉长）：顶面的修剪在 densF 里跟着抬高，云就顺着小腿裹上去
  vec2 rr = vec2(p.x, p.z - 0.04); float bk = max(rr.y, 0.0);
  float fs = 1.0 - length(vec3(rr.x / 0.50, (p.y - 0.02) / 0.40, (rr.y - 0.3 * bk) / (0.44 + 0.5 * bk)));
  // 注意不能写成 fs * uRide.y：强度为 0 时那一项变成 0，会把整个形状场垫到 0 以上，云就填满包围盒变成方块
  return max(max(fb, ft * 0.92), fs - 3.0 * (1.0 - uRide.y));
}
// 噪声去偏：R（Perlin-Worley）均值约 0.62，G/B（Worley）约 0.45
float densF(vec3 p, float f, float tail, bool fine) {
  // 噪声向后流、尾部沿气流拉长。流动量必须加在缩放之后（整团同一个偏移）：加在缩放之前的话，
  // 飞得越久偏移越大，头尾缩放不同的过渡区里纹理会被越压越密，出一排竖条
  vec4 nA = texture(tNoise, p * vec3(0.30, 0.30, mix(0.30, 0.19, tail)) + vec3(0.13, uAnim.z * 0.04, -uAnim.y * 0.36));
  float v = f + (nA.r - 0.62) * mix(1.15, 1.35, tail) + (nA.g - 0.45) * 0.38;
  if (fine) {
    vec4 nB = texture(tNoise, p * vec3(0.95, 0.95, mix(0.95, 0.50, tail)) + vec3(0.37, uAnim.z * 0.09, 0.61 - uAnim.y * 1.1));
    v += ((nB.g - 0.45) * 0.24 + (nB.b - 0.45) * 0.08) * (1.0 + 1.2 * tail);                 // 尾巴的边缘咬得更碎
  }
  float d = smoothstep(0.0, 0.22, v);
  // 顶面压平；人站的地方踩低一圈，贴着腿又裹上去一截，云絮顺着腿往上舔（噪声在向后流，所以是一阵一阵被带走的）
  vec2 rr = vec2(p.x, p.z - 0.04); float bk = max(rr.y, 0.0);
  float wr = length(vec2(rr.x / 0.42, (rr.y - 0.35 * bk) / (0.36 + 0.7 * bk)));
  float wrap = exp(-wr * wr) * uRide.y;
  float lift = wrap * (0.04 + 0.11 * smoothstep(0.52, 0.80, nA.r)) - 0.10 * exp(-dot(rr, rr) / 0.85) * uRide.y * (1.0 - wrap);
  d *= mix(smoothstep(0.24, 0.03, p.y - lift), 1.0, tail);                 // 压平只管云头；尾巴靠自己的截面收边，不然顶上会被削成一张平片
  // 包围盒边界：离盒壁 0.25 m 以内平滑淡到 0（p 是云体坐标，换回本地坐标再比）
  vec3 q = vec3(p.x, p.y + uRide.x, p.z), eb = min(q - uBoxMin, uBoxMax - q);
  d *= smoothstep(0.0, 0.25, min(eb.x, min(eb.y, eb.z)));
  return d * mix(1.0, 0.55, tail);
}
float dens(vec3 p, bool fine) {
  float tail; float f = field(p, tail);
  if (f < -0.75) return 0.0;
  return densF(p, f, tail, fine);
}
// 人投在云上的影子（x）和贴着腿的接触阴影（y）。p 是本地坐标；身体当成沿 +Y 的一根胶囊（脚底 uRide.w → 头顶 uRide.z）
vec2 riderShade(vec3 p) {
  if (uRide.y < 0.01) return vec2(0.0);
  vec2 lx = uSunLocal.xz;
  float t = clamp(-dot(p.xz, lx) / max(dot(lx, lx), 1e-3), 0.0, 9.0);      // 朝太阳走到离身体轴线最近的地方
  vec3 q = p + uSunLocal * t;
  float dq = length(vec2(length(q.xz), max(max(uRide.w - q.y, q.y - uRide.z), 0.0)));
  float shadow = (1.0 - smoothstep(RIDER_R * 0.6, RIDER_R * 1.5 + 0.10 * t, dq)) * (1.0 - t / 9.0);
  float dc = length(vec2(length(p.xz), max(max(uRide.w - p.y, p.y - uRide.z), 0.0)));
  float contact = 1.0 - smoothstep(RIDER_R * 0.8, RIDER_R * 3.4, dc);
  return vec2(shadow, contact) * uRide.y;
}
void main() {
  vec3 ro = uCamLocal, rd = normalize(vLocal - uCamLocal);
  vec3 inv = 1.0 / rd; vec3 a = (uBoxMin - ro) * inv, b = (uBoxMax - ro) * inv;
  vec3 tn = min(a, b), tx = max(a, b);
  float t0 = max(max(max(tn.x, tn.y), tn.z), 0.0), t1 = min(min(tx.x, tx.y), tx.z);
  vec3 rdW = normalize(mat3(uModel) * rd);
  float vz = max(-(viewMatrix * vec4(rdW, 0.0)).z, 1e-4);
  t1 = min(t1, sceneViewDist(gl_FragCoord.xy) / vz);                       // 被不透明物体（悟空、石峰）截断
  if (t1 <= t0) discard;
  float mu = dot(rd, uSunLocal);
  float fwd = pow(max(mu, 0.0), 3.0);
  float t = t0 + JDY_DT * ign(gl_FragCoord.xy);
  vec3 col = vec3(0.0); float T = 1.0;
  for (int i = 0; i < JDY_STEPS; i++) {
    if (t >= t1) break;
    vec3 pl = ro + rd * t;                                                  // 本地坐标
    vec3 p = pl; p.y -= uRide.x;                                            // 云体坐标
    float tail; float f = field(p, tail);
    // 剩下的路比剩下的步数能走的还长时（顺着拉长的尾巴看），把步长放大到刚好走完，后半截不会因为步数用光被截掉
    float need = (t1 - t) / float(JDY_STEPS - i);
    if (f < -0.75) { t += max(max(JDY_DT, need), (-f - 0.75) * 0.45); continue; }     // 离云还远：按形状场跳过空域
    float dt = min(max(JDY_DT * (1.0 + tail), need), t1 - t);
    float d = densF(p, f, tail, true);
    if (d > 0.01) {
      float tau = (dens(p + uSunLocal * 0.16, false) * 0.16 + dens(p + uSunLocal * 0.42, false) * 0.30 + dens(p + uSunLocal * 0.95, false) * 0.55) * JDY_SIGMA;
      float sunT = 0.78 * exp(-tau) + 0.22 * exp(-tau * 0.2);              // 第二项近似多次散射
      vec2 rs = riderShade(pl);                                             // 人的投影 + 脚边的接触阴影
      vec3 L = uSunLight * sunT * (1.0 - 0.85 * rs.x) * (0.40 + 2.6 * fwd * exp(-tau * 0.55));   // 逆光：薄处透亮，厚处仍暗 → 银边
      L += uAmb * (0.60 + 0.40 * smoothstep(-1.1, 0.0, p.y)) * (0.55 + 0.45 * exp(-tau * 0.3)) * (1.0 - 0.50 * rs.y) * (1.0 - 0.25 * rs.x);
      float al = 1.0 - exp(-d * JDY_SIGMA * dt);
      col += T * al * L; T *= 1.0 - al;
      if (T < 0.02) { T = 0.0; break; }
    }
    t += dt;
  }
  float alpha = 1.0 - T;
  if (alpha < 0.003) discard;
  // 按距离向雾色靠；钻进云海时向云色靠
  vec3 pw = (uModel * vec4(ro + rd * t0, 1.0)).xyz;
  float tf = exp(-fogTau(cameraPosition, rdW, length(pw - cameraPosition)));
  col = col * tf + fogColor(rdW) * (1.0 - tf) * alpha;
  float veil = seaVeil(cameraPosition, pw);
  col = col * veil + uSeaCol * (1.0 - veil) * alpha;
  gl_FragColor = vec4(col, alpha);
}`;

const TRAIL_VERT = FOG_GLSL + SEA_VEIL_GLSL + /* glsl */`
attribute vec3 iPos; attribute vec4 iAxis; attribute vec4 iData;   // iAxis: 轴向(单位) + 半长；iData: 出生时间, 寿命, 浓度, 粗细倍数
attribute vec2 iFx;                                                // x: 出生时的加速程度（0..1）, y: 1 = 两侧的飞沫
uniform float uNow; uniform vec3 uRadius; uniform vec2 uResolution;
varying vec3 vViewPos; varying vec4 vInfo; varying vec3 vCenter; varying vec4 vAxis; varying vec4 vFog; varying vec3 vFx;
void main() {
  float a = clamp((uNow - iData.x) / iData.y, 0.0, 1.0);
  float grow = sqrt(clamp((uNow - iData.x) / uRadius.z, 0.0, 1.0));
  float rBase = mix(uRadius.x, uRadius.y, grow);                       // 离开云头时是细细一缕，之后按时间慢慢散开
  // iData.w：粗细倍数（沿尾流平滑起伏；加速 / 爆开时更大）。刚出生时不吃加速和爆开的加粗，
  // 所以无论多粗的拖尾都是从云头里细细地钻出来、在身后才鼓开，不会在云头后面顶出一个平头的粗柱子
  float r = mix(uRadius.x * min(iData.w, 1.3) * (1.0 + 0.25 * iFx.x), uRadius.y * iData.w, grow);
  vec3 A = (viewMatrix * vec4(iPos - iAxis.xyz * iAxis.w, 1.0)).xyz, B = (viewMatrix * vec4(iPos + iAxis.xyz * iAxis.w, 1.0)).xyz;
  float zA = -A.z, zB = -B.z;
  vCenter = iPos; vAxis = iAxis;
  vFx = vec3(fract(sin(iData.x * 91.17) * 43758.5453), iFx);           // x: 每段一个固定的随机数（出生时间各不相同）  y: 加速程度  z: 是否飞沫
  // 包围半径：轮廓进出上限 1.15；被啃碎之后外圈是空的，再收一圈（片元里是同一个式子）
  float rb = r * 1.15 * mix(mix(1.0, 0.84, smoothstep(0.0, 0.22, a)), mix(1.0, 0.92, smoothstep(0.0, 0.5, a)), iFx.x);
  // 雾和云海遮挡按整段算一次：最终颜色 = L * vFog.a + vFog.rgb
  vec3 rdW = iPos - cameraPosition; float dist = length(rdW); rdW /= max(dist, 1e-4);
  // 一个像素在这一段上盖多少米：盖得比细噪声的纹理还大时把细噪声关掉，免得远处闪白点、出竖条
  float pix = dist * 2.0 / (projectionMatrix[1][1] * uResolution.y);
  vInfo = vec4(a, uRadius.x / rBase * iData.z, r, 1.0 - smoothstep(0.09, 0.30, pix));   // y: 浓度（越散越稀）  z: 半径  w: 细噪声的权重
  float tf = exp(-fogTau(cameraPosition, rdW, dist));
  float veil = seaVeil(cameraPosition, iPos);
  vFog = vec4((fogColor(rdW) * (1.0 - tf)) * veil + uSeaCol * (1.0 - veil), tf * veil);
  if (zA < 0.35 || zB < 0.35 || a >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vViewPos = vec3(0.0, 0.0, -1.0); return; }   // 贴脸 / 已消亡：不画
  // 屏幕空间包围盒：两端各一个圆（取较大的屏幕半径），沿屏幕上的轴向撑开
  vec2 sA = A.xy / zA, sB = B.xy / zB;
  vec2 e1 = sB - sA; float l = length(e1); e1 = l > 1e-5 ? e1 / l : vec2(1.0, 0.0);
  vec2 e2 = vec2(-e1.y, e1.x);
  float rs = rb / min(zA, zB);
  bool endB = position.x > 0.0;
  vec2 sp = (endB ? sB + e1 * rs : sA - e1 * rs) + e2 * (position.y * rs);
  float z = endB ? zB : zA;
  vViewPos = vec3(sp * z, -z);
  gl_Position = projectionMatrix * vec4(vViewPos, 1.0);
}`;

const TRAIL_FRAG = COMMON + SCENE_DEPTH_GLSL + /* glsl */`
uniform vec3 uRadius; uniform float uTrailSigma;
varying vec3 vViewPos; varying vec4 vInfo; varying vec3 vCenter; varying vec4 vAxis; varying vec4 vFog; varying vec3 vFx;
// 去偏后的噪声：细的翻卷（0.2~0.4 m，刚离开云头时就有）和米级团块（年龄大了由它决定哪里断开 → 一缕一缕）
float fineN(vec3 p) { vec4 n = texture(tNoise, p * 0.62 + 0.31); return (n.r - 0.62) * 2.2 + (n.g - 0.45) * 0.9; }
float coarseN(vec3 p) { return (texture(tNoise, p * 0.21).r - 0.62) * 2.6; }
float bigN(vec3 p) { return (texture(tNoise, p * 0.075 + 0.47).r - 0.62) * 2.6; }     // 3 米级的大团：只有加速时的粗拖尾用
// 这一段在 p 点的密度（不含轴向的窗）：径向衰减 × 世界空间噪声侵蚀（年龄越大越碎）。big：加速拖尾的大团噪声（已乘权重）
float densAt(vec3 p, float re, float age, float fine, float coarse, float big) {
  vec3 dp = p - vCenter; vec3 rad = dp - vAxis.xyz * dot(dp, vAxis.xyz);
  float old = smoothstep(0.0, 0.5, age);
  float nz = mix(fine, coarse, old) + 0.35 * mix(coarse, fine, old) + big;
  float lo = mix(0.45, 0.20, vFx.y);                                             // 加速的粗拖尾凹得更深，远看是一团一团的而不是一根管子
  float rr = dot(rad, rad) / (re * re * (lo + (1.32 - lo) * clamp(0.5 + 0.38 * (coarse + fine) + 0.75 * big, 0.0, 1.0)));   // 轮廓跟着噪声进出（半径 0.67~1.15 倍）→ 毛边、粗细起伏
  float fall = max(1.0 - rr, 0.0);
  // 巡航：离开云头后很快被啃碎（前 1/5 寿命），之后剩下的几缕慢慢散尽；加速拖尾：大半段保持连贯的一条云带，后 1/3 才撕开
  float erode = mix(0.02 + 0.50 * smoothstep(0.0, 0.22, age) + 0.36 * age, 0.02 + 0.24 * smoothstep(0.0, 0.45, age) + 0.44 * age * age, vFx.y);
  // 加速拖尾刚出来的那段把噪声放得更大：边缘被咬出缺口、甩出碎絮，不是一根边缘笔直的柱子
  return clamp(fall * sqrt(fall) * (1.0 + (1.5 + 1.8 * age + 2.4 * vFx.y * (1.0 - smoothstep(0.0, 0.45, age))) * nz) - erode, 0.0, 1.0);
}
void main() {
  vec3 dirV = normalize(vViewPos);
  vec3 rd = transpose(mat3(viewMatrix)) * dirV, ro = cameraPosition;
  vec3 u = vAxis.xyz; float S = vAxis.w, age = vInfo.x, re = vInfo.z;
  // 视线穿过（无限长）圆柱的区间 [c0, c1]：相邻小段共用
  vec3 w = ro - vCenter;
  float bst = vFx.y;
  float ru = dot(rd, u), wu = dot(w, u), rb = re * 1.15 * mix(mix(1.0, 0.84, smoothstep(0.0, 0.22, age)), mix(1.0, 0.92, smoothstep(0.0, 0.5, age)), bst);
  float aa = 1.0 - ru * ru, bb = dot(w, rd) - wu * ru, cc = dot(w, w) - wu * wu - rb * rb;
  float c0, c1;
  if (aa < 1e-5) { if (cc > 0.0) discard; c0 = 0.0; c1 = 1e5; }
  else { float disc = bb * bb - aa * cc; if (disc <= 0.0) discard; float sq = sqrt(disc); c0 = max((-bb - sq) / aa, 0.0); c1 = (-bb + sq) / aa; }
  // 本段轴向窗的范围
  float t0 = c0, t1 = c1;
  if (abs(ru) > 1e-5) { float ta = (-S - wu) / ru, tb = (S - wu) / ru; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  else if (abs(wu) > S) discard;
  float vz = max(-dirV.z, 1e-3);
  float tScene = sceneViewDist(gl_FragCoord.xy) / vz;
  t1 = min(t1, tScene);
  if (t1 <= t0) discard;
  // 在本段的区间里取两个点；密度 × 本段的窗 × 各点自己的淡出系数。
  // 相邻两段的窗相加 = 1，淡出也是按位置算的，所以合成后和“不分段”的一整条一致，任何速度都没有节纹
  float len = t1 - t0;
  float lod = vInfo.w;
  float along = smoothstep(0.70, 0.96, abs(ru));                                // 是否顺着尾流看
  // 斜着看时视线会连续穿过好几段的窗：采样点如果固定在每段的 1/4、3/4 处，就总落在垂直于尾流的一排等距平面上，
  // 被啃碎的老尾流会显出一排斜纹。所以视线越斜就越按像素抖动采样位置（窗的权重照常算，相邻段仍然精确加起来等于 1）
  float span = 2.0 * re * abs(ru) / (sqrt(max(aa, 1e-4)) * S);                  // 圆柱的弦在轴向上跨过几个半段
  // 刚出来的那段还很实，不用抖（免得近看有颗粒）；每段再错开一个固定的偏移，重叠的两段就不会采到同一个点，颗粒更细
  float jit = mix(0.5, fract(ign(gl_FragCoord.xy) + vFx.x), smoothstep(0.35, 1.1, span) * smoothstep(0.04, 0.22, age));
  float sum = 0.0;
  for (int i = 0; i < 2; i++) {
    float t = t0 + (float(i) + jit) * 0.5 * len, z = t * vz;
    float win = 0.5 + 0.5 * cos(3.14159265 * clamp((wu + t * ru) / S, -1.0, 1.0));
    // 窗 × 软粒子 × 离相机太近淡出 × 顺着尾流看时 13 m 内减淡（追尾视角别把脚下糊白；两侧的飞沫不减）
    float f = win * smoothstep(0.0, 0.5 * re, tScene - t) * smoothstep(1.2, 4.5, z) * mix(1.0, 0.30, along * (1.0 - smoothstep(5.0, 13.0, z)) * (1.0 - vFx.z));
    if (f < 0.012) continue;                                                     // 窗的两头、贴脸的部分：贡献可以忽略，省掉采样
    vec3 p = ro + rd * t;
    sum += densAt(p, re, age, lod > 0.02 ? fineN(p) * lod : 0.0, coarseN(p), bst > 0.03 ? bigN(p) * bst * 0.9 : 0.0) * f;
  }
  float dl = 0.5 * len;
  float young = 1.0 + 0.6 * (1.0 - smoothstep(0.0, 0.07, age));                 // 贴着云头的那一小段更浓
  float dens = uTrailSigma * vInfo.y * young;
  float tau = sum * dl * dens * pow(1.0 - age, mix(1.35, 0.9, bst));
  float alpha = 1.0 - exp(-tau);
  if (alpha < 0.003) discard;
  // 光照只用相邻小段共有的几何量（圆柱的弦，不用被窗截过的区间），否则每段各亮各的又会出节纹。
  // 光的方向 = 太阳 + 一点天光，再去掉沿尾流轴向的分量：顺着轴向照等于整条都在自己影子里，会灰成一根管子；
  // 实际上这么薄的水汽会被多次散射照亮，只剩“朝光的一侧亮、背光的一侧稍暗、团块之间互相挡一点”
  float cEnd = min(c1, tScene), chord = min(cEnd - c0, 4.0 * re);
  vec3 ld = uSunW + vec3(0.0, 0.55, 0.0); ld -= u * dot(ld, u);
  float ll = length(ld); ld = ll > 0.05 ? ld / ll : normalize(cross(u, vec3(0.7, 0.1, 0.7)));
  vec3 pS = ro + rd * (c0 + 0.25 * chord);
  vec3 q = pS - vCenter; q -= u * dot(q, u);
  float side = smoothstep(-0.9, 0.7, dot(q, ld) / re);                           // 朝光一侧 1，背光一侧 0
  vec3 pL = pS + ld * ((0.40 + 0.25 * bst) * re);
  float cL = coarseN(pL), bL = bst > 0.03 ? bigN(pL) * bst * 0.9 : 0.0;
  float dsun = densAt(pL, re, age, 0.0, cL, bL);                                 // 朝光方向隔着的团块（只看米级以上的）
  float cav = clamp(0.5 + 0.55 * cL + 1.3 * bL, 0.0, 1.0);                       // 鼓包亮、凹缝暗（和云海同一个办法），远看才有一团一团的层次
  // 加速的粗拖尾：基础亮度压低、明暗拉大（朝光 / 背光、团块互相遮挡），不然远看是一条平平的白带
  float shade = mix(mix(0.62, 0.36, bst), 1.0, side) * clamp(1.16 + 0.10 * bst - (0.60 + 0.75 * bst) * dsun, 0.62 - 0.24 * bst, 1.26);
  float mu = dot(rd, uSunW);
  float tauGeo = chord * dens * 0.5;
  float thin = exp(-tauGeo * 0.6);                                               // 视线穿过的这一段有多薄
  // 朝着太阳看时看到的是背阳面：厚的地方压暗，只有薄的边缘透亮（银边）；顺光 / 侧光时正常
  float back = smoothstep(0.15, 0.9, mu) * (1.0 - thin);
  vec3 L = uSunLight * shade * (mix(0.50, 0.32, bst) * (1.0 - mix(0.35, 0.60, bst) * back) + 0.20 * bst * thin + 2.2 * pow(max(mu, 0.0), 3.0) * thin);
  L += uAmb * (0.95 + 0.30 * side) * (1.0 - 0.25 * back);
  L *= mix(mix(0.80, 0.52, bst), mix(1.12, 1.22, bst), cav) * (1.0 - 0.10 * bst);
  gl_FragColor = vec4((L * vFog.a + vFog.rgb) * alpha, alpha);
}`;

// 低分辨率尾流缓冲贴回全分辨率：取最近的 4 个低分辨率像素，按“它当时对着的场景深度和这个像素的深度差多少”加权，
// 角色 / 石峰轮廓两侧就不会互相渗色
const COMP_VERT = /* glsl */`void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const COMP_FRAG = SCENE_DEPTH_GLSL + /* glsl */`
uniform sampler2D tTrail; uniform vec2 uLowRes;
void main() {
  vec2 pl = gl_FragCoord.xy / uResolution * uLowRes - 0.5; vec2 f = fract(pl), b = floor(pl) + 0.5;
  float d0 = min(sceneViewDist(gl_FragCoord.xy), 4000.0);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 q = (b + vec2(float(i), float(j))) / uLowRes;
    float dq = min(sceneViewDist(q * uResolution), 4000.0), dd = dq - d0;
    float w = ((i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y) + 0.02) / (1.0 + dd * dd / (0.0025 * d0 * d0 + 0.01));
    acc += texture2D(tTrail, q) * w; ws += w;
  }
  acc /= ws;
  if (acc.a < 0.002) discard;
  gl_FragColor = acc;
}`;
const TRAIL_LEVELS = [1, 0.5, 0.35, 0.25];        // 尾流画布相对全分辨率的比例：占屏越大用得越小

export function createJDY(app) {
  const renderer = app.renderer, camera = app.camera;
  const steps = num('jdySteps', { low: 28, high: 48, ultra: 64 }[QUALITY_NAME] || 48);
  const sunLight = new THREE.Vector3(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiplyScalar(SUN_INTENSITY * 0.52);
  const shared = {
    ...app.fx.uniforms, ...fogUniforms, ...seaUniforms,
    tNoise: { value: getNoise3D(renderer) }, uSunLight: { value: sunLight }, uAmb: { value: new THREE.Vector3(0.27, 0.29, 0.34) },
    uSunW: { value: SUN_DIR.clone() },
  };
  const blend = {
    transparent: true, depthTest: false, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  };
  const group = new THREE.Group(); group.name = 'JDY';

  // ---------------- 脚下的云
  const size = new THREE.Vector3().subVectors(JDY.boxMax, JDY.boxMin), center = new THREE.Vector3().addVectors(JDY.boxMax, JDY.boxMin).multiplyScalar(0.5);
  const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z); boxGeo.translate(center.x, center.y, center.z);
  const bodyU = {
    ...shared, uCamLocal: { value: new THREE.Vector3() }, uSunLocal: { value: new THREE.Vector3() },
    uBoxMin: { value: JDY.boxMin.clone() }, uBoxMax: { value: JDY.boxMax.clone() }, uModel: { value: new THREE.Matrix4() },
    uAnim: { value: new THREE.Vector4(0, 0, 0, 0) }, uRide: { value: new THREE.Vector4(0, 0, JDY.riderHeight, 0) },
  };
  const body = new THREE.Mesh(boxGeo, new THREE.ShaderMaterial({
    uniforms: bodyU, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, side: THREE.BackSide, ...blend,
    defines: { JDY_STEPS: steps, JDY_SIGMA: JDY.sigma.toFixed(2), JDY_DT: ({ low: 0.13, high: 0.08, ultra: 0.06 }[QUALITY_NAME] || 0.08).toFixed(3) },
  }));
  body.frustumCulled = false; body.name = 'JDY_Body';
  const bodyPivot = new THREE.Group(); bodyPivot.add(body); group.add(bodyPivot);

  // ---------------- 尾流
  const MAX = JDY.trailMax;
  const pPos = new Float32Array(MAX * 3), pVel = new Float32Array(MAX * 3), pData = new Float32Array(MAX * 4), pAxis = new Float32Array(MAX * 4), pFx = new Float32Array(MAX * 2);
  for (let i = 0; i < MAX; i++) pData[i * 4] = -1e6;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3), aData = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  const aAxis = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4), aFx = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
  aPos.setUsage(THREE.DynamicDrawUsage); aData.setUsage(THREE.DynamicDrawUsage); aAxis.setUsage(THREE.DynamicDrawUsage); aFx.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos); geo.setAttribute('iData', aData); geo.setAttribute('iAxis', aAxis); geo.setAttribute('iFx', aFx); geo.instanceCount = 0;
  const trailRes = { value: new THREE.Vector2(2, 2) };         // 尾流这一遍画在多大的画布上（直接画 = 全分辨率；低分辨率通道 = 缩小后的尺寸）
  const trailU = { ...shared, uResolution: trailRes, uNow: { value: 0 }, uRadius: { value: new THREE.Vector3(JDY.trailR0, JDY.trailR1, JDY.trailLife) }, uTrailSigma: { value: JDY.trailSigma } };
  const trail = new THREE.Mesh(geo, new THREE.ShaderMaterial({ uniforms: trailU, vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, ...blend }));
  trail.frustumCulled = false; trail.name = 'JDY_Trail';
  group.add(trail);
  // 低分辨率通道：尾流在屏幕上占得很大时（加速的粗拖尾贴近镜头、长焦顺着尾流看…）逐像素开销成倍涨，
  // 这时把尾流画进一张缩小的缓冲，再按深度加权贴回来。贴回用的四边形在自己的 onBeforeRender 里画那张缓冲
  // （和 three 的 Reflector 同一个做法：这时当帧的场景深度已经画好了）。占屏小的时候仍然直接全分辨率画。
  const trailScene = new THREE.Scene();
  const rtTrail = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const compGeo = new THREE.BufferGeometry(), compPos = new THREE.Float32BufferAttribute(new Float32Array(12), 3);
  compPos.setUsage(THREE.DynamicDrawUsage); compGeo.setAttribute('position', compPos); compGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const compU = { ...app.fx.uniforms, tTrail: { value: rtTrail.texture }, uLowRes: { value: new THREE.Vector2(2, 2) } };
  const comp = new THREE.Mesh(compGeo, new THREE.ShaderMaterial({ uniforms: compU, vertexShader: COMP_VERT, fragmentShader: COMP_FRAG, ...blend }));
  comp.frustumCulled = false; comp.visible = false; comp.name = 'JDY_TrailComposite';
  const _clear = new THREE.Color();
  comp.onBeforeRender = (r, sc, cam) => {
    const rt0 = r.getRenderTarget(), ac0 = r.autoClear, ca0 = r.getClearAlpha(); r.getClearColor(_clear);
    r.setRenderTarget(rtTrail); r.setClearColor(0x000000, 0); r.autoClear = true;
    r.render(trailScene, cam);
    r.setRenderTarget(rt0); r.setClearColor(_clear, ca0); r.autoClear = ac0;
  };
  group.add(comp);
  let level = 0, estPx = 0;

  let head = 0, now = 0, carry = 0, flow = 0, roll = 0, stretch = 0, started = false, sinkS = -1, prevBoost = 0, burstT = 0;
  const MAIN = 380;                                // 主尾流最多同时活着这么多段
  const right = new THREE.Vector3(), sprayP = new THREE.Vector3(), sprayV = new THREE.Vector3();
  let sprayRun = 0, sprayNext = 3, seed = 20261122, prevFlip = 0, dipY = 0, dipV = 0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;      // 固定种子：同样的飞法得到同样的水花，截图 / 录像可复现
  function alloc() {                               // 找一个已经消亡的空位（主尾流和飞沫寿命差得多，不能简单地循环覆盖）
    for (let k = 0; k < MAX; k++) { const i = head; head = (head + 1) % MAX; if (now - pData[i * 4] > pData[i * 4 + 1]) return i; }
    return head;
  }
  const last = new THREE.Vector3(), fwd = new THREE.Vector3(), up = new THREE.Vector3(), emit = new THREE.Vector3(), tmp = new THREE.Vector3();
  const zero = new THREE.Vector3(), sp = new THREE.Vector3(), prevPos = new THREE.Vector3();
  const inv = new THREE.Matrix4(), order = new Uint16Array(MAX), depth = new Float32Array(MAX);
  let serial = 0;                                  // 出生序号：漂移用它的平滑函数，相邻小段一起动，不会被扯开
  let travel = 0;                                  // 累计飞过的距离：粗细起伏按它算（几个不成倍数的波长叠起来，看不出规律）
  const axis = new THREE.Vector3();

  function spawn(p, ax, half, vel, boost, life, speed, birth, burst) {
    travel += half;
    // 粗细沿尾流起伏；加速时每段很长，去掉波长最短的那一项
    const thick = Math.max(0.5, 1 + 0.28 * Math.sin(travel * 0.90 + 1.0) * (1 - 0.85 * boost) + 0.20 * Math.sin(travel * 0.37 + 2.1) * (1 - 0.4 * boost)
      + 0.12 * Math.sin(travel * 2.1) * (1 - boost) + boost * (0.24 * Math.sin(travel * 0.262 + 0.7) + 0.17 * Math.sin(travel * 0.419 + 4.0) + 0.14 * Math.sin(travel * 0.131 + 2.2)
        + 0.16 * Math.sin(travel * 0.83 + 5.1) + 0.12 * Math.sin(travel * 1.31 + 0.4)));
    const i = alloc();
    const k = serial++ * 0.045;                    // 相位随出生距离缓慢变化
    pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
    // 加速的粗拖尾：再加一份沿尾流连续变化的横向 / 上下漂移（从云头里出来时还在正中，往后半秒就摆开了），
    // 中心线弯弯曲曲，远看轮廓不是两条直边
    const wx = boost * (1.5 * Math.sin(travel * 0.21 + 1.0) + 0.9 * Math.sin(travel * 0.57 + 2.6)), wy = boost * (0.9 * Math.sin(travel * 0.33 + 4.0) + 0.6 * Math.sin(travel * 0.71));
    // 留在原地：只带一点点惯性、上浮，以及沿尾流平滑变化的横向飘摆（越老摆得越开）
    pVel[i * 3] = vel.x * 0.03 + 0.55 * Math.sin(k * 1.9 + 1.3) + 0.35 * Math.sin(k * 5.3) + right.x * wx;
    pVel[i * 3 + 1] = vel.y * 0.03 + 0.22 + 0.40 * Math.sin(k * 2.7 + 0.4) + 0.25 * Math.sin(k * 6.1 + 2.0) + wy;
    pVel[i * 3 + 2] = vel.z * 0.03 + 0.55 * Math.cos(k * 2.3) + 0.35 * Math.sin(k * 4.7 + 0.9) + right.z * wx;
    pAxis[i * 4] = ax.x; pAxis[i * 4 + 1] = ax.y; pAxis[i * 4 + 2] = ax.z; pAxis[i * 4 + 3] = half;
    // 浓度：巡航时单位时间吐出的水汽一样多，飞得越快摊得越稀；加速时不再变稀，而且更粗、活得更久
    const cruise = Math.min(1.15, Math.max(0.60, Math.sqrt(45 / Math.max(speed, 8))));
    pData[i * 4] = birth; pData[i * 4 + 1] = life;
    pData[i * 4 + 2] = (cruise + (JDY.boostStrength - cruise) * boost) * (1 + 0.5 * burst);
    pData[i * 4 + 3] = (1 + (JDY.boostThick - 1) * boost) * thick * (1 + JDY.burst * burst * (0.75 + 0.45 * Math.sin(travel * 0.9 + 3.0)));
    pFx[i * 2] = boost; pFx[i * 2 + 1] = 0;
  }
  // 水花里的一个小云团：单独的一段（两头都被窗收掉，是个软的纺锤形），沿抛出的方向拉长
  function spawnPuff(p, vel, k, side, birth) {
    const i = alloc();
    const out = side * (1.6 + 3.4 * rnd()) * (0.7 + 0.5 * k), lift = 2.6 + 3.6 * rnd(), fore = -2.5 * rnd();
    sprayV.copy(right).multiplyScalar(out).addScaledVector(fwd, fore); sprayV.y += lift;
    pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
    pVel[i * 3] = vel.x * 0.10 + sprayV.x; pVel[i * 3 + 1] = vel.y * 0.10 + sprayV.y; pVel[i * 3 + 2] = vel.z * 0.10 + sprayV.z;
    sprayV.addScaledVector(vel, 0.035).normalize();                           // 轴向 = 抛出的方向，带一点飞行方向的拖长
    pAxis[i * 4] = sprayV.x; pAxis[i * 4 + 1] = sprayV.y; pAxis[i * 4 + 2] = sprayV.z; pAxis[i * 4 + 3] = 0.5 + 1.0 * rnd();
    const big = rnd();
    pData[i * 4] = birth; pData[i * 4 + 1] = JDY.sprayLife * (0.55 + 0.75 * rnd());
    pData[i * 4 + 2] = (0.8 + 0.9 * rnd()) * Math.sqrt(k);
    pData[i * 4 + 3] = 0.5 + 0.9 * big * big;
    pFx[i * 2] = 0; pFx[i * 2 + 1] = 1;
  }

  function update(dt, state) {
    now += dt;
    const speed = state.speed !== undefined ? state.speed : (state.velocity ? state.velocity.length() : 0), boost = state.boost || 0;
    fwd.set(0, 0, -1).applyQuaternion(state.quaternion); up.set(0, 1, 0).applyQuaternion(state.quaternion); right.set(1, 0, 0).applyQuaternion(state.quaternion);
    // 翻筋斗（state.flip = 0..1 进度，0 / 不传 = 不在翻）：人腾空约 1.25 m。起跳被蹬一脚、落回被踩一脚，云头下沉再弹回来
    const flip = state.flip || 0, air = flip > 0 ? Math.sin(Math.PI * Math.min(1, flip)) : 0;
    if (flip > 0 && prevFlip <= 0) dipV -= 2.6;
    if (flip <= 0 && prevFlip > 0.5) dipV -= 3.4;
    prevFlip = flip;
    for (let k = 0, h = Math.min(dt, 0.05) / 2; k < 2; k++) { dipV += (-70 * dipY - 9 * dipV) * h; dipY += dipV * h; }
    bodyPivot.position.copy(state.position).addScaledVector(up, dipY); bodyPivot.quaternion.copy(state.quaternion); bodyPivot.updateMatrixWorld(true);
    // 云体动画：速度越快拉得越长、噪声向后流得越快
    stretch += (Math.min(1.4, speed / 70 + boost * 0.6) - stretch) * Math.min(1, dt * 3);
    flow += dt * (0.35 + speed * 0.022 + boost * 1.2); roll += dt;
    bodyU.uAnim.value.set(stretch, flow, roll, boost);
    // 人陷在云里：主程序把角色下沉了 state.sink 米（脚底在 position 下方 sink 处）。sink > 0 时把云顶面（密度一半处，
    // 云体坐标 y≈0.13）对齐到 position，再在腿周围踩低一圈、贴着腿裹上去；sink = 0 时和以前一样（脚底踩在云面上）
    const sink = Math.max(0, state.sink || 0);
    sinkS = sinkS < 0 ? sink : sinkS + (sink - sinkS) * Math.min(1, dt * 6);          // 翻筋斗时主程序会把 sink 置 0：平滑过渡
    const ride = THREE.MathUtils.smoothstep(sinkS, 0.04, 0.22) * (1 - THREE.MathUtils.smoothstep(air, 0.08, 0.35)), lift = -0.12 * THREE.MathUtils.smoothstep(sinkS, 0.04, 0.22);
    const feet = -sinkS + 1.25 * air - dipY;                                  // 人脚底在云的本地坐标里的高度（腾空时离开云面）
    bodyU.uRide.value.set(lift, ride, feet + JDY.riderHeight, feet);
    bodyU.uModel.value.copy(bodyPivot.matrixWorld);
    inv.copy(bodyPivot.matrixWorld).invert();
    bodyU.uCamLocal.value.copy(camera.position).applyMatrix4(inv);
    bodyU.uSunLocal.value.copy(SUN_DIR).transformDirection(inv);
    // 尾流：按飞过的距离出生
    emit.copy(state.position).addScaledVector(fwd, -JDY.emitBack).addScaledVector(up, lift - JDY.emitDown + dipY);
    if (!started) { last.copy(emit); prevPos.copy(state.position); started = true; }
    const moved = tmp.subVectors(emit, last).length();
    carry += moved;
    const lifeCruise = Math.min(JDY.trailLife, Math.max(JDY.trailLifeMin, JDY.trailReach / Math.max(speed, 1)));
    const life = lifeCruise + (JDY.boostLife - lifeCruise) * boost;
    const spacing = Math.max(JDY.trailSpacing, speed * life * 1.12 / MAIN);  // 段数封顶：太快 / 活得久就把每段拉长
    // 开始加速的那一下：之后半秒里出生的小段额外膨胀（先鼓起来再收回去，沿尾流是连续的一个包）
    if (prevBoost < 0.15 && boost >= 0.15) burstT = 1;
    prevBoost = boost; burstT = Math.max(0, burstT - dt / 0.5);
    const burst = Math.sin(Math.PI * burstT);
    const vel = state.velocity || zero;
    if (moved > 1e-5 && moved < 60) {
      axis.subVectors(emit, last).multiplyScalar(1 / moved);              // 这一帧的飞行方向 = 小段的轴向
      let n = 0;
      while (carry >= spacing && n < 64) {
        carry -= spacing; n++;
        const f = Math.min(1, Math.max(0, 1 - carry / Math.max(moved, 1e-6)));   // 在上一帧和这一帧的出生点之间按距离插值（出生时间也插值，同一帧里出生的几段年龄才连续）
        spawn(sp.lerpVectors(last, emit, f), axis, spacing, vel, boost, life, speed, now - dt * (1 - f), burst);
      }
    } else if (moved >= 60) carry = 0;                                     // 瞬移：不拉尾流
    last.copy(emit);
    // 水花：离云顶越近、飞得越快越多；高于 sprayAlt 或没有云海时不出
    let sprayK = 0, drop = 0;
    if (seaQuery.heightAt) {
      const alt = state.position.y - seaQuery.heightAt(state.position.x, state.position.z);
      sprayK = (1 - THREE.MathUtils.smoothstep(alt, 2, JDY.sprayAlt)) * THREE.MathUtils.smoothstep(speed, 12, 40) * (1 - THREE.MathUtils.smoothstep(-alt, 4, 12));
      drop = Math.min(Math.max(alt, 0), JDY.sprayAlt) * 0.85;                 // 水花从云面上起，不是从脚边起
    }
    if (sprayK > 0.03 && moved < 60) {
      sprayRun += moved;
      let guard = 0;
      while (sprayRun >= sprayNext && guard++ < 6) {
        sprayRun -= sprayNext;
        sprayNext = Math.max(JDY.sprayGap, speed * 0.11) / Math.max(sprayK, 0.35) * (0.3 + 1.6 * rnd());       // 到下一簇的距离：随机，忽密忽疏
        const f = moved > 1e-5 ? Math.min(1, Math.max(0, 1 - sprayRun / moved)) : 1, birth = now - dt * (1 - f);
        const both = rnd() < 0.22, first = rnd() < 0.5 ? -1 : 1;
        for (let b = 0; b < (both ? 2 : 1); b++) {
          const side = b === 0 ? first : -first, n = 2 + Math.floor(rnd() * 3.6);
          for (let j = 0; j < n; j++) {
            sprayP.lerpVectors(prevPos, state.position, f).addScaledVector(right, side * (JDY.spraySide * (0.6 + 0.8 * rnd()) + 0.4 * boost)).addScaledVector(fwd, -0.4 - 2.2 * rnd());
            sprayP.y -= drop + 0.2 + 0.5 * rnd();
            spawnPuff(sprayP, vel, sprayK, side, birth);
          }
        }
      }
    } else if (sprayK <= 0.03) sprayRun = 0;
    prevPos.copy(state.position);
    // 运动 + 按相机深度从远到近排序；顺便估算这些小段的包围四边形一共要画多少像素
    camera.updateMatrixWorld(); const me = camera.matrixWorldInverse.elements;
    const Wp = app.fx.uniforms.uResolution.value.x, Hp = app.fx.uniforms.uResolution.value.y;
    const fpx = 0.5 * Hp / Math.tan(camera.fov * Math.PI / 360);
    let n = 0, est = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    const kd = Math.exp(-dt * 0.9), ks = Math.exp(-dt * 2.6), R0 = JDY.trailR0, R1 = JDY.trailR1, grow = JDY.trailLife;
    for (let i = 0; i < MAX; i++) {
      const age = now - pData[i * 4];
      if (age < 0 || age > pData[i * 4 + 1]) continue;
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      if (pFx[i * 2 + 1] > 0.5) { pVel[i * 3] *= ks; pVel[i * 3 + 1] = -1.4 + (pVel[i * 3 + 1] + 1.4) * ks; pVel[i * 3 + 2] *= ks; }      // 水花：抛起来再落回去
      else { pVel[i * 3] *= kd; pVel[i * 3 + 1] = 0.22 + (pVel[i * 3 + 1] - 0.22) * kd; pVel[i * 3 + 2] *= kd; }
      const x = pPos[i * 3], y = pPos[i * 3 + 1], z = pPos[i * 3 + 2];
      const vx = me[0] * x + me[4] * y + me[8] * z + me[12], vy = me[1] * x + me[5] * y + me[9] * z + me[13], vz = -(me[2] * x + me[6] * y + me[10] * z + me[14]);
      depth[i] = vz; order[n++] = i;
      // 屏幕上的包围框（和顶点着色器里的四边形一致，取轴对齐的外接矩形）
      const ax = pAxis[i * 4], ay = pAxis[i * 4 + 1], az = pAxis[i * 4 + 2], half = pAxis[i * 4 + 3];
      const near = vz - half * Math.abs(me[2] * ax + me[6] * ay + me[10] * az);
      if (near < 0.35) continue;                                          // 贴脸：顶点着色器里不画
      const rs = (R0 + (R1 - R0) * Math.sqrt(Math.min(1, age / grow))) * pData[i * 4 + 3] * 1.15 / near * fpx;
      const ex = rs + half * fpx * Math.abs(me[0] * ax + me[4] * ay + me[8] * az) / near, ey = rs + half * fpx * Math.abs(me[1] * ax + me[5] * ay + me[9] * az) / near;
      const cx = Wp * 0.5 + vx / vz * fpx, cy = Hp * 0.5 + vy / vz * fpx;
      const x0 = Math.max(0, cx - ex), x1 = Math.min(Wp, cx + ex), y0 = Math.max(0, cy - ey), y1 = Math.min(Hp, cy + ey);
      if (x1 <= x0 || y1 <= y0) continue;
      est += (x1 - x0) * (y1 - y0) * 0.75;
      if (x0 < bx0) bx0 = x0; if (x1 > bx1) bx1 = x1; if (y0 < by0) by0 = y0; if (y1 > by1) by1 = y1;
    }
    const ord = order.subarray(0, n); ord.sort((a, b) => depth[b] - depth[a]);
    for (let k = 0; k < n; k++) {
      const i = ord[k];
      aPos.array[k * 3] = pPos[i * 3]; aPos.array[k * 3 + 1] = pPos[i * 3 + 1]; aPos.array[k * 3 + 2] = pPos[i * 3 + 2];
      aData.array[k * 4] = pData[i * 4]; aData.array[k * 4 + 1] = pData[i * 4 + 1]; aData.array[k * 4 + 2] = pData[i * 4 + 2]; aData.array[k * 4 + 3] = pData[i * 4 + 3];
      aAxis.array[k * 4] = pAxis[i * 4]; aAxis.array[k * 4 + 1] = pAxis[i * 4 + 1]; aAxis.array[k * 4 + 2] = pAxis[i * 4 + 2]; aAxis.array[k * 4 + 3] = pAxis[i * 4 + 3];
      aFx.array[k * 2] = pFx[i * 2]; aFx.array[k * 2 + 1] = pFx[i * 2 + 1];
    }
    geo.instanceCount = n; aPos.needsUpdate = true; aData.needsUpdate = true; aAxis.needsUpdate = true; aFx.needsUpdate = true;
    trailU.uNow.value = now;
    // 选画布大小：估算的像素数 × 比例² 不超过预算（加速时预算放宽一半）；往回升分辨率要留 20% 余量，免得来回跳
    estPx = est;
    const budget = JDY.trailBudgetPx * (1 + 0.5 * boost) * num('trailBudget', 1);
    let want = 0; while (want < TRAIL_LEVELS.length - 1 && est * TRAIL_LEVELS[want] * TRAIL_LEVELS[want] > budget) want++;
    if (want > level) level = want; else if (want < level && est * TRAIL_LEVELS[level - 1] * TRAIL_LEVELS[level - 1] < budget * 0.8) level--;
    if (level === 0 || n === 0 || bx1 <= bx0) {
      if (trail.parent !== group) group.add(trail);
      comp.visible = false; trailRes.value.set(Wp, Hp);
    } else {
      if (trail.parent !== trailScene) trailScene.add(trail);
      const sc = TRAIL_LEVELS[level], lw = Math.max(2, Math.ceil(Wp * sc)), lh = Math.max(2, Math.ceil(Hp * sc));
      if (rtTrail.width !== lw || rtTrail.height !== lh) rtTrail.setSize(lw, lh);
      trailRes.value.set(lw, lh); compU.uLowRes.value.set(lw, lh);
      const m = 2.5 / sc, q = compPos.array;                              // 贴回的范围 = 尾流的屏幕包围框，四周多留两个低分辨率像素
      const nx0 = Math.max(-1, (bx0 - m) / Wp * 2 - 1), nx1 = Math.min(1, (bx1 + m) / Wp * 2 - 1), ny0 = Math.max(-1, (by0 - m) / Hp * 2 - 1), ny1 = Math.min(1, (by1 + m) / Hp * 2 - 1);
      q[0] = nx0; q[1] = ny0; q[3] = nx1; q[4] = ny0; q[6] = nx1; q[7] = ny1; q[9] = nx0; q[10] = ny1; compPos.needsUpdate = true;
      comp.visible = trail.visible;
    }
    // 画的先后：相机在悟空身后时尾流离相机更近，后画；在前方时先画
    const behind = tmp.subVectors(camera.position, state.position).dot(fwd) < 0;
    trail.renderOrder = comp.renderOrder = behind ? 2 : 0; body.renderOrder = 1;
  }

  return {
    group, update, uniforms: { body: bodyU, trail: trailU }, params: JDY,
    get trailCount() { return geo.instanceCount; },
    get trailStats() { return { px: Math.round(estPx), scale: TRAIL_LEVELS[level] }; },      // 估算的尾流像素数、当前画布比例
  };
}
