// 画风 B“明快卡通”的光照、着色、调色（换画风 B · b-toon；起点是第九轮 stylecost 的试验，见 docs/round9/stylecost/REPORT.md）。
// style-b 上默认就是 B。网址加 ?toon=0 退回厚涂写实版的光照、着色和调色（只为对比；地面贴图已经按 B 重画，退不回去）。
// ?toonp=键:值,键:值 临时改参数（见下面 T）。
//   1. 太阳光分阶：亮面一整块、暗面一整块，交界一小段软边；高光压低
//   2. 影子：边收硬，成块；影子里不是变黑，是冷色（B 的影子是偏蓝的青绿）。做法：太阳被挡住（影子里、或者背光的面）时
//      不是一点不剩，而是剩一层偏蓝的光（tint），和天光加起来就是冷色的影子
//   3. 天光偏冷青，调色不加饱和度，曝光往上提——B 的“明快”靠的是亮，不是艳（量过：B 的饱和度比厚涂版还低）
// 改动都挂在 TOON_ON 上，散在 world/main.ts（光和调色）、world/ground.ts（地面）、slice/flora.ts 和 world/brush.ts（草）、slice/water.ts（水）、
// world/trees.ts（树的颜色）、slice/guide.ts 和 world/guide.ts（地面布局图的 B 色表），以及 b-walls 管的 slice/stone.ts（墙）。
// 英雄、小兵、建筑的材质这一批不动（第二批按 B 重出模型），hero/hero.ts 里 stylecost 留下的角色提亮、压细节默认关着（heroLift 等都是 1 / 0），要预览再用 toonp 打开。
import * as THREE from "three";

const q = new URLSearchParams(location.search);
export const TOON_ON = q.get("toon") !== "0";      // style-b 上默认就是 B；?toon=0 退回厚涂写实版的光照和调色（对比用）

/** edge 明暗交界在 N·L 的哪里，soft 交界软边的宽度，dark 暗面剩多少直射光，spec 高光留多少，sh0/sh1 影子收硬的范围，
 *  tr/tg/tb 太阳被挡住时剩下的那层光（乘在太阳的颜色上；我方地上偏蓝，影子是青绿偏蓝的冷色），wr/wg/wb 我方立着的面（墙、石头的背光面）的，亮一些、不那么蓝，fr/fg/fb 对方的（偏紫、亮一些，影子是暗红紫），
 *  sun 太阳强度，warm 太阳有多暖（0 白，1 是 0xffe2b8），hemi 天光强度，exp 曝光，sat 调色的饱和度，yg 黄绿收红，shl / shc 调色里多暗的地方往冷色偏、偏多少，
 *  blur 地面贴图混多少模糊（压掉细碎的笔触；B 的贴图本来就干净，默认关），bias 模糊取第几级缩小图，lift 地面提亮，bedBlur 水下河底糊多少，
 *  pool 着色里另加的冷暖光斑（默认 0：光斑已经烘进地面贴图了，这里只留着调试），bw 草丛叶子的宽度（厚涂版 0.135），recolor 旧（厚涂）地面贴图往 B 的颜色拉多少（只在没换贴图时有用），
 *  heroBlur / heroBias / heroLift / heroSat / heroBump / outline：角色的提亮、压细节、描边（stylecost 留下的，默认关；第二批换模型以后再定） */
export const T: Record<string, number> = {
  edge: 0.1, soft: 0.07, dark: 0.0, spec: 0.22, sh0: 0.3, sh1: 0.7,
  tr: 0.13, tg: 0.22, tb: 0.36, wr: 0.24, wg: 0.3, wb: 0.34, fr: 0.44, fg: 0.33, fb: 0.55,
  sun: 2.9, warm: 0.25, hemi: 1.25, exp: 1.12, sat: 0.97, yg: 0.0, shl: 0.32, shc: 0.6,
  blur: 0, bias: 2.0, lift: 1.0, recolor: 0, bedBlur: 0.6, pool: 0, bw: 0.2,
  heroBlur: 0.0, heroBias: 2.5, heroLift: 1.0, heroSat: 1.0, heroBump: 1.0, stoneTex: 0.4, outline: 0.0,
};
for (const kv of (q.get("toonp") ?? "").split(",")) { const [k, v] = kv.split(":"); if (k && v !== undefined && Number.isFinite(+v)) T[k] = +v; }

const f = (x: number) => x.toFixed(4);

