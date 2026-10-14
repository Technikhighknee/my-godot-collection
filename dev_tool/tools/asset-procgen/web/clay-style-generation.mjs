// Independent clay-roof *generation grammars* for art-direction studies.
// The original beaver-tail roof remains in roof-textures.mjs unchanged.
// Painted and retro differ in tile layout, silhouette, wear, height and
// roughness -- not just in post-process grading of the same bitmap.
// UV convention: X runs along ridge, Y downhill. Both axes repeat.
export const CLAY_GENERATIVE_STYLES=Object.freeze([
  'hand-painted-study','retro-3d-study',
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
  const fantasy=style==='hand-painted-study';
  const columns=fantasy?7:8,rows=8;
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
    height[at]=.22+rounded*.35*vertical+.050*Math.sin(Math.PI*yy)+
      surface*.37+courseLip*.16-bottomLip*.045-
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
    const localY=(sy%step)/step;
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
    relief[at]=.16+bevel*(.31+cloud*.06)+grain*.017;
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
export function generateStyledClay(seeds,style){
  if(!CLAY_GENERATIVE_STYLES.includes(style))
    throw Error('Unsupported generative clay style: '+style);
  for(const name of ['pattern','color'])
    if(!Number.isInteger(seeds?.[name])||seeds[name]<0||
       seeds[name]>0xffffffff)
      throw Error('Invalid clay style seed: '+name);
  const definition=plan(style,seeds);
  return definition.fantasy?paintedMaps(definition):retroMaps(definition);
}
