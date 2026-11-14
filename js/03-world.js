// World (forest / classic), night, time of day, comet, barrier, leaves, snow.
// (Part 3 of 14. All parts share one scope; see README.)

/* ---------- world: forest / classic ---------- */
let night = false,
  forest = true,
  mapArea = "greenfield",
  floorMat = null,
  floorTexClassic = null,
  floorTexForest = null,
  floorTexFrost = null,
  floorTexIgnis = null,
  treeGroup = null,
  greenTreeGroup = null,
  frostTreeGroup = null,
  ignisTreeGroup = null;
// daytime horizon colours (night is blended in separately by SKY_NIGHT, so these must be daylight blues)
const SKY_CLASSIC = 0x7db4ea,
  SKY_FOREST = 0x6ca8e6;
function mkFloorTex(c1, c2) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 2;
  const g = cv.getContext("2d");
  g.fillStyle = c1;
  g.fillRect(0, 0, 2, 2);
  g.fillStyle = c2;
  g.fillRect(0, 0, 1, 1);
  g.fillRect(1, 1, 1, 1);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.encoding = THREE.LinearEncoding;
  t.generateMipmaps = false;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  return t;
}
// Ignis Mourne sits another FROST_DIST north of The Veiled Frost
const IGNIS_DIST = 52;
// how far north (-Z, in knight-heights) The Veiled Frost sits from The Greenfield
const FROST_DIST = 26;
let mapAreaK = 0,
  mapAreaTarget = 0;
// 0 = The Greenfield, 1 = The Veiled Frost, 2 = Ignis Mourne; smoothly glides between them
const mapAreaV = { v: 0 };
let greenRockMesh = null,
  frostRockMesh = null,
  ignisRockMesh = null,
  spareGreenRock = null,
  spareFrostRock = null,
  spareIgnisRock = null;
const AREA_FOG = {
  frost: new THREE.Color(0xcfd4da),
  ignis: new THREE.Color(0xe8761e),
// The Veiled Frost: a greyish white - Ignis Mourne: a hellish orange-yellow (dimmer at night)
};
// how strongly the area colours take over the normal sky colour (1 = fully, 0 = not at all)
const AREA_FOG_MIX = 0.7;
const _fogC = new THREE.Color(),
  _fogB = new THREE.Color();
let fogBase = SKY;
function setSkyFog(hex) {
  fogBase = hex;
  applyAreaFog();
}
function applyAreaFog() {
  // the usual sky colour, pulled toward the area's colour as the map glides there, and back again when you leave
  const kf = Math.min(Math.max(mapAreaK, 0), 1) * AREA_FOG_MIX,
    ki = Math.min(Math.max(mapAreaK - 1, 0), 1) * AREA_FOG_MIX,
    dim = night ? 0.3 : 1;
  _fogC.setHex(fogBase);
  _fogB.copy(AREA_FOG.frost).multiplyScalar(dim);
  _fogC.lerp(_fogB, kf);
  _fogB.copy(AREA_FOG.ignis).multiplyScalar(dim);
  _fogC.lerp(_fogB, ki);
  renderer.setClearColor(_fogC);
  U.uFogColor.value.copy(_fogC);
}
function areaTrees(a) {
  return a === "ignis" && ignisTreeGroup
    ? ignisTreeGroup
    : a === "frost" && frostTreeGroup
      ? frostTreeGroup
      : greenTreeGroup;
}
function areaZOffset(area) {
  const a = area || mapArea;
  return (
    (a === "frost" ? -FROST_DIST : a === "ignis" ? -IGNIS_DIST : 0) *
    (playerH || 2.2)
  );
}
function syncFrostBlend() {
  if (!floorMat || !floorMat.uniforms.uFrostZ) return;
  const H = playerH || 2.2;
  floorMat.uniforms.uUseFrost.value = forest ? 1 : 0;
  // Border sits halfway between The Greenfield (z = 0) and The Veiled Frost (z = -FROST_DIST*H), at z = -10*H
  const kF = Math.min(mapAreaK, 1),
    kI = Math.max(0, mapAreaK - 1);
  floorMat.uniforms.uFrostZ.value =
    -0.5 * FROST_DIST * H + (kF - 0.5) * 2.0 * H;
  floorMat.uniforms.uIgnisZ.value =
    // the border between The Veiled Frost and Ignis Mourne
    -1.5 * FROST_DIST * H + (kI - 0.5) * 2.0 * H;
  floorMat.uniforms.uFrostSpan.value = 4.2 * H;
}
function syncRockMeshes() {
  const onSeat = !!(current && current.getClip().name === SEAT_CLIP),
    A = mapArea,
    sp = forest && !dungeon;
  if (greenRockMesh) greenRockMesh.visible = onSeat && A === "greenfield";
  if (frostRockMesh) frostRockMesh.visible = onSeat && A === "frost";
  if (ignisRockMesh) ignisRockMesh.visible = onSeat && A === "ignis";
  if (spareGreenRock) spareGreenRock.visible = sp && A !== "greenfield";
  if (spareFrostRock) spareFrostRock.visible = sp && A !== "frost";
  if (spareIgnisRock) spareIgnisRock.visible = sp && A !== "ignis";
}
function moveKnightToArea(area) {
  if (!playerRig || exploring || dungeon) return;
  const zOff = areaZOffset(area),
    dx = target.x - (homeTarget.x + playerRig.position.x),
    dz = target.z - (homeTarget.z + playerRig.position.z);
  playerRig.position.set(0, 0, zOff);
  if (blobMesh && blobHome)
    blobMesh.position.set(blobHome.x, blobHome.y, blobHome.z + zOff);
  if (floorMesh)
    floorMesh.position.set(
      0,
      floorMesh.position.y,
      -FROST_DIST * (playerH || 2.2),
    );
  target.set(homeTarget.x + dx, target.y, homeTarget.z + zOff + dz);
  syncRockMeshes();
}
function setWorld(f) {
  forest = f;
  // (the time-of-day look is redone next frame with the new world's day colours)
  todApplied = null;
  if (floorMat) {
    floorMat.uniforms.map.value = f ? floorTexForest : floorTexClassic;
    syncFrostBlend();
  }
  treeGroup = areaTrees(mapArea);
  if (ignisTreeGroup) ignisTreeGroup.visible = f && !dungeon;
  if (greenTreeGroup) greenTreeGroup.visible = f && !dungeon;
  if (hillGroup) hillGroup.visible = f && !dungeon;
  if (mountainGroup) mountainGroup.visible = f && !dungeon;
  if (frostTreeGroup) frostTreeGroup.visible = f && !dungeon;
  if (skyGroup) skyGroup.visible = !f && !night;
  setSwitch("world", f, f ? "Forest" : "Classic");
}
document.getElementById("world").onclick = () => setWorld(!forest);
/* ---------- night: a dark blue sky and fog, every surface dimmed and tinted, stars and a moon ----------
 It is on all the time; OPTIONS > TIME switches it to day. NIGHT_TINT is what every surface is multiplied by, NIGHT_FOG the fog near / far in knight-heights (closer than by day,
 so the dark closes in). setNight only changes the look - where the camera sits is startCam() (the start screen) and menuCam() (the main menu). */
