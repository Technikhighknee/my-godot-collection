import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_TREE, generateTree } from './tree.mjs';
import { generateFir } from './fir.mjs';
import { generateOakFoliage } from './oak-foliage.mjs';
import { paintOakAtlas } from './oak-atlas.mjs';

const byId = id => document.getElementById(id);
const settings = { ...DEFAULT_TREE };
let species = 'oak';
let renderer, camera, scene, controls, wood, foliage, treeGroup, extents;
let oakAtlasTexture;
let woodBounds, foliageBounds;
let spinning = false, silhouette = false, foliageVisible = true;

function setupScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18272a);
  scene.fog = new THREE.Fog(0x18272a, 28, 85);
  camera = new THREE.PerspectiveCamera(38, 1, .05, 160);
  renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  byId('viewport').append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xd7ded5, 0x666257, 2.0));
  const light = new THREE.DirectionalLight(0xffe8cd, 2.9);
  light.position.set(-6, 14, 8);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.left = -12;
  light.shadow.camera.right = 12;
  light.shadow.camera.top = 15;
  light.shadow.camera.bottom = -12;
  light.shadow.camera.near = .1;
  light.shadow.camera.far = 40;
  light.shadow.bias = -.0004;
  scene.add(light);
  const fill = new THREE.DirectionalLight(0xc1ccd5, 1.4);
  fill.position.set(7, 6, -8);
  scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(65,65),
    new THREE.MeshStandardMaterial({color:0x26342e,roughness:1}));
  ground.rotation.x = -Math.PI/2;
  ground.position.y = -.07;
  ground.receiveShadow = true;
  scene.add(ground);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .075;
  controls.screenSpacePanning = true;
  controls.minDistance = 1;
  controls.maxDistance = 65;
  controls.maxPolarAngle = Math.PI * .87;
  controls.addEventListener('start',()=>{
    spinning = false;
    byId('turntable').setAttribute('aria-pressed','false');
  });
  new ResizeObserver(()=>{
    const el=byId('viewport');
    const w=Math.max(1,el.clientWidth),h=Math.max(1,el.clientHeight);
    renderer.setSize(w,h,false);
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
  }).observe(byId('viewport'));
  const tick=()=>{
    requestAnimationFrame(tick);
    if (spinning && treeGroup) treeGroup.rotation.y += .003;
    controls.update();
    renderer.render(scene,camera);
  };
  tick();
}

function focus(mode) {
  if (!extents) return;
  const lo=extents.min, hi=extents.max;
  const center=new THREE.Vector3((lo[0]+hi[0])*.5,(lo[1]+hi[1])*.5,(lo[2]+hi[2])*.5);
  const size=Math.max(...hi.map((v,i)=>v-lo[i]));
  if (mode==='foot') {
    controls.target.set(0,.65,0);
    camera.position.set(2.25,1.65,3.4);
  } else if (mode==='crown') {
    controls.target.set(center.x,lo[1]+(hi[1]-lo[1])*.72,center.z);
    camera.position.set(center.x+size*.52,hi[1]+size*.27,center.z+size*.85);
  } else {
    controls.target.copy(center);
    camera.position.set(center.x+size*.69,center.y+size*.25,center.z+size*1.65);
  }
  controls.update();
}

