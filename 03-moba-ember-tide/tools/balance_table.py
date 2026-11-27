#!/usr/bin/env python3
"""第九轮 balance：把 tools/balance_match.mjs 跑出来的几局（<目录>/*.json）汇总成按位置的表。
用法: python3 tools/balance_table.py <目录> [<目录2> …]          汇总这几个目录（只认跑完分出胜负的局）
      python3 tools/balance_table.py <改前目录> --vs <改后目录>    改前改后并排（每格“改前 → 改后”）
输出 markdown：两队（左下 0 队、右上 1 队）各赢几局、每局击杀和时长；每个位置两个英雄的胜率、KDA、10 分钟和结束时的身家、补刀、对英雄伤害、技能次数。"""
import sys, json, glob, os
POS = ["top", "jungle", "mid", "adc", "sup"]
POS_NAME = {"top": "上单", "jungle": "打野", "mid": "中单", "adc": "射手", "sup": "辅助"}
NAME = {"torg": "托尔格", "gorran": "葛隆", "lan": "岚", "kaz": "卡兹", "ugo": "乌戈", "osen": "奥森", "seren": "塞伦", "vero": "薇萝", "moko": "摩珂", "hedda": "赫达"}

def load(dirs):
    games = []
    for d in dirs:
        for f in sorted(glob.glob(os.path.join(d, "*.json"))):
            R = json.load(open(f))
            if R.get("end") and R["end"]["over"] in (1, -1): R["file"] = os.path.join(os.path.basename(os.path.normpath(d)), os.path.basename(f)); games.append(R)
    return games

def agg(games):
    st, side, kills, mins, fb, k10 = {}, [0, 0], [], [], [], []
    for R in games:
        e = R["end"]; win = 0 if e["over"] == 1 else 1; side[win] += 1; t = e["t"] / 60; mins.append(t); kills.append(e["kills"])
        ks = R.get("kills", []); fb.append(ks[0]["t"] / 60 if ks else t); k10.append(sum(1 for k in ks if k["t"] <= 600))
        at10 = {h["id"]: h for h in (R.get("at10") or [])}
        for h in e["heroes"]:
            s = st.setdefault((h["pos"], h["kit"]), {"n": 0, "w": 0, "k": 0, "d": 0, "a": 0, "w10": 0, "cs10": 0, "lv10": 0, "n10": 0, "wend": 0, "gpm": 0, "dmg": 0, "dpm": 0, "basic": 0, "skill": 0, "cs": 0, "camps": 0, "quest": 0, "mon": 0, "casts": {}})
            s["n"] += 1; s["w"] += h["team"] == win
            for k in ("k", "d", "a", "dmg", "basic", "skill", "cs", "camps"): s[k] += h[k]
            s["quest"] += h.get("quest", 0); s["mon"] += h.get("mon", 0)
            s["wend"] += h["worth"]; s["gpm"] += h["worth"] / t; s["dpm"] += h["dmg"] / t
            for k, v in h["casts"].items(): s["casts"][k] = s["casts"].get(k, 0) + v
            a = at10.get(h["id"])
            if a: s["n10"] += 1; s["w10"] += a["worth"]; s["cs10"] += a["cs"]; s["lv10"] += a["level"]
    n = max(1, len(games))
    head = {"n": len(games), "side": side, "kills": sum(a + b for a, b in kills) / n, "k0": sum(a for a, _ in kills) / n, "k1": sum(b for _, b in kills) / n, "k10": sum(k10) / n, "fb": sum(fb) / n, "min": sum(mins) / n, "lo": min(mins, default=0), "hi": max(mins, default=0)}
    rows = {}
    for (p, kit), s in st.items():
        g = s["n"]; n10 = max(1, s["n10"]); c = s["casts"]
        rows[(p, kit)] = {"n": g, "wr": 100 * s["w"] / g, "kda3": f"{s['k'] / g:.1f}/{s['d'] / g:.1f}/{s['a'] / g:.1f}", "kda": (s["k"] + s["a"]) / max(1, s["d"]), "d": s["d"] / g,
            "w10": s["w10"] / n10, "cs10": s["cs10"] / n10, "lv10": s["lv10"] / n10, "wend": s["wend"] / g, "gpm": s["gpm"] / g, "dmg": s["dmg"] / g, "dpm": s["dpm"] / g,
            "sk": 100 * s["skill"] / max(1, s["basic"] + s["skill"]), "casts": "/".join(f"{c.get(k, 0) / g:.0f}" for k in "QWER"), "quest": s["quest"] / g, "mon": s["mon"] / g, "camps": s["camps"] / g, "cs": s["cs"] / g}
    pos = {}
    for p in POS:
        ss = [s for (pp, _), s in st.items() if pp == p]; g = max(1, sum(s["n"] for s in ss)); n10 = max(1, sum(s["n10"] for s in ss))
        pos[p] = {"w10": sum(s["w10"] for s in ss) / n10, "wend": sum(s["wend"] for s in ss) / g, "gpm": sum(s["gpm"] for s in ss) / g, "dpm": sum(s["dpm"] for s in ss) / g, "lv10": sum(s["lv10"] for s in ss) / n10}
    return head, rows, pos

def headline(h, games):
    return (f"- 两边：左下 0 队赢 {h['side'][0]} 局，右上 1 队赢 {h['side'][1]} 局\n"
            f"- 每局击杀 {h['kills']:.1f}（0 队 {h['k0']:.1f}、1 队 {h['k1']:.1f}）；10 分钟前 {h['k10']:.1f} 个；一血平均 {h['fb']:.1f} 分钟；时长 {h['min']:.1f} 分钟（{h['lo']:.1f}–{h['hi']:.1f}）\n"
            "- 每局: " + "；".join(f"{os.path.basename(g['file'])[:-5]} {g['end']['t'] // 60}:{g['end']['t'] % 60:02d} {'0' if g['end']['over'] == 1 else '1'} 队赢 {g['end']['kills'][0]}:{g['end']['kills'][1]}" for g in games))

