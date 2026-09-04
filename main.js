// ARENA FPS — first-person prototype (three.js + GLB characters + item drops)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';

// ---------- renderer / scene (초기화는 rAF 밖) ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));   // 2배 픽셀은 화면 픽셀 4배 — 1.5배까지만
let shadowQ = localStorage.getItem('fps.shadowq') || 'mid';    // 'high' 부드러운 2048(매 프레임) · 'mid' 1024 정적 + 적은 그림자 원 · 'off' 끔
let shadowOn = shadowQ !== 'off';
let srEditUI = false, srRightFolded = false;   // 가구를 고르면 우측 패널을 접는다 · 탭으로 다시 편다
let touchPick = null, placeDrag = false, placeAskKind = null, suppressClick = false;   // 터치로 잡아 옮기기 · 놓을 때 확인 팝업                    // 쇼룸 생활모드: '방 편집'을 눌러 우측 패널·저장 버튼을 연 상태
let shopClosed = false;                  // 일시정지 중 상점을 ✕로 닫았나 (다음 일시정지에 초기화)
let fsLock = localStorage.getItem('fps.fs') !== 'off';   // 전체화면 + 키 잠금 (기본 켬) — Ctrl 조합이 브라우저 단축키로 새지 않게
renderer.shadowMap.enabled = shadowOn;
renderer.shadowMap.type = shadowQ === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e14);
scene.fog = new THREE.Fog(0x0a0e14, 25, 90);

// 우주 배경(별) + 오로라 — 랜덤맵처럼 위가 뚫린 곳에서 보인다
let skyGrp = null, auroraMat = null;
function starTexture() {
  const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 1024;
  const g = cv.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 1024);
  bg.addColorStop(0, '#02030a'); bg.addColorStop(0.55, '#050a1a'); bg.addColorStop(1, '#0a1226');
  g.fillStyle = bg; g.fillRect(0, 0, 2048, 1024);
  for (let i = 0; i < 6; i++) {          // 성운 얼룩
    const x = Math.random() * 2048, y = Math.random() * 700, r = 160 + Math.random() * 260;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const hue = [`120,60,200`, `40,90,200`, `160,40,140`][i % 3];
    gr.addColorStop(0, `rgba(${hue},0.16)`); gr.addColorStop(1, `rgba(${hue},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 2600; i++) {       // 별
    const x = Math.random() * 2048, y = Math.random() * 1024;
    const s = Math.random() < 0.08 ? 2.2 : Math.random() < 0.5 ? 1.2 : 0.8;
    const a = 0.35 + Math.random() * 0.65;
    g.fillStyle = `rgba(${220 + Math.random() * 35},${220 + Math.random() * 35},255,${a})`;
    g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 40; i++) {         // 밝은 별 십자 광
    const x = Math.random() * 2048, y = Math.random() * 900;
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x - 6, y); g.lineTo(x + 6, y); g.moveTo(x, y - 6); g.lineTo(x, y + 6); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function buildSky() {
  if (skyGrp) { scene.remove(skyGrp); skyGrp.traverse(o => { if (o.geometry) o.geometry.dispose(); }); skyGrp = null; }
  skyGrp = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(190, 40, 24),
    new THREE.MeshBasicMaterial({ map: starTexture(), side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false }));
  dome.renderOrder = -10;
  skyGrp.add(dome);
  auroraMat = new THREE.ShaderMaterial({   // 오로라 커튼: 노이즈로 흔들리는 세로 띠
    uniforms: { uT: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uT; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
      void main(){
        float x = vUv.x * 6.0;
        float w = n(vec2(x * 0.9 + uT * 0.05, uT * 0.08)) * 0.6 + n(vec2(x * 2.3 - uT * 0.07, 3.0 + uT * 0.05)) * 0.4;   // 커튼 흔들림
        float gate = smoothstep(0.30, 0.62, n(vec2(x * 0.35 + uT * 0.02, 7.0)));            // 띠가 군데군데 자연스럽게 끊긴다
        float lift = n(vec2(x * 0.6 + uT * 0.03, 20.0)) * 0.25;                              // 아래선이 물결친다
        float y = vUv.y - lift;
        float band = smoothstep(0.02, 0.22, y) * (1.0 - smoothstep(0.30, 0.95, y));         // 아래 밝고 위로 사라진다
        float ray = 0.55 + 0.45 * n(vec2(x * 7.0 + uT * 0.3, 10.0));                       // 세로 줄무늬
        float a = band * ray * gate * (0.35 + 0.65 * w);
        vec3 c = mix(vec3(0.15, 0.95, 0.55), vec3(0.45, 0.35, 1.0), smoothstep(0.15, 0.7, y));   // 초록 → 보라
        gl_FragColor = vec4(c * a * 1.6, a * 0.75);
      }`,
  });
  for (let k = 0; k < 3; k++) {          // 커튼 3장 — 끊긴 모서리가 없게 360° 띠로 두르고 셰이더 노이즈로 사라진다
    const geo = new THREE.CylinderGeometry(150 - k * 12, 150 - k * 12, 70, 96, 1, true);
    const cur = new THREE.Mesh(geo, auroraMat);
    cur.position.y = 95 + k * 14;
    cur.rotation.y = k * 1.9;
    cur.renderOrder = -9;
    skyGrp.add(cur);
  }
  scene.add(skyGrp);
}
function updateSky(dt) {
  if (!skyGrp) return;
  skyGrp.position.set(player.pos.x, 0, player.pos.z);   // 항상 플레이어를 감싼다
  if (auroraMat) auroraMat.uniforms.uT.value += dt;
}
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
sun.shadow.mapSize.set(shadowQ === 'high' ? 2048 : 1024, shadowQ === 'high' ? 2048 : 1024);
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.bias = -0.0004;
sun.shadow.autoUpdate = shadowQ === 'high';   // 높음만 매 프레임 · 나머지는 정적 지형만 6프레임마다
scene.add(sun);

// ---------- map: 광장 / 절차적 랜덤(방+복도) ----------
const ARENA = 40;                       // 광장 반경
const WALL_H = 6;                       // 랜덤맵 벽 높이 (천장 없음 — 위는 뚫려 있다)
let mapMode = localStorage.getItem('fps.map') || 'plaza';  // 'plaza' | 'random'
let mapRadius = ARENA;                  // 미니맵·스폰 기준
let mapRects = [];                      // 랜덤맵 바닥 사각형 {x0,z0,x1,z1,room}
let lavaRects = [];                     // 용암 구역 {x0,z0,x1,z1}
const LAVA_FLOOR = 11;                  // 복도 용암이 나오는 단계
const LAVA_ROOM_FLOOR = 13;             // 방 전체가 용암인 곳이 나오는 단계
const LAVA_DPS = 34;                    // 용암 위에서 초당 피해
const lavaMat = new THREE.MeshStandardMaterial({
  color: 0xff5a1e, emissive: 0xff3b00, emissiveIntensity: 0.9, roughness: 0.7, metalness: 0,
});
function onLava(x, z) {                 // 그 자리가 용암인가
  for (const r of lavaRects) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
  return false;
}
let walkGrid = null;                    // 랜덤맵 이동 가능 격자(1m)
let spawnPoints = [];                   // 랜덤맵 적 스폰 후보
let mapSeed = '';                       // 현재 랜덤맵 시드 (랭킹에 기록)
let roomThemes = [];                    // 방별 테마
let rngState = 1;
function seedFromString(str) {          // 문자열 → 32bit 시드
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function srand() {                      // mulberry32 — 시드가 같으면 같은 맵이 나온다
  rngState |= 0; rngState = rngState + 0x6D2B79F5 | 0;
  let t = Math.imul(rngState ^ rngState >>> 15, 1 | rngState);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function newSeed() {                    // 4글자 시드 (표시·공유용)
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) out += A[(Math.random() * A.length) | 0];
  return out;
}
const seenRects = new Set();            // 미니맵 안개: 가본 방·복도 인덱스
let portal = null;                      // {grp, x, z} — 다음 층으로 가는 문 (B 지점)
let floorNo = 1;                        // 현재 층
let deepFloor = Math.max(1, +(localStorage.getItem('fps.deep') || 1));   // 지금까지 내려가 본 가장 깊은 층
function markDeep(f) {
  if (f <= deepFloor) return;
  deepFloor = f;
  localStorage.setItem('fps.deep', String(deepFloor));
  toast('🌀 최고 기록 ' + f + '층 — 다음부터 여기로 바로 갈 수 있습니다');
}
const tpCoin = f => 25 * f * f;          // 층이 깊을수록 가파르게 (기존의 1/10)
const tpHead = f => Math.max(10, Math.floor(f * 30 / 12 / 10) * 10);    // 층당 30원 기준 · 10단위 내림
const stageNo = () => (walkGrid ? floorNo : wave);   // 화면에 보이는 '단계' — 광장=웨이브 · 랜덤맵=층
const FLOOR_TIME = 60;                  // 층 제한시간(초)
let floorTime = FLOOR_TIME;
let hunter = null;                      // 제한시간 초과 시 등장하는 무적 추격자
let warping = false, floorShopOpen = false;
let portalTravel = 0;   // A→B 실제 이동거리(m)
const playerStart = new THREE.Vector3(0, 0, 0);
const worldGroup = new THREE.Group();
// ---------- 고정 점광원 풀 ----------
// 드랍 아이템·램프마다 PointLight를 새로 추가하면 씬의 조명 수가 바뀌고, three.js는 조명 수가 다른 조합마다
// 모든 재질의 셰이더를 새로 컴파일한다(측정: 킬 1회에 새 프로그램 11~13개 · 0.5~1.5초 정지).
// 그래서 점광원은 처음부터 정해진 수만 씬에 두고 빌려 쓴다. 빌린 조명은 주인 오브젝트의 위치를 매 프레임 따라간다.
const LIGHT_POOL_N = 8;
const lightPool = [];
for (let i = 0; i < LIGHT_POOL_N; i++) {
  const l = new THREE.PointLight(0xffffff, 0, 1);
  l.userData.owner = null; l.userData.off = new THREE.Vector3();
  scene.add(l);
  lightPool.push(l);
}
const _lw = new THREE.Vector3();
function lightAttached(o) { while (o) { if (o === scene) return true; o = o.parent; } return false; }
function borrowLight(color, intensity, distance, owner, ox = 0, oy = 0, oz = 0) {
  let l = lightPool.find(p => !p.userData.owner);
  if (!l) {                                // 남는 게 없으면 씬에 안 붙는 유령 조명 — 호출부는 그대로 다룰 수 있다
    l = new THREE.PointLight(color, intensity, distance);
    l.userData.ghost = true;
    return l;
  }
  l.color.setHex(color); l.intensity = intensity; l.distance = distance;
  l.userData.owner = owner; l.userData.off.set(ox, oy, oz);
  owner.localToWorld(l.position.copy(l.userData.off));
  return l;
}
function releaseLight(l) { if (!l || l.userData.ghost) return; l.userData.owner = null; l.intensity = 0; }
function syncLights() {                   // 주인을 따라가고, 주인이 씬에서 사라졌으면 자동 반납
  for (const l of lightPool) {
    const o = l.userData.owner; if (!o) continue;
    if (!lightAttached(o)) { releaseLight(l); continue; }
    o.localToWorld(l.position.copy(l.userData.off));
  }
}
scene.add(worldGroup);

function groundTexture(rep) {
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
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
  return t;
}
function noiseTexture(draw, size = 512, rep = 1) {   // 캔버스로 만드는 디테일 텍스처
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep);
  t.anisotropy = 4;
  return t;
}
function wallTexture() {                 // 패널 이음새 + 긁힘 + 얼룩
  return noiseTexture((g, S) => {
    g.fillStyle = '#2b3547'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {     // 거친 표면
      const v = 30 + Math.random() * 30;
      g.fillStyle = `rgba(${v},${v + 8},${v + 18},${0.12 + Math.random() * 0.2})`;
      g.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 5, 1 + Math.random() * 3);
    }
    g.strokeStyle = 'rgba(12,16,24,0.75)'; g.lineWidth = 3;   // 패널 이음새
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * S / 4); g.lineTo(S, i * S / 4); g.stroke(); }
    for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * S / 2, 0); g.lineTo(i * S / 2, S); g.stroke(); }
    g.strokeStyle = 'rgba(80,96,120,0.35)'; g.lineWidth = 1;   // 이음새 하이라이트
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * S / 4 + 3); g.lineTo(S, i * S / 4 + 3); g.stroke(); }
    for (let i = 0; i < 40; i++) {       // 긁힌 자국
      g.strokeStyle = `rgba(150,165,190,${0.08 + Math.random() * 0.12})`; g.lineWidth = 1;
      const x = Math.random() * S, y = Math.random() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 24); g.stroke();
    }
    for (let i = 0; i < 14; i++) {       // 얼룩
      const r = 20 + Math.random() * 60, x = Math.random() * S, y = Math.random() * S;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(8,10,14,0.35)'); gr.addColorStop(1, 'rgba(8,10,14,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 18; i++) {       // 리벳
      g.fillStyle = 'rgba(140,155,180,0.55)';
      g.beginPath(); g.arc((i % 6) * S / 6 + S / 12, Math.floor(i / 6) * S / 3 + S / 6, 3, 0, Math.PI * 2); g.fill();
    }
  });
}
function floorDetailTexture() {          // 금속 타일 + 마모 + 먼지
  return noiseTexture((g, S) => {
    g.fillStyle = '#151a22'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 4000; i++) {
      const v = 16 + Math.random() * 22;
      g.fillStyle = `rgba(${v},${v + 4},${v + 10},${0.15 + Math.random() * 0.25})`;
      g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 4, 1 + Math.random() * 4);
    }
    g.strokeStyle = '#0d1118'; g.lineWidth = 3;               // 타일 홈
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, S); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(S, i * 64); g.stroke();
    }
    g.strokeStyle = 'rgba(70,84,104,0.35)'; g.lineWidth = 1;   // 타일 모서리 빛
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(i * 64 + 2, 0); g.lineTo(i * 64 + 2, S); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64 + 2); g.lineTo(S, i * 64 + 2); g.stroke();
    }
    for (let i = 0; i < 10; i++) {       // 마모된 자리
      const r = 30 + Math.random() * 70, x = Math.random() * S, y = Math.random() * S;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(60,72,90,0.22)'); gr.addColorStop(1, 'rgba(60,72,90,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.fillStyle = 'rgba(126,224,163,0.07)';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * S, Math.random() * S, 3, 3);
  });
}
const groundMat = new THREE.MeshStandardMaterial({ map: floorDetailTexture(), roughness: 0.9, metalness: 0.08 });
groundMat.map.repeat.set(20, 20);
const floorMat = new THREE.MeshStandardMaterial({ map: floorDetailTexture(), roughness: 0.9, metalness: 0.08 });
const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.78, metalness: 0.12 });
wallMat.map.repeat.set(1, 1.5);
const edgeMat = new THREE.MeshStandardMaterial({ color: 0x35a06a, emissive: 0x2ee88a, emissiveIntensity: 2.4, toneMapped: false });   // 발광 띠

const obMat = new THREE.MeshStandardMaterial({ color: 0x3a4759, roughness: 0.7, metalness: 0.15 });
const platMat = new THREE.MeshStandardMaterial({ color: 0x2f5946, roughness: 0.6, metalness: 0.1 });

// ---------- 지형 오브젝트: 10초 주기로 위/아래 이동(2초 내) ----------
const obstacles = [];
const LIFT_H = 2.6, LIFT_PERIOD = 10, LIFT_DUR = 2;
let liftClock = 0;
function addLiftBox(x, z, w, d, h, platform, i) {
  const grp = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), platform ? platMat : obMat);
  box.position.y = h / 2; box.castShadow = true; box.receiveShadow = true;
  grp.add(box);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, 0.08, d * 1.03), edgeMat);
  strip.position.y = h + 0.04;
  grp.add(strip);
  grp.position.set(x, 0, z);
  worldGroup.add(grp);
  // 짝수는 0초, 홀수는 5초 오프셋으로 번갈아 오르내림. 내려오면 바닥(yOff 0)이라 적이 접근·공격 가능
  obstacles.push({ grp, x, z, w, d, h, platform, yOff: 0, raised: false, phase: (i % 2) * (LIFT_PERIOD / 2), moving: false, from: 0, to: 0, t: 0 });
}
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

// 바닥 조각 (타일 UV를 실제 크기에 맞춰 반복)
function floorMesh(w, d) {
  const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 8, uv.getY(i) * d / 8);
  const m = new THREE.Mesh(geo, floorMat);
  m.receiveShadow = true;
  return m;
}
function setSunBounds(ext) {
  sun.shadow.camera.left = -ext; sun.shadow.camera.right = ext;
  sun.shadow.camera.top = ext; sun.shadow.camera.bottom = -ext;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;         // 지형이 바뀌면 정적 그림자 맵을 다시 굽는다
  cullTick = 1;                          // 다음 프레임에 거리 컬링 즉시
}
function clearWorld() {
  for (const o of [...worldGroup.children]) {
    worldGroup.remove(o);
    o.traverse(c => { if (c.geometry) c.geometry.dispose(); });
  }
  obstacles.length = 0; mapRects = []; lavaRects = []; walkGrid = null; spawnPoints = []; flowField = null;
  for (const l of lightPool) if (l.userData.owner === worldGroup) releaseLight(l);   // 지형에 붙은 조명(어두운 방 램프) 반납
  clearPortal();
}

const PLAZA_H = 20;                      // 광장 벽 높이 = 천장 높이
const ceilMat = new THREE.MeshStandardMaterial({ color: 0x232a36, roughness: 1 });
const rockMat2 = new THREE.MeshStandardMaterial({ color: 0x36415a, roughness: 0.85 });
function buildPlaza() {
  const ground = new THREE.Mesh(new THREE.CircleGeometry(ARENA + 6, 64).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true; worldGroup.add(ground);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(3, PLAZA_H, 11.5), wallMat);
    wall.position.set(Math.cos(a) * (ARENA + 1.5), PLAZA_H / 2, Math.sin(a) * (ARENA + 1.5));
    wall.rotation.y = -a; wall.castShadow = false; wall.receiveShadow = true;   // 높은 벽이 해를 가리지 않게
    worldGroup.add(wall);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.15, 11.6), edgeMat);   // 눈높이 띠는 그대로 7m
    strip.position.set(wall.position.x, 7.05, wall.position.z); strip.rotation.y = -a;
    worldGroup.add(strip);
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.15, 11.6), edgeMat);     // 천장 맞닿는 테두리
    top.position.set(wall.position.x, PLAZA_H - 0.1, wall.position.z); top.rotation.y = -a;
    worldGroup.add(top);
  }
  // 천장 (빛은 가리지 않는다 — 그림자를 드리우면 광장 전체가 어두워진다)
  const ceil = new THREE.Mesh(new THREE.CircleGeometry(ARENA + 6, 48).rotateX(Math.PI / 2), ceilMat);
  ceil.position.y = PLAZA_H;
  ceil.castShadow = false; ceil.receiveShadow = false;
  worldGroup.add(ceil);
  // 천장에서 내려온 종유석 발판 — 리본으로 옮겨 다닌다
  const rnd = (a, b) => a + Math.random() * (b - a);
  const STAL = 14;
  for (let i = 0; i < STAL; i++) {
    const a = (i / STAL) * Math.PI * 2 + rnd(-0.16, 0.16);
    const r = rnd(8, ARENA - 8);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = rnd(2.6, 4.2), d = rnd(2.6, 4.2);
    const bottom = rnd(3.1, 8.4);          // 기둥 아랫면 높이 — 발판은 없다 (올라설 수 있다는 느낌을 주지 않게)
    const grp = new THREE.Group();
    const stemH = PLAZA_H - bottom;        // 천장까지 이어지는 종유석 몸통
    const stem = new THREE.Mesh(new THREE.ConeGeometry(Math.min(w, d) * 0.46, stemH, 6), rockMat2);
    stem.position.y = stemH / 2;
    stem.rotation.y = rnd(0, Math.PI);
    stem.castShadow = true;
    grp.add(stem);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(Math.min(w, d) * 0.3, 1.2, 6), rockMat2);   // 아래로 뾰족한 끝
    tip.position.y = -0.6; tip.rotation.x = Math.PI;
    grp.add(tip);
    grp.position.set(x, bottom, z);        // 기둥 아랫면 기준
    worldGroup.add(grp);
    const stemW = Math.min(w, d) * 0.8;
    obstacles.push({ grp, x, z, w: stemW, d: stemW, h: stemH, yOff: bottom, noStand: true,   // 어떤 방법으로도 서지 못한다 · 리본은 찍히되 통과 불가
      raised: false, phase: 1e9, moving: false, from: 0, to: 0, t: 0 });
  }
  buildSky();                            // 광장에서도 우주·오로라
  mapRadius = ARENA;
  playerStart.set(0, 0, 0);
  scene.fog.far = 90;
  setSunBounds(45);
}

// 절차 생성: 방(10~50m) + 복도(폭 2~4m, 길이 2~20m). 좌표는 전부 정수 → 격자와 정확히 일치
function buildRandom(seed) {
  mapSeed = seed || newSeed();
  rngState = seedFromString(mapSeed);
  const rnd = (a, b) => a + srand() * (b - a);
  const ri = (a, b) => a + Math.floor(srand() * (b - a + 1));
  const rsize = () => Math.round(10 + Math.pow(srand(), 1.15) * 40);  // 10~50m (고르게 — 평균 약 30m)
  const over = (a, b, m) => a.x0 - m < b.x1 && b.x0 - m < a.x1 && a.z0 - m < b.z1 && b.z0 - m < a.z1;
  const w0 = rsize(), d0 = rsize();
  const rooms = [{ x0: -(w0 >> 1), z0: -(d0 >> 1), x1: -(w0 >> 1) + w0, z1: -(d0 >> 1) + d0 }];
  const cors = [];
  const TARGET = 11 + Math.floor(srand() * 4) + Math.min(5, floorNo - 1);   // 방 11~14개 (+층당 1, 최대 +5)
  for (let guard = 0; rooms.length < TARGET && guard < 2500; guard++) {
    const tail = rooms.length > 3 && srand() < 0.75 ? rooms.slice(-3) : rooms;   // 최근 방에 이어 붙여 경로를 길게
    const base = tail[(srand() * tail.length) | 0];
    const dir = (srand() * 4) | 0;                   // 0:+x 1:-x 2:+z 3:-z
    const w = rsize(), d = rsize();
    const cw = ri(2, 4), cl = ri(5, 20);             // 복도 폭·길이(간격 확보)
    let room, cor;
    if (dir < 2) {
      const z0 = ri(base.z0 - d + cw + 2, base.z1 - cw - 2);
      room = dir === 0
        ? { x0: base.x1 + cl, z0, x1: base.x1 + cl + w, z1: z0 + d }
        : { x0: base.x0 - cl - w, z0, x1: base.x0 - cl, z1: z0 + d };
      const lo = Math.max(base.z0, room.z0), hi = Math.min(base.z1, room.z1) - cw;
      if (hi < lo) continue;
      const cz = ri(lo, hi);
      cor = dir === 0
        ? { x0: base.x1, z0: cz, x1: base.x1 + cl, z1: cz + cw }
        : { x0: base.x0 - cl, z0: cz, x1: base.x0, z1: cz + cw };
    } else {
      const x0 = ri(base.x0 - w + cw + 2, base.x1 - cw - 2);
      room = dir === 2
        ? { x0, z0: base.z1 + cl, x1: x0 + w, z1: base.z1 + cl + d }
        : { x0, z0: base.z0 - cl - d, x1: x0 + w, z1: base.z0 - cl };
      const lo = Math.max(base.x0, room.x0), hi = Math.min(base.x1, room.x1) - cw;
      if (hi < lo) continue;
      const cx = ri(lo, hi);
      cor = dir === 2
        ? { x0: cx, z0: base.z1, x1: cx + cw, z1: base.z1 + cl }
        : { x0: cx, z0: base.z0 - cl, x1: cx + cw, z1: base.z0 };
    }
    if (rooms.some(r => over(r, room, 2))) continue;                    // 방끼리 최소 2m 이격
    if (rooms.some(r => r !== base && over(r, cor, 0))) continue;       // 복도가 다른 방을 관통 금지
    if (cors.some(c => over(c, cor, 0))) continue;
    rooms.push(room); cors.push(cor);
  }
  mapRects = [...rooms.map(r => ({ ...r, room: true })), ...cors.map(c => ({ ...c, room: false }))];

  // 격자 래스터화 (1m 셀)
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const r of mapRects) {
    minX = Math.min(minX, r.x0); maxX = Math.max(maxX, r.x1);
    minZ = Math.min(minZ, r.z0); maxZ = Math.max(maxZ, r.z1);
  }
  const pad = 3;
  const ox = minX - pad, oz = minZ - pad;
  const gw = (maxX + pad) - ox, gh = (maxZ + pad) - oz;
  const cells = new Uint8Array(gw * gh);
  for (const r of mapRects)
    for (let j = r.z0 - oz; j < r.z1 - oz; j++)
      for (let i = r.x0 - ox; i < r.x1 - ox; i++) cells[j * gw + i] = 1;
  walkGrid = { cells, gw, gh, ox, oz };

  // 용암 구역 고르기 — 복도(11단계~) · 방 전체(13단계~)
  lavaRects = [];
  if (floorNo >= LAVA_FLOOR) {
    const cors2 = mapRects.filter(r => !r.room);
    for (const c of cors2) if (srand() < 0.3) lavaRects.push({ ...c });          // 복도 30%
    if (floorNo >= LAVA_ROOM_FLOOR) {
      const cand = mapRects.filter((r, i) => r.room && i > 0);                   // 시작 방은 제외
      const n = 1 + (srand() < 0.5 ? 1 : 0);
      for (let i = 0; i < n && cand.length; i++) {
        const r = cand.splice((srand() * cand.length) | 0, 1)[0];
        lavaRects.push({ ...r, room: true });
      }
    }
  }
  // 바닥
  for (const r of mapRects) {
    const lava = lavaRects.some(l => l.x0 === r.x0 && l.z0 === r.z0 && l.x1 === r.x1 && l.z1 === r.z1);
    if (lava) {                          // 용암 바닥
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0).rotateX(-Math.PI / 2), lavaMat);
      m.position.set((r.x0 + r.x1) / 2, 0.02, (r.z0 + r.z1) / 2);
      worldGroup.add(m);
      continue;
    }
    const m = floorMesh(r.x1 - r.x0, r.z1 - r.z0);
    m.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
    worldGroup.add(m);
  }
  for (const l of lavaRects) {           // 용암 방에는 건너다닐 구조물을 흩뿌린다
    if (!l.room) continue;
    const w = l.x1 - l.x0, d = l.z1 - l.z0;
    const n = Math.max(4, Math.min(10, Math.round(w * d / 90)));
    for (let i = 0; i < n; i++) {
      const bw = 2 + srand() * 3, bd = 2 + srand() * 3, bh = 1.2 + srand() * 2.4;
      const x = l.x0 + 2 + srand() * Math.max(0.1, w - 4 - bw);
      const z = l.z0 + 2 + srand() * Math.max(0.1, d - 4 - bd);
      const grp = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), platMat);
      box.position.y = bh / 2; box.castShadow = true; box.receiveShadow = true;
      grp.add(box);
      grp.position.set(x + bw / 2, 0, z + bd / 2);
      worldGroup.add(grp);
      obstacles.push({ grp, x: x + bw / 2, z: z + bd / 2, w: bw, d: bd, h: bh, platform: true,
        yOff: 0, raised: false, phase: 1e9, moving: false, from: 0, to: 0, t: 0 });   // 오르내리지 않는 고정 발판
    }
  }
  // 벽 (바닥에 인접한 빈 셀 — 8방향으로 모서리까지 채운다)
  const wc = [];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    if (cells[j * gw + i]) continue;
    let touch = false;
    for (let b = -1; b <= 1 && !touch; b++) for (let a = -1; a <= 1; a++) {
      const ni = i + a, nj = j + b;
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
      if (cells[nj * gw + ni]) { touch = true; break; }
    }
    if (touch) wc.push([ox + i + 0.5, oz + j + 0.5]);
  }
  // 1m 벽 칸을 이어 붙여 큰 직사각형 벽으로 병합 — 블록 수가 수천 → 수백, 그림자도 벽 하나로 떨어진다
  const wallCells = new Set(wc.map(([x, z]) => Math.round(x - ox - 0.5) + ',' + Math.round(z - oz - 0.5)));
  const usedCell = new Set();
  const wallRects = [];
  const cellList = wc.map(([x, z]) => [Math.round(x - ox - 0.5), Math.round(z - oz - 0.5)]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const free = (i, j) => wallCells.has(i + ',' + j) && !usedCell.has(i + ',' + j);
  for (const [i, j] of cellList) {
    if (!free(i, j)) continue;
    let w = 1; while (free(i + w, j)) w++;                    // 가로로 최대한
    let d = 1;                                               // 같은 폭으로 세로로 최대한
    outer: while (true) {
      for (let a = 0; a < w; a++) if (!free(i + a, j + d)) break outer;
      d++;
    }
    for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) usedCell.add((i + a) + ',' + (j + b));
    wallRects.push({ i, j, w, d });
  }
  for (const r of wallRects) {
    const w = r.w, d = r.d;
    const geo = new THREE.BoxGeometry(w + 0.02, WALL_H, d + 0.02);
    const uv = geo.attributes.uv;                            // 긴 벽은 텍스처를 길이만큼 반복
    for (let k = 0; k < uv.count; k++) {
      const face = Math.floor(k / 4);                        // 0,1:±x  2,3:±y  4,5:±z
      const su = face < 2 ? d : face < 4 ? w : w;
      const sv = face >= 2 && face < 4 ? d : 1;
      uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
    }
    const cx = ox + r.i + w / 2, cz = oz + r.j + d / 2;
    const wall = new THREE.Mesh(geo, wallMat);
    wall.position.set(cx, WALL_H / 2, cz);
    wall.castShadow = true; wall.receiveShadow = true;
    worldGroup.add(wall);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.14, d + 0.06), edgeMat);   // 위 발광 띠
    cap.position.set(cx, WALL_H + 0.07, cz);
    worldGroup.add(cap);
  }

  // 방 테마 — 같은 알고리즘이라도 방마다 성격이 달라진다
  const THEMES = ['pillar', 'lift', 'dark', 'open'];
  let li = 0;
  spawnPoints = [];
  roomThemes = [];
  for (let idx = 0; idx < rooms.length; idx++) {
    const r = rooms[idx];
    const w = r.x1 - r.x0, d = r.z1 - r.z0, small = Math.min(w, d) < 14;
    const theme = idx === 0 ? 'open' : (small ? (srand() < 0.5 ? 'dark' : 'open') : THEMES[(srand() * THEMES.length) | 0]);
    roomThemes.push(theme);
    if (theme === 'pillar') {                     // 기둥 숲: 엄폐물 많은 교전장
      const cnt = Math.min(9, Math.max(3, Math.floor(w * d / 90)));
      for (let k = 0; k < cnt; k++) {
        const px = rnd(r.x0 + 2.5, r.x1 - 2.5), pz = rnd(r.z0 + 2.5, r.z1 - 2.5);
        const pw = rnd(1.2, 2.2);
        const pil = new THREE.Mesh(new THREE.BoxGeometry(pw, WALL_H, pw), wallMat);
        pil.position.set(px, WALL_H / 2, pz);
        pil.castShadow = true; pil.receiveShadow = true;
        worldGroup.add(pil);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(pw * 1.08, 0.12, pw * 1.08), edgeMat);
        cap.position.set(px, WALL_H + 0.06, pz);
        worldGroup.add(cap);
        for (let j = Math.round(pz - pw / 2 - oz); j < Math.round(pz + pw / 2 - oz); j++)
          for (let i = Math.round(px - pw / 2 - ox); i < Math.round(px + pw / 2 - ox); i++)
            if (i >= 0 && j >= 0 && i < gw && j < gh) cells[j * gw + i] = 0;   // 기둥은 벽으로
      }
    } else if (theme === 'lift') {                // 승강 플랫폼 방
      const cnt = Math.min(4, Math.max(2, Math.floor(Math.min(w, d) / 10)));
      for (let k = 0; k < cnt; k++) {
        const platform = li % 2 === 0;
        addLiftBox(rnd(r.x0 + 3, r.x1 - 3), rnd(r.z0 + 3, r.z1 - 3),
          rnd(platform ? 2.4 : 1.6, 4), rnd(platform ? 2.4 : 1.6, 4),
          platform ? rnd(0.8, 1.0) : rnd(1.2, 4.2), platform, li++);
      }
    } else if (theme === 'dark') {                // 어두운 방: 붉은 조명만
      borrowLight(0xff4433, 6, Math.max(w, d) * 0.9, worldGroup, (r.x0 + r.x1) / 2, 3.2, (r.z0 + r.z1) / 2);
      const floorDark = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x05070b, transparent: true, opacity: 0.62 }));
      floorDark.position.set((r.x0 + r.x1) / 2, 0.02, (r.z0 + r.z1) / 2);
      worldGroup.add(floorDark);
      if (!small) addLiftBox(rnd(r.x0 + 3, r.x1 - 3), rnd(r.z0 + 3, r.z1 - 3), rnd(1.6, 3.4), rnd(1.6, 3.4), rnd(1.4, 3.4), false, li++);
    }
    const sn = Math.max(2, Math.floor(w * d / 300));
    for (let k = 0; k < sn; k++) spawnPoints.push({ x: rnd(r.x0 + 2, r.x1 - 2), z: rnd(r.z0 + 2, r.z1 - 2) });
  }
  playerStart.set((rooms[0].x0 + rooms[0].x1) / 2, 0, (rooms[0].z0 + rooms[0].z1) / 2);
  // B 지점: A에서 실제 이동거리가 가장 먼 방의 중심에 포탈
  const td = travelDistances(playerStart.x, playerStart.z);
  let far = null, farD = -1; portalTravel = 0;
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const gi = Math.floor(cx - ox), gj = Math.floor(cz - oz);
    const d = (gi >= 0 && gj >= 0 && gi < gw && gj < gh) ? td[gj * gw + gi] : -1;
    if (d > farD) { farD = d; far = { x: cx, z: cz }; }
  }
  if (far) {
    makePortal(far.x, far.z); portalTravel = farD;
    if (floorNo % 5 === 0) setPortalLock(true);   // 보스 층: 보스를 잡아야 열린다
  }
  mapRadius = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minZ), Math.abs(maxZ));
  scene.fog.far = 120;
  buildSky();                            // 위가 뚫린 지형 — 우주와 오로라
  setSunBounds(Math.min(140, mapRadius + 14));
  const sd = document.getElementById('seedTag');
  if (sd) { sd.textContent = 'SEED ' + mapSeed; sd.style.display = 'block'; }
  syncDbgPieces();                       // 시드로 직접 지을 때도 조각 표시 갱신
}

// 격자 이동거리(BFS) — 직선거리가 아니라 실제로 걸어가는 거리
function travelDistances(sx, sz) {
  const g = walkGrid; if (!g) return null;
  const N = g.gw * g.gh;
  const dist = new Int32Array(N).fill(-1);
  let i0 = Math.floor(sx - g.ox), j0 = Math.floor(sz - g.oz);
  const ok = (i, j) => i >= 0 && j >= 0 && i < g.gw && j < g.gh && g.cells[j * g.gw + i];
  if (!ok(i0, j0)) {
    let found = false;
    for (let r = 1; r <= 4 && !found; r++)
      for (let b = -r; b <= r && !found; b++)
        for (let a = -r; a <= r && !found; a++)
          if (ok(i0 + a, j0 + b)) { i0 += a; j0 += b; found = true; }
    if (!found) return dist;
  }
  const q = new Int32Array(N);
  let head = 0, tail = 0;
  const st = j0 * g.gw + i0; dist[st] = 0; q[tail++] = st;
  while (head < tail) {
    const cur = q[head++], ci = cur % g.gw, cj = (cur / g.gw) | 0;
    for (const [a, b] of FLOW_DIRS) {
      const ni = ci + a, nj = cj + b;
      if (!ok(ni, nj)) continue;
      const idx = nj * g.gw + ni;
      if (dist[idx] >= 0) continue;
      dist[idx] = dist[cur] + 1;
      q[tail++] = idx;
    }
  }
  return dist;
}
function clearPortal() { if (portal) scene.remove(portal.grp); portal = null; }
function lockTexture() {                 // 자물쇠 아이콘 (스프라이트)
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.font = '92px system-ui, "Segoe UI Emoji"';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('🔒', 64, 70);
  return new THREE.CanvasTexture(cv);
}
function makePortal(x, z) {              // 다음 층으로 가는 문
  clearPortal();
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x8f5bff, transparent: true, opacity: 0.5, depthWrite: false, fog: false, toneMapped: false });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 16, 20, 1, true), mat);
  col.position.y = 8;
  grp.add(col);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.1, 10, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xc79bff, fog: false, toneMapped: false }));
  ring.position.y = 0.07;
  grp.add(ring);
  const lamp = borrowLight(0x9b6bff, 4, 14, grp, 0, 2, 0);
  const lock = new THREE.Sprite(new THREE.SpriteMaterial({
    map: lockTexture(), transparent: true, depthWrite: false, fog: false, toneMapped: false
  }));
  lock.scale.set(2.2, 2.2, 1);
  lock.position.y = 3.2;
  lock.visible = false;
  grp.add(lock);
  grp.position.set(x, 0, z);
  scene.add(grp);
  portal = { grp, col, ring, lamp, lock, x, z, t: 0, locked: false };
}
function setPortalLock(v) {              // 잠김: 빨강 · 더 투명 · 바닥 원 없음 · 자물쇠
  if (!portal) return;
  portal.locked = v;
  portal.col.material.color.setHex(v ? 0xff2a1a : 0x8f5bff);
  portal.col.material.opacity = v ? 0.22 : 0.5;
  portal.ring.visible = !v;
  portal.lamp.color.setHex(v ? 0xff3322 : 0x9b6bff);
  portal.lamp.intensity = v ? 2.5 : 4;
  portal.lock.visible = v;
}
function unlockPortal() {
  if (!portal || !portal.locked) return;
  setPortalLock(false);
  burst(new THREE.Vector3(portal.x, 1.2, portal.z), 0xc79bff, 24);
  banner('🔓 포탈 개방!');
  toast('🔓 포탈이 열렸다');
  sfxChest();
}

let dbgPieces = false, dbgPiecesGrp = null;
const PIECE_MATS = {
  wall: new THREE.LineBasicMaterial({ color: 0x39f6ff, transparent: true, opacity: 0.95, depthTest: false, fog: false, toneMapped: false }),
  floor: new THREE.LineBasicMaterial({ color: 0xffd76b, transparent: true, opacity: 0.95, depthTest: false, fog: false, toneMapped: false }),
  lava: new THREE.LineBasicMaterial({ color: 0xff7a3a, transparent: true, opacity: 0.95, depthTest: false, fog: false, toneMapped: false }),
};
function syncDbgPieces() {               // 디버그: 벽·바닥 조각의 윤곽선을 겹쳐 그린다 (벽 통과해서도 보임)
  if (dbgPiecesGrp) {
    scene.remove(dbgPiecesGrp);
    dbgPiecesGrp.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    dbgPiecesGrp = null;
  }
  if (!dbgPieces) return;
  dbgPiecesGrp = new THREE.Group();
  dbgPiecesGrp.renderOrder = 999;
  for (const o of worldGroup.children) {
    if (!o.isMesh || !o.geometry) continue;
    const kind = o.material === wallMat ? 'wall' : (o.material === floorMat || o.material === groundMat) ? 'floor' : o.material === lavaMat ? 'lava' : null;
    if (!kind) continue;
    const ln = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry), PIECE_MATS[kind]);
    ln.position.copy(o.position); ln.rotation.copy(o.rotation); ln.scale.copy(o.scale);
    ln.renderOrder = 999;
    ln.userData.kind = kind;
    dbgPiecesGrp.add(ln);
  }
  scene.add(dbgPiecesGrp);
}
function buildMap() {
  clearWorld();
  seenRects.clear();
  liftClock = 0;
  if (mapMode === 'random') buildRandom(); else {
    mapSeed = ''; roomThemes = [];
    const sd = document.getElementById('seedTag');
    if (sd) sd.style.display = 'none';
    buildPlaza();
  }
  syncDbgPieces();                       // 디버그 조각 표시가 켜져 있으면 새 지형에 맞춰 다시
}

// ---------- 격자 헬퍼 ----------
function cellSolid(x, z) {
  const g = walkGrid; if (!g) return false;
  const i = Math.floor(x - g.ox), j = Math.floor(z - g.oz);
  if (i < 0 || j < 0 || i >= g.gw || j >= g.gh) return true;
  return !g.cells[j * g.gw + i];
}
function gridRayT(o, d, maxT) {       // 벽에 막히는 거리(없으면 null)
  if (!walkGrid) return null;
  let outside = false;                // 시작점이 벽 속이면 벗어난 뒤부터 판정
  for (let t = 0.2; t < maxT; t += 0.25) {
    const y = o.y + d.y * t;
    const solid = y <= WALL_H && cellSolid(o.x + d.x * t, o.z + d.z * t);
    if (!outside) { if (!solid) outside = true; continue; }
    if (solid) return t;
  }
  return null;
}
// 두 지점 사이가 벽 없이 트여 있는가
function losClear(ax, az, bx, bz) {
  if (!walkGrid) return true;
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
  for (let t = 0.4; t < L; t += 0.4) if (cellSolid(ax + dx * t / L, az + dz * t / L)) return false;
  return true;
}
function obstacleBlocksEnemy(o, en) {     // 이 구조물이 이 적을 막는가 (넘어갈 수 있는 낮은 발판·머리 위는 제외)
  if (o.yOff + o.h <= 0.45) return false;                 // 발밑 — 올라선다
  if (o.yOff > 2.4 * (en.scale || 1)) return false;       // 머리 위로 지나간다
  return true;
}
function obstacleInWay(ax, az, bx, bz, en) {   // 둘 사이를 구조물이 가로막는가
  for (const o of obstacles) {
    if (!obstacleBlocksEnemy(o, en)) continue;
    if (segHitsRect(ax, az, bx, bz, { x0: o.x - o.w / 2, z0: o.z - o.d / 2, x1: o.x + o.w / 2, z1: o.z + o.d / 2 }, 0.5)) return true;
  }
  return false;
}
function steerAroundObstacles(en, p, mvx, mvz) {   // 구조물에 붙으면 옆면을 따라 흘러간다
  const R = 0.6 * (en.scale || 1) + 0.4;
  for (const o of obstacles) {
    if (!obstacleBlocksEnemy(o, en)) continue;
    const hw = o.w / 2 + R, hd = o.d / 2 + R;
    const dx = p.x - o.x, dz = p.z - o.z;
    const ax = dx + mvx * 1.6, az = dz + mvz * 1.6;         // 한 걸음 앞을 내다본다
    const near = Math.abs(dx) < hw && Math.abs(dz) < hd;
    const ahead = Math.abs(ax) < hw && Math.abs(az) < hd;
    if (!near && !ahead) continue;                          // 아직 멀다
    if (dx * -mvx + dz * -mvz <= 0) continue;               // 멀어지는 중이면 그대로
    const px = hw - Math.abs(dx), pz = hd - Math.abs(dz);   // 어느 면에 더 가까운가
    let nx = 0, nz = 0;
    if (px < pz) nx = Math.sign(dx) || 1; else nz = Math.sign(dz) || 1;
    const toPx = player.pos.x - p.x, toPz = player.pos.z - p.z;
    const use1 = (-nz * toPx + nx * toPz) >= (nz * toPx - nx * toPz);   // 플레이어에 가까워지는 접선
    const tx = use1 ? -nz : nz, tz = use1 ? nx : -nx;
    mvx = mvx * 0.2 + tx + nx * 0.35;
    mvz = mvz * 0.2 + tz + nz * 0.35;
    const L = Math.hypot(mvx, mvz) || 1; mvx /= L; mvz /= L;
  }
  return { x: mvx, z: mvz };
}
const DRAW_DIST = 70;                    // 이 거리 밖의 지형·적은 그리지 않는다 (안개 끝보다 안쪽)
let cullTick = 0;
const _cullC = new THREE.Vector3();
function cullWorld(dt) {                 // 월드 오브젝트를 0.2초마다 거리로 켜고 끈다
  cullTick += dt;
  if (cullTick < 0.2) return;
  cullTick = 0;
  const px = player.pos.x, pz = player.pos.z;
  for (const o of worldGroup.children) {
    let r = 30;                          // 경계구가 없는 그룹은 넉넉히
    if (o.isInstancedMesh && o.boundingSphere) { _cullC.copy(o.boundingSphere.center); r = o.boundingSphere.radius; }
    else if (o.geometry?.boundingSphere) { _cullC.copy(o.geometry.boundingSphere.center).multiply(o.scale).add(o.position); r = o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.z); }
    else _cullC.copy(o.position);
    if (r > 60) { o.visible = true; continue; }        // 바닥·천장처럼 큰 것은 항상
    const dx = _cullC.x - px, dz = _cullC.z - pz;
    o.visible = Math.hypot(dx, dz) - r < DRAW_DIST;
  }
}
const SAFE_T = 10;                      // 층 도착 후 이 시간 동안은 도착한 방에 스폰하지 않는다
let safeRoom = null, safeUntil = 0;
function roomAt(x, z) { return mapRects.find(r => r.room && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) || null; }
function inSafeRoom(x, z) {
  if (!safeRoom || gameTime >= safeUntil) return false;
  return x >= safeRoom.x0 - 1 && x <= safeRoom.x1 + 1 && z >= safeRoom.z0 - 1 && z <= safeRoom.z1 + 1;
}
function pickSpawn() {                // 적 스폰 위치 (규칙은 광장과 동일, 위치만 맵에 맞춤)
  if (walkGrid && spawnPoints.length) {
    let best = spawnPoints[0], bestScore = -1e9;
    for (let i = 0; i < 10; i++) {
      const c = spawnPoints[(Math.random() * spawnPoints.length) | 0];
      const d = Math.hypot(c.x - player.pos.x, c.z - player.pos.z);
      let score = d < 12 ? d - 100 : -Math.abs(d - 28);     // 12m 이상, 28m 부근 선호
      if (inSafeRoom(c.x, c.z)) score -= 1000;              // 도착 직후의 방은 피한다
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return { x: best.x + (Math.random() - 0.5) * 3, z: best.z + (Math.random() - 0.5) * 3 };
  }
  const a = Math.random() * Math.PI * 2, r = ARENA - 10;   // 광장: 외벽 10m 안쪽
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

// ---------- 플로우 필드: 적이 방·복도를 따라 플레이어에게 접근 ----------
let flowField = null, flowTimer = 0;
const FLOW_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
let flowBlock = null;                    // 길찾기에서만 막는 칸 (구조물) — 실제 통행 격자는 그대로 둔다
function markFlowBlocks(g) {
  const N = g.gw * g.gh;
  if (!flowBlock || flowBlock.length !== N) flowBlock = new Uint8Array(N);
  flowBlock.fill(0);
  for (const o of obstacles) {
    if (o.yOff + o.h <= 0.45 || o.yOff > 2.0) continue;   // 올라설 수 있는 낮은 발판·머리 위는 통과
    const i0 = Math.floor(o.x - o.w / 2 - 0.3 - g.ox), i1 = Math.floor(o.x + o.w / 2 + 0.3 - g.ox);
    const j0 = Math.floor(o.z - o.d / 2 - 0.3 - g.oz), j1 = Math.floor(o.z + o.d / 2 + 0.3 - g.oz);
    for (let j = Math.max(0, j0); j <= Math.min(g.gh - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(g.gw - 1, i1); i++) flowBlock[j * g.gw + i] = 1;
  }
}
function rebuildFlow() {
  const g = walkGrid; if (!g) { flowField = null; flowBlock = null; return; }
  const N = g.gw * g.gh;
  if (!flowField || flowField.length !== N) flowField = new Int8Array(N);
  flowField.fill(-1);
  markFlowBlocks(g);                     // 구조물은 벽처럼 돌아가게
  let pi = Math.floor(player.pos.x - g.ox), pj = Math.floor(player.pos.z - g.oz);
  const ok = (i, j) => i >= 0 && j >= 0 && i < g.gw && j < g.gh && g.cells[j * g.gw + i] && !flowBlock[j * g.gw + i];
  if (!ok(pi, pj)) {                   // 벽에 붙어 셀이 벽으로 계산되면 주변에서 가장 가까운 바닥을 시작점으로
    let found = false;
    for (let r = 1; r <= 3 && !found; r++)
      for (let b = -r; b <= r && !found; b++)
        for (let a = -r; a <= r && !found; a++)
          if (ok(pi + a, pj + b)) { pi += a; pj += b; found = true; }
    if (!found) return;
  }
  const seen = new Uint8Array(N), q = new Int32Array(N);
  let head = 0, tail = 0;
  const s = pj * g.gw + pi; seen[s] = 1; q[tail++] = s;
  while (head < tail) {
    const cur = q[head++], ci = cur % g.gw, cj = (cur / g.gw) | 0;
    for (let k = 0; k < 4; k++) {
      const ni = ci + FLOW_DIRS[k][0], nj = cj + FLOW_DIRS[k][1];
      if (ni < 0 || nj < 0 || ni >= g.gw || nj >= g.gh) continue;
      const idx = nj * g.gw + ni;
      if (seen[idx] || !g.cells[idx] || flowBlock[idx]) continue;
      seen[idx] = 1;
      flowField[idx] = k ^ 1;          // 이웃 → 현재 셀(=플레이어 쪽) 방향
      q[tail++] = idx;
    }
  }
}
function flowVec(x, z) {               // 다음 셀 중심을 향한 단위벡터
  const g = walkGrid; if (!g || !flowField) return null;
  const i = Math.floor(x - g.ox), j = Math.floor(z - g.oz);
  if (i < 0 || j < 0 || i >= g.gw || j >= g.gh) return null;
  const f = flowField[j * g.gw + i];
  if (f < 0) return null;
  const dx = (g.ox + i + FLOW_DIRS[f][0] + 0.5) - x, dz = (g.oz + j + FLOW_DIRS[f][1] + 0.5) - z;
  const L = Math.hypot(dx, dz) || 1;
  return { x: dx / L, z: dz / L };
}

function collideCircle(pos, radius, height = 1.7, feetY = 0, gridRadius = radius) {
  if (walkGrid) {                       // 랜덤맵: 벽 격자 밀어내기
    const g = walkGrid;
    const ci = Math.floor(pos.x - g.ox), cj = Math.floor(pos.z - g.oz);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const solid = (i < 0 || j < 0 || i >= g.gw || j >= g.gh) ? true : !g.cells[j * g.gw + i];
      if (!solid) continue;
      const cx = g.ox + i + 0.5, cz = g.oz + j + 0.5;
      const hw = 0.5 + gridRadius, dx = pos.x - cx, dz = pos.z - cz;
      if (Math.abs(dx) < hw && Math.abs(dz) < hw) {
        const px = hw - Math.abs(dx), pz = hw - Math.abs(dz);
        if (px < pz) pos.x += dx > 0 ? px : -px;
        else pos.z += dz > 0 ? pz : -pz;
      }
    }
  } else {                              // 광장: 원형 경계
    const R = Math.hypot(pos.x, pos.z);
    if (R > ARENA - 1) { pos.x *= (ARENA - 1) / R; pos.z *= (ARENA - 1) / R; }
  }
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
let supObs = null;                       // 지금 발을 받쳐 주는 구조물
function supportHeight(pos) {
  let s = 0; supObs = null;
  for (const o of obstacles) {
    if (Math.abs(pos.x - o.x) < o.w / 2 + 0.2 && Math.abs(pos.z - o.z) < o.d / 2 + 0.2) {
      // 리본 전용 발판: 리본으로 올라온 중이거나, 지금 그 위에 서 있을 때만 발판이 된다
      if (o.noStand) continue;                                  // 종유석 기둥: 절대 발판이 아니다
      if (o.ribbonOnly && !player.ribbonAir && o !== player.standObs) continue;
      const top = o.yOff + o.h;
      if (top <= pos.y + 0.45 && top > s) { s = top; supObs = o; }
    }
  }
  return s;
}
buildMap();

// ---------- audio (절차 생성) ----------
let AC = null, masterGain = null;
let sfxComp = null, sfxVerb = null, noiseBuf = null;
function audioInit() {
  if (AC) return;
  AC = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  sfxComp = AC.createDynamicsCompressor();   // 레이어가 겹쳐도 찌그러지지 않게
  sfxComp.threshold.value = -14; sfxComp.knee.value = 18; sfxComp.ratio.value = 6; sfxComp.attack.value = 0.002; sfxComp.release.value = 0.12;
  masterGain = AC.createGain(); masterGain.gain.value = 0.35;
  masterGain.connect(sfxComp); sfxComp.connect(AC.destination);
  sfxVerb = AC.createDelay(0.4); sfxVerb.delayTime.value = 0.085;   // 짧은 공간 울림 (슬랩백)
  const fb = AC.createGain(); fb.gain.value = 0.28;
  const vlp = AC.createBiquadFilter(); vlp.type = 'lowpass'; vlp.frequency.value = 1800;
  const vg = AC.createGain(); vg.gain.value = 0.22;
  sfxVerb.connect(vlp); vlp.connect(fb); fb.connect(sfxVerb); vlp.connect(vg); vg.connect(masterGain);
  noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  decodeSfx();
}
// ---------- 샘플 효과음 (assets/sound/*.wav — 카운터 스트라이크 무기음) ----------
const SFX_FILES = {
  m4: 'm4a1-1', m4out: 'm4a1_clipout', m4in: 'm4a1_clipin', m4bolt: 'm4a1_boltpull', m4deploy: 'm4a1_deploy',
  de: 'deagle-1', deout: 'de_clipout', dein: 'de_clipin', deslide: 'de_slideback', dedeploy: 'de_deploy',
  fbex1: 'flashbang_explode1', fbex2: 'flashbang_explode2', gnhit: 'grenade_hit1', zoom: 'zoom',
  c4plant: 'c4_plant', c4beep: 'c4_beep1', c4ex: 'c4_explode1',
  head: 'headshot.mp3',
};
const sfxRaw = {}, sfxBuf = {}, sfxOff = {};
const SAMPLE_VOL = 0.72;                 // 샘플 전체 볼륨 배율
for (const [k, f] of Object.entries(SFX_FILES))       // 바이트는 처음부터 받아 두고, 디코드는 오디오 컨텍스트가 생기면
  fetch('assets/sound/' + (f.includes('.') ? f : f + '.wav')).then(r => r.ok ? r.arrayBuffer() : null).then(b => { if (b) sfxRaw[k] = b; }).catch(() => { });
function decodeSfx() {
  if (!AC) return;
  for (const k of Object.keys(sfxRaw)) {
    if (sfxBuf[k] || sfxBuf[k] === false) continue;
    sfxBuf[k] = false;                                  // 디코드 중 표시
    AC.decodeAudioData(sfxRaw[k].slice(0)).then(b => {
      const d = b.getChannelData(0); let peak = 0;         // 앞머리 무음·느린 상승을 건너뛰어 소리가 실제로 나는 순간부터 재생
      for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
      let i = 0; while (i < d.length && Math.abs(d[i]) < peak * 0.1) i++;
      sfxOff[k] = Math.max(0, i / b.sampleRate - 0.002);
      sfxBuf[k] = b;
    }).catch(() => { delete sfxBuf[k]; });
  }
}
function playSample(name, { vol = 1, rate = 1, at = 0, verb = 0.35, jitter = 0.04 } = {}) {   // 샘플이 없으면 false → 호출부가 절차음으로
  if (!AC) return false;
  if (Object.keys(sfxRaw).length && Object.keys(sfxBuf).length < Object.keys(sfxRaw).length) decodeSfx();
  const b = sfxBuf[name]; if (!b) return false;
  const t = AC.currentTime + at;
  const src = AC.createBufferSource(); src.buffer = b;
  src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);   // 살짝 다른 높이로 반복감 줄이기
  const g = AC.createGain(); g.gain.value = vol * SAMPLE_VOL;
  src.connect(g); g.connect(masterGain);
  if (verb > 0 && sfxVerb) { const vg = AC.createGain(); vg.gain.value = verb; g.connect(vg); vg.connect(sfxVerb); }
  src.start(t, sfxOff[name] || 0);
  return true;
}
// 노이즈 한 조각: 필터 스윕 + 감쇠 (총성·폭발·타격의 뼈대)
function noiseHit({ dur = 0.1, lp0 = 3000, lp1 = 400, hp = 60, vol = 0.8, curve = 2, at = 0, verb = 0.6 } = {}) {
  if (!AC) return;
  const t = AC.currentTime + at;
  const src = AC.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  src.start(t, Math.random() * 1.5);
  const hpF = AC.createBiquadFilter(); hpF.type = 'highpass'; hpF.frequency.value = hp;
  const lpF = AC.createBiquadFilter(); lpF.type = 'lowpass'; lpF.frequency.setValueAtTime(lp0, t);
  lpF.frequency.exponentialRampToValueAtTime(Math.max(40, lp1), t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t);
  g.gain.setTargetAtTime(0.0001, t, dur / (2.2 * curve));
  src.connect(hpF); hpF.connect(lpF); lpF.connect(g); g.connect(masterGain);
  if (verb > 0 && sfxVerb) { const vg = AC.createGain(); vg.gain.value = verb; g.connect(vg); vg.connect(sfxVerb); }
  src.stop(t + dur + 0.05);
}
function thump(f0 = 120, f1 = 40, dur = 0.12, vol = 0.9, at = 0) {   // 저음 펀치
  if (!AC) return;
  const t = AC.currentTime + at;
  const o = AC.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(masterGain); o.start(t); o.stop(t + dur);
}
function click(at = 0, vol = 0.5, lp = 6000) {                        // 아주 짧은 기계음
  noiseHit({ dur: 0.018, lp0: lp, lp1: lp * 0.6, hp: 900, vol, curve: 1.2, at, verb: 0.15 });
}
function sfxShot() {                     // 소총: M4A1 샘플 (없으면 절차음)
  if (!AC) return;
  if (playSample('m4', { vol: 1.0, verb: 0.3 })) return;
  click(0, 1.1, 9000);                                                   // 크랙 (초고역 트랜지언트)
  noiseHit({ dur: 0.075, lp0: 5200, lp1: 900, hp: 180, vol: 1.0, curve: 2.2 });   // 몸통
  thump(150, 55, 0.07, 0.7);                                             // 저음 펀치
  noiseHit({ dur: 0.28, lp0: 1100, lp1: 220, hp: 80, vol: 0.22, curve: 1.1, verb: 0.9 });   // 꼬리 울림
}
function sfxTone(freq, dur, type = 'square', vol = 0.15, slide = 0) {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(masterGain); o.start(); o.stop(t + dur);
}
function sfxRevolver() {                 // 권총: 데저트 이글 샘플 (없으면 절차음)
  if (!AC) return;
  if (playSample('de', { vol: 1.0, verb: 0.4 })) return;
  click(0, 1.3, 7000);
  noiseHit({ dur: 0.12, lp0: 3600, lp1: 500, hp: 120, vol: 1.4, curve: 1.9 });
  thump(95, 32, 0.22, 1.5);
  noiseHit({ dur: 0.55, lp0: 900, lp1: 140, hp: 60, vol: 0.4, curve: 1.0, verb: 1.2 });
}
function sfxExplosion(big = 1, kind = 'grenade') {   // 수류탄: 플래시뱅 폭발 샘플 · 지뢰: C4 폭발 샘플 (없으면 절차음)
  if (!AC) return;
  if (kind === 'mine' ? playSample('c4ex', { vol: 1.1, verb: 0.5 }) : playSample(Math.random() < 0.5 ? 'fbex1' : 'fbex2', { vol: 1.1, verb: 0.5 })) { thump(70 * big, 22, 0.5, 0.9); return; }
  thump(70 * big, 22, 0.7, 1.6);
  noiseHit({ dur: 0.09, lp0: 6000, lp1: 1500, hp: 200, vol: 1.2, curve: 2.0 });      // 파열
  noiseHit({ dur: 0.9, lp0: 2200, lp1: 120, hp: 40, vol: 0.9, curve: 1.0, verb: 1.4 });   // 몸통·잔향
  for (let i = 0; i < 6; i++) click(0.05 + i * 0.045 + Math.random() * 0.03, 0.35, 3000);   // 파편
}
const sfxHit = () => { noiseHit({ dur: 0.05, lp0: 2400, lp1: 600, hp: 200, vol: 0.55, curve: 2.4, verb: 0.2 }); thump(260, 110, 0.05, 0.35); };   // 살 타격
const sfxHead = () => {                  // 헤드샷: 샘플 (없으면 금속 '띵')
  if (!AC) return;
  if (playSample('head', { vol: 0.9, verb: 0.2, jitter: 0 })) return;
  const t = AC.currentTime;
  for (const [f, v, d] of [[2420, 0.34, 0.22], [3620, 0.2, 0.16], [5100, 0.1, 0.1]]) {
    const o = AC.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const g = AC.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(masterGain); if (sfxVerb) g.connect(sfxVerb); o.start(t); o.stop(t + d);
  }
  click(0, 0.6, 8000);
};
const sfxReload = () => {                // 탄창 뺌 → 꽂음 → 노리쇠 (소총 M4A1 · 권총 데저트 이글 샘플)
  const T = reloadMs() / 1000;           // 탄창 뺌 8% · 꽂음 42% · 노리쇠/슬라이드 74% 지점
  if (weapon === 'pistol' ? playSample('deout', { vol: 0.9, verb: 0.2, at: T * 0.08 }) : playSample('m4out', { vol: 0.9, verb: 0.2, at: T * 0.08 })) {
    if (weapon === 'pistol') { playSample('dein', { vol: 0.9, verb: 0.2, at: T * 0.42 }); playSample('deslide', { vol: 0.9, verb: 0.2, at: T * 0.74 }); }
    else { playSample('m4in', { vol: 0.9, verb: 0.2, at: T * 0.42 }); playSample('m4bolt', { vol: 0.9, verb: 0.2, at: T * 0.74 }); }
    return;
  }
  click(0, 0.5, 5000); thump(220, 140, 0.04, 0.25, 0);                                   // 해제
  click(0.32, 0.7, 3500); thump(170, 90, 0.06, 0.45, 0.32);                              // 탄창 삽입
  click(0.62, 0.55, 6000); click(0.70, 0.8, 4500); thump(200, 120, 0.05, 0.3, 0.70);    // 노리쇠 당김·복귀
};
const sfxZoom = () => { if (!playSample('zoom', { vol: 0.8, verb: 0.1, jitter: 0 })) sfxTone(900, 0.05, 'sine', 0.08, 300); };
const sfxDeploy = () => { if (!(weapon === 'pistol' ? playSample('dedeploy', { vol: 0.8, verb: 0.15 }) : playSample('m4deploy', { vol: 0.8, verb: 0.15 }))) click(0, 0.5, 5000); };
const sfxHurt = () => { noiseHit({ dur: 0.12, lp0: 1600, lp1: 300, hp: 120, vol: 0.5, curve: 1.6 }); thump(180, 60, 0.18, 0.7); };
const sfxDie = () => { thump(140, 38, 0.35, 0.9); noiseHit({ dur: 0.3, lp0: 1200, lp1: 200, hp: 80, vol: 0.45, curve: 1.2, verb: 0.8 }); };
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
let playerGltf, enemyGltf, potionGltf, chestGltf, coinGltf, grenadeGltf, crateGltf;

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
const EYE_STAND = 1.62, EYE_CROUCH = 1.05;   // 앉으면 눈높이가 내려간다
const CROUCH_SPD = 0.5;                  // 앉아서 걷는 속도 배율
const CROUCH_CLIPS = ['idle crouching aiming', 'idle crouching', 'walk crouching forward', 'walk crouching backward', 'walk crouching left', 'walk crouching right',
  'walk crouching forward left', 'walk crouching forward right', 'walk crouching backward left', 'walk crouching backward right', 'death crouching headshot front'];
const player = {
  root: null, mixer: null, actions: {}, current: null,
  pos: new THREE.Vector3(0, 0, 0), vy: 0, onGround: true,
  yaw: 0, pitch: 0, hp: 100, dead: false,
  eyeH: EYE_STAND, zooming: false, crouch: false,
  oneShot: null, fireAction: null,
  dashT: 0, dashCd: 0, dashDir: { x: 0, z: -1 }, lastDir: { x: 0, z: -1 },
};
let score = 0, kills = 0, wave = 0, ammo = 20, reloading = false, coins = 0;
const fmt = n => Math.round(n).toLocaleString('en-US');   // 천 단위 콤마
function setCoinHud() {
  document.getElementById('coinN').textContent = fmt(coins);
  const c = document.getElementById('curCoin');
  if (c) c.textContent = fmt(coins);
}
function showCurTop(on) {                // 쇼룸·던전 이동 화면의 우상단 보유 재화
  const el = document.getElementById('curTop');
  if (!el) return;
  el.classList.toggle('on', on);
  if (on) { setCoinHud(); syncHeadUI(); }
}
let buffT = 0; // 무한 탄약 남은 시간
// ---------- 업그레이드 (코인 소모, 기본대비 +5%/레벨) ----------
const upg = {
  hp: 0, spd: 0, dashcd: 0, jump: 0,                   // 기본
  dmg: 0, rate: 0, reload: 0, mag: 0, pen: 0,          // 총
  blast: 0, brad: 0,                                   // 폭탄
  guard: 0, parryw: 0, counter: 0,                     // 방패
  rcharge: 0, rcool: 0, rrange: 0,                     // 리본
};
const UPG_NAMES = {
  hp: 'HP', spd: '이동 속도', dashcd: '대쉬 쿨타임', jump: '점프력',
  dmg: '무기 대미지', rate: '연사력', reload: '재장전', mag: '탄창', pen: '관통력',
  blast: '폭발 위력', brad: '폭발 반경',
  guard: '방어력', parryw: '패링 판정', counter: '반격 대미지',
  rcharge: '리본 충전', rcool: '재충전 단축', rrange: '리본 사거리',
};
const UPG_MAX = { spd: 8, dashcd: 8, jump: 6, blast: 10, brad: 6, guard: 8, parryw: 5, counter: 6, rcharge: 3, rcool: 14, rrange: 5 };
const UPG_BASE = { spd: 150, dashcd: 150, jump: 150, blast: 150, brad: 150, guard: 150, parryw: 150, counter: 150, rcharge: 200, rcool: 200, rrange: 200 };
const UPG_TABS = [
  { k: 'base', icon: '🏃', name: '기본', keys: ['hp', 'spd', 'dashcd', 'jump'] },
  { k: 'gun', icon: '🔫', name: '총', keys: ['dmg', 'rate', 'reload', 'mag', 'pen'] },
  { k: 'bomb', icon: '💣', name: '폭탄', keys: ['blast', 'brad'], items: true },
  { k: 'shield', icon: '🛡️', name: '방패', keys: ['guard', 'parryw', 'counter'],
    open: () => pistolOwned, lock: '5단계 보스 처치 후' },
  { k: 'ribbon', icon: '🎀', name: '리본', keys: ['rcharge', 'rcool', 'rrange'],
    open: () => ribbonOwned, lock: '10단계 보스 처치 후' },
];
let shopTab = 'base';
const PEN_STEP = 0.1;                    // 레벨당 관통 확률 +10% (Lv.10 = 100%)
const penPower = () => PEN_STEP * upg.pen;   // 1.0 = 첫 대상 확정 관통 · 1.5 = 두 번째 대상 50% 관통
const UPG_X2 = { rcharge: 1000, rcool: 500 };   // 첫 레벨 비용에서 레벨마다 2배
const upgCost = k => UPG_X2[k] ? UPG_X2[k] * Math.pow(2, upg[k]) : (UPG_BASE[k] || 100) * (upg[k] + 1);
const upgMaxed = k => UPG_MAX[k] !== undefined && upg[k] >= UPG_MAX[k];
// 기본 · 폭탄 · 방패 · 리본 강화 수치
const MOVE_SPD = 7.2, DASH_CD = 1.0, JUMP_V = 5.8;
function moveSpeed() { return MOVE_SPD * (1 + 0.04 * upg.spd); }
function dashCool() { return Math.max(0.4, DASH_CD - 0.075 * upg.dashcd); }
function jumpV() { return JUMP_V * (1 + 0.05 * upg.jump); }
function jumpH() { return jumpV() * jumpV() / (2 * 13.5); }      // 도달 높이(m)
function blastMul() { return 1 + 0.1 * upg.blast; }
function blastRad() { return 1 + 0.05 * upg.brad; }
function shieldCut() { return Math.max(0.02, 0.1 - 0.01 * upg.guard); }
function parryMs() { return PARRY_MS + 30 * upg.parryw; }
function counterDmg() { return Math.round(46 * (1 + 0.15 * upg.counter) * dmgMul()); }
function chainMax() { return CHAIN_USES + upg.rcharge; }
function chainRecharge() { return Math.max(3, CHAIN_RECHARGE - 0.5 * upg.rcool); }   // 레벨당 0.5초 · 최소 3초
function chainRange() { return CHAIN_RANGE + 2 * upg.rrange; }
function upgInfo(k) {                    // 버튼에 적는 현재 효과
  const v = upg[k];
  switch (k) {
    case 'pen': return '관통 ' + Math.round(v * PEN_STEP * 100) + '%';
    case 'blast': return '위력 +' + v * 10 + '%';
    case 'brad': return '반경 +' + v * 5 + '%';
    case 'guard': return '피격 ' + Math.round(shieldCut() * 100) + '%';
    case 'parryw': return (parryMs() / 1000).toFixed(2) + '초';
    case 'counter': return '반격 +' + v * 15 + '%';
    case 'rcharge': return chainMax() + '회';
    case 'rcool': return (+chainRecharge().toFixed(1)) + '초';
    case 'rrange': return chainRange() + 'm';
    case 'spd': return moveSpeed().toFixed(1) + 'm/s';
    case 'dashcd': return dashCool().toFixed(2) + '초';
    case 'jump': return jumpH().toFixed(2) + 'm';
    default: return '+' + v * 5 + '%';
  }
}
const dmgMul = () => 1 + 0.05 * upg.dmg;
const fireInterval = () => 110 / (1 + 0.05 * upg.rate);
const PISTOL_RELOAD = 0.7;               // 리볼버는 재장전 30% 단축
const reloadMs = () => 1600 / (1 + 0.05 * upg.reload) * (weapon === 'pistol' ? PISTOL_RELOAD : 1);
const PISTOL_MAG = 12;                   // 리볼버 기본 탄창
const magSize = (w) => Math.round(((w ?? weapon) === 'pistol' ? PISTOL_MAG : 20) * (1 + 0.05 * upg.mag));
const maxHp = () => Math.round(100 * (1 + 0.05 * upg.hp));
function updateHpHud() {
  document.getElementById('hpT').textContent = Math.max(0, player.hp | 0);
  document.getElementById('hpF').style.width = Math.max(0, player.hp / maxHp() * 100) + '%';
}
function renderUpg() {
  const el = document.getElementById('upgList');
  const items = document.getElementById('itemList');   // 소모품은 아래 줄에 따로
  if (!el) return;
  const tabs = document.getElementById('shopTabs');
  let tab = UPG_TABS.find(t => t.k === shopTab);
  if (!tab || (tab.open && !tab.open())) tab = UPG_TABS[0];   // 잠긴 탭이면 총으로
  shopTab = tab.k;
  if (tabs) {
    tabs.innerHTML = '';
    for (const t of UPG_TABS) {
      if (t.open && !t.open()) continue;   // 아직 얻지 못한 장비 탭은 아예 숨긴다
      const b = document.createElement('button');
      b.className = t.k === shopTab ? 'on' : '';
      b.innerHTML = `${t.icon} ${t.name}`;
      b.addEventListener('click', () => { shopTab = t.k; renderUpg(); });
      tabs.appendChild(b);
    }
  }
  el.innerHTML = '';
  if (items) items.innerHTML = '';
  for (const k of tab.keys) {
    const btn = document.createElement('button');
    const maxed = upgMaxed(k);
    btn.innerHTML = `<span>${UPG_NAMES[k]} Lv.${upg[k]} <small>(${upgInfo(k)})</small> `
      + `<b>${maxed ? 'MAX' : fmt(upgCost(k)) + '🪙'}</b></span>`;
    btn.disabled = maxed || coins < upgCost(k);
    btn.addEventListener('click', () => buyUpg(k));
    el.appendChild(btn);
  }
  if (!tab.items) {                      // 소모품은 폭탄 탭에서만
    const cn0 = document.getElementById('shopCoinN');
    if (cn0) cn0.textContent = fmt(coins);
    return;
  }
  // 수류탄: 정가 100코인, 최대 5개 보유
  const gb = document.createElement('button');
  gb.innerHTML = `<span>💣 수류탄 +1 <small>(${grenades}/5)</small> <b>${fmt(100)}🪙</b></span>`;
  gb.disabled = coins < 100 || grenades >= 5;
  gb.addEventListener('click', () => {
    if (coins < 100 || grenades >= 5) return;
    coins -= 100;
    grenades++;
    setCoinHud();
    updateGSlot();
    sfxPotion();
    renderUpg();
    persistProgress();
  });
  (items || el).appendChild(gb);
  // 지뢰: 정가 150코인, 최대 5개 보유
  const mb2 = document.createElement('button');
  mb2.innerHTML = `<span>🧨 지뢰 +1 <small>(${mines}/${MINE_MAX})</small> <b>${fmt(MINE_COST)}🪙</b></span>`;
  mb2.disabled = coins < MINE_COST || mines >= MINE_MAX;
  mb2.addEventListener('click', () => {
    if (coins < MINE_COST || mines >= MINE_MAX) return;
    coins -= MINE_COST; mines++;
    setCoinHud();
    updateMineSlot(); sfxPotion(); renderUpg(); persistProgress();
  });
  (items || el).appendChild(mb2);
  const cn = document.getElementById('shopCoinN');
  if (cn) cn.textContent = fmt(coins);
}
function buyUpg(k) {
  const c = upgCost(k);
  if (coins < c || player.dead || upgMaxed(k)) return;
  coins -= c;
  setCoinHud();
  upg[k]++;
  if (k === 'hp') { player.hp = Math.min(maxHp(), player.hp + 5); updateHpHud(); }
  if (k === 'mag') updateAmmo();
  if (k === 'rcharge') { chainUses = chainMax(); chainRe = 0; updateRibbonSlot(); }
  if (k === 'rcool' || k === 'rrange') updateRibbonSlot();
  sfxPotion();
  renderUpg();
  persistProgress();
}

// ---------- 코인·업그레이드·수류탄 영속화 (새로고침에도 유지) ----------
function persistProgress() {
  try { localStorage.setItem('fps.save', JSON.stringify({ coins, upg, grenades, mines })); } catch { }
}
function loadProgress() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('fps.save') || 'null'); } catch { }
  if (!s) return;
  coins = s.coins || 0;
  grenades = Math.min(5, s.grenades || 0);
  mines = Math.min(MINE_MAX, s.mines || 0);
  updateMineSlot();
  for (const k of Object.keys(upg)) upg[k] = s.upg?.[k] || 0;
  player.hp = maxHp();
  ammo = magSize();
  setCoinHud();
}

// ---------- 스코어 랭킹 TOP 10 (localStorage) ----------
const rankMapOf = r => r.map || (r.seed === '광장' ? 'plaza' : 'random');   // 예전 기록도 분류
const RANK_TITLE = { random: '👹 악의 소굴', plaza: '🏛 광장' };
function saveRanking() {
  let list;
  try { list = JSON.parse(localStorage.getItem('fps.rank') || '[]'); } catch { list = []; }
  const map = walkGrid ? 'random' : 'plaza';
  const entry = {
    score, wave: stageNo(), kills, hs: headshots, acc: accuracy(),
    map, seed: RANK_TITLE[map].slice(2), time: runSecs(),
    date: new Date().toISOString().slice(0, 10),
  };
  list.push(entry);
  const keep = [];                       // 맵마다 TOP 10을 따로 남긴다
  for (const m of ['random', 'plaza'])
    keep.push(...list.filter(r => rankMapOf(r) === m).sort((a, b) => b.score - a.score).slice(0, 10));
  localStorage.setItem('fps.rank', JSON.stringify(keep));
  return { list: keep, entry, map };
}
function rankListOf(list, map) { return list.filter(r => rankMapOf(r) === map).sort((a, b) => b.score - a.score); }
function rankingTable(list, me = null, withTime = false) {
  if (!list.length) return '<div class="rankRow"><small>기록이 없습니다</small></div>';
  const rows = list.map((r, i) =>
    `<tr class="${r === me ? 'me' : ''}"><td>${i + 1}</td><td class="num">${r.score.toLocaleString()}</td>` +
    `<td>${r.wave}</td><td>${r.kills}</td><td>${r.hs || 0}</td><td>${r.acc != null ? r.acc + '%' : '-'}</td>` +
    (withTime ? `<td>${r.time != null ? mmss(r.time) : '-'}</td>` : '') +
    `<td>${r.date}</td></tr>`
  ).join('');
  return `<table class="rankTbl"><thead><tr><th></th><th class="num">점수</th><th>단계</th><th>킬수</th><th>헤드샷</th><th>명중률</th>`
    + (withTime ? '<th>시간</th>' : '') + `<th>기록일</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function renderRankPanel(el, list, map, me) {   // 맵 탭 + 그 맵의 TOP 10
  if (!el) return;
  el.innerHTML = '<div class="rankTabs">'
    + ['random', 'plaza'].map(m => `<button data-rank="${m}"${m === map ? ' class="on"' : ''}>${RANK_TITLE[m]}</button>`).join('')
    + '</div><div class="rankCap">TOP 10</div>'
    + rankingTable(rankListOf(list, map), me, map === 'plaza');
  for (const b of el.querySelectorAll('[data-rank]'))
    b.addEventListener('click', e => { e.stopPropagation(); renderRankPanel(el, list, b.dataset.rank, me); });
}
function renderRanking() {
  const { list, entry, map } = saveRanking();
  renderRankPanel(document.getElementById('rankList'), list, map, entry);   // 방금 플레이한 맵부터
}
function viewRanking() { // 메인 화면 열람용 (기록 저장 없음)
  let list;
  try { list = JSON.parse(localStorage.getItem('fps.rank') || '[]'); } catch { list = []; }
  renderRankPanel(document.getElementById('rankMenuList'), list, 'random', null);
}

// 반바지 메쉬(Object_3_2)에 뚫린 구멍 — 안쪽에 같은 모양의 안감을 한 겹 깔아 메운다
function patchShortsHole(scene) {
  let shorts = null;
  scene.traverse(o => { if (!shorts && o.isSkinnedMesh && /Object_3_2/.test(o.name)) shorts = o; });
  if (!shorts || shorts.userData.lined) return false;
  const geo = shorts.geometry.clone();
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const IN = 0.008;                      // 8mm 안쪽으로 밀어 넣는다
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) - nor.getX(i) * IN, pos.getY(i) - nor.getY(i) * IN, pos.getZ(i) - nor.getZ(i) * IN);
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
  const lining = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({
    color: 0x14141a, roughness: 0.95, metalness: 0, side: THREE.DoubleSide,
  }));
  lining.name = 'shortsLining';
  lining.bindMode = shorts.bindMode;
  lining.frustumCulled = false;
  shorts.parent.add(lining);
  lining.bind(shorts.skeleton, shorts.bindMatrix);
  shorts.userData.lined = true;
  return true;
}
function setupPlayer() {
  const root = skClone(playerGltf.scene);
  prepShadows(root);
  scene.add(root);
  player.root = root;
  syncPlayerShadow();
  player.mixer = new THREE.AnimationMixer(root);
  const names = ['rifle aiming idle', 'rifle run', 'run backwards', 'walking', 'walking backwards',
    'strafe', 'strafe (2)', 'strafe left', 'reloading', 'rifle jump', 'firing rifle', 'toss grenade',
    'hit reaction', 'humanoid:death_gun', ...CROUCH_CLIPS];
  for (const n of names) {
    const c = clipOf(playerGltf, n);
    if (c) player.actions[n] = player.mixer.clipAction(c);
  }
  // 상·하체 분리 — 이동 클립은 하체 본만, 재장전·투척은 상체 본만 가진 클립을 따로 만들어 같은 믹서에 겹쳐 재생한다
  // (다리는 달리고 팔은 탄창을 가는 식). 트랙이 서로 다른 본을 다루므로 충돌 없이 합쳐진다. 골반(Hips)은 하체 쪽.
  const LOWER_RE = /hips|pelvis|leg|thigh|shin|calf|knee|foot|ankle|toe/i;
  const maskClip = (clip, keepLower, suffix) => new THREE.AnimationClip(clip.name + suffix, clip.duration,
    clip.tracks.filter(t => LOWER_RE.test(t.name.split('.')[0]) === keepLower));
  for (const n of ['rifle aiming idle', 'rifle run', 'run backwards', 'walking', 'walking backwards', 'strafe', 'strafe (2)', 'strafe left', ...CROUCH_CLIPS]) {
    const c = clipOf(playerGltf, n);
    if (c) player.actions[n + '_lower'] = player.mixer.clipAction(maskClip(c, true, '_lower'));
  }
  for (const n of ['reloading', 'toss grenade']) {
    const c = clipOf(playerGltf, n);
    if (c) player.actions[n + '_upper'] = player.mixer.clipAction(maskClip(c, false, '_upper'));
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
// 상체 레이어: 이동(하체) 위에 재장전·투척(상체)을 얹는다. 이동 선택은 그대로 돌아가고 분리 중에는 하체 클립을 쓴다.
function upperPlay(name, fade = 0.1) {
  const a = player.actions[name + '_upper'];
  if (!a) { oneShot(name, 1); return null; }          // 분리 클립이 없으면 예전처럼 전신
  if (player.upperAct && player.upperAct !== a) player.upperAct.fadeOut(0.1);
  a.reset(); a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.enabled = true;
  a.setEffectiveTimeScale(1); a.setEffectiveWeight(1); a.fadeIn(fade).play();
  player.upperAct = a; player.upperShot = name;
  return a;
}
function upperStop(fade = 0.15) {
  if (player.upperAct) player.upperAct.fadeOut(fade);
  player.upperAct = null; player.upperShot = null;
}
function crouchBlockedAbove() {          // 일어설 자리(머리 위 1.7m)에 구조물이 있으면 계속 앉아 있는다
  for (const o of obstacles) {
    if (Math.abs(player.pos.x - o.x) >= o.w / 2 + 0.45 || Math.abs(player.pos.z - o.z) >= o.d / 2 + 0.45) continue;
    if (o.yOff > player.pos.y + 1.15 && o.yOff < player.pos.y + 1.7) return true;
  }
  return false;
}
function jumpAnim() {                    // 점프 모션을 체공 시간에 맞춘다 (점프력 업그레이드·점프대·리본으로 오래 떠 있어도 착지까지 이어진다)
  if (camMode === 'fps') return;         // 1인칭에서는 점프 모션이 상체를 카메라 앞으로 들이밀어 화면을 가리므로 생략
  const a = player.actions['rifle jump'];
  if (!a) return;
  const air = Math.max(0.4, 2 * player.vy / 13.5);          // 올라갔다 내려오는 시간
  const d = a.getClip().duration;
  a.timeScale = Math.max(0.35, Math.min(1.6, d / air));     // 너무 느려지지 않게 하한 — 남는 시간은 마지막 자세 유지
  oneShot('rifle jump', air + 0.4);                         // 착지하면 바로 풀린다 (아래 착지 처리) · 타이머는 안전장치
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
const PARTICLE_GEO = new THREE.BoxGeometry(0.06, 0.06, 0.06);   // 파편은 모양이 같으니 하나만 만든다
const particleMats = new Map();                                 // 색깔별 재질 캐시
function particleMat(color) {
  let m = particleMats.get(color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); particleMats.set(color, m); }
  return m;
}
function burst(pos, color = 0xbb2233, n = 10) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(PARTICLE_GEO, particleMat(color));
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
  borrowLight(type === 'potion' ? 0xff5577 : type === 'grenade' ? 0xffb347 : 0x66aaff, 1.6, 4, root, 0, 0.6, 0);
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
  setCoinHud();
  renderUpg(); // 코인 변동 시 구매 가능 상태 갱신
  persistProgress();
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
        persistProgress();
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
const enemyPool = [];                   // 죽은 적의 모델·믹서를 돌려쓴다 (복제 2~3ms 절약)
const POOL_MAX = 24;
function retireEnemy(en) {               // 화면에서 치우고 풀에 반납
  if (en.gone) return;
  scene.remove(en.root);
  dropBlob(en); clearAoe(en);
  if (en.hpBar) en.root.remove(en.hpBar.grp);
  if (en.aura) { en.root.remove(en.aura); en.aura = null; }
  if (en.cutBones) { for (const b of en.cutBones) b.scale.setScalar(1); en.cutBones = null; }   // 절단 복구
  en.mixer.stopAllAction();
  en.gone = true;
  if (enemyPool.length < POOL_MAX) enemyPool.push({ root: en.root, mixer: en.mixer, acts: en.acts });
}
function spawnEnemy(waveN, variant = 'walker') {
  ptSpawned++;
  if (variant === true) variant = 'runner'; // 구형 호출 호환
  const runner = variant === 'runner', jumper = variant === 'jumper', ranged = variant === 'ranged', boss = variant === 'boss';
  const isHunter = variant === 'hunter';
  const pooled = enemyPool.pop();
  const root = pooled ? pooled.root : skClone(enemyGltf.scene);
  if (pooled) {                            // 재사용: 재질·표시 상태만 되돌린다
    root.visible = true;
    root.traverse(o => {
      if (!o.material) return;
      o.material.transparent = false; o.material.opacity = 1;
      if (o.material.emissive) o.material.emissive.setRGB(0, 0, 0);
      if (o.isMesh || o.isSkinnedMesh) o.castShadow = false;
    });
  } else {
    prepShadows(root);
    root.traverse(o => {                   // 화면 밖 적은 그리지 않는다 (동작으로 튀지 않게 반경 여유)
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.frustumCulled = true;
      if (o.geometry && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      if (o.geometry?.boundingSphere) o.geometry.boundingSphere.radius *= 2.2;
    });
    root.traverse(o => { if (o.material) { o.material = o.material.clone(); } });   // 투명은 사라질 때만 켠다
  }
  const sp = pickSpawn();
  const s = boss ? 1.6 : 0.92 + Math.random() * 0.28; // 보스는 타 개체(평균 1.06) 대비 약 1.5배
  root.scale.setScalar(s);
  root.position.set(sp.x, 0, sp.z);
  scene.add(root);
  const mixer = pooled ? pooled.mixer : new THREE.AnimationMixer(root);
  const acts = pooled ? pooled.acts : {};
  if (!pooled) for (const n of ENEMY_CLIPS) { const c = clipOf(enemyGltf, n); if (c) acts[n] = mixer.clipAction(c); }
  // 웨이브 스케일링: HP·공격력 +5%/웨이브(무제한), 이동속도 +5%/웨이브(최대 +100%)
  const sc = 1 + 0.05 * (waveN - 1);
  const spdSc = Math.min(2, sc);
  const baseHp = boss ? 800 : jumper ? 110 : runner ? 65 : ranged ? 70 : 80; // 보스 = 워커 10배
  const runnerSpd = 4.6 + waveN * 0.15;
  const baseSpd = isHunter ? runnerSpd * 2 / spdSc   // 추격자: 러너의 2배 (아래 spdSc 보정 상쇄)
    : runner ? 4.6 : jumper ? 3.0 : boss ? 2.2 : (1.6 + Math.random() * 0.4);
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
  if (boss) {                           // 보스: 자기 방을 지키며 대기 (진입·피격 시 각성)
    en.dormant = !!walkGrid;              // 광장에는 지킬 방이 없으니 바로 움직인다
    en.homeRoom = null;
  }
  if (isHunter) {                       // 추격자: 죽지 않는다 · 바닥에 붉은 오라
    en.invuln = true; en.stunAcc = 0; en.stunT = 0;
    en.speed = runnerSpd * 2;
    en.atkRate = 2;                      // 공격 모션·쿨타임 모두 2배 빠르게
    en.dmg = 34;
    root.traverse(o => { if (o.material?.emissive) o.material.emissive.setRGB(0.5, 0.02, 0.02); });
    const aura = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff1a1a, transparent: true, opacity: 0.45, depthWrite: false, fog: false, toneMapped: false }));
    aura.position.y = 0.05;
    root.add(aura);
    en.aura = aura;
    if (en.hpBar) { en.hpBar.grp.visible = false; en.alwaysBar = false; }
    hunter = en;
  }
  if (boss) { // 보스: 주황 발광 + 점프 광역 공격
    root.traverse(o => { if (o.material?.emissive) o.material.emissive.setRGB(0.35, 0.09, 0.02); });
    en.jumpCd = 2.0;
  }
  root.traverse(o => { if (!en.headBone && o.isBone && /head/i.test(o.name) && !/end/i.test(o.name)) en.headBone = o; });
  en.hpBar = makeHpBar();
  en.hpBar.grp.position.y = 2.62;
  if (boss) {
    en.hpBar.grp.scale.setScalar(2); en.hpBar.grp.position.y = 2.9;
    en.hpBar.grp.visible = true; en.alwaysBar = true;
    en.hpBar.fill.material.color.set(0xc04dff); // 보스 HP는 보라색
  }
  root.add(en.hpBar.grp);
  if (variant === 'boss') bossOfFloor = en;
  enPlay(en, Math.random() < 0.5 ? 'mutant roaring' : 'mutant idle');
  if (en.current === en.acts['mutant roaring']) sfxRoar();
  en.spawnHold = en.current === en.acts['mutant roaring'] ? 1.6 : 0.5;
  enemies.push(en);
  updateHudWave();
  return en;
}
function enPlay(en, name, fade = 0.22, once = false, rate = 1) {
  const next = en.acts[name];
  if (!next || en.current === next) return;
  if (once) { next.setLoop(THREE.LoopOnce); next.clampWhenFinished = true; }
  next.enabled = true; next.reset().play();
  next.timeScale = rate;
  if (en.current) en.current.crossFadeTo(next, fade, false);
  en.current = next;
}

const HIGH_SAFE = 1.6;                   // 적보다 이만큼 높이 있으면 손이 닿지 않는다
const outOfReach = en => player.pos.y - en.root.position.y > HIGH_SAFE;
function updateEnemy(en, dt) {
  if (en.dormant) {                     // 대기 중인 보스 — 플레이어가 방에 들어오면 각성
    en.mixer.update(dt);
    const r = en.homeRoom;
    const inRoom = r && player.pos.x >= r.x0 - 1 && player.pos.x <= r.x1 + 1 &&
      player.pos.z >= r.z0 - 1 && player.pos.z <= r.z1 + 1;
    const near = Math.hypot(player.pos.x - en.root.position.x, player.pos.z - en.root.position.z) < 14;
    if (inRoom || near) wakeEnemy(en);
    else {
      enPlay(en, 'mutant idle');
      if (en.hpBar) en.hpBar.grp.lookAt(camera.position);
      return;
    }
  }
  if (en.invuln) {                      // 추격자: 스턴 처리 + 오라 색
    if (en.stunT > 0) {
      en.stunT -= dt;
      if (en.aura) { en.aura.material.color.setHex(0xffdd22); en.aura.material.opacity = 0.6; }
      en.mixer.update(dt * 0.1);
      return;                           // 스턴 동안 완전 정지
    }
    if (en.aura) {
      en.aura.material.color.setHex(0xff1a1a);
      en.aura.material.opacity = 0.35 + Math.sin(gameTime * 6) * 0.12;
    }
  }
  const pdx = en.root.position.x - player.pos.x, pdz = en.root.position.z - player.pos.z;
  const d2p = pdx * pdx + pdz * pdz;
  const shown = d2p < DRAW_DIST * DRAW_DIST;         // 그리기 거리 밖이면 렌더만 끈다 (갱신 건너뛰기보다 먼저)
  if (en.root.visible !== shown) { en.root.visible = shown; if (en.blob) en.blob.visible = shown; }
  if (d2p > 2500 && en.state !== 'dead' && frameNo % 2) return;   // 50m 밖은 두 프레임에 한 번만 갱신
  const far = d2p > 1600;                            // 40m 밖
  en.far = far;
  if (far) { if (frameNo % 3 === 0) en.mixer.update(dt * 3); }   // 먼 적은 3프레임에 한 번만 스키닝
  else en.mixer.update(dt);
  if (en.cutBones) for (const b of en.cutBones) b.scale.setScalar(0.001);   // 잘린 부위 유지
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
      en.root.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity = op; } });
      if (op <= 0) retireEnemy(en);
    }
    return;
  }
  // 피격 넉백: 감쇠 속도로 뒤로 밀리되 이동은 계속(전진량이 더 크도록 총량 ≈0.15m)
  if (en.kbX || en.kbZ) {
    p.x += en.kbX * dt; p.z += en.kbZ * dt;
    const damp = Math.exp(-12 * dt);
    en.kbX *= damp; en.kbZ *= damp;
    const px2 = player.pos.x - p.x, pz2 = player.pos.z - p.z;
    if (Math.hypot(px2, pz2) < CHAIN_STOP && en.kbX * px2 + en.kbZ * pz2 > 0) en.kbX = en.kbZ = 0;   // 리본: 앞까지만 끌어온다
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
      let mvx = toP.x, mvz = toP.z;
      // 시야가 트였으면 곧장 플레이어에게 (경로 필드는 4방향이라 열린 방에서 축 방향으로만 움직인다)
      en.losT = (en.losT || 0) - dt;
      if (en.losT <= 0) {
        en.los = losClear(p.x, p.z, player.pos.x, player.pos.z) && !obstacleInWay(p.x, p.z, player.pos.x, player.pos.z, en);
        en.losT = 0.2;
      }
      if (walkGrid && !en.los) {
        const f = flowVec(p.x, p.z);   // 벽에 가리면 방·복도를 따라 우회
        if (f) { mvx = f.x; mvz = f.z; en.root.rotation.y = Math.atan2(f.x, f.z); }
      }
      // 모서리에 끼면(0.6초간 거의 못 움직이면) 잠깐 옆으로 미끄러져 빠져나온다
      if (en.lpx === undefined) { en.lpx = p.x; en.lpz = p.z; }   // 첫 검사에서 오판하지 않게 초기화
      en.stuckT = (en.stuckT || 0) + dt;
      if (en.stuckT > 0.6) {
        const moved = Math.hypot(p.x - en.lpx, p.z - en.lpz);
        if (moved < 0.12) { en.slipT = 0.6; en.slipDir = Math.random() < 0.5 ? 1 : -1; }
        en.lpx = p.x; en.lpz = p.z; en.stuckT = 0;
      }
      if (en.slipT > 0) {
        en.slipT -= dt;
        const sx = -mvz * en.slipDir, sz = mvx * en.slipDir;
        mvx += sx * 1.2; mvz += sz * 1.2;
        const L = Math.hypot(mvx, mvz) || 1; mvx /= L; mvz /= L;
      }
      const av = steerAroundObstacles(en, p, mvx, mvz);   // 구조물은 벽처럼 돌아간다
      mvx = av.x; mvz = av.z;
      p.x += mvx * en.speed * dt; p.z += mvz * en.speed * dt;
      collideCircle(p, 0.6, 2.4 * en.scale, 0, 0.32);   // 벽 통과 반경은 작게 — 폭 2m 복도도 통행
      for (const o of enemies) {
        if (o === en || o.state === 'dead') continue;
        const dx = p.x - o.root.position.x, dz = p.z - o.root.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 0.9) { p.x += dx / d * (0.9 - d) * 0.3; p.z += dz / d * (0.9 - d) * 0.3; }
      }
      enPlay(en, en.moveClip);
    } else if (en.atkCd <= 0 && !outOfReach(en)) {   // 높은 곳의 표적은 공격하지 않는다
      en.state = 'attack'; en.t = 0; en.dealt = false;
      enPlay(en, en.kind === 'jumper' ? 'jump attack'
        : en.kind === 'ranged' ? 'mutant punch'
          : (Math.random() < 0.5 ? 'mutant punch' : 'mutant swiping'), 0.12, true, en.atkRate || 1);
    } else {
      enPlay(en, 'mutant idle');
    }
    en.atkCd -= dt;
  } else if (en.state === 'attack') {
    en.t += dt;
    const clipDur = (en.current?.getClip().duration ?? 1) / (en.atkRate || 1);
    const jumper = en.kind === 'jumper';
    if (jumper && en.t < clipDur * 0.45 && dist > 1.2) {
      // 도약 전진
      p.x += toP.x / dist * 7 * dt; p.z += toP.z / dist * 7 * dt;
    }
    if (en.kind === 'ranged') {
      // 펀치 모션 중 투사체 발사 (플레이어의 발사 시점 위치를 조준 → 이동으로 회피 가능)
      if (!en.dealt && en.t > clipDur * 0.4) { en.dealt = true; if (!outOfReach(en)) fireProjectile(en); }
    } else if (!en.dealt && !outOfReach(en) && en.t > Math.min(clipDur * 0.9, clipDur * (jumper ? 0.5 : 0.38) + MELEE_LAG) && dist < (jumper ? 3.0 : 2.6) * en.scale) {
      en.dealt = true; damagePlayer(en.dmg, p.x, p.z, en);
    }
    if (en.t >= clipDur * 0.95) {
      en.state = 'chase';
      en.atkCd = (en.kind === 'ranged' ? 3.0 : jumper ? 1.4 : 0.7) / (en.atkRate || 1);
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
      if (!player.dead && d2 < 10 && player.pos.y < 0.5 && !outOfReach(en)) damagePlayer(en.dmg, en.aoeTarget.x, en.aoeTarget.z, en);
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

let gameTime = 0, combo = 0, lastKillT = -99, headshots = 0, shotsFired = 0, shotsHit = 0;
let runStart = 0;                        // 이번 판이 시작된 시각 (경과 시간 계산)
const runSecs = () => Math.max(0, Math.round(gameTime - runStart));
const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
let multiT = -99, multiN = 0;          // 멀티킬 판정
const accuracy = () => shotsFired ? Math.round(shotsHit / shotsFired * 100) : 0;
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
let weapon = 'rifle';                    // 'rifle' 소총 | 'pistol' 권총(리볼버)+방패
const PISTOL_DELAY = 300;                // 리볼버: 한 발 0.3초 고정
const PISTOL_DMG = 1.5;                  // 한 발 위력 — 소총의 1.5배
const SHIELD_CUT = 0.1;                  // 막아도 10%는 들어온다
const PARRY_MS = 300;                    // 우클릭 후 0.3초 안에 맞으면 패링
const MELEE_LAG = 0.3;                   // 근접 타격 판정을 모션에 맞춰 늦춘다(초)
const SLOWMO = 0.35;                     // 소총 줌: 세상만 느리게
let blocking = false, blockAt = 0;       // 방패 막기 · 누른 시각
const ammoStash = {};                    // 무장별 남은 탄
function canBlock() { return weapon === 'pistol' && slot === 'gun' && !player.dead; }
function frontAttack(x, z) {             // 바라보는 방향 기준 좌우 90° 안에서 온 공격인가
  if (x === undefined) return true;      // 방향을 모르면 앞으로 본다 (디버그 등)
  const dx = x - player.pos.x, dz = z - player.pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return true;
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);   // 시선 방향(수평)
  return (dx / len) * fx + (dz / len) * fz >= 0;
}
function parryReady() { return blocking && performance.now() - blockAt <= parryMs(); }
function timeScale() { return (player.zooming && weapon === 'rifle' && slot === 'gun') ? SLOWMO : 1; }
function shieldPose(on) {                // 방패를 앞으로 세운다
  if (!shieldGrp) return;
  shieldGrp.position.z = on ? 0.18 : 0;
  shieldGrp.rotation.z = on ? 0.5 : 0;
}
function parryFx(src, x, z) {            // 대상 머리 위에 표시 (없으면 맞은 지점)
  const at = src?.root ? headPos(src).add(new THREE.Vector3(0, 0.3, 0))
    : (x !== undefined ? new THREE.Vector3(x, 1.9, z) : null);
  if (at) popupWorld(at, '🛡️ 패링!', 'parryText');
  if (src) refreshHpBar(src);            // 반격 대상 HP 바 표시
  sfxTone(1200, 0.12, 'square', 0.3); sfxTone(600, 0.2, 'sine', 0.25, 300);
  shake(0.16, 0.25);
  if (x !== undefined) burst(new THREE.Vector3(x, 1.2, z), 0xfff0a0, 14);
}
let pistolGrp = null, shieldGrp = null;  // 권총·방패 메쉬
function buildPistolGear() {             // 소총 노드에 권총, 왼팔에 방패를 만들어 둔다
  const wNode = weaponMeshes[0]?.parent;
  if (!wNode || pistolGrp) return;
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.6 });
  pistolGrp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.2), steel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.13, 0.06), steel);
  grip.position.set(0, -0.1, 0.05); grip.rotation.x = 0.25;
  pistolGrp.add(body, grip);
  pistolGrp.visible = false;
  wNode.add(pistolGrp);
  let lArm = null;                       // 왼손·왼팔 본
  player.root?.traverse(o => { if (!lArm && o.isBone && /(hand|forearm|lowerarm).*l$|left(hand|forearm)/i.test(o.name)) lArm = o; });
  shieldGrp = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 20, 1, false),
    new THREE.MeshStandardMaterial({ color: 0x3c4a5a, roughness: 0.55, metalness: 0.35 }));
  plate.rotation.z = Math.PI / 2;
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0x8fa6b6, roughness: 0.35, metalness: 0.7 }));
  boss.position.x = 0.04;
  shieldGrp.add(plate, boss);
  shieldGrp.visible = false;
  (lArm ?? player.root ?? wNode).add(shieldGrp);
}
function applyWeaponLook() {             // 무장에 맞춰 총·권총·방패를 보인다
  buildPistolGear();
  const pistol = weapon === 'pistol';
  for (const m of weaponMeshes) m.visible = !pistol;
  if (pistolGrp) pistolGrp.visible = pistol;
  if (shieldGrp) shieldGrp.visible = pistol;
}
let slot = 'gun';                        // 'gun' | 'grenade' | 'mine'
function selectSlot(name) {
  if (name === 'pistol' && !pistolOwned) { toast('🔫🛡️ 권총+방패는 악의 소굴 5층 보스를 잡으면 얻습니다'); return; }
  const prevWeapon = weapon;
  if (name === 'rifle' || name === 'pistol') {   // 1·2번: 주무장 교체
    if (name !== weapon) {
      ammoStash[weapon] = ammo;
      weapon = name;
      ammo = ammoStash[name] ?? magSize(name);
      reloading = false; updateAmmo();
    }
    weapon = name;
    name = 'gun';
    if (slot !== 'gun' || weapon !== prevWeapon) sfxDeploy();
    toast(weapon === 'pistol' ? '🔫 권총 + 방패 — 연사 빠름 · 피해 절반' : '🔫 소총');
  }
  if (name === 'grenade' && grenades <= 0) { toast('수류탄이 없습니다'); return; }
  if (name === 'mine' && mines <= 0) { toast('지뢰가 없습니다'); return; }
  slot = name;
  gMode = (name === 'grenade');
  trajLine.visible = gMode;
  aimCircle.visible = gMode;
  if (name !== 'grenade' && gWindup) cancelGrenadeWindup();   // 들고 있던 수류탄은 던지지 않는다
  if (!canBlock()) { blocking = false; shieldPose(false); }
  applyWeaponLook();
  updateGSlot(); updateMineSlot(); updateWeaponSlot();
}
function updateWeaponSlot() {            // 1·2번 칸 표시
  const r = document.getElementById('rSlot'), p = document.getElementById('pSlot');
  if (r) r.classList.toggle('active', slot === 'gun' && weapon === 'rifle');
  if (p) p.classList.toggle('active', slot === 'gun' && weapon === 'pistol');
}
function toggleGMode() { selectSlot(gMode ? 'gun' : 'grenade'); }
function hideWeapon(sec) {
  for (const m of weaponMeshes) m.visible = false;
  if (pistolGrp) pistolGrp.visible = false;
  if (shieldGrp) shieldGrp.visible = false;
  clearTimeout(hideWeapon._t);
  hideWeapon._t = setTimeout(applyWeaponLook, sec * 1000);
}
const pendingThrows = []; // 릴리즈 예약 — 마우스 업 0.5초 뒤 실제 발사
// 홀드 투척: 마우스 다운 → toss grenade를 0.8초 지점까지 정속 재생 후 정지 유지, 업 → 나머지를 3배속으로 빠르게 재생하며 투척
const WIND_HOLD_T = 0.8;                 // 대기 지점 (클립 시간) — 마우스 다운 0.8초면 자세가 잡힌다
const WIND_SPEED = 1;                    // 대기 지점까지 재생 속도
const REL_SPEED = 3;                     // 놓은 뒤 나머지 재생 속도
const THROW_CLIP_T = 2.0;                // 클립에서 수류탄이 손을 떠나는 순간
let gWindup = false, gReleasePending = false;   // 대기 지점 전에 놓았으면 도달하는 순간 자동으로 던진다
function startGrenadeWindup() {
  if (grenades <= 0 || player.dead || gWindup || gReleasePending || pendingThrows.length) return;
  gWindup = true;
  const a = upperPlay('toss grenade', 0.08);        // 다리는 이동 그대로, 팔만 투척 자세
  if (a) { a.paused = false; a.timeScale = WIND_SPEED; }
  clearTimeout(hideWeapon._t);
  for (const m of weaponMeshes) m.visible = false; // 던지는 동안 총 숨김 (릴리즈 후 복원)
  if (pistolGrp) pistolGrp.visible = false;
  if (shieldGrp) shieldGrp.visible = false;
}
function cancelGrenadeWindup() {         // 다른 슬롯으로 바꾸면 던지지 않고 취소 (수류탄 미소모)
  if (!gWindup && !gReleasePending) return;
  gWindup = false; gReleasePending = false;
  const a = player.upperAct;
  if (a) a.timeScale = 1;
  upperStop(0.12);
  clearTimeout(hideWeapon._t);
  applyWeaponLook();
}
function releaseGrenadeWindup() {
  if (!gWindup) return;
  gWindup = false;
  const a = player.upperShot === 'toss grenade' ? player.upperAct : null;
  if (a && a.time < WIND_HOLD_T - 0.02) {   // 자세(1초 지점)가 잡히기 전에 놓음 → 던지지 않고 취소 (수류탄 미소모)
    upperStop(0.12);
    clearTimeout(hideWeapon._t);
    applyWeaponLook();
    return;
  }
  commitThrow(a);
}
function commitThrow(a) {                // 나머지 모션을 빠르게 돌리며 손을 떠나는 순간에 발사
  gReleasePending = false;
  const restDur = a ? Math.max(0.05, (a.getClip().duration - WIND_HOLD_T) / REL_SPEED) : 0.5;
  const throwDelay = a ? Math.max(0, (THROW_CLIP_T - WIND_HOLD_T) / REL_SPEED) : 0.3;
  if (a) { a.paused = false; a.timeScale = REL_SPEED; }
  grenades--;
  // 수류탄 모드는 F를 다시 누를 때까지 유지 (남은 수류탄이 없으면 총으로 복귀)
  if (grenades <= 0) { gMode = false; slot = 'gun'; trajLine.visible = false; aimCircle.visible = false; }
  updateGSlot();
  persistProgress();
  pendingThrows.push({ t: throwDelay });
  playSample('gnhit', { vol: 0.7, verb: 0.2, at: throwDelay });    // 손을 떠나는 소리
  hideWeapon(restDur + 0.1);
  setTimeout(() => { if (player.upperShot === 'toss grenade' && !gWindup) upperStop(); }, restDur * 1000 + 100);
}
function throwGrenade() { // 디버그/즉시 투척 (홀드 없이)
  startGrenadeWindup();
  releaseGrenadeWindup();
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
    const gWall = walkGrid && gr.root.position.y < WALL_H && cellSolid(gr.root.position.x, gr.root.position.z);
    if (gr.root.position.y <= 0.15 || gWall || gr.t > 4) {
      // 폭발: 반경 5.5m 광역 250 데미지
      const bp = gr.root.position.clone(); bp.y = 0.4;
      burst(bp, 0xffaa33, 30);
      burst(bp, 0xff5522, 18);
      flashLight.position.copy(bp); flashLight.intensity = 60; flashT = 0.1;
      sfxExplosion(1.0);
      for (const en of enemies) {
        if (en.state === 'dead') continue;
        const d = Math.hypot(en.root.position.x - bp.x, en.root.position.z - bp.z);
        if (d < 5.5 * blastRad()) {
          damageEnemy(en, Math.round(250 * blastMul()));
          en.hitFlash = 0.2;
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
const ROCK_GEO = new THREE.DodecahedronGeometry(1, 0);   // 크기는 스케일로 (파편마다 새로 만들지 않는다)
function rockBurst(center) {
  for (let i = 0; i < 16; i++) {
    const s = 0.12 + Math.random() * 0.28;
    const m = new THREE.Mesh(ROCK_GEO, rockMat);
    m.scale.setScalar(s);
    const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 8;
    m.position.set(center.x + Math.cos(a) * r, 0.15, center.z + Math.sin(a) * r);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    const v = new THREE.Vector3((Math.random() - .5) * 4, 4.5 + Math.random() * 5, (Math.random() - .5) * 4);
    scene.add(m);
    particles.push({ m, v, life: 1.2 + Math.random() * 0.6 });
  }
}
const CRACK_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);   // 길이는 스케일로 (매번 만들지 않는다)
function crackBurst(center) {
  for (let i = 0; i < 10; i++) {
    const len = 2.2 + Math.random() * 5;
    const m = new THREE.Mesh(CRACK_GEO,
      new THREE.MeshBasicMaterial({ color: 0x05070a, transparent: true, opacity: 0.9, depthWrite: false }));
    m.scale.set(len, 1, 0.09 + Math.random() * 0.14);
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
    if (d.life <= 0) { scene.remove(d.m); d.m.material.dispose(); decals.splice(i, 1); }
  }
}

// ---------- 미니맵 안개: 가본 방·복도만 드러난다 ----------
const rectsTouch = (a, b) => a.x0 - 1 < b.x1 && b.x0 - 1 < a.x1 && a.z0 - 1 < b.z1 && b.z0 - 1 < a.z1;
let seenAtX = 1e9, seenAtZ = 1e9;
function updateSeenRects() {
  if (!walkGrid) return;
  if (Math.abs(player.pos.x - seenAtX) < 0.5 && Math.abs(player.pos.z - seenAtZ) < 0.5) return;   // 제자리면 볼 것도 없다
  seenAtX = player.pos.x; seenAtZ = player.pos.z;
  for (let i = 0; i < mapRects.length; i++) {
    if (seenRects.has(i)) continue;
    const r = mapRects[i];
    if (player.pos.x >= r.x0 - 1 && player.pos.x <= r.x1 + 1 &&
        player.pos.z >= r.z0 - 1 && player.pos.z <= r.z1 + 1) {
      seenRects.add(i);
      // 들어간 방에 붙어 있는 통로는 함께 드러낸다 (출구를 알 수 있게)
      if (r.room) for (let j = 0; j < mapRects.length; j++)
        if (!mapRects[j].room && rectsTouch(r, mapRects[j])) seenRects.add(j);
    }
  }
}
// ---------- 피격 방향 표시기 ----------
const hitArrows = [];
function showHitArrow(fromX, fromZ) {
  const el = document.createElement('div');
  el.className = 'hitDir';
  document.getElementById('hud').appendChild(el);
  hitArrows.push({ el, x: fromX, z: fromZ, t: 1.2 });
}
function updateHitArrows(dt) {
  for (let i = hitArrows.length - 1; i >= 0; i--) {
    const a = hitArrows[i];
    a.t -= dt;
    if (a.t <= 0) { a.el.remove(); hitArrows.splice(i, 1); continue; }
    const dx = a.x - player.pos.x, dz = a.z - player.pos.z;
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const u = dx * cy - dz * sy, v = dx * sy + dz * cy;   // 우측 / 전방(음수)
    const ang = Math.atan2(u, -v);                        // 화면 위쪽이 0
    a.el.style.transform = 'translate(-50%,-50%) rotate(' + (ang * 180 / Math.PI) + 'deg)';
    a.el.style.opacity = Math.min(1, a.t / 0.4) * 0.9;
  }
}

// ---------- 문 · 스위치: 6층부터 방 하나에 최대 3세트, 벽 스위치를 쏘면 열린다 ----------
const doors = [];
const DOOR_FLOOR = 6, DOOR_MAX = 3, DOOR_H = 5.6;
function cellIdx(x, z) {
  if (!walkGrid) return -1;
  const i = Math.floor(x - walkGrid.ox), j = Math.floor(z - walkGrid.oz);
  if (i < 0 || j < 0 || i >= walkGrid.gw || j >= walkGrid.gh) return -1;
  return j * walkGrid.gw + i;
}
function setCells(list, walkable) {
  for (const k of list) walkGrid.cells[k] = walkable ? 1 : 0;
}
function reachable(fromX, fromZ, toX, toZ) {   // 닫힌 상태로도 갈 수 있는가 (BFS)
  const { cells, gw, gh } = walkGrid;
  const s = cellIdx(fromX, fromZ), t = cellIdx(toX, toZ);
  if (s < 0 || t < 0 || !cells[s] || !cells[t]) return false;
  const seen = new Uint8Array(cells.length);
  const q = [s]; seen[s] = 1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (c === t) return true;
    const i = c % gw, j = (c / gw) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) continue;
      const n = nj * gw + ni;
      if (seen[n] || !cells[n]) continue;
      seen[n] = 1; q.push(n);
    }
  }
  return false;
}
function doorCandidates() {               // 복도 입구 + 그 복도가 물린 방
  const rooms = mapRects.filter(r => r.room), out = [];
  for (const c of mapRects) {
    if (c.room) continue;
    const axis = (c.x1 - c.x0) > (c.z1 - c.z0) ? 'x' : 'z';
    for (const near of [0, 1]) {
      const r = rooms.find(r => axis === 'x'
        ? (near ? r.x0 === c.x1 : r.x1 === c.x0) && r.z0 <= c.z0 && c.z1 <= r.z1
        : (near ? r.z0 === c.z1 : r.z1 === c.z0) && r.x0 <= c.x0 && c.x1 <= r.x1);
      if (!r) continue;
      const slab = axis === 'x'
        ? { x0: near ? c.x1 - 1 : c.x0, x1: near ? c.x1 : c.x0 + 1, z0: c.z0, z1: c.z1 }
        : { x0: c.x0, x1: c.x1, z0: near ? c.z1 - 1 : c.z0, z1: near ? c.z1 : c.z0 + 1 };
      out.push({ cor: c, room: r, axis, slab });
    }
  }
  return out;
}
function makeDoor(cand) {
  const { slab, axis, room } = cand;
  const w = slab.x1 - slab.x0, d = slab.z1 - slab.z0;
  const cells = [];
  for (let z = slab.z0; z < slab.z1; z++) for (let x = slab.x0; x < slab.x1; x++) {
    const k = cellIdx(x + 0.5, z + 0.5);
    if (k >= 0) cells.push(k);
  }
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, DOOR_H, d),
    new THREE.MeshStandardMaterial({ color: 0x3a1410, emissive: 0x882216, emissiveIntensity: 0.7, roughness: 0.5, metalness: 0.3 }));
  body.position.y = DOOR_H / 2;
  grp.add(body);
  for (const sy of [1.4, 2.8, 4.2]) {     // 경고 띠
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, 0.18, d * 1.01),
      new THREE.MeshBasicMaterial({ color: 0xff5a3c, fog: false, toneMapped: false }));
    bar.position.y = sy;
    grp.add(bar);
  }
  grp.position.set((slab.x0 + slab.x1) / 2, 0, (slab.z0 + slab.z1) / 2);
  scene.add(grp);
  const sw = makeSwitch(room, axis);
  if (!sw) { scene.remove(grp); return null; }
  const door = { grp, body, cells, sw, room, open: false, t: 0, x: grp.position.x, z: grp.position.z };
  setCells(cells, false);                 // 닫힘 = 벽
  doors.push(door);
  return door;
}
function makeSwitch(r) {                  // 방 안쪽 벽에 붙는 스위치
  for (let t = 0; t < 60; t++) {
    const side = (Math.random() * 4) | 0;
    let x, z, n;
    if (side === 0) { x = r.x0 + 0.15; z = r.z0 + 1.5 + Math.random() * Math.max(0.1, r.z1 - r.z0 - 3); n = new THREE.Vector3(1, 0, 0); }
    else if (side === 1) { x = r.x1 - 0.15; z = r.z0 + 1.5 + Math.random() * Math.max(0.1, r.z1 - r.z0 - 3); n = new THREE.Vector3(-1, 0, 0); }
    else if (side === 2) { z = r.z0 + 0.15; x = r.x0 + 1.5 + Math.random() * Math.max(0.1, r.x1 - r.x0 - 3); n = new THREE.Vector3(0, 0, 1); }
    else { z = r.z1 - 0.15; x = r.x0 + 1.5 + Math.random() * Math.max(0.1, r.x1 - r.x0 - 3); n = new THREE.Vector3(0, 0, -1); }
    if (!cellSolid(x - n.x * 0.7, z - n.z * 0.7)) continue;   // 등 뒤가 벽이어야 한다
    if (cellSolid(x + n.x * 0.8, z + n.z * 0.8)) continue;    // 앞은 트여 있어야 한다
    const grp = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x14202a, roughness: 0.6, metalness: 0.4 }));
    grp.add(plate);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff3b2f, fog: false, toneMapped: false }));
    core.position.z = 0.16;
    grp.add(core);
    const lamp = borrowLight(0xff4a33, 2.4, 8, grp, 0, 0, 0.6);
    grp.position.set(x + n.x * 0.1, 1.6, z + n.z * 0.1);
    grp.lookAt(grp.position.clone().add(n));
    scene.add(grp);
    return { grp, core, lamp, x: grp.position.x, y: 1.6, z: grp.position.z, hit: false };
  }
  return null;
}
function spawnDoors() {
  clearDoors();
  if (!walkGrid || floorNo < DOOR_FLOOR) return 0;
  const cands = doorCandidates().sort(() => Math.random() - 0.5);
  for (const c of cands) {
    if (doors.length >= DOOR_MAX) break;
    if (doors.some(d => d.room === c.room || d.cor === c.cor)) continue;   // 방·복도당 하나
    const d = makeDoor(c);
    if (!d) continue;
    d.cor = c.cor;
  }
  // 문을 다 놓은 뒤, 잠긴 상태에서 스위치까지 갈 수 없는 문은 뺀다 (나중 문이 앞선 문의 길을 막을 수 있다)
  for (let guard = 0; guard < DOOR_MAX + 1; guard++) {
    const bad = doors.find(d => !reachable(playerStart.x, playerStart.z, d.sw.x, d.sw.z));
    if (!bad) break;
    removeDoor(bad);
  }
  rebuildFlow();
  return doors.length;
}
function removeDoor(d) {
  setCells(d.cells, true);
  scene.remove(d.grp); scene.remove(d.sw.grp);
  const i = doors.indexOf(d);
  if (i >= 0) doors.splice(i, 1);
}
function clearDoors() {
  for (const d of doors) { setCells(d.cells, true); scene.remove(d.grp); scene.remove(d.sw.grp); }
  doors.length = 0;
}
function openDoor(d) {
  if (d.open) return;
  d.open = true; d.t = 0;
  setCells(d.cells, true);
  d.sw.core.material.color.setHex(0x4dff9b);
  d.sw.lamp.color.setHex(0x4dff9b);
  rebuildFlow();
  banner('🔓 문이 열렸다');
  sfxChest(); shake(0.18, 0.35);
}
function hitSwitch(origin, dir, maxT) {   // 사격 판정용 — 맞은 스위치의 문을 연다
  for (const d of doors) {
    if (d.open) continue;
    const oc = new THREE.Vector3(d.sw.x, d.sw.y, d.sw.z).sub(origin);
    const t = oc.dot(dir);
    if (t < 0 || t > maxT) continue;
    if (oc.lengthSq() - t * t > 0.45 * 0.45) continue;
    burst(new THREE.Vector3(d.sw.x, d.sw.y, d.sw.z), 0x4dff9b, 16);
    openDoor(d);
    return t;
  }
  return null;
}
function updateDoors(dt) {
  for (let i = doors.length - 1; i >= 0; i--) {
    const d = doors[i];
    if (!d.open) {                        // 잠긴 동안 스위치가 깜빡인다
      d.sw.lamp.intensity = 1.8 + Math.sin(gameTime * 4) * 1.0;
      continue;
    }
    d.t += dt;                            // 바닥으로 내려간다
    d.grp.position.y = -DOOR_H * Math.min(1, d.t / 0.8);
    if (d.t > 1.1) { scene.remove(d.grp); scene.remove(d.sw.grp); doors.splice(i, 1); }
  }
}

// ---------- 점프대: 3층부터 맵에 2곳, 가운데로 들어가면 5m 도약 (1회용) ----------
const jumpPads = [];
const PAD_R = 2.4, PAD_H = 8, PAD_FLOOR = 3, PAD_COUNT = 2;   // 도약 높이 8m (5m에서 +3m)
let padTex = null;
function padTexture() {                  // 하늘색 동심원 + JUMP 글자
  if (padTex) return padTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  c.translate(128, 128);
  for (const [r, w, a] of [[120, 6, .85], [96, 3, .5], [74, 10, .7], [46, 3, .45]]) {
    c.strokeStyle = `rgba(120,220,255,${a})`; c.lineWidth = w;
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
  }
  c.fillStyle = 'rgba(160,235,255,.95)';
  c.font = '800 46px system-ui, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.letterSpacing = '8px';
  c.fillText('JUMP', 0, 2);
  padTex = new THREE.CanvasTexture(cv);
  return padTex;
}
function makeJumpPad(x, z) {
  const grp = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(PAD_R * 2, PAD_R * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: padTexture(), transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    }));
  disc.position.y = 0.04;
  grp.add(disc);
  const lamp = borrowLight(0x6fd8ff, 2.2, 9, grp, 0, 1.2, 0);
  grp.position.set(x, 0, z);
  scene.add(grp);
  jumpPads.push({ grp, disc, lamp, x, z, t: 0, used: false, fade: 0 });
}
function clearJumpPads() {
  for (const p of jumpPads) scene.remove(p.grp);
  jumpPads.length = 0;
}
// 목재상자 — 막다른 방에 놓이고, 부수면 소모품 90% · 가구 10%
const woodCrates = [];
function clearWoodCrates() { for (const c of woodCrates) scene.remove(c.grp); woodCrates.length = 0; }
function roomExits(r) {                  // 그 방에 붙은 복도 수
  let n = 0;
  for (const c of mapRects) {
    if (c.room) continue;
    const touch = (c.x0 === r.x1 || c.x1 === r.x0) ? (c.z0 >= r.z0 - 1 && c.z1 <= r.z1 + 1)
      : (c.z0 === r.z1 || c.z1 === r.z0) ? (c.x0 >= r.x0 - 1 && c.x1 <= r.x1 + 1) : false;
    if (touch) n++;
  }
  return n;
}
function spawnWoodCrates() {
  clearWoodCrates();
  if (!walkGrid || !crateGltf) return 0;
  const startRoom = roomAt(playerStart.x, playerStart.z);
  const portalRoom = portal ? roomAt(portal.x, portal.z) : null;
  for (const r of mapRects) {
    if (!r.room || r === startRoom || r === portalRoom) continue;
    if (roomExits(r) !== 1) continue;     // 입구가 하나인 방만
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    if (cellSolid(cx, cz)) continue;
    const grp = crateGltf.scene.clone(true);
    grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    normalizeSize(grp, 1.1);
    grp.position.set(cx, 0, cz);
    scene.add(grp);
    borrowLight(0xffc04a, 1.4, 5, grp, 0, 1.0, 0);
    woodCrates.push({ grp, x: cx, z: cz, hp: 60, t: 0 });
  }
  return woodCrates.length;
}
function crateOnRay(origin, dir, maxT) {  // 광선에 맞는 가장 가까운 상자 (리본용)
  let best = null, bestT = maxT;
  for (const c of woodCrates) {
    const oc = new THREE.Vector3(c.x, 0.55, c.z).sub(origin);
    const t = oc.dot(dir);
    if (t < 0.2 || t > bestT) continue;
    if (oc.lengthSq() - t * t > 0.75 * 0.75) continue;
    best = c; bestT = t;
  }
  return best ? { crate: best, t: bestT } : null;
}
function pullCrate(c) {                   // 내 앞으로 끌어온다
  const dx = player.pos.x - c.x, dz = player.pos.z - c.z;
  const d = Math.hypot(dx, dz) || 1;
  const pull = Math.max(0, d - CHAIN_STOP);
  const v = Math.min(pull * CHAIN_DAMP, 150);
  c.vx = dx / d * v; c.vz = dz / d * v;
  sfxTone(300, 0.12, 'square', 0.2, 140); sfxTone(120, 0.2, 'sawtooth', 0.18, 50);
}
function updateCrateMotion(dt) {          // 끌려오는 동안 벽에 막히며 미끄러진다
  for (const c of woodCrates) {
    if (!c.vx && !c.vz) continue;
    const nx = c.x + c.vx * dt, nz = c.z + c.vz * dt;
    if (!walkGrid || !cellSolid(nx, c.z)) c.x = nx; else c.vx = 0;
    if (!walkGrid || !cellSolid(c.x, nz)) c.z = nz; else c.vz = 0;
    const k = Math.max(0, 1 - dt * 12);   // 감쇠
    c.vx *= k; c.vz *= k;
    if (Math.hypot(player.pos.x - c.x, player.pos.z - c.z) < CHAIN_STOP) { c.vx = 0; c.vz = 0; }
    if (Math.abs(c.vx) < 0.05 && Math.abs(c.vz) < 0.05) { c.vx = 0; c.vz = 0; }
    c.grp.position.set(c.x, c.grp.position.y, c.z);
  }
}
function hitWoodCrate(origin, dir, maxT) {   // 사격으로 부순다
  for (let i = woodCrates.length - 1; i >= 0; i--) {
    const c = woodCrates[i];
    const oc = new THREE.Vector3(c.x, 0.55, c.z).sub(origin);
    const t = oc.dot(dir);
    if (t < 0 || t > maxT) continue;
    if (oc.lengthSq() - t * t > 0.62 * 0.62) continue;
    c.hp -= Math.round(34 * dmgMul());
    burst(new THREE.Vector3(c.x, 0.6, c.z), 0xc99a4a, 10);
    if (c.hp <= 0) { openWoodCrate(c); scene.remove(c.grp); woodCrates.splice(i, 1); }
    return t;
  }
  return null;
}
function openWoodCrate(c) {              // 소모품 90% · 가구 10%
  burst(new THREE.Vector3(c.x, 0.7, c.z), 0xffd76b, 26);
  sfxChest();
  if (Math.random() < 0.10) {          // 꾸미기 전리품 — 상자당 풍경 0.5% · 색 2.5% · 나머지는 가구
    const bgLeft = BG_FARM.filter(k => !farm.bg[k]);
    const palLeft = PAL_FARM.filter(h => !farm.pal[h]);
    const r = Math.random();
    if (bgLeft.length && r < 0.05) {
      const k = bgLeft[(Math.random() * bgLeft.length) | 0];
      farm.bg[k] = 1; saveFarm();
      const bg2 = BG_LIST.find(x => x.key === k);
      banner('🖼 풍경 획득 — ' + (bg2?.name ?? k));
      toast('🖼 ' + (bg2?.name ?? k) + ' — 쇼룸 풍경에 추가 (계속 쓸 수 있습니다)');
    } else if (palLeft.length && r < 0.30) {
      const h = palLeft[(Math.random() * palLeft.length) | 0];
      farm.pal[h] = 1; saveFarm();
      banner('🎨 벽 색 획득');
      toast('🎨 새 색 — 쇼룸 벽 칠하기에 추가');
    } else {
      const k = FURN_LOOT[(Math.random() * FURN_LOOT.length) | 0];
      const n = grantFurniture(k);
      banner('🪑 가구 획득 — ' + FURN[k].name + ' ×' + n);
      toast('🪑 ' + FURN[k].name + ' ×' + n + ' — 쇼룸에서 배치할 수 있습니다');
    }
    return;
  }
  const roll = Math.random();            // 물약 · 무한탄환 · 지뢰 · 수류탄
  if (roll < 0.28) dropItem('potion', c.x + 0.5, c.z);
  else if (roll < 0.53) dropItem('chest', c.x + 0.5, c.z);
  else if (roll < 0.78) dropItem('grenade', c.x + 0.5, c.z);
  else { mines = Math.min(MINE_MAX, mines + 1); updateMineSlot(); persistProgress(); toast('🧨 지뢰 +1'); }
}
function spawnJumpPads() {               // 서로 다른 방에, 시작 지점과 떨어뜨려 배치
  clearJumpPads();
  if (!walkGrid || floorNo < PAD_FLOOR) return 0;
  const rooms = mapRects.filter(r => r.room && r.x1 - r.x0 > 8 && r.z1 - r.z0 > 8);
  const used = new Set();
  for (let n = 0; n < PAD_COUNT && rooms.length; n++) {
    for (let t = 0; t < 40; t++) {
      const ri = (Math.random() * rooms.length) | 0;
      if (used.has(ri) && used.size < rooms.length) continue;
      const r = rooms[ri];
      const x = r.x0 + 3 + Math.random() * (r.x1 - r.x0 - 6);
      const z = r.z0 + 3 + Math.random() * (r.z1 - r.z0 - 6);
      if (cellSolid(x, z)) continue;
      if (Math.hypot(x - playerStart.x, z - playerStart.z) < 10) continue;
      if (portal && Math.hypot(x - portal.x, z - portal.z) < 5) continue;
      if (jumpPads.some(p => Math.hypot(p.x - x, p.z - z) < 20)) continue;
      used.add(ri);
      makeJumpPad(x, z);
      break;
    }
  }
  return jumpPads.length;
}
function updateJumpPads(dt) {
  for (let i = jumpPads.length - 1; i >= 0; i--) {
    const p = jumpPads[i];
    p.t += dt;
    if (p.used) {                        // 쓰고 나면 사라진다
      p.fade += dt * 1.6;
      p.disc.material.opacity = Math.max(0, 0.9 * (1 - p.fade));
      p.lamp.intensity = Math.max(0, 2.2 * (1 - p.fade));
      p.grp.scale.setScalar(1 + p.fade * 0.5);
      if (p.fade >= 1) { scene.remove(p.grp); jumpPads.splice(i, 1); }
      continue;
    }
    p.disc.material.opacity = 0.75 + Math.sin(p.t * 3) * 0.2;
    p.disc.rotation.y += dt * 0.5;      // 바닥에 누운 채로 천천히 회전
    p.lamp.intensity = 1.8 + Math.sin(p.t * 3) * 0.8;
    if (player.dead || player.pos.y > 0.6) continue;
    if (Math.hypot(player.pos.x - p.x, player.pos.z - p.z) > PAD_R * 0.6) continue;  // 가운데만 발동
    p.used = true;
    player.vy = Math.sqrt(2 * 13.5 * PAD_H);   // PAD_H만큼 도약
    player.onGround = false;
    jumpAnim();
    sfxTone(420, 0.28, 'sine', 0.18, 900);
    toast('⤴ 점프대!');
  }
}

// ---------- 마커: 조준점이 닿은 바닥·벽에 표시를 남겨 길을 잃지 않게 ----------
const markers = [];
const MARKER_MAX = Infinity;             // 개수 제한 없음 (층을 넘으면 초기화)
let markerTex = null, markerCanvas = null;
function markerTexture() {
  if (markerTex) return markerTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  markerCanvas = cv;
  const c = cv.getContext('2d');
  c.strokeStyle = '#39f6ff'; c.lineWidth = 9; c.lineCap = 'round';
  c.beginPath(); c.arc(64, 64, 40, 0, Math.PI * 2); c.stroke();
  c.beginPath();
  c.moveTo(40, 40); c.lineTo(88, 88); c.moveTo(88, 40); c.lineTo(40, 88);
  c.stroke();
  c.strokeStyle = 'rgba(57,246,255,.35)'; c.lineWidth = 18;
  c.beginPath(); c.arc(64, 64, 52, 0, Math.PI * 2); c.stroke();
  markerTex = new THREE.CanvasTexture(cv);
  return markerTex;
}
const MARKER_RANGE = 2;                  // 손이 닿는 거리 — 2m 이내 면에만 칠한다
function aimHitPoint(maxT = 70, fromEye = false) {  // 크로스헤어가 닿는 지점과 그 면의 법선
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const dir = raycaster.ray.direction.clone();
  // 어깨뷰에서는 카메라가 등 뒤에 있으므로, 손이 닿는 거리 판정은 플레이어 눈에서 쏜다
  const origin = fromEye
    ? new THREE.Vector3(player.pos.x, player.pos.y + player.eyeH, player.pos.z)
    : raycaster.ray.origin.clone();
  let bestT = maxT, kind = null, hitObj = null;
  if (dir.y < -0.01) {                   // 바닥
    const t = -origin.y / dir.y;
    if (t > 0.3 && t < bestT) { bestT = t; kind = 'floor'; }
  }
  const gt = gridRayT(origin, dir, bestT); // 벽
  if (gt !== null) { bestT = gt; kind = 'wall'; hitObj = null; }
  for (const o of obstacles) {           // 승강 오브젝트
    const min = new THREE.Vector3(o.x - o.w / 2, o.yOff, o.z - o.d / 2);
    const max = new THREE.Vector3(o.x + o.w / 2, o.yOff + o.h, o.z + o.d / 2);
    const t = rayAABB(origin, dir, min, max);
    if (t !== null && t > 0.3 && t < bestT) { bestT = t; kind = 'box'; hitObj = o; }
  }
  if (!kind) return null;
  const p = origin.clone().addScaledVector(dir, bestT);
  let nrm;
  if (kind === 'floor') nrm = new THREE.Vector3(0, 1, 0);
  else if (kind === 'wall') {            // 어느 축을 넘어서 막혔는지로 벽면을 판별
    for (let k = 0; k < 12 && cellSolid(p.x, p.z); k++) p.addScaledVector(dir, -0.05);  // 벽면 앞으로 되돌린다
    const qx = p.x + dir.x * 0.4, qz = p.z + dir.z * 0.4;
    const xs = cellSolid(qx, p.z), zs = cellSolid(p.x, qz);
    if (xs && !zs) nrm = new THREE.Vector3(-Math.sign(dir.x), 0, 0);
    else if (zs && !xs) nrm = new THREE.Vector3(0, 0, -Math.sign(dir.z));
    else nrm = Math.abs(dir.x) > Math.abs(dir.z)
      ? new THREE.Vector3(-Math.sign(dir.x), 0, 0)
      : new THREE.Vector3(0, 0, -Math.sign(dir.z));
  } else {                               // 박스: 맞은 면의 법선을 축별로 판정
    const dx = Math.min(Math.abs(p.x - (hitObj.x - hitObj.w / 2)), Math.abs(p.x - (hitObj.x + hitObj.w / 2)));
    const dy = Math.min(Math.abs(p.y - hitObj.yOff), Math.abs(p.y - (hitObj.yOff + hitObj.h)));
    const dz = Math.min(Math.abs(p.z - (hitObj.z - hitObj.d / 2)), Math.abs(p.z - (hitObj.z + hitObj.d / 2)));
    if (dy <= dx && dy <= dz) nrm = new THREE.Vector3(0, p.y > hitObj.yOff + hitObj.h / 2 ? 1 : -1, 0);
    else if (dx <= dz) nrm = new THREE.Vector3(Math.sign(p.x - hitObj.x) || 1, 0, 0);
    else nrm = new THREE.Vector3(0, 0, Math.sign(p.z - hitObj.z) || 1);
  }
  return { p, n: nrm, obj: kind === 'box' ? hitObj : null };
}
const markerGeo = new THREE.PlaneGeometry(1.7, 1.7);
const MARK_S = 1.7;                      // 마커 한 변 (m)
function solidAt(x, y, z) {              // 그 점이 지형(바닥·벽·박스) 속인가
  if (y < 0) return true;
  if (walkGrid && y <= WALL_H && cellSolid(x, z)) return true;
  for (const o of obstacles) {
    if (x >= o.x - o.w / 2 && x <= o.x + o.w / 2 && z >= o.z - o.d / 2 && z <= o.z + o.d / 2 &&
      y >= o.yOff && y <= o.yOff + o.h) return true;
  }
  return false;
}
function onSurface(q, n) {               // q가 법선 n인 면 위에 놓이는가 (뒤는 막히고 앞은 비었는가)
  return solidAt(q.x - n.x * 0.06, q.y - n.y * 0.06, q.z - n.z * 0.06) &&
    !solidAt(q.x + n.x * 0.06, q.y + n.y * 0.06, q.z + n.z * 0.06);
}
function faceExtent(p, n, dir) {         // 면이 dir 방향으로 이어지는 거리 (최대 반쪽)
  const q = new THREE.Vector3();
  let e = 0;
  for (let s = 0.05; s <= MARK_S / 2 + 1e-6; s += 0.05) {
    q.copy(p).addScaledVector(dir, s);
    if (!onSurface(q, n)) break;
    e = s;
  }
  return e;
}
function decalPiece(mat, center, ax, ay, az, w, h, u0, u1, v0, v1) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  const m = new THREE.Mesh(g, mat);
  m.applyMatrix4(new THREE.Matrix4().makeBasis(ax, ay, az));
  m.position.copy(center);
  return m;
}
function placeMarker() {                 // 조준한 면에 데칼처럼 표시를 남긴다 (모서리는 옆면으로 이어 그린다)
  if (player.dead) return;
  let h = aimHitPoint(MARKER_RANGE, true);
  if (!h) {                              // 2m 안에 조준한 면이 없으면 바라보는 쪽 바닥에 칠한다
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const d = raycaster.ray.direction;
    const dh = new THREE.Vector3(d.x, 0, d.z);
    if (dh.lengthSq() < 1e-4) dh.set(0, 0, -1);
    dh.normalize();
    const eye = new THREE.Vector3(player.pos.x, player.pos.y + player.eyeH, player.pos.z);
    const gt = gridRayT(eye, dh, MARKER_RANGE);
    const r = gt === null ? MARKER_RANGE : Math.max(0.4, gt - 0.3);
    h = { p: new THREE.Vector3(player.pos.x + dh.x * r, 0, player.pos.z + dh.z * r), n: new THREE.Vector3(0, 1, 0) };
  }
  const mat = new THREE.MeshBasicMaterial({
    map: markerTexture(), transparent: true, depthWrite: false, opacity: 0.95,
    side: THREE.DoubleSide, fog: false, toneMapped: false
  });
  const S = MARK_S, half = S / 2, OFF = 0.05;
  const p = h.p, n = h.n;
  const u = Math.abs(n.y) > 0.5
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0).cross(n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const nu = u.clone().negate(), nv = v.clone().negate();
  const eU = faceExtent(p, n, u), eNU = faceExtent(p, n, nu);
  const eV = faceExtent(p, n, v), eNV = faceExtent(p, n, nv);
  const grp = new THREE.Group();
  const cU = (eU - eNU) / 2, cV = (eV - eNV) / 2;   // 잘린 만큼 중심이 밀린다
  if (eU + eNU > 0.05 && eV + eNV > 0.05) {         // 면에 붙는 본체
    grp.add(decalPiece(mat,
      p.clone().addScaledVector(u, cU).addScaledVector(v, cV).addScaledVector(n, OFF),
      u, v, n, eU + eNU, eV + eNV,
      (half - eNU) / S, (half + eU) / S, (half - eNV) / S, (half + eV) / S));
  }
  // 삐져나온 쪽은 이어지는 면(볼록: 옆면 / 오목: 마주보는 벽)에 계속 그린다
  const folds = [
    { dir: u, e: eU, along: 'u' }, { dir: nu, e: eNU, along: 'u' },
    { dir: v, e: eV, along: 'v' }, { dir: nv, e: eNV, along: 'v' },
  ];
  for (const f of folds) {
    const rem = half - f.e;
    if (rem < 0.08) continue;
    const edge = p.clone().addScaledVector(f.dir, f.e);
    const probe = edge.clone().addScaledVector(f.dir, 0.12).addScaledVector(n, 0.06);
    const concave = solidAt(probe.x, probe.y, probe.z);
    const axis = concave ? n.clone() : n.clone().negate();      // 모서리를 돌아 이어지는 방향
    const fn = concave ? f.dir.clone().negate() : f.dir.clone();// 이어진 면의 법선
    const wide = f.along === 'u' ? eV + eNV : eU + eNU;         // 모서리와 나란한 쪽 길이
    if (wide < 0.05) continue;
    const side = f.along === 'u' ? v : u;
    const cSide = f.along === 'u' ? cV : cU;
    const edgeUV = f.dir === u ? (half + eU) / S
      : f.dir === nu ? (half - eNU) / S
        : f.dir === v ? (half + eV) / S : (half - eNV) / S;
    const endUV = (f.dir === u || f.dir === v) ? 1 : 0;
    const sideUV0 = f.along === 'u' ? (half - eNV) / S : (half - eNU) / S;
    const sideUV1 = f.along === 'u' ? (half + eV) / S : (half + eU) / S;
    const center = edge.clone().addScaledVector(axis, rem / 2).addScaledVector(side, cSide).addScaledVector(fn, OFF);
    grp.add(f.along === 'u'
      ? decalPiece(mat, center, axis, side, fn, rem, wide, edgeUV, endUV, sideUV0, sideUV1)
      : decalPiece(mat, center, side, axis, fn, wide, rem, sideUV0, sideUV1, edgeUV, endUV));
  }
  if (!grp.children.length) { toast("여기엔 칠할 수 없습니다"); return; }
  if (h.obj) {                           // 움직이는 오브젝트에 칠하면 함께 움직인다
    h.obj.grp.add(grp);
    grp.position.sub(h.obj.grp.position);
  } else scene.add(grp);
  markers.push({ sp: grp, mat, obj: h.obj || null, x: p.x, z: p.z, t: 0 });
  if (markers.length > MARKER_MAX) removeMarker(markers.shift());
  updateMarkerSlot();
  sfxTone(1200, 0.07, "sine", 0.12);
  toast("📍 마커 " + markers.length + "개");
}
function updateMarkerSlot() {
  const el = document.getElementById('kSlot');
  if (!el) return;
  const icon = el.querySelector('.mIcon');
  if (icon && !icon.firstElementChild) {   // 슬롯 아이콘도 실제로 찍히는 문양으로
    markerTexture();
    icon.textContent = '';
    const img = document.createElement('img');
    img.src = markerCanvas.toDataURL();
    img.alt = '';
    icon.appendChild(img);
  }
  document.getElementById('kCnt').textContent = '∞';   // 마커는 개수 제한 없이 언제나 사용 가능
  el.classList.remove('empty');
}
updateMarkerSlot();                      // 시작 시 아이콘·개수 표시
function removeMarker(m) {
  m.sp.parent?.remove(m.sp);
  m.sp.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  m.mat.dispose();
}
function clearMarkers() { for (const m of markers) removeMarker(m); markers.length = 0; updateMarkerSlot(); }
function updateMarkers(dt) {
  for (const m of markers) {
    m.t += dt;
    m.mat.opacity = 0.7 + Math.sin(m.t * 3) * 0.25;
  }
}
// ---------- 비콘 이벤트: 3웨이브마다 먼 방에 표적, 제한시간 안에 도달하면 보상 ----------
let beacon = null;                       // {grp, x, z, t, limit}
const BEACON_LIMIT = 26, BEACON_COINS = 400;
function spawnBeacon() {
  clearBeacon();
  if (!walkGrid || !spawnPoints.length) return;
  let best = null, bestD = -1;            // 플레이어에서 가장 먼 지점
  for (const c of spawnPoints) {
    const d = Math.hypot(c.x - player.pos.x, c.z - player.pos.z);
    if (d > bestD) { bestD = d; best = c; }
  }
  if (!best || bestD < 12) return;
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.55, depthWrite: false, fog: false, toneMapped: false });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 14, 18, 1, true), mat);
  pillar.position.y = 7;
  grp.add(pillar);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.08, 8, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd54a, fog: false, toneMapped: false }));
  ring.position.y = 0.06;
  grp.add(ring);
  const lamp = borrowLight(0xffd54a, 3, 12, grp, 0, 1.6, 0);
  grp.position.set(best.x, 0, best.z);
  scene.add(grp);
  beacon = { grp, ring, x: best.x, z: best.z, t: 0, limit: BEACON_LIMIT };
  document.getElementById('beaconHud').style.display = 'block';
  banner('보급 신호 발신 — 표적으로!');
  sfxTone(880, 0.16, 'sine', 0.16); setTimeout(() => sfxTone(1320, 0.2, 'sine', 0.14), 160);
}
function clearBeacon() {
  if (beacon) scene.remove(beacon.grp);
  beacon = null;
  const hud = document.getElementById('beaconHud');
  if (hud) hud.style.display = 'none';
}
function updateBeacon(dt) {
  if (!beacon) return;
  beacon.t += dt;
  const left = beacon.limit - beacon.t;
  beacon.ring.scale.setScalar(1 + Math.sin(beacon.t * 3) * 0.12);
  beacon.grp.rotation.y += dt * 0.8;
  const d = Math.hypot(player.pos.x - beacon.x, player.pos.z - beacon.z);
  document.getElementById('beaconT').textContent = Math.max(0, Math.ceil(left));
  document.getElementById('beaconD').textContent = Math.round(d);
  if (d < 2.4) {                          // 도달 — 보상
    coins += BEACON_COINS;
    grenades = Math.min(5, grenades + 1);
    setCoinHud();
    flashChip('coinN'); updateGSlot(); persistProgress(); renderUpg();
    toast('📦 보급 확보 — +' + BEACON_COINS + '🪙 · 수류탄 +1');
    sfxChest();
    clearBeacon();
  } else if (left <= 0) {                 // 시간 초과
    toast('보급 신호 소실');
    sfxTone(200, 0.4, 'sawtooth', 0.16, -80);
    clearBeacon();
  }
}

// ---------- 지뢰 (상점 구매 · G키 설치 · 적 접근 시 폭발) ----------
let mines = 0;
const liveMines = [];
const MINE_MAX = 5, MINE_COST = 150, MINE_DMG = 220, MINE_R = 5;
function updateMineSlot() {
  const el = document.getElementById('mSlot');
  if (!el) return;
  document.getElementById('mCnt').textContent = mines;
  el.classList.toggle('empty', mines === 0);
  el.classList.toggle('active', slot === 'mine');
}
function placeMine() {
  if (mines <= 0 || player.dead) return;
  mines--;
  if (mines <= 0 && slot === 'mine') { slot = 'gun'; }
  updateMineSlot(); persistProgress();
  const grp = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 16),
    new THREE.MeshStandardMaterial({ color: 0x3a2020, emissive: 0xff2200, emissiveIntensity: 0.7 }));
  disc.position.y = 0.05;
  grp.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff3311, transparent: true, opacity: 0.8, fog: false, toneMapped: false }));
  ring.position.y = 0.06;
  grp.add(ring);
  grp.position.set(player.pos.x, 0.02, player.pos.z);
  scene.add(grp);
  liveMines.push({ grp, ring, t: 0, armed: 0.7, beeped: false });
  if (!playSample('c4plant', { vol: 0.9, verb: 0.2 })) sfxTone(420, 0.08, 'square', 0.12);
  toast('🧨 지뢰 설치');
}
function explodeAt(pos, radius, dmg, color, kind = 'grenade') {
  burst(pos, color, 26);
  flashLight.position.copy(pos); flashLight.intensity = 50; flashT = 0.1;
  shake(0.25, 0.35);
  sfxExplosion(0.9, kind);
  for (const en of enemies) {
    if (en.state === 'dead') continue;
    const d = Math.hypot(en.root.position.x - pos.x, en.root.position.z - pos.z);
    if (d >= radius) continue;
    damageEnemy(en, dmg); en.hitFlash = 0.2;
    if (en.hp <= 0) killEnemy(en);
  }
}
function updateMines(dt) {
  for (let i = liveMines.length - 1; i >= 0; i--) {
    const m = liveMines[i];
    m.t += dt; m.armed -= dt;
    if (!m.beeped && m.armed <= 0) { m.beeped = true; playSample('c4beep', { vol: 0.7, verb: 0.1, jitter: 0 }); }   // 무장 완료 삐
    const k = 1 + Math.sin(m.t * 5) * 0.08;
    m.ring.scale.set(k, k, k);
    m.ring.material.opacity = 0.5 + Math.sin(m.t * 5) * 0.3;
    if (m.armed > 0) continue;
    let trig = false;
    for (const en of enemies) {
      if (en.state === 'dead') continue;
      if (Math.hypot(en.root.position.x - m.grp.position.x, en.root.position.z - m.grp.position.z) < 2.2) { trig = true; break; }
    }
    if (trig) {
      const p = m.grp.position.clone(); p.y = 0.4;
      scene.remove(m.grp); liveMines.splice(i, 1);
      explodeAt(p, MINE_R * blastRad(), Math.round(MINE_DMG * blastMul()), 0xff7733, 'mine');
    }
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
  // 층마다 투사체 속도 +20% (최대 2배) — 1초 도달 → 최소 0.5초
  const spd = Math.min(2, 1 + 0.2 * (stageNo() - 1));
  const vel = dir.divideScalar(1.0 / spd);
  const m = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: 0x5affd0, transparent: true, opacity: 0.95 }));
  m.position.copy(origin);
  scene.add(m);
  projectiles.push({ m, vel, life: 1.15 / spd + 0.15, dmg: en.dmg, from: en });
  sfxTone(220, 0.3, 'sawtooth', 0.14, 240);
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.life -= dt;
    pr.m.position.addScaledVector(pr.vel, dt);
    pr.m.rotation.y += dt * 8;
    if (pr.mine) {                      // 되돌린 투사체 — 적을 맞힌다
      let done = false;
      for (const en of enemies) {
        if (en.state === 'dead' || en.gone) continue;
        const e2 = en.root.position;
        if (Math.hypot(pr.m.position.x - e2.x, pr.m.position.z - e2.z) < 0.8 * en.scale
          && Math.abs(pr.m.position.y - (e2.y + 1.1 * en.scale)) < 1.2 * en.scale) {
          if (damageEnemy(en, Math.round(pr.dmg * 2.2 * dmgMul()), 'parry')) killEnemy(en);   // 되돌린 탄으로도 처치된다
          burst(pr.m.position, 0xfff0a0, 12);
          done = true; break;
        }
      }
      if (done || pr.life <= 0) { scene.remove(pr.m); projectiles.splice(i, 1); }
      continue;
    }
    // 플레이어 명중 판정
    const dx = pr.m.position.x - player.pos.x, dz = pr.m.position.z - player.pos.z;
    const dy = pr.m.position.y - (player.pos.y + 1.1);
    let hit = !player.dead && Math.hypot(dx, dz) < 0.75 && Math.abs(dy) < 1.1
      && player.pos.y - pr.m.position.y < HIGH_SAFE;   // 높은 곳으로 피하면 스친다
    if (hit && blocking && canBlock() && frontAttack(pr.m.position.x, pr.m.position.z)) {
      if (parryReady()) {                // 패링: 쏜 쪽으로 되돌린다
        parryFx(pr.from, pr.m.position.x, pr.m.position.z);
        const back = pr.from && !pr.from.gone
          ? pr.from.root.position.clone().add(new THREE.Vector3(0, 1.1 * pr.from.scale, 0)).sub(pr.m.position).normalize()
          : pr.vel.clone().negate().normalize();
        pr.vel.copy(back.multiplyScalar(pr.vel.length() * 1.3));
        pr.mine = true; pr.life = 2.2;
        pr.m.material.color.setHex(0xffe08a);
        continue;
      }
      sfxTone(200, 0.12, 'square', 0.22);   // 늦은 막기: 튕겨내고 피해 없음
      burst(pr.m.position, 0x9fd8ff, 8);
      scene.remove(pr.m); projectiles.splice(i, 1);
      continue;
    }
    if (hit) damagePlayer(pr.dmg, pr.m.position.x, pr.m.position.z, pr.from);
    const wallHit = walkGrid && pr.m.position.y < WALL_H && cellSolid(pr.m.position.x, pr.m.position.z);
    if (hit || wallHit || pr.life <= 0) {
      burst(pr.m.position, 0x5affd0, 8);
      scene.remove(pr.m);
      projectiles.splice(i, 1);
    }
  }
}

function wakeEnemy(en) {                 // 대기 해제
  if (!en.dormant) return;
  en.dormant = false;
  en.state = 'chase';
  enPlay(en, 'mutant roaring', 0.15);
  en.spawnHold = 0.9; en.t = 0; en.state = 'spawn';
  sfxRoar(); shake(0.2, 0.4);
  banner('⚠ BOSS 각성');
}
function damageEnemy(en, dmg, kind) {    // 추격자는 무적 — 누적 피해 1000마다 스턴
  if (en.dormant) wakeEnemy(en);         // 맞으면 깨어난다
  popupDamage(en, dmg, kind);
  if (en.invuln) {
    en.stunAcc += dmg;
    if (en.stunAcc >= 1000) {
      en.stunAcc -= 1000;
      en.stunT = 2;
      toast('⚡ 추격자 스턴!');
      sfxTone(300, 0.3, 'square', 0.2, 500);
    }
    return false;
  }
  en.hp -= dmg;
  refreshHpBar(en);
  return en.hp <= 0;
}
const goreOn = true;                     // 사지 절단 연출 (항상 켬)
const LIMB_GEO = new THREE.CapsuleGeometry(0.09, 0.26, 4, 8);   // 떨어져 나간 팔·다리 (공유)
const limbMat = new THREE.MeshStandardMaterial({ color: 0x6b4a44, roughness: 0.9 });
const LIMB_RE = /(upperarm|forearm|hand|thigh|calf|shin|foot|leg|arm)/i;
function dismember(en) {                 // 죽을 때 사지 한둘을 랜덤으로 떼어 낸다
  if (!goreOn || en.kind === 'boss' || en.invuln) return;
  if (Math.random() > 0.45) return;      // 45% 확률
  const bones = [];
  en.root.traverse(o => { if (o.isBone && LIMB_RE.test(o.name) && !/end/i.test(o.name)) bones.push(o); });
  if (!bones.length) return;
  const n = Math.random() < 0.3 ? 2 : 1; // 가끔 두 군데
  const used = new Set();
  for (let i = 0; i < n; i++) {
    const b = bones[(Math.random() * bones.length) | 0];
    if (!b || used.has(b.uuid)) continue;
    used.add(b.uuid);
    const at = b.getWorldPosition(new THREE.Vector3());
    const m = new THREE.Mesh(LIMB_GEO, limbMat);        // 떨어진 조각
    m.position.copy(at);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.scale.setScalar(en.scale);
    m.castShadow = true;
    scene.add(m);
    particles.push({ m, v: new THREE.Vector3((Math.random() - .5) * 4, 2.4 + Math.random() * 2, (Math.random() - .5) * 4), life: 1.6 + Math.random() * 0.6 });
    b.scale.setScalar(0.001);                            // 본체에서는 그 부위를 감춘다
    en.cutBones = en.cutBones || [];
    en.cutBones.push(b);
    burst(at, 0x8c1220, 14);                             // 핏빛 파편
  }
  sfxTone(90, 0.18, 'sawtooth', 0.24, -40);
}
function killEnemy(en, scoreMult = 1) {
  if (en.invuln) return;
  en.state = 'dead'; en.t = 0;
  if (en.hpBar) en.hpBar.grp.visible = false;
  clearAoe(en);
  en.kbX = en.kbZ = 0;
  enPlay(en, 'mutant dying', 0.1, true);
  sfxDie();
  dismember(en);                          // 사지 절단 (확률)
  kills++;
  if (walkGrid && !hunter) floorTime = Math.min(FLOOR_TIME * 2, floorTime + 2);   // 처치마다 +2초 (추격자 등장 뒤에는 이 층에서 더 늘지 않는다)
  lastKillClock = gameTime;                                            // 소강 상태 감지용
  // 7초 내 연속킬 → 콤보. 점수는 콤보 배율 적용 (100 × 단계 × 콤보)
  combo = (gameTime - lastKillT <= 7) ? combo + 1 : 1;
  lastKillT = gameTime;
  score += 100 * Math.max(1, stageNo()) * combo * scoreMult;   // 헤드샷 킬 = 2배 (랜덤맵은 층이 단계)
  // 0.7초 안에 겹쳐 죽이면 멀티킬 — 복도에 몰아넣고 터뜨리는 플레이 보상
  multiN = (gameTime - multiT <= 0.7) ? multiN + 1 : 1;
  multiT = gameTime;
  if (multiN >= 2) {
    const label = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'QUAD KILL' }[multiN] || ('MULTI KILL x' + multiN);
    const bonus = 50 * multiN;
    coins += bonus;
    setCoinHud();
    flashChip('coinN');
    persistProgress();
    const mk = document.getElementById('multiKill');
    mk.textContent = label + '  +' + bonus + '🪙';
    mk.classList.remove('pop'); void mk.offsetWidth; mk.classList.add('pop');
    sfxTone(660 + multiN * 120, 0.14, 'square', 0.16);
  }
  if (combo >= 2) {
    const c = document.getElementById('combo');
    c.textContent = `+${combo} COMBO!`;
    c.classList.remove('pop');
    void c.offsetWidth;              // 애니메이션 재트리거
    c.classList.add('pop');
    sfxTone(660 + combo * 110, 0.12, 'square', 0.14);
  }
  document.getElementById('scoreN').textContent = fmt(score);
  document.getElementById('kills').textContent = kills;
  flashChip('scoreN'); flashChip('kills');
  updateHudWave();
  if (en === bossOfFloor) {              // 보스 코어: 영구 강화 + 시간 확보
    bossOfFloor = null;
    cores++;
    const keys = Object.keys(upg);
    const k = keys[(Math.random() * keys.length) | 0];
    upg[k]++;
    if (k === 'hp') { player.hp = Math.min(maxHp(), player.hp + 10); updateHpHud(); }
    if (k === 'mag') updateAmmo();
    floorTime = Math.min(FLOOR_TIME * 2, floorTime + 30);
    coins += 500;
    setCoinHud();
    flashChip('coinN'); persistProgress(); renderUpg();
    banner('💠 보스 코어 획득 — ' + UPG_NAMES[k] + ' 강화!');
    toast('💠 코어: ' + UPG_NAMES[k] + ' +5% · +30초 · +500🪙');
    sfxChest();
    setTimeout(unlockPortal, 700);       // 포탈 개방
  }
  // 드롭: 코인 100% + 포션 10% + 상자 5%
  const px = en.root.position.x, pz = en.root.position.z;
  dropCoins(px, pz);
  const roll = Math.random();
  if (roll < 0.10) dropItem('potion', px + 0.7, pz);
  else if (roll < 0.15) dropItem('chest', px + 0.9, pz);
  else if (roll < 0.20) dropItem('grenade', px + 0.7, pz); // 수류탄 5%
  if (!walkGrid && aliveCount() === 0 && !waveQueue.length) setTimeout(nextWave, 1600);   // 웨이브는 광장 전용
}
const aliveCount = () => enemies.filter(e => e.state !== 'dead' && !e.invuln).length;
function updateHudWave() {
  document.getElementById('left').textContent = aliveCount();
  document.getElementById('waveN').textContent = stageNo();
  const w = document.getElementById('wave'), lw = document.getElementById('leftWrap');
  if (w) w.classList.toggle('rnd', !!walkGrid);          // 랜덤맵은 미니맵 아래에
  if (lw) lw.style.display = walkGrid ? 'none' : '';     // 랜덤맵은 남은 마릿수를 쓰지 않는다
  if (walkGrid) {                        // 장비는 랜덤맵(층)에서만 얻는다
    if (stageNo() >= PISTOL_STAGE) grantPistol();
    if (stageNo() >= RIBBON_STAGE) grantRibbon();
  }
}

// 다음 층으로 — 맵을 새로 그리고 A 지점에서 다시 시작
function nextFloor() {
  floorNo++;
  markDeep(floorNo);
  refillWeapons();                       // 도착하자마자 쏠 수 있게
  if (floorNo >= PISTOL_STAGE) grantPistol();
  if (floorNo >= RIBBON_STAGE) grantRibbon();
  floorTime = FLOOR_TIME;
  hunter = null;
  clearSpawnTimers();
  for (const en of enemies) retireEnemy(en);
  enemies.length = 0;
  for (const d of drops) scene.remove(d.root); drops.length = 0;
  for (const c of coinFx) scene.remove(c.root); coinFx.length = 0;
  for (const pr of projectiles) scene.remove(pr.m); projectiles.length = 0;
  for (const gr of liveGrenades) { scene.remove(gr.root); if (gr.circle) scene.remove(gr.circle); }
  liveGrenades.length = 0;
  for (const m of liveMines) scene.remove(m.grp);
  liveMines.length = 0;
  clearBeacon();
  clearMarkers();
  clearJumpPads();
  clearDoors();
  clearWoodCrates();
  buildMap();                            // 새 랜덤맵 (새 시드)
  player.pos.copy(playerStart); player.vy = 0; player.onGround = true;
  rebuildFlow();
  coins += 200;
  setCoinHud();
  flashChip('coinN'); persistProgress();
  banner('단계 ' + floorNo);
  toast('🌀 다음 단계 — +200🪙');
  sfxChest();
  startFloor();
}
const ROOM_DENSITY = 100;                // 1마리 / 10m×10m
const ROOM_CAP = 6, FLOOR_CAP = 28;      // 방당·층당 초기 배치 상한 (성능)
const LIVE_CAP = 26;                     // 동시에 살아 있을 수 있는 최대 수
const FAR_DESPAWN = 70;                   // 이보다 멀어진 적은 정리한다(먼 곳에서 계속 도는 비용 제거)
function populateRooms() {               // 빈 방이 없도록 면적 비례 배치
  if (!walkGrid) return 0;
  const rooms = mapRects.filter(r => r.room);
  // 면적 비례로 뽑되, 상한을 넘으면 방마다 1마리는 보장하고 나머지만 비례 축소
  const want = rooms.map(r => Math.min(ROOM_CAP, Math.max(1, Math.round((r.x1 - r.x0) * (r.z1 - r.z0) / ROOM_DENSITY))));
  const sum = want.reduce((a, b) => a + b, 0);
  if (sum > FLOOR_CAP && sum > rooms.length) {
    const k = Math.max(0, (FLOOR_CAP - rooms.length) / (sum - rooms.length));
    for (let i = 0; i < want.length; i++) want[i] = 1 + Math.floor((want[i] - 1) * k);
  }
  let total = 0, delay = 0;
  for (let ri = 0; ri < rooms.length; ri++) {
    const r = rooms[ri];
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    for (let i = 0; i < want[ri]; i++) {
      let x = 0, z = 0, ok = false;
      for (let t = 0; t < 10 && !ok; t++) {
        x = r.x0 + 1.5 + Math.random() * Math.max(0.1, w - 3);
        z = r.z0 + 1.5 + Math.random() * Math.max(0.1, d - 3);
        ok = !cellSolid(x, z) && Math.hypot(x - playerStart.x, z - playerStart.z) > 10;  // 시작 지점 바로 옆은 비움
      }
      if (!ok) continue;
      total++;
      const px = x, pz = z;
      const wait = inSafeRoom(px, pz) ? SAFE_T * 1000 : 0;  // 도착한 방은 유예 뒤에 채운다
      setTimeout(() => {                 // 한 번에 만들면 끊기니 조금씩
        if (player.dead) return;
        const e = spawnEnemy(floorNo, floorEnemyKind());
        if (e) e.root.position.set(px, 0, pz);
      }, wait + (delay += 45));
    }
  }
  return total;
}
function startFloor() {                  // 층 시작 시 개체 배치
  spawnCd = 2.5;
  lastKillClock = gameTime;
  bossOfFloor = null;
  safeRoom = roomAt(playerStart.x, playerStart.z);   // 도착한 방은 10초간 무스폰
  safeUntil = gameTime + SAFE_T;
  spawnJumpPads();                                  // 3층부터 점프대 2곳
  spawnDoors();                                     // 6층부터 스위치로 여는 문
  spawnWoodCrates();                                // 막다른 방의 목재상자
  populateRooms();
  if (floorNo % 5 === 0) {               // 5층마다 보스 — 포탈 방을 지킨다
    setTimeout(() => {
      if (player.dead) return;
      const b = spawnEnemy(floorNo, 'boss');
          if (b && portal) {
        b.root.position.set(portal.x + 3, 0, portal.z + 2);
        b.homeRoom = mapRects.find(r => r.room && portal.x >= r.x0 && portal.x <= r.x1 && portal.z >= r.z0 && portal.z <= r.z1) || null;
      }
      banner('⚠ BOSS가 포탈을 지킨다');
      sfxRoar();
    }, 900);
  }
}
// 층 이동 연출 + 상점
function floorTransition() {
  const fx = document.getElementById('warpFx');
  fx.classList.remove('go'); void fx.offsetWidth; fx.classList.add('go');
  sfxTone(300, 0.25, 'sine', 0.2, 900);
  setTimeout(() => sfxTone(900, 0.3, 'sine', 0.16, -400), 120);
  shake(0.3, 0.4);
  setTimeout(() => {                     // 화면이 하얗게 덮인 순간에 맵 교체
    nextFloor();
    openFloorShop();
  }, 240);
}
function openFloorShop() {               // 층 시작 시에만 상점을 연다
  floorShopOpen = true;
  paused = true;
  if (document.pointerLockElement) document.exitPointerLock();
  refreshOverlay();
}
function updateFloor(dt) {
  if (!walkGrid) { document.getElementById('floorHud').style.display = 'none'; return; }
  const hud = document.getElementById('floorHud');
  hud.style.display = 'block';
  if (floorTime > 0) {
    floorTime -= dt;
    if (floorTime <= 0) {                // 시간 초과 — 추격자 등장
      floorTime = 0;
      if (!hunter) {
        spawnEnemy(Math.max(1, wave), 'hunter');
        banner('⚠ 추격자 등장 — 포탈로!');
        sfxRoar(); shake(0.35, 0.6);
      }
    }
  }
  document.getElementById('waveN').textContent = floorNo;   // 단계 표시도 층으로
  const w2 = document.getElementById('wave'), lw2 = document.getElementById('leftWrap');
  if (w2) w2.classList.add('rnd');
  if (lw2) lw2.style.display = 'none';
  document.getElementById('floorT').textContent = floorTime > 0 ? Math.ceil(floorTime) + 's' : '추격 중';
  hud.classList.toggle('danger', floorTime <= 10);
  // 포탈 도달 → 다음 층
  if (portal) {
    portal.t += dt;
    if (portal.ring.visible) portal.ring.rotation.z += dt * 1.2;
    const k = 1 + Math.sin(portal.t * 2.5) * 0.08;
    portal.ring.scale.set(k, k, k);
    const nearPortal = Math.hypot(player.pos.x - portal.x, player.pos.z - portal.z) < 2.2;
    if (portal.locked) {
      portal.lock.position.y = 3.2 + Math.sin(portal.t * 3) * 0.18;
      if (nearPortal && gameTime - (portal.warnT || 0) > 2.5) {
        portal.warnT = gameTime;
        toast('🔒 보스를 처치해야 열린다');
        sfxTone(160, 0.25, 'square', 0.16, -40);
      }
    } else if (!warping && nearPortal) {
      warping = true;
      floorTransition();
      setTimeout(() => warping = false, 900);
    }
  }
}
// ---------- 랜덤맵: 웨이브 없이 방별 쿨타임 스폰 ----------
let spawnCd = 3, lastKillClock = 0, bossOfFloor = null, cores = 0, farTick = 0, lavaBurn = 0;
function floorEnemyKind() {              // 층에 따라 개체 해금: 러너 1층~, 점퍼 3층~, 원거리 4층~
    const pool = ['walker', 'walker', 'runner'];
  if (floorNo >= 3) pool.push('jumper');
  if (floorNo >= 4) pool.push('ranged');
  return pool[(Math.random() * pool.length) | 0];
}
const shadowMax = () => shadowQ === 'high' ? 10 : 0;   // 높음: 가까운 10마리가 진짜 그림자 · 그 외: 그림자 원
const BLOB_GEO = new THREE.CircleGeometry(0.55, 20).rotateX(-Math.PI / 2);
const BLOB_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false });
function ensureBlob(en, on) {            // 진짜 그림자가 없는 적은 발밑에 어두운 원 (드로우콜 1 · 삼각형 20)
  if (on && !en.blob) {
    en.blob = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
    en.blob.scale.setScalar(en.scale || 1);
    en.blob.renderOrder = 1;
    scene.add(en.blob);
  } else if (!on && en.blob) { scene.remove(en.blob); en.blob = null; }
}
function dropBlob(en) { if (en.blob) { scene.remove(en.blob); en.blob = null; } }
function syncBlobs() {
  for (const en of enemies) if (en.blob) en.blob.position.set(en.root.position.x, en.root.position.y + 0.03, en.root.position.z);
  if (playerBlob?.visible) placePlayerBlob();
}
function placePlayerBlob() {             // 원 그림자는 발밑 지면(또는 아래 발판)에 남고, 점프하면 높이에 따라 작아진다
  const keep = supObs;
  const ground = supportHeight(player.pos);
  supObs = keep;
  const h = Math.max(0, player.pos.y - ground);
  playerBlob.position.set(player.pos.x, ground + 0.03, player.pos.z);
  playerBlob.scale.setScalar(Math.max(0.45, 1 - h * 0.07));
}
let playerBlob = null;
function syncPlayerShadow() {             // 보통/끔: 정적 그림자 맵은 6프레임마다만 굽기 때문에 캐릭터를 넣으면 3인칭에서 그림자가 10Hz로 끊겨 보인다 → 캐릭터는 원 그림자
  if (!player.root) return;
  const real = shadowOn && shadowQ === 'high';
  player.root.traverse(o => { if (o.isMesh || o.isSkinnedMesh) o.castShadow = real; });
  if (!real && shadowOn) {
    if (!playerBlob) { playerBlob = new THREE.Mesh(BLOB_GEO, BLOB_MAT); playerBlob.renderOrder = 1; scene.add(playerBlob); }
    playerBlob.visible = true;
    placePlayerBlob();
  } else if (playerBlob) playerBlob.visible = false;
}
let shadowTick = 0;
function updateShadowLod(dt) {
  shadowTick -= dt;
  if (shadowTick > 0) return;
  shadowTick = 0.25;
  const live = [];
  for (const en of enemies) {
    if (en.gone) continue;
    const dx = en.root.position.x - player.pos.x, dz = en.root.position.z - player.pos.z;
    en.shadowD2 = dx * dx + dz * dz;
    live.push(en);
  }
  live.sort((a, b) => a.shadowD2 - b.shadowD2);
  for (let i = 0; i < live.length; i++) {
    const en = live[i];
    const on = shadowOn && i < shadowMax() && en.shadowD2 < 1600 && en.state !== 'dead';
    ensureBlob(en, !on && en.state !== 'dead');
    if (en.shadowOn === on) continue;
    en.shadowOn = on;
    en.root.traverse(o => { if (o.isMesh || o.isSkinnedMesh) o.castShadow = on; });
  }
}
function roomSpawnTick(dt) {
  if (!walkGrid || player.dead) return;
  const alive = aliveCount();
  const cap = Math.min(LIVE_CAP, 16 + floorNo);          // 층이 올라가도 동시 등장은 완만하게
  spawnCd -= dt;
  if (spawnCd <= 0) {                    // 방마다 쿨타임으로 계속 유입
    spawnCd = Math.max(1.6, 5 - floorNo * 0.2);
    if (alive < cap) {
      const k = 1 + (Math.random() < 0.35 ? 1 : 0);
      for (let i = 0; i < k; i++) spawnEnemy(floorNo, floorEnemyKind());
    }
  }
  farTick += dt;
  if (farTick >= 0.5) {                  // 아주 멀어진 적은 조용히 정리 (0.5초마다 검사)
    farTick = 0;
    for (const en of enemies) {
      if (en.state === 'dead' || en.invuln || en.dormant || en === bossOfFloor) continue;
      const dx = en.root.position.x - player.pos.x, dz = en.root.position.z - player.pos.z;
      if (dx * dx + dz * dz > FAR_DESPAWN * FAR_DESPAWN) retireEnemy(en);
    }
  }
  // 소강 방지: 마지막 처치 후 10초간 킬이 없으면 근처에 2마리
  if (gameTime - lastKillClock > 10) {
    lastKillClock = gameTime;
    for (let i = 0; i < 2; i++) {
      const e = spawnEnemy(floorNo, floorEnemyKind());
      if (!e) continue;
      for (let t = 0; t < 8; t++) {
        const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 6;
        const x = player.pos.x + Math.cos(a) * r, z = player.pos.z + Math.sin(a) * r;
        if (cellSolid(x, z) || inSafeRoom(x, z)) continue;
        e.root.position.set(x, 0, z);
        break;
      }
    }
    toast('적 증원!');
  }
}
function nextWave() {
  if (player.dead || walkGrid) return;   // 랜덤맵은 층·쿨타임 스폰을 쓴다
  wave++;
  refillWeapons();                       // 웨이브 시작은 항상 만탄으로
  document.getElementById('waveN').textContent = wave;
  const runners = Math.max(0, wave - 2) + (wave >= 3 ? 3 : 0); // 웨이브3부터 1마리+추가분 3마리 전부 러너, 이후 +1
  const jumpers = wave >= 6 ? Math.min(3, wave - 5) : 0;      // 웨이브6부터 1마리, 이후 +1 (최대 3)
  const rangers = wave >= 9 ? Math.min(3, wave - 8) : 0;      // 웨이브9부터 1마리, 이후 +1 (최대 3)
  const bosses = wave % 10 === 0 ? 1 : 0;                     // 10웨이브마다 보스
  banner('단계 ' + wave + (bosses ? ' — ⚠ BOSS 출현 ⚠' : rangers ? ' — 원거리 개체 출현!' : jumpers ? ' — 도약 개체 출현!' : runners ? ' — 러너 출현!' : ''));
  if (walkGrid && wave % 3 === 0 && wave % 10 !== 0) setTimeout(() => { if (!player.dead) spawnBeacon(); }, 1200);
  else clearBeacon();
  const count = (2 + wave) * 2 + 3 + bosses; // 일반 개체 2배 + 3마리 (보스는 별도 1마리 유지)
  waveQueue.length = 0;                  // 한 번에 다 쏟지 않고 대기열에 넣어 순차 투입 (동시 수가 늘면 렉)
  for (let i = 0; i < count; i++) {
    waveQueue.push(i < bosses ? 'boss'
      : i < bosses + rangers ? 'ranged'
        : i < bosses + rangers + jumpers ? 'jumper'
          : i < bosses + rangers + jumpers + runners ? 'runner' : 'walker');
  }
  waveSpawnCd = 0.3;
}
const waveQueue = [];                    // 이번 웨이브에서 아직 등장하지 않은 적
let waveSpawnCd = 0;
const plazaLive = () => Math.min(18, 10 + wave);   // 광장 동시 등장 상한
function waveSpawnTick(dt) {
  if (walkGrid || player.dead || !waveQueue.length) return;
  waveSpawnCd -= dt;
  if (waveSpawnCd > 0) return;
  waveSpawnCd = 0.7;
  if (aliveCount() >= plazaLive()) return;          // 자리가 나면 그때 투입
  spawnEnemy(wave, waveQueue.shift());
}
// 웨이브 스폰 예약 타이머 (스킵/재시작 시 취소해야 이월 스폰이 안 쌓인다)
const spawnTimers = [];
function clearSpawnTimers() { for (const t of spawnTimers) clearTimeout(t); spawnTimers.length = 0; waveQueue.length = 0; }
// 디버그: 웨이브 스킵 (예약 스폰 취소 + 남은 적 즉시 제거 후 다음 웨이브)
function skipWave() {
  clearSpawnTimers();
  for (const en of enemies) retireEnemy(en);
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
let camMode = localStorage.getItem('fps.view') || 'shoulder';  // 기본: 3인칭 숄더뷰
if (camMode === 'tps') camMode = 'shoulder';                    // 구버전 저장값 호환
let ctrlMode = localStorage.getItem('fps.ctrl') || 'pc';       // 'pc' | 'mobile'
let fireMode = { btn: 'only', jog: 'look' }[localStorage.getItem('fps.fire')] || localStorage.getItem('fps.fire') || 'look';   // 사격 조그: 'only' 사격만 | 'look' 사격 + 시야 변경 (기본)
const isMobileCtrl = () => ctrlMode === 'mobile';
let started = false;                                            // 모바일 모드 게임 시작 여부
const optMenu = document.getElementById('optMenu');
document.getElementById('optBtn').addEventListener('click', e => {
  e.stopPropagation();
  optMenu.style.display = optMenu.style.display === 'block' ? 'none' : 'block';
  if (optMenu.style.display === 'block') syncOptUI();
  if (document.pointerLockElement) document.exitPointerLock();
  if (optMenu.style.display === 'block' && inRun && !paused && !player.dead) {   // 옵션을 열면 게임 일시정지 (모바일 포함)
    paused = true; shopClosed = true;    // 옵션 위에 상점이 겹치지 않게 — '상점' 버튼으로 다시 연다
    refreshOverlay();
  } else if (optMenu.style.display === 'block') shopMenu.style.display = 'none';
});
// 수류탄 슬롯 클릭/탭으로도 토글
document.getElementById('gSlot').addEventListener('pointerdown', e => { e.stopPropagation(); selectSlot(slot === 'grenade' ? (weapon === 'pistol' ? 'pistol' : 'rifle') : 'grenade'); });
document.getElementById('pSlot').addEventListener('pointerdown', e => { e.stopPropagation(); selectSlot('pistol'); });
document.getElementById('rSlot').addEventListener('pointerdown', e => { e.stopPropagation(); selectSlot('rifle'); });
document.getElementById('mSlot').addEventListener('pointerdown', e => { e.stopPropagation(); selectSlot(slot === 'mine' ? 'gun' : 'mine'); });
document.getElementById('kSlot').addEventListener('pointerdown', e => { e.stopPropagation(); audioInit(); placeMarker(); });

// 디버그 버튼 — 로컬(localhost/127.*)에서만 노출
const IS_LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname) || location.hostname.endsWith('.local');
if (!IS_LOCAL) document.getElementById('dbgWrap').style.display = 'none';   // 디버그 버튼만 로컬 전용 · 쇼룸은 어디서나
document.getElementById('dbgCoins').addEventListener('click', e => {
  e.stopPropagation();
  coins += 100000000;
  setCoinHud();
  flashChip('coinN');
  renderUpg();
  persistProgress();
});
document.getElementById('dbgHead').addEventListener('click', e => {
  e.stopPropagation();
  addHeads(500);
  toast('🔷 헤드 +500 (보유 ' + fmt(heads) + ')');
});
document.getElementById('dbgWave').addEventListener('click', e => {
  e.stopPropagation();
  if (walkGrid) { warping = true; floorTransition(); setTimeout(() => warping = false, 900); }  // 랜덤맵: 다음 층
  else skipWave();
});
let dbgPortal = false, dbgGod = false, dbgFast = false, dbgAmmo = false;
let decoMode = localStorage.getItem('fps.deco') === '1';   // 방꾸미기: 방·가구 비용과 파밍 제한 없음
let outlineOn = localStorage.getItem('fps.outline') === '1';   // 오브젝트 검은 외곽선
const dbgTog = (id, get, set) => document.getElementById(id).addEventListener('click', e => {
  e.stopPropagation();
  set(!get());
  document.getElementById(id).classList.toggle('on', get());
});
dbgTog('dbgPortal', () => dbgPortal, v => { dbgPortal = v; toast(v ? '포탈 표시 ON' : '포탈 표시 OFF'); });
dbgTog('dbgGod', () => dbgGod, v => { dbgGod = v; toast(v ? '무적 ON' : '무적 OFF'); });
dbgTog('dbgFast', () => dbgFast, v => { dbgFast = v; toast(v ? '이동 3배속 ON' : '이동 3배속 OFF'); });
dbgTog('dbgPieces', () => dbgPieces, v => { dbgPieces = v; syncDbgPieces(); toast(v ? '조각 표시 ON — 벽 하늘색 · 바닥 노랑 · 용암 주황' : '조각 표시 OFF'); });
// ---- 전체 초기화 (옵션) ----
const RESET_KEYS = ['fps.save', 'fps.head', 'fps.gear', 'fps.deep'];   // 코인·업그레이드(소모품 포함)·헤드코인·획득 장비·던전 최고 기록
document.getElementById('optReset')?.addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('optResetAsk')?.classList.add('on');
});
document.getElementById('optResetNo')?.addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('optResetAsk')?.classList.remove('on');
});
document.getElementById('optResetOk')?.addEventListener('click', e => {
  e.stopPropagation();
  for (const k of RESET_KEYS) localStorage.removeItem(k);
  location.reload();
});
const fullBtn = document.getElementById('optFull');
const syncFullBtn = () => fullBtn?.classList.toggle('on', !!document.fullscreenElement);
fullBtn?.addEventListener('click', async e => {
  e.stopPropagation();
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { toast('전체화면을 쓸 수 없습니다'); }
  syncFullBtn();
});
document.addEventListener('fullscreenchange', syncFullBtn);   // F11 등 다른 경로로 바뀌어도 표시 유지
const SHADOW_LABEL = { high: '그림자: 높음', mid: '그림자: 보통', off: '그림자: 끔' };
function applyShadowQ(say) {
  shadowOn = shadowQ !== 'off';
  renderer.shadowMap.enabled = shadowOn;
  renderer.shadowMap.type = shadowQ === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const n = shadowQ === 'high' ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== n) {
    sun.shadow.mapSize.set(n, n);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }   // 해상도 변경은 맵을 다시 만들어야 반영된다
  }
  scene.traverse(o => {                  // 그림자 설정이 셰이더에 반영되도록 재컴파일
    if (!o.material) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) m.needsUpdate = true;
  });
  sun.shadow.autoUpdate = shadowQ === 'high';
  sun.shadow.needsUpdate = true;
  syncPlayerShadow();
  localStorage.setItem('fps.shadowq', shadowQ);
  syncOptUI();
  if (say) toast(SHADOW_LABEL[shadowQ] + (shadowQ === 'high' ? ' (매 프레임 · 무거움)' : shadowQ === 'mid' ? ' (지형만 · 적은 그림자 원)' : ' (가장 가벼움)'));
}
document.getElementById('optShadow')?.addEventListener('click', e => {
  e.stopPropagation();
  shadowQ = shadowQ === 'high' ? 'mid' : shadowQ === 'mid' ? 'off' : 'high';
  applyShadowQ(true);
});
dbgTog('optOutline', () => outlineOn, v => {
  outlineOn = v;
  localStorage.setItem('fps.outline', v ? '1' : '0');
  if (typeof buildFurnitureAll === 'function' && srOn) buildFurnitureAll();
  toast(v ? '검은 외곽선 ON' : '검은 외곽선 OFF');
});
let showFps = false, fpsAcc = 0, fpsN = 0;
dbgTog('dbgFps', () => showFps, v => {
  showFps = v;
  document.getElementById('fpsHud').style.display = v ? 'block' : 'none';
  toast(v ? 'FPS 표시 ON' : 'FPS 표시 OFF');
});
dbgTog('dbgDeco', () => decoMode, v => {
  decoMode = v;
  localStorage.setItem('fps.deco', v ? '1' : '0');
  if (srOn) roomRenderUI();
  toast(v ? '🛋 방꾸미기 모드 ON — 방·가구 비용과 파밍 제한 없음' : '🛋 방꾸미기 모드 OFF');
});
document.getElementById('dbgDeco').classList.toggle('on', decoMode);
dbgTog('dbgAmmo', () => dbgAmmo, v => {
  dbgAmmo = v;
  document.getElementById('ammo').classList.toggle('inf', v || buffT > 0);
  if (v) { reloading = false; ammo = magSize(); }
  updateAmmo();
  toast(v ? '무한 탄창 ON' : '무한 탄창 OFF');
});

const shopMenu = document.getElementById('shopMenu');

document.getElementById('shopClose').addEventListener('click', e => {
  e.stopPropagation();
  shopMenu.style.display = 'none';
  if (inRun) { shopClosed = true; refreshOverlay(); }
});
document.getElementById('btnShop')?.addEventListener('click', e => { e.stopPropagation(); shopClosed = false; refreshOverlay(); });
// 시작 화면 패널: 화면 중앙에서 100px 아래 배치 (넘치면 스크롤)
function placeStartPanel(el) {
  el.style.left = '50%';
  el.style.top = 'calc(50% - 75px)';     // 상단 고정 — 내용이 늘면 아래로만 커진다
  el.style.bottom = 'auto';
  el.style.transform = 'translateX(-50%)';
  el.style.maxHeight = '60vh';
  el.style.overflowY = 'auto';
}
document.getElementById('startShop').addEventListener('click', e => {
  e.stopPropagation(); // 시작 오버레이의 포인터록 진입 차단
  shopMenu.style.display = shopMenu.style.display === 'block' ? 'none' : 'block';
  if (shopMenu.style.display === 'block') { renderUpg(); placeStartPanel(shopMenu); rankMenu.style.display = 'none'; }
});
const rankMenu = document.getElementById('rankMenu');
document.getElementById('startRank').addEventListener('click', e => {
  e.stopPropagation();
  rankMenu.style.display = rankMenu.style.display === 'block' ? 'none' : 'block';
  if (rankMenu.style.display === 'block') { viewRanking(); placeStartPanel(rankMenu); shopMenu.style.display = 'none'; }
});
optMenu.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  camMode = b.dataset.view; localStorage.setItem('fps.view', camMode); syncOptUI(); applyView();
}));
optMenu.querySelectorAll('[data-ctrl]').forEach(b => b.addEventListener('click', () => {
  ctrlMode = b.dataset.ctrl; localStorage.setItem('fps.ctrl', ctrlMode); syncOptUI(); applyCtrl();
}));
optMenu.querySelectorAll('[data-fire]').forEach(b => b.addEventListener('click', () => {
  fireMode = b.dataset.fire; localStorage.setItem('fps.fire', fireMode); syncOptUI(); applyCtrl();
}));
optMenu.querySelectorAll('[data-map]').forEach(b => b.addEventListener('click', () => {
  if (mapMode === b.dataset.map) return;
  mapMode = b.dataset.map; localStorage.setItem('fps.map', mapMode); syncOptUI(); applyMap();
}));
// 맵 교체: 지형을 다시 만들고 진행 중인 개체·아이템을 정리한 뒤 1웨이브부터
function applyMap(startAt = 1) {
  floorNo = mapMode === 'random' ? Math.max(1, startAt) : 1;   // 지형·난이도가 층을 보고 정해지니 먼저 맞춘다
  buildMap();
  clearSpawnTimers();
  for (const en of enemies) retireEnemy(en);
  enemies.length = 0;
  for (const d of drops) scene.remove(d.root); drops.length = 0;
  for (const c of coinFx) scene.remove(c.root); coinFx.length = 0;
  for (const pr of projectiles) scene.remove(pr.m); projectiles.length = 0;
  for (const gr of liveGrenades) { scene.remove(gr.root); if (gr.circle) scene.remove(gr.circle); }
  liveGrenades.length = 0;
  for (const m of liveMines) scene.remove(m.grp);
  liveMines.length = 0;
  clearBeacon();
  clearMarkers();
  clearJumpPads();
  clearDoors();
  clearWoodCrates();
  player.pos.copy(playerStart); player.vy = 0; player.onGround = true;
  rebuildFlow();
  floorTime = FLOOR_TIME; hunter = null;
  spawnCd = 3; lastKillClock = 0; bossOfFloor = null; warping = false; floorShopOpen = false;
  wave = 0;
  updateHudWave();
  if (walkGrid) startFloor(); else nextWave();
  syncOptUI();
}
function syncOptUI() {
  const ob = document.getElementById('optOutline');
  if (ob) ob.classList.toggle('on', outlineOn);
  const sb = document.getElementById('optShadow');
  if (sb) { sb.textContent = SHADOW_LABEL[shadowQ]; sb.classList.toggle('on', shadowQ === 'high'); }
  const fb = document.getElementById('optFs');
  if (fb) { fb.textContent = '전체화면 + 키 잠금: ' + (fsLock ? '켬' : '끔'); fb.classList.toggle('on', fsLock); }
  const dw = document.getElementById('dbgWave');
  if (dw) dw.textContent = '단계 넘기기';
  optMenu.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === camMode));
  optMenu.querySelectorAll('[data-ctrl]').forEach(b => b.classList.toggle('on', b.dataset.ctrl === ctrlMode));
  optMenu.querySelectorAll('[data-map]').forEach(b => b.classList.toggle('on', b.dataset.map === mapMode));
  optMenu.querySelectorAll('[data-fire]').forEach(b => b.classList.toggle('on', b.dataset.fire === fireMode));
}
function applyView() {
  // 1인칭이 아니면 숨겼던 머리·머리카락 본 복원 (1인칭은 프레임마다 hideBones 재적용)
  if (camMode !== 'fps') for (const b of hiddenBones) b.scale.setScalar(1);
}
function applyCtrl() {
  document.body.classList.toggle('mobile', isMobileCtrl());
  document.body.classList.toggle('fireJog', fireMode === 'look');
  if (isMobileCtrl() && document.pointerLockElement) document.exitPointerLock();
  refreshOverlay();
}
// 일시정지는 포인터록과 분리 — ESC는 브라우저 제스처로 인정되지 않아 잠금을 되걸 수 없으므로,
// 재개는 게임 로직 기준(paused)으로 하고 조준 잠금은 다음 클릭에서 복구한다.
let inRun = false;  // 게임 시작 후: ESC 일시정지는 타이틀이 아닌 PAUSED 오버레이
let paused = false;   // ESC 일시정지 상태
// 잠금 해제로 일시정지된 "그 ESC 누름"이 페이지에 keydown으로 전달되는 브라우저에서
// 즉시 재개돼 버리는 이중 토글만 차단한다. 시간 지연 대신 (a) 그 키의 release 또는
// (b) 다음 프레임 중 먼저 오는 쪽에서 곧바로 재무장 — 체감 딜레이 없음.
let escArmed = true;
function armEscSoon() {
  escArmed = false;
  requestAnimationFrame(() => requestAnimationFrame(() => { escArmed = true; }));
}
const isPlaying = () => inRun && !paused && (!isMobileCtrl() || started);
function refreshOverlay() {
  const menu = !isPlaying() && !player.dead;
  const onStart = menu && !inRun;
  startEl.style.display = onStart ? 'block' : 'none';
  const ob = document.getElementById('optBtn');   // 메인 화면에는 메뉴의 '옵션'만 (우상단 버튼 숨김)
  if (ob) ob.style.display = onStart ? 'none' : '';
  const mu = document.getElementById('mobileUI');   // 조그·액션 버튼은 게임 중에만
  if (mu) mu.style.display = isMobileCtrl() && isPlaying() && !player.dead ? 'block' : 'none';
  const p = document.getElementById('pauseOv');
  const pauseUI = menu && inRun;
  if (p) p.style.display = pauseUI ? 'block' : 'none';
  const rb = document.getElementById('btnResume')?.querySelector('span');   // 층 시작 상점이면 '단계 시작'
  if (rb) rb.innerHTML = floorShopOpen && walkGrid ? '▶&nbsp; ' + floorNo + '단계 시작' : '▶&nbsp; 되돌아가기';
  // 일시정지 화면: 되돌아가기 버튼 100px 아래에 상점 패널 상시 표시
  const sm = document.getElementById('shopMenu');
  const allowShop = !walkGrid || floorShopOpen;   // 랜덤맵은 층 이동 시에만 상점
  if (!pauseUI) shopClosed = false;      // 다음 일시정지에는 다시 열린 채로
  const bs = document.getElementById('btnShop');
  if (bs) bs.style.display = pauseUI && allowShop && shopClosed ? '' : 'none';   // 닫았을 때만 '상점' 버튼
  if (pauseUI && sm && allowShop && !shopClosed) {
    renderUpg();
    sm.style.display = 'block';
    sm.style.left = '50%';
    sm.style.top = '50%';                  // 화면 세로 중앙 — 높이를 고정해 탭을 바꿔도 위치가 흔들리지 않는다
    sm.style.bottom = 'auto';
    sm.style.transform = 'translate(-50%,-50%)';
    const hgt = Math.max(240, Math.round(innerHeight * 0.84));
    sm.style.height = hgt + 'px';
    sm.style.maxHeight = hgt + 'px';
    sm.style.overflowY = 'auto';
  } else if (inRun && sm) {
    sm.style.display = 'none'; // 일시정지 해제·랜덤맵 일반 정지·닫기에서는 감춘다
  }
}
syncOptUI();

// ---------- input ----------
const keys = {};
let locked = false, firing = false, lastShot = 0;
const startEl = document.getElementById('start');
const msgEl = document.getElementById('msg');
function enterGame() {
  floorShopOpen = false;
  audioInit();
  shopMenu.style.display = 'none'; // 게임 진입 시 열린 패널 닫기
  rankMenu.style.display = 'none';
  optMenu.style.display = 'none';
  inRun = true;
  paused = false;
  if (isMobileCtrl()) { started = true; mobileFullscreen(); }
  else lockPointer();                    // 잠금 실패해도 게임은 시작 — 클릭 시 재시도
  refreshOverlay();
}
const mapPick = document.getElementById('mapPick');
document.getElementById('btnStart').addEventListener('click', e => {
  e.stopPropagation();
  shopMenu.style.display = 'none'; rankMenu.style.display = 'none'; optMenu.style.display = 'none';
  brief.style.display = 'none';
  mapPick.style.display = 'flex';     // 시작 전 맵 선택
});
const brief = document.getElementById('brief');
const BRIEF = {                        // 모드별 규칙 안내
  plaza: {
    title: '🏛 광장',
    lines: ['웨이브 중 <b>언제든 업그레이드</b> 가능', '<b>10웨이브</b>마다 보스 등장'],
  },
  random: {
    title: '👹 악의 소굴',
    lines: ['제한시간 <b>1분</b>', '적 처치 시 <b>+2초</b>', '제한시간 소진 시 <b>추적자</b> 등장',
      '<b>5층</b>마다 보스 등장'],
  },
};
let pickedMap = 'plaza';
mapPick.querySelectorAll('[data-startmap]').forEach(b => b.addEventListener('click', e => {
  e.stopPropagation();
  pickedMap = b.dataset.startmap;
  const info = BRIEF[pickedMap];
  document.getElementById('briefTitle').innerHTML = info.title;
  document.getElementById('briefList').innerHTML = info.lines.map(t => '<li>' + t + '</li>').join('');
  mapPick.style.display = 'none';
  brief.style.display = 'flex';        // 시작 전 규칙 안내
}));
// ---- 던전 이동: 내려가 본 층으로 바로 시작 ----
const tpMenu = document.getElementById('tpMenu');
function renderTp() {
  const list = document.getElementById('tpList');
  if (!list) return;
  document.getElementById('tpDeep').textContent = deepFloor;
  list.innerHTML = '';
  if (deepFloor < 2) {                   // 아직 내려가 본 곳이 없다
    const none = document.createElement('div');
    none.className = 'tpNone';
    none.textContent = '아직 내려가 본 층이 없습니다 — 랜덤 맵에서 포탈을 타고 내려가 보세요';
    list.appendChild(none);
    return;
  }
  for (let f = 2; f <= deepFloor; f++) {  // 낮은 층이 위 · 가장 깊은 층이 맨 아래
    const row = document.createElement('div');
    row.className = 'tpRow';
    const name = document.createElement('b');
    name.textContent = f + '층';
    row.appendChild(name);
    const cb = document.createElement('button');
    cb.innerHTML = fmt(tpCoin(f)) + '🪙';
    cb.disabled = coins < tpCoin(f);
    cb.addEventListener('click', () => { if (coins < tpCoin(f)) return; coins -= tpCoin(f); setCoinHud(); persistProgress(); teleportTo(f); });
    const hb = document.createElement('button');
    hb.className = 'head';
    hb.innerHTML = HEAD_IC + ' ' + fmt(tpHead(f));
    hb.disabled = heads < tpHead(f);
    hb.addEventListener('click', () => { if (!spendHeads(tpHead(f), f + '층 이동')) return; teleportTo(f); });
    row.appendChild(cb); row.appendChild(hb);
    list.appendChild(row);
  }
  const n = deepFloor - 1, SHOW = 7;      // 한 번에 7줄까지만
  const first = list.firstElementChild;
  const rowH = first?.offsetHeight || 50;
  list.style.maxHeight = n > SHOW ? (rowH * SHOW + 7 * (SHOW - 1) + 4) + 'px' : '';
  list.scrollTop = list.scrollHeight;    // 가장 깊은 층이 보이도록 아래로
}
function teleportTo(f) {
  tpMenu?.classList.remove('on');
  showCurTop(false);
  mapPick.style.display = 'none';
  brief.style.display = 'none';
  mapMode = 'random';
  localStorage.setItem('fps.map', mapMode);
  applyMap(f);                           // 그 층부터 시작
  enterGame();
  banner('🌀 ' + f + '층으로 이동');
}
document.getElementById('tpOpen')?.addEventListener('click', e => {
  e.stopPropagation();
  tpMenu?.classList.add('on');   // 먼저 띄워야 줄 높이를 잴 수 있다
  showCurTop(true);
  renderTp();
});
document.getElementById('tpClose')?.addEventListener('click', e => {
  e.stopPropagation();
  tpMenu?.classList.remove('on');
  showCurTop(false);
});
document.getElementById('mapBack')?.addEventListener('click', e => {   // 맵 선택 → 메인 화면
  e.stopPropagation();
  mapPick.style.display = 'none';
  refreshOverlay();
});
document.getElementById('briefBack').addEventListener('click', e => {
  e.stopPropagation();
  brief.style.display = 'none';
  mapPick.style.display = 'flex';
});
document.getElementById('briefGo').addEventListener('click', e => {
  e.stopPropagation();
  mapMode = pickedMap;
  localStorage.setItem('fps.map', mapMode);
  brief.style.display = 'none';
  applyMap();                          // 지형 재생성(랜덤은 매번 새 맵) + 1웨이브부터
  enterGame();
});
document.getElementById('btnResume').addEventListener('click', e => { e.stopPropagation(); enterGame(); });
document.getElementById('btnQuit').addEventListener('click', e => { e.stopPropagation(); shopMenu.style.display = 'none'; paused = false; restart(true); });
document.getElementById('optClose').addEventListener('click', e => { e.stopPropagation(); optMenu.style.display = 'none'; });
optMenu.addEventListener('click', e => { if (e.target === optMenu) optMenu.style.display = 'none'; });  // 바깥 클릭으로 닫기
document.getElementById('btnOptions').addEventListener('click', e => {
  e.stopPropagation();
  optMenu.style.display = optMenu.style.display === 'block' ? 'none' : 'block';
  if (optMenu.style.display === 'block') syncOptUI();
  if (optMenu.style.display === 'block') { shopMenu.style.display = 'none'; rankMenu.style.display = 'none'; }
});
canvas.addEventListener('click', () => { if (!locked && !isMobileCtrl() && !player.dead) lockPointer(); }); // 사망 화면에선 커서 유지
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) { paused = false; shopMenu.style.display = 'none'; } // 잠금 성공 = 플레이 중
  else if (inRun && !player.dead) { paused = true; armEscSoon(); } // ESC로 잠금 해제 → 일시정지
  refreshOverlay();
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
function joyStart(e) {
  joyId = e.pointerId;
  try { joy.setPointerCapture(joyId); } catch { }
  const r = joy.getBoundingClientRect();
  joyCenter = [r.x + r.width / 2, r.y + r.height / 2];
  joyUpdate(e);
}
joy.addEventListener('pointerdown', e => joyStart(e));
joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyUpdate(e); });
const joyEnd = e => {
  if (e.pointerId !== joyId) return;
  joyId = null;
  touchMove.x = touchMove.z = 0;
  joyStick.style.transform = '';
};
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
mb('mbFire').addEventListener('pointerdown', e => {
  e.preventDefault(); audioInit();
  if (slot === 'mine') { placeMine(); return; }
  if (gMode) { startGrenadeWindup(); return; }
  firing = true;
});
let fireJogId = null, fireJogLast = null;
mb('mbFire').addEventListener('pointerdown', e => {   // 사격 조그: 누른 채 끌면 시야도 돈다 ('사격만'이면 회전 없음)
  if (fireMode !== 'look') return;
  fireJogId = e.pointerId; fireJogLast = [e.clientX, e.clientY];
  try { mb('mbFire').setPointerCapture(fireJogId); } catch { }
});
mb('mbFire').addEventListener('pointermove', e => {
  if (e.pointerId !== fireJogId || !fireJogLast) return;
  const s = 0.005 * (player.zooming ? 0.45 : 1);
  player.yaw -= (e.clientX - fireJogLast[0]) * s;
  player.pitch -= (e.clientY - fireJogLast[1]) * s;
  player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch));
  fireJogLast = [e.clientX, e.clientY];
});
const fireEnd = () => { if (gMode) releaseGrenadeWindup(); firing = false; fireJogId = null; fireJogLast = null; };
mb('mbFire').addEventListener('pointerup', fireEnd);
mb('mbFire').addEventListener('pointercancel', fireEnd);
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

const LOCK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyC', 'KeyF', 'KeyG', 'KeyT', 'KeyN', 'KeyP', 'KeyH', 'KeyJ', 'KeyL', 'KeyU', 'KeyO', 'KeyE', 'KeyQ', 'KeyB', 'KeyM', 'KeyI', 'KeyK',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Tab', 'Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'F1', 'F3', 'F5', 'F11', 'F12'];
function keyboardLock() { try { navigator.keyboard?.lock?.(LOCK_KEYS); } catch { } }
function mobileFullscreen() {            // 모바일 시작: 전체화면 + 가로 고정 (브라우저가 허용하는 범위에서)
  if (!fsLock) return;
  const lockLand = () => { try { screen.orientation?.lock?.('landscape').catch?.(() => { }); } catch { } };
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(lockLand).catch(lockLand);
  else lockLand();
}
function lockPointer() {                 // 조준 잠금 — 옵션이 켜져 있으면 전체화면으로 들어가며 키까지 잠근다
  if (fsLock && !document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => { keyboardLock(); const pr = canvas.requestPointerLock(); if (pr && pr.catch) pr.catch(() => { }); })
      .catch(() => { const pr = canvas.requestPointerLock(); if (pr && pr.catch) pr.catch(() => { }); });
    return;
  }
  if (document.fullscreenElement) keyboardLock();
  const pr = canvas.requestPointerLock();
  if (pr && pr.catch) pr.catch(() => { });
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { try { navigator.keyboard?.unlock?.(); } catch { } } });
document.getElementById('optFs')?.addEventListener('click', e => {
  e.stopPropagation();
  fsLock = !fsLock;
  localStorage.setItem('fps.fs', fsLock ? 'on' : 'off');
  if (!fsLock && document.fullscreenElement) document.exitFullscreen?.().catch?.(() => { });
  syncOptUI();
  toast(fsLock ? '⛶ 전체화면 + 키 잠금 켬 — Ctrl 조합이 브라우저에 안 먹습니다' : '⛶ 전체화면 끔 — Ctrl+W 등 브라우저 단축키에 주의');
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.altKey) && /^(Key|Digit|Tab$|F\d)/.test(e.code)) e.preventDefault();   // 전체화면 키 잠금 중엔 브라우저 단축키를 막는다
  keys[e.code] = true;
  if (e.code === 'KeyR' && !reloading && ammo < magSize()) reload();
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) dash();
  if (!e.repeat) {                       // 1 총 · 2 수류탄 · 3 지뢰
    if (e.code === 'Digit1' || e.code === 'Numpad1') selectSlot('rifle');
    if (e.code === 'Digit2' || e.code === 'Numpad2') selectSlot('pistol');
    if (e.code === 'Digit3' || e.code === 'Numpad3') selectSlot('grenade');
    if (e.code === 'Digit4' || e.code === 'Numpad4') selectSlot('mine');
    if (e.code === 'KeyF') placeMarker();          // 조준점에 길찾기 마커
  }
  // ESC 토글: 일시정지 ↔ 재개 (잠금 중 ESC는 브라우저가 소비 → pointerlockchange 경로로 일시정지됨)
  if (e.code === 'Escape' && !e.repeat && inRun && !player.dead) {
    if (paused) {
      if (!escArmed) return;       // 잠금 해제를 유발한 그 누름의 잔여 keydown만 무시
      paused = false;              // 즉시 게임 재개 — 조준 잠금은 시도만, 실패 시 클릭으로 복구
      if (isMobileCtrl()) { started = true; mobileFullscreen(); }
      else lockPointer();
      shopMenu.style.display = 'none';
      refreshOverlay();
    } else if (!locked) {          // 잠금 없이 플레이 중 ESC → 일시정지
      paused = true;
      refreshOverlay();
    }
  }
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') e.preventDefault();
  if (e.code === 'KeyC') e.preventDefault();   // C도 앉기 (Ctrl+W 등 브라우저 단축키 충돌을 피하는 대안)
});
document.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Escape') escArmed = true; // 키를 떼는 즉시 재무장 (지연 0)
});
document.addEventListener('mousedown', e => {
  if (!locked) return; // 사망 후 재시작은 [확인] 버튼으로만
  if (e.button === 0) {
    if (slot === 'mine') { placeMine(); return; }        // 지뢰: 즉시 설치
    if (gMode) { startGrenadeWindup(); return; }         // 수류탄: 다운=와인드업
    firing = true;
  }
  if (e.button === 1) { e.preventDefault(); fireChain(); }   // 휠 클릭: 사슬
  if (e.button === 2) {
    if (canBlock()) { blocking = true; blockAt = performance.now(); shieldPose(true); sfxTone(260, 0.08, 'square', 0.16); }
    else { player.zooming = true; sfxZoom(); }
  }
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) {
    if (locked && gMode) releaseGrenadeWindup(); // 업: 나머지 모션 + 0.5초 뒤 투척
    firing = false;
  }
  if (e.button === 2) { player.zooming = false; blocking = false; shieldPose(false); }
});
document.addEventListener('contextmenu', e => e.preventDefault());

const sfxDash = () => sfxTone(500, 0.18, 'sawtooth', 0.12, 700);
function dash() {
  if (player.dead || player.dashCd > 0 || player.crouch) return;   // 앉은 자세에서는 대쉬 불가
  player.dashDir = { ...player.lastDir };
  player.dashT = 0.18; player.dashSpd = 40; player.dashCd = dashCool();
  sfxDash();
}

// ---------- 사슬 — 휠 클릭: 적은 당겨오고, 벽이면 그쪽으로 날아간다 ----------
const CHAIN_RANGE = 15;                  // 사거리 15m
const CHAIN_CD = 0.5;                    // 연속 사용 사이 간격 0.5초
const CHAIN_USES = 3;                    // 충전 3회
const CHAIN_RECHARGE = 10;               // 다 쓰면 10초 뒤 완충
let chainUses = CHAIN_USES, chainRe = 0; // 남은 횟수 · 재충전 남은 시간
const CHAIN_STOP = 1.6;                  // 캐릭터 앞 이만큼 남기고 멈춘다
const CHAIN_DAMP = 12;                   // 넉백 감쇠 계수 (updateEnemy 와 동일)
const RIBBON_STAGE = 11;                 // 이 단계에서 리본을 얻는다
const gearSave = { pistol: false, ribbon: false };   // 한 번 얻으면 계속 쓰는 장비
try { Object.assign(gearSave, JSON.parse(localStorage.getItem('fps.gear') || '{}')); } catch { }
function saveGear() { try { localStorage.setItem('fps.gear', JSON.stringify(gearSave)); } catch { } }
let ribbonOwned = gearSave.ribbon;       // 리본 보유
let pistolOwned = gearSave.pistol;       // 권총+방패 보유 (5단계 보스 뒤)
const PISTOL_STAGE = 6;                  // 5판 보스를 잡고 포탈을 넘으면 6단계
const GEAR_INFO = {
  pistol: { key: '2', icon: '🔫🛡️', name: '권총 + 방패',
    desc: '2번 슬롯 · 한 발이 소총보다 무겁고, 마우스 오른쪽 버튼으로 클릭 시 방패로 막거나 패링할 수 있습니다.' },
  ribbon: { key: '휠', icon: '🎀', name: '리본',
    desc: '휠 클릭 · 적을 끌어오거나 지형으로 날아갑니다. 3번 쓰면 10초 뒤 다시 충전됩니다.' },
};
let gearQueue = [], gearResume = false;
function showGearGot(kind) {             // 획득 사실을 크게 알리고 확인을 받는다
  gearQueue.push(kind);
  const el = document.getElementById('gearGot');
  if (el && !el.classList.contains('on')) nextGearGot();
}
function nextGearGot() {
  const el = document.getElementById('gearGot');
  if (!el) return;
  const kind = gearQueue.shift();
  if (!kind) {                           // 다 확인했으면 닫고 원래 상태로
    el.classList.remove('on');
    if (gearResume && !floorShopOpen) paused = false;
    gearResume = false;
    refreshOverlay();
    return;
  }
  const g = GEAR_INFO[kind];
  document.getElementById('gearKey').textContent = g.key;
  document.getElementById('gearIcon').textContent = g.icon;
  document.getElementById('gearName').textContent = g.name + ' 획득!';
  document.getElementById('gearDesc').textContent = g.desc;
  if (!el.classList.contains('on')) gearResume = !paused;   // 원래 진행 중이었나
  el.classList.add('on');
  paused = true;
  if (document.pointerLockElement) document.exitPointerLock();
  refreshOverlay();
}
document.getElementById('gearOk')?.addEventListener('click', e => { e.stopPropagation(); nextGearGot(); });
function updatePistolSlot() {
  document.getElementById('pSlot')?.classList.toggle('empty', !pistolOwned);
}
updatePistolSlot();
let chainCd = 0, chainFx = null;         // 남은 쿨타임 · 화면에 그려둔 사슬
function setSlotCd(el, remain, total, showSec = true) {   // 슬롯 위 쿨타임 음영
  if (!el) return;
  let ov = el.querySelector('.cdOv');
  if (!ov) { ov = document.createElement('span'); ov.className = 'cdOv'; ov.innerHTML = '<i></i>'; el.appendChild(ov); }
  if (remain <= 0 || total <= 0) { ov.classList.remove('on'); return; }
  ov.classList.add('on');
  ov.style.setProperty('--p', Math.min(1, remain / total).toFixed(3));   // 남은 만큼만 덮는다
  ov.firstChild.textContent = showSec ? Math.ceil(remain) : '';
}
let ribbonHud = '';                      // 마지막으로 그린 상태 — 같으면 DOM을 건드리지 않는다
function updateRibbonSlot() {
  const el = document.getElementById('wSlot');
  if (!el) return;
  const sig = (ribbonOwned ? 1 : 0) + '/' + chainUses + '/' + Math.ceil(chainRe * 10) + '/' + Math.ceil(chainCd * 20);
  if (sig === ribbonHud) return;
  ribbonHud = sig;
  el.classList.toggle('empty', !ribbonOwned);
  const cnt = document.getElementById('wCnt');
  if (cnt) cnt.textContent = !ribbonOwned || chainUses <= 0 ? '' : chainUses;
  if (!ribbonOwned) setSlotCd(el, 0, 0);
  else if (chainUses < chainMax()) setSlotCd(el, chainRe, chainRecharge());   // 다음 한 발까지 남은 초
  else setSlotCd(el, chainCd, CHAIN_CD, false);                               // 연사 간격: 짧은 음영만
}
updateRibbonSlot();
function grantPistol() {                 // 5판 보스 처치 후 포탈에서 획득
  if (pistolOwned) return;
  pistolOwned = true; gearSave.pistol = true; saveGear();
  updatePistolSlot();
  banner('🔫🛡️ 권총 + 방패 획득');
  showGearGot('pistol');
  sfxTone(660, 0.16, 'square', 0.24, 260); sfxTone(990, 0.2, 'sine', 0.2, 180);
}
function grantRibbon() {                 // 단계 도달 시 획득
  if (ribbonOwned) return;
  ribbonOwned = true; gearSave.ribbon = true; saveGear();
  updateRibbonSlot();
  banner('🎀 리본 획득 — 휠 클릭');
  showGearGot('ribbon');
  sfxTone(760, 0.16, 'square', 0.26, 320); sfxTone(1140, 0.2, 'sine', 0.2, 240);
}
const RIBBON_GEO = new THREE.CylinderGeometry(0.05, 0.05, 1, 8, 1, true);   // 길이는 스케일로
function chainLine(from, to) {           // 리본 연출 (굵은 분홍 띠 — 짧게 남았다 사라진다)
  if (chainFx) { scene.remove(chainFx.line); chainFx.line.material.dispose(); }
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const d = to.clone().sub(from);
  const len = d.length() || 0.01;
  const line = new THREE.Mesh(RIBBON_GEO, new THREE.MeshBasicMaterial({
    color: 0xff5fa8, transparent: true, opacity: 1, fog: false, toneMapped: false, side: THREE.DoubleSide,
  }));
  line.position.copy(mid);
  line.scale.set(1, len, 1);
  line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());   // +y 를 방향에 맞춘다
  scene.add(line);
  chainFx = { line, life: 0.3 };
}
function updateChain(dt) {
  chainCd = Math.max(0, chainCd - dt);
  const max = chainMax();
  if (chainUses < max) {                 // 최대치가 될 때까지 한 발씩 계속 충전
    if (chainRe <= 0) chainRe = chainRecharge();
    chainRe -= dt;
    if (chainRe <= 0) {
      chainUses++;
      chainRe = chainUses < max ? chainRecharge() : 0;   // 충전 알림음은 뺐다 (플레이 중 계속 '뛰옹' 하고 울려서)
      if (chainUses >= max) toast('🎀 리본 충전 완료');
    }
  } else chainRe = 0;
  updateRibbonSlot();
  if (!chainFx) return;
  chainFx.life -= dt;
  chainFx.line.material.opacity = Math.max(0, chainFx.life / 0.3);
  if (chainFx.life <= 0) { scene.remove(chainFx.line); chainFx.line.material.dispose(); chainFx = null; }
}
function fireChain() {
  if (player.dead || chainCd > 0) return;
  if (!ribbonOwned) { toast('🎀 리본은 악의 소굴 ' + RIBBON_STAGE + '단계에서 얻습니다'); return; }
  if (chainUses <= 0) { toast('🎀 리본 재충전 중 — ' + Math.ceil(chainRe) + '초'); return; }
  chainUses--;
  if (chainRe <= 0) chainRe = chainRecharge();   // 충전 타이머는 한 발이라도 비면 돌아간다
  updateRibbonSlot();
  chainCd = CHAIN_CD;
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const dir = raycaster.ray.direction.clone();
  const origin = raycaster.ray.origin.clone();
  // 사거리 안에서 가장 가까운 적
  let bestT = chainRange(), target = null;
  for (const en of enemies) {
    if (en.state === 'dead' || en.gone) continue;
    const c = en.root.position.clone().add(new THREE.Vector3(0, 1.15 * en.scale, 0)).sub(origin);
    const t = c.dot(dir);
    if (t < 0 || t > bestT) continue;
    if (c.lengthSq() - t * t < (0.85 * en.scale) ** 2) { bestT = t; target = en; }
  }
  // 벽·장애물까지의 거리
  let wallT = chainRange(), hitObs = null, hitWall = false;
  for (const o of obstacles) {
    const t = rayAABB(origin, dir, new THREE.Vector3(o.x - o.w / 2, o.yOff, o.z - o.d / 2),
      new THREE.Vector3(o.x + o.w / 2, o.yOff + o.h, o.z + o.d / 2));
    if (t !== null && t < wallT) { wallT = t; hitObs = o.noStand ? null : o; hitWall = !!o.noStand; }   // 기둥은 벽처럼 다룬다
    if (!o.stem) continue;               // 종유석 몸통(위쪽 원뿔)도 같은 발판으로 친다
    const ts = rayAABB(origin, dir, new THREE.Vector3(o.x - o.stem.w / 2, o.stem.y0, o.z - o.stem.d / 2),
      new THREE.Vector3(o.x + o.stem.w / 2, o.stem.y1, o.z + o.stem.d / 2));
    if (ts !== null && ts < wallT) { wallT = ts; hitObs = o; hitWall = false; }
  }
  if (walkGrid) {                        // 지형 벽 — 넘어갈 수는 없다
    const gt = gridRayT(origin, dir, wallT);
    if (gt !== null && gt <= wallT) { wallT = gt; hitObs = null; hitWall = true; }
  }
  const muzzle = muzzleTip(dir);
  const cr = crateOnRay(origin, dir, Math.min(wallT, chainRange()));   // 나무 상자도 끌어온다
  if (cr && (!target || cr.t < bestT)) {
    pullCrate(cr.crate);
    chainLine(muzzle, new THREE.Vector3(cr.crate.x, 0.6, cr.crate.z));
    popupWorld(new THREE.Vector3(cr.crate.x, 1.1, cr.crate.z), '📦', 'pen');
    return;
  }
  if (target && bestT <= wallT) {         // 적을 끌어온다
    const p = target.root.position;
    const toMe = new THREE.Vector3(player.pos.x - p.x, 0, player.pos.z - p.z);
    const d = toMe.length() || 1;
    toMe.divideScalar(d);
    const pull = Math.max(0, d - CHAIN_STOP);        // 앞 1.6m 까지만 끌어온다
    const v = Math.min(pull * CHAIN_DAMP, 150);      // 감쇠를 감안한 초기 속도 (총 이동 ≈ v/12)
    target.kbX = toMe.x * v; target.kbZ = toMe.z * v;
    target.hitFlash = 0.12;
    chainLine(muzzle, p.clone().add(new THREE.Vector3(0, 1.1 * target.scale, 0)));
    popupWorld(headPos(target), '⛓', 'pen');
    sfxTone(320, 0.12, 'square', 0.22, 180); sfxTone(140, 0.2, 'sawtooth', 0.2, 60);
    return;
  }
  if (wallT < chainRange()) {             // 벽을 찍으면 그 지점으로 날아간다 (높이까지)
    const hit = origin.clone().addScaledVector(dir, wallT);
    const top = hitObs ? hitObs.yOff + hitObs.h : hit.y;  // 구조물은 윗면 · 벽은 찍은 지점 높이
    const up = top - player.pos.y;                        // 찍은 곳이 위면 그 높이까지 뛰어오른다 (벽은 WALL_H를 넘지 않는다)
    const onTop = !!hitObs && up > 0.35;                  // 발판 위로 올라서는 경우
    const tx = onTop ? hitObs.x : hit.x, tz = onTop ? hitObs.z : hit.z;   // 발판이면 한가운데로 내려선다
    const to = new THREE.Vector3(tx - player.pos.x, 0, tz - player.pos.z);
    const d = to.length();
    const stop = onTop ? 0 : hitWall ? 1.0 : 0.6;         // 지형 벽은 조금 더 앞에서 멈춘다
    if (up > 0.35) {                                      // 벽 격자는 높이와 무관하게 막히니 넘어가지는 못한다
      if (hitObs) { player.ribbonAir = true; player.standObs = hitObs; }   // 리본 전용 발판은 이때만 딛는다
      player.vy = Math.sqrt(2 * 13.5 * (up + (hitWall ? 0.15 : 0.5)));
      player.onGround = false;
      jumpAnim();
    }
    const move = d - stop;                                // 맞은 지점 앞까지만
    if (move > 0.4) {
      to.divideScalar(d);
      player.dashDir = { x: to.x, z: to.z };
      let t = move / 40;                                  // 기본 속도로 걸리는 시간
      if (up > 0.35) {                                    // 위로 올라가는 중이라면 정점 즈음에 도착하게 늦춘다
        const apex = Math.sqrt(2 * 13.5 * (up + (hitWall ? 0.15 : 0.5))) / 13.5;
        t = Math.max(t, apex * 0.92);
      }
      player.dashT = Math.min(1.2, t);
      player.dashSpd = Math.min(60, move / player.dashT); // 거리·시간에 맞춘 속도
    }
    chainLine(muzzle, hit);
    sfxTone(520, 0.1, 'square', 0.2, -160); sfxDash();
    return;
  }
  chainLine(muzzle, origin.clone().addScaledVector(dir, chainRange()));  // 허공
  sfxTone(260, 0.08, 'square', 0.12, -80);
}
let reloadTimer = null;
function reload() {
  reloading = true;
  document.getElementById('ammoN').textContent = '···';
  sfxReload();
  const ua = upperPlay('reloading');                // 다리는 계속 이동, 팔만 탄창 교체
  if (ua) ua.setEffectiveTimeScale(ua.getClip().duration / (reloadMs() / 1000));   // 모션 길이를 재장전 시간에 맞춘다
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { ammo = magSize(); reloading = false; updateAmmo(); if (player.upperShot === 'reloading') upperStop(); }, reloadMs());
}
function refillWeapons() {               // 단계가 넘어가면 두 총 다 장전된 상태로 시작
  clearTimeout(reloadTimer);
  reloading = false; firing = false;
  ammoStash.rifle = magSize('rifle');    // 들고 있지 않은 쪽도 만탄으로
  ammoStash.pistol = magSize('pistol');
  ammo = magSize();
  updateAmmo();
}
const updateAmmo = () => document.getElementById('ammoN').textContent = (buffT > 0 || dbgAmmo) ? '∞' : ammo;

// ---------- shooting ----------
const raycaster = new THREE.Raycaster();
function shoot(now) {
  if (player.dead || reloading || now - lastShot < (weapon === 'pistol' ? PISTOL_DELAY : fireInterval())) return;
  if (buffT <= 0 && !dbgAmmo) {          // 디버그 무한 탄창
    if (ammo <= 0) { reload(); return; }
    ammo--;
  }
  lastShot = now; updateAmmo();
  shotsFired++;
  if (weapon === 'pistol') sfxRevolver(); else sfxShot();
  if (player.fireAction) { player.fireAction.reset(); player.fireAction.setLoop(THREE.LoopOnce); player.fireAction.play(); }
  const kick = (player.zooming ? 0.008 : 0.014) * (weapon === 'pistol' ? 2 : 1);   // 리볼버는 반동 2배
  recoil = Math.min(recoil + kick, weapon === 'pistol' ? 0.1 : 0.05);
  if (weapon === 'pistol') shake(0.12, 0.12);            // 손맛: 짧고 굵은 흔들림
  flashT = 0.06;
  document.getElementById('crosshair').style.opacity = 0.6;
  setTimeout(() => document.getElementById('crosshair').style.opacity = 1, 70);

  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const dir = raycaster.ray.direction.clone();
  let origin = raycaster.ray.origin.clone();
  function scan(org) {                  // 광선에 걸리는 적을 가까운 순서로 모두
    const list = [];
    const test = (c, r) => {
      const oc = c.clone().sub(org);
      const t = oc.dot(dir);
      if (t < 0) return null;
      return (oc.lengthSq() - t * t) < r * r ? t : null;
    };
    for (const en of enemies) {
      if (en.state === 'dead') continue;
      const s = en.scale;
      // 같은 적 안에서는 머리 우선 (머리 구체가 몸통 상단과 겹쳐도 머리로 판정)
      const tH = test(enemyHeadPos(en), 0.196 * s); // 머리 본 기준 · 크리티컬 반경 30% 축소
      const tB = test(en.root.position.clone().add(new THREE.Vector3(0, 1.15 * s, 0)), 0.66 * s);
      let t = null, hd = false;
      if (tH !== null) { t = tH; hd = true; }
      else if (tB !== null) { t = tB; hd = false; }
      if (t !== null) list.push({ t, en, headshot: hd });
    }
    return list.sort((a, b) => a.t - b.t);
  }
  let hits = scan(origin);
  if (!hits.length && camMode !== 'fps') {
    // 3인칭 근접 시차 보정: 가슴 높이 원점으로 재판정
    const chest = player.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
    const alt = scan(chest);
    if (alt.length) { hits = alt; origin = chest; }
  }
  let bestT = hits.length ? hits[0].t : 120;
  let hitEn = hits.length ? hits[0].en : null;
  // 장애물 차폐 (현재 부양 높이 반영)
  let wallT = 120;
  for (const o of obstacles) {
    const min = new THREE.Vector3(o.x - o.w / 2, o.yOff, o.z - o.d / 2);
    const max = new THREE.Vector3(o.x + o.w / 2, o.yOff + o.h, o.z + o.d / 2);
    const t = rayAABB(origin, dir, min, max);
    if (t !== null && t < wallT) wallT = t;
  }
  if (walkGrid) {                       // 벽 차폐 (카메라가 벽 속이면 벗어난 지점부터 판정)
    const gt = gridRayT(origin, dir, Math.min(wallT, 90));
    if (gt !== null) wallT = gt;
  }
  const swT = hitSwitch(origin, dir, Math.min(wallT, hitEn ? bestT : 120));  // 벽·적보다 가까운 스위치
  const wcT = swT === null ? hitWoodCrate(origin, dir, Math.min(wallT, hitEn ? bestT : 120)) : null;
  const muzzle = muzzleTip(dir);
  lastMuzzle.copy(muzzle);
  if (swT !== null) { addTracer(muzzle, origin.clone().addScaledVector(dir, swT)); shotsHit++; return; }
  if (wcT !== null) { addTracer(muzzle, origin.clone().addScaledVector(dir, wcT)); shotsHit++; return; }
  window.__lastShot = { origin: origin.toArray().map(v => +v.toFixed(2)), dir: dir.toArray().map(v => +v.toFixed(3)), bestT: +bestT.toFixed(2), wallT: +wallT.toFixed(2), hit: !!hitEn };
  const reach = hits.filter(h => h.t < wallT);   // 벽 앞까지 걸린 대상들
  if (reach.length) {
    const pen = penPower();
    let last = null;
    for (let idx = 0; idx < reach.length; idx++) {
      const { en: tgt, t, headshot: hd } = reach[idx];
      if (tgt.state === 'dead' || tgt.gone) continue;
      last = hitOne(tgt, t, hd, idx === 0);
      const chance = pen - idx;          // 1차 관통 확률 → 2차는 100%를 넘긴 만큼
      if (chance <= 0 || Math.random() >= chance) break;
      popupWorld(headPos(tgt), '관통', 'pen', -46);   // 대미지 숫자와 겹치지 않게 왼쪽
    }
    addTracer(muzzle, last ?? origin.clone().addScaledVector(dir, Math.min(wallT, 80)));
  } else {
    const end = origin.clone().addScaledVector(dir, Math.min(wallT, 80));
    addTracer(muzzle, end);
    if (wallT < 120) burst(end, 0x8899aa, 4);
  }
  function hitOne(hitEn, bestT, headshot, first) {
    // 머리 명중 세분화: 외곽 = 크리티컬(34), 중심(정밀) = 헤드샷 원샷킬
    let hitKind = headshot ? 'crit' : 'body';
    if (headshot && hitEn.kind !== 'boss') { // 보스는 헤드샷 없음(크리티컬까지만)
      const hc = enemyHeadPos(hitEn).sub(origin);
      const ht = hc.dot(dir);
      const hdd = hc.lengthSq() - ht * ht;
      if (hdd < (0.075 * hitEn.scale) ** 2) hitKind = 'hs'; // 정밀 헤드샷 반경 50% 추가 축소
    }
    if (first) shotsHit++;               // 명중률은 발당 한 번만
    const hitPos = origin.clone().addScaledVector(dir, bestT);
    burst(hitPos, headshot ? 0xffcc44 : 0xbb2233, hitKind === 'hs' ? 20 : headshot ? 14 : 9);
    if (hitKind === 'hs' && !hitEn.invuln) { hitEn.hp = 0; headshots++; } // 헤드샷 = 원샷킬
    else damageEnemy(hitEn, Math.round((hitKind === 'crit' ? 34 : 13) * dmgMul() * (weapon === 'pistol' ? PISTOL_DMG : 1)), hitKind === 'crit' ? 'crit' : '');   // 리볼버는 한 발이 무겁다
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
    if (headshot) popupHitText(hitKind, hitEn);
    hitKind === 'hs' ? sfxHead() : sfxHit();
    if (hitEn.hp <= 0) killEnemy(hitEn, hitKind === 'hs' ? 2 : 1);
    return hitPos;
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
// 적 머리 실제 위치: 머리 본 월드 좌표(전방 기울기·애니메이션 추적) + 얼굴 중심 보정
function enemyHeadPos(en) {
  const v = new THREE.Vector3();
  if (en.headBone) { en.headBone.getWorldPosition(v); v.y += 0.12 * en.scale; }
  else { v.copy(en.root.position); v.y += 1.5 * en.scale; }
  return v;
}

// 크리티컬/헤드샷 텍스트: 요소를 매번 새로 만들어 누적 표시 → 각자 위로 상승 후 제거
function popupHitText(kind, en) {
  const el = document.createElement('div');
  el.className = 'hitPop ' + kind;
  el.textContent = kind === 'hs' ? 'HEADSHOT!' : 'CRITICAL!';
  const v = en.root.position.clone().add(new THREE.Vector3(0, 2.5 * en.scale, 0)).project(camera);
  const jx = (Math.random() - 0.5) * 36; // 연타 시 겹치지 않게 좌우 흔들림
  el.style.left = ((v.x * 0.5 + 0.5) * innerWidth + jx) + 'px';
  el.style.top = ((-v.y * 0.5 + 0.5) * innerHeight) + 'px';
  document.getElementById('hud').appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}
function popupAt(px, py, text, cls, dx = 0) {   // 화면 좌표에 떠오르는 글자 (dx: 가로 밀기)
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;   // 투영이 튀면 띄우지 않는다
  const el = document.createElement('div');
  el.className = 'dmgPop' + (cls ? ' ' + cls : '');
  el.textContent = text;
  const jitter = dx ? 0 : (Math.random() - 0.5) * 30;         // 밀어둔 표시는 흔들지 않는다
  const x = Math.max(30, Math.min(innerWidth - 30, px + dx + jitter));
  el.style.left = x + 'px';
  el.style.top = Math.max(56, Math.min(innerHeight - 40, py)) + 'px';   // 화면 밖으로 나가지 않게
  document.getElementById('hud').appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}
function popupWorld(pos, text, cls, dx = 0) {   // 월드 지점 위로 떠오르는 글자
  const v = pos.clone().project(camera);
  if (v.z > 1) return;                   // 카메라 뒤면 표시하지 않는다
  popupAt((v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight, text, cls, dx);
}
function popupSelfDamage(n) {            // 내가 받은 피해 — 내 머리 위에 빨갛게
  if (n <= 0) return;
  if (camMode === 'fps') popupAt(innerWidth / 2, innerHeight * 0.44, n, 'self');   // 1인칭은 머리가 카메라 자리
  else popupWorld(player.pos.clone().add(new THREE.Vector3(0, 2.15, 0)), n, 'self');
}
const headPos = en => en.root.position.clone().add(new THREE.Vector3(0, 2.05 * en.scale, 0));
function popupDamage(en, dmg, kind) {    // 머리 위로 피해량
  if (!en?.root || dmg <= 0) return;
  popupWorld(headPos(en), dmg, kind);
}
function refreshHpBar(en) {              // 맞으면 HP 바를 잠깐 띄운다
  en.hpBarT = 4;
  if (!en.hpBar) return;
  const r = Math.max(0, en.hp / en.maxhp);
  en.hpBar.fill.scale.x = Math.max(0.001, r);
  en.hpBar.fill.position.x = -(1 - r) * 0.55;
}
function hitmark(head) {
  const h = document.getElementById('hitmark');
  h.classList.toggle('head', head);
  h.style.opacity = 1; h.style.transition = 'none';
  requestAnimationFrame(() => { h.style.transition = 'opacity .3s'; h.style.opacity = 0; });
}

// ---------- player damage ----------
function damagePlayer(n, fromX, fromZ, src) {
  if (player.dead) return;
  if (blocking && canBlock() && frontAttack(fromX, fromZ)) {   // 뒤에서 온 공격은 못 막는다 (무적 여부와 무관하게 판정)
    if (parryReady()) {                  // 0.3초 안 = 패링: 피해 0 + 방패 반격
      parryFx(src, fromX, fromZ);
      if (src && src.hp > 0 && damageEnemy(src, counterDmg(), 'parry')) killEnemy(src);   // 반격으로도 처치된다
      return;
    }
    n = Math.max(1, Math.round(n * shieldCut()));  // 늦으면 막기만 (피해 감소)
    sfxTone(180, 0.1, 'square', 0.2);
  }
  if (dbgGod) return;                    // 디버그 무적: 피해만 무시
  if (fromX !== undefined) showHitArrow(fromX, fromZ);
  popupSelfDamage(n);
  player.hp -= n;
  sfxHurt();
  const f = document.getElementById('dmgflash');
  f.style.opacity = 1; setTimeout(() => f.style.opacity = 0, 180);
  updateHpHud();
  if (player.hp <= 0) {
    player.dead = true;
    refreshOverlay();                   // 사망: 모바일 조작 버튼 숨김
    firing = false; gMode = false; trajLine.visible = false; aimCircle.visible = false;
    shopMenu.style.display = 'none'; // 일시정지 상점이 열려 있었다면 닫기
    // 사망 애니메이션(humanoid:death_gun) 재생 후 YOU DIED 표시
    const deathName = player.crouch && player.actions['death crouching headshot front'] ? 'death crouching headshot front' : 'humanoid:death_gun';
    const da = player.actions[deathName];
    let deathDur = 2.2;
    if (da) {
      da.setLoop(THREE.LoopOnce); da.clampWhenFinished = true;
      play(deathName, 0.15);
      upperStop(0.1);
      player.oneShot = deathName; // 다른 애니로 덮이지 않게 고정
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
  player.dead = false; player.pos.copy(playerStart); player.vy = 0;
  player.oneShot = null;
  // 사망 포즈(clampWhenFinished) 잔존 방지 — 전체 액션 정지 후 idle 새로 시작
  if (player.mixer) player.mixer.stopAllAction();
  if (player.actions['rifle aiming idle']) { player.current = null; play('rifle aiming idle', 0.1); }
  player.zooming = false; player.eyeH = EYE_STAND; player.crouch = false;
  player.dashT = 0; player.dashCd = 0; chainCd = 0;
  ribbonOwned = gearSave.ribbon; pistolOwned = gearSave.pistol;
  chainUses = chainMax(); chainRe = 0; updateRibbonSlot(); updatePistolSlot();
  gearQueue = []; gearResume = false; document.getElementById('gearGot')?.classList.remove('on');
  floorNo = 1; floorTime = FLOOR_TIME; hunter = null;
  score = 0; kills = 0; wave = 0; reloading = false; buffT = 0;
  runStart = gameTime;                   // 이번 판 시작 시각
  // 코인·업그레이드·수류탄은 게임오버 후에도 유지
  ammo = magSize();
  clearSpawnTimers();
  renderUpg();
  combo = 0; lastKillT = -99; headshots = 0; shotsFired = 0; shotsHit = 0;
  for (const en of enemies) retireEnemy(en);
  enemies.length = 0;
  for (const d of drops) scene.remove(d.root);
  drops.length = 0;
  for (const c of coinFx) scene.remove(c.root);
  coinFx.length = 0;
  for (const pr of projectiles) scene.remove(pr.m);
  projectiles.length = 0;
  for (const gr of liveGrenades) { scene.remove(gr.root); if (gr.circle) scene.remove(gr.circle); }
  liveGrenades.length = 0;
  for (const m of liveMines) scene.remove(m.grp);
  liveMines.length = 0;
  clearBeacon();
  pendingThrows.length = 0;
  gMode = false; trajLine.visible = false; aimCircle.visible = false; updateGSlot();
  weapon = 'rifle'; slot = 'gun'; blocking = false;
  for (const k of Object.keys(ammoStash)) delete ammoStash[k];
  applyWeaponLook(); updateWeaponSlot();
  player.hp = maxHp(); // 업그레이드 초기화 후이므로 100
  updateHpHud();
  document.getElementById('scoreN').textContent = 0;
  document.getElementById('kills').textContent = '0';
  setCoinHud();
  document.getElementById('aura').classList.remove('on');
  document.getElementById('buff').style.display = 'none';
  document.getElementById('ammo').classList.remove('inf');
  updateAmmo();
  msgEl.style.display = 'none';
  if (toMenu) { started = false; inRun = false; paused = false; document.getElementById('mapPick').style.display = 'none'; document.getElementById('brief').style.display = 'none'; refreshOverlay(); } // 확인 → 메인 화면
  else if (isMobileCtrl()) { started = true; mobileFullscreen(); refreshOverlay(); }
  else lockPointer();
  nextWave();
}
document.getElementById('deathOk').addEventListener('click', e => { e.stopPropagation(); restart(true); });

// ---------- update ----------
let recoil = 0;
const camTarget = new THREE.Vector3();

// ---------- 미니맵 (동심원 · 위 = 시선 방향) ----------
const mmCv = document.getElementById('minimap');
const mmCtx = mmCv.getContext('2d');
let mmAcc = 0;
function drawMinimap() {
  const S = mmCv.width, C = S / 2, R = C - 4, k = S / 150; // k: 150px 기준 스케일
  const MM_VIEW = walkGrid ? 55 : ARENA;   // 표시 반경(m)
  mmCtx.clearRect(0, 0, S, S);
  // 동심원
  mmCtx.strokeStyle = 'rgba(126,224,163,.35)';
  mmCtx.lineWidth = k;
  for (let i = 1; i <= 3; i++) {
    mmCtx.beginPath(); mmCtx.arc(C, C, R * i / 3, 0, Math.PI * 2); mmCtx.stroke();
  }
  const toMap = (wx, wz) => {
    // 플레이어 기준 상대좌표 → 위=전방 정렬
    // 전방 f=(-sin yaw, -cos yaw), 우측 r=(cos yaw, -sin yaw)
    const dx = wx - player.pos.x, dz = wz - player.pos.z;
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const u = dx * cy - dz * sy;        // 우측 성분 → 화면 +x
    const v = dx * sy + dz * cy;        // 전방 성분의 음수 → 화면 +y(아래)
    return [C + u / MM_VIEW * R, C + v / MM_VIEW * R];
  };
  const dot = (x, y, color, r = 3 * k) => {
    if (Math.hypot(x - C, y - C) > R - 1) { // 범위 밖은 가장자리에 클램프
      const a = Math.atan2(y - C, x - C);
      x = C + Math.cos(a) * (R - 2); y = C + Math.sin(a) * (R - 2);
    }
    mmCtx.fillStyle = color;
    mmCtx.beginPath(); mmCtx.arc(x, y, r, 0, Math.PI * 2); mmCtx.fill();
  };
  if (walkGrid) {                          // 랜덤맵: 가본 곳만 드러나는 안개 미니맵
    mmCtx.save();
    mmCtx.beginPath(); mmCtx.arc(C, C, R - 1, 0, Math.PI * 2); mmCtx.clip();
    mmCtx.fillStyle = 'rgba(126,224,163,.16)';
    for (const r of mapRects.filter((_, i) => seenRects.has(i))) {
      const q1 = toMap(r.x0, r.z0), q2 = toMap(r.x1, r.z0), q3 = toMap(r.x1, r.z1), q4 = toMap(r.x0, r.z1);
      mmCtx.beginPath();
      mmCtx.moveTo(q1[0], q1[1]); mmCtx.lineTo(q2[0], q2[1]); mmCtx.lineTo(q3[0], q3[1]); mmCtx.lineTo(q4[0], q4[1]);
      mmCtx.closePath(); mmCtx.fill();
    }
    mmCtx.restore();
  }
  if (portal) {                            // 포탈: 미니맵 범위 안에 들어와야만 보인다 (방향 표시 없음)
    const q = toMap(portal.x, portal.z);
    const pd = Math.hypot(q[0] - C, q[1] - C), col = portal.locked ? '#ff4d4d' : '#c79bff';
    if (pd <= R - 6 * k) dot(q[0], q[1], col, 6 * k);
    else if (dbgPortal) {                // 디버그: 멀어도 가장자리에 표시
      const s2 = (R - 8 * k) / (pd || 1);
      dot(C + (q[0] - C) * s2, C + (q[1] - C) * s2, col, 6 * k);
    }
  }
  if (beacon) {                            // 비콘: 큰 노란 표식
    const b = toMap(beacon.x, beacon.z);
    dot(b[0], b[1], '#ffe27a', 6 * k);
  }
  for (const m of markers) dot(...toMap(m.x, m.z), '#39f6ff', 3.5 * k);   // 내가 찍은 마커
  for (const d of drops) dot(...toMap(d.root.position.x, d.root.position.z), '#ffd76b');
  for (const en of enemies) {
    if (en.state === 'dead') continue;
    if (walkGrid) {                        // 랜덤맵: 보이거나 가까운 적만 표시
      const d = Math.hypot(en.root.position.x - player.pos.x, en.root.position.z - player.pos.z);
      if (d > 15 && !losClear(player.pos.x, player.pos.z, en.root.position.x, en.root.position.z)) continue;
    }
    dot(...toMap(en.root.position.x, en.root.position.z), '#ff5555');
  }
  // 플레이어(중앙 화살표, 위 = 전방)
  mmCtx.fillStyle = '#7ee0a3';
  mmCtx.beginPath();
  mmCtx.moveTo(C, C - 6 * k); mmCtx.lineTo(C - 4 * k, C + 4 * k); mmCtx.lineTo(C + 4 * k, C + 4 * k);
  mmCtx.closePath(); mmCtx.fill();
}

function updatePlayer(dt) {
  gameTime += dt;
  if (walkGrid) { flowTimer -= dt; if (flowTimer <= 0) { rebuildFlow(); flowTimer = 0.3; } }
  const mobile = isMobileCtrl();
  if (mobile) { if (zoomTog && !player.zooming) sfxZoom(); player.zooming = zoomTog; }
  const wantCrouch = !!(keys['ControlLeft'] || keys['ControlRight'] || keys['KeyC']) && !player.dead;
  if (wantCrouch !== player.crouch) {
    if (wantCrouch || !crouchBlockedAbove()) player.crouch = wantCrouch;   // 머리 위가 막혀 있으면 일어서지 못한다
  }
  player.eyeH += ((player.crouch ? EYE_CROUCH : EYE_STAND) - player.eyeH) * Math.min(1, dt * 12);   // 눈높이 부드럽게
  const sp = moveSpeed() * (dbgFast ? 3 : 1) * (player.crouch ? CROUCH_SPD : 1); // 기본 이동 = 달리기 (디버그 3배속 · 앉으면 절반)
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
  let mvx = dx * sp * dt, mvz = dz * sp * dt;   // 이번 프레임 이동량 (걷기 + 대쉬)
  // 대쉬 방향 후보: 입력 중이면 입력 방향, 아니면 전방
  if (Math.abs(mx) + Math.abs(mz) > 0.12) player.lastDir = { x: dx, z: dz };
  else player.lastDir = { x: fx, z: fz };
  // 대쉬(순간 가속)
  player.dashCd = Math.max(0, player.dashCd - dt);
  if (player.dashT > 0) {
    const ds = player.dashSpd || 40;
    player.dashT -= dt;
    mvx += player.dashDir.x * ds * dt;
    mvz += player.dashDir.z * ds * dt;
  }
  // 빠를 때(대쉬 40m/s · 리본 60m/s · 저프레임 dt 0.05 → 한 프레임 3m) 1m 벽을 건너뛰지 않게 20cm씩 나눠 밀어 넣는다
  let safeX = player.pos.x, safeZ = player.pos.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(mvx, mvz) / 0.2));
  for (let s = 0; s < steps; s++) {
    player.pos.x += mvx / steps; player.pos.z += mvz / steps;
    collideCircle(player.pos, 0.45, player.crouch ? 1.15 : 1.7, player.pos.y);   // 앉으면 낮은 틈도 지나간다
    if (walkGrid && cellSolid(player.pos.x, player.pos.z)) {   // 그래도 벽 속이면 마지막 안전 지점으로 되돌리고 멈춘다
      player.pos.x = safeX; player.pos.z = safeZ; player.dashT = 0;
      break;
    }
    safeX = player.pos.x; safeZ = player.pos.z;
  }
  if (onLava(player.pos.x, player.pos.z) && player.pos.y < 0.35 && !player.dead) {   // 용암 위: 발판에 올라서면 안전
    lavaBurn += dt;
    if (lavaBurn >= 0.25) { lavaBurn = 0; damagePlayer(Math.round(LAVA_DPS * 0.25)); }
    const f = document.getElementById('dmgflash');
    if (f) { f.style.opacity = 0.35; setTimeout(() => f.style.opacity = 0, 120); }
  } else lavaBurn = 0;

  // 점프/중력/플랫폼 지지
  if (keys['Space'] && player.onGround && !player.crouch) {   // 앉은 채로는 점프하지 않는다
    player.vy = jumpV(); player.onGround = false;
    jumpAnim();
  }
  const sup = supportHeight(player.pos);
  player.vy -= 13.5 * dt; player.pos.y += player.vy * dt;
  if (player.pos.y <= sup) {
    if (!player.onGround && player.oneShot === 'rifle jump') { player.oneShot = null; if (player.current) player.current.timeScale = 1; }   // 착지: 점프 모션 종료 → 이동 모션으로
    player.pos.y = sup; player.vy = 0; player.onGround = true;
    player.standObs = supObs;            // 이 발판 위에 있는 동안은 계속 딛는다
    player.ribbonAir = false;
  } else if (player.vy !== 0) player.onGround = false;

  player.root.position.copy(player.pos);
  player.root.rotation.y = player.yaw + Math.PI;

  // 로코모션
  if (!player.oneShot) {
    const moving = Math.abs(mx) + Math.abs(mz) > 0.12;
    const L = player.upperShot && player.actions['rifle run_lower'] ? '_lower' : '';   // 상체가 따로 움직이는 중이면 하체 클립만
    if (player.crouch && player.actions['idle crouching aiming']) {   // 앉기: 정지·전후좌우·대각선
      const fw = mz < -0.12, bk = mz > 0.12, rt = mx > 0.12, lf = mx < -0.12;
      const n = !moving ? 'idle crouching aiming'
        : fw ? (rt ? 'walk crouching forward right' : lf ? 'walk crouching forward left' : 'walk crouching forward')
        : bk ? (rt ? 'walk crouching backward right' : lf ? 'walk crouching backward left' : 'walk crouching backward')
        : rt ? 'walk crouching right' : 'walk crouching left';
      play(n + L);
    } else if (!moving) play('rifle aiming idle' + L);
    else if (mz < 0) play('rifle run' + L);
    else if (mz > 0) play('run backwards' + L);
    else if (mx > 0) play('strafe' + L);
    else play('strafe (2)' + L); // 왼쪽: strafe left는 바닥 싱크가 안 맞음
  }
  if (player.current && !player.oneShot) player.current.timeScale = player.dashT > 0 ? 1.6 : player.crouch ? 1.0 : 1.15;

  player.mixer.update(dt);
  // 홀드 투척: 1.5초 지점에서 모션 정지 유지 (마우스 업까지)
  if (gWindup || gReleasePending) {
    const a = player.upperShot === 'toss grenade' ? player.upperAct : null;
    if (a && a.time >= WIND_HOLD_T) {
      if (gWindup) { a.time = WIND_HOLD_T; a.paused = true; }   // 누르고 있는 동안 대기
      else commitThrow(a);                                      // 미리 놓았으면 도달 즉시 던진다
    }
  }
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
    let sh = 0.95;                      // 어깨 오프셋
    if (walkGrid) {
      const blocked = t => cellSolid(player.pos.x + cy * t, player.pos.z - sy * t);
      for (let t = 0.25; t <= sh; t += 0.15) {          // 어깨 방향은 유지하고 벽에 닿으면 오프셋만 축소
        if (blocked(t)) { sh = Math.max(0, t - 0.3); break; }
      }
    }
    const base = new THREE.Vector3(player.pos.x + cy * sh, player.pos.y + player.eyeH, player.pos.z - sy * sh);
    let camDist = 2.7;
    if (walkGrid) {                     // 벽에 막히면 카메라를 앞으로 당긴다 (촘촘히 검사 · 여유 45cm)
      for (let t = 0.3; t <= camDist; t += 0.1) {
        if (base.y - look.y * t < WALL_H && cellSolid(base.x - look.x * t, base.z - look.z * t)) { camDist = Math.max(0.5, t - 0.45); break; }
      }
    }
    const camPos = base.clone().addScaledVector(look, -camDist);
    camPos.y = Math.max(0.3, camPos.y);
    collideCircle(camPos, 0.35, 0.3, camPos.y - 0.15);   // 옆 벽·구조물에서도 35cm 띄운다 — 카메라가 벽 속에 들어가 뒷면이 보이지 않게
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
  if (zoomShown !== player.zooming) {   // 값이 바뀔 때만 DOM을 건드린다
    zoomShown = player.zooming;
    elCrosshair.classList.toggle('zoom', player.zooming);
    elZoomVig.classList.toggle('on', player.zooming);
  }

  // 총구 이펙트
  if (flashT > 0) {
    flashT -= dt;
    flashLight.position.copy(lastMuzzle); flashSprite.position.copy(lastMuzzle);
    flashLight.intensity = flashT > 0 ? 26 : 0;
    flashSprite.material.opacity = flashT > 0 ? 0.9 : 0;
  } else { flashLight.intensity = 0; flashSprite.material.opacity = 0; }
  if (gMode) updateTrajectory();
  updateSeenRects();
  updateMarkers(dt);
  updateJumpPads(dt);
  updateDoors(dt);
  updateFloor(dt);
  roomSpawnTick(dt);
  updateHitArrows(dt);
  mmAcc += dt;
  if (mmAcc >= 0.05) { mmAcc = 0; drawMinimap(); }   // 미니맵은 초당 20번
}

// ---------- main loop ----------
const elCrosshair = document.getElementById('crosshair');
const elZoomVig = document.getElementById('zoomVig');
let zoomShown = null;
let frameNo = 0;                         // 멀리 있는 적 애니메이션을 나눠 갱신하는 데 쓴다
const clock = new THREE.Clock();
// ---------- 끊김 진단: 프레임을 구간별로 재고, 40ms 넘는 프레임의 원인을 기록한다 ----------
const PT_NAMES = ['player', 'obst', 'drops', 'proj', 'gren', 'misc', 'spawn', 'shadowLod', 'cull', 'doors', 'enemies', 'render', 'sfx'];
const PT = new Float64Array(PT_NAMES.length), PT_SUM = new Float64Array(PT_NAMES.length);
let ptFrames = 0, ptSpawned = 0, ptBaked = false, ptSfx = 0;
const hitches = []; let hitchN = 0, lastHitchCause = '';
function recordHitch(rawMs, totalMs, newProgs = 0, newTex = 0) {
  hitchN++;
  const top = [...PT_NAMES.keys()].map(i => [PT_NAMES[i], +PT[i].toFixed(1)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const ext = +(rawMs - totalMs).toFixed(1);       // 이 틱 밖에서 쓴 시간: GC · GPU 대기 · 다른 콜백(오디오/타이머)
  const h = { t: +gameTime.toFixed(1), frameMs: +rawMs.toFixed(1), tickMs: +totalMs.toFixed(1), outsideMs: ext, top, spawned: ptSpawned, baked: ptBaked, sfx: ptSfx, enemies: enemies.length, newProgs, newTex };
  hitches.push(h); if (hitches.length > 40) hitches.shift();
  lastHitchCause = ext > totalMs ? '외부(GC/GPU) ' + ext + 'ms' : top[0][0] + ' ' + top[0][1] + 'ms';
}
function simPlaying(dt, now) {           // 플레이 중 한 프레임의 갱신 (tick과 profile()이 같이 쓴다)
  let t = performance.now();
  const mk = i => { const n = performance.now(); PT[i] += n - t; t = n; };
  if (firing) shoot(now);
  const wdt = dt * timeScale();        // 줌 조준 중에는 세상이 느리게 (조준은 그대로)
  updatePlayer(wdt); mk(0);
  updateObstacles(wdt); mk(1);
  updateDrops(wdt); mk(2);
  updateBuff(dt);
  updateProjectiles(wdt); mk(3);
  updateGrenades(wdt);
  updateMines(wdt); mk(4);
  updateBeacon(dt);
  updateDecals(dt);
  updateChain(dt);
  updateSky(dt);
  updateCrateMotion(wdt);
  updateJumpPads(wdt); mk(5);
  waveSpawnTick(dt); mk(6);
  updateShadowLod(dt); mk(7);
  cullWorld(dt); mk(8);
  updateDoors(wdt); mk(9);
  for (const en of enemies) updateEnemy(en, wdt);
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].gone) enemies.splice(i, 1);
  syncBlobs(); mk(10);
  if (shadowOn && !sun.shadow.autoUpdate && frameNo % 6 === 0) { sun.shadow.needsUpdate = true; ptBaked = true; }   // 움직이는 지형(승강 발판·문)만 가끔 반영
}
function tick() {
  requestAnimationFrame(tick);
  frameNo++;
  let dt = clock.getDelta();
  const rawMs = dt * 1000;
  if (dt > 0.05) dt = 0.05;
  const now = performance.now();
  PT.fill(0); ptSpawned = 0; ptBaked = false; ptSfx = 0;
  const p0 = renderer.info.programs.length, tx0 = renderer.info.memory.textures;
  const playing = isPlaying() && !player.dead;
  syncLights();
  if (playing) {
    simPlaying(dt, now);
  } else if (player.root) {
    player.mixer.update(dt * (player.dead ? 1 : 0.4)); // 사망 애니는 정속 재생
    if (camMode === 'fps') hideBones();
    for (const en of enemies) if (en.state === 'dead') updateEnemy(en, dt);
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i]; t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.09);
    if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); tracers.splice(i, 1); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.life -= dt;
    p.v.y -= 9 * dt;
    p.m.position.addScaledVector(p.v, dt);
    if (p.life <= 0 || p.m.position.y < 0) { scene.remove(p.m); particles.splice(i, 1); }
  }
  if (showFps) {                        // 최근 0.5초 평균
    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 0.5) {
      const ri = renderer.info.render;
      document.getElementById('fpsHud').textContent = Math.round(fpsN / fpsAcc) + ' FPS · ' + (fpsAcc / fpsN * 1000).toFixed(1) + 'ms'
        + ' · 적 ' + aliveCount() + '/' + enemies.length + ' · draw ' + ri.calls + ' · tri ' + (ri.triangles / 1000).toFixed(0) + 'k'
        + (hitchN ? ' · 끊김 ' + hitchN + '회 (' + lastHitchCause + ')' : '');
      fpsAcc = 0; fpsN = 0;
    }
  }
  if (srOn) { srUpdate(dt); return; }
  const tr = performance.now();
  renderer.render(scene, camera);
  PT[11] = performance.now() - tr;
  if (playing) {
    for (let i = 0; i < PT.length; i++) PT_SUM[i] += PT[i];
    ptFrames++;
    if (rawMs > 40 && frameNo > 30) recordHitch(rawMs, performance.now() - now, renderer.info.programs.length - p0, renderer.info.memory.textures - tx0);
  }
}

// ---------- 쇼룸: 배경 공간(방) 꾸미기 — 방 슬롯 · 확장 · 창밖 풍경 · 10cm 그리드 가구 ----------
const ROOM_H = 3, ROOM_VGAP = 0.35, SLOT_COST_BASE = 500000, ROOMS_V = 4;   // 방 추가 = 50만에서 2배씩
const LEVEL_H = ROOM_H + ROOM_VGAP;      // 한 층 높이
const MIN_LINK = 2;                      // 방을 이으려면 벽이 최소 2m 맞닿아야 한다
const ROOM_MIN = 4, ROOM_MAX = 10, ROOM_STEP = 2, EXPAND_COST = 100000;   // 4×4 지급 · 2m씩 확장(줄이기 불가)
const GRID = 0.1, SNAP = 0.15;           // 10cm 격자 · 15cm 안이면 벽·가구에 붙는다
const FURN = {
  // mount: 설치면 · place: 내가 놓일 수 있는 자리 · provides: 남에게 내주는 면 · rotate: 회전 규칙
  crate: {
    name: '상자', icon: '📦', w: 0.6, d: 0.6, h: 0.6, color: 0x8a6a45,
    mount: 'floor', place: ['floor', 'top', 'under'], provides: { top: 0.6 }, rotate: 'free', blocking: true,
  },
  table: {
    name: '책상', icon: '<svg viewBox="0 0 24 24" width="26" height="26"><rect x="2" y="7.5" width="20" height="3.2" rx="1" fill="#a9764a"/><rect x="6.4" y="10.7" width="11.2" height="2.2" fill="#7d5636"/><rect x="4.2" y="10.7" width="2.4" height="9.3" fill="#6b4a34"/><rect x="17.4" y="10.7" width="2.4" height="9.3" fill="#6b4a34"/></svg>', w: 1.2, d: 0.7, h: 0.75, color: 0x6b4a34, top: true,   // 데스크 모양 아이콘 (의자 이모지가 아님)
    mount: 'floor', place: ['floor'], provides: { top: 0.81, under: 0.62 }, rotate: 'free', blocking: true,   // 0.75 몸통 + 0.06 상판
  },
  shelf: {
    name: '선반', icon: '🗄', w: 1.0, d: 0.35, h: 1.8, color: 0x4a5560,
    mount: 'floor', place: ['floor'], provides: { top: 1.8 }, rotate: 'free', blocking: true,
  },
  plant: {
    name: '화분', icon: '🪴', w: 0.4, d: 0.4, h: 0.9, color: 0x2f6b3a, round: true,
    mount: 'floor', place: ['floor', 'top'], provides: null, rotate: 'free', blocking: true,
  },
  lamp: {
    name: '램프', icon: '💡', w: 0.3, d: 0.3, h: 1.6, color: 0xd8c48a, round: true, glow: true, litW: 0.1,
    mount: 'floor', place: ['floor', 'top'], provides: null, rotate: 'free', blocking: true,
  },
  rug: {
    name: '러그', icon: '🟥', w: 1.6, d: 1.1, h: 0.02, color: 0x7a2f3a,
    mount: 'floor', place: ['floor'], provides: { flat: true }, rotate: 'free', blocking: false,
  },
  locker: {
    name: '락커', icon: '🚪', w: 0.8, d: 0.5, h: 2.0, color: 0x39505f,
    mount: 'floor', place: ['floor'], provides: { top: 2.0 }, rotate: 'free', blocking: true,
  },
  drawer: {
    name: '서랍장', icon: '🗃', w: 0.5, d: 0.45, h: 0.55, color: 0x5a4636,
    mount: 'floor', place: ['floor', 'under'], provides: { top: 0.55 }, rotate: 'free', blocking: true,
  },
  monitor: {
    name: '모니터', icon: '🖥', w: 0.55, d: 0.18, h: 0.42, color: 0x1d222b, glow: true, litW: 0.1,
    mount: 'floor', place: ['top'], provides: null, rotate: 'free', blocking: false,
  },
  keyboard: {
    name: '키보드', icon: '⌨', w: 0.42, d: 0.15, h: 0.03, color: 0x2a3038,
    mount: 'floor', place: ['top'], provides: null, rotate: 'free', blocking: false,
  },
  banner: {
    name: '배너', icon: '🎌', w: 0.9, d: 0.06, h: 1.4, color: 0x2b6f8f,
    mount: 'wall', place: ['wall'], provides: null, rotate: 'wall', blocking: false, wallY: 1.9,
    sizable: true, image: true,
  },
  window: {
    name: '창문', icon: '🪟', w: 1.4, d: 0.1, h: 1.1, color: 0x8fd8f5,
    mount: 'wall', place: ['wall'], provides: null, rotate: 'wall', blocking: false, wallY: 1.6,
    sizable: true, transparent: true,
  },
  wallshelf: {
    name: '벽선반', icon: '📚', w: 0.9, d: 0.28, h: 0.08, color: 0x6b5a44,
    mount: 'wall', place: ['wall'], provides: { top: 0.08 }, rotate: 'wall', blocking: false, wallY: 1.3,
  },
  ceilLamp: {
    name: '천장등', icon: '🔆', w: 0.34, d: 0.34, h: 0.3, color: 0xf0e0b0, round: true, glow: true, litW: 0.2,
    mount: 'ceiling', place: ['ceiling'], provides: null, rotate: 'none', blocking: false,
  },
  fan: {
    name: '실링팬', icon: '🌀', w: 1.0, d: 1.0, h: 0.16, color: 0x8a8f98, round: true,
    mount: 'ceiling', place: ['ceiling'], provides: null, rotate: 'none', blocking: false,
  },
  door: {
    name: '문', icon: '🚪', w: 1.1, d: 0.16, h: 2.1, color: 0x6b5a44, wall: true,
    mount: 'opening', place: ['wall'], provides: null, rotate: 'wall', blocking: false, link: 'side',
  },
  stairs: {
    name: '계단', icon: '🪜', w: 1.2, d: 2.2, h: LEVEL_H, color: 0x7a6a55,   // 층 높이만큼 올라간다
    mount: 'floor', place: ['floor'], provides: null, rotate: 'free', blocking: true, link: 'up',
  },
};
let heads = +(localStorage.getItem('fps.head') || 0);   // 🔷 헤드 — 현금으로 사는 화폐
function saveHeads() { localStorage.setItem('fps.head', String(heads)); syncHeadUI(); }
function addHeads(n) { heads = Math.max(0, heads + n); saveHeads(); }
function spendHeads(n, what) {
  if (heads < n) { toast('🔷 헤드가 부족합니다 — ' + fmt(n) + ' 필요 (보유 ' + fmt(heads) + ')'); return false; }
  heads -= n; saveHeads();
  toast('🔷 헤드 ' + fmt(n) + ' 사용 — ' + what);
  return true;
}
const HEAD_IC = '<img class="hc" src="assets/headcoin.png" alt="헤드">';                  // 헤드 코인 아이콘
function syncHeadUI() {
  const el = document.getElementById('srHeads');
  if (el) el.innerHTML = HEAD_IC + ' ' + fmt(heads);
  const h = document.getElementById('curHead');
  if (h) h.textContent = fmt(heads);
}
// 헤드 1개 ≈ 12원. 목표 가격을 12로 나눈 뒤 10단위 내림 (headOf)
const HEAD_WON = 12;
const headOf = won => Math.floor(won / HEAD_WON / 10) * 10;
const HEAD_FURN = { plant: headOf(2000) };    // 화분 ≈ 2,000원 → 160
const HEAD_BG = { city: headOf(1500) };       // 도시 풍경 ≈ 1,500원 → 120
const HEAD_PAL = { '#e07a2f': headOf(1500) }; // 오렌지 색 ≈ 1,500원 → 120
const HEAD_RENAME = headOf(1000);             // 방 이름 변경 ≈ 1,000원 → 80
const HEAD_SLOT = headOf(3500);               // 저장 슬롯 한 칸 ≈ 3,500원 → 290
const LAMP_I = 5.28;                      // 조명 가구 점광원 기준 세기 (1.5 → 1.5 → 1.3 → 1.2 → 1.5배)
const FURN_COST = {                       // 코인으로 사는 기본 가구
  crate: 3000, table: 12000, shelf: 9000, lamp: 6000, rug: 5000,   // 화분은 헤드 상품(HEAD_FURN)
  locker: 15000, drawer: 8000, monitor: 20000, keyboard: 7000, banner: 6000, door: 30000, stairs: 40000, window: 25000,
};
const FURN_LOOT = ['wallshelf', 'ceilLamp', 'fan'];   // 게임 속 목재상자에서만 나오는 가구
const furnOwned = new Set(JSON.parse(localStorage.getItem('fps.furn') || '[]'));   // 코인으로 산 가구 (해금)
function saveFurnOwned() { localStorage.setItem('fps.furn', JSON.stringify([...furnOwned])); }
const PAL_FARM = ['#2f6b3a', '#2b6f8f', '#7a2f3a', '#c98a4a', '#d8c48a', '#5a4a6b'];   // 파밍으로 얻는 벽 색
const BG_FARM = ['valley', 'sea'];                                                    // 파밍으로 얻는 창밖 풍경 (도시는 헤드 상품)
const farm = Object.assign({ furn: {}, pal: {}, bg: {} }, JSON.parse(localStorage.getItem('fps.farm') || '{}'));
for (const k of FURN_LOOT) if (furnOwned.has(k)) {   // 예전 해금 저장본 → 재고 1개로 옮긴다
  furnOwned.delete(k);
  farm.furn[k] = Math.max(1, farm.furn[k] ?? 0);
}
function saveFarm() { localStorage.setItem('fps.farm', JSON.stringify(farm)); saveFurnOwned(); }
function furnStock(k) { return farm.furn[k] ?? 0; }       // 파밍 가구 남은 개수
function furnUnlocked(k) { return furnOwned.has(k); }     // 코인으로 산 가구인가
function furnUsable(k) {                                  // 지금 놓을 수 있나
  if (decoMode) return true;
  return FURN_LOOT.includes(k) ? furnStock(k) > 0 : furnUnlocked(k);
}
function headPrice(k) { return HEAD_FURN[k] ?? 0; }       // 0이면 헤드 상품이 아니다
function grantFurniture(k) {              // 상자에서 획득 — 같은 가구도 개수로 쌓인다
  farm.furn[k] = furnStock(k) + 1;
  saveFarm();
  return farm.furn[k];
}
function takeFurniture(k) {               // 놓을 때 하나 소모 (방꾸미기 모드면 소모하지 않는다)
  if (decoMode || !FURN_LOOT.includes(k)) return false;
  farm.furn[k] = Math.max(0, furnStock(k) - 1); saveFarm();
  return true;
}
function returnFurniture(it) {            // 치우면 돌려받는다 (공짜로 놓은 것은 제외)
  if (!FURN_LOOT.includes(it.type) || it.free) return;
  farm.furn[it.type] = furnStock(it.type) + 1; saveFarm();
}
function palOwned(hex) {
  const h = String(hex).toLowerCase();
  if (decoMode || farm.pal[h]) return true;
  return !PAL_FARM.includes(h) && !HEAD_PAL[h];
}
function bgOwned(k) { return decoMode || !!farm.bg[k] || (!BG_FARM.includes(k) && !HEAD_BG[k]); }
const ROT_STEP = Math.PI / 6;            // 30°씩 회전
const ROT_N = 12;
// 창밖 풍경 — 캔버스로 그린 원경 + 실내 조명 색
const BG_LIST = [
  { key: 'forest', name: '숲', icon: '🌲', tint: 0xbfe6c8 },
  { key: 'field', name: '들판', icon: '🌾', tint: 0xf0e6c0 },
  { key: 'river', name: '강가', icon: '🏞', tint: 0xcfe6f0 },
  { key: 'valley', name: '계곡', icon: '⛰', tint: 0xd8e0ea },
  { key: 'sea', name: '바다', icon: '🌊', tint: 0xc4e4f5 },
  { key: 'city', name: '도시', icon: '🌆', tint: 0xe6d2e8 },
];
const SURFACES = [                        // 색을 바꿀 수 있는 면
  { key: 'x-', name: '왼쪽 벽', def: 0x39434f },
  { key: 'x+', name: '오른쪽 벽', def: 0x39434f },
  { key: 'z-', name: '뒷벽', def: 0x39434f },
  { key: 'floor', name: '바닥', def: 0x2b3440 },
  { key: 'ceil', name: '천장', def: 0x333c48 },
];
const NEW_SURF = '#c9d3dc';               // 새 방 기본 색 (벽·바닥·천장 모두)
const newSurf = () => ({ 'x-': NEW_SURF, 'x+': NEW_SURF, 'z-': NEW_SURF, floor: NEW_SURF, ceil: NEW_SURF });
const PALETTE = ['#39434f', '#2b3440', '#4a5560', '#6b7a8a', '#8f9aa6', '#c9d3dc',
  '#6b4a34', '#8a6a45', '#a98b62', '#2f6b3a', '#3d6b7a', '#2b6f8f',
  '#7a2f3a', '#a04a4a', '#c98a4a', '#d8c48a', '#5a4a6b', '#1c242e', '#e07a2f'];   // 마지막은 헤드 전용 오렌지
let surfSel = 'x-';                       // 지금 고른 면
const surfColor = (sl, key) => sl?.surf?.[key] ?? ('#' + (SURFACES.find(s2 => s2.key === key).def).toString(16).padStart(6, '0'));
const roomStore = { v: ROOMS_V, cur: 0, slots: [{ name: 'MY ROOM', w: ROOM_MIN, d: ROOM_MIN, gx: -ROOM_MIN / 2, gz: -ROOM_MIN / 2, gy: 0, bg: 'forest', surf: newSurf(), items: [] }] };
const openRooms = () => roomStore.slots.filter(sl => !sl.closed).length;
const slotCost = () => SLOT_COST_BASE * Math.max(1, openRooms());   // 방 하나당 +50만 (2배씩 뛰지 않게)
const roomW = r => r.w ?? r.size ?? ROOM_MIN, roomD = r => r.d ?? r.size ?? ROOM_MIN;
const curRoom = () => roomStore.slots[roomStore.cur] ?? roomStore.slots[0];
let srRoomGrp = null, srFurnGrp = null, srBackdrop = null, srBgLight = null, srFence = null, srEntrance = null;
let placeType = null, placeRot = 0, placeGhost = null, srPickSel = null, srOutline = null, lastCursor = [0, 0];
let moveItem = null, moveOrig = null;   // 가구 이동 중
function roomLoad() {
  try {
    const j = JSON.parse(localStorage.getItem('fps.rooms') || 'null');
    if (j && j.v !== ROOMS_V) { localStorage.removeItem('fps.rooms'); return; }   // 규칙이 바뀌면 한 번 초기화
    if (j && Array.isArray(j.slots) && j.slots.length) {
      roomStore.cur = Math.min(j.cur | 0, j.slots.length - 1);
      roomStore.slots = j.slots.map(sl => ({
        name: sl.name || 'MY ROOM',
        w: Math.max(ROOM_MIN, Math.min(ROOM_MAX, sl.w ?? sl.size ?? ROOM_MIN)),
        d: Math.max(ROOM_MIN, Math.min(ROOM_MAX, sl.d ?? sl.size ?? ROOM_MIN)),
        bg: sl.bg || 'forest', closed: !!sl.closed,
        gx: Math.round(sl.gx ?? 0), gz: Math.round(sl.gz ?? 0), gy: Math.round(sl.gy ?? 0),
        surf: sl.surf && typeof sl.surf === 'object' ? { ...sl.surf } : {},
        renamed: !!sl.renamed,           // 이름을 한 번이라도 바꿨나 (최초 1회 무료)
        items: (Array.isArray(sl.items) ? sl.items.filter(it => FURN[it.type]) : []).map(it => {
          const f = FURN[it.type];
          if (f.mount === 'ceiling') it.y = +(ROOM_H - f.h).toFixed(2);        // 천장물
          else if (f.mount === 'wall' && !(it.y > 0.05)) it.y = f.wallY ?? 1.3; // 벽걸이
          return it;
        }),
      }));
      return;
    }
    const old = JSON.parse(localStorage.getItem('fps.room') || 'null');   // 예전 저장본 이어받기
    if (old && old.size) {
      const sz = Math.max(ROOM_MIN, Math.min(ROOM_MAX, old.size));
      roomStore.slots = [{ name: old.name || 'MY ROOM', w: sz, d: sz, bg: 'forest', items: old.items ?? [] }];
    }
  } catch { }
}
let roomDirty = false;                    // 저장하지 않은 변경사항이 있나
const undoStack = [];                     // 되돌리기용 스냅샷 (최근 30단계)
let lastSnap = null;                      // 마지막으로 기록한 상태
const snapNow = () => JSON.stringify(roomStore);
function markSnap() { lastSnap = snapNow(); syncUndoBtn(); }   // 지금 상태를 기준점으로
function pushUndo() {                     // 바뀌기 직전 상태를 쌓는다
  const cur = snapNow();
  if (lastSnap === null) { lastSnap = cur; return; }
  if (cur === lastSnap) return;
  undoStack.push(lastSnap);
  if (undoStack.length > 30) undoStack.shift();
  lastSnap = cur;
  syncUndoBtn();
}
function undoRoom() {
  if (!undoStack.length) { toast('↩ 되돌릴 변경이 없습니다'); return; }
  const snap = undoStack.pop();
  const j = JSON.parse(snap);
  roomStore.slots = j.slots;
  roomStore.cur = Math.min(j.cur ?? 0, roomStore.slots.length - 1);
  lastSnap = snap;
  setSel(null); cancelPlace();
  roomDirty = true; syncSaveBtn(); syncUndoBtn();
  buildWorld(); roomRenderUI(); srRenderModeUI();
  toast('↩ 실행 취소 (남은 ' + undoStack.length + '단계)');
}
function syncUndoBtn() {
  for (const b of document.querySelectorAll('#srUndo, #srLiveBar [data-act="undo"]')) {
    b.disabled = !undoStack.length;
    b.textContent = '↩' + (undoStack.length ? ' ' + undoStack.length : '');
    b.title = '실행 취소';
  }
}
function fixMountY() {                    // 설치면 높이를 한 번 더 맞춘다
  for (const sl of roomStore.slots) {
    for (const it of sl.items) {
      const f = FURN[it.type];
      if (!f) continue;
      if (f.mount === 'ceiling') it.y = +(ROOM_H - f.h).toFixed(2);
      else if (f.mount === 'wall' && !(it.y > 0.05)) it.y = f.wallY ?? 1.3;
    }
  }
}
function roomSave() {                     // 편집 표시만 — 실제 저장은 '변경사항 저장'
  fixMountY();
  pushUndo();                             // 바뀌기 전 상태를 되돌리기 스택에
  roomDirty = true;
  syncSaveBtn();
}
function roomCommit() {                   // 지금 상태를 디스크에 확정
  fixMountY();
  localStorage.setItem('fps.rooms', JSON.stringify(roomStore));
  roomDirty = false;
  syncSaveBtn();
}
function roomRevert() {                   // 마지막으로 저장한 상태로 되돌린다
  roomLoad();
  undoStack.length = 0; lastSnap = snapNow();
  roomDirty = false;
  roomStore.cur = Math.min(roomStore.cur, roomStore.slots.length - 1);
  setSel(null); cancelPlace();
  buildWorld(); roomRenderUI(); srRenderModeUI(); syncSaveBtn();
}
function syncSaveBtn() {
  for (const b of document.querySelectorAll('#srSave, #srLiveBar [data-act="save"]')) {
    b.textContent = roomDirty ? '💾•' : '💾';
    b.title = roomDirty ? '변경사항 저장 (저장 안 된 변경 있음)' : '변경사항 저장';
    b.classList.toggle('dirty', roomDirty);
  }
}

// ---------- 방 저장 슬롯 (이름 · 썸네일 · 파일 저장) ----------
const SAVE_FREE = 3;                      // 기본 제공 슬롯
const SAVE_MAX = 10;                      // 확장 한도
const THUMB = 256;
let saveSlots = Math.max(SAVE_FREE, +(localStorage.getItem('fps.saveSlots') || SAVE_FREE));
let activeSlot = +(localStorage.getItem('fps.slotIdx') ?? -1);   // 지금 쓰고 있는 저장 슬롯
let roomSaves = [];                       // [{name, date, thumb, data}] — 빈 칸은 null
function slotsLoadLocal() {
  try { roomSaves = JSON.parse(localStorage.getItem('fps.saves') || '[]'); } catch { roomSaves = []; }
  if (!Array.isArray(roomSaves)) roomSaves = [];
}
let slotsSeq = 0;                         // 서버 응답이 늦게 와서 방금 한 저장을 덮어쓰지 않게
async function slotsLoad() {              // 서버가 있으면 파일에서, 없으면 브라우저 저장소에서
  slotsLoadLocal();
  const seq = ++slotsSeq;
  try {
    const r = await fetch('/rooms', { cache: 'no-store' });
    if (r.ok) {
      const j = await r.json();
      if (seq === slotsSeq && Array.isArray(j) && j.length) roomSaves = j;   // 그 사이 저장했으면 무시
    }
  } catch { }
  renderSaveSlots();
}
async function slotsPersist() {           // 브라우저에 남기고, 서버가 있으면 파일로도
  slotsSeq++;                             // 이후 도착하는 서버 응답은 무시한다
  try { localStorage.setItem('fps.saves', JSON.stringify(roomSaves)); }
  catch { toast('⚠ 저장 공간이 부족합니다 — 오래된 슬롯을 지워주세요'); }
  try { await fetch('/rooms', { method: 'POST', body: JSON.stringify(roomSaves) }); } catch { }
}
function roomThumb() {                    // 지금 서 있는 자리에서 본 장면을 256×256으로
  if (!srScene || !srCam) return '';
  const cv = document.createElement('canvas');
  cv.width = cv.height = THUMB;
  const r2 = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
  r2.setSize(THUMB, THUMB, false);
  r2.outputColorSpace = renderer.outputColorSpace;
  r2.toneMapping = renderer.toneMapping;
  const cam = srCam.clone();
  cam.aspect = 1; cam.updateProjectionMatrix();
  r2.render(srScene, cam);
  const url = cv.toDataURL('image/jpeg', 0.72);
  r2.dispose();
  return url;
}
let askSlot = -1;                        // 이름을 묻는 중인 슬롯
function askSaveName(i) {
  if (i >= saveSlots) return;
  askSlot = i;
  const box = document.getElementById('srSaveAsk'), inp = document.getElementById('srSaveAskName');
  if (!box || !inp) { saveToSlot(i, curRoom().name); return; }
  inp.value = roomSaves[i]?.name || curRoom().name || ('저장 ' + (i + 1));
  box.classList.add('on');
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
function closeSaveAsk() { askSlot = -1; document.getElementById('srSaveAsk')?.classList.remove('on'); }
function confirmSaveName() {
  if (askSlot < 0) return;
  const inp = document.getElementById('srSaveAskName');
  const name = (inp?.value || '').trim().slice(0, 16) || curRoom().name || ('저장 ' + (askSlot + 1));
  const i = askSlot;
  closeSaveAsk();
  saveToSlot(i, name);
}
function saveToSlot(i, nameIn) {
  if (i >= saveSlots) return;
  const name = (nameIn || '').trim().slice(0, 16) || curRoom().name || ('저장 ' + (i + 1));
  roomSaves[i] = {
    name, date: new Date().toISOString().slice(0, 10),
    thumb: roomThumb(),
    data: JSON.parse(JSON.stringify(roomStore)),
  };
  roomCommit();                           // 슬롯에 넣을 때는 현재 상태도 확정한다
  activeSlot = i; localStorage.setItem('fps.slotIdx', String(i));
  slotsPersist(); renderSaveSlots();
  toast('💾 ' + name + ' — ' + (i + 1) + '번 슬롯에 저장');
}
function loadFromSlot(i) {
  const sv = roomSaves[i];
  if (!sv?.data?.slots) { toast('빈 슬롯입니다'); return; }
  roomStore.slots = JSON.parse(JSON.stringify(sv.data.slots));
  roomStore.cur = Math.min(sv.data.cur ?? 0, roomStore.slots.length - 1);
  setSel(null); cancelPlace();
  activeSlot = i; localStorage.setItem('fps.slotIdx', String(i));
  slotFloor = null;                       // 방 목록은 다시 '지금 있는 층' 기준
  roomSave();                             // 불러온 상태는 '저장하지 않은 변경'
  buildWorld();
  const home = worldRooms.find(r => r.slot === roomStore.cur) ?? worldRooms[0];
  if (home) {                             // 캐릭터를 불러온 방 한가운데로 (빈 공간에 남지 않게)
    live.x = home.cx; live.z = home.cz; live.y = home.cy || 0; live.vy = 0;
    live.active = home.slot;
  }
  syncGuides(); roomRenderUI(); srRenderModeUI();
  toast('📂 ' + sv.name + ' 불러옴 — 유지하려면 변경사항 저장');
}
function clearSlot(i) {
  if (!roomSaves[i]) return;
  const n = roomSaves[i].name;
  roomSaves[i] = null;
  slotsPersist(); renderSaveSlots();
  toast('🗑 ' + n + ' 슬롯 비움');
}
function buySaveSlot() {
  if (saveSlots >= SAVE_MAX) { toast('🚫 저장 슬롯은 ' + SAVE_MAX + '개까지입니다'); return; }
  if (!spendHeads(HEAD_SLOT, '저장 슬롯 +1')) return;
  saveSlots++;
  localStorage.setItem('fps.saveSlots', String(saveSlots));
  renderSaveSlots();
}
function openLoadMenu() {                // 하단 '불러오기' — 슬롯을 골라 불러온다
  const box = document.getElementById('srLoadMenu'), list = document.getElementById('srLoadList');
  if (!box || !list) return;
  let html = '';
  for (let i = 0; i < saveSlots; i++) {
    const sv = roomSaves[i];
    html += `<div class="svRow${i === activeSlot ? ' cur' : ''}">`
      + (sv?.thumb ? `<img src="${sv.thumb}" alt="">` : '<div class="no">빈 슬롯</div>')
      + `<div class="meta"><b>${sv ? sv.name : (i + 1) + '번 슬롯'}</b><i>${sv ? sv.date + (i === activeSlot ? ' · 사용 중' : '') : '비어 있음'}</i></div>`
      + `<div class="acts"><button data-load="${i}"${sv ? '' : ' disabled'}>불러오기</button>`
      + `<button data-put="${i}">저장</button>`
      + `<button data-wipe="${i}"${sv ? '' : ' disabled'}>비우기</button></div></div>`;
  }
  html += saveSlots >= SAVE_MAX
    ? `<div class="slotBuy full">슬롯 ${SAVE_MAX}개 (최대)</div>`
    : `<div class="slotBuy" id="srSlotBuy2">＋ 슬롯 추가 ${HEAD_IC} ${fmt(HEAD_SLOT)} · ${saveSlots}/${SAVE_MAX}</div>`;
  list.innerHTML = html;
  for (const b of list.querySelectorAll('[data-load]'))
    b.addEventListener('click', e => { e.stopPropagation(); loadFromSlot(+b.dataset.load); closeLoadMenu(); });
  for (const b of list.querySelectorAll('[data-put]'))
    b.addEventListener('click', e => { e.stopPropagation(); closeLoadMenu(); askSaveName(+b.dataset.put); });
  for (const b of list.querySelectorAll('[data-wipe]'))
    b.addEventListener('click', e => { e.stopPropagation(); clearSlot(+b.dataset.wipe); openLoadMenu(); });
  list.querySelector('#srSlotBuy2')?.addEventListener('click', e => { e.stopPropagation(); buySaveSlot(); openLoadMenu(); });
  syncHeadUI();
  box.classList.add('on');
}
function closeLoadMenu() { document.getElementById('srLoadMenu')?.classList.remove('on'); }
function saveToActiveSlot() {            // 하단 '변경사항 저장' — 쓰고 있던 슬롯에 그대로
  const i = activeSlot >= 0 && activeSlot < saveSlots ? activeSlot : 0;
  saveToSlot(i, roomSaves[i]?.name || curRoom().name);
}
function renderSaveSlots() {
  syncHeadUI();
  if (document.getElementById('srLoadMenu')?.classList.contains('on')) openLoadMenu();   // 열려 있으면 갱신
  const el = document.getElementById('srSaves');
  if (!el) return;
  let html = '';
  for (let i = 0; i < saveSlots; i++) {
    const sv = roomSaves[i];
    html += `<div class="svSlot${sv ? '' : ' empty'}${i === activeSlot ? ' cur' : ''}" data-slot2="${i}">`
      + (sv?.thumb ? `<img src="${sv.thumb}" alt="">` : '<div class="svNo">빈 슬롯</div>')
      + `<div class="svInfo"><b>${sv ? sv.name : (i + 1) + '번'}</b><i>${sv ? sv.date : '비어 있음'}</i></div>`
      + `<div class="svBtns"><button data-sv="put" data-i="${i}">저장</button>`
      + `<button data-sv="get" data-i="${i}"${sv ? '' : ' disabled'}>불러오기</button>`
      + `<button data-sv="del" data-i="${i}"${sv ? '' : ' disabled'}>비우기</button></div></div>`;
  }
  html += saveSlots >= SAVE_MAX
    ? `<div class="svBuy full">슬롯 ${SAVE_MAX}개 (최대)</div>`
    : `<button id="srSlotBuy" class="svBuy">＋ 슬롯 추가 <i>${HEAD_IC} ${fmt(HEAD_SLOT)}</i> · ${saveSlots}/${SAVE_MAX}</i></button>`;
  el.innerHTML = html;
  for (const b of el.querySelectorAll('[data-sv]')) {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const i = +b.dataset.i;
      if (b.dataset.sv === 'put') askSaveName(i);
      else if (b.dataset.sv === 'get') loadFromSlot(i);
      else clearSlot(i);
    });
  }
  el.querySelector('#srSlotBuy')?.addEventListener('click', e => { e.stopPropagation(); buySaveSlot(); });
  syncHeadUI();
}
function askRename() {                    // 이름과 비용을 먼저 보여준다
  const box = document.getElementById('srNameAsk'), inp = document.getElementById('srNameAskInput');
  const sl = curRoom();
  if (!box || !inp) return;
  inp.value = sl.name;
  const cost = document.getElementById('srNameCost');
  if (cost) cost.innerHTML = sl.renamed
    ? '변경 비용 ' + HEAD_IC + ' ' + fmt(HEAD_RENAME) + ' (보유 ' + fmt(heads) + ')'
    : '최초 1회 무료';
  box.classList.add('on');
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
function closeRenameAsk() { document.getElementById('srNameAsk')?.classList.remove('on'); }
function renameRoom() {                   // 최초 1회 무료 · 이후 헤드
  const inp = document.getElementById('srNameAskInput');
  const sl = curRoom();
  const next = (inp?.value || '').trim().slice(0, 16) || 'MY ROOM';
  if (next === sl.name) { toast('이름이 그대로입니다'); closeRenameAsk(); return; }
  if (sl.renamed && !spendHeads(HEAD_RENAME, '방 이름 변경')) return;
  closeRenameAsk();
  const first = !sl.renamed;
  sl.renamed = true;
  sl.name = next;
  document.getElementById('srName').textContent = next;
  roomSave(); roomRenderUI();
  toast(first ? '✎ 이름 변경 — 최초 1회 무료' : '✎ 이름 변경');
}
// ---- 창밖 풍경 ----
function bgTexture(key) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
  const c = cv.getContext('2d');
  const sky = (a, b) => { const g2 = c.createLinearGradient(0, 0, 0, 512); g2.addColorStop(0, a); g2.addColorStop(1, b); c.fillStyle = g2; c.fillRect(0, 0, 1024, 512); };
  const hill = (col, base, amp, seed) => {
    c.fillStyle = col; c.beginPath(); c.moveTo(0, 512);
    for (let x = 0; x <= 1024; x += 16) c.lineTo(x, base - Math.sin(x * 0.008 + seed) * amp - Math.sin(x * 0.021 + seed * 2) * amp * 0.4);
    c.lineTo(1024, 512); c.closePath(); c.fill();
  };
  const tree = (x, y, h, col) => {
    c.fillStyle = '#3a2a1e'; c.fillRect(x - h * 0.05, y - h * 0.25, h * 0.1, h * 0.25);
    c.fillStyle = col; c.beginPath();
    c.moveTo(x, y - h); c.lineTo(x + h * 0.32, y - h * 0.2); c.lineTo(x - h * 0.32, y - h * 0.2); c.closePath(); c.fill();
  };
  if (key === 'forest') {
    sky('#9fd0f0', '#dcecd8');
    hill('#5d7f52', 350, 26, 1); hill('#456b41', 386, 20, 3);
    for (let i = 0; i < 46; i++) tree(20 + i * 22 + (i % 3) * 7, 420 + (i % 4) * 18, 90 + (i % 5) * 26, i % 2 ? '#2f5a34' : '#3d6b3c');
    c.fillStyle = '#2c4a2c'; c.fillRect(0, 470, 1024, 42);
  } else if (key === 'field') {
    sky('#8ec8f2', '#f2e9c4');
    hill('#cdd07a', 372, 16, 2); hill('#a8bb63', 404, 12, 5);
    c.fillStyle = '#93ad57'; c.fillRect(0, 440, 1024, 72);
    for (let i = 0; i < 60; i++) { c.fillStyle = i % 2 ? '#d8d98a' : '#c2cc72'; c.fillRect(i * 18, 440 + (i % 3) * 12, 12, 30); }
  } else if (key === 'river') {
    sky('#a6d4ef', '#e8f2f6');
    hill('#5f7f55', 330, 22, 1); hill('#4a6b47', 366, 16, 4);
    c.fillStyle = '#5f8fb5'; c.fillRect(0, 398, 1024, 114);
    for (let i = 0; i < 34; i++) { c.fillStyle = 'rgba(255,255,255,.28)'; c.fillRect((i * 37) % 1024, 410 + (i % 6) * 16, 70, 3); }
    c.fillStyle = '#6b8f5a'; c.fillRect(0, 384, 1024, 18);
  } else if (key === 'valley') {
    sky('#8fb8dd', '#dfe8ef');
    c.fillStyle = '#6d7f96'; c.beginPath(); c.moveTo(-40, 460); c.lineTo(240, 150); c.lineTo(520, 460); c.closePath(); c.fill();
    c.fillStyle = '#59697e'; c.beginPath(); c.moveTo(420, 460); c.lineTo(700, 110); c.lineTo(1000, 460); c.closePath(); c.fill();
    c.fillStyle = '#eef4f8'; c.beginPath(); c.moveTo(700, 110); c.lineTo(760, 190); c.lineTo(640, 190); c.closePath(); c.fill();
    hill('#4f6b4c', 430, 14, 2);
    c.fillStyle = '#3f5b45'; c.fillRect(0, 470, 1024, 42);
  } else if (key === 'sea') {
    sky('#7fc0ea', '#dff0f8');
    c.fillStyle = '#2f78a8'; c.fillRect(0, 300, 1024, 212);
    for (let i = 0; i < 60; i++) { c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect((i * 53) % 1024, 315 + (i % 8) * 24, 90, 3); }
    c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(0, 298, 1024, 4);
    c.fillStyle = '#f7f2d8'; c.beginPath(); c.arc(820, 150, 46, 0, Math.PI * 2); c.fill();
  } else {                                 // city
    sky('#2a3550', '#6b5a7a');
    for (let i = 0; i < 42; i++) {
      const w = 26 + (i % 5) * 14, h = 90 + ((i * 37) % 260), x = i * 26 - 20;
      c.fillStyle = i % 2 ? '#1d2436' : '#252d42';
      c.fillRect(x, 470 - h, w, h);
      for (let k = 0; k < 24; k++) {
        if ((i * 7 + k * 13) % 3) continue;
        c.fillStyle = 'rgba(255,214,120,.85)';
        c.fillRect(x + 5 + (k % 3) * 9, 470 - h + 10 + ((k / 3) | 0) * 16, 5, 8);
      }
    }
    c.fillStyle = '#141a28'; c.fillRect(0, 470, 1024, 42);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const IMG_FITS = [
  { key: 'fit', name: '사이즈에 맞춤' },
  { key: 'stretch', name: '늘리기' },
  { key: 'tile', name: '바둑판' },
];
const TILE_M = 0.6;                       // 바둑판 한 칸 높이(m)
function applyImgFit(tex, pane, w, h, fit = 'stretch') {
  const iw = tex.image?.width || 1, ih = tex.image?.height || 1;
  const ar = iw / ih;                     // 이미지 가로세로비
  tex.wrapS = tex.wrapT = fit === 'tile' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1); tex.offset.set(0, 0);
  tex.center.set(0.5, 0.5);
  if (fit === 'tile') {
    const th = TILE_M, tw = th * ar;
    tex.repeat.set(Math.max(1, Math.round(w / tw)), Math.max(1, Math.round(h / th)));
  }
  tex.needsUpdate = true;
  if (!pane) return;
  if (fit === 'fit') {                    // 판 자체를 이미지 비율로 줄여 여백을 남긴다
    const k = Math.min(w / ar, h);        // 높이 기준 맞춤
    pane.scale.set((k * ar) / w, k / h, 1);
  } else pane.scale.set(1, 1, 1);
}
function furnMesh(type, it) {
  const f = FURN[type];
  if (f.sizable) {                        // 창문·배너: 벽에 붙는 판
    const w = it?.w ?? f.w, h = it?.h ?? f.h;
    const grp = new THREE.Group();
    const mat = f.transparent
      ? new THREE.MeshPhysicalMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.28, roughness: 0.08, metalness: 0, transmission: 0.6, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.8, side: THREE.DoubleSide });
    let pane = null;
    if (it?.img) {
      const tex = new THREE.TextureLoader().load(it.img, t => applyImgFit(t, pane, w, h, it.fit));
      tex.colorSpace = THREE.SRGBColorSpace;
      mat.map = tex; mat.color.setHex(0xffffff); mat.needsUpdate = true;
    }
    if (it?.img) {                       // 이미지 뒤는 검은 판 (여백이 벽으로 비치지 않게)
      const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }));
      back.position.z = 0.045;
      grp.add(back);
    }
    if (!f.transparent || it?.img) {     // 배너는 판, 창문은 테두리만 (뒤가 뚫려 보인다)
      pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      pane.position.z = 0.052;
      grp.add(pane);
      if (it?.img && mat.map?.image) applyImgFit(mat.map, pane, w, h, it.fit);   // 캐시된 이미지는 즉시
    }
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c242e, roughness: 0.6, metalness: 0.35 });
    for (const [fw, fh, fx, fy] of [[w + 0.1, 0.07, 0, h / 2], [w + 0.1, 0.07, 0, -h / 2], [0.07, h, -w / 2, 0], [0.07, h, w / 2, 0]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.1), frameMat);
      b.position.set(fx, fy, 0.05);
      grp.add(b);
    }
    grp.userData.type = type;
    return grp;
  }
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: f.color, roughness: f.glow ? 0.4 : 0.8, metalness: 0.15,
    emissive: f.glow ? f.color : 0x000000, emissiveIntensity: f.glow ? 0.5 : 0,
  });
  if (type === 'stairs') {               // 계단: 단을 쌓아 만든다
    const steps = 12, sh = f.h / steps, sd = f.d / steps;
    for (let i = 0; i < steps; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(f.w, sh, sd), mat);
      st.position.set(0, sh * (i + 0.5), f.d / 2 - sd * (i + 0.5));
      grp.add(st);
    }
    grp.userData.type = type;
    return grp;
  }
  const body = f.round
    ? new THREE.Mesh(new THREE.CylinderGeometry(f.w / 2, f.w / 2 * (f.mount === 'ceiling' ? 1 : 0.8), f.h, 16), mat)
    : new THREE.Mesh(new THREE.BoxGeometry(f.w, f.h, f.d), mat);
  body.position.y = f.h / 2;
  grp.add(body);
  if (f.mount === 'ceiling') {           // 천장물: 짧은 봉으로 매단다
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 6),
      new THREE.MeshStandardMaterial({ color: 0x39434f, roughness: 0.6 }));
    rod.position.y = f.h + 0.12;
    grp.add(rod);
  }
  if (f.mount === 'wall') {              // 벽걸이: 벽에 밀착되도록 앞으로 반 두께
    body.position.z = f.d / 2;
  }
  if (f.top) {
    const top = new THREE.Mesh(new THREE.BoxGeometry(f.w * 1.1, 0.06, f.d * 1.15),
      new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.6 }));
    top.position.y = f.h + 0.03;
    grp.add(top);
  }
  if (f.glow) grp.userData.lamp = { color: f.color, i: LAMP_I * (f.litW ?? 1), dist: 3, y: f.h * 0.9 };   // 빛은 고정 풀에서 (세기는 litW 비례 · 도달 3m)
  grp.userData.type = type;
  return grp;
}
let srGizmo = null, sizeDrag = null, sizeMode = null;   // 창문·배너 크기 조절 손잡이 (크기 수정 모드에서만)
function clearGizmo() {
  if (!srGizmo) return;
  srScene.remove(srGizmo);
  srGizmo.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  srGizmo = null;
}
function wallItemCorners(it) {            // 벽 위 네 구석 (u = 벽 방향, y = 높이)
  const rm = worldRooms.find(r => r.slot === roomStore.cur);
  if (!rm) return null;
  const f = FURN[it.type];
  const side = wallSideOf(rm, it.x, it.z);
  const zWall = side === 'z+' || side === 'z-';
  const w = it.w ?? f.w, h = it.h ?? f.h;
  const cu = zWall ? it.x : it.z, cy = it.y ?? f.wallY ?? 1.3;
  return { rm, side, zWall, w, h, cu, cy };
}
function gizmoWorld(it, u, y) {           // 벽 좌표 → 월드 좌표 (벽에서 살짝 안쪽)
  const c = wallItemCorners(it);
  if (!c) return null;
  const off = 0.07;
  const inX = c.side === 'x+' ? -off : c.side === 'x-' ? off : 0;
  const inZ = c.side === 'z+' ? -off : c.side === 'z-' ? off : 0;
  const lx = c.zWall ? u : it.x + inX;
  const lz = c.zWall ? it.z + inZ : u;
  return new THREE.Vector3(c.rm.cx + lx, (c.rm.cy || 0) + y, c.rm.cz + lz);
}
function syncGizmo() {                    // 네 구석 손잡이 다시 배치
  clearGizmo();
  if (!srPickSel || sizeMode !== srPickSel || !FURN[srPickSel.type]?.sizable) return;   // 생활모드에서도 쓴다
  const c = wallItemCorners(srPickSel);
  if (!c) return;
  srGizmo = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd76b, depthTest: false, fog: false, toneMapped: false });
  for (const su of [-1, 1]) for (const sy of [-1, 1]) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), mat);
    const p = gizmoWorld(srPickSel, c.cu + su * c.w / 2, c.cy + sy * c.h / 2);
    if (!p) continue;
    box.position.copy(p);
    box.renderOrder = 999;
    box.userData.corner = { u: c.cu - su * c.w / 2, y: c.cy - sy * c.h / 2 };   // 반대쪽 구석(고정점)
    srGizmo.add(box);
  }
  srScene.add(srGizmo);
}
function startSizeEdit() {                // 메뉴 → 크기 수정: 네 구석 손잡이 표시
  if (!srPickSel || !FURN[srPickSel.type]?.sizable) return;
  sizeMode = srPickSel;
  syncGizmo();
  toast('📐 네 구석 손잡이를 끌어 조절 · ESC로 종료');
}
function endSizeEdit() { sizeMode = null; sizeDrag = null; clearGizmo(); }
function applyWallSize(it, u0, y0, u1, y1) {   // 두 구석으로 크기·위치 결정
  const c = wallItemCorners(it);
  if (!c) return false;
  const sl = roomStore.slots[roomStore.cur];
  const wallLen = c.zWall ? roomW(sl) : roomD(sl);
  const w = Math.min(Math.max(SZ_MIN, Math.abs(u1 - u0)), wallLen - 0.4);
  const h = Math.min(Math.max(SZ_MIN, Math.abs(y1 - y0)), ROOM_H - 0.3);
  const lim = Math.max(0, wallLen / 2 - 0.05 - w / 2);
  const cu = Math.max(-lim, Math.min(lim, (u0 + u1) / 2));
  const cy = Math.max(h / 2 + 0.05, Math.min(ROOM_H - 0.05 - h / 2, (y0 + y1) / 2));
  const keep = { w: it.w, h: it.h, x: it.x, z: it.z, y: it.y };
  it.w = +w.toFixed(2); it.h = +h.toFixed(2); it.y = +cy.toFixed(2);
  if (c.zWall) it.x = +cu.toFixed(2); else it.z = +cu.toFixed(2);
  if (wallClash(sl, it.type, it, it)) { Object.assign(it, keep); return false; }
  return true;
}
function syncOutline() {                 // 선택한 가구에 외곽선
  if (srOutline) { srScene.remove(srOutline); srOutline = null; }
  if (!srPickSel || !srFurnGrp) { clearGizmo(); return; }
  const m = srFurnGrp.children.find(o => o.userData.item === srPickSel);
  if (!m) { clearGizmo(); return; }
  srOutline = new THREE.BoxHelper(m, 0xffd76b);
  srOutline.material.depthTest = false;
  srOutline.material.transparent = true;
  srScene.add(srOutline);
  syncGizmo();
}
function footprint(type, rot) {           // 30° 회전까지 감안한 바닥 점유(AABB)
  const f = FURN[type], a = (rot || 0) * ROT_STEP;
  const c = Math.abs(Math.cos(a)), si = Math.abs(Math.sin(a));
  return { w: +(f.w * c + f.d * si).toFixed(3), d: +(f.w * si + f.d * c).toFixed(3) };
}
function itemTop(it) {                    // 그 가구가 내주는 상판 높이 (없으면 null)
  const pv = FURN[it.type].provides;
  return pv && pv.top ? (it.y || 0) + pv.top : null;
}
function hostUnder(it, type) {            // 이 가구 밑에 type이 들어갈 수 있나
  const pv = FURN[it.type].provides;
  if (!pv || !pv.under) return false;
  return FURN[type].h <= pv.under - 0.02;
}
function overlaps(type, rot, x, z, y, skip, list) {   // 같은 높이대에서 겹치는가
  const fp = footprint(type, rot), h = FURN[type].h;
  for (const it of (list ?? curRoom().items)) {
    if (it === skip) continue;
    const f2 = FURN[it.type];
    if (f2.provides?.flat || !f2.blocking && f2.mount !== 'floor') continue;
    const o = footprint(it.type, it.rot);
    const oy = it.y || 0;
    if (y + h <= oy + 0.02 || oy + f2.h <= y + 0.02) continue;   // 높이대가 다르면 통과
    if (Math.abs(x - it.x) < (fp.w + o.w) / 2 - 0.03 && Math.abs(z - it.z) < (fp.d + o.d) / 2 - 0.03) return true;
  }
  return false;
}
function wallSpan(sl, type, it) {         // 벽걸이가 차지하는 (벽, 가로, 높이) 구간
  const f = FURN[type];
  const onX = Math.abs(Math.abs(it.x) - roomW(sl) / 2) < 0.05;
  const w = it.w ?? f.w, h = it.h ?? f.h;
  const u = onX ? it.z : it.x;
  const y = it.y ?? f.wallY ?? 1.3;
  return { wall: onX ? (it.x > 0 ? 'x+' : 'x-') : (it.z > 0 ? 'z+' : 'z-'), u0: u - w / 2, u1: u + w / 2, y0: y - h / 2, y1: y + h / 2 };   // 앞벽·뒷벽을 구분한다
}
function wallClash(sl, type, it, skip) {  // 같은 벽에서 겹치는 벽걸이가 있는가
  const f = FURN[type];
  if (f.mount !== 'wall' && f.mount !== 'opening') return false;
  const a = wallSpan(sl, type, it);
  return sl.items.some(o => {
    if (o === skip || o === it) return false;
    const g = FURN[o.type];
    if (!g || (g.mount !== 'wall' && g.mount !== 'opening')) return false;
    const b = wallSpan(sl, o.type, o);
    return a.wall === b.wall && a.u0 < b.u1 - 0.02 && b.u0 < a.u1 - 0.02 && a.y0 < b.y1 - 0.02 && b.y0 < a.y1 - 0.02;
  });
}
function doorZone(sl, it) {               // 문이 열리고 지나가는 공간 (방 로컬)
  const onX = Math.abs(Math.abs(it.x) - roomW(sl) / 2) < 0.05;
  if (onX) return { x: it.x + (it.x > 0 ? -0.7 : 0.7), z: it.z, w: 1.4, d: DOOR_W + 0.3 };
  return { x: it.x, z: it.z + (it.z > 0 ? -0.7 : 0.7), w: DOOR_W + 0.3, d: 1.4 };
}
function stairZone(it) {                  // 계단 + 오르내리는 앞자리
  const fp = footprint('stairs', it.rot);
  const a = (it.rot || 0) * ROT_STEP, alongZ = Math.abs(Math.cos(a)) > 0.7;
  const pad = FURN.stairs.d / 2 + 0.9;
  return {
    x: it.x - (alongZ ? 0 : Math.sin(a) * pad / 2), z: it.z - (alongZ ? Math.cos(a) * pad / 2 : 0),
    w: fp.w + 0.2 + (alongZ ? 0 : pad), d: fp.d + 0.2 + (alongZ ? pad : 0),
  };
}
function zoneHit(a, b) { return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2; }
function doorStairClash(sl, type, it) {   // 문과 계단은 겹칠 수 없다
  if (type === 'door') return sl.items.some(o => o.type === 'stairs' && zoneHit(doorZone(sl, it), stairZone(o)));
  if (type === 'stairs') return sl.items.some(o => o.type === 'door' && zoneHit(doorZone(sl, o), stairZone(it)));
  return false;
}
function snapPos(type, rot, wx, wz, host = null) {   // 월드 좌표 → 방 로컬 · 격자 · 마그넷 · 상판/하부
  const rm = roomAtPoint(wx, wz);
  const slot = rm ? rm.slot : roomStore.cur;
  const items = roomStore.slots[slot].items;
  const x = wx - (rm ? rm.cx : 0), z = wz - (rm ? rm.cz : 0);
  const rmS = roomStore.slots[slot], W = roomW(rmS), D = roomD(rmS), S = W;
  const f = FURN[type], fp = footprint(type, rot);
  const FRONT = 0.4;                     // 카메라 쪽(+z) 40cm만 비워 둔다 (커서를 그대로 따라가게)
  const zMax = D / 2 - Math.max(FRONT, fp.d / 2);
  if (host && f.place.includes('top')) { // 상판을 직접 맞혔다면 그 위에
    const o = footprint(host.type, host.rot), top = itemTop(host);
    const cx = Math.max(host.x - o.w / 2 + fp.w / 2, Math.min(host.x + o.w / 2 - fp.w / 2, x));
    const cz = Math.max(host.z - o.d / 2 + fp.d / 2, Math.min(host.z + o.d / 2 - fp.d / 2, z));
    return { slot, x: +cx.toFixed(2), z: +cz.toFixed(2), y: +top.toFixed(2), on: host };
  }
  if (f.mount === 'opening' || f.mount === 'wall') {   // 문·벽걸이: 가까운 벽에 붙는다
    const toX = W / 2 - Math.abs(x), toZ = D / 2 - Math.abs(z);
    const onX = toX <= toZ;              // 가까운 벽 — 문도 앞벽(+z)에 달 수 있다
    const lim = (onX ? D : W) / 2 - f.w / 2 - 0.05;   // 벽 방향 길이는 항상 f.w (모서리로 삐져나오지 않게)
    if (onX) {
      const sx = x >= 0 ? 1 : -1;
      return { slot, x: +(sx * W / 2).toFixed(2), z: +Math.max(-lim, Math.min(Math.min(lim, zMax), Math.round(z / GRID) * GRID)).toFixed(2), y: f.wallY ?? 0, rot: sx > 0 ? 9 : 3, wall: true };
    }
    const sz = z >= 0 ? 1 : -1;
    return { slot, x: +Math.max(-lim, Math.min(lim, Math.round(x / GRID) * GRID)).toFixed(2), z: +(sz * D / 2).toFixed(2), y: f.wallY ?? 0, rot: sz > 0 ? 6 : 0, wall: true };
  }
  if (f.mount === 'ceiling') {           // 천장: 격자에만 맞춘다
    const lim = W / 2 - fp.w / 2 - 0.1;
    return {
      slot,
      x: +Math.max(-lim, Math.min(lim, Math.round(x / GRID) * GRID)).toFixed(2),
      z: +Math.max(-lim, Math.min(Math.min(lim, zMax), Math.round(z / GRID) * GRID)).toFixed(2),
      y: +(ROOM_H - f.h).toFixed(2), rot: 0,
    };
  }
  let px = Math.round(x / GRID) * GRID, pz = Math.round(z / GRID) * GRID;
  // 상판/하부에 얹기 — 커서 아래에 받아줄 가구가 있으면 그 위(또는 밑)로
  for (const it of items) {
    if (it === srPickSel) continue;
    const o = footprint(it.type, it.rot);
    if (Math.abs(px - it.x) > o.w / 2 || Math.abs(pz - it.z) > o.d / 2) continue;
    if (f.place.includes('under') && hostUnder(it, type)) {
      return { slot, x: +px.toFixed(2), z: +pz.toFixed(2), y: 0, under: it };
    }
  }
  const lim = { x: W / 2 - fp.w / 2, z: D / 2 - fp.d / 2 };
  px = Math.max(-lim.x, Math.min(lim.x, px));
  pz = Math.max(-lim.z, Math.min(Math.min(lim.z, zMax), pz));
  if (Math.abs(px - lim.x) < SNAP) px = lim.x;
  if (Math.abs(px + lim.x) < SNAP) px = -lim.x;
  if (Math.abs(pz - lim.z) < SNAP) pz = lim.z;
  if (Math.abs(pz + lim.z) < SNAP) pz = -lim.z;
  for (const it of items) {
    if (it === srPickSel) continue;
    const o = footprint(it.type, it.rot);
    const gapX = (fp.w + o.w) / 2, gapZ = (fp.d + o.d) / 2;
    if (Math.abs(pz - it.z) < gapZ - 0.02) {
      if (Math.abs(px - it.x - gapX) < SNAP) px = it.x + gapX;
      if (Math.abs(px - it.x + gapX) < SNAP) px = it.x - gapX;
    }
    if (Math.abs(px - it.x) < gapX - 0.02) {
      if (Math.abs(pz - it.z - gapZ) < SNAP) pz = it.z + gapZ;
      if (Math.abs(pz - it.z + gapZ) < SNAP) pz = it.z - gapZ;
    }
  }
  return { slot, x: +px.toFixed(2), z: +pz.toFixed(2), y: 0 };
}
function placePoint(ev) {                // 커서가 가리키는 배치 지점 (상판이면 그 위)
  if (!srCam) return null;
  srApplyCam();
  const r = renderer.domElement.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const nd = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(nd, srCam);
  if (srFurnGrp) {                       // 가구를 맞혔으면 그 지점을 그대로 쓴다 (커서와 어긋나지 않게)
    for (const h of raycaster.intersectObjects(srFurnGrp.children, true)) {
      if (!h.object.isMesh) continue;    // 선(외곽선·가이드)은 배치 판정에서 제외
      let o = h.object;
      while (o && !o.userData.item) o = o.parent;
      if (!o) continue;
      if (moveItem && o.userData.item === moveItem) continue;   // 옮기는 중인 자기 자신은 무시 (떨림 방지)
      const it = o.userData.item, top = itemTop(it);
      const mine = o.userData.room === roomStore.cur;
      const rr = worldRooms.find(r => r.slot === o.userData.room);
      const up = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld).y > 0.5 : false;
      const onTop = mine && top !== null && up && Math.abs(h.point.y - (top + (rr?.cy || 0))) < 0.25;
      if (!onTop) break;                 // 옆면·앞면이면 그 가구를 무시하고 커서 아래 바닥을 쓴다
      return { p: h.point, host: it };
    }
  }
  // 방 안에서 처음 닿는 면(바닥 또는 벽)을 쓴다 — 벽 너머로 커서를 밀어도 그 자리에 머문다
  const rm = worldRooms.find(r => r.slot === roomStore.cur);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  let best = null;
  const tf = (o.y - (rm ? rm.cy || 0 : 0)) / -d.y;
  if (tf > 0) {
    const p = o.clone().addScaledVector(d, tf);
    const inside = !rm || (Math.abs(p.x - rm.cx) <= rm.w / 2 + 0.01 && Math.abs(p.z - rm.cz) <= rm.d / 2 + 0.01);
    if (inside) return { p, host: null };   // 바닥을 가리키면 그 자리
  }
  if (rm) {
    const planes = [                     // 좌·우·뒷벽만 (카메라 쪽 +z는 벽이 없다)
      { t: (rm.cx + rm.w / 2 - o.x) / d.x }, { t: (rm.cx - rm.w / 2 - o.x) / d.x },
      { t: (rm.cz - rm.d / 2 - o.z) / d.z },
    ];
    for (const pl of planes) {
      if (!(pl.t > 0) || !isFinite(pl.t)) continue;
      const p = o.clone().addScaledVector(d, pl.t);
      const y = p.y - (rm.cy || 0);
      if (y < -0.02 || y > ROOM_H) continue;
      if (Math.abs(p.x - rm.cx) > rm.w / 2 + 0.02 || Math.abs(p.z - rm.cz) > rm.d / 2 + 0.02) continue;
      if (!best || pl.t < best.t) best = { t: pl.t, p };
    }
  }
  if (!best) return null;
  return { p: best.p, host: null };
}
function roomAtPoint() {                 // 편집은 언제나 활성 방에서만
  return worldRooms.find(r => r.slot === roomStore.cur) ?? worldRooms[0] ?? null;
}
function floorPoint(ev) {
  if (!srCam) return null;
  srApplyCam();
  const r = renderer.domElement.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const nd = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(nd, srCam);
  const t = raycaster.ray.origin.y / -raycaster.ray.direction.y;
  if (!(t > 0)) return null;
  return raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, t);
}
function pickFurnCatalog(k) {             // 잠긴 가구는 사거나(코인·헤드) 상자에서 얻어야 한다
  if (furnUsable(k)) { startPlace(k); return; }
  if (FURN_LOOT.includes(k)) { toast('🎁 ' + FURN[k].name + ' — 게임 속 목재상자에서 획득'); return; }
  const hp = headPrice(k);
  if (hp) {                              // 헤드 상품
    if (!spendHeads(hp, FURN[k].name)) return;
    furnOwned.add(k); saveFurnOwned();
    roomRenderUI();
    startPlace(k);
    return;
  }
  const cost = FURN_COST[k] ?? 0;
  if (coins < cost) { toast('코인이 부족합니다 (' + cost.toLocaleString() + '🪙)'); return; }
  coins -= cost;
  setCoinHud();
  persistProgress();
  furnOwned.add(k); saveFurnOwned();
  toast('🛒 ' + FURN[k].name + ' 구매!');
  roomRenderUI();
  startPlace(k);
}
function wallPlaneT(o, d, rm, side) {     // 그 벽 평면까지의 거리
  if (side === 'x+') return (rm.cx + rm.w / 2 - o.x) / d.x;
  if (side === 'x-') return (rm.cx - rm.w / 2 - o.x) / d.x;
  if (side === 'z+') return (rm.cz + rm.d / 2 - o.z) / d.z;
  return (rm.cz - rm.d / 2 - o.z) / d.z;
}
function wallPoint(ev, lockSide) {        // 커서가 가리키는 벽 위의 점 (10cm 격자) · lockSide면 그 벽만
  const rm = worldRooms.find(r => r.slot === roomStore.cur);
  if (!rm || !srCam) return null;
  srApplyCam();
  const r = renderer.domElement.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const nd = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(nd, srCam);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  const hw = rm.w / 2, hd = rm.d / 2, y0 = rm.cy || 0;
  if (lockSide) {                         // 이미 그 벽에서 시작했으면 다른 벽은 잡지 않는다
    const t = wallPlaneT(o, d, rm, lockSide);
    if (!(t > 0.05) || !isFinite(t)) return null;
    const p = o.clone().addScaledVector(d, t);
    const zw = lockSide === 'z+' || lockSide === 'z-';
    const lim2 = (zw ? hw : hd) - 0.05;
    const uu = Math.max(-lim2, Math.min(lim2, zw ? p.x - rm.cx : p.z - rm.cz));
    const yy = Math.max(0.05, Math.min(ROOM_H - 0.05, p.y - y0));
    return { side: lockSide, u: Math.round(uu / GRID) * GRID, y: Math.round(yy / GRID) * GRID };
  }
  let side = null, u = 0;
  const tf = (y0 - o.y) / d.y;            // 1) 바닥을 가리키면 그 지점에서 가장 가까운 벽 (뒤쪽 벽도 고를 수 있다)
  if (isFinite(tf) && tf > 0.05) {
    const p = o.clone().addScaledVector(d, tf);
    const lx = p.x - rm.cx, lz = p.z - rm.cz;
    if (Math.abs(lx) <= hw + 0.8 && Math.abs(lz) <= hd + 0.8) {
      const near = [
        { side: 'x+', dist: Math.abs(hw - lx), u: lz },
        { side: 'x-', dist: Math.abs(-hw - lx), u: lz },
        { side: 'z+', dist: Math.abs(hd - lz), u: lx },
        { side: 'z-', dist: Math.abs(-hd - lz), u: lx },
      ].sort((a, b) => a.dist - b.dist)[0];
      side = near.side; u = near.u;
    }
  }
  let y = null;
  if (!side) {                            // 2) 바닥이 아니면 벽면을 직접 가리킨 것으로 본다
    let best = null;
    const camInside = s2 => s2 === 'x+' ? o.x < rm.cx + hw : s2 === 'x-' ? o.x > rm.cx - hw
      : s2 === 'z+' ? o.z < rm.cz + hd : o.z > rm.cz - hd;
    for (const s2 of ['x+', 'x-', 'z+', 'z-']) {
      if (!camInside(s2)) continue;        // 카메라 바깥쪽 벽(주로 앞벽)은 건너뛴다 — 뒤쪽 벽을 가리킬 수 있게
      const t = wallPlaneT(o, d, rm, s2);
      if (!(t > 0.05) || !isFinite(t)) continue;
      const p = o.clone().addScaledVector(d, t);
      const yy = p.y - y0;
      if (yy < 0.05 || yy > ROOM_H - 0.05) continue;
      const zWall = s2 === 'z+' || s2 === 'z-';
      const uu = zWall ? p.x - rm.cx : p.z - rm.cz;
      if (Math.abs(uu) > (zWall ? hw : hd) - 0.05) continue;
      if (!best || t < best.t) best = { side: s2, u: uu, y: yy, t };
    }
    if (!best) return null;
    side = best.side; u = best.u; y = best.y;
  } else {                                // 고른 벽에서의 높이 (벽면을 함께 가리키면 그 높이)
    const t = wallPlaneT(o, d, rm, side);
    if (t > 0.05 && isFinite(t)) {
      const yy = o.y + d.y * t - y0;
      if (yy > 0.05 && yy < ROOM_H - 0.05) y = yy;
    }
    if (y === null) y = 1.3;
  }
  const zWall = side === 'z+' || side === 'z-';
  const lim = (zWall ? hw : hd) - 0.05;
  u = Math.max(-lim, Math.min(lim, u));
  return { side, u: Math.round(u / GRID) * GRID, y: Math.round(y / GRID) * GRID };
}
let sizeAnchor = null;                    // 창문·배너: 첫 클릭 지점
function sizableGhost(a, b) {             // 두 점으로 만든 사각형
  const w = Math.max(GRID, Math.abs(b.u - a.u)), h = Math.max(GRID, Math.abs(b.y - a.y));
  return { u: (a.u + b.u) / 2, y: (a.y + b.y) / 2, w: +w.toFixed(2), h: +h.toFixed(2) };
}
function wallSideOf(rm, lx, lz) {         // 방 로컬 좌표 → 어느 벽인가
  if (Math.abs(Math.abs(lx) - rm.w / 2) < 0.06) return lx > 0 ? 'x+' : 'x-';
  return lz > 0 ? 'z+' : 'z-';
}
function roomBehindWall(slot, side, lx, lz) {   // 그 벽 너머가 다른 방이면 true (창문 금지)
  const rm = worldRooms.find(r => r.slot === slot);
  if (!rm) return false;
  const n = side === 'x+' ? [1, 0] : side === 'x-' ? [-1, 0] : side === 'z+' ? [0, 1] : [0, -1];
  const px = rm.cx + lx + n[0] * 0.35, pz = rm.cz + lz + n[1] * 0.35;
  for (const r of worldRooms) {
    if (r.slot === rm.slot) continue;
    if (Math.abs((r.cy || 0) - (rm.cy || 0)) > 0.1) continue;
    const q = roomRect(r);
    if (px > q.x0 - 0.02 && px < q.x1 + 0.02 && pz > q.z0 - 0.02 && pz < q.z1 + 0.02) return true;
  }
  return false;
}
function windowBlocked(slot, side, lx, lz) {    // 창문·유리는 맞닿은 방 쪽으로 낼 수 없다
  return roomBehindWall(slot, side, lx, lz);
}
function wallItemPos(side, u, rm) {        // 벽 좌표 → 방 로컬 x/z/rot
  if (side === 'x+') return { x: +(rm.w / 2).toFixed(2), z: +u.toFixed(2), rot: 9 };
  if (side === 'x-') return { x: +(-rm.w / 2).toFixed(2), z: +u.toFixed(2), rot: 3 };
  if (side === 'z+') return { x: +u.toFixed(2), z: +(rm.d / 2).toFixed(2), rot: 6 };   // 앞벽
  return { x: +u.toFixed(2), z: +(-rm.d / 2).toFixed(2), rot: 0 };
}
let placeMark = null;                     // 천장 가구: 바닥에 찍히는 중심 표시
function makePlaceMark(f) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x7df3ff, transparent: true, opacity: 0.75, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.12, f.w / 2 - 0.04), Math.max(0.16, f.w / 2), 28), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  grp.add(ring);
  for (const r of [0, Math.PI / 2]) {     // 십자
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(f.w + 0.2, 0.03), mat);
    bar.rotation.set(-Math.PI / 2, 0, r);
    bar.position.y = 0.021;
    grp.add(bar);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, ROOM_H, 6), mat);   // 바닥↔천장 안내선
  pole.position.y = ROOM_H / 2;
  grp.add(pole);
  return grp;
}
function makeWallCross() {                // 벽 위 시작점 표시 (격자 교차점)
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x7df3ff, fog: false, toneMapped: false });
  for (const [w, h] of [[0.34, 0.02], [0.02, 0.34]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), mat);
    grp.add(b);
  }
  return grp;
}
function startPlace(type) {
  if (srMode === 'live') { srRightFolded = true; syncRightFold(); }   // 놓는 동안 패널을 접는다
  placeType = type; placeRot = 0; setSel(null);
  if (placeMark) { srScene.remove(placeMark); placeMark = null; }
  if (FURN[type].mount === 'ceiling') { placeMark = makePlaceMark(FURN[type]); srScene.add(placeMark); }
  if (FURN[type].sizable) { placeMark = makeWallCross(); srScene.add(placeMark); }
  syncGuides();
  if (placeGhost) srScene.remove(placeGhost);
  placeGhost = furnMesh(type);
  placeGhost.traverse(o => {
    if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; }
  });
  srScene.add(placeGhost);
  syncGuides();
  toast('배치: 클릭 · 회전: R · 취소: ESC');
  roomRenderUI();
}
function cancelPlace() {
  placeType = null; sizeAnchor = null;
  if (placeGhost) placeGhost.visible = true;
  setTimeout(syncGuides, 0);
  if (placeMark) { srScene.remove(placeMark); placeMark = null; }
  if (placeGhost) { srScene.remove(placeGhost); placeGhost = null; }
  syncGuides();
  roomRenderUI();
}
function fitStairs(sl, x, z, rot) {       // 계단 자리 보정 — 발판·도착 지점 앞뒤로 통행 공간을 남긴다
  const W = roomW(sl), D = roomD(sl), f = FURN.stairs;
  const BACK = f.d / 2 + 0.5;            // 계단 아래에서 올라설 공간
  const FRONT = f.d / 2 + 0.9 + 0.3;     // 다 올라선 지점 + 여유
  for (const r2 of [rot, 0, 3, 6, 9]) {
    const a = (r2 || 0) * ROT_STEP;
    const ux = -Math.sin(a), uz = -Math.cos(a);
    const alongZ = Math.abs(uz) > 0.7;                       // 진행 축
    const half = (alongZ ? D : W) / 2, halfP = (alongZ ? W : D) / 2;
    const sign = alongZ ? Math.sign(uz) : Math.sign(ux);     // +1 이면 축 방향으로 오른다
    const lo = -half + BACK, hi = half - FRONT;              // 진행 축에서 가능한 위치 범위
    if (hi - lo < -0.01) continue;                           // 이 방향으로는 공간이 안 나온다
    let t = (alongZ ? z : x) * sign;                         // 오르는 방향 기준 좌표
    t = Math.max(lo, Math.min(hi, t));
    const perpLim = halfP - f.w / 2 - 0.1;
    let pv = alongZ ? x : z;
    pv = Math.max(-perpLim, Math.min(perpLim, pv));
    const along = t * sign;
    return alongZ
      ? { x: +(Math.round(pv / GRID) * GRID).toFixed(2), z: +(Math.round(along / GRID) * GRID).toFixed(2), rot: r2 }
      : { x: +(Math.round(along / GRID) * GRID).toFixed(2), z: +(Math.round(pv / GRID) * GRID).toFixed(2), rot: r2 };
  }
  return null;
}
function commitPlace() {
  if (!placeType || !placeGhost) return;
  const q = placeGhost.userData.snap ?? snapPos(placeType, placeRot, placeGhost.position.x, placeGhost.position.z);
  const rot = q.wall ? q.rot : placeRot;
  const target = roomStore.slots[q.slot ?? roomStore.cur] ?? curRoom();
  if (overlaps(placeType, rot, q.x, q.z, q.y || 0, q.under ?? q.on ?? null, target.items)) { toast('다른 가구와 겹칩니다'); return; }
  let rot2 = rot;
  if (placeType === 'stairs') {          // 계단: 오르내릴 공간이 남도록 방향과 자리를 잡는다
    const fit = fitStairs(target, q.x, q.z, rot2);
    if (!fit) { toast('🚫 방이 좁아 계단을 놓을 수 없습니다 (최소 4m 필요)'); return; }
    q.x = fit.x; q.z = fit.z; rot2 = fit.rot;
  }
  const added = { type: placeType, x: +q.x.toFixed(2), z: +q.z.toFixed(2), y: +(q.y || 0).toFixed(2), rot: rot2 };
  if (doorStairClash(target, placeType, added)) { toast('🚫 문과 계단은 겹칠 수 없습니다'); return; }
  if (wallClash(target, placeType, added)) { toast('🚫 벽에 이미 다른 것이 걸려 있습니다'); return; }
  if (placeType === 'window') {           // 옆방과 맞닿은 벽에는 창문을 낼 수 없다
    const rmW = worldRooms.find(r => r.slot === (q.slot ?? roomStore.cur));
    const side = q.side ?? (rmW ? wallSideOf(rmW, q.x, q.z) : 'z-');
    if (windowBlocked(q.slot ?? roomStore.cur, side, q.x, q.z)) {
      toast('🚫 옆방과 맞닿은 벽에는 창문을 낼 수 없습니다');
      return;
    }
  }
  if (FURN[placeType].sizable && q.w) { added.w = q.w; added.h = q.h; }
  if (FURN[placeType].link) added.link = -1;
  target.items.push(added);
  if (FURN_LOOT.includes(placeType) && !takeFurniture(placeType)) added.free = true;   // 방꾸미기로 공짜로 놓은 것
  roomSave(); refreshRoom(placeType);      // 창문·문은 벽 구멍까지 다시 만든다
  if (added.type === 'door' && added.blocked && added.why === 'closed')
    toast('🚫 폐쇄중인 방이라 이어지지 않습니다 — 폐쇄 해제 후 연결됩니다');
  else if (added.type === 'door' && added.blocked)
    toast(added.why === 'short' ? '🚪 ' + (added.near?.name ?? '옆방') + ' 과 ' + (added.near?.len ?? 0) + 'm만 맞닿았습니다 (' + MIN_LINK + 'm 이상 필요)'
      : added.why === 'offwall' ? '🚪 맞닿은 구간을 벗어났습니다 — 문을 옆으로 옮기세요'
        : '🚪 이 벽 뒤에 방이 없습니다');
  if (added.type === 'stairs' && added.blocked)
    toast(added.why === 'align' ? '🪜 계단이 닿는 자리에 방이 없습니다 — ＋ 새 방으로 만들어 주세요'
      : '🪜 ' + ((added.dir ?? 'up') === 'up' ? '위층' : '아래층') + ' 방이 없습니다 — ＋ 새 방으로 만들어 주세요');
  sfxTone(700, 0.07, 'sine', 0.1);
  const placedType = placeType;
  if (FURN[placedType].link) {            // 문·계단은 놓자마자 연결할 방을 고른다
    cancelPlace();
    setSel(added);
    showCtx(lastCursor[0], lastCursor[1]);
    toast('🚪 연결할 방을 고르세요');
    return;
  }
  toast(FURN[placedType].name + (q.on ? ' — 위에 올림' : q.under ? ' — 아래에 넣음' : '') + ' 배치');
}
function pickFurniture(ev) {
  if (!srFurnGrp || !srCam) return null;
  srApplyCam();
  const r = renderer.domElement.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const nd = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(nd, srCam);
  const targets = [...srFurnGrp.children];
  for (const d of liveDoors) {           // 이어진 문은 문짝이 따로 그려진다 — 그것도 집을 수 있게
    if (!d.panel || !d.panel.visible) continue;
    d.panel.userData.door = d;
    targets.push(d.panel);
  }
  for (const h of raycaster.intersectObjects(targets, true)) {
    if (!h.object.isMesh) continue;      // 외곽선 같은 선은 무시
    let o = h.object;
    while (o && !o.userData.item && !o.userData.door) o = o.parent;
    if (!o) continue;
    const home = srMode === 'live' ? standingSlot() : roomStore.cur;   // 지금 서 있는 방
    if (o.userData.door) {               // 문짝 → 그 문을 놓은 방으로 편집 대상을 옮긴다
      const d = o.userData.door;
      const mine = [roomStore.cur, home];
      if (!mine.includes(d.from) && !mine.includes(d.to)) return null;   // 내 방과 이어진 문만
      if (d.from !== roomStore.cur) { roomStore.cur = d.from; roomRenderUI(); syncGuides(); }
      return d.item;
    }
    const it = o.userData.item;
    if (o.userData.room !== roomStore.cur) {              // 다른 방 물건
      const linked = FURN[it.type]?.link && (it.link === roomStore.cur || it.link === home);   // 이어진 문·계단
      if (o.userData.room !== home && !linked) return null;   // 서 있는 방 물건이거나 이어진 문만
      roomStore.cur = o.userData.room;                    // 그 물건이 속한 방으로 편집 대상을 옮긴다
      roomRenderUI(); syncGuides();
    }
    return it;
  }
  return null;
}
function setSel(it) {
  if (sizeMode && sizeMode !== it) endSizeEdit();   // 다른 것을 고르면 크기 수정 종료
  srPickSel = it; syncOutline(); roomRenderUI(); syncGuides();
  if (it && srMode === 'live') { srRightFolded = true; syncRightFold(); }   // 고르면 패널을 접어 화면을 비운다
}
function startMove() {                    // 고른 가구를 커서로 옮긴다 (승인해야 저장)
  if (!srPickSel) { toast('옮길 가구를 먼저 고르세요'); return; }
  moveItem = srPickSel;
  moveOrig = { x: moveItem.x, z: moveItem.z, y: moveItem.y || 0, rot: moveItem.rot || 0 };
  hideCtx();
  syncGuides();
  toast('🖐 옮길 자리를 클릭 · R 회전 · ESC 취소');
}
function moveTo(wx, wz, host) {
  if (!moveItem) return;
  const q = snapPos(moveItem.type, moveItem.rot || 0, wx, wz, host);
  if (q.slot !== roomStore.cur) return;   // 이 방 안에서만
  moveItem.x = q.x; moveItem.z = q.z; moveItem.y = q.y || 0;
  if (q.wall) moveItem.rot = q.rot;
  const m = srFurnGrp?.children.find(o => o.userData.item === moveItem);
  const rm = worldRooms.find(r => r.slot === roomStore.cur);
  if (m && rm) {
    m.position.set(rm.cx + moveItem.x, (rm.cy || 0) + moveItem.y, rm.cz + moveItem.z);
    m.rotation.y = (moveItem.rot || 0) * ROT_STEP;
  }
  return q;
}
function endMove(ok) {
  if (!moveItem) return;
  if (!ok && moveOrig) Object.assign(moveItem, moveOrig);
  else if (ok && overlaps(moveItem.type, moveItem.rot || 0, moveItem.x, moveItem.z, moveItem.y || 0, moveItem, curRoom().items)) {
    toast('다른 가구와 겹칩니다');
    return;                              // 겹치면 계속 이동 상태
  } else if (ok && doorStairClash(curRoom(), moveItem.type, moveItem)) {
    toast('🚫 문과 계단은 겹칠 수 없습니다');
    return;
  } else if (ok && wallClash(curRoom(), moveItem.type, moveItem, moveItem)) {
    toast('🚫 벽에 이미 다른 것이 걸려 있습니다');
    return;
  }
  const mt = moveItem.type, it = moveItem, was = moveOrig;
  moveItem = null; moveOrig = null;
  if (ok) roomSave();
  refreshRoom(mt);
  if (ok) { setSel(null); hideCtx(); }   // 놓고 나면 선택 해제
  else syncOutline();
  syncGuides();
  toast(ok ? '🖐 이동' : '이동 취소');
}
function cutsWall(type) { return type === 'window' || type === 'door' || type === 'stairs'; }
function refreshRoom(type) { if (cutsWall(type)) buildWorld(); else buildFurnitureAll(); }
function removeSelected() {
  if (!srPickSel) { toast('제거할 가구를 먼저 고르세요'); return; }
  const item = srPickSel, arr = curRoom().items, i = arr.indexOf(item);
  if (i >= 0) { arr.splice(i, 1); returnFurniture(item); }
  setSel(null);
  roomSave(); refreshRoom(item.type); hideCtx();
  toast('🗑 ' + FURN[item.type].name + ' 제거');
}
function removeSameType() {               // 같은 종류를 이 방에서 모두 제거
  if (!srPickSel) { toast('기준이 될 가구를 먼저 고르세요'); return; }
  if (FURN[srPickSel.type].link) { toast('문·계단은 하나씩 제거해 주세요'); return; }
  const type = srPickSel.type, arr = curRoom().items;
  const gone = arr.filter(it => it.type === type);
  if (!gone.length) return;
  for (const it of gone) returnFurniture(it);
  curRoom().items = arr.filter(it => it.type !== type);
  setSel(null);
  roomSave(); refreshRoom(type); hideCtx();
  toast('🧹 ' + FURN[type].name + ' ' + gone.length + '개 제거');
}
function rotateCurrent() {
  if (placeType) { placeRot = (placeRot + 1) % ROT_N; return; }   // 30°씩
  if (srPickSel) {
    if (FURN[srPickSel.type].rotate !== 'free') { toast('이 가구는 설치면에 고정됩니다'); return; }
    const it = srPickSel, rm = worldRooms.find(r => r.slot === roomStore.cur);
    const keep = { rot: it.rot || 0, x: it.x, z: it.z };
    it.rot = (keep.rot + 1) % ROT_N;
    const p = snapPos(it.type, it.rot, (rm ? rm.cx : 0) + it.x, (rm ? rm.cz : 0) + it.z);   // 제자리에서 돌린다
    it.x = p.x; it.z = p.z;
    if (overlaps(it.type, it.rot, it.x, it.z, it.y || 0, it, curRoom().items) || doorStairClash(curRoom(), it.type, it)) {
      Object.assign(it, keep);           // 돌리면 겹친다 — 원래대로
      toast('🚫 그 방향으로는 자리가 좁습니다');
      return;
    }
    roomSave();
    refreshRoom(it.type);
    return;
  }
  toast('회전할 가구를 고르세요');
}
function resetRooms() {                   // 방 전체 초기화 (4×4 한 칸으로)
  for (const sl of roomStore.slots) for (const it of sl.items) returnFurniture(it);   // 파밍 가구는 돌려준다
  roomStore.slots = [{ name: 'MY ROOM', w: ROOM_MIN, d: ROOM_MIN, gx: -ROOM_MIN / 2, gz: -ROOM_MIN / 2, gy: 0, bg: 'forest', surf: newSurf(), items: [] }];   // 맵 한가운데
  roomStore.cur = 0;
  setSel(null); cancelPlace(); hideCtx();
  roomSave(); buildWorld(); roomRenderUI();
  toast('🧨 방을 초기화했습니다 (4×4)');
}
function standingSlot() {                 // 생활모드면 지금 서 있는 방, 아니면 편집 중인 방
  if (srMode !== 'live') return roomStore.cur;
  const here = insideRooms(live.x, live.z);
  return here >= 0 ? here : (live.active ?? roomStore.cur);
}
function stripLinks(idx) {                // 그 방의 문·계단과 그 방을 향한 문·계단을 없앤다
  const me = roomStore.slots[idx];
  if (!me) return 0;
  const isLink = it => !!FURN[it.type]?.link;
  let cut = me.items.filter(isLink).length;
  me.items = me.items.filter(it => !isLink(it));
  roomStore.slots.forEach((sl, i) => {
    if (i === idx) return;
    const before = sl.items.length;
    sl.items = sl.items.filter(it => !(isLink(it) && it.link === idx));
    cut += before - sl.items.length;
  });
  return cut;
}
function closeRoom(which) {               // 서 있는 방(또는 지정한 방) 폐쇄 — 문·계단은 없앤다
  const idx = Number.isInteger(which) ? which : standingSlot(), me = roomStore.slots[idx];
  if (!me) return;
  if (idx === 0) { toast('🏠 기본 방(' + roomStore.slots[0].name + ')은 폐쇄할 수 없습니다'); return; }
  if (me.closed) {                        // 다시 열기 (문·계단은 다시 놓아야 한다)
    if (!rectFree(slotRect(me), idx)) { toast('🚫 그 자리에 다른 방이 들어와 있습니다 — 먼저 옮겨 주세요'); return; }
    me.closed = false;
    roomSave(); buildWorld(); roomRenderUI();
    toast('🔓 ' + me.name + ' 폐쇄 해제 — 문·계단을 다시 놓아 연결하세요');
    return;
  }
  const cut = stripLinks(idx);            // 문·계단 제거
  me.closed = true;
  if (roomStore.cur !== idx) roomStore.cur = idx;
  setSel(null); cancelPlace(); hideCtx();
  roomSave(); buildWorld(); roomRenderUI();
  toast('🚫 ' + me.name + ' 폐쇄 — 문·계단 ' + cut + '개 제거');
}
function clearRoom() {                    // 다른 방과 이어진 문·계단은 남긴다
  const me = curRoom();
  const keep = me.items.filter(it => (it.type === 'door' || it.type === 'stairs')
    && Number.isInteger(it.link) && it.link >= 0 && it.link < roomStore.slots.length && it.link !== roomStore.cur);
  const removed = me.items.length - keep.length;
  if (!removed) { toast(keep.length ? '연결된 문·계단만 남아 있습니다' : '이미 비어 있습니다'); return; }
  for (const it of me.items) if (!keep.includes(it)) returnFurniture(it);   // 파밍 가구는 보관함으로
  me.items = keep;
  setSel(null); roomSave(); buildWorld();
  toast('🧹 가구 ' + removed + '개 정리 — 연결된 문·계단은 남겨둠');
}
function resizeRoomItems(sl, newW, newD, growX = 1, growZ = 1) {   // 크기가 바뀐 만큼만 보정 (방을 옮기면 가구도 같이 따라간다)
  const w0 = roomW(sl), d0 = roomD(sl);
  const shiftX = ((newW - w0) / 2) * growX;               // 늘어난 쪽에 따라 방 중심이 옮겨진 만큼
  const shiftZ = ((newD - d0) / 2) * growZ;
  if (newW === w0 && newD === d0) return;
  for (const it of sl.items) {
    const f = FURN[it.type];
    if (!f) continue;
    const onWall = f.mount === 'wall' || f.mount === 'opening';
    const pinX = onWall && Math.abs(Math.abs(it.x) - w0 / 2) < 0.06 ? Math.sign(it.x) : 0;
    const pinZ = onWall && Math.abs(Math.abs(it.z) - d0 / 2) < 0.06 ? Math.sign(it.z) : 0;
    if (pinX) it.x = +(pinX * newW / 2).toFixed(2);        // 좌·우 벽에 붙은 것은 그 벽을 따라간다
    else it.x = +(it.x - shiftX).toFixed(2);               // 나머지는 월드 위치 유지
    if (pinZ) it.z = +(pinZ * newD / 2).toFixed(2);        // 뒷벽에 붙은 것
    else it.z = +(it.z - shiftZ).toFixed(2);
    const lim = { x: newW / 2 - 0.1, z: newD / 2 - 0.1 };  // 방 밖으로 나가지 않게
    if (!pinX) it.x = +Math.max(-lim.x, Math.min(lim.x, it.x)).toFixed(2);
    if (!pinZ) it.z = +Math.max(-lim.z, Math.min(lim.z, it.z)).toFixed(2);
  }
}
function growDir(sl, axis) {              // 어느 쪽으로 늘릴 수 있나 (+1: 오른쪽/아래, -1: 왼쪽/위, 0: 불가)
  const i = roomStore.slots.indexOf(sl);
  const w = roomW(sl), d = roomD(sl);
  if ((axis === 'w' ? w : d) >= ROOM_MAX) return 0;
  for (const dir of (axis === 'd' ? [-1, 1] : [1, -1])) {   // 세로는 뒤(-z)부터 시도
    const ov = axis === 'w'
      ? { slot: i, gx: (sl.gx || 0) - (dir < 0 ? ROOM_STEP : 0), w: w + ROOM_STEP, d }
      : { slot: i, gz: (sl.gz || 0) - (dir < 0 ? ROOM_STEP : 0), d: d + ROOM_STEP, w };
    const rect = slotRect(sl, ov);
    if (!rectPlaceable(rect, i)) continue;
    let keep = true;                      // 넓혀도 지금 연결이 남아야 한다
    for (const it of sl.items) {
      if (it.type !== 'door' || !(it.link >= 0)) continue;
      const nb = roomStore.slots[it.link];
      if (!nb) continue;
      const wl = wallBetween(rect, slotRect(nb));
      if (!wl || wl.len < MIN_LINK - 0.01) { keep = false; break; }
    }
    if (keep) return dir;
  }
  return 0;
}
function canExpand(axis) { return growDir(curRoom(), axis) !== 0; }
function growBlockers(sl, axis) {         // 어느 방이 막고 있나 [{side, names[]}]
  const i = roomStore.slots.indexOf(sl);
  const w = roomW(sl), d = roomD(sl), out = [];
  for (const dir of [1, -1]) {
    const ov = axis === 'w'
      ? { slot: i, gx: (sl.gx || 0) - (dir < 0 ? ROOM_STEP : 0), w: w + ROOM_STEP, d }
      : { slot: i, gz: (sl.gz || 0) - (dir < 0 ? ROOM_STEP : 0), d: d + ROOM_STEP, w };
    const rect = slotRect(sl, ov);
    const names = roomStore.slots.filter((o, j) => j !== i && rectsHit(rect, slotRect(o))).map(o => o.name);
    if (names.length) out.push({ side: axis === 'w' ? (dir > 0 ? '오른쪽' : '왼쪽') : (dir > 0 ? '아래쪽' : '위쪽'), names });
  }
  return out;
}
function growBlockMsg(sl, axis) {
  const b = growBlockers(sl, axis);
  if (!b.length) return '🚫 연결이 끊겨 넓힐 수 없습니다';
  return '🚫 ' + b.map(x => x.side + ' ' + x.names.join('·')).join(', ') + ' 때문에 넓힐 수 없습니다 — 그 방을 먼저 옮겨 주세요';
}
function expandRoom(axis) {               // 가로(w) 또는 세로(d)를 2m 늘린다 — 줄이기는 없음
  const room = curRoom();
  const cur = axis === 'w' ? roomW(room) : roomD(room);
  if (cur >= ROOM_MAX) { toast('이미 최대 ' + ROOM_MAX + 'm 입니다'); return; }
  const dir = growDir(room, axis);
  if (!dir) { toast(growBlockMsg(room, axis)); return; }
  if (!decoMode && coins < EXPAND_COST) { toast('코인이 부족합니다 (' + EXPAND_COST.toLocaleString() + '🪙)'); return; }
  const newW = axis === 'w' ? cur + ROOM_STEP : roomW(room), newD = axis === 'd' ? cur + ROOM_STEP : roomD(room);
  const newGx = (room.gx || 0) - (axis === 'w' && dir < 0 ? ROOM_STEP : 0);
  const newGz = (room.gz || 0) - (axis === 'd' && dir < 0 ? ROOM_STEP : 0);
  resizeRoomItems(room, newW, newD, axis === 'w' ? dir : 1, axis === 'd' ? dir : 1);
  room.gx = newGx; room.gz = newGz;
  room[axis] = cur + ROOM_STEP;
  if (!decoMode) {                       // 방꾸미기 모드에서는 공짜
    coins -= EXPAND_COST;
    setCoinHud();
    persistProgress();
  }
  roomSave(); buildWorld(); roomRenderUI();
  toast('🏠 ' + roomW(room) + 'm × ' + roomD(room) + 'm 로 확장 (' + (axis === 'w' ? (dir > 0 ? '오른쪽' : '왼쪽') : (dir > 0 ? '아래쪽' : '위쪽')) + ')');
}
let addState = null;                     // 새 방 배치 중 {w,d,gx,gz,gy,stair}
function addRoomSlot(link) {             // 새 방 — 미니맵에서 자리를 잡아 배치한다
  const cost = decoMode ? 0 : slotCost();
  const me0 = curRoom();
  const gy0 = (me0.gy || 0) + (link && link.type === 'stairs' ? ((link.dir ?? 'up') === 'up' ? 1 : -1) : 0);
  if (floorFull(gy0)) { toast('🚫 ' + gyName(gy0) + '은 방 ' + ROOMS_PER_FLOOR + '개가 꽉 찼습니다'); return null; }
  if (coins < cost) {
    toast('🪙 코인이 부족합니다 — ' + cost.toLocaleString() + ' 필요 (보유 ' + coins.toLocaleString() + ')');
    return null;
  }
  const me = curRoom();
  const stair = link && link.type === 'stairs' ? link : null;
  const door = link && link.type === 'door' ? link : null;
  const gy = (me.gy || 0) + (stair ? ((stair.dir ?? 'up') === 'up' ? 1 : -1) : 0);
  const st = { w: ROOM_MIN, d: ROOM_MIN, gy, stair, door, from: roomStore.cur, cost };
  if (stair) {                           // 계단이 닿는 자리(발판·도착점)를 덮도록 시작 위치
    const t = stairsToLevel(gy).find(c => c.item === stair);
    if (t) { st.gx = Math.round((t.sx + t.tx) / 2 - st.w / 2); st.gz = Math.round((t.sz + t.tz) / 2 - st.d / 2); }
    else { st.gx = (me.gx || 0); st.gz = (me.gz || 0); }
  } else if (door) {                     // 문이 있는 벽에 문 위치를 맞춰서 시작
    const onX = Math.abs(Math.abs(door.x) - roomW(me) / 2) < 0.05;
    if (onX) {
      const side = door.x >= 0 ? 1 : -1;
      st.gx = side > 0 ? (me.gx || 0) + roomW(me) : (me.gx || 0) - st.w;
      st.gz = Math.round((me.gz || 0) + roomD(me) / 2 + (door.z || 0) - st.d / 2);
    } else {                             // 뒷벽(-z)에 달린 문
      st.gx = Math.round((me.gx || 0) + roomW(me) / 2 + (door.x || 0) - st.w / 2);
      st.gz = (me.gz || 0) - st.d;
    }
  } else {                               // 오른쪽 벽에 붙여서 시작
    st.gx = (me.gx || 0) + roomW(me);
    st.gz = (me.gz || 0);
  }
  addState = st;
  fitAddRoom();
  openAddMap();
  return null;
}
function fitAddRoom() {                  // 쓸 수 없는 자리면 가까운 자리를 찾아본다
  const st = addState;
  if (!st || addRoomCheck().ok) return;
  const gx0 = st.gx, gz0 = st.gz;
  for (let k = 1; k <= 12; k++) {
    for (let dx = -k; dx <= k; dx++) {
      for (let dz = -k; dz <= k; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== k) continue;
        st.gx = gx0 + dx; st.gz = gz0 + dz;
        if (addRoomCheck().ok) return;
      }
    }
  }
  st.gx = gx0; st.gz = gz0;
}
function stairsToLevel(gy) {             // 이 층으로 통하는 계단 후보
  const out = [];
  roomStore.slots.forEach((sl, i) => {
    for (const it of sl.items) {
      if (it.type !== 'stairs') continue;
      const goUp = (it.dir ?? 'up') === 'up';
      if ((sl.gy || 0) + (goUp ? 1 : -1) !== gy) continue;
      const R = slotRect(sl);
      const sx = R.x0 + roomW(sl) / 2 + it.x, sz = R.z0 + roomD(sl) / 2 + it.z;
      const a = (it.rot || 0) * ROT_STEP;
      out.push({
        slot: i, item: it, goUp, sx, sz,
        tx: sx - Math.sin(a) * (FURN.stairs.d / 2 + 0.9), tz: sz - Math.cos(a) * (FURN.stairs.d / 2 + 0.9),
      });
    }
  });
  return out;
}
const STAIR_CLEAR = 0.5;                 // 계단 끝과 벽 사이 최소 여유(m)
function stairCovered(rect, t) {         // 방이 계단이 닿는 자리를 덮는가
  const has = (x, z, m) => x > rect.x0 + m && x < rect.x1 - m && z > rect.z0 + m && z < rect.z1 - m;
  return has(t.sx, t.sz, 0.05) && has(t.tx, t.tz, STAIR_CLEAR);   // 오를 때도 내려설 때도 벽에서 50cm 이상
}
function stairPoints(rect, gy, it) {     // 이 방이 가진 계단이 닿는 지점
  const sx = (rect.x0 + rect.x1) / 2 + it.x, sz = (rect.z0 + rect.z1) / 2 + it.z;
  const a = (it.rot || 0) * ROT_STEP, goUp = (it.dir ?? 'up') === 'up';
  return {
    sx, sz, goUp, wantGy: gy + (goUp ? 1 : -1),
    tx: sx - Math.sin(a) * (FURN.stairs.d / 2 + 0.9), tz: sz - Math.cos(a) * (FURN.stairs.d / 2 + 0.9),
  };
}
function ownStairTargets(rect, gy, sl, skip) {   // 이 방의 계단이 닿는 다른 방들
  const out = [];
  for (const it of sl.items) {
    if (it.type !== 'stairs') continue;
    const pts = stairPoints(rect, gy, it);
    roomStore.slots.forEach((o, j) => {
      if (j === skip || (o.gy || 0) !== pts.wantGy) return;
      if (stairCovered(slotRect(o), pts)) out.push({ slot: j, pts });
    });
  }
  return out;
}
function openLayoutEdit(slot) {           // 이미 있는 방을 옮긴다
  const i = Number.isInteger(slot) ? slot : roomStore.cur;
  const sl = roomStore.slots[i];
  if (!sl) return;
  addState = { edit: i, w: roomW(sl), d: roomD(sl), gx: sl.gx || 0, gz: sl.gz || 0, gy: sl.gy || 0, from: i, cost: 0 };
  openAddMap();
}
function editCost() {                     // 편집 창에서 늘린 만큼의 비용
  const st = addState;
  if (!st || st.edit === undefined) return 0;
  const sl = roomStore.slots[st.edit];
  const steps = Math.max(0, (st.w - roomW(sl)) / ROOM_STEP) + Math.max(0, (st.d - roomD(sl)) / ROOM_STEP);
  return Math.round(steps) * EXPAND_COST;
}
function applyLayoutEdit() {
  const st = addState, chk = addRoomCheck();
  if (!st || !chk.ok) { toast(chk.note || '자리를 정해주세요'); return; }
  if (!openLevel(st.gy || 0)) return;     // 무료 범위 밖 층은 헤드로 연다
  const sl = roomStore.slots[st.edit], cost = editCost();
  if (coins < cost) { toast('🪙 코인이 부족합니다 — ' + cost.toLocaleString() + ' 필요 (보유 ' + coins.toLocaleString() + ')'); return; }
  const grew = st.w !== roomW(sl) || st.d !== roomD(sl);
  const moved = st.gx !== (sl.gx || 0) || st.gz !== (sl.gz || 0);
  resizeRoomItems(sl, st.w, st.d, st.growX ?? 1, st.growZ ?? 1);
  sl.gx = st.gx; sl.gz = st.gz; sl.w = st.w; sl.d = st.d;
  const cut = moved ? stripLinks(st.edit) : 0;   // 자리를 옮기면 문·계단은 없앤다
  let opened = false;
  if (st.reopen) {                        // 폐쇄했던 방을 다시 연다
    if (floorFull(st.gy || 0)) { toast('🚫 ' + gyName(st.gy || 0) + '은 방 ' + ROOMS_PER_FLOOR + '개가 꽉 찼습니다'); return; }
    sl.closed = false; opened = true;
    const nb2 = neighbours(slotRect(sl), st.edit)[0];
    if (nb2) autoDoor(st.edit, nb2.slot);
  }
  if (cost) { coins -= cost; setCoinHud(); persistProgress(); }
  const keepFrame = st.frame, idx = st.edit;
  roomSave(); buildWorld(); roomRenderUI(); srRenderModeUI();
  openLayoutEdit(idx);                    // 적용해도 창은 열어 둔다 (이어서 배치 가능)
  if (addState) { addState.frame = keepFrame; drawAddMap(); }
  toast((opened ? '🔓 ' : '🏠 ') + sl.name + (opened ? ' 다시 열림' : '') + (moved ? ' 이동' : '') + (grew ? ' · ' + st.w + '×' + st.d + 'm' : '')
    + (cost ? ' (' + cost.toLocaleString() + '🪙)' : '') + (cut ? ' · 문·계단 ' + cut + '개 제거' : ''));
}
function editRoomClose() {                // 편집 창에서 폐쇄/해제
  const st = addState;
  if (!st || st.edit === undefined) return;
  const i = st.edit;
  if (i === 0) { toast('🏠 기본 방은 폐쇄할 수 없습니다'); return; }
  const keepFrame = st.frame;
  closeRoom(i);                           // 배치 창에서 고른 방을 폐쇄한다
  openLayoutEdit(i);
  addState.frame = keepFrame;
  drawAddMap();
}
function editNewRoom() {                  // 편집 창에서 바로 새 방 만들기
  const gy = addState ? addState.gy : 0;
  const keepFrame = addState ? addState.frame : null;
  if (floorFull(gy)) { toast('🚫 ' + gyName(gy) + '은 방 ' + ROOMS_PER_FLOOR + '개가 꽉 찼습니다'); return; }
  const cost = slotCost();
  if (coins < cost) { toast('🪙 코인이 부족합니다 — ' + cost.toLocaleString() + ' 필요 (보유 ' + coins.toLocaleString() + ')'); return; }
  addState = { w: ROOM_MIN, d: ROOM_MIN, gy, from: roomStore.cur, cost, gx: 0, gz: 0, frame: keepFrame };
  const me = roomStore.slots.find(sl => (sl.gy || 0) === gy) ?? curRoom();
  addState.gx = (me.gx || 0) + roomW(me); addState.gz = (me.gz || 0);
  fitAddRoom();
  drawAddMap();
  toast('＋ 새 방 자리를 정하세요');
}
function addRoomCheck() {                // 지금 자리 + 층 개방 비용까지
  const r = addRoomCheckBase();
  const gy = addState ? (addState.gy || 0) : 0;
  if (r.ok && !levelOpen(gy)) r.note = '🔒 ' + gyName(gy) + ' 개방 헤드 ' + fmt(HEAD_FLOOR) + '개 · ' + r.note;
  return r;
}
function addRoomCheckBase() {            // 지금 자리를 쓸 수 있는가
  const st = addState;
  if (!st) return { ok: false, note: '' };
  const rect = slotRect(st);
  if (!rectFree(rect, st.edit ?? -1)) return { ok: false, note: '🚫 다른 방과 겹칩니다' };
  if (st.edit !== 0 && frontOfBase(rect)) return { ok: false, note: '🚫 MY ROOM 앞쪽으로는 방을 만들 수 없습니다' };
  if (!inMap(rect)) return { ok: false, note: '🚫 층 맵(30×30m)을 벗어납니다' };
  if (st.edit !== undefined) {           // 옮기는 방: 벽이나 계단으로 이어져 있어야 한다
    const me = roomStore.slots[st.edit];
    const nb = neighbours(rect, st.edit);
    const up = stairsToLevel(st.gy).filter(t => t.slot !== st.edit && stairCovered(rect, t));   // 다른 방 계단이 이 방으로
    const mine = ownStairTargets(rect, st.gy, me, st.edit);                                     // 이 방 계단이 다른 방으로
    const keep = j => nb.some(n => n.slot === j) || up.some(t => t.slot === j) || mine.some(t => t.slot === j);
    const lost = [];
    roomStore.slots.forEach((o, j) => {
      if (j === st.edit) return;
      const had = o.items.some(it => FURN[it.type]?.link && it.link === st.edit)
        || me.items.some(it => FURN[it.type]?.link && it.link === j);
      if (had && !keep(j)) lost.push(o.name);
    });
    const links = [...nb.map(n => roomStore.slots[n.slot].name + ' ' + n.wall.len.toFixed(0) + 'm'),
      ...up.map(t => '🪜' + roomStore.slots[t.slot].name), ...mine.map(t => '🪜' + roomStore.slots[t.slot].name)];
    if (roomStore.slots.length > 1 && !links.length && st.edit !== 0 && !st.reopen)
      return { ok: false, note: '🚫 벽이 ' + MIN_LINK + 'm 이상 맞닿거나 계단으로 이어져야 합니다' };
    return {
      ok: true,
      note: (links.length ? '🔗 ' + links.join(' · ') : '독립된 자리') + (lost.length ? ' · ' + lost.join(', ') + ' 연결은 끊깁니다' : ''),
    };
  }
  const nb = neighbours(rect, -1);
  if (nb.length) return { ok: true, note: '🚪 ' + nb.map(n => roomStore.slots[n.slot].name + ' ' + n.wall.len.toFixed(0) + 'm').join(' · ') + ' 와 연결' };
  const cand = stairsToLevel(st.gy).filter(t => !st.stair || t.item === st.stair);
  const hit = cand.find(t => stairCovered(rect, t));
  if (hit) return { ok: true, note: '🪜 ' + roomStore.slots[hit.slot].name + ' 의 계단과 이어집니다' };
  if (cand.length) return { ok: false, note: '🚫 계단이 닿는 자리를 덮어야 합니다' };
  return { ok: false, note: '🚫 벽이 ' + MIN_LINK + 'm 이상 맞닿아야 연결됩니다' };
}
function confirmAddRoom() {
  const st = addState, chk = addRoomCheck();
  if (!st || !chk.ok) { toast(chk.note || '자리를 정해주세요'); return; }
  if (!decoMode && coins < st.cost) { toast('코인이 부족합니다'); return; }
  if (floorFull(st.gy || 0)) { toast('🚫 ' + gyName(st.gy || 0) + '은 방 ' + ROOMS_PER_FLOOR + '개가 꽉 찼습니다'); return; }
  if (!openLevel(st.gy || 0)) return;     // 무료 범위 밖 층은 헤드로 연다
  const idx = roomStore.slots.length;
  roomStore.slots.push({ name: 'ROOM ' + (idx + 1), w: st.w, d: st.d, gx: st.gx, gz: st.gz, gy: st.gy, bg: 'forest', surf: newSurf(), items: [] });
  if (st.stair) { st.stair.link = idx; st.stair.blocked = false; }
  else if (st.door) {                    // 놓아둔 문을 그대로 잇는다
    st.door.link = idx;
    buildWorld();
    if (st.door.blocked) {               // 문이 맞닿은 구간을 벗어났다 → 새 자리에 문을 낸다
      const nb = neighbours(slotRect(st), idx)[0];
      if (nb) { autoDoor(idx, nb.slot); toast('🚪 문이 맞지 않아 맞닿은 자리에 새 문을 놓았습니다'); }
    }
  } else {
    const nb = neighbours(slotRect(st), idx)[0];
    if (nb) autoDoor(idx, nb.slot);      // 가장 넓게 맞닿은 쪽에 문
  }
  coins -= st.cost;
  setCoinHud();
  persistProgress();
  closeAddMap();
  roomSave(); buildWorld(); roomRenderUI(); srRenderModeUI();
  toast('🏠 새 방 (' + st.cost.toLocaleString() + '🪙) — ' + roomStore.slots[idx].name);
}
function openAddMap() {
  const el = document.getElementById('addRoom');
  if (!el) return;
  el.classList.add('on');
  hideCtx();
  drawAddMap();
}
function closeAddMap() { addState = null; document.getElementById('addRoom')?.classList.remove('on'); }
function addMapFrame() {                 // 층 맵 30×30m 을 캔버스 가운데에 같은 배율로
  const cv = document.getElementById('addMap');
  const span = VIEW_HALF * 2;
  const k = Math.min(cv.width, cv.height) / span;
  return {
    x0: -VIEW_HALF - (cv.width - span * k) / 2 / k,     // 40×40 보기의 왼쪽 끝
    z0: -VIEW_HALF - (cv.height - span * k) / 2 / k,
    k,                                   // 1m = k px
  };
}
function addMapView() {                  // 화면 범위(고정) ↔ 캔버스 좌표
  if (!addState) return { x0: 0, z0: 0, k: 10, px: x => x, pz: z => z, mx: c => c, mz: c => c };
  if (!addState.frame) addState.frame = addMapFrame();
  const f = addState.frame;
  return { ...f, px: x => (x - f.x0) * f.k, pz: z => (z - f.z0) * f.k, mx: cx => cx / f.k + f.x0, mz: cz => cz / f.k + f.z0 };
}
function renderAddList() {               // 배치 창 오른쪽: 이 층의 방 목록
  const el = document.getElementById('addList');
  if (!el || !addState) return;
  const gy = addState.gy;
  const rows = roomStore.slots.map((sl, i) => ({ sl, i })).filter(o => (o.sl.gy || 0) === gy);
  el.innerHTML = '<div class="alHead">' + gyName(gy) + ' 방 ' + floorCount(gy) + '/' + ROOMS_PER_FLOOR + '</div>'
    + (rows.length ? rows.map(o =>
      `<button data-room="${o.i}" class="${o.i === addState.edit ? 'on' : ''}${o.sl.closed ? ' closed' : ''}">${o.sl.name}`
      + `<i>${o.sl.closed ? '폐쇄중' : roomW(o.sl) + '×' + roomD(o.sl) + 'm'}</i></button>`).join('')
      : '<div class="alNone">이 층에는 방이 없습니다</div>');
  for (const b of el.querySelectorAll('[data-room]')) {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const i = +b.dataset.room;
      const wasClosed = !!roomStore.slots[i].closed;
      if (wasClosed && floorFull(addState.gy)) { toast('🚫 ' + gyName(addState.gy) + '은 방 ' + ROOMS_PER_FLOOR + '개가 꽉 찼습니다'); return; }
      const keep = addState.frame;
      openLayoutEdit(i);
      if (addState) { addState.frame = keep; addState.reopen = wasClosed; drawAddMap(); }
      toast(wasClosed ? '🔓 ' + roomStore.slots[i].name + ' — 자리를 정하고 적용하면 다시 열립니다'
        : '✎ ' + roomStore.slots[i].name + ' — 끌어서 옮기세요');
    });
  }
}
function drawAddMap() {
  const cv = document.getElementById('addMap');
  if (!cv || !addState) return;
  const c = cv.getContext('2d'), v = addMapView();
  c.fillStyle = '#071019'; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = 'rgba(26,30,34,.82)';                           // 설치 금지 — 맵 바깥
  const bx0 = v.px(BUILD_R.x0), bx1 = v.px(BUILD_R.x1), bz0 = v.pz(BUILD_R.z0), bz1 = v.pz(BUILD_R.z1);
  c.fillRect(0, 0, cv.width, bz0);                              // 위
  c.fillRect(0, bz1, cv.width, cv.height - bz1);                // 아래
  c.fillRect(0, bz0, bx0, bz1 - bz0);                           // 왼쪽
  c.fillRect(bx1, bz0, cv.width - bx1, bz1 - bz0);              // 오른쪽
  c.strokeStyle = 'rgba(150,165,180,.55)'; c.lineWidth = 1.5;
  c.strokeRect(bx0, bz0, bx1 - bx0, bz1 - bz0);                 // 설치 가능 경계
  c.strokeStyle = 'rgba(64,214,255,.14)'; c.lineWidth = 1;      // 1m 격자
  for (let x = Math.ceil(v.x0); x <= v.mx(cv.width); x++) { c.beginPath(); c.moveTo(v.px(x), 0); c.lineTo(v.px(x), cv.height); c.stroke(); }
  for (let z = Math.ceil(v.z0); z <= v.mz(cv.height); z++) { c.beginPath(); c.moveTo(0, v.pz(z)); c.lineTo(cv.width, v.pz(z)); c.stroke(); }
  c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 1;      // 10m 굵은 흰 선 (픽셀에 딱 맞춰 또렷하게)
  const snap = n => Math.round(n) + 0.5;
  for (let x = BUILD_R.x0; x <= BUILD_R.x1 + 0.001; x += 10) {
    c.beginPath(); c.moveTo(snap(v.px(x)), v.pz(BUILD_R.z0)); c.lineTo(snap(v.px(x)), v.pz(BUILD_R.z1)); c.stroke();
  }
  for (let z = BUILD_R.z0; z <= BUILD_R.z1 + 0.001; z += 10) {
    c.beginPath(); c.moveTo(v.px(BUILD_R.x0), snap(v.pz(z))); c.lineTo(v.px(BUILD_R.x1), snap(v.pz(z))); c.stroke();
  }
  c.font = '11px sans-serif'; c.textAlign = 'center';
  roomStore.slots.forEach((sl, i) => {
    if ((sl.gy || 0) !== addState.gy) return;
    if (sl.closed) return;                // 폐쇄한 방은 배치도에서 뺀다
    if (i === addState.edit) return;      // 옮기는 방은 점선(원래 자리) + 초록(새 자리)으로만
    const r = slotRect(sl);
    c.fillStyle = i === roomStore.cur ? 'rgba(64,214,255,.22)' : 'rgba(120,150,170,.16)';
    c.strokeStyle = i === roomStore.cur ? '#7df3ff' : '#8fa6b6'; c.lineWidth = 2;
    c.fillRect(v.px(r.x0), v.pz(r.z0), r.w * v.k, r.d * v.k);
    c.strokeRect(v.px(r.x0), v.pz(r.z0), r.w * v.k, r.d * v.k);
    c.fillStyle = '#cfe9f5';
    c.fillText(sl.name, v.px(r.x0) + r.w * v.k / 2, v.pz(r.z0) + 14);
  });
  if (addState.edit !== undefined) {     // 옮기기 전 자리 — 점선
    const o = slotRect(roomStore.slots[addState.edit]);
    if (o.gy === addState.gy && (o.x0 !== addState.gx || o.z0 !== addState.gz || o.w !== addState.w || o.d !== addState.d)) {
      c.save();
      c.setLineDash([6, 5]);
      c.strokeStyle = 'rgba(160,200,220,.75)'; c.lineWidth = 2;
      c.strokeRect(v.px(o.x0), v.pz(o.z0), o.w * v.k, o.d * v.k);
      c.fillStyle = 'rgba(160,200,220,.75)'; c.font = '11px system-ui'; c.textAlign = 'center';
      c.fillText('원래 자리', v.px(o.x0) + o.w * v.k / 2, v.pz(o.z0) + o.d * v.k / 2 + 4);
      c.restore();
    }
  }
  for (const [i, sl] of roomStore.slots.entries()) {     // 문·계단 자리 표시
    if ((sl.gy || 0) !== addState.gy) continue;
    const R = i === addState.edit ? slotRect(addState) : slotRect(sl);   // 옮기는 방은 새 자리 기준
    const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
    for (const it of sl.items) {
      if (it.type === 'door') {
        const wx = cx + it.x, wz = cz + it.z;
        const onX = Math.abs(Math.abs(it.x) - (R.x1 - R.x0) / 2) < 0.2;
        c.strokeStyle = it.link >= 0 ? '#ffd76b' : '#ff8a7a';
        c.lineWidth = 4;
        c.beginPath();
        if (onX) { c.moveTo(v.px(wx), v.pz(wz - DOOR_W / 2)); c.lineTo(v.px(wx), v.pz(wz + DOOR_W / 2)); }
        else { c.moveTo(v.px(wx - DOOR_W / 2), v.pz(wz)); c.lineTo(v.px(wx + DOOR_W / 2), v.pz(wz)); }
        c.stroke();
      } else if (it.type === 'stairs') {
        const fp = footprint('stairs', it.rot);
        const wx = cx + it.x, wz = cz + it.z;
        c.fillStyle = it.link >= 0 ? 'rgba(155,231,160,.45)' : 'rgba(255,140,120,.4)';
        c.strokeStyle = it.link >= 0 ? '#9be7a0' : '#ff8a7a'; c.lineWidth = 1.5;
        c.fillRect(v.px(wx - fp.w / 2), v.pz(wz - fp.d / 2), fp.w * v.k, fp.d * v.k);
        c.strokeRect(v.px(wx - fp.w / 2), v.pz(wz - fp.d / 2), fp.w * v.k, fp.d * v.k);
        c.fillStyle = '#eafff0'; c.font = 'bold 11px system-ui'; c.textAlign = 'center';
        c.fillText((it.dir ?? 'up') === 'up' ? '▲' : '▼', v.px(wx), v.pz(wz) + 4);
      }
    }
  }
  const g = slotRect(addState), chk = addRoomCheck();
  c.fillStyle = chk.ok ? 'rgba(126,224,163,.28)' : 'rgba(255,90,74,.25)';
  c.strokeStyle = chk.ok ? '#7ee0a3' : '#ff5a4a'; c.lineWidth = 2.5;
  c.fillRect(v.px(g.x0), v.pz(g.z0), g.w * v.k, g.d * v.k);
  c.strokeRect(v.px(g.x0), v.pz(g.z0), g.w * v.k, g.d * v.k);
  c.fillStyle = chk.ok ? '#d8ffe8' : '#ffd9d4';
  c.fillText(addState.w + '×' + addState.d + 'm', v.px(g.x0) + g.w * v.k / 2, v.pz(g.z0) + g.d * v.k / 2 + 4);
  const note = document.getElementById('addNote');
  if (note) { note.textContent = chk.note; note.className = chk.ok ? 'ok' : 'bad'; }
  const edit = addState.edit !== undefined;
  const ok = document.getElementById('addOk');
  const need = edit ? editCost() : (addState.cost || 0);
  const poor = coins < need;
  if (ok) {
    ok.disabled = !chk.ok || poor;
    ok.title = poor ? '코인이 부족합니다 (보유 ' + coins.toLocaleString() + ')' : '';
    ok.textContent = poor
      ? '코인 부족 · ' + (need - coins).toLocaleString() + '🪙 더 필요'
      : (edit ? '이 자리로 적용' : '이 자리에 배치') + (need ? ' (' + need.toLocaleString() + '🪙)' : '');
  }
  const cb = document.getElementById('addClose');
  if (cb) {
    cb.style.display = edit && addState.edit !== 0 ? '' : 'none';
    cb.textContent = roomStore.slots[addState.edit]?.closed ? '🔓 폐쇄 해제' : '🚫 방 폐쇄';
  }
  const nb2 = document.getElementById('addNew');
  if (nb2) {
    const nc = slotCost(), np = coins < nc, full = floorFull(addState.gy);
    nb2.style.display = edit && !full ? '' : 'none';   // 층이 꽉 차면 아예 감춘다
    nb2.disabled = np;
    nb2.title = np ? '코인이 부족합니다 (보유 ' + coins.toLocaleString() + ')' : '';
    nb2.textContent = np
      ? '＋ 새 방 · 코인 부족 (' + (nc - coins).toLocaleString() + '🪙 더 필요)'
      : '＋ 새 방 (' + nc.toLocaleString() + '🪙)';
  }
  renderAddList();
  const ttl = document.querySelector('#addPanel .optTitle');
  if (ttl) ttl.textContent = addState.edit !== undefined ? (roomStore.slots[addState.edit]?.name ?? '방') + ' 옮기기' : '새 방 배치';
  const lv = document.getElementById('addLevel');
  if (lv) lv.textContent = gyName(addState.gy) + (levelOpen(addState.gy) ? '' : ' 🔒');
}
function addRoomMove(dx, dz) { if (!addState) return; addState.gx += dx; addState.gz += dz; drawAddMap(); }
function addRoomLevel(dy) {              // 배치 창에서 층을 옮겨 본다
  if (!addState) return;
  const gy = addState.gy + dy;
  if (!levelOpen(gy)) toast('🔒 ' + gyName(gy) + ' — 배치하면 헤드 ' + fmt(HEAD_FLOOR) + '개가 듭니다');
  if (addState.edit !== undefined) {      // 편집: 그 층의 방을 고른다 (없으면 그대로)
    const other = roomStore.slots.findIndex(sl => (sl.gy || 0) === gy);
    if (other < 0) { toast('그 층에는 방이 없습니다'); return; }
    openLayoutEdit(other);
    drawAddMap();
    return;
  }
  addState.gy = gy;
  addState.frame = null;                  // 층이 바뀌면 화면 범위도 새로
  fitAddRoom();
  drawAddMap();
}
function addRoomTo(mx, mz) {             // 커서 위치(m)를 1m 격자에 맞춰 옮긴다
  if (!addState) return;
  addState.gx = Math.round(mx - addState.w / 2);
  addState.gz = Math.round(mz - addState.d / 2);
  drawAddMap();
}
function addRoomSize(axis, delta) {
  if (!addState) return;
  const key = axis === 'w' ? 'w' : 'd';
  const next = addState[key] + delta;
  const floorSize = addState.edit !== undefined
    ? (key === 'w' ? roomW(roomStore.slots[addState.edit]) : roomD(roomStore.slots[addState.edit])) : ROOM_MIN;
  if (next < floorSize) { toast('방은 줄일 수 없습니다'); return; }
  if (next < ROOM_MIN || next > ROOM_MAX) { toast('방 크기는 ' + ROOM_MIN + '~' + ROOM_MAX + 'm 입니다'); return; }
  const gk = key === 'w' ? 'gx' : 'gz';
  const cands = delta > 0
    ? [{ ...addState, [key]: next }, { ...addState, [key]: next, [gk]: addState[gk] - ROOM_STEP }]   // 오른쪽/아래 → 막히면 왼쪽/위
    : [{ ...addState, [key]: next }];
  if (key === 'd' && delta > 0) cands.reverse();   // 세로 확장은 뒤(-z)를 먼저 — 앞은 MY ROOM 앞선에 막힌다
  const fit = cands.find(t => rectPlaceable(slotRect(t), addState.edit ?? -1));
  if (!fit) {
    const nm = roomStore.slots.filter((o, j) => j !== (addState.edit ?? -1) && rectsHit(slotRect(cands[0]), slotRect(o))).map(o => o.name);
    toast(nm.length ? '🚫 ' + nm.join('·') + ' 때문에 늘릴 수 없습니다 — 그 방을 먼저 옮겨 주세요' : '🚫 늘릴 자리가 없습니다');
    return;
  }
  addState[key] = next; addState[gk] = fit[gk];
  if (delta > 0) addState[key === 'w' ? 'growX' : 'growZ'] = fit[gk] === addState[gk] ? 1 : -1;   // 어느 쪽으로 늘렸나
  drawAddMap();
}
function loadRoomSlot(i) {
  if (!roomStore.slots[i]) return;
  roomStore.cur = i;
  setSel(null); cancelPlace();
  roomSave(); buildWorld(); roomRenderUI(); syncGuides();
  const r = worldRooms.find(w => w.slot === i);   // 그 방 안의 빈자리에 세운다 (계단 위는 피한다)
  if (r) {
    live.y = r.cy || 0; live.active = i;
    let best = null;
    for (let ring = 0; ring < 12 && !best; ring++) {
      for (let a = 0; a < 12; a++) {
        const ang = a * Math.PI / 6, rad = ring * 0.5;
        const x = r.cx + Math.cos(ang) * rad, z = r.cz + Math.sin(ang) * rad;
        if (Math.abs(x - r.cx) > r.w / 2 - 0.5 || Math.abs(z - r.cz) > r.d / 2 - 0.5) continue;
        if (stairAt(x, z) || blockedByFurniture(x, z)) continue;
        best = [x, z]; break;
      }
    }
    live.x = best ? best[0] : r.cx;
    live.z = best ? best[1] : r.cz;
    for (let t = 0; t < 24 && stairAt(live.x, live.z); t++) {   // 계단을 밟고 있으면 방 안쪽으로 민다
      const dx = live.x - r.cx, dz = live.z - r.cz, m = Math.hypot(dx, dz) || 1;
      live.x = Math.max(r.cx - r.w / 2 + 0.5, Math.min(r.cx + r.w / 2 - 0.5, live.x + (dx / m) * 0.4 + (m < 0.1 ? 0.4 : 0)));
      live.z = Math.max(r.cz - r.d / 2 + 0.5, Math.min(r.cz + r.d / 2 - 0.5, live.z + (dz / m) * 0.4));
    }
    live.vy = 0;
  }
  toast('📂 ' + curRoom().name + ' 불러옴');
}
const DARK = 0.6;                         // 불 없는 방: 면 색 배율
const DARK_L = 0.5;                       // 불 없는 방: 무대 조명 배율 (합쳐서 명암 50% 수준)
function roomLitK(sl) {                   // 방이 밝아진 정도 0(불 없음) ~ 1(가득) — 조명 가구의 litW 합
  if (!sl) return 0;
  let k = 0;
  for (const it of sl.items) { const f = FURN[it.type]; if (f?.glow) k += f.litW ?? 1; }
  return Math.min(1, k);
}
function roomLit(sl) { return roomLitK(sl) > 0; }   // 방에 빛나는 가구가 하나라도 있나
const ROOM_DIM = 0.5;                     // 방 전체 밝기 (조명 유무와 무관하게 한 번 더 낮춘다)
function litMul(sl, dark) { return (dark + (1 - dark) * roomLitK(sl)) * ROOM_DIM; }   // 어두운 값에서 밝기 합만큼 올린 뒤 전체를 낮춘다
function dim(hex, k) {                    // 색을 k배로
  return new THREE.Color(hex).multiplyScalar(k);
}
function pickSurface(ev) {                // 3D에서 벽·바닥·천장을 집는다
  const rm = worldRooms.find(r => r.slot === roomStore.cur);
  if (!rm || !srCam) return null;
  srApplyCam();
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const nd = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(nd, srCam);
  for (const h of raycaster.intersectObject(rm.grp, true)) {
    if (!h.object.isMesh) continue;
    if (h.object.userData.wall) return h.object.userData.wall;
    if (h.object.parent?.userData.ceiling) return 'ceil';
    if (Math.abs(h.point.y - (rm.cy || 0)) < 0.2) return 'floor';
  }
  return null;
}
function setSurfColor(key, hex) {
  const h = String(hex).toLowerCase();
  if (!palOwned(hex)) {
    if (!HEAD_PAL[h]) { toast('🎁 아직 없는 색입니다 — 게임 속 목재상자에서 획득'); return; }
    if (!spendHeads(HEAD_PAL[h], '오렌지 색')) return;
    farm.pal[h] = 1; saveFarm();
  }
  const sl = curRoom();
  sl.surf = sl.surf || {};
  sl.surf[key] = hex;
  roomSave(); buildWorld(); roomRenderUI();
  toast('🎨 ' + (SURFACES.find(s2 => s2.key === key)?.name ?? key) + ' 색 변경');
}
function setBg(key) {
  if (!bgOwned(key)) {
    if (!HEAD_BG[key]) { toast('🎁 아직 없는 풍경입니다 — 게임 속 목재상자에서 획득'); return; }
    if (!spendHeads(HEAD_BG[key], (BG_LIST.find(b => b.key === key)?.name ?? key) + ' 풍경')) return;
    farm.bg[key] = 1; saveFarm();
  }
  curRoom().bg = key;
  roomSave(); buildWorld(); roomRenderUI();
}
// ---- 커서 컨텍스트 메뉴 ----
const SZ_STEP = 0.2, SZ_MIN = 0.4;      // 크기 조절 한 칸 · 최소 크기
function resizeWallItem(it, dw, dh) {    // 창문·배너 크기 바꾸기 (벽을 벗어나거나 겹치면 취소)
  const f = FURN[it.type];
  if (!f?.sizable) return;
  const sl = curRoom(), rm = worldRooms.find(r => r.slot === roomStore.cur);
  const keep = { w: it.w ?? f.w, h: it.h ?? f.h };
  const w = +Math.max(SZ_MIN, keep.w + dw).toFixed(2);
  const h = +Math.max(SZ_MIN, keep.h + dh).toFixed(2);
  const wallLen = Math.abs(it.x) > Math.abs(it.z) ? roomD(sl) : roomW(sl);   // 붙어 있는 벽의 길이
  if (w > wallLen - 0.4) { toast('🚫 벽보다 넓게는 못 만듭니다'); return; }
  if (h > ROOM_H - 0.3) { toast('🚫 천장보다 높게는 못 만듭니다'); return; }
  it.w = w; it.h = h;
  const y0 = (it.y ?? f.wallY ?? 1.3) - h / 2;
  if (y0 < 0.05) it.y = +(h / 2 + 0.05).toFixed(2);                          // 바닥을 파고들지 않게
  if ((it.y ?? 0) + h / 2 > ROOM_H - 0.05) it.y = +(ROOM_H - 0.05 - h / 2).toFixed(2);
  if (wallClash(sl, it.type, it, it)) { Object.assign(it, keep); toast('🚫 벽에 다른 것이 걸려 있습니다'); return; }
  roomSave(); refreshRoom(it.type); syncOutline();
  showCtx(lastCursor[0], lastCursor[1]);
  toast('📐 ' + FURN[it.type].name + ' ' + w + '×' + h + 'm');
}
function pickBannerImage() {              // 배너에 넣을 이미지 (512px로 줄여 저장)
  const it = srPickSel;
  if (!it || !FURN[it.type].image) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.addEventListener('change', () => {
    const file = inp.files?.[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 512 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * k));
        cv.height = Math.max(1, Math.round(img.height * k));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        it.img = cv.toDataURL('image/jpeg', 0.82);
        try { roomSave(); } catch { toast('이미지가 너무 큽니다'); it.img = null; }
        buildFurnitureAll();
        toast('🖼 배너 이미지 적용');
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
  inp.click();
}
function connectedToRoot(slot) {          // MY ROOM(0)에서 문·계단으로 이어져 있는가
  if (slot === 0) return !roomStore.slots[0]?.closed;
  const seen = new Set([0]), q = [0];
  while (q.length) {
    const cur = q.shift();
    if (roomStore.slots[cur]?.closed) continue;
    for (const it of roomStore.slots[cur].items) {
      if ((it.type !== 'door' && it.type !== 'stairs') || !Number.isInteger(it.link)) continue;
      const nx = it.link;
      if (nx < 0 || nx >= roomStore.slots.length || seen.has(nx) || roomStore.slots[nx].closed) continue;
      if (nx === slot) return true;
      seen.add(nx); q.push(nx);
    }
    roomStore.slots.forEach((sl, i) => {   // 반대 방향 연결도 본다
      if (seen.has(i) || sl.closed) return;
      if (sl.items.some(it => (it.type === 'door' || it.type === 'stairs') && it.link === cur)) {
        if (i === slot) { seen.add(i); q.push(i); }
        else { seen.add(i); q.push(i); }
      }
    });
    if (seen.has(slot)) return true;
  }
  return seen.has(slot);
}
function ctxLinkHtml() {                 // 문·계단: 방향과 새 방만 (연결은 배치가 결정한다)
  if (!srPickSel || !FURN[srPickSel.type].link) return '';
  const it = srPickSel;
  let msg;
  if (it.link >= 0 && roomStore.slots[it.link]) msg = `🔗 ${roomStore.slots[it.link].name} 와 이어져 있습니다`;
  else if (it.why === 'closed') msg = '폐쇄중인 방이라 이어지지 않습니다 — 폐쇄 해제 후 연결됩니다';
  else if (it.type === 'stairs') msg = '닿는 자리에 방이 없습니다 — 배치 편집으로 맞춰 주세요';
  else if (it.why === 'short') msg = `${it.near?.name ?? '옆방'} 과 ${it.near?.len ?? 0}m만 맞닿았습니다 (${MIN_LINK}m 이상 필요)`;
  else if (it.why === 'offwall') msg = `문이 ${it.near?.name ?? '옆방'} 과 맞닿은 구간을 벗어났습니다 — 문을 옮기세요`;
  else msg = '이 벽 뒤에 방이 없습니다';
  const here = `<div class="ctxHead">${msg}</div>`;
  const dirRow = it.type === 'stairs'
    ? `<div class="ctxHead">계단 방향</div><button data-dir="up"${(it.dir ?? 'up') === 'up' ? ' class="on"' : ''}>⬆ 위층으로</button>`
      + `<button data-dir="down"${it.dir === 'down' ? ' class="on"' : ''}>⬇ 아래층으로</button>` : '';
  const cost = slotCost(), poor = coins < cost;
  const gyHere = (curRoom().gy || 0) + (it.type === 'stairs' ? ((it.dir ?? 'up') === 'up' ? 1 : -1) : 0);
  if (floorFull(gyHere)) return dirRow + here
    + `<button class="new off" disabled>＋ 새 방<i>${gyName(gyHere)} 9/9 가득</i></button>`;
  return dirRow + here
    + `<button data-newroom="1" class="new${poor ? ' off' : ''}">＋ 새 방<i>${cost.toLocaleString()}🪙${poor ? ' · 부족' : ''}</i></button>`;
}
function showCtx(x, y) {
  const el = document.getElementById('srCtx');
  if (!el || !srPickSel) return;
  const imgBtn = el.querySelector('[data-ctx="img"]');
  if (imgBtn) imgBtn.style.display = FURN[srPickSel.type].image ? '' : 'none';
  const szBtn = el.querySelector('[data-ctx="size"]');
  if (szBtn) szBtn.style.display = FURN[srPickSel.type].sizable ? '' : 'none';
  const szRow = el.querySelector('.ctxSize');
  if (szRow) szRow.remove();
  if (FURN[srPickSel.type].sizable) {     // 창문·배너: 크기 조절
    const f = FURN[srPickSel.type];
    const wrap = document.createElement('div');
    wrap.className = 'ctxSize';
    wrap.innerHTML = '<span>크기 ' + (srPickSel.w ?? f.w) + '×' + (srPickSel.h ?? f.h) + 'm</span>'
      + '<span class="ctxHint">크기 수정 → 네 구석 손잡이를 끌어 조절</span>';
    el.appendChild(wrap);
  }
  const fitRow = el.querySelector('.ctxFits');
  if (fitRow) fitRow.remove();
  if (FURN[srPickSel.type].image && srPickSel.img) {      // 이미지 표시 방식
    const wrap = document.createElement('div');
    wrap.className = 'ctxFits';
    const cur = srPickSel.fit || 'stretch';
    wrap.innerHTML = IMG_FITS.map(o => `<button data-fit="${o.key}"${o.key === cur ? ' class="on"' : ''}>${o.name}</button>`).join('');
    el.appendChild(wrap);
    for (const b of wrap.querySelectorAll('[data-fit]')) {
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        srPickSel.fit = b.dataset.fit;
        roomSave(); refreshRoom(srPickSel.type);
        showCtx(lastCursor[0], lastCursor[1]);
        toast('🖼 ' + (IMG_FITS.find(o => o.key === b.dataset.fit)?.name ?? ''));
      });
    }
  }
  const allBtn = el.querySelector('[data-ctx="delAll"]');
  if (allBtn) {                          // 같은 종류가 둘 이상일 때만 (문·계단은 연결이 걸려 있어 제외)
    const n = curRoom().items.filter(it => it.type === srPickSel.type).length;
    allBtn.style.display = n > 1 && !FURN[srPickSel.type].link ? '' : 'none';
    allBtn.textContent = '🧹 ' + FURN[srPickSel.type].name + ' ' + n + '개 모두 제거';
  }
  const extra = el.querySelector('.ctxLinks');
  if (extra) extra.remove();
  if (FURN[srPickSel.type].link) {
    const wrap = document.createElement('div');
    wrap.className = 'ctxLinks';
    wrap.innerHTML = ctxLinkHtml();
    el.appendChild(wrap);
    const nb = wrap.querySelector('[data-newroom]');
    if (nb) nb.addEventListener('click', ev => {
      ev.stopPropagation();
      if (addRoomSlot(srPickSel) !== null) { hideCtx(); srRenderModeUI(); }
    });
    for (const b of wrap.querySelectorAll('[data-dir]')) {
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        srPickSel.dir = b.dataset.dir;   // 방향이 바뀌면 연결도 다시 찾는다
        roomSave(); buildWorld(); roomRenderUI();
        showCtx(lastCursor[0], lastCursor[1]);
        toast(b.dataset.dir === 'up' ? '⬆ 위층으로 오르는 계단' : '⬇ 아래층으로 내려가는 계단');
      });
    }
  }
  el.style.left = Math.min(x, innerWidth - 130) + 'px';
  el.style.top = Math.min(y, innerHeight - 100) + 'px';
  el.classList.add('on');
}
function hideCtx() { document.getElementById('srCtx')?.classList.remove('on'); }
function closeCtx() { hideCtx(); if (sizeMode) endSizeEdit(); setSel(null); }   // 닫기 = 선택 해제(외곽선·격자도 정리)
function roomRenderUI() {
  const slots = document.getElementById('srSlots');
  if (!slots) return;
  const floors = [...new Set(roomStore.slots.map(sl => sl.gy || 0))].sort((a, b) => b - a);   // 위층부터
  const gyNow = roomStore.slots[standingSlot()]?.gy || 0;
  const gySel = floors.includes(slotFloor) ? slotFloor : gyNow;                               // 기본 = 지금 있는 층
  const onFloor = roomStore.slots.map((sl, i) => ({ sl, i })).filter(o => (o.sl.gy || 0) === gySel);
  const pick = floors.length > 1
    ? `<select id="srFloorPick">${floors.map(g => `<option value="${g}"${g === gySel ? ' selected' : ''}>${gyName(g)} (${roomStore.slots.filter(s2 => (s2.gy || 0) === g).length})</option>`).join('')}</select>`
    : '';
  slots.innerHTML = pick + onFloor.map(o =>
    `<button data-slot="${o.i}" class="${o.i === roomStore.cur ? 'on' : ''}${o.sl.closed ? ' closed' : ''}">${o.sl.name}<i>${o.sl.closed ? '폐쇄중' : roomW(o.sl) + '×' + roomD(o.sl) + 'm'}</i></button>`).join('')
    + `<div class="slotHint">새 방은 <b>문·계단</b>을 놓고 <b>＋ 새 방</b>을 고르면 추가됩니다`
    + (decoMode ? '' : `<span${coins < slotCost() ? ' class="poor"' : ''}>다음 ${slotCost().toLocaleString()}🪙 · 보유 ${coins.toLocaleString()}</span>`) + '</div>';
  slots.querySelector('#srFloorPick')?.addEventListener('change', e => {
    e.stopPropagation();
    slotFloor = +e.target.value;
    roomRenderUI();
  });
  for (const b of slots.querySelectorAll('[data-slot]'))
    b.addEventListener('click', e => { e.stopPropagation(); loadRoomSlot(+b.dataset.slot); });
  const surf = document.getElementById('srSurf');
  if (surf) {
    const sl0 = curRoom();
    const shape = {                      // 1점 투시 방 (viewBox 200×140)
      ceil: { pts: '0,0 200,0 144,38 56,38', tx: 100, ty: 24 },
      'x-': { pts: '0,0 56,38 56,102 0,140', tx: 26, ty: 74 },
      'x+': { pts: '200,0 200,140 144,102 144,38', tx: 174, ty: 74 },
      floor: { pts: '0,140 56,102 144,102 200,140', tx: 100, ty: 126 },
      'z-': { pts: '56,38 144,38 144,102 56,102', tx: 100, ty: 74 },
    };
    const order = ['ceil', 'x-', 'x+', 'floor', 'z-'];   // 뒷벽을 맨 위에 그려 클릭이 쉽게
    surf.innerHTML = '<svg viewBox="0 0 200 140" class="surfMap">'
      + order.map(k => {
        const f = SURFACES.find(s2 => s2.key === k), g = shape[k];
        const on = surfSel === k;
        return `<polygon data-surf="${k}" points="${g.pts}" fill="${surfColor(sl0, k)}"`
          + ` stroke="${on ? '#7df3ff' : 'rgba(10,20,28,.85)'}" stroke-width="${on ? 3 : 1.5}"><title>${f.name}</title></polygon>`;
      }).join('')
      + order.map(k => {
        const f = SURFACES.find(s2 => s2.key === k), g = shape[k];
        return `<text data-surf="${k}" x="${g.tx}" y="${g.ty}" class="${surfSel === k ? 'on' : ''}">${f.name}</text>`;
      }).join('')
      + '</svg>';
    for (const b of surf.querySelectorAll('[data-surf]'))
      b.addEventListener('click', e => { e.stopPropagation(); surfSel = b.dataset.surf; roomRenderUI(); });
  }
  const pal = document.getElementById('srPal');
  if (pal) {
    const now = String(surfColor(curRoom(), surfSel)).toLowerCase();
    pal.innerHTML = PALETTE.map(hx => {
      const got = palOwned(hx), hp = HEAD_PAL[hx.toLowerCase()];
      const cls = got ? '' : hp ? ' head' : ' locked';
      return `<div class="sw${hx.toLowerCase() === now ? ' on' : ''}${cls}" data-col="${hx}" style="background:${hx}" title="${got ? hx : hp ? '헤드 ' + hp + '개로 구매' : '🎁 목재상자에서 획득'}"></div>`;
    }).join('');
    for (const b of pal.querySelectorAll('[data-col]'))
      b.addEventListener('click', e => { e.stopPropagation(); setSurfColor(surfSel, b.dataset.col); });
  }
  const bg = document.getElementById('srBg');
  if (bg) {
    bg.innerHTML = BG_LIST.map(b => {
      const got = bgOwned(b.key), hp = HEAD_BG[b.key];
      const tag2 = got ? '' : hp ? `<b class="head">${HEAD_IC}${hp}</b>` : '<b class="loot">상자</b>';
      return `<div class="srItem${curRoom().bg === b.key ? ' on' : ''}${got || hp ? '' : ' locked'}" data-bg="${b.key}" title="${got ? b.name : hp ? b.name + ' — 헤드 ' + hp + '개로 구매' : b.name + ' — 목재상자에서 획득'}">${b.icon}<span>${b.name}</span>${tag2}</div>`;
    }).join('');
    for (const b of bg.querySelectorAll('[data-bg]'))
      b.addEventListener('click', e => { e.stopPropagation(); setBg(b.dataset.bg); });
  }
  const nm = document.getElementById('srRoomNameLbl');
  if (nm) nm.textContent = curRoom().name;
  const cat = document.getElementById('srFurn');
  if (cat) {
    cat.innerHTML = Object.entries(FURN).map(([k, f]) => {
      const loot = FURN_LOOT.includes(k), cost = FURN_COST[k] ?? 0, n = furnStock(k);
      const own = furnUsable(k);
      const buy = !own && !loot && (headPrice(k) ? heads >= headPrice(k) : coins >= cost);   // 살 수 있으면 잠긴 티를 내지 않는다
      const hp = headPrice(k);
      const tag = loot ? `<b class="loot">${decoMode ? '∞' : n > 0 ? '×' + n : '상자'}</b>`
        : own ? '' : hp ? `<b class="head">${HEAD_IC}${hp}</b>` : `<b>${cost.toLocaleString()}</b>`;
      const tip = loot ? (n > 0 ? f.name + ' — 남은 개수 ' + n : f.name + ' — 목재상자에서 획득')
        : own ? f.name : hp ? f.name + ' — 헤드 ' + hp + '개로 구매' : (buy ? f.name + ' — ' + cost.toLocaleString() + '🪙에 구매' : f.name + ' — 코인 부족 (' + cost.toLocaleString() + '🪙)');
      return `<div class="srItem${placeType === k ? ' on' : ''}${own || buy ? '' : ' locked'}${buy ? ' buy' : ''}" data-furn="${k}" title="${tip}">${f.icon}<span>${f.name}</span>${tag}</div>`;
    }).join('');
    for (const b of cat.querySelectorAll('[data-furn]'))
      b.addEventListener('click', e => { e.stopPropagation(); pickFurnCatalog(b.dataset.furn); });
  }
  const del = document.getElementById('srDel');
  if (del) del.classList.toggle('on', !!srPickSel);
  const tgt = roomStore.slots[standingSlot()] ?? curRoom();
  for (const cbtn of document.querySelectorAll('#srCloseRoom, #srLiveBar [data-act="close"]')) {
    cbtn.textContent = tgt.closed ? '🔓 폐쇄 해제' : '🚫 방 폐쇄';
    cbtn.classList.toggle('on', !!tgt.closed);
    cbtn.classList.toggle('off', standingSlot() === 0);   // 기본 방은 폐쇄 불가
    cbtn.title = standingSlot() === 0 ? '기본 방은 폐쇄할 수 없습니다' : tgt.name;
  }
  const nameEl = document.getElementById('srName');
  if (nameEl) nameEl.textContent = curRoom().name;
}
function syncRoomDim() {                  // 불이 있으면 제 색, 없으면 어둡게 (면·가구·천장발광)
  for (const r of worldRooms) {
    const lit = litMul(roomStore.slots[r.slot], DARK);
    if (r.litK === lit) continue;
    r.litK = lit;
    for (const sm of r.grp?.userData.surfMats || []) {
      sm.m.color.set(sm.hex).multiplyScalar(lit);
      if (sm.emis) sm.m.emissive.set(sm.hex).multiplyScalar(sm.emis * lit * lit);
    }
  }
  if (srFurnGrp) for (const m of srFurnGrp.children) {
    const lit = litMul(roomStore.slots[m.userData.room], DARK);
    if (m.userData.litK === lit) continue;
    m.userData.litK = lit;
    m.traverse(o => { if (o.userData.baseCol) o.material.color.copy(o.userData.baseCol).multiplyScalar(lit); });
  }
}
function syncCeilings() {                 // 천장은 아래에서 볼 때만 (위에서 내려다보면 투명)
  if (!srCam) return;
  const camY = srCam.position.y;
  for (const r of worldRooms) {
    if (!r.ceil) continue;
    r.ceil.visible = (r.grp?.visible ?? true) && camY < (r.cy || 0) + ROOM_H - 0.05;
  }
}
function roomUpdate() {
  if (placeGhost && placeType) placeGhost.visible = true;
  syncCeilings();
  syncRoomDim();
  syncStageDim();
  if (srOutline) srOutline.update();
  if (srFurnGrp) {                        // 선택 표시(살짝 띄우기) — 설치 높이는 유지한다
    for (const m of srFurnGrp.children) {
      const base = (m.userData.roomY || 0) + (m.userData.item?.y || 0);
      m.position.y = base + (m.userData.item === srPickSel ? 0.02 : 0);
    }
  }
}

// ---------- 생활 모드: 문으로 이어진 두 방을 걸어서 오간다 ----------
let srMode = 'pose';                     // 'pose' 포즈모드 | 'live' 생활모드
const live = { x: 0, z: 0, y: 0, vy: 0, yaw: 0, camYaw: 0, camPitch: 10 * Math.PI / 180, camDist: 4.2, active: 0, moving: false, dashT: 0, dashCd: 0, dashX: 0, dashZ: 0 };
const CAM_FIXED_PITCH = 10 * Math.PI / 180;   // 생활모드 카메라: 10° 내려보는 각도로 고정
const CAM_YAW_LIM = 0, CAM_PITCH_MIN = CAM_FIXED_PITCH, CAM_PITCH_MAX = CAM_FIXED_PITCH;
let worldRooms = [];                     // [{slot, cx, cz, size, bg, grp, backdrop, doorAt}]
let srYard = null;                       // 앞마당 땅
let liveDoors = [];                      // [{item, room, other, x, z, side, panel, open, t, cooldown}]
const DOOR_W = 1.1, RM_DOOR_H = 2.1, ROOM_GAP = 0;      // 방은 격자에서 딱 붙는다 (문은 공유 벽에)
const MAP_HALF = 15;                     // 층마다 30×30m 고정 (중앙 0,0 기준 ±15)
const MAP_R = { x0: -MAP_HALF, x1: MAP_HALF, z0: -MAP_HALF, z1: MAP_HALF };
const MAP_EDGE = 5;                      // 30×30 바깥으로 5칸까지 보여주고 붉게 칠한다 (설치 불가)
const BUILD_R = MAP_R;                   // 설치 가능 = 층 맵 30×30 전체
const VIEW_HALF = MAP_HALF + MAP_EDGE;   // 지도 보기 범위 40×40
const ROOMS_PER_FLOOR = 9;               // 한 층에 놓을 수 있는 방 수 (폐쇄한 방은 세지 않는다)
const floorCount = gy => roomStore.slots.filter(sl => (sl.gy || 0) === (gy || 0) && !sl.closed).length;
const floorFull = gy => floorCount(gy) >= ROOMS_PER_FLOOR;
const FREE_GY = [-1, 1];                 // 무료 층: 지하1층(-1) ~ 2층(+1)
const HEAD_FLOOR = headOf(2400);         // 범위 밖 층 개방 ≈ 2,400원 → 200
const gyName = gy => gy === 0 ? '1층' : gy > 0 ? (gy + 1) + '층' : '지하 ' + (-gy) + '층';
function levelOpen(gy) {                 // 그 층에 방을 지을 수 있나
  if (decoMode) return true;
  if (gy >= FREE_GY[0] && gy <= FREE_GY[1]) return true;
  return !!farm.floors?.[gy];
}
function openLevel(gy) {                 // 헤드로 층을 연다
  if (levelOpen(gy)) return true;
  if (!spendHeads(HEAD_FLOOR, gyName(gy) + ' 개방')) return false;
  farm.floors = farm.floors || {};
  farm.floors[gy] = 1; saveFarm();
  return true;
}
function inMap(rect) {                   // 설치 가능 구역(가장자리 5칸 제외) 안인가
  return rect.x0 >= BUILD_R.x0 - 0.001 && rect.x1 <= BUILD_R.x1 + 0.001
    && rect.z0 >= BUILD_R.z0 - 0.001 && rect.z1 <= BUILD_R.z1 + 0.001;
}
function rectPlaceable(rect, skip = -1) {   // 겹침 · 맵 · MY ROOM 앞선까지 본 자리 판정
  return rectFree(rect, skip) && inMap(rect) && !(skip !== 0 && frontOfBase(rect));
}
const YARD_D = 8;                        // MY ROOM 앞마당 깊이(m) — 여기엔 방을 붙일 수 없다
const ENTRANCE_W = DOOR_W * 2;           // 현관 폭 — 일반 문의 2배, 앞벽 한가운데 고정
function yardRect() {                    // 기본 방(MY ROOM) 앞(+z)으로 비워 두는 자리
  const base = roomStore.slots[0];
  if (!base || (base.gy || 0) !== 0) return null;
  const r = slotRect(base);
  return { x0: r.x0, x1: r.x1, z0: r.z1, z1: r.z1 + YARD_D };
}
function inYard(x, z, pad = 0.28) {      // 앞마당 안인가 (문틀을 지난 뒤부터)
  const y = yardRect();
  if (!y) return false;
  return x > y.x0 + pad && x < y.x1 - pad && z > y.z0 + 0.5 && z < y.z1 - pad;
}
const FIELD_PAD = 0.2;                   // 집 벽에서 이만큼만 떨어지면 지나갈 수 있다
const FIELD_EDGE = 0.05;                 // 30×30 경계까지 바짝 붙어서 돌 수 있다
const FIELD_EXTRA = 10;                  // 방 배치는 30×30 안에만 · 사람은 앞쪽으로 10m 더 나갈 수 있다
function fieldWhy(x, z) {                // 바깥에서 그 자리에 설 수 있나 — 막혔다면 이유
  if (!yardRect()) return 'no-yard';
  if (x < MAP_R.x0 + FIELD_EDGE || x > MAP_R.x1 - FIELD_EDGE) return 'edge-x';
  if (z < MAP_R.z0 + FIELD_EDGE || z > MAP_R.z1 + FIELD_EXTRA - FIELD_EDGE) return 'edge-z';   // 앞(+z)으로 10m 더
  for (const r of worldRooms) {
    if (Math.abs(r.cy || 0) > 0.1) continue;          // 0층 방만 막는다
    const q = roomRect(r);
    if (x > q.x0 - FIELD_PAD && x < q.x1 + FIELD_PAD && z > q.z0 - FIELD_PAD && z < q.z1 + FIELD_PAD)
      return 'room:' + r.slot;                        // 방은 벽으로 돌아간다
  }
  return '';
}
function inField(x, z) { return fieldWhy(x, z) === ''; }   // 집 밖 30×30 필드 — 방 바깥이면 어디든
function frontOfBase(rect) {             // MY ROOM 앞선(+z)을 넘어가는 자리인가 — 앞은 통째로 비워 둔다
  const base = roomStore.slots[0];
  if (!base) return false;
  return rect.z1 > slotRect(base).z1 + 0.001;
}
function roomRect(r) { return { x0: r.cx - r.w / 2, x1: r.cx + r.w / 2, z0: r.cz - r.d / 2, z1: r.cz + r.d / 2 }; }
function levelY(gy) { return (gy || 0) * LEVEL_H; }
function slotRect(sl, ov) {              // 방의 1m 격자 사각형 (ov로 위치·크기 덮어쓰기)
  const gx = ov?.gx ?? sl.gx ?? 0, gz = ov?.gz ?? sl.gz ?? 0, gy = ov?.gy ?? sl.gy ?? 0;
  const w = ov?.w ?? roomW(sl), d = ov?.d ?? roomD(sl);
  return { x0: gx, z0: gz, x1: gx + w, z1: gz + d, gy, w, d };
}
function rectsHit(a, b, m = 0.01) {      // 같은 층에서 면적이 겹치는가
  return a.gy === b.gy && a.x0 < b.x1 - m && b.x0 < a.x1 - m && a.z0 < b.z1 - m && b.z0 < a.z1 - m;
}
function wallBetween(a, b) {             // 두 사각형이 맞닿은 벽 (a 기준 방향)
  if (a.gy !== b.gy) return null;
  const zo = [Math.max(a.z0, b.z0), Math.min(a.z1, b.z1)], xo = [Math.max(a.x0, b.x0), Math.min(a.x1, b.x1)];
  if (zo[1] - zo[0] > 0.01) {
    if (Math.abs(a.x1 - b.x0) < 0.01) return { axis: 'x', side: 1, lo: zo[0], hi: zo[1], len: zo[1] - zo[0] };
    if (Math.abs(b.x1 - a.x0) < 0.01) return { axis: 'x', side: -1, lo: zo[0], hi: zo[1], len: zo[1] - zo[0] };
  }
  if (xo[1] - xo[0] > 0.01) {
    if (Math.abs(a.z1 - b.z0) < 0.01) return { axis: 'z', side: 1, lo: xo[0], hi: xo[1], len: xo[1] - xo[0] };
    if (Math.abs(b.z1 - a.z0) < 0.01) return { axis: 'z', side: -1, lo: xo[0], hi: xo[1], len: xo[1] - xo[0] };
  }
  return null;
}
function sharedWall(ai, bi, ov) {        // 슬롯 번호로 맞닿은 벽 찾기
  const a = roomStore.slots[ai], b = roomStore.slots[bi];
  if (!a || !b) return null;
  return wallBetween(slotRect(a, ai === ov?.slot ? ov : null), slotRect(b, bi === ov?.slot ? ov : null));
}
function neighbours(rect, skip = -1) {   // 이 사각형과 2m 이상 맞닿은 방들
  const out = [];
  roomStore.slots.forEach((sl, i) => {
    if (i === skip) return;
    const w = wallBetween(rect, slotRect(sl));
    if (w && w.len >= MIN_LINK - 0.01) out.push({ slot: i, wall: w });
  });
  return out.sort((a, b) => b.wall.len - a.wall.len);
}
function rectFree(rect, skip = -1) {     // 다른 방과 겹치지 않는가 (폐쇄된 방은 자리를 비운 것으로 본다)
  return !roomStore.slots.some((sl, i) => i !== skip && !sl.closed && rectsHit(rect, slotRect(sl)));
}
function migrateLayout() {               // 예전 저장본: 문·계단을 따라 격자 위치를 정한다
    const need = roomStore.slots.some((sl, i) => i > 0 && !sl.gx && !sl.gz && !sl.gy);
  if (!need) return;
  const done = new Set([0]);
  roomStore.slots[0].gx = 0; roomStore.slots[0].gz = 0; roomStore.slots[0].gy = 0;
  const q = [0];
  while (q.length) {
    const i = q.shift(), a = roomStore.slots[i];
    for (const it of a.items) {
      const j = it.link;
      if (!Number.isInteger(j) || j < 0 || j >= roomStore.slots.length || done.has(j)) continue;
      const b = roomStore.slots[j];
      if (it.type === 'stairs') { b.gx = a.gx; b.gz = a.gz; b.gy = (a.gy || 0) + 1; }
      else {
        const side = it.x >= 0 ? 1 : -1;
        b.gy = a.gy || 0;
        b.gx = side > 0 ? a.gx + roomW(a) : a.gx - roomW(b);
        const zc = a.gz + roomD(a) / 2 + (it.z || 0);
        b.gz = Math.round(zc - roomD(b) / 2);
        for (let k = 0; k <= 20 && !rectFree(slotRect(b), j); k++) {   // 겹치면 벽을 따라 밀어 본다
          b.gz = Math.round(zc - roomD(b) / 2) + (k % 2 ? 1 : -1) * Math.ceil(k / 2);
        }
      }
      done.add(j); q.push(j);
    }
  }
}
const liveStairs = [];                   // 위·아래로 잇는 계단
const linkNotes = [];                    // 문이 옮겨졌을 때 알릴 내용
function autoDoor(aSlot, bSlot) {        // 두 방이 맞닿은 자리에 문 하나 — 계단을 피해서
  const A = roomStore.slots[aSlot], B = roomStore.slots[bSlot];
  const w = A && B ? wallBetween(slotRect(A), slotRect(B)) : null;
  if (!w || w.len < MIN_LINK - 0.01) return false;
  const mk = (sl, u, onXWall, side) => onXWall
    ? { type: 'door', x: +(side * roomW(sl) / 2).toFixed(2), z: +(u - ((sl.gz || 0) + roomD(sl) / 2)).toFixed(2), y: 0, rot: side > 0 ? 9 : 3 }
    : { type: 'door', x: +(u - ((sl.gx || 0) + roomW(sl) / 2)).toFixed(2), z: +(-roomD(sl) / 2).toFixed(2), y: 0, rot: 0 };
  const mid = (w.lo + w.hi) / 2, lim = (w.len - DOOR_W) / 2 - 0.1;
  const owner = w.axis === 'x' ? A : (w.side === 1 ? B : A);
  const oSlot = w.axis === 'x' ? aSlot : (w.side === 1 ? bSlot : aSlot);
  const other = oSlot === aSlot ? B : A;
  const side = w.axis === 'x' ? w.side : -1;
  for (let k = 0; k <= Math.max(0, Math.round(lim / 0.5)); k++) {
    for (const sgn of (k === 0 ? [1] : [1, -1])) {
      const u = mid + sgn * k * 0.5;
      if (u - DOOR_W / 2 < w.lo || u + DOOR_W / 2 > w.hi) continue;
      const item = mk(owner, u, w.axis === 'x', side);
      const twin = mk(other, u, w.axis === 'x', -side);      // 반대쪽 방에서 본 같은 자리
      if (doorStairClash(owner, 'door', item) || doorStairClash(other, 'door', twin)) continue;
      item.link = oSlot === aSlot ? bSlot : aSlot;
      owner.items.push(item);
      return true;
    }
  }
  return false;
}
function doorWorld(sl, it) {             // 문의 월드 위치와 붙은 벽
  const R = slotRect(sl);
  const cx = R.x0 + roomW(sl) / 2, cz = R.z0 + roomD(sl) / 2;
  const onX = Math.abs(Math.abs(it.x) - roomW(sl) / 2) < 0.05;
  return { onX, side: onX ? (it.x >= 0 ? 1 : -1) : (it.z >= 0 ? 1 : -1), x: cx + it.x, z: cz + it.z, R };   // 앞벽(+z) 문도 이어진다
}
function autoLinkAll() {                 // 문·계단은 맞닿은 방을 스스로 찾는다 (유저가 고르지 않는다)
  roomStore.slots.forEach((sl, i) => {
    for (const it of sl.items) {
      if (it.type === 'door') {
        const d = doorWorld(sl, it);
        let found = -1, why = 'nowall', near = null;
        roomStore.slots.forEach((o, j) => {
          if (j === i || found >= 0) return;
          const w = wallBetween(d.R, slotRect(o));
          if (!w || w.axis !== (d.onX ? 'x' : 'z') || w.side !== d.side) return;
          near = { slot: j, w };
          if (sl.closed || o.closed) { why = 'closed'; return; }               // 폐쇄중이면 잇지 않는다
          if (w.len < MIN_LINK - 0.01) { why = 'short'; return; }              // 맞닿았지만 2m 미만
          const u = d.onX ? d.z : d.x;
          if (u - DOOR_W / 2 < w.lo - 0.01 || u + DOOR_W / 2 > w.hi + 0.01) { why = 'offwall'; return; }
          found = j;
        });
        it.link = found;
        it.why = found < 0 ? why : null;
        it.near = found < 0 && near ? { name: roomStore.slots[near.slot].name, len: +near.w.len.toFixed(1) } : null;
        it.blocked = found < 0;
      } else if (it.type === 'stairs') {
        const R = slotRect(sl);
        const sx = R.x0 + roomW(sl) / 2 + it.x, sz = R.z0 + roomD(sl) / 2 + it.z;
        const a = (it.rot || 0) * ROT_STEP;
        const tx = sx - Math.sin(a) * (FURN.stairs.d / 2 + 0.9), tz = sz - Math.cos(a) * (FURN.stairs.d / 2 + 0.9);
        const goUp = (it.dir ?? 'up') === 'up';
        const wantGy = (sl.gy || 0) + (goUp ? 1 : -1);
        let found = -1;
        let closed = false;
        roomStore.slots.forEach((o, j) => {
          if (j === i || (o.gy || 0) !== wantGy) return;
          const q = slotRect(o);
          const has = (x, z, m) => x > q.x0 + m && x < q.x1 - m && z > q.z0 + m && z < q.z1 - m;
          if (!has(sx, sz, 0.05)) return;
          if (goUp && !has(tx, tz, 0.3)) return;   // 올라가는 계단은 도착 지점도 그 방 안이어야 한다
          if (sl.closed || o.closed) { closed = true; return; }
          found = j;
        });
        it.link = found;
        it.why = found < 0 ? (closed ? 'closed' : 'align') : null;
        it.blocked = found < 0;
      }
    }
  });
}
function linkedDoors(slotIdx) {          // 그 방의 연결된 문 전부
  const sl = roomStore.slots[slotIdx];
  if (!sl || sl.closed) return [];
  return sl.items.filter(it => it.type === 'door' && Number.isInteger(it.link)
    && it.link >= 0 && it.link < roomStore.slots.length && it.link !== slotIdx);
}
function buildWorld() {                  // 현재 방에서 문·계단으로 이어진 방을 모두 세운다
  if (!srScene) return;
  for (const r of worldRooms) { srScene.remove(r.grp); if (r.backdrop) srScene.remove(r.backdrop); }
  if (srBackdrop) { srScene.remove(srBackdrop); srBackdrop = null; }
  for (const d of liveDoors) { if (d.panel) srScene.remove(d.panel); if (d.sill) srScene.remove(d.sill); }
  worldRooms = []; liveDoors = []; liveStairs.length = 0;
  linkNotes.length = 0;
  autoLinkAll();                         // 배치에서 연결을 먼저 정한다
  const placed = new Map();              // slot → 방 (격자 위치 그대로 세운다)
  roomStore.slots.forEach((sl, i) => {
    if (sl.closed) return;               // 폐쇄한 방은 아예 세우지 않는다 (3D·미니맵 모두)
    placed.set(i, {
      slot: i, cx: (sl.gx || 0) + roomW(sl) / 2, cz: (sl.gz || 0) + roomD(sl) / 2, cy: levelY(sl.gy),
      w: roomW(sl), d: roomD(sl), bg: sl.bg, gaps: [], holes: [],
    });
  });
  const inRoom = (r, x, z, m = 0.1) => Math.abs(x - r.cx) <= r.w / 2 - m && Math.abs(z - r.cz) <= r.d / 2 - m;
  roomStore.slots.forEach((sl, i) => {   // 계단 — 위/아래 층을 잇는다
    if (sl.closed) return;
    for (const st of sl.items) {
      if (st.type !== 'stairs') continue;
      const j = st.link, nb = Number.isInteger(j) && j >= 0 && j < roomStore.slots.length ? roomStore.slots[j] : null;
      if (!nb || nb.closed) { st.blocked = true; st.why = 'nolink'; continue; }
      const goUp = (st.dir ?? 'up') === 'up';
      if ((nb.gy || 0) !== (sl.gy || 0) + (goUp ? 1 : -1)) { st.blocked = true; st.why = 'level'; continue; }
      const own = placed.get(i);
      const sx = own.cx + st.x, sz = own.cz + st.z;        // 계단(=위층 바닥 구멍) 자리
      const a = (st.rot || 0) * ROT_STEP;
      const ux = -Math.sin(a), uz = -Math.cos(a);
      const topX = sx + ux * (FURN.stairs.d / 2 + 0.9), topZ = sz + uz * (FURN.stairs.d / 2 + 0.9);
      const low = placed.get(goUp ? i : j), high = placed.get(goUp ? j : i);
      if (!inRoom(low, sx, sz, 0.05) || !inRoom(high, sx, sz, 0.05) || !inRoom(high, topX, topZ, 0.3)) {
        st.blocked = true; st.why = 'align'; continue;      // 위층 방이 그 자리를 덮지 않는다
      }
      st.blocked = false; st.why = null;
      const fp = footprint('stairs', st.rot);
      high.holes.push({ x: sx - high.cx, z: sz - high.cz, w: fp.w + 0.3, d: fp.d + 0.3 });
      low.ceilHoles = low.ceilHoles || [];        // 아래층 천장도 같이 뚫는다
      low.ceilHoles.push({ x: sx - low.cx, z: sz - low.cz, w: fp.w + 0.3, d: fp.d + 0.3 });
      liveStairs.push({ item: st, x: sx, z: sz, rot: st.rot, y0: low.cy, y1: high.cy, from: low.slot, to: high.slot, own: i });
    }
  });
  roomStore.slots.forEach((sl, i) => {   // 문 — 맞닿은 벽(2m 이상)에만 통한다
    for (const door of linkedDoors(i)) {
      const j = door.link, nb = roomStore.slots[j];
      const rm = placed.get(i), nbRoom = placed.get(j);
      const wall = nb && !nb.closed ? wallBetween(slotRect(sl), slotRect(nb)) : null;
      if (!wall || wall.len < MIN_LINK - 0.01) { door.blocked = true; door.why = wall ? 'short' : 'nowall'; continue; }
      if (wall.axis === 'x') {
        const onSide = door.x >= 0 ? 1 : -1;
        if (onSide !== wall.side) { door.blocked = true; door.why = 'wrongwall'; continue; }
        const zw = rm.cz + door.z;
        if (zw - DOOR_W / 2 < wall.lo - 0.01 || zw + DOOR_W / 2 > wall.hi + 0.01) { door.blocked = true; door.why = 'offwall'; continue; }
        door.blocked = false; door.why = null;
        rm.gaps.push({ side: onSide, z: door.z, w: DOOR_W, y0: 0, y1: RM_DOOR_H });
        nbRoom.gaps.push({ side: -onSide, z: +(zw - nbRoom.cz).toFixed(2), w: DOOR_W, y0: 0, y1: RM_DOOR_H });
        const dx = rm.cx + onSide * rm.w / 2;
        if (!liveDoors.some(d => d.from === j && d.to === i && Math.hypot(d.x - dx, d.z - zw) < 0.8))   // 짝 문은 하나만
          liveDoors.push({ item: door, axis: 'x', x: dx, z: zw, side: onSide, from: i, to: j, open: 0, panel: null });
      } else {
        const onSide = door.z >= 0 ? 1 : -1;             // 앞벽(+z)·뒷벽(-z) 어디에 달렸나
        if (onSide !== wall.side) { door.blocked = true; door.why = 'wrongwall'; continue; }
        const xw = rm.cx + door.x;
        if (xw - DOOR_W / 2 < wall.lo - 0.01 || xw + DOOR_W / 2 > wall.hi + 0.01) { door.blocked = true; door.why = 'offwall'; continue; }
        door.blocked = false; door.why = null;
        const mine = onSide > 0 ? 'frontGaps' : 'backGaps';      // 내 쪽 벽
        const theirs = onSide > 0 ? 'backGaps' : 'frontGaps';    // 옆방 쪽 벽도 같이 뚫는다
        rm[mine] = rm[mine] || [];
        rm[mine].push({ x: door.x, w: DOOR_W, y0: 0, y1: RM_DOOR_H });
        nbRoom[theirs] = nbRoom[theirs] || [];
        nbRoom[theirs].push({ x: +(xw - nbRoom.cx).toFixed(2), w: DOOR_W, y0: 0, y1: RM_DOOR_H });
        const zw = rm.cz + onSide * rm.d / 2;
        if (!liveDoors.some(d => d.from === j && d.to === i && Math.hypot(d.x - xw, d.z - zw) < 0.8))   // 짝 문은 하나만
          liveDoors.push({ item: door, axis: 'z', x: xw, z: zw, side: onSide, from: i, to: j, open: 0, panel: null });
      }
    }
  });
  for (const r of placed.values()) {     // 창문은 벽을 뚫는다 (맞은편 방이 있으면 그 벽도)
    for (const it of roomStore.slots[r.slot].items) {
      if (it.type !== 'window') continue;
      const hw = it.w ?? FURN.window.w, hh = it.h ?? FURN.window.h;
      const onX = Math.abs(Math.abs(it.x) - r.w / 2) < 0.05;
      const side = onX ? (it.x >= 0 ? 1 : -1) : 0;
      const y0 = Math.max(0.05, (it.y ?? 1.6) - hh / 2), y1 = Math.min(ROOM_H - 0.05, (it.y ?? 1.6) + hh / 2);
      if (onX) {
        r.gaps.push({ side, z: it.z, w: hw, y0, y1, win: true });
        for (const o of placed.values()) { // 옆방 벽도 뚫어 서로 보이게
          if (o === r || Math.abs((o.cy || 0) - (r.cy || 0)) > 0.01) continue;
          if (Math.abs(o.cx - (r.cx + side * (r.w / 2 + o.w / 2))) > 0.06) continue;
          const zw = r.cz + it.z;                     // 옆방과 겹치는 폭만 뚫는다
          const lo = Math.max(zw - hw / 2, o.cz - o.d / 2 + 0.05), hi = Math.min(zw + hw / 2, o.cz + o.d / 2 - 0.05);
          if (hi - lo < 0.3) continue;
          o.gaps.push({ side: -side, z: +((lo + hi) / 2 - o.cz).toFixed(2), w: +(hi - lo).toFixed(2), y0, y1, win: true });
        }
      } else if (it.z >= 0) {          // 앞벽 창문
        r.frontGaps = r.frontGaps || [];
        r.frontGaps.push({ x: it.x, w: hw, y0, y1 });
      } else {
        r.backGaps = r.backGaps || [];
        r.backGaps.push({ x: it.x, w: hw, y0, y1 });
      }
    }
  }
  const base0 = placed.get(0);
  if (base0 && (base0.cy || 0) === 0) {   // MY ROOM 앞벽에 밖으로 나가는 현관
    base0.frontGaps = base0.frontGaps || [];
    base0.frontGaps.push({ x: 0, w: ENTRANCE_W, y0: 0, y1: RM_DOOR_H });   // 한가운데 고정
    base0.entrance = true;
  }
  for (const r of placed.values()) {
    r.grp = buildRoomMesh(r);
    r.ceil = r.grp.children.find(o => o.userData.ceiling) ?? null;
    srScene.add(r.grp);
    worldRooms.push(r);
  }
  srBackdrop = makeBackdrop();           // 전체 방을 감싸는 창밖 풍경 하나
  if (srBackdrop) srScene.add(srBackdrop);
  if (srYard) { srScene.remove(srYard); srYard = null; }
  if (srEntrance) {
    if (srEntrance.userData.sill) srScene.remove(srEntrance.userData.sill);
    srScene.remove(srEntrance);
    srEntrance.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    srEntrance = null;
  }
  if (base0 && (base0.cy || 0) === 0 && base0.entrance) {   // 현관 양문
    srEntrance = makeEntranceDoors(base0.cx, base0.cz + base0.d / 2);
    srScene.add(srEntrance);
    const esill = makeSill(ENTRANCE_W, 'z');
    esill.position.set(base0.cx, 0.01, base0.cz + base0.d / 2);
    srScene.add(esill);
    srEntrance.userData.sill = esill;
  }
  buildFence();
  const yr = yardRect();
  if (yr) {                              // 앞마당 평면 (문 밖으로 나가면 밟고 서는 땅)
    const g = new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2);   // 풍경 원통 밑까지 덮는 땅
    srYard = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4d5a44, roughness: 1 }));
    srYard.position.set(0, -0.14, (MAP_R.z0 + MAP_R.z1 + FIELD_EXTRA) / 2);
    srScene.add(srYard);
  }
  for (const d of liveDoors) {
    const panel = makeDoorPanel();
    const lvl = worldRooms.find(r => r.slot === d.from);
    panel.position.set(d.x, lvl ? lvl.cy : 0, d.z);
    panel.rotation.y = d.axis === 'z' ? 0 : Math.PI / 2;
    srScene.add(panel);
    d.panel = panel;
    const sill = makeSill(DOOR_W, d.axis);
    sill.position.set(d.x, (lvl ? lvl.cy : 0) + 0.01, d.z);
    srScene.add(sill);
    d.sill = sill;
  }
  buildFurnitureAll();
  const homeRoom = worldRooms.find(r => r.slot === roomStore.cur);
  if (homeRoom) {                        // 어느 방에도 없으면 지금 방 한가운데로 (격자 좌표는 절대값)
    const inAny = worldRooms.some(r => {
      const t = roomRect(r);
      return Math.abs((r.cy || 0) - live.y) < 0.6 && live.x > t.x0 + 0.2 && live.x < t.x1 - 0.2 && live.z > t.z0 + 0.2 && live.z < t.z1 - 0.2;
    });
    if (!inAny) { live.x = homeRoom.cx; live.z = homeRoom.cz; live.y = homeRoom.cy || 0; live.vy = 0; live.active = homeRoom.slot; }
  }
  syncGuides();
  srWarm();
  if (linkNotes.length) { toast('🚪 ' + linkNotes[0]); linkNotes.length = 0; }
  const home = curRoom();
  const wantDist = Math.max(4.2, Math.max(roomW(home), roomD(home)) * 0.85 + 1.8);
  const grew = Math.abs(wantDist - SR_FULL.dist) > 0.01;
  SR_FULL.dist = wantDist;
  SR_FULL.y = 1.0;
  if (srMode === 'pose' && grew) srReset();   // 방 크기가 바뀔 때만 시점 초기화
}
function makeDoorPanel() {
  const grp = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.7, metalness: 0.3 });
  const side1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, RM_DOOR_H + 0.1, 0.3), frame);
  side1.position.set(-DOOR_W / 2, (RM_DOOR_H + 0.1) / 2, 0);
  const side2 = side1.clone(); side2.position.x = DOOR_W / 2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.16, 0.09, 0.3), frame);
  top.position.y = RM_DOOR_H + 0.1;
  grp.add(side1, side2, top);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W - 0.04, RM_DOOR_H, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.75, metalness: 0.1 }));
  leaf.position.set(0, RM_DOOR_H / 2, 0);
  const pivot = new THREE.Group();       // 경첩
  pivot.position.set(-DOOR_W / 2 + 0.02, 0, 0);
  leaf.position.x = (DOOR_W - 0.04) / 2;
  pivot.add(leaf);
  grp.add(pivot);
  grp.userData.pivot = pivot;
  return grp;
}
const SILL_D = 0.5;                      // 문지방 깊이(문틀 앞뒤로 걸치는 폭)
function makeSill(w, axis) {             // 바닥에 까는 문 표시 — 문짝을 감춰도 여기로 지나갈 수 있다는 걸 알린다
  const grp = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(axis === 'z' ? w : SILL_D, 0.04, axis === 'z' ? SILL_D : w),
    new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.8 }));
  plate.position.y = 0.02;
  plate.receiveShadow = true;
  grp.add(plate);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x7df3ff, transparent: true, opacity: 0.5, fog: false, toneMapped: false });
  for (const s of [-1, 1]) {             // 통로 방향을 알리는 하늘색 테두리 두 줄
    const bar = new THREE.Mesh(new THREE.BoxGeometry(axis === 'z' ? w : 0.05, 0.045, axis === 'z' ? 0.05 : w), lineMat);
    bar.position.set(axis === 'z' ? 0 : s * SILL_D / 2, 0.025, axis === 'z' ? s * SILL_D / 2 : 0);
    grp.add(bar);
  }
  grp.userData.glow = lineMat;
  return grp;
}
function makeEntranceDoors(x, z) {       // MY ROOM 현관 — 가운데서 양쪽으로 열리는 양문
  const grp = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.7, metalness: 0.3 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.75, metalness: 0.1 });
  const W = ENTRANCE_W, H = RM_DOOR_H;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, H + 0.1, 0.32), frameMat);
  post.position.set(-W / 2 - 0.045, (H + 0.1) / 2, 0);
  const post2 = post.clone(); post2.position.x = W / 2 + 0.045;
  const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.28, 0.1, 0.32), frameMat);
  top.position.y = H + 0.1;
  for (const m of [post, post2, top]) { m.castShadow = true; m.receiveShadow = true; }
  grp.add(post, post2, top);
  const leafW = W / 2;                    // 가운데서 정확히 맞닿는다 (겹침·어긋남 없음)
  const mk = sign => {                    // sign -1: 왼쪽 문, +1: 오른쪽 문 (경첩은 바깥쪽)
    const pivot = new THREE.Group();
    pivot.position.set(sign * W / 2, 0, 0);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, H, 0.07), leafMat);
    leaf.position.set(-sign * leafW / 2, H / 2, 0);   // 두 짝 모두 같은 면에
    leaf.castShadow = true; leaf.receiveShadow = true;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), frameMat);   // 손잡이
    bar.position.set(-sign * (leafW - 0.16), H * 0.48, 0.072);   // 손잡이는 문짝 앞면에
    pivot.add(leaf, bar);
    grp.add(pivot);
    return pivot;
  };
  grp.userData.left = mk(-1);
  grp.userData.right = mk(1);
  grp.userData.x = x; grp.userData.z = z; grp.userData.open = 0;
  grp.position.set(x, 0, z);
  return grp;
}
function makeBackdrop() {                // 층 전체를 감싸는 풍경 (지금 있는 방의 창밖)
  const lvl = worldRooms.filter(r => Math.abs((r.cy || 0) - activeLevel()) < 0.01);
  if (!lvl.length) return null;
  const key = roomStore.slots[standingSlot()]?.bg ?? curRoom().bg;
  const bg = BG_LIST.find(b => b.key === key) ?? BG_LIST[0];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of lvl) { const q = roomRect(r); x0 = Math.min(x0, q.x0); x1 = Math.max(x1, q.x1); z0 = Math.min(z0, q.z0); z1 = Math.max(z1, q.z1); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const fz0 = MAP_R.z0, fz1 = MAP_R.z1 + FIELD_EXTRA;                // 걸어 다닐 수 있는 범위
  const fieldR = Math.hypot(MAP_HALF, (fz1 - fz0) / 2) + 10;         // 그 바깥에 세워야 가까이서 벽처럼 보이지 않는다
  const rad = Math.max(90, Math.hypot(x1 - x0, z1 - z0) / 2 + 18, fieldR);   // 걸어 다녀도 가까워지지 않게 멀찍이
  const hgt = rad * 1.6;                 // 위쪽이 비어 하늘 대신 검은 배경이 보이지 않게 넉넉히
  const geo = new THREE.CylinderGeometry(rad, rad, hgt, 48, 1, true);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: bgTexture(bg.key), side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false,
  }));
  m.position.set(0, hgt * 0.3, (fz0 + fz1) / 2);                     // 걸어 다니는 범위의 한가운데
  return m;
}
const FENCE_H = 1.25, FENCE_GAP = 2.5;   // 울타리 높이 · 기둥 간격
function buildFence() {                  // 걸어 다닐 수 있는 영역(30×40m) 둘레
  if (srFence) {
    srScene.remove(srFence);
    srFence.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    srFence = null;
  }
  if (!yardRect()) return;               // 0층에 기본 방이 있어야 마당이 생긴다
  const OUT = 0.2;                       // 이동 경계에서 20cm 바깥에 세운다
  const x0 = MAP_R.x0 - OUT, x1 = MAP_R.x1 + OUT, z0 = MAP_R.z0 - OUT, z1 = MAP_R.z1 + FIELD_EXTRA + OUT;
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7d6547, roughness: 0.9 });
  const spots = [];                      // 기둥 자리
  for (let x = x0; x <= x1 + 0.01; x += FENCE_GAP) { spots.push([x, z0]); spots.push([x, z1]); }
  for (let z = z0 + FENCE_GAP; z <= z1 - FENCE_GAP + 0.01; z += FENCE_GAP) { spots.push([x0, z]); spots.push([x1, z]); }
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, FENCE_H, 0.12), mat, spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach((p, i) => { m4.makeTranslation(p[0], FENCE_H / 2, p[1]); posts.setMatrixAt(i, m4); });
  posts.castShadow = true; posts.receiveShadow = true;
  grp.add(posts);
  const rail = (w, d, x, y, z) => {      // 가로대
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), mat);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
  };
  for (const y of [FENCE_H * 0.42, FENCE_H * 0.82]) {
    rail(x1 - x0, 0.06, (x0 + x1) / 2, y, z0);
    rail(x1 - x0, 0.06, (x0 + x1) / 2, y, z1);
    rail(0.06, z1 - z0, x0, y, (z0 + z1) / 2);
    rail(0.06, z1 - z0, x1, y, (z0 + z1) / 2);
  }
  srFence = grp;
  srScene.add(grp);
}
function syncBackdropBg() {              // 서 있는 방이 바뀌면 풍경도 그 방 기준으로
  if (!srBackdrop) return;
  const key = roomStore.slots[standingSlot()]?.bg ?? curRoom().bg;
  const bg = BG_LIST.find(b => b.key === key) ?? BG_LIST[0];
  srBackdrop.material.map = bgTexture(bg.key);
  srBackdrop.material.needsUpdate = true;
}
function buildRoomMesh(r) {              // 바닥 · 벽(뒤=창, 옆=문 구멍) · 격자
  const grp = new THREE.Group();
  const W = r.w, D = r.d, h = ROOM_H;
  const sl0 = roomStore.slots[r.slot];
  const surfMats = [];                   // 면 재질 (조명 유무에 따라 밝기를 바꾼다)
  const floorHex = surfColor(sl0, 'floor');
  const floorMat = new THREE.MeshStandardMaterial({ color: floorHex, roughness: 0.85, metalness: 0.1 });
  surfMats.push({ m: floorMat, hex: floorHex });
  const hole = (r.holes || [])[0];       // 계단 자리는 뚫는다
  const slab = (x0, x1, z0, z1) => {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.12, z1 - z0), floorMat);
    m.position.set((x0 + x1) / 2, -0.06, (z0 + z1) / 2);
    grp.add(m);
  };
  if (!hole) slab(-W / 2, W / 2, -D / 2, D / 2);
  else {
    const hx0 = hole.x - hole.w / 2, hx1 = hole.x + hole.w / 2, hz0 = hole.z - hole.d / 2, hz1 = hole.z + hole.d / 2;
    slab(-W / 2, W / 2, -D / 2, hz0);
    slab(-W / 2, W / 2, hz1, D / 2);
    slab(-W / 2, hx0, hz0, hz1);
    slab(hx1, W / 2, hz0, hz1);
  }
  const ceilHex = surfColor(sl0, 'ceil');   // 천장은 빛이 거의 닿지 않아 고른 색이 그대로 보이도록 자체발광을 섞는다
  const ceilMat = new THREE.MeshStandardMaterial({
    color: ceilHex, roughness: 0.95, metalness: 0.05,
    emissive: new THREE.Color(ceilHex).multiplyScalar(0.55), emissiveIntensity: 1,
  });
  surfMats.push({ m: ceilMat, hex: ceilHex, emis: 0.55 });
  const ceilGrp = new THREE.Group();     // 천장 (위에서 볼 때는 감춘다)
  const ch = (r.ceilHoles || [])[0];
  const ceilSlab = (x0, x1, z0, z1) => {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.1, z1 - z0), ceilMat);
    m.position.set((x0 + x1) / 2, h + 0.05, (z0 + z1) / 2);
    ceilGrp.add(m);
  };
  if (!ch) ceilSlab(-W / 2, W / 2, -D / 2, D / 2);
  else {
    const cx0 = ch.x - ch.w / 2, cx1 = ch.x + ch.w / 2, cz0 = ch.z - ch.d / 2, cz1 = ch.z + ch.d / 2;
    ceilSlab(-W / 2, W / 2, -D / 2, cz0);
    ceilSlab(-W / 2, W / 2, cz1, D / 2);
    ceilSlab(-W / 2, cx0, cz0, cz1);
    ceilSlab(cx1, W / 2, cz0, cz1);
  }
  ceilGrp.userData.ceiling = true;
  grp.add(ceilGrp);
  // 기본 천장등 4개 — 가구와 무관하게 방마다 달려 있어 처음 들어와도 캐릭터가 잘 보인다 (빛은 고정 조명 풀에서)
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xffe2a8, emissiveIntensity: 1.2, roughness: 0.6 });
  for (const [lx, lz] of [[-W / 4, -D / 6], [W / 4, -D / 6], [-W / 4, D / 3], [W / 4, D / 3]]) {   // 뒤쪽 2개 + 앞쪽(카메라 쪽) 2개 — 캐릭터 앞면도 밝게
    const fix = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.06, 20), lampMat);
    fix.position.set(lx, h - 0.03, lz);
    fix.userData.lamp = { color: 0xfff1cc, i: LAMP_I * 0.45, dist: 5.5, y: -0.3 };
    fix.userData.builtin = true;
    grp.add(fix);
  }
  const wallMats = {};                   // 벽마다 색을 따로 (좌·우·뒤)
  for (const k of ['x-', 'x+', 'z-']) {
    const hex = surfColor(sl0, k);
    wallMats[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide });
    surfMats.push({ m: wallMats[k], hex });
  }
  const panel = (w, hh, x, y, z, ry, wall, target = grp) => {
    if (w <= 0.001 || hh <= 0.001) return;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), wallMats[wall] ?? wallMats['z-']);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.userData.wall = wall; m.userData.room = r.slot;
    target.add(m);
  };
  const wallRun = (len, holes, place) => {   // 구멍(문·창)을 피해 벽을 조각내 세운다
    const list = [...holes].sort((a, b) => a.u - b.u);
    let from = -len / 2;
    for (const g of list) {
      const a = g.u - g.w / 2, b = g.u + g.w / 2;
      place(Math.max(0, a - from), h, (from + a) / 2, h / 2);          // 구멍 왼쪽
      if (g.y0 > 0.001) place(g.w, g.y0, g.u, g.y0 / 2);               // 구멍 아래
      if (g.y1 < h - 0.001) place(g.w, h - g.y1, g.u, (h + g.y1) / 2); // 구멍 위
      from = Math.max(from, b);
    }
    place(Math.max(0, len / 2 - from), h, (from + len / 2) / 2, h / 2);
  };
  const INSET = 0.01;                    // 이웃 방 벽면과 같은 평면에 놓이지 않게 살짝 안쪽으로
  for (const sgn of [-1, 1]) {           // 좌·우 벽
    const x = sgn * (W / 2 - INSET);
    const holes = (r.gaps || []).filter(g => g.side === sgn)
      .map(g => ({ u: g.z, w: g.w ?? DOOR_W, y0: g.y0 ?? 0, y1: g.y1 ?? RM_DOOR_H }));
    wallRun(D, holes, (w, hh, u, cy) => panel(w, hh, x, cy, u, sgn * Math.PI / 2, sgn > 0 ? 'x+' : 'x-'));
  }
  const tunMat = new THREE.MeshStandardMaterial({ color: 0x323b47, roughness: 0.9, side: THREE.DoubleSide });
  for (const t of r.winTunnels || []) {   // 창문 통로 (옆방과 이어진 구간)
    const x = t.side * (W / 2 + ROOM_GAP / 2), hh = t.y1 - t.y0;
    for (const [pw, ph, pz, py, ry] of [
      [ROOM_GAP, t.w, 0, t.y0, 0], [ROOM_GAP, t.w, 0, t.y1, 0],          // 아래·위
      [ROOM_GAP, hh, -t.w / 2, t.y0 + hh / 2, 0], [ROOM_GAP, hh, t.w / 2, t.y0 + hh / 2, 0],
    ]) {
      const flat = ph === t.w && (py === t.y0 || py === t.y1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), tunMat);
      m.position.set(x, py, t.z + pz);
      if (flat) m.rotation.x = -Math.PI / 2;
      grp.add(m);
    }
  }
  const backHoles = (r.backGaps || []).map(g => ({ u: g.x, w: g.w, y0: g.y0, y1: g.y1 }));
  wallRun(W, backHoles, (w, hh, u, cy) => panel(w, hh, u, cy, -D / 2 + INSET, 0, 'z-'));   // 뒷벽 (창문 구멍)
  const frontGrp = new THREE.Group();    // 앞벽 — 내가 있는 방만 열어두고 나머지는 막아 안이 비치지 않게
  const frontHoles = (r.frontGaps || []).map(g => ({ u: g.x, w: g.w, y0: g.y0, y1: g.y1 }));
  wallRun(W, frontHoles, (w, hh, u, cy) => panel(w, hh, u, cy, D / 2 - INSET, Math.PI, 'z-', frontGrp));
  grp.add(frontGrp);
  r.front = frontGrp;
  r.guide = makeFloorGuide(W, D);        // 설치 가이드 격자 (활성 방만 표시)
  grp.add(r.guide);
  r.wallGuide = makeWallGuides(W, D, h);
  grp.add(r.wallGuide);
  grp.userData.surfMats = surfMats;
  grp.position.set(r.cx, r.cy || 0, r.cz);
  return grp;
}
function makeFloorGuide(W, D) {           // 10cm 격자 + 1m 굵은 선
  const grp = new THREE.Group();
  const thin = [], bold = [];
  const push = (arr, x1, z1, x2, z2) => arr.push(x1, 0, z1, x2, 0, z2);
  const nx = Math.round(W / GRID), nz = Math.round(D / GRID);
  for (let i = 0; i <= nx; i++) {
    const x = -W / 2 + i * GRID;
    push(i % 10 === 0 ? bold : thin, x, -D / 2, x, D / 2);
  }
  for (let j = 0; j <= nz; j++) {
    const z = -D / 2 + j * GRID;
    push(j % 10 === 0 ? bold : thin, -W / 2, z, W / 2, z);
  }
  for (const [pts, col, op] of [[thin, 0x39f6ff, 0.09], [bold, 0x39f6ff, 0.26]]) {
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    grp.add(new THREE.LineSegments(g2, new THREE.LineBasicMaterial({
      color: col, transparent: true, opacity: op, depthWrite: false, fog: false, toneMapped: false,
    })));
  }
  grp.position.y = 0.014;
  return grp;
}
function activeLevel() {
  const a = worldRooms.find(r => r.slot === roomStore.cur);
  return a ? (a.cy || 0) : 0;
}
function makeWallGuides(W, D, h) {        // 벽걸이·문 배치용 벽면 격자
  const grp = new THREE.Group();
  const mk = (w, x, z, ry) => {
    const thin = [], bold = [];
    const push = (arr, a, b, c, d2) => arr.push(a, b, 0, c, d2, 0);
    const nu = Math.round(w / GRID), nv = Math.round(h / GRID);
    for (let i = 0; i <= nu; i++) { const u = -w / 2 + i * GRID; push(i % 10 === 0 ? bold : thin, u, 0, u, h); }
    for (let j = 0; j <= nv; j++) { const v = j * GRID; push(j % 10 === 0 ? bold : thin, -w / 2, v, w / 2, v); }
    for (const [pts, op] of [[thin, 0.07], [bold, 0.2]]) {
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const seg = new THREE.LineSegments(g2, new THREE.LineBasicMaterial({
        color: 0x39f6ff, transparent: true, opacity: op, depthWrite: false, fog: false, toneMapped: false,
      }));
      seg.position.set(x, 0, z); seg.rotation.y = ry;
      grp.add(seg);
    }
  };
  mk(D, -W / 2 + 0.02, 0, Math.PI / 2);    // 좌
  mk(D, W / 2 - 0.02, 0, -Math.PI / 2);    // 우
  mk(W, 0, -D / 2 + 0.02, 0);              // 뒤
  grp.visible = false;
  return grp;
}
function segHitsRect(x0, z0, x1, z1, q, pad = 0.3) {   // 선분이 사각형을 지나는가 (카메라→나 시야)
  const rx0 = q.x0 - pad, rx1 = q.x1 + pad, rz0 = q.z0 - pad, rz1 = q.z1 + pad;
  if (Math.max(x0, x1) < rx0 || Math.min(x0, x1) > rx1) return false;
  if (Math.max(z0, z1) < rz0 || Math.min(z0, z1) > rz1) return false;
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  for (const [p, q0, q1] of [[dx, rx0 - x0, rx1 - x0], [dz, rz0 - z0, rz1 - z0]]) {
    if (Math.abs(p) < 1e-6) { if (q0 > 0 || q1 < 0) return false; continue; }
    let a2 = q0 / p, b2 = q1 / p;
    if (a2 > b2) { const t = a2; a2 = b2; b2 = t; }
    t0 = Math.max(t0, a2); t1 = Math.min(t1, b2);
    if (t0 > t1) return false;
  }
  return true;
}
function inSightCone(q, camX, camZ, meX, meZ) {   // 카메라와 나 사이, 화면에 걸치는 방인가
  const fx = meX - camX, fz = meZ - camZ;
  const flen = Math.hypot(fx, fz);
  if (flen < 0.3) return false;
  const ux = fx / flen, uz = fz / flen;
  const HALF = 0.62;                     // 시야 반각 ≈32°
  const pts = [[q.x0, q.z0], [q.x1, q.z0], [q.x0, q.z1], [q.x1, q.z1],
    [(q.x0 + q.x1) / 2, (q.z0 + q.z1) / 2]];
  for (const [px, pz] of pts) {
    const dx = px - camX, dz = pz - camZ;
    const t = dx * ux + dz * uz;         // 시선 축 방향 거리
    if (t < 0.2 || t > flen - 0.2) continue;   // 카메라 뒤 · 나보다 먼 곳은 가리지 않는다
    if (Math.abs(dx * uz - dz * ux) <= t * HALF) return true;
  }
  return false;
}
function syncGuides() {                   // 활성 방에만 가이드라인 · 현재 층·시야 앞은 감춘다
  const lvl = activeLevel();
  const act = worldRooms.find(r => r.slot === roomStore.cur);
  const frontZ = srMode === 'live' ? live.z - 0.5 : (act ? act.cz + act.d / 2 : 0);   // 카메라와 나 사이의 방은 감춘다
  const eyeX = srMode === 'live' ? live.x : (act ? act.cx : 0);
  const doorNear = new Set();             // 문틀을 지나는 중이면 양쪽 방을 함께 열어 둔다 (캐릭터가 벽에 잘리지 않게)
  if (srMode === 'live') {
    for (const d of liveDoors) {
      if (Math.hypot(live.x - d.x, live.z - d.z) > 2.2) continue;
      doorNear.add(d.from); doorNear.add(d.to);
    }
  }
  const live3 = srMode === 'live';
  const outdoors = live3 && (inYard(live.x, live.z) || inField(live.x, live.z));   // 집 밖에 서 있나
  const camFlat = Math.cos(live.camPitch) * live.camDist;   // 렌더 순서와 무관하게 카메라 위치를 직접 계산
  const camX = live3 ? live.x + Math.sin(live.camYaw) * camFlat : eyeX;
  const camZ = live3 ? live.z + Math.cos(live.camYaw) * camFlat : frontZ + 6;
  const meX = live3 ? live.x : eyeX, meZ = live3 ? live.z : frontZ;
  const meRoom = live3 ? (worldRooms.find(r => r.slot === standingSlot()) || act) : act;   // 지금 서 있는 방
  const actQ = meRoom ? roomRect(meRoom) : null;
  const segHit = (px, pz, half) => {      // 카메라와 나 사이를 가로막고 있나
    const dx = meX - camX, dz = meZ - camZ;
    const L2 = dx * dx + dz * dz || 1;
    const t = ((px - camX) * dx + (pz - camZ) * dz) / L2;
    if (t <= 0.05 || t >= 0.95) return false;            // 카메라 뒤·내 뒤는 상관없다
    const ct = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (camX + dx * ct), pz - (camZ + dz * ct)) < half;
  };
  for (const r of worldRooms) {
    const onLvl = Math.abs((r.cy || 0) - lvl) < 0.01;
    const q = roomRect(r);
    // 규칙: 내가 있는 방보다 앞(+z)에 있는 방만 감춘다 — 옆방·뒷방은 그대로 그린다
    const frontLine = actQ ? actQ.z1 : meZ;
    const inFront = meRoom && r !== meRoom && !outdoors && q.z0 >= frontLine - 0.01;
    r.grp.visible = onLvl && !inFront;    // 다른 층·앞을 가리는 방은 숨긴다

    if (r.front) r.front.visible = outdoors || (r.slot !== standingSlot() && !doorNear.has(r.slot));   // 안에 있거나 문을 지날 때만 앞이 열린다
    const editing = (srMode !== 'live' || srEditUI) && !!(placeType || moveItem || srPickSel);   // 실제로 놓거나 고르는 중에만 격자 · 생활모드는 '방 편집'이 켜져 있을 때만
    const active = onLvl && !inFront && r.slot === roomStore.cur;
    const kind = placeType ? FURN[placeType].mount : moveItem ? FURN[moveItem.type].mount : srPickSel ? FURN[srPickSel.type].mount : null;
    const onWall = kind === 'wall' || kind === 'opening';
    if (r.guide) r.guide.visible = active && editing && !onWall;
    if (r.wallGuide) r.wallGuide.visible = active && editing && onWall;
  }
  for (const d of liveDoors) {           // 문짝: 이어진 방 중 하나라도 보이면 그린다 (양쪽 다 숨으면 허공에 뜨므로 숨김)
    if (!d.panel) continue;
    const ra = worldRooms.find(r => r.slot === d.from), rb = worldRooms.find(r => r.slot === d.to);
    const onLvl = Math.abs((ra?.cy || 0) - lvl) < 0.01;
    const show = onLvl && (!!ra?.grp?.visible || !!rb?.grp?.visible);
    const onFrontWall = actQ && d.z >= actQ.z1 - 0.05;   // 내 방 앞선에 걸린 문 = 앞벽 문 → 앞벽과 같이 감춘다
    d.panel.visible = show && !onFrontWall;
    if (d.sill) {                        // 문짝을 감춰도 바닥 표시는 남긴다
      d.sill.visible = show;
      const near = live3 && Math.hypot(live.x - d.x, live.z - d.z) < 2.4;
      d.sill.userData.glow.opacity = near ? 0.85 : 0.4;
    }
  }
  if (srEntrance) {                      // 현관문은 MY ROOM 앞벽과 같이 보이고 같이 숨는다 (바닥 표시는 항상)
    const e = srEntrance.userData;
    const base = worldRooms.find(r => r.slot === 0);
    const blocks = !base?.front?.visible;   // 앞벽을 가릴 때 현관문도 같이 감춘다
    srEntrance.visible = !blocks;
    if (e.sill) {
      e.sill.visible = true;
      e.sill.userData.glow.opacity = live3 && Math.hypot(live.x - e.x, live.z - e.z) < 2.6 ? 0.85 : 0.4;
    }
  }
  if (srFurnGrp) for (const m of srFurnGrp.children) {   // 다른 층 가구는 감추고, 계단은 잇는 두 층에서 보인다
    const rr = worldRooms.find(r => r.slot === m.userData.room);
    const stairs = m.userData.item?.type === 'stairs';
    const lo = m.userData.roomY ?? (rr?.cy || 0);
    const onLv = !rr || Math.abs(lo - lvl) < 0.01 || (stairs && Math.abs(lo + LEVEL_H - lvl) < 0.01);
    const link = !!FURN[m.userData.item?.type]?.link;      // 문·계단은 벽에 걸려 있어 남긴다
    const mine = !rr || rr.slot === standingSlot();        // 다른 방은 앞벽에 가려지니 안은 그리지 않는다 (조명도 함께 꺼진다)
    m.visible = onLv && ((rr?.grp?.visible ?? true) || stairs) && (mine || link);
  }
}
function addOutline(grp) {                // 메쉬 모서리에 검은 선
  const edges = [];
  grp.traverse(o => { if (o.isMesh && o.geometry) edges.push(o); });
  for (const o of edges) {
    const eg = new THREE.EdgesGeometry(o.geometry, 35);
    const ln = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x0b0e12, transparent: true, opacity: 0.85 }));
    ln.position.copy(o.position); ln.rotation.copy(o.rotation); ln.scale.copy(o.scale);
    ln.userData.outline = true;
    ln.raycast = () => { };              // 외곽선은 클릭·배치 판정에서 제외 (선은 1m 반경이 잡힌다)
    o.parent.add(ln);
  }
}
function buildFurnitureAll() {            // 두 방의 가구를 한 그룹에
  if (srFurnGrp) srScene.remove(srFurnGrp);
  srFurnGrp = new THREE.Group();
  for (const r of worldRooms) {
    for (const it of roomStore.slots[r.slot].items) {
      if (it.type === 'door' && liveDoors.some(d => d.item === it)) continue;   // 이어진 문은 별도 연출
      const fdef = FURN[it.type];        // 설치면에 맞는 높이로 항상 보정 (예전 저장본 포함)
      if (fdef.mount === 'ceiling') it.y = +(ROOM_H - fdef.h).toFixed(2);
      else if (fdef.mount === 'wall' && !(it.y > 0.05)) it.y = fdef.wallY ?? 1.3;
      else if (fdef.mount === 'floor' && !(it.y >= 0)) it.y = 0;
      else if (fdef.mount === 'floor' && it.y > 0.05) {   // 상판 위 물건은 상판 높이가 바뀌어도 얹혀 있게
        const host = roomStore.slots[r.slot].items.find(o => {
          if (o === it) return false;
          const top = itemTop(o);
          if (top === null || Math.abs(top - it.y) > 0.12) return false;
          const fo = footprint(o.type, o.rot);
          return Math.abs(o.x - it.x) <= fo.w / 2 + 0.01 && Math.abs(o.z - it.z) <= fo.d / 2 + 0.01;
        });
        if (host) it.y = +itemTop(host).toFixed(2);
      }
      const m = furnMesh(it.type, it);
      if (!FURN[it.type].glow) {          // 조명 유무에 따라 밝기를 바꿀 수 있게 원래 색을 기억해 둔다
        m.traverse(o => {
          if (o.isMesh && o.material?.color && !o.userData.outline) {
            o.material = o.material.clone();
            o.userData.baseCol = o.material.color.clone();
          }
        });
      }
      const down = it.type === 'stairs' && it.dir === 'down' && it.link >= 0 && !it.blocked;
      const baseY = (r.cy || 0) - (down ? LEVEL_H : 0);   // 이어진 내려가는 계단만 아래층에 놓인다
      m.position.set(r.cx + it.x, baseY + (it.y || 0), r.cz + it.z);
      m.rotation.y = (it.rot || 0) * ROT_STEP;
      if (outlineOn) addOutline(m);
      m.userData.item = it;
      m.userData.room = r.slot;
      m.userData.roomY = baseY;
      srFurnGrp.add(m);
    }
  }
  srScene.add(srFurnGrp);
  syncOutline();
  syncGuides();                          // 숨긴 방의 가구·조명까지 같이 감춘다
}
// ---- 생활 모드 이동 ----
function liveEnter() {                     // 현 위치·현 시선 그대로 이어받는다
  srMode = 'live';
  syncGuides();
  const r = worldRooms.find(w => w.slot === roomStore.cur) ?? worldRooms[0];
  live.active = r ? r.slot : roomStore.cur;
  live.yaw = srYaw;                       // 캐릭터가 보던 방향 유지
  live.camDist = Math.max(1.6, srView.dist);
  setSel(null); cancelPlace(); hideCtx();
  srSpin = false;
  toast('🚶 생활 모드 — WASD 이동, 문으로 옆방 이동');
  srRenderModeUI();
}
function liveExit() {                      // 서 있던 자리·바라보던 각도 그대로
  srMode = 'pose';
  syncGuides();
  srYaw = live.yaw;
  srTarget.dist = live.camDist; srView.dist = live.camDist;
  srPan.x = 0; srPanned = false; srSel = null;
  srTarget.y = SR_FULL.y;
  if (srRoot) { srRoot.position.set(live.x, 0, live.z); srRoot.rotation.y = srYaw; }
  srPlay('rifle aiming idle');
  toast('🧍 포즈 모드');
  srRenderModeUI();
}
function stairAt(x, z) {                 // 계단 위인가 (0=아래, 1=위)
  const f = FURN.stairs;
  for (const st of liveStairs) {
    const a = (st.rot || 0) * ROT_STEP, ca = Math.cos(a), sa = Math.sin(a);   // 월드→계단 로컬 (부호 반대로 하면 좌우가 뒤집힌다)
    const dx = x - st.x, dz = z - st.z;
    const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
    if (Math.abs(lx) < f.w / 2 + 0.1 && Math.abs(lz) < f.d / 2 + 0.1) {
      return { st, t: Math.max(0, Math.min(1, (f.d / 2 - lz) / f.d)) };
    }
  }
  return null;
}
function insideRooms(x, z, pad = 0.28) {
  if (stairAt(x, z)) return live.active;  // 계단은 언제나 통행
  for (const r of worldRooms) {
    if (Math.abs((r.cy || 0) - live.y) > 1.4) continue;   // 다른 층은 무시
    const q = roomRect(r);
    if (x > q.x0 + pad && x < q.x1 - pad && z > q.z0 + pad && z < q.z1 - pad) return r.slot;
  }
  for (const d of liveDoors) {           // 문틀 통로
    const a = d.axis === 'z' ? z - d.z : x - d.x, b = d.axis === 'z' ? x - d.x : z - d.z;
    if (Math.abs(a) < 0.5 && Math.abs(b) < DOOR_W / 2 - 0.1) return live.active;
  }
  const yr = yardRect();                 // 현관 통로 + 앞마당 (기본 방 기준 0층)
  if (yr && Math.abs(live.y) < 1.4) {
    const doorX = (yr.x0 + yr.x1) / 2;
    if (Math.abs(z - yr.z0) < 0.75 && Math.abs(x - doorX) < ENTRANCE_W / 2 - 0.15) return 0;   // 현관 문틀만 통과
    if (inYard(x, z, pad) || inField(x, z)) return 0;        // 마당과 30×30 필드는 자유 이동
  }
  return -1;
}
function blockedByFurniture(x, z) {
  for (const r of worldRooms) {
    if (Math.abs((r.cy || 0) - live.y) > 1.4) continue;
    for (const it of roomStore.slots[r.slot].items) {
      const f = FURN[it.type];
      if (!f.blocking || it.type === 'stairs') continue;   // 러그·벽걸이·천장물·계단은 통과
      if ((it.y || 0) > 1.2 || (it.y || 0) + f.h < 0.25) continue;   // 머리 위·발밑은 통과
      const fp = footprint(it.type, it.rot);
      const ix = r.cx + it.x, iz = r.cz + it.z;
      if (Math.abs(x - ix) < fp.w / 2 + 0.26 && Math.abs(z - iz) < fp.d / 2 + 0.26) return true;
    }
  }
  return false;
}
function liveStep(dt) {
  const sp = 4.4;                        // 기본 이동 = 달리기
  let mx = 0, mz = 0;
  if (keys['KeyW']) mz -= 1; if (keys['KeyS']) mz += 1;
  if (keys['KeyA']) mx -= 1; if (keys['KeyD']) mx += 1;
  if (isMobileCtrl()) { mx += touchMove.x; mz += touchMove.z; }   // 모바일: 좌하단 이동 조그
  const len = Math.max(1, Math.hypot(mx, mz));
  const cy = Math.cos(live.camYaw), sy = Math.sin(live.camYaw);
  const dx = (-sy * -mz + cy * mx) / len, dz = (-cy * -mz - sy * mx) / len;
  live.moving = Math.abs(mx) + Math.abs(mz) > 0;
  live.dashCd = Math.max(0, live.dashCd - dt);
  if ((keys['ShiftLeft'] || keys['ShiftRight']) && live.dashCd <= 0) {   // 대쉬
    live.dashX = live.moving ? dx : Math.sin(live.yaw);
    live.dashZ = live.moving ? dz : Math.cos(live.yaw);
    live.dashT = 0.18; live.dashCd = 1.0;
    sfxDash();
  }
  if (live.dashT > 0) {                  // 대쉬 이동 (벽·가구엔 막힌다)
    live.dashT -= dt;
    const nx = live.x + live.dashX * 12 * dt, nz = live.z + live.dashZ * 12 * dt;
    if (insideRooms(nx, live.z) >= 0 && !blockedByFurniture(nx, live.z)) live.x = nx;
    if (insideRooms(live.x, nz) >= 0 && !blockedByFurniture(live.x, nz)) live.z = nz;
    live.yaw = Math.atan2(live.dashX, live.dashZ);
  }
  if (live.moving) {
    const nx = live.x + dx * sp * dt, nz = live.z + dz * sp * dt;
    if (insideRooms(nx, live.z) >= 0 && !blockedByFurniture(nx, live.z)) live.x = nx;
    if (insideRooms(live.x, nz) >= 0 && !blockedByFurniture(live.x, nz)) live.z = nz;
    live.yaw = Math.atan2(dx, dz);        // 모델 정면(+z) 기준 — 가는 쪽을 본다
  }
  // 문: 가까우면 열리고, 지나가면 닫힌다
  for (const d of liveDoors) {
    const fromRoom = worldRooms.find(r => r.slot === d.from);
    if (fromRoom && Math.abs((fromRoom.cy || 0) - live.y) > 1.4) continue;   // 다른 층의 문은 무시
    const dist = Math.hypot(live.x - d.x, live.z - d.z);
    const near = dist < 1.6;
    const along = d.axis === 'z' ? live.z - d.z : live.x - d.x;   // 문을 지났는가
    const crossed = along * d.side > 0.15;
    const room = crossed ? d.to : d.from;
    if (dist < 2.6 && room !== live.active) {   // 문 근처에서만 방이 바뀐다
      live.active = room;
      roomStore.cur = room;               // 활성 방(= 창밖 풍경·편집 기준)
      setSel(null); hideCtx();            // 방을 옮기면 고른 물건은 해제
      syncGuides();
      srBgLight?.color.setHex((BG_LIST.find(b => b.key === roomStore.slots[room].bg) ?? BG_LIST[0]).tint);
      syncBackdropBg();
      roomSave(); roomRenderUI();
      toast('🚪 ' + roomStore.slots[room].name);
    }
    const want = near && Math.abs(along) < 1.2 ? 1 : 0;
    d.open += (want - d.open) * Math.min(1, dt * 6);
    d.panel.userData.pivot.rotation.y = -d.open * Math.PI * 0.55;
  }
  if (srEntrance) {                      // 현관 양문 — 가까우면 바깥쪽으로 활짝
    const e = srEntrance.userData;
    const near = Math.abs(live.y) < 1.4 && Math.hypot(live.x - e.x, live.z - e.z) < 2.4;
    e.open += ((near ? 1 : 0) - e.open) * Math.min(1, dt * 6);
    e.left.rotation.y = -e.open * 1.5;
    e.right.rotation.y = e.open * 1.5;
  }
  const onStair = stairAt(live.x, live.z);            // 계단을 오르내리면 높이가 바뀐다
  let ground = 0;
  if (onStair) {
    ground = onStair.st.y0 + (onStair.st.y1 - onStair.st.y0) * onStair.t;
    const room = onStair.t > 0.7 ? onStair.st.to : onStair.t < 0.3 ? onStair.st.from : live.active;
    if (room !== live.active) {
      live.active = room; roomStore.cur = room;
      setSel(null); hideCtx();            // 계단으로 층을 옮겨도 해제
      syncGuides(); roomSave(); roomRenderUI();
      toast('🪜 ' + roomStore.slots[room].name);
    }
  } else {
    const here = worldRooms.find(r => r.slot === live.active);
    ground = here ? (here.cy || 0) : 0;
  }
  const grounded = live.y <= ground + 0.02 && live.vy <= 0;
  if (keys['Space'] && grounded) live.vy = 4.6;       // 점프
  live.vy -= 13.5 * dt;
  live.y += live.vy * dt;
  if (live.y <= ground) { live.y = ground; live.vy = 0; }
  if (srRoot) {
    srRoot.position.set(live.x, live.y, live.z);
    srRoot.rotation.y = live.yaw;
  }
  srPlay(live.y > ground + 0.06 ? 'rifle jump' : live.moving ? 'rifle run' : 'rifle aiming idle');   // 기본이 달리기
  if (innerWidth > 0 && renderer.domElement.width !== Math.floor(innerWidth * (renderer.getPixelRatio() || 1))) renderer.setSize(innerWidth, innerHeight);   // 창 크기와 어긋나면 맞춘다
  syncGuides();            // 걸어 다니는 동안에도 가림·표시를 다시 계산 (밖에서 방이 사라지던 문제)
  liveApplyCam();
  drawRoomMap();
}
// ---- 연결 미니맵 ----
let srStageLights = [];                   // 방의 조명 유무에 따라 세기를 조절한다
function syncStageDim() {                 // 지금 있는 방에 불이 없으면 무대 조명을 낮춘다
  const sl = roomStore.slots[srMode === 'live' ? (live.active ?? roomStore.cur) : roomStore.cur];
  const k = litMul(sl, DARK_L);
  for (const l of srStageLights) {
    const base = l.userData.base ?? l.intensity;
    const want = base * k;
    if (Math.abs(l.intensity - want) > 0.001) l.intensity += (want - l.intensity) * 0.25;   // 부드럽게
  }
}
let slotFloor = null;                     // 방 목록에서 고른 층 (null = 지금 있는 층)
let mapZoom = 1;                          // 미니맵 배율 (휠)
function drawRoomMap() {
  const cv = document.getElementById('srMap');
  if (!cv) return;
  const show = srMode === 'live';   // 생활모드면 방이 하나뿐이어도 띄운다
  cv.style.display = show ? 'block' : 'none';
  const eb = document.getElementById('srMapEdit');
  if (eb) eb.style.display = show ? 'block' : 'none';
  const zb = document.getElementById('srMapZoom');
  if (zb) { zb.style.display = show ? 'block' : 'none'; zb.textContent = '🔍 ' + mapZoom.toFixed(1) + '×'; }
  const lb = document.getElementById('srMapLv');
  if (lb) {
    lb.style.display = show ? 'block' : 'none';
    const n = Math.round((srMode === 'live' ? live.y : activeLevel()) / LEVEL_H);
    lb.textContent = n >= 0 ? (n + 1) + 'F' : 'B' + (-n);
  }
  if (!show) return;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  const lv0 = srMode === 'live' ? live.y : activeLevel();
  const here = worldRooms.find(r => r.slot === live.active) ?? worldRooms.find(r => r.slot === roomStore.cur);
  if (!here) return;
  // 배율은 층 맵 30×30m 기준으로 고정 · 화면은 늘 내가 가운데 (휠로 확대)
  const view = (MAP_HALF * 2) / mapZoom;
  const cxm = srMode === 'live' ? live.x : here.cx;
  const czm = srMode === 'live' ? live.z : here.cz;
  const pad = 10, span = cv.width - pad * 2;
  const k = span / view;
  const minX = cxm - view / 2, minZ = czm - view / 2;
  const px = x => pad + (x - minX) * k, pz = z => pad + (z - minZ) * k;
  c.save();
  c.beginPath(); c.rect(pad - 2, pad - 2, span + 4, span + 4); c.clip();   // 미니맵 밖으로 새지 않게
  c.fillStyle = 'rgba(26,30,34,.72)';    // 설치 가능 구역(30×30) 밖
  const mx0 = px(MAP_R.x0), mx1 = px(MAP_R.x1), mz0 = pz(MAP_R.z0), mz1 = pz(MAP_R.z1);
  c.fillRect(pad - 2, pad - 2, span + 4, Math.max(0, mz0 - pad + 2));                       // 위
  c.fillRect(pad - 2, mz1, span + 4, Math.max(0, pad + span + 2 - mz1));                    // 아래
  c.fillRect(pad - 2, mz0, Math.max(0, mx0 - pad + 2), Math.max(0, mz1 - mz0));             // 왼쪽
  c.fillRect(mx1, mz0, Math.max(0, pad + span + 2 - mx1), Math.max(0, mz1 - mz0));          // 오른쪽
  c.strokeStyle = 'rgba(150,165,180,.45)'; c.lineWidth = 1.5;
  c.strokeRect(mx0, mz0, mx1 - mx0, mz1 - mz0);
  for (const r of worldRooms) {
    const lv = srMode === 'live' ? live.y : activeLevel();
    if (Math.abs((r.cy || 0) - lv) > 1.4) continue;   // 현재 층만
    const q = roomRect(r);
    c.fillStyle = r.slot === live.active ? 'rgba(64,214,255,.22)' : 'rgba(120,160,180,.12)';
    c.fillRect(px(q.x0), pz(q.z0), (q.x1 - q.x0) * k, (q.z1 - q.z0) * k);
    c.strokeStyle = r.slot === live.active ? '#7df3ff' : '#4a6b7a';
    c.lineWidth = 2.5;
    c.strokeRect(px(q.x0), pz(q.z0), (q.x1 - q.x0) * k, (q.z1 - q.z0) * k);
    c.fillStyle = '#9fd8ea'; c.font = '13px system-ui'; c.textAlign = 'center';
    c.fillText(roomStore.slots[r.slot].name.slice(0, 10), px(r.cx), pz(r.cz - r.d / 2) + 16);
  }
  const onLv = slot => {                 // 이 층에 있는 방인가
    const r = worldRooms.find(w => w.slot === slot);
    return r && Math.abs((r.cy || 0) - lv0) < 0.01;
  };
  for (const d of liveDoors) {           // 문 (이 층만 · 축에 맞춰)
    if (!onLv(d.from) && !onLv(d.to)) continue;
    c.strokeStyle = '#ffd76b'; c.lineWidth = 5;
    c.beginPath();
    if (d.axis === 'z') { c.moveTo(px(d.x - DOOR_W / 2), pz(d.z)); c.lineTo(px(d.x + DOOR_W / 2), pz(d.z)); }
    else { c.moveTo(px(d.x), pz(d.z - DOOR_W / 2)); c.lineTo(px(d.x), pz(d.z + DOOR_W / 2)); }
    c.stroke();
  }
  roomStore.slots.forEach((sl, i) => {   // 계단 — 이 층에 걸린 것 모두 (연결 안 된 것도)
    const r = worldRooms.find(w => w.slot === i);
    if (!r) return;
    const own = Math.abs((r.cy || 0) - lv0) < 0.01;
    for (const it of sl.items) {
      if (it.type !== 'stairs') continue;
      const goUp = (it.dir ?? 'up') === 'up';
      const other = (r.cy || 0) + (goUp ? LEVEL_H : -LEVEL_H);
      const near = Math.abs(other - lv0) < 0.01;
      if (!own && !near) continue;
      const sx = r.cx + it.x, sz = r.cz + it.z;
      const fp = footprint('stairs', it.rot);
      c.fillStyle = it.blocked ? 'rgba(255,120,100,.5)' : 'rgba(155,231,160,.5)';
      c.fillRect(px(sx - fp.w / 2), pz(sz - fp.d / 2), fp.w * k, fp.d * k);
      c.strokeStyle = it.blocked ? '#ff8a7a' : '#9be7a0'; c.lineWidth = 1;
      c.strokeRect(px(sx - fp.w / 2), pz(sz - fp.d / 2), fp.w * k, fp.d * k);
      c.fillStyle = '#eafff0'; c.font = 'bold 14px system-ui'; c.textAlign = 'center';
      c.fillText(own === goUp ? '▲' : '▼', px(sx), pz(sz) + 5);   // 이 층에서 오르는지 내리는지
    }
  });
  if (srMode === 'live') {               // 플레이어 — 방향 화살표 + 점 (층은 미니맵 옆 배지)
    const mx = px(live.x), mz = pz(live.z);
    const a = live.yaw;                   // 모델 정면 = (sin yaw, cos yaw)
    c.save();
    c.translate(mx, mz); c.rotate(Math.PI - a);   // 지도는 +z 가 아래 · 삼각형 기본이 위쪽
    c.beginPath();                        // 삼각형(진행 방향)
    c.moveTo(0, -13); c.lineTo(8, 7); c.lineTo(0, 3); c.lineTo(-8, 7); c.closePath();
    c.fillStyle = '#7ee0a3'; c.fill();
    c.lineWidth = 2; c.strokeStyle = 'rgba(4,16,24,.9)'; c.stroke();
    c.restore();
    c.beginPath(); c.arc(mx, mz, 4, 0, Math.PI * 2);
    c.fillStyle = '#eafff2'; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = '#0d2a1c'; c.stroke();
  }
  c.restore();
}
function syncRightFold() {
  const liveNow = srMode === 'live';
  const rp = document.getElementById('srRight');
  const folded = liveNow && srEditUI && srRightFolded;
  rp.classList.toggle('folded', folded);
  document.getElementById('srRightTab').classList.toggle('on', folded);
}
function srRenderModeUI() {
  const liveNow = srMode === 'live';
  syncRightFold();
  const mb = document.getElementById('srModeBtn');
  if (mb) { mb.textContent = liveNow ? '🚶 생활모드' : '🧍 포즈모드'; mb.classList.toggle('on', liveNow); mb.title = liveNow ? '포즈모드로 전환' : '생활모드로 전환'; }
  document.body.classList.toggle('srLive', srOn && liveNow);
  for (const t of document.querySelectorAll('#srTabs button')) {   // 포즈=장비·의상 · 생활=방 설정·벽·풍경·가구
    const roomTab = isRoomTab(t.dataset.tab);
    t.style.display = (liveNow ? roomTab : !roomTab) ? '' : 'none';
  }
  if (liveNow && !isRoomTab(srTab)) { srTab = 'room'; srRenderInv(); }
  if (!liveNow && isRoomTab(srTab)) { srTab = 'gear'; srRenderInv(); }
  document.getElementById('srLeft').style.display = liveNow ? 'none' : '';
  document.getElementById('srRight').style.display = liveNow && !srEditUI ? 'none' : '';   // 생활모드에서는 '방 편집'을 눌러야 우측 패널
  document.getElementById('srBottom').style.display = liveNow ? 'none' : '';   // 회전·포즈·전신 보기는 포즈모드 전용
  const lb = document.getElementById('srLiveBar');
  lb.style.display = liveNow ? 'flex' : 'none';   // 방 관리 버튼은 생활모드 전용
  lb.classList.toggle('editing', srEditUI);
  if (mb) lb.style.right = (24 + mb.offsetWidth + 12) + 'px';   // 모드 버튼 바로 왼쪽에 붙인다
  lb.querySelector('[data-act="edit"]')?.classList.toggle('on', srEditUI);
  syncSaveBtn(); syncUndoBtn();
  document.getElementById('srHint').textContent = srMode === 'live'
    ? 'WASD 이동 · Shift 대쉬 · Space 점프 · 좌드래그 카메라 · 휠 거리 · 문 앞에서 자동으로 열립니다'
    : '좌드래그 회전 · 우드래그 카메라 이동 · 휠 확대(쇄골 기준) · 좌측 슬롯을 누르면 해당 부위를 비춥니다';
  drawRoomMap();
}

// ---------- 쇼룸 (디버그 전용): 캐릭터를 세워두고 파츠 슬롯을 살펴본다 ----------
// 파츠는 아직 나뉘어 있지 않아서 슬롯은 자리만 잡아두고, 카메라 줌·포즈로 부위를 보여준다.
const SR_GEAR = [
  { key: 'gun', name: '총', icon: '🔫', bone: /hand.*r|righthand/i, y: 1.25, dist: 1.5, clip: 'firing rifle' },
  { key: 'grenade', name: '수류탄', icon: '💣', bone: /hand.*l|lefthand/i, y: 1.2, dist: 1.4, clip: 'toss grenade' },
  { key: 'mine', name: '지뢰', icon: '🧨', bone: /hips|spine$/i, y: 0.95, dist: 1.6, clip: 'reloading' },
];
const SR_WEAR = [
  { key: 'head', name: '머리', icon: '🎧', bone: /head/i, y: 1.62, dist: 0.9, clip: 'rifle aiming idle' },
  { key: 'top', name: '상의', icon: '👕', bone: /spine2|spine1|spine$/i, y: 1.35, dist: 1.3, clip: 'strafe' },
  { key: 'bottom', name: '하의', icon: '🩳', bone: /hips/i, y: 0.9, dist: 1.4, clip: 'walking' },
  { key: 'glove', name: '장갑', icon: '🧤', bone: /forearm.*l|lowerarm.*l|hand.*l/i, y: 1.1, dist: 1.0, clip: 'reloading' },
  { key: 'boots', name: '부츠', icon: '👟', bone: /foot.*l|leg.*l/i, y: 0.25, dist: 1.2, clip: 'rifle run' },
];
const SR_INV = {                          // 지금은 기본 파츠만 (교체 시스템은 이후)
  gear: [
    { key: 'gun', icon: '🔫', name: '기본 소총' }, { key: 'grenade', icon: '💣', name: '기본 수류탄' },
    { key: 'mine', icon: '🧨', name: '기본 지뢰' },
  ],
  wear: [
    { key: 'head', icon: '🎧', name: '기본 머리' }, { key: 'top', icon: '👕', name: '기본 상의' },
    { key: 'bottom', icon: '🩳', name: '기본 하의' }, { key: 'glove', icon: '🧤', name: '기본 장갑' },
    { key: 'boots', icon: '👟', name: '기본 부츠' },
  ],
};
const srEquip = { gun: '기본 소총', grenade: '기본 수류탄', mine: '기본 지뢰', head: '기본 머리', top: '기본 상의', bottom: '기본 하의', glove: '기본 장갑', boots: '기본 부츠' };
let srOn = false, srScene = null, srCam = null, srRoot = null, srMixer = null, srActions = {}, srCurrent = null;
const ROOM_TABS = ['room', 'paint', 'view', 'furn'];   // 공간을 네 갈래로 나눈 탭
const isRoomTab = t => ROOM_TABS.includes(t);
let srYaw = 0, srSpin = false, srDrag = null, srSel = null, srTab = 'gear';   // 대기 중엔 회전하지 않는다
const SR_FULL = { y: 0.95, dist: 4.2 }, SR_FOV = 38;
const srHalfH = d => d * Math.tan(SR_FOV * Math.PI / 360);   // 화면 절반 높이(m)
function srClampView() {                 // 확대한 만큼만 상하·좌우로 움직일 수 있다
  const h = srHalfH(srTarget.dist), fh = srHalfH(SR_FULL.dist);
  const limY = Math.max(0, fh - h);
  const aspect = srCam ? srCam.aspect : 1.7;
  const limX = Math.max(0, (fh - h) * aspect);
  srTarget.y = Math.max(SR_FULL.y - limY, Math.min(SR_FULL.y + limY, srTarget.y));
  srPan.x = Math.max(-limX, Math.min(limX, srPan.x));
}
let srPan = { x: 0 }, srPanDrag = null, srPanned = false, srDragY = null;   // 우클릭 드래그로 카메라 이동
let srTarget = { ...SR_FULL }, srView = { ...SR_FULL };
const SR_POSES = ['rifle aiming idle', 'walking', 'strafe', 'reloading', 'toss grenade'];
const SR_SPECIAL = [                      // 스페셜 포즈 — 아직 전부 잠금
  { key: 'sp1', icon: '🕺', name: '승리 포즈', locked: true },
  { key: 'sp2', icon: '🎯', name: '조준 포즈', locked: true },
  { key: 'sp3', icon: '🧊', name: '아이들 포즈', locked: true },
  { key: 'sp4', icon: '💃', name: '댄스 포즈', locked: true },
  { key: 'sp5', icon: '👑', name: '엠블럼 포즈', locked: true },
];
let srSpecial = null;
let srPose = 0;
const SR_LIGHT_N = 10, srLightPool = [];
const _srLampPos = new THREE.Vector3();
function syncSrLights() {                 // 보이는 조명 가구에 풀 조명을 배정 (가까운 순) · 나머지는 끔
  if (!srScene) return;
  const want = [];
  srScene.traverse(o => {
    const L = o.userData.lamp; if (!L) return;
    let p = o; while (p) { if (!p.visible) return; p = p.parent; }
    o.getWorldPosition(_srLampPos);
    want.push({ x: _srLampPos.x, y: _srLampPos.y + L.y, z: _srLampPos.z, L, d: Math.hypot(_srLampPos.x - live.x, _srLampPos.z - live.z) });
  });
  if (want.length > SR_LIGHT_N) want.sort((a, b) => a.d - b.d);
  for (let i = 0; i < SR_LIGHT_N; i++) {
    const l = srLightPool[i], w = want[i];
    if (!w) { l.intensity = 0; continue; }
    l.position.set(w.x, w.y, w.z); l.color.setHex(w.L.color); l.intensity = w.L.i; l.distance = w.L.dist;
  }
}
function srWarm() {                       // 방을 세운 직후 모든 방을 잠깐 보이게 하고 셰이더를 미리 컴파일 — 걷다가 방이 나타날 때 멈추지 않게
  if (!srScene) return;
  const saved = [];
  srScene.traverse(o => { if (!o.visible) { saved.push(o); o.visible = true; } });
  syncSrLights();
  try { renderer.compile(srScene, srCam); } catch { }
  srScene.traverse(o => { const m = o.material; if (!m) return; for (const k of ['map', 'emissiveMap', 'alphaMap']) if (m[k]?.isTexture) { try { renderer.initTexture(m[k]); } catch { } } });
  for (const o of saved) o.visible = false;
}
function srBuild() {
  if (srScene || !playerGltf) return;
  srScene = new THREE.Scene();
  srScene.background = new THREE.Color(0xbfe0f2);   // 배경 하늘 (풍경 위쪽이 검게 뚫려 보이지 않게)
  srCam = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 300);   // 멀리 세운 풍경이 잘리지 않게
  // 인게임과 같은 대비를 유지하고(반구광 + 태양광) 스포트는 액센트로만
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9aa4ae, 1.5);     // 중립 환경광 — 흰색이 흰색으로 보이게
  srScene.add(hemi);
  const sunL = new THREE.DirectionalLight(0xffeedd, 2.2); sunL.position.set(2.6, 4, 2.4); srScene.add(sunL);
  srStageLights = [hemi, sunL];
  for (const l of srStageLights) l.userData.base = l.intensity;   // 캐릭터에 붙던 스포트는 사용하지 않는다
  // 고정 점광원 풀 — 방이 보이고 숨을 때 조명 수가 바뀌면 모든 셰이더가 다시 컴파일돼(방 하나 나올 때 0.5초 정지) 수를 고정한다
  for (let i = 0; i < SR_LIGHT_N; i++) { const l = new THREE.PointLight(0xffffff, 0, 1); srScene.add(l); srLightPool.push(l); }
  srRoot = skClone(playerGltf.scene);
  srRoot.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  srScene.add(srRoot);
  srMixer = new THREE.AnimationMixer(srRoot);
  for (const n of [...SR_POSES, 'rifle run', 'firing rifle']) {
    const c = clipOf(playerGltf, n);
    if (c) srActions[n] = srMixer.clipAction(c);
  }
  srPlay('rifle aiming idle');
  roomLoad();
  migrateLayout();
  buildWorld();
}
function srPlay(name) {
  const next = srActions[name];
  if (!next || srCurrent === next) return;
  next.enabled = true; next.reset().play();
  if (srCurrent) srCurrent.crossFadeTo(next, 0.25, false);
  srCurrent = next;
}
function srBoneY(re) {                    // 슬롯이 가리키는 본의 실제 높이
  if (!srRoot || !re) return null;
  let hit = null;
  srRoot.traverse(o => { if (!hit && o.isBone && re.test(o.name) && !/end/i.test(o.name)) hit = o; });
  if (!hit) return null;
  return hit.getWorldPosition(new THREE.Vector3()).y;
}
function srClavicleY() {                  // 쇄골(없으면 목·가슴) 높이 — 확대 기준점
  const y = srBoneY(/clavicle|shoulder(?!.*end)/i) ?? srBoneY(/neck/i) ?? srBoneY(/spine2|spine1/i);
  return y ?? 1.35;
}
function srSelect(slot) {
  srSel = slot.key;
  const y = srBoneY(slot.bone);
  srTarget = { y: y ?? slot.y, dist: slot.dist };
  srSpin = false;
  srPlay(slot.clip);                      // 파츠별 전용 모션 (지금은 기존 클립으로 대체)
  srRenderSlots();
}
function srReset() {
  srSel = null; srTarget = { ...SR_FULL }; srPan.x = 0; srPanned = false;
  srPlay('rifle aiming idle');
  srRenderSlots();
}
function srSlotHtml(list) {
  return list.map(s => `<div class="srSlot${srSel === s.key ? ' sel' : ''}" data-slot="${s.key}">
    <div class="ic">${s.icon}</div><div class="nm">${s.name}</div><div class="eq">${srEquip[s.key] ?? '-'}</div></div>`).join('');
}
function srRenderSlots() {
  document.getElementById('srGear').innerHTML = srSlotHtml(SR_GEAR);
  document.getElementById('srWear').innerHTML = srSlotHtml(SR_WEAR);
  for (const el of document.querySelectorAll('#srLeft .srSlot')) {
    el.addEventListener('click', () => {
      const all = [...SR_GEAR, ...SR_WEAR];
      const s = all.find(x => x.key === el.dataset.slot);
      if (s) srSelect(s);
    });
  }
}
function srRenderPoses() {
  const el = document.getElementById('srPoses');
  if (!el) return;
  el.innerHTML = SR_SPECIAL.map(p =>
    `<div class="srPose${p.locked ? ' lock' : ''}${srSpecial === p.key ? ' on' : ''}" data-pose="${p.key}" title="${p.name}">${p.icon}</div>`).join('');
  for (const b of el.querySelectorAll('.srPose')) {
    b.addEventListener('click', () => {
      const p = SR_SPECIAL.find(x => x.key === b.dataset.pose);
      if (!p) return;
      if (p.locked) { toast('🔒 ' + p.name + ' — 아직 잠겨 있습니다'); return; }
      srSpecial = p.key;
      if (p.clip) srPlay(p.clip);
      srRenderPoses();
    });
  }
}
function srRenderInv() {
  const el = document.getElementById('srInv');
  const room = isRoomTab(srTab);
  document.getElementById('srRight').classList.toggle('room', room);
  for (const s of document.querySelectorAll('.srSec')) s.classList.toggle('on', s.dataset.sec === srTab);
  if (room) { for (const t of document.querySelectorAll('#srTabs button')) t.classList.toggle('on', t.dataset.tab === srTab);
    if (srTab === 'room') renderSaveSlots();   // 썸네일이 있어 탭을 펼 때만 다시 그린다
    el.style.display = 'none';
    document.getElementById('srRoomPane').classList.add('on');
    if (srTab !== 'furn') cancelPlace();   // 가구 탭을 벗어나면 배치 중이던 가구는 취소
    roomRenderUI(); return; }
  el.innerHTML = SR_INV[srTab].map(it =>
    `<div class="srItem${srEquip[it.key] === it.name ? ' on' : ''}" data-item="${it.key}">${it.icon}<span>${it.name}</span></div>`).join('');
  for (const b of el.querySelectorAll('.srItem')) {
    b.addEventListener('click', () => {
      const all = [...SR_GEAR, ...SR_WEAR];
      const s = all.find(x => x.key === b.dataset.item);
      if (s) srSelect(s);                 // 아직 교체 대상이 없어 미리보기만
      toast('현재는 기본 파츠만 있습니다');
    });
  }
  for (const t of document.querySelectorAll('#srTabs button'))
    t.classList.toggle('on', t.dataset.tab === srTab);
  document.getElementById('srInv').style.display = 'grid';
  document.getElementById('srRoomPane').classList.remove('on');
  cancelPlace();
}
function openShowroom() {
  srBuild();
  if (!srScene) { toast('모델 로딩 중입니다'); return; }
  srOn = true;
  document.getElementById('showroom').classList.add('on');
  document.body.classList.add('showroom');   // 뒤의 타이틀·HUD를 가려 캔버스를 보이게
  shopMenu.style.display = 'none'; rankMenu.style.display = 'none'; optMenu.style.display = 'none';
  srReset(); srRenderInv(); srRenderPoses(); roomRenderUI();
  srSpin = false; srYaw = 0;             // 정면으로 세워두고 회전은 사용자가 켤 때만
  srMode = 'pose'; srRenderModeUI();
  slotFloor = null;
  markSnap();                             // 되돌리기 기준점
  slotsLoad();                            // 저장 슬롯 (파일 → 없으면 브라우저)
  document.getElementById('srName').textContent = curRoom().name;
  showCurTop(true);
}
function showLeaveAsk() { document.getElementById('srLeave')?.classList.add('on'); }
function hideLeaveAsk() { document.getElementById('srLeave')?.classList.remove('on'); }
function closeShowroom(force = false) {
  if (!force && roomDirty) { showLeaveAsk(); return; }   // 저장 여부를 먼저 묻는다
  hideLeaveAsk();
  srOn = false;
  document.getElementById('showroom').classList.remove('on');
  document.body.classList.remove('showroom'); document.body.classList.remove('srLive');
  showCurTop(false);
  refreshOverlay();
}
function liveApplyCam() {                 // 생활 모드 카메라 (따라오기)
  if (!srCam) return;
  live.camYaw = Math.max(-CAM_YAW_LIM, Math.min(CAM_YAW_LIM, live.camYaw));
  live.camPitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, live.camPitch));
  const flat = Math.cos(live.camPitch) * live.camDist;
  const cr = renderer.domElement.getBoundingClientRect();
  srCam.aspect = cr.height > 0 ? cr.width / cr.height : 16 / 9;
  srCam.updateProjectionMatrix();
  srCam.position.set(live.x + Math.sin(live.camYaw) * flat, live.y + 1.15 + Math.sin(live.camPitch) * live.camDist, live.z + Math.cos(live.camYaw) * flat);
  srCam.lookAt(live.x, live.y + 1.15, live.z);
  srCam.updateMatrixWorld(true);
}
function srApplyCam() {                   // 카메라·씬 행렬 최신화 (레이캐스트 전에도 필요)
  if (!srCam) return;
  if (srMode === 'live') { liveApplyCam(); srScene?.updateMatrixWorld(true); return; }
  if (innerWidth > 0 && renderer.domElement.width !== Math.floor(innerWidth * (renderer.getPixelRatio() || 1))) renderer.setSize(innerWidth, innerHeight);   // 창 크기와 어긋나면 맞춘다
  const cr = renderer.domElement.getBoundingClientRect();     // 화면에 그려지는 영역과 같은 비율로 (픽킹과 일치)
  srCam.aspect = cr.height > 0 ? cr.width / cr.height : (innerHeight ? innerWidth / innerHeight : 16 / 9);
  srCam.updateProjectionMatrix();
  const az = live.camYaw, s2 = Math.sin(az), c2 = Math.cos(az);
  const px = live.x + srPan.x * c2, pz = live.z - srPan.x * s2;   // 피벗 = 캐릭터 위치
  const py = live.y + srView.y;
  srCam.position.set(px + s2 * srView.dist, py + srView.dist * 0.12, pz + c2 * srView.dist);
  srCam.lookAt(px, py, pz);
  srCam.updateMatrixWorld(true);
  srScene?.updateMatrixWorld(true);      // 방금 만든 가구도 바로 집히도록
}
function srUpdate(dt) {
  if (!srOn || !srScene) return;
  if (srMode === 'live') {               // 생활 모드: 걷기 + 따라오는 카메라
    srMixer.update(dt);
    roomUpdate();
    liveStep(dt);
    syncSrLights();
    renderer.render(srScene, srCam);
    return;
  }
  if (srSpin && !srDrag) srYaw += dt * 0.5;
  srRoot.position.set(live.x, live.y, live.z);
  srRoot.rotation.y = srYaw;
  srMixer.update(dt);
  roomUpdate();
  srView.y += (srTarget.y - srView.y) * Math.min(1, dt * 6);       // 부드럽게 줌인
  srView.dist += (srTarget.dist - srView.dist) * Math.min(1, dt * 6);
  srClampView();
  srApplyCam();
  syncSrLights();
  renderer.render(srScene, srCam);
}
// 입력: 드래그 회전 · 휠 확대 · 버튼
(function srBindUI() {
  const sr = document.getElementById('showroom');
  sr.addEventListener('contextmenu', e => { if (srOn) e.preventDefault(); });
  const pinch = new Map(); let pinchD0 = 0, pinchDist0 = 0;   // 두 손가락 핀치 줌
  sr.addEventListener('pointerdown', e => {
    if (e.target.closest('.srPanel, #srBottom, #srClose, #srTop, #srModes, #srLiveBar, #srMap, #srMapZoom, #srMapLv, #srCtx, #srRightTab, #srPlaceAsk')) return;
    e.preventDefault();                  // 드래그 중 텍스트가 잡히지 않게
    if (e.pointerType === 'touch') {
      pinch.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch.size === 2) {            // 두 번째 손가락: 핀치 시작 — 회전·잡기 드래그는 멈춘다
        const [a, b] = [...pinch.values()];
        pinchD0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
        pinchDist0 = srMode === 'live' ? live.camDist : srTarget.dist;
        srDrag = null; if (touchPick && !touchPick.moved) touchPick = null;
        return;
      }
    }
    if (placeAskKind) return;            // 설치 확인 중에는 장면을 건드리지 않는다
    if (e.button === 2) { srPanDrag = [e.clientX, e.clientY]; return; }   // 우클릭: 카메라 이동
    if (srMode === 'live' && srEditUI && e.button === 0) {
      if (placeType && !FURN[placeType].sizable) { placeDrag = true; return; }   // 새 가구: 끌어서 자리를 잡고 떼면 확인
      if (!placeType && !moveItem && !sizeDrag && isRoomTab(srTab)) {
        const it = pickFurniture(e);
        if (it) { touchPick = { it, x: e.clientX, y: e.clientY, moved: false }; return; }   // 놓인 가구: 잡아서 끈다
      }
    }
    srDrag = e.clientX; srDragY = e.clientY; srSpin = false;
  });
  addEventListener('pointermove', e => {
    if (!srOn) return;
    if (pinch.has(e.pointerId)) {
      pinch.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch.size >= 2 && pinchD0 > 0) {   // 손가락 사이가 벌어지면 가까이, 좁아지면 멀리
        const [a, b] = [...pinch.values()];
        const k = pinchD0 / Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]));
        if (srMode === 'live') live.camDist = Math.max(1.6, Math.min(7, pinchDist0 * k));
        else { srTarget.dist = Math.max(0.7, Math.min(6, pinchDist0 * k)); srClampView?.(); }
        return;
      }
    }
    if (placeAskKind) return;            // 설치 확인 중에는 아무것도 움직이지 않는다
    if (touchPick) {                     // 잡은 가구를 손가락/커서 아래로
      if (!touchPick.moved && Math.hypot(e.clientX - touchPick.x, e.clientY - touchPick.y) > 8) {
        touchPick.moved = true;
        hideCtx(); setSel(touchPick.it); startMove();
      }
      if (moveItem) { const hit = placePoint(e); if (hit) moveTo(hit.p.x, hit.p.z, hit.host); }
      return;
    }
    if (srPanDrag) {                     // 좌우 = 평행 이동, 상하 = 높이
      const k = 0.0022 * srView.dist;
      const y0 = srTarget.y, x0 = srPan.x;
      srPan.x -= (e.clientX - srPanDrag[0]) * k;
      srTarget.y += (e.clientY - srPanDrag[1]) * k;
      srClampView();
      srPanDrag = [e.clientX, e.clientY];
      if (srTarget.y !== y0 || srPan.x !== x0) srPanned = true;   // 실제로 움직였을 때만
      return;
    }
    if (srDrag === null) return;
    if (srMode === 'live') {              // 드래그 방향과 같은 쪽으로 돈다
      live.camYaw -= (e.clientX - srDrag) * 0.008;   // 상하는 15° 고정
    } else srYaw += (e.clientX - srDrag) * 0.01;
    srDrag = e.clientX; srDragY = e.clientY;
  });
  addEventListener('pointercancel', e => { pinch.delete(e.pointerId); pinchD0 = 0; });
  addEventListener('pointerup', e => {
    srDrag = null; if (e.button === 2 || srPanDrag) srPanDrag = null;
    if (pinch.has(e.pointerId)) { pinch.delete(e.pointerId); pinchD0 = 0; }
    if (!srOn) return;
    if (touchPick) {
      const tp = touchPick; touchPick = null; suppressClick = true;
      if (tp.moved) openPlaceAsk('move');                           // 끌어다 놓음 → 설치할지 묻는다
      else { setSel(tp.it); showCtx(e.clientX, e.clientY); }      // 그냥 탭 → 메뉴
      return;
    }
    if (placeDrag) { placeDrag = false; suppressClick = true; if (placeType) openPlaceAsk('place'); }
  });
  let askMark = null, askSnap = null;    // 설치 위치 실루엣 (바닥 발자국 + 테두리) · 실루엣을 만든 자리
  function openPlaceAsk(kind) {
    placeAskKind = kind;
    document.getElementById('srPlaceAsk').classList.add('on');
    // 설치 자리에 실루엣을 남긴다 — 새 가구는 미리보기 자리, 옮기는 가구는 지금 놓인 자리
    const rm = worldRooms.find(r => r.slot === roomStore.cur);
    let type = null, x = 0, z = 0, y = 0, rot = 0;
    if (kind === 'place' && placeType && placeGhost) { const q = placeGhost.userData.snap; if (q) { askSnap = { ...q }; type = placeType; x = q.x; z = q.z; y = q.y || 0; rot = q.wall ? q.rot : placeRot; } }
    else if (kind === 'move' && moveItem) { type = moveItem.type; x = moveItem.x; z = moveItem.z; y = moveItem.y || 0; rot = moveItem.rot || 0; }
    if (type && rm) {
      const fp = footprint(type, rot);
      const g = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(fp.w + 0.12, fp.d + 0.12).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x7df3ff, transparent: true, opacity: 0.32, depthWrite: false }));
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(fp.w + 0.12, FURN[type].h, fp.d + 0.12)),
        new THREE.LineBasicMaterial({ color: 0x7df3ff, transparent: true, opacity: 0.9 }));
      edge.position.y = FURN[type].h / 2;
      g.add(pad); g.add(edge);
      g.position.set(rm.cx + x, (rm.cy || 0) + y + 0.02, rm.cz + z);
      g.rotation.y = rot * ROT_STEP;
      srScene.add(g); askMark = g;
      positionPlaceAsk(g.position, FURN[type].h);   // 팝업은 실루엣 바로 아래(안 들어가면 위)에
    }
    // 확인하는 동안에는 실루엣만 — 커서를 따라다니던 미리보기·옮기던 가구 본체는 감춘다
    if (placeGhost) placeGhost.visible = false;
    if (placeMark) placeMark.visible = false;
    if (kind === 'move' && moveItem) { const m = srFurnGrp?.children.find(o => o.userData.item === moveItem); if (m) { m.visible = false; askHidden = m; } }
  }
  let askHidden = null;
  function positionPlaceAsk(pos, hgt) {   // 실루엣의 바닥/꼭대기를 화면에 투영해 그 근처에 팝업을 놓는다
    const el = document.getElementById('srPlaceAsk');
    try { srApplyCam(); } catch { }
    const r = renderer.domElement.getBoundingClientRect();
    const toScreen = (p) => { const v = p.clone().project(srCam); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
    const [bx, by] = toScreen(pos.clone());
    const [, ty] = toScreen(pos.clone().add(new THREE.Vector3(0, hgt, 0)));
    el.style.display = 'flex';            // 크기를 재려면 먼저 그려야 한다
    const w = el.offsetWidth || 220, hh = el.offsetHeight || 90;
    let top = by + 14;                    // 기본: 실루엣 아래
    if (top + hh > innerHeight - 8) top = ty - hh - 14;   // 안 들어가면 위
    top = Math.max(8, Math.min(innerHeight - hh - 8, top));
    const left = Math.max(w / 2 + 8, Math.min(innerWidth - w / 2 - 8, bx));
    el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.bottom = 'auto'; el.style.transform = 'translateX(-50%)';
    el.style.display = '';
  }
  function closePlaceAsk() {
    placeAskKind = null; document.getElementById('srPlaceAsk').classList.remove('on');
    if (askMark) { srScene.remove(askMark); askMark.traverse(o => { if (o.geometry) o.geometry.dispose(); }); askMark = null; }
    askSnap = null;
    if (placeGhost) placeGhost.visible = true;
    if (placeMark) placeMark.visible = true;
    if (askHidden) { askHidden.visible = true; askHidden = null; }
  }
  document.getElementById('srPlaceOk').addEventListener('click', e => {
    e.stopPropagation();
    const k = placeAskKind, snap = askSnap; closePlaceAsk();
    if (k === 'move') endMove(true);
    else if (k === 'place') { if (placeGhost && snap) placeGhost.userData.snap = snap; commitPlace(); }   // 실루엣 자리에 설치
  });
  document.getElementById('srPlaceNo').addEventListener('click', e => {
    e.stopPropagation();
    const k = placeAskKind; closePlaceAsk();
    if (k === 'move') endMove(false); else if (k === 'place') cancelPlace();
  });
  document.getElementById('srRightTab').addEventListener('click', e => { e.stopPropagation(); srRightFolded = false; syncRightFold(); });
  sr.addEventListener('wheel', e => {
    if (!srOn) return;
    if (e.target.closest('#srMap, #srMapEdit, #srMapZoom, #srMapLv')) {      // 미니맵 위에서는 미니맵 배율
      e.preventDefault();
      mapZoom = Math.max(0.5, Math.min(2, +(mapZoom * (e.deltaY > 0 ? 0.85 : 1.18)).toFixed(2)));   // 0.5~2배
      drawRoomMap();
      return;
    }
    if (e.target.closest('.srPanel, #srCtx, #srBottom, #srModes')) return;   // 패널 위에서는 패널이 스크롤
    e.preventDefault();
    if (placeType && FURN[placeType].rotate === 'free') {   // 배치 미리보기: 휠로 30°씩 회전
      placeRot = ((placeRot + (e.deltaY > 0 ? 1 : ROT_N - 1)) % ROT_N + ROT_N) % ROT_N;
      if (lastCursor) sr.dispatchEvent(new PointerEvent('pointermove', { clientX: lastCursor[0], clientY: lastCursor[1], bubbles: true }));
      return;
    }
    if (moveItem && FURN[moveItem.type].rotate === 'free') { // 이동 중에도 휠로 회전
      moveItem.rot = ((((moveItem.rot || 0) + (e.deltaY > 0 ? 1 : ROT_N - 1)) % ROT_N) + ROT_N) % ROT_N;
      const rm0 = worldRooms.find(r => r.slot === roomStore.cur);
      moveTo(moveItem.x + (rm0?.cx || 0), moveItem.z + (rm0?.cz || 0));
      return;
    }
    if (srMode === 'live') { live.camDist = Math.max(1.6, Math.min(7, live.camDist + Math.sign(e.deltaY) * 0.3)); return; }
    srTarget.dist = Math.max(0.7, Math.min(6, srTarget.dist + Math.sign(e.deltaY) * 0.25));
    if (!srSel && !srPanned) {           // 부위를 고르지 않았으면 쇄골을 중심으로 당긴다
      const k = Math.min(1, Math.max(0, (SR_FULL.dist - srTarget.dist) / (SR_FULL.dist - 0.7)));
      srTarget.y = SR_FULL.y + (srClavicleY() - SR_FULL.y) * k;
    }
    srClampView();                       // 축소하면 다시 가운데로 모인다
  }, { passive: false });
  sr.addEventListener('pointerdown', e => {                 // 크기 손잡이 잡기
    if (!srOn || !srGizmo || placeType || moveItem) return;
    if (e.target.closest('.srPanel, #srBottom, #srClose, #srTop, #srCtx, #srModes')) return;
    const r = renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    srApplyCam();
    const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(nd, srCam);
    const hit = raycaster.intersectObjects(srGizmo.children, false)[0];
    if (!hit) return;
    e.stopPropagation(); e.preventDefault();
    markSnap();                                             // 되돌리기 기준
    sizeDrag = { it: srPickSel, anchor: hit.object.userData.corner, last: '' };
    toast('📐 끌어서 크기 조절');
  }, true);
  const endSizeDrag = () => {
    if (!sizeDrag) return;
    const it = sizeDrag.it;
    sizeDrag = null;
    roomSave(); refreshRoom(it.type); syncOutline();
    const f = FURN[it.type];
    toast('📐 ' + f.name + ' ' + (it.w ?? f.w) + '×' + (it.h ?? f.h) + 'm');
  };
  addEventListener('pointerup', endSizeDrag);
  addEventListener('pointercancel', endSizeDrag);
  sr.addEventListener('pointermove', e => {                 // 손잡이를 끄는 중이면 크기를 바꾼다
    if (!srOn || !sizeDrag) return;
    e.stopPropagation();
    const c0 = wallItemCorners(sizeDrag.it);
    const wp = wallPoint(e, c0 ? c0.side : null);        // 붙어 있는 벽에서만 움직인다
    if (!wp) return;
    const key = wp.u.toFixed(2) + '/' + wp.y.toFixed(2);
    if (key === sizeDrag.last) return;                      // 격자 한 칸 움직였을 때만 다시 그린다
    sizeDrag.last = key;
    const a = sizeDrag.anchor;
    if (applyWallSize(sizeDrag.it, a.u, a.y, wp.u, wp.y)) { refreshRoom(sizeDrag.it.type); syncGizmo(); }
  }, true);
  sr.addEventListener('pointermove', e => {                 // 배치·이동 중이면 커서를 따라다닌다
    if (placeAskKind) return;                                 // 설치 확인 중에는 자리를 바꾸지 않는다
    if (!srOn || (!placeType && !moveItem)) return;
    lastCursor = [e.clientX, e.clientY];
    if (moveItem) {                                        // 설치면(바닥·벽·천장) 위에서 움직인다
      const f = FURN[moveItem.type], rm = worldRooms.find(r => r.slot === roomStore.cur);
      if (!rm) return;
      if (f.mount === 'wall' || f.mount === 'opening') {
        const wp = wallPoint(e);
        if (!wp) return;
        const pos = wallItemPos(wp.side, wp.u, rm);
        moveItem.x = pos.x; moveItem.z = pos.z; moveItem.rot = pos.rot;
        moveItem.y = f.mount === 'opening' ? 0
          : Math.max(f.h / 2 + 0.05, Math.min(ROOM_H - f.h / 2 - 0.05, wp.y));   // 높이도 커서 기준
      } else {
        const hit = placePoint(e);
        if (!hit) return;
        if (f.mount === 'ceiling') {
          const q = snapPos(moveItem.type, moveItem.rot || 0, hit.p.x, hit.p.z);
          moveItem.x = q.x; moveItem.z = q.z; moveItem.y = +(ROOM_H - f.h).toFixed(2);
        } else { moveTo(hit.p.x, hit.p.z, hit.host); return; }
      }
      const m = srFurnGrp?.children.find(o => o.userData.item === moveItem);
      if (m) {
        m.position.set(rm.cx + moveItem.x, (rm.cy || 0) + moveItem.y, rm.cz + moveItem.z);
        m.rotation.y = (moveItem.rot || 0) * ROT_STEP;
      }
      return;
    }
    if (placeType && !FURN[placeType].sizable && (FURN[placeType].mount === 'wall' || FURN[placeType].mount === 'opening')) {
      const wp = wallPoint(e);                             // 벽걸이·문: 커서가 가리키는 벽 위 (높이도 커서 기준)
      if (!wp || !placeGhost) return;
      const rm = worldRooms.find(r => r.slot === roomStore.cur);
      const f = FURN[placeType];
      const pos = wallItemPos(wp.side, wp.u, rm);
      const y = f.mount === 'opening' ? 0 : Math.max(f.h / 2 + 0.05, Math.min(ROOM_H - f.h / 2 - 0.05, wp.y));
      const snap = { slot: roomStore.cur, ...pos, y: +y.toFixed(2), wall: true, side: wp.side };
      placeGhost.userData.snap = snap;
      placeGhost.position.set(rm.cx + pos.x, (rm.cy || 0) + y, rm.cz + pos.z);
      placeGhost.rotation.y = pos.rot * ROT_STEP;
      const bad = wallClash(roomStore.slots[roomStore.cur], placeType, { x: pos.x, z: pos.z, y })
        || doorStairClash(roomStore.slots[roomStore.cur], placeType, { type: placeType, x: pos.x, z: pos.z, y, rot: pos.rot });
      placeGhost.traverse(o => { if (o.isMesh) o.material.color.setHex(bad ? 0xff5a4a : FURN[placeType].color); });
      return;
    }
    if (placeType && FURN[placeType].sizable) {             // 창문·배너: 끌어서 크기
      const wp = wallPoint(e, sizeAnchor ? sizeAnchor.side : null);   // 시작한 벽에 고정
      if (!wp || !placeGhost) return;
      const rm = worldRooms.find(r => r.slot === roomStore.cur);
      const anchored = sizeAnchor && sizeAnchor.side === wp.side;
      const box = anchored ? sizableGhost(sizeAnchor, wp)
        : { u: wp.u, y: wp.y, w: GRID, h: GRID };   // 첫 클릭 전에는 십자(시작점)만 보여준다
      placeGhost.visible = !!anchored;
      const pos = wallItemPos(wp.side, box.u, rm);
      const badWin = placeType === 'window' && windowBlocked(roomStore.cur, wp.side, pos.x, pos.z);
      placeGhost.userData.snap = { slot: roomStore.cur, ...pos, y: box.y, w: box.w, h: box.h, wall: true, side: wp.side, bad: badWin };
      placeGhost.position.set(rm.cx + pos.x, (rm.cy || 0) + box.y, rm.cz + pos.z);
      placeGhost.rotation.y = pos.rot * ROT_STEP;
      placeGhost.scale.set(box.w / FURN[placeType].w, box.h / FURN[placeType].h, 1);
      placeGhost.traverse(o => { if (o.isMesh) o.material.color.setHex(badWin ? 0xff3a2a : FURN[placeType].color); });
      if (placeMark) placeMark.material?.color?.setHex?.(badWin ? 0xff3a2a : 0x7df3ff);
      if (placeMark) {                     // 십자는 커서가 가리키는 격자 교차점에
        placeMark.visible = !anchored;
        const p0 = wallItemPos(wp.side, wp.u, rm);
        placeMark.position.set(rm.cx + p0.x, (rm.cy || 0) + wp.y, rm.cz + p0.z);
        placeMark.rotation.y = p0.rot * ROT_STEP;
      }
      return;
    }
    const hit = placePoint(e);
    if (!hit) return;
    if (moveItem) { moveTo(hit.p.x, hit.p.z, hit.host); return; }
    if (!placeGhost) return;
    const q = snapPos(placeType, placeRot, hit.p.x, hit.p.z, hit.host);
    placeGhost.userData.snap = q;
    const rm = worldRooms.find(r => r.slot === q.slot);
    placeGhost.position.set((rm ? rm.cx : 0) + q.x, (rm ? rm.cy || 0 : 0) + (q.y || 0), (rm ? rm.cz : 0) + q.z);
    if (placeMark) placeMark.position.set((rm ? rm.cx : 0) + q.x, (rm ? rm.cy || 0 : 0), (rm ? rm.cz : 0) + q.z);   // 바닥 중심 표시
    placeGhost.rotation.y = (q.wall ? q.rot : placeRot) * ROT_STEP;
    const bad = overlaps(placeType, q.wall ? q.rot : placeRot, q.x, q.z, q.y || 0, q.under ?? q.on ?? null, roomStore.slots[q.slot]?.items);
    placeGhost.traverse(o => { if (o.isMesh) o.material.color.setHex(bad ? 0xff5a4a : FURN[placeType].color); });
  });
  sr.addEventListener('click', e => {
    if (!srOn || e.target.closest('.srPanel, #srBottom, #srClose, #srTop, #srCtx, #srModes, #srRightTab, #srPlaceAsk, #srLiveBar')) return;
    if (suppressClick) { suppressClick = false; return; }   // 터치 잡기/놓기 뒤에 따라오는 click은 무시
    if (placeAskKind) return;
    if (sizeDrag) return;
    lastCursor = [e.clientX, e.clientY];
    if (moveItem) { endMove(true); return; }
    if (placeType && FURN[placeType].sizable) {             // 첫 클릭=시작점, 두 번째=확정
      const wp = wallPoint(e, sizeAnchor ? sizeAnchor.side : null);
      if (!wp) return;
      if (!sizeAnchor) { sizeAnchor = wp; toast('크기를 정하고 다시 클릭'); return; }
      commitPlace();
      sizeAnchor = null;
      return;
    }
    if (placeType) { commitPlace(); return; }
    if (!isRoomTab(srTab)) return;
    if (moveItem) return;
    const picked = (srMode === 'live' && !srEditUI) ? null : pickFurniture(e);      // 놓인 가구 고르기 (생활모드는 '방 편집'이 켜져 있을 때만)
    if (picked) { setSel(picked); showCtx(e.clientX, e.clientY); return; }   // 빈 곳을 눌러도 메뉴는 닫기 전까지 유지
    const face = pickSurface(e);          // 가구가 아니면 벽·바닥·천장을 고른다 (색 바꾸기)
    if (face && srTab === 'paint') {
      surfSel = face;
      roomRenderUI();
      toast('🎨 ' + (SURFACES.find(f => f.key === face)?.name ?? face) + ' 선택 — 색을 고르세요');
    }
  });
  addEventListener('keydown', e => {
    if (!srOn) return;
    if (e.code === 'KeyR') { if (moveItem) { moveItem.rot = ((moveItem.rot || 0) + 1) % ROT_N; moveTo(moveItem.x + (worldRooms.find(r => r.slot === roomStore.cur)?.cx || 0), moveItem.z + (worldRooms.find(r => r.slot === roomStore.cur)?.cz || 0)); } else rotateCurrent(); }
    if (e.code === 'Delete' || e.code === 'Backspace') removeSelected();
    if (e.code === 'Escape') { hideCtx(); if (sizeMode) endSizeEdit(); else if (moveItem) endMove(false); else if (placeType) cancelPlace(); else if (srPickSel) setSel(null); }
    if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undoRoom(); }
  });
  document.getElementById('srRot')?.addEventListener('click', e => { e.stopPropagation(); rotateCurrent(); });
  document.getElementById('srUndo')?.addEventListener('click', e => { e.stopPropagation(); undoRoom(); });
  for (const b of document.querySelectorAll('#srLiveBar [data-act]')) {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const a2 = b.dataset.act;
      if (a2 === 'save') saveToActiveSlot();
      else if (a2 === 'load') openLoadMenu();
      else if (a2 === 'undo') undoRoom();
      else if (a2 === 'edit') {
        srEditUI = !srEditUI;
        if (!srEditUI) {                 // 편집을 끄면 놓기·이동·선택을 모두 정리해 가이드 라인이 남지 않게
          if (placeType) cancelPlace();
          if (moveItem) endMove(false);
          closeCtx();
        }
        srRenderModeUI();
      }
    });
  }
  document.getElementById('srClear')?.addEventListener('click', e => { e.stopPropagation(); clearRoom(); });
  document.getElementById('addClear')?.addEventListener('click', e => { e.stopPropagation(); clearRoom(); });     // 배치 편집 창 안
  document.getElementById('addReset')?.addEventListener('click', e => { e.stopPropagation(); resetRooms(); });
  document.getElementById('srReset2')?.addEventListener('click', e => { e.stopPropagation(); resetRooms(); });
  document.getElementById('srCloseRoom')?.addEventListener('click', e => { e.stopPropagation(); closeRoom(); });
  document.getElementById('srMapEdit')?.addEventListener('click', e => { e.stopPropagation(); openLayoutEdit(standingSlot()); });
  document.getElementById('srMapZoom')?.addEventListener('click', e => {   // 1 → 1.2 → 1.5 → 2 → 1 순환
    e.stopPropagation();
    const steps = [1, 1.2, 1.5, 2];
    const i = steps.findIndex(v => Math.abs(v - mapZoom) < 0.01);
    mapZoom = steps[(i + 1) % steps.length];
    drawRoomMap(); toast('🔍 배율 ' + mapZoom.toFixed(1) + '×');
  });
  const addMap = document.getElementById('addMap');
  if (addMap) {
    let drag = false;
    const at = ev => {
      const r = addMap.getBoundingClientRect(), v = addMapView();
      return [v.mx((ev.clientX - r.left) * addMap.width / r.width), v.mz((ev.clientY - r.top) * addMap.height / r.height)];
    };
    addMap.addEventListener('pointerdown', ev => {
      const [x, z] = at(ev);
      if (addState && addState.edit !== undefined) {        // 편집 모드: 다른 방을 집으면 그 방을 옮긴다
        const hit = roomStore.slots.findIndex((sl, i) => {
          const r = slotRect(sl);
          return (sl.gy || 0) === addState.gy && x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
        });
        if (hit >= 0 && hit !== addState.edit) {
          const keep = addState.frame;
          openLayoutEdit(hit);
          addState.frame = keep;
          drawAddMap();
          return;
        }
      }
      drag = true; addMap.setPointerCapture(ev.pointerId);
      addRoomTo(x, z);
    });
    addMap.addEventListener('pointermove', ev => { if (!drag) return; const [x, z] = at(ev); addRoomTo(x, z); });
    addMap.addEventListener('pointerup', () => { drag = false; });
    for (const b of document.querySelectorAll('#addRoom [data-lv]'))
      b.addEventListener('click', () => addRoomLevel(+b.dataset.lv));
    for (const b of document.querySelectorAll('#addRoom [data-size]'))
      b.addEventListener('click', () => addRoomSize(b.dataset.size[0], b.dataset.size[1] === '+' ? ROOM_STEP : -ROOM_STEP));
    document.getElementById('addOk').addEventListener('click', () => (addState && addState.edit !== undefined ? applyLayoutEdit() : confirmAddRoom()));
    document.getElementById('addClose').addEventListener('click', () => editRoomClose());
    document.getElementById('addNew').addEventListener('click', () => editNewRoom());
    document.getElementById('addCancel').addEventListener('click', () => { closeAddMap(); toast('배치 편집 닫기'); });
    window.addEventListener('keydown', e => {
      if (!addState) return;
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (step) { e.preventDefault(); addRoomMove(step[0], step[1]); }
      else if (e.key === 'Escape') closeAddMap();
      else if (e.key === 'Enter') { if (addState.edit !== undefined) applyLayoutEdit(); else confirmAddRoom(); }
    });
  }
  document.getElementById('srSave')?.addEventListener('click', e => { e.stopPropagation(); saveToActiveSlot(); });
  document.getElementById('srLoadClose')?.addEventListener('click', e => { e.stopPropagation(); closeLoadMenu(); });
  document.getElementById('srSaveAskOk')?.addEventListener('click', e => { e.stopPropagation(); confirmSaveName(); });
  document.getElementById('srSaveAskNo')?.addEventListener('click', e => { e.stopPropagation(); closeSaveAsk(); });
  document.getElementById('srSaveAskName')?.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') confirmSaveName();
    if (e.key === 'Escape') closeSaveAsk();
  });
  document.getElementById('srLeaveSave')?.addEventListener('click', e => { e.stopPropagation(); roomCommit(); hideLeaveAsk(); closeShowroom(true); });
  document.getElementById('srLeaveDrop')?.addEventListener('click', e => { e.stopPropagation(); roomRevert(); hideLeaveAsk(); closeShowroom(true); toast('↩ 저장하지 않고 나갔습니다'); });
  document.getElementById('srLeaveStay')?.addEventListener('click', e => { e.stopPropagation(); hideLeaveAsk(); });
  for (const b of document.querySelectorAll('#srCtx [data-ctx]')) {        // 커서 옆 메뉴
    b.addEventListener('click', e => {
      e.stopPropagation();
      const a2 = b.dataset.ctx;
      if (a2 === 'img') { pickBannerImage(); return; }
      if (a2 === 'size') { startSizeEdit(); return; }
      if (a2 === 'move') { startMove(); return; }
      if (a2 === 'rot') { rotateCurrent(); return; }        // 회전은 메뉴를 유지
      if (a2 === 'del') { removeSelected(); return; }
      if (a2 === 'delAll') { removeSameType(); return; }
      if (a2 === 'close') { closeCtx(); return; }           // 닫기로는 저장되지 않는다
      hideCtx();
    });
  }
  document.getElementById('srDel')?.addEventListener('click', e => { e.stopPropagation(); removeSelected(); });
  document.getElementById('srRename')?.addEventListener('click', e => { e.stopPropagation(); askRename(); });
  document.getElementById('srNameAskOk')?.addEventListener('click', e => { e.stopPropagation(); renameRoom(); });
  document.getElementById('srNameAskNo')?.addEventListener('click', e => { e.stopPropagation(); closeRenameAsk(); });
  document.getElementById('srNameAskInput')?.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') renameRoom();
    if (e.key === 'Escape') closeRenameAsk();
  });
  document.getElementById('srModeBtn').addEventListener('click', e => {   // 포즈 ↔ 생활 토글
    e.stopPropagation();
    if (srMode === 'live') liveExit(); else liveEnter();
  });
  document.getElementById('srClose').addEventListener('click', e => { e.stopPropagation(); closeShowroom(); });
  document.getElementById('srSpin').addEventListener('click', e => { e.stopPropagation(); srSpin = !srSpin; });
  document.getElementById('srReset').addEventListener('click', e => { e.stopPropagation(); srReset(); });
  document.getElementById('srPose').addEventListener('click', e => {
    e.stopPropagation();
    srPose = (srPose + 1) % SR_POSES.length;
    srPlay(SR_POSES[srPose]);
  });
  for (const t of document.querySelectorAll('#srTabs button'))
    t.addEventListener('click', e => { e.stopPropagation(); srTab = t.dataset.tab; srRenderInv(); });
  document.getElementById('startShowroom').addEventListener('click', e => { e.stopPropagation(); openShowroom(); });
})();

function warmUpShaders() {               // 게임 중 '처음 등장'하는 재질을 로딩 화면에서 미리 컴파일 (초반 멈칫 제거)
  const y = -50, px = player.pos.x, pz = player.pos.z;   // 전부 화면 아래에 잠깐 놓는다
  const tmpE = [], extra = [];
  const n0 = { drops: drops.length, coins: coinFx.length, tracers: tracers.length, parts: particles.length, proj: projectiles.length };
  for (const v of ['walker', 'runner', 'jumper', 'ranged', 'boss']) {   // 적 변종 (불투명 + 투명 + HP바 + 그림자 원)
    const e = spawnEnemy(1, v);
    if (!e) continue;
    e.root.position.set(px, y, pz);
    if (e.hpBar) e.hpBar.grp.visible = true;
    ensureBlob(e, true);
    tmpE.push(e);
    if (v === 'ranged') { try { fireProjectile(e); } catch { } }         // 원거리 투사체
  }
  if (tmpE[1]) tmpE[1].root.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.5; } });
  try { dropItem('potion', px, pz); dropItem('chest', px + 1, pz); dropItem('grenade', px + 2, pz); dropCoins(px + 3, pz); } catch { }   // 드랍 아이템
  for (let i = n0.drops; i < drops.length; i++) drops[i].root.position.y = y;
  for (let i = n0.coins; i < coinFx.length; i++) coinFx[i].root.position.y = y;
  try { addTracer(new THREE.Vector3(px, y, pz), new THREE.Vector3(px + 1, y, pz)); } catch { }   // 예광탄
  try { burst(new THREE.Vector3(px, y, pz), 0xffaa33, 4); burst(new THREE.Vector3(px, y, pz), 0xbb2233, 4); } catch { }   // 파편
  const add = m => { m.position.set(px, y, pz); scene.add(m); extra.push(m); };
  try { add(makeBlueCircle()); add(makeAoeCircle(new THREE.Vector3(px, y, pz))); } catch { }       // 폭발 범위·보스 착지 원
  try { add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), lavaMat)); } catch { }                   // 용암
  try { add(new THREE.Mesh(ROCK_GEO, rockMat)); add(new THREE.Mesh(LIMB_GEO, limbMat)); } catch { }   // 파편 돌·절단 부위
  try { add(makeDoorPanel()); } catch { }                                                           // 문
  try { add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), obMat)); add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), platMat)); } catch { }
  try { renderer.compile(scene, camera); } catch { }
  sun.shadow.needsUpdate = true;
  try { renderer.render(scene, camera); } catch { }    // 그림자 깊이 셰이더까지 한 번 돌린다
  for (const e of tmpE) { retireEnemy(e); const i = enemies.indexOf(e); if (i >= 0) enemies.splice(i, 1); }
  for (const m of extra) scene.remove(m);
  for (let i = drops.length - 1; i >= n0.drops; i--) { scene.remove(drops[i].root); drops.splice(i, 1); }
  for (let i = coinFx.length - 1; i >= n0.coins; i--) { scene.remove(coinFx[i].root); coinFx.splice(i, 1); }
  for (let i = tracers.length - 1; i >= n0.tracers; i--) { scene.remove(tracers[i].line); tracers.splice(i, 1); }
  for (let i = particles.length - 1; i >= n0.parts; i--) { scene.remove(particles[i].m); particles.splice(i, 1); }
  for (let i = projectiles.length - 1; i >= n0.proj; i--) { scene.remove(projectiles[i].m); projectiles.splice(i, 1); }
}
// ---------- boot ----------
(async function boot() {
  try {
    [playerGltf, enemyGltf, potionGltf, chestGltf, coinGltf, grenadeGltf, crateGltf] = await Promise.all([
      trackLoad('./assets/player.glb'),
      trackLoad('./assets/enemy.glb'),
      trackLoad('./assets/health_potion.glb'),
      trackLoad('./assets/chest.glb'),
      trackLoad('./assets/coin_pile_spill.glb'),
      trackLoad('./assets/grenade.glb'),
      trackLoad('./assets/crate.glb'),
    ]);
    for (const g of [playerGltf, enemyGltf, potionGltf, chestGltf, coinGltf, grenadeGltf, crateGltf]) {   // 에셋 안의 빈 프리미티브: 경계구 NaN 경고 방지
      g.scene.traverse(o => {
        const geo = o.geometry; if (!geo) return;
        const p = geo.attributes.position;
        if (!p || p.count === 0) { geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0); geo.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()); o.visible = false; return; }
        geo.computeBoundingSphere();
        if (!Number.isFinite(geo.boundingSphere.radius)) { geo.boundingSphere.set(new THREE.Vector3(), 0); o.visible = false; }
      });
    }
    document.getElementById('gImg').src = makeThumb(grenadeGltf.scene);
    updateGSlot();
    stripRootMotion(playerGltf);
    patchShortsHole(playerGltf.scene);   // 반바지 구멍 메우기
    stripRootMotion(enemyGltf);
    setupPlayer();
    loadProgress(); // 저장된 코인·업그레이드·수류탄 복원
    updateAmmo();
    updateHpHud();
    applyView();
    applyCtrl();
    warmUpShaders();                     // 첫 적이 나올 때 멈칫하지 않게 미리 컴파일
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
      wave, score, kills, headshots, shotsFired, shotsHit, acc: accuracy(), ammo, coins, combo, camMode, ctrlMode, mapMode, rooms: mapRects.filter(r => r.room).length, corridors: mapRects.filter(r => !r.room).length, rects: mapRects.map(r => ({ w: r.x1 - r.x0, d: r.z1 - r.z0, room: r.room })), gameTime: +gameTime.toFixed(2), buffT: +buffT.toFixed(2),
      upg: { ...upg }, maxHp: maxHp(), mag: magSize(), reloadMs: Math.round(reloadMs()), fireMs: Math.round(weapon === 'pistol' ? PISTOL_DELAY : fireInterval()),
      grenades, gMode, slot, weapon, pen: penPower(), recoil: +recoil.toFixed(4), shakeT: +shakeT.toFixed(2), blocking, parryReady: parryReady(), timeScale: timeScale(), mag: magSize(), markers: markers.length, projSpeed: projectiles[0] ? +projectiles[0].vel.length().toFixed(2) : null, gWindup, gReleasePending, tossTime: +((player.upperShot === 'toss grenade' ? player.upperAct : player.actions['toss grenade'])?.time ?? -1).toFixed(2), tossScale: (player.upperShot === 'toss grenade' ? player.upperAct : player.actions['toss grenade'])?.timeScale ?? -1, upperShot: player.upperShot ?? null, loco: player.current ? player.current.getClip().name : null, liveGrenades: liveGrenades.length, mines, liveMines: liveMines.length, multiN,
      beacon: beacon ? { x: +beacon.x.toFixed(1), z: +beacon.z.toFixed(1), left: +(beacon.limit - beacon.t).toFixed(1) } : null,
      seenRects: seenRects.size, hitArrows: hitArrows.length, mapSeed, roomThemes: [...roomThemes],
      safeRoom: safeRoom ? { until: +Math.max(0, safeUntil - gameTime).toFixed(1) } : null,
      chainCd: +chainCd.toFixed(2), ribbon: ribbonOwned, chainUses, chainRe: +chainRe.toFixed(1), lava: lavaRects.length, onLava: onLava(player.pos.x, player.pos.z),
      floorNo, floorTime: +floorTime.toFixed(1), portalTravel, cores, spawnCd: +spawnCd.toFixed(2), floorShopOpen,
      portal: portal ? { x: +portal.x.toFixed(1), z: +portal.z.toFixed(1), locked: !!portal.locked } : null,
      hunter: hunter ? { pos: hunter.root.position.toArray().map(v => +v.toFixed(1)), speed: +hunter.speed.toFixed(1), stunAcc: hunter.stunAcc, stunT: +hunter.stunT.toFixed(2) } : null,
      hp: player.hp, eyeH: +player.eyeH.toFixed(2), crouch: player.crouch, zooming: player.zooming, firing, yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3), fov: +camera.fov.toFixed(1),
      dashCd: +player.dashCd.toFixed(2),
      playerPos: player.pos.toArray().map(v => +v.toFixed(2)),
      enemies: enemies.map(e => ({
        state: e.state, hp: e.hp, maxhp: e.maxhp, kind: e.kind, isBoss: e === bossOfFloor, runner: e.runner,
        pos: e.root.position.toArray().map(v => +v.toFixed(2)),
        clip: e.current?.getClip().name ?? null, atkRate: e.atkRate ?? 1, atkCd: +(e.atkCd ?? 0).toFixed(2),
        clipDur: +(e.current?.getClip().duration ?? 0).toFixed(2), clipScale: e.current?.timeScale ?? null,
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
    updateMines(dt);
    updateBeacon(dt);
    updateDecals(dt);
    updateChain(dt);
    updateSky(dt);
    updateCrateMotion(dt);
    updateJumpPads(dt);
    updateDoors(dt);
    waveSpawnTick(dt);
    updateShadowLod(dt);
    cullWorld(dt);
    for (const en of enemies) updateEnemy(en, dt);
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].gone) enemies.splice(i, 1);
    syncBlobs();
    if (opts.shoot) { lastShot = 0; shoot(performance.now()); }
    Object.keys(opts.keys ?? {}).forEach(k => keys[k] = false);
  },
  shot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
  perf() {                                // 성능 진단: 무엇이 많이 그려지고 있나
    let live = 0, casters = 0;
    for (const en of enemies) { if (en.gone) continue; live++; if (en.shadowOn) casters++; }
    renderer.render(scene, camera);
    const ri = renderer.info.render, mi = renderer.info.memory;
    let blobs = 0; for (const en of enemies) if (en.blob) blobs++;
    let worldVis = 0; for (const o of worldGroup.children) if (o.visible) worldVis++;
    const pool = enemyPool.length;
    let wallPieces = 0; for (const o of worldGroup.children) if (o.isMesh && o.material === wallMat) wallPieces++;
    let pointLights = 0, lightsUsed = 0; scene.traverse(o => { if (o.isPointLight) pointLights++; }); for (const l of lightPool) if (l.userData.owner) lightsUsed++;
    const worldAll = worldGroup.children.length;
    return { enemies: live, alive: aliveCount(), shadowCasters: casters, blobs, shadowQ, staticShadow: !sun.shadow.autoUpdate, worldVis, worldAll, pool, wallPieces, pointLights, lightsUsed, programs: renderer.info.programs.length, queued: waveQueue.length,
      draw: ri.calls, tri: ri.triangles, geometries: mi.geometries, textures: mi.textures,
      particles: particles.length, decals: decals.length, tracers: tracers.length, obstacles: obstacles.length };
  },
  refill() { ammo = magSize(); reloading = false; updateAmmo(); },
  reload() { ammo = 0; reload(); return { reloading, upperShot: player.upperShot }; },
  release() { releaseGrenadeWindup(); return { gWindup, grenades, pending: pendingThrows.length }; },
  spawnAt(x, z, variant = 'walker') { spawnEnemy(wave || 1, variant); const e = enemies[enemies.length - 1]; e.root.position.set(x, 0, z); e.state = 'chase'; return e; },
  dropAt(type, x, z) { type === 'coin' ? dropCoins(x, z) : dropItem(type, x, z); },
  hurt(n, src, x, z) { damagePlayer(n, x, z, src); },
  chain() { fireChain(); return { cd: +chainCd.toFixed(2), dashT: +player.dashT.toFixed(2) }; },
  block(on = true) {                      // 디버그: 방패 들기/내리기
    if (on) { blocking = true; blockAt = performance.now(); shieldPose(true); }
    else { blocking = false; shieldPose(false); }
    return { blocking, parry: parryReady() };
  },
  meshes() {
    const out = [];
    player.root?.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      out.push({
        n: o.name, m: o.material?.name ?? '', side: o.material?.side,
        color: '#' + (o.material?.color?.getHexString() ?? '?'), verts: o.geometry.attributes.position.count,
        y: [+bb.min.y.toFixed(2), +bb.max.y.toFixed(2)], skinned: !!o.isSkinnedMesh,
      });
    });
    return out;
  },
  setSide(re, two = true) { let k = 0; const rx = new RegExp(re, 'i'); player.root?.traverse(o => { if (o.isMesh && (rx.test(o.name) || rx.test(o.material?.name ?? ''))) { o.material.side = two ? THREE.DoubleSide : THREE.FrontSide; o.material.needsUpdate = true; k++; } }); return k; },
  hurtEnemy(i, dmg) { const e = enemies[i]; if (!e) return null; if (damageEnemy(e, dmg ?? 10)) killEnemy(e); return e.hp; },
  skipWave() { skipWave(); },
  addGrenades(n = 1) { grenades += n; updateGSlot(); },
  addMines(n = 1) { mines += n; updateMineSlot(); },
  placeMine() { placeMine(); },
  spawnBeacon() { spawnBeacon(); return window.__game.state.beacon; },
  setFloorTime(t) { floorTime = t; },
  toFloor(f) { floorNo = f - 1; nextFloor(); },
  floorShop() { openFloorShop(); return document.querySelector('#btnResume span')?.textContent.trim(); },
  populate() { return populateRooms(); },
  jumpPads() { return jumpPads.map(p => ({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), used: p.used })); },
  spawnPads() { return spawnJumpPads(); },
  doors() { return doors.map(d => ({ x: +d.x.toFixed(1), z: +d.z.toFixed(1), open: d.open, sw: [+d.sw.x.toFixed(1), +d.sw.z.toFixed(1)] })); },
  spawnDoors() { return spawnDoors(); },
  crates() { return woodCrates.map(c => ({ x: +c.x.toFixed(1), z: +c.z.toFixed(1), hp: c.hp })); },
  breakCrate(i = 0) { const c = woodCrates[i]; if (!c) return null; openWoodCrate(c); scene.remove(c.grp); woodCrates.splice(i, 1); return woodCrates.length; },
  furnOwned() { return [...furnOwned]; },
  reach(x, z) { return reachable(playerStart.x, playerStart.z, x, z); },
  room() { const r = curRoom(); return { w: roomW(r), d: roomD(r), name: r.name, bg: r.bg, slots: roomStore.slots.map(s2 => ({ n: s2.name, w: roomW(s2), d: roomD(s2) })), cur: roomStore.cur, items: r.items.map(i => ({ ...i })) }; },
  roomPlace(type, x, z, rot = 0, host = null) {
    startPlace(type); placeRot = rot;
    const q = snapPos(type, rot, x, z, host);
    placeGhost.userData.snap = q;
    placeGhost.position.set(q.x, q.y || 0, q.z);
    commitPlace(); cancelPlace();
    return { n: (roomStore.slots[q.slot ?? roomStore.cur]).items.length, snap: { slot: q.slot, x: q.x, z: q.z, y: q.y || 0, on: !!q.on, under: !!q.under, wall: !!q.wall } };
  },
  roomGrow(axis) { expandRoom(axis); return { w: roomW(curRoom()), d: roomD(curRoom()) }; },
  guides() { return worldRooms.map(r => ({ slot: r.slot, floor: !!r.guide?.visible, wall: !!r.wallGuide?.visible })); },
  fronts() { return worldRooms.map(r => ({ slot: r.slot, room: !!r.grp?.visible, front: !!r.front?.visible, panels: r.front?.children.length ?? 0 })); },
  doorVis() { return liveDoors.map(d => ({ from: d.from, to: d.to, panel: !!d.panel?.visible })); },
  furnDump() {
    const out = [];
    srFurnGrp?.children.forEach(m => out.push({
      t: m.userData.item?.type, itemY: m.userData.item?.y, meshY: +m.position.y.toFixed(2),
      worldY: +m.getWorldPosition(new THREE.Vector3()).y.toFixed(2), room: m.userData.room, vis: m.visible,
    }));
    if (placeGhost) out.push({ t: 'GHOST:' + placeType, meshY: +placeGhost.position.y.toFixed(2) });
    return out;
  },
  outlineCount() { let n = 0; srFurnGrp?.traverse(o => { if (o.userData.outline) n++; }); return n; },
  outline(v) { outlineOn = v ?? !outlineOn; localStorage.setItem('fps.outline', outlineOn ? '1' : '0'); if (srOn) buildFurnitureAll(); return outlineOn; },
  roomProject(i) {
    const it = curRoom().items[i];
    if (!it || !srCam) return null;
    srApplyCam();
    const v = new THREE.Vector3(it.x, 0.3, it.z).project(srCam);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: Math.round(r.left + (v.x * 0.5 + 0.5) * r.width), y: Math.round(r.top + (-v.y * 0.5 + 0.5) * r.height) };
  },
  roomPick(x, y) { setSel(pickFurniture({ clientX: x, clientY: y })); return curRoom().items.indexOf(srPickSel); },
  pickDebug(x, y) {
    srApplyCam();
    const r = renderer.domElement.getBoundingClientRect();
    const nd = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(nd, srCam);
    const hits = raycaster.intersectObjects(srFurnGrp ? srFurnGrp.children : [], true);
    return {
      nd: [+nd.x.toFixed(3), +nd.y.toFixed(3)], mode: srMode, cur: roomStore.cur,
      kids: srFurnGrp ? srFurnGrp.children.length : -1,
      vis: srFurnGrp ? srFurnGrp.children.map(m => ({ t: m.userData.item?.type, room: m.userData.room, v: m.visible })) : [],
      hits: hits.slice(0, 3).map(h => { let o = h.object; while (o && !o.userData.item) o = o.parent; return { d: +h.distance.toFixed(2), t: o?.userData.item?.type ?? '?', room: o?.userData.room }; }),
      cam: srCam.position.toArray().map(v => +v.toFixed(2)),
    };
  },
  roomSelect(i) { setSel(curRoom().items[i] ?? null); return !!srPickSel; },
  roomClear() { clearRoom(); return curRoom().items.length; },
  roomReset() { resetRooms(); return roomStore.slots.length; },
  roomClose() { closeRoom(); return { closed: !!curRoom().closed, items: curRoom().items.length }; },
  roomAdd(gx, gz, w, d, fromItem) {       // 배치 창을 열고(좌표를 주면 바로 확정)
    addRoomSlot(Number.isInteger(fromItem) ? curRoom().items[fromItem] : null);
    if (!addState) return { open: false, slots: roomStore.slots.length };
    if (gx !== undefined) { addState.gx = gx; addState.gz = gz; if (w) addState.w = w; if (d) addState.d = d; }
    const chk = addRoomCheck();
    if (gx !== undefined && chk.ok) { confirmAddRoom(); return { placed: true, slots: roomStore.slots.length }; }
    return { open: true, at: addState ? [addState.gx, addState.gz, addState.w, addState.d, addState.gy] : null, chk, slots: roomStore.slots.length };
  },
  addMove(dx, dz) { addRoomMove(dx, dz); return addState ? { at: [addState.gx, addState.gz], chk: addRoomCheck() } : null; },
  addCancel() { closeAddMap(); },
  moveDo(i, x, z) {                       // 디버그: i번 가구를 (x,z)로 옮겨 확정
    const it = curRoom().items[i];
    if (!it) return null;
    setSel(it); startMove(); moveTo(x, z, null); endMove(true);
    return { sel: !!srPickSel, pos: [it.x, it.z], ctx: document.getElementById('srCtx')?.style.display ?? '' };
  },
  itemSet(i, k, v) { const it = curRoom().items[i]; if (!it) return null; it[k] = v; roomSave(); buildWorld(); return { ...it }; },
  rooms() { return roomStore.slots.map((sl, i) => ({ i, n: sl.name, g: [sl.gx, sl.gz, sl.gy], w: roomW(sl), d: roomD(sl), closed: !!sl.closed, links: sl.items.filter(it => it.link >= 0).map(it => it.type + '>' + it.link + (it.blocked ? '!' + it.why : '')) })); },
  roomLoadSlot(i) { loadRoomSlot(i); return roomStore.cur; },
  roomBg(k) { setBg(k); return curRoom().bg; },
  liveMode(on) { on ? liveEnter() : liveExit(); return srMode; },
  placeProbe(x, y, type = 'crate', rot = 0) {   // 커서 → 원래 지점 → 스냅 결과 비교
    const hit = placePoint({ clientX: x, clientY: y });
    if (!hit) return null;
    const q = snapPos(type, rot, hit.p.x, hit.p.z, hit.host);
    return { raw: [+hit.p.x.toFixed(2), +hit.p.y.toFixed(2), +hit.p.z.toFixed(2)], snap: { x: q.x, y: q.y, z: q.z, slot: q.slot } };
  },
  rayDump(x, y) {
    srApplyCam();
    const r = renderer.domElement.getBoundingClientRect();
    const nd = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(nd, srCam);
    const hs = raycaster.intersectObjects(srFurnGrp ? srFurnGrp.children : [], true);
    return {
      rect: [r.left, r.top, +r.width.toFixed(1), +r.height.toFixed(1)], nd: [+nd.x.toFixed(3), +nd.y.toFixed(3)],
      cam: srCam.position.toArray().map(v => +v.toFixed(2)), fov: srCam.fov, aspect: +srCam.aspect.toFixed(3),
      dir: raycaster.ray.direction.toArray().map(v => +v.toFixed(3)),
      hits: hs.slice(0, 2).map(h => ({ d: +h.distance.toFixed(2), p: h.point.toArray().map(v => +v.toFixed(2)), name: h.object.name || h.object.type })),
      meshes: (srFurnGrp ? srFurnGrp.children : []).map(m => ({ t: m.userData.item?.type, pos: m.position.toArray().map(v => +v.toFixed(2)), wp: m.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(2)) })),
    };
  },
  ghostScreen() {
    if (!placeGhost || !srCam) return null;
    srApplyCam();
    const v = placeGhost.position.clone().project(srCam);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: Math.round(r.left + (v.x * 0.5 + 0.5) * r.width), y: Math.round(r.top + (-v.y * 0.5 + 0.5) * r.height), world: placeGhost.position.toArray().map(n => +n.toFixed(2)) };
  },
  liveDash() { return { t: +live.dashT.toFixed(2), cd: +live.dashCd.toFixed(2) }; },
  liveCam() { return { yaw: +live.camYaw.toFixed(3), pitch: +live.camPitch.toFixed(3), dist: +live.camDist.toFixed(2) }; },
  liveDrag(dx, dy) { live.camYaw -= dx * 0.008; live.camPitch += dy * 0.004; liveStep(1 / 60); return { yaw: +live.camYaw.toFixed(3), pitch: +live.camPitch.toFixed(3) }; },
  winBlocked(slot, side, x, z) { return windowBlocked(slot, side, x, z); },
  entrance() { return srEntrance ? { x: +srEntrance.userData.x.toFixed(2), z: +srEntrance.userData.z.toFixed(2), open: +srEntrance.userData.open.toFixed(2), left: +srEntrance.userData.left.rotation.y.toFixed(2), right: +srEntrance.userData.right.rotation.y.toFixed(2), doorVisible: srEntrance.visible, sill: !!srEntrance.userData.sill?.visible, glow: +(srEntrance.userData.sill?.userData.glow.opacity ?? 0).toFixed(2) } : null; },
  gizmo() { return srGizmo ? srGizmo.children.map(o => ({ p: o.position.toArray().map(v => +v.toFixed(2)), anchor: o.userData.corner })) : null; },
  gizmoDrag(i, u, y) {                    // 디버그: i번 손잡이를 (u,y)로 끈다
    if (!srGizmo || !srPickSel) return null;
    const a2 = srGizmo.children[i]?.userData.corner;
    if (!a2) return null;
    const ok = applyWallSize(srPickSel, a2.u, a2.y, u, y);
    if (ok) { roomSave(); refreshRoom(srPickSel.type); syncOutline(); }
    return { ok, w: srPickSel.w, h: srPickSel.h, x: srPickSel.x, z: srPickSel.z, y: srPickSel.y };
  },
  pickDoor(i) {                          // 디버그: i번 문을 고른 것처럼 처리
    const d = liveDoors[i];
    if (!d) return null;
    if (d.from !== roomStore.cur && d.to !== roomStore.cur) return { ok: false, why: 'not-linked-to-cur' };
    if (d.from !== roomStore.cur) { roomStore.cur = d.from; roomRenderUI(); syncGuides(); }
    setSel(d.item);
    return { ok: true, cur: roomStore.cur, sel: srPickSel === d.item, type: d.item.type };
  },
  nanGeos() {                            // 디버그: 경계구 반지름이 NaN인 지오메트리 (빈 위치 배열)
    const out = [];
    scene.traverse(o => { const g = o.geometry; if (!g || !g.boundingSphere) return; if (Number.isNaN(g.boundingSphere.radius)) out.push({ type: o.type, name: o.name, parent: o.parent?.name || o.parent?.type, geo: g.type, idx: !!g.index, pos: g.attributes.position ? g.attributes.position.count : -1, visible: o.visible, cast: o.castShadow }); });
    return out;
  },
  pieces() { if (!dbgPiecesGrp) return null; const c = { wall: 0, floor: 0, lava: 0 }; for (const o of dbgPiecesGrp.children) c[o.userData.kind]++; return c; },
  sky() { return skyGrp ? { parts: skyGrp.children.length, t: +(auroraMat?.uniforms.uT.value ?? 0).toFixed(2), at: skyGrp.position.toArray().map(v => +v.toFixed(1)) } : null; },
  fence() { return srFence ? { posts: srFence.children[0].count, rails: srFence.children.length - 1, box: [MAP_R.x0, MAP_R.z0, MAP_R.x1, MAP_R.z1 + FIELD_EXTRA] } : null; },
  fieldWhy(x, z) { return { why: fieldWhy(x, z) || 'ok', rooms: worldRooms.filter(r => Math.abs(r.cy || 0) < 0.1).map(r => ({ s: r.slot, ...roomRect(r) })) }; },
  livePos() { return { mode: srMode, x: +live.x.toFixed(2), z: +live.z.toFixed(2), y: +live.y.toFixed(2), rooms3: worldRooms.map(r => ({ s: r.slot, cy: +(r.cy || 0).toFixed(2) })), yaw: +live.yaw.toFixed(3), camYaw: +live.camYaw.toFixed(3), camDist: +live.camDist.toFixed(2), srYaw: +srYaw.toFixed(3), rootRot: +(srRoot?.rotation.y ?? 0).toFixed(3), active: live.active, doors: liveDoors.length, rooms: worldRooms.map(r => ({ slot: r.slot, cx: +r.cx.toFixed(2), cz: +r.cz.toFixed(2), w: r.w, d: r.d })) }; },
  liveStep(n = 1, k = {}) { for (let i = 0; i < n; i++) { Object.assign(keys, k); liveStep(1 / 60); } for (const kk of Object.keys(k)) keys[kk] = false; return { x: +live.x.toFixed(2), z: +live.z.toFixed(2), y: +live.y.toFixed(2), active: live.active }; },
  links() { return roomStore.slots.map((sl, i) => ({ i, n: sl.name, links: sl.items.filter(it => FURN[it.type]?.link).map(it => it.type + '(' + it.x + ',' + it.z + ')→' + it.link + (it.blocked ? '!' + it.why : '')) })); },
  showroom() { return { on: srOn, sel: srSel, yaw: +srYaw.toFixed(3), spin: srSpin, target: { y: +srTarget.y.toFixed(2), dist: +srTarget.dist.toFixed(2) }, pan: +srPan.x.toFixed(2), view: { y: +srView.y.toFixed(2), dist: +srView.dist.toFixed(2) }, clip: srCurrent?.getClip().name ?? null }; },
  openDoor(i) { const d = doors[i]; if (d) openDoor(d); return doors.length; },
  placeMarker() { placeMarker(); return markers.length; },
  markerInfo() {
    return markers.map(m => ({
      onObj: !!m.obj, objY: m.obj ? +m.obj.yOff.toFixed(2) : null,
      pieces: m.sp.children.map(c => {
        const w = c.getWorldPosition(new THREE.Vector3());
        const n = c.getWorldDirection(new THREE.Vector3());
        const uv = c.geometry.attributes.uv;
        let u0 = 9, u1 = -9, v0 = 9, v1 = -9;
        for (let i = 0; i < uv.count; i++) {
          u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i));
          v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i));
        }
        return {
          p: w.toArray().map(v => +v.toFixed(2)), n: n.toArray().map(v => +v.toFixed(2)),
          uv: [u0, u1, v0, v1].map(v => +v.toFixed(2)),
          size: [+c.geometry.parameters.width.toFixed(2), +c.geometry.parameters.height.toFixed(2)],
        };
      }),
    }));
  },
  aim() {
    const h = aimHitPoint(MARKER_RANGE, true);
    if (!h) return null;
    const eye = new THREE.Vector3(player.pos.x, player.pos.y + player.eyeH, player.pos.z);
    return { p: h.p.toArray().map(v => +v.toFixed(2)), n: h.n.toArray(), dEye: +eye.distanceTo(h.p).toFixed(2), dCam: +camera.position.distanceTo(h.p).toFixed(2), camToEye: +camera.position.distanceTo(eye).toFixed(2) };
  },
  chainProbe() {                          // 디버그: 리본이 무엇을 맞추고 어디로 띄우는지
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const dir = raycaster.ray.direction.clone(), origin = raycaster.ray.origin.clone();
    let wallT = chainRange(), hitObs = null, hitWall = false;
    for (const o of obstacles) {
      const t = rayAABB(origin, dir, new THREE.Vector3(o.x - o.w / 2, o.yOff, o.z - o.d / 2),
        new THREE.Vector3(o.x + o.w / 2, o.yOff + o.h, o.z + o.d / 2));
      if (t !== null && t < wallT) { wallT = t; hitObs = o.noStand ? null : o; hitWall = !!o.noStand; }
      if (!o.stem) continue;
      const ts = rayAABB(origin, dir, new THREE.Vector3(o.x - o.stem.w / 2, o.stem.y0, o.z - o.stem.d / 2),
        new THREE.Vector3(o.x + o.stem.w / 2, o.stem.y1, o.z + o.stem.d / 2));
      if (ts !== null && ts < wallT) { wallT = ts; hitObs = o; hitWall = false; }
    }
    if (walkGrid) { const gt = gridRayT(origin, dir, wallT); if (gt !== null && gt <= wallT) { wallT = gt; hitObs = null; hitWall = true; } }
    const hit = origin.clone().addScaledVector(dir, wallT);
    const top = hitObs ? hitObs.yOff + hitObs.h : hit.y;
    const cr0 = crateOnRay(origin, dir, Math.min(wallT, chainRange()));
    return { crate: cr0 ? +cr0.t.toFixed(2) : null, crates: woodCrates.map(c => ({ x: +c.x.toFixed(1), z: +c.z.toFixed(1), v: [+(c.vx||0).toFixed(2), +(c.vz||0).toFixed(2)] })), camY: +origin.y.toFixed(2), dir: dir.toArray().map(v => +v.toFixed(2)), wallT: +wallT.toFixed(2),
      hitWall, hitObs: !!hitObs, hitY: +hit.y.toFixed(2), up: +(top - player.pos.y).toFixed(2),
      range: chainRange() };
  },
  deep(f) { if (f !== undefined) { deepFloor = Math.max(1, f); localStorage.setItem('fps.deep', String(deepFloor)); } return deepFloor; },
  tpTo(f) { teleportTo(f); return floorNo; },
  tpCost(f) { return { coin: tpCoin(f), head: tpHead(f) }; },
  toPortal() { if (portal) player.pos.set(portal.x, 0, portal.z); },
  buildSeed(seed) { mapMode = 'random'; clearWorld(); seenRects.clear(); buildRandom(seed); return mapSeed; },
  srProfile(n = 300, k = {}, thresh = 16) {   // 쇼룸 생활모드 n프레임: 키를 누른 채 걸으며 프레임 시간·새 셰이더·보이는 점광원 수를 기록
    const out = []; let worst = 0;
    const visLights = () => { let c = 0; srScene.traverse(o => { if (!o.isPointLight) return; let p = o, v = true; while (p) { if (!p.visible) { v = false; break; } p = p.parent; } if (v) c++; }); return c; };
    for (let f = 0; f < n; f++) {
      Object.assign(keys, k);
      const p0 = renderer.info.programs.length, t0 = performance.now();
      srMixer.update(1 / 60); roomUpdate(); liveStep(1 / 60); syncSrLights();
      const t1 = performance.now(); renderer.render(srScene, srCam); const t2 = performance.now();
      const ms = t2 - t0; if (ms > worst) worst = ms;
      if (ms > thresh) out.push({ f, ms: +ms.toFixed(1), upd: +(t1 - t0).toFixed(1), render: +(t2 - t1).toFixed(1), newProgs: renderer.info.programs.length - p0, lights: visLights(), x: +live.x.toFixed(1), z: +live.z.toFixed(1) });
    }
    for (const kk of Object.keys(k)) keys[kk] = false;
    return { worst: +worst.toFixed(1), spikes: out.length, list: out.slice(0, 20), lights: visLights(), programs: renderer.info.programs.length, pos: { x: +live.x.toFixed(1), z: +live.z.toFixed(1) } };
  },
  playerShadow() { let cast = 0, n = 0; player.root?.traverse(o => { if (o.isMesh || o.isSkinnedMesh) { n++; if (o.castShadow) cast++; } }); return { q: shadowQ, meshes: n, casting: cast, blob: !!playerBlob?.visible, blobAt: playerBlob ? playerBlob.position.toArray().map(v => +v.toFixed(2)) : null, autoUpdate: sun.shadow.autoUpdate }; },
  bones() { const n = []; player.root?.traverse(o => { if (o.isBone) n.push(o.name); }); return n; },
  jumpInfo() { const a = player.actions['rifle jump']; return { oneShot: player.oneShot ?? null, timeScale: +(a?.timeScale ?? 0).toFixed(2), clipDur: +(a?.getClip().duration ?? 0).toFixed(2), vy: +player.vy.toFixed(2), onGround: player.onGround, y: +player.pos.y.toFixed(2), jumpUpg: upg.jump }; },
  setUpg(k, v) { upg[k] = v; return { ...upg }; },
  upper() { const w = {}; for (const k in player.actions) { const a = player.actions[k]; if (a.isRunning() && a.getEffectiveWeight() > 0.001) w[k] = +a.getEffectiveWeight().toFixed(2); } return { upperShot: player.upperShot ?? null, loco: player.current?.getClip().name ?? null, weights: w, tracks: { runLower: player.actions['rifle run_lower']?.getClip().tracks.length, reloadUpper: player.actions['reloading_upper']?.getClip().tracks.length, reloadFull: player.actions['reloading']?.getClip().tracks.length } }; },
  sfx() { const st = {}; for (const k of Object.keys(SFX_FILES)) st[k] = sfxBuf[k] ? [+sfxBuf[k].duration.toFixed(2), +(sfxOff[k] ?? 0).toFixed(3)] : (sfxRaw[k] ? 'raw' : 'none'); return { ac: !!AC, latency: AC ? +(AC.baseLatency ?? 0).toFixed(3) : null, files: st }; },
  sfxPlay(name) { audioInit(); return playSample(name); },
  obs() { return obstacles.map((o, i) => ({ i, x: +o.x.toFixed(1), z: +o.z.toFixed(1), w: o.w, d: o.d, h: +o.h.toFixed(2), top: +(o.yOff + o.h).toFixed(2), ribbonOnly: !!o.ribbonOnly, platform: !!o.platform, stem: !!o.stem, noStand: !!o.noStand })); },
  air() { return { ribbonAir: !!player.ribbonAir, standObs: player.standObs ? obstacles.indexOf(player.standObs) : null, y: +player.pos.y.toFixed(2), vy: +player.vy.toFixed(2), onGround: player.onGround, x: +player.pos.x.toFixed(1), z: +player.pos.z.toFixed(1) }; },
  fixCam(aspect = 1.6) { if (!isFinite(camera.aspect) || camera.aspect <= 0) { camera.aspect = aspect; camera.updateProjectionMatrix(); } camera.updateMatrixWorld(true); return { aspect: camera.aspect, pos: camera.position.toArray().map(v => +v.toFixed(2)) }; },
  gear(p, r) { if (p !== undefined) pistolOwned = !!p; if (r !== undefined) ribbonOwned = !!r; chainUses = Math.max(chainUses, 1); updateRibbonSlot?.(); return { pistolOwned, ribbonOwned, chainUses }; },
  clips() { return playerGltf ? playerGltf.animations.map(c => [c.name, +c.duration.toFixed(2), c.tracks.length]) : null; },
  srLights() { return srLightPool.map(l => ({ i: +l.intensity.toFixed(2), p: l.position.toArray().map(v => +v.toFixed(1)) })).filter(x => x.i > 0); },
  startPlace(type) { startPlace(type); return !!placeType; },
  srDbg() { return { snap: placeGhost?.userData.snap ? { x: placeGhost.userData.snap.x, z: placeGhost.userData.snap.z } : null, lastItem: (() => { const it = curRoom().items[curRoom().items.length - 1]; return it ? { t: it.type, x: it.x, z: it.z } : null; })(), ghostVisible: placeGhost ? placeGhost.visible : null, placeType, placeDrag, touchPick: !!touchPick, placeAskKind, srEditUI, srMode, suppressClick, moveItem: !!moveItem, sizeDrag: !!sizeDrag, tab: srTab }; },
  progs() { return renderer.info.programs.map(p => p.name + '|' + p.cacheKey.length + '|' + p.usedTimes); },
  hitches() {                            // 실제 플레이 중 기록된 끊김 + 구간별 평균(ms)
    const avg = {}; for (let i = 0; i < PT_NAMES.length; i++) avg[PT_NAMES[i]] = +(PT_SUM[i] / Math.max(1, ptFrames)).toFixed(3);
    return { count: hitchN, frames: ptFrames, avg, last: hitches.slice(-15) };
  },
  profile(n = 600, opts = {}) {          // 합성 플레이 n프레임: 적 스폰·사격을 섞어 돌리며 프레임별 시간을 잰다
    const out = [], spawnEvery = opts.spawnEvery ?? 45, maxE = opts.maxEnemies ?? 10;
    let worst = 0, worstAt = -1; const sum = new Float64Array(PT.length);
    for (let f = 0; f < n; f++) {
      const f0 = performance.now();
      const p0 = renderer.info.programs.length, tx0 = renderer.info.memory.textures, ge0 = renderer.info.memory.geometries;
      PT.fill(0); ptSpawned = 0; ptBaked = false; frameNo++;
      if (f % spawnEvery === 0 && aliveCount() < maxE) { const a = Math.random() * 6.28, r = 6 + Math.random() * 8; const e = window.__game.spawnAt(player.pos.x + Math.cos(a) * r, player.pos.z + Math.sin(a) * r, ['walker', 'runner', 'jumper', 'ranged'][f % 4]); if (e && opts.kill && f % (spawnEvery * 2) === 0) { window.__game.hurtEnemy(enemies.indexOf(e), 9999); } }
      if (opts.shoot !== false && f % 6 === 0) { lastShot = 0; shoot(performance.now()); }
      syncLights(); simPlaying(1 / 60, performance.now());
      const tr = performance.now(); renderer.render(scene, camera); PT[11] = performance.now() - tr;
      const total = performance.now() - f0;
      for (let i = 0; i < PT.length; i++) sum[i] += PT[i];
      if (total > worst) { worst = total; worstAt = f; }
      if (total > (opts.thresh ?? 20)) out.push({ f, ms: +total.toFixed(1), newProgs: renderer.info.programs.length - p0, newTex: renderer.info.memory.textures - tx0, newGeo: renderer.info.memory.geometries - ge0, top: [...PT_NAMES.keys()].map(i => [PT_NAMES[i], +PT[i].toFixed(1)]).sort((a, b) => b[1] - a[1]).slice(0, 3), spawned: ptSpawned, baked: ptBaked, enemies: enemies.length });
    }
    const avg = {}; for (let i = 0; i < PT_NAMES.length; i++) avg[PT_NAMES[i]] = +(sum[i] / n).toFixed(2);
    return { frames: n, worstMs: +worst.toFixed(1), worstAt, spikes: out.length, avg, list: out.slice(0, 25), enemies: enemies.length, pool: enemyPool.length };
  },
  tunnel(spd = 60, dt = 0.05, frames = 10) {   // 디버그: 1칸 두께 벽을 향해 초고속 대쉬 — 뚫고 나가면 leaked:true
    const g = walkGrid; if (!g) return null;
    let sx = null, sz = null, wallX = null;
    for (let j = 1; j < g.gh - 1 && sx === null; j++) for (let i = 2; i < g.gw - 3; i++) {
      const ok = k => !!g.cells[j * g.gw + k];
      if (ok(i - 1) && ok(i) && !ok(i + 1) && ok(i + 2)) { sx = g.ox + i + 0.5; sz = g.oz + j + 0.5; wallX = g.ox + i + 1; break; }
    }
    if (sx === null) return { found: false };
    player.pos.set(sx, 0, sz); player.vy = 0; player.dead = false;
    player.dashT = 0.3; player.dashSpd = spd; player.dashDir = { x: 1, z: 0 }; player.dashCd = 5;
    for (const k in keys) keys[k] = false;
    let maxX = -1e9, solidHit = false;
    for (let f = 0; f < frames; f++) { updatePlayer(dt); maxX = Math.max(maxX, player.pos.x); if (cellSolid(player.pos.x, player.pos.z)) solidHit = true; }
    return { found: true, startX: +sx.toFixed(2), wallX, endX: +player.pos.x.toFixed(2), maxX: +maxX.toFixed(2), leaked: player.pos.x > wallX + 0.5, solidHit, perFrame: +(spd * dt).toFixed(2) };
  },
  walkable(x, z) { return !cellSolid(x, z); },
  setPos(x, y, z) { player.pos.set(x, y, z); player.vy = 0; player.onGround = true; },
  toss() { throwGrenade(); },
  windup(on = true) { if (on) startGrenadeWindup(); else cancelGrenadeWindup(); return { gWindup, grenades }; },
  selectSlot(name) { selectSlot(name); return slot; },
  revive() { player.dead = false; player.hp = maxHp(); msgEl.style.display = 'none'; updateHpHud(); },
  buy(k) { buyUpg(k); },
  addCoins(n) { coins += n; setCoinHud(); renderUpg(); persistProgress(); },
};

// 설치형 앱(PWA): 홈 화면에 추가하면 주소창 없는 전체 화면으로 열린다 (manifest display: fullscreen)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.)/.test(location.hostname))) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { }); });
}
