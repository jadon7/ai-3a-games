"""Build the three Moon Court towers. Run with the video2rig Python interpreter."""
import math
from pathlib import Path

import numpy as np

from mesh import Model, TAU, path, polar, profile

ROOT = Path(__file__).resolve().parent
STONE, METAL, GOLD, GEM, LIGHT = 'stone','metal','accent','crystal','glow'
sin, cos, pi = math.sin, math.cos, math.pi

def stroke(m, frame, points, material, height=.024, shade=.96, res=3):
    """A tapered, ridged strip in the local coordinates of a curved surface."""
    coords=path(points,res)
    d=np.gradient(coords[:,:2],axis=0)
    d/=np.maximum(1e-8,np.linalg.norm(d,axis=1,keepdims=True))
    rows=[]
    for (u,v,w),(du,dv) in zip(coords,d):
        rows.append([frame(u+dv*w*t,v-du*w*t,height*(1-abs(t))*.92+.004) for t in (-1,0,1)])
    m.grid(rows,material,shade)

def stone_block(m, a0, a1, bottom, top, radius, inner, shade, cuts=9, beds=3):
    # A closed voussoir. Bevel all four edges of its outer face, including the jambs.
    mid=(a0+a1)*.5
    ref=radius(mid,(bottom(mid)+top(mid))/2)
    kerf=.015/max(.1,ref)
    bevel=.024
    def skin(u,v,inset=0):
        a=a0+kerf+u*(a1-a0-2*kerf)
        y=bottom(a)+.013+v*(top(a)-bottom(a)-.026)
        return polar(a,radius(a,y)-inset,y)
    us=np.linspace(0,1,cuts+1)
    ys=np.linspace(0,1,beds+1)
    da=min(.08,bevel/max(.1,ref*(a1-a0)))
    dz=min(.14,bevel/max(.08,top(mid)-bottom(mid)))
    face=[[skin(da+(1-2*da)*u,dz+(1-2*dz)*v) for u in us] for v in ys]
    m.grid(face,STONE,shade)
    # Traverse the face boundary counterclockwise as seen from outside.
    loops=[[(u,0) for u in us],[(1,v) for v in ys],[(u,1) for u in us[::-1]],[(0,v) for v in ys[::-1]]]
    for edge in loops:
        outer=[skin(u,v,.023) for u,v in edge]
        beveled=[skin(da+(1-2*da)*u,dz+(1-2*dz)*v) for u,v in edge]
        m.grid([outer,beveled],STONE,min(1,shade+.035))
        inside=[]
        for u,v in edge:
            x,y,z=skin(u,v)
            a=math.atan2(x,z)
            inside.append(polar(a,inner,y))
        m.grid([inside,outer],STONE,.67)
    m.grid([[polar((a:=a0+kerf+u*(a1-a0-2*kerf)),inner,bottom(a)+.013+v*(top(a)-bottom(a)-.026)) for u in us[::2]] for v in (0,1)],STONE,.64,True)

def steps(m,tier):
    m.node='paving'
    radii=[[1.88],[2.57,2.01],[3.17,2.65,2.12]][tier-1]
    for j,r in enumerate(radii):
        # The next tread overlaps the internal ends of the paving stones.
        inner=radii[j+1]-.15 if j+1<len(radii) else 1.04
        n=round(TAU*r/.80)
        offset=(.18+j*.54)*TAU/n
        lo=j*.2
        for i in range(n):
            a=offset+TAU*i/n
            # Neighbouring radial joints follow the same boundary at either radius.
            bottom=lo if j==0 else lo-.013
            section=[(bottom,inner,.60),(bottom,r-.029,.65),(bottom+.029,r,.81),
                     (lo+.174,r,.95),(lo+.20,r-.031,1.),(lo+.20,inner,.94),(bottom,inner,.65)]
            div=3
            rows=[]
            for y,rr,c in section:
                rows.append([polar(t,rr,y) for t in np.linspace(a+(.019 if y==lo+.20 else .015)/rr,
                                        a+TAU/n-(.019 if y==lo+.20 else .015)/rr,div+1)])
            for k in range(len(rows)-1):
                m.grid(rows[k:k+2],STONE,section[k+1][2]-.018*(i%3==0))
            for side,reverse in [(0,False),(-1,True)]:
                pts=np.array([row[side] for row in rows[:-1]])
                center=pts.mean(0)
                m.mesh([*pts,center],[(6,k,(k+1)%6) for k in range(6)],STONE,.67,reverse)

