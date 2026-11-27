"""Blender 5.2 后台运行。几何直接使用游戏的 Y-up 米制坐标。"""
import array
import json
import math
import struct
from pathlib import Path
from collections import defaultdict
import bmesh
from mathutils import Vector
from math import sin, cos, pi

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'out'
OUT.mkdir(exist_ok=True)
parts = defaultdict(lambda: [[], [], [], []])
node = 'Gate'
pivots = {}
shift = Vector((0, 0, 0))
yaw = 0

def surface(points, faces, mat='stone', bevel=0, tone=1, smoothing=.68, opened=False):
    bm = bmesh.new()
    verts = [bm.verts.new(p) for p in points]
    for face in faces:
        bm.faces.new([verts[i] for i in face])
    if not opened:
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.normal_update()
    if bevel:
        edges = [e for e in bm.edges if e.is_manifold and e.calc_face_angle() > .40]
        if edges:
            bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=3 if bevel >= .054 else 2, affect='EDGES', clamp_overlap=True)
        bm.normal_update()
    pos, norm, col, indices = parts[node,mat]
    low = min(v.co.y for v in bm.verts)
    high = max(v.co.y for v in bm.verts)
    cache = {}
    for tri in bm.calc_loop_triangles():
        triangle = []
        a,b,c = (loop.vert.co for loop in tri)
        if (b-a).cross(c-a).length_squared < 1e-18:
            continue
        for loop in tri:
            f, v = loop.face, loop.vert
            n = Vector((0,0,0))
            for adj in v.link_loops:
                if adj.face.normal.dot(f.normal) > smoothing:
                    n += adj.face.normal * adj.calc_angle()
            n.normalize()
            x,y,z = v.co
            p = Vector((cos(yaw)*x+sin(yaw)*z,y,cos(yaw)*z-sin(yaw)*x)) + shift - Vector(pivots.get(node,(0,0,0)))
            normal = (n.x*cos(yaw)+n.z*sin(yaw), n.y, n.z*cos(yaw)-n.x*sin(yaw))
            h = (v.co.y-low)/max(.001,high-low)
            shade = tone(v.co) if callable(tone) else tone
            value = min(1, max(.72, shade*(.925+.075*min(1,h*4))*(1-.085*max(0,-n.y))))
            key = tuple(round(k,6) for k in (*p,*normal,value))
            if key not in cache:
                cache[key] = len(pos)
                pos.append(tuple(p)); norm.append(normal); col.append((value,)*3)
            triangle.append(cache[key])
        a,b,c = (Vector(pos[i]) for i in triangle)
        if (b-a).cross(c-a).length_squared >= 1e-18:
            indices.extend(triangle)
    bm.free()

def loft(rows,mat='stone',bev=0,tone=1,sm=.68):
    n = len(rows[0])
    last = (len(rows)-1)*n
    faces = [tuple(reversed(range(n))),tuple(range(last,last+n))]
    for j in range(0,last,n):
        faces.extend((j+i,j+(i+1)%n,j+n+(i+1)%n,j+n+i) for i in range(n))
    surface([p for row in rows for p in row],faces,mat,bev,tone,sm)

def oval(rows,mat='stone',n=24,bev=0,tone=1,sm=.68):
    loft([[(x+rx*cos(2*pi*i/n),y,z+rz*sin(2*pi*i/n)) for i in range(n)] for x,y,z,rx,rz in rows],mat,bev,tone,sm)

def block(x,z,w,d,l,h,corner=.12,mat='stone',bev=.045,tone=1):
    a,b=w/2,d/2
    c=min(a*.8,b*.8,corner)
    outline=[(-a+c,-b),(a-c,-b),(a,-b+c),(a,b-c),(a-c,b),(-a+c,b),(-a,b-c),(-a,-b+c)]
    loft([[(x+u,y,z+v) for u,v in outline] for y in (l,h)],mat,bev,tone)

