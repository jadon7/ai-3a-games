# ck_render.py -- EEVEE previews of the exported cockpit .glb, seen as the game sees it.
#   blender -b --factory-startup -P ck_render.py -- <cockpit.glb> <out_dir> [prefix=cockpit2] [mask] <view> [<view> ...]
# prefix=cockpit (default) uses the v1 view table, any other prefix the v2 table; `mask` also measures the
# furniture coverage (white unlit on black) for the openness targets and prints COVER lines.
# view = a preset name (see VIEWS), or
#        eye:<yaw_right_deg>:<pitch_up_deg>[:<pose>]              camera at the pilot's eye
#        ext:<x,y,z>:<tx,ty,tz>[:<fov_deg>[:<pose>[:<name>]]]     free camera (Blender coordinates)
# pose = rest | max | dep | depmax
import bpy, sys, os, math
from math import radians, sin, cos, pi
from mathutils import Vector, Matrix
import numpy as np

VIEWS = {
    'fwd': ('eye', 0, 0, 'rest'),
    'down35': ('eye', 0, -35, 'rest'),
    'down70': ('eye', 0, -70, 'rest'),
    'left': ('eye', -90, -20, 'rest'),
    'right': ('eye', 90, -20, 'rest'),
    'back': ('eye', 160, 0, 'rest'),
    'up50': ('eye', 0, 50, 'rest'),
    'deployed': ('eye', 0, -12, 'depmax'),
    'deployed_down': ('eye', 0, -45, 'depmax'),
    'beauty1': ('ext', (1.25, 2.05, 0.75), (0.0, 0.15, -0.55), 42, 'rest'),
    'beauty2': ('ext', (-1.55, 1.25, 0.55), (0.0, 0.1, -0.5), 42, 'rest'),
}
RES = (1280, 720)


def base(n):
    return n.split('.')[0]


def import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)
    return {base(o.name): o for o in bpy.data.objects}


def rot_gltf(o, ax=0.0, ay=0.0, az=0.0):
    """Apply Godot-style local rotation (YXZ euler, glTF axes) on top of the rest transform."""
    if o is None:
        return
    R = Matrix.Rotation(ay, 4, 'Z') @ Matrix.Rotation(ax, 4, 'X') @ Matrix.Rotation(-az, 4, 'Y')
    o.matrix_basis = o.matrix_basis @ R


def apply_pose(objs, pose):
    if pose in ('max', 'depmax'):
        rot_gltf(objs.get('stick_L'), ax=-0.35, az=-0.35)
        rot_gltf(objs.get('stick_R'), ax=0.35, az=0.35)
        rot_gltf(objs.get('trigger_R'), ax=-0.3)
        rot_gltf(objs.get('pedal_L'), ax=-0.35)
        rot_gltf(objs.get('pedal_R'), ax=-0.35)
        rot_gltf(objs.get('throttle'), ax=-0.4)
        vals = {'needle_speed': 2.2, 'needle_thrust': -2.2, 'needle_heat': -1.1, 'needle_ap': 2.2, 'needle_alt': 1.1,
                'needle_aux': -2.2}
        for k, a in vals.items():
            if k in objs:
                rot_gltf(objs[k], az=a)
    if pose == 'max3':        # both sticks forward and outboard (toward the touch panels), throttle back
        rot_gltf(objs.get('stick_L'), ax=-0.35, az=0.35)
        rot_gltf(objs.get('stick_R'), ax=-0.35, az=-0.35)
        rot_gltf(objs.get('throttle'), ax=0.4)
        rot_gltf(objs.get('pedal_L'), ax=-0.35)
    if pose in ('max2',):
        rot_gltf(objs.get('stick_L'), ax=0.35, az=0.35)
        rot_gltf(objs.get('stick_R'), ax=-0.35, az=-0.35)
        rot_gltf(objs.get('throttle'), ax=0.4)
    if pose in ('dep', 'depmax', 'half'):
        for k in ('scope_arm', 'scope_fore', 'scope_head'):
            if k not in objs:
                continue
            if pose == 'half':
                a, b = objs[k].matrix_basis, objs[k + '_dep'].matrix_basis
                la, qa, _ = a.decompose()
                lb, qb, _ = b.decompose()
                objs[k].matrix_basis = Matrix.Translation(la.lerp(lb, 0.5)) @ qa.slerp(qb, 0.5).to_matrix().to_4x4()
            else:
                objs[k].matrix_basis = objs[k + '_dep'].matrix_basis.copy()


