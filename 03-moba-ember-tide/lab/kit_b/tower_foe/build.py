"""用 Blender 的倒角和法线工具从截面建模，按游戏节点写出 Y 向上的 GLB。"""
import json
import math
import random
import struct
from array import array
from pathlib import Path

import bmesh
import bpy

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'out'
TAU = math.tau
MATERIALS = ['stone', 'metal', 'accent', 'glow', 'crystal']


def polar(angle, radius, z, tangent=0):
    # Blender 的 -Y 是游戏里的正面 +Z。
    s, c = math.sin(angle), math.cos(angle)
    return (radius*s + tangent*c, -radius*c + tangent*s, z)


def interp(z, stations):
    for (z0, a), (z1, b) in zip(stations, stations[1:]):
        if z <= z1:
            return a + (b-a)*max(0, (z-z0)/(z1-z0))
    return stations[-1][1]


def mesh(name, verts, faces, material, bevel=0, smooth=True, tone=1, node=None, angle=26):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.000005)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj['slot'] = material
    obj['node'] = node or material + '_fixed'
    obj['tone'] = tone
    if smooth:
        for poly in data.polygons:
            poly.use_smooth = True
        data.set_sharp_from_angle(angle=math.radians(48))
    if bevel:
        mod = obj.modifiers.new('铸边', 'BEVEL')
        mod.width = bevel
        mod.segments = 2 if bevel >= .040 else 1
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(angle)
        mod.harden_normals = True
    if smooth:
        mod = obj.modifiers.new('大面法线', 'WEIGHTED_NORMAL')
        mod.weight = 32
        mod.keep_sharp = True
    return obj


def join_rows(rows, wrap):
    n = len(rows[0])
    verts = [p for row in rows for p in row]
    faces = []
    for j in range(len(rows)-1):
        for k in range(n if wrap else n-1):
            a, b = j*n+k, j*n+(k+1)%n
            faces.append((a,b,b+n,a+n))
    return verts, faces


def turning(name, profile, material, bevel=.045, count=28, tone=1):
    """实心回转件。轮廓从底部向上，杯口可以接着向里、向下折。"""
    rows = [[polar(TAU*k/count, r, z) for k in range(count)] for z,r in profile]
    verts, faces = join_rows(rows, True)
    faces += [tuple(range(count)), tuple(range(len(verts)-count, len(verts)))]
    return mesh(name, verts, faces, material, bevel, tone=tone)


