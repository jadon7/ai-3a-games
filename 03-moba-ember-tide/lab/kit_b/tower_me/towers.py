"""Build the three Moon Court towers from the B design. Run with the video2rig Python."""
from math import asin, atan, atan2, cos, hypot, pi, sin, tau
from pathlib import Path

import numpy as np
from scipy.interpolate import PchipInterpolator
from scipy.spatial import ConvexHull

from geometry import Mesh, interpolate, polar

OUT=Path(__file__).resolve().parent/'out'


def molding(mesh, profile, material, sides=48, shades=None, point=polar):
    # Radius/height sections run from the lower lip to the upper lip.
    rows=[[point(a*tau/sides,r,y) for a in range(sides)] for y,r in profile]
    mesh.loft(rows,material,1. if shades is None else np.array(shades)[:,None])


def stone_course(mesh, lo, hi, radii, count, phase, bevel=.052, point=polar, knots=(), posts=()):
    # Each voussoir is closed on all sides. The stone heart behind the joints stays visible in the ruins.
    corners= [(0,1),(.29,.30),(.69,.05),(1,0)]
    if hi-lo>.65:
        corners=[(0,1),(.29,.29),(1,0)]
    levels=[(lo+t*bevel, inset*bevel, .82+.18*t) for t,inset in corners]
    levels += [(y,0,1.) for y in np.linspace(lo+bevel,hi-bevel,3)[1:-1]] if hi-lo>.65 else []
    levels.extend((y,0,1.) for y in knots if lo+bevel < y < hi-bevel and all(abs(y-z)>.10 for z,_,_ in levels))
    levels.sort()
    levels+= [(hi-t*bevel,inset*bevel,1.) for t,inset in reversed(corners)]
    for k in range(count):
        start=phase+k*tau/count
        rows, grey=[], []
        for y,inset,shade in levels:
            r=float(radii(y))-inset
            edge=.018+inset
            small=.19
            low=start+asin(edge/r)
            high=start+tau/count-asin(edge/r)
            b=.046
            ring=[polar(start+asin(edge/small),small,y)]
            # Round both corners where the sector meets the cylindrical face.
            for dr,dt in [(b,0),(.32*b,.08*b),(.07*b,.35*b),(0,b)]:
                ring.append(point(low+dt/r,r-dr,y))
            face_angles=np.linspace(low+b/r,high-b/r,9)[1:-1]
            for axis in posts:
                local=start+(axis-start)%tau
                idx=np.argmin(abs(face_angles-local))
                if face_angles[0]<=local<=face_angles[-1]:
                    face_angles[idx]=local
            ring.extend(point(a,r,y) for a in face_angles)
            for dr,dt in [(0,b),(.07*b,.35*b),(.32*b,.08*b),(b,0)]:
                ring.append(point(high-dt/r,r-dr,y))
            ring.append(polar(start+tau/count-asin(edge/small),small,y))
            rows.append(ring)
            grey.append([min(1.,shade*v) for v in ([.92,.94,.97,.99]+[1.]*(len(ring)-8)+[.99,.97,.94,.92])])
        mesh.loft(rows,'stone',grey)
    if hi-lo<.3:
        molding(mesh,[(lo,.26),(hi,.26)],'stone',12,[.86,.92])