def bell(m,tier):
    m.node='bell'
    contour=profile([(.22,1.45),(.33,1.46),(.48,1.40),(.73,1.30),(1.03,1.18),(1.25,1.03),(1.40,.93)])
    m.turn([(.195,.01),(.195,1.44),(.218,1.50),(.325,1.50),(.359,1.46),(.36,1.39)],METAL,64,.87)
    m.turn([(.306,1.498),(.320,1.51),(.342,1.485)],GOLD,64,.88)
    n=8
    for i in range(n):
        a=i*TAU/n+.16
        def notch(u):
            return .235*max(0,1-abs(u-.28)/.53)**.83 if i%2==0 else 0
        def panel(u,v,h=0):
            y=.327+v*(.975+.055*cos(u*pi)-.052*u-notch(u))
            rr=contour(y)+.026*(1-u*u)+h
            return polar(a+u*.383,rr,y)
        m.grid([[panel(u,v) for u in np.linspace(-1,1,7)] for v in [0,.22,.61,.91,1]],METAL,.98)
        m.grid([[panel(u,v,h) for u in np.linspace(-1,1,9)] for v,h in [(1,-.08),(1,.0)]],METAL,.80,True)
        for s in [-1,1]:
            stroke(m,panel,[(s*.99,.84,.002),(s*.77,.89,.017),(s*.53,.94,.024),(s*.23,.975,.013),(0,1,.002)],GOLD,.016)
        if i%2==0:
            us=np.linspace(-.25,.81,8)
            rows=[]
            for f in [-.035,.49,.99]:
                row=[]
                for u in us:
                    y=panel(u,1)[1]+f*notch(u)
                    row.append(polar(a+u*.383,contour(y)-.037+.014*max(0,1-abs(u-.28)/.5),y))
                rows.append(row)
            m.grid(rows,GEM,.89)
        scroll=[(-.91,.12,.003),(-.71,.29,.049),(-.67,.48,.058),(-.44,.62,.045),
                (-.21,.65,.030),(-.20,.57,.013),(-.34,.55,.003)]
        stroke(m,panel,scroll,METAL,.049)
        stroke(m,panel,[(u-.025,v,w*.36) for u,v,w in scroll],GOLD,.054, .92)
        foot=a+.392
        footing=profile([(.207,1.60,.146),(.29,1.58,.193),(.52,1.47,.150),(.91,1.32,.098),(1.12,1.25,.145),(1.28,1.17,.155),(1.41,1.01,.023)])
        def sab(u,y,h=0):
            r,w=footing(y)
            return polar(foot+u*w/r,r+.066*(1-abs(u)) +h,y)
        for x0,x1,mat,shade in [(-1,-.84,GOLD,.88),(-.84,0,METAL,.96),(0,.84,METAL,1),(.84,1,GOLD,.92)]:
            m.grid([[sab(x,y) for x in [x0,x1]] for y in np.linspace(.207,1.41,13)],mat,shade)
        for s in (-1,1):
            m.grid([[sab(s,y,h) for h in [-.16,0]] for y in np.linspace(.207,1.41,10)],METAL,.73,s<0)
        for s in (-1,1):
            stroke(m,sab,[(s*.81,.37,.004),(s*.49,.46,.042),(0,.63,.025),(s*.13,.77,.003)],GOLD,.02)
    m.turn([(1.25,.83),(1.25,1.048),(1.28,1.075),(1.345,1.044),(1.37,.986),(1.405,.93),(1.405,.80)],METAL,56)
    m.turn([(1.345,1.046),(1.362,1.045),(1.384,1.00)],GOLD,56,.97)

def apron_relief(m,tier):
    # A leaf-shaped shoe overlaps the edge of each inset. On the two upper
    # ranks the bronze curtain opens around an ogee of carved limestone.
    m.node='foot_relief'
    bell_r=profile([(.215,1.45),(.36,1.46),(.54,1.40),(.77,1.29),(1.03,1.19),(1.25,1.07),(1.51,.96)])
    for i in range(4):
        a=i*pi/2-.11
        strength=(.62,.94,1.04)[tier-1]
        def exterior(u,y,h=0):
            r=bell_r(y)
            return polar(a+u/r,r+h,y)
        if tier>1:
            def portal(u,v,h=0):
                crown=1.49-.49*abs(u)**1.68
                y=.37+v*(crown-.37)
                w=(.445-.043*v)*strength
                flutes=.038*cos(u*pi*2)**3*max(.04,sin(v*pi))+.093*(1-abs(u))+.035*v
                return exterior(u*w,y,.073+flutes+h)
            for l,r in [(-1,-.37),(-.298,.298),(.37,1)]:
                us=np.linspace(l,r,5)
                m.grid([[portal(u,v) for u in us] for v in [0,.23,.57,.87,1]],STONE,.98)
                for edge in [l,r]:
                    m.grid([[portal(edge,v,h) for h in [-.13,-.012,0]] for v in [0,.35,.70,1]],STONE,.72,edge==l)
                m.grid([[portal(u,1,h) for u in us] for h in [-.115,0]],STONE,.90,True)
            for s in (-1,1):
                stroke(m,portal,[(s*.94,.13,.006),(s*.86,.34,.056),(s*.61,.47,.07),(s*.48,.63,.026),(s*.53,.74,.003)],STONE,.055)
        def stamped(u,y,h=0):
            t=(y-.22)/(.72 if tier>1 else .91)
            width=(.38 if tier>1 else .25)*max(.015,(1-t)**.66)*(.86+.36*sin(pi*t))
            z=.075+(.12 if tier>1 else .08)*(1-abs(u))+.055*sin(pi*t)
            return exterior(u*width,y,z+h)
        ytop=.94 if tier>1 else 1.13
        ys=np.linspace(.222,ytop-.0001,12)
        for lo,hi,mat in [(-1,-.83,GOLD),(-.83,-.20,METAL),(-.2,0,METAL),(0,.2,METAL),(.2,.83,METAL),(.83,1,GOLD)]:
            m.grid([[stamped(u,y) for u in (lo,hi)] for y in ys],mat,1)
        for s in [-1,1]:
            # Cast lotus folds around a deep centre ridge.
            stroke(m,stamped,[(s*.9,.29,.006),(s*.61,.37,.083),(s*.28,.47,.090),(s*.14,.61,.043),(0,.72,.004)],GOLD,.033)
            stroke(m,stamped,[(s*.92,.38,.006),(s*.72,.50,.032),(s*.63,.57,.037),(s*.35,.64,.003)],GOLD,.021)

