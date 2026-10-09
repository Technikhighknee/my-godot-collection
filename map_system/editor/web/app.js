import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTerrainGeometry, makeVertexColors, paletteColor, sampleHeight, surfaceAt } from './mesh-data.mjs';
import { nearestSegment, validateRoads } from './road-edit.mjs';
import { MapEdits } from './terrain-edit.mjs';
import { newEntityId, validateEntities } from './entity-edit.mjs';
import { checkBuildingPlacement } from './building-placement.mjs';
import { newPolygonId, nearestPolygonEdge, validatePolygon, validatePolygons } from './polygon-edit.mjs';
import { snapPoint, toggleSelection, moveEntities, duplicateEntities, duplicateRoad } from './workflow.mjs';
import { parsePalette, validateCreate } from './map-management.mjs';
import { intersectTerrainRay } from './terrain-ray.mjs';
import { updateTerrainPatch } from './terrain-patch.mjs';
import { buildWaterRegions } from './water-field.mjs';
import { toolForMode, modeForTool, toolShortcut } from './tool-state.mjs';
import { SCULPT_MODES, effectiveSculptMode, cycleChoice, resizeBrush, rotateDegrees } from './edit-shortcuts.mjs';

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
let waterRegions = [];
let waterVersion = 0;
let waterRenderedVersion = -1;
let waterRenderedSources = '';
let selectedLakeId = null;
let settlementGroup;
let entitiesGroup;
let placementPreview;
let placementPoint = null;
let wireMaterial;
let currentDoc;
let edits;
let selectedRoadId = null;
let selectedPointIndex = -1;
let selectedEntityKind = 'buildings';
let selectedEntityId = null;
let selectedEntityIds = new Set();
let draggingEntity = null;
let polygonKind = 'settlements';
let selectedPolygonId = null;
let selectedAreaIndex = 0;
let selectedVertexIndex = -1;
let polygonDrag = null;
let polygonDraft = null;
let polygonHandles;
let polygonDraftGroup;
let editMode = 'select';
let selectionContext = null;
let inspectorCollapsed = false;
const subtools = { draw: 'roads', place: 'entity' };
const toolLabels = { select: 'Select', sculpt: 'Sculpt terrain', paint: 'Paint surfaces', draw: 'Draw', place: 'Place' };
let draftStart = null;
let dragging = null;
let savePending = false;
let workspacePending = false;
let intentionalReload = false;
let handleGroup;
let brushRing;
let lastPreview = 0;
let paintEyedropper = false;
let brushStrokePointerId = null;
let spacePan = false;
let brushPointerModifiers = { shiftKey: false, ctrlKey: false };
let duplicateDraft = null;
let duplicateGhost = null;
let lastPointerWorld = null;
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
  // Map switching in another tab must not mix JSON, EXR and PNG revisions.
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await fetchResource('/api/map').then(r => r.json());
    if (typeof meta.readOnly !== 'boolean') throw new Error('Map server lacks edit capabilities');
    const headers = typeof meta.revision === 'string' ? { 'If-Match': `"${meta.revision}"` } : {};
    const [heightResponse, surfaceResponse, definitions] = await Promise.all([
      fetch('/api/heights', { cache: 'no-store', headers }),
      fetch('/api/surfaces', { cache: 'no-store', headers }),
      fetchResource('/api/placement-definitions').then(r => r.json()),
    ]);
    if (heightResponse.status === 409 || surfaceResponse.status === 409) continue;
    if (!heightResponse.ok || !surfaceResponse.ok)
      throw new Error(`Map assets unavailable (heights: HTTP ${heightResponse.status}, surfaces: HTTP ${surfaceResponse.status})`);
    const [heights, surfaces] = await Promise.all([heightResponse.arrayBuffer(), surfaceResponse.arrayBuffer()]);
    if (meta.height.width * meta.height.height * 4 !== heights.byteLength) throw new Error('Heightmap byte length mismatch');
    if (meta.surface.width * meta.surface.height !== surfaces.byteLength) throw new Error('Surface map byte length mismatch');
    if (meta.surface.width !== meta.height.width - 1 || meta.surface.height !== meta.height.height - 1) throw new Error('Surface grid does not match height grid');
    return { readOnly: meta.readOnly, revision: meta.revision, mapFile: meta.mapFile, workspace: meta.workspace, definitions, map: meta.map, height: { ...meta.height, data: decodeFloats(heights) }, surface: { ...meta.surface, data: new Uint8Array(surfaces) } };
  }
  throw new Error('Active map changed repeatedly while loading. Reload the editor.');
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
function drawWater() {
  if (!waterGroup || !edits) return;
  const sources = JSON.stringify(edits.water);
  if (waterRenderedVersion === waterVersion && sources === waterRenderedSources) return;
  let regions;
  try { regions = buildWaterRegions(currentDoc.map.terrain, currentDoc.height, edits.water); }
  catch (error) {
    // Sculpting may temporarily lift the terrain above a lake source. Keep editing
    // available; the map validator will reject this state until corrected.
    regions = [];
    setMessage(`Water source needs attention: ${error.message}`, true);
  }
  waterRegions = regions;
  waterRenderedVersion = waterVersion;
  waterRenderedSources = sources;
  disposeGeometryGroup(waterGroup);
  for (const region of regions) {
    if (!region.positions.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(region.positions, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: region.definition === 'water.sea' ? 0x397f91 : 0x4c9bad, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: true }));
    mesh.userData.waterId = region.id;
    waterGroup.add(mesh);
  }
  el('waterCount').textContent = String(regions.length);
}
function commitWater(sources, message) {
  try {
    // Reject dry lake sources before recording a history entry.
    buildWaterRegions(currentDoc.map.terrain, currentDoc.height, sources);
    if (edits.commitPolygons('water', sources)) {
      currentDoc.map.water = edits.water;
      drawWater(); updateWaterUI(); updateRoadUI(); drawPlacement();
      setMessage(message);
    }
  } catch (error) { setMessage(error.message, true); }
}
function updateWaterUI() {
  if (!edits) return;
  const sources = edits.water, sea = sources.find(x => x.definition === 'water.sea');
  const lakes = sources.filter(x => x.definition === 'water.lake');
  const selected = lakes.find(x => x.id === selectedLakeId) ?? null;
  if (!selected) selectedLakeId = lakes[0]?.id ?? null;
  const lake = lakes.find(x => x.id === selectedLakeId);
  if (document.activeElement !== el('seaLevel')) el('seaLevel').value = String(sea?.height ?? 0);
  el('seaApply').textContent = sea ? 'Apply sea level' : 'Enable sea';
  const select = el('lakeSelect');
  select.replaceChildren();
  for (const entry of lakes) { const opt = document.createElement('option'); opt.value = entry.id; opt.textContent = entry.id; select.append(opt); }
  if (lake) select.value = lake.id;
  if (document.activeElement !== el('lakeLevel')) el('lakeLevel').value = String(lake?.height ?? 0);
  if (document.activeElement !== el('lakeX')) el('lakeX').value = String(lake?.source[0] ?? '');
  if (document.activeElement !== el('lakeZ')) el('lakeZ').value = String(lake?.source[1] ?? '');
  el('lakeInfo').textContent = lake ? 'A lake floods connected terrain below its level.' : 'Add a lake by clicking a low point on the terrain.';
  for (const id of ['seaLevel','seaApply','lakeSelect','lakeLevel','lakeX','lakeZ','lakeApply','lakeDelete','lakePlace']) el(id).disabled = currentDoc.readOnly || savePending;
  for (const id of ['lakeSelect','lakeLevel','lakeX','lakeZ','lakeApply','lakeDelete']) el(id).disabled ||= !lake;
  el('lakePlace').classList.toggle('active', editMode === 'place-lake');
}
function initializeWaterEditing() {
  el('seaApply').addEventListener('click', () => {
    const h = Number(el('seaLevel').value), entries = edits.water;
    const existing = entries.find(x => x.definition === 'water.sea');
    if (existing) existing.height = h;
    else entries.unshift({ id: newPolygonId('water', [...entries, ...edits.roads, ...edits.settlements, ...edits.buildings, ...edits.objects].map(x => x.id)), definition: 'water.sea', height: h });
    commitWater(entries, 'Sea level updated. The coast follows the terrain.');
  });
  el('lakeSelect').addEventListener('change', ev => { selectedLakeId = ev.target.value; updateWaterUI(); });
  el('lakePlace').addEventListener('click', () => setEditMode('place-lake'));
  el('lakeApply').addEventListener('click', () => {
    const entries = edits.water, lake = entries.find(x => x.id === selectedLakeId);
    if (!lake) return;
    lake.height = Number(el('lakeLevel').value);
    lake.source = [Number(el('lakeX').value), Number(el('lakeZ').value)];
    commitWater(entries, 'Lake source updated.');
  });
  el('lakeDelete').addEventListener('click', () => {
    if (!selectedLakeId || !window.confirm('Delete the selected lake source?')) return;
    commitWater(edits.water.filter(x => x.id !== selectedLakeId), 'Lake removed.');
    selectedLakeId = null; updateWaterUI();
  });
  updateWaterUI();
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
  if (polygonHandles) polygonHandles.visible = el('settlements').checked;
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
  const brushSurface = el('brushSurface');
  map.terrain.surface_palette.forEach((definition, index) => {
    const option = document.createElement('option'); option.value = String(index); option.textContent = definition;
    brushSurface.append(option);
  });
  for (const definition of map.terrain.surface_palette) {
    const label = document.createElement('div'); label.className = 'legend-line';
    const swatch = document.createElement('span'); swatch.className = 'swatch';
    swatch.style.backgroundColor = `rgb(${paletteColor(definition).map(n => Math.round(n * 255)).join(',')})`;
    const name = document.createElement('span'); name.textContent = definition;
    label.append(swatch, name); el('palette').append(label);
  }
}
function focusCamera() {
  let point = null;
  if (toolForMode(editMode) === 'select' && selectionContext === 'entity') point = currentEntity()?.position;
  if (toolForMode(editMode) === 'select' && selectionContext === 'road') {
    const points = currentRoad()?.points;
    if (points?.length) point = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
  }
  if (toolForMode(editMode) === 'select' && selectionContext === 'polygon') {
    const points = currentPolygon()?.points;
    if (points?.length) point = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
  }
  if (!point) { resetCamera(); return; }
  const offset = camera.position.clone().sub(controls.target);
  controls.target.set(point[0], sampleHeight(currentDoc.map.terrain, currentDoc.height, ...point), point[1]);
  camera.position.copy(controls.target).add(offset);
  controls.update();
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
  controls.zoomToCursor = true;
  controls.mouseButtons.LEFT = null;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  target = new THREE.Vector3();
  scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x655a47, 2.0));
  const sun = new THREE.DirectionalLight(0xffedd6, 2.5);
  sun.position.set(-130, 320, -240);
  scene.add(sun);
  const geo = createMeshGeometry(buildTerrainGeometry(map.terrain, height));
  geo.setAttribute('color', new THREE.BufferAttribute(makeVertexColors(map.terrain, height, surface, map.terrain.surface_palette), 3));
  primaryMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.FrontSide });
  // Conservative fixed height-range sphere: no full-geometry scan on every stroke.
  const [sx, sz] = map.terrain.size;
  const halfRange = (map.terrain.max_height - map.terrain.min_height) / 2;
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(sx / 2, map.terrain.min_height + halfRange, sz / 2),
    Math.hypot(sx / 2, halfRange, sz / 2) + 0.001
  );
  terrainMesh = new THREE.Mesh(geo, primaryMaterial);
  terrainMesh.name = 'Terrain';
  scene.add(terrainMesh);
  wireMaterial = new THREE.MeshBasicMaterial({ color: 0x151f23, wireframe: true, transparent: true, opacity: 0.28, depthWrite: false });
  const wireMesh = new THREE.Mesh(geo, wireMaterial);
  wireMesh.renderOrder = 2;
  scene.add(wireMesh);
  roadGroup = new THREE.Group();
  for (const road of map.roads) {
    const mesh = createRoadMesh(road, map, height);
    mesh.userData.roadId = road.id;
    roadGroup.add(mesh);
  }
  scene.add(roadGroup);
  handleGroup = new THREE.Group();
  scene.add(handleGroup);
  const brushGeometry = new THREE.BufferGeometry();
  brushGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 3), 3));
  brushRing = new THREE.LineLoop(brushGeometry, new THREE.LineBasicMaterial({ color: 0xf2daac, transparent: true, opacity: 0.85, depthTest: false }));
  brushRing.frustumCulled = false;
  brushRing.renderOrder = 6; brushRing.visible = false; scene.add(brushRing);
  waterGroup = new THREE.Group();
  scene.add(waterGroup);
  settlementGroup = new THREE.Group();
  scene.add(settlementGroup);
  polygonHandles = new THREE.Group(); scene.add(polygonHandles);
  polygonDraftGroup = new THREE.Group(); scene.add(polygonDraftGroup);
  entitiesGroup = new THREE.Group();
  scene.add(entitiesGroup);
  placementPreview = new THREE.Group();
  scene.add(placementPreview);
  duplicateGhost = new THREE.Group();
  scene.add(duplicateGhost);
  repaintEntities();
  drawPolygons();
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
    if (dragging || edits?.painting || duplicateDraft || spacePan) return;
    const now = performance.now(); if (now - last < 45) return; last = now;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((ev.clientX - rect.left) / rect.width * 2 - 1, -((ev.clientY - rect.top) / rect.height * 2 - 1));
    raycaster.setFromCamera(pointer, camera);
    const hit = intersectTerrainRay(map.terrain, height, raycaster.ray.origin.toArray(), raycaster.ray.direction.toArray());
    if (!hit) { el('probe').textContent = 'OUTSIDE TERRAIN'; brushRing.visible = false; return; }
    lastPointerWorld = [hit.point.x, hit.point.z];
    brushPointerModifiers = { shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey };
    updateTerrainPointerFeedback(hit.point.x, hit.point.z);
  });
  renderer.domElement.addEventListener('pointerleave', () => { lastPointerWorld = null; el('probe').textContent = 'MOVE CURSOR OVER TERRAIN'; brushRing.visible = false; if (editMode === 'place-entity') { placementPoint = null; drawPlacement(); } });
  function frame() {
    controls.update(); updateCompass(); renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function currentRoad() {
  return edits.roads.find(road => road.id === selectedRoadId) ?? null;
}
function setMessage(text, error = false) {
  el('editorMessage').textContent = text;
  el('editorMessage').classList.toggle('error', error);
}
function disposeRoadMeshes(group) {
  for (const mesh of [...group.children]) {
    group.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
}
function polygonChoices(kind = polygonKind, settlements = edits.settlements) {
  return settlements.flatMap(s => s.build_areas.map((_, index) => ({ id: s.id, index, label: `${s.name} · Area ${index + 1}` })));
}
function currentPolygon(settlements = edits.settlements) {
  const entry = settlements.find(x => x.id === selectedPolygonId);
  const points = entry?.build_areas[selectedAreaIndex];
  return entry && points ? { entry, points } : null;
}
function syncPolygonSelection() {
  const choices = polygonChoices();
  if (!choices.some(x => x.id === selectedPolygonId && x.index === selectedAreaIndex)) {
    selectedPolygonId = choices[0]?.id ?? null;
    selectedAreaIndex = choices[0]?.index ?? 0;
    selectedVertexIndex = -1;
  }
  return choices;
}
function disposeGeometryGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose();
    child.material?.dispose();
  }
}
function polygonHandlePosition(point) {
  const y = sampleHeight(currentDoc.map.terrain, currentDoc.height, ...point);
  return new THREE.Vector3(point[0], y + 0.8, point[1]);
}
function drawPolygons(previewKind = null, previewItems = null) {
  if (!waterGroup || !settlementGroup || !polygonHandles) return;
  for (const group of [settlementGroup, polygonHandles, polygonDraftGroup]) disposeGeometryGroup(group);
  const settlements = previewKind === 'settlements' ? previewItems : edits.settlements;
  drawWater();
  for (const entry of settlements) {
    entry.build_areas.forEach((area, index) => {
      const selected = polygonKind === 'settlements' && entry.id === selectedPolygonId && index === selectedAreaIndex;
      const outline = makeBuildOutline(area, currentDoc.map, currentDoc.height, selected ? 0xffd495 : 0xe9bd74);
      outline.userData = { polygonKind: 'settlements', polygonId: entry.id, areaIndex: index };
      if (selected && ['polygon-edit', 'polygon-insert'].includes(editMode)) {
        outline.material.depthTest = false; outline.renderOrder = 4;
      }
      settlementGroup.add(outline);
    });
  }
  if (!polygonDraft && ['polygon-edit', 'polygon-insert'].includes(editMode)) {
    const selected = currentPolygon(settlements);
    if (selected) selected.points.forEach((point, index) => {
      const isSelected = index === selectedVertexIndex;
      const marker = new THREE.Mesh(new THREE.SphereGeometry(isSelected ? 1.45 : 1.1, 10, 8), new THREE.MeshBasicMaterial({ color: isSelected ? 0xffffff : 0xffc988, depthTest: false }));
      marker.position.copy(polygonHandlePosition(point));
      marker.renderOrder = 6;
      marker.userData.pointIndex = index;
      polygonHandles.add(marker);
    });
  }
  if (polygonDraft) {
    const positions = polygonDraft.points.map(p => polygonHandlePosition(p));
    if (positions.length >= 2) {
      const geometry = new THREE.BufferGeometry().setFromPoints(positions);
      const material = new THREE.LineBasicMaterial({ color: 0x8be1d5, depthTest: false });
      const line = positions.length >= 3 ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
      line.renderOrder = 6; polygonDraftGroup.add(line);
    }
    for (const position of positions) {
      const node = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8be1d5, depthTest: false }));
      node.position.copy(position); node.renderOrder = 6; polygonDraftGroup.add(node);
    }
  }
  setLayerVisibility();
  el('waterCount').textContent = String(edits.water.length);
  el('settlementsCount').textContent = String(edits.settlements.reduce((sum, x) => sum + x.build_areas.length, 0));
}
function updatePolygonUI() {
  if (!edits) return;
  const options = syncPolygonSelection(), selected = currentPolygon(), drawing = !!polygonDraft;
  const select = el('polygonSelect'), value = options.findIndex(x => x.id === selectedPolygonId && x.index === selectedAreaIndex);
  select.replaceChildren();
  options.forEach((choice, index) => { const option = document.createElement('option'); option.value = String(index); option.textContent = choice.label; select.append(option); });
  if (value >= 0) select.value = String(value);
  if (!drawing) {
    if (document.activeElement !== el('polygonName')) el('polygonName').value = selected ? selected.entry.name : '';
  }
  const vertex = selected && selectedVertexIndex >= 0 ? selected.points[selectedVertexIndex] : null;
  for (const [id, index] of [['polygonPointX', 0], ['polygonPointZ', 1]]) {
    if (document.activeElement !== el(id)) el(id).value = vertex ? String(vertex[index]) : '';
  }
  el('polygonInfo').textContent = drawing ? `${polygonDraft.points.length} vertices · At least 3 · Enter to close · Esc to cancel` :
    selected ? `${selected.entry.id} · ${selected.points.length} vertices${selectedVertexIndex >= 0 ? ` · Vertex ${selectedVertexIndex + 1}` : ''}` : 'No polygons in this layer';
  for (const id of ['modePolygons','insertPolygonPoint','polygonSelect','polygonName','newSettlement','addBuildArea','applyPolygon','deletePolygon','deletePolygonPoint','finishPolygon','cancelPolygon','polygonPointX','polygonPointZ','applyPolygonPoint']) el(id).disabled = currentDoc.readOnly || savePending;
  select.disabled ||= !options.length || drawing;
  el('modePolygons').disabled ||= drawing;
  el('insertPolygonPoint').disabled ||= !selected || drawing;
  el('applyPolygon').disabled ||= !selected || drawing;
  el('deletePolygon').disabled ||= !selected || drawing;
  el('deletePolygonPoint').disabled ||= !selected || selected.points.length <= 3 || selectedVertexIndex < 0 || drawing;
  for (const id of ['polygonPointX','polygonPointZ','applyPolygonPoint']) el(id).disabled ||= !vertex || drawing;
  el('addBuildArea').disabled ||= !edits.settlements.length || drawing;
  el('newSettlement').disabled ||= drawing;
  el('polygonName').disabled ||= !selected && !drawing;
  el('finishPolygon').hidden = !drawing;
  el('cancelPolygon').hidden = !drawing;
  el('finishPolygon').disabled ||= !drawing || polygonDraft.points.length < 3;
  el('cancelPolygon').disabled ||= !drawing;
  el('modePolygons').classList.toggle('active', editMode === 'polygon-edit');
  el('insertPolygonPoint').classList.toggle('active', editMode === 'polygon-insert');
}
function selectPolygon(kind, id, index = 0) {
  polygonKind = kind; selectedPolygonId = id; selectedAreaIndex = index; selectedVertexIndex = -1;
  syncPolygonSelection(); drawPolygons(); updatePolygonUI();
  if (editMode === 'select') { selectionContext = id ? 'polygon' : null; renderEditorChrome(); }
}
function commitPolygons(kind, items, message, selection = null) {
  try {
    if (edits.commitPolygons(kind, items)) {
      currentDoc.map[kind] = edits[kind];
      if (selection) { polygonKind = kind; selectedPolygonId = selection.id; selectedAreaIndex = selection.index; selectedVertexIndex = -1; }
      syncPolygonSelection(); drawPolygons(); updateRoadUI();
      setMessage(message);
      return true;
    }
  } catch (error) { setMessage(error.message, true); }
  drawPolygons(); updatePolygonUI();
  return false;
}
function beginPolygon(kind, mode) {
  if (currentDoc.readOnly || savePending) return;
  if (mode === 'append' && !edits.settlements.some(s => s.id === selectedPolygonId)) {
    selectedPolygonId = edits.settlements[0]?.id ?? null; selectedAreaIndex = 0;
    if (!selectedPolygonId) { setMessage('Select a settlement to add an area.', true); return; }
  }
  polygonKind = kind;
  const parentId = mode === 'append' ? selectedPolygonId : null;
  setEditMode('draw-polygon');
  polygonDraft = { kind, mode, parentId, points: [] };
  drawPolygons(); updatePolygonUI();
  setMessage('Click vertices on the terrain. Enter finishes; Esc cancels. Nothing is saved yet.');
}
function cancelPolygonDraft() {
  if (!polygonDraft) return;
  polygonDraft = null; setEditMode('polygon-edit');
  setMessage('Polygon drawing canceled.');
}
function finishPolygon() {
  if (!polygonDraft) return;
  const draft = polygonDraft;
  try {
    validatePolygon(draft.points, currentDoc.map.terrain.size);
    let id, areaIndex = 0, next;
    if (draft.mode === 'append') {
      id = draft.parentId;
      next = edits.settlements;
      const parent = next.find(s => s.id === id);
      if (!parent) throw new Error('Selected settlement no longer exists');
      areaIndex = parent.build_areas.length;
      parent.build_areas.push(draft.points);
    } else {
      id = newPolygonId('settlements', [...edits.water, ...edits.settlements, ...edits.roads, ...edits.buildings, ...edits.objects].map(x => x.id));
      next = [...edits.settlements, { id, name: `Settlement ${id.split('_').at(-1)}`, build_areas: [draft.points] }];
    }
    const kind = draft.kind;
    // Commit first; failed validation keeps draft intact for correction.
    if (commitPolygons(kind, next, 'Polygon created. Drag handles or update properties.', { id, index: areaIndex })) {
      polygonDraft = null;
      setEditMode('polygon-edit');
    }
  } catch (error) { setMessage(error.message, true); }
}
function polygonPointerDown(ev) {
  if (editMode === 'draw-polygon') {
    if (!polygonDraft) return;
    const point = spatialPoint(ev);
    if (!point) return;
    const first = polygonDraft.points[0], previous = polygonDraft.points.at(-1);
    if (first && polygonDraft.points.length >= 3 && Math.hypot(point[0] - first[0], point[1] - first[1]) < 2) { finishPolygon(); return; }
    if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 0.08) return;
    if (polygonDraft.points.length >= 4096) { setMessage('Polygon is too detailed; finish or simplify it.', true); return; }
    polygonDraft.points.push(point); drawPolygons(); updatePolygonUI(); ev.preventDefault(); return;
  }
  makeRay(ev);
  if (editMode === 'polygon-edit') {
    const handle = raycaster.intersectObjects(polygonHandles.children, false)[0];
    if (handle) {
      selectedVertexIndex = handle.object.userData.pointIndex;
      polygonDrag = { kind: polygonKind, id: selectedPolygonId, index: selectedAreaIndex, vertex: selectedVertexIndex, original: edits[polygonKind], preview: null, pointerId: ev.pointerId };
      renderer.domElement.setPointerCapture(ev.pointerId); controls.enabled = false;
      updatePolygonUI(); ev.preventDefault(); return;
    }
    const hit = raycaster.intersectObjects([...settlementGroup.children], false)[0];
    if (hit?.object.userData.polygonKind) {
      const { polygonKind: kind, polygonId: id, areaIndex: index } = hit.object.userData;
      selectPolygon(kind, id, index);
    }
    return;
  }
  if (editMode === 'polygon-insert') {
    const point = spatialPoint(ev), selection = currentPolygon();
    if (!point || !selection) return;
    const nearest = nearestPolygonEdge(selection.points, point);
    if (nearest.distance > 8) { setMessage('Click within 8 meters of a polygon edge.', true); return; }
    const next = edits[polygonKind], entry = next.find(e => e.id === selectedPolygonId);
    const points = entry.build_areas[selectedAreaIndex];
    points.splice(nearest.index + 1, 0, point);
    if (commitPolygons(polygonKind, next, 'Polygon vertex inserted.')) {
      selectedVertexIndex = nearest.index + 1;
      setEditMode('polygon-edit');
    }
  }
}
function polygonPointerMove(ev) {
  if (!polygonDrag || ev.pointerId !== polygonDrag.pointerId) return;
  const point = spatialPoint(ev);
  if (!point) return;
  const d = polygonDrag, next = structuredClone(d.original), entry = next.find(x => x.id === d.id);
  if (!entry) return;
  const points = entry.build_areas[d.index];
  points[d.vertex] = point;
  try {
    const occupied = [...edits.roads, ...edits.buildings, ...edits.objects, ...edits.water].map(x => x.id);
    validatePolygons(d.kind, next, currentDoc.map.terrain.size, occupied);
    d.preview = next;
    drawPolygons(d.kind, next);
  } catch { /* Keep last valid vertex position. */ }
}
function polygonPointerUp(ev) {
  if (!polygonDrag || ev.pointerId !== polygonDrag.pointerId) return;
  const { kind, preview } = polygonDrag;
  polygonDrag = null;
  if (renderer.domElement.hasPointerCapture(ev.pointerId)) renderer.domElement.releasePointerCapture(ev.pointerId);
  controls.enabled = true;
  if (preview) commitPolygons(kind, preview, 'Polygon vertex moved. Ctrl+Z to undo.');
  else drawPolygons();
  updatePolygonUI();
}
function initializePolygonEditing() {
  el('modePolygons').addEventListener('click', () => setEditMode('polygon-edit'));
  el('insertPolygonPoint').addEventListener('click', () => setEditMode('polygon-insert'));
  el('polygonSelect').addEventListener('change', event => { const option = polygonChoices()[Number(event.target.value)]; if (option) selectPolygon(polygonKind, option.id, option.index); });
  el('newSettlement').addEventListener('click', () => beginPolygon('settlements', 'new'));
  el('addBuildArea').addEventListener('click', () => beginPolygon('settlements', 'append'));
  el('finishPolygon').addEventListener('click', finishPolygon);
  el('cancelPolygon').addEventListener('click', cancelPolygonDraft);
  el('applyPolygon').addEventListener('click', () => {
    const selected = currentPolygon(); if (!selected || savePending) return;
    const next = edits[polygonKind], entry = next.find(e => e.id === selected.entry.id);
    entry.name = el('polygonName').value.trim();
    commitPolygons(polygonKind, next, 'Polygon properties updated.');
  });
  el('deletePolygon').addEventListener('click', () => {
    const selected = currentPolygon(); if (!selected || savePending || !window.confirm('Delete the selected polygon? Ctrl+Z restores it.')) return;
    let next = edits.settlements;
    {
      const parent = next.find(x => x.id === selected.entry.id);
      parent.build_areas.splice(selectedAreaIndex, 1);
      if (!parent.build_areas.length) next = next.filter(x => x.id !== parent.id);
    }
    commitPolygons(polygonKind, next, 'Polygon deleted. Ctrl+Z to undo.');
  });
  el('applyPolygonPoint').addEventListener('click', () => {
    const current = currentPolygon();
    if (!current || selectedVertexIndex < 0 || savePending || polygonDraft || polygonDrag) return;
    const x = el('polygonPointX').value.trim(), z = el('polygonPointZ').value.trim();
    if (!x || !z) { setMessage('X and Z are required.', true); return; }
    const next = edits[polygonKind], entry = next.find(e => e.id === current.entry.id);
    const points = entry.build_areas[selectedAreaIndex];
    points[selectedVertexIndex] = [Number(x), Number(z)];
    commitPolygons(polygonKind, next, 'Polygon vertex coordinates updated.');
  });
  el('deletePolygonPoint').addEventListener('click', () => {
    const selected = currentPolygon(); if (!selected || selectedVertexIndex < 0 || selected.points.length <= 3 || savePending) return;
    const next = edits[polygonKind], entry = next.find(x => x.id === selected.entry.id);
    const points = entry.build_areas[selectedAreaIndex];
    points.splice(selectedVertexIndex, 1);
    if (commitPolygons(polygonKind, next, 'Polygon vertex removed.')) selectedVertexIndex = -1;
  });
  updatePolygonUI();
}

