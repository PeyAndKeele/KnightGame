// Inventory, items tab, SAVE (gold and owned items), dev mode.
// (Part 13 of 14. All parts share one scope; see README.)

/* ---------- INVENTORY (main menu > INVENTORY) ----------
 The camera eases in on the knight (closer, a little above the middle of him) with the picture pushed right to leave room for the panel on the left - the same layout as the shop -
 he is put in his idle pose and everything except him is hidden, so the fog/sky colour is the background (the turntable stays off). The panel mocks the shop's: SWORD / HATCHET / AXE equip that weapon, POTION is only listed. */
/* The inventory's background: a layer drawn behind the knight, over the (lightened) fog colour: a soft glow behind him, a gentle vignette, and a few big blurred specks drifting slowly upward,
 all low in contrast so it adds depth without pulling the eye. INV_BG_GLOW / _VIGNETTE / _BOKEH = how strong each is (0 = off); INV_BG_DRIFT = how fast the specks move. */
const INV_BG_GLOW = 0.3,
  INV_BG_VIGNETTE = 0.16,
  INV_BG_BOKEH = 0.1,
  INV_BG_DRIFT = 1.0;
let invBg = null;
function invBackdrop() {
  if (invBg) return invBg;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color() },
      uTime: { value: 0 },
      uAsp: { value: 1 },
      uK: { value: 0 },
      uGlow: { value: INV_BG_GLOW },
      uVig: { value: INV_BG_VIGNETTE },
      uBokeh: { value: INV_BG_BOKEH },
    },
    vertexShader:
      "varying vec2 vP; void main(){ vP=position.xy; gl_Position=vec4(position.xy,1.0,1.0); }",
    fragmentShader: `uniform vec3 uBase; uniform float uTime,uAsp,uK,uGlow,uVig,uBokeh; varying vec2 vP;
float hsh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
void main(){
  vec2 q=vec2(vP.x*uAsp,vP.y); vec3 c=uBase;
  vec2 d0=q-vec2(0.0,-0.08); c+=(vec3(1.0)-c)*uGlow*exp(-dot(d0,d0)*1.5);                    // a soft glow where he stands
  c*=1.0-uVig*smoothstep(0.6,1.8,length(q));                                                  // darker toward the corners
  for(int i=0;i<2;i++){                                                                       // two layers of big, soft specks drifting up and sideways
    float fi=float(i), sc=5.0+fi*5.0;
    vec2 uv=q*sc+vec2(uTime*0.04*(fi+1.0),-uTime*0.07*(fi+1.0));
    vec2 id=floor(uv), f=fract(uv)-0.5; float h=hsh(id+fi*17.0);
    if(h>0.78){
      vec2 o=(vec2(hsh(id*1.7),hsh(id*2.3))-0.5)*0.6; float r=0.14+0.16*hsh(id*3.1);
      float a=smoothstep(r,r*0.3,length(f-o))*(0.55+0.45*sin(uTime*0.5+h*40.0));
      c+=(vec3(1.0)-c)*uBokeh*a*(1.0-0.3*fi);
    }
  }
  gl_FragColor=vec4(mix(uBase,c,uK),1.0);
}`,
    depthTest: false,
    depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.name = "InvBackdrop";
  m.frustumCulled = false;
  m.renderOrder = -1000;
  m.visible = false;
  scene.add(m);
  invBg = m;
  return m;
}
// the background is the armor colour mixed this far toward white (0 = the armor colour itself, 1 = white); with no armor colour it is the usual fog colour, lightened by INV_FOG_LIGHT
const INV_BG_PALE = 0.3;
const _invWhite = new THREE.Color(0xffffff);
const INV_CUST_VIEW = 0.85;
// INV_CUST_VIEW: on the CUSTOMIZE screen the picture slides right (1 = the menu's usual shift, 0 = centred) so he sits in the free space beside the panel
let invCustK = 0;
const INV_ZOOM = 0.72,
  INV_PITCH = 0.06,
  INV_TY = 0.08,
  INV_VIEW = 0,
  // zoom (bigger = further away = smaller on screen), tilt, how high he is looked at (knight-heights above his middle), how far the picture is pushed right (1 = the menu's usual shift; 0 = centred, between the item list on the left and the details on the right)
  INV_FOG_LIGHT = 0.4;
/* ---------- ITEMS tab: inspecting the potion ----------
 While the POTION is highlighted in the inventory's ITEMS tab the knight plays UAL_Consume (mirrored, see UALX_ConsumeM), holding the bottle in his LEFT hand, and the camera pushes in on that hand.
 The animation is FROZEN at INV_DRINK_FREEZE_T (the hand held out with the bottle). Leaving the item (other tab, other row, CUSTOMIZE, closing the inventory) lets it play on to the end, and then he goes back to idle.
 INV_DRINK_OUT_AT: clip time the bottle appears. INV_DRINK_ZOOM: camera zoom while inspecting (smaller = closer). INV_DRINK_UP: how far above the hand the camera looks (knight-heights). */
// how far the bottle is tipped up while inspecting: 0 = the old angle (neck pointing down-forward), 1 = straight up
const INV_DRINK_TILT = 0.75;
const _invUp = new THREE.Vector3(),
  _invY = new THREE.Vector3(),
  _invDir = new THREE.Vector3(),
  _invInv = new THREE.Matrix4();
const INV_DRINK_FREEZE_T = 0.5,
  INV_DRINK_OUT_AT = 0.15,
  INV_DRINK_ZOOM = 0.3,
  INV_DRINK_UP = 0.0;
