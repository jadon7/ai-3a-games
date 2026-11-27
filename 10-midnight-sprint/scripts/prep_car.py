"""把下载的车模整理成统一规格，存成 blend/cars/<name>.blend。
规格：车头 +X，左侧 +Y，轮胎着地 z=0，原点在轴距中点。
层级：<name>_root → <name>_body（车身，做侧倾/俯仰）
                  → <name>_steer_FL/FR → <name>_spin_FL/FR → 车轮网格
                  → <name>_spin_RL/RR → 车轮网格
用法：blender -b --factory-startup -P prep_car.py -- <name>
"""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
name = sys.argv[sys.argv.index("--") + 1]

CFG = {
    "hero": dict(
        src="tokii", front=(0, -1), length=4.85,
        drop_obj=["Icosphere"], drop_mat=[],
        tire=["TireTread"], wheel=["TireTread", "RimMain", "RimSecondary", "RimAccent", "Brake_Disk"],
        roles={
            "CarPaintMain": ("paint", (0.86, 0.88, 0.92), 0.25),
            "CarPaintSecondary": ("paint", (0.0, 0.42, 0.40), 0.9),
            "CarbonFibre": ("carbon",), "CarbonFibreChassis": ("carbon",),
            "Glass": ("glass", (0.10, 0.13, 0.15)),
            "RedTintGlass": ("emit", (1.0, 0.03, 0.05), 4.0),
            "TailLight": ("emit", (1.0, 0.02, 0.03), 7.0),
            "Headlight": ("emit", (0.85, 0.93, 1.0), 22.0),
            "ReverseLight": ("emit", (1.0, 1.0, 1.0), 0.0),
            "RimMain": ("metal", (0.03, 0.03, 0.035), 0.28),
            "RimSecondary": ("metal", (0.02, 0.02, 0.02), 0.2),
            "RimAccent": ("metal", (0.0, 0.55, 0.5), 0.25),
            "TireTread": ("tire",),
            "Chrome": ("metal", (0.9, 0.9, 0.9), 0.05),
            "Mirror": ("metal", (0.9, 0.9, 0.9), 0.02),
            "BrakePad": ("paintflat", (0.0, 0.75, 0.65)),
            "SteeringWheelScreen": ("emit", (0.1, 0.8, 0.9), 2.0),
        },
        head=["Headlight"], tail=["TailLight"],
    ),
    "rival_purple": dict(
        src="patriot", front=(0, -1), length=4.7,
        drop_obj=[], drop_mat=[],
        tire=["Tire"], wheel=["Tire", "Rims", "BrakeDisc"],
        roles={
            "Paintjob": ("coat",), "Carbon": ("coat",),
            "WindScreen": ("glass", (0.10, 0.12, 0.14)), "PlexiGlass": ("glass", (0.10, 0.12, 0.14)),
            "Lightstransparent": ("glass", (0.5, 0.5, 0.5)),
            "Lights": ("emit_tex", 4.0),
            "Rims": ("metal", (0.02, 0.02, 0.02), 0.3),
            "Tire": ("tire",),
        },
        head=[], tail=[],
    ),
    "rival_yellow": dict(
        src="azura", front=(0, -1), length=4.45,
        drop_obj=["Shadow"], drop_mat=["Azura_Shadow"],
        tire=["Azura_Tire"], wheel=["Azura_Tire", "Azura_Alloy", "Azura_Chrome", "Azura_Plastic", "Azura_Textures"],
        wheel_obj_prefix="WH_",
        roles={
            "Azura_Body": ("paint", (0.95, 0.55, 0.0), 0.35),
            "Azura_Glass": ("glass", (0.08, 0.09, 0.10)),
            "Azura_Glass_Red": ("emit", (1.0, 0.02, 0.02), 5.0),
            "Azura_Glass_Orange": ("emit", (1.0, 0.35, 0.02), 3.0),
            "Azura_Tire": ("tire",),
            "Azura_Chrome": ("metal", (0.9, 0.9, 0.9), 0.08),
        },
        head=[], tail=["Azura_Glass_Red"],
    ),
    "rival_green": dict(
        src="goblin", front=(0, 1), length=4.6,
        drop_obj=["car_shadow"], drop_mat=["car_shadow"],
        tire=["car_tire"], wheel=["car_tire"],
        wheel_obj_prefix="car_wheel_",
        roles={
            "car_glass": ("glass", (0.08, 0.10, 0.10)),
            "car_tire": ("tire",),
            "clearcoat": ("drop",),
            "car_body": ("coat",),
        },
        head=[], tail=[],
    ),
}