# ---- placeholder screen pictures (only for the previews; the game draws its own) ----------------
def _img(name, w, h, fn):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = (xx + 0.5) / w, (yy + 0.5) / h        # v = 0 at the bottom row (Blender image origin)
    rgb = fn(u, v).astype(np.float32)
    a = np.ones((h, w, 1), np.float32)
    px = np.concatenate([rgb, a], axis=2)
    im = bpy.data.images.new(name, w, h)
    im.pixels.foreach_set(np.ascontiguousarray(px, dtype=np.float32).ravel())
    im.pack()
    return im


def _lines(v, n, th):
    return (np.abs(((v * n) % 1.0) - 0.5) < th).astype(np.float32)


def pic_radar(u, v):
    x, y = u * 2 - 1, v * 2 - 1
    r = np.sqrt(x * x + y * y)
    g = 0.10 + 0.9 * np.clip(_lines(r, 4, 0.03) + _lines(u, 10, 0.03) * 0.5 + _lines(v, 10, 0.03) * 0.5, 0, 1)
    blip = ((np.abs(x - 0.35) < 0.05) & (np.abs(y - 0.4) < 0.05)) | ((np.abs(x + 0.5) < 0.04) & (np.abs(y + 0.1) < 0.04))
    mark = (x < -0.45) & (x > -0.7) & (y > 0.55) & (y < 0.62)       # asymmetric marker: top-left bar
    g = np.clip(g + blip + mark, 0, 1) * (r < 1.0)
    return np.stack([g * 0.12, g, g * 0.25], axis=2)


def pic_status(u, v):
    x, y = u * 2 - 1, v * 2 - 1
    body = (np.abs(x) < 0.22) & (np.abs(y - 0.1) < 0.3)
    head = (np.abs(x) < 0.1) & (np.abs(y - 0.55) < 0.1)
    arms = (np.abs(np.abs(x) - 0.38) < 0.08) & (np.abs(y - 0.1) < 0.33)
    legs = (np.abs(np.abs(x) - 0.14) < 0.09) & (np.abs(y + 0.55) < 0.3)
    txt = (y > 0.8) & (x < 0.2) & (_lines(u, 14, 0.3) > 0)
    g = np.clip(0.08 + body + head + arms * 0.7 + legs * 0.8 + txt * 0.8 + _lines(v, 30, 0.08) * 0.12, 0, 1)
    return np.stack([g * 0.12, g, g * 0.25], axis=2)


def pic_warn(u, v):
    x, y = u * 2 - 1, v * 2 - 1
    r = np.sqrt(x * x + y * y)
    ring = (np.abs(r - 0.5) < 0.13) & ~((x > 0.1) & (np.abs(y) < 0.22))
    bar = (np.abs(x - 0.15) < 0.2) & (np.abs(y) < 0.08)
    top = (y > 0.78) & (np.abs(x) < 0.25)
    g = np.clip(0.18 + ring + bar + top * 0.8, 0, 1) * (r < 1.0)
    return np.stack([g, g * 0.07, g * 0.03], axis=2)


def pic_scope(u, v):
    x, y = u * 2 - 1, v * 2 - 1
    r = np.sqrt(x * x + y * y)
    g = np.clip(0.12 + (np.abs(r - 0.55) < 0.03) + ((np.abs(x) < 0.02) | (np.abs(y) < 0.02)) * (r > 0.15) + ((x > 0.6) & (y > 0.75)), 0, 1)
    return np.stack([g * 0.15, g, g * 0.3], axis=2)


