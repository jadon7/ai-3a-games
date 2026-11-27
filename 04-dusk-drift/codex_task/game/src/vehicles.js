import * as T from 'three';
import {seeded} from './circuit.js';

function contactTexture(){
  const c=document.createElement('canvas');c.width=192;c.height=320;
  const ctx=c.getContext('2d');
  ctx.scale(192,320);
  const grad=ctx.createRadialGradient(.5,.5,.12,.5,.5,.5);
  grad.addColorStop(0,'rgba(0,0,0,.95)');grad.addColorStop(.62,'rgba(0,0,0,.85)');grad.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=grad;ctx.fillRect(0,0,1,1);
  return new T.CanvasTexture(c);
}
function enamel(base,blue) {
  const m=base.clone();
  if(blue){m.map=blue.top;m.emissiveMap=blue.side;m.emissiveMap.channel=1;}
  m.emissive.setRGB(0,0,0);
  m.emissiveMap.wrapS=m.emissiveMap.wrapT=T.ClampToEdgeWrapping;
  m.side=T.FrontSide;
  m.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      #include <map_fragment>
      vec4 door=texture2D(emissiveMap,vEmissiveMapUv);
      diffuseColor.rgb=mix(diffuseColor.rgb,door.rgb,door.a);
      float claret=smoothstep(.015,.18,diffuseColor.r-diffuseColor.g);
      diffuseColor.rgb*=mix(vec3(1.),vec3(.54,.49,.91),claret);
    `).replace('#include <emissivemap_fragment>','');
  };
  return m;
}
function glazing(){
  const m=new T.MeshPhysicalMaterial({color:0x273737,metalness:.26,roughness:.06,transparent:true,opacity:.25,depthWrite:false,side:T.FrontSide,envMapIntensity:1.05});
  m.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      float angleF=pow(1.-abs(dot(normalize(vViewPosition),normal)),3.);
      diffuseColor.a=.29+.57*angleF;
      #include <opaque_fragment>
    `);
  };
  return m;
}