def shaft(m,tier):
    m.node='masonry'
    form=profile([(1.34,.87),(1.56,.9),(1.89,.84),(2.35,.77),(2.73,.79),(2.98,.87),
        (3.05,.95),(3.19,1.025),(3.36,1.028),(3.40,.83),(3.56,.72),(3.88,.65),
        (4.19,.625),(4.53,.65),(4.90,.714),(5.15,.75),(5.46,.79),(5.63,.85),(5.85,.834)])
    def contour(a,y):
        scale=min(1,max(0,(y-1.4)/.33),max(0,(5.83-y)/.22))
        twist=1.02*sin((y-2.01)*1.95)+.35*(y-3.04)
        u=5*a-twist
        strength=.038+(.052 if tier>1 else .025)*sin(pi*min(1,max(0,(y-2.95)/2.68)))**.7
        body_weight=(0,.055,.093)[tier-1]*max(0,1-((y-3.74)/2.25)**4)
        return form(y)+body_weight+scale*strength*(.23*cos(u)+.77*((1+cos(u))/2)**4-.32)
    def wave(y,a):
        strength=.035 if y<3.40 else .079
        return strength*(sin(3*a+y*.93)+.46*sin(5*a-y*.66))
    def slot(j,a):
        # Lenticular and lancet openings cut into the bedding planes.
        if j not in (3,8,9):return 0
        phase=a*5+{3:.6,8:1.45,9:2.13}[j]
        u=((phase+pi)%TAU-pi)/pi
        v=max(0,1-abs(u)/(.54 if j==8 else .49))
        return [.095,.28,.235][(3,8,9).index(j)]*v**.88
    levels=[1.34,1.62,1.99,2.53,2.89,3.12,3.38,4.04,4.62,5.13,5.56,5.85]
    for j in range(len(levels)-1):
        y0,y1=levels[j:j+2]
        def low(a):
            return y0+(wave(y0,a) if j not in (0,5,6,10) else 0)+.83*slot(j,a)
        def high(a):
            return y1+(wave(y1,a) if j+1 not in (5,6,10,11) else 0)-.17*slot(j+1,a)
        n=[7,6,5,6,7,11,6,5,5,6,11][j]
        for i in range(n):
            a=(i+.35*(j%3)+.19)*TAU/n
            stone_block(m,a,a+TAU/n,low,high,contour,.48,
                1-.020*((i*3+j)%4),12 if j in (6,7,8,9) else 6,3 if j in (6,7,8,9) else 2)
    # The bed of each opening follows that opening only. Normal mortar stays dark.
    for j in [3,8,9]:
        y=levels[j]
        for i in range(5):
            bias={3:.6,8:1.45,9:2.13}[j]
            a=(TAU*i-bias)/5
            us=np.linspace(-.41,.41,13)
            rows=[]
            for v in [-.1,.5,1.1]:
                row=[]
                for u in us:
                    ang=a+u
                    z=y+wave(y,ang)+(v-.17)*slot(j,ang)
                    row.append(polar(ang,contour(ang,z)-.093+.015*(1-abs(u)/.41),z))
                rows.append(row)
            m.grid(rows,LIGHT,.72)
    return contour

