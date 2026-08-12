// ARENA FPS — first-person prototype (three.js + GLB characters + item drops)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';

// ---------- renderer / scene (초기화는 rAF 밖) ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
scene.fog = new THREE.Fog(0x0a0e14, 25, 90);

const BASE_FOV = 70, ZOOM_FOV = 32;
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.08, 200);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0x9db2d8, 0x3a4a30, 1.1));
const sun = new THREE.DirectionalLight(0xffeedd, 2.6);
sun.position.set(18, 30, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.bias = -0.0004;
scene.add(sun);

// ---------- arena ----------
const ARENA = 40;
function groundTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d');
  g.fillStyle = '#151a22'; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#1e2530'; g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(512, i * 64); g.stroke();
  }
  g.fillStyle = 'rgba(126,224,163,0.05)';
  for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(20, 20);
  return t;
}
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(ARENA + 6, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 })
);
ground.receiveShadow = true;
scene.add(ground);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b3547, roughness: 0.8 });
const edgeMat = new THREE.MeshStandardMaterial({ color: 0x2a7a52, emissive: 0x1f5c3d, emissiveIntensity: 1.2 });
for (let i = 0; i < 24; i++) {
  const a = i / 24 * Math.PI * 2;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 7, 11.5), wallMat);
  wall.position.set(Math.cos(a) * (ARENA + 1.5), 3.5, Math.sin(a) * (ARENA + 1.5));
  wall.rotation.y = -a; wall.castShadow = true; wall.receiveShadow = true;
  scene.add(wall);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.15, 11.6), edgeMat);
  strip.position.copy(wall.position).y = 7.05; strip.rotation.y = -a;
  scene.add(strip);
}

// ---------- 지형 오브젝트: 10초 주기로 위/아래 이동(2초 내) ----------
const obstacles = [];
const obMat = new THREE.MeshStandardMaterial({ color: 0x3a4759, roughness: 0.7, metalness: 0.15 });
const LIFT_H = 2.6, LIFT_PERIOD = 10, LIFT_DUR = 2;
const platMat = new THREE.MeshStandardMaterial({ color: 0x2f5946, roughness: 0.6, metalness: 0.1 });
(function genObstacles() {
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, r = rnd(9, ARENA - 6);
    const platform = i % 3 === 0;                 // 1/3은 점프로 올라갈 수 있는 낮은 플랫폼
    const w = rnd(platform ? 2.4 : 1.6, 4), d = rnd(platform ? 2.4 : 1.6, 4);
    const h = platform ? rnd(0.8, 1.0) : rnd(1.2, 4.2);
    const grp = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), platform ? platMat : obMat);
    box.position.y = h / 2;
    box.castShadow = true; box.receiveShadow = true;
    grp.add(box);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, 0.08, d * 1.03), edgeMat);
    strip.position.y = h + 0.04;
    grp.add(strip);
    grp.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    scene.add(grp);
    // 짝수는 0초, 홀수는 5초 오프셋으로 번갈아 오르내림. 내려오면 바닥(yOff 0)이라 적이 접근·공격 가능
    obstacles.push({ grp, x: grp.position.x, z: grp.position.z, w, d, h, platform, yOff: 0, raised: false, phase: (i % 2) * (LIFT_PERIOD / 2), moving: false, from: 0, to: 0, t: 0 });
  }
})();
let liftClock = 0;
function updateObstacles(dt) {
  liftClock += dt;
  for (const o of obstacles) {
    if (!o.moving && liftClock >= o.phase) {
      o.phase += LIFT_PERIOD;                 // 다음 트리거 예약
      o.moving = true; o.t = 0;
      o.from = o.yOff; o.to = o.raised ? 0 : (o.platform ? 1.2 : LIFT_H); // 플랫폼은 낮게 떠서 위에 탄 채로 이동
      o.raised = !o.raised;
    }
    if (o.moving) {
      o.t += dt;
      const k = Math.min(1, o.t / LIFT_DUR);
      const s = k * k * (3 - 2 * k);          // smoothstep
      o.yOff = o.from + (o.to - o.from) * s;
      o.grp.position.y = o.yOff;
      if (k >= 1) o.moving = false;
    }
  }
}

function collideCircle(pos, radius, height = 1.7, feetY = 0) {
  const R = Math.hypot(pos.x, pos.z);
  if (R > ARENA - 1) { pos.x *= (ARENA - 1) / R; pos.z *= (ARENA - 1) / R; }
  for (const o of obstacles) {
    if (o.yOff - feetY > height) continue;    // 떠 있는 박스 아래로 통과 가능
    if (o.yOff + o.h <= feetY + 0.45) continue; // 발밑(올라선/넘을 수 있는) 박스는 밀어내지 않음
    const hw = o.w / 2 + radius, hd = o.d / 2 + radius;
    if (Math.abs(pos.x - o.x) < hw && Math.abs(pos.z - o.z) < hd) {
      const px = hw - Math.abs(pos.x - o.x), pz = hd - Math.abs(pos.z - o.z);
      if (px < pz) pos.x += (pos.x > o.x ? px : -px);
      else pos.z += (pos.z > o.z ? pz : -pz);
    }
  }
}
// 발 아래 지지면 높이 (플랫폼 위 서기·상승 플랫폼 탑승)
function supportHeight(pos) {
  let s = 0;
  for (const o of obstacles) {
    if (Math.abs(pos.x - o.x) < o.w / 2 + 0.2 && Math.abs(pos.z - o.z) < o.d / 2 + 0.2) {
      const top = o.yOff + o.h;
      if (top <= pos.y + 0.45 && top > s) s = top;
    }
  }
  return s;
}

// ---------- audio (절차 생성) ----------
let AC = null, masterGain = null;
function audioInit() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = AC.createGain(); masterGain.gain.value = 0.35; masterGain.connect(AC.destination);
}
function sfxShot() {
  if (!AC) return;
  const t = AC.currentTime;
  const buf = AC.createBuffer(1, AC.sampleRate * 0.12, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
  const src = AC.createBufferSource(); src.buffer = buf;
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
  const g = AC.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.12);
  src.connect(lp); lp.connect(g); g.connect(masterGain); src.start();
}
function sfxTone(freq, dur, type = 'square', vol = 0.15, slide = 0) {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(masterGain); o.start(); o.stop(t + dur);
}
const sfxHit = () => sfxTone(880, 0.06, 'square', 0.12);
const sfxHead = () => { sfxTone(1320, 0.07, 'square', 0.14); sfxTone(1760, 0.09, 'square', 0.1); };
const sfxReload = () => { sfxTone(300, 0.05, 'square', 0.1); setTimeout(() => sfxTone(420, 0.05, 'square', 0.1), 350); };
const sfxHurt = () => sfxTone(140, 0.25, 'sawtooth', 0.25, -60);
const sfxDie = () => sfxTone(220, 0.6, 'sawtooth', 0.22, -170);
const sfxRoar = () => sfxTone(90, 0.7, 'sawtooth', 0.18, 55);
const sfxCoin = () => { sfxTone(1568, 0.07, 'sine', 0.16); setTimeout(() => sfxTone(2093, 0.12, 'sine', 0.14), 70); };
const sfxPotion = () => { sfxTone(523, 0.1, 'sine', 0.16); setTimeout(() => sfxTone(784, 0.16, 'sine', 0.15), 100); };
const sfxChest = () => { sfxTone(392, 0.12, 'triangle', 0.18); setTimeout(() => sfxTone(587, 0.12, 'triangle', 0.17), 120); setTimeout(() => sfxTone(880, 0.25, 'triangle', 0.16), 240); };

// ---------- model loading ----------
const loader = new GLTFLoader();
const loadF = document.getElementById('loadF');
let loaded = 0;
const N_MODELS = 6;
function trackLoad(url) {
  return new Promise((res, rej) => loader.load(url, g => { loaded++; loadF.style.width = (loaded / N_MODELS * 100) + '%'; res(g); }, undefined, rej));
}
let playerGltf, enemyGltf, potionGltf, chestGltf, coinGltf, grenadeGltf;

// GLB 크기 정규화 (luckybox는 양자화 좌표라 스케일이 제각각)
function normalizeSize(obj, target) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const m = Math.max(size.x, size.y, size.z) || 1;
  obj.scale.multiplyScalar(target / m);
}

// 루트모션 제거: 힙 본 position 트랙의 XZ를 첫 프레임 값으로 고정 (Y는 점프·낙하 보존)
// — 클립에 이동이 구워져 있어 캐릭터가 앞으로 갔다가 루프마다 원점 복귀하는 문제의 원인
function stripRootMotion(gltf) {
  for (const clip of gltf.animations) {
    for (const tr of clip.tracks) {
      if (/hips\.position$/i.test(tr.name)) {
        const v = tr.values, x0 = v[0], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
      }
    }
  }
}

