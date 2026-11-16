#!/usr/bin/env python3
"""Retargets a Mixamo FBX animation (binary FBX, "with skin" or "without skin") onto the knight's rig and writes a *-data.json clip.

    python3 scripts/retarget-mixamo.py Heavy_Weapon_Swing.fbx heavyweaponswing-data.json --name Heavy_Weapon_Swing
    python3 scripts/retarget-mixamo.py 2hand_Idle.fbx twohandidle-data.json --name 2hand_Idle

Then add the file to manifest.json (id = file name without .json, type application/json, size in bytes) and its id to the clip list in js/02-knight.js.
Needs numpy and scipy. It reads the FBX itself (no Blender / FBX SDK).

How the retarget works
  * Forward kinematics of the Mixamo skeleton (PreRotation * Lcl Rotation, FBX XYZ order) gives each bone's world rotation per frame. The knight's bones all sit at identity in the rest pose
    (a T-pose facing +Z, like Mixamo's), so a bone's world rotation DELTA from rest (anim * inverse(rest)) can be copied straight across:
    Root_Hips <- Hips, Torso <- Spine2, Head <- Head, Left/Right_Leg <- UpLeg, Left/Right_Shin <- Leg. The Head is a root node in this rig, so it gets a position track
    (hips + torso + head offsets), exactly like the UAL clips.
  * The knight has no collar bones and its arms are longer than Mixamo's, so the arms are solved afterwards: a two-bone IK puts each fist where the Mixamo hand is (measured from the shoulder midpoint, scaled
    by the arm length ratio), with the Mixamo elbow as the pole vector. The delta rotation keeps the twist, only its aim is corrected. This keeps both hands on the weapon.
  * Root_Hips moves by the Mixamo hips' movement times (knight hips height / Mixamo hips height). Feet are not pinned: ualGround() in js/06-swoosh-helmets.js lowers / raises the rig so his lowest foot is on the floor.
"""
import argparse
import json
import struct
import sys
import zlib

import numpy as np
from scipy.spatial.transform import Rotation as R


def read_node(f, ver):
    if ver >= 7500:
        hdr = f.read(25); end, nprop, plen = struct.unpack('<QQQ', hdr[:24]); nlen = hdr[24]
    else:
        hdr = f.read(13); end, nprop, plen = struct.unpack('<III', hdr[:12]); nlen = hdr[12]
    if end == 0: return None
    name = f.read(nlen).decode('latin1')
    props = []
    for _ in range(nprop):
        t = f.read(1).decode('latin1')
        if t in 'YCIFDL':
            fmt = {'Y':'<h','C':'<b','I':'<i','F':'<f','D':'<d','L':'<q'}[t]
            props.append(struct.unpack(fmt, f.read(struct.calcsize(fmt)))[0])
        elif t in 'fdilb':
            n, enc, clen = struct.unpack('<III', f.read(12))
            raw = f.read(clen)
            if enc: raw = zlib.decompress(raw)
            dt = {'f':'<f4','d':'<f8','i':'<i4','l':'<i8','b':'u1'}[t]
            props.append(np.frombuffer(raw, dtype=dt, count=n))
        elif t == 'S':
            n = struct.unpack('<I', f.read(4))[0]; props.append(f.read(n).decode('latin1'))
        elif t == 'R':
            n = struct.unpack('<I', f.read(4))[0]; props.append(f.read(n))
    children = []
    while f.tell() < end:
        c = read_node(f, ver)
        if c is None: break
        children.append(c)
    f.seek(end)
    return (name, props, children)

def parse(path):
    f = open(path, 'rb'); f.read(23)
    ver = struct.unpack('<I', f.read(4))[0]
    nodes = []
    while True:
        try:
            n = read_node(f, ver)
        except Exception as e:
            break
        if n is None: break
        nodes.append(n)
    return ver, nodes

def find(nodes, name):
    return [n for n in nodes if n[0] == name]



