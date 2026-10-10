import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_STEM, generateStem } from './trunk.mjs';

const byId = id => document.getElementById(id);
const sliders = [...document.querySelectorAll('[data-key]')];
const params = { ...DEFAULT_STEM };
let renderer, camera, scene, controls, stem, spinning = false, silhouette = false;
let pending = 0;

function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18272a);
  scene.fog = new THREE.Fog(0x18272a, 24, 70);
  camera = new THREE.PerspectiveCamera(38, 1, .04, 130);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.55;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  byId('viewport').append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xc9d3cc, 0x6c6254, 2.1));
  const sun = new THREE.DirectionalLight(0xf8e4c8, 3);
  sun.position.set(-6, 12, 7); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -10; sun.shadow.camera.right = 10;
  sun.shadow.camera.top = 13; sun.shadow.camera.bottom = -10;
  sun.shadow.camera.near = .1; sun.shadow.camera.far = 40;
  sun.shadow.bias = -.0003;
  scene.add(sun);
  const side = new THREE.DirectionalLight(0xa8b9cd, 1.0);
  side.position.set(7, 4, -8); scene.add(side);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(65, 65),
    new THREE.MeshStandardMaterial({ color: 0x26342e, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -.065;
  ground.receiveShadow = true;
  scene.add(ground);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .075;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = Math.PI * .87;
  controls.minDistance = .6;
  controls.maxDistance = 55;
  controls.addEventListener('start', () => {
    spinning = false;
    byId('turntable').setAttribute('aria-pressed', 'false');
  });
  const resize = () => {
    const el = byId('viewport');
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(byId('viewport'));
  resize();
  const animate = () => {
    requestAnimationFrame(animate);
    if (spinning && stem) stem.rotation.y += .003;
    controls.update();
    renderer.render(scene, camera);
  };
  animate();
}
function focus(part) {
  const h = params.height;
  if (part === 'foot') {
    controls.target.set(0, .85, 0);
    camera.position.set(2.45, 1.9, 3.85);
  } else if (part === 'tip') {
    // Frame the generated endpoint, not a guessed world-space vertical axis.
    const positions = stem?.geometry.getAttribute('position');
    const last = positions ? positions.count - 1 : -1;
    const tip = last >= 0
      ? new THREE.Vector3(positions.getX(last), positions.getY(last), positions.getZ(last))
        .applyQuaternion(stem.quaternion)
      : new THREE.Vector3(0, h, 0);
    controls.target.set(tip.x, tip.y - .65, tip.z);
    camera.position.set(tip.x + 2.25, tip.y + .45, tip.z + 3.5);
  } else {
    // Include the sideways leader in the initial frame, while preserving
    // the current orbit when tweaking parameters.
    const tip = stem?.geometry.getAttribute('position');
    const apexIndex = tip ? tip.count - 1 : -1;
    const topX = apexIndex >= 0 ? tip.getX(apexIndex) : 0;
    const topZ = apexIndex >= 0 ? tip.getZ(apexIndex) : 0;
    controls.target.set(topX * .44, h * .52, topZ * .44);
    camera.position.set(topX * .44 + h * .25, h * .70,
      topZ * .44 + h * 1.25);
  }
  controls.update();
}
function build() {
  try {
    const t0 = performance.now(), generated = generateStem(params);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(generated.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(generated.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(generated.indices, 1));
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      color: 0xa49c8e, roughness: .93, metalness: 0, side: THREE.FrontSide,
    });
    const model = new THREE.Mesh(geometry, material);
    model.castShadow = true;
    model.receiveShadow = true;
    model.material.color.setHex(silhouette ? 0x050909 : 0xa49c8e);
    if (stem) {
      scene.remove(stem);
      stem.geometry.dispose();
      stem.material.dispose();
    }
    stem = model;
    scene.add(stem);
    byId('seedValue').value = String(params.seed);
    byId('meshStats').textContent = (generated.indices.length / 3).toLocaleString() + ' TRIS';
    byId('status').textContent = 'Geometry ready · ' + Math.round(performance.now() - t0) + ' ms';
    byId('error').hidden = true;
  } catch (e) {
    byId('status').textContent = 'Generation failed';
    byId('error').hidden = false;
    byId('error').textContent = e.message;
    console.error(e);
  }
}
function display() {
  for (const slider of sliders) {
    const key = slider.dataset.key;
    slider.value = params[key];
    byId(key + 'Value').textContent = key === 'height' || key === 'radius'
      ? params[key].toFixed(2) + ' m'
      : key === 'lean' ? (params[key] >= 0 ? '+' : '') + params[key].toFixed(2)
      : Math.round(params[key] * 100) + '%';
  }
  byId('seedValue').value = String(params.seed);
}
function queue() {
  clearTimeout(pending);
  pending = setTimeout(() => { pending = 0; build(); }, 90);
}
for (const slider of sliders) slider.addEventListener('input', () => {
  const key = slider.dataset.key;
  params[key] = Number(slider.value);
  if (params.radius / params.height > .14) {
    params.radius = Math.min(params.radius, params.height * .14);
  }
  display();
  queue();
});
byId('seedValue').addEventListener('change', () => {
  const value = Number(byId('seedValue').value);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff ||
      byId('seedValue').value.trim() === '') {
    byId('status').textContent = 'Seed must be an integer between 0 and 4294967295';
    byId('seedValue').value = String(params.seed);
    return;
  }
  params.seed = value;
  display();
  queue();
});
byId('reseed').addEventListener('click', () => {
  params.seed = crypto.getRandomValues(new Uint32Array(1))[0];
  display();
  queue();
});
byId('reset').addEventListener('click', () => {
  Object.assign(params, DEFAULT_STEM);
  display();
  build();
  focus('whole');
});
byId('whole').addEventListener('click', () => focus('whole'));
byId('foot').addEventListener('click', () => focus('foot'));
byId('tip').addEventListener('click', () => focus('tip'));
byId('silhouette').addEventListener('click', () => {
  silhouette = !silhouette;
  byId('silhouette').setAttribute('aria-pressed', String(silhouette));
  if (stem) stem.material.color.setHex(silhouette ? 0x050909 : 0xa49c8e);
  scene.background.setHex(silhouette ? 0xaab9b0 : 0x18272a);
  scene.fog.color.setHex(silhouette ? 0xaab9b0 : 0x18272a);
});
byId('turntable').addEventListener('click', () => {
  spinning = !spinning;
  byId('turntable').setAttribute('aria-pressed', String(spinning));
});
try { display(); setupScene(); build(); focus('whole'); } catch (e) {
  byId('error').hidden = false;
  byId('error').textContent = e.message;
  byId('status').textContent = 'Viewport initialization failed';
  console.error(e);
}
