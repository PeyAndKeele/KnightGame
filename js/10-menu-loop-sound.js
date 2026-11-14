// Start screen, main loop, main menu, sound effects, see-through obstacles.
// (Part 10 of 14. All parts share one scope; see README.)

/* ---------- start screen: now and then he looks up and glances around at the sky ----------
 Most of the time his head just plays Pose3 as authored (bowed, a tiny sway). Every so often it lifts a little, glances one way, then the other, and lowers again (about 9.6 s),
 one slow move after another with no extra wobble. This is added on top of the animation, only while the start pose is playing.
 up = how far the head tips back beyond the pose (radians; 0.5 is about 29 degrees), side = how far it turns each way, gapMin/gapMax = seconds between looks,
 first = seconds before the first one. Each look varies a little in size (+-15%) and in which way it goes first. LOOK_KEYS is the whole move: time (s), how far up (0..1),
 which way (-1..1); the head eases to rest at every key, so the moves stay slow and smooth. */
const START_LOOK = { up: 0.5, side: 0.3, gapMin: 9, gapMax: 20, first: 5 };
const LOOK_KEYS = [
  [0, 0, 0],
  [1.6, 1, 0],
  [3.2, 1, -1],
  [5.0, 1, -1],
  [6.8, 1, 0.8],
  [8.2, 1, 0],
  [9.6, 0, 0],
];
let lookT = -1,
  lookNext = START_LOOK.first,
  lookAmp = 1,
  lookDir = 1,
  lookHead = null,
  lookInt = null,
  lookInit = false;
const lookBase = new THREE.Quaternion(),
  lookQ = new THREE.Quaternion(),
  lookOut = new THREE.Quaternion(),
  lookE = new THREE.Euler();