def course(name, bottom, top, r0, r1, n, offset, bevel, apron=False, profile=None):
    gap=.030 if profile else .036
    if profile:
        tones=[.92+.12*k/(n-1) for k in range(n)]
        random.Random(round(bottom*1000)+n*1000).shuffle(tones)
    for i in range(n):
        # 分缝不等宽排列。相邻块共用分界角，倒角内有实体石芯。
        def boundary(k):
            return offset + TAU*k/n + .059*math.sin(TAU*k/n+1.1)
        a0, a1 = boundary(i)+gap/(r0+r1), boundary(i+1)-gap/(r0+r1)
        inside = .30 if apron else min(r0,r1)-.26
        rows=[]
        cuts=[(0,bevel),(.293*bevel,.293*bevel),(bevel,0),
              (top-bottom-bevel,0),(top-bottom-.293*bevel,.293*bevel),(top-bottom,bevel)]
        if profile:
            cuts += [(z-bottom,0) for z,r in profile if bottom+bevel+.015<z<top-bevel-.015]
        for f,inset in sorted(cuts):
            frac=f/(top-bottom)
            z=bottom+f; r=r0+(r1-r0)*frac-inset
            if profile:
                # 一块颈石可以跨过收腰处。块面和扶壁使用同一根塔身母线。
                ref0,ref1=interp(bottom,profile),interp(top,profile)
                r+=interp(z,profile)-(ref0+(ref1-ref0)*frac)
            lo=a0+inset/r*.55; hi=a1-inset/r*.55
            arc=bevel/r
            # 圆角只沿可见外缘布线，石块背面用弦封闭。
            contour=[(lo,inside),(lo,r-bevel),(lo+.28*arc,r-.28*bevel)]
            segments=5 if apron or name=='分节石檐' else 4
            for k in range(segments+1):
                ang=lo+arc+(hi-lo-2*arc)*k/segments
                side=(k/segments*2)%1
                flat=(0 if name=='分节石檐' else (.024 if apron else .052))*(1-abs(side*2-1))
                contour.append((ang,r-flat))
            contour += [(hi-.28*arc,r-.28*bevel),(hi,r-bevel),(hi,inside)]
            rows.append([polar(ang,rad,z) for ang,rad in contour])
        if apron:
            verts,faces=join_rows(rows,True)
            m=len(rows[0])
            faces.extend((tuple(range(m)),tuple(range(len(verts)-m,len(verts)))))
        else:
            # 外侧保留每道倒角。砌石背面埋在实心石柱里，只需一个平面。
            front=[row[1:-1] for row in rows]
            verts,faces=join_rows(front,False)
            m=len(front[0]); last=len(verts)-m
            ba,bb,ta,tb=range(len(verts),len(verts)+4)
            verts.extend((rows[0][0],rows[0][-1],rows[-1][0],rows[-1][-1]))
            faces.extend([(ba,*range(m),bb),(ta,*range(last,last+m),tb),
                          (ba,ta,tb,bb),(ba,*range(0,last+1,m),ta),
                          (bb,*range(m-1,last+m,m),tb)])
        shade=tones[i] if profile else (.955 if apron else .98)+(.045 if apron else .02)*math.cos(i*1.7+offset)
        mesh(name,verts,faces,'stone',tone=shade)
    if apron:
        turning(name+'·石芯',[(bottom,r0-.13),(top-.065,r1-.13)],'stone',0,20,.82)


def ember(name,material,origin,height,width,depth,node=None,large=False,turn=0):
    """七面余烬。切面从不等高的晶肩收向偏心晶尖。"""
    x,y,z=origin
    count=7 if large else 5
    rows=[]
    for lev,(f,scale,dx,dy,twist) in enumerate([
        (0,.27,-.08,0,-.12),(.17,.83,-.045,.015,-.14),
        (.40,1.,-.015,.01,0),(.705,.70,.047,-.032,.23)]):
        if large and lev in (1,3):
            scale+=.10 if lev==1 else .115
        row=[]
        for k in range(count):
            a=TAU*k/count+.15+twist
            v=math.cos(a)*width*.5*scale + dx*width
            w=math.sin(a)*depth*.5*scale + dy*depth
            jitter=0 if lev==0 else (.091 if lev==3 else .053)*math.sin(k*2.15+.9*lev)
            row.append((x+v*math.cos(turn)-w*math.sin(turn),
                        y+v*math.sin(turn)+w*math.cos(turn),z+height*(f+jitter)))
        rows.append(row)
    verts,faces=join_rows(rows,True)
    tip=len(verts); verts.append((x+width*.14,y-depth*.085,z+height))
    faces += [tuple(range(count))]+[(tip,tip-count+i,tip-count+(i+1)%count) for i in range(count)]
    # 部分四边面沿长对角线折出不等宽的晶面。
    triangles=[]
    for j,f in enumerate(faces):
        if large and j in (count+2,count+5,2*count,2*count+3,2*count+5):
            a,b,c,d=(verts[v] for v in f)
            p=[.12*a[k]+.20*b[k]+.48*c[k]+.20*d[k] for k in range(3)]
            radius=math.hypot(p[0]-x,p[1]-y)
            cut=.095*width
            p[0]+=(p[0]-x)*cut/radius
            p[1]+=(p[1]-y)*cut/radius
            at=len(verts); verts.append(tuple(p))
            triangles.extend((f[k-1],f[k],at) for k in range(4))
        elif len(f)==4 and j%3:
            a,b,c,d=f
            triangles += [(a,b,d),(b,c,d)]
        else:
            triangles.append(f)
    if large:
        # 按实际顶点包围盒定晶宽，保持上一版包围盒中心与节点原点之间的偏移。
        lo=min(p[0] for p in verts); hi=max(p[0] for p in verts)
        ymin=min(p[1] for p in verts); ymax=max(p[1] for p in verts)
        centers={1.45:(-.0092875,-.008596),1.60:(-.010768,-.0099665),1.80:(-.012114,-.011213)}
        cx,cy=centers[width]
        verts=[(cx+(px-(hi+lo)/2)*width/(hi-lo),cy+(py-(ymax+ymin)/2)*depth/(ymax-ymin),pz)
               for px,py,pz in verts]
    mesh(name,verts,triangles,material,smooth=False,node=node)


