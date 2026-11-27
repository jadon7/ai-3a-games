"""套完动作以后的一步“腾空时腿不锁”：tools/retarget/retarget.py 的脚 IK 在每一帧都把脚底的离地高度照源的放（踩地的帧锁水平位置，腾空的帧也管高度）。
源里整只跳起来的动作（石背巨蟾的重击：跳起来再砸下）在空中的那几帧，新旧模型的腿长、根骨骼高度对不上，脚的高度照源的放会把腿拧到身子上面
（巨蟾落地前四帧，右后腿竖着戳到背上方 0.11 个身高）。腾空的脚本来就不用锁，这里把那几帧的腿换回“只搬旋转”的结果：
每条腿按源里这只脚离地多高定一个权重（贴地 1、离地超过 lift_hi 个身高 0），腿的三节骨骼在“只搬旋转”(fk) 和“加脚 IK”(ik) 两套之间按权重插值；
根骨骼的位置（IK 那步可能把胯放低了）按四条腿里最大的权重插值。权重在时间上平滑过，不跳。
用法: <V2R 的 python> art/style_b/beasts/blend_air.py <case.json> <动作,动作…> [lift_lo=0.06] [lift_hi=0.2]
  改的是 <case 目录>/motions/ik/<动作>.npz（原件先存一份到 motions/ik_unblended/）。要和 lift_body.py 一起用时先跑这个、再跑 lift_body。
"""
import json, os, sys, shutil
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../tools/retarget"))
import rig as R, retarget as RT

case_path = os.path.abspath(sys.argv[1]); base = os.path.dirname(case_path); case = json.load(open(case_path, encoding="utf-8"))
clips = sys.argv[2].split(","); lo = float(sys.argv[3]) if len(sys.argv) > 3 else 0.06; hi = float(sys.argv[4]) if len(sys.argv) > 4 else 0.2
src = R.Rig(RT.P(case["src_rig"], base)); tgt = R.Rig(RT.P(case["tgt_rig"], base)); ctx = RT.build_ctx(src, tgt, case)
sb = json.load(open(RT.P(case["src_build"]), encoding="utf-8")); mroot = RT.P(case.get("out_dir", "motions"), base); bak = os.path.join(mroot, "ik_unblended"); os.makedirs(bak, exist_ok=True)
for c in clips:
    p = os.path.join(mroot, "ik", c + ".npz"); b = os.path.join(bak, c + ".npz")
    if not os.path.exists(b): shutil.copy(p, b)
    n_i, q_i, l_i, fps = R.load_motion(b); n_f, q_f, l_f, _ = R.load_motion(os.path.join(mroot, "fk", c + ".npz"))
    Qi = R.to_rig_order(tgt, n_i, q_i); Qf = R.to_rig_order(tgt, n_f, q_f); T = len(Qi)
    sn, sq, sl, _ = R.load_motion(RT.P(sb["motions"][c])); SQ = R.to_rig_order(src, sn, sq); Ds, Ps = RT.from_motion(src, SQ, sl, ctx["src_root"]); Sm = RT.skin_mats(src, Ds, RT.positions(src, Ds, Ps))
    loop = c in set(case.get("loops", ["idle", "run", "gallop"])); Q = Qi.copy(); W = []
    for lg in ctx["legs"]:
        zs = (RT.skin(src, Sm, lg["src_feet"])[..., 2].min(1) - src.ground) / src.height
        w = RT.smooth1(np.clip((hi - zs) / (hi - lo), 0, 1), 2.0, loop); W.append(w)
        for bn in (lg["upper"], lg["lower"], lg["end"]):
            a = Qf[:, bn]; bq = Qi[:, bn]; d = np.sum(a * bq, -1, keepdims=True); bq = np.where(d < 0, -bq, bq)
            m = a * (1 - w[:, None]) + bq * w[:, None]; Q[:, bn] = m / np.linalg.norm(m, axis=-1, keepdims=True)
    wr = np.max(W, 0)[:, None]; L = l_f * (1 - wr) + l_i * wr
    np.savez(p, names=np.array(tgt.names), quats=R.continuous(Q), loc=L, fps=fps)
    print(c, "腾空换回只搬旋转的帧（四条腿最大权重 < 0.5）:", int((wr[:, 0] < 0.5).sum()), "/", T, "；各腿权重 < 0.5 的帧:", [int((w < 0.5).sum()) for w in W])
