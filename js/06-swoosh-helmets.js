// Sword swoosh, alternate helmets and faces.
// (Part 6 of 14. All parts share one scope; see README.)

/* ---------- sword swoosh (sword_swoosh_wip1.gif: 6 frames, packed into the strip below) ----------
 While the Swing clip plays, the blade's path is sampled in tiny sub-steps, so the 15 fps pose stepping can't skip over the arc.
 Only the fast part of the swing (the chop, not the wind-up or the recovery) leaves a trail: a camera-facing ribbon is laid along
 the path of the tip and the swoosh frames are mapped onto it - sharp tail at the oldest end, fat flat end right behind the blade.
 The frames then play in place (the tail erodes first) while the sword carries on. Options > SWOOSH turns it off. */
const SWOOSH_TIP_Y = 1.66,
  // blade tip / grip along the sword's own axis (see sword-data)
  SWOOSH_HILT_Y = 0.85;
// ribbon width, in sword units (the blade is ~0.7 long)
const SWOOSH_WIDTH = 0.55;
// fraction of the width that sits outside the tip's path (0 = the tip runs along the outer edge)
const SWOOSH_OUT = 0.15;
// true = mirror the sprite across the ribbon (bright rim on the inside instead of the outside)
const SWOOSH_FLIP_U = false;
// time per frame. The GIF itself uses 170 ms, which lingers long after a ~0.1 s chop
const SWOOSH_FRAME_MS = 95;
// tip speed (sword units per second) that starts a trail...
const SWOOSH_START_SPEED = 11;
// ...and the speed under which it stops growing. The wind-up peaks near 7, the chop near 16
const SWOOSH_STOP_SPEED = 6.5;
// ignore the first moments of a swing (the cross-fade from idle looks like fast motion)
const SWOOSH_MIN_CLIP_T = 0.12;
// sampling step while swinging, in seconds
const SWOOSH_STEP = 1 / 120;
const SWOOSH_MAXPTS = 48,
  SWOOSH_FRAMES = 6;
const SWOOSH_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAAlCAYAAADr98PUAAAB7ElEQVR42u2cUY6DMAxEIeIYnIXD5yzcg/2Klq2WEogdbPNGqlS1H5PEk4ntCMahA3LO2+dvy7KMAwDCmHqIeJ7nP/+t68rKAxWMvUS8FzPuDEwLugj5SMSIGbhIOWqFDIB5h845b1eErO3O+3SHUwCHVhWzJj5PCQpOBK2eYmi4M+kOaBK0FVf+JmSKTjBpi1lKZFYcuYyDjWMTyYMzlzFYGsd/t5/AgaAtpBg1Qu7RRSFfdy7o1iC2isxS3o6YnQv66SBaFjPFJykHzgyeE/STgUTMQFTQBJI18IwJIdncUOU7uXqDQyMoO8Uw/W7nRaGlCxxOqACCZjEBDn2C2iMTdz7mJ+24IegI7twS+KvzlxYZp2OgHJpgAklMb18ACsHfcZTvnluFCYcEkVqF6inHtwWS3kxXg9HCLxF4q8WwZ1GnAYQueN9WvyTPAWnhkghmz85KlE2EQ7/UPbV5otZOKeKOj3oZ0Xte2nw55618cGjHQqMY1euspKgO07O7EvkE0uDS7Kx0d+jIqUcNn9Rmuju3O/ye6oS0LMsY+X1w0fJO71xnG6qVZywkNROSQnlquifv/kntHrxHT4afcd/hLYZUc2V9xF/Le4Wrhfcuz9g6oLuoHagk75XFkeKVCrwWXwuv5CvepHh+AOr/DXyfkM+zAAAAAElFTkSuQmCC";
let swooshOn = true,
  swTip = null,
  swHilt = null,
  swPivot = null;
/* Each weapon has its own swoosh rig: two marker points on it (swTip = the leading end of the blade/head, swHilt = back toward the hand, which just gives the scale), the shoulder the trail
 is measured from, the ribbon's width, and the tip speeds (in weapon units per second) that start and stop a trail. Only the weapon in his hand is used. */
let swLen = SWOOSH_TIP_Y - SWOOSH_HILT_Y,
  swWidth = SWOOSH_WIDTH,
  swStart = SWOOSH_START_SPEED,
  swStop = SWOOSH_STOP_SPEED,
  swAlt = null,
  swFlag = 0,
  // swFlag: the two-handed weapons - the trail is a flag on the weapon's top, this long (weapon units)   // swAlt: the second bit of a double-bitted head
  swFlagOn = false;
const swRigs = {};
/* The Axe: its head has a cutting edge at each end (the two bits, at +/- bit along the blade axis, halfway up the head at mid). The trail follows whichever bit is leading the swing:
 both are watched, the faster one when a trail starts keeps it. hilt = the top grip, only for the scale. Speeds are in axe units per second and a bit moves faster than the middle
 of the head did, so they are a bit higher than before (start/stop the trail). Tuned by reading the clip, not by eye: nudge start/stop if the trail comes too early or lingers. */
