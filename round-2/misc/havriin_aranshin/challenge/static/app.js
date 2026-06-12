

let scene, camera, renderer, clock;
let sunLight, ambientLight, hemiLight, fillLight;
let terrain;
let rainP, snowP, dustP;
let grassMesh, cloudsGroup;
let currentWeather = 0, tickCount = 0, cameraShake = 0;
const weatherHistory = [];
const animals = [];

const targetSky = new THREE.Color(0x87CEEB);
const targetFog = new THREE.Color(0x87CEEB);
const targetAmb = new THREE.Color(0x607080);

const W = { NAR:1, BOROO:2, SALHI:3, TSAS:4 };
const ICONS  = {1:'\u2600\uFE0F',2:'\uD83C\uDF27\uFE0F',3:'\uD83D\uDCA8',4:'\u2744\uFE0F'};
const WNAMES = {1:'\u041D\u0410\u0420',2:'\u0411\u041E\u0420\u041E\u041E',3:'\u0421\u0410\u041B\u0425\u0418',4:'\u0426\u0410\u0421'};
const WCLS   = {1:'nar',2:'boroo',3:'salhi',4:'tsas'};

const MAGIC         = 0xAA55;
const MSG_HELLO     = 0x01;
const MSG_WEATHER   = 0x02;
const MSG_FLAG      = 0x03;
const MSG_BROADCAST = 0x04;

let activeWS = null;

function hash(x,y){const n=Math.sin(x*127.1+y*311.7)*43758.5453;return n-Math.floor(n)}
function snoise(x,y){
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
  const a=hash(ix,iy),b=hash(ix+1,iy),c=hash(ix,iy+1),d=hash(ix+1,iy+1);
  return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy;
}
function fbm(x,y,o){let v=0,a=.5,f=1;for(let i=0;i<o;i++){v+=a*snoise(x*f,y*f);a*=.5;f*=2}return v}
function H(x,z){return fbm(x*0.008,-z*0.008,5)*12-3}

function matPhong(color, opts){
  return new THREE.MeshPhongMaterial(Object.assign({color, shininess:8, specular:0x111111}, opts||{}));
}
function matFelt(color){return new THREE.MeshPhongMaterial({color, shininess:2, specular:0x050505})}
function matMetal(color){return new THREE.MeshPhongMaterial({color, shininess:80, specular:0x666666})}

function makeCapsule(radius, length, mat){
  const g=new THREE.Group();
  const cyl=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,14,1,false),mat);
  g.add(cyl);
  const capTop=new THREE.Mesh(new THREE.SphereGeometry(radius,14,8,0,Math.PI*2,0,Math.PI/2),mat);
  capTop.position.y=length/2; g.add(capTop);
  const capBot=new THREE.Mesh(new THREE.SphereGeometry(radius,14,8,0,Math.PI*2,Math.PI/2,Math.PI/2),mat);
  capBot.position.y=-length/2; g.add(capBot);
  g.traverse(c=>{if(c.isMesh)c.castShadow=true});
  return g;
}

function init(){
  clock=new THREE.Clock();
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x87CEEB);
  scene.fog=new THREE.FogExp2(0x87CEEB,0.0045);

  camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,0.1,700);
  camera.position.set(0,18,55);

  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setSize(innerWidth,innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.0;
  renderer.outputEncoding=THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);

  hemiLight=new THREE.HemisphereLight(0xBCD8FF,0x554433,0.7);
  scene.add(hemiLight);
  ambientLight=new THREE.AmbientLight(0x607080,0.35);
  scene.add(ambientLight);
  sunLight=new THREE.DirectionalLight(0xFFF3D6,1.4);
  sunLight.position.set(80,120,50);
  sunLight.castShadow=true;
  const sc=sunLight.shadow.camera;
  sc.left=-90;sc.right=90;sc.top=90;sc.bottom=-90;sc.far=320;sc.near=10;
  sunLight.shadow.mapSize.set(2048,2048);
  sunLight.shadow.bias=-0.0005;
  scene.add(sunLight);

  fillLight=new THREE.DirectionalLight(0xA8C0E0,0.35);
  fillLight.position.set(-50,60,-80);
  scene.add(fillLight);

  createTerrain();
  createMountains();
  createClouds();
  createGer(8,-8,1.0,0);
  createGer(-14,-2,0.85,0.3);
  createGer(24,6,0.78,-0.2);
  createFence(8,-8,9);
  createCampfire(4,-4);
  createGrass();
  createFlowers();
  createRocks();
  createHorses();
  createSheepFlock();
  createDog(2,-3,1.2);
  createDog(-11,-5,2.4);
  createAllParticles();

  window.addEventListener('resize',()=>{
    camera.aspect=innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight);
  });
}

function createTerrain(){
  const S=420,N=180,geo=new THREE.PlaneGeometry(S,S,N,N);
  const v=geo.attributes.position.array;
  const col=new Float32Array((N+1)*(N+1)*3);
  for(let i=0,ci=0;i<v.length;i+=3,ci+=3){
    const px=v[i],py=v[i+1],wz=-py;
    const h=H(px,wz); v[i+2]=h;

    const patch=snoise(px*0.02,py*0.02);
    const dry=Math.max(0,Math.min(1,(h+2)*0.12+patch*0.35));
    const moss=Math.max(0,Math.min(1,snoise(px*0.07,py*0.07)*0.6+0.3));
    col[ci]=0.38+(1-dry)*0.20+moss*0.05;
    col[ci+1]=0.48+dry*0.15-moss*0.05;
    col[ci+2]=0.18+(1-dry)*0.10;
  }
  geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  geo.computeVertexNormals();
  terrain=new THREE.Mesh(geo,new THREE.MeshPhongMaterial({vertexColors:true,shininess:0}));
  terrain.rotation.x=-Math.PI/2;
  terrain.receiveShadow=true;
  scene.add(terrain);
}

