import * as T from 'three';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const wrap = (v, max) => ((v % max) + max) % max;
export const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);
export function seeded(seed) {
  return () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
}

export class Circuit {
  constructor(source) {
    const original = source.map(([x,z]) => new T.Vector3(x,0,z));
    const last = original.length - 1;
    const extension = [[-271,-82],[-303,-76],[-328,-52],[-341,-13],[-362,14],[-399,38],[-419,70],[-419,105],[-401,138],[-365,155],[-330,155],[-301,144],[-269,126],[-239,124],[-211,141],[-179,163],[-146,173],[-115,170],[-89,161.6]];
    const knots = [original[last-10],original[last],...extension.map(([x,z]) => new T.Vector3(x,0,z)),original[0],original[10]];
    const back = new T.CatmullRomCurve3(knots);
    const closed = [...original];
    for(let i=1;i<500;i++) closed.push(back.getPoint((1+(knots.length-3)*i/500)/(knots.length-1)));
    closed.push(original[0]);
    const sums=[0];
    for(let i=1;i<closed.length;i++) sums.push(sums[i-1]+closed[i].distanceTo(closed[i-1]));
    this.length=sums.at(-1);
    this.filmLength=sums[last];
    this.startStation=sums[94];
    const count=Math.round(this.length/1.35);
    this.step=this.length/count;
    this.points=[];
    let cursor=0;
    for(let n=0;n<count;n++) {
      const d=wrap(n*this.step+this.startStation,this.length);
      if(d<sums[cursor]) cursor=0;
      while(sums[cursor+1]<d) cursor++;
      const pt=closed[cursor].clone().lerp(closed[cursor+1],(d-sums[cursor])/(sums[cursor+1]-sums[cursor]));
      this.points.push({x:pt.x,z:pt.z});
    }
    this.segments=this.points.map((p,i)=>{
      const q=this.points[(i+1)%count],dx=q.x-p.x,dz=q.z-p.z;
      const len=Math.hypot(dx,dz);
      return {...p,dx,dz,tx:dx/len,tz:dz/len,inv:1/(len*len)};
    });
    this.landSegments=[];
    for(let i=0;i<count;i+=7) {
      const p=this.points[i],q=this.points[i+7<count?i+7:0],dx=q.x-p.x,dz=q.z-p.z;
      this.landSegments.push({...p,dx,dz,inv:1/(dx*dx+dz*dz)});
    }
    const xs=this.points.map(p=>p.x),zs=this.points.map(p=>p.z);
    this.bounds={minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};
  }
  at(s,lateral=0) {
    const k=wrap(s,this.length)/this.step;
    const i=Math.floor(k)%this.segments.length,f=k-Math.floor(k);
    const p=this.segments[i],next=this.segments[(i+1)%this.segments.length];
    const tx=p.tx+(next.tx-p.tx)*f,tz=p.tz+(next.tz-p.tz)*f;
    return {x:p.x+p.dx*f-tz*lateral,z:p.z+p.dz*f+tx*lateral,tx,tz,yaw:Math.atan2(-tx,-tz)};
  }
  curvature(s,span=6) {
    return angleDelta(this.at(s+span).yaw,this.at(s-span).yaw)/(span*2);
  }
  nearest(x,z) {
    let d=Infinity,index=0,fraction=0;
    for(let i=0;i<this.segments.length;i++) {
      const p=this.segments[i],ex=x-p.x,ez=z-p.z;
      const t=clamp((ex*p.dx+ez*p.dz)*p.inv,0,1);
      const ds=(ex-t*p.dx)**2+(ez-t*p.dz)**2;
      if(ds<d) { d=ds; index=i; fraction=t; }
    }
    const p=this.segments[index];
    return {s:(index+fraction)*this.step,lateral:-(x-p.x)*p.tz+(z-p.z)*p.tx,distance:Math.sqrt(d)};
  }
  landDistance(x,z) {
    let d=Infinity;
    for(const p of this.landSegments) {
      const dx=x-p.x,dz=z-p.z,f=clamp((dx*p.dx+dz*p.dz)*p.inv,0,1);
      d=Math.min(d,(dx-p.dx*f)**2+(dz-p.dz*f)**2);
    }
    return Math.sqrt(d);
  }
  ground(x,z,d=this.landDistance(x,z)) {
    const rise=clamp((d-8.9)/33,0,1);
    const hills=3.5+2.7*Math.sin(x*.022+z*.017)+1.9*Math.cos(z*.036-x*.007)+1.1*Math.sin(x*.061-z*.035);
    return -.13+rise*rise*(3-2*rise)*(hills+.48*Math.sin(z*.37)*Math.cos(x*.29));
  }
  originalStation(s){return wrap(s+this.startStation,this.length);}
}
