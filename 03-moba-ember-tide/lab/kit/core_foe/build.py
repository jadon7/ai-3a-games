"""Build the Ember Court core. Coordinates are glTF metres, +Y up, +Z front."""
import json
import math
import random
import struct
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
TAU = math.tau
rng = random.Random(89112)
parts = defaultdict(list)
group = 'foundation'
offset = (0., 0.)



def point(angle, radius, height):
    return np.array((offset[0] + radius * math.sin(angle), height,
                     offset[1] + radius * math.cos(angle)))


def local(angle, radial, lateral, height):
    return point(angle, radial, height) + lateral * np.array((math.cos(angle), 0., -math.sin(angle)))


def face(material, pts, grey=1., out=None, normals=None):
    # Reverse complete polygons together with their per-corner attributes.
    pts = np.asarray(pts)
    normal = np.cross(pts[1] - pts[0], pts[2] - pts[0])
    if np.linalg.norm(normal) < 1e-10:
        return
    normal /= np.linalg.norm(normal)
    colors = list(grey) if np.ndim(grey) else [grey] * len(pts)
    order = list(range(len(pts)))
    if out is not None and np.dot(out, normal) < 0:
        normal = -normal
        order.reverse()
    for j in range(1, len(pts)-1):
        for k in (order[0], order[j], order[j+1]):
            parts[group, material].append((*pts[k], *(normal if normals is None else normals[k]), colors[k]))


def shell(material, loops, shades, caps=True, smooth=False):
    """Loft horizontal convex profiles. Per-side normals retain the section creases."""
    first = loops[0]
    winding = sum(p[0]*q[2]-q[0]*p[2] for p,q in zip(first,first[1:]+first[:1]))
    for j, (low, high) in enumerate(zip(loops, loops[1:])):
        n = len(low)
        strips = []
        for i in range(n):
            k = (i+1) % n
            u = high[i]+high[k]-low[i]-low[k]
            v = low[k]+high[k]-low[i]-high[i]
            norm = np.cross(v, u)
            if winding > 0:
                norm = -norm
            strips.append(norm / max(np.linalg.norm(norm), 1e-12))
        for i in range(n):
            k = (i+1) % n
            ns = None
            if smooth:
                sides = [strips[i]+strips[(i-1)%n], strips[i]+strips[k]]
                a,b = [v/max(1e-12,np.linalg.norm(v)) for v in sides]
                ns = [a,b,b,a]
            col = shades(j,i) if callable(shades) else shades
            face(material(j,i) if callable(material) else material, [low[i],low[k],high[k],high[i]], col, strips[i], ns)
    if caps:
        endmat = material(0,0) if callable(material) else material
        face(endmat, loops[0], .59, [0,-1,0])
        face(endmat, loops[-1], 1., [0,1,0])


def drum(mat, levels, count=40, rot=0, shade=.95, smooth=False):
    shell(mat, [[point(rot + TAU*i/count,r,h) for i in range(count)] for h,r in levels],
          shade, smooth=smooth)


def segment(mat, start, end, rin, rout, y, height, bevel, divisions, shade=1.):
    # Each voussoir has a separate end face, a bevel around the top and bottom.
    rings = []
    for h,b in [(y,bevel),(y+bevel,0),(y+height-bevel,0),(y+height,bevel)]:
        inner, outer = rin+b, rout-b
        row = []
        for radius,indices in [(outer,range(divisions+1)),(inner,range(divisions,-1,-1))]:
            a0, a1 = start+b/radius, end-b/radius
            for i in indices:
                row.append(point(a0 + (a1-a0)*i/divisions,radius,h))
        rings.append(row)
    # The cap is annular. The inner surface faces the axis.
    n = divisions+1
    for j,(lo,hi) in enumerate(zip(rings,rings[1:])):
        for i in range(2*n):
            k = (i+1)%(2*n)
            if i in (n-1,2*n-1):
                a = end if i == n-1 else start
                outward = np.array([math.cos(a),0,-math.sin(a)])*(1 if i==n-1 else -1)
                value = .67
            else:
                outward = (lo[i]+lo[k]+hi[k]+hi[i])/4 - np.array([*offset[:1],0,offset[1]])
                outward[1]=0
                outward *= 1 if i < n-1 else -1
                value = [.73,shade,min(1,shade+.1)][j]
            face(mat,[lo[i],lo[k],hi[k],hi[i]],value,outward)
    for row,up in [(rings[0],-1),(rings[-1],1)]:
        for i in range(divisions):
            face(mat,[row[i],row[i+1],row[-i-2],row[-i-1]],shade if up>0 else .55,[0,up,0])


