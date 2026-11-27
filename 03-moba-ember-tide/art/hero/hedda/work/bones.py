import bpy, sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[sys.argv.index("--")+1])
arm=next(o for o in bpy.context.scene.objects if o.type=="ARMATURE")
for n in ["Hips","Spine2","Neck","Head","LeftShoulder","LeftArm","LeftForeArm","LeftHand","LeftHandMiddle1","RightArm","RightForeArm","RightHand","LeftUpLeg","LeftLeg","LeftFoot","LeftToeBase","RightFoot"]:
    b=arm.data.bones["mixamorig:"+n]; print("B", n, [round(x,3) for x in b.head_local], "len", round(b.length,3))