export class Cars {
  constructor(scene,gt,lancia,blue){
    this.models=[];this.contacts=[];
    const tex=contactTexture(),glass=glazing(),processed=new Set();
    const source47=gt.clone(true),source62=gt.clone(true),occluded=new Set();
    for(const [i,root] of [source47,lancia,source62].entries()){
      const hubs=[];
      let body,rearLamp;
      root.traverse(o=>{
        if(o.name.includes('sprung'))body=o;
        if(o.name.includes('Hub_'))hubs.push({node:o,front:o.name.includes('Front'),spin:o.children[0]});
        if(!o.isMesh)return;
        let m=o.material;
        if(m.name==='Enamel | 47'){m=enamel(m,i===2?blue:null);o.material=m;}
        else if(m.name==='Meshpart12Mtl'){
          rearLamp=m.clone();rearLamp.color.set(0x9e1f13);rearLamp.emissive.set(0xb91909);
          rearLamp.emissiveIntensity=.20;rearLamp.opacity=.86;rearLamp.depthWrite=false;
          o.material=m=rearLamp;
        }
        else if(m.name.includes('glazing')){m=glass;o.material=m;}
        else if(!processed.has(m)){
          processed.add(m);
          if(m.name==='Wheel1Mtl')m.color.multiplyScalar(.63);
          if(m.name==='037 | warm ochre enamel')m.color.multiply(new T.Color(.80,.66,.54));
          if(m.transparent&&m.opacity>=.9 && !m.name.includes('Tungsten')){
            m.transparent=false;m.alphaTest=.28;m.depthWrite=true;
          }
          if(m.name.includes('Tungsten')){m.emissive.set(0xffc181);m.emissiveIntensity=2.15;}
          if(m.transparent){m.depthWrite=false;m.side=T.FrontSide;}
        }
        if(o.geometry.attributes._occlusion&&!occluded.has(m)){
          occluded.add(m);
          const configure=m.onBeforeCompile,cacheKey=m.customProgramCacheKey();
          m.customProgramCacheKey=()=>cacheKey+'-baked-ao';
          m.onBeforeCompile=(shader,renderer)=>{
            configure.call(m,shader,renderer);
            shader.vertexShader='attribute float _occlusion; varying float vBodyAO;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vBodyAO=_occlusion;');
            shader.fragmentShader='varying float vBodyAO;\n'+shader.fragmentShader.replace('#include <aomap_fragment>', `
              #include <aomap_fragment>
              reflectedLight.indirectDiffuse*=mix(.08,1.,vBodyAO);
              reflectedLight.indirectSpecular*=mix(.12,1.,vBodyAO*vBodyAO);
              reflectedLight.directDiffuse*=mix(.76,1.,vBodyAO);
            `);
          };
        }
        o.castShadow=!m.transparent;o.receiveShadow=true;
      });
      const anchor=new T.Group();anchor.add(root);scene.add(anchor);
      const shadow=new T.Mesh(new T.PlaneGeometry(2.83,5.35).rotateX(-Math.PI/2),new T.MeshBasicMaterial({map:tex,color:0x191813,transparent:true,opacity:.65,depthWrite:false}));
      shadow.renderOrder=1;scene.add(shadow);
      this.contacts.push(shadow);this.models.push({anchor,body,hubs,shadow,rearLamp});
    }
  }
  update(states){
    this.models.forEach(({anchor,body,hubs,shadow,rearLamp},i)=>{
      const c=states[i];anchor.position.set(c.x,.012,c.z);anchor.rotation.y=c.yaw;
      if(rearLamp)rearLamp.emissiveIntensity=c.braking?1.85:.20;
      if(body){body.rotation.z=c.roll||0;body.rotation.x=c.pitch||0;}
      for(const h of hubs){h.node.rotation.y=h.front?(i===0&&Math.abs(c.slip)>.16?-c.slip*.62:c.steer*.31):0;if(h.spin)h.spin.rotation.x=c.spin;}
      shadow.position.set(c.x,.025,c.z);shadow.rotation.y=c.yaw;
    });
  }
}

