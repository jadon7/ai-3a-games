"""游戏用的 Blender 侧导出：
  1) demo_track.json：影片逐帧的相机/持枪矩阵（用于"同机位对比"演示模式）
  2) 门外天光漏进房间的光照贴图（只烘焙天光+门外地面的反弹，按扫描模型自带 UV）
blender -b blend/shot.blend -P scripts/game_bake.py -- <track|spill|all>
"""
import bpy, sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
from common import ROOT, enable_gpu
import rigmath as RM
import timeline as TL

what = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "all"
OUT = os.path.join(ROOT, "game", "assets")
scn = bpy.context.scene


def flat(m):
    return [round(v, 6) for row in m for v in row]      # 行主序


if what in ("track", "all"):
    frames = []
    for f in range(1, TL.F_END + 1):
        frames.append({"c": flat(RM.cam_world(f)), "v": flat(RM.vm_world(f)), "s": round(float(RM.slide[f]), 3)})
    eroot = bpy.data.objects["EnemyRoot"]
    ek = []
    for f in range(1, TL.F_END + 1):
        scn.frame_set(f)
        ek.append(flat(eroot.matrix_world))
    emz = bpy.data.objects["E_Muzzle"]
    em = []
    for f in TL.E_SHOTS:
        scn.frame_set(f)
        em.append([round(v, 4) for v in emz.matrix_world.translation])
    scn.frame_set(1)
    wl = bpy.data.objects["WL_Hot"]
    d = {
        "fps": TL.FPS, "frames": frames, "enemy_root": ek, "p_shots": TL.P_SHOTS, "e_shots": TL.E_SHOTS, "e_muzzle": em,
        "e_fall": TL.E_FALL, "e_hit1": TL.E_HIT1,
        "light_local": [round(v, 5) for v in wl.location],
        "cam_local": [round(v, 5) for v in RM.CAM_LOCAL],
    }
    os.makedirs(OUT, exist_ok=True)
    json.dump(d, open(os.path.join(OUT, "demo_track.json"), "w"))
    print("TRACK OK", len(frames), d["light_local"])

if what in ("spill", "all"):
    enable_gpu(scn)
    scn.cycles.samples = 384
    scn.cycles.use_denoising = False
    scn.render.use_motion_blur = False
    env = [o for o in scn.objects if o.type == "MESH" and any(m and m.get("env_emission_node") for m in o.data.materials)]
    env_names = {o.name for o in env}
    keep = env_names | {"ExtGround", "ExtSky"}
    for o in scn.objects:
        if o.name not in keep:
            o.hide_render = True
            if o.animation_data:
                o.animation_data_clear(); o.hide_render = True
    # 天光对所有射线统一用"照明强度"
    wt = scn.world.node_tree
    for n in wt.nodes:
        if n.type == "MAP_RANGE":
            n.inputs["To Max"].default_value = n.inputs["To Min"].default_value
    # 扫描模型的法线朝外（房间内部看到的是背面）。烘焙只算正面，所以先把朝外的面翻进来
    import bmesh
    cen = Vector((21.2, 2.8, 2.6))
    for o in env:
        me = o.data
        bm = bmesh.new(); bm.from_mesh(me)
        mw = o.matrix_world; n3 = mw.to_3x3()
        inward = sum(1 for f in bm.faces if (n3 @ f.normal).dot(cen - (mw @ f.calc_center_median())) > 0)
        print("NORMALS", o.name, "faces", len(bm.faces), "inward frac", round(inward / max(1, len(bm.faces)), 3), "mats", [m.name for m in me.materials])
        flip = [f for f in bm.faces if (n3 @ f.normal).dot(cen - (mw @ f.calc_center_median())) <= 0]
        bmesh.ops.reverse_faces(bm, faces=flip)
        bm.to_mesh(me); bm.free(); me.update()
    # 分块 UV：第二张贴图的 UV 在 u=1..2，烘焙前挪回 0..1
    for o in env:
        uvl = o.data.uv_layers.active.data
        us = [uvl[i].uv[0] for i in range(0, len(uvl), max(1, len(uvl) // 500))]
        shift = math.floor(min(us) + 1e-4)
        print("UVRANGE", o.name, round(min(us), 3), round(max(us), 3), "shift", shift)
        if shift:
            for d_ in uvl:
                d_.uv[0] -= shift
    mats = {}
    for o in env:
        for m in o.data.materials:
            mats[m.name] = m
    targets = {}
    for name, m in mats.items():
        nt = m.node_tree
        img = bpy.data.images.new(f"spill_{name}", 2048, 2048, alpha=False, float_buffer=True)
        img.colorspace_settings.name = "Linear Rec.709" if "Linear Rec.709" in [c.name for c in type(img.colorspace_settings).bl_rna.properties["name"].enum_items] else "Non-Color"
        albedo_img = next(n.image for n in nt.nodes if n.type == "TEX_IMAGE" and n.image)
        nt.nodes.clear()
        tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
        alb = nt.nodes.new("ShaderNodeTexImage"); alb.image = albedo_img     # 反弹按真实墙面颜色衰减
        df = nt.nodes.new("ShaderNodeBsdfDiffuse"); nt.links.new(alb.outputs["Color"], df.inputs["Color"])
        out = nt.nodes.new("ShaderNodeOutputMaterial"); nt.links.new(df.outputs[0], out.inputs["Surface"])
        nt.nodes.active = tex
        targets[name] = img
    scn.render.bake.use_pass_direct = True; scn.render.bake.use_pass_indirect = True; scn.render.bake.use_pass_color = False
    scn.render.bake.margin = 12
    bpy.ops.object.select_all(action="DESELECT")
    for name, img in targets.items():
        objs = [o for o in env if any(m and m.name == name for m in o.data.materials)]
        for o in scn.objects:
            o.select_set(False)
        for o in objs:
            o.hide_set(False); o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        print("BAKE", name, [o.name for o in objs], flush=True)
        try:
            bpy.ops.object.bake(type="DIFFUSE")
        except Exception as e:
            print("BAKE_ERR", name, e, flush=True)
        p = os.path.join(OUT, "room", f"spill_{name}.hdr")
        img.filepath_raw = p; img.file_format = "HDR"; img.save()
        px = list(img.pixels[:4 * 2048 * 64])
        print("BAKED", name, p, "sample mean", round(sum(px) / len(px), 4))
    print("SPILL OK")