// the top of the shovel model, along its shaft
const SHOVEL_TOP_Y = 2.138;
const AXE_SWOOSH = {
  bit: 0.875,
  mid: 1.906,
  hilt: 1.366,
  width: 0.75,
  start: 10.5,
  stop: 7.5,
};
/* The Hatchet follows the sword's swing, so it uses the sword's speeds; the trail follows the edge of its head (tip = the outer corner of the blade). */
const HATCHET_SWOOSH = {
  tip: [0, 1.766, -0.48],
  hilt: [0, 1.0, 0],
  width: 0.5,
};
const HAMMER_SWOOSH = {
  tip: [0, 1.2, 0.44],
  hilt: [0, 0.6, 0.125],
  width: 0.4,
// the trail follows the far face of the head
};
const MORNINGSTAR_SWOOSH = {
  tip: [0, 1.1775, 0.264],
  hilt: [0, 0.81, 0],
  width: 0.3,
// the trail follows the spikes on the far side of the ball (tip = the spike's point at the ball's height)
};
function swooshAddRig(key, grp, pivot, tipPos, hiltPos, o) {
  const tip = new THREE.Object3D(),
    hilt = new THREE.Object3D();
  tip.position.set(tipPos[0], tipPos[1], tipPos[2]);
  hilt.position.set(hiltPos[0], hiltPos[1], hiltPos[2]);
  grp.add(tip);
  grp.add(hilt);
  let alt = null;
  if (o.alt) {
    alt = new THREE.Object3D();
    alt.position.set(o.alt[0], o.alt[1], o.alt[2]);
    grp.add(alt);
  }
  swRigs[key] = {
    tip,
    hilt,
    alt,
    pivot,
    len: tip.position.distanceTo(hilt.position),
    width: o.width,
    start: o.start,
    stop: o.stop,
    flag: o.flag || 0,
  };
}
/* The Knightly Sword's swing trail is a bright fade through the colours of the gems set in its blade (red, orange, yellow, green, teal, pink - the shader's gem list): the trail is painted in them, running along its length from the tail (oldest) to the tip (newest), and the whole
 palette rolls along it as the swing goes (the shader's uRainbow / uHue). SWOOSH_RAINBOW_CYCLES = how many times the full palette repeats along the trail; SWOOSH_RAINBOW_SPEED = how fast it rolls (spectra per second);
 SWOOSH_RAINBOW_BRIGHT = brightness boost on the picture's own light and dark (above 1 = punchier). Every other weapon keeps the plain trail. */
const SWOOSH_RAINBOW_CYCLES = 1.0,
  SWOOSH_RAINBOW_SPEED = 2.5,
  SWOOSH_RAINBOW_BRIGHT = 1.35;
