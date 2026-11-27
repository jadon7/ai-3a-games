"""给一整条第一人称动画分段、找跳变。输出紧凑：每 1/15 秒一行（世界单位，厘米/度），以及单帧跳变清单。
  .venv/bin/python scripts/vm_clip_scan.py <scene.gltf> <枪身节点> <零件,...>
"""
import sys, numpy as np
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from vm_clip_probe import Clip
path, base, parts = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
c = Clip(path); bi = c.idx(base); pi = [c.idx(p) for p in parts]; lw = c.idx('L_wrist'); rw = c.idx('R_wrist')
N = int(round(c.dur * 30))
def frame(tt):
    cache = {}; B = c.world(bi, tt, cache); R = B[:3, :3] / np.linalg.norm(B[:3, 0]); o = B[:3, 3]
    rel = lambda i: R.T @ (c.world(i, tt, cache)[:3, 3] - o)
    return dict(o=o, R=R, parts=[rel(i) for i in pi], L=rel(lw), Rh=rel(rw))
F = [frame(k / 30) for k in range(N + 1)]
ang = lambda A, B: np.degrees(np.arccos(np.clip((np.trace(A.T @ B) - 1) / 2, -1, 1)))
ref = F[int(round(0.4 * 30))]
print('dur', round(c.dur, 3), 'frames', N, 'units: cm / deg, relative to pose at t=0.40')
for k in range(0, N + 1, 2):
    f = F[k]
    s = f"{k/30:5.2f} base {np.linalg.norm(f['o']-ref['o'])*100:5.1f} {ang(ref['R'], f['R']):5.1f}°"
    for nm, a, b in zip(parts, f['parts'], ref['parts']): s += f" {nm.split('_')[-1][:5]} {np.linalg.norm(a-b)*100:4.1f}"
    s += f" LH {np.linalg.norm(f['L']-ref['L'])*100:5.1f} RH {np.linalg.norm(f['Rh']-ref['Rh'])*100:4.1f}"
    print(s)
print('--- pops (single-frame jumps much larger than neighbours)')
def series(fn): return np.array([fn(F[k], F[k+1]) for k in range(N)])
S = {'base_pos': series(lambda a, b: np.linalg.norm(b['o']-a['o'])*100), 'base_rot': series(lambda a, b: ang(a['R'], b['R'])),
     'LH': series(lambda a, b: np.linalg.norm(b['L']-a['L'])*100), 'RH': series(lambda a, b: np.linalg.norm(b['Rh']-a['Rh'])*100)}
for nm, v in S.items():
    for k in range(1, N - 1):
        nb = max(v[k-1], v[k+1])
        if v[k] > 3 * nb + (0.8 if 'rot' not in nm else 2.0): print(f"  {nm} t={k/30:.2f}->{(k+1)/30:.2f} step={v[k]:.1f} (neighbours {v[k-1]:.1f},{v[k+1]:.1f})")
