"""写实版合成与调色。
固定机位镜头：背景板 plate.png + 逐帧角色元素层 elem_####.png（RGBA）→ 合成 → 2D 机位运动 → 镜头/胶片效果。
跟拍镜头：full_####.png → 镜头/胶片效果。

用法：python comp.py <A|B|C|D> [f0 f1] [--still=帧号] [--workers=6]
输出：renders_real/<shot>/comp_####.png（8-bit，1920x804）
"""
import sys, os, json, glob, math
import numpy as np
import cv2
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RR = os.path.join(ROOT, 'renders_real')
W, H = 1920, 804

# 每个镜头的 2D 机位运动与调色微调
SHOT = {
    'A': dict(n=84, kind='plate', zoom=(0.950, 0.995), pan=((-70, 6), (70, -8)), shake=0.9, haze_L=1400.0, expo=0.00, mist=0.40),
    'B': dict(n=60, kind='layer', expo=0.00, elem_gamma=0.86, wrap=0.35),
    'F': dict(n=72, kind='layer', expo=0.00, elem_gamma=0.88, wrap=0.35),
    'E': dict(n=72, kind='layer', expo=0.00, wrap=0.20),
    'C': dict(n=96, kind='plate', zoom=(0.945, 1.000), pan=((-20, 14), (24, -10)), shake=1.6, haze_L=900.0, expo=0.00, mist=0.40, elem_gain=1.2),
    'D': dict(n=108, kind='plate', zoom=(0.930, 1.000), pan=((0, 20), (0, -26)), shake=1.2, haze_L=2600.0, expo=-0.05, tint=(0.80, 0.93, 1.05), gamma=1.25, glare=0.55, mist=0.30, cloud_glow=0.72, cloud_bright=1.55, cloud_lo=0.08, cloud_hi=0.30),
}
ORDER = ['A', 'B', 'F', 'E', 'C', 'D']


def to_lin(x):
    return np.power(np.clip(x, 0, 1), 2.2)


def to_disp(x):
    return np.power(np.clip(x, 0, None), 1 / 2.2)


