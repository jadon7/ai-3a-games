"""Build the Ember Court spawn gate. Coordinates and dimensions are in metres."""
import argparse
import json
import math
import struct
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--round', type=int, default=6, choices=range(1, 7))
version = parser.parse_args().round
pi, sin, cos = math.pi, math.sin, math.cos
V = np.array
groups = defaultdict(list)
part = 'Gatehouse'
offset = V([0., 0., 0.])
yaw = 0.
scale = 1.


def local(point):
    x, y, z = point
    if version>=5 and part=='Curved_rampart':
        # Inner face follows the angle of the map walls. The curved coping overlaps them.
        angle=abs(math.atan2(x,-z))
        f=(angle-.43)/.95
        r=math.hypot(x,z)
        u=2.0+4.13*f+.61*(r-4.55)
        inside=4.77+.27*cos(pi*f)-.17*sin(pi*f)
        z=u-inside-(r-4.55)*1.33
        x=math.copysign(u,x)
    elif version >= 2 and part == 'Curved_rampart':
        angle = abs(math.atan2(x,-z))
        x += math.copysign(max(0.,angle-.75)*2.45,x)
        z += max(0.,angle-1.03)*1.4
        if version >= 3:
            # Curve the returns along the inside of the diagonal rampart.
            z += max(0.,angle-.755)*1.49
    if version >= 2 and part.startswith('Sentinel') and y>1.02:
        y = 1.02+(y-1.02)*1.115
    if version>=5 and part.startswith('Sentinel'):
        x*=.85
        z*=.81
    point=offset+scale*V([x*cos(yaw)+z*sin(yaw),y,z*cos(yaw)-x*sin(yaw)])
    if version>=5 and part.startswith('Sentinel') and point[2]>-1.24:
        point[2]=-1.24+(point[2]+1.24)*.30
    return point


def face(material, vertices, outward, shade=1., levels=None):
    pts = [local(p) for p in vertices]
    n = np.cross(pts[1]-pts[0], pts[2]-pts[0])
    length = np.linalg.norm(n)
    if length < 1e-9:
        return
    n /= length
    cols = list(levels) if levels is not None else [1.] * len(pts)
    direction = V([outward[0]*cos(yaw)+outward[2]*sin(yaw),outward[1],outward[2]*cos(yaw)-outward[0]*sin(yaw)])
    if version>=5 and part=='Curved_rampart':
        ctr=np.mean(vertices,axis=0)
        direction=local(ctr+.0001*V(outward))-local(ctr)
    if np.dot(n,direction) < 0:
        n *= -1
        pts.reverse()
        cols.reverse()
    surface = shade * ((.98+.02*max(0., n[1]) - .20*max(0., -n[1])) if version>=3 else (.83+.17*max(0., n[1]) - .14*max(0., -n[1])))
    buf = groups[part, material]
    for i in range(1, len(pts)-1):
        for j in (0, i, i+1):
            c = min(1., max(.5, surface*cols[j]))
            buf.append((*pts[j], *n, c, c, c))


def shell(mat, rows, shade=1., tones=None):
    """Connect closed horizontal or tilted cross sections."""
    rows = np.asarray(rows)
    centers = rows.mean(axis=1)
    count = len(rows[0])
    for k, (a,b) in enumerate(zip(rows, rows[1:])):
        for i in range(count):
            j = (i+1) % count
            pts = [a[i], a[j], b[j], b[i]]
            side = (a[i]+a[j]+b[i]+b[j])/4 - (centers[k]+centers[k+1])/2
            lv = None if tones is None else [tones[k],tones[k],tones[k+1],tones[k+1]]
            for tri in ((0,1,2),(0,2,3)):
                face(mat,[pts[t] for t in tri],side,shade,None if lv is None else [lv[t] for t in tri])
    for row,cen,d in [(rows[0],centers[0],centers[0]-centers[1]),(rows[-1],centers[-1],centers[-1]-centers[-2])]:
        for i in range(count):
            face(mat,[cen,row[i],row[(i+1)%count]],d,shade)


def loft(mat, profile, n=12, shade=1., phase=0.):
    # Each row gives the centre, half-width and half-depth of one section.
    rows = [[(x+w*sin(2*pi*i/n+phase), y, z+d*cos(2*pi*i/n+phase)) for i in range(n)] for x,y,z,w,d in profile]
    buf=groups[part,mat]
    first=len(buf)
    shell(mat,rows,shade,[.78]+[1.]*(len(rows)-1))
    if version>=6 and n>=10:
        # Smooth adjacent lathe facets; keep the breaks between armour lames.
        neighbours=defaultdict(set)
        for v in buf[first:]:
            neighbours[v[:3]].add(v[3:6])
        for j in range(first,len(buf)):
            v=buf[j]
            blended=np.sum([q for q in sorted(neighbours[v[:3]]) if np.dot(q,v[3:6])>.76],axis=0)
            buf[j]=(*v[:3],*(blended/np.linalg.norm(blended)),*v[6:])



def cutrect(w,d,cut):
    a,b=w/2,d/2
    return [(a-cut,b),(-a+cut,b),(-a,b-cut),(-a,-b+cut),(-a+cut,-b),(a-cut,-b),(a,-b+cut),(a,b-cut)]


