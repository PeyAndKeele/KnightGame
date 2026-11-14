// Mossy ruins dungeon, enemies, battle menu and turn-based battle.
// (Part 9 of 14. All parts share one scope; see README.)

/* ---------- dungeons: MOSSY RUINS and THE TOMB ----------
 Every dungeon is one entry of DUNGEONS below, and the same code (enterDungeon, spawnEnemies, the waves, the chest, leaveDungeon) runs all of them; `dg` is the one you are in.
 A dungeon's model is a Blockbench glTF baked to world space and merged per material (scripts/bake-gltf.py). Its middle always lands under the knight's start spot (the circle); the knight
 walks in through the gate on the east (+x) side onto the circle and drops into Idle, and the camera then drifts between a set of shots, Resident-Evil style. This is where the turn-based fights
 happen. Esc / MENU leaves.
 Fields of an entry:
   model     the id of its baked data file (ruins-data, tomb-data)
   scale     knight-heights per model unit (the ruins were 1.6 once; smaller ruins make the knight look bigger)
   yaw       turns the model about the circle (radians); the tomb's long hall runs along z in its file, so it is turned 90 deg to run east-west like the ruins' courtyard
   spot      which MAP spot (in MAP_AREAS.greenfield) opens it
   start     where the walk-in starts, in knight-heights east of the circle (outside the gate)
   enemy     the arena: the knight holds the circle facing west and the enemy line stands across from him facing him (floor rings mark the slots).
             dist = how far west of him the line is, gap = spacing along the line, both in knight-heights; n = 0 removes the markers
   fog       fog near/far in knight-heights, pushed out so the whole place can be seen
   look      null = the world's own sky and light (outdoors). Otherwise the dungeon is underground: { fog: the fog and background colour, tint: what every surface is multiplied by }
   forest    true = the ring of trees and boulders (dgForest) stands around it
   intro     the walk-in camera shot, shots = the shots it cycles through while fighting, chestShot = the shot for the chest scene (see 05-chest-save-loot.js)
             yaw is where the camera sits around the knight (0 = south, 90 = east/outside the gate, 180 = north, -90 = west, in front of him), drift = slow pan in deg/s,
             pitch in radians, dist in knight-heights, ty = look-at height above his middle in knight-heights, mid = where it looks between him (0) and the enemy line (1)
   chestX    how far west of the circle he stands for the chest scene, in knight-heights
   waves     the fights in a row, see WAVES below
   group / slots  filled in when the model has loaded (the model, and the floor rings) */
const RUINS_SCALE = 1.15,
  TOMB_SCALE = 1.8,
  // the tomb's inside is bigger than the ruins' scale: its doorways have to let the knight through and the hall has to hold the whole battle line
  TOMB_ENTRY_SCALE = RUINS_SCALE;
// the tomb's entrance on the map is as big as the ruins
const DG_BLEND_MIN = 3.2,
  // seconds a move between two shots takes (longer for bigger swings)
  DG_BLEND_MAX = 8;
const DUNGEONS = {
  ruins: {
    model: "ruins-data",
    scale: RUINS_SCALE,
    yaw: 0,
    spot: 0,
    start: 4.2,
    enemy: { n: 3, dist: 2.2, gap: 0.6 },
    fog: [4.5, 10],
    look: null,
    forest: true,
    intro: { yaw: 112, drift: 1.2, pitch: 0.2, dist: 3.0, ty: 0.2, mid: 0 },
    // every shot orbits the CENTER of the battlefield (mid 0.5 = halfway between the knight and the enemy line) from far enough back that all of them and their health bars stay in frame; anything in the way dithers
    shots: [
      // from the gate, toward the enemy line
      { yaw: 78, drift: 1.6, pitch: 0.2, dist: 4.2, ty: 0.12, mid: 0.5 },
      // from the enemy side
      { yaw: -78, drift: 2.0, pitch: 0.16, dist: 4.2, ty: 0.12, mid: 0.5 },
      // north, wide duel
      { yaw: 180, drift: 2.0, pitch: 0.32, dist: 4.4, ty: 0.1, mid: 0.5 },
      // south, wide duel
      { yaw: 0, drift: -2.0, pitch: 0.32, dist: 4.4, ty: 0.1, mid: 0.5 },
      // near-overhead duel
      { yaw: -30, drift: -3.0, pitch: 1.0, dist: 4.2, ty: 0.0, mid: 0.5 },
      // low, from behind the enemies
      { yaw: -100, drift: 2.0, pitch: 0.14, dist: 4.2, ty: 0.12, mid: 0.5 },
      // low, at the gate
      { yaw: 70, drift: 1.8, pitch: 0.12, dist: 4.2, ty: 0.12, mid: 0.5 },
    ],
    // yaw 35 = from just east of south, outside the fence and clear of the walls, so his side, the lid and the chest's front are all in view
    chestShot: { yaw: 35, drift: 0.6, pitch: 0.2, dist: 3.0, ty: 0.2, mid: 0 },
    // (the fence is at ~3.45, the trees start at 5.6)
    chestX: 4.1,
    waves: [
      ["slime", "mob", "slime"],
      ["mob", "slime", "mob"],
      ["slime", "golem", "slime"],
    ],
    group: null,
    slots: null,
  },
  /* THE TOMB: a stone hall under the Greenfield, 1.94 x 3.3 file units inside, with a door at each end and a colonnade along each side. It is dark: black fog, no sky, no grass.
   The camera stays inside the hall for every shot (the hall is about 2.9 knight-heights from the circle to each end door and 1.75 to each side), so unlike the ruins no wall ever has to dither away. */
  tomb: {
    model: "tomb-data",
    scale: TOMB_SCALE,
    yaw: Math.PI / 2,
    spot: 1,
    start: 3.5,
    enemy: { n: 3, dist: 2.0, gap: 0.6 },
    fog: [3.0, 8.5],
    look: { fog: 0x07080d, tint: [0.62, 0.7, 0.8] },
    forest: false,
    // straight behind him, so the camera follows him through the doorway
    intro: { yaw: 95, drift: 0.4, pitch: 0.2, dist: 2.5, ty: 0.2, mid: 0 },
    shots: [
      // from the door, toward the enemy line
      { yaw: 80, drift: 1.2, pitch: 0.2, dist: 3.2, ty: 0.12, mid: 0.5 },
      // from the door's corners
      { yaw: 60, drift: 1.4, pitch: 0.3, dist: 3.0, ty: 0.12, mid: 0.5 },
      { yaw: 120, drift: -1.4, pitch: 0.3, dist: 3.0, ty: 0.12, mid: 0.5 },
      // high duel
      { yaw: 90, drift: -1.0, pitch: 0.75, dist: 3.0, ty: 0.05, mid: 0.5 },
      // low, close, from behind the enemies
      { yaw: -120, drift: 1.2, pitch: 0.22, dist: 2.4, ty: 0.12, mid: 0.5 },
      // low, at the door
      { yaw: 100, drift: 1.0, pitch: 0.12, dist: 2.4, ty: 0.12, mid: 0.5 },
    ],
    // from the south-east corner of the hall: his side, the lid and the chest's front are all in view
    chestShot: { yaw: 60, drift: 0.6, pitch: 0.2, dist: 2.2, ty: 0.2, mid: 0 },
    chestX: 1.5,
    waves: [
      ["mob", "slime", "mob"],
      ["slime", "mob", "slime"],
      ["mob", "golem", "mob"],
    ],
    group: null,
    slots: null,
  },
};
// the dungeon you are in (or the one you were last in)
let dg = DUNGEONS.ruins;
let dungeon = false,
  dgBusy = false,
  dgState = "walkin",
  fogBak = null,
  hudBak = "";
const dgCam = { yaw: 0, pitch: 0.2, dist: 3.5, ty: 0.2, mid: 0 };
let dgBlendT = 3;
let dgShot = dg.intro,
  dgFrom = null,
  dgBlend = 1,
  dgT = 0,
  dgDur = 1e9,
  dgLast = -1,
  dgYaw = 0;
/* ---------- campfire flame: tiny_fire.gif (4 frames, 200 ms each, cropped to a strip), a camera-facing sprite sitting in the log pile ----------
 Positions are in the ruins file's own units (the group scales them). */
const FIRE_FRAMES = 4,
  FIRE_MS = 200,
  FIRE_ASPECT = 11 / 12;
const FIRE_POS = [-0.17, 0.28, -1.665],
  // centre of the flame (in the log pile), and its height; the width follows the gif's proportions
  FIRE_H = 0.4;
const FIRE_ATLAS =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAMCAYAAAAZKF83AAABAElEQVR4nMWTQQqDMBBFx6RQqB5A6EK9U29Z76QuBA+ggoskXZQpafjTji2lH2Yhvvnzx0QKgYjrWlUhfpZKy/2iYBhNoF8t9443BFQ0ltq6CuhdLA2zh9PwMLC2WbuYlkN82vcUuK2rUDSW8rN5NKFhiEPmEidJM98gWDLTcBo/FFzra1L4VN6Lt5w7R0VjYXPMSaexh0M8z2f+gBrsMaNTed80PxtaRi9uzByz/AEkv5S79EO2xxcGjpvWSQ6LwiC5Lag45JtmEB3sES7+0jzWpR+yuXO0jJ7WyX8cOpWRzN0WaJ08LaOnuXPER/cty1wqrW8Wotsm/Qjonv2LvQFD/JObPH8xrAAAAABJRU5ErkJggg==";
let campfire = null;
const fireV = new THREE.Vector3();
function initFire(grp) {
  loadImg(FIRE_ATLAS)
    .then((img) => {
      const tex = new THREE.Texture(img);
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.repeat.set(1 / FIRE_FRAMES, 1);
      tex.needsUpdate = true;
      const spr = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          fog: false,
        }),
      );
      spr.position.set(FIRE_POS[0], FIRE_POS[1], FIRE_POS[2]);
      spr.scale.set(FIRE_H * FIRE_ASPECT, FIRE_H, 1);
      spr.renderOrder = 5;
      grp.add(spr);
      campfire = {
        spr,
        tex,
        t: (Math.random() * FIRE_FRAMES * FIRE_MS) / 1000,
        fi: -1,
      };
    })
    .catch((e) => console.error("fire load failed", e));
}
function updateFire(dt) {
  if (!campfire || !DUNGEONS.ruins.group || !DUNGEONS.ruins.group.visible)
    return;
  campfire.t += dt;
  const fi = Math.floor((campfire.t * 1000) / FIRE_MS) % FIRE_FRAMES;
  if (fi !== campfire.fi) {
    campfire.fi = fi;
    campfire.tex.offset.x = fi / FIRE_FRAMES;
  }
  const near = U.uFogNear.value,
    far = U.uFogFar.value,
    d = camera.position.distanceTo(campfire.spr.getWorldPosition(fireV)),
    f = Math.min(1, Math.max(0, (d - near) / (far - near)));
  // fades into the fog like everything else
  campfire.spr.material.opacity = 1 - f * f * (3 - 2 * f);
}
/* Z-fighting fix for the ruins: the model has triangles that sit exactly on top of other triangles (36 in one wall part, 420 in the spike palisade). Two surfaces at the same depth fight for the pixel and flicker as the camera moves, so each repeated triangle is dropped and only the first is kept. */
function dropDuplicateTris(pos, idx) {
  const seen = new Set(),
    out = [],
    q = (v) =>
      Math.round(pos[v * 3] * 1000) +
      "," +
      Math.round(pos[v * 3 + 1] * 1000) +
      "," +
      Math.round(pos[v * 3 + 2] * 1000);
  for (let t = 0; t < idx.length; t += 3) {
    const key = [q(idx[t]), q(idx[t + 1]), q(idx[t + 2])].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  return out;
}
/* ---------- the dungeons' entrances on the map ----------
 Each dungeon also stands at its spot on the map (a second copy of its model, or its own entrance model: the tomb has one, tombentry-data), turned toward the knight - MAP_PROP_FACE of the way
 (1 = its door points straight at him, 0 = it keeps the file's direction). The trees near it are moved aside. mapProps = { g: the group, x, z: where it stands, R: how far trees are pushed out,
 area: which area of the map it is in, done: trees already cleared }. */
const MAP_PROP_FACE = 0.6;
const mapProps = [];
function clearTreesForMapProps() {
  if (!greenTreeGroup) return;
  mapProps.forEach((m) => {
    if (m.done) return;
    m.done = true;
    greenTreeGroup.children.forEach((tr) => {
      let dx = tr.position.x - m.x,
        dz = tr.position.z - m.z,
        d = Math.hypot(dx, dz);
      if (d >= m.R) return;
      if (d < 1e-3) {
        dx = 1;
        dz = 0;
        d = 1;
      }
      tr.position.x = m.x + (dx / d) * m.R;
      // pushed straight out to just beyond the model
      tr.position.z = m.z + (dz / d) * m.R;
    });
  });
}
function updateMapProps() {
  mapProps.forEach((m) => {
    m.g.visible = forest && !dungeon && mapArea === m.area;
  });
}
/* reads a baked model (ruins-data format, see scripts/bake-gltf.py) from the page and builds it: resolves with { RD, grp } - RD the data (RD.c is the point that sits on the circle),
 grp a group of one mesh per material, in the file's own units and every mesh an obstacle (dithers when it is in front of someone) */
function loadBakedModel(id) {
  const el = document.getElementById(id);
  if (!el) return Promise.reject(new Error(id + " is not on the page"));
  const RD = JSON.parse(el.textContent);
  return Promise.all(RD.tex.map(loadImg)).then((imgs) => {
    const grp = new THREE.Group();
    RD.parts.forEach((pt) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pt.p, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(pt.n, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(pt.uv, 2));
      // identical triangles stacked on each other flicker (z-fighting) - keep one of each
      geo.setIndex(dropDuplicateTris(pt.p, pt.i));
      let tex;
      if (pt.t >= 0) {
        tex = new THREE.Texture(imgs[pt.t]);
      } else {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 1;
        const g = cv.getContext("2d");
        g.fillStyle = "#d9d9d9";
        g.fillRect(0, 0, 1, 1);
        tex = new THREE.CanvasTexture(cv);
      }
      tex.flipY = false;
      const m = new THREE.Mesh(geo, ps1Mat(tex, 1));
      m.frustumCulled = false;
      if (pt.nocam) m.userData.noCam = true;
      grp.add(m);
    });
    // every wall and pillar can dither away when it is in front of someone
    occMark(grp);
    return { RD, grp };
  });
}
/* puts a copy of a baked model on the map: model = the group from loadBakedModel, c = the point of it that stands on the spot, scale = knight-heights per model unit,
 doorAngle = which way its door faces in the file (angle in the ground plane: 0 = +x, PI/2 = -z, so the ruins' gate on +x is 0 and the tomb's door on -z is PI/2) */