def band(name,z,r,h,material,lip=.075):
    edge=min(.055,h*.24)
    turning(name,[(z-h/2,r-.09),(z-h/2+edge,r),
                  (z+h/2-edge,r+lip*.4),(z+h/2,r-lip)],
            material,min(.047,h*.16))


def buttress(angle, tier, top, radius, ledges):
    # 截面沿圆周弯曲，宽脚的两个角和中脊都落在碰撞圆以内。
    curved=tier>1
    stations=[
        (.30,.72,.30,1.829,.37),(.40,.75,.30,1.848,.37),
        (.79,.75,.30,1.848,.36),(.87,.75,.30,1.837,.33),
        (1.10,.75,.30,1.799,.265),(1.31,.64,.29,1.802,.16),
        (1.61,.51,.275,1.754,.005),(1.91,.39,.26,radius(1.91)+.15,-.14),
        (2.24,.30,.235,radius(2.24)+.13,-.178),
    ]
    for z in ledges:
        if z>2.24:
            stations.extend([(z-.27,.30,.225,radius(z-.27)+.096,-.065),
                             (z-.10,.32,.24,radius(z)+.215,-.062),
                             (z+.105,.33,.245,radius(z)+.215,-.060),
                             (z+.29,.30,.22,radius(z+.29)+.088,-.055)])
    stations.extend([(top-.67,.30,.22,radius(top-.67)+.075,-.06),
                     (top-.37,.35,.26,radius(top-.37)+.15,-.055),
                     (top-.22,.44,.28,radius(top-.22)+.18,-.035),
                     (top-.08,.39,.255,1.27,.0),(top,.37,.245,1.245,.0)])
    rows=[]
    section=[(-.43,-1),(.43,-1),(.50,-.82),(.50,-.35),(.29,-.11),
             (-.045,0),(-.31,-.12),(-.50,-.36),(-.50,-.80)]
    for z,w,d,r,sweep in sorted(stations):
        rows.append([polar(angle+((sweep if curved else 0)+u*w)/r,r+d*v,z)
                     for u,v in section])
    verts,faces=join_rows(rows,True)
    n=len(section)
    faces.extend((tuple(range(n)),tuple(range(len(verts)-n,len(verts)))))
    obj=mesh('铁扶壁',verts,faces,'metal',.046)
    # 铁脚背面埋在砌石里。只对外露折边生成圆倒角。
    bm=bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    weights=bm.edges.layers.float.new('bevel_weight_edge')
    for edge in bm.edges:
        back=all(v.index%n in (0,1,2,8) for v in edge.verts)
        edge[weights]=float(not back and edge.calc_face_angle(0)>math.radians(26))
    bm.to_mesh(obj.data)
    bm.free()
    obj.modifiers['铸边'].limit_method='WEIGHT'
    levels=sorted(stations)
    shelf=ledges[-1] if tier>1 else ledges[0]
    rows=[]
    for dz,w,lift in [(-.32,.048,.018),(-.22,.125,.026),(-.07,.16,.031),(.06,.154,.018)]:
        z=shelf+dz
        r=interp(z,[(l[0],l[3]) for l in levels])
        x=interp(z,[(l[0],l[4]) for l in levels]) if curved else 0
        rows.append([polar(angle+(x+u*w)/r,r+d+lift,z) for u,d in
                     [(-.51,-.035),(.51,-.035),(.51,0),(.06,.024),(-.51,0)]])
    v,fs=join_rows(rows,True)
    fs.extend([(0,1,2,3,4),tuple(range(len(v)-5,len(v)))])
    mesh('铁肘陶面',v,fs,'accent',.014)


