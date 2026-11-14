// Music, bitcrusher, animation control, golem, enemy viewer, pizza.
// (Part 7 of 14. All parts share one scope; see README.)

/* ---------- music (decoded in-page with WebAudio; no fetch needed) ---------- */
let ac = null,
  songBuf = null,
  srcNode = null,
  musicGain = null,
  decoding = null,
  musicOn = false,
  userChose = false;
let flauntWant = false,
  flauntDone = false,
  flauntBuf = null,
  flauntSrc = null,
  // the Flaunt animation swaps the music for its own song
  flauntLoading = null;
let battleWant = false,
  battleBuf = null,
  battleSrc = null,
  battleLoading = null,
  battleResume = 0,
  // the battle song, and the bitcrushed switch (on by default; the BITCRUSH option turns it off)
  crushOn = true;
/* fades (seconds): a track fades in when it starts, fades out when it stops or is swapped for another, and dips briefly at each loop seam */
const FADE_IN = 1.5,
  FADE_OUT = 0.7,
  FADE_LOOP = 1.0;
function playTrack(buf, offset, fin) {
  offset = offset || 0;
  fin = fin == null ? FADE_IN : fin;
  const g = ac.createGain(),
    src = ac.createBufferSource(),
    t0 = ac.currentTime + 0.05,
    D = buf.duration;
  src.buffer = cz(buf);
  src.loop = true;
  src.connect(g);
  // cz(): the bitcrushed copy when that switch is on
  g.connect(musicGain);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(1, t0 + fin);
  // time until the first loop seam
  const first = D - offset;
  for (
    let k = first - FADE_LOOP < fin + 0.1 ? 1 : 0;
    k < Math.ceil(7200 / D);
    k++
  ) {
    // schedule the seam dips for the next two hours of looping
    const e = t0 + first + k * D;
    g.gain.setValueAtTime(1, e - FADE_LOOP);
    g.gain.linearRampToValueAtTime(0, e);
    g.gain.setValueAtTime(0, e);
    g.gain.linearRampToValueAtTime(1, e + FADE_LOOP);
  }
  src.start(t0, offset);
  return { src, gain: g, buf, t0, off: offset, D };
}
function trackPos(tr) {
  return (tr.off + Math.max(0, ac.currentTime - tr.t0)) % tr.D;
}
function stopTrack(tr) {
  if (!tr) return;
  const p = tr.gain.gain,
    t = ac.currentTime;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(0, t + FADE_OUT);
  try {
    tr.src.stop(t + FADE_OUT + 0.05);
  } catch (_) {}
  setTimeout(
    () => {
      try {
        tr.src.disconnect();
        tr.gain.disconnect();
      } catch (_) {}
    },
    (FADE_OUT + 0.4) * 1000,
  );
}
function fadeMaster(to, secs) {
  const p = musicGain.gain,
    t = ac.currentTime;
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(to, t + secs);
}
function loadSong() {
  if (decoding) return decoding;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return Promise.reject(new Error("no WebAudio"));
  ac = new AC();
  musicGain = ac.createGain();
  musicGain.gain.value = 0.6;
  musicGain.connect(ac.destination);
  const s = atob(document.getElementById("song-data").textContent.trim()),
    u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  decoding = new Promise((res, rej) =>
    ac.decodeAudioData(u.buffer, res, rej),
  ).then((b) => {
    songBuf = b;
  });
  return decoding;
}
async function startMusic() {
  try {
    const p = loadSong();
    ac.resume();
    await p;
    // (EDIT plays its own song: the main one must not start up under it, e.g. when it finished loading just after EDIT began)
    if (!musicOn || editOn) return;
    if (
      !srcNode &&
      !flauntWant &&
      !battleWant &&
      !shopWant &&
      !frostWant &&
      !ignisWant
    ) {
      srcNode = playTrack(songBuf);
    }
    await ac.resume();
  } catch (e) {
    console.error(e);
    musicOn = false;
    setSwitch("music", false, "N/A");
  }
}
async function toggleMusic() {
  userChose = true;
  musicOn = !musicOn;
  setSwitch("music", musicOn, musicOn ? "On" : "Off");
  if (musicOn) {
    if (musicGain) fadeMaster(0.6, FADE_IN);
    await startMusic();
    syncAudio();
  } else if (ac) {
    fadeMaster(0, FADE_OUT);
    setTimeout(
      () => {
        if (!musicOn) ac.suspend();
      },
      FADE_OUT * 1000 + 80,
    );
  // fade out, then pause
  }
}
/* ---------- flaunt song ----------
 While the Flaunt animation plays, the main music stops and this plays instead. The file is the song from 3:29 to the end (so 4:30 is 61 s in),
 and it loops back to 3:29, so the 4:30 part comes round every time. It follows the Music switch: with music Off it stays silent. */
