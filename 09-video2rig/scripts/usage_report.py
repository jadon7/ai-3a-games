#!/usr/bin/env python3
"""统计一次 Claude Code 对话（含子代理）的 token 用量。

用法: python scripts/usage_report.py <主对话.jsonl> [<子代理.jsonl> ...] [--json out.json]
同一条消息在记录里可能出现多次（每个内容块一行），按消息 id 去重后再累加。
"""
import json
import sys
from collections import defaultdict

args = [a for a in sys.argv[1:]]
out_json = None
if "--json" in args:
    i = args.index("--json")
    out_json = args[i + 1]
    del args[i:i + 2]

FIELDS = ("input_tokens", "cache_creation_input_tokens", "cache_write_5m", "cache_write_1h", "cache_read_input_tokens", "output_tokens")
# 按 API 公开价折算（美元 / 百万 token）：输入、输出、读缓存；写缓存 = 输入价 × 1.25（5 分钟）或 × 2（1 小时）
PRICES = {"claude-fable-5-2": (8.0, 40.0, 0.20), "claude-opus-5-5": (4.0, 20.0, 0.20)}


def cost_usd(model, m):
    if model not in PRICES:
        return None
    pin, pout, pread = PRICES[model]
    other_write = m["cache_creation_input_tokens"] - m["cache_write_5m"] - m["cache_write_1h"]
    return (m["input_tokens"] * pin + m["output_tokens"] * pout + m["cache_read_input_tokens"] * pread
            + (m["cache_write_5m"] + max(other_write, 0)) * pin * 1.25 + m["cache_write_1h"] * pin * 2) / 1e6
report = {}
for path in args:
    seen = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if '"usage"' not in line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            msg = rec.get("message") or {}
            usage = msg.get("usage")
            if not usage or msg.get("role") != "assistant":
                continue
            key = msg.get("id") or rec.get("uuid")
            prev = seen.get(key)
            cur = {k: int(usage.get(k) or 0) for k in FIELDS}
            cc = usage.get("cache_creation") or {}
            cur["cache_write_5m"] = int(cc.get("ephemeral_5m_input_tokens") or 0)
            cur["cache_write_1h"] = int(cc.get("ephemeral_1h_input_tokens") or 0)
            cur["model"] = msg.get("model") or "?"
            if prev is None or cur["output_tokens"] >= prev["output_tokens"]:
                seen[key] = cur
    by_model = defaultdict(lambda: dict.fromkeys(FIELDS, 0) | {"messages": 0})
    for v in seen.values():
        m = by_model[v["model"]]
        for k in FIELDS:
            m[k] += v[k]
        m["messages"] += 1
    report[path.split("/")[-1]] = dict(by_model)

total = defaultdict(lambda: dict.fromkeys(FIELDS, 0) | {"messages": 0})
for name, models in report.items():
    print(name)
    for model, m in models.items():
        print("  %-28s 回合 %4d | 新输入 %10s | 写缓存 %11s | 读缓存 %13s | 输出 %10s" % (
            model, m["messages"], f"{m['input_tokens']:,}", f"{m['cache_creation_input_tokens']:,}",
            f"{m['cache_read_input_tokens']:,}", f"{m['output_tokens']:,}"))
        for k in (*FIELDS, "messages"):
            total[model][k] += m[k]
print("合计（按模型）")
grand = 0.0
for model, m in total.items():
    c = cost_usd(model, m)
    grand += c or 0
    m["cost_usd"] = c
    print("  %-18s 回合 %4d | 新输入 %s | 写缓存 %s（5 分钟 %s / 1 小时 %s）| 读缓存 %s | 输出 %s | 按 API 公开价折算 $%s" % (
        model, m["messages"], f"{m['input_tokens']:,}", f"{m['cache_creation_input_tokens']:,}", f"{m['cache_write_5m']:,}",
        f"{m['cache_write_1h']:,}", f"{m['cache_read_input_tokens']:,}", f"{m['output_tokens']:,}", "?" if c is None else f"{c:.2f}"))
print("折算合计: $%.2f" % grand)
if out_json:
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({"files": report, "total": dict(total), "cost_usd": grand}, f, ensure_ascii=False, indent=1)
