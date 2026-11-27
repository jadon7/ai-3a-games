"""Shared helpers for building the mall scene in Blender (bpy)."""
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix, Euler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PH = os.path.join(ROOT, "assets", "polyhaven")
TRIPO = os.path.join(ROOT, "assets", "tripo")


def coll(name, parent=None):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def link(obj, c):
    for uc in list(obj.users_collection):
        uc.objects.unlink(obj)
    c.objects.link(obj)
    return obj


# ---------------------------------------------------------------- geometry
def box(name, x0, x1, y0, y1, z0, z1, mat=None, c=None, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z)) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    idx = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    for f in idx:
        bm.faces.new([vs[i] for i in f])
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    (c or bpy.context.scene.collection).objects.link(ob)
    if mat:
        me.materials.append(mat)
    if bevel > 0:
        m = ob.modifiers.new("bevel", "BEVEL")
        m.width = bevel
        m.segments = 2
        m.limit_method = "ANGLE"
    return ob


def cyl(name, x, y, z0, z1, r, mat=None, c=None, seg=32, axis="Z"):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=(z1 - z0))
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    (c or bpy.context.scene.collection).objects.link(ob)
    if axis == "Z":
        ob.location = (x, y, (z0 + z1) / 2)
    elif axis == "Y":  # x,y => x,z ; z0..z1 along Y
        ob.rotation_euler = (math.pi / 2, 0, 0)
        ob.location = (x, (z0 + z1) / 2, y)
    elif axis == "X":
        ob.rotation_euler = (0, math.pi / 2, 0)
        ob.location = ((z0 + z1) / 2, x, y)
    if mat:
        me.materials.append(mat)
    try:
        me.shade_smooth()
    except Exception:
        pass
    return ob


def plane(name, x0, x1, y0, y1, z, mat=None, c=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new(name, me)
    (c or bpy.context.scene.collection).objects.link(ob)
    if mat:
        me.materials.append(mat)
    return ob


def vplane(name, p0, p1, z0, z1, mat=None, c=None):
    """Vertical quad from p0(x,y) to p1(x,y) between z0,z1."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([(p0[0], p0[1], z0), (p1[0], p1[1], z0), (p1[0], p1[1], z1), (p0[0], p0[1], z1)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new(name, me)
    (c or bpy.context.scene.collection).objects.link(ob)
    if mat:
        me.materials.append(mat)
    return ob


def join(objs, name):
    objs = [o for o in objs if o]
    if not objs:
        return None
    ctx = {"active_object": objs[0], "selected_editable_objects": objs, "selected_objects": objs}
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


# ---------------------------------------------------------------- materials
def _nodes(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    return nt, bsdf, out


def principled(name, color, rough=0.5, metal=0.0, coat=0.0, coat_rough=0.05, spec=0.5, noise_rough=0.0, noise_scale=4.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    nt, b, out = _nodes(m)
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = coat_rough
    if noise_rough:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = noise_scale
        nz.inputs["Detail"].default_value = 8
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs[3].default_value = max(0.0, rough - noise_rough)
        mr.inputs[4].default_value = min(1.0, rough + noise_rough)
        nt.links.new(nz.outputs[0], mr.inputs[0])
        nt.links.new(mr.outputs[0], b.inputs["Roughness"])
    return m


def _img(nt, path, noncolor=False, proj="BOX"):
    im = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = im
    n.projection = proj
    n.projection_blend = 0.25
    return n


def pbr_tex(name, tex, size_m=1.0, tint=None, rough_mul=1.0, rough_add=0.0, coat=0.0, coat_rough=0.04,
            normal_strength=1.0, dirt=0.0, proj="BOX", hue_sat=None):
    """Tileable Poly Haven texture mapped in object space (objects keep identity transforms)."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    d = os.path.join(PH, "tex", tex)
    m = bpy.data.materials.new(name)
    nt, b, out = _nodes(m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / size_m,) * 3
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    col = _img(nt, os.path.join(d, "Diffuse.jpg"), proj=proj)
    nt.links.new(mp.outputs[0], col.inputs[0])
    c_out = col.outputs[0]
    if hue_sat:
        hs = nt.nodes.new("ShaderNodeHueSaturation")
        hs.inputs["Hue"].default_value, hs.inputs["Saturation"].default_value, hs.inputs["Value"].default_value = hue_sat
        nt.links.new(c_out, hs.inputs["Color"])
        c_out = hs.outputs[0]
    if tint:
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(c_out, mix.inputs[6])
        mix.inputs[7].default_value = (*tint, 1)
        c_out = mix.outputs[2]
    rough = _img(nt, os.path.join(d, "Rough.jpg"), True, proj)
    nt.links.new(mp.outputs[0], rough.inputs[0])
    mr = nt.nodes.new("ShaderNodeMath")
    mr.operation = "MULTIPLY_ADD"
    mr.inputs[1].default_value = rough_mul
    mr.inputs[2].default_value = rough_add
    mr.use_clamp = True
    nt.links.new(rough.outputs[0], mr.inputs[0])
    r_out = mr.outputs[0]
    if dirt > 0:
        # large-scale grime: darkens colour slightly and roughens
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 0.35
        nz.inputs["Detail"].default_value = 10
        nz.inputs["Roughness"].default_value = 0.65
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        cr = nt.nodes.new("ShaderNodeValToRGB")
        cr.color_ramp.elements[0].position = 0.45
        cr.color_ramp.elements[1].position = 0.75
        nt.links.new(nz.outputs[0], cr.inputs[0])
        add = nt.nodes.new("ShaderNodeMath")
        add.operation = "MULTIPLY_ADD"
        add.inputs[1].default_value = dirt
        nt.links.new(cr.outputs[0], add.inputs[0])
        nt.links.new(r_out, add.inputs[2])
        add.use_clamp = True
        r_out = add.outputs[0]
        dk = nt.nodes.new("ShaderNodeMix")
        dk.data_type = "RGBA"
        dk.blend_type = "MULTIPLY"
        nt.links.new(cr.outputs[0], dk.inputs[0])
        nt.links.new(c_out, dk.inputs[6])
        dk.inputs[7].default_value = (0.78, 0.74, 0.68, 1)
        c_out = dk.outputs[2]
        dk.inputs[0].default_value = 0
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = dirt
        nt.links.new(cr.outputs[0], mul.inputs[0])
        nt.links.new(mul.outputs[0], dk.inputs[0])
    nt.links.new(c_out, b.inputs["Base Color"])
    nt.links.new(r_out, b.inputs["Roughness"])
    nrm = _img(nt, os.path.join(d, "nor_gl.jpg"), True, proj)
    nt.links.new(mp.outputs[0], nrm.inputs[0])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = normal_strength
    nt.links.new(nrm.outputs[0], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], b.inputs["Normal"])
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = coat_rough
    return m


