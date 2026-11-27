#!/usr/bin/env python3
# 把 assets/tex/ 里的 JPEG 贴图重编码成 AVIF（体积约为原来的三到五成），JPEG 留作不支持 AVIF 的浏览器的后备。
# 用法：python3 tools/pack_textures.py [输出目录] [--q 漫反射,法线,ARM]      需要 Pillow ≥ 11.3（自带 AVIF）
#   法线贴图一律 4:4:4（色度抽样会把 R / G 两个方向的细节抹掉）；漫反射 / ARM 沿用源文件的抽样方式；高度图是灰度。
#   质量档是在游戏里同机位逐像素对比后定的，见 README「首次载入的体积」。
import sys, os, glob, io, struct
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); SRC = os.path.join(ROOT, 'assets', 'tex')
args = [a for a in sys.argv[1:] if not a.startswith('--')]; OUT = args[0] if args else SRC
Q = (48, 62, 48)   # 漫反射 / 法线 / ARM（高度图同 ARM）：贴图共 5.5 MB。正常距离看不出差别，贴近墙面、地面细看会略糊（实测与更高的档位见 README「首次载入的体积」）
if '--q' in sys.argv: Q = tuple(int(x) for x in sys.argv[sys.argv.index('--q') + 1].split(','))
os.makedirs(OUT, exist_ok=True)


def subsampling(path):   # 读 JPEG 的 SOF：亮度分量的抽样因子 0x22 = 4:2:0
    d = open(path, 'rb').read(); i = 2
    while i < len(d):
        if d[i] != 0xFF: i += 1; continue
        m = d[i + 1]
        if m in (0xC0, 0xC1, 0xC2): n = d[i + 9]; return '4:2:0' if n == 3 and d[i + 11] == 0x22 else '4:4:4'
        i += 2 + struct.unpack('>H', d[i + 2:i + 4])[0]
    return '4:4:4'


tot0 = tot1 = 0
for p in sorted(glob.glob(os.path.join(SRC, '*.jpg'))):
    name = os.path.basename(p)[:-4]; kind = name.rsplit('_', 1)[1]; im = Image.open(p); im.load()
    q = Q[1] if kind == 'nor' else Q[0] if kind == 'diff' else Q[2]
    sub = '4:4:4' if kind == 'nor' or im.mode == 'L' else subsampling(p)
    b = io.BytesIO(); im.save(b, 'AVIF', quality=q, subsampling=sub, speed=3); data = b.getvalue()
    open(os.path.join(OUT, name + '.avif'), 'wb').write(data); tot0 += os.path.getsize(p); tot1 += len(data)
    print(f'{name:22s} {im.size[0]}x{im.size[1]} q{q} {sub}  {os.path.getsize(p) / 1024:6.0f} KB → {len(data) / 1024:6.0f} KB')
print(f'合计 {tot0 / 1048576:.1f} MB → {tot1 / 1048576:.1f} MB（{tot1 / tot0 * 100:.0f}%）')
