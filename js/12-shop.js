// The SHOP and Kris.
// (Part 12 of 14. All parts share one scope; see README.)

/* ---------- SHOP (map spot 4) ----------
 shop-data is the stall (model__3__1.gltf). It stands on the ground at the SHOP ping (SHOP_SPOT, in knight-heights from the knight like every ping), SHOP_HEIGHT knight-heights tall, its open front toward +z (toward the camera of the
 map). Choosing SHOP on the map sends the camera down out of the sky (it is already looking straight down from the map): it swoops down, tips up level and lands SHOP_DIST knight-heights in front of the stall, looking into it.
 Escape fades back to the menu. The stall's open front (the side with the sign) is its model +x; it is turned to face the knight's clearing, and the trees around it and in front of it are cleared away. The four little "SWORD / HATCHED / AXE / POTION HERE" marker blocks in the model are hidden: they only mark where the goods will hang. */
const SHOP_SPOT = { x: -3.0, z: 4.0 },
  SHOP_HEIGHT = 1.9,
  SHOP_DIST = 2.37,
  SHOP_CAM_Y = 0.79,
  SHOP_LOOK_Y = 0.83,
  // SHOP_DIST: how far from the middle of the stall the camera lands (its open front is about 0.9 knight-heights out)
  SHOP_DUR = 2.8;
const SHOP_FOG = [14, 48],
  // the fog in the shop view (near, far: knight-heights - much thinner than the menu's) and how far the picture is pushed to the right to make room for the UI on the left (1 = as far as the main menu does, 0 = centered)
  SHOP_VIEW = 0.75;
const SHOP_CLEAR = 2.3,
  // trees are cleared inside this radius around the stall, and in a lane this wide (half-width) in front of it out to the camera (knight-heights)
  SHOP_LANE = 1.4;
const shopF = new THREE.Vector3(1, 0, 0);
// shopF: the way the front of the stall faces (set when it is placed: toward the knight)
let shopCleared = null;
/* ---------- the shop's item list ----------
 One entry per labelled cylinder in the stall model, named from its label ('SWORD HANDLE HERE. BLADE POINT DOWN.' -> SWORD, 'HATCHED HERE. POINT UP.' -> HATCHET, ...), in the order they are in the model.
 The picked entry's item turns slowly on its hook. UP / DOWN (or W / S) pick, the mouse works too. The old test controls (shine, talk, end talk) are gone. */
let shopItems = [],
  shopSel = -1,
  shopView = "main",
  // shopView: 'main' (BUY, TALK, SELL, BACK) or 'buy' (the items, then BACK); shopCur: the highlighted row of that view; shopSel: the picked item (only in 'buy')
  shopCur = 0;
function shopLabel(n) {
  let s = n
    .split(/[\s_]+HERE(?=[\s_.]|$)/i)[0]
    .trim()
    .toUpperCase()
    .replace(/[\s_]+HANDLE$/, "")
    .replace(/_/g, " ");
  return s === "HATCHED" ? "HATCHET" : s;
}
function shopRowCount() {
  return shopView === "buy"
    ? shopItems.length + 1
    : shopView === "talk"
      ? SHOP_VOICE.talk.length + 1
      : 4;
// main: BUY, TALK, SELL, BACK - buy: every item, then BACK - talk: each question, then BACK
}
function shopMarkSel() {
  if (!shopUi) return;
  const rows = shopUi.querySelectorAll(
    shopView === "buy"
      ? ".shopbuy"
      : shopView === "talk"
        ? ".shoptalk"
        : ".shopmain",
  );
  rows.forEach((b, i) => b.classList.toggle("on", i === shopCur));
  const r = rows[shopCur];
  // a long list scrolls inside the panel instead of running off the screen
  if (r && r.scrollIntoView) r.scrollIntoView({ block: "nearest" });
}
function shopSelect(k, sound) {
  const n = shopRowCount();
  if (n < 1) return;
  k = ((k % n) + n) % n;
  if (k === shopCur) return;
  shopCur = k;
  shopSel = shopView === "buy" && k < shopItems.length ? k : -1;
  if (sound) blip(520, 0.05);
  shopMarkSel();
}
function shopSetView(v) {
  shopView = v;
  shopCur = 0;
  shopSel = v === "buy" && shopItems.length ? 0 : -1;
  if (shopUi) {
    shopUi.classList.toggle("buy", v === "buy");
    shopUi.classList.toggle("talk", v === "talk");
    const h = shopUi.querySelector(".shophead");
    if (h)
      h.textContent = v === "buy" ? "BUY" : v === "talk" ? "TALK" : "SHOP";
  }
  if (shopLbl) {
    const sm = shopLbl.querySelector("small");
    if (sm) sm.textContent = v === "main" ? "ESC: LEAVE" : "ESC: BACK";
  }
  shopMarkSel();
  // in the TALK panel the camera is in close
  if (!shopDlg.on) shopTalkOn = v === "talk";
}
function shopBack() {
  blip(300, 0.08);
  shopSetView("main");
}
function shopActivate() {
  // Enter / Space / a click on the highlighted row
  if (shopDlg.on) return;
  if (shopView === "main") {
    blip(880, 0.09);
    if (shopCur === 0) shopSetView("buy");
    else if (shopCur === 1) shopSetView("talk");
    else if (shopCur === 2) shopSell();
    else shopFarewell();
  } else if (shopView === "talk") {
    if (shopCur >= SHOP_VOICE.talk.length) shopBack();
    else {
      blip(880, 0.09);
      shopAsk(shopCur);
    }
  } else if (shopCur >= shopItems.length) shopBack();
  else {
    blip(880, 0.09);
    if (window.toast) window.toast("COMING SOON");
  // (nothing to pay with yet)
  }
}
/* ---------- inspecting an item in the BUY list (Resident Evil style) ----------
 The highlighted item leaves its shelf, flies to the front of the camera and turns slowly at a tilt. Everything else (the stall, the keeper, the forest) is blurred and darkened;
 the menu (HTML) and the item stay sharp. How: the item lives on its own layer (1). The world is drawn without it into a render target, blurred in two passes while it is darkened
 onto the screen, and then the item is drawn on top with a fresh depth buffer. Moving off the item, leaving BUY or leaving the shop sends it back to its shelf.
 dist:  how far in front of the camera it floats, in knight heights.      at: where on the screen it sits, as -1..1 (x, y) - right of center, clear of the menu.
 size:  its longest side as a fraction of the screen's height (sizeBy: a multiplier per item).      tilt: lean toward the camera and sideways, in radians.      spin: radians per second.
 blur:  blur strength at full effect (pixels of the 240p picture; scaled up for the Modern look).      dark: [middle, edges] brightness of the world at full effect.
 ease:  seconds for it to settle (fly in / out and the fade).      light: the glint on the metal while inspecting (position is relative to the item, in item-sizes). */
const INSPECT = {
  dist: 1.2,
  at: [0.3, 0.0],
  size: 0.56,
  sizeBy: { POTION: 0.75 },
  tilt: [0.55, -0.5],
  spin: 1.05,
  blur: 2.6,
  dark: [0.46, 0.2],
  ease: 0.1,
  light: {
    at: [-0.7, 0.9, 0.8],
    color: [1.0, 0.9, 0.72],
    intensity: 1.5,
    spec: 16,
  },
};
const inspect = {
  k: 0,
  it: null,
  grp: null,
  fly: 0,
  spin: 0,
  shelf: null,
  saved: null,
  center: new THREE.Vector3(),
  maxDim: 1,
  rtA: null,
  rtB: null,
  mat: null,
  quad: null,
  quadScene: null,
  quadCam: null,
};
const _iv2 = new THREE.Vector2(),
  _ix = new THREE.Vector3(),
  _iy = new THREE.Vector3(),
  _iz = new THREE.Vector3(),
  _ip = new THREE.Vector3(),
  _iq = new THREE.Quaternion(),
  _iq2 = new THREE.Quaternion(),
  _iq3 = new THREE.Quaternion(),
  _ie = new THREE.Euler(),
  _iY = new THREE.Vector3(0, 1, 0),
  _tp = new THREE.Vector3();
