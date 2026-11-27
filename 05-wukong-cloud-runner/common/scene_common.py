"""悟空筋斗云项目的公共约定：坐标、太阳方向、天空、渲染设置。
所有子模块（环境 / 云 / 角色 / 镜头）都 import 这个文件，保证光照与单位一致。

约定
----
- 单位：米；Z 向上；云海顶面平均高度 z = 0。
- 悟空飞行主方向：+X。
- 太阳：仰角 13°，方位角从 +X 朝 +Y 偏 25°（逆光偏侧光，日出金光）。
- 帧率 24，成片 1920x1080。
"""
import bpy, math, os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 24
SUN_EL_DEG = 13.0
SUN_AZ_DEG = 25.0
_el, _az = math.radians(SUN_EL_DEG), math.radians(SUN_AZ_DEG)
SUN_DIR = Vector((math.cos(_el) * math.cos(_az), math.cos(_el) * math.sin(_az), math.sin(_el)))

# 由 tests/calib_sky.py 标定后写入
SKY_SUN_ROTATION = math.radians(90.0 - SUN_AZ_DEG)   # Sky Texture 的 sun_rotation
SKY_STRENGTH = 0.04   # 标定：正对太阳的 0.8 白板 ≈ 1.1（线性），朝上的白板 ≈ 0.3


def enable_gpu():
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = (d.type == 'METAL')


def _set_enum(obj, prop, candidates):
    """依次尝试候选枚举值，返回第一个设置成功的（动态枚举列不出选项，只能试）。"""
    for c in candidates:
        try:
            setattr(obj, prop, c)
            return c
        except (TypeError, ValueError):
            continue
    return getattr(obj, prop)


def setup_render(scene, res=(1920, 1080), pct=100, samples=96, noise=0.02,
                 motion_blur=True, vol_bounces=8, denoise=True):
    enable_gpu()
    scene.render.engine = 'CYCLES'
    c = scene.cycles
    c.device = 'GPU'
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = noise
    c.use_denoising = denoise
    if denoise:
        _set_enum(c, 'denoiser', ['OPENIMAGEDENOISE'])
        _set_enum(c, 'denoising_input_passes', ['RGB_ALBEDO_NORMAL'])
        if hasattr(c, 'denoising_use_gpu'):
            c.denoising_use_gpu = True
    c.max_bounces = 8
    c.diffuse_bounces = 3
    c.glossy_bounces = 4
    c.transmission_bounces = 6
    c.transparent_max_bounces = 16
    c.volume_bounces = vol_bounces
    c.caustics_reflective = False
    c.caustics_refractive = False
    if hasattr(c, 'sample_clamp_indirect'):
        c.sample_clamp_indirect = 10.0
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = pct
    scene.render.fps = FPS
    scene.render.use_motion_blur = motion_blur
    scene.render.motion_blur_shutter = 0.5
    scene.render.film_transparent = False
    scene.render.use_persistent_data = True
    setup_color(scene)


def setup_color(scene):
    vs = scene.view_settings
    _set_enum(vs, 'view_transform', ['AgX', 'Filmic', 'Standard'])
    try:
        vs.look = 'AgX - Base Contrast'
    except TypeError:
        pass
    vs.exposure = 0.0
    vs.gamma = 1.0


def setup_world(scene, strength=None, sun_disc=True):
    """物理天空（多次散射）+ 太阳盘。太阳方向 = SUN_DIR。"""
    world = bpy.data.worlds.get('WK_World') or bpy.data.worlds.new('WK_World')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    sky = nt.nodes.new('ShaderNodeTexSky')
    _set_enum(sky, 'sky_type', ['MULTIPLE_SCATTERING', 'NISHITA', 'SINGLE_SCATTERING'])
    sky.sun_elevation = math.radians(SUN_EL_DEG)
    sky.sun_rotation = SKY_SUN_ROTATION
    sky.sun_disc = sun_disc
    if hasattr(sky, 'sun_size'):
        sky.sun_size = math.radians(0.545)
    if hasattr(sky, 'sun_intensity'):
        sky.sun_intensity = 1.0
    if hasattr(sky, 'altitude'):
        sky.altitude = 1500.0          # 云海之上，约 1500 m
    for name, val in (('air_density', 1.0), ('aerosol_density', 1.6), ('dust_density', 1.6), ('ozone_density', 1.0)):
        if hasattr(sky, name):
            setattr(sky, name, val)
    bg.inputs['Strength'].default_value = SKY_STRENGTH if strength is None else strength
    nt.links.new(sky.outputs[0], bg.inputs['Color'])
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    return world