if (TOON_ON) {
  const C = THREE.ShaderChunk as any;
  // toonSh_：这一盏灯被影子挡掉了多少（1 没挡，0 全挡）；toonTint_：这一盏是不是太阳（只有投影子的那盏灯，影子才是冷色的；补光和点光不加）
  C.lights_pars_begin = "float toonSh_ = 1.0; float toonTint_ = 0.0;\n" + C.lights_pars_begin;
  // 影子的颜色两边不一样（B 设计稿量的，见 docs/style_b/STYLE.md 2.3）：我方是青绿偏蓝、比受光处暗一半；对方是暗红偏紫、只暗两三成。
  // 按世界坐标分边：视空间的位置换回世界坐标（视图矩阵是旋转加平移，逆就是转置），隔着河道（x − z = 0）过渡
  const ramp = `float toonRamp_( float nl ) { return mix( ${f(T.dark)}, 1.0, smoothstep( ${f(T.edge - T.soft)}, ${f(T.edge + T.soft)}, nl ) ); }
vec3 toonLit_( float nl, vec3 vp, vec3 vn ) {
  float k = toonRamp_( nl ) * toonSh_;
  if ( toonTint_ < 0.5 ) return vec3( k );      // 补光、点光不加冷色，也省下后面换坐标的几步（每个像素每盏灯都要算）
  mat3 iv = transpose( mat3( viewMatrix ) ); vec3 wp = iv * ( vp - viewMatrix[ 3 ].xyz );
  vec3 me = mix( vec3( ${f(T.tr)}, ${f(T.tg)}, ${f(T.tb)} ), vec3( ${f(T.wr)}, ${f(T.wg)}, ${f(T.wb)} ), 1.0 - clamp( ( iv * vn ).y, 0.0, 1.0 ) );      // 我方：地上的影子深、偏蓝；立着的面（墙、石头的背光面）亮一些、不那么蓝（B 的墙背光面 (120,135,133)）
  vec3 t = mix( me, vec3( ${f(T.fr)}, ${f(T.fg)}, ${f(T.fb)} ), smoothstep( -6.0, 6.0, ( wp.x - wp.z ) * 0.7071 ) );
  return mix( t, vec3( 1.0 ), k ); }\n`;
  // 标准材质（地面、墙、建筑、草、角色都是）：太阳光分阶，高光压低
  C.lights_physical_pars_fragment = C.lights_physical_pars_fragment
    .replace("void RE_Direct_Physical(", ramp + "void RE_Direct_Physical(")
    .replace("vec3 irradiance = dotNL * directLight.color;", "vec3 irradiance = toonLit_( dot( geometryNormal, directLight.direction ), geometryPosition, geometryNormal ) * directLight.color;")
    .replace("reflectedLight.directSpecular += irradiance * BRDF_GGX(", `reflectedLight.directSpecular += ${f(T.spec)} * toonRamp_( dotNL ) * toonSh_ * directLight.color * BRDF_GGX(`);
  C.lights_lambert_pars_fragment = C.lights_lambert_pars_fragment
    .replace("void RE_Direct_Lambert(", ramp + "void RE_Direct_Lambert(")
    .replace("vec3 irradiance = dotNL * directLight.color;", "vec3 irradiance = toonLit_( dot( geometryNormal, directLight.direction ), geometryPosition, geometryNormal ) * directLight.color;");
  // 太阳的影子不再乘到灯的颜色上，记到 toonSh_ 里，由上面的 toonLit_ 换成冷色
  const sh = "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ],";
  if (!C.lights_fragment_begin.includes(sh)) console.warn("toon：three 的灯光代码变了，影子没换成冷色");
  C.lights_fragment_begin = C.lights_fragment_begin
    .replace(sh, "toonTint_ = 1.0; toonSh_ = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ],")
    .replace(/(for \( int i = 0; i < NUM_DIR_LIGHTS; i \+\+ \) \{[\s\S]*?RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);)/, "$1\n\t\ttoonSh_ = 1.0; toonTint_ = 0.0;");
  // 影子：软边收成一小段，影子是一整块
  C.shadowmap_pars_fragment = C.shadowmap_pars_fragment.replaceAll("return mix( 1.0, shadow, shadowIntensity );", `return mix( 1.0, smoothstep( ${f(T.sh0)}, ${f(T.sh1)}, shadow ), shadowIntensity );`);
}

/** 树叶的颜色（world/trees.ts 的 LOOK 换成这一套）：暗部、中间、受光的顶，sRGB。B 的树是干净明亮的绿，暗部偏青；
 *  粉树原来是灰粉，被冷色的天光照成了紫球，换成暖一点、亮一点的樱花粉；对方的枫树是亮橙红 */
