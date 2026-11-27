"""几个试验并排的总表：每个试验每段动作一行，“源 → 只搬旋转 → 加 IK”的脚滑、陷地、身体最低、手插进身体、出手时刻差。
用法: python tools/retarget/overview.py <case 目录> [<case 目录> …] [--html]
"""
import sys, os, json

args = [a for a in sys.argv[1:] if not a.startswith("--")]; as_html = "--html" in sys.argv
rows = []
for cd in args:
    case = json.load(open(os.path.join(cd, "case.json"), encoding="utf-8")); d = json.load(open(os.path.join(cd, "measure.json"), encoding="utf-8"))
    for clip, c in d.items():
        labs = [k for k in c if k not in ("speed", "events")]
        def foot(lab, key):
            v = [x.get(key) for k, x in c[lab].items() if k.startswith("脚:") and x.get(key) is not None]; return max(v) if v else None
        run = any("该填runSpeed" in x for k, x in c["src"].items() if k.startswith("脚:"))
        def cell(key, fmt="{:.2f}"):
            out = []
            for lab in labs:
                v = foot(lab, key) if key in ("脚滑", "陷地cm", "飘cm", "现填runSpeed时脚滑", "按该填的数播时脚滑") else c[lab].get(key)
                out.append("-" if v is None else fmt.format(v) if isinstance(v, (int, float)) else str(v))
            return " → ".join(out)
        rs = ""
        if run:
            f = lambda lab: [x.get("该填runSpeed") for k, x in c[lab].items() if k.startswith("脚:") and x.get("该填runSpeed")]
            rs = " → ".join(f"{sum(f(l)) / len(f(l)):.1f}" if f(l) else "-" for l in labs)
        rows.append([case["name"], clip, cell("按该填的数播时脚滑" if run else "脚滑"), cell("陷地cm", "{:.1f}"), cell("身体最低cm", "{:.0f}"), cell("手和武器插进身体的帧%", "{:.0f}"),
                     " / ".join(str(c[l].get("出手时刻差(帧)", "")) for l in labs[1:]), rs])
head = ["试验", "动作", "脚滑 m/s（跑步：按该填 runSpeed 播时）", "陷地 cm", "身体最低 cm", "手插身体 帧%", "出手时刻差（帧）", "该填 runSpeed"]
if as_html:
    print("<table><tr>" + "".join(f"<th>{h}</th>" for h in head) + "</tr>" + "".join("<tr>" + "".join(f"<td>{x}</td>" for x in r) + "</tr>" for r in rows) + "</table>")
else:
    print("| " + " | ".join(head) + " |\n|" + "---|" * len(head))
    for r in rows: print("| " + " | ".join(r) + " |")
