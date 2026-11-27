import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rigmath as RM, timeline as TL
import numpy as np
d = {"yaw": RM.yaw_c.tolist(), "pitch": RM.pitch_c.tolist(), "roll": RM.roll_c.tolist(), "vel": RM.vel.tolist(),
     "steps": RM.STEPS, "fps": TL.FPS, "frames": TL.F_END,
     "p_shots": TL.P_SHOTS, "e_shots": TL.E_SHOTS}
json.dump(d, open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "out", "camtrack.json"), "w"))
print("CAMTRACK OK", len(d["yaw"]))
