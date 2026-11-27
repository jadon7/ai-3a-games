import * as T from 'three';

// Reproject each visible surface into the last frame. Cars and wheels move
// independently of the road, so a tracking shot keeps its subject sharp.
export class Shutter {
  constructor(renderer) {
    this.target=new T.WebGLRenderTarget(1,1,{
      type:T.HalfFloatType,minFilter:T.LinearFilter,magFilter:T.LinearFilter,
      samples:Math.min(4,renderer.capabilities.maxSamples),
      depthTexture:new T.DepthTexture(1,1,T.UnsignedIntType)
    });
    const triplet=()=>Array.from({length:3},()=>new T.Vector4());
    this.uniforms={
      frameColor:{value:this.target.texture},frameDepth:{value:this.target.depthTexture},
      inverseVP:{value:new T.Matrix4()},previousVP:{value:new T.Matrix4()},
      carPose:{value:triplet()},previousPose:{value:triplet()},wheelStep:{value:new T.Vector3()},
      pixels:{value:new T.Vector2()},exposureTime:{value:0}
    };
    this.currentVP=new T.Matrix4();this.lastSpin=[0,0,0];this.first=true;
    const material=new T.ShaderMaterial({uniforms:this.uniforms,depthTest:false,depthWrite:false,
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:`
        uniform sampler2D frameColor,frameDepth;
        uniform mat4 inverseVP,previousVP;
        uniform vec4 carPose[3],previousPose[3];
        uniform vec3 wheelStep;
        uniform vec2 pixels;uniform float exposureTime;
        varying vec2 vUv;
        void main(){
          float depth=texture2D(frameDepth,vUv).r;
          vec4 wp=inverseVP*vec4(vUv*2.-1.,depth*2.-1.,1.);
          vec3 world=wp.xyz/wp.w;
          if(world.y>.038&&world.y<1.32){
            for(int i=0;i<3;i++){
              vec4 p=carPose[i],old=previousPose[i];
              vec2 d=world.xz-p.xy;
              vec2 local=vec2(p.w*d.x-p.z*d.y,p.z*d.x+p.w*d.y);
              if(abs(local.x)>1.0||abs(local.y)>2.2)continue;
              float hubZ=local.y>0.?(i==1?1.35:1.392):(i==1?-1.15:-1.008);
              float radius=i==1?.32:(local.y>0.?.348:.329);
              vec2 spoke=vec2(world.y-radius,local.y-hubZ);
              if(abs(abs(local.x)-.73)<.22&&dot(spoke,spoke)<radius*radius){
                float a=wheelStep[i];float c=cos(a),s=sin(a);
                world.y=radius+c*spoke.x-s*spoke.y;
                local.y=hubZ+s*spoke.x+c*spoke.y;
              }
              world.xz=vec2(old.w*local.x+old.z*local.y,-old.z*local.x+old.w*local.y)+old.xy;
              break;
            }
          }
          vec4 prev=previousVP*vec4(world,1.);
          vec2 velocity=(prev.xy/max(.001,prev.w)*.5+.5-vUv)*exposureTime;
          velocity*=min(1.,13./max(.01,length(velocity*pixels)));
          vec3 color=texture2D(frameColor,vUv).rgb;
          if(dot(velocity*pixels,velocity*pixels)>.30){
            float total=1.;
            for(int i=1;i<=6;i++){
              vec2 at=clamp(vUv+velocity*(float(i)/6.),.0001,.9999);
              float z=texture2D(frameDepth,at).r;
              float w=1.-smoothstep(.09,.42,abs(z-depth)/max(.00012,1.-depth));
              color+=texture2D(frameColor,at).rgb*w;total+=w;
            }
            color/=total;
          }
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`});
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
    g.setAttribute('uv',new T.Float32BufferAttribute([0,0,2,0,0,2],2));
    const full=new T.Mesh(g,material);full.frustumCulled=false;
    this.scene=new T.Scene();this.scene.add(full);this.camera=new T.Camera();
  }
  resize(w,h){this.target.setSize(Math.round(w),Math.round(h));this.uniforms.pixels.value.set(w,h);this.first=true;}
  render(renderer,scene,camera,cars,dt,cut){
    const u=this.uniforms;camera.updateMatrixWorld();
    this.currentVP.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    u.inverseVP.value.copy(this.currentVP).invert();
    const reset=this.first||cut;
    if(reset)u.previousVP.value.copy(this.currentVP);
    cars.forEach((c,i)=>{
      u.carPose.value[i].set(c.x,c.z,Math.sin(c.yaw),Math.cos(c.yaw));
      if(reset)u.previousPose.value[i].copy(u.carPose.value[i]);
      u.wheelStep.value.setComponent(i,this.lastSpin[i]-c.spin);this.lastSpin[i]=c.spin;
    });
    u.exposureTime.value=reset||dt<=0?0:Math.min(.85,.0095/dt);
    renderer.setRenderTarget(this.target);renderer.render(scene,camera);renderer.setRenderTarget(null);
    renderer.render(this.scene,this.camera);
    u.previousVP.value.copy(this.currentVP);u.carPose.value.forEach((p,i)=>u.previousPose.value[i].copy(p));this.first=false;
  }
}
