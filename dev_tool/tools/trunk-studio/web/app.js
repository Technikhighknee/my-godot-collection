import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_TRUNK, validateTrunk, generateTrunk } from './trunk.mjs';
import { exportTrunkGlb } from './export.mjs';

const $=id=>document.getElementById(id);
let recipe=validateTrunk(structuredClone(DEFAULT_TRUNK)),generated,model=null;
let scene,camera,renderer,controls,ground,mode='bark',spinning=false;
let regenTimer=null,frameWhole=true,saved=JSON.stringify(recipe);
const sliders=[...document.querySelectorAll('[data-param]')];
const fmt={height:v=>v.toFixed(1)+' m',radius:v=>v.toFixed(2)+' m',taper:v=>(v*100).toFixed(0)+'%',flare:v=>(v*100).toFixed(0)+'%',character:v=>(v*100).toFixed(0)+'%',bark:v=>(v*100).toFixed(0)+'%'};
const message=s=>$('status').textContent=s;
function bindForm(){
  $('name').value=recipe.name;
  $('seed').value=recipe.seed;
  for(const slider of sliders){
    const k=slider.dataset.param;
    slider.value=recipe[k];$(k+'Value').textContent=fmt[k](recipe[k]);
  }
}
function gpuTexture(pixels,size,color){
  const tex=new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat,THREE.UnsignedByteType);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.magFilter=THREE.LinearFilter;
  tex.minFilter=THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps=true;
  tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  if(color)tex.colorSpace=THREE.SRGBColorSpace;
  tex.needsUpdate=true;
  return tex;
}
function visual(data){
  const g=new THREE.BufferGeometry(),m=data.mesh;
  g.setAttribute('position',new THREE.BufferAttribute(m.positions,3));
  g.setAttribute('normal',new THREE.BufferAttribute(m.normals,3));
  g.setAttribute('uv',new THREE.BufferAttribute(m.uv,2));
  g.setIndex(new THREE.BufferAttribute(m.indices,1));
  g.computeBoundingSphere();
  const textures=[
    gpuTexture(data.textures.albedo,data.textures.size,true),
    gpuTexture(data.textures.normal,data.textures.size,false)
  ];
  const bark=new THREE.MeshStandardMaterial({
    color:0xffffff,map:textures[0],normalMap:textures[1],normalScale:new THREE.Vector2(.8,.8),
    roughness:1,metalness:0
  });
  const clay=new THREE.MeshStandardMaterial({color:0x998d79,roughness:.88,metalness:0});
  const object=new THREE.Mesh(g,bark);
  object.castShadow=true;object.receiveShadow=true;
  return {object,geometry:g,bark,clay,textures};
}
function useMode(next){
  mode=next;
  if(model){
    model.object.material=mode==='clay'?model.clay:model.bark;
    model.bark.wireframe=mode==='wire';
    model.clay.wireframe=false;
  }
  for(const button of document.querySelectorAll('[data-look]'))
    button.setAttribute('aria-pressed',String(button.dataset.look===mode));
  $('viewName').textContent=mode==='bark'?'Bark & form':mode==='clay'?'Shape only':'Mesh structure';
}
function discard(m){
  if(!m)return;
  scene.remove(m.object);
  m.geometry.dispose();m.bark.dispose();m.clay.dispose();
  for(const tex of m.textures)tex.dispose();
}
function frame(what='whole'){
  if(!controls)return;
  const h=recipe.height;
  if(what==='base'){
    frameWhole=false;
    controls.target.set(0,.7,0);
    camera.position.set(2.1,1.3,3.7);
    controls.minDistance=.45;controls.maxDistance=h*4;
  }else{
    frameWhole=true;
    controls.target.set(0,h*.49,0);
    camera.position.set(h*.55,h*.78,h*1.7);
    controls.minDistance=.8;controls.maxDistance=h*4;
  }
  camera.near=.02;camera.far=Math.max(150,h*10);
  camera.updateProjectionMatrix();controls.update();
}
function regenerate(shouldFrame=false){
  try{
    const begin=performance.now(),next=generateTrunk(recipe),m=visual(next);
    discard(model);model=m;generated=next;scene.add(m.object);useMode(mode);
    if(shouldFrame)frame();
    const ms=Math.round(performance.now()-begin),tris=next.mesh.indices.length/3;
    $('meshCount').textContent=tris.toLocaleString()+' triangles';
    message('Generated · '+ms+' ms · '+tris.toLocaleString()+' triangles');
    $('viewportError').hidden=true;
  }catch(e){
    message('Generation failed: '+e.message);
    $('viewportError').hidden=false;$('viewportError').textContent=e.message;
  }
}
function queueRegen(){
  clearTimeout(regenTimer);
  regenTimer=setTimeout(()=>{regenTimer=null;regenerate();},125);
}
function flush(){
  if(regenTimer!==null){
    clearTimeout(regenTimer);regenTimer=null;regenerate();
  }
}
function changed(){
  const next={...recipe};
  for(const slider of sliders)next[slider.dataset.param]=Number(slider.value);
  // Keep the slender-axis constraint valid even if dimensions are edited.
  if(next.radius/next.height>.12)next.height=next.radius/.12;
  recipe=validateTrunk(next);
  bindForm();queueRegen();
}
function saveFile(bytes,filename,type){
  const blob=new Blob([bytes],{type}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function filename(ext){
  const slug=recipe.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,45)||'trunk';
  return slug+'-'+recipe.seed+'.'+ext;
}
function setup(){
  scene=new THREE.Scene();scene.background=new THREE.Color(0x182728);
  scene.fog=new THREE.Fog(0x182728,32,82);
  camera=new THREE.PerspectiveCamera(37,1,.02,180);
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.5;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  $('viewport').append(renderer.domElement);
  const ambient=new THREE.HemisphereLight(0xb7c4c0,0x594c3e,2.0);scene.add(ambient);
  const sun=new THREE.DirectionalLight(0xf6dfb6,3.0);
  sun.position.set(-7,14,6);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-11;sun.shadow.camera.right=11;
  sun.shadow.camera.top=15;sun.shadow.camera.bottom=-11;sun.shadow.camera.near=.5;sun.shadow.camera.far=45;
  sun.shadow.bias=-.00025;scene.add(sun);
  const fill=new THREE.DirectionalLight(0xc6d9d4,.8);fill.position.set(7,6,-5);scene.add(fill);
  ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),
    new THREE.MeshStandardMaterial({color:0x27332e,roughness:1}));
  ground.rotation.x=-Math.PI/2;ground.position.y=-.045;ground.receiveShadow=true;scene.add(ground);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;controls.dampingFactor=.09;
  controls.screenSpacePanning=true;controls.maxPolarAngle=Math.PI*.88;
  const resize=()=>{
    const p=$('viewport'),w=Math.max(1,p.clientWidth),h=Math.max(1,p.clientHeight);
    renderer.setSize(w,h,false);
    camera.aspect=w/h;camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe($('viewport'));resize();
  frame();regenerate();
  const animate=()=>{
    requestAnimationFrame(animate);
    if(spinning&&model)model.object.rotation.y+=.0025;
    controls.update();renderer.render(scene,camera);
  };
  animate();
}
for(const slider of sliders){
  slider.addEventListener('input',()=>{
    $(slider.dataset.param+'Value').textContent=fmt[slider.dataset.param](Number(slider.value));
    changed();
  });
}
$('name').addEventListener('change',()=>{
  try{recipe=validateTrunk({...recipe,name:$('name').value});bindForm();}catch(e){message(e.message);bindForm();}
});
$('seed').addEventListener('change',()=>{
  try{recipe=validateTrunk({...recipe,seed:Number($('seed').value)});bindForm();queueRegen();}catch(e){message(e.message);bindForm();}
});
$('random').addEventListener('click',()=>{
  const seed=crypto.getRandomValues(new Uint32Array(1))[0];
  recipe=validateTrunk({...recipe,seed});bindForm();queueRegen();
});
$('whole').addEventListener('click',()=>frame('whole'));
$('base').addEventListener('click',()=>frame('base'));
for(const b of document.querySelectorAll('[data-look]'))b.addEventListener('click',()=>useMode(b.dataset.look));
$('orbit').addEventListener('click',()=>{
  spinning=!spinning;$('orbit').setAttribute('aria-pressed',String(spinning));
});
$('reset').addEventListener('click',()=>{
  recipe=validateTrunk(structuredClone(DEFAULT_TRUNK));bindForm();regenerate(true);
});
$('export').addEventListener('click',()=>{
  flush();if(!generated)return;
  try{
    const bytes=exportTrunkGlb(generated);
    saveFile(bytes,filename('glb'),'model/gltf-binary');
    message('GLB exported · '+(bytes.byteLength/1048576).toFixed(2)+' MiB');
  }catch(e){message('Export failed: '+e.message);}
});
$('save').addEventListener('click',()=>{
  flush();saveFile(JSON.stringify(recipe,null,2)+'\n',filename('json'),'application/json');
  saved=JSON.stringify(recipe);message('Recipe saved');
});
$('load').addEventListener('click',()=>$('recipeFile').click());
$('recipeFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';
  if(!file)return;
  try{
    if(file.size>16384)throw Error('Recipe file exceeds 16 KiB');
    recipe=validateTrunk(JSON.parse(await file.text()));saved=JSON.stringify(recipe);
    bindForm();regenerate(true);
  }catch(error){message('Cannot load recipe: '+error.message);}
});
window.addEventListener('beforeunload',event=>{
  if(saved!==JSON.stringify(recipe))event.preventDefault();
});
try{bindForm();setup();}catch(e){
  $('viewportError').hidden=false;$('viewportError').textContent=e.message;
  message('Viewport initialization failed');
  console.error(e);
}