def block(mat,x,y,z,w,h,d,bev=.04,cut=.08,shade=1.):
    bev=min(bev,h*.32,w*.18,d*.18)
    rows=[]
    for dy,s in [(0,bev),(bev,0),(h-bev,0),(h,bev)]:
        poly=cutrect(w-s*2,d-s*2,min(cut,(w-2*s)*.22,(d-2*s)*.22))
        rows.append([(x+u,y+dy,z+v) for u,v in poly])
    shell(mat,rows,shade,[.72,.90,1,1])


def panel(mat, outline, z, depth, bevel=.025, shade=1., ridge=0., peak=None):
    """Carve a convex front elevation, with a bevel and optional chased ridge."""
    p=np.array(outline,dtype=float)
    c=p.mean(axis=0)
    q=[]
    for i,a in enumerate(p):
        e1=a-p[i-1]; e2=p[(i+1)%len(p)]-a
        n1=V([-e1[1],e1[0]])/np.linalg.norm(e1); n2=V([-e2[1],e2[0]])/np.linalg.norm(e2)
        if np.dot(c-a,n1)<0: n1=-n1
        if np.dot(c-a,n2)<0: n2=-n2
        move=(n1+n2)*min(bevel/(1+np.dot(n1,n2)+1e-6),bevel*2.5)
        q.append(a+move)
    rows = [np.column_stack((u,np.full(len(p),zz))) for u,zz in [(q,z-depth),(p,z-depth+min(bevel,depth*.33)),(p,z-min(bevel,depth*.33)),(q,z)]]
    for a,b in zip(rows,rows[1:]):
        for i in range(len(p)):
            j=(i+1)%len(p)
            out=(*((p[i]+p[j])/2-c),0)
            face(mat,[a[i],a[j],b[j],b[i]],out,shade)
    ctr=c if peak is None else V(peak)
    for i in range(len(p)):
        j=(i+1)%len(p)
        face(mat,[(ctr[0],ctr[1],z+ridge),rows[-1][i],rows[-1][j]],(0,0,1),shade)
        face(mat,[(*c,z-depth),rows[0][i],rows[0][j]],(0,0,-1),shade*.8)


def rod(mat,a,b,r1,r2=None,n=8,shade=1.):
    a,b=V(a),V(b)
    axis=(b-a)/np.linalg.norm(b-a)
    side=np.cross(axis,[0,0,1] if abs(axis[2])<.9 else [1,0,0])
    side/=np.linalg.norm(side)
    fore=np.cross(axis,side)
    circ=[side*cos(i*2*pi/n)+fore*sin(i*2*pi/n) for i in range(n)]
    shell(mat,[[p+r*v for v in circ] for p,r in [(a,r1),(b,r1 if r2 is None else r2)]],shade)


def boss(x,y,z,r,mat='metal'):
    rod(mat,(x,y,z),(x,y,z+r*.48),r,r*.64,8)


def wedge(mat,ri,ro,a,b,y0,y1,bevel=.02,shade=1.,steps=4):
    # Annular ashlar. Four profiles include the bevels of both cut ends.
    rows=[]
    for y,off in [(y0,bevel),(y0+bevel,0),(y1-bevel,0),(y1,bevel)]:
        start,end=a+off/ro,b-off/ro
        angles=np.linspace(start,end,steps+1)
        rows.append([V([(r)*sin(t),y,-r*cos(t)]) for r,seq in [(ro-off,angles),(ri+off,angles[::-1])] for t in seq])
    n=len(rows[0]); mid=(a+b)/2
    for k,(u,v) in enumerate(zip(rows,rows[1:])):
        for i in range(n):
            j=(i+1)%n
            c=(u[i]+u[j]+v[i]+v[j])/4
            if i==steps: direction=V([cos(b),0,sin(b)])
            elif i==n-1: direction=V([-cos(a),0,-sin(a)])
            else: direction=V([c[0],0,c[2]])*(1 if i<steps else -1)
            face(mat,[u[i],u[j],v[j],v[i]],direction,shade*(.88 if k==0 else 1.))
    for u,d in [(rows[0],-1),(rows[-1],1)]:
        for i in range(steps):
            face(mat,[u[i],u[i+1],u[n-2-i],u[n-1-i]],(0,d,0),shade)


def arcp(s, t, radius):
    # Two circle centres form the pointed opening.
    return (s*(radius*cos(t)-1.13),4.55+radius*sin(t))


def arch_band(mat,r0,r1,front,depth,num,bev=.035):
    for s in (-1,1):
        for i in range(num):
            def end(rad,j,gap):
                return math.acos(1.13/rad)*j/num + gap/rad
            t0=lambda r:end(r,i,.016)
            t1=lambda r:end(r,i+1,-.016)
            # Short individual voussoirs retain flat cut faces.
            pts=[arcp(s,t0(r0),r0),arcp(s,t1(r0),r0),arcp(s,t1(r1),r1),arcp(s,t0(r1),r1)]
            panel(mat,pts,front,depth,bev,.96 if i%3==0 else 1.)


