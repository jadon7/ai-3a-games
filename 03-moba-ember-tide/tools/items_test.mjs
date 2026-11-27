#!/usr/bin/env node
// 第九轮装备：在测试场（arena=1）里把每件装备的被动都触发一遍，量数值、和公式对；合成扣配件、付差价、卖掉退钱也查一遍；几个有特效的被动顺手截图。
// 用法: MOBA_URL=http://localhost:5208/map.html node tools/items_test.mjs <输出目录>
// 大部分被动用 __sim.damage 直接造一下“普攻”（物理、不是技能）或者“技能”（skill: true）来触发，这样数值能和公式逐项对上；
// 最后一段让岚真的走过去普攻木桩六秒（暴击、三连、渐狂叠层），再让她真的放一个技能（淬火）。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2] || "/tmp/items_test"; fs.mkdirSync(out, { recursive: true });
const URL = (process.env.MOBA_URL || "http://localhost:5208/map.html") + "?h=lan&arena=1";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
const R = {};
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  await page.goto(URL, { waitUntil: "load" }); await page.waitForFunction("window.__ready === true && window.__arena && window.__items", { timeout: 90000 });
  await new Promise(r => setTimeout(r, 1500));
  // ---- 页面里的小工具和每一项测试 ----
  await page.evaluate(() => {
    const S = __sim, me = S.hero, A = __arena, I = __items, D = A.dummy, F = A.friend, ac = __play.actor;
    const wait = sec => new Promise(r => { const t0 = S.time; const f = () => (S.time - t0 >= sec ? r() : setTimeout(f, 15)); f(); });
    const clear = e => { e.h.items = ["blade"]; I.sell(S, e, 0, true); };
    const give = (e, ...ids) => { clear(e); e.h.gold = 1e6; for (const id of ids) { const r = I.buy(S, e, id, true); if (!r.ok) throw new Error(id + "：" + r.why); } e.h.gold = 0; };
    const fresh = (...es) => { for (const e of es) { e.h.mods.clear(); S.recalc(e); e.hp = e.max; e.shield = e.shieldT = 0; e.stun = e.root = e.slow = e.silence = e.taunt = 0; e.h.hitBy.clear(); } };
    const atk = (t, n, src = me) => S.damage(t, n, src, { type: "phys" });                 // 一下“普攻”：物理、不是技能
    const skill = (t, n, type = "magic", src = me) => S.damage(t, n, src, { type, skill: true });
    const r1 = x => Math.round(x * 10) / 10, mult = res => 100 / (100 + Math.max(0, res));
    const baseAd = e => e.h.base.ad * (1 + 0.085 * (e.h.level - 1)), bonusAd = e => e.h.stat.ad - baseAd(e);
    const near = (e, d) => { const dx = me.x - e.x, dz = me.z - e.z, l = Math.hypot(dx, dz) || 1; ac.teleport(e.x + (dx / l) * d, e.z + (dz / l) * d); };
    const home = { x: me.x, z: me.z };
    const alive = () => new Promise(r => { const f = () => (D.alive ? r() : setTimeout(f, 50)); f(); });
    const T = {
      async 合成与买卖() { const st = [], b = id => { const g0 = me.h.gold, r = I.buy(S, me, id, true); st.push(`${id}：${r.ok ? "付 " + Math.round(g0 - me.h.gold) : "没买成（" + r.why + "）"} → [${me.h.items.join(" ")}]`); return { ok: r.ok, paid: Math.round(g0 - me.h.gold), why: r.why }; };
        clear(me); me.h.gold = 9000; b("blade"); b("blade"); const e = b("edge"), a = b("ambush"); const g0 = me.h.gold; I.sell(S, me, 0, true); const sold = Math.round(me.h.gold - g0); st.push(`卖掉 ambush：退 ${sold}`);
        b("bow"); const inf = b("inferno");
        clear(me); me.h.gold = 9000; b("boots"); const ba = b("boots_ar"), b2 = b("boots");
        clear(me); me.h.gold = 1e5; for (let i = 0; i < 6; i++) b("blade"); const full = b("tome"), merge = b("edge"); const n = me.h.items.length; clear(me);
        return { ok: e.paid === 200 && a.paid === 1600 && sold === 1500 && inf.paid === 2450 && ba.paid === 650 && !b2.ok && !full.ok && merge.ok && n === 5,
          说明: "两把短刃(350×2)合裂甲锥只付 200；有裂甲锥买暗潮獠牙付 2500-900=1600；卖 2500 的退 1500；身上有弩机（黄铜瞄镜的配件）直接买烬焰连弩付 2800-350=2450；有基础鞋买铁砧靴付 650；第二双鞋买不了；六格满了买不了新的，但合成能腾出格子", 过程: st }; },
      async 属性() { give(me, "staff"); const ap = me.h.stat.ap; give(me, "boots_as", "harpoon"); const as = me.h.stat.as, want = me.h.base.as * (1 + 0.02 * (me.h.level - 1)) * 1.5; clear(me);
        return { ok: Math.abs(ap - Math.round((me.h.base.ap + 160) * 1.3)) <= 1 && Math.abs(as - want) < 0.01, 千烛权杖后法强: ap, 应为: Math.round((me.h.base.ap + 160) * 1.3), "疾潮靴+鲸弦急射后攻速": r1(as * 100) / 100, 应为_相加不连乘: r1(want * 100) / 100 }; },
      async 暴击() { give(me, "inferno"); fresh(D); const v = []; for (let i = 0; i < 400; i++) { D.hp = D.max; v.push(atk(D, 200)); } const lo = Math.min(...v), hi = Math.max(...v), nh = v.filter(x => x > lo * 1.5).length;
        return { ok: Math.abs(hi / lo - 2.25) < 0.03 && nh > 50 && nh < 110, 暴击次数: `${nh}/400（暴击率 20%）`, 暴击和普通的比: r1(hi / lo * 100) / 100, 应为: 2.25 }; },
      async 穿甲() { clear(me); fresh(D); const d0 = skill(D, 300, "phys"); await wait(4.5); give(me, "ambush"); fresh(D); const d1 = skill(D, 300, "phys"); await wait(0.1); clear(me);
        return { ok: Math.abs(d1 / d0 - (100 + D.armor) / (100 + D.armor - 18)) < 0.02, 目标护甲: D.armor, 没装备: d0, "暗潮獠牙(18 穿甲)": d1, 比: r1(d1 / d0 * 1000) / 1000, 应为: r1((100 + D.armor) / (100 + D.armor - 18) * 1000) / 1000 }; },
      async 法穿() { clear(me); fresh(D); const d0 = skill(D, 300); give(me, "abyss", "boots_ap"); fresh(D); const d1 = skill(D, 300); await wait(0.1); clear(me); const r2 = Math.max(0, D.mr * 0.75 - 12);
        return { ok: Math.abs(d1 / d0 - (100 + D.mr) / (100 + r2)) < 0.02, 目标魔抗: D.mr, 没装备: d0, "沉渊之眼 25% + 烛影靴 12": d1, 比: r1(d1 / d0 * 1000) / 1000, 应为: r1((100 + D.mr) / (100 + r2) * 1000) / 1000 }; },
      async 淬火三锻() { give(me, "trinity"); fresh(D); await wait(1.6); const d0 = atk(D, 200); S.events.push({ t: "cast", e: me, key: "Q" }); await wait(0.1); const ready = __itemfx.badge(me, "trinity"); const d1 = atk(D, 200), d2 = atk(D, 200), rush = me.h.mods.get("it_rush")?.m.ms; clear(me);
        const want = baseAd(me) * 1.6 * 1.25 * mult(D.armor);
        return { ok: !!ready && Math.abs(d1 - d0 - want) < 3 && d2 === d0 && rush === 0.6, 放技能后装备格亮起: !!ready, 普通一下: d0, 放技能后第一下: d1, 多出: d1 - d0, 应为: Math.round(want), 紧接着下一下: d2, 打中后移速加: rush }; },
      async 伏击() { give(me, "ambush"); fresh(D); await wait(4.3); for (let i = 0; i < 100 && __itemfx.badge(me, "ambush"); i++) await wait(0.1);      /* 前面“穿甲”那一项已经触发过一次，等冷却转好 */ const h0 = D.hp, d = skill(D, 100); await wait(0.12); const extra = h0 - D.hp - d, h1 = D.hp; skill(D, 100); await wait(0.12); const extra2 = h1 - D.hp - d, cd = __itemfx.badge(me, "ambush"); clear(me);
        const want = (80 + 0.4 * (me.h.stat.ad + 65 - baseAd(me))) * 1.25 * 100 / (100 + Math.max(0, D.armor - 18));
        return { ok: Math.abs(extra - want) < 4 && Math.abs(extra2) < 2 && cd && cd.cd > 7, 第一下附带: Math.round(extra), 应为: Math.round(want), "紧接着第二下附带": Math.round(extra2), 冷却: cd && r1(cd.cd) }; },
      async 猎杀() { give(me, "hunter"); await alive(); fresh(D); for (const k of ["Q", "W", "E", "R"]) ac.setCd(k, 9); D.hp = 30; skill(D, 500, "true"); await wait(0.1); const cds = ["Q", "W", "E", "R"].map(k => r1(ac.cdLeft(k))), ms = me.h.mods.get("it_hunt")?.m.msMul; clear(me);
        return { ok: !D.alive && cds[0] === 0 && cds[1] === 0 && cds[2] === 0 && cds[3] > 8 && ms === 1.3, 击杀后QWER冷却: cds.join(" / "), 移速倍数: ms }; },
      async 断首() { give(me, "reaper"); await alive(); fresh(D); D.hp = D.max * 0.09; skill(D, D.max * 0.035 / 1.25, "true"); const left = r1(D.hp / D.max * 100); await wait(0.12); const dead = !D.alive; clear(me);
        return { ok: left < 6 && dead, 打完剩: left + "%", 下一步被斩杀: dead, shot: 1 }; },
      async 浪斩() { give(me, "tide"); const fs = A.foes.filter(f => f.alive); for (const f of fs) f.hp = f.max; const t0 = fs[0], hp0 = fs.map(f => f.hp); atk(t0, 100); await wait(0.12); const lost = fs.map((f, i) => Math.round(hp0[i] - f.hp)), dist = fs.map(f => r1(Math.hypot(f.x - t0.x, f.z - t0.z)));
        const want = Math.round(me.h.stat.ad * 0.4); clear(me); const others = lost.slice(1).filter((x, i) => dist[i + 1] <= 3 + fs[i + 1].r);
        return { ok: others.length > 0 && others.every(x => Math.abs(x - want) <= 1), 被打的小兵掉血: lost[0], 其他小兵离它: dist.slice(1).join(" / "), 其他小兵掉血: lost.slice(1).join(" / "), "溅射应为(40% 攻击)": want }; },
      async 三连() { give(me, "harpoon"); fresh(D); const h = []; for (let i = 0; i < 3; i++) { const h0 = D.hp, d = atk(D, 100); await wait(0.08); h.push(Math.round(h0 - D.hp - d)); if (i === 1) var b2 = __itemfx.badge(me, "harpoon"); } clear(me);
        const want = (50 + 0.5 * (me.h.stat.ad + 30 - baseAd(me))) * 1.25;
        return { ok: Math.abs(h[0]) <= 1 && Math.abs(h[1]) <= 1 && Math.abs(h[2] - want) < 3 && b2?.n === 2, 每一下额外掉血: h.join(" / "), "第三下应为(真伤)": Math.round(want), 第二下后装备格显示: b2?.n }; },
      async 渐狂() { give(me, "fury"); fresh(D); const as0 = me.h.stat.as; for (let i = 0; i < 6; i++) atk(D, 100); const as6 = me.h.stat.as, n6 = __itemfx.badge(me, "fury")?.n; await wait(0.1); const h0 = D.hp, d = atk(D, 100); await wait(0.1); const extra = Math.round(h0 - D.hp - d);
        await wait(3.4); const n0 = __itemfx.badge(me, "fury")?.n ?? 0, asE = me.h.stat.as; clear(me); const want = (30 + 0.15 * (me.h.stat.ad + 35 - baseAd(me))) * 1.25 * 100 / (100 + D.mr);
        return { ok: Math.abs(as6 / as0 - 1.36) < 0.01 && n6 === 6 && Math.abs(extra - want) < 3 && n0 === 0 && Math.abs(asE - as0) < 0.01, 攻速: `${r1(as0 * 100) / 100} → 6 层 ${r1(as6 * 100) / 100}（×${r1(as6 / as0 * 100) / 100}）`, 满层附带: extra, 应为: Math.round(want), "3 秒后层数": n0 }; },
      async 炉膛() { give(me, "furnace"); await alive(); fresh(me, D); near(D, 2); D.h.stat.hpRegen = 0; const h0 = D.hp; await wait(2.05); const lost = h0 - D.hp; const want = 3 * (20 + 0.01 * me.max) * 1.25 * mult(D.mr);      /* 带上的那一刻烧第一跳，之后每秒一跳：2.05 秒是三跳。测的时候把木桩的回血关了 */
        return { ok: Math.abs(lost - want) < want * 0.03, "两秒烧掉": Math.round(lost), "应为(三跳)": Math.round(want), shot: 1, after: () => { ac.teleport(home.x, home.z); clear(me); } }; },
      async 倒刺() { clear(me); give(D, "thorn"); fresh(me, D); const h0 = me.hp; atk(D, 100); await wait(0.1); const lost = h0 - me.hp, chill = me.h.mods.get("it_chill")?.m.asMul; const want = (30 + 0.25 * D.armor) * 1.25 * mult(me.mr);
        give(D, "mail"); fresh(me, D); const h1 = me.hp; atk(D, 100); await wait(0.1); const lost2 = h1 - me.hp, want2 = (15 + 0.1 * D.armor) * 1.25 * mult(me.mr); clear(D); fresh(me, D);
        return { ok: Math.abs(lost - want) < 2 && chill === 0.8 && Math.abs(lost2 - want2) < 2, 鲸骨棘甲反伤: Math.round(lost), 应为: Math.round(want), 打它的人攻速倍数: chill, 铆钉锁甲反伤: Math.round(lost2), 应为_: Math.round(want2) }; },
      async 钟鸣() { give(me, "bulwark"); fresh(me); await wait(0.1); const mx = me.max; me.stun = 1.0; await wait(0.06); const sh = me.shield, stun = me.stun; await wait(1); clear(me); fresh(me);
        return { ok: Math.abs(sh - mx * 0.12) < 2 && stun < 0.82, 被晕后护盾: Math.round(sh), "应为(12% 最大生命)": Math.round(mx * 0.12), "1 秒的眩晕剩(20% 韧性)": r1(stun * 100) / 100 }; },
      async 韧性() { give(me, "boots_mr"); fresh(me); await wait(0.1); me.root = 1.0; await wait(0.06); const r = me.root; await wait(1); clear(me); fresh(me);
        return { ok: r < 0.72 && r > 0.55, "1 秒的定身剩(30% 韧性)": r1(r * 100) / 100 }; },
      async 锚定() { give(me, "anchor"); fresh(me); const mx = me.max; skill(me, me.max * 0.7, "true", D); await wait(0.05); const sh = me.shield, hp = r1(me.hp / me.max * 100), cd = __itemfx.badge(me, "anchor"); clear(me); fresh(me);
        return { ok: Math.abs(sh - mx * 0.25) < 2 && cd?.cd > 40, 挨打后血量: hp + "%", 护盾: Math.round(sh), "应为(25% 最大生命)": Math.round(mx * 0.25), 冷却: cd && r1(cd.cd) }; },
      async 回潮() { give(me, "scale"); fresh(me); skill(me, 100, "magic", D); const m = me.h.mods.get("it_scale"); clear(me); fresh(me);
        return { ok: m?.m.hpRegen === 0.01 && m.left > 4.5, 挨英雄打后回血加成: m && m.m.hpRegen, 持续: m && r1(m.left) }; },
      async 砧面() { clear(me); fresh(me); const f = A.foes.find(x => x.alive); const d0 = atk(me, 300, f); give(me, "boots_ar"); fresh(me); const d1 = atk(me, 300, f), want = 300 * mult(me.armor) * 0.9; clear(me); fresh(me);
        return { ok: Math.abs(d1 - want) < 2, 没鞋时小兵一下: d0, "铁砧靴(护甲+25、普攻少一成)": d1, 应为: Math.round(want) }; },
      async 余烬() { give(me, "ember"); await alive(); fresh(D); D.h.stat.hpRegen = 0; const h0 = D.hp, d = skill(D, 50); await wait(3.25); const burn = h0 - D.hp - d, want = 6 * 0.5 * (20 + 0.012 * D.max) * 1.25 * mult(D.mr); clear(me);
        return { ok: Math.abs(burn - want) < 4, "三秒烧掉": Math.round(burn), 应为: Math.round(want) }; },
      async 回响() { give(me, "abyss"); await alive(); fresh(D); await wait(0.1); const fs = A.foes.filter(x => x.alive); for (const f of fs) f.hp = f.max; const h0 = D.hp, d = skill(D, 50); await wait(0.1); const extra = h0 - D.hp - d;
        const hit = fs.filter(f => f.hp < f.max).map(f => r1(Math.hypot(f.x - D.x, f.z - D.z))); const ap = me.h.stat.ap, r2 = Math.max(0, D.mr * 0.75), want = (70 + 0.15 * ap) * 1.25 * mult(r2);
        return { ok: Math.abs(extra - want) < 3 && hit.length >= 1 && hit.length <= 2, 主目标附带: Math.round(extra), 应为: Math.round(want), "弹到的小兵(离主目标几米)": hit.join(" / "), shot: 1, after: () => clear(me) }; },
      async 护潮() { give(me, "locket"); fresh(F); F.hp = F.max * 0.3; await wait(0.6); const sh = F.shield, want = 180 + 25 * me.h.level, d = r1(Math.hypot(F.x - me.x, F.z - me.z)); F.hp = F.max * 0.45;
        return { ok: Math.abs(sh - want) < 1, 队友离我: d + " 米", "队友 30% 血时得到护盾": Math.round(sh), 应为: want, shot: 1, after: () => clear(me) }; },
      async 涌浪() { give(me, "horn"); fresh(me, F); S.events.push({ t: "cast", e: me, key: "Q" }); await wait(0.1); const m = F.h.mods.get("it_surge")?.m, mine = me.h.mods.has("it_surge"); clear(me);
        return { ok: m?.asMul === 1.25 && m?.ms === 0.8 && !mine, 队友得到: m && `攻速 ×${m.asMul}，移速 +${m.ms}`, 自己没有: !mine }; },
      async 庇护() { give(me, "banner"); fresh(F); const a0 = F.armor, m0 = F.mr; await wait(0.6); const a1 = F.armor, m1 = F.mr; clear(me); await wait(1.2); fresh(F);
        return { ok: a1 - a0 === 15 && m1 - m0 === 15, 队友护甲: `${r1(a0)} → ${r1(a1)}`, 队友魔抗: `${r1(m0)} → ${r1(m1)}` }; },
      async 涨潮() { give(me, "great"); fresh(me); const f = A.foes.find(x => x.alive); f.hp = f.max; atk(f, 50); const m = me.h.mods.get("it_rush")?.m.ms; clear(me); fresh(me);
        return { ok: m === 0.5, 普攻打中后移速加: m }; },
      // ---- 真打：岚带烬焰连弩、鲸弦急射、怒潮弩机走过去普攻木桩 6 秒 ----
      async 真打() { give(me, "inferno", "harpoon", "fury"); await alive(); fresh(me, D); D.h.mods.clear(); const rec = [], orig = S.damage;
        S.damage = (e, n, src, o) => { const r = orig(e, n, src, o); if (src === me && e === D) rec.push({ n: r, big: !!(o && o.big), skill: !!(o && o.skill), type: o && o.type }); return r; };
        ac.attack(D); let maxStack = 0; const t0 = S.time; while (S.time - t0 < 6) { await wait(0.1); D.hp = Math.max(D.hp, D.max * 0.5); maxStack = Math.max(maxStack, __itemfx.badge(me, "fury")?.n ?? 0); }
        S.damage = orig; const atks = rec.filter(x => !x.skill), crits = atks.filter(x => x.big).length, trues = rec.filter(x => x.skill && x.type === "true").length, furyHits = rec.filter(x => x.skill && x.type === "magic").length;
        return { ok: atks.length >= 10 && crits > 0 && trues >= Math.floor(atks.length / 3) - 1 && maxStack === 6 && furyHits > 0, 普攻次数: atks.length, 暴击: crits, 三连真伤次数: trues, 渐狂最高层数: maxStack, 满层附带魔法伤害次数: furyHits, shot: 1, after: () => { ac.stop(); ac.teleport(home.x, home.z); clear(me); } }; },
      async 真放技能() { give(me, "trinity"); await alive(); fresh(me, D); near(D, 1.5); await wait(1.6); ac.setCd("W", 0); ac.cast("W"); await wait(0.4); const ready = !!__itemfx.badge(me, "trinity"); let big = 0, orig = S.damage;
        S.damage = (e, n, src, o) => { const r = orig(e, n, src, o); if (src === me && e === D && !(o && o.skill)) big = Math.max(big, r); return r; }; ac.attack(D); await wait(1.2); S.damage = orig; ac.stop(); ac.teleport(home.x, home.z); clear(me);
        return { ok: ready && big > 0, 放了潮隐以后装备格亮起: ready, 下一下普攻: big }; },
    };
    window.__T = { names: Object.keys(T), async run(n) { await alive(); const r = await T[n](); window.__after = r.after; delete r.after; return r; }, after() { window.__after?.(); window.__after = null; } };
  });
  const names = await page.evaluate(() => __T.names);
  for (const n of names) {
    const r = await page.evaluate(n => __T.run(n), n).catch(e => ({ ok: false, err: String(e).slice(0, 300) }));
    if (r.shot) { await page.screenshot({ path: `${out}/${n}.jpg`, type: "jpeg", quality: 88 }); delete r.shot; }
    await page.evaluate(() => __T.after()); R[n] = r; console.log((r.ok ? "过  " : "没过") + " " + n, JSON.stringify(r));
  }
  R.errors = errors.slice(0, 8);
} finally { await browser.close(); }
fs.writeFileSync(`${out}/result.json`, JSON.stringify(R, null, 1));
const bad = Object.entries(R).filter(([k, v]) => k !== "errors" && !v.ok).map(([k]) => k);
console.log(`\n${Object.keys(R).length - 1} 项，没过 ${bad.length} 项${bad.length ? "：" + bad.join("、") : ""}；报错 ${R.errors.length} 条`);