function inspectBegin(it) {
  const h = it.holder;
  if (!h || !h.parent) return;
  h.updateWorldMatrix(true, false);
  const sp = new THREE.Vector3(),
    sq = new THREE.Quaternion(),
    ss = new THREE.Vector3();
  // where it hangs now, in the world
  h.matrixWorld.decompose(sp, sq, ss);
  inspect.saved = {
    parent: h.parent,
    pos: h.position.clone(),
    quat: h.quaternion.clone(),
    scl: h.scale.clone(),
  };
  inspect.shelf = { p: sp, q: sq, s: ss.x };
  const scratch = new THREE.Group();
  scratch.add(h);
  h.position.set(0, 0, 0);
  h.quaternion.identity();
  h.scale.set(1, 1, 1);
  // measure it on its own
  scratch.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(h),
    sz = box.getSize(new THREE.Vector3());
  box.getCenter(inspect.center);
  inspect.maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
  // the hatchet only: it turns about its handle (the cylinder), not the middle of its box, which the head drags to one side; same height as before
  if (it.pivotCylinder) inspect.center.set(0, inspect.center.y, 0);
  const grp = new THREE.Group(),
    pivot = new THREE.Group();
  pivot.position.copy(inspect.center).negate();
  pivot.add(h);
  grp.add(pivot);
  // turns about its own middle (the hatchet: about its handle)
  scene.add(grp);
  h.traverse((o) => o.layers.set(1));
  inspect.grp = grp;
  inspect.it = it;
  inspect.fly = 0;
}
function inspectEnd() {
  const it = inspect.it;
  if (!it) return;
  const h = it.holder,
    S = inspect.saved;
  h.traverse((o) => o.layers.set(0));
  S.parent.add(h);
  h.position.copy(S.pos);
  h.quaternion.copy(S.quat);
  h.scale.copy(S.scl);
  scene.remove(inspect.grp);
  inspect.grp = null;
  inspect.it = null;
}
function inspectStep(dt) {
  // (still true while the shop fades out, so the item flies home and the dimming lifts before the black)
  const inShop = !!(shopGroup && shopGroup.visible && shopT >= 0);
  let want = null;
  if (inShop && shopView === "buy" && shopSel >= 0) {
    const it = shopItems[shopSel];
    if (it && it.holder && it.holder.parent) want = it;
  }
  if (!inShop) {
    inspectEnd();
    inspect.k = 0;
    inspect.fly = 0;
    return;
  }
  if (want && want !== inspect.it) {
    inspectEnd();
    inspectBegin(want);
  // a new pick: the old one goes back to its shelf at once, the new one flies out (the dimming carries on)
  }
  const a = 1 - Math.exp(-dt / INSPECT.ease),
    t = want ? 1 : 0;
  inspect.k += (t - inspect.k) * a;
  inspect.fly += (t - inspect.fly) * a;
  if (!want) {
    if (inspect.k < 0.003) inspect.k = 0;
    if (inspect.fly < 0.004) inspectEnd();
  } else {
    if (inspect.k > 0.997) inspect.k = 1;
    if (inspect.fly > 0.997) inspect.fly = 1;
  }
  inspect.spin += dt * INSPECT.spin;
}
function inspectPose() {
  // done at draw time, so it uses the camera exactly as it is drawn
  const g = inspect.grp;
  if (!g) return;
  camera.updateMatrixWorld(true);
  const d = INSPECT.dist * playerH,
    Hw = 2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  _tp
    .set(INSPECT.at[0], INSPECT.at[1], 0.5)
    .unproject(camera)
    .sub(camera.position)
    .normalize()
    .multiplyScalar(d)
    // the spot in front of the camera
    .add(camera.position);
  _ie.set(INSPECT.tilt[0], 0, INSPECT.tilt[1]);
  _iq.setFromEuler(_ie);
  _iq2.setFromAxisAngle(_iY, inspect.spin);
  // facing the camera, leaning, and turning about its own axis
  _iq3.copy(camera.quaternion).multiply(_iq).multiply(_iq2);
  const ts =
      (INSPECT.size * (INSPECT.sizeBy[inspect.it.label] || 1) * Hw) /
      inspect.maxDim,
    S = inspect.shelf;
  const e = inspect.fly * inspect.fly * (3 - 2 * inspect.fly);
  // the shelf pose, as the position of the item's middle
  _ip.copy(inspect.center).multiplyScalar(S.s).applyQuaternion(S.q).add(S.p);
  g.position.lerpVectors(_ip, _tp, e);
  g.quaternion.copy(S.q).slerp(_iq3, e);
  g.scale.setScalar(S.s + (ts - S.s) * e);
  g.userData.hw = Hw;
}
function inspectEnsure(w, h) {
  if (inspect.rtA && inspect.rtA.width === w && inspect.rtA.height === h)
    return;
  if (inspect.rtA) {
    inspect.rtA.dispose();
    inspect.rtB.dispose();
  }
  const o = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  };
  inspect.rtA = new THREE.WebGLRenderTarget(w, h, o);
  inspect.rtB = new THREE.WebGLRenderTarget(
    w,
    h,
    Object.assign({ depthBuffer: false }, o),
  );
  if (!inspect.mat) {
    inspect.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tex: { value: null },
        step: { value: new THREE.Vector2() },
        k: { value: 0 },
        fin: { value: 0 },
        dk: { value: new THREE.Vector2(0.5, 0.2) },
      },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }",
      fragmentShader:
        "uniform sampler2D tex; uniform vec2 step; uniform float k; uniform float fin; uniform vec2 dk; varying vec2 vUv;\n" +
        "void main(){\n" +
        "  vec3 c=texture2D(tex,vUv).rgb*0.2270270;\n" +
        "  c+=(texture2D(tex,vUv+step).rgb+texture2D(tex,vUv-step).rgb)*0.1945946;\n" +
        "  c+=(texture2D(tex,vUv+step*2.0).rgb+texture2D(tex,vUv-step*2.0).rgb)*0.1216216;\n" +
        "  c+=(texture2D(tex,vUv+step*3.0).rgb+texture2D(tex,vUv-step*3.0).rgb)*0.0540541;\n" +
        "  c+=(texture2D(tex,vUv+step*4.0).rgb+texture2D(tex,vUv-step*4.0).rgb)*0.0162162;\n" +
        "  if(fin>0.5){   // the second pass also darkens: dimmer toward the edges, and a little of the colour drained\n" +
        "    float v=smoothstep(0.95,0.15,length((vUv-0.5)*vec2(1.0,0.85)));\n" +
        "    c=mix(c,vec3(dot(c,vec3(0.3,0.5,0.2))),0.3*k);\n" +
        "    c*=mix(1.0,mix(dk.y,dk.x,v),k);\n" +
        "  }\n" +
        "  gl_FragColor=vec4(c,1.0);\n}",
    });
    inspect.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), inspect.mat);
    inspect.quad.frustumCulled = false;
    inspect.quadScene = new THREE.Scene();
    inspect.quadScene.add(inspect.quad);
    inspect.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
}
function inspectRender() {
  const sz = renderer.getDrawingBufferSize(_iv2),
    w = sz.x,
    h = sz.y;
  inspectEnsure(w, h);
  inspectPose();
  const M = inspect.mat,
    k = inspect.k,
    // (240 = the PS1 picture's height, so the Modern look blurs as much on screen)
    r = (INSPECT.blur * k * h) / 240;
  renderer.setRenderTarget(inspect.rtA);
  // the world, without the item (it is on layer 1)
  renderer.render(scene, camera);
  M.uniforms.k.value = k;
  M.uniforms.dk.value.set(INSPECT.dark[0], INSPECT.dark[1]);
  M.uniforms.tex.value = inspect.rtA.texture;
  M.uniforms.step.value.set(r / w, 0);
  M.uniforms.fin.value = 0;
  renderer.setRenderTarget(inspect.rtB);
  // blurred sideways
  renderer.render(inspect.quadScene, inspect.quadCam);
  M.uniforms.tex.value = inspect.rtB.texture;
  M.uniforms.step.value.set(0, r / h);
  M.uniforms.fin.value = 1;
  renderer.setRenderTarget(null);
  // blurred up and down, darkened, onto the screen
  renderer.render(inspect.quadScene, inspect.quadCam);
  // the item on top: its own light, no night tint, no fog
  const L = INSPECT.light,
    Hw = inspect.grp.userData.hw || 1,
    P = U.uLampP.value,
    P2 = U.uLamp2P.value;
  const sv = {
    lp: U.uLampPos.value.clone(),
    lc: U.uLampCol.value.clone(),
    P: P.clone(),
    P2: P2.clone(),
    n: U.uNight.value.clone(),
    fn: U.uFogNear.value,
    ff: U.uFogFar.value,
  };
  _ix.setFromMatrixColumn(camera.matrixWorld, 0);
  _iy.setFromMatrixColumn(camera.matrixWorld, 1);
  _iz.setFromMatrixColumn(camera.matrixWorld, 2);
  U.uLampPos.value
    .copy(inspect.grp.position)
    .addScaledVector(_ix, L.at[0] * Hw * INSPECT.size)
    .addScaledVector(_iy, L.at[1] * Hw * INSPECT.size)
    .addScaledVector(_iz, L.at[2] * Hw * INSPECT.size);
  U.uLampCol.value.set(L.color[0], L.color[1], L.color[2]);
  P.set(Hw * 3, L.intensity, L.spec, 0);
  P2.y = 0;
  U.uNight.value.set(1, 1, 1);
  U.uFogNear.value = 1e4;
  U.uFogFar.value = 2e4;
  camera.layers.set(1);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(scene, camera);
  renderer.autoClear = true;
  camera.layers.set(0);
  U.uLampPos.value.copy(sv.lp);
  U.uLampCol.value.copy(sv.lc);
  P.copy(sv.P);
  P2.copy(sv.P2);
  U.uNight.value.copy(sv.n);
  U.uFogNear.value = sv.fn;
  U.uFogFar.value = sv.ff;
}
function shopSpin(dt) {
  // the picked item turns about its vertical axis; the others ease back to how they hang
  shopItems.forEach((it, i) => {
    const h = it.holder;
    if (!h) return;
    if (i === shopSel && inspect.it !== it) h.rotation.y += dt * 1.4;
    else if (h.rotation.y !== 0) {
      const r = h.rotation.y,
        home = Math.round(r / (Math.PI * 2)) * Math.PI * 2;
      h.rotation.y =
        Math.abs(r - home) < 0.01 ? 0 : r - (r - home) * Math.min(1, dt * 6);
    }
  });
}
let shopGroup = null,
  shopPlaced = false,
  shopT = -1,
  shopFrom = null,
  shopFog = null,
  shopOut = false,
  shopLbl = null,
  shopUi = null;
