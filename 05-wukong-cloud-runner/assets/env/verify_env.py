"""二次元 ENV 走廊净空检查。 Blender -b env.blend -P verify_env.py"""
import bpy, sys, os, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import env_height as EH
dg = bpy.context.evaluated_depsgraph_get()
cache = {}
P0 = np.array([-1500.0, float(EH.river_center(-1500.0)) + 40, 240.0]); P1 = np.array([-850.0, float(EH.river_center(-850.0)) + 190, 150.0])
P2 = np.array([-700.0, float(EH.river_center(-700.0)) + EH.BAND_D, float(EH.ground_height(-700.0, float(EH.river_center(-700.0)) + EH.BAND_D)) + 2])
def segd(w, a, b):
    v = b - a; t = np.clip(((w - a) @ v) / (v @ v), 0, 1)
    return np.linalg.norm(w - (a + t[:, None] * v), axis=1)
min_air = 1e9; min_desc = 1e9; min_river = 1e9; min_band = 1e9; n = 0; ntree = 0; tris = 0
for inst in dg.object_instances:
    ob = inst.object
    if ob.type != 'MESH':
        continue
    nm = ob.name
    M = np.array(inst.matrix_world)
    tris += len(ob.data.polygons)
    istree = nm[:2] in ('t0', 't1')
    if nm.startswith('plant_') or nm.startswith('ENV_Ground') or nm.startswith('ENV_Water') or nm.startswith('ENV_Far') or nm in ('ENV_Stream', 'ENV_Waterfall', 'ENV_FallMist'):
        continue
    n += 1
    me = ob.data
    if me.name not in cache:
        co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); cache[me.name] = co.reshape(-1, 3).astype(np.float64)
    co = cache[me.name]
    if len(co) == 0:
        continue
    w = co @ M[:3, :3].T + M[:3, 3]
    if istree:
        ntree += 1
        o = M[:3, 3]
        if -700 <= o[0] <= 0:
            min_band = min(min_band, abs(o[1] - float(EH.river_center(o[0])) - EH.BAND_D))
        if abs(o[0]) > 1500:
            continue
    min_air = min(min_air, segd(w, P0, P1).min())
    min_desc = min(min_desc, segd(w, P1, P2).min())
    m = (w[:, 0] > 100) & (w[:, 0] < 1150) & (w[:, 2] > -1)
    if m.any():
        min_river = min(min_river, np.abs(w[m, 1] - EH.river_center(w[m, 0])).min())
print('OBJ-INSTANCES checked', n, 'trees', ntree, 'total tris (instanced)', tris)
print('air corridor   min clearance (need >=35):', round(float(min_air), 1))
print('descent B->band min clearance:', round(float(min_desc), 1))
print('river x[100,1150] min |d| of any obstacle (need >=35):', round(float(min_river), 1))
print('band x[-700,0] nearest tree trunk to centerline (need >=12):', round(float(min_band), 1))
# 地形网格与 env_height 的一致性
g = bpy.data.objects['ENV_Ground'].data
co = np.zeros(len(g.vertices) * 3, np.float32); g.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
idx = np.random.default_rng(0).integers(0, len(co), 20000)
print('ground mesh vs ground_height max |dz|:', float(np.abs(EH.ground_height(co[idx, 0], co[idx, 1]) - co[idx, 2]).max()))
