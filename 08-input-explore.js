// Toggles, camera input, pixel filter, sizing, explore mode, dungeon forest, classic sky.
// (Part 8 of 14. All parts share one scope; see README.)

/* ---------- toggles ---------- */
function setSwitch(id, on, label) {
  const b = document.getElementById(id);
  b.setAttribute("aria-checked", on);
  b.querySelector(".v").textContent = label;
}
function toggleSpin() {
  spin = !spin;
  setSwitch("spin", spin, spin ? "On" : "Off");
}
function toggleLook() {
  ps1 = !ps1;
  U.uSnap.value = U.uAffine.value = U.uDither.value = ps1 ? 1 : 0;
  setSwitch("look", ps1, ps1 ? "PS1" : "Modern");
  document.body.classList.toggle("modern", !ps1);
  resize();
}
function togglePause() {
  paused = !paused;
  setSwitch("pause", paused, paused ? "On" : "Off");
}
document.getElementById("spin").onclick = toggleSpin;
document.getElementById("look").onclick = toggleLook;
document.getElementById("pause").onclick = togglePause;
document.getElementById("sword").onclick = toggleWeapon;
const vBtn = document.getElementById("voice");
if (vBtn) vBtn.onclick = toggleVoice;
const vSel = document.getElementById("voicesel");
if (vSel)
  vSel.onchange = () => {
    setVoice(vSel.value);
    vSel.blur();
    try {
      sfx = sfx || new (window.AudioContext || window.webkitAudioContext)();
      sfx.resume();
    } catch (e) {}
    playFlauntSfx();
  // picking a voice previews its flaunt line
  };
addEventListener("keydown", (e) => {
  if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
  if (e.target.tagName === "BUTTON" && e.key === " ") return;
  const k = e.key.toLowerCase();
  if (exploring && k !== "m" && k !== "p") return;
  if (k === " " || k === "enter" || k.indexOf("arrow") === 0) {
    e.preventDefault();
  } else if (k === "t") toggleSpin();
  else if (k === "p") toggleLook();
  else if (k === "m") toggleMusic();
  else if (k === "h") cycleHelmet();
  else if (k === "w") setWorld(!forest);
});

/* ---------- camera input ---------- */
// right-drag orbits the camera, so no browser context menu (save image as, etc.)
addEventListener("contextmenu", (e) => e.preventDefault());
const ptrs = new Map();
let pinch = 0;
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  pinch = 0;
});
canvas.addEventListener("pointermove", (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p || mapMode || startScr) return;
  if (invOn) {
    if (ptrs.size === 1) yaw -= (e.clientX - p[0]) * 0.01;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    return;
  // the inventory: dragging sideways turns him (the camera's height and distance stay as the inventory set them)
  }
  if (ptrs.size === 1) {
    yaw -= (e.clientX - p[0]) * 0.01;
    pitch = Math.max(
      -0.35,
      Math.min(1.2, pitch + (e.clientY - p[1]) * 0.008),
    );
  }
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch) zoom = Math.max(0.5, Math.min(2.2, (zoom * pinch) / d));
    pinch = d;
  }
});
["pointerup", "pointercancel"].forEach((t) =>
  canvas.addEventListener(t, (e) => {
    ptrs.delete(e.pointerId);
    pinch = 0;
  }),
);
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (mapMode || startScr || invOn) return;
    zoom = Math.max(0.5, Math.min(2.2, zoom * Math.exp(e.deltaY * 0.001)));
  },
  { passive: false },
);

/* ---------- pixel filter (Options > PIXELS and COLORS; both only show in the PS1 look) ----------
 PIXELS: how many pixels tall the picture is rendered (it is then scaled up with hard edges): 240 is the normal PS1 look, lower is chunkier.
 COLORS: how many shades per color channel the dithering rounds to: 31 = 15-bit (the PS1), 15 = 12-bit, 7 = 9-bit, 3 = 6-bit. */
