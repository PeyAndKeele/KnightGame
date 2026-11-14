// Seat rock, sword, hatchet, knightly sword, axe, potion.
// (Part 4 of 14. All parts share one scope; see README.)

/* ---------- seat rock (only visible in Pose2) ---------- */
function buildRockMesh(RD, seat, gnd, name) {
  return loadImg(RD.tex).then((img) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(RD.p, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(RD.n, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(RD.uv, 2));
    geo.setIndex(RD.i);
    geo.computeBoundingBox();
    const bb = geo.boundingBox,
      halfH = (bb.max.y - bb.min.y) / 2,
      midY = (bb.max.y + bb.min.y) / 2;
    const sx = ROCK_W / bb.max.x,
      sy = ROCK_H / halfH,
      sz = ROCK_D / bb.max.z;
    const tex = new THREE.Texture(img);
    tex.flipY = false;
    const m = new THREE.Mesh(geo, ps1Mat(tex, 1));
    m.name = name || "SeatRock";
    m.scale.set(sx, sy, sz);
    // middle of the rock at floor level = half of it is in the ground
    m.position.set(seat.x, gnd.y - midY * sy, seat.z - ROCK_BACK);
    return m;
  });
}
function initRock(parent, groundY) {
  const el = document.getElementById("rock-data");
  if (!el) return;
  const RD = JSON.parse(el.textContent);
  /* measure the seat now, while the model is in its bind pose (the pelvis does not move in Pose2) */
  parent.updateMatrixWorld(true);
  const pv = parent.getObjectByName("Adventurer_Pelvis");
  const seat = new THREE.Vector3(0, groundY + 0.93, 0.07),
    gnd = new THREE.Vector3(0, groundY, 0);
  if (pv) {
    const pb = new THREE.Box3().setFromObject(pv),
      c = pb.getCenter(new THREE.Vector3());
    seat.set(c.x, pb.min.y, c.z);
  }
  parent.worldToLocal(seat);
  parent.worldToLocal(gnd);
  buildRockMesh(RD, seat, gnd, "SeatRock")
    .then((m) => {
      parent.add(m);
      greenRockMesh = m;
      rockMesh = m;
      // Also place a standalone rock at The Greenfield's center for when the knight is in The Veiled Frost
      const sp = m.clone();
      sp.name = "SpareGreenRock";
      parent.updateMatrixWorld(true);
      sp.position.copy(m.getWorldPosition(new THREE.Vector3()));
      sp.quaternion.copy(m.getWorldQuaternion(new THREE.Quaternion()));
      sp.scale.copy(m.getWorldScale(new THREE.Vector3()));
      scene.add(sp);
      spareGreenRock = sp;
      syncRockMeshes();
    })
    .catch((e) => console.error("rock load failed", e));
  const sEl = document.getElementById("snow-rock-data");
  if (sEl) {
    const SRD = JSON.parse(sEl.textContent);
    buildRockMesh(SRD, seat, gnd, "SeatRock")
      .then((m) => {
        parent.add(m);
        frostRockMesh = m;
        // Also place a standalone snowy rock at The Veiled Frost's center for when the knight is in The Greenfield
        const sp = m.clone();
        sp.name = "SpareFrostRock";
        parent.updateMatrixWorld(true);
        sp.position.copy(m.getWorldPosition(new THREE.Vector3()));
        sp.position.z -= FROST_DIST * playerH;
        sp.quaternion.copy(m.getWorldQuaternion(new THREE.Quaternion()));
        sp.scale.copy(m.getWorldScale(new THREE.Vector3()));
        scene.add(sp);
        spareFrostRock = sp;
        syncRockMeshes();
      })
      .catch((e) => console.error("snow rock load failed", e));
  }
  const iEl = document.getElementById("ignis-rock-data");
  if (iEl) {
    const IRD = JSON.parse(iEl.textContent);
    buildRockMesh(IRD, seat, gnd, "SeatRock")
      .then((m) => {
        parent.add(m);
        ignisRockMesh = m;
        // Also place a standalone rock at Ignis Mourne's center for when the knight is elsewhere
        const sp = m.clone();
        sp.name = "SpareIgnisRock";
        parent.updateMatrixWorld(true);
        sp.position.copy(m.getWorldPosition(new THREE.Vector3()));
        sp.position.z -= IGNIS_DIST * playerH;
        sp.quaternion.copy(m.getWorldQuaternion(new THREE.Quaternion()));
        sp.scale.copy(m.getWorldScale(new THREE.Vector3()));
        scene.add(sp);
        spareIgnisRock = sp;
        syncRockMeshes();
      })
      .catch((e) => console.error("ignis rock load failed", e));
  }
}

/* ---------- shortsword (sword-data: Blockbench glTF, same 1/16 units as the knight). Parented to the hand's forearm bone so it follows every animation ---------- */
// 'Right' or 'Left' (character's own side)
const SWORD_HAND = "Left";
// where the handle's middle sits along the sword's own blade axis
const SWORD_GRIP_Y = 0.844;
// x,y,z (ZYX): 90,0,90 = blade pointing forward, edge up/down. Tweak to tilt it, e.g. 60,0,90 points it up a bit
const SWORD_ROT_DEG = [90, 0, 90];
// extra x,y,z shift in forearm space
const SWORD_NUDGE = [0, 0, 0];
// extra turn about the z axis, applied last. Use -90 to turn it the other way, 0 for none
const SWORD_ROLL_DEG = 90;
let swordGrp = null,
  swordOn = true,
  axeGrp = null,
  axeStyle = "axe",
  // axeStyle: 'axe' or 'shovel' (the shovel is the axe's alternate model: same rig, mount, animations and stats)   // weapon: 'sword' (light) or 'axe' (heavy)
  weapon = "sword";
function initSword(parent) {
  const el = document.getElementById("sword-data");
  if (!el) return;
  const SD = JSON.parse(el.textContent);
  const fore = parent.getObjectByName(SWORD_HAND + "_Forearm"),
    hand = parent.getObjectByName("Adventurer_" + SWORD_HAND + "_Hand");
  if (!fore || !hand) {
    console.error("sword: hand bones not found");
    return;
  }
  parent.updateMatrixWorld(true);
  const hc = new THREE.Box3()
    .setFromObject(hand)
    .getCenter(new THREE.Vector3());
  fore.worldToLocal(hc);
  const grp = new THREE.Group();
  grp.name = "Shortsword";
  grp.rotation.order = "ZYX";
  grp.rotation.set(
    (SWORD_ROT_DEG[0] * Math.PI) / 180,
    (SWORD_ROT_DEG[1] * Math.PI) / 180,
    (SWORD_ROT_DEG[2] * Math.PI) / 180,
  );
  grp.quaternion.premultiply(
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      (SWORD_ROLL_DEG * Math.PI) / 180,
    ),
  );
  const grip = new THREE.Vector3(0, SWORD_GRIP_Y, 0).applyQuaternion(
    grp.quaternion,
  );
  grp.position
    .copy(hc)
    .sub(grip)
    .add(new THREE.Vector3(SWORD_NUDGE[0], SWORD_NUDGE[1], SWORD_NUDGE[2]));
  Promise.all(SD.parts.map((p) => loadImg(p.tex)))
    .then((imgs) => {
      SD.parts.forEach((p, k) => {
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
        const smat = ps1Mat(tex, 1);
        swordMats.push(smat);
        tintMat(smat, swordMatch ? armorHex : swordHex);
        const m = new THREE.Mesh(geo, smat);
        m.name = "sword_" + p.name;
        m.position.set(p.t[0], p.t[1], p.t[2]);
        m.rotation.order = "ZYX";
        m.rotation.set(
          (p.r[0] * Math.PI) / 180,
          (p.r[1] * Math.PI) / 180,
          (p.r[2] * Math.PI) / 180,
        );
        grp.add(m);
      });
      grp.visible = swordOn;
      fore.add(grp);
      swordGrp = grp;
      initSwoosh(grp, parent);
    })
    .catch((e) => console.error("sword load failed", e));
}
/* ---------- the Hatchet (hatchet-data: Blockbench glTF). The small axe: an alternate style for the SWORD. It is a light weapon, so it is held exactly like the sword and uses the sword's
 own animations (Idle, Swing, ...) and the same swoosh. Pick it with OPTIONS > SWORD STYLE (or the same row on the animations screen). It follows the sword's hand and mount constants above;
 HATCHET_GRIP_Y is where the middle of its handle sits, HATCHET_TURN_DEG turns it about the handle (0 = the edge on the hand's side, 180 = the other way), HATCHET_NUDGE shifts it (forearm space). ---------- */
