"""Small mesh tools for the Moon Court turret. Authoring coordinates are Z-up."""
import io
import json
import math
import struct
from collections import defaultdict

import numpy as np
from PIL import Image, ImageDraw
from chasing import painted_panels
from scipy.ndimage import gaussian_filter
from scipy.interpolate import PchipInterpolator, CubicSpline

TAU = math.tau
def polar(a, r, z):
    return (r * math.sin(a), -r * math.cos(a), z)

def profile(keys):
    data = np.array(keys, float)
    f = PchipInterpolator(data[:, 0], data[:, 1:], axis=0, extrapolate=False)
    def sample(z):
        val = f(np.clip(z, data[0, 0], data[-1, 0]))
        return float(val[0]) if len(val) == 1 else val
    return sample

def track(points, samples):
    p = np.array(points)
    s = np.r_[0, np.cumsum(np.maximum(.001, np.linalg.norm(np.diff(p[:, :2], axis=0), axis=1))**.65)]
    return CubicSpline(s, p, bc_type='natural')(np.linspace(0, s[-1], samples))

def painted(kind):
    """Tile of broad scumbles, chipped pigment and fine mineral or oxide deposits."""
    n = 768
    rng = np.random.default_rng(131 if kind=='Stone' else 147 if kind=='Verdigris' else 196)
    y,x=np.mgrid[:n,:n]
    def field(sy,sx):
        f=gaussian_filter(rng.normal(size=(n,n)),(sy,sx),mode='wrap')
        return np.clip(f/(f.std()+1e-8),-2.6,2.6)
    broad=field(40,55)
    mid=field(9,21)
    strokes=field(1.5,8)
    islands=np.clip((field(21,19)+mid*.4-.45)*1.6,0,1)
    if kind=='Stone':
        base=np.array([191,183,171])
        rgb=base+broad[:,:,None]*[4.1,4.0,3.9]+mid[:,:,None]*[2.8,2.8,2.9]+strokes[:,:,None]*1.2
        rgb+=islands[:,:,None]*[-5,-3,0]
    elif kind=='Verdigris':
        base=np.array([83,103,87])
        rgb=base+broad[:,:,None]*[3.9,4.4,3.6]+mid[:,:,None]*[2.1,2.3,1.9]+strokes[:,:,None]*1.1
        rgb+=islands[:,:,None]*[10,6,-1]
    else:
        base=np.array([157,143,103])
        rgb=base+broad[:,:,None]*[5,5,4]+mid[:,:,None]*[2.2,2.8,2.1]+strokes[:,:,None]*1.6
        rgb+=islands[:,:,None]*[-18,-11,-2]
    im=Image.fromarray(np.uint8(np.clip(rgb,0,255)))
    draw=ImageDraw.Draw(im,'RGBA')
    for i in range(1650 if kind=='Stone' else 1150):
        xx,yy=rng.uniform(0,n,2); w=rng.uniform(1,4); l=rng.uniform(3,21)
        col=(255,245,214,int(rng.integers(9,40))) if i%3 else (39,37,31,int(rng.integers(10,45)))
        draw.polygon([(xx,yy),(xx+l*.65,yy-l*.3),(xx+l,yy-l*.18),(xx+w,yy+w*.5)],fill=col)
    # Branching fissures, with reflected light on one lip. Wrap all crossing strokes.
    for i in range(26 if kind=='Stone' else 16):
        p=rng.uniform(0,n,2); angle=rng.uniform(0,TAU)
        for j in range(rng.integers(3,9)):
            angle+=rng.uniform(-.79,.79); step=rng.uniform(3,14)
            q=p+step*np.array([math.cos(angle),math.sin(angle)])
            for dx in (-n,0,n):
                for dy in (-n,0,n):
                    a,b=p+[dx,dy],q+[dx,dy]
                    draw.line([tuple(a+[1,1]),tuple(b+[1,1])],fill=(245,227,188,96),width=1)
                    draw.line([tuple(a),tuple(b)],fill=(59,54,45,91),width=1 if j else 2)
            p=q
    data=io.BytesIO()
    im.save(data,format='JPEG',quality=90,subsampling=0)
    return data.getvalue()