type RGB = [number, number, number];
export const TREE_B: Record<string, { dark: RGB; base: RGB; hi: RGB }[]> = {
  round: [{ dark: [0.1, 0.3, 0.2], base: [0.28, 0.52, 0.22], hi: [0.56, 0.74, 0.3] }, { dark: [0.08, 0.27, 0.22], base: [0.22, 0.47, 0.26], hi: [0.46, 0.68, 0.32] }],
  spire: [{ dark: [0.06, 0.2, 0.17], base: [0.15, 0.36, 0.25], hi: [0.32, 0.55, 0.3] }],
  bloom: [{ dark: [0.62, 0.38, 0.38], base: [0.94, 0.66, 0.64], hi: [1.0, 0.86, 0.8] }],
  maple: [{ dark: [0.42, 0.14, 0.07], base: [0.78, 0.34, 0.13], hi: [0.96, 0.62, 0.26] }, { dark: [0.32, 0.09, 0.07], base: [0.62, 0.22, 0.11], hi: [0.86, 0.42, 0.2] }],
};

/** 城墙外淡进去的颜色（已经过色调映射的 sRGB）：按河道两边分，我方深绿的林子，对方深红褐。vXZ 是地面的世界坐标 */
export const BG_B = "mix(vec3(0.115, 0.2, 0.13), vec3(0.26, 0.12, 0.08), smoothstep(-6.0, 6.0, (vXZ.x - vXZ.y) * 0.7071))";

/** 地面：贴图已经按 B 重画过（tools/map_ground_b.py），这里只混一层模糊的贴图，把近看时细碎的笔触再压一点。
 *  另外两件：① 水下的河底再糊一些（水越深越糊），河底的石头不再像一张清楚的拼图；② 一二十米大的冷暖光斑（亮处偏暖黄、暗处偏冷），
 *  B 的草地不是一块平涂的绿，是有大块的日光和阴凉的
 *  recolor 大于 0 时是 stylecost 的老办法：按饱和度把厚涂的地面贴图往 B 的颜色拉（长苔的石板会被当成草染绿，所以换了贴图就不用了） */
export const groundToonGLSL = () => !TOON_ON ? "" : `
  { vec3 c_ = tx_.rgb;
    // 模糊的那一层取整张图的总览贴图（约 10 像素/米，相当于细图缩小两级）：它是一整张，不像每块细图自己的缩小图那样在块和块的接缝上对不齐（水下糊得多的时候接缝会成一条条直线）。
    // 帧率：每个地面像素多取一两次贴图、多算几次噪声，拉远了看要掉 5% 上下的帧，所以 blur 默认关、水下的糊只在水里取，大块的冷暖光斑直接烘进了地面贴图（tools/map_ground_b.py 的 POOL）
    ${T.blur > 0 ? `c_ = mix(c_, texture2D(map, vMapUv, ${f(T.bias - 2)}).rgb, ${f(T.blur)});` : ""}
    if (dp_ > 0.0) c_ = mix(c_, texture2D(map, vMapUv, 1.5).rgb, dp_ * ${f(T.bedBlur)});
    ${T.pool > 0 ? `{ float lp_ = gn_(vXZ * 0.035 + 1.7) * 0.65 + gn_(vXZ * 0.09 + 5.3) * 0.35; c_ *= mix(vec3(${f(1 - T.pool)}, ${f(1 - T.pool * 0.6)}, 1.0), vec3(${f(1 + T.pool)}, ${f(1 + T.pool * 0.7)}, ${f(1 - T.pool * 0.2)}), smoothstep(0.25, 0.75, lp_)); }` : ""}
    ${T.recolor > 0 ? `{ vec3 g_ = sqrt(c_); float mx_ = max(g_.r, max(g_.g, g_.b)), mn_ = min(g_.r, min(g_.g, g_.b)), s_ = (mx_ - mn_) / max(mx_, 0.001), l_ = dot(g_, vec3(0.3, 0.59, 0.11));
      float side_ = smoothstep(-4.0, 4.0, (vXZ.x - vXZ.y) * 0.7071);
      float grass_ = smoothstep(0.28, 0.5, s_) * (1.0 - side_), red_ = smoothstep(0.3, 0.5, s_) * side_, stone_ = 1.0 - smoothstep(0.2, 0.42, s_);
      vec3 gB_ = vec3(0.21, 0.42, 0.10) * (0.7 + 0.6 * l_ / 0.42), rB_ = vec3(0.44, 0.11, 0.05) * (0.7 + 0.6 * l_ / 0.40), sB_ = mix(vec3(0.42, 0.44, 0.42), vec3(0.30, 0.25, 0.20), side_) * (0.3 + 1.3 * l_ / 0.40);
      vec3 o_ = mix(c_, gB_, grass_ * 0.85); o_ = mix(o_, rB_, red_ * 0.8); o_ = mix(o_, sB_, stone_ * 0.55 * (1.0 - dp_)); c_ = mix(c_, o_, ${f(T.recolor)}); }` : ""}
    diffuseColor.rgb = c_ * ${f(T.lift)}; diffuseColor.a = tx_.a; }`;
