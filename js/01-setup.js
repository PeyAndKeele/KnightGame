// Renderer, scene, shared PS1 uniforms, armor tint and shine, heavy-combo sparks.
// (Part 1 of 14. All parts share one scope; see README.)


const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
});
renderer.setPixelRatio(1);
const SKY = 0x232a4a;
renderer.setClearColor(SKY);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);

/* ---------- shared PS1 uniforms ---------- */
const U = {
  uRes: { value: new THREE.Vector2(320, 240) },
  uSnap: { value: 1 },
  uAffine: { value: 1 },
  uDither: { value: 1 },
  uLevels: { value: 31 },
  uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.6).normalize() },
  uFillDir: { value: new THREE.Vector3(-0.7, 0.2, -0.5).normalize() },
  uAmb: { value: 0.5 },
  uSun: { value: 0.5 },
  uFill: { value: 0.2 },
  uNight: { value: new THREE.Vector3(1, 1, 1) },
  uFogNear: { value: 5 },
  uFogFar: { value: 20 },
  uFogColor: { value: new THREE.Color(SKY) },
  uLampPos: { value: new THREE.Vector3() },
  uLampP: { value: new THREE.Vector4(1, 0, 14, 0) },
  uLampCol: { value: new THREE.Vector3(1, 0.78, 0.45) },
  uMagmaPulse: { value: 0 },
  uLamp2Pos: { value: new THREE.Vector3() },
  uLamp2P: { value: new THREE.Vector4(1, 0, 10, 0) },
  // the shop's sign light (updateShopLamp)   // the shop lantern (updateShopLamp)
  uLamp2Col: { value: new THREE.Vector3(1, 0.86, 0.62) },
  uOccF: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
  uOccN: { value: 0 },
  uOccGap: { value: 1 },
  // see-through obstacles (occUpdate): where up to 6 characters are on screen
  uOccNear: { value: new THREE.Vector2(-1, -0.5) },
};
const VS = `
uniform vec2 uRes; uniform float uSnap; uniform vec3 uSunDir; uniform vec3 uFillDir;
uniform float uAmb; uniform float uSun; uniform float uFill; uniform float uFogNear; uniform float uFogFar; uniform float uUvScale;
uniform float uShine; uniform vec3 uLampPos; uniform vec4 uLampP; varying float vLampD; varying float vLampS;
uniform vec3 uLamp2Pos; uniform vec4 uLamp2P; varying float vLamp2D; varying float vLamp2S;
varying vec2 vUvA; varying vec2 vUvP; varying float vW; varying float vLit; varying float vFog; varying float vEnv; varying float vSpec;
void main(){
  vec4 mv=modelViewMatrix*vec4(position,1.0);
  vec4 cp=projectionMatrix*mv;
  if(uSnap>0.5){ vec2 n=cp.xy/cp.w; vec2 g=uRes*0.5; n=floor(n*g+0.5)/g; cp.xy=n*cp.w; }
  gl_Position=cp;
  vec2 t=uv*uUvScale; vUvP=t; vUvA=t*cp.w; vW=cp.w;
  vec3 nr=normalize(normalMatrix*normal);
  float d=max(dot(nr,normalize(mat3(viewMatrix)*uSunDir)),0.0);
  float f=max(dot(nr,normalize(mat3(viewMatrix)*uFillDir)),0.0);
  vLit=uAmb+uSun*d+uFill*f;
  vFog=smoothstep(uFogNear,uFogFar,-mv.z);
  vec3 rf=reflect(normalize(mv.xyz),nr);                       // fake metal: reflect the view ray, look up sky/ground and a sun glint per vertex
  vEnv=dot(rf,normalize(mat3(viewMatrix)*vec3(0.0,1.0,0.0)));
  vSpec=pow(max(dot(rf,normalize(mat3(viewMatrix)*uSunDir)),0.0),8.0);
  /* the shop lantern (BRIGHTBOX): lit at each VERTEX (Gouraud) and blended across the triangle, for shiny materials only. uLampP = range, strength, highlight sharpness */
  vLampD=0.0; vLampS=0.0;
  if(uShine>0.01&&uLampP.y>0.0){
    vec3 lp=(viewMatrix*vec4(uLampPos,1.0)).xyz;
    vec3 ld=lp-mv.xyz; float dist=length(ld); ld=ld/max(dist,0.0001);
    float q=clamp(1.0-dist*dist/(uLampP.x*uLampP.x),0.0,1.0); float att=q*q*uLampP.y;          // fades smoothly to nothing at the edge of its range
    vLampD=max(dot(nr,ld),0.0)*att;
    vLampS=pow(max(dot(nr,normalize(ld+normalize(-mv.xyz))),0.0),uLampP.z)*att;               // a highlight that slides over the metal as the camera moves
  }
  /* the second light, the same way: a point in front of the stall that is never drawn, there only to light the sign */
  vLamp2D=0.0; vLamp2S=0.0;
  if(uShine>0.01&&uLamp2P.y>0.0){
    vec3 lp2=(viewMatrix*vec4(uLamp2Pos,1.0)).xyz;
    vec3 ld2=lp2-mv.xyz; float dist2=length(ld2); ld2=ld2/max(dist2,0.0001);
    float q2=clamp(1.0-dist2*dist2/(uLamp2P.x*uLamp2P.x),0.0,1.0); float att2=q2*q2*uLamp2P.y;
    vLamp2D=max(dot(nr,ld2),0.0)*att2;
    vLamp2S=pow(max(dot(nr,normalize(ld2+normalize(-mv.xyz))),0.0),uLamp2P.z)*att2;
  }
}`;
const FS = `
uniform sampler2D map; uniform vec3 uTint; uniform float uAffine; uniform float uDither; uniform float uLevels; uniform vec3 uFogColor; uniform vec3 uNight; uniform float uShine; uniform float uBlackNoShine; uniform float uBlackGrey; uniform float uMaskNoShine; uniform float uBlackFlash;
uniform vec3 uLampCol; uniform float uEmit; varying float vLampD; varying float vLampS;
uniform float uMagma; uniform float uGem; uniform float uBladeGlow; uniform float uMagmaPulse;   // uMagma (1 on the Ignis Mourne trees): the orange, magma-looking texels glow; uMagmaPulse (0..1, shared) slowly swells and fades that glow
uniform vec3 uLamp2Col; varying float vLamp2D; varying float vLamp2S;
uniform vec4 uOccF[6]; uniform float uOccN; uniform float uOccGap; uniform float uOccOn; uniform vec2 uOccNear;
varying vec2 vUvA; varying vec2 vUvP; varying float vW; varying float vLit; varying float vFog; varying float vEnv; varying float vSpec;
float b2(vec2 p){ p=mod(p,2.0); if(p.x<1.0) return p.y<1.0?0.0:3.0; return p.y<1.0?2.0:1.0; }
void main(){
  vec2 st=uAffine>0.5 ? vUvA/vW : vUvP;
  vec4 tx=texture2D(map,st);
  if(tx.a<0.5) discard;
  if(uBladeGlow>0.0){ float ch=max(tx.r,max(tx.g,tx.b))-min(tx.r,min(tx.g,tx.b)); tx.rgb=mix(tx.rgb,vec3(1.0),uBladeGlow*0.85*(1.0-smoothstep(0.08,0.16,ch))); }   // uBladeGlow (the Knightly sword): the grey steel is pushed towards white (the coloured gems are left alone)
  if(uOccOn>0.5&&uOccN>0.5){                                      // see-through obstacles: what stands between the camera and the knight / an enemy is dithered away around him
    float hide=0.0;
    for(int i=0;i<6;i++){
      if(float(i)>=uOccN) break;
      vec4 f=uOccF[i];                                            // xy = where he is on the screen (pixels), z = how big the hole is (pixels), w = how far he is from the camera
      float fr=1.0-smoothstep(f.w-uOccGap,f.w-uOccGap*0.4,vW);    // only what is nearer to the camera than him
      float fa=1.0-smoothstep(f.z*0.6,f.z,length(gl_FragCoord.xy-f.xy));   // gone in the middle, dithering out towards the rim
      hide=max(hide,fr*fa);
    }
    hide=max(hide,1.0-smoothstep(uOccNear.x,uOccNear.y,vW));      // and whatever is right up against the lens, so a wall can never fill the screen
    vec2 q=floor(gl_FragCoord.xy);
    if((4.0*b2(q)+b2(floor(q*0.5))+0.5)/16.0<hide) discard;       // the same 4x4 ordered dither as the colour dither, so it reads as the same grain
  }
  vec3 base=tx.rgb*uTint, lit=base*vLit, lampT=vec3(0.0);
  if(uMaskNoShine>0.5&&tx.a<0.998){ base=tx.rgb/uNight; lit=base; }   // the shopkeeper's no-shine pixels: exactly the texture colour - no armor tint, no lighting, no night tint
  if(uBlackGrey>0.0){ base=mix(base,vec3(uBlackGrey)/uNight,1.0-smoothstep(0.03,0.09,max(tx.r,max(tx.g,tx.b)))); lit=base*vLit; }   // uBlackGrey (the shopkeeper's Helmet 6): the pure-black parts of the texture are this grey instead - untinted, and not bluish at night (/uNight cancels the night tint), still shaded by the light
  if(uShine>0.01){                                             // uShine (0..1) scales both the env ramp and the BRIGHTBOX lantern highlight
    float sh=clamp(uShine,0.0,1.0);
    if(uMaskNoShine>0.5) sh*=step(0.998,tx.a);   // uMaskNoShine (the shopkeeper's helmet): texels with alpha 254 instead of 255 never shine (the old pure-black areas, now retextured)
    if(uBlackNoShine>0.5) sh*=smoothstep(0.03,0.09,max(tx.r,max(tx.g,tx.b)));   // uBlackNoShine (Helmet 6): the pure-black parts of the texture get no shine at all
    float e=floor(clamp(vEnv*0.5+0.5,0.0,1.0)*3.0+0.5)/3.0;
    vec3 m=mix(base*base*0.7,base*1.35,e);
    float sp=(step(0.3,vSpec)*0.3+step(0.7,vSpec)*0.5)*sh;
    lit=mix(lit,m,0.8*sh)+mix(vec3(1.0),uTint,0.5)*sp;
    lampT=(base*uLampCol*vLampD*mix(0.45,1.0,sh)+mix(vec3(1.0),uTint,0.5)*uLampCol*vLampS*sh)*sh;
    lampT+=(base*uLamp2Col*vLamp2D*mix(0.45,1.0,sh)+mix(vec3(1.0),uTint,0.5)*uLamp2Col*vLamp2S*sh)*sh;
  }
  float mgm=uMagma*smoothstep(0.40,0.52,tx.r-0.5*tx.b);                                          // 1 on the orange texels (the charred dark ones stay dark), 0 elsewhere
  lit=mix(lit,base*(1.30+0.55*uMagmaPulse)*vec3(1.0,0.94,0.82),mgm);                                // the magma shines from within: brighter than any light would make it, and it swells with the pulse
  float gem=uGem*smoothstep(0.08,0.16,max(tx.r,max(tx.g,tx.b))-min(tx.r,min(tx.g,tx.b)));        // uGem (the Knightly sword): every coloured texel (green, yellow, red, teal ...) glows from within, bright and breathing with the same pulse as the magma; the grey steel does not
  lit=mix(lit,tx.rgb*(1.85+0.7*uMagmaPulse)+0.12,gem);   // (the gems keep their own colours: the sword's tint does not touch them)
  lit=mix(lit,base,uEmit);                                                                      // uEmit: 1 on the lantern's bulb itself - it glows instead of being lit
  vec3 c=mix(lit*mix(uNight,vec3(1.0),max(max(uEmit,mgm),gem))+lampT,uFogColor,vFog);                    // (night does not dim a glow)
  c=mix(c,vec3(1.0),uBlackFlash*(1.0-smoothstep(0.03,0.09,max(tx.r,max(tx.g,tx.b)))));   // uBlackFlash (EDIT mode, helmet only): the pure-black texels (the visor) flash white, glowing: no lighting, no fog
  if(uDither>0.5){
    vec2 p=floor(gl_FragCoord.xy);
    float b=(4.0*b2(p)+b2(floor(p*0.5)))/16.0-0.47;
    c=floor(clamp(c+b/uLevels,0.0,1.0)*uLevels+0.5)/uLevels;
  }
  gl_FragColor=vec4(c,1.0);
}`;
/* Texture bleed fix. The model's UV faces end exactly on texel borders, and with nearest-pixel sampling (plus the PS1 affine interpolation) a pixel on the very edge of a face sometimes lands in the NEXT texel, which belongs to another face of the texture,
 so stray slivers of it show up beside the see-through parts. insetIslandUV pulls every connected face group's UVs in towards its own middle by `delta` texels, so edge pixels always sample inside their own face. */
