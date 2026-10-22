// /management/draw: the live draw as a 3D scene. A white table with a glass bowl full of folded paper
// notes (one per entry, two with a confirmed story), and a small red audio interface (inspired by a
// Scarlett Solo) whose buttons run the draw. Drag a note out of the bowl onto the table (or tap one),
// open it, then winner / remove (not in the live) / put back. The camera has several angles and moves
// by itself during the reveal. Which person a note is gets decided at random the moment it's picked.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoundedBoxGeometry } from '../vendor/three/RoundedBoxGeometry.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';

const $ = (id) => document.getElementById(id);
const api = Admin.api;
const C = encodeURIComponent(CAMPAIGN.id);

// ---------------------------------------------------------------- state

let onlyFollowers = true;
let pool = [];          // entries still in the bowl: {key, handles, notes, others, repost_only}
let current = null;     // {entry, handle, slip}
let stageNow = null;    // null | 'folded' | 'reveal' | 'open' | 'winner'
let busy = false;       // an animation that mustn't be interrupted
let demo = /[?&]demo\b/.test(location.search);
let demoOut = {};
let cinema = pref('cinema', true), sound = pref('sound', true);
const MAX_NOTES = 120;

function pref(k, def) {
  try { const v = localStorage.getItem('luciano:draw-' + k); return v === null ? def : v === '1'; } catch (e) { return def; }
}
function setPref(k, v) { try { localStorage.setItem('luciano:draw-' + k, v ? '1' : '0'); } catch (e) {} }
function rand(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
function note(t) { $('d-note').textContent = t; }

const DEMO = ['mathilde.k', 'oliver_dk', 'freja99', 'noahhh', 'ida.sofie', 'lucas_cph', 'emma.lund', 'william.b', 'clara.mm',
  'victor_07', 'alma.r', 'karl.jensen', 'sofie_aa', 'oscar.dk', 'ella.n', 'magnus.v', 'agnes__', 'elias.h', 'laura.pp',
  'malthe_', 'josefine.x', 'august.k', 'nora.l', 'arthur99'];
function demoData() {
  const out = { pool: [], removed: [], winners: [], votes: DEMO.length, followers: DEMO.length };
  DEMO.forEach((h, i) => {
    const e = { key: 'demo:' + h, handles: [h], notes: i % 4 === 1 ? 2 : 1, repost_only: i % 9 === 5, others: [] };
    if (e.repost_only) e.notes = 1;
    (demoOut[h] === 1 ? out.removed : demoOut[h] === 2 ? out.winners : out.pool).push(e);
  });
  return out;
}
const getPool = () => demo ? Promise.resolve(demoData()) : api('GET', 'draw-pool?campaign=' + C + '&followers=' + (onlyFollowers ? 1 : 0));
function setState(handle, state) {
  if (demo) { if (state) demoOut[handle] = state; else delete demoOut[handle]; return Promise.resolve(); }
  return api('POST', 'draw-mark', { campaign: CAMPAIGN.id, handle, state });
}
const noteCount = () => pool.reduce((a, e) => a + e.notes, 0);

// ---------------------------------------------------------------- tweens

const tweens = [];
const ease = {
  inOut: (k) => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2,
  out: (k) => 1 - Math.pow(1 - k, 3),
  in: (k) => k * k * k,
  back: (k) => { const c = 1.6; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); },
};
function tween(ms, fn, e = ease.inOut) {
  return new Promise((resolve) => tweens.push({ t0: performance.now(), ms, fn, e, resolve }));
}
function runTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const t = tweens[i];
    const k = Math.min(1, (now - t.t0) / t.ms);
    t.fn(t.e(k), k);
    if (k >= 1) { tweens.splice(i, 1); t.resolve(); }
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const lerp = (a, b, k) => a + (b - a) * k;

// ---------------------------------------------------------------- scene

const canvas = $('d3c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('loading').textContent = 'Din browser kan ikke vise 3D. Prøv Safari eller Chrome.';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
scene.fog = new THREE.Fog(0x050505, 6, 14);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.42;

const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
const camTarget = new THREE.Vector3(0, 1.15, -0.1);
camera.position.set(0, 2.1, 3.0);
const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;
controls.target.copy(camTarget);
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 0.4;
controls.maxDistance = 7;

// Light: a soft room, a key spot from above, a rim light from behind
const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.35);
scene.add(hemi);
const key = new THREE.SpotLight(0xfff6e8, 34, 12, 0.62, 0.65, 1.4);
key.position.set(0.6, 4.2, 2.0);
key.target.position.set(0, 1.0, -0.1);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.radius = 4;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xbfd4ff, 0.7);
rim.position.set(-2.5, 3, -3);
scene.add(rim);
// A spot that narrows onto the note during the reveal
const stagelight = new THREE.SpotLight(0xfff2d6, 0, 6, 0.22, 0.5, 1.2);
stagelight.position.set(0, 3.2, 1.2);
scene.add(stagelight, stagelight.target);

// Floor
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// The white table
const TOP = 1.0; // table surface height
const TABLE = { w: 3.2, d: 1.9 };
const white = new THREE.MeshStandardMaterial({ color: 0xe4e6e8, roughness: 0.55, metalness: 0 });
const tableTop = new THREE.Mesh(new RoundedBoxGeometry(TABLE.w, 0.08, TABLE.d, 4, 0.03), white);
tableTop.position.y = TOP - 0.04;
tableTop.castShadow = true;
tableTop.receiveShadow = true;
scene.add(tableTop);
const legMat = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, roughness: 0.35, metalness: 0.1 });
for (const [x, z] of [[-1.45, -0.8], [1.45, -0.8], [-1.45, 0.8], [1.45, 0.8]]) {
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, TOP - 0.08, 20), legMat);
  leg.position.set(x, (TOP - 0.08) / 2, z);
  leg.castShadow = true;
  scene.add(leg);
}

// The glass bowl (a fishbowl, turned on a lathe)
const BOWL = new THREE.Vector3(-0.15, TOP, -0.35);
const profile = [[0.001, 0], [0.16, 0.004], [0.28, 0.035], [0.37, 0.12], [0.415, 0.26], [0.405, 0.4], [0.35, 0.53], [0.27, 0.63], [0.225, 0.69], [0.215, 0.73], [0.222, 0.745]]
  .map(([r, y]) => new THREE.Vector2(r, y));