def fascia(z0,z1,radius,angle,windows):
    """赤陶带的窗洞与外壳共用边界，发光面位于内壁之后。"""
    mid=(z0+z1)/2
    zs=[z0,z0+.035,mid-.175,mid+.175,z1-.035,z1] if windows else [z0,z0+.035,mid-.06,mid+.06,z1-.035,z1]
    phases=[(angle+k*TAU/32)%TAU for k in range(32)]
    half=.060/(radius((z0+z1)/2)+.06)
    for a in windows:
        phases.extend(((a-half)%TAU,(a+half)%TAU))
    phases=sorted(set(phases))
    sizes=[.020,.055,.060,.060,.055,.020]
    verts=[]; faces=[]; n=len(phases); h=len(zs)
    for back in [False,True]:
        for j,z in enumerate(zs):
            for a in phases:
                verts.append(polar(a,radius(z)+(-.026 if back else sizes[j]),z))
    def face_id(back,j,k):
        return (back*h+j)*n+k%n
    for k,a in enumerate(phases):
        b=phases[(k+1)%n]
        mid=(a+(b-a)%TAU/2)%TAU
        is_window=any(abs(math.remainder(mid-w,TAU))<half for w in windows)
        for j in range(h-1):
            if is_window and j==2:
                for y in (j,j+1):
                    faces.append((face_id(0,y,k),face_id(0,y,k+1),face_id(1,y,k+1),face_id(1,y,k)))
                continue
            faces.append((face_id(0,j,k),face_id(0,j,k+1),
                          face_id(0,j+1,k+1),face_id(0,j+1,k)))
        for j in (0,h-1):
            faces.append((face_id(0,j,k),face_id(0,j,k+1),face_id(1,j,k+1),face_id(1,j,k)))
        if any(abs(abs(math.remainder(a-w,TAU))-half)<1e-6 for w in windows):
            faces.append((face_id(0,2,k),face_id(1,2,k),face_id(1,3,k),face_id(0,3,k)))
    mesh('赤陶宽带',verts,faces,'accent',.014,angle=38)
    mid=(z0+z1)/2
    for offset in [-.48,.88,1.99,2.76,4.04,5.17]:
        a=angle+offset
        rows=[]
        for half,depth in [(.125,-.006),(.125,.016),(.085,.050)]:
            row=[]
            edge=half-.009
            for x,y in [(-edge,-half),(edge,-half),(half,-edge),(half,edge),
                        (edge,half),(-edge,half),(-half,edge),(-half,-edge)]:
                z=mid+y; r=radius(z)+.06
                row.append(polar(a+x/r,r+depth,z))
            rows.append(row)
        v,fs=join_rows(rows,True); fs.extend([tuple(range(8)),tuple(range(16,24))])
        mesh('饰带方印',v,fs,'accent')
    for a in windows:
        rows=[]
        for z in (zs[2]-.006,zs[3]+.006):
            r=radius(z)+.014
            rows.append([polar(a+u/r,r+d,z) for u,d in
                        [(-.064,-.023),(.064,-.023),(.064,.003),(-.064,.003)]])
        v,fs=join_rows(rows,True)
        fs.extend([(0,1,2,3),(4,5,6,7)])
        mesh('炉窗内芯',v,fs,'glow')