function loadFlaunt() {
  if (flauntLoading) return flauntLoading;
  const t = atob(document.getElementById("flaunt-data").textContent.trim()),
    u = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
  flauntLoading = new Promise((res, rej) =>
    ac.decodeAudioData(u.buffer, res, rej),
  ).then((b) => {
    flauntBuf = b;
  });
  return flauntLoading;
}
/* ---------- battle song ----------
 Plays from the moment you walk into the ruins until the fight ends (victory or defeat). The Flaunt song still takes over for the length of a Flaunt; the battle song then
 comes back where it left off. Order of priority: Flaunt song, battle song, main song. Everything follows the Music switch. */
function loadBattle() {
  if (battleLoading) return battleLoading;
  const t = atob(document.getElementById("battle-data").textContent.trim()),
    u = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
  battleLoading = new Promise((res, rej) =>
    ac.decodeAudioData(u.buffer, res, rej),
  ).then((b) => {
    battleBuf = b;
  });
  return battleLoading;
}
function setBattleMusic(on) {
  if (battleWant === on) return;
  battleWant = on;
  if (!on) battleResume = 0;
  syncAudio();
}
/* shop song (Sacrifice of Saint Dell, FM Skyline) plays in the shop; frost song (Ice, slowed, ZERTAL) plays once you travel to The Veiled Frost (on the map, from the transition between the areas) and stays while you are there.
 Priority: Flaunt song, battle song, shop song, frost song, main song. Same fades as every track, and they go through cz() so the BITCRUSH switch applies. */
const xtra = {
  shop: { id: "shop-song-data", buf: null, src: null, loading: null },
  shop2: { id: "shop-song2-data", buf: null, src: null, loading: null },
  frost: { id: "frost-song-data", buf: null, src: null, loading: null },
  ignis: { id: "ignis-song-data", buf: null, src: null, loading: null },
  dance: { id: "dance-song-data", buf: null, src: null, loading: null },
  dance2: { id: "dance2-song-data", buf: null, src: null, loading: null },
  dance3: { id: "dance3-song-data", buf: null, src: null, loading: null },
};
let shopWant = false,
  frostWant = false,
  ignisWant = false,
  // dance: the song for the Dance animation (top priority)
  danceWant = false;
/* The shop song's name tag (bottom right of the shop view) is also the switch between the shop's songs: click it to swap (shopSong is 'shop' or 'shop2'; the choice is kept for later visits).
 To add another shop song: add it to xtra above (+ manifest.json), to SHOP_SONG_NAMES here and to SHOP_SONGS (the order they cycle in). */
let shopSong = "shop",
  shopSongBtn = null;
const SHOP_SONG_NAMES = {
    shop: "SACRIFICE OF SAINT DELL",
    shop2: "ASSHOLE PARTY",
  },
  SHOP_SONGS = ["shop", "shop2"];