/* ---------- the shop lantern: a light coming from BRIGHTBOX ----------
 BRIGHTBOX is the bulb inside the stall's lantern (a node in shop-data). It is a point light with a warm colour that fades out over `range` (in the stall's own model units,
 scaled with the stall) and it lights SHINY materials only (uShine: the metal weapons, armor and so on), using Gouraud shading: the light is worked out at each vertex and the result is
 blended across the triangle, with a highlight (`spec` = how tight it is) that slides over the metal as the camera moves. Nothing in the stall is shiny yet, so for now it only shows on
 the bulb itself, which glows; anything given uShine near the lantern (the goods that will hang here) picks it up automatically. It is off whenever the stall is not on screen. */
const SHOP_LAMP = {
  color: [1.0, 0.78, 0.45],
  intensity: 1.25,
  range: 2.2,
  spec: 14,
};
/* The sign light: a second light that is never drawn, floating in front of the stall (nearer the camera than the lantern, which is inside it), there to light the sign - the board
 hanging from the chains. It works like the lantern (shiny materials only, so it goes with USHINE). `at` is where it floats, in the stall's own model units (the sign's middle is about
 x 0.44, y 0.81, z -0.06; +x is the open front); range is in the same units. */
const SHOP_SIGN_LIGHT = {
  at: [1.2, 0.9, -0.06],
  color: [1.0, 0.86, 0.62],
  intensity: 1.4,
  range: 1.7,
  spec: 10,
};
let shopBulb = null,
  shopRoot = null,
  shopScale = 1;
const _lampV = new THREE.Vector3(),
  _lampV2 = new THREE.Vector3(),
  _lampB = new THREE.Box3();
/* The magma glow on the Ignis Mourne trees swells and fades very slowly: one full breath every MAGMA_PERIOD seconds, between MAGMA_LOW and 1 (the glow's own brightness range is set in the shader, uMagmaPulse). */
const MAGMA_PERIOD = 7,
  MAGMA_LOW = 0.15;
let magmaT = 0;
function updateMagma(dt) {
  magmaT += dt;
  // smooth 0..1..0
  const w = 0.5 - 0.5 * Math.cos((magmaT * Math.PI * 2) / MAGMA_PERIOD);
  U.uMagmaPulse.value = MAGMA_LOW + (1 - MAGMA_LOW) * w;
}
function updateShopLamp() {
  const P = U.uLampP.value;
  const P2 = U.uLamp2P.value;
  if (!shopBulb || !shopGroup || !shopGroup.visible) {
    P.y = 0;
    P2.y = 0;
    return;
  }
  shopGroup.updateMatrixWorld(true);
  if (shopRoot) {
    _lampV2.set(
      SHOP_SIGN_LIGHT.at[0],
      SHOP_SIGN_LIGHT.at[1],
      SHOP_SIGN_LIGHT.at[2],
    );
    shopRoot.localToWorld(_lampV2);
    U.uLamp2Pos.value.copy(_lampV2);
    U.uLamp2Col.value.set(
      SHOP_SIGN_LIGHT.color[0],
      SHOP_SIGN_LIGHT.color[1],
      SHOP_SIGN_LIGHT.color[2],
    );
    P2.set(
      SHOP_SIGN_LIGHT.range * shopScale,
      SHOP_SIGN_LIGHT.intensity,
      SHOP_SIGN_LIGHT.spec,
      0,
    );
  } else P2.y = 0;
  // the middle of the bulb, in the world
  _lampB.setFromObject(shopBulb).getCenter(_lampV);
  U.uLampPos.value.copy(_lampV);
  U.uLampCol.value.set(
    SHOP_LAMP.color[0],
    SHOP_LAMP.color[1],
    SHOP_LAMP.color[2],
  );
  P.set(SHOP_LAMP.range * shopScale, SHOP_LAMP.intensity, SHOP_LAMP.spec, 0);
}
let shopKeeper = null,
  shopKeeperMats = [],
  shopAllMats = [],
  shopShineOn = true;
function registerShopMat(m, baseShine) {
  m.userData.shopBaseShine = baseShine;
  m.uniforms.uShine.value = shopShineOn ? baseShine : 0;
  if (shopAllMats.indexOf(m) < 0) shopAllMats.push(m);
}
function placeShopGoods(root, markers) {
  const D = Math.PI / 180,
    itemScale = 0.42,
    HAMMER_RING_TOP = 0.625,
    HAMMER_TURN_DEG = 90;
  const buildParts = (id, cb) => {
    const el = document.getElementById(id);
    if (!el) return;
    const PD = JSON.parse(el.textContent);
    Promise.all(PD.parts.map((p) => loadImg(p.tex))).then((imgs) => {
      const grp = new THREE.Group();
      PD.parts.forEach((p, k) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(p.p, 3),
        );
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(p.n, 3));
        const uv =
          id === "axe-data" && typeof insetIslandUV === "function"
            ? insetIslandUV(
                p.uv,
                p.i,
                imgs[k].width,
                imgs[k].height,
                AXE_UV_INSET,
              )
            : p.uv;
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(p.i);
        const tex = new THREE.Texture(imgs[k]);
        tex.flipY = false;
        const mat = ps1Mat(tex, 1);
        registerShopMat(mat, 1.0);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(p.t[0], p.t[1], p.t[2]);
        m.rotation.order = "ZYX";
        m.rotation.set(p.r[0] * D, p.r[1] * D, p.r[2] * D);
        m.frustumCulled = false;
        grp.add(m);
      });
      cb(grp);
    });
  };
  markers.forEach((mk) => {
    // + the hammer: stood on the counter shelf (the stall model has no marker for it)
    const name = mk.name.toUpperCase(),
      c = mk.center;
    const it = { label: shopLabel(mk.name), holder: null };
    // one entry in the shop list per labelled cylinder
    shopItems.push(it);
    if (name.indexOf("SWORD") >= 0) {
      // SWORD HANDLE HERE. BLADE POINT DOWN.
      buildParts("sword-data", (grp) => {
        const holder = new THREE.Group();
        grp.position.set(0, -0.844, 0);
        const orient = new THREE.Group();
        orient.rotation.set(Math.PI, Math.PI / 2, 0);
        orient.add(grp);
        holder.add(orient);
        holder.scale.setScalar(itemScale);
        holder.position.copy(c);
        root.add(holder);
        it.holder = holder;
      });
    } else if (name.indexOf("SHOVEL") >= 0) {
      buildParts("shovel-data", (grp) => {
        // SHOVEL HERE. VERTICAL.: the model is 2.14 long and stands on the foot of its marker cylinder, scaled to that cylinder's length and leaning the way the cylinder does
        const holder = new THREE.Group();
        holder.add(grp);
        holder.scale.setScalar((mk.len || 0.4375) / 2.141);
        if (mk.quat) holder.quaternion.copy(mk.quat);
        holder.position.copy(mk.bottom || c);
        root.add(holder);
        it.holder = holder;
      });
    } else if (name.indexOf("HAMMER") >= 0) {
      buildParts("hammer-data", (grp) => {
        const holder = new THREE.Group();
        /* HAMMER HANDLE HERE. HAMMERHEAD POINT UP. ... ("RESTING" HAMMER HEAD ON TAURUS): the handle goes down through the ring (torus) around the marker and the underside of the
         head (y 1.031 in the model) rests on top of that ring, so the head never passes through it. The ring's top is HAMMER_RING_TOP in the stall's units; with the usual item scale the handle's foot then lands just above the counter. */
        grp.position.set(-HAMMER_GRIP[0], -1.031, -HAMMER_GRIP[2]);
        const turn = new THREE.Group();
        turn.rotation.y = HAMMER_TURN_DEG * D;
        // turned about the vertical line through the handle (the shop's spin turns the holder, so this is a layer of its own); flip the sign if it turned the wrong way
        turn.add(grp);
        holder.add(turn);
        holder.scale.setScalar(itemScale);
        holder.position.set(c.x, HAMMER_RING_TOP, c.z);
        root.add(holder);
        it.holder = holder;
      });
    } else if (name.indexOf("HATCHED") >= 0 || name.indexOf("HATCHET") >= 0) {
      // HATCHED HERE. POINT UP.
      // spins about its handle in the inspect view (see inspectBegin)
      it.pivotCylinder = true;
      buildParts("hatchet-data", (grp) => {
        const holder = new THREE.Group();
        grp.position.set(0, -1.25, 0);
        holder.add(grp);
        holder.scale.setScalar(itemScale);
        holder.position.copy(c);
        root.add(holder);
        it.holder = holder;
      });
    } else if (name.indexOf("AXE") >= 0) {
      // AXE HERE. HEAD UP.
      buildParts("axe-data", (grp) => {
        const holder = new THREE.Group();
        grp.position.set(0, -1.55, 0);
        holder.add(grp);
        holder.scale.setScalar(itemScale * 0.78);
        holder.position.copy(c);
        root.add(holder);
        it.holder = holder;
      });
    } else if (name.indexOf("POTION") >= 0) {
      // POTION HERE. VERTICAL.
      const el = document.getElementById("potion-data");
      if (!el) return;
      const t = atob(el.textContent.trim()),
        u = new Uint8Array(t.length);
      for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
      new THREE.GLTFLoader().parse(u.buffer, "", (g) => {
        const cache = new Map();
        const texAlpha = (img) => {
          const cv = document.createElement("canvas");
          cv.width = img.width;
          cv.height = img.height;
          const x = cv.getContext("2d");
          x.drawImage(img, 0, 0);
          const d = x.getImageData(0, 0, cv.width, cv.height).data;
          let mx = 0;
          for (let i = 3; i < d.length; i += 4) mx = Math.max(mx, d[i]);
          return mx / 255;
        };
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          const om = o.material;
          if (!cache.has(om.uuid)) {
            const m = ps1Mat(om.map, 1);
            if (om.map && om.map.image && texAlpha(om.map.image) < 0.95) {
              m.fragmentShader = m.fragmentShader
                .replace("if(tx.a<0.5) discard;", "if(tx.a<0.05) discard;")
                .replace(
                  "gl_FragColor=vec4(c,1.0);",
                  "gl_FragColor=vec4(c,tx.a);",
                );
              m.transparent = true;
              m.depthWrite = false;
              m.userData.glass = true;
            }
            registerShopMat(m, 0.85);
            cache.set(om.uuid, m);
          }
          o.material = cache.get(om.uuid);
          o.renderOrder = o.material.userData.glass ? 2 : 0;
          o.frustumCulled = false;
        });
        g.scene.updateMatrixWorld(true);
        const pbox = new THREE.Box3().setFromObject(g.scene);
        g.scene.position.y = -pbox.min.y;
        const holder = new THREE.Group();
        holder.add(g.scene);
        holder.scale.setScalar(itemScale * 0.85);
        holder.position.set(c.x, 0.28125, c.z);
        root.add(holder);
        it.holder = holder;
      });
    }
  });
}

