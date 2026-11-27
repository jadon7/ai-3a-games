"""Build the Ember Court spawn in metres. Input and GLB axes are both Y-up."""
import json
import math
import struct
from collections import defaultdict
from pathlib import Path

import bmesh
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'out'
OUT.mkdir(exist_ok=True)
pi, sin, cos, hypot = math.pi, math.sin, math.cos, math.hypot
batches = defaultdict(list)
part = 'Portal'
origin = (0, 0, 0)
yaw = 0


def solid(mat, verts, faces, radius=0, smooth=True, shade=1., segments=3):
    """Round the feature edges before sampling normals and grayscale corner values."""
    bm = bmesh.new()
    # The crown inclines away from the front, exposing its face to overhead light.
    if part == 'Portal' and min(v[1] for v in verts)>5.54:
        verts=[(x,y,z-.145*(y-5.54)) for x,y,z in verts]
    points = [bm.verts.new(v) for v in verts]
    for f in faces:
        bm.faces.new([points[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.normal_update()
    if radius:
        edges = [e for e in bm.edges if e.is_manifold and e.calc_face_angle() > .39]
        if edges:
            bmesh.ops.bevel(bm, geom=edges, offset=radius, segments=segments, affect='EDGES', clamp_overlap=True)
    bm.normal_update()
    # Average compatible faces by corner angle; large flat faces keep their plane.
    normals = {}
    for f in bm.faces:
        for lp in f.loops:
            n = f.normal.copy()
            if smooth:
                total = Vector((0., 0., 0.))
                for k in lp.vert.link_loops:
                    if n.dot(k.face.normal) > .78:
                        total += k.face.normal * k.calc_angle()
                if total.length_squared > .000001:
                    n = total.normalized()
            normals[f, lp.vert] = n
    low, high = min(p.co.y for p in bm.verts), max(p.co.y for p in bm.verts)
    for tri in bm.calc_loop_triangles():
        for lp in tri:
            x,y,z = lp.vert.co
            nx,ny,nz = normals[lp.face,lp.vert]
            foot = max(0.,1.-(y-low)/max(.018,min(.15,(high-low)*.22)))
            c = min(1.,max(.73,shade*(1.0-.10*foot-.07*max(-ny,0))))
            batches[part,mat].append((origin[0]+x*cos(yaw)+z*sin(yaw),origin[1]+y,
                                     origin[2]+z*cos(yaw)-x*sin(yaw),nx*cos(yaw)+nz*sin(yaw),ny,
                                     nz*cos(yaw)-nx*sin(yaw),c,c,c))
    bm.free()


def shell(mat, rows, rad=0, smooth=True, shade=1.):
    n = len(rows[0])
    faces = [list(reversed(range(n))), list(range((len(rows)-1)*n,len(rows)*n))]
    for k in range(len(rows)-1):
        for i in range(n):
            j=(i+1)%n
            faces.append([k*n+i,k*n+j,(k+1)*n+j,(k+1)*n+i])
    solid(mat,[p for row in rows for p in row],faces,rad,smooth,shade)


def plan(mat,poly,y0,y1,r=.08,shade=1.):
    shell(mat,[[(x,y,z) for x,z in poly] for y in (y0,y1)],r,shade=shade)


def block(mat,x,y,z,w,h,d,r=.08,shade=1.):
    plan(mat,[(x+a*w/2,z+b*d/2) for a,b in [(-1,-1),(1,-1),(1,1),(-1,1)]],y,y+h,r,shade)


def plaque(mat,xy,front,depth,r=.055,shade=1.):
    shell(mat,[[(x,y,z) for x,y in xy] for z in (front-depth,front)],r,shade=shade)


def loft(mat,profile,n=24,r=0,square=1.,shade=1.,smooth=True,phase=0.):
    def p(v): return math.copysign(abs(v)**square,v)
    rows=[[(x+w*p(sin(i*2*pi/n+phase)), y, z+d*p(cos(i*2*pi/n+phase)))
           for i in range(n)] for y,x,z,w,d in profile]
    shell(mat,rows,r,smooth,shade)


def limb(mat,a,b,sections,n=16):
    a,b=Vector(a),Vector(b)
    axis=(b-a).normalized()
    across=axis.cross(Vector((0,0,1))).normalized()
    depth=axis.cross(across)
    shell(mat,[[a+(b-a)*t+w*sin(2*pi*i/n)*across+d*cos(2*pi*i/n)*depth for i in range(n)]
               for t,w,d in sections])


# Four ashlar courses carry the two broad bent shoulders of the portal.
for s in (-1,1):
    for i,(bottom,top,outer) in enumerate([(-.15,1.32,3.00),(1.356,2.69,2.92),(2.726,4.10,2.90),(4.136,5.53,2.88)]):
        x0=1.70 if i==0 else 1.77
        plaque('stone',[(s*x0,bottom),(s*outer,bottom),(s*(outer-.035),top),(s*(x0+.02),top)],
               -2.70-i*.021,1.59,.13)
    poly=[(1.79,5.565),(2.846,5.565),(2.80,6.56),(1.60,8.03),(.46,8.40),
          (.36,7.08),(1.05,6.85),(1.60,6.20)]
    plaque('stone',[(s*x,y) for x,y in poly],-2.72,1.66,.14)
    stripe=[(1.91,5.98),(2.55,6.11),(2.45,6.58),(1.53,7.75),(.67,8.00),(.62,7.35),(1.23,7.14)]
    plaque('metal',[(s*x,y) for x,y in stripe],-2.65,.22,.075)
    cx,cy=1.55,7.
    # A raised rolled lip encloses a smaller, slightly darker tablet.
    lip=[(s*(cx+.84*(x-cx)),cy+.835*(y-cy)) for x,y in stripe]
    plaque('accent',lip,-2.55,.19,.077)
    field=[(s*(cx+.72*(x-cx)),cy+.71*(y-cy)) for x,y in stripe]
    plaque('accent',field,-2.52,.11,.043,.87)
key=[(-.36,7.035),(.36,7.035),(.51,8.40),(.42,8.62),(-.42,8.62),(-.51,8.40)]
plaque('stone',key,-2.61,1.90,.13)
plaque('metal',[(-.31,7.13),(.31,7.13),(.42,8.41),(-.42,8.41)],-2.53,.21,.07)
plaque('accent',[(-.235,7.22),(.235,7.22),(.32,8.32),(-.32,8.32)],-2.45,.19,.075)
# Portcullis rails end inside the masonry. The space behind the upper gate stays open.
for x in (-1.45,-.88,-.29,.29,.88,1.45):
    top=float(np.interp(abs(x),[0,.36,1.05,1.60,1.79],[7.24,7.22,6.97,6.34,5.64]))
    block('metal',x,-.04,-3.51,.155 if abs(x)>.30 else .175,top+.04,.23,.040)
block('metal',0,-.065,-3.51,3.72,.16,.31,.042)
for y in (.36,2.73,5.12):
    block('metal',0,y,-3.62,3.68,.17,.24,.034)
# Low rear masonry covers the intersection of the two map walls.
for y,h in [(-.30,1.17),(.905,1.08),(2.02,1.02)]:
    for s in (-1,1):
        plan('stone',[(s*.017,-6.02),(s*1.44,-5.95),(s*2.15,-4.85),(s*2.15,-4.23),(s*.017,-4.66)],y,y+h,.1,.91)

part='Curved_wall'
def wallpt(s,t,offset):
    x=2.25+5.76*t-2.36*t*t
    z=-2.72+3.70*t+1.47*t*t+.46*sin(pi*t)
    dx,dz=5.76-4.72*t,3.70+2.94*t+.46*pi*cos(pi*t)
    # The first ashlar turns behind the effigy before the wing emerges from the city wall.
    u=max(0.,min(1.,(t-.16)/.45))
    z-=.52*(1-u*u*(3-2*u))
    dz+=.52*6*u*(1-u)/.45
    length=hypot(dx,dz)
    return (s*(x+offset*dz/length),z-offset*dx/length)

for s in (-1,1):
    for mat,y0,y1,front,back,seams in [
        ('stone',-.76,.58,-.04,.92,[0,.36,.72,1]),
        ('stone',.616,1.94,0,.86,[0,.27,.66,1]),
        ('stone',1.975,2.32,-.075,.96,[0,.48,1]),
        ('accent',.62,1.10,-.125,.22,[0,.48,1])]:
        for a,b in zip(seams,seams[1:]):
            ts=np.linspace(a+.0026,b-.0026,10)
            poly=[wallpt(s,t,front) for t in ts]+[wallpt(s,t,back) for t in reversed(ts)]
            plan(mat,poly,y0,y1,.058 if mat=='accent' else .086)
    ex,ez=wallpt(s,.99,.29)
    origin=(ex,0,ez)
    yaw=-s*.55
    for y,h,w in [(-.75,.78,1.29),(.064,1.03,1.13),(1.128,.91,1.12)]:
        block('stone',0,y,0,w,h,1.20,.095)
    block('metal',0,2.04,0,1.37,.34,1.40,.12)
    shield=[(-.368,2.13),(.368,2.13),(.345,.53),(.095,.315),(-.095,.315),(-.345,.53)]
    plaque('metal',shield,.65,.20,.052)
    plaque('accent',[(x*.79,(y-.36)*.94+.43) for x,y in shield],.71,.16,.04)
    for x in (-.451,.451):
        for z in (-.46,.46):
            loft('metal',[(2.37,x,z,.103,.103),(2.404,x,z,.101,.101),(2.456,x,z,.055,.055)],12)
    yaw=0
    origin=(0,0,0)

def bucket_helm():
    # Recess the T in the continuous helm wall. Its angular stops give the slot square ends.
    angles=sorted(set([i*pi/24 for i in range(-24,24)]+[-.86,-.12,.12,.86]))
    profile=[(2.205,.218,.201),(2.235,.271,.254),(2.295,.292,.280),
             (2.585,.310,.296),(2.665,.318,.307),(2.678,.332,.327),
             (2.711,.337,.333),(2.742,.326,.319),
             (2.842,.294,.277),(2.887,.266,.250),(2.90,.248,.233)]
    verts=[]
    faces=[]
    def pt(y,w,d,t):
        front=max(0.,cos(t))
        chin=max(0.,min(1.,(2.585-y)/.290))
        return (w*math.copysign(abs(sin(t))**.86,sin(t)),y-.050*chin*front**3,
                .026+d*math.copysign(abs(cos(t))**.86,cos(t))+.027*chin*front**8)
    for y,w,d in profile:
        verts.extend([pt(y,w,d,t) for t in angles])
    n=len(angles)
    faces.extend([list(reversed(range(n))),list(range((len(profile)-1)*n,len(profile)*n))])
    inset={}
    edge={}
    for k in range(len(profile)-1):
        for i,t in enumerate(angles):
            j=(i+1)%n
            quad=(k*n+i,k*n+j,(k+1)*n+j,(k+1)*n+i)
            middle=(t+(angles[j] if j else pi))/2
            slot=(k==3 and abs(middle)<.86) or (k==2 and abs(middle)<.12)
            if not slot:
                faces.append(quad)
                continue
            for a in quad:
                if a not in inset:
                    x,y,z=verts[a]
                    inset[a]=len(verts)
                    verts.append((x,y,z-.063))
            faces.append([inset[a] for a in quad])
            for a,b in zip(quad,quad[1:]+quad[:1]):
                key=tuple(sorted((a,b)))
                if key in edge: del edge[key]
                else: edge[key]=(a,b)
    for a,b in edge.values():
        faces.append((a,b,inset[b],inset[a]))
    solid('stone',verts,faces,.008)
    # The dark backing sits on the floor of the continuous carved recess.
    for y0,y1,span,w0,d0,w1,d1 in [(2.587,2.663,.850,.310,.296,.318,.307),
                                      (2.300,2.584,.114,.292,.280,.310,.296)]:
        ts=sorted([-span]+[t for t in angles if -span<t<span]+[span])
        rows=[]
        for t in ts:
            a,b=pt(y0,w0,d0,t),pt(y1,w1,d1,t)
            rows.append([(a[0],a[1],a[2]-.069),(b[0],b[1],b[2]-.069),
                         (b[0],b[1],b[2]-.056),(a[0],a[1],a[2]-.056)])
        shell('metal',rows,shade=.84)


for side in (-1,1):
    part='Sentinel_'+('L' if side<0 else 'R')
    origin=(side*2.99,0,-1.82)
    yaw=0
    block('stone',0,0,0,1.10,.60,1.10,.115)
    origin=(side*2.99,.60,-1.82)

    # This folded slab closes the rear silhouette down to the calves.
    cape=[]
    for y,width,z,fold in [(.32,.50,-.25,.075),(.40,.52,-.26,.077),(.95,.47,-.27,.056),
                            (1.50,.43,-.26,.033),(1.98,.48,-.20,.022),(2.14,.33,-.14,.018)]:
        back=[]
        for t in np.linspace(-1,1,13):
            back.append((t*width,y+.05*t*t,z+.13*t*t+fold*cos(2*pi*t)))
        cape.append(back+[(x,yy,zz+.12) for x,yy,zz in reversed(back)])
    shell('stone',cape,.031,shade=.88)

    for s in (-1,1):
        x=s*.245
        loft('stone',[(.16,x,-.025,.146,.157),(.32,x,-.028,.166,.171),
                      (.56,x,-.025,.173,.181),(.69,x,-.015,.172,.177),
                      (.82,x,-.015,.175,.180),(1.025,s*.231,-.028,.212,.217),
                      (1.36,s*.201,-.055,.234,.248)],24,0,.85,.90)
        # A greave swells around the calf and finishes in a single pointed knee cup.
        greave=[]
        for y,w,d,crest in [(.166,.140,.128,.030),(.226,.164,.155,.035),
                            (.416,.178,.173,.049),(.603,.200,.184,.051),
                            (.704,.194,.180,.042)]:
            greave.append([(x+w*sin(t),y+.035*max(0.,cos(t))**2,
                           -.009+d*cos(t)+crest*max(0.,cos(t))**5) for t in np.arange(24)*2*pi/24])
        shell('stone',greave,.027)
        knee=[(-.155,.775),(-.113,.864),(-.022,.928),(.043,.910),(.149,.837),
              (.165,.759),(.104,.682),(.015,.633),(-.085,.673)]
        shell('stone',[[(x+s*u*scale,.785+(v-.785)*scale,z+.019*sin(pi*u/.35))
                         for u,v in knee] for scale,z in [(.89,.062),(1.,.121),(.90,.173),(.49,.231),(.23,.246)]],.023)
        loft('stone',[(0,x,.101,.191,.286),(.050,x,.108,.205,.296),
                      (.135,x,.111,.204,.282),(.193,x,.060,.188,.229),
                      (.240,x,.023,.161,.182),(.276,x,.012,.155,.170)],24,.025,.71)
    # The culet widens over the hips and drops at either side.
    skirt=[]
    for y,w,d,drop in [(1.00,.502,.272,.058),(1.065,.519,.295,.060),(1.31,.477,.288,.038),
                        (1.48,.402,.259,.0)]:
        skirt.append([(w*sin(t),y+drop*cos(2*t)+(.185 if y<1.10 else .036)*max(0.,cos(t))**14,
                       -.012+d*cos(t)) for t in np.arange(32)*2*pi/32])
    shell('stone',skirt,.035,shade=.91)

    # A single convex breastplate. The sternum projects and the waist turns under.
    chest=[]
    for y,w,d,keel in [(1.285,.327,.246,.031),(1.35,.390,.281,.056),
                        (1.54,.438,.285,.075),(1.75,.478,.315,.086),
                        (1.92,.506,.333,.089),(2.035,.487,.317,.073),
                        (2.145,.419,.276,.051),(2.205,.32,.214,.028)]:
        row=[]
        for t in np.arange(32)*2*pi/32:
            front=max(0.,cos(t))
            row.append((w*sin(t),y-.079*front**5,-.010+d*cos(t)+keel*front**7))
        chest.append(row)
    shell('stone',chest,.029)
    gorget=[]
    for y,w,d,point in [(2.050,.332,.365,.085),(2.066,.371,.408,.090),
                        (2.113,.376,.407,.087),(2.175,.344,.357,.049),
                        (2.235,.294,.295,.018),(2.249,.281,.260,.011)]:
        gorget.append([(w*sin(t),y-point*max(0.,cos(t))**4,.012+d*cos(t))
                        for t in np.arange(32)*2*pi/32])
    shell('stone',gorget,.017,shade=.94)
    bucket_helm()

    for s in (-1,1):
        limb('stone',(s*.350,1.98,-.044),(s*.416,1.55,.150),
             [(0,.177,.187),(.23,.194,.197),(.70,.167,.167),(1,.159,.163)],24)
        # One domed pauldron per shoulder. The rolled lower edge belongs to the same shell.
        cap=[]
        for y,c,w,d,lean in [(1.792,.325,.207,.233,.26),(1.808,.325,.250,.265,.27),
                             (1.853,.325,.275,.279,.29),(1.884,.325,.270,.274,.32),
                             (1.909,.325,.238,.245,.34),(1.950,.325,.270,.278,.36),
                             (2.047,.320,.255,.254,.42),(2.158,.305,.193,.213,.47),
                             (2.214,.286,.109,.145,.49),(2.237,.273,.061,.092,.50)]:
            cap.append([(s*(c+w*sin(t)),y-lean*w*sin(t),.044+d*cos(t)) for t in np.arange(32)*2*pi/32])
        shell('stone',cap,.012)
        hand=1.642 if s<0 else 1.775
        elbow=(s*.439,1.56,.090)
        wrist=(s*.112,hand,.407)
        limb('stone',elbow,wrist,[(0,.145,.146),(.105,.175,.174),(.25,.174,.177),
             (.30,.156,.158),(.40,.161,.163),(.78,.136,.139),(.86,.142,.145),
             (.93,.140,.143),(1,.120,.124)],24)
        # The broad knuckles travel across the grip; the thumb closes over the opposite side.
        limb('stone',(s*.155,hand-.015,.388),(-s*.070,hand+.038,.494),
             [(0,.105,.113),(.19,.129,.133),(.47,.141,.136),
              (.72,.126,.120),(.93,.092,.085),(1,.053,.056)],20)
        limb('stone',(s*.070,hand+.068,.426),(-s*.073,hand-.005,.525),
             [(0,.054,.058),(.25,.065,.071),(.60,.063,.065),(.85,.051,.050),(1,.033,.035)],16)
    # A diamond-section blade and arched crossguard at the hands.
    shell('stone',[[(0,y,z+d),(w,y,z),(0,y,z-d),(-w,y,z)]
                   for y,z,w,d in [(0,.480,.008,.012),(.19,.480,.080,.056),
                                    (1.30,.476,.100,.067),(1.50,.476,.094,.066)]],0,False)
    plaque('stone',[(-.253,1.43),(-.267,1.50),(-.179,1.572),(0,1.55),(.179,1.572),
                    (.267,1.50),(.253,1.43),(.154,1.488),(0,1.457),(-.154,1.488)],.545,.180,.026)
    loft('metal',[(1.50,0,.433,.077,.075),(1.970,0,.453,.065,.068)],16)
    loft('stone',[(1.913,0,.451,.057,.059),(1.944,0,.455,.074,.073),(1.967,0,.455,.091,.089),
                  (2.014,0,.451,.087,.081),(2.046,0,.448,.059,.057)],16,.015)

# The fixed basin keeps its original angular registration with the stairs.
yaw=-.09

part='Hearth'
origin=(0,0,0)
def band(mat,ri,ro,lo,hi,sectors,shift):
    for i in range(sectors):
        a,b=[shift+2*pi*j/sectors for j in (i,i+1)]
        gap=.011/ro
        angles=np.linspace(a+gap,b-gap,1+96//sectors)
        # Run a rounded profile around each sector. Top quads follow the radius.
        bevel=min(.036,(ro-ri)*.22,(hi-lo)*.28)
        rim=[(ri,lo+bevel),(ri,hi-bevel),(ri+bevel*.3,hi-bevel*.28),
             (ri+bevel,hi-.006),(ro-bevel,hi),(ro-bevel*.28,hi-bevel*.28),(ro,hi-bevel),
             (ro,lo+bevel),(ro-bevel,lo),(ri+bevel,lo)]
        shell(mat,[[(r*sin(t),y,r*cos(t)) for r,y in rim] for t in angles])
band('stone',1.33,1.60,-.06,.071,6,.10)
band('accent',1.265,1.325,-.02,.073,4,.55)
band('metal',1.115,1.26,-.02,.095,4,.55)
band('stone',.658,1.12,-.05,.067,5,.34)
band('metal',.51,.666,-.01,.094,4,.12)
loft('metal',[(-.04,0,0,.519,.519),(.032,0,0,.519,.519)],48,0,1,.78)
for i in range(4):
    yaw=.55+i*pi/2
    block('metal',0,.048,1.23,.313,.071,.40,.034)
yaw=0
for x,z,w,d,a in [(-.238,.112,.115,.084,-.35),(.018,.045,.197,.072,-.84),(.178,-.171,.151,.077,-.70),
                    (-.179,-.183,.095,.061,.20),(.19,.206,.09,.056,-.62)]:
    origin=(x,0,z)
    yaw=a
    loft('glow',[(.031,0,0,w*.84,d),(.071,0,0,w,d),(.101,-.013,0,w*.71,d*.70)],6,0,.84,.95,False)
    loft('metal',[(.070,w*.31,-d*.28,w*.64,d*.64),(.10,w*.23,-d*.30,w*.48,d*.58),
                  (.115,w*.13,-d*.29,w*.38,d*.41)],5,0,.91,.80,False)
part='Runnel'
origin=(0,0,0)
yaw=.55
radii=[1.55,4.25,4.42,4.60,4.625,4.64,4.78,4.91,5.08,5.13,5.15,5.28,5.40,5.54,5.63,5.65,5.78,5.92,6.035,6.085]
profile=[]
for r in radii:
    t=min(1.,max(0.,(r-4.6)/1.5))
    land=-.75*t*t*(3.-2*t)
    tread=.035 if r<=4.625 else (-.25 if r<=5.13 else (-.50 if r<=5.63 else -.75))
    profile.append((r,max(tread+.025,land+.043)))
for mat,left,right,y in [('water',-.098,.098,.012),('metal',-.145,-.098,.022),('metal',.098,.145,.022)]:
    rows=[[(left,h+y-.048,r),(right,h+y-.048,r),(right,h+y,r),(left,h+y,r)] for r,h in profile]
    shell(mat,rows)

def save():
    data=bytearray()
    doc=dict(asset=dict(version='2.0',generator='Ember Court spawn'),scene=0,scenes=[dict(nodes=[])],
             nodes=[],meshes=[],materials=[],buffers=[{}],bufferViews=[],accessors=[])
    def accessor(arr,kind,ctype,target,**kw):
        data.extend(b'\0'*(-len(data)%4))
        i=len(doc['bufferViews'])
        doc['bufferViews'].append(dict(buffer=0,byteOffset=len(data),byteLength=arr.nbytes,target=target))
        data.extend(arr.tobytes())
        doc['accessors'].append(dict(bufferView=i,componentType=ctype,count=len(arr),type=kind,**kw))
        return len(doc['accessors'])-1
    mats=list(dict.fromkeys(m for _,m in batches))
    doc['materials']=[dict(name=m) for m in mats]
    bounds=[]
    total=0
    for (name,mat),verts in batches.items():
        unique,ix=np.unique(np.array(verts,dtype='<f4'),axis=0,return_inverse=True)
        pos=unique[:,:3]
        bounds.append((pos.min(axis=0),pos.max(axis=0)))
        p=accessor(pos,'VEC3',5126,34962,min=bounds[-1][0].tolist(),max=bounds[-1][1].tolist())
        n=accessor(unique[:,3:6],'VEC3',5126,34962)
        c=accessor(unique[:,6:9],'VEC3',5126,34962)
        indices=accessor(ix.reshape(-1).astype('<u2'),'SCALAR',5123,34963)
        label=name+'_'+mat
        i=len(doc['nodes'])
        doc['scenes'][0]['nodes'].append(i)
        doc['nodes'].append(dict(name=label,mesh=i))
        doc['meshes'].append(dict(name=label,primitives=[dict(attributes=dict(POSITION=p,NORMAL=n,COLOR_0=c),indices=indices,material=mats.index(mat))]))
        total+=len(verts)//3
    data.extend(b'\0'*(-len(data)%4))
    doc['buffers'][0]['byteLength']=len(data)
    js=json.dumps(doc,separators=(',',':')).encode()
    js+=b' '*(-len(js)%4)
    glb=struct.pack('<4sII',b'glTF',2,28+len(js)+len(data))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(data),b'BIN\0')+data
    (OUT/'spawn_foe.glb').write_bytes(glb)
    print('Triangles:',total,'bounds:',np.min(np.array(bounds)[:,0],axis=0),np.max(np.array(bounds)[:,1],axis=0))

save()
