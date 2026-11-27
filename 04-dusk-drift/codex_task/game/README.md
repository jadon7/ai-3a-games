# Selva 47 · 雨后俱乐部赛

驾驶酒红色 47 号 GT40，在黄昏的湿地赛道上与黄色 Lancia 037 和蓝色 62 号 GT40 比赛。从第三位发车，跑完三圈，先过终点的车获胜。每圈 1.165 公里。

## 启动

1. 在 Finder 打开本文件所在的 `game` 文件夹，双击 [启动游戏.command](./启动游戏.command)。
2. 等 Chrome 的游戏窗口出现，按 **Enter** 进入发车位。倒计时结束后，按 **↑** 或 **W** 给油。
3. 游戏期间保留终端窗口。结束时，在终端按 **Control + C**。启动器会关闭这次打开的游戏窗口，并清理本次浏览器缓存。

启动器使用本机 Python 3 和 Google Chrome。模型、贴图、字体和渲染库都随游戏提供，可断网游玩。也可以在本目录的终端运行 `./启动游戏.command`。如需在已有浏览器中玩，运行 `./启动游戏.command --no-browser`，打开终端显示的本机地址。

## 操作

| 按键 | 动作 |
| --- | --- |
| ↑ / W | 给油 |
| ↓ / S | 刹车。停稳后继续按住可倒车 |
| ← → / A D | 向左或向右转向 |
| 空格 + 转向 | 拉手刹，让后轮侧滑 |
| C | 在追车、右前方跟拍和引擎盖视角之间切换 |
| H | 隐藏或显示仪表 |
| R | 在当前路段回到赛道，车速归零 |
| Esc | 暂停或继续。暂停菜单可重新发车 |
| M | 开关声音。游戏默认静音 |

**第一个左弯可以练漂移。** 以约 75–95 km/h 接近弯道，先按左转，再按住空格约半秒。车尾滑出后松开空格，逐渐回正。如果车头继续向弯内转，短按右转反打，再给油出弯。屏幕下方显示侧滑角和这次漂移的距离。

## 赛道与画面

- 原工程提供了 471 米拍摄路段的道路中心线。游戏保留了这段路的宽度、左弯、红白路肩、护栏、广告牌和裁判岗亭，又修了一段回程路与起点相接。
- 两款车使用原工程的三维模型。两辆 GT40 各自使用原来的车顶和车门涂装。车轮随车速转动，前轮转向，车身在转弯和制动时产生侧倾和俯仰。两辆对手车会根据前方弯道调整速度，也会调整行车位置。
- 路面使用原工程的沥青扫描贴图和旧轮迹。浅水区实时反射车身、天空和沿线景物。后轮侧滑时留下轮迹并带起水雾。
- 车轮内侧、座舱和发动机舱使用从车模烘焙的阴影。近景灌木使用三维模型，远处植被使用原树模在同一套日光下渲染的四向贴图。运动模糊按相机、车身与车轮各自的运动计算。
- 比赛记录排名、圈数、本圈用时和最快圈。发动机声和湿路胎噪随转速、车速及侧滑状态实时合成。

## 实机画面

下图取自这台 Mac 的 Chrome 游戏窗口。47 号以 108 km/h 滑过左弯，仪表显示侧滑角为 35°。按 **C** 可在驾驶时切到这个跟拍视角。

![47 号在左弯中漂移](./screenshots/03-drift.png)

[进入比赛](./screenshots/01-briefing.png) · [追赶两辆对手车](./screenshots/02-pursuit.png) · [引擎盖视角](./screenshots/04-bonnet.png) · [完赛成绩](./screenshots/05-finish.png)

在 Apple M3 Max 上使用 Chrome 和 Metal，以 1536 × 864 静音试玩。从发车到三圈完赛均使用键盘输入。图中的完赛总时间为 2 分 07.833 秒，最快圈为 39.655 秒。一次连续 27 秒的行驶采样平均约 60 帧/秒。试玩还核对了刹车、漂移、复位、三个视角和暂停计时。

## 与成片相比

成片用 Cycles 逐帧计算。右前方贴近车身时，游戏能保留车门号码、轮毂和湿地倒影。车窗里的二次反射和底盘附近的间接光仍比成片简单。低角度看路面时，有些水斑更亮，边缘也更整齐。绕过路旁的大树时能看出树冠视角切换，近看轮后水雾也能看出粒子团。可在相同弯道对照[原片](../final.mp4)。

## 素材来源与许可

| 内容 | 来源、许可及本次处理 |
| --- | --- |
| Ford GT40 Mark II | vecarz。由原工程导出，保留驾驶员和两套涂装，简化部分内件，烘焙环境遮蔽，接入游戏转向、车轮及尾灯。[原模型](https://sketchfab.com/3d-models/ford-gt40-mark-ii-wwwvecarzcom-16e6376958604b3d83b541ee67f4b4c9) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Lancia 037 Stradale | vecarz。由原工程导出，保留黄色车漆、内饰和车手，烘焙环境遮蔽并接入对手车驾驶逻辑。[原模型](https://sketchfab.com/3d-models/lancia-037-stradale-1978-36f1c5964de14e0088d828e88a3749b9) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| 黄昏天空与环境照明 | Qwantani Sunset，Greg Zaal 摄影，Jarod Guest 处理。从工程内的 HDR 全景生成天空图和照明用环境图。[素材](https://polyhaven.com/a/qwantani_sunset) · [Poly Haven CC0](https://polyhaven.com/license) |
| 沥青 | Asphalt Track，Dimitrios Savva。使用颜色、法线和粗糙度贴图。[素材](https://polyhaven.com/a/asphalt_track) · [Poly Haven CC0](https://polyhaven.com/license) |
| 草地与碎石 | Aerial Grass Rock 和 Gravel Ground 01，Rob Tuytel。用作赛道两侧的地表纹理。[草地](https://polyhaven.com/a/aerial_grass_rock) · [碎石](https://polyhaven.com/a/gravel_ground_01) · [Poly Haven CC0](https://polyhaven.com/license) |
| 灌木与树木 | Tree Small 02 和 Shrub 02，Rico Cilliers。Fir Sapling Medium，Rico Cilliers 建模、Rob Tuytel 摄影。使用模型生成四向植被贴图，并简化近景灌木网格。[阔叶树](https://polyhaven.com/a/tree_small_02) · [灌木](https://polyhaven.com/a/shrub_02) · [针叶树](https://polyhaven.com/a/fir_sapling_medium) · [Poly Haven CC0](https://polyhaven.com/license) |
| 涂装、赛道设施和路面旧轮迹 | 来自随附的《Selva 47》工程。号码、贴花和标牌沿用工程中已栅格化的图样。原报告列出的字形为 Arial Bold、Arial Bold Italic 和 DIN Condensed Bold。[工程素材说明](../REPORT.md) · [Apple 软件许可](https://www.apple.com/legal/sla/) |
| 渲染库 | three.js r170，three.js authors，MIT。随包提供渲染器、glTF 和 HDR 加载器及所需几何工具，加载器使用本地导入路径。[项目源码](https://github.com/mrdoob/three.js/tree/r170) · [随包许可](./vendor/THREE-LICENSE.txt) |
| 界面字体 | Barlow Condensed，The Barlow Project Authors，SIL Open Font License 1.1。使用 SemiBold 和 Bold Italic 两款字形。[字体源码](https://github.com/google/fonts/tree/main/ofl/barlowcondensed) · [随包许可](./vendor/Barlow-OFL.txt) |
