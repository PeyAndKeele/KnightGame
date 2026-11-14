// Chest, cookie saving, chest loot cards.
// (Part 5 of 14. All parts share one scope; see README.)

/* ---------- Chestopen: the chest ----------
 The chest (chest.gltf, embedded as a binary glb in CHEST_GLB) stands in front of him while the Chestopen clip plays and is hidden the rest of the time.
 Its own lid animation is driven by the knight's clip time, so the lid lifts exactly when his hands do.
 CHEST_SCALE: the chest is 1 unit wide in the model, so it is scaled up to meet his hands (1.7 puts the lid's front edge where his fists grip it).
 CHEST_POS: [side, up, forward] in the knight's own space - forward is how far in front of him the chest centre stands (its front face has to clear his toes, which reach about 0.72).
 CHEST_YAW_DEG: 90 turns the chest's front (its clasp) toward him; its hinge is then at the far side.
 While the clip plays the sword / hatchet / hammer are put away, and the axe hangs on his back (see AXE_STOW_CLIPS). */
const CHEST_SCALE = 1.7,
  CHEST_POS = [0, 0.09, 1.6],
  CHEST_YAW_DEG = 90;
/* ---------- the chest after a dungeon is won ----------
 After the victory flaunt the screen fades out; he reappears on the far (west) side of the dungeon, straight opposite the gate he walked in through - in the ruins past the spike fence (the clear lane
 the forest leaves for exactly this), in the tomb at the west end of the hall - facing west with the chest 1.6 in front of him (see CHEST_POS: it is parented to him). The chest pops in, Chestopen plays once,
 and when it has ended the screen fades to black and he is back at the menu (leaveDungeon).
 Where he stands (chestX) and the camera shot (chestShot) belong to each dungeon: see DUNGEONS in 09-dungeon-battle.js.
 CHEST_LOOK_FWD: how far in front of him the camera looks (knight-heights). CHEST_END_HOLD: seconds the last pose is held before the fade.
 CHEST_POP_DELAY / CHEST_POP_TIME: the chest appears this long after the screen is back, then grows in over this long. */
const CHEST_LOOK_FWD = 0.4,
  CHEST_END_HOLD = 0.25,
  CHEST_POP_DELAY = 0.3,
  CHEST_POP_TIME = 0.45;
let chestScene = false,
  chestDone = false,
  chestEndT = -1,
  chestT0 = 0;
/* The lid's creak (drs_barrelsecret_open, embedded as an mp3 in CHEST_SFX): it plays when the lid starts to lift, CHEST_SFX_AT seconds into Chestopen (the lid clip starts moving at 2.58 s),
 once per run of the clip (in the menu loop, once per loop). It follows the sound-effects switch. */
const CHEST_SFX_AT = 2.58,
  CHEST_SFX_GAIN = 0.9;
let chestSfxBuf = null,
  chestSfxLoading = null,
  chestPrevT = 0;
function loadChestSfx() {
  if (chestSfxBuf || chestSfxLoading || !sfx) return chestSfxLoading;
  try {
    const t = atob(CHEST_SFX),
      u = new Uint8Array(t.length);
    for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
    chestSfxLoading = sfx
      .decodeAudioData(u.buffer)
      .then((b) => {
        chestSfxBuf = b;
      })
      .catch((e) => {
        chestSfxLoading = null;
        console.error("chest sfx failed", e);
      });
  } catch (e) {
    console.error(e);
  }
  return chestSfxLoading;
}
function playChestSfx() {
  try {
    if (!sfx) return;
    if (!chestSfxBuf) {
      const l = loadChestSfx();
      if (l)
        l.then(() => {
          if (chestSfxBuf && chestOn) playChestSfx();
        });
      return;
    }
    sfx.resume();
    const src = sfx.createBufferSource(),
      g = sfx.createGain();
    src.buffer = cz(chestSfxBuf);
    g.gain.value = CHEST_SFX_GAIN;
    src.connect(g);
    g.connect(sfx.destination);
    src.start(sfx.currentTime);
  } catch (e) {
    console.error("chest sfx", e);
  }
}
function chestReady() {
  return !!(chestGrp && actions.Chestopen);
}
/* ---------- saving to a cookie ----------
 GameSave.get(key,default) / GameSave.set(key,value) keep any small JSON-able game data in one cookie ("kg_save", one year, this site only). The options (pixels, colors, bitcrush, weapon,
 helmet, world, music, armor/sword tint) are saved automatically a second after they change and put back when the game has loaded. Limits: a cookie holds about 4 KB in total, so keep to small things
 (flags, numbers, ids); and browsers do not keep cookies for a page opened straight from disk (file://), only when it is served over http(s), such as GitHub Pages or a local server. */