def carvings(m,tier,contour):
    # Each spiral buttress consists of individual relief-cut stones. The outer
    # arris splits at the shoulder, leaving a deep groove down the front.
    m.node='carved_stones'
    lower=profile([(1.13,1.09,-.05,.31,.05),(1.35,.989,-.09,.425,.17),
                   (1.58,.924,-.015,.408,.205),(1.86,.901,.189,.27,.138),
                   (2.12,.871,.265,.248,.165),(2.38,.847,.12,.23,.192),
                   (2.65,.866,-.097,.244,.19),(2.90,.908,-.25,.27,.175),
                   (3.14,.993,-.25,.328,.156),(3.37,1.028,-.13,.313,.117)])
    upper=profile([(3.345,.97,-.134,.335,.103),(3.55,.785,.028,.350,.22),
                   (3.75,.711,.192,.229,.214),(4.02,.686,.244,.179,.185),
                   (4.26,.68,.12,.182,.183),(4.53,.702,-.119,.194,.158),
                   (4.79,.747,-.227,.226,.154),(5.015,.781,-.162,.308,.174),
                   (5.24,.805,-.05,.345,.192),(5.45,.837,.053,.235,.202),
                   (5.64,.858,.08,.139,.144),(5.79,.846,.06,.013,.024)])
    section=[(-1,-.025),(-.88,.04),(-.62,.57),(-.49,.65),(-.35,.40),(-.18,.54),
             (.03,1.00),(.28,.68),(.49,.24),(.72,.44),(.92,.12),(1,-.025)]
    factor=(.52,.91,1.09)[tier-1]
    for i in range(4):
        base=i*pi/2-.11
        for upper_half,shape,intervals in [(False,lower,[(1.13,1.69),(1.69,2.42),(2.42,3.37)]),
                                   (True,upper,[(3.37,4.29),(4.29,5.037),(5.037,5.79)])]:
            if tier==1 and (not upper_half or i%2==1):continue
            for k,(ylo,yhi) in enumerate(intervals):
                def frame(u,v):
                    # Matched rake on both sides of the mortar bed.
                    def bed(y,sgn):
                        edge=0 if y in (1.13,3.37,5.79) else .095*u+.035*(1-abs(u))
                        return y+edge+.014*sgn
                    y=(1-v)*bed(ylo,1)+v*bed(yhi,-1)
                    r,sw,w,h=shape(y)
                    a=base+sw*factor+u*w*factor/r
                    h*=factor
                    r=max(r+(.036 if tier==3 else .014),contour(a,y)-.018)
                    return a,r,h,y
                vs=np.linspace(0,1,6)
                for j,((u0,c0),(u1,c1)) in enumerate(zip(section,section[1:])):
                    rows=[]
                    for v in vs:
                        row=[]
                        for u,c in [(u0,c0),(u1,c1)]:
                            a,r,h,y=frame(u,v)
                            lift=(.025 if .10<v<.9 else 0)
                            row.append(polar(a,r+h*c+lift,y))
                        rows.append(row)
                    m.grid(rows,STONE,[.78,.95,1.,.83,.80,1.,1.,.90,.82,.98,.93][j])
                for v,rev in [(0,False),(1,True)]:
                    rim=[]; back=[]
                    for u,c in section:
                        ang,r,h,y=frame(u,v)
                        rim.append(polar(ang,r+c*h,y))
                        back.append(polar(ang,r-.12,y))
                    m.grid([back,rim],STONE,.67,rev)

def gem(m, center, height, rad, mat, sides=9):
    cx,y0,cz=center
    rings=[]
    for j,(f,r,rot) in enumerate([(0,0,0),(.13,.18,-.08),(.34,.74,.04),(.53,1.,.18),(.72,.88,-.035),(.84,.53,.055),(1,0,0)]):
        ring=[]
        for i in range(sides):
            a=TAU*i/sides+rot+.024*sin(4.2*i)
            rr=r*rad*(1+.037*cos(2.8*i))
            off=(.023*sin(2.45*i+.66*j) if r else 0)
            ring.append((cx+rr*sin(a),y0+(f+off)*height,cz+rr*cos(a)))
        rings.append(ring)
    for j in range(len(rings)-1):
        for i in range(sides):
            k=(i+1)%sides
            quad=[rings[j][i],rings[j][k],rings[j+1][k],rings[j+1][i]]
            for t,tri in enumerate([(0,1,2),(0,2,3)]):
                val=.5+.50*(.5+.5*cos(i*2.15+j*1.52+t*.83))
                m.mesh([quad[x] for x in tri],[(0,1,2)],mat,val)

            if m.node=='crystal' and j in (1,2,3,4,5):
                # Narrow polished arrises interrupt the major cut planes. Each
                # one tapers before the next cut, at the edge of the jewel.
                edges=[(0,3,2)] if (j+i)%3!=0 else []
                if j in (2,4) and i%3!=1:edges.append((3,2,0))
                for start,end,inside in edges:
                    A,B,C=(np.array(quad[k]) for k in (start,end,inside))
                    if np.linalg.norm(A-B)<.02:continue
                    rows=[]
                    for f,w in [(.02,.002),(.24,.009),(.81,.007),(.99,.001)]:
                        P=(1-f)*A+f*B
                        along=C-P
                        along/=max(.001,np.linalg.norm(along))
                        pair=np.array([P,P+w*along])
                        pair[:,0]*=1.003
                        pair[:,2]*=1.003
                        rows.append(pair)
                    m.node='facet_glints'
                    m.grid(rows,LIGHT,.98)
                    m.node='crystal'

