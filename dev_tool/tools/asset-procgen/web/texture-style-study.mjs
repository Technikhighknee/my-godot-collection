// Deliberately a non-persistent art-direction workbench, not a second set
// of generators or a finished project style system. Both columns use the
// identical source recipe. The study side tests material-specific palette and
// PBR response before the visual rules are implemented inside generators.
export const STUDY_STYLES=Object.freeze([
  Object.freeze({id:'current',label:'Current generators'}),
  Object.freeze({id:'classic-strategy-study',label:'Classic PC strategy · study'}),
]);
export const STUDY_MATERIALS=Object.freeze([
  Object.freeze({id:'roof-thatch',label:'Thatch',group:'Roof',profile:null}),
  Object.freeze({id:'roof-clay',label:'Clay roof',group:'Roof',profile:null}),
  Object.freeze({id:'timber-oak',label:'Oak timber',group:'Timber',profile:'panel'}),
  Object.freeze({id:'plaster-lime',label:'Lime plaster',group:'Facade',profile:null}),
  Object.freeze({id:'stone-rubble',label:'Rubble stone',group:'Foundation',profile:null}),
]);
const clamp=n=>Math.max(0,Math.min(255,n));
const mix=(a,b,t)=>a+(b-a)*t;
function paintClassicAlbedo(id,r,g,b){
  // Material-specific *exploration*. No generic "style intensity" slider:
  // a stone is not stylized with the same recipe as a roof or painted lime.
  const lum=.299*r+.587*g+.114*b;
  switch(id){
    case 'roof-thatch':
      return [mix(lum,r,1.13)+5,mix(lum,g,1.05)+2,
        mix(lum,b,.92)-11];
    case 'roof-clay':
      return [mix(lum,r,1.17)+8,mix(lum,g,1.12)-3,
        mix(lum,b,1.02)-11];
    case 'timber-oak':
      return [mix(lum,r,1.18)+3,mix(lum,g,1.08)-2,
        mix(lum,b,1.02)-5];
    case 'plaster-lime':
      return [mix(217,r,.81)+2,mix(210,g,.81)+1,
        mix(191,b,.81)-2];
    case 'stone-rubble':
      return [mix(158,r,.90)+5,mix(151,g,.89)+1,
        mix(134,b,.87)-2];
    default: throw Error('Unknown study material: '+id);
  }
}
const RELIEF=Object.freeze({
  'roof-thatch':1.06,'roof-clay':1.16,'timber-oak':1.11,
  'plaster-lime':.82,'stone-rubble':1.19,
});
const ROUGHNESS=Object.freeze({
  'roof-thatch':6,'roof-clay':-3,'timber-oak':1,
  'plaster-lime':4,'stone-rubble':3,
});
export function applyTextureStudyStyle(id,style,view,data){
  if(!STUDY_MATERIALS.some(material=>material.id===id))
    throw Error('Unknown study material: '+id);
  if(!STUDY_STYLES.some(item=>item.id===style))
    throw Error('Unknown study style: '+style);
  if(!['albedo','normal','roughness'].includes(view))
    throw Error('Unknown material view: '+view);
  if(!(data instanceof Uint8ClampedArray)||data.length%4!==0)
    throw Error('RGBA source pixels required');
  const pixels=new Uint8ClampedArray(data);
  if(style==='current')return pixels;
  for(let i=0;i<pixels.length;i+=4){
    if(view==='albedo'){
      const [r,g,b]=paintClassicAlbedo(id,data[i],data[i+1],data[i+2]);
      pixels[i]=clamp(r);pixels[i+1]=clamp(g);pixels[i+2]=clamp(b);
    }else if(view==='normal'){
      // Correct tangent-space normal normalization, not RGB contrast.
      const factor=RELIEF[id],x=(data[i]/127.5-1)*factor;
      const y=(data[i+1]/127.5-1)*factor;
      const z=Math.max(0,data[i+2]/127.5-1);
      const len=Math.hypot(x,y,z)||1;
      pixels[i]=clamp((x/len+1)*127.5);
      pixels[i+1]=clamp((y/len+1)*127.5);
      pixels[i+2]=clamp((z/len+1)*127.5);
    }else{
      const value=clamp(data[i]+ROUGHNESS[id]);
      pixels[i]=value;pixels[i+1]=value;pixels[i+2]=value;
    }
    // Preserve alpha; neither style bakes scene lighting into albedo.
  }
  return pixels;
}
export function studySeeds(definition){
  if(!STUDY_MATERIALS.some(item=>item.id===definition?.id))
    throw Error('Not a study material');
  return Object.fromEntries(definition.components.map(c=>
    [c.id,c.initialSeed]));
}
export function reseedStudySeeds(definition,masterSeed){
  if(!Number.isInteger(masterSeed)||masterSeed<0||masterSeed>0xffffffff)
    throw Error('Invalid comparison master seed');
  const original=studySeeds(definition);
  // Independent but stable component variation; different generators use
  // their own semantic seed names and never share accidental random state.
  return Object.fromEntries(Object.keys(original).map((key,i)=>{
    let n=(masterSeed^original[key]^Math.imul(i+1,0x9e3779b1))>>>0;
    n=Math.imul(n^(n>>>16),0x85ebca6b)>>>0;
    n=Math.imul(n^(n>>>13),0xc2b2ae35)>>>0;
    return [key,(n^(n>>>16))>>>0];
  }));
}
