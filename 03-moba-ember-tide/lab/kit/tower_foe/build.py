"""生成《烬与潮》烬誓庭塔。长度单位为米，竖轴为 Y。"""
import json
import math
import random
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'out'
TAU = math.tau
PI = math.pi
MATERIALS = ['stone', 'metal', 'accent', 'glow', 'crystal']


def radial(a, r, y):
    return (r * math.sin(a), y, r * math.cos(a))


def sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def unit(a):
    n = math.sqrt(sum(x*x for x in a))
    return tuple(x/n for x in a) if n > 1e-10 else (0, 0, 0)


def mix(a, b, t):
    return a+(b-a)*t


def interp(profile, y):
    for (ya, ra), (yb, rb) in zip(profile, profile[1:]):
        if y <= yb:
            return mix(ra, rb, max(0, (y-ya)/(yb-ya)))
    return profile[-1][1]


class Mesh:
    def __init__(self, material, origin):
        self.mat, self.origin = material, origin
        self.data, self.indices, self.lookup = [], [], {}

    def face(self, points, shade=1, normals=None):
        n = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])))
        if n == (0, 0, 0):
            return
        colors = shade if isinstance(shade, (list, tuple)) else [shade]*len(points)
        ids = []
        for i, p in enumerate(points):
            row = (*sub(p, self.origin), *(normals[i] if normals else n), colors[i])
            k = self.lookup.get(row)
            if k is None:
                k = len(self.data)
                self.lookup[row] = k
                self.data.append(row)
            ids.append(k)
        for j in range(2, len(ids)):
            self.indices.extend((ids[0], ids[j-1], ids[j]))


def signed(poly):
    return sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(poly,poly[1:]+poly[:1]))/2


def inset(poly, d):
    """把轮廓的边沿法线平移，用相邻两边的交点削出倒角。"""
    p = []
    for i,(x,y) in enumerate(poly):
        a,b = poly[i-1], poly[(i+1)%len(poly)]
        e,f = unit((x-a[0],y-a[1])), unit((b[0]-x,b[1]-y))
        k = d/max(.17,1+e[0]*f[0]+e[1]*f[1])
        p.append((x-k*(e[1]+f[1]), y+k*(e[0]+f[0])))
    return p


def curved_panel(poly):
    # 按弧长切片。跨度大的拱板也能贴合圆柱，凹边界处可出现两段。
    xs=sorted(set(round(x,8) for x,_ in poly))
    edges=list(zip(poly,poly[1:]+poly[:1]))
    for left,right in zip(xs,xs[1:]):
        divisions=math.ceil((right-left)/.15)
        for i in range(divisions):
            x0=mix(left,right,i/divisions)
            x1=mix(left,right,(i+1)/divisions)
            mid=(x0+x1)/2
            hits=[]
            for (ax,ay),(bx,by) in edges:
                if min(ax,bx)<mid<max(ax,bx):
                    slope=(by-ay)/(bx-ax)
                    hits.append((ay+slope*(mid-ax),ay+slope*(x0-ax),ay+slope*(x1-ax)))
            hits.sort()
            for (_,l0,l1),(_,h0,h1) in zip(hits[::2],hits[1::2]):
                corners=[(x0,l0),(x1,l1)]
                if h1-l1>1e-7: corners.append((x1,h1))
                if h0-l0>1e-7: corners.append((x0,h0))
                if len(corners)>2: yield corners