def pierced_claw(angle,z0,height,reach):
    # 前爪横跨两侧铁轨，内轮廓的四个角形成 35 × 55 厘米的通孔。
    eye=.57*height
    levels=[(0,1.03,.275,0),(.14*height,1.17,.33,0),
            (.28*height,1.29,.205,0),(eye-.275,1.335,.22,0),
            (eye,1.31,.35,.175),(eye+.275,1.33,.223,0),
            (.84*height,reach-.09,.155,0),(.94*height,reach+.02,.10,0),
            (height,reach-.008,.028,0)]
    table=[]
    for dz,r,w,gap in levels:
        depth=.28 if dz<.84*height else .195
        front=.5*depth
        table.append([[polar(angle,r+dr,z0+dz,side*x)
                       for x,dr in [(gap,-front),(w,-front),(w,front-.030),
                                    (gap+(w-gap)*.42,front if gap else front-.008),
                                    (gap,front-.030 if gap else front)]]
                      for side in (-1,1)])
    verts=[]; faces=[]
    for side in (0,1):
        v,fs=join_rows([row[side] for row in table],True)
        off=len(verts); verts.extend(v)
        for j,face in enumerate(fs):
            station,edge=divmod(j,5)
            if edge==4 and levels[station][3]==0 and levels[station+1][3]==0:
                continue
            faces.append(tuple(off+k for k in face))
        faces.extend([tuple(off+k for k in range(5)),tuple(off+len(v)-5+k for k in range(5))])
    mesh('菱眼前爪',verts,faces,'metal',.050)


def flame_claw(a,z0,h,reach,hand):
    # 两条轮廓分别控制爪背和内刃。中段是宽的镰形铸片，内刃在肩上折回。
    back=reach+.20
    stations=[
        # 高度、内缘、外缘、横向厚度、横向弯曲、板面扭转
        (0,.89,1.17,.52,0,0),(.10,.89,1.33,.53,.02,.14),
        (.235,1.05,back-.11,.37,.09,.26),(.365,1.22,back,.315,.18,.31),
        (.485,1.38,back+.012,.28,.27,.30),(.585,1.35,back-.015,.27,.30,.28),
        (.66,1.13,back-.055,.30,.27,.26),(.705,1.16,back-.095,.29,.25,.23),
        (.77,1.34,back-.135,.26,.20,.19),(.85,1.39,back-.09,.245,.13,.18),
        (.915,reach-.10,back-.09,.22,.055,.14),
        (.965,reach-.036,back-.105,.18,-.035,.11),
        (1,reach-.05,reach+.018,.112,-.095,.055)]
    section=[(0,-.26),(.09,-.44),(.64,-.50),(.91,-.35),(1,-.10),
             (.92,.50),(.71,.50),(.5,.50),(.29,.50),(.08,.50),(.02,.22)]
    rows=[]
    for f,inner,outer,thickness,sweep,twist in stations:
        row=[]
        for u,v in section:
            r=inner+(outer-inner)*u
            crown=.030*max(0,1-((u-.5)/.42)**2) if v==.50 else 0
            tan=thickness*v+crown+hand*(sweep+twist*(u-.5))
            row.append(polar(a+tan/r,r,z0+f*h))
        rows.append(row)
    verts,faces=join_rows(rows,True); n=len(section)
    faces.extend([tuple(range(n)),tuple(range(len(verts)-n,len(verts)))])
    mesh('火焰弯爪',verts,faces,'metal',.050,angle=28)


def forged_shoe(a,foot):
    # 横向包住脚圈的方扣。上沿向内收，顶面露在赤陶带上方。
    section=[(1.50,.055),(1.755,.045),(1.84,.115),(1.841,.295),
             (1.827,.35),(1.771,.50),(1.708,.545),(1.50,.56)]
    rows=[[polar(a+side*.142,r,foot+h) for r,h in section] for side in (-1,1)]
    v,fs=join_rows(rows,True); n=len(section)
    fs.extend([tuple(range(n)),tuple(range(n,2*n))])
    mesh('脚箍方扣',v,fs,'metal',.046)