function shopSongLabel() {
  if (shopSongBtn)
    shopSongBtn.innerHTML =
      "\u266A " +
      SHOP_SONG_NAMES[shopSong] +
      "<small>CLICK: CHANGE SONG</small>";
}
function shopSongNext() {
  shopSong =
    SHOP_SONGS[(SHOP_SONGS.indexOf(shopSong) + 1) % SHOP_SONGS.length];
  shopSongLabel();
  blip(520, 0.06);
  if (shopWant) syncAudio();
// syncAudio fades the old shop song out and the new one in
}
function loadX(k) {
  const x = xtra[k];
  if (x.loading) return x.loading;
  const t = atob(document.getElementById(x.id).textContent.trim()),
    u = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
  x.loading = new Promise((res, rej) =>
    ac.decodeAudioData(u.buffer, res, rej),
  ).then((b) => {
    x.buf = b;
  });
  return x.loading;
}
function setShopMusic(on) {
  if (shopWant === on) return;
  shopWant = on;
  syncAudio();
}
function setFrostMusic(on) {
  if (frostWant === on) return;
  frostWant = on;
  syncAudio();
}
function setIgnisMusic(on) {
  if (ignisWant === on) return;
  ignisWant = on;
  syncAudio();
}
async function syncAudio() {
  const pick = () =>
    !musicOn || editOn
      ? null
      : danceWant
        ? danceKey
        : flauntWant
          ? "flaunt"
          : battleWant
            ? "battle"
            : shopWant
              ? shopSong
              : ignisWant
                ? "ignis"
                : frostWant
                  ? "frost"
                  : "main";
  const stopX = (keep) => {
    for (const k in xtra) {
      if (k !== keep && xtra[k].src) {
        stopTrack(xtra[k].src);
        xtra[k].src = null;
      }
    }
  };
  try {
    const want = pick();
    if (want && want !== "main") {
      const p = loadSong();
      ac.resume();
      await p;
      await (want === "flaunt"
        ? loadFlaunt()
        : want === "battle"
          ? loadBattle()
          : loadX(want));
      // things changed while it was loading
      if (pick() !== want) return;
      if (srcNode) {
        stopTrack(srcNode);
        srcNode = null;
      // the other music fades out as this one fades in
      }
      stopX(want);
      if (want === "flaunt") {
        if (battleSrc) {
          battleResume = trackPos(battleSrc);
          stopTrack(battleSrc);
          battleSrc = null;
        // remember where the battle song was
        }
        if (!flauntSrc) flauntSrc = playTrack(flauntBuf);
      } else if (want === "battle") {
        if (flauntSrc) {
          stopTrack(flauntSrc);
          flauntSrc = null;
        }
        if (!battleSrc) {
          battleSrc = playTrack(battleBuf, battleResume);
          battleResume = 0;
        }
      } else {
        if (flauntSrc) {
          stopTrack(flauntSrc);
          flauntSrc = null;
        }
        if (battleSrc) {
          stopTrack(battleSrc);
          battleSrc = null;
        }
        if (!xtra[want].src) xtra[want].src = playTrack(xtra[want].buf);
      }
      await ac.resume();
    } else {
      if (flauntSrc) {
        stopTrack(flauntSrc);
        flauntSrc = null;
      }
      if (battleSrc) {
        stopTrack(battleSrc);
        battleSrc = null;
      }
      stopX("");
      if (!want && srcNode) {
        stopTrack(srcNode);
        srcNode = null;
      // no music wanted (EDIT is playing its own song): the main music fades out too
      }
      // the main music comes back
      if (want === "main") startMusic();
    }
  } catch (e) {
    console.error(e);
  }
}

/* ---------- bitcrushed ----------
 Does to every audio file what the defeat sound gets: mono, sample-and-hold down to DEFEAT_RATE Hz, quantised to DEFEAT_BITS bits, then the DEFEAT_LOWPASS Hz low-pass
 (the "inside a helmet" muffle). Music tracks and sound effects both go through cz(); copies are made once and kept. The defeat sound is always crushed, with or without the switch. */
