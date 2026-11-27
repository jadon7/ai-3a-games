# 胎痕（随时间出现）+ 一批画面调整（曝光平衡、砾石/护栏反光、烟雾细节）
import bpy, bmesh, math, os, sys, importlib
from mathutils import Vector

ROOT = "/Users/jadon7/Library/Application Support/Claude/scratch-workspaces/dfe2b44a-8503-4a5e-af9b-63b1be0e053b/aae3434b-694f-413f-a991-1f79c427025e/scratch-2026-11-21-ab6c85/racing"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import motion as M
importlib.reload(M)
sc = bpy.context.scene
D = bpy.data.objects

coll = bpy.data.collections.get("FX") or bpy.data.collections.new("FX")
if coll.name not in [c.name for c in sc.collection.children]:
    sc.collection.children.link(coll)
for o in [o for o in coll.objects if o.name.startswith("TyreMark")]:
    bpy.data.objects.remove(o, do_unlink=True)


# ----------------------------------------------------------------------------- 胎痕材质
def mark_material():
    m = bpy.data.materials.get("M_TyreMark") or bpy.data.materials.new("M_TyreMark")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (0.006, 0.006, 0.007, 1)
    bsdf.inputs["Roughness"].default_value = 0.42
    a_t = nt.nodes.new("ShaderNodeAttribute"); a_t.attribute_name = "t_emit"
    a_i = nt.nodes.new("ShaderNodeAttribute"); a_i.attribute_name = "inten"
    now = nt.nodes.new("ShaderNodeValue"); now.name = "TimeNow"
    # 出现：now - t_emit 从 0 到 0.04 秒渐入
    sub = nt.nodes.new("ShaderNodeMath"); sub.operation = 'SUBTRACT'
    nt.links.new(now.outputs[0], sub.inputs[0]); nt.links.new(a_t.outputs["Fac"], sub.inputs[1])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs[1].default_value = 0.0; mr.inputs[2].default_value = 0.05
    nt.links.new(sub.outputs[0], mr.inputs[0])
    uv = nt.nodes.new("ShaderNodeUVMap"); uv.uv_map = "UVm"
    sepn = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(uv.outputs[0], sepn.inputs[0])
    # 横向边缘柔化：1 - |u|^3
    ab = nt.nodes.new("ShaderNodeMath"); ab.operation = 'ABSOLUTE'
    nt.links.new(sepn.outputs[0], ab.inputs[0])
    pw = nt.nodes.new("ShaderNodeMath"); pw.operation = 'POWER'; pw.inputs[1].default_value = 2.5
    nt.links.new(ab.outputs[0], pw.inputs[0])
    edge = nt.nodes.new("ShaderNodeMath"); edge.operation = 'SUBTRACT'; edge.inputs[0].default_value = 1.0; edge.use_clamp = True
    nt.links.new(pw.outputs[0], edge.inputs[1])
    # 沿程条纹（胎纹/断续）
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (5.0, 0.6, 1.0)
    nt.links.new(uv.outputs[0], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 1.0; nz.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs[0], nz.inputs["Vector"])
    mr2 = nt.nodes.new("ShaderNodeMapRange")
    mr2.inputs[1].default_value = 0.30; mr2.inputs[2].default_value = 0.62
    mr2.inputs[3].default_value = 0.35; mr2.inputs[4].default_value = 1.0
    nt.links.new(nz.outputs[0], mr2.inputs[0])

    def mul(a, b):
        n = nt.nodes.new("ShaderNodeMath"); n.operation = 'MULTIPLY'; n.use_clamp = True
        nt.links.new(a, n.inputs[0])
        if isinstance(b, float):
            n.inputs[1].default_value = b
        else:
            nt.links.new(b, n.inputs[1])
        return n.outputs[0]
    alpha = mul(mul(mul(mr.outputs[0], a_i.outputs["Fac"]), edge.outputs[0]), mr2.outputs[0])
    nt.links.new(alpha, bsdf.inputs["Alpha"])
    # 时间关键帧
    now.outputs[0].default_value = -1.0 / M.FPS
    now.outputs[0].keyframe_insert("default_value", frame=0)
    now.outputs[0].default_value = (M.NF + 1 - 1) / M.FPS
    now.outputs[0].keyframe_insert("default_value", frame=M.NF + 1)
    ad = nt.animation_data
    if ad and ad.action:
        try:
            fcs = list(ad.action.fcurves)
        except Exception:
            fcs = [fc for l in ad.action.layers for s in l.strips for b in s.channelbags for fc in b.fcurves]
        for fc in fcs:
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
    try:
        m.blend_method = 'BLEND'
    except Exception:
        pass
    return m


MM = mark_material()