def cradle(base,opening):
    # 三段截面沿同一圈顶点接合，陶沿占最上方 8 厘米。
    count=32
    sections=[
        ('托晶铁碗','metal',[(.83,0),(.867,.025),(.916,.105),(.955,.20),
                           (.981,.295),(.987,.37),(.987,.42)]),
        ('铁碗陶沿','accent',[(.987,.42),(.996,.43),(1.,.444),(1.,.479),
                           (.990,.493),(.977,.5),(opening+.022,.5),(opening,.486),
                           (opening-.018,.465)]),
        ('铁碗内壁','metal',[(opening-.018,.465),(opening-.055,.384),
                            (opening-.125,.26),(.48,.10),(.36,.068)])
    ]
    for i,(name,material,profile) in enumerate(sections):
        rows=[[polar(TAU*k/count,r,base+z) for k in range(count)] for r,z in profile]
        verts,faces=join_rows(rows,True)
        if i==0:
            faces.append(tuple(reversed(range(count))))
        elif i==2:
            faces.append(tuple(range(len(verts)-count,len(verts))))
        mesh(name,verts,faces,material)


def stud(a,z,r,scale):
    # 大面朝外的小晶块嵌入塔颈，后端在石内。
    border=[(-.115,-.031),(-.072,-.095),(.055,-.087),(.121,-.011),(.057,.096),(-.051,.09)]
    v=[polar(a,r-.045,z+y*scale,x*scale) for x,y in border]
    v += [polar(a,r+.045,z+y*scale,x*scale) for x,y in border]
    v.append(polar(a,r+.111,z+.016,0))
    fs=[tuple(range(6))]
    for k in range(6):
        j=(k+1)%6
        fs.extend([(k,j,j+6,k+6),(k+6,j+6,12)])
    mesh('嵌颈余烬',v,fs,'crystal',smooth=False,node='inset_embers')


