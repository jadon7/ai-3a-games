import sys, glob
from PIL import Image
d, acts, out = sys.argv[1], sys.argv[2].split(","), sys.argv[3]; views = sys.argv[4].split(",") if len(sys.argv) > 4 else ["close", "side"]
rows = []
for a in acts:
    for v in views:
        fs = sorted(glob.glob(f"{d}/{a}_{v}_*.jpg")); ims = [Image.open(f).convert("RGB") for f in fs]; ims = [i if v.startswith("w") else i.crop((60, 40, 340, 380)) for i in ims]      # 拉远的机位（wide、wside）不裁
        r = Image.new("RGB", (sum(i.size[0] for i in ims), ims[0].size[1])); x = 0
        for i in ims: r.paste(i, (x, 0)); x += i.size[0]
        rows.append(r)
sh = Image.new("RGB", (rows[0].size[0], sum(r.size[1] for r in rows))); y = 0
for r in rows: sh.paste(r, (0, y)); y += r.size[1]
sh.thumbnail((2000, 2000)); sh.save(out, quality=86); print(sh.size)
