import io
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.interpolate import PchipInterpolator, CubicSpline
from scipy.ndimage import gaussian_filter


ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'out'
OUT.mkdir(exist_ok=True)
ROUND = int(sys.argv[1]) if len(sys.argv) > 1 else 5
rng = np.random.default_rng(1138)
pi, sin, cos = math.pi, math.sin, math.cos
stone, jade, gold, shadow, seam, aqua, prism, gleam = range(8)
palette = [(202,187,162),(80,119,100),(189,164,105),(70,76,61),
           (151,138,116),(40,222,226),(44,221,235),(171,252,251)]
if ROUND>=3:palette[:3]=[(198,185,170),(78,110,92),(176,151,94)]
materials = ['Honed moonstone','Verdigris enamel','Worn champagne brass','Recessed bronze',
             'Stone cut faces','Underlit turquoise','Tideglass facets','Crystal caustics']
meshes = defaultdict(lambda: defaultdict(lambda: [[],[],[],[],[]]))
group = '01 | Foundation'


def texture(kind):
    size = 512
    local = np.random.default_rng(131+kind)
    noise = local.normal(size=(size,size))
    def field(width):
        f = gaussian_filter(noise,width,mode='wrap');return f/f.std()
    broad,brush = field(29),field((3,10))
    tone = broad*4.6+brush*2.2+field(1.7)*1.3
    if ROUND>=3:tone=tone*1.28+np.round(field((9,4))*1.5)*1.1
    color = np.array(palette[kind])[None,None,:]+tone[:,:,None]
    if kind==jade:
        patina=np.maximum(0,broad-.10)[:,:,None];color+=patina*[-5,8,8]
    img=Image.fromarray(np.uint8(np.clip(color,0,255))).convert('RGBA')
    paint=Image.new('RGBA',img.size); draw=ImageDraw.Draw(paint)
    for _ in range(1900):
        x,y=local.integers(0,size,2); length=local.uniform(3,26);h=local.uniform(.6,3.5)
        dy=local.uniform(-8,2); pts=[(x,y),(x+.5*length,y+dy*.5-h),(x+length,y+dy),(x+.4*length,y+dy*.4+h)]
        tint=(250,230,181,19) if local.random()<.50 else (39,56,48,15)
        draw.polygon(pts, fill=tint)
    if kind in [stone,seam,jade]:
        for _ in range((37 if ROUND>=4 else 15) if kind!=jade else 7):
            x,y=local.uniform(32,414,2); coords=[(x,y)]
            for k in range(local.integers(3,8)):
                x+=local.uniform(1,9);y+=local.uniform(-10,4);coords.append((x,y))
            draw.line([(a,b+1) for a,b in coords], fill=(247,232,189,76),width=1)
            draw.line(coords,fill=(56,57,47,73),width=1)
            a,b=coords[2];draw.line([(a,b),(a-3,b-5),(a-3,b-9)],fill=(47,55,49,46))
    buf=io.BytesIO();Image.alpha_composite(img,paint).convert('RGB').save(buf,'JPEG',quality=92);return buf.getvalue()


def gem_paint():
    size=512;local=np.random.default_rng(106);y,x=np.mgrid[0:size,0:size]/size
    f=np.minimum(1,np.maximum(0,.39+.17*np.cos(2*pi*(x*3+y*.7))+.14*np.sin(2*pi*(x*5-y*1.2))+.31*np.exp(-((y-.36)/.19)**2)-.16*np.exp(-((y-.64)/.13)**2)))
    stops=[0,.32,.59,.83,1];colors=np.array([[2,99,135],[3,166,180],[10,207,221],[91,242,239],[174,253,243]])
    image=Image.fromarray(np.uint8(np.stack([np.interp(f,stops,colors[:,i]) for i in range(3)],axis=2))).convert('RGBA');layer=Image.new('RGBA',image.size);pen=ImageDraw.Draw(layer)
    for _ in range(70):
        px,py=local.uniform(0,512,2);length=local.uniform(8,52);pts=[(px,py),(px+length*.34,py-length*.75),(px+length*.46,py-length),(px+length*.40,py-length*.43),(px+2,py+4)];pen.polygon(pts,fill=(194,255,248,int(local.uniform(9,40))))
    buf=io.BytesIO();Image.alpha_composite(image,layer).convert('RGB').save(buf,'JPEG',quality=94);return buf.getvalue()