function addMapProp(model, c, scale, doorAngle, area, spot, H, groundY, ctr) {
  const S = scale * H,
    view = model.clone(true),
    wx = ctr.x + spot.x * H,
    wz = ctr.z + spot.z * H,
    holder = new THREE.Group();
  view.scale.setScalar(S);
  view.position.set(-S * c[0], -S * c[1], -S * c[2]);
  holder.add(view);
  holder.position.set(wx, groundY + 0.003 * H, wz);
  // the angle that would make the door point at him, the way round that is shortest, and then only part of the way
  const toward = Math.atan2(-(ctr.z - wz), ctr.x - wx);
  let turn = toward - doorAngle;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  holder.rotation.y = turn * MAP_PROP_FACE;
  scene.add(holder);
  holder.updateMatrixWorld(true);
  const sz = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
  mapProps.push({
    g: holder,
    x: wx,
    z: wz,
    R: 0.45 * Math.hypot(sz.x, sz.z) + 0.4 * H,
    area: area,
    done: false,
  });
  clearTreesForMapProps();
}
/* floor rings where a dungeon's enemy line will stand, facing the knight */
function makeSlots(d, H, groundY, ctr) {
  const sl = new THREE.Group();
  sl.visible = false;
  for (let k = 0; k < d.enemy.n; k++) {
    const r = new THREE.Mesh(
      new THREE.RingGeometry(0.2 * H, 0.3 * H, 14),
      new THREE.MeshBasicMaterial({
        color: 0xb02a2a,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
      }),
    );
    r.rotation.x = -Math.PI / 2;
    r.position.set(
      ctr.x - d.enemy.dist * H,
      groundY + 0.006 * H,
      ctr.z + (k - (d.enemy.n - 1) / 2) * d.enemy.gap * H,
    );
    sl.add(r);
  }
  scene.add(sl);
  return sl;
}
/* puts a dungeon's model on the circle: the model's own middle point (RD.c) goes under the knight, turned by d.yaw about it. Hidden until you go in. */
function placeDungeon(d, RD, grp, H, groundY, ctr) {
  const S = d.scale * H,
    holder = new THREE.Group();
  grp.scale.setScalar(S);
  grp.position.set(-S * RD.c[0], -S * RD.c[1], -S * RD.c[2]);
  holder.add(grp);
  holder.rotation.y = d.yaw;
  holder.position.set(ctr.x, groundY + 0.003 * H, ctr.z);
  holder.visible = false;
  scene.add(holder);
  d.group = holder;
  d.slots = makeSlots(d, H, groundY, ctr);
}
/* ---------- dungeon props: barrels, skulls, small pouches, potions ----------
 Four little baked models (barrel-data, skull-data, smallpouch-data, potionprop-data) are cloned into a dungeon's model group, so they are in the dungeon's own file units and turn / scale with it
 (and are only on screen while you are inside). PROP_TALL = how tall each one stands in KNIGHT-HEIGHTS, so a barrel is the same size in the ruins and in the tomb alike.
 Positions are in the model's file units (see the plans above each list). The potion's glass is see-through, so it gets the same translucent-glass treatment as the bottle in his hand.
 Any prop can be tipped (opt.tilt = [degrees about x, degrees about z]), laid on its side (opt.lie), or leaned toward a point (opt.lean = [x, z, degrees]); a skull can be told to look toward a point (opt.face);
 a pouch is sunk (PROP_SINK) and squashed (PROP_SQUASH) a little so its round belly does not show. */
const PROP_FILES = {
    barrel: "barrel-data",
    skull: "skull-data",
    pouch: "smallpouch-data",
    potion: "potionprop-data",
  },
  PROP_TALL = { barrel: 0.62, skull: 0.18, pouch: 0.2, potion: 0.25 },
  // how far a prop sinks into what it stands on, as a fraction of its own height
  PROP_SINK = { pouch: 0.3 },
  // [sideways, up, sideways] stretch
  PROP_SQUASH = { pouch: [1.12, 0.86, 1.12] },
  // the barrel's hoops are its 2nd texture: they get uShine (the metal look)
  BARREL_HOOP_TEX = 1;
let propLib = null;
function propAlpha(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let mx = 0;
  for (let i = 3; i < d.length; i += 4) mx = Math.max(mx, d[i]);
  return mx / 255;
}
/* loads the four prop models once: resolves with { barrel: { g: group, lo: lowest y, h: height, w: width }, skull: ..., pouch: ..., potion: ... } (in each model's own units) */
function loadProps() {
  if (propLib) return propLib;
  const keys = Object.keys(PROP_FILES);
  propLib = Promise.all(keys.map((k) => loadBakedModel(PROP_FILES[k]))).then(
    (rs) => {
      const lib = {};
      rs.forEach(({ RD, grp }, i) => {
        const k = keys[i];
        let lo = Infinity,
          hi = -Infinity,
          wx = 0,
          wz = 0;
        RD.parts.forEach((pt, j) => {
          for (let q = 0; q < pt.p.length; q += 3) {
            if (pt.p[q + 1] < lo) lo = pt.p[q + 1];
            if (pt.p[q + 1] > hi) hi = pt.p[q + 1];
            wx = Math.max(wx, Math.abs(pt.p[q]));
            wz = Math.max(wz, Math.abs(pt.p[q + 2]));
          }
          const m = grp.children[j].material;
          if (k === "barrel" && pt.t === BARREL_HOOP_TEX)
            m.uniforms.uShine.value = 1;
          // glass: a texture that is see-through all over is drawn as translucent glass (the game's shader drops anything under 50% alpha)
          const mp = m.uniforms.map.value;
          if (k === "potion" && mp && mp.image && propAlpha(mp.image) < 0.95) {
            m.fragmentShader = m.fragmentShader
              .replace("if(tx.a<0.5) discard;", "if(tx.a<0.05) discard;")
              .replace(
                "gl_FragColor=vec4(c,1.0);",
                "gl_FragColor=vec4(c,tx.a);",
              );
            m.transparent = true;
            m.depthWrite = false;
            m.needsUpdate = true;
            grp.children[j].renderOrder = 2;
          }
        });
        lib[k] = { g: grp, lo: lo, h: hi - lo, w: 2 * Math.max(wx, wz) };
      });
      return lib;
    },
  );
  return propLib;
}
/* the yaw (degrees) that makes a skull at (x, z) look toward (tx, tz): the skull model's face is on its -z side */
function faceYaw(x, z, tx, tz) {
  return (Math.atan2(-(tx - x), -(tz - z)) * 180) / Math.PI;
}
/* stands one prop in a dungeon's group: its lowest point on height y, at (x, z), turned yaw degrees; dScale = the dungeon's scale (knight-heights per file unit).
 opt (all optional): tilt [a, b] = tipped a degrees about x and b about z; lean [tx, tz, deg] = tipped deg degrees toward (tx, tz), keeping its rim on the floor (yaw then only spins it on its own axis);
 lie = laid on its side, (x, z) being the middle of it; face [tx, tz] = (skulls) yaw is added to the direction that looks at that point. */
function putProp(parent, lib, kind, x, y, z, yaw, dScale, opt) {
  const p = lib[kind];
  if (!p) return null;
  opt = opt || {};
  const T = THREE.MathUtils.degToRad,
    s = PROP_TALL[kind] / (dScale * p.h),
    sq = PROP_SQUASH[kind] || [1, 1, 1],
    o = p.g.clone(true),
    tilt = new THREE.Group(),
    piv = new THREE.Group();
  let fy = yaw;
  if (opt.face && kind === "skull")
    fy += faceYaw(x, z, opt.face[0], opt.face[1]);
  y -= (PROP_SINK[kind] || 0) * (PROP_TALL[kind] / dScale);
  o.scale.set(s * sq[0], s * sq[1], s * sq[2]);
  o.position.set(0, -s * sq[1] * p.lo, 0);
  const t = opt.tilt || [0, 0];
  tilt.rotation.set(T(t[0]), 0, T(t[1]));
  if (opt.lean) {
    // turn the pivot so its +x points at the target, then tip the top toward it
    piv.rotation.y = Math.atan2(-(opt.lean[1] - z), opt.lean[0] - x);
    tilt.rotation.z -= T(opt.lean[2]);
    o.rotation.y = T(yaw);
    y += ((s * sq[0] * p.w) / 2) * Math.sin(T(opt.lean[2]));
  } else piv.rotation.y = T(fy);
  if (opt.lie) {
    // on its side: the body's radius up, and the middle of it (not its foot) on (x, z)
    const a = T(fy),
      len = s * sq[1] * p.h;
    tilt.rotation.z = T(90);
    y += (s * sq[0] * p.w) / 2;
    x += 0.5 * len * Math.cos(a);
    z -= 0.5 * len * Math.sin(a);
  }
  tilt.add(o);
  piv.add(tilt);
  piv.position.set(x, y, z);
  parent.add(piv);
  return piv;
}
/* barrels from a list of:
 ["stand", x, z, spin]                      one standing on the floor
 ["lean", ax, az, dir, deg, spin]           one leaning on the barrel standing at (ax, az): it sits dir degrees round from it (0 = +x, 90 = +z, 180 = -x, -90 = -z), tipped deg degrees toward it, and rests against its side
 ["wall", x, z, dir, deg, spin]             one leaning back against a wall that lies in direction dir from it
 Stagger: no two barrels are in a line, they spin differently, and the leaners are tipped different amounts. */
function putBarrels(grp, lib, list, y, dScale) {
  const b = lib.barrel,
    h = PROP_TALL.barrel / dScale,
    r = ((h / b.h) * b.w) / 2,
    T = THREE.MathUtils.degToRad;
  list.forEach((q) => {
    if (q[0] === "stand") putProp(grp, lib, "barrel", q[1], y, q[2], q[3], dScale);
    else if (q[0] === "lean") {
      const a = T(q[3]),
        th = T(q[4]),
        D = r + r / Math.cos(th) + 0.8 * h * Math.sin(th);
      putProp(
        grp,
        lib,
        "barrel",
        q[1] + D * Math.cos(a),
        y,
        q[2] + D * Math.sin(a),
        q[5],
        dScale,
        { lean: [q[1], q[2], q[4]] },
      );
    } else
      putProp(grp, lib, "barrel", q[1], y, q[2], q[5], dScale, {
        lean: [q[1] + Math.cos(T(q[3])), q[2] + Math.sin(T(q[3])), q[4]],
      });
  });
}
/* MOSSY RUINS: barrels in three corners of the courtyard, in leaning groups (checked against the model's walls, the fire and the fight: the knight's circle, the enemy line and the gate are left clear).
 Looking down the courtyard (gate on the east / +x side): the south-west corner by the broken wall, the south-east corner under the tower, and the north-east corner between the east wall and the big stones. */
const RUINS_BARRELS = [
  ["stand", -1.15, 0.5, 20],
  ["stand", -0.76, 0.56, 80],
  ["lean", -0.76, 0.56, 0, 15, 140],
  ["stand", 0.85, 0.38, 50],
  ["lean", 0.85, 0.38, 180, 14, 110],
  ["stand", 0.78, -1.55, 160],
  ["lean", 0.78, -1.55, 180, 15, 15],
];
function decorateRuins(grp, RD, lib, dScale) {
  putBarrels(grp, lib, RUINS_BARRELS, RD.c[1], dScale);
}
/* THE TOMB: barrels in the four corners of the hall, in leaning groups (the doorways, the enemy line and the knight's circle stay clear), and skulls, pouches and potions on the 12 stone shelves in the niches behind the colonnade.
 The hall runs along z in the file: its end walls are at z = -1.69 and +1.61, the side colonnades at x = -0.98 and +0.97, the floor is y = 0. */
const TOMB_BARRELS = [
  // south-west: two standing, one leaning on the first from along the wall
  ["stand", -0.86, -1.54, 20],
  ["stand", -0.62, -1.49, 75],
  ["lean", -0.86, -1.54, 90, 15, 130],
  // south-east: one standing, one leaning on it, one leaning back on the east wall
  ["stand", 0.85, -1.55, 70],
  ["lean", 0.85, -1.55, 180, 14, 20],
  ["wall", 0.79, -1.28, 0, 12, 100],
  // north-west
  ["stand", -0.87, 1.5, 40],
  ["lean", -0.87, 1.5, 0, 14, 110],
  ["stand", -0.74, 1.21, 150],
  // north-east
  ["stand", 0.85, 1.5, 10],
  ["stand", 0.6, 1.45, 95],
  ["lean", 0.85, 1.5, -90, 15, 60],
];
/* the middle of the hall: the skulls look toward it (+/- the yaw each one is given) */
const TOMB_MID = [0.008, -0.04];
/* the shelves: 3 tiers (the stone tops are at y = 0.422, 0.984 and 1.484), 2 bays on each side of the hall (centred at z = -0.69 and +0.69), the west niches at x = -1.155 and the east ones at x = 1.14.
 Each item is [kind, dz = along the shelf, dx = in / out of the niche, yaw, tilt about x, tilt about z]. A skull's yaw is how far it is turned off "looking at the middle of the hall". */
const TOMB_SHELF_Y = [0.422, 0.984, 1.484],
  TOMB_SHELVES = [
    // west side (x = -1.155), bay at z = -0.69
    { x: -1.155, z: -0.69, flip: 0, tier: 0, items: [
      ["potion", -0.27, 0.03, 0, 0, 7],
      ["potion", -0.1, -0.03, 40, 0, -9],
      ["pouch", 0.2, 0, 25, 4, -5],
    ] },
    { x: -1.155, z: -0.69, flip: 0, tier: 1, items: [
      ["skull", -0.05, 0.02, 10, -6, 4],
    ] },
    { x: -1.155, z: -0.69, flip: 0, tier: 2, items: [
      ["pouch", -0.27, 0, -20, -5, 4],
      ["skull", 0.12, -0.02, -15, 5, -6],
      ["potion", 0.3, 0.03, 0, 0, -8],
    ] },
    // west side, bay at z = +0.69
    { x: -1.155, z: 0.69, flip: 0, tier: 0, items: [
      ["skull", -0.22, 0, -20, 6, 3],
      ["skull", 0.08, 0.03, 18, -5, 5],
    ] },
    { x: -1.155, z: 0.69, flip: 0, tier: 1, items: [
      ["pouch", -0.28, 0.02, 60, 3, 5],
      ["potion", 0, -0.03, 0, 0, 0],
      ["potion", 0.17, 0.03, 70, 0, 10],
    ] },
    { x: -1.155, z: 0.69, flip: 0, tier: 2, items: [
      ["potion", 0.2, 0, 0, 0, -6],
    ] },
    // east side (x = 1.14), bay at z = -0.69
    { x: 1.14, z: -0.69, flip: 180, tier: 0, items: [
      ["pouch", -0.12, 0, -40, 5, -4],
      ["potion", 0.2, 0.03, 0, 0, 8],
    ] },
    { x: 1.14, z: -0.69, flip: 180, tier: 1, items: [
      ["pouch", -0.2, -0.02, 15, -4, 3],
      ["skull", 0.2, 0.02, 20, 4, -6],
    ] },
    { x: 1.14, z: -0.69, flip: 180, tier: 2, items: [
      ["potion", -0.25, 0.02, 0, 0, 6],
      ["potion", -0.08, -0.03, 30, 0, -8],
      ["skull", 0.22, 0, -10, -5, 5],
    ] },
    // east side, bay at z = +0.69
    { x: 1.14, z: 0.69, flip: 180, tier: 0, items: [
      ["skull", -0.26, 0.02, 15, 4, -4],
      ["potion", 0.02, 0, 0, 0, 7],
    ] },
    { x: 1.14, z: 0.69, flip: 180, tier: 1, items: [
      ["pouch", 0.12, 0, 80, -3, 5],
    ] },
    { x: 1.14, z: 0.69, flip: 180, tier: 2, items: [
      ["skull", -0.18, -0.02, -25, 5, 5],
      ["pouch", 0.16, 0.02, -30, 4, -4],
    ] },
  ];
function decorateTomb(grp, RD, lib, dScale) {
  const y = RD.c[1];
  putBarrels(grp, lib, TOMB_BARRELS, y, dScale);
  TOMB_SHELVES.forEach((sh) =>
    sh.items.forEach((it) =>
      putProp(
        grp,
        lib,
        it[0],
        sh.x + it[2],
        TOMB_SHELF_Y[sh.tier] + 0.004,
        sh.z + it[1],
        it[0] === "skull" ? it[3] : sh.flip + it[3],
        dScale,
        { tilt: [it[4], it[5]], face: it[0] === "skull" ? TOMB_MID : null },
      ),
    ),
  );
  addTombFurniture(grp, RD, lib, dScale);
}
/* THE TOMB'S TABLE AND LANTERNS.
 The table (table-data = table.gltf) stands against the west colonnade, in front of the gap between the two bays of shelves, its long side along the wall. `tall` = how tall it stands in knight-heights;
 x / z = where its middle is on the floor (the tomb file's units), yaw = which way its long side runs (-90 = along z, the length of the hall). On it (dz = along the table, dx = across it): a pouch, a skull looking
 toward the middle of the hall, a potion lying on its side and a small lantern (the shop's lantern again) - spread out so most of the top stays bare.
 The big lantern is the shop's lantern (lantern-data) hung from the ceiling by the shop sign's chain (chain-data: two links, tiled): the top link is sunk into the ceiling slab (the ceiling's underside is at
 y = CEIL), the bottom link goes through the lantern's ring. `ringTop` = about how high the top of the ring hangs, `tall` = the lantern's height in knight-heights.
 BOTH lanterns are LIGHTS, just like the shop's: a warm point light at the bulb that lights SHINY things only (the knight's armour, the barrels' hoops ...) and fades out over `range` knight-heights -
 see updateTombLamp, which updateShopLamp calls. The hanging one uses the shaders' first lamp slot, the one on the table the second. */
