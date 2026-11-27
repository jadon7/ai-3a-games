#!/usr/bin/env python3
# 换画风 B · b-fx 的证据：每个技能一张“改前一行 / 改后一行”的连续帧对比、一条左右并排的录像，再加总表。
# 用 /opt/homebrew/opt/python@3.14/bin/python3.14 跑。用法: bfx_evidence.py <证据目录（里面有 before/ after/）> [只做哪些，比如 lan/R,moko/W] [--no-video]
# 每个技能取哪段、几帧、裁哪块写在 SPEC 里（30 帧一秒；没写的取整段 8 帧、不裁）。
import os, sys, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from bfx_sheet import pair, table

NAME = {"lan": "岚", "torg": "托尔格", "moko": "摩珂", "osen": "奥森", "gorran": "葛隆", "vero": "薇萝", "seren": "塞伦", "ugo": "乌戈", "kaz": "卡兹", "hedda": "赫达"}
JOB = {"A": "普攻", "Q": "Q", "W": "W", "E": "E", "R": "R", "B": "回城", "S": "状态图标", "O": "脚下的圈（石板上）", "G": "脚下的圈（草地边）", "P": "被动"}
# 英雄/技能: (起帧, 止帧, 张数, 裁剪 x0,y0,x1,y1)。录像是 1280×720
SPEC = {
  "lan/A": (8, 60, 8, "240,100,1040,560"), "lan/Q": (6, 34, 8, "120,60,1180,660"), "lan/W": (6, 62, 8, "160,40,1120,640"), "lan/R": (10, 100, 10, "120,40,1220,700"),
  "lan/B": (2, 77, 6, "330,110,950,610"), "lan/S": (6, 29, 4, "200,40,1100,700"), "lan/O": (5, 11, 1, None),
  "torg/A": (8, 60, 8, "240,100,1040,560"), "torg/Q": (4, 40, 8, "180,40,1180,660"), "torg/W": (4, 56, 8, "120,0,1180,700"), "torg/R": (8, 140, 10, "100,0,1200,720"),
  "moko/A": (8, 60, 8, "160,60,1120,600"), "moko/Q": (4, 56, 8, "200,40,1100,700"), "moko/W": (6, 130, 8, "200,40,1100,700"), "moko/E": (6, 56, 8, "100,60,1200,660"), "moko/R": (6, 190, 10, "80,0,1200,720"),
  "osen/A": (8, 60, 8, "160,60,1120,600"), "osen/Q": (4, 44, 8, "100,60,1200,660"), "osen/W": (6, 104, 8, "120,40,1160,660"), "osen/E": (6, 146, 8, "160,20,1180,700"), "osen/R": (6, 118, 10, "80,0,1200,720"),
  "gorran/A": (8, 60, 8, "240,100,1040,560"), "gorran/Q": (4, 50, 8, "100,0,1180,660"), "gorran/W": (10, 128, 8, "160,20,1160,700"), "gorran/E": (4, 180, 8, "120,20,1180,700"), "gorran/R": (4, 196, 10, "60,0,1220,720"), "gorran/B": (2, 77, 6, "330,110,950,610"),
  "vero/A": (8, 60, 8, "160,60,1120,600"), "vero/Q": (4, 66, 8, "60,40,1220,680"), "vero/W": (4, 76, 8, "100,40,1180,680"), "vero/E": (4, 196, 8, "100,20,1180,700"), "vero/R": (4, 130, 8, "60,20,1220,700"),
  "seren/A": (4, 56, 8, "120,60,1160,660"), "seren/P": (2, 38, 6, "120,60,1160,660"), "seren/Q": (2, 70, 8, "80,40,1200,680"), "seren/W": (4, 82, 8, "100,40,1180,680"), "seren/E": (2, 46, 8, "100,40,1180,680"), "seren/R": (2, 64, 8, "60,40,1220,680"),
  "ugo/A": (4, 52, 8, "120,40,1160,680"), "ugo/Q": (2, 38, 8, "80,40,1200,680"), "ugo/W": (4, 64, 8, "100,40,1180,680"), "ugo/E": (6, 144, 8, "100,40,1180,680"), "ugo/R": (4, 76, 8, "80,40,1200,680"),
  "kaz/A": (6, 70, 8, "120,60,1160,660"), "kaz/Q": (2, 50, 8, "80,40,1200,680"), "kaz/W": (2, 50, 8, "120,40,1160,680"), "kaz/E": (2, 58, 8, "100,40,1180,680"), "kaz/R": (4, 100, 8, "80,40,1200,680"),
  "hedda/A": (6, 70, 8, "120,60,1160,660"), "hedda/Q": (2, 50, 8, "80,40,1200,680"), "hedda/W": (4, 88, 8, "100,40,1180,680"), "hedda/E": (2, 70, 8, "80,40,1200,680"), "hedda/R": (4, 166, 10, "60,0,1220,720"), "hedda/P": (4, 76, 8, "100,40,1180,680"),
}
FF = {**os.environ, "DYLD_LIBRARY_PATH": "/opt/homebrew/Cellar/x265/4.2/lib"}
import tempfile
TMP = os.environ.get("BFX_TMP", os.path.join(tempfile.gettempdir(), "bfx_frames"))      # 从录像里抽出来的帧放哪（用完可以删）

