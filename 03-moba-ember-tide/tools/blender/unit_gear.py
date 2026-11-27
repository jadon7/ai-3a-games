"""小兵的武器（阶段 4）：斧子、圆盾、法杖。形状简单，直接用代码建，不花图转 3D 的额度。
给 hero_build.py 的 rig 一步用。所有武器共用一张四个色块的小贴图（一个材质），形状各自把贴图坐标指到自己的色块上。

武器自己的坐标：原点在握把中心，+Y 指向武器的头，-Z 是刃口朝的方向，X 是厚度。单位和角色一样（身高为 1）。
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix

PALETTE = [(0.2, 0.3, 0.28), (0.2, 0.14, 0.1), (0.58, 0.58, 0.52), (0.25, 0.95, 0.9)]      # 铜绿、木头、骨白、青色的光
BRONZE, WOOD, BONE, GLOW = 0, 1, 2, 3


def palette_material():
    m = bpy.data.materials.get("weapon")
    if m: return m
    # 每个色块 16×16 像素：色块太小的话，压缩和缩小后的贴图会把相邻的颜色混在一起（斧刃会被旁边的青光染成青色）
    img = bpy.data.images.new("weapon_palette", 64, 16, alpha=False); px = []
    for _ in range(16):
        for c in PALETTE: px += [c[0], c[1], c[2], 1.0] * 16
    img.pixels = px; img.file_format = "PNG"; img.pack()
    m = bpy.data.materials.new("weapon"); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = img; t.interpolation = "Closest"
    m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.8; b.inputs["Metallic"].default_value = 0.0
    return m


def _finish(bm, name):
    """把一个 bmesh 变成网格：每个面的贴图坐标指到它的色块（面的 material_index 临时当色块编号用）"""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops: l[uv].uv = ((f.material_index + 0.5) / 4.0, 0.5)
        f.material_index = 0; f.smooth = True
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.uv_layers[0].name = "UVMap"      # 和身体的贴图坐标层同名，合并网格时才会并到同一层
    me.materials.append(palette_material()); return me


def _paint(geom, idx):
    for f in geom:
        if isinstance(f, bmesh.types.BMFace): f.material_index = idx
def _faces_of(verts): return {f for v in verts for f in v.link_faces}


def _cyl(bm, r0, r1, y0, y1, idx, seg=8):
    g = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=y1 - y0)       # 轴沿 Z
    bmesh.ops.transform(bm, matrix=Matrix.Translation((0, (y0 + y1) / 2, 0)) @ Matrix.Rotation(-math.pi / 2, 4, "X"), verts=g["verts"]); _paint(_faces_of(g["verts"]), idx)
def _ball(bm, r, at, idx, scale=(1, 1, 1)):
    g = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r); bmesh.ops.transform(bm, matrix=Matrix.Translation(at) @ Matrix.Diagonal((*scale, 1)), verts=g["verts"]); _paint(_faces_of(g["verts"]), idx)
def _plate(bm, outline, half, idx):
    """YZ 平面里的一圈轮廓，沿 X 拉出厚度"""
    vs = [bm.verts.new((-half, y, z)) for y, z in outline]; f = bm.faces.new(vs); g = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [v for v in g["geom"] if isinstance(v, bmesh.types.BMVert)]; bmesh.ops.translate(bm, vec=(half * 2, 0, 0), verts=nv); _paint(_faces_of(vs + nv), idx)


def make_axe():
    bm = bmesh.new()
    _cyl(bm, 0.012, 0.010, -0.11, 0.35, WOOD)                 # 斧柄
    _cyl(bm, 0.016, 0.016, -0.125, -0.105, BRONZE)            # 柄尾的箍
    _plate(bm, [(0.215, -0.008), (0.345, -0.008), (0.385, -0.125), (0.33, -0.155), (0.24, -0.16), (0.175, -0.12)], 0.007, BONE)       # 斧刃
    _plate(bm, [(0.25, 0.008), (0.31, 0.008), (0.28, 0.055)], 0.006, BRONZE)       # 背面的小尖
    _cyl(bm, 0.02, 0.02, 0.225, 0.335, BRONZE, 6)             # 斧头套在柄上的那一段
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); return _finish(bm, "axe")


def make_staff():
    bm = bmesh.new()
    _cyl(bm, 0.013, 0.011, -0.3, 0.46, WOOD)
    _cyl(bm, 0.018, 0.015, 0.4, 0.47, BRONZE, 6)
    _ball(bm, 0.042, (0, 0.52, 0), GLOW, (0.9, 1.15, 0.9))    # 杖头的光
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); return _finish(bm, "staff")


def make_shield():
    """圆盾：自己的坐标里盾面朝 +Z，原点在盾的背面中心"""
    bm = bmesh.new()
    g = bmesh.ops.create_cone(bm, cap_ends=True, segments=18, radius1=0.17, radius2=0.155, depth=0.022); bmesh.ops.translate(bm, vec=(0, 0, 0.011), verts=g["verts"]); _paint(_faces_of(g["verts"]), BRONZE)
    g = bmesh.ops.create_cone(bm, cap_ends=True, segments=18, radius1=0.178, radius2=0.178, depth=0.012); bmesh.ops.translate(bm, vec=(0, 0, 0.008), verts=g["verts"]); _paint(_faces_of(g["verts"]), BONE)      # 一圈边
    _ball(bm, 0.055, (0, 0, 0.026), BONE, (1, 1, 0.5)); _ball(bm, 0.022, (0, 0, 0.05), GLOW, (1, 1, 0.6))      # 盾心的凸起，正中一点青光
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); return _finish(bm, "shield")
