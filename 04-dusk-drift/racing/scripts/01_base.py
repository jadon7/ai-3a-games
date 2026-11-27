# 场景基础：清空、渲染设置、HDRI 天空、太阳方向分析
import bpy, math, os
import numpy as np

ROOT = "/Users/jadon7/Library/Application Support/Claude/scratch-workspaces/dfe2b44a-8503-4a5e-af9b-63b1be0e053b/aae3434b-694f-413f-a991-1f79c427025e/scratch-2026-11-21-ab6c85/racing"
HDRI_8K = os.path.join(ROOT, "assets/hdri/lilienstein_8k.exr")
HDRI_1K = os.path.join(ROOT, "assets/hdri/lilienstein_1k.hdr")

# ---- 清空默认物体
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.lights, bpy.data.cameras):
    for b in list(coll):
        if b.users == 0:
            coll.remove(b)

sc = bpy.context.scene
sc.unit_settings.system = 'METRIC'
sc.render.fps = 24
sc.frame_start = 1
sc.frame_end = 180
sc.render.resolution_x = 1920
sc.render.resolution_y = 1080
sc.render.resolution_percentage = 100

# ---- Cycles
try:
    sc.render.engine = 'CYCLES'
except TypeError as e:
    print("engine err", e)
cy = sc.cycles
cy.device = 'GPU'
cy.samples = 160
cy.use_adaptive_sampling = True
cy.adaptive_threshold = 0.02
cy.use_denoising = True
try:
    cy.denoiser = 'OPENIMAGEDENOISE'
    cy.denoising_use_gpu = True
except Exception as e:
    print("denoiser", e)
cy.max_bounces = 8
cy.diffuse_bounces = 3
cy.glossy_bounces = 4
cy.transmission_bounces = 8
cy.volume_bounces = 1
cy.transparent_max_bounces = 12
cy.caustics_reflective = False
cy.caustics_refractive = False
cy.sample_clamp_indirect = 8.0
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.5
sc.render.use_persistent_data = True
sc.render.film_transparent = False
cy.filter_width = 1.5

# ---- 色彩管理
vs = sc.view_settings
try:
    vs.view_transform = 'AgX'
except TypeError as e:
    print("vt", e)
looks = [i.identifier for i in type(vs).bl_rna.properties['look'].enum_items]
print("looks sample:", looks[:12])
for cand in ('AgX - Medium High Contrast', 'Medium High Contrast', 'AgX - Base Contrast'):
    try:
        vs.look = cand
        print("look ->", cand)
        break
    except TypeError:
        pass

# ---- 太阳方向：分析 1K HDRI
img = bpy.data.images.load(HDRI_1K, check_existing=True)
w, h = img.size
px = np.empty(w * h * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(h, w, 4)
lum = px[..., 0] * 0.2126 + px[..., 1] * 0.7152 + px[..., 2] * 0.0722
iy, ix = np.unravel_index(np.argmax(lum), lum.shape)
# 取最亮的 0.05% 像素做加权中心，更稳
thr = np.quantile(lum, 0.9995)
ys, xs = np.nonzero(lum >= thr)
wts = lum[ys, xs]
cx = float((xs * wts).sum() / wts.sum())
cyy = float((ys * wts).sum() / wts.sum())
u = (cx + 0.5) / w
v = (cyy + 0.5) / h
phi = (u - 0.5) * 2 * math.pi
lat = (v - 0.5) * math.pi
dx = -math.cos(phi) * math.cos(lat)
dy = math.sin(phi) * math.cos(lat)
dz = math.sin(lat)
az = math.degrees(math.atan2(dy, dx))
print("sun pixel peak:", ix, iy, "max lum:", float(lum.max()), "centroid uv:", round(u, 4), round(v, 4))
print("sun dir (unrotated):", round(dx, 3), round(dy, 3), round(dz, 3), "azimuth deg:", round(az, 2), "elev deg:", round(math.degrees(lat), 2))
sun_rgb = px[iy, ix, :3]
print("sun rgb at peak:", [float(c) for c in sun_rgb])
print("mean lum:", float(lum.mean()), "upper hemi mean:", float(lum[h // 2:].mean()))

sc["hdri_sun_az"] = az
sc["hdri_sun_el"] = math.degrees(lat)

# ---- World 节点
world = bpy.data.worlds.get("RaceWorld") or bpy.data.worlds.new("RaceWorld")
sc.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
tc = nt.nodes.new("ShaderNodeTexCoord")
mp = nt.nodes.new("ShaderNodeMapping")
mp.name = "HDRI_Mapping"
env = nt.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(HDRI_8K, check_existing=True)
bg = nt.nodes.new("ShaderNodeBackground")
bg.name = "HDRI_BG"
bg.inputs["Strength"].default_value = 1.0
out = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
nt.links.new(env.outputs["Color"], bg.inputs["Color"])
nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
print("BASE_OK")