PACK = {"sedan": "Sedan Body", "wagon": "Wagon Body", "suv": "SUV Body", "hatch": "Hatchback Body", "compact": "Compact Body",
        "minivan": "minivan body", "pickup": "Pickup Body", "offroad": "Offroad Body", "coupe": "Coupe Body", "sport": "Sport body"}
for k, bodyname in PACK.items():
    CFG[f"traffic_{k}"] = dict(
        src="carpack", pack_body=bodyname, front=(1, 0), length=None,
        drop_obj=["Cylinder001"], drop_mat=[],
        tire=[], wheel=[], wheel_obj_prefix="Wheel",
        roles={"Body": ("coat",), "Glass": ("glass", (0.07, 0.08, 0.09)), "Optics": ("emit_tex", 3.0)},
        role_prefix=True, head=[], tail=[],
    )
cfg = CFG[name]


# ---------- 导入并烘焙 ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "assets", "dl", cfg["src"], "model.glb"))
sc = bpy.context.scene
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()

baked = []
for o in list(sc.objects):
    if o.type != "MESH":
        continue
    chain = []
    p = o
    while p:
        chain.append(p.name); p = p.parent
    if any(k in n for k in cfg["drop_obj"] for n in chain):
        continue
    mats = [s.material.name for s in o.material_slots if s.material]
    if any(m in cfg["drop_mat"] for m in mats):
        continue
    if any(cfg["roles"].get(m, ("",))[0] == "drop" for m in mats):
        continue
    e = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(e, preserve_all_data_layers=True, depsgraph=dg)
    mw = o.matrix_world.copy()
    me.transform(mw)
    if mw.determinant() < 0:
        me.flip_normals()
    # 记下原始层级名，后面按前缀认车轮
    tag = "|".join(chain)
    baked.append((o.name, me, tag))

for o in list(sc.objects):
    bpy.data.objects.remove(o, do_unlink=True)
objs = []
for n, me, tag in baked:
    ob = bpy.data.objects.new(n, me)
    ob["src_chain"] = tag
    sc.collection.objects.link(ob)
    objs.append(ob)



def bbox(obs):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for ob in obs:
        for v in ob.data.vertices:
            c = v.co
            mn.x = min(mn.x, c.x); mn.y = min(mn.y, c.y); mn.z = min(mn.z, c.z)
            mx.x = max(mx.x, c.x); mx.y = max(mx.y, c.y); mx.z = max(mx.z, c.z)
    return mn, mx


def matnames(ob):
    return [s.material.name for s in ob.material_slots if s.material]


