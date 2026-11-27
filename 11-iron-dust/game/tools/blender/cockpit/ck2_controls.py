# ck2_controls.py -- v2 moving controls: the two sticks (as in v1), pedals hung on the foot-rest bar,
# the throttle lever on the left arm rest.  Pivot empties keep world-aligned axes at rest.
from ck_parts import *
from ck_controls import build_stick
import ck2_seat as SE


def build_pedal(kit, s):
    name = 'pedal_L' if s < 0 else 'pedal_R'
    P = T(s * 0.14, SE.PEDAL_Y, SE.PEDAL_Z)
    kit.empty(name, None, P)
    kit.mesh(name + '_m', name)
    t = radians(20.0)
    S = P @ frame((0, 0, 0), (1, 0, 0), (0, sin(t), cos(t)), (0, -cos(t), sin(t)))   # x right, y along the pedal, z = tread normal
    g = kit.pen(name + '_m', S)
    g.cyl('chrome', 0.0105, 0.098, (0, 0, 0), axis='X', n=12, ch=0.002)
    for sx in (-1, 1):
        g.box('frame_brushed', (0.008, 0.115, 0.016), (sx * 0.036, 0.055, 0.001), bv=0.002)
    g.drilled('bronze', 4, 6, 0.022, 0.0068, 0.005, margin=0.007, pos=(0, 0.152, 0.010))
    g.box('bronze', (0.102, 0.008, 0.018), (0, 0.229, 0.014), bv=0.002)
    g.box('frame_brushed', (0.086, 0.012, 0.010), (0, 0.080, 0.004), bv=0.002)
    g.box('frame_brushed', (0.012, 0.150, 0.012), (0, 0.150, 0.0015), bv=0.002)
    for i in range(3):
        g.box('rubber_black', (0.094, 0.006, 0.003), (0, 0.108 + i * 0.044, 0.0135))
    return P


def build_throttle(kit):
    P = Matrix.Translation(SE.THR_HINGE)
    kit.empty('throttle', 'seat', P)
    kit.mesh('throttle_m', 'throttle')
    g = kit.pen('throttle_m', P)                     # world axes: x right, y forward, z up
    g.cyl('frame_brushed', 0.0095, 0.019, (0, 0, 0), axis='X', n=10)
    g.box('chrome', (0.006, 0.014, 0.104), (0, 0, 0.054), bv=0.0015)
    g.box('rubber_black', (0.0062, 0.0142, 0.028), (0, 0, 0.042))
    hd = g.at((0, 0, 0.113))
    hd.rloft('rubber_black', [(-0.060, 0.0100, 0.0100), (-0.056, 0.0128, 0.0128), (-0.034, 0.0118, 0.0118), (-0.012, 0.0128, 0.0128),
                              (-0.004, 0.0100, 0.0100)], n=12, axis='X', sharp=60.0)
    hd.cyl('chrome', 0.0108, 0.006, (-0.001, 0, 0), axis='X', n=12)
    hd.cyl('chrome', 0.0108, 0.004, (-0.062, 0, 0), axis='X', n=12)
    hd.lathe('glass_red', [(0.0062, 0.064), (0.0062, 0.068), (0.0, 0.069)], 10, axis='X', rot=(0, 0, pi))
    g.box('chrome', (0.016, 0.006, 0.012), (-0.010, 0.0100, 0.092), bv=0.0015)


def build_controls(kit):
    for s in (-1, 1):
        build_stick(kit, s)
        build_pedal(kit, s)
    build_throttle(kit)
    return {}