function createMountains(){
  const cg=new THREE.ConeGeometry(1,1,7);
  const m1=matPhong(0x6B7B8D);
  const m2=matPhong(0x8895A5);
  const cap=matPhong(0xEEEEFF);
  [{x:-120,z:-150,s:55,h:45},{x:-60,z:-170,s:70,h:55},{x:10,z:-180,s:80,h:60},
   {x:80,z:-160,s:60,h:50},{x:140,z:-155,s:50,h:40},{x:-40,z:-140,s:35,h:28},{x:50,z:-145,s:40,h:32}
  ].forEach((m,i)=>{
    const mesh=new THREE.Mesh(cg,i%2?m2:m1);
    mesh.position.set(m.x,m.h*0.5,m.z);mesh.scale.set(m.s,m.h,m.s);scene.add(mesh);
    if(m.h>35){
      const c=new THREE.Mesh(new THREE.ConeGeometry(0.3,0.25,7),cap);
      c.position.set(m.x,m.h*0.88,m.z);c.scale.set(m.s,m.h,m.s);scene.add(c);
    }
  });
}

function createClouds(){
  cloudsGroup=new THREE.Group();
  const cloudMat=new THREE.MeshPhongMaterial({color:0xFFFFFF,shininess:0,transparent:true,opacity:0.88});
  for(let i=0;i<14;i++){
    const cg=new THREE.Group();
    const cx=(Math.random()-0.5)*280,cz=-80-Math.random()*100,cy=55+Math.random()*25;
    const puffs=5+Math.floor(Math.random()*5);
    for(let j=0;j<puffs;j++){
      const s=3+Math.random()*5;
      const p=new THREE.Mesh(new THREE.SphereGeometry(s,8,6),cloudMat);
      p.position.set((Math.random()-0.5)*12,(Math.random()-0.5)*2,(Math.random()-0.5)*8);
      p.scale.set(1,0.55,1);
      cg.add(p);
    }
    cg.position.set(cx,cy,cz);
    cloudsGroup.add(cg);
  }
  scene.add(cloudsGroup);
}

function createGer(x,z,s,rot){
  const g=new THREE.Group();
  const felt=matFelt(0xECE8DC);
  const blue=matPhong(0x1B2570,{shininess:10});
  const rope=matPhong(0x8B6914);
  const darkWood=matPhong(0x8B5A2B);
  const orangeM=matPhong(0xF57C00);
  const orangeDark=matPhong(0xBF360C);
  const brass=matMetal(0xDDA520);

  const wR=4.2*s, wH=1.5*s;

  const wall=new THREE.Mesh(new THREE.CylinderGeometry(wR,wR*1.03,wH,56),felt);
  wall.position.y=wH/2; wall.castShadow=true; wall.receiveShadow=true; g.add(wall);

  [0.2,0.5,0.85,1.15,1.38].forEach(yy=>{
    const r=new THREE.Mesh(new THREE.TorusGeometry(wR*1.008,0.04*s,8,56),rope);
    r.position.y=yy*s; r.rotation.x=Math.PI/2; g.add(r);
  });

  const bb=new THREE.Mesh(new THREE.CylinderGeometry(wR*1.02,wR*1.06,0.3*s,56),blue);
  bb.position.y=0.15*s; g.add(bb);

  const bt=new THREE.Mesh(new THREE.TorusGeometry(wR*1.012,0.08*s,8,56),blue);
  bt.position.y=wH; bt.rotation.x=Math.PI/2; g.add(bt);

  const rH=2.5*s, tR=0.55*s, eR=wR*1.15;
  const profile=[];
  for(let i=0;i<=28;i++){
    const t=i/28;
    const r=tR+(eR-tR)*Math.pow(t,0.55);
    const y=rH*(1-Math.pow(t,1.7));
    profile.push(new THREE.Vector2(r,y));
  }
  const roofMat=new THREE.MeshPhongMaterial({color:0xE5E0D4,side:THREE.DoubleSide,shininess:2});
  const roof=new THREE.Mesh(new THREE.LatheGeometry(profile,56),roofMat);
  roof.position.y=wH; roof.castShadow=true; roof.receiveShadow=true; g.add(roof);

  for(let i=0;i<16;i++){
    const a=(Math.PI/8)*i;
    const d=new THREE.Mesh(new THREE.OctahedronGeometry(0.18*s,0),blue);
    d.position.set(Math.cos(a)*eR*0.5,wH+rH*0.4,Math.sin(a)*eR*0.5);
    d.scale.set(1,0.22,1); g.add(d);
  }
  for(let i=0;i<8;i++){
    const a=(Math.PI/4)*i+Math.PI/8;
    const d=new THREE.Mesh(new THREE.OctahedronGeometry(0.14*s,0),blue);
    d.position.set(Math.cos(a)*tR*2.4,wH+rH*0.7,Math.sin(a)*tR*2.4);
    d.scale.set(1,0.22,1); g.add(d);
  }

  const toono=new THREE.Mesh(new THREE.TorusGeometry(tR*1.15,0.13*s,10,28),matPhong(0xE65100));
  toono.position.y=wH+rH; toono.rotation.x=Math.PI/2; g.add(toono);
  const tDisc=new THREE.Mesh(new THREE.CircleGeometry(tR*1.1,28),
    new THREE.MeshPhongMaterial({color:0x1A1A1A,side:THREE.DoubleSide,shininess:3}));
  tDisc.position.y=wH+rH-0.01; tDisc.rotation.x=-Math.PI/2; g.add(tDisc);

  for(let i=0;i<4;i++){
    const bar=new THREE.Mesh(new THREE.CylinderGeometry(0.03*s,0.03*s,tR*2.2,8),orangeDark);
    bar.position.y=wH+rH; bar.rotation.z=Math.PI/2; bar.rotation.y=(Math.PI/4)*i; g.add(bar);
  }

  const ch=new THREE.Mesh(new THREE.CylinderGeometry(0.09*s,0.09*s,1.1*s,12),matMetal(0x666666));
  ch.position.set(0.2*s,wH+rH+0.55*s,0); ch.castShadow=true; g.add(ch);
  const chCap=new THREE.Mesh(new THREE.ConeGeometry(0.14*s,0.15*s,12),matMetal(0x444444));
  chCap.position.set(0.2*s,wH+rH+1.18*s,0); g.add(chCap);

  const dW=1.2*s, dH=1.4*s;

  const doorFrame=new THREE.Mesh(new THREE.BoxGeometry(dW*1.35,dH*1.12,0.12*s),blue);
  doorFrame.position.set(0,dH*0.52,wR*1.01);
  doorFrame.castShadow=true; g.add(doorFrame);

  const doorShadow=new THREE.Mesh(new THREE.BoxGeometry(dW*1.15,dH*0.98,0.04*s),matPhong(0x0A0A10));
  doorShadow.position.set(0,dH*0.52,wR*1.045); g.add(doorShadow);

  const doorPanel=new THREE.Mesh(new THREE.BoxGeometry(dW*1.12,dH*0.95,0.08*s),orangeM);
  doorPanel.position.set(0,dH*0.52,wR*1.07);
  doorPanel.castShadow=true; g.add(doorPanel);

  const splitLine=new THREE.Mesh(new THREE.BoxGeometry(0.025*s,dH*0.94,0.1*s),orangeDark);
  splitLine.position.set(0,dH*0.52,wR*1.09); g.add(splitLine);

  for(let i=0;i<4;i++){
    const band=new THREE.Mesh(new THREE.BoxGeometry(dW*1.05,0.045*s,0.1*s),orangeDark);
    band.position.set(0,(0.22+i*0.33)*s,wR*1.09); g.add(band);
  }

  [-dW*0.35,dW*0.35].forEach(hx=>{
    const knob=new THREE.Mesh(new THREE.SphereGeometry(0.06*s,10,8),brass);
    knob.position.set(hx,dH*0.55,wR*1.12); g.add(knob);
  });

  const thresh=new THREE.Mesh(new THREE.BoxGeometry(dW*1.4,0.08*s,0.4*s),darkWood);
  thresh.position.set(0,0.04*s,wR*1.12); g.add(thresh);

  const sk=new THREE.Mesh(new THREE.CylinderGeometry(wR*1.07,wR*1.14,0.1*s,40),matPhong(0x556B2F));
  sk.position.y=0.05*s; g.add(sk);

  const ropeCount=6;
  for(let i=0;i<ropeCount;i++){
    const a=(Math.PI*2/ropeCount)*i+0.4;
    if(Math.abs(Math.sin(a))<0.15&&Math.cos(a)>0) continue;
    const stakeR=wR*1.45;
    const sx=Math.cos(a)*stakeR, sz=Math.sin(a)*stakeR;
    const topY=wH+rH*0.05;
    const dx=sx, dz=sz, dy=-topY+0.15*s;
    const len=Math.sqrt(dx*dx+dz*dz+dy*dy);
    const rp=new THREE.Mesh(new THREE.CylinderGeometry(0.02*s,0.02*s,len,6),rope);
    rp.position.set(sx*0.5,topY*0.5+0.075*s,sz*0.5);

    const dir=new THREE.Vector3(dx,dy,dz).normalize();
    const up=new THREE.Vector3(0,1,0);
    const q=new THREE.Quaternion().setFromUnitVectors(up,dir);
    rp.quaternion.copy(q);
    g.add(rp);

    const stake=new THREE.Mesh(new THREE.CylinderGeometry(0.05*s,0.02*s,0.25*s,6),darkWood);
    stake.position.set(sx,0.12*s,sz); g.add(stake);
  }

  g.position.set(x,Math.max(H(x,z),0),z);
  g.rotation.y=rot||0;
  scene.add(g);
}