const SKY_NIGHT = 0x0a0f2a,
  NIGHT_TINT = [0.45, 0.52, 0.82],
  NIGHT_FOG = [1.9, 4.2],
  NIGHT_STARS = 240;
const START_CAM_YAW = Math.PI + 0.55,
  START_CAM_PITCH = -0.52,
  START_CAM_ZOOM = 0.28,
  START_TARGET_Y = 0.38;
let nightGroup = null,
  nightStars = null,
  nightMoon = null,
  nightFogDay = null;
function startCam() {
  const zOff = areaZOffset();
  yaw = START_CAM_YAW;
  pitch = START_CAM_PITCH;
  zoom = START_CAM_ZOOM;
  target.set(
    homeTarget.x,
    homeTarget.y + playerH * START_TARGET_Y,
    homeTarget.z + zOff,
  );
// low and close, looking up at him
}
function menuCam() {
  const zOff = areaZOffset();
  yaw = Math.PI + 0.65;
  pitch = 0.1;
  zoom = 0.82;
  target.set(homeTarget.x, homeTarget.y, homeTarget.z + zOff);
// the usual menu view
}
// OPTIONS > WORLD > FOG: 1 (thin) .. 9 (thick); 5 = the normal fog
let fogT = 5;
const fogRec = { base: null, set: null };
function applyFogThickness() {
  if (mapMode || dungeon || shopT >= 0 || fogBak) return;
  const n = U.uFogNear.value,
    f = U.uFogFar.value;
  if (
    !fogRec.base ||
    !fogRec.set ||
    n !== fogRec.set[0] ||
    f !== fogRec.set[1]
  )
    fogRec.base = [n, f];
  const s = Math.pow(1.3, 5 - fogT),
    nn = fogRec.base[0] * s,
    ff = fogRec.base[1] * s;
  U.uFogNear.value = nn;
  U.uFogFar.value = ff;
  fogRec.set = [nn, ff];
}
/* ---------- time of day: OPTIONS > WORLD > TIME = AUTO (your computer's clock) or a slider over the 24 hours ----------
 Everything hangs off one number, the sun's elevation `e` in degrees (AUTO: from the local clock and the time of year; the others: fixed). From it come the darkness d (0 day .. 1 night) and the
 twilight warmth w (peaks as the sun touches the horizon). The look eases towards its target, so changing the setting (or the clock moving on) is always a slow blend, never a jump.
 The sky is a banded gradient dome (chunky steps, like the rest) whose horizon is always the fog colour, with a low sun, a warm glow, and stars / moon that fade in as it darkens. */
const TOD = {
  duskGlow: 0xff8a4a,
  dawnGlow: 0xff9fb0,
  duskPlum: 0x6a3f86,
  dawnPlum: 0x7c6a9e,
  duskTop: 0x3a4aa0,
  dawnTop: 0x5a6cb4,
  nightTop: 0x040716,
  deepTop: 0x141a52,
  warm: [1.0, 0.88, 0.7],
  ease: 2.2,
  bands: 12,
};
let todHour = null,
  todHold = null,
  lookSnap = true,
  todDome = null,
  todD = 1,
  // todHold 'day': the inventory / editor force daylight
  todApplied = null;
const todL = { e: -45, azi: 0, dp: 0 },
  todT = { e: -45, azi: 0, dp: 0 };
const _tdG = new THREE.Color(),
  _tdP = new THREE.Color(),
  _tdH = new THREE.Color(),
  _tdT = new THREE.Color(),
  _tdW = new THREE.Color(),
  _tdC = new THREE.Color(),
  _todBase = { hor: new THREE.Color(), top: new THREE.Color() };
