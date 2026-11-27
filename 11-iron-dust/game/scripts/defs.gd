extends RefCounted
# Weapon, equipment and frame data. All designs are original.
# Weapon keys: kind bullet/shell/missile/pellet/rocket/beam, model = node in models/equip.glb, wt = load weight.
# "charge": hold to charge, release to fire.  kind "beam": sustained beam with a heat gauge.
# "brace": seconds the frame must stand planted before the weapon fires (stationary fire).
# "rec": recovery after the shot (no other attack, slowed) - a boost / quick boost cancels it.
# "sub": id of an under-barrel weapon (key B).  "bayonet": melee becomes a rifle thrust while held.
# kind "hook": wire anchor, a melee-type attack (ignores shields, staggers, reels the user in).

const WEAPONS := {
	# --- hand weapons ---
	"ar90": {"name": "90mm 突击步炮", "tag": "AR-90", "kind": "bullet", "dmg": 105.0, "impact": 8.0, "rof": 5.5, "mag": 36, "reload": 2.6, "speed": 520.0, "range": 520.0, "spread": 0.012, "sfx": "rifle", "recoil": 0.5, "model": "g_rifle", "gun": "rifle", "wt": 3.0, "info": "均衡的中距离连射武器"},
	"gat35": {"name": "35mm 转管机炮", "tag": "GAT-35", "kind": "bullet", "dmg": 52.0, "impact": 4.0, "rof": 15.0, "mag": 180, "reload": 3.6, "speed": 560.0, "range": 480.0, "spread": 0.022, "sfx": "gatling", "recoil": 0.3, "model": "g_gatling", "gun": "gatling", "wt": 5.0, "info": "高射速持续压制，精度低"},
	"smg": {"name": "60mm 冲锋机炮", "tag": "SMG-60", "kind": "bullet", "dmg": 60.0, "impact": 6.0, "rof": 11.0, "mag": 50, "reload": 2.0, "speed": 480.0, "range": 340.0, "spread": 0.03, "sfx": "smg", "recoil": 0.35, "model": "g_smg", "gun": "smg", "wt": 2.0, "info": "轻量近距离速射"},
	"sg": {"name": "霰弹炮", "tag": "SG-8", "kind": "pellet", "dmg": 95.0, "impact": 14.0, "pellets": 10, "rof": 0.9, "mag": 6, "reload": 3.2, "speed": 420.0, "range": 170.0, "spread": 0.07, "sfx": "shotgun", "recoil": 0.9, "shake": 0.3, "model": "g_shotgun", "gun": "shotgun", "wt": 3.0, "rec": 0.45, "info": "贴身一发打出硬直"},
	"crl": {"name": "聚能轨道步炮", "tag": "CRL-7", "kind": "bullet", "dmg": 240.0, "impact": 26.0, "rof": 1.2, "mag": 8, "reload": 4.2, "speed": 950.0, "range": 760.0, "spread": 0.003, "sfx": "rail", "recoil": 0.9, "shake": 0.2, "model": "g_charge", "gun": "rifle", "wt": 4.0,
		"charge": {"t": 1.5, "mul": 4.4, "imp": 4.6, "splash": 5.0}, "info": "蓄力武器：按住蓄能，松开发射。满蓄一发硬直"},
	"lance": {"name": "熔切照射器", "tag": "LANCE-3", "kind": "beam", "dmg": 980.0, "impact": 30.0, "rof": 1.0, "mag": 1, "reload": 3.4, "speed": 9999.0, "range": 430.0, "spread": 0.0, "heat": 4.2, "sfx": "beam", "recoil": 0.15, "model": "g_beam", "gun": "rifle", "wt": 5.0, "info": "照射武器：持续光束，过热后强制冷却"},
	"srl": {"name": "长程狙击步炮", "tag": "SRL-12", "kind": "bullet", "dmg": 640.0, "impact": 60.0, "rof": 0.55, "mag": 5, "reload": 4.6, "speed": 1400.0, "range": 980.0, "spread": 0.0008, "sfx": "rail", "recoil": 1.1, "shake": 0.3, "model": "g_sniper", "gun": "rifle", "wt": 5.0, "brace": 0.35, "rec": 0.5, "info": "站定射击：落地停稳才能开火，射程最远"},
	"arg": {"name": "突击步炮·榴弹型", "tag": "AR-90G", "kind": "bullet", "dmg": 100.0, "impact": 8.0, "rof": 5.0, "mag": 30, "reload": 2.8, "speed": 520.0, "range": 500.0, "spread": 0.013, "sfx": "rifle", "recoil": 0.5, "model": "g_brg", "gun": "rifle", "wt": 4.0, "sub": "ugl", "bayonet": true, "info": "下挂榴弹（B）；持枪时格斗变为枪刺突刺"},
	"ugl": {"name": "下挂榴弹", "tag": "UGL-120", "kind": "shell", "dmg": 560.0, "impact": 75.0, "rof": 0.4, "mag": 3, "reload": 7.0, "speed": 170.0, "range": 320.0, "spread": 0.01, "splash": 9.0, "grav": 9.0, "sfx": "grenade", "recoil": 0.8, "shake": 0.3, "rec": 0.4},
	"cbr": {"name": "缆供重型照射炮", "tag": "CBR-5", "kind": "beam", "dmg": 1500.0, "impact": 40.0, "rof": 1.0, "mag": 1, "reload": 4.0, "speed": 9999.0, "range": 600.0, "spread": 0.0, "heat": 3.6, "sfx": "beam", "recoil": 0.2, "model": "g_cbeam", "gun": "rifle", "wt": 6.0, "brace": 0.3, "info": "站定照射：威力与射程高于熔切照射器"},
	"anchor": {"name": "钢缆钩锁", "tag": "ANCHOR", "kind": "hook", "dmg": 380.0, "impact": 999.0, "rof": 2.0, "mag": 1, "reload": 4.5, "speed": 280.0, "range": 150.0, "spread": 0.0, "sfx": "hook", "recoil": 0.6, "model": "h_anchor", "arm_mount": true, "wt": 2.0, "info": "格斗性质：无视臂盾，命中即硬直并把自己拉向目标；打中地形可牵引移动"},
	"m2r": {"name": "光束步炮", "tag": "BR-22", "kind": "bullet", "dmg": 460.0, "impact": 34.0, "rof": 1.0, "mag": 8, "reload": 3.6, "speed": 980.0, "range": 720.0, "spread": 0.002, "sfx": "beam_rifle", "recoil": 0.8, "shake": 0.15, "model": "g_m2rifle", "gun": "rifle", "wt": 3.0, "bolt": [0.8, 22.0], "tracer": Color(4.2, 1.2, 2.6), "rec": 0.0, "info": "光束步炮：每秒一发的精确射击，单发中等伤害，弹速快"},
	"twin_cn": {"name": "背部双联加农", "tag": "TWIN CANNON", "kind": "shell", "dmg": 880.0, "impact": 90.0, "rof": 0.4, "mag": 2, "salvo": 2, "gap": 0.22, "reload": 5.4, "speed": 300.0, "range": 680.0, "spread": 0.004, "splash": 10.0, "grav": 3.0, "sfx": "cannon", "recoil": 1.2, "shake": 0.6, "model": "", "back": "howitzer", "wt": 0.0, "brace": 0.35, "rec": 0.8, "info": "机体固定武装。站定射击：两发齐射"},
	# --- back weapons (right) ---
	"bz240": {"name": "240mm 无后坐力炮", "tag": "RCL-240", "kind": "shell", "dmg": 1150.0, "impact": 110.0, "rof": 0.25, "mag": 1, "reload": 4.6, "speed": 260.0, "range": 480.0, "spread": 0.004, "splash": 11.0, "grav": 4.0, "sfx": "cannon", "recoil": 1.0, "shake": 0.5, "model": "b_bazooka", "back": "bazooka", "wt": 5.0, "rec": 0.8, "info": "命中即硬直的重火力"},
	"how180": {"name": "180mm 榴弹炮", "tag": "HOW-180", "kind": "shell", "dmg": 1600.0, "impact": 130.0, "rof": 0.2, "mag": 1, "reload": 5.2, "speed": 230.0, "range": 600.0, "spread": 0.003, "splash": 16.0, "grav": 5.0, "sfx": "cannon", "recoil": 1.3, "shake": 0.8, "model": "b_howitzer", "back": "howitzer", "wt": 7.0, "brace": 0.4, "rec": 0.9, "info": "站定射击：大范围毁伤，弹道弯曲"},
	"rail": {"name": "重型磁轨炮", "tag": "HRC-400", "kind": "shell", "dmg": 700.0, "impact": 60.0, "rof": 0.3, "mag": 1, "reload": 6.0, "speed": 1500.0, "range": 900.0, "spread": 0.001, "splash": 5.0, "sfx": "rail", "recoil": 1.5, "shake": 0.9, "model": "b_rail", "back": "howitzer", "wt": 8.0, "brace": 0.5, "rec": 0.9,
		"charge": {"t": 2.2, "mul": 4.0, "imp": 3.0, "splash": 9.0}, "info": "站定蓄力：超远距离，满蓄贯穿装甲"},
	# --- back weapons (left) ---
	"ms6": {"name": "6连装导弹", "tag": "MSL-6", "kind": "missile", "dmg": 330.0, "impact": 22.0, "rof": 0.5, "mag": 6, "salvo": 6, "gap": 0.11, "reload": 11.0, "speed": 210.0, "range": 650.0, "turn": 1.9, "splash": 6.0, "lock": 1.0, "sfx": "missile", "model": "b_pod6", "pod": "pod", "wt": 4.0, "info": "锁定后齐射，对空有效"},
	"ms12": {"name": "12连装微型导弹", "tag": "MML-12", "kind": "missile", "dmg": 190.0, "impact": 12.0, "rof": 0.5, "mag": 12, "salvo": 12, "gap": 0.07, "reload": 13.0, "speed": 230.0, "range": 600.0, "turn": 2.3, "splash": 5.0, "lock": 1.3, "sfx": "missile", "model": "b_pod12", "pod": "pod", "wt": 5.0, "info": "饱和打击"},
	"rkt": {"name": "4连装火箭", "tag": "RKT-4", "kind": "rocket", "dmg": 420.0, "impact": 40.0, "rof": 0.5, "mag": 4, "salvo": 4, "gap": 0.13, "reload": 8.0, "speed": 300.0, "range": 500.0, "spread": 0.02, "splash": 8.0, "sfx": "missile", "model": "b_rockets", "pod": "rockets", "wt": 3.0, "info": "无需锁定的直射火箭"},
	# --- enemy ---
	"e_ar": {"name": "突击步炮", "tag": "E-AR", "kind": "bullet", "dmg": 58.0, "impact": 4.5, "rof": 3.6, "mag": 24, "reload": 3.0, "speed": 400.0, "range": 420.0, "spread": 0.028, "sfx": "rifle", "recoil": 0.5, "model": "g_brifle", "gun": "rifle"},
	"e_bz": {"name": "火箭筒", "tag": "E-BZ", "kind": "shell", "dmg": 520.0, "impact": 70.0, "rof": 0.16, "mag": 1, "reload": 6.0, "speed": 190.0, "range": 420.0, "spread": 0.02, "splash": 10.0, "grav": 3.0, "sfx": "cannon", "recoil": 1.0, "model": "b_bazooka", "back": "bazooka"},
	"e_ms": {"name": "导弹", "tag": "E-MS", "kind": "missile", "dmg": 170.0, "impact": 14.0, "rof": 0.3, "mag": 4, "salvo": 4, "gap": 0.16, "reload": 12.0, "speed": 170.0, "range": 520.0, "turn": 1.4, "splash": 5.0, "lock": 1.5, "sfx": "missile", "model": "b_pod6", "pod": "pod"},
	"e_gat": {"name": "机炮", "tag": "E-GAT", "kind": "bullet", "dmg": 34.0, "impact": 3.0, "rof": 9.0, "mag": 60, "reload": 3.5, "speed": 430.0, "range": 420.0, "spread": 0.04, "sfx": "gatling", "recoil": 0.3, "model": "g_gatling", "gun": "gatling"},
	"e_br": {"name": "战斗步炮", "tag": "E-BR", "kind": "bullet", "dmg": 78.0, "impact": 8.0, "rof": 6.0, "mag": 30, "reload": 2.2, "speed": 470.0, "range": 460.0, "spread": 0.022, "sfx": "rifle", "recoil": 0.5, "model": "g_brifle", "gun": "rifle"},
	"e_sg": {"name": "霰弹炮", "tag": "E-SG", "kind": "pellet", "dmg": 60.0, "impact": 12.0, "pellets": 9, "rof": 0.7, "mag": 4, "reload": 4.0, "speed": 380.0, "range": 150.0, "spread": 0.08, "sfx": "shotgun", "recoil": 0.9, "model": "g_shotgun", "gun": "shotgun"},
	"e_crl": {"name": "聚能步炮", "tag": "E-CRL", "kind": "bullet", "dmg": 120.0, "impact": 14.0, "rof": 0.8, "mag": 6, "reload": 4.5, "speed": 700.0, "range": 620.0, "spread": 0.008, "sfx": "rail", "recoil": 0.9, "model": "g_charge", "gun": "rifle", "charge": {"t": 1.8, "mul": 3.6, "imp": 4.0, "splash": 4.0}},
	"e_lance": {"name": "照射器", "tag": "E-LNC", "kind": "beam", "dmg": 300.0, "impact": 16.0, "rof": 1.0, "mag": 1, "reload": 4.0, "speed": 9999.0, "range": 330.0, "spread": 0.0, "heat": 2.6, "sfx": "beam", "recoil": 0.1, "model": "g_beam", "gun": "rifle"},
	"e_brg": {"name": "刺刀步炮", "tag": "E-BRG", "kind": "bullet", "dmg": 78.0, "impact": 8.0, "rof": 6.0, "mag": 30, "reload": 2.2, "speed": 470.0, "range": 460.0, "spread": 0.022, "sfx": "rifle", "recoil": 0.5, "model": "g_brg", "gun": "rifle", "sub": "e_gl", "bayonet": true},
	"e_gl": {"name": "下挂榴弹", "tag": "E-GL", "kind": "shell", "dmg": 320.0, "impact": 60.0, "rof": 0.25, "mag": 2, "reload": 9.0, "speed": 160.0, "range": 300.0, "spread": 0.02, "splash": 8.0, "grav": 8.0, "sfx": "grenade", "recoil": 0.8},
	"e_arm": {"name": "臂装三联火箭", "tag": "E-ARM", "kind": "rocket", "dmg": 150.0, "impact": 22.0, "rof": 0.35, "mag": 3, "salvo": 3, "gap": 0.14, "reload": 5.0, "speed": 260.0, "range": 340.0, "spread": 0.03, "splash": 6.0, "sfx": "missile", "model": "g_armgun", "gun": "smg"},
	"e_hbz": {"name": "重型火箭筒", "tag": "E-HBZ", "kind": "shell", "dmg": 600.0, "impact": 85.0, "rof": 0.2, "mag": 1, "reload": 5.0, "speed": 200.0, "range": 460.0, "spread": 0.016, "splash": 11.0, "grav": 3.0, "sfx": "cannon", "recoil": 1.1, "shake": 0.4, "model": "g_m3bazooka", "gun": "rifle"},
	"e_tube": {"name": "单管火箭", "tag": "E-RKT", "kind": "rocket", "dmg": 190.0, "impact": 26.0, "rof": 0.6, "mag": 2, "reload": 4.5, "speed": 280.0, "range": 340.0, "spread": 0.025, "splash": 6.0, "sfx": "missile", "recoil": 0.6, "model": "g_m4tube", "gun": "rifle"},
	# beam machine gun: one pull = a five-bolt burst that empties the cells, "reload" is the cooling time
	"e_bmg": {"name": "光束机枪", "tag": "E-BMG", "kind": "bullet", "dmg": 82.0, "impact": 9.0, "rof": 2.0, "mag": 5, "salvo": 5, "gap": 0.1, "reload": 2.3, "cool": true, "speed": 760.0, "range": 520.0, "spread": 0.014, "sfx": "beam_rifle", "pitch": 1.3, "vol": 0.7, "recoil": 0.35, "model": "g_bmg", "gun": "rifle", "bolt": [0.42, 13.0], "tracer": Color(4.2, 1.0, 2.4), "rec": 0.0},
	# --- captured frames: the enemy's own guns at the player's grade ---
	"c_ar": {"name": "缴获突击步炮", "tag": "C-AR", "kind": "bullet", "dmg": 96.0, "impact": 7.5, "rof": 5.2, "mag": 30, "reload": 2.6, "speed": 500.0, "range": 480.0, "spread": 0.015, "sfx": "rifle", "recoil": 0.5, "model": "g_brifle", "gun": "rifle", "wt": 3.0, "info": "敌制式步炮，性能略逊于 AR-90"},
	"c_bmg": {"name": "光束机枪", "tag": "BMG-5", "kind": "bullet", "dmg": 165.0, "impact": 13.0, "rof": 2.0, "mag": 5, "salvo": 5, "gap": 0.09, "reload": 1.7, "cool": true, "speed": 900.0, "range": 600.0, "spread": 0.006, "sfx": "beam_rifle", "pitch": 1.3, "vol": 0.7, "recoil": 0.35, "shake": 0.06, "model": "g_bmg", "gun": "rifle", "wt": 4.0, "bolt": [0.42, 13.0], "tracer": Color(4.2, 1.0, 2.4), "rec": 0.0, "info": "点射武器：按一次五连发，打完强制冷却后才能再射"},
	"c_arm": {"name": "臂装三联火箭", "tag": "C-ARM", "kind": "rocket", "dmg": 330.0, "impact": 34.0, "rof": 0.4, "mag": 3, "salvo": 3, "gap": 0.14, "reload": 4.6, "speed": 280.0, "range": 380.0, "spread": 0.024, "splash": 7.0, "sfx": "missile", "recoil": 0.7, "model": "g_armgun", "gun": "smg", "wt": 3.0, "info": "三发齐射的直射火箭，近中距离打硬直"},
	"c_hbz": {"name": "重型火箭筒", "tag": "C-HBZ", "kind": "shell", "dmg": 1050.0, "impact": 105.0, "rof": 0.22, "mag": 1, "reload": 4.8, "speed": 230.0, "range": 470.0, "spread": 0.008, "splash": 11.0, "grav": 3.5, "sfx": "cannon", "recoil": 1.1, "shake": 0.5, "model": "g_m3bazooka", "gun": "rifle", "wt": 6.0, "info": "手持重火力，命中即硬直；单发装填"},
	"c_tube": {"name": "单管火箭", "tag": "C-RKT", "kind": "rocket", "dmg": 400.0, "impact": 38.0, "rof": 0.7, "mag": 2, "reload": 4.0, "speed": 300.0, "range": 380.0, "spread": 0.018, "splash": 7.0, "sfx": "missile", "recoil": 0.6, "model": "g_m4tube", "gun": "rifle", "wt": 3.0, "info": "两发装的直射火箭"},
	"t_how": {"name": "榴弹炮", "tag": "HOW", "kind": "shell", "dmg": 480.0, "impact": 55.0, "rof": 0.2, "mag": 1, "reload": 5.0, "speed": 150.0, "range": 620.0, "spread": 0.03, "splash": 14.0, "grav": 9.0, "sfx": "cannon"},
	"t_gun": {"name": "坦克炮", "tag": "GUN", "kind": "shell", "dmg": 230.0, "impact": 22.0, "rof": 0.3, "mag": 1, "reload": 3.4, "speed": 240.0, "range": 420.0, "spread": 0.02, "splash": 6.0, "grav": 3.0, "sfx": "cannon"},
	# --- aircraft / emplacements ---
	"f_gun": {"name": "机炮", "tag": "F-GUN", "kind": "bullet", "dmg": 30.0, "impact": 2.5, "rof": 14.0, "mag": 40, "reload": 4.0, "speed": 520.0, "range": 520.0, "spread": 0.03, "sfx": "gatling"},
	"f_rkt": {"name": "火箭巢", "tag": "F-RKT", "kind": "rocket", "dmg": 200.0, "impact": 24.0, "rof": 0.4, "mag": 4, "salvo": 4, "gap": 0.12, "reload": 9.0, "speed": 320.0, "range": 560.0, "spread": 0.03, "splash": 7.0, "sfx": "missile"},
	"aa_gun": {"name": "双联高炮", "tag": "AA-57", "kind": "bullet", "dmg": 28.0, "impact": 3.0, "rof": 7.0, "mag": 40, "reload": 3.0, "speed": 760.0, "range": 900.0, "spread": 0.02, "sfx": "smg", "flak": 0.4, "tracer": Color(3.2, 1.1, 2.0)},
	"pd_gun": {"name": "点防御炮", "tag": "PD", "kind": "bullet", "dmg": 42.0, "impact": 3.0, "rof": 8.0, "mag": 30, "reload": 3.5, "speed": 520.0, "range": 700.0, "spread": 0.035, "sfx": "rifle"},
}

