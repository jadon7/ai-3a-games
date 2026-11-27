import bpy, sys, os
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'assets', 'char')); sys.path.insert(0, os.path.join(HERE, '..', 'common'))
import char_lib as cl
bpy.ops.wm.open_mainfile(filepath=os.path.join(HERE, '..', 'assets', 'char', 'wukong_real.blend'))
body = bpy.data.objects['WK_Body']; arm = bpy.data.objects['WK_Armature']
rgb, met = cl.sample_basecolor_to_vertices(body)
import bpy as _b
orm_img = next(i for i in _b.data.images if i.name.startswith('ORM'))

# 粗糙度
mat = body.data.materials[0]
b = cl.bsdf_of(mat)
n = len(rgb)
co = np.empty(n * 3, dtype=np.float32); body.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
mw = np.array(body.matrix_world); w = co @ mw[:3, :3].T + mw[:3, 3]
me = body.data
uvl = me.uv_layers.active.data; nl = len(me.loops)
luv = np.empty(nl * 2, dtype=np.float32); uvl.foreach_get('uv', luv); luv = luv.reshape(-1, 2)
lvi = np.empty(nl, dtype=np.int32); me.loops.foreach_get('vertex_index', lvi)
vuv = np.zeros((n, 2), dtype=np.float32); vuv[lvi] = luv
W_, H_ = orm_img.size
px = np.empty(W_ * H_ * 4, dtype=np.float32); orm_img.pixels.foreach_get(px); px = px.reshape(H_, W_, 4)
xi = np.clip((vuv[:, 0] % 1.0) * W_, 0, W_ - 1).astype(np.int32); yi = np.clip((vuv[:, 1] % 1.0) * H_, 0, H_ - 1).astype(np.int32)
orm = px[yi, xi, :3]
rough = orm[:, 1]; metal = orm[:, 2]
mx = rgb.max(1); mn = rgb.min(1); d = np.maximum(mx - mn, 1e-6)
r, g, bb = rgb[:, 0], rgb[:, 1], rgb[:, 2]
hue = np.where(mx == r, ((g - bb) / d) % 6, np.where(mx == g, (bb - r) / d + 2, (r - g) / d + 4)) * 60
sat = np.where(mx > 1e-5, (mx - mn) / np.maximum(mx, 1e-5), 0)
def bw(name, tail=False):
    bn = arm.data.bones['mixamorig:' + name]
    return np.array(arm.matrix_world @ (bn.tail_local if tail else bn.head_local))
def stat(label, p, rad=0.05):
    m = np.linalg.norm(w - p, axis=1) < rad
    if m.sum() < 5:
        print('STAT', label, 'no verts'); return
    q = lambda a: tuple(np.round(np.percentile(a[m], [10, 50, 90]), 2))
    q = lambda a: '/'.join('%.2f' % v for v in np.percentile(a[m], [10, 50, 90]))
    print('STAT %-13s n=%5d hue %s val %s rough %s metal %s' % (label, m.sum(), '/'.join('%.0f' % v for v in np.percentile(hue[m], [10, 50, 90])), q(mx), q(rough), q(metal)))
stat('forearmL_fur', (bw('LeftForeArm') * 0.55 + bw('LeftHand') * 0.45), 0.06)
stat('handR', bw('RightHandMiddle1'), 0.04)
stat('bracerR', (bw('RightForeArm') * 0.3 + bw('RightHand') * 0.7), 0.05)
stat('chest_armor', bw('Spine2') + np.array([0.13, 0, -0.05]), 0.06)
stat('shoulderL', bw('LeftArm') + np.array([0, 0, 0.06]), 0.06)
stat('bootL', bw('LeftFoot') + np.array([0, 0, 0.08]), 0.05)
stat('shinR_boot', (bw('RightLeg') * 0.5 + bw('RightFoot') * 0.5), 0.06)
stat('thigh_pants', (bw('RightUpLeg') * 0.4 + bw('RightLeg') * 0.6), 0.05)
stat('tiger_back', bw('Hips') + np.array([-0.16, 0, -0.18]), 0.07)
stat('tiger_front', bw('Hips') + np.array([0.16, 0, -0.2]), 0.07)
hd, ht = bw('Head'), bw('HeadTop_End')
fwd = (ht - hd); fwd[2] = 0; fwd /= np.linalg.norm(fwd)
hc = hd * 0.55 + ht * 0.45
stat('face_front', hc + fwd * 0.09 + np.array([0, 0, -0.01]), 0.035)
stat('head_back', hc - fwd * 0.10 + np.array([0, 0, 0.02]), 0.04)
stat('head_top', hc + np.array([0, 0, 0.11]), 0.04)
stat('red_sleeve', (bw('RightArm') * 0.5 + bw('RightForeArm') * 0.5), 0.05)
print('HEAD', np.round(hd, 3), np.round(ht, 3), 'fwd', np.round(fwd, 2), 'knee z', round(float(min(bw('LeftLeg')[2], bw('RightLeg')[2])), 3), 'hips z', round(float(bw('Hips')[2]), 3))
