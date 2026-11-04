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
  uLampPos:{value:new THREE.Vector3()}, uLampP:{value:new THREE.Vector4(1,0,14,0)}, uLampCol:{value:new THREE.Vector3(1,0.78,0.45)},
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
  vec3 rf=reflect(normalize(mv.xyz),nr);                        // fake metal: reflect the view ray, look up sky/ground and a sun glint per vertex
  vEnv=dot(rf,normalize(mat3(viewMatrix)*vec3(0.0,1.0,0.0)));
  vSpec=pow(max(dot(rf,normalize(mat3(viewMatrix)*uSunDir)),0.0),8.0);
  /* the shop lantern (BRIGHTBOX): lit at each VERTEX (Gouraud) and blended across the triangle, for shiny materials only. uLampP = range, strength, highlight sharpness */
  vLampD=0.0; vLampS=0.0;
  if(uShine>0.01&&uLampP.y>0.0){
    vec3 lp=(viewMatrix*vec4(uLampPos,1.0)).xyz;
    vec3 ld=lp-mv.xyz; float dist=length(ld); ld=ld/max(dist,0.0001);
    float q=clamp(1.0-dist*dist/(uLampP.x*uLampP.x),0.0,1.0); float att=q*q*uLampP.y;          // fades smoothly to nothing at the edge of its range
    vLampD=max(dot(nr,ld),0.0)*att;
    vLampS=pow(max(dot(nr,normalize(ld+normalize(-mv.xyz))),0.0),uLampP.z)*att;                // a highlight that slides over the metal as the camera moves
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
uniform sampler2D map; uniform vec3 uTint; uniform float uAffine; uniform float uDither; uniform float uLevels; uniform vec3 uFogColor; uniform vec3 uNight; uniform float uShine; uniform float uBlackNoShine;
uniform vec3 uLampCol; uniform float uEmit; varying float vLampD; varying float vLampS;
uniform vec3 uLamp2Col; varying float vLamp2D; varying float vLamp2S;
uniform vec4 uOccF[6]; uniform float uOccN; uniform float uOccGap; uniform float uOccOn; uniform vec2 uOccNear;
varying vec2 vUvA; varying vec2 vUvP; varying float vW; varying float vLit; varying float vFog; varying float vEnv; varying float vSpec;
float b2(vec2 p){ p=mod(p,2.0); if(p.x<1.0) return p.y<1.0?0.0:3.0; return p.y<1.0?2.0:1.0; }
void main(){
  vec2 st=uAffine>0.5 ? vUvA/vW : vUvP;
  vec4 tx=texture2D(map,st);
  if(tx.a<0.5) discard;
  if(uOccOn>0.5&&uOccN>0.5){                                   // see-through obstacles: what stands between the camera and the knight / an enemy is dithered away around him
    float hide=0.0;
    for(int i=0;i<6;i++){
      if(float(i)>=uOccN) break;
      vec4 f=uOccF[i];                                         // xy = where he is on the screen (pixels), z = how big the hole is (pixels), w = how far he is from the camera
      float fr=1.0-smoothstep(f.w-uOccGap,f.w-uOccGap*0.4,vW);    // only what is nearer to the camera than him
      float fa=1.0-smoothstep(f.z*0.6,f.z,length(gl_FragCoord.xy-f.xy));   // gone in the middle, dithering out towards the rim
      hide=max(hide,fr*fa);
    }
    hide=max(hide,1.0-smoothstep(uOccNear.x,uOccNear.y,vW));      // and whatever is right up against the lens, so a wall can never fill the screen
    vec2 q=floor(gl_FragCoord.xy);
    if((4.0*b2(q)+b2(floor(q*0.5))+0.5)/16.0<hide) discard;       // the same 4x4 ordered dither as the colour dither, so it reads as the same grain
  }
  vec3 base=tx.rgb*uTint, lit=base*vLit, lampT=vec3(0.0);
  if(uShine>0.01){                                             // uShine (0..1) scales both the env ramp and the BRIGHTBOX lantern highlight
    float sh=clamp(uShine,0.0,1.0);
    if(uBlackNoShine>0.5) sh*=smoothstep(0.03,0.09,max(tx.r,max(tx.g,tx.b)));   // uBlackNoShine (Helmet 6): the pure-black parts of the texture get no shine at all
    float e=floor(clamp(vEnv*0.5+0.5,0.0,1.0)*3.0+0.5)/3.0;
    vec3 m=mix(base*base*0.7,base*1.35,e);
    float sp=(step(0.3,vSpec)*0.3+step(0.7,vSpec)*0.5)*sh;
    lit=mix(lit,m,0.8*sh)+mix(vec3(1.0),uTint,0.5)*sp;
    lampT=(base*uLampCol*vLampD*mix(0.45,1.0,sh)+mix(vec3(1.0),uTint,0.5)*uLampCol*vLampS*sh)*sh;
    lampT+=(base*uLamp2Col*vLamp2D*mix(0.45,1.0,sh)+mix(vec3(1.0),uTint,0.5)*uLamp2Col*vLamp2S*sh)*sh;
  }
  lit=mix(lit,base,uEmit);                                                                          // uEmit: 1 on the lantern's bulb itself - it glows instead of being lit
  vec3 c=mix(lit*mix(uNight,vec3(1.0),uEmit)+lampT,uFogColor,vFog);
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
uniform sampler2D map; uniform sampler2D mapFrost; uniform float uUseFrost; uniform float uFrostZ; uniform float uFrostSpan;
uniform vec3 uTint; uniform float uAffine; uniform float uDither; uniform float uLevels; uniform vec3 uFogColor; uniform vec3 uNight;
varying vec2 vUvA; varying vec2 vUvP; varying float vW; varying float vLit; varying float vFog; varying vec3 vWorldPos;
float b2(vec2 p){ p=mod(p,2.0); if(p.x<1.0) return p.y<1.0?0.0:3.0; return p.y<1.0?2.0:1.0; }
void main(){
  vec2 st=uAffine>0.5 ? vUvA/vW : vUvP;
  vec4 txG=texture2D(map,st);
  vec4 txF=texture2D(mapFrost,st);
  float wave=sin(vWorldPos.x*0.35)*1.2+sin(vWorldPos.x*0.95+1.7)*0.55+cos(vWorldPos.x*1.8-0.6)*0.25;
  float k=uUseFrost*(1.0-smoothstep(uFrostZ-uFrostSpan, uFrostZ+uFrostSpan, vWorldPos.z+wave));
  vec3 base=mix(txG.rgb,txF.rgb,k)*uTint, lit=base*vLit;
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
    uniforms:Object.assign({map:{value:tex},uUvScale:{value:uvScale||1},uTint:{value:new THREE.Vector3(1,1,1)},uShine:{value:0},uBlackNoShine:{value:0},uEmit:{value:0},uOccOn:{value:0}},U)});   // uOccOn: 1 on walls and trees (occMark), which dither away when they are in front of someone
}
function ps1FloorMat(texG,texF,uvScale,H){
  [texG,texF].forEach(tex=>{ tex.encoding=THREE.LinearEncoding; tex.generateMipmaps=false; tex.minFilter=tex.magFilter=THREE.NearestFilter; tex.needsUpdate=true; });
  return new THREE.ShaderMaterial({vertexShader:VS_FLOOR,fragmentShader:FS_FLOOR,side:THREE.DoubleSide,
    uniforms:Object.assign({map:{value:texG},mapFrost:{value:texF},uUseFrost:{value:1},uFrostZ:{value:-10*H},uFrostSpan:{value:4.8*H},uUvScale:{value:uvScale||24},uTint:{value:new THREE.Vector3(1,1,1)}},U)});
}