class Tower:
    def __init__(self, tier):
        self.t = tier
        self.rng = random.Random(7130+tier)
        self.meshes = {}
        self.h = [7.2,8.8,10.6][tier-1]
        self.steps = [.20,.40,.60][tier-1]
        self.base = [1.50,1.57,1.61][tier-1]
        self.cap = [1.66,2.01,2.35][tier-1]
        self.neck = [4.63,5.78,7.08][tier-1]
        self.bowl = [5.24,6.45,7.79][tier-1]
        self.topr = [1.28,1.39,1.48][tier-1]
        self.n = 6
        self.levels = [[],[3.96],[4.06,5.70]][tier-1]
        self.profile = [(self.steps,self.base),(self.cap-.29,self.base-.085),
                        (self.cap+.13,self.base-.11)]
        stops = [self.cap,*self.levels,self.neck]
        for i,(lo,hi) in enumerate(zip(stops,stops[1:])):
            foot = self.base-.14-.143*i
            head = [1.055,1.10,1.145][tier-1] if hi==self.neck else foot-.105
            self.profile.extend([(lo+.24,foot),(lo+(hi-lo)*.53,head+.045),
                                 (hi-.23,head),(hi+.075,head)])
        self.profile.append((self.bowl,self.profile[-1][1]))

    def mesh(self, name, material, origin=(0,0,0)):
        if name not in self.meshes:
            self.meshes[name] = Mesh(material, origin)
        return self.meshes[name]

    def band(self, name, mat, profile, n=48):
        m = self.mesh(name,mat)
        for (r0,y0,c0),(r1,y1,c1) in zip(profile,profile[1:]+profile[:1]):
            dr,dy = r1-r0,y1-y0
            for j in range(n):
                a,b = j*TAU/n,(j+1)*TAU/n
                m.face([radial(a,r0,y0),radial(b,r0,y0),radial(b,r1,y1),radial(a,r1,y1)],
                       [c0,c0,c1,c1], [unit(radial(q,dy,-dr)) for q in (a,b,b,a)])

    def paving(self):
        m = self.mesh('Stepped_paving','stone')
        outer = [1.90,2.60,3.20][self.t-1]
        for lev in range(self.t):
            radius = outer-lev*[0,.48,.49][self.t-1]
            y = lev*.2
            count = round(radius*TAU/.83)
            inner = radius - ([.56,.62,.68][self.t-1] if lev==self.t-1 else .57)
            joints=[(j+(lev%2)*.45+self.rng.uniform(-.115,.115))*TAU/count for j in range(count)]
            for j in range(count):
                a=joints[j]
                b=joints[(j+1)%count]+(TAU if j==count-1 else 0)
                wear=self.rng.uniform(.003,.014)
                shoulder=self.rng.uniform(.023,.041)
                # 弧形铺石。径向缝沿两条直线，内圈与外圈有相同的缝宽。
                gap=.025
                rings=[]
                for rr,ro,bot in [(inner+.016,radius-.016,.0),(inner,radius,.032),
                                  (inner,radius,.20-shoulder),(inner+.006,radius-shoulder,.20)]:
                    corners=[]
                    seam=(gap/2)+(.006 if bot in (0,.20) else 0)
                    for r,start,end in ((ro,a,b),(rr,b,a)):
                        sign = 1 if end>start else -1
                        for k in range(4):
                            theta=mix(start+sign*seam/r,end-sign*seam/r,k/3)
                            corner=r
                            if r==ro:
                                corner-=wear*(1-k/3)**2
                            corners.append(radial(theta,corner,y+bot))
                    rings.append(corners)
                val=1
                for k in range(3):
                    for i in range(8):
                        l=(i+1)%8
                        m.face([rings[k][i],rings[k][l],rings[k+1][l],rings[k+1][i]], .72 if i in (3,7) or k==0 else 1)
                top=rings[-1]
                for k in range(3):
                    m.face([top[k],top[k+1],top[6-k],top[7-k]],val)
            if lev==self.t-1:
                # 内圈也分块，塔脚覆盖圆心。
                self.paver_inner(inner-.025, y+.20, count-3)

    def paver_inner(self,outer,y,count):
        m=self.mesh('Stepped_paving','stone')
        for j in range(count):
            a,b=(j+.45)*TAU/count,(j+1.45)*TAU/count
            lo=min(self.base*.76,outer-.10)
            levels=[]
            for height,lip,seam in [(y-.14,0,.0125),(y-.018,0,.0125),(y,.006,.0185)]:
                ring=[]
                for r,start,end in [(outer-lip,a,b),(lo,b,a)]:
                    direction=1 if end>start else -1
                    for k in range(4):
                        theta=mix(start+direction*seam/r,end-direction*seam/r,k/3)
                        ring.append(radial(theta,r,height))
                levels.append(ring)
            for bottom,top in zip(levels,levels[1:]):
                for k in range(8):
                    l=(k+1)%8
                    m.face([bottom[k],bottom[l],top[l],top[k]],.72 if k in (3,7) else 1)
            top=levels[-1]
            for k in range(3):
                m.face([top[k],top[k+1],top[6-k],top[7-k]],1)

    def backing(self):
        # 里皮砌在外皮背后；让凹进的石缝落在暗面上。
        m=self.mesh('Recessed_bond','stone')
        for layer in range(3):
            bottom=mix(self.steps,self.bowl,layer/3)
            top=mix(self.steps,self.bowl,(layer+1)/3)
            for j in range(13):
                a=(j+.26+layer*.47)*TAU/13
                ring=[]
                for y in (bottom+.012,top-.012):
                    r=interp(self.profile,y)-.16
                    ring.append([radial(a+.014/r,r,y),radial(a+TAU/13-.014/r,r,y)])
                m.face([*ring[0],*reversed(ring[1])],.53)

    def masonry(self):
        m=self.mesh('Basalt_ashlar','stone')
        start,end=self.steps-.004,self.bowl-.10
        count=round((end-start)/.58)
        rows=[mix(start,end,k/count) for k in range(count+1)]
        def bed(k,a):
            return rows[k]+(.024*math.sin(3*a+k*1.73)+.009*math.cos(5*a-k*.82) if 0<k<count else 0)
        hot_ends={}
        for k in range(count):
            y0,y1=rows[k:k+2]
            r=interp(self.profile,(y0+y1)/2)
            n=max(7,round(TAU*r/.77))
            offset=(k%2)*.48+.12*math.sin(k*4.7)
            anchors=[(j+offset+self.rng.uniform(-.11,.11))*TAU/n for j in range(n)]
            skew=[self.rng.uniform(-.075,.075)/r for j in range(n)]
            hot={}
            if self.t==3 and k in (3,4,5,8,9,10):
                for q in range(4):
                    path=q*PI/2+.19*math.sin(k*.89+q)
                    j=min(range(n),key=lambda i:abs(math.remainder(anchors[i]-path,TAU)))
                    hot[j]=q
            for j in range(n):
                a,b=anchors[j],anchors[(j+1)%n]+(TAU if j==n-1 else 0)
                s,t=skew[j],skew[(j+1)%n]
                gap=.025/2
                xa,xb=r*(a+s)+gap,r*(b+t)-gap
                xc,xd=r*(b-t)-gap,r*(a-s)+gap
                poly=[(xa,bed(k,a+s)+gap),(xb,bed(k,b+t)+gap),
                      (xc,bed(k+1,b-t)-gap),(xd,bed(k+1,a-s)-gap)]
                # 每块石头的四角独立削缺。凹进的侧壁形成真正的石缝。
                cut=[]
                for i,p in enumerate(poly):
                    prev,nxt=poly[i-1],poly[(i+1)%4]
                    d=self.rng.uniform(.018,.075)
                    for other in (prev,nxt):
                        v=unit(sub(other,p))
                        cut.append((p[0]+v[0]*d,p[1]+v[1]*d))
                inside=inset(cut,.0065)
                relief=self.rng.uniform(-.007,.007)
                def stonept(p,depth):
                    angle=p[0]/r
                    chord=math.cos((b-a)*.5)/math.cos(angle-(a+b)*.5)
                    return radial(angle,interp(self.profile,p[1])*mix(1,chord,.56)+depth+relief,p[1])
                # Split long arcs so the stone front follows the tower, even under a belt.
                back=[stonept(p,-.13) for p in cut]
                edge=[stonept(p,-.022) for p in cut]
                front=[stonept(p,0) for p in inside]
                val=1
                center=tuple(sum(a[i] for a in inside)/8 for i in (0,1))
                cp=stonept(center,0)
                slope=(interp(self.profile,y1)-interp(self.profile,y0))/(y1-y0)
                tilt=self.rng.uniform(-.038,.038)
                def face_normal(p):
                    return unit(radial(mix((a+b)*.5,p[0]/r,.52)+tilt,1,-slope+.02))
                for i in range(8):
                    l=(i+1)%8
                    m.face([back[i],back[l],edge[l],edge[i]],.64)
                    m.face([edge[i],edge[l],front[l],front[i]],[.80,.80,val,val])
                    m.face([front[i],front[l],cp],val,[face_normal(p) for p in (inside[i],inside[l],center)])
                if j in hot:
                    gm=self.mesh('Ember_fissures','glow')
                    pts=[(r*(a+s)-.013,bed(k,a+s)),(r*(a+s)+.013,bed(k,a+s)),
                         (r*(a-s)+.012,bed(k+1,a-s)),(r*(a-s)-.012,bed(k+1,a-s))]
                    gm.face([stonept(p,-.018) for p in pts],.79)
                    q=hot[j]
                    if k not in (3,8):
                        t0=hot_ends[q]
                        arc=math.remainder(a+s-t0,TAU)
                        pieces=max(1,math.ceil(abs(arc)*r/.075))
                        for u in range(pieces):
                            u0,u1=t0+arc*u/pieces,t0+arc*(u+1)/pieces
                            bed_pts=[]
                            for angle,dy in [(u0,-.012),(u1,-.012),(u1,.012),(u0,.012)]:
                                yy=bed(k,angle)+dy
                                bed_pts.append(radial(angle,interp(self.profile,yy)-.035,yy))
                            gm.face(bed_pts if arc>0 else bed_pts[::-1],.74)
                    hot_ends[q]=a-s

    def plate(self,name,mat,a,r,poly,depth,bevel=.014,shade=1):
        if signed(poly)<0: poly=poly[::-1]
        front=inset(poly,bevel) if bevel else poly
        def pt(p,d):
            radius=r(p[1]) if callable(r) else r
            return radial(a+p[0]/radius,radius+d,p[1])
        m=self.mesh(name,mat)
        back=[pt(p,-.015) for p in poly]
        rim=[pt(p,max(0,depth-bevel)) for p in poly]
        face=[pt(p,depth) for p in front]
        for i in range(len(poly)):
            j=(i+1)%len(poly)
            m.face([back[i],back[j],rim[j],rim[i]],.70)
            if bevel:
                m.face([rim[i],rim[j],face[j],face[i]],[1,1,1,1])
        for strip in curved_panel(front):
            m.face([pt(p,depth) for p in strip],shade)

    def pier_block(self,name,material,a,sections):
        # 切去直角的方石。截面按切线排布，正面为平面，侧面插进塔身。
        m=self.mesh(name,material)
        rings=[]
        for y,back,front,w,cut in sections:
            outline=[(-w,back),(-w,front-cut),(-w+cut,front),
                     (w-cut,front),(w,front-cut),(w,back)]
            rings.append([(math.cos(a)*x+math.sin(a)*z,y,
                           math.cos(a)*z-math.sin(a)*x) for x,z in outline])
        for lo,hi in zip(rings,rings[1:]):
            for i in range(6):
                j=(i+1)%6
                m.face([lo[i],lo[j],hi[j],hi[i]],.66 if i==5 else 1)
        m.face(rings[-1],1)
        m.face(rings[0][::-1],.70)

    def belt(self,y,r,h,name):
        self.band(name,'metal',[(r-.22,y-h*.52,.68),(r-.095,y-h*.52,.76),
                  (r+.018,y-h*.30,1),(r+.043,y-h*.16,1),(r+.043,y+h*.14,1),
                  (r-.008,y+h*.38,1),(r-.11,y+h*.50,1),(r-.23,y+h*.50,.76)])
        self.band(name+'_lower_welt','metal',[(r-.13,y-h*.55,.67),(r-.076,y-h*.55,.76),
                  (r-.012,y-h*.46,1),(r-.013,y-h*.36,1),(r-.13,y-h*.36,.74)])

    def lower(self):
        r,low,high=self.base,self.steps,self.cap
        self.belt(low+.145,r+.055,.28,'Foot_iron')
        self.belt(high,r+.125,.49,'Sill_iron')
        self.band('Clay_frieze','accent',[(r-.11,high-.43,.72),(r+.023,high-.43,.72),
                  (r+.052,high-.37,1),(r+.047,high-.287,1),(r+.010,high-.25,1),
                  (r-.11,high-.25,.74)])
        for j in range(self.n):
            a=j*TAU/self.n
            w=[.89,.97,1.02][self.t-1]*(1 if j%3==0 else .65)
            floor=low+.15
            def shape(pts):
                return [(x*w,floor+y*(high-floor+.14)) for x,y in pts]
            arch=[(-1,0),(1,0),(1,.28),(.95,.47),(.80,.65),(.57,.79),
                  (.27,.91),(0,1),(-.27,.91),(-.57,.79),(-.80,.65),(-.95,.47),(-1,.28)]
            bodyrad=lambda y:interp(self.profile,y)-.085*(y-floor)/(high-floor)
            self.plate('Arched_iron_casings','metal',a,lambda y:bodyrad(y)+.043,
                       shape(arch),.155,.045)
            self.plate('Fired_clay_lunettes','accent',a,lambda y:bodyrad(y)+.193,
                       shape([(x*.87,y*.84+.051) for x,y in arch]),.060,.030)
            # 拱券各段用有斜面的独立铁块，拱内留一圈露出的赤陶肩线。
            rim=[(.94,.035),(.94,.31),(.86,.49),(.68,.66),(.42,.80),(0,.968)]
            for side in (-1,1):
                for (x0,z0),(x1,z1) in zip(rim,rim[1:]):
                    end=.984
                    x1,z1=mix(x0,x1,end),mix(z0,z1,end)
                    corners=[(side*x0,z0),(side*x1,z1),
                             (side*(x1*.835),z1*.86+.017),(side*(x0*.835),z0*.86+.017)]
                    self.plate('Archivolt_wedges','metal',a,lambda y:bodyrad(y)+.185,
                               shape(corners),.093,.025)
                arc=[(.72,.069),(.72,.28),(.64,.42),(.48,.54),(.26,.64),
                     (0,.755),(.27,.610),(.51,.482),(.604,.37),(.650,.252),(.650,.069)]
                self.plate('Arch_inner_moulding','metal',a,lambda y:bodyrad(y)+.250,
                           shape([(side*x,y) for x,y in arc]),.050,.015)
            plinth=[(-.98,.015),(.98,.015),(.98,.091),(.90,.117),(-.90,.117),(-.98,.091)]
            self.plate('Arch_threshold','metal',a,lambda y:bodyrad(y)+.203,shape(plinth),.089,.024)
            key=[(-.119,.895),(0,1.026),(.119,.895),(.055,.838),(0,.786),(-.055,.838)]
            self.plate('Archivolt_crown','metal',a,lambda y:bodyrad(y)+.254,shape(key),.057,.021)
            flame=[(-.063,.061),(.063,.061),(.093,.245),(.19,.36),(.40,.48),
                   (.49,.57),(.36,.51),(.125,.425),(.14,.52),(.069,.61),(0,.545),
                   (-.06,.61),(-.132,.53),(-.12,.42),(-.35,.51),(-.50,.59),
                   (-.41,.48),(-.18,.345),(-.09,.22)]
            self.plate('Flame_on_arch','metal',a,lambda y:bodyrad(y)+.252,
                       shape(flame),.041,.012)
            for side in (-1,1):
                petal=[(.12,.14),(.16,.30),(.28,.40),(.54,.47),(.42,.40),(.29,.28),(.21,.14)]
                facet=self.mesh('Carved_clay_petals','accent')
                outline=[]
                for x,y in shape([(side*x,y) for x,y in petal]):
                    rr=bodyrad(y)
                    outline.append(radial(a+x/rr,rr+.259,y))
                x,y=shape([(side*.279,.319)])[0]
                rr=bodyrad(y)
                ridge=radial(a+x/rr,rr+.303,y)
                for i in range(len(outline)):
                    triangle=[outline[i],outline[(i+1)%len(outline)],ridge]
                    facet.face(triangle if side<0 else triangle[::-1],1)
            lozenge=[(0,.755),(.092,.637),(0,.542),(-.092,.637)]
            self.plate('Arch_flame_finial','accent',a,lambda y:bodyrad(y)+.268,
                       shape(lozenge),.052,.019)
        for j in range(self.n):
            a=(j+.5)*TAU/self.n
            foot=[1.73,1.78,1.81][self.t-1]
            self.pier_block('Foundation_bastions','stone',a,[
                (low+.018,r-.19,foot-.055,.35,.08),(low+.09,r-.19,foot,.40,.09),
                (high-.46,r-.22,foot-.045,.37,.08),(high-.31,r-.22,foot-.105,.32,.075)])
            self.pier_block('Sill_corbel','metal',a,[
                (high-.285,r-.22,foot-.112,.33,.08),(high-.18,r-.21,foot+.005,.38,.085),
                (high+.096,r-.21,foot+.014,.38,.085),(high+.225,r-.21,foot-.085,.32,.08)])
        stops=[high,*self.levels,self.neck]
        for idx,(lo,hi) in enumerate(zip(stops,stops[1:])):
            foot=interp(self.profile,lo+.24)
            head=interp(self.profile,hi-.23)
            for j in range(self.n):
                a=(j+.5)*TAU/self.n
                foot_profile=[(lo+.085,foot+.345),(lo+.23,foot+.36),(lo+.43,foot+.32),
                              (lo+(hi-lo)*.59,head+.195),(hi-.14,head+.17)]
                width_profile=[(lo+.085,.37),(lo+.23,.385),(lo+.43,.35),
                               (lo+(hi-lo)*.59,.245),(hi-.14,.233)]
                joints=[lo+.085,lo+(hi-lo)*.30,lo+(hi-lo)*.61,hi-.14]
                for y0,y1 in zip(joints,joints[1:]):
                    start,end=y0+.013,y1-.013
                    cuts=sorted({start,start+.026,end-.026,end,
                                 *(y for y,_ in foot_profile if start+.026<y<end-.026)})
                    sections=[]
                    for y in cuts:
                        chamfer=.022 if y==start or y==end else 0
                        sections.append((y,interp(self.profile,y)-.16,interp(foot_profile,y)-chamfer,
                                         interp(width_profile,y)-chamfer,.077))
                    self.pier_block('Basalt_counterforts','stone',a,sections)
                # 竖向铁鞋沿石垛外坡折回。陶条只占铁鞋正面的一窄段。
                face=[(lo+.19,foot+.361,.225),(lo+.43,foot+.32,.225),
                      (lo+(hi-lo)*.59,head+.195,.142),(hi-.29,head+.17,.13)]
                self.pier_block('Counterfort_greaves','metal',a,[
                    (y,z-.055,z+.035,w,.040) for y,z,w in face])
                spine=[(-.040,face[0][0]+.035),(.040,face[0][0]+.035),
                       (.025,face[-1][0]-.13),(0,face[-1][0]-.038),(-.025,face[-1][0]-.13)]
                track=[(y,z+.039) for y,z,_ in face]
                self.plate('Greave_terracotta','accent',a,lambda y:interp(track,y),spine,.014,.005)
                jewels=(hi==self.neck and self.t>=2) or (self.t==3 and idx==0)
                drop=.29 if jewels else 0
                self.pier_block('Forged_capitals','metal',a,[
                    (hi-.43-drop,head-.19,head+.148,.205,.055),
                    (hi-.27-drop,head-.18,head+.295,.295,.08),
                    (hi-.14-drop,head-.18,head+.375,.375,.09),
                    (hi+.095-drop,head-.18,head+.375,.375,.09),
                    (hi+.225-drop,head-.18,head+.22,.285,.075)])
            if hi==self.neck and self.t>=2:
                self.gem_belt(hi+.025,head+.205,.54 if self.t==2 else .60,12)
            elif self.t==3 and idx==0:
                self.gem_belt(hi,head+.246,.57,12)
            else:
                self.belt(hi,head+.265,.55,'Tier_binding')
                for j in range(self.n):
                    self.escutcheon(j*TAU/self.n,head+.305,hi,.37,.53)

    def escutcheon(self,a,r,y,w,h):
        profile=[(-1,.30),(-.70,.48),(0,.31),(.70,.48),(1,.30),(.53,.04),
                 (.28,-.25),(0,-.73),(-.28,-.25),(-.53,.04)]
        self.plate('Forged_chevrons','metal',a,r,[(x*w,y+z*h) for x,z in profile],.055,.019)
        self.plate('Chevrons_in_relief','metal',a,r+.053,
                   [(x*w,y+z*h) for x,z in [(0,.18),(.25,.03),(.10,-.20),(0,-.50),(-.10,-.19),(-.25,.03)]],.024,.009,1)

        # 盾形承扣的脊高于两翼，斜面在游戏光下勾出分叉的纹样。
        m=self.mesh('Keel_of_clasps','metal')
        def stamp(x,z,d):
            return radial(a+x*w/r,r+d,y+z*h)
        outline=[(-.64,.37),(-.26,.34),(0,.52),(.26,.34),(.64,.37),
                 (.34,.10),(.15,-.18),(0,-.70),(-.15,-.18),(-.34,.10)]
        valley=[stamp(x,z,.071) for x,z in outline]
        ridge=stamp(0,.10,.147)
        for j in range(len(valley)):
            m.face([valley[(j+1)%len(valley)],valley[j],ridge],1)
        self.plate('Clasps_recess','accent',a,r+.146,
                   [(-.043*w,y+.07*h),(0,y+.22*h),(.043*w,y+.07*h),(0,y-.055*h)],.008,.002,.75)

    def gem_belt(self,y,r,h,n):
        self.band('Ember_settings','metal',[(r-.13,y-h*.52,.59),(r+.002,y-h*.52,.76),
                  (r+.064,y-h*.39,1),(r+.018,y-h*.27,.77),(r+.012,y+h*.31,1),
                  (r+.064,y+h*.38,1),(r+.032,y+h*.51,1),(r-.12,y+h*.51,.78)])
        for j in range(n):
            a=j*TAU/n
            w=min(PI*r/n*.77,h*.53)
            self.plate('Lozenge_mounts','metal',a,r+.015,
                [(-w,y),(0,y+h*.53),(w,y),(0,y-h*.46)],.063,.030)
            self.plate('Clay_gem_seats','accent',a,r+.079,
                       [(-w*.79,y),(0,y+h*.40),(w*.79,y),(0,y-h*.37)],.026,.013,1)
            self.gem('Set_cabochons',a,r+.108,y,w*.60,h*.305,.092)

    def gem(self,name,a,r,y,w,h,d):
        m=self.mesh(name,'crystal')
        edge=[radial(a+x/r,r,y+z) for x,z in [(-w,0),(0,-h),(w,0),(0,h)]]
        center=radial(a-.11*w/r,r+d,y+.16*h)
        for j in range(4):
            m.face([edge[j],edge[(j+1)%4],center],1)

    def crown(self):
        r,base,tip=self.topr,self.bowl,self.h
        low=self.neck
        self.band('Chalice','metal',[(r*.69,low-.14,.64),(r*.84,low-.11,.71),
                  (r*.86,low+.005,1),(r*.81,low+.065,.78),(r*.86,low+.15,1),
                  (r*1.02,base-.22,1),(r*1.06,base-.07,1),(r*1.03,base+.09,1),
                  (r*.94,base+.14,1),(r*.68,base+.07,.78),(r*.63,base-.10,.54)])
        self.band('Bowl_lower_bead','metal',[(r*.78,low+.02,.65),(r*.86,low+.02,.78),
                   (r*.878,low+.05,1),(r*.86,low+.112,1),(r*.78,low+.112,.7)])
        self.band('Chalice_terracotta_rebate','accent',[(r*.832,low+.104,.66),(r*.874,low+.104,.76),
                     (r*.904,low+.164,1),(r*.900,low+.192,1),(r*.841,low+.177,.68)])
        for j in range(4):
            a=j*PI/2
            self.escutcheon(a,r*1.058,base-.115,r*.59,.82)
            for sign in (-1,1):
                scroll=[(.05,.04),(.22,.06),(.37,.12),(.52,.155),(.66,.15),(.53,.19),
                        (.38,.185),(.22,.13),(.06,.10)]
                self.plate('Chalice_chased_border','metal',a,r*1.062,
                     [(sign*x*r,base-.18+y) for x,y in scroll],.035,.010,1)
        self.band('Crucible_hearth','accent',[(r*.28,base+.015,.71),(r*.695,base+.025,.73),
                  (r*.695,base+.112,1),(r*.633,base+.178,1),(r*.45,base+.192,1),
                  (r*.27,base+.161,.74)],24)
        # 窄火弧沿陶座内坡露出。两端收尖，托座填在火弧下面。
        core=self.mesh('Ember_core','glow')
        for j in range(8):
            mid=(j+.5)*TAU/8
            arc=[]
            for t,w in [(-.29,.001),(-.135,.016),(0,.023),(.135,.012),(.29,.001)]:
                theta=mid+t
                arc.append([radial(theta,r*(.626+q*w),base+.186-q*w*.44) for q in (1,-1)])
            for lo,hi in zip(arc,arc[1:]):
                core.face([lo[0],hi[0],hi[1],lo[1]],1)
        for j in range(8):
            a=j*TAU/8
            m=self.mesh('Scalloped_crucible','accent')
            for side in (-1,1):
                aa=a+side*.352
                p0,p1=radial(a,r*.718,base+.076),radial(aa,r*.690,base+.084)
                p2,p3=radial(aa,r*.615,base+.122),radial(a,r*.68,base+.35+.085*math.cos(2*a))
                ridge=radial(a+side*.11,r*.752,base+.19)
                for pts in ([p0,p1,ridge],[p1,p2,ridge],[p2,p3,ridge],[p3,p0,ridge]):
                    m.face(pts if side>0 else pts[::-1],1)
        for j in range(4):
            self.claw((j+.5)*PI/2,r,base,tip)
        self.jewel(r,base,tip)

    def claw(self,a,r,base,tip):
        m=self.mesh('Flame_talons','metal')
        lining=self.mesh('Kiln_lining','accent')
        # 以爪背为外径。两侧锻面围出肩部，前爪较短，正面留出晶窗。
        table=[(-.28,1.065,.036,.13,-.015),(-.125,1.085,.305,.24,-.045),
               (.045,1.105,.55,.35,-.075),(.20,1.185,.61,.38,-.05),
               (.34,1.218,.57,.395,.155),(.49,1.22,.495,.38,.260),
               (.615,1.17,.368,.325,.260),(.720,1.071,.266,.25,.225),
               (.835,.972,.124,.150,.215),(.943,.882,.009,.032,.175)]
        span=tip-base
        short=math.cos(a)<0
        hand=1 if math.sin(a)*math.cos(a)>0 else -1
        rings=[]
        for h,rr,w,d,sweep in table:
            row=[]
            for x,depth in [(-1,.46),(-.76,.17),(-.27,0),(.13,.018),(.76,.20),(1,.45),
                            (.88,.76),(.48,.94),(0,1),(-.54,.91),(-.89,.75)]:
                y=base+span*(h*((.775 if short else .90) if h>0 else 1)+x*w*hand*.14)
                row.append(radial(a+hand*sweep+x*w,r*(rr-depth*d),y))
            rings.append(row)
        for k,(lo,hi) in enumerate(zip(rings,rings[1:])):
            for i in range(len(lo)):
                j=(i+1)%len(lo)
                skin=lining if i in (7,8) and 0<k<7 else m
                skin.face([lo[i],lo[j],hi[j],hi[i]],.76 if i in (7,8) and k<2 else 1)
        m.face(rings[-1],1)
        m.face(rings[0][::-1],.68)

        # 外甲和主爪共用曲线，甲边向内咬入爪背，肩线上折出两道受光棱。
        rows=[]
        for k,width in [(0,.09),(1,.76),(2,.89),(3,.91),(4,.81),(5,.67),(6,.40),(7,.035)]:
            h,rr,w,d,sweep=table[k]
            row=[]
            for q,step in [(-1,-.034),(-.83,.019),(-.18,.052),(.12,.052),(.82,.014),(1,-.035)]:
                x=q*width
                crest=rr-abs(x)**1.7*d*.48
                z=h*((.775 if short else .90) if h>0 else 1)
                row.append(radial(a+hand*sweep+x*w,(crest+step)*r,
                                  base+span*(z+x*w*hand*.14)))
            rows.append(row)
        for lo,hi in zip(rows,rows[1:]):
            for i in range(len(lo)-1):
                m.face([lo[i],lo[i+1],hi[i+1],hi[i]],1)

    def jewel(self,r,base,tip):
        span=tip-base
        m=self.mesh('crystal','crystal',(0,base+span*.46,0))
        n=8
        rings=[]
        for h,rr,turn in [(.035,.29,.18),(.205,.57,.19),(.408,.755,-.115),(.567,.69,.145),(.762,.385,-.135)]:
            row=[]
            for j in range(n):
                a=TAU*j/n+turn
                row.append(radial(a,r*rr*(1+.075*math.sin(j*2.85+h*3)),base+span*(h+(.093 if h>.2 else .025)*math.sin(j*4.7+h*7))))
            rings.append(row)
        for k,(lo,hi) in enumerate(zip(rings,rings[1:])):
            for j in range(n):
                b=(j+1)%n
                for points in ([lo[j],lo[b],hi[b]],[lo[j],hi[b],hi[j]]):
                    center=[sum(p[c] for p in points)/3 for c in range(3)]
                    rim=[tuple(mix(p[c],center[c],.072) for c in range(3)) for p in points]
                    rim=[(x*1.026,y,z*1.026) for x,y,z in rim]
                    m.face(rim,1)
                    for q in range(3):
                        z=(q+1)%3
                        m.face([points[q],points[z],rim[z],rim[q]],.54+.12*q)
            # 在主晶下半段的接缝中露出窄火芯，随主晶一起转动。
            if k in (1,2):
                molten=self.mesh('Molten_inclusions','glow',m.origin)
                for j in range(k%2,n,2):
                    a,b=lo[j],hi[(j+1)%n]
                    c=hi[j]
                    slit=[]
                    for t,w in [(.05,.003),(.46,.024),(.88,.003),(.45,-.012)]:
                        v=[mix(a[d],b[d],t)+w*(c[d]-a[d]) for d in range(3)]
                        slit.append((v[0]*1.026,v[1],v[2]*1.026))
                    if sum(u*v for u,v in zip(cross(sub(slit[1],slit[0]),sub(slit[2],slit[0])),(a[0],0,a[2])))<0:
                        slit.reverse()
                    molten.face(slit,1)
        for j in range(n):
            b=(j+1)%n
            m.face([rings[-1][j],rings[-1][b],(.020*r,tip,-.018*r)],1)
            m.face([rings[0][b],rings[0][j],(0,base,0)],.68)

        # 晶簇共用主晶体的旋转节点。小晶柱的外棱和主晶面之间留深谷。
        for j in range(6):
            a=TAU*j/6+.18
            h=.425+.086*math.sin(2.24*j)
            skin=[]
            for ht,rr,size in [(.085,.395,.125),(.16,.514,.167),(.255,.591,.153)]:
                ring=[]
                for k in range(5):
                    theta=k*TAU/5+a+.28
                    px,py,pz=radial(a,rr*r,base+span*(ht+.025))
                    ring.append((px+r*size*math.sin(theta),py+span*.016*math.cos(theta-a),
                                 pz+r*size*math.cos(theta)))
                skin.append(ring)
            for bot,top in zip(skin,skin[1:]):
                for k in range(5):
                    l=(k+1)%5
                    m.face([bot[k],bot[l],top[l],top[k]],1)
            point=radial(a+.045,(.762+.035*math.sin(j))*r,base+span*h)
            for k in range(5):
                m.face([skin[-1][k],skin[-1][(k+1)%5],point],1)

    def save(self,path):
        binary=bytearray()
        doc={'asset':{'version':'2.0','generator':'Ember Court | build.py'},'scene':0,'scenes':[{'nodes':[]}],
             'nodes':[],'meshes':[],'materials':[{'name':name} for name in MATERIALS],'buffers':[],
             'bufferViews':[],'accessors':[]}
        def buf(data,target):
            binary.extend(bytes((-len(binary))%4))
            doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data),'target':target})
            binary.extend(data)
            return len(doc['bufferViews'])-1
        def attribute(rows,kind,fmt,ctype,target,bounds=False):
            size=len(rows[0])
            data=b''.join(struct.pack('<'+fmt*size,*row) for row in rows)
            attr={'bufferView':buf(data,target),'componentType':ctype,'count':len(rows),'type':kind}
            if bounds:
                attr.update(min=list(map(min,zip(*rows))),max=list(map(max,zip(*rows))))
            doc['accessors'].append(attr)
            return len(doc['accessors'])-1
        for i,(name,m) in enumerate(self.meshes.items()):
            pos=attribute([v[:3] for v in m.data],'VEC3','f',5126,34962,True)
            nor=attribute([v[3:6] for v in m.data],'VEC3','f',5126,34962)
            col=attribute([(v[6],)*3 for v in m.data],'VEC3','f',5126,34962)
            idx=attribute([(j,) for j in m.indices],'SCALAR','H',5123,34963)
            prim={'attributes':{'POSITION':pos,'NORMAL':nor,'COLOR_0':col},'indices':idx,'material':MATERIALS.index(m.mat)}
            doc['meshes'].append({'name':name,'primitives':[prim]})
            node={'name':name,'mesh':i}
            if m.origin!=(0,0,0): node['translation']=m.origin
            doc['nodes'].append(node)
            doc['scenes'][0]['nodes'].append(i)
        nodes={n['name']:i for i,n in enumerate(doc['nodes'])}
        inclusions=nodes['Molten_inclusions']
        doc['nodes'][inclusions].pop('translation')
        doc['nodes'][nodes['crystal']]['children']=[inclusions]
        doc['scenes'][0]['nodes'].remove(inclusions)
        binary.extend(bytes((-len(binary))%4))
        doc['buffers']=[{'byteLength':len(binary)}]
        header=json.dumps(doc,separators=(',',':')).encode()
        header+=b' '*((-len(header))%4)
        path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(header)+len(binary))+
                         struct.pack('<I4s',len(header),b'JSON')+header+struct.pack('<I4s',len(binary),b'BIN\0')+binary)
        print(path.name, sum(len(m.indices)//3 for m in self.meshes.values()), 'triangles')


if __name__=='__main__':
    OUT.mkdir(exist_ok=True)
    for t in (1,2,3):
        tower=Tower(t)
        tower.paving()
        tower.backing()
        tower.masonry()
        tower.lower()
        tower.crown()
        tower.save(OUT/f'tower_foe_{t}.glb')
