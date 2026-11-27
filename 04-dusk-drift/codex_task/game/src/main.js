import * as T from 'three';
import {GLTFLoader} from '../vendor/GLTFLoader.js';
import {RGBELoader} from '../vendor/RGBELoader.js';
import {Circuit,clamp,damp,angleDelta} from './circuit.js';
import {Race,LAPS} from './race.js';
import {makeWorld,RoadMirror} from './world.js';
import {Cars,TyreEffects} from './vehicles.js';
import {MotorSound} from './sound.js';
import {Shutter} from './shutter.js';

const el=id=>document.getElementById(id);
const keys=new Set(),sound=new MotorSound();
const meters=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const camNames=['追车','前侧跟拍','引擎盖'];
const formatTime=s=>{const ms=Math.floor(Math.max(0,s)*1000);return Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');};
let mode='load',paused=false,clean=false,view=0,noticeEnd=0,previewTime=0,frame=0,accum=0,last=0,lastHud=-1;
let renderer,scene,camera,track,race,cars,tyres,road,mirror,sun,shutter;
let cameraYaw=0,snap=true;
const look=new T.Vector3(),eye=new T.Vector3(),goal=new T.Vector3();
const rpmBars=Array.from({length:22},(_,i)=>{const b=document.createElement('i');if(i>17)b.className='hot';el('tach').append(b);return b;});
const ui=(id,str)=>{const n=el(id);if(n.textContent!==str)n.textContent=str;};

function message(text){el('notice').textContent=text;noticeEnd=performance.now()+1450;}
function setMode(m){
  mode=m;document.body.dataset.mode=m;
  el('loading').hidden=m!=='load';el('intro').hidden=m!=='intro';el('hud').hidden=m!=='race';
  el('panel').hidden=!(paused||m==='finish');
}
function resize(){
  const w=window.innerWidth,h=window.innerHeight;
  const pixelRatio=Math.min(window.devicePixelRatio||1,1.7,Math.sqrt(2200000/(w*h)));
  renderer.setPixelRatio(pixelRatio);renderer.setSize(w,h,false);
  camera.aspect=w/h;camera.updateProjectionMatrix();
  mirror.resize(Math.min(w*pixelRatio,1700),Math.min(h*pixelRatio,1000));
  shutter.resize(w*pixelRatio,h*pixelRatio);
  tyres.spray.material.uniforms.screenHeight.value=h*pixelRatio;
  const map=el('map'),size=Math.max(140,Math.min(w*.125,200));
  map.width=Math.round(size*2);map.height=Math.round(size/1.55*2);
}
function start(){
  if(!race)return;
  clean=false;document.body.classList.remove('clean');keys.clear();paused=false;race.reset();tyres.clear();
  view=0;snap=true;accum=0;el('notice').textContent='';setMode('race');lastHud=-1;
}
function pause(){
  if(mode!=='race')return;
  paused=!paused;keys.clear();el('panel').hidden=!paused;el('controlList').hidden=false;el('result').hidden=true;
  ui('panelTitle','比赛暂停');el('resumeButton').hidden=false;
  document.body.classList.toggle('clean',clean&&!paused);accum=0;
}
function finish(){
  clean=false;document.body.classList.remove('clean');setMode('finish');el('controlList').hidden=true;el('resumeButton').hidden=true;
  const pos=race.order().findIndex(c=>c.id===0)+1;ui('panelTitle','完赛 · 第 '+pos+' 名');
  el('result').hidden=false;el('result').innerHTML='';
  for(const [label,value] of [['总时间',formatTime(race.time)],['最快圈',formatTime(race.best??race.time)]]){
    const row=document.createElement('div'),a=document.createElement('label'),b=document.createElement('b');
    a.textContent=label;b.textContent=value;row.append(a,b);el('result').append(row);
  }
  el('signal').hidden=true;
}
function changeView(){if(mode!=='race'||paused)return;view=(view+1)%camNames.length;snap=true;message(camNames[view]);}
async function toggleSound(){const on=await sound.toggle();el('soundButton').setAttribute('aria-pressed',String(on));ui('soundLabel',on?'声音开':'静音');}
el('startButton').onclick=start;el('restartButton').onclick=start;el('resumeButton').onclick=pause;
el('pauseButton').onclick=pause;el('soundButton').onclick=toggleSound;el('cameraButton').onclick=changeView;
const controls=new Set(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','Enter','Escape','KeyC','KeyR','KeyM','KeyH']);
window.addEventListener('keydown',e=>{
  if(!controls.has(e.code)||e.metaKey||e.ctrlKey||e.altKey)return;
  if(e.code==='Enter'&&e.target instanceof HTMLButtonElement && e.target!==el('startButton'))return;
  e.preventDefault();keys.add(e.code);if(e.repeat)return;
  if(e.code==='Enter'&&(mode==='intro'||mode==='finish'))start();
  else if(e.code==='Escape')pause();
  else if(e.code==='KeyC')changeView();
  else if(e.code==='KeyM')void toggleSound();
  else if(e.code==='KeyR'&&mode==='race'&&!paused&&race.phase==='race'){race.recover();snap=true;tyres.last=[null,null];message('已回到赛道');}
  else if(e.code==='KeyH'&&mode==='race'&&!paused){clean=!clean;document.body.classList.toggle('clean',clean);}
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{keys.clear();if(mode==='race'&&!paused)pause();});
function input(){return{gas:keys.has('KeyW')||keys.has('ArrowUp'),brake:keys.has('KeyS')||keys.has('ArrowDown'),left:keys.has('KeyA')||keys.has('ArrowLeft'),right:keys.has('KeyD')||keys.has('ArrowRight'),hand:keys.has('Space')};}

function setCamera(dt){
  const c=race.cars[0],angle=mode==='intro'||view===1?c.course:c.course+.12*angleDelta(c.yaw,c.course);
  cameraYaw+=angleDelta(angle,cameraYaw)*(snap?1:1-Math.exp(-dt*6));
  let si=Math.sin(cameraYaw),co=Math.cos(cameraYaw),ex,ez,ey,lx,lz,ly,fov;
  if(mode==='intro'||view===1){
    const sway=mode==='intro'?Math.sin(previewTime*.17):0;
    ex=4.05+sway*.50;ez=-6.35+sway*.60;ey=1.24+sway*.095;
    lx=-.26;lz=mode==='intro'?1.52:.85;ly=.52;fov=36;
  }else if(view===2){
    si=Math.sin(c.yaw);co=Math.cos(c.yaw);ex=.21;ez=-.72;ey=1.035;lx=.18;lz=-14;ly=.64;fov=63;
  }else{
    ex=0;ez=5.35+Math.min(1,c.speed/55)*.70;ey=2.10+Math.min(1,c.speed/45)*.19;
    lx=-Math.sin(angleDelta(c.yaw,c.course))*.65;lz=-4.2;ly=.65;fov=49+Math.min(8,Math.max(0,c.speed)*.15);
  }
  eye.set(c.x+co*ex+si*ez,ey,c.z-si*ex+co*ez);
  if(mode==='intro'||view===1){
    const shoulder=track.nearest(eye.x,eye.z);
    if(Math.abs(shoulder.lateral)>8.35){
      const inside=track.at(shoulder.s,Math.sign(shoulder.lateral)*8.35);
      eye.x=inside.x;eye.z=inside.z;
    }
  }
  goal.set(c.x+co*lx+si*lz,ly,c.z-si*lx+co*lz);
  // Keep translation locked to the car, and damp the heading at corner entry.
  camera.position.copy(eye);look.copy(goal);camera.up.set(0,1,0);camera.lookAt(look);
  camera.fov=snap?fov:damp(camera.fov,fov,7,dt);camera.updateProjectionMatrix();snap=false;
}
function drawMap(){
  const canvas=el('map'),ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,b=track.bounds;
  const scale=Math.min((w-26)/(b.maxX-b.minX),(h-25)/(b.maxZ-b.minZ));
  const ox=(w-(b.maxX-b.minX)*scale)/2,oy=(h-(b.maxZ-b.minZ)*scale)/2;
  const X=x=>ox+(x-b.minX)*scale,Y=z=>oy+(z-b.minZ)*scale;
  ctx.clearRect(0,0,w,h);ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
  track.points.forEach((p,i)=>{if(i%3===0){if(i===0)ctx.moveTo(X(p.x),Y(p.z));else ctx.lineTo(X(p.x),Y(p.z));}});ctx.closePath();
  ctx.lineWidth=6;ctx.strokeStyle='rgba(32,35,29,.66)';ctx.stroke();ctx.lineWidth=3.2;ctx.strokeStyle='#ded7c3';ctx.stroke();
  const grid=track.at(0);ctx.fillStyle='#eee5cc';ctx.fillRect(X(grid.x)-5,Y(grid.z)-1.5,10,3);
  for(const id of [2,1,0]){
    const c=race.cars[id],x=X(c.x),y=Y(c.z);ctx.save();ctx.translate(x,y);
    ctx.fillStyle=['#b34233','#e3b75b','#669bad'][id];ctx.strokeStyle='#f1ead7';ctx.lineWidth=id?1.6:2.3;ctx.beginPath();
    if(id){ctx.arc(0,0,4.1,0,Math.PI*2);}else{ctx.rotate(-c.yaw);ctx.moveTo(0,-8);ctx.lineTo(5.5,5.5);ctx.lineTo(0,3.5);ctx.lineTo(-5.5,5.5);ctx.closePath();}
    ctx.fill();ctx.stroke();ctx.restore();
  }
}
function drivetrain(){
  const v=race.cars[0].speed,km=Math.abs(v)*3.6;
  const shifts=[0,44,75,108,143,182],g=v<-.4?'R':v<.25?'N':Math.max(1,shifts.findLastIndex(k=>km>=k)+1);
  const rev=typeof g==='number'?3000+3650*(km-shifts[g-1])/((shifts[g]??225)-shifts[g-1]):(keys.has('KeyW')?2100:950);
  return {km,g,rev:clamp(rev,900,7100)};
}
function display(){
  const {km,g,rev}=drivetrain();
  ui('speed',String(Math.round(km)).padStart(3,'0'));ui('gear',String(g));ui('lap',String(Math.min(race.lap,LAPS)));
  ui('place',String(race.order().findIndex(c=>c.id===0)+1));ui('currentLap',formatTime(race.time-race.lapStart));ui('bestLap',race.best===null?'—':formatTime(race.best));
  rpmBars.forEach((bar,i)=>bar.classList.toggle('lit',i<Math.round(rev/7000*22)));
  const show=mode==='race'&&(race.phase==='grid'||race.time<.77);
  el('signal').hidden=!show;
  if(show){const grid=race.phase==='grid';ui('signalNumber',grid?String(Math.ceil(race.countdown)):'VIA');ui('signalName',grid?'准备发车':'发车');}
  el('drift').hidden=race.driftHold<=0||mode!=='race';
  if(race.driftHold>0){ui('driftAngle',Math.round(race.driftActive?Math.abs(race.cars[0].slip)*180/Math.PI:race.driftPeak)+'°');ui('driftLength',Math.round(race.driftMeters)+' m');}
  drawMap();
}
function animate(ms){
  const dt=clamp((ms-last)*.001||0,0,.12);last=ms;
  if(mode==='intro'){
    previewTime+=dt;race.preview(previewTime);
  }else if(mode==='race'&&!paused){
    accum+=dt;const state=input();
    while(accum>=1/90){race.step(1/90,state);accum-=1/90;}
    if(race.phase==='finish')finish();
  }
  if((mode==='intro'||mode==='race')&&(!paused||snap)){
    const cut=snap;cars.update(race.cars);setCamera(dt);
    if(mode!=='finish')tyres.tick(dt,race.cars,mode==='intro'?Math.abs(angleDelta(race.cars[0].yaw,race.cars[0].course))>.16:race.driftActive);
    const c=race.cars[0],sunOriginX=Math.round(c.x*2)/2,sunOriginZ=Math.round(c.z*2)/2;
    sun.position.set(sunOriginX+61,20,sunOriginZ+36);sun.target.position.set(sunOriginX,0,sunOriginZ);sun.target.updateMatrixWorld();
    if(frame%2===0||frame<3)mirror.render(renderer,scene,camera,road,[...cars.contacts,tyres.rubber,tyres.spray]);
    renderer.shadowMap.needsUpdate=frame%2===0;
    shutter.render(renderer,scene,camera,race.cars,dt,cut);frame++;
  }
  if(mode==='race'&&!paused&&ms-lastHud>48){display();lastHud=ms;}
  if(el('notice').textContent&&ms>noticeEnd)el('notice').textContent='';
  if(sound.enabled){const {rev}=drivetrain();sound.update(rev,race.cars[0].speed,race.driftActive,paused||mode==='finish');}
  requestAnimationFrame(animate);
}
async function init(){
  renderer=new T.WebGLRenderer({canvas:el('view'),antialias:true,powerPreference:'high-performance',alpha:false});
  renderer.toneMapping=T.AgXToneMapping;renderer.toneMappingExposure=1.02;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
  scene=new T.Scene();camera=new T.PerspectiveCamera(45,1,.09,780);mirror=new RoadMirror();shutter=new Shutter(renderer);
  scene.fog=new T.FogExp2(0xd3c6ad,.00235);
  const manager=new T.LoadingManager();
  manager.onProgress=(_,done,total)=>{el('loadBar').style.width=Math.min(95,done/total*94)+'%';};
  const loader=new T.TextureLoader(manager),gltf=new GLTFLoader(manager),path='./assets/';
  const anis=Math.min(12,renderer.capabilities.getMaxAnisotropy());
  const texture=async(file,srgb=false,repeat=null)=>{
    const t=await loader.loadAsync(path+file);
    if(srgb)t.colorSpace=T.SRGBColorSpace;t.anisotropy=anis;
    if(repeat!==null){t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.setScalar(repeat);}
    return t;
  };
  const specs={asphalt:['asphalt_diff.jpg',true,.43],normal:['asphalt_nor.jpg',false,.43],rough:['asphalt_rough.jpg',false,.43],wear:['track_wear.png'],grass:['grass.jpg',true,1],gravel:['gravel_Diffuse.jpg',true,.42],trees:['trees.png',true],top:['top62.png',true],side:['side62.png',true]};
  const tex={},sourcePromise=fetch(path+'circuit.json').then(r=>r.json());
  await Promise.all(Object.entries(specs).map(async([key,args])=>tex[key]=await texture(...args)));
  const [data,env,probe,gt,lancia,props,shrub,boards]=await Promise.all([sourcePromise,new RGBELoader(manager).loadAsync(path+'qwantani.hdr'),new RGBELoader(manager).loadAsync(path+'qwantani-light.hdr'),...['gt40.glb','stradale.glb','circuit-furniture.glb','shrub.glb'].map(file=>gltf.loadAsync(path+file)),Promise.all(['selva','lucera','volta'].map(n=>texture('board_'+n+'.png',true)))]);
  tex.boards=boards;tex.top.flipY=tex.side.flipY=false;tex.top.needsUpdate=tex.side.needsUpdate=true;
  env.mapping=T.EquirectangularReflectionMapping;scene.background=env;scene.backgroundIntensity=1.52;scene.backgroundRotation.y=.12;
  probe.mapping=T.EquirectangularReflectionMapping;scene.environment=probe;scene.environmentIntensity=.69;scene.environmentRotation.y=.12;
  const sky=new T.HemisphereLight(0xffedcf,0x736b51,.12);scene.add(sky);
  sun=new T.DirectionalLight(0xffd6a9,1.10);sun.castShadow=true;
  Object.assign(sun.shadow.camera,{left:-43,right:43,top:43,bottom:-43,near:.5,far:151});
  sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.022;sun.shadow.bias=-.00018;sun.shadow.camera.updateProjectionMatrix();scene.add(sun,sun.target);
  track=new Circuit(data.centers);race=new Race(track);road=makeWorld(scene,track,data,tex,props.scene,shrub.scene,mirror);
  cars=new Cars(scene,gt.scene,lancia.scene,{top:tex.top,side:tex.side});tyres=new TyreEffects(scene);
  ui('trackLength',meters.format(track.length/1000)+' km / 圈');
  el('loadBar').style.width='100%';resize();window.addEventListener('resize',resize);
  race.preview(0);cars.update(race.cars);setMode('intro');setCamera(0);last=performance.now();requestAnimationFrame(animate);
}
init().catch(err=>{console.error(err);ui('loadText','赛道加载失败。请用“启动游戏.command”打开，再刷新页面。');});
