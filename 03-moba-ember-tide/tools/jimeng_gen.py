#!/usr/bin/env python3
"""批量用即梦画布命令行（dreamina-canvas）出图。

用法：python3 tools/jimeng_gen.py jobs.json
jobs.json 是一个列表，每项：
  {"name": "hero-01-sheet-a", "out": "concepts/heroes/xxx.png", "model": "...",
   "ratio": "3:4", "resolution": "2K", "prompt": "...", "refs": ["别的 job 的 name", ...]}
refs 非空时走 i2i，引用之前生成过的节点（从 concepts/_raw/log.jsonl 里按 name 查 nodeId）。
每次运行会把 name、nodeId、resourceId、报价积分追加到 concepts/_raw/log.jsonl。
已经在 log 里并且文件存在的 name 会跳过。
"""
import json, subprocess, sys, os, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.environ.get("JIMENG_PROJECT_ID", "")  # 即梦画布项目 ID，用环境变量传入
LOG = os.path.join(ROOT, "concepts/_raw/log.jsonl")
D = "dreamina-canvas"


def run(args, timeout=900):
    p = subprocess.run([D] + args + ["--format", "json"], capture_output=True, text=True, timeout=timeout)
    try:
        return json.loads(p.stdout)
    except Exception:
        return {"ok": False, "raw": (p.stdout + p.stderr)[:800]}


def load_log():
    m = {}
    if os.path.exists(LOG):
        for line in open(LOG):
            line = line.strip()
            if line:
                r = json.loads(line)
                m[r["name"]] = r
    return m


def main():
    jobs = json.load(open(sys.argv[1]))
    log = load_log()
    todo = []
    for j in jobs:
        out = os.path.join(ROOT, j["out"])
        if j["name"] in log and os.path.exists(out):
            print("skip", j["name"])
            continue
        todo.append(j)
    if not todo:
        return
    # 1. 建节点
    for j in todo:
        refs = [log[r]["nodeId"] for r in j.get("refs", [])]
        args = ["node", "create", "image", "--project-id", PROJECT,
                "--mode", "i2i" if refs else "t2i", "--model", j["model"],
                "--prompt", j["prompt"], "--ratio", j["ratio"],
                "--resolution", j.get("resolution", "2K"), "--count", "1", "--title", j["name"]]
        for r in refs:
            args += ["--ref", "node:" + r]
        res = run(args)
        if not res.get("ok"):
            print("CREATE FAIL", j["name"], res)
            j["nodeId"] = None
            continue
        j["nodeId"] = res["data"]["node"]["nodeId"]
    todo = [j for j in todo if j["nodeId"]]
    ids = []
    for j in todo:
        ids += ["--node-id", j["nodeId"]]
    # 2. 报价、批准
    q = run(["node", "quote", "--project-id", PROJECT] + ids)
    if not q.get("ok"):
        print("QUOTE FAIL", q); return
    total = q["data"]["totalMaxCredits"]
    per = {i["nodeId"]: i["maxCredits"] for i in q["data"]["items"]}
    print("quote total", total)
    c = run(["node", "confirm", "--project-id", PROJECT, "--credit-ceiling", str(total)] + ids)
    if not c.get("ok"):
        print("CONFIRM FAIL", c); return
    token = c["data"]["creditConfirmationToken"]
    # 3. 运行
    r = run(["node", "run", "--project-id", PROJECT, "--credit-token", token] + ids)
    if not r.get("ok"):
        print("RUN FAIL", r); return
    sub = {i["nodeId"]: i for i in r["data"]["items"]}
    # 4. 等待并下载
    for j in todo:
        it = sub.get(j["nodeId"])
        if not it:
            print("NO SUBMIT", j["name"]); continue
        w = run(["operation", "wait", it["submitId"], "--project-id", PROJECT], timeout=1200)
        state = w.get("data", {}).get("state")
        if state != "succeeded":
            print("GEN FAIL", j["name"], json.dumps(w, ensure_ascii=False)[:600]); continue
        rid = w["data"]["resources"][0]["resourceId"]
        out = os.path.join(ROOT, j["out"])
        os.makedirs(os.path.dirname(out), exist_ok=True)
        d = run(["resource", "download", rid, "--project-id", PROJECT, "-o", out])
        if not d.get("ok"):
            print("DOWNLOAD FAIL", j["name"], d); continue
        rec = {"name": j["name"], "out": j["out"], "model": j["model"], "nodeId": j["nodeId"],
               "resourceId": rid, "credits": per.get(j["nodeId"]), "refs": j.get("refs", []),
               "prompt": j["prompt"], "time": time.strftime("%Y-%m-%d %H:%M:%S")}
        with open(LOG, "a") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print("ok", j["name"], per.get(j["nodeId"]))


if __name__ == "__main__":
    main()