def frames_of(side_dir, key, job):
    """逐帧目录：有就直接用；没有（磁盘紧，录完只留了录像）就从录像里抽到临时目录"""
    d = os.path.join(side_dir, key, job)
    if os.path.isdir(d) and any(f.endswith(".jpg") for f in os.listdir(d)): return d
    mp4 = d + ".mp4"
    if not os.path.exists(mp4): return None
    t = os.path.join(TMP, os.path.basename(side_dir), key, job)
    if not (os.path.isdir(t) and os.listdir(t)):
        os.makedirs(t, exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-start_number", "0", "-q:v", "2", os.path.join(t, "f_%03d.jpg")], env=FF, check=True)
    return t

def one_frame(side_dir, key, job, f):
    """总表只要一帧：有逐帧就用，没有就从录像里只抽这一帧（全抽一遍要一两个 G）"""
    p = os.path.join(side_dir, key, job, f"f_{f:03d}.jpg")
    if os.path.exists(p): return p
    mp4 = os.path.join(side_dir, key, job + ".mp4")
    if not os.path.exists(mp4): return ""
    t = os.path.join(TMP, "one", os.path.basename(side_dir), key); os.makedirs(t, exist_ok=True); o = os.path.join(t, f"{job}_{f:03d}.jpg")
    if not os.path.exists(o): subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp4, "-vf", f"select=eq(n\\,{f})", "-vframes", "1", "-q:v", "2", o], env=FF, check=True)
    return o if os.path.exists(o) else ""

def run(root, only=None, video=True):
    B, A = os.path.join(root, "before"), os.path.join(root, "after")
    import shutil
    for key in sorted(os.listdir(A)):
        hd = os.path.join(A, key)
        if not os.path.isdir(hd) or key == "end": continue
        for job in sorted({f[:-4] if f.endswith(".mp4") else f for f in os.listdir(hd)}):
            k = f"{key}/{job}"
            if only and k not in only: continue
            jd, bd = frames_of(A, key, job), frames_of(B, key, job)
            if not jd or not bd: continue
            a, b, n, c = SPEC.get(k, (0, len(os.listdir(jd)) - 1, 8, None))
            nb = len([f for f in os.listdir(jd) if f.endswith(".jpg")]); b = min(b, nb - 1)
            title = f"{NAME.get(key, key)} · {JOB.get(job, job)}　（上：改前 style-b，下：改后 b-fx；同一机位、同一对局时刻）"
            pair(bd, jd, os.path.join(root, f"对比_{key}_{job}.jpg"), title, f"{a},{b}", n, c or "", 380 if n >= 8 else 520)
            if video and os.path.exists(os.path.join(A, key, job + ".mp4")) and os.path.exists(os.path.join(B, key, job + ".mp4")):
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(B, key, job + ".mp4"), "-i", os.path.join(A, key, job + ".mp4"),
                  "-filter_complex", "[0:v]scale=960:-2,pad=iw+8:ih:0:0:color=0x101214[l];[1:v]scale=960:-2[r];[l][r]hstack=inputs=2",      # 左改前、右改后（本机 ffmpeg 没有 drawtext，字不写在画面上）
                  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", os.path.join(root, "并排", f"{key}_{job}.mp4")], env=FF, check=False)
            print("好", k)