def hewn_normal():
    n=768
    rng=np.random.default_rng(7843)
    img=Image.new('F',(n,n),0.0)
    draw=ImageDraw.Draw(img)
    for i in range(1250):
        x,y=rng.uniform(0,n,2)
        scale=rng.uniform(.4,1.25);length=rng.uniform(4,17)*scale;width=rng.uniform(1,4)*scale
        a=rng.normal(-.48,.31) if i%4 else rng.uniform(0,TAU)
        d=np.array([math.cos(a),math.sin(a)]);p=np.array([-d[1],d[0]])
        outline=[(-.5,0),(-.13,-.45),(.22,-.56),(.50,-.18),(.33,.28),(-.18,.53)]
        pts=[tuple([x,y]+d*t*length+p*u*width) for t,u in outline]
        draw.polygon(pts,fill=float(rng.uniform(-.98,-.25)))
    for i in range(39):
        xy=rng.uniform(0,n,2);a=rng.uniform(0,TAU)
        for j in range(rng.integers(3,8)):
            a+=rng.uniform(-.66,.66)
            yz=xy+rng.uniform(3,13)*np.array([math.cos(a),math.sin(a)])
            draw.line([tuple(xy),tuple(yz)],fill=-.68 if j<3 else -.45,width=1)
            xy=yz
    h=gaussian_filter(np.asarray(img),.63,mode='wrap')
    large=gaussian_filter(rng.normal(size=(n,n)),(17,31),mode='wrap')
    h+=.27*large/max(1e-5,large.std())
    gy,gx=np.gradient(h)
    normals=np.stack([-gx*2.15,gy*2.15,np.ones_like(gx)],axis=-1)
    normals/=np.linalg.norm(normals,axis=-1)[:,:,None]
    im=Image.fromarray(np.uint8((normals*.5+.5)*255))
    buf=io.BytesIO();im.save(buf,format='JPEG',quality=93,subsampling=0)
    return buf.getvalue()

def crystal_paint():
    """Hand-shaded optical atlas. Each cell maps to one particular cut face."""
    n=128; cols=9; rows=7
    canvas=Image.new('RGB',(n*cols,n*rows))
    rng=np.random.default_rng(4201)
    for j in range(rows):
        for i in range(cols):
            v,u=np.mgrid[:n,:n]/(n-1)
            t=(j+v)/rows
            # Vary the depths of the refracted planes behind the polished surface.
            lum=.50+.21*np.sin(i*2.63-j*.75)+.12*np.cos(i*1.43+j*1.8)
            pool=.32*np.exp(-((t-.31)/.22)**2)+.12*(1-v)**3
            ribbon=np.maximum(0,1-abs(u-(.28+.22*v+.13*np.sin(v*3+i)))/.14)
            internal=ribbon**1.4*np.sin(np.pi*v)**1.4*(.16 if (i+j)%4 else .43)
            plane=np.maximum(0,(u-.21)*.7-v+.3)
            blue=lum+pool+internal+plane*.21
            rgb=np.stack([3+10*pool+internal*65,94+blue*120,130+blue*91],axis=-1)
            rgb+=np.maximum(0,1-abs(.11*u+.71*v-.54)/.044)[:,:,None]*[1,4,6]
            # Secondary, angular cleavage reflections have soft lower ends.
            for q in range(3):
                a,b=rng.uniform(.1,.9,2)
                w=rng.uniform(.016,.068);span=rng.uniform(.09,.34)
                mask=np.clip(1-abs(u-a-.32*(v-b))/(w*np.maximum(.06,1-abs(v-b)/span)),0,1)
                mask*=np.clip(1-abs(v-b)/span,0,1)
                rgb+=mask[:,:,None]*[22,19,13]
            # Bright narrow arrises between major facet belts. Each tapers at one end.
            side=np.minimum(u,1-u)
            width=.002+.014*(.5+.5*np.cos(v*5+i))**2
            line=np.clip(1-side/width,0,1)
            if j in (2,4):
                line=np.maximum(line,np.clip(1-(1-v)/(.005+.029*(np.abs(u-.5)*2)**3),0,1))
            line*=.58+.41*(.5+.5*np.sin(i+j*3+v*2))
            rgb=rgb*(1-line[:,:,None])+np.array([174,255,251])*line[:,:,None]
            tile=Image.fromarray(np.uint8(np.clip(rgb,0,255)))
            canvas.paste(tile,(n*i,n*j))
    b=io.BytesIO();canvas.save(b,format='PNG');return b.getvalue()

