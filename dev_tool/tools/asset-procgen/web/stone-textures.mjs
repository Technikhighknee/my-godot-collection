// Reusable stylized medieval rubble masonry: hand-laid, imperfect courses
// of warm limestone, not Voronoi cobbles or a hexagonal tile mosaic.
// Shared periodic surface fields feed albedo, normal and roughness maps.
// Albedo holds mineral pigment only; light and shadow come from the renderer.
export const STONE_TEXTURE_SIZE=512;
export const STONE_VIEWS=Object.freeze(['albedo','normal','roughness']);
const SIZE=STONE_TEXTURE_SIZE,COURSES=7;
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
const wrap=(n,m)=>(n%m+m)%m;
function hash(x,y,seed){
  let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^(seed>>>0))>>>0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}
function noise(x,y,columns,rows,seed){
  const u=x*columns/SIZE,v=y*rows/SIZE;
  const ix=Math.floor(u),iy=Math.floor(v),fx=smooth(u-ix),fy=smooth(v-iy);
  const h=(a,b)=>hash(wrap(a,columns),wrap(b,rows),seed);
  return mix(mix(h(ix,iy),h(ix+1,iy),fx),
    mix(h(ix,iy+1),h(ix+1,iy+1),fx),fy);
}
function buildCourses(layout){
  // A shared, periodic course plan: same top/bottom seam and same left/right
  // stone edges. Stone widths and course heights differ, but the bonding is
  // approximately horizontal as on actual medieval rubble foundations.
  const weights=Array.from({length:COURSES},(_,r)=>
    .61+hash(r,0,layout^0x341a7b26)*.82);
  const total=weights.reduce((a,b)=>a+b,0);
  const elevations=[0];
  for(const w of weights)elevations.push(
    elevations[elevations.length-1]+SIZE*w/total);
  elevations[COURSES]=SIZE;
  const courses=[];
  for(let row=0;row<COURSES;row++){
    const count=4+Math.floor(hash(row,1,layout^0x39af7251)*6);
    const segmentWeights=Array.from({length:count},(_,s)=>
      .51+hash(row,s,layout^0x85b9e416)*1.48);
    const sum=segmentWeights.reduce((a,b)=>a+b,0);
    const cuts=[0];
    for(const w of segmentWeights)
      cuts.push(cuts[cuts.length-1]+SIZE*w/sum);
    cuts[count]=SIZE;
    courses.push({
      count,cuts,
      offset:hash(row,2,layout^0xe1a930b4)*SIZE,
      phases:Array.from({length:count},(_,s)=>[
        hash(row,s,layout^0x451c2f7e)*Math.PI*2,
        hash(row,s,layout^0x972d1ba4)*Math.PI*2,
      ]),
    });
  }
  return {elevations,courses};
}
function generateStone(seeds){
  const layout=seeds.layout>>>0,mineral=seeds.mineral>>>0;
  const weather=seeds.weather>>>0;
  const albedo=new Float32Array(SIZE*SIZE*3);
  const height=new Float32Array(SIZE*SIZE);
  const roughness=new Float32Array(SIZE*SIZE);
  const {elevations,courses}=buildCourses(layout);
  const batch=(hash(1,3,mineral)-.5)*.026;
  // Restrained, warm mineral variations belonging to the same building:
  // stone is distinguished by shape and relief, not random blue-grey blocks.
  const palette=[
    [.645,.605,.540], [.612,.583,.531], [.667,.620,.542],
    [.625,.596,.551], [.640,.598,.518], [.601,.574,.529],
  ];
  const boundary=(k,x)=>{
    const id=wrap(k,COURSES);
    return elevations[k]-35+
      Math.sin(x*2*Math.PI/SIZE*2+
        hash(id,3,layout^0x1b7af502)*Math.PI*2)*6.0+
      Math.sin(x*2*Math.PI/SIZE*5+
        hash(id,4,layout^0xc781ef25)*Math.PI*2 )*3.15;
  };
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p=y*SIZE+x,i=p*3;
    // Course borders wiggle, but any neighboring pair shares the same
    // border. At k=COURSES the waveform equals k=0 plus SIZE.
    const seamY=boundary(0,x);
    const yy=wrap(y-seamY,SIZE)+seamY;
    let row=0;
    while(row<COURSES-1&&yy>=boundary(row+1,x))row++;
    const top=boundary(row,x),bottom=boundary(row+1,x);
    const course=courses[row];
    const t=clamp((yy-top)/(bottom-top));
    const shift=j=>{
      const key=j%course.count;
      const [a,b]=course.phases[key];
      // A hand-laid joint is slightly slanted and chipped, not a sine-wave
      // worm. The two ends need not align vertically in the next course.
      return mix((hash(row,key,layout^0x4d38b89d)-.5)*10,
        (hash(row,key,layout^0x7a2c93d5)-.5)*10,t)+
        1.25*Math.sin(t*Math.PI*2+a)+.65*Math.sin(t*Math.PI*4+b);
    };
    // Place the vertical joint on a periodic, rough line. The first and
    // last boundary share a phase, which makes U seamless as well.
    const seam=shift(0);
    const xx=wrap(x-course.offset-seam,SIZE)+seam;
    let stoneIndex=0;
    while(stoneIndex<course.count-1&&
      xx>=course.cuts[stoneIndex+1]+shift(stoneIndex+1))
      stoneIndex++;
    const left=course.cuts[stoneIndex]+shift(stoneIndex);
    const right=course.cuts[stoneIndex+1]+shift(stoneIndex+1);
    const stoneId=row*16+stoneIndex;
    // Irregular but narrow mortar; chipped lips vary over a few pixels.
    const fracture=(noise(x,y,27,25,layout^0x7e8c293a)-.5)*2.6+
      (noise(x,y,57,55,layout^0x53bc106f)-.5)*1.0;
    const edge=Math.min(xx-left,right-xx,yy-top,bottom-yy)+fracture;
    const face=smooth(clamp((edge-1.75)/3.3));
    const bevel=smooth(clamp((edge-.4)/8.0));
    const grain=noise(x,y,77,69,layout^0x3a7211dc)-.5;
    const pores=noise(x,y,135,129,layout^0xe51c991a)-.5;
    const medium=noise(x,y,26,29,layout^0x75d20364)-.5;
    const broad=noise(x,y,11,13,layout^0x90a2a461)-.5;
    const oxide=noise(x,y,10,12,weather^0xb82c316d)-.5;
    const wash=noise(x,y,22,19,mineral^0xb02e36af)-.5;
    const speck=hash(x,y,weather^0xf13b86ec)-.5;
    const chips=Math.max(0,.11-noise(x,y,59,61,weather^0xc4a3e219));
    const batchTone=(hash(stoneId,7,mineral^0x195cb812)-.5)*.092;
    const stoneType=Math.floor(hash(stoneId,2,mineral^0xa4b2ec19)*palette.length);
    const color=palette[stoneType];
    const stoneTone=batchTone+batch+broad*.045+medium*.073+
      grain*.052+pores*.029+wash*.047-oxide*.035-chips*.15+
      speck*.013;
    const mortarTone=medium*.024+grain*.025+oxide*.022;
    for(let c=0;c<3;c++){
      const stoneColor=color[c]+stoneTone*[1,.91,.78][c];
      const groutColor=[.456,.429,.385][c]+mortarTone;
      albedo[i+c]=clamp(mix(groutColor,stoneColor,face),.22,.79);
    }
    // Stone relief is mostly in the matching normal map. The albedo avoids
    // baked dark bevels, which looked like black cartoon outlines before.
    height[p]=.16+bevel*(.255+
      broad*.045+medium*.070+grain*.050+pores*.015-chips*.10)+
      face*(hash(stoneId,5,layout^0xf78132ae)-.5)*.065;
    roughness[p]=clamp(mix(.94,
      .885+grain*.033+pores*.024+oxide*.029+chips*.06,
      face),.78,.99);
  }
  return {albedo,height,roughness};
}
export function makeStoneAsset(seeds){
  for(const key of ['layout','mineral','weather'])
    if(!Number.isInteger(seeds?.[key])||seeds[key]<0||seeds[key]>0xffffffff)
      throw Error('Invalid rubble stone seed: '+key);
  const sourceSeeds={layout:seeds.layout,mineral:seeds.mineral,
    weather:seeds.weather};
  let maps=null;
  return {
    id:'stone-rubble',kind:'image',width:SIZE,height:SIZE,
    channels:'RGBA',views:STONE_VIEWS,sourceSeeds,
    paint(canvas,view='albedo'){
      if(!STONE_VIEWS.includes(view))throw Error('Unknown stone map');
      if(!maps)maps=generateStone(sourceSeeds);
      canvas.width=SIZE;canvas.height=SIZE;
      const ctx=canvas.getContext('2d');
      if(!ctx)throw Error('2D canvas context required');
      const image=ctx.createImageData(SIZE,SIZE);
      const d=image.data;
      for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
        const p=y*SIZE+x,i=p*4;
        if(view==='albedo'){
          for(let c=0;c<3;c++)d[i+c]=Math.round(maps.albedo[p*3+c]*255);
        }else if(view==='roughness'){
          const gray=Math.round(maps.roughness[p]*255);
          d[i]=gray;d[i+1]=gray;d[i+2]=gray;
        }else{
          const h=(a,b)=>maps.height[wrap(b,SIZE)*SIZE+wrap(a,SIZE)];
          const dx=(h(x+1,y)-h(x-1,y))*2.3;
          const dy=(h(x,y+1)-h(x,y-1))*2.3;
          const len=Math.hypot(dx,dy,1);
          d[i]=Math.round((1-dx/len)*127.5);
          d[i+1]=Math.round((1-dy/len)*127.5);
          d[i+2]=Math.round((1+1/len)*127.5);
        }
        d[i+3]=255;
      }
      ctx.putImageData(image,0,0);
    },
  };
}
