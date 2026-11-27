#!/usr/bin/env python3
"""宣传片的剪辑：按下面的剪辑表（EDL）把素材一段段切出来、叠字，再接成一条片子。
用法: python3 tools/trailer/edit.py [版本名=v2]
输出 docs/trailer/trailer.mp4（crf 19）和 docs/trailer/trailer_web.mp4（压到 14 MB 以内）。中间的分段在 docs/trailer/raw/seg/。
只用硬切和叠化；游戏画面不加任何推拉（镜头的运动都是游戏里录出来的匀速运动）。
"""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(ROOT, "docs/trailer/raw")
CARDS = os.path.join(RAW, "cards")
SEG = os.path.join(RAW, "seg")
os.makedirs(SEG, exist_ok=True)
FPS = 30


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(" ".join(cmd)[:2000])
        print(r.stderr[-3000:])
        sys.exit(1)


def probe_dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p], capture_output=True, text=True).stdout)


def seg(i, s):
    """一个镜头 → 一个 1920×1080、30 帧、无损近似的分段文件。
    s: {src: 素材(raw 下的文件名) 或 seq: 图片序列目录, at: 入点秒, dur: 时长, speed: 播放倍速(默认1),
        dim: 压暗(0~1), ov: [{png, t0, t1, fade}] 叠层, phone: True 套手机外框}"""
    out = os.path.join(SEG, f"{i:02d}.mp4")
    dur = s["dur"]
    inputs, fc = [], []
    if "seq" in s:
        inputs += ["-framerate", str(FPS), "-start_number", str(int(round(s.get("at", 0) * FPS))), "-i", os.path.join(CARDS, s["seq"], "%03d.png")]
        fc.append("[0:v]fps=30,format=yuv444p,setsar=1[base0]")
    elif "color" in s:
        inputs += ["-f", "lavfi", "-i", f"color=c={s['color']}:s=1920x1080:r=30:d={dur}"]
        fc.append("[0:v]format=yuv444p[base0]")
    else:
        sp = s.get("speed", 1.0)
        inputs += ["-ss", f"{s['at']:.3f}", "-t", f"{dur * sp + 0.2:.3f}", "-i", os.path.join(RAW, s["src"])]
        chain = f"[0:v]setpts=(PTS-STARTPTS)/{sp},fps=30"
        if s.get("phone"):
            # 手机画面缩进外框的屏幕里，背景是同一段画面放大、糊掉、压暗
            chain = f"[0:v]setpts=(PTS-STARTPTS)/{sp},fps=30,split[pa][pb];[pb]scale=-2:1080,crop=1920:1080,boxblur=40:3,eq=brightness=-0.42:saturation=0.5[pbg];[pa]scale=1500:694[pscr];[pbg][pscr]overlay=210:146[pc]"
            fc.append(chain)
            inputs += ["-i", os.path.join(CARDS, "phone.png")]
            fc.append(f"[pc][{sum(1 for x in inputs if x == '-i') - 1}:v]overlay=0:0,format=yuv444p,setsar=1[base0]")
        else:
            fc.append(chain + ",scale=1920:1080:flags=lanczos,format=yuv444p,setsar=1[base0]")
    cur = "base0"
    if s.get("dim"):
        fc.append(f"[{cur}]eq=brightness={-0.5 * s['dim']:.3f}:saturation={1 - 0.4 * s['dim']:.3f}[dimd]")
        cur = "dimd"
    if s.get("vig"):
        fc.append(f"[{cur}]vignette=angle=PI/4.2[vg]")
        cur = "vg"
    for k, o in enumerate(s.get("ov", [])):
        idx = sum(1 for x in inputs if x == "-i")
        inputs += ["-loop", "1", "-framerate", "30", "-t", f"{dur}", "-i", os.path.join(CARDS, o["png"] + ".png")]
        t0, t1, fd = o.get("t0", 0), o.get("t1", dur), o.get("fade", 0.3)
        a = f"[{idx}:v]format=rgba"
        if fd > 0 and t0 > 0:
            a += f",fade=t=in:st={t0}:d={fd}:alpha=1"
        if fd > 0 and t1 < dur:
            a += f",fade=t=out:st={t1 - fd}:d={fd}:alpha=1"
        fc.append(a + f"[o{k}]")
        en = f":enable='between(t,{t0},{t1})'" if (t0 > 0 or t1 < dur) and fd == 0 else ""
        fc.append(f"[{cur}][o{k}]overlay=0:0{en}[c{k}]")
        cur = f"c{k}"
    fc.append(f"[{cur}]format=yuv420p[v]")
    run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[v]", "-t", f"{dur}", "-r", "30",
         "-c:v", "libx264", "-preset", "medium", "-crf", "10", "-pix_fmt", "yuv420p", out])
    return out