def polar(angle,r,z,t=0):
    return np.array([r*cos(angle)-t*sin(angle),r*sin(angle)+t*cos(angle),z])


def patch(grid,mat,shade=1,flip=False,flat=False,colors=None):
    p=np.asarray(grid,dtype=float); rows,cols=p.shape[:2]; dst=meshes[group][mat]
    n=np.cross(np.gradient(p,axis=1),np.gradient(p,axis=0));n/=np.maximum(1e-9,np.linalg.norm(n,axis=-1,keepdims=True))
    if flip:n=-n
    def add(pos,norm,col):
        dst[0].append((pos[0],pos[2],-pos[1]));dst[1].append((norm[0],norm[2],-norm[1]));dst[2].append(col)
        if mat in (aqua,prism) and ROUND>=4:
            dst[3].append(((math.atan2(pos[1],pos[0])/(2*pi))%1,(7.50-pos[2])/1.50 if mat==prism else -.81*pos[2]))
        else:dst[3].append(((pos[0]*.81+pos[1]*.58)/1.7,(pos[2]+.31*pos[1]-.27*pos[0])/1.7))
    start=len(dst[0]);base=np.ones(3)*shade
    if not flat:
        for j in range(rows):
            for k in range(cols):add(p[j,k],n[j,k],base if colors is None else colors[j,k])
    for j in range(rows-1):
        for k in range(cols-1):
            for ids in [[(j,k),(j,k+1),(j+1,k+1)],[(j,k),(j+1,k+1),(j+1,k)]]:
                if flip:ids.reverse()
                if flat:
                    a,b,c=[p[i] for i in ids];normal=np.cross(b-a,c-a);length=np.linalg.norm(normal)
                    if length<1e-9:continue
                    first=len(dst[0]); col=base*rng.uniform(.90,1.0)
                    for i in ids:add(p[i],normal/length,col if colors is None else colors[i])
                    dst[4].extend([first,first+1,first+2])
                else:dst[4].extend(start+y*cols+x for y,x in ids)


def lathe(profile,mat,count=72,shade=1,phase=0):
    th=np.linspace(phase,phase+2*pi,count+1);patch([[polar(a,r,z) for a in th] for z,r in profile],mat,shade)


def course(z0,z1,r0,r1,count,phase,bevel=.023):
    edges=np.linspace(phase,phase+2*pi,count+1);edges[1:-1]+=rng.uniform(-.065,.065,count-1)
    for a,b in zip(edges,edges[1:]):
        v=rng.uniform(.84,1); dr=rng.uniform(-.013,.011); dz=rng.uniform(-.009,.009)
        if ROUND>=3:dr*=1.55;dz*=1.8
        if ROUND>=4:bevel=(.047 if z0>0 else .036)*rng.uniform(.81,1.19)
        ring=[]
        for z,r,inset in [(z0,r0-bevel,1),(z0+bevel,r0,.25),(z1-bevel,r1,.25),(z1+dz,r1-bevel,1)]:
            aa=a+.005+inset*.012;bb=b-.005-inset*.012
            ring.append([polar(t,r+dr+.004*sin(t*24),z+(.009*cos(17*t)*inset if ROUND>=3 and z0>0 else 0)) for t in np.linspace(aa,bb,7)])
        patch(ring,stone,v);ri=min(r0,r1)-.19
        for row,sgn in [(ring[-1],1),(ring[0],-1)]:
            inside=[p*np.array([ri/(np.hypot(*p[:2])),ri/(np.hypot(*p[:2])),1]) for p in row];patch([row,inside],stone,v,flip=sgn<0)
        for k in (0,-1):
            line=[row[k] for row in ring];patch([[p,p*np.array([ri/np.hypot(*p[:2]),ri/np.hypot(*p[:2]),1])] for p in line],seam,v,flip=k==0)
        patch([[polar(t,ri,z) for t in np.linspace(a+.005,b-.005,7)] for z in [z0,z1]],seam,v,flip=True)


def spline(rows):
    data=np.array(rows);return PchipInterpolator(data[:,0],data[:,1:],axis=0)


