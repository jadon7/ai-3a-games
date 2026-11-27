import bpy, bmesh, sys
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index("--")+1])
sc=bpy.context.scene
for o in sc.objects: print("OBJ", o.type, o.name, len(o.vertex_groups) if o.type=="MESH" else "", len(o.data.vertices) if o.type=="MESH" else "")
arm=next(o for o in sc.objects if o.type=="ARMATURE"); body=next(o for o in sc.objects if o.type=="MESH" and len(o.vertex_groups)>0)
print("BONES", len(arm.data.bones), [b.name for b in arm.data.bones][:70])
M=body.matrix_world
co=[M@v.co for v in body.data.vertices]
mn=Vector([min(c[i] for c in co) for i in range(3)]); mx=Vector([max(c[i] for c in co) for i in range(3)])
print("BBOX", [round(x,3) for x in mn], [round(x,3) for x in mx])
for n in ["Hips","Spine","Spine1","Spine2","Neck","Head","HeadTop_End","LeftShoulder","LeftHand","LeftFoot","LeftToeBase"]:
    b=arm.data.bones.get("mixamorig:"+n)
    if b: print("B", n, [round(x,3) for x in arm.matrix_world@b.head_local], [round(x,3) for x in arm.matrix_world@b.tail_local])
bm=bmesh.new(); bm.from_mesh(body.data); bm.verts.ensure_lookup_table()
# connected components
seen=set(); comps=[]
for v in bm.verts:
    if v.index in seen: continue
    st=[v]; seen.add(v.index); cur=[]
    while st:
        x=st.pop(); cur.append(x.index)
        for e in x.link_edges:
            y=e.other_vert(x)
            if y.index not in seen: seen.add(y.index); st.append(y)
    comps.append(cur)
comps.sort(key=len, reverse=True)
print("COMPONENTS", len(comps))
for c in comps[:25]:
    pts=[co[i] for i in c]; a=Vector([min(p[i] for p in pts) for i in range(3)]); b=Vector([max(p[i] for p in pts) for i in range(3)])
    print("  comp", len(c), [round(x,3) for x in a], [round(x,3) for x in b])
print("MATS", [s.material.name for s in body.material_slots], "UV", [u.name for u in body.data.uv_layers])