const PIX_STEPS = [
  ["NORMAL", 240],
  ["CHUNKY", 180],
  ["HEAVY", 120],
  ["CRUSHED", 80],
];
const COL_STEPS = [
  ["15-BIT", 31],
  ["12-BIT", 15],
  ["9-BIT", 7],
  ["6-BIT", 3],
];
let pixIdx = 0,
  // the defaults: NORMAL (240 px tall) and 9-BIT color.   pixIdx: 0 NORMAL, 1 CHUNKY, 2 HEAVY, 3 CRUSHED.   colIdx: 0 15-BIT, 1 12-BIT, 2 9-BIT, 3 6-BIT
  colIdx = 2;
U.uLevels.value = COL_STEPS[colIdx][1];
function cyclePixels() {
  if (!ps1) toggleLook();
  pixIdx = (pixIdx + 1) % PIX_STEPS.length;
  resize();
}
function cycleColors() {
  if (!ps1) toggleLook();
  colIdx = (colIdx + 1) % COL_STEPS.length;
  U.uLevels.value = COL_STEPS[colIdx][1];
}
/* ---------- sizing ---------- */
function applyView() {
  // where the picture sits: shifted aside for the menu (mapViewK = 1), centered when exploring or on the map
  const W = innerWidth,
    Hh = innerHeight,
    asp = W / Hh,
    k = mapViewK;
  if (exploring) camera.setViewOffset(W, Hh, 0, 0, W, Hh);
  else if (asp >= 0.9) camera.setViewOffset(W, Hh, -W * 0.2 * k, 0, W, Hh);
  else camera.setViewOffset(W, Hh, 0, Hh * 0.17 * k, W, Hh);
  camera.updateProjectionMatrix();
}
function resize() {
  const W = innerWidth,
    Hh = innerHeight,
    asp = W / Hh;
  let w, h;
  if (ps1) {
    const s = PIX_STEPS[pixIdx][1];
    if (asp >= 1) {
      h = s;
      w = Math.round(s * asp);
    } else {
      w = s;
      h = Math.round(s / asp);
    }
  } else {
    const r = Math.min(devicePixelRatio || 1, 2);
    w = Math.round(W * r);
    h = Math.round(Hh * r);
  }
  renderer.setSize(w, h, false);
  U.uRes.value.set(w, h);
  camera.aspect = asp;
  applyView();
  const fit =
    (baseDist / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) *
    1.5;
  camera.userData.fit = asp < 0.8 ? (fit * 0.8) / asp : fit;
}
addEventListener("resize", resize);
resize();

/* ---------- explore mode: walk around the forest ---------- */
let playerRig = null,
  floorMesh = null,
  blobMesh = null,
  blobHome = null,
  playerH = 2.2,
  homeTarget = new THREE.Vector3(),
  colliders = [];
const WALK_SPEED = 0.9,
  RUN_MULT = 1.7,
  BOUND = 10.5,
  TREE_R = 0.16,
  // speeds/radii are in knight-heights
  PLAYER_R = 0.1;
const keys = new Set();
const stick = { x: 0, y: 0 };
let moving = false,
  heading = Math.PI;
let swinging = false,
  swingQueued = false,
  swingDone = false,
  downAt = null;