function lookAt(t) {
  for (let i = 0; i < LOOK_KEYS.length - 1; i++) {
    const a = LOOK_KEYS[i],
      b = LOOK_KEYS[i + 1];
    if (t <= b[0]) {
      let f = (t - a[0]) / (b[0] - a[0]);
      f = f * f * (3 - 2 * f);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return [0, 0];
}
function headLook(dt, stepped) {
  if (!current || current.getClip().name !== START_CLIP) {
    if (lookHead && lookT >= 0) lookHead.quaternion.copy(lookBase);
    lookT = -1;
    lookHead = null;
    lookInt = null;
    return;
  // leaving the start pose mid-look: put the head back first
  }
  if (!lookHead) {
    const tr = current
      .getClip()
      .tracks.find((t) => /^Head(_\d+)?\.quaternion$/.test(t.name));
    lookHead = tr
      ? knightScene.getObjectByName(tr.name.replace(".quaternion", ""))
      : null;
    if (!lookHead) return;
    lookInt = tr.createInterpolant();
    lookT = -1;
    lookNext = START_LOOK.first;
  }
  if (lookT < 0) {
    lookNext -= dt;
    if (lookNext > 0) return;
    lookT = 0;
    lookAmp = 0.85 + Math.random() * 0.3;
    lookDir = Math.random() < 0.5 ? -1 : 1;
    lookInit = true;
  }
  lookT += dt;
  /* The head is only re-posed on the frames where the rest of him is (every step in the PS1 look, every frame in the modern one) and held in between, so in the PS1 look it
   moves on the same 15 fps beat as the body instead of on a clock of its own - two beats out of step with each other looked like jitter. */
  if (stepped || lookInit) {
    lookInit = false;
    /* The plain pose comes from the clip's own head track at the clip's current time, NOT from the bone. The mixer only writes a bone when its animated value changes, and Pose3's
     head holds one value for over two seconds, so during those frames the bone still carries our own offset from the last frame: reading it back as "the pose" piled the
     offset up again every step and the head spun. Sampling the track gives the true pose every time. */
    const bq = lookInt.evaluate(current.time);
    lookBase.set(bq[0], bq[1], bq[2], bq[3]);
    if (lookT >= LOOK_KEYS[LOOK_KEYS.length - 1][0]) {
      lookT = -1;
      lookNext =
        START_LOOK.gapMin +
        Math.random() * (START_LOOK.gapMax - START_LOOK.gapMin);
      lookHead.quaternion.copy(lookBase);
      // back to the plain pose
      return;
    }
    const la = lookAt(lookT);
    lookQ.setFromEuler(
      lookE.set(
        START_LOOK.up * la[0] * lookAmp,
        START_LOOK.side * la[1] * lookDir * lookAmp,
        0,
        "YXZ",
      ),
    );
    lookOut.copy(lookBase).multiply(lookQ);
  }
  lookHead.quaternion.copy(lookOut);
}
/* ---------- loop ---------- */
const STEP = 1 / 15;
let acc = 0,
  last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (spin && !paused && !mapMode && !startScr) yaw += dt * 0.6;
  if (exploring && !paused && playerRig) {
    if (dungeon) dungeonStep(dt);
    else exploreStep(dt);
  }
  if (
    !paused &&
    !evtPlaying &&
    current &&
    current.getClip().name === SEAT_CLIP &&
    actions[EVT_CLIP]
  ) {
    evtClock += dt;
    if (evtClock >= evtNext) evtDue = true;
  }
  if (mixer && !paused) {
    acc += dt;
    let stepped = false;
    danceStep();
    if (ps1) {
      if (acc >= STEP) {
        const n = Math.floor(acc / STEP);
        stepMixer(n * STEP);
        stepEnemies(n * STEP);
        acc -= n * STEP;
        stepped = true;
      }
    } else {
      stepMixer(acc);
      stepEnemies(acc);
      acc = 0;
      stepped = true;
    }
    headLook(dt, stepped);
    if (evtDone) {
      evtDone = false;
      endEvt();
    }
    if (evtGo) {
      evtGo = false;
      startEvt();
    }
    if (swingDone) {
      swingDone = false;
      endSwing();
    }
    if (flauntDone) {
      flauntDone = false;
      if (current === actions.AxeFlaunt) play(FLAUNT_IDLE);
    // AxeFlaunt has played through: carry on into its idle instead of freezing on the last frame
    }
  }
  if (!paused) {
    updateShine(dt);
    updateComboSparks(dt);
    updateSky(dt);
    updateNight(dt);
    updateHelm6Face(dt);
    updateSnow(dt);
    updateLeaves(dt);
    updateSwoosh(dt);
    updateFire(dt);
    footstepStep();
    updateShopLamp();
    updateMapRuins();
    applyFogThickness();
    updateMagma(dt);
    inspectStep(dt);
    applyAreaFog();
  }
  shopSync();
  // the map places the camera itself; when it has closed (mapMode false again) the orbit camera below takes over in the same frame
  if (mapMode) mapStep(dt);
  if (!mapMode) {
    // the inventory zoom
    invStep(dt);
    // the EDIT mode's camera
    editStep(dt);
    const d = (camera.userData.fit || 5) * zoom,
      cp = Math.cos(pitch);
    camera.position.set(
      target.x + d * Math.sin(yaw) * cp,
      target.y + d * Math.sin(pitch),
      target.z + d * Math.cos(yaw) * cp,
    );
    camera.lookAt(target);
    // EDIT: tilted shots
    if (editOn) camera.rotateZ(editRoll);
  }
  // where the characters are on screen, for the see-through obstacles
  occUpdate();
  if (inspect.it && inspect.k > 0.002) inspectRender();
  else renderer.render(scene, camera);
  if (dungeon) barsUpdate(dt);
}
requestAnimationFrame(frame);

/* ---------- main menu ---------- */
let sfx = null;
/* ---------- hit grunts: Harry Mason's pain grunts from Silent Hill (Konami). One of the three, picked at random, plays whenever an enemy knight is struck.
 They are embedded in grunt-data (3 small wavs) and decoded on the first menu sound, so they are ready by the time a fight starts. ---------- */
let gruntBufs = null,
  gruntLoading = null;
function loadGrunts() {
  if (gruntLoading || !sfx) return gruntLoading;
  try {
    const list = JSON.parse(
      document.getElementById("grunt-data").textContent,
    );
    gruntLoading = Promise.all(
      list.map((b) => {
        const t = atob(b),
          u = new Uint8Array(t.length);
        for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
        return sfx.decodeAudioData(u.buffer);
      }),
    )
      .then((a) => {
        gruntBufs = a;
      })
      .catch((e) => {
        gruntLoading = null;
        console.error("grunts failed", e);
      });
  } catch (e) {
    console.error(e);
  }
  return gruntLoading;
}
/* ---------- walking + sword sounds, and the animation-test sounds ----------
 step-data: SL_00016 (Digimon World), one walking sound that holds two footfalls ~0.28 s apart, so it plays once per Walk loop, on the first footfall.
 sword-sfx-data: SD_SWORD_00000 / 00005 / 00006 (Castlevania), one of them at random on every swing, timed so the whoosh lands on the chop.
 Both are decoded on the first menu sound, like the grunts. ANIM_SFX lists every dungeon sound that belongs to an animation, so the ANIMATIONS test screen can play them too. */
const SFX_SETS = {};
function loadSfxSet(id) {
  const s = SFX_SETS[id] || (SFX_SETS[id] = { bufs: null, loading: null });
  if (s.loading || !sfx) return s.loading;
  try {
    const list = JSON.parse(document.getElementById(id).textContent);
    s.loading = Promise.all(
      list.map((b) => {
        const t = atob(b),
          u = new Uint8Array(t.length);
        for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
        return sfx.decodeAudioData(u.buffer);
      }),
    )
      .then((a) => {
        s.bufs = a;
      })
      .catch((e) => {
        s.loading = null;
        console.error(id + " failed", e);
      });
  } catch (e) {
    console.error(e);
  }
  return s.loading;
}
function playSfxSet(id, i, gain, rate, delay) {
  try {
    if (!sfx) return;
    const s = SFX_SETS[id];
    if (!s || !s.bufs) {
      const l = loadSfxSet(id),
        t0 = performance.now();
      if (l)
        l.then(() => {
          if (
            performance.now() - t0 < 1500 &&
            SFX_SETS[id] &&
            SFX_SETS[id].bufs
          )
            playSfxSet(id, i, gain, rate, delay);
        });
      return;
    // not decoded yet: play it the moment it is (if that is soon enough to still make sense)
    }
    sfx.resume();
    const src = sfx.createBufferSource(),
      g = sfx.createGain();
    src.buffer = cz(s.bufs[i]);
    src.playbackRate.value = rate || 1;
    g.gain.value = gain;
    src.connect(g);
    g.connect(sfx.destination);
    src.start(sfx.currentTime + (delay || 0));
  } catch (_) {}
}
/* Voice 2 (the female lines) was recorded much hotter than voice 1. Each gain below is set so that a voice 2 line comes out at the same average (RMS) level as its voice 1 counterpart,
 measured on the files as they play: grunt -3.2 dB, death grunt -2.4 dB, flaunt -4.2 dB, sword shout -4.9 dB, block shout -7.3 dB (each relative to the old 0.9 / 1.0 / 0.85 / 0.9). Raise one to make it louder. */
const V2_GRUNT_GAIN = 0.63,
  V2_DIE_GAIN = 0.68,
  V2_FLAUNT_GAIN = 0.62,
  V2_SWORD_GAIN = 0.485,
  V2_BLOCK_GAIN = 0.39;
const SWORD_GAIN = 0.75,
  SWORD_ONSET = [0.34, 0, 0],
  // SWORD_ONSET: where the whoosh starts inside each file; SWORD_CHOP_T: clip time of the chop in the Swing animation
  SWORD_CHOP_T = 0.36;
const KNIFE_GAIN = 0.8,
  // knife-sfx-data: FUEL_VAB_00000 knife swing, layered on every swing (sword and axe); KNIFE_PEAK = where its loudest hit sits inside the file
  KNIFE_PEAK = 0.045;
const V2_SWORD_ONSET = [0.013, 0.015, 0.013];
/* ---------- swing swishes (swish-sfx-data: wpn_swish_medium_01..03 + wpn_swish_large_01) ----------
 Light weapons (sword, knightly sword, hatchet) play one of the three medium swishes; the heavy class (axe, shovel, hammer, morningstar) plays the large one.
 Each is timed so the loudest part of the swish (SWISH_PEAK: seconds into the file) lands on the chop of the swing animation (SWISH_CHOP_T: clip time of the chop, ~0.40 s in Swing and AxeSwing).
 Mediums come out of a shuffled bag, so none repeats until all three have played. The original sword sounds still play with them. */
const SWISH_GAIN = 0.85,
  SWISH_CHOP_T = 0.4,
  // SWISH_PEAK order: medium 1, 2, 3, large
  SWISH_PEAK = [0.174, 0.142, 0.103, 0.222];
let swishBag = [],
  swishLast = -1,
  swishLive = [];
function swishNext() {
  // the next medium swish (0..2): a shuffled bag of the three, never the same one twice running
  if (!swishBag.length) {
    swishBag = [0, 1, 2];
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [swishBag[i], swishBag[j]] = [swishBag[j], swishBag[i]];
    }
    if (swishBag[swishBag.length - 1] === swishLast) {
      const j = Math.floor(Math.random() * (swishBag.length - 1));
      [swishBag[swishBag.length - 1], swishBag[j]] = [
        swishBag[j],
        swishBag[swishBag.length - 1],
      ];
    // the next one popped must not repeat the last played
    }
  }
  return (swishLast = swishBag.pop());
}
function swishHeavy() {
  return (
    weapon === "axe" ||
    swordStyle === "hammer" ||
    swordStyle === "morningstar"
  );
// the heavy weapon class
}
function playSwish(i, delay) {
  // i: 0..2 medium, 3 large; delay: seconds from now until the swish STARTS
  try {
    if (!sfx) return;
    const s = SFX_SETS["swish-sfx-data"];
    if (!s || !s.bufs) {
      const l = loadSfxSet("swish-sfx-data"),
        t0 = performance.now();
      if (l)
        l.then(() => {
          const left = (delay || 0) - (performance.now() - t0) / 1000;
          if (
            left > -0.15 &&
            SFX_SETS["swish-sfx-data"] &&
            SFX_SETS["swish-sfx-data"].bufs
          )
            playSwish(i, Math.max(0, left));
        });
      return;
    }
    sfx.resume();
    const src = sfx.createBufferSource(),
      g = sfx.createGain();
    src.buffer = cz(s.bufs[i]);
    g.gain.value = SWISH_GAIN;
    src.connect(g);
    g.connect(sfx.destination);
    src.start(sfx.currentTime + Math.max(0, delay || 0));
    swishLive.push(src);
    src.onended = () => {
      const k = swishLive.indexOf(src);
      if (k >= 0) swishLive.splice(k, 1);
    };
  } catch (_) {}
}
function playSfxSetTracked(id, i, gain, rate, delay) {
  // like playSfxSet, but the sound can be cancelled by swishStopAll (the combo finisher: switching animation must not leave it waiting)
  try {
    const st = SFX_SETS[id];
    if (!sfx || !st || !st.bufs) {
      playSfxSet(id, i, gain, rate, delay);
      return;
    }
    sfx.resume();
    const src = sfx.createBufferSource(),
      g = sfx.createGain();
    src.buffer = cz(st.bufs[i]);
    src.playbackRate.value = rate || 1;
    g.gain.value = gain;
    src.connect(g);
    g.connect(sfx.destination);
    src.start(sfx.currentTime + (delay || 0));
    swishLive.push(src);
    src.onended = () => {
      const k = swishLive.indexOf(src);
      if (k >= 0) swishLive.splice(k, 1);
    };
  } catch (_) {}
}
function swishStopAll() {
  swishLive.forEach((x) => {
    try {
      x.stop();
    } catch (_) {}
  });
  swishLive.length = 0;
// switching animation cancels swishes still waiting for their swing
}
function playSwordOld(ts, chop) {
  // the original swing sounds: the whoosh (or voice 2's shout) plus the knife layer. chop: clip time the whoosh should land on (default SWORD_CHOP_T, the knight's Swing)
  const i = Math.floor(Math.random() * 3),
    c = (chop === undefined ? SWORD_CHOP_T : chop) / (ts || 1);
  if (voice === "voice2")
    playSfxSet(
      "v2-sword-sfx-data",
      i,
      V2_SWORD_GAIN,
      1,
      Math.max(0, c - V2_SWORD_ONSET[i]),
    );
  else
    playSfxSet(
      "sword-sfx-data",
      i,
      SWORD_GAIN,
      1,
      Math.max(0, c - SWORD_ONSET[i]),
    );
  playSfxSet("knife-sfx-data", 0, KNIFE_GAIN, 1, Math.max(0, c - KNIFE_PEAK));
}
function playSword(ts) {
  // every swing: the original sounds, with the class swish played alongside them
  playSwordOld(ts);
  const i = swishHeavy() ? 3 : swishNext();
  playSwish(
    i,
    Math.max(0, SWISH_CHOP_T / (ts || 1) - SWISH_PEAK[i] / (ts || 1)),
  );
}
/* The UAL swings. Every swing in a clip gets BOTH the original swing sounds (whoosh + knife, landing as the blade starts to move fast) AND the next medium swish from the bag (its loudest part on the fastest moment),
 one swing after the other, so the combos never repeat a swish until all three have played. SWISH_COMBO lists each swing as [start, peak]: the clip times (s) where the blade tip gets fast and where it is fastest,
 read off the tip's speed with the sword mounted as in the game (the same speed test the swing trail uses). Swing2 itself works out at start 0.34 / peak 0.41, which is where SWORD_CHOP_T / SWISH_CHOP_T come from. */