// (the Knightly Sword is held)
let swTintOn = false;
function swooshApplyTint() {
  if (swsh.mat) swsh.mat.uniforms.uRainbow.value = swTintOn ? 1 : 0;
}
function swooshUse() {
  const key =
      weapon === "axe"
        ? "axe"
        : swordStyle === "hatchet"
          ? "hatchet"
          : swordStyle === "hammer"
            ? "hammer"
            : swordStyle === "knightly"
              ? "knightly"
              : swordStyle === "morningstar"
                ? "morningstar"
                : "sword",
    r = swRigs[key] || swRigs.sword;
  if (!r) return;
  swTintOn = key === "knightly";
  swooshApplyTint();
  swTip = r.tip;
  swAlt = r.alt || null;
  swHilt = r.hilt;
  swPivot = r.pivot;
  swLen = r.len;
  swWidth = r.width;
  swStart = r.start;
  swStop = r.stop;
  swFlag = r.flag || 0;
  swFlagOn = false;
  swsh.hasPrev = false;
  swsh.emit = false;
}
const swsh = {
  mesh: null,
  geo: null,
  mat: null,
  pts: [],
  emit: false,
  active: false,
  age: 0,
  hasPrev: false,
  k: 1,
  prevP: new THREE.Vector3(),
  prevP2: new THREE.Vector3(),
  alt: false,
  a2: new THREE.Vector3(),
  prevC: new THREE.Vector3(),
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  tan: new THREE.Vector3(),
  tc: new THREE.Vector3(),
  w: new THREE.Vector3(),
  out: new THREE.Vector3(),
  cum: new Float32Array(SWOOSH_MAXPTS),
  W: new Float32Array(SWOOSH_MAXPTS * 3),
};
const SWOOSH_VS = `
uniform vec2 uRes; uniform float uSnap; varying vec2 vUv;
void main(){
  vec4 cp=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  if(uSnap>0.5){ vec2 n=cp.xy/cp.w; vec2 g=uRes*0.5; n=floor(n*g+0.5)/g; cp.xy=n*cp.w; }   // same vertex snapping as everything else
  gl_Position=cp; vUv=uv;
}`;
const SWOOSH_FS = `
uniform sampler2D map; uniform float uFrame; uniform float uFrames; uniform float uFade; uniform float uRainbow; uniform float uHue; uniform float uCycles; uniform float uBright; varying vec2 vUv;
void main(){
  if(uFade<0.999 && fract(dot(floor(gl_FragCoord.xy),vec2(0.7548776662,0.5698402910)))>=uFade) discard;   // fade in/out as a dither, to match the picture
  vec4 tx=texture2D(map,vec2((uFrame+clamp(vUv.x,0.002,0.998))/uFrames,clamp(vUv.y,0.002,0.998)));
  if(tx.a<0.5) discard;
  vec3 col=tx.rgb;
  if(uRainbow>0.5){   // the Knightly Sword: the colours of its own gems (red, orange, yellow, green, teal, pink) fade into one another along the trail, rolling with uHue; the picture's own lights and darks shape how bright it is
    float h=fract(vUv.y*uCycles+uHue)*6.0, gi=floor(h), gf=smoothstep(0.0,1.0,h-gi);
    vec3 g0=vec3(0.925,0.157,0.204), g1=vec3(0.957,0.533,0.094), g2=vec3(0.980,0.839,0.220), g3=vec3(0.251,0.886,0.408), g4=vec3(0.220,0.847,0.722), g5=vec3(0.973,0.329,0.471);
    vec3 ga=gi<0.5?g0:(gi<1.5?g1:(gi<2.5?g2:(gi<3.5?g3:(gi<4.5?g4:g5))));
    vec3 gb=gi<0.5?g1:(gi<1.5?g2:(gi<2.5?g3:(gi<3.5?g4:(gi<4.5?g5:g0))));
    vec3 rgb=mix(ga,gb,gf);
    float l=dot(tx.rgb,vec3(0.299,0.587,0.114));
    col=clamp(rgb*(0.45+l*uBright),0.0,1.0);
    col=mix(col,vec3(1.0),smoothstep(0.9,1.0,l)*0.35);   // only the very brightest core of the picture goes hot white
  }
  gl_FragColor=vec4(col,1.0);
}`;
function initSwoosh(grp, parent) {
  swTip = new THREE.Object3D();
  swTip.position.set(0, SWOOSH_TIP_Y, 0);
  grp.add(swTip);
  swHilt = new THREE.Object3D();
  swHilt.position.set(0, SWOOSH_HILT_Y, 0);
  grp.add(swHilt);
  swPivot =
    parent.getObjectByName(SWORD_HAND + "_Arm") ||
    // the shoulder: tells the ribbon which edge is "outside"
    parent.getObjectByName(SWORD_HAND + "_Forearm");
  swRigs.sword = {
    tip: swTip,
    hilt: swHilt,
    pivot: swPivot,
    len: SWOOSH_TIP_Y - SWOOSH_HILT_Y,
    width: SWOOSH_WIDTH,
    start: SWOOSH_START_SPEED,
    stop: SWOOSH_STOP_SPEED,
  };
  swooshUse();
  if (swsh.mesh) return;
  loadImg(SWOOSH_PNG)
    .then((img) => {
      const tex = new THREE.Texture(img);
      tex.flipY = false;
      tex.encoding = THREE.LinearEncoding;
      tex.generateMipmaps = false;
      tex.minFilter = tex.magFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      swsh.mat = new THREE.ShaderMaterial({
        vertexShader: SWOOSH_VS,
        fragmentShader: SWOOSH_FS,
        side: THREE.DoubleSide,
        uniforms: {
          map: { value: tex },
          uFrame: { value: 0 },
          uFrames: { value: SWOOSH_FRAMES },
          uFade: { value: 1 },
          uRainbow: { value: 0 },
          uHue: { value: 0 },
          uCycles: { value: SWOOSH_RAINBOW_CYCLES },
          uBright: { value: SWOOSH_RAINBOW_BRIGHT },
          uRes: U.uRes,
          uSnap: U.uSnap,
        },
      });
      swooshApplyTint();
      const M = SWOOSH_MAXPTS,
        geo = new THREE.BufferGeometry();
      const pa = new THREE.BufferAttribute(new Float32Array(M * 2 * 3), 3),
        ua = new THREE.BufferAttribute(new Float32Array(M * 2 * 2), 2);
      pa.setUsage(THREE.DynamicDrawUsage);
      ua.setUsage(THREE.DynamicDrawUsage);
      const idx = [];
      for (let i = 0; i < M - 1; i++) {
        const a = 2 * i;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      geo.setAttribute("position", pa);
      geo.setAttribute("uv", ua);
      geo.setIndex(idx);
      geo.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(geo, swsh.mat);
      mesh.name = "SwordSwoosh";
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      swsh.mesh = mesh;
      swsh.geo = geo;
    })
    .catch((e) => console.error("swoosh load failed", e));
}
function swooshHide() {
  swFlagOn = false;
  swsh.active = false;
  swsh.emit = false;
  swsh.pts.length = 0;
  if (swsh.mesh) swsh.mesh.visible = false;
}
function toggleSwoosh() {
  swooshOn = !swooshOn;
  if (!swooshOn) swooshHide();
}
/* one sample of the blade, taken between mixer sub-steps; h = seconds since the previous sample */
function swooshSample(h) {
  // the flag is handled in updateFlag
  if (swFlag > 0) return;
  if (!swTip || !swHilt || !swPivot || !swsh.mesh) return;
  const a = swsh.a,
    a2 = swsh.a2,
    b = swsh.b,
    c = swsh.c;
  swTip.getWorldPosition(a);
  if (swAlt) swAlt.getWorldPosition(a2);
  swHilt.getWorldPosition(b);
  swPivot.getWorldPosition(c);
  const k = a.distanceTo(b) / swLen;
  // k = world units per weapon unit
  if (!(k > 1e-5)) return;
  const sp1 = swsh.hasPrev ? a.distanceTo(swsh.prevP) / h / k : 0,
    sp2 = swAlt && swsh.hasPrev ? a2.distanceTo(swsh.prevP2) / h / k : 0;
  // a double-bitted head: the bit that is moving faster leads, and keeps the trail for this swing
  if (!swsh.emit) swsh.alt = !!swAlt && sp2 > sp1;
  const cur = swsh.alt ? a2 : a,
    speed = swsh.alt ? sp2 : sp1,
    prev = swsh.alt ? swsh.prevP2 : swsh.prevP;
  if (
    !swsh.emit &&
    current &&
    current.time >= SWOOSH_MIN_CLIP_T &&
    speed >= swStart
  ) {
    swsh.emit = true;
    swsh.active = true;
    swsh.age = 0;
    swsh.pts.length = 0;
    // start from where the blade just was
    swsh.pts.push({ p: prev.clone(), c: swsh.prevC.clone() });
  }
  if (swsh.emit) {
    if (speed < swStop || swsh.pts.length >= SWOOSH_MAXPTS) swsh.emit = false;
    else {
      swsh.pts.push({ p: cur.clone(), c: c.clone() });
      swsh.k = k;
    }
  }
  swsh.prevP.copy(a);
  swsh.prevP2.copy(a2);
  swsh.prevC.copy(c);
  swsh.hasPrev = true;
}
/* advance the mixer; while the sword swings, do it in small steps and sample the blade after each one */
/* DANCE: a 16-beat loop at 147 BPM (6.531 s) whose first beat is the song's beat at 0.33 s. While it plays, its time is slaved to the song's position, so it stays on the beat
 whatever the frame rate and through every loop of the song (the song itself is shorter than a whole number of beats). */
const DANCE_BEATS = 16;
/* DANCE2: the Dancing Twerk (a Mixamo dance, 15.17 s at 24 fps, retargeted onto this rig) on the 'Smash Bros' song, whose beat falls on 0.58 s + n * 0.6654 s (90.18 BPM). The dance bounces at about 102 BPM
 by itself, so it is slowed 14 percent to bounce once per beat: 26 beats = 17.30 s, the clip's whole length. Same arrangement as Dance: its time is slaved to the song. `beats` = the clip's length in beats
 (Dance uses DANCE_BEATS); `shift` = seconds added to the clip's time so the dance's downward bounces land ON the beat, not between them. */
const DANCE_SETS = {
  Dance: { key: "dance", bpm: 147, offset: 0.33 },
  Dance2: {
    key: "dance2",
    bpm: 90.18,
    offset: 0.58,
    beats: 26,
    shift: 0.5716,
  },
  Dance3: { key: "dance3", free: true },
// Dance3 (Wave Hip Hop Dance + 'Egyptian Swag'): no syncing - the clip just loops and the song just plays
};
let danceKey = "dance";
function danceStep() {
  const n = current && current.getClip().name,
    D = DANCE_SETS[n];
  if (
    !danceWant ||
    !D ||
    D.free ||
    !xtra[D.key].src ||
    current !== actions[n]
  )
    // (free = not slaved to the song)
    return;
  const L = ((D.beats || DANCE_BEATS) * 60) / D.bpm,
    // (0.03: the pose shown lags a little behind the clock)
    t = trackPos(xtra[D.key].src) - D.offset - 0.03 + (D.shift || 0);
  actions[n].time = ((t % L) + L) % L;
}
/* The UAL heavy combos lift his whole body off the floor (the hips' height comes straight from the mocap), so while one plays his height is controlled: every frame the rig is moved up or
 down so his lowest foot is exactly on the ground, and put back to its normal height as soon as the clip is over. */
let ualY0 = null;
const _ugB = new THREE.Box3(),
  UAL_GROUND = /^(UAL_.*Heavy|HeavyCombo)/;
function ualGround() {
  if (!playerRig || !current) return;
  const c = current.getClip(),
    src = c.ualSrc || c.name;
  if (!UAL_GROUND.test(src)) {
    if (ualY0 !== null) {
      playerRig.position.y = ualY0;
      ualY0 = null;
    }
    return;
  }
  if (ualY0 === null) ualY0 = playerRig.position.y;
  playerRig.position.y = ualY0;
  playerRig.updateMatrixWorld(true);
  let lo = 1e9;
  [
    "Adventurer_Left_Foot",
    "Adventurer_Right_Foot",
    "Adventurer_Left_Boot",
    "Adventurer_Right_Boot",
  ].forEach((n) => {
    const o = playerRig.getObjectByName(n);
    if (o) {
      _ugB.setFromObject(o);
      if (_ugB.min.y < lo) lo = _ugB.min.y;
    }
  });
  if (lo < 1e8) {
    const ground = (blobHome ? blobHome.y : 0) - 0.002 * playerH;
    playerRig.position.y = ualY0 + (ground - lo);
  }
}
function stepMixer(dt) {
  evStep(dt);
  const cn = current && current.getClip().name,
    onSwing =
      swooshOn &&
      swTip &&
      swsh.mesh &&
      (cn === "Swing" ||
        cn === "AxeSwing" ||
        cn === "SwingHeavyRelease" ||
        cn === "HeavyCombo" ||
        /^UAL_(Sword_Regular|Sword_Heavy|Melee_Hook)/.test(cn));
  if (!onSwing) {
    swsh.hasPrev = false;
    swsh.emit = false;
    mixer.update(dt);
    stickAxe();
    ualGround();
    return;
  }
  const n = Math.max(1, Math.ceil(dt / SWOOSH_STEP - 1e-6)),
    h = dt / n;
  for (let i = 0; i < n; i++) {
    mixer.update(h);
    swooshSample(h);
  }
  stickAxe();
  ualGround();
}
/* lay the ribbon along the sampled path, facing the camera; u runs across it (0 = outside), v along it (0 = oldest = sharp tail) */
function swooshBuild() {
  const P = swsh.pts,
    n = P.length,
    m = swsh.mesh;
  if (n < 2) {
    m.visible = false;
    return;
  }
  const cum = swsh.cum,
    W = swsh.W;
  cum[0] = 0;
  for (let i = 1; i < n; i++)
    cum[i] = cum[i - 1] + P[i].p.distanceTo(P[i - 1].p);
  const tot = cum[n - 1];
  if (!(tot > 1e-6)) {
    m.visible = false;
    return;
  }
  const tan = swsh.tan,
    tc = swsh.tc,
    w = swsh.w,
    out = swsh.out,
    cam = camera.position;
  let score = 0;
  for (let i = 0; i < n; i++) {
    const p = P[i].p;
    tan.subVectors(P[Math.min(i + 1, n - 1)].p, P[Math.max(i - 1, 0)].p);
    tc.subVectors(cam, p);
    w.crossVectors(tan, tc);
    if (w.lengthSq() < 1e-12) {
      if (i > 0) w.set(W[3 * i - 3], W[3 * i - 2], W[3 * i - 1]);
      else w.set(0, 1, 0);
    }
    w.normalize();
    if (
      i > 0 &&
      w.x * W[3 * i - 3] + w.y * W[3 * i - 2] + w.z * W[3 * i - 1] < 0
    )
      // keep the ribbon from twisting
      w.negate();
    W[3 * i] = w.x;
    W[3 * i + 1] = w.y;
    W[3 * i + 2] = w.z;
    out.subVectors(p, P[i].c);
    // does this side point away from the shoulder?
    score += w.dot(out);
  }
  const s = score < 0 ? -1 : 1,
    total = swWidth * swsh.k,
    uA = SWOOSH_FLIP_U ? 1 : 0,
    uB = 1 - uA;
  const pa = swsh.geo.attributes.position,
    ua = swsh.geo.attributes.uv,
    pv = pa.array,
    uv = ua.array;
  for (let i = 0; i < n; i++) {
    const p = P[i].p,
      wx = W[3 * i] * s,
      wy = W[3 * i + 1] * s,
      wz = W[3 * i + 2] * s,
      o = total * SWOOSH_OUT,
      v = cum[i] / tot;
    const ax = p.x + wx * o,
      ay = p.y + wy * o,
      // outer edge
      az = p.z + wz * o;
    pv[6 * i] = ax;
    pv[6 * i + 1] = ay;
    pv[6 * i + 2] = az;
    pv[6 * i + 3] = ax - wx * total;
    pv[6 * i + 4] = ay - wy * total;
    // inner edge
    pv[6 * i + 5] = az - wz * total;
    uv[4 * i] = uA;
    uv[4 * i + 1] = v;
    uv[4 * i + 2] = uB;
    uv[4 * i + 3] = v;
  }
  pa.needsUpdate = true;
  ua.needsUpdate = true;
  swsh.geo.setDrawRange(0, (n - 1) * 6);
  m.visible = true;
}
/* The two-handed weapons' swoosh is a FLAG nailed to the top of the weapon: the last point is the top, and every point before it just follows the one in front of it at a fixed distance,
 so when the weapon is waved the flag trails behind it. It shows for the first half of the swing animation (FLAG_START..FLAG_END of the clip) and fades in/out over FLAG_IN / FLAG_OUT seconds. */
const FLAG_N = 10,
  FLAG_START = 0.08,
  FLAG_END = 0.5,
  FLAG_IN = 0.06,
  FLAG_OUT = 0.1;
const _fd = new THREE.Vector3();
function updateFlag() {
  const m = swsh.mesh,
    act = current,
    cn = act && act.getClip().name,
    dur = act ? act.getClip().duration : 0,
    t = act ? act.time : 0,
    tEnd = dur * FLAG_END;
  if (!(
    swooshOn &&
    swTip &&
    swPivot &&
    (cn === "AxeSwing" || cn === "SwingHeavyRelease") &&
    t >= FLAG_START &&
    t < tEnd
  )) {
    if (swFlagOn || m.visible) {
      swFlagOn = false;
      swsh.active = false;
      m.visible = false;
    }
    return;
  }
  swTip.getWorldPosition(swsh.a);
  swHilt.getWorldPosition(swsh.b);
  swPivot.getWorldPosition(swsh.c);
  const k = swsh.a.distanceTo(swsh.b) / swLen;
  if (!(k > 1e-5)) return;
  const seg = (swFlag * k) / (FLAG_N - 1),
    P = swsh.pts;
  if (!swFlagOn) {
    // starts hanging down along the pole
    swFlagOn = true;
    P.length = 0;
    _fd.subVectors(swsh.b, swsh.a).normalize();
    for (let i = 0; i < FLAG_N; i++)
      P.push({
        p: swsh.a.clone().addScaledVector(_fd, seg * (FLAG_N - 1 - i)),
        c: swsh.c.clone(),
      });
  }
  P[FLAG_N - 1].p.copy(swsh.a);
  P[FLAG_N - 1].c.copy(swsh.c);
  for (let i = FLAG_N - 2; i >= 0; i--) {
    // each point keeps its distance from the one in front of it, and swings in behind it
    _fd.subVectors(P[i].p, P[i + 1].p);
    const d = _fd.length();
    if (d < 1e-6) _fd.set(0, -1, 0);
    else _fd.multiplyScalar(1 / d);
    P[i].p.copy(P[i + 1].p).addScaledVector(_fd, seg);
    P[i].c.copy(swsh.c);
  }
  const f = Math.max(
    0,
    Math.min(1, Math.min((t - FLAG_START) / FLAG_IN, (tEnd - t) / FLAG_OUT)),
  );
  swsh.k = k;
  swsh.active = true;
  swsh.mat.uniforms.uFrame.value = 0;
  swsh.mat.uniforms.uFade.value = f * f * (3 - 2 * f);
  swooshBuild();
}
function updateSwoosh(dt) {
  const m = swsh.mesh;
  if (!m) return;
  if (swFlag > 0) {
    updateFlag();
    return;
  }
  swsh.mat.uniforms.uFade.value = 1;
  if (!swsh.active || !swooshOn) {
    m.visible = false;
    return;
  }
  swsh.age += dt;
  const f = Math.floor((swsh.age * 1000) / SWOOSH_FRAME_MS);
  if (f >= SWOOSH_FRAMES) {
    swooshHide();
    return;
  }
  swsh.mat.uniforms.uFrame.value = f;
  // (rainbow only: the spectrum rolls towards the tip as the swing goes)
  swsh.mat.uniforms.uHue.value = -swsh.age * SWOOSH_RAINBOW_SPEED;
  swooshBuild();
}

/* ---------- alternate helmets (helmet-data holds extra sets: Helmet 2 = Blockbench project, Helmet 3 = Adventurer cylinder helm, Helmet 4 = beveled cuboid, Helmet 5 = Adventurer icosphere / sphere helm) ---------- */
let helmetSets = [],
  helmetNames = [],
  curHelmet = 0;
function loadImg(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
}
function initHelmets(grp, origParts) {
  helmetSets = [origParts];
  helmetNames = ["Helmet 1"];
  const HDS = JSON.parse(document.getElementById("helmet-data").textContent),
    SETS = HDS.sets || [HDS];
  Promise.all(
    SETS.map((set) =>
      Promise.all(set.parts.map((p) => loadImg(p.tex))).then((imgs) =>
        set.parts.map((p, k) => {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(p.p, 3),
          );
          geo.setAttribute(
            "normal",
            new THREE.Float32BufferAttribute(p.n, 3),
          );
          geo.setAttribute("uv", new THREE.Float32BufferAttribute(p.uv, 2));
          geo.setIndex(p.i);
          const tex = new THREE.Texture(imgs[k]);
          tex.flipY = false;
          const mat = ps1Mat(tex, 1);
          if (/^h6_/.test(p.name)) mat.uniforms.uBlackNoShine.value = 1;
          const m = new THREE.Mesh(geo, mat);
          m.name = "alt_" + p.name;
          m.position.set(p.t[0], p.t[1], p.t[2]);
          m.rotation.order = "ZYX";
          m.rotation.set(
            (p.r[0] * Math.PI) / 180,
            (p.r[1] * Math.PI) / 180,
            (p.r[2] * Math.PI) / 180,
          );
          m.visible = false;
          grp.add(m);
          if (/Plume$/.test(p.name)) setupPlume(mat);
          else {
            armorMats.push(mat);
            tintArmorMat(mat);
            bodyMeshes.push(m);
          }
          return m;
        }),
      ),
    ),
  )
    .then((sets) => {
      sets.forEach((s, k) => {
        helmetSets.push(s);
        helmetNames.push(SETS[k].name || "Helmet " + (k + 2));
      });
      buildHelmetUI();
      {
        const i6 = helmetNames.indexOf("Helmet 6");
        if (i6 >= 0) initHelmet6Face(grp, helmetSets[i6], i6);
      }
    })
    .catch((e) => console.error("helmet load failed", e));
}

