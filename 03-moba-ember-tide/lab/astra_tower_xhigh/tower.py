"""Model the outer tower. All dimensions are metres."""
import math
from pathlib import Path

import numpy as np
from geometry import Model, TAU, polar, profile, track
from chasing import panel_uv

ROOT=Path(__file__).resolve().parent
M=Model()
ST='Stone'; CU='Verdigris'; AU='Brass'; DK='Deep bronze'
def ring(z,r,thick,width,mat,n=64):
    b=min(thick*.24,.021); e=min(width*.2,.014)
    M.lathe([(z,r-width),(z,r-e),(z+b,r),(z+thick-b,r),(z+thick,r-e),(z+thick,r-width),(z,r-width)],mat,n)

def masonry(z0,z1,r0,r1,inside,count,offset,style='ashlar'):
    bevel=min(.043,(z1-z0)*.17)
    for i in range(count):
        a=offset+TAU*i/count; b=offset+TAU*(i+1)/count
        joint=.004 if z0>.4 else .0065
        shade=float(M.rng.uniform(.83,.99))
        section=[(z0,inside+.02),(z0,r0-bevel),(z0+.012,r0-.013),(z0+bevel,r0),
                 (z1-bevel*1.4,r1),(z1-.021,r1-.009),(z1,r1-bevel),
                 (z1,inside+.025),(z1-.024,inside),(z0+.014,inside),(z0,inside+.02)]
        M.sector(a+joint,b-joint,section,ST,shade,i*37+int(z1*100))

# Foundation and bell. The open lip of each cast panel reveals crystal below.
M.node='Footstones'
masonry(0,.235,1.72,1.73,.91,14,.035)
M.lathe([(.012,.001),(.012,1.61),(.201,1.61),(.201,.001)],ST,70,.70)
M.node='Bell and sabatons'
bell=profile([(.21,1.37),(.32,1.37),(.43,1.35),(.65,1.32),(.91,1.23),(1.13,1.10),(1.30,1.03),(1.39,.94)])
M.lathe([(z,bell(z)-.046) for z in np.linspace(.215,1.37,25)],DK)
M.lathe([(.216,1.352),(.216,1.468),(.225,1.495),(.252,1.508),(.332,1.507),
         (.351,1.499),(.369,1.47),(.382,1.39),(.386,1.352),(.361,1.326)],CU,72,.96)
ring(.253,1.508,.012,.021,AU)
ring(.352,1.492,.011,.018,AU)
def jewel_patch(frame, low, high, w, mat='Crystal', samples=11):
    rows=[]; colors=[]
    for i in range(samples):
        f=i/(samples-1); width=w*(max(.014,math.sin(math.pi*f))**.84)
        row=[]
        for j,(t,dh) in enumerate([(-1,0),(-.29,.021),(.26,.032),(1,0)]):
            row.append(frame(t*width,low+(high-low)*f,dh))
            colors.append([.013,.36+.45*f+.09*(j==2),.47+.43*f])
        rows.append(row)
    M.grid(rows,mat,np.array(colors))
