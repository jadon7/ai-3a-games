"""一个“套动作”的试验从头跑到尾：套 → 量 → 渲染拼图和录像 → 写数字表。第二批每个角色也照这个跑。

用法: <V2R 的 python> tools/retarget/run_case.py <case.json> [步骤,步骤…]     步骤：retarget,measure,render,video,build（默认前四个；build 出游戏用的 GLB 和时间表）
case.json（除 retarget.py 认的那些以外）：
  "name"、"title"                 名字、一句话说明
  "src_model"、"tgt_model"        渲染用的模型（人形是 rigged.glb，四足是 .blend）
  "src_root"/"tgt_root"           （四足）根骨骼名；人形自动用 Hips
  "src_game_h"、"game_h"          游戏里的身高（kit.height）：源角色、目标角色。量出来的米、米/秒按它换算
  "move_speed"                    游戏里的移速（kit 的 ms），量跑步滑不滑用
  "tip_src"/"tip_tgt"             （四足）量出手时刻的骨骼（时间表 points.hand 那根，一般是头）；人形自动用拿武器的手的武器尖
  "hide_weapon_tgt"               目标的武器藏起来（拿别的英雄试比例时，武器不是这套动作的，看着乱）
  "render": {"clips": […], "frames": 8, "views": [[30,10],[90,6]], "ortho": 1.25, "zc": 0.48}
  "video":  {"clips": ["run", …], "loops": {"run": 4}}
产出都在 case.json 旁边：motions/<变体>/*.npz、measure.json、render/、sheets/<clip>.jpg、video/<clip>.mp4
"""
import json, os, sys, subprocess, shutil
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import rig as R, retarget as RT, measure as M

BL = "/Applications/Blender.app/Contents/MacOS/Blender"; PIL_PY = "/opt/homebrew/opt/python@3.14/bin/python3.14"
FFMPEG_ENV = dict(os.environ, DYLD_LIBRARY_PATH="/opt/homebrew/Cellar/x265/4.2/lib")


