# ck_build.py -- build the first-person cockpit and export it as .glb
#   blender -b --factory-startup -P ck_build.py -- <out.glb> [variant=1|2] [only=cluster,seat,...]
# variant 1 = the enclosed cabin (v1), variant 2 = the open all-round-monitor seat unit (v2, the default)
import bpy, sys, os, json, importlib
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import ck_kit
import ck_parts
from ck_kit import Kit


def reset_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for d in list(coll):
            coll.remove(d)


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
        export_animations=False, export_skins=False, export_morph=False, export_cameras=False,
        export_lights=False, export_extras=False, export_materials='EXPORT', export_normals=True,
        export_texcoords=True, export_tangents=False, export_vertex_color='ACTIVE',
        export_all_vertex_colors=False)


def strip_colors(path, keep=('paint',)):
    """The exporter writes COLOR_0 for every primitive of a mesh that has a colour layer; keep it only where the
    material really uses it and drop the unreferenced data from the binary chunk."""
    import struct
    data = open(path, 'rb').read()
    clen = struct.unpack_from('<I', data, 12)[0]
    js = json.loads(data[20:20 + clen].decode('utf-8'))
    off = 20 + clen
    blen = struct.unpack_from('<I', data, off)[0]
    binc = data[off + 8: off + 8 + blen]
    used = set()
    for m in js['meshes']:
        for p in m['primitives']:
            name = js['materials'][p['material']]['name'] if 'material' in p else ''
            if name not in keep:
                p['attributes'].pop('COLOR_0', None)
            used.update(p['attributes'].values())
            if 'indices' in p:
                used.add(p['indices'])
    order = sorted(used)
    amap = {o: i for i, o in enumerate(order)}
    accs = [js['accessors'][o] for o in order]
    bvs = sorted({a['bufferView'] for a in accs})
    bmap = {o: i for i, o in enumerate(bvs)}
    newbin = bytearray()
    nbv = []
    for o in bvs:
        bv = dict(js['bufferViews'][o])
        chunk = binc[bv.get('byteOffset', 0): bv.get('byteOffset', 0) + bv['byteLength']]
        while len(newbin) % 4:
            newbin.append(0)
        bv['byteOffset'] = len(newbin)
        newbin.extend(chunk)
        nbv.append(bv)
    while len(newbin) % 4:
        newbin.append(0)
    for a in accs:
        a['bufferView'] = bmap[a['bufferView']]
    for m in js['meshes']:
        for p in m['primitives']:
            p['attributes'] = {k: amap[v] for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = amap[p['indices']]
    js['accessors'] = accs
    js['bufferViews'] = nbv
    js['buffers'][0]['byteLength'] = len(newbin)
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    while len(jb) % 4:
        jb += b' '
    total = 12 + 8 + len(jb) + 8 + len(newbin)
    out = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(jb), 0x4E4F534A) + jb +         struct.pack('<II', len(newbin), 0x004E4942) + bytes(newbin)
    open(path, 'wb').write(out)
    print('BUILD stripped unused vertex colours: %d -> %d bytes' % (len(data), len(out)))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = argv[0]
    only = None
    variant = 2
    for a in argv[1:]:
        if a.startswith('only='):
            only = a[5:].split(',')
        if a.startswith('variant='):
            variant = int(a[8:])
    reset_scene()
    mats = ck_parts.make_materials()
    kit = Kit()
    kit.info = {}
    info = kit.info
    if variant == 1:
        mods = [('cluster', 'ck_cluster', 'build_cluster'), ('tub', 'ck_tub', 'build_tub'), ('seat', 'ck_seat', 'build_seat'),
                ('controls', 'ck_controls', 'build_controls'), ('scope', 'ck_scope', 'build_scope')]
    else:
        mods = [('cluster', 'ck2_cluster', 'build_cluster'), ('seat', 'ck2_seat', 'build_seat'),
                ('controls', 'ck2_controls', 'build_controls'), ('scope', 'ck2_scope', 'build_scope'),
                ('struct', 'ck2_struct', 'build_struct'), ('dress', 'ck2_dress', 'build_dress')]
    print('BUILD variant', variant)
    for key, mod, fn in mods:
        if only and key not in only:
            continue
        if not os.path.exists(os.path.join(HERE, mod + '.py')):
            print('BUILD skip (no module):', mod)
            continue
        m = importlib.import_module(mod)
        t0 = kit.tris
        r = getattr(m, fn)(kit)
        if r:
            info.update(r)
        print('BUILD part %-9s tris %6d' % (key, kit.tris - t0))
    objs, stats = kit.build(mats)
    # baked occlusion into the vertex colours of every mesh (ck_ao.py); it cuts long edges, so count again
    import ck_ao
    ck_ao.bake(list(objs.values()))
    stats = {k: sum(len(p.vertices) - 2 for p in o.data.polygons) for k, o in objs.items() if o.type == 'MESH'}
    # drop unused materials so they are not exported
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    export_glb(out)          # every primitive keeps COLOR_0 now: it carries the occlusion
    nm = sum(1 for o in objs.values() if o.type == 'MESH')
    print('BUILD done: %s  nodes %d  mesh nodes %d  tris %d  materials %d' % (
        out, len(objs), nm, sum(stats.values()), len(bpy.data.materials)))
    for k in sorted(stats, key=lambda k: -stats[k])[:12]:
        print('BUILD   %-18s %6d' % (k, stats[k]))


main()
