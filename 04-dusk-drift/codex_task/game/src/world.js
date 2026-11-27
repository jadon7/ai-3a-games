import * as T from 'three';
import {seeded} from './circuit.js';

const V3 = T.Vector3;
function ribbon(track,left,right,height,material,include=()=>true,colors=null) {
  const pos=[],uv=[],idx=[],col=[];
  const count=track.points.length;
  for(let i=0;i<count;i++) {
    const s=i*track.step;
    if(!include(s))continue;
    const base=pos.length/3;
    for(const d of [s,s+track.step]){
      for(const lat of [left,right]){
        const p=track.at(d,lat);
        pos.push(p.x,typeof height==='function'?height(lat,d):height,p.z);
        uv.push(lat,d);
        if(colors)col.push(...colors(s));
      }
    }
    idx.push(base,base+1,base+2,base+1,base+3,base+2);
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  if(colors)g.setAttribute('color',new T.Float32BufferAttribute(col,3));
  g.setIndex(idx);g.computeVertexNormals();g.computeBoundingSphere();
  const mesh=new T.Mesh(g,material);mesh.receiveShadow=true;
  return mesh;
}

function roadMaterial(tex,mirror) {
  const mat=new T.MeshStandardMaterial({map:tex.asphalt,normalMap:tex.normal,roughnessMap:tex.rough,roughness:.72,metalness:0,normalScale:new T.Vector2(.6,.6),envMapIntensity:.72});
  mat.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{wetMirror:{value:mirror.target.texture},reflectMatrix:{value:mirror.matrix},wearMap:{value:tex.wear}});
    shader.vertexShader='uniform mat4 reflectMatrix; varying vec4 vMirror; varying vec2 vTrack;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\n vTrack=uv; vMirror=reflectMatrix*modelMatrix*vec4(transformed,1.);');
    shader.fragmentShader=`
      uniform sampler2D wetMirror,wearMap;
      varying vec4 vMirror; varying vec2 vTrack;
      float h21(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
      float noise21(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+1.),f.x),f.y);}
    `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      #include <map_fragment>
      vec2 waterUV=vec2(vTrack.x*.55+vTrack.y*.065,vTrack.y*.24);
      float basin=.58*noise21(waterUV)+.27*noise21(waterUV*2.13+7.)+.15*noise21(waterUV*5.2);
      vec3 tracks=texture2D(wearMap,vec2(vTrack.x/13.9+.5,fract(vTrack.y/280.+.39))).rgb;
      float wet=smoothstep(.51,.72,basin)*(.67+.26*smoothstep(1.,6.,abs(vTrack.x)));
      wet*=1.-.35*tracks.g;
      diffuseColor.rgb*=mix(vec3(1.47,1.44,1.43),vec3(.42,.46,.52),wet)*(1.-tracks.r*.47);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`
      #include <roughnessmap_fragment>
      roughnessFactor=mix(.52+.34*roughnessFactor,.18,wet);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      vec2 proj=vMirror.xy/vMirror.w;
      vec2 wobble=normal.xy*vec2(.0012,.0018)*(1.-.65*wet);
      float grazing=1.-clamp(dot(normal,normalize(vViewPosition)),0.,1.);
      vec3 image=textureLod(wetMirror,clamp(proj+wobble,.001,.999),mix(4.0,1.95,wet)).rgb;
      image/=1.+.32*dot(image,vec3(.2126,.7152,.0722));
      float sheen=.023+.48*pow(grazing,3.1);
      outgoingLight=mix(outgoingLight,image,clamp(sheen*(.036+.83*wet),0.,.82));
      #include <opaque_fragment>
    `);
  };
  return mat;
}

