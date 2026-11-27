"""城市里摆上车，渲几张追尾视角的静帧（EXR）。
blender -b -P preview_city.py -- <out_dir> <samples> <pct> s1 s2 ..."""
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shotlib import *

argv = sys.argv[sys.argv.index("--") + 1:]
outdir, samples, pct = argv[0], int(argv[1]), int(argv[2])
ss = [float(a) for a in argv[3:]]
sc = open_city()
hero = load_car("hero"); add_headlights(hero, power=2600)
r1 = load_car("rival_purple"); add_headlights(r1, power=2000)
r2 = load_car("rival_yellow"); add_headlights(r2, power=2000)
r3 = load_car("rival_green"); add_headlights(r3, power=2000)
for s in ss:
    lane = 1.8
    place_car(hero, s, -lane)
    place_car(r1, s + 16, lane + 0.2)
    place_car(r2, s + 34, -lane - 3.4)
    place_car(r3, s + 55, lane)
    chase_cam(sc, s, -lane)
    setup_exr(sc, os.path.join(outdir, f"s{int(s):04d}.exr"), samples=samples, pct=pct)
    bpy.ops.render.render(write_still=True)