const crushCache = new WeakMap();
/* per-song crush: everything is crushed with DEFEAT_BITS / DEFEAT_RATE / DEFEAT_LOWPASS (6 bits, 8000 Hz, 3200 Hz low-pass) unless a buffer has its own entry here. */
// (a song can be given its own crush settings here: crushParams.set(buffer,{bits,rate,lp}))
const crushParams = new WeakMap();
function crushCopy(b) {
  let c = crushCache.get(b);
  if (c) return c;
  const n = b.length,
    sr = b.sampleRate;
  c =
    typeof AudioBuffer === "function"
      ? new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: sr })
      : (ac || sfx).createBuffer(1, n, sr);
  const o = c.getChannelData(0),
    ch = [];
  for (let k = 0; k < b.numberOfChannels; k++) ch.push(b.getChannelData(k));
  const P = crushParams.get(b) || {
    bits: DEFEAT_BITS,
    rate: DEFEAT_RATE,
    lp: DEFEAT_LOWPASS,
  };
  const step = Math.max(1, Math.round(sr / P.rate)),
    lv = Math.pow(2, P.bits - 1);
  let hold = 0;
  for (let i = 0; i < n; i++) {
    if (i % step === 0) {
      let v = 0;
      for (let k = 0; k < ch.length; k++) v += ch[k][i];
      v /= ch.length;
      hold = Math.round(v * lv) / lv;
    }
    o[i] = hold;
  }
  const w = (2 * Math.PI * P.lp) / sr,
    cs = Math.cos(w),
    al = Math.sin(w) / (2 * 0.7071),
    a0 = 1 + al,
    b0 = (1 - cs) / 2 / a0,
    b1 = (1 - cs) / a0,
    b2 = b0,
    a1 = (-2 * cs) / a0,
    // biquad low-pass
    a2 = (1 - al) / a0;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < n; i++) {
    const x0 = o[i],
      y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    o[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  crushCache.set(b, c);
  return c;
}
function cz(b) {
  return crushOn ? crushCopy(b) : b;
}
function swapTrack(tr) {
  const pos = trackPos(tr);
  stopTrack(tr);
  return playTrack(tr.buf, pos, 0.3);
// same place in the song, crossfaded to the other version
}
function toggleCrush() {
  crushOn = !crushOn;
  try {
    if (ac) {
      if (srcNode) srcNode = swapTrack(srcNode);
      if (flauntSrc) flauntSrc = swapTrack(flauntSrc);
      if (battleSrc) battleSrc = swapTrack(battleSrc);
      for (const k in xtra)
        if (xtra[k].src) xtra[k].src = swapTrack(xtra[k].src);
    }
  } catch (e) {
    console.error(e);
  }
}
document.getElementById("music").onclick = toggleMusic;
// browsers only allow audio after a gesture, so the song starts on the first tap or key press
function firstGesture(e) {
  if (
    userChose ||
    (e.target.closest && e.target.closest("#music")) ||
    (e.key && e.key.toLowerCase() === "m")
  )
    return;
  musicOn = true;
  setSwitch("music", true, "On");
  startMusic();
}
["pointerdown", "keydown"].forEach((n) =>
  addEventListener(n, firstGesture, { once: true }),
);

/* ---------- animation control ---------- */
/* ---------- GOLEM (ANIMATIONS screen): golem-data is his Blockbench model, golem-attack-data the GolemAttack clip (same track format as the other clips).
 Picking GolemAttack hides the knight and shows the golem in his place; picking anything else, or leaving the screen, brings the knight back. ---------- */
// golem height as a fraction of the knight's (his raised fists reach well above his head)
const GOLEM_SCALE = 0.9;
let golemRig = null,
  golemScene = null,
  golemMixer = null,
  golemOn = false,
  golemH0 = 1,
  golemMinY = 0,
  golemClips = null,
  golemAll = null;
// seconds into GolemAttack where the fists land (the slam), for the damage and the hit sound
const GOLEM_HIT_AT = 0.5;
function golemEye(o) {
  return !!(o.parent && o.parent.name === "Torso" && o.position.z > 0.2);
// the two small cubes on his torso
}
function golemReady() {
  return !!(golemScene && golemClips && golemClips.Idle && golemClips.Hit);
}
function playGolemSfx(kind) {
  playSfxSet(
    kind === "atk"
      ? "golem-atk-sfx-data"
      : kind === "pain"
        ? "golem-pain-sfx-data"
        : "golem-spawn-sfx-data",
    0,
    0.9,
    1,
    0,
  );
}
(function () {
  const el = document.getElementById("golem-data"),
    ad = document.getElementById("golem-attack-data");
  if (!el || !ad) return;
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
          if (golemEye(o)) o.material.uniforms.uMagma.value = 1;
        // his two eyes glow like the Ignis trees' magma
        });
        g.scene.updateMatrixWorld(true);
        const bx = new THREE.Box3().setFromObject(g.scene);
        golemH0 = bx.max.y - bx.min.y;
        golemMinY = bx.min.y;
        golemScene = g.scene;
        golemRig = new THREE.Group();
        golemRig.add(g.scene);
        golemRig.visible = false;
        scene.add(golemRig);
        const D = JSON.parse(ad.textContent);
        const clip = new THREE.AnimationClip(
          D.name,
          -1,
          D.tracks.map((k) =>
            k.p === "q"
              ? new THREE.QuaternionKeyframeTrack(
                  k.n + ".quaternion",
                  k.t,
                  k.v,
                )
              : new THREE.VectorKeyframeTrack(k.n + ".position", k.t, k.v),
          ),
        );
        golemMixer = new THREE.AnimationMixer(g.scene);
        golemClips = {
          Idle: g.animations.find((a) => a.name === "Idle"),
          Hit: g.animations.find((a) => a.name === "Hit"),
          Attack: clip,
        };
        {
          const rd = document.getElementById("golem-introroar-data"),
            R = rd && JSON.parse(rd.textContent),
            // golem-introroar-data: the intro roar clip (same track format as GolemAttack)
            blk = g.animations.find((a) => a.name === "Block");
          golemAll = {
            Idle: golemClips.Idle,
            Attack: clip,
            Hit: golemClips.Hit,
            IntroRoar: R
              ? new THREE.AnimationClip(
                  R.name,
                  -1,
                  R.tracks.map((k) =>
                    k.p === "q"
                      ? new THREE.QuaternionKeyframeTrack(
                          k.n + ".quaternion",
                          k.t,
                          k.v,
                        )
                      : new THREE.VectorKeyframeTrack(
                          k.n + ".position",
                          k.t,
                          k.v,
                        ),
                  ),
                )
              : null,
            Block: blk,
          };
        }
        // the enemy golems use these (their own Idle and Hit from the model file, and GolemAttack)
        if (SNAP_ON && golemClips.Hit) snapClip(golemClips.Hit);
      },
      (e) => console.error("golem failed", e),
    );
  } catch (e) {
    console.error(e);
  }
})();
function golemPlace() {
  // stand where the knight stands, facing the way he faces (same rig, both models face +Z)
  const k = (GOLEM_SCALE * playerH) / golemH0;
  golemRig.scale.setScalar(k);
  golemRig.position.set(
    playerRig.position.x,
    groundYNight - golemMinY * k,
    playerRig.position.z,
  );
  golemRig.rotation.y = playerRig.rotation.y;
}
/* ---------- ENEMY VIEWER (ANIMATIONS > ENEMIES > enemy > animation) ----------
 Picking an enemy's animation hides the knight and shows that enemy in his place, looping the clip. Every enemy type is listed (golem, treeling, sporeling, slime) with all the clips its model has.
 golemOn means "an enemy is being shown". The golem keeps his sounds (the slam on ATTACK, the roar on INTRO ROAR, the grunt on HIT); picking a knight animation or leaving the ANIMATIONS screens brings the knight back. */