/* ---------- Helmet 6's face ----------
 A flat pane sits in front of the round helmet and plays a pixel-art face. The faces come from the four gifs, stored in face-data as small transparent strips
 (the white background keyed out, two frames each, 500 ms per frame): normal, talking, angrytalking, spite. Only 'normal' plays for now; helmet6Face('talking') etc.
 switches it (from the console, or later from the game). The pane belongs to Helmet 6's set, so it only shows with that helmet - on the player and on any enemy wearing it.
 H6_FACE: w = pane width (head units), y / z = where its middle sits in the head's space (the helmet ball is centred at y 0.156, z 0.0625 with radius 0.219; +z is forward). */
// glow: not dimmed by the night tint, so the eyes stay bright
const H6_FACE = { w: 0.3, y: 0.165, z: 0.292, glow: true };
let helm6 = {
  faces: null,
  pane: null,
  mat: null,
  name: "normal",
  t: 0,
  frame: -1,
  w: 0,
  h: 0,
};
function initHelmet6Face(grp, set, idx) {
  const el = document.getElementById("face-data");
  if (!el || !set) return;
  const FD = JSON.parse(el.textContent);
  Promise.all(FD.order.map((n) => loadImg(FD.faces[n].png)))
    .then((imgs) => {
      const faces = {};
      FD.order.forEach((n, k) => {
        const f = FD.faces[n],
          tex = [];
        for (let i = 0; i < f.frames; i++) {
          // one small texture per frame: the pane just swaps which one it shows
          const cv = document.createElement("canvas");
          cv.width = FD.w;
          cv.height = FD.h;
          cv.getContext("2d").drawImage(
            imgs[k],
            i * FD.w,
            0,
            FD.w,
            FD.h,
            0,
            0,
            FD.w,
            FD.h,
          );
          const t = new THREE.CanvasTexture(cv);
          t.flipY = true;
          t.encoding = THREE.LinearEncoding;
          t.generateMipmaps = false;
          t.minFilter = t.magFilter = THREE.NearestFilter;
          // flipY on: a flat plane's uvs run bottom-to-top, unlike the helmet meshes'
          tex.push(t);
        }
        faces[n] = { tex, ms: f.ms, total: f.ms.reduce((a, b) => a + b, 0) };
      });
      const w = H6_FACE.w,
        h = (w * FD.h) / FD.w;
      const mat = ps1Mat(faces.normal.tex[0], 1);
      if (H6_FACE.glow)
        mat.uniforms.uNight = { value: new THREE.Vector3(1, 1, 1) };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.name = "H6Face";
      m.position.set(0, H6_FACE.y, H6_FACE.z);
      m.visible = curHelmet === idx;
      grp.add(m);
      // part of Helmet 6's set, so setHelmet() shows and hides it with the helmet
      set.push(m);
      helm6 = { faces, pane: m, mat, name: "normal", t: 0, frame: -1, w, h };
    })
    .catch((e) => console.error("helmet 6 face load failed", e));
}
function helmet6Face(name) {
  if (helm6.faces && helm6.faces[name]) {
    helm6.name = name;
    helm6.t = 0;
    helm6.frame = -1;
  } else console.warn("no such face", name, Object.keys(helm6.faces || {}));
}
window.helmet6Face = helmet6Face;
function updateHelm6Face(dt) {
  if (!helm6.faces) return;
  const f = helm6.faces[helm6.name];
  helm6.t += dt * 1000;
  const t = helm6.t % f.total;
  let i = 0,
    acc = 0;
  while (i < f.ms.length - 1 && t >= acc + f.ms[i]) {
    acc += f.ms[i];
    i++;
  }
  if (i !== helm6.frame) {
    helm6.frame = i;
    helm6.mat.uniforms.map.value = f.tex[i];
  }
  if (helm6.pane && knightScene)
    // the model is mirrored (and un-mirrored with the axe): flip the pane back so the art never reads backwards
    helm6.pane.scale.x = knightScene.scale.x < 0 ? -1 : 1;
}
/* ---------- the shopkeeper's own Helmet 6 face ----------
 Only the shopkeeper's helmet uses these (shop-face-data: the kris*.gif art, 85x85, two frames of 500 ms each: normal, talking, angrytalking, spite).
 The player's and the enemies' Helmet 6 keep the original face above. shopFaceSet('talking') etc. switches it (also from the console: shopFace('talking')).
 SHOP_H6_GREY: the parts of their helmet that are pure black in the texture (the ones that never shine) show this grey instead - 0 is black, 1 is white. */
