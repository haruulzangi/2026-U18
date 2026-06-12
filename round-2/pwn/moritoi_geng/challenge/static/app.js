'use strict';

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10142a);
scene.fog = new THREE.Fog(0x10142a, 20, 70);

const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.1, 180
);
camera.position.set(0, 7, 18);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0x6a6a88, 0.6));
const sun = new THREE.DirectionalLight(0xffecc8, 1.0);
sun.position.set(12, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 20;
sun.shadow.camera.bottom = -20;
scene.add(sun);

const rim = new THREE.DirectionalLight(0x6688ff, 0.3);
rim.position.set(-8, 5, -12);
scene.add(rim);

const groundMat = new THREE.MeshStandardMaterial({
  color: 0x3c4a2a, roughness: 0.95, metalness: 0.0,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140, 32, 32), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.55;
ground.receiveShadow = true;
const gPos = ground.geometry.attributes.position;
for (let i = 0; i < gPos.count; i++) {
  const x = gPos.getX(i), y = gPos.getY(i);
  const d = Math.sqrt(x * x + y * y);
  if (d > 10) {
    gPos.setZ(i, Math.sin(x * 0.18) * Math.cos(y * 0.18) * 1.2 + Math.random() * 0.3);
  }
}
gPos.needsUpdate = true;
ground.geometry.computeVertexNormals();
scene.add(ground);

for (let i = 0; i < 10; i++) {
  const h = 5 + Math.random() * 4;
  const r = 4 + Math.random() * 2.5;
  const mt = new THREE.Mesh(
    new THREE.ConeGeometry(r, h, 4 + (i % 2)),
    new THREE.MeshStandardMaterial({ color: 0x3a3858, flatShading: true, roughness: 1.0 })
  );
  const a = (i / 10) * Math.PI * 2 + 0.3;
  mt.position.set(Math.cos(a) * 35, h / 2 - 0.5, Math.sin(a) * 35);
  mt.rotation.y = Math.random() * Math.PI;
  scene.add(mt);
}

const ger = new THREE.Group();
const gerBody = new THREE.Mesh(
  new THREE.CylinderGeometry(1.4, 1.4, 1.8, 16),
  new THREE.MeshStandardMaterial({ color: 0xe0d2a6, roughness: 0.9 })
);
gerBody.castShadow = true;
const gerRoof = new THREE.Mesh(
  new THREE.ConeGeometry(1.7, 1.2, 16),
  new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 })
);
gerRoof.position.y = 1.5;
gerRoof.castShadow = true;
ger.add(gerBody, gerRoof);
ger.position.set(-14, 0.4, -14);
scene.add(ger);

const TRACK_LEN_UNITS = 24;
const TRACK_WORLD = 13;
const TRACK_OFFSET_X = 4;
const LANE_WIDTH = 1.0;

const HORSE_IDS = ['Чи', 'Алтай', 'Хангай', 'Онон', 'Говь'];
const HORSE_COLORS = {
  'Чи':     0xffd733,
  'Алтай':  0xff5555,
  'Хангай': 0x55ccff,
  'Онон':   0x88ff88,
  'Говь':   0xcc88ff,
};
const HORSE_COATS = {
  'Чи':     0x6a3a1c,
  'Алтай':  0x1a100a,
  'Хангай': 0xc9a878,
  'Онон':   0xdacfb9,
  'Говь':   0x8a4518,
};

const trackMat = new THREE.MeshStandardMaterial({
  color: 0x544a2c, roughness: 0.85,
});
const track = new THREE.Mesh(
  new THREE.PlaneGeometry(TRACK_WORLD + 4, HORSE_IDS.length * LANE_WIDTH + 1),
  trackMat
);
track.rotation.x = -Math.PI / 2;
track.position.set(TRACK_OFFSET_X, -0.52, 0);
track.receiveShadow = true;
scene.add(track);

for (let i = 0; i <= HORSE_IDS.length; i++) {
  const z = (i - HORSE_IDS.length / 2) * LANE_WIDTH;
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(TRACK_WORLD + 4, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0x332a10 })
  );
  line.rotation.x = -Math.PI / 2;
  line.position.set(TRACK_OFFSET_X, -0.51, z);
  scene.add(line);
}

function makePost(x, color) {
  const g = new THREE.Group();
  const p = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 4, 8),
    new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.4 })
  );
  p.position.y = 2;
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.55),
    new THREE.MeshStandardMaterial({ color: color, side: THREE.DoubleSide,
      emissive: color, emissiveIntensity: 0.3 })
  );
  flag.position.set(0.55, 3.3, 0);
  g.add(p, flag);
  g.position.x = x;
  scene.add(g);
  return g;
}
makePost(TRACK_OFFSET_X - TRACK_WORLD / 2, 0xffeecc);
makePost(TRACK_OFFSET_X + TRACK_WORLD / 2, 0xffd700);

