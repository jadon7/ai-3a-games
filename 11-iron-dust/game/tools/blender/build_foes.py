# build_foes.py -- generates <frame>.glb for the enemy frames (mk_foe.py + mk_foe_top.py).
# Run:  blender -b --factory-startup -P build_foes.py -- [frame_id ...] [--out <dir>]
# Default output is tools/blender/out; copy a built file into models/ after inspecting it.
import bpy, sys, os, time, json
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import mk_geo
import mk_foe
from mk_geo import reset_scene, bake_colors, build_objects, export_glb

OUT = os.path.join(HERE, 'out')

# style dims: mirror them in scripts/defs.gd FRAMES[*].style
FRAMES = {
    'hound': dict(thigh=3.8, shin=4.0, leg_w=1.05, hip_w=1.7, torso_w=5.2, torso_h=3.0, torso_d=3.5, sh_w=2.5, arm_w=1.0, skirt=1.1,
                  fam='ef', leg='flare', chest='cuirass', head='sallet', sh_R='spike', sh_L='slab', arm='round', back='pack', seed=21),
    'mauler': dict(thigh=3.6, shin=4.0, leg_w=1.3, hip_w=2.0, torso_w=6.4, torso_h=3.4, torso_d=4.2, sh_w=2.9, arm_w=1.2, skirt=1.3,
                   fam='ef', leg='hover', chest='bulwark', head='pot', head_s=1.1, collar_r=1.6, sh='spike2', arm='heavy', fore_s=1.12,
                   back='heavy', flare=1.3, foot_w=1.08, skirt_heavy=True, seed=5),
    'revenant': dict(thigh=4.1, shin=4.6, leg_w=0.9, hip_w=1.6, torso_w=5.0, torso_h=3.0, torso_d=3.2, sh_w=2.3, arm_w=0.9, skirt=0.85,
                     fam='ex', leg='blade', chest='keel', head='crest', head_s=1.4, head_z=0.2, head_y=0.3, sh='fin', arm='angular',
                     back='wing', seed=9),
    'ripper': dict(thigh=2.9, shin=3.1, leg_w=1.25, hip_w=1.8, torso_w=6.2, torso_h=4.9, torso_d=5.0, sh_w=2.4, arm_w=1.15, skirt=0.5,
                   fam='ef', leg='bulb', chest='cowl', head='cowl', head_s=1.0, sh='ball', arm='gauntlet', fore_s=1.0, back='hump',
                   zb=0.5, shx=3.75, girdle_e=2.8, thigh_b=1.2, flare=1.1, foot_w=1.2, UA=2.6, FA=3.2, seed=33),
}


def build(fid, out):
    t0 = time.time()
    reset_scene()
    R, P = mk_foe.build_frame(FRAMES[fid])
    bake_colors(R, dust_h=P['hip_z'], ground=True)
    build_objects(R)
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, fid + '.glb')
    export_glb(path)
    zmax = max(v.z for b in R.bufs.values() for v in b['wv'])
    zmin = min(v.z for b in R.bufs.values() for v in b['wv'])
    xmax = max(v.x for b in R.bufs.values() for v in b['wv'])
    opt = [n for n in R.joints if n.startswith(('vent_', 'binder_', 'noz_back_2', 'noz_binder_'))]
    per = {}
    for (jn, mat), b in R.bufs.items():
        per[mat] = per.get(mat, 0) + sum(len(f) - 2 for f in b['f'])
    info = dict(frame=fid, height=round(zmax, 2), zmin=round(zmin, 3), half_width=round(xmax, 2), hip=round(P['hip_z'], 3),
                tris=R.tris, joints=len(R.joints), meshes=len(R.bufs), tris_by_mat=per, optional=opt, secs=round(time.time() - t0, 1))
    print('BUILD', json.dumps(info))
    return info


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = OUT
    if '--out' in args:
        out = os.path.abspath(args[args.index('--out') + 1])
    ids = [a for a in args if a in FRAMES] or list(FRAMES)
    infos = [build(f, out) for f in ids]
    with open(os.path.join(out, 'build_info_foe.json'), 'a') as fh:
        for i in infos:
            fh.write(json.dumps(i) + '\n')
