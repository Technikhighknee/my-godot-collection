import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_RECIPE, validateRecipe, generateTree, variantSeeds } from './tree.mjs';
import { exportGlb, inspectGlb } from './glb.mjs';

const $ = id => document.getElementById(id);
const inputs = [...document.querySelectorAll('[data-param]')];
const outputs = {
  height:'heightValue', crownRadius:'crownRadiusValue', trunkRadius:'trunkRadiusValue',
  branchDensity:'branchDensityValue', leafDensity:'leafDensityValue', asymmetry:'asymmetryValue'
};
const number = n => n.toLocaleString('en-US');
const status = message => { $('status').textContent=message; };
let recipe = validateRecipe(structuredClone(DEFAULT_RECIPE));
let lastSaved = JSON.stringify(recipe);
let generated = null, treeGroup = null, frameId = null, pendingUpdate = null, variantTimeout = null;
let wireframe = false, autoOrbit = false, viewMode = 'full', controls, renderer, scene, camera;
const materials = () => [
  new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,wireframe}),
  new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:0,doubleSided:true,wireframe})
];
function geometry(data) {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
  result.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));
  result.setAttribute('color',new THREE.BufferAttribute(data.colors,3));
  result.setIndex(new THREE.BufferAttribute(data.indices,1));
  result.computeBoundingSphere();
  return result;
}
function skeletonLines(skeleton) {
  const pos=[],color=[];
  const palette=[
    [0.92,0.77,0.54],[0.84,0.67,0.45],[0.65,0.80,0.60],
    [0.43,0.73,0.69],[0.35,0.51,0.68]
  ];
  for(const branch of skeleton.branches) {
    const c=palette[Math.min(branch.generation,palette.length-1)];
    for(let k=0;k<branch.points.length-1;k++) {
      pos.push(...branch.points[k],...branch.points[k+1]);
      color.push(...c,...c);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(color,3));
  return new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({vertexColors:true}));
}
function applyDisplayMode(group) {
  if(!group)return;
  const [wood,foliage,structure]=group.children;
  wood.visible=viewMode!=='skeleton';
  foliage.visible=viewMode==='full';
  structure.visible=viewMode==='skeleton';
}
function setViewMode(mode) {
  viewMode=viewMode===mode?'full':mode;
  applyDisplayMode(treeGroup);
  $('woodOnly').setAttribute('aria-pressed',String(viewMode==='wood'));
  $('skeletonView').setAttribute('aria-pressed',String(viewMode==='skeleton'));
}
function modelGroup(result) {
  const group = new THREE.Group();
  const mats = materials();
  for(const [idx,key] of ['wood','foliage'].entries()) {
    const mesh = new THREE.Mesh(geometry(result.model[key]),mats[idx]);
    mesh.castShadow=false;
    group.add(mesh);
  }
  group.add(skeletonLines(result.skeleton));
  applyDisplayMode(group);
  return group;
}
function dispose(group) {
  if(!group)return;
  group.traverse(obj=>{
    if(obj.geometry)obj.geometry.dispose();
    if(obj.material){
      const materials=Array.isArray(obj.material)?obj.material:[obj.material];
      for(const material of materials)material.dispose();
    }
  });
}
function frameCamera() {
  if(!camera)return;
  const h=recipe.parameters.height, radius=Math.max(recipe.parameters.crownRadius,h*.52);
  camera.position.set(radius*1.7,h*.93,radius*1.9);
  controls.target.set(0,h*.49,0);
  controls.minDistance=Math.max(2,radius*.45);
  controls.maxDistance=Math.max(30,h*5);
  controls.update();
}
function updateLabels() {
  for(const input of inputs) {
    const key=input.dataset.param,v=recipe.parameters[key];
    input.value=String(v);
    const value=key==='height'||key==='crownRadius'||key==='trunkRadius'
      ? Number(v).toFixed(key==='trunkRadius'?2:1)+' m'
      : Math.round(v*100)+'%';
    $(outputs[key]).textContent=value;
  }
  $('seed').value=String(recipe.seed);
  $('assetName').value=recipe.name;
}
function resize() {
  if(!renderer)return;
  const root=$('viewport'),w=Math.max(1,root.clientWidth),h=Math.max(1,root.clientHeight);
  renderer.setSize(w,h,false);
  camera.aspect=w/h;
  camera.updateProjectionMatrix();
}
function displayTree(focus=false) {
  const next=generateTree(recipe);
  const group=modelGroup(next);
  if(treeGroup){scene.remove(treeGroup);dispose(treeGroup);}
  scene.add(group);
  treeGroup=group;generated=next;
  $('triangles').textContent=number(next.stats.triangles);
  $('branches').textContent=number(next.stats.branches);
  $('leaves').textContent=number(next.stats.leaves);
  $('clusters').textContent=number(next.stats.clusters);
  if(focus)frameCamera();
  status('Generated · '+number(next.stats.triangles)+' triangles');
  return next;
}
function download(data,mime,name) {
  const blob=new Blob([data],{type:mime}),href=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=href;link.download=name;document.body.append(link);link.click();link.remove();
  // Leave time for the browser download to consume the object URL.
  setTimeout(()=>URL.revokeObjectURL(href),30000);
}
function stem() {
  return (recipe.name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'oak')+'-'+String(recipe.seed);
}
function setRecipe(value,{focus=false}={}) {
  recipe=validateRecipe(value);
  updateLabels();displayTree(focus);
  scheduleVariants();
}
function updateParameters(changedKey) {
  // Read the entire form after debouncing; rapid edits to two sliders are not lost.
  const next=structuredClone(recipe);
  for(const input of inputs)next.parameters[input.dataset.param]=Number(input.value);
  if(next.parameters.trunkRadius>next.parameters.crownRadius*.62) {
    if(changedKey==='trunkRadius')
      next.parameters.crownRadius=Math.min(11,Math.ceil(next.parameters.trunkRadius/.62*10)/10);
    else next.parameters.trunkRadius=Math.max(.12,Math.floor(next.parameters.crownRadius*.62*100)/100);
  }
  setRecipe(next);
}
function flushPending() {
  if(frameId!==null)clearTimeout(frameId);
  frameId=null;
  const callback=pendingUpdate;pendingUpdate=null;
  if(callback)callback();
}
function queueUpdate(callback,delay) {
  pendingUpdate=callback;
  if(frameId!==null)clearTimeout(frameId);
  frameId=setTimeout(()=>{
    try{flushPending();}catch(error){status(error.message);}
  },delay);
}
function render() {
  requestAnimationFrame(render);
  if(!renderer)return;
  if(autoOrbit && treeGroup)treeGroup.rotation.y+=.0035;
  controls.update();
  renderer.render(scene,camera);
}
function makeVariants() {
  if(!renderer||!generated)return;
  const seeds=variantSeeds(recipe.seed),container=$('variants');
  const originalSize=new THREE.Vector2();
  renderer.getSize(originalSize);
  const originalAspect=camera.aspect;
  const oldRotation=treeGroup.rotation.y;
  treeGroup.visible=false;
  renderer.setSize(220,140,false);
  camera.aspect=220/140;camera.updateProjectionMatrix();
  const tiles=[];
  try {
    for(let i=0;i<seeds.length;i++) {
      const candidate=generateTree({...recipe,seed:seeds[i]});
      const group=modelGroup(candidate);
      scene.add(group);
      renderer.render(scene,camera);
      const url=renderer.domElement.toDataURL('image/png');
      scene.remove(group);
      dispose(group);
      tiles.push({seed:seeds[i],url});
    }
  } finally {
    renderer.setSize(originalSize.x,originalSize.y,false);
    camera.aspect=originalAspect;camera.updateProjectionMatrix();
    treeGroup.visible=true;treeGroup.rotation.y=oldRotation;
  }
  container.replaceChildren();
  for(let i=0;i<tiles.length;i++) {
    const {seed,url}=tiles[i],button=document.createElement('button');
    button.type='button';button.className='pg-variant';
    button.setAttribute('aria-label','Use variant '+(i+1)+', seed '+seed);
    const img=document.createElement('img');img.src=url;img.alt='';
    const info=document.createElement('span');info.textContent='Variant '+String(i+1);
    const caption=document.createElement('small');caption.textContent='#'+String(seed).slice(-6);
    info.append(caption);button.append(img,info);
    button.addEventListener('click',()=>setRecipe({...recipe,seed}, {focus:false}));
    container.append(button);
  }
}
function scheduleVariants() {
  clearTimeout(variantTimeout);
  variantTimeout=setTimeout(()=>{
    variantTimeout=null;
    try{makeVariants();}catch(error){status('Variant previews: '+error.message);}
  },450);
}
function setupScene() {
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x192725);
  scene.fog=new THREE.FogExp2(0x192725,.021);
  camera=new THREE.PerspectiveCamera(42,1,.08,260);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance',preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.55;
  $('viewport').append(renderer.domElement);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=.085;
  controls.screenSpacePanning=true;
  controls.maxPolarAngle=Math.PI*.83;
  const ambient=new THREE.HemisphereLight(0xb8d4e3,0x40362c,2);
  scene.add(ambient);
  const sun=new THREE.DirectionalLight(0xffe3bd,2.65);
  sun.position.set(-8,16,9);scene.add(sun);
  const fill=new THREE.DirectionalLight(0xb5d7db,.8);
  fill.position.set(8,5,-11);scene.add(fill);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(500,500),
    new THREE.MeshStandardMaterial({color:0x1c2a29,roughness:1}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-.015;scene.add(ground);
  const grid=new THREE.GridHelper(42,42,0x415850,0x2d4541);
  grid.position.y=0;grid.material.transparent=true;grid.material.opacity=.25;scene.add(grid);
  new ResizeObserver(resize).observe($('viewport'));
  resize();frameCamera();render();
}
for(const input of inputs){
  input.addEventListener('input',()=>{
    const key=input.dataset.param,value=Number(input.value);
    $(outputs[key]).textContent=key==='height'||key==='crownRadius'||key==='trunkRadius'
      ? value.toFixed(key==='trunkRadius'?2:1)+' m' : Math.round(value*100)+'%';
    queueUpdate(()=>updateParameters(key),90);
  });
}
$('seed').addEventListener('change',()=>{
  flushPending();
  const value=Number($('seed').value);
  try{setRecipe({...recipe,seed:value});}catch(error){$('seed').value=String(recipe.seed);status(error.message);}
});
$('assetName').addEventListener('change',()=>{
  flushPending();
  try{setRecipe({...recipe,name:$('assetName').value});}catch(error){$('assetName').value=recipe.name;status(error.message);}
});
$('randomSeed').addEventListener('click',()=>{
  flushPending();
  const array=new Uint32Array(1);crypto.getRandomValues(array);
  setRecipe({...recipe,seed:array[0]});
});
$('focus').addEventListener('click',frameCamera);
$('woodOnly').addEventListener('click',()=>setViewMode('wood'));
$('skeletonView').addEventListener('click',()=>setViewMode('skeleton'));
$('wireframe').addEventListener('click',()=>{
  wireframe=!wireframe;$('wireframe').setAttribute('aria-pressed',String(wireframe));
  if(treeGroup)treeGroup.traverse(obj=>{if(obj.isMesh)obj.material.wireframe=wireframe;});
});
$('spin').addEventListener('click',()=>{
  autoOrbit=!autoOrbit;$('spin').setAttribute('aria-pressed',String(autoOrbit));
});
$('reset').addEventListener('click',()=>{
  flushPending();
  if(JSON.stringify(recipe)!==lastSaved&&!confirm('Discard current settings and reset the tree?'))return;
  setRecipe(structuredClone(DEFAULT_RECIPE),{focus:true});
});
$('saveRecipe').addEventListener('click',()=>{
  try{
    flushPending();
    const json=JSON.stringify(validateRecipe(recipe),null,2)+'\n';
    download(json,'application/json',stem()+'.json');
    lastSaved=JSON.stringify(recipe);status('Recipe saved');
  }catch(error){status('Cannot save: '+error.message);}
});
$('exportGlb').addEventListener('click',()=>{
  try{
    flushPending();
    const bytes=exportGlb(generated);
    inspectGlb(bytes);
    download(bytes,'model/gltf-binary',stem()+'.glb');
    status('GLB exported · '+(bytes.length/1048576).toFixed(2)+' MiB');
  }catch(error){status('Cannot export: '+error.message);}
});
$('loadRecipe').addEventListener('click',()=>$('recipeFile').click());
$('recipeFile').addEventListener('change',async event=>{
  flushPending();
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  if(JSON.stringify(recipe)!==lastSaved&&!confirm('Discard current settings and load a recipe?'))return;
  try{
    if(file.size>16384)throw new Error('Recipe file exceeds 16 KiB');
    const loaded=validateRecipe(JSON.parse(await file.text()));
    setRecipe(loaded,{focus:true});lastSaved=JSON.stringify(recipe);
    status('Recipe loaded: '+file.name);
  }catch(error){status('Cannot load: '+error.message);}
});
window.addEventListener('beforeunload',event=>{
  flushPending();
  if(JSON.stringify(recipe)!==lastSaved)event.preventDefault();
});
try{
  setupScene();
  updateLabels();
  displayTree(true);
  scheduleVariants();
}catch(error){
  $('viewportError').hidden=false;
  $('viewportError').textContent='3D preview unavailable: '+error.message;
  status('Preview unavailable');
  console.error(error);
}
