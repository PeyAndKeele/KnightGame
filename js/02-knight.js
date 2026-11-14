// Game state, animation snap, loading the knight, plume color.
// (Part 2 of 14. All parts share one scope; see README.)

/* ---------- state ---------- */
let invCust = false,
  invGoMenu = null,
  invHid = [],
  invOn = false,
  invK = 0,
  invPrev = null,
  invCur = 0,
  // inventory (main menu > INVENTORY)
  invUi = null;
let editOn = false,
  // (EDIT mode, see editStart: declared up here because showWeapons and the frame loop look at them)
  editRoll = 0;
let exploring = false,
  ps1 = true,
  spin = false,
  paused = false,
  mixer = null,
  actions = {},
  names = [],
  menuNames = [],
  current = null;
let mapMode = false,
  startScr = false,
  mapS = 0,
  mapDir = 0,
  // the map (see MAP below): mapS 0 = menu camera ... 3 = the map, mapDir +1 opening / -1 closing / 0 resting, mapViewK 1 = picture shifted right for the menu ... 0 = centered
  mapViewK = 1;
let yaw = Math.PI + 0.65,
  pitch = 0.1,
  zoom = 0.82,
  baseDist = 5,
  target = new THREE.Vector3();
/* seated pose: Pose2 shows the rock and now and then plays the Pose2_randomevent look-around */
const SEAT_CLIP = "Pose2",
  EVT_CLIP = "Pose2_randomevent";
/* the start screen: he sits hunched in Pose3 (the rig's own clip, embedded as pose3-data) under a fixed camera; START goes to the main menu with Pose2. It is night throughout unless OPTIONS > TIME says otherwise */
const START_CLIP = "Pose3";
/* The animation menus list ONE entry each for Idle, Swing and Flaunt. When the Axe is the weapon in his hand, that entry plays the axe's own clip
 (AxeIdle / AxeSwing / AxeFlaunt) instead, so those three never get entries of their own. */
const AXE_VARIANT = {
    Idle: "AxeIdle",
    Swing: "AxeSwing",
    Flaunt: "AxeFlaunt",
  },
  AXE_BASE = {
    AxeIdle: "Idle",
    AxeSwing: "Swing",
    AxeFlaunt: "Flaunt",
    FlauntIdleAxe: "Flaunt",
  },
  // FlauntIdleAxe: the loop that follows AxeFlaunt; no menu entry of its own, it lights up Flaunt
  FLAUNT_IDLE = "FlauntIdleAxe";
/* Flip the whole knight left-to-right: every animation, the sword hand, the seated pose and the look-around all swap sides together.
 (The skeleton is not symmetric, so swapping the left/right animation tracks would not line up; mirroring the model does.) Set false for the original handedness. */
const MIRROR_MODEL = true;
/* seat rock: half buried (its middle sits at floor level). Sized and placed so the hips rest on its front slope while both legs stay clear of it.
 ROCK_W / ROCK_D = half-width / half-depth, ROCK_H = height above the floor, ROCK_BACK = how far behind the hips its crown sits */
const ROCK_W = 1.2,
  ROCK_D = 0.67,
  ROCK_H = 1.2,
  ROCK_BACK = 0.34;
/* In Pose2 the left foot was tucked right under the hips, exactly where a seat has to go. Bending that knee less (it was 95 degrees)
 moves the foot forward, out of the rock. Set to 95 to get the original pose back (the rock will then clip that foot). */
const LEFT_SHIN_DEG = 40;
let rockMesh = null,
  evtPlaying = false,
  evtClock = 0,
  evtNext = 6,
  evtDue = false,
  evtGo = false,
  evtDone = false;
// seconds added to the Pose2 loop so it can ease back to its first pose instead of snapping
const SEAT_TAIL = 0.583;

/* ---------- SNAP: pose-to-pose snappiness for the action clips (the golem's attack feel) ----------
 Keys stay exactly where they are, so every hit time, whoosh and sound that is tied to a key still lines up; only the motion BETWEEN keys changes. In each track the single fastest big move
 is the strike: it eases IN (slow start, arrives hard on its key). Every other big move pops: it finishes in the first SNAP_SPAN of its time and holds. Small moves stay as they were, so
 breathing and settling keep flowing. Loops (Idle, Walk, BlockIdle, the holds) and the shop / seated poses are left alone. Set SNAP_ON=false for the old motion. */
