"""扫描 public/assets/audio 生成 manifest.json（游戏运行时按它加载）。"""
import json
import os
import re
import master as M

files = sorted(f for f in os.listdir(M.OUT) if f.endswith('.m4a'))
sfx = {}
music = {}
mrep_path = os.path.join(M.DOCS, 'music_report.json')
mrep = json.load(open(mrep_path)) if os.path.exists(mrep_path) else {}
for f in files:
    base = f[:-4]
    if base.startswith('music_') or base.startswith('amb_'):
        r = mrep.get(base, {})
        music[base] = {'file': f, 'loop': r.get('loop_sec') is not None, 'loopSec': r.get('loop_sec'),
                       'loopSamples': r.get('loop_samples'), 'sr': M.SR}
        continue
    m = re.match(r'^(.*)_(\d+)$', base)
    name = m.group(1) if m else base
    sfx.setdefault(name, []).append(f)
loops = ['fire_fly', 'frost_fly']
total = sum(os.path.getsize(os.path.join(M.OUT, f)) for f in files)
man = {'version': 1, 'sfx': sfx, 'music': music, 'loops': loops, 'totalBytes': total}
json.dump(man, open(os.path.join(M.OUT, 'manifest.json'), 'w'), ensure_ascii=False, indent=1)
print(len(sfx), 'sfx names,', len(music), 'music,', round(total / 1e6, 2), 'MB')