for k in range(8):
    a=TAU*k/8+.385
    def apron(u,z,h=0):
        return polar(a+u, bell(z)+h,z)
    rows=[]
    for f in np.linspace(0,1,18):
        row=[]
        for u in np.linspace(-1,1,19):
            # Deep crescent notch in the upper edge of the cast apron.
            top=1.27-(.18 if k in (0,2,5) else .030)*math.exp(-((u-.19)/.27)**2)+.065*u
            z=.318+f*(top-.318)
            h=.012+.032*(1-u*u)-.014*math.exp(-((abs(u)-.9)/.08)**2)
            row.append(apron(u*.39,z,h))
        rows.append(row)
    M.grid(rows,'Chased copper',.96 if k%2 else .90,uv=np.array([panel_uv(1,(u+1)/2,1-f) for f in np.linspace(0,1,18) for u in np.linspace(-1,1,19)]))
    crown=[]
    for u in np.linspace(-1,1,23):
        z=1.27-(.18 if k in (0,2,5) else .030)*math.exp(-((u-.19)/.27)**2)+.065*u
        crown.append((u*.39,z,.014+.008*(1-u*u)))
    M.leaf(lambda u,z,h:apron(u,z,h+.043),crown,AU,32,1.08,.009,.91)
    if k in (0,2,5):
        jewel_patch(lambda u,z,h:apron(.074+u,z,h-.014),1.095,1.35,.124)
        for sgn in (-1,1):
            M.leaf(lambda u,z,h:apron(.074+u,z,h+.025),[(sgn*.165,1.29,.003),(sgn*.113,1.235,.018),
                (sgn*.071,1.21,.015),(sgn*.014,1.15,.003)],AU,13,1.09,.012)
    # Bell buttresses have a foot, scooped flanks and a peaked central ridge.
    center=a-.391
    def strap(t,z,h=0):
        f=(z-.23)/1.14
        width=.095+.12*(1-f)**2+.043*math.exp(-((f-.78)/.17)**2)
        return polar(center+t*width/bell(z),bell(z)+.042+.074*(1-t*t)+.139*(1-f)**4+h,z)
    rows=[]
    for z in np.linspace(.235,1.368,29):rows.append([strap(t,z) for t in [-1,-.88,-.45,-.12,.19,.65,.89,1]])
    M.grid(rows,'Chased copper',.97,uv=np.array([panel_uv(2,(t+1)/2,(1.368-z)/1.133) for z in np.linspace(.235,1.368,29) for t in [-1,-.88,-.45,-.12,.19,.65,.89,1]]))
    for s in [-1,1]:
        M.grid([[strap(s*t,z,.009) for t in ([.80,.91,.99] if s==1 else [.99,.91,.80])] for z in np.linspace(.237,1.365,28)],AU,.88)
    rows=[]
    for v in np.linspace(0,1,17):
        row=[]
        for t in np.linspace(-1,1,9):
            z=1.12+v*.254
            bellows=.045*math.sin(math.pi*v)**.70
            row.append(strap(t*(.84+.29*math.sin(v*math.pi)),z,bellows*(1-.61*t*t)))
        rows.append(row)
    M.grid(rows,CU,.98)
    for s in [-1,1]:
        M.leaf(strap,[(s*.91,.29,.004),(s*.68,.42,.015),(s*.38,.49,.018),(s*.46,.62,.005)],AU,13,.15,.012)
        M.leaf(strap,[(s*.91,1.13,.002),(s*.79,1.24,.027),(s*.58,1.33,.024),(s*.16,1.354,.003)],AU,15,.15,.028)
M.lathe([(1.233,.72),(1.233,1.041),(1.275,1.044),(1.329,1.015),(1.374,.948),(1.374,.77)],CU)
ring(1.326,1.015,.043,.155,AU)
ring(1.37,.975,.057,.14,DK)
# The lower drum is built from beds of hewn limestone. One bed has a broken,
# slightly helical joint wide enough to reveal the mineral core behind it.
M.node='Lower limestone drum'
for i,(z0,z1,r0,r1,num) in enumerate([(1.34,1.57,.89,.88,7),(1.57,1.86,.88,.826,6),
        (1.867,2.31,.823,.765,5),(2.319,2.60,.766,.77,6),(2.67,3.018,.765,.86,6)]):
    masonry(z0,z1,r0,r1,.57,num,.19+i*.41)
M.lathe([(2.54,.71),(2.57,.735),(2.68,.737),(2.71,.71)],'Crystal',64,[.019,.36,.43])
for k in range(5):
    a=-.15+k*TAU/5
    rows=[]
    for f in [0,.19,.74,1]:
        row=[]
        for u in np.linspace(-1,1,13):
            bottom=2.57+.025*(u+1)
            top=2.68-.094*max(0,(u-.40)/.60)**1.2
            row.append(polar(a+u*.40,.754+.009*math.cos(u*3),bottom+f*(top-bottom)))
        rows.append(row)
    M.grid(rows,ST,.83)
for k in range(5):
    a=.44+TAU*k/5
    def lower(u,z,h=0):
        rr=np.interp(z,[1.62,1.89,2.3,2.60],[.866,.817,.766,.774])
        return polar(a+u/rr,rr+.01+h,z)
    M.leaf(lower,[(-.36,1.77,.003),(-.22,1.83,.056),(-.19,2.01,.081),(-.07,2.22,.063),(.12,2.27,.036),(.19,2.18,.018),(.13,2.14,.002)],ST,34,1,.038,.95)
# Deep overhanging collar.
masonry(2.97,3.13,.85,.978,.59,8,.51)
masonry(3.099,3.34,1.025,1.063,.61,11,.18)
# Upper shaft. The shell is divided into pointed arches. Both ends of the
# window and its jambs are open geometry with an inset crystalline core.
M.node='Carved lantern'
neck=profile([(3.26,.70),(3.34,.73),(3.51,.67),(3.77,.615),(4.10,.599),
              (4.51,.624),(4.79,.674),(5.01,.696),(5.24,.749),(5.51,.775),(5.68,.75)])
def shaft(a,z,h=0):
    flute=.035*math.cos(6*a+.8*math.sin(z*1.8))+.017*math.cos(12*a+z*1.5)
    return polar(a,neck(z)+flute+h,z)