def cup(m,tier):
    m.node='lantern'
    m.turn([(5.67,.04),(5.67,.67),(5.76,.69),(5.86,.61),(5.92,.47),(5.93,.35)],METAL,36)
    m.turn([(5.88,.47),(5.91,.49),(5.945,.47),(5.95,.34)],GOLD)
    m.turn([(5.928,.15),(5.928,.39),(5.972,.415),(6.019,.384),(6.037,.25),(6.037,.13)],METAL)
    m.turn([(5.982,.405),(5.999,.405),(6.008,.391)],GOLD)
    m.turn([(6.031,.23),(6.031,.252),(6.053,.229),(6.066,.145),(6.066,.094)],METAL,40,.81)
    m.turn([(6.054,.107),(6.069,.105),(6.075,.063),(6.075,.002)],LIGHT,32,.86)
    for i in range(8):
        a=TAU*i/8
        m.grid([[polar(a+u*w,r,y+.02*(1-abs(u))) for u in [-1,0,1]] for r,y,w in
                [(.42,5.89,.11),(.49,5.89,.18),(.63,5.815,.25),(.67,5.778,.10)]],GOLD if i%2==0 else METAL,1,True)
    m.node='crystal'
    gem(m,(0,6.18,0),7.50-6.18,.485 if tier==1 else .515,GEM,9)
    m.pivots['crystal']=(0,6.84,0)

def guard(m,a,tier,short):
    m.node='cast_ribs'
    # In plan the lower blade crosses the broad face of the stone in a shallow S.
    shape=profile([(1.12,.995,-.69,.031),(1.40,1.006,-.53,.20),(1.75,1.049,-.27,.335),
        (2.07,1.09,-.11,.411),(2.51,1.156,.10,.426),(2.86,1.201,.22,.373),
        (3.22,1.213,.28,.307),(3.61,1.143,.26,.242),(3.99,1.009,.22,.18),
        (4.51,.880,.15,.146),(4.87,.883,.105,.15),(5.12,.905,.082,.211),
        (5.32,.90,.074,.222),(5.50,.89,.068,.135),(5.67,.852,.065,.008)])
    end=(4.14 if tier==3 else (5.67 if short else 4.31))
    def guard_point(u,y,h=0):
        r,sw,w=shape(y)
        if tier==3:
            f=min(1,max(0,(y-3.20)/.94))
            r+=.265*sin(pi*.85*f)
            sw+=.21*f
            w*=1-.988*f**1.6
        if not short and tier!=3 and y>3.82:w*=max(.006,1-(y-3.82)/.49)
        if not short and tier!=3:r-=.25*max(0,min(1,(y-3.76)/.55))
        return polar(a+sw+u*w/r, r+.087*(1-abs(u)**1.4)+h,y)
    def hole(y):
        for lo,hi,amp in [(2.53,4.22,.64),(4.40,5.12,.39)]:
            if lo<y<hi: return amp*(.75 if tier==3 else .79)*sin(pi*(y-lo)/(hi-lo))**.83
        return 0.
    ys=np.unique(np.r_[np.linspace(1.12,end,31),[v for v in [2.53,4.22,4.40,5.12] if v<end]])
    for s in [-1,1]:
        for fi,fo,material,shade in [(0,.11,GOLD,.86),(.11,.68,METAL,1),(.68,.87,METAL,.92),(.87,1,GOLD,.98)]:
            rows=[]
            for y in ys:
                inside=hole(y)
                cols=[fi,fo]
                if s<0:cols=cols[::-1]
                rows.append([guard_point(s*(inside+v*(1-inside)),y,.031*sin(v*pi)) for v in cols])
            m.grid(rows,material,shade)
        for inside in [False,True]:
            m.grid([[guard_point(s*(hole(y) if inside else 1),y,h) for h in [-.13,0]] for y in ys],METAL,.72,(s>0)!=inside)
        m.grid([[guard_point(s*(hole(y)+(1-hole(y))*u),y,-.13) for u in [0,1]] for y in ys],METAL,.8,s>0)
    for lo,hi in [(2.53,4.22),(4.40,5.12)]:
        if lo>end:continue
        yy=np.linspace(lo,min(end,hi),11)
        m.grid([[guard_point(u*(hole(y)+.035),y,-.075+.020*(1-abs(u))) for u in [-1,-.42,.24,1]] for y in yy],GEM,.85)
    # One slanting tie crosses the real opening.
    for dy in (0,.32):
        stroke(m,guard_point,[(-.84,2.71+dy,.006),(-.59,2.84+dy,.040),(-.11,2.98+dy,.052),(.55,3.10+dy,.040),(.90,3.32+dy,.003)],METAL,.048)
    for s in [-1,1]:
        stroke(m,guard_point,[(s*.85,1.60,.003),(s*.61,1.76,.035),(s*.58,1.98,.044),
                (s*.30,2.13,.040),(s*.16,2.31,.026),(s*.33,2.41,.004)],GOLD,.025)
    if not short and tier==1:
        shoulder=profile([(2.85,1.075,1.087),(3.04,1.09,1.27),(3.35,1.05,1.38),
                          (3.65,1.053,1.435),(3.93,1.049,1.41),(4.19,1.015,1.337),
                          (4.36,.928,1.215),(4.49,.907,1.05),(4.55,.902,.912)])
        for side in (-1,1):
            def cheek(u,y,h=0):
                ri,ro=shoulder(y)
                r=ri+(ro-ri)*(u+1)/2
                offset=(.10+.075*(1-abs(u))+.042*sin((y-2.85)/1.70*pi))*min(1,.045+max(0,(4.55-y)/.27),.095+max(0,(y-2.85)/.24))
                return polar(a+.18+side*(offset+h)/r,r,y)
            for l,r,mat in [(-1,-.83,GOLD),(-.83,-.25,METAL),(-.25,.04,METAL),(.04,.85,METAL),(.85,1,GOLD)]:
                m.grid([[cheek(u,y) for u in [l,r]] for y in np.linspace(2.85,4.55,19)],mat,.95,side>0)
            for sign in (-1,1):
                m.grid([[cheek(sign,y,h) for h in [-.14,0]] for y in np.linspace(2.85,4.55,18)],METAL,.84,(sign==1)==(side==1))
            stroke(m,cheek,[(-.79,3.09,.003),(-.21,3.29,.043),(.32,3.51,.064),
                     (.49,3.77,.038),(.22,3.93,.034),(-.03,3.86,.003)],GOLD,.019)
    if short and tier!=3:
        def casque(u,v,h):
            y=5.06+.19*(1-abs(u))+.40*v
            return guard_point(u*(1-.74*v),y,.049+.055*(1-abs(u))+h)
        m.grid([[casque(u,v,0) for u in (-1,-.65,0,.65,1)] for v in (0,.28,.7,1)],GOLD,.96)