const SWISH_COMBO = {
  UAL_Sword_Regular_A: [[0.167, 0.267]],
  UAL_Sword_Regular_B: [[0.208, 0.242]],
  UAL_Sword_Regular_C: [
    [0.22, 0.283],
    [0.558, 0.742],
  ],
  UAL_Melee_Hook: [[0.15, 0.233]],
  UAL_Sword_Regular_Combo: [
    [0.167, 0.267],
    [0.667, 0.742],
    [1.1, 1.267],
    [1.483, 1.533],
  ],
  HeavyCombo: [
    [0.333, 0.517],
    [0.967, 1.017],
    [1.108, 1.192],
    [1.692, 1.742],
    [1.82, 1.9],
    [2.0, 2.108],
  ],
};
// clip time the Heavy Combo's finishing blow slams the sword into the floor (after the stab at ~2.17 he leaps and brings it down; the lowest point of the blade drops from 0.5 above the floor at 2.62 to 0.2 at 2.66 and stays there): the bluntflesh hit and one of the four attack sounds land here. The clip carries on with ~1.7 s of recovery after it
const HEAVY_COMBO_FINISH_T = 2.66;
function playSwishClip(n) {
  const T = SWISH_COMBO[n];
  if (!T) {
    playSword(1);
    return;
  }
  swishStopAll();
  T.forEach((w) => {
    const i = swishNext();
    playSwordOld(1, w[0] + 0.018);
    playSwish(i, Math.max(0, w[1] - SWISH_PEAK[i]));
  });
  if (n === "HeavyCombo") {
    // the finishing blow: the bluntflesh hit (as RENDER's) with one of the attack sounds
    // (the sparkle's loudest part is 0.06 s in, so it starts just before the slam)
    const fd = Math.max(0, HEAVY_COMBO_FINISH_T - 0.06);
    playSfxSetTracked("combo-sparkle-sfx-data", 0, 0.9, 1, fd);
    // the bluntflesh hit (wpn_hit_bluntflesh_enchanted_02) starts at the very same moment as the sparkle sound
    playSfxSetTracked("render-hit-sfx-data", 0, 0.9, 1, fd);
  }
}
const STEP_GAIN = 0.8,
  // STEP_CLIP_T: clip time of the first footfall in the Walk animation (the clip is 0.636 s long)
  STEP_CLIP_T = 0.09;