for k in range(6):
    a=.53+TAU*k/6
    def window(u):
        return max(0,1-abs(u)**1.5)**.75
    def arch_frame(u,z,h=0):
        twist=.15*(z-4.2)+.11*math.sin((z-3.4)*2.2)
        return shaft(a+u*.522+twist,z,h)
    def openings(u):
        dome=window(u/.65) if abs(u)<.65 else 0
        upper=window((u+.10)/.75) if abs(u+.10)<.75 else 0
        sill=5.045-.102*u
        return (4.49-.205*dome,4.49+.358*dome,sill-.048*upper,sill+.351*upper)
    def stone_skin(u,z):
        return .022*(1-u*u)+.018*math.cos(u*6.7)**3+.013*math.sin(z*2.3+u*2)
    widths=np.unique(np.r_[np.linspace(-1,1,25),-.85,-.65,.65])
    for region,subdiv in [(0,17),(1,9),(2,9)]:
        rows=[];colors=[]
        for f in np.linspace(0,1,subdiv):
            row=[]
            for u in widths:
                low,high,sill,top=openings(u)
                start,stop=[(3.294,low),(high,sill),(top,5.60)][region]
                z=(1-f)*start+f*stop
                h=stone_skin(u,z)
                if region==1:
                    h+=.065*min(1,f/.18)+.020*(1-u*u)
                    h-=.050*max(0,(f-.85)/.15)
                elif region==2:
                    h+=.080*(1-.57*f)*max(0,1-abs(u)**3)
                row.append(arch_frame(u,z,h))
                colors.append([.88+.062*math.cos(u*3.8)+.028*f]*3)
            rows.append(row)
        M.grid(rows,ST,np.array(colors))
    for lip,(u0,u1) in enumerate([(-.65,.65),(-.65,.65),(-.85,.65),(-.85,.65)]):
        rows=[]
        for dep in [0,.016,.095]:
            row=[]
            for u in np.linspace(u0,u1,25):
                z=openings(u)[lip]
                extra=[0,.020,.025,.080*max(0,1-abs(u)**3)][lip]
                row.append(arch_frame(u,z,stone_skin(u,z)+extra-dep))
            rows.append(row)
        M.grid(rows,ST,.85,lip%2==1)
    # Carved mouldings turn into the upper voussoirs. They sit on both lips of each arch.
    for side in [-1,1]:
        M.leaf(lambda u,z,h:arch_frame(u,z,h+.027),[(side*.15,3.33,.122),(side*.57,3.54,.114),
                 (side*.72,3.88,.086),(side*.69,4.21,.060),(side*.70,4.50,.049),
                 (side*.49,4.72,.044),(side*.11,4.86,.026),(side*.02,4.93,.004)],ST,40,.34,.057,.98)
    for zlow,zhigh in [(4.22,4.53),(4.53,4.97),(4.97,5.45)]:
        rows=[];colors=[]
        for vf in np.linspace(0,1,7):
            row=[]
            for jj,u in enumerate(np.linspace(-.98,.98,11)):
                z=zlow+vf*(zhigh-zlow)
                row.append(arch_frame(u,z,-.058+.016*math.cos(u*5)+.009*math.sin(z*12)))
                colors.append([.012,.44+.25*math.sin(jj*2.1+z*5)**2,.52+.25*vf])
            rows.append(row)
        uv=np.array([[(2+.37*jj)/9,(1.8+vf*2.6)/7] for vf in np.linspace(0,1,7) for jj in range(11)])
        M.grid(rows,'Heart of tide',.85,uv=uv)
    # Grooves under the spiral flutes die into a broad, hewn foot.
    M.leaf(lambda u,z,h:arch_frame(u,z,h+.015),
       [(-.95,3.335,.040),(-.74,3.43,.076),(-.34,3.57,.075),(-.12,3.86,.062),
        (-.19,4.12,.038),(-.39,4.24,.015),(-.51,4.22,.001)],ST,30,.38,.046,.94)
    # A diagonal ridge is cut into each spandrel and dies into the wall itself.
    M.leaf(lambda u,z,h:arch_frame(u,z,h+.046),
           [(-.95,4.88,.002),(-.76,4.97,.033),(-.39,5.017,.042),(-.08,5.005,.035),
            (.31,4.97,.026),(.62,4.958,.010),(.79,4.95,.001)],ST,26,.365,.022,.99)
    # Weathered oblique incision in the middle of a single flute.
    if k in (1,3,5):
        rows=[]
        for u in np.linspace(-.29,.63,17):
            z=4.09-.12*u-.035*u*u
            rows.append([arch_frame(u,z+off,stone_skin(u,z)+.004) for off in [.004,-.002,-.013*math.sin((u+.29)/.92*math.pi)]])
        M.grid(rows,'Crystal',[.006,.24,.29],True)
