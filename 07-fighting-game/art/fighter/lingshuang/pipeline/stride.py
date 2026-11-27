"""量循环垫步一遍身体应该走多远（身高按 1）：每帧取较低（踩地）的那只脚，它相对胯往后（walk_f）/往前（walk_b）挪了多少，整圈累加。
用法: python stride.py <track.json> walk_f walk_b"""
import json, sys, numpy as np
D = json.load(open(sys.argv[1]))
for a in sys.argv[2:]:
    R = D[a]; T = len(R); tot = 0.0
    for i in range(1, T):
        f = min(("LA", "RA", "LF", "RF"), key=lambda k: R[i][k][2])
        side = f[0]; pts = [k for k in ("LA", "LF") if k[0] == side] if side == "L" else ["RA", "RF"]
        d = np.mean([(R[i][k][1] - R[i]["HIP"][1]) - (R[i - 1][k][1] - R[i - 1]["HIP"][1]) for k in pts]); tot += d
    print(a, f"一圈 {(T - 1) / 30:.2f}s，踩地脚相对胯往后挪了 {tot:+.3f}（正=往后蹬，身体向前）")