course(0,.235,1.68,1.69,15,.08,.032)
lathe([(0,.005),(0,1.52),(.21,1.53),(.238,1.51),(.24,.005)],seam)
group='02 | Bell and sabatons'
bell=spline([(.22,1.47),(.30,1.49),(.39,1.43),(.52,1.39),(.82,1.31),(1.06,1.18),(1.21,1.0),(1.30,.83)])
lathe([(z,float(bell(z)[0])) for z in np.linspace(.22,1.30,32)],jade)
lathe([(.23,1.47),(.25,1.495),(.31,1.49),(.325,1.46)],gold,shade=.82)
lathe([(1.17,1.03),(1.20,1.06),(1.26,1.04),(1.29,.89)],gold)


def rail(surface, coords, mat,width, height=None, taper=True,shade=1):
    points=np.array(coords); total=np.r_[0,np.cumsum(np.linalg.norm(np.diff(points,axis=0),axis=1))];total/=total[-1]
    samples=np.linspace(0,1,max(10,len(coords)*4));uv=CubicSpline(total,points)(samples);pos=[]
    for i,(u,v) in enumerate(uv):
        pt=surface(u,v); tangent=surface(*uv[min(i+1,len(uv)-1)])-surface(*uv[max(i-1,0)]);tangent/=max(1e-9,np.linalg.norm(tangent))
        normal=np.cross(surface(u+.001,v)-surface(u-.001,v),surface(u,v+.001)-surface(u,v-.001));normal/=max(1e-9,np.linalg.norm(normal));side=np.cross(tangent,normal)
        fac=(.08+.92*sin(pi*samples[i])**.48) if taper else 1
        pos.append([pt+fac*(side*width*s+normal*(height if height is not None else width)*h) for s,h in [(-1,-.12),(-.75,.46),(0,1),(.72,.51),(1,-.12)]])
    patch(pos,mat,shade,flip=ROUND==1)


def shell(surface,opening=None):
    vv=np.linspace(0,1,55);uu=np.array([-1,-.92,-.78,-.38,0,.38,.78,.92,1]);p=np.array([[surface(u,v) for u in uu] for v in vv]);
    if opening:
        for side in [-1,1]:
            part=[];cut=[]
            for v in vv:
                gap=opening(v);xs=np.linspace(-1,-gap,7) if side<0 else np.linspace(gap,1,7);part.append([surface(u,v) for u in xs]);pt=surface(side*gap,v);cut.append([pt,pt*np.array([.945,.945,1])]);
            patch(part,jade);patch(cut,gold,.80,flip=side==1)
        inside=np.array([[surface(u,v)*np.array([.94,.94,1]) for u in uu] for v in vv]);
        if ROUND>=4:
            for i in range(len(vv)):
                for k,u in enumerate(uu):inside[i,k,:2]*=1+.034*(1-abs(u))+.011*sin(i*.33+u*4)
        patch(inside,aqua,.86)
    else:patch(p,jade)
    for k in (0,-1):
        line=p[:,k,:];back=line.copy();back[:,:2]*=.92;patch(np.stack([line,back],axis=1),shadow,flip=k==0)
        rail(surface,[(uu[k]*.94,v) for v in np.linspace(0,1,9)],gold,.016,.009,False)
    if ROUND>=2:
        back=p*np.array([.915,.915,1]);patch(back,jade,.72,flip=True)
        for k in (0,-1):patch([p[k],back[k]],gold,.88,flip=k==0)


def flourish(surface,pts,width=.025):
    rail(surface,pts,shadow,width*1.60,.010,shade=.77)
    rail(surface,pts,gold,width,.022,shade=.91)


def cabochon(origin,major,minor,normal,scale=1):
    for rings,mat in [([(1,-.008),(.95,.023),(.77,.029),(.68,.010)],gold),([(.69,.010),(.60,.026),(.20,.042),(.001,.046)],aqua)]:
        grid=[[origin+size*(cos(t)*major+sin(t)*minor)+normal*lift*scale for t in np.linspace(0,2*pi,17)] for size,lift in rings];patch(grid,mat,flip=np.dot(np.cross(major,minor),normal)<0)