class Model:
    def __init__(self):
        self.parts=defaultdict(list)
        self.node='Foundation'
        self.rng=np.random.default_rng(7259)
        self.mat={'Stone':(.04,.82), 'Verdigris':(.57,.53), 'Brass':(.69,.45),
                  'Deep bronze':(.56,.56), 'Crystal':(.20,.23), 'Crystal light':(.18,.22),
                  'Crystal vein':(.15,.25)}
        self.mat['Chased copper']=(.55,.46)
        self.mat['Heart of tide']=(.32,.20)
        self.emissions={'Crystal':(.0,.23,.29),'Crystal light':(.003,.37,.46),'Crystal vein':(.22,.87,1.0),
                        'Heart of tide':(.24,.85,.80)}
    def mesh(self, pos, faces, mat, color=1., reverse=False, uv=None):
        p=np.array(pos,dtype=float)
        tri=[]
        for face in faces:
            f=list(reversed(face)) if reverse else face
            for j in range(1,len(f)-1):
                tri.append([f[0],f[j],f[j+1]])
        if not tri:return
        f=np.array(tri,np.int32)
        fn=np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]])
        valid=np.linalg.norm(fn,axis=1)>1e-11
        f,fn=f[valid],fn[valid]
        if not len(f):return
        normals=np.zeros_like(p)
        for k in range(3):
            np.add.at(normals,f[:,k],fn)
        normals/=np.maximum(1e-12,np.linalg.norm(normals,axis=1)[:,None])
        if np.ndim(color)==0:color=np.full((len(p),3),color)
        else:color=np.broadcast_to(color,(len(p),3)).copy()
        self.parts[(self.node,mat)].append((p,normals,f,color,uv))
    def grid(self,rows,mat,col=1.,reverse=False,uv=None):
        a=np.array(rows)
        h,w=a.shape[:2]
        faces=[[i*w+j, i*w+j+1,(i+1)*w+j+1,(i+1)*w+j] for i in range(h-1) for j in range(w-1)]
        self.mesh(a.reshape((-1,3)),faces,mat,col,reverse,uv)
    def lathe(self,rings,mat,n=64,shade=1.):
        # Profile in bottom-to-top order. Include return faces in the profile.
        self.grid([[polar(TAU*j/n,r,z) for j in range(n+1)] for z,r in rings],mat,shade)

    def sector(self,a,b,profile_points,mat,shade=1.,seed=0):
        # Bevel every radial bed joint, including the vertical seam at each end.
        rng=np.random.default_rng(seed)
        prof=np.array(profile_points,dtype=float)
        zlo,zhi=prof[:,0].min(),prof[:,0].max()
        rmid=np.median(prof[:,1])
        span=b-a
        chip=rng.uniform(.15,.85)
        us=sorted(set([0,.018,.05,.23,.49,.76,.95,.982,1.,chip-.049,chip-.019,chip+.012,chip+.058]))
        chip_depth=rng.uniform(.018,.047)
        wav=rng.uniform(0,6.28,4)
        radial_variation=rng.uniform(-.011,.011)
        rows=[]; colors=[]
        for z,r in prof:
            row=[]
            for u in us:
                v=(z-zlo)/max(.001,zhi-zlo)
                th=a+span*u
                wiggle=.011*math.sin(4*u+wav[0])+.006*math.sin(11*u+wav[1])
                arch=.013*math.sin(math.pi*(u+.13))+.008*math.sin(u*10+wav[2])
                end=max(0,1-min(u,1-u)/.052)
                damage=max(0,1-abs(u-chip)/(.05 if u<chip else .059))**.78
                rr=r+wiggle+radial_variation-end*.013*np.sign(r-rmid)
                if r>rmid:
                    rr-=chip_depth*damage*np.clip((v-.68)*3.9,0,1)
                zz=z+arch*(.4+.6*v)-damage*chip_depth*.52*np.clip((v-.78)*5,0,1)*(r>=rmid)
                if zlo>0: zz+=.005*np.sin(3*u+wav[0])
                zz+=end*(.012 if v<.4 else -.012)
                th+=.018*(v-.5)*math.sin(wav[0]) + .007*(v-.5)**2*math.cos(wav[3])
                row.append(polar(th,rr,max(0,zz) if zlo<=0 else zz))
                edge= .89+.12*max(v,.12)+.07*(.6< v <.98)-end*.03
                colors.append([shade*edge]*3)
            rows.append(row)
        self.grid(rows,mat,np.array(colors))
        # Hairline fractures start at selected chipped edges and branch across the face.
        # Sample the actual voussoir so the painted split follows its bent, bevelled skin.
        profile_rows=np.asarray(rows)
        def attached(u,t):
            j=min(len(us)-2,max(0,np.searchsorted(us,u)-1))
            w=(u-us[j])/(us[j+1]-us[j])
            k=int(np.clip(np.floor(t),0,len(prof)-2));v=t-k
            a0=profile_rows[k,j]*(1-w)+profile_rows[k,j+1]*w
            a1=profile_rows[k+1,j]*(1-w)+profile_rows[k+1,j+1]*w
            pp=a0*(1-v)+a1*v
            direction=np.array([pp[0],pp[1],.48 if t>=4.8 else .1])
            return pp+.0015*direction/np.linalg.norm(direction)
        if seed%4!=0:
            root=chip+rng.uniform(-.013,.013);flip=rng.choice([-1,1])
            for branch in [0,1]:
                if branch==1 and seed%3!=0:continue
                controls=([(root,5.95,.002),(root+.013*flip,5.15,.0052),
                    (root+.051*flip,4.56,.0044),(root+.046*flip,4.1,.0037),(root+.106*flip,3.77,.0032),
                    (root+.126*flip,3.47,.001)] if not branch else
                    [(root+.047*flip,4.15,.0033),(root+.011*flip,3.98,.0028),(root-.014*flip,3.77,.001)])
                for off,brightness in [(1.15,1.0),(0,.42)]:
                    crack=[]
                    for u,t,w in controls:
                        crack.append([attached(u+(off+e)*w,t) for e in [-1,1]])
                    self.grid(crack,mat,brightness,True)
        # Closed end grain.
        for j in (0,-1):
            rim=[r[j] for r in rows[:-1]]
            self.mesh(rim,[list(range(len(rim)))],mat,shade*.79,reverse=(j==0))
    def leaf(self, frame, points, mat, n=28, width_unit=1., height=.02, color=1.):
        # Relief on a curved parent. Control points specify u, v, half-width.
        pigment=np.broadcast_to(color,(3,))
        path=track(points,n); uv=path[:,:2]
        d=np.gradient(uv,axis=0)*[width_unit,1.]
        d/=np.maximum(.0001,np.linalg.norm(d,axis=1)[:,None])
        side=np.column_stack([d[:,1]/width_unit,-d[:,0]])
        rows=[];colors=[]
        for i,((u,v,w),axis) in enumerate(zip(path,side)):
            row=[]
            for t,h,sh in [(-1,0,.72),(-.83,.42,.95),(-.21,1,1.05),(.29,.83,.99),(.88,.29,.85),(1,0,.74)]:
                q=uv[i]+axis*max(.0001,w)*t
                row.append(frame(*q,height*h*min(1,max(w,.0001)/.025)))
                colors.append(pigment*sh)
            rows.append(row)
        # side goes right for an ascending stroke, hence normal points out.
        self.grid(rows,mat,np.array(colors))

    def save(self,path):
        g={'asset':{'version':'2.0','generator':'Moon Court sculpture tools'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],
           'materials':[],'bufferViews':[],'buffers':[{}],'accessors':[],'images':[],'textures':[],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}]}
        binbuf=bytearray()
        def buffer(data,target=None):
            while len(binbuf)%4:binbuf.append(0)
            v={'buffer':0,'byteOffset':len(binbuf),'byteLength':len(data)}
            if target:v['target']=target
            binbuf.extend(data);g['bufferViews'].append(v)
            return len(g['bufferViews'])-1
        def acc(arr,kind,ctype,target,normalized=False,bounds=False):
            d={'bufferView':buffer(arr.tobytes(),target),'componentType':ctype,'count':len(arr),'type':kind}
            if normalized:d['normalized']=True
            if bounds:d.update(min=arr.min(0).tolist(),max=arr.max(0).tolist())
            g['accessors'].append(d);return len(g['accessors'])-1
        for name,(metal,rough) in self.mat.items():
            pbr={'metallicFactor':metal,'roughnessFactor':rough}
            if name in ('Stone','Verdigris','Brass'):
                idx=len(g['textures'])
                g['images'].append({'name':name+' brushwork','mimeType':'image/jpeg','bufferView':buffer(painted(name))})
                g['textures'].append({'source':idx,'sampler':0});pbr['baseColorTexture']={'index':idx}
            if name=='Stone':
                relief=len(g['textures'])
                g['images'].append({'name':'Chisel and spall','mimeType':'image/jpeg','bufferView':buffer(hewn_normal())})
                g['textures'].append({'source':relief,'sampler':0})
            if name=='Chased copper':
                copper,engraving=painted_panels(painted('Verdigris'))
                idx=len(g['textures'])
                for label,image_data in [('Chased panels',copper),('Engraved relief',engraving)]:
                    g['images'].append({'name':label,'mimeType':'image/jpeg','bufferView':buffer(image_data)})
                    g['textures'].append({'source':len(g['textures']),'sampler':0})
                pbr['baseColorTexture']={'index':idx}
            if name=='Heart of tide':
                idx=len(g['textures'])
                g['images'].append({'name':'Cut crystal caustics','mimeType':'image/png','bufferView':buffer(crystal_paint())})
                g['textures'].append({'source':idx,'sampler':0});pbr['baseColorTexture']={'index':idx}
                pbr['baseColorFactor']=[.30,.86,.83,1]
            if name=='Deep bronze':pbr['baseColorFactor']=[.076,.110,.082,1.]
            mat={'name':name,'pbrMetallicRoughness':pbr}
            if name=='Stone':mat['normalTexture']={'index':relief,'scale':.78}
            if name=='Chased copper':mat['normalTexture']={'index':idx+1,'scale':.75}
            if name=='Heart of tide':mat['emissiveTexture']={'index':idx}
            if name in self.emissions:mat['emissiveFactor']=self.emissions[name]
            g['materials'].append(mat)
        nodes={}
        for (node,mat),parts in self.parts.items():
            if node not in nodes:
                idx=len(g['nodes']);nodes[node]=idx
                entry={'name':node,'mesh':idx}
                if node=='crystal':entry['translation']=[0,6.17,0]
                g['nodes'].append(entry);g['scenes'][0]['nodes'].append(idx)
                g['meshes'].append({'name':node,'primitives':[]})
            pos=[];nor=[];col=[];uv=[];ind=[];offset=0
            for p,n,f,c,local_uv in parts:
                # Box-projected brushwork. Split only at actual projection boundaries.
                fn=np.abs(np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]]))
                axes=np.argmax(fn,axis=1) if mat in ('Stone','Verdigris','Brass') else np.zeros(len(f),int)
                for ax in np.unique(axes):
                    ids,inv=np.unique(f[axes==ax].ravel(),return_inverse=True)
                    v=p[ids]; normal=n[ids]
                    gc=np.column_stack([v[:,0],v[:,2],-v[:,1]])
                    if node=='crystal':gc[:,1]-=6.17
                    pos.append(gc);nor.append(np.column_stack([normal[:,0],normal[:,2],-normal[:,1]]))
                    col.append(np.clip(c[ids],0,1))
                    if mat in ('Stone','Verdigris','Brass'):
                        dim=[(1,2),(0,2),(0,1)][ax]
                        uv.append(v[:,dim]*(.83 if mat=='Stone' else .99))
                    if local_uv is not None:uv.append(local_uv[ids])
                    ind.append(inv+offset);offset+=len(ids)
            p=np.concatenate(pos).astype('<f4');n=np.concatenate(nor).astype('<f4');c=np.rint(np.concatenate(col)*255).astype('u1')
            # VEC3 byte colors require a four-byte stride. Use RGBA.
            c=np.column_stack((c,np.full(len(c),255,'u1')))
            index=np.concatenate(ind).astype('<u2' if offset<=65535 else '<u4')
            at={'POSITION':acc(p,'VEC3',5126,34962,bounds=True),'NORMAL':acc(n,'VEC3',5126,34962),'COLOR_0':acc(c,'VEC4',5121,34962,True)}
            if uv:at['TEXCOORD_0']=acc(np.concatenate(uv).astype('<f4'),'VEC2',5126,34962)
            primitive={'attributes':at,'indices':acc(index,'SCALAR',5123 if index.itemsize==2 else 5125,34963),'material':list(self.mat).index(mat)}
            g['meshes'][nodes[node]]['primitives'].append(primitive)
        while len(binbuf)%4:binbuf.append(0)
        g['buffers'][0]['byteLength']=len(binbuf)
        header=json.dumps(g,separators=(',',':')).encode()
        header+=b' '*((-len(header))%4)
        path.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(header)+len(binbuf))+struct.pack('<I4s',len(header),b'JSON')+header+struct.pack('<I4s',len(binbuf),b'BIN\0')+binbuf)
        print(path, path.stat().st_size,'bytes',sum(len(f) for group in self.parts.values() for _,_,f,_,_ in group),'triangles',flush=True)
