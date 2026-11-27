#!/usr/bin/env python3
"""video2rig 主入口。

  python scripts/pipeline.py exam troll --seed 1            # “考试”：编一段已知运动，渲染→读回→求解→逐骨头比对
  python scripts/pipeline.py animate troll <视频.mp4> --tag slam   # 把一段双机位视频变成骨架动画
"""
import argparse
import json
import os
import subprocess
import sys

import cv2
import numpy as np
import torch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from v2r import skeleton as sk  # noqa: E402
from v2r import solver, video  # noqa: E402
from v2r.model import IN_H, IN_W, load_jointnet  # noqa: E402

BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender"


def blender(name, script, *args):
    cmd = [BLENDER, "-b", "--factory-startup", os.path.join(ROOT, "assets/model", f"{name}.blend"),
           "--python-exit-code", "1", "-P", os.path.join(ROOT, "scripts/blender", script), "--", name, *map(str, args)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.startswith(("KEYED", "RENDERED", "SAVED", "EXPORTED", "DONE")) or "Error" in line or "Traceback" in line:
            print("  [blender]", line)
    if r.returncode != 0:
        sys.exit("Blender 脚本失败:\n" + r.stdout[-1500:] + r.stderr[-800:])


def load_skel(name):
    return sk.Skeleton.load(os.path.join(ROOT, "assets/model", f"{name}_skeleton.json"))


def load_net(name):
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    net, ck = load_jointnet(os.path.join(ROOT, "runs", name, "jointnet.pt"), device)
    return net, ck, device


def read_stage(name, clip, out_dir, skel):
    """读视频里每个关节的位置，并检查两个机位是不是同一个动作。"""
    net, ck, device = load_net(name)
    assert ck["joint_names"] == skel.joint_names
    frames, fps = video.read_frames(clip)
    obs, conf = video.read_joints(net, frames, device)
    np.savez(os.path.join(out_dir, "detections.npz"), obs=obs, conf=conf, fps=fps)
    overlay = [video.draw_joints(f, obs[i], conf[i], skel.joint_group) for i, f in enumerate(frames)]
    video.write_clip(overlay, os.path.join(out_dir, "joints_overlay.mp4"), fps=round(fps))
    dz, both = video.view_consistency(obs, conf)
    rest2d = sk.project(skel.joint_rest)
    first = np.linalg.norm((obs[0] - rest2d) * np.array([sk.ORTHO_W, sk.ORTHO_H]), axis=-1)
    check = {
        "frames": len(frames), "fps": float(fps), "size": [int(frames[0].shape[1]), int(frames[0].shape[0])],
        "mean_conf": float(conf.mean()), "low_conf_ratio": float((conf < 0.3).mean()),
        "view_height_diff_mean": float(np.nanmean(dz)), "view_height_diff_p95": float(np.nanpercentile(dz, 95)),
        "frames_inconsistent": int((dz > 0.06).sum()),
        "first_frame_vs_rest_mean": float(first.mean()), "first_frame_vs_rest_max": float(first.max()),
    }
    return frames, fps, obs, conf, check


def solve_stage(skel, obs, conf, ground=False):
    jw = np.array([skel.joint_weight.get(n, 1.0) for n in skel.joint_names])
    return solver.solve(skel, obs, conf, joint_weight=jw, ground=ground)


def save_motion(path, res, fps):
    np.savez(path, quats=res["quats"], loc=res["loc"], fps=int(round(fps)), joints=res["joints"],
             theta=res["theta"], t=res["t"])


def angle_between(u, v):
    c = np.sum(u * v, -1) / (np.linalg.norm(u, axis=-1) * np.linalg.norm(v, axis=-1) + 1e-9)
    return np.degrees(np.arccos(np.clip(c, -1, 1)))


def cmd_exam(a):
    skel = load_skel(a.name)
    tag = f"seed{a.seed}" + (f"_rear{int(a.rear)}" if a.rear else "")
    d = os.path.join(ROOT, "data", a.name, "exam", tag)
    os.makedirs(d, exist_ok=True)
    rng = np.random.default_rng(a.seed)
    m = sk.sample_motion(skel, rng, a.frames, energy=a.energy, rear=a.rear)
    gt = solver.motion_from_params(skel, m["theta"], m["ypr"], m["t"])
    gt_path = os.path.join(d, "gt_motion.npz")
    np.savez(gt_path, quats=gt["quats"], loc=gt["loc"], fps=24, joints=gt["joints"], theta=gt["theta"], t=gt["t"],
             bone_world=gt["bone_world"])
    clip = os.path.join(d, "exam_clip.mp4")
    if a.reuse and os.path.exists(clip):                  # 同一个种子的运动是确定的：换了权重重考时不用再渲染一遍
        print(f"[1/4] 复用已经渲染好的考试视频 {os.path.relpath(clip, ROOT)}")
    else:
        print(f"[1/4] 编了一段 {a.frames} 帧的随机运动，渲染成双机位视频…")
        blender(a.name, "render_motion.py", gt_path, "--frames", os.path.join(d, "frames"))
        video.frames_to_clip(os.path.join(d, "frames/front"), os.path.join(d, "frames/side"), clip)
    print("[2/4] 读视频里的关节…")
    frames, fps, obs, conf, check = read_stage(a.name, clip, d, skel)
    print("[3/4] 求解骨骼旋转…")
    res = solve_stage(skel, obs, conf)
    save_motion(os.path.join(d, "solved_motion.npz"), res, fps)

    print("[4/4] 和标准答案逐项比对")
    gt2d = sk.project(gt["joints"]).transpose(1, 0, 2, 3)                      # (T,2,K,2)
    det_px = np.linalg.norm((obs - gt2d) * np.array([IN_W, IN_H]), axis=-1)    # 以 448x504 的画面计
    jerr = np.linalg.norm(res["joints"] - gt["joints"], axis=-1) / skel.size_ref * 100   # 占体型尺寸（双足是身高，四足是身长）的百分比
    y = np.array([0.0, 1.0, 0.0])
    ctrl = [i for i, r in enumerate(skel.roles) if r and r != "finger"]
    fing = [i for i, r in enumerate(skel.roles) if r == "finger"]
    dir_err = angle_between(res["bone_world"][:, ctrl] @ y, gt["bone_world"][:, ctrl] @ y)        # (T,nb)
    rel = np.einsum("tbij,tbik->tbjk", gt["bone_world"][:, ctrl], res["bone_world"][:, ctrl])
    full_err = np.degrees(np.arccos(np.clip((np.trace(rel, axis1=-2, axis2=-1) - 1) / 2, -1, 1)))
    finger_err = angle_between(res["bone_world"][:, fing] @ y, gt["bone_world"][:, fing] @ y) if fing else np.zeros(1)
    report = {
        "name": a.name, "seed": a.seed, "frames": a.frames, "check": check,
        "size_ref": skel.size_ref, "size_name": skel.size_name,
        "finger_dir_deg_mean": float(finger_err.mean()) if fing else None,
        "detect_px_mean": float(det_px.mean()), "detect_px_p95": float(np.percentile(det_px, 95)),
        "joint_err_pct_mean": float(jerr.mean()), "joint_err_pct_p95": float(np.percentile(jerr, 95)),
        "joint_err_pct_max": float(jerr.max()),
        "bone_dir_deg_mean": float(dir_err.mean()), "bone_dir_deg_p95": float(np.percentile(dir_err, 95)),
        "bone_full_deg_mean": float(full_err.mean()),
        "per_joint_pct": {n: float(jerr[:, k].mean()) for k, n in enumerate(skel.joint_names)},
        "per_bone_dir_deg": {skel.names[b].split(":")[-1]: float(dir_err[:, i].mean()) for i, b in enumerate(ctrl)},
        "per_bone_full_deg": {skel.names[b].split(":")[-1]: float(full_err[:, i].mean()) for i, b in enumerate(ctrl)},
    }
    report["passed"] = bool(report["joint_err_pct_mean"] < a.pass_joint and report["bone_dir_deg_mean"] < a.pass_bone)
    with open(os.path.join(ROOT, "runs", a.name, f"exam_{tag}.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(f"  读关节: 平均偏差 {report['detect_px_mean']:.1f}px（95% 在 {report['detect_px_p95']:.1f}px 以内），平均置信度 {check['mean_conf']:.2f}")
    print(f"  关节位置: 平均 {report['joint_err_pct_mean']:.2f}% {skel.size_name}，95% 在 {report['joint_err_pct_p95']:.2f}% 以内，最差 {report['joint_err_pct_max']:.1f}%")
    print(f"  骨骼朝向: 平均 {report['bone_dir_deg_mean']:.1f}°（95% 在 {report['bone_dir_deg_p95']:.1f}° 以内）；含自转 {report['bone_full_deg_mean']:.1f}°")
    if fing:
        print(f"  手指朝向: 平均 {report['finger_dir_deg_mean']:.1f}°（握拳程度只靠指尖一个点估计，单独统计）")
    worst = sorted(report["per_bone_dir_deg"].items(), key=lambda kv: -kv[1])[:5]
    print("  朝向误差最大的骨骼:", ", ".join(f"{k} {v:.1f}°" for k, v in worst))
    print("  结论:", "通过" if report["passed"] else "未通过", f"（标准：关节 < {a.pass_joint}% {skel.size_name}，骨骼朝向 < {a.pass_bone}°）")


def cmd_animate(a):
    skel = load_skel(a.name)
    d = os.path.join(ROOT, "out", "anim", f"{a.name}_{a.tag}")
    os.makedirs(d, exist_ok=True)
    print("[1/4] 读视频里的关节，并检查两个机位是否同步…")
    frames, fps, obs, conf, check = read_stage(a.name, a.video, d, skel)
    print("  ", json.dumps(check, ensure_ascii=False))
    with open(os.path.join(d, "check.json"), "w", encoding="utf-8") as f:
        json.dump(check, f, ensure_ascii=False, indent=1)
    bad = check["frames_inconsistent"] / max(check["frames"], 1)
    if bad > 0.15:
        print(f"  注意：{bad:.0%} 的帧里两个机位的动作对不上，这条视频建议直接重新生成，而不是硬修。")
    print("[2/4] 求解骨骼旋转…")
    res = solve_stage(skel, obs, conf, ground=True)
    motion = os.path.join(d, "motion.npz")
    save_motion(motion, res, fps)
    reproj = sk.project(res["joints"]).transpose(1, 0, 2, 3)
    r = np.linalg.norm((reproj - obs) * np.array([sk.ORTHO_W, sk.ORTHO_H]), axis=-1)
    reproj_pct = float(np.average(r, weights=np.clip(conf, 1e-3, 1)) / skel.size_ref * 100)
    print(f"  骨架回投到画面后与读数的平均偏差: {reproj_pct:.2f}% {skel.size_name}")
    check["reproj_pct"] = reproj_pct
    with open(os.path.join(d, "check.json"), "w", encoding="utf-8") as f:
        json.dump(check, f, ensure_ascii=False, indent=1)
    print("[3/4] 写入 Blender 并渲染回放…")
    blender(a.name, "render_motion.py", motion, "--frames", os.path.join(d, "frames"),
            "--blend", os.path.join(d, f"{a.name}_{a.tag}.blend"), "--glb", os.path.join(d, f"{a.name}_{a.tag}.glb"),
            "--action", a.tag)
    print("[4/4] 合成对比视频（上：AI 视频；下：骨架动画）…")
    out_frames = []
    h, w = frames[0].shape[:2]
    hw = w // 2
    for i, f in enumerate(frames):
        fr = cv2.resize(cv2.imread(os.path.join(d, "frames/front", f"{i:04d}.jpg")), (hw, h), interpolation=cv2.INTER_AREA)
        sd = cv2.resize(cv2.imread(os.path.join(d, "frames/side", f"{i:04d}.jpg")), (w - hw, h), interpolation=cv2.INTER_AREA)
        out_frames.append(np.vstack([f, np.hstack([fr, sd])]))
    video.write_clip(out_frames, os.path.join(d, "compare.mp4"), fps=round(fps))
    print("  产出目录:", d)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("exam")
    p.add_argument("name")
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--frames", type=int, default=121)
    p.add_argument("--energy", type=float, default=1.0)
    p.add_argument("--rear", type=float, default=0.0, help="四足：中间一段人立，前半身抬起这么多度")
    p.add_argument("--reuse", action="store_true", help="考试视频已经渲染过就直接用（换权重重考时省掉渲染）")
    p.add_argument("--pass-joint", type=float, default=3.0)
    p.add_argument("--pass-bone", type=float, default=10.0)
    p.set_defaults(fn=cmd_exam)
    p = sub.add_parser("animate")
    p.add_argument("name")
    p.add_argument("video")
    p.add_argument("--tag", default="clip")
    p.set_defaults(fn=cmd_animate)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