/* ---------- crates beside the stall (crate-data = crate.gltf) ----------
 Stacked on both sides of the stall, deliberately lopsided: different sizes, turned every which way, a few leaning, and the two piles are not alike. x / z = where a crate stands in the stall's
 own units (+x is the open front, +z is the camera's left, -z its right), up = the height of what it sits on in crate-heights of its OWN pile (so 1 = on one crate of scale 1),
 y = height above the ground, s = scale (the crate model is about 0.34 across), rot = turn about the vertical in degrees, lean = [about x, about z] in degrees. */
const SHOP_CRATES = [
  // the left pile (+z): a big one, a smaller one beside it, two on top at odd angles, and a lone one out front
  { x: 0.05, z: 1.06, y: 0.0, s: 1.75, rot: 12, lean: [0, 0] },
  { x: -0.6, z: 1.14, y: 0.0, s: 1.4, rot: -24, lean: [0, 2] },
  { x: 0.12, z: 1.02, y: 0.569, s: 1.35, rot: 38, lean: [0, 0] },
  { x: -0.58, z: 1.16, y: 0.455, s: 1.0, rot: -9, lean: [3, -4] },
  { x: 0.52, z: 1.38, y: 0.0, s: 1.2, rot: 57, lean: [0, 0] },
  // the right pile (-z): taller and tighter, three high on one side, a small stray at the end
  { x: -0.12, z: -1.24, y: 0.0, s: 1.95, rot: -8, lean: [0, 0] },
  { x: 0.38, z: -1.3, y: 0.0, s: 1.5, rot: 21, lean: [0, 0] },
  { x: -0.06, z: -1.3, y: 0.634, s: 1.55, rot: 27, lean: [0, 0] },
  { x: -0.02, z: -1.26, y: 1.138, s: 1.15, rot: -41, lean: [-4, 3] },
  { x: -0.62, z: -1.1, y: 0.0, s: 1.0, rot: 6, lean: [0, 0] },
];
function placeShopCrates(root, groundY) {
  const el = document.getElementById("crate-data");
  if (!el) return;
  try {
    const t = atob(el.textContent.trim()),
      u = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
    new THREE.GLTFLoader().parse(
      u.buffer,
      "",
      (g) => {
        const cache = new Map();
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          const om = o.material;
          if (!cache.has(om.uuid)) {
            let tex = om.map;
            if (!tex) {
              const c = document.createElement("canvas");
              c.width = c.height = 2;
              const x = c.getContext("2d");
              x.fillStyle = "#" + om.color.getHexString();
              x.fillRect(0, 0, 2, 2);
              tex = new THREE.CanvasTexture(c);
              tex.flipY = false;
            }
            const m = ps1Mat(tex, 1);
            registerShopMat(m, 0.3);
            // wood, like the stall: a little shiny, so the lantern and the sign light catch it
            cache.set(om.uuid, m);
          }
          o.material = cache.get(om.uuid);
          o.frustumCulled = false;
        });
        g.scene.updateMatrixWorld(true);
        // so every crate can stand on its own foot, centred
        const cb = new THREE.Box3().setFromObject(g.scene);
        SHOP_CRATES.forEach((c) => {
          const inner = g.scene.clone(true);
          inner.position.set(
            -(cb.min.x + cb.max.x) / 2,
            -cb.min.y,
            -(cb.min.z + cb.max.z) / 2,
          );
          const holder = new THREE.Group();
          holder.add(inner);
          holder.scale.setScalar(c.s);
          holder.rotation.set(
            (c.lean[0] * Math.PI) / 180,
            (c.rot * Math.PI) / 180,
            (c.lean[1] * Math.PI) / 180,
          );
          holder.position.set(c.x, groundY + c.y, c.z);
          root.add(holder);
        });
      },
      (e) => console.error("crate load failed", e),
    );
  } catch (e) {
    console.error("crates failed", e);
  }
}
(function () {
  const el = document.getElementById("shop-data");
  if (!el) return;
  try {
    const t = atob(el.textContent.trim()),
      u = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
    new THREE.GLTFLoader().parse(
      u.buffer,
      "",
      (g) => {
        const root = g.scene,
          cache = new Map(),
          markers = [],
          toRemove = [];
        root.updateMatrixWorld(true);
        root.traverse((o) => {
          /* The loader tidies node names (spaces become _, dots are dropped), so 'SWORD HANDLE HERE. BLADE POINT DOWN.' arrives as SWORD_HANDLE_HERE_BLADE_POINT_DOWN and a test for 'HERE.' never matched:
         the labelled cylinders stayed in the stall and no weapons were placed. The label as typed in the model is kept in userData.name, so check that (and the tidied name too). */
          const rawName = (o.userData && o.userData.name) || o.name;
          if (
            /(^|[\s_])HERE([\s_.]|$)/i.test(rawName) ||
            /(^|[\s_])HERE([\s_.]|$)/i.test(o.name)
          ) {
            const mb = new THREE.Box3().setFromObject(o);
            const mk = {
              name: rawName,
              center: mb.getCenter(new THREE.Vector3()),
              min: mb.min.clone(),
              max: mb.max.clone(),
            };
            if (o.isMesh && o.geometry) {
              const bb =
                o.geometry.boundingBox ||
                // the cylinder's foot, its length and its lean (the shovel's marker leans a little)
                (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
              mk.bottom = o.localToWorld(
                new THREE.Vector3(
                  (bb.min.x + bb.max.x) / 2,
                  bb.min.y,
                  (bb.min.z + bb.max.z) / 2,
                ),
              );
              mk.len = bb.max.y - bb.min.y;
              mk.quat = o.getWorldQuaternion(new THREE.Quaternion());
            }
            markers.push(mk);
            o.visible = false;
            toRemove.push(o);
            return;
          }
          if (!o.isMesh) return;
          const om = o.material;
          const isRoof = o.position.y > 0.7 && o.rotation.z !== 0;
          const isMetalHardware =
            /torus|beveled_cuboid/i.test(o.name) ||
            (o.parent &&
              o.parent.name === "lanter" &&
              o.name !== "BRIGHTBOX");
          const shineLvl =
            o.name === "BRIGHTBOX"
              ? 0
              : isRoof
                ? 0.55
                : isMetalHardware
                  ? 0.55
                  // wood (the roof, and everything else that is not metal): a little shinier than before (0.45 / 0.22)
                  : 0.36;
          const key = om.uuid + "_" + shineLvl;
          if (!cache.has(key)) {
            let tex = om.map;
            if (!tex) {
              const c = document.createElement("canvas");
              c.width = c.height = 2;
              const x = c.getContext("2d");
              x.fillStyle = "#" + om.color.getHexString();
              x.fillRect(0, 0, 2, 2);
              tex = new THREE.CanvasTexture(c);
              tex.flipY = false;
            }
            const m = ps1Mat(tex, 1);
            if (shineLvl > 0) registerShopMat(m, shineLvl);
            cache.set(key, m);
          }
          o.material = cache.get(key);
          o.frustumCulled = false;
          if (o.name === "BRIGHTBOX") {
            o.material.uniforms.uEmit.value = 1;
            shopBulb = o;
          }
        });
        toRemove.forEach((o) => {
          if (o.parent) o.parent.remove(o);
        });
        placeShopGoods(root, markers);
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root),
          sc = (SHOP_HEIGHT * playerH) / (box.max.y - box.min.y);
        root.scale.setScalar(sc);
        shopScale = sc;
        shopRoot = root;
        root.position.set(
          (-(box.min.x + box.max.x) / 2) * sc,
          -box.min.y * sc,
          (-(box.min.z + box.max.z) / 2) * sc,
        );
        const grp = new THREE.Group();
        grp.add(root);
        grp.visible = false;
        scene.add(grp);
        shopGroup = grp;
        // after the stall was measured, so they don't change its size or where it stands
        placeShopCrates(root, box.min.y);
      },
      (e) => console.error("shop load failed", e),
    );
  } catch (e) {
    console.error("shop failed", e);
  }
})();
let shopEvt = { clock: 0, next: 6 };
function shopEvtStep(dt) {
  // every 5-11 s of plain idling the keeper plays ShopIdleAnimation1 once, then settles back into ShopIdle
  const sk = shopKeeper;
  if (!sk || !actions.ShopIdleAnimation1) return;
  if (sk.curAct !== sk.idleAct || shopTalkOn) {
    shopEvt.clock = 0;
    return;
  // not while talking, or while the event is already playing
  }
  shopEvt.clock += dt;
  if (shopEvt.clock < shopEvt.next) return;
  const a = sk.mixer.clipAction(actions.ShopIdleAnimation1.getClip());
  a.reset();
  a.setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = true;
  sk.curAct.crossFadeTo(a, 0.2, false);
  a.play();
  sk.curAct = a;
  const onFin = (e) => {
    if (e.action !== a) return;
    sk.mixer.removeEventListener("finished", onFin);
    if (sk.curAct === a) {
      const idle = sk.idleAct;
      idle.reset();
      a.crossFadeTo(idle, 0.25, false);
      idle.play();
      sk.curAct = idle;
    }
  // (if the keeper started talking meanwhile, the talk clips already took over)
  };
  sk.mixer.addEventListener("finished", onFin);
  shopEvt.clock = 0;
  shopEvt.next = 5 + Math.random() * 6;
}
function spawnShopKeeperInBuilding() {
  if (shopKeeper || !shopGroup || !knightScene || !actions.ShopIdle) return;
  // the helmets (and Helmet 6's face pane) load a moment after the model; the keeper is cloned only once they are there, or the keeper would end up with the first helmet
  if (helmetNames.indexOf("Helmet 6") < 0 || !helm6.pane) return;
  const root = (() => {
    const st = [];
    knightScene.traverse((o) => {
      if (o.userData && Object.keys(o.userData).length) {
        st.push([o, o.userData]);
        o.userData = {};
      }
    });
    try {
      return knightScene.clone(true);
    } finally {
      st.forEach(([o, u]) => {
        o.userData = u;
      });
    }
  })();
  const cache = new Map(),
    pTex = [],
    rocks = [];
  // the keeper is mirrored the other way from the player, so every shop clip plays flipped left-for-right (mirroring the model is the exact way to mirror an animation: see MIRROR_MODEL)
  root.scale.x = MIRROR_MODEL ? 1 : -1;
  root.traverse((o) => {
    if (
      o.name === "Shortsword" ||
      o.name === "Axe" ||
      o.name === "Hatchet" ||
      o.name === "Hammer" ||
      o.name === "KnightlySword" ||
      o.name === "Morningstar"
    )
      o.visible = false;
  });
  const h6Idx = Math.max(0, helmetNames.indexOf("Helmet 6")),
    oL = [],
    cL = [];
  knightScene.traverse((o) => oL.push(o));
  root.traverse((o) => cL.push(o));
  helmetSets.forEach((set, j) =>
    set.forEach((m) => {
      const cm = cL[oL.indexOf(m)];
      if (cm) cm.visible = j === h6Idx;
    }),
  );
  shopKeeperMats = [];
  const ah = "#a38aeb",
    // ph: the keeper's plume colour, sampled from their new helmet's plume texture
    ph = "#9177b6";
  root.traverse((o) => {
    if (o.name === "SeatRock") rocks.push(o);
    if (!o.isMesh || o.name === "SeatRock") return;
    if (o.name === "H6Face") {
      shopFaceAttach(o, root);
      o.frustumCulled = false;
      return;
    // the keeper's own animated face (shop-face-data), not tinted
    }
    const om = o.material;
    if (!om.uniforms) {
      o.visible = false;
      return;
    } /* the Knightly sword's halo (a plain additive material) is left out of copies of the knight */
    let nm = cache.get(om.uuid);
    if (!nm) {
      const src = om.uniforms.map.value,
        isPl = /Plume$/.test(o.name);
      let tex = src;
      if (isPl) {
        const pl = plumes.find((q) => q.tex === src);
        if (pl) {
          const cv = document.createElement("canvas");
          cv.width = pl.base.width;
          cv.height = pl.base.height;
          const t = new THREE.CanvasTexture(cv);
          t.flipY = false;
          t.encoding = THREE.LinearEncoding;
          t.generateMipmaps = false;
          t.minFilter = t.magFilter = THREE.NearestFilter;
          tintOne(
            {
              tex: t,
              ctx: cv.getContext("2d"),
              base: pl.base,
              avgL: pl.avgL,
            },
            ph,
          );
          tex = t;
          pTex.push(t);
        }
      }
      nm = ps1Mat(tex, 1);
      if (/h6_/.test(o.name)) {
        nm.uniforms.uBlackNoShine.value = 1;
        nm.uniforms.uBlackGrey.value = SHOP_H6_GREY;
      // (until shopHelmApply swaps in their new helmet textures)
      }
      if (!isPl) tintMat(nm, ah, SHOP_ARMOR_TINT);
      nm.uniforms.uShine.value = shopShineOn ? 1 : 0;
      if (/Plume$/.test(o.name)) nm.uniforms.uShine.value = 0;
      // the plume never shines
      else shopKeeperMats.push(nm);
      cache.set(om.uuid, nm);
    }
    o.material = nm;
    o.frustumCulled = false;
  });
  rocks.forEach((r) => r.parent && r.parent.remove(r));
  const rig = new THREE.Group();
  rig.add(root);
  const ox = -homeTarget.x,
    oz = -homeTarget.z,
    th = Math.PI / 2;
  const kx = -0.08 * shopScale,
    kz = 0.05 * shopScale,
    ky = 0;
  rig.rotation.y = th;
  rig.position.set(
    kx - (ox * Math.cos(th) + oz * Math.sin(th)),
    ky,
    kz - (-ox * Math.sin(th) + oz * Math.cos(th)),
  );
  shopGroup.add(rig);
  const mx = new THREE.AnimationMixer(root);
  const idleAct = mx.clipAction(actions.ShopIdle.getClip());
  idleAct.play();
  mx.update(0);
  shopKeeper = { rig, root, mixer: mx, tex: pTex, idleAct, curAct: idleAct };
  shopHelmLoad();
  shopHelmApply(root);
  shopFitKeeper(shopKeeper);
}
/* The keeper's arms rest on the counter. ShopIdle holds their hands about 1.2 high, a little below the counter top and well short of the shelf, so the keeper is lifted and moved up to the counter:
 measured on the real pose (every 1/12 of the idle loop, the posed hand meshes in the stall's space), their lowest hand point ends on the shelf's top face and their hands reach SHOP_REST of the way across it.
 SHOP_TABLE is that shelf in the stall's own model units: the height of its top face, and where it starts / ends toward the open front (+x). */
