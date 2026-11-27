"""套完动作以后的一步“身子不入地”：新模型腿短了（岩甲巨兽 B 的腿只有旧的六七成长），旧动作里压低前身、趴下的那几帧，胸口、肚皮、前臂会插进地里。
tools/retarget/retarget.py 只管脚（IK 锁地）、手撑地（人形）、头和尾巴这种“链”（ground_chains，从链根往上抬），不管躯干本身；
这里补上：每帧量除了四只脚以外的网格最低点，低于地面的那几帧把整个身子（根骨骼）抬上来，再用腿的两段 IK 把脚放回原来踩的位置（脚的朝向不变）。
源自己就插进地里的帧（按 k 缩放后一样深）不管，不和源较劲（和 ground_chains 的规矩一样）。
用法: <V2R 的 python> art/style_b/beasts/lift_body.py <case.json> <动作,动作…> [离地留多少（身高的比例）=0.005]
  改的是 <case 目录>/motions/ik/<动作>.npz（原件先存一份到 motions/ik_unlifted/），之后照常 measure、render、build。
"""
import json, os, sys, shutil
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../tools/retarget"))
import rig as R, retarget as RT

case_path = os.path.abspath(sys.argv[1]); base = os.path.dirname(case_path); case = json.load(open(case_path, encoding="utf-8"))
clips = sys.argv[2].split(","); margin = float(sys.argv[3]) if len(sys.argv) > 3 else 0.005
src = R.Rig(RT.P(case["src_rig"], base)); tgt = R.Rig(RT.P(case["tgt_rig"], base)); ctx = RT.build_ctx(src, tgt, case); k = ctx["k"]
sb = json.load(open(RT.P(case["src_build"]), encoding="utf-8")); mdir = os.path.join(RT.P(case.get("out_dir", "motions"), base), "ik"); bak = os.path.join(os.path.dirname(mdir), "ik_unlifted"); os.makedirs(bak, exist_ok=True)


def body_min(rg, D, Pp, feet_roots):
    """每帧除了脚（feet_roots 下面的骨骼管的顶点）以外的网格最低点离地多高"""
    feet = set()
    for e in feet_roots: feet |= set(rg.subtree(e))
    dom = rg.dominant(); idx = np.array([i for i in range(len(dom)) if dom[i] not in feet])[::2]
    return RT.skin(rg, RT.skin_mats(rg, D, Pp), idx)[..., 2].min(1) - rg.ground


rep = {}
for c in clips:
    p = os.path.join(mdir, c + ".npz"); b = os.path.join(bak, c + ".npz")
    if not os.path.exists(b): shutil.copy(p, b)
    names, q, loc, fps = R.load_motion(b); Q = R.to_rig_order(tgt, names, q); T = len(Q)
    D, Proot = RT.from_motion(tgt, Q, loc, ctx["tgt_root"]); Pp = RT.positions(tgt, D, Proot)
    sn, sq, sl, _ = R.load_motion(RT.P(sb["motions"][c])); SQ = R.to_rig_order(src, sn, sq); Ds, Ps = RT.from_motion(src, SQ, sl, ctx["src_root"])
    floor = np.minimum(0.0, k * body_min(src, Ds, RT.positions(src, Ds, Ps), [src.idx[lg["src_end"]] for lg in case["legs"]]))      # 源自己插进地里多深（按 k 缩放）
    ends = [lg["end"] for lg in ctx["legs"]]; H = tgt.height
    z0 = body_min(tgt, D, Pp, ends); need = np.maximum(floor + margin * H - z0, 0)
    loop = c in set(case.get("loops", ["idle", "run", "gallop"]))
    lift = RT.smooth1(np.array([need[max(0, i - 3):i + 4].max() for i in range(T)]), 2.0, loop)                          # 先取前后三帧的最大再平滑：峰值不被抹低，抬起和放下不跳
    for it in range(3):                                                                                                 # 腿伸直了够不着时脚会离地一点，抬完再量一遍，不够再补
        Pr = Proot.copy(); Pr[:, 2] += lift; Pn = RT.positions(tgt, D, Pr); Dn = D
        for lg in ctx["legs"]:
            Dn, _ = RT.two_bone(Dn, Pn, tgt, lg["upper"], lg["lower"], lg["end"], Pp[:, lg["end"]], lg.get("pole")); Pn = RT.positions(tgt, Dn, Pr)
        z1 = body_min(tgt, Dn, Pn, ends); more = np.maximum(floor + margin * H - z1, 0)
        if more.max() < 1e-4: break
        lift = lift + RT.smooth1(np.array([more[max(0, i - 3):i + 4].max() for i in range(T)]), 2.0, loop)
    # 脚有没有被带离地面（腿太短，抬完够不着原来的落脚点）
    foot_off = 0.0
    for lg in ctx["legs"]:
        e = lg["end"]; foot_off = max(foot_off, float(np.abs(Pn[:, e] - Pp[:, e]).max()))
    qn, ln = RT.to_motion(tgt, Dn, Pr, ctx["tgt_root"])
    if loop: qn[-1] = qn[0]; ln[-1] = ln[0]
    np.savez(p, names=np.array(tgt.names), quats=qn, loc=ln, fps=fps)
    rep[c] = {"身子最低(改前,身高%)": round(float((z0 - floor).min()) / H * 100, 1), "身子最低(改后,身高%)": round(float((z1 - floor).min()) / H * 100, 1), "抬起最多(身高%)": round(float(lift.max()) / H * 100, 1),
              "抬起的帧": int((lift > 0.002 * H).sum()), "脚离原落点最多(身高%)": round(foot_off / H * 100, 2)}
    print(c, json.dumps(rep[c], ensure_ascii=False))
rp = os.path.join(mdir, "lift_report.json"); old = json.load(open(rp)) if os.path.exists(rp) else {}; old.update(rep); json.dump(old, open(rp, "w"), ensure_ascii=False, indent=1)
