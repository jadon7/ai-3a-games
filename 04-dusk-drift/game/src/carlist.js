// 车型目录：选车菜单、加载、对手阵容共用这一份
export const CAR_LIST = [
  { id: 'e30', name: 'BMW M3 E30', tag: '均衡 · 好上手', desc: '前置后驱，轴距适中，漂移角度最容易控制。' },
  { id: 'capri', name: 'Ford Capri Gr.5', tag: '大马力 · 宽体', desc: '动力猛、下压力大，出弯一脚油门就甩尾。' },
  { id: 'stratos', name: 'Lancia Stratos', tag: '短轴距 · 灵活', desc: '车身最短，转向极快，也最容易转过头。' },
  { id: 'escort', name: 'Ford Escort RS', tag: '拉力宽体 · 稳', desc: '车身高、悬挂软，侧倾大但很宽容，适合练漂移。' },
  { id: 'p917', name: 'Porsche 917K', tag: '耐力赛原型 · 最快', desc: '车身极低、下压力最大，高速弯能贴着走，甩尾来得突然。' },
  { id: 'l037', name: 'Lancia 037', tag: '中置引擎 · 灵巧', desc: '重心靠后，入弯一点就转，出弯要收着油门。' },
  { id: 'delta', name: 'Lancia Delta HF', tag: '车头重 · 推头', desc: '前重后轻，需要手刹才甩得出去，甩出去后很好控。' },
  { id: 'gt40', name: 'Ford GT40 Mk II', tag: '大排量 · 长直道', desc: '中置 V8，直道尾速高，低速弯要提前减速。' },
  { id: 'mustang', name: 'Ford Mustang 1969', tag: '肌肉车 · 扭矩大', desc: '最重最长，扭矩最大，一给油就冒烟，漂移角度大。' },
  { id: 'countach', name: 'Countach 5000QV', tag: 'V12 · 宽', desc: '车身最宽，抓地好、转向偏重，漂起来很稳。' },
  { id: 'z280', name: 'Datsun 280Z', tag: '轻量直六 · 灵活', desc: '车轻、动力温和，最容易连续漂移。' },
  { id: 's15', name: 'Nissan Silvia S15', tag: '宽体尾翼 · 漂移车', desc: '为漂移改的宽体车，大角度也拉得住。' },
  { id: 'm190', name: 'Mercedes 190E Evo', tag: '房车赛 · 高转速', desc: '高转四缸，换挡要拉满转速，轴距长、走线稳。' },
];
export const CAR_IDS = CAR_LIST.map(c => c.id);
// 菜单背景里跑的演示阵容（开局就加载这几台）
export const ATTRACT_RIVALS = ['capri', 'l037', 'z280', 'm190', 'gt40'];