/* the Hammer (hammer-data): a second alternate style for the SWORD, held like the hatchet. HAMMER_GRIP is the middle of its handle (the handle stands at x 0, z 0.125 in the model). */
const HAMMER_GRIP = [0, 0.72, 0.125],
  HAMMER_TURN_DEG = 0,
  HAMMER_NUDGE = [0, 0, 0];
/* the Morningstar (morningstar-data): a fifth style for the SWORD, held like the hammer. MORNINGSTAR_GRIP is the middle of the part of its handle he holds (the handle stands at x 0, z 0, from y 0.315 to 1.14; the ball sits on top of it, its spikes reach y 1.44; the model is the original export scaled to 0.6 about the grip, so it is about the hatchet's length). The head is the same all the way round, so the turn does not matter much. */
const MORNINGSTAR_GRIP = [0, 0.6, 0],
  MORNINGSTAR_TURN_DEG = 0,
  MORNINGSTAR_NUDGE = [0, 0, 0];
const HATCHET_GRIP_Y = 1.156,
  HATCHET_TURN_DEG = 0,
  HATCHET_NUDGE = [0, 0, 0];
// 'voice1' (original sounds) or 'voice2' (new sounds)
let voice = "voice1";
function setVoice(v) {
  voice = v === "voice2" ? "voice2" : "voice1";
  const b = document.getElementById("voice");
  if (b) setSwitch("voice", true, voice === "voice2" ? "Voice 2" : "Voice 1");
  const sel = document.getElementById("voicesel");
  if (sel) sel.value = voice;
}
function toggleVoice() {
  setVoice(voice === "voice1" ? "voice2" : "voice1");
  try {
    sfx = sfx || new (window.AudioContext || window.webkitAudioContext)();
    sfx.resume();
  } catch (e) {}
  playFlauntSfx();
// preview: one of the voice's flaunt lines
}
let hatchetGrp = null,
  hammerGrp = null,
  knightlyGrp = null,
  morningstarGrp = null,
  // swordStyle: 'sword' or 'hatchet' (only shows while the weapon is the light one)
  swordStyle = "sword";
function showWeapons() {
  applyAxeStyle();
  if (swordGrp)
    swordGrp.visible = weapon === "sword" && swordStyle === "sword";
  if (hatchetGrp)
    hatchetGrp.visible = weapon === "sword" && swordStyle === "hatchet";
  if (hammerGrp)
    hammerGrp.visible = weapon === "sword" && swordStyle === "hammer";
  if (knightlyGrp)
    knightlyGrp.visible = weapon === "sword" && swordStyle === "knightly";
  if (morningstarGrp)
    morningstarGrp.visible =
      weapon === "sword" && swordStyle === "morningstar";
  if (axeGrp) axeGrp.visible = weapon === "axe";
  if (editOn)
    [
      swordGrp,
      hatchetGrp,
      hammerGrp,
      knightlyGrp,
      morningstarGrp,
      axeGrp,
    ].forEach((g) => {
      if (g) g.visible = false;
    // EDIT: no weapon
    });
  swooshUse();
}
function initHatchet(parent) {
  const el = document.getElementById("hatchet-data");
  if (!el) return;
  const HD = JSON.parse(el.textContent);
  const fore = parent.getObjectByName(SWORD_HAND + "_Forearm"),
    hand = parent.getObjectByName("Adventurer_" + SWORD_HAND + "_Hand");
  if (!fore || !hand) {
    console.error("hatchet: hand bones not found");
    return;
  }
  parent.updateMatrixWorld(true);
  const hc = new THREE.Box3()
    .setFromObject(hand)
    .getCenter(new THREE.Vector3());
  fore.worldToLocal(hc);
  const D = Math.PI / 180,
    Y = new THREE.Vector3(0, 1, 0);
  // start from the sword's own mount (same pointing, same flat-on-its-side hold) ...
  const qS = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      SWORD_ROT_DEG[0] * D,
      SWORD_ROT_DEG[1] * D,
      SWORD_ROT_DEG[2] * D,
      "ZYX",
    ),
  );
  qS.premultiply(
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      SWORD_ROLL_DEG * D,
    ),
  );
  // ... then turn it a quarter about its handle: the sword is wide along its x, the hatchet's head reaches out along its -z, so this lines the head up where the blade would be.
  // In the sword's hold the width runs along the forearm, so the quarter is chosen that puts the cutting edge on the fist's side of the handle - which is the side that swings down when the arm hangs
  const edge = new THREE.Vector3(0, 0, -1);
  let q = qS
    .clone()
    .multiply(new THREE.Quaternion().setFromAxisAngle(Y, Math.PI / 2));
  if (
    edge.clone().applyQuaternion(q).x * (SWORD_HAND === "Left" ? 1 : -1) <
    0
  )
    q = qS
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(Y, -Math.PI / 2));
  if (HATCHET_TURN_DEG)
    q.multiply(
      new THREE.Quaternion().setFromAxisAngle(Y, HATCHET_TURN_DEG * D),
    );
  const grp = new THREE.Group();
  grp.name = "Hatchet";
  grp.quaternion.copy(q);
  const grip = new THREE.Vector3(0, HATCHET_GRIP_Y, 0).applyQuaternion(q);
  grp.position
    .copy(hc)
    .sub(grip)
    .add(
      new THREE.Vector3(HATCHET_NUDGE[0], HATCHET_NUDGE[1], HATCHET_NUDGE[2]),
    );
  Promise.all(HD.parts.map((p) => loadImg(p.tex)))
    .then((imgs) => {
      HD.parts.forEach((p, k) => {
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
        const hmat = ps1Mat(tex, 1);
        swordMats.push(hmat);
        // the same weapon color as the sword
        tintMat(hmat, swordMatch ? armorHex : swordHex);
        const m = new THREE.Mesh(geo, hmat);
        m.name = "hatchet_" + p.name;
        m.position.set(p.t[0], p.t[1], p.t[2]);
        m.rotation.order = "ZYX";
        m.rotation.set(p.r[0] * D, p.r[1] * D, p.r[2] * D);
        grp.add(m);
      });
      fore.add(grp);
      hatchetGrp = grp;
      swooshAddRig(
        "hatchet",
        grp,
        parent.getObjectByName(SWORD_HAND + "_Arm") || fore,
        HATCHET_SWOOSH.tip,
        HATCHET_SWOOSH.hilt,
        {
          width: HATCHET_SWOOSH.width,
          start: SWOOSH_START_SPEED,
          stop: SWOOSH_STOP_SPEED,
        },
      );
      showWeapons();
    })
    .catch((e) => console.error("hatchet load failed", e));
}
/* ---------- the Knightly Sword (knightly-sword-data): the shortsword's shape with its own textures, a fifth style for the SWORD. Held exactly like the sword (same mount, animations and swoosh).
 Its coloured texels glow like the magma on the Ignis Mourne trees (uGem, in the shader) and the grey steel is pushed far towards white (uBladeGlow, 0.85 in the shader at 1). The steel takes the weapon colour at full strength (userData.tintAmt); the gems keep their own colours. ---------- */
