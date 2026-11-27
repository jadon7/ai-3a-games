"""Build the Sediment Moon core in metres, in glTF's Y-up coordinate system."""
import math
import json
import struct
from pathlib import Path
from collections import defaultdict
import numpy as np

ROOT = Path(__file__).resolve().parent
TAU = math.tau
sin, cos, pi = math.sin, math.cos, math.pi
def polar(r, a, y):
    return np.array([r*sin(a), y, r*cos(a)])

def unit(v):
    return v / max(np.linalg.norm(v), 1e-12)

def curve(keys, t):
    # Hermite interpolation with a shared slope at each interior station.
    i = max(0, min(len(keys)-2, np.searchsorted([k[0] for k in keys], t)-1))
    a, b = keys[i], keys[i+1]
    l, r = keys[max(0,i-1)], keys[min(len(keys)-1,i+2)]
    u = (t-a[0])/(b[0]-a[0])
    v, w = np.array(a[1:]), np.array(b[1:])
    m = (w-l[1:]) * (b[0]-a[0])/(b[0]-l[0])
    n = (np.array(r[1:])-v) * (b[0]-a[0])/(r[0]-a[0])
    return (2*u**3-3*u*u+1)*v + (u**3-2*u*u+u)*m + (-2*u**3+3*u*u)*w + (u**3-u*u)*n

meshes = defaultdict(list)
part = 'pavement'
offset = np.zeros(3)
def face(mat, points, values=1., normal=None):
    pts=np.asarray(points)
    cs=np.broadcast_to(values,(len(pts),))
    for j in range(1,len(pts)-1):
        ix=[0,j,j+1]
        n=unit(np.cross(pts[j]-pts[0],pts[j+1]-pts[0]))
        if not n.any(): continue
        ns=np.broadcast_to(n if normal is None else normal,pts.shape)
        meshes[part,mat].extend(tuple(p)+tuple(k)+(float(c),) for p,k,c in zip(pts[ix]+offset,ns[ix],cs[ix]))

def masonry(ri,ro,y,h,count,phase=0,mat='stone',bevel=.034,gap=.026,sub=5):
    # The side joints maintain their linear width on both radii.
    for i in range(count):
        def joint(k):
            a=TAU*k/count
            stagger=.12*sin(3*a+.7)+.055*sin(7*a+.22)
            return a+phase+(TAU/count)*stagger if count>=16 and part=='pavement' else a+phase
        start,end=joint(i),joint(i+1)
        b=min(bevel,h*.23,(ro-ri)*.18)
        profile=[(ri+b,y,b,.57),(ro-b,y,b,.63),(ro,y+b,0,.78),
                 (ro,y+h-b,0,.93),(ro-b,y+h,b,1.),(ri+b,y+h,b,.98),
                 (ri,y+h-b,0,.88),(ri,y+b,0,.62)]
        rows=[]
        for r,z,trim,c in profile:
            d=(gap*.5+min(trim,.006))/r if mat=="stone" and gap<.1 else (gap*.5+trim)/r
            rows.append([polar(r,a,z) for a in np.linspace(start+d,end-d,sub+1)])
        for k,row in enumerate(rows):
            nxt=rows[(k+1)%len(rows)]
            for s in range(sub):
                face(mat,[row[s],row[s+1],nxt[s+1],nxt[s]],(profile[k][3],)*2+(profile[(k+1)%8][3],)*2)
        # Coplanar end profile plus the small chamfers around the cut.
        for s in (0,sub):
            pts=[row[s] for row in rows]
            center=np.mean(pts,axis=0)
            for k in range(8):
                verts=[center,pts[k],pts[(k+1)%8]]
                face(mat,verts[::-1] if s else verts,.68)

