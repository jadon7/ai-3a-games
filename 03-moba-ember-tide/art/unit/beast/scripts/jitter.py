"""量成品动作抖不抖：每根受控骨骼相邻帧转了多少度，再看这个“转速”一帧一帧变化有多猛（度/帧²）。数字大的就是抽、抖。
用法: PY scripts/jitter.py [动作 …]      读 art/unit/beast/motions/<动作>.npz（30 帧每秒）"""
import sys, os, json
import numpy as np
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sk = json.load(open("/Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/model/beast_skeleton.json")); role = {b["name"]: b.get("role") for b in sk["bones"]}
for a in sys.argv[1:] or ["idle", "run", "attack1", "attack2", "roar", "death"]:
    m = np.load(f"{HERE}/motions/{a}.npz", allow_pickle=True); q = m["quats"].astype(float); names = [str(x) for x in m["names"]]
    q /= np.linalg.norm(q, axis=-1, keepdims=True); d = np.abs(np.sum(q[1:] * q[:-1], -1)).clip(0, 1); w = np.degrees(2 * np.arccos(d))      # (T-1,n) 每帧转了多少度
    acc = np.abs(np.diff(w, axis=0)); rows = [(float(acc[:, i].max()), float(np.sqrt((acc[:, i] ** 2).mean())), float(w[:, i].max()), int(acc[:, i].argmax()), n.split(":")[-1], role[n]) for i, n in enumerate(names) if role.get(n)]
    rows.sort(reverse=True); print(f"{a}（{len(q)} 帧）最抖的几根:  " + "；".join(f"{n}({r}) 转速突变最大 {mx:.1f}°/帧² @第{f}帧，最快 {wm:.1f}°/帧" for mx, rms, wm, f, n, r in rows[:5]))