function updateFoliageUI() {
  const enabled = species==='oak';
  const button=byId('foliageToggle');
  button.hidden=!enabled;
  button.setAttribute('aria-pressed',String(enabled&&foliageVisible));
  button.textContent=foliageVisible?'Hide leaves':'Show leaves';
  byId('stageContent').textContent=enabled&&foliageVisible
    ?'WOOD + FOLIAGE':'WOOD ONLY';
}
function mergedBounds(a,b) {
  if(!b)return a;
  return {
    min:a.min.map((v,i)=>Math.min(v,b.min[i])),
    max:a.max.map((v,i)=>Math.max(v,b.max[i])),
  };
}
function updateLeafVisibility() {
  if(foliage)foliage.visible=species==='oak'&&foliageVisible;
  extents=foliage?.visible?mergedBounds(woodBounds,foliageBounds):woodBounds;
  updateFoliageUI();
}
function geometryFrom(data,colors=false) {
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));
  if(colors)geometry.setAttribute('color',new THREE.BufferAttribute(data.colors,3));
  if(data.uvs)geometry.setAttribute('uv',new THREE.BufferAttribute(data.uvs,2));
  geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
  geometry.computeBoundingSphere();
  return geometry;
}
// The shared atlas is painted only once, reused for every tree seed.
function oakTexture(){
  if(!oakAtlasTexture){
    const canvas=document.createElement('canvas');
    paintOakAtlas(canvas);
    oakAtlasTexture=new THREE.CanvasTexture(canvas);
    oakAtlasTexture.colorSpace=THREE.SRGBColorSpace;
    oakAtlasTexture.wrapS=THREE.ClampToEdgeWrapping;
    oakAtlasTexture.wrapT=THREE.ClampToEdgeWrapping;
    oakAtlasTexture.minFilter=THREE.LinearMipmapLinearFilter;
    oakAtlasTexture.magFilter=THREE.LinearFilter;
    oakAtlasTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    oakAtlasTexture.generateMipmaps=true;
  }
  return oakAtlasTexture;
}
function build() {
  let replacement=null;
  try {
    const started=performance.now();
    const result=species==='fir'?generateFir(settings):generateTree(settings);
    const foliageData=species==='oak'?generateOakFoliage(result):null;
    replacement=new THREE.Group();
    const woodMesh=new THREE.Mesh(geometryFrom(result),
      new THREE.MeshStandardMaterial({
        color:silhouette?0x050909:0xa49c8e,
        roughness:.96,metalness:0,side:THREE.FrontSide,
      }));
    woodMesh.castShadow=true;
    woodMesh.receiveShadow=true;
    replacement.add(woodMesh);
    let leavesMesh=null;
    if(foliageData){
      leavesMesh=new THREE.Mesh(geometryFrom(foliageData,true),
        new THREE.MeshStandardMaterial({
          map:oakTexture(),color:silhouette?0x050909:0xffffff,
          vertexColors:true,roughness:.93,metalness:0,
          alphaTest:.43,alphaToCoverage:true,depthWrite:true,
          transparent:false,side:THREE.DoubleSide,
        }));
      leavesMesh.castShadow=true;
      replacement.add(leavesMesh);
    }
    if(treeGroup){
      replacement.rotation.copy(treeGroup.rotation);
      scene.remove(treeGroup);
      treeGroup.traverse(node=>{
        if(node.isMesh){node.geometry.dispose();node.material.dispose();}
      });
    }
    treeGroup=replacement;
    wood=woodMesh;
    foliage=leavesMesh;
    woodBounds=result.bounds;
    foliageBounds=foliageData?.bounds??null;
    updateLeafVisibility();
    scene.add(treeGroup);
    const triangles=result.indices.length+(foliageData?.indices.length??0);
    byId('meshStats').textContent =result.branches.length+
      ' WOOD AXES · '+(foliageData?foliageData.cardCount+' FOLIAGE CARDS · ':'')+
      (triangles/3).toLocaleString()+' TRIS';
    byId('status').textContent='Geometry ready · '+Math.round(performance.now()-started)+' ms';
    byId('seedValue').value=String(settings.seed);
    byId('error').hidden=true;
  } catch(error) {
    // Leave the previous complete asset displayed on generation errors.
    if(replacement&&replacement!==treeGroup)
      replacement.traverse(node=>{
        if(node.isMesh){node.geometry.dispose();node.material.dispose();}
      });
    byId('status').textContent='Generation failed';
    byId('error').hidden=false;
    byId('error').textContent=error.message;
    console.error(error);
  }
}
function selectSpecies(next){
  if(next!=='fir'&&next!=='oak')return;
  species=next;
  const isFir=next==='fir';
  for(const kind of ['oak','fir']){
    const button=byId(kind+'Generator');
    const selected=kind===next;
    button.setAttribute('aria-pressed',String(selected));
    if(selected)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  byId('speciesSelect').value=next;
  byId('assetOverline').textContent=isFir?'FIR / WOOD GEOMETRY':'OAK / WOOD + FOLIAGE';
  byId('assetTitle').textContent=isFir?'Fir wood.':'Oak in leaf.';
  byId('assetDescription').textContent=isFir
    ?'A young fir with a continuous leader, layered branch whorls and fine lateral shoots. Wood only; no needles, bark texture or export.'
    :'A European oak with branch-supported textured leaf cushions generated from a procedural oak atlas. No bark texture or export.';
  byId('viewport').setAttribute('aria-label',
    isFir?'Interactive 3D fir wood preview':'Interactive 3D oak tree wood preview');
  build();
  focus('whole');
}
for(const kind of ['oak','fir'])
  byId(kind+'Generator').addEventListener('click',()=>selectSpecies(kind));
byId('speciesSelect').addEventListener('change',e=>selectSpecies(e.target.value));
byId('seedValue').addEventListener('change',()=>{
  const field=byId('seedValue'),value=Number(field.value);
  if (!Number.isInteger(value)||value<0||value>0xffffffff||field.value.trim()==='') {
    byId('status').textContent='Seed must be an integer between 0 and 4294967295';
    field.value=String(settings.seed);
    return;
  }
  settings.seed=value;
  build();
  focus('whole');
});
byId('reseed').addEventListener('click',()=>{
  settings.seed=crypto.getRandomValues(new Uint32Array(1))[0];
  build();
  focus('whole');
});
byId('whole').addEventListener('click',()=>focus('whole'));
byId('foot').addEventListener('click',()=>focus('foot'));
byId('crown').addEventListener('click',()=>focus('crown'));
byId('foliageToggle').addEventListener('click',()=>{
  if(species!=='oak')return;
  foliageVisible=!foliageVisible;
  updateLeafVisibility();
});
byId('silhouette').addEventListener('click',()=>{
  silhouette=!silhouette;
  byId('silhouette').setAttribute('aria-pressed',String(silhouette));
  if(wood)wood.material.color.setHex(silhouette?0x050909:0xa49c8e);
  if(foliage)foliage.material.color.setHex(silhouette?0x050909:0xffffff);
  scene.background.setHex(silhouette?0xaab9b0:0x18272a);
  scene.fog.color.setHex(silhouette?0xaab9b0:0x18272a);
});
byId('turntable').addEventListener('click',()=>{
  spinning=!spinning;
  byId('turntable').setAttribute('aria-pressed',String(spinning));
});
try {
  byId('seedValue').value=String(settings.seed);
  setupScene();
  selectSpecies(species);
} catch(error) {
  byId('error').hidden=false;
  byId('error').textContent=error.message;
  byId('status').textContent='Preview unavailable';
  console.error(error);
}
