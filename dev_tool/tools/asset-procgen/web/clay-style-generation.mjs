// Independent clay-roof *generation grammars* for art-direction studies.
// The original beaver-tail roof remains in roof-textures.mjs unchanged.
// Painted and retro differ in tile layout, silhouette, wear, height and
// roughness -- not just in post-process grading of the same bitmap.
// UV convention: X runs along ridge, Y downhill. Both axes repeat.
export const CLAY_GENERATIVE_STYLES=Object.freeze([
  'hand-painted-study','retro-3d-study',
  'naturalistic-study','watercolor-study',
]);
const SIZE=512;
const wrap=(v,m)=>(v%m+m)%m;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=t=>t*t*(3-2*t);
function hash(x,y,s){
  let n=(Math.imul(x,374761393)^Math.imul(y,668265263)^(s>>>0))>>>0;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967296;
}
function periodicNoise(x,y,cx,cy,seed){
  const u=x*cx/SIZE,v=y*cy/SIZE,ix=Math.floor(u),iy=Math.floor(v);
  const fx=smooth(u-ix),fy=smooth(v-iy);
  const h=(xx,yy)=>hash(wrap(xx,cx),wrap(yy,cy),seed);
  return mix(mix(h(ix,iy),h(ix+1,iy),fx),
    mix(h(ix,iy+1),h(ix+1,iy+1),fx),fy)-.5;
}
function plan(style,seeds){
  const fantasy=style!=='retro-3d-study';
  const columns=style==='naturalistic-study'?11:
    style==='watercolor-study'?9:fantasy?7:8;
  const rows=style==='naturalistic-study'?10:style==='watercolor-study'?9:8;
  const pattern=seeds.pattern>>>0,color=seeds.color>>>0;
  const traits=(col,row,salt)=>hash(wrap(col,columns),wrap(row,rows),salt);
  const atlas=[];
  for(let row=0;row<rows;row++){
    const line=[];
    for(let col=0;col<columns;col++){
      const morph=traits(col,row,pattern^0x1a72d32c);
      const kiln=traits(col,row,color^0xa87294a1);
      line.push({
        morph, kiln,
        angle:traits(col,row,pattern^0x74ca2b36)-.5,
        soot:traits(col,row,color^0xa83179e2),
        vein:traits(col,row,pattern^0x3678db19),
        wear:traits(col,row,color^0x88b12fc6),
      });
    }
    atlas.push(line);
  }
  return {fantasy,columns,rows,atlas,pattern,color};
}
function tileAt(x,y,row,p){
  const r=wrap(row,p.rows);
  const pitch=SIZE/p.columns;
  const offset=(row&1)*(p.fantasy?.47:.5)+(p.fantasy?0:.25);
  const drift=p.fantasy?.11:.03;
  const lane=x/pitch+offset+
    Math.sin((y/SIZE)*Math.PI*2)*drift;
  const col=Math.floor(lane);
  const fx=lane-col;
  return {...p.atlas[r][wrap(col,p.columns)],fx,col,row:r};
}
function tail(tile,p){
  if(!p.fantasy)return .035; // square, cut-corner slabs
  // Broader, irregular scallops with slightly off-center lowest points.
  const skew=(tile.angle)*.13;
  const t=clamp(1-Math.abs(2*(tile.fx-.5-skew)));
  return .045+(.23+(tile.morph-.5)*.10)*Math.pow(t,.55);
}
function paintedMaps(p){
  const albedo=new Float32Array(SIZE*SIZE*3);
  const height=new Float32Array(SIZE*SIZE);
  const roughness=new Float32Array(SIZE*SIZE);
  const rows=p.rows,step=SIZE/rows;
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const row=Math.floor(y/step),fy=y/step-row;
    const upper=tileAt(x,y,row-1,p);
    const fromAbove=fy<tail(upper,p);
    const tile=fromAbove?upper:tileAt(x,y,row,p);
    const fx=tile.fx;
    const yy=fromAbove?fy+1:fy;
    // Exposed silhouette follows the geometry of the previous course,
    // while vertical joins and weathering follow this tile's identity.
    const bottom=fromAbove?tail(upper,p):tail(tile,p);
    const joint=Math.min(fx,1-fx);
    const vertical=smooth(clamp((joint-.014)/.065));
    const courseLip=fromAbove?Math.exp(-Math.pow((fy-bottom)/.052,2)):
      Math.exp(-Math.pow((fy-tail(upper,p))/.050,2));
    const bottomLip=smooth(clamp((yy-.78)/.24));
    const rounded=Math.pow(Math.sin(Math.PI*fx),.8);
    const glaze=periodicNoise(x,y,12,10,p.color^0x832ac711);
    const chalk=periodicNoise(x,y,30,24,p.color^0xc16893ba);
    const brush=periodicNoise(x,y,53,38,p.pattern^0xf213c11a);
    const coarse=periodicNoise(x,y,8,9,p.color^0x7bc20d5e);
    const pock=periodicNoise(x,y,96,86,p.pattern^0x42b10c38);
    const surface=coarse*.082+chalk*.045+brush*.020+pock*.011;
    const broadColor=(tile.kiln-.5)*.17+(tile.wear-.5)*.06;
    const edgePaint=(1-vertical)*.09+courseLip*.075;
    const patina=Math.max(0,coarse*.70+glaze*.33+(tile.soot-.5)*.42-.20);
    const cracked=tile.vein>.89 && yy>.25&&
      Math.abs(fx-(.30+tile.angle*.14+.045*Math.sin(yy*9)))<.012;
    const embers=[.72,.355,.215];
    const pigment=broadColor+surface-patina*.18-
      edgePaint*.80-(cracked?.085:0);
    const i=(y*SIZE+x)*3,at=y*SIZE+x;
    // Purposeful warm painted facets, not per-pixel photosource noise.
    const face=smooth(clamp((rounded-.12)/.45));
    const facet=face*(.028+tile.angle*.028)+
      (yy>.46?.012:-.012)+glaze*.046;
    albedo[i]=clamp(embers[0]+pigment+facet,.16,.92);
    albedo[i+1]=clamp(embers[1]+pigment*.72+facet*.72,.075,.72);
    albedo[i+2]=clamp(embers[2]+pigment*.49+facet*.48,.045,.51);
    const reliefGrain=periodicNoise(x,y,28,25,p.pattern^0x1b3a7d89)*.045+
      periodicNoise(x,y,9,10,p.pattern^0xa17c225b)*.064+
      brush*.018+pock*.009;
    height[at]=.22+rounded*.35*vertical+.050*Math.sin(Math.PI*yy)+
      reliefGrain*.45+courseLip*.16-bottomLip*.045-
      (1-vertical)*.16-(cracked?.07:0);
    roughness[at]=clamp(.84+chalk*.048+pock*.02+patina*.14+
      (1-vertical)*.075+courseLip*.045,.62,.99);
  }
  return {albedo,height,roughness};
}
function retroMaps(p){
  // Produce pixel art natively at 128x128. Geometry gets rasterized there,
  // then all maps upscale by nearest neighbor to retain authentic pixels.
  const resolution=128,scale=SIZE/resolution,step=resolution/p.rows;
  const pigment=new Float32Array(resolution*resolution*3);
  const relief=new Float32Array(resolution*resolution);
  const matte=new Float32Array(resolution*resolution);
  const colors=[
    [.51,.29,.19],[.57,.34,.20],[.62,.39,.24],
    [.47,.29,.23],[.66,.40,.26],[.56,.32,.20],
  ];
  for(let sy=0;sy<resolution;sy++)for(let sx=0;sx<resolution;sx++){
    const y=(sy+.5)*scale,x=(sx+.5)*scale;
    const row=Math.floor(sy/step);
    const localY=(sy%step+.5)/step;
    const tile=tileAt(x,y,row,p);
    const span=Math.min(tile.fx,1-tile.fx);
    // Eight-sided angular chipped rectangular ends replace original
    // beaver-tail scallops, with a different course count and tile widths.
    const clip=localY>.78?(localY-.78)*.24:0;
    const joint=Math.min(span-clip,localY*.70,(1-localY)*.70);
    const bevel=smooth(clamp((joint-.017)/.075));
    const grain=periodicNoise(x,y,27,29,p.pattern^0x3528ceda);
    const cloud=periodicNoise(x,y,8,8,p.color^0xa1327cea);
    const spot=hash(sx,sy,p.pattern^0x6a229bc1)-.5;
    const patina=tile.soot>.82&&spot>.12?.055:0;
    const col=colors[Math.min(colors.length-1,
      Math.floor(tile.kiln*colors.length))];
    const wash=(tile.wear-.5)*.055+grain*.060+cloud*.050-
      (1-bevel)*.12-patina;
    const at=sy*resolution+sx;
    for(let c=0;c<3;c++){
      const v=col[c]+wash*[1,.75,.55][c];
      // Four coarse pigment levels, real indexed-style color choices.
      const stone=Math.round(clamp(v,.06,.82)*11)/11;
      pigment[at*3+c]=mix([.23,.195,.16][c],stone,bevel);
    }
    const reliefField=periodicNoise(x,y,8,8,p.pattern^0x91a3ce21);
    relief[at]=.16+bevel*(.31+reliefField*.06)+grain*.017;
    matte[at]=clamp(.90+grain*.05+(1-bevel)*.05,.74,.99);
  }
  const albedo=new Float32Array(SIZE*SIZE*3);
  const height=new Float32Array(SIZE*SIZE);
  const roughness=new Float32Array(SIZE*SIZE);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const p0=Math.floor(y/scale)*resolution+Math.floor(x/scale);
    const dst=y*SIZE+x;
    for(let c=0;c<3;c++)albedo[dst*3+c]=pigment[p0*3+c];
    height[dst]=relief[p0];roughness[dst]=matte[p0];
  }
  return {albedo,height,roughness};
}