function prepShadows(root) {
  root.traverse(o => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
}
function clipOf(gltf, name) {
  const c = gltf.animations.find(a => a.name.toLowerCase() === name.toLowerCase());
  if (!c) console.warn('missing clip:', name);
  return c;
}

// ---------- player ----------
const EYE_STAND = 1.62;
const player = {
  root: null, mixer: null, actions: {}, current: null,
  pos: new THREE.Vector3(0, 0, 0), vy: 0, onGround: true,
  yaw: 0, pitch: 0, hp: 100, dead: false,
  eyeH: EYE_STAND, zooming: false,
  oneShot: null, fireAction: null,
  dashT: 0, dashCd: 0, dashDir: { x: 0, z: -1 }, lastDir: { x: 0, z: -1 },
};
let score = 0, kills = 0, wave = 0, ammo = 10, reloading = false, coins = 0;
let buffT = 0; // 무한 탄약 남은 시간
// ---------- 업그레이드 (코인 소모, 기본대비 +5%/레벨) ----------
const upg = { dmg: 0, rate: 0, reload: 0, mag: 0, hp: 0 };
const UPG_NAMES = { dmg: '무기 대미지', rate: '연사력', reload: '재장전', mag: '탄창', hp: 'HP' };
const upgCost = k => 100 * (upg[k] + 1);
const dmgMul = () => 1 + 0.05 * upg.dmg;
const fireInterval = () => 110 / (1 + 0.05 * upg.rate);
const reloadMs = () => 1600 / (1 + 0.05 * upg.reload);
const magSize = () => Math.round(10 * (1 + 0.05 * upg.mag)); // 기본 탄창 10발
const maxHp = () => Math.round(100 * (1 + 0.05 * upg.hp));
function updateHpHud() {
  document.getElementById('hpT').textContent = Math.max(0, player.hp | 0);
  document.getElementById('hpF').style.width = Math.max(0, player.hp / maxHp() * 100) + '%';
}
function renderUpg() {
  const el = document.getElementById('upgList');
  if (!el) return;
  el.innerHTML = '';
  for (const k of Object.keys(upg)) {
    const btn = document.createElement('button');
    btn.innerHTML = `${UPG_NAMES[k]} Lv.${upg[k]} <small>(+${upg[k] * 5}%)</small> <b>${upgCost(k)}🪙</b>`;
    btn.disabled = coins < upgCost(k);
    btn.addEventListener('click', () => buyUpg(k));
    el.appendChild(btn);
  }
  // 수류탄: 정가 100코인, 최대 5개 보유
  const gb = document.createElement('button');
  gb.innerHTML = `💣 수류탄 +1 <small>(${grenades}/5)</small> <b>100🪙</b>`;
  gb.disabled = coins < 100 || grenades >= 5;
  gb.addEventListener('click', () => {
    if (coins < 100 || grenades >= 5) return;
    coins -= 100;
    grenades++;
    document.getElementById('coinN').textContent = coins;
    updateGSlot();
    sfxPotion();
    renderUpg();
  });
  el.appendChild(gb);
  const cn = document.getElementById('shopCoinN');
  if (cn) cn.textContent = coins;
}
function buyUpg(k) {
  const c = upgCost(k);
  if (coins < c || player.dead) return;
  coins -= c;
  document.getElementById('coinN').textContent = coins;
  upg[k]++;
  if (k === 'hp') { player.hp = Math.min(maxHp(), player.hp + 5); updateHpHud(); }
  if (k === 'mag') updateAmmo();
  sfxPotion();
  renderUpg();
}

// ---------- 스코어 랭킹 TOP 10 (localStorage) ----------
function saveRanking() {
  let list;
  try { list = JSON.parse(localStorage.getItem('fps.rank') || '[]'); } catch { list = []; }
  const entry = { score, wave, kills, date: new Date().toISOString().slice(0, 10) };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  list = list.slice(0, 10);
  localStorage.setItem('fps.rank', JSON.stringify(list));
  return { list, entry };
}
function renderRanking() {
  const { list, entry } = saveRanking();
  const el = document.getElementById('rankList');
  el.innerHTML = '<h3>TOP 10</h3>' + list.map((r, i) =>
    `<div class="rankRow${r === entry ? ' me' : ''}"><span>${i + 1}.</span><b>${r.score}</b><small>W${r.wave} · ${r.kills}킬 · ${r.date}</small></div>`
  ).join('');
}

function setupPlayer() {
  const root = skClone(playerGltf.scene);
  prepShadows(root);
  scene.add(root);
  player.root = root;
  player.mixer = new THREE.AnimationMixer(root);
  const names = ['rifle aiming idle', 'rifle run', 'run backwards', 'walking', 'walking backwards',
    'strafe', 'strafe (2)', 'strafe left', 'reloading', 'rifle jump', 'firing rifle', 'toss grenade',
    'hit reaction', 'humanoid:death_gun'];
  for (const n of names) {
    const c = clipOf(playerGltf, n);
    if (c) player.actions[n] = player.mixer.clipAction(c);
  }
  const fireClip = clipOf(playerGltf, 'firing rifle');
  if (fireClip) {
    const add = THREE.AnimationUtils.makeClipAdditive(fireClip.clone());
    player.fireAction = player.mixer.clipAction(add);
    player.fireAction.blendMode = THREE.AdditiveAnimationBlendMode;
    player.fireAction.loop = THREE.LoopOnce;
  }
  play('rifle aiming idle');
  // 1인칭: 머리·머리카락(rope=트윈테일) 본을 0 스케일로 — 애니메이션이 스케일을 덮어쓰므로 매 프레임 재적용(hiddenBones)
  root.traverse(o => {
    if (o.isBone && /head|rope/i.test(o.name) && !/end/i.test(o.name)) hiddenBones.push(o);
    if (!muzzleParent && o.isBone && /hand.*r|righthand/i.test(o.name)) muzzleParent = o;
    if (o.isMesh && /cube039/i.test(o.name)) weaponMeshes.push(o); // 총 메쉬(수류탄 투척 시 숨김)
  });
  setupMuzzleAnchors();
  hideBones();
  if (!muzzleParent) muzzleParent = root;
}
function play(name, fade = 0.18) {
  const next = player.actions[name];
  if (!next || player.current === next) return;
  next.enabled = true; next.reset().play();
  if (player.current) player.current.crossFadeTo(next, fade, false);
  player.current = next;
}
function oneShot(name, lockSec) {
  const a = player.actions[name];
  if (!a) return;
  a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true;
  play(name, 0.1);
  player.oneShot = name;
  setTimeout(() => { if (player.oneShot === name) player.oneShot = null; }, lockSec * 1000);
}

const hiddenBones = [];
function hideBones() { for (const b of hiddenBones) b.scale.setScalar(0.001); }

// muzzle flash
let muzzleParent = null;
const flashLight = new THREE.PointLight(0xffcc66, 0, 6);
scene.add(flashLight);
// 원형 글로우 텍스처 — 단색 스프라이트는 사각형으로 보인다
function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,240,190,1)');
  gr.addColorStop(0.3, 'rgba(255,205,100,0.6)');
  gr.addColorStop(0.7, 'rgba(255,170,50,0.15)');
  gr.addColorStop(1, 'rgba(255,160,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}
const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
}));
flashSprite.scale.set(0.5, 0.5, 1);
scene.add(flashSprite);
let flashT = 0;

// 총구 끝: 무기 그룹(M4Colt) 로컬 bbox의 최장축 양 끝에 앵커를 달고, 조준 방향 쪽 끝을 총구로 사용
let muzzleEndA = null, muzzleEndB = null;
const lastMuzzle = new THREE.Vector3();
function setupMuzzleAnchors() {
  const wNode = weaponMeshes[0]?.parent;
  if (!wNode) return;
  const box = new THREE.Box3();
  for (const m of weaponMeshes) {
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox.clone();
    b.applyMatrix4(m.matrix); // 메쉬 → 무기 그룹 로컬
    box.union(b);
  }
  const size = box.getSize(new THREE.Vector3());
  const axis = size.x > size.y ? (size.x > size.z ? 'x' : 'z') : (size.y > size.z ? 'y' : 'z');
  // 총열은 단면 중심(탄창·조준경 포함)에서 벗어나 있으므로,
  // 양 끝 5% 구간 정점들의 실제 중심(centroid)을 앵커로 사용
  const span = box.max[axis] - box.min[axis];
  const thA = box.max[axis] - span * 0.05, thB = box.min[axis] + span * 0.05;
  const sumA = new THREE.Vector3(), sumB = new THREE.Vector3();
  let nA = 0, nB = 0;
  const v = new THREE.Vector3();
  for (const m of weaponMeshes) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrix);
      if (v[axis] >= thA) { sumA.add(v); nA++; }
      else if (v[axis] <= thB) { sumB.add(v); nB++; }
    }
  }
  const c = box.getCenter(new THREE.Vector3());
  const pA = nA ? sumA.divideScalar(nA) : c.clone().setComponent({ x: 0, y: 1, z: 2 }[axis], box.max[axis]);
  const pB = nB ? sumB.divideScalar(nB) : c.clone().setComponent({ x: 0, y: 1, z: 2 }[axis], box.min[axis]);
  muzzleEndA = new THREE.Object3D();
  muzzleEndB = new THREE.Object3D();
  muzzleEndA.position.copy(pA);
  muzzleEndB.position.copy(pB);
  wNode.add(muzzleEndA); wNode.add(muzzleEndB);
}
const _mzA = new THREE.Vector3(), _mzB = new THREE.Vector3();
function muzzleTip(dir) {
  if (!muzzleEndA) {
    const v = new THREE.Vector3();
    (muzzleParent ?? player.root).getWorldPosition(v);
    return v;
  }
  muzzleEndA.getWorldPosition(_mzA);
  muzzleEndB.getWorldPosition(_mzB);
  // 총열 양 끝 중 조준 방향으로 앞서 있는 쪽이 총구
  return _mzA.clone().sub(_mzB).dot(dir) > 0 ? _mzA.clone() : _mzB.clone();
}

// tracers / particles
const tracers = [];
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a3, transparent: true });
function addTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, tracerMat.clone());
  scene.add(line);
  tracers.push({ line, life: 0.09 });
}
const particles = [];
function burst(pos, color = 0xbb2233, n = 10) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06),
      new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos);
    const v = new THREE.Vector3((Math.random() - .5) * 4, Math.random() * 3.5, (Math.random() - .5) * 4);
    scene.add(m);
    particles.push({ m, v, life: 0.5 + Math.random() * 0.3 });
  }
}

