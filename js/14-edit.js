// EDIT: a phonk edit, and the ready hook for the loading screen.
// (Part 14 of 14. All parts share one scope; see README.)

/* ---------- EDIT: a phonk edit ----------
 ANIMATIONS > EDIT turns the screen into a car-edit style video: everything but the knight is hidden, he is pitch black (armor and plume at their darkest) with no weapon, and he cuts between six poses
 ON THE BEAT of the song (SUA CAVALONA, hardstyle remix, started at 0:57 and looped from there) while the camera whips round him: every beat a new shot (low angles, close-ups, high angles, tilted ones),
 a fast sharp turn, a zoom punch and a shake, with a white flash on the first beat of every bar and a hard flicker on the drop. ESC (or a tap) leaves.
 The song's beat: its drop (the first big hit) is at 57.844 s and the beat is 0.4488 s (133.7 BPM) from there. Everything is driven from the song's own clock, so it cannot drift. */
const EDIT_START = 57.0,
  EDIT_FIRST = 57.844,
  EDIT_PERIOD = 0.4488,
  EDIT_LEAD = 0.035,
  // EDIT_LEAD: the picture is changed a hair before the beat (the sound reaches the ear a little later than the frame is drawn)
  EDIT_GAIN = 0.9;
// the background: light, then red, a new one every bar
const EDIT_BG = ["#ececec", "#d3121f"];
const EDIT_SHOTS = [
  // camera shots: zoom (bigger = further), pitch (negative = from below), height he is looked at (fraction of his height from the middle), roll (tilt)
  { z: 0.85, p: -0.18, y: 0.0, r: 0 },
  { z: 0.5, p: 0.03, y: 0.3, r: 0 },
  { z: 0.6, p: 0.08, y: 0.1, r: 0 },
  { z: 0.8, p: 0.6, y: -0.05, r: 0 },
  { z: 0.58, p: -0.25, y: -0.3, r: 0 },
  { z: 0.62, p: 0.04, y: 0.05, r: 0.22 },
  { z: 0.62, p: 0.04, y: 0.05, r: -0.22 },
  { z: 1.05, p: 0.0, y: 0.0, r: 0 },
  { z: 0.58, p: 0.1, y: 0.12, r: 0.3 },
];
// per pose: look lower at the crouch, the dance and (a lot) the pose lying down
const EDIT_POSE_Y = [0, 0, -0.18, -0.08, 0, -0.42, 0];
let editBusy = false,
  editBuf = null,
  editLoading = null,
  editSrc = null,
  editGain = null,
  editT0 = 0,
  editPrev = null,
  editHid = [],
  editBeat0 = -99,
  editBag = [],
  editPoseLast = -1,
  editPoseNow = 0,
  editShotLast = -1;
let editVisor = 0,
  editRollGoal = 0,
  editYawGoal = 0,
  editDir = 1,
  editPitchGoal = 0,
  editZoomGoal = 1,
  editYGoal = 0,
  editPunch = 0,
  editShake = 0,
  editFlash = 0,
  editInvert = 0,
  editBlur = 0,
  editBg = 0,
  editFx = null,
  editExitOk = 0;
const _edC = new THREE.Color();
function editLoad() {
  if (editBuf) return Promise.resolve(editBuf);
  if (editLoading) return editLoading;
  const t = atob(
      document.getElementById("edit-song-data").textContent.trim(),
    ),
    u = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
  return (editLoading = new Promise((res, rej) =>
    sfx.decodeAudioData(u.buffer, res, rej),
  ).then((b) => {
    editBuf = b;
    return b;
  }));
}
function editVisorSet(v) {
  // the helmet's materials (every helmet set, never the plume): the black visor texels flash white by v (0..1)
  helmetSets.forEach((set) =>
    set.forEach((m) => {
      const u = m.material && m.material.uniforms;
      if (u && u.uBlackFlash && !/plume/i.test(m.name || ""))
        u.uBlackFlash.value = v;
    }),
  );
}
function editBlack(on) {
  // the armor: every armor material's tint pulled to (nearly) black; the plume: its darkest colour
  armorMats.forEach((m, i) => {
    const v = m.uniforms.uTint.value;
    if (on) v.set(0.035, 0.035, 0.04);
    else if (editPrev && editPrev.tints[i]) v.copy(editPrev.tints[i]);
  });
  tintPlume(on ? "#000000" : editPrev ? editPrev.plume : null);
}
function editPoseNext() {
  // the next of the poses (EDIT_POSE_N of them), from a shuffled bag so none repeats until all have played
  if (!editBag.length) {
    editBag = [];
    for (let i = 0; i < EDIT_POSE_N; i++) editBag.push(i);
    for (let i = EDIT_POSE_N - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [editBag[i], editBag[j]] = [editBag[j], editBag[i]];
    }
    if (editBag[editBag.length - 1] === editPoseLast) {
      const j = Math.floor(Math.random() * (editBag.length - 1));
      [editBag[editBag.length - 1], editBag[j]] = [
        editBag[j],
        editBag[editBag.length - 1],
      ];
    }
  }
  editPoseLast = editPoseNow = editBag.pop();
  const a = actions["UALX_EditPose" + (editPoseNow + 1)];
  if (!a) return;
  // a hard cut: the new pose starts BEFORE the old one stops (else one frame shows the bind pose)
  a.reset().setEffectiveWeight(1).setLoop(THREE.LoopRepeat, Infinity).play();
  Object.keys(actions).forEach((k) => {
    if (actions[k] !== a && actions[k].isRunning()) actions[k].stop();
  });
  if (current && current !== a) current.stop();
  current = a;
  mixer.update(0);
}
/* The 7th pose (Walk3 from the Blockbench file: the dislocated idle). It lasts two beats: on the first he holds the sword in his hand; it then shoots up his arm, so fast that it lands on his face exactly on the next beat,
 where the visor flashes and the RDR2 low-honor sting hits (its loudest part, EDIT_SWORD_PEAK s into the file, is put on that beat). edSw.st: 0 = no sword, 1 = in his hand / flying, 2 = landed on his face. */
