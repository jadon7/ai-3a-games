#!/usr/bin/env python3
"""用即梦 CLI（dreamina-canvas）把双机位参考图变成 Seedance 视频。

  python scripts/jimeng.py video --ref assets/ref/troll_ref.png --prompt-file prompts/troll_slam.txt \
      --out out/seedance/troll_slam_02.mp4            # 默认：Seedance 2.5 样片模式、480p、5 秒
  加 --quote-only 只报价不生成；--ceiling 是愿意花的积分上限，报价超过就不跑。
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = "dreamina-canvas"


def cli(*args, timeout=1800):
    r = subprocess.run([CLI, *args, "--format", "json", "--non-interactive"], capture_output=True, text=True, timeout=timeout)
    try:
        body = json.loads(r.stdout)
    except Exception:
        sys.exit(f"即梦 CLI 输出无法解析: {r.stdout[:400]} {r.stderr[:400]}")
    if not body.get("ok"):
        sys.exit("即梦 CLI 报错: " + json.dumps(body, ensure_ascii=False)[:600])
    return body["data"]


def project_id():
    with open(os.path.join(ROOT, "jimeng_project.json"), encoding="utf-8") as f:
        return json.load(f)["projectId"]


def cmd_video(a):
    pid = project_id()
    prompt = open(a.prompt_file, encoding="utf-8").read().strip()
    res = cli("resource", "upload", "--file", a.ref, "--project-id", pid, "--name", os.path.basename(a.ref))
    print("参考图已上传:", res["resourceId"])
    node = cli("node", "create", "video", "--project-id", pid, "--mode", "first_last_frame", "--model", a.model,
               "--ratio", "16:9", "--resolution", a.resolution, "--duration", str(a.duration), "--count", "1",
               "--title", a.title or os.path.basename(a.out), "--ref", f"res:{res['resourceId']}", "--prompt", prompt)
    nid = node["node"]["nodeId"]
    quote = cli("node", "quote", "--project-id", pid, "--node-id", nid)
    cost = quote["totalMaxCredits"]
    print(f"节点 {nid}，报价 {cost} 积分（上限 {a.ceiling}）")
    if a.quote_only:
        return
    if cost > a.ceiling:
        sys.exit("报价超过上限，没有生成。需要的话调高 --ceiling。")
    run_args = ["node", "run", "--project-id", pid, "--node-id", nid]
    if quote.get("confirmationRequired"):
        tok = cli("node", "confirm", "--project-id", pid, "--node-id", nid, "--credit-ceiling", str(a.ceiling))
        run_args += ["--credit-token", tok["creditConfirmationToken"]]
    item = cli(*run_args)["items"][0]
    rid = item["resources"][0]["resourceId"]
    print("已提交，等待生成…", item["submitId"])
    done = cli("operation", "wait", item["submitId"], "--project-id", pid, "--timeout", "25m", "--interval", "10s")
    if done.get("state") != "succeeded":
        sys.exit("生成没有成功: " + json.dumps(done, ensure_ascii=False)[:400])
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    cli("resource", "download", rid, "--project-id", pid, "-o", a.out)
    info = cli("resource", "get", rid, "--project-id", pid)
    print("已下载:", a.out, json.dumps(info.get("video", {}), ensure_ascii=False))


def cmd_image(a):
    """文生图：建节点 → 报价 → 生成 → 把每张图下载到 --out-dir。"""
    pid = project_id()
    prompt = open(a.prompt_file, encoding="utf-8").read().strip()
    node = cli("node", "create", "image", "--project-id", pid, "--mode", "t2i", "--model", a.model, "--ratio", a.ratio,
               "--resolution", a.resolution, "--count", str(a.count), "--title", a.title, "--prompt", prompt)
    run_node(pid, node["node"]["nodeId"], a.ceiling, a.out_dir, a.prefix)


def cmd_run(a):
    run_node(project_id(), a.node_id, a.ceiling, a.out_dir, a.prefix)


def run_node(pid, nid, ceiling, out_dir, prefix):
    quote = cli("node", "quote", "--project-id", pid, "--node-id", nid)
    cost = quote["totalMaxCredits"]
    print(f"节点 {nid}，报价 {cost} 积分（上限 {ceiling}）")
    if cost > ceiling:
        sys.exit("报价超过上限，没有生成。")
    run_args = ["node", "run", "--project-id", pid, "--node-id", nid]
    if quote.get("confirmationRequired"):
        tok = cli("node", "confirm", "--project-id", pid, "--node-id", nid, "--credit-ceiling", str(ceiling))
        run_args += ["--credit-token", tok["creditConfirmationToken"]]
    os.makedirs(out_dir, exist_ok=True)
    for item in cli(*run_args)["items"]:
        done = cli("operation", "wait", item["submitId"], "--project-id", pid, "--timeout", "15m", "--interval", "5s")
        if done.get("state") != "succeeded":
            sys.exit("生成没有成功: " + json.dumps(done, ensure_ascii=False)[:400])
        for res in item["resources"]:
            rid = res["resourceId"]
            out = os.path.join(out_dir, f"{prefix}_{rid[-8:]}.png")
            cli("resource", "download", rid, "--project-id", pid, "-o", out)
            print("已下载:", out)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("image")
    p.add_argument("--prompt-file", required=True)
    p.add_argument("--out-dir", required=True)
    p.add_argument("--prefix", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--model", default="seedream_4.7")
    p.add_argument("--ratio", default="3:4")
    p.add_argument("--resolution", default="1K")
    p.add_argument("--count", type=int, default=2)
    p.add_argument("--ceiling", type=int, default=6)
    p.set_defaults(fn=cmd_image)
    p = sub.add_parser("run")
    p.add_argument("node_id")
    p.add_argument("--out-dir", required=True)
    p.add_argument("--prefix", required=True)
    p.add_argument("--ceiling", type=int, default=6)
    p.set_defaults(fn=cmd_run)
    p = sub.add_parser("video")
    p.add_argument("--ref", required=True)
    p.add_argument("--prompt-file", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--model", default="seedance_2.5_draft")
    p.add_argument("--resolution", default="480p")
    p.add_argument("--duration", type=int, default=5)
    p.add_argument("--ceiling", type=int, default=60)
    p.add_argument("--title")
    p.add_argument("--quote-only", action="store_true")
    p.set_defaults(fn=cmd_video)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
