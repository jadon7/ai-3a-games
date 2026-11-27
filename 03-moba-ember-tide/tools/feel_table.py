#!/usr/bin/env python3
"""把 feel_measure.mjs 量出来的两份结果（改之前、改之后）排成对照表（Markdown），每个英雄每个动作一行，带目标值。
用法: python3 tools/feel_table.py <改之前.json> <改之后.json> > MEASURE.md"""
import sys, json
A, B = json.load(open(sys.argv[1])), json.load(open(sys.argv[2])) if len(sys.argv) > 2 else {}
NAME = {"lan": "岚", "torg": "托尔格", "moko": "摩珂", "gorran": "葛隆", "vero": "薇萝", "osen": "奥森"}
def f(v, unit="秒"):
    if v is None: return "—"
    if isinstance(v, bool): return "是" if v else "否"
    if isinstance(v, (int, float)):
        if v < 0: return "没有"
        return f"{v:.2f}" if unit == "秒" else f"{v}"
    return str(v)
def g(d, *ks):
    for k in ks:
        if not isinstance(d, dict) or k not in d: return None
        d = d[k]
    return d
rows = []
def row(hero, act, metric, ks, target, unit="秒"):
    rows.append(f"| {NAME.get(hero, hero)} | {act} | {metric} | {f(g(A.get(hero, {}), *ks), unit)} | {f(g(B.get(hero, {}), *ks), unit)} | {target} |")
print("| 英雄 | 动作 | 量的是什么 | 改之前 | 改之后 | 目标 |")
print("|---|---|---|---|---|---|")
for h in ["lan", "torg", "moko", "gorran", "vero", "osen"]:
    if h not in A and h not in B: continue
    row(h, "移动", "下命令到开始位移", ["move", "start"], "下一帧（≤0.02）")
    row(h, "移动", "到全速", ["move", "full"], "没有加速过程（≤0.02）")
    row(h, "移动", "按停到停住", ["move", "stop"], "下一帧")
    row(h, "转身", "原地掉头 180 度（朝向转到差 0.15 弧度内）", ["turn", "t180"], "≈0.1")
    row(h, "转身", "掉头时朝新方向走到九成速", ["turn", "newDirFull"], "转的同时就在走（≤0.03）")
    row(h, "普攻", "攻击间隔（1/攻速，测试场满级）", ["attack", "period"], "不变")
    row(h, "普攻", "下命令到出手（前摇）", ["attack", "windup"], "间隔的 15%–25%")
    row(h, "普攻", "前摇占间隔的百分比", ["attack", "windupPct"], "15–25", unit="%")
    row(h, "普攻", "出手后不下命令，多久回到空闲（收招）", ["attack", "backswing"], "可被移动取消")
    row(h, "普攻", "出手那一刻点移动，多久开始走", ["attack", "moveAfterHit"], "下一帧")
    row(h, "普攻", "连打 6 秒的平均出手间隔", ["attack", "meanGap"], "= 攻击间隔（每秒伤害不变）")
    for k in ["Q", "W", "E", "R"]:
        s = g(B.get(h, {}), "skills", k) or g(A.get(h, {}), "skills", k)
        if not s: continue
        row(h, f"技能 {k}", "按下到出手", ["skills", k, "fire"], "≈0.25（大招 ≤0.4；位移、开关类瞬发）")
        row(h, f"技能 {k}", "按下到第一下伤害", ["skills", k, "dmg"], "看技能（弹道要飞）")
        row(h, f"技能 {k}", "按下到开始位移", ["skills", k, "dash"], "位移技能 ≈ 出手")
        row(h, f"技能 {k}", "不下命令时被锁住多久", ["skills", k, "locked"], "出手后可取消（引导、冲刺除外）")
        row(h, f"技能 {k}", "按下后一直点移动，多久开始走", ["skills", k, "moveAfter"], "≈ 出手（引导、冲刺除外）")
        row(h, f"技能 {k}", "一直点移动，技能照样放出来", ["skills", k, "firedWhileSpamMove"], "是")
    row(h, "排队", "技能前摇里按下一个技能，放出来了", ["queue", "skillDuringSkill", "fired"], "是")
    row(h, "排队", "　　　第二个技能在按下第一个后几秒出手", ["queue", "skillDuringSkill", "at"], "≈ 第一个出手后下一帧")
    row(h, "排队", "技能前摇里点地面，走了", ["queue", "moveDuringSkill", "moved"], "是")
    row(h, "排队", "　　　按技能后几秒开始走", ["queue", "moveDuringSkill", "at"], "≈ 出手")
    row(h, "排队", "技能前摇里点小兵，打了", ["queue", "attackDuringSkill", "attacked"], "是")
    row(h, "鼠标", "左键按下（停 120 毫秒再松开）到开始走", ["mouse", "left"], "左键不再走路", unit="毫秒")
    row(h, "鼠标", "右键按下（停 120 毫秒再松开）到开始走", ["mouse", "right"], "按下就走（一帧，≤20 毫秒）", unit="毫秒")
print("\n".join(rows))
