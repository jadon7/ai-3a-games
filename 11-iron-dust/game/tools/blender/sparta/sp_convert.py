# sp_convert.py -- converts the externally built, rigidly skinned mechs (D:\ai3a\sparta) into the game's
# node-based frame format (joint empties + rigid mesh parts, as expected by the game model loader).
#   blender -b --factory-startup -P sp_convert.py -- [sparta] [phalanx] [brute] [reaver] [equip] [equip_m] [--out <dir>]
# Default output: tools/blender/out (staging).  Inspect the output, then copy it into models/.
#   sparta / phalanx  mech 1 / mech 2 (friendly), equip   -> equip_s.glb (mech 2's rifle)
#   brute / reaver    mech 3 / mech 4 (enemy),    equip_m -> equip_m.glb (mech 3's bazooka, mech 4's sabre and back tube)
#
# Two posing modes (CFG 'pose'):
#   'rotate'  (sparta, phalanx) thigh / shin / arm parts are ROTATED so their bones hang vertically (see below);
#   'upright' (brute, reaver)   the source parts are modelled upright around slanted bones (bell / flared shins that sit
#             flat over the foot), so nothing is rotated: the shin, knee and foot are only translated, the thigh is
#             sheared so its top follows the hip, the arms stay as modelled.  The knee joint is the modelled knee; the
#             ankle and elbow JOINTS are put vertically below the knee / shoulder as the contract wants, which leaves
#             them a little inboard of the modelled ankle ball / elbow disc (both pitch about X, so it does not show).
#
# What it does per frame
#   * reads every mesh part of the source .blend at rest, split into connected islands (each island is 100 %
#     weighted to one bone), plus the armature's bone heads;
#   * scales (x17-18) and turns the model 180 deg about Z (source faces -Y, the game's authoring space faces +Y);
#   * poses the rigid parts into the contract's rest pose: thigh / shin rotated to vertical under a (slightly
#     widened) hip, upper arm / forearm+hand rotated to vertical under the shoulder, feet kept flat;
#   * builds the joint empties, maps bones -> joints and materials -> keys, splits the back skirt into BL / BR,
#     replaces the backpack thrusters by gimballed nozzle joints and adds the other required noz_* / mount_* / eye
#     / sole markers;
#   * bakes vertex colours with mk_geo.bake_colors and exports <id>.glb + <id>_dims.json (the FRAMES / style dims).
import bpy, bmesh, sys, os, json, math, time
from math import radians as rad, pi
from collections import defaultdict
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
if TOOLS not in sys.path:
    sys.path.insert(0, TOOLS)
import mk_geo, mk_parts
from mk_geo import Rig, bake_colors, build_objects, export_glb

SRC = r'D:\ai3a\sparta'
STAGE = os.path.join(TOOLS, 'out')

# source material -> game material key
KEY = {'M_Armor': 'A', 'M_Frame': 'F', 'M_Recess': 'T', 'M_Glow': 'G', 'M_Lamp': 'G', 'M_Metal': 'F', 'M_Lens': 'G',
       'M_RedPaint': 'C',
       # mech 3 / mech 4 palette: navy body = A, green = B, black panels = F (dark frame metal), eye / sensor lens = G
       'M_Navy': 'A', 'M_Green': 'B', 'M_Black': 'F', 'M_EyeGlow': 'G', 'M_Yellow': 'G', 'M_Gold': 'F'}
GLOW = ('M_Glow', 'M_EyeGlow')                  # the materials an eye / visor is made of
# rifle: armour shell -> weapon key
KEY_W = dict(KEY, M_Armor='W')
KEY_W3 = dict(KEY, M_Navy='W', M_Black='W')     # mech 3's bazooka: navy and black shell -> weapon key
# source parts whose armour becomes the secondary colour (key B); the rest of the armour is key A
B_PARTS = ('Abdomen_Upper', 'Abdomen_Lower', 'Pelvis', 'Backpack', 'Cannon', 'UpperArm', 'Elbow', 'Hand', 'Knee', 'Ankle',
           'Foot')