const SHOP_TABLE = { top: 0.281, x0: 0.234, x1: 0.484 },
  // how far across the shelf their hands reach (0 = back edge, 1 = front edge): 0.3 -> 0.6 moves them forward over the table
  SHOP_REST = 0.6;
// their extra height relative to the table, in the stall's model units (so it scales with the stall)
const SHOP_KEEPER_NUDGE = -0.0549;
function shopFitKeeper(sk) {
  const hands = ["Adventurer_Left_Hand", "Adventurer_Right_Hand"]
    .map((n) => sk.root.getObjectByName(n))
    .filter(Boolean);
  if (!hands.length || !shopRoot) return;
  const idle = sk.idleAct,
    dur = idle.getClip().duration,
    gy = shopGroup.position.y,
    box = new THREE.Box3(),
    c = new THREE.Vector3();
  let low = 1e9,
    fx = 0,
    n = 0;
  shopGroup.updateMatrixWorld(true);
  for (let i = 0; i <= 12; i++) {
    idle.time = (dur * i) / 12;
    sk.mixer.update(0);
    sk.rig.updateMatrixWorld(true);
    hands.forEach((h) => {
      box.setFromObject(h);
      low = Math.min(low, box.min.y - gy);
      box.getCenter(c);
      shopGroup.worldToLocal(c);
      fx += c.x;
      n++;
    });
  }
  idle.time = 0;
  sk.mixer.update(0);
  const X = (m) => m * shopScale + shopRoot.position.x,
    topY = SHOP_TABLE.top * shopScale + shopRoot.position.y;
  const wantX =
    X(SHOP_TABLE.x0) + SHOP_REST * (X(SHOP_TABLE.x1) - X(SHOP_TABLE.x0));
  const dy = Math.max(0, Math.min(0.8 * playerH, topY - low)),
    // (clamped, in case the pose ever measures oddly)
    dx = Math.max(-0.5 * playerH, Math.min(1.2 * playerH, wantX - fx / n));
  sk.rig.position.y += dy + SHOP_KEEPER_NUDGE * shopScale;
  // SHOP_KEEPER_LIFT: extra height (knight-heights) so their arms, not just their hands, sit on the table; x / z unchanged
  sk.rig.position.x += dx;
}
function shopSync() {
  // put the stall on its spot (once the knight's home is known) and show it everywhere but inside the ruins
  if (!shopGroup) return;
  if (!shopPlaced && blobHome && homeTarget) {
    shopGroup.position.set(
      homeTarget.x + SHOP_SPOT.x * playerH,
      blobHome.y,
      homeTarget.z + SHOP_SPOT.z * playerH,
    );
    shopF
      .set(
        homeTarget.x - shopGroup.position.x,
        0,
        homeTarget.z - shopGroup.position.z,
      )
      // faces the knight's clearing
      .normalize();
    // model +x (the open front, with the sign) -> shopF
    shopGroup.rotation.y = Math.atan2(-shopF.z, shopF.x);
    shopPlaced = true;
  }
  if (shopPlaced) spawnShopKeeperInBuilding();
  shopGroup.visible = shopPlaced && !dungeon;
  if (shopPlaced && greenTreeGroup && greenTreeGroup !== shopCleared) {
    // no trees inside the stall, or in the way of the camera in front of it (also again if the forest is rebuilt)
    const H = playerH,
      S = shopGroup.position,
      reach = SHOP_DIST * H + 1.5 * H,
      near = (t) => {
        const dx = t.x - S.x,
          dz = t.z - S.z,
          al = dx * shopF.x + dz * shopF.z,
          pe = Math.abs(dx * shopF.z - dz * shopF.x);
        return (
          Math.hypot(dx, dz) < SHOP_CLEAR * H ||
          (al > 0 && al < reach && pe < SHOP_LANE * H)
        );
      };
    greenTreeGroup.children.slice().forEach((tr) => {
      if (near(tr.position)) greenTreeGroup.remove(tr);
    });
    if (typeof colliders !== "undefined" && colliders)
      colliders = colliders.filter((c) => !near(c));
    shopCleared = greenTreeGroup;
  }
}
/* ---------- KRIS TALKS: Undertale-style voice lines in the shop ----------
 Kris greets you when the shop opens, TALK (second row) lets you ask Kris things, and BACK / ESC makes Kris say goodbye before you are back on the map. The words are all in SHOP_VOICE: `f` on a line picks their face
 (default 'talking'; 'angrytalking' for the sassy ones), words in CAPS are drawn in gold. The text appears letter by letter in the box along the bottom (it is a short strip, so the shop stays visible),
 with a little cat meow slice (shop-meow-data: five meows) for every couple of letters. ENTER / SPACE / Z / a click on the box: finish the line, then the next one. ESC: skip the rest.
 While Kris speaks Kris plays the talking animation and the camera moves in on Kris (the old TALK / END TALK test controls, T and E, are what it runs). */