function initKnightly(parent) {
  const el = document.getElementById("knightly-sword-data");
  if (!el) return;
  const SD = JSON.parse(el.textContent);
  const fore = parent.getObjectByName(SWORD_HAND + "_Forearm"),
    hand = parent.getObjectByName("Adventurer_" + SWORD_HAND + "_Hand");
  if (!fore || !hand) {
    console.error("knightly sword: hand bones not found");
    return;
  }
  parent.updateMatrixWorld(true);
  const hc = new THREE.Box3()
    .setFromObject(hand)
    .getCenter(new THREE.Vector3());
  fore.worldToLocal(hc);
  const D = Math.PI / 180;
  const grp = new THREE.Group();
  grp.name = "KnightlySword";
  grp.rotation.order = "ZYX";
  grp.rotation.set(
    SWORD_ROT_DEG[0] * D,
    SWORD_ROT_DEG[1] * D,
    SWORD_ROT_DEG[2] * D,
  );
  grp.quaternion.premultiply(
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      SWORD_ROLL_DEG * D,
    ),
  );
  const grip = new THREE.Vector3(0, SWORD_GRIP_Y, 0).applyQuaternion(
    grp.quaternion,
  );
  grp.position
    .copy(hc)
    .sub(grip)
    .add(new THREE.Vector3(SWORD_NUDGE[0], SWORD_NUDGE[1], SWORD_NUDGE[2]));
  Promise.all(SD.parts.map((p) => loadImg(p.tex)))
    .then((imgs) => {
      SD.parts.forEach((p, k) => {
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
        let kmat;
        if (p.name !== "crossguard") {
          kmat = ps1Mat(tex, 1);
          shineMat(kmat);
          kmat.uniforms.uGem.value = 1;
          // 0: no white wash on the steel any more (the gems still glow, uGem)
          kmat.uniforms.uBladeGlow.value = 0;
          kmat.userData.tintAmt = 1;
          swordMats.push(kmat);
          // it follows the weapon colour like the other swords, at full strength
          tintMat(kmat, swordMatch ? armorHex : swordHex);
        } else {
          // the guard is the normal sword's own, copied into knightly-sword-data: built exactly as initSword builds it (no glow, no shine, the normal sword's tint). The pommel and grip are still the knightly sword's
          kmat = ps1Mat(tex, 1);
          swordMats.push(kmat);
          tintMat(kmat, swordMatch ? armorHex : swordHex);
        }
        const m = new THREE.Mesh(geo, kmat);
        m.name = "knightly_" + p.name;
        m.position.set(p.t[0], p.t[1], p.t[2]);
        m.rotation.order = "ZYX";
        m.rotation.set(p.r[0] * D, p.r[1] * D, p.r[2] * D);
        grp.add(m);
      });
      fore.add(grp);
      knightlyGrp = grp;
      swooshAddRig(
        "knightly",
        grp,
        parent.getObjectByName(SWORD_HAND + "_Arm") || fore,
        [0, SWOOSH_TIP_Y, 0],
        [0, SWOOSH_HILT_Y, 0],
        {
          width: SWOOSH_WIDTH,
          start: SWOOSH_START_SPEED,
          stop: SWOOSH_STOP_SPEED,
        },
      );
      showWeapons();
    })
    .catch((e) => console.error("knightly sword load failed", e));
}
function initHammer(parent) {
  const el = document.getElementById("hammer-data");
  if (!el) return;
  const HD = JSON.parse(el.textContent);
  const fore = parent.getObjectByName(SWORD_HAND + "_Forearm"),
    hand = parent.getObjectByName("Adventurer_" + SWORD_HAND + "_Hand");
  if (!fore || !hand) {
    console.error("hammer: hand bones not found");
    return;
  }
  parent.updateMatrixWorld(true);
  const hc = new THREE.Box3()
    .setFromObject(hand)
    .getCenter(new THREE.Vector3());
  fore.worldToLocal(hc);
  const D = Math.PI / 180,
    Y = new THREE.Vector3(0, 1, 0);
  // start from the sword's own mount (same pointing, same flat-on-its-side hold) ...
  const qS = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      SWORD_ROT_DEG[0] * D,
      SWORD_ROT_DEG[1] * D,
      SWORD_ROT_DEG[2] * D,
      "ZYX",
    ),
  );
  qS.premultiply(
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      SWORD_ROLL_DEG * D,
    ),
  );
  // ... then turn it a quarter about its handle: the sword is wide along its x, the hammer's head reaches out along its -z, so this lines the head up where the blade would be.
  // In the sword's hold the width runs along the forearm, so the quarter is chosen that puts the cutting edge on the fist's side of the handle - which is the side that swings down when the arm hangs
  const edge = new THREE.Vector3(0, 0, -1);
  let q = qS
    .clone()
    .multiply(new THREE.Quaternion().setFromAxisAngle(Y, Math.PI / 2));
  if (
    edge.clone().applyQuaternion(q).x * (SWORD_HAND === "Left" ? 1 : -1) <
    0
  )
    q = qS
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(Y, -Math.PI / 2));
  if (HAMMER_TURN_DEG)
    q.multiply(
      new THREE.Quaternion().setFromAxisAngle(Y, HAMMER_TURN_DEG * D),
    );
  const grp = new THREE.Group();
  grp.name = "Hammer";
  grp.quaternion.copy(q);
  const grip = new THREE.Vector3(
    HAMMER_GRIP[0],
    HAMMER_GRIP[1],
    HAMMER_GRIP[2],
  ).applyQuaternion(q);
  grp.position
    .copy(hc)
    .sub(grip)
    .add(
      new THREE.Vector3(HAMMER_NUDGE[0], HAMMER_NUDGE[1], HAMMER_NUDGE[2]),
    );
  Promise.all(HD.parts.map((p) => loadImg(p.tex)))
    .then((imgs) => {
      HD.parts.forEach((p, k) => {
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
        const hmat = ps1Mat(tex, 1);
        swordMats.push(hmat);
        // the same weapon color as the sword
        tintMat(hmat, swordMatch ? armorHex : swordHex);
        const m = new THREE.Mesh(geo, hmat);
        m.name = "hammer_" + p.name;
        m.position.set(p.t[0], p.t[1], p.t[2]);
        m.rotation.order = "ZYX";
        m.rotation.set(p.r[0] * D, p.r[1] * D, p.r[2] * D);
        grp.add(m);
      });
      fore.add(grp);
      hammerGrp = grp;
      swooshAddRig(
        "hammer",
        grp,
        parent.getObjectByName(SWORD_HAND + "_Arm") || fore,
        HAMMER_SWOOSH.tip,
        HAMMER_SWOOSH.hilt,
        {
          width: HAMMER_SWOOSH.width,
          start: SWOOSH_START_SPEED,
          stop: SWOOSH_STOP_SPEED,
        },
      );
      showWeapons();
    })
    .catch((e) => console.error("hammer load failed", e));
}
function initMorningstar(parent) {
  const el = document.getElementById("morningstar-data");
  if (!el) return;
  const HD = JSON.parse(el.textContent);
  const fore = parent.getObjectByName(SWORD_HAND + "_Forearm"),
    hand = parent.getObjectByName("Adventurer_" + SWORD_HAND + "_Hand");
  if (!fore || !hand) {
    console.error("morningstar: hand bones not found");
    return;
  }
  parent.updateMatrixWorld(true);
  const hc = new THREE.Box3()
    .setFromObject(hand)
    .getCenter(new THREE.Vector3());
  fore.worldToLocal(hc);
  const D = Math.PI / 180,
    Y = new THREE.Vector3(0, 1, 0);
  // start from the sword's own mount (same pointing, same flat-on-its-side hold) ...
  const qS = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      SWORD_ROT_DEG[0] * D,
      SWORD_ROT_DEG[1] * D,
      SWORD_ROT_DEG[2] * D,
      "ZYX",
    ),
  );
  qS.premultiply(
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      SWORD_ROLL_DEG * D,
    ),
  );
  // ... then turn it a quarter about its handle, chosen the same way as the hammer's (the sword is wide along its x). The ball's spikes point the same way all round, so the quarter changes little; MORNINGSTAR_TURN_DEG is there to tweak it.
  const edge = new THREE.Vector3(0, 0, -1);
  let q = qS
    .clone()
    .multiply(new THREE.Quaternion().setFromAxisAngle(Y, Math.PI / 2));
  if (
    edge.clone().applyQuaternion(q).x * (SWORD_HAND === "Left" ? 1 : -1) <
    0
  )
    q = qS
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(Y, -Math.PI / 2));
  if (MORNINGSTAR_TURN_DEG)
    q.multiply(
      new THREE.Quaternion().setFromAxisAngle(Y, MORNINGSTAR_TURN_DEG * D),
    );
  const grp = new THREE.Group();
  grp.name = "Morningstar";
  grp.quaternion.copy(q);
  const grip = new THREE.Vector3(
    MORNINGSTAR_GRIP[0],
    MORNINGSTAR_GRIP[1],
    MORNINGSTAR_GRIP[2],
  ).applyQuaternion(q);
  grp.position
    .copy(hc)
    .sub(grip)
    .add(
      new THREE.Vector3(
        MORNINGSTAR_NUDGE[0],
        MORNINGSTAR_NUDGE[1],
        MORNINGSTAR_NUDGE[2],
      ),
    );
  Promise.all(HD.parts.map((p) => loadImg(p.tex)))
    .then((imgs) => {
      HD.parts.forEach((p, k) => {
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
        const hmat = ps1Mat(tex, 1);
        swordMats.push(hmat);
        // the same weapon color as the sword
        tintMat(hmat, swordMatch ? armorHex : swordHex);
        const m = new THREE.Mesh(geo, hmat);
        m.name = "morningstar_" + p.name;
        m.position.set(p.t[0], p.t[1], p.t[2]);
        m.rotation.order = "ZYX";
        m.rotation.set(p.r[0] * D, p.r[1] * D, p.r[2] * D);
        grp.add(m);
      });
      fore.add(grp);
      morningstarGrp = grp;
      swooshAddRig(
        "morningstar",
        grp,
        parent.getObjectByName(SWORD_HAND + "_Arm") || fore,
        MORNINGSTAR_SWOOSH.tip,
        MORNINGSTAR_SWOOSH.hilt,
        {
          width: MORNINGSTAR_SWOOSH.width,
          start: SWOOSH_START_SPEED,
          stop: SWOOSH_STOP_SPEED,
        },
      );
      showWeapons();
    })
    .catch((e) => console.error("morningstar load failed", e));
}
function applyAxeStyle() {
  if (axeGrp)
    axeGrp.children.forEach((m) => {
      if (m.name.indexOf("shovel_") === 0) m.visible = axeStyle === "shovel";
      else if (m.name.indexOf("axe_") === 0)
        m.visible = axeStyle !== "shovel";
    });
}
function toggleAxeStyle() {
  const o = ["axe", "shovel"].filter(owns);
  if (!o.length) return;
  axeStyle = o[(o.indexOf(axeStyle) + 1) % o.length];
  if (weapon !== "axe") setWeapon("axe");
  else showWeapons();
  refreshAnim();
}
function initShovel(grp) {
  // the shovel's meshes ride in the axe's own group, so they follow every bit of the axe's logic
  const el = document.getElementById("shovel-data");
  if (!el) return;
  const SD = JSON.parse(el.textContent);
  Promise.all(SD.parts.map((p) => loadImg(p.tex))).then((imgs) => {
    SD.parts.forEach((p, k) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(p.p, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(p.n, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(p.uv, 2));
      geo.setIndex(p.i);
      const tex = new THREE.Texture(imgs[k]);
      tex.flipY = false;
      const mat = ps1Mat(tex, 1);
      swordMats.push(mat);
      tintMat(mat, swordMatch ? armorHex : swordHex);
      const m = new THREE.Mesh(geo, mat);
      m.name = "shovel_" + p.name;
      grp.add(m);
    });
    applyAxeStyle();
  });
}
function toggleStyle() {
  const o = ["sword", "hatchet", "hammer", "knightly", "morningstar"].filter(
    owns,
  );
  // only styles you own
  swordStyle = o[(o.indexOf(swordStyle) + 1) % o.length] || "sword";
  if (weapon !== "sword") setWeapon("sword");
  // a sword style only shows on the light weapon, so changing it brings that one out
  else showWeapons();
  refreshAnim();
}
/* ---------- the Axe (axe-data: Blockbench glTF). Heavy weapon: held across the body with the AxeIdle pose.
 Its place on the left forearm was worked out from where both hands sit in AxeIdle: the shaft runs through both fists, the head out past his left hand,
 with the two blades pointing up and down. Fine-tune it with AXE_NUDGE (forearm space) and AXE_ROLL_DEG (turns the blades around the shaft). ---------- */