function createFence(cx,cz,r){
  const pg=new THREE.CylinderGeometry(0.07,0.07,1.4,6);
  const pm=matPhong(0x8B7355);
  const railM=matPhong(0xA08865);
  let prevX=null,prevZ=null,prevY=null;
  for(let a=0;a<Math.PI*2;a+=Math.PI/9){
    if(a>1.3&&a<1.85){prevX=null;continue}
    const px=cx+Math.cos(a)*r,pz=cz+Math.sin(a)*r;
    const py=Math.max(H(px,pz),0);
    const post=new THREE.Mesh(pg,pm);
    post.position.set(px,0.7+py,pz);
    post.castShadow=true; scene.add(post);
    if(prevX!==null){

      const dx=px-prevX, dz=pz-prevZ;
      const len=Math.sqrt(dx*dx+dz*dz);
      for(let h=0;h<2;h++){
        const rail=new THREE.Mesh(new THREE.BoxGeometry(len,0.06,0.08),railM);
        rail.position.set((px+prevX)/2,(0.5+h*0.55)+(py+prevY)/2,(pz+prevZ)/2);
        rail.rotation.y=-Math.atan2(dz,dx);
        scene.add(rail);
      }
    }
    prevX=px;prevZ=pz;prevY=py;
  }
}

function createCampfire(x,z){
  const g=new THREE.Group();
  const stoneM=matPhong(0x6B6B6B);

  for(let i=0;i<8;i++){
    const a=(Math.PI*2/8)*i;
    const s=new THREE.Mesh(new THREE.DodecahedronGeometry(0.28,0),stoneM);
    s.position.set(Math.cos(a)*0.8,0.2,Math.sin(a)*0.8);
    s.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI);
    s.castShadow=true; g.add(s);
  }

  const ash=new THREE.Mesh(new THREE.CircleGeometry(0.75,20),matPhong(0x1A1612));
  ash.rotation.x=-Math.PI/2; ash.position.y=0.02; g.add(ash);

  const logM=matPhong(0x3A2010);
  for(let i=0;i<3;i++){
    const l=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.09,0.9,8),logM);
    l.rotation.z=Math.PI/2;
    l.rotation.y=(Math.PI/3)*i;
    l.position.set(Math.cos(i)*0.1,0.1,Math.sin(i)*0.1);
    g.add(l);
  }
  g.position.set(x,Math.max(H(x,z),0),z);
  scene.add(g);
}