const SHOP_VOICE = {
  greet: [
    "Oh, hey. What's up.",
    "You new around here?",
    { t: "I sell things. Buy them.", f: "angrytalking" },
    "You know I could really go for Chinese food.",
  ],
  talk: [
    { q: "WHO ARE YOU?", a: ["I'm a talking cat."] },
    {
      q: "WHAT DO YOU SELL?",
      a: [
        {
          t: "Why don't you LOOK before asking STUPID questions?",
          f: "angrytalking",
        },
      ],
    },
  ],
  // SELL on the main panel: Kris says this (CAPS words in gold) with their angry face
  sell: [{ t: "I don't want your JUNK.", f: "angrytalking" }],
  bye: ["Um. Okay. Bye."],
  cps: 30,
  pause: { ",": 0.16, ".": 0.3, "!": 0.3, "?": 0.3 },
  every: 2,
  gain: 0.55,
  // letters per second, the wait after punctuation (s), a meow every N letters, meow volume, how long Kris waits before you leave
  byeWait: 0.9,
};
const SHOP_CSS = `
/* Where everything sits (landscape): the shop panel top-left, the song button top-right, the chat bar along the bottom. --sdH is the room the chat bar can take (three lines of text,
   its padding, the gap under it), and the panel is never allowed to grow into it, so they can not overlap whatever the window size. On a tall narrow screen the panel runs across the top,
   the chat bar across the bottom and the song button sits just above the chat bar. */
:root{--sdF:min(30px,4.6vh);--sdH:calc(var(--sdF)*3.6 + 52px + 18px + env(safe-area-inset-bottom,0px))}
#shoplbl{position:fixed;left:50%;bottom:calc(34px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);text-align:center;color:#ffd45e;text-shadow:3px 3px 0 #000;font-size:46px;letter-spacing:.14em;opacity:0;transition:opacity .6s;pointer-events:none;z-index:15;line-height:1}
#shoplbl small{display:block;margin-top:6px;font-size:22px;letter-spacing:.1em;color:#fff}
#shoplbl.on{opacity:1}#shoplbl.hush{opacity:0!important;transition-duration:.12s}
#shopui{position:fixed;left:3vw;top:9vh;width:min(32vw,440px);height:auto;max-height:calc(100vh - 9vh - var(--sdH) - 46px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;box-sizing:border-box;border:3px solid var(--ui-edge);background:var(--ui-panel);box-shadow:0 0 0 3px #000,inset 0 0 0 3px rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;padding:24px;gap:12px;font-size:min(34px,5vh);letter-spacing:.14em;color:var(--ui-text);text-shadow:3px 3px 0 #000;opacity:0;transition:opacity .6s;pointer-events:none;z-index:15}
#shopui::-webkit-scrollbar{display:none}#shopui>*{flex-shrink:0}
#shopui.on{opacity:1;pointer-events:auto}#shopui .mi{display:flex;justify-content:space-between}
#shopui .shoplist,#shopui .shoptalklist{display:flex;flex-direction:column;gap:12px;flex:0 0 auto}
#shopui:not(.buy) .shoplist{display:none}#shopui.buy .shopmain{display:none}
#shopui.talk .shopmain{display:none}#shopui:not(.talk) .shoptalklist{display:none}
#shopui.busy .mi{opacity:.45}
#shopsong{position:fixed;right:max(14px,env(safe-area-inset-right,0px));top:calc(14px + env(safe-area-inset-top,0px));z-index:16;font:inherit;font-size:22px;letter-spacing:.08em;color:var(--ui-text);background:var(--ui-panel);border:2px solid var(--ui-edge);box-shadow:0 0 0 2px #000;padding:4px 12px;opacity:0;pointer-events:none;transition:opacity .6s,background .15s;text-shadow:2px 2px 0 #000;text-align:right;cursor:pointer;user-select:none;-webkit-user-select:none}
#shopsong small{display:block;margin-top:2px;font-size:13px;letter-spacing:.1em;color:var(--ui-dim)}
#shopsong:hover{background:var(--ui-hover)}#shopsong.on{opacity:1;pointer-events:auto}
#shopdlg{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);width:min(64vw,900px);box-sizing:border-box;border:3px solid var(--ui-edge);background:var(--ui-panel);box-shadow:0 0 0 3px #000,inset 0 0 0 3px rgba(0,0,0,.35);padding:16px 26px 30px;font-size:var(--sdF);letter-spacing:.06em;line-height:1.2;color:var(--ui-text);text-shadow:3px 3px 0 #000;opacity:0;pointer-events:none;transition:opacity .25s;z-index:16;cursor:pointer;user-select:none;-webkit-user-select:none}
#shopdlg.on{opacity:1;pointer-events:auto}#shopdlg .dtxt{min-height:2.4em;max-height:3.6em;overflow-y:auto;scrollbar-width:none;white-space:pre-wrap}#shopdlg b{font-weight:normal;color:#ffd45e}
#shopdlg::before{content:"KRIS";position:absolute;left:18px;top:-1.15em;padding:0 .6em;font-size:.72em;letter-spacing:.22em;color:#ffd45e;background:var(--ui-panel);border:3px solid var(--ui-edge);box-shadow:0 0 0 3px #000}
#shopdlg .dhint{position:absolute;left:26px;bottom:6px;font-size:.5em;letter-spacing:.12em;color:var(--ui-dim)}
#shopdlg .dnxt{position:absolute;right:22px;bottom:10px;width:0;height:0;border:9px solid transparent;border-top:12px solid var(--ui-text);border-bottom:0;display:none;animation:dnxt .7s steps(2) infinite}#shopdlg.wait .dnxt{display:block}@keyframes dnxt{50%{opacity:0}}
@media (max-width:760px){#shopdlg{width:92vw}}
@media (max-aspect-ratio:9/10){
#shopui{left:4vw;width:92vw;top:4vh;max-height:min(46vh,calc(100vh - 4vh - var(--sdH) - 100px))}
#shopdlg{width:92vw}
#shopsong{top:auto;bottom:calc(var(--sdH) + 40px);max-width:92vw;box-sizing:border-box;font-size:18px}
}
`;
function shopCssInit() {
  if (document.getElementById("shopcss")) return;
  const st = document.createElement("style");
  st.id = "shopcss";
  st.textContent = SHOP_CSS;
  document.head.appendChild(st);
}
const shopDlg = {
  on: false,
  lines: [],
  li: 0,
  pos: 0,
  acc: 0,
  wait: 0,
  typing: false,
  done: null,
  auto: 0,
  autoT: 0,
  raf: 0,
  last: 0,
  el: null,
  txt: null,
  lastGreet: -1,
  greeted: false,
  animOn: false,
  count: 0,
  lastBlip: 0,
};
function shopDlgInit() {
  if (shopDlg.el) return;
  shopCssInit();
  const el = document.createElement("div");
  el.id = "shopdlg";
  el.innerHTML =
    '<div class="dtxt"></div><div class="dhint">ENTER: NEXT &nbsp; ESC: SKIP</div><div class="dnxt"></div>';
  document.body.appendChild(el);
  shopDlg.el = el;
  shopDlg.txt = el.querySelector(".dtxt");
  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (shopDlg.on) shopDlgAdvance();
  });
  loadSfxSet("shop-meow-data");
}
function shopMeow(emph) {
  // one short slice of a random meow, a different pitch each time
  try {
    if (!sfx) return;
    const st = SFX_SETS["shop-meow-data"];
    if (!st || !st.bufs) {
      loadSfxSet("shop-meow-data");
      return;
    }
    sfx.resume();
    const b = cz(st.bufs[Math.floor(Math.random() * st.bufs.length)]),
      src = sfx.createBufferSource(),
      g = sfx.createGain(),
      t = sfx.currentTime,
      d = 0.12 + Math.random() * 0.04;
    src.buffer = b;
    src.playbackRate.value =
      (0.95 + Math.random() * 0.35) * (emph ? 1.14 : 1);
    const gn = SHOP_VOICE.gain * (emph ? 1.35 : 1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gn, t + 0.012);
    g.gain.linearRampToValueAtTime(0, t + d);
    src.connect(g);
    g.connect(sfx.destination);
    src.start(t, 0.02 + Math.random() * 0.22, d + 0.03);
  } catch (_) {}
}
function shopPlayClip(name, loop, next) {
  const cl = actions[name] && actions[name].getClip();
  if (!cl || !shopKeeper) return;
  const a = shopKeeper.mixer.clipAction(cl);
  a.reset();
  a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  a.clampWhenFinished = !loop;
  shopKeeper.curAct.crossFadeTo(a, 0.2, false);
  a.play();
  shopKeeper.curAct = a;
  if (next) {
    const onFin = (e) => {
      if (e.action === a) {
        shopKeeper.mixer.removeEventListener("finished", onFin);
        next();
      }
    };
    shopKeeper.mixer.addEventListener("finished", onFin);
  }
}
function shopTalkAnim(on) {
  // the talking animation + the camera moving in on Kris (on), or the outro + the camera pulling back (off)
  if (!shopKeeper || shopDlg.animOn === on) return;
  shopDlg.animOn = on;
  if (on) {
    if (actions.ShopIdleAnimationIntoTalk) {
      shopTalkOn = true;
      shopPlayClip("ShopIdleAnimationIntoTalk", false, () =>
        shopPlayClip("ShopIdleAnimationWhileTalking", true),
      );
    }
  } else if (actions.ShopIdleAnimationOutroTalk) {
    // the camera zooms back out
    shopTalkOn = false;
    const a = shopKeeper.mixer.clipAction(
      actions.ShopIdleAnimationOutroTalk.getClip(),
    );
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    shopKeeper.curAct.crossFadeTo(a, 0.2, false);
    a.play();
    shopKeeper.curAct = a;
    const onFin = (e) => {
      if (e.action === a) {
        shopKeeper.mixer.removeEventListener("finished", onFin);
        const idle = shopKeeper.idleAct;
        idle.reset();
        shopKeeper.curAct.crossFadeTo(idle, 0.25, false);
        idle.play();
        shopKeeper.curAct = idle;
      }
    };
    shopKeeper.mixer.addEventListener("finished", onFin);
  }
  // in the TALK panel the camera stays close
  if (!on && shopView === "talk") shopTalkOn = true;
}
const _dlgEsc = (t) =>
  t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[A-Z]{2,}/g, "<b>$&</b>");