const AXE_UV_INSET = 0.05;
function insetIslandUV(uvArr, idx, W, H, delta) {
  const uv = Float32Array.from(uvArr),
    nv = uv.length / 2,
    par = Array.from({ length: nv }, (_, i) => i);
  const find = (x) => {
    while (par[x] !== x) {
      par[x] = par[par[x]];
      x = par[x];
    }
    return x;
  };
  for (let t = 0; t < idx.length; t += 3) {
    for (let j = 1; j < 3; j++) {
      const a = find(idx[t]),
        b = find(idx[t + j]);
      if (a !== b) par[b] = a;
    }
  }
  const isl = new Map();
  new Set(idx).forEach((v) => {
    const r = find(v);
    if (!isl.has(r)) isl.set(r, []);
    isl.get(r).push(v);
  });
  isl.forEach((vs) => {
    let x0 = 1e9,
      y0 = 1e9,
      x1 = -1e9,
      y1 = -1e9;
    vs.forEach((v) => {
      const x = uv[v * 2] * W,
        y = uv[v * 2 + 1] * H;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    });
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2,
      hx = Math.max((x1 - x0) / 2, 1e-6),
      hy = Math.max((y1 - y0) / 2, 1e-6);
    const sx = Math.max(0.5, 1 - delta / hx),
      sy = Math.max(0.5, 1 - delta / hy);
    vs.forEach((v) => {
      uv[v * 2] = ((uv[v * 2] * W - cx) * sx + cx) / W;
      uv[v * 2 + 1] = ((uv[v * 2 + 1] * H - cy) * sy + cy) / H;
    });
  });
  return uv;
}
const VS_FLOOR = `
uniform vec2 uRes; uniform float uSnap; uniform vec3 uSunDir; uniform vec3 uFillDir;
uniform float uAmb; uniform float uSun; uniform float uFill; uniform float uFogNear; uniform float uFogFar; uniform float uUvScale;
varying vec2 vUvA; varying vec2 vUvP; varying float vW; varying float vLit; varying float vFog; varying vec3 vWorldPos;
void main(){
  vec4 wp=modelMatrix*vec4(position,1.0);
  vWorldPos=wp.xyz;
  vec4 mv=viewMatrix*wp;
  vec4 cp=projectionMatrix*mv;
  if(uSnap>0.5){ vec2 n=cp.xy/cp.w; vec2 g=uRes*0.5; n=floor(n*g+0.5)/g; cp.xy=n*cp.w; }
  gl_Position=cp;
  vec2 t=uv*uUvScale; vUvP=t; vUvA=t*cp.w; vW=cp.w;
  vec3 nr=normalize(normalMatrix*normal);
  float d=max(dot(nr,normalize(mat3(viewMatrix)*uSunDir)),0.0);
  float f=max(dot(nr,normalize(mat3(viewMatrix)*uFillDir)),0.0);
  vLit=uAmb+uSun*d+uFill*f;
  vFog=smoothstep(uFogNear,uFogFar,-mv.z);
}`;
const FS_FLOOR = `
uniform sampler2D map; uniform sampler2D mapFrost; uniform sampler2D mapIgnis; uniform float uIgnisZ; uniform float uUseFrost; uniform float uFrostZ; uniform float uFrostSpan;
uniform vec3 uTint; uniform float uAffine; uniform float uDither; uniform float uLevels; uniform vec3 uFogColor; uniform vec3 uNight;
varying vec2 vUvA; varying vec2 vUvP; varying float vW; varying float vLit; varying float vFog; varying vec3 vWorldPos;
float b2(vec2 p){ p=mod(p,2.0); if(p.x<1.0) return p.y<1.0?0.0:3.0; return p.y<1.0?2.0:1.0; }
void main(){
  vec2 st=uAffine>0.5 ? vUvA/vW : vUvP;
  vec4 txG=texture2D(map,st);
  vec4 txF=texture2D(mapFrost,st);
  vec4 txI=texture2D(mapIgnis,st);
  float wave=sin(vWorldPos.x*0.35)*1.2+sin(vWorldPos.x*0.95+1.7)*0.55+cos(vWorldPos.x*1.8-0.6)*0.25;
  float k=uUseFrost*(1.0-smoothstep(uFrostZ-uFrostSpan, uFrostZ+uFrostSpan, vWorldPos.z+wave));
  float k2=uUseFrost*(1.0-smoothstep(uIgnisZ-uFrostSpan, uIgnisZ+uFrostSpan, vWorldPos.z+wave));
  vec3 base=mix(mix(txG.rgb,txF.rgb,k),txI.rgb,k2)*uTint, lit=base*vLit;
  vec3 c=mix(lit*uNight,uFogColor,vFog);
  if(uDither>0.5){
    vec2 p=floor(gl_FragCoord.xy);
    float b=(4.0*b2(p)+b2(floor(p*0.5)))/16.0-0.47;
    c=floor(clamp(c+b/uLevels,0.0,1.0)*uLevels+0.5)/uLevels;
  }
  gl_FragColor=vec4(c,1.0);
}`;
function ps1Mat(tex, uvScale) {
  tex.encoding = THREE.LinearEncoding;
  tex.generateMipmaps = false;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return new THREE.ShaderMaterial({
    vertexShader: VS,
    fragmentShader: FS,
    side: THREE.DoubleSide,
    uniforms: Object.assign(
      {
        map: { value: tex },
        uUvScale: { value: uvScale || 1 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uShine: { value: 0 },
        uBlackNoShine: { value: 0 },
        uBlackGrey: { value: 0 },
        uMaskNoShine: { value: 0 },
        uBlackFlash: { value: 0 },
        uEmit: { value: 0 },
        uMagma: { value: 0 },
        uGem: { value: 0 },
        uBladeGlow: { value: 0 },
        uOccOn: { value: 0 },
      },
      U,
    ),
  // uOccOn: 1 on walls and trees (occMark), which dither away when they are in front of someone
  });
}
function ps1FloorMat(texG, texF, texI, uvScale, H) {
  [texG, texF, texI].forEach((tex) => {
    tex.encoding = THREE.LinearEncoding;
    tex.generateMipmaps = false;
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
  });
  return new THREE.ShaderMaterial({
    vertexShader: VS_FLOOR,
    fragmentShader: FS_FLOOR,
    side: THREE.DoubleSide,
    uniforms: Object.assign(
      {
        map: { value: texG },
        mapFrost: { value: texF },
        mapIgnis: { value: texI },
        uUseFrost: { value: 1 },
        uFrostZ: { value: -10 * H },
        uIgnisZ: { value: -10 * H },
        uFrostSpan: { value: 4.8 * H },
        uUvScale: { value: uvScale || 24 },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
      },
      U,
    ),
  });
}

/* ---------- armor tint: multiplies every part of the knight (body, limbs, boots, helmets) except the plume (own color) and the sword (own tint, or matched to the armor) ---------- */
/* the knight's look (armor tint, tint strength, plume colour) is kept in localStorage so the next visit starts with it, and so the loading screen's runner can wear it (see index.html) */
const LOOK_KEY = "knight-look",
  _hexOk = (v) =>
    typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : null;
const _look = (function () {
  try {
    return JSON.parse(localStorage.getItem(LOOK_KEY) || "null") || {};
  } catch (e) {
    return {};
  }
})();
function lookSave() {
  try {
    localStorage.setItem(
      LOOK_KEY,
      JSON.stringify({ armor: armorHex, amt: armorAmt, plume: plumeHex }),
    );
  } catch (e) {}
}
const armorMats = [];
let armorHex = _hexOk(_look.armor),
  armorAmt =
    typeof _look.amt === "number" && _look.amt >= 0 && _look.amt <= 1
      ? _look.amt
      : 0.55;
// fake metal shading on the armor and sword (Customize > Shiny metal)
let shiny = true;
function shineMat(m) {
  m.uniforms.uShine.value = shiny ? 1 : 0;
}
const swordMats = [];
let swordHex = null,
  // the blade has its own tint, or follows the armor's while swordMatch is on
  swordMatch = true;
// how strongly the shopkeeper's armor takes its colour (0..1)
const SHOP_ARMOR_TINT = 0.87;
function tintMat(m, hex, amt) {
  // amt: tint strength 0..1 (default: the ARMOR slider's armorAmt)
  shineMat(m);
  const v = m.uniforms.uTint.value;
  if (!hex) {
    v.set(1, 1, 1);
    return;
  }
  const c = new THREE.Color(hex),
    // brightest channel = 1, so it recolors without darkening
    mx = Math.max(c.r, c.g, c.b, 1e-4);
  const a =
    amt !== undefined
      ? amt
      : m.userData.tintAmt !== undefined
        ? m.userData.tintAmt
        // (a material can carry its own strength in userData.tintAmt)
        : armorAmt;
  v.set(
    1 + (c.r / mx - 1) * a,
    1 + (c.g / mx - 1) * a,
    1 + (c.b / mx - 1) * a,
  );
}
function tintArmorMat(m) {
  tintMat(m, armorHex);
}
function applySwordTint() {
  swordMats.forEach((m) => tintMat(m, swordMatch ? armorHex : swordHex));
}
/* UI THEME: only the title lettering and the rule under a screen's name (the --t-* variables) follow the armor colour. They are blue by default; with an armor colour picked the same palette is repainted in
 that colour's hue (same lightness steps; the saturation follows how colourful the armor is, so grey armor gives grey). Every other window / panel colour (--win-*, --edge, --dim, --ui-*) stays its own blue. */
const UI_THEME = [
  ["--t-hi", "#8fa4ff"],
  ["--t-mid", "#4558c8"],
  ["--t-lo", "#1a2468"],
  ["--t-glow", "rgba(130,160,255,.5)"],
  ["--t-rule", "#3a4aa8"],
];
function _uiRgb(c) {
  let m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(c);
  return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
}
function _uiHsl(r, g, b) {
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
function _uiFromHsl(h, s, l) {
  const f = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    return t < 1 / 6
      ? p + (q - p) * 6 * t
      : t < 1 / 2
        ? q
        : t < 2 / 3
          ? p + (q - p) * (2 / 3 - t) * 6
          : p;
  };
  if (s <= 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
    p = 2 * l - q;
  return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map((x) =>
    Math.round(x * 255),
  );
}
function uiThemeApply() {
  const root = document.documentElement.style,
    c = armorHex && _uiRgb(armorHex);
  if (!c) {
    UI_THEME.forEach((t) => root.removeProperty(t[0]));
    return;
  // no armor colour: the stylesheet's blues
  }
  const a = _uiHsl(c[0], c[1], c[2]),
    // a grey / white / black armor has no hue to follow: neutral grey panels
    k = a[1] < 0.1 ? 0 : Math.max(0.25, Math.min(1, a[1] / 0.6));
  UI_THEME.forEach((t) => {
    const b = _uiRgb(t[1]),
      hs = _uiHsl(b[0], b[1], b[2]),
      r = _uiFromHsl(a[0], hs[1] * k, hs[2]);
    root.setProperty(
      t[0],
      b[3] < 1
        ? "rgba(" + r[0] + "," + r[1] + "," + r[2] + "," + b[3] + ")"
        : "rgb(" + r[0] + "," + r[1] + "," + r[2] + ")",
    );
  });
}
function applyArmorTint() {
  armorMats.forEach(tintArmorMat);
  applySwordTint();
  uiThemeApply();
}

/* ---------- armor shine: now and then a glint fades in and out on a random spot of the knight's body ---------- */
const bodyMeshes = [];
let shineOn = true,
  shineSpr = null,
  shineTex = null,
  shineCtx = null,
  shineFrames = null;
const shine = {
  active: false,
  wait: 2,
  t: 0,
  dur: 1.4,
  fi: -1,
  obj: null,
  local: new THREE.Vector3(),
  size: 0.3,
};
const SHINE_MIN = 2.5,
  // seconds between glints
  SHINE_MAX = 7;
const SHINE_PX = 14;
function makeShineFrames() {
  // frames come from glint_silver.gif (2 frames, 500 ms each), embedded as PNGs
  return [
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAA4ElEQVR4nI2SMWsDMQyFn8ttsbyHZC7tWij9/2MIZG3pfMftfuqsDopjKyRwD4xtxKdnSU5m2CgzIKV2e9mKdTiAz33nZbVKWqVidJwaVEnfq+J42KfT+WJFMgACAErJIeHUs9BqVZDE98+vAQp36SoSQFeDKhXkH6gOSc4oknE87NOY5NacMUBVkNel7nw6X+wh6HXGp8VnxhoD+PX5kYpkSM4Qua7cgXlZb67TCHqAENlBZBecRCR0NoD3La9UvL+9pnlZrcd8fGkc/f0sH1frX28A2yk9AaKG5mwDmv4BjzN1wEztDgYAAAAASUVORK5CYII=",
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAmklEQVR4nKWSQQ7DIAwElyhH7GdU7f8fkyjP8JKze0BEVMFIUfcKs1iDkzsmcQdSGp0sM2yWEDTSjSUE1xCyCqk8Aa2AZDxnBJJEG3PbDxcRqGaoSOrA6tVYrpeMBeQ5qvQGL1X3WPk47oD7NWpt4u1XVTI+79eteP29JKlZ3PbDAUBkrHUopwdU8zOwAb3JPine1XhPgT929Qsha0KoLi6LgAAAAABJRU5ErkJggg==",
  ].map((src) => {
    const c = document.createElement("canvas");
    c.width = c.height = SHINE_PX;
    const img = new Image();
    img.onload = () => {
      c.getContext("2d").drawImage(img, 0, 0);
      shine.fi = -1;
    // redraw the sprite once the png has decoded
    };
    img.src = src;
    return c;
  });
}
function ensureShine() {
  if (shineSpr) return;
  shineFrames = makeShineFrames();
  const cv = document.createElement("canvas");
  cv.width = cv.height = SHINE_PX;
  shineCtx = cv.getContext("2d");
  shineTex = new THREE.CanvasTexture(cv);
  shineTex.magFilter = shineTex.minFilter = THREE.NearestFilter;
  shineTex.generateMipmaps = false;
  shineSpr = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: shineTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  );
  shineSpr.visible = false;
  shineSpr.renderOrder = 10;
  scene.add(shineSpr);
}
function startShine() {
  ensureShine();
  const meshes = bodyMeshes.filter((m) => m.visible);
  if (!playerRig || !meshes.length) {
    shine.wait = 1;
    return;
  }
  const box = new THREE.Box3();
  meshes.forEach((m) => box.expandByObject(m));
  const rc = new THREE.Raycaster(),
    o = camera.position.clone();
  for (let k = 0; k < 14; k++) {
    // aim at random points inside the knight; keep the first one that lands on a visible surface
    const p = new THREE.Vector3(
      box.min.x + Math.random() * (box.max.x - box.min.x),
      box.min.y + (0.2 + Math.random() * 0.75) * (box.max.y - box.min.y),
      box.min.z + Math.random() * (box.max.z - box.min.z),
    );
    rc.set(o, p.sub(o).normalize());
    const hit = rc.intersectObjects(meshes, false)[0];
    if (hit) {
      shine.obj = hit.object;
      // stuck to that body part, so it follows the animation
      shine.local.copy(hit.object.worldToLocal(hit.point.clone()));
      shine.t = 0;
      shine.dur = 1.0;
      shine.fi = -1;
      shine.active = true;
      shine.size = playerH * (0.09 + Math.random() * 0.05);
      shineSpr.scale.set(shine.size, shine.size, 1);
      shineSpr.visible = true;
      return;
    }
  }
  shine.wait = 1;
}
/* ---------- HEAVY COMBO SPARKS: for the last CS_LEAD seconds before the Heavy Combo's finishing blow, bright tinted glints (the knight-shine sprite) fly up off the ground under the sword ---------- */
const CS_LEAD = 0.5,
  CS_RATE = 28,
  CS_BURST = 16,
  CS_POOL = 60,
  // seconds before the finisher they start, glints per second, the extra burst when the blow lands, sprites in the pool, gravity (knight heights / s²)
  CS_GRAV = 3.2;
const csPool = [],
  csTex = [null, null];
let csPrevT = -1,
  csAcc = 0,
  csLive = 0;
function csEnsure() {
  ensureShine();
  if (csPool.length) return;
  for (let i = 0; i < 2; i++) {
    const c = document.createElement("canvas");
    c.width = c.height = SHINE_PX;
    csTex[i] = new THREE.CanvasTexture(c);
    csTex[i].magFilter = csTex[i].minFilter = THREE.NearestFilter;
    csTex[i].generateMipmaps = false;
  }
  for (let i = 0; i < CS_POOL; i++) {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: csTex[0],
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    sp.visible = false;
    sp.renderOrder = 11;
    scene.add(sp);
    csPool.push({
      sp,
      age: 0,
      life: 0,
      v: new THREE.Vector3(),
      size: 0.1,
      seed: 0,
    });
  }
}
function csRefresh() {
  csTex.forEach((t, i) => {
    const x = t.image.getContext("2d");
    x.clearRect(0, 0, SHINE_PX, SHINE_PX);
    x.drawImage(shineFrames[Math.min(i, shineFrames.length - 1)], 0, 0);
    t.needsUpdate = true;
  });
// the png frames have decoded by now
}
const _csB = new THREE.Vector3();
function csSpawn(n) {
  const ground = (blobHome ? blobHome.y : 0) + 0.01 * playerH;
  // they shoot out of the floor right under the blade's point, where the sword lands
  swTip.getWorldPosition(_csB);
  for (let k = 0; k < n; k++) {
    const p = csPool.find((q) => q.life <= 0);
    if (!p) return;
    const a = Math.random() * Math.PI * 2,
      hs = (0.5 + Math.random() * 1.4) * playerH,
      j = playerH * 0.03;
    p.sp.position.set(
      _csB.x + (Math.random() - 0.5) * j * 2,
      ground,
      _csB.z + (Math.random() - 0.5) * j * 2,
    );
    p.v.set(
      Math.cos(a) * hs,
      (0.9 + Math.random() * 1.7) * playerH,
      Math.sin(a) * hs,
    // sprayed out in every direction, then they fall back
    );
    p.ground = ground;
    p.age = 0;
    p.life = 0.7 + Math.random() * 0.6;
    p.size = playerH * (0.12 + Math.random() * 0.14);
    p.seed = (Math.random() * 2) | 0;
    // fully saturated and over-bright: very bright tints
    p.sp.material.color.setHSL(Math.random(), 1, 0.55).multiplyScalar(1.8);
    p.sp.scale.set(p.size, p.size, 1);
    p.sp.visible = true;
    csLive++;
  }
}
function updateComboSparks(dt) {
  const c = current && current.getClip(),
    cn = c && (c.ualSrc || c.name);
  if (
    cn === "HeavyCombo" &&
    swTip &&
    swHilt &&
    playerRig &&
    playerRig.visible
  ) {
    csEnsure();
    const t = current.time,
      a = HEAVY_COMBO_FINISH_T - CS_LEAD;
    if (csPrevT < 0 || t < csPrevT) {
      csAcc = 0;
      csRefresh();
    // (re)started or looped
    }
    if (t >= a && t <= HEAVY_COMBO_FINISH_T) {
      csAcc += CS_RATE * dt;
      const n = Math.floor(csAcc);
      csAcc -= n;
      csSpawn(n);
    }
    if (
      csPrevT >= 0 &&
      csPrevT < HEAVY_COMBO_FINISH_T &&
      t >= HEAVY_COMBO_FINISH_T
    )
      csSpawn(CS_BURST);
    csPrevT = t;
  } else csPrevT = -1;
  if (!csLive) return;
  csPool.forEach((p) => {
    if (p.life <= 0) return;
    p.age += dt;
    if (p.age >= p.life) {
      p.life = 0;
      p.sp.visible = false;
      csLive--;
      return;
    }
    p.v.y -= CS_GRAV * playerH * dt;
    p.sp.position.addScaledVector(p.v, dt);
    if (p.sp.position.y < p.ground) {
      p.life = 0;
      p.sp.visible = false;
      csLive--;
      return;
    // arcs up and back down to the floor
    }
    p.sp.material.opacity = Math.min(
      1,
      p.age / 0.08,
      (p.life - p.age) / (p.life * 0.5),
    );
    // flickers between the two glint frames
    p.sp.material.map = csTex[(Math.floor(p.age / 0.09) + p.seed) & 1];
  });
}
function updateShine(dt) {
  if (shine.active) {
    // e.g. the helmet it was on got swapped out
    if (!shine.obj.visible) shine.t = Math.max(shine.t, shine.dur - 0.2);
    shine.t += dt;
    if (shine.t >= shine.dur) {
      shine.active = false;
      shineSpr.visible = false;
      shineSpr.material.opacity = 0;
      shine.wait = SHINE_MIN + Math.random() * (SHINE_MAX - SHINE_MIN);
      return;
    }
    shineSpr.material.opacity = Math.max(
      0,
      Math.min(1, shine.t / 0.3, (shine.dur - shine.t) / 0.45),
    // fade in, then fade out
    );
    const fi = Math.min(
      shineFrames.length - 1,
      Math.floor((shine.t / shine.dur) * shineFrames.length),
    );
    if (fi !== shine.fi) {
      shine.fi = fi;
      shineCtx.clearRect(0, 0, SHINE_PX, SHINE_PX);
      shineCtx.drawImage(shineFrames[fi], 0, 0);
      shineTex.needsUpdate = true;
    }
    const p = shine.obj.localToWorld(shine.local.clone());
    p.add(
      camera.position
        .clone()
        .sub(p)
        .normalize()
        .multiplyScalar(playerH * 0.03),
    // nudge toward the camera so the body does not hide it
    );
    shineSpr.position.copy(p);
  } else if (shineOn) {
    shine.wait -= dt;
    if (shine.wait <= 0) startShine();
  }
}
function toggleShine() {
  shineOn = !shineOn;
  if (!shineOn && shine.active)
    // let a glint in progress fade out
    shine.t = Math.max(shine.t, shine.dur - 0.45);
  else if (shineOn && !shine.active) shine.wait = 0.6;
}
