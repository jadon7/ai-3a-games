"""尾迹过 25° 转弯处的检查：烘焙两帧（重复调用验证缓存与确定性），俯视渲染一张。"""
import bpy, sys, os, math, time
import numpy as np
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'common')); sys.path.insert(0, os.path.join(ROOT, 'assets', 'clouds'))
import scene_common as sc, trail_lib
import openvdb as vdb
scene = bpy.context.scene
sc.setup_render(scene, res=(1920, 804), pct=50, samples=16, vol_bounces=4, motion_blur=False)
sc.setup_world(scene)
for c in ('CLOUDSEA', 'HAZE', 'JDY'):
    bpy.data.collections[c].hide_render = True
pts = []
c25, s25 = math.cos(math.radians(25)), math.sin(math.radians(25))
for i in range(0, 1551):
    pts.append((-2500 + i * 2.0, 0.0, 100.0))
for i in range(1, 1100):
    pts.append((600 + c25 * i * 2.0, s25 * i * 2.0, 100.0))
cd = bpy.data.curves.new('Path', 'CURVE'); cd.dimensions = '3D'
sp = cd.splines.new('POLY'); sp.points.add(len(pts) - 1)
for p, q in zip(sp.points, pts):
    p.co = (*q, 1.0)
path = bpy.data.objects.new('Path', cd); scene.collection.objects.link(path)
speed = 45.0
f = int(round(1 + 3140.0 / speed * 24.0))          # 悟空过弯后约 40 m
t0 = time.time()
objs = trail_lib.add_vapor_trail(scene, path, speed, f, f + 1, 24, 1, name='BendTrail')
t1 = time.time()
cdir = os.path.join(ROOT, 'assets', 'clouds', 'trail_cache', 'BendTrail')
g1 = vdb.read(os.path.join(cdir, 'BendTrail_far_0001.vdb'), 'density')
a1 = g1.activeVoxelCount(); bb = g1.evalActiveVoxelBoundingBox()
trail_lib.add_vapor_trail(scene, path, speed, f, f + 1, 24, 1, name='BendTrail', rebake=True)
g2 = vdb.read(os.path.join(cdir, 'BendTrail_far_0001.vdb'), 'density')
print('BEND bake %.2fs  far active %d  bbox(m) %s .. %s  rebake identical=%s' % (
    t1 - t0, a1, tuple(round(v * 0.15, 1) for v in bb[0]), tuple(round(v * 0.15, 1) for v in bb[1]), a1 == g2.activeVoxelCount()), flush=True)
cam_d = bpy.data.cameras.new('c'); cam = bpy.data.objects.new('c', cam_d); scene.collection.objects.link(cam); scene.camera = cam
cam_d.lens = 28; cam_d.clip_end = 200000
cam.location = (585, 5, 100 + 105); cam.rotation_euler = (0, 0, 0)
scene.frame_set(f)
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = os.path.join(HERE, 'real_cloud_trail_bend.png')
t0 = time.time(); bpy.ops.render.render(write_still=True)
print('RENDER_TIME trail_bend (只有尾迹) 960x402 s=16 %.1fs' % (time.time() - t0), flush=True)
