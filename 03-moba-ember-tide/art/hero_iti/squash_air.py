"""把腾空的动作（Q 三段的前空翻、R 的空中连砍）跳的高度压低。

为什么：即梦出的视频里她跳得极高（Q 三段胯从 0.5 升到 1.14 个身高、R 在 1.05 个身高的地方悬停两秒多），按 3.3 米的身高就是离地两米多。
游戏是约 50 度的俯视镜头，人往上跳两米等于直冲镜头、在画面里放大一圈还挡住别的东西，查看页的近景里人直接飞出画面。
做法：每帧量全身关节里最低的那个离地多高（腾空的高度 gap），把整个人（胯的位移和所有关节）往下挪 (1-k)·gap。
第一版只看脚：空翻倒立时脚在最上面，“脚离地”被算成 1.3 个身高，压过头了；改成看全身最低点。
只动离地的那部分，脚踩在地上的帧不动（不会把脚压进地里），起跳、落地是连续的。

用法: <V2R>/.venv/bin/python art/hero_iti/squash_air.py <动作>=<k> [<动作>=<k> …]     例: q3=0.45 r=0.55
      <V2R>/.venv/bin/python art/hero_iti/squash_air.py --undo <动作> …     按记下的位移原样还原
改的是 V2R/out/anim/iti_<动作>/motion.npz 里的 t 和 joints，记一个 air_squashed 标记，重复跑不会压两次（重新求解过的文件没有标记，会再压）。
"""
import json, os, sys
import numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"
jn = [j["name"] for j in json.load(open(os.path.join(V, "assets/model/iti_skeleton.json"), encoding="utf-8"))["joints"]]
undo = "--undo" in sys.argv
for arg in [a for a in sys.argv[1:] if a != "--undo"]:
    if undo:
        p = os.path.join(V, "out", "anim", f"iti_{arg}", "motion.npz"); m = dict(np.load(p, allow_pickle=True))
        if "air_dz" not in m: print(arg, "没压过"); continue
        dz = m.pop("air_dz"); m.pop("air_squashed", None); m["t"] = m["t"] - np.stack([0 * dz, 0 * dz, dz], 1); m["joints"] = m["joints"] - dz[:, None, None] * np.array([0, 0, 1.0]); np.savez(p, **m); print(arg, "还原了"); continue
    tag, k = arg.split("="); k = float(k)
    p = os.path.join(V, "out", "anim", f"iti_{tag}", "motion.npz"); m = dict(np.load(p, allow_pickle=True))
    if "air_squashed" in m: print(tag, "已经压过了"); continue
    J = m["joints"].astype(float); t = m["t"].astype(float)
    low = J[:, :, 2].min(1); floor = np.percentile(low, 10)                    # 全身最低点；踩在地上时它的高度取低的那一成（排除求解的抖动）
    gap = np.clip(low - floor - 0.01, 0, None)                                 # 腾空多高（1 厘米以内当作踩着地）
    dz = -(1 - k) * gap
    m["t"] = t + np.stack([np.zeros_like(dz), np.zeros_like(dz), dz], 1); m["joints"] = J + dz[:, None, None] * np.array([0, 0, 1.0])
    m["air_squashed"] = np.array(k); m["air_dz"] = dz; np.savez(p, **m)
    print(f"{tag}: 腾空最高 {gap.max():.2f} 个身高 → {gap.max() * k:.2f}（k={k}），胯最高 {t[:, 2].max():.2f} → {m['t'][:, 2].max():.2f}")