function createHorse(x,z,rot,color){
  const g=new THREE.Group();
  const body=matPhong(color||0x6B3A2A,{shininess:12,specular:0x221510});
  const darkMat=matPhong(0x0D0D0D);
  const hoofMat=matPhong(0x1A1410);
  const muzzleMat=matPhong(0x3A2015);
  const maneMat=new THREE.MeshPhongMaterial({color:0x0D0808,side:THREE.DoubleSide,shininess:5});
  const eyeWhiteMat=matPhong(0xE8E2D0,{shininess:20});

  const torso=makeCapsule(0.58,1.3,body);
  torso.rotation.z=Math.PI/2;
  torso.position.y=1.55;
  g.add(torso);

  const chest=new THREE.Mesh(new THREE.SphereGeometry(0.58,14,10),body);
  chest.position.set(0.82,1.55,0);
  chest.scale.set(0.85,0.95,1.0);
  chest.castShadow=true; g.add(chest);

  const withers=new THREE.Mesh(new THREE.SphereGeometry(0.42,12,8),body);
  withers.position.set(0.45,1.92,0);
  withers.scale.set(1.3,0.45,0.85); g.add(withers);

  const haunch=new THREE.Mesh(new THREE.SphereGeometry(0.58,14,10),body);
  haunch.position.set(-0.85,1.62,0);
  haunch.scale.set(0.95,1.0,1.0);
  haunch.castShadow=true; g.add(haunch);

  const belly=new THREE.Mesh(new THREE.SphereGeometry(0.5,12,8),body);
  belly.position.set(0,1.35,0); belly.scale.set(1.4,0.7,1.0); g.add(belly);

  const neck=new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.35,1.15,12),body);
  neck.position.set(1.18,2.1,0);
  neck.rotation.z=-0.55;
  neck.castShadow=true; g.add(neck);

  const neckBase=new THREE.Mesh(new THREE.SphereGeometry(0.35,10,8),body);
  neckBase.position.set(0.98,1.78,0); g.add(neckBase);

  const headGrp=new THREE.Group();
  const head=new THREE.Mesh(new THREE.BoxGeometry(0.55,0.42,0.36),body);
  head.position.set(0.28,0,0); head.castShadow=true; headGrp.add(head);

  [0.14,-0.14].forEach(zz=>{
    const cheek=new THREE.Mesh(new THREE.SphereGeometry(0.18,8,6),body);
    cheek.position.set(0.2,-0.05,zz); cheek.scale.set(1.1,0.8,0.8); headGrp.add(cheek);
  });

  const muzzle=new THREE.Mesh(new THREE.CylinderGeometry(0.17,0.13,0.32,10),muzzleMat);
  muzzle.position.set(0.62,-0.12,0); muzzle.rotation.z=Math.PI/2+0.25; headGrp.add(muzzle);

  const muzzleTip=new THREE.Mesh(new THREE.SphereGeometry(0.13,8,6),muzzleMat);
  muzzleTip.position.set(0.75,-0.18,0); muzzleTip.scale.set(1.1,0.9,1.0); headGrp.add(muzzleTip);

  [0.06,-0.06].forEach(zz=>{
    const nos=new THREE.Mesh(new THREE.SphereGeometry(0.035,6,5),darkMat);
    nos.position.set(0.82,-0.14,zz); nos.scale.set(0.7,1.0,1.0); headGrp.add(nos);
  });

  const mouth=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.025,0.13),darkMat);
  mouth.position.set(0.84,-0.22,0); headGrp.add(mouth);

  [0.18,-0.18].forEach(zz=>{
    const ew=new THREE.Mesh(new THREE.SphereGeometry(0.07,10,8),eyeWhiteMat);
    ew.position.set(0.1,0.1,zz); ew.scale.set(0.85,1.0,0.9); headGrp.add(ew);
    const pup=new THREE.Mesh(new THREE.SphereGeometry(0.05,10,8),darkMat);
    pup.position.set(0.15,0.1,zz); headGrp.add(pup);
  });

  [0.13,-0.13].forEach(zz=>{
    const ear=new THREE.Mesh(new THREE.ConeGeometry(0.07,0.24,6),body);
    ear.position.set(-0.1,0.38,zz);
    ear.rotation.z=-0.2;
    headGrp.add(ear);

    const innerEar=new THREE.Mesh(new THREE.ConeGeometry(0.04,0.18,5),muzzleMat);
    innerEar.position.set(-0.08,0.36,zz);
    innerEar.rotation.z=-0.2;
    headGrp.add(innerEar);
  });

  for(let i=0;i<8;i++){
    const fl=new THREE.Mesh(new THREE.PlaneGeometry(0.07,0.18),maneMat);
    fl.position.set(-0.05+(Math.random()-0.5)*0.06,0.35,(Math.random()-0.5)*0.2);
    fl.rotation.z=0.3+(Math.random()-0.5)*0.3;
    fl.rotation.y=(Math.random()-0.5)*0.4;
    headGrp.add(fl);
  }

  headGrp.position.set(1.55,2.7,0);
  headGrp.rotation.z=-0.15;
  g.add(headGrp);

  for(let i=0;i<24;i++){
    const t=i/23;
    const strand=new THREE.Mesh(new THREE.PlaneGeometry(0.08,0.3+Math.random()*0.2),maneMat);
    const sx=1.5-t*0.85, sy=2.55-t*0.5;
    strand.position.set(sx+(Math.random()-0.5)*0.04,sy+(Math.random()-0.5)*0.06,(Math.random()-0.5)*0.12);
    strand.rotation.z=-0.45+(Math.random()-0.5)*0.35;
    strand.rotation.y=(Math.random()-0.5)*0.5;
    g.add(strand);
  }

  function makeLeg(lx,lz){

    const thigh=new THREE.Mesh(new THREE.CylinderGeometry(0.13,0.1,0.6,10),body);
    thigh.position.set(lx,1.08,lz); thigh.castShadow=true; g.add(thigh);

    const knee=new THREE.Mesh(new THREE.SphereGeometry(0.1,10,8),body);
    knee.position.set(lx,0.76,lz); g.add(knee);

    const shin=new THREE.Mesh(new THREE.CylinderGeometry(0.085,0.07,0.65,10),body);
    shin.position.set(lx,0.42,lz); shin.castShadow=true; g.add(shin);

    const fetlock=new THREE.Mesh(new THREE.SphereGeometry(0.09,8,6),body);
    fetlock.position.set(lx,0.12,lz); g.add(fetlock);

    const hoof=new THREE.Mesh(new THREE.CylinderGeometry(0.085,0.1,0.13,10),hoofMat);
    hoof.position.set(lx,0.065,lz); g.add(hoof);
  }
  makeLeg(0.72,0.23);
  makeLeg(0.72,-0.23);
  makeLeg(-0.82,0.25);
  makeLeg(-0.82,-0.25);

  const tailBase=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.06,0.35,8),body);
  tailBase.position.set(-1.42,1.55,0); tailBase.rotation.z=0.7; g.add(tailBase);

  for(let i=0;i<26;i++){
    const hair=new THREE.Mesh(new THREE.PlaneGeometry(0.07,0.55+Math.random()*0.35),maneMat);
    hair.position.set(-1.55+(Math.random()-0.5)*0.1,1.25-Math.random()*0.5,(Math.random()-0.5)*0.28);
    hair.rotation.z=0.55+(Math.random()-0.5)*0.35;
    hair.rotation.y=(Math.random()-0.5)*0.7;
    g.add(hair);
  }

  g.scale.setScalar(0.85);
  g.position.set(x,Math.max(H(x,z),0),z);
  g.rotation.y=rot||0;
  scene.add(g); animals.push(g);
}