const TOMB_TABLE = {
    x: -0.76,
    z: -0.04,
    tall: 0.45,
    yaw: -90,
    items: [
      { k: "pouch", dz: -0.24, dx: 0.02, yaw: 35, tilt: [3, -5] },
      { k: "skull", dz: -0.07, dx: -0.05, yaw: 0, tilt: [-4, 3] },
      { k: "potion", dz: 0.06, dx: 0.06, yaw: 25, lie: true },
      { k: "lamp", dz: 0.21, dx: -0.02, yaw: 0 },
    ],
  },
  TOMB_LAMP = {
    x: TOMB_TABLE.x,
    z: TOMB_TABLE.z,
    ringTop: 1.2,
    ceil: 1.938,
    tall: 0.3,
    color: [1.0, 0.78, 0.45],
    intensity: 1.3,
    range: 3.4,
    spec: 14,
  },
  // the lantern standing on the table (same size as the hanging one)
  TOMB_TABLE_LAMP = {
    color: [1.0, 0.8, 0.5],
    intensity: 1.1,
    range: 2.4,
    spec: 12,
  },
  // the shop sign's chain links and the lantern's ring, in the models' own units
  LINK_LEN = 0.0875,
  LINK_PITCH = 0.046875;
let tombLamps = [];
function bakedBounds(RD) {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  RD.parts.forEach((pt) => {
    for (let q = 0; q < pt.p.length; q += 3)
      for (let a = 0; a < 3; a++) {
        if (pt.p[q + a] < lo[a]) lo[a] = pt.p[q + a];
        if (pt.p[q + a] > hi[a]) hi[a] = pt.p[q + a];
      }
  });
  return { lo: lo, hi: hi };
}
function addTombFurniture(grp, RD, lib, dScale) {
  Promise.all([
    loadBakedModel("table-data"),
    loadBakedModel("lantern-data"),
    loadBakedModel("chain-data"),
  ])
    .then(([T, L, C]) => {
      const y0 = RD.c[1];
      // ---- the table: its middle on (x, z), its feet on the floor
      const tb = bakedBounds(T.RD),
        ts = TOMB_TABLE.tall / dScale / (tb.hi[1] - tb.lo[1]),
        th = new THREE.Group();
      T.grp.position.set(
        -(tb.lo[0] + tb.hi[0]) / 2,
        -tb.lo[1],
        -(tb.lo[2] + tb.hi[2]) / 2,
      );
      th.add(T.grp);
      th.scale.setScalar(ts);
      th.rotation.y = THREE.MathUtils.degToRad(TOMB_TABLE.yaw);
      th.position.set(TOMB_TABLE.x, y0, TOMB_TABLE.z);
      grp.add(th);
      const topY = y0 + TOMB_TABLE.tall / dScale + 0.004,
        // the lantern model: its size, and where its bulb is
        lb = bakedBounds(L.RD),
        ls = TOMB_LAMP.tall / dScale / (lb.hi[1] - lb.lo[1]);
      let bulb = null;
      L.grp.children.forEach((m, j) => {
        const mat = m.material;
        if (L.RD.parts[j].emit) {
          // the bulb glows instead of being lit
          mat.uniforms.uEmit.value = 1;
          const bb = bakedBounds({ parts: [L.RD.parts[j]] });
          bulb = [
            (bb.lo[0] + bb.hi[0]) / 2,
            (bb.lo[1] + bb.hi[1]) / 2,
            (bb.lo[2] + bb.hi[2]) / 2,
          ];
        } else mat.uniforms.uShine.value = 0.55;
        // (the metal of the shop's lantern)
      });
      tombLamps = [];
      // ---- what stands on the table
      TOMB_TABLE.items.forEach((it) => {
        const x = TOMB_TABLE.x + it.dx,
          z = TOMB_TABLE.z + it.dz;
        if (it.k === "lamp") {
          const lg = new THREE.Group(),
            ly = topY - lb.lo[1] * ls;
          lg.add(L.grp.clone(true));
          lg.scale.setScalar(ls);
          lg.rotation.y = THREE.MathUtils.degToRad(it.yaw);
          lg.position.set(x, ly, z);
          grp.add(lg);
          if (bulb)
            tombLamps.push(
              Object.assign({ slot: 2, grp: grp }, TOMB_TABLE_LAMP, {
                local: new THREE.Vector3(
                  x + bulb[0] * ls,
                  ly + bulb[1] * ls,
                  z + bulb[2] * ls,
                ),
                phase: 2.7,
              }),
            );
        } else
          putProp(grp, lib, it.k, x, topY, z, it.yaw, dScale, {
            tilt: it.tilt,
            lie: it.lie,
            face: it.k === "skull" ? TOMB_MID : null,
          });
      });
      // ---- the big lantern, hung by the chain
      const pitch = LINK_PITCH * ls,
        yTop = TOMB_LAMP.ceil - 0.02,
        // an even number of links, so the bottom one hangs across the ring (the ring is turned the other way from it)
        links =
          2 *
          Math.max(
            1,
            Math.round(
              (yTop - (TOMB_LAMP.ringTop - (LINK_LEN / 2) * ls)) / (2 * pitch),
            ),
          ),
        ringY = yTop - links * pitch,
        ringLocalY = lb.hi[1] - LINK_LEN / 2,
        lh = new THREE.Group();
      lh.add(L.grp);
      lh.scale.setScalar(ls);
      lh.position.set(TOMB_LAMP.x, ringY - ringLocalY * ls, TOMB_LAMP.z);
      grp.add(lh);
      if (bulb)
        tombLamps.push(
          Object.assign({ slot: 1, grp: grp }, TOMB_LAMP, {
            local: new THREE.Vector3(
              TOMB_LAMP.x + bulb[0] * ls,
              lh.position.y + bulb[1] * ls,
              TOMB_LAMP.z + bulb[2] * ls,
            ),
            phase: 0,
          }),
        );
      C.grp.children.forEach((m) => (m.material.uniforms.uShine.value = 0.55));
      // two links per tile, the tiles turned a quarter so the lowest link is the one that crosses the ring
      for (let k = 0; k < links / 2; k++) {
        const ch = k === 0 ? C.grp : C.grp.clone(true);
        ch.scale.setScalar(ls);
        ch.rotation.y = Math.PI / 2;
        ch.position.set(TOMB_LAMP.x, yTop - 2 * k * pitch, TOMB_LAMP.z);
        grp.add(ch);
      }
    })
    .catch((e) => console.error("tomb furniture failed", e));
}
/* the tomb lanterns' light: called every frame by updateShopLamp whenever the shop is not on screen (they share the two lamp slots of the shaders: uLampPos / uLampP / uLampCol and the uLamp2... ones).
 They are on while you are in the tomb. A slow, small flicker keeps them from looking like bare bulbs. */