const sstep = (a, b, x) => {
  x = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
function setTimeMode(m) {
  // 'random' (the default) = a random starting time that then rotates, 'auto' = the local clock, or an hour 0..23
  todRandom = m === "random";
  todHour = m === "auto" || m === "random" ? null : m;
  if (todRandom) todPick();
}
/* RANDOM: every launch (and every time RANDOM is picked in the menu) starts at a random moment from one of three kinds of time,
   chosen with equal odds: pure day, pure night, or dawn / dusk. From there the clock runs by itself, one full day / night cycle every TOD_CYCLE seconds. */
const TOD_CYCLE = 20 * 60;
let todRandom = true,
  todRStart = 12,
  todRT0 = performance.now();
function todPick() {
  const kind = Math.floor(Math.random() * 3),
    o = {},
    ok = [];
  for (let h = 0; h < 24; h += 0.25) {
    const e = clockSun(o, h).e;
    if (kind === 0 ? e >= 30 : kind === 1 ? e <= -30 : e > -9 && e < 0) ok.push(h);
  }
  todRStart = ok.length ? ok[Math.floor(Math.random() * ok.length)] : 12;
  todRT0 = performance.now();
}
function randomHour() {
  return (todRStart + (((performance.now() - todRT0) / 1000) * 24) / TOD_CYCLE) % 24;
}
function curHour() {
  // the hour the sky is showing right now (null never happens: AUTO reads the clock)
  return todRandom ? randomHour() : todHour === null ? clockHour() : todHour;
}
function clockHour() {
  const t = new Date();
  return t.getHours() + t.getMinutes() / 60 + t.getSeconds() / 3600;
}
function todSlide(d) {
  // OPTIONS > WORLD > TIME slider: RANDOM, AUTO, then 12 AM .. 11 PM (a ring); LEFT / RIGHT step it,
  // a click goes RANDOM > AUTO > the hour showing now > RANDOM
  const cur = todRandom ? -2 : todHour === null ? -1 : todHour;
  let n;
  if (!d) n = cur === -2 ? -1 : cur === -1 ? Math.floor(clockHour()) : -2;
  else {
    n = cur + d;
    if (n > 23) n = -2;
    if (n < -2) n = 23;
  }
  setTimeMode(n === -2 ? "random" : n === -1 ? "auto" : n);
}
function todText() {
  if (todRandom) return "RANDOM";
  if (todHour === null) return "AUTO";
  const n = Math.floor(todHour / 2),
    h = todHour % 12 || 12;
  return (
    "#".repeat(n) +
    ".".repeat(12 - n) +
    " " +
    h +
    (todHour < 12 ? " AM" : " PM")
  );
}
function clockSun(o, hr) {
  // sun elevation / bearing from the local clock: noon at 12:30, day length swinging with the season
  const t = new Date(),
    h =
      hr === undefined || hr === null
        ? t.getHours() + t.getMinutes() / 60 + t.getSeconds() / 3600
        : hr,
    doy = Math.floor((t - new Date(t.getFullYear(), 0, 0)) / 864e5);
  const L = 6 + 1.25 * Math.sin((2 * Math.PI * (doy - 80)) / 365),
    alt =
      Math.cos((2 * Math.PI * (h - 12.5)) / 24) -
      Math.cos((Math.PI * L) / 12);
  o.e = alt * 65;
  o.azi = Math.max(-1.3, Math.min(1.3, (h - 12.5) / L)) * 100;
  o.dp = h < 12.5 ? 1 : 0;
  return o;
}
function todTarget() {
  const o = todT;
  if (todHold === "day") {
    o.e = 48;
    o.azi = -20;
    o.dp = 0;
  } else clockSun(o, todRandom ? randomHour() : todHour);
}
function applyLook() {
  const e = todL.e,
    d = 1 - sstep(-10, 6, e),
    w = Math.exp(-Math.pow((e + 2) / 8, 2)),
    dp = todL.dp,
    dayHor = forest ? SKY_FOREST : SKY_CLASSIC;
  night = d > 0.5;
  todD = d;
  // the glow
  _tdG.setHex(TOD.duskGlow).lerp(_tdC.setHex(TOD.dawnGlow), dp);
  // the colour the horizon deepens to as the light goes
  _tdP.setHex(TOD.duskPlum).lerp(_tdC.setHex(TOD.dawnPlum), dp);
  // horizon = fog
  _tdH.setHex(dayHor).lerp(_tdC.setHex(SKY_NIGHT), d);
  _tdW
    .copy(_tdG)
    .multiplyScalar(0.9)
    .lerp(_tdP, Math.min(1, d * 1.15));
  _tdH.lerp(_tdW, w * 0.85);
  // zenith: a deeper daylight blue, same recipe for every world
  _tdT.setHex(dayHor).lerp(_tdC.setHex(0x2c5cc0), 0.6);
  _tdT.lerp(_tdC.setHex(TOD.nightTop), d);
  _tdW
    .setHex(TOD.duskTop)
    .lerp(_tdC.setHex(TOD.dawnTop), dp)
    .lerp(_tdC.setHex(TOD.deepTop), d * 0.8);
  _tdT.lerp(_tdW, w * 0.8);
  _todBase.hor.copy(_tdH);
  _todBase.top.copy(_tdT);
  setSkyFog(_tdH.getHex());
  document.documentElement.style.setProperty(
    "--sky",
    "#" + _tdH.getHex().toString(16).padStart(6, "0"),
  );
  const k = 1 - w * 0.9,
    tr = NIGHT_TINT[0] + (1 - NIGHT_TINT[0]) * (1 - d),
    tgc = NIGHT_TINT[1] + (1 - NIGHT_TINT[1]) * (1 - d),
    tb = NIGHT_TINT[2] + (1 - NIGHT_TINT[2]) * (1 - d);
  U.uNight.value.set(
    tr * (1 - w * 0.9 + TOD.warm[0] * w * 0.9),
    tgc * (k + TOD.warm[1] * w * 0.9),
    tb * (k + TOD.warm[2] * w * 0.9),
  );
  if (!nightFogDay) nightFogDay = [U.uFogNear.value, U.uFogFar.value];
  U.uFogNear.value =
    nightFogDay[0] + (playerH * NIGHT_FOG[0] - nightFogDay[0]) * d;
  U.uFogFar.value =
    nightFogDay[1] + (playerH * NIGHT_FOG[1] - nightFogDay[1]) * d;
  // stars and moon fade in as soon as the sun touches the horizon and are full strength by the time it is ~2 degrees under it,
  // so a sky that is not daylight is never empty
  const sa = sstep(0.0, 0.5, d);
  if (nightGroup) {
    nightGroup.visible = d > 0.02;
    nightStars.material.opacity = sa;
    nightMoon.children[0].material.opacity = 0.16 * sa;
    nightMoon.children[1].material.opacity = sa;
  }
  if (comet && d < 0.6) {
    comet.visible = false;
    cometAge = -1;
  }
  if (skyGroup) skyGroup.visible = !forest && d < 0.5;
  if (todDome) {
    const u = todDome.material.uniforms,
      el = (e * Math.PI) / 180,
      az = (todL.azi * Math.PI) / 180;
    u.uSunDir.value.set(
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      -Math.cos(az) * Math.cos(el),
    );
    u.uGlow.value.copy(_tdG);
    u.uGlowAmt.value = w;
    u.uSunA.value = sstep(-7, -2, e);
    u.uSunCol.value
      .setRGB(1, 0.96, 0.82)
      .lerp(_tdC.setHex(0xffa060), Math.min(1, w * 1.3));
  }
  todApplied = { e: e, azi: todL.azi, dp: dp, forest: forest };
}
function updateTime(dt) {
  if (!todDome) return;
  todTarget();
  if (lookSnap || !todApplied) {
    todL.e = todT.e;
    todL.azi = todT.azi;
    todL.dp = todT.dp;
  } else {
    const f = 1 - Math.exp(-dt * TOD.ease);
    todL.e += (todT.e - todL.e) * f;
    todL.azi += (todT.azi - todL.azi) * f;
    todL.dp += (todT.dp - todL.dp) * f;
  }
  // the map / dungeon / shop have their own fog: leave it alone, catch up afterwards
  const guard = mapMode || dungeon || shopT >= 0 || fogBak;
  if (
    !guard &&
    (lookSnap ||
      !todApplied ||
      todApplied.forest !== forest ||
      Math.abs(todL.e - todApplied.e) > 0.02 ||
      Math.abs(todL.azi - todApplied.azi) > 0.2 ||
      Math.abs(todL.dp - todApplied.dp) > 0.01)
  ) {
    applyLook();
    lookSnap = false;
  }
  const u = todDome.material.uniforms,
    // the horizon is always exactly the fog colour (areas, dungeon ...); the zenith follows it
    fc = U.uFogColor.value;
  u.uHor.value.copy(fc);
  u.uTop.value.set(
    Math.min(1, Math.max(0, _todBase.top.r + (fc.r - _todBase.hor.r) * 0.75)),
    Math.min(1, Math.max(0, _todBase.top.g + (fc.g - _todBase.hor.g) * 0.75)),
    Math.min(1, Math.max(0, _todBase.top.b + (fc.b - _todBase.hor.b) * 0.75)),
  );
}
function initSkyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x101528) },
      uHor: { value: new THREE.Color(SKY) },
      uGlow: { value: new THREE.Color(TOD.duskGlow) },
      uSunCol: { value: new THREE.Color(1, 0.96, 0.82) },
      uSunDir: { value: new THREE.Vector3(0, -1, 0) },
      uGlowAmt: { value: 0 },
      uSunA: { value: 0 },
      uBands: { value: TOD.bands },
    },
    vertexShader:
      "varying vec3 vD; void main(){ vD=position; gl_Position=projectionMatrix*vec4(mat3(viewMatrix)*position,1.0); }",
    fragmentShader: `uniform vec3 uTop,uHor,uGlow,uSunCol,uSunDir; uniform float uGlowAmt,uSunA,uBands; varying vec3 vD;
void main(){
  vec3 d=normalize(vD); float e=d.y;
  float t=floor(pow(clamp(e,0.0,1.0),0.55)*uBands+0.5)/uBands;                       // banded gradient, horizon -> zenith
  vec3 c=mix(uHor,uTop,t);
  float sd=max(dot(d,uSunDir),0.0), up=clamp(e,0.0,1.0);
  float g=(pow(sd,3.0)*0.55+pow(sd,24.0)*0.45)*uGlowAmt*(1.0-0.55*up)+exp(-abs(e)*5.0)*uGlowAmt*0.35;   // glow round the sun + a low band all round the horizon
  c=mix(c,uGlow,floor(clamp(g,0.0,1.0)*8.0+0.5)/8.0*0.85);
  float hz=smoothstep(-0.03,0.012,e);                                                   // the sun sets into the horizon
  c=mix(c,uSunCol,max(step(0.99955,sd),step(0.9975,sd)*0.4)*hz*uSunA);                  // chunky disc + halo
  gl_FragColor=vec4(c,1.0);
}`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat);
  m.renderOrder = -1000;
  m.frustumCulled = false;
  scene.add(m);
  todDome = m;
}
/* ---------- the start screen's sky marks: where the moon and the comet go ----------
 SKY_REF is the window size the marks were drawn on (a screenshot of the start screen), SKY_MOON_PX the middle of the red circle (the moon), COMET.from / COMET.to the two ends of the white
 arrow (the comet's path). startSkyRay turns a pixel of that screenshot into a ray through the start camera (the camera's own numbers, plus the picture being shifted right
 for the menu), and skyHit finds where the ray meets a sphere around the sky's centre. */
