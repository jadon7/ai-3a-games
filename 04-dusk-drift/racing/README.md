# 赛车漂移短片 · 制作说明

## 成片
- `out/drift_final.mp4` —— 成片母版（1920×1080，24 fps，7.08 秒，H.264，含调色/辉光/暗角/颗粒，约 71 MB）
- `out/drift_final_share.mp4` —— 同一成片的小体积版（约 9 MB，方便手机/聊天软件传看）
- `out/drift_clean.mp4` —— 未做风格化调色的干净版（方便你自己调色）
成片从第 11 帧开始：前 10 帧里领先的那台车虚焦着从画面左下角划过，挡住主角，所以剪掉了。

注意：为了给磁盘腾空间，下面两样已删除，都可以重新生成：
- 原始帧序列 `renders/final/f0001.png … f0180.png`（16-bit PNG，180 帧 = 7.5 秒，1.3 GB，2026-11-22 删除）。想重新调色、重新编码或要完整 7.5 秒版本，需要先重新渲染（约 1.5 小时），再跑 `post.sh`（完整版把起始帧参数从 11 改成 1）。只是想简单调色的话，可以直接用 `out/drift_clean.mp4`。
- 烟雾缓存 `cache/smoke2/`（1.6 GB）。重新渲染前需先按下文命令重新生成（约 5 分钟）。

试渲染图、素材缩略图和日志也一并清掉了。

## 画面内容
黄昏、雨后半湿的赛道。一台 BMW M3 E30（DTM 时代涂装）领着 Ford Capri Gr.5、Lancia Stratos 冲向右手弯，
入弯甩尾、反打方向横着滑过整个弯道，后轮拉出浓烟并在地面留下胎痕，出弯回正加速离开。

| 镜头 | 帧 | 机位 |
|---|---|---|
| A | 1–40 | 弯外侧 400mm 长焦，正对来车方向（逆光） |
| B | 41–82 | 弯外侧 330→235mm 跟摇，起漂瞬间 |
| B2 | 83–124 | 内场近距离跟摇，漂移高潮（顺光） |
| C | 125–180 | 出弯内侧贴地低机位摇摄，车从烟里冲出来驶离 |

## 技术路线（全部在本机 Blender 5.2 + Cycles 完成）
- **车辆运动**：`scripts/motion.py` 用运动学计算走线、速度、侧滑角、反打角、车身侧倾/俯仰、车轮自转（后轮打滑转速更高）。
- **胎烟**：`scripts/smoke_sim.py` 自写粒子烟雾模拟（受车尾甩动、风、湍流、后车尾流影响），用 OpenVDB 写成体积序列，Cycles 体积渲染。
- **半湿路面**：实拍 PBR 沥青贴图 + 程序化湿度/积水遮罩（清漆层表现水膜），行车线更干、路缘更湿。
- **环境**：Poly Haven 实拍 HDRI 天空 + 暖色太阳灯；程序化生成护栏、轮胎墙、路肩、砾石缓冲区、广告围挡；Poly Haven 扫描树木；三维草丛。
- **后期**：`scripts/post.sh`（ffmpeg）做辉光、暖色调色、轻微镜头畸变/色散、暗角、胶片颗粒。

## 重新渲染
```bash
# 单帧/多帧测试
/Applications/Blender.app/Contents/MacOS/Blender -b scene/race_scene.blend -P scripts/render_frames.py -- --frames 76,134 --pct 50 --samples 40 --out renders/test --fmt JPEG
# 合成（参数：帧目录 输出 帧率 扩展名 起始帧 模式）—— 需要 renders/final 里先有重新渲染出的帧序列
zsh scripts/post.sh renders/final out/drift_final.mp4 24 png 11 full
```
烟雾缓存 `cache/smoke2/` 可用 `Blender -b -P scripts/smoke_sim.py -- --rate 2.5 --vox 0.07 --out cache/smoke2` 重新生成（约 5 分钟）。

## 素材来源与许可（发布时请保留署名）
| 素材 | 作者 | 来源 | 许可 |
|---|---|---|---|
| BMW M3 E30 DTM | kelvin-carvalho | Sketchfab | CC BY 4.0（需署名） |
| Zakspeed Ford Capri Gr.5 | heynic（vecarz） | Sketchfab | CC BY 4.0（需署名） |
| Lancia Stratos HF – Rally – Alitalia Livery | JamesSlater | Sketchfab | CC BY 4.0（需署名） |
| HDRI「Lilienstein」、沥青/草地/砾石/混凝土贴图、Jacaranda / Fir / Small Tree 树木模型 | Poly Haven | polyhaven.com | CC0 |

说明：车身涂装是模型自带的历史赛车涂装（E30 的 FINA、Stratos 的 Alitalia 属于真实历史赞助商；Capri 为虚构涂装）。
赛道边的广告围挡全部是我虚构的品牌名（KESTREL / NORDWIND / VELOCE / HALDEN / ORBIT / MERIDIAN / CORSA 76 / DASHI）。
