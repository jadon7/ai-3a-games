"""写实 ENV 走廊净空检查。 Blender -b env_real.blend -P verify_real.py"""
import bpy, math, numpy as np
HX, HY = math.cos(math.radians(25)), math.sin(math.radians(25))
def segd(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))
def cd(px, py):
    return np.minimum(segd(px, py, -2500, 0, 600, 0), segd(px, py, 600, 0, 600 + 2200 * HX, 2200 * HY))
dg = bpy.context.evaluated_depsgraph_get()
cache = {}; res = {}; n = 0; nt = 0; tris = 0
for inst in dg.object_instances:
    ob = inst.object
    if ob.type != 'MESH':
        continue
    tris += len(ob.data.polygons)
    nm = ob.name
    if nm[:2] in ('t0', 't1', 't2') or nm.startswith(('tripo_', 'twig_', 'ENV_HeroPine')):
        nt += 1; continue
    n += 1
    me = ob.data
    if me.name not in cache:
        co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); cache[me.name] = co.reshape(-1, 3).astype(np.float64)
    co = cache[me.name]
    if not len(co):
        continue
    M = np.array(inst.matrix_world)
    w = co @ M[:3, :3].T + M[:3, 3]
    m = w[:, 2] > 20
    if not m.any():
        continue
    d = float(cd(w[m, 0], w[m, 1]).min())
    key = nm if nm.startswith(('gate', 'pine_rock')) else 'others'
    res[key] = min(res.get(key, 1e9), d)
print('mesh instances', n, 'tree instances', nt, 'tris(instanced total)', tris)
for k, v in sorted(res.items()):
    print(f'  min corridor clearance {k}: {v:.1f} m')
