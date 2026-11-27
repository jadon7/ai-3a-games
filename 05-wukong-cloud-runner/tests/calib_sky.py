"""标定：1) Sky Texture 的 sun_rotation 与世界方向的对应；2) 天空强度（让受光白板≈1.0）。"""
import bpy, sys, os, math
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'common'))
import scene_common as sc
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
sc.setup_render(scene, res=(256, 128), samples=16, motion_blur=False, denoise=False)
world = sc.setup_world(scene, strength=1.0)
sky = next(n for n in world.node_tree.nodes if n.type == 'TEX_SKY')
print('SKY props:', [p.identifier for p in sky.bl_rna.properties if not p.is_readonly][:40])
print('sky_type =', sky.sky_type)

cam_d = bpy.data.cameras.new('pano')
cam_d.type = 'PANO'
try:
    cam_d.panorama_type = 'EQUIRECTANGULAR'
except Exception as e:
    print('pano err', e)
cam = bpy.data.objects.new('pano', cam_d)
scene.collection.objects.link(cam)
cam.rotation_euler = (math.radians(90), 0, 0)   # 朝 +Y，Z 向上
scene.camera = cam
scene.render.image_settings.file_format = 'OPEN_EXR'
out = os.path.join(sc.ROOT, 'tests', 'calib_pano.exr')
scene.render.filepath = out
scene.view_settings.view_transform = 'Standard'

for rot_deg in (0.0, 90.0):
    sky.sun_rotation = math.radians(rot_deg)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(out, check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    lum = px[..., :3].sum(-1)
    iy, ix = np.unravel_index(np.argmax(lum), lum.shape)
    # equirect：u=0..1 对应经度 -180..180（相机朝向在中心），v 对应纬度 -90..90
    lon = (ix + 0.5) / w * 360.0 - 180.0
    lat = (iy + 0.5) / h * 180.0 - 90.0
    # 相机朝 +Y；经度正方向在图像右侧 = 世界 +X
    az_from_y_to_x = lon
    print(f'ROT {rot_deg}: brightest lon={lon:.1f} lat={lat:.1f}  (方位：从 +Y 朝 +X 转 {az_from_y_to_x:.1f}°) max={lum.max():.1f}')
    bpy.data.images.remove(img)

# 白板受光强度
sky.sun_rotation = sc.SKY_SUN_ROTATION
bpy.data.objects.remove(cam)
cam_d = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cam_d)
scene.collection.objects.link(cam); scene.camera = cam
bpy.ops.mesh.primitive_plane_add(size=4)
pl = bpy.context.object
# 让白板正对太阳
pl.rotation_euler = sc.SUN_DIR.to_track_quat('Z', 'Y').to_euler()
m = bpy.data.materials.new('white'); m.use_nodes = True
b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
b.inputs['Base Color'].default_value = (0.8, 0.8, 0.8, 1); b.inputs['Roughness'].default_value = 1.0
pl.data.materials.append(m)
cam.location = sc.SUN_DIR * 6.0
cam.rotation_euler = sc.SUN_DIR.to_track_quat('Z', 'Y').to_euler()
scene.render.resolution_x, scene.render.resolution_y = 64, 64
scene.cycles.samples = 64
bpy.ops.render.render(write_still=True)
img = bpy.data.images.load(out, check_existing=False)
px = np.array(img.pixels[:], dtype=np.float32).reshape(64, 64, 4)
c = px[24:40, 24:40, :3].mean((0, 1))
print('WHITE CARD facing sun (strength=1): RGB =', c, ' lum=', float(c.mean()))
# 朝上的白板（只受天光+斜射阳光）
pl.rotation_euler = (0, 0, 0)
cam.location = (0, 0, 6); cam.rotation_euler = (0, 0, 0)
bpy.ops.render.render(write_still=True)
img = bpy.data.images.load(out, check_existing=False)
px = np.array(img.pixels[:], dtype=np.float32).reshape(64, 64, 4)
c = px[24:40, 24:40, :3].mean((0, 1))
print('WHITE CARD facing up (strength=1): RGB =', c, ' lum=', float(c.mean()))
