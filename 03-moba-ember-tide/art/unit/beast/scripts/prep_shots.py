"""一次性的动作（attack1 顶角、attack2 人立砸地、roar 咆哮、death 死亡）整理成源动作。
  · 脚留在原地的动作：把脚钉在站姿的位置上重解一遍（读出来的脚会前后挪、上下抖），重解时蒙皮以后的网格不许到地面以下。
  · 只变速、不剪断（剪断接缝两边高度不一样会陷进地里）。
  · 出手以后尾巴慢慢收回来（两段攻击的原视频后面还有一段左右甩尾，brief 说不要），首尾对回站姿。
  · 整体高度贴地。
用法: PY scripts/prep_shots.py [只做哪几段 …]      产出 art/unit/beast/src/<动作>.npz 和 src/marks.json（关键时刻在源动作里的秒数，24 帧每秒）
"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from lib import load, save, retime, ease_to, ease_from, frame, TAIL, fk, pin_feet, ground_fix_mesh, skin_z, FEET_F, FEET_H, gauss

V = lib.V2R; HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mpath = f"{HERE}/src/marks.json"; marks = json.load(open(mpath)) if os.path.exists(mpath) else {}
SPEC = {
    # 顶角：站姿 → 压低（快放）→ 低处蓄着（更快）→ 向上顶（原速）→ 回正
    "attack1": dict(src="beast_gore", pin=[(FEET_F + FEET_H, [(36, 120)], 4.0)], yaw_calm=(58, 74), tail_calm=(72, 92), tail_smooth=2.0, settle=(84, 97), start=(42, 45),
                    spec=[(42, 51, 1.5), (51, 62, 3.0), (62, 74, 1.0), (74, 97, 1.5)], marks={"swing": 62, "hit": 68.5, "top": 72}),
    # 人立砸地：压低前身（快放）→ 起身（原速）→ 人立挥蹄（快放）→ 砸下（原速）→ 缓冲、收回
    "attack2": dict(src="beast_rear", pin=[(FEET_H, None, 4.0), (FEET_F, [(0, 22), (89, 120)], 4.0)], yaw_calm=(78, 90), tail_calm=(90, 106), tail_smooth=2.0, settle=(96, 109), start=(0, 3), damp=(lib.FORELEGS, 42, 72, 0.5),
                    spec=[(0, 24, 2.4), (24, 38, 1.0), (38, 44, 1.6), (44, 68, 2.6), (68, 74, 1.6), (74, 86, 1.0), (86, 109, 1.25)], marks={"rise": 24, "up": 38, "swing": 74, "hit": 84}),
    # 咆哮：压低后坐（快放）→ 猛地仰头前压（原速）→ 保持（快放）→ 收回
    "roar": dict(src="beast_roar", pin=[(FEET_F + FEET_H, None, 4.0)], tail_smooth=2.0, settle=(96, 106), start=(0, 3),
                 spec=[(0, 24, 2.0), (24, 36, 1.0), (36, 78, 2.2), (78, 106, 1.3)], marks={"swing": 24, "release": 31, "hold_end": 78}),
    # 死亡：摇晃（稍快）→ 前腿跪下、胸口贴地（原速）→ 停顿（快放）→ 后腿趴下、头和尾巴落地（原速）→ 停住。脚要往前后滑出去，不钉，只管网格不入地；
    # 读出来趴下以后下巴离地还有七八厘米（游戏里的尺寸），把头的目标再压低一点，贴到地上
    "death": dict(src="beast_death", pin=[], start=(0, 3), kw=dict(w_floor=400.0, nudge=[(["Nose", "Head", "LeftHorn", "RightHorn"], (72, 82), -0.014)]),
                  spec=[(0, 28, 1.5), (28, 44, 1.0), (44, 64, 3.0), (64, 84, 1.0), (84, 92, 1.0)], marks={"kneel": 40, "down": 80}),
}
for name, c in SPEC.items():
    if sys.argv[1:] and name not in sys.argv[1:]: continue
    print(name)
    mo = load(f"{V}/out/anim/{c['src']}/motion.npz")
    if "pin" in c: mo = pin_feet(mo, c["pin"], ref=0, **c.get("kw", {}))
    stand = frame(mo, len(mo["theta"]) - 1); stand0 = frame(mo, 0)      # 视频末尾、开头的站姿（死亡的末尾是趴着的，开头只能用第 0 帧）
    if c.get("damp"): lib.damp(mo, *c["damp"])                                    # 人立时前蹄的扑腾压小
    if c.get("yaw_calm"): ease_to(mo, *c["yaw_calm"], stand, dofs=[k for k in TAIL if lib.DN[k].endswith("yaw")])      # 尾巴左右甩的那部分先收（出手那一下它跟着身体上下动可以，左右抽不行）
    if c.get("tail_calm"): ease_to(mo, *c["tail_calm"], stand, dofs=TAIL)       # 再整条收回站姿
    if c.get("tail_smooth"): mo["theta"][:, TAIL] = gauss(mo["theta"][:, TAIL], c["tail_smooth"])      # 尾巴的角度沿时间磨一下（读出来有一两帧的抽动）
    if c.get("settle"): ease_to(mo, *c["settle"], stand, root=True)              # 全身回站姿
    out, at = retime(mo, c["spec"])
    if c.get("start"): ease_from(out, 0, max(2, int(round(at(c["start"][1]) - at(c["start"][0]))) + 2), stand0)
    lo, hi = ground_fix_mesh(out)
    Jo = save(f"{HERE}/src/{name}.npz", out); g = skin_z(out).min(1)
    marks[name] = {k: round(at(v) / out["fps"], 3) for k, v in c["marks"].items()} | {"len": round((len(Jo) - 1) / out["fps"], 3)}
    print(f"  {len(Jo)} 帧 {marks[name]}  网格最低点: 整体贴地前 {lo:+.4f} ~ {hi:+.4f} → 贴地后 {g.min():+.4f} ~ {g.max():+.4f}")
json.dump(marks, open(mpath, "w"), ensure_ascii=False, indent=1)
