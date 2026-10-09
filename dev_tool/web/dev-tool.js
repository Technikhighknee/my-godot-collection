const mapName = document.getElementById('dt-map-name');
const mapDetail = document.getElementById('dt-map-detail');
try {
  const response = await fetch('/api/map', { cache: 'no-store' });
  if (!response.ok) throw new Error('Map unavailable');
  const { map, mapFile, readOnly } = await response.json();
  mapName.textContent = map.name;
  const [width, depth] = map.terrain.size;
  mapDetail.textContent = (mapFile ? mapFile + ' · ' : '') + width + ' × ' + depth + ' m' + (readOnly ? ' · Read-only' : '');
} catch {
  mapName.textContent = 'Map unavailable';
  mapDetail.textContent = 'Check the active map in the local server.';
}