# destructible arm shields: hp, arc = half-angle (deg) covered around the shield facing
const SHIELDS := {
	"s_buckler": {"name": "轻型格挡盾", "tag": "SH-L", "hp": 1500.0, "arc": 60.0, "model": "s_buckler", "wt": 2.0, "info": "轻，覆盖角小"},
	"s_kite": {"name": "中型臂盾", "tag": "SH-M", "hp": 2800.0, "arc": 78.0, "model": "s_kite", "wt": 4.0, "info": "标准臂盾，可被打碎"},
	"s_guard": {"name": "大型护卫盾", "tag": "SH-G", "hp": 5400.0, "arc": 100.0, "model": "s_guard", "wt": 8.0, "info": "弧形大盾，几乎护住整个正面，最重"},
	"s_spike": {"name": "刺盾", "tag": "E-SH", "hp": 2400.0, "arc": 75.0, "model": "s_spike", "wt": 4.0, "info": "带尖刺的敌制臂盾"},
	"s_tower": {"name": "重型塔盾", "tag": "SH-H", "hp": 4600.0, "arc": 95.0, "model": "s_tower", "wt": 7.0, "info": "覆盖整个正面，极重"},
}

# "moves" is the weapon's combo: each entry is one blow = [blade path, arm, damage multiplier, duration].
# Paths: down (overhead chop), diag_in / diag_out (high to low across the body), rise_in / rise_out
# (low to high), sweep (level cut), thrust.
const MELEE := {
	"cleaver": {"hold": [1.1, 0.65], "moves": [["diag_in", "", 1.0, 0.8], ["rise_out", "", 1.15, 0.72], ["down", "", 1.5, 0.9]], "energy": "heat", "name": "热能劈刀", "tag": "HEAT CLEAVER", "dmg": 1500.0, "reach": 13.0, "len": 1.55, "lunge": 70.0, "speed": 75.0, "combo": 3, "style": 1, "arm": "L", "models": {"L": "m_cleaver"}, "blade": "L", "wt": 2.0, "info": "热能：斜劈 → 上撩 → 重劈，突进远，命中后灼烧"},
	"twin": {"moves": [["diag_in", "L", 1.0, 0.62], ["diag_in", "R", 1.0, 0.58], ["sweep", "L", 1.1, 0.6], ["thrust", "R", 1.5, 0.8]], "energy": "heat", "name": "双热能刃", "tag": "TWIN HEAT BLADES", "dmg": 1250.0, "reach": 13.0, "len": 1.50, "lunge": 95.0, "speed": 105.0, "combo": 4, "style": 1, "arm": "both", "models": {"L": "m_blade_L", "R": "m_blade_R"}, "blade": "both", "wt": 2.0, "info": "热能：左右斜劈 → 横扫 → 突刺，突进最快，命中后灼烧"},
	"pile": {"moves": [["thrust", "", 1.0, 0.9]], "energy": "solid", "name": "液压打桩机", "tag": "PILE DRIVER", "dmg": 2300.0, "reach": 11.0, "len": 1.30, "lunge": 40.0, "speed": 55.0, "combo": 1, "style": 3, "arm": "L", "models": {"L": "m_pile"}, "blade": "pile", "wt": 4.0, "info": "实体：单发高伤害，突进短，冲击最强"},
	"lance": {"moves": [["thrust", "", 1.0, 0.85], ["rise_out", "", 0.9, 0.8], ["thrust", "", 1.45, 0.95]], "energy": "heat", "name": "三联热能长枪", "tag": "TRI-LANCE", "dmg": 2050.0, "reach": 15.0, "len": 1.15, "lunge": 65.0, "speed": 72.0, "combo": 3, "style": 3, "arm": "L", "models": {"L": "m_lance"}, "blade": "pile", "wt": 4.0, "info": "热能：突刺 → 上挑 → 重突刺，攻击距离长，命中后灼烧"},
	"claw": {"moves": [["diag_in", "L", 1.0, 0.6], ["diag_in", "R", 1.0, 0.58], ["rise_in", "L", 1.1, 0.6], ["thrust", "R", 1.4, 0.78]], "energy": "solid", "name": "双联裂爪", "tag": "TWIN CLAWS", "dmg": 1300.0, "reach": 12.5, "len": 1.45, "lunge": 90.0, "speed": 100.0, "combo": 4, "style": 1, "arm": "both", "models": {"L": "m_claw_L", "R": "m_claw_R"}, "blade": "both", "wt": 3.0, "info": "实体：左右爪击 → 上撩 → 突刺，突进快"},
	"bayonet": {"moves": [["thrust", "R", 1.0, 0.75], ["rise_out", "R", 1.25, 0.8]], "energy": "solid", "name": "枪刺", "tag": "BAYONET", "dmg": 1150.0, "reach": 13.0, "len": 1.00, "lunge": 60.0, "speed": 85.0, "combo": 2, "style": 3, "arm": "R", "models": {}, "blade": "", "wt": 0.0, "info": ""},
	"axe": {"hold": [1.3, 0.4], "moves": [["down", "", 1.0, 0.95], ["sweep", "", 1.4, 1.0]], "energy": "heat", "name": "热能战斧", "tag": "HEAT AXE", "dmg": 1800.0, "reach": 12.5, "len": 1.50, "lunge": 55.0, "speed": 62.0, "combo": 2, "style": 1, "arm": "L", "models": {"L": "m_axe"}, "blade": "L", "wt": 3.0, "info": "热能：重劈 → 大横扫，慢而重，命中后灼烧"},
	"torch": {"hold": [0.0, 0.0], "moves": [["diag_in", "", 1.0, 0.6], ["rise_in", "", 1.05, 0.58], ["sweep", "", 1.1, 0.62], ["thrust", "", 1.5, 0.8]], "energy": "plasma", "name": "等离子火炬", "tag": "PLASMA TORCH", "dmg": 1100.0, "reach": 15.0, "len": 1.00, "lunge": 80.0, "speed": 95.0, "combo": 4, "style": 1, "arm": "L", "models": {}, "blade": "", "wt": 1.0, "info": "等离子：斜劈 → 上撩 → 横扫 → 突刺，极轻；连臂盾一起烧穿"},
	"torch2": {"moves": [["diag_in", "L", 1.0, 0.56], ["diag_in", "R", 1.0, 0.54], ["rise_out", "L", 1.05, 0.56], ["rise_out", "R", 1.05, 0.56], ["thrust", "L", 1.6, 0.8]], "energy": "plasma", "name": "双等离子火炬", "tag": "TWIN TORCHES", "dmg": 950.0, "reach": 14.0, "len": 1.00, "lunge": 95.0, "speed": 108.0, "combo": 5, "style": 1, "arm": "both", "models": {}, "blade": "", "wt": 2.0, "info": "等离子：双手五连，突进最快；连臂盾一起烧穿"},
	"saber": {"hold": [0.55, 0.05], "moves": [["diag_in", "", 1.0, 0.62], ["sweep", "", 1.1, 0.64], ["thrust", "", 1.5, 0.8]], "energy": "plasma", "name": "等离子军刀", "tag": "PLASMA SABRE", "dmg": 1200.0, "reach": 14.0, "len": 1.00, "lunge": 85.0, "speed": 95.0, "combo": 3, "style": 1, "arm": "L", "models": {"L": "m_m4saber"}, "blade": "", "wt": 2.0, "info": "等离子：斜劈 → 横扫 → 突刺，握持式光剑；连臂盾一起烧穿"},
}