# Portal: independent bed stones, voussoirs and iron gate leaves.
for s in (-1,1):
    x=s*2.24
    block('stone',x,-.17,-3.51,1.15,.58,1.38,.075,.18)
    for i in range(6):
        block('stone',x,.44+i*.685,-3.56,1.02,.655,1.17,.04,.11,1.-.035*(i%3))
    block('metal',x,4.39,-3.52,1.16,.16,1.31,.035,.12)
    # Faceted vertical buttress with an inset, spear-ended red escutcheon.
    def mir(points): return [(s*u,v) for u,v in points]
    if version>=6:
        for lo,hi,outer in [(.34,1.42,2.84),(1.452,2.75,2.816),(2.782,4.45,2.783)]:
            panel('stone',mir([(2.42,lo),(outer,lo),(outer-.025,hi),(2.416,hi)]),-2.79,.83,.036,1.,.084)
        panel('stone',mir([(2.416,4.482),(2.756,4.482),(2.57,4.91)]),-2.79,.83,.034,1.,.078)
    else:
        panel('stone',mir([(2.42,.34),(2.84,.35),(2.75,4.46),(2.57,4.91),(2.41,4.49)]),-2.79,.83,.055,1.,.10)
    panel('metal',mir([(2.03,.51),(2.38,.79),(2.40,4.16),(2.19,4.42),(2.02,4.12)]),-2.89,.36,.035)
    panel('accent',mir([(2.11,.76),(2.31,.92),(2.32,3.99),(2.20,4.15),(2.11,3.98)]),-2.868,.08,.019,.83,.045)
    for i in (1.05,3.87): boss(s*2.213,i,-2.826,.065)
arch_band('stone',2.86,3.91,-3.0,1.23,7,.043)
arch_band('metal',2.78,2.91,-2.948,.31,7,.02)
arch_band('accent',3.05,3.15,-2.942,.15,7,.02)
arch_band('stone',3.18,3.7,-2.87,.44,5,.05)
for s in (-1,1):
    # Raised iron blades follow the thrust of the arch.
    panels=[[(2.70,4.47),(2.91,4.88),(2.76,5.65),(2.36,6.43),(2.38,5.65)],
            [(2.40,5.94),(2.56,6.31),(2.24,7.07),(1.53,7.90),(1.66,7.03)],
            [(1.52,7.07),(1.65,7.62),(.92,8.13),(.19,8.68),(.54,7.67)]]
    for i,pts in enumerate(panels):
        panel('metal',[(s*u,v) for u,v in pts],-2.91,.81,.035,1.,.14)
    # Central edge of the two leaves.
    block('metal',s*.052,.065,-3.53,.086,7.06,.17,.015,.018)
for idx in range(-5,6):
    x=idx*.312
    hi=4.55+math.sqrt(2.84**2-(abs(x)+1.13)**2)
    block('metal',x,.16,-3.64,.088,hi-.11,.116,.015,.023)
    panel('metal',[(x-.069,.35),(x,.024),(x+.069,.35)],-3.55,.14,.008,1.,.023)
for h in (.46,2.1,3.76,5.45):
    w=1.75 if h<4.55 else math.sqrt(2.86**2-(h-4.55)**2)-1.13
    block('metal',0,h,-3.553,2*w,.115,.122,.012,.028)
    for i in range(-5,6):
        boss(i*.312,h+.057,-3.484,.036)
if version>=2:
    # Inner gate chamber. Its rear wall straddles the original corner at Z=-5.1.
    for k in range(4):
        y=-.19+k*.79
        widths=[.98,1.21,.98] if k%2==0 else [1.62,1.58]
        x=-1.61
        for w in widths:
            block('stone',x+w/2,y,-5.33,w,.757,.92,.052,.10,.83)
            x+=w+.03
    for s in (-1,1):
        for k in range(5):
            block('stone',s*1.88,-.17+k*.86,-4.54,.57,.832,.99,.048,.10,.90)
        block('metal',s*1.88,4.14,-4.5,.73,.22,1.02,.035,.09)
    for s in (-1,1):
        block('stone',s*.84,2.99,-5.28,1.65,.25,1.09,.046,.105)
        block('metal',s*.84,3.27,-5.26,1.65,.081,1.07,.016,.10)
    # The face plates bridge a pair of leaves with separate hinge straps.
    for s in (-1,1):
        for j,y in enumerate((1.19,2.98,4.75)):
            for i in range(5):
                x=(i+.5)*.313
                panel('metal',[(s*(x-.11),y+.055),(s*(x-.022),y+.31),
                      (s*(x+.082),y+.42),(s*(x+.034),y+.14),(s*(x+.12),y+.055)],
                      -3.47,.11,.01,.95,.022)
            panel('metal',[(s*.11,y-.072),(s*1.67,y-.072),(s*1.69,y+.116),
                           (s*.54,y+.12),(s*.11,y+.023)],-3.448,.139,.016)
            for i in (1,3,5):
                boss(s*i*.31,y+.025,-3.442,.052,'accent')
        for i in range(4):
            x=.22+.31*i; y=5.68-.29*i
            rod('metal',(s*x,y,-3.53),(s*(x+.32),y+.38,-3.53),.038,.038,6)
            rod('metal',(s*x,y,-3.53),(s*(x+.32),y-.36,-3.53),.038,.038,6)
        # Broad segmented tympanum relief between the narrow archivolt and crown.
        for pts in [[(2.38,5.02),(2.60,5.36),(2.40,5.93),(2.16,6.29),(2.19,5.76)],
                    [(2.10,6.19),(2.25,6.58),(1.79,7.15),(1.37,7.43),(1.56,6.94)],
                    [(1.29,7.29),(1.41,7.64),(.85,7.94),(.43,8.12),(.71,7.65)]]:
            coords=[(s*x,y) for x,y in pts]
            panel('accent',coords,-2.72,.20,.034,.90,.045)
            center=np.mean(coords,axis=0)
            panel('stone',[center+(.88 if version>=6 else .73)*(V(a)-center) for a in coords],-2.689,.11,.019,1.,.074)