def plate(shape,zb,zf,peak,mat='stone',bev=.025,tone=1):
    # 甲片的前脸收向一道凸脊。保留大片斜面。
    px,py,d=peak
    n=len(shape)
    pts=[(x,y,z) for z in (zb,zf) for x,y in shape] + [(px,py,zf+d)]
    faces=[tuple(range(n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    faces += [(i+n,(i+1)%n+n,2*n) for i in range(n)]
    surface(pts,faces,mat,bev,tone,.87)

def arch_arc(inner,outer,a,b,zb,zf,mat,bev,tone=1):
    steps=max(3,math.ceil((b-a)*16))
    rows=[]
    for j in range(steps+1):
        t=a+(b-a)*j/steps
        rows.append([(r*cos(t),3.37+r*sin(t),z) for r,z in
                     [(inner,zb),(outer,zb),(outer,zf),(inner,zf)]])
    loft(rows,mat,bev,tone)

# 券石实厚，内侧只镶一圈浅铜框。洞内的石材进深露出。
for side in (-1,1):
    x=side*1.725
    for low,high in [(-.40,.39),(.424,1.839),(1.873,3.354)]:
        block(x,-3.48,.65,1.10,low,high,.075,bev=.067)
    block(side*1.605,-3.43,.95,1.28,.015,.18,.085,'accent',.042)
    block(side*1.96,-3.475,.17,1.115,.18,.66,.047,'metal',.040)
for j in range(5):
    gap=.017/1.725
    a=j*pi/5+(gap if j else 0)
    b=(j+1)*pi/5-(gap if j<4 else 0)
    arch_arc(1.40,2.05,a,b,-4.03,-2.93,'stone',.059,.97+.025*(j%2))

for inner,outer,back,front,mat,bv in [(1.10,1.40,-3.065,-2.865,'metal',.043),
                                       (1.40,1.462,-2.966,-2.882,'accent',.017)]:
    arch_arc(inner,outer,0,pi,back,front,mat,bv)
    for side in (-1,1):
        block(side*(inner+outer)/2,(back+front)/2,outer-inner,front-back,.18,3.37,.02,mat,bv)

# 门洞的槛石比台面高六厘米，向后接入城墙拐角。
for z,depth in [(-3.48,1.12),(-4.60,1.05),(-5.63,.94)]:
    block(0,z,2.62,depth,-.26,.060,.08,bev=.034)

# 墙两翼按曲线放样。金边、压顶、踢脚分别连续穿过两层墙石。
for s in (-1,1):
    node='WestWing' if s<0 else 'EastWing'
    def wall(a,b,width,l,h,mat,bev,tone=1):
        rows=[]
        count=math.ceil((b-a)*22)
        for j in range(count+1):
            t=a+(b-a)*j/count
            x=1.91+4.25*t-.50*t*t
            z=-3.59+1.61*t+3.00*t*t+.69*sin(pi*t)**2
            dx,dz=4.25-t,1.61+6*t+.69*pi*sin(2*pi*t)
            length=math.hypot(dx,dz)
            section=[(-width/2,l),(width/2,l),(width/2,h),(-width/2,h)]
            if mat=='metal' and l>2:
                section=[(-width*.48,l),(width*.48,l),(width*.5,l+.11),
                         (width*.42,h-.055),(width*.28,h+.028),(-width*.24,h+.044),
                         (-width*.42,h-.012),(-width*.50,h-.087)]
            rows.append([(s*(x+dz*k/length),y,z-dx*k/length) for k,y in section])
        loft(rows,mat,bev,tone)
    for level,(low,high,cuts) in enumerate([(-.71,.95,[0,.49,1]),(.985,2.10,[0,.29,.72,1])]):
        for k,(a,b) in enumerate(zip(cuts,cuts[1:])):
            wall(a+(.0033 if a else 0),b-(.0033 if b<1 else 0),.80,low,high,'stone',.072,.965+.025*((k+level)%2))
    wall(0,1,.89,-.25,.20,'metal',.079)
    wall(0,1,.95,2.10,2.20,'accent',.026)
    wall(0,1,.94,2.19,2.51,'metal',.073)

# 新月的内弧与外弧分别由三次曲线控制。两面都有宽阔的斜面。
node='LunarCrown'
def bezier(p,t):
    return [p[0][j]*(1-t)**3+3*p[1][j]*t*(1-t)**2+3*p[2][j]*t*t*(1-t)+p[3][j]*t**3 for j in range(2)]
outer=[(0,5.33),(1.94,5.33),(2.78,7.24),(1.72,8.68)]
inner=[(0,6.24),(1.49,6.24),(2.04,7.52),(1.67,8.63)]
def moon_section(t,k,d):
    side=-1 if t<0 else 1
    t=abs(t)
    o=bezier(outer,t); i=bezier(inner,t)
    depth=.34*(1-.50*t**2)
    return (side*(o[0]*(1-k)+i[0]*k),o[1]*(1-k)+i[1]*k,-3.08+d*depth)
profile=[(0,-.42),(0,.32),(.13,.76),(.39,1),(.78,.87),(1,.25),(1,-.39),(.81,-.84),(.35,-.93),(.10,-.76)]
for side in (-1,1):
    loft([[moon_section(side*(.109+.891*j/32),k,d) for k,d in profile] for j in range(33)],'metal',.030)
    rows=[]
    for j in range(27):
        t=.109+.72*j/26; fade=1-(j/27)**4
        rows.append([moon_section(side*t,k,d) for k,d in [(.79,.853),(.79,.906),(.79+.11*fade,.91-.29*fade),(.79+.11*fade,.84-.29*fade)]])
    loft(rows,'accent',.008)

# 新月中心的铜座贯通，前后两面都能看到同一颗晶体。
cy=5.98
outline=[(0,.98),(.71,.135),(.72,-.095),(.43,-.30),(0,-.89),(-.43,-.30),(-.72,-.095),(-.71,.135)]
opening=[(0,.56),(.354,.042),(.349,-.048),(.248,-.174),(0,-.55),(-.248,-.174),(-.349,-.048),(-.354,.042)]
rows=[]
for (x,y),(ix,iy) in zip(outline,opening):
    rows.append([(x,cy+y,-3.23),(x,cy+y,-2.94),(.77*x+.23*ix,cy+.77*y+.23*iy,-2.78),
                 (ix,cy+iy,-2.80),(ix*.95,cy+iy*.95,-2.96),(ix,cy+iy,-3.34),(.76*x+.24*ix,cy+.76*y+.24*iy,-3.36)])
n=len(rows[0])
surface([p for row in rows for p in row],
        [(j*n+k,j*n+(k+1)%n,((j+1)%8)*n+(k+1)%n,((j+1)%8)*n+k) for j in range(8) for k in range(n)],'metal',.035)
node='crystal'
pivots[node]=(0,cy,-3.065)
oval([(0,cy-.585,-3.065,.009,.009),(0,cy-.025,-3.065,.392,.392),(0,cy+.585,-3.065,.009,.009)],'crystal',8,0,1,.99999)

def limb(start,end,radii,tone=1):
    a,b=Vector(start),Vector(end)
    axis=(b-a).normalized()
    u=axis.cross(Vector((0,0,1))).normalized(); v=axis.cross(u)
    rows=[]
    for t,r in radii:
        center=a.lerp(b,t)
        rows.append([center+r*(u*cos(2*pi*j/14)+v*sin(2*pi*j/14)) for j in range(14)])
    loft(rows,'stone',.018,tone)

# 水平剖面用圆角方形控制板甲的正面宽度；正中留一条宽脊接光。
def armour(rows,tone=1):
    rings=[]
    for y,x,z,w,d,point in rows:
        ring=[]
        for j in range(24):
            t=2*pi*j/24
            u,v=cos(t),sin(t)
            sx=math.copysign(abs(u)**.76,u)
            sz=math.copysign(abs(v)**.76,v)
            ring.append((x+w*sx,y-point*max(0,v)**4,z+d*sz))
        rings.append(ring)
    loft(rings,'stone',.018,tone)

for side in (-1,1):
    node='WestKnight' if side<0 else 'EastKnight'
    shift=Vector((side*2.99,0,-1.82))
    yaw=0
    block(0,0,1.10,1.10,0,.60,.12,bev=.075)
    shift += Vector((-side*.065,.60,.14))
    yaw=-side*.22

    # 一整片厚披风，内外表面沿同一条折面走向，相隔 0.12 米。
    rows=[]
    for y,w,z,bow in [(.39,.535,-.375,.216),(.56,.566,-.389,.200),
                        (1.30,.485,-.36,.105),(1.87,.47,-.304,.09),(2.00,.38,-.235,.063)]:
        rear=[]
        for j in range(21):
            u=j/10-1
            fold=.059*(cos(u*pi*2)-1)
            rear.append((w*u,y+(.076*(1-u*u)-.058*u*side if y<.6 else 0),z+bow*u*u+fold))
        rows.append([Vector(p) for p in rear])
    shell=[]
    for k,row in enumerate(rows):
        inner=[]
        for j,p in enumerate(row):
            tangent=row[min(j+1,len(row)-1)]-row[max(0,j-1)]
            up=rows[min(k+1,len(rows)-1)][j]-rows[max(0,k-1)][j]
            inner.append(p+.12*tangent.cross(up).normalized())
        shell.append(row+inner[::-1])
    loft(shell,'stone',.032,.84)

    # 厚靴、护胫和膝部用连续石面连成短腿。
    for s in (-1,1):
        x=.235*s
        z=-.047+.078*s*side
        armour([(0,x,z+.052,.180,.236,0),(.059,x,z+.068,.206,.257,0),
                (.148,x,z+.075,.211,.253,0),(.225,x,z+.040,.191,.216,.018),
                (.284,x,z,.163,.176,.012)],.96)
        def greave_tone(p):
            inside=max(0,min(1,(x-p.x)*s/.15))
            return .99-.19*inside
        armour([(.172,x,z,.154,.168,0),(.32,x,z-.018,.161,.185,.033),
                (.48,x,z-.024,.184,.197,.055),(.655,x,z,.205,.206,.075),(.689,x,z-.012,.177,.179,.05),
                (.743,x,z+.042,.220,.244,.092),(.825,x,z+.032,.212,.246,.058),(.868,x,z,.179,.185,.037),
                (.91,x*.96,z-.025,.190,.183,0),(1.23,x*.89,-.025,.234,.227,0)],greave_tone)
    armour([(.94,0,-.038,.380,.256,.055),(1.13,0,-.035,.429,.279,.026),
            (1.34,0,-.030,.378,.271,0)],.84)
    for s in (-1,1):
        armour([(.814,.250*s,.018,.145,.202,.060),(.910,.244*s,-.005,.209,.238,.070),
                (1.12,.222*s,-.012,.224,.245,.020),(1.24,.209*s,-.017,.207,.245,0)],.92)
    # 从下缘到护颈都是同一块胸甲，胸口向前隆起。
    armour([(1.20,0,-.01,.32,.25,.09),(1.31,0,-.008,.413,.304,.088),
            (1.53,0,-.032,.449,.361,.061),(1.79,0,-.032,.485,.345,.055),
            (1.94,0,-.032,.479,.375,.054),(2.026,0,-.046,.367,.271,.068),
            (2.077,0,-.048,.311,.245,.107),(2.115,0,-.055,.248,.216,.047)])

    for s in (-1,1):
        shoulder=(s*.333,1.95,.004)
        elbow=(s*.450,1.480,.107)
        hand=(s*.044-side*.047,1.698+.151*(s>0),.426)
        limb(shoulder,elbow,[(0,.167),(.28,.191),(.70,.183),(1,.149)],.89)
        limb(elbow,hand,[(0,.144),(.20,.169),(.52,.163),(.81,.122),(1,.114)],.96)
        # 直径 0.55 的圆肩壳，壳边向外翻出一条受光棱。
        rows=[]
        for y,w,d in [(1.77,.213,.224),(1.805,.261,.262),(1.842,.275,.275),
                      (1.909,.269,.271),(2.030,.222,.229),(2.112,.143,.159),(2.142,.061,.085)]:
            rows.append([(s*(.325+w*cos(t)),y-.32*w*cos(t),.013+d*sin(t))
                         for t in (2*pi*j/28 for j in range(28))])
        loft(rows,'stone',.018)
        hx,hy,hz=hand
        armour([(hy-.077,hx,hz,.090,.092,0),(hy-.055,hx,hz,.129,.124,.012),
                (hy+.040,hx,hz+.006,.136,.123,.018),(hy+.086,hx,hz,.106,.101,0)],.93)

    # 面盔是连续壳体，前面的眉檐、眼槽与下颌直接来自截面变化。
    helmet=[]
    for y,w,d,face,drop in [(2.035,.214,.220,.110,.042),(2.125,.274,.238,.124,.068),
                              (2.307,.325,.252,.120,.078),(2.362,.345,.265,.134,.087),
                              (2.383,.343,.264,.034,.084),(2.447,.345,.267,.032,.091),
                              (2.462,.354,.281,.146,.107),(2.505,.359,.286,.135,.101),
                              (2.596,.323,.273,.075,.051),(2.682,.239,.208,.034,.026),
                              (2.730,.136,.134,0,0)]:
        row=[]
        # 面甲左右两侧各有平面；中央鼻梁与眉檐连成一个实体。
        for j in range(32):
            t=2*pi*j/32
            u,v=cos(t),sin(t)
            front=max(0,v)
            brow=max(0,1-abs(u)) if v>0 else 0
            in_slot=2.38<y<2.45
            nose=.13*front**22 if in_slot else .027*front**13
            z=-.086+d*math.copysign(abs(v)**.74,v)+face*brow+nose
            if y<=2.362 and v>0:
                # 护颊成对向中间折起，鼻脊两旁各凹下一道宽槽。
                cheek=max(0,1-abs(abs(u)-.32)/.19)
                z+=.043*front**12-.070*cheek*front
            row.append((w*math.copysign(abs(u)**.90,u),y-drop*brow*1.26,z))
        helmet.append(row)
    def visor_tone(p):
        chin=abs(p.x)<.275 and p.z>.11 and 2.04<p.y<2.38
        return .79 if chin else .98
    loft(helmet,'stone',.012,visor_tone,.91)
    # 盔冠的宽脊朝后扫，前端收为圆鼻，侧视是整块扇形石脊。
    rows=[]
    for z,base,top,w in [(.220,2.58,2.67,.047),(.185,2.60,2.814,.079),
                          (.080,2.64,2.90,.118),(-.08,2.64,2.90,.126),
                          (-.216,2.60,2.857,.111),(-.316,2.55,2.755,.086),
                          (-.385,2.493,2.604,.05)]:
        rows.append([(x*w,y,z-.045) for x,y in [(-.78,base),(.78,base),
                     (1,top-.055),(.60,top),(-.60,top),(-1,top-.055)]])
    loft(rows,'stone',.025)

    shift.x-=side*.047
    sword_z=.406
    loft([[(-w,y,sword_z-.012),(-w*.21,y,sword_z+d),
           (w,y,sword_z+.004),(w*.15,y,sword_z-d)] for y,w,d in
          [(0,.005,.005),(.213,.092,.068),(1.365,.10,.083),(1.50,.10,.064)]],
         'stone',0,1,.98)
    # 剑格从柄下横向挑出，两端朝下，与上方的叠握双手分开。
    plate([(-.311,1.435),(-.305,1.531),(-.149,1.581),(0,1.577),(.149,1.581),
           (.305,1.531),(.311,1.435),(.234,1.470),(.095,1.49),(0,1.464),
           (-.095,1.49),(-.234,1.470)],.346,.483,(0,1.53,.044),bev=.025)
    oval([(0,1.546,sword_z,.067,.070),(0,1.948,sword_z,.066,.070),
          (0,1.974,sword_z,.092,.085),(0,2.034,sword_z,.063,.060),
          (0,2.054,sword_z,.025,.031)],n=16,bev=.015)

shift=Vector((0,0,0))
yaw=0
node='Spring'
# 两道池缘，各圈六块石。水面位于实心地形上方，低于内沿。
for ri,ro,y,phase in [(1.57,1.80,.092,.07),(1.825,2.30,.081,.07+pi/6)]:
    for i in range(6):
        a=i*pi/3+phase+.009; b=(i+1)*pi/3+phase-.009
        rows=[]
        for j in range(14):
            t=a+(b-a)*j/13
            rows.append([(r*cos(t),h,r*sin(t)) for r,h in [(ri,-.09),(ro,-.09),(ro,y-.014),(ro-.045,y),(ri+.039,y),(ri,y-.018)]])
        loft(rows,'stone',.014)
oval([(0,-.08,0,1.59,1.59),(0,.010,0,1.59,1.59)],n=96,tone=.96)
n=96; nr=18
points=[(0,.034,0)]; faces=[]
for k in range(1,nr+1):
    r=1.585*k/nr
    for j in range(n):
        t=j*2*pi/n
        y=.034+.008*sin(12*r+1.3*sin(t*3)+.3*cos(t))*min(1,3*r)
        points.append((r*cos(t),y,r*sin(t)))
        a=1+(k-1)*n+j; b=1+(k-1)*n+(j+1)%n
        faces.append((0,b,a) if k==1 else (a-n,b-n,b,a))
surface(points,faces,'water',opened=True)

# 水纹用薄水面叠出，与游戏的透明水材质一起显示。
for radius,start,span in [(.67,-1.86,2.90),(1.02,.45,2.64),(1.34,-2.85,1.91),(1.46,-.70,1.36)]:
    vertices=[]; faces=[]
    for j in range(29):
        u=j/28
        t=start+span*u
        r=radius+.032*sin(2*t+.8)
        w=.028*(.06+sin(pi*u)**.76)
        vertices.extend([((r+k*w)*cos(t),.048+dy*w,(r+k*w)*sin(t)) for k,dy in [(-1,0),(.13,.36),(1,0)]])
        if j:
            for k in range(2):
                base=(j-1)*3+k
                faces.append((base,base+3,base+4,base+1))
    surface(vertices,faces,'water',opened=True)

node='Spillway'
yaw=1.28
# 出水口位于台外边缘，前脸留出真实的矩形洞。
for s in (-1,1):
    block(s*.264,4.94,.205,.46,-.42,.25,.04,bev=.036)
block(0,4.92,.733,.51,.197,.397,.068,bev=.050)
for side in (-1,1):
    block(side*.192,5.166,.069,.061,-.026,.236,.013,'accent',.012)
block(0,5.166,.451,.061,.206,.261,.011,'accent',.012)
block(0,4.759,.65,.15,-.36,.24,.045,bev=.031)
oval([(0,.385,4.92,.275,.239),(0,.47,4.92,.266,.236)],'metal',24,.022)
oval([(0,.458,4.92,.251,.224),(0,.502,4.92,.249,.216),(0,.593,4.92,.194,.174),(0,.640,4.92,.104,.098),(0,.650,4.92,.043,.04)],bev=.015)
section=[(5.005,.148),(5.115,.146),(5.175,.105),(5.215,-.035),(5.26,-.169),(5.34,-.182),(5.48,-.22),(5.55,-.26),(5.62,-.375),(5.72,-.420),(5.83,-.50),(5.90,-.60),(6.01,-.679)]
rows=[]
for z,y in section:
    rows.append([(x,y+dy,z) for x,dy in [(-.166,-.062),(.166,-.062),(.17,-.016),(.13,.002),(.025,.01),(-.11,.004),(-.17,-.016)]])
loft(rows,'water',.008)
loft([[(-.177,y-.14,z),(.177,y-.14,z),(.177,y-.038,z),(-.177,y-.038,z)] for z,y in section],'stone',.014,.92)
for s in (-1,1):
    loft([[(s*x,y+dy,z) for x,dy in [(.167,-.21),(.29,-.21),(.29,.035),(.264,.077),(.176,.062)]] for z,y in section],'stone',.023)

def save():
    materials=['stone','metal','accent','crystal','water']
    doc={'asset':{'version':'2.0','generator':'Spawn fountain B'},'scene':0,'scenes':[{'nodes':[]}],
         'nodes':[],'meshes':[],'materials':[{'name':m} for m in materials],'accessors':[],'bufferViews':[]}
    buf=bytearray()
    def accessor(values,scalar=False,position=False):
        buf.extend(b'\0'*(-len(buf)%4))
        fmt=('H' if max(values)<65536 else 'I') if scalar else 'f'
        raw=array.array(fmt,values if scalar else (k for v in values for k in v)).tobytes()
        view={'buffer':0,'byteOffset':len(buf),'byteLength':len(raw),'target':34963 if scalar else 34962}
        acc={'bufferView':len(doc['bufferViews']),'componentType':{'H':5123,'I':5125,'f':5126}[fmt],
             'type':'SCALAR' if scalar else 'VEC3','count':len(values)}
        if position: acc.update(min=list(map(min,zip(*values))),max=list(map(max,zip(*values))))
        doc['accessors'].append(acc); doc['bufferViews'].append(view); buf.extend(raw)
        return len(doc['accessors'])-1
    for (name,mat),(p,n,c,idx) in parts.items():
        prim={'attributes':{'POSITION':accessor(p,position=True),'NORMAL':accessor(n),'COLOR_0':accessor(c)},
              'indices':accessor(idx,True),'material':materials.index(mat)}
        i=len(doc['nodes'])
        label=name if name=='crystal' else name+'_'+mat
        doc['nodes'].append({'name':label,'mesh':i,'translation':pivots.get(name,(0,0,0))})
        doc['meshes'].append({'name':label,'primitives':[prim]}); doc['scenes'][0]['nodes'].append(i)
    buf.extend(b'\0'*(-len(buf)%4)); doc['buffers']=[{'byteLength':len(buf)}]
    head=json.dumps(doc,separators=(',',':')).encode(); head+=b' '*(-len(head)%4)
    (OUT/'spawn_me.glb').write_bytes(struct.pack('<4sIIII',b'glTF',2,28+len(head)+len(buf),len(head),0x4e4f534a)+head+struct.pack('<II',len(buf),0x004e4942)+buf)
    print(sum(len(v[3])//3 for v in parts.values()),'triangles')
save()