# skill cores (V). kind "od" = overdrive: temporary performance boost, then forced cooldown.
# Other kinds are frame skills. cd = seconds of passive recharge; damage dealt / taken also fills the gauge.
const SYSTEMS := {
	"sk_scan": {"name": "弱点扫描", "tag": "WEAK-POINT SCAN", "kind": "scan", "cd": 40.0, "dur": 12.0, "range": 560.0, "mul": 1.35, "rof": 1.0, "dmg": 1.0, "speed": 1.0, "turn": 1.0, "taken": 1.0, "poise": 1.0, "info": "标记 560m 内的敌人：隔墙可见，全队对其伤害 +35%"},
	"sk_ram": {"name": "突击冲锋", "tag": "RAM CHARGE", "kind": "ram", "cd": 32.0, "dur": 4.5, "hit": 1500.0, "rof": 1.0, "dmg": 1.0, "speed": 1.3, "turn": 0.55, "taken": 0.4, "poise": 99.0, "info": "持续向前冲刺：受伤 -60%、不会硬直，撞上的敌人受伤并硬直"},
	"sk_jam": {"name": "电子干扰", "tag": "ECM JAMMER", "kind": "jam", "cd": 36.0, "dur": 7.0, "rof": 1.0, "dmg": 1.0, "speed": 1.12, "turn": 1.2, "taken": 1.0, "poise": 1.0, "info": "敌方丢失对你的锁定，来袭导弹失去制导，速度 +12%"},
	"sk_focus": {"name": "精密狙击", "tag": "DEADEYE", "kind": "focus", "cd": 38.0, "dur": 9.0, "rof": 1.3, "dmg": 1.3, "speed": 1.0, "turn": 1.0, "taken": 1.0, "poise": 1.0, "info": "伤害 +30%，射速与蓄力 +30%，站定准备时间 -60%，弹着不散布"},
	"od_assault": {"name": "强袭超频", "tag": "OD-ASSAULT", "kind": "od", "cd": 170.0, "dur": 12.0, "rof": 1.4, "dmg": 1.2, "speed": 1.1, "turn": 1.2, "taken": 1.0, "poise": 1.5, "info": "射速 +40%、伤害 +20%"},
	"od_mobility": {"name": "机动超频", "tag": "OD-MOBILITY", "kind": "od", "cd": 170.0, "dur": 14.0, "rof": 1.1, "dmg": 1.0, "speed": 1.32, "turn": 1.5, "taken": 1.0, "poise": 1.2, "info": "速度 +32%、推进不耗槽"},
	"od_fortress": {"name": "壁垒超频", "tag": "OD-FORTRESS", "kind": "od", "cd": 170.0, "dur": 12.0, "rof": 1.15, "dmg": 1.0, "speed": 1.0, "turn": 1.1, "taken": 0.45, "poise": 99.0, "info": "受伤 -55%、不会硬直、臂盾恢复"},
}