def load(path):
    ver, nodes = parse(path)
    obj = find(nodes,'Objects')[0][2]
    conns = find(nodes,'Connections')[0][2]
    byid = {n[1][0]: n for n in obj if n[1] and isinstance(n[1][0], (int, np.integer))}
    models = {}
    for n in obj:
        if n[0]=='Model':
            props = {}
            for ch in n[2]:
                if ch[0]=='Properties70':
                    for pp in ch[2]:
                        try: props[pp[1][0]] = [float(x) for x in pp[1][4:]]
                        except (ValueError, TypeError): pass
            models[n[1][0]] = dict(name=n[1][1].split('\x00')[0].replace('mixamorig:',''), type=n[1][2], props=props, id=n[1][0])
    parent = {}
    for c in conns:
        p = c[1]
        if p[0]=='OO' and p[1] in models and p[2] in models: parent[p[1]] = p[2]
    # animation: curve -> curvenode(prop d|X d|Y d|Z) -> model(property)
    cn = {n[1][0]: n for n in obj if n[0]=='AnimationCurveNode'}
    curves = {n[1][0]: n for n in obj if n[0]=='AnimationCurve'}
    layers = {n[1][0]: n for n in obj if n[0]=='AnimationLayer'}
    node_target = {}   # curvenode id -> (model id, prop)
    node_curves = {}   # curvenode id -> {axis: curve id}
    node_layer = {}
    for c in conns:
        p = c[1]
        if p[0]=='OP' and p[1] in cn and p[2] in models: node_target[p[1]] = (p[2], p[3])
        if p[0]=='OP' and p[1] in curves and p[2] in cn: node_curves.setdefault(p[2], {})[p[3]] = p[1]
        if p[0]=='OO' and p[1] in cn and p[2] in layers: node_layer[p[1]] = p[2]
    out = {}
    for nid,(mid,prop) in node_target.items():
        axes = {}
        for ax, cid in node_curves.get(nid,{}).items():
            cnode = curves[cid]
            t = v = None
            for ch in cnode[2]:
                if ch[0]=='KeyTime': t = ch[1][0].astype(np.float64)/46186158000.0
                if ch[0]=='KeyValueFloat': v = ch[1][0].astype(np.float64)
            axes[ax[-1]] = (t, v)   # 'd|X' -> 'X'
        out.setdefault(mid, {})[prop] = (axes, node_layer.get(nid))
    return models, parent, out, layers



S = 0.935 / 104.275           # mixamo cm -> knight units (hips height)
K_HIPS = np.array([0.0, 0.935, 0.067])   # Root_Hips rest position in the knight rig
K_TORSO = np.array([0.0, 0.133, 0.0])    # Torso offset from Root_Hips
K_HEAD  = np.array([0.0, 0.62, -0.067])  # Head joint offset from Torso, in the torso frame

MAP = {  # knight bone -> mixamo bone (world rotation delta)
 'Root_Hips':'Hips','Torso':'Spine2','Head':'Head',
 'Left_Arm':'LeftArm','Left_Forearm':'LeftForeArm','Right_Arm':'RightArm','Right_Forearm':'RightForeArm',
 'Left_Leg':'LeftUpLeg','Left_Shin':'LeftLeg','Right_Leg':'RightUpLeg','Right_Shin':'RightLeg'}
KPARENT = {'Root_Hips':None,'Torso':'Root_Hips','Head':None,'Left_Arm':'Torso','Left_Forearm':'Left_Arm',
 'Right_Arm':'Torso','Right_Forearm':'Right_Arm','Left_Leg':'Root_Hips','Left_Shin':'Left_Leg','Right_Leg':'Root_Hips','Right_Shin':'Right_Leg'}
ORDER = ['Root_Hips','Torso','Head','Left_Arm','Left_Forearm','Right_Arm','Right_Forearm','Left_Leg','Left_Shin','Right_Leg','Right_Shin']

def euler(deg): return R.from_euler('xyz', np.asarray(deg, float), degrees=True)   # FBX XYZ order = Rz*Ry*Rx