if version>=4:
    block('metal',0,.01,-3.57,3.49,.105,.38,.018,.045)
    for s in (-1,1):
        # Meeting stiles run continuously down the centre of the closed gate.
        panel('accent',[(s*.044,.157),(s*.092,.19),(s*.093,6.93),(s*.05,7.055)],
              -3.425,.106,.011,.70,.021)
        # A pair of arching tracery ribs frame the upper part of each leaf.
        for direction in (-1,1):
            x0=s*.84+.68*direction
            prev=(x0,4.95,-3.446)
            for t in np.linspace(.14,1.,8):
                nxt=(s*.84+.68*direction*(1-t**1.7),4.95+1.58*t,-3.446)
                rod('metal',prev,nxt,.046,.046,8)
                prev=nxt
        panel('stone',[(s*.045,7.58),(s*.24,7.72),(s*.34,8.13),(s*.167,8.36),(s*.033,8.27)],
              -2.72,.55,.024,1.,.058)
        boss(s*.194,7.93,-2.653,.055,'accent')
        for i in range(5):
            t=.15+i*.223
            x,y=arcp(s,t,3.43)
            boss(x,y,-2.692,.059,'accent')
# Outer wall. Wedge joints stagger between courses.
part='Curved_rampart'
for s in (-1,1):
    start,end=.43,1.38
    for k in range(5):
        joints=[start]+[start+(end-start)*(i+(.5 if k%2 else 0))/5 for i in range(0,6) if 0<i+(.5 if k%2 else 0)<5]+[end]
        for a,b in zip(joints,joints[1:]):
            lo,hi=sorted([a*s,b*s])
            wedge('stone',4.55,5.26,lo+.003,hi-.003,-.25+.725*k,.445+.725*k,.036,.96)
    for i in range(5):
        a,b=sorted([s*(start+(end-start)*i/5),s*(start+(end-start)*(i+1)/5)])
        wedge('metal',4.48,5.32,a+.003,b-.003,3.37,3.53,.035)
    for t in (.86,1.31):
        t*=s
        wedge('stone',4.35,5.27,t-.071,t+.071,-.19,1.59,.04)
        wedge('stone',4.35,5.27,t-.071,t+.071,1.62,3.45,.04)
        wedge('metal',4.30,5.32,t-.084,t+.084,3.48,3.65,.039)
        wedge('accent',4.314,4.37,t-.049,t+.049,.69,3.14,.015,.82)

if version>=4:
    # Carved socle and cap mouldings. Stagger all visible stone joints.
    for s in (-1,1):
        for i in range(6):
            a,b=sorted([s*(.43+.95*i/6),s*(.43+.95*(i+1)/6)])
            wedge('stone',4.42,5.22,a+.0024,b-.0024,-.06,.27,.055,.96)
            wedge('metal',4.428,4.57,a+.0024,b-.0024,.30,.365,.015,.85)
            wedge('stone',4.43,5.25,a+.0024,b-.0024,3.17,3.36,.035)
        for t in (.86*s,1.31*s):
            for a in (-.054,.054):
                wedge('metal',4.284,4.37,t+a-.008,t+a+.008,.68,3.15,.01)
            for y in (.56,3.07):
                wedge('metal',4.273,4.46,t-.062,t+.062,y,y+.12,.024)
            # Tablet edging and a small flame-shaped iron relief on the inner face.
            def wall_relief(poly,r,raised,mat):
                pts=[(r*sin(t+s*u/4.32),h,-r*cos(t+s*u/4.32)) for u,h in poly]
                cen=np.mean(pts,axis=0)-V([sin(t),0,-cos(t)])*raised
                for j,a in enumerate(pts):
                    face(mat,[a,pts[(j+1)%len(pts)],cen],(-sin(t),0,cos(t)))
            wall_relief([(-.14,.95),(0,.74),(.14,.95),(.11,1.56),(0,1.22),(-.11,1.61)],4.286,.043,'metal')
            wall_relief([(-.095,.97),(0,.85),(.091,1.0),(0,1.34)],4.245,.028,'accent')
            wedge('stone',4.29,5.25,t-.08,t+.08,3.67,3.81,.028)
            wedge('metal',4.44,5.12,t-.06,t+.06,3.83,3.95,.048)