const EDIT_POSE_N = 6,
  EDIT_SWORD_POSE = -1,
  EDIT_SWORD_FLY = 0.09,
  EDIT_SWORD_GAIN = 1.0,
  EDIT_SWORD_PEAK = 0.16;
const EDIT_SWORD_FACE = [0, 0.15, 0.36],
  // where the middle of the blade lands (in the head's own space: just in front of the visor), and where the middle of the blade is along the sword's own axis
  EDIT_SWORD_CY = 1.1;
const edSw = {
  st: 0,
  grp: null,
  fore: null,
  head: null,
  shoulder: null,
  p0: null,
  q0: null,
  s0: null,
  snd: false,
};
const _e1 = new THREE.Vector3(),
  _e2 = new THREE.Vector3(),
  _e3 = new THREE.Vector3(),
  _e4 = new THREE.Vector3(),
  _eq1 = new THREE.Quaternion(),
  _eq2 = new THREE.Quaternion(),
  _eq3 = new THREE.Quaternion(),
  _em1 = new THREE.Matrix4(),
  _em2 = new THREE.Matrix4(),
  _es = new THREE.Vector3(),
  _eqz = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    Math.PI / 2,
  );
function editSwordGroup() {
  return swordStyle === "hatchet"
    ? hatchetGrp
    : swordStyle === "hammer"
      ? hammerGrp
      : swordStyle === "knightly"
        ? knightlyGrp
        : swordStyle === "morningstar"
          ? morningstarGrp
          : swordGrp;
}
function editSwordBegin() {
  const grp = editSwordGroup();
  if (!grp || !grp.parent || !playerRig) return;
  edSw.grp = grp;
  edSw.fore = grp.parent;
  edSw.head = playerRig.getObjectByName("Head");
  edSw.shoulder =
    playerRig.getObjectByName(SWORD_HAND + "_Arm") || grp.parent;
  if (!edSw.head) {
    edSw.grp = null;
    return;
  }
  edSw.p0 = grp.position.clone();
  edSw.q0 = grp.quaternion.clone();
  edSw.s0 = grp.scale.clone();
  edSw.st = 1;
  edSw.snd = false;
  grp.visible = true;
  loadSfxSet("honor-sfx-data");
}
function editSwordEnd() {
  // back into his hand, out of sight again (EDIT shows no weapon)
  const g = edSw.grp;
  if (g) {
    g.position.copy(edSw.p0);
    g.quaternion.copy(edSw.q0);
    g.scale.copy(edSw.s0);
    g.visible = false;
  }
  edSw.grp = null;
  edSw.st = 0;
  edSw.snd = false;
}
function editSwordStep(ph) {
  // ph: how far through the beat we are (0..1)
  if (!edSw.st || !edSw.grp) return;
  const P = EDIT_PERIOD,
    fly = EDIT_SWORD_FLY / P;
  if (edSw.st === 1 && !edSw.snd && ph >= 0.5) {
    // the sting is scheduled ahead, so its loudest part sits on the next beat (the picture changes EDIT_LEAD before the beat is heard)
    edSw.snd = true;
    playSfxSetTracked(
      "honor-sfx-data",
      0,
      EDIT_SWORD_GAIN,
      1,
      Math.max(0, (1 - ph) * P + EDIT_LEAD - EDIT_SWORD_PEAK),
    );
  }
  const u =
      edSw.st === 1 ? Math.max(0, Math.min(1, (ph - (1 - fly)) / fly)) : 1,
    grp = edSw.grp,
    fore = edSw.fore;
  playerRig.updateMatrixWorld(true);
  const Wf = fore.matrixWorld,
    cy = EDIT_SWORD_CY;
  // the sword where it is in his hand, in the world
  _em1.compose(edSw.p0, edSw.q0, edSw.s0).premultiply(Wf);
  // _e1 origin, _eq1 turn, _es scale
  _em1.decompose(_e1, _eq1, _es);
  const sc = _es.y,
    C0 = _e2
      .set(0, cy, 0)
      .multiplyScalar(sc)
      .applyQuaternion(_eq1)
      .add(_e1)
      // the middle of the blade, in his hand
      .clone();
  // up the arm: his shoulder
  const C1 = edSw.shoulder.getWorldPosition(new THREE.Vector3());
  const C2 = edSw.head.localToWorld(
    _e3.set(EDIT_SWORD_FACE[0], EDIT_SWORD_FACE[1], EDIT_SWORD_FACE[2]),
  // and on to his face
  );
  edSw.head.getWorldQuaternion(_eq2);
  // blade across the face, flat against it, hilt on the sword-arm side
  _eq2.multiply(_eqz);
  const L1 = C0.distanceTo(C1),
    L2 = C1.distanceTo(C2),
    // speeds up all the way: it hits at full speed
    d = u * u * (L1 + L2);
  const C = _e4;
  if (d <= L1) C.lerpVectors(C0, C1, L1 > 0 ? d / L1 : 1);
  else C.lerpVectors(C1, C2, L2 > 0 ? (d - L1) / L2 : 1);
  const q = _eq3.copy(_eq1).slerp(_eq2, Math.min(1, u * 1.15));
  const org = _e1
    .set(0, cy, 0)
    .multiplyScalar(sc)
    .applyQuaternion(q)
    .negate()
    .add(C);
  _em2
    .compose(org, q, _es)
    .premultiply(_em1.copy(Wf).invert())
    .decompose(grp.position, grp.quaternion, grp.scale);
}
function editOnBeat(idx) {
  const bar = ((idx % 4) + 4) % 4,
    drop = idx === 0;
  let land = false;
  if (edSw.st === 1) {
    edSw.st = 2;
    land = true;
  // the second beat of the sword pose: the pose is held, the sword has just landed
  }
  else {
    editSwordEnd();
    editPoseNext();
    if (editPoseNow === EDIT_SWORD_POSE) editSwordBegin();
  }
  let k;
  do {
    k = Math.floor(Math.random() * EDIT_SHOTS.length);
  } while (k === editShotLast);
  if (drop || land) k = 1;
  // the landing is a close-up, like the drop   // the drop is always the close-up
  editShotLast = k;
  const sh = EDIT_SHOTS[k];
  editZoomGoal = sh.z;
  editPitchGoal = sh.p;
  editYGoal = sh.y + EDIT_POSE_Y[editPoseNow];
  editRollGoal = sh.r;
  editDir = Math.random() < 0.5 ? -1 : 1;
  editYawGoal +=
    // the sharp turn: a big jump round him
    editDir * (0.9 + Math.random() * 1.5) * (bar === 0 ? 1.4 : 1);
  editPunch = 1;
  editShake = bar === 0 ? 1 : 0.45;
  editBlur = 1;
  // editVisor: the visor flashes white on every beat (it only shows when his face is turned to the camera)
  editVisor = 1;
  if (bar === 0) {
    editFlash = 0.85;
    editBg = (editBg + 1) % EDIT_BG.length;
  }
  if (land) {
    editFlash = Math.max(editFlash, 0.9);
    editShake = Math.max(editShake, 1.6);
  }
  if (drop) {
    editFlash = 1;
    editInvert = 0.14;
    editShake = 2.2;
  } else if (bar === 0 && ((idx % 8) + 8) % 8 === 0) editInvert = 0.07;
}
function editFxBuild() {
  if (editFx) return;
  const st = document.createElement("style");
  st.textContent =
    "#editfx{position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden}#editfx div{position:absolute}" +
    "#editfx .ebt,#editfx .ebb{left:0;right:0;height:9vh;background:#000;transition:transform .5s cubic-bezier(.2,.7,.2,1)}#editfx .ebt{top:0;transform:translateY(-100%)}#editfx .ebb{bottom:0;transform:translateY(100%)}#editfx.on .ebt,#editfx.on .ebb{transform:none}" +
    "#editfx .evg{inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 52%,rgba(0,0,0,.5) 100%)}#editfx .efl{inset:0;background:#fff;opacity:0}#editfx .eblk{inset:0;background:#000;opacity:1;transition:opacity .7s}#editfx.on .eblk{opacity:0}" +
    "#editfx .eh{left:14px;bottom:calc(9vh + 10px);font:16px monospace;letter-spacing:.2em;color:#000;opacity:.55;transition:opacity 1s}#editfx .eh.gone{opacity:0}";
  document.head.appendChild(st);
  editFx = document.createElement("div");
  editFx.id = "editfx";
  editFx.innerHTML =
    '<div class="evg"></div><div class="efl"></div><div class="ebt"></div><div class="ebb"></div><div class="eblk"></div><div class="eh">ESC: EXIT</div>';
  document.body.appendChild(editFx);
}
function editStart() {
  if (editOn || editBusy || exploring || mapMode || invOn) return;
  editBusy = true;
  try {
    sfx = sfx || new (window.AudioContext || window.webkitAudioContext)();
    sfx.resume();
  } catch (e) {
    editBusy = false;
    return;
  }
  editLoad()
    .then((buf) => {
      editBusy = false;
      if (!editOn) editBegin(buf);
    })
    .catch((e) => {
      editBusy = false;
      console.error("edit song failed", e);
    });
}
function editBegin(buf) {
  editPrev = {
    zoom: zoom,
    pitch: pitch,
    yaw: yaw,
    tx: target.x,
    ty: target.y,
    tz: target.z,
    spin: spin,
    night: night,
    clip: current ? current.getClip().name : null,
    plume: plumeHex,
    tints: armorMats.map((m) => m.uniforms.uTint.value.clone()),
  };
  editOn = true;
  if (spin) toggleSpin();
  todHold = "day";
  lookSnap = true;
  editHid = scene.children
    .filter((o) => o !== playerRig && o !== invBg)
    .map((o) => ({ o: o, v: o.visible }));
  // everything but the knight goes
  if (rockMesh) editHid.push({ o: rockMesh, v: rockMesh.visible });
  // the menu steps aside
  document.body.classList.add("map");
  editBlack(true);
  showWeapons();
  // black, no weapon, and the menu music out
  syncAudio();
  [srcNode, flauntSrc, battleSrc]
    .concat(Object.keys(xtra).map((k) => xtra[k].src))
    .forEach((t) => {
      if (t) stopTrack(t);
    });
  srcNode = flauntSrc = battleSrc = null;
  // and straight away, whatever was still starting up
  for (const k in xtra) xtra[k].src = null;
  editSwordEnd();
  loadSfxSet("honor-sfx-data");
  editBeat0 = -99;
  editBag = [];
  editPoseLast = -1;
  editShotLast = -1;
  editBg = 0;
  editPunch = editShake = editFlash = editInvert = editBlur = editVisor = 0;
  editYawGoal = yaw;
  editRoll = editRollGoal = 0;
  editPitchGoal = 0.04;
  editZoomGoal = 0.8;
  editYGoal = 0;
  editPoseNext();
  const src = sfx.createBufferSource(),
    g = sfx.createGain();
  src.buffer = buf;
  src.loop = true;
  src.loopStart = EDIT_START;
  // starts at 0:57 and loops from there
  src.loopEnd = buf.duration;
  g.gain.value = EDIT_GAIN;
  src.connect(g);
  g.connect(sfx.destination);
  editT0 = sfx.currentTime + 0.05;
  src.start(editT0, EDIT_START);
  editSrc = src;
  editGain = g;
  editFxBuild();
  requestAnimationFrame(() => editFx.classList.add("on"));
  setTimeout(() => {
    const h = editFx && editFx.querySelector(".eh");
    if (h) h.classList.add("gone");
  }, 3500);
  editExitOk = performance.now() + 900;
}
function editEnd() {
  if (!editOn) return;
  editOn = false;
  try {
    const t = sfx.currentTime;
    editGain.gain.cancelScheduledValues(t);
    editGain.gain.setValueAtTime(editGain.gain.value, t);
    editGain.gain.linearRampToValueAtTime(0, t + 0.25);
    editSrc.stop(t + 0.3);
  } catch (_) {}
  editSrc = null;
  editGain = null;
  editSwordEnd();
  swishStopAll();
  editBlack(false);
  editVisorSet(0);
  showWeapons();
  editHid.forEach((h) => {
    h.o.visible = h.v;
  });
  editHid = [];
  if (invBg) {
    invBg.visible = false;
    const u = invBg.material.uniforms;
    u.uGlow.value = INV_BG_GLOW;
    u.uVig.value = INV_BG_VIGNETTE;
    u.uBokeh.value = INV_BG_BOKEH;
  }
  if (editFx) {
    editFx.remove();
    editFx = null;
  }
  renderer.domElement.style.filter = "";
  const p = editPrev;
  editPrev = null;
  editRoll = 0;
  if (p) {
    zoom = p.zoom;
    pitch = p.pitch;
    yaw = p.yaw;
    target.set(p.tx, p.ty, p.tz);
    if (todHold) {
      todHold = null;
      lookSnap = true;
    }
    if (p.spin !== spin) toggleSpin();
  }
  mapViewK = 1;
  applyView();
  document.body.classList.remove("map");
  if (p && p.clip && actions[p.clip]) play(p.clip);
  else play(idleName());
  syncAudio();
}
function editStep(dt) {
  if (!editOn) return;
  editHid.forEach((h) => {
    h.o.visible = false;
  });
  // the beat, read off the song's own clock
  const el = sfx.currentTime - editT0,
    len = editBuf.duration - EDIT_START,
    pos = EDIT_START + (el < 0 ? 0 : el % len);
  const b = (pos + EDIT_LEAD - EDIT_FIRST) / EDIT_PERIOD,
    idx = Math.floor(b),
    ph = b - idx;
  if (el >= 0 && idx !== editBeat0) {
    editBeat0 = idx;
    editOnBeat(idx);
  }
  editSwordStep(ph);
  // the camera: eased VERY fast, so each cut is a whip, with a slow drift in between
  editYawGoal += dt * 0.22 * editDir;
  editPunch *= Math.exp(-dt * 6);
  editVisor *= Math.exp(-dt * 8);
  editShake *= Math.exp(-dt * 9);
  editFlash *= Math.exp(-dt * 7);
  editBlur *= Math.exp(-dt * 11);
  editInvert = Math.max(0, editInvert - dt);
  const k = (r) => 1 - Math.exp(-dt * r);
  yaw += (editYawGoal - yaw) * k(26);
  pitch += (editPitchGoal - pitch) * k(22);
  editRoll += (editRollGoal - editRoll) * k(18);
  const zg = editZoomGoal * (1 - 0.1 * ph) * (1 - 0.22 * editPunch);
  // a slow push in across each beat, and a punch on it
  zoom += (zg - zoom) * k(24);
  const ty = (editPrev ? homeTarget.y : 0) + playerH * (editYGoal + 0.08);
  target.y += (ty - target.y) * k(22);
  target.x = editPrev.tx;
  target.z = editPrev.tz;
  target.x += (Math.random() - 0.5) * 0.12 * editShake;
  target.y += (Math.random() - 0.5) * 0.12 * editShake;
  target.z += (Math.random() - 0.5) * 0.12 * editShake;
  mapViewK = 0;
  applyView();
  // the picture: background colour, glow and vignette behind him
  _edC.set(EDIT_BG[editBg]);
  renderer.setClearColor(_edC);
  U.uFogColor.value.copy(_edC);
  {
    const bg = invBackdrop(),
      u = bg.material.uniforms;
    bg.visible = true;
    u.uBase.value.copy(_edC);
    u.uTime.value += dt;
    u.uAsp.value = innerWidth / innerHeight;
    u.uK.value = 1;
    u.uGlow.value = 0.4;
    u.uVig.value = 0.55;
    u.uBokeh.value = 0;
  }
  editVisorSet(editVisor > 0.02 ? editVisor : 0);
  if (editFx) {
    editFx.querySelector(".efl").style.opacity = Math.min(
      1,
      editFlash,
    ).toFixed(3);
  }
  const blur =
      editBlur > 0.05 ? "blur(" + (editBlur * 5).toFixed(1) + "px)" : "",
    inv = editInvert > 0 ? "invert(1)" : "";
  renderer.domElement.style.filter = (inv + " " + blur).trim();
}
addEventListener(
  "keydown",
  (e) => {
    if (!editOn) return;
    e.stopImmediatePropagation();
    if (e.key === "Escape" || e.key === "Backspace" || e.key === "Enter") {
      e.preventDefault();
      editEnd();
    }
  },
  true,
);
addEventListener(
  "pointerdown",
  (e) => {
    if (editOn && performance.now() > editExitOk) {
      e.stopImmediatePropagation();
      editEnd();
    }
  },
  true,
);
function initMainMenu() {
  const root = document.getElementById("mm"),
    scr = document.getElementById("scr"),
    cust = document.getElementById("cust"),
    toastEl = document.getElementById("toast");
  [
    "vlbl",
    "voicesel",
    "hlbl",
    "helmsel",
    "plbl",
    "sws",
    "albl",
    "asws",
    "astrl",
    "astr",
    "shiny",
    "slbl",
    "ssws",
    "smatch",
  ].forEach((id) => {
    const n = document.getElementById(id);
    if (n) cust.appendChild(n);
  });
  let tt = 0;
  window.toast = toast;
  function toast(t) {
    toastEl.textContent = t;
    toastEl.classList.add("show");
    clearTimeout(tt);
    tt = setTimeout(() => toastEl.classList.remove("show"), 1700);
  }
  const BACK = { t: "BACK", go: "main" },
    // BACK_OPT: from a group of options back to OPTIONS
    BACK_OPT = { t: "BACK", go: "options" };
  // from an ANIMATIONS sub-menu back to the ANIMATIONS list
  const BACK_ANIM = { t: "BACK", go: "anims" };
  // from one enemy's animations back to the enemy list
  const BACK_ENEMIES = { t: "BACK", go: "anims_enemies" };
  const evRows = (key) => {
    const d = evDefs(key);
    return d
      ? d.map((x, i) => ({
          t: x.label,
          v: () =>
            golemOn && evCur && evCur.key === key && evCur.ci === i
              ? "PLAYING"
              : "",
          run: () => evPlay(key, i),
        }))
      : [{ t: "LOADING..." }];
  };
  const animRows = (g) =>
    menuNames
      .filter((n) => animGroup(n) === g && animVisible(n))
      .map((n) => ({
        t: n.toUpperCase(),
        v: () =>
          !golemOn &&
          current &&
          (AXE_BASE[current.getClip().name] || current.getClip().name) === n
            ? "PLAYING"
            : "",
        run: () => menuPlay(n),
      }));
  const SCREENS = {
    start: { name: "PRESS START", items: [{ t: "START", run: startGame }] },
    main: {
      name: "MAIN MENU",
      items: [
        { t: "MAP", run: openMap },
        { t: "INVENTORY", run: openInventory },
        { t: "OPTIONS", go: "options" },
        { t: "ANIMATIONS", go: "anims" },
        { t: "CREDITS", go: "credits" },
      ],
    },
    custom: { name: "CUSTOMIZE", panel: 1, items: [BACK] },
    /* TEMPORARY: lists every animation in the model so you can preview them. Delete this screen and the ANIMATIONS entry above when you no longer need it */
    anims: {
      name: "ANIMATIONS (TEMP)",
      get items() {
        return [
          { t: "ANIM SET", v: () => animSet.toUpperCase(), run: toggleUal },
          { t: "ENEMIES", go: "anims_enemies" },
          { t: "SELF", go: "anims_self" },
          { t: "SHOPKEEPER", go: "anims_shop" },
          { t: "MISC", go: "anims_misc" },
          BACK,
        ];
      },
    },
    anims_misc: {
      name: "ANIMATIONS: MISC",
      up: "anims",
      items: [{ t: "EDIT", run: editStart }, BACK_ANIM],
    },
    anims_enemies: {
      name: "ANIMATIONS: ENEMIES",
      up: "anims",
      get items() {
        return EV_ENEMIES.map((e) => ({
          t: e.name,
          go: "anims_en_" + e.key,
        })).concat([BACK_ANIM]);
      },
    },
    anims_en_golem: {
      name: "ENEMIES: GOLEM",
      up: "anims_enemies",
      get items() {
        return evRows("golem").concat([BACK_ENEMIES]);
      },
    },
    anims_en_treeling: {
      name: "ENEMIES: TREELING",
      up: "anims_enemies",
      get items() {
        return evRows("treeling").concat([BACK_ENEMIES]);
      },
    },
    anims_en_sporeling: {
      name: "ENEMIES: SPORELING",
      up: "anims_enemies",
      get items() {
        return evRows("sporeling").concat([BACK_ENEMIES]);
      },
    },
    anims_en_slime: {
      name: "ENEMIES: SLIME",
      up: "anims_enemies",
      get items() {
        return evRows("slime").concat([BACK_ENEMIES]);
      },
    },
    anims_self: {
      name: "ANIMATIONS: SELF",
      up: "anims",
      get items() {
        return animRows("self").concat([BACK_ANIM]);
      },
    },
    anims_shop: {
      name: "ANIMATIONS: SHOPKEEPER",
      up: "anims",
      get items() {
        return animRows("shop").concat([BACK_ANIM]);
      },
    },
    options: {
      name: "OPTIONS",
      items: [
        { t: "GRAPHICS", go: "opt_gfx" },
        { t: "WORLD", go: "opt_world" },
        { t: "SOUND", go: "opt_sound" },
        { t: "KNIGHT", go: "opt_knight" },
        BACK,
      ],
    },
    opt_gfx: {
      name: "GRAPHICS",
      up: "options",
      items: [
        { t: "LOOK", v: () => (ps1 ? "PS1" : "MODERN"), run: toggleLook },
        { t: "PIXELS", v: () => PIX_STEPS[pixIdx][0], run: cyclePixels },
        { t: "COLORS", v: () => COL_STEPS[colIdx][0], run: cycleColors },
        { t: "SHINE", v: () => (shineOn ? "ON" : "OFF"), run: toggleShine },
        BACK_OPT,
      ],
    },
    opt_world: {
      name: "WORLD",
      up: "options",
      items: [
        {
          t: "WORLD",
          v: () => (forest ? "FOREST" : "CLASSIC"),
          run: () => setWorld(!forest),
        },
        // AUTO (local clock) or a slider over the 24 hours: LEFT / RIGHT
        { t: "TIME", v: todText, adj: todSlide },
        {
          t: "FOG",
          v: () => "#".repeat(fogT) + ".".repeat(9 - fogT),
          adj: (d) => {
            fogT = d ? Math.max(1, Math.min(9, fogT + d)) : (fogT % 9) + 1;
          },
        // thickness: LEFT / RIGHT (or click) - 5 is the normal fog
        },
        {
          t: "LEAVES",
          v: () => (leavesOn ? "ON" : "OFF"),
          run: toggleLeaves,
        },
        {
          t: "SNOW",
          v: () => (snowOn ? "ON" : "OFF"),
          run: () => {
            snowOn = !snowOn;
          },
        },
        BACK_OPT,
      ],
    },
    opt_sound: {
      name: "SOUND",
      up: "options",
      items: [
        {
          t: "MUSIC",
          v: () => (musicOn ? "ON" : "OFF"),
          run: () => {
            toggleMusic();
            setTimeout(render, 0);
          },
        },
        {
          t: "BITCRUSH",
          v: () => (crushOn ? "ON" : "OFF"),
          run: toggleCrush,
        },
        {
          t: "VOICE",
          v: () => (voice === "voice2" ? "VOICE 2" : "VOICE 1"),
          run: toggleVoice,
        },
        BACK_OPT,
      ],
    },
    opt_knight: {
      name: "KNIGHT",
      up: "options",
      items: [
        {
          t: "WEAPON",
          v: () => (weapon === "axe" ? "AXE" : "SWORD"),
          run: toggleWeapon,
        },
        {
          t: "SWORD STYLE",
          v: () =>
            swordStyle === "hatchet"
              ? "HATCHET"
              : swordStyle === "hammer"
                ? "HAMMER"
                : swordStyle === "knightly"
                  ? "KNIGHTLY"
                  : swordStyle === "morningstar"
                    ? "MORNINGSTAR"
                    : "SWORD",
          run: toggleStyle,
        },
        {
          t: "AXE STYLE",
          v: () => (axeStyle === "shovel" ? "SHOVEL" : "AXE"),
          run: toggleAxeStyle,
        },
        { t: "ANIM SET", v: () => animSet.toUpperCase(), run: toggleUal },
        {
          t: "SWOOSH",
          v: () => (swooshOn ? "ON" : "OFF"),
          run: toggleSwoosh,
        },
        { t: "TURNTABLE", v: () => (spin ? "ON" : "OFF"), run: toggleSpin },
        BACK_OPT,
      ],
    },
    /* Attribution: This work is based on "Low Poly Campfire" (https://sketchfab.com/3d-models/low-poly-campfire-695c62069ac44614acbfc6effcf7499d) by MrE_Sauce (https://sketchfab.com/MrE_Sauce) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Glint and falling-leaf sprites by Kaessis. */
    /* The credits are one scrolling block of text; BACK is the only row. (Music, then sound effects.) NOTE: the slime sounds are placeholders from Mario Sports Mix and should be swapped out eventually. */
    credits: {
      name: "CREDITS",
      text: [
        "KNIGHT MODEL AND ART",
        "MADE IN BLOCKBENCH",
        "BY PEYANDKEELE",
        "",
        "ADVENTURER BASE MESH",
        "FROM A FREE LOW-POLY PACK",
        "",
        "LOW POLY CAMPFIRE",
        "BY MRE_SAUCE (SKETCHFAB)",
        "LICENSED CC BY 4.0",
        "",
        "GLINT AND FALLING LEAF",
        "SPRITES BY KAESSIS",
        "",
        "DARIEN GAP",
        "BY LT",
        "",
        "LIVIN LOOSE",
        "BY GEORGE CLANTON",
        "",
        "SACRIFICE OF SAINT DELL",
        "BY FM SKYLINE",
        "",
        "ICE (SLOWED)",
        "BY ZERTAL",
        "",
        "ASSHOLE PARTY",
        "BY TATEFOSTER",
        "",
        "PEPPER (INSTRUMENTAL)",
        "BY BUTTHOLE SURFERS",
        "",
        "HIT GRUNTS",
        "HARRY MASON",
        "FROM SILENT HILL (KONAMI)",
        "",
        "SWORD SOUNDS",
        "FROM CASTLEVANIA (KONAMI)",
        "",
        "WALKING SOUND",
        "FROM DIGIMON WORLD (BANDAI)",
        "",
        "BLOCK HIT SOUNDS",
        "FROM THE ELDER SCROLLS IV: OBLIVION",
        "BY BETHESDA GAME STUDIOS",
        "",
        "KRIS'S SOUND EFFECTS",
        "FROM STRAY",
        "BY BLUETWELVE STUDIO",
        "",
        "SLIME SOUNDS",
        "FROM MARIO SPORTS MIX",
        "(NINTENDO)",
        "",
        "GOLEM SOUNDS",
        "FROM ANACHRONOX",
        "BY ION STORM",
      ],
      items: [BACK],
    },
  };
  /* START: fade to black, then he gets up from Pose3 into the usual seated Pose2, the camera moves to the normal menu view, and the main menu opens */
  const fadeEl = document.getElementById("fade");
  let startBusy = false;
  function startGame() {
    if (startBusy) return;
    startBusy = true;
    fadeEl.classList.add("on");
    setTimeout(function () {
      menuCam();
      play(SEAT_CLIP);
      go("main");
      fadeEl.classList.remove("on");
      startBusy = false;
    }, 700);
  }
  /* START SCREEN (Escape / Backspace on the main menu): the way back to where the game began - fade to black, the low start camera, him hunched in Pose3, and the PRESS START menu */
  function toStartScreen() {
    if (startBusy || !actions[START_CLIP]) return;
    startBusy = true;
    fadeEl.classList.add("on");
    setTimeout(function () {
      play(START_CLIP);
      startCam();
      go("start");
      fadeEl.classList.remove("on");
      startBusy = false;
    }, 700);
  }
  let cur = actions[START_CLIP] ? "start" : "main",
    idx = 0,
    top = 0,
    btns = [];
  /* long lists scroll: only a window of rows is shown, with a "N MORE" marker above / below (click it, use the mouse wheel, or just keep pressing up / down) */
  const MENU_MAX = 8,
    uiEl = document.getElementById("ui");
  function visRows() {
    const small = innerWidth <= 640,
      rowH = small
        ? 38
        : Math.min(52, Math.max(46, innerWidth * 0.042 * 1.08 + 6));
    return Math.max(
      4,
      Math.min(
        MENU_MAX,
        Math.floor((innerHeight - (small ? 300 : 330)) / rowH),
      ),
    );
  }
  function moreRow(dir, count, vis) {
    const d = document.createElement("div");
    d.className = "more" + (count > 0 ? "" : " off");
    d.textContent = (dir < 0 ? "\u25B2 " : "\u25BC ") + count + " MORE";
    if (count > 0) d.onclick = () => scrollBy(dir * (vis - 1));
    return d;
  }
  function scrollBy(n) {
    const items = SCREENS[cur].items,
      vis = visRows();
    if (items.length <= vis) return;
    top = Math.max(0, Math.min(top + n, items.length - vis));
    if (idx < top) idx = top;
    else if (idx >= top + vis) idx = top + vis - 1;
    render();
  }
  function render() {
    const sc = SCREENS[cur];
    scr.textContent = sc.name;
    root.innerHTML = "";
    btns = [];
    startScr = cur === "start";
    // the start screen's camera can't be dragged
    document.body.classList.toggle("startscr", startScr);
    if (sc.text) {
      const d = document.createElement("div");
      d.className = "txt";
      d.innerHTML = sc.text.map((l) => l || "&nbsp;").join("<br>");
      root.appendChild(d);
    }
    cust.hidden = !sc.panel;
    // the customize screen gets the blue inventory-style panel (see index.html)
    document.body.classList.toggle("custscr", !!sc.panel);
    const items = sc.items,
      vis = visRows(),
      scrolls = items.length > vis;
    if (scrolls) {
      if (idx < top) top = idx;
      if (idx >= top + vis) top = idx - vis + 1;
      top = Math.max(0, Math.min(top, items.length - vis));
      root.appendChild(moreRow(-1, top, vis));
    } else top = 0;
    items.forEach((it, i) => {
      if (scrolls && (i < top || i >= top + vis)) return;
      const b = document.createElement("button");
      b.className =
        "mi" + (it.lock ? " lock" : "") + (i === idx ? " on" : "");
      b._i = i;
      b.innerHTML =
        "<span>" +
        it.t +
        "</span>" +
        (it.v
          ? '<span class="v">' + it.v() + "</span>"
          : it.lock
            ? '<span class="v">LOCKED</span>'
            : "");
      b.onmouseenter = () => {
        if (idx !== i) {
          idx = i;
          mark();
          blip(520, 0.05);
        }
      };
      b.onclick = () => {
        idx = i;
        mark();
        act();
      };
      root.appendChild(b);
      btns.push(b);
    });
    if (scrolls) root.appendChild(moreRow(1, items.length - top - vis, vis));
  }
  function mark() {
    btns.forEach((b) => b.classList.toggle("on", b._i === idx));
  }
  function go(n) {
    if (invOn && invCust && n === "main") {
      invShowInv();
      return;
    }
    if (golemOn && n !== "anims" && n.indexOf("anims_") !== 0)
      golemShow(false);
    cur = n;
    idx = 0;
    top = 0;
    render();
  // CUSTOMIZE lives in the inventory now: its BACK returns there
  }
  invGoMenu = go;
  function act() {
    const it = SCREENS[cur].items[idx];
    if (it.lock) {
      blip(140, 0.14);
      toast("LOCKED");
      return;
    }
    blip(880, 0.09);
    if (it.adj) {
      it.adj(0);
      render();
    } else if (it.go) go(it.go);
    else if (it.run) {
      it.run();
      render();
    }
  }
  function move(d) {
    const n = SCREENS[cur].items.length;
    idx = (idx + d + n) % n;
    blip(520, 0.05);
    if (idx < top || idx >= top + visRows()) render();
    else mark();
  }
  addEventListener("keydown", (e) => {
    if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
    if (exploring || mapMode || (invOn && !invCust)) return;
    const k = e.key;
    if (k === "ArrowDown" || k === "s") move(1);
    else if (k === "ArrowUp") move(-1);
    else if (k === "Enter" || k === " ") act();
    else if (k === "Escape" || k === "Backspace") {
      if (cur === "main") {
        if (!startBusy) {
          blip(300, 0.08);
          toStartScreen();
        }
      } else if (cur !== "start") {
        blip(300, 0.08);
        go(SCREENS[cur].up || "main");
      }
    } else if (k === "ArrowLeft" || k === "ArrowRight") {
      const it = SCREENS[cur].items[idx];
      if (it.adj) {
        it.adj(k === "ArrowRight" ? 1 : -1);
        blip(660, 0.05);
        render();
      } else if (it.run) act();
    }
  });
  uiEl.addEventListener(
    "wheel",
    (e) => {
      if (exploring || SCREENS[cur].items.length <= visRows()) return;
      e.preventDefault();
      blip(520, 0.03);
      scrollBy(e.deltaY > 0 ? 1 : -1);
    },
    { passive: false },
  );
  addEventListener("resize", () => {
    if (!exploring) render();
  });
  render();
}
// Tells the loading screen (index.html) when the knight and the golem are built.
// It polls this instead of reading playerRig / golemReady directly, so the two files stay decoupled.
window.__knightReady = () => ({ knight: !!playerRig, golem: !!playerRig && golemReady() });