function playStep(rate) {
  playSfxSet("step-data", 0, STEP_GAIN, rate, 0);
}
let stepPrev = -1;
function footstepStep() {
  // call once per frame, after the mixer has moved: plays the walking sound each time the Walk clip passes the first footfall
  const w = actions.Walk;
  if (!w || current !== w || !w.isRunning()) {
    stepPrev = -1;
    return;
  }
  const dur = w.getClip().duration,
    t = w.time % dur;
  if (stepPrev >= 0) {
    const crossed =
      stepPrev <= t
        ? stepPrev < STEP_CLIP_T && STEP_CLIP_T <= t
        : STEP_CLIP_T > stepPrev || STEP_CLIP_T <= t;
    if (crossed) playStep(w.timeScale > 1.01 ? 1.4 : 1);
  // running: sped up so the second footfall keeps pace
  }
  stepPrev = t;
}
/* flaunt-sfx-data: SD_SWORD_00002 / 00004 (Castlevania). One of them, at random, plays over the flaunt song when Flaunt starts, a bit louder than the music. */
const FLAUNT_SFX_GAIN = 1.0;
function playFlauntSfx() {
  playSfxSet(
    voice === "voice2" ? "v2-flaunt-sfx-data" : "flaunt-sfx-data",
    Math.floor(Math.random() * 2),
    FLAUNT_SFX_GAIN * (voice === "voice2" ? V2_FLAUNT_GAIN : 1),
  );
}
const ANIM_SFX = {
  Flaunt: () => playFlauntSfx(),
  AxeFlaunt: () => playFlauntSfx(),
  Swing: () => playSword(1),
  AxeSwing: () => playSword(1),
  Hit: () => {
    blip(130, 0.14);
    playGrunt();
  },
  Block: () => playBlockSfx(),
  Death: () => playGrunt(DEATH_GRUNT),
};
const ANIM_SFX_LOOPS = { Swing: 1, AxeSwing: 1, Hit: 1, Block: 1 };
[
  "UAL_Sword_Regular_A",
  "UAL_Sword_Regular_B",
  "UAL_Sword_Regular_C",
  "UAL_Sword_Regular_Combo",
  "HeavyCombo",
  "UAL_Melee_Hook",
].forEach((n) => {
  ANIM_SFX[n] = () => playSwishClip(n);
  ANIM_SFX_LOOPS[n] = 1;
// the UAL clips in the ANIMATIONS menu get the same sounds
});
ANIM_SFX.UAL_Sword_Block = ANIM_SFX.Block;
ANIM_SFX_LOOPS.UAL_Sword_Block = 1;
ANIM_SFX.UAL_Hit_Stagger = ANIM_SFX.Hit;
// clips that loop in the test screen get their sound again every loop (Death plays once)
ANIM_SFX_LOOPS.UAL_Hit_Stagger = 1;
// which of the three grunts Death uses (the longest one); a hit picks one at random
const DEATH_GRUNT = 2;
function playGrunt(i) {
  try {
    if (voice === "voice2") {
      if (i === DEATH_GRUNT) playSfxSet("v2-die-data", 0, V2_DIE_GAIN, 1, 0);
      else
        playSfxSet(
          "v2-grunt-data",
          Math.floor(Math.random() * 4),
          V2_GRUNT_GAIN,
          1,
          0,
        );
      return;
    }
    if (!gruntBufs || !sfx) {
      const l = loadGrunts(),
        t0 = performance.now();
      if (l)
        l.then(() => {
          if (gruntBufs && performance.now() - t0 < 1500) playGrunt(i);
        });
      return;
    }
    sfx.resume();
    const src = sfx.createBufferSource(),
      g = sfx.createGain();
    src.buffer = cz(
      gruntBufs[
        i >= 0 && i < gruntBufs.length
          ? i
          : Math.floor(Math.random() * gruntBufs.length)
      ],
    );
    g.gain.value = 0.9;
    src.connect(g);
    g.connect(sfx.destination);
    src.start();
  } catch (_) {}
}
/* ---------- block sound effects: two sounds in a row when he blocks ----------
 SS_00009 (from Digimon World) always plays, together with one of two from Crash Bandicoot (S000001F_NSF_00022 / _00017), picked at random.
 They are embedded in block-sfx-data and decoded on the first menu sound, like the grunts. Gains level out the very different recording volumes. */