function createHorses(){
  createHorse(-6,5,0.8,0x6B3A2A);
  createHorse(-3,7,1.2,0x8B5A3A);
  createHorse(-8,8,0.3,0x222222);
  createHorse(18,-18,-0.5,0xE8DCC0);
  createHorse(15,-16,-0.8,0x996633);
}

function createSheep(x,z){
  const g=new THREE.Group();
  const wool=matPhong(0xF4F0E4,{shininess:1,specular:0x080808});
  const wool2=matPhong(0xE8E2D0,{shininess:1,specular:0x080808});
  const darkWool=matPhong(0x2A2520);
  const headMat=matPhong(0x1A1612);
  const hoofMat=matPhong(0x0D0D0D);
  const noseMat=matPhong(0x1A0E08);

  const core=new THREE.Mesh(new THREE.SphereGeometry(0.48,14,10),wool);
  core.scale.set(1.2,0.95,0.95); core.position.y=0.72;
  core.castShadow=true; g.add(core);

  const bumpCount=34;
  for(let i=0;i<bumpCount;i++){
    const theta=Math.random()*Math.PI*2;
    const phi=Math.acos(2*Math.random()-1);
    const r=0.43+Math.random()*0.10;
    const bx=Math.sin(phi)*Math.cos(theta)*r*1.2;
    const by=Math.cos(phi)*r*0.95+0.72;
    const bz=Math.sin(phi)*Math.sin(theta)*r*0.95;
    if(bx>0.3&&Math.abs(bz)<0.25&&by<0.8) continue;

    const bumpSize=0.13+Math.random()*0.10;
    const bump=new THREE.Mesh(new THREE.SphereGeometry(bumpSize,7,5),Math.random()>0.5?wool:wool2);
    bump.position.set(bx,by,bz);
    bump.castShadow=true; g.add(bump);
  }

  const head=new THREE.Mesh(new THREE.SphereGeometry(0.18,12,10),headMat);
  head.scale.set(1.2,1.0,0.92);
  head.position.set(0.6,0.7,0); g.add(head);

  const headFluff=new THREE.Mesh(new THREE.SphereGeometry(0.14,8,6),wool);
  headFluff.position.set(0.52,0.87,0); g.add(headFluff);
  for(let i=0;i<5;i++){
    const a=(Math.PI*2/5)*i;
    const f=new THREE.Mesh(new THREE.SphereGeometry(0.08,6,5),wool);
    f.position.set(0.48+Math.cos(a)*0.1,0.9+Math.sin(a)*0.04,Math.sin(a)*0.08);
    g.add(f);
  }

  const snout=new THREE.Mesh(new THREE.ConeGeometry(0.1,0.18,8),headMat);
  snout.position.set(0.8,0.64,0); snout.rotation.z=-Math.PI/2; g.add(snout);

  const nose=new THREE.Mesh(new THREE.SphereGeometry(0.045,8,6),noseMat);
  nose.position.set(0.88,0.63,0); g.add(nose);

  [0.08,-0.08].forEach(zz=>{
    const eye=new THREE.Mesh(new THREE.SphereGeometry(0.028,6,5),matPhong(0x000000));
    eye.position.set(0.7,0.76,zz); g.add(eye);
  });

  [0.16,-0.16].forEach(zz=>{
    const ear=new THREE.Mesh(new THREE.BoxGeometry(0.04,0.14,0.08),headMat);
    ear.position.set(0.55,0.8,zz);
    ear.rotation.z=0.5; ear.rotation.x=(zz>0?-1:1)*0.2;
    g.add(ear);
  });

  [[0.23,0.14,0.5],[0.23,-0.14,0.5],[-0.25,0.14,0.5],[-0.25,-0.14,0.5]].forEach(([lx,lz,lh])=>{
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.035,lh,6),darkWool);
    leg.position.set(lx,lh/2+0.05,lz); leg.castShadow=true; g.add(leg);
    const hoof=new THREE.Mesh(new THREE.CylinderGeometry(0.045,0.04,0.05,6),hoofMat);
    hoof.position.set(lx,0.025,lz); g.add(hoof);
  });

  const tail=new THREE.Mesh(new THREE.SphereGeometry(0.14,8,6),wool);
  tail.position.set(-0.52,0.75,0); g.add(tail);

  g.position.set(x,Math.max(H(x,z),0),z);
  g.rotation.y=Math.random()*Math.PI*2;
  scene.add(g); animals.push(g);
}

