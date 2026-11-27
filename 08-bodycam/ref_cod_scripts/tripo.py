#!/usr/bin/env python3
"""Minimal Tripo apiv3 client (no proxy). Usage:
  tripo.py gen  NAME PROMPT [model] [tq] [gq] [face_limit]
  tripo.py rig  NAME [spec]
  tripo.py anim NAME OUTNAME preset:a,preset:b [in_place]
  tripo.py task TASKID
"""
import json, os, sys, time, urllib.request, pathlib
BASE = "https://openapi.tripo3d.ai"
KEY = open(os.environ["TRIPO_KEY_FILE"]).read().strip()
OP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
ROOT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "tripo"

def req(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    for attempt in range(40):
        try:
            with OP.open(r, timeout=60) as resp:
                body = json.loads(resp.read())
            break
        except urllib.error.HTTPError as e:
            body = json.loads(e.read() or b"{}")
            print("HTTP", e.code, body, flush=True)
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(10); continue
            raise SystemExit(1)
        except Exception as e:
            print("net err", e, flush=True); time.sleep(10)
    if body.get("code", 0) != 0:
        print("API error", body, flush=True); raise SystemExit(1)
    return body.get("data", body)

def wait(tid, label):
    t0 = time.time()
    while True:
        d = req("GET", f"/v3/tasks/{tid}")
        st = d.get("status")
        print(f"[{label}] {st} {d.get('progress')} {int(time.time()-t0)}s", flush=True)
        if st in ("success", "failed", "cancelled", "banned", "expired"):
            return d
        time.sleep(8)

def dl(url, path):
    with OP.open(url, timeout=300) as r, open(path, "wb") as f:
        f.write(r.read())
    print("saved", path, os.path.getsize(path), flush=True)

def save_outputs(d, folder, prefix):
    out = d.get("output", {}) or {}
    (folder / f"{prefix}_task.json").write_text(json.dumps(d, indent=1))
    for k, v in out.items():
        if isinstance(v, str) and v.startswith("http"):
            ext = ".glb" if "model" in k else (".webp" if "image" in k else ".bin")
            if "fbx" in v.split("?")[0].lower(): ext = ".fbx"
            if ".png" in v.split("?")[0].lower(): ext = ".png"
            if ".jpg" in v.split("?")[0].lower(): ext = ".jpg"
            dl(v, folder / f"{prefix}_{k}{ext}")

cmd = sys.argv[1]
if cmd == "task":
    print(json.dumps(req("GET", f"/v3/tasks/{sys.argv[2]}"), indent=1)); sys.exit()
name = sys.argv[2]
folder = ROOT / name; folder.mkdir(parents=True, exist_ok=True)
meta_p = folder / "meta.json"
meta = json.loads(meta_p.read_text()) if meta_p.exists() else {}
if cmd == "gen":
    prompt = sys.argv[3]
    model = sys.argv[4] if len(sys.argv) > 4 else "v3.0-20250812"
    p = {"prompt": prompt, "model": model, "texture": True, "pbr": True}
    if len(sys.argv) > 5: p["texture_quality"] = sys.argv[5]
    if len(sys.argv) > 6: p["geometry_quality"] = sys.argv[6]
    if len(sys.argv) > 7: p["face_limit"] = int(sys.argv[7])
    tid = req("POST", "/v3/generation/text-to-model", p)["task_id"]
    meta.update(gen_task=tid, prompt=prompt, model=model); meta_p.write_text(json.dumps(meta, indent=1))
    d = wait(tid, name); save_outputs(d, folder, "gen")
elif cmd == "rig":
    spec = sys.argv[3] if len(sys.argv) > 3 else "mixamo"
    tid = req("POST", "/v3/animations/rig-check", {"input": meta["gen_task"]})["task_id"]
    d = wait(tid, name + "-check"); print("check output", d.get("output"), flush=True)
    tid = req("POST", "/v3/animations/rig", {"input": meta["gen_task"], "model": "v3.0-20260909",
                                              "rig_type": "biped", "spec": spec, "out_format": "glb"})["task_id"]
    meta.update(rig_task=tid); meta_p.write_text(json.dumps(meta, indent=1))
    d = wait(tid, name + "-rig"); save_outputs(d, folder, "rig")
elif cmd == "anim":
    outname = sys.argv[3]; anims = sys.argv[4].split(",")
    p = {"input": meta["rig_task"], "animations": anims, "out_format": "glb", "export_with_geometry": True}
    if len(sys.argv) > 5: p["animate_in_place"] = sys.argv[5] == "1"
    tid = req("POST", "/v3/animations/retarget", p)["task_id"]
    meta[f"anim_{outname}"] = tid; meta_p.write_text(json.dumps(meta, indent=1))
    d = wait(tid, name + "-" + outname); save_outputs(d, folder, "anim_" + outname)