const placementReasons = {
  unknown_definition: 'No footprint definition. Add it to placement-definitions.json and restart.',
  unverified_neighbor: 'A neighboring building has no known footprint.',
  outside_map: 'Footprint extends outside the map.',
  outside_build_area: 'Footprint must fit inside a single settlement build area.',
  overlaps_water: 'Footprint overlaps water.',
  overlaps_road: 'Footprint overlaps a road.',
  overlaps_building: 'Footprint overlaps another building.',
  terrain_too_steep: 'Terrain slope exceeds this building’s limit.',
  road_too_far: 'Building entrance is too far from a road.',
  invalid_position: 'Invalid building coordinates or rotation.',
};
function definitionFor(id) {
  return currentDoc.definitions.buildings.find(d => d.id === id);
}
function placementFor(entity, buildings = edits.buildings) {
  const map = { ...currentDoc.map, roads: edits.roads, water: edits.water, settlements: edits.settlements, buildings };
  return checkBuildingPlacement({ map, height: currentDoc.height, definitions: currentDoc.definitions, waterRegions }, definitionFor(entity.definition), entity, buildings);
}
function drawPlacement(entity = null, buildings = edits?.buildings) {
  if (!placementPreview || !currentDoc || !edits) return;
  disposeGeometryGroup(placementPreview);
  const status = el('placementInfo');
  const kind = selectedEntityKind;
  if (kind === 'objects') {
    status.textContent = 'Objects are point markers; footprint rules apply only to buildings.';
    status.className = 'point-info placement-status unverified'; return;
  }
  const value = entity ?? (editMode === 'place-entity' ? (placementPoint ? {
    id: '__preview__', definition: el('entityDefinition').value.trim(), position: placementPoint, rotation: Number(el('entityRotation').value)
  } : null) : currentEntity());
  if (!value) { status.textContent = editMode === 'place-entity' ? 'Move the cursor over terrain to preview a footprint.' : 'Select a building or enter placement mode.'; status.className = 'point-info placement-status'; return; }
  const result = placementFor(value, buildings);
  const valid = result.valid;
  const message = valid
    ? `Valid footprint · Slope ${result.slope.toFixed(1)}°${result.settlement_id ? ` · ${result.settlement_id}` : ''}${Number.isFinite(result.road_distance) ? ` · Road ${result.road_distance.toFixed(1)} m` : ''}`
    : `${placementReasons[result.reason] ?? result.reason}${result.blocking_id ? ` [${result.blocking_id}]` : ''}`;
  status.textContent = message;
  status.className = 'point-info placement-status' + (valid ? '' : result.reason === 'unknown_definition' ? ' unverified' : ' invalid');
  if (!result.footprint) return;
  const coords = result.footprint.map(([x,z]) => new THREE.Vector3(x, sampleHeight(currentDoc.map.terrain,currentDoc.height,x,z)+0.5,z));
  const color = valid ? 0x74e4c3 : 0xf17b67;
  const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(coords), new THREE.LineBasicMaterial({ color, depthTest: false }));
  outline.renderOrder=7; placementPreview.add(outline);
  const triangles = [0,1,2,0,2,3], vertices = new Float32Array(18);
  triangles.forEach((index,i)=>coords[index].toArray(vertices,i*3));
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));
  const mesh = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:0.25,depthTest:false,depthWrite:false}));
  mesh.renderOrder=6; placementPreview.add(mesh);
}
function currentEntity() {
  return edits[selectedEntityKind].find(item => item.id === selectedEntityId) ?? null;
}
function repaintEntities(previewKind = null, previewItems = null) {
  if (!entitiesGroup) return;
  disposeRoadMeshes(entitiesGroup);
  for (const kind of ['buildings', 'objects']) {
    const entities = kind === previewKind ? previewItems : edits[kind];
    for (const entity of entities) {
      const selected = kind === selectedEntityKind && selectedEntityIds.has(entity.id);
      const marker = buildEntity(entity, currentDoc.map, currentDoc.height, selected ? 0xffd995 : kind === 'buildings' ? 0xe9ba6c : 0x82bdc7);
      marker.userData.entityKind = kind;
      marker.userData.entityId = entity.id;
      entitiesGroup.add(marker);
    }
  }
  el('entitiesCount').textContent = String(edits.buildings.length + edits.objects.length);
  drawPlacement();
}
function selectEntity(kind, id, additive = false) {
  const sameKind = kind === selectedEntityKind;
  selectedEntityIds = id ? toggleSelection(sameKind ? selectedEntityIds : new Set(), id, additive) : new Set();
  selectedEntityKind = kind;
  selectedEntityId = selectedEntityIds.has(id) ? id : (selectedEntityIds.values().next().value ?? null);
  el('entityKind').value = kind;
  const entity = currentEntity();
  el('entityDefinition').value = entity?.definition ?? '';
  el('entityRotation').value = String(entity?.rotation ?? 0);
  repaintEntities(); updateEntityUI();
  if (editMode === 'select') { selectionContext = selectedEntityIds.size ? 'entity' : null; renderEditorChrome(); }
}
function selectedMarkerIds() {
  return [...selectedEntityIds].filter(id => edits[selectedEntityKind].some(e => e.id === id));
}
function deleteSelectedEntities() {
  if (currentDoc.readOnly || savePending || draggingEntity) return;
  const ids = selectedMarkerIds();
  if (!ids.length || !window.confirm(`Delete ${ids.length} selected marker${ids.length === 1 ? '' : 's'}? Ctrl+Z restores them.`)) return;
  const selected = new Set(ids);
  if (commitEntities(selectedEntityKind, edits[selectedEntityKind].filter(e => !selected.has(e.id)), `${ids.length} marker(s) deleted.`)) {
    selectedEntityIds.clear(); selectedEntityId = null; updateEntityUI(); repaintEntities();
  }
}
function updateEntityUI() {
  const items = edits[selectedEntityKind];
  selectedEntityIds = new Set([...selectedEntityIds].filter(id => items.some(item => item.id === id)));
  if (!selectedEntityIds.has(selectedEntityId)) selectedEntityId = selectedEntityIds.values().next().value ?? null;
  const item = currentEntity();
  const select = el('entitySelect');
  select.replaceChildren();
  for (const entity of items) {
    const option = document.createElement('option');
    option.value = entity.id; option.textContent = entity.id; select.append(option);
  }
  if (item) select.value = item.id; else select.value = ''; 
  if (editMode !== 'place-entity') {
    if (document.activeElement !== el('entityDefinition')) el('entityDefinition').value = item?.definition ?? '';
    if (document.activeElement !== el('entityRotation')) el('entityRotation').value = String(item?.rotation ?? 0);
  }
  const count = selectedEntityIds.size;
  el('entityInfo').textContent = count > 1 ? `${count} selected · Shift+click to add/remove · Drag any selected marker to move the group` : item ? `ID ${item.id} · X ${item.position[0].toFixed(2)} · Z ${item.position[1].toFixed(2)}` : 'No marker selected · Shift+click for multiselect';
  if (item && count === 1) {
    if (document.activeElement !== el('entityX')) el('entityX').value = String(item.position[0]);
    if (document.activeElement !== el('entityZ')) el('entityZ').value = String(item.position[1]);
  } else if (document.activeElement !== el('entityX') && document.activeElement !== el('entityZ')) { el('entityX').value = ''; el('entityZ').value = ''; }
  for (const id of ['modeEntities', 'placeEntity', 'entityKind', 'entitySelect', 'entityDefinition', 'entityRotation', 'entityX', 'entityZ', 'applyEntity', 'deleteEntity']) el(id).disabled = currentDoc.readOnly || savePending;
  select.disabled ||= !items.length;
  el('deleteEntity').disabled ||= count === 0;
  el('applyEntity').disabled ||= count !== 1 || editMode === 'place-entity';
  for (const id of ['entityDefinition','entityRotation','entityX','entityZ']) el(id).disabled ||= count !== 1 && editMode !== 'place-entity';
  el('duplicateSelected').disabled = currentDoc.readOnly || savePending || !((['entities','edit'].includes(editMode) || (editMode === 'select' && ['entity','road'].includes(selectionContext))) && (editMode === 'edit' || selectionContext === 'road' ? !!currentRoad() : count > 0));
  el('modeEntities').classList.toggle('active', editMode === 'entities');
  el('placeEntity').classList.toggle('active', editMode === 'place-entity');
  drawPlacement();
}
function commitEntities(kind, items, message) {
  try {
    if (kind === 'buildings') {
      const before = new Map(edits.buildings.map(item => [item.id, JSON.stringify(item)]));
      for (const entity of items) if (before.get(entity.id) !== JSON.stringify(entity)) {
        const result = placementFor(entity, items);
        if (!result.valid) throw new Error(`Invalid building ${entity.id}: ${placementReasons[result.reason] ?? result.reason}`);
      }
    }
    if (edits.commitEntities(kind, items)) {
      currentDoc.map[kind] = edits[kind];
      updateEntityUI(); repaintEntities(); updateRoadUI();
      setMessage(message);
      return true;
    }
  } catch (error) { setMessage(error.message, true); }
  return false;
}
function drawRoads(roads = edits.roads, changedId = null) {
  if (changedId) {
    for (const mesh of [...roadGroup.children]) {
      if (mesh.userData.roadId === changedId) {
        roadGroup.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
      }
    }
  } else disposeRoadMeshes(roadGroup);
  for (const road of roads) {
    if (changedId && road.id !== changedId) continue;
    const mesh = createRoadMesh(road, currentDoc.map, currentDoc.height);
    mesh.userData.roadId = road.id;
    if (road.id === selectedRoadId) {
      mesh.material.color.set(0xe6ae68);
      mesh.renderOrder = 1;
    }
    roadGroup.add(mesh);
  }
}
function drawHandles(roads = edits.roads) {
  disposeRoadMeshes(handleGroup);
  const road = roads.find(r => r.id === selectedRoadId);
  if (editMode === 'create' && draftStart) {
    const [x,z] = draftStart;
    const marker = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0x93e0ce, depthTest: false }));
    marker.position.set(x, sampleHeight(currentDoc.map.terrain, currentDoc.height, x, z) + 0.65, z);
    marker.renderOrder = 5;
    handleGroup.add(marker);
  }
  if (!road || !['edit', 'create', 'append', 'insert'].includes(editMode)) return;
  road.points.forEach(([x, z], index) => {
    const selected = index === selectedPointIndex;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(selected ? 1.5 : 1.12, 12, 8),
      new THREE.MeshBasicMaterial({ color: selected ? 0xffdf9c : 0xf8c27d, depthTest: false })
    );
    marker.position.set(x, sampleHeight(currentDoc.map.terrain, currentDoc.height, x, z) + 0.65, z);
    marker.renderOrder = 5;
    marker.userData.pointIndex = index;
    handleGroup.add(marker);
  });
}
function updateRoadUI() {
  if (!edits) return;
  const roads = edits.roads;
  if (!roads.some(road => road.id === selectedRoadId)) { selectedRoadId = roads[0]?.id ?? null; selectedPointIndex = -1; }
  const road = currentRoad();
  if (road && selectedPointIndex >= road.points.length) selectedPointIndex = -1;
  const select = el('roadSelect');
  select.replaceChildren();
  for (const item of roads) {
    const option = document.createElement('option');
    option.value = item.id; option.textContent = `${item.id} (${item.points.length} points)`;
    select.append(option);
  }
  if (selectedRoadId) select.value = selectedRoadId;
  select.disabled = !roads.length || currentDoc.readOnly || savePending;
  if (document.activeElement !== el('roadWidth')) el('roadWidth').value = road ? String(road.width) : '';
  el('roadWidth').disabled = !road || currentDoc.readOnly || savePending;
  const selectedRoadPoint = road?.points[selectedPointIndex];
  for (const [id, index] of [['roadPointX', 0], ['roadPointZ', 1]]) {
    if (document.activeElement !== el(id)) el(id).value = selectedRoadPoint ? String(selectedRoadPoint[index]) : '';
    el(id).disabled = !selectedRoadPoint || currentDoc.readOnly || savePending;
  }
  el('applyRoadPoint').disabled = !selectedRoadPoint || currentDoc.readOnly || savePending;
  el('pointInfo').textContent = road && selectedPointIndex >= 0 && selectedPointIndex < road.points.length
    ? `Point ${selectedPointIndex + 1} / ${road.points.length} · X ${road.points[selectedPointIndex][0].toFixed(2)} · Z ${road.points[selectedPointIndex][1].toFixed(2)}`
    : road ? `${road.points.length} points · Click a handle to select and drag` : 'No road selected';
  el('roadsCount').textContent = String(roads.length);
  for (const id of ['modeEdit','newRoad','deleteRoad','appendPoint','insertPoint','deletePoint']) el(id).disabled = currentDoc.readOnly || savePending || (['deleteRoad','appendPoint','insertPoint','deletePoint'].includes(id) && !road) || (id === 'deletePoint' && (selectedPointIndex < 0 || !road || road.points.length <= 2));
  el('modeNavigate').disabled = savePending;
  el('deleteRoad').disabled = el('deleteRoad').disabled || !road;
  el('undo').disabled = savePending || !edits.canUndo;
  el('redo').disabled = savePending || !edits.canRedo;
  el('saveRoads').disabled = savePending || !edits.isDirty || currentDoc.readOnly || !!polygonDraft || !!polygonDrag;
  el('saveRoads').textContent = savePending ? 'Saving…' : 'Save map';
  el('modeNavigate').classList.toggle('active', editMode === 'navigate');
  updateTerrainUI();
  updateEntityUI();
  el('modeEdit').classList.toggle('active', ['edit','create','append','insert'].includes(editMode));
  updatePolygonUI();
  el('mapName').textContent = `${currentDoc.map.name}${edits.isDirty ? ' •' : ''}`;
  document.querySelector('.status-dot').classList.toggle('dirty', edits.isDirty);
  document.querySelector('.quiet').textContent = currentDoc.readOnly ? 'READ ONLY' : edits.isDirty ? 'UNSAVED CHANGES' : 'MAP · SAVED';
  el('saveRoads').classList.toggle('is-dirty', edits.isDirty);
}
function repaintRoads(roads = edits.roads, preview = false) {
  currentDoc.map.roads = roads;
  if (!preview) updateRoadUI();
  drawRoads(roads, preview ? dragging?.roadId : null);
  drawHandles(roads);
}
function commitRoads(roads, message = 'Roads updated. Remember to save.') {
  try {
    if (edits.commit(roads)) {
      repaintRoads();
      setMessage(message);
      return true;
    }
  } catch (error) { setMessage(error.message, true); }
  return false;
}
function selectRoad(id) {
  selectedRoadId = id;
  selectedPointIndex = -1;
  drawRoads(); drawHandles(); updateRoadUI();
  if (editMode === 'select') { selectionContext = id ? 'road' : null; renderEditorChrome(); }
}
function setEditMode(next) {
  if (duplicateDraft) { setMessage('Place or cancel the duplicate first.', true); return; }
  if (currentDoc.readOnly && !['navigate','select','entities'].includes(next)) return;
  if (next === 'navigate' || next === 'entities') next = 'select';
  if (dragging || draggingEntity || polygonDrag || edits.painting) cancelDrag();
  if (editMode === 'draw-polygon' && next !== 'draw-polygon') polygonDraft = null;
  editMode = next;
  draftStart = null;
  controls.enableRotate = true;
  if (['edit','create','append','insert'].includes(next)) subtools.draw = 'roads';
  if (['polygon-edit','polygon-insert','draw-polygon'].includes(next)) subtools.draw = 'areas';
  if (next === 'place-entity') subtools.place = 'entity';
  if (next === 'place-lake') subtools.place = 'lake';
  brushRing.visible = false;
  viewport.classList.toggle('edit-cursor', next !== 'navigate' && next !== 'select');
  if (['edit', 'create', 'append', 'insert'].includes(next)) { el('roads').checked = true; setLayerVisibility(); }
  if (['entities', 'place-entity'].includes(next)) { el('entities').checked = true; setLayerVisibility(); }
  if (next !== 'place-entity') placementPoint = null;
  if (['polygon-edit', 'polygon-insert', 'draw-polygon'].includes(next)) { el('settlements').checked = true; setLayerVisibility(); }
  const hints = {
    navigate: 'Middle-drag to orbit, right-drag to pan, wheel to zoom.',
    select: 'Click a marker, road or build area to select; drag selected markers to move.',
    edit: 'Drag a highlighted road handle. Click another road to select.',
    create: 'Click the terrain to set the first point of the new road.',
    append: 'Click the terrain to append a point to the selected road.',
    insert: 'Click near a road segment to insert a point.',
    sculpt: 'Left drag to sculpt terrain. Choose Raise, Lower, Smooth or Flatten.',
    paint: 'Left drag to paint a categorical surface. Select a definition below.',
    entities: 'Click a marker to select; drag it to move. Rotations are in degrees.',
    'place-entity': 'Enter a definition ID, then click the terrain to place a marker.',
    'place-lake': 'Click a point below the lake water level to create its source.',
    'polygon-edit': 'Select an area, then drag its corner handles.',
    'polygon-insert': 'Click near an edge of the selected polygon to insert a vertex.',
    'draw-polygon': 'Click to add vertices. Finish with Enter or the Finish polygon button; Esc cancels.',
  };
  setMessage(hints[next]);
  drawHandles(); updateRoadUI();
  updateTerrainUI(); updateEntityUI(); updatePolygonUI(); updateWaterUI();
  drawPolygons();
  drawPlacement();
  renderEditorChrome();
}
const toolHints = {
  select: 'LMB Select · D Duplicate · R Rotate · Delete Remove · Space+Drag Pan',
  sculpt: 'LMB Sculpt · Shift Reverse · Ctrl Smooth · Q/E Mode · Shift+Wheel Radius',
  paint: 'LMB Paint · Hold I + click Pick surface · Q/E Surface · Shift+Wheel Radius',
  draw: 'LMB Draw/Edit · Q/E Roads/Areas · Enter Finish · Esc Cancel',
  place: 'LMB Place · Q/E Kind · R Rotate marker · MMB Orbit · RMB Pan',
};
function editingInProgress() {
  return !!(dragging || draggingEntity || polygonDrag || edits.painting || polygonDraft || draftStart || duplicateDraft);
}
function switchToolMode(mode) {
  if (editingInProgress()) { setMessage('Finish or cancel the current action before switching tools.', true); return; }
  setEditMode(mode);
}
function selectTool(tool) {
  if (editingInProgress()) { setMessage('Finish or cancel the current action before switching tools.', true); return; }
  inspectorCollapsed = false;
  closeOpenPanel();
  setEditMode(modeForTool(tool, subtools));
}
function renderEditorChrome() {
  if (!currentDoc) return;
  const tool = toolForMode(editMode);
  const panel = el('toolPanel');
  const roadPanel = panel.querySelector('.road-editor');
  const entityPanel = panel.querySelector('.entity-editor');
  const polygonPanel = panel.querySelector('.polygon-editor');
  const waterPanel = panel.querySelector('.water-editor');
  const terrainPanel = panel.querySelector('.terrain-editor');
  const context = tool === 'select' ? selectionContext : tool === 'draw' ? subtools.draw : tool === 'place' ? subtools.place : tool;
  const visible = {
    road: context === 'road' || context === 'roads',
    entity: context === 'entity',
    polygon: context === 'polygon' || context === 'areas',
    water: context === 'lake',
    terrain: tool === 'sculpt' || tool === 'paint',
  };
  roadPanel.hidden = !visible.road;
  entityPanel.hidden = !visible.entity;
  polygonPanel.hidden = !visible.polygon;
  waterPanel.hidden = !visible.water;
  terrainPanel.hidden = !visible.terrain;
  el('selectionHint').hidden = !(tool === 'select' && !selectionContext);
  panel.hidden = inspectorCollapsed || (tool === 'select' && !selectionContext);
  el('drawModeTabs').hidden = tool !== 'draw';
  el('placeModeTabs').hidden = tool !== 'place';
  el('toolEyebrow').textContent = `TOOL ${['select','sculpt','paint','draw','place'].indexOf(tool) + 1}`;
  el('toolTitle').textContent = tool === 'select' ? ({ entity: 'Selected marker', road: 'Selected road', polygon: 'Selected build area' }[selectionContext] ?? 'Select') : toolLabels[tool];
  for (const button of document.querySelectorAll('[data-tool]')) {
    const active = button.dataset.tool === tool;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.disabled = !!currentDoc.readOnly && button.dataset.tool !== 'select';
  }
  for (const [id, state] of [['drawRoadsTab', subtools.draw === 'roads'], ['drawAreasTab', subtools.draw === 'areas'], ['placeEntitiesTab', subtools.place === 'entity'], ['placeLakesTab', subtools.place === 'lake']]) {
    el(id).classList.toggle('is-active', state);
    el(id).setAttribute('aria-pressed', String(state));
  }
  el('interactionHint').textContent = tool === 'paint' && paintEyedropper ? 'PIPETTE · Click terrain to sample surface · Release I to paint' : toolHints[tool];
  terrainPanel.classList.toggle('sculpt-active', tool === 'sculpt');
  terrainPanel.classList.toggle('paint-active', tool === 'paint');
  for (const button of document.querySelectorAll('[data-sculpt-kind]')) {
    const selected = el('sculptMode').value === button.dataset.sculptKind;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  for (const button of document.querySelectorAll('[data-surface-index]')) {
    const selected = Number(el('brushSurface').value) === Number(button.dataset.surfaceIndex);
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  for (const id of ['brushRadius','brushStrength']) {
    if (document.activeElement !== el(`${id}Slider`)) el(`${id}Slider`).value = el(id).value;
  }
}
function closeOpenPanel() {
  for (const name of ['workspace','view','settings']) {
    const panel = el(`${name}Panel`);
    if (!panel.hidden) { panel.hidden = true; el(`${name}Toggle`).setAttribute('aria-expanded', 'false'); return true; }
  }
  return false;
}
function togglePopover(name) {
  const panel = el(`${name}Panel`), next = panel.hidden;
  closeOpenPanel();
  panel.hidden = !next;
  el(`${name}Toggle`).setAttribute('aria-expanded', String(next));
}
function setBrushRadius(next) {
  el('brushRadius').value = String(next);
  el('brushRadiusSlider').value = String(next);
  updateTerrainUI();
  renderEditorChrome();
  if (lastPointerWorld) updateTerrainPointerFeedback(...lastPointerWorld);
}
function cycleCurrentSubtool(direction) {
  if (editingInProgress()) { setMessage('Finish or cancel the current action first.', true); return; }
  const tool = toolForMode(editMode);
  if (tool === 'sculpt') {
    el('sculptMode').value = cycleChoice([...SCULPT_MODES], el('sculptMode').value, direction);
    renderEditorChrome();
  } else if (tool === 'paint') {
    const options = [...el('brushSurface').options].map(o => o.value);
    el('brushSurface').value = cycleChoice(options, el('brushSurface').value, direction);
    renderEditorChrome();
  } else if (tool === 'draw') {
    subtools.draw = cycleChoice(['roads','areas'], subtools.draw, direction);
    setEditMode(modeForTool('draw', subtools));
  } else if (tool === 'place') {
    subtools.place = cycleChoice(['entity','lake'], subtools.place, direction);
    setEditMode(modeForTool('place', subtools));
  }
}
function rotateActiveMarker(direction = 1) {
  if (currentDoc.readOnly || savePending || editingInProgress()) return;
  if (editMode === 'place-entity') {
    el('entityRotation').value = String(rotateDegrees(Number(el('entityRotation').value), direction));
    drawPlacement(); return;
  }
  if (editMode !== 'select' || selectionContext !== 'entity') return;
  const ids = selectedMarkerIds();
  if (!ids.length) return;
  const next = edits[selectedEntityKind].map(e => ids.includes(e.id) ? { ...e, rotation: rotateDegrees(e.rotation, direction) } : e);
  if (commitEntities(selectedEntityKind, next, `Rotated ${ids.length} marker(s) by ${direction * 15}°. Ctrl+Z to undo.`)) {
    el('entityRotation').value = String(currentEntity()?.rotation ?? 0);
    repaintEntities(); renderEditorChrome();
  }
}
function clearDuplicateDraft() {
  duplicateDraft = null;
  if (duplicateGhost) disposeRoadMeshes(duplicateGhost);
}
function startDuplicateAtCursor() {
  if (currentDoc.readOnly || savePending || editingInProgress()) return;
  const selection = editMode === 'select' ? selectionContext : editMode === 'edit' ? 'road' : null;
  if (selection === 'entity') {
    const ids = selectedMarkerIds(); if (!ids.length) return;
    const kind = selectedEntityKind;
    const used = [...edits.roads, ...edits.water, ...edits.settlements, ...edits[kind === 'buildings' ? 'objects' : 'buildings']].map(e => e.id);
    try {
      const copy = duplicateEntities(kind, edits[kind], ids, currentDoc.map.terrain.size, [0,0], used);
      duplicateDraft = { kind, original: copy.entries, createdIds: copy.addedIds,
        anchor: edits[kind].find(e => e.id === (selectedEntityId ?? ids[0])).position,
        valid: false, candidate: null, rotationOffset: 0 };
    } catch (error) { setMessage(error.message, true); return; }
  } else if (selection === 'road' && currentRoad()) {
    try {
      const occupied = [...edits.water, ...edits.settlements, ...edits.buildings, ...edits.objects].map(e=>e.id);
      const copy = duplicateRoad(edits.roads, selectedRoadId, currentDoc.map.terrain.size, [0,0], occupied);
      duplicateDraft = { kind: 'road', original: copy.entries, createdIds: [copy.addedId],
        anchor: [...currentRoad().points[0]], valid: false, candidate: null, rotationOffset: 0 };
    } catch (error) { setMessage(error.message, true); return; }
  } else return;
  setMessage('Move cursor to position duplicate · LMB place · R rotate markers · Esc cancel');
  if (lastPointerWorld) updateDuplicatePreview(lastPointerWorld, true);
}
function updateDuplicatePreview(point, force = false) {
  if (!duplicateDraft || !point) return;
  const draft = duplicateDraft;
  const now = performance.now();
  if (!force && now - (draft.lastPreviewAt ?? 0) < 28) return;
  draft.lastPreviewAt = now;
  const dx = point[0] - draft.anchor[0], dz = point[1] - draft.anchor[1];
  const chosen = new Set(draft.createdIds);
  const candidate = draft.original.map(e => chosen.has(e.id) ? draft.kind === 'road'
    ? { ...e, points: e.points.map(([x,z]) => [Number((x+dx).toFixed(6)),Number((z+dz).toFixed(6))]) }
    : { ...e, position: [Number((e.position[0]+dx).toFixed(6)),Number((e.position[1]+dz).toFixed(6))],
        rotation: ((e.rotation + draft.rotationOffset) % 360 + 360) % 360 } : e);
  let valid = true, error = null;
  try {
    if (draft.kind === 'road') validateRoads(candidate, currentDoc.map.terrain.size);
    else {
      validateEntities(draft.kind, candidate, currentDoc.map.terrain.size, [...edits.roads,...edits.water,...edits.settlements,...edits[draft.kind === 'buildings' ? 'objects' : 'buildings']].map(e=>e.id));
      if (draft.kind === 'buildings') for (const e of candidate) if (chosen.has(e.id)) {
        const placement = placementFor(e, candidate);
        if (!placement.valid) throw new Error(placementReasons[placement.reason] ?? placement.reason);
      }
    }
  } catch (e) { valid = false; error = e.message; }
  draft.valid = valid; draft.error = error; draft.candidate = candidate;
  disposeRoadMeshes(duplicateGhost);
  for (const entry of candidate) if (chosen.has(entry.id)) {
    try {
      const mesh = draft.kind === 'road' ? createRoadMesh(entry, currentDoc.map, currentDoc.height)
        : buildEntity(entry, currentDoc.map, currentDoc.height, valid ? 0x64efbd : 0xff6c62);
      mesh.material.color.setHex(valid ? 0x64efbd : 0xff6c62);
      mesh.material.transparent = true; mesh.material.opacity = 0.55;
      duplicateGhost.add(mesh);
    } catch { /* An off-map preview remains invalid and cannot be committed. */ }
  }
}
function initializeEditorChrome() {
  for (const toolButton of document.querySelectorAll('[data-tool]')) toolButton.addEventListener('click', () => selectTool(toolButton.dataset.tool));
  for (const name of ['workspace','view','settings']) {
    el(`${name}Toggle`).addEventListener('click', () => togglePopover(name));
    el(`close${name[0].toUpperCase() + name.slice(1)}`).addEventListener('click', () => closeOpenPanel());
  }
  el('collapseToolPanel').addEventListener('click', () => { inspectorCollapsed = true; renderEditorChrome(); });
  el('drawRoadsTab').addEventListener('click', () => switchToolMode('edit'));
  el('drawAreasTab').addEventListener('click', () => switchToolMode('polygon-edit'));
  el('placeEntitiesTab').addEventListener('click', () => switchToolMode('place-entity'));
  el('placeLakesTab').addEventListener('click', () => switchToolMode('place-lake'));
  for (const button of document.querySelectorAll('[data-sculpt-kind]')) {
    button.addEventListener('click', () => { el('sculptMode').value = button.dataset.sculptKind; renderEditorChrome(); });
  }
  for (const id of ['brushRadius','brushStrength']) {
    const field = el(id), slider = el(`${id}Slider`);
    slider.addEventListener('input', () => { field.value = slider.value; updateTerrainUI(); });
    field.addEventListener('input', () => { slider.value = field.value; });
  }
  for (const id of ['sculptMode','brushSurface','brushRadius','brushStrength']) el(id).addEventListener('change', renderEditorChrome);
  for (const option of el('brushSurface').options) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.surfaceIndex = option.value;
    button.textContent = option.textContent.split('.').at(-1);
    button.title = option.textContent;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => { el('brushSurface').value = option.value; renderEditorChrome(); });
    el('surfaceChoices').append(button);
  }
  el('entitySelect').addEventListener('change', renderEditorChrome);
  el('roadSelect').addEventListener('change', renderEditorChrome);
  el('polygonSelect').addEventListener('change', renderEditorChrome);
  el('lakeSelect').addEventListener('change', renderEditorChrome);
}