def make_tower(t):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    i=t-1
    target=[7.2,8.8,10.6][i]
    foot=[.19,.38,.57][i]
    outer=[1.895,2.595,3.195][i]
    steps=[[outer],[outer,2.11],[outer,2.53,1.845]][i]
    for j,rad in enumerate(steps):
        course('阶石',j*.19,(j+1)*.19,rad,rad-.025,6,.30+j*.54,.043,True)
    root=1.75; neck=[1.05,1.10,1.15][i]
    claw_h=[1.70,1.90,2.20][i]
    claw_floor=target-claw_h
    end=claw_floor-.43
    sections=[[foot,2.67,end],[foot,2.39,4.20,end],
              [foot,2.47,4.26,6.05,end]][i]
    ledges=sections[1:-1]
    profile=[(.30,root),(max(.41,foot+.09),root),(.72,1.731),(1.25,1.669+.012*i),
             (end*.53,1.402+.022*i),(end-1.11,neck+.042),
             (end-.59,neck-.115),(end-.30,neck-.108),(end,neck)]
    radius=lambda z: interp(z,profile)
    course_no=0
    for lo,hi in zip(sections,sections[1:]):
        count=round((hi-lo)/1.03)
        for j in range(count):
            bottom=lo+(hi-lo)*j/count+.015
            top=lo+(hi-lo)*(j+1)/count-.015
            lower=radius(bottom)-(.135 if j==0 and lo>foot else 0)
            upper=radius(top)-(.062 if j==count-1 and hi<end else 0)
            course('塔身方石',bottom,top,lower,upper,5+(t==3),
                   .01+(course_no%2)*.54+.13*course_no,.057,profile=profile)
            course_no+=1
    turning('实心石芯',[(foot,radius(foot)-.14)]+[(z,r-.14) for z,r in profile if z>foot],
            'stone',0,22,.85)
    for j,z in enumerate(ledges):
        r=radius(z)
        course('分节石檐',z-.10,z+.10,r+.16,r+.16,5+(t==3),.24+j*.36,.05)
    angle=-.63 if t==1 else .12
    skirt=max(foot,.33)
    turning('落地铁座',[(skirt,1.68),(skirt+.045,1.785),(.665,1.766),(.70,1.683)],
            'metal',.031,28)
    turning('束带上沿',[(1.293,radius(1.293)+.018),(1.318,radius(1.318)+.062),
                         (1.364,radius(1.364)+.043),(1.382,radius(1.382)-.036)],
            'metal',.019,28)
    windows=[(angle+x)%TAU for x in [.58,2.26,5.43]] if t>1 else []
    fascia(.70,1.30,radius,angle,windows)
    if t>1:
        upper=3.06 if t==2 else 3.525
        fascia(upper,upper+.40,radius,angle,[])
    for k in range(4):
        buttress(angle+k*math.pi/2,t,end-.04,radius,ledges)
    if t>1:
        for k in range(4):
            forged_shoe(angle+k*math.pi/2+.64,foot-.045)
    # 颈石在铁箍后面封顶，余烬缝位于铁箍与石肩之间。
    turning('封顶颈石',[(end-.20,neck-.08),(end-.065,neck),(end,neck),(claw_floor-.075,neck-.105)],'stone',0,24)
    if t>1:
        turning('束颈铁箍',[(end-.57,neck-.13),(end-.51,neck-.037),
                 (end-.41,neck-.026),(end-.355,neck-.105)],'metal',.032,24)
    band('下颈箍',end-.095,neck+.035,.17,'metal',.038)
    turning('余烬细缝',[(end-.028,neck+.014),(end+.062,neck+.014)],'glow',.015)
    turning('塔冠铁箍',[(claw_floor-.40,1.165),(claw_floor-.335,1.25),
            (claw_floor-.232,1.25),(claw_floor-.187,1.212),
            (claw_floor-.105,1.208),(claw_floor-.071,1.24),(claw_floor,1.10)],'metal',.041)
    if t>1:
        turning('冠箍陶边',[(claw_floor-.207,1.21),(claw_floor-.185,1.242),
                (claw_floor-.120,1.246),(claw_floor-.093,1.214)],'accent',.017,24)
    crown_angle=.48
    n=[5,6,6][i]
    cradle(claw_floor-.040,[.715,.775,.866][i])
    mid=[6.195,7.640000000000001,9.284999999999998][i]
    height=2*(target-mid)
    width=[1.45,1.60,1.80][i]
    ember('主晶','crystal',(0,0,target-height),height,width,width*.94,'crystal',True)
    reach=[1.557,1.582,1.618][i]
    pierced_claw(crown_angle,claw_floor,claw_h,reach)
    for k in range(1,n):
        a=crown_angle+TAU*k/n+(.18 if k==1 else 0)
        hand=1 if k<=n/2 else -1
        flame_claw(a,claw_floor,claw_h,reach,hand)
    count=[5,5,6][i]
    for k in range(count):
        a=TAU*k/count+.36*math.sin(k*2.7)+.42
        z=end-.44+.225*math.sin(k*2.5+i*.5)
        p=polar(a,neck+.54+.067*math.sin(k),z)
        size=.163+.048*(.5+.5*math.cos(k*1.6))
        ember('游离余烬','crystal',p,size,.80*size,.64*size,'ring_embers',turn=a)
    if t>1:
        for k in range(6+(t==3)):
            a=.64+TAU*k/(6+(t==3)); z=end-.78+.03*math.sin(k*1.8)
            stud(a,z,radius(z)+.006,.85+.13*(k%2))
    write_glb(t,mid,end-.39)