const invDrink = {
  on: false,
  release: false,
  next: null,
  internal: false,
  k: 0,
};
const _invHand = new THREE.Vector3();
function invDrinkWant() {
  const it =
    invOn && !invCust && INV_TABS[invTab].t === "ITEMS" && invList()[invCur];
  return !!it && it.icon === "potion";
}
function invDrinkSync() {
  const want = invDrinkWant(),
    a = actions.UALX_ConsumeM;
  if (!a) return;
  // the green bottle for the haste potion
  if (want) potionKind = invList()[invCur].haste ? "haste" : "heal";
  if (want && (!invDrink.on || invDrink.release)) {
    // (re)start: reach for the bottle
    invDrink.on = true;
    invDrink.release = false;
    invDrink.next = null;
    invDrink.internal = true;
    if (current && current !== a) current.fadeOut(0.12);
    a.reset().setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = 1;
    a.paused = false;
    a.fadeIn(0.12).play();
    current = a;
    invDrink.internal = false;
  } else if (!want && invDrink.on && !invDrink.release) {
    invDrink.release = true;
    a.paused = false;
  // let it finish
  }
}
function invDrinkStep() {
  if (!invDrink.on) return;
  const a = actions.UALX_ConsumeM;
  if (!a) {
    invDrink.on = false;
    return;
  }
  if (!invDrink.release) {
    if (a.time >= INV_DRINK_FREEZE_T) {
      a.time = INV_DRINK_FREEZE_T;
      a.paused = true;
    }
    return;
  }
  if (a.time >= a.getClip().duration - 1e-3 || !a.isRunning()) {
    // finished: back to idle (or whatever was asked for meanwhile)
    const nx = invDrink.next;
    invDrink.on = false;
    invDrink.release = false;
    invDrink.next = null;
    a.paused = false;
    play(nx && nx !== "Idle" && nx !== "AxeIdle" ? nx : idleName());
  }
}
function invStep(dt) {
  if (!invOn && invK === 0) return;
  if (invOn)
    invHid.forEach((h) => {
      h.o.visible = false;
    // (kept hidden every frame, in case something else switches it back on)
    });
  const goal = invOn ? 1 : 0;
  invK += (goal - invK) * (1 - Math.exp(-dt * 4));
  if (Math.abs(goal - invK) < 0.002) invK = goal;
  applyAreaFog();
  if (invK > 0) {
    if (armorHex) {
      _fogB.set(armorHex).lerp(_invWhite, INV_BG_PALE);
      _fogC.lerp(_fogB, invK);
    } else {
      _fogB.setHex(0xffffff);
      _fogC.lerp(_fogB, INV_FOG_LIGHT * invK);
    }
    renderer.setClearColor(_fogC);
    U.uFogColor.value.copy(_fogC);
  }
  {
    const bg = invBackdrop(),
      u = bg.material.uniforms;
    bg.visible = invK > 0;
    u.uBase.value.copy(_fogC);
    u.uTime.value += dt * INV_BG_DRIFT;
    u.uAsp.value = innerWidth / innerHeight;
    u.uK.value = invK;
  // the background layer, over that colour   // the background / fog is lightened while the inventory is open (INV_FOG_LIGHT: 0 = as usual, 1 = white) and settles back as it closes
  }
  if (!invPrev) return;
  const dg = invDrink.on && !invDrink.release && invOn ? 1 : 0;
  invDrink.k += (dg - invDrink.k) * (1 - Math.exp(-dt * 5));
  if (Math.abs(dg - invDrink.k) < 0.002) invDrink.k = dg;
  zoom = mapLerp(
    invPrev.zoom,
    mapLerp(INV_ZOOM, INV_DRINK_ZOOM, invDrink.k),
    invK,
  );
  pitch = mapLerp(invPrev.pitch, INV_PITCH, invK);
  target.set(
    invPrev.tx,
    mapLerp(invPrev.ty, homeTarget.y + playerH * INV_TY, invK),
    invPrev.tz,
  );
  if (invDrink.k > 0 && potionGrp) {
    potionGrp.updateWorldMatrix(true, false);
    potionGrp.getWorldPosition(_invHand);
    target.lerp(
      _invHand.setY(_invHand.y + playerH * INV_DRINK_UP),
      invDrink.k * invK,
    );
  // the camera looks at the hand holding the bottle
  }
  invCustK += ((invCust ? 1 : 0) - invCustK) * (1 - Math.exp(-dt * 6));
  if (Math.abs((invCust ? 1 : 0) - invCustK) < 0.002)
    invCustK = invCust ? 1 : 0;
  mapViewK = mapLerp(
    1,
    INV_VIEW + (INV_CUST_VIEW - INV_VIEW) * invCustK,
    invK,
  );
  applyView();
  if (!invOn && invK === 0) {
    invPrev = null;
    mapViewK = 1;
    applyView();
    applyAreaFog();
  }
}
/* The inventory is laid out like Elden Ring's: TABS along the top (WEAPONS, ITEMS; Q / E switch them), under them the TYPES inside a tab (WEAPONS: LIGHT / HEAVY; A / D or the left / right arrows switch them),
 the list of what you hold on the left (the equipped one wears an E), and the highlighted item's details on the right. Hovering a weapon shows it on the knight; clicking it (or ENTER) equips it.
 The knight stands between the two columns and wears whatever you equip. To add a weapon, add a row to the WEAPONS tab's items (cls: 'light' or 'heavy'); a new tab or type is one more entry in INV_TABS.
 Light = the one-handed weapons (his 'sword' slot: sword, hatchet, hammer, knightly sword, morningstar); heavy = the two-handed ones (his 'axe' slot: axe, shovel), the ones RENDER needs. */