def imread_f(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        raise IOError(path)
    mx = 65535.0 if im.dtype == np.uint16 else 255.0
    return im.astype(np.float32) / mx


def smooth_noise(n, seed, freq):
    """低频平滑噪声（几个正弦叠加），返回 n 个值，范围约 ±1"""
    rng = np.random.RandomState(seed)
    t = np.arange(n) / 24.0
    out = np.zeros(n)
    for k in range(5):
        f = freq * (0.6 + 0.9 * k) * (0.8 + 0.4 * rng.rand())
        out += np.sin(2 * math.pi * f * t + rng.rand() * 6.28) / (1.0 + 0.7 * k)
    return out / 1.6


_plate = {}


def get_plate(shot):
    if shot not in _plate:
        p = imread_f(os.path.join(RR, shot, 'plate.png'))[..., :3]
        _plate[shot] = (to_lin(p), cv2.GaussianBlur(to_lin(p), (0, 0), 28))
    return _plate[shot]


_mist = {}


def mist_layer(f, shape):
    """缓慢漂移的薄雾纹理（可平铺的分形噪声），让静止的背景板里雾气有流动感。"""
    if 'tex' not in _mist:
        rng = np.random.RandomState(5)
        n = 1024
        base = np.zeros((n, n), np.float32)
        for octv, amp in ((4, 1.0), (8, 0.6), (16, 0.35), (32, 0.18), (64, 0.09)):
            g = rng.rand(octv, octv).astype(np.float32)
            g = np.tile(g, (3, 3))
            big = cv2.resize(g, (3 * n, 3 * n), interpolation=cv2.INTER_CUBIC)
            base += amp * big[n:2 * n, n:2 * n]
        base = (base - base.min()) / (base.max() - base.min())
        _mist['tex'] = base
    tex = _mist['tex']
    h, w = shape
    xs = ((np.arange(w) * 0.42 + f * 0.55) % 1024).astype(np.float32)
    ys = ((np.arange(h) * 0.95 + f * 0.10) % 1024).astype(np.float32)
    mx, my = np.meshgrid(xs, ys)
    return cv2.remap(tex, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def composite(shot, f, meta):
    """背景 + 元素层，返回显示空间的浮点图（元素层的分辨率）"""
    cfg = SHOT[shot]
    ep = os.path.join(RR, shot, 'elem_%04d.png' % f)
    if not os.path.exists(ep) and cfg['kind'] == 'plate':
        pl = get_plate(shot)[0]
        el = np.zeros(pl.shape[:2] + (4,), np.float32)
    else:
        el = imread_f(ep)
    a = el[..., 3:4]
    rgb = to_lin(el[..., :3]) * cfg.get('elem_gain', 1.0)
    if 'elem_gamma' in cfg:                      # 逆光镜头：把角色暗部稍微托起来一点
        rgb = np.power(np.clip(rgb, 0, None), cfg['elem_gamma'])
    if cfg['kind'] == 'plate':
        plate, plate_blur = get_plate(shot)
        if el.shape[:2] != plate.shape[:2]:
            raise ValueError('plate/elem size mismatch %s %s' % (plate.shape, el.shape))
        # 空气透视：按距离把元素层往背景的雾色靠
        d = meta.get(str(f), [0.5, 0.5, 100.0])[2]
        k = 1.0 - math.exp(-d / cfg.get('haze_L', 1500.0))
        rgb = rgb * (1 - k) + plate_blur * k
        # 逆光时云尾迹应该是透亮的：把元素层里中等亮度的部分（云）往背景雾光的亮度上靠，暗的部分（人的剪影）不动
        cg = cfg.get('cloud_glow', 0.0)
        if cg > 0:
            lum_e = rgb[..., 0] * 0.0722 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.2126
            lo, hi = cfg.get('cloud_lo', 0.05), cfg.get('cloud_hi', 0.16)
            wc = np.clip((lum_e - lo) / (hi - lo), 0, 1)
            wc = (wc * wc * (3 - 2 * wc) * cg)[..., None]
            rgb = rgb + (plate_blur * cfg.get('cloud_bright', 1.18) - rgb) * wc
        mamt = cfg.get('mist', 0.0)
        if mamt > 0:
            m = mist_layer(f, plate.shape[:2])
            m = np.clip((m - 0.42) / 0.38, 0, 1)
            lum = plate_blur[..., 1]
            wgt = (mamt * m * np.clip((lum - 0.10) / 0.35, 0, 1))[..., None]
            plate = plate + (plate_blur * 1.12 - plate) * wgt
    else:
        bg = imread_f(os.path.join(RR, shot, 'bg_%04d.png' % f))[..., :3]
        if bg.shape[:2] != el.shape[:2]:
            bg = cv2.resize(bg, (el.shape[1], el.shape[0]), interpolation=cv2.INTER_CUBIC)
        plate = to_lin(bg)
    out = plate * (1 - a) + rgb * a
    lw = cfg.get('wrap', 0.0)
    if lw > 0:
        a1 = a[..., 0]
        inner = np.clip(a1 - cv2.GaussianBlur(a1, (0, 0), 7), 0, 1)
        out = out + cv2.GaussianBlur(plate, (0, 0), 14) * (inner * lw)[..., None]
    return to_disp(out)


def camera_move(img, shot, f):
    """在超出画幅的渲染上做缓慢推近/平移 + 轻微手持感，输出 1920x804"""
    cfg = SHOT[shot]
    n = cfg['n']
    h, w = img.shape[:2]
    t = (f - 1) / max(1, n - 1)
    te = t * t * (3 - 2 * t) * 0.6 + t * 0.4
    # 渲染比画幅大 20%：缩放系数 1.0 = 1:1 取中间一块；<1 是略微缩小（更锐），留出的边用来平移/推近
    z = cfg['zoom'][0] + (cfg['zoom'][1] - cfg['zoom'][0]) * te
    s = z * (1.0 if w > W else W / w)
    px = cfg['pan'][0][0] + (cfg['pan'][1][0] - cfg['pan'][0][0]) * te
    py = cfg['pan'][0][1] + (cfg['pan'][1][1] - cfg['pan'][0][1]) * te
    sh = cfg['shake']
    if sh > 0:
        px += sh * (smooth_noise(n + 8, 11, 0.55)[f] * 2.2 + smooth_noise(n + 8, 12, 3.1)[f] * 0.35)
        py += sh * (smooth_noise(n + 8, 13, 0.50)[f] * 1.8 + smooth_noise(n + 8, 14, 3.4)[f] * 0.35)
        rot = sh * smooth_noise(n + 8, 15, 0.4)[f] * 0.05
    else:
        rot = 0.0
    cx, cy = w / 2 + px, h / 2 + py
    M = cv2.getRotationMatrix2D((cx, cy), rot, s)
    M[0, 2] += W / 2 - cx
    M[1, 2] += H / 2 - cy
    return cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)


_vig = {}


def vignette():
    if 'v' not in _vig:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (W / 2)) ** 2)
        _vig['v'] = (1.0 - 0.30 * np.clip((r - 0.35) / 0.85, 0, 1) ** 2.0)[..., None]
        _vig['r'] = r
    return _vig['v']