def lathe(mat, profile, sides=48, phase=0):
    for (r,y,c),(r2,y2,c2) in zip(profile,profile[1:]):
        for i in range(sides):
            a,b=phase+TAU*i/sides,phase+TAU*(i+1)/sides
            norm=lambda t:unit(polar(y2-y,t,r-r2))
            face(mat,[polar(r,a,y),polar(r,b,y),polar(r2,b,y2),polar(r2,a,y2)],(c,c,c2,c2),[norm(a),norm(b),norm(b),norm(a)])

def ridge(mat,points,widths,depths,outward,shade=.96,closed=False):
    # A lenticular strip, following a free curve on the host surface.
    pts=np.array(points)
    sections=[]
    for i,(p,w,d) in enumerate(zip(pts,widths,depths)):
        f=unit(pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)])
        side=unit(np.cross(f,outward[i]))
        n=unit(np.cross(side,f))
        sections.append([p-side*w,p+n*d,p+side*w,p-n*.014])
    for lo,hi in zip(sections,sections[1:]):
        for j in range(4 if closed else 2):
            k=(j+1)%4
            face(mat,[lo[j],lo[k],hi[k],hi[j]],([.78,shade,.86,.65][j],[.78,shade,.86,.65][k],[.78,shade,.86,.65][k],[.78,shade,.86,.65][j]))
    face(mat,sections[0][::-1],.75)
    face(mat,sections[-1],.95)

def tracer(mat,path,width,depth=None,axis=None,closed=False):
    pts=np.array(path); t=np.linspace(0,1,len(pts))
    normals=([unit(np.array([p[0],0,p[2]])) for p in pts] if axis is None else axis)
    shape=.06+.94*(np.sin(pi*t)**.65)
    ridge(mat,pts,shape*width,shape*(depth or width*.7),normals,closed=closed)

def jewel(mat,y0,y1,r,phase=.0,irregular=.0,count=7,center=(0,0)):
    rings=[]
    profile=[(0,.012,-.06),(.27,.74,-.12),(.53,1,0),(.77,.70,.11),(1,.008,.12)] if r>1 else [(0,.008,0),(.45,1,0),(.63,.75,.045),(1,.008,.06)]
    for k,(v,w,rot) in enumerate(profile):
        row=[]
        for i in range(count):
            a=phase+TAU*i/count
            vary=sin(2.17*i+.85*k)
            row.append(polar(r*w*(1+irregular*.09*vary),a+rot,y0+(y1-y0)*(v+(irregular*.06*vary if 0<k<len(profile)-1 else 0)))+[center[0],0,center[1]])
        rings.append(row)
    for j in range(len(rings)-1):
        for i in range(count):
            k=(i+1)%count
            q=[rings[j][i],rings[j][k],rings[j+1][k],rings[j+1][i]]
            c=.75+.25*(.5+.5*cos(2*i+j*1.6))
            if mat=='crystal' and r>1 and j in (1,2) and (i+j)%3!=0:
                # Fracture the large pavilion faces into inclined mineral planes.
                hub=.14*q[0]+.22*q[1]+.23*q[2]+.41*q[3]
                hub+=unit(hub*[1,0,1])*r*(.09+.085*sin(2*i+.3)**2)
                for side in range(4):
                    face(mat,[q[side],q[(side+1)%4],hub],(.51,1.,.69,.99)[(side+i)%4])
            else:
                face(mat,[q[0],q[1],q[2]],c);face(mat,[q[0],q[2],q[3]],min(1.,c+.06))
    face(mat,rings[0][::-1],.66);face(mat,rings[-1],1.)

# Three courses of staggered voussoirs. The top centre is covered by the stem.
for ri,ro,y,h,n,phase in [(.76,2.42,0,.18,16,0),(2.45,3.69,0,.18,24,.07),(3.72,4.58,0,.18,34,.01),
                           (.77,2.94,.177,.42,22,.02),(2.97,4.12,.177,.42,30,.095),
                           (.78,2.73,.596,.51,20,.08),(2.76,3.55,.596,.51,26,.01)]:
    masonry(ri,ro,y,h,n,phase)
