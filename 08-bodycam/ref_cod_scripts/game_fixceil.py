"""Match the video's shot tweaks in the game bake scene: ceilings (Slab/Bridge/UpCeil, joined into CH_arch with
plaster_white) use 'ceiling_white' like build_shot.py did."""
import bpy, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import principled
M = principled("ceiling_white", (0.86, 0.86, 0.85), rough=0.85, noise_rough=0.05)
ob = bpy.data.objects["CH_arch"]; me = ob.data
if "ceiling_white" not in [m.name for m in me.materials]:
    me.materials.append(M)
ci = [m.name for m in me.materials].index("ceiling_white")
pi = [m.name for m in me.materials].index("plaster_white")
n = 0
for p in me.polygons:
    if p.material_index == pi:
        p.material_index = ci; n += 1
print("reassigned", n)
bpy.ops.wm.save_mainfile()