// ---------- item drops ----------
const drops = [];   // {type:'potion'|'chest', root, t} — 근접 습득
const coinFx = [];  // {root, mixer, t, dur} — 1회 재생 후 제거
function dropItem(type, x, z) {
  const src = type === 'potion' ? potionGltf : type === 'grenade' ? grenadeGltf : chestGltf;
  const root = src.scene.clone(true);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; if (o.material) o.material = o.material.clone(); } });
  if (type === 'grenade') normalizeSize(root, 0.55);
  else root.scale.setScalar(type === 'potion' ? 2.2 : 1.0);
  root.position.set(x, 0, z);
  scene.add(root);
  const glow = new THREE.PointLight(type === 'potion' ? 0xff5577 : type === 'grenade' ? 0xffb347 : 0x66aaff, 1.6, 4);
  glow.position.set(0, 0.6, 0);
  root.add(glow);
  drops.push({ type, root, t: 0 });
}
function dropCoins(x, z) {
  const root = coinGltf.scene.clone(true);
  root.traverse(o => { if (o.isMesh && o.material) o.material = o.material.clone(); });
  root.scale.setScalar(6);
  root.position.set(x, 0.02, z);
  scene.add(root);
  const mixer = new THREE.AnimationMixer(root);
  let dur = 1.2;
  if (coinGltf.animations.length) {
    const act = mixer.clipAction(coinGltf.animations[0]);
    act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; act.play();
    dur = coinGltf.animations[0].duration;
  }
  coinFx.push({ root, mixer, t: 0, dur });
  const gain = 10 + Math.floor(Math.random() * 91); // 10~100
  coins += gain;
  document.getElementById('coinN').textContent = coins;
  renderUpg(); // 코인 변동 시 구매 가능 상태 갱신
  toast(`+${gain} 🪙`);
  sfxCoin();
}
// 칩 숫자 반짝임 (코인 흡수·점수·킬 갱신 시)
function flashChip(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth; // 애니메이션 재트리거
  el.classList.add('flash');
}

function toast(text) {
  const p = document.getElementById('pickup');
  p.textContent = text;
  p.style.opacity = 1;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => p.style.opacity = 0, 1300);
}
function updateDrops(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.t += dt;
    d.root.rotation.y += dt * 1.8;
    d.root.position.y = 0.15 + Math.sin(d.t * 2.4) * 0.12;
    const dist = Math.hypot(player.pos.x - d.root.position.x, player.pos.z - d.root.position.z);
    const radius = d.type === 'potion' ? 1.3 : 1.7;
    if (!player.dead && dist < radius) {
      if (d.type === 'potion') {
        player.hp = Math.min(maxHp(), player.hp + 20);
        updateHpHud();
        toast('❤️ 포션 획득 — HP +20');
        sfxPotion();
      } else if (d.type === 'grenade') {
        if (grenades >= 5) continue; // 최대 5개 — 바닥에 남겨둠
        grenades++;
        updateGSlot();
        toast('💣 수류탄 +1 — [F]로 조준');
        sfxPotion();
      } else {
        buffT = 10;
        document.getElementById('aura').classList.add('on');
        document.getElementById('buff').style.display = 'block';
        document.getElementById('ammo').classList.add('inf');
        updateAmmo();
        toast('🎁 보물상자 — 10초간 무한 탄약!');
        sfxChest();
      }
      scene.remove(d.root); drops.splice(i, 1);
      continue;
    }
    // 드롭 20초 경과 시 깜빡임, 30초에 삭제
    if (d.t > 30) { scene.remove(d.root); drops.splice(i, 1); }
    else if (d.t > 20) d.root.visible = Math.sin(d.t * 12) > -0.2;
  }
  for (let i = coinFx.length - 1; i >= 0; i--) {
    const c = coinFx[i];
    c.t += dt;
    c.mixer.update(dt);
    // 드롭 연출 후 플레이어 몸으로 빨려 들어옴
    if (c.t > c.dur + 0.4) {
      const target = new THREE.Vector3(player.pos.x, player.pos.y + 1.0, player.pos.z);
      const d = target.sub(c.root.position);
      const dist = d.length();
      if (c.d0 === undefined) c.d0 = Math.max(0.5, dist); // 흡수 시작 거리 기록
      const speed = 8 + (c.t - c.dur - 0.4) * 26; // 점점 가속
      c.root.position.addScaledVector(d.normalize(), Math.min(dist, speed * dt));
      // 흡수 시작부터 이미 작게(60%) 출발해 도착까지 선형 축소
      c.root.scale.setScalar(Math.max(0.4, 3.6 * dist / c.d0));
      if (dist < 0.5) { scene.remove(c.root); coinFx.splice(i, 1); sfxCoin(); flashChip('coinN'); }
    }
  }
}
function updateBuff(dt) {
  if (buffT <= 0) return;
  buffT -= dt;
  document.getElementById('buffT').textContent = Math.ceil(buffT);
  if (buffT <= 0) {
    buffT = 0;
    document.getElementById('aura').classList.remove('on');
    document.getElementById('buff').style.display = 'none';
    document.getElementById('ammo').classList.remove('inf');
    updateAmmo();
  }
}

// ---------- enemies ----------
const enemies = [];
const ENEMY_CLIPS = ['mutant walking', 'mutant run', 'mutant punch', 'mutant swiping', 'mutant dying', 'mutant roaring', 'mutant idle', 'jump attack'];
function makeHpBar() {
  const grp = new THREE.Group();
  // fog·toneMapped 해제 — 거리 안개/톤매핑으로 어두워지지 않게 원색 유지
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.11),
    new THREE.MeshBasicMaterial({ color: 0x11151c, transparent: true, opacity: 0.85, depthWrite: false, fog: false, toneMapped: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.075),
    new THREE.MeshBasicMaterial({ color: 0xff2b26, transparent: true, depthWrite: false, fog: false, toneMapped: false })); // 적 HP는 빨간색
  fill.position.z = 0.005;
  grp.add(bg); grp.add(fill);
  grp.visible = false;
  return { grp, fill, bg };
}
function spawnEnemy(waveN, variant = 'walker') {
  if (variant === true) variant = 'runner'; // 구형 호출 호환
  const runner = variant === 'runner', jumper = variant === 'jumper', ranged = variant === 'ranged', boss = variant === 'boss';
  const root = skClone(enemyGltf.scene);
  prepShadows(root);
  root.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; } });
  const a = Math.random() * Math.PI * 2, r = ARENA - 3;
  const s = boss ? 1.6 : 0.92 + Math.random() * 0.28; // 보스는 타 개체(평균 1.06) 대비 약 1.5배
  root.scale.setScalar(s);
  root.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  scene.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const acts = {};
  for (const n of ENEMY_CLIPS) { const c = clipOf(enemyGltf, n); if (c) acts[n] = mixer.clipAction(c); }
  // 웨이브 스케일링: HP·공격력 +5%/웨이브(무제한), 이동속도 +5%/웨이브(최대 +100%)
  const sc = 1 + 0.05 * (waveN - 1);
  const spdSc = Math.min(2, sc);
  const baseHp = boss ? 800 : jumper ? 110 : runner ? 65 : ranged ? 70 : 80; // 보스 = 워커 10배
  const baseSpd = runner ? 4.6 : jumper ? 3.0 : boss ? 2.2 : (1.6 + Math.random() * 0.4);
  const baseDmg = boss ? 100 : jumper ? 28 : ranged ? 25 : 20; // 기본: 5대 사망 · 보스 = 5배
  const en = {
    root, mixer, acts, current: null, scale: s, runner, kind: variant,
    hp: Math.round(baseHp * sc), maxhp: Math.round(baseHp * sc),
    speed: baseSpd * spdSc,
    moveClip: (runner || jumper) ? 'mutant run' : 'mutant walking',
    state: 'spawn', t: 0, atkCd: 0, hitFlash: 0, kbX: 0, kbZ: 0, hpBarT: 0,
    dmg: Math.round(baseDmg * sc),
  };
  if (runner) { // 달리기 개체: 붉은 발광
    root.traverse(o => { if (o.material?.emissive) o.material.emissive.setRGB(0.25, 0.02, 0.02); });
  }
  if (jumper) { // 도약 공격 개체: 보라 발광
    root.traverse(o => { if (o.material?.emissive) o.material.emissive.setRGB(0.18, 0.02, 0.3); });
  }
  if (ranged) { // 원거리 개체: 청록 발광
    root.traverse(o => { if (o.material?.emissive) o.material.emissive.setRGB(0.02, 0.25, 0.22); });
  }
  if (boss) { // 보스: 주황 발광 + 점프 광역 공격
    root.traverse(o => { if (o.material?.emissive) o.material.emissive.setRGB(0.35, 0.09, 0.02); });
    en.jumpCd = 2.0;
  }
  en.hpBar = makeHpBar();
  en.hpBar.grp.position.y = 2.62;
  if (boss) {
    en.hpBar.grp.scale.setScalar(2); en.hpBar.grp.position.y = 2.9;
    en.hpBar.grp.visible = true; en.alwaysBar = true;
    en.hpBar.fill.material.color.set(0xc04dff); // 보스 HP는 보라색
  }
  root.add(en.hpBar.grp);
  enPlay(en, Math.random() < 0.5 ? 'mutant roaring' : 'mutant idle');
  if (en.current === en.acts['mutant roaring']) sfxRoar();
  en.spawnHold = en.current === en.acts['mutant roaring'] ? 1.6 : 0.5;
  enemies.push(en);
  updateHudWave();
}
function enPlay(en, name, fade = 0.22, once = false) {
  const next = en.acts[name];
  if (!next || en.current === next) return;
  if (once) { next.setLoop(THREE.LoopOnce); next.clampWhenFinished = true; }
  next.enabled = true; next.reset().play();
  if (en.current) en.current.crossFadeTo(next, fade, false);
  en.current = next;
}

