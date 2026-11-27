"""镜头/渲染公共函数：打开城市、摆车、追尾相机、EXR 输出。"""
import bpy, os, math
from mathutils import Vector
from common import *
from track import *

T = main_track()


def open_city():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, "blend", "city.blend"))
    return bpy.context.scene


def setup_exr(sc, path, samples=96, res=(1920, 1080), pct=100):
    """输出线性 EXR，alpha 通道里存雾（0..1 对应 0..1000 米）。"""
    setup_cycles(sc, samples=samples, res=res, pct=pct)
    vl = sc.view_layers[0]
    vl.use_pass_mist = True
    ms = sc.world.mist_settings
    ms.start = 0.0; ms.depth = 1000.0; ms.falloff = "LINEAR"
    if sc.compositing_node_group is None:
        ng = bpy.data.node_groups.new("comp_mist", "CompositorNodeTree")
        sc.compositing_node_group = ng
        rl = ng.nodes.new("CompositorNodeRLayers")
        ng.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        out = ng.nodes.new("NodeGroupOutput")
        sep = ng.nodes.new("CompositorNodeSeparateColor")
        cmb = ng.nodes.new("CompositorNodeCombineColor")
        ng.links.new(rl.outputs["Image"], sep.inputs[0])
        for i in range(3):
            ng.links.new(sep.outputs[i], cmb.inputs[i])
        ng.links.new(rl.outputs["Mist"], cmb.inputs[3])
        ng.links.new(cmb.outputs[0], out.inputs[0])
    sc.render.use_compositing = True
    im = sc.render.image_settings
    im.file_format = "OPEN_EXR"
    im.color_mode = "RGBA"
    im.color_depth = "16"
    im.exr_codec = "DWAA"
    sc.render.filepath = path


def place_car(car, s, d=0.0, yaw=0.0, steer=0.0):
    x, y, z = T.xyz(s, d)
    h = T.heading(s)
    r = car["root"]
    r.rotation_mode = "XYZ"
    r.location = (x, y, z)
    r.rotation_euler = (0.0, -math.atan(T.slope(s)), h + yaw)
    for q in ("FL", "FR"):
        car["steer"][q].rotation_euler = (0, 0, steer)


def chase_cam(sc, s, d=0.0, dist=8.0, height=2.1, fov=78.0, look_ahead=6.0, look_z=1.0, name="cam"):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.sensor_width = 36.0
    cam.data.lens = 18.0 / math.tan(math.radians(fov) / 2)
    cam.data.clip_start = 0.2; cam.data.clip_end = 6000
    x, y, z = T.xyz(s - dist, d)
    cam.location = (x, y, z + height)
    tx, ty, tz = T.xyz(s + look_ahead, d)
    cam.rotation_euler = (Vector((tx, ty, tz + look_z)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    return cam