# Sculpted effigies. All armour, drapery and weapons are closed geometry.
def guard():
    # Layered ashlar socle, with vertical as well as horizontal joints.
    block('stone',0,-.16,0,2.14,.31,1.66,.065,.23)
    for s in (-1,1):
        block('stone',s*.521,.18,0,1.012,.49,1.54,.045,.13)
    block('stone',0,.70,0,2.16,.22,1.63,.045,.2)
    block('metal',0,.935,0,1.93,.085,1.43,.02,.19)
    floor=1.02
    for s in (-1,1):
        # Sabaton, shin, cuisse. Silhouette shifts at the ankle and knee.
        loft('stone',[(s*.41,floor,.17,.25,.4),(s*.41,1.17,.21,.25,.39),(s*.405,1.36,.05,.21,.24)],10)
        loft('stone',[(s*.405,1.22,.008,.17,.20),(s*.395,1.76,-.01,.20,.24),(s*.37,2.22,.015,.25,.27),(s*.36,2.48,.012,.23,.25),
                      (s*.34,2.73,-.005,.29,.30),(s*.29,3.40,-.055,.35,.37),(s*.27,3.65,-.06,.34,.35)])
        # Faceted knee cap and the projecting ridge of each greave.
        def plate(coords,z,d,mat='stone',ridge=.06):
            panel(mat,[(s*u,v) for u,v in coords],z,d,.02,1.,ridge)
        plate([(.22,1.39),(.40,1.24),(.59,1.44),(.60,2.05),(.40,2.29),(.24,2.03)],.228,.21)
        plate([(.17,2.27),(.36,2.10),(.62,2.28),(.60,2.49),(.40,2.64),(.20,2.52)],.278,.21,ridge=.095)
    # Heavy pleated mantle behind legs. The wave changes down the garment.
    cape=[]
    for y,w,d,zc,amp in [(1.09,.86,.32,-.25,.09),(1.27,.87,.34,-.25,.09),(2.7,.78,.31,-.26,.07),(4.6,.76,.28,-.25,.045),(5.68,.85,.31,-.17,.045),(5.87,.53,.25,-.13,.02)]:
        row=[]
        for i in range(48):
            a=i*2*pi/48
            f=cos(8*a+.22)
            row.append((w*sin(a)+amp*f*sin(a),y+(.081*f if y<1.3 else 0),zc+(d+amp*f)*cos(a)))
        cape.append(row)
    shell('stone',cape,.79)
    # Waist and breastplate. Section changes give the waist a pinch.
    loft('stone',[(0,3.31,0,.54,.37),(0,3.64,0,.64,.39),(0,4.2,0,.51,.345),(0,4.55,0,.56,.40),(0,5.18,0,.82,.49),(0,5.54,-.035,.90,.43),(0,5.70,-.03,.57,.35),(0,5.83,0,.33,.28)],14)
    for k in range(3):
        y=3.63+k*.22; w=.69-k*.055
        loft('stone',[(0,y,0,w,.40),(0,y+.065,0,w+.012,.415),(0,y+.238,0,w-.07,.363)],12)
    for s in (-1,1):
        plate([(.25,3.80),(.61,3.85),(.74,3.54),(.64,2.89),(.38,2.61),(.25,2.91)],.34,.24,ridge=.09)
        plate([(.06,5.24),(.28,5.53),(.72,5.6),(.78,5.31),(.61,4.95),(.19,4.68)],.398,.25,ridge=.15)
    # Pectoral blazon is a small four-plane bronze casting.
    panel('metal' if version>=3 else 'accent',[(0,5.50),(.205,5.20),(.12,4.91),(0,4.70),(-.135,4.95),(-.20,5.20)],.50,.20,.018,.90,.16)
    loft('metal',[(0,5.64,0,.5,.36),(0,5.73,0,.55,.36),(0,5.87,-.02,.43,.31),(0,5.99,-.02,.36,.28)])
    # High, swept up pauldrons. Each shoulder overhangs the elbow.
    for s in (-1,1):
        loft('stone',[(s*.79,4.86,0,.26,.27),(s*.85,5.23,-.02,.295,.31),(s*.77,5.56,-.035,.28,.28)],10)
        for k in range(3):
            x=.83-.045*k; y=5.03+k*.205
            loft('stone',[(s*x,y,0,.32,.32),(s*(x+.02),y+.09,-.015,.366,.36),(s*(x-.06),y+.30,-.04,.26,.29),(s*(x-.09),y+.395,-.06,.14,.20)],10)
        plate([(.50,5.58),(.58,5.91),(.85,6.12),(1.13,5.62),(1.17,5.41),(.94,5.47),(.68,5.37)],.24,.53,ridge=.15)
        # The forearms converge towards the pommel.
        rod('stone',(s*.86,5.05,0),(s*.89,4.52,.075),.247,.221,10)
        loft('stone',[(s*.87,4.34,.09,.21,.21),(s*.90,4.52,.09,.29,.275),(s*.86,4.74,.07,.22,.21)],10)
        rod('stone',(s*.87,4.54,.11),(s*.24,4.14,.47),.235,.16,10)
        rod('metal',(s*.74,4.46,.17),(s*.66,4.40,.225),.246,.25,10)
        rod('stone',(s*.64,4.38,.25),(s*.33,4.18,.43),.235,.17,10)
        rod('metal',(s*.36,4.21,.42),(s*.29,4.16,.46),.188,.18,10)
        loft('stone',[(s*.165,3.99,.49,.12,.14),(s*.165,4.105,.51,.20,.17),(s*.165,4.255,.50,.16,.15)],10)
    # Closed helm, deep eye slot, flanged cheeks and medial comb.
    loft('metal',[(0,5.84,0,.25,.22),(0,6.12,.015,.323,.285),(0,6.39,0,.34,.33),(0,6.57,-.02,.29,.27)],12,.72)
    loft('stone',[(0,6.38,0,.336,.331),(0,6.49,-.008,.355,.338),(0,6.70,-.065,.27,.30),(0,6.86,-.115,.12,.17),(.015,6.92,-.16,.035,.066)],12)
    for s in (-1,1):
        plate([(.028,6.36),(.04,6.48),(.20,6.52),(.337,6.45),(.30,6.39),(.14,6.38)],.294,.24,ridge=.036)
        plate([(.035,6.29),(.26,6.35),(.33,6.35),(.26,6.04),(.075,5.90),(.035,6.07)],.286,.255,ridge=.085)
    panel('stone',[(0,6.77),(.085,6.52),(.045,6.17),(0,6.10),(-.046,6.17),(-.08,6.52)],.323,.23,.012,1.,.08)
    # Greatsword braced on the plinth.
    panel('stone' if version>=3 else 'metal',[(0,1.03),(.155,1.47),(.14,3.77),(.097,3.96),(-.097,3.96),(-.14,3.77),(-.155,1.47)],.57,.12,.012,1.,.091)
    for s in (-1,1):
        plate([(.02,3.88),(.23,3.92),(.42,3.82),(.35,4.02),(.16,4.07),(.02,4.04)],.614,.19,'metal',.035)
    rod('metal',(0,3.95,.535),(0,4.49,.535),.079,.073)
    loft('metal',[(0,4.43,.535,.073,.073),(0,4.55,.535,.136,.126),(0,4.69,.535,.048,.048)],8)
    if version >= 3:
        # Individual relief facets turn towards the key light on the helm and cuirass.
        def relief(mat,perimeter,tip):
            for i,a in enumerate(perimeter):
                face(mat,[a,perimeter[(i+1)%len(perimeter)],tip],(0,0,1))
        for s in (-1,1):
            def relief_half(mat,perimeter,tip):
                relief(mat,[(s*x,y,z) for x,y,z in perimeter],(s*tip[0],tip[1],tip[2]))
            # Eyes sit under a sloping brow. Lower edge turns down at each temple.
            relief_half('stone',[(0,6.46,.349),(.10,6.58,.34),(.29,6.54,.18),(.365,6.44,.08),
                          (.312,6.385,.213),(.09,6.375,.37)],(.15,6.47,.425))
            relief_half('metal',[(.035,6.362,.37),(.151,6.376,.366),(.312,6.385,.222),
                          (.278,6.331,.241),(.082,6.300,.373)],(.14,6.345,.385))
            relief_half('stone',[(.035,6.298,.372),(.265,6.326,.252),(.32,6.337,.15),(.288,6.062,.205),
                          (.075,5.917,.32),(.035,6.046,.379)],(.139,6.164,.411))
            for j in range(3):
                xx=.109+j*.044
                rod('metal',(s*xx,6.085+j*.033,.39-j*.011),(s*(xx+.028),6.154+j*.033,.392-j*.010),.012,.008,6)
            # Gorget has two upturned wings behind the helmet.
            relief_half('stone',[(.22,5.57,.25),(.38,5.93,.255),(.44,6.13,-.12),(.47,6.09,-.32),
                          (.60,5.74,-.24),(.50,5.58,.18)],(.458,5.80,.323))
            rod('metal',(s*.24,5.59,.35),(s*.44,5.98,.29),.041,.048)
            # Domed pectorals and rib plates follow the armpit and sweep into the sternum.
            relief_half('stone',[(.04,5.23,.52),(.32,5.58,.43),(.65,5.62,.25),(.82,5.45,.19),
                          (.66,5.12,.38),(.225,4.86,.49)],(.38,5.26,.617))
            for j in range(2):
                y=4.73-j*.235
                relief_half('stone',[(.11,y+.18,.462),(.51,y+.345,.36),(.66,y+.40,.17),
                          (.56,y+.14,.335),(.204,y-.10,.44)],(.39,y+.14,.515))
            # Three ridged lames, one pointed crown, and a separately forged rolled rim.
            for j in range(3):
                x=.88-j*.033; y=5.12+j*.18
                relief_half('stone',[(x-.22,y+.08,.25),(x-.15,y+.27,.31),(x+.07,y+.29,.27),
                           (x+.24,y+.17,.10),(x+.29,y-.015,.052),(x+.14,y+.015,.283),
                           (x-.13,y-.03,.337)],(x+.033,y+.139,.403))
            relief_half('stone',[(.57,5.59,.27),(.63,5.81,.23),(.85,6.10,-.02),(1.03,5.78,.09),
                          (1.15,5.54,.21),(.90,5.57,.38),(.70,5.49,.37)],(.868,5.75,.397))
            rod('metal',(s*.71,5.50,.371),(s*.905,5.575,.38),.028,.032)
            rod('metal',(s*.905,5.575,.38),(s*1.15,5.545,.217),.032,.027)
            boss(s*.90,5.67,.389,.056,'accent')
            # The two closed fists meet over the grip. Each finger has three planes.
            for j in range(4):
                x=s*(.057+j*.062)
                y=4.12-.11*j/3+.038*s
                rod('stone',(x,y+.104,.624),(x+s*.016,y+.032,.707),.051,.054,7)
                rod('stone',(x+s*.016,y+.032,.707),(x+s*.005,y-.06,.686),.053,.038,7)
                boss(x,y+.072,.66,.046)
            rod('stone',(s*.205,4.21,.57),(s*.061,4.208+.045*s,.654),.065,.057,8)
            # Boot lames overlap towards the toe, leaving the ankle in shadow.
            for j in range(3):
                loft('stone',[(s*.41,1.075+j*.072,.39-j*.08,.219,.197),
                              (s*.41,1.138+j*.072,.37-j*.08,.205,.164),
                              (s*.413,1.164+j*.072,.344-j*.08,.184,.139)],10)
            relief_half('stone',[(.202,3.77,.33),(.38,3.85,.369),(.43,3.46,.39),(.39,2.94,.39),
                        (.27,2.51,.395),(.19,2.67,.40)],(.29,3.14,.458))
        panel('accent',[(0,5.38),(.114,5.207),(.072,5.02),(0,4.89),(-.082,5.02),(-.115,5.21)],.622,.145,.014,.94,.076)
        # Longitudinal crest continues behind the skull in profile.
        helm_rows=[]
        for y,z,w,d in [(6.44,.309,.055,.078),(6.565,.263,.075,.124),(6.71,.138,.073,.156),(6.84,-.006,.05,.161),(6.945,-.15,.012,.045)]:
            helm_rows.append([(-w,y,z),(0,y,z+d),(w,y,z),(0,y,z-d)])
        shell('metal',helm_rows)
        # Sword fuller: two sloping blade faces and a central ridge.
        relief('stone',[(0,1.035,.574),(.232,1.52,.544),(.192,3.76,.572),(.13,3.89,.60),
                      (0,3.83,.67)],(.068,2.99,.689))
        relief('metal',[(0,1.035,.574),(-.232,1.52,.544),(-.192,3.76,.572),(-.13,3.89,.60),
                      (0,3.83,.67)],(-.062,2.99,.684))
        for j in range(4):
            rod('metal',(0,4.28+j*.055,.537),(0,4.302+j*.055,.537),.086,.088)
    if version>=6:
        for s in (-1,1):
            # Fasteners and burnished hems delineate the articulated stone armour.
            def piping(points,rad,mat):
                for a,b in zip(points,points[1:]):
                    rod(mat,(s*a[0],a[1],a[2]),(s*b[0],b[1],b[2]),rad,rad,6)
            piping([(.06,5.48,.462),(.275,5.66,.382),(.46,5.77,.273),(.55,5.83,.18)],.036,'metal')
            piping([(.16,4.88,.495),(.37,5.02,.57),(.59,5.14,.485),(.72,5.28,.349)],.023,'metal')
            piping([(.55,5.59,.296),(.71,5.56,.383),(.89,5.63,.405)],.017,'accent')
            for j in range(2):
                y=5.13+j*.182
                piping([(.72,y+.02,.343),(.91,y+.045,.393),(1.077,y+.035,.284),(1.14,y+.01,.13)],.025,'metal')
            piping([(.64,4.56,.35),(.54,4.45,.45),(.40,4.35,.51)],.034,'metal')
            # A fluted cuisse hangs either side of the sword. The raised spine ends at the poleyn.
            relief_half_pts=[(.34,3.64,.438),(.48,3.75,.37),(.64,3.63,.29),
                             (.57,3.18,.30),(.43,2.77,.338),(.33,2.92,.421)]
            relief('stone',[(s*x,y,z) for x,y,z in relief_half_pts],(s*.425,3.33,.512))
            piping([(.36,3.59,.454),(.33,3.32,.465),(.35,2.94,.434),(.424,2.78,.348)],.022,'metal')
            piping([(.25,2.38,.281),(.39,2.52,.362),(.55,2.43,.296)],.026,'metal')
            piping([(.385,2.09,.308),(.418,1.81,.311),(.403,1.40,.273)],.026,'metal')
            boss(s*.463,3.60,.439,.054,'accent')
            # Two narrow bindings catch the bevels at the ends of the tassets.
            piping([(.26,3.84,.354),(.43,3.87,.362),(.61,3.83,.295)],.026,'metal')
    return