def run(path, name, dump=False):
    models, parent, anim, layers = load(path)
    byname = {m['name']: mid for mid,m in models.items()}
    # the layer that carries the real animation = the one with most keys
    best = {}
    for mid, d in anim.items():
        for prop,(axes, layer) in d.items():
            n = len(list(axes.values())[0][0])
            best[layer] = max(best.get(layer,0), n)
    main_layer = max(best, key=best.get)
    # common time base
    T = None
    for mid, d in anim.items():
        for prop,(axes, layer) in d.items():
            if layer == main_layer and len(list(axes.values())[0][0]) > 1:
                T = list(axes.values())[0][0]; break
        if T is not None: break
    n = len(T)
    def series(mid, prop, default):
        d = anim.get(mid, {}).get(prop)
        if d and d[1] == main_layer:
            axes = d[0]
            return np.stack([np.interp(T, *axes[a]) for a in 'XYZ'], axis=1)
        return np.tile(np.asarray(default, float), (n,1))
    # FK over frames
    wrot = {}      # mid -> Rotation (n frames)
    wrot_rest = {}
    wpos = {}
    def fk(mid):
        if mid in wrot: return
        m = models[mid]; p = parent.get(mid)
        pre = euler(m['props'].get('PreRotation',[0,0,0]))
        lcl = euler(series(mid,'Lcl Rotation', m['props'].get('Lcl Rotation',[0,0,0])))
        lcl_rest = euler(m['props'].get('Lcl Rotation',[0,0,0]))
        loc = pre * lcl
        loc_rest = pre * lcl_rest
        tr = series(mid,'Lcl Translation', m['props'].get('Lcl Translation',[0,0,0]))
        if p is None:
            wrot[mid] = loc; wrot_rest[mid] = loc_rest; wpos[mid] = tr
        else:
            fk(p)
            wrot[mid] = wrot[p] * loc; wrot_rest[mid] = wrot_rest[p] * loc_rest
            wpos[mid] = wpos[p] + wrot[p].apply(tr)
    for mid in models: 
        if models[mid]['type']=='LimbNode': fk(mid)
    hips = byname['Hips']
    hips_rest_pos = np.asarray(models[hips]['props']['Lcl Translation'])
    # world rotation deltas
    D = {}
    for kb, mb in MAP.items():
        mid = byname[mb]
        D[kb] = wrot[mid] * wrot_rest[mid].inv()
    # knight local rotations
    Q = {}
    for kb in ORDER:
        p = KPARENT[kb]
        loc = D[kb] if p is None or kb=='Head' else D[p].inv() * D[kb]
        q = loc.as_quat()    # x y z w
        # sign continuity
        for i in range(1,n):
            if np.dot(q[i], q[i-1]) < 0: q[i] = -q[i]
        Q[kb] = q
    # positions
    hips_pos = K_HIPS + (wpos[hips] - hips_rest_pos) * S
    head_pos = hips_pos + D['Root_Hips'].apply(K_TORSO) + D['Torso'].apply(K_HEAD)
    dur = float(T[-1])
    res = {'name': name, 'tracks': []}
    def tr(bone, p, t, v): res['tracks'].append({'n':bone,'p':p,'t':[round(float(x),5) for x in t],'v':[round(float(x),5) for x in np.asarray(v).ravel()]})
    tr('Root_Hips','t',T,hips_pos); tr('Root_Hips','q',T,Q['Root_Hips'])
    tr('Torso','q',T,Q['Torso'])
    tr('Head','t',T,head_pos); tr('Head','q',T,Q['Head'])
    for b in ['Left_Arm','Left_Forearm','Right_Arm','Right_Forearm','Left_Leg','Left_Shin','Right_Leg','Right_Shin']:
        tr(b,'q',T,Q[b])
    # the rig's static shoulder / torso offsets (same ones the UAL clips carry)
    tr('Left_Arm','t',[0,dur],[[0.133,0.467,0.0]]*2)
    tr('Right_Arm','t',[0,dur],[[-0.125,0.467,-0.067]]*2)
    tr('Torso','t',[0,dur],[[0.0,0.133,0.0]]*2)
    info = dict(frames=n, dur=dur, hips_range=(hips_pos.min(0).round(3).tolist(), hips_pos.max(0).round(3).tolist()))
    extra = dict(T=T, hips_pos=hips_pos, D=D, wpos=wpos, byname=byname, S=S, models=models, wrot=wrot)
    return res, info, extra



def unit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True); return v / np.maximum(n, 1e-9)