const SLOT_ORDER := ["R1", "R2", "R3", "L", "S1", "S2", "M", "SYS"]
const SLOT_NAMES := {"R1": "手持 主武器", "R2": "手持 副武器", "R3": "手持 第三武器", "L": "左臂", "S1": "右肩 重武器", "S2": "左肩 挂架", "M": "格斗", "SYS": "技能核心"}
const SLOT_KEYS := {"R1": "LMB", "R2": "X 切换", "R3": "X 切换", "L": "", "S1": "RMB", "S2": "E", "M": "F", "SYS": "V"}
const FIRE_KEYS := ["LMB", "RMB", "E", "G", "B"]

const FRAMES := {
	"kestrel": {
		"name": "TF-07 红隼", "en": "KESTREL", "role": "通用型 / ALL-ROUNDER",
		"desc": "制式通用机架。中距离步炮压制，重火力打出硬直后以格斗收割。攻防均衡，左臂可挂载臂盾。",
		"ap": 7200.0, "walk": 22.0, "boost": 62.0, "qb": 92.0, "turn": 2.3, "poise": 100.0,
		"drain": 0.15, "regen": 0.34, "overheat": 3.2, "cap": 22.0,
		"loadout": {"R1": "ar90", "R2": "crl", "R3": "", "L": "s_kite", "S1": "bz240", "S2": "ms6", "M": "cleaver", "SYS": "sk_scan"},
		"slots": {"R1": ["ar90", "arg", "crl", "cbr", "lance", "smg", "gat35"], "R2": ["crl", "arg", "lance", "ar90", "smg", ""], "R3": ["", "smg", "sg", "ar90"], "L": ["s_kite", "s_buckler", "s_tower", "anchor", ""], "S1": ["bz240", "rail", "how180", ""], "S2": ["ms6", "rkt", "ms12", ""], "M": ["cleaver", "axe", "twin", "lance", "torch"], "SYS": ["sk_scan", "od_assault", "od_mobility", "od_fortress"]},
		"style": {"thigh": 3.9, "shin": 4.2, "leg_w": 1.0, "hip_w": 1.7, "torso_w": 5.4, "torso_h": 3.0, "torso_d": 3.4, "sh_w": 2.5, "sh": "block", "arm_w": 1.0, "head": "visor", "back": "twin", "skirt": 1.0, "mark": "07"},
		"pal": {"a": Color(0.46, 0.50, 0.40), "b": Color(0.17, 0.22, 0.17), "c": Color(0.80, 0.36, 0.08), "g": Color(0.25, 0.85, 1.0)},
		"stats": {"装甲": 6, "机动": 6, "推进": 6, "火力": 6, "格斗": 6},
	},
	"bastion": {
		"name": "TF-12 堡垒", "en": "BASTION", "role": "重装火力型 / HEAVY FIRE SUPPORT",
		"desc": "重装甲火力平台。转管机炮持续压制，榴弹炮范围毁伤，导弹饱和打击。机动迟缓，稳定性与载荷极高。",
		"ap": 9800.0, "walk": 16.5, "boost": 48.0, "qb": 70.0, "turn": 1.6, "poise": 150.0,
		"drain": 0.17, "regen": 0.28, "overheat": 3.8, "cap": 34.0,
		"loadout": {"R1": "gat35", "R2": "lance", "R3": "", "L": "s_tower", "S1": "how180", "S2": "ms12", "M": "pile", "SYS": "sk_ram"},
		# shoulder weapons carried further out / higher so they clear the head and pauldrons (tools/test_clip.gd --solve)
		"back_off": {"S1": Vector3(0.4, 0.0, 0.0), "S2": Vector3(0.4, 0.0, 0.0)},
		"slots": {"R1": ["gat35", "cbr", "lance", "ar90", "arg", "crl"], "R2": ["lance", "cbr", "crl", "ar90", "gat35", ""], "R3": ["", "sg", "ar90", "smg"], "L": ["s_tower", "s_guard", "s_kite", ""], "S1": ["how180", "rail", "bz240", ""], "S2": ["ms12", "ms6", "rkt", ""], "M": ["pile", "lance", "axe", "cleaver", "torch"], "SYS": ["sk_ram", "od_fortress", "od_assault", "od_mobility"]},
		"style": {"thigh": 3.6, "shin": 4.0, "leg_w": 1.3, "hip_w": 2.0, "torso_w": 6.6, "torso_h": 3.4, "torso_d": 4.2, "sh_w": 3.0, "sh": "heavy", "arm_w": 1.25, "head": "turret", "back": "heavy", "skirt": 1.3, "mark": "12"},
		"pal": {"a": Color(0.64, 0.64, 0.60), "b": Color(0.30, 0.33, 0.37), "c": Color(0.78, 0.56, 0.08), "g": Color(0.35, 1.0, 0.6)},
		"stats": {"装甲": 9, "机动": 3, "推进": 4, "火力": 9, "格斗": 5},
	},
	"shrike": {
		"name": "TF-03 伯劳", "en": "SHRIKE", "role": "高机动格斗型 / HIGH-MOBILITY ASSAULT",
		"desc": "轻量化强袭机架。高推力突入，切到霰弹炮贴脸打硬直，双热能刃三连击。装甲薄弱，没有重武器挂点，靠机动生存。",
		"ap": 5400.0, "walk": 26.0, "boost": 78.0, "qb": 112.0, "turn": 3.0, "poise": 70.0,
		"drain": 0.13, "regen": 0.42, "overheat": 2.6, "cap": 17.0,
		"loadout": {"R1": "smg", "R2": "crl", "R3": "sg", "L": "anchor", "S1": "", "S2": "rkt", "M": "twin", "SYS": "sk_jam"},
		"slots": {"R1": ["smg", "ar90", "arg", "crl", "lance"], "R2": ["crl", "lance", "ar90", "smg", ""], "R3": ["sg", "smg", ""], "L": ["anchor", "s_buckler", ""], "S1": [""], "S2": ["rkt", "ms6", ""], "M": ["twin", "cleaver", "torch2", "torch"], "SYS": ["sk_jam", "od_mobility", "od_assault", "od_fortress"]},
		"style": {"thigh": 4.0, "shin": 4.6, "leg_w": 0.82, "hip_w": 1.5, "torso_w": 4.6, "torso_h": 2.8, "torso_d": 3.0, "sh_w": 2.1, "sh": "slim", "arm_w": 0.85, "head": "wedge", "back": "wing", "skirt": 0.75, "mark": "03"},
		"pal": {"a": Color(0.10, 0.11, 0.13), "b": Color(0.22, 0.23, 0.26), "c": Color(0.70, 0.50, 0.12), "g": Color(0.72, 0.36, 1.0)},
		"stats": {"装甲": 3, "机动": 9, "推进": 9, "火力": 5, "格斗": 9},
	},
	"heron": {
		"name": "TF-09 苍鹭", "en": "HERON", "role": "远程狙击型 / LONG-RANGE SNIPER",
		"desc": "远程支援机架。狙击步炮必须站定才能开火，一发足以打出硬直；机动中等、装甲偏薄，靠距离和精密狙击技能压制。",
		"ap": 5900.0, "walk": 21.0, "boost": 66.0, "qb": 96.0, "turn": 2.2, "poise": 85.0,
		"drain": 0.14, "regen": 0.38, "overheat": 2.9, "cap": 20.0,
		"loadout": {"R1": "srl", "R2": "smg", "R3": "", "L": "s_buckler", "S1": "", "S2": "ms6", "M": "cleaver", "SYS": "sk_focus"},
		# shoulder weapons carried further out / higher so they clear the head and pauldrons (tools/test_clip.gd --solve)
		"back_off": {"S1": Vector3(0.4, 0.0, 0.0), "S2": Vector3(0.3, 0.0, 0.0)},
		"slots": {"R1": ["srl", "crl", "cbr", "ar90", "arg"], "R2": ["smg", "ar90", "crl", ""], "R3": ["", "sg", "ar90"], "L": ["s_buckler", "anchor", "s_kite", ""], "S1": ["", "rail"], "S2": ["ms6", "rkt", "ms12", ""], "M": ["cleaver", "twin", "axe", "torch", "torch2"], "SYS": ["sk_focus", "sk_scan", "od_assault", "od_mobility"]},
		"style": {"thigh": 4.1, "shin": 4.7, "leg_w": 0.86, "hip_w": 1.5, "torso_w": 4.7, "torso_h": 2.8, "torso_d": 3.0, "sh_w": 2.1, "sh": "slim", "arm_w": 0.85, "head": "wedge", "back": "wing", "skirt": 0.8, "mark": "09"},
		"pal": {"a": Color(0.42, 0.55, 0.47), "b": Color(0.14, 0.16, 0.30), "c": Color(0.72, 0.70, 0.62), "g": Color(0.2, 1.0, 0.85)},
		"stats": {"装甲": 4, "机动": 6, "推进": 7, "火力": 8, "格斗": 4},
	},
	"sparta": {
		"name": "TF-21 斯巴达", "en": "SPARTA", "role": "制式主力型 / LINE TROOPER",
		"desc": "新一代制式机架。方正的胸甲与大型肩甲，右肩带双联传感器，左肩挂护翼。各项均衡，稳定性略高于红隼。",
		"ap": 7600.0, "walk": 21.0, "boost": 60.0, "qb": 90.0, "turn": 2.2, "poise": 108.0,
		"drain": 0.15, "regen": 0.34, "overheat": 3.2, "cap": 23.0,
		"loadout": {"R1": "m2r", "R2": "crl", "R3": "", "L": "s_kite", "S1": "bz240", "S2": "ms6", "M": "torch", "SYS": "od_assault"},
		# shoulder weapons carried further out / higher so they clear the head and pauldrons (tools/test_clip.gd --solve)
		"back_off": {"S1": Vector3(1.2, 0.4, 0.0), "S2": Vector3(1.2, 0.0, 0.0)},
		"slots": {"R1": ["m2r", "ar90", "arg", "crl", "cbr", "smg"], "R2": ["crl", "ar90", "lance", "smg", ""], "R3": ["", "sg", "smg"], "L": ["s_kite", "s_buckler", "s_tower", "anchor", ""], "S1": ["bz240", "rail", "how180", ""], "S2": ["ms6", "rkt", "ms12", ""], "M": ["torch", "cleaver", "axe", "lance"], "SYS": ["od_assault", "sk_scan", "od_mobility", "od_fortress"]},
		"style": {"thigh": 4.31, "shin": 3.94, "leg_w": 1.05, "hip_w": 1.66, "torso_w": 4.48, "torso_h": 3.78, "torso_d": 3.39, "sh_w": 2.38, "sh": "block", "arm_w": 1.24, "head": "visor", "back": "twin", "skirt": 1.38, "mark": "21"},
		"pal": {"a": Color(0.20, 0.21, 0.23), "b": Color(0.105, 0.11, 0.125), "c": Color(0.52, 0.40, 0.14), "g": Color(0.25, 1.0, 0.55)},
		"stats": {"装甲": 6, "机动": 6, "推进": 6, "火力": 6, "格斗": 7},
	},
	"phalanx": {
		"name": "TF-22 方阵", "en": "PHALANX", "role": "炮击支援型 / ARTILLERY",
		"desc": "背负两门固定加农的炮击机架。短大腿、长小腿，站姿稳；加农必须站定齐射，近身靠步炮和塔盾周旋。",
		"ap": 8600.0, "walk": 18.0, "boost": 52.0, "qb": 76.0, "turn": 1.8, "poise": 135.0,
		"drain": 0.16, "regen": 0.3, "overheat": 3.6, "cap": 26.0,
		"loadout": {"R1": "m2r", "R2": "gat35", "R3": "", "L": "s_tower", "S1": "twin_cn", "S2": "", "M": "axe", "SYS": "od_fortress"},
		"slots": {"R1": ["m2r", "gat35", "ar90", "arg", "cbr"], "R2": ["gat35", "crl", "lance", "ar90", ""], "R3": ["", "sg", "smg"], "L": ["s_tower", "s_guard", "s_kite", ""], "S1": ["twin_cn"], "S2": [""], "M": ["axe", "pile", "cleaver", "torch"], "SYS": ["od_fortress", "od_assault", "sk_ram"]},
		"style": {"thigh": 2.52, "shin": 5.86, "leg_w": 1.11, "hip_w": 1.58, "torso_w": 4.34, "torso_h": 3.59, "torso_d": 3.77, "sh_w": 2.84, "sh": "heavy", "arm_w": 1.4, "head": "visor", "back": "heavy", "skirt": 1.32, "mark": "22"},
		"pal": {"a": Color(0.17, 0.18, 0.20), "b": Color(0.09, 0.095, 0.11), "c": Color(0.62, 0.07, 0.07), "g": Color(0.25, 1.0, 0.55)},
		"stats": {"装甲": 8, "机动": 4, "推进": 4, "火力": 8, "格斗": 5},
	},
	# --- enemy ---
	"ripper": {
		"name": "EF-7 裂爪", "en": "RIPPER", "role": "", "desc": "",
		"ap": 3600.0, "walk": 22.0, "boost": 66.0, "qb": 92.0, "turn": 2.4, "poise": 115.0,
		"drain": 0.16, "regen": 0.3, "overheat": 3.4, "cap": 99.0,
		"loadout": {"R1": "e_arm", "R2": "", "L": "", "S1": "", "S2": "", "M": "claw", "SYS": ""},
		"melee_mul": 0.42,
		"style": {"thigh": 2.9, "shin": 3.1, "leg_w": 1.25, "hip_w": 1.8, "torso_w": 6.2, "torso_h": 4.9, "torso_d": 5.0, "sh_w": 2.4, "sh": "round", "arm_w": 1.2, "head": "dome", "back": "twin", "skirt": 1.0},
		"pal": {"a": Color(0.40, 0.29, 0.13), "b": Color(0.13, 0.12, 0.11), "c": Color(0.50, 0.12, 0.08), "g": Color(1.0, 0.40, 0.10)},
		"ai": {"range": [30.0, 95.0], "acc": 1.2, "burst": [1.2, 1.4], "melee": 0.75, "dodge": [2.5, 5.0]},
	},
	"hound": {
		"name": "EF-2 猎犬", "en": "HOUND", "role": "", "desc": "",
		"ap": 2600.0, "walk": 19.0, "boost": 52.0, "qb": 75.0, "turn": 1.9, "poise": 80.0,
		"drain": 0.2, "regen": 0.25, "overheat": 4.0, "cap": 99.0,
		"loadout": {"R1": "e_ar", "R2": "", "L": "", "S1": "", "S2": "", "M": "axe", "SYS": ""},
		"melee_mul": 0.36,
		"style": {"thigh": 3.8, "shin": 4.0, "leg_w": 1.05, "hip_w": 1.7, "torso_w": 5.2, "torso_h": 3.0, "torso_d": 3.5, "sh_w": 2.5, "sh": "round", "arm_w": 1.0, "head": "dome", "back": "twin", "skirt": 1.1},
		"pal": {"a": Color(0.40, 0.19, 0.12), "b": Color(0.14, 0.13, 0.13), "c": Color(0.62, 0.54, 0.38), "g": Color(1.0, 0.22, 0.10)},
		"ai": {"range": [110.0, 210.0], "acc": 1.0, "burst": [1.4, 1.6], "melee": 0.25, "dodge": [4.0, 8.0]},
	},
	"mauler": {
		"name": "EF-5 重锤", "en": "MAULER", "role": "", "desc": "",
		"ap": 4800.0, "walk": 15.0, "boost": 42.0, "qb": 60.0, "turn": 1.4, "poise": 130.0,
		"drain": 0.22, "regen": 0.22, "overheat": 4.5, "cap": 99.0,
		"loadout": {"R1": "e_gat", "R2": "", "L": "", "S1": "e_bz", "S2": "e_ms", "M": "pile", "SYS": ""},
		# shoulder weapons carried further out / higher so they clear the head and pauldrons (tools/test_clip.gd --solve)
		"back_off": {"S1": Vector3(0.0, 1.6, 0.0), "S2": Vector3(0.0, 1.6, 0.0)},
		"melee_mul": 0.35,
		"style": {"thigh": 3.6, "shin": 4.0, "leg_w": 1.3, "hip_w": 2.0, "torso_w": 6.4, "torso_h": 3.4, "torso_d": 4.2, "sh_w": 2.9, "sh": "heavy", "arm_w": 1.2, "head": "dome", "back": "heavy", "skirt": 1.3},
		"pal": {"a": Color(0.21, 0.23, 0.19), "b": Color(0.36, 0.14, 0.09), "c": Color(0.68, 0.50, 0.12), "g": Color(1.0, 0.20, 0.10)},
		"ai": {"range": [180.0, 300.0], "acc": 1.2, "burst": [2.0, 2.2], "melee": 0.1, "dodge": [7.0, 12.0]},
	},
	"revenant": {
		"name": "EX-9 亡灵", "en": "REVENANT", "role": "", "desc": "",
		"ap": 12500.0, "walk": 25.0, "boost": 74.0, "qb": 105.0, "turn": 2.8, "poise": 150.0,
		"drain": 0.1, "regen": 0.45, "overheat": 2.4, "cap": 99.0,
		"loadout": {"R1": "e_brg", "R2": "e_sg", "L": "", "S1": "", "S2": "", "M": "twin", "SYS": "od_assault"},
		"melee_mul": 0.76,
		"style": {"thigh": 4.1, "shin": 4.6, "leg_w": 0.9, "hip_w": 1.6, "torso_w": 5.0, "torso_h": 3.0, "torso_d": 3.2, "sh_w": 2.3, "sh": "slim", "arm_w": 0.9, "head": "skull", "back": "wing", "skirt": 0.85},
		"pal": {"a": Color(0.10, 0.10, 0.12), "b": Color(0.40, 0.07, 0.07), "c": Color(0.70, 0.66, 0.58), "g": Color(1.0, 0.25, 0.05)},
		"ai": {"range": [60.0, 170.0], "acc": 0.75, "burst": [1.8, 0.9], "melee": 0.6, "dodge": [1.6, 3.2], "air": 0.5},
	},
	# heavy line breaker: bell-shaped legs, block pauldrons, a hand-held heavy launcher
	"brute": {
		"name": "EF-8 蛮牛", "en": "BRUTE", "role": "", "desc": "",
		"ap": 5400.0, "walk": 14.0, "boost": 40.0, "qb": 58.0, "turn": 1.3, "poise": 150.0,
		"drain": 0.22, "regen": 0.22, "overheat": 4.5, "cap": 99.0,
		"loadout": {"R1": "e_hbz", "R2": "", "L": "", "S1": "", "S2": "", "M": "axe", "SYS": ""},
		"melee_mul": 0.36,
		"style": {"thigh": 3.87, "shin": 5.01, "leg_w": 1.93, "hip_w": 1.98, "torso_w": 5.37, "torso_h": 3.69, "torso_d": 3.96, "sh_w": 2.99, "sh": "heavy", "arm_w": 1.54, "head": "dome", "back": "heavy", "skirt": 2.01},
		"pal": {"a": Color(0.13, 0.16, 0.25), "b": Color(0.21, 0.33, 0.16), "c": Color(0.60, 0.08, 0.07), "g": Color(0.75, 0.2, 1.0)},
		"ai": {"range": [170.0, 300.0], "acc": 1.2, "burst": [2.0, 2.4], "melee": 0.12, "dodge": [7.0, 12.0]},
	},
	# sabre duellist: spiked pauldrons, closes fast and cuts
	"reaver": {
		"name": "EF-6 掠袭者", "en": "REAVER", "role": "", "desc": "",
		"ap": 3900.0, "walk": 23.0, "boost": 68.0, "qb": 96.0, "turn": 2.5, "poise": 105.0,
		"drain": 0.16, "regen": 0.3, "overheat": 3.4, "cap": 99.0,
		"loadout": {"R1": "e_bmg", "R2": "", "L": "", "S1": "", "S2": "", "M": "saber", "SYS": ""},
		"melee_mul": 0.45,
		"style": {"thigh": 3.85, "shin": 4.55, "leg_w": 1.73, "hip_w": 2.01, "torso_w": 4.55, "torso_h": 2.57, "torso_d": 3.78, "sh_w": 3.07, "sh": "round", "arm_w": 1.38, "head": "dome", "back": "twin", "skirt": 2.08},
		"pal": {"a": Color(0.24, 0.25, 0.27), "b": Color(0.11, 0.115, 0.13), "c": Color(0.55, 0.09, 0.07), "g": Color(1.0, 0.18, 0.45)},
		"ai": {"range": [35.0, 110.0], "acc": 1.1, "burst": [1.2, 1.6], "melee": 0.8, "dodge": [2.2, 4.5]},
	},
	# --- aces: the battleship's pair in pale pink-violet over white ("model" = whose glb they use) ---
	"brute_ace": {
		"name": "EF-8S 蛮牛 · 王牌", "en": "BRUTE ACE", "role": "", "desc": "", "model": "brute",
		"ap": 9500.0, "walk": 16.0, "boost": 50.0, "qb": 72.0, "turn": 1.7, "poise": 200.0,
		"drain": 0.18, "regen": 0.3, "overheat": 3.8, "cap": 99.0,
		"loadout": {"R1": "e_hbz", "R2": "", "L": "", "S1": "", "S2": "", "M": "axe", "SYS": "od_fortress"},
		"melee_mul": 0.6,
		"style": {"thigh": 3.87, "shin": 5.01, "leg_w": 1.93, "hip_w": 1.98, "torso_w": 5.37, "torso_h": 3.69, "torso_d": 3.96, "sh_w": 2.99, "sh": "heavy", "arm_w": 1.54, "head": "dome", "back": "heavy", "skirt": 2.01},
		"pal": {"a": Color(0.72, 0.64, 0.76), "b": Color(0.86, 0.86, 0.88), "c": Color(0.66, 0.66, 0.70), "g": Color(1.0, 0.6, 0.95)},
		"ai": {"range": [150.0, 280.0], "acc": 0.85, "burst": [2.0, 1.6], "melee": 0.3, "dodge": [3.0, 6.0]},
	},
	"reaver_ace": {
		"name": "EF-6S 掠袭者 · 王牌", "en": "REAVER ACE", "role": "", "desc": "", "model": "reaver",
		"ap": 7800.0, "walk": 26.0, "boost": 78.0, "qb": 110.0, "turn": 3.0, "poise": 140.0,
		"drain": 0.12, "regen": 0.42, "overheat": 2.6, "cap": 99.0,
		"loadout": {"R1": "e_bmg", "R2": "", "L": "", "S1": "", "S2": "", "M": "saber", "SYS": "od_mobility"},
		"melee_mul": 0.7,
		"style": {"thigh": 3.85, "shin": 4.55, "leg_w": 1.73, "hip_w": 2.01, "torso_w": 4.55, "torso_h": 2.57, "torso_d": 3.78, "sh_w": 3.07, "sh": "round", "arm_w": 1.38, "head": "dome", "back": "twin", "skirt": 2.08},
		"pal": {"a": Color(0.72, 0.64, 0.76), "b": Color(0.70, 0.70, 0.74), "c": Color(0.88, 0.88, 0.90), "g": Color(1.0, 0.6, 0.95)},
		"ai": {"range": [30.0, 100.0], "acc": 0.8, "burst": [1.4, 1.0], "melee": 0.9, "dodge": [1.4, 2.8], "air": 0.5},
	},
	# --- captured frames: enemy machines repainted for the player. Their own glb ("model"), their own
	#     kind of armament only: most slots are fixed or empty ---
	"c_hound": {
		"name": "EF-2 猎犬〔缴获〕", "en": "HOUND", "role": "缴获机 · 轻型通用 / CAPTURED", "model": "hound",
		"desc": "缴获的敌制式机架。结构简单、皮实，但推力和装甲都比不上我方机体；只能使用它原有的步炮、刺盾和战斧。",
		"ap": 5600.0, "walk": 20.0, "boost": 56.0, "qb": 82.0, "turn": 2.1, "poise": 85.0,
		"drain": 0.17, "regen": 0.3, "overheat": 3.6, "cap": 16.0,
		"loadout": {"R1": "c_ar", "R2": "", "R3": "", "L": "s_spike", "S1": "", "S2": "", "M": "axe", "SYS": "od_assault"},
		"slots": {"R1": ["c_ar", "smg"], "R2": ["", "smg", "sg"], "R3": [""], "L": ["s_spike", "s_buckler", ""], "S1": [""], "S2": [""], "M": ["axe"], "SYS": ["od_assault", "od_mobility"]},
		"style": {"thigh": 3.8, "shin": 4.0, "leg_w": 1.05, "hip_w": 1.7, "torso_w": 5.2, "torso_h": 3.0, "torso_d": 3.5, "sh_w": 2.5, "sh": "round", "arm_w": 1.0, "head": "dome", "back": "twin", "skirt": 1.1},
		"pal": {"a": Color(0.50, 0.50, 0.44), "b": Color(0.20, 0.22, 0.20), "c": Color(0.82, 0.40, 0.08), "g": Color(0.25, 0.85, 1.0)},
		"stats": {"装甲": 4, "机动": 5, "推进": 5, "火力": 4, "格斗": 5},
	},
	"c_ripper": {
		"name": "EF-7 裂爪〔缴获〕", "en": "RIPPER", "role": "缴获机 · 近战突击 / CAPTURED", "model": "ripper",
		"desc": "缴获的敌近战机架。矮壮的机体和一对裂爪，突进快、稳定性好；没有肩部挂点，远程只有臂装火箭。",
		"ap": 6000.0, "walk": 23.0, "boost": 68.0, "qb": 96.0, "turn": 2.5, "poise": 115.0,
		"drain": 0.15, "regen": 0.34, "overheat": 3.2, "cap": 15.0,
		"loadout": {"R1": "c_arm", "R2": "", "R3": "", "L": "", "S1": "", "S2": "", "M": "claw", "SYS": "od_mobility"},
		"slots": {"R1": ["c_arm", "smg"], "R2": ["", "sg"], "R3": [""], "L": [""], "S1": [""], "S2": [""], "M": ["claw"], "SYS": ["od_mobility", "od_assault"]},
		"style": {"thigh": 2.9, "shin": 3.1, "leg_w": 1.25, "hip_w": 1.8, "torso_w": 6.2, "torso_h": 4.9, "torso_d": 5.0, "sh_w": 2.4, "sh": "round", "arm_w": 1.2, "head": "dome", "back": "twin", "skirt": 1.0},
		"pal": {"a": Color(0.44, 0.46, 0.40), "b": Color(0.16, 0.17, 0.17), "c": Color(0.82, 0.40, 0.08), "g": Color(0.25, 0.85, 1.0)},
		"stats": {"装甲": 5, "机动": 7, "推进": 7, "火力": 4, "格斗": 8},
	},
	"c_mauler": {
		"name": "EF-5 重锤〔缴获〕", "en": "MAULER", "role": "缴获机 · 重火力 / CAPTURED", "model": "mauler",
		"desc": "缴获的敌重装机架。机炮、肩部火箭筒和导弹一应俱全，打桩机近身一击致命；非常迟缓。",
		"ap": 8800.0, "walk": 15.5, "boost": 44.0, "qb": 64.0, "turn": 1.5, "poise": 140.0,
		"drain": 0.19, "regen": 0.26, "overheat": 4.0, "cap": 32.0,
		"loadout": {"R1": "gat35", "R2": "", "R3": "", "L": "", "S1": "bz240", "S2": "ms6", "M": "pile", "SYS": "od_fortress"},
		"back_off": {"S1": Vector3(0.0, 1.6, 0.0), "S2": Vector3(0.0, 1.6, 0.0)},
		"slots": {"R1": ["gat35", "c_ar"], "R2": ["", "sg"], "R3": [""], "L": ["", "s_spike"], "S1": ["bz240", ""], "S2": ["ms6", ""], "M": ["pile"], "SYS": ["od_fortress", "sk_ram"]},
		"style": {"thigh": 3.6, "shin": 4.0, "leg_w": 1.3, "hip_w": 2.0, "torso_w": 6.4, "torso_h": 3.4, "torso_d": 4.2, "sh_w": 2.9, "sh": "heavy", "arm_w": 1.2, "head": "dome", "back": "heavy", "skirt": 1.3},
		"pal": {"a": Color(0.56, 0.56, 0.52), "b": Color(0.24, 0.27, 0.30), "c": Color(0.80, 0.56, 0.08), "g": Color(0.25, 0.85, 1.0)},
		"stats": {"装甲": 8, "机动": 3, "推进": 3, "火力": 8, "格斗": 5},
	},
	"c_revenant": {
		"name": "EX-9 亡灵〔缴获〕", "en": "REVENANT", "role": "缴获机 · 王牌试作 / CAPTURED", "model": "revenant",
		"desc": "缴获的敌王牌试作机，输出已被限制。机动和推进仍是一流，只有刺刀步炮、霰弹炮和双刃可用，装甲很薄。",
		"ap": 6600.0, "walk": 25.0, "boost": 74.0, "qb": 106.0, "turn": 2.8, "poise": 95.0,
		"drain": 0.12, "regen": 0.42, "overheat": 2.6, "cap": 16.0,
		"loadout": {"R1": "arg", "R2": "sg", "R3": "", "L": "", "S1": "", "S2": "", "M": "twin", "SYS": "od_assault"},
		"slots": {"R1": ["arg", "smg"], "R2": ["sg", ""], "R3": [""], "L": [""], "S1": [""], "S2": [""], "M": ["twin", "torch2"], "SYS": ["od_assault", "od_mobility"]},
		"style": {"thigh": 4.1, "shin": 4.6, "leg_w": 0.9, "hip_w": 1.6, "torso_w": 5.0, "torso_h": 3.0, "torso_d": 3.2, "sh_w": 2.3, "sh": "slim", "arm_w": 0.9, "head": "skull", "back": "wing", "skirt": 0.85},
		"pal": {"a": Color(0.30, 0.33, 0.36), "b": Color(0.62, 0.62, 0.58), "c": Color(0.82, 0.40, 0.08), "g": Color(0.25, 0.85, 1.0)},
		"stats": {"装甲": 4, "机动": 9, "推进": 8, "火力": 5, "格斗": 8},
	},
	"c_brute": {
		"name": "EF-8 蛮牛〔缴获〕", "en": "BRUTE", "role": "缴获机 · 重装突破 / CAPTURED", "model": "brute",
		"desc": "缴获的敌重装机架。钟形腿、厚装甲，手持重型火箭筒一发硬直；没有肩部挂点，几乎谈不上机动。",
		"ap": 9200.0, "walk": 14.5, "boost": 42.0, "qb": 60.0, "turn": 1.4, "poise": 160.0,
		"drain": 0.2, "regen": 0.25, "overheat": 4.2, "cap": 26.0,
		"loadout": {"R1": "c_hbz", "R2": "", "R3": "", "L": "", "S1": "", "S2": "", "M": "axe", "SYS": "od_fortress"},
		"slots": {"R1": ["c_hbz", "gat35"], "R2": ["", "sg"], "R3": [""], "L": [""], "S1": [""], "S2": [""], "M": ["axe"], "SYS": ["od_fortress", "sk_ram"]},
		"style": {"thigh": 3.87, "shin": 5.01, "leg_w": 1.93, "hip_w": 1.98, "torso_w": 5.37, "torso_h": 3.69, "torso_d": 3.96, "sh_w": 2.99, "sh": "heavy", "arm_w": 1.54, "head": "dome", "back": "heavy", "skirt": 2.01},
		"pal": {"a": Color(0.48, 0.50, 0.44), "b": Color(0.22, 0.26, 0.22), "c": Color(0.82, 0.40, 0.08), "g": Color(0.25, 0.85, 1.0)},
		"stats": {"装甲": 9, "机动": 2, "推进": 3, "火力": 7, "格斗": 6},
	},
	"c_reaver": {
		"name": "EF-6 掠袭者〔缴获〕", "en": "REAVER", "role": "缴获机 · 光剑格斗 / CAPTURED", "model": "reaver",
		"desc": "缴获的敌格斗机架。握持式等离子军刀三连击，光束机枪五连发点射牵制；没有肩部挂点，靠速度贴身。",
		"ap": 6400.0, "walk": 23.5, "boost": 70.0, "qb": 100.0, "turn": 2.6, "poise": 105.0,
		"drain": 0.14, "regen": 0.36, "overheat": 3.0, "cap": 15.0,
		"loadout": {"R1": "c_bmg", "R2": "", "R3": "", "L": "", "S1": "", "S2": "", "M": "saber", "SYS": "od_mobility"},
		"slots": {"R1": ["c_bmg", "c_tube", "smg"], "R2": ["", "sg"], "R3": [""], "L": [""], "S1": [""], "S2": [""], "M": ["saber"], "SYS": ["od_mobility", "od_assault"]},
		"style": {"thigh": 3.85, "shin": 4.55, "leg_w": 1.73, "hip_w": 2.01, "torso_w": 4.55, "torso_h": 2.57, "torso_d": 3.78, "sh_w": 3.07, "sh": "round", "arm_w": 1.38, "head": "dome", "back": "twin", "skirt": 2.08},
		"pal": {"a": Color(0.52, 0.52, 0.48), "b": Color(0.18, 0.19, 0.21), "c": Color(0.82, 0.40, 0.08), "g": Color(0.25, 0.85, 1.0)},
		"stats": {"装甲": 5, "机动": 8, "推进": 7, "火力": 4, "格斗": 8},
	},
}