args = sys.argv[1:]
if "--vs" in args:
    i = args.index("--vs"); A, B = load(args[:i]), load(args[i + 1:]); (ha, ra, pa), (hb, rb, pb) = agg(A), agg(B)
    print(f"## 改前 {ha['n']} 局 → 改后 {hb['n']} 局（每格：改前 → 改后）\n\n改前\n{headline(ha, A)}\n\n改后\n{headline(hb, B)}\n")
    print("| 位置 | 英雄 | 胜率 | 场均 K/D/A | KDA | 10 分身家 | 结束身家 | 每分钟身家 | 对英雄伤害（场均） | 每分钟对英雄伤害 |\n|---|---|---|---|---|---|---|---|---|---|")
    for p in POS:
        for (pp, kit) in sorted(set(ra) | set(rb), key=lambda k: k[1]):
            if pp != p: continue
            a, b = ra.get((pp, kit)), rb.get((pp, kit))
            if not a or not b: continue
            print(f"| {POS_NAME[p]} | {NAME.get(kit, kit)} | {a['wr']:.0f}% → {b['wr']:.0f}% | {a['kda3']} → {b['kda3']} | {a['kda']:.2f} → {b['kda']:.2f} | {a['w10']:.0f} → {b['w10']:.0f} | {a['wend']:.0f} → {b['wend']:.0f} | {a['gpm']:.0f} → {b['gpm']:.0f} | {a['dmg']:.0f} → {b['dmg']:.0f} | {a['dpm']:.0f} → {b['dpm']:.0f} |")
    print("\n| 位置 | 10 分身家 | 10 分身家 / 射手 | 10 分等级 | 每分钟身家 | 每分钟身家 / 射手 | 每分钟对英雄伤害 |\n|---|---|---|---|---|---|---|")
    for p in POS:
        a, b = pa[p], pb[p]
        print(f"| {POS_NAME[p]} | {a['w10']:.0f} → {b['w10']:.0f} | {a['w10'] / pa['adc']['w10']:.2f} → {b['w10'] / pb['adc']['w10']:.2f} | {a['lv10']:.1f} → {b['lv10']:.1f} | {a['gpm']:.0f} → {b['gpm']:.0f} | {a['gpm'] / pa['adc']['gpm']:.2f} → {b['gpm'] / pb['adc']['gpm']:.2f} | {a['dpm']:.0f} → {b['dpm']:.0f} |")
    print("\n| 英雄 | 每局技能次数 Q/W/E/R | 技能伤害占比 |\n|---|---|---|")
    for (pp, kit) in sorted(set(ra) & set(rb), key=lambda k: (POS.index(k[0]), k[1])): print(f"| {NAME.get(kit, kit)} | {ra[(pp, kit)]['casts']} → {rb[(pp, kit)]['casts']} | {ra[(pp, kit)]['sk']:.0f}% → {rb[(pp, kit)]['sk']:.0f}% |")
    ex = [f"{NAME[k]} 辅助任务场均 {r['quest']:.0f} 金" for (p, k), r in sorted(rb.items()) if p == "sup"] + [f"{NAME[k]} 营地 {ra[(p, k)]['camps']:.0f} → {r['camps']:.0f}" for (p, k), r in sorted(rb.items()) if p == "jungle" and (p, k) in ra]
    print("\n- 改后：" + "；".join(ex))
    sys.exit()
games = load(args)
if not games: print("没有跑完的局"); sys.exit()
h, rows, pos = agg(games)
print(f"## {h['n']} 局（{', '.join(sorted(set(os.path.dirname(g['file']) for g in games)))}）\n\n{headline(h, games)}\n")
print("| 位置 | 英雄 | 局 | 胜率 | 场均 K/D/A | KDA | 10 分身家 | 10 分补刀 | 10 分等级 | 结束身家 | 每分钟身家 | 对英雄伤害 | 每分钟伤害 | 技能占比 | 每局技能次数 Q/W/E/R |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for p in POS:
    for (pp, kit), r in sorted(rows.items(), key=lambda kv: kv[0][1]):
        if pp != p: continue
        print(f"| {POS_NAME[p]} | {NAME.get(kit, kit)} | {r['n']} | {r['wr']:.0f}% | {r['kda3']} | {r['kda']:.2f} | {r['w10']:.0f} | {r['cs10']:.0f} | {r['lv10']:.1f} | {r['wend']:.0f} | {r['gpm']:.0f} | {r['dmg']:.0f} | {r['dpm']:.0f} | {r['sk']:.0f}% | {r['casts']} |")
print("\n| 位置 | 10 分身家 | 10 分等级 | 结束身家 | 每分钟身家 | 每分钟对英雄伤害 |\n|---|---|---|---|---|---|")
for p in POS: q = pos[p]; print(f"| {POS_NAME[p]} | {q['w10']:.0f} | {q['lv10']:.1f} | {q['wend']:.0f} | {q['gpm']:.0f} | {q['dpm']:.0f} |")
ex = [f"{NAME[k]} 辅助任务场均 {r['quest']:.0f} 金" for (p, k), r in sorted(rows.items()) if p == "sup"] + [f"{NAME[k]} 场均补刀 {r['cs']:.0f}（野怪 {r['mon']:.0f}）、营地 {r['camps']:.0f}" for (p, k), r in sorted(rows.items()) if p == "jungle"]
print("\n- " + "；".join(ex))
