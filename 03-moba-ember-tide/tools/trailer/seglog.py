#!/usr/bin/env python3
"""把 cap.mjs 记的逐帧日志（时间、击杀数、导播在看什么、剩几座塔）按段落打出来，挑镜头用。
用法: python3 tools/trailer/seglog.py docs/trailer/raw/h1.log.json"""
import json, sys
L = json.load(open(sys.argv[1]))
prev = None; start = 0; st = 0
for f, v in L + [[len(L), [None, None, "END", None]]]:
    t, k, foc, tw = v
    key = (foc, k, tw)
    if prev is None or key != prev:
        if prev: print(f"{start/30:6.1f}-{f/30:6.1f}s  对局{st}s  导播看={prev[0]} 击杀={prev[1]} 塔={prev[2]}")
        prev = key; start = f; st = t