def course(mat, n, ri, ro, y, h, b, phase=0, gap=.03, divisions=3, varied=False):
    if mat=='stone':
        h-=.022
    edges = [phase+(i+(rng.uniform(-.11,.11) if varied else 0))*TAU/n for i in range(n)]
    for i,a in enumerate(edges):
        end=edges[i+1] if i+1<n else edges[0]+TAU
        segment(mat,a+gap/(ri+ro),end-gap/(ri+ro),ri,ro+(rng.uniform(-.012,0) if varied else 0),
                y,h+(rng.uniform(-.009,0) if varied else 0),b,divisions,rng.uniform(.89,1.))


def bracket(mat, angle, profiles, shade=.96):
    # Eight-sided section with a broad forged face and two clipped corners.
    loops = []
    for y,r,w,d in profiles:
        half = w*.5
        loops.append([local(angle,r+d*v,half*u,y) for u,v in
                      [(-.79,1),(.79,1),(1,.59),(1,-.68),(.77,-1),(-.77,-1),(-1,-.68),(-1,.59)]])
    shell(mat,loops,lambda j,i: shade*(1,.94,.89,.76,.68,.76,.89,.99)[i])


def ornament(mat, angle, radius_at, path, depth=.06):
    # A ridged relief stroke in surface coordinates (lateral, height, half-width).
    rows=[]
    for i,(u,h,w) in enumerate(path):
        p=path[max(i-1,0)]
        q=path[min(i+1,len(path)-1)]
        dx,dy=q[0]-p[0],q[1]-p[1]
        length=math.hypot(dx,dy)
        du,dh=dy/length*w,-dx/length*w
        def proj(x,y,z):
            radius=radius_at(y)
            return point(angle+x/radius,radius+z,y)
        rows.append([proj(u-du,h-dh,0),proj(u,h,depth*min(1,w/.045)),proj(u+du,h+dh,0)])
    for p,q in zip(rows,rows[1:]):
        outward=np.array([math.sin(angle),0,math.cos(angle)])
        for k,col in enumerate((.83,1.)):
            face(mat,[p[k],p[k+1],q[k+1],q[k]],col,outward)


def flame(angle, radius_at, mid, scale):
    paths=[
        [(0,0,.025),(-.04,.22,.10),(.02,.48,.09),(.13,.70,.06),(.09,1.,.009)],
        [(0,.10,.015),(-.12,.38,.075),(-.34,.55,.08),(-.41,.77,.012)],
        [(.005,.27,.015),(.13,.47,.075),(.36,.63,.075),(.43,.85,.009)],
        [(-.02,.42,.013),(-.11,.63,.065),(-.25,.78,.058),(-.27,.95,.006)],
    ]
    for path in paths:
        ornament('accent',angle,radius_at,[(x*scale,mid+y*scale,w*scale) for x,y,w in path],.058*scale)


def crystal_fracture(p,q,r,shade,outward):
    # A sloping fracture within one facet. Only the open end of the fissure glows.
    n=np.cross(q-p,r-p)
    n/=np.linalg.norm(n)
    if np.dot(n,outward)<0:
        n=-n
    heel=.71*p+.16*q+.13*r-.055*n
    left=.19*p+.70*q+.11*r+.035*n
    top=.16*p+.16*q+.68*r+.055*n
    for a,b,c,d,val in [(p,q,left,heel,shade),(q,r,top,left,.91),(r,p,heel,top,.73)]:
        face('crystal',[a,b,c],val,outward)
        face('crystal',[a,c,d],[val,.96,.65],outward)
    ridge=.24*heel+.37*left+.39*top+.065*n
    lip=.86*heel+.14*ridge
    for shoulder,reach,value in [(left,.66,.88),(top,.38,.72)]:
        end=heel+(shoulder-heel)*reach
        face('glow',[heel,end,lip],.84,outward)
        face('crystal',[lip,end,ridge],[.58,.85,.99],outward)
        face('crystal',[end,shoulder,ridge],value,outward)
    face('crystal',[left,top,ridge],[.96,.86,.99],outward)


