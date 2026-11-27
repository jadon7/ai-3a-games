"""Y-up indexed surfaces and a texture-free binary glTF writer."""
import json
import math
import struct
from collections import defaultdict

import numpy as np
from scipy.interpolate import PchipInterpolator

TAU = math.tau
def polar(a, r, y):
    return (math.sin(a)*r, y, math.cos(a)*r)

def profile(keys):
    a = np.asarray(keys)
    interp = PchipInterpolator(a[:, 0], a[:, 1:], axis=0)
    def at(x):
        v = interp(min(max(x, a[0,0]), a[-1,0]))
        return v[0] if len(v) == 1 else v
    return at

def path(points, per_segment=4):
    p = np.asarray(points)
    d = np.r_[0, np.cumsum(np.sqrt(np.linalg.norm(np.diff(p[:,:2], axis=0), axis=1)))]
    return PchipInterpolator(d, p)(np.concatenate([np.linspace(a,b,per_segment,endpoint=False) for a,b in zip(d, d[1:])] + [[d[-1]]]))

class Model:
    def __init__(self):
        self.parts = defaultdict(list)
        self.node = 'architecture'
        self.pivots = {}

    def mesh(self, points, faces, mat, grey=1., flip=False):
        p = np.asarray(points, dtype=float).reshape(-1,3)
        f = np.asarray(faces,dtype=np.int32).reshape(-1,3)
        if flip:
            f = f[:, ::-1]
        fn = np.cross(p[f[:,1]]-p[f[:,0]], p[f[:,2]]-p[f[:,0]])
        keep = np.linalg.norm(fn,axis=1)>1e-12
        f, fn = f[keep], fn[keep]
        if not len(f):
            return
        n = np.zeros_like(p)
        for i in range(3):
            np.add.at(n, f[:,i], fn)
        n /= np.maximum(1e-12, np.linalg.norm(n,axis=1,keepdims=True))
        c = np.broadcast_to(np.asarray(grey).reshape(-1), (len(p),))
        if not keep.all():
            used,ids=np.unique(f,return_inverse=True)
            p,n,c,f=p[used],n[used],c[used],ids.reshape(-1,3)
        self.parts[self.node, mat].append((p,n,c,f))

    def grid(self, rows, mat, grey=1., flip=False):
        a = np.asarray(rows)
        h,w = a.shape[:2]
        u = (np.arange(h-1)[:,None]*w + np.arange(w-1)).ravel()
        f = np.stack((u,u+1,u+w+1,u,u+w+1,u+w),axis=1).reshape(-1,3)
        self.mesh(a, f, mat, grey, flip)

    def turn(self, profile_rows, mat, n=48, grey=1., center=(0,0)):
        # Each interval has its own normals at the profile crease.
        for (y0,r0),(y1,r1) in zip(profile_rows,profile_rows[1:]):
            rows = [[(center[0]+r*math.sin(a),y,center[1]+r*math.cos(a))
                     for a in np.linspace(0,TAU,n+1)] for y,r in [(y0,r0),(y1,r1)]]
            self.grid(rows,mat,grey)

    def save(self, dest):
        mats = list(dict.fromkeys(m for _,m in self.parts))
        doc = dict(asset=dict(version='2.0',generator='Moon Court / architectural mesh'), scene=0,
                   scenes=[dict(nodes=[])],nodes=[],meshes=[],materials=[dict(name=m) for m in mats],
                   buffers=[],bufferViews=[],accessors=[])
        data = bytearray()
        def accessor(a, comp, fmt, target, bounds=False, normalized=False):
            while len(data)%4: data.append(0)
            b = a.tobytes()
            view = len(doc['bufferViews'])
            doc['bufferViews'].append(dict(buffer=0,byteOffset=len(data),byteLength=len(b),target=target))
            data.extend(b)
            acc = dict(bufferView=view,componentType=comp,count=len(a),type=fmt)
            if bounds:
                acc.update(min=a.min(0).tolist(),max=a.max(0).tolist())
            if normalized:
                acc['normalized']=True
            doc['accessors'].append(acc)
            return len(doc['accessors'])-1
        count=0
        moving={}
        for (node,mat),parts in self.parts.items():
            p,n,c,f = zip(*parts)
            pivot = self.pivots.get('crystal' if node=='facet_glints' else node)
            pos = np.concatenate(p) - (pivot if pivot is not None else 0)
            norm = np.concatenate(n)
            col = np.repeat(np.rint(np.clip(np.concatenate(c),0,1)*65535).astype('<u2')[:,None],4,axis=1)
            col[:,3] = 65535
            off=np.cumsum([0]+[len(x) for x in p[:-1]])
            ind=np.concatenate([x+i for x,i in zip(f,off)]).reshape(-1)
            attr=dict(POSITION=accessor(pos.astype('<f4'),5126,'VEC3',34962,True),
                      NORMAL=accessor(norm.astype('<f4'),5126,'VEC3',34962),
                      COLOR_0=accessor(col,5123,'VEC4',34962,normalized=True))
            wide = len(pos)>65535
            prim=dict(attributes=attr,indices=accessor(ind.astype('<u4' if wide else '<u2'),5125 if wide else 5123,'SCALAR',34963),
                      material=mats.index(mat))
            name = node if pivot is not None else node+'_'+mat
            doc['meshes'].append(dict(name=name,primitives=[prim]))
            obj=dict(name=name,mesh=len(doc['meshes'])-1)
            if pivot is not None:
                moving[node]=len(doc['nodes'])
                if node!='facet_glints':obj['translation']=list(pivot)
            doc['scenes'][0]['nodes'].append(len(doc['nodes']))
            doc['nodes'].append(obj)
            count+=len(ind)//3
        if 'facet_glints' in moving:
            child=moving['facet_glints']
            doc['nodes'][moving['crystal']]['children']=[child]
            doc['scenes'][0]['nodes'].remove(child)
        while len(data)%4:data.append(0)
        doc['buffers'].append(dict(byteLength=len(data)))
        js=json.dumps(doc,separators=(',',':')).encode()
        js+=b' '*((-len(js))%4)
        dest.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(js)+len(data))+
                         struct.pack('<I4s',len(js),b'JSON')+js+struct.pack('<I4s',len(data),b'BIN\0')+data)
        return count