def swing_rot(a, b):
    """minimal rotation taking unit vectors a -> b (per frame)"""
    a = unit(a); b = unit(b)
    axis = np.cross(a, b); s = np.linalg.norm(axis, axis=-1); c = np.sum(a*b, axis=-1)
    ang = np.arctan2(s, c)
    axis = np.where(s[:,None] > 1e-9, axis / np.maximum(s[:,None],1e-9), np.array([0,0,1.0]))
    return R.from_rotvec(axis * ang[:,None])

# knight arm geometry (rest, world-aligned axes): shoulder offset in torso, elbow offset in upper arm, hand-centre offset in forearm
ARM = {
 'Left':  dict(sh=np.array([0.133,0.467,0.0]),   el=np.array([0.267,0.0,0.0]),        hc=np.array([0.4,0.0,0.033])),
 'Right': dict(sh=np.array([-0.125,0.467,-0.067]), el=np.array([-0.318,0.01,0.038]), hc=np.array([-0.4005,0.0,0.033])),
}

def build(path, name, mode='shoulder', palm=0.5):
    res, info, ex = run(path, name)
    T, D, wpos, by, models = ex['T'], ex['D'], ex['wpos'], ex['byname'], ex['models']
    n = len(T)
    tr = {(t['n'],t['p']): np.array(t['v']).reshape(len(t['t']),-1) for t in res['tracks']}
    Ph = tr[('Root_Hips','t')]
    Pt = Ph + D['Root_Hips'].apply(K_TORSO)
    Rt = D['Torso']
    P = {}; Rw = {}
    for side in ('Left','Right'):
        g = ARM[side]
        A_m = wpos[by[f'{side}Arm']]; E_m = wpos[by[f'{side}ForeArm']]; H_m = wpos[by[f'{side}Hand']]
        M1 = wpos[by[f'{side}HandMiddle1']]
        HC_m = H_m + (M1 - H_m)*palm
        P[side] = dict(A=A_m, E=E_m, HC=HC_m)
    Lu = {s: np.linalg.norm(ARM[s]['el']) for s in ARM}
    Lf = {s: np.linalg.norm(ARM[s]['hc']) for s in ARM}
    Sk = {s: Pt + Rt.apply(ARM[s]['sh']) for s in ARM}
    sc = {}
    for s in ARM:
        Lum = np.linalg.norm(P[s]['E'][0]-P[s]['A'][0]); Lfm = np.linalg.norm(P[s]['HC'][0]-P[s]['E'][0])
        sc[s] = (Lu[s]+Lf[s])/(Lum+Lfm)
    # hand targets
    tgt = {}
    if mode == 'shoulder':
        for s in ARM: tgt[s] = Sk[s] + sc[s]*(P[s]['HC'] - P[s]['A'])
    else:  # midpoint: everything relative to the shoulder midpoint, one common scale
        smid_k = (Sk['Left']+Sk['Right'])/2; smid_m = (P['Left']['A']+P['Right']['A'])/2
        scm = (sc['Left']+sc['Right'])/2
        for s in ARM: tgt[s] = smid_k + scm*(P[s]['HC'] - smid_m)
    out = {}
    for s in ARM:
        g = ARM[s]; S0 = Sk[s]; W = tgt[s]
        a = Lu[s]; b = Lf[s]
        v = W - S0; d = np.linalg.norm(v, axis=1); dmax = a + b - 1e-4; dmin = abs(a-b)+1e-3
        reach_over = (d > dmax).mean()
        dc = np.clip(d, dmin, dmax)
        vh = unit(v)
        # pole: mixamo elbow, perpendicular to the shoulder->hand line
        pm = (P[s]['E'] - P[s]['A'])
        vm = unit(P[s]['HC'] - P[s]['A'])
        pm = pm - np.sum(pm*vm, axis=1, keepdims=True)*vm
        pole = unit(pm - np.sum(pm*vh, axis=1, keepdims=True)*vh)
        x = (a*a - b*b + dc*dc)/(2*dc); hgt = np.sqrt(np.maximum(a*a - x*x, 0))
        E = S0 + vh*x[:,None] + pole*hgt[:,None]
        W2 = S0 + vh*dc[:,None]
        u = unit(E - S0); f = unit(W2 - E)
        # upper arm: take the delta-based orientation (keeps the twist), re-aim its axis at u
        d0u = unit(g['el']); d0f = unit(g['hc'])
        Dua = D[f'{s}_Arm']; Dfa = D[f'{s}_Forearm']
        cur_u = Dua.apply(d0u); Rua = swing_rot(cur_u, u) * Dua
        cur_f = Dfa.apply(d0f); Rfa = swing_rot(cur_f, f) * Dfa
        out[s] = (Rua, Rfa, reach_over, E, W2)
    # new local rotations
    def q_of(Rn, i0=None):
        q = Rn.as_quat()
        for i in range(1,len(q)):
            if np.dot(q[i], q[i-1]) < 0: q[i] = -q[i]
        return q
    Dn = dict(D)
    for s in ARM:
        Dn[f'{s}_Arm'] = out[s][0]; Dn[f'{s}_Forearm'] = out[s][1]
    la = {}
    for s in ARM:
        la[f'{s}_Arm'] = q_of(Dn['Torso'].inv() * Dn[f'{s}_Arm'])
        la[f'{s}_Forearm'] = q_of(Dn[f'{s}_Arm'].inv() * Dn[f'{s}_Forearm'])
    for t in res['tracks']:
        if t['p']=='q' and t['n'] in la:
            t['v'] = [round(float(x),5) for x in la[t['n']].ravel()]
    hands = {s: out[s][4] for s in ARM}
    sep = np.linalg.norm(hands['Left']-hands['Right'], axis=1)
    msep = np.linalg.norm(P['Left']['HC']-P['Right']['HC'], axis=1)*S
    diag = dict(over=(out['Left'][2], out['Right'][2]), sep=(sep.min(), sep.mean(), sep.max()), msep=(msep.min(), msep.mean(), msep.max()), scale=sc)
    return res, diag, dict(T=T, hands=hands, Ph=Ph, D=Dn, wpos=wpos, by=by, P=P, tgt=tgt, Sk=Sk)