function stopExplore() {
  if (!exploring) return;
  swooshHide();
  exploring = false;
  document.body.classList.remove("explore");
  swinging = swingQueued = swingDone = false;
  swingScaleReset();
  keys.clear();
  stick.x = stick.y = 0;
  moving = false;
  playerRig.position.set(0, 0, areaZOffset());
  playerRig.rotation.y = Math.PI;
  floorMesh.position.x = 0;
  floorMesh.position.z = -FROST_DIST * playerH;
  if (blobMesh && blobHome)
    blobMesh.position.set(blobHome.x, blobHome.y, blobHome.z + areaZOffset());
  target.set(homeTarget.x, homeTarget.y, homeTarget.z + areaZOffset());
  yaw = Math.PI + 0.65;
  pitch = 0.1;
  zoom = 0.82;
  if (actions.Walk) actions.Walk.timeScale = 1;
  play(names.indexOf(SEAT_CLIP) >= 0 ? SEAT_CLIP : names[0]);
  resize();
}
function exploreStep(dt) {
  const dn = (k) => (keys.has(k) ? 1 : 0);
  const f = dn("w") + dn("arrowup") - dn("s") - dn("arrowdown") + stick.y,
    r = dn("d") + dn("arrowright") - dn("a") - dn("arrowleft") + stick.x;
  const mx = f * -Math.sin(yaw) + r * Math.cos(yaw),
    mz = f * -Math.cos(yaw) + r * -Math.sin(yaw);
  let len = Math.hypot(mx, mz);
  const run = keys.has("shift"),
    p = playerRig.position,
    H = playerH;
  if (len > 0.08 && !swinging) {
    const amt = Math.min(len, 1),
      dx = mx / len,
      dz = mz / len,
      sp = WALK_SPEED * H * (run ? RUN_MULT : 1) * amt;
    let nx = p.x + dx * sp * dt,
      nz = p.z + dz * sp * dt;
    for (const c of colliders) {
      const ox = nx - c.x,
        oz = nz - c.z,
        rr = c.r + PLAYER_R * H,
        d2 = ox * ox + oz * oz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-4;
        nx = c.x + (ox / d) * rr;
        nz = c.z + (oz / d) * rr;
      }
    }
    const bd = Math.hypot(nx, nz),
      lim = BOUND * H;
    if (bd > lim) {
      nx *= lim / bd;
      nz *= lim / bd;
    }
    p.x = nx;
    p.z = nz;
    const want = Math.atan2(dx, dz);
    let diff =
      ((((want - heading + Math.PI) % (Math.PI * 2)) + Math.PI * 2) %
        (Math.PI * 2)) -
      Math.PI;
    heading += diff * Math.min(1, dt * 12);
    playerRig.rotation.y = heading;
    if (!moving) {
      moving = true;
      if (actions.Walk) play("Walk");
    }
    if (actions.Walk) actions.Walk.timeScale = run ? 1.6 : 1;
  } else if (moving && !swinging) {
    moving = false;
    play(idleName());
  }
  const want = new THREE.Vector3(
    homeTarget.x + p.x,
    homeTarget.y,
    homeTarget.z + p.z,
  );
  target.lerp(want, 1 - Math.exp(-dt * 12));
  floorMesh.position.x = Math.round(p.x / H) * H;
  // ground follows you, snapped so the checker never slides
  floorMesh.position.z = Math.round(p.z / H) * H;
  if (blobMesh && blobHome)
    blobMesh.position.set(blobHome.x + p.x, blobHome.y, blobHome.z + p.z);
}
addEventListener("keydown", (e) => {
  if (!exploring) return;
  const k = e.key.toLowerCase();
  if (k === "escape") {
    if (dungeon && bmOpen) bmBack();
    else leaveMode();
    return;
  }
  keys.add(k);
  if (k.indexOf("arrow") === 0 || k === " ") e.preventDefault();
});
addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
});
addEventListener("blur", () => keys.clear());
// leaveMode lives in a later file (09), so look it up when clicked rather than at load
document.getElementById("hudmenu").onclick = () => leaveMode();
(function () {
  const pad = document.getElementById("stick"),
    knob = document.getElementById("knob");
  let id = null;
  function upd(e) {
    const b = pad.getBoundingClientRect(),
      R = b.width / 2;
    let x = (e.clientX - b.left - R) / R,
      y = (e.clientY - b.top - R) / R;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    stick.x = x;
    stick.y = -y;
    knob.style.transform =
      "translate(" + x * R * 0.6 + "px," + y * R * 0.6 + "px)";
  }
  pad.addEventListener("pointerdown", (e) => {
    id = e.pointerId;
    pad.setPointerCapture(id);
    upd(e);
    e.stopPropagation();
  });
  pad.addEventListener("pointermove", (e) => {
    if (e.pointerId === id) upd(e);
  });
  const end = (e) => {
    if (e.pointerId === id) {
      id = null;
      stick.x = stick.y = 0;
      knob.style.transform = "";
    }
  };
  pad.addEventListener("pointerup", end);
  pad.addEventListener("pointercancel", end);
})();

