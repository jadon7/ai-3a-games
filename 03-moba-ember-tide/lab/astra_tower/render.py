import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
OUT=ROOT/'out'
mode=sys.argv[sys.argv.index('--')+1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(OUT/'tower_me_outer.glb'))
s=bpy.context.scene
s.render.engine='CYCLES';s.cycles.samples=20 if mode=='final' else 8;s.cycles.use_denoising=True
s.render.threads_mode='FIXED';s.render.threads=12
s.world=bpy.data.worlds.new('Studio skylight');s.world.use_nodes=True
s.world.node_tree.nodes['Background'].inputs[0].default_value=(.81,.87,.92,1)
s.world.node_tree.nodes['Background'].inputs[1].default_value=.68
s.view_settings.view_transform='AgX' if mode=='1' else 'Khronos PBR Neutral'
bpy.ops.mesh.primitive_plane_add(size=240,location=(0,0,-.012));ground=bpy.context.object
mat=bpy.data.materials.new('Cyclorama');mat.use_nodes=True;bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.475,.456,.45,1);bs.inputs['Roughness'].default_value=1;ground.data.materials.append(mat)
def light(name,pos,power,size,color):
    bpy.ops.object.light_add(type='AREA',location=pos);ob=bpy.context.object;ob.name=name;ob.data.energy=power;ob.data.shape='DISK';ob.data.size=size;ob.data.color=color;ob.rotation_euler=(Vector((0,0,3.3))-ob.location).to_track_quat('-Z','Y').to_euler();return ob
key=light('Large north window',(-5,-4,11),900,5,(1,.90,.77));light('Cool return',(4,-2,7),380,5,(.8,.91,1));light('High edge',(.4,5,9),760,4,(.97,1,1))
if mode in ('5','final'):
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;mix=nodes.new('ShaderNodeMixShader');mix.inputs[0].default_value=.52;flat=nodes.new('ShaderNodeEmission');flat.inputs[0].default_value=(.49,.475,.477,1);links.new(bs.outputs[0],mix.inputs[1]);links.new(flat.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],nodes.get('Material Output').inputs[0])
bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.data.type='ORTHO'
def frame(az,el,scale,center,width,height,name):
    ang=math.radians(az);el=math.radians(el);unit=Vector((math.cos(ang)*math.cos(el),math.sin(ang)*math.cos(el),math.sin(el)));cam.location=Vector((0,0,center))+unit*((20-center)/math.sin(el) if name=='render_game_angle' else 20);cam.rotation_euler=(-unit).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=scale;s.render.resolution_x=width;s.render.resolution_y=height;s.render.resolution_percentage=100;s.render.filepath=str(OUT/(name+'.png'));bpy.ops.render.render(write_still=True)
if mode=='final':
    frame(-90,34,7.61,3.22,1086,1448,'render_design_angle')
    for index in range(4):frame(-90+90*index,28,8.05,3.50,640,800,'turntable_'+str(index))
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;tex=nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=1.35;tex.inputs['Detail'].default_value=2.5;coord=nodes.new('ShaderNodeTexCoord');links.new(coord.outputs['Object'],tex.inputs[0]);ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.085,.117,.043,1);ramp.color_ramp.elements[1].color=(.23,.29,.095,1);links.new(tex.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs[0],bs.inputs['Base Color']);key.data.size=2.0
    links.new(bs.outputs[0],nodes.get('Material Output').inputs[0]);bpy.ops.object.light_add(type='SUN',location=(-7,-4,12));sun=bpy.context.object;sun.rotation_euler=Vector((.94,.22,-1)).to_track_quat('-Z','Y').to_euler();sun.data.energy=4.0;sun.data.angle=.045;key.data.energy=160;key.location.z=18;s.world.node_tree.nodes['Background'].inputs[1].default_value=.26
    for lamp in bpy.data.objects:
        if lamp.type=='LIGHT' and lamp.data.type=='AREA':lamp.data.energy*=.55
    frame(-90,56,13.1,3.15,1600,900,'render_game_angle')
else:frame(-90,34,7.36 if mode=='1' else 7.61,3.35 if mode=='1' else 3.22,480,640,'rounds/model_'+mode)