for j in range(8):
    a=2*pi*j/8-1.51
    def boot(u,v):
        z=.245+1.04*v;w=.235*(1-.55*sin(pi*v))*(1-.58*v**6);r=bell(z)[0]+.037+.13*(1-u*u)+.032*cos(v*pi*2);return polar(a,r,z,u*w)
    shell(boot)
    if ROUND>=2:
        flourish(boot,[(-.76,.04),(-.36,.15),(.28,.25),(.47,.36),(.24,.48),(.2,.41)],.018)
        flourish(boot,[(.69,.19),(.14,.33),(-.24,.46),(-.38,.65),(-.16,.73),(0,.66),(-.08,.62)],.019)
        flourish(boot,[(-.65,.92),(-.19,.83),(0,.76),(.19,.84),(.68,.92)],.019)
    if ROUND>=3:
        def girdle(u,v):
            z=.27+v*.96;ang=a+pi/8+u*.363;return polar(ang,bell(z)[0]+.014,z)
        flourish(girdle,[(-1,.73),(-.61,.83),(-.16,.79),(.22,.81),(.53,.91),(.78,.92),(1,.88)],.019)
        flourish(girdle,[(-.99,.09),(-.65,.08),(-.38,.14),(-.27,.35),(-.33,.46),(-.46,.49),(-.54,.44),(-.48,.416)],.015)
        if j%2==0:
            def cut(u,v):
                p=girdle(u,v);return p*np.array([1.012,1.012,1])
            path=[(-.94,.875),(-.47,.811),(-.02,.780),(.32,.70),(.55,.60),(.72,.72),(.82,.85)]
            rail(cut,path,gold,.058,.014);rail(cut,path,aqua,.042,.026)

group='03 | Carved limestone lantern'
lower_profile=[(1.18,.91),(1.24,.94),(1.33,.92),(1.40,.84),(1.98,.76),(2.35,.79),(2.56,.84)]
lathe(lower_profile+([] if ROUND>=5 else [(2.70,.84),(2.76,.72),(3.0,.77)]),stone)
course(1.30,1.46,.91,.87,8,.16);course(2.41,2.57,.82,.85,9,.1)
lathe([(2.55,.78),(2.59,.79),(2.73,.77),(2.75,.72)],aqua,shade=.78)
lathe([(2.70,.80),(2.75,.82),(2.89,.88),(2.99,1.02)],stone)
if ROUND>=4:
    lower=spline([(1.38,.85),(1.56,.827),(1.98,.777),(2.34,.792),(2.43,.815)])
    for j in range(7):
        a=2*pi*j/7-.37
        def leaf(u,v):
            z=1.40+1.02*v;return polar(a+u*.44,lower(np.clip(z,1.38,2.43))[0]+.007,z)
        us=np.linspace(-1,1,11);vs=np.linspace(0,1,13)
        def scroll(u,v):
            t=v*.83+.02;theta=-.53+1.46*t-.48*sin(t*pi);w=.58*(1-.76*t)*(.30+.70*sin(pi*(.04+.96*t))**.7);pt=leaf(theta+w*u,t);pt[:2]*=1+.072*(1-u*u);return pt
        patch([[scroll(u,v) for u in us] for v in vs],stone,.94)
        rail(leaf,[(-.80,.06),(-.38,.14),(.26,.31),(.61,.52),(.58,.68),(.28,.76),(.02,.705),(.09,.61),(.32,.61)],stone,.059,.050)
    lathe([(2.55,.78),(2.565,.818),(2.59,.81)],seam)
course(2.96,3.23,1.06,1.09,11,-.13,.035)
shaft=spline([(3.19,.77),(3.32,.82),(3.52,.72),(3.83,.64),(4.38,.62),(4.78,.66),(5.16,.75),(5.44,.80),(5.65,.77)])
lathe([(3.08,.53),(5.72,.54)],aqua)
for j in range(6):
    a=2*pi*j/6-(.80 if ROUND>=4 else .37)
    vlist=np.linspace(0,1,55)
    def window(v):
        if ROUND>=3:
            def lancet(center,span,width):return width*max(0,1-abs((v-center)/span)**1.58)**.72
            return lancet(.54,.118,.22)+lancet(.818,.113,.27)
        x=(v-.64)/.19;return .21*max(0,1-abs(x)**1.52)**.73
    def pier(u,v):
        z=3.20+2.44*v;r=shaft(np.clip(z,3.19,5.65))[0];return polar(a+u+.085*sin(2*pi*v),r+.027*cos(6*u),z)
    for side in [-1,1]:
        rows=[]; inner=[]
        for v in vlist:
            edge=window(v); us=np.linspace(-pi/6+.004,-edge,9) if side<0 else np.linspace(edge,pi/6-.004,9)
            rows.append([pier(u,v) for u in us]);p=pier(side*edge,v);inner.append([p,p*np.array([.86,.86,1])])
        patch(rows,stone,.96);patch(inner,seam,.82,flip=side==-1)
    if ROUND>=3:
        for sign in [-1,1]:
            rail(pier,[(sign*.39,.008),(sign*.32,.07),(sign*.22,.16),(sign*.24,.30),(sign*.27,.42),(sign*.30,.56),(sign*.22,.634),(sign*.04,.681)],stone,.075,.069)
            rail(pier,[(sign*.485,.48),(sign*.43,.61),(sign*.29,.69),(sign*.01,.70),(-sign*.23,.77),(-sign*.31,.825),(-sign*.20,.90),(-sign*.015,.95)],stone,.058,.077)
        rail(pier,[(-.50,.84),(-.34,.90),(-.04,.954),(.16,.98),(.24,1)],seam,.018,.010)
    else:rail(pier,[(0,.015),(-.23,.11),(-.34,.30),(-.31,.45),(-.17,.55),(-.22,.68),(-.11,.77),(0,.84),(.26,.93),(.38,1)],stone,.079,.053)