const SNAP_ON = true,
  SNAP_CLIPS = [
    "Hit",
    "AxeSwing",
    "Flaunt",
    "AxeFlaunt",
    "Block",
    "Death",
    "Drinking_Potion",
    "SwingHeavyWindUp",
    "SwingHeavyRelease",
  ];
const SNAP_ANGLE = 0.45,
  SNAP_MOVE = 0.08,
  SNAP_SPAN = 0.6,
  // what counts as a big move (radians / units), how much of a segment a pop takes, samples per snapped segment
  SNAP_STEPS = 6;
function snapClip(clip) {
  clip.tracks = clip.tracks.map((tr) => {
    const T = Array.from(tr.times),
      V = Array.from(tr.values),
      vs = tr.getValueSize(),
      q = vs === 4,
      n = T.length;
    if (n < 2) return tr;
    const qa = new THREE.Quaternion(),
      qb = new THREE.Quaternion(),
      mag = [],
      sp = [];
    for (let i = 0; i < n - 1; i++) {
      let m;
      if (q) {
        qa.fromArray(V, i * 4);
        qb.fromArray(V, (i + 1) * 4);
        m = 2 * Math.acos(Math.min(1, Math.abs(qa.dot(qb))));
      } else {
        let d = 0;
        for (let k = 0; k < vs; k++) {
          const x = V[(i + 1) * vs + k] - V[i * vs + k];
          d += x * x;
        }
        m = Math.sqrt(d);
      }
      const dur = T[i + 1] - T[i],
        big = m >= (q ? SNAP_ANGLE : SNAP_MOVE) && dur >= 0.06;
      mag.push(big);
      sp.push(big ? m / dur : 0);
    }
    let best = -1;
    sp.forEach((v, i) => {
      if (v > 0 && (best < 0 || v > sp[best])) best = i;
    });
    if (best < 0) return tr;
    const T2 = [T[0]],
      V2 = V.slice(0, vs);
    for (let i = 0; i < n - 1; i++) {
      if (mag[i])
        for (let k = 1; k < SNAP_STEPS; k++) {
          const u = k / SNAP_STEPS,
            w =
              i === best
                ? u * u
                : 1 - Math.pow(1 - Math.min(1, u / SNAP_SPAN), 2);
          T2.push(T[i] + (T[i + 1] - T[i]) * u);
          if (q) {
            qa.fromArray(V, i * 4);
            qb.fromArray(V, (i + 1) * 4);
            qa.slerp(qb, w);
            V2.push(qa.x, qa.y, qa.z, qa.w);
          } else
            for (let c = 0; c < vs; c++)
              V2.push(
                V[i * vs + c] + (V[(i + 1) * vs + c] - V[i * vs + c]) * w,
              );
        }
      T2.push(T[i + 1]);
      for (let c = 0; c < vs; c++) V2.push(V[(i + 1) * vs + c]);
    }
    return new tr.constructor(tr.name, T2, V2, tr.getInterpolation());
  });
  clip.resetDuration();
}