const EV_ENEMIES = [
  { key: "golem", name: "GOLEM" },
  { key: "treeling", name: "TREELING" },
  { key: "sporeling", name: "SPORELING" },
  { key: "slime", name: "SLIME" },
];
const EV_LABEL = {
  idle: "IDLE",
  hit: "HIT",
  atk: "ATTACK",
  action: "ATTACK",
  attack: "ATTACK",
  introroar: "INTRO ROAR",
  block: "BLOCK",
  death: "DEATH",
};
const evViews = {};
// evCur: {key,ci,v,act,label}
let evCur = null;
function evDefs(key) {
  // [{label,clip}] straight from the loaded models (null until the model has loaded)
  let src = null;
  if (key === "golem") {
    if (!golemAll) return null;
    src = ["Idle", "Attack", "Hit", "IntroRoar", "Block"]
      .map((n) => golemAll[n] && [n, golemAll[n]])
      .filter(Boolean);
  } else if (key === "slime") {
    if (!elementalGltf) return null;
    src = elementalGltf.animations.map((a) => [a.name, a]);
  } else {
    const M = mobModels[key];
    if (!M || !M.all) return null;
    src = M.all.map((a) => [a.name, a]);
  }
  return src.map(([n, c]) => ({
    label: EV_LABEL[n.toLowerCase()] || n.toUpperCase(),
    clip: c,
  }));
}
function evBuild(key) {
  if (evViews[key]) return evViews[key];
  const defs = evDefs(key);
  if (!defs || !scene) return null;
  let v = null;
  if (key === "golem") {
    if (!golemRig) return null;
    v = { key, rig: golemRig, mixer: golemMixer, golem: true };
  } else if (key === "slime") {
    const root = cloneElemental(),
      rig = new THREE.Group();
    rig.add(root);
    rig.visible = false;
    scene.add(rig);
    v = { key, rig, root, mixer: new THREE.AnimationMixer(root) };
  } else {
    const M = mobModels[key],
      D = MOBS[key],
      root = M.scene.clone(true),
      gk = (D.scale * playerH) / M.h0,
      rig = new THREE.Group();
    root.scale.setScalar(gk);
    root.position.y = -M.minY * gk;
    rig.add(root);
    rig.visible = false;
    scene.add(rig);
    v = { key, rig, root, mixer: new THREE.AnimationMixer(root) };
  }
  v.defs = defs;
  v.acts = defs.map((d) => v.mixer.clipAction(d.clip));
  return (evViews[key] = v);
}
function evPlace(v) {
  // stand where the knight stands, facing the way he faces
  if (v.golem) {
    golemPlace();
    return;
  }
  v.rig.position.set(
    playerRig.position.x,
    groundYNight,
    playerRig.position.z,
  );
  v.rig.rotation.y = playerRig.rotation.y;
}
function evSfx(kind) {
  if (evCur && evCur.key === "golem") playGolemSfx(kind);
}
function evPlay(key, ci) {
  const v = evBuild(key);
  if (!v || !playerRig) return false;
  if (evCur && evCur.v !== v) {
    evCur.v.rig.visible = false;
    evCur.v.mixer.stopAllAction();
  } else if (evCur) evCur.act.stop();
  if (!golemOn) {
    golemOn = true;
    if (current) current.paused = true;
    playerRig.visible = false;
  // the hidden knight's clip must not keep running (Chestopen looped on behind the golem and replayed the chest creak)
  }
  const act = v.acts[ci],
    label = v.defs[ci].label;
  v.rig.visible = true;
  evPlace(v);
  act.reset().setLoop(THREE.LoopRepeat, Infinity).play();
  v.mixer.update(0);
  evCur = { key, ci, v, act, label };
  if (label === "INTRO ROAR") evSfx("spawn");
  else if (label === "HIT") evSfx("pain");
  return true;
}
function evStep(dt) {
  if (!golemOn || !evCur) return;
  const { v, act, label } = evCur;
  evPlace(v);
  const p = act.time;
  v.mixer.update(dt);
  const t = act.time;
  if (label === "ATTACK" && p < GOLEM_HIT_AT && t >= GOLEM_HIT_AT)
    // the fists land
    evSfx("atk");
  if (t < p) {
    if (label === "INTRO ROAR") evSfx("spawn");
    else if (label === "HIT") evSfx("pain");
  // looped round
  }
}
function evHide() {
  if (!golemOn) return;
  golemOn = false;
  if (evCur) {
    evCur.v.rig.visible = false;
    evCur.v.mixer.stopAllAction();
    evCur = null;
  }
  if (playerRig) playerRig.visible = true;
  if (current) current.paused = false;
}
function golemShow(on) {
  if (!on) evHide();
// (older callers: only "hide" is ever asked for now)
}
function playGolem() {
  const d = evDefs("golem");
  if (d)
    evPlay(
      "golem",
      Math.max(
        0,
        d.findIndex((x) => x.label === "ATTACK"),
      ),
    );
}
/* ---------- PIZZA: the Soccer Trip (a running trip and tumble, retargeted from Mixamo, done in place) with the "Ayo, the pizza here" meme.
 The animation starts the moment it is picked, at its own speed. The sound plays at its own speed too, starting PIZZA_AUDIO_START seconds into the meme (at the bump). Picking anything else cuts it off. ---------- */