course(5.49,5.77,.81,.83,11,.13,.027)
lathe([(5.56,.56),(5.75,.63),(5.78,.58),(5.80,.41),(5.84,.40),(5.87,.34)],jade)
lathe([(5.77,.39),(5.79,.405),(5.835,.395),(5.85,.32)],gold)
lathe([(5.83,.30),(5.89,.31),(5.94,.22),(5.96,.13),(5.96,.001)],jade)
if ROUND>=4:
    lathe([(5.69,.585),(5.74,.603),(5.762,.59),(5.776,.465),(5.783,.433)],gold,shade=.82)
    lathe([(5.77,.39),(5.787,.399),(5.814,.395),(5.82,.377)],gold)
    lathe([(5.85,.29),(5.881,.295),(5.897,.28),(5.90,.245)],gold,72,.85)
    lathe([(5.925,.145),(5.954,.145),(5.966,.12),(5.967,.014)],shadow)

group='04 | Cast moon talons'
long=spline([(0,.91,1.23,.19,0),(.17,.93,2.46,.16,.10),(.32,1.13,3.30,.24,.26),(.43,1.30,3.84,.30,.30),(.54,1.18,4.38,.15,.24),(.63,1.28,4.78,.20,.11),(.73,1.22,5.41,.14,.04),(.83,1.18,6.45,.105,-.01),(.90,1.09,6.84,.11,-.025),(.96,.88,7.02,.10,-.02),(1,.68,6.95,.035,0)])
short=spline([(0,.88,1.32,.05,-.66),(.09,.94,1.54,.26,-.48),(.24,1.02,2.05,.44,-.19),(.40,1.13,2.75,.48,.04),(.54,1.12,3.28,.44,.17),(.70,.96,4.03,.28,.12),(.84,.84,4.85,.16,.04),(.91,.86,5.32,.21,.02),(.96,.85,5.53,.13,0),(1,.84,5.79,.009,-.02)])
for idx in range(4):
    islong=idx in (1,3);curve=long if islong else short;a=math.radians(-65+idx*90)
    def claw(u,v):
        r,z,w,t=curve(np.clip(v,0,1));peak=(.13 if not islong else .075)*(1-.77*abs(u)**1.45)
        if ROUND>=5 and islong and v<.35:
            mix=(1-v/.35)**1.15;z+=1.36*mix;r+=.19*mix;w*=1-.92*mix
        if ROUND>=5 and not islong:
            w*=1+.14*sin(pi*v)**2;r+=.026*cos(2*pi*v);z+=.055*v**5
        if islong and ROUND>=2:
            dr,dz,_,_=long.derivative()(np.clip(v,0,1));angle=math.atan2(-dr,dz);peak+=.04;return polar(a+t,r+peak*cos(angle),z+peak*sin(angle),u*w*1.32)
        return polar(a+t,r+peak,z,u*w)
    def aperture(v):
        if not islong:return max(0,1-abs((v-.555)/.143)**1.35)**.86*.66+max(0,1-abs((v-.804)/.079)**1.3)**.76*.34
        return max(0,1-abs((v-.46)/.083)**1.3)**.9*.39
    shell(claw,aperture if ROUND>=2 else None)
    if ROUND>=2 and not islong:
        flourish(claw,[(-.94,.012),(-.44,.095),(.32,.18),(.57,.236),(.40,.26),(.19,.25),(.13,.224),(.30,.222)],.033)
        flourish(claw,[(-.84,.075),(-.61,.16),(-.09,.218),(.04,.277),(.52,.33),(.70,.386),(.59,.418),(.38,.408),(.4,.385)],.044)
        flourish(claw,[(-.88,.14),(-.75,.25),(-.4,.31),(-.08,.344),(.08,.403),(.24,.419),(.38,.455),(.23,.467),(.05,.45)],.031)
        flourish(claw,[(-.92,.267),(-.67,.336),(-.29,.369),(-.21,.42),(-.43,.439),(-.56,.42),(-.45,.404)],.035)
        flourish(claw,[(-.91,.435),(-.58,.497),(.12,.521),(.49,.548),(.69,.61),(.46,.68),(.07,.712),(-.48,.678),(-.65,.642)],.034)
        for sign in [-1,1]:
            flourish(claw,[(sign*.8,.525),(sign*.75,.625),(sign*.52,.689),(sign*.13,.735),(sign*.40,.755)],.019)
            flourish(claw,[(sign*.85,.85),(sign*.62,.893),(sign*.22,.91),(0,.884)],.018)
        vv=np.linspace(.861,1,23);uu=np.linspace(-1,1,9);patch([[claw(u,v)+polar(a,.026+.052*(1-abs(u)),.015*sin(v*pi),0) for u in uu] for v in vv],gold,.94)
        if ROUND>=4:
            def helm(u,v):return claw(u,v)+polar(a,.028+.055*(1-abs(u)),.016*sin(v*pi),0)
            for sign in [-1,1]:
                flourish(helm,[(sign*.86,.88),(sign*.63,.921),(sign*.24,.941),(0,.922)],.017)
                rail(helm,[(sign*.9,.917),(sign*.45,.951),(sign*.16,.973),(0,.998)],gold,.020,.025)
            center=claw(0,.865)+polar(a,.032,0);cabochon(center,np.array([0,0,.063]),polar(a,0,0,.045),polar(a,1,0),.76)
            flourish(claw,[(.91,.187),(.78,.24),(.49,.29),(-.02,.32),(-.34,.35),(-.51,.388)],.015)
            flourish(claw,[(-.98,.223),(-.72,.27),(-.27,.281),(-.04,.299)],.019)
            if ROUND>=5:
                for sign in [-1,1]:
                    def petal(u,v):
                        t=(v-.839)/.129;w=.85*sin(pi*t)**.72;mid=sign*(.20+.38*(1-t));return helm(mid+u*w*.42,v)+polar(a,.023+.032*(1-abs(u))*sin(pi*t),0)
                    vs=np.linspace(.8391,.9679,19);patch([[petal(u,v) for u in [-1,-.70,0,.68,1]] for v in vs],gold,.89)
                flourish(claw,[(.71,.058),(.44,.088),(.29,.138),(-.16,.163),(-.47,.168),(-.73,.184)],.019)
                flourish(claw,[(.89,.29),(.73,.324),(.52,.345),(.47,.37)],.013)
                rail(claw,[(.92,.492),(.88,.564),(.84,.63),(.77,.69),(.60,.732)],jade,.025,.020)
    elif ROUND>=2:
        flourish(claw,[(-.80,.27),(-.43,.32),(.35,.37),(.53,.40),(.19,.42),(-.11,.395),(.09,.38)],.028)
        flourish(claw,[(-.81,.40),(-.65,.47),(-.44,.54),(.28,.60),(.56,.655),(.24,.68),(-.02,.66)],.029)
        flourish(claw,[(.75,.49),(.58,.55),(.2,.59),(-.34,.63),(-.5,.73),(-.29,.82),(-.23,.92)],.019)
        rail(claw,[(-.58,.70),(-.39,.78),(-.19,.86),(.15,.93),(.24,.98)],gold,.014,.012)
        if ROUND>=3:
            spine=spline([(0,.78,2.57,.015),(.07,1.05,2.83,.081),(.16,1.24,3.24,.15),(.27,1.39,3.73,.20),(.38,1.33,4.19,.24),(.47,1.19,4.46,.17),(.54,1.31,4.78,.17),(.63,1.26,5.12,.119),(.76,1.21,6.31,.078),(.83,1.19,6.61,.091),(.91,1.04,6.92,.115),(.97,.81,7.005,.105),(1,.694,6.925,.060)])
            def wing(u,v,side=1):
                r,z,w=spine(np.clip(v,0,1));dr,dz,_=spine.derivative()(np.clip(v,0,1));length=np.hypot(dr,dz);r+=u*w*dz/length;z-=u*w*dr/length;return polar(a+.09*(1-v),r,z,side*(.075+.039*(1-u*u)+.038*sin(v*pi)))
            uu=np.linspace(-1,1,9);vv=np.linspace(0,1,60)
            for side in [-1,1]:
                def face(u,v):return wing(-side*u if ROUND>=4 else u,v,side)
                patch([[face(u,v) for u in uu] for v in vv],jade,.95,flip=side>0 and ROUND<4)
                for edge in [-.91,.90]:rail(face,[(edge,v) for v in np.linspace(0,1,17)],gold,.019,.014,False)
                flourish(face,[(-.76,.09),(-.51,.19),(.38,.29),(.48,.36),(.20,.395),(-.12,.375),(-.19,.337),(.05,.326),(.22,.35)],.024)
                flourish(face,[(.78,.227),(.67,.34),(.53,.395),(-.19,.435),(-.52,.487),(-.42,.54),(.35,.61),(.41,.677)],.025)
                rail(face,[(-.40,.57),(-.26,.70),(-.19,.817),(-.3,.876),(-.3,.922)],jade,.028,.016)
                flourish(face,[(.61,.708),(.24,.744),(.13,.84),(.26,.901),(.52,.934),(.47,.962),(.02,.975),(-.40,.956)],.017)
                if ROUND>=4:
                    tip=face(0,.981);cabochon(tip,polar(a,0.062,0),np.array([0,0,.061]),polar(a,0,0,side),.7)
            for side in [-1,1]:patch([[wing(side,v,b) for b in [-1,1]] for v in vv],gold,.82,flip=side<0)
            patch([[wing(u,1,b) for u in uu] for b in [-1,1]],gold)