for sign in (-1,1):
    part='Sentinel_'+('west' if sign<0 else 'east')
    offset=V([sign*3.79,0,-2.075])
    yaw=-sign*.115
    if version>=5:
        offset=V([sign*2.96,0,-1.64])
        yaw=-sign*.34
    guard()
offset=V([0.,0.,0.]); yaw=0.
part='Hearth'
for ri,ro,y0,y1,mat,n in [(1.26,1.60,-.075,.07,'stone',14),(1.19,1.25,.002,.081,'metal',12),(.89,1.18,-.04,.066,'stone',12),(.82,.885,-.008,.076,'metal',10)]:
    for i in range(n):
        a=2*pi*(i+.5)/n
        gap=(.03 if mat=='stone' else .014)/ro/2
        wedge(mat,ri,ro,a+gap,a+2*pi/n-gap,y0,y1,.011,steps=6)
loft('metal',[(0,-.06,0,.83,.83),(0,.023,0,.83,.83)],48,.60)
for i in range(9 if version<4 else 0):
    t=i*2*pi/9
    rod('metal',(.16*sin(t+.30),.049,-.16*cos(t+.30)),(.83*sin(t),.049,-.83*cos(t)),.035,.048,6,.88)
loft('glow',[(0,.029,0,.19,.18),(.018,.076,0,.22,.178),(-.018,.112,.028,.103,.11)],7)
if version>=4:
    # Low bed of fractured slag. Only the fissures below the crust emit light.
    rng=np.random.default_rng(2809)
    for k,(inner,outer,n) in enumerate([(.15,.405,7),(.409,.774,11)]):
        for i in range(n):
            a=2*pi*(i+.32*k)/n
            b=a+2*pi/n
            points=[]
            for f,r,twist in [(0,inner,.20),(0,outer,0),(.53,outer,.015),(1,outer,0),(1,inner,.20),(.48,inner,.22)]:
                t=a+(b-a)*f+twist
                points.append(V([r*sin(t),-r*cos(t)]))
            cen=np.mean(points,axis=0)
            gap=.107 if k==0 else .074
            points=[v*(1-gap)+cen*gap for v in points]
            top=[(v[0],rng.uniform(.058,.082),v[1]) for v in points]
            tip=(cen[0]+.025,rng.uniform(.089,.115),cen[1]-.015)
            for j,u in enumerate(top):
                v=top[(j+1)%len(top)]
                face('metal' if (k+i)%4!=2 else 'stone',[u,v,tip],(0,1,0),.87)
                face('accent',[u,v,(v[0],.031,v[2]),(u[0],.031,u[2])],
                     (u[0]-cen[0],0,u[2]-cen[1]),.69)
            if (i+k)%3!=1:
                # One tapering heat vent follows the bend between neighbouring coals.
                poly=[(r*sin(t),.047,-r*cos(t)) for r,t in [(inner,a+.20-.04),(outer,a-.018),(outer,a+.018),(inner,a+.20+.04)]]
                face('glow',poly,(0,1,0),.62)
    # Narrow lips, expansion keys and recessed rivets divide the concentric bands.
    for i in range(12):
        t=i*2*pi/12
        wedge('accent',1.203,1.232,t+.012,t+2*pi/12-.012,.078,.088,.002,.85,8)
        wedge('metal',1.287,1.53,t-.037,t+.037,.068,.086,.006)
        r=1.40
        rod('accent',(r*sin(t),.083,-r*cos(t)),(r*sin(t),.095,-r*cos(t)),.032,.026,8,.87)