/* ---------- armor tint: multiplies every part of the knight (body, limbs, boots, helmets) except the plume (own color) and the sword (own tint, or matched to the armor) ---------- */
const armorMats=[]; let armorHex=null, armorAmt=0.55;
let shiny=true;   // fake metal shading on the armor and sword (Customize > Shiny metal)
function shineMat(m){ m.uniforms.uShine.value=shiny?1:0; }
const swordMats=[]; let swordHex=null, swordMatch=true;   // the blade has its own tint, or follows the armor's while swordMatch is on
function tintMat(m,hex){
  shineMat(m);
  const v=m.uniforms.uTint.value; if(!hex){ v.set(1,1,1); return; }
  const c=new THREE.Color(hex), mx=Math.max(c.r,c.g,c.b,1e-4);   // brightest channel = 1, so it recolors without darkening
  v.set(1+(c.r/mx-1)*armorAmt, 1+(c.g/mx-1)*armorAmt, 1+(c.b/mx-1)*armorAmt);
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
let exploring=false, ps1=true, spin=false, paused=false, mixer=null, actions={}, names=[], menuNames=[], current=null;
let mapMode=false, startScr=false, mapS=0, mapDir=0, mapViewK=1;   // the map (see MAP below): mapS 0 = menu camera ... 3 = the map, mapDir +1 opening / -1 closing / 0 resting, mapViewK 1 = picture shifted right for the menu ... 0 = centered
let yaw=Math.PI+0.65, pitch=0.1, zoom=0.82, baseDist=5, target=new THREE.Vector3();
/* seated pose: Pose2 shows the rock and now and then plays the Pose2_randomevent look-around */
const SEAT_CLIP='Pose2', EVT_CLIP='Pose2_randomevent';
/* the start screen: he sits hunched in Pose3 (the rig's own clip, embedded as pose3-data) under a fixed camera; START goes to the main menu with Pose2. It is night throughout unless OPTIONS > TIME says otherwise */
const START_CLIP='Pose3';
/* The animation menus list ONE entry each for Idle, Swing and Flaunt. When the Axe is the weapon in his hand, that entry plays the axe's own clip
   (AxeIdle / AxeSwing / AxeFlaunt) instead, so those three never get entries of its own. */
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

/* ---------- updated shop animations extracted from Adventurer_lowpoly_rigged (3) (2) (15)_2.gltf ---------- */
const SHOP_ANIMS={"shopidle-data":{"name":"ShopIdle","tracks":[{"n":"Torso","p":"q","t":[0.0,10.916667],"v":[0.258819,0.0,0.0,0.965926,0.258819,0.0,0.0,0.965926]},{"n":"Torso","p":"t","t":[0.0,0.708333,10.916667],"v":[0.0,0.133401,0.0,0.0,0.149026,0.0,0.0,0.133401,0.0]},{"n":"Left_Arm","p":"q","t":[0.0,0.458333,0.916667,1.333333,10.916667],"v":[0.0,0.0,-0.382683,0.92388,0.0,0.0,-0.382683,0.92388,0.0,0.0,-0.34202,0.939693,0.0,0.0,-0.382683,0.92388,0.0,0.0,-0.382683,0.92388]},{"n":"Left_Forearm","p":"q","t":[0.0,0.875,1.208333,2.208333,10.916667],"v":[0.045627,-0.82943,0.265773,0.489212,0.045627,-0.82943,0.265773,0.489212,0.016421,-0.771242,0.26916,0.576602,0.016421,-0.771242,0.26916,0.576602,0.045627,-0.82943,0.265773,0.489212]},{"n":"Right_Arm","p":"q","t":[0.0,0.875,3.5,10.916667],"v":[-0.028083,0.252477,0.058724,0.965411,-0.028083,0.252477,0.058724,0.965411,-0.026795,0.231357,0.059322,0.970689,-0.028083,0.252477,0.058724,0.965411]},{"n":"Right_Arm","p":"t","t":[0.0,0.458333,0.875,1.333333,10.916667],"v":[-0.125,0.466667,-0.066667,-0.125,0.451042,-0.066667,-0.125,0.466667,-0.066667,-0.125,0.451042,-0.066667,-0.125,0.466667,-0.066667]},{"n":"Right_Forearm","p":"q","t":[0.0,0.458333,0.875,1.333333,3.5,10.916667],"v":[0.0,0.480989,0.0,0.876727,-0.010493,0.480874,-0.019125,0.876518,0.0,0.480989,0.0,0.876727,-0.010493,0.480874,-0.019125,0.876518,-0.010074,0.499881,-0.01935,0.865819,0.0,0.480989,0.0,0.876727]},{"n":"Left_Leg","p":"q","t":[0.0,0.875,10.916667],"v":[-0.443302,0.248211,0.129211,0.851575,-0.443302,0.248211,0.129211,0.851575,-0.443302,0.248211,0.129211,0.851575]},{"n":"Left_Shin","p":"q","t":[0.0,0.875,10.916667],"v":[0.737277,0.0,0.0,0.67559,0.737277,0.0,0.0,0.67559,0.737277,0.0,0.0,0.67559]},{"n":"Right_Leg","p":"q","t":[0.0,0.875,10.916667],"v":[-0.591316,-0.188569,-0.144694,0.770617,-0.591316,-0.188569,-0.144694,0.770617,-0.591316,-0.188569,-0.144694,0.770617]},{"n":"Right_Shin","p":"q","t":[0.0,0.875,10.916667],"v":[0.707107,0.0,0.0,0.707107,0.707107,0.0,0.0,0.707107,0.707107,0.0,0.0,0.707107]},{"n":"Head","p":"q","t":[0.0,0.416667,0.875,1.291667,2.0,2.416667,4.666667,5.041667,7.291667,7.666667,7.708333,7.791667,8.0,8.5,8.583333,8.666667,9.5,9.708333,9.791667,9.833333,10.083333,10.916667],"v":[0.057314,-0.025817,-0.071213,0.995478,0.035584,-0.024257,-0.07176,0.996492,0.057314,-0.025817,-0.071213,0.995478,0.035584,-0.024257,-0.07176,0.996492,0.035584,-0.024257,-0.07176,0.996492,0.03401,-0.04599,-0.072519,0.995726,0.03401,-0.04599,-0.072519,0.995726,0.035584,-0.024257,-0.07176,0.996492,0.03401,-0.04599,-0.072519,0.995726,0.015065,-0.556233,-0.063947,0.828426,0.013666,-0.574172,-0.06426,0.816095,0.015065,-0.556233,-0.063947,0.828426,0.015065,-0.556233,-0.063947,0.828426,-0.019117,0.380342,0.010187,0.924592,-0.019334,0.400421,0.009768,0.916075,-0.019117,0.380342,0.010187,0.924592,-0.019117,0.380342,0.010187,0.924592,0.03401,-0.04599,-0.072519,0.995726,0.03242,-0.0677,-0.073243,0.994485,0.03401,-0.04599,-0.072519,0.995726,0.035584,-0.024257,-0.07176,0.996492,0.057314,-0.025817,-0.071213,0.995478]},{"n":"Head","p":"t","t":[0.0,0.875,10.916667],"v":[0.0,1.609375,0.3125,0.0,1.609375,0.3125,0.0,1.609375,0.3125]}]},"shopidleanimation1-data":{"name":"ShopIdleAnimation1","tracks":[{"n":"Torso","p":"q","t":[0.0],"v":[0.258819,0.0,0.0,0.965926]},{"n":"Left_Arm","p":"q","t":[0.0,0.375,1.875,2.208333,2.458333,2.916667,6.416667,6.791667,8.375,8.875],"v":[0.0,0.0,-0.382683,0.92388,0.0,0.0,-0.422618,0.906308,0.0,0.0,-0.422618,0.906308,0.0,0.0,-0.19509,0.980785,-0.43379,0.086286,-0.174971,0.87964,-0.442183,0.009648,-0.325061,0.835893,-0.442183,0.009648,-0.325061,0.835893,-0.43379,0.086286,-0.174971,0.87964,-0.43379,0.086286,-0.174971,0.87964,0.0,0.0,-0.382683,0.92388]},{"n":"Left_Forearm","p":"q","t":[0.0,0.375,2.041667,2.208333,2.458333,2.916667,3.0,3.083333,3.333333,3.416667,6.083333,6.291667,6.583333,6.708333,6.833333,8.291667,8.875],"v":[0.045627,-0.82943,0.265773,0.489212,0.099778,-0.82467,0.233208,0.505547,0.099778,-0.82467,0.233208,0.505547,-0.026835,-0.830251,0.3074,0.464186,-0.111783,-0.66719,0.28761,0.67797,-0.201494,-0.815908,0.397138,0.368749,-0.192783,-0.823758,0.401439,0.350862,-0.201494,-0.815908,0.397138,0.368749,-0.201494,-0.815908,0.397138,0.368749,-0.166115,-0.844942,0.413188,0.296235,-0.166115,-0.844942,0.413188,0.296235,-0.201494,-0.815908,0.397138,0.368749,-0.408357,-0.654022,-0.481876,0.416287,-0.411719,-0.635955,-0.481162,0.441057,-0.408357,-0.654022,-0.481876,0.416287,-0.408357,-0.654022,-0.481876,0.416287,0.045627,-0.82943,0.265773,0.489212]},{"n":"Right_Arm","p":"q","t":[0.0,0.375,3.083333,3.541667,7.25],"v":[-0.028083,0.252477,0.058724,0.965411,-0.026795,0.231357,0.059322,0.970689,-0.026795,0.231357,0.059322,0.970689,-0.028083,0.252477,0.058724,0.965411,-0.028083,0.252477,0.058724,0.965411]},{"n":"Right_Arm","p":"t","t":[0.0,0.375,3.083333,3.541667,7.25],"v":[-0.125,0.466667,-0.066667,-0.125,0.466667,-0.066667,-0.125,0.466667,-0.066667,-0.125,0.466667,-0.066667,-0.125,0.466667,-0.066667]},{"n":"Right_Forearm","p":"q","t":[0.0,0.375,7.25],"v":[0.0,0.480989,0.0,0.876727,0.0,0.480989,0.0,0.876727,0.0,0.480989,0.0,0.876727]},{"n":"Left_Leg","p":"q","t":[0.0,0.375,7.25],"v":[-0.443302,0.248211,0.129211,0.851575,-0.443302,0.248211,0.129211,0.851575,-0.443302,0.248211,0.129211,0.851575]},{"n":"Left_Shin","p":"q","t":[0.0,0.375,7.25],"v":[0.737277,0.0,0.0,0.67559,0.737277,0.0,0.0,0.67559,0.737277,0.0,0.0,0.67559]},{"n":"Right_Leg","p":"q","t":[0.0,0.375,7.25],"v":[-0.591316,-0.188569,-0.144694,0.770617,-0.591316,-0.188569,-0.144694,0.770617,-0.591316,-0.188569,-0.144694,0.770617]},{"n":"Right_Shin","p":"q","t":[0.0,0.375,7.25],"v":[0.707107,0.0,0.0,0.707107,0.707107,0.0,0.0,0.707107,0.707107,0.0,0.0,0.707107]},{"n":"Head","p":"q","t":[0.0,0.833333,0.958333,1.125,2.083333,2.875,3.166667,3.25,3.291667,3.416667,4.25,4.375,4.5,4.583333,6.666667,7.25],"v":[0.057314,-0.025817,-0.071213,0.995478,0.004785,-0.139754,-0.13185,0.981357,0.001907,-0.161129,-0.131923,0.978075,0.004785,-0.139754,-0.13185,0.981357,0.004785,-0.139754,-0.13185,0.981357,-0.003033,0.156822,-0.00686,0.987598,-0.035742,0.159651,0.064509,0.984415,-0.055865,0.136682,0.068272,0.986679,-0.035742,0.159651,0.064509,0.984415,-0.072667,0.14658,-0.17132,0.971537,-0.072667,0.14658,-0.17132,0.971537,0.024311,-0.065464,-0.146561,0.986734,0.045831,-0.068646,-0.145098,0.985969,0.024311,-0.065464,-0.146561,0.986734,0.024311,-0.065464,-0.146561,0.986734,0.057314,-0.025817,-0.071213,0.995478]},{"n":"Head","p":"t","t":[0.0,0.375,7.25],"v":[0.0,1.609375,0.3125,0.0,1.609375,0.3125,0.0,1.609375,0.3125]}]},"shopintotalk-data":{"name":"ShopIdleAnimationIntoTalk","tracks":[{"n":"Torso","p":"q","t":[0.0],"v":[0.258819,0.0,0.0,0.965926]},{"n":"Left_Arm","p":"q","t":[0.0,1.291667,1.625,2.083333],"v":[0.0,0.0,-0.402747,0.915311,0.0,0.0,-0.402747,0.915311,0.0,0.0,-0.19509,0.980785,0.0,0.0,-0.402747,0.915311]},{"n":"Left_Forearm","p":"q","t":[0.0,1.625,2.083333,2.208333,2.333333],"v":[-0.026835,-0.830251,0.3074,0.464186,-0.026835,-0.830251,0.3074,0.464186,-0.479956,-0.724661,-0.163364,0.466713,-0.515376,-0.705771,-0.185056,0.449477,-0.479956,-0.724661,-0.163364,0.466713]},{"n":"Right_Arm","p":"q","t":[0.0],"v":[-0.028083,0.252477,0.058724,0.965411]},{"n":"Right_Arm","p":"t","t":[0.0],"v":[-0.125,0.466667,-0.066667]},{"n":"Right_Forearm","p":"q","t":[0.0],"v":[0.0,0.480989,0.0,0.876727]},{"n":"Left_Leg","p":"q","t":[0.0],"v":[-0.443302,0.248211,0.129211,0.851575]},{"n":"Left_Shin","p":"q","t":[0.0],"v":[0.737277,0.0,0.0,0.67559]},{"n":"Right_Leg","p":"q","t":[0.0],"v":[-0.591316,-0.188569,-0.144694,0.770617]},{"n":"Right_Shin","p":"q","t":[0.0],"v":[0.707107,0.0,0.0,0.707107]},{"n":"Head","p":"q","t":[0.0,0.458333,2.166667,3.666667],"v":[0.079016,-0.027364,-0.070633,0.993991,0.043193,0.010418,-0.045009,0.997998,0.043193,0.010418,-0.045009,0.997998,0.043193,0.010418,-0.045009,0.997998]},{"n":"Head","p":"t","t":[0.0],"v":[0.0,1.609375,0.3125]}]},"shopoutrotalk-data":{"name":"ShopIdleAnimationOutroTalk","tracks":[{"n":"Torso","p":"q","t":[0.0],"v":[0.258819,0.0,0.0,0.965926]},{"n":"Left_Arm","p":"q","t":[0.0,1.291667,1.625,2.083333],"v":[0.0,0.0,-0.402747,0.915311,0.0,0.0,-0.402747,0.915311,0.0,0.0,-0.19509,0.980785,0.0,0.0,-0.402747,0.915311]},{"n":"Left_Forearm","p":"q","t":[0.0,1.625,2.083333,2.208333,2.333333],"v":[-0.026835,-0.830251,0.3074,0.464186,-0.026835,-0.830251,0.3074,0.464186,-0.479956,-0.724661,-0.163364,0.466713,-0.515376,-0.705771,-0.185056,0.449477,-0.479956,-0.724661,-0.163364,0.466713]},{"n":"Right_Arm","p":"q","t":[0.0],"v":[-0.028083,0.252477,0.058724,0.965411]},{"n":"Right_Arm","p":"t","t":[0.0],"v":[-0.125,0.466667,-0.066667]},{"n":"Right_Forearm","p":"q","t":[0.0],"v":[0.0,0.480989,0.0,0.876727]},{"n":"Left_Leg","p":"q","t":[0.0],"v":[-0.443302,0.248211,0.129211,0.851575]},{"n":"Left_Shin","p":"q","t":[0.0],"v":[0.737277,0.0,0.0,0.67559]},{"n":"Right_Leg","p":"q","t":[0.0],"v":[-0.591316,-0.188569,-0.144694,0.770617]},{"n":"Right_Shin","p":"q","t":[0.0],"v":[0.707107,0.0,0.0,0.707107]},{"n":"Head","p":"q","t":[0.0,0.458333,2.166667,3.666667],"v":[0.079016,-0.027364,-0.070633,0.993991,0.043193,0.010418,-0.045009,0.997998,0.043193,0.010418,-0.045009,0.997998,0.043193,0.010418,-0.045009,0.997998]},{"n":"Head","p":"t","t":[0.0],"v":[0.0,1.609375,0.3125]}],"rev":true},"shopwhiletalking-data":{"name":"ShopIdleAnimationWhileTalking","tracks":[{"n":"Torso","p":"q","t":[0.0,7.791667],"v":[0.258819,0.0,0.0,0.965926,0.258819,0.0,0.0,0.965926]},{"n":"Torso","p":"t","t":[0.0,2.208333,3.958333,5.75,7.791667],"v":[0.0,0.133401,0.0,0.0,0.133401,0.0,0.0,0.149026,0.0,0.0,0.133401,0.0,0.0,0.133401,0.0]},{"n":"Left_Arm","p":"q","t":[0.0,0.375,1.5,2.75,3.875,4.625,5.458333,6.541667,7.791667],"v":[-0.43379,0.086286,-0.174971,0.87964,-0.434776,0.081495,-0.172598,0.880079,-0.437504,0.067077,-0.165467,0.881313,-0.434776,0.081495,-0.172598,0.880079,-0.437504,0.067077,-0.165467,0.881313,-0.434776,0.081495,-0.172598,0.880079,-0.43379,0.086286,-0.174971,0.87964,-0.437504,0.067077,-0.165467,0.881313,-0.43379,0.086286,-0.174971,0.87964]},{"n":"Left_Forearm","p":"q","t":[0.0,0.375,1.5,2.75,3.875,4.625,5.458333,6.541667,7.791667],"v":[-0.479956,-0.724661,-0.163364,0.466713,-0.526324,-0.691718,-0.132491,0.476398,-0.511109,-0.703036,-0.142852,0.473394,-0.526324,-0.691718,-0.132491,0.476398,-0.511109,-0.703036,-0.142852,0.473394,-0.526324,-0.691718,-0.132491,0.476398,-0.479956,-0.724661,-0.163364,0.466713,-0.511109,-0.703036,-0.142852,0.473394,-0.479956,-0.724661,-0.163364,0.466713]},{"n":"Right_Arm","p":"q","t":[0.0,3.916667,5.208333,7.666667,7.791667],"v":[-0.028083,0.252477,0.058724,0.965411,-0.028083,0.252477,0.058724,0.965411,-0.028083,0.252477,0.058724,0.965411,-0.028083,0.252477,0.058724,0.965411,-0.028083,0.252477,0.058724,0.965411]},{"n":"Right_Arm","p":"t","t":[0.0,0.375,3.083333,3.916667,5.208333,5.583333,6.833333,7.666667,7.791667],"v":[-0.125,0.466667,-0.066667,-0.125,0.451042,-0.066667,-0.125,0.451042,-0.066667,-0.125,0.466667,-0.066667,-0.125,0.466667,-0.066667,-0.125,0.451042,-0.066667,-0.125,0.451042,-0.066667,-0.125,0.466667,-0.066667,-0.125,0.466667,-0.066667]},{"n":"Right_Forearm","p":"q","t":[0.0,0.375,3.083333,3.916667,5.208333,5.583333,6.833333,7.666667,7.791667],"v":[0.0,0.480989,0.0,0.876727,0.0,0.442289,0.0,0.896873,0.0,0.442289,0.0,0.896873,0.0,0.480989,0.0,0.876727,0.0,0.480989,0.0,0.876727,0.0,0.442289,0.0,0.896873,0.0,0.442289,0.0,0.896873,0.0,0.480989,0.0,0.876727,0.0,0.480989,0.0,0.876727]},{"n":"Left_Leg","p":"q","t":[0.0],"v":[-0.443302,0.248211,0.129211,0.851575]},{"n":"Left_Shin","p":"q","t":[0.0],"v":[0.737277,0.0,0.0,0.67559]},{"n":"Right_Leg","p":"q","t":[0.0],"v":[-0.591316,-0.188569,-0.144694,0.770617]},{"n":"Right_Shin","p":"q","t":[0.0],"v":[0.707107,0.0,0.0,0.707107]},{"n":"Head","p":"q","t":[0.0,7.791667],"v":[0.043193,0.010418,-0.045009,0.997998,0.043193,0.010418,-0.045009,0.997998]},{"n":"Head","p":"t","t":[0.0,2.041667,3.958333,6.166667,7.791667],"v":[0.0,1.609375,0.3125,0.0,1.608125,0.3125,0.0,1.625,0.3125,0.0,1.609375,0.3125,0.0,1.609375,0.3125]}]}};

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
  floorTexClassic=ft; floorTexForest=mkFloorTex('#5aa845','#4a9638'); floorTexFrost=mkFloorTex('#eef4ff','#d8e4f8'); floorMat=ps1FloorMat(floorTexForest,floorTexFrost,96,H);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(H*96,H*96,96,96),floorMat);
  floor.rotation.x=-Math.PI/2; floor.position.set(0,box.min.y-H*0.004,-0.5*FROST_DIST*H); scene.add(floor); floorMesh=floor;
  const blob=new THREE.Mesh(new THREE.CircleGeometry(H*0.26,10),
    new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.42,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
  blob.rotation.x=-Math.PI/2; blob.position.set(ctr.x,box.min.y+H*0.002,ctr.z); scene.add(blob); blobMesh=blob; blobHome=blob.position.clone();

  U.uFogNear.value=H*2.6; U.uFogFar.value=H*5.2;
  initTrees(H,box.min.y); initRuins(H,box.min.y,ctr); initPointer(); initElemental(); initDgForest(H,box.min.y,ctr); initSky(H,box.min.y); initNight(H,box.min.y); groundYNight=box.min.y; initLeaves(box.min.y); initSnow(H,box.min.y); initRock(gltf.scene,box.min.y); initSword(gltf.scene); initHatchet(gltf.scene); initHammer(gltf.scene); initAxe(gltf.scene); initPotion(gltf.scene); setWorld(true);
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
  ['axeidle-data','axeswing-data','axeflaunt-data','flauntidleaxe-data','drinkpotion-data','pose3-data','shopidle-data','shopidleanimation1-data','shopintotalk-data','shopoutrotalk-data','shopwhiletalking-data'].forEach(function(id){
    let D;
    if(SHOP_ANIMS[id]){
      D=JSON.parse(JSON.stringify(SHOP_ANIMS[id]));
    } else {
      const el=document.getElementById(id); if(!el) return;
      D=JSON.parse(el.textContent);
    }
    const base={};
    if((id==='axeswing-data'&&AXE_SWING_REVERSE)||D.rev){   // play the swing backwards: keyframes in reverse order, times counted from the end
      let T=0; D.tracks.forEach(k=>{ T=Math.max(T,k.t[k.t.length-1]); });
      D.tracks.forEach(k=>{ const n=k.p==='q'?4:3, c=k.t.length, v=[]; for(let i=c-1;i>=0;i--) for(let j=0;j<n;j++) v.push(k.v[i*n+j]); k.t=k.t.map(x=>T-x).reverse(); k.v=v; });
    }
    gltf.animations.forEach(a=>a.tracks.forEach(t=>{ const b=t.name.slice(0,t.name.lastIndexOf('.')); base[b.replace(/_\d+$/,'')]=b; }));
    const tr=D.tracks.map(k=>{ const b=base[k.n]||k.n; return k.p==='q'?new THREE.QuaternionKeyframeTrack(b+'.quaternion',k.t,k.v):new THREE.VectorKeyframeTrack(b+'.position',k.t,k.v); });
    const existIdx=gltf.animations.findIndex(a=>a.name===D.name);
    if(existIdx>=0) gltf.animations.splice(existIdx,1);
    gltf.animations.push(new THREE.AnimationClip(D.name,-1,tr));
  });
  { [START_CLIP,'ShopIdle','ShopIdleAnimation1','ShopIdleAnimationIntoTalk','ShopIdleAnimationOutroTalk','ShopIdleAnimationWhileTalking'].forEach(cn=>{ const p3=gltf.animations.find(a=>a.name===cn); if(p3) setLeftShin(p3,LEFT_SHIN_DEG); }); }   // Pose3 shares Pose2's legs, so it gets the same tweak and sits on the same rock. Its head is left as authored; the occasional look at the sky is added on top, see headLook()
  /* AxeFlaunt is the rig's own "animation" clip, played exactly as authored (arms, body, legs and head are not touched). Only the axe moves: it rests on his back, see AXE_STOW_CLIPS. */
  mixer=new THREE.AnimationMixer(gltf.scene);
  const order=['Idle','AxeIdle','Walk','Swing','AxeSwing','AxeFlaunt','Hit','Death'];
  names=order.filter(n=>gltf.animations.some(a=>a.name===n)).concat(gltf.animations.map(a=>a.name).filter(n=>!order.includes(n)&&n!==EVT_CLIP));
  menuNames=names.filter(n=>!AXE_BASE[n]);   // what the menus list: the axe variants are folded into Idle / Swing / Flaunt
  gltf.animations.forEach(a=>{actions[a.name]=mixer.clipAction(a);});
  mixer.addEventListener('finished',e=>{ if(e.action===actions[EVT_CLIP]) evtDone=true; else if(e.action===actions.Swing||e.action===actions.AxeSwing) swingDone=true; else if(e.action===actions.AxeFlaunt&&e.action===current) flauntDone=true; });
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
let night=false, forest=true, mapArea='greenfield', floorMat=null, floorTexClassic=null, floorTexForest=null, floorTexFrost=null, treeGroup=null, greenTreeGroup=null, frostTreeGroup=null;
const SKY_CLASSIC=0x232a4a, SKY_FOREST=0x6ca8e6;
function mkFloorTex(c1,c2){
  const cv=document.createElement('canvas'); cv.width=cv.height=2; const g=cv.getContext('2d');
  g.fillStyle=c1; g.fillRect(0,0,2,2); g.fillStyle=c2; g.fillRect(0,0,1,1); g.fillRect(1,1,1,1);
  const t=new THREE.CanvasTexture(cv); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.encoding=THREE.LinearEncoding;
  t.generateMipmaps=false; t.minFilter=t.magFilter=THREE.NearestFilter; return t;
}
const FROST_DIST=26;   // how far north (-Z, in knight-heights) The Veiled Frost sits from The Greenfield
let mapAreaK=0, mapAreaTarget=0; const mapAreaV={v:0};   // 0 = The Greenfield, 1 = The Veiled Frost; smoothly glides between them
let greenRockMesh=null, frostRockMesh=null, spareGreenRock=null, spareFrostRock=null;
function areaZOffset(area){ return ((area||mapArea)==='frost'?-FROST_DIST:0)*(playerH||2.2); }
function syncFrostBlend(){
  if(!floorMat||!floorMat.uniforms.uFrostZ) return;
  const H=playerH||2.2;
  floorMat.uniforms.uUseFrost.value=forest?1:0;
  // Border sits halfway between The Greenfield (z = 0) and The Veiled Frost (z = -FROST_DIST*H), at z = -10*H
  const zBorder=-0.5*FROST_DIST*H+(mapAreaK-0.5)*2.0*H;
  floorMat.uniforms.uFrostZ.value=zBorder;
  floorMat.uniforms.uFrostSpan.value=4.2*H;
}
function syncRockMeshes(){
  const onSeat=!!(current&&current.getClip().name===SEAT_CLIP);
  const inFrost=(mapArea==='frost');
  if(greenRockMesh) greenRockMesh.visible=onSeat&&!inFrost;
  if(frostRockMesh) frostRockMesh.visible=onSeat&&inFrost;
  if(spareGreenRock) spareGreenRock.visible=forest&&!dungeon&&inFrost;
  if(spareFrostRock) spareFrostRock.visible=forest&&!dungeon&&!inFrost;
}
function moveKnightToArea(area){
  if(!playerRig||exploring||dungeon) return;
  const zOff=areaZOffset(area), dx=target.x-(homeTarget.x+playerRig.position.x), dz=target.z-(homeTarget.z+playerRig.position.z);
  playerRig.position.set(0,0,zOff);
  if(blobMesh&&blobHome) blobMesh.position.set(blobHome.x,blobHome.y,blobHome.z+zOff);
  if(floorMesh) floorMesh.position.set(0,floorMesh.position.y,-0.5*FROST_DIST*(playerH||2.2));
  target.set(homeTarget.x+dx,target.y,homeTarget.z+zOff+dz);
  syncRockMeshes();
}
function setWorld(f){
  forest=f; const sky=night?SKY_NIGHT:(f?SKY_FOREST:SKY_CLASSIC);
  renderer.setClearColor(sky); U.uFogColor.value.setHex(sky);
  document.documentElement.style.setProperty('--sky','#'+sky.toString(16).padStart(6,'0'));
  if(floorMat){ floorMat.uniforms.map.value=f?floorTexForest:floorTexClassic; syncFrostBlend(); }
  treeGroup=(mapArea==='frost'&&frostTreeGroup)?frostTreeGroup:greenTreeGroup;
  if(greenTreeGroup) greenTreeGroup.visible=f&&!dungeon;
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
function setNight(on){
  night=on; const sky=night?SKY_NIGHT:(forest?SKY_FOREST:SKY_CLASSIC);
  renderer.setClearColor(sky); U.uFogColor.value.setHex(sky);
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
  nightStars.rotation.y+=dt*0.006;                              // the stars turn very slowly
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
function initTrees(H,groundY){
  const TD=JSON.parse(document.getElementById('tree-data').textContent).parts;
  buildTreeGroup(TD,H,groundY,forest).then(grp=>{
    greenTreeGroup=grp; if(mapArea!=='frost') treeGroup=grp;
    colliders=grp.children.map(t=>({x:t.position.x,z:t.position.z,r:TREE_R*H*t.scale.x}));
  }).catch(e=>console.error('tree load failed',e));
  const sEl=document.getElementById('snow-tree-data');
  if(sEl){
    const STD=JSON.parse(sEl.textContent).parts;
    buildTreeGroup(STD,H,groundY,forest).then(grp=>{
      grp.position.z=-FROST_DIST*H;
      frostTreeGroup=grp; if(mapArea==='frost') treeGroup=grp;
    }).catch(e=>console.error('snow tree load failed',e));
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
  const want=snowOn&&!dungeon&&(mapArea==='frost'||mapAreaK>0.5);
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
      let f=Math.min(1,Math.max(0,(dist-near)/(far-near))); f=f*f*(3-2*f);                    // into the fog, like the trees
      f=Math.max(f,Math.min(1,Math.max(0,(0.9*H-dist)/(0.5*H))));                             // and out of the way when one drifts right up to the lens
      col[i*3]=nt.x+(fc.r-nt.x)*f; col[i*3+1]=nt.y+(fc.g-nt.y)*f; col[i*3+2]=nt.z+(fc.b-nt.z)*f;   // white (dimmed by the night tint) fading to the fog colour
    }
    snow.pa.needsUpdate=true; snow.ca.needsUpdate=true;
  }catch(e){ if(!updateSnow.warned){ updateSnow.warned=true; console.error('snow',e); } }
}
function updateLeaves(dt){
  if(!leaves) return;
  const show=leavesOn&&mapArea!=='frost'&&treeGroup&&treeGroup.visible; let n=0;
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
}

/* ---------- shortsword (sword-data: Blockbench glTF, same 1/16 units as the knight). Parented to the hand's forearm bone so it follows every animation ---------- */
const SWORD_HAND='Left';               // 'Right' or 'Left' (character's own side)
const SWORD_GRIP_Y=0.844;              // where the handle's middle sits along the sword's own blade axis
const SWORD_ROT_DEG=[90,0,90];         // x,y,z (ZYX): 90,0,90 = blade pointing forward, edge up/down. Tweak to tilt it, e.g. 60,0,90 points it up a bit
const SWORD_NUDGE=[0,0,0];             // extra x,y,z shift in forearm space
const SWORD_ROLL_DEG=90;               // extra turn about the z axis, applied last. Use -90 to turn it the other way, 0 for none
let swordGrp=null, swordOn=true, axeGrp=null, weapon='sword';   // weapon: 'sword' (light) or 'axe' (heavy)
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
const HATCHET_GRIP_Y=1.156, HATCHET_TURN_DEG=0, HATCHET_NUDGE=[0,0,0];
let voice='voice1';   // 'voice1' (original sounds) or 'voice2' (new sounds)
function setVoice(v){
  voice=(v==='voice2')?'voice2':'voice1';
  const b=document.getElementById('voice'); if(b) setSwitch('voice',true,voice==='voice2'?'Voice 2':'Voice 1');
  const sel=document.getElementById('voicesel'); if(sel) sel.value=voice;
}
function toggleVoice(){ setVoice(voice==='voice1'?'voice2':'voice1'); }
let hatchetGrp=null, hammerGrp=null, swordStyle='sword';   // swordStyle: 'sword', 'hatchet' or 'hammer' (only shows while the weapon is the light one)
const STYLE_NAMES={sword:'SWORD',hatchet:'HATCHET',hammer:'HAMMER'};
function showWeapons(){
  if(swordGrp) swordGrp.visible=(weapon==='sword'&&swordStyle==='sword');
  if(hatchetGrp) hatchetGrp.visible=(weapon==='sword'&&swordStyle==='hatchet');
  if(hammerGrp) hammerGrp.visible=(weapon==='sword'&&swordStyle==='hammer');
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
/* ---------- the Hammer (hammer-data: Blockbench glTF). A third SWORD STYLE next to the sword and the hatchet: held, animated and swooshed exactly like the hatchet (the sword's own mount and animations).
   The handle runs up the model's y at z = 0.125 and the head lies along z across the top; HAMMER_GRIP is the middle of the handle (the point that sits in his fist), HAMMER_TURN_DEG turns it about the handle (0 = the long face of the head on the fist's side),
   HAMMER_NUDGE shifts it (forearm space). HAMMER_SWOOSH.tip is the outer end of the head the trail follows. ---------- */
const HAMMER_GRIP=[0,0.72,0.125], HAMMER_TURN_DEG=0, HAMMER_NUDGE=[0,0,0], HAMMER_SWOOSH={tip:[0,1.19,0.44],hilt:[0,0.72,0.125],width:0.5};
function initHammer(parent){
  const el=document.getElementById('hammer-data'); if(!el) return;
  const HD=JSON.parse(el.textContent);
  const fore=parent.getObjectByName(SWORD_HAND+'_Forearm'), hand=parent.getObjectByName('Adventurer_'+SWORD_HAND+'_Hand');
  if(!fore||!hand){ console.error('hammer: hand bones not found'); return; }
  parent.updateMatrixWorld(true);
  const hc=new THREE.Box3().setFromObject(hand).getCenter(new THREE.Vector3()); fore.worldToLocal(hc);
  const D=Math.PI/180, Y=new THREE.Vector3(0,1,0);
  const qS=new THREE.Quaternion().setFromEuler(new THREE.Euler(SWORD_ROT_DEG[0]*D,SWORD_ROT_DEG[1]*D,SWORD_ROT_DEG[2]*D,'ZYX'));
  qS.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),SWORD_ROLL_DEG*D));
  // the head runs along the model's z: a quarter turn about the handle lines it up with the sword's width, with the +z end (the long face) on the fist's side
  let q=qS.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y,Math.PI/2));
  if(new THREE.Vector3(0,0,1).applyQuaternion(q).x*(SWORD_HAND==='Left'?1:-1)<0) q=qS.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y,-Math.PI/2));
  if(HAMMER_TURN_DEG) q.multiply(new THREE.Quaternion().setFromAxisAngle(Y,HAMMER_TURN_DEG*D));
  const grp=new THREE.Group(); grp.name='Hammer'; grp.quaternion.copy(q);
  const grip=new THREE.Vector3(HAMMER_GRIP[0],HAMMER_GRIP[1],HAMMER_GRIP[2]).applyQuaternion(q);
  grp.position.copy(hc).sub(grip).add(new THREE.Vector3(HAMMER_NUDGE[0],HAMMER_NUDGE[1],HAMMER_NUDGE[2]));
  Promise.all(HD.parts.map(p=>loadImg(p.tex))).then(imgs=>{
    HD.parts.forEach((p,k)=>{
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(p.p,3)); geo.setAttribute('normal',new THREE.Float32BufferAttribute(p.n,3)); geo.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2)); geo.setIndex(p.i);
      const tex=new THREE.Texture(imgs[k]); tex.flipY=false;
      const mat=ps1Mat(tex,1); swordMats.push(mat); tintMat(mat,swordMatch?armorHex:swordHex);   // the same weapon color as the sword
      const m=new THREE.Mesh(geo,mat); m.name='hammer_'+p.name;
      m.position.set(p.t[0],p.t[1],p.t[2]); m.rotation.order='ZYX'; m.rotation.set(p.r[0]*D,p.r[1]*D,p.r[2]*D);
      grp.add(m);
    });
    fore.add(grp); hammerGrp=grp;
    swooshAddRig('hammer',grp,parent.getObjectByName(SWORD_HAND+'_Arm')||fore,HAMMER_SWOOSH.tip,HAMMER_SWOOSH.hilt,{width:HAMMER_SWOOSH.width,start:SWOOSH_START_SPEED,stop:SWOOSH_STOP_SPEED});
    showWeapons();
  }).catch(e=>console.error('hammer load failed',e));
}
function toggleStyle(){
  swordStyle=({sword:'hatchet',hatchet:'hammer',hammer:'sword'})[swordStyle]||'sword';
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
const AXE_SWING_REVERSE=false;                      // AxeSwing plays backwards, so the arc sweeps the other way. The clip starts and ends on the same pose, so it still joins up cleanly. false = as before
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
    grp.visible=(weapon==='axe'); fore.add(grp); axeGrp=grp;
    swooshAddRig('axe',grp,parent.getObjectByName((AXE_HEAD_RIGHT?'Right':'Left')+'_Arm')||fore,[0,AXE_SWOOSH.mid,AXE_SWOOSH.bit],[0,AXE_SWOOSH.hilt,0],Object.assign({alt:[0,AXE_SWOOSH.mid,-AXE_SWOOSH.bit]},AXE_SWOOSH)); swooshUse();
    const mkHand=side=>{ const A=parent.getObjectByName(side+'_Arm'), F=parent.getObjectByName(side+'_Forearm'), Hd=parent.getObjectByName('Adventurer_'+side+'_Hand'); if(!A||!F||!Hd) return null;
      parent.updateMatrixWorld(true); const hc=new THREE.Box3().