def emit_mat(name, img=None, col=(1, 1, 1), strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = strength
    em.inputs['Color'].default_value = (col[0], col[1], col[2], 1)
    if img is not None:
        tx = nt.nodes.new('ShaderNodeTexImage')
        tx.image = img
        nt.links.new(tx.outputs['Color'], em.inputs['Color'])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def skin_screens(objs):
    pics = {'scr_radar': _img('radar', 256, 256, pic_radar), 'scr_status': _img('status', 128, 192, pic_status),
            'scr_scope': _img('scope', 128, 128, pic_scope)}
    wimg = _img('warn', 128, 128, pic_warn)
    for i in range(1, 5):
        pics['scr_warn_%d' % i] = wimg
    if 'scr_touch_L' in objs:
        timg = _img('touch', 192, 128, pic_touch)
        pics['scr_touch_L'] = timg
        pics['scr_touch_R'] = timg
    for k, im in pics.items():
        o = objs.get(k)
        if o is None or o.type != 'MESH':
            print('RENDER missing screen', k)
            continue
        o.data.materials.clear()
        o.data.materials.append(emit_mat('pv_' + k, im, strength=1.6))
    cols = [(0.1, 1, 0.25), (1, 0.6, 0.1), (1, 0.08, 0.04), (0.1, 1, 0.25), (1, 0.6, 0.1), (0.05, 0.05, 0.05),
            (1, 0.08, 0.04), (0.1, 1, 0.25), (1, 0.6, 0.1), (0.3, 0.6, 1.0)]
    for i in range(1, 11):
        o = objs.get('lamp_%d' % i)
        if o is None or o.type != 'MESH':
            print('RENDER missing lamp', i)
            continue
        o.data.materials.clear()
        o.data.materials.append(emit_mat('pv_lamp%d' % i, None, cols[i - 1], 3.0))


def setup_scene(gain=1.0):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    try:
        sc.view_settings.view_transform = 'Standard'
    except Exception:
        pass
    try:
        sc.eevee.taa_render_samples = 24
        sc.eevee.use_raytracing = True
        sc.eevee.use_shadows = True
    except Exception as e:
        print('RENDER eevee option', e)
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    # mid-grey world with a soft vertical gradient so that chrome has something to reflect
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    mp = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    nt.links.new(sep.outputs['Z'], mp.inputs['Value'])
    mp.inputs['From Min'].default_value = -1.0
    mp.inputs['From Max'].default_value = 1.0
    nt.links.new(mp.outputs[0], ramp.inputs[0])
    ramp.color_ramp.elements[0].color = (0.10, 0.10, 0.11, 1)
    ramp.color_ramp.elements[1].color = (0.50, 0.52, 0.56, 1)
    el = ramp.color_ramp.elements.new(0.5)
    el.color = (0.30, 0.31, 0.33, 1)
    nt.links.new(ramp.outputs[0], bg.inputs[0])
    bg.inputs[1].default_value = 0.8
    sc.world = w

    def light(name, kind, pos, energy, col, size=0.3, target=None):
        l = bpy.data.lights.new(name, kind)
        l.energy = energy * gain
        l.color = col
        if kind == 'AREA':
            l.size = size
        else:
            l.shadow_soft_size = size
        o = bpy.data.objects.new(name, l)
        o.location = pos
        if target is not None:
            o.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
        sc.collection.objects.link(o)
    # stand-ins for the cabin lights: overhead bar (cool key), instrument glow (warm-green fill), a back light
    light('key', 'AREA', (0.08, 0.22, 0.62), 55.0, (0.82, 0.9, 1.0), 0.45, (0.0, 0.35, -0.6))
    light('fill', 'POINT', (0.0, 0.50, -0.20), 6.0, (0.7, 1.0, 0.78), 0.15)
    light('rear', 'AREA', (-0.25, -0.35, 0.60), 18.0, (1.0, 0.92, 0.82), 0.3, (0.0, -0.3, -0.5))


def add_cam():
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('cam')
    o = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(o)
    sc.camera = o
    return o


def set_eye(o, yaw, pitch):
    c = o.data
    c.sensor_fit = 'VERTICAL'
    c.angle_y = radians(86.0)
    c.clip_start = 0.12
    c.clip_end = 100.0
    y, p = radians(yaw), radians(pitch)
    d = Vector((sin(y) * cos(p), cos(y) * cos(p), sin(p)))
    o.location = (0, 0, 0)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def set_ext(o, pos, tgt, fov):
    c = o.data
    c.sensor_fit = 'VERTICAL'
    c.angle_y = radians(fov)
    c.clip_start = 0.05
    c.clip_end = 100.0
    o.location = pos
    o.rotation_euler = (Vector(tgt) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()


VIEWS2 = {
    'fwd': ('eye', 0, 0, 'rest'),
    'down35': ('eye', 0, -35, 'rest'),
    'down70': ('eye', 0, -70, 'rest'),
    'left': ('eye', -90, -20, 'rest'),
    'right': ('eye', 90, -20, 'rest'),
    'back': ('eye', 180, 0, 'rest'),
    'deployed': ('eye', 0, -12, 'depmax'),
    'beauty': ('ext', (2.05, 1.25, 0.35), (0.0, -0.15, -0.85), 44, 'rest'),
    'beauty_rear': ('ext', (-1.25, -1.45, 0.55), (0.0, 0.0, -0.75), 44, 'rest'),
}
# the openness measurement: furniture mask seen from the eye, 86 deg vertical FOV, 16:9
MASK_VIEWS = [('forward level', 0, 0, 0.10), ('35 deg down', 0, -35, 0.40), ('left 90 level', -90, 0, 0.12),
              ('right 90 level', 90, 0, 0.12), ('straight back level', 180, 0, 0.35)]


def pic_touch(u, v):
    x, y = u * 3 - 1.5, v * 2 - 1
    tiles = ((np.abs(((x + 1.5) * 2.0) % 1.0 - 0.5) < 0.40) & (np.abs(((y + 1) * 1.5) % 1.0 - 0.5) < 0.36) & (y < 0.55)).astype(np.float32)
    bar = ((y > 0.72) & (y < 0.90) & (x < 0.2)).astype(np.float32)        # title bar: top-left
    g = np.clip(0.10 + tiles * 0.45 + bar * 0.9, 0, 1)
    return np.stack([g * 0.25, g * 0.85, g], axis=2)


def measure_masks(objs, cam, outdir, prefix):
    sc = bpy.context.scene
    white = emit_mat('mask_white', None, (1, 1, 1), 1.0)
    white.use_backface_culling = False
    for o in objs.values():
        if o.type == 'MESH':
            for sl in o.material_slots:
                sl.material = white
    for o in list(bpy.data.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o, do_unlink=True)
    w = bpy.data.worlds.new('black')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0, 0, 0, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.0
    sc.world = w
    sc.render.resolution_x, sc.render.resolution_y = 960, 540
    try:
        sc.eevee.use_raytracing = False
        sc.eevee.taa_render_samples = 16
    except Exception:
        pass
    for label, yaw, pitch, target in MASK_VIEWS:
        set_eye(cam, yaw, pitch)
        path = os.path.join(outdir, '%s_mask_%s.png' % (prefix, label.replace(' ', '_')))
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(path)
        px = np.empty(im.size[0] * im.size[1] * 4, np.float32)
        im.pixels.foreach_get(px)
        cov = float(px.reshape(-1, 4)[:, 0].mean())
        bpy.data.images.remove(im)
        print('COVER %-20s %5.1f %%   (target <= %.0f %%)  %s' % (label, cov * 100.0, target * 100.0, 'ok' if cov <= target else 'OVER'))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    glb, outdir, views = argv[0], argv[1], argv[2:]
    prefix = 'cockpit'
    for a in list(views):
        if a.startswith('prefix='):
            prefix = a[7:]
            views.remove(a)
    table = VIEWS2 if prefix != 'cockpit' else VIEWS
    do_mask = 'mask' in views
    if do_mask:
        views.remove('mask')
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    objs = import_glb(glb)
    rest = {k: o.matrix_basis.copy() for k, o in objs.items()}
    setup_scene(1.0 if prefix == 'cockpit' else 0.42)      # the open v2 unit has nothing shading the key light
    # Godot culls back faces: do the same here so that a flipped face shows up as a hole in the previews
    for m in bpy.data.materials:
        m.use_backface_culling = True
    skin_screens(objs)
    cam = add_cam()
    os.makedirs(outdir, exist_ok=True)
    if 'all' in views:
        i = views.index('all')
        views = views[:i] + list(table.keys()) + views[i + 1:]
    for v in views:
        if v in table:
            spec = table[v]
            name = v
        else:
            parts = v.split(':')
            if parts[0] == 'eye':
                spec = ('eye', float(parts[1]), float(parts[2]), parts[3] if len(parts) > 3 else 'rest')
                name = parts[4] if len(parts) > 4 else 'eye_%s_%s_%s' % (parts[1], parts[2], spec[3])
            else:
                pos = tuple(float(x) for x in parts[1].split(','))
                tgt = tuple(float(x) for x in parts[2].split(','))
                fov = float(parts[3]) if len(parts) > 3 else 40.0
                pose = parts[4] if len(parts) > 4 else 'rest'
                spec = ('ext', pos, tgt, fov, pose)
                name = parts[5] if len(parts) > 5 else 'ext_%d' % (abs(hash(v)) % 10000)
        for k, o in objs.items():
            o.matrix_basis = rest[k].copy()
        if spec[0] == 'eye':
            apply_pose(objs, spec[3])
            set_eye(cam, spec[1], spec[2])
        else:
            apply_pose(objs, spec[4])
            set_ext(cam, spec[1], spec[2], spec[3])
        path = os.path.join(outdir, '%s_%s.png' % (prefix, name))
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print('RENDERED', path)
    if do_mask:
        for k, o in objs.items():
            o.matrix_basis = rest[k].copy()
        measure_masks(objs, cam, outdir, prefix)


main()