def main():
    case_path = os.path.abspath(sys.argv[1]); base = os.path.dirname(case_path); case = json.load(open(case_path, encoding="utf-8"))
    steps = set((sys.argv[2] if len(sys.argv) > 2 else "retarget,measure,render,video").split(","))
    Pb = lambda p: RT.P(p, base)
    if "retarget" in steps:
        subprocess.run([sys.executable, os.path.join(HERE, "retarget.py"), case_path], check=True)
    src = R.Rig(Pb(case["src_rig"])); tgt = R.Rig(Pb(case["tgt_rig"])); sb = json.load(open(Pb(case["src_build"]), encoding="utf-8"))
    timing = json.load(open(Pb(case["src_timing"]), encoding="utf-8")); clips = case.get("clips") or list(sb["motions"].keys())
    variants = list(case.get("variants", {"ik": {}}).keys()); kind = case.get("kind", "mixamo"); runs = set(case.get("runs", ["run", "gallop"]))
    mdir = Pb(case.get("out_dir", "motions"))
    rows = [("src", src, lambda c: Pb(sb["motions"][c]), case.get("src_game_h", case.get("game_h", 3.3)))] + [(v, tgt, (lambda v_: lambda c: os.path.join(mdir, v_, c + ".npz"))(v), case.get("game_h", 3.3)) for v in variants]

    def legs_of(rg, which):
        if kind == "mixamo": return [(n, rg.find(n)) for n in ("LeftFoot", "RightFoot")]
        return [(lg["tgt"][2] if which == "tgt" else lg["src_end"], rg.idx[lg.get("tgt_end", lg["tgt"][2]) if which == "tgt" else lg["src_end"]]) for lg in case["legs"]]

    def root_of(rg, which):
        return rg.find("Hips") if kind == "mixamo" else rg.idx[case["tgt_root" if which == "tgt" else "src_root"]]

    if "measure" in steps:
        res = {}
        for clip in clips:
            ev, sp, hands = M.events_of(timing, clip); res[clip] = {"speed": sp, "events": ev}
            for lab, rg, path, gh in rows:
                which = "src" if lab == "src" else "tgt"
                names, q, loc, fps = R.load_motion(path(clip)); Q = R.to_rig_order(rg, names, q)
                if kind == "mixamo":
                    side = "Left" if hands and hands[0] == "L" else "Right"; tip = ("weapon", rg.find(side + "Hand"))
                    caps = {"caps": M.capsules(rg, ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"]), "hands": [rg.find("LeftHand"), rg.find("RightHand")], "no_weapon": case.get("hide_weapon_tgt", False)}
                    follow = (rg.find("LeftHand"), rg.find("RightHand"))
                else:
                    tip = ("bone", rg.idx[case["tip_tgt" if which == "tgt" else "tip_src"]]); caps = None; follow = None
                run = {"runSpeed": timing.get("runSpeed", 8.0) if clip == "run" else timing.get(clip, {}).get("runSpeed", 8.0), "v": case.get("move_speed", 6.0)} if clip in runs else None
                if run and lab != "src": run["runSpeed"] = run["runSpeed"]          # 目标先按源的 runSpeed 量，再看“该填多少”
                res[clip][lab] = M.measure(rg, Q, loc, fps, root_of(rg, which), legs_of(rg, which), gh, sp, run, ev, tip, caps, follow)
                print(clip, lab, json.dumps(res[clip][lab], ensure_ascii=False))
            # 出手时刻差：武器尖（四足是头）的速度曲线和源的做互相关，前后 6 帧里最像的那个错位就是差了几帧（正数 = 目标晚）
            vs = res[clip]["src"].get("_v")
            for lab, *_ in rows[1:]:
                vt = res[clip][lab].get("_v")
                if vs and vt and len(vs) == len(vt):
                    a_ = np.array(vs) - np.mean(vs); b_ = np.array(vt) - np.mean(vt); best = max(range(-6, 7), key=lambda l: float(np.dot(a_[max(0, -l):len(a_) - max(0, l)], b_[max(0, l):len(b_) - max(0, -l)])))
                    res[clip][lab]["出手时刻差(帧)"] = best
            for lab, *_ in rows: res[clip][lab].pop("_v", None)
        json.dump(res, open(os.path.join(base, "measure.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    if "build" in steps:
        # 出品：照源的 build.json 写一份目标的（模型换成目标的、动作换成套好的那一套），交给现成的 hero_build.sh / creature_build.sh。
        # 人形的站姿（idle_pose）是按绝对位置写的：手腕、脚踝跟着肩、脚的静止位置挪过去，胯的偏移按 k 缩放。游戏里有 idle 就不用它，只是垫底。
        bv = case.get("build_variant", "ik"); bd = os.path.join(base, "build"); os.makedirs(bd, exist_ok=True)
        cfg = dict(sb); cfg.pop("pose_out", None); cfg.pop("views", None)
        cfg["motions"] = {c: os.path.join(mdir, bv, c + ".npz") for c in clips}; cfg["out"] = os.path.join(bd, "game.glb"); cfg["packed"] = os.path.join(bd, case["name"] + ".glb")
        if kind == "mixamo":
            cfg["rigged"] = Pb(case["tgt_model"]); st = json.loads(json.dumps(sb["stance"])); kk = json.load(open(os.path.join(mdir, bv, "retarget_report.json")))["k"] if os.path.exists(os.path.join(mdir, bv, "retarget_report.json")) else 1.0
            for side in ("Left", "Right"):
                d_arm = tgt.head[tgt.find(side + "Arm")] - src.head[src.find(side + "Arm")]; d_ft = tgt.head[tgt.find(side + "Foot")] - src.head[src.find(side + "Foot")]
                if "wrist" in st["arms"][side]: st["arms"][side]["wrist"] = (np.array(st["arms"][side]["wrist"]) + d_arm).round(4).tolist()
                if "ankle" in st["legs"][side]: st["legs"][side]["ankle"] = (np.array(st["legs"][side]["ankle"]) + d_ft).round(4).tolist()
            st["hips"]["offset"] = (np.array(st["hips"]["offset"]) * kk).round(4).tolist(); cfg["stance"] = st
            json.dump(cfg, open(os.path.join(bd, "build.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            subprocess.run(["zsh", os.path.join(RT.ROOT, "tools/hero_build.sh"), os.path.relpath(bd, RT.ROOT)], check=True, cwd=RT.ROOT)
        else:
            cfg["name"] = case.get("tgt_blend_name", cfg["name"]); json.dump(cfg, open(os.path.join(bd, "build.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            print("四足出品：creature_build.sh 只认 V2R/assets/model/<name>.blend，新模型摆正后放进去再跑：zsh tools/creature_build.sh", os.path.relpath(bd, RT.ROOT))
        # 时间表：照抄源的，runSpeed 按量出来的比例改（源的“该填”和现在填的数之比保持不变）
        mj = json.load(open(os.path.join(base, "measure.json"), encoding="utf-8")); tm = json.loads(json.dumps(timing))
        for c in runs:
            if c not in mj: continue
            f_ = lambda lab: float(np.mean([v["该填runSpeed"] for k_, v in mj[c][lab].items() if k_.startswith("脚:") and v.get("该填runSpeed")]))
            ratio = f_(bv) / f_("src"); tgt_rs = (tm["runSpeed"] if c == "run" else tm[c]["runSpeed"]) * ratio * case.get("game_h", 3.3) / case.get("src_game_h", case.get("game_h", 3.3))
            if c == "run": tm["runSpeed"] = round(tgt_rs, 2)
            else: tm[c]["runSpeed"] = round(tgt_rs, 2)
            print("RUNSPEED", c, "源", timing.get("runSpeed") if c == "run" else timing[c]["runSpeed"], "->", round(tgt_rs, 2), "（量出来的比例", round(ratio, 3), "）")
        json.dump(tm, open(os.path.join(bd, case["name"] + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    rcfg = case.get("render", {}); rclips = rcfg.get("clips", clips)
    actors = [{"model": Pb(case["src_model"]), "motions": {c: rows[0][2](c) for c in clips}, "root": case.get("src_root", "mixamorig:Hips"), "label": "src", "ortho": rcfg.get("ortho_src")}]
    for v in variants:
        actors.append({"model": Pb(case["tgt_model"]), "motions": {c: os.path.join(mdir, v, c + ".npz") for c in clips}, "root": case.get("tgt_root", "mixamorig:Hips"), "label": v, "hide_weapon": case.get("hide_weapon_tgt", False)})
    if "render" in steps:
        out = os.path.join(base, "render"); shutil.rmtree(out, ignore_errors=True)
        job = {"actors": actors, "clips": rclips, "frames": rcfg.get("frames", 8), "views": rcfg.get("views", [[30, 10], [90, 12]]), "cell": rcfg.get("cell", [240, 300]),
               "ortho": rcfg.get("ortho", 1.25), "zc": rcfg.get("zc", 0.48), "game_h": case.get("game_h", 3.3), "out": out}
        jp = os.path.join(base, "render_job.json"); json.dump(job, open(jp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        subprocess.run([BL, "-b", "--factory-startup", "-P", os.path.join(HERE, "render.py"), "--", jp], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        labels = "|".join(case.get("labels", ["源"] + variants))
        os.makedirs(os.path.join(base, "sheets"), exist_ok=True)
        for c in rclips:
            subprocess.run([PIL_PY, os.path.join(HERE, "sheet.py"), out, os.path.join(base, "sheets", c + ".jpg"), c, labels, str(len(job["views"]))], check=True)
    V = case.get("video")
    if V and "video" in steps:
        out = os.path.join(base, "render"); speeds = {}
        mj = json.load(open(os.path.join(base, "measure.json"), encoding="utf-8")) if os.path.exists(os.path.join(base, "measure.json")) else {}
        for c in V["clips"]:
            if c in runs and c in mj:                                                 # 跑步：源按现在填的 runSpeed 往前走，目标按量出来“该填”的数往前走（都换成身高/秒）
                sp_ = []
                for lab, rg, path, gh in rows:
                    m = mj[c][lab]; feet = [v_ for k_, v_ in m.items() if k_.startswith("脚:") and "该填runSpeed" in v_]
                    rs = (timing.get("runSpeed") if c == "run" else timing.get(c, {}).get("runSpeed")) if lab == "src" else float(np.mean([f["该填runSpeed"] for f in feet]))
                    sp_.append(rs / gh)
                speeds[c] = sp_
        job = {"actors": actors, "game_h": case.get("game_h", 3.3), "out": out,
               "video": {"clips": V["clips"], "size": V.get("size", [1440, 640]), "spacing": V.get("spacing", 0.85), "view": V.get("view", [15, 18]), "ortho": V.get("ortho_w", V.get("spacing", 0.85) * (len(actors) + 0.6)), "zc": V.get("zc", 0.45),
                         "loops": V.get("loops", {}), "run_speed": speeds}}
        jp = os.path.join(base, "video_job.json"); json.dump(job, open(jp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        subprocess.run([BL, "-b", "--factory-startup", "-P", os.path.join(HERE, "render.py"), "--", jp], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.makedirs(os.path.join(base, "video"), exist_ok=True)
        labs = case.get("labels", ["源"] + variants)
        for c in V["clips"]:
            note = "（跑步：每个人按自己该填的 runSpeed 往前走，脚踩实就不会在格子上滑；源按现在游戏里填的数）" if c in speeds else ""
            subprocess.run([PIL_PY, os.path.join(HERE, "label_frames.py"), os.path.join(out, "video", c), f"{c}　从左到右：" + " ｜ ".join(labs) + note], check=True)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "30", "-i", os.path.join(out, "video", c, "%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", os.path.join(base, "video", c + ".mp4")], check=True, env=FFMPEG_ENV)
        print("VIDEO", V["clips"], speeds)


if __name__ == "__main__":
    main()