def cut_crown(layers, cuts):
    # Staggered outlines meet in long kites. Each polished table shares four
    # boundary edges with its neighbours, even where the bevel is asymmetric.
    n=len(layers[0])
    for j in range(1,len(layers)-1):
        for i in range(n):
            nxt=(i+1)%n
            meridian=nxt if j%2 else i
            lo,left,hi,right=(layers[j-1][meridian],layers[j][i],
                              layers[j+1][meridian],layers[j][nxt])
            rim=[lo,left,hi,right]
            center=.21*lo+.26*left+.27*hi+.26*right
            normal=np.cross(right-left,hi-lo)
            normal/=np.linalg.norm(normal)
            if np.dot(normal,[center[0],0,center[2]])<0:
                normal=-normal
            shade,lower_cut=cuts[j-1,i,1]
            upper_shade,upper_cut=cuts[j,i,0]
            depth=max(lower_cut,upper_cut)
            if depth:
                table=[]
                radial=normal.copy()
                radial[1]=0
                radial/=np.linalg.norm(radial)
                for p,shrink in zip(rim,(.19,.11,.21,.39)):
                    q=p+(center-p)*shrink
                    delta=(np.dot(center-q,normal)+depth)/np.dot(normal,radial)
                    table.append(q+radial*np.clip(delta,-.15,.12))
                for k in range(4):
                    k1=(k+1)%4
                    face('crystal',[rim[k],rim[k1],table[k1]],(.90,.99,.74,.64)[k],normal)
                    face('crystal',[rim[k],table[k1],table[k]],(.84,1.,.78,.68)[k],normal)
                lo,left,hi,right=table
            if (i+2*j)%3!=0 and (j<4 or i%2==0):
                crystal_fracture(lo,left,hi,shade,normal)
            else:
                face('crystal',[lo,left,hi],[max(.52,shade-.12),shade,1.],normal)
            face('crystal',[lo,hi,right],[.63,upper_shade,.94],normal)


def gem(x,z,levels,n,rot,skew=0.,lean=(0.,0.),crown=False):
    layers=[]
    for j,(h,r,shift,jitter) in enumerate(levels):
        row=[]
        for i in range(n):
            a=rot+(i+shift+rng.uniform(-.085,.085))*TAU/n
            rad=r*rng.uniform(.95,1.05)
            along=j/(len(levels)-1)
            row.append(np.array((x+rad*math.sin(a)+skew*j/(len(levels)-1)+lean[0]*along,
                                 h+rng.uniform(-jitter,jitter), z+rad*math.cos(a)+lean[1]*along)))
        layers.append(row)
    cuts={}
    for j,(lo,hi) in enumerate(zip(layers,layers[1:])):
        for i in range(n):
            k=(i+1)%n
            for half,tri in enumerate(([lo[i],lo[k],hi[i]], [lo[k],hi[k],hi[i]])):
                value=rng.uniform(.63,1.)
                if crown:
                    cut=j>0 and (i+j+1-half)%3==0 and (half==0 or j<len(layers)-2)
                    cuts[j,i,half]=(value,rng.uniform(.06,.12) if cut else 0.)
                else:
                    along=(j+(1+half)/3)/(len(layers)-1)
                    center=np.mean(tri,axis=0)-np.array([x+lean[0]*along,0,z+lean[1]*along])
                    center[1]=0
                    face('crystal',tri,value,center)
    if crown:
        cut_crown(layers,cuts)