# 总表用的代表帧（每个技能最看得出来的那一帧）
REP = {"lan": {"A": 20, "Q": 12, "W": 8, "R": 30, "B": 60, "S": 15, "O": 6, "G": 6}, "torg": {"A": 20, "Q": 8, "W": 10, "R": 40},
       "moko": {"A": 30, "Q": 25, "W": 40, "E": 24, "R": 100}, "osen": {"A": 30, "Q": 20, "W": 40, "E": 43, "R": 100},
       "gorran": {"A": 20, "Q": 15, "W": 75, "E": 40, "R": 60, "B": 60}, "vero": {"A": 30, "Q": 25, "W": 10, "E": 40, "R": 90},
       "seren": {"A": 20, "P": 10, "Q": 25, "W": 60, "E": 10, "R": 30}, "ugo": {"A": 20, "Q": 15, "W": 30, "E": 60, "R": 30},
       "kaz": {"A": 30, "Q": 20, "W": 10, "E": 10, "R": 40}, "hedda": {"A": 30, "Q": 10, "W": 45, "E": 15, "R": 30, "P": 40}}

def summary(root, cols=6, w=300):
    """总表_改前改后.jpg：每格左改前、右改后（同一帧、同一裁剪）；总表_改后.jpg：只有改后"""
    from PIL import Image, ImageDraw
    from bfx_sheet import cellimg, font
    pairs, afters = [], []
    for h, jobs in REP.items():
        for j, f in jobs.items():
            k = f"{h}/{j}"; fa, fb = one_frame(os.path.join(root, "after"), h, j, f), one_frame(os.path.join(root, "before"), h, j, f)
            if not fa: continue
            c = SPEC.get(k, (0, 0, 0, None))[3]; title = f"{NAME[h]} · {JOB.get(j, j)}"
            a = cellimg(fa, c, w); b = cellimg(fb, c, w) if os.path.exists(fb) else Image.new("RGB", a.size, (30, 30, 30))
            pairs.append((title, b, a)); afters.append((title, a))
    def grid(items, n, cw, out, two):
        ch = max((it[1].height for it in items)); rows = (len(items) + n - 1) // n; cellw = cw * (2 if two else 1) + (4 if two else 0)
        sheet = Image.new("RGB", (n * cellw + (n - 1) * 8, rows * (ch + 30) + (rows - 1) * 8 + 44), (16, 18, 20)); dr = ImageDraw.Draw(sheet)
        dr.text((10, 8), "换画风 B · b-fx：十个英雄的技能、普攻、回城、状态、脚下圈" + ("（每格左改前、右改后）" if two else "（改后）"), font=font(24), fill=(240, 240, 232))
        for i, it in enumerate(items):
            x, y = (i % n) * (cellw + 8), 44 + (i // n) * (ch + 38)
            dr.text((x + 4, y + 2), it[0], font=font(18), fill=(240, 240, 232))
            sheet.paste(it[1].resize((cw, ch)), (x, y + 28))
            if two: sheet.paste(it[2].resize((cw, ch)), (x + cw + 4, y + 28))
        sheet.save(out, quality=86)
    grid(pairs, 4, w, os.path.join(root, "总表_改前改后.jpg"), True)
    grid(afters, cols, w, os.path.join(root, "总表_改后.jpg"), False)

if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[2] == "--summary": summary(sys.argv[1]); sys.exit(0)
    root = sys.argv[1]; only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else None
    os.makedirs(os.path.join(root, "并排"), exist_ok=True)
    run(root, only, "--no-video" not in sys.argv)