function updateTombLamp() {
  if (
    !tombLamps.length ||
    !dungeon ||
    dg !== DUNGEONS.tomb ||
    !dg.group ||
    !dg.group.visible
  )
    return;
  const t = performance.now() / 1000;
  tombLamps.forEach((L) => {
    L.grp.updateWorldMatrix(true, false);
    const pos = L.slot === 1 ? U.uLampPos : U.uLamp2Pos,
      col = L.slot === 1 ? U.uLampCol : U.uLamp2Col,
      par = L.slot === 1 ? U.uLampP : U.uLamp2P,
      fl =
        1 +
        0.05 * Math.sin(t * 7.1 + L.phase) * Math.sin(t * 2.3 + 1 + L.phase) +
        0.025 * Math.sin(t * 13.7 + L.phase);
    pos.value.copy(L.local);
    L.grp.localToWorld(pos.value);
    col.value.set(L.color[0], L.color[1], L.color[2]);
    par.value.set(L.range * playerH, L.intensity * fl, L.spec, 0);
  });
}
// adds a dungeon's props once the props and its model have both loaded (the map's copy of the ruins was made before this, so the map is unchanged)
function decorateDungeon(fn, grp, RD, dScale) {
  loadProps()
    .then((lib) => fn(grp, RD, lib, dScale))
    .catch((e) => console.error("dungeon props failed", e));
}
function initRuins(H, groundY, ctr) {
  loadBakedModel("ruins-data")
    .then(({ RD, grp }) => {
      const d = DUNGEONS.ruins;
      // the map's copy is made before the flame is added
      addMapProp(
        grp,
        RD.c,
        d.scale,
        0,
        "greenfield",
        MAP_AREAS.greenfield.spots[d.spot],
        H,
        groundY,
        ctr,
      );
      // added after the line above, so the flame is never something the camera collides with
      initFire(grp);
      decorateDungeon(decorateRuins, grp, RD, d.scale);
      placeDungeon(d, RD, grp, H, groundY, ctr);
    })
    .catch((e) => console.error("ruins load failed", e));
}
/* THE TOMB: its inside (tomb-data) is the dungeon, its entrance (tombentry-data, a mound with a door in the -z side) is what stands on the map. */
function initTomb(H, groundY, ctr) {
  const d = DUNGEONS.tomb;
  loadBakedModel("tombentry-data")
    .then(({ RD, grp }) =>
      addMapProp(
        grp,
        RD.c,
        TOMB_ENTRY_SCALE,
        Math.PI / 2,
        "greenfield",
        MAP_AREAS.greenfield.spots[d.spot],
        H,
        groundY,
        ctr,
      ),
    )
    .catch((e) => console.error("tomb entrance load failed", e));
  loadBakedModel("tomb-data")
    .then(({ RD, grp }) => {
      placeDungeon(d, RD, grp, H, groundY, ctr);
      decorateDungeon(decorateTomb, grp, RD, d.scale);
    })
    .catch((e) => console.error("tomb load failed", e));
}
function fadeThen(fn) {
  const f = document.getElementById("fade");
  f.style.opacity = 1;
  setTimeout(() => {
    try {
      fn();
    } catch (e) {
      console.error("dungeon transition failed", e);
      dgBusy = false;
      if (window.toast)
        window.toast(
          "ERROR: " + ((e && e.message) || e).toString().slice(0, 40),
        );
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        f.style.opacity = 0;
      }),
    );
  }, 480);
}
function dgStart(shot, blend) {
  dgFrom = blend
    ? {
        yaw: dgCam.yaw,
        pitch: dgCam.pitch,
        dist: dgCam.dist,
        ty: dgCam.ty,
        mid: dgCam.mid,
      }
    : null;
  dgBlend = blend ? 0 : 1;
  dgShot = shot;
  dgYaw = (shot.yaw * Math.PI) / 180;
  dgT = 0;
  if (blend) {
    // the further the camera has to travel, the longer the move (about 25 deg/s on average), so big swings are never sudden
    const TAU = Math.PI * 2;
    dgFrom.dy0 =
      // which way round to swing is decided ONCE here (re-deciding every frame can flip the direction mid-move when the shots are ~180 deg apart)
      ((((dgYaw - dgFrom.yaw + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
    const dy = (Math.abs(dgFrom.dy0) * 180) / Math.PI;
    dgBlendT = Math.min(
      DG_BLEND_MAX,
      Math.max(
        DG_BLEND_MIN,
        2.2 +
          dy / 28 +
          Math.abs(shot.dist - dgFrom.dist) * 0.5 +
          Math.abs(shot.pitch - dgFrom.pitch) * 3,
      ),
    );
    // then a few seconds of calm drift before the next move
    dgDur = dgBlendT + 4.5 + Math.random() * 4;
  } else dgDur = 8 + Math.random() * 5;
}
function dgNext() {
  let k;
  do {
    k = Math.floor(Math.random() * dg.shots.length);
  } while (k === dgLast && dg.shots.length > 1);
  dgLast = k;
  dgStart(dg.shots[k], true);
}
/* the underground look: black fog and background, no grass, no sky, a dimmer tint on everything. The world's own look is put back by the time-of-day code (lookSnap) when you leave. */
function dgLookOn(look) {
  if (floorMesh) floorMesh.visible = false;
  setSkyFog(look.fog);
  U.uNight.value.set(look.tint[0], look.tint[1], look.tint[2]);
  if (nightGroup) nightGroup.visible = false;
  if (skyGroup) skyGroup.visible = false;
}
function dgLookOff() {
  if (floorMesh) floorMesh.visible = true;
  lookSnap = true;
}
function enterDungeon(id) {
  const d = DUNGEONS[id || "ruins"];
  if (exploring || dgBusy || !d) return;
  if (!playerRig || !d.group) {
    (window.toast || console.log)("STILL LOADING...");
    return;
  }
  dg = d;
  dgBusy = true;
  fadeThen(() => {
    // coming from the map: menu camera, fog and floor back at once (it is black right now) - before the fog is saved below
    mapSnap();
    dgBusy = false;
    swooshHide();
    exploring = true;
    dungeon = true;
    document.body.classList.add("explore", "dungeon");
    swinging = swingQueued = swingDone = false;
    keys.clear();
    stick.x = stick.y = 0;
    const hud = document.getElementById("hud");
    hudBak = hud.innerHTML;
    hud.innerHTML = HINT_AIM;
    fogBak = [U.uFogNear.value, U.uFogFar.value];
    U.uFogNear.value = dg.fog[0] * playerH;
    U.uFogFar.value = dg.fog[1] * playerH;
    if (dg.look) dgLookOn(dg.look);
    dg.group.visible = true;
    if (dg.slots) dg.slots.visible = true;
    dgWave = 0;
    try {
      spawnEnemies();
    } catch (e) {
      console.error("spawnEnemies failed", e);
    }
    battleReset();
    setBattleMusic(true);
    try {
      showPointer();
    } catch (e) {
      console.error("showPointer failed", e);
    }
    if (dg.forest && dgForest) dgForest.visible = true;
    if (treeGroup) treeGroup.visible = false;
    playerRig.position.set(dg.start * playerH, 0, 0);
    heading = -Math.PI / 2;
    // facing west, into the dungeon
    playerRig.rotation.y = heading;
    floorMesh.position.x = floorMesh.position.z = 0;
    chestScene = false;
    chestDone = false;
    chestEndT = -1;
    dgState = "walkin";
    moving = true;
    if (actions.Walk) {
      actions.Walk.timeScale = 1;
      play("Walk");
    }
    dgCam.yaw = (dg.intro.yaw * Math.PI) / 180;
    dgCam.pitch = dg.intro.pitch;
    dgCam.dist = dg.intro.dist;
    dgCam.ty = dg.intro.ty;
    dgCam.mid = dg.intro.mid;
    dgStart(dg.intro, false);
    dgDur = 1e9;
    dgLast = -1;
    resize();
    dungeonStep(0);
  });
}
function leaveDungeon() {
  if (!dungeon || dgBusy) return;
  dgBusy = true;
  setBattleMusic(false);
  fadeThen(() => {
    dgBusy = false;
    dungeon = false;
    chestScene = false;
    chestDone = false;
    chestEndT = -1;
    hideLoot();
    loot.picked = false;
    document.body.classList.remove("dungeon");
    clearEnemies();
    if (dg.group) dg.group.visible = false;
    if (dg.slots) dg.slots.visible = false;
    if (dgForest) dgForest.visible = false;
    if (dg.look) dgLookOff();
    if (treeGroup) treeGroup.visible = forest;
    if (fogBak) {
      U.uFogNear.value = fogBak[0];
      U.uFogFar.value = fogBak[1];
      fogBak = null;
    }
    document.getElementById("hud").innerHTML = hudBak;
    stopExplore();
  });
}
function leaveMode() {
  if (dungeon) leaveDungeon();
  else stopExplore();
}
/* ---------- enemy knights: one stands on each red ring, facing the player, each with its own random armor tint, plume and sword color ----------
 They are clones of the player's knight (same model and sword, but a different helmet each, never the one the player wears) with their own materials, so recoloring one never touches another or the player.
 A fresh random set is rolled every time you enter the ruins. Colors are drawn from the same swatches the Customize screen offers (null = the original look). */
const EN_ARMOR = [
  null,
  "#e8604f",
  "#e8b830",
  "#58b868",
  "#4a88e8",
  "#9a60e0",
  "#e878b0",
  "#3cc4bc",
];
const EN_PLUME = [
  null,
  "#4a78e8",
  "#4fc25a",
  "#f0c030",
  "#a05ae0",
  "#f2f2f2",
];
const EN_SWORD = [
  null,
  "#e8604f",
  "#e8b830",
  "#58b868",
  "#4a88e8",
  "#9a60e0",
  "#e878b0",
  "#3cc4bc",
];
let knightScene = null;
const enemies = [];
function shuffled(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = b[i];
    b[i] = b[j];
    b[j] = t;
  }
  return b;
}
let elementalGltf = null;
const SLIME_SCALE = 1.2,
  SLIME_HIT_AT = 0.65;
function initElemental() {
  const el = document.getElementById("elemental-data");
  if (!el) return;
  try {
    const raw = (function () {
      const s = atob(el.textContent.trim()),
        u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      return u.buffer;
    })();
    new THREE.GLTFLoader().parse(
      raw,
      "",
      (g) => {
        elementalGltf = g;
      },
      (e) => console.error("elemental load failed", e),
    );
  } catch (e) {
    console.error("elemental failed", e);
  }
}
function cloneElemental() {
  const root = elementalGltf.scene.clone(true);
  root.scale.setScalar(SLIME_SCALE);
  // flip 180 deg so the slime's front faces +Z in rig space, matching the knight
  root.rotation.y = Math.PI;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = ps1Mat(o.material.map, 1);
    if (o.name === "outer_mesh") {
      m.fragmentShader = m.fragmentShader
        .replace("if(tx.a<0.5) discard;", "if(tx.a<0.05) discard;")
        .replace("gl_FragColor=vec4(c,1.0);", "gl_FragColor=vec4(c,tx.a);");
      m.transparent = true;
      m.depthWrite = false;
      o.renderOrder = 2;
    } else if (o.name === "inner_mesh") {
      o.renderOrder = 1;
    } else {
      o.renderOrder = 0;
    }
    // 1 = solid; the fade-out when an enemy without a death animation dies brings it to 0
    m.uniforms.uFade = { value: 1 };
    m.fragmentShader = m.fragmentShader
      .replace(
        "uniform sampler2D map;",
        "uniform sampler2D map; uniform float uFade;",
      )
      .replace(
        "gl_FragColor=vec4(c,tx.a);",
        "gl_FragColor=vec4(c,tx.a*uFade);",
      )
      .replace("gl_FragColor=vec4(c,1.0);", "gl_FragColor=vec4(c,uFade);");
    o.material = m;
    o.frustumCulled = false;
  });
  return root;
}
function playSlimeSfx(kind) {
  if (kind === "atk")
    playSfxSet(
      "slime-atk-sfx-data",
      Math.floor(Math.random() * 4),
      0.9,
      1,
      0,
    );
  else if (kind === "hit") playSfxSet("slime-hit-sfx-data", 0, 0.9, 1, 0);
  else if (kind === "die") playSfxSet("slime-die-sfx-data", 0, 0.9, 1, 0);
  else if (kind === "win") playSfxSet("slime-win-sfx-data", 0, 0.9, 1, 0);
}
/* ---------- WAVES + the new enemies: TREELING and SPORELING ----------
 dg.waves (each dungeon's own list, in DUNGEONS) = the fights in a row, left to right as the enemy ring lays out (slots 0, 1, 2): 'slime', 'golem', or 'mob' (a treeling or a sporeling, picked at random for each 'mob').
 When a wave is cleared the next one appears after a short pause; the knight keeps his HP. The last wave being cleared is the win (the chest). MOBS = name, hit points, and height as a fraction
 of the knight's. Their model files bring their own Idle, Hit and atk clips; they fight like the golem (same hit timing rule: halfway through atk, same sounds for now). */
const MOBS = {
  treeling: { name: "TREELING", hp: 80, scale: 0.9 },
  sporeling: { name: "SPORELING", hp: 50, scale: 0.7 },
};
const mobModels = {};
let dgWave = 0;
function loadMobs() {
  Object.keys(MOBS).forEach((key) => {
    const el = document.getElementById(key + "-data");
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
            if (!cache.has(om.uuid)) cache.set(om.uuid, ps1Mat(om.map, 1));
            o.material = cache.get(om.uuid);
            o.frustumCulled = false;
          });
          g.scene.updateMatrixWorld(true);
          const bx = new THREE.Box3().setFromObject(g.scene),
            f = (n) => g.animations.find((a) => a.name === n);
          mobModels[key] = {
            scene: g.scene,
            h0: bx.max.y - bx.min.y,
            minY: bx.min.y,
            clips: { Idle: f("Idle"), Hit: f("Hit"), Attack: f("atk") },
            all: g.animations,
          };
        },
        (e) => console.error(key + " failed", e),
      );
    } catch (e) {
      console.error(key + " failed", e);
    }
  });
}
setTimeout(loadMobs, 0);
function spawnMob(k, sx, sz, H, th) {
  const keys = Object.keys(mobModels).filter(
    (q) =>
      mobModels[q].clips.Idle &&
      mobModels[q].clips.Hit &&
      mobModels[q].clips.Attack,
  );
  if (!keys.length) return false;
  const key = keys[Math.floor(Math.random() * keys.length)],
    M = mobModels[key],
    D = MOBS[key],
    root = M.scene.clone(true),
    gk = (D.scale * H) / M.h0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    // own materials, so this one's death fade does not touch the others
    const m = ps1Mat(o.material.uniforms.map.value, 1);
    m.uniforms.uFade = { value: 1 };
    m.fragmentShader = m.fragmentShader
      .replace(
        "uniform sampler2D map;",
        "uniform sampler2D map; uniform float uFade;",
      )
      .replace("gl_FragColor=vec4(c,1.0);", "gl_FragColor=vec4(c,uFade);");
    o.material = m;
    o.frustumCulled = false;
  });
  root.scale.setScalar(gk);
  root.position.y = -M.minY * gk;
  const rig = new THREE.Group();
  rig.add(root);
  rig.rotation.y = th;
  rig.position.set(sx, blobHome.y, sz);
  scene.add(rig);
  const mx = new THREE.AnimationMixer(root),
    a = mx.clipAction(M.clips.Idle);
  a.timeScale = 0.92 + Math.random() * 0.16;
  a.play();
  a.time = Math.random() * a.getClip().duration;
  mx.update(0);
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
  blob.position.set(sx, blobHome.y, sz);
  scene.add(blob);
  const fadeMats = [];
  root.traverse((o) => {
    if (o.isMesh && o.material.uniforms && o.material.uniforms.uFade)
      fadeMats.push(o.material);
  });
  const en = {
    isSlime: false,
    isGolem: true,
    gc: M.clips,
    mobName: D.name,
    fadeMats,
    fade: null,
    rig,
    mixer: mx,
    root,
    blob,
    tex: [],
    armor: "#6a8a4a",
    plume: "#b2ffa1",
    sword: null,
    x: sx,
    z: sz,
    idle: a,
    hit: null,
    hitDone: false,
    hp: D.hp,
    max: D.hp,
    dead: false,
    atk: null,
    atkDone: false,
    death: null,
    deathDone: false,
  };
  mx.addEventListener("finished", (ev) => {
    if (ev.action === en.hit) en.hitDone = true;
    if (ev.action === en.atk) en.atkDone = true;
    if (ev.action === en.death) en.deathDone = true;
  });
  enemies.push(en);
  return true;
}
function nextWave() {
  // every enemy of this wave is down: a pause, then the next wave steps up (the knight keeps his HP)
  turn = "wave";
  try {
    setTurnLabel("WAVE " + (dgWave + 2) + " OF " + dg.waves.length);
  } catch (e) {}
  setTimeout(() => {
    if (!dungeon || turn !== "wave") return;
    dgWave++;
    try {
      spawnEnemies();
    } catch (e) {
      console.error(e);
    }
    pl.guard = false;
    ep = null;
    turn = "player";
    barsBuild();
    setTurnLabel("YOUR TURN" + hasteTag());
    try {
      showPointer();
    } catch (e) {}
  }, 2000);
}
function spawnEnemies() {
  clearEnemies();
  if (!knightScene || !actions.Idle || !dg.enemy.n || !blobHome) return;
  const H = playerH,
    c = homeTarget,
    n = dg.enemy.n,
    // heading +90 deg = facing east, toward the player
    th = Math.PI / 2;
  const lay = dg.waves[Math.min(dgWave, dg.waves.length - 1)];
  const A = shuffled(EN_ARMOR),
    P = shuffled(EN_PLUME),
    W = shuffled(EN_SWORD);
  const HP = shuffled(
    helmetSets.map((_, i) => i).filter((i) => i !== curHelmet),
  // helmets other than the one the player wears, shuffled so each enemy gets a different one   // shuffled, so the three never repeat a color until the swatches run out
  );
  for (let k = 0; k < n; k++) {
    const sx = c.x - dg.enemy.dist * H,
      // exactly where the ring is
      sz = c.z + (k - (n - 1) / 2) * dg.enemy.gap * H;
    if (lay[k] === "slime" && elementalGltf) {
      // Enemy 1 (k=2) and Enemy 3 (k=0) are Slimes
      const root = cloneElemental();
      const rig = new THREE.Group();
      rig.add(root);
      rig.rotation.y = th;
      rig.position.set(sx, blobHome.y, sz);
      scene.add(rig);
      const clips = {};
      elementalGltf.animations.forEach((ac) => {
        clips[ac.name] = ac;
      });
      const mx = new THREE.AnimationMixer(root),
        a = mx.clipAction(clips.idle);
      a.timeScale = 0.92 + Math.random() * 0.16;
      a.play();
      a.time = Math.random() * a.getClip().duration;
      mx.update(0);
      const blob = new THREE.Mesh(
        new THREE.CircleGeometry(H * 0.24, 10),
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
      blob.position.set(sx, blobHome.y, sz);
      scene.add(blob);
      const fadeMats = [];
      root.traverse((o) => {
        if (o.isMesh && o.material.uniforms && o.material.uniforms.uFade)
          fadeMats.push(o.material);
      });
      const en = {
        isSlime: true,
        fadeMats,
        fade: null,
        clips,
        rig,
        mixer: mx,
        root,
        blob,
        tex: [],
        armor: "#5ab648",
        plume: "#b2ffa1",
        sword: null,
        x: sx,
        z: sz,
        idle: a,
        hit: null,
        hitDone: false,
        hp: SLIME_HP,
        max: SLIME_HP,
        dead: false,
        atk: null,
        atkDone: false,
        death: null,
        deathDone: false,
      };
      mx.addEventListener("finished", (ev) => {
        if (ev.action === en.hit) en.hitDone = true;
        if (ev.action === en.atk) en.atkDone = true;
        if (ev.action === en.death) en.deathDone = true;
      });
      enemies.push(en);
      continue;
    }
    if (lay[k] === "mob" && spawnMob(k, sx, sz, H, th)) continue;
    if (lay[k] === "golem" && golemReady()) {
      // the ruins' knight is a golem now: same HP, same damage
      const root = golemScene.clone(true),
        gk = (GOLEM_SCALE * H) / golemH0;
      root.traverse((o) => {
        if (!o.isMesh) return;
        // own materials, so this golem's death fade does not touch the others
        const m = ps1Mat(o.material.uniforms.map.value, 1);
        m.uniforms.uFade = { value: 1 };
        m.fragmentShader = m.fragmentShader
          .replace(
            "uniform sampler2D map;",
            "uniform sampler2D map; uniform float uFade;",
          )
          .replace(
            "gl_FragColor=vec4(c,1.0);",
            "gl_FragColor=vec4(c,uFade);",
          );
        if (golemEye(o)) m.uniforms.uMagma.value = 1;
        o.material = m;
        o.frustumCulled = false;
      });
      root.scale.setScalar(gk);
      root.position.y = -golemMinY * gk;
      const rig = new THREE.Group();
      rig.add(root);
      rig.rotation.y = th;
      rig.position.set(sx, blobHome.y, sz);
      scene.add(rig);
      const mx = new THREE.AnimationMixer(root),
        a = mx.clipAction(golemClips.Idle);
      a.timeScale = 0.92 + Math.random() * 0.16;
      a.play();
      a.time = Math.random() * a.getClip().duration;
      mx.update(0);
      const blob = new THREE.Mesh(
        new THREE.CircleGeometry(H * 0.3, 10),
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
      blob.position.set(sx, blobHome.y, sz);
      scene.add(blob);
      const fadeMats = [];
      root.traverse((o) => {
        if (o.isMesh && o.material.uniforms && o.material.uniforms.uFade)
          fadeMats.push(o.material);
      });
      const en = {
        isSlime: false,
        isGolem: true,
        fadeMats,
        fade: null,
        rig,
        mixer: mx,
        root,
        blob,
        tex: [],
        armor: "#9aa0a8",
        plume: "#c9a45a",
        sword: null,
        x: sx,
        z: sz,
        idle: a,
        hit: null,
        hitDone: false,
        hp: ENEMY_HP,
        max: ENEMY_HP,
        dead: false,
        atk: null,
        atkDone: false,
        death: null,
        deathDone: false,
      };
      mx.addEventListener("finished", (ev) => {
        if (ev.action === en.hit) en.hitDone = true;
        if (ev.action === en.atk) en.atkDone = true;
        if (ev.action === en.death) en.deathDone = true;
      });
      enemies.push(en);
      playGolemSfx("spawn");
      continue;
    }
    const ah = A[k % A.length],
      ph = P[k % P.length],
      sh = W[k % W.length];
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
      })(),
      cache = new Map(),
      pTex = [],
      rocks = [];
    // enemies keep the normal handedness whatever the player's weapon
    root.scale.x = MIRROR_MODEL ? -1 : 1;
    root.traverse((o) => {
      if (o.name === "Shortsword") o.visible = true;
      else if (
        o.name === "Axe" ||
        o.name === "Hatchet" ||
        o.name === "Hammer" ||
        o.name === "KnightlySword" ||
        o.name === "Morningstar"
      )
        o.visible = false;
    // enemies stay with swords + the normal Idle
    });
    if (HP.length) {
      // swap the helmet: show this enemy's set in the clone and hide the rest (clone meshes are found by their position in the hierarchy)
      const hi = HP[k % HP.length],
        oL = [],
        cL = [];
      knightScene.traverse((o) => oL.push(o));
      root.traverse((o) => cL.push(o));
      helmetSets.forEach((set, j) =>
        set.forEach((m) => {
          const cm = cL[oL.indexOf(m)];
          if (cm) cm.visible = j === hi;
        }),
      );
    }
    root.traverse((o) => {
      if (o.name === "SeatRock") rocks.push(o);
      if (!o.isMesh || o.name === "SeatRock") return;
      if (o.name === "H6Face") {
        if (helm6.mat) o.material = helm6.mat;
        o.scale.x = root.scale.x < 0 ? -1 : 1;
        return;
      // Helmet 6's face: the same animated material, not tinted like armor
      }
      const om = o.material;
      if (!om.uniforms) {
        o.visible = false;
        return;
      } /* the Knightly sword's halo (a plain additive material) is left out of copies of the knight */
      let nm = cache.get(om.uuid);
      if (!nm) {
        const src = om.uniforms.map.value,
          isPl = /Plume$/.test(o.name),
          isSw = o.name.indexOf("sword_") === 0;
        let tex = src;
        if (isPl) {
          // each plume needs its own canvas, or all the enemies would share one color
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
        if (/h6_/.test(o.name)) nm.uniforms.uBlackNoShine.value = 1;
        if (isPl) shineMat(nm);
        else tintMat(nm, isSw ? sh : ah);
        cache.set(om.uuid, nm);
      }
      o.material = nm;
    });
    // the clone was taken while the player sat on his rock
    rocks.forEach((r) => r.parent && r.parent.remove(r));
    const rig = new THREE.Group();
    rig.add(root);
    rig.rotation.y = th;
    const ox = -c.x,
      // the model's footprint centre, in the rig's own frame, so his feet land on the ring
      oz = -c.z;
    rig.position.set(
      sx - (ox * Math.cos(th) + oz * Math.sin(th)),
      0,
      sz - (-ox * Math.sin(th) + oz * Math.cos(th)),
    );
    scene.add(rig);
    const mx = new THREE.AnimationMixer(root),
      a = mx.clipAction(actions.Idle.getClip());
    a.timeScale = 0.92 + Math.random() * 0.16;
    a.play();
    a.time = Math.random() * a.getClip().duration;
    // out of step with each other
    mx.update(0);
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
    blob.position.set(sx, blobHome.y, sz);
    scene.add(blob);
    const en = {
      isSlime: false,
      rig,
      mixer: mx,
      root,
      blob,
      tex: pTex,
      armor: ah,
      plume: ph,
      sword: sh,
      x: sx,
      z: sz,
      idle: a,
      hit: null,
      hitDone: false,
      hp: ENEMY_HP,
      max: ENEMY_HP,
      dead: false,
      atk: null,
      atkDone: false,
      death: null,
      deathDone: false,
    };
    mx.addEventListener("finished", (ev) => {
      if (ev.action === en.hit) en.hitDone = true;
      if (ev.action === en.atk) en.atkDone = true;
      if (ev.action === en.death) en.deathDone = true;
    });
    enemies.push(en);
  }
}
function clearEnemies() {
  hidePointer();
  bmReset();
  barsClear();
  enemies.forEach((e) => {
    e.mixer.stopAllAction();
    e.mixer.uncacheRoot(e.root);
    scene.remove(e.rig);
    scene.remove(e.blob);
    e.blob.geometry.dispose();
    e.blob.material.dispose();
    e.tex.forEach((t) => t.dispose());
  });
  enemies.length = 0;
}
// the slimes move in 8 frames a second (the knights: 15): a stop-motion look
const SLIME_STEP = 1 / 8;
function stepEnemies(dt) {
  for (const e of enemies) {
    if (e.isSlime) {
      e.slAcc = (e.slAcc || 0) + dt;
      if (e.slAcc >= SLIME_STEP) {
        const n = Math.floor(e.slAcc / SLIME_STEP);
        e.mixer.update(n * SLIME_STEP);
        e.slAcc -= n * SLIME_STEP;
      }
    } else e.mixer.update(dt);
  }
  if (shopKeeper && shopGroup && shopGroup.visible) {
    shopKeeper.mixer.update(dt);
    shopEvtStep(dt);
    updateShopFace(dt);
  }
  fadeEnemies(dt);
  if (pointerMixer) pointerMixer.update(dt);
}
/* ---------- target pointer (pointer-data: Blockbench glTF with its own spin-and-bob animation) ----------
 One pointer floats above the enemy you have selected. LEFT / RIGHT (or A / D) move it between the enemies, as you see them on screen:
 it starts on the middle one; LEFT / RIGHT follow the TARGET window and wrap round at the ends. Later this is what picks the target of an attack. */
// 1 = the size it was modeled at (quite small next to the knight)
const POINTER_SCALE = 2.0;
// clearance above the top of the knight's head, in knight-heights
const POINTER_GAP = 0.34;
let pointerRig = null,
  pointerMixer = null,
  enSel = 1;
const ptr = { x: 0, z: 0 };
/* target tracker window: one numbered slot per enemy (its armor color and plume color in the slot), the selected one lit with a blinking arrow, and its name underneath */
const TG_NAMES = {
  "#e8604f": "CRIMSON",
  "#e8b830": "AURIC",
  "#58b868": "EMERALD",
  "#4a88e8": "COBALT",
  "#9a60e0": "UMBRA",
  "#e878b0": "ORCHID",
  "#3cc4bc": "LAGOON",
// armor color -> the knight's name (target window + health bars); unknown colors are STEEL
};
const tgEl = document.getElementById("tgt");
let tgKey = "";
function tgSync() {
  const show = !!(
    dungeon &&
    pointerRig &&
    pointerRig.visible &&
    enemies.length
  );
  if (!show) {
    if (!tgEl.hidden) {
      tgEl.hidden = true;
      tgKey = "";
    }
    return;
  }
  const n = enemies.length,
    key =
      n +
      ":" +
      enSel +
      ":" +
      enemies
        .map((e) => e.armor + "/" + e.plume + (e.dead ? "x" : ""))
        .join();
  if (key === tgKey && !tgEl.hidden) return;
  tgKey = key;
  let html = '<div class="tg-h">TARGET</div><div class="tg-row">';
  for (let num = 1; num <= n; num++) {
    const k = n - num,
      e = enemies[k];
    html +=
      '<div class="tg-s' +
      (k === enSel ? " on" : "") +
      (e.dead ? " dead" : "") +
      '">' +
      num +
      '<i style="background:' +
      (e.armor || "#9aa0aa") +
      '"></i><b style="background:' +
      (e.plume || "#d8d8d8") +
      '"></b></div>';
  }
  const s = enemies[enSel];
  html +=
    '</div><div class="tg-n">ENEMY ' +
    (n - enSel) +
    " - " +
    (s.isSlime
      ? "ELEMENTAL SLIME"
      : s.isGolem
        ? s.mobName || "GOLEM"
        : (TG_NAMES[s.armor] || "STEEL") + " KNIGHT") +
    "</div>";
  tgEl.innerHTML = html;
  tgEl.hidden = false;
}
function initPointer() {
  const el = document.getElementById("pointer-data");
  if (!el) return;
  const raw = (function () {
    const s = atob(el.textContent.trim()),
      u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  })();
  new THREE.GLTFLoader().parse(
    raw,
    "",
    (g) => {
      const cache = new Map();
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const om = o.material;
        if (!cache.has(om.uuid)) cache.set(om.uuid, ps1Mat(om.map, 1));
        o.material = cache.get(om.uuid);
        o.frustumCulled = false;
      });
      g.scene.scale.setScalar(POINTER_SCALE);
      const rig = new THREE.Group();
      rig.add(g.scene);
      rig.visible = false;
      scene.add(rig);
      const mx = new THREE.AnimationMixer(g.scene);
      g.animations.forEach((a) => mx.clipAction(a).play());
      mx.update(0);
      rig.updateMatrixWorld(true);
      // its lowest point now sits exactly at the rig's origin, so the gap above the head is exact
      g.scene.position.y = -new THREE.Box3().setFromObject(rig).min.y;
      pointerRig = rig;
      pointerMixer = mx;
    },
    (e) => console.error("pointer load failed", e),
  );
}
function pickAlive() {
  // the pointer always rests on a living enemy: the nearest one to where it is
  let best = -1;
  enemies.forEach((e, i) => {
    if (!e.dead && (best < 0 || Math.abs(i - enSel) < Math.abs(best - enSel)))
      best = i;
  });
  if (best >= 0) {
    enSel = best;
    tgSync();
  } else if (pointerRig) pointerRig.visible = false;
}
function placePointer() {
  const s = enemies[enSel],
    top =
      s && s.isSlime
        ? blobHome.y + 0.42 * playerH
        : homeTarget.y + playerH / 2;
  pointerRig.position.set(ptr.x, top + POINTER_GAP * playerH, ptr.z);
}
function showPointer() {
  if (!pointerRig || !enemies.length) return;
  // the middle enemy
  enSel = Math.floor((enemies.length - 1) / 2);
  pickAlive();
  ptr.x = enemies[enSel].x;
  ptr.z = enemies[enSel].z;
  pointerRig.visible = true;
  placePointer();
  tgSync();
}
function hidePointer() {
  if (pointerRig) pointerRig.visible = false;
  tgSync();
}
function updatePointer(dt) {
  tgSync();
  if (!pointerRig || !pointerRig.visible || !enemies[enSel]) return;
  if (enemies[enSel] && enemies[enSel].dead) pickAlive();
  const e = enemies[enSel],
    k = Math.min(1, dt * 14);
  ptr.x += (e.x - ptr.x) * k;
  ptr.z += (e.z - ptr.z) * k;
  // slides to the new target
  placePointer();
}
function movePointer(dir) {
  // dir: -1 = left key, +1 = right key. Always follows the TARGET window along the top (slot 1 on the left), whatever the camera does, and wraps round at the ends
  // locked while the battle menu is open or an action is playing
  if (!pointerRig || !pointerRig.visible || bmOpen || bt.act) return;
  const n = enemies.length;
  if (n < 2) return;
  let k = enSel;
  for (let q = 0; q < n; q++) {
    k = (((k - dir) % n) + n) % n;
    if (!enemies[k].dead) break;
  // slot number = enemies.length - index, so right (next slot) is the previous index; fallen enemies are skipped
  }
  if (enemies[k].dead || k === enSel) return;
  enSel = k;
  blip(560, 0.05);
  tgSync();
}
addEventListener("keydown", (e) => {
  if (!dungeon || dgBusy || e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "a") movePointer(-1);
  else if (k === "arrowright" || k === "d") movePointer(1);
});
/* ---------- battle command menu ----------
 Hover an enemy with LEFT / RIGHT, press ENTER (or SPACE / the OK button) to pick it and the command window slides in on the left.
 UP / DOWN choose, ENTER confirms, ESC (or BACKSPACE / BACK) steps back out. It only opens once the knight has reached the circle.
 ATTACK > CARVE : the knight swings (the Swing animation) and the picked enemy plays Hit, holding its last frame for a second.
 ACTIONS > FLAUNT : the Flaunt animation (with its song). ACTIONS > BLOCK : the Block animation with two sound effects (see playBlockSfx). FLEE leaves the dungeon. ITEMS > POTION : drink a potion (Drinking_Potion animation) and heal POTION_HEAL hit points, see the battle section. */
