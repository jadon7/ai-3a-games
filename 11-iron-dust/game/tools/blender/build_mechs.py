# build_mechs.py -- generates <frame>.glb for the four friendly IRON DUST tactical frames.
# Run:  blender -b --factory-startup -P build_mechs.py -- [--out <dir>] [frame_id ...]
#
# Output directory (read by the project build helpers):
#   default            tools/blender/out      (staging: build + verify here)
#   --out models       <project>/models       (the live game folder)
#   --out <path>       any other directory
#   env MK_OUT=<path>  same as --out
# Use  mk_run_f.ps1 install  to copy verified files from out/ into models/.
import bpy, sys, os, time, json
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import mk_geo, mk_parts
from mk_geo import reset_scene, bake_colors, build_objects, export_glb

MODELS = os.path.normpath(os.path.join(HERE, '..', '..', 'models'))
STAGE = os.path.join(HERE, 'out')


def _args():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def _out_dir():
    a = _args()
    d = None
    if '--out' in a and a.index('--out') + 1 < len(a):
        d = a[a.index('--out') + 1]
    elif os.environ.get('MK_OUT'):
        d = os.environ['MK_OUT']
    if not d:
        return STAGE
    if d.lower() == 'models':
        return MODELS
    if d.lower() == 'out':
        return STAGE
    return os.path.abspath(d)


OUT = _out_dir()

# style dims mirror scripts/defs.gd FRAMES[*].style
FRAMES = {
    # TF-07 all-rounder, sensor-scan skill: boxy trooper, visor head, sensor pod on the right shoulder
    'kestrel': dict(thigh=3.9, shin=4.2, leg_w=1.0, hip_w=1.7, torso_w=5.4, torso_h=3.0, torso_d=3.4, sh_w=2.5, arm_w=1.0, skirt=1.0,
                    leg='std', chest='slab', head='visor', sh='block', back='twin', pod=True, trim_f='C', seed=7),
    # TF-12 heavy fire support / ram charge: thick shins, big shoulder blocks, four-nozzle pack
    'bastion': dict(thigh=3.6, shin=4.0, leg_w=1.3, hip_w=2.0, torso_w=6.6, torso_h=3.4, torso_d=4.2, sh_w=3.0, arm_w=1.25, skirt=1.3,
                    leg='heavy', chest='slab', era=True, head='turret', head_hw=1.3, head_s=1.0, collar_h=0.9, head_z=0.1, head_y=0.2,
                    sh='heavy', back='heavy', trim_s='H', seed=12),
    # TF-03 light high-mobility assault: lean, lens-cluster head, wing binders
    'shrike': dict(thigh=4.0, shin=4.6, leg_w=0.82, hip_w=1.5, torso_w=4.6, torso_h=2.8, torso_d=3.0, sh_w=2.1, arm_w=0.85, skirt=0.75,
                   leg='slim', chest='keel', prow=1.0, pec_far=0.6, pec_shift=-0.45, head='cluster', head_hw=0.8,
                   sh='slim', back='wing', trim_f='C', armoured=False, seed=3),
    # TF-09 long-range sniper / support: long legs with flared calves, propellant tank + stabiliser binders, scope head
    'heron': dict(thigh=4.1, shin=4.7, leg_w=0.86, hip_w=1.5, torso_w=4.7, torso_h=2.8, torso_d=3.0, sh_w=2.1, arm_w=0.85, skirt=0.8,
                  leg='flare', chest='keel', prow=0.9, pec_far=0.66, pec_shift=-0.38, head='scope', head_hw=0.8,
                  sh='cap', back='tank', trim_f='C', seed=9),
}


def build(fid):
    t0 = time.time()
    reset_scene()
    R, P = mk_parts.build_frame(FRAMES[fid])
    bake_colors(R, dust_h=P['hip_z'], ground=True)
    build_objects(R)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, fid + '.glb')
    export_glb(path)
    zmax = max(v.z for b in R.bufs.values() for v in b['wv'])
    zmin = min(v.z for b in R.bufs.values() for v in b['wv'])
    xmax = max(v.x for b in R.bufs.values() for v in b['wv'])
    opt = sorted(n for n in R.joints if n.startswith(('vent_', 'binder_', 'noz_back_2', 'noz_binder_')))
    nodes = sum(1 for b in R.bufs.values() if b['f'])
    info = dict(frame=fid, out=OUT, height=round(zmax, 2), zmin=round(zmin, 3), half_width=round(xmax, 2), hip=round(P['hip_z'], 3),
                tris=R.tris, joints=len(R.joints), meshes=nodes, optional=opt, secs=round(time.time() - t0, 1))
    print('BUILD', json.dumps(info))
    if R.tris > 45000 or nodes > 150 or not (17.0 <= zmax <= 21.0):
        print('WARNING: %s over budget (tris %d / 45000, mesh nodes %d / 150, height %.2f / 17-21)' % (fid, R.tris, nodes, zmax))
    return info


if __name__ == '__main__':
    ids = [a for a in _args() if a in FRAMES] or list(FRAMES)
    infos = [build(f) for f in ids]
    os.makedirs(os.path.join(HERE, 'preview'), exist_ok=True)
    with open(os.path.join(HERE, 'preview', 'build_info.json'), 'w' if len(ids) == len(FRAMES) else 'a') as fh:
        for i in infos:
            fh.write(json.dumps(i) + '\n')
