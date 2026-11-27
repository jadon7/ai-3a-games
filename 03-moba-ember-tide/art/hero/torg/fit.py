#!/usr/bin/env python3
"""调站姿用：让两只手落到杆身上。
build.json 的 stance.arms 里多写两个只有这个脚本认的键（hero_build.py 不看）：
  Right._grip  武器的握点（右手握的位置）要在哪；武器指向是 Right.blade
  Left._s      左手握在柄的哪一段（离铁环底的距离）
脚本反复“摆站姿 → 量 → 挪手腕”，直到两只手都对上（差 2 毫米以内），把手腕的位置和左手的 blade 写回 build.json。
用法: python3 art/hero/torg/fit.py [最多几轮=6] [left_flip]      left_flip：左手反着握（拳眼背着钟）
"""
import json, os, subprocess, sys
MOBA = "/Users/jadon7/Documents/SynologyDrive/code/moba"; D = f"{MOBA}/art/hero/torg"; CFG = f"{D}/build.json"
BL = "/Applications/Blender.app/Contents/MacOS/Blender"
rounds = int(sys.argv[1]) if len(sys.argv) > 1 else 6; flip = "left_flip" in sys.argv
out = ""
for it in range(rounds):
    r = subprocess.run([BL, "-b", "--factory-startup", "-P", f"{MOBA}/tools/blender/hero_build.py", "--", CFG, "game"], capture_output=True, text=True)      # 只重摆站姿（共用脚本的 game 一步；掌心靠 build.json 的 palm_by_hand）
    if "SAVED" not in r.stdout: sys.exit("站姿没摆出来:\n" + r.stdout[-2000:] + r.stderr[-2000:])
    r = subprocess.run([BL, "-b", "--factory-startup", "-P", f"{D}/check.py", "--", f"{D}/game.glb", f"{D}/chk/c", CFG], capture_output=True, text=True, env={**os.environ, "NORENDER": "1"})
    fit = {l.split()[1]: [float(x) for x in l.split()[2:5]] for l in r.stdout.splitlines() if l.startswith("FIT ")}
    if "Right" not in fit and "Left" not in fit: break
    cfg = json.load(open(CFG, encoding="utf-8")); arms = cfg["stance"]["arms"]; err = 0.0
    for side in ("Right", "Left"):
        if side in fit:
            d = fit[side]; err = max(err, max(abs(x) for x in d)); arms[side]["wrist"] = [round(a + b, 5) for a, b in zip(arms[side]["wrist"], d)]
    if "Axis" in fit: arms["Left"]["blade"] = [round(-x if flip else x, 4) for x in fit["Axis"]]
    print(f"第 {it + 1} 轮：手还差 {err * 1000:.1f} 毫米")
    if err < 0.002: break
    json.dump(cfg, open(CFG, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
# 对上以后再量一遍、渲染检查图
r = subprocess.run([BL, "-b", "--factory-startup", "-P", f"{D}/check.py", "--", f"{D}/game.glb", f"{D}/chk/c", CFG], capture_output=True, text=True, env={**os.environ, "RES": "560"})
print("\n".join(l for l in r.stdout.splitlines() if (l.split(" ")[0] in ("SHAFT", "HAND", "SHOULDER", "GROUND", "CLIP", "CLIP_TOTAL", "GAP", "Traceback") and "正常" not in l) or l.startswith("   0.") or l.startswith("   1.")))
subprocess.run(["/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python", f"{D}/chk/sheet.py", f"{D}/chk/c", f"{D}/chk/s"])