const GameSave = (function () {
  const NAME = "kg_save";
  let data = {};
  const ok = () => {
    try {
      return navigator.cookieEnabled;
    } catch (e) {
      return false;
    }
  };
  function read() {
    try {
      const m = document.cookie
        .split("; ")
        .find((c) => c.indexOf(NAME + "=") === 0);
      data = m
        ? JSON.parse(decodeURIComponent(m.slice(NAME.length + 1))) || {}
        : {};
    } catch (e) {
      data = {};
    }
  }
  function write() {
    if (!ok()) return;
    try {
      const v = encodeURIComponent(JSON.stringify(data));
      if (v.length > 3800) {
        console.warn("GameSave: too big for a cookie");
        return;
      }
      document.cookie =
        NAME + "=" + v + "; max-age=31536000; path=/; SameSite=Lax";
    } catch (e) {}
  }
  read();
  return {
    get: (k, d) => (k in data ? data[k] : d),
    set: (k, v) => {
      data[k] = v;
      write();
    },
    all: () => data,
    clear: () => {
      data = {};
      write();
    },
  };
})();
function settingsSnapshot() {
  return {
    px: pixIdx,
    co: colIdx,
    cr: crushOn,
    wp: weapon,
    hm: curHelmet,
    wd: forest,
    mu: musicOn,
    at: armorHex,
    am: armorAmt,
    sh: swordHex,
    sm: swordMatch,
  };
}
let lastSettings = "",
  restoredSettings = false;
function restoreSettings() {
  const v = GameSave.get("s", null);
  restoredSettings = true;
  if (!v) return;
  try {
    if (typeof v.px === "number" && v.px < PIX_STEPS.length) pixIdx = v.px;
    if (typeof v.co === "number" && v.co < COL_STEPS.length) {
      colIdx = v.co;
      U.uLevels.value = COL_STEPS[colIdx][1];
    }
    resize();
    if (typeof v.cr === "boolean" && v.cr !== crushOn) toggleCrush();
    if (v.mu === false) {
      userChose = true;
      musicOn = false;
      try {
        setSwitch("music", false, "Off");
      } catch (e) {}
    }
    if (typeof v.at === "string" || v.at === null) {
      armorHex = v.at;
      if (typeof v.am === "number") armorAmt = v.am;
    }
    if (typeof v.sh === "string" || v.sh === null) swordHex = v.sh;
    if (typeof v.sm === "boolean") swordMatch = v.sm;
    applyArmorTint();
    if (typeof v.hm === "number" && v.hm >= 0 && v.hm < helmetSets.length)
      setHelmet(v.hm);
    if (typeof v.wp === "string" && v.wp !== weapon) setWeapon(v.wp);
    if (typeof v.wd === "boolean" && v.wd !== forest) setWorld(v.wd);
  } catch (e) {
    console.error("restore settings failed", e);
  }
  lastSettings = JSON.stringify(settingsSnapshot());
}
setInterval(() => {
  try {
    if (!restoredSettings) {
      if (
        knightScene &&
        actions.Idle &&
        helmetSets.length &&
        typeof setSwitch === "function"
      )
        restoreSettings();
      return;
    // wait until the game has loaded, then put the saved options back
    }
    const j = JSON.stringify(settingsSnapshot());
    if (j !== lastSettings) {
      lastSettings = j;
      GameSave.set("s", JSON.parse(j));
    }
  } catch (e) {}
}, 1000);