const BLOCK_GAIN = [0.92, 0.83, 1.0];
// where the loud "haah" starts inside each file (after a quiet lead-in), so it can be timed to land just as the whirr (SS_00009) finishes
const BLOCK_BURST = [0, 0.22, 0.24];
/* ---------- guarding: a hit taken in BlockIdle plays the three block sounds (wpn_block_blunt_01..03) one after another, in a random order, none twice ----------
 A new hit while the sequence is still playing cuts it off and starts a fresh one. BLOCK_HIT_GAIN = volume. */
const BLOCK_HIT_GAIN = 0.9;
let blockHitBufs = null,
  blockHitLoading = null,
  // blockHitBag: the sounds not yet used this turn
  blockHitBag = [];
function playBlockHitSeq() {
  if (!sfx) return;
  if (!blockHitBufs) {
    if (!blockHitLoading) {
      try {
        const list = JSON.parse(
          document.getElementById("block-hit-data").textContent,
        );
        blockHitLoading = Promise.all(
          list.map((b) => {
            const t = atob(b),
              u = new Uint8Array(t.length);
            for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
            return sfx.decodeAudioData(u.buffer);
          }),
        )
          .then((a) => {
            blockHitBufs = a;
          })
          .catch((e) => {
            blockHitLoading = null;
            console.error("block hit sfx failed", e);
          });
      } catch (e) {
        console.error(e);
      }
    }
    if (blockHitLoading)
      blockHitLoading.then(() => {
        if (blockHitBufs) playBlockHitSeq();
      });
    return;
  }
  if (sfx.state === "suspended") sfx.resume();
  if (!blockHitBag.length) {
    blockHitBag = [0, 1, 2];
    for (let i = 2; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [blockHitBag[i], blockHitBag[j]] = [blockHitBag[j], blockHitBag[i]];
    }
  // a shuffled bag of the three: every hit takes the next one, so no sound repeats within a turn (the bag is emptied again when the enemy phase ends)
  }
  const b = cz(blockHitBufs[blockHitBag.pop()]),
    src = sfx.createBufferSource(),
    g = sfx.createGain();
  src.buffer = b;
  g.gain.value = BLOCK_HIT_GAIN;
  src.connect(g);
  g.connect(sfx.destination);
  // ONE sound per hit
  src.start(sfx.currentTime + 0.02);
}
let blockBufs = null,
  blockLoading = null;
