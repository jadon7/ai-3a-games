#!/usr/bin/env python3
"""图生图：把本地图片上传成参考图，再按提示词重绘。流程和 jimeng_gen.py 一样（建节点、报价、批准、运行、下载）。

用法：python3 tools/jimeng_i2i.py jobs.json
jobs.json 每项：{"name", "out", "model", "ratio", "resolution", "prompt", "ref_files": ["本地图片路径", ...]}
上传过的参考图记在 art/paint/uploads.json 里，不会重复上传；已经生成过的 name 会跳过。
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jimeng_gen import run, load_log, ROOT, PROJECT, LOG

UP = os.path.join(ROOT, "art/paint/uploads.json")

def upload(path, cache):
    key = path + ":" + str(int(os.path.getmtime(os.path.join(ROOT, path))))
    if key not in cache:
        r = run(["resource", "upload", "--file", os.path.join(ROOT, path), "--project-id", PROJECT, "--name", os.path.basename(path)])
        if not r.get("ok"): raise SystemExit("UPLOAD FAIL " + path + " " + json.dumps(r, ensure_ascii=False)[:400])
        cache[key] = r["data"]["resourceId"]
        json.dump(cache, open(UP, "w"), indent=1)
    return cache[key]

def run_batch(todo, log, cache):
    for j in todo:
        refs = [upload(p, cache) for p in j["ref_files"]]
        args = ["node", "create", "image", "--project-id", PROJECT, "--mode", "i2i", "--model", j["model"], "--prompt", j["prompt"],
                "--ratio", j.get("ratio", "1:1"), "--resolution", j.get("resolution", "2K"), "--count", "1", "--title", j["name"]]
        for r in refs: args += ["--ref", "res:" + r]
        res = run(args)
        j["nodeId"] = res["data"]["node"]["nodeId"] if res.get("ok") else None
        if not j["nodeId"]: print("CREATE FAIL", j["name"], json.dumps(res, ensure_ascii=False)[:500])
    todo = [j for j in todo if j["nodeId"]]
    if not todo: return
    ids = [x for j in todo for x in ("--node-id", j["nodeId"])]
    q = run(["node", "quote", "--project-id", PROJECT] + ids)
    if not q.get("ok"): print("QUOTE FAIL", q); return
    total = q["data"]["totalMaxCredits"]; per = {i["nodeId"]: i["maxCredits"] for i in q["data"]["items"]}
    print("quote total", total, flush=True)
    c = run(["node", "confirm", "--project-id", PROJECT, "--credit-ceiling", str(total)] + ids)
    if not c.get("ok"): print("CONFIRM FAIL", c); return
    r = run(["node", "run", "--project-id", PROJECT, "--credit-token", c["data"]["creditConfirmationToken"]] + ids)
    if not r.get("ok"): print("RUN FAIL", r); return
    sub = {i["nodeId"]: i for i in r["data"]["items"]}
    for j in todo:
        it = sub.get(j["nodeId"])
        if not it: print("NO SUBMIT", j["name"]); continue
        w = run(["operation", "wait", it["submitId"], "--project-id", PROJECT], timeout=1500)
        if w.get("data", {}).get("state") != "succeeded": print("GEN FAIL", j["name"], json.dumps(w, ensure_ascii=False)[:500]); continue
        rid = w["data"]["resources"][0]["resourceId"]
        out = os.path.join(ROOT, j["out"]); os.makedirs(os.path.dirname(out), exist_ok=True)
        d = run(["resource", "download", rid, "--project-id", PROJECT, "-o", out])
        if not d.get("ok"): print("DOWNLOAD FAIL", j["name"], d); continue
        with open(LOG, "a") as f:
            f.write(json.dumps({"name": j["name"], "out": j["out"], "model": j["model"], "nodeId": j["nodeId"], "resourceId": rid, "credits": per.get(j["nodeId"]),
                                "ref_files": j["ref_files"], "prompt": j["prompt"], "time": time.strftime("%Y-%m-%d %H:%M:%S")}, ensure_ascii=False) + "\n")
        print("ok", j["name"], per.get(j["nodeId"]), flush=True)

def main():
    jobs = json.load(open(sys.argv[1])); log = load_log()
    cache = json.load(open(UP)) if os.path.exists(UP) else {}
    todo = [j for j in jobs if not (j["name"] in log and os.path.exists(os.path.join(ROOT, j["out"])))]
    print("todo", len(todo), "of", len(jobs), flush=True)
    BATCH = 12                                   # 一次报价最多 20 个节点
    for k in range(0, len(todo), BATCH): run_batch(todo[k:k + BATCH], log, cache)

if __name__ == "__main__":
    main()