def rail(mesh,angle,stations,crest,depth,gold=.05):
    # The circular face meets the 60 mm quarter-round with a common tangent.
    ys,_,widths=zip(*stations)
    width=PchipInterpolator(ys,widths)
    bevel=.060
    rows=[]
    heights=list(ys)
    for a,b in zip(ys,ys[1:]):
        t=np.array([.25,.50,.75])
        chord=crest(a)*(1-t)+crest(b)*t
        if np.max(np.abs(crest(a+(b-a)*t)-chord))>.011:
            heights.append((a+b)*.5)
    for y in sorted(heights):
        r=float(crest(y)); half=float(width(y))*.5
        theta=2*atan(.038/(half-.040))
        arc_radius=(half-bevel)/sin(theta)+bevel
        tangent_z=arc_radius*(cos(theta)-1.)
        fillet_z=tangent_z-bevel*cos(theta)
        gold_start=theta-gold/arc_radius
        face=[(arc_radius*sin(t),arc_radius*(cos(t)-1.)) for t in
              [0.,gold_start*.48,gold_start,theta]]
        lip=[(half-bevel+bevel*sin(t),fillet_z+bevel*cos(t))
             for t in np.linspace(theta,pi/2,4)[1:]]
        back=[(half,-depth+bevel),(half-bevel,-depth)]
        side=face[1:]+lip+back
        contour=[(0,0)]+side+[(-x,z) for x,z in reversed(side)]
        rows.append([polar(angle,r+z,y,x) for x,z in contour])
    bands=['metal']*len(contour)
    bands[2]=bands[-3]='accent'
    shades=[1.,1.,.985,.965,.97,.95,.92,.88,.84]
    mesh.loft(rows,bands,shades+shades[:0:-1])


def waist(mesh,y,inner):
    # The belt bows out across its height; tangent fillets round both gold-edged lips.
    half=.25; bevel=.060
    theta=2*atan(.038/(half-.040))
    arc_radius=(half-bevel)/sin(theta)+bevel
    crest=inner+.18
    shoulder=crest+arc_radius*(cos(theta)-1.)
    fillet_center=shoulder-bevel*cos(theta)
    side=[(arc_radius*sin(t),crest+arc_radius*(cos(t)-1.))
          for t in [theta*.40,theta*.72,theta]]
    side.extend((half-bevel+bevel*sin(t),fillet_center+bevel*cos(t))
                for t in np.linspace(theta,pi/2,4)[1:])
    side.append((half,inner))
    profile=[(-h,r) for h,r in reversed(side)]+[(0.,crest)]+side
    bands=['metal']*(len(profile)-1)
    bands[4]=bands[-5]='accent'
    rows=[[polar(a*tau/36,r,y+h) for a in range(36)] for h,r in profile]
    mesh.loft(rows,np.array(bands)[:,None],np.array([.85,.88,.93,.98,1,1,1,1,1,1,1,1,1,1,.98])[:,None])


def capital(mesh,y,ring_radius,crest,phase,neck=False):
    # Each saddle sweeps from the narrow spar onto both sides of the annular band.
    # The side wings return behind the band. Above the wing is a broad lit bevel.
    for i in range(4):
        angle=phase+i*pi/2
        rows=[]
        for h,half,reach in [(-.64,.18,.08),(-.42,.25,.16),(-.25,.40,.36),(-.14,.55,.69),
                             (-.045,.65,1.),(.055,.66,1.),(.12,.57,.91),(.15,.41,.80)]:
            yy=y+h*(.58 if neck else 1.)
            half*=.68 if neck else .92
            rr=float(crest(yy))
            tangents=[-1.,-.89,-.63,-.36,0,.36,.63,.89,1.]
            front=[]
            for u in tangents:
                bend=abs(u)**1.65
                rad=rr-.045-.018*(1-bend)+(ring_radius-rr)*reach*bend
                lift=.10*reach*abs(u)**1.4
                front.append(polar(angle,rad,yy+lift,u*half))
            back=[polar(angle,ring_radius-.15,yy+.06*reach,half*.93),
                  polar(angle,ring_radius-.15,yy+.06*reach,-half*.93)]
            rows.append(front+back)
        bands=np.full((len(rows)-1,11),'metal',dtype='<U6')
        bands[5,1:7]='accent'
        mesh.loft(rows,bands,[.91,.97,1,1,1,1,1,.97,.91,.85,.85])