/* The weapons' inventory icons: the hand-drawn pixel sprites (sword, hammer, hatchet, axe, shovel, knightly sword, morningstar), used as a mask and drawn white (.wico background). Potion keeps its line icon. */
const WEAPON_ICONS = {
  morningstar:
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABHUlEQVR42u3dQQ7CMAxE0bri/lc2R8giJMHx+1sWVfmamVCQiMx8cI7XW0AAASCAAJzh0+heR8e9kAAVBAJswLWdH4PXZx8JhASoIBBgA8p+Dpjt/NHmSIAKAgE2oG6nL7m+BKggAmADtnT27k2RABUEAmzAPRshASoIBNiAOvzbs6KQABUEAmxA2XN/rri+BKggAmADjpz7V3+f4HdBKggE2IB7Oz8kQAWBABtQpvNnOzwlQAWBABtQtvNnCQlQQSDABrTpfAlQQSDABuh8CVBBIMAG6HwJIAAE2ACdLwEEgAAboPMlgAAQ0HkDdL4EEAAC+myAzpcAAkBAnw3Q+RJAAAjouwE/+Z8sSAABIKDkBjjnSwABIIAAEHAvX8T8JuVY5gM5AAAAAElFTkSuQmCC",
  sword:
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABBElEQVR42u3dMQ6DMBQEURZx/yubjobKsrAt/ps2VIx2V4YoSWvtwDpOt4AAAkAAASCAABBAAAggAAQQgDlcbsHD6GPhSIAKAgE2oEznS4AKAgE2QOdLgAoCATZA50uACgIBNqBO50cCVBAIsAE6XwJUEAiwATpfAlQQCLABOl8CVBAIsAGvDk/n9b/sfAlQQSCg6Dlg9fd0IgEggAAs2wCdLwEEgIA6G5DJ54BIAAggAGXOAZEAEEAAtt0Af80hAQSAgP9uwNe/s9k6P/csCAQQgH3OAb2dP3q9BIAAAjBvA2a/85UAEEAA9j0HxO2UAAJAAAEggAAQQAAIIAAEEAACtuUGwxcU4mvj/+cAAAAASUVORK5CYII=",
  hammer:
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABOElEQVR42u3cUY4CMQwEUYy4/5XDEVBmmDiOX/2jRZS6O2FWxBjjhTzePgICCAABBCCHT+H3Pnt8CwkAAQSg7AaMP78+JAAEEGADju18CQABBKDOBozkvxcSoIJAgA1oe85P2QQJUEEEoMkGVPtuZ8kmSIAKIgBN7wHVeGQTJEAFEYAmGxA37wV3X7/6XhMSoIJAgA243JGzHVvy+YIEqCAC0HQDnt4ICQABBKDuBtzt/N3vCRJAAAiwAc91fvYmeB6ggkCADcjr/NXn/pAAFQQCbEBa568+9/vfUBUEAmzAPp2/5TlfAlQQCGi6Abt1/uy9wG9FqCAQYAPOPef77WgQQIAN6NP5EgACCMD1DdD5EkAACOizATpfAggAAX034NczVJ0vAQSAgHM3wDlfAggAAQSAgHP5AmddJeo9S1zUAAAAAElFTkSuQmCC",
  hatchet:
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABCUlEQVR42u3aOw6AMBADURZx/yuHjoIGUSTZZN9cAImR7fCJ1tqBeZxuAQEEgAACQAABIIAAEEAACCAAY7jcgof3a+GQABUEAmxAmc6fsgkSoIIIgA1I0fmH5wAVBAJsQNnOn7IZEqCCCIANSNH5va8fEqCCQIAN2KbzJYAAEGADdP6vc78EqCAQYAO6dH4M3oyQABUEAmxAms6XABBAANbZgOyd799QFQQCbMC6nT/63ZAEqCAQYAOc8yVABYGAihug8yVABYGAOhtQ8huuBBAAAopugM6XAAJAQJ0N0PkSQAAIqLsBX//V6HwJIAAE7LsBzvkSQAAIIAAEEAACCAABBIAAAkDAPtzVmxnigXWK9wAAAABJRU5ErkJggg==",
  axe: "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABIElEQVR42u3cQQ4CIRQEUb7x/lfGvZuJIwGGfnUAxVS6e4jR6r23w/j+QLXzYV8NBBCAZbwP7PxHbYIEEEAAbMDQzpcAEEAAztmALgEggADEbECf/PolASoIBNgAz/kSQAAIsAFxnX91npIAFQQCCAABBIAA94C/qc3vBVPvCRKggghA2AYM7dAbnd0Wv19JgAoCATbgsZ0/9LwSoIIIgA2Y99y9wWa4B6ggEGAD5nX+akoCVBAIsAE6XwJUEAiwAdmdLwEqCASEb0B050uACgIBYRuwW+f/+h2x3wmrIBBgA859zvefcSoIBNiAnM6XABBAAO5vgM6XAAJAQM4G6HwJIAAE5GyAzpcAAkBAzgbofAkgAAS4B+h8CSAABGTxAY11IejrAp6aAAAAAElFTkSuQmCC",
  shovel:
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABA0lEQVR42u3dyxGEQAwDUUyRf8pDCD7AfP06BLokrS+z0Vq7MI/bJyCAABBAAAggAON5fIKUr4dSSIAKAgE2oEznS4AKAgE2QOdLgAoCATZA50uACgIBNmAdovMmhASoIBBgA8rcASEBKggE2IBjOj+7E0ICVBAIsAHHdv6vv/MlQAWBABuwVedLgAoCATZA50uACgIBNkDnS4AKAgE2QOdLgAoCATZA50sAASDABuh8CSAABNgAnS8BBIAAG6DzJYAAEHDiBiz1toIEgAACMPUOyDq869sKEgACCMDQDRj6fo4EgAACsNUd4E/pJYAAEFBnA7JNgAQQAAIIAAEEgIC1eQHgGxjpFjHEqgAAAABJRU5ErkJggg==",
  knightly:
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABL0lEQVR42u3cO47DMBAEUY+h+1+ZzpwKI1IjknqV7idQobsp7sLRWvvgOb4eAQEEgAACQAABIIAAEEAACCAANRwewZ/ea+GQABUEAmzAazpfAlQQCLAB63Z+dP68BKggEGAD1u38s04PCVBBIMAGLNv5d5/jQwJUEAiwAdOe80e/J4QEqCAQYAOm7fzeu52SzpcAFQQCbMClzs9+PUtIgAoCATag7Nw++hw+xd2OBKggEGADLp3bt7jbkQAVBAJswC0bkSUkAAQQgMc2IHsX0wb/PgkAAQRgnfeAs47fovMlgAAQ8JINqP6/HgkAAQSgbgPu/pzN7Ia4CwIBBGCe94Bs5/d+vwSAAAJQtwHZv+lCAggAAfu+B4THKQEEgAACQAABIIAAEEAACCAABEzLDzOOJt5DbWGaAAAAAElFTkSuQmCC",
};
(function () {
  const st = document.createElement("style");
  st.textContent =
    ".wico{display:block;width:100%;height:100%;background:#fff;-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat;image-rendering:pixelated}";
  document.head.appendChild(st);
})();
const INV_ICONS = {
  sword: '<path d="M19 5 L8 16 M5 13 L11 19 M8 16 L4 20"/>',
  knightly:
    '<path d="M19 5 L8 16 M5 13 L11 19 M8 16 L4 20"/><path d="M15 8 l1.5 1.5 -1.5 1.5 -1.5 -1.5 z"/>',
  hatchet: '<path d="M6 20 L15 7"/><path d="M12 5 L19 8 L16 14 Z"/>',
  morningstar: '<path d="M5 20 L14 10"/><circle cx="16" cy="8" r="4"/>',
  hammer: '<path d="M5 20 L14 10"/><path d="M12 4 L20 12 L17 15 L9 7 Z"/>',
  axe: '<path d="M5 20 L16 4"/><path d="M11 3 L21 8 L17 13 Z"/><path d="M9 10 L3 13 L7 16 Z"/>',
  shovel:
    '<path d="M5 4 L15 14"/><path d="M13 12 L19 18 L16 21 L10 15 Z"/><path d="M3 6 L7 2"/>',
  potion:
    '<path d="M9 3 H15 M10 3 V8 L5.5 17 A2 2 0 0 0 7.5 20 H16.5 A2 2 0 0 0 18.5 17 L14 8 V3"/><path d="M8.5 14 H15.5"/>',
};
function invIcon(k) {
  if (WEAPON_ICONS[k])
    return (
      '<span class="wico" style="--m:url(data:image/png;base64,' +
      WEAPON_ICONS[k] +
      ')"></span>'
    );
  return (
    '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">' +
    (INV_ICONS[k] || "") +
    "</svg>"
  );
}
const invLightStats = () => [
  ["DAMAGE", "" + SWING_DAMAGE],
  ["GRIP", "ONE-HANDED"],
  ["SWING", "SWING"],
  ["SPECIAL", "NONE"],
];
const invHeavyStats = () => [
  ["DAMAGE", "" + SWING_DAMAGE],
  ["GRIP", "TWO-HANDED"],
  ["SWING", "AXE SWING"],
  ["SPECIAL", "RENDER (" + RENDER_DAMAGE + " TO ALL)"],
];
/* A weapon row says which weapon slot it fills (w: 'sword' = light, 'axe' = heavy) and which style (ss: swordStyle, or as: axeStyle). */
/* ---------- SAVE: what you own and how much gold you have ----------
 One object, `save`, is the single source of truth: the inventory lists only what owns(id) says you have, OPTIONS > KNIGHT's weapon rows skip what you do not own, and enemies pay gold into it.
 It is kept in localStorage. DEV MODE (open the game with ?dev on the end of the address, or dbg.dev(true) in the console; ?dev=0 turns it off) makes owns() say yes to everything, and it uses a
 SEPARATE save slot, so testing never touches a real playthrough. In the console, dbg.give('hammer'), dbg.give('all'), dbg.add(500), dbg.gold(0), dbg.reset(), dbg.dev(true/false).
 Item ids: sword hatchet hammer knightly morningstar | axe shovel | potion haste. START_OWNED is what a new game begins with. GOLD_FOR is what each enemy pays. */
