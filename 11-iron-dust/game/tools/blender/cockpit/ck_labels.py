# ck_labels.py -- draws the cockpit's printed matter into one atlas: instrument dial faces, panel title
# strips, switch legends, warning placards, read-outs, notes.  Original artwork, drawn here with PIL.
#   python ck_labels.py        -> textures/cockpit_labels.png  +  tools/blender/cockpit/labels.json
# labels.json: name -> [x0, y0, x1, y1] in pixels (y down), "_size": atlas edge.  ck2_dress.py maps
# quads to these; the game loads the PNG at start-up (scripts/cockpit.gd).
import json, math, os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'textures', 'cockpit_labels.png'))
W = 2048
F = 'C:/Windows/Fonts/'
CREAM = (226, 219, 196)
INK = (26, 27, 30)
ORANGE = (224, 104, 28)
BLUE = (44, 78, 118)
AMBER = (255, 170, 60)
GREEN = (120, 255, 150)
random.seed(7)


def font(size, cn=False, bold=False):
    if cn:
        return ImageFont.truetype(F + ('msyhbd.ttc' if bold else 'msyh.ttc'), size)
    return ImageFont.truetype(F + 'bahnschrift.ttf', size)


def mono(size):
    return ImageFont.truetype(F + 'consolab.ttf', size)


def text_c(d, xy, s, f, fill):
    b = d.textbbox((0, 0), s, font=f)
    d.text((xy[0] - (b[0] + b[2]) / 2, xy[1] - (b[1] + b[3]) / 2), s, font=f, fill=fill)