const AXE_NUDGE = [0, 0, 0];
/* Which hand is on top: true = the head is past his RIGHT hand, the right hand carries the axe and leads the swing, and the left hand is the lower one that follows.
 false = the original way round (head past the left hand, carried by the left forearm). AXE_MOUNT_R is the axe's place in the right forearm's space, worked out from AxeIdle
 so that the right fist sits at 1.366 along the handle and the left fist at 0.953 (both within 0.02 of the shaft). */
const AXE_HEAD_RIGHT = true,
  AXE_MOUNT_R = {
    p: [-1.25965, -0.92929, 0.54791],
    q: [-0.24072, -0.09709, -0.32458, 0.90955],
  // the original mount, worked out for the unmirrored idle
  };
const AXE_FLIP_ENDS = false,
  // true = the axe is turned end for end: the head ends up past his right hand instead of his left (butt past the left). The pivot is the middle of his two fists along the handle (right fist 0.953, left fist 1.366), so both hands stay on it. false = as before
  AXE_FLIP_PIVOT = 1.1595;
// turns the blades about the shaft: 90 = blades pointing front/back instead of up/down (0 = as before; 180 would look identical, the head is symmetric)
const AXE_ROLL_DEG = 90;
// AxeSwing plays backwards, so the arc sweeps the other way. The clip starts and ends on the same pose, so it still joins up cleanly. false = as before
const AXE_SWING_REVERSE = false;
function initAxe(parent) {
  const el = document.getElementById("axe-data");
  if (!el) return;
  const AD = JSON.parse(el.textContent),
    fore = parent.getObjectByName(
      AXE_HEAD_RIGHT ? "Right_Forearm" : "Left_Forearm",
    );
  if (!fore) {
    console.error("axe: forearm not found");
    return;
  }
  const grp = new THREE.Group();
  grp.name = "Axe";
  const MT = AXE_HEAD_RIGHT ? AXE_MOUNT_R : AD.mount;
  grp.quaternion.fromArray(MT.q);
  const mp = new THREE.Vector3(MT.p[0], MT.p[1], MT.p[2]);
  if (AXE_FLIP_ENDS && !AXE_HEAD_RIGHT) {
    // half-turn about the blade axis, pivoting on the middle of the two fists: head and butt trade places, the hands stay on the handle
    mp.add(
      new THREE.Vector3(0, 2 * AXE_FLIP_PIVOT, 0).applyQuaternion(
        grp.quaternion,
      ),
    );
    grp.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        Math.PI,
      ),
    );
  }
  if (AXE_ROLL_DEG)
    grp.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        (AXE_ROLL_DEG * Math.PI) / 180,
      ),
    );
  grp.position.set(
    mp.x + AXE_NUDGE[0],
    mp.y + AXE_NUDGE[1],
    mp.z + AXE_NUDGE[2],
  );
  grp.userData.hand = fore;
  grp.userData.back = parent.getObjectByName("Torso");
  {
    const th = (AXE_BACK_TILT_DEG * Math.PI) / 180,
      sx = AXE_BACK_SIDE * Math.sin(th),
      cy = Math.cos(th);
    const shaft = new THREE.Vector3(sx, cy, 0),
      blade = new THREE.Vector3(cy, -sx, 0),
      // handle, blade axis (across the handle, in the plane of his back), and the flat of the head facing backwards
      face = new THREE.Vector3(0, 0, -1);
    grp.userData.stowQ = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(face, shaft, blade),
    );
    grp.userData.stowP = new THREE.Vector3(
      AXE_BACK_AT[0],
      AXE_BACK_AT[1],
      AXE_BACK_AT[2],
    // 1.03 = half the handle's length, so AXE_BACK_AT is the middle of it
    ).addScaledVector(shaft, -1.03);
  }
  grp.userData.basePos = grp.position.clone();
  // the mount's own rotation; axePose() turns it to follow the arms and adds a turn about the shaft each frame
  grp.userData.baseQ = grp.quaternion.clone();
  Promise.all(AD.parts.map((p) => loadImg(p.tex)))
    .then((imgs) => {
      AD.parts.forEach((p, k) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(p.p, 3),
        );
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(p.n, 3));
        geo.setAttribute(
          "uv",
          new THREE.Float32BufferAttribute(
            insetIslandUV(
              p.uv,
              p.i,
              imgs[k].width,
              imgs[k].height,
              AXE_UV_INSET,
            ),
            2,
          ),
        // see insetIslandUV: stops neighbouring texels (the stray bits past the cut-outs) bleeding in at face edges
        );
        geo.setIndex(p.i);
        const tex = new THREE.Texture(imgs[k]);
        tex.flipY = false;
        const amat = ps1Mat(tex, 1);
        swordMats.push(amat);
        // follows the same weapon color as the sword
        tintMat(amat, swordMatch ? armorHex : swordHex);
        const m = new THREE.Mesh(geo, amat);
        m.name = "axe_" + p.name;
        m.position.set(p.t[0], p.t[1], p.t[2]);
        m.rotation.order = "ZYX";
        m.rotation.set(
          (p.r[0] * Math.PI) / 180,
          (p.r[1] * Math.PI) / 180,
          (p.r[2] * Math.PI) / 180,
        );
        grp.add(m);
      });
      grp.visible = weapon === "axe";
      fore.add(grp);
      axeGrp = grp;
      initShovel(grp);
      // The two-handed weapons use the SWORD's swoosh as it is (same path-following trail, same width and speeds, no alternating bits), with the markers taken from the shovel's model:
      // the tip is the top of the shovel, the hilt is one sword-blade length (SWOOSH_TIP_Y-SWOOSH_HILT_Y) below it, so the trail has the sword's proportions. The axe shares these markers.
      swooshAddRig(
        "axe",
        grp,
        parent.getObjectByName(
          (AXE_HEAD_RIGHT ? "Right" : "Left") + "_Arm",
        ) || fore,
        [0, SHOVEL_TOP_Y, 0],
        [0, SHOVEL_TOP_Y - (SWOOSH_TIP_Y - SWOOSH_HILT_Y), 0],
        {
          width: SWOOSH_WIDTH,
          start: SWOOSH_START_SPEED,
          stop: SWOOSH_STOP_SPEED,
          flag: 1.3,
        },
      );
      swooshUse();
      const mkHand = (side) => {
        const A = parent.getObjectByName(side + "_Arm"),
          F = parent.getObjectByName(side + "_Forearm"),
          Hd = parent.getObjectByName("Adventurer_" + side + "_Hand");
        if (!A || !F || !Hd) return null;
        parent.updateMatrixWorld(true);
        const hc = new THREE.Box3()
          .setFromObject(Hd)
          .getCenter(new THREE.Vector3());
        F.worldToLocal(hc);
        return { arm: A, fore: F, hc };
      };
      axeOff = mkHand(AXE_OFF_HAND);
    })
    .catch((e) => console.error("axe load failed", e));
}
/* Handedness and hands. The axe is held with the opposite handedness to the sword: while it is out the whole knight is mirrored left-to-right
 (the skeleton isn't symmetric, so swapping left/right animation tracks would not line up; mirroring the model is the exact way, and is what MIRROR_MODEL does).
 The top hand (the left forearm, which carries the axe) leads; the lower hand is solved every frame so it stays on the handle through the whole swing. */