export class RoadMirror {
  constructor(){
    this.target=new T.WebGLRenderTarget(800,450,{type:T.HalfFloatType,minFilter:T.LinearMipmapLinearFilter,magFilter:T.LinearFilter,generateMipmaps:true});
    this.matrix=new T.Matrix4();
    this.cam=new T.PerspectiveCamera();
    this.normal=new V3(0,1,0);
    this.dir=new V3();this.clip=new T.Vector4();this.q=new T.Vector4();this.plane=new T.Plane();
  }
  resize(w,h){this.target.setSize(Math.max(200,Math.round(w*.52)),Math.max(110,Math.round(h*.52)));}
  render(renderer,scene,camera,road,hidden){
    const cam=this.cam;
    camera.updateMatrixWorld();
    cam.position.copy(camera.position);cam.position.y*=-1;
    camera.getWorldDirection(this.dir).reflect(this.normal).add(cam.position);
    cam.up.set(0,1,0).applyQuaternion(camera.quaternion).reflect(this.normal);
    cam.lookAt(this.dir);cam.updateMatrixWorld();cam.projectionMatrix.copy(camera.projectionMatrix);
    const m=cam.projectionMatrix.elements;
    this.plane.set(this.normal,-.006).applyMatrix4(cam.matrixWorldInverse);
    this.clip.set(this.plane.normal.x,this.plane.normal.y,this.plane.normal.z,this.plane.constant);
    this.q.set((Math.sign(this.clip.x)+m[8])/m[0],(Math.sign(this.clip.y)+m[9])/m[5],-1,(1+m[10])/m[14]);
    this.clip.multiplyScalar(2/this.clip.dot(this.q));
    m[2]=this.clip.x;m[6]=this.clip.y;m[10]=this.clip.z+1;m[14]=this.clip.w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    this.matrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    road.visible=false;
    hidden.forEach(o=>o.visible=false);
    const shadowAuto=renderer.shadowMap.autoUpdate,shadowNeeds=renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
    renderer.setRenderTarget(this.target);renderer.render(scene,cam);renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowNeeds;
    road.visible=true;hidden.forEach(o=>o.visible=true);
  }
}

function terrain(track,tex){
  const width=970,depth=860,nx=192,nz=170;
  const g=new T.PlaneGeometry(width,depth,nx,nz).rotateX(-Math.PI/2).translate(-190,0,42);
  const a=g.attributes.position,uv=g.attributes.uv,col=[];
  for(let i=0;i<a.count;i++){
    const x=a.getX(i),z=a.getZ(i);
    a.setY(i,track.ground(x,z));uv.setXY(i,x/5,z/5);
    const variation=.84+.10*Math.cos(x*.094+z*.048)+.09*Math.sin(x*.034-z*.071);
    col.push(variation*1.06,variation*.91,variation*.73);
  }
  g.setAttribute('color',new T.Float32BufferAttribute(col,3));g.computeVertexNormals();
  const m=new T.Mesh(g,new T.MeshStandardMaterial({map:tex.grass,roughness:.94,vertexColors:true}));
  m.receiveShadow=true;return m;
}