# Stepped court and inset terracotta frieze.
course('stone',29,3.67,4.58,0,.185,.034,.04,varied=True)
course('stone',28,3.31,4.36,.185,.34,.044,.12,varied=True)
course('stone',24,2.52,3.91,.525,.18,.033,.03,varied=True)
course('accent',20,3.49,3.804,.687,.452,.029,.12)
course('stone',23,2.03,3.87,1.135,.28,.044,.02,varied=True)
course('stone',19,1.50,2.96,1.415,.255,.041,.15,varied=True)
drum('metal',[(.65,3.58),(.69,3.835),(.72,3.834)],72)
drum('metal',[(1.10,3.81),(1.135,3.85),(1.16,3.82)],72)
for i in range(20):
    a=.12+(i+.5)*TAU/20
    for side in (-1,1):
        ornament('accent',a,lambda h:3.809,
                 [(side*x,h,w) for x,h,w in [(0,.76,.02),(.11,.84,.053),(.22,.98,.062),
                 (.39,1.035,.042),(.49,.98,.009)]],.096)
    for side in (-1,1):
        ornament('accent',a,lambda h:3.809,
                 [(side*x,h,w) for x,h,w in [(.53,.946,.009),(.48,.89,.032),
                     (.36,.86,.046),(.26,.89,.035),(.24,.95,.009)]],.066)
    ornament('accent',a,lambda h:3.809,[(0,.84,.012),(0,.96,.066),(0,1.075,.009)],.09)

# Drum, armour plates, splayed feet, and keyed collar.
group='iron_seat'
drum('metal',[(1.42,2.12),(1.7,2.18),(1.96,1.99),(3.82,1.81),(4.75,1.92),(4.98,1.74)],48,smooth=True)
for i in range(6):
    a=i*TAU/6
    segment('metal',a-.32,a+.32,1.69,1.983,1.90,2.08,.055,5)
    # Hammered stove plate: backing, a raised surround and a flame in low relief.
    segment('accent',a-.308,a+.308,1.94,2.012,1.98,1.96,.03,8,.62)
    for side in (-1,1):
        segment('metal',a+side*.305-.016,a+side*.305+.016,1.97,2.049,1.96,2.02,.014,1)
    flame(a,lambda h:2.017,2.04,1.71)
    foot=a+TAU/12
    bracket('metal',foot,[(1.58,2.12,1.07,.52),(1.71,2.22,1.15,.55),(2.12,2.25,1.15,.53),
            (2.35,2.17,1.05,.49),(2.63,1.99,.9,.40),(3.31,1.79,.77,.34),(4.06,1.81,.88,.34),
            (4.51,1.84,.98,.38)])
    bracket('metal',foot,[(2.16,2.765,.72,.025),(2.34,2.71,.77,.055),(2.65,2.38,.63,.07),
            (3.31,2.134,.49,.073),(3.77,2.12,.55,.069),(4.09,2.16,.65,.05)])
    for h,r in [(1.97,2.78),(4.36,2.29)]:
        bracket('metal',foot,[(h-.29,r,.58,.06),(h-.21,r+.03,.66,.11),(h+.21,r+.03,.66,.11),(h+.29,r,.58,.06)])
        bracket('accent',foot,[(h-.163,r+.13,.29,.045),(h-.11,r+.16,.36,.05),(h+.12,r+.16,.36,.05),(h+.165,r+.13,.28,.045)])
for j,(y,r,h) in enumerate([(1.69,2.16,.22),(3.99,2.10,.20),(4.20,2.19,.35),(4.565,2.13,.19)]):
    course('metal',18,1.54,r,y,h,.04,.07+(j%2)*.14,.027)

# Swept iron petals. Cross-section relief runs along the spiral.
group='talons'
def interpolate(t,keys):
    u=np.clip(t,0,1)*(len(keys)-1)
    j=min(int(u),len(keys)-2)
    f=u-j
    a,b,c,d=keys[max(0,j-1)],keys[j],keys[j+1],keys[min(len(keys)-1,j+2)]
    return .5*((2*b)+(-a+c)*f+(2*a-5*b+4*c-d)*f*f+(-a+3*b-3*c+d)*f**3)