M.lathe([(3.32,.49),(5.58,.53)],DK)
masonry(5.42,5.74,.795,.813,.569,12,.09)
M.node='Offering cup'
M.lathe([(5.49,.05),(5.49,.585),(5.58,.59),(5.64,.54),(5.67,.46),(5.72,.36),
         (5.75,.365),(5.75,.035)],AU,64,.92)
ring(5.69,.408,.132,.12,DK)
M.lathe([(5.77,.20),(5.77,.39),(5.80,.41),(5.855,.406),(5.884,.38),
         (5.901,.295),(5.91,.256),(5.91,.04)],AU)
M.lathe([(5.899,.08),(5.899,.276),(5.925,.271),(5.973,.216),(5.992,.14),(5.992,.072)],CU)
ring(5.94,.223,.016,.028,AU)
M.lathe([(5.977,.01),(5.977,.139),(6.001,.134),(6.015,.103),(6.015,.004)],'Crystal',40,[.008,.31,.36])

for k in range(12):
    a=k*TAU/12
    rows=[]
    for f in np.linspace(0,1,7):
        r=.386+.197*f
        z=5.734-.093*f
        rows.append([polar(a+t*.254,r,z+.034*math.sin(math.pi*f)*(1-abs(t))) for t in [-1,-.7,-.10,.55,1]])
    M.grid(rows,CU if k%3==1 else AU,.86,True)
ring(5.884,.364,.010,.035,CU)
ring(5.925,.256,.012,.022,AU)
# Four cast ribs. A thick S-shaped lower blade takes the load. On the two
# taller members a second, hooked tine grows behind its shoulder.
blade_shape=profile([(1.13,.945,-.71,.012),(1.29,.98,-.58,.17),(1.57,1.005,-.34,.31),
    (1.91,1.035,-.10,.416),(2.28,1.084,.09,.464),(2.61,1.142,.19,.452),
    (2.91,1.164,.23,.393),(3.17,1.152,.245,.334),(3.45,1.112,.245,.258),
    (3.75,1.033,.23,.202),(4.13,.944,.19,.156),(4.51,.89,.145,.137),
    (4.83,.877,.105,.150),(5.04,.888,.07,.225),(5.21,.877,.054,.188),(5.42,.839,.027,.100),(5.67,.80,-.022,.003)])
