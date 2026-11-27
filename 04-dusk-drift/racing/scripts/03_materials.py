# 赛道环境材质：半湿沥青、路肩、草地、砾石、护栏、轮胎墙；以及天空方向
import bpy, math, os, sys, importlib

ROOT = "/Users/jadon7/Library/Application Support/Claude/scratch-workspaces/dfe2b44a-8503-4a5e-af9b-63b1be0e053b/aae3434b-694f-413f-a991-1f79c427025e/scratch-2026-11-21-ab6c85/racing"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import track_def as T
import motion as M
importlib.reload(T); importlib.reload(M)
TEX = os.path.join(ROOT, "assets/tex")
D = bpy.data.objects
HW = T.HALF_W


def texpath(aid, kind, res):
    return os.path.join(TEX, aid, f"{aid}_{kind}_{res}.jpg")


class NB:
    """小型节点搭建助手"""
    def __init__(self, name):
        mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        mat.use_nodes = True
        self.mat = mat
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.out = self.nt.nodes.new("ShaderNodeOutputMaterial")
        self.bsdf = self.nt.nodes.new("ShaderNodeBsdfPrincipled")
        self.nt.links.new(self.bsdf.outputs[0], self.out.inputs["Surface"])

    def node(self, typ, **props):
        n = self.nt.nodes.new(typ)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def _set(self, sock, v):
        if hasattr(v, "is_linked") or hasattr(v, "node"):
            self.nt.links.new(v, sock)
        else:
            sock.default_value = v

    def math(self, op, a, b=None, c=None, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        self._set(n.inputs[0], a)
        if b is not None:
            self._set(n.inputs[1], b)
        if c is not None:
            self._set(n.inputs[2], c)
        return n.outputs[0]

    def maprange(self, x, a, b, to0=0.0, to1=1.0, smooth=True):
        n = self.node("ShaderNodeMapRange")
        n.interpolation_type = 'SMOOTHSTEP' if smooth else 'LINEAR'
        self._set(n.inputs[0], x)
        n.inputs[1].default_value = a
        n.inputs[2].default_value = b
        n.inputs[3].default_value = to0
        n.inputs[4].default_value = to1
        return n.outputs[0]

    def mix(self, fac, a, b, blend='MIX'):
        n = self.node("ShaderNodeMix", data_type='RGBA', blend_type=blend)
        n.clamp_factor = True
        self._set(n.inputs[0], fac)
        self._set(n.inputs[6], a if not isinstance(a, tuple) else (*a, 1.0)[:4])
        self._set(n.inputs[7], b if not isinstance(b, tuple) else (*b, 1.0)[:4])
        return n.outputs[2]

    def mixf(self, fac, a, b):
        n = self.node("ShaderNodeMix", data_type='FLOAT')
        n.clamp_factor = True
        self._set(n.inputs[0], fac)
        self._set(n.inputs[2], a)
        self._set(n.inputs[3], b)
        return n.outputs[0]

    def uv(self, name="UVm"):
        return self.node("ShaderNodeUVMap", uv_map=name).outputs[0]

    def mapping(self, vec, scale=(1, 1, 1), rot_z=0.0, loc=(0, 0, 0)):
        n = self.node("ShaderNodeMapping")
        self.nt.links.new(vec, n.inputs["Vector"])
        n.inputs["Scale"].default_value = scale
        n.inputs["Rotation"].default_value = (0, 0, rot_z)
        n.inputs["Location"].default_value = loc
        return n.outputs[0]

    def noise(self, vec, scale, detail=2.0, rough=0.5, distortion=0.0, out="Factor"):
        n = self.node("ShaderNodeTexNoise")
        self.nt.links.new(vec, n.inputs["Vector"])
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Distortion"].default_value = distortion
        try:
            return n.outputs[out]
        except KeyError:
            return n.outputs[0]

    def tex(self, path, vec, non_color=False):
        img = bpy.data.images.load(path, check_existing=True)
        if non_color:
            img.colorspace_settings.name = 'Non-Color'
        n = self.node("ShaderNodeTexImage", image=img)
        n.extension = 'REPEAT'
        self.nt.links.new(vec, n.inputs["Vector"])
        return n.outputs["Color"]

    def normalmap(self, color, strength=1.0):
        n = self.node("ShaderNodeNormalMap")
        self.nt.links.new(color, n.inputs["Color"])
        self._set(n.inputs["Strength"], strength)
        return n.outputs[0]

    def bump(self, height, strength=0.3, distance=0.01, normal=None):
        n = self.node("ShaderNodeBump")
        self.nt.links.new(height, n.inputs["Height"])
        n.inputs["Strength"].default_value = strength
        n.inputs["Distance"].default_value = distance
        if normal is not None:
            self.nt.links.new(normal, n.inputs["Normal"])
        return n.outputs[0]

    def sep(self, vec):
        n = self.node("ShaderNodeSeparateXYZ")
        self.nt.links.new(vec, n.inputs[0])
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def attr(self, name):
        return self.node("ShaderNodeAttribute", attribute_name=name).outputs["Fac"]

    def set(self, inp, v):
        self._set(self.bsdf.inputs[inp], v)


def assign(ob_name, mat):
    ob = D[ob_name]
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# ----------------------------------------------------------------------------- 路面顶点属性：橡胶线（干燥线）
def bake_rubber():
    ob = D["TrackSurface"]
    me = ob.data
    at = me.attributes.get("rubber") or me.attributes.new("rubber", 'FLOAT', 'POINT')
    uvl = me.uv_layers["UVm"]
    vuv = {}
    for li, loop in enumerate(me.loops):
        vuv[loop.vertex_index] = uvl.data[li].uv
    lines = [(M.PLANS['E30']['line'], 1.0), (M.PLANS['CAPRI']['line'], 0.6), (M.PLANS['E30B']['line'], 0.6), (M.PLANS['STRATOS']['line'], 0.5)]
    vals = [0.0] * len(me.vertices)
    for vi, uv in vuv.items():
        d, s = uv[0], uv[1]
        r = 0.0
        for line, wgt in lines:
            dl = M.hermite(line, s)
            r = max(r, wgt * math.exp(-((d - dl) / 1.5) ** 2))
        vals[vi] = r
    at.data.foreach_set("value", vals)
    me.update()


bake_rubber()

# ----------------------------------------------------------------------------- 沥青
def make_asphalt():
    b = NB("M_Asphalt")
    uv = b.uv()
    d, s, _ = b.sep(uv)
    uvA = b.mapping(uv, scale=(0.5, 0.5, 1))
    uvB = b.mapping(uv, scale=(0.37, 0.37, 1), rot_z=math.radians(31), loc=(0.3, 0.7, 0))
    dA = b.tex(texpath("asphalt_track", "diff", "4k"), uvA)
    dB = b.tex(texpath("asphalt_pit_lane", "diff", "2k"), uvB)
    rA = b.tex(texpath("asphalt_track", "rough", "4k"), uvA, True)
    nA = b.tex(texpath("asphalt_track", "nor_gl", "4k"), uvA, True)
    big = b.noise(uv, 0.035, detail=3.0, rough=0.6, distortion=0.4)
    mid = b.noise(uv, 0.22, detail=4.0, rough=0.65)
    patch = b.maprange(big, 0.42, 0.62)
    col = b.mix(b.math('MULTIPLY', patch, 0.45), dA, dB)
    # 整体明暗起伏
    var = b.maprange(mid, 0.3, 0.75, 0.80, 1.12)
    col = b.mix(1.0, col, var, 'MULTIPLY')
    # 橡胶线：更暗更平
    rub = b.attr("rubber")
    streak_uv = b.mapping(uv, scale=(2.6, 0.035, 1))
    streak = b.maprange(b.noise(streak_uv, 1.0, detail=3.0, rough=0.7), 0.35, 0.75)
    rubm = b.math('MULTIPLY', rub, b.maprange(streak, 0.0, 1.0, 0.55, 1.0), clamp=True)
    col = b.mix(b.math('MULTIPLY', rubm, 0.55), col, (0.012, 0.012, 0.013), 'MIX')
    # 细长旧胎痕
    tm_uv = b.mapping(uv, scale=(7.0, 0.02, 1), loc=(3.1, 0.0, 0))
    tmark = b.maprange(b.noise(tm_uv, 1.0, detail=1.0, rough=0.5), 0.68, 0.74)
    tmark = b.math('MULTIPLY', tmark, b.maprange(rub, 0.05, 0.5), clamp=True)
    col = b.mix(b.math('MULTIPLY', tmark, 0.7), col, (0.008, 0.008, 0.008))
    # 白色边线
    ad = b.math('ABSOLUTE', d)
    edge_n = b.noise(uv, 9.0, detail=3.0, rough=0.7)
    line_c = b.math('ABSOLUTE', b.math('SUBTRACT', ad, HW - 0.32))
    line = b.maprange(line_c, 0.065, 0.085, 1.0, 0.0)
    wear = b.maprange(edge_n, 0.38, 0.62, 0.35, 1.0)
    line = b.math('MULTIPLY', line, wear, clamp=True)
    col = b.mix(line, col, (0.62, 0.62, 0.60))
    # ---- 湿度
    wn = b.noise(uv, 0.075, detail=4.0, rough=0.62, distortion=0.8)
    wet = b.maprange(wn, 0.44, 0.62)
    edge_bias = b.maprange(ad, 3.2, 5.4, 0.0, 0.35)
    wet = b.math('ADD', wet, edge_bias, clamp=True)
    dry = b.maprange(rubm, 0.15, 0.85, 1.0, 0.18)
    wet = b.math('MULTIPLY', wet, dry, clamp=True)
    pn = b.noise(b.mapping(uv, loc=(11.3, 4.1, 0)), 0.19, detail=3.0, rough=0.55, distortion=0.5)
    puddle = b.maprange(pn, 0.648, 0.685)
    puddle = b.math('MULTIPLY', puddle, b.maprange(rubm, 0.1, 0.5, 1.0, 0.0), clamp=True)
    # 路缘附近更容易积水：再叠一层只在两侧出现的浅水洼
    pn2 = b.noise(b.mapping(uv, scale=(1.0, 0.55, 1.0), loc=(3.7, 19.1, 0)), 0.16, detail=3.0, rough=0.55, distortion=0.7)
    puddle2 = b.math('MULTIPLY', b.maprange(pn2, 0.575, 0.615), b.maprange(ad, 2.7, 4.3), clamp=True)
    puddle2 = b.math('MULTIPLY', puddle2, b.maprange(rubm, 0.15, 0.6, 1.0, 0.0), clamp=True)
    puddle = b.math('MAXIMUM', puddle, puddle2)
    # 潮湿让底色更深
    col = b.mix(b.math('MULTIPLY', wet, 0.42), col, (0.0, 0.0, 0.0))
    col = b.mix(b.math('MULTIPLY', puddle, 0.45), col, (0.0, 0.0, 0.0))
    b.set("Base Color", col)
    rough = b.maprange(rA, 0.0, 1.0, 0.55, 0.95, smooth=False)
    rough = b.mixf(b.math('MULTIPLY', wet, 0.6), rough, 0.42)
    rough = b.mixf(line, rough, 0.5)
    b.set("Roughness", rough)
    nstr = b.mixf(puddle, b.mixf(wet, 1.0, 0.55), 0.03)
    b.set("Normal", b.normalmap(nA, nstr))
    # 水膜用清漆层表现
    coat = b.math('MAXIMUM', b.math('MULTIPLY', wet, 0.62), puddle)
    b.set("Coat Weight", coat)
    b.set("Coat Roughness", b.mixf(puddle, 0.21, 0.008))
    b.bsdf.inputs["Coat IOR"].default_value = 1.33
    b.set("Coat Normal", b.normalmap(nA, b.mixf(puddle, 0.55, 0.0)))
    return b.mat


# ----------------------------------------------------------------------------- 路肩
def make_kerb():
    b = NB("M_Kerb")
    uv = b.uv()
    d, s, _ = b.sep(uv)
    blk = b.math('FRACT', b.math('MULTIPLY', s, 1.0 / 4.0))
    red = b.maprange(blk, 0.49, 0.51, 0.0, 1.0)
    n1 = b.noise(uv, 3.5, detail=5.0, rough=0.7)
    n2 = b.noise(uv, 0.4, detail=3.0, rough=0.6)
    paint = b.mix(red, (0.74, 0.74, 0.71), (0.50, 0.035, 0.03))
    conc_uv = b.mapping(uv, scale=(0.5, 0.5, 1))
    conc = b.tex(texpath("painted_concrete", "diff", "2k"), conc_uv)
    concg = b.mix(1.0, conc, (0.55, 0.55, 0.53), 'COLOR')      # 去掉贴图原有的绿色
    chip = b.maprange(n1, 0.60, 0.70)
    col = b.mix(b.math('MULTIPLY', chip, 0.8), paint, concg)
    # 轮胎蹭痕
    st_uv = b.mapping(uv, scale=(5.0, 0.05, 1))
    st = b.maprange(b.noise(st_uv, 1.0, detail=2.0, rough=0.6), 0.5, 0.75)
    col = b.mix(b.math('MULTIPLY', st, 0.6), col, (0.02, 0.02, 0.02))
    col = b.mix(1.0, col, b.maprange(n2, 0.3, 0.8, 0.75, 1.05), 'MULTIPLY')
    b.set("Base Color", col)
    b.set("Roughness", b.maprange(n1, 0.3, 0.7, 0.35, 0.6))
    nm = b.tex(texpath("painted_concrete", "nor_gl", "2k"), conc_uv, True)
    b.set("Normal", b.normalmap(nm, 0.6))
    b.set("Coat Weight", b.maprange(n2, 0.35, 0.6, 0.15, 0.8))
    b.bsdf.inputs["Coat Roughness"].default_value = 0.06
    b.bsdf.inputs["Coat IOR"].default_value = 1.33
    return b.mat


# ----------------------------------------------------------------------------- 草地
def make_grass():
    b = NB("M_Grass")
    uv = b.uv()
    uvA = b.mapping(uv, scale=(0.5, 0.5, 1))
    uvB = b.mapping(uv, scale=(0.137, 0.137, 1), rot_z=math.radians(57))
    uvC = b.mapping(uv, scale=(0.5, 0.5, 1), rot_z=math.radians(20), loc=(0.4, 0.1, 0))
    gA = b.tex(texpath("leafy_grass", "diff", "2k"), uvA)
    gB = b.tex(texpath("leafy_grass", "diff", "2k"), uvB)
    gC = b.tex(texpath("sparse_grass", "diff", "2k"), uvC)
    n_big = b.noise(uv, 0.012, detail=4.0, rough=0.6, distortion=0.5)
    n_mid = b.noise(uv, 0.08, detail=4.0, rough=0.65)
    col = b.mix(0.5, gA, gB)
    col = b.mix(b.maprange(n_mid, 0.62, 0.78, 0.0, 0.35), col, gC)
    tint = b.mix(b.maprange(n_big, 0.35, 0.7), (0.20, 0.50, 0.09), (0.36, 0.56, 0.12))
    col = b.mix(1.0, col, tint, 'MULTIPLY')
    col = b.mix(1.0, col, b.maprange(n_mid, 0.25, 0.8, 0.62, 1.15), 'MULTIPLY')
    b.set("Base Color", col)
    b.bsdf.inputs["Roughness"].default_value = 0.62
    nm = b.tex(texpath("leafy_grass", "nor_gl", "2k"), uvA, True)
    b.set("Normal", b.normalmap(nm, 1.6))
    b.bsdf.inputs["Coat Weight"].default_value = 0.0
    b.bsdf.inputs["IOR"].default_value = 1.0          # 草地不要掠射角高光，否则远看发白
    try:
        b.bsdf.inputs["Specular IOR Level"].default_value = 0.0
    except KeyError:
        pass
    try:
        b.bsdf.inputs["Sheen Weight"].default_value = 0.25
        b.bsdf.inputs["Sheen Roughness"].default_value = 0.5
    except KeyError:
        pass
    return b.mat


# ----------------------------------------------------------------------------- 砾石
def make_gravel():
    b = NB("M_Gravel")
    uv = b.uv()
    uvA = b.mapping(uv, scale=(0.5, 0.5, 1))
    uvB = b.mapping(uv, scale=(0.29, 0.29, 1), rot_z=math.radians(43))
    gA = b.tex(texpath("gravel_floor_02", "diff", "2k"), uvA)
    gB = b.tex(texpath("gravel_floor_02", "diff", "2k"), uvB)
    n = b.noise(uv, 0.1, detail=4.0, rough=0.6)
    col = b.mix(b.maprange(n, 0.4, 0.6), gA, gB)
    col = b.mix(1.0, col, (0.52, 0.48, 0.42), 'MULTIPLY')
    # 耙过的沟纹
    d_, s_, _z = b.sep(uv)
    rake = b.math('SINE', b.math('MULTIPLY', d_, 2 * math.pi / 0.42))
    col = b.mix(1.0, col, b.maprange(rake, -1.0, 1.0, 0.86, 1.06), 'MULTIPLY')
    wet = b.maprange(b.noise(uv, 0.06, detail=3.0, rough=0.6, distortion=0.4), 0.42, 0.62)
    col = b.mix(b.math('MULTIPLY', wet, 0.4), col, (0.0, 0.0, 0.0))
    # 耙过的沟纹
    b.set("Base Color", col)
    rg = b.tex(texpath("gravel_floor_02", "rough", "2k"), uvA, True)
    b.set("Roughness", b.mixf(b.math('MULTIPLY', wet, 0.6), rg, 0.35))
    nm = b.tex(texpath("gravel_floor_02", "nor_gl", "2k"), uvA, True)
    dp = b.tex(texpath("gravel_floor_02", "disp", "2k"), uvA, True)
    nrm = b.normalmap(nm, 1.8)
    b.set("Normal", b.bump(dp, strength=0.6, distance=0.03, normal=nrm))
    b.bsdf.inputs["Coat Weight"].default_value = 0.0
    try:
        b.bsdf.inputs["Specular IOR Level"].default_value = 0.12
    except KeyError:
        pass
    return b.mat


# ----------------------------------------------------------------------------- 护栏金属
def make_armco():
    b = NB("M_Armco")
    uv = b.uv()
    h, s, _ = b.sep(uv)
    n1 = b.noise(b.mapping(uv, scale=(6.0, 0.6, 1)), 1.0, detail=5.0, rough=0.7)
    n2 = b.noise(uv, 14.0, detail=3.0, rough=0.6)
    # 流挂的污迹（竖向）
    drip = b.maprange(b.noise(b.mapping(uv, scale=(1.5, 9.0, 1)), 1.0, detail=3.0, rough=0.6), 0.45, 0.75)
    base = b.mix(b.maprange(n1, 0.3, 0.7), (0.58, 0.60, 0.62), (0.40, 0.41, 0.42))
    dirt = b.math('MULTIPLY', drip, 0.55)
    col = b.mix(dirt, base, (0.10, 0.085, 0.07))
    rust = b.maprange(n2, 0.70, 0.78)
    rust = b.math('MULTIPLY', rust, b.maprange(n1, 0.45, 0.7), clamp=True)
    col = b.mix(rust, col, (0.22, 0.09, 0.04))
    b.set("Base Color", col)
    met = b.math('SUBTRACT', 1.0, b.math('MAXIMUM', b.math('MULTIPLY', dirt, 0.9), rust), clamp=True)
    b.set("Metallic", met)
    b.set("Roughness", b.maprange(n1, 0.2, 0.8, 0.32, 0.60))
    b.set("Normal", b.bump(n2, strength=0.08, distance=0.002))
    b.set("Coat Weight", 0.25)
    b.bsdf.inputs["Coat Roughness"].default_value = 0.08
    return b.mat


def make_post():
    b = NB("M_Post")
    geo = b.node("ShaderNodeNewGeometry")
    n = b.noise(geo.outputs["Position"], 6.0, detail=4.0, rough=0.7)
    col = b.mix(b.maprange(n, 0.4, 0.65), (0.32, 0.33, 0.34), (0.20, 0.10, 0.06))
    b.set("Base Color", col)
    b.set("Metallic", b.maprange(n, 0.4, 0.65, 0.9, 0.2))
    b.set("Roughness", 0.55)
    return b.mat


def make_tyre():
    b = NB("M_TyreWall")
    info = b.node("ShaderNodeObjectInfo")
    geo = b.node("ShaderNodeNewGeometry")
    n = b.noise(geo.outputs["Position"], 9.0, detail=4.0, rough=0.7)
    rnd = info.outputs["Random"]
    idx = info.outputs["Object Index"]
    rubber = b.mix(b.maprange(n, 0.3, 0.7), (0.012, 0.012, 0.013), (0.035, 0.034, 0.032))
    white = b.mix(b.maprange(n, 0.45, 0.7), (0.62, 0.62, 0.59), (0.25, 0.24, 0.22))
    red = b.mix(b.maprange(n, 0.45, 0.7), (0.42, 0.03, 0.025), (0.15, 0.04, 0.03))
    paint = b.mix(b.maprange(idx, 0.4, 0.6), white, red)
    # 掉漆：一部分轮胎露出黑胶
    chipped = b.maprange(n, 0.56, 0.66)
    col = b.mix(chipped, paint, rubber)
    col = b.mix(1.0, col, b.maprange(rnd, 0.0, 1.0, 0.75, 1.05), 'MULTIPLY')
    b.set("Base Color", col)
    b.set("Roughness", b.maprange(n, 0.3, 0.7, 0.45, 0.8))
    b.set("Normal", b.bump(n, strength=0.15, distance=0.004))
    b.set("Coat Weight", 0.3)
    b.bsdf.inputs["Coat Roughness"].default_value = 0.1
    return b.mat


assign("TrackSurface", make_asphalt())
km = make_kerb()
for n in ("Kerb_In", "Kerb_OutEntry", "Kerb_OutExit"):
    assign(n, km)
assign("GrassGround", make_grass())
assign("GravelTrap", make_gravel())
am = make_armco()
assign("Armco_L", am)
assign("Armco_R", am)
pm = make_post()
assign("ArmcoPosts_L", pm)
assign("ArmcoPosts_R", pm)
tm = make_tyre()
me = bpy.data.meshes["TyreMesh"]
me.materials.clear()
me.materials.append(tm)

# ----------------------------------------------------------------------------- 天空方向：把 HDRI 里的太阳转到方位角 190°
sc = bpy.context.scene
SUN_AZ = 190.0
world = sc.world
mp = world.node_tree.nodes["HDRI_Mapping"]
mp.inputs["Rotation"].default_value = (0, 0, -math.radians(SUN_AZ - sc["hdri_sun_az"]))
sc["sun_az"] = SUN_AZ
print("MATERIALS_OK")
