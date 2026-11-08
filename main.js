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
uniform sampler2D map; uniform vec3 uTint; uniform float uAffine; uniform float uDither; uniform float uLevels; uniform vec3 uFogColor; uniform vec3 uNight; uniform float uShine; uniform float uBlackNoShine; uniform float uBlackGrey; uniform float uMaskNoShine;
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
  lit=mix(lit,(tx.rgb*(1.85+0.7*uMagmaPulse)+0.12)*uTint,gem);
  float bgl=uBladeGlow*(1.0-gem);                                                              // uBladeGlow (the Knightly sword's blade): the steel itself glows a little - much less than the gems
  lit=mix(lit,(tx.rgb*(1.12+0.2*uMagmaPulse)+0.05)*uTint,bgl*0.55);   // (+0.05: the darker steel of the guard, pommel and grip lifts as visibly as the pale blade)
  lit=mix(lit,base,uEmit);                                                                      // uEmit: 1 on the lantern's bulb itself - it glows instead of being lit
  vec3 c=mix(lit*mix(uNight,vec3(1.0),max(max(uEmit,mgm),max(gem,bgl*0.45)))+lampT,uFogColor,vFog);                    // (night does not dim a glow)
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
    uniforms:Object.assign({map:{value:tex},uUvScale:{value:uvScale||1},uTint:{value:new THREE.Vector3(1,1,1)},uShine:{value:0},uBlackNoShine:{value:0},uBlackGrey:{value:0},uMaskNoShine:{value:0},uEmit:{value:0},uMagma:{value:0},uGem:{value:0},uBladeGlow:{value:0},uOccOn:{value:0}},U)});   // uOccOn: 1 on walls and trees (occMark), which dither away when they are in front of someone
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
  const a=amt===undefined?armorAmt:amt;
  v.set(1+(c.r/mx-1)*a, 1+(c.g/mx-1)*a, 1+(c.b/mx-1)*a);
}
function tintArmorMat(m){ tintMat(m,armorHex); }
function applySwordTint(){ swordMats.forEach(m=>tintMat(m,swordMatch?armorHex:swordHex)); }
function applyArmorTint(){ armorMats.forEach(tintArmorMat); applySwordTint(); }

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
const SNAP_ON=true, SNAP_CLIPS=['Hit','Swing','AxeSwing','Flaunt','AxeFlaunt','Block','Death','Drinking_Potion','SwingHeavyWindUp','SwingHeavyRelease'];
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
  initTrees(H,box.min.y); initRuins(H,box.min.y,ctr); initPointer(); initElemental(); initDgForest(H,box.min.y,ctr); initSky(H,box.min.y); initNight(H,box.min.y); groundYNight=box.min.y; initLeaves(box.min.y); initSnow(H,box.min.y); initRock(gltf.scene,box.min.y); initSword(gltf.scene); initHatchet(gltf.scene); initHammer(gltf.scene); initKnightly(gltf.scene); initAxe(gltf.scene); initPotion(gltf.scene); initChest(rig); setWorld(true);
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
  ['axeidle-data','axeswing-data','axeflaunt-data','flauntidleaxe-data','drinkpotion-data','pose3-data','dance-data','shopidle-data','shopidleanimation1-data','shopintotalk-data','shopoutrotalk-data','shopwhiletalking-data','block-data','blockidle-data','swingheavywindup-data','swingheavyturnhold-data','swingheavyrelease-data'].forEach(function(id){
    const el=document.getElementById(id); if(!el) return;
    const D=JSON.parse(el.textContent), base={};
    if((id==='axeswing-data'&&AXE_SWING_REVERSE)||D.rev){   // play the swing backwards: keyframes in reverse order, times counted from the end
      let T=0; D.tracks.forEach(k=>{ T=Math.max(T,k.t[k.t.length-1]); });
      D.tracks.forEach(k=>{ const n=k.p==='q'?4:3, c=k.t.length, v=[]; for(let i=c-1;i>=0;i--) for(let j=0;j<n;j++) v.push(k.v[i*n+j]); k.t=k.t.map(x=>T-x).reverse(); k.v=v; });
    }
    gltf.animations.forEach(a=>a.tracks.forEach(t=>{ const b=t.name.slice(0,t.name.lastIndexOf('.')); base[b.replace(/_\d+$/,'')]=b; }));
    const tr=D.tracks.map(k=>{ const b=base[k.n]||k.n; return k.p==='q'?new THREE.QuaternionKeyframeTrack(b+'.quaternion',k.t,k.v):new THREE.VectorKeyframeTrack(b+'.position',k.t,k.v); });
    if(id==='block-data'){ const old=gltf.animations.findIndex(a=>a.name==='Block'); if(old>=0) gltf.animations.splice(old,1); }   // the new Block replaces the rig's own
    gltf.animations.push(new THREE.AnimationClip(D.name,-1,tr));
  });
  /* Chestopen: the rig's own chest-opening clip (embedded below as CHESTOPEN_CLIP, same track format as the other embedded clips). It lists itself in the animation menus; the chest it opens is built in initChest. */
  { const base={}; gltf.animations.forEach(a=>a.tracks.forEach(t=>{ const b=t.name.slice(0,t.name.lastIndexOf('.')); base[b.replace(/_\d+$/,'')]=b; }));
    [CHESTOPEN_CLIP,CARSHDANCE_CLIP].forEach(D=>gltf.animations.push(new THREE.AnimationClip(D.name,-1,D.tracks.map(k=>{ const b=base[k.n]||k.n; return k.p==='q'?new THREE.QuaternionKeyframeTrack(b+'.quaternion',k.t,k.v):new THREE.VectorKeyframeTrack(b+'.position',k.t,k.v); })))); }   // CARSHDANCE: see CARSHDANCE_CLIP below
  /* UAL: clips from Quaternius' Universal Animation Library, retargeted onto this rig offline (ual-data: arms and legs aimed by direction, hips / torso / head by world rotation, feet kept on the ground).
     They are added next to the knight's own clips as UAL_*; ANIM SET in the options plays them in place of Idle / Walk / Swing / Hit / Block ... (see UAL_ALT). */
  (function(){
    const el=document.getElementById('ual-data'); if(!el) return;
    const U=JSON.parse(el.textContent), base={};
    gltf.animations.forEach(a=>a.tracks.forEach(t=>{ const b=t.name.slice(0,t.name.lastIndexOf('.')); base[b.replace(/_\d+$/,'')]=b; }));
    U.clips.forEach(D=>{ const tr=D.tracks.map(k=>{ const b=base[k.n]||k.n; return k.p==='q'?new THREE.QuaternionKeyframeTrack(b+'.quaternion',k.t,k.v):new THREE.VectorKeyframeTrack(b+'.position',k.t,k.v); }); gltf.animations.push(new THREE.AnimationClip(D.name,-1,tr)); });
  })();
  { [START_CLIP,'ShopIdle','ShopIdleAnimation1','ShopIdleAnimationIntoTalk','ShopIdleAnimationOutroTalk','ShopIdleAnimationWhileTalking'].forEach(cn=>{ const p3=gltf.animations.find(a=>a.name===cn); if(p3) setLeftShin(p3,LEFT_SHIN_DEG); }); }   // Pose3 shares Pose2's legs, so it gets the same tweak and sits on the same rock. Its head is left as authored; the occasional look at the sky is added on top, see headLook()
  /* AxeFlaunt is the rig's own "animation" clip, played exactly as authored (arms, body, legs and head are not touched). Only the axe moves: it rests on his back, see AXE_STOW_CLIPS. */
  mixer=new THREE.AnimationMixer(gltf.scene);
  const order=['Idle','AxeIdle','Walk','Swing','AxeSwing','AxeFlaunt','Hit','Death'];
  names=order.filter(n=>gltf.animations.some(a=>a.name===n)).concat(gltf.animations.map(a=>a.name).filter(n=>!order.includes(n)&&n!==EVT_CLIP));
  menuNames=names.filter(n=>!AXE_BASE[n]&&n!==START_CLIP&&!/^UALX_/.test(n));   // what the menus list: the axe variants are folded into Idle / Swing / Flaunt, and the start-screen pose (Pose3) is not an animation to browse
  menuNames.push('GolemAttack');   // the golem's clip (see GOLEM below): not one of the knight's own, it swaps the golem in
  { const gi={enemies:0,self:1,shop:2}; menuNames=menuNames.map((n,i)=>[n,i]).sort((a,b)=>gi[animGroup(a[0])]-gi[animGroup(b[0])]||a[1]-b[1]).map(x=>x[0]); }   // grouped in the order the ANIMATIONS menu shows them (so the cycle keys follow it too)
  if(SNAP_ON) gltf.animations.forEach(a=>{ if(SNAP_CLIPS.includes(a.name)) snapClip(a); });   // see SNAP
  gltf.animations.forEach(a=>{actions[a.name]=mixer.clipAction(a);});
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
const HATCHET_GRIP_Y=1.156, HATCHET_TURN_DEG=0, HATCHET_NUDGE=[0,0,0];
let voice='voice1';   // 'voice1' (original sounds) or 'voice2' (new sounds)
function setVoice(v){
  voice=(v==='voice2')?'voice2':'voice1';
  const b=document.getElementById('voice'); if(b) setSwitch('voice',true,voice==='voice2'?'Voice 2':'Voice 1');
  const sel=document.getElementById('voicesel'); if(sel) sel.value=voice;
}
function toggleVoice(){ setVoice(voice==='voice1'?'voice2':'voice1'); }
let hatchetGrp=null, hammerGrp=null, knightlyGrp=null, swordStyle='sword';   // swordStyle: 'sword' or 'hatchet' (only shows while the weapon is the light one)
function showWeapons(){ applyAxeStyle();
  if(swordGrp) swordGrp.visible=(weapon==='sword'&&swordStyle==='sword');
  if(hatchetGrp) hatchetGrp.visible=(weapon==='sword'&&swordStyle==='hatchet');
  if(hammerGrp) hammerGrp.visible=(weapon==='sword'&&swordStyle==='hammer');
  if(knightlyGrp) knightlyGrp.visible=(weapon==='sword'&&swordStyle==='knightly');
  if(axeGrp) axeGrp.visible=(weapon==='axe');
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
   Its coloured texels glow like the magma on the Ignis Mourne trees (uGem, in the shader) and the blade steel itself glows a little (uBladeGlow, much weaker). It takes no armor/weapon tint: the colours are its own. ---------- */
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
      const kmat=ps1Mat(tex,1); shineMat(kmat); kmat.uniforms.uGem.value=1; kmat.uniforms.uBladeGlow.value=1;   // every part (blade, tip, guard, pommel, grip) glows a little
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
  swordStyle=(swordStyle==='sword')?'hatchet':(swordStyle==='hatchet')?'hammer':(swordStyle==='hammer')?'knightly':'sword';
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
const AXE_STOW_CLIPS=['Flaunt','Death','Pose2','Pose2_randomevent','Drinking_Potion','Chestopen'], AXE_BACK_AT=[0,0.2,-0.175], AXE_BACK_TILT_DEG=35, AXE_BACK_SIDE=-1;
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
const WAIST_CLIPS=['Drinking_Potion'], WAIST_AT=[-0.27,0.1,0.0], WAIST_DIR=[0,-1,-0.28], WAIST_ROLL_DEG=90;
function waistStep(stow){
  const hips=knightScene&&knightScene.getObjectByName('Root_Hips');
  if(hatchetGrp&&weapon==='sword'&&swordStyle==='hatchet') hatchetGrp.visible=!stow;
  if(hammerGrp&&weapon==='sword'&&swordStyle==='hammer') hammerGrp.visible=!stow;
  if(knightlyGrp&&weapon==='sword'&&swordStyle==='knightly') knightlyGrp.visible=!stow;
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
  if(!potionGrp) return;
  const k=drinking?Math.min(1,Math.max(0,(current.time-POTION_OUT_AT)/POTION_POP)):0;
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
    if(swordGrp) swordGrp.visible=false; if(hatchetGrp) hatchetGrp.visible=false; if(hammerGrp) hammerGrp.visible=false; if(knightlyGrp) knightlyGrp.visible=false;
    if(current.time>=CHEST_SFX_AT&&chestPrevT<CHEST_SFX_AT) playChestSfx();   // the lid starts to lift
    chestPrevT=current.time;
    if(chestAct){ chestAct.reset(); chestAct.time=current.time; chestMixer.update(0); }   // lid follows the knight's clock (reset first: the lid clip holds its last pose once it has finished)
  } else if(chestOn) showWeapons();
  chestOn=on;
}
const CHESTOPEN_CLIP={"name":"Chestopen","tracks":[{"n":"Root_Hips","p":"p","t":[0.0,1.08333,1.33333],"v":[0.0,0.93458,0.06667,0.0,0.93458,0.06667,0.0,0.74708,0.11354]},{"n":"Torso","p":"q","t":[0.0,0.70833,0.95833,1.29167],"v":[0.04362,0.0,0.0,0.99905,0.02181,0.0,0.0,0.99976,0.08716,0.0,0.0,0.99619,0.30071,0.0,0.0,0.95372]},{"n":"Left_Arm","p":"q","t":[0.0,1.04167,1.875,3.66667,3.83333,3.95833,4.25,4.58333,4.70833,4.875,5.375,5.625],"v":[0.06771,0.11159,-0.51434,0.8476,0.06771,0.11159,-0.51434,0.8476,-0.22071,-0.22025,-0.2012,0.9286,-0.26802,-0.15758,0.03691,0.94972,-0.27018,-0.15382,0.08742,0.94642,-0.26802,-0.15758,0.03691,0.94972,-0.26802,-0.15758,0.03691,0.94972,-0.25854,-0.18587,0.35759,0.87792,-0.26253,-0.18018,0.37666,0.86991,-0.25854,-0.18587,0.35759,0.87792,-0.25854,-0.18587,0.35759,0.87792,-0.24583,-0.20238,0.29941,0.89943]},{"n":"Left_Forearm","p":"q","t":[0.0,1.91667,2.25,2.5,3.04167,3.41667,4.0,4.58333,5.375,5.625],"v":[0.0,-0.36244,0.0,0.93201,0.0,-0.36244,0.0,0.93201,0.0,-0.5373,0.0,0.84339,-0.75641,-0.23764,-0.48189,0.37302,-0.75641,-0.23764,-0.48189,0.37302,-0.7493,-0.51866,-0.41132,0.01878,-0.76653,-0.51899,-0.37824,-0.00386,-0.67613,-0.42423,-0.00455,0.60238,-0.67613,-0.42423,-0.00455,0.60238,-0.59437,-0.45358,0.09974,0.65654]},{"n":"Right_Arm","p":"q","t":[0.0,1.125,2.54167,3.66667,3.91667,4.25,4.375,4.58333,4.75,4.875,5.41667,6.25],"v":[0.0,0.0,0.51877,0.85491,0.0,0.0,0.51877,0.85491,-0.05602,0.20906,0.25268,0.94303,-0.10643,0.17814,-0.00885,0.97819,-0.11331,0.17753,-0.03882,0.9768,-0.10643,0.17814,-0.00885,0.97819,-0.12025,0.17996,-0.06385,0.97421,-0.1773,0.12415,-0.4126,0.88482,-0.17996,0.12025,-0.4318,0.87561,-0.1773,0.12415,-0.4126,0.88482,-0.1773,0.12415,-0.4126,0.88482,-0.17171,0.13176,-0.37361,0.90198]},{"n":"Right_Arm","p":"p","t":[0.0,1.125],"v":[-0.125,0.45104,-0.06667,-0.125,0.45104,-0.06667]},{"n":"Right_Forearm","p":"q","t":[0.0,1.125,1.875,2.16667,2.45833,3.04167,3.41667,4.0,4.58333,5.20833,6.08333],"v":[0.0,0.44229,0.0,0.89687,0.0,0.44229,0.0,0.89687,-0.08213,0.43085,-0.08696,0.89446,-0.10268,0.58233,-0.14004,0.79419,-0.73913,0.41244,0.43429,0.30817,-0.73913,0.41244,0.43429,0.30817,-0.68746,0.64564,0.33116,-0.02963,-0.72984,0.63361,0.22273,-0.12751,-0.64258,0.34109,0.00734,0.68607,-0.64169,0.38523,-0.0347,0.66229,-0.64169,0.38523,-0.0347,0.66229]},{"n":"Left_Leg","p":"q","t":[0.0,0.54167,0.875,1.04167,1.33333,3.625],"v":[0.04362,0.0,0.0,0.99905,0.04362,0.0,0.0,0.99905,0.04362,0.0,0.0,0.99905,0.0,0.0,0.0,1.0,0.27983,0.0,0.0,0.96005,0.27983,0.0,0.0,0.96005]},{"n":"Left_Shin","p":"q","t":[0.0,0.875,1.04167,1.33333,3.625],"v":[0.04362,0.0,0.0,0.99905,0.04362,0.0,0.0,0.99905,0.21644,0.0,0.0,0.9763,0.23769,0.0,0.0,0.97134,0.23769,0.0,0.0,0.97134]},{"n":"Right_Leg","p":"q","t":[0.0,0.625,1.04167,1.41667],"v":[-0.04362,0.0,0.0,0.99905,-0.04362,0.0,0.0,0.99905,-0.36244,0.0,0.0,0.93201,-0.38268,0.0,0.0,0.92388]},{"n":"Right_Shin","p":"q","t":[0.0,0.875,1.04167],"v":[0.0654,0.0,0.0,0.99786,0.0654,0.0,0.0,0.99786,0.36244,0.0,0.0,0.93201]},{"n":"Head","p":"q","t":[0.0,1.41667,1.875,2.5,2.79167,2.95833,3.125,3.66667,3.95833,5.5,5.91667,6.625,7.20833],"v":[0.04362,0.0,0.0,0.99905,0.17365,0.0,0.0,0.98481,0.13053,0.0,0.0,0.99144,0.13053,0.0,0.0,0.99144,-0.15212,0.0,0.0,0.98836,-0.10166,0.0,0.0,0.99482,-0.15212,0.0,0.0,0.98836,-0.15212,0.0,0.0,0.98836,0.17365,0.0,0.0,0.98481,0.17365,0.0,0.0,0.98481,0.21459,0.12941,0.01704,0.96794,0.21459,0.12941,0.01704,0.96794,0.21429,-0.04064,-0.02049,0.97571]},{"n":"Head","p":"p","t":[0.0,0.70833,1.04167,1.33333],"v":[0.0,1.6875,0.0,0.0,1.6875,0.0,0.0,1.6875,0.14062,0.0,1.40625,0.4375]}]};
/* CARSHDANCE: a dance converted from a Unity Humanoid clip (car shearer dance, 14.83 s, no music). The source stores normalised joint 'muscle' values rather than bone rotations, so they were turned into
   joint angles with Unity's default muscle ranges and retargeted onto this rig (one torso bone, one neck/head, arms, legs and feet; the hips are lowered/raised each frame so the lower foot meets the floor).
   It is an approximation, not an exact copy. It is sampled at 20 keys a second and its last 0.6 s eases back into its first pose so the loop does not jump. It plays like any other menu animation. */
const CARSHDANCE_CLIP={"name":"CARSHDANCE","tracks":[{"n":"Root_Hips","p":"t","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[0.0017,0.8481,0.0694,-0.0136,0.8314,0.0692,-0.0316,0.7612,0.0695,-0.0504,0.6652,0.0696,-0.0625,0.6017,0.0691,-0.0618,0.5799,0.0695,-0.0385,0.655,0.0708,-0.0169,0.7694,0.0672,0.0031,0.8481,0.0624,-0.0028,0.8847,0.0605,-0.036,0.9534,0.0577,-0.0633,1.0066,0.0472,-0.0752,1.0089,0.0396,-0.0517,0.9936,0.0467,-0.0299,0.9647,0.0535,-0.007,0.935,0.0572,0.0046,0.9168,0.0572,-0.0168,0.8781,0.0606,-0.036,0.8036,0.0638,-0.0549,0.6981,0.0655,-0.064,0.6457,0.0652,-0.0392,0.6844,0.0695,-0.0134,0.7883,0.0676,0.0079,0.85,0.0641,0.0062,0.8769,0.0617,-0.0287,0.9441,0.0591,-0.0505,0.9899,0.0503,-0.0671,0.9972,0.0407,-0.0494,0.9888,0.0453,-0.0254,0.965,0.0541,-0.0007,0.9248,0.0588,-0.0002,0.9012,0.0587,-0.0147,0.8715,0.0622,-0.0333,0.8011,0.0651,-0.051,0.709,0.0661,-0.0605,0.6484,0.0652,-0.0455,0.6583,0.0688,-0.0207,0.7536,0.0686,0.0031,0.8377,0.0653,0.0097,0.8631,0.0626,-0.0215,0.9203,0.0611,-0.0449,0.9785,0.054,-0.0656,0.9977,0.0437,-0.0618,0.9933,0.0423,-0.0371,0.98,0.0518,-0.0116,0.9395,0.0583,0.004,0.9007,0.0592,-0.0075,0.8738,0.0606,-0.0279,0.8249,0.0641,-0.0463,0.7369,0.0657,-0.0575,0.6626,0.0657,-0.0558,0.6425,0.0665,-0.0333,0.6985,0.0688,-0.0131,0.7885,0.0664,0.0057,0.8488,0.0626,0.001,0.8849,0.0608,-0.0269,0.9605,0.0559,-0.0507,0.9715,0.041,-0.0575,0.8992,0.0328,-0.0581,0.9275,0.0494,-0.0625,0.9777,0.0553,-0.0666,0.923,0.0637,-0.0761,0.9103,0.0651,-0.0874,0.9301,0.0678,-0.0979,0.905,0.081,-0.0977,0.9359,0.071,-0.0975,0.9182,0.0662,-0.0953,0.9405,0.0806,-0.0836,0.9343,0.0875,-0.063,0.8591,0.0875,-0.0383,0.8254,0.0834,-0.012,0.8282,0.0872,0.0033,0.8728,0.0827,0.0166,0.8859,0.072,0.0325,0.9689,0.0611,0.0259,0.9293,0.0727,0.0086,0.9548,0.0793,-0.0129,0.9182,0.0726,-0.0395,0.8249,0.0737,-0.0638,0.8362,0.0772,-0.077,0.8918,0.0803,-0.0793,0.8825,0.0758,-0.0866,0.8768,0.0796,-0.0927,0.8731,0.0819,-0.0939,0.8682,0.0756,-0.0927,0.8771,0.0661,-0.0979,0.8348,0.0771,-0.0956,0.8417,0.0866,-0.0919,0.9582,0.0824,-0.0891,0.9903,0.0717,-0.094,1.0018,0.0676,-0.0916,0.9511,0.0717,-0.0848,0.9018,0.0745,-0.0692,0.896,0.0743,-0.0446,0.8856,0.0786,-0.0256,0.9369,0.0767,-0.014,1.0011,0.0718,-0.0088,1.0203,0.0692,-0.0164,1.0159,0.0703,-0.0278,0.9816,0.0728,-0.0366,0.9474,0.0723,-0.0343,0.9413,0.071,-0.0162,0.9681,0.0655,-0.0063,1.0083,0.0521,-0.0017,1.0055,0.0453,-0.0169,1.0141,0.055,-0.0302,0.9972,0.0645,-0.0426,0.9624,0.0697,-0.0499,0.9538,0.0703,-0.0371,0.9598,0.073,-0.0268,0.9999,0.0701,-0.0186,1.0266,0.0643,-0.0143,1.0286,0.0626,-0.022,1.032,0.0649,-0.027,0.9895,0.0709,-0.0316,0.935,0.0741,-0.0344,0.9201,0.0743,-0.0315,0.9192,0.0774,-0.03,0.9576,0.0757,-0.0303,1.0107,0.0679,-0.0337,0.967,0.058,-0.0359,0.9232,0.0571,-0.0342,0.908,0.0592,-0.0328,0.884,0.0803,-0.0321,0.8773,0.0929,-0.032,0.9001,0.1047,-0.0324,0.8916,0.1227,-0.0333,0.8102,0.1295,-0.0338,0.8131,0.128,-0.0342,0.8331,0.1284,-0.0345,0.8579,0.1328,-0.0345,0.8934,0.1313,-0.034,0.9858,0.1217,-0.0339,0.9962,0.1189,-0.0342,0.97,0.1228,-0.0343,0.9082,0.126,-0.0345,0.8246,0.1297,-0.0328,0.8222,0.1328,-0.0259,0.852,0.1385,-0.0234,0.9382,0.1348,-0.0249,0.9983,0.1298,-0.0263,0.9695,0.1338,-0.03,0.8732,0.1413,-0.0309,0.7666,0.1462,-0.0309,0.6801,0.1489,-0.0308,0.6825,0.151,-0.0307,0.723,0.154,-0.0306,0.8264,0.1488,-0.0305,0.8987,0.1419,-0.0305,0.8953,0.1423,-0.0307,0.8497,0.1426,-0.0308,0.7623,0.1462,-0.031,0.6771,0.1489,-0.031,0.6803,0.1512,-0.0308,0.7208,0.1542,-0.0307,0.8249,0.149,-0.0305,0.8985,0.1421,-0.0306,0.896,0.1425,-0.0308,0.8502,0.1428,-0.0309,0.7628,0.1464,-0.0311,0.6784,0.1491,-0.0311,0.682,0.1514,-0.0309,0.7224,0.1544,-0.0308,0.8264,0.1492,-0.0307,0.8997,0.1423,-0.0307,0.8967,0.1427,-0.0308,0.8519,0.143,-0.0309,0.7653,0.1466,-0.031,0.6832,0.1496,-0.0297,0.7097,0.1506,-0.0253,0.8011,0.1493,-0.0248,0.9277,0.1401,-0.0268,1.0084,0.131,-0.0275,0.9823,0.1341,-0.0304,0.8799,0.1419,-0.0311,0.7692,0.1467,-0.0315,0.6804,0.1501,-0.0313,0.6825,0.1522,-0.0311,0.7232,0.1552,-0.0309,0.827,0.15,-0.0308,0.8996,0.1434,-0.0308,0.9005,0.1421,-0.0309,0.8709,0.139,-0.0311,0.8003,0.1404,-0.0312,0.7252,0.1416,-0.0293,0.7375,0.1392,-0.0222,0.8488,0.1275,-0.0066,0.9637,0.1094,0.0131,1.005,0.0926,0.0372,1.0143,0.0892,0.0671,0.9851,0.0879,0.1013,0.9385,0.0844,0.1383,0.9215,0.0791,0.1676,0.9401,0.0774,0.1936,0.9738,0.071,0.2152,0.9934,0.0608,0.235,1.0195,0.0529,0.2533,1.0253,0.053,0.2617,0.9349,0.0604,0.2663,0.8554,0.063,0.2647,0.8563,0.0641,0.2497,0.9323,0.062,0.2206,1.0078,0.0572,0.1797,0.9936,0.0521,0.1356,0.9757,0.054,0.0919,0.9231,0.0597,0.0399,0.8566,0.0629,-0.0154,0.7931,0.0605,-0.0677,0.8419,0.0606,-0.12,0.9289,0.0588,-0.1644,1.0053,0.0535,-0.1989,1.0344,0.0455,-0.2181,1.0288,0.0401,-0.221,1.0411,0.0421,-0.2245,1.0239,0.0488,-0.228,0.9371,0.0629,-0.2261,0.9346,0.0687,-0.2194,0.974,0.0671,-0.215,0.9914,0.0632,-0.2093,0.9808,0.0662,-0.1888,0.952,0.0733,-0.1641,0.933,0.0727,-0.1492,0.9266,0.0682,-0.1497,0.9445,0.0675,-0.1519,0.99,0.0721,-0.1578,1.0059,0.0694,-0.1649,0.9931,0.0659,-0.169,0.9945,0.0643,-0.1834,0.9913,0.061,-0.1851,0.9758,0.0538,-0.1857,0.9621,0.0539,-0.1827,1.0031,0.064,-0.1812,1.0106,0.0623,-0.179,1.0139,0.0596,-0.1746,1.0303,0.0629,-0.1529,1.001,0.0575,-0.1447,0.9826,0.0525,-0.1405,0.9641,0.0533,-0.1397,1.0142,0.061,-0.144,1.0235,0.0598,-0.1453,0.9995,0.0561,-0.1453,0.9543,0.0532,-0.1432,0.965,0.0592,-0.1409,0.9325,0.0569,-0.118,0.9562,0.0562,-0.1165,0.9567,0.0559,-0.1153,0.9554,0.0556,-0.1158,0.9562,0.0556,-0.116,0.9564,0.0556,-0.1162,0.9565,0.0556,-0.1163,0.9567,0.0556,-0.1165,0.9569,0.0556,-0.1167,0.957,0.0556,-0.1168,0.9572,0.0556,-0.117,0.9573,0.0556,-0.1172,0.9575,0.0556,-0.1173,0.9577,0.0556,-0.1175,0.9579,0.0557,-0.1177,0.9581,0.0557,-0.1178,0.9583,0.0557,-0.118,0.9585,0.0557,-0.1182,0.9585,0.0557,-0.1184,0.9586,0.0557,-0.1185,0.9587,0.0557,-0.1187,0.9588,0.0557,-0.1189,0.9588,0.0557,-0.1191,0.9587,0.0557,-0.1193,0.9587,0.0557,-0.1195,0.9587,0.0557,-0.1197,0.9586,0.0558,-0.1199,0.9585,0.0558,-0.1198,0.9585,0.0558,-0.1195,0.9583,0.0558,-0.1192,0.9582,0.0558,-0.1187,0.9579,0.0558,-0.1182,0.9577,0.0558,-0.1178,0.9574,0.0558,-0.1174,0.9572,0.0558,-0.1171,0.9571,0.0558,-0.1168,0.9568,0.0558,-0.1164,0.9566,0.0558,-0.1161,0.9563,0.0558,-0.1158,0.9558,0.0558,-0.1155,0.9555,0.0558,-0.1151,0.9552,0.0558,-0.1144,0.9546,0.0559,-0.1101,0.9504,0.0564,-0.1021,0.9432,0.0573,-0.0913,0.9333,0.0585,-0.0784,0.9215,0.06,-0.0643,0.9086,0.0616,-0.0499,0.8955,0.0633,-0.0358,0.8826,0.0649,-0.0229,0.8708,0.0665,-0.012,0.8608,0.0677,-0.0038,0.8533,0.0687,0.0009,0.8489,0.0693,0.0017,0.8481,0.0694]},{"n":"Root_Hips","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[0.0048,0.0111,-0.0158,0.9998,0.0004,0.0028,0.0019,1.0,-0.0025,-0.0044,0.0159,0.9999,-0.0046,-0.0112,0.0274,0.9996,-0.0062,-0.0172,0.0354,0.9992,-0.0066,-0.0186,0.0302,0.9993,-0.0048,-0.0071,0.0078,0.9999,-0.002,0.0044,-0.0094,0.9999,0.0015,0.0143,-0.0223,0.9996,0.0018,0.0197,-0.0172,0.9997,-0.0015,0.0099,0.01,0.9999,-0.0023,0.0003,0.0285,0.9996,-0.0021,-0.0066,0.0372,0.9993,-0.001,-0.0035,0.0127,0.9999,-0.0004,0.0054,-0.0048,1.0,0.0014,0.0131,-0.019,0.9997,0.0031,0.0192,-0.0265,0.9995,-0.0023,0.0114,-0.0054,0.9999,-0.0057,-0.0007,0.0095,0.9999,-0.008,-0.0106,0.0212,0.9997,-0.0095,-0.0177,0.0267,0.9994,-0.0067,-0.0094,0.0067,0.9999,-0.0034,0.002,-0.0078,1.0,0.0003,0.0121,-0.02,0.9997,0.0031,0.0196,-0.0265,0.9995,-0.0011,0.0142,-0.0024,0.9999,-0.0031,0.0031,0.0139,0.9999,-0.0041,-0.0051,0.025,0.9997,-0.0027,-0.0062,0.0082,0.9999,-0.0015,0.0037,-0.0088,1.0,0.0008,0.0124,-0.0219,0.9997,0.0025,0.0207,-0.0213,0.9996,-0.0014,0.0117,-0.0042,0.9999,-0.0048,-0.0004,0.0088,0.9999,-0.0072,-0.0109,0.0191,0.9997,-0.0093,-0.0195,0.0259,0.9994,-0.0078,-0.0166,0.0114,0.9998,-0.0047,-0.0036,-0.0037,1.0,-0.001,0.0077,-0.0167,0.9998,0.0026,0.0173,-0.0264,0.9995,-0.0,0.018,-0.009,0.9998,-0.0027,0.0062,0.0089,0.9999,-0.0038,-0.0025,0.0217,0.9998,-0.0034,-0.007,0.0188,0.9998,-0.002,0.0002,0.0004,1.0,-0.0001,0.0084,-0.0131,0.9999,0.002,0.0156,-0.0233,0.9996,0.0014,0.0183,-0.0198,0.9996,-0.0037,0.0059,-0.0003,1.0,-0.0066,-0.0061,0.0135,0.9999,-0.0086,-0.016,0.0231,0.9996,-0.0088,-0.0195,0.0194,0.9996,-0.0058,-0.0077,0.0011,1.0,-0.0022,0.0041,-0.0126,0.9999,0.0014,0.0143,-0.0231,0.9996,0.0018,0.0195,-0.0188,0.9996,-0.0021,0.0097,0.0035,0.9999,-0.0035,0.0001,0.0184,0.9998,-0.0041,-0.0068,0.0253,0.9996,0.0541,0.0546,0.0144,0.9969,0.0921,0.0955,-0.0028,0.9912,0.124,0.1297,-0.0234,0.9835,0.1482,0.1571,-0.0462,0.9753,0.1642,0.199,-0.0644,0.964,0.1027,0.3163,-0.0132,0.943,0.0059,0.3932,0.0154,0.9193,-0.0798,0.4277,0.0347,0.8997,0.0109,0.2886,0.0211,0.9572,0.0733,0.1727,0.0027,0.9822,0.1264,0.0628,-0.0166,0.9899,0.1729,-0.0367,-0.0222,0.984,0.0447,-0.1815,-0.04,0.9816,-0.0549,-0.2942,-0.0596,0.9523,-0.1519,-0.4073,-0.0821,0.8968,-0.0986,-0.3644,-0.0779,0.9227,0.0362,-0.2375,-0.0479,0.9695,0.1495,-0.1339,-0.0152,0.9795,0.2562,-0.0533,0.0032,0.9652,0.1813,0.0823,0.0144,0.9799,0.0775,0.1978,0.0299,0.9767,-0.0181,0.2908,0.0451,0.9555,-0.1171,0.3664,0.0587,0.9212,-0.054,0.3634,0.0556,0.9284,0.0286,0.3269,0.0292,0.9442,0.1026,0.2879,-0.0087,0.9521,0.1785,0.2472,-0.044,0.9514,0.1287,0.2665,0.0048,0.9552,0.0655,0.2852,0.032,0.9557,0.0017,0.2942,0.0346,0.9551,-0.083,0.2987,0.0207,0.9505,-0.0156,0.2583,0.0109,0.9659,0.0764,0.2226,0.004,0.9719,0.1399,0.1997,-0.0078,0.9698,0.1473,0.1554,-0.0141,0.9767,0.091,0.0555,0.0127,0.9942,0.0441,-0.0162,0.0323,0.9984,0.0066,-0.0686,0.0469,0.9965,-0.017,-0.103,0.0577,0.9929,-0.0124,-0.043,0.0232,0.9987,-0.0081,0.0314,-0.0326,0.9989,-0.0112,0.0864,-0.0825,0.9928,-0.0076,0.1024,-0.0757,0.9918,0.009,0.0924,-0.0026,0.9957,0.0186,0.0856,0.0428,0.9952,0.0235,0.0815,0.0645,0.9943,0.0122,0.0612,0.0054,0.998,0.005,0.0452,-0.0439,0.998,0.0006,0.0319,-0.083,0.996,-0.0013,0.025,-0.1034,0.9943,0.0057,-0.011,-0.0328,0.9994,0.0101,-0.0406,0.0069,0.9991,0.0136,-0.0639,0.032,0.9974,0.0157,-0.0755,0.045,0.996,0.0123,-0.0345,0.0222,0.9991,0.011,-0.0035,-0.0247,0.9996,0.0067,0.0167,-0.0741,0.9971,0.0042,0.0258,-0.099,0.9947,0.0178,0.0201,-0.0585,0.9979,0.0263,0.0135,-0.0356,0.9989,0.0339,0.0068,-0.0197,0.9992,0.0408,0.0007,-0.0085,0.9991,0.0476,-0.0047,-0.0012,0.9989,0.0542,-0.0071,0.0013,0.9985,0.137,-0.0215,-0.0145,0.9902,0.1897,-0.0299,-0.0253,0.9811,0.2304,-0.0363,-0.0332,0.9719,0.2602,-0.0406,-0.039,0.9639,0.2833,-0.0437,-0.0429,0.9571,0.3025,-0.0457,-0.0453,0.951,0.3111,-0.0467,-0.0465,0.9481,0.3062,-0.0462,-0.046,0.9497,0.3024,-0.0458,-0.0455,0.951,0.299,-0.0454,-0.045,0.9521,0.2966,-0.0452,-0.0449,0.9529,0.3064,-0.0448,-0.0455,0.9498,0.3158,-0.0447,-0.0459,0.9467,0.3176,-0.0446,-0.0461,0.946,0.3149,-0.0128,-0.035,0.9484,0.3009,0.0778,0.0013,0.9505,0.2921,0.1321,0.0291,0.9468,0.2867,0.1621,0.0472,0.943,0.2707,0.1144,0.0274,0.9555,0.2297,-0.0247,-0.0347,0.9723,0.2306,-0.0614,-0.0512,0.9698,0.2377,-0.0636,-0.0535,0.9678,0.2372,-0.063,-0.053,0.968,0.2283,-0.0622,-0.0523,0.9702,0.2208,-0.0617,-0.0518,0.972,0.2177,-0.0614,-0.0513,0.9727,0.2189,-0.0615,-0.0514,0.9724,0.2257,-0.063,-0.0528,0.9707,0.2337,-0.0641,-0.0538,0.9687,0.2399,-0.065,-0.0546,0.9671,0.2385,-0.0652,-0.0548,0.9674,0.2299,-0.0637,-0.0535,0.9697,0.2218,-0.0626,-0.0525,0.9717,0.2179,-0.0617,-0.0515,0.9727,0.2184,-0.0614,-0.0513,0.9726,0.2253,-0.0629,-0.0528,0.9708,0.2333,-0.064,-0.0538,0.9688,0.2389,-0.0649,-0.0545,0.9673,0.2372,-0.065,-0.0546,0.9677,0.2287,-0.0635,-0.0533,0.97,0.2206,-0.0623,-0.0523,0.972,0.2169,-0.0615,-0.0513,0.9729,0.2178,-0.0612,-0.0511,0.9727,0.2246,-0.0615,-0.0516,0.9711,0.2321,-0.0619,-0.052,0.9693,0.2358,-0.0621,-0.0522,0.9684,0.2369,-0.0305,-0.0379,0.9703,0.2553,0.0656,0.0089,0.9646,0.2686,0.1316,0.0423,0.9533,0.275,0.1707,0.0622,0.9441,0.2637,0.1233,0.039,0.9559,0.2259,-0.0214,-0.0314,0.9734,0.2289,-0.0605,-0.0506,0.9703,0.2374,-0.0635,-0.0536,0.9678,0.2372,-0.063,-0.0531,0.968,0.2282,-0.0621,-0.0523,0.9702,0.2203,-0.0613,-0.0517,0.9721,0.2171,-0.0609,-0.051,0.9729,0.2149,-0.0609,-0.0501,0.9734,0.21,-0.0612,-0.0488,0.9746,0.2062,-0.0612,-0.0475,0.9754,0.2039,-0.0611,-0.0466,0.976,0.1897,-0.0587,-0.0426,0.9792,0.1477,-0.0465,-0.0286,0.9875,0.1163,-0.0346,-0.0159,0.9925,0.0873,-0.0245,-0.0034,0.9959,0.0614,-0.0168,0.0082,0.9979,0.038,-0.0122,0.0185,0.999,0.0417,0.0201,0.024,0.9986,0.0463,0.046,0.0279,0.9975,0.0497,0.0629,0.0296,0.9963,0.0471,0.0687,0.027,0.9962,0.0465,0.051,0.0191,0.9974,0.0468,0.0328,0.0115,0.9983,0.0481,0.0171,0.0052,0.9987,0.0502,0.0058,0.0013,0.9987,0.0539,-0.0059,-0.004,0.9985,0.0476,-0.0068,-0.0098,0.9988,0.0392,-0.0033,-0.0156,0.9991,0.0316,0.0014,-0.0201,0.9993,0.0269,0.0002,-0.0207,0.9994,0.0225,-0.0004,-0.0205,0.9995,0.0182,-0.0002,-0.0195,0.9996,0.0142,0.0015,-0.018,0.9997,0.0038,0.0152,-0.0184,0.9997,0.0041,0.0208,-0.0183,0.9996,0.0071,0.0234,-0.0164,0.9996,0.0109,0.0256,-0.0095,0.9996,0.0167,0.025,-0.0068,0.9995,0.0216,0.0259,-0.0038,0.9994,0.0256,0.0267,-0.0013,0.9993,0.0289,0.0263,0.0006,0.9992,0.0449,0.0229,0.0023,0.9987,0.0585,0.0155,0.0018,0.9982,0.067,0.0077,0.0008,0.9977,0.0707,0.0026,0.0002,0.9975,0.0593,0.0009,0.0001,0.9982,0.0232,0.0028,0.0003,0.9997,-0.0038,0.0047,0.0002,1.0,-0.0226,0.0058,0.0002,0.9997,-0.0166,0.0054,0.0004,0.9998,0.0201,0.0027,0.0004,0.9998,0.0479,0.0005,0.0006,0.9989,0.065,-0.0019,0.0005,0.9979,0.0617,-0.0036,-0.0001,0.9981,0.0381,-0.0044,-0.0011,0.9993,0.0202,-0.0049,-0.0015,0.9998,0.0118,-0.0041,-0.001,0.9999,0.0172,-0.003,-0.0003,0.9998,0.0366,-0.0022,-0.0001,0.9993,0.0481,-0.0016,0.0004,0.9988,0.0502,-0.0014,0.0009,0.9987,0.0344,0.0016,0.0004,0.9994,0.0228,0.0041,0.0003,0.9997,0.0203,0.0062,-0.0002,0.9998,0.0365,0.006,-0.0007,0.9993,0.0546,0.0056,-0.0011,0.9985,0.0683,0.0053,-0.0013,0.9976,0.0753,0.0046,-0.0014,0.9971,0.0574,0.0057,-0.002,0.9983,0.036,0.0069,-0.0025,0.9993,0.0192,0.0079,-0.0028,0.9998,0.0085,0.0086,-0.0028,0.9999,0.0068,0.0088,-0.0027,0.9999,0.007,0.0088,-0.0027,0.9999,0.007,0.0088,-0.0027,0.9999,0.007,0.0088,-0.0026,0.9999,0.007,0.0088,-0.0026,0.9999,0.007,0.0088,-0.0026,0.9999,0.0069,0.0088,-0.0026,0.9999,0.0069,0.0088,-0.0026,0.9999,0.0069,0.0088,-0.0025,0.9999,0.0069,0.0088,-0.0025,0.9999,0.0069,0.0088,-0.0025,0.9999,0.0069,0.0088,-0.0025,0.9999,0.0069,0.0088,-0.0025,0.9999,0.0069,0.0088,-0.0024,0.9999,0.0069,0.0088,-0.0024,0.9999,0.0069,0.0088,-0.0024,0.9999,0.0069,0.0088,-0.0024,0.9999,0.0069,0.0088,-0.0024,0.9999,0.0069,0.0088,-0.0023,0.9999,0.0069,0.0088,-0.0023,0.9999,0.0069,0.0088,-0.0023,0.9999,0.0069,0.0088,-0.0024,0.9999,0.0069,0.0088,-0.0024,0.9999,0.0069,0.0088,-0.0024,0.9999,0.0069,0.0088,-0.0025,0.9999,0.0069,0.0088,-0.0025,0.9999,0.0069,0.0087,-0.0025,0.9999,0.0069,0.0087,-0.0026,0.9999,0.0069,0.0087,-0.0026,0.9999,0.0069,0.0087,-0.0027,0.9999,0.0069,0.0087,-0.0027,0.9999,0.0069,0.0087,-0.0028,0.9999,0.0069,0.0087,-0.0028,0.9999,0.0069,0.0087,-0.0029,0.9999,0.0069,0.0087,-0.0029,0.9999,0.007,0.0087,-0.0029,0.9999,0.007,0.0086,-0.003,0.9999,0.007,0.0086,-0.003,0.9999,0.007,0.0086,-0.003,0.9999,0.007,0.0086,-0.0031,0.9999,0.0069,0.0087,-0.0036,0.9999,0.0068,0.0088,-0.0044,0.9999,0.0066,0.0091,-0.0056,0.9999,0.0064,0.0093,-0.007,0.9999,0.0061,0.0096,-0.0085,0.9999,0.0058,0.01,-0.0101,0.9999,0.0055,0.0103,-0.0117,0.9999,0.0053,0.0106,-0.0131,0.9998,0.0051,0.0108,-0.0143,0.9998,0.0049,0.011,-0.0152,0.9998,0.0048,0.0111,-0.0157,0.9998,0.0048,0.0111,-0.0158,0.9998]},{"n":"Torso","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[-0.0041,-0.0029,-0.0366,0.9993,-0.0114,-0.0015,-0.0063,0.9999,-0.0176,-0.0001,0.018,0.9997,-0.0232,0.0015,0.0373,0.999,-0.0276,0.0029,0.0495,0.9984,-0.0308,0.0031,0.0149,0.9994,-0.0346,0.0007,-0.0175,0.9992,-0.0393,-0.0014,-0.0177,0.9991,-0.0434,-0.0033,-0.0124,0.999,-0.0458,-0.003,0.0459,0.9979,-0.0333,0.0004,0.076,0.9965,-0.0228,0.0037,0.0609,0.9979,-0.0165,0.0064,0.0337,0.9993,-0.0183,0.0062,-0.0534,0.9984,-0.0284,0.0018,-0.0356,0.999,-0.0373,-0.0016,-0.0238,0.999,-0.0446,-0.0036,-0.003,0.999,-0.0442,-0.0019,0.0681,0.9967,-0.0398,-0.0001,0.0599,0.9974,-0.0367,0.0015,0.0548,0.9978,-0.0352,0.0025,0.0412,0.9985,-0.0358,0.0013,-0.0256,0.999,-0.0394,-0.0012,-0.0177,0.9991,-0.0429,-0.0028,-0.0124,0.999,-0.0458,-0.0038,0.0011,0.9989,-0.0413,-0.0014,0.0707,0.9966,-0.0294,0.0018,0.0396,0.9988,-0.0222,0.0048,0.0164,0.9996,-0.0186,0.0066,-0.0806,0.9966,-0.029,0.0015,-0.0523,0.9982,-0.0387,-0.0022,-0.0283,0.9988,-0.0455,-0.0031,0.0282,0.9986,-0.0427,-0.0016,0.0485,0.9979,-0.0396,-0.0002,0.0383,0.9985,-0.0375,0.001,0.0276,0.9989,-0.0363,0.0021,0.017,0.9992,-0.0357,0.0016,-0.0561,0.9978,-0.0387,-0.0007,-0.0388,0.9985,-0.0418,-0.0025,-0.0257,0.9988,-0.0449,-0.0037,-0.0123,0.9989,-0.0456,-0.0023,0.0752,0.9961,-0.0325,0.0008,0.0471,0.9984,-0.0241,0.0039,0.0231,0.9994,-0.0192,0.0063,-0.0373,0.9991,-0.0243,0.0036,-0.0547,0.9982,-0.0328,-0.0,-0.0371,0.9988,-0.0405,-0.0026,-0.0182,0.999,-0.0457,-0.0032,0.0338,0.9984,-0.0423,-0.0014,0.0532,0.9977,-0.039,0.0002,0.0404,0.9984,-0.0366,0.0016,0.0253,0.999,-0.0358,0.002,-0.0243,0.9991,-0.0377,0.0,-0.0433,0.9984,-0.0407,-0.002,-0.0305,0.9987,-0.0439,-0.0033,-0.0154,0.9989,-0.0465,-0.0033,0.0393,0.9981,-0.0362,-0.0003,0.055,0.9978,-0.0265,0.0029,0.0317,0.9991,-0.0205,0.0055,0.0015,0.9998,-0.0009,-0.0548,-0.0244,0.9982,-0.0653,-0.0942,0.0119,0.9933,-0.1118,-0.1269,0.0566,0.984,-0.1508,-0.1535,0.1075,0.9706,-0.1454,-0.1895,0.1525,0.959,-0.0627,-0.138,0.0806,0.9851,0.0904,-0.049,0.0195,0.9945,0.2113,-0.0191,0.0146,0.9771,0.1327,-0.0362,0.0353,0.9899,0.0703,-0.0621,0.0406,0.9948,0.0052,-0.0685,0.033,0.9971,-0.0645,-0.0314,0.0059,0.9974,0.0886,-0.0025,-0.0448,0.9951,0.195,0.0191,-0.0481,0.9794,0.2986,0.0696,-0.0231,0.9516,0.234,-0.0631,-0.0266,0.9698,0.0623,0.0108,-0.0284,0.9976,-0.098,0.0574,-0.0256,0.9932,-0.2594,0.0623,-0.0129,0.9637,-0.1322,0.0514,-0.0035,0.9899,0.0444,0.0703,-0.0085,0.9965,0.1985,0.0777,-0.0104,0.977,0.3388,0.0539,-0.0112,0.9392,0.226,-0.0482,-0.0153,0.9728,0.0678,-0.1479,0.0235,0.9864,-0.068,-0.2114,0.082,0.9716,-0.1898,-0.2375,0.1324,0.9434,-0.0772,-0.1326,0.057,0.9865,0.0659,-0.0144,0.021,0.9975,0.1954,0.0963,0.0273,0.9756,0.3281,0.2043,0.0738,0.9193,0.2228,0.158,0.0349,0.9613,0.0633,0.0729,0.0014,0.9953,-0.0696,-0.0178,0.0018,0.9974,-0.1102,-0.0807,0.0013,0.9906,-0.0274,-0.0481,-0.0574,0.9968,0.0318,-0.0169,-0.0993,0.9944,0.0771,0.0132,-0.1293,0.9885,0.1053,0.0331,-0.1534,0.982,0.0925,0.0593,-0.0415,0.9931,0.0603,0.087,0.0868,0.9906,0.0284,0.1081,0.1789,0.9775,0.0223,0.0903,0.1576,0.9831,0.0278,0.0052,-0.0062,0.9996,0.0213,-0.0581,-0.1238,0.9904,0.0142,-0.0901,-0.1844,0.9786,0.026,-0.0807,-0.0036,0.9964,0.0361,-0.0718,0.1418,0.9866,0.044,-0.0654,0.2533,0.9642,0.0485,-0.0629,0.3101,0.9474,0.0658,-0.0729,0.1407,0.9852,0.0735,-0.0767,0.0022,0.9943,0.0753,-0.077,-0.1063,0.9885,0.0744,-0.0763,-0.162,0.981,0.0708,-0.064,-0.0345,0.9948,0.0616,-0.0512,0.068,0.9945,0.0506,-0.0395,0.1474,0.987,0.0438,-0.0329,0.1882,0.9806,0.0734,-0.0262,0.1416,0.9869,0.094,-0.0199,0.1055,0.9898,0.1131,-0.0138,0.0719,0.9909,0.1312,-0.0079,0.0415,0.9905,0.149,-0.0029,0.0149,0.9887,0.1672,0.0012,-0.006,0.9859,0.2583,-0.0033,-0.0133,0.966,0.3111,-0.0058,-0.0172,0.9502,0.3408,-0.0078,-0.0196,0.9399,0.3546,-0.0093,-0.0203,0.9347,0.3573,-0.0106,-0.0204,0.9337,0.3495,-0.0117,-0.0194,0.9366,0.3359,-0.0124,-0.0183,0.9416,0.3302,-0.013,-0.0177,0.9437,0.3258,-0.0137,-0.0172,0.9452,0.3213,-0.0142,-0.0169,0.9467,0.3147,-0.0149,-0.0166,0.9489,0.3471,-0.0124,-0.0173,0.9376,0.3702,-0.0104,-0.0183,0.9287,0.381,-0.0095,-0.0186,0.9243,0.381,-0.0412,-0.0189,0.9235,0.3769,-0.1385,-0.0222,0.9156,0.3713,-0.2028,-0.0271,0.9057,0.3665,-0.24,-0.0317,0.8984,0.4014,-0.194,-0.0347,0.8945,0.4936,-0.0418,-0.0296,0.8682,0.4995,-0.0047,-0.0279,0.8659,0.4994,-0.0064,-0.028,0.8659,0.4994,-0.0063,-0.0281,0.8659,0.4994,-0.0067,-0.0284,0.8659,0.4994,-0.0072,-0.0285,0.8659,0.4941,-0.0078,-0.0284,0.8689,0.4953,-0.0079,-0.0283,0.8682,0.4994,-0.0074,-0.0281,0.8659,0.4994,-0.0069,-0.028,0.8659,0.4994,-0.0066,-0.0279,0.8659,0.4994,-0.0065,-0.028,0.8659,0.4994,-0.007,-0.0283,0.8659,0.4994,-0.0074,-0.0284,0.8659,0.4941,-0.008,-0.0283,0.8689,0.4953,-0.008,-0.0282,0.8682,0.4994,-0.0074,-0.028,0.8659,0.4994,-0.007,-0.0279,0.8659,0.4994,-0.0066,-0.0279,0.8659,0.4994,-0.0065,-0.028,0.8659,0.4994,-0.007,-0.0283,0.8659,0.4994,-0.0074,-0.0284,0.8659,0.4941,-0.0079,-0.0284,0.8689,0.4953,-0.0079,-0.0284,0.8682,0.4994,-0.0074,-0.0281,0.8659,0.4994,-0.0069,-0.028,0.8659,0.4994,-0.0065,-0.028,0.8659,0.4991,-0.0401,-0.0297,0.8651,0.4494,-0.1405,-0.0327,0.8816,0.4023,-0.2041,-0.033,0.8918,0.3725,-0.2402,-0.033,0.8958,0.4014,-0.194,-0.0345,0.8945,0.4937,-0.0419,-0.0296,0.8681,0.4995,-0.0047,-0.028,0.8659,0.4994,-0.0064,-0.028,0.8659,0.4994,-0.0063,-0.0281,0.8659,0.4994,-0.0067,-0.0284,0.8659,0.4994,-0.0072,-0.0285,0.8659,0.494,-0.0078,-0.0286,0.8689,0.4833,-0.0091,-0.0281,0.875,0.4544,-0.0126,-0.0258,0.8903,0.4346,-0.015,-0.0242,0.9002,0.4228,-0.0161,-0.0235,0.9058,0.4024,0.0161,-0.0124,0.9153,0.3435,0.1123,0.018,0.9322,0.2925,0.1893,0.0429,0.9364,0.2443,0.2592,0.065,0.9322,0.1985,0.3235,0.084,0.9213,0.1564,0.3831,0.1,0.9048,0.11,0.3938,0.108,0.9062,0.0743,0.4008,0.1122,0.9062,0.0493,0.3793,0.1098,0.9174,0.0268,0.3085,0.1007,0.9455,-0.0053,0.2174,0.0686,0.9736,-0.034,0.1359,0.0438,0.9892,-0.0592,0.067,0.0242,0.9957,-0.0774,0.0208,0.0099,0.9967,-0.0845,-0.0303,-0.0005,0.996,-0.059,-0.0944,-0.0163,0.9937,-0.0286,-0.1582,-0.0357,0.9864,-0.0021,-0.2135,-0.0547,0.9754,0.0211,-0.2618,-0.0737,0.9621,0.041,-0.3029,-0.0912,0.9478,0.0575,-0.3349,-0.1067,0.9344,0.0703,-0.3562,-0.1187,0.9242,0.0703,-0.3312,-0.1204,0.9332,0.0491,-0.2724,-0.0975,0.956,0.0223,-0.206,-0.0715,0.9757,-0.0031,-0.144,-0.0493,0.9883,-0.0274,-0.0861,-0.0301,0.9955,-0.0497,-0.034,-0.0142,0.9981,-0.0685,0.0093,-0.0009,0.9976,-0.0823,0.0395,0.0083,0.9958,-0.0447,0.0403,0.0174,0.998,0.0057,0.0248,0.0146,0.9996,0.0477,0.0105,0.008,0.9988,0.0698,0.0028,0.0029,0.9976,0.0916,0.0038,0.0007,0.9958,0.1412,0.0077,0.0012,0.9899,0.1776,0.0119,0.0022,0.984,0.2079,0.0113,0.0027,0.9781,0.2064,0.0081,0.003,0.9784,0.1654,0.0035,0.0026,0.9862,0.1346,0.0006,0.003,0.9909,0.0986,-0.0029,0.0017,0.9951,0.0805,-0.0067,-0.0007,0.9967,0.0811,-0.0105,-0.0043,0.9966,0.0822,-0.0131,-0.0071,0.9965,0.1003,-0.0116,-0.0068,0.9949,0.1156,-0.0083,-0.0042,0.9933,0.1224,-0.0044,-0.0003,0.9925,0.118,-0.0012,0.0024,0.993,0.1007,0.0038,0.0036,0.9949,0.0888,0.0097,0.0034,0.996,0.0827,0.0131,0.0032,0.9965,0.1005,0.0155,0.0011,0.9948,0.1109,0.0167,-0.0015,0.9937,0.118,0.018,-0.0043,0.9928,0.1201,0.0188,-0.0062,0.9926,0.1097,0.0202,-0.0084,0.9937,0.1218,0.022,-0.01,0.9923,0.1381,0.0239,-0.0116,0.9901,0.1525,0.0253,-0.0126,0.9879,0.1634,0.026,-0.0129,0.9861,0.1648,0.0259,-0.0127,0.9859,0.1651,0.0258,-0.0126,0.9859,0.1652,0.0258,-0.0126,0.9858,0.1653,0.0258,-0.0124,0.9858,0.1654,0.0257,-0.0123,0.9858,0.1654,0.0257,-0.0122,0.9858,0.1655,0.0256,-0.0121,0.9858,0.1655,0.0256,-0.012,0.9858,0.1656,0.0255,-0.0119,0.9858,0.1657,0.0255,-0.0118,0.9858,0.1657,0.0255,-0.0117,0.9858,0.1658,0.0254,-0.0116,0.9858,0.1658,0.0254,-0.0115,0.9858,0.1659,0.0254,-0.0114,0.9858,0.1659,0.0253,-0.0113,0.9857,0.166,0.0253,-0.0112,0.9857,0.1661,0.0253,-0.0111,0.9857,0.1661,0.0252,-0.011,0.9857,0.1662,0.0252,-0.0109,0.9857,0.1662,0.0252,-0.0108,0.9857,0.1663,0.0252,-0.0107,0.9857,0.1663,0.0252,-0.0108,0.9857,0.1664,0.0252,-0.0111,0.9857,0.1665,0.0253,-0.0113,0.9857,0.1665,0.0253,-0.0115,0.9856,0.1666,0.0254,-0.0117,0.9856,0.1666,0.0254,-0.012,0.9856,0.1667,0.0255,-0.0122,0.9856,0.1668,0.0255,-0.0124,0.9856,0.1668,0.0256,-0.0126,0.9856,0.1669,0.0257,-0.0128,0.9856,0.1669,0.0257,-0.013,0.9855,0.167,0.0258,-0.0133,0.9855,0.167,0.0258,-0.0135,0.9855,0.1671,0.0259,-0.0137,0.9855,0.1672,0.026,-0.0139,0.9855,0.1672,0.026,-0.0141,0.9855,0.1673,0.0261,-0.0143,0.9855,0.1673,0.0261,-0.0146,0.9854,0.1668,0.0261,-0.0149,0.9855,0.1611,0.0251,-0.0158,0.9865,0.1498,0.0233,-0.0174,0.9883,0.1343,0.0206,-0.0195,0.9905,0.1156,0.0175,-0.0219,0.9929,0.095,0.014,-0.0245,0.9951,0.0736,0.0103,-0.0272,0.9969,0.0526,0.0068,-0.0298,0.9981,0.0332,0.0035,-0.0321,0.9989,0.0168,0.0006,-0.0341,0.9993,0.0043,-0.0015,-0.0356,0.9994,-0.0028,-0.0027,-0.0364,0.9993,-0.0041,-0.0029,-0.0366,0.9993]},{"n":"Head","p":"t","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[0.0696,1.5977,0.0037,-0.0088,1.5827,-0.0109,-0.0769,1.5094,-0.023,-0.1354,1.4081,-0.034,-0.1729,1.3396,-0.0437,-0.1218,1.3234,-0.0465,-0.027,1.4006,-0.0456,0.0181,1.5137,-0.0512,0.0487,1.5916,-0.0564,-0.0379,1.6283,-0.0582,-0.1466,1.691,-0.0501,-0.1814,1.7452,-0.0506,-0.1722,1.7523,-0.0513,-0.0051,1.7414,-0.0441,0.0197,1.7107,-0.0493,0.0481,1.6792,-0.0544,0.0439,1.6609,-0.0606,-0.0949,1.6174,-0.0621,-0.1236,1.542,-0.0603,-0.1515,1.4354,-0.0599,-0.1506,1.3844,-0.0612,-0.0156,1.429,-0.0509,0.0198,1.5324,-0.0529,0.0507,1.5936,-0.0556,0.0403,1.621,-0.0574,-0.1151,1.6834,-0.0578,-0.1211,1.7335,-0.0568,-0.1246,1.7435,-0.0599,0.0378,1.7319,-0.0478,0.0511,1.7081,-0.0512,0.0644,1.6677,-0.0554,-0.0076,1.646,-0.0595,-0.0706,1.6138,-0.0578,-0.0934,1.5429,-0.0576,-0.1111,1.4507,-0.0585,-0.1157,1.3903,-0.0614,0.0102,1.4006,-0.0513,0.0336,1.4962,-0.0523,0.0583,1.5804,-0.0549,0.0606,1.6062,-0.0567,-0.1044,1.6592,-0.0588,-0.1176,1.7213,-0.0559,-0.1266,1.7433,-0.0585,-0.0435,1.7421,-0.0531,0.0291,1.725,-0.048,0.052,1.6836,-0.0499,0.058,1.6445,-0.0555,-0.0235,1.6181,-0.0594,-0.0941,1.5656,-0.0593,-0.1147,1.4775,-0.0595,-0.1195,1.404,-0.0603,-0.0505,1.3869,-0.0568,0.0202,1.4411,-0.0521,0.0426,1.531,-0.0541,0.0563,1.5919,-0.057,-0.0235,1.6289,-0.0591,-0.1019,1.7023,-0.057,-0.1177,1.7161,-0.0636,-0.0969,1.647,-0.0656,-0.0452,1.683,0.0627,-0.0676,1.731,0.0472,-0.095,1.6723,0.049,-0.1325,1.6531,0.0427,-0.1644,1.6694,0.0832,-0.1786,1.6509,0.1383,-0.0991,1.6892,0.1363,-0.0565,1.666,0.1206,-0.1046,1.684,0.2109,-0.1071,1.6765,0.2297,-0.0656,1.6034,0.2185,-0.0043,1.5691,0.1993,0.0711,1.5667,0.2246,0.0638,1.611,0.2098,0.0216,1.6246,0.1503,0.0555,1.7125,0.1478,0.1089,1.675,0.1682,0.0671,1.7023,0.1274,-0.01,1.6531,0.0681,-0.0869,1.5708,0.1224,-0.0846,1.5842,0.1882,-0.0304,1.6309,0.2103,0.0418,1.6024,0.1838,-0.0374,1.6175,0.1847,-0.1279,1.6243,0.1628,-0.1719,1.6155,0.1112,-0.1787,1.6125,0.0535,-0.1732,1.5805,0.1409,-0.1265,1.5854,0.2211,-0.0576,1.6877,0.2607,0.024,1.6909,0.2731,-0.0242,1.7265,0.2462,-0.0714,1.6965,0.1992,-0.0894,1.6523,0.1378,-0.0569,1.6463,0.0918,0.0115,1.6371,0.1112,0.0502,1.6859,0.1207,0.07,1.7473,0.1248,0.0825,1.7631,0.1299,-0.0041,1.771,0.1,-0.0903,1.7335,0.0842,-0.1435,1.6885,0.0785,-0.1264,1.6862,0.0694,-0.0099,1.7242,0.0458,0.0836,1.7553,0.0273,0.1344,1.7409,0.0213,-0.0154,1.7703,0.0394,-0.1352,1.742,0.05,-0.227,1.6816,0.0522,-0.2737,1.6542,0.0502,-0.1581,1.7023,0.0805,-0.0394,1.7551,0.1101,0.0609,1.7727,0.1355,0.1118,1.7629,0.151,-0.0121,1.7867,0.11,-0.0713,1.7434,0.0927,-0.1004,1.6837,0.0768,-0.1174,1.6642,0.0677,-0.117,1.6647,0.1283,-0.1056,1.7022,0.1648,-0.089,1.7526,0.192,-0.0727,1.7043,0.2149,-0.0542,1.6533,0.2459,-0.0311,1.6285,0.2798,-0.0127,1.492,0.5139,-0.0083,1.383,0.6346,-0.0093,1.3249,0.7073,-0.012,1.2617,0.7584,-0.015,1.1457,0.7837,-0.0171,1.1319,0.7917,-0.0172,1.1568,0.7918,-0.0167,1.1955,0.7901,-0.0164,1.2416,0.7836,-0.0153,1.344,0.7692,-0.0141,1.3657,0.7609,-0.0191,1.2866,0.788,-0.0221,1.1823,0.8063,-0.0234,1.082,0.8148,-0.0065,1.0841,0.8157,0.0379,1.1395,0.8091,0.0564,1.2432,0.7966,0.0618,1.3146,0.7859,0.0437,1.2648,0.7957,-0.0205,1.1025,0.8144,-0.0379,0.9858,0.8214,-0.0405,0.8896,0.8272,-0.0399,0.8926,0.829,-0.0383,0.9454,0.8281,-0.0372,1.0592,0.8194,-0.0358,1.1432,0.8096,-0.0365,1.1365,0.8109,-0.039,1.0758,0.8155,-0.0406,0.9774,0.8227,-0.042,0.8835,0.8281,-0.0418,0.8887,0.8298,-0.0397,0.9411,0.829,-0.0381,1.0563,0.8201,-0.0363,1.1428,0.8098,-0.0366,1.1379,0.8108,-0.0392,1.077,0.8155,-0.0408,0.9785,0.8227,-0.0419,0.8862,0.8278,-0.0417,0.8921,0.8294,-0.0395,0.9444,0.8286,-0.0379,1.0595,0.8197,-0.0361,1.1454,0.8095,-0.0363,1.1393,0.8107,-0.0381,1.0795,0.8154,-0.0391,0.9825,0.8224,-0.0395,0.8953,0.827,-0.0253,0.9212,0.8283,0.0202,1.0555,0.8212,0.0446,1.2242,0.8014,0.054,1.3325,0.783,0.0405,1.2871,0.7919,-0.0192,1.1144,0.8131,-0.0373,0.9908,0.8211,-0.041,0.8902,0.8283,-0.0403,0.8926,0.8302,-0.0384,0.9457,0.8293,-0.037,1.0605,0.8204,-0.0356,1.145,0.8108,-0.0347,1.1639,0.805,-0.0333,1.1804,0.7881,-0.0324,1.141,0.778,-0.0316,1.0841,0.7716,-0.0259,1.1405,0.7462,-0.0174,1.3662,0.6527,-0.0189,1.5565,0.5568,-0.0286,1.6524,0.4624,-0.0413,1.698,0.3858,-0.0506,1.6897,0.3186,-0.0434,1.6495,0.2819,-0.0283,1.6339,0.255,-0.0107,1.6552,0.2308,0.0154,1.6978,0.1787,0.0737,1.7336,0.0948,0.1368,1.767,0.0302,0.1987,1.7742,-0.0102,0.2414,1.6823,-0.026,0.2816,1.6022,-0.0269,0.32,1.6052,0.0,0.3434,1.6804,0.03,0.345,1.7523,0.0555,0.3253,1.7333,0.0837,0.2963,1.7098,0.1155,0.2626,1.6514,0.1461,0.2163,1.5804,0.1669,0.1665,1.5186,0.1403,0.095,1.577,0.0952,0.0116,1.672,0.048,-0.073,1.7533,0.0066,-0.1415,1.7834,-0.0284,-0.1941,1.7763,-0.056,-0.2271,1.7858,-0.0705,-0.2525,1.7657,-0.0739,-0.2645,1.6887,0.011,-0.2504,1.6896,0.0987,-0.2307,1.7245,0.1612,-0.2187,1.7372,0.1899,-0.2103,1.7246,0.2027,-0.1896,1.693,0.2171,-0.1646,1.6712,0.2213,-0.1494,1.661,0.2263,-0.1511,1.6774,0.2325,-0.1547,1.7246,0.2408,-0.1623,1.741,0.2416,-0.1682,1.7334,0.2194,-0.1685,1.7402,0.1908,-0.1766,1.742,0.1529,-0.174,1.7291,0.1203,-0.1761,1.7142,0.1302,-0.1776,1.7517,0.1673,-0.1813,1.7529,0.2028,-0.1829,1.7539,0.2117,-0.1808,1.7743,0.1971,-0.1578,1.7511,0.1534,-0.149,1.7356,0.1234,-0.1409,1.7148,0.1425,-0.1355,1.7593,0.1873,-0.1354,1.7615,0.2214,-0.1339,1.732,0.2405,-0.1315,1.6877,0.2352,-0.1258,1.7008,0.2294,-0.1199,1.6703,0.2151,-0.0946,1.6948,0.2071,-0.092,1.6953,0.2043,-0.0912,1.6941,0.2032,-0.0918,1.6948,0.2039,-0.092,1.6949,0.204,-0.0923,1.6951,0.2041,-0.0927,1.6952,0.2042,-0.093,1.6954,0.2043,-0.0933,1.6955,0.2044,-0.0937,1.6957,0.2044,-0.094,1.6958,0.2045,-0.0943,1.696,0.2046,-0.0947,1.6961,0.2047,-0.095,1.6964,0.2047,-0.0953,1.6966,0.2048,-0.0956,1.6967,0.2049,-0.096,1.6969,0.205,-0.0963,1.6969,0.205,-0.0966,1.697,0.2051,-0.097,1.6971,0.2052,-0.0973,1.6972,0.2053,-0.0977,1.6971,0.2053,-0.0979,1.6971,0.2054,-0.0979,1.697,0.2055,-0.0978,1.6969,0.2055,-0.0976,1.6969,0.2056,-0.0974,1.6968,0.2057,-0.097,1.6967,0.2058,-0.0964,1.6965,0.2058,-0.0957,1.6963,0.2059,-0.0949,1.6961,0.206,-0.0941,1.6958,0.2061,-0.0933,1.6954,0.2061,-0.0926,1.6953,0.2062,-0.092,1.6951,0.2063,-0.0913,1.6948,0.2064,-0.0906,1.6945,0.2064,-0.09,1.6942,0.2065,-0.0893,1.6937,0.2066,-0.0887,1.6934,0.2067,-0.0881,1.6931,0.2068,-0.0869,1.6924,0.2062,-0.0809,1.6886,0.1993,-0.0701,1.6822,0.1859,-0.0554,1.6733,0.1674,-0.0381,1.6628,0.1452,-0.0191,1.6514,0.1207,0.0003,1.6396,0.0954,0.0192,1.6282,0.0706,0.0365,1.6178,0.0478,0.0512,1.6089,0.0283,0.0622,1.6022,0.0137,0.0685,1.5984,0.0052,0.0696,1.5977,0.0037]},{"n":"Head","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[0.0123,0.0564,-0.0618,0.9964,0.0265,0.0406,0.0186,0.9987,0.0384,0.0283,0.0834,0.9954,0.0487,0.0181,0.1354,0.9894,0.0556,0.0099,0.1695,0.9839,0.058,0.0009,0.1201,0.9911,0.0563,-0.0001,0.0251,0.9981,0.0569,0.0083,-0.0658,0.9962,0.0571,0.0169,-0.1296,0.9898,0.057,0.0293,-0.0898,0.9939,0.0697,0.0283,-0.0081,0.9971,0.0805,0.0146,0.0832,0.9932,0.0866,0.0022,0.125,0.9884,0.0824,-0.0047,0.0231,0.9963,0.0701,0.01,-0.0266,0.9971,0.0602,0.0241,-0.0846,0.9943,0.0525,0.0359,-0.1123,0.9916,0.0456,0.0367,-0.0442,0.9973,0.0457,0.0194,0.0218,0.9985,0.0443,0.0033,0.0994,0.9941,0.0422,-0.0089,0.1482,0.988,0.0439,-0.0109,0.086,0.9953,0.0451,0.001,-0.0033,0.999,0.0455,0.0121,-0.1064,0.9932,0.0445,0.0214,-0.1735,0.9836,0.0421,0.0153,-0.147,0.9881,0.055,0.0008,-0.035,0.9979,0.0645,-0.0103,0.11,0.9918,0.069,-0.0097,0.0785,0.9945,0.0593,0.0125,0.0497,0.9969,0.052,0.0311,-0.094,0.9937,0.0458,0.0474,-0.1109,0.9917,0.0479,0.0455,-0.0396,0.997,0.0496,0.03,0.0313,0.9978,0.0506,0.0161,0.0863,0.9949,0.05,0.0045,0.1199,0.9915,0.0538,-0.0085,0.0121,0.9984,0.0535,-0.001,-0.0317,0.9981,0.0559,0.0094,-0.1017,0.9932,0.0567,0.0197,-0.1497,0.9869,0.0568,0.0315,-0.0436,0.9969,0.0703,0.0195,-0.0095,0.9973,0.078,0.0053,0.0625,0.995,0.0818,-0.0073,0.0422,0.9957,0.0743,-0.003,0.0053,0.9972,0.0649,0.0141,-0.0565,0.9962,0.0569,0.0282,-0.0986,0.9931,0.0489,0.0391,-0.0779,0.995,0.0463,0.0296,-0.0528,0.9971,0.0452,0.0098,0.0319,0.9984,0.0436,-0.007,0.0929,0.9947,0.0425,-0.0189,0.0863,0.9952,0.0426,-0.0119,0.0592,0.9973,0.0452,0.0018,-0.0551,0.9975,0.0454,0.0142,-0.14,0.989,0.0417,0.0222,-0.1511,0.9874,0.0462,0.009,-0.1584,0.9863,0.0587,-0.003,0.0172,0.9981,0.0667,-0.0128,0.1373,0.9882,0.0596,0.0222,0.1976,0.9782,0.0174,0.0882,0.1797,0.9796,0.0044,0.1468,0.143,0.9788,-0.0088,0.1903,0.1208,0.9742,0.0147,0.2144,0.1171,0.9696,0.0781,0.4459,0.0782,0.8882,0.1535,0.6453,-0.0173,0.7481,0.1979,0.713,-0.0657,0.6695,0.1948,0.4799,0.0042,0.8554,0.1822,0.2403,0.0167,0.9533,0.1539,0.0359,-0.0026,0.9874,0.1206,-0.0692,-0.0339,0.9897,0.172,-0.149,-0.0841,0.9701,0.1885,-0.2219,-0.0503,0.9554,0.1753,-0.2716,0.0285,0.9459,0.1602,-0.3452,0.0209,0.9245,0.15,-0.1424,-0.0798,0.9751,0.0933,0.0084,-0.0986,0.9907,0.0217,0.0827,-0.0833,0.9928,0.0768,0.2051,-0.005,0.9757,0.1554,0.3387,0.0158,0.9278,0.2124,0.431,-0.0113,0.8769,0.2453,0.4678,-0.0628,0.8468,0.2319,0.4364,-0.0514,0.8679,0.2187,0.3806,-0.0213,0.8983,0.2071,0.3353,-0.0017,0.9191,0.19,0.3034,0.0025,0.9337,0.2082,0.3766,-0.0075,0.9026,0.2353,0.4527,-0.0135,0.8599,0.2656,0.5091,-0.0155,0.8185,0.305,0.5505,-0.0128,0.777,0.2562,0.4517,0.0046,0.8546,0.1875,0.3271,0.018,0.926,0.1215,0.2035,0.0301,0.971,0.0845,0.084,0.0227,0.9926,0.1053,0.0052,-0.0136,0.9943,0.1195,-0.0458,-0.0318,0.9913,0.1312,-0.0759,-0.0408,0.9876,0.1378,-0.0899,-0.0472,0.9852,0.1593,-0.0761,-0.0119,0.9842,0.1831,-0.0457,0.0089,0.982,0.1933,-0.0084,0.0174,0.981,0.2042,-0.0127,0.0169,0.9787,0.2224,-0.0932,0.0058,0.9705,0.221,-0.1583,-0.0101,0.9623,0.214,-0.1942,-0.0253,0.957,0.2489,-0.131,0.0089,0.9596,0.2667,-0.0757,0.0408,0.9599,0.2731,-0.0365,0.074,0.9584,0.2747,-0.021,0.0977,0.9563,0.2909,-0.057,0.0844,0.9513,0.3031,-0.088,0.0542,0.9473,0.3131,-0.1137,0.0173,0.9427,0.3189,-0.1275,-0.0077,0.9391,0.3102,-0.1096,0.0231,0.944,0.3036,-0.0991,0.0229,0.9473,0.2932,-0.091,0.0167,0.9516,0.2872,-0.0828,0.0187,0.9541,0.2737,-0.0675,0.0269,0.9591,0.2626,-0.0572,0.0246,0.9629,0.252,-0.0467,0.018,0.9664,0.2413,-0.0346,0.0103,0.9698,0.2312,-0.0214,0.0026,0.9727,0.2204,-0.0053,-0.0035,0.9754,0.4113,-0.0218,-0.0363,0.9105,0.5223,-0.0289,-0.0551,0.8505,0.5962,-0.0323,-0.0687,0.7992,0.6438,-0.0327,-0.0789,0.7605,0.6752,-0.0309,-0.0874,0.7318,0.6948,-0.0276,-0.0948,0.7124,0.699,-0.0248,-0.1002,0.7077,0.6904,-0.0258,-0.1001,0.716,0.6841,-0.0264,-0.1002,0.722,0.6781,-0.027,-0.1003,0.7276,0.6701,-0.0283,-0.1011,0.7348,0.7176,-0.0181,-0.0954,0.6897,0.7555,-0.0075,-0.0903,0.6489,0.7769,-0.0003,-0.0862,0.6237,0.7783,0.0042,-0.0981,0.6202,0.7473,0.0004,-0.1375,0.6501,0.7238,-0.0036,-0.1588,0.6715,0.7064,-0.0061,-0.1708,0.6869,0.7248,-0.0115,-0.1589,0.6703,0.7852,-0.0097,-0.0972,0.6115,0.8013,-0.0099,-0.0776,0.5931,0.8136,-0.0129,-0.0746,0.5765,0.8115,-0.0126,-0.0754,0.5793,0.7928,-0.0148,-0.0818,0.6038,0.7775,-0.016,-0.0868,0.6226,0.763,-0.0174,-0.0915,0.6396,0.7667,-0.0171,-0.0902,0.6355,0.7883,-0.0167,-0.0827,0.6095,0.8034,-0.0156,-0.0778,0.5901,0.815,-0.0148,-0.0742,0.5745,0.8124,-0.0155,-0.0751,0.578,0.7938,-0.0168,-0.0816,0.6025,0.7782,-0.0173,-0.0867,0.6217,0.7631,-0.018,-0.0914,0.6395,0.7663,-0.0171,-0.0901,0.6359,0.788,-0.0167,-0.0826,0.6099,0.8032,-0.0157,-0.0777,0.5905,0.8144,-0.0147,-0.0742,0.5754,0.8117,-0.0154,-0.0752,0.5791,0.793,-0.0166,-0.0817,0.6035,0.7774,-0.017,-0.0868,0.6227,0.7624,-0.0178,-0.0915,0.6403,0.7659,-0.0168,-0.0903,0.6363,0.7875,-0.0149,-0.0828,0.6106,0.8023,-0.0129,-0.078,0.5916,0.8124,-0.0113,-0.0747,0.5782,0.8101,-0.0117,-0.0886,0.5794,0.7699,-0.0093,-0.1314,0.6244,0.7315,0.0003,-0.1525,0.6646,0.7035,0.0077,-0.1622,0.6919,0.7203,0.0013,-0.1528,0.6767,0.7826,-0.0055,-0.0968,0.6149,0.8002,-0.009,-0.0778,0.5946,0.8134,-0.013,-0.0747,0.5767,0.8115,-0.0126,-0.0755,0.5793,0.7927,-0.0147,-0.0819,0.6039,0.7772,-0.0157,-0.087,0.6231,0.7625,-0.0169,-0.0917,0.6402,0.7557,-0.0181,-0.0914,0.6483,0.7477,-0.022,-0.0861,0.658,0.7418,-0.0233,-0.083,0.6651,0.7385,-0.0235,-0.0814,0.6689,0.7027,-0.0138,-0.0868,0.706,0.5816,0.0089,-0.0926,0.8081,0.4772,0.0216,-0.0767,0.8752,0.3796,0.0297,-0.0451,0.9236,0.2914,0.0371,-0.0034,0.9559,0.2149,0.0461,0.0434,0.9746,0.168,0.0377,0.0804,0.9818,0.1355,0.0304,0.1126,0.9839,0.1179,0.0219,0.124,0.985,0.112,0.0118,0.104,0.9882,0.0585,0.0118,0.0815,0.9949,0.0187,0.0065,0.0548,0.9983,-0.0134,0.0014,0.0289,0.9995,-0.0391,-0.0012,0.0099,0.9992,-0.0865,-0.0099,-0.0093,0.9962,-0.0804,-0.0213,-0.032,0.996,-0.0641,-0.0304,-0.0552,0.996,-0.0497,-0.0355,-0.0756,0.9953,-0.0335,-0.0452,-0.0912,0.9942,-0.0179,-0.0533,-0.1037,0.993,-0.003,-0.0589,-0.1124,0.9919,0.0109,-0.062,-0.1164,0.9912,0.0283,-0.0514,-0.1005,0.9932,0.0158,-0.0307,-0.0814,0.9961,-0.0018,-0.008,-0.0612,0.9981,-0.0158,0.0132,-0.0386,0.999,-0.0276,0.0308,-0.0219,0.9989,-0.0392,0.049,-0.0068,0.998,-0.0506,0.0645,0.0057,0.9966,-0.0613,0.0747,0.0143,0.9952,-0.0347,0.0632,0.0154,0.9973,0.071,0.0409,0.0082,0.9966,0.1753,0.0198,0.0021,0.9843,0.2412,0.0063,0.0,0.9705,0.2426,0.1114,0.0124,0.9636,0.2029,0.2818,0.0231,0.9375,0.1603,0.4285,0.0248,0.8889,0.1554,0.4382,0.0217,0.8851,0.1684,0.3627,0.0175,0.9164,0.1898,0.2166,0.0055,0.9576,0.2041,0.1134,-0.0032,0.9724,0.1826,-0.0016,-0.0126,0.9831,0.1457,-0.111,-0.0159,0.983,0.0971,-0.2373,-0.0097,0.9665,0.0617,-0.3303,0.0011,0.9418,0.0794,-0.2867,-0.0012,0.9547,0.1238,-0.1619,-0.0076,0.979,0.189,0.0318,-0.0011,0.9815,0.2082,0.1555,0.013,0.9655,0.1743,0.2381,0.0232,0.9552,0.0997,0.3089,0.0165,0.9457,0.0506,0.3553,0.0084,0.9334,0.0645,0.3777,-0.0068,0.9237,0.1125,0.3855,-0.0195,0.9156,0.1603,0.3902,-0.0305,0.9061,0.1918,0.3938,-0.0375,0.8982,0.1826,0.3874,-0.0291,0.9032,0.1576,0.464,-0.0108,0.8716,0.1308,0.5334,0.0018,0.8357,0.113,0.5341,0.0027,0.8378,0.1065,0.5346,0.0022,0.8384,0.105,0.5344,0.0023,0.8387,0.1057,0.5343,0.0022,0.8387,0.1059,0.5343,0.0021,0.8386,0.106,0.5344,0.002,0.8386,0.1061,0.5345,0.002,0.8385,0.1062,0.5347,0.0019,0.8384,0.1063,0.5347,0.0019,0.8383,0.1063,0.5347,0.0019,0.8383,0.1064,0.5347,0.0018,0.8383,0.1064,0.5346,0.0018,0.8384,0.1065,0.5346,0.0018,0.8384,0.1065,0.5345,0.0017,0.8384,0.1065,0.5345,0.0018,0.8384,0.1065,0.5344,0.0018,0.8385,0.1065,0.5344,0.0018,0.8385,0.1065,0.5343,0.0019,0.8385,0.1065,0.5343,0.0019,0.8386,0.1065,0.5342,0.0019,0.8386,0.1065,0.5342,0.0019,0.8386,0.1065,0.5341,0.0019,0.8387,0.1065,0.5341,0.0018,0.8387,0.1067,0.5341,0.0016,0.8386,0.1069,0.5341,0.0012,0.8386,0.1071,0.5342,0.0007,0.8386,0.1074,0.5342,0.0003,0.8385,0.1076,0.5342,-0.0001,0.8385,0.1079,0.5343,-0.0005,0.8384,0.1081,0.5343,-0.0009,0.8384,0.1084,0.5343,-0.0013,0.8383,0.1087,0.5344,-0.0017,0.8382,0.1089,0.5344,-0.0021,0.8382,0.1092,0.5344,-0.0025,0.8381,0.1095,0.5345,-0.0029,0.8381,0.1098,0.5345,-0.0032,0.838,0.11,0.5345,-0.0036,0.8379,0.1103,0.5346,-0.004,0.8379,0.1106,0.5346,-0.0043,0.8378,0.1108,0.5346,-0.0046,0.8378,0.1111,0.5347,-0.0049,0.8377,0.111,0.5333,-0.0054,0.8386,0.1082,0.5186,-0.0077,0.8481,0.1024,0.4897,-0.0119,0.8658,0.0941,0.4489,-0.0175,0.8885,0.0838,0.3987,-0.024,0.9129,0.072,0.3419,-0.031,0.9365,0.0595,0.2817,-0.0381,0.9569,0.047,0.2217,-0.0449,0.9729,0.0352,0.1657,-0.0509,0.9842,0.0251,0.1175,-0.0558,0.9912,0.0175,0.0811,-0.0594,0.9948,0.013,0.0601,-0.0615,0.9962,0.0123,0.0564,-0.0618,0.9964]},{"n":"Left_Arm","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[0.2345,-0.3095,0.3451,0.8544,0.1787,-0.2397,0.234,0.9251,0.1356,-0.1425,0.2006,0.9597,0.0965,-0.0467,0.2083,0.9722,0.0478,0.0252,0.2409,0.969,0.0621,0.028,0.2326,0.9702,0.1801,-0.0857,0.1697,0.9651,0.2569,-0.1939,0.1781,0.9299,0.3305,-0.2707,0.2325,0.8738,0.3555,-0.2634,0.2308,0.8666,0.3199,-0.1195,0.1415,0.9292,0.3218,0.0231,0.1366,0.9366,0.3523,0.1279,0.1564,0.9138,0.2767,-0.0546,0.1587,0.9462,0.2489,-0.1879,0.1964,0.9296,0.2354,-0.2782,0.2673,0.892,0.2197,-0.3155,0.3398,0.8584,0.1628,-0.2263,0.2227,0.9342,0.1181,-0.1102,0.1987,0.9667,0.0708,-0.0071,0.2223,0.9724,0.0123,0.0492,0.2652,0.9629,0.156,-0.0479,0.1793,0.9702,0.231,-0.1601,0.1692,0.9446,0.3078,-0.2501,0.2109,0.8935,0.3632,-0.2948,0.2734,0.8405,0.3283,-0.1669,0.1554,0.9167,0.3157,-0.0232,0.1331,0.9392,0.3461,0.11,0.1501,0.9196,0.2939,-0.0014,0.1543,0.9433,0.2558,-0.1471,0.1797,0.9384,0.2396,-0.2544,0.2406,0.9055,0.2267,-0.3113,0.3263,0.8632,0.1805,-0.2618,0.2476,0.9152,0.1322,-0.1494,0.2,0.9593,0.0881,-0.0382,0.2105,0.9729,0.0259,0.0416,0.2569,0.9652,0.0774,-0.0203,0.196,0.9773,0.1151,-0.1387,0.1543,0.9715,0.1519,-0.2487,0.1587,0.9433,0.1918,-0.333,0.2047,0.9002,0.2108,-0.2363,0.1485,0.9368,0.2456,-0.0806,0.1287,0.9574,0.3094,0.0619,0.1438,0.938,0.3166,0.0721,0.1575,0.9326,0.2164,-0.1106,0.1618,0.9564,0.1675,-0.241,0.1978,0.9353,0.1358,-0.3255,0.2608,0.8987,0.1091,-0.3265,0.2656,0.9005,0.0809,-0.2026,0.1947,0.9563,0.0635,-0.0809,0.1995,0.9745,0.0376,0.015,0.2367,0.9707,0.0414,0.0235,0.2334,0.9712,0.1037,-0.0989,0.1628,0.9762,0.1388,-0.2147,0.1525,0.9547,0.1796,-0.3059,0.1839,0.9167,0.2068,-0.2981,0.184,0.9135,0.2306,-0.1323,0.1296,0.9552,0.2861,0.018,0.1372,0.9482,0.3523,0.1279,0.1564,0.9138,-0.0505,-0.1659,0.3838,0.907,-0.3163,-0.3509,0.5039,0.7231,-0.4949,-0.4885,0.4913,0.5244,-0.5263,-0.4844,0.4599,0.5263,-0.5815,-0.453,0.3443,0.5815,-0.3575,-0.3301,0.1057,0.8672,0.2172,-0.1586,-0.0223,0.9629,0.4397,-0.1765,0.1392,0.8696,-0.3155,-0.3363,0.1549,0.8737,-0.6071,-0.4534,0.1898,0.6244,-0.5726,-0.4675,0.3547,0.5726,-0.5408,-0.4656,0.4453,0.5408,-0.6208,-0.4407,0.1869,0.6208,-0.4057,-0.2909,0.0946,0.8613,-0.0322,-0.1402,0.0099,0.9896,0.2997,-0.0567,-0.0685,0.9499,-0.044,-0.1987,0.1038,0.9736,-0.4532,-0.3463,0.1637,0.8049,-0.6069,-0.4521,0.2425,0.6069,-0.5617,-0.4633,0.393,0.5617,-0.5728,-0.4628,0.3598,0.5728,-0.4286,-0.3866,0.108,0.8094,0.0406,-0.2159,-0.0032,0.9756,-0.1184,-0.2951,0.0893,0.9439,-0.4449,-0.4127,0.1841,0.7732,-0.5858,-0.4809,0.2869,0.5858,-0.5446,-0.4678,0.4337,0.5446,-0.5846,-0.4819,0.29,0.5846,-0.4463,-0.4192,0.1482,0.7766,-0.1077,-0.3159,0.0719,0.9399,0.2447,-0.2448,-0.0014,0.9382,0.4017,-0.0011,0.1562,0.9024,0.2391,0.1978,0.3257,0.8931,-0.1095,0.1087,0.525,0.837,-0.1071,0.1255,0.495,0.8531,0.044,0.0938,0.2095,0.9723,0.1962,-0.0253,0.001,0.9802,0.3534,-0.1434,-0.1304,0.9152,0.4727,-0.2019,-0.1477,0.845,0.3958,-0.2351,-0.0421,0.8867,0.4346,-0.2627,0.1525,0.8478,0.4969,-0.2475,0.3003,0.7757,0.4841,-0.2245,0.269,0.8018,0.4308,-0.1303,0.0446,0.8919,0.6207,-0.0823,-0.0798,0.7756,0.6984,-0.0857,-0.1308,0.6984,0.2788,-0.0728,0.0281,0.9572,0.2006,-0.121,0.1635,0.9583,0.1913,-0.1459,0.2759,0.9306,0.1968,-0.1487,0.336,0.909,0.2316,-0.2183,0.1499,0.9361,0.3663,-0.2563,0.0368,0.8938,0.54,-0.2943,0.0015,0.7885,0.611,-0.3134,-0.0016,0.7269,0.2593,-0.1916,-0.0173,0.9464,-0.1852,-0.1194,0.0084,0.9754,-0.3899,-0.0929,0.0523,0.9147,-0.4437,-0.0867,0.0722,0.889,-0.3212,0.0118,-0.0169,0.9468,-0.2183,0.0781,-0.0652,0.9706,-0.0331,0.1235,-0.1199,0.9845,0.625,0.0303,-0.2484,0.7394,0.6212,0.0648,-0.3018,0.7203,0.6304,0.12,-0.3531,0.6808,0.5699,0.1496,-0.3414,0.7323,0.5736,0.1478,-0.3421,0.7295,0.5736,0.1478,-0.342,0.7295,0.5736,0.1478,-0.342,0.7295,0.5736,0.1478,-0.342,0.7295,0.5736,0.1478,-0.342,0.7295,0.5736,0.1478,-0.342,0.7295,0.5736,0.1478,-0.342,0.7295,0.5736,0.1478,-0.3421,0.7295,0.5736,0.1479,-0.3421,0.7295,0.5736,0.1479,-0.3421,0.7294,0.5736,0.1479,-0.3422,0.7294,0.5736,0.1479,-0.3422,0.7294,0.5735,0.1479,-0.3422,0.7294,0.5095,0.2348,-0.3109,0.7672,0.2623,0.4672,-0.0229,0.844,-0.0245,0.3567,0.3095,0.8811,-0.3013,0.185,0.4394,0.8258,-0.5391,0.032,0.4744,0.6952,-0.6368,-0.0591,0.4308,0.6368,-0.6503,-0.0977,0.3804,0.6503,-0.4689,-0.0142,0.3818,0.7963,-0.4519,0.0008,0.387,0.8037,-0.4393,0.0116,0.3907,0.8089,-0.4283,0.0213,0.3938,0.8131,-0.4173,0.031,0.3967,0.8171,-0.4175,0.0292,0.3954,0.8176,-0.443,0.0038,0.3865,0.8089,-0.4593,-0.0117,0.3807,0.8025,-0.469,-0.022,0.3765,0.7986,-0.4654,-0.0199,0.3767,0.8007,-0.4465,-0.0005,0.3845,0.8079,-0.4324,0.0141,0.3902,0.8127,-0.4189,0.0281,0.3952,0.817,-0.4174,0.0294,0.3955,0.8176,-0.443,0.0038,0.3865,0.8089,-0.4593,-0.0117,0.3807,0.8025,-0.469,-0.022,0.3765,0.7986,-0.4654,-0.0199,0.3767,0.8007,-0.4465,-0.0005,0.3845,0.8079,-0.4324,0.0141,0.3902,0.8128,-0.4189,0.0281,0.3953,0.817,-0.4155,0.0351,0.3989,0.8167,-0.4355,0.0256,0.4,0.806,-0.4489,0.0187,0.4001,0.7988,-0.4566,0.0145,0.4001,0.7945,-0.4097,0.0843,0.4326,0.7987,-0.2678,0.2339,0.4661,0.8101,-0.173,0.2948,0.4558,0.8218,-0.11,0.3312,0.4461,0.8241,-0.308,0.2024,0.4888,0.7907,-0.6324,-0.0595,0.4433,0.6324,-0.6523,-0.139,0.3602,0.6523,-0.5448,-0.1084,0.3598,0.7497,-0.5832,-0.1061,0.3677,0.7165,-0.609,-0.1054,0.3735,0.6918,-0.6297,-0.1036,0.3806,0.6692,-0.6477,-0.1012,0.3882,0.6477,-0.6484,-0.1051,0.3848,0.6484,-0.6034,-0.1134,0.3665,0.6991,-0.5693,-0.1115,0.3614,0.7299,-0.5492,-0.1092,0.3599,0.7463,-0.4599,-0.0442,0.3714,0.8053,-0.1623,0.1925,0.2799,0.9264,0.1067,0.3322,0.1283,0.9283,0.3313,0.3914,-0.0283,0.8581,0.4864,0.3965,-0.15,0.764,0.5581,0.3855,-0.2098,0.7041,0.4262,0.3123,-0.2077,0.8232,0.384,0.2367,-0.2171,0.8657,0.4957,0.1406,-0.2384,0.8232,0.686,0.0436,-0.2387,0.686,0.6934,0.1209,-0.1545,0.6934,0.6656,0.2315,-0.0589,0.707,0.5512,0.2898,0.0669,0.7796,0.5253,0.3137,0.1426,0.778,0.5176,0.3287,0.1835,0.7684,0.5105,0.2221,0.0898,0.8258,0.4953,0.0908,-0.0083,0.8639,0.5361,0.0107,-0.0435,0.8429,0.6535,0.022,-0.0255,0.7562,0.3009,0.1039,-0.0183,0.9478,0.0918,0.1633,-0.0059,0.9823,-0.0284,0.2054,-0.0016,0.9783,-0.0319,0.2153,-0.0205,0.9758,0.141,0.1372,-0.0298,0.98,0.306,0.0702,-0.0421,0.9485,0.4891,0.0138,-0.0431,0.8711,0.7034,0.0962,0.0355,0.7034,0.5477,0.1853,0.1074,0.8088,0.5007,0.2585,0.1752,0.8074,0.4873,0.3131,0.229,0.7824,0.4779,0.3451,0.2721,0.7606,0.4314,0.3142,0.1924,0.8235,0.3705,0.2785,0.0698,0.8834,0.3194,0.2475,-0.0347,0.9141,0.1507,0.2232,-0.0503,0.9617,-0.3054,0.1735,-0.012,0.9362,-0.6095,0.1369,-0.014,0.7808,-0.702,0.112,-0.0433,0.702,-0.7015,0.101,-0.075,0.7015,-0.4949,0.0665,-0.1394,0.8551,-0.2212,0.0062,-0.1819,0.9581,0.0039,-0.0564,-0.2024,0.9777,0.1186,-0.0968,-0.1919,0.9694,0.1753,-0.1111,-0.136,0.9687,0.1884,-0.1192,-0.0954,0.9702,0.1881,-0.1246,-0.0582,0.9725,0.2175,-0.1253,-0.0485,0.9668,0.2485,-0.1175,-0.1048,0.9558,0.206,-0.1041,-0.1564,0.9604,0.0341,-0.0601,-0.2163,0.9739,-0.3638,0.0405,-0.177,0.9136,-0.6014,0.089,-0.1214,0.7847,-0.7018,0.1019,-0.0676,0.7018,-0.7,0.1175,-0.079,0.7,-0.5142,0.1062,-0.1293,0.8412,-0.3166,0.0798,-0.1738,0.9291,-0.0615,0.0292,-0.2148,0.9743,-0.258,0.0694,-0.1845,0.9458,-0.4777,0.1016,-0.1375,0.8617,-0.6568,0.116,-0.0911,0.7395,-0.7017,0.1067,-0.0632,0.7017,-0.7022,0.1021,-0.0572,0.7022,-0.7023,0.1018,-0.057,0.7023,-0.7023,0.1019,-0.0568,0.7023,-0.7023,0.102,-0.0567,0.7023,-0.7023,0.1021,-0.0569,0.7023,-0.7022,0.1022,-0.057,0.7022,-0.7022,0.1024,-0.0572,0.7022,-0.7022,0.1026,-0.0574,0.7022,-0.7022,0.1027,-0.0575,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7022,0.1028,-0.0576,0.7022,-0.7001,0.1014,-0.0561,0.7046,-0.6773,0.086,-0.0399,0.7296,-0.6303,0.0559,-0.0086,0.7743,-0.5593,0.014,0.0345,0.8281,-0.4659,-0.0364,0.0857,0.8799,-0.3542,-0.0911,0.1403,0.9201,-0.2311,-0.1459,0.1939,0.9422,-0.1059,-0.1963,0.2422,0.9442,0.0112,-0.2392,0.2823,0.929,0.1109,-0.2725,0.3126,0.9032,0.1851,-0.2953,0.3328,0.8762,0.2272,-0.3075,0.3434,0.8579,0.2345,-0.3095,0.3451,0.8544]},{"n":"Right_Arm","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[0.4583,0.5231,0.0836,0.7137,0.3881,0.3031,0.0505,0.8689,0.3277,0.103,0.0119,0.9391,0.2788,-0.0823,-0.0422,0.9559,0.2447,-0.2326,-0.0991,0.936,0.2486,-0.2167,-0.0892,0.9398,0.3115,0.0758,0.0228,0.9469,0.3692,0.313,0.0851,0.8709,0.4145,0.4932,0.1354,0.7527,0.3933,0.4826,0.0845,0.778,0.212,0.1465,-0.1426,0.9557,0.0526,-0.059,-0.376,0.9232,-0.0614,-0.0626,-0.5735,0.8145,0.1163,0.0057,-0.2771,0.9538,0.2576,0.2234,-0.0859,0.9361,0.3695,0.4356,0.0576,0.8188,0.4312,0.5604,0.1652,0.6875,0.3669,0.307,0.0844,0.8741,0.3065,0.0627,0.0188,0.9496,0.2592,-0.1552,-0.061,0.9513,0.2313,-0.2964,-0.1313,0.9173,0.2913,-0.0078,-0.0008,0.9566,0.351,0.239,0.0667,0.9029,0.4017,0.4421,0.1191,0.7931,0.4312,0.5604,0.1652,0.6875,0.2666,0.2456,-0.0556,0.9303,0.1037,-0.009,-0.2952,0.9497,-0.0408,-0.0775,-0.538,0.8384,0.063,-0.0507,-0.3595,0.9296,0.2125,0.1452,-0.1488,0.9548,0.3359,0.3698,0.014,0.8661,0.4199,0.5433,0.1412,0.7131,0.3886,0.3913,0.1054,0.8275,0.326,0.1424,0.0406,0.9337,0.2731,-0.087,-0.0318,0.9575,0.2349,-0.2746,-0.1184,0.9249,0.2714,-0.0987,-0.0361,0.9567,0.3316,0.159,0.0447,0.9288,0.3859,0.3807,0.1026,0.834,0.4294,0.5444,0.1635,0.7018,0.3236,0.3462,-0.0017,0.8806,0.1564,0.0596,-0.2222,0.9605,0.0074,-0.0831,-0.4535,0.8874,-0.0133,-0.0854,-0.485,0.8703,0.1644,0.072,-0.2067,0.9618,0.2988,0.2987,-0.0333,0.9057,0.3965,0.4905,0.0989,0.7697,0.4178,0.4974,0.1385,0.7476,0.3466,0.2253,0.0639,0.9083,0.2889,-0.0137,-0.0031,0.9573,0.2472,-0.2134,-0.0856,0.9413,0.2485,-0.2179,-0.09,0.9395,0.3115,0.0759,0.0228,0.9469,0.3692,0.313,0.0851,0.8709,0.4145,0.4932,0.1354,0.7527,0.3933,0.4826,0.0845,0.778,0.212,0.1465,-0.1426,0.9557,0.0526,-0.059,-0.376,0.9232,-0.0613,-0.063,-0.573,0.8148,-0.1637,0.1816,-0.7069,0.6638,-0.2195,0.3375,-0.7765,0.4848,-0.284,0.5303,-0.7171,0.3519,-0.3392,0.5949,-0.6449,0.3392,-0.4601,0.5049,-0.5672,0.4601,-0.5548,0.4101,0.0145,0.7237,-0.1318,0.1835,0.2886,0.9304,0.6711,0.2646,-0.1709,0.6711,-0.3667,0.4111,-0.1472,0.8215,-0.5644,0.5075,-0.3245,0.5644,-0.4511,0.4989,-0.5866,0.4511,-0.3537,0.5811,-0.6419,0.3537,-0.5568,0.4746,-0.3934,0.5568,-0.4578,0.2613,-0.2132,0.8226,-0.1499,0.0616,-0.0164,0.9867,0.1506,-0.0104,0.1484,0.9773,-0.1554,0.1302,-0.1702,0.9643,-0.4872,0.3443,-0.3299,0.7316,-0.512,0.4949,-0.4805,0.512,-0.3909,0.5578,-0.6191,0.3909,-0.4274,0.532,-0.5929,0.4274,-0.4881,0.3608,-0.2049,0.7678,0.0315,0.1643,0.0694,0.9835,0.1435,0.1912,-0.1671,0.9565,-0.382,0.3547,-0.3558,0.7757,-0.4958,0.5004,-0.508,0.4958,-0.3658,0.5594,-0.6476,0.3658,-0.4903,0.4982,-0.5207,0.4903,-0.5032,0.4572,-0.2194,0.6997,-0.246,0.3493,-0.0112,0.9041,0.1629,0.3027,0.1194,0.9314,0.62,0.299,0.0463,0.7239,0.6783,0.2763,0.0597,0.6783,0.6782,0.2568,0.0907,0.6826,0.5986,0.185,0.0514,0.7777,0.4189,0.0606,-0.1644,0.891,0.4159,0.0245,-0.3571,0.836,0.4432,-0.0312,-0.4737,0.7604,0.4617,-0.0856,-0.5268,0.7085,0.4418,0.0143,-0.3497,0.8261,0.5167,0.0892,-0.1154,0.8436,0.7017,0.1079,-0.0603,0.7017,0.5298,0.1437,0.057,0.8339,0.0308,0.0438,0.1791,0.9824,0.0442,0.0153,0.1514,0.9874,0.0853,0.01,0.1449,0.9857,-0.0377,0.0645,0.178,0.9812,0.0438,0.1316,0.188,0.9723,0.4661,0.2367,0.1025,0.8463,0.6806,0.2706,0.0221,0.6806,0.2726,0.182,-0.1093,0.9384,0.1454,0.1441,-0.1857,0.961,0.0605,0.1156,-0.1635,0.9779,0.0199,0.1017,-0.1581,0.982,0.1957,0.1022,-0.2167,0.9509,0.306,0.1433,-0.0813,0.9377,0.3679,0.1186,-0.1473,0.9104,0.3879,0.1012,-0.1813,0.898,0.3749,0.1517,-0.0237,0.9142,0.3431,0.1325,-0.0318,0.9293,0.3117,0.1155,-0.0508,0.9418,0.2875,0.1066,-0.0565,0.9502,0.2715,0.1008,-0.0618,0.9552,0.2646,0.0988,-0.064,0.9571,0.3254,0.0944,-0.0699,0.9383,0.3592,0.0919,-0.0732,0.9258,0.381,0.0902,-0.0753,0.9171,0.3964,0.0889,-0.0767,0.9105,0.4061,0.0881,-0.0776,0.9063,0.4113,0.0877,-0.078,0.9039,0.4133,0.0875,-0.0781,0.903,0.4132,0.0875,-0.0781,0.903,0.4123,0.0876,-0.078,0.9035,0.4118,0.0876,-0.0779,0.9037,0.4118,0.0876,-0.0779,0.9037,0.4118,0.0876,-0.078,0.9037,0.4118,0.0876,-0.078,0.9037,0.4118,0.0876,-0.078,0.9037,0.4118,0.0876,-0.078,0.9037,0.4118,0.0876,-0.0781,0.9037,0.4118,0.0876,-0.0781,0.9037,0.4118,0.0875,-0.0782,0.9037,0.4118,0.0875,-0.0782,0.9037,0.4117,0.0875,-0.0782,0.9037,0.4117,0.0875,-0.0783,0.9037,0.4117,0.0875,-0.0783,0.9037,0.4117,0.0875,-0.0784,0.9037,0.4117,0.0875,-0.0784,0.9037,0.4117,0.0875,-0.0784,0.9037,0.4117,0.0875,-0.0784,0.9037,0.4117,0.0875,-0.0784,0.9037,0.4117,0.0875,-0.0784,0.9037,0.4117,0.0875,-0.0784,0.9037,0.4117,0.0875,-0.0784,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.4117,0.0876,-0.0785,0.9037,0.3779,0.0681,-0.0709,0.9206,0.2638,0.0018,-0.048,0.9634,0.1636,-0.0605,-0.0285,0.9843,0.07,-0.1199,-0.0128,0.9902,-0.0097,-0.1715,-0.0028,0.9851,-0.066,-0.2095,0.0007,0.9756,0.0187,-0.2138,0.0312,0.9762,0.1994,-0.1352,0.0379,0.9698,0.3673,-0.0674,0.0466,0.9265,0.5468,-0.012,0.0454,0.8359,0.7047,-0.081,-0.0124,0.7047,0.5692,-0.1775,-0.0679,0.7999,0.5302,-0.2537,-0.1236,0.7995,0.524,-0.3048,-0.1641,0.7782,0.5189,-0.331,-0.1955,0.7635,0.5055,-0.2705,-0.0479,0.818,0.5174,-0.1715,0.1251,0.829,0.6306,-0.0672,0.218,0.7418,0.6886,-0.0799,0.2125,0.6886,0.6811,-0.1769,0.2021,0.6811,0.6741,-0.2549,0.1619,0.6741,0.6674,-0.3113,0.1108,0.6674,0.6703,-0.2825,0.1471,0.6703,0.6793,-0.1636,0.2241,0.6793,0.6641,-0.0775,0.2369,0.7049,0.6941,-0.089,0.1689,0.6941,0.6891,-0.211,0.075,0.6891,0.6613,-0.2991,-0.0264,0.6874,0.5696,-0.3414,-0.1472,0.7331,0.5083,-0.3528,-0.2343,0.7498,0.4796,-0.355,-0.2822,0.7512,0.4324,-0.3188,-0.1982,0.8198,0.3713,-0.2813,-0.0725,0.8819,0.3196,-0.2483,0.0341,0.9138,0.3154,-0.2442,0.0694,0.9144,0.3618,-0.2731,0.0602,0.8893,0.3944,-0.2981,0.0566,0.8674,0.416,-0.317,0.0531,0.8507,0.4245,-0.3242,0.0529,0.8437,0.4239,-0.3249,0.0531,0.8438,0.423,-0.3244,0.0525,0.8444,0.4231,-0.3236,0.0521,0.8447,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.423,-0.3234,0.052,0.8449,0.423,-0.3234,0.052,0.8449,0.423,-0.3234,0.0519,0.8449,0.423,-0.3234,0.0519,0.8449,0.4229,-0.3234,0.0519,0.8449,0.4229,-0.3234,0.0519,0.8449,0.4229,-0.3234,0.0519,0.8449,0.4229,-0.3234,0.0519,0.8449,0.4229,-0.3234,0.0519,0.8449,0.4229,-0.3234,0.0519,0.8449,0.4229,-0.3234,0.0519,0.8449,0.4229,-0.3234,0.0519,0.8449,0.4229,-0.3234,0.0519,0.8449,0.423,-0.3234,0.0519,0.8449,0.423,-0.3234,0.0519,0.8449,0.423,-0.3234,0.052,0.8449,0.423,-0.3234,0.052,0.8449,0.423,-0.3234,0.052,0.8449,0.423,-0.3234,0.052,0.8449,0.423,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4231,-0.3234,0.052,0.8448,0.4238,-0.3207,0.0522,0.8455,0.4311,-0.2919,0.0542,0.8521,0.444,-0.2356,0.0578,0.8626,0.4592,-0.1568,0.0625,0.8721,0.4735,-0.0611,0.0676,0.8761,0.4841,0.0449,0.0725,0.8709,0.4892,0.1541,0.0766,0.855,0.4884,0.259,0.0798,0.8295,0.4827,0.3529,0.0819,0.7974,0.474,0.4301,0.083,0.7638,0.4653,0.4862,0.0835,0.7349,0.4594,0.5176,0.0836,0.717,0.4583,0.5231,0.0836,0.7137]},{"n":"Left_Forearm","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[-0.0,-0.6612,-0.0,0.7502,-0.0,-0.7164,-0.0,0.6977,-0.0,-0.7965,-0.0,0.6046,-0.0,-0.8732,-0.0,0.4874,-0.0,-0.9294,-0.0,0.3691,-0.0,-0.9234,-0.0,0.3838,-0.0,-0.8052,-0.0,0.593,-0.0,-0.7021,-0.0,0.7121,-0.0,-0.6411,-0.0,0.7675,-0.0,-0.6285,-0.0,0.7778,-0.0,-0.6892,-0.0,0.7245,-0.0,-0.7967,-0.0,0.6044,-0.0,-0.8752,-0.0,0.4838,-0.0,-0.7735,-0.0,0.6337,-0.0,-0.7028,-0.0,0.7114,-0.0,-0.6695,-0.0,0.7428,-0.0,-0.6704,-0.0,0.742,-0.0,-0.7375,-0.0,0.6754,-0.0,-0.8283,-0.0,0.5603,-0.0,-0.9066,-0.0,0.422,-0.0,-0.9502,-0.0,0.3117,-0.0,-0.8422,-0.0,0.5392,-0.0,-0.7335,-0.0,0.6797,-0.0,-0.6554,-0.0,0.7553,-0.0,-0.6298,-0.0,0.7768,-0.0,-0.6583,-0.0,0.7527,-0.0,-0.7608,-0.0,0.649,-0.0,-0.8608,-0.0,0.509,-0.0,-0.804,-0.0,0.5946,-0.0,-0.7229,-0.0,0.691,-0.0,-0.6758,-0.0,0.7371,-0.0,-0.6656,-0.0,0.7463,-0.0,-0.7105,-0.0,0.7036,-0.0,-0.7983,-0.0,0.6022,-0.0,-0.8835,-0.0,0.4684,-0.0,-0.944,-0.0,0.3301,-0.0,-0.8851,-0.0,0.4654,-0.0,-0.7812,-0.0,0.6243,-0.0,-0.6838,-0.0,0.7297,-0.0,-0.6172,-0.0,0.7868,-0.0,-0.6514,-0.0,0.7588,-0.0,-0.7461,-0.0,0.6658,-0.0,-0.8368,-0.0,0.5475,-0.0,-0.8498,-0.0,0.5271,-0.0,-0.7557,-0.0,0.655,-0.0,-0.6897,-0.0,0.7241,-0.0,-0.6538,-0.0,0.7567,-0.0,-0.6717,-0.0,0.7408,-0.0,-0.7689,-0.0,0.6394,-0.0,-0.8595,-0.0,0.5112,-0.0,-0.9259,-0.0,0.3778,-0.0,-0.9257,-0.0,0.3783,-0.0,-0.8165,-0.0,0.5774,-0.0,-0.7137,-0.0,0.7005,-0.0,-0.6359,-0.0,0.7717,-0.0,-0.6251,-0.0,0.7806,-0.0,-0.7129,-0.0,0.7013,-0.0,-0.8096,-0.0,0.5869,-0.0,-0.8752,-0.0,0.4838,-0.0,-0.6381,-0.0,0.77,-0.0,-0.388,-0.0,0.9217,-0.0,-0.3549,-0.0,0.9349,-0.0,-0.656,-0.0,0.7548,-0.0,-0.8392,-0.0,0.5438,-0.0,-0.6567,-0.0,0.7542,-0.0,-0.3501,-0.0,0.9367,-0.0,-0.162,-0.0,0.9868,-0.0,-0.3719,-0.0,0.9283,-0.0,-0.5798,-0.0,0.8147,-0.0,-0.7445,-0.0,0.6676,-0.0,-0.8574,-0.0,0.5147,-0.0,-0.8622,-0.0,0.5066,-0.0,-0.7159,-0.0,0.6982,-0.0,-0.5752,-0.0,0.818,-0.0,-0.4502,-0.0,0.8929,-0.0,-0.4434,-0.0,0.8963,-0.0,-0.602,-0.0,0.7985,-0.0,-0.7253,-0.0,0.6884,-0.0,-0.8219,-0.0,0.5697,-0.0,-0.8936,-0.0,0.4489,-0.0,-0.7443,-0.0,0.6679,-0.0,-0.4876,-0.0,0.8731,-0.0,-0.2682,-0.0,0.9634,-0.0,-0.4825,-0.0,0.8759,-0.0,-0.6363,-0.0,0.7714,-0.0,-0.7541,-0.0,0.6567,-0.0,-0.8228,-0.0,0.5683,-0.0,-0.6586,-0.0,0.7525,-0.0,-0.4966,-0.0,0.868,-0.0,-0.3361,-0.0,0.9418,-0.0,-0.2025,-0.0,0.9793,-0.0,-0.3094,-0.0,0.9509,-0.0,-0.7459,-0.0,0.666,-0.0,-0.8011,-0.0,0.5985,-0.0,-0.5808,-0.0,0.814,-0.0,-0.3946,-0.0,0.9188,-0.0,-0.2613,-0.0,0.9653,-0.0,-0.1919,-0.0,0.9814,-0.0,-0.3345,-0.0,0.9424,-0.0,-0.5097,-0.0,0.8604,-0.0,-0.6249,-0.0,0.7807,-0.0,-0.579,-0.0,0.8154,-0.0,-0.2973,-0.0,0.9548,-0.0,-0.1479,-0.0,0.989,-0.0,-0.1341,-0.0,0.991,-0.0,-0.2885,-0.0,0.9575,-0.0,-0.4941,-0.0,0.8694,-0.0,-0.6393,-0.0,0.769,-0.0,-0.7063,-0.0,0.7079,-0.0,-0.4863,-0.0,0.8738,-0.0,-0.3234,-0.0,0.9463,-0.0,-0.2597,-0.0,0.9657,-0.0,-0.2526,-0.0,0.9676,-0.0,-0.1514,-0.0,0.9885,-0.0,-0.174,-0.0,0.9848,-0.0,-0.2348,-0.0,0.9721,-0.0,-0.2607,-0.0,0.9654,-0.0,-0.1612,-0.0,0.9869,-0.0,-0.0895,-0.0,0.996,-0.0,-0.0,-0.0,1.0,-0.0,-0.1799,-0.0,0.9837,-0.0,-0.4183,-0.0,0.9083,-0.0,-0.6104,-0.0,0.7921,-0.0,-0.7235,-0.0,0.6904,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.7173,-0.0,0.6968,-0.0,-0.6485,-0.0,0.7612,-0.0,-0.4619,-0.0,0.8869,-0.0,-0.3858,-0.0,0.9226,-0.0,-0.4263,-0.0,0.9046,-0.0,-0.5279,-0.0,0.8493,-0.0,-0.5624,-0.0,0.8268,-0.0,-0.5742,-0.0,0.8187,-0.0,-0.5552,-0.0,0.8317,-0.0,-0.5536,-0.0,0.8328,-0.0,-0.5526,-0.0,0.8335,-0.0,-0.5519,-0.0,0.8339,-0.0,-0.5513,-0.0,0.8343,-0.0,-0.5515,-0.0,0.8341,-0.0,-0.5529,-0.0,0.8333,-0.0,-0.5544,-0.0,0.8323,-0.0,-0.5553,-0.0,0.8316,-0.0,-0.5548,-0.0,0.832,-0.0,-0.5531,-0.0,0.8331,-0.0,-0.552,-0.0,0.8338,-0.0,-0.5513,-0.0,0.8343,-0.0,-0.5514,-0.0,0.8342,-0.0,-0.5528,-0.0,0.8333,-0.0,-0.5544,-0.0,0.8322,-0.0,-0.5553,-0.0,0.8316,-0.0,-0.5548,-0.0,0.832,-0.0,-0.5531,-0.0,0.8331,-0.0,-0.552,-0.0,0.8338,-0.0,-0.5513,-0.0,0.8343,-0.0,-0.5514,-0.0,0.8342,-0.0,-0.5528,-0.0,0.8333,-0.0,-0.5544,-0.0,0.8322,-0.0,-0.5553,-0.0,0.8316,-0.0,-0.5548,-0.0,0.832,-0.0,-0.5531,-0.0,0.8331,-0.0,-0.5521,-0.0,0.8338,-0.0,-0.5514,-0.0,0.8343,-0.0,-0.5496,-0.0,0.8354,-0.0,-0.552,-0.0,0.8338,-0.0,-0.56,-0.0,0.8285,-0.0,-0.5575,-0.0,0.8302,-0.0,-0.5612,-0.0,0.8277,-0.0,-0.5639,-0.0,0.8258,-0.0,-0.5663,-0.0,0.8242,-0.0,-0.5686,-0.0,0.8226,-0.0,-0.5688,-0.0,0.8225,-0.0,-0.5635,-0.0,0.8261,-0.0,-0.56,-0.0,0.8285,-0.0,-0.558,-0.0,0.8299,-0.0,-0.5762,-0.0,0.8173,-0.0,-0.6285,-0.0,0.7778,-0.0,-0.6606,-0.0,0.7508,-0.0,-0.6795,-0.0,0.7336,-0.0,-0.6885,-0.0,0.7252,-0.0,-0.6913,-0.0,0.7226,-0.0,-0.5015,-0.0,0.8652,-0.0,-0.3276,-0.0,0.9448,-0.0,-0.2035,-0.0,0.9791,-0.0,-0.1886,-0.0,0.9821,-0.0,-0.2261,-0.0,0.9741,-0.0,-0.3132,-0.0,0.9497,-0.0,-0.5158,-0.0,0.8567,-0.0,-0.6605,-0.0,0.7509,-0.0,-0.7342,-0.0,0.6789,-0.0,-0.5864,-0.0,0.81,-0.0,-0.3776,-0.0,0.926,-0.0,-0.1931,-0.0,0.9812,-0.0,-0.0769,-0.0,0.997,-0.0,-0.2359,-0.0,0.9718,-0.0,-0.4493,-0.0,0.8934,-0.0,-0.6073,-0.0,0.7945,-0.0,-0.7062,-0.0,0.708,-0.0,-0.5659,-0.0,0.8245,-0.0,-0.3626,-0.0,0.9319,-0.0,-0.1857,-0.0,0.9826,-0.0,-0.0738,-0.0,0.9973,-0.0,-0.2656,-0.0,0.9641,-0.0,-0.484,-0.0,0.875,-0.0,-0.6353,-0.0,0.7722,-0.0,-0.7183,-0.0,0.6958,-0.0,-0.7578,-0.0,0.6525,-0.0,-0.7821,-0.0,0.6231,-0.0,-0.7942,-0.0,0.6076,-0.0,-0.7855,-0.0,0.6188,-0.0,-0.7107,-0.0,0.7035,-0.0,-0.6152,-0.0,0.7884,-0.0,-0.5456,-0.0,0.8381,-0.0,-0.527,-0.0,0.8498,-0.0,-0.5068,-0.0,0.8621,-0.0,-0.4587,-0.0,0.8886,-0.0,-0.4143,-0.0,0.9102,-0.0,-0.4641,-0.0,0.8858,-0.0,-0.6544,-0.0,0.7561,-0.0,-0.7698,-0.0,0.6383,-0.0,-0.8289,-0.0,0.5593,-0.0,-0.7874,-0.0,0.6164,-0.0,-0.5991,-0.0,0.8007,-0.0,-0.4217,-0.0,0.9067,-0.0,-0.2587,-0.0,0.966,-0.0,-0.4603,-0.0,0.8878,-0.0,-0.5383,-0.0,0.8427,-0.0,-0.5375,-0.0,0.8433,-0.0,-0.5494,-0.0,0.8356,-0.0,-0.5126,-0.0,0.8586,-0.0,-0.4276,-0.0,0.904,-0.0,-0.291,-0.0,0.9567,-0.0,-0.3959,-0.0,0.9183,-0.0,-0.499,-0.0,0.8666,-0.0,-0.5458,-0.0,0.8379,-0.0,-0.5376,-0.0,0.8432,-0.0,-0.5276,-0.0,0.8495,-0.0,-0.5287,-0.0,0.8488,-0.0,-0.5298,-0.0,0.8481,-0.0,-0.5308,-0.0,0.8475,-0.0,-0.5317,-0.0,0.8469,-0.0,-0.5327,-0.0,0.8463,-0.0,-0.5336,-0.0,0.8458,-0.0,-0.5344,-0.0,0.8452,-0.0,-0.5352,-0.0,0.8447,-0.0,-0.536,-0.0,0.8442,-0.0,-0.5367,-0.0,0.8438,-0.0,-0.5374,-0.0,0.8433,-0.0,-0.538,-0.0,0.8429,-0.0,-0.5386,-0.0,0.8426,-0.0,-0.5391,-0.0,0.8423,-0.0,-0.5395,-0.0,0.842,-0.0,-0.5399,-0.0,0.8417,-0.0,-0.5402,-0.0,0.8415,-0.0,-0.5404,-0.0,0.8414,-0.0,-0.5406,-0.0,0.8413,-0.0,-0.5408,-0.0,0.8412,-0.0,-0.5409,-0.0,0.8411,-0.0,-0.5409,-0.0,0.8411,-0.0,-0.541,-0.0,0.8411,-0.0,-0.541,-0.0,0.8411,-0.0,-0.5409,-0.0,0.8411,-0.0,-0.5409,-0.0,0.8411,-0.0,-0.5408,-0.0,0.8411,-0.0,-0.5408,-0.0,0.8412,-0.0,-0.5407,-0.0,0.8412,-0.0,-0.5406,-0.0,0.8413,-0.0,-0.5406,-0.0,0.8413,-0.0,-0.5405,-0.0,0.8413,-0.0,-0.5405,-0.0,0.8414,-0.0,-0.5405,-0.0,0.8414,-0.0,-0.5405,-0.0,0.8414,-0.0,-0.5405,-0.0,0.8414,-0.0,-0.5405,-0.0,0.8414,-0.0,-0.5405,-0.0,0.8414,-0.0,-0.5409,-0.0,0.8411,-0.0,-0.5453,-0.0,0.8383,-0.0,-0.5537,-0.0,0.8327,-0.0,-0.5651,-0.0,0.825,-0.0,-0.5787,-0.0,0.8155,-0.0,-0.5935,-0.0,0.8048,-0.0,-0.6086,-0.0,0.7935,-0.0,-0.6231,-0.0,0.7821,-0.0,-0.6363,-0.0,0.7714,-0.0,-0.6474,-0.0,0.7622,-0.0,-0.6556,-0.0,0.7551,-0.0,-0.6603,-0.0,0.751,-0.0,-0.6612,-0.0,0.7502]},{"n":"Right_Forearm","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[0.0,0.4717,0.0,0.8817,0.0,0.5553,0.0,0.8317,0.0,0.6446,0.0,0.7645,0.0,0.729,0.0,0.6845,0.0,0.7973,0.0,0.6036,0.0,0.792,0.0,0.6105,0.0,0.6682,0.0,0.744,0.0,0.5679,0.0,0.8231,0.0,0.496,0.0,0.8683,0.0,0.5162,0.0,0.8565,0.0,0.6839,0.0,0.7295,0.0,0.8206,0.0,0.5715,0.0,0.8988,0.0,0.4384,0.0,0.7698,0.0,0.6382,0.0,0.6417,0.0,0.7669,0.0,0.5314,0.0,0.8471,0.0,0.4717,0.0,0.8817,0.0,0.57,0.0,0.8217,0.0,0.6738,0.0,0.7389,0.0,0.7659,0.0,0.6429,0.0,0.8263,0.0,0.5632,0.0,0.7041,0.0,0.7101,0.0,0.5991,0.0,0.8007,0.0,0.5156,0.0,0.8568,0.0,0.4717,0.0,0.8817,0.0,0.6308,0.0,0.7759,0.0,0.7799,0.0,0.6259,0.0,0.8863,0.0,0.4631,0.0,0.8128,0.0,0.5825,0.0,0.684,0.0,0.7294,0.0,0.5642,0.0,0.8256,0.0,0.4803,0.0,0.8771,0.0,0.5358,0.0,0.8443,0.0,0.6397,0.0,0.7687,0.0,0.7374,0.0,0.6755,0.0,0.8169,0.0,0.5768,0.0,0.7423,0.0,0.6701,0.0,0.6328,0.0,0.7743,0.0,0.5398,0.0,0.8418,0.0,0.4743,0.0,0.8804,0.0,0.5764,0.0,0.8171,0.0,0.7341,0.0,0.679,0.0,0.8544,0.0,0.5197,0.0,0.866,0.0,0.5,0.0,0.7274,0.0,0.6862,0.0,0.6015,0.0,0.7989,0.0,0.5046,0.0,0.8634,0.0,0.4975,0.0,0.8674,0.0,0.6047,0.0,0.7964,0.0,0.7066,0.0,0.7076,0.0,0.7908,0.0,0.6121,0.0,0.7924,0.0,0.6099,0.0,0.6682,0.0,0.744,0.0,0.5679,0.0,0.8231,0.0,0.496,0.0,0.8683,0.0,0.5162,0.0,0.8565,0.0,0.6839,0.0,0.7295,0.0,0.8206,0.0,0.5715,0.0,0.8988,0.0,0.4384,0.0,0.5917,0.0,0.8061,0.0,0.2437,0.0,0.9699,0.0,0.2086,0.0,0.978,0.0,0.6626,0.0,0.749,0.0,0.9051,0.0,0.4251,0.0,0.6827,0.0,0.7307,0.0,0.2247,0.0,0.9744,0.0,0.1421,0.0,0.9899,0.0,0.229,0.0,0.9734,0.0,0.4858,0.0,0.8741,0.0,0.6869,0.0,0.7268,0.0,0.8263,0.0,0.5632,0.0,0.8448,0.0,0.5351,0.0,0.7188,0.0,0.6952,0.0,0.6132,0.0,0.7899,0.0,0.5343,0.0,0.8453,0.0,0.5388,0.0,0.8425,0.0,0.6551,0.0,0.7555,0.0,0.7585,0.0,0.6517,0.0,0.8432,0.0,0.5375,0.0,0.9089,0.0,0.417,0.0,0.744,0.0,0.6682,0.0,0.4967,0.0,0.8679,0.0,0.3752,0.0,0.927,0.0,0.4636,0.0,0.8861,0.0,0.5957,0.0,0.8032,0.0,0.7175,0.0,0.6965,0.0,0.7952,0.0,0.6063,0.0,0.5754,0.0,0.8179,0.0,0.361,0.0,0.9326,0.0,0.1613,0.0,0.9869,0.0,0.0834,0.0,0.9965,0.0,0.162,0.0,0.9868,0.0,0.2169,0.0,0.9762,0.0,0.2483,0.0,0.9687,0.0,0.3854,0.0,0.9228,0.0,0.5388,0.0,0.8424,0.0,0.6441,0.0,0.7649,0.0,0.7028,0.0,0.7114,0.0,0.5207,0.0,0.8537,0.0,0.3033,0.0,0.9529,0.0,0.2147,0.0,0.9767,0.0,0.2619,0.0,0.9651,0.0,0.617,0.0,0.7869,0.0,0.8461,0.0,0.533,0.0,0.9058,0.0,0.4237,0.0,0.6349,0.0,0.7726,0.0,0.3332,0.0,0.9429,0.0,0.1865,0.0,0.9825,0.0,0.2404,0.0,0.9707,0.0,0.4768,0.0,0.879,0.0,0.7024,0.0,0.7118,0.0,0.8209,0.0,0.5711,0.0,0.8569,0.0,0.5155,0.0,0.7698,0.0,0.6383,0.0,0.6832,0.0,0.7302,0.0,0.6179,0.0,0.7863,0.0,0.592,0.0,0.8059,0.0,0.719,0.0,0.695,0.0,0.7805,0.0,0.6252,0.0,0.8149,0.0,0.5796,0.0,0.8344,0.0,0.5512,0.0,0.8442,0.0,0.536,0.0,0.8481,0.0,0.5299,0.0,0.8373,0.0,0.5467,0.0,0.8297,0.0,0.5583,0.0,0.8244,0.0,0.566,0.0,0.821,0.0,0.571,0.0,0.8188,0.0,0.574,0.0,0.8174,0.0,0.576,0.0,0.8167,0.0,0.5771,0.0,0.8164,0.0,0.5775,0.0,0.8165,0.0,0.5774,0.0,0.8167,0.0,0.577,0.0,0.817,0.0,0.5766,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8171,0.0,0.5765,0.0,0.8084,0.0,0.5886,0.0,0.7795,0.0,0.6264,0.0,0.7555,0.0,0.6552,0.0,0.7349,0.0,0.6782,0.0,0.7185,0.0,0.6955,0.0,0.7102,0.0,0.704,0.0,0.548,0.0,0.8365,0.0,0.3951,0.0,0.9186,0.0,0.2545,0.0,0.9671,0.0,0.1421,0.0,0.9898,0.0,0.0688,0.0,0.9976,0.0,0.2699,0.0,0.9629,0.0,0.5105,0.0,0.8599,0.0,0.6598,0.0,0.7515,0.0,0.7339,0.0,0.6792,0.0,0.5884,0.0,0.8086,0.0,0.3973,0.0,0.9177,0.0,0.268,0.0,0.9634,0.0,0.232,0.0,0.9727,0.0,0.334,0.0,0.9426,0.0,0.561,0.0,0.8278,0.0,0.7472,0.0,0.6646,0.0,0.8703,0.0,0.4925,0.0,0.7084,0.0,0.7058,0.0,0.447,0.0,0.8945,0.0,0.2871,0.0,0.9579,0.0,0.2996,0.0,0.9541,0.0,0.4631,0.0,0.8863,0.0,0.6047,0.0,0.7965,0.0,0.6916,0.0,0.7223,0.0,0.7269,0.0,0.6868,0.0,0.7577,0.0,0.6526,0.0,0.782,0.0,0.6232,0.0,0.7942,0.0,0.6077,0.0,0.792,0.0,0.6105,0.0,0.7744,0.0,0.6327,0.0,0.761,0.0,0.6487,0.0,0.7518,0.0,0.6594,0.0,0.7486,0.0,0.6631,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6628,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7488,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.7487,0.0,0.6629,0.0,0.748,0.0,0.6637,0.0,0.7398,0.0,0.6728,0.0,0.7238,0.0,0.69,0.0,0.701,0.0,0.7131,0.0,0.6728,0.0,0.7398,0.0,0.6406,0.0,0.7679,0.0,0.606,0.0,0.7955,0.0,0.571,0.0,0.821,0.0,0.5379,0.0,0.843,0.0,0.509,0.0,0.8608,0.0,0.4869,0.0,0.8735,0.0,0.474,0.0,0.8805,0.0,0.4717,0.0,0.8817]},{"n":"Left_Leg","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[-0.1078,0.1022,0.2592,0.9543,-0.139,0.1338,0.2975,0.935,-0.1938,0.1385,0.3393,0.91,-0.2449,0.1203,0.3776,0.8848,-0.2755,0.0947,0.3998,0.8691,-0.2773,0.0742,0.3916,0.8742,-0.2393,0.0742,0.3437,0.905,-0.1745,0.1004,0.2913,0.9352,-0.0989,0.1008,0.2373,0.9611,-0.0564,0.0776,0.2036,0.9744,0.0159,0.0451,0.1863,0.9813,0.1426,0.0224,0.1767,0.9736,0.2093,0.0174,0.1751,0.9619,0.1629,0.0663,0.1906,0.9658,0.0673,0.1065,0.2101,0.9695,-0.0121,0.1454,0.2346,0.9611,-0.0533,0.178,0.2601,0.9475,-0.107,0.1918,0.298,0.9289,-0.1861,0.1829,0.349,0.9001,-0.2467,0.1559,0.3871,0.8747,-0.2689,0.1372,0.4005,0.8651,-0.235,0.1166,0.3498,0.8993,-0.1669,0.1337,0.2895,0.933,-0.0987,0.1275,0.2344,0.9587,-0.0607,0.0966,0.2037,0.9724,0.0086,0.063,0.1836,0.9809,0.1128,0.0364,0.1704,0.9782,0.1975,0.0237,0.1646,0.9661,0.1739,0.0595,0.1755,0.9672,0.0687,0.1021,0.1942,0.9732,-0.014,0.1448,0.2172,0.9652,-0.0542,0.1775,0.2443,0.9518,-0.1107,0.1911,0.2868,0.9322,-0.1835,0.188,0.3363,0.9044,-0.2406,0.1698,0.3736,0.8796,-0.2703,0.1546,0.3943,0.8646,-0.2546,0.1298,0.3603,0.888,-0.1945,0.1424,0.3035,0.9218,-0.1176,0.1447,0.2411,0.9524,-0.0747,0.1195,0.2016,0.9693,-0.0232,0.084,0.1798,0.9798,0.0711,0.0534,0.1644,0.9824,0.1724,0.0361,0.1562,0.9719,0.1874,0.0482,0.1592,0.9681,0.1013,0.0966,0.1779,0.974,0.0053,0.1406,0.1996,0.9697,-0.0413,0.1785,0.2246,0.9571,-0.0879,0.1988,0.2616,0.9404,-0.1592,0.2022,0.312,0.9145,-0.2249,0.1896,0.356,0.887,-0.2657,0.1711,0.3816,0.8686,-0.2705,0.1609,0.38,0.8698,-0.2362,0.1704,0.3451,0.8922,-0.1728,0.1922,0.3019,0.9176,-0.1071,0.1995,0.2554,0.9399,-0.0712,0.1919,0.228,0.9519,0.0133,0.1767,0.2057,0.9624,0.1683,0.1865,0.1739,0.9522,0.2164,0.1967,0.1663,0.9417,0.1623,0.1735,0.1506,0.9596,0.0543,0.1366,0.1538,0.9771,-0.1407,0.1117,0.1715,0.9687,-0.2526,0.0952,0.1739,0.947,-0.3174,0.0864,0.1609,0.9305,-0.2312,0.0477,0.1601,0.9584,0.021,0.02,0.1526,0.9879,0.1877,-0.0155,0.1596,0.969,0.0948,0.0094,0.1484,0.9843,-0.0589,0.0111,0.1541,0.9862,-0.1883,0.0004,0.1689,0.9675,-0.2464,0.0087,0.1621,0.9555,-0.0726,0.1,0.2333,0.9645,0.1113,0.1516,0.2438,0.9514,0.3225,0.218,0.2015,0.8988,0.1958,0.2494,0.2454,0.9161,-0.0109,0.2425,0.2514,0.9369,-0.2593,0.2516,0.2579,0.8961,-0.4432,0.3036,0.2386,0.809,-0.3967,0.2332,0.2264,0.8585,-0.2647,0.1548,0.22,0.926,-0.0853,0.109,0.2124,0.9673,0.0546,0.0604,0.2248,0.971,-0.008,0.0984,0.2012,0.9746,-0.1608,0.1356,0.1847,0.96,-0.326,0.1726,0.1808,0.9117,-0.422,0.2284,0.1645,0.8618,-0.369,0.1725,0.192,0.8929,-0.2345,0.1215,0.2096,0.9414,-0.0427,0.0905,0.2173,0.971,0.1075,0.054,0.238,0.9638,0.0352,0.0411,0.2057,0.9771,-0.1879,0.0142,0.1764,0.9661,-0.3431,-0.0409,0.1478,0.9267,-0.3521,-0.056,0.1096,0.9278,-0.2585,-0.003,0.0771,0.9629,-0.1337,0.0316,0.0367,0.9898,-0.0042,0.0543,-0.0021,0.9985,0.0682,0.0741,-0.0276,0.9945,0.0515,-0.0135,0.0224,0.9983,0.0099,-0.123,0.072,0.9897,-0.0144,-0.2251,0.0881,0.9702,-0.0234,-0.2271,0.0756,0.9707,-0.0196,-0.0872,0.0398,0.9952,0.0946,0.0074,-0.0065,0.9955,0.1639,0.0767,-0.0307,0.983,0.0912,0.0154,0.0744,0.9929,-0.0028,-0.0499,0.1501,0.9874,-0.0481,-0.1155,0.1945,0.9729,-0.0505,-0.1497,0.2141,0.9639,-0.0474,-0.0497,0.1467,0.9868,0.0144,0.0173,0.0747,0.9969,0.1167,0.0598,0.0032,0.9914,0.152,0.0778,-0.0348,0.9847,0.095,0.0205,0.0462,0.9942,-0.0081,-0.0353,0.1068,0.9936,-0.0701,-0.0913,0.144,0.9829,-0.0825,-0.1237,0.1581,0.9762,-0.077,-0.0733,0.1537,0.9824,-0.0345,-0.0311,0.1455,0.9883,0.0742,0.0086,0.1304,0.9887,0.1891,0.0448,0.117,0.9739,0.2258,0.0804,0.1075,0.9649,0.232,0.1026,0.1043,0.9617,0.1364,0.1489,0.1164,0.9725,0.0655,0.1792,0.121,0.9741,-0.0193,0.2063,0.1284,0.9698,-0.2427,0.2615,0.1521,0.9217,-0.3636,0.3414,0.162,0.8515,-0.3882,0.3881,0.1688,0.8186,-0.4039,0.3577,0.1488,0.8287,-0.4132,0.1631,0.0867,0.8917,-0.3929,0.0346,0.0577,0.9171,-0.2807,-0.0403,0.0688,0.9565,-0.2617,-0.0741,0.0651,0.9601,-0.2811,0.1417,0.1119,0.9426,-0.3274,0.3057,0.1478,0.8818,-0.3975,0.4059,0.1696,0.8053,-0.4012,0.329,0.1246,0.8457,-0.4121,0.064,0.0053,0.9089,-0.3478,-0.0822,-0.0391,0.9332,-0.2718,-0.1417,-0.0487,0.9506,-0.2388,-0.0559,-0.0086,0.9694,-0.1736,0.1478,0.1227,0.9659,-0.2155,0.2517,0.1807,0.926,-0.2653,0.3108,0.2006,0.8903,-0.2679,0.2622,0.1691,0.9115,-0.2698,0.093,0.079,0.9551,-0.2063,0.0008,0.056,0.9769,-0.1326,-0.0428,0.0572,0.9886,-0.1319,0.0184,0.0845,0.9875,-0.1546,0.18,0.1529,0.9593,-0.2164,0.2654,0.1869,0.9208,-0.2651,0.3127,0.2018,0.8895,-0.2679,0.2621,0.169,0.9116,-0.2698,0.093,0.079,0.9551,-0.2063,0.0008,0.0561,0.9769,-0.1326,-0.0428,0.0572,0.9886,-0.1319,0.0184,0.0845,0.9875,-0.1546,0.18,0.1529,0.9593,-0.2164,0.2654,0.1869,0.9207,-0.2651,0.3127,0.2018,0.8895,-0.2679,0.2621,0.169,0.9116,-0.2698,0.093,0.079,0.9551,-0.2063,0.0008,0.0561,0.9769,-0.1326,-0.0428,0.0573,0.9886,-0.1319,0.0185,0.0846,0.9875,-0.1546,0.18,0.1529,0.9593,-0.2164,0.2654,0.1869,0.9207,-0.2651,0.3127,0.2018,0.8895,-0.286,0.2545,0.1459,0.9122,-0.3492,0.0616,0.0124,0.9349,-0.3235,-0.0708,-0.0363,0.9429,-0.2681,-0.139,-0.0485,0.9521,-0.239,-0.0561,-0.0086,0.9694,-0.1736,0.1478,0.1227,0.9659,-0.2155,0.2517,0.1808,0.926,-0.2653,0.3109,0.2007,0.8903,-0.2679,0.2622,0.1691,0.9115,-0.2698,0.0931,0.079,0.9551,-0.2063,0.0008,0.0561,0.9769,-0.1326,-0.0428,0.0573,0.9886,-0.1319,0.0185,0.0846,0.9875,-0.1546,0.18,0.1529,0.9593,-0.2164,0.2654,0.1869,0.9207,-0.2651,0.3127,0.2019,0.8895,-0.253,0.2559,0.1766,0.9161,-0.1765,0.0591,0.1008,0.9773,-0.0503,-0.0857,0.0456,0.994,0.0533,-0.2067,-0.0158,0.9768,0.0047,-0.0366,0.08,0.9961,-0.0667,0.071,0.1698,0.9807,-0.1283,0.1781,0.2649,0.939,-0.1559,0.2868,0.3477,0.8789,-0.1451,0.2495,0.2569,0.9223,-0.1024,0.2183,0.1785,0.9539,-0.0431,0.1766,0.1093,0.9773,-0.0083,0.125,0.0605,0.9903,-0.0677,0.0566,0.026,0.9958,-0.2031,0.1052,0.0613,0.9715,-0.2642,0.1714,0.1026,0.9435,-0.2398,0.2092,0.1341,0.9385,-0.1673,0.2273,0.1571,0.9464,-0.0652,0.2457,0.1708,0.952,0.0227,0.2723,0.1849,0.944,0.0126,0.2835,0.2289,0.9312,-0.0748,0.2808,0.3001,0.9086,-0.1616,0.2858,0.3695,0.8693,-0.2079,0.3145,0.4165,0.8273,-0.1642,0.2152,0.3854,0.8822,-0.1212,0.1474,0.3097,0.9315,-0.0629,0.1212,0.2067,0.9688,0.0078,0.1005,0.0919,0.9907,0.0535,0.0537,-0.0004,0.9971,0.0084,-0.0166,-0.0258,0.9995,-0.0928,-0.0782,-0.0546,0.9911,-0.1928,-0.1322,-0.0883,0.9683,-0.1681,-0.1773,-0.1025,0.9643,-0.0641,-0.2462,-0.0509,0.9657,0.0536,-0.3047,0.0101,0.9509,0.0635,-0.2361,0.0488,0.9684,0.0511,-0.01,0.1321,0.9899,0.0768,0.169,0.1863,0.9648,0.1239,0.3071,0.2464,0.9108,0.1269,0.3339,0.2484,0.9004,0.0952,0.1072,0.0871,0.9858,0.0698,-0.0969,-0.0023,0.9928,0.0125,-0.2319,-0.0541,0.9712,0.013,-0.1533,-0.0063,0.9881,0.0508,0.1999,0.1407,0.9683,0.0945,0.4049,0.2042,0.8862,0.097,0.4501,0.2491,0.852,0.1249,0.0232,0.0575,0.9902,0.1531,-0.2053,0.0072,0.9666,0.1607,-0.3121,-0.0133,0.9363,0.0792,0.007,0.1228,0.9892,0.0816,0.282,0.1959,0.9356,0.0984,0.4209,0.2189,0.8748,0.0902,0.451,0.2485,0.8525,0.1057,0.2717,0.1352,0.947,0.1421,-0.0209,0.0436,0.9887,0.1843,-0.2675,0.0306,0.9453,0.1976,-0.4026,0.0151,0.8937,0.1583,-0.0534,0.1338,0.9768,0.1569,0.2405,0.2179,0.9328,0.157,0.4078,0.225,0.8709,0.1709,0.455,0.2215,0.8454,0.1736,0.4538,0.2241,0.8448,0.1729,0.454,0.2237,0.8449,0.1729,0.454,0.2237,0.8449,0.1728,0.454,0.2238,0.8449,0.1727,0.4539,0.224,0.845,0.1726,0.4538,0.2243,0.845,0.1724,0.4537,0.2245,0.845,0.1723,0.4536,0.2248,0.845,0.1721,0.4535,0.2252,0.845,0.1719,0.4534,0.2255,0.845,0.1717,0.4533,0.2259,0.845,0.1714,0.4532,0.2262,0.845,0.1713,0.453,0.2265,0.845,0.1711,0.4529,0.2269,0.8451,0.1709,0.4528,0.2272,0.8451,0.1707,0.4527,0.2274,0.8451,0.1706,0.4526,0.2277,0.8451,0.1705,0.4526,0.2279,0.8451,0.1703,0.4525,0.2281,0.8451,0.1703,0.4525,0.2282,0.8451,0.1702,0.4524,0.2283,0.8451,0.1702,0.4524,0.2283,0.8451,0.1702,0.4525,0.2282,0.8451,0.1703,0.4525,0.2281,0.8451,0.1704,0.4526,0.2279,0.8451,0.1705,0.4526,0.2277,0.8451,0.1706,0.4527,0.2275,0.8451,0.1708,0.4528,0.2272,0.8451,0.1709,0.4529,0.2269,0.8451,0.1711,0.453,0.2266,0.8451,0.1712,0.4531,0.2263,0.8451,0.1714,0.4532,0.226,0.8451,0.1715,0.4533,0.2257,0.8451,0.1717,0.4535,0.2254,0.845,0.1719,0.4536,0.225,0.845,0.1721,0.4537,0.2246,0.845,0.1724,0.4539,0.2242,0.845,0.1726,0.454,0.2237,0.845,0.1729,0.4542,0.2233,0.845,0.1723,0.4533,0.2231,0.8456,0.1632,0.4425,0.2248,0.8526,0.1453,0.4213,0.2285,0.8656,0.1201,0.3914,0.2333,0.882,0.0896,0.3546,0.2387,0.8996,0.0556,0.3129,0.244,0.9162,0.0202,0.2687,0.2487,0.9303,-0.0145,0.2245,0.2526,0.941,-0.0465,0.1832,0.2555,0.9482,-0.0737,0.1476,0.2574,0.9521,-0.094,0.1206,0.2586,0.9538,-0.1057,0.105,0.2591,0.9543,-0.1078,0.1022,0.2592,0.9543]},{"n":"Left_Shin","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[0.6176,0.0,0.0,0.7865,0.6547,0.0,0.0,0.7559,0.7271,0.0,0.0,0.6865,0.7931,0.0,0.0,0.6091,0.8313,0.0,0.0,0.5559,0.8368,0.0,0.0,0.5476,0.799,0.0,0.0,0.6013,0.7149,0.0,0.0,0.6992,0.6106,0.0,0.0,0.7919,0.5475,0.0,0.0,0.8368,0.4291,0.0,0.0,0.9033,0.1945,0.0,0.0,0.9809,0.0618,0.0,0.0,0.9981,0.136,0.0,0.0,0.9907,0.3116,0.0,0.0,0.9502,0.4519,0.0,0.0,0.8921,0.5188,0.0,0.0,0.8549,0.601,0.0,0.0,0.7993,0.7133,0.0,0.0,0.7009,0.7916,0.0,0.0,0.611,0.8198,0.0,0.0,0.5727,0.7891,0.0,0.0,0.6143,0.7047,0.0,0.0,0.7095,0.6117,0.0,0.0,0.7911,0.5563,0.0,0.0,0.8309,0.4415,0.0,0.0,0.8973,0.2515,0.0,0.0,0.9679,0.0884,0.0,0.0,0.9961,0.1227,0.0,0.0,0.9924,0.3172,0.0,0.0,0.9483,0.4645,0.0,0.0,0.8856,0.5278,0.0,0.0,0.8494,0.6145,0.0,0.0,0.7889,0.7163,0.0,0.0,0.6978,0.7897,0.0,0.0,0.6135,0.825,0.0,0.0,0.5651,0.8131,0.0,0.0,0.5822,0.745,0.0,0.0,0.6671,0.6426,0.0,0.0,0.7662,0.5816,0.0,0.0,0.8135,0.4976,0.0,0.0,0.8674,0.3327,0.0,0.0,0.943,0.139,0.0,0.0,0.9903,0.1049,0.0,0.0,0.9945,0.2603,0.0,0.0,0.9655,0.4358,0.0,0.0,0.9,0.515,0.0,0.0,0.8572,0.5869,0.0,0.0,0.8096,0.6907,0.0,0.0,0.7231,0.7762,0.0,0.0,0.6305,0.8241,0.0,0.0,0.5665,0.8321,0.0,0.0,0.5546,0.7951,0.0,0.0,0.6065,0.7172,0.0,0.0,0.6968,0.6256,0.0,0.0,0.7802,0.5655,0.0,0.0,0.8248,0.4176,0.0,0.0,0.9086,0.107,0.0,0.0,0.9943,0.0037,0.0,0.0,1.0,0.0103,0.0,0.0,0.9999,0.1516,0.0,0.0,0.9884,0.4295,0.0,0.0,0.9031,0.5512,0.0,0.0,0.8344,0.5745,0.0,0.0,0.8185,0.5535,0.0,0.0,0.8328,0.3197,0.0,0.0,0.9475,0.1556,0.0,0.0,0.9878,0.2229,0.0,0.0,0.9748,0.4303,0.0,0.0,0.9027,0.5824,0.0,0.0,0.8129,0.6229,0.0,0.0,0.7823,0.6302,0.0,0.0,0.7764,0.5333,0.0,0.0,0.8459,0.3672,0.0,0.0,0.9302,0.3574,0.0,0.0,0.934,0.4591,0.0,0.0,0.8884,0.6384,0.0,0.0,0.7697,0.6916,0.0,0.0,0.7223,0.6869,0.0,0.0,0.7268,0.6153,0.0,0.0,0.7883,0.4624,0.0,0.0,0.8867,0.3748,0.0,0.0,0.9271,0.3769,0.0,0.0,0.9263,0.4815,0.0,0.0,0.8764,0.603,0.0,0.0,0.7978,0.6235,0.0,0.0,0.7818,0.619,0.0,0.0,0.7854,0.5366,0.0,0.0,0.8439,0.3467,0.0,0.0,0.938,0.2196,0.0,0.0,0.9756,0.251,0.0,0.0,0.968,0.4774,0.0,0.0,0.8787,0.6278,0.0,0.0,0.7784,0.6596,0.0,0.0,0.7516,0.6478,0.0,0.0,0.7618,0.5556,0.0,0.0,0.8315,0.4192,0.0,0.0,0.9079,0.34,0.0,0.0,0.9404,0.3857,0.0,0.0,0.9226,0.4894,0.0,0.0,0.872,0.5617,0.0,0.0,0.8273,0.5652,0.0,0.0,0.825,0.4814,0.0,0.0,0.8765,0.2531,0.0,0.0,0.9675,0.1194,0.0,0.0,0.9928,0.2561,0.0,0.0,0.9666,0.4417,0.0,0.0,0.8972,0.55,0.0,0.0,0.8352,0.5748,0.0,0.0,0.8183,0.548,0.0,0.0,0.8365,0.4427,0.0,0.0,0.8967,0.2578,0.0,0.0,0.9662,0.1901,0.0,0.0,0.9818,0.2927,0.0,0.0,0.9562,0.4758,0.0,0.0,0.8796,0.5826,0.0,0.0,0.8128,0.6082,0.0,0.0,0.7938,0.5912,0.0,0.0,0.8065,0.5174,0.0,0.0,0.8557,0.3216,0.0,0.0,0.9469,0.101,0.0,0.0,0.9949,0.0262,0.0,0.0,0.9997,0.0132,0.0,0.0,0.9999,0.0298,0.0,0.0,0.9996,0.0599,0.0,0.0,0.9982,0.1534,0.0,0.0,0.9882,0.5071,0.0,0.0,0.8619,0.6802,0.0,0.0,0.733,0.6908,0.0,0.0,0.7231,0.6903,0.0,0.0,0.7236,0.6832,0.0,0.0,0.7302,0.6513,0.0,0.0,0.7589,0.4813,0.0,0.0,0.8766,0.4524,0.0,0.0,0.8918,0.4598,0.0,0.0,0.888,0.5406,0.0,0.0,0.8413,0.6849,0.0,0.0,0.7286,0.6876,0.0,0.0,0.7261,0.6692,0.0,0.0,0.7431,0.5577,0.0,0.0,0.83,0.4207,0.0,0.0,0.9072,0.4369,0.0,0.0,0.8995,0.5037,0.0,0.0,0.8639,0.6212,0.0,0.0,0.7837,0.7099,0.0,0.0,0.7043,0.713,0.0,0.0,0.7011,0.7032,0.0,0.0,0.711,0.6118,0.0,0.0,0.791,0.4994,0.0,0.0,0.8663,0.493,0.0,0.0,0.87,0.5107,0.0,0.0,0.8598,0.6205,0.0,0.0,0.7842,0.71,0.0,0.0,0.7042,0.713,0.0,0.0,0.7012,0.7032,0.0,0.0,0.711,0.6118,0.0,0.0,0.791,0.4994,0.0,0.0,0.8663,0.493,0.0,0.0,0.87,0.5107,0.0,0.0,0.8598,0.6205,0.0,0.0,0.7842,0.71,0.0,0.0,0.7042,0.713,0.0,0.0,0.7012,0.7032,0.0,0.0,0.711,0.6118,0.0,0.0,0.791,0.4994,0.0,0.0,0.8663,0.493,0.0,0.0,0.87,0.5107,0.0,0.0,0.8598,0.6205,0.0,0.0,0.7842,0.71,0.0,0.0,0.7042,0.7088,0.0,0.0,0.7054,0.684,0.0,0.0,0.7295,0.568,0.0,0.0,0.823,0.4235,0.0,0.0,0.9059,0.4367,0.0,0.0,0.8996,0.5037,0.0,0.0,0.8639,0.6212,0.0,0.0,0.7837,0.7099,0.0,0.0,0.7043,0.713,0.0,0.0,0.7011,0.7032,0.0,0.0,0.711,0.6118,0.0,0.0,0.791,0.4994,0.0,0.0,0.8663,0.493,0.0,0.0,0.87,0.5107,0.0,0.0,0.8598,0.6205,0.0,0.0,0.7842,0.71,0.0,0.0,0.7042,0.706,0.0,0.0,0.7082,0.6303,0.0,0.0,0.7764,0.4856,0.0,0.0,0.8742,0.3753,0.0,0.0,0.9269,0.4809,0.0,0.0,0.8768,0.6167,0.0,0.0,0.7872,0.6577,0.0,0.0,0.7533,0.65,0.0,0.0,0.7599,0.6196,0.0,0.0,0.7849,0.5319,0.0,0.0,0.8468,0.4104,0.0,0.0,0.9119,0.3329,0.0,0.0,0.943,0.4248,0.0,0.0,0.9053,0.6334,0.0,0.0,0.7738,0.7169,0.0,0.0,0.6972,0.7001,0.0,0.0,0.7141,0.6056,0.0,0.0,0.7958,0.4342,0.0,0.0,0.9008,0.25,0.0,0.0,0.9682,0.2346,0.0,0.0,0.9721,0.3481,0.0,0.0,0.9375,0.4342,0.0,0.0,0.9008,0.4244,0.0,0.0,0.9055,0.4095,0.0,0.0,0.9123,0.4365,0.0,0.0,0.8997,0.4087,0.0,0.0,0.9127,0.3243,0.0,0.0,0.9459,0.2479,0.0,0.0,0.9688,0.3191,0.0,0.0,0.9477,0.4794,0.0,0.0,0.8776,0.6297,0.0,0.0,0.7768,0.6179,0.0,0.0,0.7862,0.5064,0.0,0.0,0.8623,0.3637,0.0,0.0,0.9315,0.3669,0.0,0.0,0.9302,0.416,0.0,0.0,0.9094,0.4232,0.0,0.0,0.906,0.3822,0.0,0.0,0.9241,0.3663,0.0,0.0,0.9305,0.3554,0.0,0.0,0.9347,0.3437,0.0,0.0,0.9391,0.4128,0.0,0.0,0.9108,0.411,0.0,0.0,0.9116,0.3397,0.0,0.0,0.9405,0.2893,0.0,0.0,0.9572,0.2996,0.0,0.0,0.9541,0.2937,0.0,0.0,0.9559,0.2396,0.0,0.0,0.9709,0.2166,0.0,0.0,0.9763,0.2811,0.0,0.0,0.9597,0.2546,0.0,0.0,0.967,0.2505,0.0,0.0,0.9681,0.302,0.0,0.0,0.9533,0.2622,0.0,0.0,0.965,0.178,0.0,0.0,0.984,0.1166,0.0,0.0,0.9932,0.103,0.0,0.0,0.9947,0.136,0.0,0.0,0.9907,0.0799,0.0,0.0,0.9968,0.1186,0.0,0.0,0.9929,0.158,0.0,0.0,0.9874,0.1581,0.0,0.0,0.9874,0.1583,0.0,0.0,0.9874,0.1585,0.0,0.0,0.9874,0.1586,0.0,0.0,0.9873,0.1587,0.0,0.0,0.9873,0.1587,0.0,0.0,0.9873,0.1587,0.0,0.0,0.9873,0.1587,0.0,0.0,0.9873,0.1586,0.0,0.0,0.9873,0.1584,0.0,0.0,0.9874,0.1583,0.0,0.0,0.9874,0.1581,0.0,0.0,0.9874,0.1579,0.0,0.0,0.9874,0.1578,0.0,0.0,0.9875,0.1576,0.0,0.0,0.9875,0.1574,0.0,0.0,0.9875,0.1572,0.0,0.0,0.9876,0.157,0.0,0.0,0.9876,0.1568,0.0,0.0,0.9876,0.1567,0.0,0.0,0.9877,0.1565,0.0,0.0,0.9877,0.1565,0.0,0.0,0.9877,0.1564,0.0,0.0,0.9877,0.1564,0.0,0.0,0.9877,0.1564,0.0,0.0,0.9877,0.1565,0.0,0.0,0.9877,0.1566,0.0,0.0,0.9877,0.1568,0.0,0.0,0.9876,0.157,0.0,0.0,0.9876,0.1574,0.0,0.0,0.9875,0.1577,0.0,0.0,0.9875,0.1582,0.0,0.0,0.9874,0.1587,0.0,0.0,0.9873,0.1592,0.0,0.0,0.9873,0.1595,0.0,0.0,0.9872,0.1597,0.0,0.0,0.9872,0.1599,0.0,0.0,0.9871,0.16,0.0,0.0,0.9871,0.1601,0.0,0.0,0.9871,0.1616,0.0,0.0,0.9868,0.1787,0.0,0.0,0.9839,0.2114,0.0,0.0,0.9774,0.2561,0.0,0.0,0.9666,0.309,0.0,0.0,0.9511,0.3662,0.0,0.0,0.9305,0.424,0.0,0.0,0.9056,0.479,0.0,0.0,0.8778,0.528,0.0,0.0,0.8492,0.5685,0.0,0.0,0.8227,0.5981,0.0,0.0,0.8015,0.6147,0.0,0.0,0.7887,0.6176,0.0,0.0,0.7865]},{"n":"Right_Leg","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[-0.1487,-0.0399,-0.2182,0.9637,-0.1763,-0.0762,-0.2501,0.949,-0.2309,-0.0962,-0.2772,0.9277,-0.2863,-0.0978,-0.2963,0.9059,-0.322,-0.0881,-0.3072,0.8912,-0.3257,-0.084,-0.3088,0.8897,-0.2861,-0.1028,-0.3077,0.9016,-0.2126,-0.1213,-0.3045,0.9205,-0.1371,-0.1249,-0.2904,0.9388,-0.1041,-0.1285,-0.2762,0.9468,-0.057,-0.1527,-0.2404,0.9569,0.026,-0.1815,-0.1917,0.9642,0.0839,-0.1957,-0.1668,0.9627,0.0477,-0.1955,-0.1862,0.9617,-0.0142,-0.1833,-0.2209,0.9578,-0.0687,-0.1716,-0.253,0.9496,-0.0996,-0.1679,-0.2727,0.9421,-0.1499,-0.1705,-0.2867,0.9307,-0.2305,-0.1716,-0.3017,0.9091,-0.2959,-0.1641,-0.3078,0.8893,-0.3239,-0.1558,-0.3065,0.8814,-0.2873,-0.1132,-0.2739,0.9109,-0.2076,-0.0846,-0.2502,0.9419,-0.132,-0.0544,-0.2253,0.9638,-0.0951,-0.0323,-0.197,0.9752,-0.0424,-0.029,-0.1608,0.9856,0.0332,-0.0312,-0.1231,0.9914,0.0972,-0.0306,-0.0988,0.9899,0.0779,-0.0564,-0.1173,0.9884,0.007,-0.0724,-0.1609,0.9843,-0.053,-0.0833,-0.2058,0.9736,-0.089,-0.1048,-0.2338,0.9625,-0.1487,-0.1283,-0.2585,0.9458,-0.2238,-0.1459,-0.2826,0.9213,-0.2871,-0.1547,-0.2993,0.8967,-0.3221,-0.1578,-0.3069,0.8816,-0.3061,-0.1245,-0.2831,0.9003,-0.2366,-0.0941,-0.2582,0.9319,-0.1515,-0.0646,-0.2336,0.9583,-0.1059,-0.0377,-0.2072,0.9718,-0.0621,-0.0287,-0.1738,0.9824,0.0096,-0.03,-0.1349,0.9904,0.0799,-0.0323,-0.1053,0.9907,0.0961,-0.0433,-0.1051,0.9889,0.0318,-0.0687,-0.1451,0.9865,-0.0379,-0.0796,-0.1921,0.9774,-0.0762,-0.0963,-0.2259,0.9664,-0.125,-0.1211,-0.2501,0.9525,-0.1993,-0.1409,-0.275,0.93,-0.268,-0.1529,-0.295,0.9043,-0.3136,-0.1555,-0.3041,0.886,-0.3199,-0.1476,-0.3004,0.8864,-0.2797,-0.1276,-0.2832,0.9084,-0.2125,-0.1139,-0.2686,0.9326,-0.1415,-0.098,-0.2505,0.9527,-0.1008,-0.0864,-0.2328,0.9634,-0.0254,-0.095,-0.1973,0.9754,0.118,-0.1174,-0.1485,0.9748,0.1978,-0.1391,-0.1251,0.9622,0.1501,-0.1804,-0.1344,0.9627,0.0192,-0.2005,-0.1665,0.9652,-0.1261,-0.2304,-0.2095,0.9419,-0.2072,-0.2666,-0.2413,0.9098,-0.252,-0.3023,-0.26,0.8818,-0.1324,-0.2706,-0.2803,0.9114,0.0812,-0.2623,-0.2486,0.9289,0.2623,-0.2635,-0.2148,0.9031,0.1158,-0.2363,-0.2294,0.9371,-0.0367,-0.2129,-0.2401,0.9464,-0.1757,-0.2014,-0.2432,0.9324,-0.2663,-0.203,-0.2246,0.9151,-0.1615,-0.1384,-0.2267,0.9504,-0.0277,-0.0944,-0.2225,0.97,0.1326,-0.0511,-0.228,0.9632,0.1053,-0.1048,-0.188,0.9709,-0.0342,-0.0969,-0.1579,0.9821,-0.2785,-0.0749,-0.1587,0.9443,-0.4319,-0.0479,-0.1519,0.8877,-0.334,-0.0034,-0.1602,0.9289,-0.1721,-0.0799,-0.1871,0.9638,0.0367,-0.1117,-0.1829,0.9761,0.2264,-0.1263,-0.1489,0.9543,0.1512,-0.1295,-0.1625,0.9664,-0.0038,-0.1296,-0.1887,0.9734,-0.1761,-0.1352,-0.2062,0.953,-0.2986,-0.1477,-0.21,0.9192,-0.2427,-0.1413,-0.1927,0.9402,-0.119,-0.1327,-0.1662,0.9699,0.0526,-0.1289,-0.131,0.9816,0.1912,-0.1261,-0.1015,0.9681,0.0864,-0.1277,-0.1063,0.9823,-0.1405,-0.1249,-0.1258,0.9741,-0.2961,-0.1179,-0.1443,0.9368,-0.3138,-0.0609,-0.1427,0.9367,-0.2438,0.0446,-0.118,0.9616,-0.1462,0.1021,-0.0987,0.979,-0.0434,0.1446,-0.0802,0.9853,0.0119,0.1873,-0.0515,0.9809,0.0091,0.094,-0.001,0.9955,-0.0189,-0.006,0.051,0.9985,-0.0384,-0.0907,0.0771,0.9921,-0.0452,-0.0911,0.0647,0.9927,-0.0315,0.0269,0.0159,0.999,0.052,0.1123,-0.0274,0.9919,0.095,0.1791,-0.042,0.9783,0.0669,0.0603,0.0229,0.9957,0.006,-0.0269,0.0759,0.9967,-0.0339,-0.1074,0.1018,0.9884,-0.0307,-0.1621,0.1054,0.9806,-0.0511,-0.0886,0.0225,0.9945,-0.0206,-0.041,-0.0489,0.9977,0.023,-0.0036,-0.1055,0.9941,0.0355,0.0166,-0.1358,0.99,0.0309,-0.0354,-0.0618,0.997,-0.0239,-0.0686,-0.0042,0.9973,-0.0725,-0.0988,0.0355,0.9918,-0.0809,-0.1137,0.0577,0.9885,-0.0783,-0.078,0.0209,0.9936,-0.0375,-0.052,-0.0107,0.9979,0.0719,-0.0359,-0.0362,0.9961,0.1981,-0.0398,-0.0455,0.9783,0.2225,-0.0405,-0.0577,0.9724,0.2273,-0.0386,-0.0646,0.9709,0.1333,-0.0963,-0.06,0.9845,0.0631,-0.1348,-0.0539,0.9874,-0.0211,-0.1722,-0.0527,0.9834,-0.229,-0.2335,-0.0704,0.9424,-0.3433,-0.3204,-0.0846,0.8788,-0.3619,-0.3791,-0.0945,0.8464,-0.3771,-0.3594,-0.077,0.8501,-0.3969,-0.1697,-0.0155,0.9019,-0.3853,-0.0413,0.0144,0.9218,-0.2777,0.049,0.0075,0.9594,-0.2593,0.0838,0.0108,0.9621,-0.2647,-0.1401,-0.0351,0.9535,-0.3018,-0.3051,-0.0726,0.9003,-0.3674,-0.4062,-0.0974,0.831,-0.3827,-0.3341,-0.0797,0.8576,-0.4062,-0.0657,-0.0368,0.9107,-0.3285,0.0769,-0.0447,0.9403,-0.2371,0.1241,-0.0689,0.9611,-0.213,0.0438,-0.0703,0.9735,-0.1603,-0.1629,-0.0914,0.9692,-0.1994,-0.2557,-0.1231,0.9379,-0.2477,-0.3059,-0.1394,0.9086,-0.2536,-0.2545,-0.1068,0.9271,-0.2627,-0.0811,-0.0154,0.9613,-0.2028,0.0117,0.0066,0.9791,-0.1306,0.0555,0.0046,0.9899,-0.127,-0.006,-0.0222,0.9916,-0.1412,-0.1699,-0.0901,0.9711,-0.2005,-0.2581,-0.1244,0.9369,-0.2482,-0.3063,-0.1398,0.9083,-0.2535,-0.2545,-0.1067,0.9271,-0.2627,-0.0811,-0.0154,0.9613,-0.2028,0.0117,0.0066,0.9791,-0.1306,0.0555,0.0046,0.9899,-0.127,-0.006,-0.0222,0.9916,-0.1412,-0.1699,-0.0901,0.9711,-0.2005,-0.2581,-0.1244,0.9369,-0.2482,-0.3063,-0.1398,0.9083,-0.2535,-0.2545,-0.1067,0.9271,-0.2627,-0.0811,-0.0154,0.9613,-0.2028,0.0118,0.0066,0.9791,-0.1306,0.0555,0.0046,0.9899,-0.127,-0.006,-0.0222,0.9916,-0.1412,-0.1699,-0.0901,0.9711,-0.2005,-0.2581,-0.1244,0.9369,-0.2482,-0.3063,-0.1398,0.9083,-0.2742,-0.2525,-0.1071,0.9217,-0.3411,-0.0557,-0.0373,0.9377,-0.3023,0.0726,-0.0414,0.9495,-0.2328,0.1232,-0.0678,0.9623,-0.2134,0.0438,-0.0703,0.9735,-0.1603,-0.1629,-0.0914,0.9692,-0.1994,-0.2557,-0.123,0.9379,-0.2477,-0.3059,-0.1394,0.9086,-0.2536,-0.2545,-0.1067,0.9271,-0.2627,-0.0811,-0.0154,0.9613,-0.2028,0.0118,0.0067,0.9791,-0.1306,0.0555,0.0046,0.9899,-0.127,-0.0059,-0.0221,0.9916,-0.1412,-0.1699,-0.0901,0.9711,-0.2005,-0.258,-0.1244,0.9369,-0.2482,-0.3062,-0.1398,0.9083,-0.2387,-0.2679,-0.1205,0.9256,-0.1774,-0.1318,-0.056,0.9737,-0.0764,-0.0219,-0.0141,0.9967,0.0019,0.0859,0.0098,0.9963,-0.0183,0.0434,-0.0476,0.9978,-0.0792,0.0317,-0.1039,0.9909,-0.1493,0.0232,-0.1528,0.9766,-0.1752,0.0085,-0.1992,0.9641,-0.151,0.0542,-0.1774,0.971,-0.1141,0.0668,-0.1549,0.979,-0.0692,0.0813,-0.1364,0.9849,-0.0431,0.0632,-0.0829,0.9936,-0.0781,0.0354,-0.0045,0.9963,-0.2043,0.029,0.0189,0.9783,-0.2687,0.0272,0.0181,0.9627,-0.2436,0.0398,0.0093,0.969,-0.1635,0.0568,-0.008,0.9849,-0.0572,0.0628,-0.0225,0.9961,0.0232,0.0633,-0.0297,0.9973,0.0128,0.0598,-0.0244,0.9978,-0.0484,0.0514,-0.0105,0.9974,-0.0688,0.0768,-0.0357,0.994,-0.0553,0.1084,-0.0611,0.9907,-0.0844,0.0774,-0.049,0.9922,-0.0835,0.0372,-0.0247,0.9955,-0.0395,0.0062,-0.0051,0.9992,0.0243,-0.0167,0.0076,0.9995,0.056,-0.0324,0.0119,0.9978,0.0102,-0.0313,0.0106,0.9994,-0.0919,-0.0315,0.0074,0.9952,-0.1912,-0.0417,0.0005,0.9807,-0.1809,0.0586,0.0449,0.9807,-0.1118,0.184,0.0552,0.975,-0.0457,0.2639,0.0414,0.9626,-0.0311,0.2171,0.0095,0.9756,-0.01,0.035,-0.0751,0.9965,0.0292,-0.1132,-0.1248,0.9853,0.0828,-0.2326,-0.1763,0.9529,0.0853,-0.2529,-0.1804,0.9467,0.0381,-0.0441,-0.063,0.9963,0.0359,0.1617,-0.0324,0.9857,0.0199,0.2988,-0.0181,0.9539,0.0129,0.2345,-0.0519,0.9706,0.0052,-0.0793,-0.1489,0.9857,0.0308,-0.2741,-0.1842,0.9434,0.0434,-0.3318,-0.2058,0.9196,0.0607,0.016,-0.0262,0.9977,0.0718,0.2005,0.0177,0.9769,0.0841,0.2942,0.0276,0.9516,0.0214,0.0439,-0.0937,0.9944,0.033,-0.1708,-0.1729,0.9695,0.0425,-0.2944,-0.1874,0.9362,0.0341,-0.347,-0.2049,0.9146,0.0425,-0.1479,-0.103,0.9827,0.1084,0.1596,-0.0608,0.9793,0.1592,0.3594,-0.0299,0.919,0.1435,0.4575,0.0155,0.8774,0.0979,0.1463,-0.0896,0.9803,0.1081,-0.1277,-0.1649,0.972,0.1261,-0.3029,-0.1541,0.932,0.1282,-0.3488,-0.1708,0.9125,0.1308,-0.3504,-0.1732,0.9111,0.1302,-0.3507,-0.1726,0.9112,0.1303,-0.3509,-0.1724,0.9111,0.1304,-0.3511,-0.1722,0.9111,0.1306,-0.3512,-0.172,0.911,0.1307,-0.3514,-0.1718,0.911,0.1309,-0.3516,-0.1716,0.911,0.131,-0.3517,-0.1713,0.9109,0.1312,-0.3519,-0.1711,0.9109,0.1313,-0.3521,-0.1708,0.9108,0.1315,-0.3522,-0.1705,0.9108,0.1317,-0.3524,-0.1703,0.9108,0.1318,-0.3526,-0.17,0.9107,0.132,-0.3527,-0.1698,0.9107,0.1321,-0.3528,-0.1696,0.9107,0.1323,-0.353,-0.1694,0.9106,0.1324,-0.3531,-0.1692,0.9106,0.1325,-0.3532,-0.169,0.9106,0.1326,-0.3533,-0.1689,0.9106,0.1326,-0.3533,-0.1688,0.9105,0.1327,-0.3534,-0.1687,0.9105,0.1327,-0.3534,-0.1687,0.9105,0.1327,-0.3534,-0.1687,0.9105,0.1327,-0.3534,-0.1687,0.9105,0.1326,-0.3533,-0.1688,0.9105,0.1325,-0.3532,-0.169,0.9106,0.1324,-0.3531,-0.1692,0.9106,0.1323,-0.353,-0.1694,0.9106,0.1321,-0.3528,-0.1697,0.9106,0.1319,-0.3526,-0.1701,0.9107,0.1316,-0.3524,-0.1704,0.9107,0.1314,-0.3522,-0.1708,0.9108,0.1311,-0.3519,-0.1712,0.9109,0.1309,-0.3516,-0.1715,0.9109,0.1306,-0.3513,-0.1719,0.911,0.1304,-0.351,-0.1724,0.9111,0.1301,-0.3507,-0.1728,0.9112,0.1299,-0.3504,-0.1732,0.9112,0.1297,-0.3501,-0.1736,0.9113,0.1287,-0.3489,-0.1743,0.9118,0.119,-0.3387,-0.1767,0.9164,0.1005,-0.3191,-0.181,0.9248,0.0751,-0.2919,-0.1864,0.9351,0.0445,-0.2588,-0.1923,0.9455,0.0107,-0.2218,-0.1981,0.9547,-0.0242,-0.183,-0.2036,0.9615,-0.0582,-0.1447,-0.2084,0.9655,-0.0894,-0.109,-0.2122,0.967,-0.1158,-0.0785,-0.2151,0.9665,-0.1355,-0.0555,-0.2171,0.9651,-0.1467,-0.0422,-0.2181,0.9639,-0.1487,-0.0399,-0.2182,0.9637]},{"n":"Right_Shin","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[0.6707,0.0,0.0,0.7417,0.7027,0.0,0.0,0.7115,0.7745,0.0,0.0,0.6326,0.8415,0.0,0.0,0.5402,0.8811,0.0,0.0,0.4729,0.8848,0.0,0.0,0.466,0.8393,0.0,0.0,0.5437,0.7418,0.0,0.0,0.6706,0.6261,0.0,0.0,0.7798,0.5712,0.0,0.0,0.8208,0.4939,0.0,0.0,0.8695,0.3517,0.0,0.0,0.9361,0.2483,0.0,0.0,0.9687,0.3119,0.0,0.0,0.9501,0.4159,0.0,0.0,0.9094,0.5009,0.0,0.0,0.8655,0.5497,0.0,0.0,0.8353,0.6326,0.0,0.0,0.7745,0.752,0.0,0.0,0.6592,0.8371,0.0,0.0,0.547,0.8686,0.0,0.0,0.4955,0.8308,0.0,0.0,0.5566,0.7326,0.0,0.0,0.6807,0.6284,0.0,0.0,0.7779,0.5789,0.0,0.0,0.8154,0.4975,0.0,0.0,0.8675,0.3754,0.0,0.0,0.9268,0.2622,0.0,0.0,0.965,0.2909,0.0,0.0,0.9568,0.4074,0.0,0.0,0.9132,0.4998,0.0,0.0,0.8662,0.5504,0.0,0.0,0.8349,0.6406,0.0,0.0,0.7679,0.7475,0.0,0.0,0.6643,0.8275,0.0,0.0,0.5614,0.8656,0.0,0.0,0.5008,0.8503,0.0,0.0,0.5262,0.7707,0.0,0.0,0.6371,0.6555,0.0,0.0,0.7552,0.5932,0.0,0.0,0.8051,0.5305,0.0,0.0,0.8477,0.4176,0.0,0.0,0.9086,0.2932,0.0,0.0,0.956,0.2612,0.0,0.0,0.9653,0.3682,0.0,0.0,0.9297,0.4745,0.0,0.0,0.8802,0.5319,0.0,0.0,0.8468,0.6052,0.0,0.0,0.7961,0.7137,0.0,0.0,0.7005,0.8056,0.0,0.0,0.5925,0.8569,0.0,0.0,0.5156,0.8651,0.0,0.0,0.5016,0.8217,0.0,0.0,0.5699,0.7338,0.0,0.0,0.6793,0.6325,0.0,0.0,0.7746,0.5723,0.0,0.0,0.8201,0.4528,0.0,0.0,0.8916,0.1943,0.0,0.0,0.9809,0.0391,0.0,0.0,0.9992,0.0809,0.0,0.0,0.9967,0.3016,0.0,0.0,0.9534,0.5324,0.0,0.0,0.8465,0.6475,0.0,0.0,0.7621,0.6833,0.0,0.0,0.7301,0.6669,0.0,0.0,0.7451,0.4819,0.0,0.0,0.8762,0.3395,0.0,0.0,0.9406,0.406,0.0,0.0,0.9139,0.5348,0.0,0.0,0.845,0.6221,0.0,0.0,0.7829,0.6209,0.0,0.0,0.7839,0.5891,0.0,0.0,0.808,0.4656,0.0,0.0,0.885,0.2921,0.0,0.0,0.9564,0.1941,0.0,0.0,0.981,0.3072,0.0,0.0,0.9516,0.5585,0.0,0.0,0.8295,0.6599,0.0,0.0,0.7513,0.7087,0.0,0.0,0.7055,0.6735,0.0,0.0,0.7392,0.5551,0.0,0.0,0.8318,0.4698,0.0,0.0,0.8828,0.4927,0.0,0.0,0.8702,0.6007,0.0,0.0,0.7995,0.7165,0.0,0.0,0.6976,0.7474,0.0,0.0,0.6644,0.7312,0.0,0.0,0.6821,0.6467,0.0,0.0,0.7627,0.4757,0.0,0.0,0.8796,0.3591,0.0,0.0,0.9333,0.3954,0.0,0.0,0.9185,0.5759,0.0,0.0,0.8175,0.698,0.0,0.0,0.7161,0.7115,0.0,0.0,0.7027,0.6918,0.0,0.0,0.7221,0.6113,0.0,0.0,0.7914,0.5067,0.0,0.0,0.8621,0.462,0.0,0.0,0.8869,0.4544,0.0,0.0,0.8908,0.5003,0.0,0.0,0.8658,0.5444,0.0,0.0,0.8388,0.5528,0.0,0.0,0.8333,0.5148,0.0,0.0,0.8573,0.3829,0.0,0.0,0.9238,0.3281,0.0,0.0,0.9446,0.3338,0.0,0.0,0.9426,0.436,0.0,0.0,0.8999,0.519,0.0,0.0,0.8548,0.533,0.0,0.0,0.8461,0.5489,0.0,0.0,0.8359,0.4877,0.0,0.0,0.873,0.4011,0.0,0.0,0.9161,0.3743,0.0,0.0,0.9273,0.3914,0.0,0.0,0.9202,0.494,0.0,0.0,0.8694,0.5773,0.0,0.0,0.8165,0.5929,0.0,0.0,0.8053,0.5879,0.0,0.0,0.809,0.5219,0.0,0.0,0.853,0.329,0.0,0.0,0.9443,0.0903,0.0,0.0,0.9959,0.0391,0.0,0.0,0.9992,0.0306,0.0,0.0,0.9995,0.05,0.0,0.0,0.9987,0.0837,0.0,0.0,0.9965,0.1763,0.0,0.0,0.9843,0.5021,0.0,0.0,0.8648,0.6682,0.0,0.0,0.744,0.6774,0.0,0.0,0.7356,0.6763,0.0,0.0,0.7366,0.669,0.0,0.0,0.7433,0.637,0.0,0.0,0.7709,0.4615,0.0,0.0,0.8871,0.4298,0.0,0.0,0.9029,0.4368,0.0,0.0,0.8995,0.5213,0.0,0.0,0.8534,0.6709,0.0,0.0,0.7416,0.6791,0.0,0.0,0.734,0.6767,0.0,0.0,0.7363,0.5861,0.0,0.0,0.8102,0.4733,0.0,0.0,0.8809,0.4706,0.0,0.0,0.8823,0.4962,0.0,0.0,0.8682,0.6095,0.0,0.0,0.7928,0.7007,0.0,0.0,0.7135,0.7042,0.0,0.0,0.71,0.6939,0.0,0.0,0.7201,0.6007,0.0,0.0,0.7995,0.486,0.0,0.0,0.8739,0.4796,0.0,0.0,0.8775,0.4971,0.0,0.0,0.8677,0.6097,0.0,0.0,0.7926,0.7011,0.0,0.0,0.7131,0.7041,0.0,0.0,0.7101,0.6939,0.0,0.0,0.7201,0.6007,0.0,0.0,0.7995,0.486,0.0,0.0,0.8739,0.4796,0.0,0.0,0.8775,0.4971,0.0,0.0,0.8677,0.6097,0.0,0.0,0.7926,0.7011,0.0,0.0,0.7131,0.7041,0.0,0.0,0.7101,0.6939,0.0,0.0,0.7201,0.6007,0.0,0.0,0.7995,0.486,0.0,0.0,0.8739,0.4796,0.0,0.0,0.8775,0.4971,0.0,0.0,0.8677,0.6097,0.0,0.0,0.7926,0.7011,0.0,0.0,0.7131,0.703,0.0,0.0,0.7112,0.6901,0.0,0.0,0.7237,0.5937,0.0,0.0,0.8047,0.4753,0.0,0.0,0.8798,0.4705,0.0,0.0,0.8824,0.4962,0.0,0.0,0.8682,0.6095,0.0,0.0,0.7928,0.7007,0.0,0.0,0.7135,0.7042,0.0,0.0,0.71,0.6939,0.0,0.0,0.7201,0.6007,0.0,0.0,0.7995,0.486,0.0,0.0,0.8739,0.4796,0.0,0.0,0.8775,0.4971,0.0,0.0,0.8677,0.6097,0.0,0.0,0.7926,0.7011,0.0,0.0,0.7131,0.6965,0.0,0.0,0.7175,0.6214,0.0,0.0,0.7835,0.4815,0.0,0.0,0.8765,0.377,0.0,0.0,0.9262,0.4252,0.0,0.0,0.9051,0.5292,0.0,0.0,0.8485,0.6029,0.0,0.0,0.7978,0.6117,0.0,0.0,0.7911,0.5802,0.0,0.0,0.8145,0.521,0.0,0.0,0.8536,0.4456,0.0,0.0,0.8952,0.3933,0.0,0.0,0.9194,0.4412,0.0,0.0,0.8974,0.6325,0.0,0.0,0.7746,0.7159,0.0,0.0,0.6982,0.7052,0.0,0.0,0.709,0.6262,0.0,0.0,0.7797,0.492,0.0,0.0,0.8706,0.3839,0.0,0.0,0.9234,0.4322,0.0,0.0,0.9018,0.5511,0.0,0.0,0.8344,0.6231,0.0,0.0,0.7822,0.6422,0.0,0.0,0.7666,0.639,0.0,0.0,0.7692,0.5835,0.0,0.0,0.8121,0.471,0.0,0.0,0.8821,0.3271,0.0,0.0,0.945,0.2469,0.0,0.0,0.969,0.318,0.0,0.0,0.9481,0.4792,0.0,0.0,0.8777,0.6289,0.0,0.0,0.7775,0.619,0.0,0.0,0.7854,0.538,0.0,0.0,0.8429,0.4667,0.0,0.0,0.8844,0.4723,0.0,0.0,0.8815,0.4916,0.0,0.0,0.8708,0.4845,0.0,0.0,0.8748,0.4463,0.0,0.0,0.8949,0.4314,0.0,0.0,0.9022,0.4228,0.0,0.0,0.9062,0.3845,0.0,0.0,0.9231,0.411,0.0,0.0,0.9116,0.4097,0.0,0.0,0.9122,0.3822,0.0,0.0,0.9241,0.3685,0.0,0.0,0.9296,0.3809,0.0,0.0,0.9246,0.3764,0.0,0.0,0.9264,0.3464,0.0,0.0,0.9381,0.3176,0.0,0.0,0.9482,0.3613,0.0,0.0,0.9324,0.3263,0.0,0.0,0.9453,0.3381,0.0,0.0,0.9411,0.3808,0.0,0.0,0.9247,0.3502,0.0,0.0,0.9367,0.233,0.0,0.0,0.9725,0.166,0.0,0.0,0.9861,0.1972,0.0,0.0,0.9804,0.2428,0.0,0.0,0.9701,0.2021,0.0,0.0,0.9794,0.2239,0.0,0.0,0.9746,0.2536,0.0,0.0,0.9673,0.254,0.0,0.0,0.9672,0.2537,0.0,0.0,0.9673,0.2534,0.0,0.0,0.9674,0.2532,0.0,0.0,0.9674,0.253,0.0,0.0,0.9675,0.2528,0.0,0.0,0.9675,0.2526,0.0,0.0,0.9676,0.2524,0.0,0.0,0.9676,0.2523,0.0,0.0,0.9677,0.2521,0.0,0.0,0.9677,0.252,0.0,0.0,0.9677,0.2519,0.0,0.0,0.9677,0.2519,0.0,0.0,0.9678,0.2518,0.0,0.0,0.9678,0.2518,0.0,0.0,0.9678,0.2518,0.0,0.0,0.9678,0.2517,0.0,0.0,0.9678,0.2518,0.0,0.0,0.9678,0.2518,0.0,0.0,0.9678,0.2518,0.0,0.0,0.9678,0.2519,0.0,0.0,0.9678,0.2519,0.0,0.0,0.9677,0.252,0.0,0.0,0.9677,0.2521,0.0,0.0,0.9677,0.2522,0.0,0.0,0.9677,0.2523,0.0,0.0,0.9677,0.2524,0.0,0.0,0.9676,0.2525,0.0,0.0,0.9676,0.2527,0.0,0.0,0.9676,0.2528,0.0,0.0,0.9675,0.253,0.0,0.0,0.9675,0.2532,0.0,0.0,0.9674,0.2533,0.0,0.0,0.9674,0.2535,0.0,0.0,0.9673,0.2537,0.0,0.0,0.9673,0.2539,0.0,0.0,0.9672,0.2541,0.0,0.0,0.9672,0.2543,0.0,0.0,0.9671,0.2544,0.0,0.0,0.9671,0.2561,0.0,0.0,0.9666,0.2721,0.0,0.0,0.9623,0.3026,0.0,0.0,0.9531,0.344,0.0,0.0,0.939,0.3926,0.0,0.0,0.9197,0.4448,0.0,0.0,0.8956,0.4973,0.0,0.0,0.8676,0.5469,0.0,0.0,0.8372,0.5909,0.0,0.0,0.8068,0.627,0.0,0.0,0.779,0.6533,0.0,0.0,0.7571,0.6681,0.0,0.0,0.7441,0.6707,0.0,0.0,0.7417]},{"n":"Adventurer_Left_Foot","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[0.2831,-0.0763,-0.0226,0.9558,0.2895,-0.0874,-0.0266,0.9528,0.319,-0.0932,-0.0315,0.9426,0.3534,-0.095,-0.0361,0.9299,0.3748,-0.0945,-0.0384,0.9215,0.3863,-0.0871,-0.0367,0.9175,0.3753,-0.0724,-0.0294,0.9236,0.3291,-0.063,-0.022,0.9419,0.2796,-0.0511,-0.0149,0.9586,0.2494,-0.0379,-0.0098,0.9676,0.1836,-0.0297,-0.0056,0.9825,0.0523,-0.0246,-0.0013,0.9983,-0.0468,-0.0196,0.0009,0.9987,0.0122,-0.0405,-0.0005,0.9991,0.1172,-0.0513,-0.0061,0.9918,0.1864,-0.0585,-0.0111,0.9807,0.2158,-0.0669,-0.0148,0.974,0.2497,-0.0749,-0.0194,0.9652,0.299,-0.0798,-0.0251,0.9506,0.3373,-0.0814,-0.0293,0.9374,0.3533,-0.0812,-0.0308,0.9315,0.3526,-0.0617,-0.0233,0.9334,0.3162,-0.0474,-0.0158,0.9474,0.2739,-0.0313,-0.0089,0.9612,0.2435,-0.0175,-0.0044,0.9697,0.1779,-0.0068,-0.0012,0.984,0.0693,0.0037,0.0003,0.9976,-0.0381,0.0135,-0.0005,0.9992,-0.0103,-0.0009,0.0,0.9999,0.1082,-0.0157,-0.0017,0.994,0.1885,-0.0256,-0.0049,0.9817,0.2197,-0.0362,-0.0081,0.9749,0.2589,-0.0469,-0.0126,0.9647,0.3042,-0.0546,-0.0175,0.9509,0.3363,-0.0593,-0.0212,0.9396,0.3512,-0.0623,-0.0234,0.9339,0.3562,-0.0485,-0.0185,0.933,0.3291,-0.0327,-0.0114,0.9436,0.2837,-0.0144,-0.0043,0.9588,0.2512,0.0017,0.0004,0.9679,0.1972,0.015,0.003,0.9802,0.103,0.0289,0.003,0.9943,-0.0145,0.0421,-0.0006,0.999,-0.04,0.0399,-0.0016,0.9984,0.0678,0.0187,0.0013,0.9975,0.1656,0.0045,0.0008,0.9862,0.2124,-0.0073,-0.0016,0.9772,0.2461,-0.0196,-0.005,0.969,0.2935,-0.0306,-0.0094,0.9554,0.331,-0.0382,-0.0134,0.9427,0.3504,-0.0424,-0.0159,0.9355,0.3542,-0.0401,-0.0152,0.9342,0.3419,-0.0293,-0.0107,0.9392,0.3114,-0.0179,-0.0059,0.9501,0.2699,-0.0057,-0.0016,0.9629,0.2361,0.0043,0.0011,0.9717,0.1522,0.0124,0.0019,0.9883,-0.0415,0.022,-0.0009,0.9989,-0.1508,0.0242,-0.0037,0.9883,-0.1431,0.0132,-0.0019,0.9896,-0.0333,0.0032,-0.0001,0.9994,0.0965,-0.0102,-0.001,0.9953,0.1399,-0.0211,-0.003,0.9899,0.1315,-0.0307,-0.0041,0.9908,0.1202,-0.0463,-0.0056,0.9917,0.0155,-0.0593,-0.0009,0.9981,-0.0594,-0.0705,0.0042,0.9957,0.0152,-0.0872,-0.0013,0.9961,0.1444,-0.0846,-0.0124,0.9858,0.2482,-0.0792,-0.0204,0.9652,0.2919,-0.072,-0.022,0.9535,0.332,-0.057,-0.0201,0.9413,0.3061,-0.0459,-0.0148,0.9508,0.2405,-0.0174,-0.0043,0.9705,0.2109,-0.0603,-0.013,0.9756,0.2279,-0.0331,-0.0077,0.9731,0.2805,-0.0123,-0.0036,0.9598,0.2502,-0.0032,-0.0008,0.9682,0.2024,-0.0049,-0.001,0.9793,0.1324,-0.0002,-0.0,0.9912,0.0373,0.0032,0.0001,0.9993,-0.0103,-0.0066,0.0001,0.9999,-0.0208,-0.0052,0.0001,0.9998,0.0106,0.0004,0.0,0.9999,0.0465,0.002,0.0001,0.9989,0.0417,0.0058,0.0002,0.9991,0.0464,0.0126,0.0006,0.9988,0.0256,0.0213,0.0005,0.9994,-0.0485,0.0344,-0.0017,0.9982,-0.1011,0.048,-0.0049,0.9937,-0.0365,-0.0013,0.0,0.9993,0.114,-0.039,-0.0045,0.9927,0.2297,-0.0602,-0.0142,0.9713,0.2766,-0.082,-0.0237,0.9572,0.2897,-0.0767,-0.0233,0.9537,0.2567,-0.0637,-0.017,0.9642,0.1982,-0.0527,-0.0107,0.9787,0.167,-0.0456,-0.0077,0.9849,0.1927,-0.0324,-0.0064,0.9807,0.2486,-0.0178,-0.0046,0.9684,0.2921,-0.0016,-0.0005,0.9564,0.2908,-0.0033,-0.001,0.9568,0.2313,-0.0413,-0.0098,0.9719,0.1115,-0.076,-0.0085,0.9908,0.0354,-0.1055,-0.0038,0.9938,0.1154,-0.088,-0.0103,0.9894,0.2089,-0.0661,-0.0141,0.9756,0.2785,-0.0465,-0.0135,0.9592,0.2958,-0.0379,-0.0118,0.9544,0.2751,-0.0467,-0.0134,0.9602,0.2178,-0.05,-0.0112,0.9746,0.1419,-0.0495,-0.0071,0.9886,0.1011,-0.0469,-0.0048,0.9938,0.1559,-0.0495,-0.0078,0.9865,0.2354,-0.0457,-0.0111,0.9708,0.2961,-0.0391,-0.0121,0.9543,0.3123,-0.0353,-0.0116,0.9493,0.2991,-0.0447,-0.014,0.9531,0.2542,-0.0548,-0.0144,0.9655,0.1546,-0.0694,-0.0109,0.9855,0.0253,-0.0863,-0.0022,0.9959,-0.0479,-0.0949,0.0046,0.9943,-0.0691,-0.1015,0.0071,0.9924,-0.069,-0.0457,0.0032,0.9966,-0.053,-0.0117,0.0006,0.9985,0.0077,0.0093,0.0001,0.9999,0.2062,0.0171,0.0036,0.9783,0.3228,0.0159,0.0054,0.9463,0.334,0.0109,0.0039,0.9425,0.3282,-0.007,-0.0024,0.9446,0.3047,-0.0379,-0.0121,0.9516,0.2773,-0.0566,-0.0164,0.959,0.1967,-0.0808,-0.0163,0.977,0.1833,-0.0907,-0.017,0.9787,0.1824,-0.0424,-0.0079,0.9823,0.2247,-0.0088,-0.002,0.9744,0.3268,0.0039,0.0013,0.9451,0.321,-0.0096,-0.0033,0.947,0.2719,-0.0592,-0.0168,0.9604,0.1964,-0.1028,-0.0207,0.9749,0.1286,-0.1364,-0.0179,0.9821,0.1492,-0.1056,-0.016,0.983,0.2183,-0.0193,-0.0043,0.9757,0.2924,0.0045,0.0014,0.9563,0.3584,0.0101,0.0039,0.9335,0.3602,-0.0027,-0.0011,0.9329,0.3382,-0.0366,-0.0132,0.9403,0.2766,-0.0662,-0.0191,0.9585,0.2202,-0.088,-0.02,0.9713,0.2208,-0.0718,-0.0163,0.9725,0.2272,-0.0246,-0.0057,0.9735,0.2925,-0.0006,-0.0002,0.9563,0.3588,0.0096,0.0037,0.9334,0.3602,-0.0027,-0.001,0.9329,0.3382,-0.0366,-0.0132,0.9403,0.2766,-0.0662,-0.0191,0.9585,0.2202,-0.088,-0.02,0.9713,0.2208,-0.0718,-0.0163,0.9725,0.2272,-0.0246,-0.0057,0.9735,0.2925,-0.0006,-0.0002,0.9563,0.3588,0.0096,0.0037,0.9334,0.3602,-0.0027,-0.001,0.9329,0.3382,-0.0366,-0.0132,0.9403,0.2766,-0.0662,-0.0191,0.9585,0.2202,-0.088,-0.02,0.9713,0.2208,-0.0718,-0.0163,0.9725,0.2272,-0.0246,-0.0057,0.9735,0.2925,-0.0006,-0.0002,0.9563,0.3588,0.0096,0.0037,0.9334,0.3515,-0.0046,-0.0017,0.9362,0.29,-0.0581,-0.0176,0.9551,0.2009,-0.1046,-0.0216,0.9738,0.1292,-0.1371,-0.018,0.9819,0.1491,-0.1056,-0.016,0.983,0.2183,-0.0193,-0.0043,0.9757,0.2924,0.0045,0.0014,0.9563,0.3584,0.0101,0.0039,0.9335,0.3602,-0.0027,-0.0011,0.9329,0.3382,-0.0366,-0.0132,0.9403,0.2766,-0.0662,-0.0191,0.9585,0.2202,-0.088,-0.02,0.9713,0.2208,-0.0718,-0.0163,0.9725,0.2272,-0.0246,-0.0057,0.9735,0.2925,-0.0006,-0.0002,0.9563,0.3588,0.0096,0.0037,0.9334,0.3551,0.0092,0.0035,0.9348,0.3088,-0.0043,-0.0014,0.9511,0.248,-0.018,-0.0046,0.9686,0.2088,-0.0103,-0.0022,0.9779,0.2556,-0.0164,-0.0043,0.9666,0.3162,-0.0142,-0.0047,0.9486,0.2976,-0.0091,-0.0029,0.9546,0.2577,-0.0206,-0.0055,0.966,0.2684,-0.0083,-0.0023,0.9633,0.2357,-0.0014,-0.0003,0.9718,0.1803,0.0059,0.0011,0.9836,0.1443,0.0129,0.0019,0.9895,0.1878,0.0195,0.0037,0.982,0.3004,-0.0121,-0.0038,0.9537,0.3393,-0.0381,-0.0138,0.9398,0.3255,-0.0478,-0.0165,0.9442,0.2633,-0.0614,-0.0168,0.9626,0.1606,-0.0824,-0.0135,0.9835,0.0468,-0.1072,-0.005,0.9931,0.0106,-0.1261,-0.0013,0.992,0.0207,-0.1395,-0.0029,0.99,0.0067,-0.1558,-0.0011,0.9878,-0.0653,-0.1837,0.0122,0.9807,-0.0053,-0.1678,0.0009,0.9858,0.0893,-0.1247,-0.0113,0.9881,0.134,-0.0852,-0.0116,0.9872,0.1267,-0.0487,-0.0062,0.9907,0.0965,-0.0086,-0.0008,0.9953,0.1329,0.0254,0.0034,0.9908,0.2068,0.0473,0.01,0.9772,0.2742,0.0609,0.0174,0.9596,0.2824,0.0354,0.0104,0.9586,0.2629,-0.0022,-0.0006,0.9648,0.2425,-0.026,-0.0065,0.9698,0.2326,-0.0309,-0.0074,0.972,0.1926,-0.0122,-0.0024,0.9812,0.1854,0.0104,0.002,0.9826,0.1814,0.003,0.0006,0.9834,0.1787,-0.0313,-0.0057,0.9834,0.1799,-0.0303,-0.0055,0.9832,0.1757,-0.0303,-0.0054,0.984,0.2186,-0.0266,-0.006,0.9754,0.2098,-0.0207,-0.0044,0.9775,0.1513,-0.0037,-0.0006,0.9885,0.1441,-0.0033,-0.0005,0.9896,0.1274,-0.1203,-0.0156,0.9844,0.1506,-0.0231,-0.0035,0.9883,0.148,-0.0149,-0.0022,0.9889,0.1501,-0.0133,-0.002,0.9886,0.1379,-0.0745,-0.0104,0.9876,0.0914,-0.0807,-0.0074,0.9925,0.1089,-0.0554,-0.0061,0.9925,0.1451,-0.0377,-0.0055,0.9887,0.1307,-0.0263,-0.0035,0.9911,0.0862,-0.0218,-0.0019,0.996,0.074,-0.0182,-0.0013,0.9971,0.0958,-0.0062,-0.0006,0.9954,0.0639,-0.0689,-0.0044,0.9956,-0.0474,-0.0871,0.0041,0.9951,-0.0047,-0.0597,0.0003,0.9982,0.0559,-0.0396,-0.0022,0.9976,0.0565,-0.0381,-0.0022,0.9977,0.0563,-0.0381,-0.0022,0.9977,0.0562,-0.0381,-0.0022,0.9977,0.0561,-0.0382,-0.0021,0.9977,0.056,-0.0382,-0.0021,0.9977,0.0558,-0.0383,-0.0021,0.9977,0.0556,-0.0383,-0.0021,0.9977,0.0552,-0.0384,-0.0021,0.9977,0.0549,-0.0384,-0.0021,0.9977,0.0548,-0.0385,-0.0021,0.9978,0.0544,-0.0385,-0.0021,0.9978,0.0541,-0.0386,-0.0021,0.9978,0.0538,-0.0386,-0.0021,0.9978,0.0536,-0.0387,-0.0021,0.9978,0.0534,-0.0387,-0.0021,0.9978,0.0533,-0.0387,-0.0021,0.9978,0.0532,-0.0388,-0.0021,0.9978,0.053,-0.0388,-0.0021,0.9978,0.0526,-0.0388,-0.002,0.9979,0.0525,-0.0389,-0.002,0.9979,0.0526,-0.0389,-0.002,0.9979,0.0524,-0.0389,-0.002,0.9979,0.0522,-0.0389,-0.002,0.9979,0.0523,-0.0389,-0.002,0.9979,0.0525,-0.0389,-0.002,0.9979,0.0527,-0.0388,-0.0021,0.9979,0.0529,-0.0388,-0.0021,0.9978,0.0532,-0.0388,-0.0021,0.9978,0.0534,-0.0387,-0.0021,0.9978,0.0537,-0.0387,-0.0021,0.9978,0.054,-0.0386,-0.0021,0.9978,0.0544,-0.0385,-0.0021,0.9978,0.0548,-0.0384,-0.0021,0.9978,0.0552,-0.0384,-0.0021,0.9977,0.0556,-0.0383,-0.0021,0.9977,0.0561,-0.0382,-0.0021,0.9977,0.0563,-0.0381,-0.0022,0.9977,0.0565,-0.0381,-0.0022,0.9977,0.0569,-0.038,-0.0022,0.9977,0.058,-0.038,-0.0022,0.9976,0.0663,-0.0393,-0.003,0.997,0.0818,-0.0419,-0.0043,0.9958,0.1028,-0.0455,-0.0062,0.9936,0.1278,-0.0497,-0.0085,0.9905,0.1552,-0.0544,-0.011,0.9863,0.1833,-0.0593,-0.0135,0.9812,0.2106,-0.0639,-0.016,0.9753,0.2356,-0.0682,-0.0183,0.9693,0.2567,-0.0718,-0.0202,0.9636,0.2725,-0.0745,-0.0216,0.959,0.2815,-0.0761,-0.0225,0.9563,0.2831,-0.0763,-0.0226,0.9558]},{"n":"Adventurer_Right_Foot","p":"q","t":[0.0,0.05,0.1,0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5,0.55,0.6,0.65,0.7,0.75,0.8,0.85,0.9,0.95,1.0,1.05,1.1,1.15,1.2,1.25,1.3,1.35,1.4,1.45,1.5,1.55,1.6,1.65,1.7,1.75,1.8,1.85,1.9,1.95,2.0,2.05,2.1,2.15,2.2,2.25,2.3,2.35,2.4,2.45,2.5,2.55,2.6,2.65,2.7,2.75,2.8,2.85,2.9,2.95,3.0,3.05,3.1,3.15,3.2,3.25,3.3,3.35,3.4,3.45,3.5,3.55,3.6,3.65,3.7,3.75,3.8,3.85,3.9,3.95,4.0,4.05,4.1,4.15,4.2,4.25,4.3,4.35,4.4,4.45,4.5,4.55,4.6,4.65,4.7,4.75,4.8,4.85,4.9,4.95,5.0,5.05,5.1,5.15,5.2,5.25,5.3,5.35,5.4,5.45,5.5,5.55,5.6,5.65,5.7,5.75,5.8,5.85,5.9,5.95,6.0,6.05,6.1,6.15,6.2,6.25,6.3,6.35,6.4,6.45,6.5,6.55,6.6,6.65,6.7,6.75,6.8,6.85,6.9,6.95,7.0,7.05,7.1,7.15,7.2,7.25,7.3,7.35,7.4,7.45,7.5,7.55,7.6,7.65,7.7,7.75,7.8,7.85,7.9,7.95,8.0,8.05,8.1,8.15,8.2,8.25,8.3,8.35,8.4,8.45,8.5,8.55,8.6,8.65,8.7,8.75,8.8,8.85,8.9,8.95,9.0,9.05,9.1,9.15,9.2,9.25,9.3,9.35,9.4,9.45,9.5,9.55,9.6,9.65,9.7,9.75,9.8,9.85,9.9,9.95,10.0,10.05,10.1,10.15,10.2,10.25,10.3,10.35,10.4,10.45,10.5,10.55,10.6,10.65,10.7,10.75,10.8,10.85,10.9,10.95,11.0,11.05,11.1,11.15,11.2,11.25,11.3,11.35,11.4,11.45,11.5,11.55,11.6,11.65,11.7,11.75,11.8,11.85,11.9,11.95,12.0,12.05,12.1,12.15,12.2,12.25,12.3,12.35,12.4,12.45,12.5,12.55,12.6,12.65,12.7,12.75,12.8,12.85,12.9,12.95,13.0,13.05,13.1,13.15,13.2,13.25,13.3,13.35,13.4,13.45,13.5,13.55,13.6,13.65,13.7,13.75,13.8,13.85,13.9,13.95,14.0,14.05,14.1,14.15,14.2,14.25,14.3,14.35,14.4,14.45,14.5,14.55,14.6,14.65,14.7,14.75,14.8,14.83],"v":[0.2545,0.0758,0.02,0.9639,0.2812,0.0642,0.0189,0.9573,0.3323,0.0518,0.0183,0.9416,0.3848,0.0407,0.017,0.922,0.4174,0.0339,0.0156,0.908,0.4203,0.033,0.0153,0.9067,0.3813,0.0374,0.0154,0.9236,0.3113,0.0448,0.0147,0.9491,0.2426,0.0487,0.0122,0.9688,0.2121,0.0462,0.01,0.9761,0.1783,0.0378,0.0068,0.9832,0.1182,0.0286,0.0034,0.9926,0.0749,0.0248,0.0019,0.9969,0.0999,0.0314,0.0032,0.9945,0.1418,0.0388,0.0056,0.9891,0.1767,0.0455,0.0082,0.9832,0.1957,0.0497,0.0099,0.9794,0.2408,0.049,0.0122,0.9693,0.3129,0.0434,0.0143,0.9487,0.3729,0.0361,0.0145,0.9271,0.3973,0.0327,0.0142,0.917,0.3739,0.0255,0.0103,0.9271,0.3055,0.0224,0.0072,0.9519,0.2443,0.0142,0.0036,0.9696,0.2186,0.002,0.0005,0.9758,0.1798,-0.0141,-0.0026,0.9836,0.1228,-0.0327,-0.0041,0.9919,0.0724,-0.0482,-0.0035,0.9962,0.0863,-0.0326,-0.0028,0.9957,0.1389,-0.0077,-0.0011,0.9903,0.1793,0.0123,0.0023,0.9837,0.2027,0.0253,0.0052,0.9789,0.2509,0.0326,0.0085,0.9674,0.3151,0.0356,0.0118,0.9483,0.3676,0.0342,0.0135,0.9292,0.3964,0.0329,0.0142,0.9174,0.3881,0.0267,0.0113,0.9212,0.3304,0.0237,0.0083,0.9435,0.2604,0.0173,0.0047,0.9653,0.2251,0.0066,0.0015,0.9743,0.1949,-0.0086,-0.0017,0.9808,0.1435,-0.0263,-0.0038,0.9893,0.0864,-0.0436,-0.0038,0.9953,0.0724,-0.0424,-0.0031,0.9965,0.122,-0.0156,-0.0019,0.9924,0.1683,0.0064,0.0011,0.9857,0.1931,0.0217,0.0043,0.9809,0.2315,0.0307,0.0073,0.9723,0.2939,0.0352,0.0108,0.9551,0.352,0.0349,0.0131,0.9353,0.3888,0.0326,0.0138,0.9207,0.3961,0.031,0.0134,0.9176,0.3656,0.0294,0.0116,0.9302,0.3067,0.0301,0.0097,0.9513,0.2457,0.0275,0.007,0.9689,0.2125,0.0219,0.0048,0.9769,0.1577,0.0115,0.0018,0.9874,0.0317,-0.0023,-0.0001,0.9995,-0.0757,-0.0094,0.0007,0.9971,-0.0161,0.0285,-0.0005,0.9995,0.1274,0.0491,0.0063,0.9906,0.2483,0.0544,0.014,0.9671,0.315,0.0545,0.0181,0.9473,0.3367,0.0548,0.0196,0.9398,0.3536,0.0477,0.0181,0.934,0.2725,0.048,0.0136,0.9609,0.2139,0.0348,0.0076,0.9762,0.2083,-0.0071,-0.0015,0.978,0.2264,-0.032,-0.0074,0.9735,0.2201,-0.0436,-0.0098,0.9745,0.1648,-0.0496,-0.0083,0.985,0.1263,-0.0225,-0.0029,0.9917,0.0498,-0.0059,-0.0003,0.9987,-0.0435,0.0227,-0.001,0.9988,-0.1036,-0.0086,0.0009,0.9946,0.0082,0.0571,0.0005,0.9983,0.1813,0.071,0.0131,0.9808,0.2776,0.0753,0.0218,0.9575,0.3544,0.0382,0.0145,0.9342,0.3564,0.0316,0.0121,0.9337,0.3108,0.0198,0.0065,0.9502,0.2846,-0.0078,-0.0023,0.9586,0.2918,-0.0094,-0.0029,0.9564,0.3384,-0.0036,-0.0013,0.941,0.3974,-0.0008,-0.0003,0.9176,0.399,0.0,0.0,0.9169,0.3943,0.0053,0.0023,0.919,0.3502,0.0101,0.0038,0.9366,0.2602,0.015,0.004,0.9654,0.2069,0.0188,0.004,0.9782,0.2113,0.0255,0.0055,0.9771,0.2911,0.0258,0.0079,0.9563,0.3499,0.0251,0.0094,0.9364,0.3584,0.0207,0.008,0.9333,0.3478,0.0121,0.0045,0.9375,0.2978,0.0053,0.0017,0.9546,0.2391,-0.0056,-0.0014,0.971,0.2112,-0.0253,-0.0055,0.9771,0.2111,-0.0174,-0.0038,0.9773,0.2395,-0.0065,-0.0016,0.9709,0.2656,0.0055,0.0015,0.9641,0.273,0.0036,0.001,0.962,0.2482,-0.0262,-0.0067,0.9683,0.1694,-0.0567,-0.0098,0.9839,0.1332,-0.0842,-0.0114,0.9874,0.15,-0.046,-0.007,0.9876,0.2067,-0.0171,-0.0036,0.9782,0.2524,0.0065,0.0017,0.9676,0.258,0.0226,0.006,0.9659,0.2629,0.0228,0.0062,0.9645,0.23,0.0295,0.007,0.9727,0.1833,0.0357,0.0067,0.9824,0.1704,0.0381,0.0066,0.9846,0.1801,0.0323,0.0059,0.9831,0.2331,0.0234,0.0056,0.9721,0.2806,0.0183,0.0053,0.9596,0.2911,0.0158,0.0048,0.9565,0.2879,0.0202,0.0061,0.9574,0.251,0.0274,0.0071,0.9676,0.1596,0.0378,0.0061,0.9864,0.0398,0.0436,0.0017,0.9983,-0.0214,0.0457,-0.001,0.9987,-0.0375,0.0468,-0.0018,0.9982,-0.0446,-0.0057,0.0003,0.999,-0.0319,-0.036,0.0012,0.9988,0.0211,-0.0506,-0.0011,0.9985,0.2014,-0.0449,-0.0092,0.9784,0.3123,-0.0335,-0.011,0.9493,0.3255,-0.0241,-0.0083,0.9452,0.3223,0.0003,0.0001,0.9466,0.2936,0.0401,0.0123,0.955,0.2585,0.064,0.0172,0.9637,0.1742,0.0892,0.0159,0.9805,0.1598,0.1012,0.0165,0.9818,0.166,0.042,0.0071,0.9852,0.2135,-0.0,-0.0,0.9769,0.3211,-0.0136,-0.0046,0.9469,0.3252,-0.0088,-0.003,0.9456,0.3141,0.0007,0.0002,0.9494,0.2693,0.0025,0.0007,0.9631,0.2215,0.0043,0.001,0.9752,0.2172,0.0018,0.0004,0.9761,0.216,-0.0015,-0.0003,0.9764,0.2833,-0.0168,-0.005,0.9589,0.3509,-0.0258,-0.0097,0.936,0.3533,-0.0104,-0.0039,0.9355,0.3326,0.0304,0.0107,0.9425,0.2673,0.0638,0.0178,0.9613,0.2082,0.088,0.0188,0.9739,0.2088,0.0677,0.0145,0.9755,0.2178,0.01,0.0022,0.9759,0.2831,-0.0166,-0.0049,0.9589,0.3497,-0.0257,-0.0096,0.9365,0.3533,-0.0104,-0.0039,0.9354,0.3326,0.0304,0.0107,0.9425,0.2673,0.0638,0.0178,0.9613,0.2082,0.088,0.0188,0.9739,0.2088,0.0677,0.0145,0.9755,0.2178,0.01,0.0022,0.9759,0.2831,-0.0166,-0.0049,0.9589,0.3497,-0.0257,-0.0096,0.9365,0.3533,-0.0104,-0.0039,0.9354,0.3326,0.0304,0.0107,0.9425,0.2673,0.0638,0.0178,0.9613,0.2082,0.088,0.0188,0.9739,0.2088,0.0677,0.0145,0.9755,0.2178,0.01,0.0022,0.9759,0.2831,-0.0166,-0.0049,0.9589,0.3497,-0.0257,-0.0096,0.9365,0.3521,-0.0181,-0.0068,0.9358,0.3327,-0.0019,-0.0007,0.943,0.2764,0.0029,0.0008,0.961,0.2231,0.0045,0.001,0.9748,0.2169,0.0017,0.0004,0.9762,0.216,-0.0015,-0.0003,0.9764,0.2833,-0.0168,-0.005,0.9589,0.3509,-0.0258,-0.0097,0.936,0.3533,-0.0104,-0.0039,0.9355,0.3326,0.0304,0.0107,0.9425,0.2673,0.0638,0.0178,0.9613,0.2082,0.088,0.0188,0.9739,0.2088,0.0677,0.0145,0.9755,0.2178,0.01,0.0022,0.9759,0.2831,-0.0166,-0.0049,0.9589,0.3497,-0.0257,-0.0096,0.9365,0.3495,-0.0175,-0.0065,0.9367,0.2959,0.0183,0.0057,0.955,0.2086,0.0611,0.0131,0.976,0.1564,0.0906,0.0144,0.9834,0.1832,0.0727,0.0136,0.9803,0.2233,0.0592,0.0136,0.9729,0.2438,0.0367,0.0092,0.9691,0.2201,0.0283,0.0064,0.975,0.2149,0.0171,0.0038,0.9765,0.1913,0.0058,0.0011,0.9815,0.1572,-0.0075,-0.0012,0.9875,0.1451,-0.0205,-0.003,0.9892,0.185,-0.0363,-0.0068,0.982,0.2899,-0.0344,-0.0104,0.9564,0.3393,-0.0308,-0.0111,0.9401,0.3333,-0.0305,-0.0108,0.9423,0.2914,-0.0318,-0.0097,0.956,0.223,-0.0352,-0.008,0.9742,0.1737,-0.0379,-0.0067,0.9841,0.2036,-0.0372,-0.0077,0.9783,0.2696,-0.0321,-0.009,0.9624,0.3288,-0.0123,-0.0043,0.9443,0.363,0.0006,0.0002,0.9318,0.3414,-0.0043,-0.0016,0.9399,0.288,-0.0162,-0.0049,0.9575,0.2187,-0.0299,-0.0067,0.9753,0.1445,-0.0422,-0.0062,0.9886,0.0982,-0.0467,-0.0046,0.9941,0.1372,-0.0378,-0.0052,0.9898,0.2178,-0.028,-0.0062,0.9756,0.3006,-0.0209,-0.0066,0.9535,0.2856,-0.0149,-0.0044,0.9582,0.2463,-0.0013,-0.0003,0.9692,0.2337,0.0088,0.0021,0.9723,0.2357,0.0095,0.0023,0.9718,0.2167,-0.0076,-0.0017,0.9762,0.2096,-0.0252,-0.0054,0.9774,0.2109,-0.0208,-0.0045,0.9773,0.2081,0.0086,0.0018,0.9781,0.1921,0.0254,0.005,0.981,0.1982,0.042,0.0085,0.9792,0.2567,0.0403,0.0107,0.9656,0.237,0.0417,0.0102,0.9706,0.149,0.0375,0.0057,0.9881,0.1469,0.0168,0.0025,0.989,0.1641,0.0093,0.0016,0.9864,0.1688,0.0074,0.0013,0.9856,0.1784,0.0498,0.009,0.9827,0.1911,0.0746,0.0146,0.9786,0.1708,0.1004,0.0175,0.98,0.1179,0.0814,0.0097,0.9896,0.1315,0.0374,0.005,0.9906,0.1663,0.0087,0.0015,0.986,0.147,0.0515,0.0077,0.9878,0.1313,0.0925,0.0123,0.9869,0.1415,0.0625,0.009,0.9879,0.079,-0.0982,-0.0078,0.992,0.0736,-0.0329,-0.0024,0.9967,0.0313,0.0109,0.0003,0.9995,0.0874,0.0064,0.0006,0.9962,0.1155,0.0058,0.0007,0.9933,0.1175,0.0053,0.0006,0.9931,0.1176,0.0053,0.0006,0.993,0.1178,0.0052,0.0006,0.993,0.1179,0.0052,0.0006,0.993,0.1181,0.0052,0.0006,0.993,0.1182,0.0051,0.0006,0.993,0.1184,0.0051,0.0006,0.993,0.1185,0.0051,0.0006,0.9929,0.1186,0.005,0.0006,0.9929,0.1187,0.005,0.0006,0.9929,0.119,0.0049,0.0006,0.9929,0.1193,0.0049,0.0006,0.9928,0.1196,0.0049,0.0006,0.9928,0.1199,0.0048,0.0006,0.9928,0.12,0.0048,0.0006,0.9928,0.1199,0.0047,0.0006,0.9928,0.1201,0.0047,0.0006,0.9928,0.1203,0.0047,0.0006,0.9927,0.1203,0.0046,0.0006,0.9927,0.1203,0.0046,0.0006,0.9927,0.1202,0.0045,0.0005,0.9927,0.1202,0.0045,0.0005,0.9927,0.1202,0.0045,0.0005,0.9927,0.1202,0.0045,0.0005,0.9927,0.1202,0.0046,0.0006,0.9927,0.1202,0.0046,0.0006,0.9927,0.1201,0.0047,0.0006,0.9928,0.1199,0.0048,0.0006,0.9928,0.1197,0.0048,0.0006,0.9928,0.1194,0.0049,0.0006,0.9928,0.119,0.005,0.0006,0.9929,0.1191,0.005,0.0006,0.9929,0.1191,0.0051,0.0006,0.9929,0.1187,0.0052,0.0006,0.9929,0.1186,0.0052,0.0006,0.9929,0.1183,0.0053,0.0006,0.993,0.1178,0.0053,0.0006,0.993,0.1175,0.0054,0.0006,0.9931,0.1174,0.0055,0.0006,0.9931,0.1176,0.0058,0.0007,0.993,0.1216,0.0082,0.0014,0.9925,0.1311,0.013,0.0027,0.9913,0.1435,0.0195,0.0045,0.9895,0.1586,0.0272,0.0066,0.9869,0.1751,0.0357,0.0089,0.9839,0.1924,0.0445,0.0114,0.9802,0.2093,0.053,0.0137,0.9763,0.2248,0.0608,0.0159,0.9724,0.238,0.0675,0.0177,0.9688,0.2478,0.0725,0.0191,0.9659,0.2535,0.0753,0.0199,0.9642,0.2545,0.0758,0.02,0.9639]},{"n":"Left_Arm","p":"t","t":[0,14.83],"v":[0.1333,0.4667,0.0,0.1333,0.4667,0.0]},{"n":"Right_Arm","p":"t","t":[0,14.83],"v":[-0.133,0.467,-0.067,-0.133,0.467,-0.067]},{"n":"Torso","p":"t","t":[0,14.83],"v":[0.0,0.1334,0.0,0.0,0.1334,0.0]}]};
const CHEST_SFX="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";
const CHEST_GLB="Z2xURgIAAACEvQEA0EsAAEpTT057ImFzc2V0Ijp7InZlcnNpb24iOiIyLjAiLCJnZW5lcmF0b3IiOiJCbG9ja2JlbmNoIDUuMi4yIGdsVEYgZXhwb3J0ZXIifSwic2NlbmVzIjpbeyJub2RlcyI6WzAsMSwxMywxNCwxNSwxNiwxNywxOF0sIm5hbWUiOiJibG9ja2JlbmNoX2V4cG9ydCJ9XSwic2NlbmUiOjAsIm5vZGVzIjpbeyJ0cmFuc2xhdGlvbiI6WzAsMC4wNjI1LDBdLCJuYW1lIjoiYmV2ZWxlZF9jdWJvaWQiLCJtZXNoIjowfSx7InJvdGF0aW9uIjpbMC41LC0wLjQ5OTk5OTk5OTk5OTk5OTksMC41LDAuNTAwMDAwMDAwMDAwMDAwMV0sInRyYW5zbGF0aW9uIjpbMC43ODEyNSwwLjQ2ODc1LDBdLCJuYW1lIjoiYXBwbHkgdXNoaW5lIiwibWVzaCI6MX0seyJyb3RhdGlvbiI6WzAuNzA3MTA2NzgxMTg2NTQ3NSwwLDAsMC43MDcxMDY3ODExODY1NDc2XSwidHJhbnNsYXRpb24iOlswLjUsMCwtMC41XSwibmFtZSI6InRvcnVzIiwibWVzaCI6Mn0seyJyb3RhdGlvbiI6WzAuNzA3MTA2NzgxMTg2NTQ3NSwwLDAsMC43MDcxMDY3ODExODY1NDc2XSwidHJhbnNsYXRpb24iOlswLjM1OTM3NSwwLjQ2ODc1LC0wLjI1XSwibmFtZSI6ImN5bGluZGVyIiwibWVzaCI6M30seyJyb3RhdGlvbiI6WzAuNzA3MTA2NzgxMTg2NTQ3NSwwLDAsMC43MDcxMDY3ODExODY1NDc2XSwidHJhbnNsYXRpb24iOlswLjEyNSwwLjM0Mzc1LC0wLjI1XSwibmFtZSI6ImN5bGluZGVyIiwibWVzaCI6NH0seyJyb3RhdGlvbiI6WzAuNzA3MTA2NzgxMTg2NTQ3NSwwLDAsMC43MDcxMDY3ODExODY1NDc2XSwidHJhbnNsYXRpb24iOlswLjg1OTM3NSwwLjM0Mzc1LC0wLjI1XSwibmFtZSI6ImN5bGluZGVyIiwibWVzaCI6NX0seyJyb3RhdGlvbiI6WzAuNzA3MTA2NzgxMTg2NTQ3NSwwLDAsMC43MDcxMDY3ODExODY1NDc2XSwidHJhbnNsYXRpb24iOlswLjYyNSwwLjQ2ODc1LC0wLjI1XSwibmFtZSI6ImN5bGluZGVyIiwibWVzaCI6Nn0seyJyb3RhdGlvbiI6WzAuNzA3MTA2NzgxMTg2NTQ3NSwwLDAsMC43MDcxMDY3ODExODY1NDc2XSwidHJhbnNsYXRpb24iOlsxLDAuMTI1LC0wLjI1XSwibmFtZSI6ImN5bGluZGVyIiwibWVzaCI6N30seyJyb3RhdGlvbiI6WzAuNzA3MTA2NzgxMTg2NTQ3NSwwLDAsMC43MDcxMDY3ODExODY1NDc2XSwidHJhbnNsYXRpb24iOlswLjUsMCwwLjVdLCJuYW1lIjoidG9ydXMiLCJtZXNoIjo4fSx7InJvdGF0aW9uIjpbMC41LC0wLjQ5OTk5OTk5OTk5OTk5OTksMC41LDAuNTAwMDAwMDAwMDAwMDAwMV0sInRyYW5zbGF0aW9uIjpbMS4yODEyNSwwLjA5Mzc1LDBdLCJuYW1lIjoiYmV2ZWxlZF9jdWJvaWQiLCJtZXNoIjo5fSx7InRyYW5zbGF0aW9uIjpbMCwtMC4wNjI1LDBdLCJuYW1lIjoiYXBwbHkgdXNoaW5lIiwiY2hpbGRyZW4iOlsyLDMsNCw1LDYsNyw4LDldfSx7InJvdGF0aW9uIjpbNC4zMjk3ODAyODExNzc0NjZlLTE3LDAuNzA3MTA2NzgxMTg2NTQ3NSwtMC43MDcxMDY3ODExODY1NDc2LDQuMzI5NzgwMjgxMTc3NDY3ZS0xN10sInRyYW5zbGF0aW9uIjpbMC41LC0wLjA2MjUsMF0sIm5hbWUiOiJjeWxpbmRlciIsIm1lc2giOjEwfSx7Im5hbWUiOiJjeWxpbmRlciIsImNoaWxkcmVuIjpbMTFdfSx7InRyYW5zbGF0aW9uIjpbLTAuNSwwLjUsMF0sIm5hbWUiOiJncm91cCIsImNoaWxkcmVuIjpbMTAsMTJdfSx7InRyYW5zbGF0aW9uIjpbMCwwLjU2NjI1LDBdLCJuYW1lIjoicGxhbmUiLCJtZXNoIjoxMX0seyJ0cmFuc2xhdGlvbiI6Wy0wLjQ5MDYyNSwwLjA3ODEyNSwwLjVdLCJuYW1lIjoiYXBwbHkgdXNoaW5lIiwibWVzaCI6MTJ9LHsidHJhbnNsYXRpb24iOlswLjQ5Mzc1LDAuMDc4MTI1LDAuNV0sIm5hbWUiOiJhcHBseSB1c2hpbmUiLCJtZXNoIjoxM30seyJ0cmFuc2xhdGlvbiI6WzAuNDkzNzUsMC4wNzgxMjUsLTAuNV0sIm5hbWUiOiJhcHBseSB1c2hpbmUiLCJtZXNoIjoxNH0seyJ0cmFuc2xhdGlvbiI6Wy0wLjQ5MDYyNSwwLjA3ODEyNSwtMC41XSwibmFtZSI6ImFwcGx5IHVzaGluZSIsIm1lc2giOjE1fV0sImJ1ZmZlclZpZXdzIjpbeyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjAsImJ5dGVMZW5ndGgiOjExNTIsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjEyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MTE1MiwiYnl0ZUxlbmd0aCI6MTE1MiwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjoyMzA0LCJieXRlTGVuZ3RoIjo3NjgsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjh9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjozMDcyLCJieXRlTGVuZ3RoIjoyNjQsInRhcmdldCI6MzQ5NjN9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjozMzM2LCJieXRlTGVuZ3RoIjoxMTUyLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjoxMn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjQ0ODgsImJ5dGVMZW5ndGgiOjExNTIsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjEyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NTY0MCwiYnl0ZUxlbmd0aCI6NzY4LCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjo4fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NjQwOCwiYnl0ZUxlbmd0aCI6MjY0LCJ0YXJnZXQiOjM0OTYzfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NjY3MiwiYnl0ZUxlbmd0aCI6NDYwOCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjoxMTI4MCwiYnl0ZUxlbmd0aCI6NDYwOCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjoxNTg4OCwiYnl0ZUxlbmd0aCI6MzA3MiwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6OH0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjE4OTYwLCJieXRlTGVuZ3RoIjoxMTUyLCJ0YXJnZXQiOjM0OTYzfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MjAxMTIsImJ5dGVMZW5ndGgiOjE0NDAsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjEyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MjE1NTIsImJ5dGVMZW5ndGgiOjE0NDAsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjEyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MjI5OTIsImJ5dGVMZW5ndGgiOjk2MCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6OH0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjIzOTUyLCJieXRlTGVuZ3RoIjoyODgsInRhcmdldCI6MzQ5NjN9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjoyNDI0MCwiYnl0ZUxlbmd0aCI6MTQ0MCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjoyNTY4MCwiYnl0ZUxlbmd0aCI6MTQ0MCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjoyNzEyMCwiYnl0ZUxlbmd0aCI6OTYwLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjo4fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MjgwODAsImJ5dGVMZW5ndGgiOjI4OCwidGFyZ2V0IjozNDk2M30seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjI4MzY4LCJieXRlTGVuZ3RoIjoxNDQwLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjoxMn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjI5ODA4LCJieXRlTGVuZ3RoIjoxNDQwLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjoxMn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjMxMjQ4LCJieXRlTGVuZ3RoIjo5NjAsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjh9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjozMjIwOCwiYnl0ZUxlbmd0aCI6Mjg4LCJ0YXJnZXQiOjM0OTYzfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MzI0OTYsImJ5dGVMZW5ndGgiOjE0NDAsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjEyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MzM5MzYsImJ5dGVMZW5ndGgiOjE0NDAsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjEyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MzUzNzYsImJ5dGVMZW5ndGgiOjk2MCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6OH0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjM2MzM2LCJieXRlTGVuZ3RoIjoyODgsInRhcmdldCI6MzQ5NjN9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjozNjYyNCwiYnl0ZUxlbmd0aCI6MTQ0MCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjozODA2NCwiYnl0ZUxlbmd0aCI6MTQ0MCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0IjozOTUwNCwiYnl0ZUxlbmd0aCI6OTYwLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjo4fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NDA0NjQsImJ5dGVMZW5ndGgiOjI4OCwidGFyZ2V0IjozNDk2M30seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjQwNzUyLCJieXRlTGVuZ3RoIjo0NjA4LCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjoxMn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjQ1MzYwLCJieXRlTGVuZ3RoIjo0NjA4LCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjoxMn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjQ5OTY4LCJieXRlTGVuZ3RoIjozMDcyLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjo4fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NTMwNDAsImJ5dGVMZW5ndGgiOjExNTIsInRhcmdldCI6MzQ5NjN9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo1NDE5MiwiYnl0ZUxlbmd0aCI6MTE1MiwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo1NTM0NCwiYnl0ZUxlbmd0aCI6MTE1MiwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo1NjQ5NiwiYnl0ZUxlbmd0aCI6NzY4LCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjo4fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NTcyNjQsImJ5dGVMZW5ndGgiOjI2NCwidGFyZ2V0IjozNDk2M30seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjU3NTI4LCJieXRlTGVuZ3RoIjoxNDQwLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjoxMn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjU4OTY4LCJieXRlTGVuZ3RoIjoxNDQwLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjoxMn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjYwNDA4LCJieXRlTGVuZ3RoIjo5NjAsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjh9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo2MTM2OCwiYnl0ZUxlbmd0aCI6Mjg4LCJ0YXJnZXQiOjM0OTYzfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NjE2NTYsImJ5dGVMZW5ndGgiOjQ4LCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjoxMn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjYxNzA0LCJieXRlTGVuZ3RoIjo0OCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo2MTc1MiwiYnl0ZUxlbmd0aCI6MzIsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjh9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo2MTc4NCwiYnl0ZUxlbmd0aCI6MTIsInRhcmdldCI6MzQ5NjN9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo2MTc5NiwiYnl0ZUxlbmd0aCI6MTQ0MCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo2MzIzNiwiYnl0ZUxlbmd0aCI6MTQ0MCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo2NDY3NiwiYnl0ZUxlbmd0aCI6OTYwLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjo4fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NjU2MzYsImJ5dGVMZW5ndGgiOjI4OCwidGFyZ2V0IjozNDk2M30seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjY1OTI0LCJieXRlTGVuZ3RoIjoxNDQwLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjoxMn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjY3MzY0LCJieXRlTGVuZ3RoIjoxNDQwLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjoxMn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjY4ODA0LCJieXRlTGVuZ3RoIjo5NjAsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjh9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo2OTc2NCwiYnl0ZUxlbmd0aCI6Mjg4LCJ0YXJnZXQiOjM0OTYzfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NzAwNTIsImJ5dGVMZW5ndGgiOjE0NDAsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjEyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NzE0OTIsImJ5dGVMZW5ndGgiOjE0NDAsInRhcmdldCI6MzQ5NjIsImJ5dGVTdHJpZGUiOjEyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NzI5MzIsImJ5dGVMZW5ndGgiOjk2MCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6OH0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjczODkyLCJieXRlTGVuZ3RoIjoyODgsInRhcmdldCI6MzQ5NjN9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo3NDE4MCwiYnl0ZUxlbmd0aCI6MTQ0MCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo3NTYyMCwiYnl0ZUxlbmd0aCI6MTQ0MCwidGFyZ2V0IjozNDk2MiwiYnl0ZVN0cmlkZSI6MTJ9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo3NzA2MCwiYnl0ZUxlbmd0aCI6OTYwLCJ0YXJnZXQiOjM0OTYyLCJieXRlU3RyaWRlIjo4fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NzgwMjAsImJ5dGVMZW5ndGgiOjI4OCwidGFyZ2V0IjozNDk2M30seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjc4MzA4LCJieXRlTGVuZ3RoIjo0fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NzgzMTIsImJ5dGVMZW5ndGgiOjE2fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NzgzMjgsImJ5dGVMZW5ndGgiOjI4fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6NzgzNTYsImJ5dGVMZW5ndGgiOjExMn0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjc4NDY4LCJieXRlTGVuZ3RoIjo3MTExfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6ODU1ODAsImJ5dGVMZW5ndGgiOjE5NH0seyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjg1Nzc2LCJieXRlTGVuZ3RoIjozMDM4fSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6ODg4MTYsImJ5dGVMZW5ndGgiOjU2NTR9LHsiYnVmZmVyIjowLCJieXRlT2Zmc2V0Ijo5NDQ3MiwiYnl0ZUxlbmd0aCI6MTQyfV0sImJ1ZmZlcnMiOlt7ImJ5dGVMZW5ndGgiOjk0NjE2fV0sImFjY2Vzc29ycyI6W3siYnVmZmVyVmlldyI6MCwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjk2LCJtYXgiOlswLjUwMDM0MzczOTk4NjQxOTcsMC41LDAuNTAwMzQzNzM5OTg2NDE5N10sIm1pbiI6Wy0wLjUwMDM0MzczOTk4NjQxOTcsMCwtMC41MDAzNDM3Mzk5ODY0MTk3XSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjEsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50Ijo5NiwibWF4IjpbMSwxLDFdLCJtaW4iOlstMSwtMSwtMV0sInR5cGUiOiJWRUMzIn0seyJidWZmZXJWaWV3IjoyLCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6OTYsIm1heCI6WzAuMjM3NDk5OTk3MDE5NzY3NzYsMC4yMzc1MDAwMTE5MjA5Mjg5Nl0sIm1pbiI6WzAsMF0sInR5cGUiOiJWRUMyIn0seyJidWZmZXJWaWV3IjozLCJjb21wb25lbnRUeXBlIjo1MTIzLCJjb3VudCI6MTMyLCJtYXgiOls5NV0sIm1pbiI6WzBdLCJ0eXBlIjoiU0NBTEFSIn0seyJidWZmZXJWaWV3Ijo0LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6OTYsIm1heCI6WzAuMTI1LDAuMjgxMjUsMC4wMzEyNV0sIm1pbiI6Wy0wLjEyNSwwLjIxODc1LC0wLjAzMTI1XSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjUsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50Ijo5NiwibWF4IjpbMSwxLDFdLCJtaW4iOlstMSwtMSwtMV0sInR5cGUiOiJWRUMzIn0seyJidWZmZXJWaWV3Ijo2LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6OTYsIm1heCI6WzAuNjU2OTg3NDg4MjY5ODA1OSwwLjQzNDM3NDk4ODA3OTA3MTA0XSwibWluIjpbMC4wMjQ5NjAxODA3NDQ1Mjg3NywwXSwidHlwZSI6IlZFQzIifSx7ImJ1ZmZlclZpZXciOjcsImNvbXBvbmVudFR5cGUiOjUxMjMsImNvdW50IjoxMzIsIm1heCI6Wzk1XSwibWluIjpbMF0sInR5cGUiOiJTQ0FMQVIifSx7ImJ1ZmZlclZpZXciOjgsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjozODQsIm1heCI6WzAuNSwwLjAwOTcwNTcxMzk1MDA5NzU2MSwwLjQ5MDYyNDk5NDAzOTUzNTVdLCJtaW4iOlstMC41LC0wLjAwOTcwNTcxMzk1MDA5NzU2MSwtMC40OTA2MjQ5OTQwMzk1MzU1XSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjksImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjozODQsIm1heCI6WzAuOTMwNzg5OTQ3NTA5NzY1NiwwLjkxNjM3MDU3MDY1OTYzNzUsMC45MzMxMDg4NjYyMTQ3NTIyXSwibWluIjpbLTAuOTMwNzg5OTQ3NTA5NzY1NiwtMC45MTYzNzA1NzA2NTk2Mzc1LC0wLjkzMzEwODg2NjIxNDc1MjJdLCJ0eXBlIjoiVkVDMyJ9LHsiYnVmZmVyVmlldyI6MTAsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjozODQsIm1heCI6WzAuNDY1OTAwNjU5NTYxMTU3MiwwLjM4OTc4NjA2NDYyNDc4NjRdLCJtaW4iOlswLjAwMDkwNTUwMzU3NzA4NzA3NDUsNi43NjUxMjcxODIwMDY4MzZlLTA1XSwidHlwZSI6IlZFQzIifSx7ImJ1ZmZlclZpZXciOjExLCJjb21wb25lbnRUeXBlIjo1MTIzLCJjb3VudCI6NTc2LCJtYXgiOlszODNdLCJtaW4iOlswXSwidHlwZSI6IlNDQUxBUiJ9LHsiYnVmZmVyVmlldyI6MTIsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjoxMjAsIm1heCI6WzAuMDA5Mzc1MDAwMzcyNTI5MDMsMC43NSwwLjAwOTM3NTAwMDM3MjUyOTAzXSwibWluIjpbLTAuMDA5Mzc1MDAwMzcyNTI5MDMsLTAuMjUsLTAuMDA5Mzc1MDAwMzcyNTI5MDNdLCJ0eXBlIjoiVkVDMyJ9LHsiYnVmZmVyVmlldyI6MTMsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjoxMjAsIm1heCI6WzEsMSwxXSwibWluIjpbLTEsLTEsLTFdLCJ0eXBlIjoiVkVDMyJ9LHsiYnVmZmVyVmlldyI6MTQsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjoxMjAsIm1heCI6WzAuMjU0ODQ4NDUwNDIyMjg3LDAuNDYwOTM3NV0sIm1pbiI6WzAuMDE4MzU5Mzc0MjU0OTQxOTQsMC4wMDU0Njg3MjYxNTgxNDIwOV0sInR5cGUiOiJWRUMyIn0seyJidWZmZXJWaWV3IjoxNSwiY29tcG9uZW50VHlwZSI6NTEyMywiY291bnQiOjE0NCwibWF4IjpbMTE5XSwibWluIjpbMF0sInR5cGUiOiJTQ0FMQVIifSx7ImJ1ZmZlclZpZXciOjE2LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlswLjAwOTM3NTAwMDM3MjUyOTAzLDAuNzUsMC4wMDkzNzUwMDAzNzI1MjkwM10sIm1pbiI6Wy0wLjAwOTM3NTAwMDM3MjUyOTAzLC0wLjI1LC0wLjAwOTM3NTAwMDM3MjUyOTAzXSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjE3LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlsxLDEsMV0sIm1pbiI6Wy0xLC0xLC0xXSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjE4LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlswLjM0MDc4NTk1MDQyMjI4NywwLjVdLCJtaW4iOlswLjA0OTYwOTM3NDI1NDk0MTk0LDAuMDg1OTM3NV0sInR5cGUiOiJWRUMyIn0seyJidWZmZXJWaWV3IjoxOSwiY29tcG9uZW50VHlwZSI6NTEyMywiY291bnQiOjE0NCwibWF4IjpbMTE5XSwibWluIjpbMF0sInR5cGUiOiJTQ0FMQVIifSx7ImJ1ZmZlclZpZXciOjIwLCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlswLjAwOTM3NTAwMDM3MjUyOTAzLDAuNzUsMC4wMDkzNzUwMDAzNzI1MjkwM10sIm1pbiI6Wy0wLjAwOTM3NTAwMDM3MjUyOTAzLC0wLjI1LC0wLjAwOTM3NTAwMDM3MjUyOTAzXSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjIxLCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlsxLDEsMV0sIm1pbiI6Wy0xLC0xLC0xXSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjIyLCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlswLjM4NzY2MDk1MDQyMjI4NywwLjUyMzQzNzVdLCJtaW4iOlswLjAyNjE3MTg3NDI1NDk0MTk0LDAuMDkzNzVdLCJ0eXBlIjoiVkVDMiJ9LHsiYnVmZmVyVmlldyI6MjMsImNvbXBvbmVudFR5cGUiOjUxMjMsImNvdW50IjoxNDQsIm1heCI6WzExOV0sIm1pbiI6WzBdLCJ0eXBlIjoiU0NBTEFSIn0seyJidWZmZXJWaWV3IjoyNCwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjEyMCwibWF4IjpbMC4wMDkzNzUwMDAzNzI1MjkwMywwLjc1LDAuMDA5Mzc1MDAwMzcyNTI5MDNdLCJtaW4iOlstMC4wMDkzNzUwMDAzNzI1MjkwMywtMC4yNSwtMC4wMDkzNzUwMDAzNzI1MjkwM10sInR5cGUiOiJWRUMzIn0seyJidWZmZXJWaWV3IjoyNSwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjEyMCwibWF4IjpbMSwxLDFdLCJtaW4iOlstMSwtMSwtMV0sInR5cGUiOiJWRUMzIn0seyJidWZmZXJWaWV3IjoyNiwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjEyMCwibWF4IjpbMC4xNzY3MjM0MzU1MjExMjU4LDAuNTIzNDM3NV0sIm1pbiI6WzAuMDAyNzM0Mzc0OTUzNDMzODcxMywwLjA2Nzk2ODcyNjE1ODE0MjA5XSwidHlwZSI6IlZFQzIifSx7ImJ1ZmZlclZpZXciOjI3LCJjb21wb25lbnRUeXBlIjo1MTIzLCJjb3VudCI6MTQ0LCJtYXgiOlsxMTldLCJtaW4iOlswXSwidHlwZSI6IlNDQUxBUiJ9LHsiYnVmZmVyVmlldyI6MjgsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjoxMjAsIm1heCI6WzAuMDA5Mzc1MDAwMzcyNTI5MDMsMC43NSwwLjAwOTM3NTAwMDM3MjUyOTAzXSwibWluIjpbLTAuMDA5Mzc1MDAwMzcyNTI5MDMsLTAuMjUsLTAuMDA5Mzc1MDAwMzcyNTI5MDNdLCJ0eXBlIjoiVkVDMyJ9LHsiYnVmZmVyVmlldyI6MjksImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjoxMjAsIm1heCI6WzEsMSwxXSwibWluIjpbLTEsLTEsLTFdLCJ0eXBlIjoiVkVDMyJ9LHsiYnVmZmVyVmlldyI6MzAsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjoxMjAsIm1heCI6WzAuNDAzMjg1OTUwNDIyMjg3LDAuNTMxMjVdLCJtaW4iOlswLjExOTkyMTg3Nzk4MDIzMjI0LDAuMDA1NDY4NzI2MTU4MTQyMDldLCJ0eXBlIjoiVkVDMiJ9LHsiYnVmZmVyVmlldyI6MzEsImNvbXBvbmVudFR5cGUiOjUxMjMsImNvdW50IjoxNDQsIm1heCI6WzExOV0sIm1pbiI6WzBdLCJ0eXBlIjoiU0NBTEFSIn0seyJidWZmZXJWaWV3IjozMiwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjM4NCwibWF4IjpbMC41LDAuMDA5NzA1NzEzOTUwMDk3NTYxLDAuNDkwNjI0OTk0MDM5NTM1NV0sIm1pbiI6Wy0wLjUsLTAuMDA5NzA1NzEzOTUwMDk3NTYxLC0wLjQ5MDYyNDk5NDAzOTUzNTVdLCJ0eXBlIjoiVkVDMyJ9LHsiYnVmZmVyVmlldyI6MzMsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjozODQsIm1heCI6WzAuOTMwNzg5OTQ3NTA5NzY1NiwwLjkxNjM3MDU3MDY1OTYzNzUsMC45MzMxMDg4NjYyMTQ3NTIyXSwibWluIjpbLTAuOTMwNzg5OTQ3NTA5NzY1NiwtMC45MTYzNzA1NzA2NTk2Mzc1LC0wLjkzMzEwODg2NjIxNDc1MjJdLCJ0eXBlIjoiVkVDMyJ9LHsiYnVmZmVyVmlldyI6MzQsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjozODQsIm1heCI6WzAuNDg5MzM4MTI5NzU4ODM0ODQsMC40MDU0MTEwNjQ2MjQ3ODY0XSwibWluIjpbMC4wMDA5MDU1MDM1NzcwODcwNzQ1LDBdLCJ0eXBlIjoiVkVDMiJ9LHsiYnVmZmVyVmlldyI6MzUsImNvbXBvbmVudFR5cGUiOjUxMjMsImNvdW50Ijo1NzYsIm1heCI6WzM4M10sIm1pbiI6WzBdLCJ0eXBlIjoiU0NBTEFSIn0seyJidWZmZXJWaWV3IjozNiwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjk2LCJtYXgiOlswLjEyNSwwLjI4MTI1LDAuMDMxMjVdLCJtaW4iOlstMC4xMjUsMC4yMTg3NSwtMC4wMzEyNV0sInR5cGUiOiJWRUMzIn0seyJidWZmZXJWaWV3IjozNywiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjk2LCJtYXgiOlsxLDEsMV0sIm1pbiI6Wy0xLC0xLC0xXSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjM4LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6OTYsIm1heCI6WzAuMjY5NjIzNDI4NTgzMTQ1MTQsMC4xODc1XSwibWluIjpbMCwwXSwidHlwZSI6IlZFQzIifSx7ImJ1ZmZlclZpZXciOjM5LCJjb21wb25lbnRUeXBlIjo1MTIzLCJjb3VudCI6MTMyLCJtYXgiOls5NV0sIm1pbiI6WzBdLCJ0eXBlIjoiU0NBTEFSIn0seyJidWZmZXJWaWV3Ijo0MCwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjEyMCwibWF4IjpbMC40ODc1MDAwMTE5MjA5Mjg5NiwwLjUsMC40NzQ5OTk5OTQwMzk1MzU1XSwibWluIjpbLTAuNDg3NTAwMDExOTIwOTI4OTYsLTAuNSwtMC40NzQ5OTk5OTQwMzk1MzU1XSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjQxLCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlsxLDEsMV0sIm1pbiI6Wy0xLC0xLC0xXSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjQyLCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlswLjgyMTgzNDM4NTM5NTA1LDAuNjg3NV0sIm1pbiI6WzAsMF0sInR5cGUiOiJWRUMyIn0seyJidWZmZXJWaWV3Ijo0MywiY29tcG9uZW50VHlwZSI6NTEyMywiY291bnQiOjE0NCwibWF4IjpbMTE5XSwibWluIjpbMF0sInR5cGUiOiJTQ0FMQVIifSx7ImJ1ZmZlclZpZXciOjQ0LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6NCwibWF4IjpbMC40Mzc1LC0wLjAwMzEyNTAwMDA0NjU2NjEyODcsMC40Mzc1XSwibWluIjpbLTAuNDM3NSwtMC4wMDMxMjUwMDAwNDY1NjYxMjg3LC0wLjQzNzVdLCJ0eXBlIjoiVkVDMyJ9LHsiYnVmZmVyVmlldyI6NDUsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50Ijo0LCJtYXgiOlswLDEsMF0sIm1pbiI6WzAsMSwwXSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjQ2LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6NCwibWF4IjpbMC44NzUsMC44NzVdLCJtaW4iOlswLDBdLCJ0eXBlIjoiVkVDMiJ9LHsiYnVmZmVyVmlldyI6NDcsImNvbXBvbmVudFR5cGUiOjUxMjMsImNvdW50Ijo2LCJtYXgiOlszXSwibWluIjpbMF0sInR5cGUiOiJTQ0FMQVIifSx7ImJ1ZmZlclZpZXciOjQ4LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlswLjAwOTM3NTAwMDM3MjUyOTAzLDAuNDg3NTAwMDExOTIwOTI4OTYsMC4wMDkzNzUwMDAzNzI1MjkwM10sIm1pbiI6Wy0wLjAwOTM3NTAwMDM3MjUyOTAzLDAuMDEyNTAwMDAwMTg2MjY0NTE1LC0wLjAwOTM3NTAwMDM3MjUyOTAzXSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjQ5LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlsxLDEsMV0sIm1pbiI6Wy0xLC0xLC0xXSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjUwLCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlswLjEzNzg5MDYyMjAxOTc2Nzc2LDAuNTM5MDYyNV0sIm1pbiI6WzAuMDAyOTY0MDYyNjE2MjI5MDU3MywwXSwidHlwZSI6IlZFQzIifSx7ImJ1ZmZlclZpZXciOjUxLCJjb21wb25lbnRUeXBlIjo1MTIzLCJjb3VudCI6MTQ0LCJtYXgiOlsxMTldLCJtaW4iOlswXSwidHlwZSI6IlNDQUxBUiJ9LHsiYnVmZmVyVmlldyI6NTIsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjoxMjAsIm1heCI6WzAuMDA5Mzc1MDAwMzcyNTI5MDMsMC40ODc1MDAwMTE5MjA5Mjg5NiwwLjAwOTM3NTAwMDM3MjUyOTAzXSwibWluIjpbLTAuMDA5Mzc1MDAwMzcyNTI5MDMsMC4wMTI1MDAwMDAxODYyNjQ1MTUsLTAuMDA5Mzc1MDAwMzcyNTI5MDNdLCJ0eXBlIjoiVkVDMyJ9LHsiYnVmZmVyVmlldyI6NTMsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjoxMjAsIm1heCI6WzEsMSwxXSwibWluIjpbLTEsLTEsLTFdLCJ0eXBlIjoiVkVDMyJ9LHsiYnVmZmVyVmlldyI6NTQsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjoxMjAsIm1heCI6WzAuMTM3ODkwNjIyMDE5NzY3NzYsMC41MzkwNjI1XSwibWluIjpbMC4wMDI5NjQwNjI2MTYyMjkwNTczLDBdLCJ0eXBlIjoiVkVDMiJ9LHsiYnVmZmVyVmlldyI6NTUsImNvbXBvbmVudFR5cGUiOjUxMjMsImNvdW50IjoxNDQsIm1heCI6WzExOV0sIm1pbiI6WzBdLCJ0eXBlIjoiU0NBTEFSIn0seyJidWZmZXJWaWV3Ijo1NiwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjEyMCwibWF4IjpbMC4wMDkzNzUwMDAzNzI1MjkwMywwLjQ4NzUwMDAxMTkyMDkyODk2LDAuMDA5Mzc1MDAwMzcyNTI5MDNdLCJtaW4iOlstMC4wMDkzNzUwMDAzNzI1MjkwMywwLjAxMjUwMDAwMDE4NjI2NDUxNSwtMC4wMDkzNzUwMDAzNzI1MjkwM10sInR5cGUiOiJWRUMzIn0seyJidWZmZXJWaWV3Ijo1NywiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjEyMCwibWF4IjpbMSwxLDFdLCJtaW4iOlstMSwtMSwtMV0sInR5cGUiOiJWRUMzIn0seyJidWZmZXJWaWV3Ijo1OCwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjEyMCwibWF4IjpbMC4xMzc4OTA2MjIwMTk3Njc3NiwwLjUzOTA2MjVdLCJtaW4iOlswLjAwMjk2NDA2MjYxNjIyOTA1NzMsMF0sInR5cGUiOiJWRUMyIn0seyJidWZmZXJWaWV3Ijo1OSwiY29tcG9uZW50VHlwZSI6NTEyMywiY291bnQiOjE0NCwibWF4IjpbMTE5XSwibWluIjpbMF0sInR5cGUiOiJTQ0FMQVIifSx7ImJ1ZmZlclZpZXciOjYwLCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlswLjAwOTM3NTAwMDM3MjUyOTAzLDAuNDg3NTAwMDExOTIwOTI4OTYsMC4wMDkzNzUwMDAzNzI1MjkwM10sIm1pbiI6Wy0wLjAwOTM3NTAwMDM3MjUyOTAzLDAuMDEyNTAwMDAwMTg2MjY0NTE1LC0wLjAwOTM3NTAwMDM3MjUyOTAzXSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjYxLCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlsxLDEsMV0sIm1pbiI6Wy0xLC0xLC0xXSwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjYyLCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MTIwLCJtYXgiOlswLjEzNzg5MDYyMjAxOTc2Nzc2LDAuNTM5MDYyNV0sIm1pbiI6WzAuMDAyOTY0MDYyNjE2MjI5MDU3MywwXSwidHlwZSI6IlZFQzIifSx7ImJ1ZmZlclZpZXciOjYzLCJjb21wb25lbnRUeXBlIjo1MTIzLCJjb3VudCI6MTQ0LCJtYXgiOlsxMTldLCJtaW4iOlswXSwidHlwZSI6IlNDQUxBUiJ9LHsiYnVmZmVyVmlldyI6NjQsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjoxLCJtYXgiOlswXSwibWluIjpbMF0sInR5cGUiOiJTQ0FMQVIifSx7ImJ1ZmZlclZpZXciOjY1LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MSwibWF4IjpbMCwwLDAsMV0sIm1pbiI6WzAsMCwwLDFdLCJ0eXBlIjoiVkVDNCJ9LHsiYnVmZmVyVmlldyI6NjYsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50Ijo3LCJtYXgiOls0Ljc1XSwibWluIjpbMF0sInR5cGUiOiJTQ0FMQVIifSx7ImJ1ZmZlclZpZXciOjY3LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6NywibWF4IjpbMCwwLDAuMjI2MjI2MzE0OTAyMzA1NiwxXSwibWluIjpbMCwwLDAsMC45NzQwNzQ3ODA5NDEwMDk1XSwidHlwZSI6IlZFQzQifV0sIm1hdGVyaWFscyI6W3sicGJyTWV0YWxsaWNSb3VnaG5lc3MiOnsibWV0YWxsaWNGYWN0b3IiOjAsInJvdWdobmVzc0ZhY3RvciI6MSwiYmFzZUNvbG9yVGV4dHVyZSI6eyJpbmRleCI6MH19LCJhbHBoYU1vZGUiOiJNQVNLIiwiYWxwaGFDdXRvZmYiOjAuMDUsImRvdWJsZVNpZGVkIjp0cnVlfSx7InBick1ldGFsbGljUm91Z2huZXNzIjp7Im1ldGFsbGljRmFjdG9yIjowLCJyb3VnaG5lc3NGYWN0b3IiOjEsImJhc2VDb2xvclRleHR1cmUiOnsiaW5kZXgiOjF9fSwiYWxwaGFNb2RlIjoiTUFTSyIsImFscGhhQ3V0b2ZmIjowLjA1LCJkb3VibGVTaWRlZCI6dHJ1ZX0seyJwYnJNZXRhbGxpY1JvdWdobmVzcyI6eyJtZXRhbGxpY0ZhY3RvciI6MCwicm91Z2huZXNzRmFjdG9yIjoxLCJiYXNlQ29sb3JUZXh0dXJlIjp7ImluZGV4IjoyfX0sImFscGhhTW9kZSI6Ik1BU0siLCJhbHBoYUN1dG9mZiI6MC4wNSwiZG91YmxlU2lkZWQiOnRydWV9LHsicGJyTWV0YWxsaWNSb3VnaG5lc3MiOnsibWV0YWxsaWNGYWN0b3IiOjAsInJvdWdobmVzc0ZhY3RvciI6MSwiYmFzZUNvbG9yVGV4dHVyZSI6eyJpbmRleCI6M319LCJhbHBoYU1vZGUiOiJNQVNLIiwiYWxwaGFDdXRvZmYiOjAuMDUsImRvdWJsZVNpZGVkIjp0cnVlfSx7InBick1ldGFsbGljUm91Z2huZXNzIjp7Im1ldGFsbGljRmFjdG9yIjowLCJyb3VnaG5lc3NGYWN0b3IiOjEsImJhc2VDb2xvclRleHR1cmUiOnsiaW5kZXgiOjR9fSwiYWxwaGFNb2RlIjoiTUFTSyIsImFscGhhQ3V0b2ZmIjowLjA1LCJkb3VibGVTaWRlZCI6dHJ1ZX1dLCJ0ZXh0dXJlcyI6W3sic2FtcGxlciI6MCwic291cmNlIjowLCJuYW1lIjoidGV4dHVyZSAoOCkucG5nIn0seyJzYW1wbGVyIjoxLCJzb3VyY2UiOjEsIm5hbWUiOiJ0ZXh0dXJlIn0seyJzYW1wbGVyIjoyLCJzb3VyY2UiOjIsIm5hbWUiOiJ0ZXh0dXJlIn0seyJzYW1wbGVyIjozLCJzb3VyY2UiOjMsIm5hbWUiOiJ0ZXh0dXJlIn0seyJzYW1wbGVyIjo0LCJzb3VyY2UiOjQsIm5hbWUiOiJ0ZXh0dXJlIn1dLCJzYW1wbGVycyI6W3sibWFnRmlsdGVyIjo5NzI4LCJtaW5GaWx0ZXIiOjk3MjgsIndyYXBTIjozMzA3MSwid3JhcFQiOjMzMDcxfSx7Im1hZ0ZpbHRlciI6OTcyOCwibWluRmlsdGVyIjo5NzI4LCJ3cmFwUyI6MzMwNzEsIndyYXBUIjozMzA3MX0seyJtYWdGaWx0ZXIiOjk3MjgsIm1pbkZpbHRlciI6OTcyOCwid3JhcFMiOjMzMDcxLCJ3cmFwVCI6MzMwNzF9LHsibWFnRmlsdGVyIjo5NzI4LCJtaW5GaWx0ZXIiOjk3MjgsIndyYXBTIjozMzA3MSwid3JhcFQiOjMzMDcxfSx7Im1hZ0ZpbHRlciI6OTcyOCwibWluRmlsdGVyIjo5NzI4LCJ3cmFwUyI6MzMwNzEsIndyYXBUIjozMzA3MX1dLCJpbWFnZXMiOlt7Im1pbWVUeXBlIjoiaW1hZ2UvcG5nIiwiYnVmZmVyVmlldyI6Njh9LHsibWltZVR5cGUiOiJpbWFnZS9wbmciLCJidWZmZXJWaWV3Ijo2OX0seyJtaW1lVHlwZSI6ImltYWdlL3BuZyIsImJ1ZmZlclZpZXciOjcwfSx7Im1pbWVUeXBlIjoiaW1hZ2UvcG5nIiwiYnVmZmVyVmlldyI6NzF9LHsibWltZVR5cGUiOiJpbWFnZS9wbmciLCJidWZmZXJWaWV3Ijo3Mn1dLCJtZXNoZXMiOlt7InByaW1pdGl2ZXMiOlt7Im1vZGUiOjQsImF0dHJpYnV0ZXMiOnsiUE9TSVRJT04iOjAsIk5PUk1BTCI6MSwiVEVYQ09PUkRfMCI6Mn0sImluZGljZXMiOjMsIm1hdGVyaWFsIjowfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6NCwiTk9STUFMIjo1LCJURVhDT09SRF8wIjo2fSwiaW5kaWNlcyI6NywibWF0ZXJpYWwiOjF9XX0seyJwcmltaXRpdmVzIjpbeyJtb2RlIjo0LCJhdHRyaWJ1dGVzIjp7IlBPU0lUSU9OIjo4LCJOT1JNQUwiOjksIlRFWENPT1JEXzAiOjEwfSwiaW5kaWNlcyI6MTEsIm1hdGVyaWFsIjoyfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6MTIsIk5PUk1BTCI6MTMsIlRFWENPT1JEXzAiOjE0fSwiaW5kaWNlcyI6MTUsIm1hdGVyaWFsIjoyfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6MTYsIk5PUk1BTCI6MTcsIlRFWENPT1JEXzAiOjE4fSwiaW5kaWNlcyI6MTksIm1hdGVyaWFsIjoyfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6MjAsIk5PUk1BTCI6MjEsIlRFWENPT1JEXzAiOjIyfSwiaW5kaWNlcyI6MjMsIm1hdGVyaWFsIjoyfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6MjQsIk5PUk1BTCI6MjUsIlRFWENPT1JEXzAiOjI2fSwiaW5kaWNlcyI6MjcsIm1hdGVyaWFsIjoyfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6MjgsIk5PUk1BTCI6MjksIlRFWENPT1JEXzAiOjMwfSwiaW5kaWNlcyI6MzEsIm1hdGVyaWFsIjoyfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6MzIsIk5PUk1BTCI6MzMsIlRFWENPT1JEXzAiOjM0fSwiaW5kaWNlcyI6MzUsIm1hdGVyaWFsIjoyfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6MzYsIk5PUk1BTCI6MzcsIlRFWENPT1JEXzAiOjM4fSwiaW5kaWNlcyI6MzksIm1hdGVyaWFsIjoyfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6NDAsIk5PUk1BTCI6NDEsIlRFWENPT1JEXzAiOjQyfSwiaW5kaWNlcyI6NDMsIm1hdGVyaWFsIjozfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6NDQsIk5PUk1BTCI6NDUsIlRFWENPT1JEXzAiOjQ2fSwiaW5kaWNlcyI6NDcsIm1hdGVyaWFsIjo0fV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6NDgsIk5PUk1BTCI6NDksIlRFWENPT1JEXzAiOjUwfSwiaW5kaWNlcyI6NTEsIm1hdGVyaWFsIjoyfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6NTIsIk5PUk1BTCI6NTMsIlRFWENPT1JEXzAiOjU0fSwiaW5kaWNlcyI6NTUsIm1hdGVyaWFsIjoyfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6NTYsIk5PUk1BTCI6NTcsIlRFWENPT1JEXzAiOjU4fSwiaW5kaWNlcyI6NTksIm1hdGVyaWFsIjoyfV19LHsicHJpbWl0aXZlcyI6W3sibW9kZSI6NCwiYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6NjAsIk5PUk1BTCI6NjEsIlRFWENPT1JEXzAiOjYyfSwiaW5kaWNlcyI6NjMsIm1hdGVyaWFsIjoyfV19XSwiYW5pbWF0aW9ucyI6W3sibmFtZSI6ImFuaW1hdGlvbiIsInNhbXBsZXJzIjpbeyJpbnB1dCI6NjQsIm91dHB1dCI6NjUsImludGVycG9sYXRpb24iOiJMSU5FQVIifSx7ImlucHV0Ijo2Niwib3V0cHV0Ijo2NywiaW50ZXJwb2xhdGlvbiI6IkxJTkVBUiJ9XSwiY2hhbm5lbHMiOlt7InNhbXBsZXIiOjAsInRhcmdldCI6eyJub2RlIjoxMiwicGF0aCI6InJvdGF0aW9uIn19LHsic2FtcGxlciI6MSwidGFyZ2V0Ijp7Im5vZGUiOjEzLCJwYXRoIjoicm90YXRpb24ifX1dfV19mHEBAEJJTgCHFgA/MzPzPgFe876HFgA/MzPzPgFe8z6HFgA/zczMPAFe8z6HFgA/zczMPAFe876HFgC/zczMPAFe8z6HFgC/MzPzPgFe8z6HFgC/MzPzPgFe876HFgC/zczMPAFe874BXvM+AAAAPwFe8z4BXvM+AAAAPwFe874BXvO+AAAAPwFe874BXvO+AAAAPwFe8z4BXvO+AAAAAAFe874BXvM+AAAAAAFe874BXvM+AAAAAAFe8z4BXvO+AAAAAAFe8z4BXvM+zczMPIcWAD8BXvM+MzPzPocWAD8BXvO+MzPzPocWAD8BXvO+zczMPIcWAD8BXvO+MzPzPocWAL8BXvM+MzPzPocWAL8BXvM+zczMPIcWAL8BXvO+zczMPIcWAL8BXvM+AAAAPwFe874BXvM+AAAAPwFe8z6HFgA/MzPzPgFe8z6HFgA/MzPzPgFe876HFgC/MzPzPgFe8z4BXvO+AAAAPwFe8z4BXvO+AAAAPwFe876HFgC/MzPzPgFe874BXvM+MzPzPocWAD8BXvM+AAAAPwFe8z4BXvO+AAAAPwFe8z4BXvO+MzPzPocWAD8BXvO+AAAAPwFe874BXvM+AAAAPwFe874BXvM+MzPzPocWAL8BXvO+MzPzPocWAL+HFgA/zczMPAFe8z4BXvM+AAAAAAFe8z4BXvM+AAAAAAFe876HFgA/zczMPAFe874BXvO+AAAAAAFe874BXvO+AAAAAAFe8z6HFgC/zczMPAFe8z6HFgC/zczMPAFe874BXvO+AAAAAAFe8z4BXvM+AAAAAAFe8z4BXvM+zczMPIcWAD8BXvO+zczMPIcWAD8BXvM+zczMPIcWAL8BXvM+AAAAAAFe874BXvO+AAAAAAFe874BXvO+zczMPIcWAL+HFgA/zczMPAFe874BXvM+zczMPIcWAL8BXvM+MzPzPocWAL+HFgA/MzPzPgFe874BXvM+MzPzPocWAD8BXvM+zczMPIcWAD+HFgA/zczMPAFe8z6HFgA/MzPzPgFe8z4BXvO+MzPzPocWAL8BXvO+zczMPIcWAL+HFgC/zczMPAFe876HFgC/MzPzPgFe876HFgC/zczMPAFe8z4BXvO+zczMPIcWAD8BXvO+MzPzPocWAD+HFgC/MzPzPgFe8z4BXvM+AAAAAAFe8z6HFgA/zczMPAFe8z4BXvM+zczMPIcWAD8BXvO+AAAAAAFe8z4BXvO+zczMPIcWAD+HFgC/zczMPAFe8z4BXvM+AAAAAAFe874BXvM+zczMPIcWAL+HFgA/zczMPAFe874BXvO+AAAAAAFe876HFgC/zczMPAFe874BXvO+zczMPIcWAL8BXvM+AAAAPwFe8z4BXvM+MzPzPocWAD+HFgA/MzPzPgFe8z4BXvO+AAAAPwFe8z6HFgC/MzPzPgFe8z4BXvO+MzPzPocWAD8BXvM+AAAAPwFe876HFgA/MzPzPgFe874BXvM+MzPzPocWAL8BXvO+AAAAPwFe874BXvO+MzPzPocWAL+HFgC/MzPzPgFe874AAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8G9TQ/3xQ1PwAAAAAG9TQ/3xQ1PwAAAAAG9TQ/3xQ1PwAAAAAG9TQ/3xQ1PwAAAAAG9TS/3xQ1PwAAAAAG9TS/3xQ1PwAAAAAG9TS/3xQ1PwAAAAAG9TS/3xQ1PwAAAAAAAAAA3xQ1Pwb1ND8AAAAA3xQ1Pwb1ND8AAAAA3xQ1Pwb1ND8AAAAA3xQ1Pwb1ND8AAAAA3xQ1Pwb1NL8AAAAA3xQ1Pwb1NL8AAAAA3xQ1Pwb1NL8AAAAA3xQ1Pwb1NL8G9TQ/3xQ1vwAAAAAG9TQ/3xQ1vwAAAAAG9TQ/3xQ1vwAAAAAG9TQ/3xQ1vwAAAAAG9TS/3xQ1vwAAAAAG9TS/3xQ1vwAAAAAG9TS/3xQ1vwAAAAAG9TS/3xQ1vwAAAAAAAAAA3xQ1vwb1ND8AAAAA3xQ1vwb1ND8AAAAA3xQ1vwb1ND8AAAAA3xQ1vwb1ND8AAAAA3xQ1vwb1NL8AAAAA3xQ1vwb1NL8AAAAA3xQ1vwb1NL8AAAAA3xQ1vwb1NL/zBDU/AAAAAPMENb/zBDU/AAAAAPMENb/zBDU/AAAAAPMENb/zBDU/AAAAAPMENb/zBDU/AAAAAPMENT/zBDU/AAAAAPMENT/zBDU/AAAAAPMENT/zBDU/AAAAAPMENT/zBDW/AAAAAPMENb/zBDW/AAAAAPMENb/zBDW/AAAAAPMENb/zBDW/AAAAAPMENb/zBDW/AAAAAPMENT/zBDW/AAAAAPMENT/zBDW/AAAAAPMENT/zBDW/AAAAAPMENT+OxBM/kN4Tv47EEz+OxBM/kN4Tv47EEz+OxBM/kN4Tv47EEz+OxBO/kN4Tv47EEz+OxBO/kN4Tv47EEz+OxBO/kN4Tv47EEz+OxBM/kN4Tv47EE7+OxBM/kN4Tv47EE7+OxBM/kN4Tv47EE7+OxBO/kN4Tv47EE7+OxBO/kN4Tv47EE7+OxBO/kN4Tv47EE7+OxBM/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MzNjPgAAAL0zM/M9AABgPjMz87wzM/O9AABgPjMz87wzM/O9MzNjPgAAAL0AAAA+MzNjPjMz87wzM/M9MzNjPgAAAL0zM/M9ZmaOPgAAAL0AAAA+ZmaOPjMz87wzM/M9ZmaOPgAAAD0zM/M9MzNjPgAAAD0AAAA+MzNjPjMz8zwAAAA+ZmaOPjMz8zwzM/O9ZmaOPgAAAL0zM/O9MzNjPgAAAL0AAAC+MzNjPjMz87wAAAC+ZmaOPjMz87wAAAC+MzNjPjMz8zwzM/O9MzNjPgAAAD0zM/O9ZmaOPgAAAD0AAAC+ZmaOPjMz8zwzM/M9AABgPjMz8zwAAAA+MzNjPjMz8zwzM/M9MzNjPgAAAD0zM/O9AABgPjMz8zwzM/O9MzNjPgAAAD0AAAC+MzNjPjMz8zwzM/M9AABgPjMz87wzM/M9MzNjPgAAAL0AAAA+MzNjPjMz87wzM/O9AABgPjMz87wAAAC+MzNjPjMz87wzM/O9MzNjPgAAAL0zM/M9AACQPjMz8zwzM/M9ZmaOPgAAAD0AAAA+ZmaOPjMz8zwzM/O9AACQPjMz8zwAAAC+ZmaOPjMz8zwzM/O9ZmaOPgAAAD0zM/M9AACQPjMz87wAAAA+ZmaOPjMz87wzM/M9ZmaOPgAAAL0zM/O9AACQPjMz87wzM/O9ZmaOPgAAAL0AAAC+ZmaOPjMz87wAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8u+eQ+LvlkPwAAAAAu+eQ+LvlkPwAAAAAu+eQ+LvlkPwAAAAAu+eQ+LvlkPwAAAAAu+eS+LvlkPwAAAAAu+eS+LvlkPwAAAAAu+eS+LvlkPwAAAAAu+eS+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ZgBkAGYAZwBoAGkAagBoAGoAawBsAG0AbgBsAG4AbwBwAHEAcgBwAHIAcwB0AHUAdgB0AHYAdwB4AHkAegB4AHoAewB8AH0AfgB8AH4AfwCAAIEAggCAAIIAgwCEAIUAhgCEAIYAhwCIAIkAigCIAIoAiwCMAI0AjgCMAI4AjwCQAJEAkgCQAJIAkwCUAJUAlgCUAJYAlwCYAJkAmgCYAJoAmwCcAJ0AngCcAJ4AnwCgAKEAogCgAKIAowCkAKUApgCkAKYApwCoAKkAqgCoAKoAqwCsAK0ArgCsAK4ArwCwALEAsgCwALIAswC0ALUAtgC0ALYAtwC4ALkAugC4ALoAuwC8AL0AvgC8AL4AvwDAAMEAwgDAAMIAwwDEAMUAxgDEAMYAxwDIAMkAygDIAMoAywDMAM0AzgDMAM4AzwDQANEA0gDQANIA0wDUANUA1gDUANYA1wDYANkA2gDYANoA2wDcAN0A3gDcAN4A3wDgAOEA4gDgAOIA4wDkAOUA5gDkAOYA5wDoAOkA6gDoAOoA6wDsAO0A7gDsAO4A7wDwAPEA8gDwAPIA8wD0APUA9gD0APYA9wD4APkA+gD4APoA+wD8AP0A/gD8AP4A/wAAAQEBAgEAAQIBAwEEAQUBBgEEAQYBBwEIAQkBCgEIAQoBCwEMAQ0BDgEMAQ4BDwEQAREBEgEQARIBEwEUARUBFgEUARYBFwEYARkBGgEYARoBGwEcAR0BHgEcAR4BHwEgASEBIgEgASIBIwEkASUBJgEkASYBJwEoASkBKgEoASoBKwEsAS0BLgEsAS4BLwEwATEBMgEwATIBMwE0ATUBNgE0ATYBNwE4ATkBOgE4AToBOwE8AT0BPgE8AT4BPwFAAUEBQgFAAUIBQwFEAUUBRgFEAUYBRwFIAUkBSgFIAUoBSwFMAU0BTgFMAU4BTwFQAVEBUgFQAVIBUwFUAVUBVgFUAVYBVwFYAVkBWgFYAVoBWwFcAV0BXgFcAV4BXwFgAWEBYgFgAWIBYwFkAWUBZgFkAWYBZwFoAWkBagFoAWoBawFsAW0BbgFsAW4BbwFwAXEBcgFwAXIBcwF0AXUBdgF0AXYBdwF4AXkBegF4AXoBewF8AX0BfgF8AX4BfwHR4uA7AACAvtHi4DvEoCQ7AACAvpqZGTwzM/ujAACAvjMz+6PEoCQ7AACAvpqZGTzR4uA7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AAAAAAAAAL/Xs10/AAAAAAAAAL/Xs10/AAAAAAAAAL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADvCsclAAAAAAAAgL/vCsclAAAAAAAAgL/vCsclAAAAAAAAgL/vCsclAAAAAAAAgL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAC/AAAAANezXb8AAAC/AAAAANezXb8AAAC/AAAAANezXb8AAAC/AAAAANezXb8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADXs12/AAAAAAAAAL/Xs12/AAAAAAAAAL/Xs12/AAAAAAAAAL/Xs12/AAAAAAAAAL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAIC/AAAAAO8Kx6UAAIC/AAAAAO8Kx6UAAIC/AAAAAO8Kx6UAAIC/AAAAAO8Kx6UAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADXs12/AAAAAAAAAD/Xs12/AAAAAAAAAD/Xs12/AAAAAAAAAD/Xs12/AAAAAAAAAD8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAC/AAAAANezXT8AAAC/AAAAANezXT8AAAC/AAAAANezXT8AAAC/AAAAANezXT8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAA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AACAvpqZGTzEoCS7AACAvpqZGTwzM/ujAACAvjMz+6PEoCS7AACAvpqZGTzEoCQ7AACAvpqZGTzEoCQ7AABAP5qZGTzEoCS7AABAP5qZGTzEoCS7AABAP5qZGTzEoCQ7AABAP5qZGTwzM/ujAABAPzMz+6MAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAA/AAAAANezXT8AAAA/AAAAANezXT8AAAA/AAAAANezXT8AAAA/AAAAANezXT8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADXs10/AAAAAAAAAD/Xs10/AAAAAAAAAD/Xs10/AAAAAAAAAD/Xs10/AAAAAAAAAD8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADXs10/AAAAAAAAAL/Xs10/AAAAAAAAAL/Xs10/AAAAAAAAAL/Xs10/AAAAAAAAAL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADvCsclAAAAAAAAgL/vCsclAAAAAAAAgL/vCsclAAAAAAAAgL/vCsclAAAAAAAAgL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAC/AAAAANezXb8AAAC/AAAAANezXb8AAAC/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AACAvwAAAAAAAAAAAACAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADXs10/AAAAAAAAAL/Xs10/AAAAAAAAAL/Xs10/AAAAAAAAAL/Xs10/AAAAAAAAAL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADvCsclAAAAAAAAgL/vCsclAAAAAAAAgL/vCsclAAAAAAAAgL/vCsclAAAAAAAAgL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAC/AAAAANezXb8AAAC/AAAAANezXb8AAAC/AAAAANezXb8AAAC/AAAAANezXb8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADXs12/AAAAAAAAAL/Xs12/AAAAAAAAAL/Xs12/AAAAAAAAAL/Xs12/AAAAAAAAAL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAIC/AAAAAO8Kx6UAAIC/AAAAAO8Kx6UAAIC/AAAAAO8Kx6UAAIC/AAAAAO8Kx6UAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADXs12/AAAAAAAAAD/Xs12/AAAAAAAAAD/Xs12/AAAAAAAAAD/Xs12/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AACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADXs10/AAAAAAAAAD/Xs10/AAAAAAAAAD/Xs10/AAAAAAAAAD/Xs10/AAAAAAAAAD8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADXs10/AAAAAAAAAL/Xs10/AAAAAAAAAL/Xs10/AAAAAAAAAL/Xs10/AAAAAAAAAL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAA/AAAAANezXb8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADvCsclAAAAAAAAgL/vCsclAAAAAAAAgL/vCsclAAAAAAAAgL/vCsclAAAAAAAAgL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAC/AAAAANezXb8AAAC/AAAAANezXb8AAAC/AAAAANezXb8AAAC/AAAAANezXb8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAADXs12/AAAAAAAAAL/Xs12/AAAAAAAAAL/Xs12/AAAAAAAAAL/Xs12/AAAAAAAAAL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAIC/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AABgPjMz8zwzM/O9AABgPjMz8zwzM/M9MzNjPgAAAD0zM/M9ZmaOPgAAAD0zM/O9ZmaOPgAAAD0zM/O9MzNjPgAAAD0zM/O9ZmaOPgAAAL0zM/M9ZmaOPgAAAL0zM/M9MzNjPgAAAL0zM/O9MzNjPgAAAL0zM/M9AACQPjMz87wzM/M9AACQPjMz8zwAAAA+ZmaOPjMz8zwAAAA+ZmaOPjMz87wAAAC+ZmaOPjMz8zwzM/O9AACQPjMz8zwzM/O9AACQPjMz87wAAAC+ZmaOPjMz87wzM/M9ZmaOPgAAAD0zM/M9AACQPjMz8zwzM/O9AACQPjMz8zwzM/O9ZmaOPgAAAD0zM/O9AACQPjMz87wzM/M9AACQPjMz87wzM/M9ZmaOPgAAAL0zM/O9ZmaOPgAAAL0AAAA+MzNjPjMz8zwzM/M9AABgPjMz8zwzM/M9AABgPjMz87wAAAA+MzNjPjMz87wzM/O9AABgPjMz87wzM/O9AABgPjMz8zwAAAC+MzNjPjMz8zwAAAC+MzNjPjMz87wzM/O9AABgPjMz8zwzM/M9AABgPjMz8zwzM/M9MzNjPgAAAD0zM/O9MzNjPgAAAD0zM/M9MzNjPgAAAL0zM/M9AABgPjMz87wzM/O9AABgPjMz87wzM/O9MzNjPgAAAL0AAAA+MzNjPjMz87wzM/M9MzNjPgAAAL0zM/M9ZmaOPgAAAL0AAAA+ZmaOPjMz87wzM/M9ZmaOPgAAAD0zM/M9MzNjPgAAAD0AAAA+MzNjPjMz8zwAAAA+ZmaOPjMz8zwzM/O9ZmaOPgAAAL0zM/O9MzNjPgAAAL0AAAC+MzNjPjMz87wAAAC+ZmaOPjMz87wAAAC+MzNjPjMz8zwzM/O9MzNjPgAAAD0zM/O9ZmaOPgAAAD0AAAC+ZmaOPjMz8zwzM/M9AABgPjMz8zwAAAA+MzNjPjMz8zwzM/M9MzNjPgAAAD0zM/O9AABgPjMz8zwzM/O9MzNjPgAAAD0AAAC+MzNjPjMz8zwzM/M9AABgPjMz87wzM/M9MzNjPgAAAL0AAAA+MzNjPjMz87wzM/O9AABgPjMz87wAAAC+MzNjPjMz87wzM/O9MzNjPgAAAL0zM/M9AACQPjMz8zwzM/M9ZmaOPgAAAD0AAAA+ZmaOPjMz8zwzM/O9AACQPjMz8zwAAAC+ZmaOPjMz8zwzM/O9ZmaOPgAAAD0zM/M9AACQPjMz87wAAAA+ZmaOPjMz87wzM/M9ZmaOPgAAAL0zM/O9AACQPjMz87wzM/O9ZmaOPgAAAL0AAAC+ZmaOPjMz87wAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8u+eQ+LvlkPwAAAAAu+eQ+LvlkPwAAAAAu+eQ+LvlkPwAAAAAu+eQ+LvlkPwAAAAAu+eS+LvlkPwAAAAAu+eS+LvlkPwAAAAAu+eS+LvlkPwAAAAAu+eS+LvlkPwAAAAAAAAAALvnkPi75ZD8AAAAALvnkPi75ZD8AAAAALvnkPi75ZD8AAAAALvnkPi75ZD8AAAAALvnkPi75ZL8AAAAALvnkPi75ZL8AAAAALvnkPi75ZL8AAAAALvnkPi75ZL8u+eQ+LvlkvwAAAAAu+eQ+LvlkvwAAAAAu+eQ+LvlkvwAAAAAu+eQ+LvlkvwAAAAAu+eS+LvlkvwAAAAAu+eS+LvlkvwAAAAAu+eS+LvlkvwAAAAAu+eS+LvlkvwAAAAAAAAAALvnkvi75ZD8AAAAALvnkvi75ZD8AAAAALvnkvi75ZD8AAAAALvnkvi75ZD8AAAAALvnkvi75ZL8AAAAALvnkvi75ZL8AAAAALvnkvi75ZL8AAAAALvnkvi75ZL9CW3g+AAAAAEJbeL9CW3g+AAAAAEJbeL9CW3g+AAAAAEJbeL9CW3g+AAAAAEJbeL9CW3g+AAAAAEJbeD9CW3g+AAAAAEJbeD9CW3g+AAAAAEJbeD9CW3g+AAAAAEJbeD9CW3i+AAAAAEJbeL9CW3i+AAAAAEJbeL9CW3i+AAAAAEJbeL9CW3i+AAAAAEJbeL9CW3i+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AAAAP5tUAr6amfk+AAAAP5tUAr5KuLY+AAAAP+YIsr4AAAAAAAAAP+XkZKSfwgU+AAAAvzMz875KuLY+AAAAv+YIsr4AAAAAAAAAv+XkZKRKuLY+AAAAv+YIsr6fwgU+AAAAvzMz876fwgU+AAAAPzMz875KuLY+AAAAP+YIsr5KuLY+AAAAP+YIsr6fwgU+AAAAPzMz874AAAAAAAAAP+XkZKSfwgW+AAAAvzMz876fwgU+AAAAvzMz874AAAAAAAAAv+XkZKSfwgU+AAAAvzMz876fwgW+AAAAvzMz876fwgW+AAAAPzMz876fwgU+AAAAPzMz876fwgU+AAAAPzMz876fwgW+AAAAPzMz874AAAAAAAAAP+XkZKRKuLa+AAAAv+YIsr6fwgW+AAAAvzMz874AAAAAAAAAv+XkZKSfwgW+AAAAvzMz875KuLa+AAAAv+YIsr5KuLa+AAAAP+YIsr6fwgW+AAAAPzMz876fwgW+AAAAPzMz875KuLa+AAAAP+YIsr4AAAAAAAAAP+XkZKSamfm+AAAAv5tUAr5KuLa+AAAAv+YIsr4AAAAAAAAAv+XkZKRKuLa+AAAAv+YIsr6amfm+AAAAv5tUAr6amfm+AAAAP5tUAr5KuLa+AAAAP+YIsr5KuLa+AAAAP+YIsr6amfm+AAAAP5tUAr4AAAAAAAAAP+XkZKSamfm+AAAAv5tUAj6amfm+AAAAv5tUAr4AAAAAAAAAv+XkZKSamfm+AAAAv5tUAr6amfm+AAAAv5tUAj6amfm+AAAAP5tUAj6amfm+AAAAP5tUAr6amfm+AAAAP5tUAr6amfm+AAAAP5tUAj4AAAAAAAAAP+XkZKRKuLa+AAAAv+YIsj6amfm+AAAAv5tUAj4AAAAAAAAAv+XkZKSamfm+AAAAv5tUAj5KuLa+AAAAv+YIsj5KuLa+AAAAP+YIsj6amfm+AAAAP5tUAj6amfm+AAAAP5tUAj5KuLa+AAAAP+YIsj4AAAAAAAAAP+XkZKSfwgW+AAAAvzMz8z5KuLa+AAAAv+YIsj4AAAAAAAAAv+XkZKRKuLa+AAAAv+YIsj6fwgW+AAAAvzMz8z6fwgW+AAAAPzMz8z5KuLa+AAAAP+YIsj5KuLa+AAAAP+YIsj6fwgW+AAAAPzMz8z4AAAAAAAAAP+XkZKSfwgU+AAAAvzMz8z6fwgW+AAAAvzMz8z4AAAAAAAAAv+XkZKSfwgW+AAAAvzMz8z6fwgU+AAAAvzMz8z6fwgU+AAAAPzMz8z6fwgW+AAAAPzMz8z6fwgW+AAAAPzMz8z6fwgU+AAAAPzMz8z4AAAAAAAAAP+XkZKQAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAACNB/s+AAAAAHEeXz+NB/s+AAAAAHEeXz+NB/s+AAAAAHEeXz+NB/s+AAAAAHEeXz8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAABGPVw/AAAAAF6AAj9GPVw/AAAAAF6AAj9GPVw/AAAAAF6AAj9GPVw/AAAAAF6AAj8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAABGPVw/AAAAAF6AAr9GPVw/AAAAAF6AAr9GPVw/AAAAAF6AAr9GPVw/AAAAAF6AAr8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAACNB/s+AAAAAHEeX7+NB/s+AAAAAHEeX7+NB/s+AAAAAHEeX7+NB/s+AAAAAHEeX78AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAAAAAAAAgL8AAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAAAAAAAAAACAvwAAAACNB/u+AAAAAHEeX7+NB/u+AAAAAHEeX7+NB/u+AAAAAHEeX7+NB/u+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AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAANezXT8AAAAAAAAAP9ezXT8AAAAAAAAAP9ezXT8AAAAAAAAAP9ezXT8AAAAAAAAAPwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAANezXT8AAAAAAAAAv9ezXT8AAAAAAAAAv9ezXT8AAAAAAAAAv9ezXT8AAAAAAAAAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAO8KxyUAAAAAAACAv+8KxyUAAAAAAACAv+8KxyUAAAAAAACAv+8KxyUAAAAAAACAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAANezXb8AAAAAAAAAv9ezXb8AAAAAAAAAv9ezXb8AAAAAAAAAv9ezXb8AAAAAAAAAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAgL8AAAAA7wrHpQAAgL8AAAAA7wrHpQAAgL8AAAAA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AAAAAAAAAAAAAIC/AAAAAAAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAO8KxyUAAAAAAACAv+8KxyUAAAAAAACAv+8KxyUAAAAAAACAv+8KxyUAAAAAAACAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAANezXb8AAAAAAAAAv9ezXb8AAAAAAAAAv9ezXb8AAAAAAAAAv9ezXb8AAAAAAAAAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAgL8AAAAA7wrHpQAAgL8AAAAA7wrHpQAAgL8AAAAA7wrHpQAAgL8AAAAA7wrHpQAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAANezXb8AAAAAAAAAP9ezXb8AAAAAAAAAP9ezXb8AAAAAAAAAP9ezXb8AAAAAAAAAPwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAL8AAAAA17NdPwAAAL8AAAAA17NdPwAAAL8AAAAA17NdPwAAAL8AAAAA17NdPwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAAAACAPwAAAAAAAAAA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MzP7o9Hi4DvNzEw80eLgu8SgJDvNzEw8mpkZvMSgJDuamfk+mpkZvNHi4Duamfk+0eLgu9Hi4Duamfk+0eLgu8SgJDuamfk+mpkZvDMz+6Oamfk+MzP7o8SgJLvNzEw8mpkZvMSgJDvNzEw8mpkZvDMz+6PNzEw8MzP7o8SgJDvNzEw8mpkZvMSgJLvNzEw8mpkZvMSgJLuamfk+mpkZvMSgJDuamfk+mpkZvMSgJDuamfk+mpkZvMSgJLuamfk+mpkZvDMz+6Oamfk+MzP7o9Hi4LvNzEw80eLgu8SgJLvNzEw8mpkZvDMz+6PNzEw8MzP7o8SgJLvNzEw8mpkZvNHi4LvNzEw80eLgu9Hi4Luamfk+0eLgu8SgJLuamfk+mpkZvMSgJLuamfk+mpkZvNHi4Luamfk+0eLguzMz+6Oamfk+MzP7o5qZGbzNzEw8xKAku9Hi4LvNzEw80eLguzMz+6PNzEw8MzP7o9Hi4LvNzEw80eLgu5qZGbzNzEw8xKAku5qZGbyamfk+xKAku9Hi4Luamfk+0eLgu9Hi4Luamfk+0eLgu5qZGbyamfk+xKAkuzMz+6Oamfk+MzP7o5qZGbzNzEw8xKAkO5qZGbzNzEw8xKAkuzMz+6PNzEw8MzP7o5qZGbzNzEw8xKAku5qZGbzNzEw8xKAkO5qZGbyamfk+xKAkO5qZGbyamfk+xKAku5qZGbyamfk+xKAku5qZGbyamfk+xKAkOzMz+6Oamfk+MzP7o9Hi4LvNzEw80eLgO5qZGbzNzEw8xKAkOzMz+6PNzEw8MzP7o5qZGbzNzEw8xKAkO9Hi4LvNzEw80eLgO9Hi4Luamfk+0eLgO5qZGbyamfk+xKAkO5qZGbyamfk+xKAkO9Hi4Luamfk+0eLgOzMz+6Oamfk+MzP7o8SgJLvNzEw8mpkZPNHi4LvNzEw80eLgOzMz+6PNzEw8MzP7o9Hi4LvNzEw80eLgO8SgJLvNzEw8mpkZPMSgJLuamfk+mpkZPNHi4Luamfk+0eLgO9Hi4Luamfk+0eLgO8SgJLuamfk+mpkZPDMz+6Oamfk+MzP7o8SgJDvNzEw8mpkZPMSgJLvNzEw8mpkZPDMz+6PNzEw8MzP7o8SgJLvNzEw8mpkZPMSgJDvNzEw8mpkZPMSgJDuamfk+mpkZPMSgJLuamfk+mpkZPMSgJLuamfk+mpkZPMSgJDuamfk+mpkZPDMz+6Oamfk+MzP7owAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAD8AAAAA17NdPwAAAD8AAAAA17NdPwAAAD8AAAAA17NdPwAAAD8AAAAA17NdPwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAANezXT8AAAAAAAAAP9ezXT8AAAAAAAAAP9ezXT8AAAAAAAAAP9ezXT8AAAAAAAAAPwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAgD8AAAAAAAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAANezXT8AAAAAAAAAv9ezXT8AAAAAAAAAv9ezXT8AAAAAAAAAv9ezXT8AAAAAAAAAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAO8KxyUAAAAAAACAv+8KxyUAAAAAAACAv+8KxyUAAAAAAACAv+8KxyUAAAAAAACAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/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AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAANezXT8AAAAAAAAAv9ezXT8AAAAAAAAAv9ezXT8AAAAAAAAAv9ezXT8AAAAAAAAAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAD8AAAAA17NdvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAO8KxyUAAAAAAACAv+8KxyUAAAAAAACAv+8KxyUAAAAAAACAv+8KxyUAAAAAAACAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAL8AAAAA17NdvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAANezXb8AAAAAAAAAv9ezXb8AAAAAAAAAv9ezXb8AAAAAAAAAv9ezXb8AAAAAAAAAvwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAgL8AAAAA7wrHpQAAgL8AAAAA7wrHpQAAgL8AAAAA7wrHpQAAgL8AAAAA7wrHpQAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAANezXb8AAAAAAAAAP9ezXb8AAAAAAAAAP9ezXb8AAAAAAAAAP9ezXb8AAAAAAAAAPwAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIA/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAAAAAIC/AAAAAAAAAL8AAAAA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";
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
function swooshAddRig(key,grp,pivot,tipPos,hiltPos,o){
  const tip=new THREE.Object3D(), hilt=new THREE.Object3D();
  tip.position.set(tipPos[0],tipPos[1],tipPos[2]); hilt.position.set(hiltPos[0],hiltPos[1],hiltPos[2]); grp.add(tip); grp.add(hilt);
  let alt=null; if(o.alt){ alt=new THREE.Object3D(); alt.position.set(o.alt[0],o.alt[1],o.alt[2]); grp.add(alt); }
  swRigs[key]={tip,hilt,alt,pivot,len:tip.position.distanceTo(hilt.position),width:o.width,start:o.start,stop:o.stop,flag:o.flag||0};
}
function swooshUse(){
  const key=weapon==='axe'?'axe':(swordStyle==='hatchet'?'hatchet':swordStyle==='hammer'?'hammer':swordStyle==='knightly'?'knightly':'sword'), r=swRigs[key]||swRigs.sword; if(!r) return;
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
uniform sampler2D map; uniform float uFrame; uniform float uFrames; uniform float uFade; varying vec2 vUv;
void main(){
  if(uFade<0.999 && fract(dot(floor(gl_FragCoord.xy),vec2(0.7548776662,0.5698402910)))>=uFade) discard;   // fade in/out as a dither, to match the picture
  vec4 tx=texture2D(map,vec2((uFrame+clamp(vUv.x,0.002,0.998))/uFrames,clamp(vUv.y,0.002,0.998)));
  if(tx.a<0.5) discard;
  gl_FragColor=vec4(tx.rgb,1.0);
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
      uniforms:{map:{value:tex},uFrame:{value:0},uFrames:{value:SWOOSH_FRAMES},uFade:{value:1},uRes:U.uRes,uSnap:U.uSnap}});
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
function danceStep(){
  if(!danceWant||!xtra.dance.src||!actions.Dance||current!==actions.Dance) return;
  const L=DANCE_BEATS*60/DANCE_BPM, t=trackPos(xtra.dance.src)-DANCE_OFFSET-0.03;   // (0.03: the pose shown lags a little behind the clock)
  actions.Dance.time=((t%L)+L)%L;
}
function stepMixer(dt){
  if(golemOn&&golemMixer){ golemPlace(); const p=golemAct.time; golemMixer.update(dt); if(p<GOLEM_HIT_AT&&golemAct.time>=GOLEM_HIT_AT) playGolemSfx('atk'); }
  const cn=current&&current.getClip().name, onSwing=swooshOn&&swTip&&swsh.mesh&&(cn==='Swing'||cn==='AxeSwing'||cn==='SwingHeavyRelease'||/^UAL_(Sword_Regular|Sword_Heavy|Melee_Hook)/.test(cn));
  if(!onSwing){ swsh.hasPrev=false; swsh.emit=false; mixer.update(dt); stickAxe(); return; }
  const n=Math.max(1,Math.ceil(dt/SWOOSH_STEP-1e-6)), h=dt/n;
  for(let i=0;i<n;i++){ mixer.update(h); swooshSample(h); }
  stickAxe();
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
  swsh.mat.uniforms.uFrame.value=f;
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
    if(!musicOn) return;
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
const xtra={shop:{id:'shop-song-data',buf:null,src:null,loading:null},frost:{id:'frost-song-data',buf:null,src:null,loading:null},ignis:{id:'ignis-song-data',buf:null,src:null,loading:null},dance:{id:'dance-song-data',buf:null,src:null,loading:null}}; let shopWant=false, frostWant=false, ignisWant=false, danceWant=false;   // dance: the song for the Dance animation (top priority)
/* The shop song's name tag (bottom right of the shop view): just a now-playing label, not a button. */
let shopSong='shop', shopSongBtn=null; const SHOP_SONG_NAMES={shop:'SACRIFICE OF SAINT DELL'};
function loadX(k){ const x=xtra[k]; if(x.loading) return x.loading; const t=atob(document.getElementById(x.id).textContent.trim()), u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i); x.loading=new Promise((res,rej)=>ac.decodeAudioData(u.buffer,res,rej)).then(b=>{ x.buf=b; }); return x.loading; }
function setShopMusic(on){ if(shopWant===on) return; shopWant=on; syncAudio(); }
function setFrostMusic(on){ if(frostWant===on) return; frostWant=on; syncAudio(); }
function setIgnisMusic(on){ if(ignisWant===on) return; ignisWant=on; syncAudio(); }
async function syncAudio(){
  const pick=()=>!musicOn?null:(danceWant?'dance':flauntWant?'flaunt':(battleWant?'battle':(shopWant?shopSong:(ignisWant?'ignis':(frostWant?'frost':'main')))));
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
let golemRig=null, golemScene=null, golemMixer=null, golemAct=null, golemOn=false, golemH0=1, golemMinY=0, golemClips=null, golemPrevT=0;
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
      golemClips={Idle:g.animations.find(a=>a.name==='Idle'),Hit:g.animations.find(a=>a.name==='Hit'),Attack:clip}; if(SNAP_ON&&golemClips.Hit) snapClip(golemClips.Hit);   // the enemy golems use these (their own Idle and Hit from the model file, and GolemAttack)
    },e=>console.error('golem failed',e));
  }catch(e){ console.error(e); }
})();
function golemPlace(){   // stand where the knight stands, facing the way he faces (same rig, both models face +Z)
  const k=GOLEM_SCALE*playerH/golemH0;
  golemRig.scale.setScalar(k); golemRig.position.set(playerRig.position.x,groundYNight-golemMinY*k,playerRig.position.z); golemRig.rotation.y=playerRig.rotation.y;
}
function golemShow(on){
  if(!golemRig||on===golemOn) return;
  golemOn=on; golemRig.visible=on; if(playerRig) playerRig.visible=!on;
  if(current) current.paused=on;   // the hidden knight's clip must not keep running (Chestopen looped on behind the golem and replayed the chest creak)
  if(on){ golemPlace(); golemAct.reset().setLoop(THREE.LoopRepeat,Infinity).play(); golemMixer.update(0); golemPrevT=0; playGolemSfx('spawn'); }
  else golemAct.stop();
}
function playGolem(){
  if(!golemRig||!playerRig){ return; }
  golemShow(true); golemAct.reset().play();
  document.querySelectorAll('#anims .item').forEach(b=>b.setAttribute('aria-checked',b.dataset.n==='GolemAttack'));
}
function play(n){
  if(n==='GolemAttack'){ playGolem(); return; }
  if(golemOn) golemShow(false);
  if(n==='Flaunt'&&weapon==='axe'&&actions.AxeFlaunt) n='AxeFlaunt';   // the axe has its own flaunt (heavy weapons class)
  if(!actions[n]) return;
  if((n==='AxeIdle'||n==='AxeSwing'||n==='AxeFlaunt'||n===FLAUNT_IDLE)&&weapon!=='axe') setWeapon('axe');   // these are the axe's own clips, so choosing one brings the axe out
  else if((n==='Idle'||n==='Swing')&&weapon==='axe') setWeapon('sword');   // and these are the sword's, so choosing one puts the sword back (the game itself always asks for idleName())
  const isFlaunt=(n==='Flaunt'||n==='AxeFlaunt'||n===FLAUNT_IDLE); if(isFlaunt!==flauntWant){ flauntWant=isFlaunt; syncAudio(); }   // either flaunt brings in the flaunt song
  { const isD=(n==='Dance'); if(isD!==danceWant){ danceWant=isD; syncAudio(); } }   // the Dance animation brings in its own song
  if(n===EVT_CLIP) return;
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
function ualAlias(k,sn){ const key=k+'|'+sn; if(!ualAl[key]){ const c=actions[sn].getClip().clone(); c.name=k; ualAl[key]=mixer.clipAction(c); } return ualAl[key]; }
function ualApply(){
  Object.keys(UAL_ALT).forEach(k=>{
    const sn=(k==='Block'&&weapon==='axe')?'UALX_Sword_Block':UAL_ALT[k], alt=actions[sn]&&ualAlias(k,sn); if(!ualOrig[k]&&actions[k]&&actions[k]!==alt) ualOrig[k]=actions[k];   // (Block with the axe: the game turns the model round again for it, so that one uses the clip in its original hand)
    const o=ualOrig[k]; if(!o||!alt) return;
    alt.setEffectiveTimeScale(1);
    if(ualOn){ actions[k]=alt; if(!/Idle|Walk|Hit/.test(k)) alt.setDuration(o.getClip().duration); } else actions[k]=o;   // Hit plays at its own speed: squeezed into the knight's 0.26 s it looked wrong
  });
}
function toggleUal(){
  let base=null; Object.keys(UAL_ALT).forEach(k=>{ if(current&&(current===actions[k]||current===ualOrig[k]||current===actions[UAL_ALT[k]]||current===actions.UALX_Sword_Block&&k==='Block')) base=k; });
  ualOn=!ualOn; ualApply(); if(base) play(base);
}
function animGroup(n){ return n==='GolemAttack'?'enemies':(/^Shop/.test(n)?'shop':'self'); }
function buildMenu(){
  const box=document.getElementById('anims');
  menuNames.forEach((n,i)=>{
    const b=document.createElement('button'); b.className='item'; b.dataset.n=n; b.setAttribute('role','radio'); b.textContent=n;
    b.addEventListener('click',()=>menuPlay(n)); box.appendChild(b);
  });
}
function cycle(d){ const c=golemOn?'GolemAttack':(current&&current.getClip().name), i=menuNames.indexOf(AXE_BASE[c]||c); menuPlay(menuNames[(i+d+menuNames.length)%menuNames.length]); }

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
const vSel=document.getElementById('voicesel'); if(vSel) vSel.onchange=()=>{ setVoice(vSel.value); vSel.blur(); blip(520,0.05); };
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
  const p=ptrs.get(e.pointerId); if(!p||mapMode||startScr||invOn) return;
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
  const sw=actions[swingName()]; if(!sw||!exploring||dungeon||paused) return;
  if(swinging){ swingQueued=true; return; }          // one click is buffered, so mashing chains swings
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
        mobModels[key]={scene:g.scene,h0:bx.max.y-bx.min.y,minY:bx.min.y,clips:{Idle:f('Idle'),Hit:f('Hit'),Attack:f('atk')}};
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
    root.traverse(o=>{ if(o.name==='Shortsword') o.visible=true; else if(o.name==='Axe'||o.name==='Hatchet'||o.name==='Hammer'||o.name==='KnightlySword') o.visible=false; });   // enemies stay with swords + the normal Idle
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
function stepEnemies(dt){ for(const e of enemies) e.mixer.update(dt); if(shopKeeper&&shopGroup&&shopGroup.visible){ shopKeeper.mixer.update(dt); shopEvtStep(dt); updateShopFace(dt); } fadeEnemies(dt); if(pointerMixer) pointerMixer.update(dt); }
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
  attack:{title:'ATTACK',items:['CARVE','BACK']},
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
  else if(it==='FLAUNT') startFlaunt();
  else if(it==='BLOCK') startBlock();
  else if(it==='RENDER') startRender();
}
function btBegin(act){ bmClose(true); bt.act=act; bt.t=0; bt.stage=0; hudSet(HINT_BUSY); }
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
const RENDER_GUARD=0.10, RENDER_DAMAGE=25;   // RENDER: the share of each enemy hit it blocks (10%), and what the heavy swing does to EVERY enemy
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
  '#dfeat{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .7s linear;z-index:40;display:none;align-items:center;justify-content:center}#dfeat.show{opacity:1}'+
  '#dfeat img{width:min(62vmin,520px);height:min(62vmin,520px);image-rendering:pixelated;opacity:0;transition:opacity .35s linear .6s}#dfeat.show img{opacity:1}';
  document.head.appendChild(st); })();
const hpLayer=document.createElement('div'); hpLayer.id='hpl'; document.body.appendChild(hpLayer);
const turnEl=document.createElement('div'); turnEl.id='turn'; document.body.appendChild(turnEl);
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
  pl.hp=pl.max=PLAYER_HP; pl.guard=false; pl.render=false; pl.buf=false; pl.dead=false; potions=POTION_COUNT; turn='player'; ep=null; endDone=false; endKind=null;
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
  e.sqT=0; e.sqDir={x:dx/d,z:dz/d}; e.sqHome=e.rig.position.clone(); e.sqBase=e.root.scale.x;
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
  if(ep.e&&ep.e.isSlime&&ep.stage>=1&&ep.stage<=3) slimeSquish(ep.e,dt);   // the squishy jump drawn over the slime's own attack clip
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
  } else if(bt.act==='flaunt'){
    if(bt.t>=FLAUNT_TIME){ play(idleName()); btEnd(); }
  } else if(bt.act==='block'){
    if(bt.t>=actions.Block.getClip().duration+BLOCK_HOLD){ playBlockIdle(); btEnd(); }   // Block has played: he stays in BlockIdle (a loop) through the enemies' whole turn
  } else if(bt.act==='render'){
    if(bt.stage===0&&bt.t>=actions.SwingHeavyWindUp.getClip().duration){ bt.stage=1; playHeavy('SwingHeavyTurnHold',1,true); afterPlayerAction(); }   // windup done: he holds while the enemies take their turn
  } else if(bt.act==='renderswing'){
    const rd=actions.SwingHeavyRelease.getClip().duration;
    if(bt.stage===0&&bt.t>=rd*0.45){ bt.stage=1; bt.hold=0; playSfxSet('render-swish-sfx-data',0,0.9,1,0); playSfxSet('render-hit-sfx-data',0,0.9,1,0.03); enemies.forEach(e=>{ if(!e.dead) hurtEnemy(e,RENDER_DAMAGE); }); }   // the blade connects: all targets
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
  if(!paused){ updateShine(dt); updateSky(dt); updateNight(dt); updateHelm6Face(dt); updateSnow(dt); updateLeaves(dt); updateSwoosh(dt); updateFire(dt); footstepStep(); updateShopLamp(); updateMapRuins(); applyFogThickness(); updateMagma(dt); inspectStep(dt); applyAreaFog(); }
  shopSync(); if(mapMode) mapStep(dt);   // the map places the camera itself; when it has closed (mapMode false again) the orbit camera below takes over in the same frame
  if(!mapMode){
    invStep(dt);   // the inventory zoom
    const d=(camera.userData.fit||5)*zoom, cp=Math.cos(pitch);
    camera.position.set(target.x+d*Math.sin(yaw)*cp, target.y+d*Math.sin(pitch), target.z+d*Math.cos(yaw)*cp);
    camera.lookAt(target);
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
function playSword(ts){
  const i=Math.floor(Math.random()*3);
  if(voice==='voice2') playSfxSet('v2-sword-sfx-data',i,V2_SWORD_GAIN,1,Math.max(0,SWORD_CHOP_T/(ts||1)-V2_SWORD_ONSET[i]));
  else playSfxSet('sword-sfx-data',i,SWORD_GAIN,1,Math.max(0,SWORD_CHOP_T/(ts||1)-SWORD_ONSET[i]));
  playSfxSet('knife-sfx-data',0,KNIFE_GAIN,1,Math.max(0,SWORD_CHOP_T/(ts||1)-KNIFE_PEAK));
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
['UAL_Sword_Regular_A','UAL_Sword_Regular_B','UAL_Sword_Regular_C','UAL_Sword_Regular_Combo','UAL_Sword_Heavy_Combo','UAL_Melee_Hook'].forEach(n=>{ ANIM_SFX[n]=ANIM_SFX.Swing; ANIM_SFX_LOOPS[n]=1; });   // the UAL clips in the ANIMATIONS menu get the same sounds
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
  try{ sfx=sfx||new (window.AudioContext||window.webkitAudioContext)(); sfx.resume(); loadGrunts(); loadBlockSfx(); loadSfxSet('step-data'); loadSfxSet('sword-sfx-data'); loadSfxSet('knife-sfx-data'); loadSfxSet('defeat-sfx-data'); loadSfxSet('flaunt-sfx-data'); loadSfxSet('potion-sfx-data'); ['render-swish-sfx-data','render-hit-sfx-data','render-charge-sfx-data','golem-atk-sfx-data','golem-pain-sfx-data','golem-spawn-sfx-data'].forEach(loadSfxSet);
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
  root.traverse(o=>{ if(o.name==='Shortsword'||o.name==='Axe'||o.name==='Hatchet'||o.name==='Hammer'||o.name==='KnightlySword') o.visible=false; });
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
    const st2=document.createElement('style'); st2.textContent='#shopui{position:fixed;left:3vw;top:9vh;width:min(32vw,440px);height:auto;max-height:74vh;box-sizing:border-box;border:3px solid #7fc4ff;background:rgba(40,100,230,.30);box-shadow:0 0 0 3px #000,inset 0 0 0 3px rgba(0,0,0,.35);display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;padding:24px;gap:12px;font-size:min(34px,5vh);letter-spacing:.14em;color:#d4ecff;text-shadow:3px 3px 0 #000;opacity:0;transition:opacity .6s;pointer-events:none;z-index:15}#shopui.on{opacity:1;pointer-events:auto}#shopui .shopctl{display:none}#shopui .mi{display:flex;justify-content:space-between}#shopui .shoplist{display:flex;flex-direction:column;gap:12px;flex:0 0 auto}#shopui:not(.buy) .shoplist{display:none}#shopui.buy .shopmain,#shopui.buy .shopctl{display:none}@media (max-aspect-ratio:9/10){#shopui{left:4vw;width:92vw;top:4vh;height:auto;max-height:46vh}}'; document.head.appendChild(st2);
    shopUi=document.createElement('div'); shopUi.id='shopui';
    shopUi.innerHTML='<div class="shophead" style="border-bottom:2px solid #7fc4ff;padding-bottom:6px;margin-bottom:8px">SHOP</div>'
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
    const stb=document.createElement('style'); stb.textContent='#shopsong{position:fixed;right:max(14px,env(safe-area-inset-right,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:16;font:inherit;font-size:22px;letter-spacing:.08em;color:#d4ecff;background:rgba(40,100,230,.30);border:2px solid #7fc4ff;box-shadow:0 0 0 2px #000;padding:4px 12px;opacity:0;pointer-events:none;transition:opacity .6s;text-shadow:2px 2px 0 #000}#shopsong.on{opacity:1}'; document.head.appendChild(stb);
    shopSongBtn=document.createElement('div'); shopSongBtn.id='shopsong'; shopSongBtn.textContent='\u266A '+SHOP_SONG_NAMES[shopSong]; document.body.appendChild(shopSongBtn);
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
const INV_ZOOM=0.5, INV_PITCH=0.06, INV_TY=0.1, INV_VIEW=1.25;   // zoom, tilt, how high he is looked at (knight-heights above his middle), how far the picture is pushed right (1 = the menu's usual shift)
function invStep(dt){
  if(!invOn&&invK===0) return;
  if(invOn) invHid.forEach(h=>{ h.o.visible=false; });   // (kept hidden every frame, in case something else switches it back on)
  const goal=invOn?1:0; invK+=(goal-invK)*(1-Math.exp(-dt*4)); if(Math.abs(goal-invK)<0.002) invK=goal;
  if(!invPrev) return;
  zoom=mapLerp(invPrev.zoom,INV_ZOOM,invK); pitch=mapLerp(invPrev.pitch,INV_PITCH,invK);
  target.set(invPrev.tx,mapLerp(invPrev.ty,homeTarget.y+playerH*INV_TY,invK),invPrev.tz);
  mapViewK=mapLerp(1,INV_VIEW,invK); applyView();
  if(!invOn&&invK===0){ invPrev=null; mapViewK=1; applyView(); }
}
const INV_ROWS=[
  {t:'SWORD',  v:()=>(weapon==='sword'&&swordStyle==='sword')?'EQUIPPED':'', run:()=>{ swordStyle='sword'; setWeapon('sword'); refreshAnim(); }},
  {t:'HATCHET',v:()=>(weapon==='sword'&&swordStyle==='hatchet')?'EQUIPPED':'', run:()=>{ swordStyle='hatchet'; setWeapon('sword'); refreshAnim(); }},
  {t:'AXE',    v:()=>(weapon==='axe'&&axeStyle==='axe')?'EQUIPPED':'', run:()=>{ axeStyle='axe'; setWeapon('axe'); showWeapons(); refreshAnim(); }},
  {t:'SHOVEL', v:()=>(weapon==='axe'&&axeStyle==='shovel')?'EQUIPPED':'', run:()=>{ axeStyle='shovel'; setWeapon('axe'); showWeapons(); refreshAnim(); }},
  {t:'HAMMER', v:()=>(weapon==='sword'&&swordStyle==='hammer')?'EQUIPPED':'', run:()=>{ swordStyle='hammer'; setWeapon('sword'); refreshAnim(); }},
  {t:'KNIGHTLY SWORD', v:()=>(weapon==='sword'&&swordStyle==='knightly')?'EQUIPPED':'', run:()=>{ swordStyle='knightly'; setWeapon('sword'); refreshAnim(); }},
  {t:'POTION', v:()=>'x1', run:()=>{}},
  {t:'BACK',   v:()=>'', run:()=>closeInventory()}];
function invRefresh(){ if(!invUi) return; [...invUi.querySelectorAll('.mi')].forEach((b,i)=>{ b.classList.toggle('on',i===invCur); b.lastChild.textContent=INV_ROWS[i].v(); }); }
function invSelect(i,sound){ i=((i%INV_ROWS.length)+INV_ROWS.length)%INV_ROWS.length; if(i===invCur) return; invCur=i; if(sound) blip(520,0.05); invRefresh(); }
function invActivate(){ blip(880,0.09); INV_ROWS[invCur].run(); invRefresh(); }
function invBuild(){
  if(invUi) return;
  const st=document.createElement('style'); st.textContent='#invui{position:fixed;left:3vw;top:9vh;width:min(32vw,440px);max-height:74vh;box-sizing:border-box;border:3px solid #7fc4ff;background:rgba(40,100,230,.30);box-shadow:0 0 0 3px #000,inset 0 0 0 3px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:12px;padding:24px;font-size:min(34px,5vh);letter-spacing:.14em;color:#d4ecff;text-shadow:3px 3px 0 #000;opacity:0;transition:opacity .6s;pointer-events:none;z-index:15}#invui.on{opacity:1;pointer-events:auto}#invui .mi{display:flex;justify-content:space-between}@media (max-aspect-ratio:9/10){#invui{left:4vw;width:92vw;top:4vh;max-height:46vh}}'; document.head.appendChild(st);
  invUi=document.createElement('div'); invUi.id='invui';
  invUi.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #7fc4ff;padding-bottom:6px;margin-bottom:8px"><span>INVENTORY</span><button type="button" id="inv-cust" style="font:inherit;font-size:.62em;color:#d4ecff;background:rgba(0,0,0,.35);border:2px solid #7fc4ff;padding:2px 10px;letter-spacing:.1em;cursor:pointer;text-shadow:inherit">CUSTOMIZE</button></div>'+INV_ROWS.map(r=>'<button class="mi" type="button"><span>'+r.t+'</span><span class="v"></span></button>').join('');
  [...invUi.querySelectorAll('.mi')].forEach((b,i)=>{ b.onmouseenter=()=>invSelect(i,true); b.onclick=()=>{ invSelect(i,false); invActivate(); }; });
  invUi.querySelector('#inv-cust').onclick=()=>{ blip(880,0.09); invShowCust(); };   // (invUi is not in the page yet, so document.getElementById would find nothing)
  document.body.appendChild(invUi);
}
function invShowCust(){ invCust=true; invUi.classList.remove('on'); document.body.classList.remove('map'); invGoMenu('custom'); }   // the customize window takes the inventory's place, same camera
function invShowInv(){ invCust=false; invGoMenu('main'); document.body.classList.add('map'); invUi.classList.add('on'); invRefresh(); }
function openInventory(){
  if(invOn||exploring||mapMode) return;
  invPrev={zoom:zoom,pitch:pitch,tx:target.x,ty:target.y,tz:target.z,spin:spin,clip:current?current.getClip().name:null}; invOn=true; invCur=0;
  if(spin) toggleSpin();   // the turntable stays off
  invHid=scene.children.filter(o=>o!==playerRig).map(o=>({o:o,v:o.visible})); if(rockMesh) invHid.push({o:rockMesh,v:rockMesh.visible});   // everything but the knight goes
  play(idleName());        // his proper idle (the axe's with the axe)
  document.body.classList.add('map');   // the menu window steps aside, as it does for the map
  invBuild(); invRefresh(); requestAnimationFrame(()=>invUi.classList.add('on'));
}
function closeInventory(){
  if(!invOn) return;
  invOn=false; invCust=false; invUi.classList.remove('on'); if(invPrev&&invPrev.spin&&!spin) toggleSpin();
  invHid.forEach(h=>{ h.o.visible=h.v; }); invHid=[]; if(invPrev&&invPrev.clip&&actions[invPrev.clip]) play(invPrev.clip);   // the world comes back and he returns to the pose he was in
  document.body.classList.remove('map');
}
addEventListener('keydown',e=>{
  if(!invOn||invCust) return; const k=e.key;
  e.stopImmediatePropagation();   // this key is the inventory's alone: otherwise, once it closes the inventory, the main menu's own handler sees the same key press (Escape = back to the START SCREEN, Enter = a menu item)
  if(k==='c'||k==='C'||k==='Tab'){ e.preventDefault(); invShowCust(); return; }
  if(k==='Escape'||k==='Backspace'){ e.preventDefault(); blip(300,0.08); closeInventory(); }
  else if(k==='ArrowDown'||k==='s'){ e.preventDefault(); invSelect(invCur+1,true); }
  else if(k==='ArrowUp'||k==='w'){ e.preventDefault(); invSelect(invCur-1,true); }
  else if(k==='Enter'||k===' '){ e.preventDefault(); invActivate(); }
});
function initMainMenu(){
  const root=document.getElementById('mm'), scr=document.getElementById('scr'), cust=document.getElementById('cust'), toastEl=document.getElementById('toast');
  ['vlbl','voicesel','hlbl','helmsel','plbl','sws','albl','asws','astrl','astr','shiny','slbl','ssws','smatch'].forEach(id=>{ const n=document.getElementById(id); if(n) cust.appendChild(n); });
  let tt=0; window.toast=toast; function toast(t){ toastEl.textContent=t; toastEl.classList.add('show'); clearTimeout(tt); tt=setTimeout(()=>toastEl.classList.remove('show'),1700); }
  const BACK={t:'BACK',go:'main'}, BACK_OPT={t:'BACK',go:'options'};   // BACK_OPT: from a group of options back to OPTIONS
  const BACK_ANIM={t:'BACK',go:'anims'};   // from an ANIMATIONS sub-menu back to the ANIMATIONS list
  const animRows=g=>menuNames.filter(n=>animGroup(n)===g).map(n=>({t:n.toUpperCase(),v:()=>(n==='GolemAttack'?golemOn:(!golemOn&&current&&(AXE_BASE[current.getClip().name]||current.getClip().name)===n))?'PLAYING':'',run:()=>menuPlay(n)}));
  const SCREENS={
    start:{name:'PRESS START',items:[{t:'START',run:startGame}]},
    main:{name:'MAIN MENU',items:[{t:'MAP',run:openMap},{t:'INVENTORY',run:openInventory},{t:'OPTIONS',go:'options'},{t:'ANIMATIONS',go:'anims'},{t:'CREDITS',go:'credits'}]},
    custom:{name:'CUSTOMIZE',panel:1,items:[BACK]},
    /* TEMPORARY: lists every animation in the model so you can preview them. Delete this screen and the ANIMATIONS entry above when you no longer need it */
    anims:{name:'ANIMATIONS (TEMP)',get items(){ return [{t:'VOICE',v:()=>voice==='voice2'?'VOICE 2':'VOICE 1',run:toggleVoice},{t:'WEAPON',v:()=>weapon==='axe'?'AXE':'SWORD',run:toggleWeapon},{t:'SWORD STYLE',v:()=>swordStyle==='hatchet'?'HATCHET':swordStyle==='hammer'?'HAMMER':swordStyle==='knightly'?'KNIGHTLY':'SWORD',run:toggleStyle},{t:'AXE STYLE',v:()=>axeStyle==='shovel'?'SHOVEL':'AXE',run:toggleAxeStyle},{t:'ANIM SET',v:()=>ualOn?'UNIVERSAL':'KNIGHT',run:toggleUal},{t:'ENEMIES',go:'anims_enemies'},{t:'SELF',go:'anims_self'},{t:'SHOPKEEPER',go:'anims_shop'},BACK]; }},
    anims_enemies:{name:'ANIMATIONS: ENEMIES',up:'anims',get items(){ return animRows('enemies').concat([BACK_ANIM]); }},
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
      {t:'SWORD STYLE',v:()=>swordStyle==='hatchet'?'HATCHET':swordStyle==='hammer'?'HAMMER':swordStyle==='knightly'?'KNIGHTLY':'SWORD',run:toggleStyle},{t:'AXE STYLE',v:()=>axeStyle==='shovel'?'SHOVEL':'AXE',run:toggleAxeStyle},{t:'ANIM SET',v:()=>ualOn?'UNIVERSAL':'KNIGHT',run:toggleUal},
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
