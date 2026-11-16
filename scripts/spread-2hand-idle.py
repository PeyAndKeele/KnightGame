#!/usr/bin/env python3
"""Spreads the hands of the 2hand_Idle clip further apart along the shaft: the lower (left) fist slides DOWN the handle, the upper (right) fist a little UP it.

    python3 scripts/spread-2hand-idle.py twohandidle-data.json twohandidle-data.json --down 0.14 --up 0.08

Works on the clip's own arm tracks (Left/Right _Arm and _Forearm), in the torso's space: the fists are found by forward kinematics, moved along the line between them (so the shaft direction does not
change), and each arm is re-solved with the same two-bone IK as scripts/retarget-mixamo.py (the current elbow is the pole, so the elbows keep bending the way they did). Run it on the ORIGINAL clip once:
running it again spreads them again. Needs numpy and scipy.
"""
import argparse, json
import numpy as np
from scipy.spatial.transform import Rotation as R

ARM = {
 'Left':  dict(sh=np.array([0.133,0.467,0.0]),   el=np.array([0.267,0.0,0.0]),        hc=np.array([0.4,0.0,0.033])),
 'Right': dict(sh=np.array([-0.125,0.467,-0.067]), el=np.array([-0.318,0.01,0.038]), hc=np.array([-0.4005,0.0,0.033])),
}

def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)

def swing_rot(a, b):
    a = unit(a); b = unit(b)
    axis = np.cross(a, b); s = np.linalg.norm(axis, axis=-1); c = np.sum(a*b, axis=-1)
    ang = np.arctan2(s, c)
    axis = np.where(s[:,None] > 1e-9, axis / np.maximum(s[:,None], 1e-9), np.array([0, 0, 1.0]))
    return R.from_rotvec(axis * ang[:,None])

def fix_signs(q):
    for i in range(1, len(q)):
        if np.dot(q[i], q[i-1]) < 0: q[i] = -q[i]
    return q

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src'); ap.add_argument('out')
    ap.add_argument('--down', type=float, default=0.14, help='how far the lower (left) fist slides down the handle (rig units)')
    ap.add_argument('--up', type=float, default=0.08, help='how far the upper (right) fist slides up the handle')
    a = ap.parse_args()
    d = json.load(open(a.src))
    tr = {(t['n'], t['p']): t for t in d['tracks']}
    q = {}
    for s in ARM:
        for part in ('Arm', 'Forearm'):
            q[s+part] = R.from_quat(np.array(tr[(f'{s}_{part}', 'q')]['v']).reshape(-1, 4))
    pos = {}
    for s in ARM:
        g = ARM[s]
        E = g['sh'] + q[s+'Arm'].apply(g['el'])
        H = g['sh'] + q[s+'Arm'].apply(g['el'] + q[s+'Forearm'].apply(g['hc']))
        pos[s] = (E, H)
    L, Rr = pos['Left'][1], pos['Right'][1]
    u = unit(Rr - L)                        # up the handle
    tgt = {'Left': L - u*a.down, 'Right': Rr + u*a.up}
    for s in ARM:
        g = ARM[s]
        A = np.linalg.norm(g['el']); B = np.linalg.norm(g['hc'])
        S0 = g['sh']; E_old = pos[s][0]
        v = tgt[s] - S0; dist = np.linalg.norm(v, axis=1)
        dmax = A + B - 1e-3; dmin = abs(A - B) + 1e-3
        print(f'{s}: reach {dist.max():.3f} of {A+B:.3f}' + ('  (OVER: hand pulled back)' if dist.max() > dmax else ''))
        dc = np.clip(dist, dmin, dmax); vh = unit(v)
        pm = E_old - S0
        pole = unit(pm - np.sum(pm*vh, axis=1, keepdims=True)*vh)
        x = (A*A - B*B + dc*dc) / (2*dc); h = np.sqrt(np.maximum(A*A - x*x, 0))
        E = S0 + vh*x[:,None] + pole*h[:,None]; W = S0 + vh*dc[:,None]
        up_new = unit(E - S0); fo_new = unit(W - E)
        Ra_old = q[s+'Arm']; Rf_w_old = Ra_old * q[s+'Forearm']       # forearm in torso space
        Ra = swing_rot(Ra_old.apply(unit(g['el'])), up_new) * Ra_old
        Rf_w = swing_rot(Rf_w_old.apply(unit(g['hc'])), fo_new) * Rf_w_old
        Rf = Ra.inv() * Rf_w
        for part, rot in (('Arm', Ra), ('Forearm', Rf)):
            tr[(f'{s}_{part}', 'q')]['v'] = [round(float(x), 5) for x in fix_signs(rot.as_quat()).ravel()]
    json.dump(d, open(a.out, 'w'), separators=(',', ':'))

main()
