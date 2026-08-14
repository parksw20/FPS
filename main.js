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

// ---------- map: 광장 / 절차적 랜덤(방+복도) ----------
const ARENA = 40;                       // 광장 반경
const WALL_H = 6;                       // 랜덤맵 벽 높이 (천장 없음 — 위는 뚫려 있다)
let mapMode = localStorage.getItem('fps.map') || 'plaza';  // 'plaza' | 'random'
let mapRadius = ARENA;                  // 미니맵·스폰 기준
let mapRects = [];                      // 랜덤맵 바닥 사각형 {x0,z0,x1,z1,room}
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
const FLOOR_TIME = 60;                  // 층 제한시간(초)
let floorTime = FLOOR_TIME;
let hunter = null;                      // 제한시간 초과 시 등장하는 무적 추격자
let warping = false, floorShopOpen = false;
let portalTravel = 0;   // A→B 실제 이동거리(m)
const playerStart = new THREE.Vector3(0, 0, 0);
const worldGroup = new THREE.Group();
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
const groundMat = new THREE.MeshStandardMaterial({ map: groundTexture(20), roughness: 0.95 });
const floorMat = new THREE.MeshStandardMaterial({ map: groundTexture(1), roughness: 0.95 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x2b3547, roughness: 0.8 });
const edgeMat = new THREE.MeshStandardMaterial({ color: 0x2a7a52, emissive: 0x1f5c3d, emissiveIntensity: 1.2 });
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
}
function clearWorld() {
  for (const o of [...worldGroup.children]) {
    worldGroup.remove(o);
    o.traverse(c => { if (c.geometry) c.geometry.dispose(); });
  }
  obstacles.length = 0; mapRects = []; walkGrid = null; spawnPoints = []; flowField = null;
  clearPortal();
}