const horses = {};

function makeHorse(id, laneIdx) {
  const g = new THREE.Group();
  const blanketColor = HORSE_COLORS[id];
  const coatColor = HORSE_COATS[id];
  const coat = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.72, metalness: 0.0 });
  const muzzleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(coatColor).multiplyScalar(0.55),
    roughness: 0.75,
  });
  const darkHair = new THREE.MeshStandardMaterial({ color: 0x0f0806, roughness: 0.95, side: THREE.DoubleSide });
  const hoofMat = new THREE.MeshStandardMaterial({ color: 0x1a130b, roughness: 0.8 });

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 1.2, 16),
    coat
  );
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.92;
  body.castShadow = true;

  const rump = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), coat);
  rump.position.set(-0.6, 0.95, 0);
  rump.scale.set(1, 1, 0.95);
  rump.castShadow = true;

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.38, 14, 12), coat);
  chest.position.set(0.55, 0.92, 0);
  chest.castShadow = true;

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.75, 12), coat);
  neck.position.set(0.82, 1.32, 0);
  neck.rotation.z = -0.55;
  neck.castShadow = true;

  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.26), coat);
  skull.position.set(0, 0, 0);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.3, 10), muzzleMat);
  muzzle.rotation.z = Math.PI / 2;
  muzzle.position.set(0.26, -0.03, 0);
  head.add(skull, muzzle);
  head.position.set(1.13, 1.66, 0);
  head.rotation.z = -0.25;
  head.castShadow = true;
  for (const zo of [-0.09, 0.09]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.15, 6), coat);
    ear.position.set(-0.06, 0.2, zo);
    head.add(ear);
  }
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.3 });
  for (const zo of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), eyeMat);
    eye.position.set(0.06, 0.07, zo);
    head.add(eye);
  }
  for (const zo of [-0.05, 0.05]) {
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), eyeMat);
    nose.position.set(0.4, -0.05, zo);
    head.add(nose);
  }

  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.26 + t * 0.08), darkHair);
    const nx = 0.35 + t * 0.7;
    const ny = 1.18 + t * 0.5;
    strip.position.set(nx, ny, 0);
    strip.rotation.z = -0.6 - t * 0.05;
    strip.rotation.y = i % 2 ? 0.1 : -0.1;
    g.add(strip);
  }
  const forelock = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.18), darkHair);
  forelock.position.set(1.08, 1.78, 0);
  forelock.rotation.z = -0.15;
  g.add(forelock);

  const tail = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.85), darkHair);
    s.position.set(0, -0.35, (i - 3) * 0.035);
    s.rotation.y = (i - 3) * 0.08;
    tail.add(s);
  }
  tail.position.set(-0.98, 0.95, 0);
  tail.rotation.z = 0.4;
  g.add(tail);

  const blanket = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.05, 0.5),
    new THREE.MeshStandardMaterial({
      color: blanketColor, emissive: blanketColor, emissiveIntensity: 0.2, roughness: 0.7,
    })
  );
  blanket.position.set(-0.05, 1.22, 0);
  g.add(blanket);
  const saddle = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a1f0f, roughness: 0.8 })
  );
  saddle.position.set(-0.05, 1.28, 0);
  saddle.scale.set(1, 0.5, 1);
  g.add(saddle);

  const legs = [];
  const legPos = [
    [ 0.55,  0.16],
    [ 0.55, -0.16],
    [-0.55,  0.16],
    [-0.55, -0.16],
  ];
  for (const [lx, lz] of legPos) {
    const leg = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.5, 8), coat);
    upper.position.y = -0.25;
    upper.castShadow = true;
    const lower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.055, 0.38, 8),
      new THREE.MeshStandardMaterial({ color: 0x080604, roughness: 0.9 })
    );
    lower.position.y = -0.68;
    lower.castShadow = true;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.075, 0.1, 10), hoofMat);
    h.position.y = -0.92;
    leg.add(upper, lower, h);
    leg.position.set(lx, 0.88, lz);
    g.add(leg);
    legs.push(leg);
  }

  g.add(body, rump, chest, neck, head);
  g.userData = {
    id, legs, tail,
    baseX: TRACK_OFFSET_X - TRACK_WORLD / 2,
    laneZ: (laneIdx - 2) * LANE_WIDTH,
  };
  g.position.set(g.userData.baseX, 0, g.userData.laneZ);
  scene.add(g);

  addNameTag(g, id, blanketColor);
  return g;
}