function updateEnemy(en, dt) {
  en.mixer.update(dt);
  if (en.hitFlash > 0) {
    en.hitFlash -= dt;
    const f = en.hitFlash > 0 ? 1 : 0;
    en.root.traverse(o => {
      if (o.material?.emissive) {
        if (f) o.material.emissive.setRGB(0.7, 0.05, 0.05);
        else if (en.kind === 'runner') o.material.emissive.setRGB(0.25, 0.02, 0.02);
        else if (en.kind === 'jumper') o.material.emissive.setRGB(0.18, 0.02, 0.3);
        else if (en.kind === 'ranged') o.material.emissive.setRGB(0.02, 0.25, 0.22);
        else o.material.emissive.setRGB(0, 0, 0);
      }
    });
  }
  const p = en.root.position;
  if (en.state === 'dead') {
    en.t += dt;
    if (en.t > 2.2) {
      const op = Math.max(0, 1 - (en.t - 2.2) / 0.8);
      en.root.traverse(o => { if (o.material) o.material.opacity = op; });
      if (op <= 0) { scene.remove(en.root); en.gone = true; }
    }
    return;
  }
  // 피격 넉백: 감쇠 속도로 뒤로 밀리되 이동은 계속(전진량이 더 크도록 총량 ≈0.15m)
  if (en.kbX || en.kbZ) {
    p.x += en.kbX * dt; p.z += en.kbZ * dt;
    const damp = Math.exp(-12 * dt);
    en.kbX *= damp; en.kbZ *= damp;
    if (Math.abs(en.kbX) + Math.abs(en.kbZ) < 0.02) en.kbX = en.kbZ = 0;
  }
  // HP바: 피격 후 4초 표시, 카메라를 향해 빌보드
  if (en.hpBar) {
    if (en.hpBarT > 0 || en.alwaysBar) {
      if (en.hpBarT > 0) en.hpBarT -= dt;
      en.hpBar.grp.visible = true;
      en.hpBar.grp.lookAt(camera.position);
    } else en.hpBar.grp.visible = false;
  }
  if (en.state === 'spawn') {
    en.t += dt;
    if (en.t >= en.spawnHold) { en.state = 'chase'; enPlay(en, en.moveClip); }
    return;
  }
  const toP = new THREE.Vector3().subVectors(player.pos, p); toP.y = 0;
  const dist = toP.length();
  en.root.rotation.y = Math.atan2(toP.x, toP.z);
  const atkRange = en.kind === 'ranged' ? 15 : en.kind === 'jumper' ? 5.2 : 2.0 * en.scale;
  if (en.jumpCd !== undefined) en.jumpCd -= dt;
  if (en.state === 'chase') {
    if (en.kind === 'boss' && en.jumpCd <= 0 && dist < 14 && dist > 1.5) {
      // 보스 도약: 목표 지점(현재 플레이어 위치)에 경고 원 표시 후 광역 타격
      en.state = 'bossjump'; en.t = 0; en.dealt = false;
      en.jumpFrom = p.clone();
      en.aoeTarget = player.pos.clone();
      en.aoeMesh = makeAoeCircle(en.aoeTarget);
      enPlay(en, 'jump attack', 0.12, true);
      sfxRoar();
    } else if (dist > atkRange) {
      toP.normalize();
      p.x += toP.x * en.speed * dt; p.z += toP.z * en.speed * dt;
      collideCircle(p, 0.6, 2.4 * en.scale, 0);
      for (const o of enemies) {
        if (o === en || o.state === 'dead') continue;
        const dx = p.x - o.root.position.x, dz = p.z - o.root.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 1.1) { p.x += dx / d * (1.1 - d) * 0.5; p.z += dz / d * (1.1 - d) * 0.5; }
      }
      enPlay(en, en.moveClip);
    } else if (en.atkCd <= 0) {
      en.state = 'attack'; en.t = 0; en.dealt = false;
      enPlay(en, en.kind === 'jumper' ? 'jump attack'
        : en.kind === 'ranged' ? 'mutant punch'
          : (Math.random() < 0.5 ? 'mutant punch' : 'mutant swiping'), 0.12, true);
    } else {
      enPlay(en, 'mutant idle');
    }
    en.atkCd -= dt;
  } else if (en.state === 'attack') {
    en.t += dt;
    const clipDur = en.current?.getClip().duration ?? 1;
    const jumper = en.kind === 'jumper';
    if (jumper && en.t < clipDur * 0.45 && dist > 1.2) {
      // 도약 전진
      p.x += toP.x / dist * 7 * dt; p.z += toP.z / dist * 7 * dt;
    }
    if (en.kind === 'ranged') {
      // 펀치 모션 중 투사체 발사 (플레이어의 발사 시점 위치를 조준 → 이동으로 회피 가능)
      if (!en.dealt && en.t > clipDur * 0.4) { en.dealt = true; fireProjectile(en); }
    } else if (!en.dealt && en.t > clipDur * (jumper ? 0.5 : 0.38) && dist < (jumper ? 3.0 : 2.6) * en.scale) {
      en.dealt = true; damagePlayer(en.dmg);
    }
    if (en.t >= clipDur * 0.95) {
      en.state = 'chase';
      en.atkCd = en.kind === 'ranged' ? 3.0 : jumper ? 1.4 : 0.7;
      enPlay(en, en.moveClip);
    }
  } else if (en.state === 'bossjump') {
    en.t += dt;
    const clipDur = en.current?.getClip().duration ?? 2;
    const hitT = clipDur * 0.55;
    const k = Math.min(1, en.t / hitT);
    // 도약 궤적(호) — 목표 지점은 도약 시작 시 고정 → 플레이어는 원 밖으로 피신 가능
    p.x = en.jumpFrom.x + (en.aoeTarget.x - en.jumpFrom.x) * k;
    p.z = en.jumpFrom.z + (en.aoeTarget.z - en.jumpFrom.z) * k;
    p.y = Math.sin(k * Math.PI) * 3;
    // 경고 원: 반경 0 → 10m로 점점 확대
    if (en.aoeMesh && !en.dealt) en.aoeMesh.scale.setScalar(Math.max(0.01, 10 * k));
    if (!en.dealt && en.t >= hitT) {
      en.dealt = true;
      p.y = 0;
      const d2 = Math.hypot(player.pos.x - en.aoeTarget.x, player.pos.z - en.aoeTarget.z);
      // 지면 충격파 — 오브젝트 위(높이 0.5m 이상)에 있으면 안 맞는다
      if (!player.dead && d2 < 10 && player.pos.y < 0.5) damagePlayer(en.dmg);
      burst(new THREE.Vector3(en.aoeTarget.x, 0.4, en.aoeTarget.z), 0xff5533, 26);
      shake(0.45, 0.55);          // 착지 충격 — 화면 흔들림
      rockBurst(en.aoeTarget);    // 돌 파편
      crackBurst(en.aoeTarget);   // 바닥 균열
      sfxDie();
      if (en.aoeMesh) en.aoeMesh.material.opacity = 0.55;
    }
    if (en.dealt && en.aoeMesh) {
      en.aoeMesh.material.opacity -= dt * 1.4;
      if (en.aoeMesh.material.opacity <= 0) clearAoe(en);
    }
    if (en.t >= clipDur * 0.95) {
      clearAoe(en);
      en.state = 'chase'; en.atkCd = 1.0; en.jumpCd = 6;
      enPlay(en, en.moveClip);
    }
  }
}

let gameTime = 0, combo = 0, lastKillT = -99;
// ---------- 수류탄 ----------
let grenades = 0, gMode = false;
const liveGrenades = [];
const weaponMeshes = [];
function makeThumb(srcScene) {
  const cv = document.createElement('canvas');
  const r2 = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r2.setSize(96, 96);
  const sc = new THREE.Scene();
  const obj = srcScene.clone(true);
  normalizeSize(obj, 1);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.sub(box.getCenter(new THREE.Vector3()));
  sc.add(obj);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.5));
  const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(2, 3, 2); sc.add(dl);
  const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 10);
  cam.position.set(1.0, 0.8, 1.0); cam.lookAt(0, 0, 0);
  r2.render(sc, cam);
  const url = cv.toDataURL();
  r2.dispose();
  return url;
}
function updateGSlot() {
  const el = document.getElementById('gSlot');
  document.getElementById('gCnt').textContent = grenades;
  el.classList.toggle('empty', grenades === 0);
  el.classList.toggle('active', gMode);
}
// 궤적 표시 (점선)
const trajLine = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineDashedMaterial({ color: 0x9fe8ff, dashSize: 0.32, gapSize: 0.2, transparent: true, opacity: 0.9 })
);
trajLine.frustumCulled = false; trajLine.visible = false;
scene.add(trajLine);
// 착탄 지점 피해 범위(반경 5.5m) — 푸른 원
function makeBlueCircle() {
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x3ba7ff, transparent: true, opacity: 0.22, depthWrite: false, fog: false, toneMapped: false }));
  m.scale.setScalar(5.5);
  m.visible = false;
  scene.add(m);
  return m;
}
const aimCircle = makeBlueCircle(); // 조준(F) 중 표시
function grenadeLaunch() {
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
  const look = new THREE.Vector3(-sy * cp, sp, -cy * cp);
  const origin = new THREE.Vector3(player.pos.x, player.pos.y + 1.5, player.pos.z).addScaledVector(look, 0.4);
  const vel = look.clone().multiplyScalar(15); vel.y += 3;
  return { origin, vel };
}
function updateTrajectory() {
  const { origin, vel } = grenadeLaunch();
  const pts = [];
  const pos = origin.clone(), v = vel.clone(), dt = 1 / 30;
  for (let t = 0; t < 3; t += dt) {
    pts.push(pos.clone());
    pos.addScaledVector(v, dt);
    v.y -= 13.5 * dt;
    if (pos.y < 0.05) { pts.push(pos.clone()); break; }
  }
  trajLine.geometry.setFromPoints(pts);
  trajLine.computeLineDistances();
  const end = pts[pts.length - 1];
  aimCircle.position.set(end.x, 0.045, end.z);
  aimCircle.visible = true;
}
function toggleGMode() {
  if (!gMode && grenades <= 0) { toast('수류탄이 없습니다'); return; }
  gMode = !gMode;
  trajLine.visible = gMode;
  aimCircle.visible = gMode;
  updateGSlot();
}
function hideWeapon(sec) {
  for (const m of weaponMeshes) m.visible = false;
  clearTimeout(hideWeapon._t);
  hideWeapon._t = setTimeout(() => weaponMeshes.forEach(m => m.visible = true), sec * 1000);
}
const pendingThrows = []; // 투척 모션 중 — 릴리즈(2초) 시점에 실제 발사
function throwGrenade() {
  if (grenades <= 0 || player.dead || pendingThrows.length || player.oneShot === 'toss grenade') return;
  grenades--;
  // 수류탄 모드는 F를 다시 누를 때까지 유지 (남은 수류탄이 없으면 총으로 복귀)
  if (grenades <= 0) { gMode = false; trajLine.visible = false; aimCircle.visible = false; }
  updateGSlot();
  oneShot('toss grenade', 2.3);
  hideWeapon(2.7); // 던지는 동안 총 숨김
  pendingThrows.push({ t: 2.0 });
}
function releaseGrenade() {
  // 릴리즈 순간의 조준 방향으로 발사
  const { origin, vel } = grenadeLaunch();
  const root = grenadeGltf.scene.clone(true);
  normalizeSize(root, 0.35);
  root.position.copy(origin);
  scene.add(root);
  // 비행 중에도 착탄 예상 지점에 푸른 피해 범위 표시
  const pos = origin.clone(), v = vel.clone(), dt = 1 / 30;
  for (let t = 0; t < 3 && pos.y > 0.05; t += dt) { pos.addScaledVector(v, dt); v.y -= 13.5 * dt; }
  const circle = makeBlueCircle();
  circle.position.set(pos.x, 0.045, pos.z);
  circle.visible = true;
  liveGrenades.push({ root, vel: vel.clone(), t: 0, circle });
  sfxTone(620, 0.1, 'square', 0.1, 120);
}
function updateGrenades(dt) {
  for (let i = pendingThrows.length - 1; i >= 0; i--) {
    pendingThrows[i].t -= dt;
    if (pendingThrows[i].t <= 0) { pendingThrows.splice(i, 1); releaseGrenade(); }
  }
  for (let i = liveGrenades.length - 1; i >= 0; i--) {
    const gr = liveGrenades[i];
    gr.t += dt;
    gr.root.position.addScaledVector(gr.vel, dt);
    gr.vel.y -= 13.5 * dt;
    gr.root.rotation.x += dt * 7; gr.root.rotation.z += dt * 5;
    if (gr.root.position.y <= 0.15 || gr.t > 4) {
      // 폭발: 반경 5.5m 광역 250 데미지
      const bp = gr.root.position.clone(); bp.y = 0.4;
      burst(bp, 0xffaa33, 30);
      burst(bp, 0xff5522, 18);
      flashLight.position.copy(bp); flashLight.intensity = 60; flashT = 0.1;
      sfxTone(70, 0.5, 'sawtooth', 0.35, -30);
      for (const en of enemies) {
        if (en.state === 'dead') continue;
        const d = Math.hypot(en.root.position.x - bp.x, en.root.position.z - bp.z);
        if (d < 5.5) {
          en.hp -= 250;
          en.hitFlash = 0.2;
          en.hpBarT = 4;
          if (en.hpBar) {
            const ratio = Math.max(0, en.hp / en.maxhp);
            en.hpBar.fill.scale.x = Math.max(0.001, ratio);
            en.hpBar.fill.position.x = -(1 - ratio) * 0.55;
          }
          if (en.hp <= 0) killEnemy(en);
        }
      }
      scene.remove(gr.root);
      if (gr.circle) scene.remove(gr.circle);
      liveGrenades.splice(i, 1);
    }
  }
}