def skirt(mesh,y,phase):
    # The lip rolls into a 30 degree shoulder. Its top returns into the bell.
    section=[(0,1.32),(0,1.76),(.015,1.798),(.055,1.82),
             (.365,1.812),(.442,1.797),(.471,1.747),
             (.493,1.709),(.500,1.700),(.488,1.35),(0,1.32)]
    angles=phase+np.arange(36)*tau/36
    # Seat the four spars in the casting, so the lower points of the shields remain exposed.
    recess=.14*np.maximum(0.,np.cos(4*(angles-phase)))**4
    rows=[[polar(a,r-cut*max(0.,min(1.,(r-1.35)/.35)),y+h)
           for a,cut in zip(angles,recess)] for h,r in section]
    mats=['metal']*(len(section)-1)
    mats[6]='accent'
    shades=[.84,.86,.93,.98,1,1,1,1,1,.91,.84]
    mesh.loft(rows,np.array(mats)[:,None],np.array(shades)[:,None],caps=False)


def plinth(mesh,y,r,h):
    # Large exposed bronze drum with a soft roll above the grounded lower bevel.
    keys=[(0,-.10),(.105,-.018),(.20,0),(.28,0),(.51,-.030),(.82,-.015)]
    rows=[[polar(i*tau/32,r+d,y+h*t) for i in range(32)] for t,d in keys]
    mats=['metal']*(len(keys)-1)
    mats[2]='accent'
    mesh.loft(rows,np.array(mats)[:,None],np.array([.82,.94,.99,1,.92,.98])[:,None],caps=False)


def collar(mesh,y,phase):
    angles=np.arange(48)*tau/48
    tube=[(-.08,-.03),(-.073,.033),(-.048,.065),(-.012,.08),(.024,.077),
          (.058,.055),(.078,.020),(.08,-.026),(.055,-.063),(.014,-.08),(-.038,-.072),(-.08,-.03)]
    rows=[[polar(a,1.20+dr,y+h) for a in angles] for h,dr in tube]
    mesh.loft(rows,'metal',caps=False)
    for i in range(8):
        kite(mesh,phase+i*tau/8,y,1.252,.315,.38)


def shield(mesh,angle,y,spine):
    # Winged shoulder and long lower point. The rear half keys into the support.
    sections=[(-.5,.028),(-.43,.060),(-.29,.14),(-.13,.25),(.035,.35),(.105,.347),
              (.18,.303),(.35,.194),(.46,.080),(.5,.032)]
    cross=[(-1.,-.09),(-.96,-.043),(-.82,-.014),(-.69,-.005),(0,.027),
           (.69,-.005),(.82,-.014),(.96,-.043),(1,-.09),(.81,-.093),(-.81,-.093)]
    rows=[]
    for h,w in sections:
        rad=float(spine(y+h))+.050-.055*abs(2*h)**2
        rows.append([polar(angle,rad+d,y+h,w*u) for u,d in cross])
    bands=np.full((len(rows)-1,len(cross)),'metal',dtype='<U6')
    bands[:,2]=bands[:,5]='accent'
    bands[6:,1:4]='accent'
    bands[7:,4:6]='accent'
    mesh.loft(rows,bands,[.86,.94,1,1,1,1,1,.94,.86,.84,.84])
    kite(mesh,angle,y,float(spine(y))+.049,.344,.65,shallow=True)