// Clay isn't a color-graded source roof. Each art direction generates its own
// beaver-tail tile coverage, slip pigment, near-joint relief and roughness.
// Painted watercolor edges follow the tile silhouettes, never random blobs.
function naturalWatercolorMaps(p,style){
  const natural=style==='naturalistic-study';
  const resolution=256,scale=SIZE/resolution;
  const colors=new Float32Array(resolution*resolution*3);
  const depths=new Float32Array(resolution*resolution);
  const rough=new Float32Array(resolution*resolution);
  const step=SIZE/p.rows;
  for(let sy=0;sy<resolution;sy++)for(let sx=0;sx<resolution;sx++){
    const x=(sx+.5)*scale,y=(sy+.5)*scale;
    const row=Math.floor(y/step),fy=y/step-row;
    const top=tileAt(x,y,row-1,p);
    const fromAbove=fy<tail(top,p);
    const tile=fromAbove?top:tileAt(x,y,row,p);
    const fyTile=fromAbove?fy+1:fy;
    const joint=Math.min(tile.fx,1-tile.fx);
    const rounded=Math.pow(Math.max(0,Math.sin(tile.fx*Math.PI)),.83);
    const tip=tail(top,p);
    const lip=Math.exp(-Math.pow((fy-tip)/.035,2));
    const face=smooth(clamp((joint-.007)/.071));
    const under=Math.exp(-Math.pow((fy-tip)/.071,2));
    const coarse=periodicNoise(x,y,natural?12:8,natural?11:9,
      p.pattern^0xa35172bc);
    const brush=periodicNoise(x,y,natural?54:32,natural?39:18,
      p.pattern^0x849ac271);
    const pores=periodicNoise(x,y,113,106,p.pattern^0x519a6c2f);
    const tide=periodicNoise(x,y,14,12,p.color^0x721ca5d1);
    const mineral=periodicNoise(x,y,31,28,p.color^0x3ec5ad71);
    const granule=periodicNoise(x,y,93,87,p.color^0xa12ce93b);
    const wash=coarse*.11+brush*.075+pores*.027;
    const fired=(tile.kiln-.5)*(natural?.20:.14);
    const fading=(tile.wear-.5)*(natural?.11:.07);
    const pooled=Math.max(0,tide+.35*mineral+.11);
    const rim=(1-face)*(natural?.095:.135)+
      under*(natural?.085:.110);
    const base=natural?[.56,.335,.224]:[.755,.453,.335];
    const tone=fired+fading+wash+mineral*(natural?.093:.13)+
      tide*(natural?.048:.125)+granule*.038-rim-
      (!natural?pooled*.050:0);
    const at=sy*resolution+sx,i=at*3;
    colors[i]=clamp(base[0]+tone,.17,.94);
    colors[i+1]=clamp(base[1]+tone*.78,.08,.76);
    colors[i+2]=clamp(base[2]+tone*.60,.05,.65);
    depths[at]=clamp(.18+rounded*.32*face+
      lip*.12-under*.11+pores*.039+brush*.019-
      (1-face)*.15,0,1);
    rough[at]=clamp((natural?.86:.92)+pores*.060+
      brush*.032+under*.045+(1-face)*.07,0,1);
  }
  // Smoothly reconstruct the hand-authored native half-res pigment bake.
  // No retro pixel blocks and no filtering of another generator's output.
  const albedo=new Float32Array(SIZE*SIZE*3);
  const height=new Float32Array(SIZE*SIZE);
  const roughness=new Float32Array(SIZE*SIZE);
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const xx=x/scale,yy=y/scale,cx=Math.floor(xx),cy=Math.floor(yy);
    const tx=smooth(xx-cx),ty=smooth(yy-cy);
    const a=cy*resolution+cx,b=cy*resolution+wrap(cx+1,resolution);
    const c=wrap(cy+1,resolution)*resolution+cx;
    const d=wrap(cy+1,resolution)*resolution+wrap(cx+1,resolution);
    const avg=(arr,n,k=0)=>mix(mix(arr[a*n+k],arr[b*n+k],tx),
      mix(arr[c*n+k],arr[d*n+k],tx),ty);
    const dst=y*SIZE+x;
    for(let k=0;k<3;k++)albedo[dst*3+k]=avg(colors,3,k);
    height[dst]=avg(depths,1);
    roughness[dst]=avg(rough,1);
  }
  return {albedo,height,roughness};
}

export function generateStyledClay(seeds,style){
  if(!CLAY_GENERATIVE_STYLES.includes(style))
    throw Error('Unsupported generative clay style: '+style);
  for(const name of ['pattern','color'])
    if(!Number.isInteger(seeds?.[name])||seeds[name]<0||
       seeds[name]>0xffffffff)
      throw Error('Invalid clay style seed: '+name);
  const definition=plan(style,seeds);
  return style==='naturalistic-study'||style==='watercolor-study'?
    naturalWatercolorMaps(definition,style):
    definition.fantasy?paintedMaps(definition):retroMaps(definition);
}