// ---------- 화면 흔들림 ----------
let shakeT = 0, shakeAmp = 0, shakeDur = 0.5;
function shake(amp, dur) { shakeAmp = amp; shakeT = dur; shakeDur = dur; }

// ---------- 바닥 균열 + 돌 파편 (보스 착지) ----------
const decals = [];
const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a5261, roughness: 0.95 });
function rockBurst(center) {
  for (let i = 0; i < 16; i++) {
    const s = 0.12 + Math.random() * 0.28;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
    const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 8;
    m.position.set(center.x + Math.cos(a) * r, 0.15, center.z + Math.sin(a) * r);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    const v = new THREE.Vector3((Math.random() - .5) * 4, 4.5 + Math.random() * 5, (Math.random() - .5) * 4);
    scene.add(m);
    particles.push({ m, v, life: 1.2 + Math.random() * 0.6 });
  }
}
function crackBurst(center) {
  for (let i = 0; i < 10; i++) {
    const len = 2.2 + Math.random() * 5;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.09 + Math.random() * 0.14).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x05070a, transparent: true, opacity: 0.9, depthWrite: false }));
    const a = i / 10 * Math.PI * 2 + (Math.random() - .5) * 0.6;
    m.position.set(center.x + Math.cos(a) * len / 2, 0.035, center.z + Math.sin(a) * len / 2);
    m.rotation.y = -a;
    scene.add(m);
    decals.push({ m, life: 3.2, max: 3.2 });
  }
}
function updateDecals(dt) {
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    d.life -= dt;
    d.m.material.opacity = Math.max(0, d.life / d.max) * 0.9;
    if (d.life <= 0) { scene.remove(d.m); decals.splice(i, 1); }
  }
}

// ---------- 보스 광역 공격 경고 원 ----------
function makeAoeCircle(pos) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.32, depthWrite: false }));
  m.position.set(pos.x, 0.04, pos.z);
  m.scale.setScalar(0.01);
  scene.add(m);
  return m;
}
function clearAoe(en) { if (en.aoeMesh) { scene.remove(en.aoeMesh); en.aoeMesh = null; } }

// ---------- 원거리 투사체 (발사 시점 위치 조준 · 도달까지 2초 → 보고 피하기 가능) ----------
const projectiles = [];
const projGeo = new THREE.SphereGeometry(0.3, 12, 10);
function fireProjectile(en) {
  const origin = en.root.position.clone().add(new THREE.Vector3(0, 1.5 * en.scale, 0));
  const target = player.pos.clone().add(new THREE.Vector3(0, 1.2, 0)); // 발사 순간의 플레이어 위치
  const dir = target.clone().sub(origin);
  const dist = dir.length();
  const vel = dir.divideScalar(1.0); // 어느 거리든 약 1초에 도달 (기존 2초의 2배 속도)
  const m = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: 0x5affd0, transparent: true, opacity: 0.95 }));
  m.position.copy(origin);
  scene.add(m);
  projectiles.push({ m, vel, life: 1.15, dmg: en.dmg });
  sfxTone(220, 0.3, 'sawtooth', 0.14, 240);
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.life -= dt;
    pr.m.position.addScaledVector(pr.vel, dt);
    pr.m.rotation.y += dt * 8;
    // 플레이어 명중 판정
    const dx = pr.m.position.x - player.pos.x, dz = pr.m.position.z - player.pos.z;
    const dy = pr.m.position.y - (player.pos.y + 1.1);
    const hit = !player.dead && Math.hypot(dx, dz) < 0.75 && Math.abs(dy) < 1.1;
    if (hit) damagePlayer(pr.dmg);
    if (hit || pr.life <= 0) {
      burst(pr.m.position, 0x5affd0, 8);
      scene.remove(pr.m);
      projectiles.splice(i, 1);
    }
  }
}

function killEnemy(en) {
  en.state = 'dead'; en.t = 0;
  if (en.hpBar) en.hpBar.grp.visible = false;
  clearAoe(en);
  en.kbX = en.kbZ = 0;
  enPlay(en, 'mutant dying', 0.1, true);
  sfxDie();
  kills++;
  // 7초 내 연속킬 → 콤보. 점수는 콤보 배율 적용 (100 × 웨이브 × 콤보)
  combo = (gameTime - lastKillT <= 7) ? combo + 1 : 1;
  lastKillT = gameTime;
  score += 100 * wave * combo;
  if (combo >= 2) {
    const c = document.getElementById('combo');
    c.textContent = `+${combo} COMBO!`;
    c.classList.remove('pop');
    void c.offsetWidth;              // 애니메이션 재트리거
    c.classList.add('pop');
    sfxTone(660 + combo * 110, 0.12, 'square', 0.14);
  }
  document.getElementById('scoreN').textContent = score;
  document.getElementById('kills').textContent = kills;
  flashChip('scoreN'); flashChip('kills');
  updateHudWave();
  // 드롭: 코인 100% + 포션 10% + 상자 5%
  const px = en.root.position.x, pz = en.root.position.z;
  dropCoins(px, pz);
  const roll = Math.random();
  if (roll < 0.10) dropItem('potion', px + 0.7, pz);
  else if (roll < 0.15) dropItem('chest', px + 0.9, pz);
  else if (roll < 0.20) dropItem('grenade', px + 0.7, pz); // 수류탄 5%
  if (aliveCount() === 0) setTimeout(nextWave, 1600);
}
const aliveCount = () => enemies.filter(e => e.state !== 'dead').length;
function updateHudWave() { document.getElementById('left').textContent = aliveCount(); }

function nextWave() {
  if (player.dead) return;
  wave++;
  document.getElementById('waveN').textContent = wave;
  const runners = Math.max(0, wave - 2);                      // 웨이브3부터 1마리, 이후 +1
  const jumpers = wave >= 6 ? Math.min(3, wave - 5) : 0;      // 웨이브6부터 1마리, 이후 +1 (최대 3)
  const rangers = wave >= 9 ? Math.min(3, wave - 8) : 0;      // 웨이브9부터 1마리, 이후 +1 (최대 3)
  const bosses = wave % 10 === 0 ? 1 : 0;                     // 10웨이브마다 보스
  banner('WAVE ' + wave + (bosses ? ' — ⚠ BOSS 출현 ⚠' : rangers ? ' — 원거리 개체 출현!' : jumpers ? ' — 도약 개체 출현!' : runners ? ' — 러너 출현!' : ''));
  const count = 2 + wave;
  for (let i = 0; i < count; i++) {
    const kind = i < bosses ? 'boss'
      : i < bosses + rangers ? 'ranged'
        : i < bosses + rangers + jumpers ? 'jumper'
          : i < bosses + rangers + jumpers + runners ? 'runner' : 'walker';
    spawnTimers.push(setTimeout(() => !player.dead && spawnEnemy(wave, kind), i * 700));
  }
}
// 웨이브 스폰 예약 타이머 (스킵/재시작 시 취소해야 이월 스폰이 안 쌓인다)
const spawnTimers = [];
function clearSpawnTimers() { for (const t of spawnTimers) clearTimeout(t); spawnTimers.length = 0; }
// 디버그: 웨이브 스킵 (예약 스폰 취소 + 남은 적 즉시 제거 후 다음 웨이브)
function skipWave() {
  clearSpawnTimers();
  for (const en of enemies) { scene.remove(en.root); clearAoe(en); }
  enemies.length = 0;
  updateHudWave();
  if (!player.dead) nextWave();
}
function banner(text) {
  const b = document.getElementById('banner');
  b.textContent = text; b.style.opacity = 1;
  setTimeout(() => b.style.opacity = 0, 1800);
}