function addNameTag(parent, name, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(15,12,25,0.9)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 60);
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 32px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.scale.set(1.5, 0.38, 1);
  spr.position.set(0, 2.4, 0);
  parent.add(spr);
}

HORSE_IDS.forEach((id, i) => { horses[id] = makeHorse(id, i); });

function shagaiFaceCanvas(label, bg, fg) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#4a3';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 248, 248);
  ctx.fillStyle = fg;
  ctx.font = 'bold 52px "Courier New", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 128);
  return new THREE.CanvasTexture(cv);
}

const FACE_COLORS = {
  'Морь': ['#e7d9a0', '#1a0e06'],
  'Тэмээ': ['#caa872', '#2e160a'],
  'Хонь':  ['#e0d0b0', '#383'],
  'Ямаа':  ['#d0c4a0', '#723'],
};
function makeShagai() {
  const mats = ['Морь', 'Тэмээ', 'Хонь', 'Ямаа', 'Морь', 'Хонь'].map(f => {
    const [bg, fg] = FACE_COLORS[f];
    return new THREE.MeshStandardMaterial({
      map: shagaiFaceCanvas(f[0], bg, fg), roughness: 0.4, metalness: 0.1,
    });
  });
  return new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mats);
}

const shagais = [];
for (let i = 0; i < 4; i++) {
  const s = makeShagai();
  s.position.set(TRACK_OFFSET_X - 2.2 + i * 1.0, 0.9, -5);
  s.castShadow = true;
  shagais.push(s);
  scene.add(s);
}
let tumbleUntil = 0;

let ws;
let state = null;
let winnerShown = false;

function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    setStatus('ХОЛБОГДСОН', 'connected');
    ws.send(JSON.stringify({ op: 'HELLO' }));
  };
  ws.onclose = () => setStatus('ХОЛБОЛТ САЛСАН', 'error');
  ws.onerror = () => setStatus('АЛДАА', 'error');
  ws.onmessage = (e) => {
    try { handleMessage(JSON.parse(e.data)); } catch (_) {}
  };
}

function handleMessage(m) {
  if (m.type === 'init') {
    addLog('Наадам эхэллээ. ROLL-оор шагайгаа хая.', 'ok');
    if (m.stack) renderStack(m.stack, []);
  } else if (m.type === 'state' || m.type === 'track') {
    state = m;
    updateRace(m);
  } else if (m.type === 'roll') {
    tumbleUntil = performance.now() + 900;
    addLog(m.msg, 'ok');
    if (m.winner) {
      addLog(`★ Түрүүлсэн: ${m.winner}`, m.winner === 'Чи' ? 'khan' : 'ok');
    }
  } else if (m.type === 'cheer') {
    addLog('Засуул: ' + m.out, 'cheer');
    if (m.stack) renderStack(m.stack, m.accessed || []);
    if (m.flag) showFlag(m.flag);
  } else if (m.type === 'result') {
    addLog(m.msg, m.ok ? 'ok' : 'err');
  } else if (m.type === 'help') {
    addLog(m.text, 'ok');
  } else if (m.type === 'error') {
    addLog('Алдаа: ' + m.msg, 'err');
  }
}

function renderStack(stack, accessed) {
  const el = document.getElementById('stack-rows');
  if (!el || !stack) return;
  const hit = new Set(accessed || []);
  el.innerHTML = stack.map(s => {
    const cls = ['srow', s.kind, hit.has(s.slot) ? 'hit' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}">` +
      `<span class="sslot">%${s.slot}</span>` +
      `<span class="shex">${s.display}</span>` +
      `<span class="shint">${s.hint}</span>` +
    `</div>`;
  }).join('');
}