def scimitar(m,a,tier):
    # Cross sections in the radial plane independently define the hollow and
    # cutting edges. The return curve of the outer edge forms a pointed spur.
    if tier==3:
        keys=[(3.87,.89,.905,.035,.23),(4.16,.818,1.056,.12,.25),
              (4.55,.80,1.161,.165,.25),(4.94,.765,1.145,.20,.23),
              (5.30,.742,1.184,.218,.16),(5.57,.756,1.255,.225,.078),
              (5.79,.813,1.264,.227,.01),(5.97,.923,1.417,.235,-.065),
              (6.045,.978,1.626,.232,-.105),(6.20,1.072,1.611,.215,-.15),
              (6.42,1.162,1.537,.181,-.202),(6.64,1.17,1.418,.146,-.25),
              (6.84,1.080,1.257,.106,-.29),(6.98,.966,1.064,.060,-.32),
              (7.095,.797,.806,.008,-.345)]
    else:
        keys=[(4.12,.81,.83,.022,.25),(4.38,.811,.985,.113,.25),
              (4.81,.775,1.067,.132,.22),(5.17,.765,1.047,.141,.18),
              (5.47,.783,1.121,.144,.135),(5.75,.862,1.235,.172,.08),
              (5.98,.99,1.402,.184,.01),(6.08,1.075,1.516,.167,-.048),
              (6.27,1.139,1.451,.157,-.077),(6.48,1.10,1.317,.128,-.11),
              (6.69,.974,1.13,.080,-.14),(6.86,.778,.79,.013,-.16)]
    rows=path(keys,2 if tier==3 else 3)
    section=[(-1,0),(-.84,.70),(-.63,.88),(-.28,.77),(.10,1.18),(.40,1.01),(.76,.82),(.88,.67),(1,0)]
    def cheek(row,u,v):
        y,ri,ro,w,sw=row
        r=ri+(u+1)*.5*(ro-ri)
        if tier==3:
            # The outer cusp drops below the scallop, while the inner edge
            # rises through it. The shorter rear pair clears the front pair.
            y-=.19*math.exp(-((y-6.045)/.078)**2)*max(0,u)**1.35
            if cos(a)<0:y-=.61*max(0,min(1,(y-5.34)/1.755))**1.25
        return polar(a+sw+math.atan2(v*w,r),math.hypot(r,v*w),y)
    if tier==3:
        # Broader roots carry the crown. Reflect the twist across the central
        # elevation so the front crescents open to the sides of the lantern.
        for row in rows:
            y,ri,ro,w,sw=row
            f=max(0,min(1,(y-4.02)/.51,(7.095-y)/.51))
            row[1]-=f*(.08+.155*math.exp(-((y-6.14)/.58)**2))
            row[3]*=1+.20*f
            row[4]=(1 if sin(a)*cos(a)>0 else -1)*(.10+.19*sin((y-4.13)*1.45))
    def cut(row):
        v=(row[0]-4.31)/1.20
        return (.53*max(0,sin(pi*v))**.86 if tier==3 and 0<v<1 else 0)
    def shell(row,u,v,side,bank):
        opening=cut(row)
        # The cut lies down the lower channel. Both returns continue into the casting.
        center=-.28
        remap=(center+bank*opening)+(u-center)*(1-opening/(1-bank*center))
        return cheek(row,remap,side*v)
    for side in [-1,1]:
        for j,((u,v),(u1,v1)) in enumerate(zip(section,section[1:])):
            m.grid([[shell(row,x,t,side,(-1 if j<3 else 1)) for x,t in [(u,v),(u1,v1)]] for row in rows],
                   GOLD if (j in ([1,6] if tier==3 else [0,7])) else METAL,[.95,.96,.76,.95,1,.92,.99,.96][j],side>0)
        if tier==3:
            rr=[row for row in rows if 4.15<=row[0]<=5.59]
            for bank in [-1,1]:
                m.grid([[cheek(row,-.28+bank*cut(row),side*t) for t in [.26,.77]] for row in rr],METAL,.71,(side*bank)<0)
            m.grid([[cheek(row,-.28+u*cut(row),side*(.30+.11*(1-abs(u)))) for u in [-1,-.13,1]] for row in rr],GEM,.77,side>0)
            rr=rows[round(len(rows)*.39):]
            stripe=[]
            for j,row in enumerate(rr):
                f=j/(len(rr)-1)
                u=-.61+.98*sin(.84*pi*f)
                w=.14*max(.02,sin(pi*f))**.63
                stripe.append([cheek(row,u+t*w,side*(np.interp(u+t*w,*np.array(section).T)+.039+.09*(1-abs(t)))) for t in (-1,0,1)])
            m.grid(stripe,GOLD,.96,side>0)
        # A fine chased return follows the fuller inside the wide blade face.
        for start,finish in [(.28,.75),(.47,.91)]:
            rr=rows[int(start*(len(rows)-1)):int(finish*(len(rows)-1))+1]
            detail=[]
            for j,row in enumerate(rr):
                f=j/(len(rr)-1); u=-.48+.24*sin(f*pi*1.36)
                w=.048*max(.02,sin(f*pi))**.8
                detail.append([cheek(row,u+t*w,side*(np.interp(u+t*w,*np.array(section).T)+.040+.048*(1-abs(t)))) for t in (-1,0,1)])
            m.grid(detail,GOLD,.86,side>0)
    for row,neg in [(rows[0],False),(rows[-1],True)]:
        per=[cheek(row,u,v) for u,v in section]+[cheek(row,u,-v) for u,v in section[-2:0:-1]]
        m.mesh([cheek(row,0,0),*per],[(0,j+1,(j+1)%len(per)+1) for j in range(len(per))],METAL,.85,neg)