# All points below are in SOURCE coordinates (about 1 unit tall, front -Y, left = +X), given for the LEFT side.
CFG = {
    'sparta': dict(
        blend=os.path.join(SRC, 'output', 'Sparta_Mech.blend'), seed=31,
        # armour islands that become the accent colour (key C): (bone, bbox centre, tolerance)
        accent=[('spine_03', (0.0, -0.094, 0.75), 0.02),              # centre chest hatch
                ('shoulder_armor_l', (0.2815, 0.007, 0.775), 0.025)],  # left shoulder fin
        thrusters=[(0.036, 0.15, 0.728)],                              # backpack thruster islands to replace
        # nozzle: (bone, exit-plane centre, radius, length)
        noz_back=('backpack', (0.036, 0.170, 0.716), 0.024, 0.042),
        noz_leg=('calf_l', (0.138, 0.086, 0.140), 0.021, 0.034),
        noz_sh=('shoulder_armor_l', (0.2385, 0.052, 0.850), 0.011, 0.016),
        noz_front=('spine_02', (0.061, -0.1005, 0.700), 0.011, 0.019),
        mount_back=(0.062, 0.022, 0.925),
    ),
    'phalanx': dict(
        blend=os.path.join(SRC, 'mech2', 'output', 'Mech2.blend'), seed=32,
        accent=[],                                                     # M_RedPaint already maps to C
        thrusters=[(0.062, 0.178, 0.735)],
        noz_back=('backpack', (0.062, 0.197, 0.722), 0.021, 0.038),
        noz_leg=('calf_l', (0.132, 0.112, 0.182), 0.021, 0.034),
        noz_sh=('shoulder_armor_l', (0.2525, 0.02, 0.866), 0.010, 0.015),
        noz_front=('spine_02', (0.05, -0.0955, 0.708), 0.011, 0.019),
        mount_back=(0.066, 0.03, 0.915),
    ),
    # ---- enemy frames.  Extra options (all optional, the two frames above use none of them):
    #   pose='upright'   see the header;  hip_out = how far the leg column sits from the hip toward the knee (x and y)
    #   b_parts          source parts whose armour is key B (default B_PARTS);  w_parts: armour -> key W
    #   accent           a 4th element True also matches the mirrored island on the right side
    #   remove           [(bone, bbox centre, tolerance)] islands to delete on both sides (replaced by nozzle joints)
    #   drop             source parts left out of the frame (default ('Rifle',): the hand weapon goes to the equip file)
    #   skirt_extra      bones whose geometry counts as side skirt when the arms are moved clear of it
    #   arm_out_max      cap of that outward arm shift, in source units (default 0.045)
    'brute': dict(
        blend=os.path.join(SRC, 'mech3', 'output', 'Mech3.blend'), seed=33, pose='upright', hip_out=1.0,
        b_parts=(),                                                    # M_Green (pauldrons, skirts, foot soles) is key B
        accent=[],                                                     # M_RedPaint (crest, visor cross, sensor ring) is key C
        thrusters=[],                                                  # the single centre nozzle stays as a fixed detail
        noz_back=('backpack', (0.100, 0.150, 0.742), 0.022, 0.036),    # under the backpack's side boxes
        noz_leg=('calf_l', (0.155, 0.192, 0.138), 0.024, 0.036),       # rear face of the bell
        noz_sh=('shoulder_armor_l', (0.279, 0.032, 0.835), 0.011, 0.016),
        noz_front=('spine_02', (0.070, -0.094, 0.742), 0.011, 0.019),
        # back mounts: the shoulder blocks leave only a 1.2-wide slot beside the head, so a 1.2 x 1.2 x 6 weapon box
        # has to ride above them (the 0.3 clearance above the block top, which puts it at head-top height)
        mount_back=(0.106, 0.03, 1.0255),
    ),
    'reaver': dict(
        blend=os.path.join(SRC, 'mech4', 'output', 'Mech4.blend'), seed=34, pose='upright', hip_out=1.0,
        b_parts=('Abdomen_Upper', 'Abdomen_Lower', 'Pelvis', 'Backpack', 'Back_Tube', 'UpperArm', 'Elbow', 'Hand', 'Knee',
                 'Ankle', 'Foot'),
        w_parts=('Saber_Hilt',),                                       # the two stored hilts on the side skirts
        accent=[('shoulder_armor_l', (0.2344, 0.025, 0.9419), 0.01, True),   # pauldron spikes: top, front, rear
                ('shoulder_armor_l', (0.1949, -0.064, 0.8788), 0.01, True),
                ('shoulder_armor_l', (0.1949, 0.1107, 0.8859), 0.01, True),
                ('head', (0.0, -0.048, 1.027), 0.01),                        # blade antenna
                ('knee_l', (0.115, -0.113, 0.409), 0.01, True)],             # chevron on the knee guard
        thrusters=[],
        remove=[('backpack', (0.054, 0.165, 0.800), 0.02),             # backpack thruster bells (the collars stay)
                ('calf_l', (0.125, 0.154, 0.2185), 0.02)],             # calf thruster bell (its housing stays)
        skirt_extra=('saber',), arm_out_max=0.055,                     # arms just clear the stored hilts
        noz_back=('backpack', (0.054, 0.190, 0.795), 0.030, 0.045),
        noz_leg=('calf_l', (0.125, 0.161, 0.208), 0.023, 0.034),
        noz_sh=('shoulder_armor_l', (0.275, 0.025, 0.828), 0.011, 0.016),
        noz_front=('spine_02', (0.060, -0.092, 0.768), 0.011, 0.019),
        mount_back=(0.1057, 0.03, 0.992),                              # above the backpack, 0.3 clear of head and pauldron dome
    ),
}
TARGET_H = 19.0          # overall height (highest vertex) the scale factor aims at; rounded to 0.1


def _args():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def out_dir():
    a = _args()
    if '--out' in a and a.index('--out') + 1 < len(a):
        d = a[a.index('--out') + 1]
        if d.lower() == 'models':
            return os.path.normpath(os.path.join(TOOLS, '..', 'models'))
        if d.lower() == 'out':
            return STAGE
        return os.path.abspath(d)
    return STAGE