// ---------- 옵션 (시점 · 조작) ----------
let camMode = localStorage.getItem('fps.view') || 'fps';       // 'fps' | 'shoulder'
if (camMode === 'tps') camMode = 'shoulder';                    // 구버전 저장값 호환
let ctrlMode = localStorage.getItem('fps.ctrl') || 'pc';       // 'pc' | 'mobile'
const isMobileCtrl = () => ctrlMode === 'mobile';
let started = false;                                            // 모바일 모드 게임 시작 여부
const optMenu = document.getElementById('optMenu');
document.getElementById('optBtn').addEventListener('click', e => {
  e.stopPropagation();
  optMenu.style.display = optMenu.style.display === 'block' ? 'none' : 'block';
  if (optMenu.style.display === 'block') shopMenu.style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();
});
// 수류탄 슬롯 클릭/탭으로도 토글
document.getElementById('gSlot').addEventListener('pointerdown', e => { e.stopPropagation(); toggleGMode(); });

// 디버그 버튼 — 로컬(localhost/127.*)에서만 노출
const IS_LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname) || location.hostname.endsWith('.local');
if (!IS_LOCAL) document.getElementById('dbgWrap').style.display = 'none';
document.getElementById('dbgCoins').addEventListener('click', e => {
  e.stopPropagation();
  coins += 1000000;
  document.getElementById('coinN').textContent = coins;
  flashChip('coinN');
  renderUpg();
});
document.getElementById('dbgWave').addEventListener('click', e => {
  e.stopPropagation();
  skipWave();
});

const shopMenu = document.getElementById('shopMenu');
document.getElementById('startShop').addEventListener('click', e => {
  e.stopPropagation(); // 시작 오버레이의 포인터록 진입 차단
  shopMenu.style.display = shopMenu.style.display === 'block' ? 'none' : 'block';
  if (shopMenu.style.display === 'block') renderUpg();
});
optMenu.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  camMode = b.dataset.view; localStorage.setItem('fps.view', camMode); syncOptUI(); applyView();
}));
optMenu.querySelectorAll('[data-ctrl]').forEach(b => b.addEventListener('click', () => {
  ctrlMode = b.dataset.ctrl; localStorage.setItem('fps.ctrl', ctrlMode); syncOptUI(); applyCtrl();
}));
function syncOptUI() {
  optMenu.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === camMode));
  optMenu.querySelectorAll('[data-ctrl]').forEach(b => b.classList.toggle('on', b.dataset.ctrl === ctrlMode));
}
function applyView() {
  // 1인칭이 아니면 숨겼던 머리·머리카락 본 복원 (1인칭은 프레임마다 hideBones 재적용)
  if (camMode !== 'fps') for (const b of hiddenBones) b.scale.setScalar(1);
}
function applyCtrl() {
  document.body.classList.toggle('mobile', isMobileCtrl());
  if (isMobileCtrl() && document.pointerLockElement) document.exitPointerLock();
  refreshOverlay();
}
const isPlaying = () => locked || (isMobileCtrl() && started);
function refreshOverlay() { startEl.style.display = (isPlaying() || player.dead) ? 'none' : 'flex'; }
syncOptUI();

// ---------- input ----------
const keys = {};
let locked = false, firing = false, lastShot = 0;
const startEl = document.getElementById('start');
const msgEl = document.getElementById('msg');
startEl.addEventListener('click', () => {
  audioInit();
  shopMenu.style.display = 'none'; // 게임 시작 시 상점 닫기
  optMenu.style.display = 'none';
  if (isMobileCtrl()) { started = true; refreshOverlay(); }
  else canvas.requestPointerLock();
});
canvas.addEventListener('click', () => { if (!locked && !isMobileCtrl() && !player.dead) canvas.requestPointerLock(); }); // 사망 화면에선 커서 유지
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) shopMenu.style.display = 'none'; // 게임(포인터록) 진입 시 상점 숨김
  refreshOverlay();
  if (!locked && !player.dead) startEl.querySelector('.go').textContent = '▶ 클릭해서 계속';
});

// ---------- 모바일 조작 (조이스틱 + 버튼) ----------
const touchMove = { x: 0, z: 0 };
let zoomTog = false;
const joy = document.getElementById('joy'), joyStick = document.getElementById('joyStick');
let joyId = null, joyCenter = null;
function joyUpdate(e) {
  const dx = e.clientX - joyCenter[0], dy = e.clientY - joyCenter[1];
  const m = Math.hypot(dx, dy) || 1, cl = Math.min(m, 55);
  touchMove.x = dx / m * (cl / 55); touchMove.z = dy / m * (cl / 55);
  joyStick.style.transform = `translate(${dx / m * cl}px,${dy / m * cl}px)`;
}
joy.addEventListener('pointerdown', e => { joyId = e.pointerId; try { joy.setPointerCapture(joyId); } catch { } const r = joy.getBoundingClientRect(); joyCenter = [r.x + r.width / 2, r.y + r.height / 2]; joyUpdate(e); });
joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyUpdate(e); });
const joyEnd = e => { if (e.pointerId !== joyId) return; joyId = null; touchMove.x = touchMove.z = 0; joyStick.style.transform = ''; };
joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
// 화면 우측 드래그로 시점 회전
let lookId = null, lastLook = null;
canvas.addEventListener('pointerdown', e => {
  if (!isMobileCtrl() || !started || player.dead) return;
  if (e.clientX < innerWidth * 0.4) return;
  lookId = e.pointerId; lastLook = [e.clientX, e.clientY];
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== lookId || lastLook === null) return;
  const s = 0.005 * (player.zooming ? 0.45 : 1);
  player.yaw -= (e.clientX - lastLook[0]) * s;
  player.pitch -= (e.clientY - lastLook[1]) * s;
  player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch));
  lastLook = [e.clientX, e.clientY];
});
const lookEnd = e => { if (e.pointerId === lookId) { lookId = null; lastLook = null; } };
canvas.addEventListener('pointerup', lookEnd); canvas.addEventListener('pointercancel', lookEnd);
// 버튼
const mb = id => document.getElementById(id);
mb('mbFire').addEventListener('pointerdown', e => { e.preventDefault(); audioInit(); if (gMode) return; firing = true; });
mb('mbFire').addEventListener('pointerup', () => { if (gMode) throwGrenade(); firing = false; });
mb('mbFire').addEventListener('pointercancel', () => firing = false);
mb('mbJump').addEventListener('pointerdown', e => { e.preventDefault(); keys['Space'] = true; });
mb('mbJump').addEventListener('pointerup', () => keys['Space'] = false);
mb('mbZoom').addEventListener('pointerdown', e => { e.preventDefault(); zoomTog = !zoomTog; mb('mbZoom').classList.toggle('on', zoomTog); });
mb('mbDash').addEventListener('pointerdown', e => { e.preventDefault(); dash(); });
document.addEventListener('mousemove', e => {
  if (!locked) return;
  const sens = 0.0022 * (player.zooming ? 0.45 : 1);
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch));
});
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR' && !reloading && ammo < magSize()) reload();
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) dash();
  if (e.code === 'KeyF' && !e.repeat) toggleGMode();
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });
document.addEventListener('mousedown', e => {
  if (!locked) return; // 사망 후 재시작은 [확인] 버튼으로만
  if (e.button === 0) { if (gMode) return; firing = true; } // 수류탄은 마우스 업에서 발사
  if (e.button === 2) player.zooming = true;
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) {
    if (locked && gMode) throwGrenade(); // 다운 후 업 시점에 투척
    firing = false;
  }
  if (e.button === 2) player.zooming = false;
});
document.addEventListener('contextmenu', e => e.preventDefault());

const sfxDash = () => sfxTone(500, 0.18, 'sawtooth', 0.12, 700);
function dash() {
  if (player.dead || player.dashCd > 0) return;
  player.dashDir = { ...player.lastDir };
  player.dashT = 0.18; player.dashCd = 1.0;
  sfxDash();
}

function reload() {
  reloading = true;
  document.getElementById('ammoN').textContent = '···';
  sfxReload();
  oneShot('reloading', reloadMs() / 1000);
  setTimeout(() => { ammo = magSize(); reloading = false; updateAmmo(); }, reloadMs());
}
const updateAmmo = () => document.getElementById('ammoN').textContent = buffT > 0 ? '∞' : ammo;

