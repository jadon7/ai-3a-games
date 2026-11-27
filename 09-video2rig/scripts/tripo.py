#!/usr/bin/env python3
"""Tripo v3 API 小客户端：上传图片、图转模型、绑骨检查、自动绑骨、下载结果。

key 从 ~/.config/video2rig/env 里的 TRIPO_API_KEY 读取（不放在项目目录里，避免被同步盘带走）。

用法:
  python scripts/tripo.py balance
  python scripts/tripo.py image2model assets/concept/x.png --face-limit 40000
  python scripts/tripo.py rigcheck <task_id>
  python scripts/tripo.py rig <task_id> --rig-type biped --model v3.0-20260909 --out-format glb
  python scripts/tripo.py wait <task_id> [--download out.glb]
"""
import argparse
import json
import os
import sys
import time

import requests

BASE = "https://openapi.tripo3d.ai/v3"  # 国际站；国内站是 openapi.tripo3d.com
ENV_FILE = os.path.expanduser("~/.config/video2rig/env")


def api_key() -> str:
    key = os.environ.get("TRIPO_API_KEY")
    if not key and os.path.exists(ENV_FILE):
        for line in open(ENV_FILE, encoding="utf-8"):
            if line.startswith("TRIPO_API_KEY="):
                key = line.split("=", 1)[1].strip()
    if not key:
        sys.exit(f"找不到 TRIPO_API_KEY（应写在 {ENV_FILE}）")
    return key


def headers():
    return {"Authorization": f"Bearer {api_key()}"}


def check(resp):
    try:
        body = resp.json()
    except Exception:
        sys.exit(f"HTTP {resp.status_code}: {resp.text[:400]}")
    if body.get("code") != 0:
        sys.exit("Tripo 返回错误: " + json.dumps(body, ensure_ascii=False)[:600])
    return body["data"]


def balance():
    return check(requests.get(f"{BASE}/account/balance", headers=headers(), timeout=30))


def upload(path):
    with open(path, "rb") as f:
        data = check(requests.post(f"{BASE}/files", headers=headers(), files={"file": f}, timeout=120))
    return data["file_token"]


def create(endpoint, payload):
    data = check(requests.post(f"{BASE}{endpoint}", headers=headers(), json=payload, timeout=60))
    return data["task_id"]


def task(task_id):
    return check(requests.get(f"{BASE}/tasks/{task_id}", headers=headers(), timeout=30))


def wait(task_id, timeout=1200, interval=5):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        d = task(task_id)
        st, pr = d.get("status"), d.get("progress")
        if (st, pr) != last:
            print(f"  [{int(time.time() - t0):4d}s] {st} {pr}%", flush=True)
            last = (st, pr)
        if st in ("success", "failed", "cancelled", "banned", "expired"):
            return d
        time.sleep(interval)
    sys.exit(f"等待超时: {task_id}")


def download(url, out):
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with requests.get(url, stream=True, timeout=300) as r:
        r.raise_for_status()
        with open(out, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return os.path.getsize(out)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("balance")

    p = sub.add_parser("image2model")
    p.add_argument("image")
    p.add_argument("--model", default="v3.1-20260211")
    p.add_argument("--face-limit", type=int, default=40000)
    p.add_argument("--texture-quality", default="standard")

    p = sub.add_parser("rigcheck")
    p.add_argument("input")

    p = sub.add_parser("rig")
    p.add_argument("input")
    p.add_argument("--model", default="v3.0-20260909")
    p.add_argument("--rig-type", default="biped")
    p.add_argument("--spec", default="tripo")
    p.add_argument("--out-format", default="glb")

    p = sub.add_parser("wait")
    p.add_argument("task_id")
    p.add_argument("--download")

    a = ap.parse_args()

    if a.cmd == "balance":
        print(json.dumps(balance()))
    elif a.cmd == "image2model":
        token = upload(a.image)
        tid = create("/generation/image-to-model", {
            "input": token,
            "model": a.model,
            "texture": True,
            "pbr": True,
            "texture_quality": a.texture_quality,
            "face_limit": a.face_limit,
        })
        print("task_id:", tid)
        print("balance after create:", json.dumps(balance()))
    elif a.cmd == "rigcheck":
        tid = create("/animations/rig-check", {"input": a.input})
        print("task_id:", tid)
        d = wait(tid, timeout=300)
        print(json.dumps({k: d.get(k) for k in ("status", "output", "credits_consumed", "error_message")}, ensure_ascii=False))
    elif a.cmd == "rig":
        payload = {"input": a.input, "model": a.model, "rig_type": a.rig_type, "out_format": a.out_format}
        if a.rig_type == "biped":
            payload["spec"] = a.spec
        tid = create("/animations/rig", payload)
        print("task_id:", tid)
        print("balance after create:", json.dumps(balance()))
    elif a.cmd == "wait":
        d = wait(a.task_id)
        out = d.get("output") or {}
        print(json.dumps({k: d.get(k) for k in ("status", "type", "credits_consumed", "error_code", "error_message")}, ensure_ascii=False))
        print("output keys:", list(out.keys()))
        if d.get("status") == "success" and a.download:
            url = out.get("model_url") or out.get("pbr_model") or out.get("model")
            if not url:
                sys.exit("输出里没有 model_url: " + json.dumps(out)[:300])
            size = download(url, a.download)
            print(f"saved {a.download} ({size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