/* ---------- chest loot: three cards ----------
 After the chest opens, three cards rise up, one each of COMMON, UNCOMMON and RARE (shuffled left to right). Pick one (click it, or arrows/A/D + Enter, or 1/2/3) and the screen fades back to the menu.
 Nothing is stored yet: the pick is just remembered in loot.chosen. RARITY = the tier colours (all six; only the first three have items so far). LOOT = every item that can drop:
 add one with a rarity key and it joins its tier's draw. LOOT_TIERS = which tiers the three cards come from. icon is a placeholder letter until the models exist. */
const RARITY = {
  common: { name: "COMMON", alt: "STANDARD", color: "#E0E0E0" },
  uncommon: { name: "UNCOMMON", alt: "FINE", color: "#2ECC71" },
  rare: { name: "RARE", alt: "SUPERIOR", color: "#3498DB" },
  epic: { name: "EPIC", alt: "HEROIC", color: "#9B59B6" },
  legendary: { name: "LEGENDARY", alt: "MASTERWORK", color: "#F39C12" },
  mythic: { name: "MYTHIC", alt: "ARTIFACT", color: "#E74C3C" },
  // a tier of its own: no card is drawn from it yet (it is not in LOOT_TIERS)
  knightly: { name: "KNIGHTLY", alt: "HONORED", color: "#FFD966" },
};
const LOOT = [
  {
    id: "scrap",
    name: "SCRAP",
    rarity: "common",
    icon: "S",
    blurb: "Bent metal. Somebody might want it.",
  },
  {
    id: "rock",
    name: "ROCK",
    rarity: "common",
    icon: "R",
    blurb: "A rock. It is a good rock.",
  },
  {
    id: "nail",
    name: "BENT NAIL",
    rarity: "common",
    icon: "N",
    blurb: "Seen better days.",
  },
  {
    id: "hatchet",
    name: "HATCHET",
    rarity: "uncommon",
    icon: "H",
    blurb: "Light, quick, easy to carry.",
  },
  {
    id: "axe",
    name: "AXE",
    rarity: "uncommon",
    icon: "A",
    blurb: "Two hands and a long swing.",
  },
  {
    id: "hammer",
    name: "HAMMER",
    rarity: "rare",
    icon: "M",
    blurb: "Heavy. Makes a point.",
  },
  {
    id: "shovel",
    name: "SHOVEL",
    rarity: "rare",
    icon: "V",
    blurb: "For digging. Or for hitting.",
  },
  {
    id: "morningstar",
    name: "MORNINGSTAR",
    rarity: "rare",
    icon: "G",
    blurb: "A ball on a stick. The ball has opinions.",
  },
  {
    id: "knightly_sword",
    name: "KNIGHTLY SWORD",
    rarity: "knightly",
    icon: "K",
    blurb: "Gems that never go dark.",
  },
];
const LOOT_TIERS = ["common", "uncommon", "rare"];
const loot = {
  on: false,
  picked: false,
  sel: 1,
  cards: [],
  el: null,
  chosen: null,
};
function showLoot() {
  if (loot.on) return;
  if (!document.getElementById("loot-css")) {
    const st = document.createElement("style");
    st.id = "loot-css";
    st.textContent =
      "#loot{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4vh;background:rgba(0,0,0,.62);font-family:inherit;color:#fff;text-shadow:2px 2px 0 #000;animation:lootbg .5s steps(5,end) both;image-rendering:pixelated;-webkit-font-smoothing:none;text-rendering:optimizeSpeed}" +
      "@keyframes lootbg{from{opacity:0}to{opacity:1}}@keyframes lootup{from{opacity:0;transform:translateY(60px)}to{opacity:1;transform:none}}" +
      "#loot .lh{font-size:clamp(28px,4.2vw,56px);letter-spacing:.18em}#loot .lr{display:flex;gap:clamp(12px,2.4vw,36px);align-items:stretch}" +
      "#loot .card{--c:#fff;width:clamp(150px,19vw,260px);padding:16px 14px 18px;background:#1b1b21;border:4px solid var(--c);border-radius:0;color:#fff;font:inherit;text-align:center;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:10px;box-shadow:0 0 0 2px #000,0 0 0 6px color-mix(in srgb,var(--c) 55%,transparent),0 0 0 12px color-mix(in srgb,var(--c) 28%,transparent),0 0 0 18px color-mix(in srgb,var(--c) 12%,transparent);opacity:0;animation:lootup .55s steps(6,end) both;transition:transform .15s steps(3),box-shadow .15s steps(3),opacity .35s steps(4)}" +
      "#loot .card.on,#loot .card:hover{transform:translateY(-12px);box-shadow:0 0 0 2px #000,0 0 0 8px color-mix(in srgb,var(--c) 55%,transparent),0 0 0 16px color-mix(in srgb,var(--c) 28%,transparent),0 0 0 24px color-mix(in srgb,var(--c) 12%,transparent)}" +
      "#loot .rar{font-size:clamp(16px,1.7vw,24px);letter-spacing:.2em;color:var(--c)}#loot .rar small{display:block;font-size:.62em;opacity:.7;letter-spacing:.3em}" +
      "#loot .ico{width:100%;aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px dashed var(--c);background:rgba(255,255,255,.04);color:var(--c);font-size:clamp(56px,7vw,110px);line-height:1}" +
      "#loot .ico small{font-size:clamp(10px,1vw,14px);letter-spacing:.2em;opacity:.65;margin-top:6px}" +
      "#loot .nm{font-size:clamp(22px,2.4vw,34px);letter-spacing:.1em}#loot .bl{font-size:clamp(13px,1.3vw,19px);opacity:.78;line-height:1.15}" +
      "#loot .hint{font-size:clamp(14px,1.5vw,22px);opacity:.7;letter-spacing:.2em}" +
      "#loot.done .card:not(.pick){opacity:0;transform:translateY(8px)}#loot.done .card.pick{transform:translateY(-16px);box-shadow:0 0 0 2px #000,0 0 0 12px color-mix(in srgb,var(--c) 55%,transparent),0 0 0 24px color-mix(in srgb,var(--c) 28%,transparent),0 0 0 36px color-mix(in srgb,var(--c) 12%,transparent)}#crt{z-index:100000}"; /* #crt (scanlines + vignette) goes over the loot screen too */
    document.head.appendChild(st);
  }
  const picks = LOOT_TIERS.map((t) => {
    const pool = LOOT.filter((i) => i.rarity === t);
    return pool[Math.floor(Math.random() * pool.length)];
  }).filter(Boolean);
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  const el = document.createElement("div");
  el.id = "loot";
  el.innerHTML =
    '<div class="lh">CHOOSE YOUR REWARD</div><div class="lr"></div><div class="hint">CLICK A CARD, OR  &lt; &gt;  AND ENTER</div>';
  const row = el.querySelector(".lr");
  loot.cards = [];
  picks.forEach((it, i) => {
    const r = RARITY[it.rarity],
      b = document.createElement("button");
    b.className = "card";
    b.style.setProperty("--c", r.color);
    b.style.animationDelay = 0.25 + i * 0.18 + "s";
    b.innerHTML =
      '<div class="rar">' +
      r.name +
      "<small>" +
      r.alt +
      '</small></div><div class="ico">' +
      it.icon +
      '<small>MODEL TBD</small></div><div class="nm">' +
      it.name +
      '</div><div class="bl">' +
      it.blurb +
      "</div>";
    b.onmouseenter = () => lootSel(i);
    b.onclick = () => lootPick(i);
    row.appendChild(b);
    loot.cards.push({ it, b });
  });
  document.body.appendChild(el);
  loot.el = el;
  loot.on = true;
  loot.picked = false;
  loot.chosen = null;
  lootSel(1);
}
function lootSel(i) {
  if (loot.picked) return;
  if (i !== loot.sel && loot.on) {
    try {
      blip(520, 0.05);
    } catch (_) {}
  }
  loot.sel = i;
  loot.cards.forEach((c, k) => c.b.classList.toggle("on", k === i));
}
function lootPick(i) {
  if (!loot.on || loot.picked || !loot.cards[i]) return;
  loot.picked = true;
  loot.chosen = loot.cards[i].it;
  GameSave.set("lastLoot", loot.chosen.id);
  try {
    blip(880, 0.12);
  } catch (_) {}
  loot.cards[i].b.classList.add("pick");
  loot.el.classList.add("done");
  setTimeout(() => {
    hideLoot();
    leaveDungeon();
  }, 1200);
}
function hideLoot() {
  if (loot.el && loot.el.parentNode) loot.el.parentNode.removeChild(loot.el);
  loot.el = null;
  loot.on = false;
  loot.cards = [];
}
addEventListener(
  "keydown",
  (e) => {
    if (!loot.on) return;
    const k = e.key,
      n = loot.cards.length;
    let used = true;
    if (loot.picked) {
    } else if (k === "ArrowLeft" || k === "a" || k === "A")
      lootSel((loot.sel + n - 1) % n);
    else if (k === "ArrowRight" || k === "d" || k === "D")
      lootSel((loot.sel + 1) % n);
    else if (k === "Enter" || k === " ") lootPick(loot.sel);
    else if (k >= "1" && k <= "3" && +k <= n) {
      lootSel(+k - 1);
      lootPick(+k - 1);
    } else used = false;
    if (used) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true,
);

function startChestScene() {
  if (dgBusy) return;
  dgBusy = true;
  fadeThen(() => {
    // everything below happens while the screen is black
    dgBusy = false;
    const H = playerH;
    chestScene = true;
    chestDone = false;
    chestEndT = -1;
    loot.picked = false;
    dgState = "chest";
    moving = false;
    swooshHide();
    clearEnemies();
    if (dg.slots) dg.slots.visible = false;
    setTurnLabel("");
    playerRig.position.set(-dg.chestX * H, 0, 0);
    heading = -Math.PI / 2;
    // facing west, toward the chest
    playerRig.rotation.y = heading;
    play("Chestopen");
    dgStart(dg.chestShot, false);
    dgDur = 1e9;
    // camera and shadow are in place before the screen fades back in
    dungeonStep(0);
  });
}
let chestGrp = null,
  chestMixer = null,
  chestAct = null,
  chestOn = false;
// chestShineMats: the chest's metal, switched with the Shiny metal option like the armor
const chestShineMats = [];
function initChest(rig) {
  try {
    const t = atob(CHEST_GLB),
      u = new Uint8Array(t.length);
    // a binary glb: a data: url buffer gets blocked
    for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i);
    new THREE.GLTFLoader().parse(
      u.buffer,
      "",
      (g) => {
        const cache = new Map();
        /* Parts the model labels 'apply ushine' (the bands, studs, hinge pins and clasp) get the armor's metal shine; the wood stays matte. A material shared with an unlabelled part is split in two. */
        const isMetal = (o) => {
          for (let p = o; p; p = p.parent)
            if (p.userData && p.userData.name === "apply ushine") return true;
          return false;
        };
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          const om = o.material,
            metal = isMetal(o),
            key = om.uuid + (metal ? "m" : "");
          if (!cache.has(key)) {
            const nm = ps1Mat(om.map, 1);
            if (metal) {
              shineMat(nm);
              chestShineMats.push(nm);
            }
            cache.set(key, nm);
          }
          o.material = cache.get(key);
        });
        const grp = new THREE.Group();
        grp.name = "Chest";
        grp.add(g.scene);
        grp.scale.setScalar(CHEST_SCALE);
        grp.position.set(CHEST_POS[0], CHEST_POS[1], CHEST_POS[2]);
        grp.rotation.y = (CHEST_YAW_DEG * Math.PI) / 180;
        grp.visible = false;
        const blob = new THREE.Mesh(
          new THREE.CircleGeometry(0.78, 16),
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
        blob.position.y = -0.045;
        // a soft shadow on the ground, like the knight's
        grp.add(blob);
        rig.add(grp);
        chestGrp = grp;
        if (g.animations[0]) {
          chestMixer = new THREE.AnimationMixer(g.scene);
          chestAct = chestMixer.clipAction(g.animations[0]);
          chestAct.setLoop(THREE.LoopOnce, 1);
          chestAct.clampWhenFinished = true;
          chestAct.play();
        }
      },
      (e) => console.error("chest load failed", e),
    );
  } catch (e) {
    console.error("chest", e);
  }
}
function chestStep() {
  // called right after every mixer update
  const on = !!(
    chestGrp &&
    current &&
    current.getClip().name === "Chestopen"
  );
  if (chestGrp) chestGrp.visible = on;
  if (on && !chestOn) {
    chestT0 = performance.now();
    chestPrevT = 0;
    loadChestSfx();
  }
  if (on) {
    {
      const t = (performance.now() - chestT0) / 1000 - CHEST_POP_DELAY,
        x = Math.min(1, Math.max(0, t / CHEST_POP_TIME)),
        c1 = 1.70158,
        // easeOutBack: grows past full size and settles
        k = x - 1;
      chestGrp.scale.setScalar(
        CHEST_SCALE * Math.max(0.0001, 1 + (c1 + 1) * k * k * k + c1 * k * k),
      );
    }
    if (swordGrp) swordGrp.visible = false;
    if (hatchetGrp) hatchetGrp.visible = false;
    if (hammerGrp) hammerGrp.visible = false;
    if (knightlyGrp) knightlyGrp.visible = false;
    if (morningstarGrp) morningstarGrp.visible = false;
    if (current.time >= CHEST_SFX_AT && chestPrevT < CHEST_SFX_AT)
      // the lid starts to lift
      playChestSfx();
    chestPrevT = current.time;
    if (chestAct) {
      chestAct.reset();
      chestAct.time = current.time;
      chestMixer.update(0);
    // lid follows the knight's clock (reset first: the lid clip holds its last pose once it has finished)
    }
  } else if (chestOn) showWeapons();
  chestOn = on;
}
const CHEST_DATA = JSON.parse(
  document.getElementById("chest-data").textContent,
// chest-data.json: the Chestopen clip, the lid's creak (mp3, base64) and the chest model (glb, base64)
);
const CHESTOPEN_CLIP = CHEST_DATA.clip,
  CHEST_SFX = CHEST_DATA.sfx,
  CHEST_GLB = CHEST_DATA.glb;