def decimate(res, keys):
    """resample every animated track at the given times (slerp for rotations, lerp for positions); static 2-key tracks are left alone"""
    from scipy.spatial.transform import Slerp
    for t in res['tracks']:
        T = np.array(t['t'])
        if len(T) <= 2: continue
        ks = np.array(sorted(set(min(k, T[-1]) for k in keys)))
        if t['p'] == 'q':
            V = np.array(t['v']).reshape(-1, 4)
            nv = Slerp(T, R.from_quat(V))(ks).as_quat()
            for i in range(1, len(nv)):
                if np.dot(nv[i], nv[i-1]) < 0: nv[i] = -nv[i]
        else:
            V = np.array(t['v']).reshape(-1, 3)
            nv = np.stack([np.interp(ks, T, V[:, i]) for i in range(3)], axis=1)
        t['t'] = [round(float(x), 5) for x in ks]
        t['v'] = [round(float(x), 5) for x in nv.ravel()]
    return res


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('fbx'); ap.add_argument('out'); ap.add_argument('--name', required=True, help='clip name shown in the ANIMATIONS menu')
    ap.add_argument('--mode', choices=['mid', 'shoulder'], default='mid', help='hand targets relative to the shoulder midpoint (default, keeps the two hands a steady distance apart) or to each shoulder')
    ap.add_argument('--keys', help='comma-separated clip times (s): keep only these key poses (the last one is clamped to the clip end), for a choppy, pose-to-pose look. SNAP_CLIPS in js/02-knight.js then makes the moves between them pop')
    a = ap.parse_args()
    res, diag, _ = build(a.fbx, a.name, a.mode)
    if a.keys:
        res = decimate(res, [float(x) for x in a.keys.split(',')])
    json.dump(res, open(a.out, 'w'), separators=(',', ':'))
    print('wrote', a.out, '- hand separation min/mean/max %.2f/%.2f/%.2f' % diag['sep'], '- reach exceeded on %.0f%% / %.0f%% of frames (L/R)' % (100 * diag['over'][0], 100 * diag['over'][1]))
