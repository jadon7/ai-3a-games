"""Surface construction and binary glTF output. All coordinates are Y-up, in metres."""
from collections import defaultdict
import json
import math
import struct

import numpy as np
from scipy.interpolate import PchipInterpolator


def polar(angle, radius, y, tangent=0):
    s, c = math.sin(angle), math.cos(angle)
    return [radius*s + tangent*c, y, radius*c - tangent*s]


def interpolate(keys, steps=3):
    keys = np.array(keys, float)
    t = np.arange(len(keys))
    return PchipInterpolator(t, keys, axis=0)(np.linspace(0, t[-1], t[-1]*steps+1))


class Mesh:
    def __init__(self):
        self.parts = defaultdict(list)
        self.pivot = {}

    def surface(self, points, faces, materials, greys, node="shell"):
        p, f = np.asarray(points).reshape(-1,3), np.asarray(faces,dtype=int)
        mat = np.broadcast_to(materials, (len(f),))
        g = np.broadcast_to(greys, (len(p),))
        fn = np.cross(p[f[:,1]]-p[f[:,0]], p[f[:,2]]-p[f[:,0]])
        length = np.linalg.norm(fn, axis=1)
        keep = length > 1.e-10
        f, mat, fn = f[keep], mat[keep], fn[keep]/length[keep,None]
        normals = np.zeros_like(p, dtype=float)
        for k in range(3):
            a, b = (p[f[:,(k+j)%3]]-p[f[:,k]] for j in [1,2])
            angle = np.arctan2(np.linalg.norm(np.cross(a,b), axis=1), (a*b).sum(axis=1))
            np.add.at(normals, f[:,k], fn*angle[:,None])
        normals /= np.maximum(1.e-12, np.linalg.norm(normals,axis=1,keepdims=True))
        for name in dict.fromkeys(mat):
            used, local = np.unique(f[mat==name],return_inverse=True)
            self.parts[node,str(name)].append((p[used],normals[used],g[used],local.ravel()))

    def loft(self, rows, materials, greys=1., caps=True, flip=False, node='shell'):
        # Counterclockwise courses viewed from above, with shared normals across material edges.
        rows = np.asarray(rows)
        h,w = rows.shape[:2]
        p = list(rows.reshape(-1,3))
        g = list(np.broadcast_to(greys,(h,w)).ravel())
        f, mats = [], []
        skin = np.broadcast_to(materials,(h-1,w))
        for j in range(h-1):
            for i in range(w):
                a,b = j*w+i, j*w+(i+1)%w
                f.extend([(a,b,b+w),(a,b+w,a+w)])
                mats.extend([skin[j,i]]*2)
        if caps:
            for j in [0,h-1]:
                center = len(p)
                p.append(np.mean(rows[j],axis=0))
                g.append(float(np.mean(g[j*w:j*w+w])))
                for i in range(w):
                    a,b = j*w+i, j*w+(i+1)%w
                    f.append((center,b,a) if j==0 else (center,a,b))
                    mats.append(skin[min(j,h-2),i])
        self.surface(p, np.array(f)[:,::-1] if flip else f, mats, g, node)

    def save(self, file):
        names = list(dict.fromkeys(mat for _,mat in self.parts))
        doc = dict(asset=dict(version='2.0',generator='Ember and Tide / Moon Court'),scene=0,
                   scenes=[{'nodes':[]}],nodes=[],meshes=[],materials=[dict(name=n) for n in names],
                   buffers=[],bufferViews=[],accessors=[])
        blob = bytearray()
        def accessor(data, component, kind, target, bounds=False, normalized=False):
            blob.extend(bytes((-len(blob))%4))
            raw=data.tobytes()
            doc['bufferViews'].append(dict(buffer=0,byteOffset=len(blob),byteLength=len(raw),target=target))
            blob.extend(raw)
            a=dict(bufferView=len(doc['bufferViews'])-1,componentType=component,type=kind,count=len(data))
            if bounds:
                a.update(min=data.min(0).tolist(),max=data.max(0).tolist())
            if normalized:
                a['normalized']=True
            doc['accessors'].append(a)
            return len(doc['accessors'])-1
        tris=0
        for (node,mat),parts in self.parts.items():
            p,n,g,ix=zip(*parts)
            pivot=self.pivot.get('crystal' if node=='polish' else node)
            pos=(np.concatenate(p)-(pivot if pivot else 0)).astype('<f4')
            norm=np.concatenate(n).astype('<f4')
            colors=np.repeat(np.rint(np.concatenate(g)*255).astype('u1')[:,None],4,axis=1)
            colors[:,3]=255
            indices=np.concatenate([a+off for a,off in zip(ix,np.cumsum([0]+[len(x) for x in p[:-1]]))])
            wide=len(pos)>65535
            attrs=dict(POSITION=accessor(pos,5126,'VEC3',34962,True),NORMAL=accessor(norm,5126,'VEC3',34962),
                       COLOR_0=accessor(colors,5121,'VEC4',34962,normalized=True))
            prim=dict(attributes=attrs,indices=accessor(indices.astype('<u4' if wide else '<u2'),5125 if wide else 5123,'SCALAR',34963),material=names.index(mat))
            name=node if pivot else node+'_'+mat
            obj=dict(name=name,mesh=len(doc['meshes']))
            if pivot and node!='polish':
                obj['translation']=list(pivot)
            doc['meshes'].append(dict(name=name,primitives=[prim]))
            doc['scenes'][0]['nodes'].append(len(doc['nodes']))
            doc['nodes'].append(obj)
            tris+=len(indices)//3
        objects={o['name']:i for i,o in enumerate(doc['nodes'])}
        if 'polish' in objects:
            child=objects['polish']
            doc['nodes'][objects['crystal']]['children']=[child]
            doc['scenes'][0]['nodes'].remove(child)
        blob.extend(bytes((-len(blob))%4))
        doc['buffers']=[dict(byteLength=len(blob))]
        js=json.dumps(doc,separators=(',',':')).encode()
        js+=b' '*((-len(js))%4)
        file.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(js)+len(blob))+struct.pack('<I4s',len(js),b'JSON')+js+
                         struct.pack('<I4s',len(blob),b'BIN\0')+blob)
        return tris