def cast_blade(a,idx):
    def blade(t,z,h=0):
        r,sw,w=blade_shape(z)
        w*=1+.20*math.exp(-((z-2.25)/1.17)**2)
        sw-=.17*math.exp(-((z-1.46)/.85)**2)
        strength=math.exp(-((z-2.48)/1.08)**4)
        w*=1+.12*strength
        ridge=(.049+.033*strength)*(1-abs(t)**1.45)
        ridge+=(.019+.051*strength)*math.exp(-((abs(t)-.72)/.19)**4)
        rr=r+ridge+h
        return polar(a+sw+t*w/r,rr,z+.15*np.clip((z-4.92)/.75,0,1))
    def hole(z):
        # Faceted opening, wide in the belly and pinched at the ends.
        if 2.66<z<4.29:
            x=(z-2.66)/1.63;return .60*math.sin(math.pi*x)**.61*(1.27-.68*x)
        if 4.48<z<5.02:return .30*math.sin((z-4.48)/.54*math.pi)**.48
        return 0.
    if idx in (0,2):
        levels=sorted(set(np.round(np.r_[np.linspace(1.13,5.67,56),2.66,4.29,4.48,5.02],6)))
        for side in (-1,1):
            for front in [True,False]:
                rows=[];colors=[];uv=[]
                for z in levels:
                    inner=hole(z)
                    row=[]
                    for k in np.linspace(0,1,8):
                        q=(inner+(1-inner)*k) if side>0 else (1-(1-inner)*k)
                        row.append(blade(q*side,z,0 if front else -.115))
                        uv.append(panel_uv(0,(1+q*side)/2,(5.67-z)/4.54))
                        colors.append([(.82+.16*math.sin(k*math.pi)) if front else .63]*3)
                    rows.append(row)
                M.grid(rows,'Chased copper' if front else DK,np.array(colors),not front,uv=np.array(uv) if front else None)
            for rim in ['edge','hole']:
                rows=[]
                for z in levels:
                    u=side*(1 if rim=='edge' else hole(z))
                    rows.append([blade(u,z,h) for h in (0,-.032,-.115)])
                M.grid(rows,AU if rim=='edge' else DK,.78,reverse=(side>0)!=(rim=='edge'))
            # Cast golden edge tapers to a hairline in the shank.
            rows=[]
            for z in levels:
                w=blade_shape(z)[2]
                bw=min(.25,.018/max(.025,w))
                row=[blade(side*t,z,h) for t,h in [(1,.001),(1-bw*.28,.009),(1-bw,.004)]]
                rows.append(row if side==-1 else row[::-1])
            M.grid(rows,AU,1.)
        for side in [-1,1]:
            zs=np.unique(np.r_[np.linspace(1.18,4.92,50),1.61,1.69,2.63,2.72,2.79])
            for col,(u0,u1) in enumerate([(.64,.78),(.78,.94),(.94,.98)]):
                rows=[]
                for z in zs:
                    reach=.74+.22*math.exp(-((z-2.44)/.64)**4)
                    lip=.061*math.exp(-((z-2.36)/.69)**4)+.020
                    if z<1.68:lip*=min(1,max(.02,(z-1.18)/.38))
                    if 2.74<z<2.81:lip*=.59
                    row=[]
                    for u in [u0,u1]:
                        t=1-(1-u)*reach
                        row.append(blade(t*side,z,lip*(1-abs(u-.78)*4.2)))
                    rows.append(row if side==1 else row[::-1])
                M.grid(rows,AU if col==2 else CU,.95 if col==0 else .88)
        for lo,hi in [(2.66,4.29),(4.48,5.02)]:
            rows=[];colors=[]
            for z in np.linspace(lo-.025,hi+.025,31):
                w=max(.037,hole(z)+.075)
                row=[]
                for k,t in enumerate([-1,-.42,.18,.65,1]):
                    row.append(blade(t*w,z,-.066+.038*(1-abs(t))+.006*math.sin(z*12+2*t)))
                    colors.append([.014,.22+.49*(k==1)+.19*math.sin(z*5)**2,.37+.45*(k==1)])
                rows.append(row)
            uv=np.array([[(2+j*.71)/9,(1.2+f*3.0)/7] for f in np.linspace(0,1,31) for j in range(5)])
            M.grid(rows,'Heart of tide',.91,uv=uv)
        # Cast transoms follow the sweep of the bronze body, crossing the open mineral bed.
        if idx in (0,2):
            for ctrl in [[(-.97,2.83,.002),(-.67,3.00,.051),(-.18,3.12,.049),(.35,3.22,.040),(.73,3.36,.016),(.91,3.51,.002)],
                         [(-.85,3.24,.003),(-.57,3.43,.022),(-.23,3.54,.029),(.18,3.64,.022),(.57,3.79,.014),(.77,3.94,.002)]]:
                M.leaf(lambda u,z,h:blade(u,z,h-.015),ctrl,CU,30,.30,.039,.91)
                M.leaf(lambda u,z,h:blade(u,z,h+.019),[(u,z,w*.34) for u,z,w in ctrl],AU,30,.30,.009,.94)
        # Raised arabesques of the broad lower shell. Taper the ends as on chased metal.
        ornament=[
          [(-.91,1.42,.002),(-.54,1.66,.040),(-.64,1.91,.041),(-.38,2.07,.027),(-.46,2.21,.016),(-.59,2.19,.006)],
          [(-.77,1.57,.004),(-.28,1.83,.053),(-.23,2.10,.064),(.03,2.32,.061),(.34,2.47,.041),(.45,2.63,.019),(.34,2.64,.004)],
          [(-.62,1.72,.002),(.11,1.96,.044),(.35,2.21,.048),(.61,2.32,.031),(.73,2.50,.020),(.61,2.54,.002)],
          [(-.92,2.24,.006),(-.71,2.38,.029),(-.77,2.53,.034),(-.52,2.67,.037),(-.29,2.63,.022),(-.33,2.55,.008)],
          [(-.66,2.76,.005),(-.47,2.88,.025),(-.17,2.90,.038),(.16,3.02,.031),(.53,3.14,.013),(.55,3.23,.001)]]
        for points in [ornament[0],ornament[2]]:
            M.leaf(lambda u,z,h:blade(u,z,h+.004),points,AU,28,.38,.024,.91)
            M.leaf(lambda u,z,h:blade(u,z,h+.020),[(u+.010,z+.004,w*.58) for u,z,w in points],CU,28,.38,.013,1.)
        # Folded hood. The two cheek plates descend either side of a real arched recess.
        def casque(t,f,h=0):
            b=4.91+.285*max(0,1-abs(t)**1.40)**.68-.024*t
            top=5.67-.069*abs(t)**.80
            z=b+(top-b)*f
            t0=t*(.96-.12*f)
            ridge=(.035+.113*(1-abs(t)**.69))*(.56+.44*max(0,math.sin(math.pi*f))**.8)
            return blade(t0,z,ridge+h)
        for low,high,col in [(-1,-.62,.83),(-.62,-.055,.99),(-.055,.14,1.0),(.14,.66,.89),(.66,1,.80)]:
            us=np.linspace(low,high,4)
            M.grid([[casque(t,f) for t in us] for f in np.linspace(0,1,21)],AU,col)
        for f0,f1,off,mat in [(-.007,.026,.010,AU),(.029,.043,.006,DK),(.048,.063,.004,AU)]:
            M.grid([[casque(t,f,off) for t in np.linspace(-1,1,29)] for f in [f0,f1]],mat,.98)
        for side in [-1,1]:
            rows=[]
            for f in np.linspace(.13,.86,27):
                t=side*(.115+.53*max(0,math.sin((f-.13)/.73*math.pi))**1.6)
                row=[casque(t+s*.022,f,.006) for s in [-1,0,1]]
                rows.append(row)
            M.grid(rows,DK,.83)
            M.leaf(lambda u,z,h:blade(u,z,h+.025),[(side*.98,4.85,.001),(side*.82,4.95,.028),
                 (side*.56,5.059,.035),(side*.21,5.125,.019),(side*.008,5.136,.001)],AU,21,.17,.024)
        for width,off,mat in [(.060,.020,AU),(.042,.040,'Crystal')]:
            M.leaf(lambda u,z,h:blade(u,z,h+off),[(0,4.98,.002),(-.01,5.035,width),
                 (.02,5.089,width*.59),(.06,5.113,.002)],mat,16,.18,.022,
                 [.009,.39,.49] if mat=='Crystal' else .94)
        if idx in (0,2):
            for control,material,h in [
              ([(-.36,2.42,.002),(-.39,2.51,.059),(-.31,2.60,.042),(-.22,2.63,.002)],AU,.033),
              ([(-.36,2.45,.002),(-.36,2.52,.031),(-.29,2.60,.001)],'Crystal',.067),
              ([(.67,2.34,.001),(.77,2.39,.026),(.79,2.45,.021),(.74,2.47,.001)],AU,.021)]:
                M.leaf(lambda u,z,off:blade(u,z,off+h),control,material,20,.40,.012,
                       [.006,.32,.39] if material=='Crystal' else .91)
        for s in [-1,1]:
            M.leaf(lambda u,z,h:blade(u,z,h+.011),[(s*.86,4.19,.001),(s*.73,4.32,.029),(s*.33,4.41,.038),
                          (s*.09,4.48,.021),(s*.03,4.58,.001)],AU,16,.16,.018)
    else:
        anchor=profile([(1.18,.96,.76,.082),(1.35,.925,.71,.148),(1.64,.878,.65,.141),
             (1.93,.845,.58,.113),(2.24,.811,.48,.095),(2.51,.859,.33,.122),
             (2.78,1.007,.20,.135),(3.07,1.14,.13,.145),(3.39,1.28,.083,.138),(3.66,1.34,.069,.077)])
        zs=np.linspace(1.18,3.66,37)
        def root(t,z,h=0):
            r,sw,w=anchor(z)
            return polar(a+(1 if idx==3 else -1)*sw+t*w/r,r+.071*(1-t*t)+h,z)
        for side in (0,1):
            M.grid([[root(t,z,-.09 if side else 0) for t in np.linspace(-1,1,7)] for z in zs],DK if side else CU,.87,side==1)
        for sign in [-1,1]:
            M.grid([[root(sign,z,h) for h in [0,-.028,-.09]] for z in zs],AU,.8,sign>0)
    if idx not in (1,3):return
    # A second cast feather climbs past the coping and curls over the gem.
    # Use arc length to continue over the crest and undercut the inward-facing hook.
    path=track([(3.13,1.22,.022),(3.39,1.34,.151),(3.77,1.403,.181),(3.96,1.397,.125),
                (4.14,1.375,.096),(4.63,1.345,.073),(5.20,1.307,.078),(5.68,1.277,.084),
                (6.09,1.232,.097),(6.44,1.142,.112),(6.65,1.012,.130),(6.77,.856,.124),
                (6.795,.741,.112),(6.754,.667,.096),(6.682,.659,.070),(6.653,.692,.044),(6.669,.712,.010)],89)
    d=np.gradient(path[:,:2],axis=0);d/=np.linalg.norm(d,axis=1)[:,None]
    # Local coordinates follow the crook, including the underside of the rolled terminal.
    def tine(i,v,t):
        zi,ri,th=path[i]
        w=.098+.084*math.exp(-((zi-3.78)/.50)**2)+.028*math.exp(-((zi-6.67)/.38)**2)
        w*=min(1,.15+th/.056)
        dh=v*th
        tang=.021+.061*i/(len(path)-1)
        return polar(a+tang+t*w/ri,ri+d[i,0]*dh,zi-d[i,1]*dh)
    section=[(1.04,-.35),(1.04,.35),(.91,.72),(.74,.91),(.46,1),(-.48,1),(-.76,.93),
             (-.93,.70),(-1.0,.35),(-1.0,-.35),(-.93,-.70),(-.76,-.93),(-.48,-1),(.46,-1),(.74,-.91),(.91,-.72)]
    for j,((v0,t0),(v1,t1)) in enumerate(zip(section,section[1:]+section[:1])):
        rows=[]
        for i in range(len(path)):
            rows.append([tine(i,v0,t0),tine(i,v1,t1)])
        M.grid(rows,AU if j in (0,1,7,8,14,15) else CU,.85 if j in [5,6,9] else .97)
    # A double-lined, recessed feather sweeps down each cheek.
    for face in [-1,1]:
        for part in ['fillet','panel','crown']:
            rows=[]
            for i,(z,r,th) in enumerate(path):
                f=i/(len(path)-1)
                if part=='crown' and f<.68:continue
                if part=='panel' and (f<.10 or f>.79):continue
                if part=='fillet':
                    vc=.54+.14*math.sin(math.pi*f); vw=.065
                elif part=='panel':
                    vc=-.22+.19*math.sin(f*7);vw=.27*max(.03,math.sin((f-.10)/.69*math.pi))**.55
                else:
                    vc=.10+.19*math.cos(f*11);vw=.72*min(1,(f-.68)*8)
                row=[tine(i,vc+vw*j,face*(1.015+.079*(1-j*j))) for j in [-1,-.4,.32,1]]
                rows.append(row if face==-1 else row[::-1])
            M.grid(rows,AU if part!='panel' else 'Deep bronze',.85)
        for start,finish,material in [(77,87,AU),(79,86,'Crystal')]:
            rows=[]
            for i in range(start,finish+1):
                f=(i-start)/(finish-start)
                w=(.66 if material==AU else .44)*max(.04,math.sin(math.pi*f))**.62
                row=[tine(i,-.16+j*w,face*(1.09+.032*(1-j*j)+(.013 if material=='Crystal' else 0))) for j in [-1,-.3,.4,1]]
                rows.append(row if face==-1 else row[::-1])
            M.grid(rows,material,.88 if material==AU else [.008,.35,.44])
    if idx==1:
        branch=track([(6.14,1.19,.015),(6.36,1.15,.052),(6.52,1.065,.064),
                      (6.59,.95,.071),(6.585,.86,.066),(6.525,.811,.057),(6.471,.831,.039),(6.474,.862,.01)],37)
        derivative=np.gradient(branch[:,:2],axis=0)
        derivative/=np.linalg.norm(derivative,axis=1)[:,None]
        shell=[]
        for i,(z,r,w) in enumerate(branch):
            row=[]
            for t in np.linspace(0,TAU,13):
                dh=w*math.cos(t)
                row.append(polar(a+.060+w*math.sin(t)/r,r+derivative[i,0]*dh,z-derivative[i,1]*dh))
            shell.append(row)
        for j in range(12):
            M.grid([[row[j],row[j+1]] for row in shell],AU if j in [0,5,6,11] else CU,.95)
        for j in [2,3,8,9]:
            M.grid([[row[j],row[j+1]] for row in shell[29:35]],'Crystal',[.004,.31,.37])
    # The cheek is seen from the side. Its thick crescent section interlocks with
    # the hook, with the fork growing from the concave edge of the same casting.
    cheek=profile([(2.57,1.00,1.01,.026),(2.71,1.015,1.096,.096),(2.89,1.055,1.212,.125),
       (3.035,1.028,1.252,.142),(3.13,.973,1.326,.147),(3.30,1.031,1.425,.150),
       (3.50,1.069,1.507,.160),(3.72,1.107,1.549,.162),(3.91,1.114,1.556,.157),
       (4.13,1.081,1.518,.155),(4.31,1.036,1.449,.141),(4.45,.959,1.397,.131),
       (4.56,.886,1.346,.116),(4.65,.866,1.256,.085),(4.72,.902,1.13,.063),(4.77,.96,1.010,.029)])
    def cheekpoint(t,z,side,lift=0):
        ri,ro,w=cheek(z);r=ri+(ro-ri)*(t+1)*.5
        d=w*(.71+.43*(1-abs(t)**1.8))+.037*math.exp(-((t-.48)/.29)**2)+lift
        sway=.028+.066*math.sin((z-3.32)*1.7)
        return polar(a+sway+side*d/r,r,z)
    zs=np.unique(np.r_[np.linspace(2.57,4.77,49),3.035,3.13,4.65])
    for side in [-1,1]:
        us=np.linspace(-1,1,13)
        rows=[[cheekpoint(t,z,side) for t in us] for z in zs]
        uv=np.array([panel_uv(3,(t+1)/2,(4.77-z)/2.2) for z in zs for t in us])
        M.grid(rows,'Chased copper',.94,side>0,uv=uv)
        for bound in [-1,1]:
            fillet=[bound,bound*(1-.035),bound*(1-.087)]
            rows=[[cheekpoint(t,z,side,.005+.009*(j==1)) for j,t in enumerate(fillet)] for z in zs]
            M.grid(rows,AU,.88,(bound<0)!=(side<0))
        # A cast eye and its pin belong to the broad side face, visible in profile.
        def cheekface(u,z,h=0):return cheekpoint(u,z,side,h+.007)
        for width,mat,off in [(.073,AU,.017),(.048,DK,.037),(.031,CU,.043)]:
            M.leaf(lambda u,z,h:cheekface(u,z,h+off),[(.09,3.66,.002),(.06,3.75,width),
                  (.085,3.83,width*.69),(.13,3.89,.002)],mat,20,.22,.018,.89)
    for t in [-1,1]:
        rows=[]
        for z in zs:
            rows.append([cheekpoint(t,z,side) for side in np.linspace(-1,1,6)])
        M.grid(rows,CU,.82,t<0)
