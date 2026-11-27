// 导播（阶段 7，网址加 ?director=1，主菜单里叫“观战”）：六个英雄都交给电脑，镜头自己找最值得看的地方。用来直接录成片。
//
// 每隔四分之一秒把场上“有戏”的地方排一遍分：
//   英雄打英雄（两秒半内有人挨了对面英雄的打）分最高，人越多、有人残血分越高；其次是打 Boss、拆塔和打水晶、打野；
//   都没有就轮流看正在对线的英雄。
// 换不换镜头有讲究，不然画面会乱跳：一个镜头至少看两秒半；新的地方得比现在的明显更有戏才换；对线的镜头看久了（十几秒）换下一个人。
// 镜头怎么走：看的点是这场戏里几个英雄的中心，人散得越开拉得越远；离得近就平着摇过去，离得远（四十米以上）直接切。
// 镜头的朝向一直在很慢地左右摆一点，画面不是死的。
// 有人被击杀、Boss 倒下的那一下放慢：一秒多的慢动作，同时推近一点，再回到正常速度。
// 开场先给一个全图的大远景，再落到线上。

import type { Ent, Sim } from "./sim";

export interface Shot { x: number; z: number; dist: number; yaw: number; slow: number; }
interface Cand { key: string; score: number; who: Ent[]; x: number; z: number; base: number; }