function loadBlockSfx() {
  if (blockLoading || !sfx) return blockLoading;
  try {
    const list = JSON.parse(
      document.getElementById("block-sfx-data").textContent,
    );
    blockLoading = Promise.all(
      list.map((b) => {
        const t = atob(b),
          u = new Uint8Array(t.length);
        for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
        return sfx.decodeAudioData(u.buffer);
      }),
    )
      .then((a) => {
        blockBufs = a;
      })
      .catch((e) => {
        blockLoading = null;
        console.error("block sfx failed", e);
      });
  } catch (e) {
    console.error(e);
  }
  return blockLoading;
}
const V2_BLOCK_BURST = 0.02;
function playBlockSfx() {
  try {
    if (!sfx) return;
    if (!blockBufs) {
      const l = loadBlockSfx();
      if (l)
        l.then(() => {
          if (blockBufs) playBlockSfx();
        });
      return;
    }
    if (voice === "voice2") {
      const s2 = SFX_SETS["v2-block-sfx-data"];
      if (!s2 || !s2.bufs) {
        const l2 = loadSfxSet("v2-block-sfx-data");
        if (l2)
          l2.then(() => {
            if (
              SFX_SETS["v2-block-sfx-data"] &&
              SFX_SETS["v2-block-sfx-data"].bufs
            )
              playBlockSfx();
          });
        return;
      }
      sfx.resume();
      const src0 = sfx.createBufferSource(),
        g0 = sfx.createGain();
      src0.buffer = cz(blockBufs[0]);
      g0.gain.value = BLOCK_GAIN[0];
      src0.connect(g0);
      g0.connect(sfx.destination);
      src0.start(sfx.currentTime);
      const src1 = sfx.createBufferSource(),
        g1 = sfx.createGain();
      src1.buffer = cz(s2.bufs[0]);
      g1.gain.value = V2_BLOCK_GAIN;
      src1.connect(g1);
      g1.connect(sfx.destination);
      src1.start(
        sfx.currentTime +
          Math.max(0, blockBufs[0].duration - V2_BLOCK_BURST + 0.02),
      );
      return;
    }
    sfx.resume();
    [0, 1 + Math.floor(Math.random() * 2)].forEach((i) => {
      const src = sfx.createBufferSource(),
        g = sfx.createGain();
      src.buffer = cz(blockBufs[i]);
      g.gain.value = BLOCK_GAIN[i];
      src.connect(g);
      g.connect(sfx.destination);
      src.start(
        sfx.currentTime +
          (i
            ? Math.max(0, blockBufs[0].duration - BLOCK_BURST[i] + 0.02)
            : 0),
      );
    // whirr first, the haah right after it
    });
  } catch (_) {}
}
function blip(f, len) {
  try {
    sfx = sfx || new (window.AudioContext || window.webkitAudioContext)();
    sfx.resume();
    loadGrunts();
    loadBlockSfx();
    loadSfxSet("step-data");
    loadSfxSet("swish-sfx-data");
    loadSfxSet("sword-sfx-data");
    loadSfxSet("knife-sfx-data");
    loadSfxSet("defeat-sfx-data");
    loadSfxSet("flaunt-sfx-data");
    loadSfxSet("potion-sfx-data");
    [
      "pizza-sfx-data",
      "combo-sparkle-sfx-data",
      "render-swish-sfx-data",
      "render-hit-sfx-data",
      "render-attack-sfx-data",
      "render-charge-sfx-data",
      "golem-atk-sfx-data",
      "golem-pain-sfx-data",
      "golem-spawn-sfx-data",
    ].forEach(loadSfxSet);
    [
      "v2-sword-sfx-data",
      "v2-block-sfx-data",
      "v2-grunt-data",
      "v2-die-data",
      "v2-flaunt-sfx-data",
      "slime-atk-sfx-data",
      "slime-hit-sfx-data",
      "slime-die-sfx-data",
      "slime-win-sfx-data",
    // voice 2 and the slimes too, so their very first play is not lost
    ].forEach(loadSfxSet);
    const o = sfx.createOscillator(),
      g = sfx.createGain();
    o.type = "square";
    o.frequency.value = f;
    g.gain.value = 0.045;
    o.connect(g);
    g.connect(sfx.destination);
    const t = sfx.currentTime;
    g.gain.setValueAtTime(0.045, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.start(t);
    o.stop(t + len + 0.02);
  } catch (_) {}
}
/* ---------- see-through obstacles ----------
 When a wall, pillar or tree stands between the camera and the knight (or an enemy), it is dithered away around him instead of the camera having to dodge it: the fragment shader (uOccOn on
 the obstacle materials) throws away fragments that are nearer than him and close to him on the screen, solid in the middle and thinning out in the same 4x4 ordered-dither grain towards the rim.
 occUpdate works out, every frame, where each character is on the screen (pixels of the render target), how big the hole should be (OCC.radius, in knight-heights) and how far away he is;
 OCC.gap = how much nearer than him (knight-heights) something must be to count as in front. Only while exploring or in a dungeon, never on the map. */
// near: obstacles closer to the lens than this fade out (fully gone inside the first number, gone completely by the second; knight-heights)
const OCC = { radius: 0.85, gap: 0.55, near: [0.3, 1.0] };
const _ov = new THREE.Vector3();
function occMark(obj) {
  obj.traverse((o) => {
    const m = o.material;
    if (m && m.uniforms && m.uniforms.uOccOn) m.uniforms.uOccOn.value = 1;
  });
// everything in this group counts as an obstacle
}
function occUpdate() {
  const arr = U.uOccF.value;
  let n = 0;
  if ((exploring || dungeon) && !mapMode && playerRig && blobHome) {
    camera.updateMatrixWorld();
    const H = playerH,
      g = blobHome.y,
      tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
      RW = U.uRes.value.x,
      RH = U.uRes.value.y;
    const add = (x, z) => {
      if (n >= arr.length) return;
      _ov.set(x, g + 0.55 * H, z).applyMatrix4(camera.matrixWorldInverse);
      const depth = -_ov.z;
      // behind the camera
      if (depth < 0.1) return;
      _ov.set(x, g + 0.55 * H, z).project(camera);
      arr[n++].set(
        (_ov.x * 0.5 + 0.5) * RW,
        (_ov.y * 0.5 + 0.5) * RH,
        Math.max(6, ((OCC.radius * H) / (2 * depth * tv)) * RH),
        depth,
      );
    };
    const p = playerRig.position;
    add(homeTarget.x + p.x, homeTarget.z + p.z);
    if (dungeon) for (const e of enemies) if (!e.dead) add(e.x, e.z);
    U.uOccNear.value.set(OCC.near[0] * H, OCC.near[1] * H);
  // off
  } else U.uOccNear.value.set(-1, -0.5);
  U.uOccN.value = n;
  U.uOccGap.value = OCC.gap * playerH;
}
