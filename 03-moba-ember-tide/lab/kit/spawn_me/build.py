"""从任务目录运行 Blender -b -P build.py。建模坐标与游戏一致，Y 向上。"""
import bpy
import bmesh
import json
import struct
import math
import random
from collections import defaultdict
from pathlib import Path
from mathutils import Vector
from math import sin, cos, pi, sqrt

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'out'
OUT.mkdir(exist_ok=True)
rng = random.Random(421)
mats = ['stone', 'metal', 'accent', 'water', 'crystal', 'glow']
data = defaultdict(lambda: [[], [], [], []])
part = 'Gate'
origin = (0, 0, 0)
pivot = {}
offset = (0, 0, .94)
yaw = 0
scale = 1

def place(p):
    x,y,z = p
    return Vector((offset[0]+scale*(x*cos(yaw)+z*sin(yaw)),offset[1]+scale*y,
                   offset[2]+scale*(-x*sin(yaw)+z*cos(yaw))))

def mesh(verts, faces, mat, bevel=0, tone=1, smooth=False):
    """每个石块先独立倒角，再把同材质几何写入一个绘制批次。"""
    bm = bmesh.new()
    vv = [bm.verts.new(p) for p in verts]
    for indices in faces:
        bm.faces.new([vv[i] for i in indices])
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    if bevel:
        edges=[e for e in bm.edges if e.is_manifold and e.calc_face_angle()>.3]
        if edges:
            bmesh.ops.bevel(bm,geom=edges,offset=bevel,segments=1,affect='EDGES',clamp_overlap=True)
    bm.normal_update()
    if mat=='water' and sum(f.normal.y*f.calc_area() for f in bm.faces)<0:
        bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
        bm.normal_update()
    heights=[v.co.y for v in bm.verts]
    lo,hi=min(heights),max(heights)
    pos,nrm,col,idx=data[(part,mat)]
    cache={}
    # 共面多边形先求法线，避免三角化后石料大面出现对角折痕。
    for f in bm.faces:
        if f.normal.length_squared<1e-12:
            continue
        pts=list(f.verts)
        if len(pts)==3:
            tris=[(0,1,2)]
        else:
            from mathutils.geometry import tessellate_polygon
            tris=tessellate_polygon([[v.co for v in pts]])
        ids=[]
        for v in pts:
            n=v.normal if smooth else f.normal
            co=v.co.copy()
            if part.startswith('Sentinel') and offset[1]==0:
                co.z*=.72
            p=place(co)-Vector(origin)
            if part.startswith('Sentinel') and offset[1]==0:
                n=Vector((n.x,n.y,n.z/.72)).normalized()
            normal=(n.x*cos(yaw)+n.z*sin(yaw), n.y, -n.x*sin(yaw)+n.z*cos(yaw))
            h=(v.co.y-lo)/max(.001,hi-lo)
            lum=max(.50,min(1., tone*(.86+.14*min(1.,h*3))*(.96+.04*max(0,n.y))*(.75 if n.y<-.67 else 1)))
            key=tuple(round(t,6) for t in (*p,*normal,lum))
            if key not in cache:
                cache[key]=len(pos); pos.append(tuple(p)); nrm.append(normal); col.append((lum,)*3)
            ids.append(cache[key])
        for a,b,c in tris:
            ab=pts[b].co-pts[a].co
            ac=pts[c].co-pts[a].co
            if ab.cross(ac).length_squared>1e-20:
                idx.extend((ids[a],ids[b],ids[c]))
    bm.free()
    pivot[part]=origin

def loft(rings,mat='stone',bev=0,tone=1,smooth=False):
    n=len(rings[0]); k=len(rings)
    faces=[list(range(n-1,-1,-1)),list(range((k-1)*n,k*n))]
    faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
              for j in range(k-1) for i in range(n)]
    mesh([p for row in rings for p in row],faces,mat,bev,tone,smooth)

def ellipse(x,y,z,a,b,n,phase=0):
    return [(x+a*cos(phase+2*pi*i/n),y,z+b*sin(phase+2*pi*i/n)) for i in range(n)]

def turning(rows,mat='stone',n=12,bev=0,tone=1,phase=0,smooth=False):
    loft([ellipse(*r,n,phase) for r in rows],mat,bev,tone,smooth)

def polygon(points,z0,z1,mat='stone',bev=0,tone=1):
    loft([[(x,y,z) for x,y in points] for z in (z0,z1)],mat,bev,tone)

def rail(path,r,mat='metal',n=7,tone=1):
    pts=list(map(Vector,path)); rings=[]
    for i,p in enumerate(pts):
        d=(pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)]).normalized()
        ref=Vector((0,0,1)) if abs(d.z)<.9 else Vector((1,0,0))
        a=d.cross(ref).normalized(); b=d.cross(a).normalized()
        rad=r[i] if isinstance(r,list) else r
        rings.append([p+rad*(a*cos(2*pi*k/n)+b*sin(2*pi*k/n)) for k in range(n)])
    loft(rings,mat,0,tone)