export function createDirector(sim: Sim): { update: (dt: number) => Shot; focus: () => string } {
  const D = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  let cur: Cand | null = null, held = 0, think = 0, t = 0, lanePick = 0, side = 0.12, slowT = 0, slowLen = 1, kills = 0, bossDown = 0;
  const cam = { x: 0, z: 0, dist: 86, yaw: 0 }; let first = true;
  const tired = new Map<string, number>();      // 看腻了的镜头（打野、一两个人打 Boss 看了十几秒）：这个时刻之前分数打三折，先去看别处
  const heroes = () => sim.ents.filter(e => e.h && e.alive);
  const hot = (h: Ent) => [...h.h!.hitBy.values()].some(tm => sim.time - tm < 2.5);
  function candidates(): Cand[] {
    const hs = heroes(), out: Cand[] = [], used = new Set<number>();
    // 英雄打英雄：把挨着的凑成一场
    for (const h of hs) { if (used.has(h.id) || !hot(h)) continue; const who = hs.filter(e => D(e, h) < 13); if (!who.some(e => e.team !== h.team)) continue; who.forEach(e => used.add(e.id));
      const low = Math.min(...who.map(e => e.hp / e.max)); out.push({ key: "fight" + who.map(e => e.id).sort().join("-"), score: 5 + who.length * 1.6 + (low < 0.3 ? 2 : 0), who, x: 0, z: 0, base: 23 }); }
    // Boss、野怪
    for (const c of sim.camps) { if (!c.up) continue; const m = c.mobs.find(x => x.alive && x.fight > 0); if (!m) continue; const who = hs.filter(e => D(e, c) < 13); if (!who.length) continue;
      out.push({ key: "camp" + c.id, score: c.kind === "boss" ? 5.5 + who.length : 3.0,      /* 打小野怪 3.0：比普通的对线镜头（最多 2.8）高一点，不然永远轮不到 */ who: [...who, m], x: 0, z: 0, base: c.kind === "boss" ? 30 : 23 }); }
    // 拆塔、打水晶
    for (const b of sim.ents) { if ((b.kind !== "tower" && b.kind !== "core") || !b.alive || sim.time - b.hurtAt > 2) continue; const who = hs.filter(e => D(e, b) < 13); if (!who.some(e => e.team !== b.team)) continue;
      out.push({ key: "siege" + b.id, score: (b.kind === "core" ? 8 : 4) + (b.hp / b.max < 0.3 ? 2 : 0), who: [...who, b], x: 0, z: 0, base: 27 }); }
    // 对线：轮着看
    hs.forEach((h, i) => { const f = sim.fountain[h.team as 0 | 1], home = Math.hypot(h.x - f[0], h.z - f[1]) < 16;      // 在出生点回血、买装备的不拍
      out.push({ key: "lane" + h.id, score: home ? 0.2 : 1 + (i === lanePick % Math.max(1, hs.length) ? 0.8 : 0) + (hs.some(e => e.team !== h.team && D(e, h) < 12) ? 0.6 : 0) + (sim.time - h.hurtAt < 3 ? 0.4 : 0), who: [h], x: 0, z: 0, base: 25 }); });
    for (const c of out) { c.x = c.who.reduce((s, e) => s + e.x, 0) / c.who.length; c.z = c.who.reduce((s, e) => s + e.z, 0) / c.who.length; if ((tired.get(c.key) ?? 0) > t) c.score *= 0.3; }
    return out;
  }
  return { focus: () => cur?.key ?? "",
    update(dt) {
      t += dt; held += dt; think -= dt;
      // 击杀、Boss 倒下：慢动作
      const k = sim.kills[0] + sim.kills[1], bd = sim.teamBuff.beast[0] + sim.teamBuff.beast[1] + sim.teamBuff.troll[0] + sim.teamBuff.troll[1];
      if (k > kills) { kills = k; if (slowT <= 0) { slowT = slowLen = 1.7; } } if (bd !== bossDown) { bossDown = bd; if (t > 1 && slowT <= 0) { slowT = slowLen = 2.2; } }
      if (cur && cur.key.startsWith("camp") && held > (cur.who.filter(e => e.h).length >= 3 ? 22 : 13)) { tired.set(cur.key, t + 12); think = 0; }      // 打野和人少的 Boss 战：看了十几秒就歇十二秒
      if (think <= 0) { think = 0.25; const cs = candidates().sort((a, b) => b.score - a.score), best = cs[0], same = cur ? cs.find(c => c.key === cur!.key && !((tired.get(c.key) ?? 0) > t)) : undefined;      /* 看腻了的那个当它不在，下面就会换走 */
        const laneShot = !!cur && cur.key.startsWith("lane");
        if (best && (!cur || !same || (held > 2.5 && best.key !== cur.key && best.score > same.score + (laneShot ? 0.9 : 1.6)) || (laneShot && held > 13))) {
          if (laneShot && held > 13) lanePick++;
          const nx = (laneShot && held > 13 ? candidates().sort((a, b) => b.score - a.score)[0] : best); if (!cur || nx.key !== cur.key) { held = 0; side = (Math.random() < 0.5 ? -1 : 1) * (0.1 + Math.random() * 0.14); } cur = nx; }
        else if (same) cur = same; }
      if (t < 3.2 || !cur) {      // 开场：全图的大远景
        const kk = 1 - Math.exp(-dt * 1.2); cam.x += (0 - cam.x) * kk; cam.z += (0 - cam.z) * kk; cam.dist += (86 - cam.dist) * kk; cam.yaw = Math.sin(t * 0.2) * 0.1; first = true;
        return { ...cam, slow: 1 }; }
      const spread = Math.max(0, ...cur.who.map(e => D(e, cur!))), slowK = slowT > 0 ? Math.sin(Math.min(1, (slowLen - slowT) / 0.25) * 1.5708) * Math.min(1, slowT / 0.45) : 0;      // 0 到 1：慢动作进出各有一小段过渡
      const wantD = Math.max(21, Math.min(48, cur.base + spread * 1.45)) * (1 - 0.16 * slowK), far = D(cam, cur) > 42;
      if (far || first) { cam.x = cur.x; cam.z = cur.z; cam.dist = wantD * (first ? 1.5 : 1.12); first = false; }      // 离得远：直接切过去（切完带一点点往里推）
      else { const kk = 1 - Math.exp(-dt * (slowK > 0 ? 5 : 2.6)); cam.x += (cur.x - cam.x) * kk; cam.z += (cur.z - cam.z) * kk; }
      cam.dist += (wantD - cam.dist) * (1 - Math.exp(-dt * 1.6)); cam.yaw += (side + Math.sin(t * 0.17) * 0.07 - cam.yaw) * (1 - Math.exp(-dt * 0.9));
      if (slowT > 0) slowT -= dt;
      return { ...cam, slow: 1 - 0.72 * slowK };
    } };
}
