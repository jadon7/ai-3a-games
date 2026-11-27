"""把 run_case.py 量出来的 measure.json 排成一张对照表（每段动作一行，源 / 各变体并排）。
用法: python tools/retarget/table.py <measure.json> [md|html]
"""
import json, sys


def foot_cells(m, run):
    feet = {k: v for k, v in m.items() if k.startswith("脚:")}
    if run:
        s = [v.get("该填runSpeed") for v in feet.values() if v.get("该填runSpeed") is not None]
        slip = [v.get("现填runSpeed时脚滑") for v in feet.values() if v.get("现填runSpeed时脚滑") is not None]
        fit = [v.get("按该填的数播时脚滑") for v in feet.values() if v.get("按该填的数播时脚滑") is not None]
        une = [v.get("一步内不匀") for v in feet.values() if v.get("一步内不匀") is not None]
        avg = lambda a: round(sum(a) / len(a), 2) if a else "-"
        return {"脚滑 m/s": f"{avg(slip)}（按{avg(s)}填 {avg(fit)}）", "陷地/飘 cm": "/".join(f"{max(v.get('陷地cm', 0) for v in feet.values()):.1f}" for _ in [0]) + "/" + f"{max(v.get('飘cm', 0) for v in feet.values()):.1f}", "备注": f"该填 runSpeed {avg(s)}，一步内不匀 {avg(une)}"}
    sl = [v.get("脚滑") for v in feet.values() if v.get("脚滑") is not None]; p90 = [v.get("脚滑p90") for v in feet.values() if v.get("脚滑p90") is not None]
    sink = max([v.get("陷地cm", 0) for v in feet.values()] or [0]); fl = max([v.get("飘cm", 0) for v in feet.values()] or [0])
    return {"脚滑 m/s": f"{max(sl) if sl else '-'}（p90 {max(p90) if p90 else '-'}）", "陷地/飘 cm": f"{sink:.1f}/{fl:.1f}", "备注": ""}


def main():
    d = json.load(open(sys.argv[1], encoding="utf-8")); fmt = sys.argv[2] if len(sys.argv) > 2 else "md"
    labs = [k for k in next(iter(d.values())).keys() if k not in ("speed", "events")]
    rows = []
    for clip, c in d.items():
        run = any("该填runSpeed" in v for k, v in c[labs[0]].items() if k.startswith("脚:"))
        for lab in labs:
            m = c[lab]; fc = foot_cells(m, run); ev = m.get("出手", {})
            evs = "；".join(f"{k.split('.')[-1]} 表{v['表上']} 最快{v['最快']} 手伸{v['手伸出']} 尖伸{v['尖伸出']}" for k, v in ev.items()) + (f"；差 {m['出手时刻差(帧)']} 帧" if "出手时刻差(帧)" in m else "")
            rows.append([clip, lab, fc["脚滑 m/s"], fc["陷地/飘 cm"], f"{m.get('身体最低cm', '-')}", f"{m.get('手和武器插进身体的帧%', '-')}", evs, fc["备注"]])
    head = ["动作", "版本", "脚滑 m/s（中位，p90）", "陷地/飘 cm", "身体最低 cm", "手插进身体 帧%", "出手（秒；伸出按身高）", "备注"]
    if fmt == "md":
        print("| " + " | ".join(head) + " |"); print("|" + "---|" * len(head))
        for r in rows: print("| " + " | ".join(r) + " |")
    else:
        print("<table><tr>" + "".join(f"<th>{h}</th>" for h in head) + "</tr>")
        for r in rows: print("<tr>" + "".join(f"<td>{x}</td>" for x in r) + "</tr>")
        print("</table>")


if __name__ == "__main__":
    main()
