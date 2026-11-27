#!/usr/bin/env python3
"""把 play_test.mjs 打出来的 __report() 排成好读的样子。用法: node tools/play_test.mjs … | python3 tools/match_report.py"""
import sys, json
seen = set()
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    if line.startswith('{'): print(line[:400]); continue
    k, _, v = line.partition(' ')
    try: d = json.loads(v)
    except Exception: print(line[:400]); continue
    if not isinstance(d, dict) or 'heroes' not in d: print(line[:400]); continue
    key = (d['t'], d['over'])
    if key in seen: continue
    seen.add(key)
    print(f"{k}  时间 {d['t']//60}:{d['t']%60:02d}  结果 {d['over']}  击杀 {d['kills']}  塔 {d['towers']}（中上下 {d.get('lanes', '')}）  安排 {d['order']}  营地 {d['camps']}  Boss {d.get('boss')}  队伍增益 {d.get('buff')}")
    for h in d['heroes']: print('   ', h)