const SKY_REF = { w: 1536, h: 749 },
  SKY_MOON_PX = [1377, 186];
function startSkyRay(px, py) {
  const H = playerH,
    T = new THREE.Vector3(
      homeTarget.x,
      homeTarget.y + H * START_TARGET_Y,
      homeTarget.z,
    );
  const fit =
      (H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) * 1.5,
    d = fit * START_CAM_ZOOM,
    cp = Math.cos(START_CAM_PITCH);
  const C = new THREE.Vector3(
    T.x + d * Math.sin(START_CAM_YAW) * cp,
    T.y + d * Math.sin(START_CAM_PITCH),
    T.z + d * Math.cos(START_CAM_YAW) * cp,
  );
  const f = T.clone().sub(C).normalize(),
    right = new THREE.Vector3()
      .crossVectors(f, new THREE.Vector3(0, 1, 0))
      .normalize(),
    up = new THREE.Vector3().crossVectors(right, f);
  const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
    asp = SKY_REF.w / SKY_REF.h;
  const nx = ((px - 0.2 * SKY_REF.w) / SKY_REF.w) * 2 - 1,
    // the start picture sits 0.2 of the width to the right of centre (see applyView)
    ny = 1 - (2 * py) / SKY_REF.h;
  return {
    C: C,
    dir: f
      .add(right.multiplyScalar(nx * tv * asp))
      .add(up.multiplyScalar(ny * tv))
      .normalize(),
  };
}
function skyHit(o, dir, r) {
  // o = ray origin relative to the sky's centre; the point where it leaves a sphere of radius r around that centre
  const b = dir.dot(o),
    c = o.lengthSq() - r * r,
    s = -b + Math.sqrt(Math.max(0, b * b - c));
  return o.clone().add(dir.clone().multiplyScalar(s));
}
/* ---------- the comet ----------
 It crosses the sky along the white arrow (from -> to, pixels of the SKY_REF window), then is gone. It comes at random: `perMinute` is the average, the gap between two comets is
 anywhere from half to one and a half times 60/perMinute seconds (so 4 a minute means one every 7.5 - 22.5 s, 15 s on average), and the first one turns up after 4 - 10 s.
 new_comet.gif is a comet whose tail burns away frame by frame while its head stays put, so the flight (which fades smoothly in at the start and out at the end, COMET.fadeIn / fadeOut) plays frame 1 (full tail) for `hold` seconds and then runs the other
 frames at the gif's own 170 ms, arriving at the end of the arrow just as only the head is left, which then disappears. The sprite turns to follow the path on screen, so the tail
 always trails behind it, whichever way you are looking. It only exists while the night sky does. */
const COMET = {
  perMinute: 4,
  from: [770, 47],
  to: [468, 182],
  hold: 0.78,
  frameMs: 170,
  frames: 7,
  sizeDeg: 6.5,
  fadeIn: 0.45,
  fadeOut: 0.55,
  head: [3.5, 28.5],
  headDeg: -136.5,
  png: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAOAAAAAgCAYAAAALxXRVAAAB1klEQVR42u2ZsUoDQRRF3wRBTBob/8P9CK0tBJEtFCEIdn6JnSBpbJY0Ftb6EfE/bGwSsXEtZMO6TIKIeXfYOecHzmb33bkzEzMAAAAAAACADTF5ea15CwCED4DwAUDPw0f4gfARPgDCB0D4CB/A5gY/9/ARfiB8hA9yDJ9yAAkfED6aF+DXhP8cuvH+XlANvbe7+wwqP2TeeotZJWmftl/5DpR+MzO1HwQNmFLzqdpH3Xw0bz8Y/OXDl/WTNHxKfwqt0/hV4aN1BQ0Y22bm1nw077ef1nVuwOajq5qnOe/l3Lzt8ybNlxHdyxbvCxe1vz38yr9ZlP6Utt19Yyv15kvNr9huqvyx5geHM2Dsw1fh0C0Aq/ze4cvZ326dYVHKznyLWVUr/e4NGFvxvMMX83sN39IvHP7FrKpNHL6ULl76fPETCN/6s0Zu/u4zKNpH7ZcE8OTsot4dfZqZ2c34wD18q/xew4c/Lf+wKINn87X9d7f3bqEfmJkdHZ/+WHWvJ8+ulx7r/B6k6vcavph/WJRB6Vf+/sur89o1gA1v84F065OS33MAV/m9t0Ntv4Ic/ctLmI/5u22PdpYP4T18qfm9wZ+nP8Rq+PFh6r764sefsx8ABHwB0QhLivJbZsEAAAAASUVORK5CYII=",
// head = the head's pixel in each 32x32 frame; headDeg = the way the head travels inside the gif (y up)
};
let comet = null,
  cometAge = -1,
  cometWait = 4 + Math.random() * 6,
  cometA = null,
  cometB = null,
  cometO = null,
  cometR = 0;