const PIZZA_AUDIO_START = 1.815,
  // the crack: the first loud, broadband burst in the meme, starting at 1.82 s (silence before it)
  PIZZA_SPEED = 1;
let pizzaGo = false,
  pizzaLive = false;
function pizzaCancel() {
  if (pizzaLive) {
    pizzaLive = false;
    swishStopAll();
  }
}
function pizzaStart() {
  pizzaGo = true;
  play("Pizza");
  // the normal path (menus, golem, ground...), then once-through
  pizzaGo = false;
  const a = actions.Pizza;
  if (a) {
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = PIZZA_SPEED;
  }
  try {
    sfx = sfx || new (window.AudioContext || window.webkitAudioContext)();
    sfx.resume();
  } catch (e) {}
  const go = () => {
    const st = SFX_SETS["pizza-sfx-data"];
    if (!st || !st.bufs || !sfx) return;
    const src = sfx.createBufferSource(),
      g = sfx.createGain();
    src.buffer = cz(st.bufs[0]);
    g.gain.value = 1;
    src.connect(g);
    g.connect(sfx.destination);
    src.start(sfx.currentTime, PIZZA_AUDIO_START);
    pizzaLive = true;
    swishLive.push(src);
    src.onended = () => {
      const k = swishLive.indexOf(src);
      if (k >= 0) swishLive.splice(k, 1);
    };
  };
  const st = SFX_SETS["pizza-sfx-data"];
  if (st && st.bufs) go();
  else Promise.resolve(loadSfxSet("pizza-sfx-data")).then(go);
}
function play(n) {
  if (invDrink.on && !invDrink.internal && n !== "UALX_ConsumeM") {
    invDrink.next = n;
    return;
  // the inventory's potion inspection finishes first; whatever was asked for plays after it
  }
  if (n === "Pizza" && !pizzaGo) {
    pizzaStart();
    return;
  }
  if (n !== "Pizza") pizzaCancel();
  if (n === "GolemAttack") {
    playGolem();
    return;
  }
  if (golemOn) golemShow(false);
  if (n === "Flaunt" && weapon === "axe" && actions.AxeFlaunt)
    // the axe has its own flaunt (heavy weapons class)
    n = "AxeFlaunt";
  if (animSet === "ideal" && n === "Swing") idealPickSwing();
  if (!actions[n]) return;
  if (
    (n === "AxeIdle" ||
      n === "AxeSwing" ||
      n === "AxeFlaunt" ||
      n === FLAUNT_IDLE) &&
    weapon !== "axe"
  )
    // these are the axe's own clips, so choosing one brings the axe out
    setWeapon("axe");
  else if ((n === "Idle" || n === "Swing") && weapon === "axe")
    // and these are the sword's, so choosing one puts the sword back (the game itself always asks for idleName())
    setWeapon("sword");
  const isFlaunt = n === "Flaunt" || n === "AxeFlaunt" || n === FLAUNT_IDLE;
  if (isFlaunt !== flauntWant) {
    flauntWant = isFlaunt;
    syncAudio();
  // either flaunt brings in the flaunt song
  }
  {
    const isD = !!DANCE_SETS[n],
      k = isD ? DANCE_SETS[n].key : danceKey;
    if (isD !== danceWant || k !== danceKey) {
      danceWant = isD;
      danceKey = k;
      syncAudio();
    }
  // the Dance animation brings in its own song
  }
  if (n === EVT_CLIP) return;
  swishStopAll();
  evtDue = evtGo = evtDone = flauntDone = false;
  const next = actions[n],
    // fd: the hand-off from AxeFlaunt into its idle is eased a little longer
    fd = n === FLAUNT_IDLE ? 0.3 : 0.12;
  if (evtPlaying) {
    actions[EVT_CLIP].fadeOut(0.12);
    evtPlaying = false;
  }
  if (current && current !== next) {
    current.fadeOut(fd);
  }
  if (
    n === "Death" ||
    n === "AxeFlaunt" ||
    n === "Drinking_Potion" ||
    (n === "Chestopen" && chestScene)
  ) {
    next.reset().setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    next.fadeIn(0.12).play();
  // plays once and holds its last pose (AxeFlaunt ends with the axe raised, so it must not loop)
  }
  else next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(fd).play();
  current = next;
  syncRockMeshes();
  if (n === SEAT_CLIP) schedEvt();
  document
    .querySelectorAll("#anims .item")
    .forEach((b) =>
      b.setAttribute("aria-checked", b.dataset.n === (AXE_BASE[n] || n)),
    );
  if (ANIM_SFX[n]) ANIM_SFX[n]();
}
function schedEvt() {
  evtClock = 0;
  evtNext = 5 + Math.random() * 6;
  evtDue = false;
// next look-around in 5-11 s of seated time
}
/* The look-around starts on a Pose2 loop boundary and ends on Pose2's first pose (see closeLoop), so both hand-offs are seamless cuts. */
function startEvt() {
  const ev = actions[EVT_CLIP];
  if (!ev || !current) return;
  evtDue = false;
  evtPlaying = true;
  /* start the new action BEFORE stopping the old one: stopping the last action on a bone resets it to the bind pose (the T-pose flash) */
  ev.reset().setLoop(THREE.LoopOnce, 1);
  ev.clampWhenFinished = true;
  ev.play();
  current.stop();
  mixer.update(0);
  stickAxe();
}
function endEvt() {
  if (!evtPlaying) return;
  evtPlaying = false;
  if (current) current.reset().setLoop(THREE.LoopRepeat, Infinity).play();
  actions[EVT_CLIP].stop();
  mixer.update(0);
  stickAxe();
  schedEvt();
}
/* The exported Pose2 clips stop on a different pose than they start on (and some channels stop keying early), so every loop
 wrapped with a visible pop. Add a closing key back at the first pose so the loop, and the hand-off to/from the event, is continuous. */
