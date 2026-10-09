import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTerrainGeometry, makeVertexColors, paletteColor, sampleHeight, surfaceAt } from './mesh-data.mjs';
import { RoadEdits, nearestSegment, validateRoads } from './road-edit.mjs';

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
let edits;
let selectedRoadId = null;
let selectedPointIndex = -1;
let editMode = 'navigate';
let draftStart = null;
let dragging = null;
let savePending = false;
let handleGroup;
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
  if (typeof meta.readOnly !== 'boolean') throw new Error('Map server lacks edit capabilities');
  if (meta.height.width * meta.height.height * 4 !== heights.byteLength) throw new Error('Heightmap byte length mismatch');
  if (meta.surface.width * meta.surface.height !== surfaces.byteLength) throw new Error('Surface map byte length mismatch');
  if (meta.surface.width !== meta.height.width - 1 || meta.surface.height !== meta.height.height - 1) throw new Error('Surface grid does not match height grid');
  return { readOnly: meta.readOnly, revision: meta.revision, map: meta.map, height: { ...meta.height, data: decodeFloats(heights) }, surface: { ...meta.surface, data: new Uint8Array(surfaces) } };
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
  for (const road of map.roads) {
    const mesh = createRoadMesh(road, map, height);
    mesh.userData.roadId = road.id;
    roadGroup.add(mesh);
  }
  scene.add(roadGroup);
  handleGroup = new THREE.Group();
  scene.add(handleGroup);
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
    if (dragging) return;
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
  if (!road || editMode === 'navigate') return;
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
  el('pointInfo').textContent = road && selectedPointIndex >= 0 && selectedPointIndex < road.points.length
    ? `Point ${selectedPointIndex + 1} / ${road.points.length} · X ${road.points[selectedPointIndex][0].toFixed(2)} · Z ${road.points[selectedPointIndex][1].toFixed(2)}`
    : road ? `${road.points.length} points · Click a handle to select and drag` : 'No road selected';
  el('roadsCount').textContent = String(roads.length);
  for (const id of ['modeEdit','newRoad','deleteRoad','appendPoint','insertPoint','deletePoint']) el(id).disabled = currentDoc.readOnly || savePending || (['deleteRoad','appendPoint','insertPoint','deletePoint'].includes(id) && !road) || (id === 'deletePoint' && (selectedPointIndex < 0 || !road || road.points.length <= 2));
  el('modeNavigate').disabled = savePending;
  el('deleteRoad').disabled = el('deleteRoad').disabled || !road;
  el('undo').disabled = savePending || !edits.canUndo;
  el('redo').disabled = savePending || !edits.canRedo;
  el('saveRoads').disabled = savePending || !edits.isDirty || currentDoc.readOnly;
  el('saveRoads').textContent = savePending ? 'Saving…' : 'Save roads';
  el('modeNavigate').classList.toggle('active', editMode === 'navigate');
  el('modeEdit').classList.toggle('active', editMode !== 'navigate');
  el('mapName').textContent = `${currentDoc.map.name}${edits.isDirty ? ' •' : ''}`;
  document.querySelector('.status-dot').classList.toggle('dirty', edits.isDirty);
  document.querySelector('.quiet').textContent = currentDoc.readOnly ? 'READ ONLY' : edits.isDirty ? 'UNSAVED CHANGES' : 'ROADS · SAVED';
  document.querySelector('.side-footer span').textContent = edits.isDirty ? 'Unsaved road edits · terrain unchanged.' : 'Road edits write only the map JSON.';
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
    }
  } catch (error) { setMessage(error.message, true); }
}
function selectRoad(id) {
  selectedRoadId = id;
  selectedPointIndex = -1;
  drawRoads(); drawHandles(); updateRoadUI();
}
function setEditMode(next) {
  if (currentDoc.readOnly && next !== 'navigate') return;
  if (dragging) cancelDrag();
  editMode = next;
  draftStart = null;
  controls.enableRotate = next === 'navigate';
  viewport.classList.toggle('edit-cursor', next !== 'navigate');
  if (next !== 'navigate') { el('roads').checked = true; setLayerVisibility(); }
  const hints = {
    navigate: 'Navigate mode: left-drag to orbit; right-drag to pan.',
    edit: 'Drag a highlighted road handle. Click another road to select.',
    create: 'Click the terrain to set the first point of the new road.',
    append: 'Click the terrain to append a point to the selected road.',
    insert: 'Click near a road segment to insert a point.',
  };
  setMessage(hints[next]);
  drawHandles(); updateRoadUI();
}
function makeRay(ev) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set((ev.clientX - rect.left) / rect.width * 2 - 1, -((ev.clientY - rect.top) / rect.height * 2 - 1));
  raycaster.setFromCamera(pointer, camera);
}
function terrainPoint(ev) {
  makeRay(ev);
  const hit = raycaster.intersectObject(terrainMesh, false)[0];
  return hit ? [Number(hit.point.x.toFixed(4)), Number(hit.point.z.toFixed(4))] : null;
}
function cancelDrag() {
  if (!dragging) return;
  dragging = null;
  repaintRoads();
}
function editorPointerDown(ev) {
  if (ev.button !== 0 || editMode === 'navigate' || currentDoc.readOnly || savePending) return;
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
  const pos = terrainPoint(ev);
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
  if (!dragging) return;
  const point = terrainPoint(ev);
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
  if (!dragging) return;
  const value = dragging.preview;
  dragging = null;
  if (renderer.domElement.hasPointerCapture(ev.pointerId)) renderer.domElement.releasePointerCapture(ev.pointerId);
  if (value) commitRoads(value, 'Point moved. Ctrl+Z to undo.');
  repaintRoads();
}
async function saveRoadEdits() {
  if (savePending || !edits.isDirty || currentDoc.readOnly) return;
  if (dragging) { setMessage('Finish the point drag before saving.', true); return; }
  const saved = edits.roads;
  savePending = true;
  updateRoadUI();
  setMessage('Saving road JSON atomically…');
  try {
    const response = await fetch('/api/roads', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: currentDoc.revision, roads: saved }) });
    const result = await response.json();
    if (!response.ok) throw new Error(response.status === 409 ? `Save conflict: ${result.error}. Your browser edits are preserved.` : `Save failed: ${result.error}`);
    currentDoc.revision = result.revision;
    edits.markSaved(saved);
    setMessage('Road changes saved to map JSON. Terrain assets were not modified.');
  } catch (error) { setMessage(error.message, true); }
  finally { savePending = false; updateRoadUI(); }
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
  el('undo').addEventListener('click', () => { if (edits.undo()) { repaintRoads(); setMessage('Undid road edit.'); } });
  el('redo').addEventListener('click', () => { if (edits.redo()) { repaintRoads(); setMessage('Redid road edit.'); } });
  el('saveRoads').addEventListener('click', saveRoadEdits);
  renderer.domElement.addEventListener('pointerdown', editorPointerDown);
  renderer.domElement.addEventListener('pointermove', editorPointerMove);
  renderer.domElement.addEventListener('pointerup', editorPointerUp);
  renderer.domElement.addEventListener('pointercancel', cancelDrag);
  window.addEventListener('blur', cancelDrag);
  window.addEventListener('beforeunload', event => { if (edits.isDirty) event.preventDefault(); });
  document.addEventListener('keydown', event => {
    if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,[contenteditable=true]')) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'z') {
      event.preventDefault();
      if (!savePending && (event.shiftKey ? edits.redo() : edits.undo())) repaintRoads();
    } else if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 'y') {
      event.preventDefault();
      if (!savePending && edits.redo()) repaintRoads();
    } else if ((event.ctrlKey || event.metaKey) && !event.altKey && key === 's') {
      event.preventDefault(); saveRoadEdits();
    } else if (key === 'escape') {
      if (dragging) cancelDrag();
      else setEditMode('edit');
    } else if ((key === 'delete' || key === 'backspace') && selectedPointIndex >= 0 && editMode === 'edit') {
      event.preventDefault(); el('deletePoint').click();
    }
  });
  updateRoadUI();
}


try {
  currentDoc = await getDocument();
  edits = new RoadEdits(currentDoc.map.roads, currentDoc.map.terrain.size);
  selectedRoadId = currentDoc.map.roads[0]?.id ?? null;
  configureDetails(currentDoc);
  initScene(currentDoc);
  initializeRoadEditing();
  layerNames.forEach(id => el(id).addEventListener('change', setLayerVisibility));
  el('resetCamera').addEventListener('click', resetCamera);
  document.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.altKey && !e.metaKey) resetCamera(); });
  loading.remove();
} catch (error) {
  el('loadingText').textContent = `Cannot open map: ${error instanceof Error ? error.message : String(error)}`;
  loading.classList.add('error');
  console.error(error);
}