function createSheepFlock(){
  const cx=30,cz=15;
  for(let i=0;i<14;i++){
    const a=Math.random()*Math.PI*2,r=Math.random()*7+2;
    createSheep(cx+Math.cos(a)*r,cz+Math.sin(a)*r);
  }
  for(let i=0;i<6;i++) createSheep(-20+Math.random()*7,8+Math.random()*6);
}

function createDog(x,z,rot){
  const g=new THREE.Group();
  const fur=matPhong(0x3A2515);
  const lightFur=matPhong(0xD4A070);
  const darkFur=matPhong(0x1A0E08);
  const pink=matPhong(0xBB6D6D);

  const body=makeCapsule(0.22,0.5,fur);
  body.rotation.z=Math.PI/2;
  body.position.y=0.58; g.add(body);

  const chest=new THREE.Mesh(new THREE.SphereGeometry(0.18,8,6),lightFur);
  chest.position.set(0.3,0.55,0); chest.scale.set(0.9,0.8,1.0); g.add(chest);

  const head=new THREE.Mesh(new THREE.SphereGeometry(0.2,10,8),fur);
  head.position.set(0.52,0.78,0); head.scale.set(1.0,0.9,0.9); g.add(head);

  const snout=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.08,0.2,8),fur);
  snout.rotation.z=Math.PI/2; snout.position.set(0.7,0.72,0); g.add(snout);

  const nose=new THREE.Mesh(new THREE.SphereGeometry(0.04,6,5),darkFur);
  nose.position.set(0.8,0.72,0); g.add(nose);

  [0.08,-0.08].forEach(zz=>{
    const spot=new THREE.Mesh(new THREE.SphereGeometry(0.05,6,5),lightFur);
    spot.position.set(0.45,0.88,zz); spot.scale.set(0.7,0.5,1.0); g.add(spot);
    const eye=new THREE.Mesh(new THREE.SphereGeometry(0.025,6,5),darkFur);
    eye.position.set(0.53,0.82,zz); g.add(eye);
  });

  const tongue=new THREE.Mesh(new THREE.BoxGeometry(0.08,0.02,0.05),pink);
  tongue.position.set(0.82,0.65,0); g.add(tongue);

  [0.14,-0.14].forEach(zz=>{
    const ear=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.12,0.08),fur);
    ear.position.set(0.44,0.82,zz);
    ear.rotation.z=0.6; ear.rotation.x=(zz>0?-1:1)*0.3;
    g.add(ear);
  });

  [[0.32,0.13],[0.32,-0.13],[-0.25,0.13],[-0.25,-0.13]].forEach(([lx,lz])=>{
    const leg=new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.05,0.45,8),fur);
    leg.position.set(lx,0.27,lz); leg.castShadow=true; g.add(leg);
    const paw=new THREE.Mesh(new THREE.SphereGeometry(0.06,6,5),darkFur);
    paw.position.set(lx,0.05,lz); paw.scale.set(1.2,0.6,1.0); g.add(paw);
  });

  for(let i=0;i<5;i++){
    const t=i/4;
    const seg=new THREE.Mesh(new THREE.SphereGeometry(0.08-t*0.02,6,5),fur);
    const angle=t*Math.PI;
    seg.position.set(-0.42-Math.sin(angle)*0.15,0.75+Math.cos(angle)*0.25,0);
    g.add(seg);
  }

  g.position.set(x,Math.max(H(x,z),0),z);
  g.rotation.y=rot||0;
  scene.add(g); animals.push(g);
}

function createGrass(){

  const bladeShape=new THREE.Shape();
  bladeShape.moveTo(-0.05,0);
  bladeShape.lineTo(-0.02,0.8);
  bladeShape.lineTo(0,1.0);
  bladeShape.lineTo(0.02,0.8);
  bladeShape.lineTo(0.05,0);
  const bg=new THREE.ShapeGeometry(bladeShape);
  const bm=new THREE.MeshPhongMaterial({color:0x6B8E3A,side:THREE.DoubleSide,transparent:true,opacity:0.85,shininess:0});
  const N=9000;grassMesh=new THREE.InstancedMesh(bg,bm,N);
  const dum=new THREE.Object3D();
  let placed=0;
  const clumps=160;

  for(let c=0;c<clumps && placed<N;c++){
    const cx=(Math.random()-0.5)*200, cz=(Math.random()-0.5)*200;
    const clumpCount=30+Math.floor(Math.random()*30);
    for(let i=0;i<clumpCount && placed<N;i++){
      const r=Math.random()*2.5;
      const a=Math.random()*Math.PI*2;
      const x=cx+Math.cos(a)*r, z=cz+Math.sin(a)*r;
      if(Math.hypot(x-8,z+8)<7||Math.hypot(x+14,z+2)<6||Math.hypot(x-24,z-6)<5||Math.hypot(x-4,z+4)<1.3) continue;
      dum.position.set(x,Math.max(H(x,z),0),z);
      dum.rotation.y=Math.random()*Math.PI;
      dum.rotation.x=(Math.random()-0.5)*0.25;
      dum.scale.setScalar(0.5+Math.random()*0.9);
      dum.updateMatrix();
      grassMesh.setMatrixAt(placed,dum.matrix);
      placed++;
    }
  }
  grassMesh.count=placed;
  scene.add(grassMesh);
}