/* ---------- click / tap to swing (explore mode) ---------- */
function swing() {
  if (!actions[swingName()] || !exploring || dungeon || paused) return;
  if (swinging) {
    swingQueued = true;
    return;
  }
  // IDEAL: a random A / B / C for every swing
  if (animSet === "ideal" && swingName() === "Swing") idealPickSwing();
  // one click is buffered, so mashing chains swings
  const sw = actions[swingName()];
  swinging = true;
  swingQueued = false;
  // cross-fade, never stop(): stopping the last action snaps the skeleton to the T-pose
  if (current && current !== sw) current.fadeOut(0.06);
  sw.reset().setLoop(THREE.LoopOnce, 1);
  sw.clampWhenFinished = true;
  sw.timeScale = 1.25;
  sw.fadeIn(0.06).play();
  current = sw;
  playSword(1.25);
}
function endSwing() {
  swinging = false;
  swingScaleReset();
  if (!exploring) return;
  if (swingQueued) {
    swingQueued = false;
    swing();
    return;
  }
  moving = false;
  // the next movement frame switches to Walk again if keys are held
  play(idleName());
}
canvas.addEventListener("pointerdown", (e) => {
  downAt =
    e.button === 0 && e.isPrimary
      ? { x: e.clientX, y: e.clientY, t: performance.now() }
      : null;
});
canvas.addEventListener("pointerup", (e) => {
  if (
    downAt &&
    exploring &&
    Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8 &&
    performance.now() - downAt.t < 450
  )
    // a click, not a camera drag
    swing();
  downAt = null;
});

/* ---------- dungeon forest: a few hundred trees (one trunk mesh, one canopy mesh) plus stretched boulders (one mesh), ringed around the ruins ----------
 Radii are in knight-heights from the circle. Nothing is placed inside `inner` (so the camera never ends up inside a canopy) or in the `lane` he walks in along. */
const DGF = {
  count: 380,
  inner: 5.6,
  outer: 12.5,
  lane: 2.2,
  minS: 0.7,
  maxS: 2.1,
// tree count, ring radii, half-width of the clear walk-in lane, size range
};
// boulders: how many, and the base size range (the seat rock times this, then stretched per axis)
const DGR = { count: 170, minS: 0.5, maxS: 2.6 };
let dgForest = null;
/* ---------- classic sky: the flipping shapes, enlarged and spread around the sky (shown only in the Classic world) ----------
 Distances and sizes are in knight-heights, elevation in degrees. Each shape is copied `copies` times, each copy with its own spot, size, speed and flip timing. */
const SKYN = {
  copies: 4,
  minR: 34,
  maxR: 62,
  minEl: 8,
  maxEl: 50,
  minSize: 4,
  maxSize: 10,
};
let skyGroup = null,
  skyT = 0;
const skyItems = [],
  skyQ = new THREE.Quaternion();