for i in range(6):
    a0=(i-.25)*TAU/6
    def centerline(t):
        a=a0+interpolate(t,[0,.015,.10,.33,.59,.73,.79])
        r=interpolate(t,[1.76,1.94,2.43,2.80,2.73,2.44,2.85])
        h=4.54+interpolate(t,[0,.86,1.96,3.15,4.05,4.65,4.91])
        h+=(.24*math.cos(3*a0)-.13*math.cos(a0))*t**2
        return point(a,r,h),a

    @lru_cache(None)
    def frame(t):
        center,a=centerline(t)
        tangent=centerline(min(1,t+.001))[0]-centerline(max(0,t-.001))[0]
        tangent/=np.linalg.norm(tangent)
        side=np.array([math.cos(a),0,-math.sin(a)])
        side-=tangent*np.dot(side,tangent)
        side/=np.linalg.norm(side)
        normal=np.cross(side,tangent)
        width=interpolate(t,[.86,.89,.87,.82,.72,.52,.18])
        depth=interpolate(t,[.20,.21,.22,.21,.18,.14,.058])
        return center,side*width/2,normal*depth

    def clawpos(t,u,relief):
        center,side,normal=frame(t)
        return center+side*u+normal*(relief-.32*u*u)
    profile=[(-.88,.78),(-.71,1.05),(-.54,.93),(-.46,.76),(-.35,.97),(.24,1.10),
             (.37,.84),(.47,.79),(.60,1.03),(.83,.88),(1,.28),(.97,-.54),(.73,-1),
             (.44,-1.10),(.29,-1.15),(.18,-1.15),(-.44,-1.17),(-.60,-1.12),(-.73,-1.01),(-.96,-.67),(-1,.24)]
    rows=[[clawpos(t,u,d) for u,d in profile] for t in np.linspace(0,1,29)]
    def alloy(j,side):
        if 3<=j<=25:
            if side in (14,16) and j not in (10,20):
                return 'glow'
            if 12<=side<=17:
                return 'accent'
        return 'metal'
    shell(alloy,rows,lambda j,i:(.97,.97,.81,.69,.98,.94,.67,.82,.99,.95,.77,.75,.78,.82,.88,.78,.85,.81,.76,.82,.91)[i],caps=False)
    for end,sign in [(0,-1),(1,1)]:
        center,side,normal=frame(end)
        direction=sign*np.cross(normal,side)
        row=rows[-1] if end else rows[0]
        for v,q in zip(row,row[1:]+row[:1]):
            face('metal',[center,v,q],.97,direction)
    for pos in (.29,.61,.855):
        # Overlapping armour ends in a shallow chevron on the broad outer face.
        for side in (-1,1):
            coords=[(side*.85,pos+.013,.94),(side*.62,pos+.025,1.12),
                    (0,pos-.007,1.20),(0,pos-.032,1.20),(side*.62,pos+.002,1.12)]
            poly=[clawpos(t,u,d) for u,t,d in coords]
            direction=poly[2].copy();direction[1]=0
            face('metal',poly,1.,direction)
group='crystal'
gem(0,0,[(4.42,0,0,0),(6.02,1.60,.50,.23),(7.81,2.22,0,.23),
          (9.42,2.11,.50,.26),(10.92,1.29,0,.18),(12.47,0,0,0)],9,.1,.09,crown=True)

for j in range(8):
    a=(j+.17)*TAU/8
    x,z=.85*math.sin(a),.85*math.cos(a)
    lift=.59*math.sin(3*a)
    reach=1.23+.20*math.cos(3*a)
    gem(x,z,[(4.68,.12,0,0),(6.14,.66,.22,.19),(7.64,.80,-.06,.23),
             (8.57,.53,.28,.23),(9.62+lift,0,0,0)],5,a,lean=(reach*math.sin(a),reach*math.cos(a)))

group='ring'
for i in range(6):
    a=TAU*i/6
    segment('metal',a-.35,a+.35,3.87,4.26,9.04,.24,.043,8)
    segment('glow',a-.327,a+.327,3.98,4.16,9.005,.054,.013,8,.78)
    segment('glow',a-.32,a+.32,4.194,4.242,9.025,.060,.012,8,.79)
    for j in range(4):
        center=a+(j-1.5)*.17
        segment('metal',center-.08,center+.08,3.94,4.20,9.275,.061,.015,3)

