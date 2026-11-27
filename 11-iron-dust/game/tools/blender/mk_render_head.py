# mk_render_head.py -- head close-ups of exported frame .glb files (wraps mk_render_f.py: same palettes and lights).
#   blender -b --factory-startup -P mk_render_head.py -- head  <in.glb> <out.png>            one frame: front, 3/4, side / other 3/4, rear 3/4, chase camera
#   blender -b --factory-startup -P mk_render_head.py -- heads <out.png> <a.glb> <b.glb> ... one column per frame: front + 3/4 (+ chase row with 'chase')
#   blender -b --factory-startup -P mk_render_head.py -- dims  <a.glb> ...                   prints the head_m* bounding box per frame
# Every cell is rendered on its own (so each view has its own camera pitch) and the cells are stitched into one sheet.
import bpy, sys, os, math, json, tempfile, shutil
from math import radians as rad
import numpy as np
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
from mk_geo import reset_scene
from mk_render import setup_world, add_cam, ground, base_name
from mk_render_f import load

CELL = (760, 800)          # px
WIDTH = 5.2                # ortho width of one cell (authoring units)
# name, yaw of the frame (0 = camera looks at the face), camera pitch, label
VIEWS = {
    'front': (0.0, 4.0, 'front'),
    'q': (-38.0, 12.0, '3/4'),
    'q2': (38.0, 12.0, '3/4 other side'),
    'side': (-90.0, 4.0, 'side'),
    'rear': (148.0, 12.0, 'rear 3/4'),
    'chase': (172.0, 30.0, 'chase cam'),
}


def head_box(objs):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for n, o in objs.items():
        if o.type == 'MESH' and n.startswith('head_m'):
            for v in o.data.vertices:
                w = o.matrix_world @ v.co
                for i in range(3):
                    mn[i] = min(mn[i], w[i])
                    mx[i] = max(mx[i], w[i])
    return mn, mx


def label(cam, text, width, aspect):
    cu = bpy.data.curves.new('lbl', 'FONT')
    cu.body = text
    cu.size = width * 0.05
    o = bpy.data.objects.new('lbl', cu)
    m = bpy.data.materials.new('lbl')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs[0].default_value = (1, 1, 1, 1)
    em.inputs[1].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs[0])
    cu.materials.append(m)
    bpy.context.scene.collection.objects.link(o)
    o.parent = cam
    o.location = (-width / 2 + width * 0.03, width * aspect / 2 - width * 0.075, -20.0)
    return o


def cells(glb, views, tmp, tag, name=None):
    """Render one cell per view of one frame; returns the list of png paths."""
    reset_scene()
    objs, new = load(glb)
    root = objs['frame']
    root.rotation_mode = 'XYZ'
    setup_world(CELL)
    ground()
    bpy.context.view_layer.update()
    hw = objs['head'].matrix_world.to_translation()
    out = []
    for vn in views:
        yaw, pitch, lab = VIEWS[vn]
        root.rotation_euler = (0, 0, rad(yaw))
        # keep the head joint on the camera axis whatever the yaw
        c, s = math.cos(rad(yaw)), math.sin(rad(yaw))
        root.location = (-(c * hw.x - s * hw.y), -(s * hw.x + c * hw.y), 0)
        cam = add_cam((0, 0, hw.z + 1.05), WIDTH, pitch=pitch)
        lb = label(cam, ('%s  %s' % (name, lab)) if name else lab, WIDTH, CELL[1] / CELL[0])
        p = os.path.join(tmp, '%s_%s.png' % (tag, vn))
        bpy.context.scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        out.append(p)
        bpy.data.objects.remove(lb, do_unlink=True)
        bpy.data.objects.remove(cam, do_unlink=True)
    return out


def stitch(grid, path):
    """grid[row][col] = png path -> one sheet."""
    rows = []
    for r in grid:
        imgs = []
        for p in r:
            im = bpy.data.images.load(p)
            w, h = im.size
            a = np.empty(w * h * 4, dtype=np.float32)
            im.pixels.foreach_get(a)
            imgs.append(a.reshape(h, w, 4))
            bpy.data.images.remove(im)
        rows.append(np.concatenate(imgs, axis=1))
    sheet = np.concatenate(rows[::-1], axis=0)       # image rows run bottom-up
    h, w = sheet.shape[:2]
    im = bpy.data.images.new('sheet', w, h, alpha=False)
    im.pixels.foreach_set(sheet.ravel())
    im.filepath_raw = path
    im.file_format = 'PNG'
    sc = bpy.context.scene
    sc.view_settings.view_transform = 'Standard'
    im.save_render(path, scene=sc)
    print('RENDERED', path)


def stem(p):
    return os.path.splitext(os.path.basename(p))[0]


if __name__ == '__main__':
    a = sys.argv[sys.argv.index('--') + 1:]
    tmp = tempfile.mkdtemp(prefix='mkhead_')
    if a[0] == 'head':
        ps = cells(a[1], ['front', 'q', 'side', 'q2', 'rear', 'chase'], tmp, stem(a[1]), stem(a[1]))
        stitch([ps[:3], ps[3:]], a[2])
    elif a[0] == 'heads':
        glbs = [x for x in a[2:] if x.lower().endswith('.glb')]
        views = ['front', 'q'] + (['chase'] if 'chase' in a else [])
        cols = [cells(g, views, tmp, stem(g), stem(g)) for g in glbs]
        stitch([[c[i] for c in cols] for i in range(len(views))], a[1])
    elif a[0] == 'dims':
        for g in a[1:]:
            reset_scene()
            objs, new = load(g)
            bpy.context.view_layer.update()
            mn, mx = head_box(objs)
            hw = objs['head'].matrix_world.to_translation()
            ew = objs['eye'].matrix_world.to_translation() if 'eye' in objs else hw
            print('HEADDIMS', json.dumps(dict(frame=stem(g), w=round(mx.x - mn.x, 2), h=round(mx.z - mn.z, 2), d=round(mx.y - mn.y, 2),
                                             top=round(mx.z, 2), xmin=round(mn.x, 2), xmax=round(mx.x, 2), ymin=round(mn.y, 2), ymax=round(mx.y, 2),
                                             zmin=round(mn.z, 2), head_joint=[round(c, 3) for c in hw], eye=[round(c, 3) for c in ew])))
    shutil.rmtree(tmp, ignore_errors=True)