function buildPlaza() {
  const ground = new THREE.Mesh(new THREE.CircleGeometry(ARENA + 6, 64).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true; worldGroup.add(ground);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 7, 11.5), wallMat);
    wall.position.set(Math.cos(a) * (ARENA + 1.5), 3.5, Math.sin(a) * (ARENA + 1.5));
    wall.rotation.y = -a; wall.castShadow = true; wall.receiveShadow = true;
    worldGroup.add(wall);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.15, 11.6), edgeMat);
    strip.position.set(wall.position.x, 7.05, wall.position.z); strip.rotation.y = -a;
    worldGroup.add(strip);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2, r = rnd(9, ARENA - 6);
    const platform = i % 3 === 0;                 // 1/3은 점프로 올라갈 수 있는 낮은 플랫폼
    const w = rnd(platform ? 2.4 : 1.6, 4), d = rnd(platform ? 2.4 : 1.6, 4);
    const h = platform ? rnd(0.8, 1.0) : rnd(1.2, 4.2);
    addLiftBox(Math.cos(a) * r, Math.sin(a) * r, w, d, h, platform, i);
  }
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

  // 바닥
  for (const r of mapRects) {
    const m = floorMesh(r.x1 - r.x0, r.z1 - r.z0);
    m.position.set((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
    worldGroup.add(m);
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
  const wi = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, WALL_H, 1.02), wallMat, wc.length);
  const ci = new THREE.InstancedMesh(new THREE.BoxGeometry(1.06, 0.14, 1.06), edgeMat, wc.length);
  wi.castShadow = true; wi.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  wc.forEach(([x, z], k) => {
    m4.makeTranslation(x, WALL_H / 2, z); wi.setMatrixAt(k, m4);
    m4.makeTranslation(x, WALL_H + 0.07, z); ci.setMatrixAt(k, m4);
  });
  wi.instanceMatrix.needsUpdate = true; ci.instanceMatrix.needsUpdate = true;
  worldGroup.add(wi); worldGroup.add(ci);

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
      const lamp = new THREE.PointLight(0xff4433, 6, Math.max(w, d) * 0.9);
      lamp.position.set((r.x0 + r.x1) / 2, 3.2, (r.z0 + r.z1) / 2);
      worldGroup.add(lamp);
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
  setSunBounds(Math.min(140, mapRadius + 14));
  const sd = document.getElementById('seedTag');
  if (sd) { sd.textContent = 'SEED ' + mapSeed; sd.style.display = 'block'; }
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
  const lamp = new THREE.PointLight(0x9b6bff, 4, 14);
  lamp.position.y = 2;
  grp.add(lamp);
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
function rebuildFlow() {
  const g = walkGrid; if (!g) { flowField = null; return; }
  const N = g.gw * g.gh;
  if (!flowField || flowField.length !== N) flowField = new Int8Array(N);
  flowField.fill(-1);
  let pi = Math.floor(player.pos.x - g.ox), pj = Math.floor(player.pos.z - g.oz);
  const ok = (i, j) => i >= 0 && j >= 0 && i < g.gw && j < g.gh && g.cells[j * g.gw + i];
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
      if (seen[idx] || !g.cells[idx]) continue;
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
buildMap();

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
const EYE_STAND = 1.62;
const player = {
  root: null, mixer: null, actions: {}, current: null,
  pos: new THREE.Vector3(0, 0, 0), vy: 0, onGround: true,
  yaw: 0, pitch: 0, hp: 100, dead: false,
  eyeH: EYE_STAND, zooming: false,
  oneShot: null, fireAction: null,
  dashT: 0, dashCd: 0, dashDir: { x: 0, z: -1 }, lastDir: { x: 0, z: -1 },
};
let score = 0, kills = 0, wave = 0, ammo = 20, reloading = false, coins = 0;
let buffT = 0; // 무한 탄약 남은 시간
// ---------- 업그레이드 (코인 소모, 기본대비 +5%/레벨) ----------
const upg = { dmg: 0, rate: 0, reload: 0, mag: 0, hp: 0 };
const UPG_NAMES = { dmg: '무기 대미지', rate: '연사력', reload: '재장전', mag: '탄창', hp: 'HP' };
const upgCost = k => 100 * (upg[k] + 1);
const dmgMul = () => 1 + 0.05 * upg.dmg;
const fireInterval = () => 110 / (1 + 0.05 * upg.rate);
const reloadMs = () => 1600 / (1 + 0.05 * upg.reload);
const magSize = () => Math.round(20 * (1 + 0.05 * upg.mag)); // 기본 탄창 20발
const maxHp = () => Math.round(100 * (1 + 0.05 * upg.hp));
function updateHpHud() {
  document.getElementById('hpT').textContent = Math.max(0, player.hp | 0);
  document.getElementById('hpF').style.width = Math.max(0, player.hp / maxHp() * 100) + '%';
}
function renderUpg() {
  const el = document.getElementById('upgList');
  const items = document.getElementById('itemList');   // 소모품은 아래 줄에 따로
  if (!el) return;
  el.innerHTML = '';
  if (items) items.innerHTML = '';
  for (const k of Object.keys(upg)) {
    const btn = document.createElement('button');
    btn.innerHTML = `<span>${UPG_NAMES[k]} Lv.${upg[k]} <small>(+${upg[k] * 5}%)</small> <b>${upgCost(k)}🪙</b></span>`;
    btn.disabled = coins < upgCost(k);
    btn.addEventListener('click', () => buyUpg(k));
    el.appendChild(btn);
  }
  // 수류탄: 정가 100코인, 최대 5개 보유
  const gb = document.createElement('button');
  gb.innerHTML = `<span>💣 수류탄 +1 <small>(${grenades}/5)</small> <b>100🪙</b></span>`;
  gb.disabled = coins < 100 || grenades >= 5;
  gb.addEventListener('click', () => {
    if (coins < 100 || grenades >= 5) return;
    coins -= 100;
    grenades++;
    document.getElementById('coinN').textContent = coins;
    updateGSlot();
    sfxPotion();
    renderUpg();
    persistProgress();
  });
  (items || el).appendChild(gb);
  // 지뢰: 정가 150코인, 최대 5개 보유
  const mb2 = document.createElement('button');
  mb2.innerHTML = `<span>🧨 지뢰 +1 <small>(${mines}/${MINE_MAX})</small> <b>${MINE_COST}🪙</b></span>`;
  mb2.disabled = coins < MINE_COST || mines >= MINE_MAX;
  mb2.addEventListener('click', () => {
    if (coins < MINE_COST || mines >= MINE_MAX) return;
    coins -= MINE_COST; mines++;
    document.getElementById('coinN').textContent = coins;
    updateMineSlot(); sfxPotion(); renderUpg(); persistProgress();
  });
  (items || el).appendChild(mb2);
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
  document.getElementById('coinN').textContent = coins;
}

// ---------- 스코어 랭킹 TOP 10 (localStorage) ----------
function saveRanking() {
  let list;
  try { list = JSON.parse(localStorage.getItem('fps.rank') || '[]'); } catch { list = []; }
  const entry = { score, wave, kills, hs: headshots, acc: accuracy(), seed: mapSeed || '광장', date: new Date().toISOString().slice(0, 10) };
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  list = list.slice(0, 10);
  localStorage.setItem('fps.rank', JSON.stringify(list));
  return { list, entry };
}
function rankingTable(list, me = null) {
  if (!list.length) return '<div class="rankRow"><small>기록이 없습니다</small></div>';
  const rows = list.map((r, i) =>
    `<tr class="${r === me ? 'me' : ''}"><td>${i + 1}</td><td class="num">${r.score.toLocaleString()}</td>` +
    `<td>${r.wave}</td><td>${r.kills}</td><td>${r.hs || 0}</td><td>${r.acc != null ? r.acc + '%' : '-'}</td><td>${r.seed || '-'}</td><td>${r.date}</td></tr>`
  ).join('');
  return `<table class="rankTbl"><thead><tr><th></th><th class="num">점수</th><th>웨이브</th><th>킬수</th><th>헤드샷</th><th>명중률</th><th>맵</th><th>기록일</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function renderRanking() {
  const { list, entry } = saveRanking();
  document.getElementById('rankList').innerHTML = '<h3>TOP 10</h3>' + rankingTable(list, entry);
}
function viewRanking() { // 메인 화면 열람용 (기록 저장 없음)
  let list;
  try { list = JSON.parse(localStorage.getItem('fps.rank') || '[]'); } catch { list = []; }
  document.getElementById('rankMenuList').innerHTML = rankingTable(list);
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
function spawnEnemy(waveN, variant = 'walker') {
  if (variant === true) variant = 'runner'; // 구형 호출 호환
  const runner = variant === 'runner', jumper = variant === 'jumper', ranged = variant === 'ranged', boss = variant === 'boss';
  const isHunter = variant === 'hunter';
  const root = skClone(enemyGltf.scene);
  prepShadows(root);
  root.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.transparent = true; } });
  const sp = pickSpawn();
  const s = boss ? 1.6 : 0.92 + Math.random() * 0.28; // 보스는 타 개체(평균 1.06) 대비 약 1.5배
  root.scale.setScalar(s);
  root.position.set(sp.x, 0, sp.z);
  scene.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const acts = {};
  for (const n of ENEMY_CLIPS) { const c = clipOf(enemyGltf, n); if (c) acts[n] = mixer.clipAction(c); }
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
    en.dormant = true;
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
      let mvx = toP.x, mvz = toP.z;
      // 시야가 트였으면 곧장 플레이어에게 (경로 필드는 4방향이라 열린 방에서 축 방향으로만 움직인다)
      en.losT = (en.losT || 0) - dt;
      if (en.losT <= 0) { en.los = losClear(p.x, p.z, player.pos.x, player.pos.z); en.losT = 0.2; }
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
      p.x += mvx * en.speed * dt; p.z += mvz * en.speed * dt;
      collideCircle(p, 0.6, 2.4 * en.scale, 0, 0.32);   // 벽 통과 반경은 작게 — 폭 2m 복도도 통행
      for (const o of enemies) {
        if (o === en || o.state === 'dead') continue;
        const dx = p.x - o.root.position.x, dz = p.z - o.root.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.001 && d < 0.9) { p.x += dx / d * (0.9 - d) * 0.3; p.z += dz / d * (0.9 - d) * 0.3; }
      }
      enPlay(en, en.moveClip);
    } else if (en.atkCd <= 0) {
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
      if (!en.dealt && en.t > clipDur * 0.4) { en.dealt = true; fireProjectile(en); }
    } else if (!en.dealt && en.t > clipDur * (jumper ? 0.5 : 0.38) && dist < (jumper ? 3.0 : 2.6) * en.scale) {
      en.dealt = true; damagePlayer(en.dmg, p.x, p.z);
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
      if (!player.dead && d2 < 10 && player.pos.y < 0.5) damagePlayer(en.dmg, en.aoeTarget.x, en.aoeTarget.z);
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
let slot = 'gun';                        // 'gun' | 'grenade' | 'mine'
function selectSlot(name) {
  if (name === 'grenade' && grenades <= 0) { toast('수류탄이 없습니다'); return; }
  if (name === 'mine' && mines <= 0) { toast('지뢰가 없습니다'); return; }
  slot = name;
  gMode = (name === 'grenade');
  trajLine.visible = gMode;
  aimCircle.visible = gMode;
  if (name !== 'grenade' && gWindup) releaseGrenadeWindup();
  updateGSlot(); updateMineSlot();
}
function toggleGMode() { selectSlot(gMode ? 'gun' : 'grenade'); }
function hideWeapon(sec) {
  for (const m of weaponMeshes) m.visible = false;
  clearTimeout(hideWeapon._t);
  hideWeapon._t = setTimeout(() => weaponMeshes.forEach(m => m.visible = true), sec * 1000);
}
const pendingThrows = []; // 릴리즈 예약 — 마우스 업 0.5초 뒤 실제 발사
// 홀드 투척: 다운 → toss grenade 1.5초까지 재생 후 정지 유지, 업 → 나머지 재생 + 0.5초 뒤 투척
const WIND_HOLD_T = 1.5;
let gWindup = false;
function startGrenadeWindup() {
  if (grenades <= 0 || player.dead || gWindup || pendingThrows.length) return;
  gWindup = true;
  const a = player.actions['toss grenade'];
  if (a) {
    a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.paused = false;
    a.timeScale = 4;                    // 대기 자세까지 4배 빠르게 (약 0.37초)
    play('toss grenade', 0.08);
    player.oneShot = 'toss grenade';
  }
  clearTimeout(hideWeapon._t);
  for (const m of weaponMeshes) m.visible = false; // 던지는 동안 총 숨김 (릴리즈 후 복원)
}
function releaseGrenadeWindup() {
  if (!gWindup) return;
  gWindup = false;
  const a = player.actions['toss grenade'];
  if (a) a.timeScale = 1;
  // 준비자세 도달 전 릴리즈 → 투척 취소 (수류탄 미소모, 총 복원)
  if (a && a.time < WIND_HOLD_T - 0.02) {
    a.stop();
    player.oneShot = null;
    player.current = null;
    play('rifle aiming idle', 0.12);
    clearTimeout(hideWeapon._t);
    for (const m of weaponMeshes) m.visible = true;
    return;
  }
  if (a) a.paused = false; // 나머지 모션 재생
  grenades--;
  // 수류탄 모드는 F를 다시 누를 때까지 유지 (남은 수류탄이 없으면 총으로 복귀)
  if (grenades <= 0) { gMode = false; slot = 'gun'; trajLine.visible = false; aimCircle.visible = false; }
  updateGSlot();
  persistProgress();
  pendingThrows.push({ t: 0.5 });
  hideWeapon(1.3);
  setTimeout(() => { if (player.oneShot === 'toss grenade') player.oneShot = null; }, 1300);
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
      sfxTone(70, 0.5, 'sawtooth', 0.35, -30);
      for (const en of enemies) {
        if (en.state === 'dead') continue;
        const d = Math.hypot(en.root.position.x - bp.x, en.root.position.z - bp.z);
        if (d < 5.5) {
          damageEnemy(en, 250);
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

// ---------- 미니맵 안개: 가본 방·복도만 드러난다 ----------
const rectsTouch = (a, b) => a.x0 - 1 < b.x1 && b.x0 - 1 < a.x1 && a.z0 - 1 < b.z1 && b.z0 - 1 < a.z1;
function updateSeenRects() {
  if (!walkGrid) return;
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
    const lamp = new THREE.PointLight(0xff4a33, 2.4, 8);
    lamp.position.z = 0.6;
    grp.add(lamp);
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
const PAD_R = 2.4, PAD_H = 5, PAD_FLOOR = 3, PAD_COUNT = 2;
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
  const lamp = new THREE.PointLight(0x6fd8ff, 2.2, 9);
  lamp.position.y = 1.2;
  grp.add(lamp);
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
    const glow = new THREE.PointLight(0xffc04a, 1.4, 5);
    glow.position.y = 1.0;
    grp.add(glow);
    woodCrates.push({ grp, x: cx, z: cz, hp: 60, t: 0 });
  }
  return woodCrates.length;
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
  if (Math.random() < 0.10) {
    const locked = FURN_LOOT.filter(k => !furnUnlocked(k));
    const pick = locked.length ? locked[(Math.random() * locked.length) | 0] : FURN_LOOT[(Math.random() * FURN_LOOT.length) | 0];
    if (grantFurniture(pick)) {
      banner('🪑 가구 획득 — ' + FURN[pick].name);
      toast('🪑 ' + FURN[pick].name + ' — 쇼룸에서 배치할 수 있습니다');
    } else { dropCoins(c.x, c.z); toast('🪙 이미 가진 가구 — 코인으로 전환'); }
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
    player.vy = Math.sqrt(2 * 13.5 * PAD_H);   // 5m 도약
    player.onGround = false;
    if (camMode !== 'fps') oneShot('rifle jump', 0.9);
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
  document.getElementById('kCnt').textContent = markers.length;
  el.classList.toggle('empty', markers.length === 0);
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
  const lamp = new THREE.PointLight(0xffd54a, 3, 12);
  lamp.position.y = 1.6;
  grp.add(lamp);
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
    document.getElementById('coinN').textContent = coins;
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
  liveMines.push({ grp, ring, t: 0, armed: 0.7 });
  sfxTone(420, 0.08, 'square', 0.12);
  toast('🧨 지뢰 설치');
}
function explodeAt(pos, radius, dmg, color) {
  burst(pos, color, 26);
  flashLight.position.copy(pos); flashLight.intensity = 50; flashT = 0.1;
  shake(0.25, 0.35);
  sfxTone(80, 0.45, 'sawtooth', 0.3, -30);
  for (const en of enemies) {
    if (en.state === 'dead') continue;
    const d = Math.hypot(en.root.position.x - pos.x, en.root.position.z - pos.z);
    if (d >= radius) continue;
    damageEnemy(en, dmg); en.hitFlash = 0.2; en.hpBarT = 4;
    if (en.hpBar) {
      const r = Math.max(0, en.hp / en.maxhp);
      en.hpBar.fill.scale.x = Math.max(0.001, r);
      en.hpBar.fill.position.x = -(1 - r) * 0.55;
    }
    if (en.hp <= 0) killEnemy(en);
  }
}
function updateMines(dt) {
  for (let i = liveMines.length - 1; i >= 0; i--) {
    const m = liveMines[i];
    m.t += dt; m.armed -= dt;
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
      explodeAt(p, MINE_R, MINE_DMG, 0xff7733);
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
  const spd = Math.min(2, 1 + 0.2 * ((walkGrid ? floorNo : wave) - 1));
  const vel = dir.divideScalar(1.0 / spd);
  const m = new THREE.Mesh(projGeo, new THREE.MeshBasicMaterial({ color: 0x5affd0, transparent: true, opacity: 0.95 }));
  m.position.copy(origin);
  scene.add(m);
  projectiles.push({ m, vel, life: 1.15 / spd + 0.15, dmg: en.dmg });
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
    if (hit) damagePlayer(pr.dmg, pr.m.position.x, pr.m.position.z);
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
function damageEnemy(en, dmg) {          // 추격자는 무적 — 누적 피해 1000마다 스턴
  if (en.dormant) wakeEnemy(en);         // 맞으면 깨어난다
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
  return en.hp <= 0;
}
function killEnemy(en, scoreMult = 1) {
  if (en.invuln) return;
  en.state = 'dead'; en.t = 0;
  if (en.hpBar) en.hpBar.grp.visible = false;
  clearAoe(en);
  en.kbX = en.kbZ = 0;
  enPlay(en, 'mutant dying', 0.1, true);
  sfxDie();
  kills++;
  if (walkGrid) floorTime = Math.min(FLOOR_TIME * 2, floorTime + 2);   // 처치마다 +2초
  lastKillClock = gameTime;                                            // 소강 상태 감지용
  // 7초 내 연속킬 → 콤보. 점수는 콤보 배율 적용 (100 × 웨이브 × 콤보)
  combo = (gameTime - lastKillT <= 7) ? combo + 1 : 1;
  lastKillT = gameTime;
  score += 100 * wave * combo * scoreMult; // 헤드샷 킬 = 2배
  // 0.7초 안에 겹쳐 죽이면 멀티킬 — 복도에 몰아넣고 터뜨리는 플레이 보상
  multiN = (gameTime - multiT <= 0.7) ? multiN + 1 : 1;
  multiT = gameTime;
  if (multiN >= 2) {
    const label = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'QUAD KILL' }[multiN] || ('MULTI KILL x' + multiN);
    const bonus = 50 * multiN;
    coins += bonus;
    document.getElementById('coinN').textContent = coins;
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
  document.getElementById('scoreN').textContent = score;
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
    document.getElementById('coinN').textContent = coins;
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
  if (!walkGrid && aliveCount() === 0) setTimeout(nextWave, 1600);   // 웨이브는 광장 전용
}
const aliveCount = () => enemies.filter(e => e.state !== 'dead' && !e.invuln).length;
function updateHudWave() { document.getElementById('left').textContent = aliveCount(); }

// 다음 층으로 — 맵을 새로 그리고 A 지점에서 다시 시작
function nextFloor() {
  floorNo++;
  floorTime = FLOOR_TIME;
  hunter = null;
  clearSpawnTimers();
  for (const en of enemies) { scene.remove(en.root); clearAoe(en); }
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
  document.getElementById('coinN').textContent = coins;
  flashChip('coinN'); persistProgress();
  banner('FLOOR ' + floorNo);
  toast('🌀 다음 층 — +200🪙');
  sfxChest();
  startFloor();
}
const ROOM_DENSITY = 100;                // 1마리 / 10m×10m
const ROOM_CAP = 8, FLOOR_CAP = 44;      // 방당·층당 초기 배치 상한 (성능)
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
  document.getElementById('floorN').textContent = floorNo;
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
let spawnCd = 3, lastKillClock = 0, bossOfFloor = null, cores = 0;
function floorEnemyKind() {              // 층에 따라 개체 해금: 러너 1층~, 점퍼 3층~, 원거리 4층~
    const pool = ['walker', 'walker', 'runner'];
  if (floorNo >= 3) pool.push('jumper');
  if (floorNo >= 4) pool.push('ranged');
  return pool[(Math.random() * pool.length) | 0];
}
function roomSpawnTick(dt) {
  if (!walkGrid || player.dead) return;
  const alive = aliveCount();
  const cap = Math.min(FLOOR_CAP + 6, 22 + floorNo * 2);
  spawnCd -= dt;
  if (spawnCd <= 0) {                    // 방마다 쿨타임으로 계속 유입
    spawnCd = Math.max(1.6, 5 - floorNo * 0.2);
    if (alive < cap) {
      const k = 1 + (Math.random() < 0.35 ? 1 : 0);
      for (let i = 0; i < k; i++) spawnEnemy(floorNo, floorEnemyKind());
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
  document.getElementById('waveN').textContent = wave;
  const runners = Math.max(0, wave - 2) + (wave >= 3 ? 3 : 0); // 웨이브3부터 1마리+추가분 3마리 전부 러너, 이후 +1
  const jumpers = wave >= 6 ? Math.min(3, wave - 5) : 0;      // 웨이브6부터 1마리, 이후 +1 (최대 3)
  const rangers = wave >= 9 ? Math.min(3, wave - 8) : 0;      // 웨이브9부터 1마리, 이후 +1 (최대 3)
  const bosses = wave % 10 === 0 ? 1 : 0;                     // 10웨이브마다 보스
  banner('WAVE ' + wave + (bosses ? ' — ⚠ BOSS 출현 ⚠' : rangers ? ' — 원거리 개체 출현!' : jumpers ? ' — 도약 개체 출현!' : runners ? ' — 러너 출현!' : ''));
  if (walkGrid && wave % 3 === 0 && wave % 10 !== 0) setTimeout(() => { if (!player.dead) spawnBeacon(); }, 1200);
  else clearBeacon();
  const count = (2 + wave) * 2 + 3 + bosses; // 일반 개체 2배 + 3마리 (보스는 별도 1마리 유지)
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
let camMode = localStorage.getItem('fps.view') || 'shoulder';  // 기본: 3인칭 숄더뷰
if (camMode === 'tps') camMode = 'shoulder';                    // 구버전 저장값 호환
let ctrlMode = localStorage.getItem('fps.ctrl') || 'pc';       // 'pc' | 'mobile'
let moveMode = localStorage.getItem('fps.move') || 'pad';      // 'pad' 고정 조그 | 'dash' 재터치 대쉬
let fireMode = localStorage.getItem('fps.fire') || 'btn';      // 'btn' 버튼 | 'jog' 눌러서 발사+시점
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
document.getElementById('gSlot').addEventListener('pointerdown', e => { e.stopPropagation(); selectSlot(slot === 'grenade' ? 'gun' : 'grenade'); });
document.getElementById('mSlot').addEventListener('pointerdown', e => { e.stopPropagation(); selectSlot(slot === 'mine' ? 'gun' : 'mine'); });
document.getElementById('kSlot').addEventListener('pointerdown', e => { e.stopPropagation(); audioInit(); placeMarker(); });

// 디버그 버튼 — 로컬(localhost/127.*)에서만 노출
const IS_LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname) || location.hostname.endsWith('.local');
if (!IS_LOCAL) {
  document.getElementById('dbgWrap').style.display = 'none';
  document.getElementById('startShowroom').style.display = 'none';   // 쇼룸은 디버그 전용
}
document.getElementById('dbgCoins').addEventListener('click', e => {
  e.stopPropagation();
  coins += 1000000;
  document.getElementById('coinN').textContent = coins;
  flashChip('coinN');
  renderUpg();
  persistProgress();
});
document.getElementById('dbgWave').addEventListener('click', e => {
  e.stopPropagation();
  if (walkGrid) { warping = true; floorTransition(); setTimeout(() => warping = false, 900); }  // 랜덤맵: 다음 층
  else skipWave();
});
let dbgPortal = false, dbgGod = false, dbgFast = false;
const dbgTog = (id, get, set) => document.getElementById(id).addEventListener('click', e => {
  e.stopPropagation();
  set(!get());
  document.getElementById(id).classList.toggle('on', get());
});
dbgTog('dbgPortal', () => dbgPortal, v => { dbgPortal = v; toast(v ? '포탈 표시 ON' : '포탈 표시 OFF'); });
dbgTog('dbgGod', () => dbgGod, v => { dbgGod = v; toast(v ? '무적 ON' : '무적 OFF'); });
dbgTog('dbgFast', () => dbgFast, v => { dbgFast = v; toast(v ? '이동 3배속 ON' : '이동 3배속 OFF'); });

const shopMenu = document.getElementById('shopMenu');
// 시작 화면 패널: 화면 중앙에서 100px 아래 배치 (넘치면 스크롤)
function placeStartPanel(el) {
  el.style.left = '50%';
  el.style.top = 'calc(50% + 100px)';
  el.style.bottom = 'auto';
  el.style.transform = 'translate(-50%,-50%)';
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
optMenu.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => {
  moveMode = b.dataset.move; localStorage.setItem('fps.move', moveMode); syncOptUI(); applyCtrl();
}));
optMenu.querySelectorAll('[data-fire]').forEach(b => b.addEventListener('click', () => {
  fireMode = b.dataset.fire; localStorage.setItem('fps.fire', fireMode); syncOptUI(); applyCtrl();
}));
optMenu.querySelectorAll('[data-map]').forEach(b => b.addEventListener('click', () => {
  if (mapMode === b.dataset.map) return;
  mapMode = b.dataset.map; localStorage.setItem('fps.map', mapMode); syncOptUI(); applyMap();
}));
// 맵 교체: 지형을 다시 만들고 진행 중인 개체·아이템을 정리한 뒤 1웨이브부터
function applyMap() {
  buildMap();
  clearSpawnTimers();
  for (const en of enemies) { scene.remove(en.root); clearAoe(en); }
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
  floorNo = 1; floorTime = FLOOR_TIME; hunter = null;
  spawnCd = 3; lastKillClock = 0; bossOfFloor = null; warping = false; floorShopOpen = false;
  wave = 0;
  updateHudWave();
  if (walkGrid) startFloor(); else nextWave();
  syncOptUI();
}
function syncOptUI() {
  const dw = document.getElementById('dbgWave');
  if (dw) dw.textContent = mapMode === 'random' ? '층 넘기기' : '웨이브 스킵';
  optMenu.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === camMode));
  optMenu.querySelectorAll('[data-ctrl]').forEach(b => b.classList.toggle('on', b.dataset.ctrl === ctrlMode));
  optMenu.querySelectorAll('[data-map]').forEach(b => b.classList.toggle('on', b.dataset.map === mapMode));
  optMenu.querySelectorAll('[data-move]').forEach(b => b.classList.toggle('on', b.dataset.move === moveMode));
  optMenu.querySelectorAll('[data-fire]').forEach(b => b.classList.toggle('on', b.dataset.fire === fireMode));
}
function applyView() {
  // 1인칭이 아니면 숨겼던 머리·머리카락 본 복원 (1인칭은 프레임마다 hideBones 재적용)
  if (camMode !== 'fps') for (const b of hiddenBones) b.scale.setScalar(1);
}
function applyCtrl() {
  document.body.classList.toggle('mobile', isMobileCtrl());
  document.body.classList.toggle('moveDash', moveMode === 'dash');
  document.body.classList.toggle('fireJog', fireMode === 'jog');
  if (moveMode !== 'dash') joyHome();      // 고정 조그로 되돌린다
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
  startEl.style.display = (menu && !inRun) ? 'block' : 'none';
  const p = document.getElementById('pauseOv');
  const pauseUI = menu && inRun;
  if (p) p.style.display = pauseUI ? 'block' : 'none';
  // 일시정지 화면: 되돌아가기 버튼 100px 아래에 상점 패널 상시 표시
  const sm = document.getElementById('shopMenu');
  const allowShop = !walkGrid || floorShopOpen;   // 랜덤맵은 층 이동 시에만 상점
  if (pauseUI && sm && allowShop) {
    renderUpg();
    const rb = document.getElementById('btnResume').getBoundingClientRect();
    sm.style.display = 'block';
    sm.style.left = '50%';
    sm.style.top = (rb.bottom + 100) + 'px';
    sm.style.bottom = 'auto';
    sm.style.transform = 'translateX(-50%)';
    sm.style.maxHeight = Math.max(160, innerHeight - rb.bottom - 120) + 'px';
    sm.style.overflowY = 'auto';
  } else if (inRun && sm) {
    sm.style.display = 'none'; // 일시정지 해제·랜덤맵 일반 정지에서는 닫기
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
  if (isMobileCtrl()) started = true;
  else {
    const pr = canvas.requestPointerLock();
    if (pr && pr.catch) pr.catch(() => { }); // 잠금 실패해도 게임은 시작 — 클릭 시 재시도
  }
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
    title: '🎲 랜덤 맵',
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
  if (optMenu.style.display === 'block') { shopMenu.style.display = 'none'; rankMenu.style.display = 'none'; }
});
canvas.addEventListener('click', () => { if (!locked && !isMobileCtrl() && !player.dead) canvas.requestPointerLock(); }); // 사망 화면에선 커서 유지
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
const DASH_WINDOW = 0.5;                 // 손을 뗀 자리에 조그가 머무는 시간(초)
let joyArmT = 0, joyArmDir = null, joyArmTimer = null;
function joyHome() {                     // 조그를 원래 자리(좌하단 고정)로
  joy.style.left = ''; joy.style.top = ''; joy.style.bottom = '';
  joy.classList.remove('armed');
  joyArmT = 0; joyArmDir = null;
  if (joyArmTimer) { clearTimeout(joyArmTimer); joyArmTimer = null; }
}
function joyMoveTo(cx, cy) {             // 조그 중심을 화면 좌표로 옮긴다
  const r = joy.getBoundingClientRect();
  joy.style.left = (cx - r.width / 2) + 'px';
  joy.style.top = (cy - r.height / 2) + 'px';
  joy.style.bottom = 'auto';
}
function joyStart(e) {
  joyId = e.pointerId;
  try { joy.setPointerCapture(joyId); } catch { }
  const r = joy.getBoundingClientRect();
  joyCenter = [r.x + r.width / 2, r.y + r.height / 2];
  joyUpdate(e);
}
joy.addEventListener('pointerdown', e => {
  const armed = joyArmT > 0 && gameTime - joyArmT < DASH_WINDOW && joyArmDir;
  if (armed) {                           // 머문 조그를 다시 누르면 그 방향으로 대쉬
    touchMove.x = joyArmDir.x; touchMove.z = joyArmDir.z;
    dashPending = true;                  // 이번 프레임 입력 방향이 정해지면 대쉬
  }
  joy.classList.remove('armed');
  joyArmT = 0; joyArmDir = null;
  joyStart(e);
});
joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyUpdate(e); });
const joyEnd = e => {
  if (e.pointerId !== joyId) return;
  joyId = null;
  const moving = Math.abs(touchMove.x) + Math.abs(touchMove.z) > 0.2;
  if (moveMode === 'dash' && moving) {    // 뗀 자리에 0.5초간 머문다
    joyMoveTo(e.clientX, e.clientY);
    const m = Math.hypot(touchMove.x, touchMove.z) || 1;
    joyArmDir = { x: touchMove.x / m, z: touchMove.z / m };
    joyArmT = gameTime;
    joy.classList.add('armed');
    if (joyArmTimer) clearTimeout(joyArmTimer);
    joyArmTimer = setTimeout(joyHome, DASH_WINDOW * 1000);
  }
  touchMove.x = touchMove.z = 0;
  joyStick.style.transform = '';
};
joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
// 재터치 대쉬 모드: 좌측 아무 곳이나 눌러도 그 자리에서 조그가 시작된다 (대쉬는 하지 않음)
document.getElementById('joyZone').addEventListener('pointerdown', e => {
  if (moveMode !== 'dash' || !isMobileCtrl() || !started || player.dead) return;
  e.preventDefault();
  joyHome();
  joyMoveTo(e.clientX, e.clientY);
  joyStart(e);
  joy.setPointerCapture?.(e.pointerId);
});
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
mb('mbFire').addEventListener('pointerdown', e => {
  if (fireMode !== 'jog') return;
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
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR' && !reloading && ammo < magSize()) reload();
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) dash();
  if (!e.repeat) {                       // 1 총 · 2 수류탄 · 3 지뢰
    if (e.code === 'Digit1' || e.code === 'Numpad1') selectSlot('gun');
    if (e.code === 'Digit2' || e.code === 'Numpad2') selectSlot('grenade');
    if (e.code === 'Digit3' || e.code === 'Numpad3') selectSlot('mine');
    if (e.code === 'KeyF') placeMarker();          // 조준점에 길찾기 마커
  }
  // ESC 토글: 일시정지 ↔ 재개 (잠금 중 ESC는 브라우저가 소비 → pointerlockchange 경로로 일시정지됨)
  if (e.code === 'Escape' && !e.repeat && inRun && !player.dead) {
    if (paused) {
      if (!escArmed) return;       // 잠금 해제를 유발한 그 누름의 잔여 keydown만 무시
      paused = false;              // 즉시 게임 재개 — 조준 잠금은 시도만, 실패 시 클릭으로 복구
      if (isMobileCtrl()) started = true;
      else {
        const pr = canvas.requestPointerLock();
        if (pr && pr.catch) pr.catch(() => { });
      }
      shopMenu.style.display = 'none';
      refreshOverlay();
    } else if (!locked) {          // 잠금 없이 플레이 중 ESC → 일시정지
      paused = true;
      refreshOverlay();
    }
  }
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') e.preventDefault();
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
  if (e.button === 2) player.zooming = true;
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) {
    if (locked && gMode) releaseGrenadeWindup(); // 업: 나머지 모션 + 0.5초 뒤 투척
    firing = false;
  }
  if (e.button === 2) player.zooming = false;
});
document.addEventListener('contextmenu', e => e.preventDefault());

const sfxDash = () => sfxTone(500, 0.18, 'sawtooth', 0.12, 700);
let dashPending = false;                 // 조그 재터치 대쉬 — 방향 계산 후 발동
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
  shotsFired++;
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
      if (t !== null && t < bestT) { bestT = t; hitEn = en; headshot = hd; }
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
  if (hitEn && bestT < wallT) {
    // 머리 명중 세분화: 외곽 = 크리티컬(34), 중심(정밀) = 헤드샷 원샷킬
    let hitKind = headshot ? 'crit' : 'body';
    if (headshot && hitEn.kind !== 'boss') { // 보스는 헤드샷 없음(크리티컬까지만)
      const hc = enemyHeadPos(hitEn).sub(origin);
      const ht = hc.dot(dir);
      const hdd = hc.lengthSq() - ht * ht;
      if (hdd < (0.075 * hitEn.scale) ** 2) hitKind = 'hs'; // 정밀 헤드샷 반경 50% 추가 축소
    }
    shotsHit++;
    const hitPos = origin.clone().addScaledVector(dir, bestT);
    addTracer(muzzle, hitPos);
    burst(hitPos, headshot ? 0xffcc44 : 0xbb2233, hitKind === 'hs' ? 20 : headshot ? 14 : 9);
    if (hitKind === 'hs' && !hitEn.invuln) { hitEn.hp = 0; headshots++; } // 헤드샷 = 원샷킬
    else damageEnemy(hitEn, Math.round((hitKind === 'crit' ? 34 : 13) * dmgMul()));
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
    headshot ? sfxHead() : sfxHit();
    if (hitEn.hp <= 0) killEnemy(hitEn, hitKind === 'hs' ? 2 : 1);
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
function hitmark(head) {
  const h = document.getElementById('hitmark');
  h.classList.toggle('head', head);
  h.style.opacity = 1; h.style.transition = 'none';
  requestAnimationFrame(() => { h.style.transition = 'opacity .3s'; h.style.opacity = 0; });
}

// ---------- player damage ----------
function damagePlayer(n, fromX, fromZ) {
  if (player.dead || dbgGod) return;     // 디버그 무적
  if (fromX !== undefined) showHitArrow(fromX, fromZ);
  player.hp -= n;
  sfxHurt();
  const f = document.getElementById('dmgflash');
  f.style.opacity = 1; setTimeout(() => f.style.opacity = 0, 180);
  updateHpHud();
  if (player.hp <= 0) {
    player.dead = true;
    firing = false; gMode = false; trajLine.visible = false; aimCircle.visible = false;
    shopMenu.style.display = 'none'; // 일시정지 상점이 열려 있었다면 닫기
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
  player.dead = false; player.pos.copy(playerStart); player.vy = 0;
  player.oneShot = null;
  // 사망 포즈(clampWhenFinished) 잔존 방지 — 전체 액션 정지 후 idle 새로 시작
  if (player.mixer) player.mixer.stopAllAction();
  if (player.actions['rifle aiming idle']) { player.current = null; play('rifle aiming idle', 0.1); }
  player.zooming = false; player.eyeH = EYE_STAND;
  player.dashT = 0; player.dashCd = 0;
  floorNo = 1; floorTime = FLOOR_TIME; hunter = null;
  score = 0; kills = 0; wave = 0; reloading = false; buffT = 0;
  // 코인·업그레이드·수류탄은 게임오버 후에도 유지
  ammo = magSize();
  clearSpawnTimers();
  renderUpg();
  combo = 0; lastKillT = -99; headshots = 0; shotsFired = 0; shotsHit = 0;
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
  for (const m of liveMines) scene.remove(m.grp);
  liveMines.length = 0;
  clearBeacon();
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
  if (toMenu) { started = false; inRun = false; paused = false; document.getElementById('mapPick').style.display = 'none'; document.getElementById('brief').style.display = 'none'; refreshOverlay(); } // 확인 → 메인 화면
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
  if (mobile) player.zooming = zoomTog;
  const sp = 7.2 * (dbgFast ? 3 : 1); // 기본 이동 = 달리기 (디버그 3배속)
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
  if (dashPending) { dashPending = false; dash(); }   // 조그 재터치 — 방향이 정해진 뒤 발동
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
  // 홀드 투척: 1.5초 지점에서 모션 정지 유지 (마우스 업까지)
  if (gWindup) {
    const a = player.actions['toss grenade'];
    if (a && a.time >= WIND_HOLD_T) { a.time = WIND_HOLD_T; a.paused = true; }
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
    if (walkGrid) {                     // 벽에 막히면 카메라를 앞으로 당긴다
      for (let t = 0.4; t <= camDist; t += 0.2) {
        if (base.y - look.y * t < WALL_H && cellSolid(base.x - look.x * t, base.z - look.z * t)) { camDist = Math.max(0.5, t - 0.3); break; }
      }
    }
    const camPos = base.clone().addScaledVector(look, -camDist);
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
  updateSeenRects();
  updateMarkers(dt);
  updateJumpPads(dt);
  updateDoors(dt);
  updateFloor(dt);
  roomSpawnTick(dt);
  updateHitArrows(dt);
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
    updateMines(dt);
    updateBeacon(dt);
    updateDecals(dt);
    updateJumpPads(dt);
    updateDoors(dt);
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
  if (srOn) { srUpdate(dt); return; }
  renderer.render(scene, camera);
}

// ---------- 쇼룸: 배경 공간(방) 꾸미기 — 방 슬롯 · 확장 · 창밖 풍경 · 10cm 그리드 가구 ----------
const ROOM_H = 3, SLOT_COST = 500000;       // 방 추가 구매
const ROOM_MIN = 4, ROOM_MAX = 10, ROOM_STEP = 2, EXPAND_COST = 100000;   // 4×4 지급 · 2m씩 확장(줄이기 불가)
const GRID = 0.1, SNAP = 0.15;           // 10cm 격자 · 15cm 안이면 벽·가구에 붙는다
const FURN = {
  // mount: 설치면 · place: 내가 놓일 수 있는 자리 · provides: 남에게 내주는 면 · rotate: 회전 규칙
  crate: {
    name: '상자', icon: '📦', w: 0.6, d: 0.6, h: 0.6, color: 0x8a6a45,
    mount: 'floor', place: ['floor', 'top', 'under'], provides: { top: 0.6 }, rotate: 'free', blocking: true,
  },
  table: {
    name: '책상', icon: '🪑', w: 1.2, d: 0.7, h: 0.75, color: 0x6b4a34, top: true,
    mount: 'floor', place: ['floor'], provides: { top: 0.78, under: 0.62 }, rotate: 'free', blocking: true,
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
    name: '램프', icon: '💡', w: 0.3, d: 0.3, h: 1.6, color: 0xd8c48a, round: true, glow: true,
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
    name: '모니터', icon: '🖥', w: 0.55, d: 0.18, h: 0.42, color: 0x1d222b, glow: true,
    mount: 'floor', place: ['top'], provides: null, rotate: 'free', blocking: false,
  },
  keyboard: {
    name: '키보드', icon: '⌨', w: 0.42, d: 0.15, h: 0.03, color: 0x2a3038,
    mount: 'floor', place: ['top'], provides: null, rotate: 'free', blocking: false,
  },
  banner: {
    name: '배너', icon: '🎌', w: 0.9, d: 0.08, h: 1.8, color: 0x2b6f8f, glow: true,
    mount: 'wall', place: ['wall'], provides: null, rotate: 'wall', blocking: false, wallY: 1.9,
  },
  wallshelf: {
    name: '벽선반', icon: '📚', w: 0.9, d: 0.28, h: 0.08, color: 0x6b5a44,
    mount: 'wall', place: ['wall'], provides: { top: 0.08 }, rotate: 'wall', blocking: false, wallY: 1.3,
  },
  ceilLamp: {
    name: '천장등', icon: '🔆', w: 0.34, d: 0.34, h: 0.3, color: 0xf0e0b0, round: true, glow: true,
    mount: 'ceiling', place: ['ceiling'], provides: null, rotate: 'none', blocking: false,
  },
  fan: {
    name: '실링팬', icon: '🌀', w: 1.0, d: 1.0, h: 0.16, color: 0x8a8f98, round: true,
    mount: 'ceiling', place: ['ceiling'], provides: null, rotate: 'none', blocking: false,
  },
  door: {
    name: '문', icon: '🚪', w: 1.1, d: 0.16, h: 2.1, color: 0x6b5a44, wall: true,
    mount: 'opening', place: ['wall'], provides: null, rotate: 'wall', blocking: false,
  },
};
const FURN_COST = {                       // 코인으로 사는 기본 가구
  crate: 3000, table: 12000, shelf: 9000, plant: 4000, lamp: 6000, rug: 5000,
  locker: 15000, drawer: 8000, monitor: 20000, keyboard: 7000, banner: 6000, door: 30000,
};
const FURN_LOOT = ['wallshelf', 'ceilLamp', 'fan'];   // 게임 속 목재상자에서만 나오는 가구
const furnOwned = new Set(JSON.parse(localStorage.getItem('fps.furn') || '[]'));
function saveFurnOwned() { localStorage.setItem('fps.furn', JSON.stringify([...furnOwned])); }
function furnUnlocked(k) { return furnOwned.has(k); }
function grantFurniture(k) {              // 상자에서 획득
  if (furnUnlocked(k)) return false;
  furnOwned.add(k); saveFurnOwned();
  return true;
}
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
const roomStore = { cur: 0, slots: [{ name: 'MY ROOM', w: ROOM_MIN, d: ROOM_MIN, bg: 'forest', items: [] }] };
const roomW = r => r.w ?? r.size ?? ROOM_MIN, roomD = r => r.d ?? r.size ?? ROOM_MIN;
const curRoom = () => roomStore.slots[roomStore.cur] ?? roomStore.slots[0];
let srRoomGrp = null, srFurnGrp = null, srGridHelp = null, srBackdrop = null, srBgLight = null;
let placeType = null, placeRot = 0, placeGhost = null, srPickSel = null, srOutline = null;
function roomLoad() {
  try {
    const j = JSON.parse(localStorage.getItem('fps.rooms') || 'null');
    if (j && Array.isArray(j.slots) && j.slots.length) {
      roomStore.cur = Math.min(j.cur | 0, j.slots.length - 1);
      roomStore.slots = j.slots.map(sl => ({
        name: sl.name || 'MY ROOM',
        w: Math.max(ROOM_MIN, Math.min(ROOM_MAX, sl.w ?? sl.size ?? ROOM_MIN)),
        d: Math.max(ROOM_MIN, Math.min(ROOM_MAX, sl.d ?? sl.size ?? ROOM_MIN)),
        bg: sl.bg || 'forest',
        items: Array.isArray(sl.items) ? sl.items.filter(it => FURN[it.type]) : [],
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
function roomSave() { localStorage.setItem('fps.rooms', JSON.stringify(roomStore)); }
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
function furnMesh(type) {
  const f = FURN[type];
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: f.color, roughness: f.glow ? 0.4 : 0.8, metalness: 0.15,
    emissive: f.glow ? f.color : 0x000000, emissiveIntensity: f.glow ? 0.5 : 0,
  });
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
  if (f.glow) {
    const lamp = new THREE.PointLight(f.color, 1.6, 4);
    lamp.position.y = f.h * 0.9;
    grp.add(lamp);
  }
  grp.userData.type = type;
  return grp;
}
function syncOutline() {                 // 선택한 가구에 외곽선
  if (srOutline) { srScene.remove(srOutline); srOutline = null; }
  if (!srPickSel || !srFurnGrp) return;
  const m = srFurnGrp.children.find(o => o.userData.item === srPickSel);
  if (!m) return;
  srOutline = new THREE.BoxHelper(m, 0xffd76b);
  srOutline.material.depthTest = false;
  srOutline.material.transparent = true;
  srScene.add(srOutline);
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
function snapPos(type, rot, wx, wz, host = null) {   // 월드 좌표 → 방 로컬 · 격자 · 마그넷 · 상판/하부
  const rm = roomAtPoint(wx, wz);
  const slot = rm ? rm.slot : roomStore.cur;
  const items = roomStore.slots[slot].items;
  const x = wx - (rm ? rm.cx : 0), z = wz - (rm ? rm.cz : 0);
  const rmS = roomStore.slots[slot], W = roomW(rmS), D = roomD(rmS), S = W;
  const f = FURN[type], fp = footprint(type, rot);
  const FRONT = 1.0;                     // 카메라 쪽(+z) 1m는 시야를 가리므로 비워 둔다
  const zMax = D / 2 - Math.max(FRONT, fp.d / 2);
  if (host && f.place.includes('top')) { // 상판을 직접 맞혔다면 그 위에
    const o = footprint(host.type, host.rot), top = itemTop(host);
    const cx = Math.max(host.x - o.w / 2 + fp.w / 2, Math.min(host.x + o.w / 2 - fp.w / 2, x));
    const cz = Math.max(host.z - o.d / 2 + fp.d / 2, Math.min(host.z + o.d / 2 - fp.d / 2, z));
    return { slot, x: +cx.toFixed(2), z: +cz.toFixed(2), y: +top.toFixed(2), on: host };
  }
  if (f.mount === 'opening' || f.mount === 'wall') {   // 문·벽걸이: 가까운 벽에 붙는다
    const toX = W / 2 - Math.abs(x), toZ = D / 2 - Math.abs(z);
    const onX = f.mount === 'opening' ? true : toX <= toZ;   // 문은 좌·우 벽에만
    const lim = (onX ? D : W) / 2 - (onX ? fp.d : fp.w) / 2 - 0.15;
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
    const top = itemTop(it);
    if (top !== null && f.place.includes('top') && fp.w <= o.w + 0.2 && fp.d <= o.d + 0.2) {
      const cx = Math.max(it.x - o.w / 2 + fp.w / 2, Math.min(it.x + o.w / 2 - fp.w / 2, px));
      const cz = Math.max(it.z - o.d / 2 + fp.d / 2, Math.min(it.z + o.d / 2 - fp.d / 2, pz));
      return { slot, x: +cx.toFixed(2), z: +cz.toFixed(2), y: +top.toFixed(2), on: it };
    }
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
      let o = h.object;
      while (o && !o.userData.item) o = o.parent;
      if (!o) continue;
      const it = o.userData.item, top = itemTop(it);
      const onTop = top !== null && Math.abs(h.point.y - top) < 0.16;
      return { p: h.point, host: onTop ? it : null };
    }
  }
  const t = raycaster.ray.origin.y / -raycaster.ray.direction.y;
  if (!(t > 0)) return null;
  return { p: raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, t), host: null };
}
function roomAtPoint(wx, wz) {           // 그 지점이 속한 방 (없으면 활성 방)
  for (const r of worldRooms) {
    const q = roomRect(r);
    if (wx >= q.x0 - 0.3 && wx <= q.x1 + 0.3 && wz >= q.z0 - 0.3 && wz <= q.z1 + 0.3) return r;
  }
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
function pickFurnCatalog(k) {             // 잠긴 가구는 사거나(코인) 상자에서 얻어야 한다
  if (furnUnlocked(k)) { startPlace(k); return; }
  if (FURN_LOOT.includes(k)) { toast('🎁 ' + FURN[k].name + ' — 게임 속 목재상자에서 획득'); return; }
  const cost = FURN_COST[k] ?? 0;
  if (coins < cost) { toast('코인이 부족합니다 (' + cost.toLocaleString() + '🪙)'); return; }
  coins -= cost;
  document.getElementById('coinN').textContent = coins;
  persistProgress();
  furnOwned.add(k); saveFurnOwned();
  toast('🛒 ' + FURN[k].name + ' 구매!');
  roomRenderUI();
  startPlace(k);
}
function startPlace(type) {
  placeType = type; placeRot = 0; setSel(null);
  if (placeGhost) srScene.remove(placeGhost);
  placeGhost = furnMesh(type);
  placeGhost.traverse(o => {
    if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; }
  });
  srScene.add(placeGhost);
  if (srGridHelp) srGridHelp.visible = true;
  toast('배치: 클릭 · 회전: R · 취소: ESC');
  roomRenderUI();
}
function cancelPlace() {
  placeType = null;
  if (placeGhost) { srScene.remove(placeGhost); placeGhost = null; }
  if (srGridHelp) srGridHelp.visible = false;
  roomRenderUI();
}
function commitPlace() {
  if (!placeType || !placeGhost) return;
  const q = placeGhost.userData.snap ?? snapPos(placeType, placeRot, placeGhost.position.x, placeGhost.position.z);
  const rot = q.wall ? q.rot : placeRot;
  const target = roomStore.slots[q.slot ?? roomStore.cur] ?? curRoom();
  if (overlaps(placeType, rot, q.x, q.z, q.y || 0, q.under ?? q.on ?? null, target.items)) { toast('다른 가구와 겹칩니다'); return; }
  target.items.push({ type: placeType, x: +q.x.toFixed(2), z: +q.z.toFixed(2), y: +(q.y || 0).toFixed(2), rot });
  roomSave(); buildFurnitureAll();
  sfxTone(700, 0.07, 'sine', 0.1);
  toast(FURN[placeType].name + (q.on ? ' — 위에 올림' : q.under ? ' — 아래에 넣음' : '') + ' 배치');
}
function pickFurniture(ev) {
  if (!srFurnGrp || !srCam) return null;
  srApplyCam();
  const r = renderer.domElement.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const nd = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(nd, srCam);
  const hit = raycaster.intersectObjects(srFurnGrp.children, true)[0];
  if (!hit) return null;
  let o = hit.object;
  while (o && !o.userData.item) o = o.parent;
  return o ? o.userData.item : null;
}
function setSel(it) { srPickSel = it; syncOutline(); roomRenderUI(); }
function removeSelected() {
  if (!srPickSel) { toast('제거할 가구를 먼저 고르세요'); return; }
  const arr = curRoom().items, i = arr.indexOf(srPickSel);
  if (i >= 0) arr.splice(i, 1);
  setSel(null);
  roomSave(); buildFurnitureAll(); hideCtx();
  toast('가구 제거');
}
function rotateCurrent() {
  if (placeType) { placeRot = (placeRot + 1) % ROT_N; return; }   // 30°씩
  if (srPickSel) {
    if (FURN[srPickSel.type].rotate !== 'free') { toast('이 가구는 설치면에 고정됩니다'); return; }
    srPickSel.rot = (srPickSel.rot + 1) % ROT_N;
    const p = snapPos(srPickSel.type, srPickSel.rot, srPickSel.x, srPickSel.z);
    srPickSel.x = p.x; srPickSel.z = p.z;
    roomSave(); buildFurnitureAll();
    return;
  }
  toast('회전할 가구를 고르세요');
}
function clearRoom() {
  if (!curRoom().items.length) { toast('이미 비어 있습니다'); return; }
  curRoom().items.length = 0;
  setSel(null); roomSave(); buildFurnitureAll();
  toast('🧹 방을 비웠습니다');
}
function expandRoom(axis) {               // 가로(w) 또는 세로(d)를 2m 늘린다 — 줄이기는 없음
  const room = curRoom();
  const cur = axis === 'w' ? roomW(room) : roomD(room);
  if (cur >= ROOM_MAX) { toast('이미 최대 ' + ROOM_MAX + 'm 입니다'); return; }
  if (coins < EXPAND_COST) { toast('코인이 부족합니다 (' + EXPAND_COST.toLocaleString() + '🪙)'); return; }
  coins -= EXPAND_COST;
  document.getElementById('coinN').textContent = coins;
  persistProgress();
  room[axis] = cur + ROOM_STEP;
  roomSave(); buildWorld(); roomRenderUI();
  toast('🏠 ' + roomW(room) + 'm × ' + roomD(room) + 'm 로 확장!');
}
function addRoomSlot() {
  if (coins < SLOT_COST) { toast('코인이 부족합니다 (' + SLOT_COST.toLocaleString() + '🪙)'); return; }
  coins -= SLOT_COST;
  document.getElementById('coinN').textContent = coins;
  persistProgress();
  roomStore.slots.push({ name: 'ROOM ' + (roomStore.slots.length + 1), w: ROOM_MIN, d: ROOM_MIN, bg: 'forest', items: [] });
  roomStore.cur = roomStore.slots.length - 1;
  roomSave(); buildWorld(); roomRenderUI();
  toast('🏠 새 방을 구매했습니다');
}
function loadRoomSlot(i) {
  if (!roomStore.slots[i] || i === roomStore.cur) { roomStore.cur = i; }
  roomStore.cur = i;
  setSel(null); cancelPlace();
  roomSave(); buildWorld(); roomRenderUI();
  toast('📂 ' + curRoom().name + ' 불러옴');
}
function setBg(key) {
  curRoom().bg = key;
  roomSave(); buildWorld(); roomRenderUI();
}
// ---- 커서 컨텍스트 메뉴 ----
function ctxLinkHtml() {                 // 문: 어떤 방과 이을지
  if (!srPickSel || srPickSel.type !== 'door') return '';
  return '<div class="ctxHead">연결할 방</div>' + roomStore.slots.map((sl, i) =>
    i === roomStore.cur ? '' : `<button data-link="${i}"${srPickSel.link === i ? ' class="on"' : ''}>🚪 ${sl.name}</button>`).join('')
    + (roomStore.slots.length < 2 ? '<div class="ctxHead">방이 하나뿐입니다</div>' : '');
}
function showCtx(x, y) {
  const el = document.getElementById('srCtx');
  if (!el || !srPickSel) return;
  const extra = el.querySelector('.ctxLinks');
  if (extra) extra.remove();
  if (srPickSel.type === 'door') {
    const wrap = document.createElement('div');
    wrap.className = 'ctxLinks';
    wrap.innerHTML = ctxLinkHtml();
    el.appendChild(wrap);
    for (const b of wrap.querySelectorAll('[data-link]')) {
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        srPickSel.link = +b.dataset.link;
        roomSave(); buildWorld(); hideCtx(); srRenderModeUI();
        toast('🚪 ' + roomStore.slots[srPickSel.link].name + ' 와 연결');
      });
    }
  }
  el.style.left = Math.min(x, innerWidth - 130) + 'px';
  el.style.top = Math.min(y, innerHeight - 100) + 'px';
  el.classList.add('on');
}
function hideCtx() { document.getElementById('srCtx')?.classList.remove('on'); }
function roomRenderUI() {
  const slots = document.getElementById('srSlots');
  if (!slots) return;
  slots.innerHTML = roomStore.slots.map((sl, i) =>
    `<button data-slot="${i}" class="${i === roomStore.cur ? 'on' : ''}">${sl.name}<i>${roomW(sl)}×${roomD(sl)}m</i></button>`).join('')
    + `<button data-newslot="1" class="buy">+ 새 방<i>${SLOT_COST.toLocaleString()}🪙</i></button>`;
  for (const b of slots.querySelectorAll('[data-slot]'))
    b.addEventListener('click', e => { e.stopPropagation(); loadRoomSlot(+b.dataset.slot); });
  slots.querySelector('[data-newslot]').addEventListener('click', e => { e.stopPropagation(); addRoomSlot(); });
  const sz = document.getElementById('srSizes');
  const rm = curRoom(), cw = roomW(rm), cd = roomD(rm);
  sz.innerHTML =
    `<div class="szNow">현재 ${cw}m × ${cd}m<span>최대 ${ROOM_MAX}m</span></div>`
    + `<button data-grow="w" class="buy"${cw >= ROOM_MAX ? ' disabled' : ''}>가로 +${ROOM_STEP}m<i>${EXPAND_COST.toLocaleString()}🪙</i></button>`
    + `<button data-grow="d" class="buy"${cd >= ROOM_MAX ? ' disabled' : ''}>세로 +${ROOM_STEP}m<i>${EXPAND_COST.toLocaleString()}🪙</i></button>`;
  for (const b of sz.querySelectorAll('[data-grow]'))
    b.addEventListener('click', e => { e.stopPropagation(); expandRoom(b.dataset.grow); });
  const bg = document.getElementById('srBg');
  if (bg) {
    bg.innerHTML = BG_LIST.map(b =>
      `<div class="srItem${curRoom().bg === b.key ? ' on' : ''}" data-bg="${b.key}">${b.icon}<span>${b.name}</span></div>`).join('');
    for (const b of bg.querySelectorAll('[data-bg]'))
      b.addEventListener('click', e => { e.stopPropagation(); setBg(b.dataset.bg); });
  }
  const nm = document.getElementById('srRoomName');
  if (nm && document.activeElement !== nm) nm.value = curRoom().name;
  const cat = document.getElementById('srFurn');
  if (cat) {
    cat.innerHTML = Object.entries(FURN).map(([k, f]) => {
      const own = furnUnlocked(k), loot = FURN_LOOT.includes(k);
      const tag = own ? '' : loot ? '<b class="loot">상자</b>' : `<b>${(FURN_COST[k] ?? 0).toLocaleString()}</b>`;
      return `<div class="srItem${placeType === k ? ' on' : ''}${own ? '' : ' locked'}" data-furn="${k}" title="${f.name}">${f.icon}<span>${f.name}</span>${tag}</div>`;
    }).join('');
    for (const b of cat.querySelectorAll('[data-furn]'))
      b.addEventListener('click', e => { e.stopPropagation(); pickFurnCatalog(b.dataset.furn); });
  }
  const del = document.getElementById('srDel');
  if (del) del.classList.toggle('on', !!srPickSel);
  const nameEl = document.getElementById('srName');
  if (nameEl) nameEl.textContent = curRoom().name;
}
function roomUpdate() {
  if (placeGhost && placeType) placeGhost.visible = true;
  if (srOutline) srOutline.update();
  if (srFurnGrp) {
    for (const m of srFurnGrp.children) m.position.y = m.userData.item === srPickSel ? 0.02 : 0;
  }
}

// ---------- 생활 모드: 문으로 이어진 두 방을 걸어서 오간다 ----------
let srMode = 'pose';                     // 'pose' 포즈모드 | 'live' 생활모드
const live = { x: 0, z: 0, yaw: 0, camYaw: 0, camPitch: 0.25, camDist: 4.2, active: 0, moving: false };
const CAM_YAW_LIM = 0, CAM_PITCH_MIN = 0, CAM_PITCH_MAX = Math.PI / 2;   // 좌우 고정 · 위 90° · 아래 0°
let worldRooms = [];                     // [{slot, cx, cz, size, bg, grp, backdrop, doorAt}]
let liveDoors = [];                      // [{item, room, other, x, z, side, panel, open, t, cooldown}]
const DOOR_W = 1.1, RM_DOOR_H = 2.1, ROOM_GAP = 0.24;   // 방 문 (스테이지 문과 별개)
function roomRect(r) { return { x0: r.cx - r.w / 2, x1: r.cx + r.w / 2, z0: r.cz - r.d / 2, z1: r.cz + r.d / 2 }; }
function linkedDoors(slotIdx) {          // 그 방의 연결된 문 전부
  const sl = roomStore.slots[slotIdx];
  if (!sl) return [];
  return sl.items.filter(it => it.type === 'door' && Number.isInteger(it.link)
    && it.link >= 0 && it.link < roomStore.slots.length && it.link !== slotIdx);
}
function buildWorld() {                  // 현재 방에서 문으로 이어진 방을 모두 세운다 (개수 제한 없음)
  if (!srScene) return;
  for (const r of worldRooms) { srScene.remove(r.grp); if (r.backdrop) srScene.remove(r.backdrop); }
  for (const d of liveDoors) if (d.panel) srScene.remove(d.panel);
  worldRooms = []; liveDoors = [];
  const placed = new Map();              // slot → room
  const first = roomStore.slots[roomStore.cur];
  const q = [{ slot: roomStore.cur, cx: 0, cz: 0 }];
  placed.set(roomStore.cur, { slot: roomStore.cur, cx: 0, cz: 0, w: roomW(first), d: roomD(first), bg: first.bg, gaps: [] });
  while (q.length) {
    const cur = q.shift();
    const rm = placed.get(cur.slot);
    for (const door of linkedDoors(cur.slot)) {
      const side = door.x >= 0 ? 1 : -1;                       // 문이 붙은 좌·우 벽
      const nb = roomStore.slots[door.link];
      const nw = roomW(nb), nd = roomD(nb);
      const gapZ = rm.cz + door.z;
      if (!placed.has(door.link)) {
        placed.set(door.link, {
          slot: door.link, cx: rm.cx + side * (rm.w / 2 + nw / 2 + ROOM_GAP), cz: gapZ,
          w: nw, d: nd, bg: nb.bg, gaps: [],
        });
        q.push({ slot: door.link });
      }
      const nbRoom = placed.get(door.link);
      rm.gaps.push({ side, z: door.z });                        // 이 방 벽의 구멍
      nbRoom.gaps.push({ side: -side, z: gapZ - nbRoom.cz });   // 옆방 벽의 구멍
      liveDoors.push({
        item: door, x: rm.cx + side * (rm.w / 2 + ROOM_GAP / 2), z: gapZ, side,
        from: cur.slot, to: door.link, open: 0, panel: null,
      });
    }
  }
  for (const r of placed.values()) {
    r.grp = buildRoomMesh(r);
    srScene.add(r.grp);
    r.backdrop = makeBackdrop(r);
    srScene.add(r.backdrop);
    worldRooms.push(r);
  }
  for (const d of liveDoors) {
    const panel = makeDoorPanel();
    panel.position.set(d.x, 0, d.z);
    panel.rotation.y = Math.PI / 2;
    srScene.add(panel);
    d.panel = panel;
  }
  buildFurnitureAll();
  SR_FULL.dist = Math.max(4.2, Math.max(roomW(first), roomD(first)) * 0.85 + 1.8);
  SR_FULL.y = 1.0;
  if (srMode === 'pose') srReset();
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
function makeBackdrop(r) {
  const bg = BG_LIST.find(b => b.key === r.bg) ?? BG_LIST[0];
  const geo = new THREE.CylinderGeometry(26, 26, 15, 40, 1, true, Math.PI * 0.55, Math.PI * 0.9);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: bgTexture(bg.key), side: THREE.BackSide, fog: false, toneMapped: false, depthWrite: false,
  }));
  m.position.set(r.cx, 4, r.cz);
  return m;
}
function buildRoomMesh(r) {              // 바닥 · 벽(뒤=창, 옆=문 구멍) · 격자
  const grp = new THREE.Group();
  const W = r.w, D = r.d, h = ROOM_H;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, D),
    new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.85, metalness: 0.1 }));
  floor.position.y = -0.06;
  grp.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x39434f, roughness: 0.9, metalness: 0.05, side: THREE.DoubleSide });
  const panel = (w, hh, x, y, z, ry) => {
    if (w <= 0.001 || hh <= 0.001) return;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), wallMat);
    m.position.set(x, y, z); m.rotation.y = ry;
    grp.add(m);
  };
  for (const sgn of [-1, 1]) {           // 좌·우 벽 — 문이 뚫린 자리는 비운다
    const x = sgn * W / 2;
    const holes = (r.gaps || []).filter(g => g.side === sgn).map(g => g.z).sort((a, b) => a - b);
    let from = -D / 2;
    for (const hz of holes) {
      const a = hz - DOOR_W / 2, b = hz + DOOR_W / 2;
      panel(Math.max(0, a - from), h, x, h / 2, (from + a) / 2, sgn * Math.PI / 2);
      panel(DOOR_W, h - RM_DOOR_H, x, (h + RM_DOOR_H) / 2, hz, sgn * Math.PI / 2);   // 문 위 상인방
      from = b;
    }
    panel(Math.max(0, D / 2 - from), h, x, h / 2, (from + D / 2) / 2, sgn * Math.PI / 2);
  }
  const winW = Math.min(W * 0.62, 4), winB = 0.9, winT = 2.5, sideW = (W - winW) / 2;
  panel(sideW, h, -(W - sideW) / 2, h / 2, -D / 2, 0);
  panel(sideW, h, (W - sideW) / 2, h / 2, -D / 2, 0);
  panel(winW, winB, 0, winB / 2, -D / 2, 0);
  panel(winW, h - winT, 0, (h + winT) / 2, -D / 2, 0);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c242e, roughness: 0.6, metalness: 0.4 });
  for (const y of [winB, winT]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.12, 0.08, 0.14), frameMat);
    bar.position.set(0, y, -D / 2);
    grp.add(bar);
  }
  const trimMat = new THREE.MeshBasicMaterial({ color: 0x39f6ff, fog: false, toneMapped: false });
  for (const [w, d, x, z] of [[W, 0.04, 0, -D / 2], [0.04, D, -W / 2, 0], [0.04, D, W / 2, 0], [W, 0.04, 0, D / 2]]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), trimMat);
    t.position.set(x, 0.015, z);
    grp.add(t);
  }
  if (r.slot === roomStore.cur) {
    srGridHelp = new THREE.GridHelper(Math.max(W, D), Math.round(Math.max(W, D) / GRID), 0x39f6ff, 0x2a4450);
    srGridHelp.material.opacity = 0.18; srGridHelp.material.transparent = true;
    srGridHelp.position.y = 0.012; srGridHelp.visible = false;
    grp.add(srGridHelp);
  }
  grp.position.set(r.cx, 0, r.cz);
  return grp;
}
function buildFurnitureAll() {            // 두 방의 가구를 한 그룹에
  if (srFurnGrp) srScene.remove(srFurnGrp);
  srFurnGrp = new THREE.Group();
  for (const r of worldRooms) {
    for (const it of roomStore.slots[r.slot].items) {
      if (it.type === 'door' && liveDoors.some(d => d.item === it)) continue;   // 이어진 문은 별도 연출
      const m = furnMesh(it.type);
      m.position.set(r.cx + it.x, it.y || 0, r.cz + it.z);
      m.rotation.y = (it.rot || 0) * ROT_STEP;
      m.userData.item = it;
      m.userData.room = r.slot;
      m.userData.roomY = 0;
      srFurnGrp.add(m);
    }
  }
  srScene.add(srFurnGrp);
  syncOutline();
}
// ---- 생활 모드 이동 ----
function liveEnter() {                     // 현 위치·현 시선 그대로 이어받는다
  srMode = 'live';
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
  srYaw = live.yaw;
  srTarget.dist = live.camDist; srView.dist = live.camDist;
  srPan.x = 0; srPanned = false; srSel = null;
  srTarget.y = SR_FULL.y;
  if (srRoot) { srRoot.position.set(live.x, 0, live.z); srRoot.rotation.y = srYaw; }
  srPlay('rifle aiming idle');
  toast('🧍 포즈 모드');
  srRenderModeUI();
}
function insideRooms(x, z, pad = 0.28) {
  for (const r of worldRooms) {
    const q = roomRect(r);
    if (x > q.x0 + pad && x < q.x1 - pad && z > q.z0 + pad && z < q.z1 - pad) return r.slot;
  }
  for (const d of liveDoors) {           // 문틀 통로
    if (Math.abs(x - d.x) < ROOM_GAP / 2 + 0.45 && Math.abs(z - d.z) < DOOR_W / 2 - 0.1) return live.active;
  }
  return -1;
}
function blockedByFurniture(x, z) {
  for (const r of worldRooms) {
    for (const it of roomStore.slots[r.slot].items) {
      const f = FURN[it.type];
      if (!f.blocking) continue;                     // 러그·벽걸이·천장물은 통과
      if ((it.y || 0) > 1.2 || (it.y || 0) + f.h < 0.25) continue;   // 머리 위·발밑은 통과
      const fp = footprint(it.type, it.rot);
      const ix = r.cx + it.x, iz = r.cz + it.z;
      if (Math.abs(x - ix) < fp.w / 2 + 0.26 && Math.abs(z - iz) < fp.d / 2 + 0.26) return true;
    }
  }
  return false;
}
function liveStep(dt) {
  const sp = 2.2;
  let mx = 0, mz = 0;
  if (keys['KeyW']) mz -= 1; if (keys['KeyS']) mz += 1;
  if (keys['KeyA']) mx -= 1; if (keys['KeyD']) mx += 1;
  const len = Math.hypot(mx, mz) || 1;
  const cy = Math.cos(live.camYaw), sy = Math.sin(live.camYaw);
  const dx = (-sy * -mz + cy * mx) / len, dz = (-cy * -mz - sy * mx) / len;
  live.moving = Math.abs(mx) + Math.abs(mz) > 0;
  if (live.moving) {
    const nx = live.x + dx * sp * dt, nz = live.z + dz * sp * dt;
    if (insideRooms(nx, live.z) >= 0 && !blockedByFurniture(nx, live.z)) live.x = nx;
    if (insideRooms(live.x, nz) >= 0 && !blockedByFurniture(live.x, nz)) live.z = nz;
    live.yaw = Math.atan2(dx, dz);        // 모델 정면(+z) 기준 — 가는 쪽을 본다
  }
  // 문: 가까우면 열리고, 지나가면 닫힌다
  for (const d of liveDoors) {
    const near = Math.hypot(live.x - d.x, live.z - d.z) < 1.6;
    const crossed = (live.x - d.x) * d.side > 0.15;
    const room = crossed ? d.to : d.from;
    if (room !== live.active) {
      live.active = room;
      roomStore.cur = room;               // 활성 방(= 창밖 풍경 기준)
      srBgLight?.color.setHex((BG_LIST.find(b => b.key === roomStore.slots[room].bg) ?? BG_LIST[0]).tint);
      roomSave(); roomRenderUI();
      toast('🚪 ' + roomStore.slots[room].name);
    }
    const want = near && Math.abs(live.x - d.x) < 1.2 ? 1 : 0;
    d.open += (want - d.open) * Math.min(1, dt * 6);
    d.panel.userData.pivot.rotation.y = -d.open * Math.PI * 0.55;
  }
  if (srRoot) {
    srRoot.position.set(live.x, 0, live.z);
    srRoot.rotation.y = live.yaw;
  }
  srPlay(live.moving ? 'walking' : 'rifle aiming idle');
  if (innerWidth > 0 && renderer.domElement.width !== Math.floor(innerWidth * (renderer.getPixelRatio() || 1))) renderer.setSize(innerWidth, innerHeight);   // 창 크기와 어긋나면 맞춘다
  live.camYaw = Math.max(-CAM_YAW_LIM, Math.min(CAM_YAW_LIM, live.camYaw));
  live.camPitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, live.camPitch));
  const flat = Math.cos(live.camPitch) * live.camDist;
  const camX = live.x + Math.sin(live.camYaw) * flat;
  const camZ = live.z + Math.cos(live.camYaw) * flat;
  const camY = 1.15 + Math.sin(live.camPitch) * live.camDist;
  const cr = renderer.domElement.getBoundingClientRect();     // 화면에 그려지는 영역과 같은 비율로 (픽킹과 일치)
  srCam.aspect = cr.height > 0 ? cr.width / cr.height : (innerHeight ? innerWidth / innerHeight : 16 / 9);
  srCam.updateProjectionMatrix();
  srCam.position.set(camX, camY, camZ);
  srCam.lookAt(live.x, 1.15, live.z);
  srCam.updateMatrixWorld(true);
  drawRoomMap();
}
// ---- 연결 미니맵 ----
function drawRoomMap() {
  const cv = document.getElementById('srMap');
  if (!cv) return;
  const show = roomStore.slots.length > 1 && liveDoors.length > 0;
  cv.style.display = show ? 'block' : 'none';
  if (!show) return;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, cv.width, cv.height);
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const r of worldRooms) {
    const q = roomRect(r);
    minX = Math.min(minX, q.x0); maxX = Math.max(maxX, q.x1);
    minZ = Math.min(minZ, q.z0); maxZ = Math.max(maxZ, q.z1);
  }
  const pad = 8, k = Math.min((cv.width - pad * 2) / (maxX - minX), (cv.height - pad * 2) / (maxZ - minZ));
  const px = x => pad + (x - minX) * k, pz = z => pad + (z - minZ) * k;
  for (const r of worldRooms) {
    const q = roomRect(r);
    c.fillStyle = r.slot === live.active ? 'rgba(64,214,255,.22)' : 'rgba(120,160,180,.12)';
    c.fillRect(px(q.x0), pz(q.z0), (q.x1 - q.x0) * k, (q.z1 - q.z0) * k);
    c.strokeStyle = r.slot === live.active ? '#7df3ff' : '#4a6b7a';
    c.lineWidth = 1.5;
    c.strokeRect(px(q.x0), pz(q.z0), (q.x1 - q.x0) * k, (q.z1 - q.z0) * k);
    c.fillStyle = '#9fd8ea'; c.font = '9px system-ui'; c.textAlign = 'center';
    c.fillText(roomStore.slots[r.slot].name.slice(0, 8), px(r.cx), pz(r.cz - r.d / 2) + 11);
  }
  for (const d of liveDoors) {           // 문
    c.strokeStyle = '#ffd76b'; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(px(d.x), pz(d.z - DOOR_W / 2)); c.lineTo(px(d.x), pz(d.z + DOOR_W / 2));
    c.stroke();
  }
  if (srMode === 'live') {               // 플레이어
    c.fillStyle = '#7ee0a3';
    c.beginPath(); c.arc(px(live.x), pz(live.z), 3.4, 0, Math.PI * 2); c.fill();
  }
}
function srRenderModeUI() {
  for (const b of document.querySelectorAll('#srModes button'))
    b.classList.toggle('on', b.dataset.mode === srMode);
  document.getElementById('srLeft').style.opacity = srMode === 'live' ? '0.35' : '1';
  document.getElementById('srHint').textContent = srMode === 'live'
    ? 'WASD 이동 · 좌드래그 카메라 회전 · 휠 거리 · 문 앞에서 자동으로 열립니다'
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
function srBuild() {
  if (srScene || !playerGltf) return;
  srScene = new THREE.Scene();
  srScene.background = new THREE.Color(0x070d13);   // 어두운 무대 배경 (CSS 덮개 없음)
  srCam = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 60);
  // 인게임과 같은 대비를 유지하고(반구광 + 태양광) 스포트는 액센트로만
  srScene.add(new THREE.HemisphereLight(0x9db2d8, 0x3a4a30, 1.1));
  const sunL = new THREE.DirectionalLight(0xffeedd, 2.6); sunL.position.set(2.6, 4, 2.4); srScene.add(sunL);
  const key = new THREE.SpotLight(0xffffff, 45, 16, 0.66, 0.5, 1.2);    // 정면 위 스포트
  key.position.set(1.2, 4.6, 3.0); key.target.position.set(0, 1.15, 0);
  srScene.add(key, key.target);
  const rim = new THREE.SpotLight(0xdff2ff, 40, 16, 0.6, 0.5, 1.2);     // 뒤 림라이트
  rim.position.set(-1.6, 3.6, -3.2); rim.target.position.set(0, 1.35, 0);
  srScene.add(rim, rim.target);
  srGodRays();
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
  buildWorld();
}
let srRays = null, srDust = null;
function srRayTexture() {                // 위는 밝고 아래로 사라지는 그라데이션
  const cv = document.createElement('canvas'); cv.width = 8; cv.height = 128;
  const c = cv.getContext('2d');
  const g2 = c.createLinearGradient(0, 0, 0, 128);
  g2.addColorStop(0, 'rgba(190,235,255,.55)');
  g2.addColorStop(0.45, 'rgba(150,215,255,.22)');
  g2.addColorStop(1, 'rgba(120,200,255,0)');
  c.fillStyle = g2; c.fillRect(0, 0, 8, 128);
  return new THREE.CanvasTexture(cv);
}
function srGodRays() {                   // 스포트라이트를 따라 내려오는 빛기둥
  srRays = new THREE.Group();
  const tex = srRayTexture();
  const mk = (rTop, rBot, h, x, z, tilt) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 28, 1, true),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.38, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
      }));
    m.position.set(x, h / 2, z);
    m.rotation.z = tilt;
    srRays.add(m);
    return m;
  };
  mk(0.25, 1.4, ROOM_H, 0, -0.5, 0);    // 캐릭터 뒤에서 내려오는 빛기둥 하나 (방 높이)
  srScene.add(srRays);
  const n = 90, pos = new Float32Array(n * 3);   // 빛 속 먼지
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 1.8;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 0.2 + Math.random() * 3.4; pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  srDust = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xbfe9ff, size: 0.022, transparent: true, opacity: 0.75, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  srScene.add(srDust);
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
  if (srTab === 'room') { for (const t of document.querySelectorAll('#srTabs button')) t.classList.toggle('on', t.dataset.tab === srTab);
    document.getElementById('srInv').style.display = 'none';
    document.getElementById('srRoomPane').classList.add('on');
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
  document.getElementById('srInv').style.display = srTab === 'room' ? 'none' : 'grid';
  document.getElementById('srRoomPane').classList.toggle('on', srTab === 'room');
  if (srTab === 'room') roomRenderUI(); else cancelPlace();
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
  document.getElementById('srName').textContent = curRoom().name;
}
function closeShowroom() {
  srOn = false;
  document.getElementById('showroom').classList.remove('on');
  document.body.classList.remove('showroom');
  refreshOverlay();
}
function srApplyCam() {                   // 카메라 위치·행렬 최신화 (레이캐스트 전에도 필요)
  if (!srCam) return;
  if (innerWidth > 0 && renderer.domElement.width !== Math.floor(innerWidth * (renderer.getPixelRatio() || 1))) renderer.setSize(innerWidth, innerHeight);   // 창 크기와 어긋나면 맞춘다
  const cr = renderer.domElement.getBoundingClientRect();     // 화면에 그려지는 영역과 같은 비율로 (픽킹과 일치)
  srCam.aspect = cr.height > 0 ? cr.width / cr.height : (innerHeight ? innerWidth / innerHeight : 16 / 9);
  srCam.updateProjectionMatrix();
  const az = live.camYaw, s2 = Math.sin(az), c2 = Math.cos(az);
  const px = live.x + srPan.x * c2, pz = live.z - srPan.x * s2;   // 피벗 = 캐릭터 위치
  srCam.position.set(px + s2 * srView.dist, srView.y + srView.dist * 0.12, pz + c2 * srView.dist);
  srCam.lookAt(px, srView.y, pz);
  srCam.updateMatrixWorld(true);
}
function srUpdate(dt) {
  if (!srOn || !srScene) return;
  if (srMode === 'live') {               // 생활 모드: 걷기 + 따라오는 카메라
    srMixer.update(dt);
    roomUpdate();
    liveStep(dt);
    renderer.render(srScene, srCam);
    return;
  }
  if (srSpin && !srDrag) srYaw += dt * 0.5;
  srRoot.position.set(live.x, 0, live.z);
  srRoot.rotation.y = srYaw;
  srMixer.update(dt);
  if (srRays) {
    srRays.rotation.y += dt * 0.04;
    for (let i = 0; i < srRays.children.length; i++)
      srRays.children[i].material.opacity = 0.32 + Math.sin(gameTime * 0.7) * 0.07;
  }
  if (srDust) {
    const p = srDust.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) - dt * 0.12;
      if (y < 0.1) y = 3.6;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(gameTime * 0.5 + i) * dt * 0.02);
    }
    p.needsUpdate = true;
  }
  roomUpdate();
  srView.y += (srTarget.y - srView.y) * Math.min(1, dt * 6);       // 부드럽게 줌인
  srView.dist += (srTarget.dist - srView.dist) * Math.min(1, dt * 6);
  srClampView();
  srApplyCam();
  renderer.render(srScene, srCam);
}
// 입력: 드래그 회전 · 휠 확대 · 버튼
(function srBindUI() {
  const sr = document.getElementById('showroom');
  sr.addEventListener('contextmenu', e => { if (srOn) e.preventDefault(); });
  sr.addEventListener('pointerdown', e => {
    if (e.target.closest('.srPanel, #srBottom, #srClose, #srTop')) return;
    e.preventDefault();                  // 드래그 중 텍스트가 잡히지 않게
    if (e.button === 2) { srPanDrag = [e.clientX, e.clientY]; return; }   // 우클릭: 카메라 이동
    srDrag = e.clientX; srDragY = e.clientY; srSpin = false;
  });
  addEventListener('pointermove', e => {
    if (!srOn) return;
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
      live.camYaw -= (e.clientX - srDrag) * 0.008;
      live.camPitch += ((srDragY ?? e.clientY) - e.clientY) * -0.004;
    } else srYaw += (e.clientX - srDrag) * 0.01;
    srDrag = e.clientX; srDragY = e.clientY;
  });
  addEventListener('pointerup', e => { srDrag = null; if (e.button === 2 || srPanDrag) srPanDrag = null; });
  sr.addEventListener('wheel', e => {
    if (!srOn) return;
    e.preventDefault();
    if (srMode === 'live') { live.camDist = Math.max(1.6, Math.min(7, live.camDist + Math.sign(e.deltaY) * 0.3)); return; }
    srTarget.dist = Math.max(0.7, Math.min(6, srTarget.dist + Math.sign(e.deltaY) * 0.25));
    if (!srSel && !srPanned) {           // 부위를 고르지 않았으면 쇄골을 중심으로 당긴다
      const k = Math.min(1, Math.max(0, (SR_FULL.dist - srTarget.dist) / (SR_FULL.dist - 0.7)));
      srTarget.y = SR_FULL.y + (srClavicleY() - SR_FULL.y) * k;
    }
    srClampView();                       // 축소하면 다시 가운데로 모인다
  }, { passive: false });
  sr.addEventListener('pointermove', e => {                 // 배치 중이면 고스트가 따라다닌다
    if (!srOn || !placeType || !placeGhost) return;
    const hit = placePoint(e);
    if (!hit) return;
    const q = snapPos(placeType, placeRot, hit.p.x, hit.p.z, hit.host);
    placeGhost.userData.snap = q;
    const rm = worldRooms.find(r => r.slot === q.slot);
    placeGhost.position.set((rm ? rm.cx : 0) + q.x, q.y || 0, (rm ? rm.cz : 0) + q.z);
    placeGhost.rotation.y = (q.wall ? q.rot : placeRot) * ROT_STEP;
    const bad = overlaps(placeType, q.wall ? q.rot : placeRot, q.x, q.z, q.y || 0, q.under ?? q.on ?? null, roomStore.slots[q.slot]?.items);
    placeGhost.traverse(o => { if (o.isMesh) o.material.color.setHex(bad ? 0xff5a4a : FURN[placeType].color); });
  });
  sr.addEventListener('click', e => {
    if (!srOn || e.target.closest('.srPanel, #srBottom, #srClose, #srTop')) return;
    if (placeType) { commitPlace(); return; }
    if (srTab !== 'room') return;
    const picked = pickFurniture(e);      // 놓인 가구 고르기
    if (picked) { setSel(picked); showCtx(e.clientX, e.clientY); }   // 빈 곳을 눌러도 메뉴는 닫기 전까지 유지
  });
  addEventListener('keydown', e => {
    if (!srOn) return;
    if (e.code === 'KeyR') rotateCurrent();
    if (e.code === 'Delete' || e.code === 'Backspace') removeSelected();
    if (e.code === 'Escape') { hideCtx(); if (placeType) cancelPlace(); else if (srPickSel) setSel(null); }
  });
  document.getElementById('srRot').addEventListener('click', e => { e.stopPropagation(); rotateCurrent(); });
  document.getElementById('srClear').addEventListener('click', e => { e.stopPropagation(); clearRoom(); });
  document.getElementById('srSave').addEventListener('click', e => { e.stopPropagation(); roomSave(); toast('💾 ' + curRoom().name + ' 저장'); });
  for (const b of document.querySelectorAll('#srCtx [data-ctx]')) {        // 커서 옆 메뉴
    b.addEventListener('click', e => {
      e.stopPropagation();
      const a2 = b.dataset.ctx;
      if (a2 === 'rot') { rotateCurrent(); return; }        // 회전은 메뉴를 유지
      if (a2 === 'del') removeSelected();
      hideCtx();
    });
  }
  document.getElementById('srDel').addEventListener('click', e => { e.stopPropagation(); removeSelected(); });
  document.getElementById('srRoomName').addEventListener('input', e => {
    curRoom().name = e.target.value.slice(0, 16) || 'MY ROOM';
    document.getElementById('srName').textContent = curRoom().name;
    roomSave();
  });
  for (const b of document.querySelectorAll('#srModes button')) {
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (b.dataset.mode === 'live') liveEnter(); else liveExit();
    });
  }
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
      upg: { ...upg }, maxHp: maxHp(), mag: magSize(),
      grenades, gMode, slot, markers: markers.length, projSpeed: projectiles[0] ? +projectiles[0].vel.length().toFixed(2) : null, gWindup, tossTime: +(player.actions['toss grenade']?.time ?? -1).toFixed(2), tossScale: player.actions['toss grenade']?.timeScale ?? -1, liveGrenades: liveGrenades.length, mines, liveMines: liveMines.length, multiN,
      beacon: beacon ? { x: +beacon.x.toFixed(1), z: +beacon.z.toFixed(1), left: +(beacon.limit - beacon.t).toFixed(1) } : null,
      seenRects: seenRects.size, hitArrows: hitArrows.length, mapSeed, roomThemes: [...roomThemes],
      safeRoom: safeRoom ? { until: +Math.max(0, safeUntil - gameTime).toFixed(1) } : null,
      floorNo, floorTime: +floorTime.toFixed(1), portalTravel, cores, spawnCd: +spawnCd.toFixed(2), floorShopOpen,
      portal: portal ? { x: +portal.x.toFixed(1), z: +portal.z.toFixed(1), locked: !!portal.locked } : null,
      hunter: hunter ? { pos: hunter.root.position.toArray().map(v => +v.toFixed(1)), speed: +hunter.speed.toFixed(1), stunAcc: hunter.stunAcc, stunT: +hunter.stunT.toFixed(2) } : null,
      hp: player.hp, eyeH: +player.eyeH.toFixed(2), zooming: player.zooming, firing, yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3), fov: +camera.fov.toFixed(1),
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
    updateJumpPads(dt);
    updateDoors(dt);
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
  roomProject(i) {
    const it = curRoom().items[i];
    if (!it || !srCam) return null;
    srApplyCam();
    const v = new THREE.Vector3(it.x, 0.3, it.z).project(srCam);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: Math.round(r.left + (v.x * 0.5 + 0.5) * r.width), y: Math.round(r.top + (-v.y * 0.5 + 0.5) * r.height) };
  },
  roomPick(x, y) { setSel(pickFurniture({ clientX: x, clientY: y })); return curRoom().items.indexOf(srPickSel); },
  roomSelect(i) { setSel(curRoom().items[i] ?? null); return !!srPickSel; },
  roomClear() { clearRoom(); return curRoom().items.length; },
  roomAdd() { addRoomSlot(); return roomStore.slots.length; },
  roomLoadSlot(i) { loadRoomSlot(i); return roomStore.cur; },
  roomBg(k) { setBg(k); return curRoom().bg; },
  liveMode(on) { on ? liveEnter() : liveExit(); return srMode; },
  ghostScreen() {
    if (!placeGhost || !srCam) return null;
    srApplyCam();
    const v = placeGhost.position.clone().project(srCam);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: Math.round(r.left + (v.x * 0.5 + 0.5) * r.width), y: Math.round(r.top + (-v.y * 0.5 + 0.5) * r.height), world: placeGhost.position.toArray().map(n => +n.toFixed(2)) };
  },
  liveCam() { return { yaw: +live.camYaw.toFixed(3), pitch: +live.camPitch.toFixed(3), dist: +live.camDist.toFixed(2) }; },
  liveDrag(dx, dy) { live.camYaw -= dx * 0.008; live.camPitch += dy * 0.004; liveStep(1 / 60); return { yaw: +live.camYaw.toFixed(3), pitch: +live.camPitch.toFixed(3) }; },
  livePos() { return { mode: srMode, x: +live.x.toFixed(2), z: +live.z.toFixed(2), yaw: +live.yaw.toFixed(3), camYaw: +live.camYaw.toFixed(3), camDist: +live.camDist.toFixed(2), srYaw: +srYaw.toFixed(3), rootRot: +(srRoot?.rotation.y ?? 0).toFixed(3), active: live.active, doors: liveDoors.length, rooms: worldRooms.map(r => ({ slot: r.slot, cx: +r.cx.toFixed(2), cz: +r.cz.toFixed(2), w: r.w, d: r.d })) }; },
  liveStep(n = 1, k = {}) { for (let i = 0; i < n; i++) { Object.assign(keys, k); liveStep(1 / 60); } for (const kk of Object.keys(k)) keys[kk] = false; return { x: +live.x.toFixed(2), z: +live.z.toFixed(2), active: live.active }; },
  linkDoor(i, to) { const it = curRoom().items[i]; if (!it || it.type !== 'door') return null; it.link = to; roomSave(); buildWorld(); return it.link; },
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
  toPortal() { if (portal) player.pos.set(portal.x, 0, portal.z); },
  buildSeed(seed) { mapMode = 'random'; clearWorld(); seenRects.clear(); buildRandom(seed); return mapSeed; },
  walkable(x, z) { return !cellSolid(x, z); },
  setPos(x, y, z) { player.pos.set(x, y, z); player.vy = 0; player.onGround = true; },
  toss() { throwGrenade(); },
  selectSlot(name) { selectSlot(name); return slot; },
  revive() { player.dead = false; player.hp = maxHp(); msgEl.style.display = 'none'; updateHpHud(); },
  buy(k) { buyUpg(k); },
  addCoins(n) { coins += n; document.getElementById('coinN').textContent = coins; renderUpg(); persistProgress(); },
};
