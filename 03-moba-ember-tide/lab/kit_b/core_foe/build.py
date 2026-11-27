"""Build in glTF coordinates (metres, Y up, +Z front). Run with Blender in background."""
import json
import math
import struct
from collections import defaultdict
from itertools import combinations
from pathlib import Path

import bmesh
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parent
TAU = math.tau
groups = defaultdict(list)
origin = np.zeros(3)
group = 'dais'


def polar(a, r, y, side=0):
    return origin + (math.sin(a)*r + math.cos(a)*side, y, math.cos(a)*r - math.sin(a)*side)


def grid(rows, caps=True):
    n = len(rows[0])
    faces = [(j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i)
             for j in range(len(rows)-1) for i in range(n)]
    if caps:
        faces.extend([tuple(reversed(range(n))), tuple(range((len(rows)-1)*n, len(rows)*n))])
    return [p for row in rows for p in row], faces


def mesh(mat, points, faces, bevel=0, smooth=True, shade=1):
    bm = bmesh.new()
    verts = [bm.verts.new(p) for p in points]
    for f in faces:
        bm.faces.new([verts[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bevel:
        edges = [e for e in bm.edges if e.calc_face_angle(0) > .38]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2 if group.startswith("brazier") else 3, profile=.5,
                        affect='EDGES', clamp_overlap=(group=='crystal'))
    bm.normal_update()
    # Save the surface normals before triangulation. Keep planes and hard creases distinct.
    corners = {}
    for face in bm.faces:
        for loop in face.loops:
            adjacent = [l for l in loop.vert.link_loops
                        if face.normal.dot(l.face.normal) > .78] if smooth else [loop]
            normal = sum((l.face.normal*l.calc_angle() for l in adjacent), Vector()).normalized()
            v = loop.vert
            grey = min(1., max(.76, shade - .10*max(-normal.y, 0) - .09*max(1-v.co.y/.30, 0)))
            radial = max(math.hypot(v.co.x,v.co.z),.001)
            facing = (normal.x*v.co.x+normal.z*v.co.z)/radial
            if group=='dais' and mat=='stone' and abs(normal.y)<.5:
                grey -= .14*max(0,1-abs(facing)*2)
            if group=='forge' and mat=='metal':
                grey -= .11*max(-facing,0)
            if group == 'crystal':
                # Keep broad light-facing cuts bright and bring the low, oblique cuts down one value.
                az = math.atan2(normal.x,normal.z)
                grey = np.clip(.89 + .075*math.cos(az*3+.8) + .065*normal.y,.76,1.)
            corners[loop] = (*v.co, *normal, max(.75,grey))
    tris = bm.calc_loop_triangles()
    groups[group, mat].extend(corners[loop] for tri in tris for loop in tri)
    bm.free()


def drum(mat, stages, n=64, phase=0, bevel=0, shade=1):
    rows = [[polar(TAU*i/n+phase, r, y) for i in range(n)] for r,y in stages]
    mesh(mat, *grid(rows), bevel, shade=shade)


def sector(mat, a, b, inner, outer, lo, hi, edge, divisions, gap=0):
    pts = []
    for y in (lo, hi):
        for r in (inner, outer):
            da = math.asin(gap/(2*r))
            pts.extend(polar(t, r, y) for t in np.linspace(a+da, b-da, divisions+1))
    n = divisions+1
    faces = [(0,n,3*n,2*n),(n-1,2*n-1,4*n-1,3*n-1)]
    for i in range(divisions):
        for q in [(0,n,n+1,1),(2*n,3*n,3*n+1,2*n+1),(0,1,2*n+1,2*n),(n,n+1,3*n+1,3*n)]:
            faces.append(tuple(i+idx for idx in q))
    if group == 'ring':
        for pt in pts:
            angle = math.atan2(pt[0],pt[2])
            radius = math.hypot(pt[0],pt[2])
            slant = .09*(pt[1]-11.34)+.10*(radius-2.70)
            pt[0],pt[2] = radius*math.sin(angle+slant),radius*math.cos(angle+slant)
            pt[1] += .064*math.sin(3*angle+.3)
    mesh(mat,pts,faces,edge)


def stair_band(a, path, width):
    rows = []
    for i,(r,y) in enumerate(path):
        prev = np.array(path[max(0,i-1)])
        after = np.array(path[min(i+1,len(path)-1)])
        dx,dy = after-prev
        normal = np.array([-dy,dx])/math.hypot(dx,dy)
        row = []
        for side, h in [(-1,-.027),(-1,.003),(-.82,.022),(.82,.022),(1,.003),(1,-.027)]:
            rr,yy = np.array([r,y])+normal*h
            row.append(polar(a, rr, max(0,yy), side*width/2))
        rows.append(row)
    mesh('accent',*grid(rows))


tiers = [(4.55,0,.176,.044),(4.31,.158,1.00,.105),(3.68,.98,1.84,.108)]
for k,(r,y0,y1,bevel) in enumerate(tiers):
    for i in range(6):
        a = TAU*(i+.22+.46*(k%2))/6
        sector('stone',a,a+TAU/6,.82,r,y0,y1,bevel,12,.036)
    drum('stone',[(.825,y0),(.825,y1)],40)
path = [(2.32,1.84)]
for r,y0,y1,b in reversed(tiers):
    for t in np.linspace(0, math.pi/2, 7):
        path.append((r-b+b*math.sin(t),y1-b+b*math.cos(t)))
    path.append((r,y0+b))
    for t in np.linspace(.20,math.pi/2,5):
        path.append((r-b+b*math.cos(t),y0+b-b*math.sin(t)))
    if r!=tiers[0][0]:
        path.append((r+.02,y0+.020))
for a in (28,43,-28,-43):
    stair_band(math.radians(a),path,.235)

# Solid stone plinth under the forge, in two interlocking courses.
for row,(y0,y1,rad) in enumerate([(1.79,2.91,1.93),(2.89,4.02,1.80)]):
    for i in range(4):
        a = TAU*(i+.5*row)/4
        sector('stone',a,a+TAU/4,.68,rad,y0,y1,.09,10,.036)
    drum('stone',[(.685,y0),(.685,y1)],40)
drum('metal',[(1.70,1.82),(1.99,2.10),(2.06,2.57),(2.025,3.00),(1.91,3.51),
              (1.83,3.90),(1.86,4.25),(1.79,4.33),(1.60,4.30),(1.4,4.04)],48,bevel=.065)
# Sloped inner cup. The crystal descends into the opening.
drum('metal',[(1.67,4.17),(1.83,4.25),(1.79,4.59),(1.69,4.78),
              (1.54,4.83),(1.47,4.69),(1.20,4.32)],48)
drum('accent',[(1.60,4.71),(1.64,4.80),(1.54,4.86),(1.39,4.79),
               (.76,4.35),(.48,4.33)],48)


def blade(angle, height):
    root = 1.20
    belly = 5.00
    neck = 8.00
    cap_height = .175
    spring = height-cap_height
    across = polar(angle,0,0,1)
    outward = polar(angle,1,0)
    belly_width = 1.85

    def ease(t):
        return t*t*(3-2*t)

    def center(y):
        if y <= belly:
            t = (y-root)/(belly-root)
            radius = 2.10+.80*math.sin(t*math.pi/2)
        elif y <= neck:
            radius = 2.90-.35*ease((y-belly)/(neck-belly))
        else:
            radius = 2.55+.20*ease((y-neck)/(height-neck))
        return polar(angle,radius,y)

    def frame(y):
        if y <= belly:
            width = 1.00+(belly_width-1.00)*ease((y-root)/(belly-root))
        else:
            t = min(1,(y-belly)/(spring-belly))
            width = belly_width-(belly_width-.45)*ease(t*t)
        return center(y),across,outward,width/2

    def front(half,x):
        return .18-.076*(x/half)**2

    def facepoint(y,x,relief):
        c,u,n,h = frame(y)
        return c + u*x + n*(front(h,x)+relief)

    def perimeter(y,cap_scale=1,lift=0):
        _,u,n,h = frame(y)
        c = center(y+lift)
        edge=.06
        profile=[(-.48*h,front(h,-.48*h)),(0,.18),(.48*h,front(h,.48*h))]
        # Each corner is a 60 mm quarter-round. The broad outer face stays convex.
        for side,upper,start,end in [(1,True,90,0),(1,False,0,-90),
                                     (-1,False,-90,-180),(-1,True,180,90)]:
            cx=side*(h-edge)
            cy=front(h,cx)-edge if upper else -.18+edge
            for a in np.radians(np.linspace(start,end,3)):
                profile.append((cx+edge*math.cos(a),cy+edge*math.sin(a)))

        return [c+cap_scale*(x*u+d*n) for x,d in profile]

    band_start,band_end = 1.76,root+.74*(height-root)
    joins = {root,belly,neck,spring,band_start,band_end-.34,band_end-.13,band_end}
    levels = sorted(joins | set(np.linspace(root,spring,12)))
    rows = [perimeter(y) for y in levels]
    for a in np.arange(1,5)*math.pi/10:
        rows.append(perimeter(spring,math.cos(a),.175*math.sin(a)))
    points, faces = grid(rows,False)
    n = len(rows[0])
    faces.append(tuple(reversed(range(n))))
    top = len(points)
    points.append(center(height))
    faces.extend((top-n+i,top-n+(i+1)%n,top) for i in range(n))
    mesh('metal',points,faces)
    surface = BVHTree.FromPolygons(points,faces)

    # Both boundaries track the middle of the plate throughout its bend.
    band_levels = [y for y in levels if band_start<=y<=band_end]
    rows=[]
    for y in band_levels:
        half=.25*min(1,.70+.30*(y-band_start)/.14,.14+.86*(band_end-y)/.34)
        profile=[(-half,-.012),(-half,.014),(-half+.012,.030),(0,.030),
                 (half-.012,.030),(half,.014),(half,-.012)]
        rows.append([facepoint(y,x,d) for x,d in profile])
    mesh('accent',*grid(rows))

    for side in (-1,1):
        # Rivet spacing follows surface length around the bend.
        samples=np.linspace(band_start+.27,band_end-.38,140)
        line=np.array([facepoint(y,side*.35,0) for y in samples])
        lengths=np.r_[0,np.cumsum(np.linalg.norm(np.diff(line,axis=0),axis=1))]
        for distance in np.linspace(0,lengths[-1],5):
            y=np.interp(distance,lengths,samples)
            x=side*.35
            _,across,outward,_=frame(y)
            c,hit_normal,_,_=surface.ray_cast(facepoint(y,x,.18),-outward,.45)
            c=np.array(c)
            n=np.array(hit_normal)
            if n@outward < 0:
                n=-n
            across=across-n*(n@across)
            across/=np.linalg.norm(across)
            along=np.cross(n,across)
            rows=[[c+n*d+radius*(across*math.cos(phi)+along*math.sin(phi))
                   for phi in np.arange(8)*TAU/8]
                  for radius,d in [(.045,-.009),(.040,.023)]]
            points,faces=grid(rows,False)
            apex=len(points)
            points.append(c+n*.036)
            faces.append(tuple(reversed(range(8))))
            faces.extend((8+i,8+(i+1)%8,apex) for i in range(8))
            mesh('metal',points,faces)


group = 'forge'
for i in range(8):
    angle=(i+.5)*TAU/8
    facing=math.cos(angle)
    height=8.20 if facing>.6 else (8.78 if facing>0 else 9.60)
    blade(angle,height)


def cut_gem(mat, center, size, seed, lean=0):
    # Intersect cutting planes. Each facet is one planar polygon, including the long kite faces.
    rng = np.random.default_rng(seed)
    planes = []
    for count,phase,tilt,dist in [(6,.14,-1.55,1.34),(7,.54,-.25,1.00),
                                  (6,-.03,.45,1.01),(5,.47,1.22,1.18),(4,.82,2.45,2.00)]:
        for i in range(count):
            a = phase + TAU*i/count + rng.uniform(-.10,.10)
            planes.append(([math.sin(a),tilt+rng.uniform(-.19,.19),math.cos(a)],dist*rng.uniform(.96,1.04)))
    normals, ds = map(np.array,zip(*planes))
    pts=[]; facets=[[] for _ in planes]
    for comb in combinations(range(len(ds)),3):
        ix=list(comb); m=normals[ix]
        if abs(np.linalg.det(m)) < 1e-6: continue
        p=np.linalg.solve(m,ds[ix])
        if np.max(normals@p-ds)>1e-7: continue
        for j in ix: facets[j].append(len(pts))
        pts.append(p)
    pts=np.array(pts)
    faces=[]
    for ids,n in zip(facets,normals):
        if len(ids)<3: continue
        mid=pts[ids].mean(axis=0)
        u=pts[ids[0]]-mid; u/=np.linalg.norm(u)
        v=np.cross(n,u); v/=np.linalg.norm(v)
        faces.append(sorted(ids,key=lambda k: math.atan2((pts[k]-mid)@v,(pts[k]-mid)@u)))
    lo,hi=pts.min(axis=0),pts.max(axis=0)
    pts=(pts-(hi+lo)/2)/(hi-lo)*size
    pts[:,0]+=lean*pts[:,1]
    mesh(mat, pts+center,faces,bevel=.034 if group=="crystal" else 0,smooth=False)


group='crystal'
cut_gem('crystal',(0,8.04,0),(3.58,7.06,3.62),17,.045)

group='ring'
joints = [.16,1.43,2.52,4.02,5.19,TAU+.16]
gaps = [.061,.085,.036,.073,.046]
for i,(a,b) in enumerate(zip(joints,joints[1:])):
    sector('metal',a+gaps[i],b-gaps[(i+1)%5],2.51,2.91,11.0,11.41,.085,16)
for j,(a,y,s) in enumerate([(.30,11.44,.28),(1.43,11.91,.36),(2.55,11.32,.23),
                             (3.97,11.57,.30),(5.24,11.32,.25)]):
    cut_gem('crystal',polar(a,2.88 if j%2==0 else 2.73,y),(s,s*1.38,s*.90),j+43,.19)


def square(mat,stages,edge=.04):
    shape=[(-.72,-1),(.72,-1),(1,-.72),(1,.72),(.72,1),(-.72,1),(-1,.72),(-1,-.72)]
    mesh(mat,*grid([[origin+[x*r,y,z*r] for x,z in shape] for r,y in stages]),edge)


for i in range(4):
    a=TAU*(i+.5)/4
    origin=np.array([math.sin(a)*5.6,0,math.cos(a)*5.6])
    group='brazier_'+str(i+1)
    square('stone',[(.73,0),(.73,.21),(.65,.31),(.61,.91)],.055)
    square('stone',[(.60,.90),(.57,1.04),(.46,1.50),(.48,1.98)],.05)
    for j in range(4):
        ang=TAU*(j+.5)/4
        rows=[]
        for y,r,w in [(0.07,.88,.32),(.24,.86,.32),(.46,.74,.23),(.95,.69,.20),
                      (1.43,.55,.15),(1.86,.60,.19)]:
            rows.append([polar(ang,r+d,y,x*w) for x,d in [(-1,-.12),(-1,-.015),(-.70,.055),
                                                            (.70,.055),(1,-.015),(1,-.12)]])
        mesh('metal',*grid(rows),.021)
    drum('metal',[(.53,1.65),(.61,1.69),(.65,1.80),(.60,1.94)],24,bevel=.035)
    drum('glow',[(.648,1.775),(.656,1.79),(.652,1.842),(.634,1.86)],32)
    drum('metal',[(.51,1.83),(.58,1.90),(.76,2.09),(.81,2.35),(.78,2.43),
                  (.64,2.43),(.55,2.20),(.38,2.10)],28,bevel=.045)
    for j in range(4):
        ang=TAU*j/4
        rows=[]
        for y,r,w in [(1.92,.55,.29),(2.09,.73,.38),(2.34,.78,.36),(2.59,.79,.26),(2.72,.75,.18)]:
            rows.append([polar(ang,r+d,y,x*w/2) for x,d in [(-1,-.09),(-1,.06),(-.70,.12),
                                                              (.70,.12),(1,.06),(1,-.09)]])
        mesh('metal',*grid(rows),.034)
    cut_gem('crystal',origin+[0,2.55,0],(.64,1.03,.60),20,.11)
    for j in range(3):
        cut_gem('glow' if j==1 else 'crystal',polar(j*TAU/3+.31,.33,2.37),(.36,.42,.34),j+25,.24)


def write_glb():
    doc={'asset':{'version':'2.0'}, 'scenes':[{'nodes':[]}], 'scene':0,
         'nodes':[], 'materials':[], 'meshes':[], 'bufferViews':[], 'accessors':[]}
    data=bytearray()
    def acc(array,kind,component,bounds=False):
        while len(data)%4: data.append(0)
        v=len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer':0,'byteOffset':len(data),'byteLength':array.nbytes})
        data.extend(array.tobytes())
        d={'bufferView':v,'componentType':component,'count':len(array),'type':kind}
        if bounds: d.update(min=array.min(0).tolist(),max=array.max(0).tolist())
        doc['accessors'].append(d)
        return len(doc['accessors'])-1
    parents={}; mats={}
    for (name,mat),verts in groups.items():
        if mat not in mats:
            mats[mat]=len(mats)
            doc['materials'].append({'name':mat,'pbrMetallicRoughness':{'metallicFactor':0}})
        node=len(doc['nodes'])
        if name not in parents:
            parents[name]=node
            doc['nodes'].append({'name':name,'children':[]})
            doc['scenes'][0]['nodes'].append(node)
        parent=doc['nodes'][parents[name]]
        unique,idx=np.unique(np.asarray(verts,dtype='<f4'),axis=0,return_inverse=True)
        attrs={'POSITION':acc(unique[:,:3],'VEC3',5126,True),
               'NORMAL':acc(unique[:,3:6],'VEC3',5126),
               'COLOR_0':acc(np.repeat(unique[:,6:7],3,axis=1),'VEC3',5126)}
        idx=acc(idx.astype('<u2' if len(unique)<65536 else '<u4').reshape(-1),'SCALAR',
                5123 if len(unique)<65536 else 5125)
        parent['children'].append(len(doc['nodes']))
        doc['nodes'].append({'name':name.replace('crystal','gem').replace('ring','circlet')+'_'+mat,
                             'mesh':len(doc['meshes'])})
        doc['meshes'].append({'primitives':[{'attributes':attrs,'indices':idx,'material':mats[mat]}]})
    while len(data)%4: data.append(0)
    doc['buffers']=[{'byteLength':len(data)}]
    raw=json.dumps(doc,separators=(',',':')).encode()
    raw+=b' '*(-len(raw)%4)
    blob=struct.pack('<4sII',b'glTF',2,28+len(raw)+len(data))+struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(data),b'BIN\0')+data
    (ROOT/'out'/'core_foe.glb').write_bytes(blob)
    print('Triangles',sum(len(x)//3 for x in groups.values()))

write_glb()