const DEV = (function () {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has("dev")) {
      if (q.get("dev") === "0") localStorage.removeItem("knight-dev");
      else localStorage.setItem("knight-dev", "1");
    }
    return localStorage.getItem("knight-dev") === "1";
  } catch (e) {
    return /[?&]dev(?!=0)/.test(location.search);
  }
})();
const SAVE_KEY = DEV ? "knight-save-dev" : "knight-save",
  START_OWNED = ["sword", "potion", "haste"],
  ALL_IDS = [
    "sword",
    "hatchet",
    "hammer",
    "knightly",
    "morningstar",
    "axe",
    "shovel",
    "potion",
    "haste",
  ];
const GOLD_FOR = { slime: 10, sporeling: 10, treeling: 15, golem: 25 };
function saveLoad() {
  const f = { gold: 0, owned: START_OWNED.slice() };
  try {
    const r = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
    if (r) {
      if (typeof r.gold === "number")
        f.gold = Math.max(0, Math.floor(r.gold));
      if (Array.isArray(r.owned))
        f.owned = r.owned.filter((x) => ALL_IDS.indexOf(x) >= 0);
    }
  } catch (e) {}
  if (f.owned.indexOf("sword") < 0) f.owned.push("sword");
  return f;
}
let save = saveLoad();
function savePut() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (e) {}
  if (typeof invUi !== "undefined" && invUi && invOn) invGoldText();
}
const owns = (id) => DEV || save.owned.indexOf(id) >= 0;
function addGold(n) {
  save.gold = Math.max(0, save.gold + n);
  savePut();
}
function goldFor(e) {
  return e.isSlime
    ? GOLD_FOR.slime
    : e.mobName === "SPORELING"
      ? GOLD_FOR.sporeling
      : e.mobName === "TREELING"
        ? GOLD_FOR.treeling
        : e.isGolem
          ? GOLD_FOR.golem
          : 0;
// (the enemy knights pay nothing)
}
function awardGold(e) {
  if (e.goldGiven) return;
  e.goldGiven = true;
  const g = goldFor(e);
  if (!g) return;
  addGold(g);
  setTimeout(
    () =>
      popup(
        "+" + g + " G",
        headPos({ isPl: false, ent: e }, new THREE.Vector3()),
        "gold",
      ),
    500,
  );
}
(function () {
  const st = document.createElement("style");
  st.textContent = ".dmg.gold{color:#f0c030}";
  document.head.appendChild(st);
})();
function invGoldText() {
  const el = invUi && invUi.querySelector("#inv-gold");
  if (el) el.textContent = "GOLD " + save.gold + (DEV ? "  [DEV]" : "");
}
window.dbg = {
  give: (id) => {
    (id === "all" ? ALL_IDS : [id]).forEach((x) => {
      if (ALL_IDS.indexOf(x) < 0)
        return console.warn("unknown item", x, "- ids:", ALL_IDS.join(" "));
      if (save.owned.indexOf(x) < 0) save.owned.push(x);
    });
    savePut();
    return save.owned.slice();
  },
  take: (id) => {
    save.owned = save.owned.filter((x) => x !== id || x === "sword");
    savePut();
    return save.owned.slice();
  },
  add: (n) => {
    addGold(n);
    return save.gold;
  },
  gold: (n) => {
    save.gold = Math.max(0, Math.floor(n));
    savePut();
    return save.gold;
  },
  reset: () => {
    save = { gold: 0, owned: START_OWNED.slice() };
    savePut();
    return "reset (reload to see it)";
  },
  dev: (on) => {
    try {
      if (on) localStorage.setItem("knight-dev", "1");
      else localStorage.removeItem("knight-dev");
    } catch (e) {}
    return "dev " + (on ? "ON" : "OFF") + " - reload the page";
  },
  save: () => JSON.parse(JSON.stringify(save)),
  DEV: DEV,
};
if (DEV)
  console.log(
    "%c[DEV MODE] everything is owned; separate save slot. dbg.give / dbg.add / dbg.gold / dbg.reset / dbg.dev(false)",
    "color:#f0c030",
  );