// ---------- shooting ----------
const raycaster = new THREE.Raycaster();
function shoot(now) {
  if (player.dead || reloading || now - lastShot < fireInterval()) return;
  if (buffT <= 0) {
    if (ammo <= 0) { reload(); return; }
    ammo--;
  }
  lastShot = now; updateAmmo();
  sfxShot();
  if (player.fireAction) { player.fireAction.reset(); player.fireAction.setLoop(THREE.LoopOnce); player.fireAction.play(); }
  recoil = Math.min(recoil + (player.zooming ? 0.008 : 0.014), 0.05);
  flashT = 0.06;
  document.getElementById('crosshair').style.opacity = 0.6;
  setTimeout(() => document.getElementById('crosshair').style.opacity = 1, 70);

  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const dir = raycaster.ray.direction.clone();
  let origin = raycaster.ray.origin.clone();
  function scan(org) {
    let bestT = 120, hitEn = null, headshot = false;
    for (const en of enemies) {
      if (en.state === 'dead') continue;
      const s = en.scale;
      const spheres = [
        { c: en.root.position.clone().add(new THREE.Vector3(0, 1.15 * s, 0)), r: 0.66 * s, head: false },
        { c: en.root.position.clone().add(new THREE.Vector3(0, 2.0 * s, 0)), r: 0.36 * s, head: true },
      ];
      for (const sp of spheres) {
        const oc = sp.c.clone().sub(org);
        const t = oc.dot(dir);
        if (t < 0 || t > bestT) continue;
        const dd = oc.lengthSq() - t * t;
        if (dd < sp.r * sp.r) { bestT = t; hitEn = en; headshot = sp.head; }
      }
    }
    return { bestT, hitEn, headshot };
  }
  let { bestT, hitEn, headshot } = scan(origin);
  if (!hitEn && camMode !== 'fps') {
    // 3인칭 근접 시차 보정: 가슴 높이 원점으로 재판정
    const chest = player.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
    const alt = scan(chest);
    if (alt.hitEn) { ({ bestT, hitEn, headshot } = alt); origin = chest; }
  }
  // 장애물 차폐 (현재 부양 높이 반영)
  let wallT = 120;
  for (const o of obstacles) {
    const min = new THREE.Vector3(o.x - o.w / 2, o.yOff, o.z - o.d / 2);
    const max = new THREE.Vector3(o.x + o.w / 2, o.yOff + o.h, o.z + o.d / 2);
    const t = rayAABB(origin, dir, min, max);
    if (t !== null && t < wallT) wallT = t;
  }
  const muzzle = muzzleTip(dir);
  lastMuzzle.copy(muzzle);
  window.__lastShot = { origin: origin.toArray().map(v => +v.toFixed(2)), dir: dir.toArray().map(v => +v.toFixed(3)), bestT: +bestT.toFixed(2), wallT: +wallT.toFixed(2), hit: !!hitEn };
  if (hitEn && bestT < wallT) {
    const hitPos = origin.clone().addScaledVector(dir, bestT);
    addTracer(muzzle, hitPos);
    burst(hitPos, headshot ? 0xffcc44 : 0xbb2233, headshot ? 14 : 9);
    hitEn.hp -= Math.round((headshot ? 34 : 13) * dmgMul());
    hitEn.hitFlash = 0.12;
    // 넉백 임펄스(감쇠 속도) — 총량: 몸통 ≈0.15m, 헤드샷 ≈0.22m
    const kb = dir.clone(); kb.y = 0; kb.normalize();
    const imp = headshot ? 2.6 : 1.8;
    hitEn.kbX += kb.x * imp; hitEn.kbZ += kb.z * imp;
    // HP바 갱신·표시
    hitEn.hpBarT = 4;
    if (hitEn.hpBar) {
      const ratio = Math.max(0, hitEn.hp / hitEn.maxhp);
      hitEn.hpBar.fill.scale.x = Math.max(0.001, ratio);
      hitEn.hpBar.fill.position.x = -(1 - ratio) * 0.55;
    }
    hitmark(headshot);
    headshot ? sfxHead() : sfxHit();
    if (hitEn.hp <= 0) killEnemy(hitEn);
  } else {
    const end = origin.clone().addScaledVector(dir, Math.min(wallT, 80));
    addTracer(muzzle, end);
    if (wallT < 120) burst(end, 0x8899aa, 4);
  }
}
function rayAABB(o, d, min, max) {
  let tmin = 0, tmax = 200;
  for (const ax of ['x', 'y', 'z']) {
    const inv = 1 / d[ax];
    let t0 = (min[ax] - o[ax]) * inv, t1 = (max[ax] - o[ax]) * inv;
    if (inv < 0) [t0, t1] = [t1, t0];
    tmin = Math.max(tmin, t0); tmax = Math.min(tmax, t1);
    if (tmax < tmin) return null;
  }
  return tmin;
}
function hitmark(head) {
  const h = document.getElementById('hitmark');
  h.classList.toggle('head', head);
  h.style.opacity = 1; h.style.transition = 'none';
  requestAnimationFrame(() => { h.style.transition = 'opacity .3s'; h.style.opacity = 0; });
}

// ---------- player damage ----------
function damagePlayer(n) {
  if (player.dead) return;
  player.hp -= n;
  sfxHurt();
  const f = document.getElementById('dmgflash');
  f.style.opacity = 1; setTimeout(() => f.style.opacity = 0, 180);
  updateHpHud();
  if (player.hp <= 0) {
    player.dead = true;
    firing = false; gMode = false; trajLine.visible = false; aimCircle.visible = false;
    // 사망 애니메이션(humanoid:death_gun) 재생 후 YOU DIED 표시
    const da = player.actions['humanoid:death_gun'];
    let deathDur = 2.2;
    if (da) {
      da.setLoop(THREE.LoopOnce); da.clampWhenFinished = true;
      play('humanoid:death_gun', 0.15);
      player.oneShot = 'humanoid:death_gun'; // 다른 애니로 덮이지 않게 고정
      deathDur = da.getClip().duration;
    }
    clearTimeout(damagePlayer._t);
    damagePlayer._t = setTimeout(() => {
      renderRanking(); // TOP 10 기록·표시
      msgEl.style.display = 'block';
    }, 300); // 사망 0.3초 후 표시 (사망 애니는 뒤에서 계속 재생)
    document.exitPointerLock();
    refreshOverlay();
  } else {
    // 피격 리액션
    if (!player.oneShot) oneShot('hit reaction', 0.45);
  }
}
function restart(toMenu = false) {
  player.dead = false; player.pos.set(0, 0, 0); player.vy = 0;
  player.oneShot = null;
  // 사망 포즈(clampWhenFinished) 잔존 방지 — 전체 액션 정지 후 idle 새로 시작
  if (player.mixer) player.mixer.stopAllAction();
  if (player.actions['rifle aiming idle']) { player.current = null; play('rifle aiming idle', 0.1); }
  player.zooming = false; player.eyeH = EYE_STAND;
  player.dashT = 0; player.dashCd = 0;
  score = 0; kills = 0; wave = 0; reloading = false; buffT = 0;
  // 코인·업그레이드·수류탄은 게임오버 후에도 유지
  ammo = magSize();
  clearSpawnTimers();
  renderUpg();
  combo = 0; lastKillT = -99;
  for (const en of enemies) { scene.remove(en.root); clearAoe(en); }
  enemies.length = 0;
  for (const d of drops) scene.remove(d.root);
  drops.length = 0;
  for (const c of coinFx) scene.remove(c.root);
  coinFx.length = 0;
  for (const pr of projectiles) scene.remove(pr.m);
  projectiles.length = 0;
  for (const gr of liveGrenades) { scene.remove(gr.root); if (gr.circle) scene.remove(gr.circle); }
  liveGrenades.length = 0;
  pendingThrows.length = 0;
  gMode = false; trajLine.visible = false; aimCircle.visible = false; updateGSlot();
  player.hp = maxHp(); // 업그레이드 초기화 후이므로 100
  updateHpHud();
  document.getElementById('scoreN').textContent = 0;
  document.getElementById('kills').textContent = '0';
  document.getElementById('coinN').textContent = coins;
  document.getElementById('aura').classList.remove('on');
  document.getElementById('buff').style.display = 'none';
  document.getElementById('ammo').classList.remove('inf');
  updateAmmo();
  msgEl.style.display = 'none';
  if (toMenu) { started = false; refreshOverlay(); } // 확인 → 메인 화면
  else if (isMobileCtrl()) { started = true; refreshOverlay(); }
  else canvas.requestPointerLock();
  nextWave();
}
document.getElementById('deathOk').addEventListener('click', e => { e.stopPropagation(); restart(true); });

// ---------- update ----------
let recoil = 0;
const camTarget = new THREE.Vector3();

// ---------- 미니맵 (동심원 · 위 = 시선 방향) ----------
const mmCv = document.getElementById('minimap');
const mmCtx = mmCv.getContext('2d');
function drawMinimap() {
  const S = mmCv.width, C = S / 2, R = C - 4, k = S / 150; // k: 150px 기준 스케일
  mmCtx.clearRect(0, 0, S, S);
  // 동심원
  mmCtx.strokeStyle = 'rgba(126,224,163,.35)';
  mmCtx.lineWidth = k;
  for (let i = 1; i <= 3; i++) {
    mmCtx.beginPath(); mmCtx.arc(C, C, R * i / 3, 0, Math.PI * 2); mmCtx.stroke();
  }
  const toMap = (wx, wz) => {
    // 플레이어 기준 상대좌표 → yaw 회전(위=전방) → 픽셀
    const dx = wx - player.pos.x, dz = wz - player.pos.z;
    const c = Math.cos(-player.yaw), s = Math.sin(-player.yaw);
    const rx = dx * c - dz * s, rz = dx * s + dz * c;
    return [C + rx / ARENA * R, C + rz / ARENA * R];
  };
  const dot = (x, y, color, r = 3 * k) => {
    if (Math.hypot(x - C, y - C) > R - 1) { // 범위 밖은 가장자리에 클램프
      const a = Math.atan2(y - C, x - C);
      x = C + Math.cos(a) * (R - 2); y = C + Math.sin(a) * (R - 2);
    }
    mmCtx.fillStyle = color;
    mmCtx.beginPath(); mmCtx.arc(x, y, r, 0, Math.PI * 2); mmCtx.fill();
  };
  for (const d of drops) dot(...toMap(d.root.position.x, d.root.position.z), '#ffd76b');
  for (const en of enemies) if (en.state !== 'dead') dot(...toMap(en.root.position.x, en.root.position.z), '#ff5555');
  // 플레이어(중앙 화살표, 위 = 전방)
  mmCtx.fillStyle = '#7ee0a3';
  mmCtx.beginPath();
  mmCtx.moveTo(C, C - 6 * k); mmCtx.lineTo(C - 4 * k, C + 4 * k); mmCtx.lineTo(C + 4 * k, C + 4 * k);
  mmCtx.closePath(); mmCtx.fill();
}