function makeRay(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((ev.clientX - rect.left) / rect.width * 2 - 1, -((ev.clientY - rect.top) / rect.height * 2 - 1));
  raycaster.setFromCamera(pointer, camera);
}
function terrainPoint(ev) {
  makeRay(ev);
  const hit = intersectTerrainRay(currentDoc.map.terrain, currentDoc.height, raycaster.ray.origin.toArray(), raycaster.ray.direction.toArray());
  return hit ? [Number(hit.point.x.toFixed(4)), Number(hit.point.z.toFixed(4))] : null;
}
function spatialPoint(ev) {
  const point = terrainPoint(ev);
  if (!point) return null;
  try { return snapPoint(point, currentDoc.map.terrain.size, el('gridSnap').checked && !ev.altKey, Number(el('gridStep').value)); }
  catch (error) { setMessage(error.message, true); return null; }
}
function cancelDrag() {
  if (edits.painting) {
    edits.cancelStroke();
    if (brushStrokePointerId !== null && renderer.domElement.hasPointerCapture(brushStrokePointerId)) renderer.domElement.releasePointerCapture(brushStrokePointerId);
    brushStrokePointerId = null; controls.enabled = true; refreshTerrain(true); updateRoadUI();
  }
  if (draggingEntity) {
    const previous = draggingEntity;
    draggingEntity = null;
    controls.enabled = true;
    if (renderer.domElement.hasPointerCapture(previous.pointerId)) renderer.domElement.releasePointerCapture(previous.pointerId);
    repaintEntities();
  }
  if (polygonDrag) {
    const previous = polygonDrag; polygonDrag = null;
    if (renderer.domElement.hasPointerCapture(previous.pointerId)) renderer.domElement.releasePointerCapture(previous.pointerId);
    controls.enabled = true; drawPolygons();
  }
  if (!dragging) return;
  dragging = null;
  repaintRoads();
}
function editorPointerDown(ev) {
  if (editMode === 'place-lake' && ev.button === 0 && !spacePan && !duplicateDraft && !currentDoc.readOnly && !savePending) {
    const point = spatialPoint(ev);
    if (!point) return;
    const level = sampleHeight(currentDoc.map.terrain, currentDoc.height, ...point) + 1;
    const used = [...edits.water, ...edits.roads, ...edits.settlements, ...edits.buildings, ...edits.objects].map(x => x.id);
    const id = newPolygonId('water', used);
    commitWater([...edits.water, { id, definition: 'water.lake', height: level, source: point }], 'Lake source added. Set its level in the Water panel.');
    selectedLakeId = id; updateWaterUI(); renderEditorChrome();
    ev.preventDefault(); return;
  }
  if (spacePan || ev.button !== 0 || editMode === 'navigate' || savePending) return;
  if (duplicateDraft) {
    ev.preventDefault();
    if (!duplicateDraft.valid || !duplicateDraft.candidate) {
      setMessage(duplicateDraft.error ?? 'Move over a valid position to place the duplicate.', true);
      return;
    }
    const draft = duplicateDraft;
    const ok = draft.kind === 'road'
      ? commitRoads(draft.candidate, 'Road duplicated at cursor. Ctrl+Z to undo.')
      : commitEntities(draft.kind, draft.candidate, 'Markers duplicated at cursor. Ctrl+Z to undo.');
    if (ok) {
      clearDuplicateDraft();
      if (draft.kind === 'road') selectRoad(draft.createdIds[0]);
      else {
        selectedEntityKind = draft.kind;
        selectedEntityIds = new Set(draft.createdIds);
        selectedEntityId = draft.createdIds[0];
        updateEntityUI(); repaintEntities(); renderEditorChrome();
      }
    }
    return;
  }
  if (editMode === 'paint' && paintEyedropper) {
    const point = terrainPoint(ev);
    if (point) {
      const surfaceIndex = surfaceAt(currentDoc.map.terrain, currentDoc.surface, ...point);
      el('brushSurface').value = String(surfaceIndex);
      renderEditorChrome();
      setMessage(`Picked ${currentDoc.map.terrain.surface_palette[surfaceIndex]}. Release I to paint.`);
    }
    ev.preventDefault();
    return;
  }
  if (editMode === 'select') {
    makeRay(ev);
    const entityHit = entitiesGroup.visible ? raycaster.intersectObjects(entitiesGroup.children, false)[0] : null;
    if (entityHit) {
      const { entityKind, entityId } = entityHit.object.userData;
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { selectEntity(entityKind, entityId, true); ev.preventDefault(); return; }
      if (entityKind !== selectedEntityKind || !selectedEntityIds.has(entityId)) selectEntity(entityKind, entityId);
      if (!currentDoc.readOnly) {
        draggingEntity = { kind: entityKind, id: entityId, ids: selectedMarkerIds(), original: edits[entityKind], preview: null, pointerId: ev.pointerId };
        renderer.domElement.setPointerCapture(ev.pointerId);
        controls.enabled = false;
      }
      ev.preventDefault(); return;
    }
    const roadHit = roadGroup.visible ? raycaster.intersectObjects(roadGroup.children, false)[0] : null;
    if (roadHit) { selectRoad(roadHit.object.userData.roadId); ev.preventDefault(); return; }
    raycaster.params.Line.threshold = Math.max(1.5, controls.target.distanceTo(camera.position) * 0.005);
    const areaHit = settlementGroup.visible ? raycaster.intersectObjects(settlementGroup.children, false)[0] : null;
    if (areaHit?.object.userData.polygonKind) {
      selectPolygon('settlements', areaHit.object.userData.polygonId, areaHit.object.userData.areaIndex);
      ev.preventDefault(); return;
    }
    if (!ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      selectedEntityIds.clear(); selectedEntityId = null; selectionContext = null;
      updateEntityUI(); repaintEntities(); renderEditorChrome();
    }
    return;
  }
  if (currentDoc.readOnly) return;
  if (editMode === 'sculpt' || editMode === 'paint') {
    const pos = terrainPoint(ev);
    if (!pos) return;
    try {
      brushPointerModifiers = { shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey };
      const radius = Number(el('brushRadius').value), strength = Number(el('brushStrength').value);
      const kind = editMode === 'paint' ? 'paint' : effectiveSculptMode(el('sculptMode').value, ev);
      edits.beginStroke(kind, { radius, strength, surfaceIndex: Number(el('brushSurface').value) }, pos);
      brushStrokePointerId = ev.pointerId;
      renderer.domElement.setPointerCapture(ev.pointerId);
      controls.enabled = false;
      const changed = edits.takeStrokeBounds();
      if (changed) refreshTerrain(false, changed);
      updateRoadUI();
      updateTerrainPointerFeedback(pos[0], pos[1]);
      ev.preventDefault();
    } catch (error) { setMessage(error.message, true); }
    return;
  }
  if (['polygon-edit', 'polygon-insert', 'draw-polygon'].includes(editMode)) { polygonPointerDown(ev); return; }
  if (editMode === 'entities') {
    makeRay(ev);
    const hit = raycaster.intersectObjects(entitiesGroup.children, false)[0];
    if (hit) {
      const { entityKind, entityId } = hit.object.userData;
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
        selectEntity(entityKind, entityId, true);
        ev.preventDefault(); return;
      }
      if (entityKind !== selectedEntityKind || !selectedEntityIds.has(entityId)) selectEntity(entityKind, entityId);
      draggingEntity = { kind: entityKind, id: entityId, ids: selectedMarkerIds(), original: edits[entityKind], preview: null, pointerId: ev.pointerId };
      renderer.domElement.setPointerCapture(ev.pointerId);
      controls.enabled = false;
      ev.preventDefault();
    } else if (!ev.shiftKey && !ev.ctrlKey && !ev.metaKey) selectEntity(selectedEntityKind, null);
    return;
  }
  if (editMode === 'place-entity') {
    const pos = spatialPoint(ev);
    if (!pos) return;
    const kind = selectedEntityKind;
    const definition = el('entityDefinition').value.trim();
    const rotation = Number(el('entityRotation').value);
    const used = [...edits.roads, ...edits.buildings, ...edits.objects, ...currentDoc.map.water, ...currentDoc.map.settlements].map(x => x.id);
    const id = newEntityId(kind, used);
    const items = [...edits[kind], { id, definition, position: pos, rotation }];
    try {
      validateEntities(kind, items, currentDoc.map.terrain.size, used.filter(x => !edits[kind].some(e => e.id === x)));
      commitEntities(kind, items, `Placed ${id}. Ctrl+S to save.`);
      if (edits[kind].some(x => x.id === id)) {
        selectEntity(kind, id);
        renderEditorChrome();
      }
    } catch (error) { setMessage(error.message, true); }
    return;
  }
  makeRay(ev);
  if (editMode === 'edit') {
    const handle = raycaster.intersectObjects(handleGroup.children, false)[0];
    if (handle) {
      selectedPointIndex = handle.object.userData.pointIndex;
      dragging = { roadId: selectedRoadId, pointIndex: selectedPointIndex, original: edits.roads, preview: null };
      renderer.domElement.setPointerCapture(ev.pointerId);
      updateRoadUI();
      ev.preventDefault();
      return;
    }
    const road = raycaster.intersectObjects(roadGroup.children, false)[0];
    if (road) selectRoad(road.object.userData.roadId);
    else { selectedPointIndex = -1; drawHandles(); updateRoadUI(); }
    return;
  }
  const pos = spatialPoint(ev);
  if (!pos) return;
  if (editMode === 'create') {
    if (!draftStart) {
      draftStart = pos;
      drawHandles();
      setMessage(`First point (${pos[0]}, ${pos[1]}) set. Click the end point. Esc to cancel.`);
    } else {
      const allIDs = new Set([...currentDoc.map.roads, ...currentDoc.map.water, ...currentDoc.map.settlements, ...currentDoc.map.buildings, ...currentDoc.map.objects].map(x => x.id));
      let i = 1;
      while (allIDs.has(`road_${String(i).padStart(2, '0')}`)) i++;
      const id = `road_${String(i).padStart(2, '0')}`;
      commitRoads([...edits.roads, { id, definition: 'road.path', width: 3, points: [draftStart, pos] }], 'New road added. Drag its handles to shape the path.');
      if (edits.roads.some(x => x.id === id)) selectRoad(id);
      setEditMode('edit');
    }
  } else {
    const road = currentRoad();
    if (!road) return;
    const roads = edits.roads;
    const candidate = roads.find(x => x.id === road.id);
    if (editMode === 'append') {
      candidate.points.push(pos);
      commitRoads(roads, 'Point appended.');
      selectedPointIndex = candidate.points.length - 1;
      setEditMode('edit');
    } else if (editMode === 'insert') {
      const nearest = nearestSegment(candidate.points, pos);
      if (nearest.distance > Math.max(7, candidate.width * 2)) { setMessage('Click closer to the selected road to insert.', true); return; }
      candidate.points.splice(nearest.index + 1, 0, pos);
      commitRoads(roads, 'Point inserted.');
      selectedPointIndex = nearest.index + 1;
      setEditMode('edit');
    }
  }
}
function editorPointerMove(ev) {
  brushPointerModifiers = { shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey };
  if (spacePan) return;
  if (polygonDrag) { polygonPointerMove(ev); return; }
  if (duplicateDraft) {
    const point = spatialPoint(ev);
    lastPointerWorld = point;
    if (point) updateDuplicatePreview(point);
    return;
  }
  if (edits.painting) {
    if (ev.pointerId !== brushStrokePointerId) return;
    const pos = terrainPoint(ev);
    if (pos) {
      brushPointerModifiers = { shiftKey: ev.shiftKey, ctrlKey: ev.ctrlKey };
      edits.strokeTo(pos, editMode === 'sculpt' ? effectiveSculptMode(el('sculptMode').value, ev) : 'paint');
      const now = performance.now();
      if (now - lastPreview > 42) {
        const changed = edits.takeStrokeBounds();
        if (changed) refreshTerrain(false, changed);
        lastPreview = now;
      }
      updateTerrainPointerFeedback(pos[0], pos[1]);
    }
    return;
  }
  if (editMode === 'place-entity' && !draggingEntity) {
    const now = performance.now();
    if (now - lastPreview > 50) { placementPoint = spatialPoint(ev); drawPlacement(); lastPreview = now; }
    return;
  }
  if (draggingEntity) {
    if (ev.pointerId !== draggingEntity.pointerId) return;
    const point = spatialPoint(ev);
    if (!point) return;
    try {
      const d = draggingEntity;
      const next = moveEntities(d.original, d.ids, d.id, point, currentDoc.map.terrain.size);
      if (d.kind === 'buildings') {
        for (const entry of next) if (d.ids.includes(entry.id)) {
          const result = placementFor(entry, next);
          if (!result.valid) throw new Error(placementReasons[result.reason] ?? result.reason);
        }
      }
      d.preview = next;
      for (const marker of entitiesGroup.children) {
        if (marker.userData.entityKind !== d.kind || !d.ids.includes(marker.userData.entityId)) continue;
        const entry = next.find(e => e.id === marker.userData.entityId);
        marker.position.set(entry.position[0], sampleHeight(currentDoc.map.terrain, currentDoc.height, ...entry.position) + 2.5, entry.position[1]);
      }
      const anchor = next.find(e => e.id === d.id);
      if (d.kind === 'buildings') drawPlacement(anchor, next);
    } catch { /* Keep last valid group preview; never commit invalid positions. */ }
    return;
  }

  if (!dragging) return;
  const point = spatialPoint(ev);
  if (!point) return;
  const roads = structuredClone(dragging.original);
  const road = roads.find(x => x.id === dragging.roadId);
  if (!road) return;
  road.points[dragging.pointIndex] = point;
  try {
    // No invalid adjacent point or off-map preview is ever committed.
    validateRoads(roads, currentDoc.map.terrain.size);
    dragging.preview = roads;
    repaintRoads(roads, true);
  } catch { /* Keep last valid preview. */ }
}
function editorPointerUp(ev) {
  if (polygonDrag) { polygonPointerUp(ev); return; }
  if (edits.painting) {
    if (ev.pointerId !== brushStrokePointerId) return;
    brushStrokePointerId = null;
    const strokeKind = editMode;
    const pending = edits.takeStrokeBounds();
    edits.endStroke();
    controls.enabled = true;
    if (renderer.domElement.hasPointerCapture(ev.pointerId)) renderer.domElement.releasePointerCapture(ev.pointerId);
    if (pending) refreshTerrain(false, pending);
    if (strokeKind === 'sculpt') { waterVersion++; repaintRoads(); drawPolygons(); repaintEntities(); }
    updateRoadUI();
    setMessage('Brush stroke recorded. Ctrl+Z to undo; Ctrl+S to save.');
    return;
  }
  if (draggingEntity) {
    if (draggingEntity.pointerId !== ev.pointerId) return;
    const { kind, preview } = draggingEntity;
    draggingEntity = null;
    controls.enabled = true;
    if (renderer.domElement.hasPointerCapture(ev.pointerId)) renderer.domElement.releasePointerCapture(ev.pointerId);
    if (preview) commitEntities(kind, preview, 'Marker moved. Ctrl+Z to undo.');
    repaintEntities(); updateEntityUI();
    return;
  }
  if (!dragging) return;
  const value = dragging.preview;
  dragging = null;
  if (renderer.domElement.hasPointerCapture(ev.pointerId)) renderer.domElement.releasePointerCapture(ev.pointerId);
  if (value) commitRoads(value, 'Point moved. Ctrl+Z to undo.');
  repaintRoads();
}
function encodeBytes(bytes) {
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(raw);
}
function encodeHeights(heights) {
  const bytes = new Uint8Array(heights.length * 4), view = new DataView(bytes.buffer);
  for (let i = 0; i < heights.length; i++) view.setFloat32(i * 4, heights[i], true);
  return encodeBytes(bytes);
}
function refreshTerrain(decorations = false, changed = null) {
  if (!terrainMesh) return;
  const geo = terrainMesh.geometry;
  const pos = geo.getAttribute('position');
  const colors = geo.getAttribute('color');
  if (changed) {
    const normals = geo.getAttribute('normal');
    const result = updateTerrainPatch(currentDoc.map.terrain, currentDoc.height, currentDoc.surface,
      currentDoc.map.terrain.surface_palette, pos.array, normals.array, colors.array, changed);
    for (const [attribute, rows] of [[pos, result.positions], [normals, result.normals], [colors, result.colors]]) {
      if (!rows.length) continue;
      attribute.clearUpdateRanges();
      for (const [start, count] of rows) attribute.addUpdateRange(start, count);
      attribute.needsUpdate = true;
    }

  } else {
    // Full refresh for history operations and metadata changes (not on every brush move).
    const range = currentDoc.map.terrain.max_height - currentDoc.map.terrain.min_height;
    for (let i = 0; i < currentDoc.height.data.length; i++) pos.array[i * 3 + 1] = currentDoc.map.terrain.min_height + currentDoc.height.data[i] * range;
    pos.clearUpdateRanges(); pos.needsUpdate = true;
    geo.getAttribute('normal').clearUpdateRanges();
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    colors.array.set(makeVertexColors(currentDoc.map.terrain, currentDoc.height, currentDoc.surface, currentDoc.map.terrain.surface_palette));
    colors.clearUpdateRanges(); colors.needsUpdate = true;
  }
  if (decorations) {
    repaintRoads();
    drawPolygons();
    repaintEntities();
  }
}
function updateTerrainPointerFeedback(x, z) {
  lastPointerWorld = [x, z];
  const { terrain, surface_palette } = currentDoc.map.terrain;
  const definition = surface_palette[surfaceAt(terrain, currentDoc.surface, x, z)];
  const action = editMode === 'sculpt' ? effectiveSculptMode(el('sculptMode').value, brushPointerModifiers).toUpperCase()
    : editMode === 'paint' ? (paintEyedropper ? 'PICK SURFACE' : 'PAINT') : '';
  el('probe').textContent = `${action ? action + ' · ' : ''}X ${x.toFixed(1)} · Z ${z.toFixed(1)} · H ${sampleHeight(terrain, currentDoc.height, x, z).toFixed(2)} m · ${definition}`;
  showBrushRing(x, z);
}
function showBrushRing(x, z) {
  const brushMode = editMode === 'sculpt' || editMode === 'paint';
  if (!brushMode || !brushRing) { if (brushRing) brushRing.visible = false; return; }
  const radius = Number(el('brushRadius').value);
  if (!Number.isFinite(radius) || radius <= 0) { brushRing.visible = false; return; }
  const attribute = brushRing.geometry.getAttribute('position');
  const positions = attribute.array;
  for (let i = 0; i < 64; i++) {
    const angle = i * Math.PI * 2 / 64;
    const px = Math.max(0, Math.min(currentDoc.map.terrain.size[0], x + radius * Math.cos(angle)));
    const pz = Math.max(0, Math.min(currentDoc.map.terrain.size[1], z + radius * Math.sin(angle)));
    positions[i * 3] = px;
    positions[i * 3 + 1] = sampleHeight(currentDoc.map.terrain, currentDoc.height, px, pz) + 0.2;
    positions[i * 3 + 2] = pz;
  }
  attribute.needsUpdate = true;
  brushRing.visible = true;
}
function updateTerrainUI() {
  for (const id of ['modeSculpt', 'modePaint']) el(id).disabled = currentDoc.readOnly || savePending;
  for (const id of ['sculptMode', 'brushRadius', 'brushStrength', 'brushSurface']) el(id).disabled = currentDoc.readOnly || savePending;
  el('sculptMode').disabled ||= editMode !== 'sculpt';
  el('brushSurface').disabled ||= editMode !== 'paint';
  el('modeSculpt').classList.toggle('active', editMode === 'sculpt');
  el('modePaint').classList.toggle('active', editMode === 'paint');
  el('terrainStatus').textContent = edits.isDirty ?
    [edits.heightDirty ? 'HEIGHTMAP' : '', edits.surfaceDirty ? 'SURFACE MAP' : '', edits.entityDirty ? 'MARKERS' : '', edits.roadDirty ? 'ROADS' : '', edits.polygonDirty ? 'WATER / BUILD AREAS' : ''].filter(Boolean).join(' · ') : 'NO UNSAVED CHANGES';
}
function performHistory(redo = false) {
  if (savePending || editingInProgress()) return;
  const kind = redo ? edits.redo() : edits.undo();
  if (kind === 'roads') repaintRoads();
  else if (kind === 'buildings' || kind === 'objects') { currentDoc.map[kind] = edits[kind]; updateEntityUI(); repaintEntities(); }
  else if (kind === 'water' || kind === 'settlements') { currentDoc.map[kind] = edits[kind]; drawPolygons(); updatePolygonUI(); updateWaterUI(); drawPlacement(); }
  else if (kind === 'height' || kind === 'surface') { if (kind === 'height') waterVersion++; refreshTerrain(true); drawWater(); drawPlacement(); }
  updateRoadUI(); updateTerrainUI(); updateEntityUI();
  if (kind) setMessage(redo ? 'Change redone.' : 'Change undone.');
}
async function saveRoadEdits() {
  if (savePending || !edits.isDirty || currentDoc.readOnly) return;
  if (editingInProgress()) { setMessage('Finish or cancel the current action before saving.', true); return; }
  savePending = true;
  updateRoadUI(); updateTerrainUI();
  setMessage('Saving map and immutable terrain assets…');
  try {
    const body = { revision: currentDoc.revision, mapFile: currentDoc.mapFile, roads: edits.roads, buildings: edits.buildings, objects: edits.objects, water: edits.water, settlements: edits.settlements };
    if (edits.heightDirty) body.heights = encodeHeights(currentDoc.height.data);
    if (edits.surfaceDirty) body.surfaces = encodeBytes(currentDoc.surface.data);
    const response = await fetch('/api/document', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(response.status === 409 ? `Save conflict: ${result.error}. Your browser edits are preserved.` : `Save failed: ${result.error}`);
    currentDoc.revision = result.revision;
    currentDoc.map.roads = edits.roads;
    currentDoc.map.buildings = edits.buildings;
    currentDoc.map.objects = edits.objects;
    currentDoc.map.water = edits.water;
    currentDoc.map.settlements = edits.settlements;
    edits.markSaved();
    currentDoc.map.terrain = result.terrain;
    setMessage('Map saved. Prior terrain assets remain untouched.');
    drawPolygons();
  } catch (error) { setMessage(error.message, true); }
  finally { savePending = false; updateRoadUI(); updateTerrainUI(); updateEntityUI(); }
}
function initializeEntityEditing() {
  el('modeEntities').addEventListener('click', () => setEditMode('entities'));
  el('placeEntity').addEventListener('click', () => setEditMode('place-entity'));
  el('entityKind').addEventListener('change', e => selectEntity(e.target.value, null));
  el('entitySelect').addEventListener('change', e => selectEntity(selectedEntityKind, e.target.value));
  for (const id of ['entityDefinition','entityRotation']) el(id).addEventListener('input', () => { if (editMode === 'place-entity') drawPlacement(); });
  el('applyEntity').addEventListener('click', () => {
    const item = currentEntity();
    if (!item || savePending) return;
    const items = edits[selectedEntityKind];
    const change = items.find(x => x.id === item.id);
    change.definition = el('entityDefinition').value.trim();
    change.rotation = Number(el('entityRotation').value);
    if (el('entityX').value.trim() === '' || el('entityZ').value.trim() === '') { setMessage('Both X and Z coordinates are required.', true); return; }
    change.position = [Number(el('entityX').value), Number(el('entityZ').value)];
    commitEntities(selectedEntityKind, items, 'Marker properties updated.');
  });
  el('deleteEntity').addEventListener('click', deleteSelectedEntities);
  updateEntityUI();
}
function initializeRoadEditing() {
  if (currentDoc.readOnly) { setMessage('Read-only server: saving and road editing are disabled.'); }
  el('modeNavigate').addEventListener('click', () => setEditMode('navigate'));
  el('modeEdit').addEventListener('click', () => setEditMode('edit'));
  el('newRoad').addEventListener('click', () => setEditMode('create'));
  el('appendPoint').addEventListener('click', () => setEditMode('append'));
  el('insertPoint').addEventListener('click', () => setEditMode('insert'));
  el('roadSelect').addEventListener('change', ev => selectRoad(ev.target.value));
  el('roadWidth').addEventListener('change', ev => {
    if (!currentRoad() || currentDoc.readOnly || savePending) return;
    const width = Number(ev.target.value);
    const roads = edits.roads;
    roads.find(x => x.id === selectedRoadId).width = width;
    commitRoads(roads, 'Road width updated.');
    if (!edits.roads.some(r => r.id === selectedRoadId && r.width === width)) ev.target.value = String(currentRoad()?.width ?? 3);
    updateRoadUI();
  });
  el('applyRoadPoint').addEventListener('click', () => {
    if (savePending || currentDoc.readOnly || selectedPointIndex < 0 || !currentRoad()) return;
    const x = el('roadPointX').value.trim(), z = el('roadPointZ').value.trim();
    if (!x || !z) { setMessage('X and Z are required.', true); return; }
    const next = edits.roads;
    next.find(r => r.id === selectedRoadId).points[selectedPointIndex] = [Number(x), Number(z)];
    commitRoads(next, 'Road point coordinates updated.');
  });
  el('deletePoint').addEventListener('click', () => {
    if (!currentRoad() || selectedPointIndex < 0 || currentRoad().points.length <= 2 || savePending) return;
    const roads = edits.roads;
    roads.find(x => x.id === selectedRoadId).points.splice(selectedPointIndex, 1);
    selectedPointIndex = -1;
    commitRoads(roads, 'Road point removed.');
  });
  el('deleteRoad').addEventListener('click', () => {
    if (!currentRoad() || savePending || !window.confirm(`Delete road "${selectedRoadId}"? You can undo this.`)) return;
    commitRoads(edits.roads.filter(x => x.id !== selectedRoadId), 'Road removed. Ctrl+Z to undo.');
  });
  el('undo').addEventListener('click', () => performHistory());
  el('redo').addEventListener('click', () => performHistory(true));
  el('duplicateSelected').addEventListener('click', startDuplicateAtCursor);
  el('gridSnap').addEventListener('change', () => setMessage(el('gridSnap').checked ? 'Grid snapping enabled. Hold Alt for free placement.' : 'Free placement enabled.'));
  el('gridStep').addEventListener('change', () => {
    const step = Number(el('gridStep').value);
    if (!Number.isFinite(step) || step < 0.25 || step > 100) { el('gridStep').value = '1'; setMessage('Grid step reset to 1 meter.', true); }
  });
  el('saveRoads').addEventListener('click', saveRoadEdits);
  el('modeSculpt').addEventListener('click', () => setEditMode('sculpt'));
  el('modePaint').addEventListener('click', () => setEditMode('paint'));
  for (const id of ['brushRadius','brushStrength','sculptMode','brushSurface']) el(id).addEventListener('change', updateTerrainUI);
  renderer.domElement.addEventListener('wheel', ev => {
    if (!ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey || !['sculpt','paint'].includes(editMode) || edits.painting) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const delta = Math.abs(ev.deltaY) >= Math.abs(ev.deltaX) ? ev.deltaY : ev.deltaX;
    if (delta) setBrushRadius(resizeBrush(Number(el('brushRadius').value), delta < 0 ? 1 : -1));
  }, { capture: true, passive: false });
  renderer.domElement.addEventListener('pointerdown', editorPointerDown);
  renderer.domElement.addEventListener('pointermove', editorPointerMove);
  renderer.domElement.addEventListener('pointerup', editorPointerUp);
  renderer.domElement.addEventListener('pointercancel', cancelDrag);
  window.addEventListener('blur', () => { cancelDrag(); clearDuplicateDraft(); paintEyedropper = false; spacePan = false; controls.mouseButtons.LEFT = null; renderEditorChrome(); });
  window.addEventListener('beforeunload', event => { if (edits.isDirty && !intentionalReload) event.preventDefault(); });
  document.addEventListener('keydown', event => {
    if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,[contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    if (['shift','control'].includes(key)) { brushPointerModifiers = { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey }; if (lastPointerWorld) updateTerrainPointerFeedback(...lastPointerWorld); }
    if (key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!editingInProgress() && !event.repeat) { spacePan = true; controls.mouseButtons.LEFT = THREE.MOUSE.PAN; }
      return;
    }
    if (key === 'i' && !event.ctrlKey && !event.metaKey && !event.altKey && editMode === 'paint') {
      if (!event.repeat) { paintEyedropper = true; renderEditorChrome(); if (lastPointerWorld) updateTerrainPointerFeedback(...lastPointerWorld); }
      return;
    }
    if (event.repeat) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'z') {
      event.preventDefault();
      performHistory(event.shiftKey);
    } else if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'y') {
      event.preventDefault();
      performHistory(true);
    } else if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 's') {
      event.preventDefault(); saveRoadEdits();
    } else if ((event.ctrlKey || event.metaKey) && key === 'a' && (editMode === 'select' || editMode === 'entities') && !savePending && !editingInProgress()) {
      event.preventDefault();
      selectedEntityIds = new Set(edits[selectedEntityKind].map(e => e.id));
      selectedEntityId = selectedEntityIds.values().next().value ?? null;
      if (editMode === 'select') selectionContext = selectedEntityIds.size ? 'entity' : null;
      updateEntityUI(); repaintEntities(); renderEditorChrome();
    } else if (!event.ctrlKey && !event.altKey && !event.metaKey && (key === 'q' || key === 'e')) {
      event.preventDefault(); cycleCurrentSubtool(key === 'q' ? -1 : 1);
    } else if (!event.ctrlKey && !event.altKey && !event.metaKey && key === 'g') {
      event.preventDefault();
      el('gridSnap').checked = !el('gridSnap').checked;
      el('gridSnap').dispatchEvent(new Event('change'));
    } else if (!event.ctrlKey && !event.altKey && !event.metaKey && key === 'r') {
      event.preventDefault();
      if (duplicateDraft) {
        if (duplicateDraft.kind !== 'road') { duplicateDraft.rotationOffset = (duplicateDraft.rotationOffset + (event.shiftKey ? -15 : 15) + 360) % 360; if (lastPointerWorld) updateDuplicatePreview(lastPointerWorld, true); }
      } else rotateActiveMarker(event.shiftKey ? -1 : 1);
    } else if (!event.ctrlKey && !event.altKey && !event.metaKey && key === 'd') {
      event.preventDefault(); startDuplicateAtCursor();
    } else if (key === 'escape') {
      if (duplicateDraft) { event.preventDefault(); clearDuplicateDraft(); setMessage('Duplication canceled.'); return; }
      if (closeOpenPanel()) { event.preventDefault(); return; }
      if (polygonDrag || dragging || draggingEntity) cancelDrag();
      else if (polygonDraft) cancelPolygonDraft();
      else if (editMode === 'select' && selectionContext) { selectionContext = null; selectedEntityIds.clear(); selectedEntityId = null; updateEntityUI(); repaintEntities(); renderEditorChrome(); }
      else setEditMode('select');
    } else if (key === 'enter' && polygonDraft) {
      event.preventDefault(); finishPolygon();
    } else if ((key === 'backspace' || key === 'delete') && polygonDraft) {
      event.preventDefault(); polygonDraft.points.pop(); drawPolygons(); updatePolygonUI();
    } else if ((key === 'delete' || key === 'backspace') && (editMode === 'entities' || (editMode === 'select' && selectionContext === 'entity')) && selectedEntityIds.size) {
      event.preventDefault(); el('deleteEntity').click();
    } else if ((key === 'delete' || key === 'backspace') && selectedPointIndex >= 0 && editMode === 'edit') {
      event.preventDefault(); el('deletePoint').click();
    } else if ((key === 'delete' || key === 'backspace') && !editingInProgress() && editMode === 'select' && selectionContext === 'road' && currentRoad()) {
      event.preventDefault(); el('deleteRoad').click();
    } else if ((key === 'delete' || key === 'backspace') && !editingInProgress() && editMode === 'select' && selectionContext === 'polygon' && currentPolygon()) {
      event.preventDefault(); el('deletePolygon').click();
    } else {
      const tool = toolShortcut(event);
      if (tool) { event.preventDefault(); selectTool(tool); }
    }
  });
  document.addEventListener('keyup', event => {
    if (event.key === ' ') { spacePan = false; controls.mouseButtons.LEFT = null; }
    if (event.key.toLowerCase() === 'i') { paintEyedropper = false; renderEditorChrome(); if (lastPointerWorld) updateTerrainPointerFeedback(...lastPointerWorld); }
    if (['Shift','Control'].includes(event.key)) { brushPointerModifiers = { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey }; if (lastPointerWorld) updateTerrainPointerFeedback(...lastPointerWorld); }
  });
  updateRoadUI(); updateTerrainUI();
}