if cfg.get("pack_body"):
    def chain_has(ob, key):
        return any(part == key or part.startswith(key + "_") for part in ob["src_chain"].split("|"))
    bodies = [ob for ob in objs if chain_has(ob, cfg["pack_body"])]
    bmn, bmx = bbox(bodies); bc = (bmn + bmx) / 2
    wheels_all = [ob for ob in objs if "Wheel" in ob["src_chain"]]
    def wc(ob):
        a, b_ = bbox([ob]); return (a + b_) / 2
    # 车轮必须落在这辆车车身的凸包（外扩 0.3 米）之内，避免把旁边车的轮子配过来
    pts = sorted({(round(v.co.x, 3), round(v.co.y, 3)) for ob in bodies for v in ob.data.vertices})
    def hull_half(seq):
        h = []
        for p in seq:
            while len(h) >= 2 and (h[-1][0] - h[-2][0]) * (p[1] - h[-2][1]) - (h[-1][1] - h[-2][1]) * (p[0] - h[-2][0]) <= 0:
                h.pop()
            h.append(p)
        return h
    hull = hull_half(pts)[:-1] + hull_half(reversed(pts))[:-1]          # 逆时针
    def inside(pt, margin=0.3):
        for i in range(len(hull)):
            ax, ay = hull[i]; bx, by = hull[(i + 1) % len(hull)]
            ex, ey = bx - ax, by - ay
            ln = math.hypot(ex, ey) or 1e-9
            if ((ex * (pt.y - ay) - ey * (pt.x - ax)) / ln) < -margin:
                return False
        return True
    near = [ob for ob in wheels_all if inside(wc(ob))]
    print(f"@@ pack car: wheels inside body hull = {len(near)}")
    if len(near) != 4:
        near = sorted(near or wheels_all, key=lambda ob: (wc(ob).xy - bc.xy).length)[:4]
    keep = set(bodies) | set(near)
    for ob in list(objs):
        if ob not in keep:
            bpy.data.objects.remove(ob, do_unlink=True)
    objs = list(keep)
    # 车身长轴 = 四个车轮中心的主方向
    cs = [wc(ob) for ob in near]
    cen = sum(cs, Vector()) / 4
    pairs = sorted(((cs[i] - cs[j]).xy for i in range(4) for j in range(i + 1, 4)), key=lambda v: -v.length)
    best = pairs[2]   # 最长的两条是对角线，第三长的是轴距方向
    ang = math.atan2(best.y, best.x)
    R0 = Matrix.Rotation(-ang, 4, "Z") @ Matrix.Translation(-cen)
    for ob in objs:
        ob.data.transform(R0)
    # 尾灯是红的：在车灯贴图上找红色面，红的一头是车尾
    red_x = []; all_x = []
    for ob in bodies:
        mat = ob.material_slots[0].material if ob.material_slots else None
        if not mat or "Optics" not in mat.name:
            continue
        b_ = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not b_ or not b_.inputs["Base Color"].links:
            continue
        im = b_.inputs["Base Color"].links[0].from_node.image
        import numpy as np
        w_, h_ = im.size
        px = np.array(im.pixels[:], dtype=np.float32).reshape(h_, w_, im.channels)
        uvl = ob.data.uv_layers.active.data
        for poly in ob.data.polygons:
            u = sum(uvl[i].uv.x for i in poly.loop_indices) / poly.loop_total
            v = sum(uvl[i].uv.y for i in poly.loop_indices) / poly.loop_total
            r, g, bl = px[int((v % 1) * (h_ - 1)), int((u % 1) * (w_ - 1)), :3]
            all_x.append(poly.center.x)
            if r > 0.35 and r > 2.2 * g and r > 2.2 * bl:
                red_x.append(poly.center.x)
    flip = bool(red_x) and (sum(red_x) / len(red_x)) > 0
    print(f"@@ pack car: red faces {len(red_x)}/{len(all_x)} flip={flip}")
    if flip:
        for ob in objs:
            ob.data.transform(Matrix.Rotation(math.pi, 4, "Z"))

# ---------- 归一化：车头朝 +X，缩放到目标车长，轮胎着地 ----------
fx, fy = cfg["front"]
rot = Matrix.Rotation(-math.atan2(fy, fx), 4, "Z")
for ob in objs:
    ob.data.transform(rot)
mn, mx = bbox(objs)
if cfg["length"]:
    s = cfg["length"] / (mx.x - mn.x)
    for ob in objs:
        ob.data.transform(Matrix.Scale(s, 4))
tires = [ob for ob in objs if any(m in cfg["tire"] for m in matnames(ob))] or [ob for ob in objs if "Wheel" in ob["src_chain"]]
tmn, tmx = bbox(tires)
mn, mx = bbox(objs)
shift = Matrix.Translation((-(tmn.x + tmx.x) / 2, -(mn.y + mx.y) / 2, -tmn.z))
for ob in objs:
    ob.data.transform(shift)
    ob.data.update()

# ---------- 找四个车轮 ----------
tmn, tmx = bbox(tires)
quads = {"FL": (1, 1), "FR": (1, -1), "RL": (-1, 1), "RR": (-1, -1)}
wheel = {}
for q, (sx, sy) in quads.items():
    pts = [v.co for ob in tires for v in ob.data.vertices if (v.co.x > 0) == (sx > 0) and (v.co.y > 0) == (sy > 0)]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]; zs = [p.z for p in pts]
    c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
    r = (max(zs) - min(zs)) / 2
    wheel[q] = dict(c=c, r=r, w=max(ys) - min(ys))
    print(f"@@ wheel {q} c={tuple(round(v,3) for v in c)} r={r:.3f} w={max(ys)-min(ys):.3f}")


def split_quadrants(ob):
    """把一个同时包含多个车轮的网格按象限拆开。"""
    out = []
    for q, (sx, sy) in quads.items():
        me = ob.data.copy()
        bm = bmesh.new(); bm.from_mesh(me)
        kill = [f for f in bm.faces if not ((f.calc_center_median().x > 0) == (sx > 0) and (f.calc_center_median().y > 0) == (sy > 0))]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        if len(bm.faces) == 0:
            bm.free(); bpy.data.meshes.remove(me); continue
        bm.to_mesh(me); bm.free()
        nb = bpy.data.objects.new(f"{ob.name}_{q}", me)
        nb["src_chain"] = ob.get("src_chain", "")
        sc.collection.objects.link(nb)
        out.append(nb)
    bpy.data.objects.remove(ob, do_unlink=True)
    return out