// false = same handedness as the sword
const AXE_MIRROR = true;
// the lower hand
const AXE_OFF_HAND = AXE_HEAD_RIGHT ? "Left" : "Right";
let axeOff = null;
// true while the Block animation plays with the axe out: the model is turned back the other way round for it (see syncBlockFlip)
let blockFlipped = false;
function applyHandedness() {
  if (knightScene)
    knightScene.scale.x =
      (MIRROR_MODEL ? -1 : 1) *
      (AXE_MIRROR && weapon === "axe" ? -1 : 1) *
      (blockFlipped ? -1 : 1);
}
/* Block with the big axe is flipped: the model is already mirrored while the axe is out, and Block is turned the other way round again, so the guard happens on the opposite side from the sword's. Set BLOCK_FLIP_AXE=false to undo. */
const BLOCK_FLIP_AXE = true;
function syncBlockFlip() {
  const f = !!(
    BLOCK_FLIP_AXE &&
    weapon === "axe" &&
    current &&
    /^Block(Idle)?$/.test(current.getClip().name)
  );
  if (f !== blockFlipped) {
    blockFlipped = f;
    applyHandedness();
  }
}
/* The axe follows the arms, not the other way round. Nothing moves the arms any more: they play the animation as it is.
 The top grip stays where the mount puts it (in the right fist), and the whole axe is turned about that point so the handle runs through the left fist too.
 So the lower half of the axe goes wherever the left hand goes. It is used in AxeIdle, AxeSwing and Walk, and eased in and out over AXE_FOLLOW_EASE seconds so nothing pops. */
/* Stowed: during Flaunt, Death, Pose2 (sitting on the rock, including its look-around event) and Drinking_Potion the axe hangs on his back instead - flat against it, slung diagonally with the head up over one shoulder.
 Numbers are in the torso's space (x sideways, y up, z forward; his back is at about z -0.13): AXE_BACK_AT is where the middle of the handle lies, AXE_BACK_TILT_DEG how far
 the handle leans from upright, AXE_BACK_SIDE which shoulder the head is over (-1 = his right, 1 = his left). */
const AXE_STOW_CLIPS = [
    "Flaunt",
    "Death",
    "Pose2",
    "Pose2_randomevent",
    "Drinking_Potion",
    "UALX_ConsumeM",
    "Chestopen",
  ],
  AXE_BACK_AT = [0, 0.2, -0.175],
  AXE_BACK_TILT_DEG = 35,
  AXE_BACK_SIDE = -1;
const AXE_FOLLOW_ARMS = true,
  AXE_FOLLOW_EASE = 0.12,
  // AXE_TOP_GRIP: where the right fist holds the handle (axe units); false = the axe just rides the right forearm
  AXE_TOP_GRIP = 1.366;
/* The head's turn about the shaft is worked out live, so it can't end up facing the camera whatever pose the arms are in:
 in AxeIdle / Walk / anything but the swing, the blades are turned to point front and back, the way he faces (the head is symmetric, so either end is fine).
 In AxeSwing the mount's own roll is used; the turn is eased in and out over AXE_BLADES_EASE seconds. */