function shopDlgStart() {
  const c = shopDlg.lines[shopDlg.li];
  shopDlg.cur = c;
  shopDlg.pos = 0;
  shopDlg.acc = 0;
  shopDlg.wait = 0;
  shopDlg.typing = true;
  shopDlg.count = 0;
  shopDlg.el.classList.remove("wait");
  shopDlg.txt.innerHTML = "";
  shopFaceSet(c.f || "talking");
}
function shopDlgDrawn() {
  shopDlg.txt.innerHTML = _dlgEsc(shopDlg.cur.t.slice(0, shopDlg.pos));
}
function shopDlgDone() {
  // the line is fully typed: the little arrow blinks
  shopDlg.typing = false;
  // (their face stays as the line set it - it goes back to normal only when the box closes, see shopDlgEnd)
  shopDlg.el.classList.add("wait");
  if (shopDlg.auto && shopDlg.li >= shopDlg.lines.length - 1)
    shopDlg.autoT = shopDlg.auto;
}
function shopDlgLoop(now) {
  if (!shopDlg.on) {
    shopDlg.raf = 0;
    return;
  }
  const dt = Math.min(0.05, (now - shopDlg.last) / 1000 || 0);
  shopDlg.last = now;
  if (shopDlg.typing) {
    const t = shopDlg.cur.t;
    shopDlg.wait -= dt;
    if (shopDlg.wait <= 0) {
      shopDlg.acc += dt * SHOP_VOICE.cps;
      while (shopDlg.acc >= 1 && shopDlg.pos < t.length) {
        shopDlg.acc -= 1;
        const ch = t[shopDlg.pos++];
        if (/[A-Za-z0-9]/.test(ch)) {
          if (shopDlg.count++ % SHOP_VOICE.every === 0)
            shopMeow(
              /[A-Z]/.test(ch) &&
                /[A-Z]/.test(
                  (t[shopDlg.pos - 2] || "") + (t[shopDlg.pos] || ""),
                ),
            );
        }
        const pz = SHOP_VOICE.pause[ch];
        if (pz && (shopDlg.pos >= t.length || t[shopDlg.pos] === " ")) {
          shopDlg.wait = pz;
          break;
        }
      }
      shopDlgDrawn();
      if (shopDlg.pos >= t.length) shopDlgDone();
    }
  } else if (shopDlg.autoT > 0) {
    shopDlg.autoT -= dt;
    if (shopDlg.autoT <= 0) {
      shopDlg.autoT = 0;
      shopDlgAdvance();
    }
  }
  shopDlg.raf = requestAnimationFrame(shopDlgLoop);
}
function shopSay(lines, done, auto) {
  shopDlgInit();
  shopDlg.lines = lines.map((l) => (typeof l === "string" ? { t: l } : l));
  shopDlg.li = 0;
  shopDlg.done = done || null;
  shopDlg.auto = auto || 0;
  shopDlg.autoT = 0;
  shopDlg.on = true;
  shopTalkAnim(true);
  shopDlgStart();
  shopDlg.el.classList.add("on");
  if (shopUi) shopUi.classList.add("busy");
  if (shopLbl) shopLbl.classList.add("hush");
  shopDlg.last = performance.now();
  if (!shopDlg.raf) shopDlg.raf = requestAnimationFrame(shopDlgLoop);
}
function shopDlgAdvance() {
  if (!shopDlg.on) return;
  if (shopDlg.typing) {
    shopDlg.pos = shopDlg.cur.t.length;
    shopDlgDrawn();
    shopDlgDone();
    return;
  // first press finishes the line
  }
  shopDlg.autoT = 0;
  shopDlg.li++;
  if (shopDlg.li < shopDlg.lines.length) shopDlgStart();
  else shopDlgEnd();
}
function shopDlgSkip() {
  if (shopDlg.on) shopDlgEnd();
}
function shopDlgEnd() {
  shopDlg.on = false;
  shopDlg.typing = false;
  shopDlg.el.classList.remove("on", "wait");
  if (shopUi) shopUi.classList.remove("busy");
  if (shopLbl) shopLbl.classList.remove("hush");
  const d = shopDlg.done;
  shopDlg.done = null;
  shopTalkAnim(false);
  shopFaceSet("normal");
  if (d) d();
}
function shopDlgReset() {
  // a new visit (or leaving): nothing half-said, the talking animation off
  if (shopDlg.el) {
    shopDlg.on = false;
    shopDlg.typing = false;
    shopDlg.done = null;
    shopDlg.el.classList.remove("on", "wait");
  }
  if (shopUi) shopUi.classList.remove("busy");
  if (shopLbl) shopLbl.classList.remove("hush");
  if (shopDlg.animOn) shopTalkAnim(false);
  shopDlg.animOn = false;
  shopDlg.greeted = false;
}
function shopGreet() {
  // Kris says ONE of the greet lines, picked at random (never the same one twice in a row)
  const g = SHOP_VOICE.greet;
  let i = Math.floor(Math.random() * g.length);
  if (g.length > 1 && i === shopDlg.lastGreet)
    i = (i + 1 + Math.floor(Math.random() * (g.length - 1))) % g.length;
  shopDlg.lastGreet = i;
  shopSay([g[i]]);
}
function shopAsk(i) {
  shopSay(SHOP_VOICE.talk[i].a);
}
function shopSell() {
  shopSay(SHOP_VOICE.sell);
// works like a TALK question: Kris zooms in, talks, and keeps their face until the box closes
}
function shopFarewell() {
  if (shopDlg.on || shopOut || shopT < 0) return;
  shopSay(SHOP_VOICE.bye, () => exitShop(), SHOP_VOICE.byeWait);
// Kris says bye, then it is the map (not the main menu) again
}
function enterShop() {
  if (shopT >= 0 || !shopGroup || !shopPlaced) return;
  shopDlgReset();
  document.body.classList.remove("mapui");
  mapPings.forEach((q) => q.el.classList.remove("on"));
  shopTalkOn = false;
  shopTalkK = 0;
  setShopMusic(true);
  shopFrom = {
    p: camera.position.clone(),
    pit: camera.rotation.x,
    yaw: camera.rotation.y,
    view: mapViewK,
  };
  shopFog = [U.uFogNear.value, U.uFogFar.value];
  shopOut = false;
  shopT = 0;
  if (!shopLbl) {
    /* Shop UI on the left */
    shopCssInit();
    shopUi = document.createElement("div");
    shopUi.id = "shopui";
    shopUi.innerHTML =
      '<div class="shophead" style="border-bottom:2px solid var(--ui-edge);padding-bottom:6px;margin-bottom:8px">SHOP</div>' +
      '<button class="mi shopmain" data-m="0" type="button"><span>BUY</span><span class="v">&#9654;</span></button>' +
      '<button class="mi shopmain" data-m="1" type="button"><span>TALK</span><span class="v">&#9654;</span></button>' +
      '<button class="mi shopmain" data-m="2" type="button"><span>SELL</span></button>' +
      '<button class="mi shopmain" data-m="3" type="button"><span>BACK</span></button>' +
      '<div class="shoptalklist">' +
      SHOP_VOICE.talk
        .map(
          (q, k) =>
            '<button class="mi shoptalk" data-i="' +
            k +
            '" type="button"><span>' +
            q.q +
            "</span></button>",
        )
        .join("") +
      '<button class="mi shoptalk" data-i="' +
      SHOP_VOICE.talk.length +
      '" type="button"><span>BACK</span></button></div>' +
      '<div class="shoplist">' +
      shopItems
        .map(
          (it, k) =>
            '<button class="mi shopbuy" data-i="' +
            k +
            '" type="button"><span>' +
            it.label +
            "</span></button>",
        )
        .join("") +
      '<button class="mi shopbuy" data-i="' +
      shopItems.length +
      '" type="button"><span>BACK</span></button></div>';
    document.body.appendChild(shopUi);
    shopUi.querySelectorAll(".shopmain").forEach((b) => {
      const i = +b.dataset.m;
      b.onmouseenter = () => shopSelect(i, true);
      b.onclick = () => {
        shopSelect(i, false);
        shopActivate();
      };
    });
    shopUi.querySelectorAll(".shopbuy").forEach((b) => {
      const i = +b.dataset.i;
      b.onmouseenter = () => shopSelect(i, true);
      b.onclick = () => {
        shopSelect(i, false);
        shopActivate();
      };
    });
    shopUi.querySelectorAll(".shoptalk").forEach((b) => {
      const i = +b.dataset.i;
      b.onmouseenter = () => shopSelect(i, true);
      b.onclick = () => {
        shopSelect(i, false);
        shopActivate();
      };
    });
    shopSongBtn = document.createElement("div");
    shopSongBtn.id = "shopsong";
    shopSongLabel();
    document.body.appendChild(shopSongBtn);
    shopSongBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      shopSongNext();
    });
    shopSongBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    shopLbl = document.createElement("div");
    shopLbl.id = "shoplbl";
    shopLbl.innerHTML = "SHOP<small>ESC: LEAVE</small>";
    document.body.appendChild(shopLbl);
  }
  shopDlgInit();
  // every visit starts on the main panel
  shopSetView("main");
}
let shopTalkOn = false,
  shopTalkK = 0;