const _cp1 = new THREE.Vector3(),
  _cp2 = new THREE.Vector3(),
  _cd = new THREE.Vector3();
function cometAt(t, out) {
  _cd.copy(cometA).lerp(cometB, t).normalize();
  return out.copy(skyHit(cometO, _cd, cometR));
// straight on the start screen: the ray is blended between the two ends
}
function initComet(H, groundY, grp, R) {
  const A = startSkyRay(COMET.from[0], COMET.from[1]),
    B = startSkyRay(COMET.to[0], COMET.to[1]);
  cometR = R * 0.88;
  cometA = A.dir.clone();
  cometB = B.dir.clone();
  cometO = A.C.clone().sub(
    new THREE.Vector3(homeTarget.x, groundY, homeTarget.z),
  );
  loadImg(COMET.png)
    .then((img) => {
      const t = new THREE.Texture(img);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.repeat.set(1 / COMET.frames, 1);
      t.needsUpdate = true;
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: t,
          transparent: true,
          alphaTest: 0.05,
          opacity: 0,
          depthWrite: false,
          fog: false,
        }),
      );
      const size =
        2 * cometR * Math.tan(THREE.MathUtils.degToRad(COMET.sizeDeg / 2));
      sp.scale.set(size, size, 1);
      // placed and turned about the comet's head, not the middle of the picture
      sp.center.set(COMET.head[0] / 32, 1 - COMET.head[1] / 32);
      sp.visible = false;
      sp.renderOrder = 4;
      sp.frustumCulled = false;
      grp.add(sp);
      comet = sp;
    })
    .catch((e) => console.error("comet failed", e));
}
function updateComet(dt) {
  if (!comet) return;
  if (cometAge < 0) {
    cometWait -= dt;
    if (cometWait > 0) return;
    cometAge = 0;
    comet.visible = true;
  }
  cometAge += dt;
  const age = ps1 ? Math.floor(cometAge * 15) / 15 : cometAge,
    // steps at 15 fps in the PS1 look, like the rest
    total = COMET.hold + ((COMET.frames - 1) * COMET.frameMs) / 1000;
  if (age >= total) {
    comet.visible = false;
    cometAge = -1;
    const mean = 60 / COMET.perMinute;
    cometWait = mean * (0.5 + Math.random());
    return;
  }
  const t = age / total,
    fr =
      age < COMET.hold
        ? 0
        : Math.min(
            COMET.frames - 1,
            1 + Math.floor((age - COMET.hold) / (COMET.frameMs / 1000)),
          );
  cometAt(t, comet.position);
  comet.material.map.offset.x = fr / COMET.frames;
  const fi = Math.min(1, cometAge / COMET.fadeIn),
    // the fade runs on real time (not the 15 fps steps) so it is smooth: in over `fadeIn` seconds, out over the last `fadeOut`
    fo = Math.min(1, Math.max(0, (total - cometAge) / COMET.fadeOut));
  comet.material.opacity = fi * fi * (3 - 2 * fi) * fo * fo * (3 - 2 * fo);
  // turn it to follow its path as seen from the camera right now
  cometAt(Math.min(1, t + 0.03), _cp2);
  _cp1.copy(comet.position).add(nightGroup.position).project(camera);
  _cp2.add(nightGroup.position).project(camera);
  comet.material.rotation =
    Math.atan2(_cp2.y - _cp1.y, (_cp2.x - _cp1.x) * camera.aspect) -
    THREE.MathUtils.degToRad(COMET.headDeg);
}
function initNight(H, groundY) {
  const grp = new THREE.Group(),
    R = Math.min(H * 50, 150);
  let sd = 909;
  const rnd = () => {
    sd = (sd + 0x6d2b79f5) | 0;
    let t = Math.imul(sd ^ (sd >>> 15), 1 | sd);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  // fixed seed: the same sky every time
  };
  const pos = new Float32Array(NIGHT_STARS * 3),
    col = new Float32Array(NIGHT_STARS * 3);
  for (let i = 0; i < NIGHT_STARS; i++) {
    const az = rnd() * Math.PI * 2,
      el = ((5 + Math.pow(rnd(), 0.8) * 78) * Math.PI) / 180,
      b = 0.45 + rnd() * 0.55;
    pos[i * 3] = Math.cos(az) * Math.cos(el) * R;
    pos[i * 3 + 1] = Math.sin(el) * R;
    pos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * R;
    col[i * 3] = b * 0.9;
    col[i * 3 + 1] = b * 0.95;
    col[i * 3 + 2] = b;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  sg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  nightStars = new THREE.Points(
    sg,
    new THREE.PointsMaterial({
      size: 1.7,
      sizeAttenuation: false,
      vertexColors: true,
      fog: false,
      depthWrite: false,
      transparent: true,
    }),
  );
  nightStars.frustumCulled = false;
  grp.add(nightStars);
  /* the moon: up in the sky exactly where the red circle was drawn on the start screen (SKY_MOON_PX, in pixels of a SKY_REF-sized window), with a soft halo.
   The spot is found by sending a ray through that pixel of the start camera and putting the moon where the ray meets the sky dome, so it sits in the same place relative to
   him on any screen size that has the same shape; on a very different shape it shifts, like anything that really is in the sky. */
  const MR = R * 0.9,
    moonRay = startSkyRay(SKY_MOON_PX[0], SKY_MOON_PX[1]),
    G = new THREE.Vector3(homeTarget.x, groundY, homeTarget.z);
  const moon = new THREE.Group();
  moon.position.copy(skyHit(moonRay.C.clone().sub(G), moonRay.dir, MR));
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(H * 5.5, 20),
    new THREE.MeshBasicMaterial({
      color: 0x7f93d9,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      fog: false,
    }),
  );
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(H * 3.2, 18),
    new THREE.MeshBasicMaterial({
      color: 0xe6ecff,
      fog: false,
      transparent: true,
    }),
  );
  halo.position.z = -0.05;
  moon.add(halo);
  moon.add(disc);
  moon.frustumCulled = false;
  grp.add(moon);
  nightMoon = moon;
  initComet(H, groundY, grp, R);
  grp.visible = false;
  scene.add(grp);
  nightGroup = grp;
  initSkyDome();
}
function updateNight(dt) {
  updateTime(dt);
  if (!nightGroup || !nightGroup.visible) return;
  // rides along with the camera, so the sky never gets closer
  nightGroup.position.set(target.x, groundYNight, target.z);
  // the stars turn very slowly
  nightStars.rotation.y += dt * 0.006;
  nightMoon.lookAt(camera.position);
  if (todD > 0.6) updateComet(dt);
}
let groundYNight = 0;