function vegetation(track,plants,atlas,shrub){
  const rng=seeded(47018),centers=[],params=[],nearby=new Map();
  const metadata=[[1.31435,.49471],[1.045,.48487],[3.88079,.24740]];
  function add(k,x,z,h,rot,d) {
    if(d<10.8||d>275)return;
    const [scale,mid]=metadata[k];
    if(k===2&&d<24&&h>1.0){
      const key=Math.floor(x/48)+','+Math.floor(z/48);
      if(!nearby.has(key))nearby.set(key,[]);
      nearby.get(key).push([x,track.ground(x,z,d),z,h,rot]);return;
    }
    centers.push(x,track.ground(x,z,d)+h*mid-.05,z);
    params.push(h*scale,k,(Math.sin(rot*13.71)>0?1:-1)*(.83+.27*rng()),.78+.28*rng());
  }
  for(const [k,x,z,h,rot] of plants)add(k,x,z,h,rot,track.landDistance(x,z));
  for(let i=0;i<2140;i++){
    const s=rng()*track.length,dist=12.8+Math.pow(rng(),1.3)*120,p=track.at(s,dist*(rng()>.5?1:-1));
    if(track.originalStation(s)<track.filmLength-50&&dist<58)continue;
    const k=rng()<.35?1:(rng()<.66?0:2);
    const h=(k===1?9.8:k===0?6.8:2.1)*(.52+1.0*rng());
    add(k,p.x,p.z,h,rng()*7,track.landDistance(p.x,p.z));
  }
  const unit=new T.PlaneGeometry(1,1);
  const g=new T.InstancedBufferGeometry();
  g.index=unit.index;g.attributes.position=unit.attributes.position;g.attributes.uv=unit.attributes.uv;
  g.setAttribute('treeCenter',new T.InstancedBufferAttribute(new Float32Array(centers),3));
  g.setAttribute('treeParams',new T.InstancedBufferAttribute(new Float32Array(params),4));g.instanceCount=centers.length/3;
  const declarations='attribute vec3 treeCenter; attribute vec4 treeParams; varying vec2 vLeaf; varying float vTint,vRange;\n';
  const position=`
    vec2 axis=cameraPosition.xz-treeCenter.xz;
    float dist=max(length(axis),.01);
    vec2 right=vec2(axis.y,-axis.x)/dist;
    float view=mod(floor(atan(axis.x,axis.y)*.63661977+.5)+4.,4.);
    vLeaf=vec2((view+mix(uv.x,1.-uv.x,step(treeParams.z,0.)))/4.,(2.-treeParams.y+uv.y)/3.);
    vTint=treeParams.w;vRange=dist;
    vec2 side=right*position.x*abs(treeParams.z)*treeParams.x;
    vec3 transformed=treeCenter+vec3(side.x,position.y*treeParams.x,side.y);
  `;
  const mat=new T.ShaderMaterial({
    uniforms:{leaf:{value:atlas}},side:T.DoubleSide,toneMapped:false,
    vertexShader:declarations+'void main(){'+position+'gl_Position=projectionMatrix*modelViewMatrix*vec4(transformed,1.);}',
    fragmentShader:`uniform sampler2D leaf; varying vec2 vLeaf; varying float vTint,vRange;
    void main(){
      vec4 c=texture2D(leaf,vLeaf);
      if(c.a<mix(.34,.08,smoothstep(28.,160.,vRange)))discard;
      vec3 rgb=mix(c.rgb*vTint,vec3(.49,.43,.35),smoothstep(40.,370.,vRange)*.39);
      gl_FragColor=vec4(rgb,1.);
      #include <colorspace_fragment>
    }`
  });
  const mesh=new T.Mesh(g,mat);
  mesh.frustumCulled=false;mesh.castShadow=true;
  const depthMat=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,map:atlas,alphaTest:.37,side:T.DoubleSide});
  depthMat.onBeforeCompile=shader=>{
    shader.vertexShader=declarations+shader.vertexShader.replace('#include <begin_vertex>',position);
    shader.uniforms.leafDepth={value:atlas};
    shader.fragmentShader='uniform sampler2D leafDepth; varying vec2 vLeaf;\n'+shader.fragmentShader.replace('#include <map_fragment>','if(texture2D(leafDepth,vLeaf).a<.35)discard;');
  };
  mesh.customDepthMaterial=depthMat;
  const grove=new T.Group();grove.add(mesh);
  shrub.updateMatrixWorld(true);
  shrub.traverse(part=>{
    if(!part.isMesh)return;
    const wood=part.geometry.clone().applyMatrix4(part.matrixWorld);
    const material=part.material;material.side=T.DoubleSide;
    const o=new T.Object3D();
    for(const items of nearby.values()){
      const origin=items[0],lod=new T.LOD(),inst=new T.InstancedMesh(wood,material,items.length);
      lod.position.set(origin[0],0,origin[2]);inst.castShadow=true;inst.receiveShadow=true;
      items.forEach(([x,y,z,h,rot],i)=>{
        o.position.set(x-origin[0],y,z-origin[2]);o.rotation.y=rot;o.scale.setScalar(h);o.updateMatrix();inst.setMatrixAt(i,o.matrix);
      });
      lod.addLevel(inst,0);lod.addLevel(new T.Group(),145);grove.add(lod);
    }
  });
  return grove;
}

