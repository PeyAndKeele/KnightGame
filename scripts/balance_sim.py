# Balance simulator for the Knight battle rules (turn-based, enemies all swing every round).
# Usage: python3 balance_sim.py   - edit CONFIG below to match the constants in js/09-dungeon-battle.js
import itertools, random, sys, math
from functools import lru_cache

def round(x): return int(math.floor(x+0.5))  # JS Math.round

HP = {'slime':50,'sporeling':50,'treeling':80,'golem':100}
RUINS = [["slime","mob","slime"],["mob","slime","mob"],["slime","golem","slime"]]
TOMB  = [["mob","slime","mob"],["slime","mob","slime"],["mob","golem","mob"]]

def make(cfg):
    P = dict(php=100, swing=25, dmg={'slime':12,'sporeling':12,'treeling':12,'golem':12},
             guard=0.25, heal=25, potions=3, brace=1.0, waveheal=0, dmul=1.0)
    P.update(cfg); return P

def edmg(P, t, guard):
    d = max(1, round(P['dmg'][t]*P['dmul']))
    return max(1, round(d*P['guard'])) if guard else d

def expand(layout):
    # all mob assignments with probabilities
    slots=[i for i,t in enumerate(layout) if t=='mob']
    out=[]
    for combo in itertools.product(['sporeling','treeling'],repeat=len(slots)):
        l=list(layout)
        for s,c in zip(slots,combo): l[s]=c
        out.append((tuple(l),0.5**len(slots)))
    return out

def solve(P, waves):
    sys.setrecursionlimit(10000)
    @lru_cache(None)
    def wave_start(w, hp, pots, br):
        if w==len(waves): return 1+0.001*hp/P['php']
        tot=0
        for l,p in expand(waves[w]):
            tot+=p*fight(w,l,tuple(HP[t] for t in l),hp,pots,br)
        return tot
    @lru_cache(None)
    def fight(w, types, ehp, hp, pots, br):
        alive=[i for i in range(3) if ehp[i]>0]
        if not alive:
            nh=min(P['php'],hp+P['waveheal']) if w<len(waves)-1 else hp
            return wave_start(w+1,nh,pots,br)
        best=0
        # options
        opts=[]
        for i in alive: opts.append(('c',i))
        if not P.get('noblock'): opts.append(('b',))
        if pots>0 and hp<P['php'] and not P.get('nopot'): opts.append(('p',))
        for o in opts:
            nhp=hp; nehp=list(ehp); nbr=br; npots=pots; guard=False
            if o[0]=='c':
                dm=P['swing']*(P['brace'] if br else 1); nbr=False
                nehp[o[1]]=max(0,nehp[o[1]]-int(round(dm)))
                if all(x<=0 for x in nehp):
                    v=fight(w,types,tuple(nehp),hp,npots,nbr)
                    best=max(best,v); continue
            elif o[0]=='b':
                guard=True; nbr=(P['brace']>1.0)
            else:
                nhp=min(P['php'],hp+P['heal']); npots-=1
            # enemy phase
            dead=False
            for i in range(3):
                if nehp[i]>0:
                    nhp-=edmg(P,types[i],guard)
                    if nhp<=0: dead=True;break
            if dead: continue
            v=fight(w,types,tuple(nehp),nhp,npots,nbr)
            best=max(best,v)
        return best
    return wave_start(0,P['php'],P['potions'],False)

def naive(P, waves, trials=4000, use_block=False, pot_thresh=0.35, seed=1):
    rnd=random.Random(seed); wins=0; hpl=[]
    for _ in range(trials):
        hp=P['php']; pots=P['potions']; br=False; ok=True
        for w,layout in enumerate(waves):
            types=[rnd.choice(['sporeling','treeling']) if t=='mob' else t for t in layout]
            ehp=[HP[t] for t in types]
            while any(x>0 for x in ehp):
                alive=[i for i in range(3) if ehp[i]>0]
                guard=False
                if pots>0 and hp<=P['php']*pot_thresh and hp<P['php']:
                    hp=min(P['php'],hp+P['heal']); pots-=1
                elif use_block and not br and min(ehp[i] for i in alive)>P['swing']:
                    guard=True; br=P['brace']>1.0
                else:
                    i=min(alive,key=lambda k:ehp[k])
                    ehp[i]=max(0,ehp[i]-int(round(P['swing']*(P['brace'] if br else 1)))); br=False
                    if not any(x>0 for x in ehp): break
                for i in range(3):
                    if ehp[i]>0:
                        hp-=edmg(P,types[i],guard)
                        if hp<=0: break
                if hp<=0: ok=False;break
            if not ok: break
            if w<len(waves)-1: hp=min(P['php'],hp+P['waveheal'])
        if ok: wins+=1; hpl.append(hp)
    return wins/trials, (sum(hpl)/len(hpl) if hpl else 0)

def show(tag, cfg, tomb_mul=1.25):
    P = make(cfg)
    print(tag)
    for dn, wv, mul in (('RUINS', RUINS, 1.0), ('TOMB', TOMB, tomb_mul)):
        pm = dict(P, dmul=mul)
        opt = solve(pm, wv)
        nb = solve(dict(pm, noblock=True), wv)
        npot = solve(dict(pm, nopot=True), wv)
        n = naive(pm, wv)[0]
        nbk = naive(pm, wv, use_block=True)[0]
        print(f"  {dn:5s} perfect play {opt:.2f} | without blocking {nb:.2f} | without potions {npot:.2f} | beginner (carve + potion) {n:.2f} | beginner who blocks first {nbk:.2f}")

if __name__ == '__main__':
    show("BEFORE (original constants)", {})
    show("AFTER (what is in the game now)", dict(
        dmg={'slime': 4, 'sporeling': 5, 'treeling': 7, 'golem': 12},
        brace=2.0, heal=40, waveheal=15))