const AXE_BLADES_FRONT_BACK = true,
  // false = just use the mount's roll (AXE_ROLL_DEG)
  AXE_BLADES_EASE = 0.15;
const _aV = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ],
  _aQ = new THREE.Quaternion(),
  _aQ2 = new THREE.Quaternion(),
  _aY = new THREE.Vector3(0, 1, 0);
let axeRollK = 0,
  axeFollowK = 0,
  axeT = 0;
/* (Not used while 'AxeFlaunt' is in AXE_STOW_CLIPS: the axe stays on his back then. Kept as an option - remove it from AXE_STOW_CLIPS to get this back.)
 AxeFlaunt: the axe rests over the shoulder of the hand that carries it. The handle runs from that fist to a point just above the shoulder and on past it: AXE_SHOULDER_UP is how far above
 the shoulder joint (model units), AXE_OVER_SHOULDER how far the middle of the head sits beyond that point along the handle (more = the head hangs further behind him). */
const AXE_SHOULDER_UP = 0.16,
  AXE_OVER_SHOULDER = 0.6,
  AXE_SHOULDER_OUT = 0.1,
  // OUT / BACK move the resting point outward and behind the shoulder joint, so the haft lies on top of the shoulder and the head hangs behind his back
  AXE_SHOULDER_BACK = 0.15;
function axePose(nm) {
  const g = axeGrp,
    q0 = g.userData.baseQ,
    p0 = g.userData.basePos;
  if (!q0 || !p0 || !knightScene) return;
  const now = performance.now(),
    dt = Math.min(0.1, Math.max(0, (now - axeT) / 1000));
  axeT = now;
  const clamp = (v, s) => Math.max(-s, Math.min(s, v));
  const wantF =
    AXE_FOLLOW_ARMS &&
    (nm === "AxeIdle" ||
      nm === "AxeSwing" ||
      nm === "Walk" ||
      /^SwingHeavy/.test(nm))
      ? 1
      // (the SwingHeavy clips of RENDER too: the lower hand stays on the handle)
      : 0;
  axeFollowK += clamp(wantF - axeFollowK, dt / AXE_FOLLOW_EASE);
  const hand = g.userData.hand,
    back = g.userData.back;
  if (blockFlipped && /^Block(Idle)?$/.test(nm) && axeOff && axeOff.fore) {
    // the flipped Block turns the model round, so the axe moves to the other forearm to stay in the hand it is normally in on screen: the mount is mirrored across the forearm's length and its grip is put on that hand
    const lf = axeOff.fore;
    if (g.parent !== lf) lf.add(g);
    g.quaternion.set(q0.x, -q0.y, -q0.z, q0.w);
    g.position
      .copy(axeOff.hc)
      .sub(_aV[0].set(0, AXE_TOP_GRIP, 0).applyQuaternion(g.quaternion));
    axeFollowK = 0;
    return;
  }
  if (back && AXE_STOW_CLIPS.indexOf(nm) >= 0) {
    // on his back
    if (g.parent !== back) back.add(g);
    g.position.copy(g.userData.stowP);
    g.quaternion.copy(g.userData.stowQ);
    axeFollowK = 0;
    axeRollK = 0;
    return;
  }
  if (g.parent !== hand) hand.add(g);
  g.quaternion.copy(q0);
  g.position.copy(p0);
  // the bones exactly as the animation has just posed them
  knightScene.updateMatrixWorld(true);
  if (nm === "AxeFlaunt" || nm === FLAUNT_IDLE) {
    // the fist, in the forearm's space
    const G = _aV[0].set(0, AXE_TOP_GRIP, 0).applyQuaternion(q0).add(p0);
    const sh = knightScene.getObjectByName(
      AXE_HEAD_RIGHT ? "Right_Arm" : "Left_Arm",
    );
    if (sh) {
      const P = _aV[1];
      sh.getWorldPosition(P);
      {
        const tor = knightScene.getObjectByName("Torso"),
          o = _aV[3];
        if (tor) {
          tor.getWorldPosition(o);
          o.subVectors(P, o);
          o.y = 0;
          if (o.lengthSq() > 1e-6)
            P.addScaledVector(o.normalize(), AXE_SHOULDER_OUT);
        }
        const fw = knightScene.getWorldDirection(_aV[3]);
        fw.y = 0;
        if (fw.lengthSq() > 1e-6)
          P.addScaledVector(fw.normalize(), -AXE_SHOULDER_BACK);
      }
      P.y += AXE_SHOULDER_UP;
      // the top of the shoulder, in the forearm's space
      hand.worldToLocal(P);
      const d = _aV[2].subVectors(P, G),
        L = d.length();
      if (L > 1e-3) {
        d.divideScalar(L);
        const y0 = _aV[3].set(0, 1, 0).applyQuaternion(q0);
        // the handle points from the fist to the shoulder...
        g.quaternion.copy(_aQ.setFromUnitVectors(y0, d).multiply(q0));
        g.position
          .copy(G)
          // ...with the fist still on it, and the head just past the shoulder
          .addScaledVector(d, -(AXE_SWOOSH.mid - (L + AXE_OVER_SHOULDER)));
      }
    }
  } else if (axeFollowK > 0.001) {
    // the top grip, in the forearm's space
    const G = _aV[0].set(0, AXE_TOP_GRIP, 0).applyQuaternion(q0).add(p0);
    const L = _aV[1].copy(axeOff.hc);
    axeOff.fore.localToWorld(L);
    // the left fist, in the forearm's space
    hand.worldToLocal(L);
    const d = _aV[2].subVectors(G, L);
    if (d.lengthSq() > 1e-4) {
      d.normalize();
      const y0 = _aV[3].set(0, 1, 0).applyQuaternion(q0);
      // turn the axe about the top grip so the handle points from the left fist through the right
      _aQ.setFromUnitVectors(y0, d).multiply(q0);
      g.quaternion.copy(q0).slerp(_aQ, axeFollowK);
      g.position
        .copy(G)
        // keep the top grip where it was
        .sub(_aV[3].set(0, AXE_TOP_GRIP, 0).applyQuaternion(g.quaternion));
    }
  }
  const want =
    AXE_BLADES_FRONT_BACK && nm !== "AxeSwing" && nm !== "SwingHeavyRelease"
      ? 1
      : 0;
  axeRollK += clamp(want - axeRollK, dt / AXE_BLADES_EASE);
  if (axeRollK <= 0.001) return;
  hand.updateWorldMatrix(true, false);
  const base = g.quaternion,
    M = hand.matrixWorld,
    yW = _aV[0].set(0, 1, 0).applyQuaternion(base).transformDirection(M),
    // shaft and blade axis now, in the world
    bW = _aV[1].set(0, 0, 1).applyQuaternion(base).transformDirection(M);
  const f =
    nm === "AxeFlaunt" || nm === FLAUNT_IDLE
      ? _aV[2].set(0, 1, 0)
      : knightScene.getWorldDirection(_aV[2]);
  // the way he faces, across the shaft
  f.addScaledVector(yW, -f.dot(yW));
  if (f.lengthSq() < 1e-4) return;
  f.normalize();
  let phi = Math.atan2(yW.dot(_aV[3].crossVectors(bW, f)), bW.dot(f));
  if (phi > Math.PI / 2) phi -= Math.PI;
  else if (phi < -Math.PI / 2) phi += Math.PI;
  // a mirrored model turns the other way round
  if (M.determinant() < 0) phi = -phi;
  // a turn about the shaft, so the grip points don't move
  g.quaternion.multiply(_aQ2.setFromAxisAngle(_aY, phi * axeRollK));
}
/* ---------- Drinking_Potion: the potion in his left hand ----------
 potion-data is the bottle (potions.gltf), drinkpotion-data the clip. In the clip his left hand reaches back to the belt, comes round to the front (its lowest point is at 0.775 s) and then rises to his mouth.
 The bottle is NOT in his hand while the hand goes down for it: it only appears once the hand starts coming back up (POTION_OUT_AT), growing to full size over POTION_POP seconds like it is being pulled out,
 and it is gone again when the clip ends or another one starts. */