def kite(mesh,angle,y,r,width,height,gem=True,shallow=False):
    # Four sloping shoulders carry a smaller diamond cut. The lower point keys into the spar.
    outline=np.array([(0, .5),(.34,.19),(.5,.04),(.32,-.16),(0,-.5),(-.32,-.16),(-.5,.04),(-.34,.19)])
    depth=.46 if shallow else 1.
    rows=[]
    for scale,dr in [(1.,-.06),(1.,0),(.87,.048),(.64,.082)]:
        rows.append([polar(angle,r+depth*(dr-.045*abs(x)*2),y+h*height*scale,x*width*scale) for x,h in outline])
    pts=list(np.reshape(rows,(-1,3)))
    faces=[]; mats=[]; grey=[.88]*8+[.93]*8+[1.]*16
    for k in range(3):
        for i in range(8):
            a=k*8+i; b=k*8+(i+1)%8
            faces.extend([(a,b+8,b),(a,a+8,b+8)])
            mats.extend((['accent'] if k==1 and not gem else ['metal'])*2)
    mesh.surface(pts,faces,mats,grey)
    def face(coords,mat,shade):
        p=[polar(angle,r+depth*d,y+z*height,x*width) for x,z,d in coords]
        mesh.surface(p,[(0,2,1)],mat,shade)
    # End triangles are deliberately split for planar, legible facets.
    stones=outline*.64
    for i in range(8):
        j=(i+1)%8
        face([(*stones[i],.083-.045*abs(outline[i,0])*2),(*stones[j],.083-.045*abs(outline[j,0])*2),
              (-.036,.035,.148 if gem else .146)],'crystal' if gem else 'metal',1. if i in (4,5,6,7) else .91)


def crescent(mesh,angle,bottom,top,outer_radius,short=False):
    # Plane of the moon, swept normal to its arc. Width swells at the heel and dies into the tip.
    if short:
        keys=[(-.42,.58,.032,.045),(-.48,.51,.084,.10),(-.50,.37,.130,.13),
              (-.43,.23,.163,.153),(-.22,.14,.181,.161),(.055,.135,.185,.167),
              (.32,.22,.168,.154),(.465,.38,.156,.149),(.49,.55,.116,.123),
              (.45,.69,.074,.087),(.38,.77,.027,.037)]
    else:
        keys=[(.18,.102,.154,.17),(.43,.120,.242,.19),(.68,.184,.249,.182),
              (.86,.292,.223,.165),(.978,.443,.171,.140),(1.,.552,.158,.133),
              (.983,.618,.150,.128),(.941,.661,.183,.151),(.902,.730,.159,.140),
              (.80,.830,.141,.123),(.625,.923,.110,.10),(.372,.992,.034,.042)]
    path=interpolate(keys,3)
    rs=path[:,0]*(1 if short else outer_radius-.158)
    ys=bottom+path[:,1]*(top-bottom)
    dr,dy=np.gradient(rs),np.gradient(ys)
    section=[(0,1),(.64,.96),(.83,.83),(.96,.66),(1,.52),(1,.23),(.985,-.18),
             (.92,-.52),(.68,-.87),(0,-1),(-.68,-.87),(-.92,-.52),(-.985,-.18),
             (-1,.23),(-1,.52),(-.96,.66),(-.83,.83),(-.64,.96)]
    rows=[]
    for i,(_,t,half,wide) in enumerate(path):
        scale=hypot(dr[i],dy[i])
        row=[]
        for u,q in section:
            xx=rs[i]+q*half*dy[i]/scale
            yy=ys[i]-q*half*dr[i]/scale
            if short:
                depth=.661+.067*t
                row.append(polar(angle,depth-u*wide,yy,xx))
            else:
                row.append(polar(angle,xx,yy,u*wide))
        rows.append(row)
    bands=['metal']*len(section)
    bands[4]=bands[13]='accent'
    mesh.loft(rows,bands,[1,1,1,1,1,1,.99,.94,.90,.86,.90,.94,.99,1,1,1,1,1])


def bowl(mesh,y,r,h,flutes=0):
    # Solid foot with a rolled rim and a recessed bed for the lower end of the crystal.
    profile=[(0,.40),(.05,.49),(.16,.58),(.31,.73),(.51,.90),(.68,.978),(.80,1.),
             (.90,.99),(.98,.95),(1.,.88),(.94,.81),(.71,.65),(.62,.29)]
    rows=[]
    for t,q in profile:
        row=[]
        for i in range(48):
            a=i*tau/48
            lobe=.5+.5*cos(flutes*(a-pi/6)) if flutes else 0.
            rib=.12*lobe*sin(t*pi*.70) if flutes else 0.
            lip=.32*lobe*t*t if flutes else 0.
            row.append(polar(a,r*q+rib,y+h*t+lip))
        rows.append(row)
    mats=['metal']*(len(rows)-1)
    mats[6]='accent'
    mesh.loft(rows,np.array(mats)[:,None],np.array([.82,.86,.89,.94,.98,1,1,1,1,1,.96,.9,.86])[:,None])