# =====================================================================
# 二次元（动画风）方案：EEVEE 实时引擎 + 鲜艳色彩。2026-11-21 20:30 起全片改用这一套。
# 太阳：仰角 42°，方位从 +X 朝 +Y 偏 65°（左前方高位侧光，地形有明暗层次）。
# =====================================================================
A_SUN_EL_DEG = 42.0
A_SUN_AZ_DEG = 65.0
_ael, _aaz = math.radians(A_SUN_EL_DEG), math.radians(A_SUN_AZ_DEG)
A_SUN_DIR = Vector((math.cos(_ael) * math.cos(_aaz), math.cos(_ael) * math.sin(_aaz), math.sin(_ael)))
A_SKY_ZENITH = (0.045, 0.22, 0.72)     # 天顶深蓝（线性）
A_SKY_HORIZON = (0.50, 0.74, 0.95)     # 地平线浅蓝
A_AMBIENT = (0.42, 0.60, 0.95)         # 环境天光颜色


def setup_anime(scene, res=(1920, 1080), pct=100, samples=32, motion_blur=True, fps=30):
    """EEVEE 动画风渲染设置 + 太阳灯 + 环境光。返回太阳灯物体。"""
    try:
        scene.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    ee = scene.eevee
    for name, val in (('taa_render_samples', samples), ('taa_samples', 16), ('use_raytracing', False),
                      ('use_shadows', True), ('shadow_ray_count', 2), ('shadow_step_count', 6),
                      ('use_volumetric_shadows', False), ('volumetric_samples', 32),
                      ('motion_blur_steps', 2), ('use_overscan', True), ('overscan_size', 5.0)):
        if hasattr(ee, name):
            try:
                setattr(ee, name, val)
            except Exception:
                pass
    _set_enum(ee, 'shadow_pool_size', ['1024', '512'])
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = pct
    scene.render.fps = fps
    scene.render.use_motion_blur = motion_blur
    scene.render.motion_blur_shutter = 0.5
    scene.render.film_transparent = False
    vs = scene.view_settings
    _set_enum(vs, 'view_transform', ['Standard'])
    for look in ('Medium High Contrast', 'None'):
        try:
            vs.look = look
            break
        except TypeError:
            continue
    vs.exposure = 0.0
    vs.gamma = 1.0
    # 环境光（天空穹顶由 SKY 集合里的网格负责，对相机可见）
    world = bpy.data.worlds.get('WK_AnimeWorld') or bpy.data.worlds.new('WK_AnimeWorld')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (*A_AMBIENT, 1)
    bg.inputs['Strength'].default_value = 0.9
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    sun = bpy.data.objects.get('WK_Sun')
    if sun is None:
        ld = bpy.data.lights.new('WK_Sun', 'SUN')
        sun = bpy.data.objects.new('WK_Sun', ld)
        scene.collection.objects.link(sun)
    sun.data.energy = 4.2
    sun.data.color = (1.0, 0.95, 0.86)
    sun.data.angle = math.radians(2.5)
    if hasattr(sun.data, 'shadow_maximum_resolution'):
        sun.data.shadow_maximum_resolution = 0.05
    sun.rotation_euler = A_SUN_DIR.to_track_quat('Z', 'Y').to_euler()   # 灯的 -Z 是照射方向
    return sun