function grassTufts(track){
  const rnd=seeded(618),xyz=[],cols=[];
  for(let i=0;i<10700;i++){
    const d=8.9+rnd()**1.6*14,s=rnd()*track.length,p=track.at(s,d*(rnd()>.5?1:-1));
    const ground=track.ground(p.x,p.z,track.landDistance(p.x,p.z)),h=.09+.32*rnd(),tone=.6+.6*rnd();
    for(let j=0;j<4;j++){
      const ang=rnd()*6.283,bx=p.x+(rnd()-.5)*.19,bz=p.z+(rnd()-.5)*.19,w=.018+rnd()*.015;
      const dx=Math.cos(ang)*w,dz=Math.sin(ang)*w;
      xyz.push(bx-dx,ground-.04,bz-dz,bx+dx,ground-.04,bz+dz,bx+.08+rnd()*.075,ground+h*(.6+.5*rnd()),bz+dz*4);
      cols.push(.09*tone,.094*tone,.04*tone,.11*tone,.1*tone,.043*tone,.47*tone,.39*tone,.17*tone);
    }
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(xyz,3));g.setAttribute('color',new T.Float32BufferAttribute(cols,3));
  return new T.Mesh(g,new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide}));
}

function boxes(scene,geometry,material,items,shadows=true) {
  const mesh=new T.InstancedMesh(geometry,material,items.length),o=new T.Object3D();
  items.forEach(([x,y,z,yaw,sx,sy,sz],i)=>{
    o.position.set(x,y,z);o.rotation.set(0,yaw,0);o.scale.set(sx,sy,sz);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);
  });
  mesh.castShadow=shadows;mesh.receiveShadow=true;scene.add(mesh);return mesh;
}
function furniture(scene,track,tex,original){
  const colors={'Kerb | oxide red':0xa9453c,'Kerb | worn ivory':0xcac4aa,'Run-off edge | desaturated green':0x637e72,'Armco | weathered galvanized zinc':0xb9b7b0,'Marshal hut | cream masonry':0xd6be94,'Marshal hut | faded claret':0x865547};
  original.traverse(o=>{if(o.isMesh){const m=o.material;if(colors[m.name])m.color.setHex(colors[m.name]);m.side=T.DoubleSide;o.receiveShadow=true;o.castShadow=true;}});
  scene.add(original);
  const extra=s=>{const a=track.originalStation(s);return a<36||a>404;};
  const post=[],unit=new T.BoxGeometry(),silver=new T.MeshStandardMaterial({color:0xabada9,metalness:.73,roughness:.38,side:T.DoubleSide});
  for(const side of [-1,1]){
    const d=side*11.6;
    for(let s=0;s<track.length;s+=3.6){if(!extra(s))continue;const p=track.at(s,d);post.push([p.x,.37,p.z,p.yaw,.125,.78,.15]);}
    const profile=[[0,.34],[.045,.39],[.135,.44],[.12,.49],[.03,.53],[.035,.56],[.13,.61],[.135,.65],[.03,.70],[0,.715]];
    const xyz=[],idx=[];
    for(let i=0;i<track.points.length;i++){const s=i*track.step;if(!extra(s))continue;
      const a=xyz.length/3;
      for(const where of [s,s+track.step])for(const [offset,y] of profile){const p=track.at(where,d-side*offset);xyz.push(p.x,y,p.z);}
      const n=profile.length;for(let k=0;k<n-1;k++)idx.push(a+k,a+n+k,a+k+1,a+n+k,a+n+k+1,a+k+1);
    }
    const g=new T.BufferGeometry();g.setIndex(idx);g.setAttribute('position',new T.Float32BufferAttribute(xyz,3));g.computeVertexNormals();
    const rail=new T.Mesh(g,silver);rail.castShadow=true;rail.receiveShadow=true;scene.add(rail);
  }
  boxes(scene,unit,new T.MeshStandardMaterial({color:0x696a61,metalness:.58,roughness:.54}),post);
  const white=new T.MeshStandardMaterial({color:0xccc7ad,roughness:.8,polygonOffset:true,polygonOffsetFactor:-1});
  scene.add(ribbon(track,-6.86,-6.72,.011,white),ribbon(track,6.72,6.86,.011,white));
  const red=new T.Color(0xa34b41).toArray(),cream=new T.Color(0xcdc4ac).toArray();
  for(const side of [-1,1]){
    const from=side<0?-7.83:6.88,to=side<0?-6.88:7.83;
    scene.add(ribbon(track,from,to,(lat)=>.018+.048*(1-Math.abs(Math.abs(lat)-7.35)/.49),new T.MeshStandardMaterial({vertexColors:true,roughness:.66}),s=>{
      const a=track.originalStation(s);return !(a>179&&a<285)&&track.curvature(s,8)*side<-.0075;
    },s=>Math.floor(s/2.7)%2?red:cream));
  }
  const groups=[[],[]];
  for(let row=0;row<2;row++)for(let col=0;col<26;col++){
    const p=track.at(row*.48,(col-12.5)*.50);groups[(row+col)%2].push([p.x,.015,p.z,p.yaw,.5,.011,.48]);
  }
  for(let i=0;i<2;i++)boxes(scene,unit,new T.MeshStandardMaterial({color:i?0x292a27:0xcbc7b1,roughness:.65}),groups[i],false);
  const grid=[];
  for(let i=0;i<6;i++){const s=-2-i*5.5,lat=i%2?1.65:-1.65;
    for(const offset of [-1,1]){const p=track.at(s,lat+offset);grid.push([p.x,.014,p.z,p.yaw,.075,.01,1.05]);}
    const p=track.at(s+.48,lat);grid.push([p.x,.014,p.z,p.yaw,2.05,.01,.075]);
  }
  boxes(scene,unit,white,grid,false);
  // Narrow enamel adverts face the racing line along the wooded return sector.
  const supports=[];
  for(let n=0;n<14;n++){
    const s=track.filmLength-track.startStation+30+n*40;
    const side=n%4===0?1:-1,d=12.6*side,p=track.at(s,d);
    const board=new T.Mesh(new T.PlaneGeometry(5.55,1.02),new T.MeshStandardMaterial({map:tex.boards[n%3],side:T.DoubleSide,metalness:.1,roughness:.48}));
    board.rotation.y=p.yaw-side*Math.PI/2;board.position.set(p.x,1.28,p.z);board.castShadow=true;scene.add(board);
    for(const ds of [-2.15,2.15]){const q=track.at(s+ds,d+side*.08);supports.push([q.x,.73,q.z,p.yaw,.085,1.45,.08]);}
  }
  boxes(scene,unit,silver,supports);
  for(const s of [8,36,track.length*.41,track.length*.41+27,track.length*.69]){
    const p=track.at(s,8.9),cv=document.createElement('canvas');cv.width=160;cv.height=112;
    const ctx=cv.getContext('2d');ctx.fillStyle='#d0cbb4';ctx.fillRect(0,0,160,112);ctx.strokeStyle='#353a32';ctx.lineWidth=5;ctx.strokeRect(5,5,150,102);
    ctx.font='bold 66px sans-serif';ctx.textAlign='center';ctx.fillStyle='#252921';ctx.fillText(s===8?'100':'50',80,81);
    const tx=new T.CanvasTexture(cv);tx.colorSpace=T.SRGBColorSpace;
    const sign=new T.Mesh(new T.BoxGeometry(1.18,.83,.065),new T.MeshStandardMaterial({map:tx,roughness:.78}));
    sign.position.set(p.x,.56,p.z);sign.rotation.y=p.yaw;scene.add(sign);
  }
}

export function makeWorld(scene,track,source,tex,props,shrub,mirror) {
  const road=ribbon(track,-6.95,6.95,0,roadMaterial(tex,mirror));
  scene.add(terrain(track,tex),road);
  const gravel=new T.MeshStandardMaterial({map:tex.gravel,roughness:.88,color:0xbcb6a7});
  scene.add(ribbon(track,-9.15,-6.95,-.032,gravel),ribbon(track,6.95,9.15,-.032,gravel));
  scene.add(vegetation(track,source.plants,tex.trees,shrub),grassTufts(track));
  furniture(scene,track,tex,props);
  return road;
}