# Carve a rolling leaf on each block of the outer, upper riser.
for i in range(26):
    a=(i+.5)*TAU/26+.01
    for side in (-1,1):
        pts=[polar(3.555,a+side*(.01+.094*t),.83+.091*sin(TAU*t-.9)) for t in np.linspace(0,1,15)]
        tracer('stone',pts,.047,.048)
    pts=[polar(3.556,a,y) for y in np.linspace(.686,.993,9)]
    tracer('stone',pts,.069,.055)
part='drum'
masonry(1.12,2.84,1.10,.73,20,.03)
masonry(1.22,2.91,1.75,.17,20,.03)
lathe('metal',[(2.75,1.18,.64),(2.876,1.20,.74),(2.89,1.28,.94),(2.82,1.30,.97)])
lathe('accent',[(2.835,1.67,.70),(2.871,1.69,.97),(2.87,1.724,1),(2.83,1.74,.86)])
# Carved running wave on the drum.
for i in range(24):
    a=TAU*i/24
    for sign in (-1,1):
        pts=[polar(2.846,a+sign*.121*(1-t),1.47+.135*sin(TAU*t*.87-.6)) for t in np.linspace(0,1,12)]
        tracer('metal',pts,.052,.06)
# Fluted, jointed stone calyx, with separate carved lancets.
part='calyx'
stem=[(1.90,1.58),(2.17,1.67),(2.32,1.49),(2.93,1.35),(3.7,1.17),(4.65,.97),(5.5,.89),(6.28,.97),(6.83,1.14),(7.21,1.28)]
for j,((ya,ra),(yb,rb)) in enumerate(zip(stem,stem[1:])):
    for i in range(10):
        a=TAU*i/10+.15
        ylo=ya+(.017 if j else 0); yhi=yb-.017
        rows=[]
        for y,r,b,c in [(ylo,ra-.024,.027,.65),(ylo+.035,ra,0,.87),(yhi-.035,rb,0,1),(yhi,rb-.024,.027,.93)]:
            da=(.016+b)/r
            rows.append([polar(r+.07*sin(pi*k/6)**2,ang,y) for k,ang in enumerate(np.linspace(a+da,a+TAU/10-da,7))])
        for q in range(3):
            for k in range(6):
                face('stone',[rows[q][k],rows[q][k+1],rows[q+1][k+1],rows[q+1][k]],(.73,.9,.99)[q])
        for side in (0,6):
            for q in range(3):
                p,s=rows[q][side],rows[q+1][side]
                d=polar(.13,a+side*TAU/60,0)
                verts=[p,p-d,s-d,s]
                face('stone',verts[::-1] if side==0 else verts,.67)
        for q,reverse in [(0,False),(3,True)]:
            for k in range(6):
                p,s=rows[q][k:k+2]; dp=p*np.array([.86,1,.86]); ds=s*np.array([.86,1,.86])
                pts=[p,s,ds,dp]; face('stone',pts[::-1] if not reverse else pts,.75)
for i in range(10):
    a=(i+.5)*TAU/10+.15
    for sign in (-1,1):
        pts=[]
        for t in np.linspace(0,1,26):
            y=2.34+4.79*t
            r=np.interp(y,*zip(*stem))
            pts.append(polar(r+.05,a+sign*(.185*sin(pi*t)**.8+.025*sin(3*pi*t)),y))
        tracer('stone',pts,.083,.095)
for y,r in [(2.28,1.63),(6.88,1.18)]:
    masonry(r-.21,r,y,.15,10,.15)