function buildTreeGroup(TD, H, groundY, vis) {
  return Promise.all(TD.map((p) => loadImg(p.tex))).then((imgs) => {
    const protos = TD.map((p, k) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(p.p, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(p.n, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(p.uv, 2));
      geo.setIndex(p.i);
      const tex = new THREE.Texture(imgs[k]);
      tex.flipY = false;
      return { name: p.name, t: p.t, geo, mat: ps1Mat(tex, 1) };
    });
    const grp = new THREE.Group();
    grp.visible = vis;
    // [angle deg, distance in knight-heights, scale, yaw deg]; they sit in the fog band so distance fades them out
    [
      [20, 2.6, 1.0, 10],
      [75, 3.1, 1.15, 80],
      [130, 2.4, 0.9, 200],
      [185, 3.4, 1.1, 35],
      [240, 2.8, 1.0, 120],
      [300, 3.3, 0.95, 300],
      [340, 2.5, 1.2, 160],
    ].forEach(([a, r, s, yw]) => {
      const tr = new THREE.Group(),
        ar = (a * Math.PI) / 180;
      tr.position.set(Math.cos(ar) * r * H, groundY, Math.sin(ar) * r * H);
      tr.scale.setScalar(s);
      tr.rotation.y = (yw * Math.PI) / 180;
      protos.forEach((pr) => {
        const m = new THREE.Mesh(pr.geo, pr.mat);
        m.position.set(pr.t[0], pr.t[1], pr.t[2]);
        tr.add(m);
      });
      grp.add(tr);
    });
    /* extra forest for walking around: scattered with a fixed seed so it is the same every visit */
    let sd = 12345;
    const rnd = () => {
      sd = (sd + 0x6d2b79f5) | 0;
      let t = Math.imul(sd ^ (sd >>> 15), 1 | sd);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let n = 0; n < 90; n++) {
      const ar = rnd() * Math.PI * 2,
        r = Math.sqrt(1.9 * 1.9 + rnd() * (11.5 * 11.5 - 1.9 * 1.9)),
        sc = 0.85 + rnd() * 0.45,
        tr = new THREE.Group();
      tr.position.set(Math.cos(ar) * r * H, groundY, Math.sin(ar) * r * H);
      tr.scale.setScalar(sc);
      tr.rotation.y = rnd() * Math.PI * 2;
      protos.forEach((pr) => {
        const m = new THREE.Mesh(pr.geo, pr.mat);
        m.position.set(pr.t[0], pr.t[1], pr.t[2]);
        tr.add(m);
      });
      grp.add(tr);
    }
    occMark(grp);
    scene.add(grp);
    // trees dither away when they are in front of someone
    return grp;
  });
}
/* ---------- barrier: hills (Greenfield) and mountains (Veiled Frost) overlapping in a near-vertical line down each side of the area, past the trees ----------
 BARRIER = line distance from the middle (knight-heights), sideways wobble, size range (knight-heights wide), z reach. Neighbours overlap by about 40%, so there is no gap. */
const BARRIER = {
  hill: { x: 14.4, wob: 0.6, w: [4, 7], reach: 14.5 },
  mountain: { x: 14.4, wob: 0.6, w: [5, 8.5], reach: 14.5 },
};
let hillGroup = null,
  mountainGroup = null;
const barrierColliders = [];
function buildBarrier(id, cfg, H, groundY, vis, zOff) {
  const el = document.getElementById(id);
  if (!el) return Promise.resolve(null);
  const BD = JSON.parse(el.textContent).parts;
  return Promise.all(BD.map((p) => loadImg(p.tex)))
    .then((imgs) => {
      const protos = BD.map((p, k) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(p.p, 3),
        );
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(p.n, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(p.uv, 2));
        geo.setIndex(p.i);
        const tex = new THREE.Texture(imgs[k]);
        tex.flipY = false;
        tex.needsUpdate = true;
        geo.computeBoundingBox();
        return { geo, mat: ps1Mat(tex, 1) };
      });
      const bb = new THREE.Box3();
      protos.forEach((pr) => bb.union(pr.geo.boundingBox));
      const w0 = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z),
        cx = (bb.max.x + bb.min.x) / 2,
        cz = (bb.max.z + bb.min.z) / 2;
      const grp = new THREE.Group();
      grp.visible = vis;
      grp.position.z = zOff;
      const cols = [];
      let sd = 777;
      const rnd = () => {
        sd = (sd + 0x6d2b79f5) | 0;
        let t = Math.imul(sd ^ (sd >>> 15), 1 | sd);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      for (const side of [-1, 1]) {
        let z = -cfg.reach;
        while (z <= cfg.reach) {
          const wd = (cfg.w[0] + rnd() * (cfg.w[1] - cfg.w[0])) * H,
            s = wd / w0,
            tr = new THREE.Group();
          tr.position.set(
            side * (cfg.x + (rnd() - 0.5) * 2 * cfg.wob) * H,
            groundY - bb.min.y * s - 0.06 * H,
            z * H,
          );
          tr.scale.setScalar(s);
          tr.rotation.y = rnd() * Math.PI * 2;
          protos.forEach((pr) => {
            const m = new THREE.Mesh(pr.geo, pr.mat);
            m.position.set(-cx, 0, -cz);
            tr.add(m);
          });
          grp.add(tr);
          cols.push({
            x: tr.position.x,
            z: tr.position.z + zOff,
            r: 0.4 * wd,
          });
          z += (wd / H) * 0.6;
        }
      }
      barrierColliders.push(...cols);
      colliders = (colliders || []).concat(cols);
      scene.add(grp);
      return grp;
    })
    .catch((e) => {
      console.error("barrier failed", id, e);
      return null;
    });
}
function initTrees(H, groundY) {
  const TD = JSON.parse(
    document.getElementById("tree-data").textContent,
  ).parts;
  buildTreeGroup(TD, H, groundY, forest)
    .then((grp) => {
      greenTreeGroup = grp;
      clearTreesForMapProps();
      if (mapArea === "greenfield") treeGroup = grp;
      colliders = grp.children
        .map((t) => ({
          x: t.position.x,
          z: t.position.z,
          r: TREE_R * H * t.scale.x,
        }))
        .concat(barrierColliders);
    })
    .catch((e) => console.error("tree load failed", e));
  buildBarrier("hill-data", BARRIER.hill, H, groundY, forest, 0).then((g) => {
    if (g) hillGroup = g;
  });
  buildBarrier(
    "mountain-data",
    BARRIER.mountain,
    H,
    groundY,
    forest,
    -FROST_DIST * H,
  ).then((g) => {
    if (g) mountainGroup = g;
  });
  const sEl = document.getElementById("snow-tree-data");
  if (sEl) {
    const STD = JSON.parse(sEl.textContent).parts;
    buildTreeGroup(STD, H, groundY, forest)
      .then((grp) => {
        grp.position.z = -FROST_DIST * H;
        frostTreeGroup = grp;
        if (mapArea === "frost") treeGroup = grp;
      })
      .catch((e) => console.error("snow tree load failed", e));
  }
  const iEl = document.getElementById("ignis-tree-data");
  if (iEl) {
    buildTreeGroup(JSON.parse(iEl.textContent).parts, H, groundY, forest)
      .then((grp) => {
        grp.position.z = -IGNIS_DIST * H;
        ignisTreeGroup = grp;
        if (mapArea === "ignis") treeGroup = grp;
        grp.traverse((o) => {
          if (o.isMesh && o.material && o.material.uniforms)
            o.material.uniforms.uMagma.value = 1;
        // the magma on these trees glows (see uMagma in the shader)
        });
      })
      .catch((e) => console.error("ignis tree load failed", e));
  }
}