function updatePlayer(dt) {
  gameTime += dt;
  const mobile = isMobileCtrl();
  if (mobile) player.zooming = zoomTog;
  const sp = 7.2; // 기본 이동 = 달리기
  let mx = 0, mz = 0;
  if (mobile) { mx = touchMove.x; mz = touchMove.z; }
  else {
    if (keys['KeyW']) mz -= 1; if (keys['KeyS']) mz += 1;
    if (keys['KeyA']) mx -= 1; if (keys['KeyD']) mx += 1;
  }
  const len = Math.max(1, Math.hypot(mx, mz)); // 조그 아날로그 입력은 크기 보존
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const fx = -sy, fz = -cy, rx = cy, rz = -sy;
  const dx = (fx * -mz + rx * mx) / len, dz = (fz * -mz + rz * mx) / len;
  player.pos.x += dx * sp * dt; player.pos.z += dz * sp * dt;
  // 대쉬 방향 후보: 입력 중이면 입력 방향, 아니면 전방
  if (Math.abs(mx) + Math.abs(mz) > 0.12) player.lastDir = { x: dx, z: dz };
  else player.lastDir = { x: fx, z: fz };
  // 대쉬(순간 가속)
  player.dashCd = Math.max(0, player.dashCd - dt);
  if (player.dashT > 0) {
    player.dashT -= dt;
    player.pos.x += player.dashDir.x * 40 * dt;
    player.pos.z += player.dashDir.z * 40 * dt;
  }
  collideCircle(player.pos, 0.45, 1.7, player.pos.y);

  // 점프/중력/플랫폼 지지
  if (keys['Space'] && player.onGround) {
    player.vy = 5.8; player.onGround = false;
    // 1인칭에서는 점프 모션이 상체를 카메라 앞으로 들이밀어 화면을 가리므로 생략
    if (camMode !== 'fps') oneShot('rifle jump', 0.9);
  }
  const sup = supportHeight(player.pos);
  player.vy -= 13.5 * dt; player.pos.y += player.vy * dt;
  if (player.pos.y <= sup) { player.pos.y = sup; player.vy = 0; player.onGround = true; }
  else if (player.vy !== 0) player.onGround = false;

  player.root.position.copy(player.pos);
  player.root.rotation.y = player.yaw + Math.PI;

  // 로코모션
  if (!player.oneShot) {
    const moving = Math.abs(mx) + Math.abs(mz) > 0.12;
    if (!moving) play('rifle aiming idle');
    else if (mz < 0) play('rifle run');
    else if (mz > 0) play('run backwards');
    else if (mx > 0) play('strafe');
    else play('strafe (2)'); // 왼쪽: strafe left는 바닥 싱크가 안 맞음
  }
  if (player.current && !player.oneShot) player.current.timeScale = player.dashT > 0 ? 1.6 : 1.15;

  player.mixer.update(dt);
  if (camMode === 'fps') hideBones();
  recoil = Math.max(0, recoil - dt * 0.25);

  // 카메라: 1인칭 / 3인칭 중앙 / 3인칭 숄더뷰
  const pitch = player.pitch + recoil * 3;
  const cp = Math.cos(pitch), spt = Math.sin(pitch);
  const look = new THREE.Vector3(-sy * cp, spt, -cy * cp);
  if (camMode === 'fps') {
    camera.position.set(
      player.pos.x - sy * 0.14,
      player.pos.y + player.eyeH,
      player.pos.z - cy * 0.14
    );
  } else {
    // 숄더뷰: 카메라를 오른쪽 어깨 위로 → 플레이어는 화면 좌측
    const base = new THREE.Vector3(player.pos.x + cy * 0.95, player.pos.y + player.eyeH, player.pos.z - sy * 0.95);
    const camPos = base.clone().addScaledVector(look, -2.7);
    camPos.y = Math.max(0.3, camPos.y);
    camera.position.copy(camPos); // 지연 없이 플레이어와 함께 이동
  }
  camTarget.copy(camera.position).addScaledVector(look, 10);
  camera.lookAt(camTarget);
  // 화면 흔들림 (보스 착지 등)
  if (shakeT > 0) {
    shakeT -= dt;
    const k = shakeAmp * Math.max(0, shakeT / shakeDur);
    camera.position.x += (Math.random() - .5) * k;
    camera.position.y += (Math.random() - .5) * k;
    camera.position.z += (Math.random() - .5) * k;
  }

  // 줌 FOV 보간
  const fovTarget = player.zooming ? ZOOM_FOV : BASE_FOV;
  if (Math.abs(camera.fov - fovTarget) > 0.1) {
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  document.getElementById('crosshair').classList.toggle('zoom', player.zooming);
  document.getElementById('zoomVig').classList.toggle('on', player.zooming);

  // 총구 이펙트
  if (flashT > 0) {
    flashT -= dt;
    flashLight.position.copy(lastMuzzle); flashSprite.position.copy(lastMuzzle);
    flashLight.intensity = flashT > 0 ? 26 : 0;
    flashSprite.material.opacity = flashT > 0 ? 0.9 : 0;
  } else { flashLight.intensity = 0; flashSprite.material.opacity = 0; }
  if (gMode) updateTrajectory();
  drawMinimap();
}

// ---------- main loop ----------
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  let dt = clock.getDelta();
  if (dt > 0.05) dt = 0.05;
  const now = performance.now();
  if (isPlaying() && !player.dead) {
    if (firing) shoot(now);
    updatePlayer(dt);
    updateObstacles(dt);
    updateDrops(dt);
    updateBuff(dt);
    updateProjectiles(dt);
    updateGrenades(dt);
    updateDecals(dt);
    for (const en of enemies) updateEnemy(en, dt);
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].gone) enemies.splice(i, 1);
  } else if (player.root) {
    player.mixer.update(dt * (player.dead ? 1 : 0.4)); // 사망 애니는 정속 재생
    if (camMode === 'fps') hideBones();
    for (const en of enemies) if (en.state === 'dead') updateEnemy(en, dt);
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i]; t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.09);
    if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); tracers.splice(i, 1); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= dt;
    p.v.y -= 9 * dt;
    p.m.position.addScaledVector(p.v, dt);
    if (p.life <= 0 || p.m.position.y < 0) { scene.remove(p.m); particles.splice(i, 1); }
  }
  renderer.render(scene, camera);
}

// ---------- boot ----------
(async function boot() {
  try {
    [playerGltf, enemyGltf, potionGltf, chestGltf, coinGltf, grenadeGltf] = await Promise.all([
      trackLoad('./assets/player.glb'),
      trackLoad('./assets/enemy.glb'),
      trackLoad('./assets/health_potion.glb'),
      trackLoad('./assets/chest.glb'),
      trackLoad('./assets/coin_pile_spill.glb'),
      trackLoad('./assets/grenade.glb'),
    ]);
    document.getElementById('gImg').src = makeThumb(grenadeGltf.scene);
    updateGSlot();
    stripRootMotion(playerGltf);
    stripRootMotion(enemyGltf);
    setupPlayer();
    applyView();
    applyCtrl();
    document.getElementById('loading').style.display = 'none';
    refreshOverlay();
    nextWave();
    tick();
  } catch (e) {
    document.getElementById('loading').textContent = '로드 실패: ' + e.message;
    console.error(e);
  }
})();

// ---------- debug hook (검증용) ----------
window.__game = {
  get state() {
    return {
      loaded: !!(playerGltf && enemyGltf && potionGltf && chestGltf && coinGltf),
      wave, score, kills, ammo, coins, combo, camMode, ctrlMode, gameTime: +gameTime.toFixed(2), buffT: +buffT.toFixed(2),
      upg: { ...upg }, maxHp: maxHp(), mag: magSize(),
      grenades, gMode, liveGrenades: liveGrenades.length,
      hp: player.hp, eyeH: +player.eyeH.toFixed(2), zooming: player.zooming, fov: +camera.fov.toFixed(1),
      dashCd: +player.dashCd.toFixed(2),
      playerPos: player.pos.toArray().map(v => +v.toFixed(2)),
      enemies: enemies.map(e => ({
        state: e.state, hp: e.hp, runner: e.runner,
        pos: e.root.position.toArray().map(v => +v.toFixed(2)),
        clip: e.current?.getClip().name ?? null,
      })),
      drops: drops.map(d => ({ type: d.type, t: +d.t.toFixed(1), visible: d.root.visible, pos: d.root.position.toArray().map(v => +v.toFixed(2)) })),
      coinFx: coinFx.length,
      projectiles: projectiles.map(pr => ({ pos: pr.m.position.toArray().map(v => +v.toFixed(2)), life: +pr.life.toFixed(2) })),
      obstacles: obstacles.map(o => ({ yOff: +o.yOff.toFixed(2), h: +o.h.toFixed(2), platform: !!o.platform, raised: o.raised, x: +o.x.toFixed(1), z: +o.z.toFixed(1) })),
      currentClip: player.current?.getClip().name ?? null,
    };
  },
  step(dt = 1 / 60, opts = {}) {
    Object.assign(keys, opts.keys ?? {});
    if (opts.yaw !== undefined) player.yaw = opts.yaw;
    if (opts.pitch !== undefined) player.pitch = opts.pitch;
    if (opts.zoom !== undefined) player.zooming = opts.zoom;
    updatePlayer(dt);
    updateObstacles(dt);
    updateDrops(dt);
    updateBuff(dt);
    updateProjectiles(dt);
    updateGrenades(dt);
    updateDecals(dt);
    for (const en of enemies) updateEnemy(en, dt);
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].gone) enemies.splice(i, 1);
    if (opts.shoot) { lastShot = 0; shoot(performance.now()); }
    Object.keys(opts.keys ?? {}).forEach(k => keys[k] = false);
  },
  shot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
  refill() { ammo = magSize(); reloading = false; updateAmmo(); },
  spawnAt(x, z, variant = 'walker') { spawnEnemy(wave || 1, variant); const e = enemies[enemies.length - 1]; e.root.position.set(x, 0, z); e.state = 'chase'; return e; },
  dropAt(type, x, z) { type === 'coin' ? dropCoins(x, z) : dropItem(type, x, z); },
  hurt(n) { damagePlayer(n); },
  skipWave() { skipWave(); },
  addGrenades(n = 1) { grenades += n; updateGSlot(); },
  setPos(x, y, z) { player.pos.set(x, y, z); player.vy = 0; player.onGround = true; },
  toss() { throwGrenade(); },
  revive() { player.dead = false; player.hp = maxHp(); msgEl.style.display = 'none'; updateHpHud(); },
  buy(k) { buyUpg(k); },
  addCoins(n) { coins += n; document.getElementById('coinN').textContent = coins; renderUpg(); },
};