function createFlowers(){
  const colors=[0xE8C04F,0xC04050,0xAE60D0,0xE0E0E0,0xFF8848];
  colors.forEach(col=>{
    const petal=new THREE.ConeGeometry(0.05,0.15,5);
    const mat=new THREE.MeshPhongMaterial({color:col,side:THREE.DoubleSide,shininess:5});
    const N=120;
    const inst=new THREE.InstancedMesh(petal,mat,N);
    const dum=new THREE.Object3D();
    let placed=0;
    for(let i=0;i<N*4 && placed<N;i++){
      const x=(Math.random()-0.5)*180, z=(Math.random()-0.5)*180;
      if(Math.hypot(x-8,z+8)<8||Math.hypot(x+14,z+2)<7||Math.hypot(x-24,z-6)<6) continue;
      dum.position.set(x,Math.max(H(x,z),0)+0.15,z);
      dum.rotation.set(0,Math.random()*Math.PI,(Math.random()-0.5)*0.2);
      dum.scale.setScalar(0.8+Math.random()*0.6);
      dum.updateMatrix();
      inst.setMatrixAt(placed,dum.matrix);
      placed++;
    }
    inst.count=placed;
    scene.add(inst);
  });
}

function createRocks(){
  const rockG=new THREE.DodecahedronGeometry(1,0);
  const rockM=matPhong(0x707070);
  const N=40;
  const inst=new THREE.InstancedMesh(rockG,rockM,N);
  inst.castShadow=true; inst.receiveShadow=true;
  const dum=new THREE.Object3D();
  let placed=0;
  for(let i=0;i<N*2 && placed<N;i++){
    const x=(Math.random()-0.5)*160, z=(Math.random()-0.5)*160;
    if(Math.hypot(x-8,z+8)<10||Math.hypot(x+14,z+2)<8||Math.hypot(x-24,z-6)<7) continue;
    dum.position.set(x,Math.max(H(x,z),0)+0.1,z);
    dum.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI);
    const s=0.3+Math.random()*0.8;
    dum.scale.set(s,s*(0.5+Math.random()*0.5),s);
    dum.updateMatrix();
    inst.setMatrixAt(placed,dum.matrix);
    placed++;
  }
  inst.count=placed;
  scene.add(inst);
}

function mkP(n,color,size){
  const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(n*3);
  for(let i=0;i<n*3;i+=3){pos[i]=(Math.random()-.5)*200;pos[i+1]=Math.random()*80;pos[i+2]=(Math.random()-.5)*200}
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  const mat=new THREE.PointsMaterial({size,color,transparent:true,opacity:0.7,depthWrite:false});
  const pts=new THREE.Points(geo,mat);pts.visible=false;scene.add(pts);
  return{mesh:pts,mat,geo};
}
function createAllParticles(){
  rainP=mkP(5000,0x6688AA,0.15);snowP=mkP(3000,0xFFFFFF,0.5);dustP=mkP(4000,0xD4A84B,0.6);
}

function setWeather(st){
  currentWeather=st;
  rainP.mesh.visible=snowP.mesh.visible=dustP.mesh.visible=false;
  switch(st){
    case W.NAR:
      targetSky.set(0x4CACEB);targetFog.set(0x6BBEEF);targetAmb.set(0x8899AA);
      sunLight.intensity=1.6;sunLight.color.set(0xFFEECC);
      ambientLight.intensity=0.55;hemiLight.intensity=0.7;
      scene.fog.density=0.003;renderer.toneMappingExposure=1.2;cameraShake=0;break;
    case W.BOROO:
      targetSky.set(0x2A2A3A);targetFog.set(0x3A3A4A);targetAmb.set(0x445566);
      sunLight.intensity=0.15;sunLight.color.set(0xAABBCC);
      ambientLight.intensity=0.35;hemiLight.intensity=0.3;
      scene.fog.density=0.014;renderer.toneMappingExposure=0.7;
      rainP.mesh.visible=true;cameraShake=0;break;
    case W.SALHI:
      targetSky.set(0xB89050);targetFog.set(0xAA8040);targetAmb.set(0x887755);
      sunLight.intensity=0.5;sunLight.color.set(0xDDCC88);
      ambientLight.intensity=0.45;hemiLight.intensity=0.4;
      scene.fog.density=0.02;renderer.toneMappingExposure=0.85;
      dustP.mesh.visible=true;cameraShake=0.4;break;
    case W.TSAS:
      targetSky.set(0xAABBCC);targetFog.set(0xBBCCDD);targetAmb.set(0x99AACC);
      sunLight.intensity=0.35;sunLight.color.set(0xCCCCEE);
      ambientLight.intensity=0.55;hemiLight.intensity=0.5;
      scene.fog.density=0.009;renderer.toneMappingExposure=0.9;
      snowP.mesh.visible=true;cameraShake=0;break;
  }
  document.getElementById('hud').className=WCLS[st]||'';
}

function animate(){
  requestAnimationFrame(animate);
  if(document.hidden) return;
  const rawDt=clock.getDelta();
  const dt=Math.min(rawDt,0.05);
  const t=clock.getElapsedTime();

  scene.background.lerp(targetSky,dt*1.5);
  scene.fog.color.lerp(targetFog,dt*1.5);
  ambientLight.color.lerp(targetAmb,dt*1.5);

  if(cloudsGroup){
    cloudsGroup.children.forEach((c,i)=>{
      c.position.x+=(0.02+(i%3)*0.01);
      if(c.position.x>160) c.position.x=-160;
    });
  }

  if(rainP.mesh.visible){
    const p=rainP.geo.attributes.position.array;
    for(let i=0;i<p.length;i+=3){p[i+1]-=2.0+Math.random()*0.5;p[i]+=0.3;
      if(p[i+1]<-2){p[i+1]=80;p[i]=(Math.random()-.5)*200}}
    rainP.geo.attributes.position.needsUpdate=true;
  }
  if(snowP.mesh.visible){
    const p=snowP.geo.attributes.position.array;
    for(let i=0;i<p.length;i+=3){p[i+1]-=0.18+Math.random()*0.08;
      p[i]+=Math.sin(t*0.5+i*0.01)*0.06;p[i+2]+=Math.cos(t*0.3+i*0.007)*0.04;
      if(p[i+1]<-1)p[i+1]=80}
    snowP.geo.attributes.position.needsUpdate=true;
  }
  if(dustP.mesh.visible){
    const p=dustP.geo.attributes.position.array;
    for(let i=0;i<p.length;i+=3){p[i]+=3.0+Math.random()*1.5;
      p[i+1]+=(Math.random()-.5)*1.2;p[i+2]+=(Math.random()-.5)*0.8;
      if(p[i]>100){p[i]=-100;p[i+1]=Math.random()*40}}
    dustP.geo.attributes.position.needsUpdate=true;
  }

  const R=58;
  const bx=Math.sin(t*0.05)*R,bz=Math.cos(t*0.05)*R,by=20+Math.sin(t*0.08)*3;
  camera.position.set(bx+cameraShake*(Math.random()-.5)*.5,
    by+cameraShake*(Math.random()-.5)*.3,bz);
  camera.lookAt(0,3,0);
  renderer.render(scene,camera);
}