export class TyreEffects{
  constructor(scene){
    this.rnd=seeded(18336);this.last=[null,null];this.cursor=0;this.time=0;this.max=1450;this.acc=[0,0,0];
    const g=new T.BufferGeometry(),n=this.max*6;
    this.xyz=new Float32Array(n*3);this.birth=new Float32Array(n).fill(-100);
    const pos=new T.BufferAttribute(this.xyz,3).setUsage(T.DynamicDrawUsage),age=new T.BufferAttribute(this.birth,1).setUsage(T.DynamicDrawUsage);
    g.setAttribute('position',pos);g.setAttribute('born',age);
    this.rubber=new T.Mesh(g,new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,uniforms:{clock:{value:0}},
      vertexShader:'attribute float born; varying float age; uniform float clock; void main(){age=clock-born;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying float age;void main(){gl_FragColor=vec4(.027,.025,.022,.34*(1.-smoothstep(12.,28.,age)));
      #include <colorspace_fragment>
      }`}));
    this.rubber.frustumCulled=false;this.rubber.renderOrder=2;scene.add(this.rubber);
    this.capacity=300;this.slot=0;this.puffs=Array.from({length:this.capacity},()=>({life:0}));
    this.pxyz=new Float32Array(this.capacity*3);this.sizes=new Float32Array(this.capacity);this.alphas=new Float32Array(this.capacity);this.seeds=new Float32Array(this.capacity);
    const pg=new T.BufferGeometry();
    for(const [name,a,n] of [['position',this.pxyz,3],['diameter',this.sizes,1],['opacity',this.alphas,1],['seed',this.seeds,1]])pg.setAttribute(name,new T.BufferAttribute(a,n).setUsage(T.DynamicDrawUsage));
    this.spray=new T.Points(pg,new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{screenHeight:{value:720}},
      vertexShader:`attribute float diameter,opacity,seed;uniform float screenHeight;varying float alpha,offset;
      void main(){vec4 v=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp(diameter*screenHeight*projectionMatrix[1][1]/max(.2,-2.*v.z),0.,175.);alpha=opacity;offset=seed;}`,
      fragmentShader:`varying float alpha,offset;
      void main(){vec2 q=gl_PointCoord*2.-1.;float r=dot(q,q);if(r>1.||alpha<.001)discard;
      float cloud=.68+.19*sin(q.x*9.+sin(q.y*6.+offset)+offset)+.13*sin(q.y*13.+q.x*7.+offset);
      gl_FragColor=vec4(.62,.61,.56,alpha*pow(1.-r,2.)*cloud);
      #include <colorspace_fragment>
      }`}));
    this.spray.frustumCulled=false;this.spray.renderOrder=4;scene.add(this.spray);
  }
  clear(){
    this.birth.fill(-100);this.rubber.geometry.attributes.born.needsUpdate=true;
    this.last=[null,null];this.puffs.forEach(p=>p.life=0);this.alphas.fill(0);this.spray.geometry.attributes.opacity.needsUpdate=true;
  }
  contact(c,side){
    const co=Math.cos(c.yaw),si=Math.sin(c.yaw);
    return [c.x+side*.71*co+1.36*si,c.z-side*.71*si+1.36*co];
  }
  tick(dt,states,drifting){
    this.time+=dt;
    this.rubber.material.uniforms.clock.value=this.time;
    const car=states[0];
    for(let i=0;i<2;i++){
      if(!drifting){this.last[i]=null;continue;}
      const [x,z]=this.contact(car,2*i-1),w=.103,co=Math.cos(car.yaw)*w,si=-Math.sin(car.yaw)*w;
      const pair=[[x-co,.021,z-si],[x+co,.021,z+si]],last=this.last[i];
      if(last && Math.hypot(pair[0][0]-last[0][0],pair[0][2]-last[0][2])<.23)continue;
      this.last[i]=pair;
      if(!last)continue;
      const verts=[last[0],last[1],pair[0],last[1],pair[1],pair[0]],start=this.cursor*6;
      for(let j=0;j<6;j++){this.xyz.set(verts[j],(start+j)*3);this.birth[start+j]=this.time;}
      this.cursor=(this.cursor+1)%this.max;
      this.rubber.geometry.attributes.position.needsUpdate=this.rubber.geometry.attributes.born.needsUpdate=true;
    }
    states.forEach((c,id)=>{
      if(c.speed<9)return;
      const heavy=id===0&&drifting;this.acc[id]+=dt*(heavy?54:Math.min(15,c.speed*.38));
      while(this.acc[id]>=1){this.acc[id]--;
        const side=this.rnd()>.5?1:-1,[x,z]=this.contact(c,side),p=this.puffs[this.slot];
        const r=this.rnd(),life=.53+r*.42,co=Math.cos(c.yaw),si=Math.sin(c.yaw);
        Object.assign(p,{x,y:.10+this.rnd()*.1,z,vx:-si*c.speed*.24+side*co*(.35+r),vz:-co*c.speed*.24-side*si*(.35+r),vy:.12+r*(heavy?.55:.24),life,max:life,start:.14+.17*r,size:(heavy?1.15:.65)+.5*r,opacity:heavy?.32:.17});
        this.seeds[this.slot]=r*30;this.slot=(this.slot+1)%this.capacity;
      }
    });
    this.puffs.forEach((p,i)=>{
      p.life-=dt;
      if(p.life<=0){this.alphas[i]=0;return;}
      const t=1-p.life/p.max;p.x+=p.vx*dt;p.z+=p.vz*dt;p.y+=p.vy*dt;
      this.pxyz.set([p.x,p.y,p.z],i*3);this.sizes[i]=p.start+p.size*t;this.alphas[i]=p.opacity*(1-t)**1.3;
    });
    for(const a of Object.values(this.spray.geometry.attributes))a.needsUpdate=true;
  }
}
