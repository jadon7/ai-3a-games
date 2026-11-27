"""从 B 稿的截面和轮廓生成沉月会水晶。长度用米，Y 轴向上。"""
import itertools
import json
import math
import struct
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
TAU = math.tau
rad = math.radians
sin, cos = math.sin, math.cos
PARTS = defaultdict(lambda: [[], [], [], []])
section, origin = 'altar', np.zeros(3)


def polar(radius, angle, height):
    return np.array((radius * sin(angle), height, radius * cos(angle)))


def append(material, positions, normals, shades, triangles):
    chunk = PARTS[section, material]
    base = len(chunk[0])
    chunk[0].extend(np.asarray(positions) + origin)
    chunk[1].extend(normals)
    chunk[2].extend(shades)
    chunk[3].extend(np.asarray(triangles) + base)


def polygon(material, points, shade):
    pts = np.asarray(points)
    n = np.cross(pts[1] - pts[0], pts[2] - pts[0])
    n /= np.linalg.norm(n)
    append(material, pts, [n] * len(pts), [shade] * len(pts),
           [(0, i, i + 1) for i in range(1, len(pts) - 1)])


def surface(rows, shades, material, closed=True, bands=None):
    pts = np.asarray(rows)
    h, w = pts.shape[:2]
    j, i = np.mgrid[0:h-1, 0:w if closed else w-1]
    a = j * w + i
    b = j * w + (i + 1) % w
    triangles = np.stack((a, b, b + w, a, b + w, a + w), axis=-1).reshape(-1, 3)
    p = pts.reshape(-1, 3)
    ns = np.zeros_like(p)
    fn = np.cross(p[triangles[:, 1]] - p[triangles[:, 0]], p[triangles[:, 2]] - p[triangles[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn,axis=1,keepdims=True),1e-12)
    for corner in range(3):
        a,b,c = triangles[:,corner],triangles[:,(corner+1)%3],triangles[:,(corner+2)%3]
        ab,ac = p[b]-p[a],p[c]-p[a]
        angles=np.arctan2(np.linalg.norm(np.cross(ab,ac),axis=1),np.einsum('ij,ij->i',ab,ac))
        np.add.at(ns,a,fn*angles[:,None])
    ns /= np.maximum(np.linalg.norm(ns, axis=1, keepdims=True), 1e-10)
    c = np.broadcast_to(shades, (h, w)).flatten()
    if bands is None:
        append(material, p, ns, c, triangles)
    else:
        keys = np.repeat(np.broadcast_to(bands,(h-1, i.shape[1])).ravel(), 2)
        for key in dict.fromkeys(keys):
            used, indices = np.unique(triangles[keys == key], return_inverse=True)
            append(key, p[used], ns[used], c[used], indices.reshape(-1, 3))


def rounded_path(corners, radius, cuts=4):
    points = np.asarray(corners, float)
    result = []
    for i, p in enumerate(points):
        v, w = points[i-1] - p, points[(i+1) % len(points)] - p
        lv, lw = np.linalg.norm(v), np.linalg.norm(w)
        v, w = v / lv, w / lw
        half = math.acos(np.clip(np.dot(v, w), -1, 1)) / 2
        d = min(radius / max(math.tan(half), 1e-8), lv * .42, lw * .42)
        start, end = p + v*d, p + w*d
        for t in np.linspace(0, 1, cuts):
            result.append((1-t)**2 * start + 2*t*(1-t)*p + t*t*end)
    return result


def revolve(material, profile, sides=72, fillet=.045, wave=None, phase=0, footprint=None):
    # 轮廓按外侧向上、再沿内侧向下的顺序闭合。
    curve = rounded_path(profile, fillet, 3)
    def row(q):
        r, y = q
        if footprint is not None:
            return [np.array((x*r, y, z*r)) for x, z in footprint]
        return [polar(r, phase + i*TAU/sides, y + (wave(r,y,phase+i*TAU/sides) if wave else 0)) for i in range(sides)]
    if profile[0][0]==0 and profile[-1][0]==0:
        sides_only=[row(q) for q in curve[3:-3]]
        surface(sides_only, 1., material)
        polygon(material,sides_only[0][::-1],.84)
        polygon(material,sides_only[-1],1.)
        return
    rows = [row(q) for q in curve]
    surface([*rows, rows[0]], [[.88 if r < min(p[0] for p in profile)+.04 else .99] for r,y in [*curve,curve[0]]], material)


def sector_course(inner, outer, low, high, count, phase, bevel):
    # 用极坐标展开每一块石料。沿径向接缝的两侧各退 0.018 米。
    steps = 12 if inner > 1 else 8
    for k in range(count):
        angle = phase + k * TAU/count
        def loop(inset, y):
            ri, ro = inner + inset, outer - inset
            half = math.pi/count
            contour = []
            # s 是局部角度。四个平面拐角都做圆角；外弧、内弧各自补采样。
            for rr, direction in [(ro, 1), (ri, -1)]:
                gap = .018 + inset
                last = half - (gap + .08) / rr
                for s in np.linspace(-last * direction, last * direction, steps):
                    contour.append(polar(rr,angle+s,y))
                for t in np.linspace(0,math.pi/2,4)[1:]:
                    r = rr - direction*.08*(1-cos(t))
                    s = direction*(half - (gap+.08-.08*sin(t))/r)
                    contour.append(polar(r,angle+s,y))
                target = ri if direction==1 else ro
                for t in np.linspace(0,math.pi/2,4)[:-1]:
                    r = target + direction*.08*(1-sin(t))
                    s = direction*(half - (gap+.08*(1-cos(t)))/r)
                    contour.append(polar(r,angle+s,y))
            return contour
        b = min(bevel,(high-low)*.4)
        arcs = [(b-b*sin(t), low+b-b*cos(t)) for t in np.linspace(0,math.pi/2,4)]
        arcs += [(b-b*cos(t), high-b+b*sin(t)) for t in np.linspace(0,math.pi/2,4)]
        rows = [loop(d,y) for d,y in arcs]
        surface(rows, [[n] for n in [.80,.88,.96,1,1,1,1,1]], 'stone')
        # 两条横弧一一对应。用小四边形盖住凹扇形，不能用凸多边形的扇形三角化。
        for row, flip, shade in [(rows[-1],False,1.),(rows[0],True,.82)]:
            half_n = len(row)//2
            # 每半段从一条圆弧经过其端部两个圆角。按弧向分割铺面。
            
            inner_arc = list(reversed(row[half_n:half_n+steps]))
            for i in range(steps-1):
                quad = [row[i+1],row[i],inner_arc[i],inner_arc[i+1]]
                if np.cross(quad[1]-quad[0],quad[2]-quad[0])[1] < 0: quad.reverse()
                polygon('stone',quad[::-1] if flip else quad,shade)
            # 细小的端部圆角区各用一个凸多边形填满。
            n = len(row)
            for chain in [row[steps-1:half_n+1], row[half_n+steps-1:] + row[:1]]:
                if np.cross(chain[1]-chain[0], chain[2]-chain[0])[1] < 0: chain=chain[::-1]
                polygon('stone',chain[::-1] if flip else chain,shade)
    radius = inner + .008
    circles = [[polar(radius, i*TAU/40, y) for i in range(40)] for y in (low,high-.017)]
    surface(circles, [[.84],[1.]], 'stone')
    polygon('stone', circles[1], 1.)
    polygon('stone', circles[0][::-1], .84)


def interp(keys, t):
    v = np.asarray(keys,float)
    i = min(np.searchsorted(v[:,0],t,side='right')-1,len(v)-2)
    a,b = v[i],v[i+1]
    u = (t-a[0])/(b[0]-a[0])
    # Hermite 插值，端点按相邻两站的斜率，极值处保持水平。
    slopes = np.diff(v[:,1:],axis=0)/np.diff(v[:,0:1],axis=0)
    ds = [slopes[0]]
    for l,r in zip(slopes,slopes[1:]):
        ds.append(np.where(l*r>0,2*l*r/np.where(abs(l+r)>1e-9,l+r,1),0))
    ds.append(slopes[-1])
    return (2*u**3-3*u*u+1)*a[1:] + (-2*u**3+3*u*u)*b[1:] + (b[0]-a[0])*((u**3-2*u*u+u)*ds[i]+(u**3-u*u)*ds[i+1])


def petal(angle, hand, stations, thickness, samples=21, gilt=True, iris=False, blade=False):
    # 每截面绕外壁、前刃、内壁、后刃一周。凸脊偏向刃侧，两壁之间保留实体厚度。
    rows, colors = [], []
    for t in np.linspace(0,1,samples):
        y,r,swing,left,right = interp(stations,t)
        half_width=max(.008,r*rad((right+left)/2))
        depth=thickness/1.65 * min(1., .18+half_width/.40)
        e=min(.24,.082/half_width)
        ridge=.23 if iris else -.20
        profile=[(-1+e,.66),(-.82,.88),(-.64,.85),(-.54,.85),(ridge,1.10),(.62,.75),(1-e-min(.14,.048/half_width),.69),(1-e,.61),
                 (1-e*.28,.56),(1,.38),(1,.08),(1,-.34),(1-e*.32,-.50),(1-e,-.55),
                 (.42,-.51),(-.38,-.53),(-1+e,-.55),(-1+e*.27,-.46),(-1,-.29),
                 (-1,.37),(-1+e*.28,.57)]
        row, col=[], []
        for u,d in profile:
            width=left if u<0 else right
            a=angle+hand*rad(swing+u*width)
            bridge=min(1,half_width/.65)*(.22*(1-abs(u-ridge)/(1+abs(ridge))) + .17*math.exp(-((u+.81)/.16)**2))
            twist = -.62*(1-u)/2 * sin(math.pi*t)**.76 if blade else 0
            row.append(polar(r+depth*d+bridge+twist, a, y))
            col.append(min(1.,.84+.2*min(t*4,1)) if d<-.3 else (1. if d>.5 else .94))
        rows.append(row)
        colors.append(col)
    bands=['metal']*len(profile)
    if gilt: bands[6]='accent'
    if hand<0:
        rows=[r[::-1] for r in rows]
        colors=[c[::-1] for c in colors]
        bands=list(np.roll(bands[::-1],-1))
    surface(rows,colors,'metal',bands=bands)
    for end,reverse in [(rows[0],True),(rows[-1],False)]:
        # 封住薄刃的端面。尖端最后一截仍有倒角宽度。
        for i in range(len(end)):
            j=(i+1)%len(end)
            p=[end[i],end[j],np.mean(end,axis=0)]
            if reverse: p.reverse()
            polygon('metal',p,.97)


def cut_crystal(planes):
    normals=np.array([p[0] for p in planes])
    offsets=np.array([p[1] for p in planes])
    triples=np.array(list(itertools.combinations(range(len(planes)),3)))
    matrices=normals[triples]
    valid=abs(np.linalg.det(matrices))>1e-8
    vertices=np.linalg.solve(matrices[valid],offsets[triples[valid]][...,None]).squeeze(2)
    inside=(vertices@normals.T<=offsets+1e-7).all(axis=1)
    vertices=np.unique(np.round(vertices[inside],8),axis=0)
    faces=[]
    for n,d,kind,i in planes:
        ids=np.flatnonzero(abs(vertices@n-d)<1e-6)
        if len(ids)<3: continue
        cloud=vertices[ids]
        center=cloud.mean(axis=0)
        u=cloud[0]-center
        v=np.cross(n/np.linalg.norm(n),u)
        order=np.argsort(np.arctan2((cloud-center)@v,(cloud-center)@u))
        faces.append((ids[order],kind,i))
    return vertices,faces


def gem(y0, y1, radius, sides, phase=0, offset=(0,0), splay=0):
    planes=[]
    for i in range(sides):
        a=phase+i*TAU/sides
        planes.extend([([sin(a),.015,cos(a)],1,'body',i),
                       ([sin(a+.13),1/(1-.49),cos(a+.13)],1/(1-.49),'crown',i),
                       ([sin(a-.12),-1/.37,cos(a-.12)],0,'heel',i)])
    vertices,faces=cut_crystal(planes)
    centered=vertices.copy()
    for axis in (0,2):
        centered[:,axis]-=(vertices[:,axis].min()+vertices[:,axis].max())/2
    pos=centered*np.array((radius,y1-y0,radius))+[offset[0],y0,offset[1]]
    if splay:
        pos[:,0]+=vertices[:,1]*splay*sin(phase)
        pos[:,2]+=vertices[:,1]*splay*cos(phase)
    for ids,kind,i in faces:
        tone={'crown':(1.,.90,.83,1.,.92,.98,.84)[i%7],
              'body':(.75,.93,1.,.80,.72,1.,.77)[i%7],'heel':.83}[kind]
        polygon('crystal',pos[ids],tone)


def main_crystal():
    height=6.32
    belt_y,mid_y,shoulder_y=height/3,.40*height,.70*height
    tip=np.array([.10,math.sqrt(.03)])
    angles=np.radians([4,45,92,142,182,221,269,316])
    radii=np.array([1.39,1.51,1.55,1.37,1.52,1.46,1.55,1.35])
    belt=radii[:,None]*np.column_stack((np.sin(angles),np.cos(angles)))
    belt-=.5*(belt.min(axis=0)+belt.max(axis=0))
    belt*=3./np.ptp(belt[:,0])
    edges=np.roll(belt,-1,axis=0)-belt
    directions=edges/np.linalg.norm(edges,axis=1,keepdims=True)
    normals=np.column_stack((-directions[:,1],directions[:,0]))
    support=np.sum(normals*belt,axis=1)
    lengths=np.array([mid_y-belt_y,shoulder_y-mid_y,height-shoulder_y])
    # 按每个面的水平退距求三段斜率，再将相邻平面相交得到八条主棱。
    low,high=np.zeros(8),np.full(8,rad(55))
    for _ in range(42):
        pitch=((low+high)/2)[:,None]
        slopes=np.tan(pitch-np.radians([18.1,9.3,0.]))
        short=slopes@lengths < support-normals@tip
        low=np.where(short,pitch[:,0],low)
        high=np.where(short,high,pitch[:,0])
    mid=support-slopes[:,0]*lengths[0]
    shoulder=mid-slopes[:,1]*lengths[1]
    sides=np.stack((np.roll(normals,1,axis=0),normals),axis=1)
    rings=[belt*2/3,belt]
    for offsets in (mid,shoulder):
        distances=np.stack((np.roll(offsets,1),offsets),axis=1)
        rings.append(np.linalg.solve(sides,distances[:,:,None])[:,:,0])
    # 两条侧棱沿邻面错位。这让宽面带有斜切面，腰宽和尖顶仍由独立尺寸控制。
    for ring,shift_front,shift_back in zip(rings,[.19,-.36,-.317,-.099],[-.11,.31,.278,.098]):
        ring[7]+=shift_front*directions[7]
        ring[3]+=shift_back*directions[3]
    levels=[0.,belt_y,mid_y,shoulder_y]
    rings=[np.column_stack((r[:,0],np.full(8,6.5+y),r[:,1])) for r,y in zip(rings,levels)]
    polygon('crystal',rings[0][::-1],.83)
    shades=[[.81,.95,.84,.77,.91,.83,.95,.76],
            [.88,.75,.98,.81,.91,1.,.76,.88],
            [.78,.92,.86,.97,.74,.83,.98,.77],
            [.97,.83,.95,.77,1.,.88,.79,1.]]
    for band,(a,b) in enumerate(zip(rings,rings[1:])):
        for i in range(8):
            j=(i+1)%8
            if i in (2,6):
                faces=([a[i],a[j],b[j]],[a[i],b[j],b[i]])
                if i==2: faces=([a[i],a[j],b[i]],[a[j],b[j],b[i]])
                polygon('glow' if i==6 and band==1 else 'crystal',faces[0],
                        .98 if (band+i)%2==0 else .76)
                polygon('crystal',faces[1],.72 if (band+i)%2==0 else .99)
            else:
                polygon('crystal',[a[i],a[j],b[j],b[i]],shades[band][i])
    apex=np.array([tip[0],12.82,tip[1]])
    for i in range(8):
        polygon('crystal',[rings[-1][i],rings[-1][(i+1)%8],apex],shades[-1][i])


def orbit(radius, y, count, phase, width, depth, gap, tilt):
    corners=[(-width/2,-depth/2),(width/2,-depth/2),(width/2,depth/2),(-width/2,depth/2)]
    cross=rounded_path(corners,.033,3)
    for k in range(count):
        start=phase+k*TAU/count+gap/2
        end=start+TAU/count-gap
        angles=np.linspace(start,end,24)
        # 每个断环有实体截面和封闭的切口。
        rows=[[polar(radius+r,a,y+h+tilt*sin(a-.2)) for a in angles] for r,h in [*cross,cross[0]]]
        surface(rows,1.,'metal',closed=False)
        for a,reverse in [(start,False),(end,True)]:
            cap=[polar(radius+r,a,y+h+tilt*sin(a-.2)) for r,h in cross]
            polygon('metal',cap[::-1] if reverse else cap,.92)


def cut_block(material, angle, levels, bevel):
    # 台阶包角、灯座石脚的截面都是切去四角的实心方块。
    cross=rounded_path([(-1,-.66),(-.68,-1),(.68,-1),(1,-.66),
                        (1,.66),(.68,1),(-.68,1),(-1,.66)],bevel,2)[::-1]
    rows=[]
    for y,r,w,d in levels:
        row=[]
        for x,z in cross:
            p=polar(r+d*z,angle,y)
            p += np.array((cos(angle)*x*w,0,-sin(angle)*x*w))
            row.append(p)
        rows.append(row)
    surface(rows,[[.87] if i==0 else [1.] for i in range(len(rows))], material)
    polygon(material,rows[-1],1.)
    polygon(material,rows[0][::-1],.84)


def clasp(a, front):
    # 厚包角跨过台阶上沿，正面的一块向中心收出尖顶。
    ytop=2.35 if front else 2.18
    for offset, material, scale in [(0,'accent',1.),(.025,'metal',.85)]:
        cut_block(material,a,[(1.62+offset,3.49+offset,.29*scale,.16),
                              (1.68+offset,3.50+offset,.31*scale,.21),
                              (1.94+offset,3.49+offset,.30*scale,.21),
                              (2.04+offset,3.47+offset,.29*scale,.19),
                              (ytop+offset,3.39,(.045 if front else .21)*scale,.11)],.095)


def silhouette(stations, y):
    keys = np.asarray(stations, float)
    levels, values = keys[:, 0], keys[:, 1:]
    secants = np.diff(values, axis=0) / np.diff(levels)[:, None]
    a, b = secants[:-1], secants[1:]
    middle = np.divide(2*a*b, a+b, out=np.zeros_like(a), where=a*b>0)
    tangents = np.vstack((secants[0], middle, secants[-1]))
    k = np.clip(np.searchsorted(levels, y, side='right')-1, 0, len(keys)-2)
    h = (levels[k+1]-levels[k])[:, None]
    t = (y-levels[k])[:, None]/h
    return ((2*t**3-3*t**2+1)*values[k] + (t**3-2*t**2+t)*h*tangents[k]
            + (-2*t**3+3*t**2)*values[k+1] + (t**3-t**2)*h*tangents[k+1])


def rounded_plate(half_width, y0, y1, depth, fillet, xs, heights, form, gild, rim_cuts=()):
    # 在局部米制坐标中做圆角，再把整片弯成瓣或刀。弯曲的雅可比矩阵决定圆面的法线。
    low = np.array([-half_width, y0, -depth/2])
    high = np.array([half_width, y1, depth/2])
    axes = []
    for lo, hi, interior in zip(low, high, [xs, heights, rim_cuts]):
        cuts=[lo,lo+fillet,*interior,hi-fillet,hi]
        if len(axes)<2: cuts.extend([lo+.45*fillet,hi-.45*fillet])
        axes.append(np.unique(np.round(cuts,8)))
    for fixed, horizontal, vertical in [(2,0,1),(0,1,2),(1,2,0)]:
        for sign in (-1,1):
            h,v = np.meshgrid(axes[horizontal],axes[vertical])
            corners = np.zeros((*h.shape,3))
            corners[:,:,fixed] = high[fixed] if sign==1 else low[fixed]
            corners[:,:,horizontal], corners[:,:,vertical] = h,v
            corners = corners.reshape(-1,3)
            inset = np.clip(corners,low+fillet,high-fillet)
            normal = corners-inset
            normal /= np.linalg.norm(normal,axis=1,keepdims=True)
            q = inset + fillet*normal
            p = form(q)
            derivatives=[]
            for axis in np.eye(3)*.0001:
                derivatives.append((form(q+axis)-form(q-axis))/.0002)
            dx,dy,dz=derivatives
            n = (np.cross(dy,dz)*normal[:,0,None]+np.cross(dz,dx)*normal[:,1,None]
                 +np.cross(dx,dy)*normal[:,2,None])
            n /= np.linalg.norm(n,axis=1,keepdims=True)
            j,i=np.mgrid[0:h.shape[0]-1,0:h.shape[1]-1]
            a=(j*h.shape[1]+i).ravel()
            b,c,d=a+1,a+h.shape[1]+1,a+h.shape[1]
            tris=np.stack((a,b,c,a,c,d),axis=1).reshape(-1,3)
            if sign<0: tris=tris[:,::-1]
            center=(corners[a]+corners[c])/2
            gold=np.repeat(gild(center,fixed,sign),2)
            shade=np.where(normal[:,2]<-.5,.86,1.)
            for mask,material in [(~gold,'metal'),(gold,'accent')]:
                if not mask.any(): continue
                ids,idx=np.unique(tris[mask],return_inverse=True)
                append(material,p[ids],n[ids],shade[ids],idx.reshape(-1,3))


BUD = [(1.78,2.20),(2.06,2.40),(2.58,2.60),(3.20,2.70),(3.78,2.69),
       (4.42,2.59),(5.02,2.37),(5.55,2.04),(5.95,1.72),(6.20,1.50)]


def bud_panel(angle):
    half=.90
    curl=[*BUD[:6],(5.52,1.96),(5.86,1.68),(6.19,1.50),
          (6.40,1.53),(6.63,1.60),(6.87,1.72)]
    widths=[(1.78,1.),(4.42,1.),(5.08,1.07),(5.50,1.03),(5.86,.89),
            (6.19,.71),(6.40,.55),(6.63,.32),(6.87,.032)]
    stagger=cos(4*(angle-rad(22.5)))
    def form(q):
        x,y,z=q.T
        u=x/half
        r=silhouette(curl,y)[:,0]
        slope=(silhouette(curl,y+.001)[:,0]-silhouette(curl,y-.001)[:,0])/.002
        length=np.hypot(1.,slope)
        top=np.clip((y-4.42)/(6.87-4.42),0.,1.)
        width=silhouette(widths,y)[:,0]
        v=np.minimum(1.,(y-1.78)/4.42)
        edge=(.085+.060*np.sin(np.pi*v)**2)*u**2
        depth=(z-.15)*np.minimum(1.,.28+width/.72)
        shoulder=np.sin(math.pi*top)**2
        shell=r-edge*width+depth/length+.165*u*shoulder
        seam_r=r-.085-.060*np.sin(np.pi*v)**2+depth/length
        half_angle=(math.pi/8-np.arcsin(.060/seam_r))*width
        turn=.175*np.sin(math.pi*v)-.025*v + rad(11)*top**2
        a=angle+u*half_angle+turn
        h=y-depth*slope/length-.15*top*width*u**2+stagger*.12*top**2
        return np.column_stack((shell*np.sin(a),h,shell*np.cos(a)))
    def gild(q,fixed,sign):
        # 金边沿翻瓣上沿的两翼汇到瓣尖。
        return (q[:,1]>5.50)&(abs(q[:,0])>.803)&(abs(q[:,0])<.841)&(fixed==2)&(sign==1)
    heights=[2.06,2.58,3.2,3.78,4.42,5.08,5.50,5.86,6.19,6.40,6.63]
    rounded_plate(half,1.78,6.87,.30,.060,[-.803,-.48,0,.48,.803],heights,form,gild)


BLADE = [(1.60,2.40,.87,0),(2.26,2.97,1.13,-3),(3.08,3.43,1.31,-3.7),
         (3.92,3.78,1.38,-1),(4.70,3.99,1.38,4.2),(5.20,4.06,1.37,8.5),
         (5.50,4.08,1.35,10.3),(5.84,4.055,1.31,11.4),(5.98,4.025,1.04,11.5),
         (6.30,3.94,.92,11.0),(6.62,3.80,.74,9.5),(6.95,3.60,.46,6.1),
         (7.30,3.30,.032,.8)]


def crescent(angle, hand):
    def form(q):
        x,y,z=q.T
        r,w,turn=silhouette(BLADE,y).T
        a=angle+hand*np.radians(turn)
        er=np.column_stack((np.sin(a),np.zeros_like(a),np.cos(a)))
        et=np.column_stack((np.cos(a),np.zeros_like(a),-np.sin(a)))
        lift=np.clip((y-4.6)/1.70,0.,1.)[:,None]
        radial=.89-.07*lift if abs(angle)>rad(65) else .68-.24*lift
        tangential=np.sqrt(1-radial**2)
        side=radial*er+hand*tangential*et
        normal=tangential*er-hand*radial*et
        u=hand*x/.65
        # 外沿向外张开。内沿的台阶由刀宽的变化形成，刀面有一个宽折面。
        folds=[-1.,-.74,-.12,-.045,.025,.105,.73,1.]
        relief=[-.084,-.031,.110,.127,.129,.115,-.027,-.092]
        taper=np.clip(w/.90,.095,1.)
        swell=np.minimum(1.,w/.65)
        camber=np.interp(u,folds,relief)*swell
        d=z*taper+camber

        # 刀腹的折面与圆刃都计入外缘。把截面整体放回设计半径，宽度和厚度保持原值。
        rim=np.array([-1.,-.97,-.90,*folds[1:-1],.90,.97,1.])
        corner=np.maximum(0.,.65*np.abs(rim)-(.65-.066))
        face=.16-.066+np.sqrt(np.maximum(0.,.066**2-corner**2))
        off=(rim-1)*w[:,None]/2
        crown=face*taper[:,None]+np.interp(rim,folds,relief)*swell[:,None]
        dr=radial*off+tangential*crown
        dt=tangential*off-radial*crown
        base=np.min(np.sqrt(r[:,None]**2-dt**2)-dr,axis=1)
        # 1.60 米处用根部中心定位。出石台以后用刀的外缘定位。
        root_off=-w[:,None]/2
        root_camber=np.interp(0.,folds,relief)*swell[:,None]
        root_r=(np.sqrt(r[:,None]**2-(tangential*root_off-radial*root_camber)**2)
                -radial*root_off-tangential*root_camber)[:,0]
        blend=np.clip((y-1.60)/1.2,0.,1.)
        base=root_r+(base-root_r)*blend**2*(3-2*blend)
        p=er*base[:,None]+side*((u-1)*w/2)[:,None]+normal*d[:,None]
        p[:,1]=y
        return p
    def gild(q,fixed,sign):
        return ((hand*q[:,0]>=.525)&(hand*q[:,0]<.58)&(fixed==2)
                | (q[:,2]>-.018)&(q[:,2]<.025)&(fixed==0)&(sign==hand))
    cuts=sorted([hand*v for v in [-.475,-.078,-.030,.016,.472,.525,.58]])
    heights=[2.26,3.08,3.92,4.70,5.20,5.50,5.84,5.91,5.98,6.30,6.62,6.95,7.12]
    rounded_plate(.65,1.60,7.30,.32,.066,cuts,heights,form,gild,(-.018,.025))


def front_v():
    # 一块青铜搭在正面刀根之间。V 的最低点落在台面包角后。
    outline=[(-.26,-.13,.85),(-.16,-.24,.89),(.025,-.34,.91),(.13,-.29,.95),
             (.26,-.135,1.),(.285,-.07,1.),(.287,-.023,1.),(.27,.01,.95),
             (.25,.04,.91),(.24,.069,.95),(.221,.101,1.),(.190,.136,1.),
             (.148,.176,1.),(-.042,.332,1.),(-.102,.342,1.),(-.228,.254,.95),
             (-.27,.15,.91)]
    rows=[]
    angles=np.linspace(-rad(44),rad(44),41)
    for d,h,tone in [*outline,outline[0]]:
        row=[]
        for a in angles:
            u=abs(a/rad(44))
            y=2.20+1.34*(.65*u+.35*u**2)
            r=2.82+.12*u
            row.append(polar(r+d,a,y+h*(1-.20*u)))
        rows.append(row)
    bands=np.full((len(outline),1),'metal',dtype='<U6')
    bands[11]='accent'
    surface(rows,[[tone] for d,h,tone in [*outline,outline[0]]],'metal',closed=False,bands=bands)
    for i in [0,-1]:
        cap=[row[i] for row in rows[:-1]]
        polygon('metal',cap if i==0 else cap[::-1],.96)



def create_body():
    global section
    sector_course(1.5,4.57,0,.18,6,rad(18),.053)
    sector_course(1.20,4.17,.17,.98,6,rad(-10),.095)
    sector_course(1.06,3.68,.97,1.80,6,rad(19),.10)
    revolve('metal',[(3.32,1.775),(3.51,1.775),(3.50,1.820),(3.46,1.852),(3.33,1.83)],72,.016)
    for i in range(4): clasp(i*TAU/4,i==0)
    # 石胎逐层收小，石顶盖住轴心，废墟保留完整承台。
    for j,(bottom,top,r) in enumerate([(1.76,2.89,2.34),(2.88,4.04,2.13),(4.03,5.25,1.43),(5.24,6.15,1.04)]):
        sector_course(.38,r,bottom,top,4,rad(j*45),.10)
    revolve('metal',[(2.06,1.77),(2.40,1.77),(2.51,1.90),(2.47,2.05),(2.21,2.13)],56,.06)
    section='bud'
    for i in range(8):
        bud_panel(rad(22.5+45*i))
    # 晶座藏在壳后。八条接缝共用同一层切面。
    rows=[]
    angles=np.linspace(0,TAU,65)[:-1]
    for y,r in [(y-.02,r-.20) for y,r in BUD]+[(6.44,1.03),(6.75,.84)]:
        rows.append([polar(r,a,y) for a in angles])
    surface(rows,.88,'crystal')
    polygon('crystal',rows[-1],.93)
    polygon('crystal',rows[0][::-1],.82)
    section='blades'
    for deg in (40,108,153,-40,-108,-153):
        hand=1 if deg>0 else -1
        crescent(rad(deg),-hand if abs(deg)>80 else hand)
    section='front_crest'
    front_v()


def create_lamp():
    outline=rounded_path([(.65,-1),(1,-.65),(1,.65),(.65,1),(-.65,1),(-1,.65),(-1,-.65),(-.65,-1)],.065,2)
    # 在 XZ 平面，从 +Z 往 +X 为外壳的正绕向。
    foot=list(reversed(outline))
    revolve('stone',[(0,0),(.602,0),(.613,.075),(.493,.14),(.443,.39),(.36,.47),(0,.47)],fillet=.045,footprint=foot)
    revolve('stone',[(0,.35),(.43,.35),(.44,.64),(.35,1.42),(.37,1.68),(.46,1.83),
                     (.46,1.96),(.36,2.04),(0,2.04)],24,.054)
    revolve('metal',[(.36,.092),(.603,.092),(.622,.145),(.619,.25),(.575,.38),(.42,.50),(.36,.50)],24,.034)
    for i in range(4):
        a=rad(45+i*90)
        cut_block('stone',a,[(.03,.55,.172,.174),(.09,.55,.185,.187),
                             (.23,.54,.179,.186),(.58,.47,.152,.137),(.71,.425,.120,.112)],.12)
    revolve('metal',[(.355,1.59),(.397,1.58),(.432,1.65),(.44,1.76),(.40,1.80),(.355,1.79)],24,.03)
    for i in range(4):
        a=rad(45+i*90)
        prong=[(0,1.64,.36,0,25,25),(.32,1.86,.46,0,24,23),(.59,2.13,.47,0,19,18),
               (.81,2.43,.42,0,13,12),(1,2.67,.34,1,2,2)]
        petal(a,1,prong,.15,9)
    gem(1.98,3.04,.285,6,rad(12))


def save():
    materials=list(dict.fromkeys(k[1] for k in PARTS))
    doc={'asset':{'version':'2.0','generator':'B / 沉月会水晶'},'scene':0,'scenes':[{'nodes':[]}],
         'nodes':[],'meshes':[],'materials':[{'name':k} for k in materials],
         'buffers':[],'bufferViews':[],'accessors':[]}
    binary=bytearray()
    def accessor(data,dtype,kind,component,target,limits=False,normalized=False):
        a=np.ascontiguousarray(data,dtype=dtype)
        binary.extend(bytes((-len(binary))%4))
        view=len(doc['bufferViews'])
        doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':a.nbytes,'target':target})
        binary.extend(a.tobytes())
        entry={'bufferView':view,'componentType':component,'count':len(a),'type':kind}
        if limits: entry.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
        if normalized: entry['normalized']=True
        doc['accessors'].append(entry)
        return len(doc['accessors'])-1
    for name in dict.fromkeys(k[0] for k in PARTS):
        parent={'name':name,'children':[]}
        doc['scenes'][0]['nodes'].append(len(doc['nodes']))
        doc['nodes'].append(parent)
        for (part,mat),(p,n,c,tri) in PARTS.items():
            if part!=name: continue
            rgba=np.ones((len(p),4),dtype=np.uint8)*255
            rgba[:,:3]=np.rint(np.array(c)[:,None]*255).astype(np.uint8)
            attrs={'POSITION':accessor(p,'<f4','VEC3',5126,34962,True),
                   'NORMAL':accessor(n,'<f4','VEC3',5126,34962),
                   'COLOR_0':accessor(rgba,'u1','VEC4',5121,34962,normalized=True)}
            indices=np.asarray(tri).ravel()
            dt,code=('<u4',5125) if len(p)>65535 else ('<u2',5123)
            geo={'attributes':attrs,'indices':accessor(indices,dt,'SCALAR',code,34963),'material':materials.index(mat)}
            index=len(doc['meshes'])
            doc['meshes'].append({'primitives':[geo]})
            parent['children'].append(len(doc['nodes']))
            doc['nodes'].append({'name':f'piece_{index:02d}_{mat}','mesh':index})
    binary.extend(bytes((-len(binary))%4))
    doc['buffers']=[{'byteLength':len(binary)}]
    meta=json.dumps(doc,separators=(',',':')).encode()
    meta+=b' '*((-len(meta))%4)
    blob=struct.pack('<4sII',b'glTF',2,28+len(meta)+len(binary))+struct.pack('<I4s',len(meta),b'JSON')+meta
    blob+=struct.pack('<I4s',len(binary),b'BIN\0')+binary
    (ROOT/'out'/'core_me.glb').write_bytes(blob)
    print(sum(len(data[3]) for data in PARTS.values()),'triangles')


if __name__=='__main__':
    create_body()
    section='crystal'
    main_crystal()
    for deg,top,size,distance in [(-16,8.46,.48,1.39),(164,8.46,.48,1.39),(-43,8.52,.43,1.28)]:
        a=rad(deg)
        p=polar(distance,a,0)
        gem(6.51,top,size,6,a,(p[0],p[2]),splay=.43 if distance>1.3 else .36)
    section='ring'
    orbit(2.81,10.43,4,rad(9),.150,.145,rad(12),.06)
    orbit(2.67,9.49,3,rad(-3),.114,.116,rad(11),-.05)
    for i in range(4):
        a=rad(9)+i*TAU/4
        p=polar(2.81,a,10.43+.06*sin(a-.2))
        gem(p[1]-.28,p[1]+.30,.167,5,a,(p[0],p[2]))
    a=rad(-3)
    p=polar(2.67,a,9.49-.05*sin(a-.2))
    gem(p[1]-.24,p[1]+.25,.142,5,a,(p[0],p[2]))
    for i in range(4):
        section=f'lantern_{i+1}'
        origin=polar(5.6,rad(45+i*90),0)
        create_lamp()
    save()