const BM_MENUS = {
  root: { title: "BATTLE", items: ["ATTACK", "ITEMS", "ACTIONS", "FLEE"] },
  attack: {
    title: "ATTACK",
    get items() {
      return klActive()
        ? [
            "CARVE",
            klReady()
              ? "KNIGHT LIGHT"
              : "KNIGHT LIGHT " + kl.n + "/" + KL_MAX,
            "BACK",
          ]
        : ["CARVE", "BACK"];
    },
  // KNIGHT LIGHT: only with the Knightly Sword, once its gauge is full
  },
  actions: {
    title: "ACTIONS",
    get items() {
      return weapon === "axe"
        ? ["FLAUNT", "BLOCK", "RENDER", "BACK"]
        : ["FLAUNT", "BLOCK", "BACK"];
    },
  // RENDER only while a heavy weapon (axe / shovel) is held
  },

  items: {
    title: "ITEMS",
    get items() {
      return ["POTION x" + potions, "HASTE POTION x" + hastes, "BACK"];
    },
  // the label shows how many are left
  },
};
// same swing speed as in Walk Around
const SWING_SPEED = 1.25;
// seconds into the Swing clip when the blade connects: the enemy's Hit starts then
const CARVE_HIT_AT = 0.5;
// seconds the last frame of Hit is held before the enemy goes back to Idle
const HIT_HOLD = 1.0;
// seconds the last frame of Block is held before he goes back to Idle
const BLOCK_HOLD = 0.05;
// seconds the Flaunt plays (4 loops of the 0.75 s clip) before he returns to Idle
const FLAUNT_TIME = 3.0;
const HINT_AIM = "LEFT / RIGHT AIM &nbsp; ENTER SELECT &nbsp; ESC LEAVE",
  HINT_MENU = "UP / DOWN CHOOSE &nbsp; ENTER OK &nbsp; ESC BACK",
  HINT_BUSY = "ESC LEAVE";
let bmOpen = false,
  bmIdx = 0,
  bmTT = 0,
  bmLevel = "root";
// the action in progress (null = none)
const bt = { act: null, t: 0, stage: 0, en: null, heading: 0 };
const bmEl = document.getElementById("bm"),
  bmList = document.getElementById("bml"),
  bmT = document.getElementById("bmt"),
  bmH = bmEl.querySelector("h1");
function bmBuild(level) {
  bmLevel = level;
  bmH.textContent = BM_MENUS[level].title;
  bmList.innerHTML = "";
  BM_MENUS[level].items.forEach((t, i) => {
    const b = document.createElement("button");
    b.className = "item";
    b.setAttribute("role", "menuitem");
    b.textContent = t;
    b.onmouseenter = () => {
      if (bmOpen && bmIdx !== i) bmSet(i);
    };
    b.onclick = () => {
      if (bmOpen) {
        bmSet(i);
        bmChoose();
      }
    };
    bmList.appendChild(b);
  });
}
function bmSet(i) {
  const n = BM_MENUS[bmLevel].items.length;
  bmIdx = (i + n) % n;
  [].forEach.call(bmList.children, (b, j) =>
    b.setAttribute("aria-checked", j === bmIdx),
  );
}
function bmGo(level, sel) {
  bmBuild(level);
  bmSet(sel || 0);
}
function bmToast(t) {
  const el = document.getElementById("toast");
  el.textContent = t;
  el.classList.add("show");
  clearTimeout(bmTT);
  bmTT = setTimeout(() => el.classList.remove("show"), 1700);
}
function bmTarget() {
  return enemies.length - enSel;
// 1 = the enemy on the player's far left, counting to his right
}
function hudSet(h) {
  const el = document.getElementById("hud");
  if (el && dungeon) el.innerHTML = h;
}
function bmShow() {
  if (
    bmOpen ||
    bt.act ||
    dgBusy ||
    dgState !== "idle" ||
    turn !== "player" ||
    !enemies.length ||
    !pointerRig ||
    !pointerRig.visible
  )
    return;
  bmOpen = true;
  bmGo("root", 0);
  bmT.textContent = "TARGET: ENEMY " + bmTarget();
  bmEl.hidden = false;
  hudSet(HINT_MENU);
  blip(440, 0.07);
}
function bmClose(quiet) {
  if (!bmOpen) return;
  bmOpen = false;
  bmEl.hidden = true;
  hudSet(bt.act ? HINT_BUSY : HINT_AIM);
  if (!quiet) blip(300, 0.05);
}
function bmBack() {
  if (!bmOpen) return;
  if (bmLevel !== "root") {
    bmGo("root", bmLevel === "attack" ? 0 : bmLevel === "items" ? 1 : 2);
    blip(300, 0.05);
  } else bmClose();
}
function bmReset() {
  bmOpen = false;
  if (bmEl) bmEl.hidden = true;
  if (bt.act) {
    bt.act = null;
    bt.en = null;
  }
  if (bmList) bmGo("root", 0);
}
function bmChoose() {
  const it = BM_MENUS[bmLevel].items[bmIdx];
  blip(620, 0.07);
  if (it === "BACK") bmBack();
  else if (it === "ATTACK") bmGo("attack", 0);
  else if (it === "ACTIONS") bmGo("actions", 0);
  else if (it === "ITEMS") bmGo("items", 0);
  else if (it.indexOf("HASTE") === 0) startHaste();
  else if (it.indexOf("POTION") === 0) startPotion();
  else if (it === "FLEE") {
    bmClose(true);
    leaveDungeon();
  } else if (it === "CARVE") startCarve();
  else if (it.indexOf("KNIGHT LIGHT") === 0) startKnightLight();
  else if (it === "FLAUNT") startFlaunt();
  else if (it === "BLOCK") startBlock();
  else if (it === "RENDER") startRender();
}
function btBegin(act) {
  bmClose(true);
  bt.act = act;
  bt.t = 0;
  bt.stage = 0;
  hudSet(HINT_BUSY);
  klTurn(act);
}
/* ---------- KNIGHT LIGHT (the Knightly Sword's special): the Heavy Combo, with the Knightly Sword's coloured swing. Its gauge (bottom of the screen, in the KNIGHTLY colours: gold frame, the gem colours when full)
 gains one notch for every command you use; at KL_MAX notches it is full and KNIGHT LIGHT (ATTACK menu) can be used, which empties it again. ---------- */
const KL_MAX = 3,
  KL_DAMAGE = 60;
