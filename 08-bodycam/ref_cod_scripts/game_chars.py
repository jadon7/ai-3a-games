"""Export game-ready enemy characters (decimated, 2K textures, all 8 Tripo clips) and a low-poly enemy rifle.
Run: Blender -b -P scripts/game_chars.py -- enemy_a|enemy_b|rifle"""
import bpy, os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import ROOT, TRIPO, coll
import fps_rig as fr

argv = sys.argv[sys.argv.index("--") + 1:]
WHAT = argv[0]
GA = os.path.join(ROOT, "game", "assets")
bpy.ops.wm.read_factory_settings(use_empty=True)
c = coll("Export")


def shrink_images(maxs):
    for im in bpy.data.images:
        if im.size[0] > maxs:
            im.scale(maxs, maxs)


def decimate(ob, target):
    n = len(ob.data.polygons)
    if n > target:
        md = ob.modifiers.new("dec", "DECIMATE")
        md.ratio = target / n
        md.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier="dec")
    print(ob.name, "faces", n, "->", len(ob.data.polygons))


if WHAT.startswith("enemy"):
    target = int(argv[1]) if len(argv) > 1 else 30000
    arm, mesh, acts = fr.import_character(WHAT, ["rig_model_url.glb", "anim_loop_model_url.glb", "anim_react_model_url.glb"], c,
                                          height=1.0, name=WHAT)
    print("ACTIONS", {k: (v.name, tuple(v.frame_range)) for k, v in acts.items()})
    decimate(mesh, target)
    shrink_images(2048)
    arm.scale = (1, 1, 1)
    # put every action on its own NLA track so the exporter writes them all
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = None
    for k, a in acts.items():
        nm = k.replace("preset:", "")
        a.name = nm
        tr = ad.nla_tracks.new(); tr.name = nm
        st = tr.strips.new(nm, int(a.frame_range[0]), a)
        try:
            st.action_slot = a.slots[0]
        except Exception:
            pass
        tr.mute = True
    for o in bpy.context.view_layer.objects:
        o.select_set(o in (arm, mesh))
    bpy.context.view_layer.objects.active = arm
    out = os.path.join(GA, WHAT + ".glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_animations=True,
                              export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_skins=True,
                              export_image_format="JPEG", export_jpeg_quality=88, export_yup=True, export_apply=False,
                              export_def_bones=False, export_optimize_animation_size=True)
    print("WROTE", out, os.path.getsize(out) / 1e6)
elif WHAT == "rifle":
    rifle = fr.import_rifle("Rifle", c)
    decimate(rifle, int(argv[1]) if len(argv) > 1 else 24000)
    shrink_images(1024)
    rifle.scale = (fr.RIFLE_SCALE,) * 3
    bpy.context.view_layer.objects.active = rifle
    for o in bpy.context.view_layer.objects:
        o.select_set(o is rifle)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    out = os.path.join(GA, "rifle_lod.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_image_format="JPEG",
                              export_jpeg_quality=85, export_yup=True)
    print("WROTE", out, os.path.getsize(out) / 1e6)
