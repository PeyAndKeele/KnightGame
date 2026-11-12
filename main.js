(function(){
if(!window.THREE||!THREE.GLTFLoader){document.getElementById('err').style.display='block';return;}

const canvas=document.getElementById('c');
const renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false});
renderer.setPixelRatio(1);
const SKY=0x232a4a;
renderer.setClearColor(SKY);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(38,1,0.05,200);

/* ---------- shared PS1 uniforms ---------- */
const U={
  uRes:{value:new THREE.Vector2(320,240)}, uSnap:{value:1}, uAffine:{value:1}, uDither:{value:1}, uLevels:{value:31},
  uSunDir:{value:new THREE.Vector3(0.5,0.8,0.6).normalize()}, uFillDir:{value:new THREE.Vector3(-0.7,0.2,-0.5).normalize()},
  uAmb:{value:0.5}, uSun:{value:0.5}, uFill:{value:0.2},
  uNight:{value:new THREE.Vector3(1,1,1)}, uFogNear:{value:5}, uFogFar:{value:20}, uFogColor:{value:new THREE.Color(SKY)},
  uLampPos:{value:new THREE.Vector3()}, uLampP:{value:new THREE.Vector4(1,0,14,0)}, uLampCol:{value:new THREE.Vector3(1,0.78,0.45)}, uMagmaPulse:{value:0},
  uLamp2Pos:{value:new THREE.Vector3()}, uLamp2P:{value:new THREE.Vector4(1,0,10,0)}, uLamp2Col:{value:new THREE.Vector3(1,0.86,0.62)},   // the shop's sign light (updateShopLamp)   // the shop lantern (updateShopLamp)
  uOccF:{value:Array.from({length:6},()=>new THREE.Vector4())}, uOccN:{value:0}, uOccGap:{value:1}, uOccNear:{value:new THREE.Vector2(-1,-0.5)}   // see-through obstacles (occUpdate): where up to 6 characters are on screen

};
const VS=`
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
const FS=`
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
const AXE_UV_INSET=0.05;
function insetIslandUV(uvArr,idx,W,H,delta){
  const uv=Float32Array.from(uvArr), nv=uv.length/2, par=Array.from({length:nv},(_,i)=>i);
  const find=x=>{ while(par[x]!==x){ par[x]=par[par[x]]; x=par[x]; } return x; };
  for(let t=0;t<idx.length;t+=3){ for(let j=1;j<3;j++){ const a=find(idx[t]), b=find(idx[t+j]); if(a!==b) par[b]=a; } }
  const isl=new Map(); new Set(idx).forEach(v=>{ const r=find(v); if(!isl.has(r)) isl.set(r,[]); isl.get(r).push(v); });
  isl.forEach(vs=>{
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    vs.forEach(v=>{ const x=uv[v*2]*W, y=uv[v*2+1]*H; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; });
    const cx=(x0+x1)/2, cy=(y0+y1)/2, hx=Math.max((x1-x0)/2,1e-6), hy=Math.max((y1-y0)/2,1e-6);
    const sx=Math.max(0.5,1-delta/hx), sy=Math.max(0.5,1-delta/hy);
    vs.forEach(v=>{ uv[v*2]=((uv[v*2]*W-cx)*sx+cx)/W; uv[v*2+1]=((uv[v*2+1]*H-cy)*sy+cy)/H; });
  });
  return uv;
}
const VS_FLOOR=`
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
const FS_FLOOR=`
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
function ps1Mat(tex,uvScale){
  tex.encoding=THREE.LinearEncoding; tex.generateMipmaps=false;
  tex.minFilter=tex.magFilter=THREE.NearestFilter; tex.needsUpdate=true;
  return new THREE.ShaderMaterial({vertexShader:VS,fragmentShader:FS,side:THREE.DoubleSide,
    uniforms:Object.assign({map:{value:tex},uUvScale:{value:uvScale||1},uTint:{value:new THREE.Vector3(1,1,1)},uShine:{value:0},uBlackNoShine:{value:0},uBlackGrey:{value:0},uMaskNoShine:{value:0},uBlackFlash:{value:0},uEmit:{value:0},uMagma:{value:0},uGem:{value:0},uBladeGlow:{value:0},uOccOn:{value:0}},U)});   // uOccOn: 1 on walls and trees (occMark), which dither away when they are in front of someone
}
function ps1FloorMat(texG,texF,texI,uvScale,H){
  [texG,texF,texI].forEach(tex=>{ tex.encoding=THREE.LinearEncoding; tex.generateMipmaps=false; tex.minFilter=tex.magFilter=THREE.NearestFilter; tex.needsUpdate=true; });
  return new THREE.ShaderMaterial({vertexShader:VS_FLOOR,fragmentShader:FS_FLOOR,side:THREE.DoubleSide,
    uniforms:Object.assign({map:{value:texG},mapFrost:{value:texF},mapIgnis:{value:texI},uUseFrost:{value:1},uFrostZ:{value:-10*H},uIgnisZ:{value:-10*H},uFrostSpan:{value:4.8*H},uUvScale:{value:uvScale||24},uTint:{value:new THREE.Vector3(1,1,1)}},U)});
}

/* ---------- armor tint: multiplies every part of the knight (body, limbs, boots, helmets) except the plume (own color) and the sword (own tint, or matched to the armor) ---------- */
const armorMats=[]; let armorHex=null, armorAmt=0.55;
let shiny=true;   // fake metal shading on the armor and sword (Customize > Shiny metal)
function shineMat(m){ m.uniforms.uShine.value=shiny?1:0; }
const swordMats=[]; let swordHex=null, swordMatch=true;   // the blade has its own tint, or follows the armor's while swordMatch is on
const SHOP_ARMOR_TINT=0.87;   // how strongly the shopkeeper's armor takes its colour (0..1)
function tintMat(m,hex,amt){   // amt: tint strength 0..1 (default: the ARMOR slider's armorAmt)
  shineMat(m);
  const v=m.uniforms.uTint.value; if(!hex){ v.set(1,1,1); return; }
  const c=new THREE.Color(hex), mx=Math.max(c.r,c.g,c.b,1e-4);   // brightest channel = 1, so it recolors without darkening
  const a=amt!==undefined?amt:(m.userData.tintAmt!==undefined?m.userData.tintAmt:armorAmt);   // (a material can carry its own strength in userData.tintAmt)
  v.set(1+(c.r/mx-1)*a, 1+(c.g/mx-1)*a, 1+(c.b/mx-1)*a);
}
function tintArmorMat(m){ tintMat(m,armorHex); }
function applySwordTint(){ swordMats.forEach(m=>tintMat(m,swordMatch?armorHex:swordHex)); }
/* UI THEME: only the title lettering and the rule under a screen's name (the --t-* variables) follow the armor colour. They are blue by default; with an armor colour picked the same palette is repainted in
   that colour's hue (same lightness steps; the saturation follows how colourful the armor is, so grey armor gives grey). Every other window / panel colour (--win-*, --edge, --dim, --ui-*) stays its own blue. */
const UI_THEME=[['--t-hi','#8fa4ff'],['--t-mid','#4558c8'],['--t-lo','#1a2468'],['--t-glow','rgba(130,160,255,.5)'],['--t-rule','#3a4aa8']];
function _uiRgb(c){ let m=/^#?([0-9a-f]{6})$/i.exec(c); if(m){ const n=parseInt(m[1],16); return [n>>16&255,n>>8&255,n&255,1]; } m=/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(c); return m?[+m[1],+m[2],+m[3],+m[4]]:null; }
function _uiHsl(r,g,b){ r/=255; g/=255; b/=255; const mx=Math.max(r,g,b), mn=Math.min(r,g,b), l=(mx+mn)/2; let h=0, s=0; if(mx!==mn){ const d=mx-mn; s=l>0.5?d/(2-mx-mn):d/(mx+mn); h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4; h/=6; } return [h,s,l]; }
function _uiFromHsl(h,s,l){ const f=(p,q,t)=>{ if(t<0) t+=1; if(t>1) t-=1; return t<1/6?p+(q-p)*6*t:t<1/2?q:t<2/3?p+(q-p)*(2/3-t)*6:p; }; if(s<=0){ const v=Math.round(l*255); return [v,v,v]; } const q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q; return [f(p,q,h+1/3),f(p,q,h),f(p,q,h-1/3)].map(x=>Math.round(x*255)); }
function uiThemeApply(){
  const root=document.documentElement.style, c=armorHex&&_uiRgb(armorHex);
  if(!c){ UI_THEME.forEach(t=>root.removeProperty(t[0])); return; }   // no armor colour: the stylesheet's blues
  const a=_uiHsl(c[0],c[1],c[2]), k=a[1]<0.1?0:Math.max(0.25,Math.min(1,a[1]/0.6));   // a grey / white / black armor has no hue to follow: neutral grey panels
  UI_THEME.forEach(t=>{ const b=_uiRgb(t[1]), hs=_uiHsl(b[0],b[1],b[2]), r=_uiFromHsl(a[0],hs[1]*k,hs[2]); root.setProperty(t[0],b[3]<1?'rgba('+r[0]+','+r[1]+','+r[2]+','+b[3]+')':'rgb('+r[0]+','+r[1]+','+r[2]+')'); });
}
function applyArmorTint(){ armorMats.forEach(tintArmorMat); applySwordTint(); uiThemeApply(); }

/* ---------- armor shine: now and then a glint fades in and out on a random spot of the knight's body ---------- */
const bodyMeshes=[]; let shineOn=true, shineSpr=null, shineTex=null, shineCtx=null, shineFrames=null;
const shine={active:false,wait:2,t:0,dur:1.4,fi:-1,obj:null,local:new THREE.Vector3(),size:0.3};
const SHINE_MIN=2.5, SHINE_MAX=7;   // seconds between glints
const SHINE_PX=14;
function makeShineFrames(){   // frames come from glint_silver.gif (2 frames, 500 ms each), embedded as PNGs
  return ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAA4ElEQVR4nI2SMWsDMQyFn8ttsbyHZC7tWij9/2MIZG3pfMftfuqsDopjKyRwD4xtxKdnSU5m2CgzIKV2e9mKdTiAz33nZbVKWqVidJwaVEnfq+J42KfT+WJFMgACAErJIeHUs9BqVZDE98+vAQp36SoSQFeDKhXkH6gOSc4oknE87NOY5NacMUBVkNel7nw6X+wh6HXGp8VnxhoD+PX5kYpkSM4Qua7cgXlZb67TCHqAENlBZBecRCR0NoD3La9UvL+9pnlZrcd8fGkc/f0sH1frX28A2yk9AaKG5mwDmv4BjzN1wEztDgYAAAAASUVORK5CYII=", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAmklEQVR4nKWSQQ7DIAwElyhH7GdU7f8fkyjP8JKze0BEVMFIUfcKs1iDkzsmcQdSGp0sM2yWEDTSjSUE1xCyCqk8Aa2AZDxnBJJEG3PbDxcRqGaoSOrA6tVYrpeMBeQ5qvQGL1X3WPk47oD7NWpt4u1XVTI+79eteP29JKlZ3PbDAUBkrHUopwdU8zOwAb3JPine1XhPgT929Qsha0KoLi6LgAAAAABJRU5ErkJggg=="].map(src=>{
    const c=document.createElement('canvas'); c.width=c.height=SHINE_PX; const img=new Image();
    img.onload=()=>{ c.getContext('2d').drawImage(img,0,0); shine.fi=-1; };   // redraw the sprite once the png has decoded
    img.src=src; return c;
  });
}
function ensureShine(){
  if(shineSpr) return;
  shineFrames=makeShineFrames();
  const cv=document.createElement('canvas'); cv.width=cv.height=SHINE_PX; shineCtx=cv.getContext('2d');
  shineTex=new THREE.CanvasTexture(cv); shineTex.magFilter=shineTex.minFilter=THREE.NearestFilter; shineTex.generateMipmaps=false;
  shineSpr=new THREE.Sprite(new THREE.SpriteMaterial({map:shineTex,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));
  shineSpr.visible=false; shineSpr.renderOrder=10; scene.add(shineSpr);
}
function startShine(){
  ensureShine();
  const meshes=bodyMeshes.filter(m=>m.visible); if(!playerRig||!meshes.length){ shine.wait=1; return; }
  const box=new THREE.Box3(); meshes.forEach(m=>box.expandByObject(m));
  const rc=new THREE.Raycaster(), o=camera.position.clone();
  for(let k=0;k<14;k++){   // aim at random points inside the knight; keep the first one that lands on a visible surface
    const p=new THREE.Vector3(box.min.x+Math.random()*(box.max.x-box.min.x), box.min.y+(0.2+Math.random()*0.75)*(box.max.y-box.min.y), box.min.z+Math.random()*(box.max.z-box.min.z));
    rc.set(o,p.sub(o).normalize());
    const hit=rc.intersectObjects(meshes,false)[0];
    if(hit){
      shine.obj=hit.object; shine.local.copy(hit.object.worldToLocal(hit.point.clone()));   // stuck to that body part, so it follows the animation
      shine.t=0; shine.dur=1.0; shine.fi=-1; shine.active=true;
      shine.size=playerH*(0.09+Math.random()*0.05); shineSpr.scale.set(shine.size,shine.size,1); shineSpr.visible=true; return;
    }
  }
  shine.wait=1;
}
/* ---------- HEAVY COMBO SPARKS: for the last CS_LEAD seconds before the Heavy Combo's finishing blow, bright tinted glints (the knight-shine sprite) fly up off the ground under the sword ---------- */
const CS_LEAD=0.5, CS_RATE=28, CS_BURST=16, CS_POOL=60, CS_GRAV=3.2;   // seconds before the finisher they start, glints per second, the extra burst when the blow lands, sprites in the pool, gravity (knight heights / s²)
const csPool=[], csTex=[null,null]; let csPrevT=-1, csAcc=0, csLive=0;
function csEnsure(){
  ensureShine(); if(csPool.length) return;
  for(let i=0;i<2;i++){ const c=document.createElement('canvas'); c.width=c.height=SHINE_PX; csTex[i]=new THREE.CanvasTexture(c); csTex[i].magFilter=csTex[i].minFilter=THREE.NearestFilter; csTex[i].generateMipmaps=false; }
  for(let i=0;i<CS_POOL;i++){ const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:csTex[0],transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,fog:false})); sp.visible=false; sp.renderOrder=11; scene.add(sp); csPool.push({sp,age:0,life:0,v:new THREE.Vector3(),size:0.1,seed:0}); }
}
function csRefresh(){ csTex.forEach((t,i)=>{ const x=t.image.getContext('2d'); x.clearRect(0,0,SHINE_PX,SHINE_PX); x.drawImage(shineFrames[Math.min(i,shineFrames.length-1)],0,0); t.needsUpdate=true; }); }   // the png frames have decoded by now
const _csA=new THREE.Vector3(), _csB=new THREE.Vector3();
function csSpawn(n){
  const ground=(blobHome?blobHome.y:0)+0.01*playerH; swTip.getWorldPosition(_csB);   // they shoot out of the floor right under the blade's point, where the sword lands
  for(let k=0;k<n;k++){
    const p=csPool.find(q=>q.life<=0); if(!p) return;
    const a=Math.random()*Math.PI*2, hs=(0.5+Math.random()*1.4)*playerH, j=playerH*0.03;
    p.sp.position.set(_csB.x+(Math.random()-0.5)*j*2, ground, _csB.z+(Math.random()-0.5)*j*2);
    p.v.set(Math.cos(a)*hs,(0.9+Math.random()*1.7)*playerH,Math.sin(a)*hs);   // sprayed out in every direction, then they fall back
    p.ground=ground;
    p.age=0; p.life=0.7+Math.random()*0.6; p.size=playerH*(0.12+Math.random()*0.14); p.seed=(Math.random()*2)|0;
    p.sp.material.color.setHSL(Math.random(),1,0.55).multiplyScalar(1.8);   // fully saturated and over-bright: very bright tints
    p.sp.scale.set(p.size,p.size,1); p.sp.visible=true; csLive++;
  }
}
function updateComboSparks(dt){
  const c=current&&current.getClip(), cn=c&&(c.ualSrc||c.name);
  if(cn==='HeavyCombo'&&swTip&&swHilt&&playerRig&&playerRig.visible){
    csEnsure(); const t=current.time, a=HEAVY_COMBO_FINISH_T-CS_LEAD;
    if(csPrevT<0||t<csPrevT){ csAcc=0; csRefresh(); }   // (re)started or looped
    if(t>=a&&t<=HEAVY_COMBO_FINISH_T){ csAcc+=CS_RATE*dt; const n=Math.floor(csAcc); csAcc-=n; csSpawn(n); }
    if(csPrevT>=0&&csPrevT<HEAVY_COMBO_FINISH_T&&t>=HEAVY_COMBO_FINISH_T) csSpawn(CS_BURST);
    csPrevT=t;
  } else csPrevT=-1;
  if(!csLive) return;
  csPool.forEach(p=>{
    if(p.life<=0) return;
    p.age+=dt; if(p.age>=p.life){ p.life=0; p.sp.visible=false; csLive--; return; }
    p.v.y-=CS_GRAV*playerH*dt; p.sp.position.addScaledVector(p.v,dt); if(p.sp.position.y<p.ground){ p.life=0; p.sp.visible=false; csLive--; return; }   // arcs up and back down to the floor
    p.sp.material.opacity=Math.min(1,p.age/0.08,(p.life-p.age)/(p.life*0.5));
    p.sp.material.map=csTex[(Math.floor(p.age/0.09)+p.seed)&1];   // flickers between the two glint frames
  });
}
function updateShine(dt){
  if(shine.active){
    if(!shine.obj.visible) shine.t=Math.max(shine.t,shine.dur-0.2);   // e.g. the helmet it was on got swapped out
    shine.t+=dt;
    if(shine.t>=shine.dur){ shine.active=false; shineSpr.visible=false; shineSpr.material.opacity=0; shine.wait=SHINE_MIN+Math.random()*(SHINE_MAX-SHINE_MIN); return; }
    shineSpr.material.opacity=Math.max(0,Math.min(1,shine.t/0.3,(shine.dur-shine.t)/0.45));   // fade in, then fade out
    const fi=Math.min(shineFrames.length-1,Math.floor(shine.t/shine.dur*shineFrames.length));
    if(fi!==shine.fi){ shine.fi=fi; shineCtx.clearRect(0,0,SHINE_PX,SHINE_PX); shineCtx.drawImage(shineFrames[fi],0,0); shineTex.needsUpdate=true; }
    const p=shine.obj.localToWorld(shine.local.clone());
    p.add(camera.position.clone().sub(p).normalize().multiplyScalar(playerH*0.03));   // nudge toward the camera so the body does not hide it
    shineSpr.position.copy(p);
  } else if(shineOn){ shine.wait-=dt; if(shine.wait<=0) startShine(); }
}
function toggleShine(){
  shineOn=!shineOn;
  if(!shineOn&&shine.active) shine.t=Math.max(shine.t,shine.dur-0.45);   // let a glint in progress fade out
  else if(shineOn&&!shine.active) shine.wait=0.6;
}

/* ---------- state ---------- */
let invCust=false, invGoMenu=null, invHid=[], invOn=false, invK=0, invPrev=null, invCur=0, invUi=null;   // inventory (main menu > INVENTORY)
let editOn=false, editRoll=0;   // (EDIT mode, see editStart: declared up here because showWeapons and the frame loop look at them)
let exploring=false, ps1=true, spin=false, paused=false, mixer=null, actions={}, names=[], menuNames=[], current=null;
let mapMode=false, startScr=false, mapS=0, mapDir=0, mapViewK=1;   // the map (see MAP below): mapS 0 = menu camera ... 3 = the map, mapDir +1 opening / -1 closing / 0 resting, mapViewK 1 = picture shifted right for the menu ... 0 = centered
let yaw=Math.PI+0.65, pitch=0.1, zoom=0.82, baseDist=5, target=new THREE.Vector3();
/* seated pose: Pose2 shows the rock and now and then plays the Pose2_randomevent look-around */
const SEAT_CLIP='Pose2', EVT_CLIP='Pose2_randomevent';
/* the start screen: he sits hunched in Pose3 (the rig's own clip, embedded as pose3-data) under a fixed camera; START goes to the main menu with Pose2. It is night throughout unless OPTIONS > TIME says otherwise */
const START_CLIP='Pose3';
/* The animation menus list ONE entry each for Idle, Swing and Flaunt. When the Axe is the weapon in his hand, that entry plays the axe's own clip
   (AxeIdle / AxeSwing / AxeFlaunt) instead, so those three never get entries of their own. */
const AXE_VARIANT={Idle:'AxeIdle',Swing:'AxeSwing',Flaunt:'AxeFlaunt'}, AXE_BASE={AxeIdle:'Idle',AxeSwing:'Swing',AxeFlaunt:'Flaunt',FlauntIdleAxe:'Flaunt'}, FLAUNT_IDLE='FlauntIdleAxe';   // FlauntIdleAxe: the loop that follows AxeFlaunt; no menu entry of its own, it lights up Flaunt
/* Flip the whole knight left-to-right: every animation, the sword hand, the seated pose and the look-around all swap sides together.
   (The skeleton is not symmetric, so swapping the left/right animation tracks would not line up; mirroring the model does.) Set false for the original handedness. */
const MIRROR_MODEL=true;
/* seat rock: half buried (its middle sits at floor level). Sized and placed so the hips rest on its front slope while both legs stay clear of it.
   ROCK_W / ROCK_D = half-width / half-depth, ROCK_H = height above the floor, ROCK_BACK = how far behind the hips its crown sits */
const ROCK_W=1.2, ROCK_D=0.67, ROCK_H=1.2, ROCK_BACK=0.34;
/* In Pose2 the left foot was tucked right under the hips, exactly where a seat has to go. Bending that knee less (it was 95 degrees)
   moves the foot forward, out of the rock. Set to 95 to get the original pose back (the rock will then clip that foot). */
const LEFT_SHIN_DEG=40;
let rockMesh=null, evtPlaying=false, evtClock=0, evtNext=6, evtDue=false, evtGo=false, evtDone=false;
const SEAT_TAIL=0.583;   // seconds added to the Pose2 loop so it can ease back to its first pose instead of snapping

/* ---------- SNAP: pose-to-pose snappiness for the action clips (the golem's attack feel) ----------
   Keys stay exactly where they are, so every hit time, whoosh and sound that is tied to a key still lines up; only the motion BETWEEN keys changes. In each track the single fastest big move
   is the strike: it eases IN (slow start, arrives hard on its key). Every other big move pops: it finishes in the first SNAP_SPAN of its time and holds. Small moves stay as they were, so
   breathing and settling keep flowing. Loops (Idle, Walk, BlockIdle, the holds) and the shop / seated poses are left alone. Set SNAP_ON=false for the old motion. */
const SNAP_ON=true, SNAP_CLIPS=['Hit','AxeSwing','Flaunt','AxeFlaunt','Block','Death','Drinking_Potion','SwingHeavyWindUp','SwingHeavyRelease'];
const SNAP_ANGLE=0.45, SNAP_MOVE=0.08, SNAP_SPAN=0.6, SNAP_STEPS=6;   // what counts as a big move (radians / units), how much of a segment a pop takes, samples per snapped segment
function snapClip(clip){
  clip.tracks=clip.tracks.map(tr=>{
    const T=Array.from(tr.times), V=Array.from(tr.values), vs=tr.getValueSize(), q=vs===4, n=T.length; if(n<2) return tr;
    const qa=new THREE.Quaternion(), qb=new THREE.Quaternion(), mag=[], sp=[];
    for(let i=0;i<n-1;i++){
      let m; if(q){ qa.fromArray(V,i*4); qb.fromArray(V,(i+1)*4); m=2*Math.acos(Math.min(1,Math.abs(qa.dot(qb)))); }
      else { let d=0; for(let k=0;k<vs;k++){ const x=V[(i+1)*vs+k]-V[i*vs+k]; d+=x*x; } m=Math.sqrt(d); }
      const dur=T[i+1]-T[i], big=m>=(q?SNAP_ANGLE:SNAP_MOVE)&&dur>=0.06; mag.push(big); sp.push(big?m/dur:0);
    }
    let best=-1; sp.forEach((v,i)=>{ if(v>0&&(best<0||v>sp[best])) best=i; });
    if(best<0) return tr;
    const T2=[T[0]], V2=V.slice(0,vs);
    for(let i=0;i<n-1;i++){
      if(mag[i]) for(let k=1;k<SNAP_STEPS;k++){
        const u=k/SNAP_STEPS, w=(i===best)?u*u:1-Math.pow(1-Math.min(1,u/SNAP_SPAN),2);
        T2.push(T[i]+(T[i+1]-T[i])*u);
        if(q){ qa.fromArray(V,i*4); qb.fromArray(V,(i+1)*4); qa.slerp(qb,w); V2.push(qa.x,qa.y,qa.z,qa.w); }
        else for(let c=0;c<vs;c++) V2.push(V[i*vs+c]+(V[(i+1)*vs+c]-V[i*vs+c])*w);
      }
      T2.push(T[i+1]); for(let c=0;c<vs;c++) V2.push(V[(i+1)*vs+c]);
    }
    return new tr.constructor(tr.name,T2,V2,tr.getInterpolation());
  });
  clip.resetDuration();
}

/* ---------- load ---------- */
const raw=(function(){const s=atob(document.getElementById('knight-data').textContent.trim());const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer;})();
/* Hide createImageBitmap so embedded textures load through plain <img> decoding (the sandbox blocks fetch of data: URIs). */
try{ window.createImageBitmap=undefined; }catch(_){}
new THREE.GLTFLoader().parse(raw,'',function(gltf){
  const cache=new Map();
  gltf.scene.traverse(o=>{
    if(!o.isMesh) return;
    const om=o.material;
    if(!cache.has(om.uuid)) cache.set(om.uuid,ps1Mat(om.map,1));
    o.material=cache.get(om.uuid);
    if(o.name!=='Plume'){ bodyMeshes.push(o); if(armorMats.indexOf(o.material)<0) armorMats.push(o.material); }
  });
  armorMats.forEach(shineMat);
  const pl=gltf.scene.getObjectByName('Plume'); if(pl) setupPlume(pl.material);
  if(pl) initHelmets(pl.parent,pl.parent.children.slice());
  const rig=new THREE.Group(); rig.add(gltf.scene); if(MIRROR_MODEL) gltf.scene.scale.x=-1; rig.rotation.y=Math.PI; // model faces -Z; turn him toward the camera
  scene.add(rig); rig.updateMatrixWorld(true); playerRig=rig; knightScene=gltf.scene;
  const box=new THREE.Box3().setFromObject(rig), size=box.getSize(new THREE.Vector3()), ctr=box.getCenter(new THREE.Vector3());
  const H=size.y; target.copy(ctr); playerH=H; homeTarget=ctr.clone();

  // checkered floor
  const cv=document.createElement('canvas'); cv.width=cv.height=2; const g=cv.getContext('2d');
  g.fillStyle='#434d78'; g.fillRect(0,0,2,2); g.fillStyle='#363e63'; g.fillRect(0,0,1,1); g.fillRect(1,1,1,1);
  const ft=new THREE.CanvasTexture(cv); ft.wrapS=ft.wrapT=THREE.RepeatWrapping;
  floorTexClassic=ft; floorTexForest=mkFloorTex('#5aa845','#4a9638'); floorTexFrost=mkFloorTex('#eef4ff','#d8e4f8'); floorTexIgnis=mkFloorTex('#252220','#171514'); floorMat=ps1FloorMat(floorTexForest,floorTexFrost,floorTexIgnis,192,H);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(H*192,H*192,192,192),floorMat);
  floor.rotation.x=-Math.PI/2; floor.position.set(0,box.min.y-H*0.004,-FROST_DIST*H); scene.add(floor); floorMesh=floor;
  const blob=new THREE.Mesh(new THREE.CircleGeometry(H*0.26,10),
    new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.42,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
  blob.rotation.x=-Math.PI/2; blob.position.set(ctr.x,box.min.y+H*0.002,ctr.z); scene.add(blob); blobMesh=blob; blobHome=blob.position.clone();

  U.uFogNear.value=H*2.6; U.uFogFar.value=H*5.2;
  initTrees(H,box.min.y); initRuins(H,box.min.y,ctr); initPointer(); initElemental(); initDgForest(H,box.min.y,ctr); initSky(H,box.min.y); initNight(H,box.min.y); groundYNight=box.min.y; initLeaves(box.min.y); initSnow(H,box.min.y); initRock(gltf.scene,box.min.y); initSword(gltf.scene); initHatchet(gltf.scene); initHammer(gltf.scene); initMorningstar(gltf.scene); initKnightly(gltf.scene); initAxe(gltf.scene); initPotion(gltf.scene); initChest(rig); setWorld(true);
  baseDist=H; resize();

  // animations
  gltf.animations.forEach(a=>{
    if(a.name===SEAT_CLIP||a.name===EVT_CLIP) setLeftShin(a,LEFT_SHIN_DEG);
    if(a.name===SEAT_CLIP) closeLoop(a,a.duration+SEAT_TAIL); else if(a.name===EVT_CLIP) closeLoop(a,a.duration);
  });
  /* Death: the old Idle2 clip (hips drop, he folds forward and stays down), embedded as death-data and added next to the model's own clips.
     Track targets use the same node names the loader gave the existing clips (the model has two nodes called Head, so the loader renames one). */
  (function(){
    const el=document.getElementById('death-data'); if(!el) return;
    const D=JSON.parse(el.textContent), base={};
    gltf.animations.forEach(a=>a.tracks.forEach(t=>{ const b=t.name.slice(0,t.name.lastIndexOf('.')); base[b.replace(/_\d+$/,'')]=b; }));
    const tr=D.tracks.map(k=>{ const b=base[k.n]||k.n; return k.p==='q'?new THREE.QuaternionKeyframeTrack(b+'.quaternion',k.t,k.v):new THREE.VectorKeyframeTrack(b+'.position',k.t,k.v); });
    gltf.animations.push(new THREE.AnimationClip(D.name,-1,tr));
  })();
  /* AxeIdle (the axe's idle) and AxeSwing (its swing, the rig's Swing3): embedded as axeidle-data / axeswing-data and added exactly like Death above.
     They are used whenever the Axe is the chosen weapon; the sword keeps Idle and Swing. */
  ['axeidle-data','axeswing-data','axeflaunt-data','flauntidleaxe-data','drinkpotion-data','pose3-data','dance-data','dance2-data','dance3-data','pizza-data','shopidle-data','shopidleanimation1-data','shopintotalk-data','shopoutrotalk-data','shopwhiletalking-data','block-data','blockidle-data','swingheavywindup-data','swingheavyturnhold-data','swingheavyrelease-data','swing2-data'].forEach(function(id){
    const el=document.getElementById(id); if(!el) return;
    const D=JSON.parse(el.textContent), base={};
    if((id==='axeswing-data'&&AXE_SWING_REVERSE)||D.rev){   // play the swing backwards: keyframes in reverse order, times counted from the end
      let T=0; D.tracks.forEach(k=>{ T=Math.max(T,k.t[k.t.length-1]); });
      D.tracks.forEach(k=>{ const n=k.p==='q'?4:3, c=k.t.length, v=[]; for(let i=c-1;i>=0;i--) for(let j=0;j<n;j++) v.push(k.v[i*n+j]); k.t=k.t.map(x=>T-x).reverse(); k.v=v; });
    }
    gltf.animations.forEach(a=>a.tracks.forEach(t=>{ const b=t.name.slice(0,t.name.lastIndexOf('.')); base[b.replace(/_\d+$/,'')]=b; }));
    const tr=D.tracks.map(k=>{ const b=base[k.n]||k.n; return k.p==='q'?new THREE.QuaternionKeyframeTrack(b+'.quaternion',k.t,k.v):new THREE.VectorKeyframeTrack(b+'.position',k.t,k.v); });
    if(id==='block-data'){ const old=gltf.animations.findIndex(a=>a.name==='Block'); if(old>=0) gltf.animations.splice(old,1); }   // the new Block replaces the rig's own
    if(id==='swing2-data'){ const old=gltf.animations.findIndex(a=>a.name==='Swing'); if(old>=0) gltf.animations.splice(old,1); }   // Swing2 (from the rig) replaces the knight's own Swing; it keeps the name Swing so everything keyed on it still works
    gltf.animations.push(new THREE.AnimationClip(D.name,-1,tr));
  });
  /* Chestopen: the rig's own chest-opening clip (embedded below as CHESTOPEN_CLIP, same track format as the other embedded clips). It lists itself in the animation menus; the chest it opens is built in initChest. */
  { const base={}; gltf.animations.forEach(a=>a.tracks.forEach(t=>{ const b=t.name.slice(0,t.name.lastIndexOf('.')); base[b.replace(/_\d+$/,'')]=b; }));
    [CHESTOPEN_CLIP].forEach(D=>gltf.animations.push(new THREE.AnimationClip(D.name,-1,D.tracks.map(k=>{ const b=base[k.n]||k.n; return k.p==='q'?new THREE.QuaternionKeyframeTrack(b+'.quaternion',k.t,k.v):new THREE.VectorKeyframeTrack(b+'.position',k.t,k.v); })))); }
  /* UAL: clips from Quaternius' Universal Animation Library, retargeted onto this rig offline (ual-data: arms and legs aimed by direction, hips / torso / head by world rotation, feet kept on the ground).
     They are added next to the knight's own clips as UAL_*; ANIM SET in the options plays them in place of Idle / Walk / Swing / Hit / Block ... (see UAL_ALT). */
  (function(){
    const el=document.getElementById('ual-data'); if(!el) return;
    const U=JSON.parse(el.textContent), base={};
    gltf.animations.forEach(a=>a.tracks.forEach(t=>{ const b=t.name.slice(0,t.name.lastIndexOf('.')); base[b.replace(/_\d+$/,'')]=b; }));
    U.clips.forEach(D=>{ const tr=D.tracks.map(k=>{ const b=base[k.n]||k.n; return k.p==='q'?new THREE.QuaternionKeyframeTrack(b+'.quaternion',k.t,k.v):new THREE.VectorKeyframeTrack(b+'.position',k.t,k.v); }); gltf.animations.push(new THREE.AnimationClip(D.name==='UAL_Sword_Heavy_Combo'?'HeavyCombo':D.name,-1,tr)); });
    /* UALX_ConsumeM: UAL_Consume mirrored left <-> right (the UAL drinks with its right hand, the potion is in his left). Left and right bones swap tracks, rotations are mirrored across x (x,-y,-z,w),
       and the hips' / head's sideways position is negated. The static 'rest offset' position tracks of the arms / torso are left alone. Used by the inventory's ITEMS inspection (see invDrink). */
    (function(){ const D=U.clips.find(c=>c.name==='UAL_Consume'); if(!D) return;
      const sw=n=>n.replace(/^(Left|Right)_/,(m,a)=>a==='Left'?'Right_':'Left_'), tr=[];
      D.tracks.forEach(k=>{
        if(k.p==='q'){ const v=[]; for(let i=0;i<k.v.length;i+=4) v.push(k.v[i],-k.v[i+1],-k.v[i+2],k.v[i+3]); const n=sw(k.n); tr.push(new THREE.QuaternionKeyframeTrack((base[n]||n)+'.quaternion',k.t,v)); }
        else if(k.n==='Root_Hips'||k.n==='Head'){ const v=k.v.slice(); for(let i=0;i<v.length;i+=3) v[i]=-v[i]; tr.push(new THREE.VectorKeyframeTrack((base[k.n]||k.n)+'.position',k.t,v)); }
        else tr.push(new THREE.VectorKeyframeTrack((base[k.n]||k.n)+'.position',k.t,k.v));
      });
      gltf.animations.push(new THREE.AnimationClip('UALX_ConsumeM',-1,tr)); })();   // (the heavy combo is just called HeavyCombo: it is not one of the hidden UAL_ clips)
  })();
  /* EDIT: six still poses (Mixamo poses, retargeted onto this rig offline: editposes-data). They are hidden from the menus (UALX_) and only used by the EDIT mode (see editStart). */
  (function(){
    const el=document.getElementById('editposes-data'); if(!el) return;
    const E=JSON.parse(el.textContent), base={};
    gltf.animations.forEach(a=>a.tracks.forEach(t=>{ const b=t.name.slice(0,t.name.lastIndexOf('.')); base[b.replace(/_\d+$/,'')]=b; }));
    E.clips.forEach(D=>{ const tr=D.tracks.map(k=>{ const b=base[k.n]||k.n; return k.p==='q'?new THREE.QuaternionKeyframeTrack(b+'.quaternion',k.t,k.v):new THREE.VectorKeyframeTrack(b+'.position',k.t,k.v); }); gltf.animations.push(new THREE.AnimationClip(D.name,-1,tr)); });
  })();
  { [START_CLIP,'ShopIdle','ShopIdleAnimation1','ShopIdleAnimationIntoTalk','ShopIdleAnimationOutroTalk','ShopIdleAnimationWhileTalking'].forEach(cn=>{ const p3=gltf.animations.find(a=>a.name===cn); if(p3) setLeftShin(p3,LEFT_SHIN_DEG); }); }   // Pose3 shares Pose2's legs, so it gets the same tweak and sits on the same rock. Its head is left as authored; the occasional look at the sky is added on top, see headLook()
  /* AxeFlaunt is the rig's own "animation" clip, played exactly as authored (arms, body, legs and head are not touched). Only the axe moves: it rests on his back, see AXE_STOW_CLIPS. */
  mixer=new THREE.AnimationMixer(gltf.scene);
  const order=['Idle','AxeIdle','Walk','Swing','AxeSwing','AxeFlaunt','Hit','Death'];
  names=order.filter(n=>gltf.animations.some(a=>a.name===n)).concat(gltf.animations.map(a=>a.name).filter(n=>!order.includes(n)&&n!==EVT_CLIP));
  menuNames=names.filter(n=>!AXE_BASE[n]&&n!==START_CLIP&&!/^UALX_/.test(n));   // what the menus list: the axe variants are folded into Idle / Swing / Flaunt, and the start-screen pose (Pose3) is not an animation to browse
  { const gi={enemies:0,self:1,shop:2}; menuNames=menuNames.map((n,i)=>[n,i]).sort((a,b)=>gi[animGroup(a[0])]-gi[animGroup(b[0])]||a[1]-b[1]).map(x=>x[0]); }   // grouped in the order the ANIMATIONS menu shows them (so the cycle keys follow it too)
  if(SNAP_ON) gltf.animations.forEach(a=>{ if(SNAP_CLIPS.includes(a.name)) snapClip(a); });   // see SNAP
  gltf.animations.forEach(a=>{actions[a.name]=mixer.clipAction(a);});
  try{ ualApply(); }catch(e){ console.error(e); }   // the default ANIM SET (IDEAL) takes effect from the start
  mixer.addEventListener('finished',e=>{ if(e.action===actions[EVT_CLIP]) evtDone=true; else if(e.action===actions.Swing||e.action===actions.AxeSwing) swingDone=true; else if(e.action===actions.AxeFlaunt&&e.action===current) flauntDone=true; else if(e.action===actions.Chestopen&&chestScene) chestDone=true; });
  mixer.addEventListener('loop',e=>{ if(evtDue&&e.action===current&&e.action.getClip().name===SEAT_CLIP) evtGo=true; });
  mixer.addEventListener('loop',e=>{ const n=e.action.getClip().name; if(e.action===current&&ANIM_SFX_LOOPS[n]) ANIM_SFX[n](); });
  buildMenu(); play(names.indexOf(START_CLIP)>=0?START_CLIP:(names.indexOf(SEAT_CLIP)>=0?SEAT_CLIP:names[0])); initMainMenu();
  setNight(true);   // night is the default look
  if(actions[START_CLIP]){ startCam(); syncRockMeshes(); }   // the start screen's low camera; he sits in Pose3 without the rock
},function(e){console.error(e);const el=document.getElementById('err');el.textContent='Could not load the model: '+String((e&&e.message)||e).slice(0,160);el.style.display='block';});

/* ---------- plume color ---------- */
const plumes=[]; let plumeHex=null;
function toHsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2;let h=0,s=0;
  if(mx!==mn){const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;h/=6;}return [h,s,l];}
function fromHsl(h,s,l){const f=n=>{const k=(n+h*12)%12,a=s*Math.min(l,1-l);return (l-a*Math.max(-1,Math.min(k-3,9-k,1)))*255;};return [f(0),f(8),f(4)];}
function setupPlume(m){
  const img=m.uniforms.map.value.image; if(!img) return;
  const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
  const ctx=c.getContext('2d'); ctx.drawImage(img,0,0);
  const base=ctx.getImageData(0,0,c.width,c.height);
  let sum=0,n=0; const d=base.data;
  for(let i=0;i<d.length;i+=4){ if(d[i+3]>127){ sum+=toHsl(d[i],d[i+1],d[i+2])[2]; n++; } }
  const tex=new THREE.CanvasTexture(c); tex.flipY=false; tex.encoding=THREE.LinearEncoding;
  tex.generateMipmaps=false; tex.minFilter=tex.magFilter=THREE.NearestFilter;
  m.uniforms.map.value=tex;
  const pl={tex,ctx,base,avgL:n?sum/n:0.6};
  if(!plumes.length) buildPlumeUI();
  plumes.push(pl); if(plumeHex) tintOne(pl,plumeHex);
}
function tintOne(pl,hex){
  const out=pl.ctx.createImageData(pl.base.width,pl.base.height); out.data.set(pl.base.data);
  if(hex){
    const [th,ts,tl]=toHsl(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16))), d=out.data;
    for(let i=0;i<d.length;i+=4){
      if(d[i+3]<128) continue;
      const l=toHsl(d[i],d[i+1],d[i+2])[2];
      const c=fromHsl(th,ts,Math.max(0,Math.min(1,tl+(l-pl.avgL))));
      d[i]=c[0]; d[i+1]=c[1]; d[i+2]=c[2];
    }
  }
  pl.ctx.putImageData(out,0,0); pl.tex.needsUpdate=true;
}
function tintPlume(hex){ plumeHex=hex; plumes.forEach(pl=>tintOne(pl,hex)); }

/* ---------- world: forest / classic ---------- */
let night=false, forest=true, mapArea='greenfield', floorMat=null, floorTexClassic=null, floorTexForest=null, floorTexFrost=null, floorTexIgnis=null, treeGroup=null, greenTreeGroup=null, frostTreeGroup=null, ignisTreeGroup=null;
const SKY_CLASSIC=0x232a4a, SKY_FOREST=0x6ca8e6;
function mkFloorTex(c1,c2){
  const cv=document.createElement('canvas'); cv.width=cv.height=2; const g=cv.getContext('2d');
  g.fillStyle=c1; g.fillRect(0,0,2,2); g.fillStyle=c2; g.fillRect(0,0,1,1); g.fillRect(1,1,1,1);
  const t=new THREE.CanvasTexture(cv); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.encoding=THREE.LinearEncoding;
  t.generateMipmaps=false; t.minFilter=t.magFilter=THREE.NearestFilter; return t;
}
const IGNIS_DIST=52;   // Ignis Mourne sits another FROST_DIST north of The Veiled Frost
const FROST_DIST=26;   // how far north (-Z, in knight-heights) The Veiled Frost sits from The Greenfield
let mapAreaK=0, mapAreaTarget=0; const mapAreaV={v:0};   // 0 = The Greenfield, 1 = The Veiled Frost, 2 = Ignis Mourne; smoothly glides between them
let greenRockMesh=null, frostRockMesh=null, ignisRockMesh=null, spareGreenRock=null, spareFrostRock=null, spareIgnisRock=null;
const AREA_FOG={frost:new THREE.Color(0xcfd4da), ignis:new THREE.Color(0xe8761e)};   // The Veiled Frost: a greyish white - Ignis Mourne: a hellish orange-yellow (dimmer at night)
const AREA_FOG_MIX=0.7;   // how strongly the area colours take over the normal sky colour (1 = fully, 0 = not at all)
const _fogC=new THREE.Color(), _fogB=new THREE.Color(); let fogBase=SKY;
function setSkyFog(hex){ fogBase=hex; applyAreaFog(); }
function applyAreaFog(){   // the usual sky colour, pulled toward the area's colour as the map glides there, and back again when you leave
  const kf=Math.min(Math.max(mapAreaK,0),1)*AREA_FOG_MIX, ki=Math.min(Math.max(mapAreaK-1,0),1)*AREA_FOG_MIX, dim=night?0.3:1;
  _fogC.setHex(fogBase); _fogB.copy(AREA_FOG.frost).multiplyScalar(dim); _fogC.lerp(_fogB,kf); _fogB.copy(AREA_FOG.ignis).multiplyScalar(dim); _fogC.lerp(_fogB,ki);
  renderer.setClearColor(_fogC); U.uFogColor.value.copy(_fogC);
}
function areaTrees(a){ return (a==='ignis'&&ignisTreeGroup)?ignisTreeGroup:(a==='frost'&&frostTreeGroup)?frostTreeGroup:greenTreeGroup; }
function areaZOffset(area){ const a=area||mapArea; return (a==='frost'?-FROST_DIST:a==='ignis'?-IGNIS_DIST:0)*(playerH||2.2); }
function syncFrostBlend(){
  if(!floorMat||!floorMat.uniforms.uFrostZ) return;
  const H=playerH||2.2;
  floorMat.uniforms.uUseFrost.value=forest?1:0;
  // Border sits halfway between The Greenfield (z = 0) and The Veiled Frost (z = -FROST_DIST*H), at z = -10*H
  const kF=Math.min(mapAreaK,1), kI=Math.max(0,mapAreaK-1);
  floorMat.uniforms.uFrostZ.value=-0.5*FROST_DIST*H+(kF-0.5)*2.0*H;
  floorMat.uniforms.uIgnisZ.value=-1.5*FROST_DIST*H+(kI-0.5)*2.0*H;   // the border between The Veiled Frost and Ignis Mourne
  floorMat.uniforms.uFrostSpan.value=4.2*H;
}
function syncRockMeshes(){
  const onSeat=!!(current&&current.getClip().name===SEAT_CLIP), A=mapArea, sp=forest&&!dungeon;
  if(greenRockMesh) greenRockMesh.visible=onSeat&&A==='greenfield';
  if(frostRockMesh) frostRockMesh.visible=onSeat&&A==='frost';
  if(ignisRockMesh) ignisRockMesh.visible=onSeat&&A==='ignis';
  if(spareGreenRock) spareGreenRock.visible=sp&&A!=='greenfield';
  if(spareFrostRock) spareFrostRock.visible=sp&&A!=='frost';
  if(spareIgnisRock) spareIgnisRock.visible=sp&&A!=='ignis';
}
function moveKnightToArea(area){
  if(!playerRig||exploring||dungeon) return;
  const zOff=areaZOffset(area), dx=target.x-(homeTarget.x+playerRig.position.x), dz=target.z-(homeTarget.z+playerRig.position.z);
  playerRig.position.set(0,0,zOff);
  if(blobMesh&&blobHome) blobMesh.position.set(blobHome.x,blobHome.y,blobHome.z+zOff);
  if(floorMesh) floorMesh.position.set(0,floorMesh.position.y,-FROST_DIST*(playerH||2.2));
  target.set(homeTarget.x+dx,target.y,homeTarget.z+zOff+dz);
  syncRockMeshes();
}
function setWorld(f){
  forest=f; const sky=night?SKY_NIGHT:(f?SKY_FOREST:SKY_CLASSIC);
  setSkyFog(sky);
  document.documentElement.style.setProperty('--sky','#'+sky.toString(16).padStart(6,'0'));
  if(floorMat){ floorMat.uniforms.map.value=f?floorTexForest:floorTexClassic; syncFrostBlend(); }
  treeGroup=areaTrees(mapArea);
  if(ignisTreeGroup) ignisTreeGroup.visible=f&&!dungeon;
  if(greenTreeGroup) greenTreeGroup.visible=f&&!dungeon;
  if(hillGroup) hillGroup.visible=f&&!dungeon;
  if(mountainGroup) mountainGroup.visible=f&&!dungeon;
  if(frostTreeGroup) frostTreeGroup.visible=f&&!dungeon;
  if(skyGroup) skyGroup.visible=!f&&!night;
  setSwitch('world',f,f?'Forest':'Classic');
}
document.getElementById('world').onclick=()=>setWorld(!forest);
/* ---------- night: a dark blue sky and fog, every surface dimmed and tinted, stars and a moon ----------
   It is on all the time; OPTIONS > TIME switches it to day. NIGHT_TINT is what every surface is multiplied by, NIGHT_FOG the fog near / far in knight-heights (closer than by day,
   so the dark closes in). setNight only changes the look - where the camera sits is startCam() (the start screen) and menuCam() (the main menu). */
const SKY_NIGHT=0x0a0f2a, NIGHT_TINT=[0.45,0.52,0.82], NIGHT_FOG=[1.9,4.2], NIGHT_STARS=240;
const START_CAM_YAW=Math.PI+0.55, START_CAM_PITCH=-0.52, START_CAM_ZOOM=0.28, START_TARGET_Y=0.38;
let nightGroup=null, nightStars=null, nightMoon=null, nightFogDay=null;
function startCam(){ const zOff=areaZOffset(); yaw=START_CAM_YAW; pitch=START_CAM_PITCH; zoom=START_CAM_ZOOM; target.set(homeTarget.x, homeTarget.y+playerH*START_TARGET_Y, homeTarget.z+zOff); }   // low and close, looking up at him
function menuCam(){ const zOff=areaZOffset(); yaw=Math.PI+0.65; pitch=0.1; zoom=0.82; target.set(homeTarget.x, homeTarget.y, homeTarget.z+zOff); }                                                 // the usual menu view
let fogT=5;   // OPTIONS > WORLD > FOG: 1 (thin) .. 9 (thick); 5 = the normal fog
const fogRec={base:null,set:null};
function applyFogThickness(){
  if(mapMode||dungeon||shopT>=0||fogBak) return;
  const n=U.uFogNear.value, f=U.uFogFar.value;
  if(!fogRec.base||!fogRec.set||n!==fogRec.set[0]||f!==fogRec.set[1]) fogRec.base=[n,f];
  const s=Math.pow(1.3,5-fogT), nn=fogRec.base[0]*s, ff=fogRec.base[1]*s;
  U.uFogNear.value=nn; U.uFogFar.value=ff; fogRec.set=[nn,ff];
}
function setNight(on){
  night=on; const sky=night?SKY_NIGHT:(forest?SKY_FOREST:SKY_CLASSIC);
  setSkyFog(sky);
  document.documentElement.style.setProperty('--sky','#'+sky.toString(16).padStart(6,'0'));
  U.uNight.value.set(on?NIGHT_TINT[0]:1,on?NIGHT_TINT[1]:1,on?NIGHT_TINT[2]:1);
  if(on){
    if(!nightFogDay) nightFogDay=[U.uFogNear.value,U.uFogFar.value];
    U.uFogNear.value=playerH*NIGHT_FOG[0]; U.uFogFar.value=playerH*NIGHT_FOG[1];
  } else if(nightFogDay){ U.uFogNear.value=nightFogDay[0]; U.uFogFar.value=nightFogDay[1]; nightFogDay=null; }
  if(nightGroup) nightGroup.visible=on;
  if(skyGroup) skyGroup.visible=!forest&&!on;
}
/* ---------- the start screen's sky marks: where the moon and the comet go ----------
   SKY_REF is the window size the marks were drawn on (a screenshot of the start screen), SKY_MOON_PX the middle of the red circle (the moon), COMET.from / COMET.to the two ends of the white
   arrow (the comet's path). startSkyRay turns a pixel of that screenshot into a ray through the start camera (the camera's own numbers, plus the picture being shifted right
   for the menu), and skyHit finds where the ray meets a sphere around the sky's centre. */
const SKY_REF={w:1536,h:749}, SKY_MOON_PX=[1377,186];
function startSkyRay(px,py){
  const H=playerH, T=new THREE.Vector3(homeTarget.x,homeTarget.y+H*START_TARGET_Y,homeTarget.z);
  const fit=H/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.5, d=fit*START_CAM_ZOOM, cp=Math.cos(START_CAM_PITCH);
  const C=new THREE.Vector3(T.x+d*Math.sin(START_CAM_YAW)*cp, T.y+d*Math.sin(START_CAM_PITCH), T.z+d*Math.cos(START_CAM_YAW)*cp);
  const f=T.clone().sub(C).normalize(), right=new THREE.Vector3().crossVectors(f,new THREE.Vector3(0,1,0)).normalize(), up=new THREE.Vector3().crossVectors(right,f);
  const tv=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)), asp=SKY_REF.w/SKY_REF.h;
  const nx=((px-0.2*SKY_REF.w)/SKY_REF.w)*2-1, ny=1-2*py/SKY_REF.h;      // the start picture sits 0.2 of the width to the right of centre (see applyView)
  return {C:C, dir:f.add(right.multiplyScalar(nx*tv*asp)).add(up.multiplyScalar(ny*tv)).normalize()};
}
function skyHit(o,dir,r){   // o = ray origin relative to the sky's centre; the point where it leaves a sphere of radius r around that centre
  const b=dir.dot(o), c=o.lengthSq()-r*r, s=-b+Math.sqrt(Math.max(0,b*b-c));
  return o.clone().add(dir.clone().multiplyScalar(s));
}
/* ---------- the comet ----------
   It crosses the sky along the white arrow (from -> to, pixels of the SKY_REF window), then is gone. It comes at random: `perMinute` is the average, the gap between two comets is
   anywhere from half to one and a half times 60/perMinute seconds (so 4 a minute means one every 7.5 - 22.5 s, 15 s on average), and the first one turns up after 4 - 10 s.
   new_comet.gif is a comet whose tail burns away frame by frame while its head stays put, so the flight (which fades smoothly in at the start and out at the end, COMET.fadeIn / fadeOut) plays frame 1 (full tail) for `hold` seconds and then runs the other
   frames at the gif's own 170 ms, arriving at the end of the arrow just as only the head is left, which then disappears. The sprite turns to follow the path on screen, so the tail
   always trails behind it, whichever way you are looking. It only exists while the night sky does. */
const COMET={perMinute:4,from:[770,47],to:[468,182],hold:0.78,frameMs:170,frames:7,sizeDeg:6.5,fadeIn:0.45,fadeOut:0.55,head:[3.5,28.5],headDeg:-136.5,png:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAOAAAAAgCAYAAAALxXRVAAAB1klEQVR42u2ZsUoDQRRF3wRBTBob/8P9CK0tBJEtFCEIdn6JnSBpbJY0Ftb6EfE/bGwSsXEtZMO6TIKIeXfYOecHzmb33bkzEzMAAAAAAACADTF5ea15CwCED4DwAUDPw0f4gfARPgDCB0D4CB/A5gY/9/ARfiB8hA9yDJ9yAAkfED6aF+DXhP8cuvH+XlANvbe7+wwqP2TeeotZJWmftl/5DpR+MzO1HwQNmFLzqdpH3Xw0bz8Y/OXDl/WTNHxKfwqt0/hV4aN1BQ0Y22bm1nw077ef1nVuwOajq5qnOe/l3Lzt8ybNlxHdyxbvCxe1vz38yr9ZlP6Utt19Yyv15kvNr9huqvyx5geHM2Dsw1fh0C0Aq/ze4cvZ326dYVHKznyLWVUr/e4NGFvxvMMX83sN39IvHP7FrKpNHL6ULl76fPETCN/6s0Zu/u4zKNpH7ZcE8OTsot4dfZqZ2c34wD18q/xew4c/Lf+wKINn87X9d7f3bqEfmJkdHZ/+WHWvJ8+ulx7r/B6k6vcavph/WJRB6Vf+/sur89o1gA1v84F065OS33MAV/m9t0Ntv4Ic/ctLmI/5u22PdpYP4T18qfm9wZ+nP8Rq+PFh6r764sefsx8ABHwB0QhLivJbZsEAAAAASUVORK5CYII='};   // head = the head's pixel in each 32x32 frame; headDeg = the way the head travels inside the gif (y up)
let comet=null, cometAge=-1, cometWait=4+Math.random()*6, cometA=null, cometB=null, cometO=null, cometR=0;
const _cp1=new THREE.Vector3(), _cp2=new THREE.Vector3(), _cd=new THREE.Vector3();
function cometAt(t,out){ _cd.copy(cometA).lerp(cometB,t).normalize(); return out.copy(skyHit(cometO,_cd,cometR)); }   // straight on the start screen: the ray is blended between the two ends
function initComet(H,groundY,grp,R){
  const A=startSkyRay(COMET.from[0],COMET.from[1]), B=startSkyRay(COMET.to[0],COMET.to[1]);
  cometR=R*0.88; cometA=A.dir.clone(); cometB=B.dir.clone(); cometO=A.C.clone().sub(new THREE.Vector3(homeTarget.x,groundY,homeTarget.z));
  loadImg(COMET.png).then(img=>{
    const t=new THREE.Texture(img); t.magFilter=t.minFilter=THREE.NearestFilter; t.generateMipmaps=false; t.repeat.set(1/COMET.frames,1); t.needsUpdate=true;
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,alphaTest:0.05,opacity:0,depthWrite:false,fog:false}));
    const size=2*cometR*Math.tan(THREE.MathUtils.degToRad(COMET.sizeDeg/2));
    sp.scale.set(size,size,1); sp.center.set(COMET.head[0]/32,1-COMET.head[1]/32);   // placed and turned about the comet's head, not the middle of the picture
    sp.visible=false; sp.renderOrder=4; sp.frustumCulled=false; grp.add(sp); comet=sp;
  }).catch(e=>console.error('comet failed',e));
}
function updateComet(dt){
  if(!comet) return;
  if(cometAge<0){ cometWait-=dt; if(cometWait>0) return; cometAge=0; comet.visible=true; }
  cometAge+=dt;
  const age=ps1?Math.floor(cometAge*15)/15:cometAge, total=COMET.hold+(COMET.frames-1)*COMET.frameMs/1000;   // steps at 15 fps in the PS1 look, like the rest
  if(age>=total){ comet.visible=false; cometAge=-1; const mean=60/COMET.perMinute; cometWait=mean*(0.5+Math.random()); return; }
  const t=age/total, fr=age<COMET.hold?0:Math.min(COMET.frames-1,1+Math.floor((age-COMET.hold)/(COMET.frameMs/1000)));
  cometAt(t,comet.position);
  comet.material.map.offset.x=fr/COMET.frames;
  const fi=Math.min(1,cometAge/COMET.fadeIn), fo=Math.min(1,Math.max(0,(total-cometAge)/COMET.fadeOut));   // the fade runs on real time (not the 15 fps steps) so it is smooth: in over `fadeIn` seconds, out over the last `fadeOut`
  comet.material.opacity=fi*fi*(3-2*fi)*fo*fo*(3-2*fo);
  // turn it to follow its path as seen from the camera right now
  cometAt(Math.min(1,t+0.03),_cp2); _cp1.copy(comet.position).add(nightGroup.position).project(camera); _cp2.add(nightGroup.position).project(camera);
  comet.material.rotation=Math.atan2(_cp2.y-_cp1.y,(_cp2.x-_cp1.x)*camera.aspect)-THREE.MathUtils.degToRad(COMET.headDeg);
}
function initNight(H,groundY){
  const grp=new THREE.Group(), R=Math.min(H*50,150); let sd=909; const rnd=()=>{ sd=(sd+0x6D2B79F5)|0; let t=Math.imul(sd^(sd>>>15),1|sd); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };   // fixed seed: the same sky every time
  const pos=new Float32Array(NIGHT_STARS*3), col=new Float32Array(NIGHT_STARS*3);
  for(let i=0;i<NIGHT_STARS;i++){
    const az=rnd()*Math.PI*2, el=(5+Math.pow(rnd(),0.8)*78)*Math.PI/180, b=0.45+rnd()*0.55;
    pos[i*3]=Math.cos(az)*Math.cos(el)*R; pos[i*3+1]=Math.sin(el)*R; pos[i*3+2]=Math.sin(az)*Math.cos(el)*R;
    col[i*3]=b*0.9; col[i*3+1]=b*0.95; col[i*3+2]=b;
  }
  const sg=new THREE.BufferGeometry(); sg.setAttribute('position',new THREE.BufferAttribute(pos,3)); sg.setAttribute('color',new THREE.BufferAttribute(col,3));
  nightStars=new THREE.Points(sg,new THREE.PointsMaterial({size:1.7,sizeAttenuation:false,vertexColors:true,fog:false,depthWrite:false})); nightStars.frustumCulled=false; grp.add(nightStars);
  /* the moon: up in the sky exactly where the red circle was drawn on the start screen (SKY_MOON_PX, in pixels of a SKY_REF-sized window), with a soft halo.
     The spot is found by sending a ray through that pixel of the start camera and putting the moon where the ray meets the sky dome, so it sits in the same place relative to
     him on any screen size that has the same shape; on a very different shape it shifts, like anything that really is in the sky. */
  const MR=R*0.9, moonRay=startSkyRay(SKY_MOON_PX[0],SKY_MOON_PX[1]), G=new THREE.Vector3(homeTarget.x,groundY,homeTarget.z);
  const moon=new THREE.Group(); moon.position.copy(skyHit(moonRay.C.clone().sub(G),moonRay.dir,MR));
  const halo=new THREE.Mesh(new THREE.CircleGeometry(H*5.5,20),new THREE.MeshBasicMaterial({color:0x7f93d9,transparent:true,opacity:0.16,depthWrite:false,fog:false}));
  const disc=new THREE.Mesh(new THREE.CircleGeometry(H*3.2,18),new THREE.MeshBasicMaterial({color:0xe6ecff,fog:false}));
  halo.position.z=-0.05; moon.add(halo); moon.add(disc); moon.frustumCulled=false; grp.add(moon); nightMoon=moon;
  initComet(H,groundY,grp,R);
  grp.visible=night; scene.add(grp); nightGroup=grp;
}
function updateNight(dt){
  if(!nightGroup||!nightGroup.visible) return;
  nightGroup.position.set(target.x,groundYNight,target.z);      // rides along with the camera, so the sky never gets closer
  nightStars.rotation.y+=dt*0.006;                                // the stars turn very slowly
  nightMoon.lookAt(camera.position);
  updateComet(dt);
}
let groundYNight=0;

function buildTreeGroup(TD,H,groundY,vis){
  return Promise.all(TD.map(p=>loadImg(p.tex))).then(imgs=>{
    const protos=TD.map((p,k)=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2));
      geo.setIndex(p.i);
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
      return {name:p.name,t:p.t,geo,mat:ps1Mat(tex,1)};
    });
    const grp=new THREE.Group(); grp.visible=vis;
    // [angle deg, distance in knight-heights, scale, yaw deg]; they sit in the fog band so distance fades them out
    [[20,2.6,1.0,10],[75,3.1,1.15,80],[130,2.4,0.9,200],[185,3.4,1.1,35],[240,2.8,1.0,120],[300,3.3,0.95,300],[340,2.5,1.2,160]].forEach(([a,r,s,yw])=>{
      const tr=new THREE.Group(), ar=a*Math.PI/180;
      tr.position.set(Math.cos(ar)*r*H,groundY,Math.sin(ar)*r*H); tr.scale.setScalar(s); tr.rotation.y=yw*Math.PI/180;
      protos.forEach(pr=>{
        const m=new THREE.Mesh(pr.geo,pr.mat); m.position.set(pr.t[0],pr.t[1],pr.t[2]);
        tr.add(m);
      });
      grp.add(tr);
    });
    /* extra forest for walking around: scattered with a fixed seed so it is the same every visit */
    let sd=12345; const rnd=()=>{ sd=(sd+0x6D2B79F5)|0; let t=Math.imul(sd^(sd>>>15),1|sd); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
    for(let n=0;n<90;n++){
      const ar=rnd()*Math.PI*2, r=Math.sqrt(1.9*1.9+rnd()*(11.5*11.5-1.9*1.9)), sc=0.85+rnd()*0.45, tr=new THREE.Group();
      tr.position.set(Math.cos(ar)*r*H,groundY,Math.sin(ar)*r*H); tr.scale.setScalar(sc); tr.rotation.y=rnd()*Math.PI*2;
      protos.forEach(pr=>{ const m=new THREE.Mesh(pr.geo,pr.mat); m.position.set(pr.t[0],pr.t[1],pr.t[2]); tr.add(m); });
      grp.add(tr);
    }
    occMark(grp); scene.add(grp); return grp;   // trees dither away when they are in front of someone
  });
}
/* ---------- barrier: hills (Greenfield) and mountains (Veiled Frost) overlapping in a near-vertical line down each side of the area, past the trees ----------
   BARRIER = line distance from the middle (knight-heights), sideways wobble, size range (knight-heights wide), z reach. Neighbours overlap by about 40%, so there is no gap. */
const BARRIER={hill:{x:14.4,wob:0.6,w:[4,7],reach:14.5},mountain:{x:14.4,wob:0.6,w:[5,8.5],reach:14.5}};
let hillGroup=null, mountainGroup=null; const barrierColliders=[];
function buildBarrier(id,cfg,H,groundY,vis,zOff){
  const el=document.getElementById(id); if(!el) return Promise.resolve(null);
  const BD=JSON.parse(el.textContent).parts;
  return Promise.all(BD.map(p=>loadImg(p.tex))).then(imgs=>{
    const protos=BD.map((p,k)=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3)); geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3)); geo.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2)); geo.setIndex(p.i);
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false; tex.needsUpdate=true; geo.computeBoundingBox();
      return {geo,mat:ps1Mat(tex,1)};
    });
    const bb=new THREE.Box3(); protos.forEach(pr=>bb.union(pr.geo.boundingBox));
    const w0=Math.max(bb.max.x-bb.min.x,bb.max.z-bb.min.z), cx=(bb.max.x+bb.min.x)/2, cz=(bb.max.z+bb.min.z)/2;
    const grp=new THREE.Group(); grp.visible=vis; grp.position.z=zOff; const cols=[];
    let sd=777; const rnd=()=>{ sd=(sd+0x6D2B79F5)|0; let t=Math.imul(sd^(sd>>>15),1|sd); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
    for(const side of [-1,1]){
      let z=-cfg.reach;
      while(z<=cfg.reach){
        const wd=(cfg.w[0]+rnd()*(cfg.w[1]-cfg.w[0]))*H, s=wd/w0, tr=new THREE.Group();
        tr.position.set(side*(cfg.x+(rnd()-0.5)*2*cfg.wob)*H,groundY-bb.min.y*s-0.06*H,z*H); tr.scale.setScalar(s); tr.rotation.y=rnd()*Math.PI*2;
        protos.forEach(pr=>{ const m=new THREE.Mesh(pr.geo,pr.mat); m.position.set(-cx,0,-cz); tr.add(m); });
        grp.add(tr); cols.push({x:tr.position.x,z:tr.position.z+zOff,r:0.4*wd});
        z+=wd/H*0.6;
      }
    }
    barrierColliders.push(...cols); colliders=(colliders||[]).concat(cols);
    scene.add(grp); return grp;
  }).catch(e=>{ console.error('barrier failed',id,e); return null; });
}
function initTrees(H,groundY){
  const TD=JSON.parse(document.getElementById('tree-data').textContent).parts;
  buildTreeGroup(TD,H,groundY,forest).then(grp=>{
    greenTreeGroup=grp; clearTreesForMapRuins(); if(mapArea==='greenfield') treeGroup=grp;
    colliders=grp.children.map(t=>({x:t.position.x,z:t.position.z,r:TREE_R*H*t.scale.x})).concat(barrierColliders);
  }).catch(e=>console.error('tree load failed',e));
  buildBarrier('hill-data',BARRIER.hill,H,groundY,forest,0).then(g=>{ if(g) hillGroup=g; });
  buildBarrier('mountain-data',BARRIER.mountain,H,groundY,forest,-FROST_DIST*H).then(g=>{ if(g) mountainGroup=g; });
  const sEl=document.getElementById('snow-tree-data');
  if(sEl){
    const STD=JSON.parse(sEl.textContent).parts;
    buildTreeGroup(STD,H,groundY,forest).then(grp=>{
      grp.position.z=-FROST_DIST*H;
      frostTreeGroup=grp; if(mapArea==='frost') treeGroup=grp;
    }).catch(e=>console.error('snow tree load failed',e));
  }
  const iEl=document.getElementById('ignis-tree-data');
  if(iEl){
    buildTreeGroup(JSON.parse(iEl.textContent).parts,H,groundY,forest).then(grp=>{
      grp.position.z=-IGNIS_DIST*H; ignisTreeGroup=grp; if(mapArea==='ignis') treeGroup=grp;
      grp.traverse(o=>{ if(o.isMesh&&o.material&&o.material.uniforms) o.material.uniforms.uMagma.value=1; });   // the magma on these trees glows (see uMagma in the shader)
    }).catch(e=>console.error('ignis tree load failed',e));
  }
}

/* ---------- falling leaves: leaf_falling.gif (14 frames, 140 ms each, cropped to a strip) drifting down from nearby trees ---------- */
const LEAF_FRAMES=14, LEAF_MS=140, LEAF_ASPECT=8/17;
const LEAF_MAX=12, LEAF_REACH=3.8, LEAF_W=0.08;      // max leaves at once, how far from the player a tree can drop one (knight-heights), leaf width (knight-heights)
const LEAF_FALL=0.22, LEAF_EVERY_MIN=0.5, LEAF_EVERY_MAX=1.9;   // fall speed (knight-heights/sec), seconds between new leaves
const LEAF_ATLAS="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAO4AAAAICAYAAAD+88O9AAABY0lEQVR4nO2XMWrDQBREZ1U4BCGXgVxCW+kkuYC3N2p1hrSO+j2BTpLKvkQgpYwRSvNTCIEwOFg7n1g2+w4wfObP/JXM5sOK3+4NIpHI3ZD47d642krVFHLrYSLLImZiuSQAkKWC768flD6nCuxqGxe9ADQKVzWFdG1/8zkeGaYvCQDs3MFk6aDRtT1KnwcJar3errYSj0AYGoUrfa5SWlZj6bA5ZfpiRLkepc/leDLIUsHz+gnvb5/B/8+utpKlgp07UBrAYFKoxn9QNYUwXo0aXdtTfgG87xpzaPhxDRr5YPwK7Usyf8y/mb7erPFZKjieTPAXADAsRONL4NJ1nat5SYN9nVxtVV44trRz52D9YPeikQ8mp6F9UX9xtZmawVzw88sGhB2WMSQvryuM4Zo71zRojM5Ua1w+Uzgg/OVh5tDwg90Lmw+tnF7L4ouriYa551eVPSYaOo8C44fGXu5pH7+IuTgVPUs17gAAAABJRU5ErkJggg==";
let leavesOn=true, leaves=null, leafGround=0, leafWait=1;
const leafBox=new THREE.Box3(), leafSize=new THREE.Vector3(), leafCtr=new THREE.Vector3();
function toggleLeaves(){ leavesOn=!leavesOn; }
function initLeaves(groundY){
  leafGround=groundY;
  loadImg(LEAF_ATLAS).then(img=>{
    leaves=[];
    for(let i=0;i<LEAF_MAX;i++){
      const tex=new THREE.Texture(img); tex.magFilter=tex.minFilter=THREE.NearestFilter; tex.generateMipmaps=false;
      tex.repeat.set(1/LEAF_FRAMES,1); tex.needsUpdate=true;
      const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,opacity:0,depthWrite:false,fog:false}));
      spr.visible=false; spr.renderOrder=6; scene.add(spr);
      leaves.push({spr,tex,on:false,fi:-1,t:0});
    }
  }).catch(e=>console.error('leaf load failed',e));
}
function spawnLeaf(l){
  if(!treeGroup||!playerRig) return false;
  const p=playerRig.position, R=LEAF_REACH*playerH;
  const near=treeGroup.children.filter(t=>Math.hypot(t.position.x-p.x,t.position.z-p.z)<R);
  if(!near.length) return false;
  const tr=near[Math.floor(Math.random()*near.length)];
  leafBox.setFromObject(tr); leafBox.getSize(leafSize); leafBox.getCenter(leafCtr);
  const top=leafBox.max.y-leafGround;
  l.x0=leafCtr.x+(Math.random()-0.5)*leafSize.x*0.7; l.z0=leafCtr.z+(Math.random()-0.5)*leafSize.z*0.7;
  l.y0=leafGround+top*(0.5+Math.random()*0.45);
  l.vy=playerH*LEAF_FALL*(0.8+Math.random()*0.4);
  l.amp=playerH*(0.05+Math.random()*0.1); l.fq=0.9+Math.random()*1.3; l.ph=Math.random()*6.283;
  const a=Math.random()*6.283, dr=playerH*(0.01+Math.random()*0.05); l.drx=Math.cos(a)*dr; l.drz=Math.sin(a)*dr;
  l.off=Math.floor(Math.random()*LEAF_FRAMES); l.sc=0.9+Math.random()*0.35; l.flip=Math.random()<0.5?-1:1;
  l.t=0; l.fi=-1; l.on=true; l.spr.visible=true; l.spr.material.opacity=0;
  const w=playerH*LEAF_W*l.sc; l.spr.scale.set(l.flip*w,w*LEAF_ASPECT,1);
  return true;
}
function endLeaf(l){ l.on=false; l.spr.visible=false; l.spr.material.opacity=0; }

/* ---------- snow: falls over The Veiled Frost (OPTIONS > SNOW) ----------
   A few hundred square flakes in a box around the camera. They keep their place in the world as the camera moves (they wrap at the box edges), sway a little,
   snap to the same chunky grid as the leaves, and fade into the fog like everything else. SNOW: count; box = half-width of the box and top = its height, in knight-heights;
   fall = fall speed range (knight-heights per second); sway = side-to-side wobble; size = flake size (knight-heights). */
const SNOW={count:360, box:5.5, top:5.2, fallMin:0.22, fallMax:0.55, sway:0.12, size:0.05};
let snowOn=true, snow=null, snowT=0;
function initSnow(H,groundY){
  try{
    const N=SNOW.count, pos=new Float32Array(N*3), col=new Float32Array(N*3), data=[];
    for(let i=0;i<N;i++) data.push({x:Math.random(),z:Math.random(),y:Math.random(),v:SNOW.fallMin+Math.random()*(SNOW.fallMax-SNOW.fallMin),fq:0.6+Math.random()*1.2,ph:Math.random()*6.283,amp:SNOW.sway*(0.4+Math.random()*0.8),dr:(Math.random()-0.5)*0.1});
    const geo=new THREE.BufferGeometry(), pa=new THREE.BufferAttribute(pos,3), ca=new THREE.BufferAttribute(col,3); pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position',pa); geo.setAttribute('color',ca);
    const pts=new THREE.Points(geo,new THREE.PointsMaterial({size:SNOW.size*H,sizeAttenuation:true,vertexColors:true,depthWrite:false,fog:false}));
    pts.frustumCulled=false; pts.visible=false; pts.name='Snow'; scene.add(pts);
    snow={pts,pa,ca,pos,col,data,ground:groundY,N};
  }catch(e){ console.error('snow init failed',e); }
}
const _snV=new THREE.Vector3();
function updateSnow(dt){
  if(!snow) return;
  const want=snowOn&&!dungeon&&(mapArea==='frost'||Math.abs(mapAreaK-1)<0.5);
  snow.pts.visible=want; if(!want) return;
  try{
    snowT+=dt;
    const H=playerH, S=SNOW.box*H, T=SNOW.top*H, g=snow.ground, snap=H*0.02, near=U.uFogNear.value, far=U.uFogFar.value, fc=U.uFogColor.value, nt=U.uNight.value;
    camera.getWorldDirection(_snV); let fx=_snV.x, fz=_snV.z; const fl=Math.hypot(fx,fz)||1; fx/=fl; fz/=fl;
    const cx=camera.position.x+fx*S*0.45, cz=camera.position.z+fz*S*0.45, cp=camera.position;   // the box sits in front of the camera
    const pos=snow.pos, col=snow.col, W=2*S;
    for(let i=0;i<snow.N;i++){
      const d=snow.data[i];
      let x=cx+((((d.x*W+d.dr*H*snowT-cx+S)%W)+W)%W)-S+Math.sin(snowT*d.fq+d.ph)*d.amp*H;
      let z=cz+((((d.z*W+d.dr*0.6*H*snowT-cz+S)%W)+W)%W)-S+Math.cos(snowT*d.fq*0.8+d.ph)*d.amp*H*0.7;
      let y=g+((((d.y*T-d.v*H*snowT)%T)+T)%T);
      if(ps1){ x=Math.round(x/snap)*snap; z=Math.round(z/snap)*snap; y=Math.round(y/snap)*snap; }
      pos[i*3]=x; pos[i*3+1]=y; pos[i*3+2]=z;
      const dist=Math.hypot(x-cp.x,y-cp.y,z-cp.z);
      let f=Math.min(1,Math.max(0,(dist-near)/(far-near))); f=f*f*(3-2*f);                       // into the fog, like the trees
      f=Math.max(f,Math.min(1,Math.max(0,(0.9*H-dist)/(0.5*H))));                                 // and out of the way when one drifts right up to the lens
      col[i*3]=nt.x+(fc.r-nt.x)*f; col[i*3+1]=nt.y+(fc.g-nt.y)*f; col[i*3+2]=nt.z+(fc.b-nt.z)*f;   // white (dimmed by the night tint) fading to the fog colour
    }
    snow.pa.needsUpdate=true; snow.ca.needsUpdate=true;
  }catch(e){ if(!updateSnow.warned){ updateSnow.warned=true; console.error('snow',e); } }
}
function updateLeaves(dt){
  if(!leaves) return;
  const show=leavesOn&&mapArea==='greenfield'&&treeGroup&&treeGroup.visible; let n=0;
  const gy=leafGround+playerH*0.012, snap=playerH*0.02, near=U.uFogNear.value, far=U.uFogFar.value;
  for(const l of leaves){
    if(!l.on) continue;
    if(!show){ endLeaf(l); continue; }
    l.t+=dt; const y=l.y0-l.vy*l.t;
    if(y<=gy){ endLeaf(l); continue; }
    n++;
    let x=l.x0+l.drx*l.t+Math.sin(l.t*l.fq+l.ph)*l.amp, z=l.z0+l.drz*l.t+Math.cos(l.t*l.fq*0.8+l.ph)*l.amp*0.7, yy=y;
    if(ps1){ x=Math.round(x/snap)*snap; z=Math.round(z/snap)*snap; yy=Math.round(yy/snap)*snap; }   // chunky vertex-snap feel
    l.spr.position.set(x,yy,z);
    const fi=Math.floor(l.t*1000/LEAF_MS+l.off)%LEAF_FRAMES; if(fi!==l.fi){ l.fi=fi; l.tex.offset.x=fi/LEAF_FRAMES; }
    const d=camera.position.distanceTo(l.spr.position), f=Math.min(1,Math.max(0,(d-near)/(far-near))), fog=1-f*f*(3-2*f);   // fades into the fog like the trees
    l.spr.material.opacity=Math.max(0,Math.min(1,l.t/0.4,(y-gy)/(playerH*0.15)))*fog;
  }
  if(show){
    leafWait-=dt;
    if(leafWait<=0){
      if(n<LEAF_MAX){ const l=leaves.find(q=>!q.on); if(l) spawnLeaf(l); }
      leafWait=LEAF_EVERY_MIN+Math.random()*(LEAF_EVERY_MAX-LEAF_EVERY_MIN);
    }
  }
}

/* ---------- seat rock (only visible in Pose2) ---------- */
function buildRockMesh(RD,seat,gnd,name){
  return loadImg(RD.tex).then(img=>{
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(RD.p,3));
    geo.setAttribute('normal',new THREE.Float32BufferAttribute(RD.n,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(RD.uv,2));
    geo.setIndex(RD.i); geo.computeBoundingBox();
    const bb=geo.boundingBox, halfH=(bb.max.y-bb.min.y)/2, midY=(bb.max.y+bb.min.y)/2;
    const sx=ROCK_W/bb.max.x, sy=ROCK_H/halfH, sz=ROCK_D/bb.max.z;
    const tex=new THREE.Texture(img); tex.flipY=false;
    const m=new THREE.Mesh(geo,ps1Mat(tex,1)); m.name=name||'SeatRock';
    m.scale.set(sx,sy,sz);
    m.position.set(seat.x, gnd.y-midY*sy, seat.z-ROCK_BACK);   // middle of the rock at floor level = half of it is in the ground
    return m;
  });
}
function initRock(parent,groundY){
  const el=document.getElementById('rock-data'); if(!el) return;
  const RD=JSON.parse(el.textContent);
  /* measure the seat now, while the model is in its bind pose (the pelvis does not move in Pose2) */
  parent.updateMatrixWorld(true);
  const pv=parent.getObjectByName('Adventurer_Pelvis');
  const seat=new THREE.Vector3(0,groundY+0.93,0.07), gnd=new THREE.Vector3(0,groundY,0);
  if(pv){ const pb=new THREE.Box3().setFromObject(pv), c=pb.getCenter(new THREE.Vector3()); seat.set(c.x,pb.min.y,c.z); }
  const seatWorld=seat.clone();
  parent.worldToLocal(seat); parent.worldToLocal(gnd);
  buildRockMesh(RD,seat,gnd,'SeatRock').then(m=>{
    parent.add(m); greenRockMesh=m; rockMesh=m;
    // Also place a standalone rock at The Greenfield's center for when the knight is in The Veiled Frost
    const sp=m.clone(); sp.name='SpareGreenRock';
    parent.updateMatrixWorld(true);
    sp.position.copy(m.getWorldPosition(new THREE.Vector3()));
    sp.quaternion.copy(m.getWorldQuaternion(new THREE.Quaternion()));
    sp.scale.copy(m.getWorldScale(new THREE.Vector3()));
    scene.add(sp); spareGreenRock=sp;
    syncRockMeshes();
  }).catch(e=>console.error('rock load failed',e));
  const sEl=document.getElementById('snow-rock-data');
  if(sEl){
    const SRD=JSON.parse(sEl.textContent);
    buildRockMesh(SRD,seat,gnd,'SeatRock').then(m=>{
      parent.add(m); frostRockMesh=m;
      // Also place a standalone snowy rock at The Veiled Frost's center for when the knight is in The Greenfield
      const sp=m.clone(); sp.name='SpareFrostRock';
      parent.updateMatrixWorld(true);
      sp.position.copy(m.getWorldPosition(new THREE.Vector3()));
      sp.position.z-=FROST_DIST*playerH;
      sp.quaternion.copy(m.getWorldQuaternion(new THREE.Quaternion()));
      sp.scale.copy(m.getWorldScale(new THREE.Vector3()));
      scene.add(sp); spareFrostRock=sp;
      syncRockMeshes();
    }).catch(e=>console.error('snow rock load failed',e));
  }
  const iEl=document.getElementById('ignis-rock-data');
  if(iEl){
    const IRD=JSON.parse(iEl.textContent);
    buildRockMesh(IRD,seat,gnd,'SeatRock').then(m=>{
      parent.add(m); ignisRockMesh=m;
      // Also place a standalone rock at Ignis Mourne's center for when the knight is elsewhere
      const sp=m.clone(); sp.name='SpareIgnisRock';
      parent.updateMatrixWorld(true);
      sp.position.copy(m.getWorldPosition(new THREE.Vector3()));
      sp.position.z-=IGNIS_DIST*playerH;
      sp.quaternion.copy(m.getWorldQuaternion(new THREE.Quaternion()));
      sp.scale.copy(m.getWorldScale(new THREE.Vector3()));
      scene.add(sp); spareIgnisRock=sp;
      syncRockMeshes();
    }).catch(e=>console.error('ignis rock load failed',e));
  }
}

/* ---------- shortsword (sword-data: Blockbench glTF, same 1/16 units as the knight). Parented to the hand's forearm bone so it follows every animation ---------- */
const SWORD_HAND='Left';               // 'Right' or 'Left' (character's own side)
const SWORD_GRIP_Y=0.844;              // where the handle's middle sits along the sword's own blade axis
const SWORD_ROT_DEG=[90,0,90];         // x,y,z (ZYX): 90,0,90 = blade pointing forward, edge up/down. Tweak to tilt it, e.g. 60,0,90 points it up a bit
const SWORD_NUDGE=[0,0,0];             // extra x,y,z shift in forearm space
const SWORD_ROLL_DEG=90;               // extra turn about the z axis, applied last. Use -90 to turn it the other way, 0 for none
let swordGrp=null, swordOn=true, axeGrp=null, axeStyle='axe', weapon='sword';   // axeStyle: 'axe' or 'shovel' (the shovel is the axe's alternate model: same rig, mount, animations and stats)   // weapon: 'sword' (light) or 'axe' (heavy)
function initSword(parent){
  const el=document.getElementById('sword-data'); if(!el) return;
  const SD=JSON.parse(el.textContent);
  const fore=parent.getObjectByName(SWORD_HAND+'_Forearm'), hand=parent.getObjectByName('Adventurer_'+SWORD_HAND+'_Hand');
  if(!fore||!hand){ console.error('sword: hand bones not found'); return; }
  parent.updateMatrixWorld(true);
  const hc=new THREE.Box3().setFromObject(hand).getCenter(new THREE.Vector3()); fore.worldToLocal(hc);
  const grp=new THREE.Group(); grp.name='Shortsword'; grp.rotation.order='ZYX';
  grp.rotation.set(SWORD_ROT_DEG[0]*Math.PI/180,SWORD_ROT_DEG[1]*Math.PI/180,SWORD_ROT_DEG[2]*Math.PI/180);
  grp.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),SWORD_ROLL_DEG*Math.PI/180));
  const grip=new THREE.Vector3(0,SWORD_GRIP_Y,0).applyQuaternion(grp.quaternion);
  grp.position.copy(hc).sub(grip).add(new THREE.Vector3(SWORD_NUDGE[0],SWORD_NUDGE[1],SWORD_NUDGE[2]));
  Promise.all(SD.parts.map(p=>loadImg(p.tex))).then(imgs=>{
    SD.parts.forEach((p,k)=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2));
      geo.setIndex(p.i);
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
      const smat=ps1Mat(tex,1); swordMats.push(smat); tintMat(smat,swordMatch?armorHex:swordHex);
      const m=new THREE.Mesh(geo,smat); m.name='sword_'+p.name;
      m.position.set(p.t[0],p.t[1],p.t[2]); m.rotation.order='ZYX';
      m.rotation.set(p.r[0]*Math.PI/180,p.r[1]*Math.PI/180,p.r[2]*Math.PI/180);
      grp.add(m);
    });
    grp.visible=swordOn; fore.add(grp); swordGrp=grp; initSwoosh(grp,parent);
  }).catch(e=>console.error('sword load failed',e));
}
/* ---------- the Hatchet (hatchet-data: Blockbench glTF). The small axe: an alternate style for the SWORD. It is a light weapon, so it is held exactly like the sword and uses the sword's
   own animations (Idle, Swing, ...) and the same swoosh. Pick it with OPTIONS > SWORD STYLE (or the same row on the animations screen). It follows the sword's hand and mount constants above;
   HATCHET_GRIP_Y is where the middle of its handle sits, HATCHET_TURN_DEG turns it about the handle (0 = the edge on the hand's side, 180 = the other way), HATCHET_NUDGE shifts it (forearm space). ---------- */
/* the Hammer (hammer-data): a second alternate style for the SWORD, held like the hatchet. HAMMER_GRIP is the middle of its handle (the handle stands at x 0, z 0.125 in the model). */
const HAMMER_GRIP=[0,0.72,0.125], HAMMER_TURN_DEG=0, HAMMER_NUDGE=[0,0,0];
/* the Morningstar (morningstar-data): a fifth style for the SWORD, held like the hammer. MORNINGSTAR_GRIP is the middle of the part of its handle he holds (the handle stands at x 0, z 0, from y 0.315 to 1.14; the ball sits on top of it, its spikes reach y 1.44; the model is the original export scaled to 0.6 about the grip, so it is about the hatchet's length). The head is the same all the way round, so the turn does not matter much. */
const MORNINGSTAR_GRIP=[0,0.6,0], MORNINGSTAR_TURN_DEG=0, MORNINGSTAR_NUDGE=[0,0,0];
const HATCHET_GRIP_Y=1.156, HATCHET_TURN_DEG=0, HATCHET_NUDGE=[0,0,0];
let voice='voice1';   // 'voice1' (original sounds) or 'voice2' (new sounds)
function setVoice(v){
  voice=(v==='voice2')?'voice2':'voice1';
  const b=document.getElementById('voice'); if(b) setSwitch('voice',true,voice==='voice2'?'Voice 2':'Voice 1');
  const sel=document.getElementById('voicesel'); if(sel) sel.value=voice;
}
function toggleVoice(){ setVoice(voice==='voice1'?'voice2':'voice1'); try{ sfx=sfx||new (window.AudioContext||window.webkitAudioContext)(); sfx.resume(); }catch(e){} playFlauntSfx(); }   // preview: one of the voice's flaunt lines
let hatchetGrp=null, hammerGrp=null, knightlyGrp=null, morningstarGrp=null, swordStyle='sword';   // swordStyle: 'sword' or 'hatchet' (only shows while the weapon is the light one)
function showWeapons(){ applyAxeStyle();
  if(swordGrp) swordGrp.visible=(weapon==='sword'&&swordStyle==='sword');
  if(hatchetGrp) hatchetGrp.visible=(weapon==='sword'&&swordStyle==='hatchet');
  if(hammerGrp) hammerGrp.visible=(weapon==='sword'&&swordStyle==='hammer');
  if(knightlyGrp) knightlyGrp.visible=(weapon==='sword'&&swordStyle==='knightly');
  if(morningstarGrp) morningstarGrp.visible=(weapon==='sword'&&swordStyle==='morningstar');
  if(axeGrp) axeGrp.visible=(weapon==='axe');
  if(editOn) [swordGrp,hatchetGrp,hammerGrp,knightlyGrp,morningstarGrp,axeGrp].forEach(g=>{ if(g) g.visible=false; });   // EDIT: no weapon
  swooshUse();
}
function initHatchet(parent){
  const el=document.getElementById('hatchet-data'); if(!el) return;
  const HD=JSON.parse(el.textContent);
  const fore=parent.getObjectByName(SWORD_HAND+'_Forearm'), hand=parent.getObjectByName('Adventurer_'+SWORD_HAND+'_Hand');
  if(!fore||!hand){ console.error('hatchet: hand bones not found'); return; }
  parent.updateMatrixWorld(true);
  const hc=new THREE.Box3().setFromObject(hand).getCenter(new THREE.Vector3()); fore.worldToLocal(hc);
  const D=Math.PI/180, Y=new THREE.Vector3(0,1,0);
  // start from the sword's own mount (same pointing, same flat-on-its-side hold) ...
  const qS=new THREE.Quaternion().setFromEuler(new THREE.Euler(SWORD_ROT_DEG[0]*D,SWORD_ROT_DEG[1]*D,SWORD_ROT_DEG[2]*D,'ZYX'));
  qS.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),SWORD_ROLL_DEG*D));
  // ... then turn it a quarter about its handle: the sword is wide along its x, the hatchet's head reaches out along its -z, so this lines the head up where the blade would be.
  // In the sword's hold the width runs along the forearm, so the quarter is chosen that puts the cutting edge on the fist's side of the handle - which is the side that swings down when the arm hangs
  const edge=new THREE.Vector3(0,0,-1);
  let q=qS.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y,Math.PI/2));
  if(edge.clone().applyQuaternion(q).x*(SWORD_HAND==='Left'?1:-1)<0) q=qS.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y,-Math.PI/2));
  if(HATCHET_TURN_DEG) q.multiply(new THREE.Quaternion().setFromAxisAngle(Y,HATCHET_TURN_DEG*D));
  const grp=new THREE.Group(); grp.name='Hatchet'; grp.quaternion.copy(q);
  const grip=new THREE.Vector3(0,HATCHET_GRIP_Y,0).applyQuaternion(q);
  grp.position.copy(hc).sub(grip).add(new THREE.Vector3(HATCHET_NUDGE[0],HATCHET_NUDGE[1],HATCHET_NUDGE[2]));
  Promise.all(HD.parts.map(p=>loadImg(p.tex))).then(imgs=>{
    HD.parts.forEach((p,k)=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2));
      geo.setIndex(p.i);
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
      const hmat=ps1Mat(tex,1); swordMats.push(hmat); tintMat(hmat,swordMatch?armorHex:swordHex);   // the same weapon color as the sword
      const m=new THREE.Mesh(geo,hmat); m.name='hatchet_'+p.name;
      m.position.set(p.t[0],p.t[1],p.t[2]); m.rotation.order='ZYX';
      m.rotation.set(p.r[0]*D,p.r[1]*D,p.r[2]*D);
      grp.add(m);
    });
    fore.add(grp); hatchetGrp=grp;
    swooshAddRig('hatchet',grp,parent.getObjectByName(SWORD_HAND+'_Arm')||fore,HATCHET_SWOOSH.tip,HATCHET_SWOOSH.hilt,{width:HATCHET_SWOOSH.width,start:SWOOSH_START_SPEED,stop:SWOOSH_STOP_SPEED});
    showWeapons();
  }).catch(e=>console.error('hatchet load failed',e));
}
/* ---------- the Knightly Sword (knightly-sword-data): the shortsword's shape with its own textures, a fifth style for the SWORD. Held exactly like the sword (same mount, animations and swoosh).
   Its coloured texels glow like the magma on the Ignis Mourne trees (uGem, in the shader) and the grey steel is pushed far towards white (uBladeGlow, 0.85 in the shader at 1). The steel takes the weapon colour at full strength (userData.tintAmt); the gems keep their own colours. ---------- */
function initKnightly(parent){
  const el=document.getElementById('knightly-sword-data'); if(!el) return;
  const SD=JSON.parse(el.textContent);
  const fore=parent.getObjectByName(SWORD_HAND+'_Forearm'), hand=parent.getObjectByName('Adventurer_'+SWORD_HAND+'_Hand');
  if(!fore||!hand){ console.error('knightly sword: hand bones not found'); return; }
  parent.updateMatrixWorld(true);
  const hc=new THREE.Box3().setFromObject(hand).getCenter(new THREE.Vector3()); fore.worldToLocal(hc);
  const D=Math.PI/180;
  const grp=new THREE.Group(); grp.name='KnightlySword'; grp.rotation.order='ZYX';
  grp.rotation.set(SWORD_ROT_DEG[0]*D,SWORD_ROT_DEG[1]*D,SWORD_ROT_DEG[2]*D);
  grp.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),SWORD_ROLL_DEG*D));
  const grip=new THREE.Vector3(0,SWORD_GRIP_Y,0).applyQuaternion(grp.quaternion);
  grp.position.copy(hc).sub(grip).add(new THREE.Vector3(SWORD_NUDGE[0],SWORD_NUDGE[1],SWORD_NUDGE[2]));
  Promise.all(SD.parts.map(p=>loadImg(p.tex))).then(imgs=>{
    SD.parts.forEach((p,k)=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2));
      geo.setIndex(p.i);
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
      let kmat;
      if(p.name!=='crossguard'){
        kmat=ps1Mat(tex,1); shineMat(kmat); kmat.uniforms.uGem.value=1; kmat.uniforms.uBladeGlow.value=0;   // 0: no white wash on the steel any more (the gems still glow, uGem)
        kmat.userData.tintAmt=1; swordMats.push(kmat); tintMat(kmat,swordMatch?armorHex:swordHex);   // it follows the weapon colour like the other swords, at full strength
      } else {   // the guard is the normal sword's own, copied into knightly-sword-data: built exactly as initSword builds it (no glow, no shine, the normal sword's tint). The pommel and grip are still the knightly sword's
        kmat=ps1Mat(tex,1); swordMats.push(kmat); tintMat(kmat,swordMatch?armorHex:swordHex);
      }
      const m=new THREE.Mesh(geo,kmat); m.name='knightly_'+p.name;
      m.position.set(p.t[0],p.t[1],p.t[2]); m.rotation.order='ZYX';
      m.rotation.set(p.r[0]*D,p.r[1]*D,p.r[2]*D);
      grp.add(m);
    });
    fore.add(grp); knightlyGrp=grp;
    swooshAddRig('knightly',grp,parent.getObjectByName(SWORD_HAND+'_Arm')||fore,[0,SWOOSH_TIP_Y,0],[0,SWOOSH_HILT_Y,0],{width:SWOOSH_WIDTH,start:SWOOSH_START_SPEED,stop:SWOOSH_STOP_SPEED});
    showWeapons();
  }).catch(e=>console.error('knightly sword load failed',e));
}
function initHammer(parent){
  const el=document.getElementById('hammer-data'); if(!el) return;
  const HD=JSON.parse(el.textContent);
  const fore=parent.getObjectByName(SWORD_HAND+'_Forearm'), hand=parent.getObjectByName('Adventurer_'+SWORD_HAND+'_Hand');
  if(!fore||!hand){ console.error('hammer: hand bones not found'); return; }
  parent.updateMatrixWorld(true);
  const hc=new THREE.Box3().setFromObject(hand).getCenter(new THREE.Vector3()); fore.worldToLocal(hc);
  const D=Math.PI/180, Y=new THREE.Vector3(0,1,0);
  // start from the sword's own mount (same pointing, same flat-on-its-side hold) ...
  const qS=new THREE.Quaternion().setFromEuler(new THREE.Euler(SWORD_ROT_DEG[0]*D,SWORD_ROT_DEG[1]*D,SWORD_ROT_DEG[2]*D,'ZYX'));
  qS.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),SWORD_ROLL_DEG*D));
  // ... then turn it a quarter about its handle: the sword is wide along its x, the hammer's head reaches out along its -z, so this lines the head up where the blade would be.
  // In the sword's hold the width runs along the forearm, so the quarter is chosen that puts the cutting edge on the fist's side of the handle - which is the side that swings down when the arm hangs
  const edge=new THREE.Vector3(0,0,-1);
  let q=qS.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y,Math.PI/2));
  if(edge.clone().applyQuaternion(q).x*(SWORD_HAND==='Left'?1:-1)<0) q=qS.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y,-Math.PI/2));
  if(HAMMER_TURN_DEG) q.multiply(new THREE.Quaternion().setFromAxisAngle(Y,HAMMER_TURN_DEG*D));
  const grp=new THREE.Group(); grp.name='Hammer'; grp.quaternion.copy(q);
  const grip=new THREE.Vector3(HAMMER_GRIP[0],HAMMER_GRIP[1],HAMMER_GRIP[2]).applyQuaternion(q);
  grp.position.copy(hc).sub(grip).add(new THREE.Vector3(HAMMER_NUDGE[0],HAMMER_NUDGE[1],HAMMER_NUDGE[2]));
  Promise.all(HD.parts.map(p=>loadImg(p.tex))).then(imgs=>{
    HD.parts.forEach((p,k)=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2));
      geo.setIndex(p.i);
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
      const hmat=ps1Mat(tex,1); swordMats.push(hmat); tintMat(hmat,swordMatch?armorHex:swordHex);   // the same weapon color as the sword
      const m=new THREE.Mesh(geo,hmat); m.name='hammer_'+p.name;
      m.position.set(p.t[0],p.t[1],p.t[2]); m.rotation.order='ZYX';
      m.rotation.set(p.r[0]*D,p.r[1]*D,p.r[2]*D);
      grp.add(m);
    });
    fore.add(grp); hammerGrp=grp;
    swooshAddRig('hammer',grp,parent.getObjectByName(SWORD_HAND+'_Arm')||fore,HAMMER_SWOOSH.tip,HAMMER_SWOOSH.hilt,{width:HAMMER_SWOOSH.width,start:SWOOSH_START_SPEED,stop:SWOOSH_STOP_SPEED});
    showWeapons();
  }).catch(e=>console.error('hammer load failed',e));
}
function initMorningstar(parent){
  const el=document.getElementById('morningstar-data'); if(!el) return;
  const HD=JSON.parse(el.textContent);
  const fore=parent.getObjectByName(SWORD_HAND+'_Forearm'), hand=parent.getObjectByName('Adventurer_'+SWORD_HAND+'_Hand');
  if(!fore||!hand){ console.error('morningstar: hand bones not found'); return; }
  parent.updateMatrixWorld(true);
  const hc=new THREE.Box3().setFromObject(hand).getCenter(new THREE.Vector3()); fore.worldToLocal(hc);
  const D=Math.PI/180, Y=new THREE.Vector3(0,1,0);
  // start from the sword's own mount (same pointing, same flat-on-its-side hold) ...
  const qS=new THREE.Quaternion().setFromEuler(new THREE.Euler(SWORD_ROT_DEG[0]*D,SWORD_ROT_DEG[1]*D,SWORD_ROT_DEG[2]*D,'ZYX'));
  qS.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),SWORD_ROLL_DEG*D));
  // ... then turn it a quarter about its handle, chosen the same way as the hammer's (the sword is wide along its x). The ball's spikes point the same way all round, so the quarter changes little; MORNINGSTAR_TURN_DEG is there to tweak it.
  const edge=new THREE.Vector3(0,0,-1);
  let q=qS.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y,Math.PI/2));
  if(edge.clone().applyQuaternion(q).x*(SWORD_HAND==='Left'?1:-1)<0) q=qS.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y,-Math.PI/2));
  if(MORNINGSTAR_TURN_DEG) q.multiply(new THREE.Quaternion().setFromAxisAngle(Y,MORNINGSTAR_TURN_DEG*D));
  const grp=new THREE.Group(); grp.name='Morningstar'; grp.quaternion.copy(q);
  const grip=new THREE.Vector3(MORNINGSTAR_GRIP[0],MORNINGSTAR_GRIP[1],MORNINGSTAR_GRIP[2]).applyQuaternion(q);
  grp.position.copy(hc).sub(grip).add(new THREE.Vector3(MORNINGSTAR_NUDGE[0],MORNINGSTAR_NUDGE[1],MORNINGSTAR_NUDGE[2]));
  Promise.all(HD.parts.map(p=>loadImg(p.tex))).then(imgs=>{
    HD.parts.forEach((p,k)=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2));
      geo.setIndex(p.i);
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
      const hmat=ps1Mat(tex,1); swordMats.push(hmat); tintMat(hmat,swordMatch?armorHex:swordHex);   // the same weapon color as the sword
      const m=new THREE.Mesh(geo,hmat); m.name='morningstar_'+p.name;
      m.position.set(p.t[0],p.t[1],p.t[2]); m.rotation.order='ZYX';
      m.rotation.set(p.r[0]*D,p.r[1]*D,p.r[2]*D);
      grp.add(m);
    });
    fore.add(grp); morningstarGrp=grp;
    swooshAddRig('morningstar',grp,parent.getObjectByName(SWORD_HAND+'_Arm')||fore,MORNINGSTAR_SWOOSH.tip,MORNINGSTAR_SWOOSH.hilt,{width:MORNINGSTAR_SWOOSH.width,start:SWOOSH_START_SPEED,stop:SWOOSH_STOP_SPEED});
    showWeapons();
  }).catch(e=>console.error('morningstar load failed',e));
}
function applyAxeStyle(){ if(axeGrp) axeGrp.children.forEach(m=>{ if(m.name.indexOf('shovel_')===0) m.visible=(axeStyle==='shovel'); else if(m.name.indexOf('axe_')===0) m.visible=(axeStyle!=='shovel'); }); }
function toggleAxeStyle(){ axeStyle=(axeStyle==='axe')?'shovel':'axe'; if(weapon!=='axe') setWeapon('axe'); else showWeapons(); refreshAnim(); }
function initShovel(grp){   // the shovel's meshes ride in the axe's own group, so they follow every bit of the axe's logic
  const el=document.getElementById('shovel-data'); if(!el) return;
  const SD=JSON.parse(el.textContent);
  Promise.all(SD.parts.map(p=>loadImg(p.tex))).then(imgs=>{
    SD.parts.forEach((p,k)=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3)); geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3)); geo.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2)); geo.setIndex(p.i);
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
      const mat=ps1Mat(tex,1); swordMats.push(mat); tintMat(mat,swordMatch?armorHex:swordHex);
      const m=new THREE.Mesh(geo,mat); m.name='shovel_'+p.name; grp.add(m);
    });
    applyAxeStyle();
  });
}
function toggleStyle(){
  swordStyle=(swordStyle==='sword')?'hatchet':(swordStyle==='hatchet')?'hammer':(swordStyle==='hammer')?'knightly':(swordStyle==='knightly')?'morningstar':'sword';
  if(weapon!=='sword') setWeapon('sword'); else showWeapons();   // a sword style only shows on the light weapon, so changing it brings that one out
  refreshAnim();
}
/* ---------- the Axe (axe-data: Blockbench glTF). Heavy weapon: held across the body with the AxeIdle pose.
   Its place on the left forearm was worked out from where both hands sit in AxeIdle: the shaft runs through both fists, the head out past his left hand,
   with the two blades pointing up and down. Fine-tune it with AXE_NUDGE (forearm space) and AXE_ROLL_DEG (turns the blades around the shaft). ---------- */
const AXE_NUDGE=[0,0,0];
/* Which hand is on top: true = the head is past his RIGHT hand, the right hand carries the axe and leads the swing, and the left hand is the lower one that follows.
   false = the original way round (head past the left hand, carried by the left forearm). AXE_MOUNT_R is the axe's place in the right forearm's space, worked out from AxeIdle
   so that the right fist sits at 1.366 along the handle and the left fist at 0.953 (both within 0.02 of the shaft). */
const AXE_HEAD_RIGHT=true, AXE_MOUNT_R={p:[-1.25965,-0.92929,0.54791],q:[-0.24072,-0.09709,-0.32458,0.90955]};   // the original mount, worked out for the unmirrored idle
const AXE_FLIP_ENDS=false, AXE_FLIP_PIVOT=1.1595;   // true = the axe is turned end for end: the head ends up past his right hand instead of his left (butt past the left). The pivot is the middle of his two fists along the handle (right fist 0.953, left fist 1.366), so both hands stay on it. false = as before
const AXE_ROLL_DEG=90;                              // turns the blades about the shaft: 90 = blades pointing front/back instead of up/down (0 = as before; 180 would look identical, the head is symmetric)
const AXE_SWING_REVERSE=false;                       // AxeSwing plays backwards, so the arc sweeps the other way. The clip starts and ends on the same pose, so it still joins up cleanly. false = as before
function initAxe(parent){
  const el=document.getElementById('axe-data'); if(!el) return;
  const AD=JSON.parse(el.textContent), fore=parent.getObjectByName(AXE_HEAD_RIGHT?'Right_Forearm':'Left_Forearm');
  if(!fore){ console.error('axe: forearm not found'); return; }
  const grp=new THREE.Group(); grp.name='Axe';
  const MT=AXE_HEAD_RIGHT?AXE_MOUNT_R:AD.mount;
  grp.quaternion.fromArray(MT.q);
  const mp=new THREE.Vector3(MT.p[0],MT.p[1],MT.p[2]);
  if(AXE_FLIP_ENDS&&!AXE_HEAD_RIGHT){   // half-turn about the blade axis, pivoting on the middle of the two fists: head and butt trade places, the hands stay on the handle
    mp.add(new THREE.Vector3(0,2*AXE_FLIP_PIVOT,0).applyQuaternion(grp.quaternion));
    grp.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI));
  }
  if(AXE_ROLL_DEG) grp.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),AXE_ROLL_DEG*Math.PI/180));
  grp.position.set(mp.x+AXE_NUDGE[0],mp.y+AXE_NUDGE[1],mp.z+AXE_NUDGE[2]);
  grp.userData.hand=fore; grp.userData.back=parent.getObjectByName('Torso');
  { const th=AXE_BACK_TILT_DEG*Math.PI/180, sx=AXE_BACK_SIDE*Math.sin(th), cy=Math.cos(th);
    const shaft=new THREE.Vector3(sx,cy,0), blade=new THREE.Vector3(cy,-sx,0), face=new THREE.Vector3(0,0,-1);   // handle, blade axis (across the handle, in the plane of his back), and the flat of the head facing backwards
    grp.userData.stowQ=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(face,shaft,blade));
    grp.userData.stowP=new THREE.Vector3(AXE_BACK_AT[0],AXE_BACK_AT[1],AXE_BACK_AT[2]).addScaledVector(shaft,-1.03);   // 1.03 = half the handle's length, so AXE_BACK_AT is the middle of it
  }
  grp.userData.basePos=grp.position.clone();
  grp.userData.baseQ=grp.quaternion.clone();   // the mount's own rotation; axePose() turns it to follow the arms and adds a turn about the shaft each frame
  Promise.all(AD.parts.map(p=>loadImg(p.tex))).then(imgs=>{
    AD.parts.forEach((p,k)=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(insetIslandUV(p.uv,p.i,imgs[k].width,imgs[k].height,AXE_UV_INSET),2));   // see insetIslandUV: stops neighbouring texels (the stray bits past the cut-outs) bleeding in at face edges
      geo.setIndex(p.i);
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
      const amat=ps1Mat(tex,1); swordMats.push(amat); tintMat(amat,swordMatch?armorHex:swordHex);   // follows the same weapon color as the sword
      const m=new THREE.Mesh(geo,amat); m.name='axe_'+p.name;
      m.position.set(p.t[0],p.t[1],p.t[2]); m.rotation.order='ZYX';
      m.rotation.set(p.r[0]*Math.PI/180,p.r[1]*Math.PI/180,p.r[2]*Math.PI/180);
      grp.add(m);
    });
    grp.visible=(weapon==='axe'); fore.add(grp); axeGrp=grp; initShovel(grp);
    // The two-handed weapons use the SWORD's swoosh as it is (same path-following trail, same width and speeds, no alternating bits), with the markers taken from the shovel's model:
    // the tip is the top of the shovel, the hilt is one sword-blade length (SWOOSH_TIP_Y-SWOOSH_HILT_Y) below it, so the trail has the sword's proportions. The axe shares these markers.
    swooshAddRig('axe',grp,parent.getObjectByName((AXE_HEAD_RIGHT?'Right':'Left')+'_Arm')||fore,[0,SHOVEL_TOP_Y,0],[0,SHOVEL_TOP_Y-(SWOOSH_TIP_Y-SWOOSH_HILT_Y),0],{width:SWOOSH_WIDTH,start:SWOOSH_START_SPEED,stop:SWOOSH_STOP_SPEED,flag:1.3}); swooshUse();
    const mkHand=side=>{ const A=parent.getObjectByName(side+'_Arm'), F=parent.getObjectByName(side+'_Forearm'), Hd=parent.getObjectByName('Adventurer_'+side+'_Hand'); if(!A||!F||!Hd) return null;
      parent.updateMatrixWorld(true); const hc=new THREE.Box3().setFromObject(Hd).getCenter(new THREE.Vector3()); F.worldToLocal(hc); return {arm:A,fore:F,hc}; };
    axeOff=mkHand(AXE_OFF_HAND);
  }).catch(e=>console.error('axe load failed',e));
}
/* Handedness and hands. The axe is held with the opposite handedness to the sword: while it is out the whole knight is mirrored left-to-right
   (the skeleton isn't symmetric, so swapping left/right animation tracks would not line up; mirroring the model is the exact way, and is what MIRROR_MODEL does).
   The top hand (the left forearm, which carries the axe) leads; the lower hand is solved every frame so it stays on the handle through the whole swing. */
const AXE_MIRROR=true;                         // false = same handedness as the sword
const AXE_STICK=true;                          // (no longer used: the arms are not moved any more, the axe follows them - see AXE_FOLLOW_ARMS)
const AXE_OFF_HAND=AXE_HEAD_RIGHT?'Left':'Right', AXE_OFF_GRIP=0.953;   // the lower hand, and where it grips along the handle (axe units; the top hand holds at 1.366)
let axeOff=null; const _sq=new THREE.Quaternion();
let blockFlipped=false;   // true while the Block animation plays with the axe out: the model is turned back the other way round for it (see syncBlockFlip)
function applyHandedness(){ if(knightScene) knightScene.scale.x=(MIRROR_MODEL?-1:1)*((AXE_MIRROR&&weapon==='axe')?-1:1)*(blockFlipped?-1:1); }
/* Block with the big axe is flipped: the model is already mirrored while the axe is out, and Block is turned the other way round again, so the guard happens on the opposite side from the sword's. Set BLOCK_FLIP_AXE=false to undo. */
const BLOCK_FLIP_AXE=true;
function syncBlockFlip(){ const f=!!(BLOCK_FLIP_AXE&&weapon==='axe'&&current&&/^Block(Idle)?$/.test(current.getClip().name)); if(f!==blockFlipped){ blockFlipped=f; applyHandedness(); } }
function swingBone(bone,fromW,toW){   // turn a bone about its joint so the line joint->fromW points at toW; done in the parent's space, so it also works on a mirrored model
  const P=bone.parent, j=bone.position.clone(), a=P.worldToLocal(fromW.clone()).sub(j), b=P.worldToLocal(toW.clone()).sub(j);
  if(a.lengthSq()<1e-12||b.lengthSq()<1e-12) return;
  bone.quaternion.premultiply(_sq.setFromUnitVectors(a.normalize(),b.normalize())); bone.updateMatrixWorld(true);
}
function reachHand(o,T){   // two-bone solve: o's fist goes to T, the elbow keeps bending the way the animation bends it
  o.arm.parent.updateMatrixWorld(true);
  const S=o.arm.getWorldPosition(new THREE.Vector3()), E=o.fore.getWorldPosition(new THREE.Vector3()), H=o.fore.localToWorld(o.hc.clone());
  const l1=S.distanceTo(E), l2=E.distanceTo(H), d=Math.max(1e-4,Math.min(S.distanceTo(T),(l1+l2)*0.999));
  const dir=T.clone().sub(S).normalize(), a=(l1*l1-l2*l2+d*d)/(2*d), h=Math.sqrt(Math.max(0,l1*l1-a*a));
  const pole=E.clone().sub(S); pole.addScaledVector(dir,-pole.dot(dir)); if(pole.lengthSq()<1e-10) pole.set(0,0,1); pole.normalize();
  swingBone(o.arm,E,S.clone().addScaledVector(dir,a).addScaledVector(pole,h));     // upper arm: elbow to its new place
  swingBone(o.fore,o.fore.localToWorld(o.hc.clone()),T);                           // forearm: fist onto the target
}
/* The axe follows the arms, not the other way round. Nothing moves the arms any more: they play the animation as it is.
   The top grip stays where the mount puts it (in the right fist), and the whole axe is turned about that point so the handle runs through the left fist too.
   So the lower half of the axe goes wherever the left hand goes. It is used in AxeIdle, AxeSwing and Walk, and eased in and out over AXE_FOLLOW_EASE seconds so nothing pops. */
/* Stowed: during Flaunt, Death, Pose2 (sitting on the rock, including its look-around event) and Drinking_Potion the axe hangs on his back instead - flat against it, slung diagonally with the head up over one shoulder.
   Numbers are in the torso's space (x sideways, y up, z forward; his back is at about z -0.13): AXE_BACK_AT is where the middle of the handle lies, AXE_BACK_TILT_DEG how far
   the handle leans from upright, AXE_BACK_SIDE which shoulder the head is over (-1 = his right, 1 = his left). */
const AXE_STOW_CLIPS=['Flaunt','Death','Pose2','Pose2_randomevent','Drinking_Potion','UALX_ConsumeM','Chestopen'], AXE_BACK_AT=[0,0.2,-0.175], AXE_BACK_TILT_DEG=35, AXE_BACK_SIDE=-1;
const AXE_FOLLOW_ARMS=true, AXE_FOLLOW_EASE=0.12, AXE_TOP_GRIP=1.366;   // AXE_TOP_GRIP: where the right fist holds the handle (axe units); false = the axe just rides the right forearm
/* The head's turn about the shaft is worked out live, so it can't end up facing the camera whatever pose the arms are in:
   in AxeIdle / Walk / anything but the swing, the blades are turned to point front and back, the way he faces (the head is symmetric, so either end is fine).
   In AxeSwing the mount's own roll is used; the turn is eased in and out over AXE_BLADES_EASE seconds. */
const AXE_BLADES_FRONT_BACK=true, AXE_BLADES_EASE=0.15;   // false = just use the mount's roll (AXE_ROLL_DEG)
const _aV=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()], _aQ=new THREE.Quaternion(), _aQ2=new THREE.Quaternion(), _aY=new THREE.Vector3(0,1,0);
let axeRollK=0, axeFollowK=0, axeT=0;
/* (Not used while 'AxeFlaunt' is in AXE_STOW_CLIPS: the axe stays on his back then. Kept as an option - remove it from AXE_STOW_CLIPS to get this back.)
   AxeFlaunt: the axe rests over the shoulder of the hand that carries it. The handle runs from that fist to a point just above the shoulder and on past it: AXE_SHOULDER_UP is how far above
   the shoulder joint (model units), AXE_OVER_SHOULDER how far the middle of the head sits beyond that point along the handle (more = the head hangs further behind him). */
const AXE_SHOULDER_UP=0.16, AXE_OVER_SHOULDER=0.6, AXE_SHOULDER_OUT=0.10, AXE_SHOULDER_BACK=0.15;   // OUT / BACK move the resting point outward and behind the shoulder joint, so the haft lies on top of the shoulder and the head hangs behind his back
function axePose(nm){
  const g=axeGrp, q0=g.userData.baseQ, p0=g.userData.basePos; if(!q0||!p0||!knightScene) return;
  const now=performance.now(), dt=Math.min(0.1,Math.max(0,(now-axeT)/1000)); axeT=now;
  const clamp=(v,s)=>Math.max(-s,Math.min(s,v));
  const wantF=(AXE_FOLLOW_ARMS&&(nm==='AxeIdle'||nm==='AxeSwing'||nm==='Walk'||/^SwingHeavy/.test(nm)))?1:0;   // (the SwingHeavy clips of RENDER too: the lower hand stays on the handle)
  axeFollowK+=clamp(wantF-axeFollowK,dt/AXE_FOLLOW_EASE);
  const hand=g.userData.hand, back=g.userData.back;
  if(blockFlipped&&/^Block(Idle)?$/.test(nm)&&axeOff&&axeOff.fore){   // the flipped Block turns the model round, so the axe moves to the other forearm to stay in the hand it is normally in on screen: the mount is mirrored across the forearm's length and its grip is put on that hand
    const lf=axeOff.fore; if(g.parent!==lf) lf.add(g);
    g.quaternion.set(q0.x,-q0.y,-q0.z,q0.w);
    g.position.copy(axeOff.hc).sub(_aV[0].set(0,AXE_TOP_GRIP,0).applyQuaternion(g.quaternion));
    axeFollowK=0; return;
  }
  if(back&&AXE_STOW_CLIPS.indexOf(nm)>=0){   // on his back
    if(g.parent!==back) back.add(g);
    g.position.copy(g.userData.stowP); g.quaternion.copy(g.userData.stowQ); axeFollowK=0; axeRollK=0; return;
  }
  if(g.parent!==hand) hand.add(g);
  g.quaternion.copy(q0); g.position.copy(p0);
  knightScene.updateMatrixWorld(true);                                      // the bones exactly as the animation has just posed them
  if(nm==='AxeFlaunt'||nm===FLAUNT_IDLE){
    const G=_aV[0].set(0,AXE_TOP_GRIP,0).applyQuaternion(q0).add(p0);       // the fist, in the forearm's space
    const sh=knightScene.getObjectByName(AXE_HEAD_RIGHT?'Right_Arm':'Left_Arm');
    if(sh){
      const P=_aV[1]; sh.getWorldPosition(P); { const tor=knightScene.getObjectByName('Torso'), o=_aV[3]; if(tor){ tor.getWorldPosition(o); o.subVectors(P,o); o.y=0; if(o.lengthSq()>1e-6) P.addScaledVector(o.normalize(),AXE_SHOULDER_OUT); } const fw=knightScene.getWorldDirection(_aV[3]); fw.y=0; if(fw.lengthSq()>1e-6) P.addScaledVector(fw.normalize(),-AXE_SHOULDER_BACK); } P.y+=AXE_SHOULDER_UP; hand.worldToLocal(P);   // the top of the shoulder, in the forearm's space
      const d=_aV[2].subVectors(P,G), L=d.length();
      if(L>1e-3){
        d.divideScalar(L);
        const y0=_aV[3].set(0,1,0).applyQuaternion(q0);
        g.quaternion.copy(_aQ.setFromUnitVectors(y0,d).multiply(q0));       // the handle points from the fist to the shoulder...
        g.position.copy(G).addScaledVector(d,-(AXE_SWOOSH.mid-(L+AXE_OVER_SHOULDER)));   // ...with the fist still on it, and the head just past the shoulder
      }
    }
  } else if(axeFollowK>0.001){
    const G=_aV[0].set(0,AXE_TOP_GRIP,0).applyQuaternion(q0).add(p0);       // the top grip, in the forearm's space
    const L=_aV[1].copy(axeOff.hc); axeOff.fore.localToWorld(L); hand.worldToLocal(L);   // the left fist, in the forearm's space
    const d=_aV[2].subVectors(G,L);
    if(d.lengthSq()>1e-4){
      d.normalize();
      const y0=_aV[3].set(0,1,0).applyQuaternion(q0);
      _aQ.setFromUnitVectors(y0,d).multiply(q0);                            // turn the axe about the top grip so the handle points from the left fist through the right
      g.quaternion.copy(q0).slerp(_aQ,axeFollowK);
      g.position.copy(G).sub(_aV[3].set(0,AXE_TOP_GRIP,0).applyQuaternion(g.quaternion));   // keep the top grip where it was
    }
  }
  const want=(AXE_BLADES_FRONT_BACK&&nm!=='AxeSwing'&&nm!=='SwingHeavyRelease')?1:0;
  axeRollK+=clamp(want-axeRollK,dt/AXE_BLADES_EASE);
  if(axeRollK<=0.001) return;
  hand.updateWorldMatrix(true,false);
  const base=g.quaternion, M=hand.matrixWorld, yW=_aV[0].set(0,1,0).applyQuaternion(base).transformDirection(M), bW=_aV[1].set(0,0,1).applyQuaternion(base).transformDirection(M);   // shaft and blade axis now, in the world
  const f=(nm==='AxeFlaunt'||nm===FLAUNT_IDLE)?_aV[2].set(0,1,0):knightScene.getWorldDirection(_aV[2]); f.addScaledVector(yW,-f.dot(yW));                                                                                                                       // the way he faces, across the shaft
  if(f.lengthSq()<1e-4) return;
  f.normalize();
  let phi=Math.atan2(yW.dot(_aV[3].crossVectors(bW,f)),bW.dot(f));
  if(phi>Math.PI/2) phi-=Math.PI; else if(phi<-Math.PI/2) phi+=Math.PI;
  if(M.determinant()<0) phi=-phi;                                                                                                                                                                       // a mirrored model turns the other way round
  g.quaternion.multiply(_aQ2.setFromAxisAngle(_aY,phi*axeRollK));       // a turn about the shaft, so the grip points don't move
}
/* ---------- Drinking_Potion: the potion in his left hand ----------
   potion-data is the bottle (potions.gltf), drinkpotion-data the clip. In the clip his left hand reaches back to the belt, comes round to the front (its lowest point is at 0.775 s) and then rises to his mouth.
   The bottle is NOT in his hand while the hand goes down for it: it only appears once the hand starts coming back up (POTION_OUT_AT), growing to full size over POTION_POP seconds like it is being pulled out,
   and it is gone again when the clip ends or another one starts. */
const POTION_OUT_AT=0.78, POTION_POP=0.12;   // seconds into Drinking_Potion when the bottle appears, and how long it takes to grow to full size
const POTION_SCALE=0.8, POTION_PIVOT_Y=1.34;  // size (1 = as modeled) and the point of the bottle that sits in his fist (lower body)
const POTION_NECK=[-0.35,0.3,0.88];           // where the neck points, in forearm space: roughly along the thumb side so it tips toward his mouth at the end of the clip
let potionGrp=null, drinkEndAt=null;
function initPotion(parent){
  const el=document.getElementById('potion-data'); if(!el) return;
  const F=parent.getObjectByName('Left_Forearm'), Hd=parent.getObjectByName('Adventurer_Left_Hand'); if(!F||!Hd) return;
  parent.updateMatrixWorld(true); const hc=new THREE.Box3().setFromObject(Hd).getCenter(new THREE.Vector3()); F.worldToLocal(hc);   // middle of his fist, in forearm space
  try{
    const raw=(function(){ const t=atob(el.textContent.trim()), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i); return u.buffer; })();   // the bottle is embedded as a binary glb (a data: url buffer gets blocked)
    new THREE.GLTFLoader().parse(raw,'',g=>{
      const cache=new Map();
      /* The glass texture is white at only ~37% alpha, and the game's shader throws away anything under 50% (that is why the bottle, rim and cork went missing and only the liquid showed).
         Any texture that is see-through all over is drawn as real translucent glass instead: kept down to a faint alpha, blended over what is behind it, and not written to the depth buffer so the liquid shows through. */
      const texAlpha=img=>{ const c=document.createElement('canvas'); c.width=img.width; c.height=img.height; const x=c.getContext('2d'); x.drawImage(img,0,0); const d=x.getImageData(0,0,c.width,c.height).data; let mx=0; for(let i=3;i<d.length;i+=4) mx=Math.max(mx,d[i]); return mx/255; };
      g.scene.traverse(o=>{ if(!o.isMesh) return; const om=o.material;
        if(!cache.has(om.uuid)){
          const m=ps1Mat(om.map,1);
          if(om.map&&om.map.image&&texAlpha(om.map.image)<0.95){
            m.fragmentShader=m.fragmentShader.replace('if(tx.a<0.5) discard;','if(tx.a<0.05) discard;').replace('gl_FragColor=vec4(c,1.0);','gl_FragColor=vec4(c,tx.a);');
            m.transparent=true; m.depthWrite=false; m.userData.glass=true;
          }
          cache.set(om.uuid,m);
        }
        o.material=cache.get(om.uuid); o.renderOrder=o.material.userData.glass?2:0; o.frustumCulled=false; });
      g.scene.position.y=-POTION_PIVOT_Y;
      const hold=new THREE.Group(); hold.add(g.scene);
      hold.position.copy(hc); hold.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3().fromArray(POTION_NECK).normalize());
      hold.scale.setScalar(POTION_SCALE); hold.visible=false; F.add(hold); potionGrp=hold;
    },e=>console.error('potion load failed',e));
  }catch(e){ console.error('potion failed',e); }
}
/* End of the clip: it plays once and holds its last pose (the bottle at his lips) for DRINK_HOLD seconds, then he goes back to Idle. */
const DRINK_HOLD=0.9;
/* While he drinks the sword hangs at his waist (his sword hand is the one with the bottle). Numbers are in the hips' space (x sideways, y up, z forward; the right hip is -x):
   WAIST_AT is where the grip sits, WAIST_DIR where the blade points (down and a little back), WAIST_ROLL_DEG turns it about the blade so the flat lies against his leg. The hatchet is put away (hidden) instead: it is too long to hang from a belt. */
const WAIST_CLIPS=['Drinking_Potion','UALX_ConsumeM'], WAIST_AT=[-0.27,0.1,0.0], WAIST_DIR=[0,-1,-0.28], WAIST_ROLL_DEG=90;
function waistStep(stow){
  const hips=knightScene&&knightScene.getObjectByName('Root_Hips');
  if(hatchetGrp&&weapon==='sword'&&swordStyle==='hatchet') hatchetGrp.visible=!stow;
  if(hammerGrp&&weapon==='sword'&&swordStyle==='hammer') hammerGrp.visible=!stow;
  if(knightlyGrp&&weapon==='sword'&&swordStyle==='knightly') knightlyGrp.visible=!stow;
  if(morningstarGrp&&weapon==='sword'&&swordStyle==='morningstar') morningstarGrp.visible=!stow;
  const g=swordGrp; if(!g||!hips) return;
  if(stow){
    if(!g.userData.home) g.userData.home={parent:g.parent,p:g.position.clone(),q:g.quaternion.clone()};
    if(g.parent!==hips){
      const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3().fromArray(WAIST_DIR).normalize())
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),WAIST_ROLL_DEG*Math.PI/180));
      hips.add(g); g.quaternion.copy(q); g.position.fromArray(WAIST_AT).sub(new THREE.Vector3(0,SWORD_GRIP_Y,0).applyQuaternion(q));
    }
  } else if(g.userData.home&&g.parent!==g.userData.home.parent){
    const h=g.userData.home; h.parent.add(g); g.position.copy(h.p); g.quaternion.copy(h.q);
  }
}
function potionStep(){
  const c=current&&current.getClip().name, drinking=(c==='Drinking_Potion');
  waistStep(!!current&&WAIST_CLIPS.indexOf(c)>=0&&weapon==='sword');
  if(drinking){   // the bottle reaches his mouth: the two sounds play one after the other, once per drink
    if(current.time<POTION_MOUTH_AT-0.05) potionSfxDone=false;
    else if(!potionSfxDone&&current.time>=POTION_MOUTH_AT){ potionSfxDone=true; playPotionSfx(); }
  } else potionSfxDone=false;
  if(drinking&&current.time>=current.getClip().duration-1e-4){   // finished: hold, then back to Idle
    const now=performance.now(); if(drinkEndAt===null) drinkEndAt=now; else if(now-drinkEndAt>=DRINK_HOLD*1000){ drinkEndAt=null; play(idleName()); return; }
  } else drinkEndAt=null;
  invDrinkStep();
  if(!potionGrp) return;
  const insp=invDrink.on&&c==='UALX_ConsumeM';
  const k=drinking?Math.min(1,Math.max(0,(current.time-POTION_OUT_AT)/POTION_POP)):insp?Math.min(1,Math.max(0,(current.time-INV_DRINK_OUT_AT)/POTION_POP)):0;
  potionGrp.visible=k>0; if(k>0) potionGrp.scale.setScalar(POTION_SCALE*(0.35+0.65*k));
  sparkleStep(k>0);
}
/* ---------- the potion's sound and sparkle ----------
   SOUND: when the bottle reaches his mouth (POTION_MOUTH_AT, seconds into Drinking_Potion: the same moment the heal lands) two files play one right after the other:
   SWAV_9_swav.wav, then 34.wav the instant the first one ends. They are embedded as potion-sfx-data and go through the same sound path (and the same crush option) as the other effects.
   POTION_SFX_GAIN balances them: the first file is much louder than the second.
   SPARKLE: sparkle1.gif (6 frames, packed into the strip below) floats right above the bottle for as long as the bottle is in his hand, always facing the camera. */
const POTION_MOUTH_AT=1.5, POTION_SFX_GAIN=[0.5,1.0];
const SPARKLE_PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAAAYCAYAAAAVpXQNAAABL0lEQVR42u2ZwQ6CMAyGC9mBaDT6DJx5/zfw5okzr6BEIuE2T0sWiWFAO1b5vxMI67p/bccmEQAAAAAAAGA9dTNYjnck2++hDw22c6QLYA2guhls1/bi0S/dB4ij/yiAqrLITpcDVWWRSTr/er5pahBrBqg9EaRsc+sffQlzAXq+HkkyUEEc/c2vTkKzY4kDVVlkS9uGfhy6LPN/4+zPz2R3z2E/hv+c+ptUhOPMMF/0qSyb6//3BHdtP3q2Rg9p/7kxWwknXeViBSgRqVyOufQ3qQnHVcIll0nffkiV2HqZkdTfpCjcnBKuZdusZQzR9Ndwyju1Ra2bwd7uD+uupXyUsM3l/2ZzjL8iwtr7k6xNoyTPgfZ67vKv51156uJr381oD36UAAAAAAAAAJj5AGwws9zOHmmpAAAAAElFTkSuQmCC';
const SPARKLE_FRAMES=6, SPARKLE_FRAME_MS=170, SPARKLE_SIZE=0.3, SPARKLE_LIFT=0.2, POTION_TOP_Y=0.207;   // size/lift in world units; POTION_TOP_Y = the bottle's rim above its pivot
let potionSfxDone=false, sparkle=null, sparkleLoading=false; const _sparkP=new THREE.Vector3();
function playPotionSfx(){
  try{
    if(!sfx) return;
    const st=SFX_SETS['potion-sfx-data'];
    if(!st||!st.bufs){ const l=loadSfxSet('potion-sfx-data'); loadSfxSet('v2-sword-sfx-data'); loadSfxSet('v2-block-sfx-data'); loadSfxSet('v2-grunt-data'); loadSfxSet('v2-die-data'); loadSfxSet('v2-flaunt-sfx-data'); loadSfxSet('slime-atk-sfx-data'); loadSfxSet('slime-hit-sfx-data'); loadSfxSet('slime-die-sfx-data'); loadSfxSet('slime-win-sfx-data'); if(l) l.then(()=>{ const q=SFX_SETS['potion-sfx-data']; if(q&&q.bufs) playPotionSfx(); }); return; }
    playSfxSet('potion-sfx-data',0,POTION_SFX_GAIN[0],1,0);
    playSfxSet('potion-sfx-data',1,POTION_SFX_GAIN[1],1,st.bufs[0].duration);   // starts exactly as the first one ends
  }catch(_){}
}
function sparkleStep(show){
  if(!sparkle){
    if(show&&!sparkleLoading){
      sparkleLoading=true;
      loadImg(SPARKLE_PNG).then(img=>{
        const t=new THREE.Texture(img); t.magFilter=t.minFilter=THREE.NearestFilter; t.generateMipmaps=false; t.repeat.set(1/SPARKLE_FRAMES,1); t.needsUpdate=true;
        const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:t,alphaTest:0.5,fog:false,depthWrite:false}));
        sp.scale.set(SPARKLE_SIZE,SPARKLE_SIZE,1); sp.visible=false; sp.renderOrder=6; scene.add(sp); sparkle=sp;
      }).catch(e=>console.error('sparkle failed',e));
    }
    return;
  }
  sparkle.visible=show; if(!show||!potionGrp) return;
  potionGrp.updateWorldMatrix(true,false);
  sparkle.position.copy(potionGrp.localToWorld(_sparkP.set(0,POTION_TOP_Y,0))); sparkle.position.y+=SPARKLE_LIFT;   // straight above the rim, whichever way the bottle tips
  sparkle.material.map.offset.x=(Math.floor(performance.now()/SPARKLE_FRAME_MS)%SPARKLE_FRAMES)/SPARKLE_FRAMES;
}
/* ---------- Chestopen: the chest ----------
   The chest (chest.gltf, embedded as a binary glb in CHEST_GLB) stands in front of him while the Chestopen clip plays and is hidden the rest of the time.
   Its own lid animation is driven by the knight's clip time, so the lid lifts exactly when his hands do.
   CHEST_SCALE: the chest is 1 unit wide in the model, so it is scaled up to meet his hands (1.7 puts the lid's front edge where his fists grip it).
   CHEST_POS: [side, up, forward] in the knight's own space - forward is how far in front of him the chest centre stands (its front face has to clear his toes, which reach about 0.72).
   CHEST_YAW_DEG: 90 turns the chest's front (its clasp) toward him; its hinge is then at the far side.
   While the clip plays the sword / hatchet / hammer are put away, and the axe hangs on his back (see AXE_STOW_CLIPS). */
const CHEST_SCALE=1.7, CHEST_POS=[0,0.09,1.6], CHEST_YAW_DEG=90;
/* ---------- the chest after the MOSSY RUINS are won ----------
   After the victory flaunt the screen fades out; he reappears past the spike fence on the far (west) side of the ruins, straight opposite the gate he walked in through - the clear lane the
   forest leaves for exactly this - facing west with the chest 1.6 in front of him (see CHEST_POS: it is parented to him). The chest pops in, Chestopen plays once, and when it has ended
   the screen fades to black and he is back at the menu (leaveDungeon).
   CHEST_SCENE_X: how far west of the circle he stands, in knight-heights (the fence is at ~3.45, the trees start at 5.6). CHEST_LOOK_FWD: how far in front of him the camera looks (knight-heights).
   CHEST_END_HOLD: seconds the last pose is held before the fade. DG_CHEST: the camera shot (same fields as DG_SHOTS; yaw 35 = from just east of south, outside the fence and clear of the walls, so his side, the lid and the chest's front are all in view).
   CHEST_POP_DELAY / CHEST_POP_TIME: the chest appears this long after the screen is back, then grows in over this long. */
const CHEST_SCENE_X=4.1, CHEST_LOOK_FWD=0.4, CHEST_END_HOLD=0.25, CHEST_POP_DELAY=0.3, CHEST_POP_TIME=0.45;
const DG_CHEST={yaw:35,drift:0.6,pitch:0.20,dist:3.0,ty:0.20,mid:0};
let chestScene=false, chestDone=false, chestEndT=-1, chestT0=0;
/* The lid's creak (drs_barrelsecret_open, embedded as an mp3 in CHEST_SFX): it plays when the lid starts to lift, CHEST_SFX_AT seconds into Chestopen (the lid clip starts moving at 2.58 s),
   once per run of the clip (in the menu loop, once per loop). It follows the sound-effects switch. */
const CHEST_SFX_AT=2.58, CHEST_SFX_GAIN=0.9; let chestSfxBuf=null, chestSfxLoading=null, chestPrevT=0;
function loadChestSfx(){
  if(chestSfxBuf||chestSfxLoading||!sfx) return chestSfxLoading;
  try{ const t=atob(CHEST_SFX), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i);
    chestSfxLoading=sfx.decodeAudioData(u.buffer).then(b=>{ chestSfxBuf=b; }).catch(e=>{ chestSfxLoading=null; console.error('chest sfx failed',e); }); }catch(e){ console.error(e); }
  return chestSfxLoading;
}
function playChestSfx(){
  try{
    if(!sfx) return;
    if(!chestSfxBuf){ const l=loadChestSfx(); if(l) l.then(()=>{ if(chestSfxBuf&&chestOn) playChestSfx(); }); return; }
    sfx.resume(); const src=sfx.createBufferSource(), g=sfx.createGain(); src.buffer=cz(chestSfxBuf); g.gain.value=CHEST_SFX_GAIN; src.connect(g); g.connect(sfx.destination); src.start(sfx.currentTime);
  }catch(e){ console.error('chest sfx',e); }
}
function chestReady(){ return !!(chestGrp&&actions.Chestopen); }
/* ---------- saving to a cookie ----------
   GameSave.get(key,default) / GameSave.set(key,value) keep any small JSON-able game data in one cookie ("kg_save", one year, this site only). The options (pixels, colors, bitcrush, weapon,
   helmet, world, music, armor/sword tint) are saved automatically a second after they change and put back when the game has loaded. Limits: a cookie holds about 4 KB in total, so keep to small things
   (flags, numbers, ids); and browsers do not keep cookies for a page opened straight from disk (file://), only when it is served over http(s), such as GitHub Pages or a local server. */
const GameSave=(function(){
  const NAME='kg_save'; let data={};
  const ok=()=>{ try{ return navigator.cookieEnabled; }catch(e){ return false; } };
  function read(){ try{ const m=document.cookie.split('; ').find(c=>c.indexOf(NAME+'=')===0); data=m?(JSON.parse(decodeURIComponent(m.slice(NAME.length+1)))||{}):{}; }catch(e){ data={}; } }
  function write(){ if(!ok()) return; try{ const v=encodeURIComponent(JSON.stringify(data)); if(v.length>3800){ console.warn('GameSave: too big for a cookie'); return; } document.cookie=NAME+'='+v+'; max-age=31536000; path=/; SameSite=Lax'; }catch(e){} }
  read();
  return {get:(k,d)=>(k in data?data[k]:d), set:(k,v)=>{ data[k]=v; write(); }, all:()=>data, clear:()=>{ data={}; write(); }};
})();
function settingsSnapshot(){ return {px:pixIdx,co:colIdx,cr:crushOn,wp:weapon,hm:curHelmet,wd:forest,mu:musicOn,at:armorHex,am:armorAmt,sh:swordHex,sm:swordMatch}; }
let lastSettings='', restoredSettings=false;
function restoreSettings(){
  const v=GameSave.get('s',null); restoredSettings=true; if(!v) return;
  try{
    if(typeof v.px==='number'&&v.px<PIX_STEPS.length) pixIdx=v.px;
    if(typeof v.co==='number'&&v.co<COL_STEPS.length){ colIdx=v.co; U.uLevels.value=COL_STEPS[colIdx][1]; }
    resize();
    if(typeof v.cr==='boolean'&&v.cr!==crushOn) toggleCrush();
    if(v.mu===false){ userChose=true; musicOn=false; try{ setSwitch('music',false,'Off'); }catch(e){} }
    if(typeof v.at==='string'||v.at===null){ armorHex=v.at; if(typeof v.am==='number') armorAmt=v.am; }
    if(typeof v.sh==='string'||v.sh===null) swordHex=v.sh; if(typeof v.sm==='boolean') swordMatch=v.sm;
    applyArmorTint();
    if(typeof v.hm==='number'&&v.hm>=0&&v.hm<helmetSets.length) setHelmet(v.hm);
    if(typeof v.wp==='string'&&v.wp!==weapon) setWeapon(v.wp);
    if(typeof v.wd==='boolean'&&v.wd!==forest) setWorld(v.wd);
  }catch(e){ console.error('restore settings failed',e); }
  lastSettings=JSON.stringify(settingsSnapshot());
}
setInterval(()=>{
  try{
    if(!restoredSettings){ if(knightScene&&actions.Idle&&helmetSets.length&&typeof setSwitch==='function') restoreSettings(); return; }   // wait until the game has loaded, then put the saved options back
    const j=JSON.stringify(settingsSnapshot()); if(j!==lastSettings){ lastSettings=j; GameSave.set('s',JSON.parse(j)); }
  }catch(e){}
},1000);

/* ---------- chest loot: three cards ----------
   After the chest opens, three cards rise up, one each of COMMON, UNCOMMON and RARE (shuffled left to right). Pick one (click it, or arrows/A/D + Enter, or 1/2/3) and the screen fades back to the menu.
   Nothing is stored yet: the pick is just remembered in loot.chosen. RARITY = the tier colours (all six; only the first three have items so far). LOOT = every item that can drop:
   add one with a rarity key and it joins its tier's draw. LOOT_TIERS = which tiers the three cards come from. icon is a placeholder letter until the models exist. */
const RARITY={
  common:{name:'COMMON',alt:'STANDARD',color:'#E0E0E0'}, uncommon:{name:'UNCOMMON',alt:'FINE',color:'#2ECC71'}, rare:{name:'RARE',alt:'SUPERIOR',color:'#3498DB'},
  epic:{name:'EPIC',alt:'HEROIC',color:'#9B59B6'}, legendary:{name:'LEGENDARY',alt:'MASTERWORK',color:'#F39C12'}, mythic:{name:'MYTHIC',alt:'ARTIFACT',color:'#E74C3C'},
  knightly:{name:'KNIGHTLY',alt:'HONORED',color:'#FFD966'}   // a tier of its own: no card is drawn from it yet (it is not in LOOT_TIERS)
};
const LOOT=[
  {id:'scrap',name:'SCRAP',rarity:'common',icon:'S',blurb:'Bent metal. Somebody might want it.'},
  {id:'rock',name:'ROCK',rarity:'common',icon:'R',blurb:'A rock. It is a good rock.'},
  {id:'nail',name:'BENT NAIL',rarity:'common',icon:'N',blurb:'Seen better days.'},
  {id:'hatchet',name:'HATCHET',rarity:'uncommon',icon:'H',blurb:'Light, quick, easy to carry.'},
  {id:'axe',name:'AXE',rarity:'uncommon',icon:'A',blurb:'Two hands and a long swing.'},
  {id:'hammer',name:'HAMMER',rarity:'rare',icon:'M',blurb:'Heavy. Makes a point.'},
  {id:'shovel',name:'SHOVEL',rarity:'rare',icon:'V',blurb:'For digging. Or for hitting.'},
  {id:'morningstar',name:'MORNINGSTAR',rarity:'rare',icon:'G',blurb:'A ball on a stick. The ball has opinions.'},
  {id:'knightly_sword',name:'KNIGHTLY SWORD',rarity:'knightly',icon:'K',blurb:'Gems that never go dark.'}
];
const LOOT_TIERS=['common','uncommon','rare'];
const loot={on:false,picked:false,sel:1,cards:[],el:null,chosen:null};
function showLoot(){
  if(loot.on) return;
  if(!document.getElementById('loot-css')){
    const st=document.createElement('style'); st.id='loot-css';
    st.textContent='#loot{position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4vh;background:rgba(0,0,0,.62);font-family:inherit;color:#fff;text-shadow:2px 2px 0 #000;animation:lootbg .5s steps(5,end) both;image-rendering:pixelated;-webkit-font-smoothing:none;text-rendering:optimizeSpeed}'
    +'@keyframes lootbg{from{opacity:0}to{opacity:1}}@keyframes lootup{from{opacity:0;transform:translateY(60px)}to{opacity:1;transform:none}}'
    +'#loot .lh{font-size:clamp(28px,4.2vw,56px);letter-spacing:.18em}#loot .lr{display:flex;gap:clamp(12px,2.4vw,36px);align-items:stretch}'
    +'#loot .card{--c:#fff;width:clamp(150px,19vw,260px);padding:16px 14px 18px;background:#1b1b21;border:4px solid var(--c);border-radius:0;color:#fff;font:inherit;text-align:center;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:10px;box-shadow:0 0 0 2px #000,0 0 0 6px color-mix(in srgb,var(--c) 55%,transparent),0 0 0 12px color-mix(in srgb,var(--c) 28%,transparent),0 0 0 18px color-mix(in srgb,var(--c) 12%,transparent);opacity:0;animation:lootup .55s steps(6,end) both;transition:transform .15s steps(3),box-shadow .15s steps(3),opacity .35s steps(4)}'
    +'#loot .card.on,#loot .card:hover{transform:translateY(-12px);box-shadow:0 0 0 2px #000,0 0 0 8px color-mix(in srgb,var(--c) 55%,transparent),0 0 0 16px color-mix(in srgb,var(--c) 28%,transparent),0 0 0 24px color-mix(in srgb,var(--c) 12%,transparent)}'
    +'#loot .rar{font-size:clamp(16px,1.7vw,24px);letter-spacing:.2em;color:var(--c)}#loot .rar small{display:block;font-size:.62em;opacity:.7;letter-spacing:.3em}'
    +'#loot .ico{width:100%;aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border:3px dashed var(--c);background:rgba(255,255,255,.04);color:var(--c);font-size:clamp(56px,7vw,110px);line-height:1}'
    +'#loot .ico small{font-size:clamp(10px,1vw,14px);letter-spacing:.2em;opacity:.65;margin-top:6px}'
    +'#loot .nm{font-size:clamp(22px,2.4vw,34px);letter-spacing:.1em}#loot .bl{font-size:clamp(13px,1.3vw,19px);opacity:.78;line-height:1.15}'
    +'#loot .hint{font-size:clamp(14px,1.5vw,22px);opacity:.7;letter-spacing:.2em}'
    +'#loot.done .card:not(.pick){opacity:0;transform:translateY(8px)}#loot.done .card.pick{transform:translateY(-16px);box-shadow:0 0 0 2px #000,0 0 0 12px color-mix(in srgb,var(--c) 55%,transparent),0 0 0 24px color-mix(in srgb,var(--c) 28%,transparent),0 0 0 36px color-mix(in srgb,var(--c) 12%,transparent)}#crt{z-index:100000}';   /* #crt (scanlines + vignette) goes over the loot screen too */
    document.head.appendChild(st);
  }
  const picks=LOOT_TIERS.map(t=>{ const pool=LOOT.filter(i=>i.rarity===t); return pool[Math.floor(Math.random()*pool.length)]; }).filter(Boolean);
  for(let i=picks.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [picks[i],picks[j]]=[picks[j],picks[i]]; }
  const el=document.createElement('div'); el.id='loot';
  el.innerHTML='<div class="lh">CHOOSE YOUR REWARD</div><div class="lr"></div><div class="hint">CLICK A CARD, OR  &lt; &gt;  AND ENTER</div>';
  const row=el.querySelector('.lr'); loot.cards=[];
  picks.forEach((it,i)=>{
    const r=RARITY[it.rarity], b=document.createElement('button'); b.className='card'; b.style.setProperty('--c',r.color); b.style.animationDelay=(0.25+i*0.18)+'s';
    b.innerHTML='<div class="rar">'+r.name+'<small>'+r.alt+'</small></div><div class="ico">'+it.icon+'<small>MODEL TBD</small></div><div class="nm">'+it.name+'</div><div class="bl">'+it.blurb+'</div>';
    b.onmouseenter=()=>lootSel(i); b.onclick=()=>lootPick(i); row.appendChild(b); loot.cards.push({it,b});
  });
  document.body.appendChild(el); loot.el=el; loot.on=true; loot.picked=false; loot.chosen=null; lootSel(1);
}
function lootSel(i){ if(loot.picked) return; if(i!==loot.sel&&loot.on) { try{ blip(520,0.05); }catch(_){} } loot.sel=i; loot.cards.forEach((c,k)=>c.b.classList.toggle('on',k===i)); }
function lootPick(i){
  if(!loot.on||loot.picked||!loot.cards[i]) return;
  loot.picked=true; loot.chosen=loot.cards[i].it; GameSave.set('lastLoot',loot.chosen.id); try{ blip(880,0.12); }catch(_){}
  loot.cards[i].b.classList.add('pick'); loot.el.classList.add('done');
  setTimeout(()=>{ hideLoot(); leaveDungeon(); },1200);
}
function hideLoot(){ if(loot.el&&loot.el.parentNode) loot.el.parentNode.removeChild(loot.el); loot.el=null; loot.on=false; loot.cards=[]; }
addEventListener('keydown',e=>{
  if(!loot.on) return;
  const k=e.key, n=loot.cards.length; let used=true;
  if(loot.picked){ }
  else if(k==='ArrowLeft'||k==='a'||k==='A') lootSel((loot.sel+n-1)%n);
  else if(k==='ArrowRight'||k==='d'||k==='D') lootSel((loot.sel+1)%n);
  else if(k==='Enter'||k===' ') lootPick(loot.sel);
  else if(k>='1'&&k<='3'&&+k<=n){ lootSel(+k-1); lootPick(+k-1); }
  else used=false;
  if(used){ e.preventDefault(); e.stopImmediatePropagation(); }
},true);

function startChestScene(){
  if(dgBusy) return; dgBusy=true;
  fadeThen(()=>{   // everything below happens while the screen is black
    dgBusy=false; const H=playerH;
    chestScene=true; chestDone=false; chestEndT=-1; loot.picked=false; dgState='chest'; moving=false;
    swooshHide(); clearEnemies(); if(dgSlots) dgSlots.visible=false; setTurnLabel('');
    playerRig.position.set(-CHEST_SCENE_X*H,0,0); heading=-Math.PI/2; playerRig.rotation.y=heading;   // facing west, toward the chest
    play('Chestopen');
    dgStart(DG_CHEST,false); dgDur=1e9;
    dungeonStep(0);   // camera and shadow are in place before the screen fades back in
  });
}
let chestGrp=null, chestMixer=null, chestAct=null, chestOn=false; const chestShineMats=[];   // chestShineMats: the chest's metal, switched with the Shiny metal option like the armor
function initChest(rig){
  try{
    const t=atob(CHEST_GLB), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i);   // a binary glb: a data: url buffer gets blocked
    new THREE.GLTFLoader().parse(u.buffer,'',g=>{
      const cache=new Map();
      /* Parts the model labels 'apply ushine' (the bands, studs, hinge pins and clasp) get the armor's metal shine; the wood stays matte. A material shared with an unlabelled part is split in two. */
      const isMetal=o=>{ for(let p=o;p;p=p.parent) if(p.userData&&p.userData.name==='apply ushine') return true; return false; };
      g.scene.traverse(o=>{ if(!o.isMesh) return; const om=o.material, metal=isMetal(o), key=om.uuid+(metal?'m':'');
        if(!cache.has(key)){ const nm=ps1Mat(om.map,1); if(metal){ shineMat(nm); chestShineMats.push(nm); } cache.set(key,nm); }
        o.material=cache.get(key); });
      const grp=new THREE.Group(); grp.name='Chest'; grp.add(g.scene);
      grp.scale.setScalar(CHEST_SCALE); grp.position.set(CHEST_POS[0],CHEST_POS[1],CHEST_POS[2]); grp.rotation.y=CHEST_YAW_DEG*Math.PI/180; grp.visible=false;
      const blob=new THREE.Mesh(new THREE.CircleGeometry(0.78,16),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.42,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
      blob.rotation.x=-Math.PI/2; blob.position.y=-0.045; grp.add(blob);   // a soft shadow on the ground, like the knight's
      rig.add(grp); chestGrp=grp;
      if(g.animations[0]){ chestMixer=new THREE.AnimationMixer(g.scene); chestAct=chestMixer.clipAction(g.animations[0]); chestAct.setLoop(THREE.LoopOnce,1); chestAct.clampWhenFinished=true; chestAct.play(); }
    },e=>console.error('chest load failed',e));
  }catch(e){ console.error('chest',e); }
}
function chestStep(){   // called right after every mixer update
  const on=!!(chestGrp&&current&&current.getClip().name==='Chestopen');
  if(chestGrp) chestGrp.visible=on;
  if(on&&!chestOn){ chestT0=performance.now(); chestPrevT=0; loadChestSfx(); }
  if(on){
    { const t=(performance.now()-chestT0)/1000-CHEST_POP_DELAY, x=Math.min(1,Math.max(0,t/CHEST_POP_TIME)), c1=1.70158, k=x-1;   // easeOutBack: grows past full size and settles
      chestGrp.scale.setScalar(CHEST_SCALE*Math.max(0.0001,1+(c1+1)*k*k*k+c1*k*k)); }
    if(swordGrp) swordGrp.visible=false; if(hatchetGrp) hatchetGrp.visible=false; if(hammerGrp) hammerGrp.visible=false; if(knightlyGrp) knightlyGrp.visible=false; if(morningstarGrp) morningstarGrp.visible=false;
    if(current.time>=CHEST_SFX_AT&&chestPrevT<CHEST_SFX_AT) playChestSfx();   // the lid starts to lift
    chestPrevT=current.time;
    if(chestAct){ chestAct.reset(); chestAct.time=current.time; chestMixer.update(0); }   // lid follows the knight's clock (reset first: the lid clip holds its last pose once it has finished)
  } else if(chestOn) showWeapons();
  chestOn=on;
}
const CHEST_DATA=JSON.parse(document.getElementById('chest-data').textContent);   // chest-data.json: the Chestopen clip, the lid's creak (mp3, base64) and the chest model (glb, base64)
const CHESTOPEN_CLIP=CHEST_DATA.clip, CHEST_SFX=CHEST_DATA.sfx, CHEST_GLB=CHEST_DATA.glb;
function stickAxe(){   // called right after every mixer update
  syncBlockFlip(); potionStep(); chestStep();
  if(!axeOff||!axeGrp||!axeGrp.visible||!current) return;
  try{ axePose(current.getClip().name); }
  catch(e){ if(!stickAxe.warned){ stickAxe.warned=true; console.error('stickAxe',e); } }
}
function swingName(){ return weapon==='axe'&&actions.AxeSwing?'AxeSwing':'Swing'; }   // the swing that goes with the weapon in his hand
function swingScaleReset(){ if(actions.Swing) actions.Swing.timeScale=1; if(actions.AxeSwing) actions.AxeSwing.timeScale=1; }
function idleName(){ return weapon==='axe'&&actions.AxeIdle?'AxeIdle':'Idle'; }   // the idle that goes with the weapon in his hand
function resolveAnim(n){ const v=AXE_VARIANT[n]; return (weapon==='axe'&&v&&actions[v])?v:n; }   // the clip a menu entry plays right now (Idle/Swing/Flaunt -> the axe's version while the axe is out)
function menuPlay(n){ play(resolveAnim(n)); }
function refreshAnim(){   // after the weapon changes: if Idle / Swing / Flaunt is playing, switch to the version that matches the new weapon
  const c=current&&current.getClip().name, b=AXE_BASE[c]||c; if(!AXE_VARIANT[b]) return;
  const want=resolveAnim(b); if(c===FLAUNT_IDLE&&want==='AxeFlaunt') return; if(want!==c) play(want);
}
function setWeapon(w){
  weapon=w; showWeapons(); applyHandedness();
  try{ ualApply(); }catch(e){}   // ANIM SET: the axe's Block uses a different clip from the sword's
  swooshHide(); setSwitch('sword',true,w==='axe'?'Axe':'Sword');
}
function toggleWeapon(){
  setWeapon(weapon==='axe'?'sword':'axe');
  refreshAnim();
}
/* ---------- sword swoosh (sword_swoosh_wip1.gif: 6 frames, packed into the strip below) ----------
   While the Swing clip plays, the blade's path is sampled in tiny sub-steps, so the 15 fps pose stepping can't skip over the arc.
   Only the fast part of the swing (the chop, not the wind-up or the recovery) leaves a trail: a camera-facing ribbon is laid along
   the path of the tip and the swoosh frames are mapped onto it - sharp tail at the oldest end, fat flat end right behind the blade.
   The frames then play in place (the tail erodes first) while the sword carries on. Options > SWOOSH turns it off. */
const SWOOSH_TIP_Y=1.66, SWOOSH_HILT_Y=0.85;   // blade tip / grip along the sword's own axis (see sword-data)
const SWOOSH_WIDTH=0.55;      // ribbon width, in sword units (the blade is ~0.7 long)
const SWOOSH_OUT=0.15;        // fraction of the width that sits outside the tip's path (0 = the tip runs along the outer edge)
const SWOOSH_FLIP_U=false;    // true = mirror the sprite across the ribbon (bright rim on the inside instead of the outside)
const SWOOSH_FRAME_MS=95;     // time per frame. The GIF itself uses 170 ms, which lingers long after a ~0.1 s chop
const SWOOSH_START_SPEED=11;  // tip speed (sword units per second) that starts a trail...
const SWOOSH_STOP_SPEED=6.5;  // ...and the speed under which it stops growing. The wind-up peaks near 7, the chop near 16
const SWOOSH_MIN_CLIP_T=0.12; // ignore the first moments of a swing (the cross-fade from idle looks like fast motion)
const SWOOSH_STEP=1/120;      // sampling step while swinging, in seconds
const SWOOSH_MAXPTS=48, SWOOSH_FRAMES=6;
const SWOOSH_PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAAlCAYAAADr98PUAAAB7ElEQVR42u2cUY6DMAxEIeIYnIXD5yzcg/2Klq2WEogdbPNGqlS1H5PEk4ntCMahA3LO2+dvy7KMAwDCmHqIeJ7nP/+t68rKAxWMvUS8FzPuDEwLugj5SMSIGbhIOWqFDIB5h845b1eErO3O+3SHUwCHVhWzJj5PCQpOBK2eYmi4M+kOaBK0FVf+JmSKTjBpi1lKZFYcuYyDjWMTyYMzlzFYGsd/t5/AgaAtpBg1Qu7RRSFfdy7o1iC2isxS3o6YnQv66SBaFjPFJykHzgyeE/STgUTMQFTQBJI18IwJIdncUOU7uXqDQyMoO8Uw/W7nRaGlCxxOqACCZjEBDn2C2iMTdz7mJ+24IegI7twS+KvzlxYZp2OgHJpgAklMb18ACsHfcZTvnluFCYcEkVqF6inHtwWS3kxXg9HCLxF4q8WwZ1GnAYQueN9WvyTPAWnhkghmz85KlE2EQ7/UPbV5otZOKeKOj3oZ0Xte2nw55618cGjHQqMY1euspKgO07O7EvkE0uDS7Kx0d+jIqUcNn9Rmuju3O/ye6oS0LMsY+X1w0fJO71xnG6qVZywkNROSQnlquifv/kntHrxHT4afcd/hLYZUc2V9xF/Le4Wrhfcuz9g6oLuoHagk75XFkeKVCrwWXwuv5CvepHh+AOr/DXyfkM+zAAAAAElFTkSuQmCC';
let swooshOn=true, swTip=null, swHilt=null, swPivot=null;
/* Each weapon has its own swoosh rig: two marker points on it (swTip = the leading end of the blade/head, swHilt = back toward the hand, which just gives the scale), the shoulder the trail
   is measured from, the ribbon's width, and the tip speeds (in weapon units per second) that start and stop a trail. Only the weapon in his hand is used. */
let swLen=SWOOSH_TIP_Y-SWOOSH_HILT_Y, swWidth=SWOOSH_WIDTH, swStart=SWOOSH_START_SPEED, swStop=SWOOSH_STOP_SPEED, swAlt=null, swFlag=0, swFlagOn=false;   // swFlag: the two-handed weapons - the trail is a flag on the weapon's top, this long (weapon units)   // swAlt: the second bit of a double-bitted head
const swRigs={};
/* The Axe: its head has a cutting edge at each end (the two bits, at +/- bit along the blade axis, halfway up the head at mid). The trail follows whichever bit is leading the swing:
   both are watched, the faster one when a trail starts keeps it. hilt = the top grip, only for the scale. Speeds are in axe units per second and a bit moves faster than the middle
   of the head did, so they are a bit higher than before (start/stop the trail). Tuned by reading the clip, not by eye: nudge start/stop if the trail comes too early or lingers. */
const SHOVEL_TOP_Y=2.138;   // the top of the shovel model, along its shaft
const AXE_SWOOSH={bit:0.875,mid:1.906,hilt:1.366,width:0.75,start:10.5,stop:7.5};
/* The Hatchet follows the sword's swing, so it uses the sword's speeds; the trail follows the edge of its head (tip = the outer corner of the blade). */
const HATCHET_SWOOSH={tip:[0,1.766,-0.48],hilt:[0,1.0,0],width:0.5};
const HAMMER_SWOOSH={tip:[0,1.2,0.44],hilt:[0,0.6,0.125],width:0.4};   // the trail follows the far face of the head
const MORNINGSTAR_SWOOSH={tip:[0,1.1775,0.264],hilt:[0,0.81,0],width:0.3};   // the trail follows the spikes on the far side of the ball (tip = the spike's point at the ball's height)
function swooshAddRig(key,grp,pivot,tipPos,hiltPos,o){
  const tip=new THREE.Object3D(), hilt=new THREE.Object3D();
  tip.position.set(tipPos[0],tipPos[1],tipPos[2]); hilt.position.set(hiltPos[0],hiltPos[1],hiltPos[2]); grp.add(tip); grp.add(hilt);
  let alt=null; if(o.alt){ alt=new THREE.Object3D(); alt.position.set(o.alt[0],o.alt[1],o.alt[2]); grp.add(alt); }
  swRigs[key]={tip,hilt,alt,pivot,len:tip.position.distanceTo(hilt.position),width:o.width,start:o.start,stop:o.stop,flag:o.flag||0};
}
/* The Knightly Sword's swing trail is a bright fade through the colours of the gems set in its blade (red, orange, yellow, green, teal, pink - the shader's gem list): the trail is painted in them, running along its length from the tail (oldest) to the tip (newest), and the whole
   palette rolls along it as the swing goes (the shader's uRainbow / uHue). SWOOSH_RAINBOW_CYCLES = how many times the full palette repeats along the trail; SWOOSH_RAINBOW_SPEED = how fast it rolls (spectra per second);
   SWOOSH_RAINBOW_BRIGHT = brightness boost on the picture's own light and dark (above 1 = punchier). Every other weapon keeps the plain trail. */
const SWOOSH_RAINBOW_CYCLES=1.0, SWOOSH_RAINBOW_SPEED=2.5, SWOOSH_RAINBOW_BRIGHT=1.35;
let swTintOn=false;   // (the Knightly Sword is held)
function swooshApplyTint(){ if(swsh.mat) swsh.mat.uniforms.uRainbow.value=swTintOn?1:0; }
function swooshUse(){
  const key=weapon==='axe'?'axe':(swordStyle==='hatchet'?'hatchet':swordStyle==='hammer'?'hammer':swordStyle==='knightly'?'knightly':swordStyle==='morningstar'?'morningstar':'sword'), r=swRigs[key]||swRigs.sword; if(!r) return;
  swTintOn=(key==='knightly'); swooshApplyTint();
  swTip=r.tip; swAlt=r.alt||null; swHilt=r.hilt; swPivot=r.pivot; swLen=r.len; swWidth=r.width; swStart=r.start; swStop=r.stop; swFlag=r.flag||0; swFlagOn=false; swsh.hasPrev=false; swsh.emit=false;
}
const swsh={mesh:null,geo:null,mat:null,pts:[],emit:false,active:false,age:0,hasPrev:false,k:1,
  prevP:new THREE.Vector3(),prevP2:new THREE.Vector3(),alt:false,a2:new THREE.Vector3(),prevC:new THREE.Vector3(),a:new THREE.Vector3(),b:new THREE.Vector3(),c:new THREE.Vector3(),
  tan:new THREE.Vector3(),tc:new THREE.Vector3(),w:new THREE.Vector3(),out:new THREE.Vector3(),
  cum:new Float32Array(SWOOSH_MAXPTS),W:new Float32Array(SWOOSH_MAXPTS*3)};
const SWOOSH_VS=`
uniform vec2 uRes; uniform float uSnap; varying vec2 vUv;
void main(){
  vec4 cp=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  if(uSnap>0.5){ vec2 n=cp.xy/cp.w; vec2 g=uRes*0.5; n=floor(n*g+0.5)/g; cp.xy=n*cp.w; }   // same vertex snapping as everything else
  gl_Position=cp; vUv=uv;
}`;
const SWOOSH_FS=`
uniform sampler2D map; uniform float uFrame; uniform float uFrames; uniform float uFade; uniform float uRainbow; uniform float uHue; uniform float uCycles; uniform float uBright; varying vec2 vUv;
void main(){
  if(uFade<0.999 && fract(dot(floor(gl_FragCoord.xy),vec2(0.7548776662,0.5698402910)))>=uFade) discard;   // fade in/out as a dither, to match the picture
  vec4 tx=texture2D(map,vec2((uFrame+clamp(vUv.x,0.002,0.998))/uFrames,clamp(vUv.y,0.002,0.998)));
  if(tx.a<0.5) discard;
  vec3 col=tx.rgb;
  if(uRainbow>0.5){   // the Knightly Sword: the colours of its own gems (red, orange, yellow, green, teal, pink) fade into one another along the trail, rolling with uHue; the picture's own lights and darks shape how bright it is
    float h=fract(vUv.y*uCycles+uHue)*6.0, gi=floor(h), gf=smoothstep(0.0,1.0,h-gi);
    vec3 g0=vec3(0.925,0.157,0.204), g1=vec3(0.957,0.533,0.094), g2=vec3(0.980,0.839,0.220), g3=vec3(0.251,0.886,0.408), g4=vec3(0.220,0.847,0.722), g5=vec3(0.973,0.329,0.471);
    vec3 ga=gi<0.5?g0:(gi<1.5?g1:(gi<2.5?g2:(gi<3.5?g3:(gi<4.5?g4:g5))));
    vec3 gb=gi<0.5?g1:(gi<1.5?g2:(gi<2.5?g3:(gi<3.5?g4:(gi<4.5?g5:g0))));
    vec3 rgb=mix(ga,gb,gf);
    float l=dot(tx.rgb,vec3(0.299,0.587,0.114));
    col=clamp(rgb*(0.45+l*uBright),0.0,1.0);
    col=mix(col,vec3(1.0),smoothstep(0.9,1.0,l)*0.35);   // only the very brightest core of the picture goes hot white
  }
  gl_FragColor=vec4(col,1.0);
}`;
function initSwoosh(grp,parent){
  swTip=new THREE.Object3D(); swTip.position.set(0,SWOOSH_TIP_Y,0); grp.add(swTip);
  swHilt=new THREE.Object3D(); swHilt.position.set(0,SWOOSH_HILT_Y,0); grp.add(swHilt);
  swPivot=parent.getObjectByName(SWORD_HAND+'_Arm')||parent.getObjectByName(SWORD_HAND+'_Forearm');   // the shoulder: tells the ribbon which edge is "outside"
  swRigs.sword={tip:swTip,hilt:swHilt,pivot:swPivot,len:SWOOSH_TIP_Y-SWOOSH_HILT_Y,width:SWOOSH_WIDTH,start:SWOOSH_START_SPEED,stop:SWOOSH_STOP_SPEED}; swooshUse();
  if(swsh.mesh) return;
  loadImg(SWOOSH_PNG).then(img=>{
    const tex=new THREE.Texture(img); tex.flipY=false; tex.encoding=THREE.LinearEncoding; tex.generateMipmaps=false;
    tex.minFilter=tex.magFilter=THREE.NearestFilter; tex.needsUpdate=true;
    swsh.mat=new THREE.ShaderMaterial({vertexShader:SWOOSH_VS,fragmentShader:SWOOSH_FS,side:THREE.DoubleSide,
      uniforms:{map:{value:tex},uFrame:{value:0},uFrames:{value:SWOOSH_FRAMES},uFade:{value:1},uRainbow:{value:0},uHue:{value:0},uCycles:{value:SWOOSH_RAINBOW_CYCLES},uBright:{value:SWOOSH_RAINBOW_BRIGHT},uRes:U.uRes,uSnap:U.uSnap}});
    swooshApplyTint();
    const M=SWOOSH_MAXPTS, geo=new THREE.BufferGeometry();
    const pa=new THREE.BufferAttribute(new Float32Array(M*2*3),3), ua=new THREE.BufferAttribute(new Float32Array(M*2*2),2);
    pa.setUsage(THREE.DynamicDrawUsage); ua.setUsage(THREE.DynamicDrawUsage);
    const idx=[]; for(let i=0;i<M-1;i++){ const a=2*i; idx.push(a,a+1,a+2, a+1,a+3,a+2); }
    geo.setAttribute('position',pa); geo.setAttribute('uv',ua); geo.setIndex(idx); geo.setDrawRange(0,0);
    const mesh=new THREE.Mesh(geo,swsh.mat); mesh.name='SwordSwoosh'; mesh.frustumCulled=false; mesh.visible=false; mesh.renderOrder=5;
    scene.add(mesh); swsh.mesh=mesh; swsh.geo=geo;
  }).catch(e=>console.error('swoosh load failed',e));
}
function swooshHide(){ swFlagOn=false; swsh.active=false; swsh.emit=false; swsh.pts.length=0; if(swsh.mesh) swsh.mesh.visible=false; }
function toggleSwoosh(){ swooshOn=!swooshOn; if(!swooshOn) swooshHide(); }
/* one sample of the blade, taken between mixer sub-steps; h = seconds since the previous sample */
function swooshSample(h){
  if(swFlag>0) return;   // the flag is handled in updateFlag
  if(!swTip||!swHilt||!swPivot||!swsh.mesh) return;
  const a=swsh.a,a2=swsh.a2,b=swsh.b,c=swsh.c;
  swTip.getWorldPosition(a); if(swAlt) swAlt.getWorldPosition(a2); swHilt.getWorldPosition(b); swPivot.getWorldPosition(c);
  const k=a.distanceTo(b)/swLen; if(!(k>1e-5)) return;        // k = world units per weapon unit
  const sp1=swsh.hasPrev?a.distanceTo(swsh.prevP)/h/k:0, sp2=(swAlt&&swsh.hasPrev)?a2.distanceTo(swsh.prevP2)/h/k:0;
  if(!swsh.emit) swsh.alt=!!swAlt&&sp2>sp1;                    // a double-bitted head: the bit that is moving faster leads, and keeps the trail for this swing
  const cur=swsh.alt?a2:a, speed=swsh.alt?sp2:sp1, prev=swsh.alt?swsh.prevP2:swsh.prevP;
  if(!swsh.emit&&current&&current.time>=SWOOSH_MIN_CLIP_T&&speed>=swStart){
    swsh.emit=true; swsh.active=true; swsh.age=0; swsh.pts.length=0;
    swsh.pts.push({p:prev.clone(),c:swsh.prevC.clone()});                             // start from where the blade just was
  }
  if(swsh.emit){
    if(speed<swStop||swsh.pts.length>=SWOOSH_MAXPTS) swsh.emit=false;
    else { swsh.pts.push({p:cur.clone(),c:c.clone()}); swsh.k=k; }
  }
  swsh.prevP.copy(a); swsh.prevP2.copy(a2); swsh.prevC.copy(c); swsh.hasPrev=true;
}
/* advance the mixer; while the sword swings, do it in small steps and sample the blade after each one */
/* DANCE: a 16-beat loop at 147 BPM (6.531 s) whose first beat is the song's beat at 0.33 s. While it plays, its time is slaved to the song's position, so it stays on the beat
   whatever the frame rate and through every loop of the song (the song itself is shorter than a whole number of beats). */
const DANCE_BPM=147, DANCE_BEATS=16, DANCE_OFFSET=0.33;
/* DANCE2: the Dancing Twerk (a Mixamo dance, 15.17 s at 24 fps, retargeted onto this rig) on the 'Smash Bros' song, whose beat falls on 0.58 s + n * 0.6654 s (90.18 BPM). The dance bounces at about 102 BPM
   by itself, so it is slowed 14 percent to bounce once per beat: 26 beats = 17.30 s, the clip's whole length. Same arrangement as Dance: its time is slaved to the song. `beats` = the clip's length in beats
   (Dance uses DANCE_BEATS); `shift` = seconds added to the clip's time so the dance's downward bounces land ON the beat, not between them. */
const DANCE_SETS={Dance:{key:'dance',bpm:147,offset:0.33},Dance2:{key:'dance2',bpm:90.18,offset:0.58,beats:26,shift:0.5716},
  Dance3:{key:'dance3',free:true}};   // Dance3 (Wave Hip Hop Dance + 'Egyptian Swag'): no syncing - the clip just loops and the song just plays
let danceKey='dance';
function danceStep(){
  const n=current&&current.getClip().name, D=DANCE_SETS[n];
  if(!danceWant||!D||D.free||!xtra[D.key].src||current!==actions[n]) return;   // (free = not slaved to the song)
  const L=(D.beats||DANCE_BEATS)*60/D.bpm, t=trackPos(xtra[D.key].src)-D.offset-0.03+(D.shift||0);   // (0.03: the pose shown lags a little behind the clock)
  actions[n].time=((t%L)+L)%L;
}
/* The UAL heavy combos lift his whole body off the floor (the hips' height comes straight from the mocap), so while one plays his height is controlled: every frame the rig is moved up or
   down so his lowest foot is exactly on the ground, and put back to its normal height as soon as the clip is over. */
let ualY0=null; const _ugB=new THREE.Box3(), UAL_GROUND=/^(UAL_.*Heavy|HeavyCombo)/;
function ualGround(){
  if(!playerRig||!current) return;
  const c=current.getClip(), src=c.ualSrc||c.name;
  if(!UAL_GROUND.test(src)){ if(ualY0!==null){ playerRig.position.y=ualY0; ualY0=null; } return; }
  if(ualY0===null) ualY0=playerRig.position.y;
  playerRig.position.y=ualY0; playerRig.updateMatrixWorld(true);
  let lo=1e9; ['Adventurer_Left_Foot','Adventurer_Right_Foot','Adventurer_Left_Boot','Adventurer_Right_Boot'].forEach(n=>{ const o=playerRig.getObjectByName(n); if(o){ _ugB.setFromObject(o); if(_ugB.min.y<lo) lo=_ugB.min.y; } });
  if(lo<1e8){ const ground=(blobHome?blobHome.y:0)-0.002*playerH; playerRig.position.y=ualY0+(ground-lo); }
}
function stepMixer(dt){
  evStep(dt);
  const cn=current&&current.getClip().name, onSwing=swooshOn&&swTip&&swsh.mesh&&(cn==='Swing'||cn==='AxeSwing'||cn==='SwingHeavyRelease'||cn==='HeavyCombo'||/^UAL_(Sword_Regular|Sword_Heavy|Melee_Hook)/.test(cn));
  if(!onSwing){ swsh.hasPrev=false; swsh.emit=false; mixer.update(dt); stickAxe(); ualGround(); return; }
  const n=Math.max(1,Math.ceil(dt/SWOOSH_STEP-1e-6)), h=dt/n;
  for(let i=0;i<n;i++){ mixer.update(h); swooshSample(h); }
  stickAxe(); ualGround();
}
/* lay the ribbon along the sampled path, facing the camera; u runs across it (0 = outside), v along it (0 = oldest = sharp tail) */
function swooshBuild(){
  const P=swsh.pts, n=P.length, m=swsh.mesh;
  if(n<2){ m.visible=false; return; }
  const cum=swsh.cum, W=swsh.W; cum[0]=0;
  for(let i=1;i<n;i++) cum[i]=cum[i-1]+P[i].p.distanceTo(P[i-1].p);
  const tot=cum[n-1]; if(!(tot>1e-6)){ m.visible=false; return; }
  const tan=swsh.tan,tc=swsh.tc,w=swsh.w,out=swsh.out, cam=camera.position;
  let score=0;
  for(let i=0;i<n;i++){
    const p=P[i].p;
    tan.subVectors(P[Math.min(i+1,n-1)].p,P[Math.max(i-1,0)].p);
    tc.subVectors(cam,p);
    w.crossVectors(tan,tc);
    if(w.lengthSq()<1e-12){ if(i>0) w.set(W[3*i-3],W[3*i-2],W[3*i-1]); else w.set(0,1,0); }
    w.normalize();
    if(i>0&&w.x*W[3*i-3]+w.y*W[3*i-2]+w.z*W[3*i-1]<0) w.negate();                    // keep the ribbon from twisting
    W[3*i]=w.x; W[3*i+1]=w.y; W[3*i+2]=w.z;
    out.subVectors(p,P[i].c); score+=w.dot(out);                                      // does this side point away from the shoulder?
  }
  const s=score<0?-1:1, total=swWidth*swsh.k, uA=SWOOSH_FLIP_U?1:0, uB=1-uA;
  const pa=swsh.geo.attributes.position, ua=swsh.geo.attributes.uv, pv=pa.array, uv=ua.array;
  for(let i=0;i<n;i++){
    const p=P[i].p, wx=W[3*i]*s, wy=W[3*i+1]*s, wz=W[3*i+2]*s, o=total*SWOOSH_OUT, v=cum[i]/tot;
    const ax=p.x+wx*o, ay=p.y+wy*o, az=p.z+wz*o;                                      // outer edge
    pv[6*i]=ax; pv[6*i+1]=ay; pv[6*i+2]=az;
    pv[6*i+3]=ax-wx*total; pv[6*i+4]=ay-wy*total; pv[6*i+5]=az-wz*total;            // inner edge
    uv[4*i]=uA; uv[4*i+1]=v; uv[4*i+2]=uB; uv[4*i+3]=v;
  }
  pa.needsUpdate=true; ua.needsUpdate=true; swsh.geo.setDrawRange(0,(n-1)*6); m.visible=true;
}
/* The two-handed weapons' swoosh is a FLAG nailed to the top of the weapon: the last point is the top, and every point before it just follows the one in front of it at a fixed distance,
   so when the weapon is waved the flag trails behind it. It shows for the first half of the swing animation (FLAG_START..FLAG_END of the clip) and fades in/out over FLAG_IN / FLAG_OUT seconds. */
const FLAG_N=10, FLAG_START=0.08, FLAG_END=0.5, FLAG_IN=0.06, FLAG_OUT=0.1; const _fd=new THREE.Vector3();
function updateFlag(){
  const m=swsh.mesh, act=current, cn=act&&act.getClip().name, dur=act?act.getClip().duration:0, t=act?act.time:0, tEnd=dur*FLAG_END;
  if(!(swooshOn&&swTip&&swPivot&&(cn==='AxeSwing'||cn==='SwingHeavyRelease')&&t>=FLAG_START&&t<tEnd)){ if(swFlagOn||m.visible){ swFlagOn=false; swsh.active=false; m.visible=false; } return; }
  swTip.getWorldPosition(swsh.a); swHilt.getWorldPosition(swsh.b); swPivot.getWorldPosition(swsh.c);
  const k=swsh.a.distanceTo(swsh.b)/swLen; if(!(k>1e-5)) return;
  const seg=swFlag*k/(FLAG_N-1), P=swsh.pts;
  if(!swFlagOn){   // starts hanging down along the pole
    swFlagOn=true; P.length=0; _fd.subVectors(swsh.b,swsh.a).normalize();
    for(let i=0;i<FLAG_N;i++) P.push({p:swsh.a.clone().addScaledVector(_fd,seg*(FLAG_N-1-i)),c:swsh.c.clone()});
  }
  P[FLAG_N-1].p.copy(swsh.a); P[FLAG_N-1].c.copy(swsh.c);
  for(let i=FLAG_N-2;i>=0;i--){   // each point keeps its distance from the one in front of it, and swings in behind it
    _fd.subVectors(P[i].p,P[i+1].p); const d=_fd.length(); if(d<1e-6) _fd.set(0,-1,0); else _fd.multiplyScalar(1/d);
    P[i].p.copy(P[i+1].p).addScaledVector(_fd,seg); P[i].c.copy(swsh.c);
  }
  const f=Math.max(0,Math.min(1,Math.min((t-FLAG_START)/FLAG_IN,(tEnd-t)/FLAG_OUT)));
  swsh.k=k; swsh.active=true; swsh.mat.uniforms.uFrame.value=0; swsh.mat.uniforms.uFade.value=f*f*(3-2*f);
  swooshBuild();
}
function updateSwoosh(dt){
  const m=swsh.mesh; if(!m) return;
  if(swFlag>0){ updateFlag(); return; }
  swsh.mat.uniforms.uFade.value=1;
  if(!swsh.active||!swooshOn){ m.visible=false; return; }
  swsh.age+=dt;
  const f=Math.floor(swsh.age*1000/SWOOSH_FRAME_MS);
  if(f>=SWOOSH_FRAMES){ swooshHide(); return; }
  swsh.mat.uniforms.uFrame.value=f; swsh.mat.uniforms.uHue.value=-swsh.age*SWOOSH_RAINBOW_SPEED;   // (rainbow only: the spectrum rolls towards the tip as the swing goes)
  swooshBuild();
}
function toggleSword(){ toggleWeapon(); }   // kept for old callers: the Sword on/off switch became the Sword / Axe choice

/* ---------- alternate helmets (helmet-data holds extra sets: Helmet 2 = Blockbench project, Helmet 3 = Adventurer cylinder helm, Helmet 4 = beveled cuboid, Helmet 5 = Adventurer icosphere / sphere helm) ---------- */
let helmetSets=[], helmetNames=[], curHelmet=0;
function loadImg(url){ return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=url; }); }
function initHelmets(grp,origParts){
  helmetSets=[origParts]; helmetNames=["Helmet 1"];
  const HDS=JSON.parse(document.getElementById('helmet-data').textContent), SETS=HDS.sets||[HDS];
  Promise.all(SETS.map(set=>Promise.all(set.parts.map(p=>loadImg(p.tex))).then(imgs=>set.parts.map((p,k)=>{
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3));
    geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2));
    geo.setIndex(p.i);
    const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
    const mat=ps1Mat(tex,1); if(/^h6_/.test(p.name)) mat.uniforms.uBlackNoShine.value=1;
    const m=new THREE.Mesh(geo,mat); m.name='alt_'+p.name;
    m.position.set(p.t[0],p.t[1],p.t[2]); m.rotation.order='ZYX';
    m.rotation.set(p.r[0]*Math.PI/180,p.r[1]*Math.PI/180,p.r[2]*Math.PI/180);
    m.visible=false; grp.add(m);
    if(/Plume$/.test(p.name)) setupPlume(mat); else { armorMats.push(mat); tintArmorMat(mat); bodyMeshes.push(m); }
    return m;
  })))).then(sets=>{
    sets.forEach((s,k)=>{ helmetSets.push(s); helmetNames.push(SETS[k].name||("Helmet "+(k+2))); }); buildHelmetUI();
    { const i6=helmetNames.indexOf('Helmet 6'); if(i6>=0) initHelmet6Face(grp,helmetSets[i6],i6); }
  }).catch(e=>console.error('helmet load failed',e));
}

/* ---------- Helmet 6's face ----------
   A flat pane sits in front of the round helmet and plays a pixel-art face. The faces come from the four gifs, stored in face-data as small transparent strips
   (the white background keyed out, two frames each, 500 ms per frame): normal, talking, angrytalking, spite. Only 'normal' plays for now; helmet6Face('talking') etc.
   switches it (from the console, or later from the game). The pane belongs to Helmet 6's set, so it only shows with that helmet - on the player and on any enemy wearing it.
   H6_FACE: w = pane width (head units), y / z = where its middle sits in the head's space (the helmet ball is centred at y 0.156, z 0.0625 with radius 0.219; +z is forward). */
const H6_FACE={w:0.30, y:0.165, z:0.292, glow:true};   // glow: not dimmed by the night tint, so the eyes stay bright
let helm6={faces:null, pane:null, mat:null, name:'normal', t:0, frame:-1, w:0, h:0};
function initHelmet6Face(grp,set,idx){
  const el=document.getElementById('face-data'); if(!el||!set) return;
  const FD=JSON.parse(el.textContent);
  Promise.all(FD.order.map(n=>loadImg(FD.faces[n].png))).then(imgs=>{
    const faces={};
    FD.order.forEach((n,k)=>{
      const f=FD.faces[n], tex=[];
      for(let i=0;i<f.frames;i++){   // one small texture per frame: the pane just swaps which one it shows
        const cv=document.createElement('canvas'); cv.width=FD.w; cv.height=FD.h; cv.getContext('2d').drawImage(imgs[k],i*FD.w,0,FD.w,FD.h,0,0,FD.w,FD.h);
        const t=new THREE.CanvasTexture(cv); t.flipY=true; t.encoding=THREE.LinearEncoding; t.generateMipmaps=false; t.minFilter=t.magFilter=THREE.NearestFilter; tex.push(t);   // flipY on: a flat plane's uvs run bottom-to-top, unlike the helmet meshes'
      }
      faces[n]={tex,ms:f.ms,total:f.ms.reduce((a,b)=>a+b,0)};
    });
    const w=H6_FACE.w, h=w*FD.h/FD.w;
    const mat=ps1Mat(faces.normal.tex[0],1); if(H6_FACE.glow) mat.uniforms.uNight={value:new THREE.Vector3(1,1,1)};
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat); m.name='H6Face';
    m.position.set(0,H6_FACE.y,H6_FACE.z); m.visible=(curHelmet===idx);
    grp.add(m); set.push(m);   // part of Helmet 6's set, so setHelmet() shows and hides it with the helmet
    helm6={faces,pane:m,mat,name:'normal',t:0,frame:-1,w,h};
  }).catch(e=>console.error('helmet 6 face load failed',e));
}
function helmet6Face(name){ if(helm6.faces&&helm6.faces[name]){ helm6.name=name; helm6.t=0; helm6.frame=-1; } else console.warn('no such face',name,Object.keys(helm6.faces||{})); }
window.helmet6Face=helmet6Face;
function updateHelm6Face(dt){
  if(!helm6.faces) return;
  const f=helm6.faces[helm6.name]; helm6.t+=dt*1000; const t=helm6.t%f.total;
  let i=0, acc=0; while(i<f.ms.length-1&&t>=acc+f.ms[i]){ acc+=f.ms[i]; i++; }
  if(i!==helm6.frame){ helm6.frame=i; helm6.mat.uniforms.map.value=f.tex[i]; }
  if(helm6.pane&&knightScene) helm6.pane.scale.x=knightScene.scale.x<0?-1:1;   // the model is mirrored (and un-mirrored with the axe): flip the pane back so the art never reads backwards
}
/* ---------- the shopkeeper's own Helmet 6 face ----------
   Only the shopkeeper's helmet uses these (shop-face-data: the kris*.gif art, 85x85, two frames of 500 ms each: normal, talking, angrytalking, spite).
   The player's and the enemies' Helmet 6 keep the original face above. shopFaceSet('talking') etc. switches it (also from the console: shopFace('talking')).
   SHOP_H6_GREY: the parts of his helmet that are pure black in the texture (the ones that never shine) show this grey instead - 0 is black, 1 is white. */
const SHOP_H6_GREY=0.40;
/* The shopkeeper's helmet = Helmet 6's shape with the textures of shop-helmet-data (the gltf's retextured helmet). The areas that used to be pure black (never shine) were kept: they carry alpha 254 in
   the new textures and uMaskNoShine reads that. The plume colour is the ph variable in spawnShopKeeperInBuilding. */
let shopHelmTex=null;
function shopHelmLoad(){
  if(shopHelmTex) return; const el=document.getElementById('shop-helmet-data'); if(!el) return;
  shopHelmTex={}; const D=JSON.parse(el.textContent);
  Object.keys(D.tex).forEach(k=>loadImg(D.tex[k]).then(im=>{ const t=new THREE.Texture(im); t.flipY=false; t.encoding=THREE.LinearEncoding; t.generateMipmaps=false; t.minFilter=t.magFilter=THREE.NearestFilter; t.needsUpdate=true; shopHelmTex[k]=t; if(shopKeeper) shopHelmApply(shopKeeper.root); }));
}
function shopHelmApply(root){
  if(!shopHelmTex) return;
  root.traverse(o=>{ const t=shopHelmTex[o.name]; if(!o.isMesh||!t||!o.material||!o.material.uniforms) return; const u=o.material.uniforms; u.map.value=t; u.uMaskNoShine.value=1; u.uLevels={value:255}; u.uDither={value:0}; u.uBlackNoShine.value=0; u.uBlackGrey.value=0; });
}
let shopFace={faces:null,mat:null,pane:null,name:'normal',t:0,frame:-1};
function shopFaceAttach(mesh,root){
  mesh.scale.x=root.scale.x<0?-1:1;
  const el=document.getElementById('shop-face-data');
  if(!el){ if(helm6.mat) mesh.material=helm6.mat; return; }   // no data file: fall back to the original face
  const FD=JSON.parse(el.textContent), blank=document.createElement('canvas'); blank.width=blank.height=1;
  const mat=ps1Mat(new THREE.CanvasTexture(blank),1); if(H6_FACE.glow) mat.uniforms.uNight={value:new THREE.Vector3(1,1,1)};   // (a clear 1x1 until the images have loaded)
  { const u=mat.uniforms; u.uEmit.value=1; u.uTint.value.set(1.3,1.3,1.3); u.uAffine={value:0}; u.uDither={value:0}; u.uLevels={value:255}; }   // the face gif: unlit and a bit over-bright, no wobble, no dither, full colour depth
  const pw=H6_FACE.w*FD.w/82;   // the original face is 82 px wide on a 0.30 pane: the same size per pixel, so the eyes keep their size on the helmet
  mesh.geometry=new THREE.PlaneGeometry(pw,pw*FD.h/FD.w); mesh.material=mat;
  shopFace={faces:null,mat,pane:mesh,name:shopFace.name||'normal',t:0,frame:-1};
  Promise.all(FD.order.map(n=>loadImg(FD.faces[n].png))).then(imgs=>{
    const faces={};
    FD.order.forEach((n,k)=>{
      const f=FD.faces[n], tex=[];
      for(let i=0;i<f.frames;i++){
        const cv=document.createElement('canvas'); cv.width=FD.w; cv.height=FD.h; cv.getContext('2d').drawImage(imgs[k],i*FD.w,0,FD.w,FD.h,0,0,FD.w,FD.h);
        const t=new THREE.CanvasTexture(cv); t.flipY=true; t.encoding=THREE.LinearEncoding; t.generateMipmaps=false; t.minFilter=t.magFilter=THREE.NearestFilter; tex.push(t);
      }
      faces[n]={tex,ms:f.ms,total:f.ms.reduce((a,b)=>a+b,0)};
    });
    shopFace.faces=faces;
  }).catch(e=>console.error('shopkeeper face load failed',e));
}
function shopFaceSet(name){ shopFace.name=name; shopFace.t=0; shopFace.frame=-1; }
window.shopFace=shopFaceSet;
function updateShopFace(dt){
  const s=shopFace; if(!s.faces) return; const f=s.faces[s.name]; if(!f) return;
  s.t+=dt*1000; const t=s.t%f.total; let i=0, acc=0;
  while(i<f.ms.length-1&&t>=acc+f.ms[i]){ acc+=f.ms[i]; i++; }
  if(i!==s.frame){ s.frame=i; s.mat.uniforms.map.value=f.tex[i]; }
}
function setHelmet(i){
  curHelmet=i; helmetSets.forEach((s,j)=>s.forEach(m=>{ m.visible=(i===j); }));
  const sel=document.getElementById('helmsel'); if(sel) sel.value=String(i);
}
function cycleHelmet(){ if(helmetSets.length>1) setHelmet((curHelmet+1)%helmetSets.length); }
function buildHelmetUI(){
  /* dropdown fills itself from helmetSets; give a set a "name" in helmet-data to label it */
  const sel=document.getElementById('helmsel'); sel.innerHTML='';
  helmetSets.forEach((_,i)=>{
    const o=document.createElement('option'); o.value=String(i); o.textContent=helmetNames[i]||('Helmet '+(i+1)); sel.appendChild(o);
  });
  sel.onchange=()=>{ setHelmet(+sel.value); sel.blur(); };
  document.getElementById('hlbl').hidden=false; sel.hidden=false; setHelmet(0);
}
function buildPlumeUI(){
  const box=document.getElementById('sws');
  const SW=[['#e15050','Red (original)'],['#4a78e8','Blue'],['#4fc25a','Green'],['#f0c030','Gold'],['#a05ae0','Purple'],['#f2f2f2','White']];
  const mark=el=>box.querySelectorAll('.sw').forEach(x=>x.setAttribute('aria-checked',x===el));
  SW.forEach(([hex,name],i)=>{
    const b=document.createElement('button'); b.className='sw'; b.style.background=hex; b.title=name;
    b.setAttribute('aria-label',name); b.setAttribute('role','radio'); b.setAttribute('aria-checked',i===0);
    b.onclick=()=>{ tintPlume(i===0?null:hex); mark(b); };
    box.appendChild(b);
  });
  const p=document.createElement('input'); p.type='color'; p.value='#e15050'; p.className='sw'; p.title='Custom color';
  p.setAttribute('aria-label','Custom plume color'); p.setAttribute('aria-checked','false');
  p.oninput=()=>{ tintPlume(p.value); mark(p); };
  box.appendChild(p);
  document.getElementById('plbl').hidden=false; box.hidden=false;
}

(function buildArmorUI(){
  const box=document.getElementById('asws'), slider=document.getElementById('astr'), lab=document.getElementById('astrl');
  const SW=[[null,'Steel (original)','#9aa0aa'],['#e8604f','Crimson'],['#e8b830','Gold'],['#58b868','Verdant'],['#4a88e8','Azure'],['#9a60e0','Violet'],['#e878b0','Rose'],['#3cc4bc','Teal']];
  const mark=el=>box.querySelectorAll('.sw').forEach(x=>x.setAttribute('aria-checked',x===el));
  SW.forEach(([hex,name,show],i)=>{
    const b=document.createElement('button'); b.className='sw'; b.style.background=show||hex; b.title=name;
    b.setAttribute('aria-label',name); b.setAttribute('role','radio'); b.setAttribute('aria-checked',i===0);
    b.onclick=()=>{ armorHex=hex; applyArmorTint(); mark(b); };
    box.appendChild(b);
  });
  const p=document.createElement('input'); p.type='color'; p.value='#e8a23a'; p.className='sw'; p.title='Custom color';
  p.setAttribute('aria-label','Custom armor tint'); p.setAttribute('aria-checked','false');
  p.oninput=()=>{ armorHex=p.value; applyArmorTint(); mark(p); };
  box.appendChild(p);
  slider.oninput=()=>{ armorAmt=slider.value/100; lab.textContent='Tint strength '+slider.value+'%'; applyArmorTint(); };
})();

(function buildShinyUI(){
  const b=document.getElementById('shiny');
  b.onclick=()=>{ shiny=!shiny; armorMats.concat(swordMats,chestShineMats).forEach(shineMat); b.setAttribute('aria-checked',shiny); b.blur(); };
})();
(function buildSwordUI(){
  const box=document.getElementById('ssws'), chk=document.getElementById('smatch');
  const SW=[[null,'Steel (original)','#9aa0aa'],['#e8604f','Crimson'],['#e8b830','Gold'],['#58b868','Verdant'],['#4a88e8','Azure'],['#9a60e0','Violet'],['#e878b0','Rose'],['#3cc4bc','Teal']];
  const els=[]; let sel=null;
  function refresh(){ els.forEach(x=>x.setAttribute('aria-checked',!swordMatch&&x===sel)); box.classList.toggle('dim',swordMatch); chk.setAttribute('aria-checked',swordMatch); }
  function pick(el,hex){ swordMatch=false; swordHex=hex; sel=el; applySwordTint(); refresh(); }   // choosing a color switches matching off
  SW.forEach(([hex,name,show],i)=>{
    const b=document.createElement('button'); b.className='sw'; b.style.background=show||hex; b.title=name;
    b.setAttribute('aria-label',name); b.setAttribute('role','radio'); b.setAttribute('aria-checked','false');
    b.onclick=()=>pick(b,hex); box.appendChild(b); els.push(b); if(i===0) sel=b;
  });
  const p=document.createElement('input'); p.type='color'; p.value='#e8a23a'; p.className='sw'; p.title='Custom color';
  p.setAttribute('aria-label','Custom sword tint'); p.setAttribute('aria-checked','false');
  p.oninput=()=>pick(p,p.value); box.appendChild(p); els.push(p);
  chk.onclick=()=>{ swordMatch=!swordMatch; applySwordTint(); refresh(); chk.blur(); };
  refresh();
})();

/* ---------- music (decoded in-page with WebAudio; no fetch needed) ---------- */
let ac=null, songBuf=null, srcNode=null, musicGain=null, decoding=null, musicOn=false, userChose=false;
let flauntWant=false, flauntDone=false, flauntBuf=null, flauntSrc=null, flauntLoading=null;   // the Flaunt animation swaps the music for its own song
let battleWant=false, battleBuf=null, battleSrc=null, battleLoading=null, battleResume=0, crushOn=true;   // the battle song, and the bitcrushed switch (on by default; the BITCRUSH option turns it off)
/* fades (seconds): a track fades in when it starts, fades out when it stops or is swapped for another, and dips briefly at each loop seam */
const FADE_IN=1.5, FADE_OUT=0.7, FADE_LOOP=1.0;
function playTrack(buf,offset,fin){
  offset=offset||0; fin=(fin==null)?FADE_IN:fin;
  const g=ac.createGain(), src=ac.createBufferSource(), t0=ac.currentTime+0.05, D=buf.duration;
  src.buffer=cz(buf); src.loop=true; src.connect(g); g.connect(musicGain);      // cz(): the bitcrushed copy when that switch is on
  g.gain.setValueAtTime(0,t0); g.gain.linearRampToValueAtTime(1,t0+fin);
  const first=D-offset;                                                          // time until the first loop seam
  for(let k=(first-FADE_LOOP<fin+0.1?1:0);k<Math.ceil(7200/D);k++){            // schedule the seam dips for the next two hours of looping
    const e=t0+first+k*D;
    g.gain.setValueAtTime(1,e-FADE_LOOP); g.gain.linearRampToValueAtTime(0,e); g.gain.setValueAtTime(0,e); g.gain.linearRampToValueAtTime(1,e+FADE_LOOP);
  }
  src.start(t0,offset); return {src,gain:g,buf,t0,off:offset,D};
}
function trackPos(tr){ return (tr.off+Math.max(0,ac.currentTime-tr.t0))%tr.D; }
function stopTrack(tr){
  if(!tr) return;
  const p=tr.gain.gain, t=ac.currentTime;
  p.cancelScheduledValues(t); p.setValueAtTime(p.value,t); p.linearRampToValueAtTime(0,t+FADE_OUT);
  try{ tr.src.stop(t+FADE_OUT+0.05); }catch(_){}
  setTimeout(()=>{ try{ tr.src.disconnect(); tr.gain.disconnect(); }catch(_){} },(FADE_OUT+0.4)*1000);
}
function fadeMaster(to,secs){ const p=musicGain.gain, t=ac.currentTime; p.cancelScheduledValues(t); p.setValueAtTime(p.value,t); p.linearRampToValueAtTime(to,t+secs); }
function loadSong(){
  if(decoding) return decoding;
  const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return Promise.reject(new Error('no WebAudio'));
  ac=new AC(); musicGain=ac.createGain(); musicGain.gain.value=0.6; musicGain.connect(ac.destination);
  const s=atob(document.getElementById('song-data').textContent.trim()), u=new Uint8Array(s.length);
  for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i);
  decoding=new Promise((res,rej)=>ac.decodeAudioData(u.buffer,res,rej)).then(b=>{songBuf=b;});
  return decoding;
}
async function startMusic(){
  try{
    const p=loadSong(); ac.resume(); await p;
    if(!musicOn||editOn) return;   // (EDIT plays its own song: the main one must not start up under it, e.g. when it finished loading just after EDIT began)
    if(!srcNode&&!flauntWant&&!battleWant&&!shopWant&&!frostWant&&!ignisWant){ srcNode=playTrack(songBuf); }
    await ac.resume();
  }catch(e){ console.error(e); musicOn=false; setSwitch('music',false,'N/A'); }
}
async function toggleMusic(){
  userChose=true; musicOn=!musicOn; setSwitch('music',musicOn,musicOn?'On':'Off');
  if(musicOn){ if(musicGain) fadeMaster(0.6,FADE_IN); await startMusic(); syncAudio(); }
  else if(ac){ fadeMaster(0,FADE_OUT); setTimeout(()=>{ if(!musicOn) ac.suspend(); },FADE_OUT*1000+80); }   // fade out, then pause
}
/* ---------- flaunt song ----------
   While the Flaunt animation plays, the main music stops and this plays instead. The file is the song from 3:29 to the end (so 4:30 is 61 s in),
   and it loops back to 3:29, so the 4:30 part comes round every time. It follows the Music switch: with music Off it stays silent. */
function loadFlaunt(){
  if(flauntLoading) return flauntLoading;
  const t=atob(document.getElementById('flaunt-data').textContent.trim()), u=new Uint8Array(t.length);
  for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i);
  flauntLoading=new Promise((res,rej)=>ac.decodeAudioData(u.buffer,res,rej)).then(b=>{flauntBuf=b;});
  return flauntLoading;
}
/* ---------- battle song ----------
   Plays from the moment you walk into the ruins until the fight ends (victory or defeat). The Flaunt song still takes over for the length of a Flaunt; the battle song then
   comes back where it left off. Order of priority: Flaunt song, battle song, main song. Everything follows the Music switch. */
function loadBattle(){
  if(battleLoading) return battleLoading;
  const t=atob(document.getElementById('battle-data').textContent.trim()), u=new Uint8Array(t.length);
  for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i);
  battleLoading=new Promise((res,rej)=>ac.decodeAudioData(u.buffer,res,rej)).then(b=>{battleBuf=b;});
  return battleLoading;
}
function setBattleMusic(on){ if(battleWant===on) return; battleWant=on; if(!on) battleResume=0; syncAudio(); }
/* shop song (Sacrifice of Saint Dell, FM Skyline) plays in the shop; frost song (Ice, slowed, ZERTAL) plays once you travel to The Veiled Frost (on the map, from the transition between the areas) and stays while you are there.
   Priority: Flaunt song, battle song, shop song, frost song, main song. Same fades as every track, and they go through cz() so the BITCRUSH switch applies. */
const xtra={shop:{id:'shop-song-data',buf:null,src:null,loading:null},shop2:{id:'shop-song2-data',buf:null,src:null,loading:null},frost:{id:'frost-song-data',buf:null,src:null,loading:null},ignis:{id:'ignis-song-data',buf:null,src:null,loading:null},dance:{id:'dance-song-data',buf:null,src:null,loading:null},dance2:{id:'dance2-song-data',buf:null,src:null,loading:null},dance3:{id:'dance3-song-data',buf:null,src:null,loading:null}}; let shopWant=false, frostWant=false, ignisWant=false, danceWant=false;   // dance: the song for the Dance animation (top priority)
/* The shop song's name tag (bottom right of the shop view) is also the switch between the shop's songs: click it to swap (shopSong is 'shop' or 'shop2'; the choice is kept for later visits).
   To add another shop song: add it to xtra above (+ manifest.json), to SHOP_SONG_NAMES here and to SHOP_SONGS (the order they cycle in). */
let shopSong='shop', shopSongBtn=null; const SHOP_SONG_NAMES={shop:'SACRIFICE OF SAINT DELL',shop2:'ASSHOLE PARTY'}, SHOP_SONGS=['shop','shop2'];
function shopSongLabel(){ if(shopSongBtn) shopSongBtn.innerHTML='\u266A '+SHOP_SONG_NAMES[shopSong]+'<small>CLICK: CHANGE SONG</small>'; }
function shopSongNext(){ shopSong=SHOP_SONGS[(SHOP_SONGS.indexOf(shopSong)+1)%SHOP_SONGS.length]; shopSongLabel(); blip(520,0.06); if(shopWant) syncAudio(); }   // syncAudio fades the old shop song out and the new one in
function loadX(k){ const x=xtra[k]; if(x.loading) return x.loading; const t=atob(document.getElementById(x.id).textContent.trim()), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i); x.loading=new Promise((res,rej)=>ac.decodeAudioData(u.buffer,res,rej)).then(b=>{ x.buf=b; }); return x.loading; }
function setShopMusic(on){ if(shopWant===on) return; shopWant=on; syncAudio(); }
function setFrostMusic(on){ if(frostWant===on) return; frostWant=on; syncAudio(); }
function setIgnisMusic(on){ if(ignisWant===on) return; ignisWant=on; syncAudio(); }
async function syncAudio(){
  const pick=()=>(!musicOn||editOn)?null:(danceWant?danceKey:flauntWant?'flaunt':(battleWant?'battle':(shopWant?shopSong:(ignisWant?'ignis':(frostWant?'frost':'main')))));
  const stopX=keep=>{ for(const k in xtra){ if(k!==keep&&xtra[k].src){ stopTrack(xtra[k].src); xtra[k].src=null; } } };
  try{
    const want=pick();
    if(want&&want!=='main'){
      const p=loadSong(); ac.resume(); await p; await (want==='flaunt'?loadFlaunt():want==='battle'?loadBattle():loadX(want));
      if(pick()!==want) return;                                                        // things changed while it was loading
      if(srcNode){ stopTrack(srcNode); srcNode=null; }                                 // the other music fades out as this one fades in
      stopX(want);
      if(want==='flaunt'){
        if(battleSrc){ battleResume=trackPos(battleSrc); stopTrack(battleSrc); battleSrc=null; }   // remember where the battle song was
        if(!flauntSrc) flauntSrc=playTrack(flauntBuf);
      } else if(want==='battle'){
        if(flauntSrc){ stopTrack(flauntSrc); flauntSrc=null; }
        if(!battleSrc){ battleSrc=playTrack(battleBuf,battleResume); battleResume=0; }
      } else {
        if(flauntSrc){ stopTrack(flauntSrc); flauntSrc=null; }
        if(battleSrc){ stopTrack(battleSrc); battleSrc=null; }
        if(!xtra[want].src) xtra[want].src=playTrack(xtra[want].buf);
      }
      await ac.resume();
    } else {
      if(flauntSrc){ stopTrack(flauntSrc); flauntSrc=null; }
      if(battleSrc){ stopTrack(battleSrc); battleSrc=null; }
      stopX('');
      if(!want&&srcNode){ stopTrack(srcNode); srcNode=null; }                          // no music wanted (EDIT is playing its own song): the main music fades out too
      if(want==='main') startMusic();                                                  // the main music comes back
    }
  }catch(e){ console.error(e); }
}

/* ---------- bitcrushed ----------
   Does to every audio file what the defeat sound gets: mono, sample-and-hold down to DEFEAT_RATE Hz, quantised to DEFEAT_BITS bits, then the DEFEAT_LOWPASS Hz low-pass
   (the "inside a helmet" muffle). Music tracks and sound effects both go through cz(); copies are made once and kept. The defeat sound is always crushed, with or without the switch. */
const crushCache=new WeakMap();
/* per-song crush: everything is crushed with DEFEAT_BITS / DEFEAT_RATE / DEFEAT_LOWPASS (6 bits, 8000 Hz, 3200 Hz low-pass) unless a buffer has its own entry here. */
const crushParams=new WeakMap();   // (a song can be given its own crush settings here: crushParams.set(buffer,{bits,rate,lp}))
function crushCopy(b){
  let c=crushCache.get(b); if(c) return c;
  const n=b.length, sr=b.sampleRate;
  c=(typeof AudioBuffer==='function')?new AudioBuffer({length:n,numberOfChannels:1,sampleRate:sr}):(ac||sfx).createBuffer(1,n,sr);
  const o=c.getChannelData(0), ch=[]; for(let k=0;k<b.numberOfChannels;k++) ch.push(b.getChannelData(k));
  const P=crushParams.get(b)||{bits:DEFEAT_BITS,rate:DEFEAT_RATE,lp:DEFEAT_LOWPASS};
  const step=Math.max(1,Math.round(sr/P.rate)), lv=Math.pow(2,P.bits-1); let hold=0;
  for(let i=0;i<n;i++){ if(i%step===0){ let v=0; for(let k=0;k<ch.length;k++) v+=ch[k][i]; v/=ch.length; hold=Math.round(v*lv)/lv; } o[i]=hold; }
  const w=2*Math.PI*P.lp/sr, cs=Math.cos(w), al=Math.sin(w)/(2*0.7071), a0=1+al, b0=(1-cs)/2/a0, b1=(1-cs)/a0, b2=b0, a1=-2*cs/a0, a2=(1-al)/a0;   // biquad low-pass
  let x1=0,x2=0,y1=0,y2=0; for(let i=0;i<n;i++){ const x0=o[i], y0=b0*x0+b1*x1+b2*x2-a1*y1-a2*y2; o[i]=y0; x2=x1; x1=x0; y2=y1; y1=y0; }
  crushCache.set(b,c); return c;
}
function cz(b){ return crushOn?crushCopy(b):b; }
function swapTrack(tr){ const pos=trackPos(tr); stopTrack(tr); return playTrack(tr.buf,pos,0.3); }   // same place in the song, crossfaded to the other version
function toggleCrush(){
  crushOn=!crushOn;
  try{ if(ac){ if(srcNode) srcNode=swapTrack(srcNode); if(flauntSrc) flauntSrc=swapTrack(flauntSrc); if(battleSrc) battleSrc=swapTrack(battleSrc); for(const k in xtra) if(xtra[k].src) xtra[k].src=swapTrack(xtra[k].src); } }catch(e){ console.error(e); }
}
document.getElementById('music').onclick=toggleMusic;
// browsers only allow audio after a gesture, so the song starts on the first tap or key press
function firstGesture(e){
  if(userChose||(e.target.closest&&e.target.closest('#music'))||(e.key&&e.key.toLowerCase()==='m')) return;
  musicOn=true; setSwitch('music',true,'On'); startMusic();
}
['pointerdown','keydown'].forEach(n=>addEventListener(n,firstGesture,{once:true}));

/* ---------- animation control ---------- */
/* ---------- GOLEM (ANIMATIONS screen): golem-data is his Blockbench model, golem-attack-data the GolemAttack clip (same track format as the other clips).
   Picking GolemAttack hides the knight and shows the golem in his place; picking anything else, or leaving the screen, brings the knight back. ---------- */
const GOLEM_SCALE=0.9;   // golem height as a fraction of the knight's (his raised fists reach well above his head)
let golemRig=null, golemScene=null, golemMixer=null, golemAct=null, golemOn=false, golemH0=1, golemMinY=0, golemClips=null, golemPrevT=0, golemAll=null;
const GOLEM_HIT_AT=0.5;   // seconds into GolemAttack where the fists land (the slam), for the damage and the hit sound
function golemEye(o){ return !!(o.parent&&o.parent.name==='Torso'&&o.position.z>0.2); }   // the two small cubes on his torso
function golemReady(){ return !!(golemScene&&golemClips&&golemClips.Idle&&golemClips.Hit); }
function playGolemSfx(kind){ playSfxSet(kind==='atk'?'golem-atk-sfx-data':kind==='pain'?'golem-pain-sfx-data':'golem-spawn-sfx-data',0,0.9,1,0); }
(function(){
  const el=document.getElementById('golem-data'), ad=document.getElementById('golem-attack-data'); if(!el||!ad) return;
  try{
    const t=atob(el.textContent.trim()), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i);
    new THREE.GLTFLoader().parse(u.buffer,'',g=>{
      const cache=new Map();
      g.scene.traverse(o=>{ if(!o.isMesh) return; const om=o.material; if(!cache.has(om.uuid)) cache.set(om.uuid,ps1Mat(om.map,1)); o.material=cache.get(om.uuid); o.frustumCulled=false; if(golemEye(o)) o.material.uniforms.uMagma.value=1; });   // his two eyes glow like the Ignis trees' magma
      g.scene.updateMatrixWorld(true);
      const bx=new THREE.Box3().setFromObject(g.scene); golemH0=bx.max.y-bx.min.y; golemMinY=bx.min.y;
      golemScene=g.scene; golemRig=new THREE.Group(); golemRig.add(g.scene); golemRig.visible=false; scene.add(golemRig);
      const D=JSON.parse(ad.textContent);
      const clip=new THREE.AnimationClip(D.name,-1,D.tracks.map(k=>k.p==='q'?new THREE.QuaternionKeyframeTrack(k.n+'.quaternion',k.t,k.v):new THREE.VectorKeyframeTrack(k.n+'.position',k.t,k.v)));
      golemMixer=new THREE.AnimationMixer(g.scene); golemAct=golemMixer.clipAction(clip);
      golemClips={Idle:g.animations.find(a=>a.name==='Idle'),Hit:g.animations.find(a=>a.name==='Hit'),Attack:clip};
      { const rd=document.getElementById('golem-introroar-data'), R=rd&&JSON.parse(rd.textContent), blk=g.animations.find(a=>a.name==='Block');   // golem-introroar-data: the intro roar clip (same track format as GolemAttack)
        golemAll={Idle:golemClips.Idle,Attack:clip,Hit:golemClips.Hit,IntroRoar:R?new THREE.AnimationClip(R.name,-1,R.tracks.map(k=>k.p==='q'?new THREE.QuaternionKeyframeTrack(k.n+'.quaternion',k.t,k.v):new THREE.VectorKeyframeTrack(k.n+'.position',k.t,k.v))):null,Block:blk}; } if(SNAP_ON&&golemClips.Hit) snapClip(golemClips.Hit);   // the enemy golems use these (their own Idle and Hit from the model file, and GolemAttack)
    },e=>console.error('golem failed',e));
  }catch(e){ console.error(e); }
})();
function golemPlace(){   // stand where the knight stands, facing the way he faces (same rig, both models face +Z)
  const k=GOLEM_SCALE*playerH/golemH0;
  golemRig.scale.setScalar(k); golemRig.position.set(playerRig.position.x,groundYNight-golemMinY*k,playerRig.position.z); golemRig.rotation.y=playerRig.rotation.y;
}
/* ---------- ENEMY VIEWER (ANIMATIONS > ENEMIES > enemy > animation) ----------
   Picking an enemy's animation hides the knight and shows that enemy in his place, looping the clip. Every enemy type is listed (golem, treeling, sporeling, slime) with all the clips its model has.
   golemOn means "an enemy is being shown". The golem keeps his sounds (the slam on ATTACK, the roar on INTRO ROAR, the grunt on HIT); picking a knight animation or leaving the ANIMATIONS screens brings the knight back. */
const EV_ENEMIES=[{key:'golem',name:'GOLEM'},{key:'treeling',name:'TREELING'},{key:'sporeling',name:'SPORELING'},{key:'slime',name:'SLIME'}];
const EV_LABEL={idle:'IDLE',hit:'HIT',atk:'ATTACK',action:'ATTACK',attack:'ATTACK',introroar:'INTRO ROAR',block:'BLOCK',death:'DEATH'};
const evViews={}; let evCur=null;   // evCur: {key,ci,v,act,label}
function evDefs(key){   // [{label,clip}] straight from the loaded models (null until the model has loaded)
  let src=null;
  if(key==='golem'){ if(!golemAll) return null; src=['Idle','Attack','Hit','IntroRoar','Block'].map(n=>golemAll[n]&&[n,golemAll[n]]).filter(Boolean); }
  else if(key==='slime'){ if(!elementalGltf) return null; src=elementalGltf.animations.map(a=>[a.name,a]); }
  else { const M=mobModels[key]; if(!M||!M.all) return null; src=M.all.map(a=>[a.name,a]); }
  return src.map(([n,c])=>({label:EV_LABEL[n.toLowerCase()]||n.toUpperCase(),clip:c}));
}
function evBuild(key){
  if(evViews[key]) return evViews[key];
  const defs=evDefs(key); if(!defs||!scene) return null; let v=null;
  if(key==='golem'){ if(!golemRig) return null; v={key,rig:golemRig,mixer:golemMixer,golem:true}; }
  else if(key==='slime'){ const root=cloneElemental(), rig=new THREE.Group(); rig.add(root); rig.visible=false; scene.add(rig); v={key,rig,root,mixer:new THREE.AnimationMixer(root)}; }
  else { const M=mobModels[key], D=MOBS[key], root=M.scene.clone(true), gk=D.scale*playerH/M.h0, rig=new THREE.Group(); root.scale.setScalar(gk); root.position.y=-M.minY*gk; rig.add(root); rig.visible=false; scene.add(rig); v={key,rig,root,mixer:new THREE.AnimationMixer(root)}; }
  v.defs=defs; v.acts=defs.map(d=>v.mixer.clipAction(d.clip)); return evViews[key]=v;
}
function evPlace(v){   // stand where the knight stands, facing the way he faces
  if(v.golem){ golemPlace(); return; }
  v.rig.position.set(playerRig.position.x,groundYNight,playerRig.position.z); v.rig.rotation.y=playerRig.rotation.y;
}
function evSfx(kind){ if(evCur&&evCur.key==='golem') playGolemSfx(kind); }
function evPlay(key,ci){
  const v=evBuild(key); if(!v||!playerRig) return false;
  if(evCur&&evCur.v!==v){ evCur.v.rig.visible=false; evCur.v.mixer.stopAllAction(); }
  else if(evCur) evCur.act.stop();
  if(!golemOn){ golemOn=true; if(current) current.paused=true; playerRig.visible=false; }   // the hidden knight's clip must not keep running (Chestopen looped on behind the golem and replayed the chest creak)
  const act=v.acts[ci], label=v.defs[ci].label; v.rig.visible=true; evPlace(v);
  act.reset().setLoop(THREE.LoopRepeat,Infinity).play(); v.mixer.update(0); evCur={key,ci,v,act,label};
  if(label==='INTRO ROAR') evSfx('spawn'); else if(label==='HIT') evSfx('pain');
  return true;
}
function evStep(dt){
  if(!golemOn||!evCur) return; const {v,act,label}=evCur; evPlace(v);
  const p=act.time; v.mixer.update(dt); const t=act.time;
  if(label==='ATTACK'&&p<GOLEM_HIT_AT&&t>=GOLEM_HIT_AT) evSfx('atk');   // the fists land
  if(t<p){ if(label==='INTRO ROAR') evSfx('spawn'); else if(label==='HIT') evSfx('pain'); }   // looped round
}
function evHide(){
  if(!golemOn) return; golemOn=false;
  if(evCur){ evCur.v.rig.visible=false; evCur.v.mixer.stopAllAction(); evCur=null; }
  if(playerRig) playerRig.visible=true; if(current) current.paused=false;
}
function golemShow(on){ if(!on) evHide(); }   // (older callers: only "hide" is ever asked for now)
function playGolem(){ const d=evDefs('golem'); if(d) evPlay('golem',Math.max(0,d.findIndex(x=>x.label==='ATTACK'))); }
/* ---------- PIZZA: the Soccer Trip (a running trip and tumble, retargeted from Mixamo, done in place) with the "Ayo, the pizza here" meme.
   The animation starts the moment it is picked, at its own speed. The sound plays at its own speed too, starting PIZZA_AUDIO_START seconds into the meme (at the bump). Picking anything else cuts it off. ---------- */
const PIZZA_AUDIO_START=1.815, PIZZA_SPEED=1;   // the crack: the first loud, broadband burst in the meme, starting at 1.82 s (silence before it)
let pizzaGo=false, pizzaLive=false;
function pizzaCancel(){ if(pizzaLive){ pizzaLive=false; swishStopAll(); } }
function pizzaStart(){
  pizzaGo=true; play('Pizza'); pizzaGo=false;   // the normal path (menus, golem, ground...), then once-through
  const a=actions.Pizza; if(a){ a.setLoop(THREE.LoopOnce,1); a.clampWhenFinished=true; a.timeScale=PIZZA_SPEED; }
  try{ sfx=sfx||new (window.AudioContext||window.webkitAudioContext)(); sfx.resume(); }catch(e){}
  const go=()=>{ const st=SFX_SETS['pizza-sfx-data']; if(!st||!st.bufs||!sfx) return;
    const src=sfx.createBufferSource(), g=sfx.createGain(); src.buffer=cz(st.bufs[0]); g.gain.value=1; src.connect(g); g.connect(sfx.destination);
    src.start(sfx.currentTime,PIZZA_AUDIO_START); pizzaLive=true; swishLive.push(src); src.onended=()=>{ const k=swishLive.indexOf(src); if(k>=0) swishLive.splice(k,1); }; };
  const st=SFX_SETS['pizza-sfx-data']; if(st&&st.bufs) go(); else Promise.resolve(loadSfxSet('pizza-sfx-data')).then(go);
}
function play(n){
  if(invDrink.on&&!invDrink.internal&&n!=='UALX_ConsumeM'){ invDrink.next=n; return; }   // the inventory's potion inspection finishes first; whatever was asked for plays after it
  if(n==='Pizza'&&!pizzaGo){ pizzaStart(); return; }
  if(n!=='Pizza') pizzaCancel();
  if(n==='GolemAttack'){ playGolem(); return; }
  if(golemOn) golemShow(false);
  if(n==='Flaunt'&&weapon==='axe'&&actions.AxeFlaunt) n='AxeFlaunt';   // the axe has its own flaunt (heavy weapons class)
  if(animSet==='ideal'&&n==='Swing') idealPickSwing();
  if(!actions[n]) return;
  if((n==='AxeIdle'||n==='AxeSwing'||n==='AxeFlaunt'||n===FLAUNT_IDLE)&&weapon!=='axe') setWeapon('axe');   // these are the axe's own clips, so choosing one brings the axe out
  else if((n==='Idle'||n==='Swing')&&weapon==='axe') setWeapon('sword');   // and these are the sword's, so choosing one puts the sword back (the game itself always asks for idleName())
  const isFlaunt=(n==='Flaunt'||n==='AxeFlaunt'||n===FLAUNT_IDLE); if(isFlaunt!==flauntWant){ flauntWant=isFlaunt; syncAudio(); }   // either flaunt brings in the flaunt song
  { const isD=!!DANCE_SETS[n], k=isD?DANCE_SETS[n].key:danceKey; if(isD!==danceWant||k!==danceKey){ danceWant=isD; danceKey=k; syncAudio(); } }   // the Dance animation brings in its own song
  if(n===EVT_CLIP) return;
  swishStopAll();
  evtDue=evtGo=evtDone=flauntDone=false;
  const next=actions[n], fd=(n===FLAUNT_IDLE)?0.3:0.12;   // fd: the hand-off from AxeFlaunt into its idle is eased a little longer
  if(evtPlaying){ actions[EVT_CLIP].fadeOut(0.12); evtPlaying=false; }
  if(current&&current!==next){ current.fadeOut(fd); }
  if(n==='Death'||n==='AxeFlaunt'||n==='Drinking_Potion'||(n==='Chestopen'&&chestScene)){ next.reset().setLoop(THREE.LoopOnce,1); next.clampWhenFinished=true; next.fadeIn(0.12).play(); }   // plays once and holds its last pose (AxeFlaunt ends with the axe raised, so it must not loop)
  else next.reset().setLoop(THREE.LoopRepeat,Infinity).fadeIn(fd).play();
  current=next;
  syncRockMeshes();
  if(n===SEAT_CLIP) schedEvt();
  document.querySelectorAll('#anims .item').forEach(b=>b.setAttribute('aria-checked',b.dataset.n===(AXE_BASE[n]||n)));
  if(ANIM_SFX[n]) ANIM_SFX[n]();
}
function schedEvt(){ evtClock=0; evtNext=5+Math.random()*6; evtDue=false; }   // next look-around in 5-11 s of seated time
/* The look-around starts on a Pose2 loop boundary and ends on Pose2's first pose (see closeLoop), so both hand-offs are seamless cuts. */
function startEvt(){
  const ev=actions[EVT_CLIP]; if(!ev||!current) return;
  evtDue=false; evtPlaying=true;
  /* start the new action BEFORE stopping the old one: stopping the last action on a bone resets it to the bind pose (the T-pose flash) */
  ev.reset().setLoop(THREE.LoopOnce,1); ev.clampWhenFinished=true; ev.play();
  current.stop();
  mixer.update(0); stickAxe();
}
function endEvt(){
  if(!evtPlaying) return; evtPlaying=false;
  if(current) current.reset().setLoop(THREE.LoopRepeat,Infinity).play();
  actions[EVT_CLIP].stop();
  mixer.update(0); stickAxe();
  schedEvt();
}
/* The exported Pose2 clips stop on a different pose than they start on (and some channels stop keying early), so every loop
   wrapped with a visible pop. Add a closing key back at the first pose so the loop, and the hand-off to/from the event, is continuous. */
/* Re-aim the left knee: keeps the clip's own little bob, just shifts the whole angle so the first key is deg (x-axis rotation only). */
function setLeftShin(clip,deg){
  const tr=clip.tracks.find(t=>t.name==='Left_Shin.quaternion'); if(!tr) return;
  const v=Array.from(tr.values), n=tr.times.length, a0=2*Math.atan2(v[0],v[3]), d=deg*Math.PI/180-a0;
  for(let k=0;k<n;k++){ const a=2*Math.atan2(v[4*k],v[4*k+3])+d; v[4*k]=Math.sin(a/2); v[4*k+1]=0; v[4*k+2]=0; v[4*k+3]=Math.cos(a/2); }
  clip.tracks[clip.tracks.indexOf(tr)]=new tr.constructor(tr.name,Array.from(tr.times),v,tr.getInterpolation());
}
function closeLoop(clip,end){
  clip.tracks=clip.tracks.map(tr=>{
    const n=tr.times.length, vs=tr.getValueSize(), last=tr.times[n-1];
    const first=Array.from(tr.values.slice(0,vs)), vals=Array.from(tr.values), times=Array.from(tr.times);
    if(last<end-1e-4){ times.push(end); first.forEach(v=>vals.push(v)); }
    else { for(let k=0;k<vs;k++) vals[(n-1)*vs+k]=first[k]; }
    return new tr.constructor(tr.name,times,vals,tr.getInterpolation());
  });
  clip.resetDuration();
}
/* which ANIMATIONS sub-menu a clip belongs to: ENEMIES (the golem's), SHOPKEEPER (the Shop* clips), SELF (everything else - the knight's own) */
/* ANIM SET (options): UNIVERSAL plays the retargeted Universal Animation Library clips in place of some of the knight's own. The game keeps asking for Idle / Walk / Swing ... by name, so the swap
   just points those names at the UAL action: every loop mode, finish event and sound cue keeps working. One-shots are stretched to the length of the clip they replace, because the game's timing counts on it. */
const UAL_ALT={Idle:'UAL_Idle_Shield_Loop',AxeIdle:'UAL_Idle_Shield_Loop',Walk:'UAL_Walk_Loop',Swing:'UAL_Sword_Regular_A',AxeSwing:'UAL_Sword_Regular_C',Hit:'UAL_Hit_Stagger',Block:'UAL_Sword_Block',Drinking_Potion:'UAL_Consume'};
let ualOn=false; const ualOrig={}, ualAl={};
/* The game finds its clips by NAME (the swing's sword trail, the sounds that repeat every loop, the footsteps ...). So the UAL clip that replaces Swing is a copy that is itself called 'Swing' (Idle, Walk, Hit ... likewise): everything keyed on those names keeps working. */
function ualAlias(k,sn){ const key=k+'|'+sn; if(!ualAl[key]){ const c=actions[sn].getClip().clone(); c.name=k; c.ualSrc=sn; ualAl[key]=mixer.clipAction(c); } return ualAl[key]; }
/* ANIM SET: IDEAL (the default) = the UAL Idle and Hit, plus a different random UAL Sword_Regular_A / B / C for every swing; everything else is the knight's own. KNIGHT = all the knight's own.
   UNIVERSAL = every clip in UAL_ALT from the UAL library. While IDEAL is on, the UAL_ clips are hidden from the ANIMATIONS menus (HeavyCombo is not one of them, so it stays). */
let animSet='ideal'; const IDEAL_ALT={Idle:1,AxeIdle:1,Hit:1}, IDEAL_SWINGS=['UAL_Sword_Regular_A','UAL_Sword_Regular_B']; let idealSwingLast=-1;   // (Sword_Regular_C is left out: it looked buggy)
const animVisible=n=>!(animSet==='ideal'&&/^UAL_/.test(n));
function idealPickSwing(){   // called every time a Swing starts: a different one of the three each time
  const o=ualOrig.Swing; if(!o) return;
  let i; do{ i=(Math.random()*IDEAL_SWINGS.length)|0; }while(i===idealSwingLast&&IDEAL_SWINGS.length>2);   // (with only two swings left they are picked purely at random)
  idealSwingLast=i; const alt=ualAlias('Swing',IDEAL_SWINGS[i]); alt.setEffectiveTimeScale(1); alt.setDuration(o.getClip().duration); actions.Swing=alt;   // stretched to the knight's swing length, as in UNIVERSAL
}
function ualApply(){
  const U=animSet==='universal', I=animSet==='ideal';
  Object.keys(UAL_ALT).forEach(k=>{
    const sn=(k==='Block'&&weapon==='axe')?'UALX_Sword_Block':UAL_ALT[k], alt=actions[sn]&&ualAlias(k,sn); if(!ualOrig[k]&&actions[k]&&!actions[k].getClip().ualSrc) ualOrig[k]=actions[k];   // (Block with the axe: the game turns the model round again for it, so that one uses the clip in its original hand)
    const o=ualOrig[k]; if(!o||!alt) return;
    alt.setEffectiveTimeScale(1);
    if(U||(I&&IDEAL_ALT[k])){ actions[k]=alt; if(!/Idle|Walk|Hit/.test(k)) alt.setDuration(o.getClip().duration); } else actions[k]=o;   // Hit plays at its own speed: squeezed into the knight's 0.26 s it looked wrong
  });
  if(I) idealPickSwing();
}
function toggleUal(){
  let base=null; Object.keys(UAL_ALT).forEach(k=>{ if(current&&(current===actions[k]||current===ualOrig[k]||current===actions[UAL_ALT[k]]||current===actions.UALX_Sword_Block&&k==='Block')) base=k; });
  animSet=animSet==='ideal'?'knight':animSet==='knight'?'universal':'ideal'; ualOn=animSet==='universal'; ualApply(); if(base) play(base);
}
function animGroup(n){ return /^Shop/.test(n)?'shop':'self'; }
function buildMenu(){
  const box=document.getElementById('anims');
  menuNames.forEach((n,i)=>{
    const b=document.createElement('button'); b.className='item'; b.dataset.n=n; b.setAttribute('role','radio'); b.textContent=n;
    b.addEventListener('click',()=>menuPlay(n)); box.appendChild(b);
  });
}
function cycle(d){ const L=menuNames.filter(animVisible), c=current&&current.getClip().name, i=L.indexOf(AXE_BASE[c]||c); menuPlay(L[(i+d+L.length)%L.length]); }

/* ---------- toggles ---------- */
function setSwitch(id,on,label){ const b=document.getElementById(id); b.setAttribute('aria-checked',on); b.querySelector('.v').textContent=label; }
function toggleSpin(){ spin=!spin; setSwitch('spin',spin,spin?'On':'Off'); }
function toggleLook(){ ps1=!ps1; U.uSnap.value=U.uAffine.value=U.uDither.value=ps1?1:0; setSwitch('look',ps1,ps1?'PS1':'Modern'); document.body.classList.toggle('modern',!ps1); resize(); }
function togglePause(){ paused=!paused; setSwitch('pause',paused,paused?'On':'Off'); }
document.getElementById('spin').onclick=toggleSpin;
document.getElementById('look').onclick=toggleLook;
document.getElementById('pause').onclick=togglePause;
document.getElementById('sword').onclick=toggleWeapon;
const vBtn=document.getElementById('voice'); if(vBtn) vBtn.onclick=toggleVoice;
const vSel=document.getElementById('voicesel'); if(vSel) vSel.onchange=()=>{ setVoice(vSel.value); vSel.blur(); try{ sfx=sfx||new (window.AudioContext||window.webkitAudioContext)(); sfx.resume(); }catch(e){} playFlauntSfx(); };   // picking a voice previews its flaunt line
addEventListener('keydown',e=>{
  if(e.target.tagName==='SELECT'||e.target.tagName==='INPUT') return;
  if(e.target.tagName==='BUTTON'&&e.key===' ') return;
  const k=e.key.toLowerCase();
  if(exploring&&k!=='m'&&k!=='p') return;
  if(k===' '||k==='enter'||k.indexOf('arrow')===0){ e.preventDefault(); }
  else if(k==='t') toggleSpin(); else if(k==='p') toggleLook(); else if(k==='m') toggleMusic(); else if(k==='h') cycleHelmet(); else if(k==='w') setWorld(!forest);
});

/* ---------- camera input ---------- */
addEventListener('contextmenu',e=>e.preventDefault());   // right-drag orbits the camera, so no browser context menu (save image as, etc.)
const ptrs=new Map(); let pinch=0;
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId,[e.clientX,e.clientY]); pinch=0;});
canvas.addEventListener('pointermove',e=>{
  const p=ptrs.get(e.pointerId); if(!p||mapMode||startScr) return;
  if(invOn){ if(ptrs.size===1) yaw-=(e.clientX-p[0])*0.01; ptrs.set(e.pointerId,[e.clientX,e.clientY]); return; }   // the inventory: dragging sideways turns him (the camera's height and distance stay as the inventory set them)
  if(ptrs.size===1){ yaw-=(e.clientX-p[0])*0.01; pitch=Math.max(-0.35,Math.min(1.2,pitch+(e.clientY-p[1])*0.008)); }
  ptrs.set(e.pointerId,[e.clientX,e.clientY]);
  if(ptrs.size===2){ const [a,b]=[...ptrs.values()]; const d=Math.hypot(a[0]-b[0],a[1]-b[1]); if(pinch) zoom=Math.max(0.5,Math.min(2.2,zoom*pinch/d)); pinch=d; }
});
['pointerup','pointercancel'].forEach(t=>canvas.addEventListener(t,e=>{ptrs.delete(e.pointerId);pinch=0;}));
canvas.addEventListener('wheel',e=>{e.preventDefault(); if(mapMode||startScr||invOn) return; zoom=Math.max(0.5,Math.min(2.2,zoom*Math.exp(e.deltaY*0.001)));},{passive:false});

/* ---------- pixel filter (Options > PIXELS and COLORS; both only show in the PS1 look) ----------
   PIXELS: how many pixels tall the picture is rendered (it is then scaled up with hard edges): 240 is the normal PS1 look, lower is chunkier.
   COLORS: how many shades per color channel the dithering rounds to: 31 = 15-bit (the PS1), 15 = 12-bit, 7 = 9-bit, 3 = 6-bit. */
const PIX_STEPS=[['NORMAL',240],['CHUNKY',180],['HEAVY',120],['CRUSHED',80]];
const COL_STEPS=[['15-BIT',31],['12-BIT',15],['9-BIT',7],['6-BIT',3]];
let pixIdx=0, colIdx=2;   // the defaults: NORMAL (240 px tall) and 9-BIT color.   pixIdx: 0 NORMAL, 1 CHUNKY, 2 HEAVY, 3 CRUSHED.   colIdx: 0 15-BIT, 1 12-BIT, 2 9-BIT, 3 6-BIT
U.uLevels.value=COL_STEPS[colIdx][1];
function cyclePixels(){ if(!ps1) toggleLook(); pixIdx=(pixIdx+1)%PIX_STEPS.length; resize(); }
function cycleColors(){ if(!ps1) toggleLook(); colIdx=(colIdx+1)%COL_STEPS.length; U.uLevels.value=COL_STEPS[colIdx][1]; }
/* ---------- sizing ---------- */
function applyView(){   // where the picture sits: shifted aside for the menu (mapViewK = 1), centered when exploring or on the map
  const W=innerWidth,Hh=innerHeight,asp=W/Hh,k=mapViewK;
  if(exploring) camera.setViewOffset(W,Hh,0,0,W,Hh); else if(asp>=0.9) camera.setViewOffset(W,Hh,-W*0.2*k,0,W,Hh); else camera.setViewOffset(W,Hh,0,Hh*0.17*k,W,Hh);
  camera.updateProjectionMatrix();
}
function resize(){
  const W=innerWidth,Hh=innerHeight,asp=W/Hh; let w,h;
  if(ps1){ const s=PIX_STEPS[pixIdx][1]; if(asp>=1){h=s;w=Math.round(s*asp);} else {w=s;h=Math.round(s/asp);} }
  else { const r=Math.min(devicePixelRatio||1,2); w=Math.round(W*r); h=Math.round(Hh*r); }
  renderer.setSize(w,h,false); U.uRes.value.set(w,h);
  camera.aspect=asp; applyView();
  const fit=baseDist/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*1.5;
  camera.userData.fit=asp<0.8?fit*0.8/asp:fit;
}
addEventListener('resize',resize); resize();

/* ---------- explore mode: walk around the forest ---------- */
let playerRig=null, floorMesh=null, blobMesh=null, blobHome=null, playerH=2.2, homeTarget=new THREE.Vector3(), colliders=[];
const WALK_SPEED=0.9, RUN_MULT=1.7, BOUND=10.5, TREE_R=0.16, PLAYER_R=0.1;   // speeds/radii are in knight-heights
const keys=new Set(); const stick={x:0,y:0}; let moving=false, heading=Math.PI;
let swinging=false, swingQueued=false, swingDone=false, downAt=null;
function startExplore(){
  if(!playerRig||exploring) return;
  swooshHide(); exploring=true; document.body.classList.add('explore'); swinging=swingQueued=swingDone=false;
  yaw=0; pitch=0.22; zoom=0.7; moving=false; heading=Math.PI; playerRig.rotation.y=heading;
  play(idleName()); resize();
}
function stopExplore(){
  if(!exploring) return;
  swooshHide(); exploring=false; document.body.classList.remove('explore'); swinging=swingQueued=swingDone=false; swingScaleReset(); keys.clear(); stick.x=stick.y=0; moving=false;
  playerRig.position.set(0,0,areaZOffset()); playerRig.rotation.y=Math.PI;
  floorMesh.position.x=0; floorMesh.position.z=-FROST_DIST*playerH; if(blobMesh&&blobHome) blobMesh.position.set(blobHome.x,blobHome.y,blobHome.z+areaZOffset());
  target.set(homeTarget.x,homeTarget.y,homeTarget.z+areaZOffset()); yaw=Math.PI+0.65; pitch=0.1; zoom=0.82;
  if(actions.Walk) actions.Walk.timeScale=1;
  play(names.indexOf(SEAT_CLIP)>=0?SEAT_CLIP:names[0]); resize();
}
function exploreStep(dt){
  const dn=k=>keys.has(k)?1:0;
  const f=dn('w')+dn('arrowup')-dn('s')-dn('arrowdown')+stick.y, r=dn('d')+dn('arrowright')-dn('a')-dn('arrowleft')+stick.x;
  const mx=f*(-Math.sin(yaw))+r*Math.cos(yaw), mz=f*(-Math.cos(yaw))+r*(-Math.sin(yaw));
  let len=Math.hypot(mx,mz); const run=keys.has('shift'), p=playerRig.position, H=playerH;
  if(len>0.08&&!swinging){
    const amt=Math.min(len,1), dx=mx/len, dz=mz/len, sp=WALK_SPEED*H*(run?RUN_MULT:1)*amt;
    let nx=p.x+dx*sp*dt, nz=p.z+dz*sp*dt;
    for(const c of colliders){ const ox=nx-c.x, oz=nz-c.z, rr=c.r+PLAYER_R*H, d2=ox*ox+oz*oz; if(d2<rr*rr){ const d=Math.sqrt(d2)||1e-4; nx=c.x+ox/d*rr; nz=c.z+oz/d*rr; } }
    const bd=Math.hypot(nx,nz), lim=BOUND*H; if(bd>lim){ nx*=lim/bd; nz*=lim/bd; }
    p.x=nx; p.z=nz;
    const want=Math.atan2(dx,dz); let diff=((want-heading+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
    heading+=diff*Math.min(1,dt*12); playerRig.rotation.y=heading;
    if(!moving){ moving=true; if(actions.Walk) play('Walk'); }
    if(actions.Walk) actions.Walk.timeScale=run?1.6:1;
  } else if(moving&&!swinging){ moving=false; play(idleName()); }
  const want=new THREE.Vector3(homeTarget.x+p.x,homeTarget.y,homeTarget.z+p.z);
  target.lerp(want,1-Math.exp(-dt*12));
  floorMesh.position.x=Math.round(p.x/H)*H; floorMesh.position.z=Math.round(p.z/H)*H;   // ground follows you, snapped so the checker never slides
  if(blobMesh&&blobHome) blobMesh.position.set(blobHome.x+p.x,blobHome.y,blobHome.z+p.z);
}
addEventListener('keydown',e=>{
  if(!exploring) return;
  const k=e.key.toLowerCase();
  if(k==='escape'){ if(dungeon&&bmOpen) bmBack(); else leaveMode(); return; }
  keys.add(k); if(k.indexOf('arrow')===0||k===' ') e.preventDefault();
});
addEventListener('keyup',e=>{ keys.delete(e.key.toLowerCase()); });
addEventListener('blur',()=>keys.clear());
document.getElementById('hudmenu').onclick=leaveMode;
(function(){
  const pad=document.getElementById('stick'), knob=document.getElementById('knob'); let id=null;
  function upd(e){ const b=pad.getBoundingClientRect(), R=b.width/2; let x=(e.clientX-b.left-R)/R, y=(e.clientY-b.top-R)/R; const l=Math.hypot(x,y); if(l>1){x/=l;y/=l;}
    stick.x=x; stick.y=-y; knob.style.transform='translate('+(x*R*0.6)+'px,'+(y*R*0.6)+'px)'; }
  pad.addEventListener('pointerdown',e=>{ id=e.pointerId; pad.setPointerCapture(id); upd(e); e.stopPropagation(); });
  pad.addEventListener('pointermove',e=>{ if(e.pointerId===id) upd(e); });
  const end=e=>{ if(e.pointerId===id){ id=null; stick.x=stick.y=0; knob.style.transform=''; } };
  pad.addEventListener('pointerup',end); pad.addEventListener('pointercancel',end);
})();

/* ---------- click / tap to swing (explore mode) ---------- */
function swing(){
  if(!actions[swingName()]||!exploring||dungeon||paused) return;
  if(swinging){ swingQueued=true; return; }
  if(animSet==='ideal'&&swingName()==='Swing') idealPickSwing();   // IDEAL: a random A / B / C for every swing
  const sw=actions[swingName()];          // one click is buffered, so mashing chains swings
  swinging=true; swingQueued=false;
  if(current&&current!==sw) current.fadeOut(0.06);   // cross-fade, never stop(): stopping the last action snaps the skeleton to the T-pose
  sw.reset().setLoop(THREE.LoopOnce,1); sw.clampWhenFinished=true; sw.timeScale=1.25; sw.fadeIn(0.06).play();
  current=sw; playSword(1.25);
}
function endSwing(){
  swinging=false; swingScaleReset();
  if(!exploring) return;
  if(swingQueued){ swingQueued=false; swing(); return; }
  moving=false; play(idleName());                        // the next movement frame switches to Walk again if keys are held
}
canvas.addEventListener('pointerdown',e=>{ downAt=(e.button===0&&e.isPrimary)?{x:e.clientX,y:e.clientY,t:performance.now()}:null; });
canvas.addEventListener('pointerup',e=>{
  if(downAt&&exploring&&Math.hypot(e.clientX-downAt.x,e.clientY-downAt.y)<8&&performance.now()-downAt.t<450) swing();   // a click, not a camera drag
  downAt=null;
});

/* ---------- dungeon forest: a few hundred trees (one trunk mesh, one canopy mesh) plus stretched boulders (one mesh), ringed around the ruins ----------
   Radii are in knight-heights from the circle. Nothing is placed inside `inner` (so the camera never ends up inside a canopy) or in the `lane` he walks in along. */
const DGF={count:380,inner:5.6,outer:12.5,lane:2.2,minS:0.7,maxS:2.1};   // tree count, ring radii, half-width of the clear walk-in lane, size range
const DGR={count:170,minS:0.5,maxS:2.6};   // boulders: how many, and the base size range (the seat rock times this, then stretched per axis)
let dgForest=null;
/* ---------- classic sky: the flipping shapes, enlarged and spread around the sky (shown only in the Classic world) ----------
   Distances and sizes are in knight-heights, elevation in degrees. Each shape is copied `copies` times, each copy with its own spot, size, speed and flip timing. */
const SKYN={copies:4,minR:34,maxR:62,minEl:8,maxEl:50,minSize:4,maxSize:10};
let skyGroup=null, skyT=0; const skyItems=[], skyQ=new THREE.Quaternion();
function initSky(H,groundY){
  const FD=JSON.parse(document.getElementById('flip-data').textContent);
  Promise.all(FD.map(sh=>loadImg(sh.tex))).then(imgs=>{
    let sd=4242; const rnd=()=>{ sd=(sd+0x6D2B79F5)|0; let t=Math.imul(sd^(sd>>>15),1|sd); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
    const grp=new THREE.Group(), total=FD.length*SKYN.copies; let idx=0;
    FD.forEach((sh,k)=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(sh.p,3)); geo.setAttribute('normal',new THREE.Float32BufferAttribute(sh.n,3)); geo.setAttribute('uv',new THREE.Float32BufferAttribute(sh.uv,2)); geo.setIndex(sh.i);
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
      const mat=ps1Mat(tex,1); mat.uniforms.uFogNear={value:1e6}; mat.uniforms.uFogFar={value:2e6};   // their own fog values: far away, but never faded out
      for(let c=0;c<SKYN.copies;c++,idx++){
        const az=(((idx*0.618034)%1)+(rnd()-0.5)*0.05)*Math.PI*2, el=(SKYN.minEl+Math.pow(rnd(),1.3)*(SKYN.maxEl-SKYN.minEl))*Math.PI/180;   // golden-ratio spread around the compass, mostly low enough to see
        const R=Math.min((SKYN.minR+rnd()*(SKYN.maxR-SKYN.minR))*H,170), size=H*(SKYN.minSize+rnd()*(SKYN.maxSize-SKYN.minSize));
        const pivot=new THREE.Group(), m=new THREE.Mesh(geo,mat); m.position.set(sh.off[0],sh.off[1],sh.off[2]); pivot.add(m);
        pivot.scale.setScalar(size/sh.dim);
        pivot.position.set(Math.cos(az)*Math.cos(el)*R, groundY+Math.sin(el)*R, Math.sin(az)*Math.cos(el)*R);
        pivot.frustumCulled=false; grp.add(pivot);
        skyItems.push({pivot,anim:sh.anim,off:rnd()*sh.anim.T,speed:0.6+rnd()*0.7});
      }
    });
    grp.visible=!forest; scene.add(grp); skyGroup=grp;
  }).catch(e=>console.error('sky failed',e));
}
function updateSky(dt){
  if(!skyGroup||!skyGroup.visible) return;
  skyT+=dt; const st=ps1?Math.floor(skyT*15)/15:skyT;     // steps at 15 fps in the PS1 look, like the other animation
  skyGroup.position.set(target.x,0,target.z);             // rides along with the camera, so the sky never gets closer
  skyItems.forEach(it=>{
    const A=it.anim, t=(st*it.speed+it.off)%A.T; let i=0; while(i<A.t.length-2&&A.t[i+1]<=t) i++;
    const f=(t-A.t[i])/((A.t[i+1]-A.t[i])||1), a=A.q[i], b=A.q[i+1];
    it.pivot.quaternion.set(a[0],a[1],a[2],a[3]).slerp(skyQ.set(b[0],b[1],b[2],b[3]),f);
  });
}

function initDgForest(H,groundY,ctr){
  const TD=JSON.parse(document.getElementById('tree-data').textContent).parts;
  const rockEl=document.getElementById('rock-data'), RK=rockEl?JSON.parse(rockEl.textContent):null;
  Promise.all(TD.map(p=>loadImg(p.tex)).concat(RK?[loadImg(RK.tex)]:[])).then(imgs=>{
    let sd=777; const rnd=()=>{ sd=(sd+0x6D2B79F5)|0; let t=Math.imul(sd^(sd>>>15),1|sd); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };   // fixed seed: same forest every visit
    const spots=[];
    for(let tries=0;spots.length<DGF.count&&tries<9000;tries++){
      const a=rnd()*Math.PI*2, r=(DGF.inner+Math.sqrt(rnd())*(DGF.outer-DGF.inner))*H, sc=DGF.minS+Math.pow(rnd(),1.5)*(DGF.maxS-DGF.minS);
      const x=ctr.x+Math.cos(a)*r, z=ctr.z+Math.sin(a)*r, c=1.6*sc;                  // c = canopy radius in world units
      if(r-c<DGF.inner*H) continue;
      if(x>ctr.x&&Math.abs(z-ctr.z)<DGF.lane*H+c*0.5) continue;
      if(spots.some(q=>Math.hypot(q.x-x,q.z-z)<0.5*(q.c+c))) continue;               // canopies may overlap, trunks may not
      spots.push({x,z,sc,c,yw:rnd()*Math.PI*2});
    }
    const grp=new THREE.Group(); grp.visible=false;
    const westClear=q=>!(q.x<ctr.x&&Math.abs(q.z-ctr.z)<DGF.lane*H+q.c*0.5);   // the lane he walks out along after a win, straight west through the gap
    TD.forEach((p,k)=>{
      const P=[],N=[],UV=[],I=[]; let base=0;
      spots.filter(westClear).forEach(q=>{
        const co=Math.cos(q.yw), si=Math.sin(q.yw);
        for(let v=0;v<p.p.length;v+=3){
          const x=(p.p[v]+p.t[0])*q.sc, y=(p.p[v+1]+p.t[1])*q.sc, z=(p.p[v+2]+p.t[2])*q.sc;
          P.push(q.x+x*co+z*si, groundY+y, q.z-x*si+z*co);
          N.push(p.n[v]*co+p.n[v+2]*si, p.n[v+1], -p.n[v]*si+p.n[v+2]*co);
        }
        for(const u of p.uv) UV.push(u);
        for(const i of p.i) I.push(base+i);
        base+=p.p.length/3;
      });
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(P,3)); geo.setAttribute('normal',new THREE.Float32BufferAttribute(N,3)); geo.setAttribute('uv',new THREE.Float32BufferAttribute(UV,2));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(I),1));
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false; tex.needsUpdate=true;
      grp.add(new THREE.Mesh(geo,ps1Mat(tex,1)));
    });
    if(RK){   // boulders: your rock model stretched every which way, half buried, scattered between the trees (one more draw call)
      const rocks=[];
      for(let tries=0;rocks.length<DGR.count&&tries<6000;tries++){
        const a=rnd()*Math.PI*2, r=(DGF.inner+Math.sqrt(rnd())*(DGF.outer-DGF.inner))*H;
        let b=DGR.minS+Math.pow(rnd(),1.6)*(DGR.maxS-DGR.minS); if(rnd()<0.06) b*=2;                      // the odd huge one
        const sx=b*(0.8+rnd()*0.9), sy=b*(0.55+rnd()*0.6), sz=b*(0.8+rnd()*0.9), rr=0.6*Math.max(sx,sz);   // independent stretch per axis
        const x=ctr.x+Math.cos(a)*r, z=ctr.z+Math.sin(a)*r;
        if(r-rr<DGF.inner*H) continue;                                                  // same camera-room and walk-in-lane rules as the trees
        if(x>ctr.x&&Math.abs(z-ctr.z)<DGF.lane*H+rr) continue;
        if(spots.some(q=>Math.hypot(q.x-x,q.z-z)<rr+0.25*q.sc)) continue;               // not on a trunk
        if(rocks.some(q=>Math.hypot(q.x-x,q.z-z)<0.6*(q.rr+rr))) continue;
        rocks.push({x,z,sx,sy,sz,rr,yw:rnd()*Math.PI*2});
      }
      const rk=rocks.filter(q=>!(q.x<ctr.x&&Math.abs(q.z-ctr.z)<DGF.lane*H+q.rr));
      const P=[],N=[],UV=[],I=[]; let base=0;
      rk.forEach(q=>{
        const co=Math.cos(q.yw), si=Math.sin(q.yw);
        for(let v=0;v<RK.p.length;v+=3){
          const x=RK.p[v]*q.sx, y=RK.p[v+1]*q.sy, z=RK.p[v+2]*q.sz;                     // the rock's middle is at floor level, so half of it is in the ground
          P.push(q.x+x*co+z*si, groundY+y, q.z-x*si+z*co);
          let nx=RK.n[v]/q.sx, ny=RK.n[v+1]/q.sy, nz=RK.n[v+2]/q.sz; const l=Math.hypot(nx,ny,nz)||1; nx/=l; ny/=l; nz/=l;   // normals of a stretched shape
          N.push(nx*co+nz*si, ny, -nx*si+nz*co);
        }
        for(const u of RK.uv) UV.push(u); for(const i of RK.i) I.push(base+i); base+=RK.p.length/3;
      });
      if(rk.length){
        const geo=new THREE.BufferGeometry();
        geo.setAttribute('position',new THREE.Float32BufferAttribute(P,3)); geo.setAttribute('normal',new THREE.Float32BufferAttribute(N,3)); geo.setAttribute('uv',new THREE.Float32BufferAttribute(UV,2));
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(I),1));
        const tex=new THREE.Texture(imgs[TD.length]); tex.flipY=false; tex.needsUpdate=true;
        grp.add(new THREE.Mesh(geo,ps1Mat(tex,1)));
      }
    }
    occMark(grp); scene.add(grp); dgForest=grp;   // trees and boulders dither away when they are in front of someone
  }).catch(e=>console.error('dungeon forest failed',e));
}

/* ---------- dungeon 1: MOSSY RUINS (ruins-data: Blockbench glTF, baked to world space and merged per material) ----------
   The ruins are scaled by RUINS_SCALE, and the circle's middle is always under the knight's start spot. The knight walks in through the
   gate (the gap in the east wall, +x side) onto the circle and drops into Idle; the camera then drifts between a set of shots, Resident-Evil style.
   This is where the turn-based fights will happen. Esc / MENU leaves. */
const RUINS_SCALE=1.15;        // knight-heights per ruins-file unit (was ~1.6): smaller ruins, bigger-looking knight. The walls are 1.5 units = ~1.7 knight-heights
/* The arena: the knight holds the circle facing west; the enemy line stands across the courtyard facing him (floor rings mark the slots for now).
   dist = how far west of him the line is, gap = spacing along the line, both in knight-heights. n = 0 removes the markers. */
const DG_ENEMY={n:3,dist:2.2,gap:0.6};
const DG_BLEND_MIN=3.2, DG_BLEND_MAX=8;   // seconds a move between two shots takes (longer for bigger swings)
const DG_START=4.2;            // where the walk-in starts, in knight-heights east of the circle (outside the gate)
const DG_FOG=[4.5,10];         // fog near/far in knight-heights, pushed out so the whole compound can be seen
/* camera shots: yaw is where the camera sits around the knight (0 = south, 90 = east/outside the gate, 180 = north, -90 = west, in front of him),
   drift = slow pan in deg/s, pitch in radians, dist in knight-heights, ty = look-at height above his middle in knight-heights */
const DG_INTRO={yaw:112,drift:1.2,pitch:0.20,dist:3.0,ty:0.20,mid:0};
const DG_SHOTS=[   // every shot orbits the CENTER of the battlefield (mid 0.5 = halfway between the knight and the enemy line) from far enough back that all of them and their health bars stay in frame; anything in the way dithers
  {yaw:78,  drift: 1.6,pitch:0.20,dist:4.2,ty:0.12,mid:0.5},    // from the gate, toward the enemy line
  {yaw:-78, drift: 2.0,pitch:0.16,dist:4.2,ty:0.12,mid:0.5},    // from the enemy side
  {yaw:180, drift: 2.0,pitch:0.32,dist:4.4,ty:0.10,mid:0.5},    // north, wide duel
  {yaw:0,   drift:-2.0,pitch:0.32,dist:4.4,ty:0.10,mid:0.5},    // south, wide duel
  {yaw:-30, drift:-3.0,pitch:1.00,dist:4.2,ty:0.00,mid:0.5},    // near-overhead duel
  {yaw:-100,drift: 2.0,pitch:0.14,dist:4.2,ty:0.12,mid:0.5},    // low, from behind the enemies
  {yaw:70,  drift: 1.8,pitch:0.12,dist:4.2,ty:0.12,mid:0.5}     // low, at the gate
];
let ruinsGroup=null, dgSlots=null, dungeon=false, dgBusy=false, dgState='walkin', fogBak=null, hudBak='', dgSmD=-1, dgSmP=0.2;
const dgCam={yaw:0,pitch:0.2,dist:3.5,ty:0.2,mid:0}; let dgBlendT=3, dgYawV=0, dgPrevYaw=0, dgVelD={v:0}, dgVelP={v:0}; let dgShot=DG_INTRO, dgFrom=null, dgBlend=1, dgT=0, dgDur=1e9, dgLast=-1, dgYaw=0;
/* ---------- campfire flame: tiny_fire.gif (4 frames, 200 ms each, cropped to a strip), a camera-facing sprite sitting in the log pile ----------
   Positions are in the ruins file's own units (the group scales them). */
const FIRE_FRAMES=4, FIRE_MS=200, FIRE_ASPECT=11/12;
const FIRE_POS=[-0.17,0.28,-1.665], FIRE_H=0.40;      // centre of the flame (in the log pile), and its height; the width follows the gif's proportions
const FIRE_ATLAS="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACwAAAAMCAYAAAAZKF83AAABAElEQVR4nMWTQQqDMBBFx6RQqB5A6EK9U29Z76QuBA+ggoskXZQpafjTji2lH2Yhvvnzx0QKgYjrWlUhfpZKy/2iYBhNoF8t9443BFQ0ltq6CuhdLA2zh9PwMLC2WbuYlkN82vcUuK2rUDSW8rN5NKFhiEPmEidJM98gWDLTcBo/FFzra1L4VN6Lt5w7R0VjYXPMSaexh0M8z2f+gBrsMaNTed80PxtaRi9uzByz/AEkv5S79EO2xxcGjpvWSQ6LwiC5Lag45JtmEB3sES7+0jzWpR+yuXO0jJ7WyX8cOpWRzN0WaJ08LaOnuXPER/cty1wqrW8Wotsm/Qjonv2LvQFD/JObPH8xrAAAAABJRU5ErkJggg==";
let campfire=null; const fireV=new THREE.Vector3();
function initFire(grp){
  loadImg(FIRE_ATLAS).then(img=>{
    const tex=new THREE.Texture(img); tex.magFilter=tex.minFilter=THREE.NearestFilter; tex.generateMipmaps=false;
    tex.repeat.set(1/FIRE_FRAMES,1); tex.needsUpdate=true;
    const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,fog:false}));
    spr.position.set(FIRE_POS[0],FIRE_POS[1],FIRE_POS[2]); spr.scale.set(FIRE_H*FIRE_ASPECT,FIRE_H,1); spr.renderOrder=5;
    grp.add(spr); campfire={spr,tex,t:Math.random()*FIRE_FRAMES*FIRE_MS/1000,fi:-1};
  }).catch(e=>console.error('fire load failed',e));
}
function updateFire(dt){
  if(!campfire||!ruinsGroup||!ruinsGroup.visible) return;
  campfire.t+=dt; const fi=Math.floor(campfire.t*1000/FIRE_MS)%FIRE_FRAMES;
  if(fi!==campfire.fi){ campfire.fi=fi; campfire.tex.offset.x=fi/FIRE_FRAMES; }
  const near=U.uFogNear.value, far=U.uFogFar.value, d=camera.position.distanceTo(campfire.spr.getWorldPosition(fireV)), f=Math.min(1,Math.max(0,(d-near)/(far-near)));
  campfire.spr.material.opacity=1-f*f*(3-2*f);   // fades into the fog like everything else
}
/* Z-fighting fix for the ruins: the model has triangles that sit exactly on top of other triangles (36 in one wall part, 420 in the spike palisade). Two surfaces at the same depth fight for the pixel and flicker as the camera moves, so each repeated triangle is dropped and only the first is kept. */
function dropDuplicateTris(pos,idx){
  const seen=new Set(), out=[], q=v=>Math.round(pos[v*3]*1000)+','+Math.round(pos[v*3+1]*1000)+','+Math.round(pos[v*3+2]*1000);
  for(let t=0;t<idx.length;t+=3){
    const key=[q(idx[t]),q(idx[t+1]),q(idx[t+2])].sort().join('|');
    if(seen.has(key)) continue; seen.add(key); out.push(idx[t],idx[t+1],idx[t+2]);
  }
  return out;
}
/* the MOSSY RUINS also stand at their spot on the map (a second copy of the model, made before the flame is added); the trees near it are moved aside,
   and it is turned toward the knight - RUINS_FACE of the way (1 = its gate points straight at him, 0 = it keeps the file's direction) */
const RUINS_FACE=0.6; let mapRuins=null;
function clearTreesForMapRuins(){
  if(!mapRuins||!greenTreeGroup||mapRuins.done) return; mapRuins.done=true; const m=mapRuins;
  greenTreeGroup.children.forEach(tr=>{
    let dx=tr.position.x-m.x, dz=tr.position.z-m.z, d=Math.hypot(dx,dz); if(d>=m.R) return;
    if(d<1e-3){ dx=1; dz=0; d=1; } tr.position.x=m.x+dx/d*m.R; tr.position.z=m.z+dz/d*m.R;   // pushed straight out to just beyond the ruins
  });
}
function updateMapRuins(){ if(mapRuins) mapRuins.g.visible=forest&&!dungeon&&mapArea==='greenfield'; }
function initRuins(H,groundY,ctr){
  const el=document.getElementById('ruins-data'); if(!el) return;
  const RD=JSON.parse(el.textContent), S=RUINS_SCALE*H;
  Promise.all(RD.tex.map(loadImg)).then(imgs=>{
    const grp=new THREE.Group(); grp.name='MossyRuins';
    RD.parts.forEach(pt=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(pt.p,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(pt.n,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(pt.uv,2));
      geo.setIndex(dropDuplicateTris(pt.p,pt.i));   // identical triangles stacked on each other flicker (z-fighting) - keep one of each
      let tex;
      if(pt.t>=0){ tex=new THREE.Texture(imgs[pt.t]); }
      else { const cv=document.createElement('canvas'); cv.width=cv.height=1; const g=cv.getContext('2d'); g.fillStyle='#d9d9d9'; g.fillRect(0,0,1,1); tex=new THREE.CanvasTexture(cv); }
      tex.flipY=false;
      const m=new THREE.Mesh(geo,ps1Mat(tex,1)); m.frustumCulled=false; if(pt.nocam) m.userData.noCam=true; grp.add(m);
    });
    occMark(grp);    // every wall and pillar can dither away when it is in front of someone (the flame, added next, is not an obstacle)
    { const view=grp.clone(true), sp=MAP_AREAS.greenfield.spots[0], wx=ctr.x+sp.x*H, wz=ctr.z+sp.z*H, holder=new THREE.Group();
      view.scale.setScalar(S); view.position.set(-S*RD.c[0],-S*RD.c[1],-S*RD.c[2]); holder.add(view);
      holder.position.set(wx,groundY+0.003*H,wz); holder.rotation.y=Math.atan2(-(ctr.z-wz),ctr.x-wx)*RUINS_FACE;
      scene.add(holder); holder.updateMatrixWorld(true); const sz=new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
      mapRuins={g:holder,x:wx,z:wz,R:0.45*Math.hypot(sz.x,sz.z)+0.4*H}; clearTreesForMapRuins(); }
    initFire(grp);   // added after the line above, so the flame is never something the camera collides with
    grp.scale.setScalar(S);
    grp.position.set(ctr.x-S*RD.c[0], groundY+0.003*H-S*RD.c[1], ctr.z-S*RD.c[2]);   // the circle's middle lands exactly under the knight's shadow
    grp.visible=false; scene.add(grp); ruinsGroup=grp;
    const sl=new THREE.Group(); sl.visible=false;   // floor rings where the enemy line will stand, facing the knight
    for(let k=0;k<DG_ENEMY.n;k++){
      const r=new THREE.Mesh(new THREE.RingGeometry(0.2*H,0.3*H,14),new THREE.MeshBasicMaterial({color:0xb02a2a,transparent:true,opacity:0.75,depthWrite:false,fog:false,side:THREE.DoubleSide}));
      r.rotation.x=-Math.PI/2; r.position.set(ctr.x-DG_ENEMY.dist*H,groundY+0.006*H,ctr.z+(k-(DG_ENEMY.n-1)/2)*DG_ENEMY.gap*H); sl.add(r);
    }
    scene.add(sl); dgSlots=sl;
  }).catch(e=>console.error('ruins load failed',e));
}
function fadeThen(fn){ const f=document.getElementById('fade'); f.style.opacity=1; setTimeout(()=>{ try{ fn(); }catch(e){ console.error('dungeon transition failed',e); dgBusy=false; if(window.toast) window.toast('ERROR: '+(e&&e.message||e).toString().slice(0,40)); } requestAnimationFrame(()=>requestAnimationFrame(()=>{ f.style.opacity=0; })); },480); }
function dgStart(shot,blend){ dgFrom=blend?{yaw:dgCam.yaw,pitch:dgCam.pitch,dist:dgCam.dist,ty:dgCam.ty,mid:dgCam.mid}:null; dgBlend=blend?0:1; dgShot=shot; dgYaw=shot.yaw*Math.PI/180; dgT=0;
  if(blend){   // the further the camera has to travel, the longer the move (about 25 deg/s on average), so big swings are never sudden
    const TAU=Math.PI*2; dgFrom.dy0=((dgYaw-dgFrom.yaw+Math.PI)%TAU+TAU)%TAU-Math.PI;   // which way round to swing is decided ONCE here (re-deciding every frame can flip the direction mid-move when the shots are ~180 deg apart)
    const dy=Math.abs(dgFrom.dy0)*180/Math.PI;
    dgBlendT=Math.min(DG_BLEND_MAX,Math.max(DG_BLEND_MIN,2.2+dy/28+Math.abs(shot.dist-dgFrom.dist)*0.5+Math.abs(shot.pitch-dgFrom.pitch)*3));
    dgDur=dgBlendT+4.5+Math.random()*4;   // then a few seconds of calm drift before the next move
  } else dgDur=8+Math.random()*5;
}
function dgNext(){ let k; do{ k=Math.floor(Math.random()*DG_SHOTS.length); }while(k===dgLast&&DG_SHOTS.length>1); dgLast=k; dgStart(DG_SHOTS[k],true); }
function enterDungeon(){
  if(exploring||dgBusy) return;
  if(!playerRig||!ruinsGroup){ (window.toast||console.log)('STILL LOADING...'); return; }
  dgBusy=true;
  fadeThen(()=>{
    mapSnap();   // coming from the map: menu camera, fog and floor back at once (it is black right now) - before the fog is saved below
    dgBusy=false; swooshHide();
    exploring=true; dungeon=true; document.body.classList.add('explore','dungeon');
    swinging=swingQueued=swingDone=false; keys.clear(); stick.x=stick.y=0;
    const hud=document.getElementById('hud'); hudBak=hud.innerHTML; hud.innerHTML=HINT_AIM;
    fogBak=[U.uFogNear.value,U.uFogFar.value]; U.uFogNear.value=DG_FOG[0]*playerH; U.uFogFar.value=DG_FOG[1]*playerH;
    ruinsGroup.visible=true; if(dgSlots) dgSlots.visible=true; dgWave=0; try{ spawnEnemies(); }catch(e){ console.error('spawnEnemies failed',e); } battleReset(); setBattleMusic(true); try{ showPointer(); }catch(e){ console.error('showPointer failed',e); } if(dgForest) dgForest.visible=true; if(treeGroup) treeGroup.visible=false;
    playerRig.position.set(DG_START*playerH,0,0); heading=-Math.PI/2; playerRig.rotation.y=heading;   // facing west, into the ruins
    floorMesh.position.x=floorMesh.position.z=0;
    chestScene=false; chestDone=false; chestEndT=-1;
    dgState='walkin'; moving=true; if(actions.Walk){ actions.Walk.timeScale=1; play('Walk'); }
    dgCam.yaw=DG_INTRO.yaw*Math.PI/180; dgCam.pitch=DG_INTRO.pitch; dgCam.dist=DG_INTRO.dist; dgCam.ty=DG_INTRO.ty; dgCam.mid=DG_INTRO.mid; dgSmD=-1; dgSmP=DG_INTRO.pitch;
    dgStart(DG_INTRO,false); dgDur=1e9; dgLast=-1;
    resize(); dungeonStep(0);
  });
}
function leaveDungeon(){
  if(!dungeon||dgBusy) return;
  dgBusy=true; setBattleMusic(false);
  fadeThen(()=>{
    dgBusy=false; dungeon=false; chestScene=false; chestDone=false; chestEndT=-1; hideLoot(); loot.picked=false; document.body.classList.remove('dungeon');
    clearEnemies(); if(ruinsGroup) ruinsGroup.visible=false; if(dgSlots) dgSlots.visible=false; if(dgForest) dgForest.visible=false; if(treeGroup) treeGroup.visible=forest;
    if(fogBak){ U.uFogNear.value=fogBak[0]; U.uFogFar.value=fogBak[1]; fogBak=null; }
    document.getElementById('hud').innerHTML=hudBak;
    stopExplore();
  });
}
function leaveMode(){ if(dungeon) leaveDungeon(); else stopExplore(); }
/* ---------- enemy knights: one stands on each red ring, facing the player, each with its own random armor tint, plume and sword color ----------
   They are clones of the player's knight (same model and sword, but a different helmet each, never the one the player wears) with their own materials, so recoloring one never touches another or the player.
   A fresh random set is rolled every time you enter the ruins. Colors are drawn from the same swatches the Customize screen offers (null = the original look). */
const EN_ARMOR=[null,'#e8604f','#e8b830','#58b868','#4a88e8','#9a60e0','#e878b0','#3cc4bc'];
const EN_PLUME=[null,'#4a78e8','#4fc25a','#f0c030','#a05ae0','#f2f2f2'];
const EN_SWORD=[null,'#e8604f','#e8b830','#58b868','#4a88e8','#9a60e0','#e878b0','#3cc4bc'];
let knightScene=null; const enemies=[];
function shuffled(a){ const b=a.slice(); for(let i=b.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=b[i]; b[i]=b[j]; b[j]=t; } return b; }
let elementalGltf=null;
const SLIME_SCALE=1.2, SLIME_HIT_AT=0.65;
function initElemental(){
  const el=document.getElementById('elemental-data'); if(!el) return;
  try{
    const raw=(function(){ const s=atob(el.textContent.trim()), u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u.buffer; })();
    new THREE.GLTFLoader().parse(raw,'',g=>{ elementalGltf=g; },e=>console.error('elemental load failed',e));
  }catch(e){ console.error('elemental failed',e); }
}
function cloneElemental(){
  const root=elementalGltf.scene.clone(true);
  root.scale.setScalar(SLIME_SCALE);
  root.rotation.y=Math.PI;   // flip 180 deg so the slime's front faces +Z in rig space, matching the knight
  root.traverse(o=>{
    if(!o.isMesh) return;
    const m=ps1Mat(o.material.map,1);
    if(o.name==='outer_mesh'){
      m.fragmentShader=m.fragmentShader.replace('if(tx.a<0.5) discard;','if(tx.a<0.05) discard;').replace('gl_FragColor=vec4(c,1.0);','gl_FragColor=vec4(c,tx.a);');
      m.transparent=true; m.depthWrite=false; o.renderOrder=2;
    } else if(o.name==='inner_mesh'){
      o.renderOrder=1;
    } else {
      o.renderOrder=0;
    }
    m.uniforms.uFade={value:1};   // 1 = solid; the fade-out when an enemy without a death animation dies brings it to 0
    m.fragmentShader=m.fragmentShader.replace('uniform sampler2D map;','uniform sampler2D map; uniform float uFade;').replace('gl_FragColor=vec4(c,tx.a);','gl_FragColor=vec4(c,tx.a*uFade);').replace('gl_FragColor=vec4(c,1.0);','gl_FragColor=vec4(c,uFade);');
    o.material=m; o.frustumCulled=false;
  });
  return root;
}
function playSlimeSfx(kind){
  if(kind==='atk') playSfxSet('slime-atk-sfx-data',Math.floor(Math.random()*4),0.9,1,0);
  else if(kind==='hit') playSfxSet('slime-hit-sfx-data',0,0.9,1,0);
  else if(kind==='die') playSfxSet('slime-die-sfx-data',0,0.9,1,0);
  else if(kind==='win') playSfxSet('slime-win-sfx-data',0,0.9,1,0);
}
/* ---------- MOSSY RUINS WAVES + the new enemies: TREELING and SPORELING ----------
   RUINS_WAVES = the three fights in a row, left to right as the enemy ring lays out (slots 0, 1, 2): 'slime', 'golem', or 'mob' (a treeling or a sporeling, picked at random for each 'mob').
   When a wave is cleared the next one appears after a short pause; the knight keeps his HP. The last wave being cleared is the win (the chest). MOBS = name, hit points, and height as a fraction
   of the knight's. Their model files bring their own Idle, Hit and atk clips; they fight like the golem (same hit timing rule: halfway through atk, same sounds for now). */
const RUINS_WAVES=[['slime','mob','slime'],['mob','slime','mob'],['slime','golem','slime']];
const MOBS={treeling:{name:'TREELING',hp:80,scale:0.9},sporeling:{name:'SPORELING',hp:50,scale:0.7}};
const mobModels={}; let dgWave=0;
function loadMobs(){
  Object.keys(MOBS).forEach(key=>{
    const el=document.getElementById(key+'-data'); if(!el) return;
    try{
      const t=atob(el.textContent.trim()), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i);
      new THREE.GLTFLoader().parse(u.buffer,'',g=>{
        const cache=new Map();
        g.scene.traverse(o=>{ if(!o.isMesh) return; const om=o.material; if(!cache.has(om.uuid)) cache.set(om.uuid,ps1Mat(om.map,1)); o.material=cache.get(om.uuid); o.frustumCulled=false; });
        g.scene.updateMatrixWorld(true); const bx=new THREE.Box3().setFromObject(g.scene), f=n=>g.animations.find(a=>a.name===n);
        mobModels[key]={scene:g.scene,h0:bx.max.y-bx.min.y,minY:bx.min.y,clips:{Idle:f('Idle'),Hit:f('Hit'),Attack:f('atk')},all:g.animations};
      },e=>console.error(key+' failed',e));
    }catch(e){ console.error(key+' failed',e); }
  });
}
setTimeout(loadMobs,0);
function spawnMob(k,sx,sz,H,th){
  const keys=Object.keys(mobModels).filter(q=>mobModels[q].clips.Idle&&mobModels[q].clips.Hit&&mobModels[q].clips.Attack); if(!keys.length) return false;
  const key=keys[Math.floor(Math.random()*keys.length)], M=mobModels[key], D=MOBS[key], root=M.scene.clone(true), gk=D.scale*H/M.h0;
  root.traverse(o=>{ if(!o.isMesh) return; const m=ps1Mat(o.material.uniforms.map.value,1);   // own materials, so this one's death fade does not touch the others
    m.uniforms.uFade={value:1}; m.fragmentShader=m.fragmentShader.replace('uniform sampler2D map;','uniform sampler2D map; uniform float uFade;').replace('gl_FragColor=vec4(c,1.0);','gl_FragColor=vec4(c,uFade);'); o.material=m; o.frustumCulled=false; });
  root.scale.setScalar(gk); root.position.y=-M.minY*gk;
  const rig=new THREE.Group(); rig.add(root); rig.rotation.y=th; rig.position.set(sx,blobHome.y,sz); scene.add(rig);
  const mx=new THREE.AnimationMixer(root), a=mx.clipAction(M.clips.Idle);
  a.timeScale=0.92+Math.random()*0.16; a.play(); a.time=Math.random()*a.getClip().duration; mx.update(0);
  const blob=new THREE.Mesh(new THREE.CircleGeometry(H*0.26,10),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.42,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
  blob.rotation.x=-Math.PI/2; blob.position.set(sx,blobHome.y,sz); scene.add(blob);
  const fadeMats=[]; root.traverse(o=>{ if(o.isMesh&&o.material.uniforms&&o.material.uniforms.uFade) fadeMats.push(o.material); });
  const en={isSlime:false,isGolem:true,gc:M.clips,mobName:D.name,fadeMats,fade:null,rig,mixer:mx,root,blob,tex:[],armor:'#6a8a4a',plume:'#b2ffa1',sword:null,x:sx,z:sz,idle:a,hit:null,hitDone:false,hp:D.hp,max:D.hp,dead:false,atk:null,atkDone:false,death:null,deathDone:false};
  mx.addEventListener('finished',ev=>{ if(ev.action===en.hit) en.hitDone=true; if(ev.action===en.atk) en.atkDone=true; if(ev.action===en.death) en.deathDone=true; });
  enemies.push(en); return true;
}
function nextWave(){   // every enemy of this wave is down: a pause, then the next wave steps up (the knight keeps his HP)
  turn='wave'; try{ setTurnLabel('WAVE '+(dgWave+2)+' OF '+RUINS_WAVES.length); }catch(e){}
  setTimeout(()=>{ if(!dungeon||turn!=='wave') return;
    dgWave++; try{ spawnEnemies(); }catch(e){ console.error(e); }
    pl.guard=false; ep=null; turn='player'; barsBuild(); setTurnLabel('YOUR TURN'); try{ showPointer(); }catch(e){}
  },2000);
}
function spawnEnemies(){
  clearEnemies();
  if(!knightScene||!actions.Idle||!DG_ENEMY.n||!blobHome) return;
  const H=playerH, c=homeTarget, n=DG_ENEMY.n, th=Math.PI/2;      // heading +90 deg = facing east, toward the player
  const lay=RUINS_WAVES[Math.min(dgWave,RUINS_WAVES.length-1)];
  const A=shuffled(EN_ARMOR), P=shuffled(EN_PLUME), W=shuffled(EN_SWORD);
  const HP=shuffled(helmetSets.map((_,i)=>i).filter(i=>i!==curHelmet));   // helmets other than the one the player wears, shuffled so each enemy gets a different one   // shuffled, so the three never repeat a color until the swatches run out
  for(let k=0;k<n;k++){
    const sx=c.x-DG_ENEMY.dist*H, sz=c.z+(k-(n-1)/2)*DG_ENEMY.gap*H;     // exactly where the ring is
    if(lay[k]==='slime'&&elementalGltf){   // Enemy 1 (k=2) and Enemy 3 (k=0) are Slimes
      const root=cloneElemental();
      const rig=new THREE.Group(); rig.add(root); rig.rotation.y=th;
      rig.position.set(sx,blobHome.y,sz);
      scene.add(rig);
      const clips={}; elementalGltf.animations.forEach(ac=>{ clips[ac.name]=ac; });
      const mx=new THREE.AnimationMixer(root), a=mx.clipAction(clips.idle);
      a.timeScale=0.92+Math.random()*0.16; a.play(); a.time=Math.random()*a.getClip().duration; mx.update(0);
      const blob=new THREE.Mesh(new THREE.CircleGeometry(H*0.24,10),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.42,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
      blob.rotation.x=-Math.PI/2; blob.position.set(sx,blobHome.y,sz); scene.add(blob);
      const fadeMats=[]; root.traverse(o=>{ if(o.isMesh&&o.material.uniforms&&o.material.uniforms.uFade) fadeMats.push(o.material); });
      const en={isSlime:true,fadeMats,fade:null,clips,rig,mixer:mx,root,blob,tex:[],armor:'#5ab648',plume:'#b2ffa1',sword:null,x:sx,z:sz,idle:a,hit:null,hitDone:false,hp:SLIME_HP,max:SLIME_HP,dead:false,atk:null,atkDone:false,death:null,deathDone:false};
      mx.addEventListener('finished',ev=>{ if(ev.action===en.hit) en.hitDone=true; if(ev.action===en.atk) en.atkDone=true; if(ev.action===en.death) en.deathDone=true; });
      enemies.push(en);
      continue;
    }
    if(lay[k]==='mob'&&spawnMob(k,sx,sz,H,th)) continue;
    if(lay[k]==='golem'&&golemReady()){   // the ruins' knight is a golem now: same HP, same damage
      const root=golemScene.clone(true), gk=GOLEM_SCALE*H/golemH0;
      root.traverse(o=>{ if(!o.isMesh) return; const m=ps1Mat(o.material.uniforms.map.value,1);   // own materials, so this golem's death fade does not touch the others
        m.uniforms.uFade={value:1}; m.fragmentShader=m.fragmentShader.replace('uniform sampler2D map;','uniform sampler2D map; uniform float uFade;').replace('gl_FragColor=vec4(c,1.0);','gl_FragColor=vec4(c,uFade);'); if(golemEye(o)) m.uniforms.uMagma.value=1; o.material=m; o.frustumCulled=false; });
      root.scale.setScalar(gk); root.position.y=-golemMinY*gk;
      const rig=new THREE.Group(); rig.add(root); rig.rotation.y=th; rig.position.set(sx,blobHome.y,sz); scene.add(rig);
      const mx=new THREE.AnimationMixer(root), a=mx.clipAction(golemClips.Idle);
      a.timeScale=0.92+Math.random()*0.16; a.play(); a.time=Math.random()*a.getClip().duration; mx.update(0);
      const blob=new THREE.Mesh(new THREE.CircleGeometry(H*0.3,10),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.42,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
      blob.rotation.x=-Math.PI/2; blob.position.set(sx,blobHome.y,sz); scene.add(blob);
      const fadeMats=[]; root.traverse(o=>{ if(o.isMesh&&o.material.uniforms&&o.material.uniforms.uFade) fadeMats.push(o.material); });
      const en={isSlime:false,isGolem:true,fadeMats,fade:null,rig,mixer:mx,root,blob,tex:[],armor:'#9aa0a8',plume:'#c9a45a',sword:null,x:sx,z:sz,idle:a,hit:null,hitDone:false,hp:ENEMY_HP,max:ENEMY_HP,dead:false,atk:null,atkDone:false,death:null,deathDone:false};
      mx.addEventListener('finished',ev=>{ if(ev.action===en.hit) en.hitDone=true; if(ev.action===en.atk) en.atkDone=true; if(ev.action===en.death) en.deathDone=true; });
      enemies.push(en); playGolemSfx('spawn');
      continue;
    }
    const ah=A[k%A.length], ph=P[k%P.length], sh=W[k%W.length];
    const root=(()=>{ const st=[]; knightScene.traverse(o=>{ if(o.userData&&Object.keys(o.userData).length){ st.push([o,o.userData]); o.userData={}; } }); try{ return knightScene.clone(true); } finally{ st.forEach(([o,u])=>{ o.userData=u; }); } })(), cache=new Map(), pTex=[], rocks=[]; root.scale.x=MIRROR_MODEL?-1:1;   // enemies keep the normal handedness whatever the player's weapon
    root.traverse(o=>{ if(o.name==='Shortsword') o.visible=true; else if(o.name==='Axe'||o.name==='Hatchet'||o.name==='Hammer'||o.name==='KnightlySword'||o.name==='Morningstar') o.visible=false; });   // enemies stay with swords + the normal Idle
    if(HP.length){   // swap the helmet: show this enemy's set in the clone and hide the rest (clone meshes are found by their position in the hierarchy)
      const hi=HP[k%HP.length], oL=[], cL=[]; knightScene.traverse(o=>oL.push(o)); root.traverse(o=>cL.push(o));
      helmetSets.forEach((set,j)=>set.forEach(m=>{ const cm=cL[oL.indexOf(m)]; if(cm) cm.visible=(j===hi); }));
    }
    root.traverse(o=>{
      if(o.name==='SeatRock') rocks.push(o);
      if(!o.isMesh||o.name==='SeatRock') return;
      if(o.name==='H6Face'){ if(helm6.mat) o.material=helm6.mat; o.scale.x=root.scale.x<0?-1:1; return; }   // Helmet 6's face: the same animated material, not tinted like armor
      const om=o.material; if(!om.uniforms){ o.visible=false; return; }   /* the Knightly sword's halo (a plain additive material) is left out of copies of the knight */
      let nm=cache.get(om.uuid);
      if(!nm){
        const src=om.uniforms.map.value, isPl=/Plume$/.test(o.name), isSw=o.name.indexOf('sword_')===0; let tex=src;
        if(isPl){   // each plume needs its own canvas, or all the enemies would share one color
          const pl=plumes.find(q=>q.tex===src);
          if(pl){ const cv=document.createElement('canvas'); cv.width=pl.base.width; cv.height=pl.base.height;
            const t=new THREE.CanvasTexture(cv); t.flipY=false; t.encoding=THREE.LinearEncoding; t.generateMipmaps=false; t.minFilter=t.magFilter=THREE.NearestFilter;
            tintOne({tex:t,ctx:cv.getContext('2d'),base:pl.base,avgL:pl.avgL},ph); tex=t; pTex.push(t); }
        }
        nm=ps1Mat(tex,1); if(/h6_/.test(o.name)) nm.uniforms.uBlackNoShine.value=1;
        if(isPl) shineMat(nm); else tintMat(nm,isSw?sh:ah);
        cache.set(om.uuid,nm);
      }
      o.material=nm;
    });
    rocks.forEach(r=>r.parent&&r.parent.remove(r));   // the clone was taken while the player sat on his rock
    const rig=new THREE.Group(); rig.add(root); rig.rotation.y=th;
    const ox=-c.x, oz=-c.z;   // the model's footprint centre, in the rig's own frame, so his feet land on the ring
    rig.position.set(sx-(ox*Math.cos(th)+oz*Math.sin(th)),0,sz-(-ox*Math.sin(th)+oz*Math.cos(th)));
    scene.add(rig);
    const mx=new THREE.AnimationMixer(root), a=mx.clipAction(actions.Idle.getClip());
    a.timeScale=0.92+Math.random()*0.16; a.play(); a.time=Math.random()*a.getClip().duration; mx.update(0);   // out of step with each other
    const blob=new THREE.Mesh(new THREE.CircleGeometry(H*0.26,10),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.42,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
    blob.rotation.x=-Math.PI/2; blob.position.set(sx,blobHome.y,sz); scene.add(blob);
    const en={isSlime:false,rig,mixer:mx,root,blob,tex:pTex,armor:ah,plume:ph,sword:sh,x:sx,z:sz,idle:a,hit:null,hitDone:false,hp:ENEMY_HP,max:ENEMY_HP,dead:false,atk:null,atkDone:false,death:null,deathDone:false};
    mx.addEventListener('finished',ev=>{ if(ev.action===en.hit) en.hitDone=true; if(ev.action===en.atk) en.atkDone=true; if(ev.action===en.death) en.deathDone=true; });
    enemies.push(en);
  }
}
function clearEnemies(){
  hidePointer(); bmReset(); barsClear();
  enemies.forEach(e=>{ e.mixer.stopAllAction(); e.mixer.uncacheRoot(e.root); scene.remove(e.rig); scene.remove(e.blob); e.blob.geometry.dispose(); e.blob.material.dispose(); e.tex.forEach(t=>t.dispose()); });
  enemies.length=0;
}
const SLIME_STEP=1/8;   // the slimes move in 8 frames a second (the knights: 15): a stop-motion look
function stepEnemies(dt){ for(const e of enemies){ if(e.isSlime){ e.slAcc=(e.slAcc||0)+dt; if(e.slAcc>=SLIME_STEP){ const n=Math.floor(e.slAcc/SLIME_STEP); e.mixer.update(n*SLIME_STEP); e.slAcc-=n*SLIME_STEP; } } else e.mixer.update(dt); } if(shopKeeper&&shopGroup&&shopGroup.visible){ shopKeeper.mixer.update(dt); shopEvtStep(dt); updateShopFace(dt); } fadeEnemies(dt); if(pointerMixer) pointerMixer.update(dt); }
/* ---------- target pointer (pointer-data: Blockbench glTF with its own spin-and-bob animation) ----------
   One pointer floats above the enemy you have selected. LEFT / RIGHT (or A / D) move it between the enemies, as you see them on screen:
   it starts on the middle one; LEFT / RIGHT follow the TARGET window and wrap round at the ends. Later this is what picks the target of an attack. */
const POINTER_SCALE=2.0;       // 1 = the size it was modeled at (quite small next to the knight)
const POINTER_GAP=0.34;        // clearance above the top of the knight's head, in knight-heights
let pointerRig=null, pointerMixer=null, enSel=1, dgArrowSign=1; const ptr={x:0,z:0};
/* target tracker window: one numbered slot per enemy (its armor color and plume color in the slot), the selected one lit with a blinking arrow, and its name underneath */
const TG_NAMES={'#e8604f':'CRIMSON','#e8b830':'AURIC','#58b868':'EMERALD','#4a88e8':'COBALT','#9a60e0':'UMBRA','#e878b0':'ORCHID','#3cc4bc':'LAGOON'};   // armor color -> the knight's name (target window + health bars); unknown colors are STEEL
const tgEl=document.getElementById('tgt'); let tgKey='';
function tgSync(){
  const show=!!(dungeon&&pointerRig&&pointerRig.visible&&enemies.length);
  if(!show){ if(!tgEl.hidden){ tgEl.hidden=true; tgKey=''; } return; }
  const n=enemies.length, key=n+':'+enSel+':'+enemies.map(e=>e.armor+'/'+e.plume+(e.dead?'x':'')).join();
  if(key===tgKey&&!tgEl.hidden) return; tgKey=key;
  let html='<div class="tg-h">TARGET</div><div class="tg-row">';
  for(let num=1;num<=n;num++){ const k=n-num, e=enemies[k]; html+='<div class="tg-s'+(k===enSel?' on':'')+(e.dead?' dead':'')+'">'+num+'<i style="background:'+(e.armor||'#9aa0aa')+'"></i><b style="background:'+(e.plume||'#d8d8d8')+'"></b></div>'; }
  const s=enemies[enSel]; html+='</div><div class="tg-n">ENEMY '+(n-enSel)+' - '+(s.isSlime?'ELEMENTAL SLIME':s.isGolem?(s.mobName||'GOLEM'):((TG_NAMES[s.armor]||'STEEL')+' KNIGHT'))+'</div>';
  tgEl.innerHTML=html; tgEl.hidden=false;
}
function initPointer(){
  const el=document.getElementById('pointer-data'); if(!el) return;
  const raw=(function(){ const s=atob(el.textContent.trim()), u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u.buffer; })();
  new THREE.GLTFLoader().parse(raw,'',g=>{
    const cache=new Map();
    g.scene.traverse(o=>{ if(!o.isMesh) return; const om=o.material; if(!cache.has(om.uuid)) cache.set(om.uuid,ps1Mat(om.map,1)); o.material=cache.get(om.uuid); o.frustumCulled=false; });
    g.scene.scale.setScalar(POINTER_SCALE);
    const rig=new THREE.Group(); rig.add(g.scene); rig.visible=false; scene.add(rig);
    const mx=new THREE.AnimationMixer(g.scene); g.animations.forEach(a=>mx.clipAction(a).play());
    mx.update(0); rig.updateMatrixWorld(true);
    g.scene.position.y=-new THREE.Box3().setFromObject(rig).min.y;   // its lowest point now sits exactly at the rig's origin, so the gap above the head is exact
    pointerRig=rig; pointerMixer=mx;
  },e=>console.error('pointer load failed',e));
}
function pickAlive(){   // the pointer always rests on a living enemy: the nearest one to where it is
  let best=-1; enemies.forEach((e,i)=>{ if(!e.dead&&(best<0||Math.abs(i-enSel)<Math.abs(best-enSel))) best=i; });
  if(best>=0){ enSel=best; tgSync(); } else if(pointerRig) pointerRig.visible=false;
}
function placePointer(){ const s=enemies[enSel], top=(s&&s.isSlime)?(blobHome.y+0.42*playerH):(homeTarget.y+playerH/2); pointerRig.position.set(ptr.x,top+POINTER_GAP*playerH,ptr.z); }
function showPointer(){
  if(!pointerRig||!enemies.length) return;
  enSel=Math.floor((enemies.length-1)/2);   // the middle enemy
  pickAlive();
  ptr.x=enemies[enSel].x; ptr.z=enemies[enSel].z; pointerRig.visible=true; placePointer(); tgSync();
}
function hidePointer(){ if(pointerRig) pointerRig.visible=false; tgSync(); }
function updatePointer(dt){
  tgSync();
  if(!pointerRig||!pointerRig.visible||!enemies[enSel]) return;
  if(enemies[enSel]&&enemies[enSel].dead) pickAlive();
  const e=enemies[enSel], k=Math.min(1,dt*14); ptr.x+=(e.x-ptr.x)*k; ptr.z+=(e.z-ptr.z)*k; placePointer();   // slides to the new target
}
function movePointer(dir){   // dir: -1 = left key, +1 = right key. Always follows the TARGET window along the top (slot 1 on the left), whatever the camera does, and wraps round at the ends
  if(!pointerRig||!pointerRig.visible||bmOpen||bt.act) return;   // locked while the battle menu is open or an action is playing
  const n=enemies.length; if(n<2) return;
  let k=enSel; for(let q=0;q<n;q++){ k=((k-dir)%n+n)%n; if(!enemies[k].dead) break; }   // slot number = enemies.length - index, so right (next slot) is the previous index; fallen enemies are skipped
  if(enemies[k].dead||k===enSel) return;
  enSel=k; blip(560,0.05); tgSync();
}
addEventListener('keydown',e=>{
  if(!dungeon||dgBusy||e.repeat) return;
  const k=e.key.toLowerCase();
  if(k==='arrowleft'||k==='a') movePointer(-1); else if(k==='arrowright'||k==='d') movePointer(1);
});
/* ---------- battle command menu ----------
   Hover an enemy with LEFT / RIGHT, press ENTER (or SPACE / the OK button) to pick it and the command window slides in on the left.
   UP / DOWN choose, ENTER confirms, ESC (or BACKSPACE / BACK) steps back out. It only opens once the knight has reached the circle.
   ATTACK > CARVE : the knight swings (the Swing animation) and the picked enemy plays Hit, holding its last frame for a second.
   ACTIONS > FLAUNT : the Flaunt animation (with its song). ACTIONS > BLOCK : the Block animation with two sound effects (see playBlockSfx). FLEE leaves the ruins. ITEMS > POTION : drink a potion (Drinking_Potion animation) and heal POTION_HEAL hit points, see the battle section. */
const BM_MENUS={
  root:{title:'BATTLE',items:['ATTACK','ITEMS','ACTIONS','FLEE']},
  attack:{title:'ATTACK',get items(){ return klActive()?['CARVE',klReady()?'KNIGHT LIGHT':'KNIGHT LIGHT '+kl.n+'/'+KL_MAX,'BACK']:['CARVE','BACK']; }},   // KNIGHT LIGHT: only with the Knightly Sword, once its gauge is full
  actions:{title:'ACTIONS',get items(){ return weapon==='axe'?['FLAUNT','BLOCK','RENDER','BACK']:['FLAUNT','BLOCK','BACK']; }},   // RENDER only while a heavy weapon (axe / shovel) is held

  items:{title:'ITEMS',get items(){ return ['POTION x'+potions,'BACK']; }}   // the label shows how many are left
};
const SWING_SPEED=1.25;        // same swing speed as in Walk Around
const CARVE_HIT_AT=0.5;        // seconds into the Swing clip when the blade connects: the enemy's Hit starts then
const HIT_HOLD=1.0;            // seconds the last frame of Hit is held before the enemy goes back to Idle
const BLOCK_HOLD=0.05;          // seconds the last frame of Block is held before he goes back to Idle
const FLAUNT_TIME=3.0;         // seconds the Flaunt plays (4 loops of the 0.75 s clip) before he returns to Idle
const HINT_AIM='LEFT / RIGHT AIM &nbsp; ENTER SELECT &nbsp; ESC LEAVE', HINT_MENU='UP / DOWN CHOOSE &nbsp; ENTER OK &nbsp; ESC BACK', HINT_BUSY='ESC LEAVE';
let bmOpen=false, bmIdx=0, bmTT=0, bmLevel='root';
const bt={act:null,t:0,stage:0,en:null,heading:0};   // the action in progress (null = none)
const bmEl=document.getElementById('bm'), bmList=document.getElementById('bml'), bmT=document.getElementById('bmt'), bmH=bmEl.querySelector('h1');
function bmBuild(level){
  bmLevel=level; bmH.textContent=BM_MENUS[level].title; bmList.innerHTML='';
  BM_MENUS[level].items.forEach((t,i)=>{
    const b=document.createElement('button'); b.className='item'; b.setAttribute('role','menuitem'); b.textContent=t;
    b.onmouseenter=()=>{ if(bmOpen&&bmIdx!==i) bmSet(i); };
    b.onclick=()=>{ if(bmOpen){ bmSet(i); bmChoose(); } };
    bmList.appendChild(b);
  });
}
function bmSet(i){ const n=BM_MENUS[bmLevel].items.length; bmIdx=(i+n)%n; [].forEach.call(bmList.children,(b,j)=>b.setAttribute('aria-checked',j===bmIdx)); }
function bmGo(level,sel){ bmBuild(level); bmSet(sel||0); }
function bmToast(t){ const el=document.getElementById('toast'); el.textContent=t; el.classList.add('show'); clearTimeout(bmTT); bmTT=setTimeout(()=>el.classList.remove('show'),1700); }
function bmTarget(){ return enemies.length-enSel; }   // 1 = the enemy on the player's far left, counting to his right
function hudSet(h){ const el=document.getElementById('hud'); if(el&&dungeon) el.innerHTML=h; }
function bmShow(){
  if(bmOpen||bt.act||dgBusy||dgState!=='idle'||turn!=='player'||!enemies.length||!pointerRig||!pointerRig.visible) return;
  bmOpen=true; bmGo('root',0); bmT.textContent='TARGET: ENEMY '+bmTarget(); bmEl.hidden=false; hudSet(HINT_MENU); blip(440,0.07);
}
function bmClose(quiet){ if(!bmOpen) return; bmOpen=false; bmEl.hidden=true; hudSet(bt.act?HINT_BUSY:HINT_AIM); if(!quiet) blip(300,0.05); }
function bmBack(){
  if(!bmOpen) return;
  if(bmLevel!=='root'){ bmGo('root',bmLevel==='attack'?0:bmLevel==='items'?1:2); blip(300,0.05); } else bmClose();
}
function bmReset(){
  bmOpen=false; if(bmEl) bmEl.hidden=true;
  if(bt.act){ bt.act=null; bt.en=null; }
  if(bmList) bmGo('root',0);
}
function bmChoose(){
  const it=BM_MENUS[bmLevel].items[bmIdx]; blip(620,0.07);
  if(it==='BACK') bmBack();
  else if(it==='ATTACK') bmGo('attack',0);
  else if(it==='ACTIONS') bmGo('actions',0);
  else if(it==='ITEMS') bmGo('items',0);
  else if(it.indexOf('POTION')===0) startPotion();
  else if(it==='FLEE'){ bmClose(true); leaveDungeon(); }
  else if(it==='CARVE') startCarve();
  else if(it.indexOf('KNIGHT LIGHT')===0) startKnightLight();
  else if(it==='FLAUNT') startFlaunt();
  else if(it==='BLOCK') startBlock();
  else if(it==='RENDER') startRender();
}
function btBegin(act){ bmClose(true); bt.act=act; bt.t=0; bt.stage=0; hudSet(HINT_BUSY); klTurn(act); }
/* ---------- KNIGHT LIGHT (the Knightly Sword's special): the Heavy Combo, with the Knightly Sword's coloured swing. Its gauge (bottom of the screen, in the KNIGHTLY colours: gold frame, the gem colours when full)
   gains one notch for every command you use; at KL_MAX notches it is full and KNIGHT LIGHT (ATTACK menu) can be used, which empties it again. ---------- */
const KL_MAX=3, KL_DAMAGE=60; const kl={n:0};
function klActive(){ return weapon==='sword'&&swordStyle==='knightly'; }
function klReady(){ return kl.n>=KL_MAX; }
function klTurn(act){ if(!klActive()) return; if(act==='knightlight') kl.n=0; else if(act==='carve'||act==='flaunt'||act==='block'||act==='render'||act==='potion') kl.n=Math.min(KL_MAX,kl.n+1); }
function startKnightLight(){
  const e=enemies[enSel], a=actions.HeavyCombo; if(!e||e.dead||!a){ bmToast('NOT READY'); return; }
  if(!klReady()){ bmToast('NOT CHARGED'); return; }
  btBegin('knightlight'); bt.en=e; bt.heading=-Math.PI/2;
  const c=homeTarget; heading=Math.atan2(e.x-c.x,e.z-c.z); playerRig.rotation.y=heading;   // faces the one it is about to hit
  if(current&&current!==a) current.fadeOut(0.06);
  a.reset().setLoop(THREE.LoopOnce,1); a.clampWhenFinished=true; a.timeScale=1; a.fadeIn(0.06).play(); current=a;
  playSwishClip('HeavyCombo');   // the swishes, the sparkle and the bluntflesh hit of the finishing blow
}
function btEnd(noTurn){
  if(bt.en&&bt.en.idle&&bt.en.hit&&bt.en.hit.isRunning()===false&&bt.en.hit.weight>0){ /* still holding Hit: hand back to Idle below */ }
  bt.act=null; bt.en=null; playerRig.rotation.y=bt.heading; heading=bt.heading;   // face west again
  hudSet(HINT_AIM);
  if(!noTurn) afterPlayerAction();
}
function startCarve(){
  const e=enemies[enSel]; if(!e||e.dead||!actions[swingName()]||!actions.Hit) { bmToast('NOT READY'); return; }
  btBegin('carve'); bt.en=e; bt.heading=-Math.PI/2;
  const c=homeTarget; heading=Math.atan2(e.x-c.x,e.z-c.z); playerRig.rotation.y=heading;   // turn to face the one he is about to cut
  if(animSet==='ideal'&&swingName()==='Swing') idealPickSwing();   // IDEAL: a random A / B / C for every swing in battle too
  const sw=actions[swingName()]; swinging=true; swingQueued=false;
  if(current&&current!==sw) current.fadeOut(0.06);
  sw.reset().setLoop(THREE.LoopOnce,1); sw.clampWhenFinished=true; sw.timeScale=SWING_SPEED; sw.fadeIn(0.06).play(); current=sw;   // when it ends the usual swing hand-off puts him back to Idle
  playSword(SWING_SPEED);
}
function startFlaunt(){
  if(!actions.Flaunt){ bmToast('NO FLAUNT ANIMATION'); return; }
  btBegin('flaunt'); bt.heading=-Math.PI/2; play('Flaunt');
}
function startBlock(){
  const b=actions.Block; if(!b){ bmToast('NO BLOCK ANIMATION'); return; }
  btBegin('block'); bt.heading=-Math.PI/2;
  pl.guard=true; bmToast('GUARDING');   // the enemies' attacks this round do much less damage
  playBlockAnim(); playBlockSfx();
}
/* RENDER's finishing blow: one of four attack sounds (render-attack-sfx-data: generic_attack_00038ee1 / 00038ee4 / 000242db / 000242dc), picked at random, never the same twice running,
   layered with the bluntflesh hit (render-hit-sfx-data) the moment the blade connects. RENDER_ATK_PEAK = where each one's loudest hit sits inside its file; each starts early enough for that
   to land on the bluntflesh hit's own peak (0.227 s in + the 0.03 s it is delayed). 000242db builds up to its peak (0.56 s), so it just starts with the hit. */
const RENDER_ATK_GAIN=0.9, RENDER_ATK_PEAK=[0.070,0.094,0.562,0.080], RENDER_HIT_PEAK=0.227;   // RENDER_HIT_PEAK: where the bluntflesh hit is loudest inside its own file
let renderAtkLast=-1;
function playRenderAttackLayer(hitStart,track){   // hitStart: seconds from now until the bluntflesh hit STARTS (0.03 in RENDER); track: keep the sound where swishStopAll can cancel it
  if(hitStart===undefined) hitStart=0.03;
  let i; do{ i=Math.floor(Math.random()*RENDER_ATK_PEAK.length); }while(i===renderAtkLast&&RENDER_ATK_PEAK.length>1);
  renderAtkLast=i;
  const d=hitStart+Math.max(0,RENDER_HIT_PEAK-RENDER_ATK_PEAK[i]);
  if(track) playSfxSetTracked('render-attack-sfx-data',i,RENDER_ATK_GAIN,1,d); else playSfxSet('render-attack-sfx-data',i,RENDER_ATK_GAIN,1,d);
}
const RENDER_GUARD=0.20, RENDER_DAMAGE=25;   // RENDER: the share of each enemy hit it blocks (20%), and what the heavy swing does to EVERY enemy
function startRender(){
  if(!actions.SwingHeavyWindUp||!actions.SwingHeavyTurnHold||!actions.SwingHeavyRelease){ bmToast('NO RENDER ANIMATION'); return; }
  btBegin('render'); bt.heading=-Math.PI/2; bt.stage=0;
  pl.render=true; pl.buf=true; bmToast('RENDER');   // pl.render: holding the pose (first enemy turn). pl.buf: the 10% buffer, lasts through BOTH enemy turns
  playHeavy('SwingHeavyWindUp',1,false); playSfxSet('render-charge-sfx-data',0,0.9,1,0);
}
function playHeavy(n,ts,loop){   // one of the SwingHeavy clips: WindUp / Release play once and clamp, TurnHold loops
  const a=actions[n]; if(!a) return;
  if(current&&current!==a) current.fadeOut(0.08);
  a.reset().setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1); a.clampWhenFinished=!loop; a.timeScale=ts; a.fadeIn(0.08).play(); current=a;
}
function startRenderRelease(){   // the enemies are done: no new turn for the player, he swings the heavy release instead
  turn='player'; ep=null; blockHitBag=[]; enemies.forEach(e=>setEnemyYaw(e,Math.PI/2));
  setTurnLabel('RENDER SWING'); btBegin('renderswing'); bt.heading=-Math.PI/2; bt.stage=0;
  playHeavy('SwingHeavyRelease',1,false);
}
function playBlockIdle(){ if(actions.BlockIdle) play('BlockIdle'); else play(idleName()); }   // the guard held while the enemies attack; endEnemyPhase puts him back in Idle
function playBlockAnim(){
  const b=actions.Block; if(!b) return;
  if(current&&current!==b) current.fadeOut(0.08);
  b.reset().setLoop(THREE.LoopOnce,1); b.clampWhenFinished=true; b.timeScale=1; b.fadeIn(0.08).play(); current=b;
}
function enemyHit(e){
  const clip=e.isSlime?e.clips.death:(e.isGolem?(e.gc||golemClips).Hit:actions.Hit.getClip()); e.hitDone=false;
  e.hit=e.mixer.clipAction(clip); e.hit.reset().setLoop(THREE.LoopOnce,1); e.hit.clampWhenFinished=true; e.hit.timeScale=1;
  e.idle.fadeOut(0.05); e.hit.fadeIn(0.05).play(); blip(130,0.14); if(e.isSlime) playSlimeSfx('hit'); else if(e.isGolem) playGolemSfx('pain'); else playGrunt();
}
/* ---------- turn-based battle: hit points, turn order, health bars ----------
   Each round: YOUR TURN (pick a command) -> the action plays -> ENEMY TURN (every living enemy swings at you, one after the other) -> back to you.
   CARVE does SWING_DAMAGE. BLOCK puts a guard up for the coming enemy turn (damage x GUARD_FACTOR). FLAUNT just spends the turn. All enemies down = VICTORY; your HP at 0 = DEFEATED. */
const PLAYER_HP=100, ENEMY_HP=100, SLIME_HP=50;      // starting hit points
const SWING_DAMAGE=25;                  // what your swing does
const ENEMY_DAMAGE=12, GUARD_FACTOR=0.25;   // what an enemy swing does, and the share of it that gets through while you are guarding
const ENEMY_START_BEAT=0.5, ENEMY_HOLD=0.45, DEATH_HOLD=0.6, END_SHOW=3.2;   // pauses (s): before the first enemy swings, after each enemy swing, after an enemy falls, how long VICTORY / DEFEATED stays up
const POTION_HEAL=25, POTION_COUNT=3, POTION_HEAL_AT=1.5;   // hit points a potion restores, how many you start a fight with, and when in the clip (s) the heal lands: his hand is at his lips
let potions=POTION_COUNT;
const DEFEAT_GAIN=1.0, DEFEAT_SHOW=4.2;
/* The defeat sound is crushed when it is first played (mono, sample-and-hold down to DEFEAT_RATE Hz, then DEFEAT_BITS bits: lower = dirtier) and comes out of the knights themselves:
   one copy from each living knight, panned to where that knight is on screen, a little off pitch (DEFEAT_DETUNE) and a hair apart in time (DEFEAT_STAGGER, s) so it reads as a chorus,
   all through a low-pass (DEFEAT_LOWPASS Hz) like it is coming from inside a helmet. */
const DEFEAT_BITS=6, DEFEAT_RATE=8000, DEFEAT_LOWPASS=3200, DEFEAT_DETUNE=0.035, DEFEAT_STAGGER=0.045;
let defeatCrushed=null;
function crushBuffer(b,bits,rate){
  const n=b.length, out=sfx.createBuffer(1,n,b.sampleRate), o=out.getChannelData(0), step=Math.max(1,Math.round(b.sampleRate/rate)), lv=Math.pow(2,bits-1);
  const ch=[]; for(let c=0;c<b.numberOfChannels;c++) ch.push(b.getChannelData(c));
  let hold=0;
  for(let i=0;i<n;i++){
    if(i%step===0){ let v=0; for(let c=0;c<ch.length;c++) v+=ch[c][i]; v/=ch.length; hold=Math.round(v*lv)/lv; }
    o[i]=hold;
  }
  return out;
}
function playDefeat(){
  try{
    if(!sfx) return; const set=SFX_SETS['defeat-sfx-data']; if(!set||!set.bufs){ loadSfxSet('defeat-sfx-data'); return; }
    sfx.resume();
    if(!defeatCrushed) defeatCrushed=crushBuffer(set.bufs[0],DEFEAT_BITS,DEFEAT_RATE);
    const src=enemies.length?enemies:[{x:homeTarget.x,z:homeTarget.z}], n=src.length, v=new THREE.Vector3();
    src.forEach((e,i)=>{
      const node=sfx.createBufferSource(); node.buffer=defeatCrushed; node.playbackRate.value=1+(n>1?(i/(n-1)-0.5)*2*DEFEAT_DETUNE:0);
      const lp=sfx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=DEFEAT_LOWPASS;
      const g=sfx.createGain(); g.gain.value=DEFEAT_GAIN/Math.sqrt(n);
      node.connect(lp); let last=lp;
      if(sfx.createStereoPanner){ v.set(e.x,homeTarget.y,e.z).project(camera); const p=sfx.createStereoPanner(); p.pan.value=Math.max(-0.9,Math.min(0.9,v.x)); lp.connect(p); last=p; }
      last.connect(g); g.connect(sfx.destination); node.start(sfx.currentTime+i*DEFEAT_STAGGER);
    });
  }catch(e){ console.error('defeat sound failed',e); }
}   // volume of the defeat sound, and how long DEFEATED stays up (it is 3.8 s long, so it finishes before you are sent out)
let turn='player', ep=null, endT=0, endKind=null, endDone=false; const pl={hp:PLAYER_HP,max:PLAYER_HP,guard:false,dead:false};
(function(){ const st=document.createElement('style'); st.textContent=
  '#hpl{position:fixed;inset:0;pointer-events:none;z-index:14;display:none;overflow:hidden}body.dungeon #hpl{display:block}'+
  '.hpb{position:absolute;left:0;top:0;width:104px;margin-left:-52px;text-align:center;font-size:19px;line-height:1;color:#fff;text-shadow:2px 2px 0 #000;white-space:nowrap;transition:opacity .4s}'+
  '.hpb .bar{height:9px;background:#1a0a0a;border:2px solid #000;box-shadow:0 0 0 1px #d4dbf7;margin-top:2px}.hpb i{display:block;height:100%;width:100%;background:#58b868}'+
  '.hpb.pl{font-size:21px}.hpb.pl .bar{height:11px}.hpb.dead{opacity:0}'+
  '.dmg{position:absolute;left:0;top:0;font-size:34px;line-height:1;color:#ffe27a;text-shadow:3px 3px 0 #000;white-space:nowrap}.dmg.pl{color:#ff8a7a}.dmg.blk{color:#9fb4ff}.dmg.heal{color:#7dff9a}'+
  '#turn{position:fixed;left:50%;bottom:calc(46px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);font-size:30px;letter-spacing:.14em;color:#ffe27a;text-shadow:3px 3px 0 #000;display:none;z-index:15;pointer-events:none;white-space:nowrap}'+
  'body.dungeon #turn.on{display:block}#turn.foe{color:#ff8a7a}#turn.big{z-index:50;bottom:auto;top:38%;font-size:clamp(54px,9vw,96px);letter-spacing:.08em;color:#fff;text-shadow:0 4px 0 #8fa4ff,0 8px 0 #4558c8,5px 10px 0 #000}#turn.big.lose{color:#ffb0a0;text-shadow:0 4px 0 #e8604f,0 8px 0 #8a2a20,5px 10px 0 #000}'+
  '.tg-s.dead{opacity:.35}'+
  '#klg{position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);width:min(340px,62vw);display:none;z-index:15;pointer-events:none;text-align:center;font-size:22px;letter-spacing:.18em;line-height:1;color:#FFD966;text-shadow:2px 2px 0 #000}'+
  'body.dungeon #klg.on{display:block}#klg .kb{display:flex;gap:4px;margin-top:4px;padding:4px;background:#1a1405;border:2px solid #000;box-shadow:0 0 0 2px #FFD966,0 0 0 4px #000}'+
  '#klg .ks{flex:1;height:14px;background:#2a210a;box-shadow:inset 0 0 0 1px #000}#klg .ks.f{background:linear-gradient(180deg,#fff0b0,#FFD966 55%,#b8902a)}'+
  '#klg.rdy .ks{background:linear-gradient(90deg,#ec2834,#f48818,#fad638,#40e268,#38d8b8,#f85478,#ec2834);background-size:200% 100%;animation:klrb 1.1s linear infinite}#klg.rdy{color:#fff}#klg.rdy .kb{box-shadow:0 0 0 2px #fff,0 0 0 4px #000,0 0 14px 2px #FFD966}'+
  '@keyframes klrb{to{background-position:-200% 0}}'+
  '#dfeat{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .7s linear;z-index:40;display:none;align-items:center;justify-content:center}#dfeat.show{opacity:1}'+
  '#dfeat img{width:min(62vmin,520px);height:min(62vmin,520px);image-rendering:pixelated;opacity:0;transition:opacity .35s linear .6s}#dfeat.show img{opacity:1}';
  document.head.appendChild(st); })();
const hpLayer=document.createElement('div'); hpLayer.id='hpl'; document.body.appendChild(hpLayer);
const turnEl=document.createElement('div'); turnEl.id='turn'; document.body.appendChild(turnEl);
const klEl=document.createElement('div'); klEl.id='klg'; klEl.innerHTML='<span></span><div class="kb"><i class="ks"></i><i class="ks"></i><i class="ks"></i></div>'; document.body.appendChild(klEl); let klShown='';
function klUpdate(){
  const on=!!dungeon&&klActive()&&turn!=='over'&&dgState==='idle'&&!dgBusy, key=on?kl.n+'|'+KL_MAX:'';
  klEl.classList.toggle('on',on); if(key===klShown) return; klShown=key; if(!on) return;
  klEl.classList.toggle('rdy',klReady()); klEl.firstChild.textContent=klReady()?'KNIGHT LIGHT READY':'KNIGHT LIGHT '+kl.n+'/'+KL_MAX;
  [].forEach.call(klEl.querySelectorAll('.ks'),(el,i)=>el.classList.toggle('f',i<kl.n));
}
/* The defeat picture: the screen fades to black and the 2-frame gif plays on it (red on black) for as long as the defeat sound plays; the DEFEATED text stays on top of it (see #turn.big). It is removed when you leave the ruins. */
const dfEl=document.createElement('div'); dfEl.id='dfeat'; dfEl.innerHTML='<img alt="">'; document.body.appendChild(dfEl);
function defeatScreen(on){
  if(on){ const im=dfEl.firstChild; im.src='data:image/gif;base64,'+document.getElementById('defeat-gif').textContent.trim();   // set again each time so the gif starts from its first frame
    dfEl.style.display='flex'; void dfEl.offsetWidth; dfEl.classList.add('show'); }
  else { dfEl.classList.remove('show'); dfEl.style.display='none'; }
}
let bars=[]; const popups=[], _hv=new THREE.Vector3();
function barsClear(){ defeatScreen(false); bars.forEach(b=>b.el.remove()); bars=[]; popups.forEach(p=>p.el.remove()); popups.length=0; turnEl.classList.remove('on'); }
function barsBuild(){
  barsClear();
  const mk=(ent,name,isPl)=>{ const el=document.createElement('div'); el.className='hpb'+(isPl?' pl':''); el.innerHTML='<span></span><div class="bar"><i></i></div>'; hpLayer.appendChild(el); bars.push({ent,name,isPl,el,txt:el.firstChild,fill:el.lastChild.firstChild,shown:-1}); };
  mk(pl,'KNIGHT',true); enemies.forEach(e=>mk(e,e.isSlime?'SLIME':e.isGolem?(e.mobName||'GOLEM'):(TG_NAMES[e.armor]||'STEEL'),false));
}
function headPos(b,out){ const H=playerH, y=(b.ent&&b.ent.isSlime?(blobHome.y+0.42*H):(homeTarget.y+H/2))+0.07*H; if(b.isPl){ const p=playerRig.position; return out.set(homeTarget.x+p.x,y,homeTarget.z+p.z); } return out.set(b.ent.x,y,b.ent.z); }
function barsUpdate(dt){
  klUpdate();
  const W=innerWidth, Hh=innerHeight, vis=dgState==='idle'&&!dgBusy;
  bars.forEach(b=>{
    const e=b.ent; if(b.shown!==e.hp){ b.shown=e.hp; b.fill.style.width=Math.max(0,e.hp/e.max*100)+'%'; const f=e.hp/e.max; b.fill.style.background=f>0.5?'#58b868':f>0.25?'#e8b830':'#e8604f'; b.txt.textContent=b.name+' '+e.hp; }
    b.el.classList.toggle('dead',!!e.dead&&!b.isPl);
    headPos(b,_hv).project(camera); const on=vis&&_hv.z<1&&_hv.z>-1;
    b.el.style.display=on?'block':'none'; if(on) b.el.style.transform='translate('+((_hv.x*0.5+0.5)*W).toFixed(1)+'px,'+((-_hv.y*0.5+0.5)*Hh-34).toFixed(1)+'px)';
  });
  for(let i=popups.length-1;i>=0;i--){ const p=popups[i]; p.t+=dt; if(p.t>1.1){ p.el.remove(); popups.splice(i,1); continue; }
    _hv.copy(p.pos).project(camera); const x=(_hv.x*0.5+0.5)*W, y=(-_hv.y*0.5+0.5)*Hh-p.t*46; p.el.style.transform='translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px) translate(-50%,-100%)'; p.el.style.opacity=p.t<0.7?1:Math.max(0,(1.1-p.t)/0.4); }
  turnEl.classList.toggle('on',vis&&!!turnEl.textContent);
}
function popup(text,pos,cls){ const el=document.createElement('div'); el.className='dmg '+(cls||''); el.textContent=text; hpLayer.appendChild(el); popups.push({el,pos:pos.clone(),t:0}); }
function setTurnLabel(txt,cls){ turnEl.textContent=txt||''; turnEl.className=cls||''; }
function battleReset(){
  kl.n=0; klShown=''; pl.hp=pl.max=PLAYER_HP; pl.guard=false; pl.render=false; pl.buf=false; pl.dead=false; potions=POTION_COUNT; turn='player'; ep=null; endDone=false; endKind=null;
  barsBuild(); setTurnLabel('YOUR TURN');
}
function hurtEnemy(e,dmg){
  e.hp=Math.max(0,e.hp-dmg); popup('-'+dmg,headPos({isPl:false,ent:e},new THREE.Vector3()),'');
  if(e.hp<=0){ e.dead=true; enemyDie(e); } else enemyHit(e);
}
/* How enemies die: an enemy with a death animation plays it and stays down (the knights: the rig's Death clip). An enemy without one plays its HIT animation and fades out over FADE_OUT seconds (at least as long as the hit clip), then disappears.
   The slime's file has a clip called "death", but the game uses it as the slime's hit animation, so set SLIME_DEATH_CLIP to a clip name from that file if it ever gets a real death animation (null = hit animation + fade). */
const SLIME_DEATH_CLIP=null, ENEMY_FADE_OUT=0.9;
function enemyDie(e){
  e.deathDone=false;
  const own=e.isSlime?(SLIME_DEATH_CLIP&&e.clips[SLIME_DEATH_CLIP]):(e.isGolem?null:actions.Death.getClip());
  if(own){
    e.death=e.mixer.clipAction(own); e.death.reset().setLoop(THREE.LoopOnce,1); e.death.clampWhenFinished=true; e.death.timeScale=1;
    e.idle.fadeOut(0.05); e.death.fadeIn(0.05).play();
  } else {   // no death animation: the hit animation, fading out
    const clip=e.isSlime?e.clips.death:(e.isGolem?(e.gc||golemClips).Hit:actions.Hit.getClip());
    e.hit=e.mixer.clipAction(clip); e.hit.reset().setLoop(THREE.LoopOnce,1); e.hit.clampWhenFinished=true; e.hit.timeScale=1;
    e.idle.fadeOut(0.05); e.hit.fadeIn(0.05).play();
    (e.fadeMats||[]).forEach(m=>{ m.transparent=true; m.depthWrite=false; });
    e.fade={t:0,dur:Math.max(ENEMY_FADE_OUT,clip.duration)};
  }
  blip(130,0.14); if(e.isSlime) playSlimeSfx('die'); else if(e.isGolem) playGolemSfx('pain'); else playGrunt(DEATH_GRUNT); tgSync();
}
function fadeEnemies(dt){
  for(const e of enemies){ if(!e.fade) continue;
    e.fade.t+=dt; const k=Math.min(1,e.fade.t/e.fade.dur);
    (e.fadeMats||[]).forEach(m=>{ m.uniforms.uFade.value=1-k; });
    if(e.blob&&e.blob.material) e.blob.material.opacity=0.42*(1-k);
    if(k>=1){ e.rig.visible=false; if(e.blob) e.blob.visible=false; e.fade=null; e.deathDone=true; }
  }
}
function startPotion(){   // ITEMS > POTION: uses the turn
  if(potions<=0){ bmToast('NO POTIONS'); return; }
  if(pl.hp>=pl.max){ bmToast('HP IS FULL'); return; }
  if(!actions.Drinking_Potion){ bmToast('NO DRINK ANIMATION'); return; }
  potions--; btBegin('potion'); bt.heading=-Math.PI/2; bt.healed=false; play('Drinking_Potion');
}
function afterPlayerAction(){   // the player's command has finished: victory, or the enemies' turn
  if(turn==='over') return;
  if(enemies.length&&enemies.every(e=>e.dead)){ if(dgWave<RUINS_WAVES.length-1){ nextWave(); return; } battleEnd('win'); return; }
  startEnemyPhase();
}
function startEnemyPhase(){ turn='enemies'; btBegin('enemy'); ep={i:-1,stage:9,t:0,e:null}; setTurnLabel('ENEMY TURN','foe'); }
function epNext(){
  do{ ep.i++; }while(ep.i<enemies.length&&enemies[ep.i].dead);
  if(ep.i>=enemies.length){ endEnemyPhase(); return; }
  ep.e=enemies[ep.i]; ep.stage=0; ep.t=0;
}
function setEnemyYaw(e,th){
  e.rig.rotation.y=th;
  if(!e.isSlime&&!e.isGolem){
    const ox=-homeTarget.x, oz=-homeTarget.z;
    e.rig.position.set(e.x-(ox*Math.cos(th)+oz*Math.sin(th)),0,e.z-(-ox*Math.sin(th)+oz*Math.cos(th)));
  }
}
function endEnemyPhase(){ if(pl.render&&!pl.dead){ pl.render=false; pl.guard=false; startRenderRelease(); return; } blockHitBag=[];   // a new turn starts with all three block-hit sounds available again
  enemies.forEach(e=>setEnemyYaw(e,Math.PI/2));
  pl.guard=false; pl.buf=false; ep=null; turn='player';
  if(!pl.dead) play(idleName());
  btEnd(true); setTurnLabel('YOUR TURN');
}
function playerStruck(e){
  const g=pl.guard||pl.buf, dmg=pl.guard?Math.max(1,Math.round(ENEMY_DAMAGE*GUARD_FACTOR)):(pl.buf?Math.max(1,Math.round(ENEMY_DAMAGE*(1-RENDER_GUARD))):ENEMY_DAMAGE);
  pl.hp=Math.max(0,pl.hp-dmg); popup('-'+dmg,headPos({isPl:true},new THREE.Vector3()),g?'pl blk':'pl');
  if(pl.hp<=0){ pl.dead=true; play('Death'); }
  else if(pl.render){ if(!(current&&current.getClip().name==='SwingHeavyTurnHold')) playHeavy('SwingHeavyTurnHold',1,true); playBlockHitSeq(); }   // RENDER: he keeps holding the swing, the hit is just the sound
  else if(pl.guard){ if(!(current&&current.getClip().name==='BlockIdle')) playBlockIdle(); playBlockHitSeq(); }   // guarding: he stays in BlockIdle, the hit is just the sound
  else { const h=actions.Hit; if(h){ if(current&&current!==h) current.fadeOut(0.06); h.reset().setLoop(THREE.LoopOnce,1); h.clampWhenFinished=true; h.timeScale=1; h.fadeIn(0.06).play(); current=h; } blip(130,0.14); playGrunt(); }
}
/* ---------- the slime's attack: a squishy, painful-looking jump ----------
   The slime's own 'action' clip only nudges its inner shells about, so a hop is drawn on top of it (the clip still plays underneath, and the hit still lands at SLIME_HIT_AT):
   1 CROUCH   it sinks and bulges sideways, pulling back a little - the wind-up
   2 LAUNCH   it springs up and stretches tall, leaping at the player in a real arc
   3 SPLAT    it lands on the hit and flattens hard (it spreads wide as it flattens, always keeping its volume), with a violent shiver
   4 WOBBLE   it recovers like jelly: a damped spring that overshoots tall, then wide, then settles, while it slides back to its place
   Everything is eased, so there is no snapping between the phases. The numbers are the knobs: how deep the crouch and the splat go (smaller = squashier), the hop height and the lunge, in knight-heights. */
/* Toned down: the original animation is still the star; this only adds a little weight to it, and the whole attack plays SLIME_ATK_SPEED times faster (so it is snappier). All times are in the original clip's seconds. */
const SLIME_ATK_SPEED=1.35;
const SQ={crouch:0.30,crouchSy:0.86,leapFrom:0.40,hop:0.07,lunge:0.10,pull:0.02,stretch:0.09,splatT:0.09,splatSy:0.80,shake:0.010,wobbleK:7,wobbleW:26,back:[0.82,1.0]};
const sqEase=k=>{ k=Math.max(0,Math.min(1,k)); return k*k*(3-2*k); };
function slimeSquishStart(e,px,pz){
  const dx=px-e.x, dz=pz-e.z, d=Math.hypot(dx,dz)||1;
  e.sqT=0; e.sqAcc=0; e.sqDir={x:dx/d,z:dz/d}; e.sqHome=e.rig.position.clone(); e.sqBase=e.root.scale.x;
  e.root.position.y=0; e.rig.updateMatrixWorld(true); e.sqB=new THREE.Box3().setFromObject(e.root).min.y-e.rig.position.y;   // where its underside is (so it squashes onto the ground rather than into it)
}
function slimeSquish(e,dt){
  if(e.sqT===undefined||!e.sqHome) return;
  e.sqT+=dt*SLIME_ATK_SPEED; const t=e.sqT, H=playerH, hitAt=SLIME_HIT_AT, land=hitAt, tl=SQ.leapFrom;
  let sy=1, hop=0, lg=0, shx=0;
  if(t<SQ.crouch){                                   // 1 crouch
    const k=sqEase(t/SQ.crouch); sy=1-(1-SQ.crouchSy)*k; lg=-SQ.pull*k;
  } else if(t<land){                                 // 2 launch + flight: one arc from the crouch to the landing
    const u=(t-tl)/(land-tl), kk=sqEase((t-SQ.crouch)/(tl-SQ.crouch));
    hop=SQ.hop*4*Math.max(0,u)*(1-Math.max(0,u));
    lg=-SQ.pull+(SQ.lunge+SQ.pull)*sqEase(u<0?0:u);
    const stretch=1+SQ.stretch*Math.pow(Math.sin(Math.PI*Math.max(0,Math.min(1,u))),0.7);          // tall in the air...
    sy=(t<tl)?(SQ.crouchSy+(stretch-SQ.crouchSy)*kk):stretch;                                         // ...springing out of the crouch
  } else {
    const a=t-land;
    lg=SQ.lunge;
    if(a<SQ.splatT){                                 // 3 splat: flattens fast
      const k=sqEase(a/SQ.splatT); sy=1.0-(1.0-SQ.splatSy)*k; shx=SQ.shake*H*Math.sin(t*95)*(1-k*0.3);
    } else {                                         // 4 wobble: damped jelly spring back to 1, after the splat has pressed it flat
      const b=a-SQ.splatT, amp=1-SQ.splatSy;
      sy=1-amp*Math.exp(-SQ.wobbleK*b)*Math.cos(SQ.wobbleW*b); shx=SQ.shake*H*0.5*Math.sin(t*95)*Math.exp(-14*b);
      const bk=sqEase((t-SQ.back[0])/(SQ.back[1]-SQ.back[0])); lg=SQ.lunge*(1-bk);                  // slides back to its place
    }
  }
  sy=Math.max(0.2,sy); const sxz=1/Math.sqrt(sy);                                                    // volume stays constant: low = wide, tall = thin
  const S=e.sqBase; e.root.scale.set(S*sxz,S*sy,S*sxz); e.root.position.y=e.sqB*(1-sy);
  const d=e.sqDir, h=e.sqHome;
  e.rig.position.set(h.x+d.x*lg*H+(-d.z)*shx, h.y+hop*H, h.z+d.z*lg*H+d.x*shx);
}
function slimeSquishEnd(e){
  if(!e.sqHome) return;
  e.root.scale.setScalar(e.sqBase||SLIME_SCALE); e.root.position.y=0; e.rig.position.copy(e.sqHome); e.sqT=undefined;
}
function updateEnemyPhase(dt){
  if(!ep||turn==='over') return;
  ep.t+=dt;
  if(ep.stage===9){ if(ep.t>=ENEMY_START_BEAT) epNext(); return; }
  if(ep.e&&ep.e.isSlime&&ep.stage>=1&&ep.stage<=3){ const se=ep.e; se.sqAcc=(se.sqAcc||0)+dt; if(se.sqAcc>=SLIME_STEP){ const d=Math.floor(se.sqAcc/SLIME_STEP)*SLIME_STEP; se.sqAcc-=d; slimeSquish(se,d); } }   // (the squish moves in the same choppy steps)   // the squishy jump drawn over the slime's own attack clip
  const e=ep.e, sw=e.isSlime?e.clips.action:(e.isGolem?(e.gc||golemClips).Attack:actions.Swing.getClip()), spd=e.isSlime?SLIME_ATK_SPEED:(e.isGolem?1.0:SWING_SPEED), hitAt=e.isSlime?SLIME_HIT_AT/SLIME_ATK_SPEED:(e.isGolem?(e.gc?e.gc.Attack.duration*0.5:GOLEM_HIT_AT):(CARVE_HIT_AT/SWING_SPEED));
  if(ep.stage===0){   // this enemy turns to face the player and attacks
    const px=homeTarget.x+playerRig.position.x, pz=homeTarget.z+playerRig.position.z;
    setEnemyYaw(e,Math.atan2(px-e.x,pz-e.z));
    e.atkDone=false; e.atk=e.mixer.clipAction(sw); e.atk.reset().setLoop(THREE.LoopOnce,1); e.atk.clampWhenFinished=true; e.atk.timeScale=spd;
    e.idle.fadeOut(0.06); e.atk.fadeIn(0.06).play(); if(e.isSlime){ playSlimeSfx('atk'); slimeSquishStart(e,px,pz); } else if(!e.isGolem) playSword(SWING_SPEED); ep.stage=1; ep.t=0;
  } else if(ep.stage===1&&ep.t>=hitAt){ ep.stage=2; if(e.isGolem) playGolemSfx('atk'); playerStruck(e); }
  else if(ep.stage===2&&(e.atkDone||ep.t>=sw.duration/spd+0.3)){ ep.stage=3; ep.t=0; }
  else if(ep.stage===3&&ep.t>=ENEMY_HOLD){
    setEnemyYaw(e,Math.PI/2); if(e.isSlime) slimeSquishEnd(e);
    e.idle.reset().fadeIn(0.12).play(); e.atk.fadeOut(0.12);
    if(pl.dead){ battleEnd('lose'); return; }
    if(!pl.guard&&!pl.render) play(idleName());   // a raised guard stays up between the enemies' attacks
    epNext();
  }
}
function battleEnd(kind){
  setBattleMusic(false);   // silence for the defeat sting, the flaunt song for a victory
  turn='over'; endKind=kind; endT=(kind==='lose'?DEFEAT_SHOW:END_SHOW); endDone=false; bmClose(true);
  if(kind==='lose'){ defeatScreen(true); playDefeat(); if(enemies.some(e=>e.isSlime&&!e.dead)) playSlimeSfx('win'); }   // Castlevania: Judgment's defeat sting, crushed and sung by the knights
  if(kind==='win'){ setTurnLabel('VICTORY!','big'); if(actions.Flaunt||actions.AxeFlaunt) play('Flaunt'); }
  else setTurnLabel('DEFEATED','big lose');
  hudSet(HINT_BUSY);
}
function updateBattle(dt){
  if(turn==='over'){ endT-=dt; if(endT<=0&&!endDone){ endDone=true; if(endKind==='win'&&chestReady()){ startChestScene(); } else { if(endKind==='win') play(idleName()); leaveDungeon(); } } return; }
  if(!bt.act) return;
  bt.t+=dt;
  if(bt.act==='carve'){
    const e=bt.en;
    if(bt.stage===0&&bt.t>=CARVE_HIT_AT/SWING_SPEED){ bt.stage=1; bt.hitT=bt.t; hurtEnemy(e,SWING_DAMAGE); }                       // the blade connects
    else if(bt.stage===1&&((e.dead?e.deathDone:e.hitDone)||bt.t-bt.hitT>4)){ bt.stage=2; bt.hold=0; }   // (the 4 s is a safety net so a missed 'finished' event can never freeze the fight)
                                               // Hit has played through; its last frame stays on screen
    else if(bt.stage===2){ bt.hold+=dt; if(bt.hold>=(e.dead?DEATH_HOLD:HIT_HOLD)){ bt.stage=3; if(!e.dead){ e.idle.reset().fadeIn(0.12).play(); e.hit.fadeOut(0.12); } } }
    else if(bt.stage===3&&bt.t>=0.02&&!swinging){ btEnd(); }                                             // back to Idle on both sides
  } else if(bt.act==='knightlight'){
    const e=bt.en, a=actions.HeavyCombo, dur=a?a.getClip().duration:0;
    if(bt.stage===0&&bt.t>=HEAVY_COMBO_FINISH_T){ bt.stage=1; bt.hitT=bt.t; hurtEnemy(e,KL_DAMAGE); }                  // the blade comes down: the finishing blow lands
    else if(bt.stage===1&&((e.dead?e.deathDone:e.hitDone)||bt.t-bt.hitT>4)){ bt.stage=2; bt.hold=0; }
    else if(bt.stage===2){ bt.hold+=dt; if(bt.hold>=(e.dead?DEATH_HOLD:HIT_HOLD)){ bt.stage=3; if(!e.dead){ e.idle.reset().fadeIn(0.12).play(); e.hit.fadeOut(0.12); } } }
    else if(bt.stage===3&&bt.t>=dur-0.05){ play(idleName()); btEnd(); }                                                  // the clip has finished its recovery
  } else if(bt.act==='flaunt'){
    if(bt.t>=FLAUNT_TIME){ play(idleName()); btEnd(); }
  } else if(bt.act==='block'){
    if(bt.t>=actions.Block.getClip().duration+BLOCK_HOLD){ playBlockIdle(); btEnd(); }   // Block has played: he stays in BlockIdle (a loop) through the enemies' whole turn
  } else if(bt.act==='render'){
    if(bt.stage===0&&bt.t>=actions.SwingHeavyWindUp.getClip().duration){ bt.stage=1; playHeavy('SwingHeavyTurnHold',1,true); afterPlayerAction(); }   // windup done: he holds while the enemies take their turn
  } else if(bt.act==='renderswing'){
    const rd=actions.SwingHeavyRelease.getClip().duration;
    if(bt.stage===0&&bt.t>=rd*0.45){ bt.stage=1; bt.hold=0; playSfxSet('render-swish-sfx-data',0,0.9,1,0); playSfxSet('render-hit-sfx-data',0,0.9,1,0.03); playRenderAttackLayer(); enemies.forEach(e=>{ if(!e.dead) hurtEnemy(e,RENDER_DAMAGE); }); }   // the blade connects: all targets
    else if(bt.stage===1){ bt.hold+=dt; if(bt.t>=rd&&bt.hold>=HIT_HOLD){ bt.stage=2; enemies.forEach(e=>{ if(!e.dead&&e.hit){ e.idle.reset().fadeIn(0.12).play(); e.hit.fadeOut(0.12); } }); play(idleName()); btEnd(); } }   // btEnd -> victory, or the enemies go again; then he gets to pick
  } else if(bt.act==='potion'){
    const c=current&&current.getClip().name==='Drinking_Potion';
    if(!bt.healed&&c&&current.time>=POTION_HEAL_AT){
      bt.healed=true; const h=Math.min(POTION_HEAL,pl.max-pl.hp); pl.hp+=h;
      popup('+'+h,headPos({isPl:true},new THREE.Vector3()),'heal'); blip(660,0.1); setTimeout(()=>blip(880,0.12),90);
    }
    if(bt.t>=actions.Drinking_Potion.getClip().duration+DRINK_HOLD+0.25){ if(c) play(idleName()); btEnd(); }
  } else if(bt.act==='enemy'){
    updateEnemyPhase(dt);
  }
}
addEventListener('keydown',e=>{
  if(!dungeon||dgBusy) return;
  const k=e.key.toLowerCase();
  if(bt.act) return;                      // nothing to press while an action plays (Esc still leaves)
  if(bmOpen){
    if(k==='arrowup'||k==='w'){ bmSet(bmIdx-1); blip(480,0.04); }
    else if(k==='arrowdown'||k==='s'){ bmSet(bmIdx+1); blip(480,0.04); }
    else if((k==='enter'||k===' ')&&!e.repeat) bmChoose();
    else if(k==='backspace') bmBack();
  } else if((k==='enter'||k===' ')&&!e.repeat) bmShow();
});
document.getElementById('dgl').onclick=()=>{ if(dungeon) movePointer(-1); };
document.getElementById('dgr').onclick=()=>{ if(dungeon) movePointer(1); };
document.getElementById('dgok').onclick=()=>{ if(!dungeon||bt.act) return; if(bmOpen) bmChoose(); else bmShow(); };
document.getElementById('dgback').onclick=()=>{ if(dungeon) bmBack(); };
bmBuild('root');
function smoothDamp(c,t,v,tc,dt){   // critically damped spring: reaches t smoothly, velocity never jumps
  const w=2/tc, x=w*dt, ex=1/(1+x+0.48*x*x+0.235*x*x*x), ch=c-t, tmp=(v.v+w*ch)*dt; v.v=(v.v-w*tmp)*ex; return t+(ch+tmp)*ex;
}
function dungeonStep(dt){
  const p=playerRig.position, H=playerH;
  updatePointer(dt); updateBattle(dt);
  if(dgState==='walkin'){
    p.x-=WALK_SPEED*H*dt;
    if(p.x<=0){ p.x=0; dgState='idle'; moving=false; play(idleName()); dgDur=dgT+1.6; }   // arrived on the circle: Idle, then the camera starts roaming
  } else if(dgState==='chest'){
    if(!chestDone&&current&&current===actions.Chestopen&&current.time>=current.getClip().duration-0.03) chestDone=true;   // (safety net in case the 'finished' event is missed)
    if(chestDone&&!dgBusy){ if(chestEndT<0) chestEndT=CHEST_END_HOLD; chestEndT-=dt; if(chestEndT<=0&&!loot.on&&!loot.picked) showLoot(); }   // the clip has ended: after a moment the three loot cards come up, and picking one is what leaves (see lootPick)   // the clip has ended: hold its last pose a moment, then fade to black and back to the menu
  }
  // camera director: slow pan inside a shot, smooth blend into the next one
  dgT+=dt; dgYaw+=dgShot.drift*Math.PI/180*dt;
  const tg={yaw:dgYaw,pitch:dgShot.pitch,dist:dgShot.dist,ty:dgShot.ty,mid:dgShot.mid};
  if(dgBlend<1&&dgFrom){
    dgBlend=Math.min(1,dgBlend+dt/dgBlendT); const e=dgBlend*dgBlend*dgBlend*(dgBlend*(dgBlend*6-15)+10), TAU=Math.PI*2;   // smootherstep: eases in AND out with no jolt
    dgCam.yaw=dgFrom.yaw+(dgFrom.dy0+dgShot.drift*Math.PI/180*dgT)*e;   // fixed direction + the new shot's drift so far (lands exactly on the shot's own yaw)
     dgCam.pitch=dgFrom.pitch+(tg.pitch-dgFrom.pitch)*e; dgCam.dist=dgFrom.dist+(tg.dist-dgFrom.dist)*e; dgCam.ty=dgFrom.ty+(tg.ty-dgFrom.ty)*e; dgCam.mid=dgFrom.mid+(tg.mid-dgFrom.mid)*e;
  } else Object.assign(dgCam,tg);
  if(dgT>=dgDur) dgNext();
  const kx=homeTarget.x+p.x, kz=homeTarget.z+p.z, ex=homeTarget.x-DG_ENEMY.dist*H;
  if(dgState==='chest') target.set(kx-CHEST_LOOK_FWD*H, homeTarget.y+dgCam.ty*H, kz);   // between him and the chest (he faces west)
  else target.set(kx+(ex-kx)*dgCam.mid, homeTarget.y+dgCam.ty*H, kz+(homeTarget.z-kz)*dgCam.mid);
  /* The camera plays the shot and nothing else: it no longer pulls in, rises over a wall or backs off because of the scenery (that wall test is what kept pushing it away and back).
     Anything that gets between the camera and someone, or very close to the lens, dithers away instead (see-through obstacles, occUpdate). */
  yaw=dgCam.yaw; pitch=dgCam.pitch; zoom=dgCam.dist*H/(camera.userData.fit||5);
  dgSmD=dgCam.dist*H; dgSmP=dgCam.pitch;   // (kept in step, in case something reads them)
  if(blobMesh&&blobHome) blobMesh.position.set(blobHome.x+p.x,blobHome.y,blobHome.z+p.z);
}

/* ---------- start screen: now and then he looks up and glances around at the sky ----------
   Most of the time his head just plays Pose3 as authored (bowed, a tiny sway). Every so often it lifts a little, glances one way, then the other, and lowers again (about 9.6 s),
   one slow move after another with no extra wobble. This is added on top of the animation, only while the start pose is playing.
   up = how far the head tips back beyond the pose (radians; 0.5 is about 29 degrees), side = how far it turns each way, gapMin/gapMax = seconds between looks,
   first = seconds before the first one. Each look varies a little in size (+-15%) and in which way it goes first. LOOK_KEYS is the whole move: time (s), how far up (0..1),
   which way (-1..1); the head eases to rest at every key, so the moves stay slow and smooth. */
const START_LOOK={up:0.5,side:0.3,gapMin:9,gapMax:20,first:5};
const LOOK_KEYS=[[0,0,0],[1.6,1,0],[3.2,1,-1],[5.0,1,-1],[6.8,1,0.8],[8.2,1,0],[9.6,0,0]];
let lookT=-1, lookNext=START_LOOK.first, lookAmp=1, lookDir=1, lookHead=null, lookInt=null, lookInit=false;
const lookBase=new THREE.Quaternion(), lookQ=new THREE.Quaternion(), lookOut=new THREE.Quaternion(), lookE=new THREE.Euler();
function lookAt(t){
  for(let i=0;i<LOOK_KEYS.length-1;i++){ const a=LOOK_KEYS[i], b=LOOK_KEYS[i+1]; if(t<=b[0]){ let f=(t-a[0])/(b[0]-a[0]); f=f*f*(3-2*f); return [a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f]; } }
  return [0,0];
}
function headLook(dt,stepped){
  if(!current||current.getClip().name!==START_CLIP){ if(lookHead&&lookT>=0) lookHead.quaternion.copy(lookBase); lookT=-1; lookHead=null; lookInt=null; return; }   // leaving the start pose mid-look: put the head back first
  if(!lookHead){
    const tr=current.getClip().tracks.find(t=>/^Head(_\d+)?\.quaternion$/.test(t.name));
    lookHead=tr?knightScene.getObjectByName(tr.name.replace('.quaternion','')):null;
    if(!lookHead) return;
    lookInt=tr.createInterpolant();
    lookT=-1; lookNext=START_LOOK.first;
  }
  if(lookT<0){
    lookNext-=dt; if(lookNext>0) return;
    lookT=0; lookAmp=0.85+Math.random()*0.3; lookDir=Math.random()<0.5?-1:1; lookInit=true;
  }
  lookT+=dt;
  /* The head is only re-posed on the frames where the rest of him is (every step in the PS1 look, every frame in the modern one) and held in between, so in the PS1 look it
     moves on the same 15 fps beat as the body instead of on a clock of its own - two beats out of step with each other looked like jitter. */
  if(stepped||lookInit){
    lookInit=false;
    /* The plain pose comes from the clip's own head track at the clip's current time, NOT from the bone. The mixer only writes a bone when its animated value changes, and Pose3's
       head holds one value for over two seconds, so during those frames the bone still carries our own offset from the last frame: reading it back as "the pose" piled the
       offset up again every step and the head spun. Sampling the track gives the true pose every time. */
    const bq=lookInt.evaluate(current.time); lookBase.set(bq[0],bq[1],bq[2],bq[3]);
    if(lookT>=LOOK_KEYS[LOOK_KEYS.length-1][0]){
      lookT=-1; lookNext=START_LOOK.gapMin+Math.random()*(START_LOOK.gapMax-START_LOOK.gapMin);
      lookHead.quaternion.copy(lookBase); return;                          // back to the plain pose
    }
    const la=lookAt(lookT);
    lookQ.setFromEuler(lookE.set(START_LOOK.up*la[0]*lookAmp,START_LOOK.side*la[1]*lookDir*lookAmp,0,'YXZ'));
    lookOut.copy(lookBase).multiply(lookQ);
  }
  lookHead.quaternion.copy(lookOut);
}
/* ---------- loop ---------- */
const STEP=1/15; let acc=0, last=performance.now();
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min((now-last)/1000,0.1); last=now;
  if(spin&&!paused&&!mapMode&&!startScr) yaw+=dt*0.6;
  if(exploring&&!paused&&playerRig){ if(dungeon) dungeonStep(dt); else exploreStep(dt); }
  if(!paused&&!evtPlaying&&current&&current.getClip().name===SEAT_CLIP&&actions[EVT_CLIP]){ evtClock+=dt; if(evtClock>=evtNext) evtDue=true; }
  if(mixer&&!paused){
    acc+=dt;
    let stepped=false;
    danceStep();
    if(ps1){ if(acc>=STEP){ const n=Math.floor(acc/STEP); stepMixer(n*STEP); stepEnemies(n*STEP); acc-=n*STEP; stepped=true; } }
    else { stepMixer(acc); stepEnemies(acc); acc=0; stepped=true; }
    headLook(dt,stepped);
    if(evtDone){ evtDone=false; endEvt(); }
    if(evtGo){ evtGo=false; startEvt(); }
    if(swingDone){ swingDone=false; endSwing(); }
    if(flauntDone){ flauntDone=false; if(current===actions.AxeFlaunt) play(FLAUNT_IDLE); }   // AxeFlaunt has played through: carry on into its idle instead of freezing on the last frame
  }
  if(!paused){ updateShine(dt); updateComboSparks(dt); updateSky(dt); updateNight(dt); updateHelm6Face(dt); updateSnow(dt); updateLeaves(dt); updateSwoosh(dt); updateFire(dt); footstepStep(); updateShopLamp(); updateMapRuins(); applyFogThickness(); updateMagma(dt); inspectStep(dt); applyAreaFog(); }
  shopSync(); if(mapMode) mapStep(dt);   // the map places the camera itself; when it has closed (mapMode false again) the orbit camera below takes over in the same frame
  if(!mapMode){
    invStep(dt);   // the inventory zoom
    editStep(dt);  // the EDIT mode's camera
    const d=(camera.userData.fit||5)*zoom, cp=Math.cos(pitch);
    camera.position.set(target.x+d*Math.sin(yaw)*cp, target.y+d*Math.sin(pitch), target.z+d*Math.cos(yaw)*cp);
    camera.lookAt(target);
    if(editOn) camera.rotateZ(editRoll);   // EDIT: tilted shots
  }
  occUpdate();   // where the characters are on screen, for the see-through obstacles
  if(inspect.it&&inspect.k>0.002) inspectRender(); else renderer.render(scene,camera);
  if(dungeon) barsUpdate(dt);
}
requestAnimationFrame(frame);

/* ---------- main menu ---------- */
let sfx=null;
/* ---------- hit grunts: Harry Mason's pain grunts from Silent Hill (Konami). One of the three, picked at random, plays whenever an enemy knight is struck.
   They are embedded in grunt-data (3 small wavs) and decoded on the first menu sound, so they are ready by the time a fight starts. ---------- */
let gruntBufs=null, gruntLoading=null;
function loadGrunts(){
  if(gruntLoading||!sfx) return gruntLoading;
  try{
    const list=JSON.parse(document.getElementById('grunt-data').textContent);
    gruntLoading=Promise.all(list.map(b=>{ const t=atob(b), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i); return sfx.decodeAudioData(u.buffer); }))
      .then(a=>{ gruntBufs=a; }).catch(e=>{ gruntLoading=null; console.error('grunts failed',e); });
  }catch(e){ console.error(e); }
  return gruntLoading;
}
/* ---------- walking + sword sounds, and the animation-test sounds ----------
   step-data: SL_00016 (Digimon World), one walking sound that holds two footfalls ~0.28 s apart, so it plays once per Walk loop, on the first footfall.
   sword-sfx-data: SD_SWORD_00000 / 00005 / 00006 (Castlevania), one of them at random on every swing, timed so the whoosh lands on the chop.
   Both are decoded on the first menu sound, like the grunts. ANIM_SFX lists every dungeon sound that belongs to an animation, so the ANIMATIONS test screen can play them too. */
const SFX_SETS={};
function loadSfxSet(id){
  const s=SFX_SETS[id]||(SFX_SETS[id]={bufs:null,loading:null});
  if(s.loading||!sfx) return s.loading;
  try{
    const list=JSON.parse(document.getElementById(id).textContent);
    s.loading=Promise.all(list.map(b=>{ const t=atob(b), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i); return sfx.decodeAudioData(u.buffer); }))
      .then(a=>{ s.bufs=a; }).catch(e=>{ s.loading=null; console.error(id+' failed',e); });
  }catch(e){ console.error(e); }
  return s.loading;
}
function playSfxSet(id,i,gain,rate,delay){
  try{
    if(!sfx) return;
    const s=SFX_SETS[id]; if(!s||!s.bufs){ const l=loadSfxSet(id), t0=performance.now(); if(l) l.then(()=>{ if(performance.now()-t0<1500&&SFX_SETS[id]&&SFX_SETS[id].bufs) playSfxSet(id,i,gain,rate,delay); }); return; }   // not decoded yet: play it the moment it is (if that is soon enough to still make sense)
    sfx.resume();
    const src=sfx.createBufferSource(), g=sfx.createGain(); src.buffer=cz(s.bufs[i]); src.playbackRate.value=rate||1; g.gain.value=gain;
    src.connect(g); g.connect(sfx.destination); src.start(sfx.currentTime+(delay||0));
  }catch(_){}
}
/* Voice 2 (the female lines) was recorded much hotter than voice 1. Each gain below is set so that a voice 2 line comes out at the same average (RMS) level as its voice 1 counterpart,
   measured on the files as they play: grunt -3.2 dB, death grunt -2.4 dB, flaunt -4.2 dB, sword shout -4.9 dB, block shout -7.3 dB (each relative to the old 0.9 / 1.0 / 0.85 / 0.9). Raise one to make it louder. */
const V2_GRUNT_GAIN=0.63, V2_DIE_GAIN=0.68, V2_FLAUNT_GAIN=0.62, V2_SWORD_GAIN=0.485, V2_BLOCK_GAIN=0.39;
const SWORD_GAIN=0.75, SWORD_ONSET=[0.34,0,0], SWORD_CHOP_T=0.36;   // SWORD_ONSET: where the whoosh starts inside each file; SWORD_CHOP_T: clip time of the chop in the Swing animation
const KNIFE_GAIN=0.8, KNIFE_PEAK=0.045;   // knife-sfx-data: FUEL_VAB_00000 knife swing, layered on every swing (sword and axe); KNIFE_PEAK = where its loudest hit sits inside the file
const V2_SWORD_ONSET=[0.013,0.015,0.013];
/* ---------- swing swishes (swish-sfx-data: wpn_swish_medium_01..03 + wpn_swish_large_01) ----------
   Light weapons (sword, knightly sword, hatchet) play one of the three medium swishes; the heavy class (axe, shovel, hammer, morningstar) plays the large one.
   Each is timed so the loudest part of the swish (SWISH_PEAK: seconds into the file) lands on the chop of the swing animation (SWISH_CHOP_T: clip time of the chop, ~0.40 s in Swing and AxeSwing).
   Mediums come out of a shuffled bag, so none repeats until all three have played. The original sword sounds still play with them. */
const SWISH_GAIN=0.85, SWISH_CHOP_T=0.40, SWISH_PEAK=[0.174,0.142,0.103,0.222];   // SWISH_PEAK order: medium 1, 2, 3, large
let swishBag=[], swishLast=-1, swishLive=[];
function swishNext(){   // the next medium swish (0..2): a shuffled bag of the three, never the same one twice running
  if(!swishBag.length){
    swishBag=[0,1,2]; for(let i=2;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [swishBag[i],swishBag[j]]=[swishBag[j],swishBag[i]]; }
    if(swishBag[swishBag.length-1]===swishLast){ const j=Math.floor(Math.random()*(swishBag.length-1)); [swishBag[swishBag.length-1],swishBag[j]]=[swishBag[j],swishBag[swishBag.length-1]]; }   // the next one popped must not repeat the last played
  }
  return swishLast=swishBag.pop();
}
function swishHeavy(){ return weapon==='axe'||swordStyle==='hammer'||swordStyle==='morningstar'; }   // the heavy weapon class
function playSwish(i,delay){   // i: 0..2 medium, 3 large; delay: seconds from now until the swish STARTS
  try{
    if(!sfx) return;
    const s=SFX_SETS['swish-sfx-data']; if(!s||!s.bufs){ const l=loadSfxSet('swish-sfx-data'), t0=performance.now(); if(l) l.then(()=>{ const left=(delay||0)-(performance.now()-t0)/1000; if(left>-0.15&&SFX_SETS['swish-sfx-data']&&SFX_SETS['swish-sfx-data'].bufs) playSwish(i,Math.max(0,left)); }); return; }
    sfx.resume();
    const src=sfx.createBufferSource(), g=sfx.createGain(); src.buffer=cz(s.bufs[i]); g.gain.value=SWISH_GAIN;
    src.connect(g); g.connect(sfx.destination); src.start(sfx.currentTime+Math.max(0,delay||0));
    swishLive.push(src); src.onended=()=>{ const k=swishLive.indexOf(src); if(k>=0) swishLive.splice(k,1); };
  }catch(_){}
}
function playSfxSetTracked(id,i,gain,rate,delay){   // like playSfxSet, but the sound can be cancelled by swishStopAll (the combo finisher: switching animation must not leave it waiting)
  try{
    const st=SFX_SETS[id]; if(!sfx||!st||!st.bufs){ playSfxSet(id,i,gain,rate,delay); return; }
    sfx.resume();
    const src=sfx.createBufferSource(), g=sfx.createGain(); src.buffer=cz(st.bufs[i]); src.playbackRate.value=rate||1; g.gain.value=gain;
    src.connect(g); g.connect(sfx.destination); src.start(sfx.currentTime+(delay||0));
    swishLive.push(src); src.onended=()=>{ const k=swishLive.indexOf(src); if(k>=0) swishLive.splice(k,1); };
  }catch(_){}
}
function swishStopAll(){ swishLive.forEach(x=>{ try{ x.stop(); }catch(_){} }); swishLive.length=0; }   // switching animation cancels swishes still waiting for their swing
function playSwordOld(ts,chop){   // the original swing sounds: the whoosh (or voice 2's shout) plus the knife layer. chop: clip time the whoosh should land on (default SWORD_CHOP_T, the knight's Swing)
  const i=Math.floor(Math.random()*3), c=(chop===undefined?SWORD_CHOP_T:chop)/(ts||1);
  if(voice==='voice2') playSfxSet('v2-sword-sfx-data',i,V2_SWORD_GAIN,1,Math.max(0,c-V2_SWORD_ONSET[i]));
  else playSfxSet('sword-sfx-data',i,SWORD_GAIN,1,Math.max(0,c-SWORD_ONSET[i]));
  playSfxSet('knife-sfx-data',0,KNIFE_GAIN,1,Math.max(0,c-KNIFE_PEAK));
}
function playSword(ts){   // every swing: the original sounds, with the class swish played alongside them
  playSwordOld(ts);
  const i=swishHeavy()?3:swishNext();
  playSwish(i,Math.max(0,SWISH_CHOP_T/(ts||1)-SWISH_PEAK[i]/(ts||1)));
}
/* The UAL swings. Every swing in a clip gets BOTH the original swing sounds (whoosh + knife, landing as the blade starts to move fast) AND the next medium swish from the bag (its loudest part on the fastest moment),
   one swing after the other, so the combos never repeat a swish until all three have played. SWISH_COMBO lists each swing as [start, peak]: the clip times (s) where the blade tip gets fast and where it is fastest,
   read off the tip's speed with the sword mounted as in the game (the same speed test the swing trail uses). Swing2 itself works out at start 0.34 / peak 0.41, which is where SWORD_CHOP_T / SWISH_CHOP_T come from. */
const SWISH_COMBO={
  UAL_Sword_Regular_A:[[0.167,0.267]], UAL_Sword_Regular_B:[[0.208,0.242]], UAL_Sword_Regular_C:[[0.22,0.283],[0.558,0.742]], UAL_Melee_Hook:[[0.15,0.233]],
  UAL_Sword_Regular_Combo:[[0.167,0.267],[0.667,0.742],[1.1,1.267],[1.483,1.533]],
  HeavyCombo:[[0.333,0.517],[0.967,1.017],[1.108,1.192],[1.692,1.742],[1.82,1.9],[2.0,2.108]]
};
const HEAVY_COMBO_FINISH_T=2.66;   // clip time the Heavy Combo's finishing blow slams the sword into the floor (after the stab at ~2.17 he leaps and brings it down; the lowest point of the blade drops from 0.5 above the floor at 2.62 to 0.2 at 2.66 and stays there): the bluntflesh hit and one of the four attack sounds land here. The clip carries on with ~1.7 s of recovery after it
function playSwishClip(n){
  const T=SWISH_COMBO[n]; if(!T){ playSword(1); return; }
  swishStopAll();
  T.forEach(w=>{ const i=swishNext(); playSwordOld(1,w[0]+0.018); playSwish(i,Math.max(0,w[1]-SWISH_PEAK[i])); });
  if(n==='HeavyCombo'){   // the finishing blow: the bluntflesh hit (as RENDER's) with one of the attack sounds
    const fd=Math.max(0,HEAVY_COMBO_FINISH_T-0.06);   // (the sparkle's loudest part is 0.06 s in, so it starts just before the slam)
    playSfxSetTracked('combo-sparkle-sfx-data',0,0.9,1,fd);
    playSfxSetTracked('render-hit-sfx-data',0,0.9,1,fd);   // the bluntflesh hit (wpn_hit_bluntflesh_enchanted_02) starts at the very same moment as the sparkle sound
  }
}
const STEP_GAIN=0.8, STEP_CLIP_T=0.09;   // STEP_CLIP_T: clip time of the first footfall in the Walk animation (the clip is 0.636 s long)
function playStep(rate){ playSfxSet('step-data',0,STEP_GAIN,rate,0); }
let stepPrev=-1;
function footstepStep(){   // call once per frame, after the mixer has moved: plays the walking sound each time the Walk clip passes the first footfall
  const w=actions.Walk;
  if(!w||current!==w||!w.isRunning()){ stepPrev=-1; return; }
  const dur=w.getClip().duration, t=w.time%dur;
  if(stepPrev>=0){ const crossed=stepPrev<=t?(stepPrev<STEP_CLIP_T&&STEP_CLIP_T<=t):(STEP_CLIP_T>stepPrev||STEP_CLIP_T<=t); if(crossed) playStep(w.timeScale>1.01?1.4:1); }   // running: sped up so the second footfall keeps pace
  stepPrev=t;
}
/* flaunt-sfx-data: SD_SWORD_00002 / 00004 (Castlevania). One of them, at random, plays over the flaunt song when Flaunt starts, a bit louder than the music. */
const FLAUNT_SFX_GAIN=1.0;
function playFlauntSfx(){ playSfxSet(voice==='voice2'?'v2-flaunt-sfx-data':'flaunt-sfx-data',Math.floor(Math.random()*2),FLAUNT_SFX_GAIN*(voice==='voice2'?V2_FLAUNT_GAIN:1)); }
const ANIM_SFX={
  Flaunt:()=>playFlauntSfx(),
  AxeFlaunt:()=>playFlauntSfx(),
  Swing:()=>playSword(1),
  AxeSwing:()=>playSword(1),
  Hit:()=>{ blip(130,0.14); playGrunt(); },
  Block:()=>playBlockSfx(),
  Death:()=>playGrunt(DEATH_GRUNT)
};
const ANIM_SFX_LOOPS={Swing:1,AxeSwing:1,Hit:1,Block:1};
['UAL_Sword_Regular_A','UAL_Sword_Regular_B','UAL_Sword_Regular_C','UAL_Sword_Regular_Combo','HeavyCombo','UAL_Melee_Hook'].forEach(n=>{ ANIM_SFX[n]=()=>playSwishClip(n); ANIM_SFX_LOOPS[n]=1; });   // the UAL clips in the ANIMATIONS menu get the same sounds
ANIM_SFX.UAL_Sword_Block=ANIM_SFX.Block; ANIM_SFX_LOOPS.UAL_Sword_Block=1; ANIM_SFX.UAL_Hit_Stagger=ANIM_SFX.Hit; ANIM_SFX_LOOPS.UAL_Hit_Stagger=1;   // clips that loop in the test screen get their sound again every loop (Death plays once)
const DEATH_GRUNT=2;   // which of the three grunts Death uses (the longest one); a hit picks one at random
function playGrunt(i){
  try{
    if(voice==='voice2'){
      if(i===DEATH_GRUNT) playSfxSet('v2-die-data',0,V2_DIE_GAIN,1,0);
      else playSfxSet('v2-grunt-data',Math.floor(Math.random()*4),V2_GRUNT_GAIN,1,0);
      return;
    }
    if(!gruntBufs||!sfx){ const l=loadGrunts(), t0=performance.now(); if(l) l.then(()=>{ if(gruntBufs&&performance.now()-t0<1500) playGrunt(i); }); return; }
    sfx.resume();
    const src=sfx.createBufferSource(), g=sfx.createGain();
    src.buffer=cz(gruntBufs[(i>=0&&i<gruntBufs.length)?i:Math.floor(Math.random()*gruntBufs.length)]); g.gain.value=0.9;
    src.connect(g); g.connect(sfx.destination); src.start();
  }catch(_){}
}
/* ---------- block sound effects: two sounds in a row when he blocks ----------
   SS_00009 (from Digimon World) always plays, together with one of two from Crash Bandicoot (S000001F_NSF_00022 / _00017), picked at random.
   They are embedded in block-sfx-data and decoded on the first menu sound, like the grunts. Gains level out the very different recording volumes. */
const BLOCK_GAIN=[0.92,0.83,1.0];
const BLOCK_BURST=[0,0.22,0.24];   // where the loud "haah" starts inside each file (after a quiet lead-in), so it can be timed to land just as the whirr (SS_00009) finishes
/* ---------- guarding: a hit taken in BlockIdle plays the three block sounds (wpn_block_blunt_01..03) one after another, in a random order, none twice ----------
   A new hit while the sequence is still playing cuts it off and starts a fresh one. BLOCK_HIT_GAIN = volume. */
const BLOCK_HIT_GAIN=0.9;
let blockHitBufs=null, blockHitLoading=null, blockHitBag=[];   // blockHitBag: the sounds not yet used this turn
function playBlockHitSeq(){
  if(!sfx) return;
  if(!blockHitBufs){
    if(!blockHitLoading){ try{
      const list=JSON.parse(document.getElementById('block-hit-data').textContent);
      blockHitLoading=Promise.all(list.map(b=>{ const t=atob(b), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i); return sfx.decodeAudioData(u.buffer); }))
        .then(a=>{ blockHitBufs=a; }).catch(e=>{ blockHitLoading=null; console.error('block hit sfx failed',e); });
    }catch(e){ console.error(e); } }
    if(blockHitLoading) blockHitLoading.then(()=>{ if(blockHitBufs) playBlockHitSeq(); });
    return;
  }
  if(sfx.state==='suspended') sfx.resume();
  if(!blockHitBag.length){ blockHitBag=[0,1,2]; for(let i=2;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [blockHitBag[i],blockHitBag[j]]=[blockHitBag[j],blockHitBag[i]]; } }   // a shuffled bag of the three: every hit takes the next one, so no sound repeats within a turn (the bag is emptied again when the enemy phase ends)
  const b=cz(blockHitBufs[blockHitBag.pop()]), src=sfx.createBufferSource(), g=sfx.createGain(); src.buffer=b; g.gain.value=BLOCK_HIT_GAIN; src.connect(g); g.connect(sfx.destination); src.start(sfx.currentTime+0.02);   // ONE sound per hit
}
let blockBufs=null, blockLoading=null;
function loadBlockSfx(){
  if(blockLoading||!sfx) return blockLoading;
  try{
    const list=JSON.parse(document.getElementById('block-sfx-data').textContent);
    blockLoading=Promise.all(list.map(b=>{ const t=atob(b), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i); return sfx.decodeAudioData(u.buffer); }))
      .then(a=>{ blockBufs=a; }).catch(e=>{ blockLoading=null; console.error('block sfx failed',e); });
  }catch(e){ console.error(e); }
  return blockLoading;
}
const V2_BLOCK_BURST=0.02;
function playBlockSfx(){
  try{
    if(!sfx) return;
    if(!blockBufs){ const l=loadBlockSfx(); if(l) l.then(()=>{ if(blockBufs) playBlockSfx(); }); return; }
    if(voice==='voice2'){
      const s2=SFX_SETS['v2-block-sfx-data'];
      if(!s2||!s2.bufs){ const l2=loadSfxSet('v2-block-sfx-data'); if(l2) l2.then(()=>{ if(SFX_SETS['v2-block-sfx-data']&&SFX_SETS['v2-block-sfx-data'].bufs) playBlockSfx(); }); return; }
      sfx.resume();
      const src0=sfx.createBufferSource(), g0=sfx.createGain(); src0.buffer=cz(blockBufs[0]); g0.gain.value=BLOCK_GAIN[0]; src0.connect(g0); g0.connect(sfx.destination); src0.start(sfx.currentTime);
      const src1=sfx.createBufferSource(), g1=sfx.createGain(); src1.buffer=cz(s2.bufs[0]); g1.gain.value=V2_BLOCK_GAIN; src1.connect(g1); g1.connect(sfx.destination); src1.start(sfx.currentTime+Math.max(0,blockBufs[0].duration-V2_BLOCK_BURST+0.02));
      return;
    }
    sfx.resume();
    [0,1+Math.floor(Math.random()*2)].forEach(i=>{ const src=sfx.createBufferSource(), g=sfx.createGain(); src.buffer=cz(blockBufs[i]); g.gain.value=BLOCK_GAIN[i]; src.connect(g); g.connect(sfx.destination); src.start(sfx.currentTime+(i?Math.max(0,blockBufs[0].duration-BLOCK_BURST[i]+0.02):0)); });   // whirr first, the haah right after it
  }catch(_){}
}
function blip(f,len){
  try{ sfx=sfx||new (window.AudioContext||window.webkitAudioContext)(); sfx.resume(); loadGrunts(); loadBlockSfx(); loadSfxSet('step-data'); loadSfxSet('swish-sfx-data'); loadSfxSet('sword-sfx-data'); loadSfxSet('knife-sfx-data'); loadSfxSet('defeat-sfx-data'); loadSfxSet('flaunt-sfx-data'); loadSfxSet('potion-sfx-data'); ['pizza-sfx-data','combo-sparkle-sfx-data','render-swish-sfx-data','render-hit-sfx-data','render-attack-sfx-data','render-charge-sfx-data','golem-atk-sfx-data','golem-pain-sfx-data','golem-spawn-sfx-data'].forEach(loadSfxSet);
    ['v2-sword-sfx-data','v2-block-sfx-data','v2-grunt-data','v2-die-data','v2-flaunt-sfx-data','slime-atk-sfx-data','slime-hit-sfx-data','slime-die-sfx-data','slime-win-sfx-data'].forEach(loadSfxSet);   // voice 2 and the slimes too, so their very first play is not lost
    const o=sfx.createOscillator(), g=sfx.createGain(); o.type='square'; o.frequency.value=f; g.gain.value=0.045;
    o.connect(g); g.connect(sfx.destination); const t=sfx.currentTime; g.gain.setValueAtTime(0.045,t); g.gain.exponentialRampToValueAtTime(0.001,t+len); o.start(t); o.stop(t+len+0.02);
  }catch(_){}
}
/* ---------- see-through obstacles ----------
   When a wall, pillar or tree stands between the camera and the knight (or an enemy), it is dithered away around him instead of the camera having to dodge it: the fragment shader (uOccOn on
   the obstacle materials) throws away fragments that are nearer than him and close to him on the screen, solid in the middle and thinning out in the same 4x4 ordered-dither grain towards the rim.
   occUpdate works out, every frame, where each character is on the screen (pixels of the render target), how big the hole should be (OCC.radius, in knight-heights) and how far away he is;
   OCC.gap = how much nearer than him (knight-heights) something must be to count as in front. Only while exploring or in a dungeon, never on the map. */
const OCC={radius:0.85, gap:0.55, near:[0.3,1.0]};   // near: obstacles closer to the lens than this fade out (fully gone inside the first number, gone completely by the second; knight-heights)
const _ov=new THREE.Vector3();
function occMark(obj){ obj.traverse(o=>{ const m=o.material; if(m&&m.uniforms&&m.uniforms.uOccOn) m.uniforms.uOccOn.value=1; }); }   // everything in this group counts as an obstacle
function occUpdate(){
  const arr=U.uOccF.value; let n=0;
  if((exploring||dungeon)&&!mapMode&&playerRig&&blobHome){
    camera.updateMatrixWorld();
    const H=playerH, g=blobHome.y, tv=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)), RW=U.uRes.value.x, RH=U.uRes.value.y;
    const add=(x,z)=>{
      if(n>=arr.length) return;
      _ov.set(x,g+0.55*H,z).applyMatrix4(camera.matrixWorldInverse); const depth=-_ov.z; if(depth<0.1) return;   // behind the camera
      _ov.set(x,g+0.55*H,z).project(camera);
      arr[n++].set((_ov.x*0.5+0.5)*RW,(_ov.y*0.5+0.5)*RH,Math.max(6,OCC.radius*H/(2*depth*tv)*RH),depth);
    };
    const p=playerRig.position; add(homeTarget.x+p.x,homeTarget.z+p.z);
    if(dungeon) for(const e of enemies) if(!e.dead) add(e.x,e.z);
    U.uOccNear.value.set(OCC.near[0]*H,OCC.near[1]*H);
  } else U.uOccNear.value.set(-1,-0.5);   // off
  U.uOccN.value=n; U.uOccGap.value=OCC.gap*playerH;
}

/* ---------- MAP (main menu > MAP) ----------
   Skyrim-style. The camera climbs straight up out of the clearing while tilting up at the sky, then pans down onto the knight and pulls back until the whole
   clearing is a map seen from straight above (north up), with one ping on each dungeon. mapS runs 0 -> 3 over those three moves (0 = the menu camera, 3 = the map);
   closing just runs it backwards, so it works from any moment. The camera is placed by hand here (position + yaw/pitch) and the orbit variables are left alone,
   so the menu camera comes back exactly as it was. On the way the fog opens up (from that high it would swallow the ground) and the floor grows 3x so the map has no
   edge. The pings are DOM elements pinned to spots on the ground. MOSSY RUINS goes through enterDungeon(); the other two are locked for now. */
const MAP_DUR=[1.0,1.3,1.7], MAP_BACK=1.6;   // seconds for the climb, the pan down and the pull back; the way back is this much faster
const MAP_TILT=0.95, MAP_TOP=10, MAP_LOW=4.5;   // how far the camera looks up at the sky (radians), its height at the top of the climb, and its height when it looks straight down at him (knight-heights)
const MAP_AREA_TIME=0.55;                    // the glide between The Greenfield and The Veiled Frost: seconds (a critically damped spring, so it eases off and on)
const MAP_FIT=[13.8,10.2];               // half the width / height of the ground the finished map has to show (knight-heights) - zoomed out for breathing room
const MAP_AREAS={
  greenfield:{
    title:'THE GREENFIELD', zOff:0,
    spots:[
      {n:'MOSSY RUINS',   area:'greenfield', idx:0, x:-9.4, z:-2.8, col:'#7fe06a', ready:()=>!!ruinsGroup, run:()=>enterDungeon()},
      {n:'FLOODED CRYPT', area:'greenfield', idx:1, x: 7.8, z:-6.2, col:'#5ec8ff', lock:1},
      {n:'BURNING KEEP',  area:'greenfield', idx:2, x: 9.0, z: 4.8, col:'#ff8a4a', lock:1},
      {n:'SHOP',          area:'greenfield', idx:3, x:-3.0, z: 4.0, col:'#ffd45e', ready:()=>!!shopGroup, run:()=>enterShop()}
    ]
  },
  frost:{
    title:'THE VEILED FROST', zOff:-FROST_DIST,
    spots:[
      {n:'THE ICE FLATS',         area:'frost', idx:0, x:-9.4, z:-2.8-FROST_DIST, col:'#a8e6ff', lock:1},
      {n:'CONSECRATED GRAVEYARD', area:'frost', idx:1, x: 7.8, z:-6.2-FROST_DIST, col:'#c7b8ff', lock:1},
      {n:'CHILLED CAVERNS',       area:'frost', idx:2, x: 9.0, z: 4.8-FROST_DIST, col:'#6ad2ff', lock:1}
    ]
  },
  ignis:{
    title:'IGNIS MOURNE', zOff:-IGNIS_DIST,
    spots:[
      {n:'BERTH OF FLAME',   area:'ignis', idx:0, x:-9.4, z:-2.8-IGNIS_DIST, col:'#ff8a4a', lock:1},
      {n:'SMOLDERING KEEP',  area:'ignis', idx:1, x: 7.8, z:-6.2-IGNIS_DIST, col:'#ff4a4a', lock:1},
      {n:"WORLD'S EDGE",     area:'ignis', idx:2, x: 0.0, z:-12.0-IGNIS_DIST, col:'#ff2a2a', lock:1}
    ]
  }
};
const ALL_MAP_SPOTS=MAP_AREAS.greenfield.spots.concat(MAP_AREAS.frost.spots,MAP_AREAS.ignis.spots);
let MAP_SPOTS=MAP_AREAS.greenfield.spots;
let mapSel=0, mapBig=false, mapCam=null, mapFog0=null, mapAcc=0, mapPings=[], mapEls=null;
const _mp=new THREE.Vector3();
const mapIO=x=>x*x*(3-2*x), mapIOC=x=>x<0.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2, mapLerp=(a,b,t)=>a+(b-a)*t, map01=x=>Math.max(0,Math.min(1,x));
function mapA3(){   // how high the finished map is (knight-heights): high enough to show MAP_FIT on this screen, but never past the far plane
  const asp=innerWidth/Math.max(1,innerHeight), t=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  return Math.min(170/playerH, Math.max(MAP_FIT[1]/t, MAP_FIT[0]/(asp*t)));
}
/* the camera for map time s (0..3): c = the menu camera when it started {p, yaw, pit, t}, H = knight height, A3 = final height (world units), f0 = the fog it started with.
   Heights, tilt and sideways moves ease in and out of each move, so every move starts and ends at rest. pit is the tilt: + up, - down (-PI/2 = straight down).
   z also follows the glide between The Greenfield and The Veiled Frost (mapAreaK), so the map can slide from one area to the other once it is open. */
function mapPose(s,c,H,A3,f0){
  const u1=map01(s), u2=map01(s-1), u3=map01(s-2), top=Math.max(MAP_TOP*H,c.p.y+H), low=MAP_LOW*H;
  const y=s<1?mapLerp(c.p.y,top,mapIO(u1)):s<2?mapLerp(top,low,mapIO(u2)):mapLerp(low,A3,mapIOC(u3));
  const k=mapIO(u2), dy=((0-c.yaw+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;   // the map is north-up: yaw 0, taking the short way round
  const pit=s<1?mapLerp(c.pit,MAP_TILT,mapIO(u1)):mapLerp(MAP_TILT,-Math.PI/2,k);
  const f1=mapIO(map01((s-1)/0.6)), f2=mapIO(map01((s-1.6)/0.6));   // fog: first opened to a long haze, then right out once he is looking straight down
  const tz=homeTarget.z-mapAreaK*FROST_DIST*H, basePz=tz+(c.p.z-c.t.z);
  return {x:mapLerp(c.p.x,c.t.x,k), y:y, z:mapLerp(basePz,tz,k), pit:pit, yaw:c.yaw+dy*k,
    fn:mapLerp(mapLerp(f0[0],10*H,f1),A3*1.5,f2), ff:mapLerp(mapLerp(f0[1],34*H,f1),A3*3,f2), view:1-mapIO(map01(s/1.2))};
}
const MAP_NORTH={greenfield:'frost',frost:'ignis'}, MAP_SOUTH={ignis:'frost',frost:'greenfield'}, MAP_IDX={greenfield:0,frost:1,ignis:2};
function mapArrows(){   // the arrow at the top goes north, the one at the bottom goes back south (each only where there is somewhere to go)
  const n=MAP_NORTH[mapArea], s=MAP_SOUTH[mapArea], aN=document.getElementById('maparrow'), aS=document.getElementById('maparrow2');
  if(aN){ aN.style.display=n?'':'none'; if(n){ document.getElementById('maparrowlbl').textContent=MAP_AREAS[n].title; aN.setAttribute('aria-label','Travel to '+MAP_AREAS[n].title); } }
  if(aS){ aS.style.display=s?'':'none'; if(s){ document.getElementById('maparrow2lbl').textContent=MAP_AREAS[s].title; aS.setAttribute('aria-label','Return to '+MAP_AREAS[s].title); } }
}
function switchMapArea(area){
  if(!MAP_AREAS[area]||mapArea===area) return;
  blip(740,0.1);
  mapArea=area; mapAreaTarget=MAP_IDX[area]; setFrostMusic(area==='frost'); setIgnisMusic(area==='ignis');
  MAP_SPOTS=MAP_AREAS[area].spots; mapSel=0;
  treeGroup=areaTrees(area);
  moveKnightToArea(area);
  const tEl=document.getElementById('maptitle'); if(tEl) tEl.textContent=MAP_AREAS[area].title;
  mapArrows();
  mapRefresh();
}
function mapBuild(){
  const box=document.getElementById('map'), info=document.getElementById('mapinfo'); if(!box||mapEls) return;
  mapEls={name:document.getElementById('mapname'),stat:document.getElementById('mapstat'),ok:document.getElementById('mapok'),you:document.getElementById('mapyou')};
  ALL_MAP_SPOTS.forEach((d,i)=>{
    const el=document.createElement('div'); el.className='mp-ping'+(d.lock?' locked':''); el.style.setProperty('--c',d.col); el.style.setProperty('--d',(d.idx*0.15)+'s');
    el.innerHTML='<div class="mp-pop"><i class="mp-ring"></i><i class="mp-ring"></i><i class="mp-ring"></i><b class="mp-dia"></b></div>';
    const lbl=document.createElement('span'); lbl.className='mp-lbl'; lbl.textContent=(d.idx+1)+' '+d.n; el.appendChild(lbl);
    const hit=document.createElement('button'); hit.type='button'; hit.className='mp-hit'; hit.setAttribute('aria-label',d.n);
    hit.onmouseenter=()=>{ if(d.area===mapArea) mapPick(d.idx); };
    hit.onclick=()=>{ if(d.area!==mapArea){ switchMapArea(d.area); mapPick(d.idx); } else if(mapSel===d.idx) mapConfirm(); else mapPick(d.idx); };
    el.appendChild(hit); box.insertBefore(el,info); mapPings.push({el:el,lbl:lbl,lw:0,d:d});
  });
  const aEl=document.getElementById('maparrow');
  if(aEl){
    aEl.onclick=()=>{ const n=MAP_NORTH[mapArea]; if(n) switchMapArea(n); };
    const st=document.createElement('style'); let css='';
    for(const sh of document.styleSheets){ let rs; try{ rs=sh.cssRules; }catch(e){ continue; } for(const r of rs) if(r.cssText&&/#maparrow(?![\w-])/.test(r.cssText)) css+=r.cssText.replace(/#maparrow(?![\w-])/g,'#maparrow2')+'\n'; }
    st.textContent=css; document.head.appendChild(st);
    const a2=aEl.cloneNode(true); a2.id='maparrow2'; a2.classList.add('south'); a2.querySelector('.arr').innerHTML='&#9660;'; a2.querySelector('#maparrowlbl').id='maparrow2lbl';
    a2.onclick=()=>{ const s=MAP_SOUTH[mapArea]; if(s) switchMapArea(s); }; aEl.parentNode.insertBefore(a2,aEl.nextSibling); mapArrows();
  }
  mapEls.ok.onclick=mapConfirm; document.getElementById('mapback').onclick=mapClose;
}
function mapRefresh(){   // the info window and which ping is selected
  if(!mapEls) return;
  const d=MAP_SPOTS[mapSel], st=d.lock?'LOCKED':(d.ready&&!d.ready()?'LOADING':'READY');
  mapEls.name.textContent=(mapSel+1)+' '+d.n; mapEls.stat.textContent=st; mapEls.stat.className='ms'+(st==='READY'?'':' no'); mapEls.ok.disabled=(st!=='READY');
  mapPings.forEach(q=>q.el.classList.toggle('sel',q.d===d));
}
function mapPick(i){ if(!mapMode||mapDir<0||i===mapSel) return; mapSel=i; blip(520,0.05); mapRefresh(); }
function mapMove(d){ mapPick((mapSel+d+MAP_SPOTS.length)%MAP_SPOTS.length); }
function mapConfirm(){
  if(!mapMode||mapDir<0||dgBusy||shopT>=0) return;
  const d=MAP_SPOTS[mapSel];
  if(d.lock){ blip(140,0.14); if(window.toast) window.toast('LOCKED'); return; }
  if(d.ready&&!d.ready()){ blip(140,0.14); if(window.toast) window.toast('STILL LOADING...'); return; }
  blip(880,0.09); d.run();
}
function openMap(){
  if(mapMode||exploring||dungeon||dgBusy||!playerRig) return;
  swooshHide(); mapBuild();
  mapCam={p:camera.position.clone(), yaw:yaw, pit:-pitch, t:target.clone()};   // the menu camera as it is right now (orbit: pitch + is looking down)
  mapFog0=[U.uFogNear.value,U.uFogFar.value];
  mapMode=true; mapS=0; mapDir=1; mapSel=0; mapViewK=1; mapAcc=0;
  camera.rotation.order='YXZ'; document.body.classList.add('map');
  mapPings.forEach(q=>{ q.lw=0; q.el.classList.remove('on'); }); mapRefresh(); blip(660,0.12);
}
function mapClose(){
  if(!mapMode||mapDir<0||dgBusy||shopT>=0) return;
  mapDir=-1; document.body.classList.remove('mapui'); blip(300,0.08);
}
function mapSnap(){   // back to the menu at once: camera, fog, floor, overlay (also used under the black of the fade when a dungeon is entered)
  if(!mapMode) return;
  mapMode=false; mapS=0; mapDir=0; mapViewK=1; mapAreaK=mapAreaTarget; mapAreaV.v=0;
  moveKnightToArea(mapArea);
  syncFrostBlend();
  if(mapFog0){ U.uFogNear.value=mapFog0[0]; U.uFogFar.value=mapFog0[1]; mapFog0=null; }
  if(mapBig){ mapBig=false; if(floorMesh) floorMesh.scale.set(1,1,1); }
  document.body.classList.remove('map','mapui'); mapPings.forEach(q=>q.el.classList.remove('on'));
  applyView();
}
function mapScreen(x,y,z){ _mp.set(x,y,z).project(camera); return (_mp.z<1&&_mp.z>-1)?[(_mp.x*0.5+0.5)*innerWidth,(-_mp.y*0.5+0.5)*innerHeight]:null; }
function mapStep(dt){
  if(shopT>=0){ shopStep(dt); return; }   // the shop flight places the camera itself
  if(mapDir!==0){
    const i=Math.min(2,Math.max(0,Math.floor(mapDir>0?mapS:mapS-1e-6)));
    mapS+=mapDir*dt/MAP_DUR[i]*(mapDir<0?MAP_BACK:1);
    if(mapDir>0&&mapS>=3){ mapS=3; mapDir=0; }
    else if(mapDir<0&&mapS<=0){ mapSnap(); return; }
  }
  // Glide mapAreaK toward mapAreaTarget (0 = Greenfield, 1 = Veiled Frost). A critically damped spring: it eases off and on, takes about the same time at any frame rate, and never jerks.
  if(mapAreaK!==mapAreaTarget){
    mapAreaK=smoothDamp(mapAreaK,mapAreaTarget,mapAreaV,MAP_AREA_TIME,dt);
    if(Math.abs(mapAreaTarget-mapAreaK)<0.002&&Math.abs(mapAreaV.v)<0.01){ mapAreaK=mapAreaTarget; mapAreaV.v=0; }
  }
  syncFrostBlend();
  const s=mapS, H=playerH, A3=mapA3()*H, q=mapPose(s,mapCam,H,A3,mapFog0);
  camera.position.set(q.x,q.y,q.z); camera.rotation.set(q.pit,q.yaw,0); camera.updateMatrixWorld(true);
  U.uFogNear.value=q.fn; U.uFogFar.value=q.ff;
  const big=s>=0.6; if(big!==mapBig){ mapBig=big; floorMesh.scale.set(1,1,1); }
  if(Math.abs(q.view-mapViewK)>1e-4){ mapViewK=q.view; applyView(); }
  document.body.classList.toggle('map',!(mapDir<0&&s<0.8));   // on the way back the menu returns just before the camera lands
  const show=(mapDir>=0&&s>=2.3); document.body.classList.toggle('mapui',show);
  if(s<1.9) return;
  const W=innerWidth, Hh=innerHeight, gy=blobHome?blobHome.y:0, hx=homeTarget.x, hz=homeTarget.z;
  mapPings.forEach(pg=>{
    const d=pg.d, sc=mapScreen(hx+d.x*H,gy,hz+d.z*H);
    const inView=sc&&sc[0]>=-60&&sc[0]<=W+60&&sc[1]>=-60&&sc[1]<=Hh+60;
    pg.el.classList.toggle('on',show&&s>=2.55&&inView);
    if(!sc) return;
    if(!pg.lw) pg.lw=pg.lbl.offsetWidth||120;
    const lx=Math.max(10-sc[0],Math.min(W-10-pg.lw-sc[0],-pg.lw/2));   // the label is centered under its ping but never runs off the screen
    pg.el.style.transform='translate('+Math.round(sc[0])+'px,'+Math.round(sc[1])+'px)'; pg.lbl.style.transform='translate('+Math.round(lx)+'px,0)';
  });
  const yo=mapScreen(hx,gy,hz+areaZOffset(mapArea));
  if(mapEls){
    if(yo&&yo[1]>=-40&&yo[1]<=Hh+40){ mapEls.you.style.opacity=''; mapEls.you.style.transform='translate('+Math.round(yo[0])+'px,'+Math.round(yo[1]-30)+'px) translate(-50%,-100%)'; }
    else mapEls.you.style.opacity='0';
  }
  mapAcc+=dt; if(mapAcc>0.3){ mapAcc=0; mapRefresh(); }   // READY / LOADING can change while the map is open
}
addEventListener('keydown',e=>{
  if(!mapMode||dgBusy) return;
  if(shopT>=0){
    const k=e.key;
    if(k==='Escape'||k==='Backspace'){ e.preventDefault(); if(shopView==='buy') shopBack(); else exitShop(); }   // in the BUY list Escape goes back to the main panel, there it leaves the shop
    else if(shopUi&&shopUi.classList.contains('on')){
      if(k==='ArrowUp'||k==='w'||k==='W'){ e.preventDefault(); shopSelect(shopCur-1,true); }
      else if(k==='ArrowDown'||k==='s'||k==='S'){ e.preventDefault(); shopSelect(shopCur+1,true); }
      else if(k==='Enter'||k===' '){ e.preventDefault(); shopActivate(); }
      else if(shopView==='main'&&(k==='ArrowRight'||(k==='ArrowLeft'&&shopCur===1))){ e.preventDefault(); shopActivate(); }   // right opens BUY; left / right flip USHINE
      else if(shopView==='buy'&&k==='ArrowLeft'){ e.preventDefault(); shopBack(); }
      else if(k==='u'||k==='U') document.getElementById('shop-ushine-btn').click();
      else if(k==='t'||k==='T') document.getElementById('shop-talk-btn').click();
      else if(k==='e'||k==='E') document.getElementById('shop-endtalk-btn').click();
    }
    return;
  }   // in the shop, Escape walks back out
  const k=e.key;
  if(k==='Escape'||k==='Backspace'){ e.preventDefault(); mapClose(); }
  else if(mapDir===0&&mapS>=3){
    if(k==='ArrowRight'||k==='d') mapMove(1); else if(k==='ArrowLeft'||k==='a') mapMove(-1);
    else if(k==='ArrowUp'||k==='w'){ if(MAP_NORTH[mapArea]) switchMapArea(MAP_NORTH[mapArea]); else mapMove(-1); }
    else if(k==='ArrowDown'||k==='s'){ if(MAP_SOUTH[mapArea]) switchMapArea(MAP_SOUTH[mapArea]); else mapMove(1); }
    else if(k==='Enter'||k===' '){ e.preventDefault(); mapConfirm(); }
  }
});

/* ---------- SHOP (map spot 4) ----------
   shop-data is the stall (model__3__1.gltf). It stands on the ground at the SHOP ping (SHOP_SPOT, in knight-heights from the knight like every ping), SHOP_HEIGHT knight-heights tall, its open front toward +z (toward the camera of the
   map). Choosing SHOP on the map sends the camera down out of the sky (it is already looking straight down from the map): it swoops down, tips up level and lands SHOP_DIST knight-heights in front of the stall, looking into it.
   Escape fades back to the menu. The stall's open front (the side with the sign) is its model +x; it is turned to face the knight's clearing, and the trees around it and in front of it are cleared away. The four little "SWORD / HATCHED / AXE / POTION HERE" marker blocks in the model are hidden: they only mark where the goods will hang. */
const SHOP_SPOT={x:-3.0,z:4.0}, SHOP_HEIGHT=1.9, SHOP_DIST=2.37, SHOP_CAM_Y=0.79, SHOP_LOOK_Y=0.83, SHOP_DUR=2.8;   // SHOP_DIST: how far from the middle of the stall the camera lands (its open front is about 0.9 knight-heights out)
const SHOP_FOG=[14,48], SHOP_VIEW=0.75;   // the fog in the shop view (near, far: knight-heights - much thinner than the menu's) and how far the picture is pushed to the right to make room for the UI on the left (1 = as far as the main menu does, 0 = centered)
const SHOP_CLEAR=2.3, SHOP_LANE=1.4;   // trees are cleared inside this radius around the stall, and in a lane this wide (half-width) in front of it out to the camera (knight-heights)
const shopF=new THREE.Vector3(1,0,0); let shopCleared=null;   // shopF: the way the front of the stall faces (set when it is placed: toward the knight)
/* ---------- the shop's item list ----------
   One entry per labelled cylinder in the stall model, named from its label ('SWORD HANDLE HERE. BLADE POINT DOWN.' -> SWORD, 'HATCHED HERE. POINT UP.' -> HATCHET, ...), in the order they are in the model.
   The picked entry's item turns slowly on its hook. UP / DOWN (or W / S) pick, the mouse works too. The old test controls (shine, talk, end talk) are no longer on the panel: U, T and E still do them. */
let shopItems=[], shopSel=-1, shopView='main', shopCur=0;   // shopView: 'main' (BUY, USHINE) or 'buy' (the items, then BACK); shopCur: the highlighted row of that view; shopSel: the picked item (only in 'buy')
function shopLabel(n){ let s=n.split(/[\s_]+HERE(?=[\s_.]|$)/i)[0].trim().toUpperCase().replace(/[\s_]+HANDLE$/,'').replace(/_/g,' '); return s==='HATCHED'?'HATCHET':s; }
function shopRowCount(){ return shopView==='buy'?shopItems.length+1:2; }   // main: BUY, USHINE - buy: every item, then BACK
function shopMarkSel(){
  if(!shopUi) return;
  const rows=shopUi.querySelectorAll(shopView==='buy'?'.shopbuy':'.shopmain');
  rows.forEach((b,i)=>b.classList.toggle('on',i===shopCur));
  const r=rows[shopCur]; if(r&&r.scrollIntoView) r.scrollIntoView({block:'nearest'});   // a long list scrolls inside the panel instead of running off the screen
}
function shopSelect(k,sound){ const n=shopRowCount(); if(n<1) return; k=((k%n)+n)%n; if(k===shopCur) return; shopCur=k; shopSel=(shopView==='buy'&&k<shopItems.length)?k:-1; if(sound) blip(520,0.05); shopMarkSel(); }
function shopSetView(v){
  shopView=v; shopCur=0; shopSel=(v==='buy'&&shopItems.length)?0:-1;
  if(shopUi){ shopUi.classList.toggle('buy',v==='buy'); const h=shopUi.querySelector('.shophead'); if(h) h.textContent=(v==='buy'?'BUY':'SHOP'); }
  if(shopLbl){ const sm=shopLbl.querySelector('small'); if(sm) sm.textContent=(v==='buy'?'ESC: BACK':'ESC: LEAVE'); }
  shopMarkSel();
}
function shopBack(){ blip(300,0.08); shopSetView('main'); }
function shopActivate(){   // Enter / Space / a click on the highlighted row
  if(shopView==='main'){ blip(880,0.09); if(shopCur===0) shopSetView('buy'); else setShopUShine(!shopShineOn); }
  else if(shopCur>=shopItems.length) shopBack();
  else { blip(880,0.09); if(window.toast) window.toast('COMING SOON'); }   // (nothing to pay with yet)
}
/* ---------- inspecting an item in the BUY list (Resident Evil style) ----------
   The highlighted item leaves its shelf, flies to the front of the camera and turns slowly at a tilt. Everything else (the stall, the keeper, the forest) is blurred and darkened;
   the menu (HTML) and the item stay sharp. How: the item lives on its own layer (1). The world is drawn without it into a render target, blurred in two passes while it is darkened
   onto the screen, and then the item is drawn on top with a fresh depth buffer. Moving off the item, leaving BUY or leaving the shop sends it back to its shelf.
   dist:  how far in front of the camera it floats, in knight heights.      at: where on the screen it sits, as -1..1 (x, y) - right of center, clear of the menu.
   size:  its longest side as a fraction of the screen's height (sizeBy: a multiplier per item).      tilt: lean toward the camera and sideways, in radians.      spin: radians per second.
   blur:  blur strength at full effect (pixels of the 240p picture; scaled up for the Modern look).      dark: [middle, edges] brightness of the world at full effect.
   ease:  seconds for it to settle (fly in / out and the fade).      light: the glint on the metal while inspecting (position is relative to the item, in item-sizes). */
const INSPECT={dist:1.2, at:[0.30,0.0], size:0.56, sizeBy:{POTION:0.75}, tilt:[0.55,-0.5], spin:1.05, blur:2.6, dark:[0.46,0.20], ease:0.1, light:{at:[-0.7,0.9,0.8],color:[1.0,0.9,0.72],intensity:1.5,spec:16}};
const inspect={k:0, it:null, grp:null, fly:0, spin:0, shelf:null, saved:null, center:new THREE.Vector3(), maxDim:1, rtA:null, rtB:null, mat:null, quad:null, quadScene:null, quadCam:null};
const _iv=new THREE.Vector3(), _iv2=new THREE.Vector2(), _ix=new THREE.Vector3(), _iy=new THREE.Vector3(), _iz=new THREE.Vector3(), _ip=new THREE.Vector3(), _iq=new THREE.Quaternion(), _iq2=new THREE.Quaternion(), _iq3=new THREE.Quaternion(), _ie=new THREE.Euler(), _iY=new THREE.Vector3(0,1,0), _tp=new THREE.Vector3();
function inspectBegin(it){
  const h=it.holder; if(!h||!h.parent) return;
  h.updateWorldMatrix(true,false);
  const sp=new THREE.Vector3(), sq=new THREE.Quaternion(), ss=new THREE.Vector3(); h.matrixWorld.decompose(sp,sq,ss);   // where it hangs now, in the world
  inspect.saved={parent:h.parent,pos:h.position.clone(),quat:h.quaternion.clone(),scl:h.scale.clone()}; inspect.shelf={p:sp,q:sq,s:ss.x};
  const scratch=new THREE.Group(); scratch.add(h); h.position.set(0,0,0); h.quaternion.identity(); h.scale.set(1,1,1); scratch.updateMatrixWorld(true);   // measure it on its own
  const box=new THREE.Box3().setFromObject(h), sz=box.getSize(new THREE.Vector3()); box.getCenter(inspect.center); inspect.maxDim=Math.max(sz.x,sz.y,sz.z)||1;
  if(it.pivotCylinder) inspect.center.set(0,inspect.center.y,0);   // the hatchet only: it turns about its handle (the cylinder), not the middle of its box, which the head drags to one side; same height as before
  const grp=new THREE.Group(), pivot=new THREE.Group(); pivot.position.copy(inspect.center).negate(); pivot.add(h); grp.add(pivot); scene.add(grp);   // turns about its own middle (the hatchet: about its handle)
  h.traverse(o=>o.layers.set(1));
  inspect.grp=grp; inspect.it=it; inspect.fly=0;
}
function inspectEnd(){
  const it=inspect.it; if(!it) return; const h=it.holder, S=inspect.saved;
  h.traverse(o=>o.layers.set(0)); S.parent.add(h); h.position.copy(S.pos); h.quaternion.copy(S.quat); h.scale.copy(S.scl);
  scene.remove(inspect.grp); inspect.grp=null; inspect.it=null;
}
function inspectStep(dt){
  const inShop=!!(shopGroup&&shopGroup.visible&&shopT>=0);   // (still true while the shop fades out, so the item flies home and the dimming lifts before the black)
  let want=null; if(inShop&&shopView==='buy'&&shopSel>=0){ const it=shopItems[shopSel]; if(it&&it.holder&&it.holder.parent) want=it; }
  if(!inShop){ inspectEnd(); inspect.k=0; inspect.fly=0; return; }
  if(want&&want!==inspect.it){ inspectEnd(); inspectBegin(want); }   // a new pick: the old one goes back to its shelf at once, the new one flies out (the dimming carries on)
  const a=1-Math.exp(-dt/INSPECT.ease), t=want?1:0;
  inspect.k+=(t-inspect.k)*a; inspect.fly+=(t-inspect.fly)*a;
  if(!want){ if(inspect.k<0.003) inspect.k=0; if(inspect.fly<0.004) inspectEnd(); }
  else { if(inspect.k>0.997) inspect.k=1; if(inspect.fly>0.997) inspect.fly=1; }
  inspect.spin+=dt*INSPECT.spin;
}
function inspectPose(){   // done at draw time, so it uses the camera exactly as it is drawn
  const g=inspect.grp; if(!g) return;
  camera.updateMatrixWorld(true);
  const d=INSPECT.dist*playerH, Hw=2*d*Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
  _tp.set(INSPECT.at[0],INSPECT.at[1],0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(d).add(camera.position);   // the spot in front of the camera
  _ie.set(INSPECT.tilt[0],0,INSPECT.tilt[1]); _iq.setFromEuler(_ie); _iq2.setFromAxisAngle(_iY,inspect.spin);
  _iq3.copy(camera.quaternion).multiply(_iq).multiply(_iq2);   // facing the camera, leaning, and turning about its own axis
  const ts=INSPECT.size*(INSPECT.sizeBy[inspect.it.label]||1)*Hw/inspect.maxDim, S=inspect.shelf;
  const e=inspect.fly*inspect.fly*(3-2*inspect.fly);
  _ip.copy(inspect.center).multiplyScalar(S.s).applyQuaternion(S.q).add(S.p);   // the shelf pose, as the position of the item's middle
  g.position.lerpVectors(_ip,_tp,e); g.quaternion.copy(S.q).slerp(_iq3,e); g.scale.setScalar(S.s+(ts-S.s)*e);
  g.userData.hw=Hw;
}
function inspectEnsure(w,h){
  if(inspect.rtA&&inspect.rtA.width===w&&inspect.rtA.height===h) return;
  if(inspect.rtA){ inspect.rtA.dispose(); inspect.rtB.dispose(); }
  const o={minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,format:THREE.RGBAFormat};
  inspect.rtA=new THREE.WebGLRenderTarget(w,h,o); inspect.rtB=new THREE.WebGLRenderTarget(w,h,Object.assign({depthBuffer:false},o));
  if(!inspect.mat){
    inspect.mat=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,
      uniforms:{tex:{value:null},step:{value:new THREE.Vector2()},k:{value:0},fin:{value:0},dk:{value:new THREE.Vector2(0.5,0.2)}},
      vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
      fragmentShader:'uniform sampler2D tex; uniform vec2 step; uniform float k; uniform float fin; uniform vec2 dk; varying vec2 vUv;\n'
        +'void main(){\n'
        +'  vec3 c=texture2D(tex,vUv).rgb*0.2270270;\n'
        +'  c+=(texture2D(tex,vUv+step).rgb+texture2D(tex,vUv-step).rgb)*0.1945946;\n'
        +'  c+=(texture2D(tex,vUv+step*2.0).rgb+texture2D(tex,vUv-step*2.0).rgb)*0.1216216;\n'
        +'  c+=(texture2D(tex,vUv+step*3.0).rgb+texture2D(tex,vUv-step*3.0).rgb)*0.0540541;\n'
        +'  c+=(texture2D(tex,vUv+step*4.0).rgb+texture2D(tex,vUv-step*4.0).rgb)*0.0162162;\n'
        +'  if(fin>0.5){   // the second pass also darkens: dimmer toward the edges, and a little of the colour drained\n'
        +'    float v=smoothstep(0.95,0.15,length((vUv-0.5)*vec2(1.0,0.85)));\n'
        +'    c=mix(c,vec3(dot(c,vec3(0.3,0.5,0.2))),0.3*k);\n'
        +'    c*=mix(1.0,mix(dk.y,dk.x,v),k);\n'
        +'  }\n'
        +'  gl_FragColor=vec4(c,1.0);\n}'});
    inspect.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),inspect.mat); inspect.quad.frustumCulled=false;
    inspect.quadScene=new THREE.Scene(); inspect.quadScene.add(inspect.quad); inspect.quadCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  }
}
function inspectRender(){
  const sz=renderer.getDrawingBufferSize(_iv2), w=sz.x, h=sz.y; inspectEnsure(w,h); inspectPose();
  const M=inspect.mat, k=inspect.k, r=INSPECT.blur*k*h/240;   // (240 = the PS1 picture's height, so the Modern look blurs as much on screen)
  renderer.setRenderTarget(inspect.rtA); renderer.render(scene,camera);   // the world, without the item (it is on layer 1)
  M.uniforms.k.value=k; M.uniforms.dk.value.set(INSPECT.dark[0],INSPECT.dark[1]);
  M.uniforms.tex.value=inspect.rtA.texture; M.uniforms.step.value.set(r/w,0); M.uniforms.fin.value=0;
  renderer.setRenderTarget(inspect.rtB); renderer.render(inspect.quadScene,inspect.quadCam);   // blurred sideways
  M.uniforms.tex.value=inspect.rtB.texture; M.uniforms.step.value.set(0,r/h); M.uniforms.fin.value=1;
  renderer.setRenderTarget(null); renderer.render(inspect.quadScene,inspect.quadCam);   // blurred up and down, darkened, onto the screen
  // the item on top: its own light, no night tint, no fog
  const L=INSPECT.light, Hw=inspect.grp.userData.hw||1, P=U.uLampP.value, P2=U.uLamp2P.value;
  const sv={lp:U.uLampPos.value.clone(), lc:U.uLampCol.value.clone(), P:P.clone(), P2:P2.clone(), n:U.uNight.value.clone(), fn:U.uFogNear.value, ff:U.uFogFar.value};
  _ix.setFromMatrixColumn(camera.matrixWorld,0); _iy.setFromMatrixColumn(camera.matrixWorld,1); _iz.setFromMatrixColumn(camera.matrixWorld,2);
  U.uLampPos.value.copy(inspect.grp.position).addScaledVector(_ix,L.at[0]*Hw*INSPECT.size).addScaledVector(_iy,L.at[1]*Hw*INSPECT.size).addScaledVector(_iz,L.at[2]*Hw*INSPECT.size);
  U.uLampCol.value.set(L.color[0],L.color[1],L.color[2]); P.set(Hw*3,L.intensity,L.spec,0); P2.y=0;
  U.uNight.value.set(1,1,1); U.uFogNear.value=1e4; U.uFogFar.value=2e4;
  camera.layers.set(1); renderer.autoClear=false; renderer.clearDepth(); renderer.render(scene,camera); renderer.autoClear=true; camera.layers.set(0);
  U.uLampPos.value.copy(sv.lp); U.uLampCol.value.copy(sv.lc); P.copy(sv.P); P2.copy(sv.P2); U.uNight.value.copy(sv.n); U.uFogNear.value=sv.fn; U.uFogFar.value=sv.ff;
}
function shopSpin(dt){   // the picked item turns about its vertical axis; the others ease back to how they hang
  shopItems.forEach((it,i)=>{
    const h=it.holder; if(!h) return;
    if(i===shopSel&&inspect.it!==it) h.rotation.y+=dt*1.4;
    else if(h.rotation.y!==0){ const r=h.rotation.y, home=Math.round(r/(Math.PI*2))*Math.PI*2; h.rotation.y=Math.abs(r-home)<0.01?0:r-(r-home)*Math.min(1,dt*6); }
  });
}
let shopGroup=null, shopPlaced=false, shopT=-1, shopFrom=null, shopFog=null, shopOut=false, shopLbl=null, shopUi=null;
/* ---------- the shop lantern: a light coming from BRIGHTBOX ----------
   BRIGHTBOX is the bulb inside the stall's lantern (a node in shop-data). It is a point light with a warm colour that fades out over `range` (in the stall's own model units,
   scaled with the stall) and it lights SHINY materials only (uShine: the metal weapons, armor and so on), using Gouraud shading: the light is worked out at each vertex and the result is
   blended across the triangle, with a highlight (`spec` = how tight it is) that slides over the metal as the camera moves. Nothing in the stall is shiny yet, so for now it only shows on
   the bulb itself, which glows; anything given uShine near the lantern (the goods that will hang here) picks it up automatically. It is off whenever the stall is not on screen. */
const SHOP_LAMP={color:[1.0,0.78,0.45],intensity:1.25,range:2.2,spec:14};
/* The sign light: a second light that is never drawn, floating in front of the stall (nearer the camera than the lantern, which is inside it), there to light the sign - the board
   hanging from the chains. It works like the lantern (shiny materials only, so it goes with USHINE). `at` is where it floats, in the stall's own model units (the sign's middle is about
   x 0.44, y 0.81, z -0.06; +x is the open front); range is in the same units. */
const SHOP_SIGN_LIGHT={at:[1.2,0.9,-0.06],color:[1.0,0.86,0.62],intensity:1.4,range:1.7,spec:10};
let shopBulb=null, shopRoot=null, shopScale=1; const _lampV=new THREE.Vector3(), _lampV2=new THREE.Vector3(), _lampB=new THREE.Box3();
/* The magma glow on the Ignis Mourne trees swells and fades very slowly: one full breath every MAGMA_PERIOD seconds, between MAGMA_LOW and 1 (the glow's own brightness range is set in the shader, uMagmaPulse). */
const MAGMA_PERIOD=7, MAGMA_LOW=0.15; let magmaT=0;
function updateMagma(dt){
  magmaT+=dt; const w=0.5-0.5*Math.cos(magmaT*Math.PI*2/MAGMA_PERIOD);      // smooth 0..1..0
  U.uMagmaPulse.value=MAGMA_LOW+(1-MAGMA_LOW)*w;
}
function updateShopLamp(){
  const P=U.uLampP.value;
  const P2=U.uLamp2P.value;
  if(!shopBulb||!shopGroup||!shopGroup.visible){ P.y=0; P2.y=0; return; }
  shopGroup.updateMatrixWorld(true);
  if(shopRoot){ _lampV2.set(SHOP_SIGN_LIGHT.at[0],SHOP_SIGN_LIGHT.at[1],SHOP_SIGN_LIGHT.at[2]); shopRoot.localToWorld(_lampV2); U.uLamp2Pos.value.copy(_lampV2);
    U.uLamp2Col.value.set(SHOP_SIGN_LIGHT.color[0],SHOP_SIGN_LIGHT.color[1],SHOP_SIGN_LIGHT.color[2]); P2.set(SHOP_SIGN_LIGHT.range*shopScale,SHOP_SIGN_LIGHT.intensity,SHOP_SIGN_LIGHT.spec,0); } else P2.y=0;
  _lampB.setFromObject(shopBulb).getCenter(_lampV);                      // the middle of the bulb, in the world
  U.uLampPos.value.copy(_lampV); U.uLampCol.value.set(SHOP_LAMP.color[0],SHOP_LAMP.color[1],SHOP_LAMP.color[2]);
  P.set(SHOP_LAMP.range*shopScale,SHOP_LAMP.intensity,SHOP_LAMP.spec,0);
}
let shopKeeper=null, shopKeeperMats=[], shopAllMats=[], shopShineOn=true;
function registerShopMat(m,baseShine){
  m.userData.shopBaseShine=baseShine;
  m.uniforms.uShine.value=shopShineOn?baseShine:0;
  if(shopAllMats.indexOf(m)<0) shopAllMats.push(m);
}
function setShopUShine(on){
  shopShineOn=!!on;
  shopAllMats.forEach(m=>{ m.uniforms.uShine.value=shopShineOn?(m.userData.shopBaseShine||1):0; });
  shopKeeperMats.forEach(m=>{ m.uniforms.uShine.value=shopShineOn?1:0; });
  const btn=document.getElementById('shop-ushine-btn');
  if(btn) btn.innerHTML='<span>USHINE</span><span class="v">'+(shopShineOn?'ON':'OFF')+'</span>';
}
function placeShopGoods(root,markers){
  const D=Math.PI/180, itemScale=0.42, HAMMER_RING_TOP=0.625, HAMMER_TURN_DEG=90;
  const buildParts=(id,cb)=>{
    const el=document.getElementById(id); if(!el) return;
    const PD=JSON.parse(el.textContent);
    Promise.all(PD.parts.map(p=>loadImg(p.tex))).then(imgs=>{
      const grp=new THREE.Group();
      PD.parts.forEach((p,k)=>{
        const geo=new THREE.BufferGeometry();
        geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3));
        geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3));
        const uv=(id==='axe-data'&&typeof insetIslandUV==='function')?insetIslandUV(p.uv,p.i,imgs[k].width,imgs[k].height,AXE_UV_INSET):p.uv;
        geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
        geo.setIndex(p.i);
        const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
        const mat=ps1Mat(tex,1); registerShopMat(mat,1.0);
        const m=new THREE.Mesh(geo,mat);
        m.position.set(p.t[0],p.t[1],p.t[2]); m.rotation.order='ZYX';
        m.rotation.set(p.r[0]*D,p.r[1]*D,p.r[2]*D);
        m.frustumCulled=false; grp.add(m);
      });
      cb(grp);
    });
  };
  markers.forEach(mk=>{   // + the hammer: stood on the counter shelf (the stall model has no marker for it)
    const name=mk.name.toUpperCase(), c=mk.center;
    const it={label:shopLabel(mk.name),holder:null}; shopItems.push(it);   // one entry in the shop list per labelled cylinder
    if(name.indexOf('SWORD')>=0){
      // SWORD HANDLE HERE. BLADE POINT DOWN.
      buildParts('sword-data',grp=>{
        const holder=new THREE.Group();
        grp.position.set(0,-0.844,0);
        const orient=new THREE.Group();
        orient.rotation.set(Math.PI,Math.PI/2,0);
        orient.add(grp);
        holder.add(orient);
        holder.scale.setScalar(itemScale);
        holder.position.copy(c);
        root.add(holder); it.holder=holder;
      });
    } else if(name.indexOf('SHOVEL')>=0){
      buildParts('shovel-data',grp=>{   // SHOVEL HERE. VERTICAL.: the model is 2.14 long and stands on the foot of its marker cylinder, scaled to that cylinder's length and leaning the way the cylinder does
        const holder=new THREE.Group(); holder.add(grp); holder.scale.setScalar((mk.len||0.4375)/2.141);
        if(mk.quat) holder.quaternion.copy(mk.quat); holder.position.copy(mk.bottom||c); root.add(holder); it.holder=holder; });
    } else if(name.indexOf('HAMMER')>=0){
      buildParts('hammer-data',grp=>{
        const holder=new THREE.Group();
        /* HAMMER HANDLE HERE. HAMMERHEAD POINT UP. ... ("RESTING" HAMMER HEAD ON TAURUS): the handle goes down through the ring (torus) around the marker and the underside of the
           head (y 1.031 in the model) rests on top of that ring, so the head never passes through it. The ring's top is HAMMER_RING_TOP in the stall's units; with the usual item scale the handle's foot then lands just above the counter. */
        grp.position.set(-HAMMER_GRIP[0],-1.031,-HAMMER_GRIP[2]);
        const turn=new THREE.Group(); turn.rotation.y=HAMMER_TURN_DEG*D; turn.add(grp);   // turned about the vertical line through the handle (the shop's spin turns the holder, so this is a layer of its own); flip the sign if it turned the wrong way
        holder.add(turn); holder.scale.setScalar(itemScale); holder.position.set(c.x,HAMMER_RING_TOP,c.z);
        root.add(holder); it.holder=holder;
      });
    } else if(name.indexOf('HATCHED')>=0||name.indexOf('HATCHET')>=0){
      // HATCHED HERE. POINT UP.
      it.pivotCylinder=true;   // spins about its handle in the inspect view (see inspectBegin)
      buildParts('hatchet-data',grp=>{
        const holder=new THREE.Group();
        grp.position.set(0,-1.25,0);
        holder.add(grp);
        holder.scale.setScalar(itemScale);
        holder.position.copy(c);
        root.add(holder); it.holder=holder;
      });
    } else if(name.indexOf('AXE')>=0){
      // AXE HERE. HEAD UP.
      buildParts('axe-data',grp=>{
        const holder=new THREE.Group();
        grp.position.set(0,-1.55,0);
        holder.add(grp);
        holder.scale.setScalar(itemScale*0.78);
        holder.position.copy(c);
        root.add(holder); it.holder=holder;
      });
    } else if(name.indexOf('POTION')>=0){
      // POTION HERE. VERTICAL.
      const el=document.getElementById('potion-data'); if(!el) return;
      const t=atob(el.textContent.trim()), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i);
      new THREE.GLTFLoader().parse(u.buffer,'',g=>{
        const cache=new Map();
        const texAlpha=img=>{ const cv=document.createElement('canvas'); cv.width=img.width; cv.height=img.height; const x=cv.getContext('2d'); x.drawImage(img,0,0); const d=x.getImageData(0,0,cv.width,cv.height).data; let mx=0; for(let i=3;i<d.length;i+=4) mx=Math.max(mx,d[i]); return mx/255; };
        g.scene.traverse(o=>{
          if(!o.isMesh) return; const om=o.material;
          if(!cache.has(om.uuid)){
            const m=ps1Mat(om.map,1);
            if(om.map&&om.map.image&&texAlpha(om.map.image)<0.95){
              m.fragmentShader=m.fragmentShader.replace('if(tx.a<0.5) discard;','if(tx.a<0.05) discard;').replace('gl_FragColor=vec4(c,1.0);','gl_FragColor=vec4(c,tx.a);');
              m.transparent=true; m.depthWrite=false; m.userData.glass=true;
            }
            registerShopMat(m,0.85);
            cache.set(om.uuid,m);
          }
          o.material=cache.get(om.uuid); o.renderOrder=o.material.userData.glass?2:0; o.frustumCulled=false;
        });
        g.scene.updateMatrixWorld(true);
        const pbox=new THREE.Box3().setFromObject(g.scene);
        g.scene.position.y=-pbox.min.y;
        const holder=new THREE.Group(); holder.add(g.scene);
        holder.scale.setScalar(itemScale*0.85);
        holder.position.set(c.x,0.28125,c.z);
        root.add(holder); it.holder=holder;
      });
    }
  });
}

/* ---------- crates beside the stall (crate-data = crate.gltf) ----------
   Stacked on both sides of the stall, deliberately lopsided: different sizes, turned every which way, a few leaning, and the two piles are not alike. x / z = where a crate stands in the stall's
   own units (+x is the open front, +z is the camera's left, -z its right), up = the height of what it sits on in crate-heights of its OWN pile (so 1 = on one crate of scale 1),
   y = height above the ground, s = scale (the crate model is about 0.34 across), rot = turn about the vertical in degrees, lean = [about x, about z] in degrees. */
const SHOP_CRATES=[
  // the left pile (+z): a big one, a smaller one beside it, two on top at odd angles, and a lone one out front
  {x: 0.05,z: 1.06,y:0.000,s:1.75,rot: 12,lean:[0,0]},
  {x:-0.60,z: 1.14,y:0.000,s:1.40,rot:-24,lean:[0,2]},
  {x: 0.12,z: 1.02,y:0.569,s:1.35,rot: 38,lean:[0,0]},
  {x:-0.58,z: 1.16,y:0.455,s:1.00,rot: -9,lean:[3,-4]},
  {x: 0.52,z: 1.38,y:0.000,s:1.20,rot: 57,lean:[0,0]},
  // the right pile (-z): taller and tighter, three high on one side, a small stray at the end
  {x:-0.12,z:-1.24,y:0.000,s:1.95,rot: -8,lean:[0,0]},
  {x: 0.38,z:-1.30,y:0.000,s:1.50,rot: 21,lean:[0,0]},
  {x:-0.06,z:-1.30,y:0.634,s:1.55,rot: 27,lean:[0,0]},
  {x:-0.02,z:-1.26,y:1.138,s:1.15,rot:-41,lean:[-4,3]},
  {x:-0.62,z:-1.10,y:0.000,s:1.00,rot:  6,lean:[0,0]}
];
function placeShopCrates(root,groundY){
  const el=document.getElementById('crate-data'); if(!el) return;
  try{
    const t=atob(el.textContent.trim()), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i);
    new THREE.GLTFLoader().parse(u.buffer,'',g=>{
      const cache=new Map();
      g.scene.traverse(o=>{
        if(!o.isMesh) return; const om=o.material;
        if(!cache.has(om.uuid)){
          let tex=om.map; if(!tex){ const c=document.createElement('canvas'); c.width=c.height=2; const x=c.getContext('2d'); x.fillStyle='#'+om.color.getHexString(); x.fillRect(0,0,2,2); tex=new THREE.CanvasTexture(c); tex.flipY=false; }
          const m=ps1Mat(tex,1); registerShopMat(m,0.3); cache.set(om.uuid,m);   // wood, like the stall: a little shiny, so the lantern and the sign light catch it
        }
        o.material=cache.get(om.uuid); o.frustumCulled=false;
      });
      g.scene.updateMatrixWorld(true);
      const cb=new THREE.Box3().setFromObject(g.scene);   // so every crate can stand on its own foot, centred
      SHOP_CRATES.forEach(c=>{
        const inner=g.scene.clone(true); inner.position.set(-(cb.min.x+cb.max.x)/2,-cb.min.y,-(cb.min.z+cb.max.z)/2);
        const holder=new THREE.Group(); holder.add(inner); holder.scale.setScalar(c.s);
        holder.rotation.set(c.lean[0]*Math.PI/180,c.rot*Math.PI/180,c.lean[1]*Math.PI/180);
        holder.position.set(c.x,groundY+c.y,c.z); root.add(holder);
      });
    },e=>console.error('crate load failed',e));
  }catch(e){ console.error('crates failed',e); }
}
(function(){
  const el=document.getElementById('shop-data'); if(!el) return;
  try{
    const t=atob(el.textContent.trim()), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i);
    new THREE.GLTFLoader().parse(u.buffer,'',g=>{
      const root=g.scene, cache=new Map(), markers=[], toRemove=[];
      root.updateMatrixWorld(true);
      root.traverse(o=>{
        /* The loader tidies node names (spaces become _, dots are dropped), so 'SWORD HANDLE HERE. BLADE POINT DOWN.' arrives as SWORD_HANDLE_HERE_BLADE_POINT_DOWN and a test for 'HERE.' never matched:
           the labelled cylinders stayed in the stall and no weapons were placed. The label as typed in the model is kept in userData.name, so check that (and the tidied name too). */
        const rawName=(o.userData&&o.userData.name)||o.name;
        if(/(^|[\s_])HERE([\s_.]|$)/i.test(rawName)||/(^|[\s_])HERE([\s_.]|$)/i.test(o.name)){
          const mb=new THREE.Box3().setFromObject(o);
          const mk={name:rawName, center:mb.getCenter(new THREE.Vector3()), min:mb.min.clone(), max:mb.max.clone()};
          if(o.isMesh&&o.geometry){ const bb=o.geometry.boundingBox||(o.geometry.computeBoundingBox(),o.geometry.boundingBox);   // the cylinder's foot, its length and its lean (the shovel's marker leans a little)
            mk.bottom=o.localToWorld(new THREE.Vector3((bb.min.x+bb.max.x)/2,bb.min.y,(bb.min.z+bb.max.z)/2)); mk.len=bb.max.y-bb.min.y; mk.quat=o.getWorldQuaternion(new THREE.Quaternion()); }
          markers.push(mk);
          o.visible=false; toRemove.push(o);
          return;
        }
        if(!o.isMesh) return; const om=o.material;
        const isRoof=(o.position.y>0.7&&o.rotation.z!==0);
        const isMetalHardware=/torus|beveled_cuboid/i.test(o.name)||(o.parent&&o.parent.name==='lanter'&&o.name!=='BRIGHTBOX');
        const shineLvl=(o.name==='BRIGHTBOX')?0:(isRoof?0.55:(isMetalHardware?0.55:0.36));   // wood (the roof, and everything else that is not metal): a little shinier than before (0.45 / 0.22)
        const key=om.uuid+'_'+shineLvl;
        if(!cache.has(key)){
          let tex=om.map; if(!tex){ const c=document.createElement('canvas'); c.width=c.height=2; const x=c.getContext('2d'); x.fillStyle='#'+om.color.getHexString(); x.fillRect(0,0,2,2); tex=new THREE.CanvasTexture(c); tex.flipY=false; }
          const m=ps1Mat(tex,1);
          if(shineLvl>0) registerShopMat(m,shineLvl);
          cache.set(key,m);
        }
        o.material=cache.get(key); o.frustumCulled=false;
        if(o.name==='BRIGHTBOX'){ o.material.uniforms.uEmit.value=1; shopBulb=o; }
      });
      toRemove.forEach(o=>{ if(o.parent) o.parent.remove(o); });
      placeShopGoods(root,markers);
      root.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(root), sc=SHOP_HEIGHT*playerH/(box.max.y-box.min.y);
      root.scale.setScalar(sc); shopScale=sc; shopRoot=root; root.position.set(-(box.min.x+box.max.x)/2*sc,-box.min.y*sc,-(box.min.z+box.max.z)/2*sc);
      const grp=new THREE.Group(); grp.add(root); grp.visible=false; scene.add(grp); shopGroup=grp;
      placeShopCrates(root,box.min.y);   // after the stall was measured, so they don't change its size or where it stands
    },e=>console.error('shop load failed',e));
  }catch(e){ console.error('shop failed',e); }
})();
let shopEvt={clock:0,next:6};
function shopEvtStep(dt){   // every 5-11 s of plain idling he plays ShopIdleAnimation1 once, then settles back into ShopIdle
  const sk=shopKeeper; if(!sk||!actions.ShopIdleAnimation1) return;
  if(sk.curAct!==sk.idleAct||shopTalkOn){ shopEvt.clock=0; return; }   // not while talking, or while the event is already playing
  shopEvt.clock+=dt; if(shopEvt.clock<shopEvt.next) return;
  const a=sk.mixer.clipAction(actions.ShopIdleAnimation1.getClip()); a.reset(); a.setLoop(THREE.LoopOnce,1); a.clampWhenFinished=true;
  sk.curAct.crossFadeTo(a,0.2,false); a.play(); sk.curAct=a;
  const onFin=e=>{ if(e.action!==a) return; sk.mixer.removeEventListener('finished',onFin);
    if(sk.curAct===a){ const idle=sk.idleAct; idle.reset(); a.crossFadeTo(idle,0.25,false); idle.play(); sk.curAct=idle; } };   // (if he started talking meanwhile, the talk clips already took over)
  sk.mixer.addEventListener('finished',onFin); shopEvt.clock=0; shopEvt.next=5+Math.random()*6;
}
function spawnShopKeeperInBuilding(){
  if(shopKeeper||!shopGroup||!knightScene||!actions.ShopIdle) return;
  if(helmetNames.indexOf('Helmet 6')<0||!helm6.pane) return;   // the helmets (and Helmet 6's face pane) load a moment after the model; the keeper is cloned only once they are there, or he would end up with the first helmet
  const root=(()=>{ const st=[]; knightScene.traverse(o=>{ if(o.userData&&Object.keys(o.userData).length){ st.push([o,o.userData]); o.userData={}; } }); try{ return knightScene.clone(true); } finally{ st.forEach(([o,u])=>{ o.userData=u; }); } })();
  const cache=new Map(), pTex=[], rocks=[];
  root.scale.x=MIRROR_MODEL?1:-1;   // the keeper is mirrored the other way from the player, so every shop clip plays flipped left-for-right (mirroring the model is the exact way to mirror an animation: see MIRROR_MODEL)
  root.traverse(o=>{ if(o.name==='Shortsword'||o.name==='Axe'||o.name==='Hatchet'||o.name==='Hammer'||o.name==='KnightlySword'||o.name==='Morningstar') o.visible=false; });
  const h6Idx=Math.max(0,helmetNames.indexOf('Helmet 6')), oL=[], cL=[];
  knightScene.traverse(o=>oL.push(o)); root.traverse(o=>cL.push(o));
  helmetSets.forEach((set,j)=>set.forEach(m=>{ const cm=cL[oL.indexOf(m)]; if(cm) cm.visible=(j===h6Idx); }));
  shopKeeperMats=[];
  const ah='#a38aeb', ph='#9177b6';   // ph: the keeper's plume colour, sampled from his new helmet's plume texture
  root.traverse(o=>{
    if(o.name==='SeatRock') rocks.push(o);
    if(!o.isMesh||o.name==='SeatRock') return;
    if(o.name==='H6Face'){ shopFaceAttach(o,root); o.frustumCulled=false; return; }   // the keeper's own animated face (shop-face-data), not tinted
    const om=o.material; if(!om.uniforms){ o.visible=false; return; }   /* the Knightly sword's halo (a plain additive material) is left out of copies of the knight */
      let nm=cache.get(om.uuid);
    if(!nm){
      const src=om.uniforms.map.value, isPl=/Plume$/.test(o.name); let tex=src;
      if(isPl){
        const pl=plumes.find(q=>q.tex===src);
        if(pl){
          const cv=document.createElement('canvas'); cv.width=pl.base.width; cv.height=pl.base.height;
          const t=new THREE.CanvasTexture(cv); t.flipY=false; t.encoding=THREE.LinearEncoding; t.generateMipmaps=false; t.minFilter=t.magFilter=THREE.NearestFilter;
          tintOne({tex:t,ctx:cv.getContext('2d'),base:pl.base,avgL:pl.avgL},ph); tex=t; pTex.push(t);
        }
      }
      nm=ps1Mat(tex,1); if(/h6_/.test(o.name)){ nm.uniforms.uBlackNoShine.value=1; nm.uniforms.uBlackGrey.value=SHOP_H6_GREY; }   // (until shopHelmApply swaps in his new helmet textures)
      if(!isPl) tintMat(nm,ah,SHOP_ARMOR_TINT);
      nm.uniforms.uShine.value=shopShineOn?1:0;
      if(/Plume$/.test(o.name)) nm.uniforms.uShine.value=0; else shopKeeperMats.push(nm);   // the plume never shines
      cache.set(om.uuid,nm);
    }
    o.material=nm; o.frustumCulled=false;
  });
  rocks.forEach(r=>r.parent&&r.parent.remove(r));
  const rig=new THREE.Group(); rig.add(root);
  const ox=-homeTarget.x, oz=-homeTarget.z, th=Math.PI/2;
  const kx=-0.08*shopScale, kz=0.05*shopScale, ky=0;
  rig.rotation.y=th;
  rig.position.set(kx-(ox*Math.cos(th)+oz*Math.sin(th)), ky, kz-(-ox*Math.sin(th)+oz*Math.cos(th)));
  shopGroup.add(rig);
  const mx=new THREE.AnimationMixer(root);
  const idleAct=mx.clipAction(actions.ShopIdle.getClip());
  idleAct.play(); mx.update(0);
  shopKeeper={rig,root,mixer:mx,tex:pTex,idleAct,curAct:idleAct};
  shopHelmLoad(); shopHelmApply(root);
  shopFitKeeper(shopKeeper);
}
/* The keeper's arms rest on the counter. ShopIdle holds his hands about 1.2 high, a little below the counter top and well short of the shelf, so he is lifted and moved up to the counter:
   measured on the real pose (every 1/12 of the idle loop, the posed hand meshes in the stall's space), his lowest hand point ends on the shelf's top face and his hands reach SHOP_REST of the way across it.
   SHOP_TABLE is that shelf in the stall's own model units: the height of its top face, and where it starts / ends toward the open front (+x). */
const SHOP_TABLE={top:0.281,x0:0.234,x1:0.484}, SHOP_REST=0.6;   // how far across the shelf his hands reach (0 = back edge, 1 = front edge): 0.3 -> 0.6 moves him forward over the table
const SHOP_KEEPER_NUDGE=-0.0549;   // his extra height relative to the table, in the stall's model units (so it scales with the stall)
function shopFitKeeper(sk){
  const hands=['Adventurer_Left_Hand','Adventurer_Right_Hand'].map(n=>sk.root.getObjectByName(n)).filter(Boolean);
  if(!hands.length||!shopRoot) return;
  const idle=sk.idleAct, dur=idle.getClip().duration, gy=shopGroup.position.y, box=new THREE.Box3(), c=new THREE.Vector3();
  let low=1e9, fx=0, n=0;
  shopGroup.updateMatrixWorld(true);
  for(let i=0;i<=12;i++){
    idle.time=dur*i/12; sk.mixer.update(0); sk.rig.updateMatrixWorld(true);
    hands.forEach(h=>{ box.setFromObject(h); low=Math.min(low,box.min.y-gy); box.getCenter(c); shopGroup.worldToLocal(c); fx+=c.x; n++; });
  }
  idle.time=0; sk.mixer.update(0);
  const X=m=>m*shopScale+shopRoot.position.x, topY=SHOP_TABLE.top*shopScale+shopRoot.position.y;
  const wantX=X(SHOP_TABLE.x0)+SHOP_REST*(X(SHOP_TABLE.x1)-X(SHOP_TABLE.x0));
  const dy=Math.max(0,Math.min(0.8*playerH,topY-low)), dx=Math.max(-0.5*playerH,Math.min(1.2*playerH,wantX-fx/n));   // (clamped, in case the pose ever measures oddly)
  sk.rig.position.y+=dy+SHOP_KEEPER_NUDGE*shopScale; sk.rig.position.x+=dx;   // SHOP_KEEPER_LIFT: extra height (knight-heights) so his arms, not just his hands, sit on the table; x / z unchanged
}
function shopSync(){   // put the stall on its spot (once the knight's home is known) and show it everywhere but inside the ruins
  if(!shopGroup) return;
  if(!shopPlaced&&blobHome&&homeTarget){
    shopGroup.position.set(homeTarget.x+SHOP_SPOT.x*playerH,blobHome.y,homeTarget.z+SHOP_SPOT.z*playerH);
    shopF.set(homeTarget.x-shopGroup.position.x,0,homeTarget.z-shopGroup.position.z).normalize();   // faces the knight's clearing
    shopGroup.rotation.y=Math.atan2(-shopF.z,shopF.x);   // model +x (the open front, with the sign) -> shopF
    shopPlaced=true;
  }
  if(shopPlaced) spawnShopKeeperInBuilding();
  shopGroup.visible=shopPlaced&&!dungeon;
  if(shopPlaced&&greenTreeGroup&&greenTreeGroup!==shopCleared){   // no trees inside the stall, or in the way of the camera in front of it (also again if the forest is rebuilt)
    const H=playerH, S=shopGroup.position, reach=SHOP_DIST*H+1.5*H, near=t=>{
      const dx=t.x-S.x, dz=t.z-S.z, al=dx*shopF.x+dz*shopF.z, pe=Math.abs(dx*shopF.z-dz*shopF.x);
      return Math.hypot(dx,dz)<SHOP_CLEAR*H||(al>0&&al<reach&&pe<SHOP_LANE*H); };
    greenTreeGroup.children.slice().forEach(tr=>{ if(near(tr.position)) greenTreeGroup.remove(tr); });
    if(typeof colliders!=='undefined'&&colliders) colliders=colliders.filter(c=>!near(c));
    shopCleared=greenTreeGroup;
  }
}
function enterShop(){
  if(shopT>=0||!shopGroup||!shopPlaced) return;
  document.body.classList.remove('mapui'); mapPings.forEach(q=>q.el.classList.remove('on'));
  shopTalkOn=false; shopTalkK=0; setShopMusic(true); shopFrom={p:camera.position.clone(),pit:camera.rotation.x,yaw:camera.rotation.y,view:mapViewK}; shopFog=[U.uFogNear.value,U.uFogFar.value]; shopOut=false; shopT=0;
  if(!shopLbl){
    const st=document.createElement('style'); st.textContent='#shoplbl{position:fixed;left:50%;bottom:calc(34px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);text-align:center;color:#ffd45e;text-shadow:3px 3px 0 #000;font-size:46px;letter-spacing:.14em;opacity:0;transition:opacity .6s;pointer-events:none;z-index:15;line-height:1}#shoplbl small{display:block;margin-top:6px;font-size:22px;letter-spacing:.1em;color:#fff}#shoplbl.on{opacity:1}'; document.head.appendChild(st);
    /* Shop UI on the left with toggleable uShine and Talk controls */
    const st2=document.createElement('style'); st2.textContent='#shopui{position:fixed;left:3vw;top:9vh;width:min(32vw,440px);height:auto;max-height:74vh;box-sizing:border-box;border:3px solid var(--ui-edge);background:var(--ui-panel);box-shadow:0 0 0 3px #000,inset 0 0 0 3px rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;padding:24px;gap:12px;font-size:min(34px,5vh);letter-spacing:.14em;color:var(--ui-text);text-shadow:3px 3px 0 #000;opacity:0;transition:opacity .6s;pointer-events:none;z-index:15}#shopui.on{opacity:1;pointer-events:auto}#shopui .shopctl{display:none}#shopui .mi{display:flex;justify-content:space-between}#shopui .shoplist{display:flex;flex-direction:column;gap:12px;flex:0 0 auto}#shopui:not(.buy) .shoplist{display:none}#shopui.buy .shopmain,#shopui.buy .shopctl{display:none}@media (max-aspect-ratio:9/10){#shopui{left:4vw;width:92vw;top:4vh;height:auto;max-height:46vh}}'; document.head.appendChild(st2);
    shopUi=document.createElement('div'); shopUi.id='shopui';
    shopUi.innerHTML='<div class="shophead" style="border-bottom:2px solid var(--ui-edge);padding-bottom:6px;margin-bottom:8px">SHOP</div>'
      +'<button class="mi shopmain" data-m="0" type="button"><span>BUY</span><span class="v">&#9654;</span></button>'
      +'<button class="mi shopmain" id="shop-ushine-btn" data-m="1" type="button"><span>USHINE</span><span class="v">'+(shopShineOn?'ON':'OFF')+'</span></button>'
      +'<div class="shoplist">'+shopItems.map((it,k)=>'<button class="mi shopbuy" data-i="'+k+'" type="button"><span>'+it.label+'</span></button>').join('')+'<button class="mi shopbuy" data-i="'+shopItems.length+'" type="button"><span>BACK</span></button></div>'
      +'<button class="mi shopctl" id="shop-talk-btn" type="button"><span>TALK</span></button>'
      +'<button class="mi shopctl" id="shop-endtalk-btn" type="button"><span>END TALK</span></button>';
    document.body.appendChild(shopUi);
    shopUi.querySelectorAll('.shopmain').forEach(b=>{ const i=+b.dataset.m; b.onmouseenter=()=>shopSelect(i,true); b.onclick=()=>{ shopSelect(i,false); shopActivate(); }; });
    shopUi.querySelectorAll('.shopbuy').forEach(b=>{ const i=+b.dataset.i; b.onmouseenter=()=>shopSelect(i,true); b.onclick=()=>{ shopSelect(i,false); shopActivate(); }; });
    document.getElementById('shop-ushine-btn').onclick=()=>{ blip(880,0.09); setShopUShine(!shopShineOn); };   // (also what the U key presses)
    document.getElementById('shop-talk-btn').onclick=()=>{
      if(!shopKeeper||!actions.ShopIdleAnimationIntoTalk) return;
      blip(880,0.09);
      shopFaceSet(['talking','angrytalking'][Math.floor(Math.random()*2)]); shopTalkOn=true;   // one of the talking faces, and the camera centres on the shop and zooms in
      const playShopClip=(name,loop,next)=>{
        const cl=actions[name]&&actions[name].getClip(); if(!cl) return;
        const a=shopKeeper.mixer.clipAction(cl);
        a.reset(); a.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1); a.clampWhenFinished=!loop;
        shopKeeper.curAct.crossFadeTo(a,0.2,false); a.play(); shopKeeper.curAct=a;
        if(next){
          const onFin=e=>{ if(e.action===a){ shopKeeper.mixer.removeEventListener('finished',onFin); next(); } };
          shopKeeper.mixer.addEventListener('finished',onFin);
        }
      };
      playShopClip('ShopIdleAnimationIntoTalk',false,()=>playShopClip('ShopIdleAnimationWhileTalking',true));
    };
    document.getElementById('shop-endtalk-btn').onclick=()=>{
      if(!shopKeeper||!actions.ShopIdleAnimationOutroTalk) return;
      blip(880,0.09); shopFaceSet('normal'); shopTalkOn=false;   // back to the normal face, and the camera zooms back out
      const cl=actions.ShopIdleAnimationOutroTalk.getClip();
      const a=shopKeeper.mixer.clipAction(cl);
      a.reset(); a.setLoop(THREE.LoopOnce,1); a.clampWhenFinished=true;
      shopKeeper.curAct.crossFadeTo(a,0.2,false); a.play(); shopKeeper.curAct=a;
      const onFin=e=>{
        if(e.action===a){
          shopKeeper.mixer.removeEventListener('finished',onFin);
          const idle=shopKeeper.idleAct; idle.reset(); shopKeeper.curAct.crossFadeTo(idle,0.25,false); idle.play(); shopKeeper.curAct=idle;
        }
      };
      shopKeeper.mixer.addEventListener('finished',onFin);
    };
    const stb=document.createElement('style'); stb.textContent='#shopsong{position:fixed;right:max(14px,env(safe-area-inset-right,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:16;font:inherit;font-size:22px;letter-spacing:.08em;color:var(--ui-text);background:var(--ui-panel);border:2px solid var(--ui-edge);box-shadow:0 0 0 2px #000;padding:4px 12px;opacity:0;pointer-events:none;transition:opacity .6s,background .15s;text-shadow:2px 2px 0 #000;text-align:right;cursor:pointer;user-select:none;-webkit-user-select:none}#shopsong small{display:block;margin-top:2px;font-size:13px;letter-spacing:.1em;color:var(--ui-dim)}#shopsong:hover{background:var(--ui-hover)}#shopsong.on{opacity:1;pointer-events:auto}'; document.head.appendChild(stb);
    shopSongBtn=document.createElement('div'); shopSongBtn.id='shopsong'; shopSongLabel(); document.body.appendChild(shopSongBtn);
    shopSongBtn.addEventListener('click',e=>{ e.stopPropagation(); shopSongNext(); }); shopSongBtn.addEventListener('pointerdown',e=>e.stopPropagation());
    shopLbl=document.createElement('div'); shopLbl.id='shoplbl'; shopLbl.innerHTML='SHOP<small>ESC: LEAVE</small>'; document.body.appendChild(shopLbl);
  }
  shopSetView('main');   // every visit starts on the main panel
}
let shopTalkOn=false, shopTalkK=0; const _tkV=new THREE.Vector3(); const SHOP_TALK_DIST=1.2;   // SHOP_TALK_DIST: how far (knight-heights) in front of the keeper's face the camera stops while he talks
function shopTalkCam(dt,u){
  const want=shopTalkOn?1:0; shopTalkK+=(want-shopTalkK)*(1-Math.exp(-dt*3.5)); if(Math.abs(want-shopTalkK)<0.002) shopTalkK=want;
  if(shopTalkK<=0||u<1||!shopKeeper) return;
  const hd=shopKeeper.root.getObjectByName('H6Face')||shopKeeper.root.getObjectByName('Head'); if(!hd) return;
  hd.getWorldPosition(_tkV); const H=playerH, k=shopTalkK*shopTalkK*(3-2*shopTalkK), d=SHOP_TALK_DIST*H;
  camera.position.set(mapLerp(camera.position.x,_tkV.x+shopF.x*d,k),mapLerp(camera.position.y,_tkV.y,k),mapLerp(camera.position.z,_tkV.z+shopF.z*d,k));
  camera.rotation.x=mapLerp(camera.rotation.x,0,k);
}
function shopStep(dt){
  shopT+=dt; const u=Math.min(1,shopT/SHOP_DUR), H=playerH, S=shopGroup.position;
  const ex=S.x+shopF.x*SHOP_DIST*H, ey=blobHome.y+SHOP_CAM_Y*H, ez=S.z+shopF.z*SHOP_DIST*H, ep=Math.atan2(blobHome.y+SHOP_LOOK_Y*H-ey,SHOP_DIST*H);   // where the camera lands (out in front of the stall), and how it is tilted there (level, a hair up)
  const eyaw=Math.atan2(shopF.x,shopF.z), dyaw=((eyaw-shopFrom.yaw+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;   // turned to look back at the stall, the short way round
  const kh=mapIOC(u), kp=mapIO(map01(u/0.9)), kx=mapIO(u);
  camera.position.set(mapLerp(shopFrom.p.x,ex,kx),mapLerp(shopFrom.p.y,ey,kh),mapLerp(shopFrom.p.z,ez,kx));
  camera.rotation.set(mapLerp(shopFrom.pit,ep,kp),shopFrom.yaw+dyaw*kx,0); shopTalkCam(dt,u); camera.updateMatrixWorld(true);
  U.uFogNear.value=mapLerp(shopFog[0],SHOP_FOG[0]*H,kx); U.uFogFar.value=mapLerp(shopFog[1],SHOP_FOG[1]*H,kx);   // thin haze instead of the menu's thick fog
  const tk=shopTalkK*shopTalkK*(3-2*shopTalkK), vk=mapLerp(shopFrom.view,SHOP_VIEW,kx)*(1-tk); if(Math.abs(vk-mapViewK)>1e-4){ mapViewK=vk; applyView(); }   // the stall slides a little right of center
  if(shopUi) shopUi.classList.toggle('on',u>=1&&!shopOut);
  if(shopLbl) shopLbl.classList.toggle('on',u>=1&&!shopOut); if(shopSongBtn) shopSongBtn.classList.toggle('on',u>=1&&!shopOut);
  shopSpin(dt);
}
function exitShop(){
  if(shopOut||shopT<0) return; shopTalkOn=false; helmet6Face('normal'); shopOut=true; setShopMusic(false); blip(300,0.08); if(shopLbl) shopLbl.classList.remove('on'); if(shopSongBtn) shopSongBtn.classList.remove('on'); if(shopUi) shopUi.classList.remove('on');
  shopSetView('main');
  fadeThen(()=>{ shopT=-1; shopOut=false; mapSnap(); });   // under the black: back to the menu camera
}
/* ---------- INVENTORY (main menu > INVENTORY) ----------
   The camera eases in on the knight (closer, a little above the middle of him) with the picture pushed right to leave room for the panel on the left - the same layout as the shop -
   he is put in his idle pose and everything except him is hidden, so the fog/sky colour is the background (the turntable stays off). The panel mocks the shop's: SWORD / HATCHET / AXE equip that weapon, POTION is only listed. */
/* The inventory's background: a layer drawn behind the knight, over the (lightened) fog colour: a soft glow behind him, a gentle vignette, and a few big blurred specks drifting slowly upward,
   all low in contrast so it adds depth without pulling the eye. INV_BG_GLOW / _VIGNETTE / _BOKEH = how strong each is (0 = off); INV_BG_DRIFT = how fast the specks move. */
const INV_BG_GLOW=0.30, INV_BG_VIGNETTE=0.16, INV_BG_BOKEH=0.10, INV_BG_DRIFT=1.0;
let invBg=null;
function invBackdrop(){
  if(invBg) return invBg;
  const mat=new THREE.ShaderMaterial({
    uniforms:{uBase:{value:new THREE.Color()},uTime:{value:0},uAsp:{value:1},uK:{value:0},uGlow:{value:INV_BG_GLOW},uVig:{value:INV_BG_VIGNETTE},uBokeh:{value:INV_BG_BOKEH}},
    vertexShader:'varying vec2 vP; void main(){ vP=position.xy; gl_Position=vec4(position.xy,1.0,1.0); }',
    fragmentShader:`uniform vec3 uBase; uniform float uTime,uAsp,uK,uGlow,uVig,uBokeh; varying vec2 vP;
float hsh(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
void main(){
  vec2 q=vec2(vP.x*uAsp,vP.y); vec3 c=uBase;
  vec2 d0=q-vec2(0.0,-0.08); c+=(vec3(1.0)-c)*uGlow*exp(-dot(d0,d0)*1.5);                    // a soft glow where he stands
  c*=1.0-uVig*smoothstep(0.6,1.8,length(q));                                                  // darker toward the corners
  for(int i=0;i<2;i++){                                                                       // two layers of big, soft specks drifting up and sideways
    float fi=float(i), sc=5.0+fi*5.0;
    vec2 uv=q*sc+vec2(uTime*0.04*(fi+1.0),-uTime*0.07*(fi+1.0));
    vec2 id=floor(uv), f=fract(uv)-0.5; float h=hsh(id+fi*17.0);
    if(h>0.78){
      vec2 o=(vec2(hsh(id*1.7),hsh(id*2.3))-0.5)*0.6; float r=0.14+0.16*hsh(id*3.1);
      float a=smoothstep(r,r*0.3,length(f-o))*(0.55+0.45*sin(uTime*0.5+h*40.0));
      c+=(vec3(1.0)-c)*uBokeh*a*(1.0-0.3*fi);
    }
  }
  gl_FragColor=vec4(mix(uBase,c,uK),1.0);
}`,depthTest:false,depthWrite:false});
  const m=new THREE.Mesh(new THREE.PlaneGeometry(2,2),mat); m.name='InvBackdrop'; m.frustumCulled=false; m.renderOrder=-1000; m.visible=false; scene.add(m); invBg=m; return m;
}
const INV_BG_PALE=0.30;   // the background is the armor colour mixed this far toward white (0 = the armor colour itself, 1 = white); with no armor colour it is the usual fog colour, lightened by INV_FOG_LIGHT
const _invWhite=new THREE.Color(0xffffff);
const INV_CUST_VIEW=0.85; let invCustK=0;   // INV_CUST_VIEW: on the CUSTOMIZE screen the picture slides right (1 = the menu's usual shift, 0 = centred) so he sits in the free space beside the panel
const INV_ZOOM=0.72, INV_PITCH=0.06, INV_TY=0.08, INV_VIEW=0, INV_FOG_LIGHT=0.4;   // zoom (bigger = further away = smaller on screen), tilt, how high he is looked at (knight-heights above his middle), how far the picture is pushed right (1 = the menu's usual shift; 0 = centred, between the item list on the left and the details on the right)
/* ---------- ITEMS tab: inspecting the potion ----------
   While the POTION is highlighted in the inventory's ITEMS tab the knight plays UAL_Consume (mirrored, see UALX_ConsumeM), holding the bottle in his LEFT hand, and the camera pushes in on that hand.
   The animation is FROZEN at INV_DRINK_FREEZE_T (the hand held out with the bottle). Leaving the item (other tab, other row, CUSTOMIZE, closing the inventory) lets it play on to the end, and then he goes back to idle.
   INV_DRINK_OUT_AT: clip time the bottle appears. INV_DRINK_ZOOM: camera zoom while inspecting (smaller = closer). INV_DRINK_UP: how far above the hand the camera looks (knight-heights). */
const INV_DRINK_FREEZE_T=0.5, INV_DRINK_OUT_AT=0.15, INV_DRINK_ZOOM=0.3, INV_DRINK_UP=0.0;
const invDrink={on:false,release:false,next:null,internal:false,k:0}; const _invHand=new THREE.Vector3();
function invDrinkWant(){ const it=invOn&&!invCust&&INV_TABS[invTab].t==='ITEMS'&&invList()[invCur]; return !!it&&it.icon==='potion'; }
function invDrinkSync(){
  const want=invDrinkWant(), a=actions.UALX_ConsumeM; if(!a) return;
  if(want&&(!invDrink.on||invDrink.release)){   // (re)start: reach for the bottle
    invDrink.on=true; invDrink.release=false; invDrink.next=null; invDrink.internal=true;
    if(current&&current!==a) current.fadeOut(0.12);
    a.reset().setLoop(THREE.LoopOnce,1); a.clampWhenFinished=true; a.timeScale=1; a.paused=false; a.fadeIn(0.12).play(); current=a; invDrink.internal=false;
  } else if(!want&&invDrink.on&&!invDrink.release){ invDrink.release=true; a.paused=false; }   // let it finish
}
function invDrinkStep(){
  if(!invDrink.on) return; const a=actions.UALX_ConsumeM; if(!a){ invDrink.on=false; return; }
  if(!invDrink.release){ if(a.time>=INV_DRINK_FREEZE_T){ a.time=INV_DRINK_FREEZE_T; a.paused=true; } return; }
  if(a.time>=a.getClip().duration-1e-3||!a.isRunning()){   // finished: back to idle (or whatever was asked for meanwhile)
    const nx=invDrink.next; invDrink.on=false; invDrink.release=false; invDrink.next=null; a.paused=false;
    play(nx&&nx!=='Idle'&&nx!=='AxeIdle'?nx:idleName());
  }
}
function invStep(dt){
  if(!invOn&&invK===0) return;
  if(invOn) invHid.forEach(h=>{ h.o.visible=false; });   // (kept hidden every frame, in case something else switches it back on)
  const goal=invOn?1:0; invK+=(goal-invK)*(1-Math.exp(-dt*4)); if(Math.abs(goal-invK)<0.002) invK=goal;
  applyAreaFog(); if(invK>0){ if(armorHex){ _fogB.set(armorHex).lerp(_invWhite,INV_BG_PALE); _fogC.lerp(_fogB,invK); } else { _fogB.setHex(0xffffff); _fogC.lerp(_fogB,INV_FOG_LIGHT*invK); } renderer.setClearColor(_fogC); U.uFogColor.value.copy(_fogC); }
  { const bg=invBackdrop(), u=bg.material.uniforms; bg.visible=invK>0; u.uBase.value.copy(_fogC); u.uTime.value+=dt*INV_BG_DRIFT; u.uAsp.value=innerWidth/innerHeight; u.uK.value=invK; }   // the background layer, over that colour   // the background / fog is lightened while the inventory is open (INV_FOG_LIGHT: 0 = as usual, 1 = white) and settles back as it closes
  if(!invPrev) return;
  const dg=(invDrink.on&&!invDrink.release&&invOn)?1:0; invDrink.k+=(dg-invDrink.k)*(1-Math.exp(-dt*5)); if(Math.abs(dg-invDrink.k)<0.002) invDrink.k=dg;
  zoom=mapLerp(invPrev.zoom,mapLerp(INV_ZOOM,INV_DRINK_ZOOM,invDrink.k),invK); pitch=mapLerp(invPrev.pitch,INV_PITCH,invK);
  target.set(invPrev.tx,mapLerp(invPrev.ty,homeTarget.y+playerH*INV_TY,invK),invPrev.tz);
  if(invDrink.k>0&&potionGrp){ potionGrp.updateWorldMatrix(true,false); potionGrp.getWorldPosition(_invHand); target.lerp(_invHand.setY(_invHand.y+playerH*INV_DRINK_UP),invDrink.k*invK); }   // the camera looks at the hand holding the bottle
  invCustK+=((invCust?1:0)-invCustK)*(1-Math.exp(-dt*6)); if(Math.abs((invCust?1:0)-invCustK)<0.002) invCustK=invCust?1:0;
  mapViewK=mapLerp(1,INV_VIEW+(INV_CUST_VIEW-INV_VIEW)*invCustK,invK); applyView();
  if(!invOn&&invK===0){ invPrev=null; mapViewK=1; applyView(); applyAreaFog(); }
}
/* The inventory is laid out like Elden Ring's: TABS along the top (WEAPONS, ITEMS; Q / E switch them), under them the TYPES inside a tab (WEAPONS: LIGHT / HEAVY; A / D or the left / right arrows switch them),
   the list of what you hold on the left (the equipped one wears an E), and the highlighted item's details on the right. Hovering a weapon shows it on the knight; clicking it (or ENTER) equips it.
   The knight stands between the two columns and wears whatever you equip. To add a weapon, add a row to the WEAPONS tab's items (cls: 'light' or 'heavy'); a new tab or type is one more entry in INV_TABS.
   Light = the one-handed weapons (his 'sword' slot: sword, hatchet, hammer, knightly sword, morningstar); heavy = the two-handed ones (his 'axe' slot: axe, shovel), the ones RENDER needs. */
/* The weapons' inventory icons: the hand-drawn pixel sprites (sword, hammer, hatchet, axe, shovel, knightly sword, morningstar), used as a mask and drawn white (.wico background). Potion keeps its line icon. */
const WEAPON_ICONS={morningstar:'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABHUlEQVR42u3dQQ7CMAxE0bri/lc2R8giJMHx+1sWVfmamVCQiMx8cI7XW0AAASCAAJzh0+heR8e9kAAVBAJswLWdH4PXZx8JhASoIBBgA8p+Dpjt/NHmSIAKAgE2oG6nL7m+BKggAmADtnT27k2RABUEAmzAPRshASoIBNiAOvzbs6KQABUEAmxA2XN/rri+BKggAmADjpz7V3+f4HdBKggE2IB7Oz8kQAWBABtQpvNnOzwlQAWBABtQtvNnCQlQQSDABrTpfAlQQSDABuh8CVBBIMAG6HwJIAAE2ACdLwEEgAAboPMlgAAQ0HkDdL4EEAAC+myAzpcAAkBAnw3Q+RJAAAjouwE/+Z8sSAABIKDkBjjnSwABIIAAEHAvX8T8JuVY5gM5AAAAAElFTkSuQmCC',sword:'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABBElEQVR42u3dMQ6DMBQEURZx/yubjobKsrAt/ps2VIx2V4YoSWvtwDpOt4AAAkAAASCAABBAAAggAAQQgDlcbsHD6GPhSIAKAgE2oEznS4AKAgE2QOdLgAoCATZA50uACgIBNqBO50cCVBAIsAE6XwJUEAiwATpfAlQQCLABOl8CVBAIsAGvDk/n9b/sfAlQQSCg6Dlg9fd0IgEggAAs2wCdLwEEgIA6G5DJ54BIAAggAGXOAZEAEEAAtt0Af80hAQSAgP9uwNe/s9k6P/csCAQQgH3OAb2dP3q9BIAAAjBvA2a/85UAEEAA9j0HxO2UAAJAAAEggAAQQAAIIAAEEAACtuUGwxcU4mvj/+cAAAAASUVORK5CYII=',hammer:'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABOElEQVR42u3cUY4CMQwEUYy4/5XDEVBmmDiOX/2jRZS6O2FWxBjjhTzePgICCAABBCCHT+H3Pnt8CwkAAQSg7AaMP78+JAAEEGADju18CQABBKDOBozkvxcSoIJAgA1oe85P2QQJUEEEoMkGVPtuZ8kmSIAKIgBN7wHVeGQTJEAFEYAmGxA37wV3X7/6XhMSoIJAgA243JGzHVvy+YIEqCAC0HQDnt4ICQABBKDuBtzt/N3vCRJAAAiwAc91fvYmeB6ggkCADcjr/NXn/pAAFQQCbEBa568+9/vfUBUEAmzAPp2/5TlfAlQQCGi6Abt1/uy9wG9FqCAQYAPOPef77WgQQIAN6NP5EgACCMD1DdD5EkAACOizATpfAggAAX034NczVJ0vAQSAgHM3wDlfAggAAQSAgHP5AmddJeo9S1zUAAAAAElFTkSuQmCC',hatchet:'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABCUlEQVR42u3aOw6AMBADURZx/yuHjoIGUSTZZN9cAImR7fCJ1tqBeZxuAQEEgAACQAABIIAAEEAACCAAY7jcgof3a+GQABUEAmxAmc6fsgkSoIIIgA1I0fmH5wAVBAJsQNnOn7IZEqCCCIANSNH5va8fEqCCQIAN2KbzJYAAEGADdP6vc78EqCAQYAO6dH4M3oyQABUEAmxAms6XABBAANbZgOyd799QFQQCbMC6nT/63ZAEqCAQYAOc8yVABYGAihug8yVABYGAOhtQ8huuBBAAAopugM6XAAJAQJ0N0PkSQAAIqLsBX//V6HwJIAAE7LsBzvkSQAAIIAAEEAACCAABBIAAAkDAPtzVmxnigXWK9wAAAABJRU5ErkJggg==',axe:'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABIElEQVR42u3cQQ4CIRQEUb7x/lfGvZuJIwGGfnUAxVS6e4jR6r23w/j+QLXzYV8NBBCAZbwP7PxHbYIEEEAAbMDQzpcAEEAAztmALgEggADEbECf/PolASoIBNgAz/kSQAAIsAFxnX91npIAFQQCCAABBIAA94C/qc3vBVPvCRKggghA2AYM7dAbnd0Wv19JgAoCATbgsZ0/9LwSoIIIgA2Y99y9wWa4B6ggEGAD5nX+akoCVBAIsAE6XwJUEAiwAdmdLwEqCASEb0B050uACgIBYRuwW+f/+h2x3wmrIBBgA859zvefcSoIBNiAnM6XABBAAO5vgM6XAAJAQM4G6HwJIAAE5GyAzpcAAkBAzgbofAkgAAS4B+h8CSAABGTxAY11IejrAp6aAAAAAElFTkSuQmCC',shovel:'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABA0lEQVR42u3dyxGEQAwDUUyRf8pDCD7AfP06BLokrS+z0Vq7MI/bJyCAABBAAAggAON5fIKUr4dSSIAKAgE2oEznS4AKAgE2QOdLgAoCATZA50uACgIBNmAdovMmhASoIBBgA8rcASEBKggE2IBjOj+7E0ICVBAIsAHHdv6vv/MlQAWBABuwVedLgAoCATZA50uACgIBNkDnS4AKAgE2QOdLgAoCATZA50sAASDABuh8CSAABNgAnS8BBIAAG6DzJYAAEHDiBiz1toIEgAACMPUOyDq869sKEgACCMDQDRj6fo4EgAACsNUd4E/pJYAAEFBnA7JNgAQQAAIIAAEEgIC1eQHgGxjpFjHEqgAAAABJRU5ErkJggg==',knightly:'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABL0lEQVR42u3cO47DMBAEUY+h+1+ZzpwKI1IjknqV7idQobsp7sLRWvvgOb4eAQEEgAACQAABIIAAEEAACCAANRwewZ/ea+GQABUEAmzAazpfAlQQCLAB63Z+dP68BKggEGAD1u38s04PCVBBIMAGLNv5d5/jQwJUEAiwAdOe80e/J4QEqCAQYAOm7fzeu52SzpcAFQQCbMClzs9+PUtIgAoCATag7Nw++hw+xd2OBKggEGADLp3bt7jbkQAVBAJswC0bkSUkAAQQgMc2IHsX0wb/PgkAAQRgnfeAs47fovMlgAAQ8JINqP6/HgkAAQSgbgPu/pzN7Ia4CwIBBGCe94Bs5/d+vwSAAAJQtwHZv+lCAggAAfu+B4THKQEEgAACQAABIIAAEEAACCAABEzLDzOOJt5DbWGaAAAAAElFTkSuQmCC'};
(function(){ const st=document.createElement('style'); st.textContent='.wico{display:block;width:100%;height:100%;background:#fff;-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat;image-rendering:pixelated}'; document.head.appendChild(st); })();
const INV_ICONS={
  sword:'<path d="M19 5 L8 16 M5 13 L11 19 M8 16 L4 20"/>',
  knightly:'<path d="M19 5 L8 16 M5 13 L11 19 M8 16 L4 20"/><path d="M15 8 l1.5 1.5 -1.5 1.5 -1.5 -1.5 z"/>',
  hatchet:'<path d="M6 20 L15 7"/><path d="M12 5 L19 8 L16 14 Z"/>',
  morningstar:'<path d="M5 20 L14 10"/><circle cx="16" cy="8" r="4"/>',
  hammer:'<path d="M5 20 L14 10"/><path d="M12 4 L20 12 L17 15 L9 7 Z"/>',
  axe:'<path d="M5 20 L16 4"/><path d="M11 3 L21 8 L17 13 Z"/><path d="M9 10 L3 13 L7 16 Z"/>',
  shovel:'<path d="M5 4 L15 14"/><path d="M13 12 L19 18 L16 21 L10 15 Z"/><path d="M3 6 L7 2"/>',
  potion:'<path d="M9 3 H15 M10 3 V8 L5.5 17 A2 2 0 0 0 7.5 20 H16.5 A2 2 0 0 0 18.5 17 L14 8 V3"/><path d="M8.5 14 H15.5"/>'
};
function invIcon(k){ if(WEAPON_ICONS[k]) return '<span class="wico" style="--m:url(data:image/png;base64,'+WEAPON_ICONS[k]+')"></span>'; return '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">'+(INV_ICONS[k]||'')+'</svg>'; }
const invLightStats=()=>[['DAMAGE',''+SWING_DAMAGE],['GRIP','ONE-HANDED'],['SWING','SWING'],['SPECIAL','NONE']];
const invHeavyStats=()=>[['DAMAGE',''+SWING_DAMAGE],['GRIP','TWO-HANDED'],['SWING','AXE SWING'],['SPECIAL','RENDER ('+RENDER_DAMAGE+' TO ALL)']];
/* A weapon row says which weapon slot it fills (w: 'sword' = light, 'axe' = heavy) and which style (ss: swordStyle, or as: axeStyle). */
const INV_TABS=[
  {t:'WEAPONS',subs:[{t:'LIGHT',cls:'light'},{t:'HEAVY',cls:'heavy'}],items:[
    {t:'SWORD',cls:'light',icon:'sword',kind:'LIGHT WEAPON',w:'sword',ss:'sword',stats:invLightStats,desc:'A plain, balanced blade. Quick to swing and easy to trust.'},
    {t:'HATCHET',cls:'light',icon:'hatchet',kind:'LIGHT WEAPON',w:'sword',ss:'hatchet',stats:invLightStats,desc:'A woodcutter\'s hatchet on a short haft. Light enough to swing all day.'},
    {t:'HAMMER',cls:'light',icon:'hammer',kind:'LIGHT WEAPON',w:'sword',ss:'hammer',stats:invLightStats,desc:'A blunt hammer. It lands with a thud instead of a slash.'},
    {t:'KNIGHTLY SWORD',cls:'light',icon:'knightly',kind:'LIGHT WEAPON',w:'sword',ss:'knightly',stats:invLightStats,desc:'A knight\'s sword with gems set in the blade. Its swing leaves a trail of every colour.'},
    {t:'MORNINGSTAR',cls:'light',icon:'morningstar',kind:'LIGHT WEAPON',w:'sword',ss:'morningstar',stats:invLightStats,desc:'A spiked iron ball on a long haft. It does not cut so much as make an argument.'},
    {t:'AXE',cls:'heavy',icon:'axe',kind:'HEAVY WEAPON',w:'axe',as:'axe',stats:invHeavyStats,desc:'A two-handed axe. It takes both hands to bring around, and it is the kind of weapon that can RENDER.'},
    {t:'SHOVEL',cls:'heavy',icon:'shovel',kind:'HEAVY WEAPON',w:'axe',as:'shovel',stats:invHeavyStats,desc:'A digger\'s shovel put to work as a weapon. It swings like the axe and can RENDER too.'}]},
  {t:'ITEMS',subs:null,items:[
    {t:'POTION',icon:'potion',kind:'CONSUMABLE',qty:()=>'x'+POTION_COUNT,stats:()=>[['HEALS',POTION_HEAL+' HP'],['STOCK',POTION_COUNT+' PER BATTLE']],desc:'A small flask of healing draught. Drink it from the ITEMS menu in battle.'}]}
];
/* HOVER shows a weapon on the knight, CLICK (or ENTER) equips it. invCommit is what he really has equipped (what the E badge marks, and what he goes back to when the inventory closes or the cursor
   rests on something that is not a weapon); whatever is highlighted is only previewed on him. */
let invTab=0, invSub=[0,0], invCurs={}, invCommit={w:'sword',ss:'sword',as:'axe'};
const invIsEq=it=>!!it.w&&invCommit.w===it.w&&(it.ss?invCommit.ss===it.ss:invCommit.as===it.as);
function invApply(c){   // put this weapon on him (skipped when he already has it)
  if(weapon===c.w&&swordStyle===c.ss&&axeStyle===c.as) return;
  swordStyle=c.ss; axeStyle=c.as; setWeapon(c.w); if(c.w==='axe') showWeapons(); refreshAnim();
}
function invPreview(){ const it=invList()[invCur]; invApply(it&&it.w?{w:it.w,ss:it.ss||invCommit.ss,as:it.as||invCommit.as}:invCommit); }
function invList(){ const T=INV_TABS[invTab]; return T.subs?T.items.filter(i=>i.cls===T.subs[invSub[invTab]].cls):T.items; }
function invKey(){ return invTab+':'+invSub[invTab]; }
function invResetState(){   // opening: the WEAPONS tab, on the type he is holding, with the equipped weapon highlighted (as Elden Ring does)
  invCommit={w:weapon,ss:swordStyle,as:axeStyle};
  invTab=0; invSub=[weapon==='axe'?1:0,0]; invCurs={}; invCur=0;
  const i=invList().findIndex(it=>invIsEq(it)); if(i>=0) invCur=i;
}
function invGoto(tab,sub,sound){   // switch tab / type, remembering where the cursor was in the one we leave
  invCurs[invKey()]=invCur;
  if(tab!==undefined) invTab=((tab%INV_TABS.length)+INV_TABS.length)%INV_TABS.length;
  const T=INV_TABS[invTab]; if(sub!==undefined&&T.subs) invSub[invTab]=((sub%T.subs.length)+T.subs.length)%T.subs.length;
  invCur=Math.min(invCurs[invKey()]||0,invList().length-1); if(sound) blip(620,0.06); invPreview(); invRefresh();
}
function invRefresh(){
  if(!invUi) return;
  const T=INV_TABS[invTab], L=invList(); if(invCur>=L.length) invCur=Math.max(0,L.length-1);
  invUi.querySelector('#inv-tabs').innerHTML='<span class="ik">Q</span>'+INV_TABS.map((t,i)=>'<button type="button" class="it'+(i===invTab?' on':'')+'" data-tab="'+i+'">'+t.t+'</button>').join('')+'<span class="ik">E</span>';
  invUi.querySelector('#inv-subs').innerHTML=T.subs?('<span class="ik">A</span>'+T.subs.map((t,i)=>'<button type="button" class="is'+(i===invSub[invTab]?' on':'')+'" data-sub="'+i+'">'+t.t+'</button>').join('')+'<span class="ik">D</span>'):'<span class="ih">'+T.t+'</span>';
  const list=invUi.querySelector('#inv-list');
  list.innerHTML=L.map((it,i)=>'<button type="button" class="ir'+(i===invCur?' on':'')+'" data-i="'+i+'"><span class="ii">'+invIcon(it.icon)+'</span><span class="in">'+it.t+'</span><span class="iv">'+(it.w?(invIsEq(it)?'<b class="eb">E</b>':''):(it.qty?it.qty():''))+'</span></button>').join('');
  invUi.querySelector('#inv-count').textContent=(T.subs?T.subs[invSub[invTab]].t+' ':'')+L.length;
  invDetail(); invSpinLabel();
}
function invSpinLabel(){ if(invUi) invUi.querySelector('#inv-spin').textContent='TURNTABLE: '+(spin?'ON':'OFF'); }
function invDetail(){
  invDrinkSync();
  const it=invList()[invCur], box=invUi.querySelector('#inv-det'); if(!it){ box.innerHTML=''; return; }
  box.innerHTML='<div class="ib">'+invIcon(it.icon)+'</div><div class="idn">'+it.t+'</div><div class="idt">'+it.kind+(invIsEq(it)?'<b class="eb">E</b>':'')+'</div>'
    +it.stats().map(r=>'<div class="idr"><span>'+r[0]+'</span><span>'+r[1]+'</span></div>').join('')+'<div class="idd">'+it.desc+'</div>';
}
function invSelect(i,sound){   // the cursor / pointer is on a row: highlight it and show that weapon on the knight
  const L=invList(); if(!L.length) return; i=((i%L.length)+L.length)%L.length; if(i===invCur) return; invCur=i; if(sound) blip(520,0.05);
  [...invUi.querySelectorAll('#inv-list .ir')].forEach((b,k)=>b.classList.toggle('on',k===invCur));
  const row=invUi.querySelector('#inv-list .ir.on'); if(row&&row.scrollIntoView) row.scrollIntoView({block:'nearest'});
  invDetail(); invPreview();
}
function invActivate(){   // ENTER / click: equip the highlighted weapon
  const it=invList()[invCur]; if(!it) return;
  if(!it.w||invIsEq(it)){ blip(300,0.05); return; }
  invPreview(); invCommit.w=it.w; if(it.ss) invCommit.ss=it.ss; else invCommit.as=it.as;
  blip(880,0.09); invRefresh();
}
function invBuild(){
  if(invUi) return;
  const st=document.createElement('style'); st.textContent=`
#invui{position:fixed;left:3vw;right:3vw;top:4vh;bottom:4vh;display:grid;grid-template-columns:minmax(0,min(31vw,430px)) minmax(0,1fr) minmax(0,min(30vw,420px));grid-template-rows:auto minmax(0,1fr) auto;gap:12px;font-size:min(26px,3.8vh);letter-spacing:.12em;color:var(--ui-text);text-shadow:3px 3px 0 #000;opacity:0;transition:opacity .6s;pointer-events:none;z-index:15}
#invui.on{opacity:1}#invui.on>*{pointer-events:auto}
#invui .ip{box-sizing:border-box;border:3px solid var(--ui-edge);background:var(--ui-panel);box-shadow:0 0 0 3px #000,inset 0 0 0 3px rgba(0,0,0,.35)}
#invui button{font:inherit;letter-spacing:inherit;color:inherit;text-shadow:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:left}
#invtop{grid-column:1/4;display:flex;align-items:center;gap:16px;padding:6px 16px}
#invtop .ttl{flex:0 0 auto}#invtop #inv-spin{margin-left:auto}#inv-tabs{flex:1;display:flex;justify-content:center;align-items:center;gap:8px}
#invui .ik{display:inline-block;min-width:1.3em;text-align:center;font-size:.7em;padding:0 4px;border:2px solid var(--ui-edge);background:rgba(0,0,0,.4);color:var(--ui-dim)}
#invui .it{padding:2px 22px;border:2px solid transparent;color:var(--ui-dim)}#invui .it.on{color:#fff;border-color:var(--ui-edge);background:var(--ui-hi)}
#inv-cust,#inv-spin{font-size:.62em!important;padding:2px 10px!important;border:2px solid var(--ui-edge)!important;background:rgba(0,0,0,.35)!important;letter-spacing:.1em!important;flex:0 0 auto}#inv-tabs{margin-left:0}
#invleft{grid-column:1;grid-row:2;display:flex;flex-direction:column;position:relative;padding:9px;min-height:0}
#inv-subs{display:flex;align-items:center;gap:6px;padding-bottom:6px;margin-bottom:6px;border-bottom:2px solid var(--ui-edge)}
#invui .is{padding:0 14px;border:2px solid transparent;color:var(--ui-dim)}#invui .is.on{color:#fff;border-color:var(--ui-edge);background:var(--ui-hi)}#invui .ih{padding:0 6px}
#inv-list{flex:1;min-height:0;overflow-y:auto;position:relative;scrollbar-width:thin;scrollbar-color:var(--ui-edge) transparent}
#invui .ir{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;padding:3px 7px;border:2px solid transparent}
#invui .ir.on{background:var(--ui-hi);border-color:var(--ui-edge);color:#fff}
#invui .ii{flex:0 0 auto;width:1.35em;height:1.35em;padding:3px;box-sizing:border-box;border:2px solid var(--ui-edge);background:rgba(0,0,0,.4)}
#invui .in{flex:1;white-space:nowrap}#invui .iv{flex:0 0 auto}
#invui .eb{display:inline-block;margin-left:8px;min-width:1.2em;text-align:center;font-size:.75em;line-height:1.2;border:2px solid #ffe27a;color:#ffe27a;background:rgba(0,0,0,.45);font-weight:normal}
#inv-count{padding-top:6px;margin-top:6px;border-top:2px solid var(--ui-edge);font-size:.7em;color:var(--ui-dim);text-align:right}
#invright{grid-column:3;grid-row:2;align-self:start;max-height:100%;overflow:auto;padding:14px;scrollbar-width:thin;scrollbar-color:var(--ui-edge) transparent}
#invui .ib{width:min(110px,16vh);height:min(110px,16vh);margin:0 auto 10px;padding:12px;box-sizing:border-box;border:2px solid var(--ui-edge);background:rgba(0,0,0,.4)}
#invui .idn{font-size:1.25em;text-align:center;color:#fff}#invui .idt{text-align:center;font-size:.7em;color:var(--ui-dim);padding-bottom:8px;margin-bottom:8px;border-bottom:2px solid var(--ui-edge)}
#invui .idr{display:flex;justify-content:space-between;gap:12px;font-size:.8em;padding:2px 0}#invui .idr span:last-child{color:#fff;text-align:right}
#invui .idd{font-size:.75em;line-height:1.25;margin-top:10px;padding-top:8px;border-top:2px solid var(--ui-edge);letter-spacing:.06em;color:var(--ui-text2)}
#invhint{grid-column:1/4;display:flex;justify-content:center;gap:2.2em;flex-wrap:wrap;padding:4px 14px;font-size:.62em;color:var(--ui-dim)}
@media (max-aspect-ratio:9/10){#invui{grid-template-columns:1fr;grid-template-rows:auto minmax(0,40vh) auto;bottom:auto;gap:8px;font-size:min(22px,3.4vh)}#invtop{grid-column:1;flex-wrap:wrap;gap:8px}#invtop .ttl{display:none}#invleft{grid-column:1}#invright,#invhint{display:none}}`;
  document.head.appendChild(st);
  invUi=document.createElement('div'); invUi.id='invui';
  invUi.innerHTML='<div id="invtop" class="ip"><span class="ttl">INVENTORY</span><div id="inv-tabs"></div><button type="button" id="inv-spin">TURNTABLE: OFF</button><button type="button" id="inv-cust">CUSTOMIZE</button></div>'
    +'<div id="invleft" class="ip"><div id="inv-subs"></div><div id="inv-list"></div><div id="inv-count"></div></div>'
    +'<div id="invright" class="ip"><div id="inv-det"></div></div>'
    +'<div id="invhint" class="ip"><span>Q / E: TABS</span><span>A / D: TYPE</span><span>W / S: SELECT</span><span>ENTER / CLICK: EQUIP</span><span>T: TURNTABLE</span><span>C: CUSTOMIZE</span><span>ESC: BACK</span></div>';
  invUi.addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b||!invUi.contains(b)) return;
    if(b.id==='inv-cust'){ blip(880,0.09); invShowCust(); }
    else if(b.id==='inv-spin'){ blip(620,0.06); toggleSpin(); invSpinLabel(); }
    else if(b.dataset.tab!==undefined) invGoto(+b.dataset.tab,undefined,true);
    else if(b.dataset.sub!==undefined) invGoto(undefined,+b.dataset.sub,true);
    else if(b.dataset.i!==undefined){ invSelect(+b.dataset.i,false); invActivate(); }
  });
  invUi.addEventListener('mouseover',e=>{   // the pointer highlights what it is over, as the arrow keys do
    const b=e.target.closest('button'); if(!b) return;
    if(b.dataset.i!==undefined) invSelect(+b.dataset.i,true);
  });
  document.body.appendChild(invUi);
}
function invShowCust(){ invApply(invCommit); invCust=true; invDrinkSync(); invUi.classList.remove('on'); document.body.classList.remove('map'); invGoMenu('custom'); }   // the customize window takes the inventory's place, same camera
function invShowInv(){ invCust=false; invGoMenu('main'); document.body.classList.add('map'); invUi.classList.add('on'); invPreview(); invRefresh(); }
function openInventory(){
  if(invOn||exploring||mapMode) return;
  invPrev={zoom:zoom,pitch:pitch,tx:target.x,ty:target.y,tz:target.z,spin:spin,night:night,clip:current?current.getClip().name:null}; invOn=true; if(night) setNight(false);   // the inventory is always shown by day (and the time goes back to what it was when it closes)
  invResetState();
  if(spin) toggleSpin();   // the turntable stays off
  invHid=scene.children.filter(o=>o!==playerRig&&o!==invBg&&o!==sparkle).map(o=>({o:o,v:o.visible})); if(rockMesh) invHid.push({o:rockMesh,v:rockMesh.visible});   // everything but the knight goes
  play(idleName());        // his proper idle (the axe's with the axe)
  document.body.classList.add('map');   // the menu window steps aside, as it does for the map
  invBuild(); invRefresh(); requestAnimationFrame(()=>invUi.classList.add('on'));
}
function closeInventory(){
  if(!invOn) return;
  invOn=false; invDrinkSync(); invOn=true;   // a potion inspection plays out first (play() below is queued until it ends)
  invApply(invCommit);   // a weapon that was only previewed goes back to the one he really has equipped
  invOn=false; invCust=false; invUi.classList.remove('on'); if(invPrev&&invPrev.night!==undefined&&invPrev.night!==night) setNight(invPrev.night);
  if(invPrev&&invPrev.spin!==spin) toggleSpin();   // the turntable goes back to how it was before the inventory
  invHid.forEach(h=>{ h.o.visible=h.v; }); invHid=[]; if(invPrev&&invPrev.clip&&actions[invPrev.clip]) play(invPrev.clip);   // the world comes back and he returns to the pose he was in
  document.body.classList.remove('map');
}
addEventListener('keydown',e=>{
  if(!invOn||invCust) return; const k=e.key;
  e.stopImmediatePropagation();   // this key is the inventory's alone: otherwise, once it closes the inventory, the main menu's own handler sees the same key press (Escape = back to the START SCREEN, Enter = a menu item)
  if(k==='c'||k==='C'){ e.preventDefault(); invShowCust(); return; }
  if(k==='t'||k==='T'){ e.preventDefault(); blip(620,0.06); toggleSpin(); invSpinLabel(); return; }
  if(k==='Escape'||k==='Backspace'){ e.preventDefault(); blip(300,0.08); closeInventory(); }
  else if(k==='q'||k==='Q'||k==='PageUp'){ e.preventDefault(); invGoto(invTab-1,undefined,true); }       // tabs
  else if(k==='e'||k==='E'||k==='PageDown'||k==='Tab'){ e.preventDefault(); invGoto(invTab+1,undefined,true); }
  else if(k==='ArrowLeft'||k==='a'||k==='A'){ e.preventDefault(); if(INV_TABS[invTab].subs) invGoto(undefined,invSub[invTab]-1,true); }   // types within the tab
  else if(k==='ArrowRight'||k==='d'||k==='D'){ e.preventDefault(); if(INV_TABS[invTab].subs) invGoto(undefined,invSub[invTab]+1,true); }
  else if(k==='ArrowDown'||k==='s'||k==='S'){ e.preventDefault(); invSelect(invCur+1,true); }
  else if(k==='ArrowUp'||k==='w'||k==='W'){ e.preventDefault(); invSelect(invCur-1,true); }
  else if(k==='Enter'||k===' '){ e.preventDefault(); invActivate(); }
});
/* ---------- EDIT: a phonk edit ----------
   ANIMATIONS > EDIT turns the screen into a car-edit style video: everything but the knight is hidden, he is pitch black (armor and plume at their darkest) with no weapon, and he cuts between six poses
   ON THE BEAT of the song (SUA CAVALONA, hardstyle remix, started at 0:57 and looped from there) while the camera whips round him: every beat a new shot (low angles, close-ups, high angles, tilted ones),
   a fast sharp turn, a zoom punch and a shake, with a white flash on the first beat of every bar and a hard flicker on the drop. ESC (or a tap) leaves.
   The song's beat: its drop (the first big hit) is at 57.844 s and the beat is 0.4488 s (133.7 BPM) from there. Everything is driven from the song's own clock, so it cannot drift. */
const EDIT_START=57.0, EDIT_FIRST=57.844, EDIT_PERIOD=0.4488, EDIT_LEAD=0.035, EDIT_GAIN=0.9;   // EDIT_LEAD: the picture is changed a hair before the beat (the sound reaches the ear a little later than the frame is drawn)
const EDIT_BG=['#ececec','#d3121f'];   // the background: light, then red, a new one every bar
const EDIT_SHOTS=[   // camera shots: zoom (bigger = further), pitch (negative = from below), height he is looked at (fraction of his height from the middle), roll (tilt)
  {z:0.85,p:-0.18,y:0.00,r:0},{z:0.50,p:0.03,y:0.30,r:0},{z:0.60,p:0.08,y:0.10,r:0},{z:0.80,p:0.60,y:-0.05,r:0},{z:0.58,p:-0.25,y:-0.30,r:0},
  {z:0.62,p:0.04,y:0.05,r:0.22},{z:0.62,p:0.04,y:0.05,r:-0.22},{z:1.05,p:0.00,y:0.00,r:0},{z:0.58,p:0.10,y:0.12,r:0.30}];
const EDIT_POSE_Y=[0,0,-0.18,-0.08,0,-0.42,0];   // per pose: look lower at the crouch, the dance and (a lot) the pose lying down
let editBusy=false, editBuf=null, editLoading=null, editSrc=null, editGain=null, editT0=0, editPrev=null, editHid=[], editBeat0=-99, editBag=[], editPoseLast=-1, editPoseNow=0, editShotLast=-1;
let editVisor=0, editRollGoal=0, editYawGoal=0, editDir=1, editPitchGoal=0, editZoomGoal=1, editYGoal=0, editPunch=0, editShake=0, editFlash=0, editInvert=0, editBlur=0, editBg=0, editFx=null, editExitOk=0;
const _edC=new THREE.Color();
function editLoad(){
  if(editBuf) return Promise.resolve(editBuf); if(editLoading) return editLoading;
  const t=atob(document.getElementById('edit-song-data').textContent.trim()), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i);
  return editLoading=new Promise((res,rej)=>sfx.decodeAudioData(u.buffer,res,rej)).then(b=>{ editBuf=b; return b; });
}
function editVisorSet(v){   // the helmet's materials (every helmet set, never the plume): the black visor texels flash white by v (0..1)
  helmetSets.forEach(set=>set.forEach(m=>{ const u=m.material&&m.material.uniforms; if(u&&u.uBlackFlash&&!/plume/i.test(m.name||'')) u.uBlackFlash.value=v; }));
}
function editBlack(on){   // the armor: every armor material's tint pulled to (nearly) black; the plume: its darkest colour
  armorMats.forEach((m,i)=>{ const v=m.uniforms.uTint.value; if(on) v.set(0.035,0.035,0.04); else if(editPrev&&editPrev.tints[i]) v.copy(editPrev.tints[i]); });
  tintPlume(on?'#000000':(editPrev?editPrev.plume:null));
}
function editPoseNext(){   // the next of the poses (EDIT_POSE_N of them), from a shuffled bag so none repeats until all have played
  if(!editBag.length){ editBag=[]; for(let i=0;i<EDIT_POSE_N;i++) editBag.push(i); for(let i=EDIT_POSE_N-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [editBag[i],editBag[j]]=[editBag[j],editBag[i]]; }
    if(editBag[editBag.length-1]===editPoseLast){ const j=Math.floor(Math.random()*(editBag.length-1)); [editBag[editBag.length-1],editBag[j]]=[editBag[j],editBag[editBag.length-1]]; } }
  editPoseLast=editPoseNow=editBag.pop();
  const a=actions['UALX_EditPose'+(editPoseNow+1)]; if(!a) return;
  a.reset().setEffectiveWeight(1).setLoop(THREE.LoopRepeat,Infinity).play();   // a hard cut: the new pose starts BEFORE the old one stops (else one frame shows the bind pose)
  Object.keys(actions).forEach(k=>{ if(actions[k]!==a&&actions[k].isRunning()) actions[k].stop(); }); if(current&&current!==a) current.stop();
  current=a; mixer.update(0);
}
/* The 7th pose (Walk3 from the Blockbench file: the dislocated idle). It lasts two beats: on the first he holds the sword in his hand; it then shoots up his arm, so fast that it lands on his face exactly on the next beat,
   where the visor flashes and the RDR2 low-honor sting hits (its loudest part, EDIT_SWORD_PEAK s into the file, is put on that beat). edSw.st: 0 = no sword, 1 = in his hand / flying, 2 = landed on his face. */
const EDIT_POSE_N=6, EDIT_SWORD_POSE=-1, EDIT_SWORD_FLY=0.09, EDIT_SWORD_GAIN=1.0, EDIT_SWORD_PEAK=0.16;
const EDIT_SWORD_FACE=[0,0.15,0.36], EDIT_SWORD_CY=1.1;   // where the middle of the blade lands (in the head's own space: just in front of the visor), and where the middle of the blade is along the sword's own axis
const edSw={st:0,grp:null,fore:null,head:null,shoulder:null,p0:null,q0:null,s0:null,snd:false};
const _e1=new THREE.Vector3(),_e2=new THREE.Vector3(),_e3=new THREE.Vector3(),_e4=new THREE.Vector3(),_eq1=new THREE.Quaternion(),_eq2=new THREE.Quaternion(),_eq3=new THREE.Quaternion(),_em1=new THREE.Matrix4(),_em2=new THREE.Matrix4(),_es=new THREE.Vector3(),_eqz=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2);
function editSwordGroup(){ return swordStyle==='hatchet'?hatchetGrp:swordStyle==='hammer'?hammerGrp:swordStyle==='knightly'?knightlyGrp:swordStyle==='morningstar'?morningstarGrp:swordGrp; }
function editSwordBegin(){
  const grp=editSwordGroup(); if(!grp||!grp.parent||!playerRig) return;
  edSw.grp=grp; edSw.fore=grp.parent; edSw.head=playerRig.getObjectByName('Head'); edSw.shoulder=playerRig.getObjectByName(SWORD_HAND+'_Arm')||grp.parent;
  if(!edSw.head) { edSw.grp=null; return; }
  edSw.p0=grp.position.clone(); edSw.q0=grp.quaternion.clone(); edSw.s0=grp.scale.clone(); edSw.st=1; edSw.snd=false; grp.visible=true;
  loadSfxSet('honor-sfx-data');
}
function editSwordEnd(){   // back into his hand, out of sight again (EDIT shows no weapon)
  const g=edSw.grp; if(g){ g.position.copy(edSw.p0); g.quaternion.copy(edSw.q0); g.scale.copy(edSw.s0); g.visible=false; }
  edSw.grp=null; edSw.st=0; edSw.snd=false;
}
function editSwordStep(ph){   // ph: how far through the beat we are (0..1)
  if(!edSw.st||!edSw.grp) return;
  const P=EDIT_PERIOD, fly=EDIT_SWORD_FLY/P;
  if(edSw.st===1&&!edSw.snd&&ph>=0.5){   // the sting is scheduled ahead, so its loudest part sits on the next beat (the picture changes EDIT_LEAD before the beat is heard)
    edSw.snd=true; playSfxSetTracked('honor-sfx-data',0,EDIT_SWORD_GAIN,1,Math.max(0,(1-ph)*P+EDIT_LEAD-EDIT_SWORD_PEAK));
  }
  const u=edSw.st===1?Math.max(0,Math.min(1,(ph-(1-fly))/fly)):1, grp=edSw.grp, fore=edSw.fore;
  playerRig.updateMatrixWorld(true);
  const Wf=fore.matrixWorld, cy=EDIT_SWORD_CY;
  _em1.compose(edSw.p0,edSw.q0,edSw.s0).premultiply(Wf);                       // the sword where it is in his hand, in the world
  _em1.decompose(_e1,_eq1,_es);                                                  // _e1 origin, _eq1 turn, _es scale
  const sc=_es.y, C0=_e2.set(0,cy,0).multiplyScalar(sc).applyQuaternion(_eq1).add(_e1).clone();   // the middle of the blade, in his hand
  const C1=edSw.shoulder.getWorldPosition(new THREE.Vector3());                  // up the arm: his shoulder
  const C2=edSw.head.localToWorld(_e3.set(EDIT_SWORD_FACE[0],EDIT_SWORD_FACE[1],EDIT_SWORD_FACE[2]));   // and on to his face
  edSw.head.getWorldQuaternion(_eq2); _eq2.multiply(_eqz);                       // blade across the face, flat against it, hilt on the sword-arm side
  const L1=C0.distanceTo(C1), L2=C1.distanceTo(C2), d=u*u*(L1+L2);               // speeds up all the way: it hits at full speed
  const C=_e4; if(d<=L1) C.lerpVectors(C0,C1,L1>0?d/L1:1); else C.lerpVectors(C1,C2,L2>0?(d-L1)/L2:1);
  const q=_eq3.copy(_eq1).slerp(_eq2,Math.min(1,u*1.15));
  const org=_e1.set(0,cy,0).multiplyScalar(sc).applyQuaternion(q).negate().add(C);
  _em2.compose(org,q,_es).premultiply(_em1.copy(Wf).invert()).decompose(grp.position,grp.quaternion,grp.scale);
}
function editOnBeat(idx){
  const bar=((idx%4)+4)%4, drop=idx===0;
  let land=false;
  if(edSw.st===1){ edSw.st=2; land=true; }   // the second beat of the sword pose: the pose is held, the sword has just landed
  else { editSwordEnd(); editPoseNext(); if(editPoseNow===EDIT_SWORD_POSE) editSwordBegin(); }
  let k; do{ k=Math.floor(Math.random()*EDIT_SHOTS.length); }while(k===editShotLast); if(drop||land) k=1; editShotLast=k;   // the landing is a close-up, like the drop   // the drop is always the close-up
  const sh=EDIT_SHOTS[k]; editZoomGoal=sh.z; editPitchGoal=sh.p; editYGoal=sh.y+EDIT_POSE_Y[editPoseNow]; editRollGoal=sh.r;
  editDir=Math.random()<0.5?-1:1; editYawGoal+=editDir*(0.9+Math.random()*1.5)*(bar===0?1.4:1);   // the sharp turn: a big jump round him
  editPunch=1; editShake=bar===0?1:0.45; editBlur=1; editVisor=1;   // editVisor: the visor flashes white on every beat (it only shows when his face is turned to the camera)
  if(bar===0){ editFlash=0.85; editBg=(editBg+1)%EDIT_BG.length; }
  if(land){ editFlash=Math.max(editFlash,0.9); editShake=Math.max(editShake,1.6); }
  if(drop){ editFlash=1; editInvert=0.14; editShake=2.2; }
  else if(bar===0&&((idx%8)+8)%8===0) editInvert=0.07;
}
function editFxBuild(){
  if(editFx) return;
  const st=document.createElement('style'); st.textContent='#editfx{position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden}#editfx div{position:absolute}'
    +'#editfx .ebt,#editfx .ebb{left:0;right:0;height:9vh;background:#000;transition:transform .5s cubic-bezier(.2,.7,.2,1)}#editfx .ebt{top:0;transform:translateY(-100%)}#editfx .ebb{bottom:0;transform:translateY(100%)}#editfx.on .ebt,#editfx.on .ebb{transform:none}'
    +'#editfx .evg{inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 52%,rgba(0,0,0,.5) 100%)}#editfx .efl{inset:0;background:#fff;opacity:0}#editfx .eblk{inset:0;background:#000;opacity:1;transition:opacity .7s}#editfx.on .eblk{opacity:0}'
    +'#editfx .eh{left:14px;bottom:calc(9vh + 10px);font:16px monospace;letter-spacing:.2em;color:#000;opacity:.55;transition:opacity 1s}#editfx .eh.gone{opacity:0}';
  document.head.appendChild(st);
  editFx=document.createElement('div'); editFx.id='editfx'; editFx.innerHTML='<div class="evg"></div><div class="efl"></div><div class="ebt"></div><div class="ebb"></div><div class="eblk"></div><div class="eh">ESC: EXIT</div>';
  document.body.appendChild(editFx);
}
function editStart(){
  if(editOn||editBusy||exploring||mapMode||invOn) return;
  editBusy=true;
  try{ sfx=sfx||new (window.AudioContext||window.webkitAudioContext)(); sfx.resume(); }catch(e){ editBusy=false; return; }
  editLoad().then(buf=>{ editBusy=false; if(!editOn) editBegin(buf); }).catch(e=>{ editBusy=false; console.error('edit song failed',e); });
}
function editBegin(buf){
  editPrev={zoom:zoom,pitch:pitch,yaw:yaw,tx:target.x,ty:target.y,tz:target.z,spin:spin,night:night,clip:current?current.getClip().name:null,plume:plumeHex,tints:armorMats.map(m=>m.uniforms.uTint.value.clone())};
  editOn=true; if(spin) toggleSpin(); if(night) setNight(false);
  editHid=scene.children.filter(o=>o!==playerRig&&o!==invBg).map(o=>({o:o,v:o.visible})); if(rockMesh) editHid.push({o:rockMesh,v:rockMesh.visible});   // everything but the knight goes
  document.body.classList.add('map');   // the menu steps aside
  editBlack(true); showWeapons(); syncAudio();   // black, no weapon, and the menu music out
  [srcNode,flauntSrc,battleSrc].concat(Object.keys(xtra).map(k=>xtra[k].src)).forEach(t=>{ if(t) stopTrack(t); }); srcNode=flauntSrc=battleSrc=null; for(const k in xtra) xtra[k].src=null;   // and straight away, whatever was still starting up
  editSwordEnd(); loadSfxSet('honor-sfx-data'); editBeat0=-99; editBag=[]; editPoseLast=-1; editShotLast=-1; editBg=0; editPunch=editShake=editFlash=editInvert=editBlur=editVisor=0;
  editYawGoal=yaw; editRoll=editRollGoal=0; editPitchGoal=0.04; editZoomGoal=0.8; editYGoal=0; editPoseNext();
  const src=sfx.createBufferSource(), g=sfx.createGain(); src.buffer=buf; src.loop=true; src.loopStart=EDIT_START; src.loopEnd=buf.duration;   // starts at 0:57 and loops from there
  g.gain.value=EDIT_GAIN; src.connect(g); g.connect(sfx.destination); editT0=sfx.currentTime+0.05; src.start(editT0,EDIT_START); editSrc=src; editGain=g;
  editFxBuild(); requestAnimationFrame(()=>editFx.classList.add('on')); setTimeout(()=>{ const h=editFx&&editFx.querySelector('.eh'); if(h) h.classList.add('gone'); },3500);
  editExitOk=performance.now()+900;
}
function editEnd(){
  if(!editOn) return; editOn=false;
  try{ const t=sfx.currentTime; editGain.gain.cancelScheduledValues(t); editGain.gain.setValueAtTime(editGain.gain.value,t); editGain.gain.linearRampToValueAtTime(0,t+0.25); editSrc.stop(t+0.3); }catch(_){}
  editSrc=null; editGain=null; editSwordEnd(); swishStopAll(); editBlack(false); editVisorSet(0); showWeapons();
  editHid.forEach(h=>{ h.o.visible=h.v; }); editHid=[];
  if(invBg){ invBg.visible=false; const u=invBg.material.uniforms; u.uGlow.value=INV_BG_GLOW; u.uVig.value=INV_BG_VIGNETTE; u.uBokeh.value=INV_BG_BOKEH; }
  if(editFx){ editFx.remove(); editFx=null; } renderer.domElement.style.filter='';
  const p=editPrev; editPrev=null; editRoll=0;
  if(p){ zoom=p.zoom; pitch=p.pitch; yaw=p.yaw; target.set(p.tx,p.ty,p.tz); if(p.night!==night) setNight(p.night); if(p.spin!==spin) toggleSpin(); }
  mapViewK=1; applyView(); document.body.classList.remove('map');
  if(p&&p.clip&&actions[p.clip]) play(p.clip); else play(idleName());
  syncAudio();
}
function editStep(dt){
  if(!editOn) return;
  editHid.forEach(h=>{ h.o.visible=false; });
  // the beat, read off the song's own clock
  const el=sfx.currentTime-editT0, len=editBuf.duration-EDIT_START, pos=EDIT_START+(el<0?0:(el%len));
  const b=(pos+EDIT_LEAD-EDIT_FIRST)/EDIT_PERIOD, idx=Math.floor(b), ph=b-idx;
  if(el>=0&&idx!==editBeat0){ editBeat0=idx; editOnBeat(idx); }
  editSwordStep(ph);
  // the camera: eased VERY fast, so each cut is a whip, with a slow drift in between
  editYawGoal+=dt*0.22*editDir; editPunch*=Math.exp(-dt*6); editVisor*=Math.exp(-dt*8); editShake*=Math.exp(-dt*9); editFlash*=Math.exp(-dt*7); editBlur*=Math.exp(-dt*11); editInvert=Math.max(0,editInvert-dt);
  const k=(r)=>1-Math.exp(-dt*r);
  yaw+=(editYawGoal-yaw)*k(26); pitch+=(editPitchGoal-pitch)*k(22); editRoll+=(editRollGoal-editRoll)*k(18);
  const zg=editZoomGoal*(1-0.1*ph)*(1-0.22*editPunch); zoom+=(zg-zoom)*k(24);   // a slow push in across each beat, and a punch on it
  const ty=(editPrev?homeTarget.y:0)+playerH*(editYGoal+0.08); target.y+=(ty-target.y)*k(22); target.x=editPrev.tx; target.z=editPrev.tz;
  target.x+=(Math.random()-0.5)*0.12*editShake; target.y+=(Math.random()-0.5)*0.12*editShake; target.z+=(Math.random()-0.5)*0.12*editShake;
  mapViewK=0; applyView();
  // the picture: background colour, glow and vignette behind him
  _edC.set(EDIT_BG[editBg]); renderer.setClearColor(_edC); U.uFogColor.value.copy(_edC);
  { const bg=invBackdrop(), u=bg.material.uniforms; bg.visible=true; u.uBase.value.copy(_edC); u.uTime.value+=dt; u.uAsp.value=innerWidth/innerHeight; u.uK.value=1; u.uGlow.value=0.4; u.uVig.value=0.55; u.uBokeh.value=0; }
  editVisorSet(editVisor>0.02?editVisor:0);
  if(editFx){ editFx.querySelector('.efl').style.opacity=Math.min(1,editFlash).toFixed(3); }
  const blur=editBlur>0.05?'blur('+(editBlur*5).toFixed(1)+'px)':'', inv=editInvert>0?'invert(1)':'';
  renderer.domElement.style.filter=(inv+' '+blur).trim();
}
addEventListener('keydown',e=>{
  if(!editOn) return; e.stopImmediatePropagation();
  if(e.key==='Escape'||e.key==='Backspace'||e.key==='Enter'){ e.preventDefault(); editEnd(); }
},true);
addEventListener('pointerdown',e=>{ if(editOn&&performance.now()>editExitOk){ e.stopImmediatePropagation(); editEnd(); } },true);
function initMainMenu(){
  const root=document.getElementById('mm'), scr=document.getElementById('scr'), cust=document.getElementById('cust'), toastEl=document.getElementById('toast');
  ['vlbl','voicesel','hlbl','helmsel','plbl','sws','albl','asws','astrl','astr','shiny','slbl','ssws','smatch'].forEach(id=>{ const n=document.getElementById(id); if(n) cust.appendChild(n); });
  let tt=0; window.toast=toast; function toast(t){ toastEl.textContent=t; toastEl.classList.add('show'); clearTimeout(tt); tt=setTimeout(()=>toastEl.classList.remove('show'),1700); }
  const BACK={t:'BACK',go:'main'}, BACK_OPT={t:'BACK',go:'options'};   // BACK_OPT: from a group of options back to OPTIONS
  const BACK_ANIM={t:'BACK',go:'anims'};   // from an ANIMATIONS sub-menu back to the ANIMATIONS list
  const BACK_ENEMIES={t:'BACK',go:'anims_enemies'};   // from one enemy's animations back to the enemy list
  const evRows=key=>{ const d=evDefs(key); return d?d.map((x,i)=>({t:x.label,v:()=>(golemOn&&evCur&&evCur.key===key&&evCur.ci===i)?'PLAYING':'',run:()=>evPlay(key,i)})):[{t:'LOADING...'}]; };
  const animRows=g=>menuNames.filter(n=>animGroup(n)===g&&animVisible(n)).map(n=>({t:n.toUpperCase(),v:()=>(!golemOn&&current&&(AXE_BASE[current.getClip().name]||current.getClip().name)===n)?'PLAYING':'',run:()=>menuPlay(n)}));
  const SCREENS={
    start:{name:'PRESS START',items:[{t:'START',run:startGame}]},
    main:{name:'MAIN MENU',items:[{t:'MAP',run:openMap},{t:'INVENTORY',run:openInventory},{t:'OPTIONS',go:'options'},{t:'ANIMATIONS',go:'anims'},{t:'CREDITS',go:'credits'}]},
    custom:{name:'CUSTOMIZE',panel:1,items:[BACK]},
    /* TEMPORARY: lists every animation in the model so you can preview them. Delete this screen and the ANIMATIONS entry above when you no longer need it */
    anims:{name:'ANIMATIONS (TEMP)',get items(){ return [{t:'ANIM SET',v:()=>animSet.toUpperCase(),run:toggleUal},{t:'ENEMIES',go:'anims_enemies'},{t:'SELF',go:'anims_self'},{t:'SHOPKEEPER',go:'anims_shop'},{t:'MISC',go:'anims_misc'},BACK]; }},
    anims_misc:{name:'ANIMATIONS: MISC',up:'anims',items:[{t:'EDIT',run:editStart},BACK_ANIM]},
    anims_enemies:{name:'ANIMATIONS: ENEMIES',up:'anims',get items(){ return EV_ENEMIES.map(e=>({t:e.name,go:'anims_en_'+e.key})).concat([BACK_ANIM]); }},
    anims_en_golem:{name:'ENEMIES: GOLEM',up:'anims_enemies',get items(){ return evRows('golem').concat([BACK_ENEMIES]); }},
    anims_en_treeling:{name:'ENEMIES: TREELING',up:'anims_enemies',get items(){ return evRows('treeling').concat([BACK_ENEMIES]); }},
    anims_en_sporeling:{name:'ENEMIES: SPORELING',up:'anims_enemies',get items(){ return evRows('sporeling').concat([BACK_ENEMIES]); }},
    anims_en_slime:{name:'ENEMIES: SLIME',up:'anims_enemies',get items(){ return evRows('slime').concat([BACK_ENEMIES]); }},
    anims_self:{name:'ANIMATIONS: SELF',up:'anims',get items(){ return animRows('self').concat([BACK_ANIM]); }},
    anims_shop:{name:'ANIMATIONS: SHOPKEEPER',up:'anims',get items(){ return animRows('shop').concat([BACK_ANIM]); }},
    options:{name:'OPTIONS',items:[{t:'GRAPHICS',go:'opt_gfx'},{t:'WORLD',go:'opt_world'},{t:'SOUND',go:'opt_sound'},{t:'KNIGHT',go:'opt_knight'},BACK]},
    opt_gfx:{name:'GRAPHICS',up:'options',items:[
      {t:'LOOK',v:()=>ps1?'PS1':'MODERN',run:toggleLook},
      {t:'PIXELS',v:()=>PIX_STEPS[pixIdx][0],run:cyclePixels},
      {t:'COLORS',v:()=>COL_STEPS[colIdx][0],run:cycleColors},
      {t:'SHINE',v:()=>shineOn?'ON':'OFF',run:toggleShine},BACK_OPT]},
    opt_world:{name:'WORLD',up:'options',items:[
      {t:'WORLD',v:()=>forest?'FOREST':'CLASSIC',run:()=>setWorld(!forest)},
      {t:'TIME',v:()=>night?'NIGHT':'DAY',run:()=>setNight(!night)},
      {t:'FOG',v:()=>'#'.repeat(fogT)+'.'.repeat(9-fogT),adj:d=>{ fogT=d?Math.max(1,Math.min(9,fogT+d)):fogT%9+1; }},   // thickness: LEFT / RIGHT (or click) - 5 is the normal fog
      {t:'LEAVES',v:()=>leavesOn?'ON':'OFF',run:toggleLeaves},
      {t:'SNOW',v:()=>snowOn?'ON':'OFF',run:()=>{ snowOn=!snowOn; }},BACK_OPT]},
    opt_sound:{name:'SOUND',up:'options',items:[
      {t:'MUSIC',v:()=>musicOn?'ON':'OFF',run:()=>{ toggleMusic(); setTimeout(render,0); }},
      {t:'BITCRUSH',v:()=>crushOn?'ON':'OFF',run:toggleCrush},
      {t:'VOICE',v:()=>voice==='voice2'?'VOICE 2':'VOICE 1',run:toggleVoice},BACK_OPT]},
    opt_knight:{name:'KNIGHT',up:'options',items:[
      {t:'WEAPON',v:()=>weapon==='axe'?'AXE':'SWORD',run:toggleWeapon},
      {t:'SWORD STYLE',v:()=>swordStyle==='hatchet'?'HATCHET':swordStyle==='hammer'?'HAMMER':swordStyle==='knightly'?'KNIGHTLY':swordStyle==='morningstar'?'MORNINGSTAR':'SWORD',run:toggleStyle},{t:'AXE STYLE',v:()=>axeStyle==='shovel'?'SHOVEL':'AXE',run:toggleAxeStyle},{t:'ANIM SET',v:()=>animSet.toUpperCase(),run:toggleUal},
      {t:'SWOOSH',v:()=>swooshOn?'ON':'OFF',run:toggleSwoosh},
      {t:'TURNTABLE',v:()=>spin?'ON':'OFF',run:toggleSpin},BACK_OPT]},
    /* Attribution: This work is based on "Low Poly Campfire" (https://sketchfab.com/3d-models/low-poly-campfire-695c62069ac44614acbfc6effcf7499d) by MrE_Sauce (https://sketchfab.com/MrE_Sauce) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Glint and falling-leaf sprites by Kaessis. */
    credits:{name:'CREDITS',text:['KNIGHT MODEL AND ART','BUILT BY YOU, BLOCKBENCH','AND A LOT OF PATIENCE','','ADVENTURER BASE MESH','FROM A FREE LOW-POLY PACK','','LOW POLY CAMPFIRE','BY MRE_SAUCE (SKETCHFAB)','LICENSED CC BY 4.0','','GLINT AND FALLING LEAF','SPRITES BY KAESSIS','','DARIEN GAP','BY LT','','LIVIN LOOSE','BY GEORGE CLANTON','','HIT GRUNTS','HARRY MASON','FROM SILENT HILL (KONAMI)','','SWORD SOUNDS','FROM CASTLEVANIA (KONAMI)','','WALKING SOUND','FROM DIGIMON WORLD (BANDAI)','','BLOCK HIT SOUNDS','FROM THE ELDER SCROLLS IV: OBLIVION','BY BETHESDA GAME STUDIOS'],items:[BACK,'','SACRIFICE OF SAINT DELL','BY FM SKYLINE','','ICE (SLOWED)','BY ZERTAL']}
  };
  /* START: fade to black, then he gets up from Pose3 into the usual seated Pose2, the camera moves to the normal menu view, and the main menu opens */
  const fadeEl=document.getElementById('fade'); let startBusy=false;
  function startGame(){
    if(startBusy) return; startBusy=true; fadeEl.classList.add('on');
    setTimeout(function(){ menuCam(); play(SEAT_CLIP); go('main'); fadeEl.classList.remove('on'); startBusy=false; },700);
  }
  /* START SCREEN (Escape / Backspace on the main menu): the way back to where the game began - fade to black, the low start camera, him hunched in Pose3, and the PRESS START menu */
  function toStartScreen(){
    if(startBusy||!actions[START_CLIP]) return; startBusy=true; fadeEl.classList.add('on');
    setTimeout(function(){ play(START_CLIP); startCam(); go('start'); fadeEl.classList.remove('on'); startBusy=false; },700);
  }
  let cur=actions[START_CLIP]?'start':'main', idx=0, top=0, btns=[];
  /* long lists scroll: only a window of rows is shown, with a "N MORE" marker above / below (click it, use the mouse wheel, or just keep pressing up / down) */
  const MENU_MAX=8, uiEl=document.getElementById('ui');
  function visRows(){ const small=innerWidth<=640, rowH=small?38:Math.min(52,Math.max(46,innerWidth*0.042*1.08+6)); return Math.max(4,Math.min(MENU_MAX,Math.floor((innerHeight-(small?300:330))/rowH))); }
  function moreRow(dir,count,vis){ const d=document.createElement('div'); d.className='more'+(count>0?'':' off'); d.textContent=(dir<0?'\u25B2 ':'\u25BC ')+count+' MORE'; if(count>0) d.onclick=()=>scrollBy(dir*(vis-1)); return d; }
  function scrollBy(n){
    const items=SCREENS[cur].items, vis=visRows(); if(items.length<=vis) return;
    top=Math.max(0,Math.min(top+n,items.length-vis)); if(idx<top) idx=top; else if(idx>=top+vis) idx=top+vis-1; render();
  }
  function render(){
    const sc=SCREENS[cur]; scr.textContent=sc.name; root.innerHTML=''; btns=[];
    startScr=(cur==='start'); document.body.classList.toggle('startscr',startScr);   // the start screen's camera can't be dragged
    if(sc.text){ const d=document.createElement('div'); d.className='txt'; d.innerHTML=sc.text.map(l=>l||'&nbsp;').join('<br>'); root.appendChild(d); }
    cust.hidden=!sc.panel; document.body.classList.toggle('custscr',!!sc.panel);   // the customize screen gets the blue inventory-style panel (see index.html)
    const items=sc.items, vis=visRows(), scrolls=items.length>vis;
    if(scrolls){ if(idx<top) top=idx; if(idx>=top+vis) top=idx-vis+1; top=Math.max(0,Math.min(top,items.length-vis)); root.appendChild(moreRow(-1,top,vis)); } else top=0;
    items.forEach((it,i)=>{
      if(scrolls&&(i<top||i>=top+vis)) return;
      const b=document.createElement('button'); b.className='mi'+(it.lock?' lock':'')+(i===idx?' on':''); b._i=i;
      b.innerHTML='<span>'+it.t+'</span>'+(it.v?'<span class="v">'+it.v()+'</span>':it.lock?'<span class="v">LOCKED</span>':'');
      b.onmouseenter=()=>{ if(idx!==i){ idx=i; mark(); blip(520,0.05); } };
      b.onclick=()=>{ idx=i; mark(); act(); };
      root.appendChild(b); btns.push(b);
    });
    if(scrolls) root.appendChild(moreRow(1,items.length-top-vis,vis));
  }
  function mark(){ btns.forEach(b=>b.classList.toggle('on',b._i===idx)); }
  function go(n){ if(invOn&&invCust&&n==='main'){ invShowInv(); return; } if(golemOn&&n!=='anims'&&n.indexOf('anims_')!==0) golemShow(false); cur=n; idx=0; top=0; render(); }   // CUSTOMIZE lives in the inventory now: its BACK returns there
  invGoMenu=go;
  function act(){
    const it=SCREENS[cur].items[idx];
    if(it.lock){ blip(140,0.14); toast('LOCKED'); return; }
    blip(880,0.09);
    if(it.adj){ it.adj(0); render(); } else if(it.go) go(it.go); else if(it.run){ it.run(); render(); }
  }
  function move(d){ const n=SCREENS[cur].items.length; idx=(idx+d+n)%n; blip(520,0.05); if(idx<top||idx>=top+visRows()) render(); else mark(); }
  addEventListener('keydown',e=>{
    if(e.target.tagName==='SELECT'||e.target.tagName==='INPUT') return;
    if(exploring||mapMode||(invOn&&!invCust)) return;
    const k=e.key;
    if(k==='ArrowDown'||k==='s') move(1); else if(k==='ArrowUp'||k==='w'&&false) move(-1);
    else if(k==='Enter'||k===' ') act();
    else if(k==='Escape'||k==='Backspace'){ if(cur==='main'){ if(!startBusy){ blip(300,0.08); toStartScreen(); } } else if(cur!=='start'){ blip(300,0.08); go(SCREENS[cur].up||'main'); } }
    else if(k==='ArrowLeft'||k==='ArrowRight'){ const it=SCREENS[cur].items[idx]; if(it.adj){ it.adj(k==='ArrowRight'?1:-1); blip(660,0.05); render(); } else if(it.run) act(); }
  });
  uiEl.addEventListener('wheel',e=>{ if(exploring||SCREENS[cur].items.length<=visRows()) return; e.preventDefault(); blip(520,0.03); scrollBy(e.deltaY>0?1:-1); },{passive:false});
  addEventListener('resize',()=>{ if(!exploring) render(); });
  render();
}
})();
