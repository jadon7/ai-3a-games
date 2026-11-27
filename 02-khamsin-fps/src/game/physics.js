// 静态世界碰撞：BVH 射线检测 + 胶囊体去穿透
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { SURF_NAMES } from '../world/builder.js';

const _ray = new THREE.Ray();
const _seg = new THREE.Line3();
const _box = new THREE.Box3();
const _tp = new THREE.Vector3(), _cp = new THREE.Vector3(), _d = new THREE.Vector3();

export class World {
  constructor(colGeo, clipGeo, mechGeo = null) {
    this.geo = colGeo;
    this.mechBvh = mechGeo ? new MeshBVH(mechGeo) : null;
    this.bvh = new MeshBVH(colGeo);
    this.clip = clipGeo ? new MeshBVH(clipGeo) : null;
    this.surfAttr = colGeo.attributes.surf;
    this.hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surf: 'stone' };
    this.res = { ground: false, groundNormal: new THREE.Vector3(0, 1, 0), wall: false, wallNormal: new THREE.Vector3(), ceil: false, any: false };
    this.dyn = null;   // 动态碰撞体（机关门等）
  }

  // 多空间（两界切换）：同一个 World 对象切到另一套碰撞数据。所有持有这个对象引用的代码不用改
  use(sub) { this.geo = sub.geo; this.mechBvh = sub.mechBvh; this.bvh = sub.bvh; this.clip = sub.clip; this.surfAttr = sub.surfAttr; this.dyn = sub.dyn; return this; }
  // 动态碰撞体：一个轴对齐的盒子，on 为 false 时不参与任何检测
  addDyn(x0, y0, z0, x1, y1, z1, surf = 'metal') {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const d = { bvh: new MeshBVH(g), on: true, surf }; (this.dyn || (this.dyn = [])).push(d); return d;
  }

  // 射线检测。返回共享的 this.hit（下次调用会被覆盖）或 null
  raycast(origin, dir, maxDist = 1000, withClip = false) {
    _ray.origin.copy(origin); _ray.direction.copy(dir);
    let h = this.bvh.raycastFirst(_ray, THREE.FrontSide, 0, maxDist);
    let dynSurf = null;
    if (this.dyn) for (const d of this.dyn) { if (!d.on) continue; const h2 = d.bvh.raycastFirst(_ray, THREE.FrontSide, 0, h ? h.distance : maxDist); if (h2) { h = h2; dynSurf = d.surf; } }
    let clipHit = null;
    if (withClip && this.clip) { clipHit = this.clip.raycastFirst(_ray, THREE.FrontSide, 0, h ? h.distance : maxDist); }
    if (clipHit) { this.hit.point.copy(clipHit.point); this.hit.normal.copy(clipHit.face.normal); this.hit.distance = clipHit.distance; this.hit.surf = 'clip'; return this.hit; }
    if (!h) return null;
    this.hit.point.copy(h.point); this.hit.normal.copy(h.face.normal); this.hit.distance = h.distance;
    this.hit.surf = dynSurf || SURF_NAMES[this.surfAttr.getX(this.geo.index.getX(h.faceIndex * 3))] || 'stone';
    return this.hit;
  }

  // 是否有遮挡（视线检测）
  blocked(a, b) {
    _d.subVectors(b, a); const len = _d.length(); if (len < 1e-4) return false;
    _ray.origin.copy(a); _ray.direction.copy(_d).multiplyScalar(1 / len);
    if (this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, len) !== null) return true;
    if (this.dyn) for (const d of this.dyn) if (d.on && d.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, len) !== null) return true;
    return false;
  }

  // 胶囊体去穿透：p0/p1 为两个球心（就地修改）。返回 this.res
  collideCapsule(p0, p1, radius, useClip = true, forMech = false) {
    const res = this.res;
    res.ground = false; res.wall = false; res.ceil = false; res.any = false;
    let bestG = 0.0, bestW = 0;
    _seg.start.copy(p0); _seg.end.copy(p1);
    _box.makeEmpty(); _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end);
    _box.min.addScalar(-radius - 0.01); _box.max.addScalar(radius + 0.01);
    const cb = {
      intersectsBounds: (b) => b.intersectsBox(_box),
      intersectsTriangle: (tri) => {
        const dist = tri.closestPointToSegment(_seg, _tp, _cp);
        if (dist < radius) {
          _d.subVectors(_cp, _tp);
          const l = _d.length();
          if (l < 1e-6) return false;
          _d.multiplyScalar(1 / l);
          const depth = radius - dist;
          _seg.start.addScaledVector(_d, depth); _seg.end.addScaledVector(_d, depth);
          res.any = true;
          if (_d.y > 0.64) { if (_d.y > bestG) { bestG = _d.y; res.groundNormal.copy(_d); } res.ground = true; }
          else if (_d.y < -0.5) res.ceil = true;
          else if (Math.abs(_d.y) < 0.35) { if (depth > bestW) { bestW = depth; res.wallNormal.copy(_d); } res.wall = true; }
        }
        return false;
      },
    };
    if (forMech && this.mechBvh) this.mechBvh.shapecast(cb);
    else { this.bvh.shapecast(cb); if (useClip && this.clip) this.clip.shapecast(cb); }
    if (this.dyn) for (const d of this.dyn) if (d.on) d.bvh.shapecast(cb);
    p0.copy(_seg.start); p1.copy(_seg.end);
    return res;
  }

  // 球体是否与世界相交（用于检查站立空间等）
  sphereHits(center, radius) {
    let hit = false;
    _box.min.copy(center).addScalar(-radius); _box.max.copy(center).addScalar(radius);
    const cb = {
      intersectsBounds: (b) => b.intersectsBox(_box),
      intersectsTriangle: (tri) => { tri.closestPointToPoint(center, _tp); if (_tp.distanceToSquared(center) < radius * radius) { hit = true; return true; } return false; },
    };
    this.bvh.shapecast(cb);
    if (!hit && this.dyn) for (const d of this.dyn) { if (d.on) d.bvh.shapecast(cb); if (hit) break; }
    return hit;
  }
}
