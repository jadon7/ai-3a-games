#!/usr/bin/env python3
"""生成整图地表重绘的任务清单：每块布局图对应一个图生图任务。输出 tools/jobs/paint_tiles.json。"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPT = (
    "把参考图重画成顶级 MOBA 游戏（Dota 2 那一类）的手绘地表贴图。参考图是游戏地图里一块 64 米见方区域的正俯视布局图。"
    "必须保持参考图里每一块区域的位置、形状、朝向不变，颜色和明暗也跟参考图保持一致，不要整体画暗：浅色的路还是浅色的路，河床还是河床，"
    "河岸线、石块、深浅色块的边界都不要移动，不要增加或删除区域。"
    "只把画法换掉：用干净、概括的手绘笔触重新画，像游戏美术师手绘的地形贴图。地面有自然的明暗起伏和手绘细节：小石子、细裂纹、草根、落叶、磨损的痕迹；"
    "不同材质的交界是不规则的笔触边缘。"
    "参考图里的元素分别是：暖灰褐色的是焦土和灰烬地；较浅的条带是踩实的土路或石板路；灰蓝色的是潮湿的岩石地；墨绿色的是海草苔地；"
    "浅青色带卵石的是浅水河床；地面上发暗的斑块是树荫下潮湿的泥土，画出树根和落叶；灰色的圆形是嵌在地里的旧石台地基，边缘有磨损和缝隙；"
    "小的深色圆点是火盆烧出的焦痕；深灰色的不规则块是半埋在土里的大石头的顶面。"
    "去掉参考图里重复平铺的纹理感，整张图不要出现重复的图案。"
    "正上方垂直俯视的平面图，没有透视，没有地平线，不要画任何立起来的物体（不要画树、建筑、人物、栏杆），没有明显的投影方向，光照均匀柔和。"
    "颜色厚重但清楚，中等明度，不要鲜艳，不要卡通，不要照片写实，不要黑色勾线。无文字，无水印，画面铺满到四边，不要留边框。")
jobs = [{"name": f"paint-{i}-{j}", "out": f"art/paint/raw/p_{i}_{j}.png", "model": "jm_image_model_oa_it", "ratio": "1:1", "resolution": "2K",
         "prompt": PROMPT, "ref_files": [f"art/paint/guide/g_{i}_{j}.jpg"]} for i in range(6) for j in range(6)]
json.dump(jobs, open(os.path.join(ROOT, "tools/jobs/paint_tiles.json"), "w"), ensure_ascii=False, indent=1)
print(len(jobs), "jobs")