# ---------------------------------------------------------------------------------------------
# source reader
# ---------------------------------------------------------------------------------------------
def load_source(path):
    """-> (bone heads {name: Vector}, islands [dict(part, bone, v=[Vector], f=[(idx tuple, material name)])])"""
    bpy.ops.wm.open_mainfile(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    bones = {b.name: (arm.matrix_world @ b.head_local).copy() for b in arm.data.bones}
    isl = []
    for o in sorted(bpy.data.objects, key=lambda o: o.name):
        if o.type != 'MESH':
            continue
        me = o.data
        gn = {g.index: g.name for g in o.vertex_groups}
        vb = []
        for v in me.vertices:
            gs = [g for g in v.groups if g.weight > 0.5]
            assert len(gs) == 1, 'part %s is not rigidly skinned' % o.name
            vb.append(gn[gs[0].group])
        co = [o.matrix_world @ v.co for v in me.vertices]
        par = list(range(len(co)))

        def find(i):
            while par[i] != i:
                par[i] = par[par[i]]
                i = par[i]
            return i
        for p in me.polygons:
            r = find(p.vertices[0])
            for i in p.vertices[1:]:
                par[find(i)] = r
        comps = defaultdict(list)
        for p in me.polygons:
            comps[find(p.vertices[0])].append(p)
        mats = [m.name for m in me.materials]
        for root in sorted(comps):
            polys = comps[root]
            idx = {}
            vs = []
            fs = []
            for p in polys:
                f = []
                for i in p.vertices:
                    if i not in idx:
                        idx[i] = len(vs)
                        vs.append(co[i].copy())
                    f.append(idx[i])
                fs.append((tuple(f), mats[p.material_index]))
            bn = {vb[i] for i in idx}
            assert len(bn) == 1, 'island of %s spans bones %s' % (o.name, bn)
            isl.append(dict(part=o.name, bone=bn.pop(), v=vs, f=fs))
    return bones, isl


def bbox(vs):
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return mn, mx


def centre(vs):
    mn, mx = bbox(vs)
    return (mn + mx) / 2


def base_part(name):
    return name[:-2] if name.endswith(('_L', '_R')) else name


LEG_BONES = ('thigh', 'calf', 'knee', 'foot', 'toe')


def pick_scale(bones, isl, upright=False):
    """Scale so the posed frame's highest vertex is about TARGET_H."""
    th = (bones['calf_l'] - bones['thigh_l']).length
    sn = (bones['foot_l'] - bones['calf_l']).length
    dz = bones['foot_l'].z + th + sn - bones['thigh_l'].z      # the straightened legs are a little longer
    if upright:
        dz = 0.0                                               # 'upright' pose keeps every height of the source
    zmax = max(v.z for i in isl if not i['bone'].startswith(LEG_BONES) and i['part'] != 'Rifle' for v in i['v'])
    return round(TARGET_H / (zmax + dz), 1)


def rot_to_down(d):
    return d.normalized().rotation_difference(Vector((0, 0, -1)))


def Tr(v):
    return Matrix.Translation(v)


# ---------------------------------------------------------------------------------------------
# frame conversion
# ---------------------------------------------------------------------------------------------
def convert_frame(fid, out):
    t0 = time.time()
    cfg = CFG[fid]
    bones, isl = load_source(cfg['blend'])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    drop = cfg.get('drop', ('Rifle',))
    isl = [i for i in isl if base_part(i['part']) not in drop]
    upright = cfg.get('pose', 'rotate') == 'upright'
    S = cfg.get('scale') or pick_scale(bones, isl, upright)
    G = Matrix.Scale(S, 4) @ Matrix.Rotation(pi, 4, 'Z')         # source -> game authoring space (front +Y, right +X)
    T = {n: G @ p for n, p in bones.items()}
    for i in isl:
        i['w'] = [G @ v for v in i['v']]                         # unposed, scaled

    def src(p):
        return G @ Vector(p)

    # ---- leg lengths (rounded: these are the FRAMES thigh / shin the game reads back from the joints)
    if upright:
        # nothing is rotated, so the lengths are the vertical drops; the sole is lifted onto z = 0
        thigh = round(T['thigh_l'].z - T['calf_l'].z, 2)
        shin = round(T['calf_l'].z - T['foot_l'].z, 2)
        zsole = min(v.z for i in isl if i['bone'].startswith(('foot_', 'toe_')) for v in i['w'])
        ank_h = math.ceil((T['foot_l'].z - zsole) * 100 - 1e-6) / 100
        UA = round(T['upperarm_l'].z - T['lowerarm_l'].z, 2)
        FA = round(T['lowerarm_l'].z - T['hand_l'].z, 2)
    else:
        thigh = round((T['calf_l'] - T['thigh_l']).length, 2)
        shin = round((T['foot_l'] - T['calf_l']).length, 2)
        ank_h = round(T['foot_l'].z, 2)
        UA = round((T['lowerarm_l'] - T['upperarm_l']).length, 2)
        FA = round((T['hand_l'] - T['lowerarm_l']).length, 2)
    hip_z = ank_h + shin + thigh
    DZ = Vector((0, 0, hip_z - T['thigh_l'].z))
    UP = Tr(DZ)
    # the source stands with splayed legs: put the hip pivot half-way out to the knee so the straightened leg
    # keeps a believable stance (the hip ball is hidden by the skirts)
    hip_out = cfg.get('hip_out', 0.5)
    hip_w = round(abs(T['thigh_l'].x + hip_out * (T['calf_l'].x - T['thigh_l'].x)), 2)

    M = {}
    JW = {'frame': Vector((0, 0, 0)), 'pelvis': Vector((0, 0, hip_z))}
    JW['waist'] = T['spine_02'] + DZ
    JW['head'] = T['head'] + DZ
    JW['back'] = T['backpack'] + DZ
    for sfx, X, sg in (('_l', 'L', -1.0), ('_r', 'R', 1.0)):
        hip0, knee0, ank0 = T['thigh' + sfx], T['calf' + sfx], T['foot' + sfx]
        if upright:
            hipn = Vector((sg * hip_w, hip0.y + hip_out * (knee0.y - hip0.y), hip_z))
        else:
            hipn = Vector((sg * hip_w, hip0.y, hip_z))
        kneen = hipn - Vector((0, 0, thigh))
        ankn = kneen - Vector((0, 0, shin))
        if upright:
            # thigh: sheared, hip end on the hip joint and knee end on the knee joint, sections stay level
            d = (kneen - hipn) - (knee0 - hip0)
            A = Matrix.Identity(4)
            for r in range(3):
                A[r][2] -= d[r] / (hip0.z - knee0.z)
            M['thigh' + sfx] = Tr(hipn) @ A @ Tr(-hip0)
            # shin, knee cap and foot keep their modelled attitude: the bell stays level over the foot
            tc = kneen - knee0
            M['calf' + sfx] = Tr(tc)
            M['knee' + sfx] = Tr(tc)
            M['foot' + sfx] = M['toe' + sfx] = Tr(Vector((tc.x, tc.y, ank_h - ank0.z)))
        else:
            q_th = rot_to_down(knee0 - hip0)
            q_cf = rot_to_down(ank0 - knee0)
            q_kn = q_th.slerp(q_cf, 0.5)                         # the knee cap sits between thigh and shin
            M['thigh' + sfx] = Tr(hipn) @ q_th.to_matrix().to_4x4() @ Tr(-hip0)
            M['calf' + sfx] = Tr(kneen) @ q_cf.to_matrix().to_4x4() @ Tr(-knee0)
            M['knee' + sfx] = Tr(kneen) @ q_kn.to_matrix().to_4x4() @ Tr(-knee0)
            M['foot' + sfx] = M['toe' + sfx] = Tr(ankn - ank0)   # feet stay flat on the ground
        JW['hip_' + X], JW['knee_' + X], JW['ankle_' + X] = hipn, kneen, ankn
        JW['sole_' + X] = Vector((ankn.x, ankn.y, 0.0))
        for k, jn in (('skirt_f', 'skirt_F'), ('skirt_s', 'skirt_S')):
            JW[jn + X] = T[k + sfx] + DZ

    def arm_mats(arm_out):
        for sfx, X, sg in (('_l', 'L', -1.0), ('_r', 'R', 1.0)):
            sh0, el0, wr0 = T['upperarm' + sfx], T['lowerarm' + sfx], T['hand' + sfx]
            shn = sh0 + DZ + Vector((sg * arm_out, 0, 0))
            eln = shn - Vector((0, 0, UA))
            if upright:
                # the arm is modelled hanging straight: only shifted, the elbow joint goes below the shoulder
                M['upperarm' + sfx] = Tr(DZ + Vector((sg * arm_out, 0, 0)))
                M['lowerarm' + sfx] = Tr(DZ + Vector((sg * arm_out, 0, 0)))
            else:
                M['upperarm' + sfx] = Tr(shn) @ rot_to_down(el0 - sh0).to_matrix().to_4x4() @ Tr(-sh0)
                M['lowerarm' + sfx] = Tr(eln) @ rot_to_down(wr0 - el0).to_matrix().to_4x4() @ Tr(-el0)
            JW['sh_' + X] = JW['pauldron_' + X] = shn
            JW['el_' + X] = eln

    def mat_of(bone):
        if bone in M:
            return M[bone]
        if bone.startswith(('hand_', 'weapon_', 'index_', 'middle_', 'ring_', 'pinky_', 'thumb_')):
            return M['lowerarm' + bone[-2:]]                     # hand + fingers are one rigid part with the forearm
        return UP

    def posed(i):
        m = mat_of(i['bone'])
        return [m @ v for v in i['w']]

    # ---- arms: hanging straight down they would cut into the side skirts, so move the shoulder pivot outward
    # (under the pauldron) by just enough to clear them
    arm_mats(0.0)
    sk_bones = ('skirt_s_r',) + tuple(b + '_r' for b in cfg.get('skirt_extra', ()))
    sk = [v for i in isl if i['bone'] in sk_bones for v in posed(i)]
    zlo, zhi = min(v.z for v in sk), max(v.z for v in sk)
    sk_out = max(v.x for v in sk)
    arm_in = min(v.x for i in isl if i['bone'].endswith('_r') and mat_of(i['bone']) is M['lowerarm_r']
                 for v in posed(i) if zlo - 0.2 < v.z < zhi)
    arm_out = round(min(max(0.0, sk_out + 0.08 - arm_in), cfg.get('arm_out_max', 0.045) * S), 2)
    arm_mats(arm_out)

    # ---- back skirt: one plate in the source, two hinged halves in the contract
    sb = [v for i in isl if i['bone'] == 'skirt_b' for v in posed(i)]
    sb_half = max(abs(v.x) for v in sb) / 2
    for X, sg in (('L', -1.0), ('R', 1.0)):
        JW['skirt_B' + X] = T['skirt_b'] + DZ + Vector((sg * sb_half, 0, 0))

    BONE_JOINT = {'pelvis': 'pelvis', 'spine_01': 'pelvis', 'skirt_fc': 'pelvis', 'root': 'pelvis',
                  'spine_02': 'waist', 'spine_03': 'waist', 'neck': 'waist', 'head': 'head', 'backpack': 'back'}

    def joint_of(bone):
        if bone in BONE_JOINT:
            return BONE_JOINT[bone]
        X = bone[-1].upper()
        stem = bone[:-2]
        if stem in ('clavicle',):
            return 'waist'
        if stem in ('cannon', 'tube'):
            return 'back'
        if stem == 'saber':
            return 'skirt_S' + X                                 # stored hilt rides on the side skirt
        if stem == 'shoulder_armor':
            return 'pauldron_' + X
        if stem == 'upperarm':
            return 'sh_' + X
        if stem == 'thigh':
            return 'hip_' + X
        if stem in ('calf', 'knee'):
            return 'knee_' + X
        if stem in ('foot', 'toe'):
            return 'ankle_' + X
        if stem == 'skirt_f':
            return 'skirt_F' + X
        if stem == 'skirt_s':
            return 'skirt_S' + X
        return 'el_' + X                                         # lowerarm, hand, weapon, fingers

    # ---- rig
    R = Rig(seed=cfg['seed'])
    R.joint('frame')
    R.joint('pelvis', 'frame', JW['pelvis'])

    def J(name, parent, rot=(0, 0, 0)):
        R.joint(name, parent, JW[name] - JW[parent], rot)

    J('waist', 'pelvis')
    J('head', 'waist')
    J('back', 'waist')
    for X in 'LR':
        for k in ('skirt_F', 'skirt_S', 'skirt_B', 'hip_'):
            J(k + X, 'pelvis')
        J('knee_' + X, 'hip_' + X)
        J('ankle_' + X, 'knee_' + X)
        J('sole_' + X, 'ankle_' + X)
        J('pauldron_' + X, 'waist')
        J('sh_' + X, 'waist')
        J('el_' + X, 'sh_' + X)

    def emit(joint, verts, faces_keys):
        """faces_keys: [(idx tuple, key)], verts in world space; one R.add per key (per-island shade variation)."""
        by = defaultdict(list)
        for f, k in faces_keys:
            by[k].append(f)
        o = JW[joint]
        for k, fs in by.items():
            idx = {}
            vs = []
            out_f = []
            for f in fs:
                g = []
                for i in f:
                    if i not in idx:
                        idx[i] = len(vs)
                        vs.append(verts[i] - o)
                    g.append(idx[i])
                out_f.append(tuple(g))
            R.add(joint, k, vs, out_f)

    def other_side(bone):
        return bone[:-2] + '_r' if bone.endswith('_l') else bone

    def is_accent(i):
        c = centre(i['v'])
        for bone, cc, tol, *both in cfg['accent']:
            if i['bone'] == bone and (c - Vector(cc)).length < tol:
                return True
            if both and both[0] and i['bone'] == other_side(bone) and (Vector((-c.x, c.y, c.z)) - Vector(cc)).length < tol:
                return True
        return False

    def is_removed(i):
        c = centre(i['v'])
        for bone, cc, tol in cfg.get('remove', ()):
            if i['bone'] in (bone, other_side(bone)) and (Vector((abs(c.x), c.y, c.z)) - Vector(cc)).length < tol:
                return True
        return False

    def is_thruster(i):
        if i['bone'] != 'backpack':
            return False
        c = centre(i['v'])
        mn, mx = bbox(i['v'])
        if (mx - mn).length > 0.09:
            return False
        return any((Vector((abs(c.x), c.y, c.z)) - Vector(t)).length < 0.02 for t in cfg['thrusters'])

    removed = 0
    removed_x = 0
    b_parts = cfg.get('b_parts', B_PARTS)
    w_parts = cfg.get('w_parts', ())
    back_skirt = []
    geo = defaultdict(list)                                       # bone -> posed armour verts (for the style dims)
    allgeo = defaultdict(list)
    for i in isl:
        if is_thruster(i):
            removed += 1
            continue
        if is_removed(i):
            removed_x += 1
            continue
        pv = posed(i)
        acc = is_accent(i)
        sec = base_part(i['part']) in b_parts
        wpn = base_part(i['part']) in w_parts
        fk = []
        for f, m in i['f']:
            k = KEY[m]
            if k == 'A':
                k = 'C' if acc else ('W' if wpn else ('B' if sec else 'A'))
            fk.append((f, k))
        allgeo[i['bone']].extend(pv)
        if any(k in 'ABC' for _, k in fk):
            geo[i['bone']].extend(pv)
        if i['bone'] == 'skirt_b':
            back_skirt.append((pv, fk))
            continue
        emit(joint_of(i['bone']), pv, fk)
    assert removed == 2 * len(cfg['thrusters']), 'thruster islands found: %d' % removed
    assert removed_x >= 2 * len(cfg.get('remove', ())) and removed_x % 2 == 0, 'removed islands: %d' % removed_x

    # split the back skirt at x = 0 and cap the cut
    keys = sorted({k for _, fk in back_skirt for _, k in fk})
    for X, sg in (('L', -1.0), ('R', 1.0)):
        bm = bmesh.new()
        for pv, fk in back_skirt:
            vs = [bm.verts.new(v) for v in pv]
            for f, k in fk:
                try:
                    bm.faces.new([vs[a] for a in f]).material_index = keys.index(k)
                except ValueError:
                    pass
        r = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=(0, 0, 0),
                                   plane_no=(sg, 0, 0), clear_inner=True, clear_outer=False)
        cut = [e for e in r['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if cut:
            cap = bmesh.ops.holes_fill(bm, edges=cut, sides=0)['faces']
            for f in cap:
                f.material_index = keys.index('A') if 'A' in keys else 0
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.verts.index_update()
        emit('skirt_B' + X, [v.co.copy() for v in bm.verts], [(tuple(v.index for v in f.verts), keys[f.material_index]) for f in bm.faces])
        bm.free()

    # ---- markers
    glow = [i for i in isl if i['bone'] == 'head' and any(m in GLOW for _, m in i['f'])]
    vis = max(glow, key=lambda i: (bbox(i['w'])[1] - bbox(i['w'])[0]).length)
    vw = [UP @ v for v in vis['w']]
    mn, mx = bbox(vw)
    JW['eye'] = Vector((0.0, mx.y, (mn.z + mx.z) / 2))
    J('eye', 'head')

    def side_pt(bone_l, p):
        """source left-side point on a bone -> posed world point on the RIGHT side"""
        w = mat_of(bone_l) @ src(p)
        return Vector((abs(w.x), w.y, w.z))

    def noz(name, parent, spec, rot, n, plug):
        bone, p, r, L = spec
        pr = side_pt(bone, p)
        for X, mir in (('R', False), ('L', True)):
            par = parent.replace('*', X)
            pos = pr - Vector((abs(JW[par].x), JW[par].y, JW[par].z))
            mk_parts.nozzle(R, name + X, par, tuple(pos), rot, r * S, L * S, mirror=mir, n=n, plug=plug)

    noz('noz_back_', 'back', cfg['noz_back'], (rad(-50), 0, 0), 12, True)
    noz('noz_leg_', 'knee_*', cfg['noz_leg'], (rad(-38), 0, 0), 10, True)
    noz('noz_sh_', 'pauldron_*', cfg['noz_sh'], (0, rad(-75), 0), 8, False)
    noz('noz_front_', 'waist', cfg['noz_front'], (rad(36), 0, 0), 8, False)

    mb = side_pt('spine_03', cfg['mount_back'])
    for X, sg in (('L', -1.0), ('R', 1.0)):
        sfx = '_' + X.lower()
        el = JW['el_' + X]
        fore = [v - el for v in geo['lowerarm' + sfx]]
        grip = mat_of('weapon' + sfx) @ T['weapon' + sfx] - el
        R.joint('mount_hand_' + X, 'el_' + X, tuple(grip), (rad(-90), 0, 0))
        zc = -FA * 0.55
        outer = max(sg * v.x for v in fore if abs(v.z - zc) < 0.3 * FA)
        R.joint('mount_arm_' + X, 'el_' + X, (sg * (outer + 0.12), 0.0, zc))
        rear = min(v.y for v in fore if v.z < -FA * 0.4)
        R.joint('mount_blade_' + X, 'el_' + X, (0.0, rear - 0.17, -FA + 0.75))
        R.joint('mount_back_' + X, 'waist', tuple(Vector((sg * mb.x, mb.y, mb.z)) - JW['waist']))

    # ---- vertex colours, objects, export
    bake_colors(R, dust_h=hip_z, ground=True)
    build_objects(R)
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, fid + '.glb')
    export_glb(path)

    # ---- style dims measured from the converted model (same meaning as build_mechs.FRAMES / defs.gd style)
    def ext(bone, ax):
        vs = geo[bone]
        return max(v[ax] for v in vs) - min(v[ax] for v in vs)

    fsk = allgeo['skirt_f_r']
    dims = dict(
        thigh=thigh, shin=shin,
        leg_w=round((ext('thigh_r', 0) / 1.75 + ext('calf_r', 0) / 1.95) / 2, 2),
        hip_w=hip_w,
        torso_w=round(ext('spine_03', 0), 2), torso_h=round(ext('spine_03', 2), 2), torso_d=round(ext('spine_03', 1), 2),
        sh_w=round(min(ext('shoulder_armor_l', 0), ext('shoulder_armor_r', 0)), 2),
        arm_w=round(ext('lowerarm_r', 0) / 1.5, 2),
        skirt=round(((max(v.z for v in fsk) - min(v.z for v in fsk)) / 2.05) ** (1 / 0.85), 2),
    )
    wv = [v for b in R.bufs.values() for v in b['wv']]
    nodes = sum(1 for b in R.bufs.values() if b['f'])
    per = defaultdict(int)
    for (jn, mat), b in R.bufs.items():
        per[mat] += sum(len(f) - 2 for f in b['f'])
    info = dict(frame=fid, scale=S, dims=dims, height=round(max(v.z for v in wv), 2), zmin=round(min(v.z for v in wv), 3),
                half_width=round(max(v.x for v in wv), 2), hip=round(hip_z, 3), ankle_h=ank_h, UA=UA, FA=FA,
                shoulder_out=arm_out, head_top=round(max(v.z for v in allgeo['head']), 2),
                shoulder=[round(c, 2) for c in JW['sh_R']], waist_z=round(JW['waist'].z, 2), head_z=round(JW['head'].z, 2),
                tris=R.tris, mesh_nodes=nodes, joints=len(R.joints), tris_by_key=dict(per),
                optional=sorted(n for n in R.joints if n.startswith(('vent_', 'binder_', 'noz_back_2', 'noz_binder_'))),
                secs=round(time.time() - t0, 1))
    with open(os.path.join(out, fid + '_dims.json'), 'w') as fh:
        json.dump(info, fh, indent=1)
    print('BUILD', json.dumps(info))
    if R.tris > 45000 or nodes > 150 or not (18.0 <= info['height'] <= 19.5):
        print('WARNING: %s outside budget (tris %d / 45000, mesh nodes %d / 150, height %.2f / 18-19.5)' % (fid, R.tris, nodes, info['height']))
    return info


# ---------------------------------------------------------------------------------------------
# mech B's rifle -> equip_s.glb item g_m2rifle (grip at the origin, barrel +Y, top +Z, like build_equip.g_rifle)
# ---------------------------------------------------------------------------------------------
def convert_equip(out):
    bones, isl = load_source(CFG['phalanx']['blend'])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    S = CFG['phalanx'].get('scale') or pick_scale(bones, isl)
    # the source mounts the rifle in the right fist: grip at the weapon_r bone, turned +90 deg about X
    mount = Matrix.Translation(bones['weapon_r']) @ Matrix.Rotation(rad(90), 4, 'X')
    G = Matrix.Scale(S, 4) @ Matrix.Rotation(pi, 4, 'Z') @ mount.inverted()
    R = Rig(seed=44)
    name = 'g_m2rifle'
    R.joint(name)
    allv = []
    for i in isl:
        if i['part'] != 'Rifle':
            continue
        vs = [G @ v for v in i['v']]
        allv.extend(vs)
        by = defaultdict(list)
        for f, m in i['f']:
            by[KEY_W[m]].append(f)
        for k, fs in by.items():
            idx = {}
            vv = []
            ff = []
            for f in fs:
                g = []
                for a in f:
                    if a not in idx:
                        idx[a] = len(vv)
                        vv.append(vs[a])
                    g.append(idx[a])
                ff.append(tuple(g))
            R.add(name, k, vv, ff)
    ymax = max(v.y for v in allv)
    tip = [v for v in allv if v.y > ymax - 0.02]
    mz = Vector((0.0, ymax + 0.01, sum(v.z for v in tip) / len(tip)))
    R.joint(name + '_muzzle', name, tuple(mz))
    bake_colors(R, ground=False, flat_dust=0.1, maxd=1.6)
    build_objects(R)
    os.makedirs(out, exist_ok=True)
    export_glb(os.path.join(out, 'equip_s.glb'))
    mn, mx = bbox(allv)
    info = dict(item=name, scale=S, tris=R.tris, mesh_nodes=len(R.bufs), min=[round(c, 2) for c in mn], max=[round(c, 2) for c in mx],
                muzzle=[round(c, 2) for c in mz])
    with open(os.path.join(out, 'equip_s_dims.json'), 'w') as fh:
        json.dump(info, fh, indent=1)
    print('BUILD equip_s', json.dumps(info))
    return info


# ---------------------------------------------------------------------------------------------
# mech 3 / mech 4 equipment -> equip_m.glb.  Same conventions as the other libraries (build_equip.py):
#   g_m3bazooka  hand weapon (mount_hand_*): grip at the origin, barrel +Y, top +Z, marker g_m3bazooka_muzzle
#   g_m4tube     hand weapon made of one of mech 4's back tubes plus a plain grip, marker g_m4tube_muzzle
#   b_m4tube     the same tube as a back weapon (mount_back_*): origin under the mount base, marker b_m4tube_muzzle
#   m_m4saber    melee item (mount_blade_*): hilt behind the forearm, emitter toward -Z; the beam blade is the mesh of
#                the child joint m_m4saber_blade (origin at the emitter, blade along its -Z) so it can be hidden / scaled
# ---------------------------------------------------------------------------------------------
EQUIP_M = {'g_m3bazooka': ['g_m3bazooka_muzzle'], 'g_m4tube': ['g_m4tube_muzzle'], 'b_m4tube': ['b_m4tube_muzzle'],
           'm_m4saber': ['m_m4saber_blade']}
SPACING = 60.0


def read_fbx(path):
    """-> (verts, faces [(idx tuple, material name)]) of the one mesh in an FBX file, in Blender space"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.wm.fbx_import(filepath=path)
    except (AttributeError, RuntimeError):
        bpy.ops.import_scene.fbx(filepath=path)
    o = next(o for o in bpy.data.objects if o.type == 'MESH')
    mats = [m.name.split('.')[0] for m in o.data.materials]
    vs = [(o.matrix_world @ v.co).copy() for v in o.data.vertices]
    fs = [(tuple(p.vertices), mats[p.material_index]) for p in o.data.polygons]
    return vs, fs


def add_geo(R, joint, vs, faces, key):
    """One R.add per material key; vs are in the joint's space, faces = [(idx tuple, source material)]."""
    by = defaultdict(list)
    for f, m in faces:
        by[key[m]].append(f)
    for k, fs in by.items():
        idx = {}
        vv = []
        ff = []
        for f in fs:
            g = []
            for a in f:
                if a not in idx:
                    idx[a] = len(vv)
                    vv.append(vs[a])
                g.append(idx[a])
            ff.append(tuple(g))
        R.add(joint, k, vv, ff)


def convert_equip_m(out):
    # scales of the two frames the equipment belongs to
    b3, i3 = load_source(CFG['brute']['blend'])
    S3 = CFG['brute'].get('scale') or pick_scale(b3, i3, True)
    b4, i4 = load_source(CFG['reaver']['blend'])
    S4 = CFG['reaver'].get('scale') or pick_scale(b4, i4, True)
    hilt = [i for i in i4 if i['part'] == 'Saber_Hilt_L']
    tube = [i for i in i4 if i['part'] == 'Back_Tube_L']
    assert hilt and tube
    baz = read_fbx(os.path.join(SRC, 'mech3', 'output', 'Mech3_Bazooka.fbx'))
    blade = read_fbx(os.path.join(SRC, 'mech4', 'output', 'Mech4_SaberBlade.fbx'))
    bpy.ops.wm.read_factory_settings(use_empty=True)

    R = Rig(seed=45)
    items = {}
    n = [0]

    def item(name):
        R.joint(name, None, (n[0] * SPACING, 0, 0))
        n[0] += 1
        items[name] = dict(scale=None, pts=[], markers={})
        return name

    def marker(it, name, pos):
        R.joint(name, it, tuple(pos))
        items[it]['markers'][name] = [round(c, 2) for c in pos]

    # ---- bazooka (FBX: grip at the origin, barrel -Y, top +Z)
    it = item('g_m3bazooka')
    G3 = Matrix.Scale(S3, 4) @ Matrix.Rotation(pi, 4, 'Z')
    vs = [G3 @ v for v in baz[0]]
    add_geo(R, it, vs, baz[1], KEY_W3)
    ymax = max(v.y for v in vs)
    tip = [v for v in vs if v.y > ymax - 0.02]
    marker(it, it + '_muzzle', (0.0, ymax + 0.01, sum(v.z for v in tip) / len(tip)))
    items[it].update(scale=S3, pts=vs)

    # ---- back tube: local frame along the tube_l bone; u along the tube (0 at the backpack end), w = slotted rear face
    a = b4['tube_l']
    d = Vector(tube_dir(tube, a))
    side = d.cross(Vector((0, 1, 0))).normalized()
    back = side.cross(d).normalized()
    if back.y < 0:
        side, back = -side, -back
    uvw = []
    for i in tube:
        uvw.append([Vector(((v - a).dot(side), (v - a).dot(d), (v - a).dot(back))) * S4 for v in i['v']])
    u0 = min(p.y for ps in uvw for p in ps)
    u1 = max(p.y for ps in uvw for p in ps)
    hw = max(abs(p.z) for ps in uvw for p in ps)
    for it, y0, zt in (('g_m4tube', -2.6, 0.38 + hw), ('b_m4tube', -(u1 - u0) / 2 + 0.4, 0.68 + hw)):
        item(it)
        pts = []
        for i, ps in zip(tube, uvw):
            vs = [Vector((p.x, p.y - u0 + y0, p.z + zt)) for p in ps]
            pts.extend(vs)
            add_geo(R, it, vs, i['f'], KEY_W)
        p = R.pen(it)
        if it.startswith('g_'):
            p.box('F', (0.34, 0.5, 0.95), (0, -0.04, -0.02), (rad(12), 0, 0), bv=0.04)      # grip
            p.box('F', (0.3, 1.5, 0.3), (0, 0.45, 0.36), bv=0.03)                           # saddle under the tube
        else:
            p.cyl('F', 0.42, 0.16, (0, 0, 0.08), n=10)                                      # same base as build_equip.mount_base
            p.box('F', (0.9, 1.2, 0.7), (0, 0, 0.51), bv=0.06, tx=0.8)
        marker(it, it + '_muzzle', (0.0, y0 + (u1 - u0) + 0.01, zt))
        items[it].update(scale=S4, pts=[v for (jn, mk), b in R.bufs.items() if jn == it for v in b['v']])

    # ---- sabre: hilt turned emitter-down behind the forearm, beam blade on its own child joint
    it = item('m_m4saber')
    E = Vector((b4['saber_l'].x, b4['saber_l'].y, max(v.z for i in hilt for v in i['v'] if any(m != 'M_Recess' for _, m in i['f']))))
    Y0, Z0 = -0.05, -0.5
    pts = []
    for i in hilt:
        vs = [Vector((-S4 * (v.x - E.x), S4 * (v.y - E.y) + Y0, -S4 * (v.z - E.z) + Z0)) for v in i['v']]
        pts.extend(vs)
        add_geo(R, it, vs, i['f'], KEY_W)
    marker(it, it + '_blade', (0.0, Y0, Z0))
    vs = [Vector((-S4 * v.x, S4 * v.y, -S4 * v.z)) for v in blade[0]]
    add_geo(R, it + '_blade', vs, blade[1], KEY)
    pts.extend(Vector((v.x, v.y + Y0, v.z + Z0)) for v in vs)
    items[it].update(scale=S4, pts=pts)
    items[it]['markers']['tip'] = [0.0, Y0, round(min(v.z for v in pts), 2)]

    bake_colors(R, ground=False, flat_dust=0.1, maxd=1.6)
    for j in R.joints.values():
        if j.parent is None:
            j.local = Matrix.Identity(4)
    build_objects(R)
    os.makedirs(out, exist_ok=True)
    export_glb(os.path.join(out, 'equip_m.glb'))
    info = []
    for name, d in items.items():
        mn, mx = bbox(d['pts'])
        tris = sum(len(f) - 2 for (jn, mk), b in R.bufs.items() if jn == name or jn.startswith(name + '_') for f in b['f'])
        info.append(dict(item=name, scale=d['scale'], tris=tris, min=[round(c, 2) for c in mn], max=[round(c, 2) for c in mx],
                         markers=d['markers']))
    with open(os.path.join(out, 'equip_m_dims.json'), 'w') as fh:
        json.dump(info, fh, indent=1)
    print('BUILD equip_m', json.dumps(info))
    return info


def tube_dir(tube, a):
    """Unit axis of the back tube: from the bone head toward the farthest vertex of the tube body."""
    body = max(tube, key=lambda i: len(i['v']))
    c = centre(body['v'])
    return (c - a).normalized()


if __name__ == '__main__':
    a = _args()
    out = out_dir()
    ids = [x for x in a if x in CFG]
    eq = 'equip' in a
    eqm = 'equip_m' in a
    if not ids and not eq and not eqm:
        ids, eq, eqm = list(CFG), True, True
    for f in ids:
        convert_frame(f, out)
    if eq:
        convert_equip(out)
    if eqm:
        convert_equip_m(out)
