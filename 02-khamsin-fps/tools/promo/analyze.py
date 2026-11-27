#!/usr/bin/env python3
"""读采集段的状态表（<段>.rows.json），按半秒一行打印机动状态，并给出“连招密集”的候选时段。

用法：python3 tools/promo/analyze.py <promo-work 目录> <段名> [--top N] [--win 秒]
每行：保存帧号  秒  标记（S 滑铲 / W 蹬墙 / G 钩索牵引 / A 空中 / M 机甲）  速度  击杀  位置
"""
import json
import sys
from pathlib import Path


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    work, shot = Path(args[0]), args[1]
    top = int(sys.argv[sys.argv.index('--top') + 1]) if '--top' in sys.argv else 12
    win = float(sys.argv[sys.argv.index('--win') + 1]) if '--win' in sys.argv else 4.0
    d = json.loads((work / f'{shot}.rows.json').read_text())
    K = {k: i for i, k in enumerate(d['keys'])}
    R = d['rows']
    print(f'{shot}: {len(R)} 帧 ({len(R) / 60:.1f} s)')
    if '--quiet' not in sys.argv:
        for j in range(0, len(R), 30):
            seg = R[j:j + 30]
            fl = ''.join(c for c, k in (('S', 'slide'), ('W', 'wall'), ('A', 'ground'), ('M', 'mech'))
                         if any((r[K[k]] if k != 'ground' else 1 - r[K[k]]) for r in seg))
            if any(r[K['grap']] == 2 for r in seg):
                fl += 'G'
            gap = any(seg[i + 1][K['t']] - seg[i][K['t']] > 0.05 for i in range(len(seg) - 1))
            r = seg[0]
            print(f"{r[0]:6d} {r[0] / 60:6.1f}s {fl:6s} v{max(x[K['speed']] for x in seg):5.1f} k{r[K['kills']]:3d}"
                  f" ({r[K['x']]:6.1f},{r[K['y']]:5.1f},{r[K['z']]:6.1f}){' 跳时' if gap else ''}")
    # 候选：窗口内 滑铲 / 蹬墙 / 钩索 / 空中 / 击杀 的加权分；窗口内不能跨越“跳时”（阵亡跳过的地方），不在机甲里
    n = int(win * 60)
    cands = []
    for j in range(0, len(R) - n, 15):
        seg = R[j:j + n]
        if any(seg[i + 1][K['t']] - seg[i][K['t']] > 0.05 for i in range(len(seg) - 1)):
            continue
        if any(r[K['mech']] for r in seg):
            continue
        s = sum(r[K['slide']] for r in seg) / 60 * 1.0 + sum(r[K['wall']] for r in seg) / 60 * 1.6 \
            + sum(r[K['grap']] == 2 for r in seg) / 60 * 2.0 + sum(1 - r[K['ground']] for r in seg) / 60 * 0.6 \
            + (seg[-1][K['kills']] - seg[0][K['kills']]) * 1.2
        kinds = sum(1 for k in ('slide', 'wall') if any(r[K[k]] for r in seg)) + (1 if any(r[K['grap']] == 2 for r in seg) else 0)
        cands.append((s + kinds * 1.5, j, kinds, seg[-1][K['kills']] - seg[0][K['kills']]))
    cands.sort(reverse=True)
    picked = []
    for c in cands:
        if all(abs(c[1] - p[1]) >= n for p in picked):
            picked.append(c)
        if len(picked) >= top:
            break
    print('候选（分数 起始帧 动作种类 击杀）：')
    for c in picked:
        print(f'  {c[0]:5.1f}  in={c[1]:6d} ({c[1] / 60:5.1f}s)  种类{c[2]}  击杀{c[3]}')
    # 机甲时段
    m = [r[0] for r in R if r[K['mech']]]
    if m:
        print(f'机甲内：帧 {m[0]}–{m[-1]}（{m[0] / 60:.1f}s–{m[-1] / 60:.1f}s）')


if __name__ == '__main__':
    main()