group='crystal'
levels=[(6.015,.019),(6.14,.073),(6.34,.22),(6.63,.438),(6.86,.492),(7.11,.41),(7.29,.231),(7.50,.006)]
if ROUND>=3:levels=[(5.999,.009),(6.115,.039),(6.26,.125),(6.49,.345),(6.71,.46),(6.90,.488),(7.135,.397),(7.29,.23),(7.50,.001)]
if ROUND>=4:levels=[(6.005,.009),(6.115,.040),(6.26,.122),(6.49,.345),(6.69,.482),(6.88,.514),(7.12,.393),(7.25,.23),(7.50,.001)]
points=[];count=11
for j,(z,r) in enumerate(levels):
    points.append([polar(2*pi*k/count+.095*sin(j*1.8+.5),r*(1+.035*cos(k*3+j)),z+(.034*sin(k*2.2+j) if j not in [0,7] else 0)) for k in range(count)])
for j in range(len(points)-1):
    for k in range(count):
        kk=(k+1)%count; v=rng.uniform(.72,1);patch([[points[j][k],points[j][kk]],[points[j+1][k],points[j+1][kk]]],prism,v,flat=True)
        if ROUND>=3:
            line=[points[j][k],points[j+1][k]];thick=.004*(.45+.55*sin(pi*(j+.5)/(len(points)-1)));tang=np.array([-sin(2*pi*k/count),cos(2*pi*k/count),0]);patch([[q-tang*thick,q+tang*thick] for q in line],gleam,.95)
            if j in (3,5) and (k+j)%4!=0:
                patch([[q+[0,0,-.0025],q+[0,0,.0025]] for q in [points[j][kk],points[j][k]]],gleam,.98)