/* ---------- falling leaves: leaf_falling.gif (14 frames, 140 ms each, cropped to a strip) drifting down from nearby trees ---------- */
const LEAF_FRAMES = 14,
  LEAF_MS = 140,
  LEAF_ASPECT = 8 / 17;
const LEAF_MAX = 12,
  LEAF_REACH = 3.8,
  // max leaves at once, how far from the player a tree can drop one (knight-heights), leaf width (knight-heights)
  LEAF_W = 0.08;
const LEAF_FALL = 0.22,
  LEAF_EVERY_MIN = 0.5,
  // fall speed (knight-heights/sec), seconds between new leaves
  LEAF_EVERY_MAX = 1.9;
const LEAF_ATLAS =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAO4AAAAICAYAAAD+88O9AAABY0lEQVR4nO2XMWrDQBREZ1U4BCGXgVxCW+kkuYC3N2p1hrSO+j2BTpLKvkQgpYwRSvNTCIEwOFg7n1g2+w4wfObP/JXM5sOK3+4NIpHI3ZD47d642krVFHLrYSLLImZiuSQAkKWC768flD6nCuxqGxe9ADQKVzWFdG1/8zkeGaYvCQDs3MFk6aDRtT1KnwcJar3errYSj0AYGoUrfa5SWlZj6bA5ZfpiRLkepc/leDLIUsHz+gnvb5/B/8+utpKlgp07UBrAYFKoxn9QNYUwXo0aXdtTfgG87xpzaPhxDRr5YPwK7Usyf8y/mb7erPFZKjieTPAXADAsRONL4NJ1nat5SYN9nVxtVV44trRz52D9YPeikQ8mp6F9UX9xtZmawVzw88sGhB2WMSQvryuM4Zo71zRojM5Ua1w+Uzgg/OVh5tDwg90Lmw+tnF7L4ouriYa551eVPSYaOo8C44fGXu5pH7+IuTgVPUs17gAAAABJRU5ErkJggg==";
let leavesOn = true,
  leaves = null,
  leafGround = 0,
  leafWait = 1;
const leafBox = new THREE.Box3(),
  leafSize = new THREE.Vector3(),
  leafCtr = new THREE.Vector3();
function toggleLeaves() {
  leavesOn = !leavesOn;
}
function initLeaves(groundY) {
  leafGround = groundY;
  loadImg(LEAF_ATLAS)
    .then((img) => {
      leaves = [];
      for (let i = 0; i < LEAF_MAX; i++) {
        const tex = new THREE.Texture(img);
        tex.magFilter = tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.repeat.set(1 / LEAF_FRAMES, 1);
        tex.needsUpdate = true;
        const spr = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            fog: false,
          }),
        );
        spr.visible = false;
        spr.renderOrder = 6;
        scene.add(spr);
        leaves.push({ spr, tex, on: false, fi: -1, t: 0 });
      }
    })
    .catch((e) => console.error("leaf load failed", e));
}
function spawnLeaf(l) {
  if (!treeGroup || !playerRig) return false;
  const p = playerRig.position,
    R = LEAF_REACH * playerH;
  const near = treeGroup.children.filter(
    (t) => Math.hypot(t.position.x - p.x, t.position.z - p.z) < R,
  );
  if (!near.length) return false;
  const tr = near[Math.floor(Math.random() * near.length)];
  leafBox.setFromObject(tr);
  leafBox.getSize(leafSize);
  leafBox.getCenter(leafCtr);
  const top = leafBox.max.y - leafGround;
  l.x0 = leafCtr.x + (Math.random() - 0.5) * leafSize.x * 0.7;
  l.z0 = leafCtr.z + (Math.random() - 0.5) * leafSize.z * 0.7;
  l.y0 = leafGround + top * (0.5 + Math.random() * 0.45);
  l.vy = playerH * LEAF_FALL * (0.8 + Math.random() * 0.4);
  l.amp = playerH * (0.05 + Math.random() * 0.1);
  l.fq = 0.9 + Math.random() * 1.3;
  l.ph = Math.random() * 6.283;
  const a = Math.random() * 6.283,
    dr = playerH * (0.01 + Math.random() * 0.05);
  l.drx = Math.cos(a) * dr;
  l.drz = Math.sin(a) * dr;
  l.off = Math.floor(Math.random() * LEAF_FRAMES);
  l.sc = 0.9 + Math.random() * 0.35;
  l.flip = Math.random() < 0.5 ? -1 : 1;
  l.t = 0;
  l.fi = -1;
  l.on = true;
  l.spr.visible = true;
  l.spr.material.opacity = 0;
  const w = playerH * LEAF_W * l.sc;
  l.spr.scale.set(l.flip * w, w * LEAF_ASPECT, 1);
  return true;
}
function endLeaf(l) {
  l.on = false;
  l.spr.visible = false;
  l.spr.material.opacity = 0;
}