/* Re-aim the left knee: keeps the clip's own little bob, just shifts the whole angle so the first key is deg (x-axis rotation only). */
function setLeftShin(clip, deg) {
  const tr = clip.tracks.find((t) => t.name === "Left_Shin.quaternion");
  if (!tr) return;
  const v = Array.from(tr.values),
    n = tr.times.length,
    a0 = 2 * Math.atan2(v[0], v[3]),
    d = (deg * Math.PI) / 180 - a0;
  for (let k = 0; k < n; k++) {
    const a = 2 * Math.atan2(v[4 * k], v[4 * k + 3]) + d;
    v[4 * k] = Math.sin(a / 2);
    v[4 * k + 1] = 0;
    v[4 * k + 2] = 0;
    v[4 * k + 3] = Math.cos(a / 2);
  }
  clip.tracks[clip.tracks.indexOf(tr)] = new tr.constructor(
    tr.name,
    Array.from(tr.times),
    v,
    tr.getInterpolation(),
  );
}
function closeLoop(clip, end) {
  clip.tracks = clip.tracks.map((tr) => {
    const n = tr.times.length,
      vs = tr.getValueSize(),
      last = tr.times[n - 1];
    const first = Array.from(tr.values.slice(0, vs)),
      vals = Array.from(tr.values),
      times = Array.from(tr.times);
    if (last < end - 1e-4) {
      times.push(end);
      first.forEach((v) => vals.push(v));
    } else {
      for (let k = 0; k < vs; k++) vals[(n - 1) * vs + k] = first[k];
    }
    return new tr.constructor(tr.name, times, vals, tr.getInterpolation());
  });
  clip.resetDuration();
}
/* which ANIMATIONS sub-menu a clip belongs to: ENEMIES (the golem's), SHOPKEEPER (the Shop* clips), SELF (everything else - the knight's own) */
/* ANIM SET (options): UNIVERSAL plays the retargeted Universal Animation Library clips in place of some of the knight's own. The game keeps asking for Idle / Walk / Swing ... by name, so the swap
 just points those names at the UAL action: every loop mode, finish event and sound cue keeps working. One-shots are stretched to the length of the clip they replace, because the game's timing counts on it. */