/* ---------- load ---------- */
const raw = (function () {
  const s = atob(document.getElementById("knight-data").textContent.trim());
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
})();
/* Hide createImageBitmap so embedded textures load through plain <img> decoding (the sandbox blocks fetch of data: URIs). */
try {
  window.createImageBitmap = undefined;
} catch (_) {}
new THREE.GLTFLoader().parse(
  raw,
  "",
  function (gltf) {
    const cache = new Map();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const om = o.material;
      if (!cache.has(om.uuid)) cache.set(om.uuid, ps1Mat(om.map, 1));
      o.material = cache.get(om.uuid);
      if (o.name !== "Plume") {
        bodyMeshes.push(o);
        if (armorMats.indexOf(o.material) < 0) armorMats.push(o.material);
      }
    });
    armorMats.forEach(shineMat);
    // a remembered armor colour
    if (armorHex) applyArmorTint();
    const pl = gltf.scene.getObjectByName("Plume");
    if (pl) setupPlume(pl.material);
    if (pl) initHelmets(pl.parent, pl.parent.children.slice());
    const rig = new THREE.Group();
    rig.add(gltf.scene);
    if (MIRROR_MODEL) gltf.scene.scale.x = -1;
    // model faces -Z; turn him toward the camera
    rig.rotation.y = Math.PI;
    scene.add(rig);
    rig.updateMatrixWorld(true);
    playerRig = rig;
    knightScene = gltf.scene;
    const box = new THREE.Box3().setFromObject(rig),
      size = box.getSize(new THREE.Vector3()),
      ctr = box.getCenter(new THREE.Vector3());
    const H = size.y;
    target.copy(ctr);
    playerH = H;
    homeTarget = ctr.clone();

    // checkered floor
    const cv = document.createElement("canvas");
    cv.width = cv.height = 2;
    const g = cv.getContext("2d");
    g.fillStyle = "#434d78";
    g.fillRect(0, 0, 2, 2);
    g.fillStyle = "#363e63";
    g.fillRect(0, 0, 1, 1);
    g.fillRect(1, 1, 1, 1);
    const ft = new THREE.CanvasTexture(cv);
    ft.wrapS = ft.wrapT = THREE.RepeatWrapping;
    floorTexClassic = ft;
    floorTexForest = mkFloorTex("#5aa845", "#4a9638");
    floorTexFrost = mkFloorTex("#eef4ff", "#d8e4f8");
    floorTexIgnis = mkFloorTex("#252220", "#171514");
    floorMat = ps1FloorMat(
      floorTexForest,
      floorTexFrost,
      floorTexIgnis,
      192,
      H,
    );
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(H * 192, H * 192, 192, 192),
      floorMat,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, box.min.y - H * 0.004, -FROST_DIST * H);
    scene.add(floor);
    floorMesh = floor;
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(H * 0.26, 10),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(ctr.x, box.min.y + H * 0.002, ctr.z);
    scene.add(blob);
    blobMesh = blob;
    blobHome = blob.position.clone();

    U.uFogNear.value = H * 2.6;
    U.uFogFar.value = H * 5.2;
    initTrees(H, box.min.y);
    initRuins(H, box.min.y, ctr);
    initTomb(H, box.min.y, ctr);
    initPointer();
    initElemental();
    initDgForest(H, box.min.y, ctr);
    initSky(H, box.min.y);
    initNight(H, box.min.y);
    groundYNight = box.min.y;
    initLeaves(box.min.y);
    initSnow(H, box.min.y);
    initRock(gltf.scene, box.min.y);
    initSword(gltf.scene);
    initHatchet(gltf.scene);
    initHammer(gltf.scene);
    initMorningstar(gltf.scene);
    initKnightly(gltf.scene);
    initAxe(gltf.scene);
    initPotion(gltf.scene);
    initChest(rig);
    setWorld(true);
    baseDist = H;
    resize();

    // animations
    gltf.animations.forEach((a) => {
      if (a.name === SEAT_CLIP || a.name === EVT_CLIP)
        setLeftShin(a, LEFT_SHIN_DEG);
      if (a.name === SEAT_CLIP) closeLoop(a, a.duration + SEAT_TAIL);
      else if (a.name === EVT_CLIP) closeLoop(a, a.duration);
    });
    /* Death: the old Idle2 clip (hips drop, he folds forward and stays down), embedded as death-data and added next to the model's own clips.
   Track targets use the same node names the loader gave the existing clips (the model has two nodes called Head, so the loader renames one). */
    (function () {
      const el = document.getElementById("death-data");
      if (!el) return;
      const D = JSON.parse(el.textContent),
        base = {};
      gltf.animations.forEach((a) =>
        a.tracks.forEach((t) => {
          const b = t.name.slice(0, t.name.lastIndexOf("."));
          base[b.replace(/_\d+$/, "")] = b;
        }),
      );
      const tr = D.tracks.map((k) => {
        const b = base[k.n] || k.n;
        return k.p === "q"
          ? new THREE.QuaternionKeyframeTrack(b + ".quaternion", k.t, k.v)
          : new THREE.VectorKeyframeTrack(b + ".position", k.t, k.v);
      });
      gltf.animations.push(new THREE.AnimationClip(D.name, -1, tr));
    })();
    /* AxeIdle (the axe's idle) and AxeSwing (its swing, the rig's Swing3): embedded as axeidle-data / axeswing-data and added exactly like Death above.
   They are used whenever the Axe is the chosen weapon; the sword keeps Idle and Swing. */
    [
      "axeidle-data",
      "axeswing-data",
      "axeflaunt-data",
      "flauntidleaxe-data",
      "drinkpotion-data",
      "pose3-data",
      "dance-data",
      "dance2-data",
      "dance3-data",
      "pizza-data",
      "shopidle-data",
      "shopidleanimation1-data",
      "shopintotalk-data",
      "shopoutrotalk-data",
      "shopwhiletalking-data",
      "block-data",
      "blockidle-data",
      "swingheavywindup-data",
      "swingheavyturnhold-data",
      "swingheavyrelease-data",
      "swing2-data",
    ].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      const D = JSON.parse(el.textContent),
        base = {};
      if ((id === "axeswing-data" && AXE_SWING_REVERSE) || D.rev) {
        // play the swing backwards: keyframes in reverse order, times counted from the end
        let T = 0;
        D.tracks.forEach((k) => {
          T = Math.max(T, k.t[k.t.length - 1]);
        });
        D.tracks.forEach((k) => {
          const n = k.p === "q" ? 4 : 3,
            c = k.t.length,
            v = [];
          for (let i = c - 1; i >= 0; i--)
            for (let j = 0; j < n; j++) v.push(k.v[i * n + j]);
          k.t = k.t.map((x) => T - x).reverse();
          k.v = v;
        });
      }
      gltf.animations.forEach((a) =>
        a.tracks.forEach((t) => {
          const b = t.name.slice(0, t.name.lastIndexOf("."));
          base[b.replace(/_\d+$/, "")] = b;
        }),
      );
      const tr = D.tracks.map((k) => {
        const b = base[k.n] || k.n;
        return k.p === "q"
          ? new THREE.QuaternionKeyframeTrack(b + ".quaternion", k.t, k.v)
          : new THREE.VectorKeyframeTrack(b + ".position", k.t, k.v);
      });
      if (id === "block-data") {
        const old = gltf.animations.findIndex((a) => a.name === "Block");
        if (old >= 0) gltf.animations.splice(old, 1);
      // the new Block replaces the rig's own
      }
      if (id === "swing2-data") {
        const old = gltf.animations.findIndex((a) => a.name === "Swing");
        if (old >= 0) gltf.animations.splice(old, 1);
      // Swing2 (from the rig) replaces the knight's own Swing; it keeps the name Swing so everything keyed on it still works
      }
      gltf.animations.push(new THREE.AnimationClip(D.name, -1, tr));
    });
    /* Chestopen: the rig's own chest-opening clip (embedded below as CHESTOPEN_CLIP, same track format as the other embedded clips). It lists itself in the animation menus; the chest it opens is built in initChest. */
    {
      const base = {};
      gltf.animations.forEach((a) =>
        a.tracks.forEach((t) => {
          const b = t.name.slice(0, t.name.lastIndexOf("."));
          base[b.replace(/_\d+$/, "")] = b;
        }),
      );
      [CHESTOPEN_CLIP].forEach((D) =>
        gltf.animations.push(
          new THREE.AnimationClip(
            D.name,
            -1,
            D.tracks.map((k) => {
              const b = base[k.n] || k.n;
              return k.p === "q"
                ? new THREE.QuaternionKeyframeTrack(
                    b + ".quaternion",
                    k.t,
                    k.v,
                  )
                : new THREE.VectorKeyframeTrack(b + ".position", k.t, k.v);
            }),
          ),
        ),
      );
    }
    /* UAL: clips from Quaternius' Universal Animation Library, retargeted onto this rig offline (ual-data: arms and legs aimed by direction, hips / torso / head by world rotation, feet kept on the ground).
   They are added next to the knight's own clips as UAL_*; ANIM SET in the options plays them in place of Idle / Walk / Swing / Hit / Block ... (see UAL_ALT). */
    (function () {
      const el = document.getElementById("ual-data");
      if (!el) return;
      const U = JSON.parse(el.textContent),
        base = {};
      gltf.animations.forEach((a) =>
        a.tracks.forEach((t) => {
          const b = t.name.slice(0, t.name.lastIndexOf("."));
          base[b.replace(/_\d+$/, "")] = b;
        }),
      );
      U.clips.forEach((D) => {
        const tr = D.tracks.map((k) => {
          const b = base[k.n] || k.n;
          return k.p === "q"
            ? new THREE.QuaternionKeyframeTrack(b + ".quaternion", k.t, k.v)
            : new THREE.VectorKeyframeTrack(b + ".position", k.t, k.v);
        });
        gltf.animations.push(
          new THREE.AnimationClip(
            D.name === "UAL_Sword_Heavy_Combo" ? "HeavyCombo" : D.name,
            -1,
            tr,
          ),
        );
      });
      /* UALX_ConsumeM: UAL_Consume mirrored left <-> right (the UAL drinks with its right hand, the potion is in his left). Left and right bones swap tracks, rotations are mirrored across x (x,-y,-z,w),
     and the hips' / head's sideways position is negated. The static 'rest offset' position tracks of the arms / torso are left alone. Used by the inventory's ITEMS inspection (see invDrink). */
      (function () {
        const D = U.clips.find((c) => c.name === "UAL_Consume");
        if (!D) return;
        const sw = (n) =>
            n.replace(/^(Left|Right)_/, (m, a) =>
              a === "Left" ? "Right_" : "Left_",
            ),
          tr = [];
        D.tracks.forEach((k) => {
          if (k.p === "q") {
            const v = [];
            for (let i = 0; i < k.v.length; i += 4)
              v.push(k.v[i], -k.v[i + 1], -k.v[i + 2], k.v[i + 3]);
            const n = sw(k.n);
            tr.push(
              new THREE.QuaternionKeyframeTrack(
                (base[n] || n) + ".quaternion",
                k.t,
                v,
              ),
            );
          } else if (k.n === "Root_Hips" || k.n === "Head") {
            const v = k.v.slice();
            for (let i = 0; i < v.length; i += 3) v[i] = -v[i];
            tr.push(
              new THREE.VectorKeyframeTrack(
                (base[k.n] || k.n) + ".position",
                k.t,
                v,
              ),
            );
          } else
            tr.push(
              new THREE.VectorKeyframeTrack(
                (base[k.n] || k.n) + ".position",
                k.t,
                k.v,
              ),
            );
        });
        gltf.animations.push(
          new THREE.AnimationClip("UALX_ConsumeM", -1, tr),
        );
      // (the heavy combo is just called HeavyCombo: it is not one of the hidden UAL_ clips)
      })();
    })();
    /* EDIT: six still poses (Mixamo poses, retargeted onto this rig offline: editposes-data). They are hidden from the menus (UALX_) and only used by the EDIT mode (see editStart). */
    (function () {
      const el = document.getElementById("editposes-data");
      if (!el) return;
      const E = JSON.parse(el.textContent),
        base = {};
      gltf.animations.forEach((a) =>
        a.tracks.forEach((t) => {
          const b = t.name.slice(0, t.name.lastIndexOf("."));
          base[b.replace(/_\d+$/, "")] = b;
        }),
      );
      E.clips.forEach((D) => {
        const tr = D.tracks.map((k) => {
          const b = base[k.n] || k.n;
          return k.p === "q"
            ? new THREE.QuaternionKeyframeTrack(b + ".quaternion", k.t, k.v)
            : new THREE.VectorKeyframeTrack(b + ".position", k.t, k.v);
        });
        gltf.animations.push(new THREE.AnimationClip(D.name, -1, tr));
      });
    })();
    {
      [
        START_CLIP,
        "ShopIdle",
        "ShopIdleAnimation1",
        "ShopIdleAnimationIntoTalk",
        "ShopIdleAnimationOutroTalk",
        "ShopIdleAnimationWhileTalking",
      ].forEach((cn) => {
        const p3 = gltf.animations.find((a) => a.name === cn);
        if (p3) setLeftShin(p3, LEFT_SHIN_DEG);
      });
    // Pose3 shares Pose2's legs, so it gets the same tweak and sits on the same rock. Its head is left as authored; the occasional look at the sky is added on top, see headLook()
    }
    /* AxeFlaunt is the rig's own "animation" clip, played exactly as authored (arms, body, legs and head are not touched). Only the axe moves: it rests on his back, see AXE_STOW_CLIPS. */
    mixer = new THREE.AnimationMixer(gltf.scene);
    const order = [
      "Idle",
      "AxeIdle",
      "Walk",
      "Swing",
      "AxeSwing",
      "AxeFlaunt",
      "Hit",
      "Death",
    ];
    names = order
      .filter((n) => gltf.animations.some((a) => a.name === n))
      .concat(
        gltf.animations
          .map((a) => a.name)
          .filter((n) => !order.includes(n) && n !== EVT_CLIP),
      );
    menuNames = names.filter(
      (n) => !AXE_BASE[n] && n !== START_CLIP && !/^UALX_/.test(n),
    // what the menus list: the axe variants are folded into Idle / Swing / Flaunt, and the start-screen pose (Pose3) is not an animation to browse
    );
    {
      const gi = { enemies: 0, self: 1, shop: 2 };
      menuNames = menuNames
        .map((n, i) => [n, i])
        .sort(
          (a, b) => gi[animGroup(a[0])] - gi[animGroup(b[0])] || a[1] - b[1],
        )
        .map((x) => x[0]);
    // grouped in the order the ANIMATIONS menu shows them (so the cycle keys follow it too)
    }
    if (SNAP_ON)
      gltf.animations.forEach((a) => {
        if (SNAP_CLIPS.includes(a.name)) snapClip(a);
      // see SNAP
      });
    gltf.animations.forEach((a) => {
      actions[a.name] = mixer.clipAction(a);
    });
    try {
      ualApply();
    } catch (e) {
      console.error(e);
    // the default ANIM SET (IDEAL) takes effect from the start
    }
    mixer.addEventListener("finished", (e) => {
      if (e.action === actions[EVT_CLIP]) evtDone = true;
      else if (e.action === actions.Swing || e.action === actions.AxeSwing)
        swingDone = true;
      else if (e.action === actions.AxeFlaunt && e.action === current)
        flauntDone = true;
      else if (e.action === actions.Chestopen && chestScene) chestDone = true;
    });
    mixer.addEventListener("loop", (e) => {
      if (
        evtDue &&
        e.action === current &&
        e.action.getClip().name === SEAT_CLIP
      )
        evtGo = true;
    });
    mixer.addEventListener("loop", (e) => {
      const n = e.action.getClip().name;
      if (e.action === current && ANIM_SFX_LOOPS[n]) ANIM_SFX[n]();
    });
    buildMenu();
    play(
      names.indexOf(START_CLIP) >= 0
        ? START_CLIP
        : names.indexOf(SEAT_CLIP) >= 0
          ? SEAT_CLIP
          : names[0],
    );
    initMainMenu();
    // the default look follows the local clock (set 'night' here for the old always-night start)
    setTimeMode("auto");
    if (actions[START_CLIP]) {
      startCam();
      syncRockMeshes();
    // the start screen's low camera; he sits in Pose3 without the rock
    }
  },
  function (e) {
    console.error(e);
    const el = document.getElementById("err");
    el.textContent =
      "Could not load the model: " +
      String((e && e.message) || e).slice(0, 160);
    el.style.display = "block";
  },
);