def lotus(mesh,angle,outer):
    # Centreline is specified in metres. Width crosses the petal, thickness is normal to the curl.
    if outer:
        keys=[(.94,9.15,.48,.20),(1.07,9.22,.60,.22),(1.25,9.35,.71,.22),
              (1.44,9.52,.75,.22),(1.60,9.70,.745,.22),(1.676,9.86,.63,.22),
              (1.710,10.00,.40,.20),(1.750,10.12,.105,.095)]
    else:
        keys=[(.56,8.99,.36,.18),(.73,9.13,.53,.21),(.88,9.34,.64,.22),
              (.97,9.57,.65,.22),(1.015,9.82,.59,.22),(1.01,10.04,.43,.20),
              (.97,10.21,.19,.145),(.91,10.35,.068,.08)]
    data=interpolate(keys,1)
    dr,dy=np.gradient(data[:,0]),np.gradient(data[:,1])
    section=[(0,.60),(.43,.44),(.72,.30),(.89,.20),(.975,.09),(1,-.07),
             (.966,-.27),(.86,-.40),(.50,-.44),(0,-.46),(-.50,-.44),
             (-.86,-.40),(-.966,-.27),(-1,-.07),(-.975,.09),(-.89,.20),(-.72,.30),(-.43,.44)]
    rows=[]
    for i,(r,y,w,thick) in enumerate(data):
        length=hypot(dr[i],dy[i])
        row=[]
        for u,q in section:
            bend=(.095 if outer else .083)*w*u*u
            shift=q*thick-bend
            rr=r+shift*dy[i]/length
            yy=y-shift*dr[i]/length+.045*w*u*u
            along=i/(len(data)-1)
            sweep=(.050 if outer else -.105)*along**2
            row.append(polar(angle+sweep,rr,yy,u*w/2))
        rows.append(row)
    bands=np.full((len(rows)-1,len(section)),'metal',dtype='<U6')
    bands[1:-2,3]=bands[1:-2,14]='accent'
    mesh.loft(rows,bands,[1,1,1,1,1,.99,.95,.90,.87,.89,.87,.90,.95,.99,1,1,1,1])


def jewel(mesh,top,h,width,center):
    mesh.pivot['crystal']=(0,center,0)
    # Stagger the corners of the pavilion and crown. Eight narrow upper edge facets
    # separate the long faces. The narrow cut facing the light uses the glow material.
    points=[[0,top-h,0],[0,top,0]]
    for i in range(8):
        angle=i*tau/8
        for turn,z,r in [(0,.31+.028*(-1)**i,1.),(.36,.145+.018*(-1)**i,.66),
                         (.48,.52+.054*(-1)**i,.875),(.025,.76+.036*(-1)**i,.52),
                         (.14,.765+.036*(-1)**i,.517)]:
            points.append(polar(angle+turn*tau/8,r*width/2,top-h+h*z))
    p=np.array(points)
    hull=ConvexHull(p)
    for indices,plane in zip(hull.simplices,hull.equations):
        a,b,c=p[indices]
        if np.dot(np.cross(b-a,c-a),plane[:3])<0:
            b,c=c,b
        theta=atan2(plane[0],plane[2])
        slender=np.linalg.norm(np.cross(b-a,c-a))<width*h*.029
        lit=1 in indices and slender and (abs(theta-.22)<.55 or abs(theta+2.5)<.5)
        bright=.75+.25*(.5+.5*cos(3*theta+.72*plane[1])) if 1 not in indices else .89+.11*(.5+.5*cos(3*theta))
        mesh.surface([a,b,c],[(0,1,2)],'glow' if lit else 'crystal',bright,'polish' if lit else 'crystal')