const _tkV = new THREE.Vector3();
// SHOP_TALK_DIST: how far (knight-heights) in front of the keeper's face the camera stops while the keeper talks
const SHOP_TALK_DIST = 1.2;
function shopTalkCam(dt, u) {
  const want = shopTalkOn ? 1 : 0;
  shopTalkK += (want - shopTalkK) * (1 - Math.exp(-dt * 3.5));
  if (Math.abs(want - shopTalkK) < 0.002) shopTalkK = want;
  if (shopTalkK <= 0 || u < 1 || !shopKeeper) return;
  const hd =
    shopKeeper.root.getObjectByName("H6Face") ||
    shopKeeper.root.getObjectByName("Head");
  if (!hd) return;
  hd.getWorldPosition(_tkV);
  const H = playerH,
    k = shopTalkK * shopTalkK * (3 - 2 * shopTalkK),
    d = SHOP_TALK_DIST * H;
  camera.position.set(
    mapLerp(camera.position.x, _tkV.x + shopF.x * d, k),
    mapLerp(camera.position.y, _tkV.y, k),
    mapLerp(camera.position.z, _tkV.z + shopF.z * d, k),
  );
  camera.rotation.x = mapLerp(camera.rotation.x, 0, k);
}
function shopStep(dt) {
  shopT += dt;
  const u = Math.min(1, shopT / SHOP_DUR),
    H = playerH,
    S = shopGroup.position;
  const ex = S.x + shopF.x * SHOP_DIST * H,
    ey = blobHome.y + SHOP_CAM_Y * H,
    ez = S.z + shopF.z * SHOP_DIST * H,
    // where the camera lands (out in front of the stall), and how it is tilted there (level, a hair up)
    ep = Math.atan2(blobHome.y + SHOP_LOOK_Y * H - ey, SHOP_DIST * H);
  const eyaw = Math.atan2(shopF.x, shopF.z),
    dyaw =
      ((((eyaw - shopFrom.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) %
        (Math.PI * 2)) -
      // turned to look back at the stall, the short way round
      Math.PI;
  const kh = mapIOC(u),
    kp = mapIO(map01(u / 0.9)),
    kx = mapIO(u);
  camera.position.set(
    mapLerp(shopFrom.p.x, ex, kx),
    mapLerp(shopFrom.p.y, ey, kh),
    mapLerp(shopFrom.p.z, ez, kx),
  );
  camera.rotation.set(
    mapLerp(shopFrom.pit, ep, kp),
    shopFrom.yaw + dyaw * kx,
    0,
  );
  shopTalkCam(dt, u);
  camera.updateMatrixWorld(true);
  U.uFogNear.value = mapLerp(shopFog[0], SHOP_FOG[0] * H, kx);
  // thin haze instead of the menu's thick fog
  U.uFogFar.value = mapLerp(shopFog[1], SHOP_FOG[1] * H, kx);
  const tk = shopTalkK * shopTalkK * (3 - 2 * shopTalkK),
    vk = mapLerp(shopFrom.view, SHOP_VIEW, kx) * (1 - tk);
  if (Math.abs(vk - mapViewK) > 1e-4) {
    mapViewK = vk;
    applyView();
  // the stall slides a little right of center
  }
  if (shopUi) shopUi.classList.toggle("on", u >= 1 && !shopOut);
  if (u >= 1 && !shopOut && !shopDlg.greeted) {
    shopDlg.greeted = true;
    shopGreet();
  // Kris says hello once you are at the stall
  }
  if (shopLbl) shopLbl.classList.toggle("on", u >= 1 && !shopOut);
  if (shopSongBtn) shopSongBtn.classList.toggle("on", u >= 1 && !shopOut);
  shopSpin(dt);
}
function exitShop() {
  if (shopOut || shopT < 0) return;
  shopDlgReset();
  shopTalkOn = false;
  helmet6Face("normal");
  shopOut = true;
  setShopMusic(false);
  blip(300, 0.08);
  if (shopLbl) shopLbl.classList.remove("on");
  if (shopSongBtn) shopSongBtn.classList.remove("on");
  if (shopUi) shopUi.classList.remove("on");
  shopSetView("main");
  fadeThen(() => {
    shopT = -1;
    shopOut = false;
    mapSnap();
  // under the black: back to the menu camera
  });
}