def build_marks(tag, name, strength=1.0, t_shift=None, lateral=0.0, s_shift=0, always=False, half_w=0.125):
    st = M.simulate(tag)[0]
    tw = M.DIMS[tag]['tw']
    verts, faces, uvs, tem, inten = [], [], [], [], []
    for side in (+1, -1):
        prev = None
        run = 0.0
        last_p = None
        for i in range(2, len(st) - 2, 2):
            c = st[i]
            sl = c['slide']
            k = min(1.0, max(0.0, (sl - 3.5) / 9.0)) * strength
            cy, sy = math.cos(c['yaw']), math.sin(c['yaw'])
            nx, ny = -sy, cy
            px = c['rx'] + nx * side * tw / 2 + nx * lateral
            py = c['ry'] + ny * side * tw / 2 + ny * lateral
            vx, vy = c['v_rear']
            sp = math.hypot(vx, vy)
            if k <= 0.001 or sp < 1.0:
                prev = None
                last_p = None
                continue
            # 垂直于轮胎对地速度方向
            tx, ty = -vy / sp, vx / sp
            hw = half_w * (1.0 + 0.5 * abs(math.sin(c['slip'])))
            if last_p is not None:
                run += math.hypot(px - last_p[0], py - last_p[1])
            last_p = (px, py)
            a = len(verts)
            verts.append((px - tx * hw, py - ty * hw, 0.0045))
            verts.append((px + tx * hw, py + ty * hw, 0.0045))
            uvs += [(-1.0, run), (1.0, run)]
            te = -10.0 if always else c['t']
            tem += [te, te]
            inten += [k, k]
            if prev is not None:
                faces.append((prev, prev + 1, a + 1, a))
            prev = a
    if not faces:
        return None
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    uvl = me.uv_layers.new(name="UVm")
    for poly in me.polygons:
        for li in poly.loop_indices:
            uvl.data[li].uv = uvs[me.loops[li].vertex_index]
    a1 = me.attributes.new("t_emit", 'FLOAT', 'POINT'); a1.data.foreach_set("value", tem)
    a2 = me.attributes.new("inten", 'FLOAT', 'POINT'); a2.data.foreach_set("value", inten)
    me.materials.append(MM)
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    try:
        ob.visible_shadow = False
    except Exception:
        pass
    return ob


build_marks('E30', "TyreMark_E30", 0.95)
build_marks('STRATOS', "TyreMark_STRATOS", 0.5)
build_marks('CAPRI', "TyreMark_CAPRI", 0.4)
# 之前圈数留下的旧胎痕（一直可见、较淡、位置错开）
build_marks('E30', "TyreMark_old1", 0.38, lateral=-0.9, always=True)
build_marks('E30', "TyreMark_old2", 0.30, lateral=0.75, always=True)
build_marks('STRATOS', "TyreMark_old3", 0.45, lateral=1.3, always=True)

# ----------------------------------------------------------------------------- 画面调整
# 1) 天空与太阳灯的平衡：背景树林不再发黑
world = sc.world
world.node_tree.nodes["HDRI_BG"].inputs["Strength"].default_value = 1.55
sun = D["Sun_Key"]
sun.data.energy = 3.0
sc.view_settings.exposure = -0.35

# 3) 护栏：不要镜面那么亮
am = bpy.data.materials["M_Armco"]
ab = next(n for n in am.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
ab.inputs["Coat Weight"].default_value = 0.0
for l in list(ab.inputs["Roughness"].links):
    src = l.from_node
    if src.type == 'MAP_RANGE':
        src.inputs[3].default_value = 0.48
        src.inputs[4].default_value = 0.72

# 5) 烟雾：对比更强的絮状结构；关闭单独的水雾体积（太耗时且几乎看不见）
ms = bpy.data.materials["M_Smoke"]
nt = ms.node_tree
nA, nB = nt.nodes["SmokeNoiseA"], nt.nodes["SmokeNoiseB"]
nA.inputs["Scale"].default_value = 0.8
nA.inputs["Distortion"].default_value = 1.1
nB.inputs["Scale"].default_value = 3.4
for n in nt.nodes:
    if n.type == 'MAP_RANGE':
        src = n.inputs[0].links[0].from_node.name
        if src == "SmokeNoiseA":
            n.inputs[1].default_value = 0.36; n.inputs[2].default_value = 0.66
            n.inputs[3].default_value = 0.0; n.inputs[4].default_value = 2.3
        elif src == "SmokeNoiseB":
            n.inputs[1].default_value = 0.32; n.inputs[2].default_value = 0.68
            n.inputs[3].default_value = 0.55; n.inputs[4].default_value = 1.45
    if n.type == 'MATH' and n.operation == 'SUBTRACT':
        n.inputs[1].default_value = 0.014
nt.nodes["DensityK"].inputs[1].default_value = 1.9
if "WaterMist" in D:
    D["WaterMist"].hide_render = True
    D["WaterMist"].hide_viewport = True
sc.cycles.volume_bounces = 1
print("MARKS_TWEAKS_OK")