# Twin ogees and a marquise plaque on the cardinal faces of the stem.
for i in range(4):
    a=i*pi/2
    for y0,y1,w in [(2.29,3.76,.34),(3.30,6.55,.27)]:
        for side in (-1,1):
            pts=[]
            for t in np.linspace(0,1,21):
                y=y0+(y1-y0)*t
                r=np.interp(y,*zip(*stem))
                pts.append(polar(r+.109,a+side*w*sin(pi*t)**.83*(1+.21*sin(TAU*t)),y))
            tracer('stone',pts,.103,.108)
    pts=[polar(np.interp(y,*zip(*stem))+.142,a,y) for y in np.linspace(4.10,5.15,15)]
    tracer('metal',pts,.139,.08)
    tracer('glow',[p+polar(.064,a,0) for p in pts[2:-2]],.072,.035)
# Overlapping stone sepals close the socket and rise into six pointed lobes.
lathe('metal',[(.03,6.96,.60),(1.12,6.97,.72),(1.22,7.13,.88),(1.12,7.22,.87),(.025,7.24,.61)])
for i in range(8):
    mid=(i+.5)*TAU/8+.15
    rows=[]
    for t in np.linspace(0,1,13):
        row=[]
        for u in np.linspace(-1,1,7):
            w=(1-.975*t**1.6)
            r=.92+.32*sin(t*pi*.88)+.13*(1-abs(u))*sin(pi*t)
            row.append(polar(r,mid+u*w*.368,6.19+1.83*t+.25*abs(u)*(1-t)))
        rows.append(row)
    for lo,hi in zip(rows,rows[1:]):
        for k in range(6): face('stone',[lo[k],lo[k+1],hi[k+1],hi[k]],.96-.09*abs(2*k/5-1))
        for k in (0,6):
            p,q=lo[k],hi[k];d=polar(.145,mid,0)
            verts=[p,p-d,q-d,q]
            face('stone',verts if k else verts[::-1],.77)
        face('stone',[lo[-1]-polar(.14,mid,0),lo[0]-polar(.14,mid,0),hi[0]-polar(.14,mid,0),hi[-1]-polar(.14,mid,0)],.73)
    tracer('accent',[r[3] for r in rows],.037,.04)
# Lance-shaped bronze leaves. The cross section folds over a medial keel.
part='bracts'
stations=[(0,3.01,.54,.33,.22),(.09,2.81,.66,.39,.18),(.29,1.90,.53,.28,.15),
          (.42,2.26,.68,.34,.37),(.59,2.88,.75,.37,.46),(.74,2.55,.58,.25,.42),
          (.88,1.89,.33,.16,.36),(1,.89,.013,.018,.35)]