def thin_glass(name, tint=(0.92, 0.97, 0.96), rough=0.0, dirt=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    tr.inputs[0].default_value = (*tint, 1)
    gl = nt.nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = rough
    fr = nt.nodes.new("ShaderNodeFresnel")
    fr.inputs[0].default_value = 1.52
    mix = nt.nodes.new("ShaderNodeMixShader")
    fac = fr.outputs[0]
    if dirt:
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 3
        nz.inputs["Detail"].default_value = 6
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs[3].default_value = 0.0
        mr.inputs[4].default_value = dirt
        nt.links.new(nz.outputs[0], mr.inputs[0])
        ad = nt.nodes.new("ShaderNodeMath")
        ad.operation = "ADD"
        ad.use_clamp = True
        nt.links.new(fr.outputs[0], ad.inputs[0])
        nt.links.new(mr.outputs[0], ad.inputs[1])
        fac = ad.outputs[0]
    nt.links.new(fac, mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(gl.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs[0])
    return m


def emissive(name, color, strength):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs[0].default_value = (*color, 1)
    e.inputs[1].default_value = strength
    nt.links.new(e.outputs[0], out.inputs[0])
    return m


# ---------------------------------------------------------------- assets
_asset_cache = {}


def asset_collection(aid, scale=1.0):
    """Import a Poly Haven glTF once into a hidden library collection; return it for instancing."""
    if aid in _asset_cache:
        return _asset_cache[aid]
    lib = coll("_LIB")
    c = bpy.data.collections.new("A_" + aid)
    lib.children.link(c)
    path = os.path.join(PH, "models", aid, aid + ".gltf")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        link(o, c)
    if scale != 1.0:
        for o in new:
            if o.parent is None:
                o.scale = [s * scale for s in o.scale]
    _asset_cache[aid] = c
    return c


def instance(aid, loc, rot_z=0.0, scale=1.0, c=None, rot=None, name=None):
    src = asset_collection(aid)
    e = bpy.data.objects.new(name or ("I_" + aid), None)
    e.instance_type = "COLLECTION"
    e.instance_collection = src
    e.location = loc
    e.rotation_euler = rot if rot else (0, 0, rot_z)
    e.scale = (scale,) * 3
    (c or bpy.context.scene.collection).objects.link(e)
    return e


def area_light(name, loc, size, power, color=(1, 0.93, 0.85), shape="DISK", rot=(0, 0, 0), c=None, size_y=None):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = shape
    ld.size = size
    if size_y is not None:
        ld.size_y = size_y
    ld.energy = power
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = rot
    (c or bpy.context.scene.collection).objects.link(ob)
    return ob


def text_obj(name, body, loc, rot, size, mat, c=None, extrude=0.02, font=None, align="CENTER"):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = "CENTER"
    if font:
        try:
            cu.font = bpy.data.fonts.load(font, check_existing=True)
        except Exception as ex:
            print("font fail", ex)
    ob = bpy.data.objects.new(name, cu)
    ob.location = loc
    ob.rotation_euler = rot
    (c or bpy.context.scene.collection).objects.link(ob)
    cu.materials.append(mat)
    return ob
