"""环境：照片扫描房间 + 门外天光 + 渲染基础设置。"""
import bpy, os, math
from mathutils import Vector
from common import ROOT, ASSETS, coll, import_gltf, enable_gpu

FLOOR_Z = 0.42
AMB = 1.0     # 扫描贴图自带的环境光强度（发光）
WIN = 11.0    # 过曝的窗户发光倍数
TINT = (1.0, 1.0, 1.0)   # 环境光色调（暮色时偏冷）


def setup_render(scn, spp=96, res=(1920, 1080), mblur=True):
    enable_gpu(scn)
    c = scn.cycles
    c.samples = spp
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.02
    c.use_denoising = True
    try:
        c.denoiser = "OPENIMAGEDENOISE"
        c.denoising_use_gpu = True
    except Exception as e:
        print("denoiser cfg", e)
    c.max_bounces = 6
    c.diffuse_bounces = 3
    c.glossy_bounces = 3
    c.transmission_bounces = 4
    c.transparent_max_bounces = 128
    c.volume_bounces = 0
    c.sample_clamp_indirect = 8.0
    c.sample_clamp_direct = 0.0
    c.caustics_reflective = False
    c.caustics_refractive = False
    scn.render.use_persistent_data = True
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.resolution_percentage = 100
    scn.render.fps = 30
    scn.render.use_motion_blur = mblur
    scn.render.motion_blur_shutter = 0.5
    scn.view_settings.view_transform = "Standard"
    scn.view_settings.look = "None"


def build_env_material(mat):
    nt = mat.node_tree
    img = next(n.image for n in nt.nodes if n.type == "TEX_IMAGE" and n.image)
    nt.nodes.clear()
    N = nt.nodes.new; L = nt.links.new
    tex = N("ShaderNodeTexImage"); tex.image = img
    bw = N("ShaderNodeRGBToBW"); L(tex.outputs["Color"], bw.inputs[0])
    mr = N("ShaderNodeMapRange"); mr.interpolation_type = "SMOOTHSTEP"
    mr.inputs["From Min"].default_value = 0.86; mr.inputs["From Max"].default_value = 0.985
    L(bw.outputs[0], mr.inputs["Value"])
    # 发光强度：墙面 AMB，窗户 WIN
    es = N("ShaderNodeMapRange")
    es.inputs["To Min"].default_value = AMB; es.inputs["To Max"].default_value = WIN
    L(mr.outputs[0], es.inputs["Value"])
    tn = N("ShaderNodeMix"); tn.data_type = "RGBA"; tn.blend_type = "MULTIPLY"; tn.inputs["Factor"].default_value = 1.0
    L(tex.outputs["Color"], tn.inputs["A"]); tn.inputs["B"].default_value = (*TINT, 1)
    em = N("ShaderNodeEmission"); L(tn.outputs["Result"], em.inputs["Color"]); L(es.outputs[0], em.inputs["Strength"])
    # 可被动态光照亮的漫反射层
    mix = N("ShaderNodeMix"); mix.data_type = "RGBA"
    L(mr.outputs[0], mix.inputs["Factor"]); L(tex.outputs["Color"], mix.inputs["A"])
    mix.inputs["B"].default_value = (0.015, 0.018, 0.02, 1)
    rough = N("ShaderNodeMapRange"); rough.inputs["To Min"].default_value = 0.88; rough.inputs["To Max"].default_value = 0.06
    L(mr.outputs[0], rough.inputs["Value"])
    bs = N("ShaderNodeBsdfPrincipled")
    L(mix.outputs["Result"], bs.inputs["Base Color"]); L(rough.outputs[0], bs.inputs["Roughness"])
    add = N("ShaderNodeAddShader"); L(em.outputs[0], add.inputs[0]); L(bs.outputs[0], add.inputs[1])
    out = N("ShaderNodeOutputMaterial"); L(add.outputs[0], out.inputs["Surface"])
    mat["env_emission_node"] = em.name


def build_env():
    c = coll("Env")
    new, _ = import_gltf(os.path.join(ASSETS, "env_manufactory", "scene.gltf"), c)
    meshes = [o for o in new if o.type == "MESH"]
    mats = set()
    for o in meshes:
        for m in o.data.materials:
            mats.add(m)
        o.visible_shadow = True
    for m in mats:
        build_env_material(m)
    return meshes


def link_env_light(meshes, receiver_coll):
    """扫描房间的发光只照亮 CG 物体，不重复照亮自己。"""
    for o in meshes:
        o.light_linking.receiver_collection = receiver_coll


def build_world(scn, cam_gain=7.0, light_gain=1.6, rot_z=0.0):
    w = bpy.data.worlds.new("World"); scn.world = w; w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    N = nt.nodes.new; L = nt.links.new
    tc = N("ShaderNodeTexCoord"); mp = N("ShaderNodeMapping"); mp.inputs["Rotation"].default_value = (0, 0, rot_z)
    L(tc.outputs["Generated"], mp.inputs["Vector"])
    env = N("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(os.path.join(ASSETS, "hdri", "abandoned_slipway_4k.hdr"))
    L(mp.outputs["Vector"], env.inputs["Vector"])
    lp = N("ShaderNodeLightPath")
    st = N("ShaderNodeMapRange"); st.inputs["To Min"].default_value = light_gain; st.inputs["To Max"].default_value = cam_gain
    L(lp.outputs["Is Camera Ray"], st.inputs["Value"])
    wt = N("ShaderNodeMix"); wt.data_type = "RGBA"; wt.blend_type = "MULTIPLY"; wt.inputs["Factor"].default_value = 1.0
    L(env.outputs["Color"], wt.inputs["A"]); wt.inputs["B"].default_value = (*TINT, 1)
    bg = N("ShaderNodeBackground"); L(wt.outputs["Result"], bg.inputs["Color"]); L(st.outputs[0], bg.inputs["Strength"])
    out = N("ShaderNodeOutputWorld"); L(bg.outputs[0], out.inputs["Surface"])
    return w


def make_bodycam(scn, c):
    cd = bpy.data.cameras.new("Bodycam")
    cam = bpy.data.objects.new("Bodycam", cd); c.objects.link(cam)
    cd.type = "PANO"
    try:
        cd.panorama_type = "FISHEYE_EQUISOLID"
        cd.fisheye_lens = 17.3; cd.fisheye_fov = math.radians(180)
    except Exception:
        cd.cycles.panorama_type = "FISHEYE_EQUISOLID"
        cd.cycles.fisheye_lens = 17.3; cd.cycles.fisheye_fov = math.radians(180)
    cd.sensor_width = 36; cd.sensor_fit = "HORIZONTAL"
    cd.clip_start = 0.02; cd.clip_end = 300
    cam.rotation_mode = "XYZ"
    scn.camera = cam
    return cam