const SHOP_H6_GREY = 0.4;
/* The shopkeeper's helmet = Helmet 6's shape with the textures of shop-helmet-data (the gltf's retextured helmet). The areas that used to be pure black (never shine) were kept: they carry alpha 254 in
 the new textures and uMaskNoShine reads that. The plume colour is the ph variable in spawnShopKeeperInBuilding. */
let shopHelmTex = null;
function shopHelmLoad() {
  if (shopHelmTex) return;
  const el = document.getElementById("shop-helmet-data");
  if (!el) return;
  shopHelmTex = {};
  const D = JSON.parse(el.textContent);
  Object.keys(D.tex).forEach((k) =>
    loadImg(D.tex[k]).then((im) => {
      const t = new THREE.Texture(im);
      t.flipY = false;
      t.encoding = THREE.LinearEncoding;
      t.generateMipmaps = false;
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      shopHelmTex[k] = t;
      if (shopKeeper) shopHelmApply(shopKeeper.root);
    }),
  );
}
function shopHelmApply(root) {
  if (!shopHelmTex) return;
  root.traverse((o) => {
    const t = shopHelmTex[o.name];
    if (!o.isMesh || !t || !o.material || !o.material.uniforms) return;
    const u = o.material.uniforms;
    u.map.value = t;
    u.uMaskNoShine.value = 1;
    u.uLevels = { value: 255 };
    u.uDither = { value: 0 };
    u.uBlackNoShine.value = 0;
    u.uBlackGrey.value = 0;
  });
}
let shopFace = {
  faces: null,
  mat: null,
  pane: null,
  name: "normal",
  t: 0,
  frame: -1,
};
function shopFaceAttach(mesh, root) {
  mesh.scale.x = root.scale.x < 0 ? -1 : 1;
  const el = document.getElementById("shop-face-data");
  if (!el) {
    if (helm6.mat) mesh.material = helm6.mat;
    return;
  // no data file: fall back to the original face
  }
  const FD = JSON.parse(el.textContent),
    blank = document.createElement("canvas");
  blank.width = blank.height = 1;
  const mat = ps1Mat(new THREE.CanvasTexture(blank), 1);
  if (H6_FACE.glow)
    // (a clear 1x1 until the images have loaded)
    mat.uniforms.uNight = { value: new THREE.Vector3(1, 1, 1) };
  {
    const u = mat.uniforms;
    u.uEmit.value = 1;
    u.uTint.value.set(1.3, 1.3, 1.3);
    u.uAffine = { value: 0 };
    u.uDither = { value: 0 };
    u.uLevels = { value: 255 };
  // the face gif: unlit and a bit over-bright, no wobble, no dither, full colour depth
  }
  // the original face is 82 px wide on a 0.30 pane: the same size per pixel, so the eyes keep their size on the helmet
  const pw = (H6_FACE.w * FD.w) / 82;
  mesh.geometry = new THREE.PlaneGeometry(pw, (pw * FD.h) / FD.w);
  mesh.material = mat;
  shopFace = {
    faces: null,
    mat,
    pane: mesh,
    name: shopFace.name || "normal",
    t: 0,
    frame: -1,
  };
  Promise.all(FD.order.map((n) => loadImg(FD.faces[n].png)))
    .then((imgs) => {
      const faces = {};
      FD.order.forEach((n, k) => {
        const f = FD.faces[n],
          tex = [];
        for (let i = 0; i < f.frames; i++) {
          const cv = document.createElement("canvas");
          cv.width = FD.w;
          cv.height = FD.h;
          cv.getContext("2d").drawImage(
            imgs[k],
            i * FD.w,
            0,
            FD.w,
            FD.h,
            0,
            0,
            FD.w,
            FD.h,
          );
          const t = new THREE.CanvasTexture(cv);
          t.flipY = true;
          t.encoding = THREE.LinearEncoding;
          t.generateMipmaps = false;
          t.minFilter = t.magFilter = THREE.NearestFilter;
          tex.push(t);
        }
        faces[n] = { tex, ms: f.ms, total: f.ms.reduce((a, b) => a + b, 0) };
      });
      shopFace.faces = faces;
    })
    .catch((e) => console.error("shopkeeper face load failed", e));
}
function shopFaceSet(name) {
  shopFace.name = name;
  shopFace.t = 0;
  shopFace.frame = -1;
}
window.shopFace = shopFaceSet;
function updateShopFace(dt) {
  const s = shopFace;
  if (!s.faces) return;
  const f = s.faces[s.name];
  if (!f) return;
  s.t += dt * 1000;
  const t = s.t % f.total;
  let i = 0,
    acc = 0;
  while (i < f.ms.length - 1 && t >= acc + f.ms[i]) {
    acc += f.ms[i];
    i++;
  }
  if (i !== s.frame) {
    s.frame = i;
    s.mat.uniforms.map.value = f.tex[i];
  }
}
function setHelmet(i) {
  curHelmet = i;
  helmetSets.forEach((s, j) =>
    s.forEach((m) => {
      m.visible = i === j;
    }),
  );
  const sel = document.getElementById("helmsel");
  if (sel) sel.value = String(i);
}
function cycleHelmet() {
  if (helmetSets.length > 1) setHelmet((curHelmet + 1) % helmetSets.length);
}
function buildHelmetUI() {
  /* dropdown fills itself from helmetSets; give a set a "name" in helmet-data to label it */
  const sel = document.getElementById("helmsel");
  sel.innerHTML = "";
  helmetSets.forEach((_, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = helmetNames[i] || "Helmet " + (i + 1);
    sel.appendChild(o);
  });
  sel.onchange = () => {
    setHelmet(+sel.value);
    sel.blur();
  };
  document.getElementById("hlbl").hidden = false;
  sel.hidden = false;
  setHelmet(0);
}
function buildPlumeUI() {
  const box = document.getElementById("sws");
  const SW = [
    ["#e15050", "Red (original)"],
    ["#4a78e8", "Blue"],
    ["#4fc25a", "Green"],
    ["#f0c030", "Gold"],
    ["#a05ae0", "Purple"],
    ["#f2f2f2", "White"],
  ];
  const mark = (el) =>
    box
      .querySelectorAll(".sw")
      .forEach((x) => x.setAttribute("aria-checked", x === el));
  SW.forEach(([hex, name], i) => {
    const b = document.createElement("button");
    b.className = "sw";
    b.style.background = hex;
    b.title = name;
    b.setAttribute("aria-label", name);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", i === 0);
    b.dataset.hex = i === 0 ? "" : hex;
    b.onclick = () => {
      tintPlume(i === 0 ? null : hex);
      mark(b);
      lookSave();
    };
    box.appendChild(b);
  });
  const p = document.createElement("input");
  p.type = "color";
  p.value = "#e15050";
  p.className = "sw";
  p.title = "Custom color";
  p.setAttribute("aria-label", "Custom plume color");
  p.setAttribute("aria-checked", "false");
  p.oninput = () => {
    tintPlume(p.value);
    mark(p);
    lookSave();
  };
  box.appendChild(p);
  {
    const hit = [...box.querySelectorAll("button.sw")].find(
      (x) => (x.dataset.hex || "") === (plumeHex || ""),
    );
    if (hit) mark(hit);
    else {
      p.value = plumeHex;
      mark(p);
    }
  }
  document.getElementById("plbl").hidden = false;
  box.hidden = false;
}