const kl = { n: 0 };
function klActive() {
  return weapon === "sword" && swordStyle === "knightly";
}
function klReady() {
  return kl.n >= KL_MAX;
}
function klTurn(act) {
  if (!klActive()) return;
  if (act === "knightlight") kl.n = 0;
  else if (
    act === "carve" ||
    act === "flaunt" ||
    act === "block" ||
    act === "render" ||
    act === "potion"
  )
    kl.n = Math.min(KL_MAX, kl.n + 1);
}
function startKnightLight() {
  const e = enemies[enSel],
    a = actions.HeavyCombo;
  if (!e || e.dead || !a) {
    bmToast("NOT READY");
    return;
  }
  if (!klReady()) {
    bmToast("NOT CHARGED");
    return;
  }
  btBegin("knightlight");
  bt.en = e;
  bt.heading = -Math.PI / 2;
  const c = homeTarget;
  heading = Math.atan2(e.x - c.x, e.z - c.z);
  // faces the one it is about to hit
  playerRig.rotation.y = heading;
  if (current && current !== a) current.fadeOut(0.06);
  a.reset().setLoop(THREE.LoopOnce, 1);
  a.clampWhenFinished = true;
  a.timeScale = 1;
  a.fadeIn(0.06).play();
  current = a;
  // the swishes, the sparkle and the bluntflesh hit of the finishing blow
  playSwishClip("HeavyCombo");
}
function btEnd(noTurn) {
  if (
    bt.en &&
    bt.en.idle &&
    bt.en.hit &&
    bt.en.hit.isRunning() === false &&
    bt.en.hit.weight > 0
  ) {
    /* still holding Hit: hand back to Idle below */
  }
  bt.act = null;
  bt.en = null;
  playerRig.rotation.y = bt.heading;
  // face west again
  heading = bt.heading;
  hudSet(HINT_AIM);
  if (!noTurn) afterPlayerAction();
}
function startCarve() {
  const e = enemies[enSel];
  if (!e || e.dead || !actions[swingName()] || !actions.Hit) {
    bmToast("NOT READY");
    return;
  }
  btBegin("carve");
  bt.en = e;
  bt.heading = -Math.PI / 2;
  const c = homeTarget;
  heading = Math.atan2(e.x - c.x, e.z - c.z);
  // turn to face the one he is about to cut
  playerRig.rotation.y = heading;
  // IDEAL: a random A / B / C for every swing in battle too
  if (animSet === "ideal" && swingName() === "Swing") idealPickSwing();
  const sw = actions[swingName()];
  swinging = true;
  swingQueued = false;
  if (current && current !== sw) current.fadeOut(0.06);
  sw.reset().setLoop(THREE.LoopOnce, 1);
  sw.clampWhenFinished = true;
  sw.timeScale = SWING_SPEED;
  sw.fadeIn(0.06).play();
  // when it ends the usual swing hand-off puts him back to Idle
  current = sw;
  playSword(SWING_SPEED);
}
function startFlaunt() {
  if (!actions.Flaunt) {
    bmToast("NO FLAUNT ANIMATION");
    return;
  }
  btBegin("flaunt");
  bt.heading = -Math.PI / 2;
  play("Flaunt");
}
function startBlock() {
  const b = actions.Block;
  if (!b) {
    bmToast("NO BLOCK ANIMATION");
    return;
  }
  btBegin("block");
  bt.heading = -Math.PI / 2;
  pl.guard = true;
  // the enemies' attacks this round do much less damage
  bmToast("GUARDING");
  playBlockAnim();
  playBlockSfx();
}
/* RENDER's finishing blow: one of four attack sounds (render-attack-sfx-data: generic_attack_00038ee1 / 00038ee4 / 000242db / 000242dc), picked at random, never the same twice running,
 layered with the bluntflesh hit (render-hit-sfx-data) the moment the blade connects. RENDER_ATK_PEAK = where each one's loudest hit sits inside its file; each starts early enough for that
 to land on the bluntflesh hit's own peak (0.227 s in + the 0.03 s it is delayed). 000242db builds up to its peak (0.56 s), so it just starts with the hit. */
const RENDER_ATK_GAIN = 0.9,
  RENDER_ATK_PEAK = [0.07, 0.094, 0.562, 0.08],
  // RENDER_HIT_PEAK: where the bluntflesh hit is loudest inside its own file
  RENDER_HIT_PEAK = 0.227;
let renderAtkLast = -1;
function playRenderAttackLayer(hitStart, track) {
  // hitStart: seconds from now until the bluntflesh hit STARTS (0.03 in RENDER); track: keep the sound where swishStopAll can cancel it
  if (hitStart === undefined) hitStart = 0.03;
  let i;
  do {
    i = Math.floor(Math.random() * RENDER_ATK_PEAK.length);
  } while (i === renderAtkLast && RENDER_ATK_PEAK.length > 1);
  renderAtkLast = i;
  const d = hitStart + Math.max(0, RENDER_HIT_PEAK - RENDER_ATK_PEAK[i]);
  if (track)
    playSfxSetTracked("render-attack-sfx-data", i, RENDER_ATK_GAIN, 1, d);
  else playSfxSet("render-attack-sfx-data", i, RENDER_ATK_GAIN, 1, d);
}
const RENDER_GUARD = 0.2,
  // RENDER: the share of each enemy hit it blocks (20%), and what the heavy swing does to EVERY enemy
  RENDER_DAMAGE = 25;
function startRender() {
  if (
    !actions.SwingHeavyWindUp ||
    !actions.SwingHeavyTurnHold ||
    !actions.SwingHeavyRelease
  ) {
    bmToast("NO RENDER ANIMATION");
    return;
  }
  btBegin("render");
  bt.heading = -Math.PI / 2;
  bt.stage = 0;
  pl.render = true;
  pl.buf = true;
  // pl.render: holding the pose (first enemy turn). pl.buf: the 10% buffer, lasts through BOTH enemy turns
  bmToast("RENDER");
  playHeavy("SwingHeavyWindUp", 1, false);
  playSfxSet("render-charge-sfx-data", 0, 0.9, 1, 0);
}
function playHeavy(n, ts, loop) {
  // one of the SwingHeavy clips: WindUp / Release play once and clamp, TurnHold loops
  const a = actions[n];
  if (!a) return;
  if (current && current !== a) current.fadeOut(0.08);
  a.reset().setLoop(
    loop ? THREE.LoopRepeat : THREE.LoopOnce,
    loop ? Infinity : 1,
  );
  a.clampWhenFinished = !loop;
  a.timeScale = ts;
  a.fadeIn(0.08).play();
  current = a;
}
function startRenderRelease() {
  // the enemies are done: no new turn for the player, he swings the heavy release instead
  turn = "player";
  ep = null;
  blockHitBag = [];
  enemies.forEach((e) => setEnemyYaw(e, Math.PI / 2));
  setTurnLabel("RENDER SWING");
  btBegin("renderswing");
  bt.heading = -Math.PI / 2;
  bt.stage = 0;
  playHeavy("SwingHeavyRelease", 1, false);
}
function playBlockIdle() {
  if (actions.BlockIdle) play("BlockIdle");
  else play(idleName());
// the guard held while the enemies attack; endEnemyPhase puts him back in Idle
}
function playBlockAnim() {
  const b = actions.Block;
  if (!b) return;
  if (current && current !== b) current.fadeOut(0.08);
  b.reset().setLoop(THREE.LoopOnce, 1);
  b.clampWhenFinished = true;
  b.timeScale = 1;
  b.fadeIn(0.08).play();
  current = b;
}
function enemyHit(e) {
  const clip = e.isSlime
    ? e.clips.death
    : e.isGolem
      ? (e.gc || golemClips).Hit
      : actions.Hit.getClip();
  e.hitDone = false;
  e.hit = e.mixer.clipAction(clip);
  e.hit.reset().setLoop(THREE.LoopOnce, 1);
  e.hit.clampWhenFinished = true;
  e.hit.timeScale = 1;
  e.idle.fadeOut(0.05);
  e.hit.fadeIn(0.05).play();
  blip(130, 0.14);
  if (e.isSlime) playSlimeSfx("hit");
  else if (e.isGolem) playGolemSfx("pain");
  else playGrunt();
}
/* ---------- turn-based battle: hit points, turn order, health bars ----------
 Each round: YOUR TURN (pick a command) -> the action plays -> ENEMY TURN (every living enemy swings at you, one after the other) -> back to you.
 CARVE does SWING_DAMAGE. BLOCK puts a guard up for the coming enemy turn (damage x GUARD_FACTOR). FLAUNT just spends the turn. All enemies down = VICTORY; your HP at 0 = DEFEATED. */
const PLAYER_HP = 100,
  ENEMY_HP = 100,
  // starting hit points
  SLIME_HP = 50;
// what your swing does
const SWING_DAMAGE = 25;
const ENEMY_DAMAGE = 12,
  // what an enemy swing does, and the share of it that gets through while you are guarding
  GUARD_FACTOR = 0.25;
const ENEMY_START_BEAT = 0.5,
  ENEMY_HOLD = 0.45,
  DEATH_HOLD = 0.6,
  // pauses (s): before the first enemy swings, after each enemy swing, after an enemy falls, how long VICTORY / DEFEATED stays up
  END_SHOW = 3.2;
// haste potions you start a fight with: drinking one (it uses that turn) gives you TWO actions on your next turn, each one counting for the KNIGHT LIGHT gauge
const HASTE_COUNT = 3;
const POTION_HEAL = 25,
  POTION_COUNT = 3,
  // hit points a potion restores, how many you start a fight with, and when in the clip (s) the heal lands: his hand is at his lips
  POTION_HEAL_AT = 1.5;
let potions = POTION_COUNT,
  hastes = HASTE_COUNT;
const DEFEAT_GAIN = 1.0,
  DEFEAT_SHOW = 4.2;
/* The defeat sound is crushed when it is first played (mono, sample-and-hold down to DEFEAT_RATE Hz, then DEFEAT_BITS bits: lower = dirtier) and comes out of the knights themselves:
 one copy from each living knight, panned to where that knight is on screen, a little off pitch (DEFEAT_DETUNE) and a hair apart in time (DEFEAT_STAGGER, s) so it reads as a chorus,
 all through a low-pass (DEFEAT_LOWPASS Hz) like it is coming from inside a helmet. */
const DEFEAT_BITS = 6,
  DEFEAT_RATE = 8000,
  DEFEAT_LOWPASS = 3200,
  DEFEAT_DETUNE = 0.035,
  DEFEAT_STAGGER = 0.045;
let defeatCrushed = null;
function crushBuffer(b, bits, rate) {
  const n = b.length,
    out = sfx.createBuffer(1, n, b.sampleRate),
    o = out.getChannelData(0),
    step = Math.max(1, Math.round(b.sampleRate / rate)),
    lv = Math.pow(2, bits - 1);
  const ch = [];
  for (let c = 0; c < b.numberOfChannels; c++) ch.push(b.getChannelData(c));
  let hold = 0;
  for (let i = 0; i < n; i++) {
    if (i % step === 0) {
      let v = 0;
      for (let c = 0; c < ch.length; c++) v += ch[c][i];
      v /= ch.length;
      hold = Math.round(v * lv) / lv;
    }
    o[i] = hold;
  }
  return out;
}
function playDefeat() {
  try {
    if (!sfx) return;
    const set = SFX_SETS["defeat-sfx-data"];
    if (!set || !set.bufs) {
      loadSfxSet("defeat-sfx-data");
      return;
    }
    sfx.resume();
    if (!defeatCrushed)
      defeatCrushed = crushBuffer(set.bufs[0], DEFEAT_BITS, DEFEAT_RATE);
    const src = enemies.length
        ? enemies
        : [{ x: homeTarget.x, z: homeTarget.z }],
      n = src.length,
      v = new THREE.Vector3();
    src.forEach((e, i) => {
      const node = sfx.createBufferSource();
      node.buffer = defeatCrushed;
      node.playbackRate.value =
        1 + (n > 1 ? (i / (n - 1) - 0.5) * 2 * DEFEAT_DETUNE : 0);
      const lp = sfx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = DEFEAT_LOWPASS;
      const g = sfx.createGain();
      g.gain.value = DEFEAT_GAIN / Math.sqrt(n);
      node.connect(lp);
      let last = lp;
      if (sfx.createStereoPanner) {
        v.set(e.x, homeTarget.y, e.z).project(camera);
        const p = sfx.createStereoPanner();
        p.pan.value = Math.max(-0.9, Math.min(0.9, v.x));
        lp.connect(p);
        last = p;
      }
      last.connect(g);
      g.connect(sfx.destination);
      node.start(sfx.currentTime + i * DEFEAT_STAGGER);
    });
  } catch (e) {
    console.error("defeat sound failed", e);
  }
// volume of the defeat sound, and how long DEFEATED stays up (it is 3.8 s long, so it finishes before you are sent out)
}
let turn = "player",
  ep = null,
  endT = 0,
  endKind = null,
  endDone = false;
const pl = { hp: PLAYER_HP, max: PLAYER_HP, guard: false, dead: false };
(function () {
  const st = document.createElement("style");
  st.textContent =
    "#hpl{position:fixed;inset:0;pointer-events:none;z-index:14;display:none;overflow:hidden}body.dungeon #hpl{display:block}" +
    ".hpb{position:absolute;left:0;top:0;width:104px;margin-left:-52px;text-align:center;font-size:19px;line-height:1;color:#fff;text-shadow:2px 2px 0 #000;white-space:nowrap;transition:opacity .4s}" +
    ".hpb .bar{height:9px;background:#1a0a0a;border:2px solid #000;box-shadow:0 0 0 1px #d4dbf7;margin-top:2px}.hpb i{display:block;height:100%;width:100%;background:#58b868}" +
    ".hpb.pl{font-size:21px}.hpb.pl .bar{height:11px}.hpb.dead{opacity:0}" +
    ".dmg{position:absolute;left:0;top:0;font-size:34px;line-height:1;color:#ffe27a;text-shadow:3px 3px 0 #000;white-space:nowrap}.dmg.pl{color:#ff8a7a}.dmg.blk{color:#9fb4ff}.dmg.heal{color:#7dff9a}" +
    "#turn{position:fixed;left:50%;bottom:calc(46px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);font-size:30px;letter-spacing:.14em;color:#ffe27a;text-shadow:3px 3px 0 #000;display:none;z-index:15;pointer-events:none;white-space:nowrap}" +
    "body.dungeon #turn.on{display:block}#turn.foe{color:#ff8a7a}#turn.big{z-index:50;bottom:auto;top:38%;font-size:clamp(54px,9vw,96px);letter-spacing:.08em;color:#fff;text-shadow:0 4px 0 #8fa4ff,0 8px 0 #4558c8,5px 10px 0 #000}#turn.big.lose{color:#ffb0a0;text-shadow:0 4px 0 #e8604f,0 8px 0 #8a2a20,5px 10px 0 #000}" +
    ".tg-s.dead{opacity:.35}" +
    "#klg{position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);width:min(340px,62vw);display:none;z-index:15;pointer-events:none;text-align:center;font-size:22px;letter-spacing:.18em;line-height:1;color:#FFD966;text-shadow:2px 2px 0 #000}" +
    "body.dungeon #klg.on{display:block}#klg .kb{display:flex;gap:4px;margin-top:4px;padding:4px;background:#1a1405;border:2px solid #000;box-shadow:0 0 0 2px #FFD966,0 0 0 4px #000}" +
    "#klg .ks{flex:1;height:14px;background:#2a210a;box-shadow:inset 0 0 0 1px #000}#klg .ks.f{background:linear-gradient(180deg,#fff0b0,#FFD966 55%,#b8902a)}" +
    "#klg.rdy .ks{background:linear-gradient(90deg,#ec2834,#f48818,#fad638,#40e268,#38d8b8,#f85478,#ec2834);background-size:200% 100%;animation:klrb 1.1s linear infinite}#klg.rdy{color:#fff}#klg.rdy .kb{box-shadow:0 0 0 2px #fff,0 0 0 4px #000,0 0 14px 2px #FFD966}" +
    "@keyframes klrb{to{background-position:-200% 0}}" +
    "#dfeat{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .7s linear;z-index:40;display:none;align-items:center;justify-content:center}#dfeat.show{opacity:1}" +
    "#dfeat img{width:min(62vmin,520px);height:min(62vmin,520px);image-rendering:pixelated;opacity:0;transition:opacity .35s linear .6s}#dfeat.show img{opacity:1}";
  document.head.appendChild(st);
})();
const hpLayer = document.createElement("div");
hpLayer.id = "hpl";
document.body.appendChild(hpLayer);
const turnEl = document.createElement("div");
turnEl.id = "turn";
document.body.appendChild(turnEl);
const klEl = document.createElement("div");
klEl.id = "klg";
klEl.innerHTML =
  '<span></span><div class="kb"><i class="ks"></i><i class="ks"></i><i class="ks"></i></div>';