const UAL_ALT = {
  Idle: "UAL_Idle_Shield_Loop",
  AxeIdle: "UAL_Idle_Shield_Loop",
  Walk: "UAL_Walk_Loop",
  Swing: "UAL_Sword_Regular_A",
  AxeSwing: "UAL_Sword_Regular_C",
  Hit: "UAL_Hit_Stagger",
  Block: "UAL_Sword_Block",
  Drinking_Potion: "UAL_Consume",
};
const ualOrig = {},
  ualAl = {};
/* The game finds its clips by NAME (the swing's sword trail, the sounds that repeat every loop, the footsteps ...). So the UAL clip that replaces Swing is a copy that is itself called 'Swing' (Idle, Walk, Hit ... likewise): everything keyed on those names keeps working. */
function ualAlias(k, sn) {
  const key = k + "|" + sn;
  if (!ualAl[key]) {
    const c = actions[sn].getClip().clone();
    c.name = k;
    c.ualSrc = sn;
    ualAl[key] = mixer.clipAction(c);
  }
  return ualAl[key];
}
/* ANIM SET: IDEAL (the default) = the UAL Idle and Hit, plus a different random UAL Sword_Regular_A / B / C for every swing; everything else is the knight's own. KNIGHT = all the knight's own.
 UNIVERSAL = every clip in UAL_ALT from the UAL library. While IDEAL is on, the UAL_ clips are hidden from the ANIMATIONS menus (HeavyCombo is not one of them, so it stays). */
let animSet = "ideal";
const IDEAL_ALT = { Idle: 1, AxeIdle: 1, Hit: 1 },
  IDEAL_SWINGS = ["UAL_Sword_Regular_A", "UAL_Sword_Regular_B"];
// (Sword_Regular_C is left out: it looked buggy)
let idealSwingLast = -1;
const animVisible = (n) => !(animSet === "ideal" && /^UAL_/.test(n));
function idealPickSwing() {
  // called every time a Swing starts: a different one of the three each time
  const o = ualOrig.Swing;
  if (!o) return;
  let i;
  do {
    i = (Math.random() * IDEAL_SWINGS.length) | 0;
  // (with only two swings left they are picked purely at random)
  } while (i === idealSwingLast && IDEAL_SWINGS.length > 2);
  idealSwingLast = i;
  const alt = ualAlias("Swing", IDEAL_SWINGS[i]);
  alt.setEffectiveTimeScale(1);
  alt.setDuration(o.getClip().duration);
  // stretched to the knight's swing length, as in UNIVERSAL
  actions.Swing = alt;
}
function ualApply() {
  const U = animSet === "universal",
    I = animSet === "ideal";
  Object.keys(UAL_ALT).forEach((k) => {
    const sn =
        k === "Block" && weapon === "axe" ? "UALX_Sword_Block" : UAL_ALT[k],
      alt = actions[sn] && ualAlias(k, sn);
    if (!ualOrig[k] && actions[k] && !actions[k].getClip().ualSrc)
      // (Block with the axe: the game turns the model round again for it, so that one uses the clip in its original hand)
      ualOrig[k] = actions[k];
    const o = ualOrig[k];
    if (!o || !alt) return;
    alt.setEffectiveTimeScale(1);
    if (U || (I && IDEAL_ALT[k])) {
      actions[k] = alt;
      if (!/Idle|Walk|Hit/.test(k)) alt.setDuration(o.getClip().duration);
    // Hit plays at its own speed: squeezed into the knight's 0.26 s it looked wrong
    } else actions[k] = o;
  });
  if (I) idealPickSwing();
}
function toggleUal() {
  let base = null;
  Object.keys(UAL_ALT).forEach((k) => {
    if (
      current &&
      (current === actions[k] ||
        current === ualOrig[k] ||
        current === actions[UAL_ALT[k]] ||
        (current === actions.UALX_Sword_Block && k === "Block"))
    )
      base = k;
  });
  animSet =
    animSet === "ideal"
      ? "knight"
      : animSet === "knight"
        ? "universal"
        : "ideal";
  ualApply();
  if (base) play(base);
}
function animGroup(n) {
  return /^Shop/.test(n) ? "shop" : "self";
}
function buildMenu() {
  const box = document.getElementById("anims");
  menuNames.forEach((n, i) => {
    const b = document.createElement("button");
    b.className = "item";
    b.dataset.n = n;
    b.setAttribute("role", "radio");
    b.textContent = n;
    b.addEventListener("click", () => menuPlay(n));
    box.appendChild(b);
  });
}