# Four braziers, with split ashlar plinths, flared bowls and captive coals.
for col in range(4):
    az=(col+.5)*TAU/4
    offset=(5.6*math.sin(az),5.6*math.cos(az))
    group='brazier_'+str(col+1)
    for y,h,width in [(0,.25,1.41),(.25,.19,1.22)]:
        h-=.022
        for i in (-1,1):
            for j in (-1,1):
                w=width/2-.016
                cx=i*(w/2+.015); cz=j*(w/2+.015)
                loops=[]
                for hh,b in [(y,.043),(y+.045,0),(y+h-.045,0),(y+h,.043)]:
                    d=w/2-b
                    loops.append([local(0,cz+v*d,cx+u*d,hh) for u,v in
                                 [(-.88,1),(.88,1),(1,.88),(1,-.88),(.88,-1),(-.88,-1),(-1,-.88),(-1,.88)]])
                shell('stone',loops,lambda j,i:[.72,.91,1.][j])
    drum('metal',[(.42,.71),(.56,.72),(.63,.62),(1.38,.47),(1.55,.50),(1.62,.58)],4,math.pi/4)
    for i in range(4):
        flame(i*math.pi/2,lambda h:(.62-(h-.63)*.2)*.707+.012,.68,.62)
    drum('metal',[(1.51,.47),(1.60,.55),(1.68,.57),(1.77,.43),(1.91,.52)],12)
    for i in range(4):
        a=(i+.5)*TAU/4
        bracket('metal',a,[(1.77,.33,.33,.10),(1.98,.41,.35,.105),(2.18,.46,.29,.085),
                           (2.36,.43,.19,.062),(2.48,.37,.048,.03)])
    x,z=offset
    for j in range(4):
        a=j*TAU/4+.3
        gem(x+.235*math.sin(a),z+.235*math.cos(a),
            [(1.83,.045,0,0),(2.13,.22,.3,.06),(2.30,.15,0,.03),
             (2.84-.17*j,0,0,0)],5,a,.12*math.sin(a))

# Pack a deterministic indexed GLB. Keep one glTF mesh per material and moving group.
doc={'asset':{'version':'2.0','generator':'Ember Court geometric modeller'},'scene':0,
     'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'materials':[],
     'buffers':[],'bufferViews':[],'accessors':[]}
blob=bytearray()
def accessor(arr,kind,component,target,bounds=False):
    while len(blob)%4: blob.append(0)
    data=np.ascontiguousarray(arr).tobytes()
    view=len(doc['bufferViews'])
    doc['bufferViews'].append(dict(buffer=0,byteOffset=len(blob),byteLength=len(data),target=target))
    blob.extend(data)
    item=dict(bufferView=view,componentType=component,count=len(arr),type=kind)
    if bounds:
        item.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
    doc['accessors'].append(item)
    return len(doc['accessors'])-1

groups={}
for (name,mat),verts in parts.items():
    if name not in groups:
        groups[name]=len(doc['nodes'])
        doc['scenes'][0]['nodes'].append(groups[name])
        doc['nodes'].append(dict(name=name,children=[]))
    mats=[m['name'] for m in doc['materials']]
    if mat not in mats:
        doc['materials'].append(dict(name=mat)); mats.append(mat)
    vertices,indices=np.unique(np.array(verts,dtype='<f4'),axis=0,return_inverse=True)
    attrs=dict(POSITION=accessor(vertices[:,:3],'VEC3',5126,34962,True),
               NORMAL=accessor(vertices[:,3:6],'VEC3',5126,34962),
               COLOR_0=accessor(np.repeat(vertices[:,6:7],3,axis=1),'VEC3',5126,34962))
    ix=accessor(indices.astype('<u2' if len(vertices)<65536 else '<u4'),'SCALAR',
                5123 if len(vertices)<65536 else 5125,34963)
    doc['nodes'][groups[name]]['children'].append(len(doc['nodes']))
    doc['nodes'].append(dict(name='geo_'+name+'_'+mat,mesh=len(doc['meshes'])))
    doc['meshes'].append(dict(primitives=[dict(attributes=attrs,indices=ix,material=mats.index(mat))]))
while len(blob)%4: blob.append(0)
doc['buffers']=[dict(byteLength=len(blob))]
js=json.dumps(doc,separators=(',',':')).encode()
js+=b' '*(-len(js)%4)
out=ROOT/'out'/'core_foe.glb'
out.parent.mkdir(exist_ok=True)
out.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(js)+len(blob))+struct.pack('<I4s',len(js),b'JSON')+
                js+struct.pack('<I4s',len(blob),b'BIN\0')+blob)
print(out.name,sum(len(rows)//3 for rows in parts.values()),'triangles')