function initializeMapManagement() {
  const section = el('mapManager');
  if (!currentDoc.workspace) { section.hidden = true; return; }
  const map = currentDoc.map;
  el('documentPath').textContent = currentDoc.mapFile;
  el('settingsName').value = map.name;
  el('settingsMinHeight').value = map.terrain.min_height;
  el('settingsMaxHeight').value = map.terrain.max_height;
  el('settingsPalette').value = map.terrain.surface_palette.join('\n');
  el('mapAssetPaths').textContent = `Heightmap: ${map.terrain.heightmap}\nSurface map: ${map.terrain.surface_map}\nImmutable terrain revisions are retained on disk.`;

  const number = id => {
    const input = el(id);
    if (!input.value.trim()) throw new Error(`Missing value: ${id}`);
    const value = Number(input.value);
    if (!Number.isFinite(value)) throw new Error(`Invalid number: ${id}`);
    return value;
  };
  const refresh = async () => {
    const response = await fetchResource('/api/maps');
    const { maps } = await response.json();
    const picker = el('workspaceMaps');
    picker.replaceChildren();
    for (const entry of maps) {
      const option = document.createElement('option');
      option.value = entry.file;
      option.textContent = `${entry.name} (${entry.file})${entry.valid ? '' : ' · INVALID'}`;
      option.disabled = !entry.valid;
      option.selected = entry.active;
      picker.append(option);
    }
  };
  const write = async (path, method, data) => {
    if (workspacePending || savePending) return;
    if (edits.isDirty && !window.confirm('Discard unsaved editor changes?')) return;
    if (editingInProgress()) throw new Error('Finish the current edit first');
    workspacePending = true;
    for (const id of ['openWorkspaceMap','refreshWorkspaceMaps','createWorkspaceMap','applyMapSettings']) el(id).disabled = true;
    try {
      const response = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, revision: currentDoc.revision, mapFile: currentDoc.mapFile }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`Workspace: ${result.error ?? `HTTP ${response.status}`}`);
      intentionalReload = true;
      window.location.reload();
    } finally {
      workspacePending = false;
      for (const id of ['openWorkspaceMap','refreshWorkspaceMaps','createWorkspaceMap','applyMapSettings']) el(id).disabled = false;
    }
  };
  const execute = action => async () => {
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error), true); }
  };
  el('refreshWorkspaceMaps').addEventListener('click', execute(refresh));
  el('openWorkspaceMap').addEventListener('click', execute(async () => {
    const file = el('workspaceMaps').value;
    if (!file) throw new Error('Select a map');
    if (file === currentDoc.mapFile) { setMessage('Already viewing this map.'); return; }
    await write('/api/maps/active', 'PUT', { file });
  }));
  el('createWorkspaceMap').addEventListener('click', execute(async () => {
    const form = validateCreate({
      slug: el('newMapSlug').value.trim(), name: el('newMapName').value.trim(),
      worldSize: [number('newMapWidth'), number('newMapDepth')],
      heightSamples: [number('newMapSamplesX'), number('newMapSamplesZ')],
      minHeight: number('newMapMinHeight'), maxHeight: number('newMapMaxHeight'),
      surfacePalette: parsePalette(el('newMapPalette').value),
    });
    await write('/api/maps/create', 'POST', { form });
  }));
  el('applyMapSettings').addEventListener('click', execute(async () => {
    const settings = {
      name: el('settingsName').value.trim(),
      min_height: number('settingsMinHeight'), max_height: number('settingsMaxHeight'),
      surface_palette: parsePalette(el('settingsPalette').value),
    };
    if (!settings.name || settings.name.length > 100) throw new Error('Invalid map name');
    if (settings.min_height >= settings.max_height) throw new Error('Minimum elevation must be below maximum elevation');
    if (settings.surface_palette.length <= Math.max(...currentDoc.surface.data)) {
      throw new Error('Palette cannot omit surface IDs still used by terrain');
    }
    await write('/api/maps/settings', 'PUT', { settings });
  }));
  refresh().catch(e => setMessage(`Unable to list maps: ${e.message}`, true));
}

try {
  currentDoc = await getDocument();
  edits = new MapEdits(currentDoc);
  selectedRoadId = currentDoc.map.roads[0]?.id ?? null;
  configureDetails(currentDoc);
  initScene(currentDoc);
  initializeRoadEditing();
  initializeMapManagement();
  const choices = el('buildingDefinitionChoices');
  for (const definition of currentDoc.definitions.buildings) {
    const option = document.createElement('option'); option.value = definition.id; choices.append(option);
  }
  initializeEntityEditing();
  initializePolygonEditing();
  initializeWaterEditing();
  layerNames.forEach(id => el(id).addEventListener('change', setLayerVisibility));
  el('resetCamera').addEventListener('click', focusCamera);
  document.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.altKey && !e.metaKey && !(e.target instanceof HTMLElement && e.target.closest('input,select,textarea,[contenteditable=true]'))) { e.preventDefault(); focusCamera(); } });
  initializeEditorChrome();
  renderEditorChrome();
  loading.remove();
} catch (error) {
  el('loadingText').textContent = `Cannot open map: ${error instanceof Error ? error.message : String(error)}`;
  loading.classList.add('error');
  console.error(error);
}
