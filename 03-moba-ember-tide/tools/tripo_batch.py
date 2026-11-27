#!/usr/bin/env python3
"""批量图转 3D：提交、等待、下载，记录到 art/models_src/log.jsonl。
用法: python tools/tripo_batch.py jobs.json
jobs.json: [{"name": "tree_c1", "image": "concepts/props/tree_c1.png", "face_limit": 8000}, ...]
已经下载过的 name 会跳过；提交过但没下载完的会接着等（task_id 记在 log 里）。
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tripo, requests
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, "art/models_src/log.jsonl")

def load():
    m = {}
    if os.path.exists(LOG):
        for line in open(LOG):
            if line.strip():
                r = json.loads(line); m[r["name"]] = {**m.get(r["name"], {}), **r}
    return m

def log(rec):
    with open(LOG, "a") as f: f.write(json.dumps(rec, ensure_ascii=False) + "\n")

def retry(fn, n=6):
    for i in range(n):
        try: return fn()
        except requests.exceptions.RequestException as e:
            print("  网络错误，重试", type(e).__name__, flush=True); time.sleep(4 + i * 3)
    raise SystemExit("网络一直失败")

jobs = json.load(open(sys.argv[1])); done = load(); pending = []
for j in jobs:
    out = os.path.join(ROOT, f"art/models_src/{j['name']}_raw.glb")
    rec = done.get(j["name"], {})
    if rec.get("downloaded") and os.path.exists(out): print("skip", j["name"]); continue
    tid = rec.get("task_id")
    if not tid:
        token = retry(lambda: tripo.upload(os.path.join(ROOT, j["image"])))
        tid = retry(lambda: tripo.create("/generation/image-to-model", {"input": token, "model": j.get("model", "v3.1-20260211"), "texture": True, "pbr": True, "texture_quality": j.get("texture_quality", "standard"), "face_limit": j["face_limit"]}))
        log({"name": j["name"], "task_id": tid, "image": j["image"], "face_limit": j["face_limit"], "time": time.strftime("%Y-%m-%d %H:%M:%S")})
        print("submitted", j["name"], tid, flush=True)
    pending.append((j["name"], tid, out))
print("balance", json.dumps(retry(tripo.balance)), flush=True)
t0 = time.time()
while pending and time.time() - t0 < 3000:
    for item in list(pending):
        name, tid, out = item
        d = retry(lambda: tripo.task(tid)); st = d.get("status")
        if st == "success":
            o = d.get("output") or {}; url = o.get("model_url") or o.get("pbr_model") or o.get("model")
            size = retry(lambda: tripo.download(url, out))
            log({"name": name, "downloaded": True, "credits": d.get("credits_consumed"), "mb": round(size / 1e6, 1)})
            print(f"ok {name} {size / 1e6:.1f}MB credits={d.get('credits_consumed')}", flush=True); pending.remove(item)
        elif st in ("failed", "cancelled", "banned", "expired"):
            log({"name": name, "failed": st, "error": d.get("error_message")}); print("FAIL", name, st, d.get("error_message"), flush=True); pending.remove(item)
    time.sleep(8)
print("left", [p[0] for p in pending], "balance", json.dumps(retry(tripo.balance)))