const PLAYER_FRAMES := ["kestrel", "bastion", "shrike", "heron", "sparta", "phalanx", "c_hound", "c_ripper", "c_mauler", "c_revenant", "c_brute", "c_reaver"]

const MISSIONS := [
	{"id": "rust", "name": "锈蚀回廊", "en": "OPERATION RUST CORRIDOR", "map": "refinery", "time": 720.0, "scale": "小队突击  ·  限时 12 分钟",
		"brief": "突入沙漠中的旧炼油基地，摧毁三座榴弹炮台，歼灭增援并击毁敌王牌机。",
		"body": "敌军占据了沙漠中的旧炼油基地，并在基地内部署了三座榴弹炮台，封锁了通往北部的整条回廊。

砂砾小队由南侧废墟区突入，摧毁全部炮台。情报显示敌方机架小队驻扎在北部，炮台被毁后必然增援；另有一架王牌机在该空域活动。

作战限时 12 分钟。沙尘浓度高，目视距离不足 600 米，依靠雷达与火控锁定。",
		"objs": ["01  摧毁基地内 3 座榴弹炮台（雷达菱形标记 / TGT）", "02  歼灭增援的敌机架小队", "03  击毁敌王牌机"],
		"tips": ["· 重火力（右键）命中即造成硬直；硬直中的敌人吃到格斗会被击倒。", "· 臂盾只挡得住左前方来的火力，被打碎后就没有了，别拿它硬吃榴弹。", "· 超频核心（V）蓄满后启动，时间结束会强制过热冷却，留到王牌战。"]},
	{"id": "descent", "name": "降下作战", "en": "OPERATION DESCENT", "map": "gunline", "time": 960.0, "scale": "大规模阵地防御  ·  限时 16 分钟",
		"brief": "敌轨道登陆舰队正在降下。守住对轨炮阵地，击落运输机与空降舱，在登陆舰着陆前将其击坠。",
		"body": "敌轨道舰队突破了外层防线，一艘登陆舰正带着整支机架部队向地面降下。我方最后的手段是这条对轨炮阵地——三座磁轨巨炮，充能完毕后足以击穿登陆舰的下降引擎。

敌人很清楚这一点。先遣的攻击机与运输机会首先扑向炮阵地，随后是从轨道直接投下的空降舱。

守住对轨炮直到充能完毕，然后配合齐射，把登陆舰的四台下降引擎全部击毁。它一旦着陆，这片大陆就守不住了。",
		"objs": ["01  击退空降先遣：攻击机、运输机及其投放的机架", "02  保卫对轨炮直到充能完毕（至少保住一座）", "03  摧毁登陆舰的 4 台下降引擎，将其击坠"],
		"tips": ["· 运输机悬停卸货时最脆弱；空降舱在落地前可以直接打爆。", "· 按住 SHIFT 升空，空中按住空格可以平飞；对空首选导弹和蓄力武器。", "· 敌机架落地后会直扑炮座。炮座的血量是这场战斗的生命线。"]},
	{"id": "belt", "name": "小行星带的闪光", "en": "FLASH IN THE BELT", "map": "belt", "time": 900.0, "scale": "宇宙舰队战  ·  限时 15 分钟",
		"brief": "护卫巡洋舰「白桦号」，穿过小行星带，击沉敌方战列舰。无重力环境，全向机动。",
		"body": "登陆舰队被击退后，敌方母舰群退入小行星带后方的废弃船坞重整。我方只剩一艘还能作战的巡洋舰——白桦号。

砂砾小队搭载白桦号出击：先击退从小行星带里涌出的敌机架，护送白桦号沿航道穿过小行星带，再与它一起击沉停泊在船坞旁的敌战列舰。

战舰的主炮、点防御炮、引擎和舰桥各自独立受损。舰体装甲打不穿，要瞄准部件。",
		"objs": ["01  护卫巡洋舰「白桦号」，击退敌机架", "02  护送白桦号穿过小行星带", "03  击沉敌战列舰（摧毁舰桥与引擎）"],
		"tips": ["· 无重力：W A S D 前后左右，SHIFT 上升，CTRL 下降，三者可以合成；按住空格持续推进，Q 朝当前方向快速推进。", "· 先敲掉战列舰的主炮，白桦号才撑得住；舰桥被毁则全舰武器停火。", "· 站定武器在宇宙中只要停稳就能开火。小行星是最好的掩体。"]},
]


static func item(id: String) -> Dictionary:
	if WEAPONS.has(id):
		return WEAPONS[id]
	if SHIELDS.has(id):
		return SHIELDS[id]
	if MELEE.has(id):
		return MELEE[id]
	if SYSTEMS.has(id):
		return SYSTEMS[id]
	return {}


static func load_weight(lo: Dictionary) -> float:
	var w := 0.0
	for s in lo:
		w += float(item(str(lo[s])).get("wt", 0.0))
	return w


# mobility multiplier from load ratio: light builds are quicker, overweight builds crawl
static func mobility(lo: Dictionary, cap: float) -> float:
	var r := load_weight(lo) / maxf(cap, 1.0)
	return clampf(1.14 - 0.2 * r, 0.72, 1.08)
