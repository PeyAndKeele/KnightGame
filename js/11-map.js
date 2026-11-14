// The MAP screen.
// (Part 11 of 14. All parts share one scope; see README.)

/* ---------- MAP (main menu > MAP) ----------
 Skyrim-style. The camera climbs straight up out of the clearing while tilting up at the sky, then pans down onto the knight and pulls back until the whole
 clearing is a map seen from straight above (north up), with one ping on each dungeon. mapS runs 0 -> 3 over those three moves (0 = the menu camera, 3 = the map);
 closing just runs it backwards, so it works from any moment. The camera is placed by hand here (position + yaw/pitch) and the orbit variables are left alone,
 so the menu camera comes back exactly as it was. On the way the fog opens up (from that high it would swallow the ground) and the floor grows 3x so the map has no
 edge. The pings are DOM elements pinned to spots on the ground. MOSSY RUINS goes through enterDungeon(); the other two are locked for now. */
const MAP_DUR = [1.0, 1.3, 1.7],
  // seconds for the climb, the pan down and the pull back; the way back is this much faster
  MAP_BACK = 1.6;
const MAP_TILT = 0.95,
  MAP_TOP = 10,
  // how far the camera looks up at the sky (radians), its height at the top of the climb, and its height when it looks straight down at him (knight-heights)
  MAP_LOW = 4.5;
// the glide between The Greenfield and The Veiled Frost: seconds (a critically damped spring, so it eases off and on)
const MAP_AREA_TIME = 0.55;
// half the width / height of the ground the finished map has to show (knight-heights) - zoomed out for breathing room
const MAP_FIT = [13.8, 10.2];
const MAP_AREAS = {
  greenfield: {
    title: "THE GREENFIELD",
    zOff: 0,
    spots: [
      {
        n: "MOSSY RUINS",
        area: "greenfield",
        idx: 0,
        x: -9.4,
        z: -2.8,
        col: "#7fe06a",
        ready: () => !!ruinsGroup,
        run: () => enterDungeon(),
      },
      {
        n: "FLOODED CRYPT",
        area: "greenfield",
        idx: 1,
        x: 7.8,
        z: -6.2,
        col: "#5ec8ff",
        lock: 1,
      },
      {
        n: "BURNING KEEP",
        area: "greenfield",
        idx: 2,
        x: 9.0,
        z: 4.8,
        col: "#ff8a4a",
        lock: 1,
      },
      {
        n: "SHOP",
        area: "greenfield",
        idx: 3,
        x: -3.0,
        z: 4.0,
        col: "#ffd45e",
        ready: () => !!shopGroup,
        run: () => enterShop(),
      },
    ],
  },
  frost: {
    title: "THE VEILED FROST",
    zOff: -FROST_DIST,
    spots: [
      {
        n: "THE ICE FLATS",
        area: "frost",
        idx: 0,
        x: -9.4,
        z: -2.8 - FROST_DIST,
        col: "#a8e6ff",
        lock: 1,
      },
      {
        n: "CONSECRATED GRAVEYARD",
        area: "frost",
        idx: 1,
        x: 7.8,
        z: -6.2 - FROST_DIST,
        col: "#c7b8ff",
        lock: 1,
      },
      {
        n: "CHILLED CAVERNS",
        area: "frost",
        idx: 2,
        x: 9.0,
        z: 4.8 - FROST_DIST,
        col: "#6ad2ff",
        lock: 1,
      },
    ],
  },
  ignis: {
    title: "IGNIS MOURNE",
    zOff: -IGNIS_DIST,
    spots: [
      {
        n: "BERTH OF FLAME",
        area: "ignis",
        idx: 0,
        x: -9.4,
        z: -2.8 - IGNIS_DIST,
        col: "#ff8a4a",
        lock: 1,
      },
      {
        n: "SMOLDERING KEEP",
        area: "ignis",
        idx: 1,
        x: 7.8,
        z: -6.2 - IGNIS_DIST,
        col: "#ff4a4a",
        lock: 1,
      },
      {
        n: "WORLD'S EDGE",
        area: "ignis",
        idx: 2,
        x: 0.0,
        z: -12.0 - IGNIS_DIST,
        col: "#ff2a2a",
        lock: 1,
      },
    ],
  },
};
const ALL_MAP_SPOTS = MAP_AREAS.greenfield.spots.concat(
  MAP_AREAS.frost.spots,
  MAP_AREAS.ignis.spots,
);
let MAP_SPOTS = MAP_AREAS.greenfield.spots;
let mapSel = 0,
  mapBig = false,
  mapCam = null,
  mapFog0 = null,
  mapAcc = 0,
  mapPings = [],
  mapEls = null;