def leaf(a,sign,short):
    def surface(t,u,inner=False):
        r,w,d,s=curve(stations,t)
        y=1.14+t*(8.58 if short else 11.30)
        if short: r += .64*t*t-.46*sin(pi*t)**1.3; w*=.85
        angle=a+sign*s*(.40 if short else .92)
        # Tangential offset gives the plate a shallow concave inner face.
        rad=r+( (-.60+.20*abs(u))*d if inner else d*(1-.83*abs(u)**.70))-.18*w*u*u + sign*u*w*(.17+.40*sin(2*pi*t-.5))
        if not inner:
            rad+=d*.32*cos(pi*abs(u)*2.7)*sin(pi*t)**.7
        return polar(rad,angle,y)+w*u*np.array([cos(angle),0,-sin(angle)])
    us=np.array([-1,-.85,-.67,-.37,0,.37,.67,.85,1])
    ts=np.linspace(0,1,27)
    for inside in (False,True):
        rows=[[surface(t,u,inside) for u in us] for t in ts]
        for i,(lo,hi) in enumerate(zip(rows,rows[1:])):
            prev=rows[max(0,i-1)]
            following=rows[min(len(rows)-1,i+2)]
            for j in range(len(us)-1):
                pts=[lo[j],lo[j+1],hi[j+1],hi[j]]
                colors=([.74,1,.71,.88,1,.92,.73,1,.77] if not inside else [.75,.81,.89,.91,.95,.91,.89,.81,.75])
                vals=[colors[j],colors[j+1],colors[j+1],colors[j]]
                lip=(j==0 if sign>0 else j==len(us)-2)
                n0=unit(np.cross(lo[j+1]-lo[j],(hi[j]-prev[j])+(hi[j+1]-prev[j+1])))
                n1=unit(np.cross(hi[j+1]-hi[j],(following[j]-lo[j])+(following[j+1]-lo[j+1])))
                norms=np.array([n0,n0,n1,n1])
                face('accent' if lip and not inside else 'metal',pts[::-1] if inside else pts,vals[::-1] if inside else vals,-norms[::-1] if inside else norms)
    for u in (-1,1):
        for t,v in zip(ts,ts[1:]):
            pts=[surface(t,u),surface(t,u,True),surface(v,u,True),surface(v,u)]
            face('accent',pts if u==1 else pts[::-1],.91)
        path=[surface(t,u*.84) for t in ts]
        tracer('accent',path,.081 if not short else .054)
    for t in (0,1):
        for j,k in zip(us,us[1:]):
            pts=[surface(t,j,True),surface(t,k,True),surface(t,k),surface(t,j)]
            face('metal',pts if t==0 else pts[::-1],.8)
    # Raised veins on each broad face gather at the spine and open outwards.
    for lo,hi in [(.025,.25),(.23,.49),(.46,.71),(.70,.92)]:
        for sign2 in (-1,1):
            path=[surface(lo+(hi-lo)*t,sign2*(.03+.73*sin(pi*t*.58)**1.28)) for t in np.linspace(0,1,14)]
            tracer('accent' if sign2==sign else 'metal',path,.042 if sign2==sign else .074,.065)
    # Repousse leaves grow from a shared stem on the bronze face. Their outer
    # margins turn up to catch the directional light, with a recessed midrib.
    for low,high in [(.006,.28),(.34,.65),(.58,.91)]:
        for flank in (-1,1):
            rows=[]
            midline=[]
            for v in np.linspace(0,1,16):
                t=low+(high-low)*v
                spread=(.006+.285*sin(pi*v)**.88)
                axis=flank*(.12+.38*sin(pi*v*.65))
                row=[]
                for w in (-1.,-.54,0.,.54,1.):
                    u=axis+w*spread
                    p=surface(t,u)
                    lift=(.018+(.10+.065*(1-abs(w))-.060*cos(w*pi))*sin(pi*v)**.8)
                    p=p+unit(p*[1,0,1])*lift
                    row.append(p)
                rows.append(row)
                midline.append(row[2])
            for lo,hi in zip(rows,rows[1:]):
                for j in range(4):
                    face('metal',[lo[j],lo[j+1],hi[j+1],hi[j]],(.90,.99,.99,.86))
                for j in (0,4):
                    l,h=lo[j],hi[j]
                    pts=[l,l-unit(l*[1,0,1])*.14,h-unit(h*[1,0,1])*.14,h]
                    face('metal',pts if j else pts[::-1],.68)
            tracer('accent',midline,.033,.031)
            if flank==-sign:
                tracer('accent',[row[0] for row in rows],.037,.034)
    # The outer lip folds away from a tapered luminous inset near the heel.
    ts3=np.linspace(.105,.285,19)
    pts=[surface(t,-sign*(.24+.205*sin(pi*(t-.105)/.18))) for t in ts3]
    pts=[p+unit(p*[1,0,1])*.14*sin(pi*v)**.65 for p,v in zip(pts,np.linspace(0,1,len(pts)))]
    tracer('metal',pts,.119,.062)
    raised=[p+unit(p*[1,0,1])*.059 for p in pts]
    tracer('glow',raised,.084,.032)
    # A swept spine and two curling scrolls break up the broad bronze panels.
    pts=[surface(t,sign*(.10+.23*sin(1.8*pi*t))) for t in np.linspace(.08,.99,31)]
    tracer('accent',pts,.065,.062)
    for mid in (.145,.548):
        pts=[]
        for k in np.linspace(0,1,19):
            u=sign*(.39+.36*(1-.70*k)*cos(1.63*TAU*k-.9))
            t=mid+.068*(1-.7*k)*sin(1.63*TAU*k-.9)+.05*k
            pts.append(surface(t,u))
        tracer('accent',pts,.029,.033)
    for u in (-.67,.67):
        ts2=np.linspace(.18,.84,30)
        pts=[surface(t,u,True) for t in ts2]
        tracer('glow',pts,.080,.045,[-unit(p*[1,0,1]) for p in pts])