function stickAxe() {
  // called right after every mixer update
  syncBlockFlip();
  potionStep();
  chestStep();
  if (!axeOff || !axeGrp || !axeGrp.visible || !current) return;
  try {
    axePose(current.getClip().name);
  } catch (e) {
    if (!stickAxe.warned) {
      stickAxe.warned = true;
      console.error("stickAxe", e);
    }
  }
}
function swingName() {
  return weapon === "axe" && actions.AxeSwing ? "AxeSwing" : "Swing";
// the swing that goes with the weapon in his hand
}
function swingScaleReset() {
  if (actions.Swing) actions.Swing.timeScale = 1;
  if (actions.AxeSwing) actions.AxeSwing.timeScale = 1;
}
function idleName() {
  return weapon === "axe" && actions.AxeIdle ? "AxeIdle" : "Idle";
// the idle that goes with the weapon in his hand
}
function resolveAnim(n) {
  const v = AXE_VARIANT[n];
  return weapon === "axe" && v && actions[v] ? v : n;
// the clip a menu entry plays right now (Idle/Swing/Flaunt -> the axe's version while the axe is out)
}
function menuPlay(n) {
  play(resolveAnim(n));
}
function refreshAnim() {
  // after the weapon changes: if Idle / Swing / Flaunt is playing, switch to the version that matches the new weapon
  const c = current && current.getClip().name,
    b = AXE_BASE[c] || c;
  if (!AXE_VARIANT[b]) return;
  const want = resolveAnim(b);
  if (c === FLAUNT_IDLE && want === "AxeFlaunt") return;
  if (want !== c) play(want);
}
function setWeapon(w) {
  weapon = w;
  showWeapons();
  applyHandedness();
  try {
    ualApply();
  // ANIM SET: the axe's Block uses a different clip from the sword's
  } catch (e) {}
  swooshHide();
  setSwitch("sword", true, w === "axe" ? "Axe" : "Sword");
}
function toggleWeapon() {
  // no heavy weapon owned yet
  if (weapon !== "axe" && !(owns("axe") || owns("shovel"))) return;
  setWeapon(weapon === "axe" ? "sword" : "axe");
  refreshAnim();
}