const _mp = new THREE.Vector3();
const mapIO = (x) => x * x * (3 - 2 * x),
  mapIOC = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  mapLerp = (a, b, t) => a + (b - a) * t,
  map01 = (x) => Math.max(0, Math.min(1, x));
function mapA3() {
  // how high the finished map is (knight-heights): high enough to show MAP_FIT on this screen, but never past the far plane
  const asp = innerWidth / Math.max(1, innerHeight),
    t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return Math.min(
    170 / playerH,
    Math.max(MAP_FIT[1] / t, MAP_FIT[0] / (asp * t)),
  );
}
/* the camera for map time s (0..3): c = the menu camera when it started {p, yaw, pit, t}, H = knight height, A3 = final height (world units), f0 = the fog it started with.
 Heights, tilt and sideways moves ease in and out of each move, so every move starts and ends at rest. pit is the tilt: + up, - down (-PI/2 = straight down).
 z also follows the glide between The Greenfield and The Veiled Frost (mapAreaK), so the map can slide from one area to the other once it is open. */
function mapPose(s, c, H, A3, f0) {
  const u1 = map01(s),
    u2 = map01(s - 1),
    u3 = map01(s - 2),
    top = Math.max(MAP_TOP * H, c.p.y + H),
    low = MAP_LOW * H;
  const y =
    s < 1
      ? mapLerp(c.p.y, top, mapIO(u1))
      : s < 2
        ? mapLerp(top, low, mapIO(u2))
        : mapLerp(low, A3, mapIOC(u3));
  const k = mapIO(u2),
    dy =
      ((((0 - c.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) %
        (Math.PI * 2)) -
      // the map is north-up: yaw 0, taking the short way round
      Math.PI;
  const pit =
    s < 1
      ? mapLerp(c.pit, MAP_TILT, mapIO(u1))
      : mapLerp(MAP_TILT, -Math.PI / 2, k);
  const f1 = mapIO(map01((s - 1) / 0.6)),
    // fog: first opened to a long haze, then right out once he is looking straight down
    f2 = mapIO(map01((s - 1.6) / 0.6));
  const tz = homeTarget.z - mapAreaK * FROST_DIST * H,
    basePz = tz + (c.p.z - c.t.z);
  return {
    x: mapLerp(c.p.x, c.t.x, k),
    y: y,
    z: mapLerp(basePz, tz, k),
    pit: pit,
    yaw: c.yaw + dy * k,
    fn: mapLerp(mapLerp(f0[0], 10 * H, f1), A3 * 1.5, f2),
    ff: mapLerp(mapLerp(f0[1], 34 * H, f1), A3 * 3, f2),
    view: 1 - mapIO(map01(s / 1.2)),
  };
}
const MAP_NORTH = { greenfield: "frost", frost: "ignis" },
  MAP_SOUTH = { ignis: "frost", frost: "greenfield" },
  MAP_IDX = { greenfield: 0, frost: 1, ignis: 2 };
function mapArrows() {
  // the arrow at the top goes north, the one at the bottom goes back south (each only where there is somewhere to go)
  const n = MAP_NORTH[mapArea],
    s = MAP_SOUTH[mapArea],
    aN = document.getElementById("maparrow"),
    aS = document.getElementById("maparrow2");
  if (aN) {
    aN.style.display = n ? "" : "none";
    if (n) {
      document.getElementById("maparrowlbl").textContent = MAP_AREAS[n].title;
      aN.setAttribute("aria-label", "Travel to " + MAP_AREAS[n].title);
    }
  }
  if (aS) {
    aS.style.display = s ? "" : "none";
    if (s) {
      document.getElementById("maparrow2lbl").textContent =
        MAP_AREAS[s].title;
      aS.setAttribute("aria-label", "Return to " + MAP_AREAS[s].title);
    }
  }
}
function switchMapArea(area) {
  if (!MAP_AREAS[area] || mapArea === area) return;
  blip(740, 0.1);
  mapArea = area;
  mapAreaTarget = MAP_IDX[area];
  setFrostMusic(area === "frost");
  setIgnisMusic(area === "ignis");
  MAP_SPOTS = MAP_AREAS[area].spots;
  mapSel = 0;
  treeGroup = areaTrees(area);
  moveKnightToArea(area);
  const tEl = document.getElementById("maptitle");
  if (tEl) {
    tEl.classList.add("sw");
    clearTimeout(tEl._t);
    tEl._t = setTimeout(() => {
      tEl.textContent = MAP_AREAS[area].title;
      tEl.classList.remove("sw");
    }, 150);
  }
  mapArrows();
  mapRefresh();
}
function mapBuild() {
  const box = document.getElementById("map"),
    info = document.getElementById("mapinfo");
  if (!box || mapEls) return;
  mapEls = {
    name: document.getElementById("mapname"),
    stat: document.getElementById("mapstat"),
    ok: document.getElementById("mapok"),
    you: document.getElementById("mapyou"),
  };
  ALL_MAP_SPOTS.forEach((d, i) => {
    const el = document.createElement("div");
    el.className = "mp-ping" + (d.lock ? " locked" : "");
    el.style.setProperty("--c", d.col);
    el.style.setProperty("--d", d.idx * 0.15 + "s");
    el.innerHTML =
      '<div class="mp-pop"><i class="mp-ring"></i><i class="mp-ring"></i><i class="mp-ring"></i><b class="mp-dia"></b></div>';
    const lbl = document.createElement("span");
    lbl.className = "mp-lbl";
    lbl.textContent = d.idx + 1 + " " + d.n;
    el.appendChild(lbl);
    const hit = document.createElement("button");
    hit.type = "button";
    hit.className = "mp-hit";
    hit.setAttribute("aria-label", d.n);
    hit.onmouseenter = () => {
      if (d.area === mapArea) mapPick(d.idx);
    };
    hit.onclick = () => {
      if (d.area !== mapArea) {
        switchMapArea(d.area);
        mapPick(d.idx);
      } else if (mapSel === d.idx) mapConfirm();
      else mapPick(d.idx);
    };
    el.appendChild(hit);
    box.insertBefore(el, info);
    mapPings.push({ el: el, lbl: lbl, lw: 0, d: d });
  });
  const aEl = document.getElementById("maparrow");
  if (aEl) {
    aEl.onclick = () => {
      const n = MAP_NORTH[mapArea];
      if (n) switchMapArea(n);
    };
    const st = document.createElement("style");
    let css = "";
    for (const sh of document.styleSheets) {
      let rs;
      try {
        rs = sh.cssRules;
      } catch (e) {
        continue;
      }
      for (const r of rs)
        if (r.cssText && /#maparrow(?![\w-])/.test(r.cssText))
          css +=
            r.cssText.replace(/#maparrow(?![\w-])/g, "#maparrow2") + "\n";
    }
    st.textContent = css;
    document.head.appendChild(st);
    const a2 = aEl.cloneNode(true);
    a2.id = "maparrow2";
    a2.classList.add("south");
    a2.querySelector(".arr").innerHTML = "&#9660;";
    a2.querySelector("#maparrowlbl").id = "maparrow2lbl";
    a2.onclick = () => {
      const s = MAP_SOUTH[mapArea];
      if (s) switchMapArea(s);
    };
    aEl.parentNode.insertBefore(a2, aEl.nextSibling);
    mapArrows();
  }
  mapEls.ok.onclick = mapConfirm;
  document.getElementById("mapback").onclick = mapClose;
}
function mapRefresh() {
  // the info window and which ping is selected
  if (!mapEls) return;
  const d = MAP_SPOTS[mapSel],
    st = d.lock ? "LOCKED" : d.ready && !d.ready() ? "LOADING" : "READY";
  mapEls.name.textContent = mapSel + 1 + " " + d.n;
  mapEls.stat.textContent = st;
  mapEls.stat.className = "ms" + (st === "READY" ? "" : " no");
  mapEls.ok.disabled = st !== "READY";
  mapPings.forEach((q) => q.el.classList.toggle("sel", q.d === d));
}
function mapPick(i) {
  if (!mapMode || mapDir < 0 || i === mapSel) return;
  mapSel = i;
  blip(520, 0.05);
  mapRefresh();
}
function mapMove(d) {
  mapPick((mapSel + d + MAP_SPOTS.length) % MAP_SPOTS.length);
}
function mapConfirm() {
  if (!mapMode || mapDir < 0 || dgBusy || shopT >= 0) return;
  const d = MAP_SPOTS[mapSel];
  if (d.lock) {
    blip(140, 0.14);
    if (window.toast) window.toast("LOCKED");
    return;
  }
  if (d.ready && !d.ready()) {
    blip(140, 0.14);
    if (window.toast) window.toast("STILL LOADING...");
    return;
  }
  blip(880, 0.09);
  d.run();
}
function openMap() {
  if (mapMode || exploring || dungeon || dgBusy || !playerRig) return;
  swooshHide();
  mapBuild();
  {
    const tEl = document.getElementById("maptitle");
    if (tEl) {
      clearTimeout(tEl._t);
      tEl.classList.remove("sw");
      tEl.textContent = MAP_AREAS[mapArea].title;
    }
  // the map is still hidden here, so the right area name is in place before it fades in
  }
  mapCam = {
    p: camera.position.clone(),
    yaw: yaw,
    pit: -pitch,
    t: target.clone(),
  // the menu camera as it is right now (orbit: pitch + is looking down)
  };
  mapFog0 = [U.uFogNear.value, U.uFogFar.value];
  mapMode = true;
  mapS = 0;
  mapDir = 1;
  mapSel = 0;
  mapViewK = 1;
  mapAcc = 0;
  camera.rotation.order = "YXZ";
  document.body.classList.add("map");
  mapPings.forEach((q) => {
    q.lw = 0;
    q.el.classList.remove("on");
  });
  mapRefresh();
  blip(660, 0.12);
}
function mapClose() {
  if (!mapMode || mapDir < 0 || dgBusy || shopT >= 0) return;
  mapDir = -1;
  document.body.classList.remove("mapui");
  blip(300, 0.08);
}
function mapSnap() {
  // back to the menu at once: camera, fog, floor, overlay (also used under the black of the fade when a dungeon is entered)
  if (!mapMode) return;
  mapMode = false;
  mapS = 0;
  mapDir = 0;
  mapViewK = 1;
  mapAreaK = mapAreaTarget;
  mapAreaV.v = 0;
  moveKnightToArea(mapArea);
  syncFrostBlend();
  if (mapFog0) {
    U.uFogNear.value = mapFog0[0];
    U.uFogFar.value = mapFog0[1];
    mapFog0 = null;
  }
  if (mapBig) {
    mapBig = false;
    if (floorMesh) floorMesh.scale.set(1, 1, 1);
  }
  document.body.classList.remove("map", "mapui");
  mapPings.forEach((q) => q.el.classList.remove("on"));
  applyView();
}
function mapScreen(x, y, z) {
  _mp.set(x, y, z).project(camera);
  return _mp.z < 1 && _mp.z > -1
    ? [(_mp.x * 0.5 + 0.5) * innerWidth, (-_mp.y * 0.5 + 0.5) * innerHeight]
    : null;
}
function mapStep(dt) {
  if (shopT >= 0) {
    shopStep(dt);
    return;
  // the shop flight places the camera itself
  }
  if (mapDir !== 0) {
    const i = Math.min(
      2,
      Math.max(0, Math.floor(mapDir > 0 ? mapS : mapS - 1e-6)),
    );
    mapS += ((mapDir * dt) / MAP_DUR[i]) * (mapDir < 0 ? MAP_BACK : 1);
    if (mapDir > 0 && mapS >= 3) {
      mapS = 3;
      mapDir = 0;
    } else if (mapDir < 0 && mapS <= 0) {
      mapSnap();
      return;
    }
  }
  // Glide mapAreaK toward mapAreaTarget (0 = Greenfield, 1 = Veiled Frost). A critically damped spring: it eases off and on, takes about the same time at any frame rate, and never jerks.
  if (mapAreaK !== mapAreaTarget) {
    mapAreaK = smoothDamp(
      mapAreaK,
      mapAreaTarget,
      mapAreaV,
      MAP_AREA_TIME,
      dt,
    );
    if (
      Math.abs(mapAreaTarget - mapAreaK) < 0.002 &&
      Math.abs(mapAreaV.v) < 0.01
    ) {
      mapAreaK = mapAreaTarget;
      mapAreaV.v = 0;
    }
  }
  syncFrostBlend();
  const s = mapS,
    H = playerH,
    A3 = mapA3() * H,
    q = mapPose(s, mapCam, H, A3, mapFog0);
  camera.position.set(q.x, q.y, q.z);
  camera.rotation.set(q.pit, q.yaw, 0);
  camera.updateMatrixWorld(true);
  U.uFogNear.value = q.fn;
  U.uFogFar.value = q.ff;
  const big = s >= 0.6;
  if (big !== mapBig) {
    mapBig = big;
    floorMesh.scale.set(1, 1, 1);
  }
  if (Math.abs(q.view - mapViewK) > 1e-4) {
    mapViewK = q.view;
    applyView();
  }
  // on the way back the menu returns just before the camera lands
  document.body.classList.toggle("map", !(mapDir < 0 && s < 0.8));
  const show = mapDir >= 0 && s >= 2.3;
  document.body.classList.toggle("mapui", show);
  if (s < 1.9) return;
  const W = innerWidth,
    Hh = innerHeight,
    gy = blobHome ? blobHome.y : 0,
    hx = homeTarget.x,
    hz = homeTarget.z;
  mapPings.forEach((pg) => {
    const d = pg.d,
      sc = mapScreen(hx + d.x * H, gy, hz + d.z * H);
    const inView =
      sc &&
      sc[0] >= -60 &&
      sc[0] <= W + 60 &&
      sc[1] >= -60 &&
      sc[1] <= Hh + 60;
    pg.el.classList.toggle("on", show && s >= 2.55 && inView);
    if (!sc) return;
    if (!pg.lw) pg.lw = pg.lbl.offsetWidth || 120;
    const lx = Math.max(
      10 - sc[0],
      Math.min(W - 10 - pg.lw - sc[0], -pg.lw / 2),
    // the label is centered under its ping but never runs off the screen
    );
    pg.el.style.transform =
      "translate(" + Math.round(sc[0]) + "px," + Math.round(sc[1]) + "px)";
    pg.lbl.style.transform = "translate(" + Math.round(lx) + "px,0)";
  });
  const yo = mapScreen(hx, gy, hz + areaZOffset(mapArea));
  if (mapEls) {
    if (yo && yo[1] >= -40 && yo[1] <= Hh + 40) {
      mapEls.you.style.opacity = "";
      mapEls.you.style.transform =
        "translate(" +
        Math.round(yo[0]) +
        "px," +
        Math.round(yo[1] - 30) +
        "px) translate(-50%,-100%)";
    } else mapEls.you.style.opacity = "0";
  }
  mapAcc += dt;
  if (mapAcc > 0.3) {
    mapAcc = 0;
    mapRefresh();
  // READY / LOADING can change while the map is open
  }
}
addEventListener("keydown", (e) => {
  if (!mapMode || dgBusy) return;
  if (shopT >= 0) {
    const k = e.key;
    if (shopDlg.on) {
      e.preventDefault();
      if (k === "Escape" || k === "Backspace") shopDlgSkip();
      else if (k === "Enter" || k === " " || k === "z" || k === "Z")
        shopDlgAdvance();
    // while Kris talks: ENTER / SPACE / Z go on, ESC skips the rest
    }
    else if (k === "Escape" || k === "Backspace") {
      e.preventDefault();
      if (shopView !== "main") shopBack();
      else shopFarewell();
    // in the BUY / TALK lists Escape goes back to the main panel, there it makes Kris say bye and leaves the shop
    }
    else if (shopUi && shopUi.classList.contains("on")) {
      if (k === "ArrowUp" || k === "w" || k === "W") {
        e.preventDefault();
        shopSelect(shopCur - 1, true);
      } else if (k === "ArrowDown" || k === "s" || k === "S") {
        e.preventDefault();
        shopSelect(shopCur + 1, true);
      } else if (k === "Enter" || k === " ") {
        e.preventDefault();
        shopActivate();
      } else if (shopView === "main" && k === "ArrowRight" && shopCur < 2) {
        e.preventDefault();
        shopActivate();
      // right opens BUY / TALK
      }
      else if (shopView !== "main" && k === "ArrowLeft") {
        e.preventDefault();
        shopBack();
      }
    }
    return;
  // in the shop, Escape walks back out
  }
  const k = e.key;
  if (k === "Escape" || k === "Backspace") {
    e.preventDefault();
    mapClose();
  } else if (mapDir === 0 && mapS >= 3) {
    if (k === "ArrowRight" || k === "d") mapMove(1);
    else if (k === "ArrowLeft" || k === "a") mapMove(-1);
    else if (k === "ArrowUp" || k === "w") {
      if (MAP_NORTH[mapArea]) switchMapArea(MAP_NORTH[mapArea]);
      else mapMove(-1);
    } else if (k === "ArrowDown" || k === "s") {
      if (MAP_SOUTH[mapArea]) switchMapArea(MAP_SOUTH[mapArea]);
      else mapMove(1);
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      mapConfirm();
    }
  }
});