/* ---------- snow: falls over The Veiled Frost (OPTIONS > SNOW) ----------
 A few hundred square flakes in a box around the camera. They keep their place in the world as the camera moves (they wrap at the box edges), sway a little,
 snap to the same chunky grid as the leaves, and fade into the fog like everything else. SNOW: count; box = half-width of the box and top = its height, in knight-heights;
 fall = fall speed range (knight-heights per second); sway = side-to-side wobble; size = flake size (knight-heights). */
const SNOW = {
  count: 360,
  box: 5.5,
  top: 5.2,
  fallMin: 0.22,
  fallMax: 0.55,
  sway: 0.12,
  size: 0.05,
};
let snowOn = true,
  snow = null,
  snowT = 0;
function initSnow(H, groundY) {
  try {
    const N = SNOW.count,
      pos = new Float32Array(N * 3),
      col = new Float32Array(N * 3),
      data = [];
    for (let i = 0; i < N; i++)
      data.push({
        x: Math.random(),
        z: Math.random(),
        y: Math.random(),
        v: SNOW.fallMin + Math.random() * (SNOW.fallMax - SNOW.fallMin),
        fq: 0.6 + Math.random() * 1.2,
        ph: Math.random() * 6.283,
        amp: SNOW.sway * (0.4 + Math.random() * 0.8),
        dr: (Math.random() - 0.5) * 0.1,
      });
    const geo = new THREE.BufferGeometry(),
      pa = new THREE.BufferAttribute(pos, 3),
      ca = new THREE.BufferAttribute(col, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    ca.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", pa);
    geo.setAttribute("color", ca);
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: SNOW.size * H,
        sizeAttenuation: true,
        vertexColors: true,
        depthWrite: false,
        fog: false,
      }),
    );
    pts.frustumCulled = false;
    pts.visible = false;
    pts.name = "Snow";
    scene.add(pts);
    snow = { pts, pa, ca, pos, col, data, ground: groundY, N };
  } catch (e) {
    console.error("snow init failed", e);
  }
}
const _snV = new THREE.Vector3();
function updateSnow(dt) {
  if (!snow) return;
  const want =
    snowOn &&
    !dungeon &&
    (mapArea === "frost" || Math.abs(mapAreaK - 1) < 0.5);
  snow.pts.visible = want;
  if (!want) return;
  try {
    snowT += dt;
    const H = playerH,
      S = SNOW.box * H,
      T = SNOW.top * H,
      g = snow.ground,
      snap = H * 0.02,
      near = U.uFogNear.value,
      far = U.uFogFar.value,
      fc = U.uFogColor.value,
      nt = U.uNight.value;
    camera.getWorldDirection(_snV);
    let fx = _snV.x,
      fz = _snV.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl;
    fz /= fl;
    const cx = camera.position.x + fx * S * 0.45,
      cz = camera.position.z + fz * S * 0.45,
      // the box sits in front of the camera
      cp = camera.position;
    const pos = snow.pos,
      col = snow.col,
      W = 2 * S;
    for (let i = 0; i < snow.N; i++) {
      const d = snow.data[i];
      let x =
        cx +
        ((((d.x * W + d.dr * H * snowT - cx + S) % W) + W) % W) -
        S +
        Math.sin(snowT * d.fq + d.ph) * d.amp * H;
      let z =
        cz +
        ((((d.z * W + d.dr * 0.6 * H * snowT - cz + S) % W) + W) % W) -
        S +
        Math.cos(snowT * d.fq * 0.8 + d.ph) * d.amp * H * 0.7;
      let y = g + ((((d.y * T - d.v * H * snowT) % T) + T) % T);
      if (ps1) {
        x = Math.round(x / snap) * snap;
        z = Math.round(z / snap) * snap;
        y = Math.round(y / snap) * snap;
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      const dist = Math.hypot(x - cp.x, y - cp.y, z - cp.z);
      let f = Math.min(1, Math.max(0, (dist - near) / (far - near)));
      // into the fog, like the trees
      f = f * f * (3 - 2 * f);
      // and out of the way when one drifts right up to the lens
      f = Math.max(f, Math.min(1, Math.max(0, (0.9 * H - dist) / (0.5 * H))));
      col[i * 3] = nt.x + (fc.r - nt.x) * f;
      col[i * 3 + 1] = nt.y + (fc.g - nt.y) * f;
      // white (dimmed by the night tint) fading to the fog colour
      col[i * 3 + 2] = nt.z + (fc.b - nt.z) * f;
    }
    snow.pa.needsUpdate = true;
    snow.ca.needsUpdate = true;
  } catch (e) {
    if (!updateSnow.warned) {
      updateSnow.warned = true;
      console.error("snow", e);
    }
  }
}
function updateLeaves(dt) {
  if (!leaves) return;
  const show =
    leavesOn && mapArea === "greenfield" && treeGroup && treeGroup.visible;
  let n = 0;
  const gy = leafGround + playerH * 0.012,
    snap = playerH * 0.02,
    near = U.uFogNear.value,
    far = U.uFogFar.value;
  for (const l of leaves) {
    if (!l.on) continue;
    if (!show) {
      endLeaf(l);
      continue;
    }
    l.t += dt;
    const y = l.y0 - l.vy * l.t;
    if (y <= gy) {
      endLeaf(l);
      continue;
    }
    n++;
    let x = l.x0 + l.drx * l.t + Math.sin(l.t * l.fq + l.ph) * l.amp,
      z =
        l.z0 + l.drz * l.t + Math.cos(l.t * l.fq * 0.8 + l.ph) * l.amp * 0.7,
      yy = y;
    if (ps1) {
      x = Math.round(x / snap) * snap;
      z = Math.round(z / snap) * snap;
      yy = Math.round(yy / snap) * snap;
    // chunky vertex-snap feel
    }
    l.spr.position.set(x, yy, z);
    const fi = Math.floor((l.t * 1000) / LEAF_MS + l.off) % LEAF_FRAMES;
    if (fi !== l.fi) {
      l.fi = fi;
      l.tex.offset.x = fi / LEAF_FRAMES;
    }
    const d = camera.position.distanceTo(l.spr.position),
      f = Math.min(1, Math.max(0, (d - near) / (far - near))),
      // fades into the fog like the trees
      fog = 1 - f * f * (3 - 2 * f);
    l.spr.material.opacity =
      Math.max(0, Math.min(1, l.t / 0.4, (y - gy) / (playerH * 0.15))) * fog;
  }
  if (show) {
    leafWait -= dt;
    if (leafWait <= 0) {
      if (n < LEAF_MAX) {
        const l = leaves.find((q) => !q.on);
        if (l) spawnLeaf(l);
      }
      leafWait =
        LEAF_EVERY_MIN + Math.random() * (LEAF_EVERY_MAX - LEAF_EVERY_MIN);
    }
  }
}
