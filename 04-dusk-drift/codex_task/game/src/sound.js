export class MotorSound {
  constructor(){this.enabled=false;}
  async toggle() {
    if(!this.context){
      this.context=new AudioContext();const ac=this.context;
      this.master=ac.createGain();this.master.gain.value=0;this.master.connect(ac.destination);
      this.filter=ac.createBiquadFilter();this.filter.type='lowpass';this.filter.Q.value=.65;this.filter.connect(this.master);
      this.motor=[0,1].map(i=>{const o=ac.createOscillator(),g=ac.createGain();o.type=i?'sawtooth':'triangle';g.gain.value=i?.095:.17;o.connect(g).connect(this.filter);o.start();return o;});
      const buffer=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),out=buffer.getChannelData(0);
      let v=0;for(let i=0;i<out.length;i++){v=.56*v+.44*(Math.random()*2-1);out[i]=v;}
      const source=ac.createBufferSource();source.buffer=buffer;source.loop=true;
      const hp=ac.createBiquadFilter();hp.type='highpass';hp.frequency.value=1450;
      this.tyre=ac.createGain();this.tyre.gain.value=0;source.connect(hp).connect(this.tyre).connect(this.master);source.start();
    }
    this.enabled=!this.enabled;
    if(this.enabled)await this.context.resume();
    this.master.gain.setTargetAtTime(this.enabled?.39:0,this.context.currentTime,.04);
    return this.enabled;
  }
  update(rpm,speed,slide,paused){
    if(!this.context||!this.enabled)return;
    const t=this.context.currentTime;
    this.master.gain.setTargetAtTime(paused?0:.39,t,.045);
    this.motor[0].frequency.setTargetAtTime(rpm/60,t,.05);this.motor[1].frequency.setTargetAtTime(rpm/30*1.005,t,.055);
    this.filter.frequency.setTargetAtTime(350+rpm*.17,t,.08);
    this.tyre.gain.setTargetAtTime(slide?.37:Math.min(.10,Math.abs(speed)*.002),t,.08);
  }
}