function initSky(H, groundY) {
  const FD = JSON.parse(document.getElementById("flip-data").textContent);
  Promise.all(FD.map((sh) => loadImg(sh.tex)))
    .then((imgs) => {
      let sd = 4242;
      const rnd = () => {
        sd = (sd + 0x6d2b79f5) | 0;
        let t = Math.imul(sd ^ (sd >>> 15), 1 | sd);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const grp = new THREE.Group();
      let idx = 0;
      FD.forEach((sh, k) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(sh.p, 3),
        );
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(sh.n, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(sh.uv, 2));
        geo.setIndex(sh.i);
        const tex = new THREE.Texture(imgs[k]);
        tex.flipY = false;
        const mat = ps1Mat(tex, 1);
        mat.uniforms.uFogNear = { value: 1e6 };
        // their own fog values: far away, but never faded out
        mat.uniforms.uFogFar = { value: 2e6 };
        for (let c = 0; c < SKYN.copies; c++, idx++) {
          const az =
              (((idx * 0.618034) % 1) + (rnd() - 0.5) * 0.05) * Math.PI * 2,
            el =
              ((SKYN.minEl +
                Math.pow(rnd(), 1.3) * (SKYN.maxEl - SKYN.minEl)) *
                Math.PI) /
              // golden-ratio spread around the compass, mostly low enough to see
              180;
          const R = Math.min(
              (SKYN.minR + rnd() * (SKYN.maxR - SKYN.minR)) * H,
              170,
            ),
            size = H * (SKYN.minSize + rnd() * (SKYN.maxSize - SKYN.minSize));
          const pivot = new THREE.Group(),
            m = new THREE.Mesh(geo, mat);
          m.position.set(sh.off[0], sh.off[1], sh.off[2]);
          pivot.add(m);
          pivot.scale.setScalar(size / sh.dim);
          pivot.position.set(
            Math.cos(az) * Math.cos(el) * R,
            groundY + Math.sin(el) * R,
            Math.sin(az) * Math.cos(el) * R,
          );
          pivot.frustumCulled = false;
          grp.add(pivot);
          skyItems.push({
            pivot,
            anim: sh.anim,
            off: rnd() * sh.anim.T,
            speed: 0.6 + rnd() * 0.7,
          });
        }
      });
      grp.visible = !forest;
      scene.add(grp);
      skyGroup = grp;
    })
    .catch((e) => console.error("sky failed", e));
}
function updateSky(dt) {
  if (!skyGroup || !skyGroup.visible) return;
  skyT += dt;
  // steps at 15 fps in the PS1 look, like the other animation
  const st = ps1 ? Math.floor(skyT * 15) / 15 : skyT;
  // rides along with the camera, so the sky never gets closer
  skyGroup.position.set(target.x, 0, target.z);
  skyItems.forEach((it) => {
    const A = it.anim,
      t = (st * it.speed + it.off) % A.T;
    let i = 0;
    while (i < A.t.length - 2 && A.t[i + 1] <= t) i++;
    const f = (t - A.t[i]) / (A.t[i + 1] - A.t[i] || 1),
      a = A.q[i],
      b = A.q[i + 1];
    it.pivot.quaternion
      .set(a[0], a[1], a[2], a[3])
      .slerp(skyQ.set(b[0], b[1], b[2], b[3]), f);
  });
}

