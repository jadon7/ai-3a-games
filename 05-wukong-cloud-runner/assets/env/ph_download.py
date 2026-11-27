#!/usr/bin/env python3
"""从 Poly Haven 公开 API 下载 CC0 素材。
用法：
  python3 ph_download.py tex <id> <res> [maps...]      -> ROOT/assets/tex/<id>/
  python3 ph_download.py model <id> <res>              -> ROOT/assets/env/ph/<id>/
"""
import json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
UA = {'User-Agent': 'blender-script'}


def fetch_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def dl(url, dst):
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        print('  have', os.path.basename(dst)); return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    t = time.time()
    req = urllib.request.Request(url, headers=UA)
    tmp = dst + '.part'
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, 'wb') as f:
        n = 0
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b); n += len(b)
    os.replace(tmp, dst)
    dt = time.time() - t
    print(f'  got {os.path.basename(dst)} {n/1e6:.1f}MB in {dt:.1f}s ({n/1e6/max(dt,1e-3):.1f}MB/s)', flush=True)


def main():
    kind, aid, res = sys.argv[1], sys.argv[2], sys.argv[3]
    files = fetch_json(f'https://api.polyhaven.com/files/{aid}')
    if kind == 'tex':
        maps = sys.argv[4:] or ['Diffuse', 'nor_gl', 'Rough', 'Displacement']
        out = os.path.join(ROOT, 'assets', 'tex', aid)
        for m in maps:
            if m not in files:
                print('  no map', m); continue
            fm = files[m][res]
            ext = 'jpg' if 'jpg' in fm else ('png' if 'png' in fm else list(fm.keys())[0])
            if m == 'Displacement' and 'png' in fm:
                ext = 'png'
            dl(fm[ext]['url'], os.path.join(out, f'{aid}_{m}_{res}.{ext}'))
    else:
        out = os.path.join(ROOT, 'assets', 'env', 'ph', aid)
        b = files['blend'][res]['blend']
        dl(b['url'], os.path.join(out, os.path.basename(b['url'])))
        for rel, info in b.get('include', {}).items():
            dl(info['url'], os.path.join(out, rel))
    print('DONE', aid)


if __name__ == '__main__':
    main()
