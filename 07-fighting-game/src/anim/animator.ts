import * as THREE from 'three';

interface Layer { name: string; action: THREE.AnimationAction; alpha: number; fade: number; time: number; loop: boolean }

/**
 * 动作播放器。时间完全由外面给（模拟帧 → 动作时间），不让 mixer 自己走：
 * 这样顿帧、慢动作、分段变速都只是“给哪个时间”的问题。
 * 切动作时新动作压在旧动作上面淡入，旧动作停在原地。
 */
export class Animator {
  readonly mixer: THREE.AnimationMixer;
  private pool = new Map<string, THREE.AnimationAction[]>();
  private layers: Layer[] = [];
  private flip = new Map<string, number>();

  constructor(root: THREE.Object3D, readonly clips: Record<string, THREE.AnimationClip>) {
    this.mixer = new THREE.AnimationMixer(root);
  }

  has(name: string) { return !!this.clips[name]; }
  duration(name: string) { return this.clips[name]?.duration ?? 0; }
  get current() { return this.layers.length ? this.layers[this.layers.length - 1] : null; }
  get currentName() { return this.current?.name ?? ''; }

  /** 同一段动作准备两份，这样“自己接自己”（连按同一招）也能交叉淡入。 */
  private acquire(name: string): THREE.AnimationAction | null {
    const clip = this.clips[name];
    if (!clip) return null;
    let arr = this.pool.get(name);
    if (!arr) {
      const a = this.mixer.clipAction(clip);
      const b = this.mixer.clipAction(clip.clone());
      for (const x of [a, b]) { x.setLoop(THREE.LoopRepeat, Infinity); x.clampWhenFinished = false; x.play(); x.setEffectiveWeight(0); }
      arr = [a, b];
      this.pool.set(name, arr);
    }
    const i = ((this.flip.get(name) ?? 0) + 1) % 2;
    this.flip.set(name, i);
    return arr[i];
  }

  /** 切到 name，从 time 开始，fade 秒淡入。loop 的动作时间自动取模，不 loop 的夹在首尾。 */
  play(name: string, fade = 0.1, time = 0, loop = false): boolean {
    const action = this.acquire(name);
    if (!action) return false;
    // 被复用的那份如果还在淡出队列里，先拿掉
    this.layers = this.layers.filter((l) => l.action !== action);
    this.layers.push({ name, action, alpha: fade <= 0 || this.layers.length === 0 ? 1 : 0, fade: Math.max(fade, 1e-4), time, loop });
    return true;
  }

  setTime(t: number) { const c = this.current; if (c) c.time = t; }
  getTime() { return this.current?.time ?? 0; }

  /** 推进淡入并求值。dt 是真实经过的时间（淡入不受顿帧影响时传真实值，受影响就传缩放过的）。 */
  update(dt: number) {
    const ls = this.layers;
    for (const l of ls) if (l.alpha < 1) l.alpha = Math.min(1, l.alpha + dt / l.fade);
    // 上面的层盖住下面的层：权重 = 自己的 alpha × 上面所有层的 (1 - alpha)
    let remain = 1;
    for (let i = ls.length - 1; i >= 0; i--) {
      const l = ls[i];
      const w = l.alpha * remain;
      remain *= 1 - l.alpha;
      const dur = l.action.getClip().duration;
      let t = l.time;
      if (l.loop) { t = dur > 0 ? ((t % dur) + dur) % dur : 0; } else t = Math.min(Math.max(t, 0), Math.max(dur - 1e-4, 0));
      l.action.time = t;
      l.action.setEffectiveWeight(w);
      (l as any)._w = w;
    }
    // 被完全盖住的层拿掉
    for (let i = ls.length - 2; i >= 0; i--) {
      if ((ls[i] as any)._w < 0.002 && ls[ls.length - 1].alpha >= 1) { ls[i].action.setEffectiveWeight(0); ls.splice(i, 1); }
    }
    if (ls.length > 5) { const dead = ls.splice(0, ls.length - 5); for (const d of dead) d.action.setEffectiveWeight(0); }
    this.mixer.update(0);
  }

  /** 离线采样：把骨架摆到 name 的 t 时刻（不影响播放队列，采完要自己再 update 一次）。 */
  pose(name: string, t: number) {
    for (const arr of this.pool.values()) for (const a of arr) a.setEffectiveWeight(0);
    const clip = this.clips[name];
    if (!clip) return false;
    let arr = this.pool.get(name);
    if (!arr) { this.acquire(name); arr = this.pool.get(name)!; }
    arr[0].time = Math.min(Math.max(t, 0), clip.duration - 1e-4);
    arr[0].setEffectiveWeight(1);
    this.mixer.update(0);
    arr[0].setEffectiveWeight(0);
    return true;
  }
}
