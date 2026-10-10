import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_TREE, generateTree } from './tree.mjs';

const byId = id => document.getElementById(id);
const settings = { ...DEFAULT_TREE };
let renderer, camera, scene, controls, wood, extents;
let spinning = false, silhouette = false;

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
    if (spinning && wood) wood.rotation.y += .003;
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

function build() {
  try {
    const started=performance.now();
    const result=generateTree(settings);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(result.positions,3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(result.normals,3));
    geometry.setIndex(new THREE.BufferAttribute(result.indices,1));
    geometry.computeBoundingSphere();
    const material=new THREE.MeshStandardMaterial({
      color:silhouette?0x050909:0xa49c8e,roughness:.96,metalness:0,
      side:THREE.FrontSide,
    });
    const mesh=new THREE.Mesh(geometry,material);
    mesh.castShadow=true;
    mesh.receiveShadow=true;
    if (wood) {
      scene.remove(wood);
      wood.geometry.dispose();
      wood.material.dispose();
    }
    wood=mesh;
    extents=result.bounds;
    scene.add(wood);
    byId('meshStats').textContent =
      result.branches.length+' WOOD AXES · '+(result.indices.length/3).toLocaleString()+' TRIS';
    byId('status').textContent='Geometry ready · '+Math.round(performance.now()-started)+' ms';
    byId('seedValue').value=String(settings.seed);
    byId('error').hidden=true;
  } catch(error) {
    byId('status').textContent='Generation failed';
    byId('error').hidden=false;
    byId('error').textContent=error.message;
    console.error(error);
  }
}
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
byId('silhouette').addEventListener('click',()=>{
  silhouette=!silhouette;
  byId('silhouette').setAttribute('aria-pressed',String(silhouette));
  if(wood)wood.material.color.setHex(silhouette?0x050909:0xa49c8e);
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
  build();
  focus('whole');
} catch(error) {
  byId('error').hidden=false;
  byId('error').textContent=error.message;
  byId('status').textContent='Preview unavailable';
  console.error(error);
}