const INV_TABS = [
  {
    t: "WEAPONS",
    subs: [
      { t: "LIGHT", cls: "light" },
      { t: "HEAVY", cls: "heavy" },
    ],
    items: [
      {
        t: "SWORD",
        cls: "light",
        icon: "sword",
        kind: "LIGHT WEAPON",
        w: "sword",
        ss: "sword",
        stats: invLightStats,
        desc: "A plain, balanced blade. Quick to swing and easy to trust.",
      },
      {
        t: "HATCHET",
        cls: "light",
        icon: "hatchet",
        kind: "LIGHT WEAPON",
        w: "sword",
        ss: "hatchet",
        stats: invLightStats,
        desc: "A woodcutter's hatchet on a short haft. Light enough to swing all day.",
      },
      {
        t: "HAMMER",
        cls: "light",
        icon: "hammer",
        kind: "LIGHT WEAPON",
        w: "sword",
        ss: "hammer",
        stats: invLightStats,
        desc: "A blunt hammer. It lands with a thud instead of a slash.",
      },
      {
        t: "KNIGHTLY SWORD",
        cls: "light",
        icon: "knightly",
        kind: "LIGHT WEAPON",
        w: "sword",
        ss: "knightly",
        stats: invLightStats,
        desc: "A knight's sword with gems set in the blade. Its swing leaves a trail of every colour.",
      },
      {
        t: "MORNINGSTAR",
        cls: "light",
        icon: "morningstar",
        kind: "LIGHT WEAPON",
        w: "sword",
        ss: "morningstar",
        stats: invLightStats,
        desc: "A spiked iron ball on a long haft. It does not cut so much as make an argument.",
      },
      {
        t: "AXE",
        cls: "heavy",
        icon: "axe",
        kind: "HEAVY WEAPON",
        w: "axe",
        as: "axe",
        stats: invHeavyStats,
        desc: "A two-handed axe. It takes both hands to bring around, and it is the kind of weapon that can RENDER.",
      },
      {
        t: "SHOVEL",
        cls: "heavy",
        icon: "shovel",
        kind: "HEAVY WEAPON",
        w: "axe",
        as: "shovel",
        stats: invHeavyStats,
        desc: "A digger's shovel put to work as a weapon. It swings like the axe and can RENDER too.",
      },
    ],
  },
  {
    t: "ITEMS",
    subs: null,
    items: [
      {
        t: "POTION",
        icon: "potion",
        kind: "CONSUMABLE",
        qty: () => "x" + POTION_COUNT,
        stats: () => [
          ["HEALS", POTION_HEAL + " HP"],
          ["STOCK", POTION_COUNT + " PER BATTLE"],
        ],
        desc: "A small flask of healing draught. Drink it from the ITEMS menu in battle.",
      },
      {
        t: "HASTE POTION",
        icon: "potion",
        haste: true,
        kind: "CONSUMABLE",
        qty: () => "x" + HASTE_COUNT,
        stats: () => [
          ["EFFECT", "2 ACTIONS NEXT TURN"],
          ["STOCK", HASTE_COUNT + " PER BATTLE"],
        ],
        desc: "A fizzing green draught. Drinking it uses your turn, but your next turn is two actions, and both fill the KNIGHT LIGHT gauge.",
      },
    ],
  },
];
/* HOVER shows a weapon on the knight, CLICK (or ENTER) equips it. invCommit is what he really has equipped (what the E badge marks, and what he goes back to when the inventory closes or the cursor
 rests on something that is not a weapon); whatever is highlighted is only previewed on him. */