def blade(m,a,tier):
    m.node='crown_blades'
    # Each forging is a solid leaf. Its two faces have a recessed channel, a
    # raised median ridge and a narrow finished cutting edge. Sections run
    # past the apex to describe the downturned lip of the outer crook.
    if tier==1:
        keys=[(2.96,1.13,.044,.08,.24),(3.34,1.25,.17,.19,.20),
            (3.79,1.30,.216,.20,.14),(4.13,1.31,.12,.125,.072),
            (4.62,1.30,.085,.104,.069),(5.33,1.27,.092,.099,.055),
            (5.94,1.22,.097,.108,.038),(6.33,1.125,.104,.108,.015),
            (6.58,.989,.116,.112,-.012),(6.71,.83,.112,.12,-.033),
            (6.76,.715,.085,.108,-.035),(6.727,.651,.076,.087,-.038),
            (6.652,.637,.052,.063,-.04),(6.63,.673,.012,.028,-.04)]
    else:
        scimitar(m,a,tier)
        return
    p=path(keys,4)
    deriv=np.gradient(p[:,:2],axis=0)
    deriv/=np.linalg.norm(deriv,axis=1,keepdims=True)
    def at(i,u,v):
        y,r,w,t,sw=p[i]; dy,dr=deriv[i]
        return polar(a+sw+math.atan2(t*v,r+u*w*dy),math.hypot(r+u*w*dy,t*v),y-u*w*dr)
    sec=[(1.,.0),(.90,.58),(.76,.88),(.39,.94),(.18,.83),(-.17,1.05),(-.73,.79),(-.93,.48),(-1.,0)]
    for side in [-1,1]:
        for j,((u1,v1),(u2,v2)) in enumerate(zip(sec,sec[1:])):
            m.grid([[at(i,u,side*v) for u,v in [(u1,v1),(u2,v2)]] for i in range(len(p))],
                   GOLD if j in [0,7] else METAL, [.96,1,.94,.74,.78,1.,.91,.91][j],side<0)
    # Closed blade ends.
    for i,flip in [(0,False),(len(p)-1,True)]:
        edge=[at(i,u,v) for u,v in sec]+[at(i,u,-v) for u,v in sec[-2:0:-1]]
        m.mesh([at(i,0,0),*edge],[(0,j+1,(j+1)%len(edge)+1) for j in range(len(edge))],METAL,.88,flip)

    # A second shorter return curls under the lip of the forged crook.
    rail=path([(6.32,1.145,.035),(6.47,1.054,.044),(6.55,.944,.058),
               (6.565,.843,.061),(6.52,.796,.056),(6.462,.813,.033),(6.467,.849,.009)],4)
    d=np.gradient(rail[:,:2],axis=0); d/=np.linalg.norm(d,axis=1,keepdims=True)
    for j in range(8):
        rows=[]
        for i,(y,r,w) in enumerate(rail):
            row=[]
            for t in [TAU*j/8,TAU*(j+1)/8]:
                delta=w*cos(t)
                row.append(polar(a-.019+w*1.18*sin(t)/r,r+delta*d[i,0],y-delta*d[i,1]))
            rows.append(row)
        m.grid(rows,GOLD if j in (0,4,7) else METAL,.96)