function updateRace(s) {
  const L = s.track_len || TRACK_LEN_UNITS;
  for (const id of HORSE_IDS) {
    const h = horses[id];
    if (!h) continue;
    const pos = (s.positions && s.positions[id]) || 0;
    const clamped = Math.min(pos, L);
    const target = TRACK_OFFSET_X - TRACK_WORLD / 2 + (clamped / L) * TRACK_WORLD;
    h.userData.targetX = target;
  }
  document.getElementById('round').textContent = s.round || 0;
  const yours = (s.positions && s.positions['Чи']) || 0;
  document.getElementById('ypos').textContent = yours + ' / ' + L;
  document.getElementById('bar-fill').style.width = Math.min(100, (yours / L) * 100) + '%';
  if (s.horse_name) document.getElementById('hname').textContent = s.horse_name;

  if (s.last_roll && s.last_roll.length) {
    document.getElementById('dice').textContent = s.last_roll.map(x => x[0]).join(' ');
  }
  const lb = document.getElementById('lb');
  lb.innerHTML = '';
  const sorted = HORSE_IDS.map(id => ({
    id, pos: (s.positions && s.positions[id]) || 0
  })).sort((a, b) => b.pos - a.pos);
  for (const row of sorted) {
    const el = document.createElement('div');
    el.className = 'lb-row' + (row.id === 'Чи' ? ' me' : '');
    el.innerHTML =
      `<span class="lb-name">${row.id}</span>` +
      `<span class="lb-bar"><span style="width:${Math.min(100, (row.pos / L) * 100)}%"></span></span>` +
      `<span class="lb-pos">${row.pos}</span>`;
    lb.appendChild(el);
  }
  if (s.winner && !winnerShown) {
    winnerShown = true;
    const w = document.getElementById('winner');
    w.textContent = s.winner === 'Чи' ? '★ ЧИ ТҮРҮҮЛЛЭЭ ★' : `Түрүүлсэн: ${s.winner}`;
    w.style.color = s.winner === 'Чи' ? '#ffd700' : '#ccc';
  }
}

function showFlag(flag) {
  const el = document.getElementById('flag-display');
  document.getElementById('flag-text').textContent = flag;
  el.classList.add('visible');
  addLog('🏁 FLAG: ' + flag, 'khan');
}

function addLog(msg, cls) {
  const log = document.getElementById('log');
  const line = document.createElement('div');
  line.className = 'log-line log-' + (cls || 'ok');
  line.textContent = '› ' + msg;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 50) log.removeChild(log.firstChild);
}

function setStatus(text, cls) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = cls || '';
}

function send(op, extra) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(Object.assign({ op }, extra || {})));
}
document.getElementById('btn-roll').onclick = () => send('ROLL');
document.getElementById('btn-track').onclick = () => send('TRACK');
document.getElementById('btn-name').onclick = () => {
  send('NAME', { value: document.getElementById('name-input').value });
};
document.getElementById('btn-cheer').onclick = () => {
  send('CHEER', { value: document.getElementById('cheer-input').value });
};
document.getElementById('cheer-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-cheer').click();
});
document.getElementById('name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-name').click();
});
document.getElementById('flag-display').onclick = (e) => {
  e.currentTarget.classList.remove('visible');
};

const clock = new THREE.Clock();
let lastUpdate = performance.now();

function animate() {
  const t = clock.getElapsedTime();
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastUpdate) / 1000);
  lastUpdate = now;

  if (now < tumbleUntil) {
    for (let i = 0; i < shagais.length; i++) {
      const s = shagais[i];
      s.rotation.x += 0.25 + i * 0.05;
      s.rotation.y += 0.3 + i * 0.04;
      s.rotation.z += 0.2;
      s.position.y = 0.9 + Math.abs(Math.sin((tumbleUntil - now) * 0.02 + i)) * 0.5;
    }
  } else {
    for (let i = 0; i < shagais.length; i++) {
      shagais[i].rotation.y += 0.003;
      shagais[i].position.y = 0.9;
    }
  }

  const LEG_PHASE = [0, Math.PI, Math.PI, 0];
  for (let hi = 0; hi < HORSE_IDS.length; hi++) {
    const id = HORSE_IDS[hi];
    const h = horses[id];
    if (!h) continue;
    const target = h.userData.targetX;
    if (typeof target === 'number') {
      const dx = target - h.position.x;
      const speed = Math.abs(dx) > 0.02 ? 4.2 : 0.0;
      h.position.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
      const running = Math.abs(dx) > 0.02;
      const stride = t * 12;
      h.userData.legs.forEach((l, i) => {
        l.rotation.x = running ? Math.sin(stride + LEG_PHASE[i]) * 0.55 : 0;
      });
      h.rotation.z = running ? Math.sin(stride * 2) * 0.04 : 0;
      h.position.y = running ? Math.abs(Math.sin(stride)) * 0.09 : 0;
      if (h.userData.tail) {
        h.userData.tail.rotation.y = Math.sin(t * 3 + hi) * 0.15;
        h.userData.tail.rotation.z = 0.4 + (running ? Math.sin(stride) * 0.08 : 0);
      }
    }
  }

  const cr = 18;
  camera.position.x = TRACK_OFFSET_X + Math.sin(t * 0.05) * 1.5;
  camera.position.y = 7 + Math.sin(t * 0.1) * 0.4;
  camera.position.z = cr + Math.cos(t * 0.05) * 1.5;
  camera.lookAt(TRACK_OFFSET_X, 1, 0);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

connect();