let invTab = 0,
  invSub = [0, 0],
  invCurs = {},
  invCommit = { w: "sword", ss: "sword", as: "axe" };
const invIsEq = (it) =>
  !!it.w &&
  invCommit.w === it.w &&
  (it.ss ? invCommit.ss === it.ss : invCommit.as === it.as);
function invApply(c) {
  // put this weapon on him (skipped when he already has it)
  if (weapon === c.w && swordStyle === c.ss && axeStyle === c.as) return;
  swordStyle = c.ss;
  axeStyle = c.as;
  setWeapon(c.w);
  if (c.w === "axe") showWeapons();
  refreshAnim();
}
function invPreview() {
  const it = invList()[invCur];
  invApply(
    it && it.w
      ? { w: it.w, ss: it.ss || invCommit.ss, as: it.as || invCommit.as }
      : invCommit,
  );
}
const itemId = (it) => it.ss || it.as || (it.haste ? "haste" : "potion");
function invList() {
  const T = INV_TABS[invTab],
    own = T.items.filter((i) => owns(itemId(i)));
  return T.subs
    ? own.filter((i) => i.cls === T.subs[invSub[invTab]].cls)
    : own;
// only what you own
}
function invKey() {
  return invTab + ":" + invSub[invTab];
}
function invResetState() {
  // opening: the WEAPONS tab, on the type he is holding, with the equipped weapon highlighted (as Elden Ring does)
  invCommit = { w: weapon, ss: swordStyle, as: axeStyle };
  invTab = 0;
  invSub = [weapon === "axe" ? 1 : 0, 0];
  invCurs = {};
  invCur = 0;
  const i = invList().findIndex((it) => invIsEq(it));
  if (i >= 0) invCur = i;
}
function invGoto(tab, sub, sound) {
  // switch tab / type, remembering where the cursor was in the one we leave
  invCurs[invKey()] = invCur;
  if (tab !== undefined)
    invTab = ((tab % INV_TABS.length) + INV_TABS.length) % INV_TABS.length;
  const T = INV_TABS[invTab];
  if (sub !== undefined && T.subs)
    invSub[invTab] = ((sub % T.subs.length) + T.subs.length) % T.subs.length;
  invCur = Math.max(
    0,
    Math.min(invCurs[invKey()] || 0, invList().length - 1),
  );
  if (sound) blip(620, 0.06);
  invPreview();
  invRefresh();
}
function invRefresh() {
  if (!invUi) return;
  const T = INV_TABS[invTab],
    L = invList();
  if (invCur >= L.length) invCur = Math.max(0, L.length - 1);
  invUi.querySelector("#inv-tabs").innerHTML =
    '<span class="ik">Q</span>' +
    INV_TABS.map(
      (t, i) =>
        '<button type="button" class="it' +
        (i === invTab ? " on" : "") +
        '" data-tab="' +
        i +
        '">' +
        t.t +
        "</button>",
    ).join("") +
    '<span class="ik">E</span>';
  invUi.querySelector("#inv-subs").innerHTML = T.subs
    ? '<span class="ik">A</span>' +
      T.subs
        .map(
          (t, i) =>
            '<button type="button" class="is' +
            (i === invSub[invTab] ? " on" : "") +
            '" data-sub="' +
            i +
            '">' +
            t.t +
            "</button>",
        )
        .join("") +
      '<span class="ik">D</span>'
    : '<span class="ih">' + T.t + "</span>";
  const list = invUi.querySelector("#inv-list");
  list.innerHTML = !L.length
    ? '<div class="ih" style="padding:10px">NOTHING YET</div>'
    : L.map(
        (it, i) =>
          '<button type="button" class="ir' +
          (i === invCur ? " on" : "") +
          '" data-i="' +
          i +
          '"><span class="ii">' +
          invIcon(it.icon) +
          '</span><span class="in">' +
          it.t +
          '</span><span class="iv">' +
          (it.w
            ? invIsEq(it)
              ? '<b class="eb">E</b>'
              : ""
            : it.qty
              ? it.qty()
              : "") +
          "</span></button>",
      ).join("");
  invGoldText();
  invUi.querySelector("#inv-count").textContent =
    (T.subs ? T.subs[invSub[invTab]].t + " " : "") + L.length;
  invDetail();
  invSpinLabel();
}
function invSpinLabel() {
  if (invUi)
    invUi.querySelector("#inv-spin").textContent =
      "TURNTABLE: " + (spin ? "ON" : "OFF");
}
function invDetail() {
  invDrinkSync();
  const it = invList()[invCur],
    box = invUi.querySelector("#inv-det");
  if (!it) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML =
    '<div class="ib">' +
    invIcon(it.icon) +
    '</div><div class="idn">' +
    it.t +
    '</div><div class="idt">' +
    it.kind +
    (invIsEq(it) ? '<b class="eb">E</b>' : "") +
    "</div>" +
    it
      .stats()
      .map(
        (r) =>
          '<div class="idr"><span>' +
          r[0] +
          "</span><span>" +
          r[1] +
          "</span></div>",
      )
      .join("") +
    '<div class="idd">' +
    it.desc +
    "</div>";
}
function invSelect(i, sound) {
  // the cursor / pointer is on a row: highlight it and show that weapon on the knight
  const L = invList();
  if (!L.length) return;
  i = ((i % L.length) + L.length) % L.length;
  if (i === invCur) return;
  invCur = i;
  if (sound) blip(520, 0.05);
  [...invUi.querySelectorAll("#inv-list .ir")].forEach((b, k) =>
    b.classList.toggle("on", k === invCur),
  );
  const row = invUi.querySelector("#inv-list .ir.on");
  if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
  invDetail();
  invPreview();
}
function invActivate() {
  // ENTER / click: equip the highlighted weapon
  const it = invList()[invCur];
  if (!it) return;
  if (!it.w || invIsEq(it)) {
    blip(300, 0.05);
    return;
  }
  invPreview();
  invCommit.w = it.w;
  if (it.ss) invCommit.ss = it.ss;
  else invCommit.as = it.as;
  blip(880, 0.09);
  invRefresh();
}
function invBuild() {
  if (invUi) return;
  const st = document.createElement("style");
  st.textContent = `
#invui{position:fixed;left:3vw;right:3vw;top:4vh;bottom:4vh;display:grid;grid-template-columns:minmax(0,min(31vw,430px)) minmax(0,1fr) minmax(0,min(30vw,420px));grid-template-rows:auto minmax(0,1fr) auto;gap:12px;font-size:min(26px,3.8vh);letter-spacing:.12em;color:var(--ui-text);text-shadow:3px 3px 0 #000;opacity:0;transition:opacity .6s;pointer-events:none;z-index:15}
#invui.on{opacity:1}#invui.on>*{pointer-events:auto}
#invui .ip{box-sizing:border-box;border:3px solid var(--ui-edge);background:var(--ui-panel);box-shadow:0 0 0 3px #000,inset 0 0 0 3px rgba(0,0,0,.35)}
#invui button{font:inherit;letter-spacing:inherit;color:inherit;text-shadow:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:left}
#invtop{grid-column:1/4;display:flex;align-items:center;gap:16px;padding:6px 16px}
#invtop .ttl{flex:0 0 auto}#invtop #inv-spin{margin-left:auto}#inv-tabs{flex:1;display:flex;justify-content:center;align-items:center;gap:8px}
#invui .ik{display:inline-block;min-width:1.3em;text-align:center;font-size:.7em;padding:0 4px;border:2px solid var(--ui-edge);background:rgba(0,0,0,.4);color:var(--ui-dim)}
#invui .it{padding:2px 22px;border:2px solid transparent;color:var(--ui-dim)}#invui .it.on{color:#fff;border-color:var(--ui-edge);background:var(--ui-hi)}
#inv-cust,#inv-spin{font-size:.62em!important;padding:2px 10px!important;border:2px solid var(--ui-edge)!important;background:rgba(0,0,0,.35)!important;letter-spacing:.1em!important;flex:0 0 auto}#inv-tabs{margin-left:0}
#invleft{grid-column:1;grid-row:2;display:flex;flex-direction:column;position:relative;padding:9px;min-height:0}
#inv-subs{display:flex;align-items:center;gap:6px;padding-bottom:6px;margin-bottom:6px;border-bottom:2px solid var(--ui-edge)}
#invui .is{padding:0 14px;border:2px solid transparent;color:var(--ui-dim)}#invui .is.on{color:#fff;border-color:var(--ui-edge);background:var(--ui-hi)}#invui .ih{padding:0 6px}
#inv-list{flex:1;min-height:0;overflow-y:auto;position:relative;scrollbar-width:thin;scrollbar-color:var(--ui-edge) transparent}
#invui .ir{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:3px 7px;border:2px solid transparent}
#invui .ir.on{background:var(--ui-hi);border-color:var(--ui-edge);color:#fff}
#invui .ii{flex:0 0 auto;width:1.35em;height:1.35em;padding:3px;box-sizing:border-box;border:2px solid var(--ui-edge);background:rgba(0,0,0,.4)}
#invui .in{flex:1;white-space:nowrap}#invui .iv{flex:0 0 auto}
#invui .eb{display:inline-block;margin-left:8px;min-width:1.2em;text-align:center;font-size:.75em;line-height:1.2;border:2px solid #ffe27a;color:#ffe27a;background:rgba(0,0,0,.45);font-weight:normal}
#inv-count{padding-top:6px;margin-top:6px;border-top:2px solid var(--ui-edge);font-size:.7em;color:var(--ui-dim);text-align:right}
#invright{grid-column:3;grid-row:2;align-self:start;max-height:100%;overflow:auto;padding:14px;scrollbar-width:thin;scrollbar-color:var(--ui-edge) transparent}
#invui .ib{width:min(110px,16vh);height:min(110px,16vh);margin:0 auto 10px;padding:12px;box-sizing:border-box;border:2px solid var(--ui-edge);background:rgba(0,0,0,.4)}
#invui .idn{font-size:1.25em;text-align:center;color:#fff}#invui .idt{text-align:center;font-size:.7em;color:var(--ui-dim);padding-bottom:8px;margin-bottom:8px;border-bottom:2px solid var(--ui-edge)}
#invui .idr{display:flex;justify-content:space-between;gap:12px;font-size:.8em;padding:2px 0}#invui .idr span:last-child{color:#fff;text-align:right}
#invui .idd{font-size:.75em;line-height:1.25;margin-top:10px;padding-top:8px;border-top:2px solid var(--ui-edge);letter-spacing:.06em;color:var(--ui-text2)}
#invhint{grid-column:1/4;display:flex;justify-content:center;gap:2.2em;flex-wrap:wrap;padding:4px 14px;font-size:.62em;color:var(--ui-dim)}
@media (max-aspect-ratio:9/10){#invui{grid-template-columns:1fr;grid-template-rows:auto minmax(0,40vh) auto;bottom:auto;gap:8px;font-size:min(22px,3.4vh)}#invtop{grid-column:1;flex-wrap:wrap;gap:8px}#invtop .ttl{display:none}#invleft{grid-column:1}#invright,#invhint{display:none}}`;
  document.head.appendChild(st);
  invUi = document.createElement("div");
  invUi.id = "invui";
  invUi.innerHTML =
    '<div id="invtop" class="ip"><span class="ttl">INVENTORY</span><div id="inv-tabs"></div><span id="inv-gold" style="color:#f0c030;white-space:nowrap;margin:0 .8em"></span><button type="button" id="inv-spin">TURNTABLE: OFF</button><button type="button" id="inv-cust">CUSTOMIZE</button></div>' +
    '<div id="invleft" class="ip"><div id="inv-subs"></div><div id="inv-list"></div><div id="inv-count"></div></div>' +
    '<div id="invright" class="ip"><div id="inv-det"></div></div>' +
    '<div id="invhint" class="ip"><span>Q / E: TABS</span><span>A / D: TYPE</span><span>W / S: SELECT</span><span>ENTER / CLICK: EQUIP</span><span>T: TURNTABLE</span><span>C: CUSTOMIZE</span><span>ESC: BACK</span></div>';
  invUi.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !invUi.contains(b)) return;
    if (b.id === "inv-cust") {
      blip(880, 0.09);
      invShowCust();
    } else if (b.id === "inv-spin") {
      blip(620, 0.06);
      toggleSpin();
      invSpinLabel();
    } else if (b.dataset.tab !== undefined)
      invGoto(+b.dataset.tab, undefined, true);
    else if (b.dataset.sub !== undefined)
      invGoto(undefined, +b.dataset.sub, true);
    else if (b.dataset.i !== undefined) {
      invSelect(+b.dataset.i, false);
      invActivate();
    }
  });
  invUi.addEventListener("mouseover", (e) => {
    // the pointer highlights what it is over, as the arrow keys do
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.i !== undefined) invSelect(+b.dataset.i, true);
  });
  document.body.appendChild(invUi);
}
function invShowCust() {
  invApply(invCommit);
  invCust = true;
  invDrinkSync();
  invUi.classList.remove("on");
  document.body.classList.remove("map");
  invGoMenu("custom");
// the customize window takes the inventory's place, same camera
}
function invShowInv() {
  invCust = false;
  invGoMenu("main");
  document.body.classList.add("map");
  invUi.classList.add("on");
  invPreview();
  invRefresh();
}
function openInventory() {
  if (invOn || exploring || mapMode) return;
  invPrev = {
    zoom: zoom,
    pitch: pitch,
    tx: target.x,
    ty: target.y,
    tz: target.z,
    spin: spin,
    night: night,
    clip: current ? current.getClip().name : null,
  };
  invOn = true;
  todHold = "day";
  // the inventory is always shown by day (and the time goes back to what it was when it closes)
  lookSnap = true;
  invResetState();
  // the turntable stays off
  if (spin) toggleSpin();
  invHid = scene.children
    .filter((o) => o !== playerRig && o !== invBg && o !== sparkle)
    .map((o) => ({ o: o, v: o.visible }));
  // everything but the knight goes
  if (rockMesh) invHid.push({ o: rockMesh, v: rockMesh.visible });
  // his proper idle (the axe's with the axe)
  play(idleName());
  // the menu window steps aside, as it does for the map
  document.body.classList.add("map");
  invBuild();
  invRefresh();
  requestAnimationFrame(() => invUi.classList.add("on"));
}
function closeInventory() {
  if (!invOn) return;
  invOn = false;
  invDrinkSync();
  // a potion inspection plays out first (play() below is queued until it ends)
  invOn = true;
  // a weapon that was only previewed goes back to the one he really has equipped
  invApply(invCommit);
  invOn = false;
  invCust = false;
  invUi.classList.remove("on");
  if (todHold) {
    todHold = null;
    lookSnap = true;
  }
  // the turntable goes back to how it was before the inventory
  if (invPrev && invPrev.spin !== spin) toggleSpin();
  invHid.forEach((h) => {
    h.o.visible = h.v;
  });
  invHid = [];
  // the world comes back and he returns to the pose he was in
  if (invPrev && invPrev.clip && actions[invPrev.clip]) play(invPrev.clip);
  document.body.classList.remove("map");
}
addEventListener("keydown", (e) => {
  if (!invOn || invCust) return;
  const k = e.key;
  // this key is the inventory's alone: otherwise, once it closes the inventory, the main menu's own handler sees the same key press (Escape = back to the START SCREEN, Enter = a menu item)
  e.stopImmediatePropagation();
  if (k === "c" || k === "C") {
    e.preventDefault();
    invShowCust();
    return;
  }
  if (k === "t" || k === "T") {
    e.preventDefault();
    blip(620, 0.06);
    toggleSpin();
    invSpinLabel();
    return;
  }
  if (k === "Escape" || k === "Backspace") {
    e.preventDefault();
    blip(300, 0.08);
    closeInventory();
  } else if (k === "q" || k === "Q" || k === "PageUp") {
    e.preventDefault();
    invGoto(invTab - 1, undefined, true);
  // tabs
  }
  else if (k === "e" || k === "E" || k === "PageDown" || k === "Tab") {
    e.preventDefault();
    invGoto(invTab + 1, undefined, true);
  } else if (k === "ArrowLeft" || k === "a" || k === "A") {
    e.preventDefault();
    if (INV_TABS[invTab].subs) invGoto(undefined, invSub[invTab] - 1, true);
  // types within the tab
  }
  else if (k === "ArrowRight" || k === "d" || k === "D") {
    e.preventDefault();
    if (INV_TABS[invTab].subs) invGoto(undefined, invSub[invTab] + 1, true);
  } else if (k === "ArrowDown" || k === "s" || k === "S") {
    e.preventDefault();
    invSelect(invCur + 1, true);
  } else if (k === "ArrowUp" || k === "w" || k === "W") {
    e.preventDefault();
    invSelect(invCur - 1, true);
  } else if (k === "Enter" || k === " ") {
    e.preventDefault();
    invActivate();
  }
});
