# 正式渲染前的收尾：切换到修正后的烟雾缓存、确认渲染参数
import bpy, os

ROOT = "/Users/jadon7/Library/Application Support/Claude/scratch-workspaces/dfe2b44a-8503-4a5e-af9b-63b1be0e053b/aae3434b-694f-413f-a991-1f79c427025e/scratch-2026-11-21-ab6c85/racing"
sc = bpy.context.scene
D = bpy.data.objects

CACHE = os.path.join(ROOT, "cache/smoke2")
v = D["TyreSmoke"].data
v.filepath = os.path.join(CACHE, "smoke_0001.vdb")
v.is_sequence = True
v.frame_duration = sc.frame_end
v.frame_start = 1
v.frame_offset = 0
v.sequence_mode = 'CLIP'
if "WaterMist" in D:
    D["WaterMist"].hide_render = True
    D["WaterMist"].hide_viewport = True

cy = sc.cycles
cy.samples = 80
cy.use_adaptive_sampling = True
cy.adaptive_threshold = 0.02
cy.use_denoising = True
cy.volume_bounces = 1
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.5
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.resolution_percentage = 100
sc.render.use_persistent_data = True
print("FINALIZE_OK", v.filepath)