part='Ember_runnel' 
# Stair nosings in the terrain end at radii 4.60, 5.13 and 5.63.
# Follow the treads and risers. Thin surfaces sit just above the existing mesh.
angle=.55
profile=[(4.26,.068),(4.625,.068),(4.637,-.222),(5.147,-.222),(5.16,-.476),(5.652,-.476),(5.663,-.724),(5.76,-.724)]
if version>=5:
    # The terrain rises between the separate stone nosings. Follow its smoothstep
    # section and step over the three exposed lips without breaking the flow.
    radii=[4.24,4.43,4.60,4.625,4.64,4.78,4.91,5.08,5.13,5.15,5.28,5.40,5.54,5.63,5.65,5.78,5.92,6.035,6.085]
    profile=[]
    for r in radii:
        t=min(1.,max(0.,(r-4.6)/1.5))
        h=-.75*t*t*(3.-2*t)
        tread=.035 if r<=4.625 else (-.25 if r<=5.13 else (-.50 if r<=5.63 else -.75))
        profile.append((r,max(tread+.022,h+.041)))
def channel_point(r,y,w):
    return (r*sin(angle)+w*cos(angle),y,r*cos(angle)-w*sin(angle))
for (ra,ya),(rb,yb) in zip(profile,profile[1:]):
    for l,r,dy,mat in [(-.16,.16,0,'water'),(-.194,-.16,.009,'metal'),(.16,.194,.009,'metal')]:
        p=[channel_point(rr,yy+dy,w) for rr,yy,w in [(ra,ya,l),(ra,ya,r),(rb,yb,r),(rb,yb,l)]]
        face(mat,p,(sin(angle),1,cos(angle)))

