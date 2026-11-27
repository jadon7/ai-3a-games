"""量时间点：读 fix_motion.py 写的 <动作>_track.json，每帧打印枪的水平朝向、俯仰、枪口高度、枪口速度、俯仰角速度、胯高，
并标出“枪口水平、朝前”（|yaw|<20 且 |pitch|<15）的帧和俯仰角速度最大的帧（开枪那一震：枪口往上跳）。
用法: python3 art/hero/seren/measure.py <动作名> [每几帧打一行=1]
"""
import json, sys, math
name = sys.argv[1]; step = int(sys.argv[2]) if len(sys.argv) > 2 else 1
tr = json.load(open(f"/Users/jadon7/Documents/SynologyDrive/code/moba/art/hero/seren/motions_fix/{name}_track.json")); fps = 30.0; T = len(tr)
sp = [0.0] + [math.dist(tr[i]["tip"], tr[i - 1]["tip"]) * fps for i in range(1, T)]
dp = [0.0] + [(tr[i]["pitch"] - tr[i - 1]["pitch"]) * fps for i in range(1, T)]
k = max(range(T), key=lambda i: dp[i])
print(f"{name}: {T} 帧 {(T - 1) / fps:.2f} 秒；俯仰角速度最大在第 {k} 帧（{k / fps:.2f} 秒，{dp[k]:.0f} 度/秒）；枪口速度最大在第 {max(range(T), key=lambda i: sp[i])} 帧")
for i in range(0, T, step):
    a = tr[i]; fwd = abs(a["yaw"]) < 20 and abs(a["pitch"]) < 15
    print(f"  {i:3d} {i / fps:4.2f}s  yaw {a['yaw']:+6.1f} pitch {a['pitch']:+6.1f}  枪口高 {a['tip'][2] + a['lift']:.3f} 前 {-a['tip'][1]:+.3f}  速 {sp[i]:5.2f}  俯仰速 {dp[i]:+6.0f}  胯 {a['hips'] + a['lift']:.3f} {'← 端平朝前' if fwd else ''}")