const mLog=[];
function addLog(c,t){mLog.push({c,t});if(mLog.length>50)mLog.shift();
  const el=document.getElementById('monitor-log');
  el.innerHTML=mLog.map(l=>'<div class="log-line '+l.c+'">'+l.t+'</div>').join('');
  el.scrollTop=el.scrollHeight}
function hex(dv,s,n){const b=[];for(let i=s;i<s+n&&i<dv.byteLength;i++)b.push(dv.getUint8(i).toString(16).padStart(2,'0'));return b.join(' ')}

function updateHistory(st){
  weatherHistory.push(st);if(weatherHistory.length>40)weatherHistory.shift();
  document.getElementById('history').innerHTML=weatherHistory.map(s=>
    '<div class="hist-dot hist-'+WCLS[s]+'"></div>').join('');
}

function connectWS(){
  const stEl=document.getElementById('status');
  const ws=new WebSocket('/ws');
  ws.binaryType='arraybuffer';
  activeWS=ws;

  ws.onopen=()=>{
    stEl.textContent='\u0425\u041E\u041B\u0411\u041E\u0413\u0414\u0421\u041E\u041D';stEl.className='connected';
    addLog('log-hex','>> CONNECTED');
    const buf=new ArrayBuffer(13),v=new DataView(buf);
    v.setUint16(0,MAGIC);v.setUint8(2,MSG_HELLO);v.setUint16(3,8);
    new Uint8Array(buf,5).set(new TextEncoder().encode('ARANSHIN'));
    ws.send(buf);addLog('log-hex','>> TX: aa 55 01 00 08 [HELLO]');
  };

  ws.onmessage=evt=>{
    const dv=new DataView(evt.data);
    if(dv.byteLength<5||dv.getUint16(0)!==MAGIC)return;
    const type=dv.getUint8(2);
    if(type===MSG_HELLO){
      const len=dv.getUint16(3);
      const banner=new TextDecoder().decode(new Uint8Array(evt.data,5,len));
      addLog('log-hex','<< RX: '+hex(dv,0,5+len)+' ['+banner+']');
      return;
    }
    if(type===MSG_FLAG){
      const len=dv.getUint16(3);
      addLog('log-key','<< RX header: '+hex(dv,0,5));
      addLog('log-key','   \uD83D\uDD12 ENCRYPTED FLAG ('+len+' bytes) = IV[16] + CT['+(len-16)+']');
      addLog('log-key','   IV : '+hex(dv,5,16));
      addLog('log-key','   CT : '+hex(dv,21,len-16));
      addLog('log-key','   \u26A0 AES-128-CBC \u2014 16-byte key required');
      return;
    }
    if(type===MSG_BROADCAST||type===MSG_WEATHER){
      const st=dv.getUint8(5),temp=dv.getInt16(6),wind=dv.getUint16(8);
      tickCount++;
      document.getElementById('weather-icon').textContent=ICONS[st]||'?';
      document.getElementById('weather-name').textContent=WNAMES[st]||'???';
      document.getElementById('temp').textContent=temp+'\u00B0C';
      document.getElementById('wind').textContent=wind+' \u043A\u043C/\u0446';
      document.getElementById('tick').textContent=tickCount;
      addLog('log-'+WCLS[st],'<< RX: '+hex(dv,0,dv.byteLength));
      if(st===W.SALHI&&dv.byteLength>10)
        addLog('log-salhi','   \u26A0 \u0421\u0410\u041B\u0425\u0418 extra: '+hex(dv,10,Math.min(dv.byteLength-10,14)));
      if(st===W.TSAS&&dv.byteLength>=14)
        addLog('log-tsas','   \u2744 \u0426\u0410\u0421 frozen: '+hex(dv,10,4));
      addLog('log-'+WCLS[st],'   #'+tickCount+' '+WNAMES[st]+' | '+temp+'\u00B0C | wind:'+wind);
      setWeather(st);updateHistory(st);
    }
  };
  ws.onclose=()=>{stEl.textContent='\u0421\u0410\u041B\u0421\u0410\u041D...';stEl.className='error';
    activeWS=null;addLog('log-hex','>> DISCONNECTED');setTimeout(connectWS,3000)};
  ws.onerror=()=>{stEl.textContent='\u0410\u041B\u0414\u0410\u0410';stEl.className='error'};
}

function requestFlag(){
  if(!activeWS||activeWS.readyState!==1){
    addLog('log-hex','>> FLAG request failed: not connected');
    return;
  }
  const buf=new ArrayBuffer(5),v=new DataView(buf);
  v.setUint16(0,MAGIC);v.setUint8(2,MSG_FLAG);v.setUint16(3,0);
  activeWS.send(buf);
  addLog('log-key','>> TX: aa 55 03 00 00 [GET_FLAG]');
}

init();connectWS();animate();
