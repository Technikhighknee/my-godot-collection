// Reusable 3D preview for generated model assets. No generator selection,
// input parsing, seed state or application UI lives here.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {paintOakAtlas} from './oak-atlas.mjs';
import {generateOakBarkMaterialSet,OAK_BARK_PROFILES} from './oak-bark.mjs';

function meshGeometry(data,useColors=false){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
  geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));
  if(useColors)geometry.setAttribute('color',new THREE.BufferAttribute(data.colors,3));
  if(data.uvs){
    geometry.setAttribute('uv',new THREE.BufferAttribute(data.uvs,2));
    // Three 0.180's aoMap defaults to channel 1 (uv1).
    // Keep uv2 as a compatibility alias for downstream preview consumers.
    geometry.setAttribute('uv1',new THREE.BufferAttribute(data.uvs,2));
    geometry.setAttribute('uv2',new THREE.BufferAttribute(data.uvs,2));
  }
  geometry.setIndex(new THREE.BufferAttribute(data.indices,1));
  if(data.groups)for(const {start,count,materialIndex} of data.groups)
    geometry.addGroup(start,count,materialIndex);
  geometry.computeBoundingSphere();
  return geometry;
}
const combinedBounds=(a,b)=>!b?a:{
  min:a.min.map((v,i)=>Math.min(v,b.min[i])),
  max:a.max.map((v,i)=>Math.max(v,b.max[i])),
};
const disposeGroup=group=>group?.traverse(node=>{
  if(node.isMesh){
    node.geometry.dispose();
    for(const material of [].concat(node.material))material.dispose();
  }
});
export function createModelViewport(container,onChange=()=>{}){
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(0x18272a);
  scene.fog=new THREE.Fog(0x18272a,28,85);
  const camera=new THREE.PerspectiveCamera(38,1,.05,160);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.5;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  container.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xd7ded5,0x666257,2));
  const sunlight=new THREE.DirectionalLight(0xffe8cd,2.9);
  sunlight.position.set(-6,14,8);
  sunlight.castShadow=true;
  sunlight.shadow.mapSize.set(2048,2048);
  sunlight.shadow.camera.left=-12;
  sunlight.shadow.camera.right=12;
  sunlight.shadow.camera.top=15;
  sunlight.shadow.camera.bottom=-12;
  sunlight.shadow.camera.near=.1;
  sunlight.shadow.camera.far=40;
  sunlight.shadow.bias=-.0004;
  scene.add(sunlight);
  const fill=new THREE.DirectionalLight(0xc1ccd5,1.4);
  fill.position.set(7,6,-8);
  scene.add(fill);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(65,65),
    new THREE.MeshStandardMaterial({color:0x26342e,roughness:1}));
  ground.rotation.x=-Math.PI/2;
  ground.position.y=-.07;
  ground.receiveShadow=true;
  scene.add(ground);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=.075;
  controls.screenSpacePanning=true;
  controls.minDistance=1;
  controls.maxDistance=65;
  controls.maxPolarAngle=Math.PI*.87;

  let group=null,woodMesh=null,foliageMesh=null,foliageData=null;
  let woodBounds=null,foliageBounds=null,extents=null,assetId=null;
  let atlasCanvas=null,atlasTexture=null,atlasSeed=null;
  let barkTextures=null,barkSeedKey=null;
  let spinning=false,silhouette=false,foliageVisible=true,inspectMode='tree';

  const state=()=>({assetId,spinning,silhouette,foliageVisible,inspectMode});
  const changed=()=>onChange(state());
  controls.addEventListener('start',()=>{spinning=false;changed();});
  new ResizeObserver(()=>{
    const w=Math.max(1,container.clientWidth),h=Math.max(1,container.clientHeight);
    renderer.setSize(w,h,false);
    camera.aspect=w/h;
    camera.updateProjectionMatrix();
  }).observe(container);
  const tick=()=>{
    requestAnimationFrame(tick);
    if(spinning&&group&&inspectMode==='tree')group.rotation.y+=.003;
    controls.update();
    renderer.render(scene,camera);
  };
  tick();

  function newAtlas(seed){
    const canvas=document.createElement('canvas');
    paintOakAtlas(canvas,seed);
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=THREE.ClampToEdgeWrapping;
    texture.wrapT=THREE.ClampToEdgeWrapping;
    texture.minFilter=THREE.LinearMipmapLinearFilter;
    texture.magFilter=THREE.LinearFilter;
    texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    texture.generateMipmaps=true;
    return {canvas,texture,seed};
  }
  function newBark(seeds){
    const materials=generateOakBarkMaterialSet(seeds);
    const result={};
    try{
      for(const profile of OAK_BARK_PROFILES){
        const images=materials[profile],maps={};
        result[profile]=maps;
        for(const name of ['albedo','normal','roughness','ao']){
          const texture=new THREE.DataTexture(
            new Uint8Array(images[name]),images.width,images.height,
            THREE.RGBAFormat,THREE.UnsignedByteType);
          maps[name]=texture;
          texture.wrapS=THREE.RepeatWrapping;
          texture.wrapT=THREE.RepeatWrapping;
          texture.flipY=true;
          texture.generateMipmaps=true;
          texture.minFilter=THREE.LinearMipmapLinearFilter;
          texture.magFilter=THREE.LinearFilter;
          texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
          texture.colorSpace=name==='albedo'?
            THREE.SRGBColorSpace:THREE.NoColorSpace;
          texture.needsUpdate=true;
        }
      }
      return result;
    }catch(error){
      disposeBark(result);
      throw error;
    }
  }
  function disposeBark(set){
    if(!set)return;
    for(const maps of Object.values(set))
      for(const texture of Object.values(maps))texture.dispose();
  }
  const setVisibility=()=>{
    if(foliageMesh)
      foliageMesh.visible=assetId==='oak'&&foliageVisible&&inspectMode!=='card';
    extents=foliageMesh?.visible?
      combinedBounds(woodBounds,foliageBounds):woodBounds;
    changed();
  };
  function resetInspect(){
    inspectMode='tree';
    if(woodMesh)woodMesh.visible=true;
    if(foliageMesh&&foliageData)
      foliageMesh.geometry.setDrawRange(0,foliageData.indices.length);
    setVisibility();
  }
  function render(asset){
    if(asset.kind!=='model'||!asset.wood)throw Error('Expected model asset');
    const replacement=new THREE.Group();
    let freshAtlas=null,freshBark=null;
    try{
      const barkKey=asset.barkSeeds?[
        asset.barkSeeds.structureSeed,asset.barkSeeds.surfaceSeed,
        asset.barkSeeds.colorSeed].join(':'):null;
      if(barkKey!==null&&(!barkTextures||barkSeedKey!==barkKey))
        freshBark=newBark(asset.barkSeeds);
      const bark=asset.barkSeeds?(freshBark??barkTextures):null;
      if(bark&&!asset.barkWood)throw Error('Oak PBR material needs UV-mapped wood');
      const woodMaterial=bark?OAK_BARK_PROFILES.map(profile=>{
        const maps=bark[profile];
        return new THREE.MeshStandardMaterial({
          color:silhouette?0x050909:0xffffff,
          map:maps.albedo,
          normalMap:maps.normal,
          roughnessMap:maps.roughness,
          aoMap:maps.ao,aoMapIntensity:.85,
          normalScale:new THREE.Vector2(.78,.78),
          roughness:1,metalness:0,side:THREE.FrontSide,
        });
      }):new THREE.MeshStandardMaterial({
        color:silhouette?0x050909:0xa49c8e,
        roughness:.96,metalness:0,side:THREE.FrontSide,
      });
      if(bark&&(!asset.barkWood.groups?.length))
        throw Error('Oak bark groups are required for maturity profiles');
      const wood=new THREE.Mesh(meshGeometry(asset.barkWood??asset.wood),
        woodMaterial);
      wood.castShadow=true;
      wood.receiveShadow=true;
      replacement.add(wood);
      let leaves=null;
      if(asset.foliage){
        const needsAtlas=!atlasTexture||atlasSeed!==asset.atlasSeed;
        if(needsAtlas)freshAtlas=newAtlas(asset.atlasSeed);
        const texture=freshAtlas?.texture??atlasTexture;
        leaves=new THREE.Mesh(meshGeometry(asset.foliage,true),
          new THREE.MeshStandardMaterial({
            map:texture,color:silhouette?0x050909:0xc5d0bc,
            vertexColors:true,roughness:.93,metalness:0,
            alphaTest:.43,alphaToCoverage:true,depthWrite:true,
            transparent:false,side:THREE.DoubleSide,
          }));
        leaves.castShadow=true;
        replacement.add(leaves);
      }
      // Prepare the replacement completely before touching the old asset.
      if(group)replacement.rotation.copy(group.rotation);
      scene.add(replacement);
      const previous=group,oldAtlas=atlasTexture,oldBark=barkTextures;
      group=replacement;
      woodMesh=wood;foliageMesh=leaves;foliageData=asset.foliage;
      woodBounds=asset.wood.bounds;
      foliageBounds=asset.foliage?.bounds??null;
      assetId=asset.id;
      inspectMode='tree';
      if(freshAtlas){
        atlasCanvas=freshAtlas.canvas;
        atlasTexture=freshAtlas.texture;
        atlasSeed=freshAtlas.seed;
      }
      if(freshBark){
        barkTextures=freshBark;
        barkSeedKey=barkKey;
      }
      if(previous){scene.remove(previous);disposeGroup(previous);}
      if(freshAtlas&&oldAtlas)oldAtlas.dispose();
      if(freshBark&&oldBark)disposeBark(oldBark);
      setVisibility();
      return {
        axes:asset.wood.branches.length,
        cards:asset.foliage?.cardCount??0,
        triangles:(asset.wood.indices.length+(asset.foliage?.indices.length??0))/3,
      };
    } catch(error){
      disposeGroup(replacement);
      if(freshAtlas)freshAtlas.texture.dispose();
      if(freshBark)disposeBark(freshBark);
      throw error;
    }
  }
  function focus(mode='whole'){
    if(!extents)return;
    if(inspectMode!=='tree')resetInspect();
    const lo=extents.min,hi=extents.max;
    const center=new THREE.Vector3(
      (lo[0]+hi[0])*.5,(lo[1]+hi[1])*.5,(lo[2]+hi[2])*.5);
    const size=Math.max(...hi.map((v,i)=>v-lo[i]));
    if(mode==='foot'){
      controls.target.set(0,.65,0);
      camera.position.set(2.25,1.65,3.4);
    } else if(mode==='crown'){
      controls.target.set(center.x,lo[1]+(hi[1]-lo[1])*.72,center.z);
      camera.position.set(center.x+size*.52,hi[1]+size*.27,
        center.z+size*.85);
    } else {
      controls.target.copy(center);
      camera.position.set(center.x+size*.69,center.y+size*.25,
        center.z+size*1.65);
    }
    controls.update();
  }
  function inspectCard(){
    if(assetId!=='oak'||!foliageData||!atlasCanvas)return null;
    inspectMode='card';
    if(woodMesh)woodMesh.visible=false;
    spinning=false;
    setVisibility();
    return atlasCanvas;
  }
  function inspectClump(){
    if(assetId!=='oak'||!foliageMesh||!foliageData)return false;
    const crown=foliageData.crownMasses[
      Math.floor(foliageData.crownMasses.length/2)];
    const c=crown.cushions[0],radius=Math.max(...c.radii);
    inspectMode='clump';
    foliageMesh.geometry.setDrawRange(c.firstCard*12,c.cardCount*12);
    if(woodMesh)woodMesh.visible=false;
    foliageVisible=true;
    spinning=false;
    controls.target.set(...c.center);
    camera.position.set(c.center[0]+radius*1.9,
      c.center[1]+radius*.75,c.center[2]+radius*2.6);
    controls.update();
    setVisibility();
    return true;
  }
  function toggleLeaves(){
    if(assetId!=='oak')return;
    foliageVisible=!foliageVisible;
    if(inspectMode!=='tree')resetInspect();
    setVisibility();
  }
  function toggleSilhouette(){
    silhouette=!silhouette;
    if(woodMesh)for(const material of [].concat(woodMesh.material))
      material.color.setHex(silhouette?0x050909:
        material.map?0xffffff:0xa49c8e);
    if(foliageMesh)foliageMesh.material.color.setHex(
      silhouette?0x050909:0xc5d0bc);
    scene.background.setHex(silhouette?0xaab9b0:0x18272a);
    scene.fog.color.setHex(silhouette?0xaab9b0:0x18272a);
    changed();
  }
  function toggleTurntable(){
    spinning=!spinning;
    changed();
  }
  return {render,focus,inspectCard,inspectClump,toggleLeaves,
    toggleSilhouette,toggleTurntable,state};
}