/* ---------- plume color ---------- */
const plumes = [];
let plumeHex = _hexOk(_look.plume);
function toHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    l = (mx + mn) / 2;
  let h = 0,
    s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h =
      mx === r
        ? (g - b) / d + (g < b ? 6 : 0)
        : mx === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function fromHsl(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12,
      a = s * Math.min(l, 1 - l);
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return [f(0), f(8), f(4)];
}
function setupPlume(m) {
  const img = m.uniforms.map.value.image;
  if (!img) return;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const base = ctx.getImageData(0, 0, c.width, c.height);
  let sum = 0,
    n = 0;
  const d = base.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 127) {
      sum += toHsl(d[i], d[i + 1], d[i + 2])[2];
      n++;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.encoding = THREE.LinearEncoding;
  tex.generateMipmaps = false;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  m.uniforms.map.value = tex;
  const pl = { tex, ctx, base, avgL: n ? sum / n : 0.6 };
  if (!plumes.length) buildPlumeUI();
  plumes.push(pl);
  if (plumeHex) tintOne(pl, plumeHex);
}
function tintOne(pl, hex) {
  const out = pl.ctx.createImageData(pl.base.width, pl.base.height);
  out.data.set(pl.base.data);
  if (hex) {
    const [th, ts, tl] = toHsl(
        ...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
      ),
      d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const l = toHsl(d[i], d[i + 1], d[i + 2])[2];
      const c = fromHsl(th, ts, Math.max(0, Math.min(1, tl + (l - pl.avgL))));
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    }
  }
  pl.ctx.putImageData(out, 0, 0);
  pl.tex.needsUpdate = true;
}
function tintPlume(hex) {
  plumeHex = hex;
  plumes.forEach((pl) => tintOne(pl, hex));
}