document.body.appendChild(klEl);
let klShown = "";
function klUpdate() {
  const on =
      !!dungeon &&
      klActive() &&
      turn !== "over" &&
      dgState === "idle" &&
      !dgBusy,
    key = on ? kl.n + "|" + KL_MAX : "";
  klEl.classList.toggle("on", on);
  if (key === klShown) return;
  klShown = key;
  if (!on) return;
  klEl.classList.toggle("rdy", klReady());
  klEl.firstChild.textContent = klReady()
    ? "KNIGHT LIGHT READY"
    : "KNIGHT LIGHT " + kl.n + "/" + KL_MAX;
  [].forEach.call(klEl.querySelectorAll(".ks"), (el, i) =>
    el.classList.toggle("f", i < kl.n),
  );
}
/* The defeat picture: the screen fades to black and the 2-frame gif plays on it (red on black) for as long as the defeat sound plays; the DEFEATED text stays on top of it (see #turn.big). It is removed when you leave the ruins. */
const dfEl = document.createElement("div");
dfEl.id = "dfeat";
dfEl.innerHTML = '<img alt="">';
document.body.appendChild(dfEl);
function defeatScreen(on) {
  if (on) {
    const im = dfEl.firstChild;
    im.src =
      "data:image/gif;base64," +
      // set again each time so the gif starts from its first frame
      document.getElementById("defeat-gif").textContent.trim();
    dfEl.style.display = "flex";
    void dfEl.offsetWidth;
    dfEl.classList.add("show");
  } else {
    dfEl.classList.remove("show");
    dfEl.style.display = "none";
  }
}
let bars = [];
const popups = [],
  _hv = new THREE.Vector3();
function barsClear() {
  defeatScreen(false);
  bars.forEach((b) => b.el.remove());
  bars = [];
  popups.forEach((p) => p.el.remove());
  popups.length = 0;
  turnEl.classList.remove("on");
}
function barsBuild() {
  barsClear();
  const mk = (ent, name, isPl) => {
    const el = document.createElement("div");
    el.className = "hpb" + (isPl ? " pl" : "");
    el.innerHTML = '<span></span><div class="bar"><i></i></div>';
    hpLayer.appendChild(el);
    bars.push({
      ent,
      name,
      isPl,
      el,
      txt: el.firstChild,
      fill: el.lastChild.firstChild,
      shown: -1,
    });
  };
  mk(pl, "KNIGHT", true);
  enemies.forEach((e) =>
    mk(
      e,
      e.isSlime
        ? "SLIME"
        : e.isGolem
          ? e.mobName || "GOLEM"
          : TG_NAMES[e.armor] || "STEEL",
      false,
    ),
  );
}
function headPos(b, out) {
  const H = playerH,
    y =
      (b.ent && b.ent.isSlime
        ? blobHome.y + 0.42 * H
        : homeTarget.y + H / 2) +
      0.07 * H;
  if (b.isPl) {
    const p = playerRig.position;
    return out.set(homeTarget.x + p.x, y, homeTarget.z + p.z);
  }
  return out.set(b.ent.x, y, b.ent.z);
}
function barsUpdate(dt) {
  klUpdate();
  const W = innerWidth,
    Hh = innerHeight,
    vis = dgState === "idle" && !dgBusy;
  bars.forEach((b) => {
    const e = b.ent;
    if (b.shown !== e.hp) {
      b.shown = e.hp;
      b.fill.style.width = Math.max(0, (e.hp / e.max) * 100) + "%";
      const f = e.hp / e.max;
      b.fill.style.background =
        f > 0.5 ? "#58b868" : f > 0.25 ? "#e8b830" : "#e8604f";
      b.txt.textContent = b.name + " " + e.hp;
    }
    b.el.classList.toggle("dead", !!e.dead && !b.isPl);
    headPos(b, _hv).project(camera);
    const on = vis && _hv.z < 1 && _hv.z > -1;
    b.el.style.display = on ? "block" : "none";
    if (on)
      b.el.style.transform =
        "translate(" +
        ((_hv.x * 0.5 + 0.5) * W).toFixed(1) +
        "px," +
        ((-_hv.y * 0.5 + 0.5) * Hh - 34).toFixed(1) +
        "px)";
  });
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.t += dt;
    if (p.t > 1.1) {
      p.el.remove();
      popups.splice(i, 1);
      continue;
    }
    _hv.copy(p.pos).project(camera);
    const x = (_hv.x * 0.5 + 0.5) * W,
      y = (-_hv.y * 0.5 + 0.5) * Hh - p.t * 46;
    p.el.style.transform =
      "translate(" +
      x.toFixed(1) +
      "px," +
      y.toFixed(1) +
      "px) translate(-50%,-100%)";
    p.el.style.opacity = p.t < 0.7 ? 1 : Math.max(0, (1.1 - p.t) / 0.4);
  }
  turnEl.classList.toggle("on", vis && !!turnEl.textContent);
}
function popup(text, pos, cls) {
  const el = document.createElement("div");
  el.className = "dmg " + (cls || "");
  el.textContent = text;
  hpLayer.appendChild(el);
  popups.push({ el, pos: pos.clone(), t: 0 });
}
function setTurnLabel(txt, cls) {
  turnEl.textContent = txt || "";
  turnEl.className = cls || "";
}
function battleReset() {
  kl.n = 0;
  klShown = "";
  pl.hp = pl.max = PLAYER_HP;
  pl.guard = false;
  pl.render = false;
  pl.buf = false;
  pl.dead = false;
  pl.haste = 0;
  pl.hasteArm = false;
  potions = POTION_COUNT;
  hastes = HASTE_COUNT;
  potionKind = "heal";
  turn = "player";
  ep = null;
  endDone = false;
  endKind = null;
  barsBuild();
  setTurnLabel("YOUR TURN");
}
function hurtEnemy(e, dmg) {
  e.hp = Math.max(0, e.hp - dmg);
  popup("-" + dmg, headPos({ isPl: false, ent: e }, new THREE.Vector3()), "");
  if (e.hp <= 0) {
    e.dead = true;
    awardGold(e);
    enemyDie(e);
  } else enemyHit(e);
}
/* How enemies die: an enemy with a death animation plays it and stays down (the knights: the rig's Death clip). An enemy without one plays its HIT animation and fades out over FADE_OUT seconds (at least as long as the hit clip), then disappears.
 The slime's file has a clip called "death", but the game uses it as the slime's hit animation, so set SLIME_DEATH_CLIP to a clip name from that file if it ever gets a real death animation (null = hit animation + fade). */
const SLIME_DEATH_CLIP = null,
  ENEMY_FADE_OUT = 0.9;
function enemyDie(e) {
  e.deathDone = false;
  const own = e.isSlime
    ? SLIME_DEATH_CLIP && e.clips[SLIME_DEATH_CLIP]
    : e.isGolem
      ? null
      : actions.Death.getClip();
  if (own) {
    e.death = e.mixer.clipAction(own);
    e.death.reset().setLoop(THREE.LoopOnce, 1);
    e.death.clampWhenFinished = true;
    e.death.timeScale = 1;
    e.idle.fadeOut(0.05);
    e.death.fadeIn(0.05).play();
  } else {
    // no death animation: the hit animation, fading out
    const clip = e.isSlime
      ? e.clips.death
      : e.isGolem
        ? (e.gc || golemClips).Hit
        : actions.Hit.getClip();
    e.hit = e.mixer.clipAction(clip);
    e.hit.reset().setLoop(THREE.LoopOnce, 1);
    e.hit.clampWhenFinished = true;
    e.hit.timeScale = 1;
    e.idle.fadeOut(0.05);
    e.hit.fadeIn(0.05).play();
    (e.fadeMats || []).forEach((m) => {
      m.transparent = true;
      m.depthWrite = false;
    });
    e.fade = { t: 0, dur: Math.max(ENEMY_FADE_OUT, clip.duration) };
  }
  blip(130, 0.14);
  if (e.isSlime) playSlimeSfx("die");
  else if (e.isGolem) playGolemSfx("pain");
  else playGrunt(DEATH_GRUNT);
  tgSync();
}
function fadeEnemies(dt) {
  for (const e of enemies) {
    if (!e.fade) continue;
    e.fade.t += dt;
    const k = Math.min(1, e.fade.t / e.fade.dur);
    (e.fadeMats || []).forEach((m) => {
      m.uniforms.uFade.value = 1 - k;
    });
    if (e.blob && e.blob.material) e.blob.material.opacity = 0.42 * (1 - k);
    if (k >= 1) {
      e.rig.visible = false;
      if (e.blob) e.blob.visible = false;
      e.fade = null;
      e.deathDone = true;
    }
  }
}
function startPotion() {
  // ITEMS > POTION: uses the turn
  if (potions <= 0) {
    bmToast("NO POTIONS");
    return;
  }
  if (pl.hp >= pl.max) {
    bmToast("HP IS FULL");
    return;
  }
  if (!actions.Drinking_Potion) {
    bmToast("NO DRINK ANIMATION");
    return;
  }
  potions--;
  btBegin("potion");
  bt.heading = -Math.PI / 2;
  bt.healed = false;
  bt.haste = false;
  potionKind = "heal";
  play("Drinking_Potion");
}
function startHaste() {
  // ITEMS > HASTE POTION: uses the turn; the next turn is two actions
  if (hastes <= 0) {
    bmToast("NO HASTE POTIONS");
    return;
  }
  if (pl.haste > 0 || pl.hasteArm) {
    bmToast("ALREADY HASTED");
    return;
  }
  if (!actions.Drinking_Potion) {
    bmToast("NO DRINK ANIMATION");
    return;
  }
  hastes--;
  btBegin("potion");
  bt.heading = -Math.PI / 2;
  bt.healed = false;
  bt.haste = true;
  potionKind = "haste";
  pl.hasteArm = true;
  play("Drinking_Potion");
}
function hasteTag() {
  return pl.haste > 0 ? "  HASTE " + (3 - pl.haste) + "/2" : "";
// 'HASTE 1/2', 'HASTE 2/2' while the double turn is on
}
function afterPlayerAction() {
  // the player's command has finished: victory, or the enemies' turn
  if (turn === "over") return;
  if (enemies.length && enemies.every((e) => e.dead)) {
    if (dgWave < dg.waves.length - 1) {
      nextWave();
      return;
    }
    battleEnd("win");
    return;
  }
  if (pl.hasteArm) {
    pl.hasteArm = false;
    pl.haste = 2;
  // he just drank a haste potion: the enemies go now, and his NEXT turn is two actions
  }
  else if (pl.haste > 0) {
    // a hasted turn: after the first action he simply acts again, without the enemies going
    if (pl.render)
      // (RENDER hands the turn over while he holds the swing, so no second action there)
      pl.haste = 0;
    else {
      pl.haste--;
      if (pl.haste > 0) {
        setTurnLabel("YOUR TURN" + hasteTag());
        return;
      }
    }
  }
  startEnemyPhase();
}
function startEnemyPhase() {
  turn = "enemies";
  btBegin("enemy");
  ep = { i: -1, stage: 9, t: 0, e: null };
  setTurnLabel("ENEMY TURN", "foe");
}
function epNext() {
  do {
    ep.i++;
  } while (ep.i < enemies.length && enemies[ep.i].dead);
  if (ep.i >= enemies.length) {
    endEnemyPhase();
    return;
  }
  ep.e = enemies[ep.i];
  ep.stage = 0;
  ep.t = 0;
}
function setEnemyYaw(e, th) {
  e.rig.rotation.y = th;
  if (!e.isSlime && !e.isGolem) {
    const ox = -homeTarget.x,
      oz = -homeTarget.z;
    e.rig.position.set(
      e.x - (ox * Math.cos(th) + oz * Math.sin(th)),
      0,
      e.z - (-ox * Math.sin(th) + oz * Math.cos(th)),
    );
  }
}
function endEnemyPhase() {
  if (pl.render && !pl.dead) {
    pl.render = false;
    pl.guard = false;
    startRenderRelease();
    return;
  }
  // a new turn starts with all three block-hit sounds available again
  blockHitBag = [];
  enemies.forEach((e) => setEnemyYaw(e, Math.PI / 2));
  pl.guard = false;
  pl.buf = false;
  ep = null;
  turn = "player";
  if (!pl.dead) play(idleName());
  btEnd(true);
  setTurnLabel("YOUR TURN" + hasteTag());
}
function playerStruck(e) {
  const g = pl.guard || pl.buf,
    dmg = pl.guard
      ? Math.max(1, Math.round(ENEMY_DAMAGE * GUARD_FACTOR))
      : pl.buf
        ? Math.max(1, Math.round(ENEMY_DAMAGE * (1 - RENDER_GUARD)))
        : ENEMY_DAMAGE;
  pl.hp = Math.max(0, pl.hp - dmg);
  popup(
    "-" + dmg,
    headPos({ isPl: true }, new THREE.Vector3()),
    g ? "pl blk" : "pl",
  );
  if (pl.hp <= 0) {
    pl.dead = true;
    play("Death");
  } else if (pl.render) {
    if (!(current && current.getClip().name === "SwingHeavyTurnHold"))
      playHeavy("SwingHeavyTurnHold", 1, true);
    playBlockHitSeq();
  // RENDER: he keeps holding the swing, the hit is just the sound
  }
  else if (pl.guard) {
    if (!(current && current.getClip().name === "BlockIdle")) playBlockIdle();
    playBlockHitSeq();
  // guarding: he stays in BlockIdle, the hit is just the sound
  }
  else {
    const h = actions.Hit;
    if (h) {
      if (current && current !== h) current.fadeOut(0.06);
      h.reset().setLoop(THREE.LoopOnce, 1);
      h.clampWhenFinished = true;
      h.timeScale = 1;
      h.fadeIn(0.06).play();
      current = h;
    }
    blip(130, 0.14);
    playGrunt();
  }
}
/* ---------- the slime's attack: a squishy, painful-looking jump ----------
 The slime's own 'action' clip only nudges its inner shells about, so a hop is drawn on top of it (the clip still plays underneath, and the hit still lands at SLIME_HIT_AT):
 1 CROUCH   it sinks and bulges sideways, pulling back a little - the wind-up
 2 LAUNCH   it springs up and stretches tall, leaping at the player in a real arc
 3 SPLAT    it lands on the hit and flattens hard (it spreads wide as it flattens, always keeping its volume), with a violent shiver
 4 WOBBLE   it recovers like jelly: a damped spring that overshoots tall, then wide, then settles, while it slides back to its place
 Everything is eased, so there is no snapping between the phases. The numbers are the knobs: how deep the crouch and the splat go (smaller = squashier), the hop height and the lunge, in knight-heights. */