def curve(x, contrast=1.18, pivot=0.42):
    """S 曲线（保持中灰）"""
    x = np.clip(x, 0, 1)
    lo = pivot * np.power(x / pivot, contrast)
    hi = 1 - (1 - pivot) * np.power((1 - x) / (1 - pivot), contrast)
    return np.where(x < pivot, lo, hi)


def grade(img, shot, f, sun=None):
    """img: 显示空间 BGR 浮点 0..1 → 调色 + 镜头效果 + 颗粒"""
    cfg = SHOT[shot]
    x = img.astype(np.float32)
    x = x * (2.0 ** cfg.get('expo', 0.0)) * np.array(cfg.get('tint', (1.0, 1.0, 1.0)), dtype=np.float32)
    if 'gamma' in cfg:
        x = np.power(np.clip(x, 0, 1), cfg['gamma'])
    # ---- 高光泛光 / 光晕（太阳、云的受光面）
    luma = x[..., 0] * 0.0722 + x[..., 1] * 0.7152 + x[..., 2] * 0.2126
    hot = x * np.clip((luma - 0.82) / 0.18, 0, 1)[..., None]
    sm = cv2.resize(hot, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
    g1 = cv2.GaussianBlur(sm, (0, 0), 3)
    g2 = cv2.GaussianBlur(sm, (0, 0), 12)
    g3 = cv2.GaussianBlur(sm, (0, 0), 40)
    glow = cv2.resize(g1 * 0.50 + g2 * 0.55 + g3 * 0.9, (W, H), interpolation=cv2.INTER_LINEAR)
    warm = np.array([0.62, 0.86, 1.0], dtype=np.float32)          # BGR：暖色光晕
    x = 1.0 - (1.0 - np.clip(x, 0, 1)) * (1.0 - np.clip(glow * warm * 0.55, 0, 1))
    # 太阳眩光：以太阳的屏幕位置为中心的暖色光幕（太阳在画外时也有）
    if sun is not None and abs(sun[0]) < 3 and abs(sun[1]) < 3:
        vignette()
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        r = np.sqrt((xx / W - sun[0]) ** 2 + ((yy / H - sun[1]) * H / W) ** 2)
        g_amt = cfg.get('glare', 0.30)
        veil = g_amt * (0.75 / (1.0 + (r / 0.16) ** 2) + 0.25 / (1.0 + (r / 0.55) ** 2))
        x = 1.0 - (1.0 - x) * (1.0 - np.clip(veil[..., None] * np.array([0.50, 0.80, 1.0], dtype=np.float32), 0, 1))
    # 红色光渗（halation）：高光边缘的一圈橙红
    hal = cv2.resize(cv2.GaussianBlur(sm, (0, 0), 6), (W, H), interpolation=cv2.INTER_LINEAR)
    x[..., 2] = 1.0 - (1.0 - x[..., 2]) * (1.0 - np.clip(hal[..., 2] * 0.16, 0, 1))
    # ---- 对比度与分离色调
    x = curve(x, 1.16, 0.40)
    luma = (x[..., 0] * 0.0722 + x[..., 1] * 0.7152 + x[..., 2] * 0.2126)[..., None]
    sat = 0.90
    x = luma + (x - luma) * sat
    shadow = np.array([1.06, 1.00, 0.93], dtype=np.float32)        # 暗部偏青蓝
    high = np.array([0.90, 0.985, 1.06], dtype=np.float32)         # 亮部偏暖金
    wsh = np.clip(1 - luma / 0.45, 0, 1) ** 1.5
    whi = np.clip((luma - 0.45) / 0.55, 0, 1) ** 1.2
    x = x * (1 + (shadow - 1) * wsh) * (1 + (high - 1) * whi)
    x = x * 0.985 + 0.012                                           # 轻抬黑位
    # ---- 边缘色散
    ca = 0.0006
    b, g, r = cv2.split(x)
    Mr = np.array([[1 + ca, 0, -ca * W / 2], [0, 1 + ca, -ca * H / 2]], dtype=np.float32)
    Mb = np.array([[1 - ca, 0, ca * W / 2], [0, 1 - ca, ca * H / 2]], dtype=np.float32)
    r = cv2.warpAffine(r, Mr, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    b = cv2.warpAffine(b, Mb, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    x = cv2.merge([b, g, r])
    x = x * vignette()
    # ---- 胶片颗粒（中间调最明显）
    rng = np.random.RandomState(1000 * (ord(shot) - 64) + f)
    gr = rng.normal(0, 1, (H, W)).astype(np.float32)
    gr = cv2.GaussianBlur(gr, (0, 0), 0.65)
    gr2 = cv2.resize(rng.normal(0, 1, (H // 2, W // 2)).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    luma = x[..., 0] * 0.0722 + x[..., 1] * 0.7152 + x[..., 2] * 0.2126
    amp = 0.017 * (0.35 + 1.3 * np.sqrt(np.clip(luma, 0, 1)) * (1 - np.clip(luma, 0, 1)) * 2.0)
    x = x + ((gr * 1.7 + gr2 * 0.5) * amp)[..., None]
    return np.clip(x, 0, 1)


def frame(shot, f, meta=None):
    cfg = SHOT[shot]
    img = composite(shot, f, meta or {})
    if cfg['kind'] == 'plate':
        img = camera_move(img, shot, f)
    elif img.shape[1] != W:
        img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
    m = (meta or {}).get(str(f))
    sun = (m[3], m[4]) if m is not None and len(m) >= 5 else None
    return grade(img, shot, f, sun)


def work(args):
    shot, f = args
    try:
        mp = os.path.join(RR, shot, 'meta.json')
        meta = json.load(open(mp)) if os.path.exists(mp) else {}
        out = frame(shot, f, meta)
        cv2.imwrite(os.path.join(RR, shot, 'comp_%04d.png' % f), (out * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_PNG_COMPRESSION, 2])
        return None
    except Exception as e:
        return '%s %d %r' % (shot, f, e)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = dict(a[2:].split('=') for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    shot = args[0]
    n = SHOT[shot]['n']
    if 'grade' in opts:
        # 直接给一张试渲图调色（看调色效果用）：--grade=图片路径 [--sun=x,y]
        img = imread_f(opts['grade'])[..., :3]
        img = cv2.resize(img, (W, H), interpolation=cv2.INTER_CUBIC)
        sun = tuple(float(v) for v in opts['sun'].split(',')) if 'sun' in opts else None
        out = grade(img, shot, 1, sun)
        dst = os.path.join(ROOT, 'tests', 'graded_' + os.path.basename(opts['grade']).replace('.png', '.jpg'))
        cv2.imwrite(dst, (out * 255 + 0.5).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 92])
        print('GRADED', dst)
    elif 'still' in opts:
        f = int(opts['still'])
        meta = json.load(open(os.path.join(RR, shot, 'meta.json')))
        out = frame(shot, f, meta)
        dst = os.path.join(ROOT, 'tests', 'comp_%s_%03d.png' % (shot, f))
        cv2.imwrite(dst, (out * 255 + 0.5).astype(np.uint8))
        print('STILL', dst)
    else:
        f0 = int(args[1]) if len(args) > 1 else 1
        f1 = int(args[2]) if len(args) > 2 else n
        with Pool(int(opts.get('workers', 6))) as p:
            bad = [b for b in p.imap_unordered(work, [(shot, f) for f in range(f0, f1 + 1)], chunksize=2) if b]
        print('COMP', shot, f0, f1, 'failed:', bad[:5])