def build(tier):
    mesh=Mesh()
    top=[7.52,9.24,11.06][tier-1]
    steps=[[1.89],[2.55,2.02],[3.14,2.48,1.83]][tier-1]
    floor=len(steps)*.20
    for k,r in enumerate(steps):
        stone_course(mesh,k*.2,(k+1)*.2,lambda y:r,6,k*.52+.14,.044)

    if tier==1:
        eave=4.71
        profile=[(floor,1.30),(.69,1.29),(1.36,1.18),(2.55,1.005),(3.71,.90),(eave+.07,.90)]
        levels=[floor,1.34,2.57,3.77,eave+.07]
        spine=[(.2,1.70,.54),(.30,1.75,.58),(.54,1.748,.58),(.66,1.727,.575),(.92,1.642,.54),
               (1.45,1.48,.5),(2.5,1.355,.5),(3.42,1.326,.5),(4.38,1.351,.5),
               (4.50,1.36,.5),(4.61,1.431,.555),(4.67,1.45,.595),
               (4.72,1.431,.585),(4.78,1.373,.555),(4.84,1.23,.475)]
        phase=pi/4
    elif tier==2:
        eave=6.38
        profile=[(floor,1.65),(1.0,1.65),(1.18,1.57),(1.70,1.32),(2.35,1.16),
                 (3.25,1.085),(3.80,1.055),(4.28,1.14),(4.58,1.16),(5.30,.965),
                 (5.61,.90),(eave+.08,.90)]
        levels=[floor,1.49,2.64,3.80,5.10,eave+.08]
        spine=[(.4,1.785,.75),(.78,1.790,.73),(1.15,1.739,.68),(1.50,1.643,.64),
               (1.90,1.525,.6),(2.35,1.411,.6),(2.85,1.343,.6),(3.45,1.299,.64),
               (3.80,1.294,.7),(4.02,1.315,.65),(4.31,1.422,.6),(4.57,1.46,.6),
               (5.27,1.367,.6),(5.61,1.30,.6),(6.46,1.30,.65)]
        phase=.035
        belts=[(3.8,1.15)]
    else:
        eave=8.23
        profile=[(floor,1.75),(1.20,1.75),(1.42,1.60),(1.83,1.40),(2.35,1.235),
                 (2.93,1.126),(3.22,1.10),(3.41,1.13),(3.67,1.26),(3.88,1.41),(4.15,1.49),
                 (4.46,1.43),(4.75,1.32),(5.20,1.18),(5.77,1.081),(6.0,1.06),(6.48,1.27),
                 (6.85,1.22),(7.25,1.01),(7.46,.90),(eave+.08,.90)]
        levels=[floor,1.91,3.20,4.52,6.0,7.12,eave+.08]
        spine=[(.60,1.785,.79),(.84,1.782,.8),(1.17,1.74,.75),(1.57,1.650,.7),
               (2.08,1.525,.7),(2.68,1.40,.7),(3.01,1.352,.72),(3.20,1.345,.78),
               (3.39,1.359,.73),(3.58,1.443,.71),(3.85,1.646,.7),(4.13,1.777,.7),
               (4.34,1.749,.7),(4.69,1.64,.7),
               (5.27,1.459,.7),(5.80,1.360,.74),(6.00,1.342,.78),(6.21,1.365,.7),
               (6.56,1.50,.7),(6.96,1.445,.7),(7.46,1.32,.7),(8.31,1.32,.74)]
        belts=[(3.2,1.20),(6.,1.16)]
        phase=.035

    depth=[.28,.30,.32][tier-1]
    radius=PchipInterpolator(*zip(*profile))
    crest=PchipInterpolator(*zip(*[(y,r) for y,r,w in spine]))
    def stone_point(a,r,y):
        if tier==1:
            return polar(a,r,y)
        # The face between spars retains the mouth of the bell; a broad rebate behind
        # each spar gives the back of the metal a 100 mm radial bedding space.
        angle=abs((a-phase+pi/4)%(pi/2)-pi/4)
        f=min(1.,max(0.,(angle-.20)/.48))
        relief=(1-f*f*(3-2*f))*max(0.,float(radius(y))-float(crest(y))+depth+.10)
        return polar(a,r-relief,y)
    knots=[] if tier==1 else ([3.62,4.02,4.56,5.61] if tier==2 else [3.43,3.67,4.13,5.79,6.39,7.46])
    for k,(a,b) in enumerate(zip(levels,levels[1:])):
        stone_course(mesh,a+.017,b-.018,radius,5 if tier==1 else 4,.28+k*.53,.055,stone_point,knots,() if tier==1 else [phase+i*pi/2 for i in range(4)])
    molding(mesh,[(y,float(radius(y))-.14) for y in np.linspace(floor,eave+.08,13)],'stone',24,point=stone_point)
    if tier==1:
        # The quarter-round is 80 mm both radially and vertically.
        cap=[(0,1.17),(.0107,1.21),(.04,1.2393),(.08,1.25),(.27,1.25),
             (.31,1.2393),(.3393,1.21),(.35,1.17)]
        molding(mesh,[(eave+h,r) for h,r in cap],'stone',48,[.85,.92,.97,1,1,1,1,1])
        molding(mesh,[(eave+.345,.85),(eave+.37,.85),(5.20,.85),(5.25,.83)],'stone',48)
    else:
        lip=1.65 if tier==2 else 1.75
        molding(mesh,[(floor+.36,lip-.11),(floor+.415,lip-.04),(floor+.475,lip),
                      (floor+.615,lip),(floor+.675,lip-.035),(floor+.70,lip-.11)],
                'stone',48,[.85,.91,.98,1,1,1],stone_point)
        base_radius=1.735 if tier==2 else 1.79
        plinth(mesh,floor,base_radius,.415)
        for y,r in belts:
            capital(mesh,y,r+.13,crest,phase)
            waist(mesh,y,r)
        skirt(mesh,floor+.24,phase)
        if tier==3:
            skirt(mesh,3.98,phase)
        molding(mesh,[(eave-.055,.881),(eave,.894),(eave+.07,.90),
                      (eave+.15,.89),(eave+.208,.855)],'stone',48,[.89,.96,.99,1,1])
        capital(mesh,eave+.06,1.16,crest,phase,neck=True)
        collar(mesh,eave+.235,phase)
    for i in range(4):
        angle=phase+i*pi/2
        rail(mesh,angle,spine,crest,.28 if tier==1 else .30,.05 if tier==1 else .029)
        if tier==1:
            bay=angle-pi/4
            kite(mesh,bay,3.55,float(radius(3.55)),.43,.82)
            for turn in [-.40,.40]:
                kite(mesh,bay+turn,1.27,float(radius(1.27)),.26,.54)
        else:
            shield(mesh,angle,1.48 if tier==2 else 1.57,crest)
            for y,r in belts:
                shield(mesh,angle,y,crest)
    if tier<3:
        socket_y,socket_radius,h=(5.25,.95,.45) if tier==1 else (6.59,1.03,.53)
        bowl(mesh,socket_y,socket_radius,h)
        for i in range(4):
            crescent(mesh,pi/2+i*pi/2,socket_y+.13,top-.055,1.63 if tier==1 else 1.75,i%2==1)
    else:
        bowl(mesh,8.445,1.19,.855,6)
        for i in range(6):
            lotus(mesh,pi/6+i*tau/6,True)
        for i in range(5):
            lotus(mesh,i*tau/5,False)
    jewel(mesh,top,[1.90,2.10,2.50][tier-1],[1.25,1.40,1.65][tier-1],[6.62,8.24,9.86][tier-1])
    print(tier,mesh.save(OUT/f'tower_me_{tier}.glb'))


if __name__=='__main__':
    OUT.mkdir(exist_ok=True)
    for tier in [1,2,3]:
        build(tier)