for i in range(8):
    a=(i+.5)*TAU/8+(1 if i%2==0 else -1)*.17
    for side in (-1,1):
        pts=[polar(2.80+.35*sin(pi*t)-.23*t,a+side*(.158-.12*t),1.12+1.36*t) for t in np.linspace(0,1,17)]
        tracer('metal',pts,.15,.13,closed=True)
    leaf((i+.5)*TAU/8,1 if i%2==0 else -1,i%4 in (1,2))

# Upright bronze clasps and gem settings at the foot of the calyx.
def clasp(a, radius, y, height, width, mat='metal'):
    levels=[(0,.80,0),(.12,1,.10),(.44,.73,.20),(.70,.56,.18),(1,.012,.04)]
    rows=[]
    for t,w,d in levels:
        rows.append([polar(radius+d+.16*(1-abs(u))-.36*t,a+u*w*width/radius,y+t*height) for u in (-1,-.70,0,.70,1)])
    for lo,hi in zip(rows,rows[1:]):
        for j in range(4):
            face(mat,[lo[j],lo[j+1],hi[j+1],hi[j]],(.82,1,1,.82))
    for side in (0,-1):
        edge=[row[side] for row in rows]
        tracer('accent',edge,.064,.047)
        for p,q in zip(edge,edge[1:]):
            d=polar(.30,a,0);pts=[p,p-d,q-d,q]
            face(mat,pts if side==-1 else pts[::-1],.74)
for i in range(8):
    a=i*TAU/8
    clasp(a,2.94,1.11,1.62,.34)
    for s in (-1,1):
        path=[polar(3.11-.18*t,a+s*.079*sin(pi*t),1.21+1.08*t) for t in np.linspace(0,1,14)]
        tracer('accent',path,.036)
    pts=[polar(3.197-.11*t,a,1.36+.47*t) for t in np.linspace(0,1,11)]
    tracer('glow',pts,.073,.035)
part='crystal'
jewel('crystal',6.91,12.82,1.44,.13,.94,8)
part='ring'
masonry(2.43,2.77,10.95,.29,6,.18,'stone',.045,.96,9)
masonry(2.42,2.78,10.963,.057,6,.18,'metal',.012,.96,9)
masonry(2.64,2.78,11.196,.042,6,.18,'accent',.009,.96,9)
for i in range(6):
    a=i*TAU/6+.18; p=polar(2.60,a,0)
    # The arc faces carry a relief with a central lozenge and two leaf tips.
    mid=a+pi/6
    for side in (-1,1):
        path=[polar(2.771,mid+side*.27*t,11.086+.064*sin(t*TAU)) for t in np.linspace(0,1,15)]
        tracer('metal',path,.029,.033)
    path=[polar(2.774,mid,y) for y in np.linspace(10.993,11.203,9)]
    tracer('accent',path,.072,.041)
    jewel('crystal',10.84,11.32,.133,a,.0,5,(p[0],p[2]))
