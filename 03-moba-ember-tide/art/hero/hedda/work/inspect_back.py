import bpy, bmesh, sys
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index("--")+1])
sc=bpy.context.scene
body=next(o for o in sc.objects if o.type=="MESH" and len(o.vertex_groups)>0)
M=body.matrix_world; me=body.data
co=[M@v.co for v in me.vertices]
bm=bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
# 按位置焊一下（UV 接缝处的重复顶点），再分连通块
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5); bm.verts.ensure_lookup_table()
seen=set(); comps=[]
for v in bm.verts:
    if v.index in seen: continue
    st=[v]; seen.add(v.index); cur=[]
    while st:
        x=st.pop(); cur.append(x)
        for e in x.link_edges:
            y=e.other_vert(x)
            if y.index not in seen: seen.add(y.index); st.append(y)
    comps.append(cur)
comps.sort(key=len, reverse=True)
print("WELDED COMPONENTS", len(comps))
for c in comps[:30]:
    pts=[M@v.co for v in c]; a=Vector([min(p[i] for p in pts) for i in range(3)]); b=Vector([max(p[i] for p in pts) for i in range(3)])
    print("  comp", len(c), [round(x,3) for x in a], [round(x,3) for x in b])
# 后背的轮廓：每个高度上，|y|<0.05 的顶点里最靠后（x 最小）的
for z in [0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9]:
    xs=[p.x for p in co if abs(p.z-z)<0.012 and abs(p.y)<0.05]
    print("Z", z, "min x", round(min(xs),3) if xs else None)
P=[p for p in co if p.x < -0.09]
print("PACK n", len(P), "z", round(min(p.z for p in P),3), round(max(p.z for p in P),3), "y", round(min(p.y for p in P),3), round(max(p.y for p in P),3))
for z in [0.50,0.51,0.52,0.53,0.54,0.55,0.56,0.82,0.83,0.84,0.85,0.86]:
    xs=[p.x for p in co if abs(p.z-z)<0.005 and abs(p.y)<0.1]
    print("ZZ", z, "min x", round(min(xs),3) if xs else None)
for y in [-0.14,-0.12,-0.1,-0.08,0.08,0.1,0.12,0.14]:
    xs=[p.x for p in co if abs(p.y-y)<0.006 and 0.6<p.z<0.8]
    print("YY", y, "min x", round(min(xs),3) if xs else None)
# 胸口前面最靠前的（x 最大）
for z in [0.6,0.7,0.8]:
    xs=[p.x for p in co if abs(p.z-z)<0.01 and abs(p.y)<0.08]
    print("FRONT", z, round(max(xs),3))
