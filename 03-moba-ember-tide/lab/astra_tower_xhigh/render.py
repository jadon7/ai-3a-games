"""Background Cycles rendering. The asset under review is the delivered GLB."""
import math
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
scene=bpy.context.scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
file=ROOT/'out/tower_me_outer.glb'
bpy.ops.import_scene.gltf(filepath=str(file))
scene.render.engine='CYCLES'
scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.cycles.max_bounces=6
scene.cycles.transparent_max_bounces=2
scene.render.threads_mode='FIXED'
scene.render.threads=12
scene.view_settings.view_transform='Khronos PBR Neutral'
scene.view_settings.look='None'
world=bpy.data.worlds.new('Cool skylight')
scene.world=world;world.use_nodes=True
bg=world.node_tree.nodes.get('Background')
bg.inputs['Color'].default_value=(.87,.91,1.,1)
bg.inputs['Strength'].default_value=.50
def area(name,position,power,color,size,target):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=position
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    return obj
key=area('Broad window',(-4.9,-3.0,11.7),1040,(1,.942,.856),5.2,(0,0,3))
fill=area('Parchment bounce',(4.4,-4.5,6.5),160,(.84,.91,1),4.2,(0,0,2.9))
rim=area('Edge light',(1.9,3.7,9.9),780,(.85,.94,1),3.6,(0,0,4))
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.004))
ground=bpy.context.object
ground.is_shadow_catcher=True
scene.render.film_transparent=True
floor=bpy.data.materials.new('Backdrop');floor.use_nodes=True
p=floor.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.61,.583,.595,1)
p.inputs['Roughness'].default_value=.96
ground.data.materials.append(floor)
def camera(az,el,target,scale,game=False):
    if not scene.camera:
        data=bpy.data.cameras.new('Camera')
        cam=bpy.data.objects.new('Camera',data);scene.collection.objects.link(cam);scene.camera=cam
    cam=scene.camera;cam.data.type='ORTHO'
    a=math.radians(az);e=math.radians(el)
    direction=Vector((math.sin(a)*math.cos(e),-math.cos(a)*math.cos(e),math.sin(e)))
    cam.location=Vector((0,0,target))+direction*((20-target)/math.sin(e) if game else 22.)
    cam.rotation_euler=(-direction).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=scale
def render(path,w,h):
    scene.render.resolution_x=w;scene.render.resolution_y=h;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA' if scene.render.film_transparent else 'RGB'
    scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
camera(0,32.4,3.145,7.76)
render(ROOT/'out/render_design_angle.png',1086,1448)
for i in range(4):
    camera(90*i,32,3.20,7.94)
    render(ROOT/'out'/f'turntable_{i}.png',700,900)
ground.is_shadow_catcher=False;scene.render.film_transparent=False
# Grass-covered ground in the review scene only. Large patches and fine blades
# give scale to the footstones while preserving a clear shadow.
import random
rng=random.Random(1413)
nt=floor.node_tree
tc=nt.nodes.new('ShaderNodeTexCoord')
noise=nt.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=.73
noise.inputs['Detail'].default_value=4.;noise.inputs['Roughness'].default_value=.68
nt.links.new(tc.outputs['Object'],noise.inputs['Vector'])
ramp=nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position=.18;ramp.color_ramp.elements[0].color=(.079,.103,.036,1)
ramp.color_ramp.elements[1].position=.80;ramp.color_ramp.elements[1].color=(.256,.297,.093,1)
nt.links.new(noise.outputs['Fac'],ramp.inputs['Fac']);nt.links.new(ramp.outputs['Color'],p.inputs['Base Color'])
bump=nt.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.15;bump.inputs['Distance'].default_value=.06
nt.links.new(noise.outputs['Fac'],bump.inputs['Height']);nt.links.new(bump.outputs['Normal'],p.inputs['Normal'])
verts=[];faces=[];mids=[]
for k in range(4400):
    x,y=rng.uniform(-8,8),rng.uniform(-11,11)
    if x*x+y*y<3.04:continue
    count=rng.randrange(2,6)
    for b in range(count):
        bx=x+rng.uniform(-.06,.06);by=y+rng.uniform(-.06,.06);h=rng.uniform(.018,.071)
        wid=rng.uniform(.005,.012);a=rng.uniform(0,6.283)
        dx=math.cos(a);dy=math.sin(a)
        u=len(verts);verts.extend([(bx-wid*dx,by-wid*dy,-.003),(bx+wid*dx,by+wid*dy,-.003),
                 (bx+h*(.6+.6*dy),by+h*(.4-.3*dx),h)])
        faces.append((u,u+1,u+2));mids.append(rng.randrange(4))
mesh=bpy.data.meshes.new('Groundcover');mesh.from_pydata(verts,[],faces);mesh.update()
grass=bpy.data.objects.new('Groundcover',mesh);scene.collection.objects.link(grass)
for ci in [(.145,.176,.053,1),(.212,.239,.086,1),(.094,.133,.046,1),(.265,.255,.099,1)]:
    m=bpy.data.materials.new('Grass');m.diffuse_color=ci;m.use_nodes=True
    shader=m.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=ci;shader.inputs['Roughness'].default_value=.91
    mesh.materials.append(m)
for f,idx in zip(mesh.polygons,mids):f.material_index=idx
sun=bpy.data.lights.new('Sun','SUN');sun.energy=3.1;sun.angle=math.radians(3.2);sun.color=(1,.89,.70)
sob=bpy.data.objects.new('Sun',sun);scene.collection.objects.link(sob)
sob.rotation_euler=Vector((1.01,-.28,-1.22)).to_track_quat('-Z','Y').to_euler()
key.data.energy=180;fill.data.energy=95;rim.data.energy=150;bg.inputs['Strength'].default_value=.52
camera(-6,56,2.84,12.35,True)
render(ROOT/'out/render_game_angle.png',1600,900)