def write_glb(t,gem_mid,orbit_mid):
    groups={}
    dg=bpy.context.evaluated_depsgraph_get()
    for obj in bpy.context.scene.objects:
        ev=obj.evaluated_get(dg); data=ev.to_mesh()
        data.calc_loop_triangles()
        name=obj['node']
        if name not in groups:
            groups[name]={'mat':obj['slot'],'rows':[],'indices':[],'keys':{},
                          'pivot':gem_mid if name=='crystal' else orbit_mid if name=='ring_embers' else 0}
        g=groups[name]
        for tri in data.loop_triangles:
            if tri.area < 1e-9:
                continue
            ids=[]
            for li in tri.loops:
                vi=data.loops[li].vertex_index
                x,y,z=data.vertices[vi].co
                nx,ny,nz=data.corner_normals[li].vector.normalized()
                shade=max(.76,min(1.,obj['tone']-.12*max(0.,-nz)-.07*max(0,1-z/.25)))
                if obj['slot']=='stone' and math.hypot(x,y)>.1:
                    outward=(nx*x+ny*y)/math.hypot(x,y)
                    seam=min(1,max(0,(.63-outward)*2))*max(0,1-abs(nz)*1.5)
                    shade=max(.75,shade-.115*seam)
                if obj.name.startswith('塔身方石'):
                    shade=obj['tone']
                elif obj.name.startswith('分节石檐') and tri.normal.z>.966:
                    shade=1.08
                key=tuple(round(float(f),6) for f in (x,z-g['pivot'],-y,nx,nz,-ny,shade))
                v=g['keys'].get(key)
                if v is None:
                    v=len(g['rows']); g['keys'][key]=v; g['rows'].append(key)
                ids.append(v)
            if len(set(ids))==3:
                g['indices'].extend(ids)
        ev.to_mesh_clear()
    doc={'asset':{'version':'2.0','generator':'Jin yu Chao | tower forge'},
         'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],
         'materials':[{'name':s} for s in MATERIALS],'accessors':[],'bufferViews':[]}
    binary=bytearray()
    def accessor(raw,kind,component,shape,count,target,bounds=None):
        binary.extend(bytes(-len(binary)%4))
        offset=len(binary); binary.extend(array(kind,raw).tobytes())
        view=len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(binary)-offset,'target':target})
        item={'bufferView':view,'componentType':component,'count':count,'type':shape}
        if bounds: item['min'],item['max']=bounds
        doc['accessors'].append(item)
        return len(doc['accessors'])-1
    for j,(name,g) in enumerate(groups.items()):
        vs=g['rows']; size=len(vs)
        bounds=([min(v[k] for v in vs) for k in range(3)],[max(v[k] for v in vs) for k in range(3)])
        attrs={'POSITION':accessor((n for v in vs for n in v[:3]),'f',5126,'VEC3',size,34962,bounds),
               'NORMAL':accessor((n for v in vs for n in v[3:6]),'f',5126,'VEC3',size,34962),
               'COLOR_0':accessor((v[6] for v in vs for _ in range(3)),'f',5126,'VEC3',size,34962)}
        ix=accessor(g['indices'],'H',5123,'SCALAR',len(g['indices']),34963)
        doc['meshes'].append({'name':name,'primitives':[{'attributes':attrs,'indices':ix,'material':MATERIALS.index(g['mat'])}]})
        doc['scenes'][0]['nodes'].append(j)
        node={'name':name,'mesh':j}
        if g['pivot']: node['translation']=[0,g['pivot'],0]
        doc['nodes'].append(node)
    binary.extend(bytes(-len(binary)%4))
    doc['buffers']=[{'byteLength':len(binary)}]
    hdr=json.dumps(doc,separators=(',',':')).encode()
    hdr+=b' '*(-len(hdr)%4)
    glb=struct.pack('<4sII',b'glTF',2,28+len(hdr)+len(binary))+struct.pack('<I4s',len(hdr),b'JSON')+hdr+struct.pack('<I4s',len(binary),b'BIN\0')+binary
    path=OUT/f'tower_foe_{t}.glb'
    path.write_bytes(glb)
    print(path.name,sum(len(g['indices'])//3 for g in groups.values()),'triangles',flush=True)


OUT.mkdir(exist_ok=True)
for tier in (1,2,3):
    make_tower(tier)
