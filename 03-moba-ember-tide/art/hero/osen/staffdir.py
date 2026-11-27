"""算解算结果里每一帧烛杖指向哪（世界坐标的单位向量：x 左为正，y 前方为负，z 向上），用来和视频里杖的方向对照。
烛杖蒙在右手的骨骼上，方向完全由手腕的朝向决定；手在 480p 的视频里只有十几个像素，这个朝向读得不准。
用法: python art/hero/osen/staffdir.py <标签> [帧,帧,…]"""
import importlib.util, os, sys, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; sys.path.insert(0, V)
spec = importlib.util.spec_from_file_location("pipeline", os.path.join(V, "scripts/pipeline.py")); pl = importlib.util.module_from_spec(spec); spec.loader.exec_module(pl)
L_REST = np.array([-0.2, -0.979, 0.023]); L_REST /= np.linalg.norm(L_REST)      # 静止姿势下杖身的方向（握持坐标的 +Y，见 hand_probe.py 的输出）
def quat_to_mat(q):
    w, x, y, z = np.moveaxis(q, -1, 0)
    return np.stack([np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], -1), np.stack([2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], -1), np.stack([2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], -1)], -2)
def world_rot(skel, quats):
    """局部四元数 (T,n,4) -> 每根骨骼的世界朝向 (T,n,3,3)，和 v2r.solver 的 fk 同一套约定"""
    Q = quat_to_mat(quats); T = len(Q); G = [None] * skel.n
    for i in range(skel.n):
        pa = int(skel.parent[i]); G[i] = (skel.R[i] @ Q[:, i]) if pa < 0 else (G[pa] @ skel.Rrel[i] @ Q[:, i])
    return np.stack(G, 1)
def staff_dir(skel, quats):
    names = [str(n) for n in skel.names]; h = names.index("mixamorig:RightHand"); G = world_rot(skel, quats)
    return G[:, h] @ skel.R[h].T @ L_REST
if __name__ == "__main__":
    skel = pl.load_skel("osen"); tag = sys.argv[1]; m = np.load(tag if tag.endswith(".npz") else os.path.join(V, "out/anim", "osen_" + tag, "motion.npz"), allow_pickle=True); tag = os.path.basename(tag)
    d = staff_dir(skel, m["quats"]); fr = [int(v) for v in sys.argv[2].split(",")] if len(sys.argv) > 2 else range(0, len(d), 6)
    for f in fr: print(f"{tag} 帧 {f:3d}  杖头方向 左{d[f,0]:+.2f} 前{-d[f,1]:+.2f} 上{d[f,2]:+.2f}   仰角 {np.degrees(np.arcsin(np.clip(d[f,2], -1, 1))):+4.0f}°")