def high_keystones(m):
    m.node='carved_stones'
    # Two axial keystones with swept side lobes fill the opening between
    # the blades. On each, the chamfer breaks into a central lancet.
    for i in range(4):
        a=i*pi/2-.10
        for bottom,top,radius,width,depth in [(4.08,4.81,.915,.36,.32),(4.85,5.86,.965,.43,.33)]:
            def point(u,v,h=0):
                y=bottom+(top-bottom)*v
                w=width*np.interp(v,[0,.19,.36,.51,.68,.82,1],[.035,.36,.66,1,.74,.43,.021])
                ridge=.11+.74*(1-abs(u))**1.45+.25*math.exp(-((abs(u)-.66)/.13)**2)
                return polar(a+u*w/radius,radius+depth*(ridge*sin(pi*v)**.65)+h,y)
            us=[-1,-.86,-.65,-.44,-.18,0,.18,.44,.65,.86,1]
            for j,(l,r) in enumerate(zip(us,us[1:])):
                m.grid([[point(u,v) for u in (l,r)] for v in [0,.19,.36,.51,.68,.82,1]],STONE,
                        [.80,.98,.85,.91,1.,1.,.95,.84,1.,.87][j])
            for side in (-1,1):
                m.grid([[point(side,v,h) for h in [-.107,0]] for v in [0,.19,.36,.51,.68,.82,1]],STONE,.72,side<0)
                stroke(m,point,[(side*.82,.48,.003),(side*.46,.55,.043),(side*.25,.63,.061),
                                (side*.31,.71,.025),(side*.49,.72,.003)],STONE,.035)


def girdle(m,tier):
    if tier!=2:return
    m.node='diadem'
    m.turn([(4.28,.58),(4.28,.79),(4.38,.92),(4.46,1.142),(4.53,1.177),(4.63,1.171),(4.687,1.10),(4.69,.63)],METAL,56)
    for y,r in [(4.48,1.161),(4.627,1.171)]:
        m.turn([(y,r-.016),(y+.012,r+.013),(y+.035,r+.006),(y+.041,r-.012)],GOLD,56,.98)
    for i in range(8):
        a=TAU*i/8+.1
        def fin(u,y,h=0):
            width=.215*max(.02,sin(pi*min(1,max(0,(y-4.21)/.53))))**.7
            return polar(a+u*width,1.168+.093*(1-abs(u))+h,y)
        m.grid([[fin(u,y) for u in (-1,0,1)] for y in np.linspace(4.21,4.735,9)],METAL,1)
        stroke(m,fin,[(-.97,4.55,.01),(-.59,4.49,.042),(0,4.33,.032),(.70,4.52,.017),(.97,4.55,.002)],GOLD,.026)
        cx,_,cz=polar(a,1.11,0)
        m.turn([(4.62,.08),(4.64,.13),(4.74,.107),(4.76,.061)],GOLD,10,.90,(cx,cz))
        gem(m,(cx,4.715,cz),.388,.114,GEM,6)

def build(tier):
    m=Model()
    steps(m,tier)
    bell(m,tier)
    apron_relief(m,tier)
    contour=shaft(m,tier)
    carvings(m,tier,contour)
    if tier==3:high_keystones(m)
    for i,deg in enumerate([27,115,206,292]):
        a=math.radians(deg)
        guard(m,a,tier,i%2==0)
    angles=[[115,292],[60,137,240,317],[55,155,205,305]][tier-1]
    for deg in angles:blade(m,math.radians(deg),tier)
    girdle(m,tier)
    cup(m,tier)
    height=[7.5,9.2,11.0][tier-1]
    scale=np.array([[1,1,1.],[1.085,(height-.4)/7.3,1.085],
                    [1.155,(height-.6)/7.3,1.155]][tier-1])
    dy=.20*tier-.20*scale[1]
    for (node,_),sets in m.parts.items():
        if node=='paving':continue
        section_scale=scale.copy()
        if tier==3 and node in ('bell','foot_relief'):
            section_scale[[0,2]]*=.965
        for positions,normals,_,_ in sets:
            positions*=section_scale
            positions[:,1]+=dy
            normals/=section_scale
            normals/=np.maximum(1e-12,np.linalg.norm(normals,axis=1,keepdims=True))
    m.pivots['crystal']=(0,6.84*scale[1]+dy,0)
    out=ROOT/'out'/f'tower_me_{tier}.glb'
    count=m.save(out)
    print(f'{out.name}  {count:,} triangles',flush=True)

if __name__=='__main__':
    (ROOT/'out').mkdir(exist_ok=True)
    for level in (1,2,3):build(level)