if version>=5:
    for r,y in (profile[0],profile[3],profile[8],profile[13]):
        for s in (-1,1):
            p=channel_point(r,y+.012,s*.19)
            rod('metal',p,(p[0],p[1]+.021,p[2]),.052,.037,8)
# Interleaved, indexed glTF primitives. Exact vertex sharing preserves hard bevels.
def save():
    data=bytearray()
    doc={'asset':{'version':'2.0','generator':'Ember Court architectural model'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'materials':[],'buffers':[{}],'bufferViews':[],'accessors':[]}
    def view(raw,target,stride=None):
        while len(data)%4: data.append(0)
        result={'buffer':0,'byteOffset':len(data),'byteLength':len(raw),'target':target}
        if stride: result['byteStride']=stride
        data.extend(raw); doc['bufferViews'].append(result)
        return len(doc['bufferViews'])-1
    def accessor(idx,offset,count,kind,ctype,**extra):
        doc['accessors'].append(dict(bufferView=idx,byteOffset=offset,count=count,type=kind,componentType=ctype,**extra))
        return len(doc['accessors'])-1
    materials=list(dict.fromkeys(m for _,m in groups))
    for m in materials: doc['materials'].append({'name':m})
    count=0; bounds=[]
    for (name,m),verts in groups.items():
        array=np.array(verts,dtype='<f4')
        unique,idx=np.unique(array,axis=0,return_inverse=True)
        pos=unique[:,:3]; bounds.append([pos.min(0),pos.max(0)])
        buf=view(unique.tobytes(),34962,36)
        p=accessor(buf,0,len(pos),'VEC3',5126,min=pos.min(0).tolist(),max=pos.max(0).tolist())
        n=accessor(buf,12,len(pos),'VEC3',5126)
        c=accessor(buf,24,len(pos),'VEC3',5126)
        idx=idx.astype('<u2' if len(pos)<65536 else '<u4')
        ix=accessor(view(idx.tobytes(),34963),0,idx.size,'SCALAR',5123 if idx.itemsize==2 else 5125)
        label=name+'_'+m
        node=len(doc['nodes'])
        doc['scenes'][0]['nodes'].append(node)
        doc['nodes'].append({'mesh':node,'name':label})
        doc['meshes'].append({'name':label,'primitives':[{'attributes':{'POSITION':p,'NORMAL':n,'COLOR_0':c},'indices':ix,'material':materials.index(m)}]})
        count+=idx.size//3
    while len(data)%4: data.append(0)
    doc['buffers'][0]['byteLength']=len(data)
    js=json.dumps(doc,separators=(',',':')).encode()
    js+=b' '*(-len(js)%4)
    raw=struct.pack('<4sII',b'glTF',2,28+len(js)+len(data))+struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(data),b'BIN\x00')+data
    (ROOT/'out/spawn_foe.glb').write_bytes(raw)
    print(count,'triangles', np.min(np.array(bounds)[:,0],axis=0),np.max(np.array(bounds)[:,1],axis=0))
save()
