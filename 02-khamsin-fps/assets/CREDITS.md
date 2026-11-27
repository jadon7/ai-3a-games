# 素材来源

以下贴图与天空图来自 [Poly Haven](https://polyhaven.com)，全部为 CC0（公有领域）授权，可自由使用。

| 用途 | 素材 | 作者 |
| --- | --- | --- |
| plaster | [White Plaster 02](https://polyhaven.com/a/white_plaster_02) | Rob Tuytel |
| brick | [Red Brick Plaster Patch 02](https://polyhaven.com/a/red_brick_plaster_patch_02) | Rob Tuytel |
| sandstone | [Sandstone Blocks 08](https://polyhaven.com/a/sandstone_blocks_08) | Rob Tuytel |
| sand | [Sandy Gravel 02](https://polyhaven.com/a/sandy_gravel_02) | Dario Barresi |
| dirt | [Dirt Floor](https://polyhaven.com/a/dirt_floor) | eye-candy.xyz |
| paving | [Rectangular Paving](https://polyhaven.com/a/rectangular_paving) | Dimitrios Savva |
| concrete | [Dirty Concrete](https://polyhaven.com/a/dirty_concrete) | Rob Tuytel |
| wood | [Brown Planks 03](https://polyhaven.com/a/brown_planks_03) | Rob Tuytel |
| woodPaint | [White Planks Clean](https://polyhaven.com/a/white_planks_clean) | Rob Tuytel |
| metalPaint | [Rusty Metal Sheet](https://polyhaven.com/a/rusty_metal_sheet) | Amal Kumar |
| metalRusty | [Rusty Metal 02](https://polyhaven.com/a/rusty_metal_02) | Rob Tuytel |
| corrugated | [Worn Corrugated Iron](https://polyhaven.com/a/worn_corrugated_iron) | Jenelle van Heerden, Dimitrios Savva |
| shutter | [Painted Metal Shutter](https://polyhaven.com/a/painted_metal_shutter) | Dario Barresi, Rico Cilliers, Charlotte Baglioni |
| rock | [Cliff Side](https://polyhaven.com/a/cliff_side) | James Ray Cock, Jenelle van Heerden, Dario Barresi |
| sky | [Kloofendal 38d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_38d_partly_cloudy_puresky) | Greg Zaal, Jarod Guest |

## 角色人体网格

士兵模型（`models/soldier.glb`）的人体来自 Blender 基金会 / Blender Studio 的 [Human Base Meshes](https://www.blender.org/download/demo-files/) 素材包（v1.4.1，下载自 download.blender.org），用的是其中的 “Body Male - Realistic”，作者 Dan Ulrich，CC0（公有领域）授权。作战服、装备、头盔、头巾、骨骼绑定由 `tools/blender/build_soldier.py` 在它的基础上生成。

说明：素材包自带的 README 和资产元数据都标注为 CC0；包内 .blend 里另有一段名为 License 的文本写着别的素材（Rain Rig，CC-BY 4.0），与这批人体网格无关，本项目没有使用那个素材。

原始素材包（约 50 MB）只在重新生成模型时需要，不随游戏分发，也不在仓库里；重新生成的命令见 `tools/blender/build_soldier.py` 开头的注释。

## 第三张地图「风歇驿堡」的地形

`maps/yard.kmap` 是由一份 Hammer 灰盒（`Courtyard_01.vmf`，只有体块、全部是开发用灰色贴图，不含任何材质、模型和美术）经 `tools/vmf2map.py` 转换得到的几何数据：墙、楼板、台阶、位移地形和隐形墙。地图里的材质、做旧、陈设、灯光、出生点和玩法数据都是本项目自己加的。

这份灰盒由项目所有者提供，来源和作者未随文件注明，原文件不在仓库里。公开发布前请确认它的出处和使用条件，并按需要在这里补上署名。

