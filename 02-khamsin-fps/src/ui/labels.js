// 灰盒地图的区域标注：飘在区域上方的名字牌（Sprite），走到哪都能看到这片叫什么。按 L 显示 / 隐藏。
// 以及屏幕左侧的颜色图例（只在灰盒地图里出现）。
import * as THREE from 'three';

function plate(text, big) {
  const fs = big ? 64 : 46, pad = big ? 28 : 20, c = document.createElement('canvas'), g = c.getContext('2d');
  const font = `600 ${fs}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`; g.font = font;
  const w = Math.ceil(g.measureText(text).width) + pad * 2 + 10, h = fs + pad * 1.4;
  c.width = w; c.height = Math.ceil(h); g.font = font;
  g.fillStyle = 'rgba(12,14,17,0.74)'; const r = 12; g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.fill();
  g.fillStyle = big ? '#ffc65a' : '#58e0ff'; g.fillRect(0, 0, 10, h);
  g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.fillText(text, pad + 10, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { t, aspect: w / h };
}

export function addLabels(scene, labels) {
  const group = new THREE.Group(); group.name = 'labels';
  for (const L of labels) {
    const { t, aspect } = plate(L.text, L.big);
    const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false, toneMapped: false });
    const sp = new THREE.Sprite(m); const h = L.big ? 1.5 : 0.95; sp.scale.set(h * aspect, h, 1); sp.position.set(L.x, L.y, L.z); sp.renderOrder = 10;
    group.add(sp);
  }
  scene.add(group);
  return group;
}

export function addLegend(items, colors) {
  const el = document.createElement('div'); el.id = 'protoLegend';
  const hex = (c) => '#' + c.map((v) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0')).join('');
  el.innerHTML = '<b>灰盒 · 颜色图例</b>' + items.map(([k, name]) => `<div><i style="background:${hex(colors[k])}"></i>${name}</div>`).join('') + '<small>L 显示 / 隐藏标注</small>';
  const st = document.createElement('style');
  st.textContent = `#protoLegend { position: absolute; left: 22px; top: 230px; padding: 8px 12px 9px; background: rgba(8, 11, 14, 0.62); border-left: 2px solid var(--amber); font-size: 12px; letter-spacing: 0.06em; line-height: 1.65; z-index: 2; }
#protoLegend b { display: block; font-size: 11px; letter-spacing: 0.2em; opacity: 0.75; margin-bottom: 3px; font-weight: 500; }
#protoLegend i { display: inline-block; width: 11px; height: 11px; margin-right: 8px; vertical-align: -1px; border: 1px solid rgba(0, 0, 0, 0.35); }
#protoLegend small { display: block; margin-top: 4px; opacity: 0.55; font-size: 10px; }
body.nolabels #protoLegend { display: none; } html.touch #protoLegend { display: none; } body.mech #protoLegend { display: none; }`;
  document.head.appendChild(st); document.getElementById('hud').appendChild(el);
  return el;
}