function initDgForest(H, groundY, ctr) {
  const TD = JSON.parse(
    document.getElementById("tree-data").textContent,
  ).parts;
  const rockEl = document.getElementById("rock-data"),
    RK = rockEl ? JSON.parse(rockEl.textContent) : null;
  Promise.all(
    TD.map((p) => loadImg(p.tex)).concat(RK ? [loadImg(RK.tex)] : []),
  )
    .then((imgs) => {
      let sd = 777;
      const rnd = () => {
        sd = (sd + 0x6d2b79f5) | 0;
        let t = Math.imul(sd ^ (sd >>> 15), 1 | sd);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      // fixed seed: same forest every visit
      };
      const spots = [];
      for (let tries = 0; spots.length < DGF.count && tries < 9000; tries++) {
        const a = rnd() * Math.PI * 2,
          r = (DGF.inner + Math.sqrt(rnd()) * (DGF.outer - DGF.inner)) * H,
          sc = DGF.minS + Math.pow(rnd(), 1.5) * (DGF.maxS - DGF.minS);
        const x = ctr.x + Math.cos(a) * r,
          z = ctr.z + Math.sin(a) * r,
          // c = canopy radius in world units
          c = 1.6 * sc;
        if (r - c < DGF.inner * H) continue;
        if (x > ctr.x && Math.abs(z - ctr.z) < DGF.lane * H + c * 0.5)
          continue;
        if (spots.some((q) => Math.hypot(q.x - x, q.z - z) < 0.5 * (q.c + c)))
          // canopies may overlap, trunks may not
          continue;
        spots.push({ x, z, sc, c, yw: rnd() * Math.PI * 2 });
      }
      const grp = new THREE.Group();
      grp.visible = false;
      const westClear = (q) =>
        // the lane he walks out along after a win, straight west through the gap
        !(q.x < ctr.x && Math.abs(q.z - ctr.z) < DGF.lane * H + q.c * 0.5);
      TD.forEach((p, k) => {
        const P = [],
          N = [],
          UV = [],
          I = [];
        let base = 0;
        spots.filter(westClear).forEach((q) => {
          const co = Math.cos(q.yw),
            si = Math.sin(q.yw);
          for (let v = 0; v < p.p.length; v += 3) {
            const x = (p.p[v] + p.t[0]) * q.sc,
              y = (p.p[v + 1] + p.t[1]) * q.sc,
              z = (p.p[v + 2] + p.t[2]) * q.sc;
            P.push(q.x + x * co + z * si, groundY + y, q.z - x * si + z * co);
            N.push(
              p.n[v] * co + p.n[v + 2] * si,
              p.n[v + 1],
              -p.n[v] * si + p.n[v + 2] * co,
            );
          }
          for (const u of p.uv) UV.push(u);
          for (const i of p.i) I.push(base + i);
          base += p.p.length / 3;
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
        const tex = new THREE.Texture(imgs[k]);
        tex.flipY = false;
        tex.needsUpdate = true;
        grp.add(new THREE.Mesh(geo, ps1Mat(tex, 1)));
      });
      if (RK) {
        // boulders: your rock model stretched every which way, half buried, scattered between the trees (one more draw call)
        const rocks = [];
        for (
          let tries = 0;
          rocks.length < DGR.count && tries < 6000;
          tries++
        ) {
          const a = rnd() * Math.PI * 2,
            r = (DGF.inner + Math.sqrt(rnd()) * (DGF.outer - DGF.inner)) * H;
          let b = DGR.minS + Math.pow(rnd(), 1.6) * (DGR.maxS - DGR.minS);
          // the odd huge one
          if (rnd() < 0.06) b *= 2;
          const sx = b * (0.8 + rnd() * 0.9),
            sy = b * (0.55 + rnd() * 0.6),
            sz = b * (0.8 + rnd() * 0.9),
            // independent stretch per axis
            rr = 0.6 * Math.max(sx, sz);
          const x = ctr.x + Math.cos(a) * r,
            z = ctr.z + Math.sin(a) * r;
          // same camera-room and walk-in-lane rules as the trees
          if (r - rr < DGF.inner * H) continue;
          if (x > ctr.x && Math.abs(z - ctr.z) < DGF.lane * H + rr) continue;
          if (
            spots.some((q) => Math.hypot(q.x - x, q.z - z) < rr + 0.25 * q.sc)
          )
            // not on a trunk
            continue;
          if (
            rocks.some(
              (q) => Math.hypot(q.x - x, q.z - z) < 0.6 * (q.rr + rr),
            )
          )
            continue;
          rocks.push({ x, z, sx, sy, sz, rr, yw: rnd() * Math.PI * 2 });
        }
        const rk = rocks.filter(
          (q) =>
            !(q.x < ctr.x && Math.abs(q.z - ctr.z) < DGF.lane * H + q.rr),
        );
        const P = [],
          N = [],
          UV = [],
          I = [];
        let base = 0;
        rk.forEach((q) => {
          const co = Math.cos(q.yw),
            si = Math.sin(q.yw);
          for (let v = 0; v < RK.p.length; v += 3) {
            const x = RK.p[v] * q.sx,
              y = RK.p[v + 1] * q.sy,
              // the rock's middle is at floor level, so half of it is in the ground
              z = RK.p[v + 2] * q.sz;
            P.push(q.x + x * co + z * si, groundY + y, q.z - x * si + z * co);
            let nx = RK.n[v] / q.sx,
              ny = RK.n[v + 1] / q.sy,
              nz = RK.n[v + 2] / q.sz;
            const l = Math.hypot(nx, ny, nz) || 1;
            nx /= l;
            ny /= l;
            // normals of a stretched shape
            nz /= l;
            N.push(nx * co + nz * si, ny, -nx * si + nz * co);
          }
          for (const u of RK.uv) UV.push(u);
          for (const i of RK.i) I.push(base + i);
          base += RK.p.length / 3;
        });
        if (rk.length) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(P, 3),
          );
          geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
          geo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
          geo.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
          const tex = new THREE.Texture(imgs[TD.length]);
          tex.flipY = false;
          tex.needsUpdate = true;
          grp.add(new THREE.Mesh(geo, ps1Mat(tex, 1)));
        }
      }
      occMark(grp);
      scene.add(grp);
      // trees and boulders dither away when they are in front of someone
      dgForest = grp;
    })
    .catch((e) => console.error("dungeon forest failed", e));
}