// Smooth the curve so the glass doesn't look faceted
const smooth = new THREE.SplineCurve(profile).getPoints(90);
const bowlGroup = new THREE.Group();
bowlGroup.position.copy(BOWL);
scene.add(bowlGroup);
const glass = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, metalness: 0, roughness: 0.03, transmission: 1, thickness: 0.06, ior: 1.45,
  transparent: true, opacity: 1, side: THREE.DoubleSide, envMapIntensity: 1.2, specularIntensity: 1,
});
const bowlMesh = new THREE.Mesh(new THREE.LatheGeometry(smooth, 128), glass);
bowlMesh.castShadow = false;
bowlGroup.add(bowlMesh);
const rimMesh = new THREE.Mesh(new THREE.TorusGeometry(0.222, 0.008, 12, 96), glass);
rimMesh.rotation.x = Math.PI / 2;
rimMesh.position.y = 0.745;
bowlGroup.add(rimMesh);
// A faint shadow under the bowl so it sits on the table
const contact = new THREE.Mesh(new THREE.CircleGeometry(0.3, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.05, depthWrite: false }));
contact.rotation.x = -Math.PI / 2;
contact.position.y = 0.002;
bowlGroup.add(contact);

// An invisible grab zone around the bowl: a tap anywhere on it takes a note
const grabZone = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.42, 0.85, 24), new THREE.MeshBasicMaterial({ visible: false }));
grabZone.position.y = 0.4;
bowlGroup.add(grabZone);

// Inner radius of the bowl at height y (for placing notes inside)
function bowlRadius(y) {
  for (let i = 1; i < profile.length; i++) {
    if (y <= profile[i].y) {
      const a = profile[i - 1], b = profile[i];
      return lerp(a.x, b.x, (y - a.y) / (b.y - a.y));
    }
  }
  return profile[profile.length - 1].x;
}

// ---------------------------------------------------------------- paper

const NOTE = { w: 0.13, d: 0.075, t: 0.0035 }; // a folded note
const paper = new THREE.MeshStandardMaterial({ color: 0xead9b0, roughness: 0.85 });
const paperSide = new THREE.MeshStandardMaterial({ color: 0xcdb98e, roughness: 0.9 });
const noteGeo = new THREE.BoxGeometry(NOTE.w, NOTE.t, NOTE.d);
const notes = []; // meshes in the bowl

function bowlSpot(layer) {
  // A random place in the pile at the bottom of the bowl
  const y = 0.012 + Math.random() * Math.min(0.32, 0.05 + layer * 0.003);
  const r = Math.max(0.05, bowlRadius(y) - 0.09) * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
}
function settle(m, layer) {
  const p = bowlSpot(layer);
  m.position.copy(p);
  m.rotation.set((Math.random() - 0.5) * 1.1, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 1.1);
}
function makeNoteMesh() {
  const m = new THREE.Mesh(noteGeo, [paperSide, paperSide, paper, paper, paperSide, paperSide]);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.note = true;
  return m;
}
function renderBowl() {
  notes.forEach((n) => bowlGroup.remove(n));
  notes.length = 0;
  const total = Math.min(MAX_NOTES, noteCount());
  for (let i = 0; i < total; i++) {
    const m = makeNoteMesh();
    settle(m, i);
    bowlGroup.add(m);
    notes.push(m);
  }
}

// The name on the slip: drawn on a canvas, sharpened during the reveal
const slipCanvas = document.createElement('canvas');
slipCanvas.width = 1024;
slipCanvas.height = Math.round(1024 * (NOTE.d * 2) / NOTE.w);
const slipTexTop = new THREE.CanvasTexture(slipCanvas);
const slipTexBottom = new THREE.CanvasTexture(slipCanvas);
for (const [t, off] of [[slipTexTop, 0.5], [slipTexBottom, 0]]) {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(1, 0.5);
  t.offset.set(0, off);
}
const outCanvas = document.createElement('canvas');
outCanvas.width = 512; outCanvas.height = 300;
(function drawOutside() {
  const g = outCanvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 300);
  grad.addColorStop(0, '#eedfbd'); grad.addColorStop(1, '#ddc9a0');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 300);
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.font = '700 96px Georgia, "Times New Roman", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('99', 256, 156);
})();
const outTex = new THREE.CanvasTexture(outCanvas);
outTex.colorSpace = THREE.SRGBColorSpace;