def wear(img, n=140, dark=(0, 0, 0)):
    """scuffs and specks: printed matter that has been in a cabin for years"""
    d = ImageDraw.Draw(img, 'RGBA')
    w, h = img.size
    for _ in range(n):
        x, y = random.random() * w, random.random() * h
        r = random.random() * 1.6 + 0.3
        d.ellipse((x - r, y - r, x + r, y + r), fill=dark + (random.randint(20, 70),))
    for _ in range(n // 12):
        x, y = random.random() * w, random.random() * h
        a = random.random() * 6.28
        l = random.random() * w * 0.12
        d.line((x, y, x + math.cos(a) * l, y + math.sin(a) * l), fill=(255, 255, 255, random.randint(18, 50)), width=1)
    return img


def dial(kind, title, unit, lo, hi, red=None, sectors=False):
    S = 512
    im = Image.new('RGB', (S, S), (14, 15, 17))
    d = ImageDraw.Draw(im)
    face = {'cream': CREAM, 'black': (20, 22, 24), 'orange': ORANGE}[kind]
    ink = INK if kind != 'black' else (232, 230, 220)
    c = S / 2
    d.ellipse((6, 6, S - 6, S - 6), fill=face)
    if sectors:
        # attitude style: a blue and an orange sector on the pale face
        d.pieslice((70, 70, S - 70, S - 70), 200, 340, fill=BLUE)
        d.pieslice((70, 70, S - 70, S - 70), 340, 30, fill=ORANGE)
        d.ellipse((150, 150, S - 150, S - 150), fill=face)
        d.line((c, 80, c, S - 80), fill=ink, width=3)
        d.line((80, c, S - 80, c), fill=ink, width=3)
    a0, a1 = 225.0, -45.0                      # scale sweeps 270 degrees, clockwise from lower left
    if red is not None:
        r0 = a0 + (a1 - a0) * red
        d.arc((44, 44, S - 44, S - 44), -r0, -a1, fill=ORANGE if kind != 'orange' else INK, width=22)
    n = 10
    for i in range(n * 5 + 1):
        a = math.radians(a0 + (a1 - a0) * i / (n * 5))
        major = i % 5 == 0
        r_out, r_in = c - 22, c - (58 if major else 40)
        d.line((c + math.cos(a) * r_in, c - math.sin(a) * r_in, c + math.cos(a) * r_out, c - math.sin(a) * r_out), fill=ink, width=6 if major else 3)
        if major:
            v = lo + (hi - lo) * i / (n * 5)
            s = ('%g' % v)
            text_c(d, (c + math.cos(a) * (c - 92), c - math.sin(a) * (c - 92)), s, font(34), ink)
    text_c(d, (c, c + 70), title, font(44, cn=True, bold=True), ink)
    text_c(d, (c, c + 122), unit, font(28), ink)
    d.ellipse((2, 2, S - 2, S - 2), outline=(8, 8, 9), width=8)
    wear(im, 160, (60, 40, 20) if kind != 'black' else (0, 0, 0))
    return im.resize((256, 256), Image.LANCZOS)


def plate(w, h, fill, lines, ink=INK, bolts=True, border=None, sizes=None, cn=True):
    S = 2
    im = Image.new('RGB', (w * S, h * S), (16, 17, 19))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((4, 4, w * S - 4, h * S - 4), radius=int(min(w, h) * S * 0.12), fill=fill, outline=border, width=6 if border else 0)
    n = len(lines)
    for i, s in enumerate(lines):
        sz = (sizes[i] if sizes else int(h * S * 0.62 / max(n, 1.4)))
        y = h * S * (i + 0.5) / n if n > 1 else h * S / 2
        if n > 1:
            y = h * S * (0.16 + 0.68 * (i + 0.5) / n)
        text_c(d, (w * S / 2, y), s, font(sz, cn=cn, bold=(i == 0)), ink)
    if bolts:
        for bx in (16 * S, w * S - 16 * S):
            for by in (14 * S, h * S - 14 * S):
                d.ellipse((bx - 7, by - 7, bx + 7, by + 7), fill=(70, 72, 76), outline=(30, 30, 32), width=2)
    wear(im, int(w * h / 500), (50, 30, 10))
    return im.resize((w, h), Image.LANCZOS)


def legend(w, h, labels, lit=None):
    """a row of small legends, one over each switch"""
    S = 2
    im = Image.new('RGB', (w * S, h * S), CREAM)
    d = ImageDraw.Draw(im)
    n = len(labels)
    for i, s in enumerate(labels):
        x = w * S * (i + 0.5) / n
        if lit:
            d.rounded_rectangle((x - w * S / n * 0.42, 8, x + w * S / n * 0.42, h * S - 8), radius=10, fill=(18, 19, 21))
            text_c(d, (x, h * S / 2), s, font(int(h * S * 0.42)), lit[i % len(lit)])
        else:
            text_c(d, (x, h * S / 2), s, font(int(h * S * 0.5), cn=True, bold=True), INK)
            d.line((x - w * S / n * 0.5, 6, x - w * S / n * 0.5, h * S - 6), fill=(150, 145, 128), width=2)
    wear(im, int(w * h / 500), (50, 30, 10))
    return im.resize((w, h), Image.LANCZOS)


def readout(w, h, s, col=AMBER, small=''):
    S = 2
    im = Image.new('RGB', (w * S, h * S), (6, 7, 8))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((6, 6, w * S - 6, h * S - 6), radius=14, fill=(10, 12, 11), outline=(40, 42, 44), width=4)
    if small:
        d.text((22, 12), small, font=font(int(h * S * 0.2)), fill=col)
    text_c(d, (w * S / 2, h * S * (0.58 if small else 0.5)), s, mono(int(h * S * 0.46)), col)
    glow = im.filter(ImageFilter.GaussianBlur(5))
    im = Image.blend(im, glow, 0.35)
    return im.resize((w, h), Image.LANCZOS)


def note(w, h, s):
    S = 2
    im = Image.new('RGB', (w * S, h * S), (228, 220, 186))
    d = ImageDraw.Draw(im)
    text_c(d, (w * S * 0.36, h * S * 0.2), s, font(int(h * S * 0.17), cn=True), (40, 44, 70))
    pts = [(w * S * (0.12 + 0.76 * t), h * S * (0.82 - 0.5 * math.sin(t * 2.4) - 0.1 * t)) for t in [i / 24 for i in range(25)]]
    d.line(pts, fill=(40, 44, 70), width=3)
    d.line((w * S * 0.1, h * S * 0.86, w * S * 0.92, h * S * 0.86), fill=(40, 44, 70), width=2)
    d.line((w * S * 0.14, h * S * 0.3, w * S * 0.14, h * S * 0.9), fill=(40, 44, 70), width=2)
    for t in (0.3, 0.55, 0.8):
        x, y = pts[int(t * 24)]
        d.line((x - 8, y - 8, x + 8, y + 8), fill=(150, 40, 30), width=3)
        d.line((x - 8, y + 8, x + 8, y - 8), fill=(150, 40, 30), width=3)
    wear(im, 60, (90, 70, 30))
    return im.resize((w, h), Image.LANCZOS)


def hazard(w, h):
    im = Image.new('RGB', (w, h), (232, 190, 40))
    d = ImageDraw.Draw(im)
    for x in range(-h, w + h, 48):
        d.polygon([(x, 0), (x + 24, 0), (x + 24 - h, h), (x - h, h)], fill=(20, 20, 22))
    return wear(im, 120)


def main():
    atlas = Image.new('RGB', (W, W), (16, 17, 19))
    rects = {'_size': W}

    def put(name, im, x, y):
        atlas.paste(im, (x, y))
        rects[name] = [x, y, x + im.width, y + im.height]

    dials = [
        ('d_alt', dial('cream', '高度', 'ALT x100 m', 0, 10)),
        ('d_spd', dial('black', '速度', 'SPEED m/s', 0, 100, red=0.8)),
        ('d_thr', dial('black', '推进', 'THRUST %', 0, 100, red=0.85)),
        ('d_att', dial('cream', '姿态', 'ATTITUDE', -5, 5, sectors=True)),
        ('d_prs', dial('orange', '舱压', 'CABIN kPa', 0, 120)),
        ('d_oxy', dial('cream', '氧气', 'O2 %', 0, 100)),
        ('d_fuel', dial('black', '燃料', 'FUEL %', 0, 100, red=0.0)),
        ('d_volt', dial('cream', '电压', 'BUS V', 0, 50)),
        ('d_temp', dial('black', '温度', 'CORE x100 C', 0, 12, red=0.75)),
        ('d_hdg', dial('cream', '航向', 'HEADING', 0, 360, sectors=True)),
        ('d_oil', dial('black', '油压', 'HYD MPa', 0, 40, red=0.8)),
        ('d_rpm', dial('orange', '转速', 'x1000 r/min', 0, 8)),
    ]
    for i, (nm, im) in enumerate(dials):
        put(nm, im, (i % 4) * 256, (i // 4) * 256)
    # warning placards and panel titles
    put('p_warn', plate(448, 256, ORANGE, ['警 告', '高辐射区', '避免长时间暴露', '检查防护系统'], sizes=[84, 46, 46, 46]), 1040, 0)
    put('p_caut', plate(448, 256, ORANGE, ['注 意', '舱压异常', '检查系统'], sizes=[84, 54, 54]), 1040, 264)
    put('p_eject', plate(448, 160, (200, 40, 30), ['紧急弹射', 'EJECT  ·  拉环后保持坐姿'], ink=(240, 236, 226), sizes=[72, 34]), 1040, 528)
    y = 700
    for nm, a, b in (('t_prop', '推进系统', 'PROPULSION'), ('t_nav', '导航系统', 'NAVIGATION'), ('t_pwr', '配电系统', 'POWER BUS'),
                     ('t_env', '环境控制', 'ENVIRONMENT'), ('t_eng', '发动机监测', 'ENGINE MONITOR'), ('t_sys', '系统状态', 'SYSTEM STATUS'),
                     ('t_com', '通讯', 'COMMUNICATIONS'), ('t_wpn', '武装管制', 'WEAPON CONTROL')):
        put(nm, plate(448, 64, CREAM, ['%s   %s' % (a, b)], bolts=False, sizes=[44]), 1040, y)
        y += 70
    # legends over switch rows
    put('l_pwr', legend(512, 44, ['主电', '辅电', '备份', '泵A', '泵B', '加热']), 0, 780)
    put('l_wpn', legend(512, 44, ['保险', '主炮', '副炮', '导弹', '格斗', '投弃']), 0, 830)
    put('l_env', legend(512, 44, ['循环', '除湿', '增压', '照明', '风扇', '净化']), 0, 880)
    put('l_com', legend(512, 44, ['CH1', 'CH2', 'CH3', 'CH4', 'IFF', 'REC']), 0, 930)
    put('b_mode', legend(512, 72, ['RDY', 'NAV', 'SYS', 'CHK'], lit=[GREEN, AMBER, AMBER, GREEN]), 0, 980)
    put('b_go', legend(512, 72, ['GO', 'HOLD', 'ABORT', 'ARM'], lit=[GREEN, AMBER, (255, 80, 60), (255, 80, 60)]), 0, 1060)
    put('k_move', plate(256, 80, CREAM, ['移动  MOVE'], bolts=False, sizes=[46]), 1500, 0)
    put('k_wpn', plate(256, 80, ORANGE, ['武器  WEAPON'], bolts=False, sizes=[46]), 1500, 88)
    # tags on the touch screens' frames
    put('g_ctrl', plate(256, 64, ORANGE, ['操控  CONTROL'], bolts=False, sizes=[40]), 1500, 176)
    put('g_caut', plate(256, 64, ORANGE, ['注意  CAUTION'], bolts=False, sizes=[40]), 1500, 246)
    put('g_unit', plate(256, 64, ORANGE, ['TF 系列'], bolts=False, sizes=[44]), 1500, 316)
    # read-outs
    put('r_met', readout(448, 150, '0027:34:18', AMBER, 'MISSION ELAPSED TIME'), 520, 780)
    put('r_rng', readout(448, 150, '000.0', GREEN, 'RANGE km'), 520, 940)
    put('r_clk', readout(448, 110, 'T-003:47:21', (255, 110, 50)), 520, 1100)
    # header, notes, hazard strip
    hd = Image.new('RGB', (2048, 128), (22, 25, 30))
    d = ImageDraw.Draw(hd)
    text_c(d, (1024, 46), 'TF 系列   机 体 控 制 系 统', font(64, cn=True, bold=True), CREAM)
    text_c(d, (1024, 102), 'GUIDANCE  ·  NAVIGATION  ·  CONTROL', font(34), (190, 184, 160))
    put('h_main', wear(hd, 200, (0, 0, 0)), 0, 1320)
    put('n_hold', note(256, 200, '保持航向'), 0, 1150)
    put('n_fix', note(256, 200, '轨道修正'), 262, 1150)
    put('z_haz', hazard(1024, 48), 0, 1460)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    atlas.save(OUT, optimize=True)
    with open(os.path.join(HERE, 'labels.json'), 'w', encoding='utf-8') as fh:
        json.dump(rects, fh, indent=1)
    print('LABELS %s  %d items  %.1f MB' % (OUT, len(rects) - 1, os.path.getsize(OUT) / 1e6))


if __name__ == '__main__':
    main()