def join(segs, trans, out_path, crf=19, maxrate=None, fade_in=0.6, fade_out=1.0):
    """把分段接起来：trans[i] 是第 i 段和第 i+1 段之间的转场（0 = 硬切，>0 = 叠化秒数）"""
    inputs = []
    for p in segs:
        inputs += ["-i", p]
    durs = [probe_dur(p) for p in segs]
    fc = [f"[{i}:v]fps=30,settb=1/30,setpts=PTS-STARTPTS,scale=out_range=tv:out_color_matrix=bt709,format=yuv420p[s{i}]" for i in range(len(segs))]      # 时间基统一，xfade 才接得上；素材是 jpeg 截图拼的（全范围），每段先统一成 tv 范围、bt709 的 yuv420p 再接
    cur, length = "s0", durs[0]
    for i in range(1, len(segs)):
        d = trans[i - 1]
        nxt = f"s{i}"
        if d > 0:
            fc.append(f"[{cur}][{nxt}]xfade=transition=fade:duration={d}:offset={length - d:.4f}[x{i}]")
            length += durs[i] - d
        else:
            fc.append(f"[{cur}][{nxt}]concat=n=2:v=1:a=0,settb=1/30[x{i}]")
            length += durs[i]
        cur = f"x{i}"
    fc.append(f"[{cur}]fade=t=in:st=0:d={fade_in},fade=t=out:st={length - fade_out:.3f}:d={fade_out},format=yuv420p[v]")      
    enc = ["-c:v", "libx264", "-preset", "slow", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart", "-r", "30"]
    if maxrate:
        # 网页版：两遍编码，按目标码率压到 14 MB 以内
        br = int(maxrate * 8 / length * 0.97 / 1000)  # kbps
        log = os.path.join(SEG, "pass")
        run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[v]", *enc, "-b:v", f"{br}k", "-pass", "1", "-passlogfile", log, "-an", "-f", "mp4", os.devnull])
        run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[v]", *enc, "-b:v", f"{br}k", "-maxrate", f"{int(br * 1.6)}k", "-bufsize", f"{br * 3}k", "-pass", "2", "-passlogfile", log, "-an", out_path])
    else:
        run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[v]", *enc, "-crf", str(crf), "-an", out_path])
    return length


if __name__ == "__main__":
    from edl import EDL      # 剪辑表单独放在 tools/trailer/edl.py
    only_seg = "--seg" in sys.argv
    segs, trans = [], []
    t = 0.0
    rows = []
    for i, s in enumerate(EDL):
        p = os.path.join(SEG, f"{i:02d}.mp4")
        if "--keep" not in sys.argv or not os.path.exists(p):
            p = seg(i, s)
        segs.append(p)
        tr = s.get("x", 0)
        rows.append((t, s))
        t += s["dur"] - (tr if i < len(EDL) - 1 else 0)
        if i < len(EDL) - 1:
            trans.append(tr)
        print(f"{i:02d} {rows[-1][0]:6.2f}s  {s['dur']:.2f}s  {s.get('note', '')}")
    if only_seg:
        sys.exit(0)
    out = os.path.join(ROOT, "docs/trailer/trailer.mp4")
    L = join(segs, trans, out, crf=19)
    web = os.path.join(ROOT, "docs/trailer/trailer_web.mp4")
    join(segs, trans, web, maxrate=13.4e6)
    print("成片", out, f"{L:.2f}s", os.path.getsize(out) / 1e6, "MB；网页版", os.path.getsize(web) / 1e6, "MB")
    json.dump([{"start": round(r[0], 2), "dur": r[1]["dur"], "note": r[1].get("note", ""), "src": r[1].get("src", r[1].get("seq", r[1].get("color", "")))} for r in rows],
              open(os.path.join(SEG, "timeline.json"), "w"), ensure_ascii=False, indent=1)