const POTION_OUT_AT = 0.78,
  // seconds into Drinking_Potion when the bottle appears, and how long it takes to grow to full size
  POTION_POP = 0.12;
const POTION_SCALE = 0.8,
  // size (1 = as modeled) and the point of the bottle that sits in his fist (lower body)
  POTION_PIVOT_Y = 1.34;
// where the neck points, in forearm space: roughly along the thumb side so it tips toward his mouth at the end of the clip
const POTION_NECK = [-0.35, 0.3, 0.88];
let potionGrp = null,
  drinkEndAt = null,
  potionKind = "heal",
  // potionKind: 'heal' (red) or 'haste' (green): which bottle is in his hand
  potionVariants = null;
function initPotion(parent) {
  const el = document.getElementById("potion-data");
  if (!el) return;
  const F = parent.getObjectByName("Left_Forearm"),
    Hd = parent.getObjectByName("Adventurer_Left_Hand");
  if (!F || !Hd) return;
  parent.updateMatrixWorld(true);
  const hc = new THREE.Box3()
    .setFromObject(Hd)
    .getCenter(new THREE.Vector3());
  // middle of his fist, in forearm space
  F.worldToLocal(hc);
  try {
    const raw = (function () {
      const t = atob(el.textContent.trim()),
        u = new Uint8Array(t.length);
      for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
      return u.buffer;
    // the bottle is embedded as a binary glb (a data: url buffer gets blocked)
    })();
    new THREE.GLTFLoader().parse(
      raw,
      "",
      (g) => {
        const cache = new Map();
        /* The glass texture is white at only ~37% alpha, and the game's shader throws away anything under 50% (that is why the bottle, rim and cork went missing and only the liquid showed).
       Any texture that is see-through all over is drawn as real translucent glass instead: kept down to a faint alpha, blended over what is behind it, and not written to the depth buffer so the liquid shows through. */
        const texAlpha = (img) => {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const x = c.getContext("2d");
          x.drawImage(img, 0, 0);
          const d = x.getImageData(0, 0, c.width, c.height).data;
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
            cache.set(om.uuid, m);
          }
          o.material = cache.get(om.uuid);
          o.renderOrder = o.material.userData.glass ? 2 : 0;
          o.frustumCulled = false;
        });
        g.scene.position.y = -POTION_PIVOT_Y;
        /* HASTE POTION: a copy of the bottle whose liquid texture is recoloured from red to green (red and green channels swapped, blue dimmed). The glass is shared with the red bottle. */
        const hasteScene = g.scene.clone(true);
        hasteScene.visible = false;
        hasteScene.traverse((o) => {
          if (!o.isMesh || o.material.userData.glass) return;
          const mp =
            o.material.uniforms &&
            o.material.uniforms.map &&
            o.material.uniforms.map.value;
          if (!mp || !mp.image) return;
          const im = mp.image,
            c = document.createElement("canvas");
          c.width = im.width;
          c.height = im.height;
          const x = c.getContext("2d");
          x.drawImage(im, 0, 0);
          const id = x.getImageData(0, 0, c.width, c.height),
            d = id.data;
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i],
              gg = d[i + 1],
              b = d[i + 2];
            d[i] = gg * 0.9;
            d[i + 1] = r;
            d[i + 2] = b * 0.8;
          }
          x.putImageData(id, 0, 0);
          const t = new THREE.Texture(c);
          t.flipY = mp.flipY;
          t.wrapS = mp.wrapS;
          t.wrapT = mp.wrapT;
          t.magFilter = mp.magFilter;
          t.minFilter = mp.minFilter;
          t.needsUpdate = true;
          o.material = ps1Mat(t, 1);
        });
        potionVariants = { heal: g.scene, haste: hasteScene };
        const hold = new THREE.Group();
        hold.add(g.scene);
        hold.add(hasteScene);
        hold.position.copy(hc);
        hold.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3().fromArray(POTION_NECK).normalize(),
        );
        hold.scale.setScalar(POTION_SCALE);
        hold.visible = false;
        F.add(hold);
        potionGrp = hold;
      },
      (e) => console.error("potion load failed", e),
    );
  } catch (e) {
    console.error("potion failed", e);
  }
}
/* End of the clip: it plays once and holds its last pose (the bottle at his lips) for DRINK_HOLD seconds, then he goes back to Idle. */
const DRINK_HOLD = 0.9;
/* While he drinks the sword hangs at his waist (his sword hand is the one with the bottle). Numbers are in the hips' space (x sideways, y up, z forward; the right hip is -x):
 WAIST_AT is where the grip sits, WAIST_DIR where the blade points (down and a little back), WAIST_ROLL_DEG turns it about the blade so the flat lies against his leg. The hatchet is put away (hidden) instead: it is too long to hang from a belt. */
const WAIST_CLIPS = ["Drinking_Potion", "UALX_ConsumeM"],
  WAIST_AT = [-0.27, 0.1, 0.0],
  WAIST_DIR = [0, -1, -0.28],
  WAIST_ROLL_DEG = 90;
/* Every light weapon hangs at the waist the same way: each is held by a point on its handle (grip, in the weapon's own space), turned about its length by roll, and nudged out sideways by out (heads that stick out of the handle need room, or they sink into his leg).
 The grip points are chosen so every weapon's lowest end hangs as deep as the sword's tip does (it never reaches the floor); the hatchet's head points forward, the hammer's and the morningstar's sit along his leg. */
