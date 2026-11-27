"""场景材质：天空、湿沥青（带车道线）、人行道、楼体立面等。"""
import bpy, math
from common import *


def M(nt, op, a, b=None, c=None, clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def mixf(nt, a, b, t):
    """a*(1-t)+b*t，a/b/t 可以是数或接口。"""
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "FLOAT"
    for key, v in (("Factor", t), ("A", a), ("B", b)):
        s = n.inputs[key] if key == "Factor" else [i for i in n.inputs if i.name == key and i.type == "VALUE"][0]
        if isinstance(v, (int, float)):
            s.default_value = v
        else:
            nt.links.new(v, s)
    return [o for o in n.outputs if o.type == "VALUE"][0]


def mixc(nt, a, b, t, blend="MIX"):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = blend
    ins = {"Factor": n.inputs[0]}
    ins["A"] = [i for i in n.inputs if i.name == "A" and i.type == "RGBA"][0]
    ins["B"] = [i for i in n.inputs if i.name == "B" and i.type == "RGBA"][0]
    for key, v in (("Factor", t), ("A", a), ("B", b)):
        s = ins[key]
        if isinstance(v, (int, float)):
            s.default_value = v
        elif isinstance(v, tuple):
            s.default_value = (*v, 1) if len(v) == 3 else v
        else:
            nt.links.new(v, s)
    return [o for o in n.outputs if o.type == "RGBA"][0]


def ramp(nt, fac, stops, interp="LINEAR"):
    n = nt.nodes.new("ShaderNodeValToRGB")
    cr = n.color_ramp
    cr.interpolation = interp
    while len(cr.elements) < len(stops):
        cr.elements.new(0.5)
    for e, (p, col) in zip(cr.elements, stops):
        e.position = p
        e.color = (*col, 1) if len(col) == 3 else col
    nt.links.new(fac, n.inputs[0])
    return n.outputs[0]


# ---------------- 天空 ----------------
def setup_world(sc, strength=0.35, rot_deg=0.0, tint=(0.75, 0.85, 1.15)):
    w = bpy.data.worlds.new("night")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, 0, math.radians(rot_deg))
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = img(A("ph", "shanghai_bund", "shanghai_bund_4k.hdr"), "Linear Rec.709")
    mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    a = [i for i in mul.inputs if i.name == "A" and i.type == "RGBA"][0]
    b = [i for i in mul.inputs if i.name == "B" and i.type == "RGBA"][0]
    b.default_value = (*tint, 1)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    nt.links.new(mp.outputs[0], env.inputs["Vector"])
    nt.links.new(env.outputs[0], a)
    nt.links.new([o for o in mul.outputs if o.type == "RGBA"][0], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    w["bg_node"] = bg.name
    return w


# ---------------- 湿沥青 ----------------
def wet_asphalt(name, lanes=None, tex="asphalt_track", puddle=0.36, wet=0.55):
    """lanes: None 或 dict(lw=车道宽, n=单侧车道数, center='double'|'none', half=路缘到中线距离)
    车道线靠 UV 画：u = 离中线的横向距离(米，左正)，v = 沿路里程(米)。"""
    m, nt, out = new_mat(name)
    b = N(nt, "ShaderNodeBsdfPrincipled")
    L(nt, b.outputs[0], out.inputs["Surface"])
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping", inputs={"Scale": (0.42, 0.42, 0.42)})
    L(nt, tc.outputs["Object"], mp.inputs["Vector"])

    def tex_node(suffix, cs):
        t = N(nt, "ShaderNodeTexImage")
        t.image = img(A("ph", tex, f"{tex}_{suffix}_2k.jpg"), cs)
        L(nt, mp.outputs[0], t.inputs["Vector"])
        return t

    td = tex_node("diff", "sRGB"); tr = tex_node("rough", "Non-Color"); tn = tex_node("nor_gl", "Non-Color")

    # 水洼遮罩
    nz = N(nt, "ShaderNodeTexNoise", inputs={"Scale": 0.16, "Detail": 5.0, "Roughness": 0.6, "Distortion": 0.35})
    L(nt, tc.outputs["Object"], nz.inputs["Vector"])
    lo = 1.0 - puddle
    pud = ramp(nt, nz.outputs["Fac"], [(max(0.0, lo - 0.02), (0, 0, 0)), (min(1.0, lo + 0.07), (1, 1, 1))])
    nz2 = N(nt, "ShaderNodeTexNoise", inputs={"Scale": 1.3, "Detail": 3.0, "Roughness": 0.6})
    L(nt, tc.outputs["Object"], nz2.inputs["Vector"])
    damp = ramp(nt, nz2.outputs["Fac"], [(0.3, (0.35, 0.35, 0.35)), (0.7, (1, 1, 1))])

    base = mixc(nt, td.outputs["Color"], (0.0, 0.0, 0.0), mixf(nt, 0.50, 0.75, pud))
    rough = mixf(nt, M(nt, "MULTIPLY_ADD", tr.outputs["Color"], 0.5, 0.32), 0.04, pud)

    if lanes:
        uv = N(nt, "ShaderNodeUVMap"); uv.uv_map = "UVMap"
        sep = N(nt, "ShaderNodeSeparateXYZ"); L(nt, uv.outputs[0], sep.inputs[0])
        u, v = sep.outputs["X"], sep.outputs["Y"]
        au = M(nt, "ABSOLUTE", u)
        lw, n = lanes["lw"], lanes["n"]
        lt = 0.075   # 线半宽

        def near(dist_sock, hw):
            return M(nt, "LESS_THAN", dist_sock, hw)

        # 车道分隔虚线：|u| = k*lw, k=1..n-1
        k = M(nt, "DIVIDE", au, lw)
        d_near = M(nt, "MULTIPLY", M(nt, "ABSOLUTE", M(nt, "SUBTRACT", M(nt, "FRACT", M(nt, "ADD", k, 0.5)), 0.5)), lw)
        in_rng = M(nt, "MULTIPLY", M(nt, "GREATER_THAN", au, lw * 0.5), M(nt, "LESS_THAN", au, lw * (n - 0.5)))
        dash = M(nt, "LESS_THAN", M(nt, "FRACT", M(nt, "DIVIDE", v, 12.0)), 0.36)
        white = M(nt, "MULTIPLY", M(nt, "MULTIPLY", near(d_near, lt), in_rng), dash)
        # 边线
        edge = near(M(nt, "ABSOLUTE", M(nt, "SUBTRACT", au, lw * n)), lt)
        white = M(nt, "MAXIMUM", white, edge)
        yellow = None
        if lanes.get("center") == "double":
            yellow = near(M(nt, "ABSOLUTE", M(nt, "SUBTRACT", au, 0.16)), 0.06)
        elif lanes.get("center") == "dash":
            white = M(nt, "MAXIMUM", white, M(nt, "MULTIPLY", near(au, lt), dash))
        # 磨损
        wn = N(nt, "ShaderNodeTexNoise", inputs={"Scale": 7.0, "Detail": 4.0, "Roughness": 0.7})
        L(nt, tc.outputs["Object"], wn.inputs["Vector"])
        wear = ramp(nt, wn.outputs["Fac"], [(0.33, (0.25, 0.25, 0.25)), (0.55, (1, 1, 1))])
        white = M(nt, "MULTIPLY", white, wear)
        base = mixc(nt, base, (0.62, 0.62, 0.60), white)
        if yellow is not None:
            yellow = M(nt, "MULTIPLY", yellow, wear)
            base = mixc(nt, base, (0.75, 0.50, 0.04), yellow)
            paint = M(nt, "MAXIMUM", white, yellow)
        else:
            paint = white
        rough = mixf(nt, rough, M(nt, "MULTIPLY_ADD", pud, -0.3, 0.38), paint)

    L(nt, base, b.inputs["Base Color"])
    L(nt, rough, b.inputs["Roughness"])
    nm = N(nt, "ShaderNodeNormalMap")
    L(nt, tn.outputs["Color"], nm.inputs["Color"])
    L(nt, M(nt, "MULTIPLY_ADD", pud, -1.0, 1.0), nm.inputs["Strength"])
    L(nt, nm.outputs[0], b.inputs["Normal"])
    # 水膜：清漆层。潮湿处反射粗糙、被路面颗粒打碎；水洼处平整清晰
    L(nt, M(nt, "MULTIPLY", mixf(nt, wet, 1.0, pud), mixf(nt, damp, 1.0, pud)), b.inputs["Coat Weight"])
    L(nt, mixf(nt, 0.17, 0.02, pud), b.inputs["Coat Roughness"])
    b.inputs["Coat IOR"].default_value = 1.33
    nm2 = N(nt, "ShaderNodeNormalMap")
    L(nt, tn.outputs["Color"], nm2.inputs["Color"])
    L(nt, M(nt, "MULTIPLY_ADD", pud, -0.45, 0.45), nm2.inputs["Strength"])
    L(nt, nm2.outputs[0], b.inputs["Coat Normal"])
    return m


# ---------------- 通用小材质 ----------------
_cache = {}


def flat(name, color, rough=0.5, metal=0.0, coat=0.0):
    if name in _cache:
        return _cache[name]
    m, nt, out = new_mat(name)
    b = N(nt, "ShaderNodeBsdfPrincipled", inputs={"Base Color": (*color, 1), "Roughness": rough, "Metallic": metal, "Coat Weight": coat, "Coat Roughness": 0.05})
    L(nt, b.outputs[0], out.inputs["Surface"])
    _cache[name] = m
    return m


def emit(name, color, strength, sample=False):
    if name in _cache:
        return _cache[name]
    _cache[name] = emission_mat(name, color, strength, sample)
    return _cache[name]


def sign(file, strength):
    name = "sign_" + file
    if name in _cache:
        return _cache[name]
    m, nt, out = new_mat(name)
    t = N(nt, "ShaderNodeTexImage"); t.image = img(A("signs", file)); t.extension = "EXTEND"
    e = N(nt, "ShaderNodeEmission", inputs={"Strength": strength})
    L(nt, t.outputs["Color"], e.inputs["Color"])
    L(nt, e.outputs[0], out.inputs["Surface"])
    m.cycles.emission_sampling = "FRONT"
    _cache[name] = m
    return m


def chevron(name, file, strength=16.0, speed=0.045):
    """流动的导向箭头：贴图沿 u 方向随帧滚动。"""
    if name in _cache:
        return _cache[name]
    m, nt, out = new_mat(name)
    uv = N(nt, "ShaderNodeUVMap"); uv.uv_map = "UVMap"
    mp = N(nt, "ShaderNodeMapping")
    L(nt, uv.outputs[0], mp.inputs["Vector"])
    t = N(nt, "ShaderNodeTexImage"); t.image = img(A("signs", file))
    L(nt, mp.outputs[0], t.inputs["Vector"])
    e = N(nt, "ShaderNodeEmission", inputs={"Strength": strength})
    L(nt, t.outputs["Color"], e.inputs["Color"])
    L(nt, e.outputs[0], out.inputs["Surface"])
    fc = nt.driver_add(f'nodes["{mp.name}"].inputs[1].default_value', 0)
    fc.driver.type = "SCRIPTED"
    fc.driver.expression = f"-frame*{speed}"
    m.cycles.emission_sampling = "FRONT"
    _cache[name] = m
    return m


def comb(nt, x, y, z):
    c = nt.nodes.new("ShaderNodeCombineXYZ")
    for i, v in enumerate((x, y, z)):
        if isinstance(v, (int, float)):
            c.inputs[i].default_value = v
        else:
            nt.links.new(v, c.inputs[i])
    return c.outputs[0]


def wnoise(nt, x, y, z):
    w = nt.nodes.new("ShaderNodeTexWhiteNoise")
    w.noise_dimensions = "3D"
    nt.links.new(comb(nt, x, y, z), w.inputs["Vector"])
    return w.outputs["Value"], w.outputs["Color"]


def vscale(nt, col, fac):
    n = nt.nodes.new("ShaderNodeVectorMath"); n.operation = "SCALE"
    nt.links.new(col, n.inputs[0])
    if isinstance(fac, (int, float)):
        n.inputs["Scale"].default_value = fac
    else:
        nt.links.new(fac, n.inputs["Scale"])
    return n.outputs[0]


def vadd(nt, a, b):
    n = nt.nodes.new("ShaderNodeVectorMath"); n.operation = "ADD"
    nt.links.new(a, n.inputs[0]); nt.links.new(b, n.inputs[1])
    return n.outputs[0]


# ---------------- 楼体立面 ----------------
def facade(name, bw=3.2, fh=3.6, gh=5.0, mx=0.12, my0=0.25, my1=0.12, lit=(0.2, 0.5), mirror=False,
           wall=((0.025, 0.027, 0.032), (0.085, 0.075, 0.065)), glass=(0.012, 0.016, 0.024), win_gain=1.0, store_gain=1.0):
    """UV：u = 沿墙水平米数，v = 离地高度米数；rnd UV 给每栋楼两个随机数。"""
    if name in _cache:
        return _cache[name]
    m, nt, out = new_mat(name)
    b = N(nt, "ShaderNodeBsdfPrincipled"); L(nt, b.outputs[0], out.inputs["Surface"])
    uvn = N(nt, "ShaderNodeUVMap"); uvn.uv_map = "UVMap"
    su = N(nt, "ShaderNodeSeparateXYZ"); L(nt, uvn.outputs[0], su.inputs[0])
    u, v = su.outputs["X"], su.outputs["Y"]
    rn = N(nt, "ShaderNodeUVMap"); rn.uv_map = "rnd"
    sr = N(nt, "ShaderNodeSeparateXYZ"); L(nt, rn.outputs[0], sr.inputs[0])
    r1, r2 = sr.outputs["X"], sr.outputs["Y"]

    def band(x, lo, hi):
        return M(nt, "MULTIPLY", M(nt, "GREATER_THAN", x, lo), M(nt, "LESS_THAN", x, hi))

    ub = M(nt, "DIVIDE", u, bw); vb = M(nt, "DIVIDE", M(nt, "SUBTRACT", v, gh), fh)
    cu, cv = M(nt, "FLOOR", ub), M(nt, "FLOOR", vb)
    fu, fv = M(nt, "FRACT", ub), M(nt, "FRACT", vb)
    above = M(nt, "GREATER_THAN", v, gh)
    win = M(nt, "MULTIPLY", M(nt, "MULTIPLY", band(fu, mx, 1 - mx), band(fv, my0, 1 - my1)), above)
    seed = M(nt, "MULTIPLY", r1, 91.7)
    h1, hc = wnoise(nt, cu, cv, seed)
    sc_ = N(nt, "ShaderNodeSeparateColor"); L(nt, hc, sc_.inputs[0])
    h2, h3 = sc_.outputs[0], sc_.outputs[1]
    islit = M(nt, "LESS_THAN", h1, mixf(nt, lit[0], lit[1], r2))
    wcol = ramp(nt, h2, [(0.0, (1.0, 0.70, 0.40)), (0.40, (1.0, 0.84, 0.60)), (0.60, (0.70, 0.85, 1.0)), (0.84, (0.50, 0.72, 1.0)),
                         (0.92, (1.0, 0.25, 0.55)), (0.96, (0.15, 1.0, 0.9))], "CONSTANT")
    inten = M(nt, "MULTIPLY_ADD", M(nt, "POWER", h3, 2.0), 2.6, 0.45)
    sub, _ = wnoise(nt, M(nt, "ADD", M(nt, "FLOOR", M(nt, "MULTIPLY", fu, 3.0)), M(nt, "MULTIPLY", cu, 7.0)),
                    M(nt, "ADD", M(nt, "FLOOR", M(nt, "MULTIPLY", fv, 2.0)), M(nt, "MULTIPLY", cv, 13.0)), seed)
    ew = M(nt, "MULTIPLY", M(nt, "MULTIPLY", M(nt, "MULTIPLY", win, islit), inten), M(nt, "MULTIPLY_ADD", sub, 0.5 * win_gain, 0.5 * win_gain))
    emis = vscale(nt, wcol, ew)
    anywin = win
    if store_gain > 0:
        sb = M(nt, "DIVIDE", u, bw * 2)
        scu, sfu = M(nt, "FLOOR", sb), M(nt, "FRACT", sb)
        swin = M(nt, "MULTIPLY", band(sfu, 0.05, 0.95), band(v, 0.5, gh - 1.3))
        sh, shc = wnoise(nt, scu, seed, 3.3)
        ss = N(nt, "ShaderNodeSeparateColor"); L(nt, shc, ss.inputs[0])
        scol = ramp(nt, ss.outputs[0], [(0.0, (1.0, 0.80, 0.55)), (0.35, (0.80, 0.90, 1.0)), (0.60, (1.0, 0.30, 0.55)), (0.75, (0.25, 0.95, 1.0)),
                                         (0.88, (1.0, 0.55, 0.12))], "CONSTANT")
        sdet, _ = wnoise(nt, M(nt, "ADD", M(nt, "FLOOR", M(nt, "MULTIPLY", sfu, 5.0)), M(nt, "MULTIPLY", scu, 3.0)), M(nt, "FLOOR", M(nt, "DIVIDE", v, 0.9)), seed)
        es = M(nt, "MULTIPLY", M(nt, "MULTIPLY", swin, M(nt, "GREATER_THAN", sh, 0.2)), M(nt, "MULTIPLY_ADD", sdet, 0.65 * 3.2 * store_gain, 0.35 * 3.2 * store_gain))
        emis = vadd(nt, emis, vscale(nt, scol, es))
        anywin = M(nt, "MAXIMUM", win, swin)
    L(nt, emis, b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 1.0
    wallc = ramp(nt, r1, [(0.0, wall[0]), (1.0, wall[1])])
    gcol = (0.30, 0.36, 0.42) if mirror else glass
    L(nt, mixc(nt, wallc, gcol, anywin), b.inputs["Base Color"])
    L(nt, mixf(nt, 0.68, 0.06, anywin), b.inputs["Roughness"])
    if mirror:
        L(nt, M(nt, "MULTIPLY", anywin, 0.9), b.inputs["Metallic"])
    m.cycles.emission_sampling = "NONE"
    _cache[name] = m
    return m


def textured(name, tex, scale=0.5, coat=0.0, tint=1.0, rough_add=0.0):
    """用物体坐标 XY 平铺的 PBR 贴图材质（人行道、墙面）。"""
    if name in _cache:
        return _cache[name]
    m, nt, out = new_mat(name)
    b = N(nt, "ShaderNodeBsdfPrincipled"); L(nt, b.outputs[0], out.inputs["Surface"])
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping", inputs={"Scale": (scale, scale, scale)})
    L(nt, tc.outputs["Object"], mp.inputs["Vector"])

    def tn(suffix, cs):
        t = N(nt, "ShaderNodeTexImage"); t.image = img(A("ph", tex, f"{tex}_{suffix}_2k.jpg"), cs)
        t.projection = "BOX"; t.projection_blend = 0.2
        L(nt, mp.outputs[0], t.inputs["Vector"])
        return t

    td, tr, tnn = tn("diff", "sRGB"), tn("rough", "Non-Color"), tn("nor_gl", "Non-Color")
    L(nt, vscale(nt, td.outputs["Color"], tint), b.inputs["Base Color"])
    L(nt, M(nt, "ADD", tr.outputs["Color"], rough_add, clamp=True), b.inputs["Roughness"])
    nm = N(nt, "ShaderNodeNormalMap", inputs={"Strength": 0.7}); L(nt, tnn.outputs["Color"], nm.inputs["Color"])
    L(nt, nm.outputs[0], b.inputs["Normal"])
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.06
    _cache[name] = m
    return m


def tunnel_tile(name):
    if name in _cache:
        return _cache[name]
    m, nt, out = new_mat(name)
    b = N(nt, "ShaderNodeBsdfPrincipled"); L(nt, b.outputs[0], out.inputs["Surface"])
    uvn = N(nt, "ShaderNodeUVMap"); uvn.uv_map = "UVMap"
    su = N(nt, "ShaderNodeSeparateXYZ"); L(nt, uvn.outputs[0], su.inputs[0])
    br = N(nt, "ShaderNodeTexBrick", inputs={"Color1": (0.55, 0.56, 0.55, 1), "Color2": (0.46, 0.48, 0.48, 1), "Mortar": (0.08, 0.08, 0.08, 1),
                                             "Scale": 1.0, "Mortar Size": 0.012, "Brick Width": 0.6, "Row Height": 0.3})
    L(nt, comb(nt, su.outputs["Y"], su.outputs["X"], 0.0), br.inputs["Vector"])
    L(nt, br.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.16
    _cache[name] = m
    return m


def water(name="water"):
    if name in _cache:
        return _cache[name]
    m, nt, out = new_mat(name)
    b = N(nt, "ShaderNodeBsdfPrincipled", inputs={"Base Color": (0.004, 0.008, 0.014, 1), "Roughness": 0.07})
    L(nt, b.outputs[0], out.inputs["Surface"])
    tc = N(nt, "ShaderNodeTexCoord")
    mp = N(nt, "ShaderNodeMapping", inputs={"Scale": (0.25, 0.08, 0.25)})
    L(nt, tc.outputs["Object"], mp.inputs["Vector"])
    nz = N(nt, "ShaderNodeTexNoise", inputs={"Scale": 1.0, "Detail": 4.0, "Roughness": 0.6})
    L(nt, mp.outputs[0], nz.inputs["Vector"])
    bp = N(nt, "ShaderNodeBump", inputs={"Strength": 0.35, "Distance": 1.0})
    L(nt, nz.outputs["Fac"], bp.inputs["Height"]); L(nt, bp.outputs[0], b.inputs["Normal"])
    _cache[name] = m
    return m


# ---------------- 真实照片立面（ambientCG Facade 系列） ----------------
def _acg(fid, suffix):
    import glob
    g = glob.glob(A("acg", fid, f"{fid}_2K-JPG_{suffix}.jpg"))
    return g[0] if g else None


def storefront(nt, u, v, r1, gh, gain=1.0):
    """底商：立柱 + 玻璃橱窗 + 竖梃。约三分之一拉下卷帘门；开着的店里是上亮下暗的室内光加一排顶灯。
    返回 (发光颜色, 是否玻璃, 是否底层)。"""
    bay = 5.4
    sb = M(nt, "ADD", M(nt, "DIVIDE", u, bay), M(nt, "MULTIPLY", r1, 3.0))
    scu, sfu = M(nt, "FLOOR", sb), M(nt, "FRACT", sb)
    notpier = M(nt, "MULTIPLY", M(nt, "GREATER_THAN", sfu, 0.07), M(nt, "LESS_THAN", sfu, 0.93))
    band = M(nt, "MULTIPLY", M(nt, "GREATER_THAN", v, 0.5), M(nt, "LESS_THAN", v, gh - 1.15))
    mull = M(nt, "GREATER_THAN", M(nt, "FRACT", M(nt, "MULTIPLY", sfu, 4.0)), 0.035)
    transom = M(nt, "GREATER_THAN", M(nt, "ABSOLUTE", M(nt, "SUBTRACT", v, gh - 2.0)), 0.04)
    seed = M(nt, "MULTIPLY", r1, 57.3)
    sh, shc = wnoise(nt, scu, seed, 3.3)
    ss = N(nt, "ShaderNodeSeparateColor"); L(nt, shc, ss.inputs[0])
    is_open = M(nt, "GREATER_THAN", sh, 0.36)
    glass = M(nt, "MULTIPLY", M(nt, "MULTIPLY", M(nt, "MULTIPLY", notpier, band), M(nt, "MULTIPLY", mull, transom)), is_open)
    scol = ramp(nt, ss.outputs[0], [(0.0, (1.0, 0.76, 0.50)), (0.42, (0.88, 0.93, 1.0)), (0.74, (1.0, 0.62, 0.32)), (0.90, (1.0, 0.45, 0.60)),
                                     (0.95, (0.45, 0.9, 1.0))], "CONSTANT")
    vn = M(nt, "DIVIDE", v, gh)
    nz = N(nt, "ShaderNodeTexNoise", inputs={"Scale": 1.0, "Detail": 3.0, "Roughness": 0.7})
    L(nt, comb(nt, M(nt, "MULTIPLY", u, 2.3), M(nt, "MULTIPLY", v, 1.5), seed), nz.inputs["Vector"])
    # 室内：下半截是货架/人影的暗块，上半截亮一些
    sil = M(nt, "MULTIPLY_ADD", nz.outputs["Fac"], 2.2, -0.62, clamp=True)
    interior = M(nt, "MULTIPLY", M(nt, "MULTIPLY_ADD", vn, 0.50, 0.06), mixf(nt, sil, 1.0, M(nt, "MULTIPLY_ADD", vn, 1.6, -0.35, clamp=True)))
    # 一排筒灯
    du = M(nt, "ABSOLUTE", M(nt, "SUBTRACT", M(nt, "FRACT", M(nt, "MULTIPLY", sfu, 6.0)), 0.5))
    dots = M(nt, "MULTIPLY", M(nt, "LESS_THAN", du, 0.11), M(nt, "LESS_THAN", M(nt, "ABSOLUTE", M(nt, "SUBTRACT", vn, 0.69)), 0.022))
    bright = M(nt, "MULTIPLY_ADD", ss.outputs[1], 0.7 * gain, 0.35 * gain)
    es = M(nt, "MULTIPLY", glass, M(nt, "MULTIPLY", M(nt, "MULTIPLY_ADD", dots, 7.0, interior), bright))
    ground = M(nt, "LESS_THAN", v, gh)
    return vscale(nt, scol, es), M(nt, "MULTIPLY", glass, ground), ground


def facade_tex(name, fid, floors, fh=3.7, gh=5.0, gain=2.5, metal_windows=False, tint=1.0, store_gain=1.0):
    if name in _cache:
        return _cache[name]
    m, nt, out = new_mat(name)
    b = N(nt, "ShaderNodeBsdfPrincipled"); L(nt, b.outputs[0], out.inputs["Surface"])
    uvn = N(nt, "ShaderNodeUVMap"); uvn.uv_map = "UVMap"
    su = N(nt, "ShaderNodeSeparateXYZ"); L(nt, uvn.outputs[0], su.inputs[0])
    u, v = su.outputs["X"], su.outputs["Y"]
    rn = N(nt, "ShaderNodeUVMap"); rn.uv_map = "rnd"
    sr = N(nt, "ShaderNodeSeparateXYZ"); L(nt, rn.outputs[0], sr.inputs[0])
    r1, r2 = sr.outputs["X"], sr.outputs["Y"]
    tile = floors * fh
    uo = M(nt, "ADD", M(nt, "DIVIDE", u, tile), M(nt, "MULTIPLY", r1, 5.37))
    vo = M(nt, "ADD", M(nt, "DIVIDE", M(nt, "SUBTRACT", v, gh), tile), M(nt, "DIVIDE", M(nt, "FLOOR", M(nt, "MULTIPLY", r2, float(floors))), float(floors)))
    vec = comb(nt, uo, vo, 0.0)

    def tex(suffix, cs):
        path = _acg(fid, suffix)
        if not path:
            return None
        t = N(nt, "ShaderNodeTexImage"); t.image = img(path, cs)
        L(nt, vec, t.inputs["Vector"])
        return t

    tc, tr, tn, te, tm = tex("Color", "sRGB"), tex("Roughness", "Non-Color"), tex("NormalGL", "Non-Color"), tex("Emission", "sRGB"), tex("Metalness", "Non-Color")
    emis_s, sglass, ground = storefront(nt, u, v, r1, gh, store_gain)
    upper = M(nt, "SUBTRACT", 1.0, ground)
    base = vscale(nt, tc.outputs["Color"], tint)
    wallc = ramp(nt, r1, [(0.0, (0.022, 0.022, 0.026)), (1.0, (0.06, 0.05, 0.045))])
    base = mixc(nt, base, wallc, ground)
    base = mixc(nt, base, (0.012, 0.016, 0.022), sglass)
    L(nt, base, b.inputs["Base Color"])
    rough = tr.outputs["Color"] if tr else 0.5
    L(nt, mixf(nt, mixf(nt, rough, 0.55, ground), 0.05, sglass), b.inputs["Roughness"])
    if tm:
        L(nt, M(nt, "MULTIPLY", tm.outputs["Color"], upper), b.inputs["Metallic"])
    if tn:
        nm = N(nt, "ShaderNodeNormalMap"); L(nt, tn.outputs["Color"], nm.inputs["Color"])
        L(nt, upper, nm.inputs["Strength"])
        L(nt, nm.outputs[0], b.inputs["Normal"])
    # 楼上窗户的灯光
    bgain = M(nt, "MULTIPLY_ADD", r2, 0.9, 0.45)
    if metal_windows and tm:
        cu = M(nt, "FLOOR", M(nt, "MULTIPLY", uo, float(floors)))
        cv = M(nt, "FLOOR", M(nt, "MULTIPLY", vo, float(floors)))
        h1, hc = wnoise(nt, cu, cv, M(nt, "MULTIPLY", r1, 91.7))
        sc_ = N(nt, "ShaderNodeSeparateColor"); L(nt, hc, sc_.inputs[0])
        islit = M(nt, "LESS_THAN", h1, mixf(nt, 0.18, 0.5, r2))
        wcol = ramp(nt, sc_.outputs[0], [(0.0, (1.0, 0.66, 0.36)), (0.5, (1.0, 0.82, 0.58)), (0.78, (0.72, 0.86, 1.0)), (0.93, (1.0, 0.3, 0.55))], "CONSTANT")
        nz = N(nt, "ShaderNodeTexNoise", inputs={"Scale": 1.0, "Detail": 2.0})
        L(nt, comb(nt, M(nt, "MULTIPLY", u, 2.2), M(nt, "MULTIPLY", v, 1.6), 0.0), nz.inputs["Vector"])
        ew = M(nt, "MULTIPLY", M(nt, "MULTIPLY", tm.outputs["Color"], islit), M(nt, "MULTIPLY", M(nt, "MULTIPLY_ADD", nz.outputs["Fac"], 1.2, 0.2), M(nt, "MULTIPLY", upper, gain * 0.5)))
        emis_u = vscale(nt, wcol, M(nt, "MULTIPLY", ew, bgain))
    elif te:
        # 大尺度噪声把成片的灯关掉一些，避免贴图重复感
        nz = N(nt, "ShaderNodeTexNoise", inputs={"Scale": 1.0, "Detail": 1.0})
        L(nt, comb(nt, M(nt, "MULTIPLY", u, 0.05), M(nt, "MULTIPLY", v, 0.07), M(nt, "MULTIPLY", r1, 40.0)), nz.inputs["Vector"])
        msk = M(nt, "MULTIPLY_ADD", nz.outputs["Fac"], 2.4, -0.55, clamp=True)
        emis_u = vscale(nt, te.outputs["Color"], M(nt, "MULTIPLY", M(nt, "MULTIPLY", upper, msk), M(nt, "MULTIPLY", bgain, gain)))
    else:
        emis_u = None
    emis = vadd(nt, emis_u, emis_s) if emis_u is not None else emis_s
    L(nt, emis, b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 1.0
    m.cycles.emission_sampling = "NONE"
    _cache[name] = m
    return m


def get(name):
    """按名字取材质（首次调用时创建）。"""
    if name in _cache:
        return _cache[name]
    F = {
        "roof": lambda: flat("roof", (0.02, 0.02, 0.022), 0.8),
        "fac_glass_a": lambda: facade("fac_glass_a", bw=1.9, fh=4.0, gh=6.0, mx=0.03, my0=0.10, my1=0.0, lit=(0.10, 0.34), mirror=True, win_gain=0.9),
        "fac_glass_b": lambda: facade("fac_glass_b", bw=2.6, fh=3.8, gh=5.5, mx=0.05, my0=0.22, my1=0.0, lit=(0.15, 0.45), mirror=True, win_gain=1.0,
                                      wall=((0.02, 0.025, 0.035), (0.05, 0.06, 0.08))),
        "fac_office": lambda: facade("fac_office", bw=3.4, fh=3.7, gh=5.2, mx=0.10, my0=0.30, my1=0.10, lit=(0.18, 0.5)),
        "fac_apart": lambda: facade("fac_apart", bw=3.0, fh=3.1, gh=4.6, mx=0.22, my0=0.30, my1=0.18, lit=(0.28, 0.6), win_gain=1.1,
                                    wall=((0.05, 0.045, 0.04), (0.12, 0.10, 0.085))),
        "fac_apart_b": lambda: facade("fac_apart_b", bw=2.4, fh=3.0, gh=4.4, mx=0.18, my0=0.34, my1=0.16, lit=(0.3, 0.65), win_gain=1.1,
                                      wall=((0.04, 0.05, 0.055), (0.10, 0.07, 0.06))),
        "fac_shop": lambda: facade("fac_shop", bw=3.6, fh=3.4, gh=4.6, mx=0.08, my0=0.24, my1=0.08, lit=(0.35, 0.7), win_gain=1.2, store_gain=1.3,
                                   wall=((0.06, 0.05, 0.05), (0.10, 0.09, 0.10))),
        "ft_007": lambda: facade_tex("ft_007", "Facade007", 24, 3.9, gh=6.0, gain=2.6),
        "ft_008": lambda: facade_tex("ft_008", "Facade008", 40, 3.9, gh=6.0, gain=3.2),
        "ft_009": lambda: facade_tex("ft_009", "Facade009", 16, 3.9, gh=6.0, gain=2.4),
        "ft_010": lambda: facade_tex("ft_010", "Facade010", 56, 3.4, gh=5.5, gain=2.2),
        "ft_011": lambda: facade_tex("ft_011", "Facade011", 40, 3.9, gh=6.0, gain=3.2),
        "ft_012": lambda: facade_tex("ft_012", "Facade012", 32, 3.2, gh=5.0, gain=3.0, tint=0.55),
        "ft_013": lambda: facade_tex("ft_013", "Facade013", 32, 3.2, gh=5.0, gain=2.4, tint=0.5),
        "ft_015": lambda: facade_tex("ft_015", "Facade015", 32, 3.2, gh=5.0, gain=3.0, tint=0.4),
        "ft_016": lambda: facade_tex("ft_016", "Facade016", 32, 3.2, gh=5.0, gain=3.0, tint=0.7),
        "ft_017": lambda: facade_tex("ft_017", "Facade017", 12, 3.8, gh=5.0, gain=2.2, tint=0.6),
        "ft_018": lambda: facade_tex("ft_018", "Facade018A", 6, 3.5, gh=4.6, gain=2.6, metal_windows=True, tint=0.55, store_gain=1.2),
        "ft_019": lambda: facade_tex("ft_019", "Facade019A", 6, 3.6, gh=4.6, gain=2.6, metal_windows=True, tint=0.55, store_gain=1.2),
        "ft_020": lambda: facade_tex("ft_020", "Facade020A", 6, 3.5, gh=4.6, gain=2.6, metal_windows=True, tint=0.55, store_gain=1.2),
        "emit_red": lambda: emit("emit_red", (1.0, 0.05, 0.03), 12.0),
        "sign_frame": lambda: flat("sign_frame", (0.015, 0.015, 0.018), 0.4, 0.7),
        "sidewalk": lambda: textured("sidewalk", "concrete_tiles_02", scale=0.4, coat=0.45, tint=0.55),
        "concrete": lambda: textured("concrete", "concrete_slab_wall_02", scale=0.25, coat=0.15, tint=0.5),
        "curb": lambda: flat("curb", (0.11, 0.11, 0.105), 0.55, coat=0.3),
        "metal_dark": lambda: flat("metal_dark", (0.03, 0.032, 0.036), 0.4, 0.9),
        "metal_light": lambda: flat("metal_light", (0.45, 0.47, 0.5), 0.3, 1.0),
        "paint_white": lambda: flat("paint_white", (0.30, 0.30, 0.29), 0.45, coat=0.5),
        "barrier_red": lambda: flat("barrier_red", (0.55, 0.03, 0.02), 0.35, coat=0.6),
        "barrier_white": lambda: flat("barrier_white", (0.6, 0.6, 0.6), 0.35, coat=0.6),
        "tunnel_tile": lambda: tunnel_tile("tunnel_tile"),
        "tunnel_dark": lambda: flat("tunnel_dark", (0.02, 0.02, 0.022), 0.6),
        "water": lambda: water(),
    }
    return F[name]()