prefix = cfg.get("wheel_obj_prefix")
new_objs = []
for ob in objs:
    is_wheel_mat = any(m in cfg["wheel"] for m in matnames(ob))
    if prefix:
        is_wheel_mat = any(part.startswith(prefix) for part in ob["src_chain"].split("|"))
    if is_wheel_mat:
        new_objs += [(p, True) for p in split_quadrants(ob)]
    else:
        new_objs.append((ob, False))

col = bpy.data.collections.new(f"CAR_{name}")
sc.collection.children.link(col)


def empty(n, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(n, None)
    e.empty_display_size = 0.2
    col.objects.link(e)
    e.location = loc
    if parent:
        e.parent = parent
    return e


root = empty(f"{name}_root")
body = empty(f"{name}_body", parent=root)
spin = {}
for q in quads:
    c = wheel[q]["c"]
    if q[0] == "F":
        st = empty(f"{name}_steer_{q}", c, root)
        spin[q] = empty(f"{name}_spin_{q}", (0, 0, 0), st)
    else:
        spin[q] = empty(f"{name}_spin_{q}", c, root)
bpy.context.view_layer.update()

nwheel = 0
for ob, cand in new_objs:
    for c2 in list(ob.users_collection):
        c2.objects.unlink(ob)
    col.objects.link(ob)
    target = body
    if cand:
        mn, mx = bbox([ob]); c = (mn + mx) / 2
        for q in quads:
            w = wheel[q]
            if abs(c.x - w["c"].x) < w["r"] * 0.6 and abs(c.z - w["c"].z) < w["r"] * 0.6 and abs(c.y - w["c"].y) < 0.45:
                target = spin[q]; nwheel += 1
                break
    ob.parent = target
    ob.matrix_parent_inverse = target.matrix_world.inverted()
print(f"@@ wheel parts assigned: {nwheel}")
_sym = max(abs(wheel["FL"]["c"].y + wheel["FR"]["c"].y), abs(wheel["RL"]["c"].y + wheel["RR"]["c"].y), abs(wheel["FL"]["c"].x - wheel["FR"]["c"].x), abs(wheel["RL"]["c"].x - wheel["RR"]["c"].x))
print(f"@@ wheel symmetry error = {_sym:.3f} m  ({'OK' if _sym < 0.12 else 'BAD'})")


# ---------- 材质 ----------
def principled(m):
    return next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def unlink_input(m, sock):
    for l in list(sock.links):
        m.node_tree.links.remove(l)


def set_role(m, role):
    b = principled(m)
    if b is None:
        return
    nt = m.node_tree
    kind = role[0]
    if kind == "paint":
        col_, metal = role[1], role[2]
        unlink_input(m, b.inputs["Base Color"])
        b.inputs["Base Color"].default_value = (*col_, 1)
        b.inputs["Metallic"].default_value = metal
        b.inputs["Roughness"].default_value = 0.32
        b.inputs["Coat Weight"].default_value = 1.0
        b.inputs["Coat Roughness"].default_value = 0.03
    elif kind == "paintflat":
        unlink_input(m, b.inputs["Base Color"])
        b.inputs["Base Color"].default_value = (*role[1], 1)
        b.inputs["Metallic"].default_value = 0.0; b.inputs["Roughness"].default_value = 0.35
    elif kind == "coat":
        unlink_input(m, b.inputs["Roughness"]); unlink_input(m, b.inputs["Metallic"])
        b.inputs["Metallic"].default_value = 0.35
        b.inputs["Roughness"].default_value = 0.3
        b.inputs["Coat Weight"].default_value = 1.0
        b.inputs["Coat Roughness"].default_value = 0.03
    elif kind == "carbon":
        if not b.inputs["Base Color"].links:
            b.inputs["Base Color"].default_value = (0.012, 0.012, 0.014, 1)
        unlink_input(m, b.inputs["Roughness"]); unlink_input(m, b.inputs["Metallic"])
        b.inputs["Metallic"].default_value = 0.3; b.inputs["Roughness"].default_value = 0.35
        b.inputs["Coat Weight"].default_value = 1.0; b.inputs["Coat Roughness"].default_value = 0.06
    elif kind == "metal":
        unlink_input(m, b.inputs["Base Color"]); unlink_input(m, b.inputs["Roughness"]); unlink_input(m, b.inputs["Metallic"])
        b.inputs["Base Color"].default_value = (*role[1], 1)
        b.inputs["Metallic"].default_value = 1.0; b.inputs["Roughness"].default_value = role[2]
    elif kind == "tire":
        unlink_input(m, b.inputs["Roughness"]); unlink_input(m, b.inputs["Metallic"])
        if not b.inputs["Base Color"].links:
            b.inputs["Base Color"].default_value = (0.012, 0.012, 0.012, 1)
        b.inputs["Metallic"].default_value = 0.0; b.inputs["Roughness"].default_value = 0.72
    elif kind == "emit":
        unlink_input(m, b.inputs["Base Color"]); unlink_input(m, b.inputs["Emission Color"])
        b.inputs["Base Color"].default_value = (*[c * 0.3 for c in role[1]], 1)
        b.inputs["Emission Color"].default_value = (*role[1], 1)
        b.inputs["Emission Strength"].default_value = role[2]
        b.inputs["Alpha"].default_value = 1.0
        unlink_input(m, b.inputs["Alpha"])
        m["emit_base"] = role[2]
    elif kind == "emit_tex":
        src = b.inputs["Base Color"].links[0].from_socket if b.inputs["Base Color"].links else None
        if src:
            nt.links.new(src, b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = role[1]
        m["emit_base"] = role[1]
    elif kind == "glass":
        # 便宜的深色车窗：按菲涅尔在透明和高光反射之间混合
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        for n in list(nt.nodes):
            if n != out:
                nt.nodes.remove(n)
        tr = nt.nodes.new("ShaderNodeBsdfTransparent"); tr.inputs["Color"].default_value = (*role[1], 1)
        gl = nt.nodes.new("ShaderNodeBsdfGlossy"); gl.inputs["Roughness"].default_value = 0.02
        gl.inputs["Color"].default_value = (1, 1, 1, 1)
        fr = nt.nodes.new("ShaderNodeFresnel"); fr.inputs["IOR"].default_value = 1.6
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(fr.outputs[0], mix.inputs[0]); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(gl.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
    try:
        m.surface_render_method = "DITHERED"
    except Exception:
        pass


used = set()
for ob, _ in new_objs:
    for sl in ob.material_slots:
        if sl.material:
            used.add(sl.material)
for m in used:
    m.name = f"{name}__{m.name}"
    key = m.name.split("__", 1)[1]
    if cfg.get("role_prefix"):
        key = key.split("_")[0].split(".")[0]
    if key in cfg["roles"]:
        set_role(m, cfg["roles"][key])
    else:
        b = principled(m)
        # glTF 导入的不透明材质偶尔带 alpha 混合，统一关掉背面剔除问题
        if b and not b.inputs["Alpha"].links:
            b.inputs["Alpha"].default_value = 1.0

# ---------- 记录尺寸和灯位 ----------
allmesh = [ob for ob, _ in new_objs]
mn, mx = bbox(allmesh)
root["length"] = mx.x - mn.x; root["width"] = mx.y - mn.y; root["height"] = mx.z
root["front_x"] = mx.x; root["rear_x"] = mn.x
root["wheelbase"] = wheel["FL"]["c"].x - wheel["RL"]["c"].x
root["track"] = wheel["FL"]["c"].y - wheel["FR"]["c"].y
root["r_front"] = wheel["FL"]["r"]; root["r_rear"] = wheel["RL"]["r"]


def light_pos(mats, default_x, default_z):
    obs = [ob for ob in allmesh if any(f"{name}__{k}" in matnames(ob) for k in mats)]
    if obs:
        a, b = bbox(obs)
        return [(a.x + b.x) / 2, b.y * 0.78, (a.z + b.z) / 2]
    return [default_x, (mx.y) * 0.68, default_z]


root["head_pos"] = light_pos(cfg["head"], mx.x - 0.25, mx.z * 0.48)
root["tail_pos"] = light_pos(cfg["tail"], mn.x + 0.12, mx.z * 0.62)
print(f"@@ dims L={root['length']:.2f} W={root['width']:.2f} H={root['height']:.2f} wb={root['wheelbase']:.2f} track={root['track']:.2f} rf={root['r_front']:.3f} rr={root['r_rear']:.3f}")
print(f"@@ head={list(root['head_pos'])} tail={list(root['tail_pos'])}")

# 清理、打包、保存
for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.actions, bpy.data.armatures):
    for d in list(blk):
        if d.users == 0:
            blk.remove(d)
bpy.ops.file.pack_all()
out = os.path.join(ROOT, "blend", "cars", f"{name}.blend")
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print("@@ saved", out, "objects", len(col.objects))