for idx,deg in enumerate([27,-88,-147,119]):
    M.node=['Dawn leaf','West crook','Dusk leaf','East crook'][idx]
    cast_blade(math.radians(deg),idx)

# A closed pear-shaped crown crystal. Cut planes have individual colours and
# discontinuous etched facet edges. The pivot is on its vertical axis.
M.node='crystal'
zr=[(6.035,.015),(6.20,.055),(6.43,.263),(6.66,.460),(6.88,.503),(7.105,.413),(7.29,.210),(7.51,.001)]
def gem():
    n=9; angles=np.arange(n)*TAU/n+.16
    rings=[]
    for j,(z,r) in enumerate(zr):
        pts=[]
        for i,a in enumerate(angles):
            theta=a+[0,.06,-.08,.11,.055,-.10,-.05,0][j]+.023*math.sin(i*9.13+j*.73)
            rr=1.052*r*(1+.041*math.cos(i*4.36+j*.7))
            zz=z+(0 if j in (0,len(zr)-1) else .048*math.sin(i*2.63+j))
            pts.append(np.array(polar(theta,rr,zz)))
        rings.append(pts)
    for j in range(len(rings)-1):
        for i in range(n):
            ip=(i+1)%n
            A,B,C,D=rings[j][i],rings[j][ip],rings[j+1][ip],rings[j+1][i]
            # Irregular quadrangular cut planes with light pooling near their lower edge.
            val=.46+.32*(.5+.5*math.sin(i*3.43+j*.87))
            rows=[];colors=[]
            for v in [0,.13,.64,1]:
                row=[]
                for u in [0,.17,.77,1]:
                    p=(1-v)*((1-u)*A+u*B)+v*((1-u)*D+u*C)
                    row.append(p)
                    shine=.22*(1-v)**2+.12*math.sin(u*math.pi)**6*(j in (2,4))
                    colors.append([.007+shine*.11,(val+shine)*.87,min(1,val*1.14+shine)])
                rows.append(row)
            uv=np.array([[(i+(.001+.998*u))/n,(j+.001+.998*v)/(len(rings)-1)] for v in [0,.13,.64,1] for u in [0,.17,.77,1]])
            M.grid(rows,'Heart of tide',1.,uv=uv)
            if j in [2,4,5] or i%3==0:
                # A thin polished arris on select facets.
                rows=[]
                for v in np.linspace(0,1,8):
                    w=(.0023+.0042*math.sin(math.pi*v)**1.3)/max(.11,np.linalg.norm(B-A))
                    row=[]
                    for u in (0,w):
                        p=(1-v)*((1-u)*A+u*B)+v*((1-u)*D+u*C)
                        p=p.copy();p[:2]*=1.0018;row.append(p)
                    rows.append(row)
                M.grid(rows,'Crystal vein',[.35,.88,.94])
    M.mesh(rings[0],[list(range(n))],'Crystal',[.012,.51,.62],True)
    M.mesh(rings[-1],[list(range(n))],'Crystal vein',[.67,.94,1])
gem()
out=ROOT/'out'
out.mkdir(exist_ok=True)
def lift(z):
    return np.interp(z,[0,1.30,1.80,2.85,3.34,4.65,5.4,5.74,6.1,6.8,7.51],
          [0,0,.09,.22,.25,.15,.09,.035,0,0,0])
for (node,material),group in M.parts.items():
    for pos,normals,faces,colors,uv in group:
        z=pos[:,2]
        if node=='Footstones': pos[:,:2]*=.973
        elif node=='Bell and sabatons':pos[:,:2]*=.985
        elif node!='crystal':
            if node=='Lower limestone drum':
                pos[:,:2]*=(1+.057*np.exp(-((z-3.18)/.24)**4))[:,None]
            pos[:,2]+=lift(z)
M.save(out/'tower_me_outer.glb')
