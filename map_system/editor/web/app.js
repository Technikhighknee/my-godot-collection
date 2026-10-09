import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTerrainGeometry, makeVertexColors, paletteColor, sampleHeight, surfaceAt } from './mesh-data.mjs';

const el = id => document.getElementById(id);
const viewport = el('viewport');
const loading = el('loading');
const layerNames = ['surfaces', 'wireframe', 'roads', 'water', 'settlements', 'entities'];
let renderer;
let controls;
let camera;
let target;
let terrain;
let scene;
let terrainMesh;
let primaryMaterial;
let roadGroup;
let waterGroup;
let settlementGroup;
let entitiesGroup;
let wireMaterial;
let currentDoc;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

async function fetchResource(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}
function decodeFloats(bytes) {
  if (bytes.byteLength % 4) throw new Error('Invalid float buffer length');
  const view = new DataView(bytes);
  const result = new Float32Array(bytes.byteLength / 4);
  for (let i = 0; i < result.length; i++) result[i] = view.getFloat32(i * 4, true);
  return result;
}
async function getDocument() {
  const [meta, heights, surfaces] = await Promise.all([
    fetchResource('/api/map').then(r => r.json()),
    fetchResource('/api/heights').then(r => r.arrayBuffer()),
    fetchResource('/api/surfaces').then(r => r.arrayBuffer()),
  ]);
  if (meta.readOnly !== true) throw new Error('Expected a read-only map server');
  if (meta.height.width * meta.height.height * 4 !== heights.byteLength) throw new Error('Heightmap byte length mismatch');
  if (meta.surface.width * meta.surface.height !== surfaces.byteLength) throw new Error('Surface map byte length mismatch');
  if (meta.surface.width !== meta.height.width - 1 || meta.surface.height !== meta.height.height - 1) throw new Error('Surface grid does not match height grid');
  return { map: meta.map, height: { ...meta.height, data: decodeFloats(heights) }, surface: { ...meta.surface, data: new Uint8Array(surfaces) } };
}

function createMeshGeometry(geo) {
  const buffer = new THREE.BufferGeometry();
  buffer.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
  buffer.setIndex(new THREE.BufferAttribute(geo.indices, 1));
  buffer.computeVertexNormals();
  buffer.computeBoundingSphere();
  return buffer;
}
function createRoadMesh(road, map, height) {
  const points = road.points;
  const nodes = [];
  const segmentNormals = points.slice(1).map(([x, z], i) => {
    const dx = x - points[i][0], dz = z - points[i][1], dist = Math.hypot(dx, dz);
    return [-dz / dist, dx / dist];
  });
  const normals = points.map((_, i) => {
    const before = segmentNormals[Math.max(0, i - 1)], after = segmentNormals[Math.min(segmentNormals.length - 1, i)];
    const nx = before[0] + after[0], nz = before[1] + after[1];
    const length = Math.hypot(nx, nz);
    // Valid backtracking roads can have a 180-degree turn. No NaNs or infinite miters.
    if (length < 1e-8) return after;
    const ux = nx / length, uz = nz / length;
    const factor = Math.min(2, 1 / Math.max(0.5, ux * after[0] + uz * after[1]));
    return [ux * factor, uz * factor];
  });
  const minSpacing = Math.min(map.terrain.size[0] / (height.width - 1), map.terrain.size[1] / (height.height - 1));
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (minSpacing * 0.7)));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      // Use the exact centerline, with an approximate round-miter ribbon to show width.
      const nx = normals[i][0] * (1 - t) + normals[i + 1][0] * t;
      const nz = normals[i][1] * (1 - t) + normals[i + 1][1] * t;
      const magnitude = Math.max(1e-5, Math.hypot(nx, nz));
      nodes.push([a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, nx / magnitude, nz / magnitude]);
    }
  }
  nodes.push([points.at(-1)[0], points.at(-1)[1], normals.at(-1)[0], normals.at(-1)[1]]);
  const vertices = new Float32Array(nodes.length * 6);
  const indices = new Uint32Array((nodes.length - 1) * 6);
  for (let i = 0; i < nodes.length; i++) {
    const [x, z, nx, nz] = nodes[i];
    for (let s = 0; s < 2; s++) {
      const sign = s === 0 ? -1 : 1;
      const px = Math.min(map.terrain.size[0], Math.max(0, x + nx * sign * road.width * 0.5));
      const pz = Math.min(map.terrain.size[1], Math.max(0, z + nz * sign * road.width * 0.5));
      const base = i * 6 + s * 3;
      vertices[base] = px;
      vertices[base + 1] = sampleHeight(map.terrain, height, px, pz) + 0.065;
      vertices[base + 2] = pz;
    }
    if (i < nodes.length - 1) {
      const a = i * 2, b = a + 2, p = i * 6;
      indices[p] = a; indices[p + 1] = a + 1; indices[p + 2] = b;
      indices[p + 3] = b; indices[p + 4] = a + 1; indices[p + 5] = b + 1;
    }
  }
  return new THREE.Mesh(createMeshGeometry({ positions: vertices, indices }), new THREE.MeshStandardMaterial({ color: 0x6b5844, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
}
function buildWater(water) {
  const outline = new THREE.Shape();
  water.polygon.forEach(([x, z], i) => i ? outline.lineTo(x, z) : outline.moveTo(x, z));
  outline.closePath();
  const geo = new THREE.ShapeGeometry(outline);
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x39778a, transparent: true, opacity: 0.88, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide, depthWrite: true }));
  mesh.position.y = water.height + 0.025;
  return mesh;
}
function makeBuildOutline(points, map, height, color) {
  const coords = points.map(([x, z]) => new THREE.Vector3(x, sampleHeight(map.terrain, height, x, z) + 0.28, z));
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(coords), new THREE.LineBasicMaterial({ color, depthTest: true }));
}
function buildEntity(entity, map, height, color) {
  const geometry = new THREE.ConeGeometry(1.65, 4.5, 5);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8, emissive: color, emissiveIntensity: 0.08 });
  const marker = new THREE.Mesh(geometry, material);
  marker.position.set(entity.position[0], sampleHeight(map.terrain, height, ...entity.position) + 2.5, entity.position[1]);
  marker.rotation.y = entity.rotation * Math.PI / 180;
  marker.userData.mapId = entity.id;
  return marker;
}