(function buildArmorUI() {
  const box = document.getElementById("asws"),
    slider = document.getElementById("astr"),
    lab = document.getElementById("astrl");
  const SW = [
    [null, "Steel (original)", "#9aa0aa"],
    ["#e8604f", "Crimson"],
    ["#e8b830", "Gold"],
    ["#58b868", "Verdant"],
    ["#4a88e8", "Azure"],
    ["#9a60e0", "Violet"],
    ["#e878b0", "Rose"],
    ["#3cc4bc", "Teal"],
  ];
  const mark = (el) =>
    box
      .querySelectorAll(".sw")
      .forEach((x) => x.setAttribute("aria-checked", x === el));
  SW.forEach(([hex, name, show], i) => {
    const b = document.createElement("button");
    b.className = "sw";
    b.style.background = show || hex;
    b.title = name;
    b.setAttribute("aria-label", name);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", i === 0);
    b.dataset.hex = hex || "";
    b.onclick = () => {
      armorHex = hex;
      applyArmorTint();
      mark(b);
      lookSave();
    };
    box.appendChild(b);
  });
  const p = document.createElement("input");
  p.type = "color";
  p.value = "#e8a23a";
  p.className = "sw";
  p.title = "Custom color";
  p.setAttribute("aria-label", "Custom armor tint");
  p.setAttribute("aria-checked", "false");
  p.oninput = () => {
    armorHex = p.value;
    applyArmorTint();
    mark(p);
    lookSave();
  };
  box.appendChild(p);
  {
    const hit = [...box.querySelectorAll("button.sw")].find(
      (x) => (x.dataset.hex || "") === (armorHex || ""),
    );
    if (hit) mark(hit);
    else {
      p.value = armorHex;
      mark(p);
    }
  }
  slider.oninput = () => {
    armorAmt = slider.value / 100;
    lab.textContent = "Tint strength " + slider.value + "%";
    applyArmorTint();
    lookSave();
  };
  slider.value = Math.round(armorAmt * 100);
  lab.textContent = "Tint strength " + slider.value + "%";
})();