function drawSlip(name, sub, blur, stamp) {
  const g = slipCanvas.getContext('2d'), W = slipCanvas.width, H = slipCanvas.height;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#f6ead0'); grad.addColorStop(0.5, '#eadbb8'); grad.addColorStop(0.505, '#f2e4c6'); grad.addColorStop(1, '#e6d5b0');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // faint ruled lines
  g.strokeStyle = 'rgba(80,110,160,0.08)'; g.lineWidth = 2;
  for (let y = 70; y < H; y += 70) { g.beginPath(); g.moveTo(40, y); g.lineTo(W - 40, y); g.stroke(); }
  if (name) {
    let size = 150;
    g.font = `800 ${size}px Montserrat, "Helvetica Neue", Arial, sans-serif`;
    while (g.measureText(name).width > W - 120 && size > 50) { size -= 6; g.font = `800 ${size}px Montserrat, "Helvetica Neue", Arial, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (blur > 0.5) {
      // Blurred text that works in every browser: draw only its shadow
      g.save();
      g.shadowColor = 'rgba(17,17,17,0.95)';
      g.shadowBlur = blur * 3;
      g.shadowOffsetX = 5000;
      g.fillStyle = '#111';
      g.fillText(name, W / 2 - 5000, H / 2);
      g.restore();
    } else {
      g.fillStyle = '#111';
      g.fillText(name, W / 2, H / 2);
    }
    if (sub && blur <= 0.5) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.font = '700 34px Montserrat, Arial, sans-serif';
      g.fillText(sub, W / 2, H - 70);
    }
  }
  if (stamp) {
    g.save();
    g.translate(W * 0.74, H * 0.3);
    g.rotate(0.22);
    g.strokeStyle = '#c4161c'; g.fillStyle = 'rgba(196,22,28,0.92)';
    g.lineWidth = 10;
    g.strokeRect(-190, -62, 380, 124);
    g.font = '800 84px Montserrat, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('VINDER', 0, 6);
    g.restore();
  }
  slipTexTop.needsUpdate = true;
  slipTexBottom.needsUpdate = true;
}

// A slip: two halves; the top half is hinged and lies folded over the bottom half
function makeSlip() {
  const group = new THREE.Group();
  const half = new THREE.BoxGeometry(NOTE.w, NOTE.t / 2, NOTE.d);
  const bottomMat = new THREE.MeshStandardMaterial({ map: slipTexBottom, roughness: 0.85 });
  const topIn = new THREE.MeshStandardMaterial({ map: slipTexTop, roughness: 0.85 });
  const topOut = new THREE.MeshStandardMaterial({ map: outTex, roughness: 0.85 });
  const bottom = new THREE.Mesh(half, [paperSide, paperSide, bottomMat, paper, paperSide, paperSide]);
  bottom.position.z = NOTE.d / 2;
  bottom.castShadow = bottom.receiveShadow = true;
  const hinge = new THREE.Group();
  hinge.position.y = NOTE.t / 2;
  const top = new THREE.Mesh(half, [paperSide, paperSide, topIn, topOut, paperSide, paperSide]);
  top.position.z = -NOTE.d / 2;
  top.castShadow = top.receiveShadow = true;
  hinge.add(top);
  hinge.rotation.x = Math.PI; // folded
  group.add(bottom, hinge);
  group.userData.hinge = hinge;
  return group;
}

// ---------------------------------------------------------------- the mixer (inspired by a Scarlett Solo)

const MIXER = new THREE.Group();
MIXER.position.set(0.95, TOP, 0.42);
MIXER.rotation.y = -0.42;
scene.add(MIXER);
const red = new THREE.MeshStandardMaterial({ color: 0xc41a24, roughness: 0.38, metalness: 0.55 });
const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.2 });
const body = new THREE.Mesh(new RoundedBoxGeometry(0.56, 0.085, 0.3, 4, 0.02), red);
body.position.y = 0.0425;
body.castShadow = body.receiveShadow = true;
MIXER.add(body);
// little rubber feet
for (const [x, z] of [[-0.24, -0.12], [0.24, -0.12], [-0.24, 0.12], [0.24, 0.12]]) {
  const f = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.004, 12), black);
  f.position.set(x, 0.002, z);
  MIXER.add(f);
}
const faceY = 0.086;
// Labels printed on the top
const labelCanvas = document.createElement('canvas');
labelCanvas.width = 1120; labelCanvas.height = 600;
const labelTex = new THREE.CanvasTexture(labelCanvas);
labelTex.colorSpace = THREE.SRGBColorSpace;
labelTex.anisotropy = 8;
const labelPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.3), new THREE.MeshStandardMaterial({ map: labelTex, transparent: true, roughness: 0.5, metalness: 0.2 }));
labelPlane.rotation.x = -Math.PI / 2;
labelPlane.position.y = faceY + 0.0005;
MIXER.add(labelPlane);

// The big knob with its LED halo: turn/press it to shake the bowl
function knob(x, z, r) {
  const g = new THREE.Group();
  g.position.set(x, faceY, z);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, r * 0.75, 48), black);
  cap.position.y = r * 0.375;
  cap.castShadow = true;
  const mark = new THREE.Mesh(new THREE.BoxGeometry(r * 0.12, 0.002, r * 0.5), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 }));
  mark.position.set(0, r * 0.76, -r * 0.45);
  const turn = new THREE.Group();
  turn.add(cap, mark);
  const haloMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x3ce67a, emissiveIntensity: 1.6 });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(r * 1.22, r * 0.07, 10, 64), haloMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.001;
  g.add(turn, halo);
  MIXER.add(g);
  return { group: g, turn, halo, haloMat };
}
const gainKnob = knob(-0.16, -0.02, 0.05);
const monitorKnob = knob(0.17, -0.03, 0.065);
gainKnob.turn.userData.button = 'shake';
gainKnob.turn.children.forEach((c) => (c.userData.button = 'shake'));
monitorKnob.haloMat.emissive.set(0xffffff);
monitorKnob.haloMat.emissiveIntensity = 0.25;

// The five buttons, in a row along the front
const BUTTONS = [
  { id: 'pick', label: 'TRÆK', color: 0xd4af37 },
  { id: 'reveal', label: 'ÅBN', color: 0xffffff },
  { id: 'back', label: 'TILBAGE', color: 0xffb028 },
  { id: 'win', label: 'VINDER', color: 0x3ce67a },
  { id: 'remove', label: 'FJERN', color: 0xff4040 },
  { id: 'clear', label: 'RYD', color: 0x50a0ff },
];
const buttonGeo = new RoundedBoxGeometry(0.05, 0.02, 0.04, 3, 0.006);
const BX = (i) => -0.225 + i * 0.09;
const ledGeo = new THREE.SphereGeometry(0.0045, 12, 8);
BUTTONS.forEach((b, i) => {
  const x = BX(i);
  const z = 0.095;
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.55, metalness: 0.15, emissive: b.color, emissiveIntensity: 0 });
  const m = new THREE.Mesh(buttonGeo, mat);
  m.position.set(x, faceY + 0.008, z);
  m.castShadow = true;
  m.userData.button = b.id;
  const led = new THREE.Mesh(ledGeo, new THREE.MeshStandardMaterial({ color: 0x222222, emissive: b.color, emissiveIntensity: 0 }));
  led.position.set(x, faceY + 0.003, z - 0.04);
  MIXER.add(m, led);
  b.mesh = m; b.mat = mat; b.led = led; b.baseY = m.position.y; b.lit = false;
});

function drawLabels() {
  const g = labelCanvas.getContext('2d'), W = labelCanvas.width, H = labelCanvas.height;
  g.clearRect(0, 0, W, H);
  // A black panel strip like on the front of an interface
  g.fillStyle = 'rgba(10,10,10,0.92)';
  g.beginPath();
  g.roundRect(28, 330, W - 56, 240, 26);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.88)';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 30px Montserrat, Arial, sans-serif';
  g.font = '800 26px Montserrat, Arial, sans-serif';
  BUTTONS.forEach((b, i) => g.fillText(b.label, W / 2 + BX(i) * (W / 0.56), 300 + 0.095 * (H / 0.3) + 64));
  g.font = '700 24px Montserrat, Arial, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText('RYST', W / 2 + -0.16 * (W / 0.56), H / 2 + (-0.02 + 0.085) * (H / 0.3));
  g.fillText('MONITOR', W / 2 + 0.17 * (W / 0.56), H / 2 + (-0.03 + 0.098) * (H / 0.3));
  g.font = '700 46px Georgia, "Times New Roman", serif';
  g.textAlign = 'left';
  g.fillText('99', 46, 54);
  g.font = '800 20px Montserrat, Arial, sans-serif';
  g.fillText('LUCIANO · DRAW', 112, 58);
  labelTex.needsUpdate = true;
}

function setButtons(stage) {
  stageNow = stage;
  const on = {
    pick: !stage && !current && pool.length > 0 && notes.length > 0,
    reveal: stage === 'folded',
    back: stage === 'folded' || stage === 'open',
    win: stage === 'open',
    remove: stage === 'open',
    clear: stage === 'winner',
  };
  BUTTONS.forEach((b) => {
    b.lit = !!on[b.id];
    tween(250, (k) => {
      b.mat.emissiveIntensity = lerp(b.mat.emissiveIntensity, b.lit ? 0.85 : 0, k);
      b.led.material.emissiveIntensity = lerp(b.led.material.emissiveIntensity, b.lit ? 3 : 0, k);
    });
    $('a-' + b.id).disabled = !b.lit;
  });
  $('c-shake').disabled = !!current || busy;
  // The halo: green ready, amber a note on the table, white during the reveal, gold for a winner
  const halo = stage === 'folded' || stage === 'open' ? 0xffb028 : stage === 'reveal' ? 0xffffff : stage === 'winner' ? 0xffd34d : 0x3ce67a;
  gainKnob.haloMat.emissive.set(halo);
  $('lcd').textContent = stage === 'folded' ? 'SEDDEL PÅ BORDET'
    : stage === 'reveal' ? 'OG VINDEREN ER…'
      : stage === 'open' && current ? '@' + current.handle
        : stage === 'winner' && current ? 'VINDER: @' + current.handle
          : pool.length ? 'VÆLG EN SEDDEL' : 'SKÅLEN ER TOM';
  $('hint').hidden = !!current || !pool.length;
  $('empty').hidden = pool.length > 0 || !!current;
}

function pressButton(b) {
  tween(70, (k) => { b.mesh.position.y = b.baseY - 0.006 * k; }, ease.out)
    .then(() => tween(140, (k) => { b.mesh.position.y = b.baseY - 0.006 * (1 - k); }, ease.out));
  click();
}

// ---------------------------------------------------------------- camera

const SLIP_HOME = new THREE.Vector3(-0.1, TOP, 0.42);
let slipAt = SLIP_HOME.clone();
let camMode = 'overview';
const CAMS = {
  overview: () => camera.aspect < 1
    ? { target: new THREE.Vector3(0.0, TOP + 0.12, 0.05), pos: new THREE.Vector3(0.1, TOP + 1.25, 2.0) }
    : { target: new THREE.Vector3(0.15, TOP + 0.15, 0.05), pos: new THREE.Vector3(0.35, TOP + 1.55, 3.2) },
  bowl: () => ({ target: BOWL.clone().add(new THREE.Vector3(0, 0.28, 0)), pos: BOWL.clone().add(new THREE.Vector3(0.95, 0.85, 1.55)) }),
  table: () => ({ target: slipAt.clone().add(new THREE.Vector3(0, 0.01, -NOTE.d / 2)), pos: slipAt.clone().add(new THREE.Vector3(0.08, 0.34, 0.4)) }),
  top: () => ({ target: new THREE.Vector3(0.1, TOP, 0.05), pos: new THREE.Vector3(0.1, TOP + 2.9, 0.12) }),
  mixer: () => ({ target: MIXER.position.clone().add(new THREE.Vector3(0, 0.08, 0)), pos: MIXER.position.clone().add(new THREE.Vector3(-0.2, 0.5, 0.62)) }),
  low: () => ({ target: slipAt.clone().add(new THREE.Vector3(0, 0.02, -NOTE.d / 2)), pos: slipAt.clone().add(new THREE.Vector3(-0.5, 0.14, 0.62)) }),
  close: () => ({ target: slipAt.clone().add(new THREE.Vector3(0, 0, -NOTE.d / 2)), pos: slipAt.clone().add(new THREE.Vector3(0.0, 0.3, 0.2)) }),
};
let orbitT = 0;

// Portrait screens need the camera further back to show the same things
function fit(pos, target) {
  const a = camera.aspect;
  if (a >= 1.2) return pos;
  const k = Math.min(1.9, 1.2 / a * 0.7);
  return target.clone().add(pos.clone().sub(target).multiplyScalar(k));
}

function camTo(mode, ms = 1400, e = ease.inOut) {
  camMode = mode;
  document.querySelectorAll('.d3-cam').forEach((b) => b.classList.toggle('is-on', b.dataset.cam === mode));
  controls.enabled = mode === 'free';
  if (mode === 'free') { controls.target.copy(camTarget); return Promise.resolve(); }
  if (mode === 'orbit') { orbitT = Math.atan2(camera.position.x - BOWL.x, camera.position.z - BOWL.z); return Promise.resolve(); }
  const v = CAMS[mode]();
  const fromP = camera.position.clone(), fromT = camTarget.clone();
  const toP = fit(v.pos, v.target), toT = v.target;
  return tween(ms, (k) => {
    camera.position.lerpVectors(fromP, toP, k);
    camTarget.lerpVectors(fromT, toT, k);
    camera.lookAt(camTarget);
  }, e);
}

document.querySelectorAll('.d3-cam').forEach((b) => b.addEventListener('click', () => camTo(b.dataset.cam)));

// ---------------------------------------------------------------- picking and dragging

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;

function setRay(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function hitPlane(y) {
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p) ? p : null;
}
function overBowl(p) { return Math.hypot(p.x - BOWL.x, p.z - BOWL.z) < 0.5; }
function onTable(p) { return Math.abs(p.x) < TABLE.w / 2 - 0.08 && Math.abs(p.z) < TABLE.d / 2 - 0.08; }
function clampSpot(p) {
  // Somewhere free on the table: not in the bowl, not on the mixer
  const q = new THREE.Vector3(THREE.MathUtils.clamp(p.x, -1.35, 1.35), TOP, THREE.MathUtils.clamp(p.z, -0.75, 0.78));
  if (overBowl(q)) { const d = new THREE.Vector3(q.x - BOWL.x, 0, q.z - BOWL.z).normalize(); q.x = BOWL.x + d.x * 0.55; q.z = BOWL.z + d.z * 0.55; }
  const mx = q.clone().sub(MIXER.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -MIXER.rotation.y);
  if (Math.abs(mx.x) < 0.36 && Math.abs(mx.z) < 0.24) q.copy(SLIP_HOME);
  return q;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  setRay(e);
  // Mixer buttons and the knob
  const hitB = ray.intersectObjects(MIXER.children, true).find((h) => h.object.userData.button);
  if (hitB && !busy) {
    const id = hitB.object.userData.button;
    if (id === 'shake') { if (!current) shake(); return; }
    const b = BUTTONS.find((x) => x.id === id);
    if (b && b.lit) { pressButton(b); ACTIONS[id](); }
    return;
  }
  if (camMode === 'free' || current || busy || !pool.length) return;
  if (!notes.length) return;
  let m = (ray.intersectObjects(notes, false)[0] || {}).object;
  if (!m) {
    // Hit the glass (or anywhere else in the scene): take the note nearest to the bowl hit, or a random one
    const g = ray.intersectObject(grabZone, false)[0];
    if (g) {
      let best = Infinity;
      const w = new THREE.Vector3();
      notes.forEach((n) => { n.getWorldPosition(w); const d = w.distanceToSquared(g.point) - w.y * 0.5; if (d < best) { best = d; m = n; } });
    } else {
      e.preventDefault();
      drawNote();
      return;
    }
  }
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  // Lift it out of the bowl
  const world = new THREE.Vector3();
  m.getWorldPosition(world);
  bowlGroup.remove(m);
  notes.splice(notes.indexOf(m), 1);
  m.position.copy(world);
  scene.add(m);
  drag = { m, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, lifted: false, lastP: null };
  busy = true;
  const from = m.position.clone(), rot = m.rotation.clone();
  const up = new THREE.Vector3(BOWL.x, TOP + 0.95, BOWL.z);
  tween(450, (k) => {
    if (!drag) return;
    const target = drag.lastP || up;
    m.position.lerpVectors(from, target, k);
    m.position.y += Math.sin(k * Math.PI) * 0.05;
    m.rotation.set(lerp(rot.x, -0.25, k), rot.y, lerp(rot.z, 0, k));
  }, ease.out).then(() => { if (drag) drag.lifted = true; });
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 8) drag.moved = true;
  setRay(e);
  const p = hitPlane(TOP + 0.45);
  if (!p) return;
  drag.lastP = p;
  if (drag.lifted) {
    drag.m.position.lerp(p, 0.5);
    drag.m.rotation.x = -0.25;
    drag.m.rotation.z = THREE.MathUtils.clamp((p.x - drag.m.position.x) * -3, -0.4, 0.4);
  }
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  setRay(e);
  const p = hitPlane(TOP);
  // A tap picks the note; a drop over the table lays it there; over the bowl it falls back in
  setTimeout(() => {
    if (!d.moved) layDown(d.m, SLIP_HOME.clone());
    else if (p && onTable(p) && !overBowl(p)) layDown(d.m, clampSpot(p));
    else dropInBowl(d.m);
  }, d.lifted ? 0 : 460);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// TRÆK: a note rises out of the bowl by itself and lands on the table
function drawNote() {
  if (current || busy || !pool.length || !notes.length) return;
  busy = true;
  setButtons(stageNow);
  const m = notes.splice(rand(notes.length), 1)[0];
  const world = new THREE.Vector3();
  m.getWorldPosition(world);
  bowlGroup.remove(m);
  m.position.copy(world);
  scene.add(m);
  const from = m.position.clone(), rot = m.rotation.clone();
  const up = new THREE.Vector3(BOWL.x, TOP + 0.95, BOWL.z);
  tween(650, (k) => {
    m.position.lerpVectors(from, up, k);
    m.rotation.set(lerp(rot.x, -0.25, k), rot.y + k * 2, lerp(rot.z, 0, k));
  }, ease.out).then(() => layDown(m, SLIP_HOME.clone()));
}

function dropInBowl(m) {
  const target = bowlSpot(notes.length).add(BOWL);
  const from = m.position.clone();
  const peak = Math.max(from.y, TOP + 0.95);
  tween(700, (k) => {
    m.position.x = lerp(from.x, target.x, k);
    m.position.z = lerp(from.z, target.z, k);
    m.position.y = k < 0.4 ? lerp(from.y, peak, k / 0.4) : lerp(peak, target.y, (k - 0.4) / 0.6);
    m.rotation.x += 0.08; m.rotation.z += 0.05;
  }, (k) => k).then(() => {
    scene.remove(m);
    m.position.sub(BOWL);
    bowlGroup.add(m);
    notes.push(m);
    busy = false;
    setButtons(null);
  });
}

// ---------------------------------------------------------------- the draw

function pickEntry() {
  const tickets = [];
  pool.forEach((e, i) => { for (let k = 0; k < e.notes; k++) tickets.push(i); });
  const entry = pool[tickets[rand(tickets.length)]];
  return { entry, handle: entry.handles[rand(entry.handles.length)] };
}

function subline(entry, handle) {
  const others = entry.handles.filter((h) => h !== handle).concat(entry.others || []);
  return others.length ? 'Samme person som @' + others.join(', @')
    : entry.notes > 1 ? '2 sedler · stemte og delte på story' : entry.repost_only ? 'Delte på story · har ikke stemt' : '';
}

let slip = null;
function layDown(m, spot) {
  const { entry, handle } = pickEntry();
  slipAt = spot.clone();
  const from = m.position.clone(), r0 = m.rotation.clone();
  const yaw = (Math.random() - 0.5) * 0.3;
  const peak = Math.max(from.y, TOP + 0.6);
  if (camMode !== 'free' && camMode !== 'orbit') camTo('table', 1500);
  return tween(900, (k) => {
    m.position.x = lerp(from.x, spot.x, k);
    m.position.z = lerp(from.z, spot.z, k);
    m.position.y = lerp(from.y, peak, Math.sin(Math.min(1, k * 1.6) * Math.PI / 2)) * (1 - ease.in(k)) + (TOP + NOTE.t / 2) * ease.in(k);
    m.rotation.set(lerp(r0.x, 0, k), lerp(r0.y, yaw, k), lerp(r0.z, 0, k));
  }, ease.inOut).then(() => {
    // Swap the plain note for the slip that can open
    scene.remove(m);
    slip = makeSlip();
    slip.position.set(spot.x, TOP + 0.0005, spot.z - NOTE.d / 2);
    slip.rotation.y = yaw;
    scene.add(slip);
    drawSlip('@' + handle, subline(entry, handle), 30, false);
    current = { entry, handle, slip };
    busy = false;
    setButtons('folded');
  });
}

function setHinge(deg, ms, e) {
  const h = slip.userData.hinge, from = h.rotation.x, to = THREE.MathUtils.degToRad(deg);
  return tween(ms, (k) => { h.rotation.x = lerp(from, to, k); }, e || ease.inOut);
}

// The reveal: quick, or the cinematic one (~13 s)
async function reveal() {
  if (!current || busy) return;
  busy = true;
  const c = current;
  const name = '@' + c.handle, sub = subline(c.entry, c.handle);
  if (!cinema) {
    drawSlip(name, sub, 0, false);
    await setHinge(0, 900, ease.back);
    busy = false;
    setButtons('open');
    return;
  }
  setButtons('reveal');
  $('skip').hidden = false;
  let skipped = false;
  const score = sound && window.DrawCinema && DrawCinema.score ? (() => { try { return DrawCinema.score(11000); } catch (e) { return null; } })() : null;
  const steps = [];
  const at = (ms, fn) => steps.push(setTimeout(() => { if (!skipped) fn(); }, ms));
  const blurTo = (from, to, ms) => tween(ms, (k) => drawSlip(name, sub, lerp(from, to, k), false), (k) => k);
  stagelight.target.position.copy(slipAt);
  stagelight.position.set(slipAt.x + 0.3, TOP + 2.6, slipAt.z + 0.9);

  // Dim the room, light the slip
  tween(1200, (k) => {
    key.intensity = lerp(34, 7, k);
    hemi.intensity = lerp(0.35, 0.06, k);
    scene.environmentIntensity = lerp(0.42, 0.1, k);
    stagelight.intensity = lerp(0, 7, k);
  });
  camTo('low', 2600);
  at(1000, () => { $('caption').classList.add('is-on'); setHinge(162, 1300); });
  at(2500, () => setHinge(178, 500, ease.in));                 // a tease: it falls shut again
  at(3300, () => { setHinge(138, 1600); drawSlip(name, sub, 26, false); camTo('table', 3000); });
  at(5100, () => { setHinge(104, 1500); blurTo(26, 18, 1500); });
  at(6800, () => { setHinge(58, 1900); blurTo(18, 12, 1900); camTo('close', 3800); });
  at(8900, () => { setHinge(0, 1700, ease.back); blurTo(12, 6, 1400); });
  at(10300, () => { blurTo(6, 2, 700); $('caption').classList.remove('is-on'); });
  at(11000, () => {
    drawSlip(name, sub, 0, false);
    flash();
    tween(700, (k) => { stagelight.intensity = lerp(20, 7, k); }, ease.out);
    // a little camera punch
    const p0 = camera.position.clone(), dir = camTarget.clone().sub(p0).multiplyScalar(0.12);
    tween(180, (k) => camera.position.copy(p0).addScaledVector(dir, k), ease.out)
      .then(() => tween(500, (k) => camera.position.copy(p0).addScaledVector(dir, 1 - k), ease.out));
  });
  await new Promise((resolve) => {
    at(12600, resolve);
    $('skip').onclick = () => {
      skipped = true;
      steps.forEach(clearTimeout);
      tweens.length = 0;
      if (score) score.stop();
      drawSlip(name, sub, 0, false);
      slip.userData.hinge.rotation.x = 0;
      $('caption').classList.remove('is-on');
      camTo('close', 600);
      resolve();
    };
  });
  $('skip').hidden = true;
  tween(1500, (k) => {
    key.intensity = lerp(key.intensity, 34, k);
    hemi.intensity = lerp(hemi.intensity, 0.35, k);
    scene.environmentIntensity = lerp(scene.environmentIntensity, 0.42, k);
    stagelight.intensity = lerp(stagelight.intensity, 3, k);
  });
  if (score) setTimeout(() => score.stop(), 2500);
  busy = false;
  setButtons('open');
}

function flash() {
  const f = $('flash');
  f.classList.remove('is-on');
  void f.offsetWidth;
  f.classList.add('is-on');
}

async function putBack() {
  if (!current || busy) return;
  busy = true;
  const s = current.slip;
  await setHinge(180, 600);
  scene.remove(s);
  const m = makeNoteMesh();
  m.position.set(s.position.x, TOP + NOTE.t / 2, s.position.z + NOTE.d / 2);
  m.rotation.y = s.rotation.y;
  scene.add(m);
  current = null; slip = null;
  stagelight.intensity = 0;
  if (camMode === 'table' || camMode === 'close' || camMode === 'low') camTo('bowl', 1300);
  dropInBowl(m);
}

async function removeCurrent() {
  if (!current || busy) return;
  const c = current;
  busy = true;
  try { await setState(c.handle, 1); } catch (e) { busy = false; note(e.message); return; }
  takeOut(c.entry);
  note('@' + c.handle + ' er fjernet fra konkurrencen.');
  // Crumple it and drop it off the edge of the table
  const s = c.slip, from = s.position.clone(), edge = new THREE.Vector3(from.x, TOP, TABLE.d / 2 + 0.25);
  await tween(450, (k) => { s.scale.setScalar(lerp(1, 0.35, k)); s.rotation.x = k * 2; s.rotation.z = k * 1.4; }, ease.in);
  await tween(700, (k) => {
    s.position.x = lerp(from.x, edge.x, k);
    s.position.z = lerp(from.z, edge.z, k);
    s.position.y = from.y + 0.05 * Math.sin(k * Math.PI) - (k > 0.6 ? (k - 0.6) * 2.4 : 0);
    s.rotation.x += 0.15;
  }, (k) => k);
  scene.remove(s);
  current = null; slip = null;
  stagelight.intensity = 0;
  busy = false;
  refreshLists();
  setButtons(null);
  if (camMode !== 'free' && camMode !== 'orbit') camTo('overview', 1400);
}

async function winCurrent() {
  if (!current || busy) return;
  const c = current;
  busy = true;
  try { await setState(c.handle, 2); } catch (e) { busy = false; note(e.message); return; }
  takeOut(c.entry);
  drawSlip('@' + c.handle, subline(c.entry, c.handle), 0, true);
  confetti();
  flash();
  note('@' + c.handle + ' har vundet!');
  busy = false;
  refreshLists();
  setButtons('winner');
}

async function clearTable() {
  if (!current || busy) return;
  busy = true;
  const s = current.slip, from = s.position.clone();
  await tween(700, (k) => { s.position.x = lerp(from.x, from.x + 1.8, k); s.rotation.y += 0.04; }, ease.in);
  scene.remove(s);
  current = null; slip = null;
  stagelight.intensity = 0;
  busy = false;
  setButtons(null);
  if (camMode !== 'free' && camMode !== 'orbit') camTo('overview', 1400);
}

function takeOut(entry) {
  const i = pool.indexOf(entry);
  if (i >= 0) pool.splice(i, 1);
  // The note on the table is already out; their extra note leaves the bowl too
  const keep = Math.min(MAX_NOTES, noteCount());
  let extra = Math.max(0, notes.length - keep);
  while (extra-- > 0 && notes.length) {
    const m = notes.splice(rand(notes.length), 1)[0];
    tween(500, (k) => m.scale.setScalar(1 - k), ease.in).then(() => bowlGroup.remove(m));
  }
  updateCount();
}

async function shake() {
  if (busy) return;
  busy = true;
  setButtons(stageNow);
  click();
  const turn0 = gainKnob.turn.rotation.y;
  tween(900, (k) => { gainKnob.turn.rotation.y = turn0 - Math.sin(k * Math.PI) * 1.6; });
  const olds = notes.map((m) => ({ m, p: m.position.clone(), r: m.rotation.clone() }));
  const news = notes.map((m, i) => { const t = makeNoteMesh(); settle(t, i); return { p: t.position.clone(), r: t.rotation.clone() }; });
  await tween(1000, (k) => {
    bowlGroup.rotation.z = Math.sin(k * Math.PI * 6) * 0.06 * (1 - k);
    bowlGroup.rotation.x = Math.cos(k * Math.PI * 5) * 0.04 * (1 - k);
    olds.forEach((o, i) => {
      o.m.position.lerpVectors(o.p, news[i].p, k);
      o.m.position.y += Math.sin(k * Math.PI) * (0.08 + (i % 5) * 0.02);
      o.m.rotation.set(lerp(o.r.x, news[i].r.x, k), lerp(o.r.y, news[i].r.y, k), lerp(o.r.z, news[i].r.z, k));
    });
  }, (k) => k);
  bowlGroup.rotation.set(0, 0, 0);
  busy = false;
  setButtons(stageNow);
}

// 3D confetti over the table
const confettiGeo = new THREE.PlaneGeometry(0.018, 0.028);
function confetti() {
  const colors = [0xffffff, 0xf4eddc, 0xd4af37, 0xc41a24, 0xbdbdbd];
  const bits = [];
  for (let i = 0; i < 220; i++) {
    const m = new THREE.Mesh(confettiGeo, new THREE.MeshStandardMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, roughness: 0.6 }));
    m.position.set(slipAt.x + (Math.random() - 0.5) * 1.6, TOP + 1.2 + Math.random() * 0.8, slipAt.z + (Math.random() - 0.5) * 1.2);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.004, -0.004 - Math.random() * 0.006, (Math.random() - 0.5) * 0.004);
    m.userData.s = new THREE.Vector3(Math.random() * 0.2, Math.random() * 0.2, Math.random() * 0.2);
    scene.add(m);
    bits.push(m);
  }
  tween(4200, () => {
    bits.forEach((m) => {
      if (m.position.y > TOP + 0.003) {
        m.position.add(m.userData.v);
        m.position.x += Math.sin(performance.now() / 300 + m.id) * 0.0015;
        m.rotation.x += m.userData.s.x; m.rotation.y += m.userData.s.y; m.rotation.z += m.userData.s.z;
      } else {
        m.rotation.x = -Math.PI / 2;
      }
    });
  }, (k) => k).then(() => tween(1200, (k) => bits.forEach((m) => { m.material.transparent = true; m.material.opacity = 1 - k; })))
    .then(() => bits.forEach((m) => { scene.remove(m); m.material.dispose(); }));
}

// A soft click for the buttons
let clickCtx = null;
function click() {
  if (!sound) return;
  try {
    clickCtx = clickCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = clickCtx.currentTime, o = clickCtx.createOscillator(), g = clickCtx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(600, t + 0.03);
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(clickCtx.destination);
    o.start(t); o.stop(t + 0.06);
  } catch (e) {}
}

const ACTIONS = { pick: drawNote, reveal, back: putBack, win: winCurrent, remove: removeCurrent, clear: clearTable };
BUTTONS.forEach((b) => $('a-' + b.id).addEventListener('click', () => { if (b.lit && !busy) { pressButton(b); ACTIONS[b.id](); } }));
$('c-shake').addEventListener('click', () => { if (!current) shake(); });

// ---------------------------------------------------------------- loading, lists, switches

function updateCount() {
  const n = noteCount();
  $('d-count').textContent = n + (n === 1 ? ' seddel' : ' sedler') + ' · ' + pool.length + (pool.length === 1 ? ' deltager' : ' deltagere');
  $('fs-count').textContent = $('d-count').textContent;
}

function load() {
  document.body.classList.toggle('is-demo', demo);
  return getPool().then((d) => {
    pool = d.pool;
    renderBowl();
    renderLists(d);
    updateCount();
    note(demo ? 'Prøv løs: træk sedler, åbn, fjern og vælg vindere. Slå Demo fra for den rigtige skål.'
      : !pool.length ? (onlyFollowers && d.votes && !d.followers
        ? 'Ingen er markeret som følger endnu. Tjek følgere under Afstemning, eller slå "Kun følgere" fra.' : 'Skålen er tom.')
        : (onlyFollowers ? 'Kun dem, du har markeret som følgere, er i skålen.' : 'Alle, der har stemt, er i skålen.') +
          ' Stemt + godkendt story = 2 sedler. Godkendt repost uden stemme = 1 seddel.');
    $('empty-text').textContent = onlyFollowers && d.votes
      ? 'Kun dem, du har markeret som følgere, kommer i skålen' + (d.followers ? ', og de er allerede trukket eller fjernet.' : ', og ingen er markeret endnu.')
      : d.votes ? 'Alle er allerede trukket eller fjernet.' : 'Ingen har stemt endnu.';
    $('empty-all').hidden = !onlyFollowers || !d.votes;
    if (!current) setButtons(null);
  }, (e) => note(e.message));
}
function refreshLists() { getPool().then(renderLists, () => {}); }

function renderLists(d) {
  $('w-count').textContent = 'Vindere · ' + d.winners.length;
  $('r-count').textContent = 'Fjernet · ' + d.removed.length;
  list($('winners'), d.winners, 'Fortryd', 'Vinder');
  list($('removed'), d.removed, 'Læg i skålen igen', 'Ikke i live');
}
function list(box, rows, undo, what) {
  box.innerHTML = '';
  if (!rows.length) box.appendChild(Admin.el('p', 'step__note', 'Ingen endnu.'));
  rows.forEach((r) => {
    const row = Admin.el('div', 'm-voter m-repost is-ok');
    const a = Admin.el('a', null, '@' + r.handles.join(', @'));
    a.href = 'https://instagram.com/' + encodeURIComponent(r.handles[0]);
    a.target = '_blank'; a.rel = 'noopener';
    row.appendChild(a);
    const b = Admin.el('button', 'm-mini', undo);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (current) { note('Ryd bordet først.'); return; }
      b.disabled = true;
      setState(r.handles[0], 0).then(load, (e) => { b.disabled = false; note(e.message); });
    });
    row.appendChild(b);
    row.appendChild(Admin.el('small', null, what));
    box.appendChild(row);
  });
}

function chip(id, on) { $(id).classList.toggle('is-on', on); $(id).setAttribute('aria-pressed', String(on)); }
chip('d-demo', demo); chip('d-cinema', cinema); chip('d-sound', sound);
$('d-sound').hidden = !cinema;
$('d-demo').addEventListener('click', () => {
  if (current) { note('Ryd bordet først.'); return; }
  demo = !demo; demoOut = {};
  chip('d-demo', demo);
  history.replaceState(null, '', location.pathname + (demo ? '?demo' : ''));
  load();
});
$('empty-all').addEventListener('click', () => { if (onlyFollowers) $('d-followers').click(); });
$('empty-demo').addEventListener('click', () => { if (!demo) $('d-demo').click(); });
$('d-followers').addEventListener('click', () => {
  if (current) { note('Ryd bordet først.'); return; }
  onlyFollowers = !onlyFollowers;
  chip('d-followers', onlyFollowers);
  load();
});
$('d-cinema').addEventListener('click', () => { cinema = !cinema; setPref('cinema', cinema); chip('d-cinema', cinema); $('d-sound').hidden = !cinema; });
$('d-sound').addEventListener('click', () => { sound = !sound; setPref('sound', sound); chip('d-sound', sound); });

// Full screen for the Instagram Live
function setFocus(on) {
  document.body.classList.toggle('is-focus', on);
  const root = document.documentElement;
  try {
    if (on && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    else if (!on && document.fullscreenElement) document.exitFullscreen();
  } catch (e) {}
  if (on) window.scrollTo(0, 0);
  setTimeout(resize, 60);
}
$('d-focus').addEventListener('click', () => setFocus(true));
$('fs-close').addEventListener('click', () => setFocus(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('is-focus')) setFocus(false);
  // Keyboard shortcuts for the live: Space/Enter opens, W winner, R remove, B back, C clear, S shake
  if (e.target.closest && e.target.closest('input, textarea')) return;
  let k = { ' ': 'reveal', enter: 'reveal', t: 'pick', w: 'win', r: 'remove', b: 'back', c: 'clear' }[e.key.toLowerCase()];
  if ((k === 'reveal') && !current) k = 'pick';
  if (k) { const b = BUTTONS.find((x) => x.id === k); if (b && b.lit && !busy) { e.preventDefault(); pressButton(b); ACTIONS[k](); } }
  if (e.key.toLowerCase() === 's' && !current) shake();
});
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('is-focus')) setFocus(false); });

// ---------------------------------------------------------------- render loop

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(1, r.width), h = Math.max(1, r.height);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // Upright screen: bring the mixer to the front of the table so it's in the picture
  const portrait = camera.aspect < 1;
  MIXER.position.set(portrait ? 0.26 : 0.95, TOP, portrait ? 0.6 : 0.42);
  MIXER.rotation.y = portrait ? -0.12 : -0.42;
  SLIP_HOME.set(portrait ? -0.3 : -0.1, TOP, portrait ? 0.3 : 0.42);
  if (camMode !== 'free' && camMode !== 'orbit' && !busy) {
    const v = CAMS[camMode]();
    camera.position.copy(fit(v.pos, v.target));
    camTarget.copy(v.target);
    camera.lookAt(camTarget);
  }
}
new ResizeObserver(resize).observe(canvas.parentElement);

let running = true;
document.addEventListener('visibilitychange', () => { running = document.visibilityState === 'visible'; if (running) requestAnimationFrame(frame); });
function frame(now) {
  if (!running) return;
  runTweens(now);
  if (camMode === 'free') controls.update();
  else if (camMode === 'orbit') {
    orbitT += 0.0025;
    const r = 2.1 * (camera.aspect < 1.2 ? Math.min(2.2, 1.2 / camera.aspect * 0.82) : 1);
    camera.position.set(BOWL.x + Math.sin(orbitT) * r, TOP + 0.9, BOWL.z + Math.cos(orbitT) * r);
    camTarget.set(BOWL.x, TOP + 0.3, BOWL.z);
    camera.lookAt(camTarget);
  }
  // The white button breathes while it's the one to press
  const b0 = BUTTONS[0];
  if (b0.lit && !busy) b0.mat.emissiveIntensity = 0.55 + Math.sin(now / 280) * 0.3;
  if (stageNow === 'reveal') gainKnob.haloMat.emissiveIntensity = 1.6 + Math.sin(now / 120) * 1.2;
  else gainKnob.haloMat.emissiveIntensity = 1.6;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- start

(document.fonts && document.fonts.load ? document.fonts.load('800 60px Montserrat').catch(() => {}) : Promise.resolve()).then(() => {
  drawLabels();
  drawSlip('', '', 0, false);
});
resize();
camTo('overview', 1);
requestAnimationFrame(frame);
Admin.start(() => {
  load().then(() => {
    $('loading').hidden = true;
    resize();
  });
});