const WAIST_HANG = {
  sword: {
    grp: () => swordGrp,
    grip: [0, SWORD_GRIP_Y, 0],
    roll: WAIST_ROLL_DEG,
    out: 0,
  },
  knightly: {
    grp: () => knightlyGrp,
    grip: [0, SWORD_GRIP_Y, 0],
    roll: WAIST_ROLL_DEG,
    out: 0,
  // (the knightly sword has the sword's shape)
  },
  hatchet: {
    grp: () => hatchetGrp,
    grip: [0, 0.95, 0],
    roll: 180,
    out: 0.02,
  },
  hammer: {
    grp: () => hammerGrp,
    grip: [0, 0.52, 0.125],
    roll: 0,
    out: 0.08,
  },
  morningstar: {
    grp: () => morningstarGrp,
    grip: [0, 0.62, 0],
    roll: 0,
    out: 0.12,
  },
};
function waistStep(stow) {
  const hips = knightScene && knightScene.getObjectByName("Root_Hips");
  if (!hips) return;
  const Y = new THREE.Vector3(0, 1, 0);
  Object.keys(WAIST_HANG).forEach((key) => {
    const H = WAIST_HANG[key],
      g = H.grp();
    if (!g) return;
    if (stow) {
      if (!g.userData.home)
        g.userData.home = {
          parent: g.parent,
          p: g.position.clone(),
          q: g.quaternion.clone(),
        };
      if (g.parent !== hips) {
        const q = new THREE.Quaternion()
          .setFromUnitVectors(
            Y,
            new THREE.Vector3().fromArray(WAIST_DIR).normalize(),
          )
          .multiply(
            new THREE.Quaternion().setFromAxisAngle(
              Y,
              (H.roll * Math.PI) / 180,
            ),
          );
        hips.add(g);
        g.quaternion.copy(q);
        g.position
          .set(WAIST_AT[0] - H.out, WAIST_AT[1], WAIST_AT[2])
          .sub(new THREE.Vector3().fromArray(H.grip).applyQuaternion(q));
      }
    } else if (g.userData.home && g.parent !== g.userData.home.parent) {
      const h = g.userData.home;
      h.parent.add(g);
      g.position.copy(h.p);
      g.quaternion.copy(h.q);
    }
  });
}
function potionStep() {
  const c = current && current.getClip().name,
    drinking = c === "Drinking_Potion";
  waistStep(!!current && WAIST_CLIPS.indexOf(c) >= 0 && weapon === "sword");
  if (drinking) {
    // the bottle reaches his mouth: the two sounds play one after the other, once per drink
    if (current.time < POTION_MOUTH_AT - 0.05) potionSfxDone = false;
    else if (!potionSfxDone && current.time >= POTION_MOUTH_AT) {
      potionSfxDone = true;
      playPotionSfx();
    }
  } else potionSfxDone = false;
  if (drinking && current.time >= current.getClip().duration - 1e-4) {
    // finished: hold, then back to Idle
    const now = performance.now();
    if (drinkEndAt === null) drinkEndAt = now;
    else if (now - drinkEndAt >= DRINK_HOLD * 1000) {
      drinkEndAt = null;
      play(idleName());
      return;
    }
  } else drinkEndAt = null;
  invDrinkStep();
  if (!potionGrp) return;
  const insp = invDrink.on && c === "UALX_ConsumeM";
  const k = drinking
    ? Math.min(1, Math.max(0, (current.time - POTION_OUT_AT) / POTION_POP))
    : insp
      ? Math.min(
          1,
          Math.max(0, (current.time - INV_DRINK_OUT_AT) / POTION_POP),
        )
      : 0;
  {
    const g = potionGrp,
      P = g.parent;
    if (!g.userData.q0) {
      g.userData.q0 = g.quaternion.clone();
      g.userData.n0 = new THREE.Vector3().fromArray(POTION_NECK).normalize();
    }
    if (insp && P) {
      P.updateWorldMatrix(true, false);
      const up = _invUp
        .set(0, 1, 0)
        // world 'up', in the forearm's space (works with the mirrored model)
        .transformDirection(_invInv.copy(P.matrixWorld).invert());
      g.quaternion.setFromUnitVectors(
        _invY.set(0, 1, 0),
        _invDir.copy(g.userData.n0).lerp(up, INV_DRINK_TILT).normalize(),
      );
    // the neck tilts toward straight up
    }
    else g.quaternion.copy(g.userData.q0);
  // (battle drinking keeps its own angle)
  }
  if (potionVariants) {
    potionVariants.heal.visible = potionKind !== "haste";
    potionVariants.haste.visible = potionKind === "haste";
  }
  if (sparkle)
    sparkle.material.color.set(potionKind === "haste" ? 0x9dffb0 : 0xffffff);
  potionGrp.visible = k > 0;
  if (k > 0) potionGrp.scale.setScalar(POTION_SCALE * (0.35 + 0.65 * k));
  sparkleStep(k > 0);
}
/* ---------- the potion's sound and sparkle ----------
 SOUND: when the bottle reaches his mouth (POTION_MOUTH_AT, seconds into Drinking_Potion: the same moment the heal lands) two files play one right after the other:
 SWAV_9_swav.wav, then 34.wav the instant the first one ends. They are embedded as potion-sfx-data and go through the same sound path (and the same crush option) as the other effects.
 POTION_SFX_GAIN balances them: the first file is much louder than the second.
 SPARKLE: sparkle1.gif (6 frames, packed into the strip below) floats right above the bottle for as long as the bottle is in his hand, always facing the camera. */
const POTION_MOUTH_AT = 1.5,
  POTION_SFX_GAIN = [0.5, 1.0];
const SPARKLE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAAAYCAYAAAAVpXQNAAABL0lEQVR42u2ZwQ6CMAyGC9mBaDT6DJx5/zfw5okzr6BEIuE2T0sWiWFAO1b5vxMI67p/bccmEQAAAAAAAGA9dTNYjnck2++hDw22c6QLYA2guhls1/bi0S/dB4ij/yiAqrLITpcDVWWRSTr/er5pahBrBqg9EaRsc+sffQlzAXq+HkkyUEEc/c2vTkKzY4kDVVlkS9uGfhy6LPN/4+zPz2R3z2E/hv+c+ptUhOPMMF/0qSyb6//3BHdtP3q2Rg9p/7kxWwknXeViBSgRqVyOufQ3qQnHVcIll0nffkiV2HqZkdTfpCjcnBKuZdusZQzR9Ndwyju1Ra2bwd7uD+uupXyUsM3l/2ZzjL8iwtr7k6xNoyTPgfZ67vKv51156uJr381oD36UAAAAAAAAAJj5AGwws9zOHmmpAAAAAElFTkSuQmCC";
const SPARKLE_FRAMES = 6,
  SPARKLE_FRAME_MS = 170,
  SPARKLE_SIZE = 0.3,
  SPARKLE_LIFT = 0.2,
  // size/lift in world units; POTION_TOP_Y = the bottle's rim above its pivot
  POTION_TOP_Y = 0.207;
let potionSfxDone = false,
  sparkle = null,
  sparkleLoading = false;
const _sparkP = new THREE.Vector3();
function playPotionSfx() {
  try {
    if (!sfx) return;
    const st = SFX_SETS["potion-sfx-data"];
    if (!st || !st.bufs) {
      const l = loadSfxSet("potion-sfx-data");
      loadSfxSet("v2-sword-sfx-data");
      loadSfxSet("v2-block-sfx-data");
      loadSfxSet("v2-grunt-data");
      loadSfxSet("v2-die-data");
      loadSfxSet("v2-flaunt-sfx-data");
      loadSfxSet("slime-atk-sfx-data");
      loadSfxSet("slime-hit-sfx-data");
      loadSfxSet("slime-die-sfx-data");
      loadSfxSet("slime-win-sfx-data");
      if (l)
        l.then(() => {
          const q = SFX_SETS["potion-sfx-data"];
          if (q && q.bufs) playPotionSfx();
        });
      return;
    }
    playSfxSet("potion-sfx-data", 0, POTION_SFX_GAIN[0], 1, 0);
    playSfxSet(
      "potion-sfx-data",
      1,
      POTION_SFX_GAIN[1],
      1,
      st.bufs[0].duration,
    // starts exactly as the first one ends
    );
  } catch (_) {}
}
function sparkleStep(show) {
  if (!sparkle) {
    if (show && !sparkleLoading) {
      sparkleLoading = true;
      loadImg(SPARKLE_PNG)
        .then((img) => {
          const t = new THREE.Texture(img);
          t.magFilter = t.minFilter = THREE.NearestFilter;
          t.generateMipmaps = false;
          t.repeat.set(1 / SPARKLE_FRAMES, 1);
          t.needsUpdate = true;
          const sp = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: t,
              alphaTest: 0.5,
              fog: false,
              depthWrite: false,
            }),
          );
          sp.scale.set(SPARKLE_SIZE, SPARKLE_SIZE, 1);
          sp.visible = false;
          sp.renderOrder = 6;
          scene.add(sp);
          sparkle = sp;
        })
        .catch((e) => console.error("sparkle failed", e));
    }
    return;
  }
  sparkle.visible = show;
  if (!show || !potionGrp) return;
  potionGrp.updateWorldMatrix(true, false);
  sparkle.position.copy(
    potionGrp.localToWorld(_sparkP.set(0, POTION_TOP_Y, 0)),
  );
  // straight above the rim, whichever way the bottle tips
  sparkle.position.y += SPARKLE_LIFT;
  sparkle.material.map.offset.x =
    (Math.floor(performance.now() / SPARKLE_FRAME_MS) % SPARKLE_FRAMES) /
    SPARKLE_FRAMES;
}