(function buildShinyUI() {
  const b = document.getElementById("shiny");
  b.onclick = () => {
    shiny = !shiny;
    armorMats.concat(swordMats, chestShineMats).forEach(shineMat);
    b.setAttribute("aria-checked", shiny);
    b.blur();
  };
})();
(function buildSwordUI() {
  const box = document.getElementById("ssws"),
    chk = document.getElementById("smatch");
  const SW = [
    [null, "Steel (original)", "#9aa0aa"],
    ["#e8604f", "Crimson"],
    ["#e8b830", "Gold"],
    ["#58b868", "Verdant"],
    ["#4a88e8", "Azure"],
    ["#9a60e0", "Violet"],
    ["#e878b0", "Rose"],
    ["#3cc4bc", "Teal"],
  ];
  const els = [];
  let sel = null;
  function refresh() {
    els.forEach((x) =>
      x.setAttribute("aria-checked", !swordMatch && x === sel),
    );
    box.classList.toggle("dim", swordMatch);
    chk.setAttribute("aria-checked", swordMatch);
  }
  function pick(el, hex) {
    swordMatch = false;
    swordHex = hex;
    sel = el;
    applySwordTint();
    refresh();
  // choosing a color switches matching off
  }
  SW.forEach(([hex, name, show], i) => {
    const b = document.createElement("button");
    b.className = "sw";
    b.style.background = show || hex;
    b.title = name;
    b.setAttribute("aria-label", name);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", "false");
    b.onclick = () => pick(b, hex);
    box.appendChild(b);
    els.push(b);
    if (i === 0) sel = b;
  });
  const p = document.createElement("input");
  p.type = "color";
  p.value = "#e8a23a";
  p.className = "sw";
  p.title = "Custom color";
  p.setAttribute("aria-label", "Custom sword tint");
  p.setAttribute("aria-checked", "false");
  p.oninput = () => pick(p, p.value);
  box.appendChild(p);
  els.push(p);
  chk.onclick = () => {
    swordMatch = !swordMatch;
    applySwordTint();
    refresh();
    chk.blur();
  };
  refresh();
})();