lathe([(7.499,.006),(7.50,.0001)],prism,11)


def write_glb():
    blob=bytearray(); doc={'asset':{'version':'2.0','generator':'Astra / parametric foundry'},'scene':0,'scenes':[{'nodes':[]}], 'nodes':[],'meshes':[],'bufferViews':[],'accessors':[],'materials':[],'textures':[],'images':[],'samplers':[{'magFilter':9729,'minFilter':9987}]}
    def view(data,target=None):
        while len(blob)%4:blob.append(0)
        result={'buffer':0,'byteOffset':len(blob),'byteLength':len(data)};blob.extend(data)
        if target:result['target']=target
        doc['bufferViews'].append(result);return len(doc['bufferViews'])-1
    def acc(data,dt,ct,ty,target,normalized=False,bounds=False):
        arr=np.asarray(data,dtype=dt);obj={'bufferView':view(arr.tobytes(),target),'componentType':ct,'count':len(arr),'type':ty}
        if normalized:obj['normalized']=True
        if bounds:obj.update(min=arr.min(0).tolist(),max=arr.max(0).tolist())
        doc['accessors'].append(obj);return len(doc['accessors'])-1
    for m,name in enumerate(materials):
        pbr={'metallicFactor':[.015,.49,.65,.43,.02,.25,.21,.08][m],'roughnessFactor':[.83,.47,.39,.68,.86,.28,.23,.2][m]}; rec={'name':name,'pbrMetallicRoughness':pbr}
        if m<=seam:
            doc['images'].append({'bufferView':view(texture(m)), 'mimeType':'image/jpeg'});doc['textures'].append({'sampler':0,'source':m});pbr['baseColorTexture']={'index':m}
        else:
            pbr['baseColorFactor']=[*((np.array(palette[m])/255)**2.2).tolist(),1];rec['emissiveFactor']={aqua:[.006,.31,.32],prism:[.005,.31,.39],gleam:[.34,.84,.88]}[m]
            if ROUND>=4 and m in (aqua,prism):
                if m==aqua:
                    doc['images'].append({'bufferView':view(gem_paint()),'mimeType':'image/jpeg'});doc['textures'].append({'sampler':0,'source':5})
                pbr.update(baseColorTexture={'index':5},baseColorFactor=[.57,.91,1,1],roughnessFactor=.22 if m==prism else .33);rec.update(emissiveTexture={'index':5},emissiveFactor=[.11,.61,.70] if m==prism else [.06,.38,.44])
        doc['materials'].append(rec)
    for name,mats in meshes.items():
        num=len(doc['nodes']);doc['scenes'][0]['nodes'].append(num);node={'name':name,'mesh':num};doc['nodes'].append(node);prims=[]
        for m,(pos,norm,col,uv,ind) in mats.items():
            pos=np.array(pos);iscr=name=='crystal'
            if ROUND>=3 and not iscr:
                z=pos[:,1].copy();pos[:,1]+=np.interp(z,[0,.24,1.3,2.6,3.2,5.1,5.8,7],[0,0,.26,.22,.19,.03,0,0]);
                if ROUND>=4:
                    mask=1+.078*np.exp(-((z-3.20)/.20)**2) if name.startswith('03') else 1;pos[:,0]*=mask;pos[:,2]*=mask
                    if m in (stone,seam):
                        lit=.81+.17*np.clip(np.array(norm)[:,1],-.65,1)+.075*np.cos(5*np.arctan2(-pos[:,2],pos[:,0])+z*2.2);col=np.array(col)*lit[:,None]
                    if ROUND>=5 and m in (gold,jade):
                        phase=np.arctan2(-pos[:,2],pos[:,0]);shade=.95+.048*np.cos(z*2+phase*3)+.037*np.sin(phase*15-z*3);col=np.array(col)*shade[:,None]
            if iscr:pos[:,1]-=6.79;node['translation']=[0,6.79,0]
            col4=np.pad(np.round(np.clip(col,0,1)*255),((0,0),(0,1)),constant_values=255)
            at={'POSITION':acc(pos,'<f4',5126,'VEC3',34962,bounds=True),'NORMAL':acc(norm,'<f4',5126,'VEC3',34962),'COLOR_0':acc(col4,'u1',5121,'VEC4',34962,True)}
            if m<=seam or ROUND>=4 and m in (aqua,prism):at['TEXCOORD_0']=acc(uv,'<f4',5126,'VEC2',34962)
            small=len(pos)<65536;prims.append({'attributes':at,'indices':acc(ind,'<u2' if small else '<u4',5123 if small else 5125,'SCALAR',34963),'material':m})
        doc['meshes'].append({'name':name,'primitives':prims})
    while len(blob)%4:blob.append(0)
    doc['buffers']=[{'byteLength':len(blob)}];js=json.dumps(doc,separators=(',',':')).encode();js+=b' '*((-len(js))%4);data=struct.pack('<4sIIII',b'glTF',2,28+len(js)+len(blob),len(js),0x4e4f534a)+js+struct.pack('<II',len(blob),0x004e4942)+blob
    (OUT/'tower_me_outer.glb').write_bytes(data);print('GLB',len(data),'bytes;',sum(len(v[4])//3 for obj in meshes.values() for v in obj.values()),'triangles')


write_glb()