# Four outlying lamps. Each has a jointed plinth and swept bronze prongs.
for i in range(4):
    part=f'beacon_{i+1}'
    offset=polar(5.60,(i+.5)*TAU/4,0)
    masonry(.07,.575,0,.16,4,pi*.25,sub=1)
    masonry(.07,.51,.16,.16,4,pi*.25,sub=1)
    masonry(.075,.43,.32,.17,4,0,sub=2)
    for j,(y,h,ri,ro) in enumerate([(.48,.19,.245,.334),(.694,.15,.18,.251)]):
        masonry(ri,ro,y,h,4,pi*.25,sub=2)
    lathe('metal',[(.345,.28,.66),(.37,.36,.95),(.25,.47,.89),(.17,.83,.76),(.20,1.07,.86),(.31,1.25,.96),(.25,1.33,.91),(.05,1.33,.75)],8)
    lathe('accent',[(.25,.424,.8),(.27,.441,1),(.25,.477,.92)],8)
    for k in range(4):
        a=k*TAU/4+.3
        pts=[polar(r,a+.22*t,y) for t,(r,y) in enumerate([(.42,.35),(.34,.49),(.26,.66),(.205,.85),(.22,1.08),(.30,1.26)])]
        tracer('metal',pts,.090,.083,closed=True)
        pts=[p+unit(p*[1,0,1])*.057 for p in pts]
        tracer('accent',pts,.041,.035)
        ts=np.linspace(0,1,14)
        pts=[polar(.19+.158*sin(pi*t*.86),a+.29*t,1.10+.55*t) for t in ts]
        tracer('metal',pts,.105,.069,closed=True)
    jewel('crystal',1.25,2.06,.209,.34,.34,6)
offset=np.zeros(3)

# Pack indexed, single-material primitives, sharing the rotation pivot per group.
def save():
    materials=['stone','metal','accent','crystal','glow']
    doc={'asset':{'version':'2.0','generator':'Sediment Moon / build.py'},'scene':0,'scenes':[{'nodes':[]}],
         'nodes':[],'meshes':[],'materials':[{'name':m} for m in materials],
         'bufferViews':[],'accessors':[],'buffers':[]}
    data=bytearray()
    def acc(arr,kind,ctype):
        data.extend(bytes((-len(data))%4)); start=len(data);data.extend(arr.tobytes())
        n=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(data)-start})
        entry={'bufferView':n,'componentType':ctype,'count':len(arr),'type':kind}
        if kind=='VEC3':
            entry.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
        idx=len(doc['accessors']);doc['accessors'].append(entry);return idx
    parents={}
    for (name,mat),verts in meshes.items():
        if name not in parents:
            parents[name]=len(doc['nodes']);doc['scenes'][0]['nodes'].append(parents[name]);doc['nodes'].append({'name':name,'children':[]})
        arr=np.round(np.array(verts,dtype='<f4'),6)
        unique,idx=np.unique(arr,axis=0,return_inverse=True)
        attrs={'POSITION':acc(unique[:,:3].copy(),'VEC3',5126),'NORMAL':acc(unique[:,3:6].copy(),'VEC3',5126),
               'COLOR_0':acc(np.repeat(unique[:,6:],3,axis=1),'VEC3',5126)}
        small=len(unique)<65536
        ind=acc(idx.astype('<u2' if small else '<u4'),'SCALAR',5123 if small else 5125)
        label='mesh_'+name+'_'+mat
        doc['nodes'][parents[name]]['children'].append(len(doc['nodes']))
        doc['nodes'].append({'name':label,'mesh':len(doc['meshes'])})
        doc['meshes'].append({'name':label,'primitives':[{'attributes':attrs,'indices':ind,'material':materials.index(mat)}]})
    data.extend(bytes((-len(data))%4));doc['buffers'].append({'byteLength':len(data)})
    header=json.dumps(doc,separators=(',',':')).encode();header+=b' '*((-len(header))%4)
    (ROOT/'out').mkdir(exist_ok=True)
    (ROOT/'out/core_me.glb').write_bytes(struct.pack('<4sII',b'glTF',2,28+len(header)+len(data))+struct.pack('<I4s',len(header),b'JSON')+header+struct.pack('<I4s',len(data),b'BIN\0')+data)
    print('Triangles:',sum(len(v)//3 for v in meshes.values()))
save()
