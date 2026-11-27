import bpy
def enable_gpu():
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    used = []
    for d in prefs.devices:
        d.use = (d.type == "METAL")
        if d.use: used.append(d.name)
    sc = bpy.context.scene
    sc.cycles.device = "GPU"
    try: sc.cycles.denoising_use_gpu = True
    except Exception: pass
    print("GPU devices:", used)