def shield(outline, zbase, relief, mat,bev=.011,tone=1, ridge=None):
    # 凸起的盾面、护胫、盔面和垂片共享同一条雕刻工序。
    outline=[tuple(p) for p in outline]
    cx=sum(p[0] for p in outline)/len(outline); cy=sum(p[1] for p in outline)/len(outline)
    n=len(outline); ridge=ridge or (cx,cy)
    vs=[(x,y,zbase) for x,y in outline]+[(x,y,zbase+.035) for x,y in outline]+[(*ridge,zbase+relief)]
    fs=[list(range(n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[(n+i,n+(i+1)%n,2*n) for i in range(n)]
    mesh(vs,fs,mat,bev,tone)

def sector(cx,cz,r0,r1,a,b,y0,y1,mat='stone',bev=.012,n=4,tone=1):
    # 以截面沿圆弧放样，径向端面之间保留真实空隙。
    rings=[]
    for i in range(n+1):
        t=a+(b-a)*i/n
        rings.append([(cx+r*cos(t),y,cz+r*sin(t)) for r,y in ((r0,y0),(r1,y0),(r1,y1),(r0,y1))])
    loft(rings,mat,bev,tone)

def courses(cx,cz,r0,r1,y0,y1,count,mat='stone',phase=0,gap=.031,bev=.014,tone=1):
    for i in range(count):
        a=2*pi*i/count+phase; d=gap/(r0+r1)
        sector(cx,cz,r0,r1,a+d,a+2*pi/count-d,y0,y1,mat,bev,5,tone*rng.uniform(.95,1))

# 双侧削角门柱；拱券的两端与柱头同宽。
def jamb(s,y,w,zf,zb):
    c=s*1.94
    return [(c+x,y,z) for x,z in [(-w/2+.12,zb),(w/2-.12,zb),(w/2,zb+.13),(w/2,zf-.15),(w/2-.13,zf),(-w/2+.13,zf),(-w/2,zf-.15),(-w/2,zb+.13)]]

for s in (-1,1):
    for l,h,w0,w1,z in [(-.34,.15,1.19,1.21,-3.53),(.18,.4,1.19,1.06,-3.53),(.435,.61,1.1,.99,-3.6),
                          (.645,1.30,.98,.88,-3.68),(1.332,2.04,.88,.81,-3.68),(2.072,2.74,.81,.8,-3.68),
                          (2.772,3.39,.80,.86,-3.68)]:
        loft([jamb(s,l,w0,z,-4.88),jamb(s,h,w1,z,-4.88)],bev=.031,tone=rng.uniform(.90,1))
    # 青铜内衬和金线延续到拱顶。
    for x,width,z,mat in [(1.62,.16,-3.62,'metal'),(1.72,.047,-3.60,'accent'),(2.15,.07,-3.655,'metal')]:
        polygon([(s*(x-width/2),.43),(s*(x+width/2),.43),(s*(x+width/2),3.42),(s*(x-width/2),3.42)],z-.15,z,mat,.012)
    for l,h,w in [(.17,.22,1.2),(.43,.49,1.09)]:
        loft([jamb(s,l,w,-3.507,-4.89),jamb(s,h,w,-3.507,-4.89)],'metal',.01)
    shield([(s*x,y) for x,y in [(1.73,.45),(1.86,.54),(2.13,1.86),(2.11,2.75),(2.04,2.64),(1.91,1.49)]],-3.67,.11,'stone')

# 门槛只铺在洞口进深内，靠后的一排伸入墙角。
for k,(z0,z1) in enumerate([(-6.45,-5.60),(-5.57,-4.59),(-4.56,-3.54)]):
    cuts=[-1.60,-.64,.43,1.60] if k%2 else [-1.60,-1.02,-.03,1.08,1.60]
    for x0,x1 in zip(cuts,cuts[1:]):
        loft([[(x0+.016,y,z0),(x1-.016,y,z0),(x1-.016,y,z1),(x0+.016,y,z1)]
              for y in [-.24,.065]],bev=.018,tone=rng.uniform(.9,1))
def archpt(t,inner,outer,u,z):
    r=inner+(outer-inner)*u
    return (r*cos(t),3.405+(r*1.11)*sin(t)+.35*sin(t)**5,z)

def archivolt(inner,outer,zback,zfront,count,mat,gap,bev):
    for j in range(count):
        a=pi*j/count+gap/(inner+outer); b=pi*(j+1)/count-gap/(inner+outer)
        rows=[]
        for i in range(5):
            t=a+(b-a)*i/4
            rows.append([archpt(t,inner,outer,u,z) for u,z in [(0,zback),(1,zback),(1,zfront),(0,zfront)]])
        loft(rows,mat,bev,rng.uniform(.94,1))
archivolt(1.54,2.35,-4.87,-3.685,13,'stone',.032,.028)
archivolt(1.53,1.70,-3.75,-3.605,9,'metal',.026,.013)
archivolt(1.697,1.75,-3.73,-3.593,9,'accent',.015,.009)
archivolt(2.115,2.18,-3.74,-3.647,13,'metal',.025,.008)

# 门额及侧肋由削尖的石材和弯曲铜条交叠，截面向外张开。
for s in (-1,1):
    for coords in [
        [(2.00,.52),(2.47,.49),(2.36,1.37),(2.23,2.28),(2.06,1.66)],
        [(2.07,1.78),(2.24,2.38),(2.39,2.04),(2.34,3.19),(2.18,3.95),(2.00,3.18)],
        [(2.00,3.30),(2.19,4.08),(2.31,3.63),(2.21,4.57),(1.90,5.36),(1.73,5.54),(1.74,4.93)],
        [(1.69,5.06),(1.72,5.65),(1.98,5.30),(1.65,5.94),(1.17,6.30),(.83,6.42),(.98,5.99)]]:
        shield([(s*x,y) for x,y in coords],-3.738,.275,'stone',.027,.98)
    rail([(s*1.76,.52,-3.59),(s*1.76,2.70,-3.59),(s*1.75,3.54,-3.59),
          (s*1.63,4.28,-3.59),(s*1.28,4.97,-3.59),(s*.83,5.41,-3.59),(s*.34,5.68,-3.56)],
         [.064,.064,.078,.108,.11,.14,.14],'metal',8)
    for j in range(4):
        t=.20+j*.31
        x,y,z=archpt(t,1.82,1.82,0,-3.57)
        shield([(s*(x-.032),y),(s*x,y+.052),(s*(x+.034),y),(s*x,y-.054)],z,.057,'accent',.006)
    # 柱脚的铜靴提起侧肋，细金棱随折线转向。
    shield([(s*u,y) for u,y in [(1.52,.45),(1.86,.48),(2.20,.45),(2.33,.52),(2.28,.80),
            (2.18,.68),(2.10,1.18),(1.99,.75),(1.90,.64),(1.64,.67)]],-3.63,.169,'metal',.015)
    rail([(s*1.62,.633,-3.57),(s*1.90,.608,-3.48),(s*2.04,.762,-3.49),(s*2.103,1.16,-3.57)],
         [.018,.029,.021,.005],'accent',7)
    # 后侧扶壁在墙顶上方收分，背面深入两墙交接处。
    for a,b,w0,w1 in [(-.50,.48,.81,.78),(.51,1.42,.78,.70),(1.45,2.38,.70,.63),(2.41,3.32,.63,.55),(3.35,4.13,.55,.31)]:
        loft([[(s*(1.72+xx*width),yy,zz) for xx,zz in [(-.5,-6.28),(.5,-6.28),(.55,-4.72),(-.55,-4.72)]]
              for yy,width in [(a,w0),(b,w1)]],bev=.033)
# 新月以菱形截面的曲面塑造；边缘沿主曲线收尖。
for s in (-1,1):
    blade=[(0,6.16,.37,.35),(.42,6.18,.39,.37),(.88,6.29,.36,.34),(1.34,6.52,.31,.29),
           (1.72,6.82,.255,.24),(1.99,7.20,.202,.205),(2.16,7.62,.145,.146),(2.20,8.00,.088,.095),(2.16,8.32,.046,.052),(2.08,8.60,.008,.008)]
    rows=[]; lip=[]; bands=[]; underside=[]
    for i,(x,y,w,d) in enumerate(blade):
        p=blade[max(0,i-1)]; q=blade[min(len(blade)-1,i+1)]
        dx,dy=q[0]-p[0],q[1]-p[1]; L=math.hypot(dx,dy); nx,ny=-dy/L,dx/L
        w*=1.18 if i<7 else 1.08
        d*=1.17
        bands.append([(s*(x+nx*w*a),y+ny*w*a,-3.91+d*b) for a,b in
                     [(.96,.09),(.75,.58),(.285,.88),(.32,.82),(.81,.40)]])
        underside.append((s*(x-nx*w*.505),y-ny*w*.505,-3.91+d*.75))
        rows.append([(s*(x+nx*w*a),y+ny*w*a,-3.91+d*b) for a,b in [(1,0),(.68,.60),(-.30,1),(-1,0),(-.34,-.85),(.63,-.80)]])
        lip.append((s*(x+nx*w*.65),y+ny*w*.65,-3.91+d*.64))
    loft(bands,'accent',.006,.91)
    rail(underside,[max(.003,w*.080) for x,y,w,d in blade],'metal',8)
    loft(rows,'metal',.012);rail(lip,[max(.004,w*.135) for x,y,w,d in blade],'accent')
shield([(-.64,6.25),(-.36,6.52),(0,6.72),(.36,6.52),(.64,6.25),(.39,5.95),(0,5.43),(-.39,5.95)],-3.78,.37,'metal',.024)
for s in (-1,1):
    rail([(s*.49,6.24,-3.40),(s*.36,6.37,-3.38),(0,6.63,-3.46)],[.036,.047,.023],'accent')
    rail([(s*.49,6.24,-3.40),(s*.30,5.93,-3.34),(0,5.56,-3.44)],[.051,.047,.023],'accent')
# 包围冠石的叶状铜爪；底下的楔尖把新月和拱券扣合。
for s in (-1,1):
    shield([(s*u,y) for u,y in [(.25,6.37),(.54,6.49),(.78,6.43),(1.15,6.49),
          (.95,6.27),(.67,6.19),(.46,6.02)]],-3.67,.295,'metal',.015,ridge=(s*.63,6.34))
    shield([(s*u,y) for u,y in [(.28,5.98),(.54,6.12),(.60,6.26),(.71,6.16),(.60,5.97),
           (.37,5.86),(0,5.48),(.12,5.81)]],-3.53,.16,'metal',.014)
    rail([(s*.95,6.35,-3.51),(s*.71,6.29,-3.358),(s*.53,6.33,-3.39)],[.015,.03,.012],'accent',7)
part='crystal_Lunette'; origin=(0,6.08,-2.44)
turning([(0,5.68,-3.38,.025,.025),(0,6.07,-3.38,.32,.29),(0,6.30,-3.38,.26,.25),(0,6.48,-3.38,.06,.06)],'crystal',6,0,1,.29)
origin=(0,0,0);offset=(0,0,0)

# 墙身沿两段圆弧从门柱转向两面城墙。
for s in (-1,1):
    part='Exedra_W' if s<0 else 'Exedra_E'
    def wallpt(t,rad,y):
        taper=max(0,min(1,(t-.94)/.27))
        advance=1.06+.52*sin(pi*max(0,min(1,(t-.38)/.79)))
        return (s*rad*sin(t),y*1.105-.34*taper*taper*min(1,max(0,y)/3.3),-.23-rad*cos(t)+advance)
    def wallblock(a,b,ri,ro,l,h,mat,bv):
        rows=[]
        for j in range(5):
            t=a+(b-a)*j/4
            rows.append([wallpt(t,r,y) for r,y in [(ri,l),(ro,l),(ro,h),(ri,h)]])
        loft(rows,mat,bv,rng.uniform(.92,1))
    start=.405; end=1.13
    for row,(l,h,ri,ro,mat) in enumerate([(-.73,.19,4.55,5.15,'stone'),(.221,.56,4.52,5.16,'stone'),(.591,1.31,4.60,5.10,'stone'),
                   (1.341,2.00,4.61,5.09,'stone'),(2.031,2.70,4.61,5.09,'stone'),(2.731,2.99,4.54,5.13,'stone'),
                   (3.025,3.12,4.50,5.15,'metal'),(3.133,3.30,4.51,5.15,'metal')]):
        cuts=[start]+[start+(i+(.5 if row%2 else 0))*(end-start)/5 for i in range(0,6) if 0<(i+(.5 if row%2 else 0))<5]+[end]
        for a,b in zip(cuts,cuts[1:]):
            wallblock(a+.003,b-.003,ri,ro,l,h,mat,.024)
    for j,t in enumerate([.70,1.085]):
        for l,h,ri in [(-.64,.42,4.36),(.45,1.26,4.41),(1.29,2.10,4.43),(2.13,2.94,4.46),(2.97,3.32,4.38)]:
            wallblock(t-.059,t+.059,ri,5.18,l,h,'stone',.032)
        wallblock(t-.065,t+.065,4.35,5.19,3.35,3.46,'metal',.019)

# 守门甲士。各层环截面分别控制头、肩、髋、护腿和衣褶。
def guardian(side):
    global part,offset,yaw,scale
    part='Sentinel_W' if side<0 else 'Sentinel_E'
    offset=(side*2.99,0,-1.82); yaw=-side*.105
    for r0,r1,l,h,n in [(.95,1.10,-.53,.12,9),(.99,1.047,.152,.42,8),(.93,1.08,.455,.65,9)]:
        courses(0,0,.39,r1,l,h,n,phase=l,bev=.023)
    turning([(0,.42,0,1.049,1.049),(0,.461,0,1.05,1.05)],'metal',24,.009)
    courses(0,0,.238,.975,.57,.687,8,phase=.2,bev=.014)
    turning([(0,.57,0,.213,.213),(0,.687,0,.213,.213)],n=10,bev=.011)
    scale=1.095
    offset=(side*2.99,-.065,-1.82)
    for s in (-1,1):
        # 足尖、靴口、护胫、膝甲。
        x=s*.32; z=.10 if s==side else -.08
        turning([(x,.685,z+.13,.225,.38),(x,.79,z+.15,.23,.38),(x,1.02,z,.177,.22)],bev=.022,n=10)
        turning([(x,.96,z,.15,.17),(x,1.34,z,.19,.198),(x,1.68,z,.21,.205),(x*.9,1.82,z,.17,.18)],n=9,bev=.018)
        def plate(out,zp,depth,mat='stone',tone=1):
            shield([(x+u,y) for u,y in out],z+zp,depth,mat,.012,tone)
        plate([(-.155,1.62),(0,1.76),(.156,1.62),(.09,1.15),(0,1.01),(-.10,1.14)],.122,.16)
        plate([(-.175,1.78),(-.11,1.90),(.02,1.96),(.17,1.82),(.13,1.67),(0,1.57),(-.12,1.66)],.13,.175,'metal')
        turning([(x,1.76,z,.16,.18),(x*.91,2.21,z-.02,.25,.24),(x*.66,2.65,-.02,.25,.24)],n=10,bev=.017)
    # 披风外缘和内缘一同放样，底边的褶幅最大。
    rows=[]
    for y,w,d,fold in [(.78,.75,.43,.10),(1.07,.73,.44,.12),(1.94,.67,.43,.09),(2.84,.53,.35,.05),(3.66,.66,.37,.045),(4.13,.74,.32,.03)]:
        outer=[]; inner=[]
        for j in range(35):
            t=-.23+j*(pi+.46)/34; wave=cos(t*16+.3*y)*fold
            yy=y+(.10*cos(8*t) if y<.8 else 0); xx=(w+wave)*cos(t); zz=-(d+wave)*sin(t)-.08
            outer.append((xx,yy,zz));inner.append((xx*.87,yy,zz*.85))
        rows.append(outer+inner[::-1])
    loft(rows,'stone',.009,.85)
    # 从腰带垂下的正面裙甲，留出两条腿的轮廓。
    for s in (-1,1):
        shield([(s*u,y) for u,y in [(.04,2.78),(.46,2.75),(.59,2.39),(.64,1.86),(.51,1.46),(.28,1.89),(.17,2.31)]],.13,.195,'stone')
    shield([(-.21,2.82),(.19,2.82),(.165,2.20),(.12,1.73),(-.04,1.52),(-.18,1.83)],.25,.102,'metal',.015,.89)
    turning([(0,2.64,0,.44,.30),(0,2.83,0,.43,.31),(0,3.07,-.01,.39,.32),(0,3.59,-.02,.57,.36),
             (0,3.93,-.02,.61,.355),(0,4.16,-.05,.40,.27),(0,4.23,-.05,.26,.22)],n=14,bev=.023)
    for y,w in [(2.81,.455),(2.91,.431)]:
        turning([(0,y,0,w,.325),(0,y+.066,0,w+.01,.337)],'metal',14,.011)
    for s in (-1,1):
        shield([(s*u,y) for u,y in [(.015,3.88),(.30,4.06),(.53,3.93),(.54,3.64),(.32,3.41),(.02,3.28)]],.255,.23,'stone')
        rail([(s*.51,3.66,.322),(s*.32,3.45,.413),(s*.035,3.29,.347)],[.022,.028,.012],'accent')
    turning([(0,4.085,-.025,.31,.25),(0,4.19,-.035,.295,.25),(0,4.25,-.04,.21,.20)],'metal',12,.012)
    # 带眉脊的全覆式头盔；两颊护片间露出深处的面罩。
    turning([(0,4.20,-.015,.16,.18),(0,4.34,0,.238,.239),(0,4.58,-.015,.262,.252),(0,4.78,-.055,.19,.20),(0,4.91,-.08,.068,.11)],'stone',12,.018)
    shield([(-.207,4.59),(0,4.67),(.207,4.59),(.16,4.37),(0,4.285),(-.16,4.37)],.17,.097,'metal',.009,.66)
    for s in (-1,1):
        shield([(s*u,y) for u,y in [(.015,4.80),(.14,4.78),(.252,4.62),(.226,4.48),(.05,4.53),(0,4.46)]],.187,.14,'stone')
        shield([(s*u,y) for u,y in [(.077,4.46),(.235,4.50),(.225,4.31),(.136,4.20),(.058,4.33)]],.18,.092,'stone')
    shield([(-.066,4.78),(0,5.33),(.075,5.05),(.12,4.75),(0,4.58)],-.035,.18,'metal')
    # 兵器着地，双臂在胸前合拢；单侧肩甲较高。
    # 偏高的左肩和回收的手肘形成两种不同的负形。
    pole=side*.56
    for s in (-1,1):
        near=s==side
        shoulder=Vector((s*.53,3.95,-.04))
        elbow=Vector((s*(.68 if near else .71),3.12 if near else 3.45,.155 if near else .11))
        hand=Vector((pole,3.27 if near else 3.62,.53))
        wrist=hand+Vector((-side*.14,-.035,-.018))
        rail([shoulder,elbow.lerp(shoulder,.58),elbow],[.214,.204,.143],'metal',10,.82)
        rail([elbow,elbow.lerp(wrist,.44),wrist],[.147,.144,.102],'metal',10,.83)
        for start,end,ra,rb in [(0,.53,.189,.169),(.56,.87,.161,.120)]:
            rail([elbow.lerp(wrist,start),elbow.lerp(wrist,end)],[ra,rb],'stone',9)
        rail([elbow.lerp(wrist,.86),elbow.lerp(wrist,.95)],[.134,.126],'metal',10)
        rail([elbow,elbow.lerp(shoulder,.16)],[.185,.19],'stone',9)
        turning([(s*.59,3.76,-.055,.278,.295),(s*.585,3.96,-.052,.31,.32),
                 (s*.55,4.13,-.08,.19,.225),(s*.54,4.21,-.12,.075,.10)],'stone',10,.018)
        # 三层护片盖住肱骨，尖端向外下方张开。
        for dy,spread,mat in [(-.26,.065,'metal'),(-.15,.036,'stone'),(0,0,'stone')]:
            pts=[(s*(u+spread),y+dy) for u,y in [(.355,3.98),(.40,4.115),(.54,4.24),(.64,4.37),
                    (.68,4.18),(.81,4.045),(.895,3.79),(.75,3.80),(.64,3.70),(.55,3.81)]]
            shield(pts,.145-.09*abs(dy),.195,mat,.016,ridge=(s*.63,4.035+dy))
        rail([(s*.396,4.104,.202),(s*.54,4.243,.201),(s*.64,4.365,.190)],[.019,.024,.008],'accent',6)
        # 护手由腕板、掌板和握住矛柄的指节组成。
        rail([wrist,hand],[.125,.131],'stone',9)
        shield([(pole+u,hand.y+v) for u,v in [(-.14,.04),(-.10,.135),(.061,.14),(.126,.072),(.09,-.04),(-.094,-.073)]],
               .504,.121,'stone',.008)
        for k in range(4):
            yy=hand.y+.064-k*.049
            rail([(pole+side*.085,yy,.54),(pole+side*.076,yy,.604),(pole-side*.015,yy-.018,.628),
                  (pole-side*.052,yy-.029,.602)],[.035,.036,.033,.025],'stone',7,.96)
    rail([(pole,.70,.55),(pole,4.53,.55)],[.042,.046],'metal',10)
    for y in [.73,2.94,3.90,4.34,4.45]:
        rail([(pole,y,.55),(pole,y+.051,.55)],[.069,.065],'accent',9)
    shield([(pole-.031,4.46),(pole-.17,4.64),(pole-.10,4.84),(pole+.045,5.33),(pole+.078,4.95),
            (pole+.142,4.74),(pole+.095,4.55),(pole+.038,4.46)],.506,.115,'metal',.009)
    rail([(pole-.14,4.65,.556),(pole-.066,4.87,.582),(pole+.043,5.317,.548)],[.021,.024,.003],'accent',6)
    # 头盔有可见的眉弓、鼻梁、下颌和向后弯的冠脊。
    for s in (-1,1):
        rail([(s*.217,4.555,.247),(s*.146,4.554,.281),(s*.057,4.516,.299)],[.017,.024,.009],'accent',6)
        shield([(s*.06,4.43),(s*.17,4.452),(s*.20,4.402),(s*.128,4.257),(s*.072,4.296)],
               .217,.089,'metal',.009,.84)
    shield([(-.041,4.62),(0,4.71),(.043,4.62),(.029,4.445),(0,4.406),(-.031,4.45)],.284,.066,'stone',.005)
    crest=[(0,4.77,.015,.085,.12),(0,4.93,-.035,.105,.185),(0,5.10,-.126,.091,.18),
           (0,5.31,-.242,.054,.113),(0,5.54,-.33,.008,.016)]
    turning(crest,'stone',8,.009)
    rail([(0,4.82,.154),(0,5.06,.076),(0,5.31,-.136),(0,5.53,-.318)],[.035,.034,.018,.004],'accent',7)
    for s in (-1,1):
        shield([(s*.058,4.492),(s*.176,4.535),(s*.155,4.509),(s*.062,4.474)],.285,.025,'glow',.002,.71)
    # 分节腹甲和斜叠裙片把上身和行走中的腿区分开。
    for y,h,w in [(3.18,.125,.395),(3.04,.112,.392)]:
        shield([(-w,y+.082),(-w*.50,y+.044),(0,y+.015),(w*.50,y+.044),(w,y+.082),
               (w*.90,y-.014),(0,y-h),(-w*.90,y-.014)],.233,.135,'stone',.011,.88)
    for s in (-1,1):
        shield([(s*u,y) for u,y in [(.14,2.78),(.40,2.72),(.52,2.49),(.51,2.28),(.433,2.12),
                (.293,2.29),(.20,2.50)]],.244,.113,'stone',.013)
        rail([(s*.425,2.16,.304),(s*.314,2.33,.349),(s*.235,2.48,.333)],
             [.011,.021,.008],'metal',7)
    # 颈甲下的短披领与斜向胸肋把盔面、胸甲分开。
    shield([(-.29,4.124),(-.15,4.185),(0,4.14),(.15,4.185),(.29,4.124),(.19,3.974),
            (0,3.885),(-.19,3.974)],.182,.19,'metal',.012)
    for s in (-1,1):
        for dy in [0,-.16]:
            shield([(s*u,y+dy) for u,y in [(.04,3.38),(.31,3.48),(.45,3.54),(.39,3.37),(.15,3.24),(.025,3.25)]],
                   .27+dy*.20,.11,'metal' if dy else 'stone',.014,.94)
    shield([(-.11,2.95),(0,3.043),(.11,2.95),(.09,2.82),(0,2.76),(-.09,2.82)],.33,.072,'accent',.009)
    # 独立长袍褶从两髋垂下，衣角外翻，露出持矛侧的靴子。
    for s in (-1,1):
        for j in range(2):
            d=j*.14
            pts=[(s*(u+d),y) for u,y in [(.29,2.79),(.405,2.69),(.44,2.30),(.47,1.73),(.59,1.12+j*.19),
                  (.53,.90+j*.23),(.395,1.21),(.33,1.66)]]
            shield(pts,.107-j*.14,.115,'stone',.013,.89+j*.03)
    offset=(0,0,0);yaw=0;scale=1
for side in (-1,1): guardian(side)

# 泉眼、分块池沿与径向溢流口。水面略高于实心地形。
part='Basin'
for ri,ro,y,n,phase in [(1.736,1.82,.071,18,0),(1.85,2.132,.085,19,.077),(2.158,2.304,.061,24,.13)]:
    courses(0,0,ri,ro,-.105,y,n,phase=phase,bev=.011)
courses(0,0,1.709,1.738,-.06,.075,20,'metal',gap=.013,bev=.006)
courses(0,0,2.133,2.153,-.025,.074,20,'accent',gap=.011,bev=.004)
# 微起伏池面，以环向和斜交波纹改变游戏光照下的高光。
def water_grid():
    n=144; nr=39; vs=[(0,.016,0)]; fs=[]
    for k in range(1,nr+1):
        r=1.721*k/nr
        for j in range(n):
            t=2*pi*j/n; x=r*cos(t); z=r*sin(t)
            wave=sin(r*29+1.6*sin(3*t+r)+.8*sin(10*x-5*z))
            y=.022+.011*wave+.005*sin(19*x+9*z)+.0028*sin(23*z-11*x)
            vs.append((x,y,z))
            a=1+(k-1)*n+j; b=1+(k-1)*n+(j+1)%n
            fs.append((0,b,a) if k==1 else (a-n,b-n,b,a))
    mesh(vs,fs,'water',smooth=True)
# 水下浅石底隔开通透水面与场景底色。
courses(0,0,.26,1.716,-.053,.002,18,phase=.062,bev=.004)
turning([(0,-.029,0,.245,.245),(0,.002,0,.245,.245)],n=36)
water_grid()
# 池心的小星标和不闭合的波峰与水面保持同心。
for j in range(4):
    yaw=j*pi/2+.15
    loft([[(-.056,y,.03),(0,y,.23 if j%2==0 else .16),(.056,y,.03),(0,y,-.01)] for y in (.026,.036)],'glow',.002)
yaw=0
# 不连续的波峰有陡缓两面，在不同角度反射日光。
for k,(rad,parts) in enumerate([(.44,4),(.83,5),(1.21,5),(1.56,6)]):
    for j in range(parts):
        start=2*pi*(j+.08+rng.uniform(0,.23))/parts+k*.74
        span=rng.uniform(.35,.79)*2*pi/parts
        rows=[]
        for m in range(19):
            u=m/18; t=start+u*span
            r=rad+.033*sin(3*t+k*.49)+.014*sin(7*t+.4)
            w=.027*(.04+.96*sin(pi*u)**.67)
            rows.append([((r+w*dr)*cos(t),.014+w*dy,(r+w*dr)*sin(t)) for dr,dy in
                        [(-1,0),(-.25,.73),(.18,1),(.54,.81),(1.18,0)]])
        loft(rows,'water',0,1,True)
# 池沿四个方位的包铜尖饰压在石缝上，前端指向水晶。
for j in range(4):
    yaw=j*pi/2
    ext=.26 if j%2==0 else .17
    for mat,dy,k in [('metal',.086,1),('accent',.100,.65)]:
        poly=[(0,1.78),(-.056*k,1.963),(-.117*k,2.073),(-.066*k,2.146),(0,2.30+ext*k),(.066*k,2.146),(.117*k,2.073),(.056*k,1.963)]
        loft([[(x,y,z) for x,z in poly] for y in (dy-.018,dy+.008)],mat,.004)
yaw=0
part='Overflow'
yaw=.99
def chute():
    rows=[]
    profile=[(2.295,.038),(3.1,.031),(4.35,.057),(4.55,.067),(4.625,.071),(4.656,.034),(4.82,.023),(4.98,-.023),(5.09,-.065),(5.135,-.099),(5.16,-.147),
                (5.24,-.184),(5.36,-.202),(5.394,-.216),(5.432,-.304),(5.54,-.364),(5.60,-.395),
                (5.647,-.419),(5.674,-.485),(5.77,-.503),(5.806,-.533),(5.84,-.620),(5.94,-.668),(5.99,-.690),(6.012,-.720),(6.025,-.739)]
    for r,y in profile:
        row=[]
        for j in range(15):
            flare=max(0,min(1,(r-4.19)/.44))
            x=(j/14-.5)*(.21+.064*(r-2.3)/3.72+.115*flare)
            row.append((x,y+.008*sin(j*1.7+r),r+.011*cos(j*3+r)))
        rows.append(row)
    vs=[p for row in rows for p in row]; fs=[(k*15+j,k*15+j+1,(k+1)*15+j+1,(k+1)*15+j) for k in range(len(rows)-1) for j in range(14)]
    mesh(vs,fs,'water',smooth=True)
    for s in (-1,1):
        rail([(s*.131,.045,2.29),(s*.143,.049,3.5),(s*.17,.080,4.50),(s*.18,.043,4.616)],[.021,.025,.035,.024],'metal',8)
        # 贴阶槽壁分三块，壁面向下盖住坡面和踏步的接缝。
        for start,end in [(4.42,5.09),(5.12,5.61),(5.64,5.93)]:
            def level(r):
                for (a,ya),(b,yb) in zip(profile,profile[1:]):
                    if a<=r<=b:
                        return ya+(yb-ya)*(r-a)/(b-a)
            side_rows=[]
            for r in [start]+[r for r,y in profile if start<r<end]+[end]:
                y=level(r); w=.24-.047*(r-4.42)/1.51
                side_rows.append([(s*(w+dx),y+dy,r) for dx,dy in
                                 [(-.043,-.026),(-.027,.029),(.038,.041),(.096,-.007),(.080,-.17),(-.032,-.17)]])
            loft(side_rows,'stone',.008,.91)
        rail([(s*.17,.085,4.40),(s*.195,.095,4.54),(s*.203,.095,4.64),(s*.204,.041,4.70)],
             [.018,.022,.021,.012],'accent',7)
        # 溢流口的低矮喇叭口和下唇在最高一级踏步内。
        for i in range(3):
            a=4.16+.15*i
            loft([[(s*.176,.015,a),(s*(.27+i*.055),.015,a),(s*(.30+i*.052),.015,a+.12),(s*.172,.015,a+.12)],
                  [(s*.18,.089,a),(s*(.24+i*.051),.113,a),(s*(.26+i*.045),.112,a+.12),(s*.177,.086,a+.12)]],'stone',.008)
chute()
yaw=0

def save():
    import array
    doc={'asset':{'version':'2.0','generator':'Lunette masonry atelier'},'scene':0,
         'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'materials':[],'accessors':[],'bufferViews':[]}
    colors=[(.64,.65,.62),(.23,.36,.31),(.69,.55,.32),(.20,.64,.62),(.24,.80,.76),(.32,.90,.85)]
    for name,base in zip(mats,colors):
        doc['materials'].append({'name':name,'pbrMetallicRoughness':{'baseColorFactor':[*base,1],'metallicFactor':0,'roughnessFactor':.7}})
    buf=bytearray()
    def acc(vals,kind,fmt,ctype,mm=False):
        while len(buf)%4: buf.append(0)
        flat=vals if kind=='SCALAR' else (v for p in vals for v in p)
        raw=array.array(fmt,flat).tobytes(); vi=len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer':0,'byteOffset':len(buf),'byteLength':len(raw),'target':34963 if kind=='SCALAR' else 34962})
        buf.extend(raw); a={'bufferView':vi,'componentType':ctype,'count':len(vals),'type':kind}
        if mm: a.update(min=list(map(min,zip(*vals))),max=list(map(max,zip(*vals))))
        doc['accessors'].append(a);return len(doc['accessors'])-1
    for (name,mat),(p,n,c,i) in data.items():
        prim={'attributes':{'POSITION':acc(p,'VEC3','f',5126,True),'NORMAL':acc(n,'VEC3','f',5126),'COLOR_0':acc(c,'VEC3','f',5126)},
              'indices':acc(i,'SCALAR','H' if len(p)<65536 else 'I',5123 if len(p)<65536 else 5125),'material':mats.index(mat)}
        ix=len(doc['meshes']); label=name+'_'+mat
        doc['meshes'].append({'name':label,'primitives':[prim]})
        doc['nodes'].append({'name':label,'mesh':ix,'translation':pivot[name]});doc['scenes'][0]['nodes'].append(ix)
    while len(buf)%4:buf.append(0)
    doc['buffers']=[{'byteLength':len(buf)}]; j=json.dumps(doc,separators=(',',':')).encode()
    j+=b' '*(-len(j)%4)
    (OUT/'spawn_me.glb').write_bytes(struct.pack('<4sIIII',b'glTF',2,28+len(j)+len(buf),len(j),0x4e4f534a)+j+struct.pack('<II',len(buf),0x004e4942)+buf)
    print('Triangles',sum(len(v[3])//3 for v in data.values()))
save()