function setLayerVisibility() {
  if (!terrainMesh) return;
  primaryMaterial.vertexColors = el('surfaces').checked;
  primaryMaterial.color.set(el('surfaces').checked ? 0xffffff : 0x9da9a2);
  primaryMaterial.needsUpdate = true;
  wireMaterial.visible = el('wireframe').checked;
  roadGroup.visible = el('roads').checked;
  waterGroup.visible = el('water').checked;
  settlementGroup.visible = el('settlements').checked;
  entitiesGroup.visible = el('entities').checked;
}
function configureDetails(doc) {
  const { map, height } = doc;
  document.title = `${map.name} · 1400 Map Editor`;
  el('mapName').textContent = map.name;
  el('panelName').textContent = map.name;
  el('sizeStat').textContent = `${map.terrain.size[0]} × ${map.terrain.size[1]} m`;
  el('gridStat').textContent = `${height.width} × ${height.height}`;
  el('elevationStat').textContent = `${map.terrain.min_height} to ${map.terrain.max_height} m`;
  el('surfaceStat').textContent = String(map.terrain.surface_palette.length);
  el('roadsCount').textContent = String(map.roads.length);
  el('waterCount').textContent = String(map.water.length);
  el('settlementsCount').textContent = String(map.settlements.reduce((n, item) => n + item.build_areas.length, 0));
  el('entitiesCount').textContent = String(map.buildings.length + map.objects.length);
  for (const definition of map.terrain.surface_palette) {
    const label = document.createElement('div'); label.className = 'legend-line';
    const swatch = document.createElement('span'); swatch.className = 'swatch';
    swatch.style.backgroundColor = `rgb(${paletteColor(definition).map(n => Math.round(n * 255)).join(',')})`;
    const name = document.createElement('span'); name.textContent = definition;
    label.append(swatch, name); el('palette').append(label);
  }
}
function resetCamera() {
  const [sx, sz] = currentDoc.map.terrain.size;
  target.set(sx * 0.5, sampleHeight(currentDoc.map.terrain, currentDoc.height, sx * 0.5, sz * 0.5), sz * 0.5);
  const span = Math.max(sx, sz);
  camera.position.set(target.x + span * 0.77, target.y + span * 0.82, target.z + span * 1.05);
  controls.target.copy(target);
  controls.update();
}
function updateCompass() {
  const center = controls.target.clone().project(camera);
  const north = controls.target.clone().add(new THREE.Vector3(0, 0, -10)).project(camera);
  const angle = Math.atan2(north.x - center.x, north.y - center.y) * 180 / Math.PI;
  el('compass').querySelector('span').style.transform = `rotate(${angle}deg)`;
}
function initScene(doc) {
  const { map, height, surface } = doc;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x121a20);
  scene.fog = new THREE.FogExp2(0x121a20, 0.00085);
  camera = new THREE.PerspectiveCamera(52, 1, 0.2, Math.max(...map.terrain.size) * 16);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  viewport.prepend(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2;
  controls.maxDistance = Math.max(...map.terrain.size) * 4;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.screenSpacePanning = true;
  target = new THREE.Vector3();
  scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x655a47, 2.0));
  const sun = new THREE.DirectionalLight(0xffedd6, 2.5);
  sun.position.set(-130, 320, -240);
  scene.add(sun);
  const geo = createMeshGeometry(buildTerrainGeometry(map.terrain, height));
  geo.setAttribute('color', new THREE.BufferAttribute(makeVertexColors(map.terrain, height, surface, map.terrain.surface_palette), 3));
  primaryMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.FrontSide });
  terrainMesh = new THREE.Mesh(geo, primaryMaterial);
  terrainMesh.name = 'Terrain';
  scene.add(terrainMesh);
  wireMaterial = new THREE.MeshBasicMaterial({ color: 0x151f23, wireframe: true, transparent: true, opacity: 0.28, depthWrite: false });
  const wireMesh = new THREE.Mesh(geo, wireMaterial);
  wireMesh.renderOrder = 2;
  scene.add(wireMesh);
  roadGroup = new THREE.Group();
  for (const road of map.roads) roadGroup.add(createRoadMesh(road, map, height));
  scene.add(roadGroup);
  waterGroup = new THREE.Group();
  for (const water of map.water) waterGroup.add(buildWater(water));
  scene.add(waterGroup);
  settlementGroup = new THREE.Group();
  for (const settlement of map.settlements) for (const area of settlement.build_areas) settlementGroup.add(makeBuildOutline(area, map, height, 0xe9bd74));
  scene.add(settlementGroup);
  entitiesGroup = new THREE.Group();
  for (const entity of map.buildings) entitiesGroup.add(buildEntity(entity, map, height, 0xe9ba6c));
  for (const entity of map.objects) entitiesGroup.add(buildEntity(entity, map, height, 0x82bdc7));
  scene.add(entitiesGroup);
  resetCamera();
  setLayerVisibility();
  const resize = () => {
    const { width, height: viewportHeight } = viewport.getBoundingClientRect();
    if (!width || !viewportHeight) return;
    camera.aspect = width / viewportHeight; camera.updateProjectionMatrix();
    renderer.setSize(width, viewportHeight, false);
  };
  new ResizeObserver(resize).observe(viewport);
  resize();
  let last = 0;
  renderer.domElement.addEventListener('pointermove', ev => {
    const now = performance.now(); if (now - last < 45) return; last = now;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((ev.clientX - rect.left) / rect.width * 2 - 1, -((ev.clientY - rect.top) / rect.height * 2 - 1));
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(terrainMesh, false)[0];
    if (!hit) { el('probe').textContent = 'OUTSIDE TERRAIN'; return; }
    const { x, z } = hit.point;
    const definition = map.terrain.surface_palette[surfaceAt(map.terrain, surface, x, z)];
    el('probe').textContent = `X ${x.toFixed(1)} · Z ${z.toFixed(1)} · H ${sampleHeight(map.terrain, height, x, z).toFixed(2)} m · ${definition}`;
  });
  renderer.domElement.addEventListener('pointerleave', () => { el('probe').textContent = 'MOVE CURSOR OVER TERRAIN'; });
  function frame() {
    controls.update(); updateCompass(); renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

try {
  currentDoc = await getDocument();
  configureDetails(currentDoc);
  initScene(currentDoc);
  layerNames.forEach(id => el(id).addEventListener('change', setLayerVisibility));
  el('resetCamera').addEventListener('click', resetCamera);
  document.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.altKey && !e.metaKey) resetCamera(); });
  loading.remove();
} catch (error) {
  el('loadingText').textContent = `Cannot open map: ${error instanceof Error ? error.message : String(error)}`;
  loading.classList.add('error');
  console.error(error);
}
