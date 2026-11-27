#!/usr/bin/env python3
"""通用动作用的 Tripo 小工具：绑骨、要预设动作、等结果、下载。每次花的额度记进 art/generic/tripo_log.jsonl。

  python tools/generic/tripo_presets.py rig <task_id 或 GLB 路径> --model v1.0-20240301 --spec mixamo --tag gorran_v1 --out art/generic/gorran/v1_rigged.glb
  python tools/generic/tripo_presets.py anim <绑骨 task_id> --tag gorran_v3a --out art/generic/gorran/v3_a.glb preset:hurt preset:fall ...
  python tools/generic/tripo_presets.py balance

key 由 tools/tripo.py 从 ~/.config/video2rig/env 读，这里不碰。
"""
import argparse, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
FG = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(FG, "tools"))
import tripo  # noqa: E402

LOG = os.path.join(FG, "art", "generic", "tripo_log.jsonl")


def log(rec):
    rec["time"] = time.strftime("%Y-%m-%d %H:%M:%S")
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print("LOG", json.dumps(rec, ensure_ascii=False), flush=True)


def finish(tid, out, tag, kind, extra):
    d = tripo.wait(tid, timeout=1800)
    o = d.get("output") or {}
    rec = {"tag": tag, "kind": kind, "task_id": tid, "status": d.get("status"), "credits": d.get("credits_consumed"),
           "error": d.get("error_message") or d.get("error_code"), **extra}
    if d.get("status") == "success":
        url = o.get("model_url") or o.get("model")
        if url:
            for attempt in range(4):                     # 下载偶尔会被截断：按 GLB 头里写的总长度校验，不对就重下（不花额度）
                size = tripo.download(url, out)
                with open(out, "rb") as f: head = f.read(12)
                want = int.from_bytes(head[8:12], "little") if head[:4] == b"glTF" else -1
                if want == size: break
                print(f"  下载不完整 {size}/{want}，重下", flush=True)
            rec["mb"] = round(size / 1e6, 2); rec["file"] = os.path.relpath(out, FG); rec["complete"] = (want == size)
        rec["output_keys"] = list(o.keys())
    log(rec)
    return d


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("balance")
    p = sub.add_parser("rig"); p.add_argument("input"); p.add_argument("--model", default="v1.0-20240301")
    p.add_argument("--spec", default="mixamo"); p.add_argument("--tag", required=True); p.add_argument("--out", required=True)
    p = sub.add_parser("anim"); p.add_argument("input"); p.add_argument("presets", nargs="+")
    p.add_argument("--tag", required=True); p.add_argument("--out", required=True); p.add_argument("--no-geometry", action="store_true")
    p = sub.add_parser("wait"); p.add_argument("task_id"); p.add_argument("--tag", required=True); p.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.cmd == "balance":
        print(json.dumps(tripo.balance())); return
    if a.cmd == "rig":
        inp = a.input
        if os.path.exists(inp):
            inp = tripo.upload(inp); print("uploaded ->", "file token ok", flush=True)
        tid = tripo.create("/animations/rig", {"input": inp, "model": a.model, "rig_type": "biped", "spec": a.spec, "out_format": "glb"})
        print("task_id:", tid, flush=True)
        log({"tag": a.tag, "kind": "rig_created", "task_id": tid, "model": a.model, "spec": a.spec})
        finish(tid, a.out, a.tag, "rig", {"model": a.model, "spec": a.spec})
    elif a.cmd == "anim":
        body = {"input": a.input, "out_format": "glb", "animate_in_place": False, "export_with_geometry": not a.no_geometry}
        if len(a.presets) == 1: body["animation"] = a.presets[0]
        else: body["animations"] = a.presets
        tid = tripo.create("/animations/retarget", body)
        print("task_id:", tid, flush=True)
        log({"tag": a.tag, "kind": "anim_created", "task_id": tid, "presets": a.presets})
        finish(tid, a.out, a.tag, "anim", {"presets": a.presets, "rig_task": a.input})
    elif a.cmd == "wait":
        finish(a.task_id, a.out, a.tag, "wait", {})
    print("balance:", json.dumps(tripo.balance()))


if __name__ == "__main__":
    main()
