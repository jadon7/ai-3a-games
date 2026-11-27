import {angleDelta,clamp,damp,wrap} from './circuit.js';

export const LAPS=3;
export class Race {
  constructor(track) { this.track=track; this.reset(); }
  vehicle(s,lane,id) {
    const p=this.track.at(s,lane);
    return {...p,id,s:wrap(s,this.track.length),progress:s,lane,speed:0,course:p.yaw,steer:0,slip:0,spin:0,roll:0,pitch:0,finish:null};
  }
  reset(){
    this.cars=[this.vehicle(-13,1.7,0),this.vehicle(-7,-1.7,1),this.vehicle(-2,1.4,2)];
    this.time=0; this.lapStart=0; this.best=null; this.lastLap=null; this.lap=1;
    this.countdown=3; this.phase='grid'; this.driftMeters=0; this.driftPeak=0;
    this.driftActive=false; this.driftHold=0; this.contactCooldown=0;
  }
  preview(t){
    const s=58+t*13.0;
    this.cars.forEach((car,i)=>{
      const gap=[0,9.3,18.8][i],lane=[1.1,-1.3,1.6][i];
      const pos=this.track.at(s-gap,lane);
      Object.assign(car,pos,{course:pos.yaw,s:s-gap,speed:17});
      if(i===0)car.yaw+=.27*Math.exp(-((wrap(s,this.track.length)-95)**2)/610);
      car.spin=-t*44;
      car.steer=i===0?-.12:0;
    });
  }
  recover(){
    const c=this.cars[0],p=this.track.at(c.progress,.35);
    Object.assign(c,p,{s:wrap(c.progress,this.track.length),course:p.yaw,lane:.35,speed:0,steer:0,slip:0});
    this.driftActive=false; this.driftHold=0;
  }
  step(dt,input) {
    if(this.phase==='grid'){
      this.countdown-=dt;
      if(this.countdown<=0)this.phase='race';
      return;
    }
    if(this.phase!=='race')return;
    this.time+=dt;
    this.contactCooldown=Math.max(0,this.contactCooldown-dt);
    this.player(dt,input);
    this.computer(dt,1);this.computer(dt,2);
    this.contacts();
    for(const c of this.cars) {
      if(c.finish===null && c.progress>=this.track.length*LAPS)c.finish=this.time;
    }
    const lap=clamp(Math.floor(this.cars[0].progress/this.track.length)+1,1,LAPS+1);
    if(lap>this.lap){
      this.lastLap=this.time-this.lapStart;
      this.best=this.best===null?this.lastLap:Math.min(this.best,this.lastLap);
      this.lapStart=this.time;this.lap=lap;
    }
    if(this.cars[0].finish!==null)this.phase='finish';
  }
  player(dt,input) {
    const c=this.cars[0],off=Math.abs(c.lane)>7.05,oldSpeed=c.speed;
    const steerInput=(input.left?1:0)-(input.right?1:0);
    c.steer=damp(c.steer,steerInput,steerInput?5.8:8.5,dt);
    const hand=input.hand && c.speed>8 && !off;
    let acceleration=(input.gas?9.6/(1+Math.max(0,c.speed)*.022):0) - .55 - .00185*c.speed**2;
    if(input.brake)acceleration-=17;
    if(off)acceleration-=4.8+.16*c.speed;
    if(hand)acceleration-=3.5;
    if(c.speed<0 && !input.brake)acceleration=input.gas?11:3.2;
    if(c.speed<=0 && input.brake && !input.gas)acceleration=-3.1;
    c.braking=input.brake||hand;
    c.speed=clamp(c.speed+acceleration*dt,input.brake?-5:Math.min(0,oldSpeed),61);
    if(!input.brake&&!input.gas&&Math.abs(c.speed)<.065)c.speed=0;
    const v=Math.abs(c.speed);
    const turn=(hand?1.54:1.12)*Math.min(1,v/8)/(1+v*(hand?.007:.013));
    c.yaw+=turn*c.steer*Math.sign(c.speed)*dt;
    const grip=hand?1.10:(off?3.0:5.9);
    c.course+=angleDelta(c.yaw,c.course)*(1-Math.exp(-grip*dt));
    c.slip=angleDelta(c.yaw,c.course);
    c.x-=Math.sin(c.course)*c.speed*dt;
    c.z-=Math.cos(c.course)*c.speed*dt;
    const near=this.track.nearest(c.x,c.z);
    let delta=near.s-c.s;
    if(delta>this.track.length/2)delta-=this.track.length;
    if(delta< -this.track.length/2)delta+=this.track.length;
    c.progress+=delta;c.s=near.s;c.lane=near.lateral;
    if(Math.abs(c.lane)>10.05){
      const side=Math.sign(c.lane),p=this.track.at(c.s,side*10.02);
      c.x=p.x;c.z=p.z;c.lane=side*10.02;
      if(this.contactCooldown<=0){c.speed*=.62;this.contactCooldown=.5;}
      const outward=Math.sin(angleDelta(p.yaw,c.course))*side;
      if(outward>0)c.course+=angleDelta(p.yaw,c.course)*.53;
      c.yaw+=angleDelta(p.yaw,c.yaw)*Math.min(1,2.9*dt);
    }
    c.spin-=c.speed*dt/.335;
    c.roll=damp(c.roll,c.steer*Math.min(v/28,1)*.035,6,dt);
    c.pitch=damp(c.pitch,clamp((oldSpeed-c.speed)/dt*.003,-.025,.046),7,dt);
    const sliding=v>8&&Math.abs(c.slip)>.16&&!off;
    if(sliding) {
      if(!this.driftActive&&this.driftHold<=0){this.driftMeters=0;this.driftPeak=0;}
      this.driftMeters+=v*dt;this.driftPeak=Math.max(this.driftPeak,Math.abs(c.slip)*180/Math.PI);
      this.driftHold=1.05;
    } else this.driftHold=Math.max(0,this.driftHold-dt);
    this.driftActive=sliding;
  }
  computer(dt,id){
    const c=this.cars[id],tr=this.track;
    const curve=tr.curvature(c.progress+10,9),ahead=tr.curvature(c.progress+30,10);
    const base=id===1?29.8:31.5;
    const desired=clamp(base-365*Math.max(Math.abs(curve),Math.abs(ahead)*.85)+1.1*Math.sin(c.progress*.019+id),15,36);
    c.braking=c.speed>desired+1;
    c.speed=damp(c.speed,desired,c.speed>desired?1.8:.35,dt);
    let lane=(id===1?-1.55:1.4)+clamp(curve*48,-1.6,1.6)+.55*Math.sin(c.progress*.013+id*2);
    for(const other of this.cars) {
      if(other===c)continue;
      const gap=wrap(other.s-c.s+tr.length*.5,tr.length)-tr.length*.5;
      if(gap>0 && gap<11 && Math.abs(other.lane-c.lane)<2.2)
        lane=clamp(other.lane+(c.lane>=other.lane?2.5:-2.5),-4.8,4.8);
    }
    const oldLane=c.lane;
    c.lane=damp(c.lane,lane,1.6,dt);
    c.progress+=c.speed*dt;c.s=wrap(c.progress,tr.length);
    const p=tr.at(c.progress,c.lane);
    c.x=p.x;c.z=p.z;c.yaw=p.yaw-Math.atan2(c.lane-oldLane,Math.max(c.speed*dt,.02));
    c.course=p.yaw;c.steer=clamp(curve*16,-.7,.7);
    c.roll=clamp(curve*c.speed*.05,-.04,.04);c.spin-=c.speed*dt/.335;
  }
  contacts(){
    const player=this.cars[0];
    for(const other of this.cars.slice(1)){
      const dx=player.x-other.x,dz=player.z-other.z;
      if(dx*dx+dz*dz>21)continue;
      const s=Math.sin(other.yaw),c=Math.cos(other.yaw);
      const lateral=dx*c-dz*s,longitudinal=-dx*s-dz*c;
      if(Math.abs(lateral)>1.75||Math.abs(longitudinal)>3.85)continue;
      if(1.75-Math.abs(lateral)<3.85-Math.abs(longitudinal)){
        const push=(1.75-Math.abs(lateral))*(lateral>=0?1:-1);
        player.x+=push*c;player.z-=push*s;
      }else{
        const push=(3.85-Math.abs(longitudinal))*(longitudinal>=0?1:-1);
        player.x-=push*s;player.z-=push*c;
      }
      if(this.contactCooldown<=0){
        if(longitudinal<0)player.speed=Math.min(player.speed,other.speed*.91);
        else other.speed=Math.min(other.speed,Math.max(3,player.speed*.92));
        this.contactCooldown=.24;
      }
    }
  }
  order() {
    return [...this.cars].sort((a,b)=>{
      if(a.finish!==null&&b.finish!==null)return a.finish-b.finish;
      if(a.finish!==null)return -1;if(b.finish!==null)return 1;
      return b.progress-a.progress;
    });
  }
}
