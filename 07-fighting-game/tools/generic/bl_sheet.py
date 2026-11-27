"""无界面 Blender：把若干“带网格的角色 + 动画”渲成一格一格的小图，交给 sheet.py 拼成联系表。

用法:
  Blender -b --factory-startup -P tools/generic/bl_sheet.py -- <job.json>

job.json:
  {"out_dir": "...", "size": 220, "rows": [
      {"label": "src", "mesh": "带网格的 glb", "anim": null 或 "只有骨架的 glb（按骨骼名驱动 mesh 的骨架）",
       "clip": "动画名", "times": [0, 0.1, ...], "views": ["front", "side"], "follow": true}
  ]}
每格存成 <out_dir>/r<行>_<视角>_<列>.png。front 看脸，side 从角色的左手边看（角色朝右）。follow 时相机水平跟着胯走。
"""
import bpy, sys, json, os, math
from mathutils import Vector, Matrix

job = json.load(open(sys.argv[sys.argv.index("--") + 1:][0]))
MX = "mixamorig:"


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(p):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=p)
    return [o for o in bpy.data.objects if o not in before]


def setup_scene(size):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"; sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_shadows = False
    sc.render.resolution_x = size; sc.render.resolution_y = size; sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    wd = bpy.data.worlds.new("w"); sc.world = wd; wd.color = (0.55, 0.57, 0.6)
    me = bpy.data.meshes.new("ground"); s = 6
    me.from_pydata([(-s, -s, -0.002), (s, -s, -0.002), (s, s, -0.002), (-s, s, -0.002)], [], [(0, 1, 2, 3)])
    gr = bpy.data.objects.new("ground", me); sc.collection.objects.link(gr)
    mat = bpy.data.materials.new("groundmat"); mat.diffuse_color = (0.25, 0.27, 0.3, 1); me.materials.append(mat)
    # 地面上每隔 0.25 一条线，看脚滑
    for k in range(-12, 13):
        for axis in (0, 1):
            lm = bpy.data.meshes.new("l"); w = 0.004 if k else 0.01; x = k * 0.25
            v = [(x - w, -s, 0), (x + w, -s, 0), (x + w, s, 0), (x - w, s, 0)] if axis == 0 else [(-s, x - w, 0), (s, x - w, 0), (s, x + w, 0), (-s, x + w, 0)]
            lm.from_pydata(v, [], [(0, 1, 2, 3)]); lo = bpy.data.objects.new("l", lm); sc.collection.objects.link(lo)
            lmat = bpy.data.materials.get("linemat") or bpy.data.materials.new("linemat"); lmat.diffuse_color = (0.45, 0.47, 0.5, 1); lm.materials.append(lmat)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = "ORTHO"; cam.data.ortho_scale = job.get("ortho", 2.0); cam.data.clip_end = 100
    return sc, cam


def facing(arm):
    """角色正前方（世界坐标，水平）：左右脚尖方向的平均，取整到 90 度"""
    mw = arm.matrix_world; B = arm.data.bones; d = Vector()
    for s_ in ("Left", "Right"):
        if MX + s_ + "ToeBase" in B and MX + s_ + "Foot" in B:
            d += (mw @ B[MX + s_ + "ToeBase"].head_local) - (mw @ B[MX + s_ + "Foot"].head_local)
    d.z = 0
    a = round(math.atan2(d.y, d.x) / (math.pi / 2)) * (math.pi / 2)
    return Vector((math.cos(a), math.sin(a), 0))


for ri, row in enumerate(job["rows"]):
    clear(); sc, cam = setup_scene(job.get("size", 220))
    objs = import_glb(row["mesh"])
    arm = next(o for o in objs if o.type == "ARMATURE")
    for o in objs:
        if o.type not in ("ARMATURE", "MESH"): o.hide_render = True
    driver = arm
    if row.get("anim"):
        aobjs = import_glb(row["anim"])
        drv = next(o for o in aobjs if o.type == "ARMATURE"); driver = drv
        for o in aobjs: o.hide_render = True
        # 网格的骨架去掉自己的动画，按骨骼名“世界变换”抄驱动骨架
        if arm.animation_data: arm.animation_data.action = None
        for pb in arm.pose.bones:
            if pb.name in drv.pose.bones:
                c = pb.constraints.new("COPY_TRANSFORMS"); c.target = drv; c.subtarget = pb.name
    # 选动画
    ad = driver.animation_data
    act = bpy.data.actions.get(row["clip"]) or next((a for a in bpy.data.actions if a.name.startswith(row["clip"])), None)
    if act is None:
        names = [a.name for a in bpy.data.actions]
        act = next((a for a in bpy.data.actions if row["clip"] in a.name), None)
        assert act is not None, f"找不到动画 {row['clip']}，有 {names}"
    if ad is None: ad = driver.animation_data_create()
    if ad.nla_tracks:
        for tr in list(ad.nla_tracks): ad.nla_tracks.remove(tr)
    ad.action = act
    if hasattr(ad, "action_slot") and act.slots:
        try: ad.action_slot = act.slots[0]
        except Exception: pass
    fps = sc.render.fps = 30
    fwd = facing(arm); left = Vector((-fwd.y, fwd.x, 0))        # 角色左手边：正前方逆时针转 90 度
    for ci, t in enumerate(row["times"]):
        sc.frame_set(int(math.floor(t * fps)), subframe=(t * fps) % 1.0)
        bpy.context.view_layer.update()
        hp = driver.matrix_world @ driver.pose.bones[MX + "Hips"].head if row.get("follow", True) else Vector((0, 0, 0))
        c = Vector((hp.x, hp.y, job.get("cz", 0.5)))
        for v in row.get("views", ["front", "side"]):
            d = fwd if v == "front" else (left if v == "side" else (fwd + left).normalized())
            el = math.radians(job.get("elev", 4))
            cam.location = c + (d * math.cos(el) + Vector((0, 0, math.sin(el)))) * 10
            cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.join(job["out_dir"], f"r{ri:02d}_{v}_{ci:02d}.png")
            bpy.ops.render.render(write_still=True)
print("SHEET_DONE", len(job["rows"]))