/* Toned down: the original animation is still the star; this only adds a little weight to it, and the whole attack plays SLIME_ATK_SPEED times faster (so it is snappier). All times are in the original clip's seconds. */
const SLIME_ATK_SPEED = 1.35;
const SQ = {
  crouch: 0.3,
  crouchSy: 0.86,
  leapFrom: 0.4,
  hop: 0.07,
  lunge: 0.1,
  pull: 0.02,
  stretch: 0.09,
  splatT: 0.09,
  splatSy: 0.8,
  shake: 0.01,
  wobbleK: 7,
  wobbleW: 26,
  back: [0.82, 1.0],
};
const sqEase = (k) => {
  k = Math.max(0, Math.min(1, k));
  return k * k * (3 - 2 * k);
};
function slimeSquishStart(e, px, pz) {
  const dx = px - e.x,
    dz = pz - e.z,
    d = Math.hypot(dx, dz) || 1;
  e.sqT = 0;
  e.sqAcc = 0;
  e.sqDir = { x: dx / d, z: dz / d };
  e.sqHome = e.rig.position.clone();
  e.sqBase = e.root.scale.x;
  e.root.position.y = 0;
  e.rig.updateMatrixWorld(true);
  // where its underside is (so it squashes onto the ground rather than into it)
  e.sqB = new THREE.Box3().setFromObject(e.root).min.y - e.rig.position.y;
}
function slimeSquish(e, dt) {
  if (e.sqT === undefined || !e.sqHome) return;
  e.sqT += dt * SLIME_ATK_SPEED;
  const t = e.sqT,
    H = playerH,
    hitAt = SLIME_HIT_AT,
    land = hitAt,
    tl = SQ.leapFrom;
  let sy = 1,
    hop = 0,
    lg = 0,
    shx = 0;
  if (t < SQ.crouch) {
    // 1 crouch
    const k = sqEase(t / SQ.crouch);
    sy = 1 - (1 - SQ.crouchSy) * k;
    lg = -SQ.pull * k;
  } else if (t < land) {
    // 2 launch + flight: one arc from the crouch to the landing
    const u = (t - tl) / (land - tl),
      kk = sqEase((t - SQ.crouch) / (tl - SQ.crouch));
    hop = SQ.hop * 4 * Math.max(0, u) * (1 - Math.max(0, u));
    lg = -SQ.pull + (SQ.lunge + SQ.pull) * sqEase(u < 0 ? 0 : u);
    const stretch =
      1 +
      SQ.stretch *
        // tall in the air...
        Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, u))), 0.7);
    // ...springing out of the crouch
    sy = t < tl ? SQ.crouchSy + (stretch - SQ.crouchSy) * kk : stretch;
  } else {
    const a = t - land;
    lg = SQ.lunge;
    if (a < SQ.splatT) {
      // 3 splat: flattens fast
      const k = sqEase(a / SQ.splatT);
      sy = 1.0 - (1.0 - SQ.splatSy) * k;
      shx = SQ.shake * H * Math.sin(t * 95) * (1 - k * 0.3);
    } else {
      // 4 wobble: damped jelly spring back to 1, after the splat has pressed it flat
      const b = a - SQ.splatT,
        amp = 1 - SQ.splatSy;
      sy = 1 - amp * Math.exp(-SQ.wobbleK * b) * Math.cos(SQ.wobbleW * b);
      shx = SQ.shake * H * 0.5 * Math.sin(t * 95) * Math.exp(-14 * b);
      const bk = sqEase((t - SQ.back[0]) / (SQ.back[1] - SQ.back[0]));
      // slides back to its place
      lg = SQ.lunge * (1 - bk);
    }
  }
  sy = Math.max(0.2, sy);
  // volume stays constant: low = wide, tall = thin
  const sxz = 1 / Math.sqrt(sy);
  const S = e.sqBase;
  e.root.scale.set(S * sxz, S * sy, S * sxz);
  e.root.position.y = e.sqB * (1 - sy);
  const d = e.sqDir,
    h = e.sqHome;
  e.rig.position.set(
    h.x + d.x * lg * H + -d.z * shx,
    h.y + hop * H,
    h.z + d.z * lg * H + d.x * shx,
  );
}
function slimeSquishEnd(e) {
  if (!e.sqHome) return;
  e.root.scale.setScalar(e.sqBase || SLIME_SCALE);
  e.root.position.y = 0;
  e.rig.position.copy(e.sqHome);
  e.sqT = undefined;
}
function updateEnemyPhase(dt) {
  if (!ep || turn === "over") return;
  ep.t += dt;
  if (ep.stage === 9) {
    if (ep.t >= ENEMY_START_BEAT) epNext();
    return;
  }
  if (ep.e && ep.e.isSlime && ep.stage >= 1 && ep.stage <= 3) {
    const se = ep.e;
    se.sqAcc = (se.sqAcc || 0) + dt;
    if (se.sqAcc >= SLIME_STEP) {
      const d = Math.floor(se.sqAcc / SLIME_STEP) * SLIME_STEP;
      se.sqAcc -= d;
      slimeSquish(se, d);
    }
  // (the squish moves in the same choppy steps)   // the squishy jump drawn over the slime's own attack clip
  }
  const e = ep.e,
    sw = e.isSlime
      ? e.clips.action
      : e.isGolem
        ? (e.gc || golemClips).Attack
        : actions.Swing.getClip(),
    spd = e.isSlime ? SLIME_ATK_SPEED : e.isGolem ? 1.0 : SWING_SPEED,
    hitAt = e.isSlime
      ? SLIME_HIT_AT / SLIME_ATK_SPEED
      : e.isGolem
        ? e.gc
          ? e.gc.Attack.duration * 0.5
          : GOLEM_HIT_AT
        : CARVE_HIT_AT / SWING_SPEED;
  if (ep.stage === 0) {
    // this enemy turns to face the player and attacks
    const px = homeTarget.x + playerRig.position.x,
      pz = homeTarget.z + playerRig.position.z;
    setEnemyYaw(e, Math.atan2(px - e.x, pz - e.z));
    e.atkDone = false;
    e.atk = e.mixer.clipAction(sw);
    e.atk.reset().setLoop(THREE.LoopOnce, 1);
    e.atk.clampWhenFinished = true;
    e.atk.timeScale = spd;
    e.idle.fadeOut(0.06);
    e.atk.fadeIn(0.06).play();
    if (e.isSlime) {
      playSlimeSfx("atk");
      slimeSquishStart(e, px, pz);
    } else if (!e.isGolem) playSword(SWING_SPEED);
    ep.stage = 1;
    ep.t = 0;
  } else if (ep.stage === 1 && ep.t >= hitAt) {
    ep.stage = 2;
    if (e.isGolem) playGolemSfx("atk");
    playerStruck(e);
  } else if (
    ep.stage === 2 &&
    (e.atkDone || ep.t >= sw.duration / spd + 0.3)
  ) {
    ep.stage = 3;
    ep.t = 0;
  } else if (ep.stage === 3 && ep.t >= ENEMY_HOLD) {
    setEnemyYaw(e, Math.PI / 2);
    if (e.isSlime) slimeSquishEnd(e);
    e.idle.reset().fadeIn(0.12).play();
    e.atk.fadeOut(0.12);
    if (pl.dead) {
      battleEnd("lose");
      return;
    }
    // a raised guard stays up between the enemies' attacks
    if (!pl.guard && !pl.render) play(idleName());
    epNext();
  }
}
function battleEnd(kind) {
  // silence for the defeat sting, the flaunt song for a victory
  setBattleMusic(false);
  turn = "over";
  endKind = kind;
  endT = kind === "lose" ? DEFEAT_SHOW : END_SHOW;
  endDone = false;
  bmClose(true);
  if (kind === "lose") {
    defeatScreen(true);
    playDefeat();
    if (enemies.some((e) => e.isSlime && !e.dead)) playSlimeSfx("win");
  // Castlevania: Judgment's defeat sting, crushed and sung by the knights
  }
  if (kind === "win") {
    setTurnLabel("VICTORY!", "big");
    if (actions.Flaunt || actions.AxeFlaunt) play("Flaunt");
  } else setTurnLabel("DEFEATED", "big lose");
  hudSet(HINT_BUSY);
}
function updateBattle(dt) {
  if (turn === "over") {
    endT -= dt;
    if (endT <= 0 && !endDone) {
      endDone = true;
      if (endKind === "win" && chestReady()) {
        startChestScene();
      } else {
        if (endKind === "win") play(idleName());
        leaveDungeon();
      }
    }
    return;
  }
  if (!bt.act) return;
  bt.t += dt;
  if (bt.act === "carve") {
    const e = bt.en;
    if (bt.stage === 0 && bt.t >= CARVE_HIT_AT / SWING_SPEED) {
      bt.stage = 1;
      bt.hitT = bt.t;
      hurtEnemy(e, SWING_DAMAGE);
    // the blade connects
    }
    else if (
      bt.stage === 1 &&
      ((e.dead ? e.deathDone : e.hitDone) || bt.t - bt.hitT > 4)
    ) {
      bt.stage = 2;
      bt.hold = 0;
    // (the 4 s is a safety net so a missed 'finished' event can never freeze the fight)
    }
    // Hit has played through; its last frame stays on screen
    else if (bt.stage === 2) {
      bt.hold += dt;
      if (bt.hold >= (e.dead ? DEATH_HOLD : HIT_HOLD)) {
        bt.stage = 3;
        if (!e.dead) {
          e.idle.reset().fadeIn(0.12).play();
          e.hit.fadeOut(0.12);
        }
      }
    } else if (bt.stage === 3 && bt.t >= 0.02 && !swinging) {
      btEnd();
    // back to Idle on both sides
    }
  } else if (bt.act === "knightlight") {
    const e = bt.en,
      a = actions.HeavyCombo,
      dur = a ? a.getClip().duration : 0;
    if (bt.stage === 0 && bt.t >= HEAVY_COMBO_FINISH_T) {
      bt.stage = 1;
      bt.hitT = bt.t;
      hurtEnemy(e, KL_DAMAGE);
    // the blade comes down: the finishing blow lands
    }
    else if (
      bt.stage === 1 &&
      ((e.dead ? e.deathDone : e.hitDone) || bt.t - bt.hitT > 4)
    ) {
      bt.stage = 2;
      bt.hold = 0;
    } else if (bt.stage === 2) {
      bt.hold += dt;
      if (bt.hold >= (e.dead ? DEATH_HOLD : HIT_HOLD)) {
        bt.stage = 3;
        if (!e.dead) {
          e.idle.reset().fadeIn(0.12).play();
          e.hit.fadeOut(0.12);
        }
      }
    } else if (bt.stage === 3 && bt.t >= dur - 0.05) {
      play(idleName());
      btEnd();
    // the clip has finished its recovery
    }
  } else if (bt.act === "flaunt") {
    if (bt.t >= FLAUNT_TIME) {
      play(idleName());
      btEnd();
    }
  } else if (bt.act === "block") {
    if (bt.t >= actions.Block.getClip().duration + BLOCK_HOLD) {
      playBlockIdle();
      btEnd();
    // Block has played: he stays in BlockIdle (a loop) through the enemies' whole turn
    }
  } else if (bt.act === "render") {
    if (
      bt.stage === 0 &&
      bt.t >= actions.SwingHeavyWindUp.getClip().duration
    ) {
      bt.stage = 1;
      playHeavy("SwingHeavyTurnHold", 1, true);
      afterPlayerAction();
    // windup done: he holds while the enemies take their turn
    }
  } else if (bt.act === "renderswing") {
    const rd = actions.SwingHeavyRelease.getClip().duration;
    if (bt.stage === 0 && bt.t >= rd * 0.45) {
      bt.stage = 1;
      bt.hold = 0;
      playSfxSet("render-swish-sfx-data", 0, 0.9, 1, 0);
      playSfxSet("render-hit-sfx-data", 0, 0.9, 1, 0.03);
      playRenderAttackLayer();
      enemies.forEach((e) => {
        if (!e.dead) hurtEnemy(e, RENDER_DAMAGE);
      });
    // the blade connects: all targets
    }
    else if (bt.stage === 1) {
      bt.hold += dt;
      if (bt.t >= rd && bt.hold >= HIT_HOLD) {
        bt.stage = 2;
        enemies.forEach((e) => {
          if (!e.dead && e.hit) {
            e.idle.reset().fadeIn(0.12).play();
            e.hit.fadeOut(0.12);
          }
        });
        play(idleName());
        btEnd();
      }
    // btEnd -> victory, or the enemies go again; then he gets to pick
    }
  } else if (bt.act === "potion") {
    const c = current && current.getClip().name === "Drinking_Potion";
    if (!bt.healed && c && current.time >= POTION_HEAL_AT) {
      bt.healed = true;
      const h = bt.haste ? 0 : Math.min(POTION_HEAL, pl.max - pl.hp);
      pl.hp += h;
      popup(
        bt.haste ? "HASTE" : "+" + h,
        headPos({ isPl: true }, new THREE.Vector3()),
        "heal",
      );
      blip(660, 0.1);
      setTimeout(() => blip(880, 0.12), 90);
    }
    if (
      bt.t >=
      actions.Drinking_Potion.getClip().duration + DRINK_HOLD + 0.25
    ) {
      if (c) play(idleName());
      btEnd();
    }
  } else if (bt.act === "enemy") {
    updateEnemyPhase(dt);
  }
}
addEventListener("keydown", (e) => {
  if (!dungeon || dgBusy) return;
  const k = e.key.toLowerCase();
  // nothing to press while an action plays (Esc still leaves)
  if (bt.act) return;
  if (bmOpen) {
    if (k === "arrowup" || k === "w") {
      bmSet(bmIdx - 1);
      blip(480, 0.04);
    } else if (k === "arrowdown" || k === "s") {
      bmSet(bmIdx + 1);
      blip(480, 0.04);
    } else if ((k === "enter" || k === " ") && !e.repeat) bmChoose();
    else if (k === "backspace") bmBack();
  } else if ((k === "enter" || k === " ") && !e.repeat) bmShow();
});
document.getElementById("dgl").onclick = () => {
  if (dungeon) movePointer(-1);
};
document.getElementById("dgr").onclick = () => {
  if (dungeon) movePointer(1);
};
document.getElementById("dgok").onclick = () => {
  if (!dungeon || bt.act) return;
  if (bmOpen) bmChoose();
  else bmShow();
};
document.getElementById("dgback").onclick = () => {
  if (dungeon) bmBack();
};
bmBuild("root");
function smoothDamp(c, t, v, tc, dt) {
  // critically damped spring: reaches t smoothly, velocity never jumps
  const w = 2 / tc,
    x = w * dt,
    ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x),
    ch = c - t,
    tmp = (v.v + w * ch) * dt;
  v.v = (v.v - w * tmp) * ex;
  return t + (ch + tmp) * ex;
}
function dungeonStep(dt) {
  const p = playerRig.position,
    H = playerH;
  updatePointer(dt);
  updateBattle(dt);
  if (dgState === "walkin") {
    p.x -= WALK_SPEED * H * dt;
    if (p.x <= 0) {
      p.x = 0;
      dgState = "idle";
      moving = false;
      play(idleName());
      dgDur = dgT + 1.6;
    // arrived on the circle: Idle, then the camera starts roaming
    }
  } else if (dgState === "chest") {
    if (
      !chestDone &&
      current &&
      current === actions.Chestopen &&
      current.time >= current.getClip().duration - 0.03
    )
      // (safety net in case the 'finished' event is missed)
      chestDone = true;
    if (chestDone && !dgBusy) {
      if (chestEndT < 0) chestEndT = CHEST_END_HOLD;
      chestEndT -= dt;
      if (chestEndT <= 0 && !loot.on && !loot.picked) showLoot();
    // the clip has ended: after a moment the three loot cards come up, and picking one is what leaves (see lootPick)   // the clip has ended: hold its last pose a moment, then fade to black and back to the menu
    }
  }
  // camera director: slow pan inside a shot, smooth blend into the next one
  dgT += dt;
  dgYaw += ((dgShot.drift * Math.PI) / 180) * dt;
  const tg = {
    yaw: dgYaw,
    pitch: dgShot.pitch,
    dist: dgShot.dist,
    ty: dgShot.ty,
    mid: dgShot.mid,
  };
  if (dgBlend < 1 && dgFrom) {
    dgBlend = Math.min(1, dgBlend + dt / dgBlendT);
    // smootherstep: eases in AND out with no jolt
    const e = dgBlend * dgBlend * dgBlend * (dgBlend * (dgBlend * 6 - 15) + 10);
    dgCam.yaw =
      // fixed direction + the new shot's drift so far (lands exactly on the shot's own yaw)
      dgFrom.yaw + (dgFrom.dy0 + ((dgShot.drift * Math.PI) / 180) * dgT) * e;
    dgCam.pitch = dgFrom.pitch + (tg.pitch - dgFrom.pitch) * e;
    dgCam.dist = dgFrom.dist + (tg.dist - dgFrom.dist) * e;
    dgCam.ty = dgFrom.ty + (tg.ty - dgFrom.ty) * e;
    dgCam.mid = dgFrom.mid + (tg.mid - dgFrom.mid) * e;
  } else Object.assign(dgCam, tg);
  if (dgT >= dgDur) dgNext();
  const kx = homeTarget.x + p.x,
    kz = homeTarget.z + p.z,
    ex = homeTarget.x - dg.enemy.dist * H;
  if (dgState === "chest")
    // between him and the chest (he faces west)
    target.set(kx - CHEST_LOOK_FWD * H, homeTarget.y + dgCam.ty * H, kz);
  else
    target.set(
      kx + (ex - kx) * dgCam.mid,
      homeTarget.y + dgCam.ty * H,
      kz + (homeTarget.z - kz) * dgCam.mid,
    );
  /* The camera plays the shot and nothing else: it no longer pulls in, rises over a wall or backs off because of the scenery (that wall test is what kept pushing it away and back).
   Anything that gets between the camera and someone, or very close to the lens, dithers away instead (see-through obstacles, occUpdate). */
  yaw = dgCam.yaw;
  pitch = dgCam.pitch;
  zoom = (dgCam.dist * H) / (camera.userData.fit || 5);
  if (blobMesh && blobHome)
    blobMesh.position.set(blobHome.x + p.x, blobHome.y, blobHome.z + p.z);
}
