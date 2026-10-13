// Seeded rubble-stone masonry for foundations, plinths and retaining walls.
// Irregular periodic Voronoi stones, real mortar recesses, bevelled stone
// faces and granular detail share one height field for all three PBR maps.
// Color describes minerals (not baked directional lighting).
export const STONE_TEXTURE_SIZE=512;
export const STONE_VIEWS=Object.freeze(['albedo','normal','roughness']);
const SIZE=STONE_TEXTURE_SIZE;
const COLS=7,ROWS=8;
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
  const ix=Math.floor(u),iy=Math.floor(v);
  const sx=smooth(u-ix),sy=smooth(v-iy);
  const h=(a,b)=>hash(wrap(a,columns),wrap(b,rows),seed);
  return mix(mix(h(ix,iy),h(ix+1,iy),sx),
    mix(h(ix,iy+1),h(ix+1,iy+1),sx),sy);
}
function stonesAt(x,y,seed){
  // Grid cells are staggered, but each seed perturbs the center independently.
  // Both axes repeat exactly, including row parity at Y's wrap.
  const gx=x*COLS/SIZE,gy=y*ROWS/SIZE;
  const ix=Math.floor(gx),iy=Math.floor(gy);
  let best=Infinity,second=Infinity,id=0,rough=0;
  for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){
    const cx=ix+ox,cy=iy+oy;
    const bx=wrap(cx,COLS),by=wrap(cy,ROWS);
    const centerX=cx+.5+((by&1)?.27:0)+
      (hash(bx,by,seed^0x4b1f3e79)-.5)*.53;
    const centerY=cy+.5+(hash(bx,by,seed^0x8c7d21a4)-.5)*.48;
    const dx=(gx-centerX)*.94,dy=(gy-centerY)*1.04;
    const sq=dx*dx+dy*dy;
    if(sq<best){
      second=best;best=sq;id=by*COLS+bx;
      rough=Math.sqrt(sq);
    }else if(sq<second)second=sq;
  }
  return {id,edge:second-best,rough};
}
function generateStone(seeds){
  const layout=seeds.layout>>>0,mineral=seeds.mineral>>>0,weather=seeds.weather>>>0;
  const albedo=new Float32Array(SIZE*SIZE*3);
  const height=new Float32Array(SIZE*SIZE);
  const roughness=new Float32Array(SIZE*SIZE);
  const batch=(hash(1,3,mineral)-.5)*.060;
  const palette=[
    [.61,.596,.548], // weathered grey-beige limestone
    [.58,.568,.524],
    [.65,.622,.553],
    [.57,.579,.55],
    [.67,.633,.556],
    [.59,.565,.508],
  ];
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p=y*SIZE+x,i=p*3;
    // Periodic distortions break mechanical cells without hard seams.
    const wx=x+(noise(x,y,11,10,layout^0x98ac23d1)-.5)*21;
    const wy=y+(noise(x,y,9,12,layout^0xb3e81a69)-.5)*22;
    const stone=stonesAt(wx,wy,layout);
    const id=stone.id;
    const tone=hash(id,4,mineral^0x195cb812)-.5;
    const type=Math.floor(hash(id,3,mineral^0xa4b2ec19)*palette.length);
    const color=palette[type];
    // The nearest/second-nearest gap is zero at each Voronoi boundary.
    // Mortar is sunken; the bevel is a smoothly sloping stone lip.
    const chipped=(noise(x,y,34,30,layout^0x193ee70c)-.5)*.085;
    const edge=stone.edge+chipped;
    const face=smooth(clamp((edge-.020)/.155));
    const bevel=smooth(clamp((edge-.005)/.29));
    const grain=noise(x,y,72,75,layout^0x3a7211dc)-.5;
    const medium=noise(x,y,30,34,layout^0xe5c1c991)-.5;
    const foliation=noise(x,y,12,15,layout^0xa7d20364)-.5;
    const porous=hash(x,y,layout^0xf13b86ec)-.5;
    const stained=noise(x,y,10,11,weather^0xb82c316d)-.5;
    const coarse=noise(x,y,19,21,mineral^0xb02e36af)-.5;
    // Thin crust fractures / minute surface chips. Not painted joints.
    const pits=Math.max(0,.16-noise(x,y,63,58,weather^0xc4a3e219));
    const mineralTone=medium*.100+grain*.067+foliation*.089+
      coarse*.052+porous*.025-stained*.083-pits*.30;
    const mineralVari=tone*.23+batch+mineralTone;
    const mortarTone=grain*.037+stained*.045+porous*.025;
    for(let c=0;c<3;c++){
      const stoneColor=color[c]+mineralVari*[1,.94,.86][c];
      const groutColor=[.435,.418,.371][c]+mortarTone;
      albedo[i+c]=clamp(mix(groutColor,stoneColor,face),.20,.83);
    }
    // Broad convex faces plus small genuinely granular relief, without
    // baked highlights. Mortar stays noticeably below the stone surfaces.
    height[p]=.14+bevel*(.37+
      medium*.078+foliation*.110+grain*.059+porous*.025-
      pits*.14)+face*(hash(id,5,layout^0xf78132ae)-.5)*.074;
    roughness[p]=clamp(mix(.94,
      .85+grain*.044+porous*.035+pits*.085+stained*.02,
      face),.73,.99);
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
