# 把 VDB 烟雾/水雾序列挂进场景，并建立体积材质
import bpy, os, math

ROOT = "/Users/jadon7/Library/Application Support/Claude/scratch-workspaces/dfe2b44a-8503-4a5e-af9b-63b1be0e053b/aae3434b-694f-413f-a991-1f79c427025e/scratch-2026-11-21-ab6c85/racing"
CACHE = os.path.join(ROOT, "cache/smoke")
sc = bpy.context.scene
D = bpy.data.objects

coll = bpy.data.collections.get("FX") or bpy.data.collections.new("FX")
if coll.name not in [c.name for c in sc.collection.children]:
    sc.collection.children.link(coll)


def vol_material(name, k_density, aniso, color, detail=True, erode=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    pv = nt.nodes.new("ShaderNodeVolumePrincipled")
    nt.links.new(pv.outputs[0], out.inputs["Volume"])
    pv.inputs["Color"].default_value = (*color, 1.0)
    pv.inputs["Anisotropy"].default_value = aniso
    try:
        pv.inputs["Density Attribute"].default_value = ""
    except Exception:
        pass
    info = nt.nodes.new("ShaderNodeVolumeInfo")
    dens = info.outputs["Density"]
    if detail:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        # 噪声坐标随风缓慢平移 + 第四维随时间演化
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.name = "SmokeDrift"
        nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
        n1 = nt.nodes.new("ShaderNodeTexNoise")
        n1.noise_dimensions = '4D'
        n1.name = "SmokeNoiseA"
        n1.inputs["Scale"].default_value = 0.95
        n1.inputs["Detail"].default_value = 5.0
        n1.inputs["Roughness"].default_value = 0.62
        n1.inputs["Distortion"].default_value = 0.6
        nt.links.new(mp.outputs[0], n1.inputs["Vector"])
        n2 = nt.nodes.new("ShaderNodeTexNoise")
        n2.noise_dimensions = '4D'
        n2.name = "SmokeNoiseB"
        n2.inputs["Scale"].default_value = 4.2
        n2.inputs["Detail"].default_value = 4.0
        n2.inputs["Roughness"].default_value = 0.6
        nt.links.new(mp.outputs[0], n2.inputs["Vector"])
        # 大尺度：0.25~1.9 的调制；小尺度：0.6~1.4
        mr1 = nt.nodes.new("ShaderNodeMapRange")
        mr1.inputs[1].default_value = 0.30; mr1.inputs[2].default_value = 0.72
        mr1.inputs[3].default_value = 0.12; mr1.inputs[4].default_value = 2.0
        nt.links.new(n1.outputs[0], mr1.inputs[0])
        mr2 = nt.nodes.new("ShaderNodeMapRange")
        mr2.inputs[1].default_value = 0.30; mr2.inputs[2].default_value = 0.70
        mr2.inputs[3].default_value = 0.55; mr2.inputs[4].default_value = 1.45
        nt.links.new(n2.outputs[0], mr2.inputs[0])
        mul = nt.nodes.new("ShaderNodeMath"); mul.operation = 'MULTIPLY'
        nt.links.new(mr1.outputs[0], mul.inputs[0]); nt.links.new(mr2.outputs[0], mul.inputs[1])
        mul2 = nt.nodes.new("ShaderNodeMath"); mul2.operation = 'MULTIPLY'
        nt.links.new(dens, mul2.inputs[0]); nt.links.new(mul.outputs[0], mul2.inputs[1])
        # 侵蚀：把稀薄边缘按噪声削掉，得到絮状轮廓
        sub = nt.nodes.new("ShaderNodeMath"); sub.operation = 'SUBTRACT'; sub.use_clamp = False
        nt.links.new(mul2.outputs[0], sub.inputs[0]); sub.inputs[1].default_value = erode
        mx = nt.nodes.new("ShaderNodeMath"); mx.operation = 'MAXIMUM'
        nt.links.new(sub.outputs[0], mx.inputs[0]); mx.inputs[1].default_value = 0.0
        dens = mx.outputs[0]
    k = nt.nodes.new("ShaderNodeMath"); k.operation = 'MULTIPLY'; k.name = "DensityK"
    nt.links.new(dens, k.inputs[0]); k.inputs[1].default_value = k_density
    nt.links.new(k.outputs[0], pv.inputs["Density"])
    return m


def make_volume(name, prefix, mat):
    ob = D.get(name)
    if ob:
        bpy.data.objects.remove(ob, do_unlink=True)
    v = bpy.data.volumes.new(name)
    first = os.path.join(CACHE, f"{prefix}_0001.vdb")
    v.filepath = first
    v.is_sequence = True
    v.frame_duration = sc.frame_end
    v.frame_start = 1
    v.frame_offset = 0
    v.sequence_mode = 'CLIP'
    ob = bpy.data.objects.new(name, v)
    coll.objects.link(ob)
    v.materials.append(mat)
    try:
        v.render.space = 'WORLD'
        v.render.step_size = 0.0
    except Exception as e:
        print("vol render settings:", e)
    return ob


ms = vol_material("M_Smoke", 1.6, 0.35, (0.93, 0.93, 0.93), detail=True, erode=0.012)
mm = vol_material("M_Mist", 0.9, 0.65, (0.95, 0.96, 0.98), detail=False)
smoke = make_volume("TyreSmoke", "smoke", ms)
mist = make_volume("WaterMist", "mist", mm)

# 噪声随时间演化（关键帧）
for mat in (ms,):
    nt = mat.node_tree
    for nm, speed in (("SmokeNoiseA", 0.35), ("SmokeNoiseB", 0.8)):
        n = nt.nodes[nm]
        w = n.inputs["W"]
        w.default_value = 0.0
        w.keyframe_insert("default_value", frame=0)
        w.default_value = speed * (sc.frame_end + 1) / sc.render.fps
        w.keyframe_insert("default_value", frame=sc.frame_end + 1)
    mp = nt.nodes["SmokeDrift"]
    loc = mp.inputs["Location"]
    loc.default_value = (0, 0, 0)
    loc.keyframe_insert("default_value", frame=0)
    tt = (sc.frame_end + 1) / sc.render.fps
    loc.default_value = (-0.9 * tt, 0.55 * tt, -0.5 * tt)     # 与风向相反移动坐标 = 纹理顺风飘
    loc.keyframe_insert("default_value", frame=sc.frame_end + 1)
    ad = nt.animation_data
    if ad and ad.action:
        try:
            fcs = list(ad.action.fcurves)
        except Exception:
            fcs = [fc for l in ad.action.layers for s in l.strips for b in s.channelbags for fc in b.fcurves]
        for fc in fcs:
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'

sc.cycles.volume_bounces = 2
try:
    sc.cycles.volume_step_rate = 1.0
    sc.cycles.volume_max_steps = 512
except Exception as e:
    print("volume step settings:", e)
print("SMOKE_SETUP_OK", smoke.name, mist.name)
