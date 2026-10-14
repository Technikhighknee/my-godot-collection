// PNG contact sheet for the Texture Style Study.
// Draw the actual, currently rendered preview canvases into one predictable
// composition. No screenshot dependencies, DOM traversal or project writes.
const PAD=36;
const LABEL=220;
const CELL=320;
const GAP=14;
const HEADER_TOP=160;
const HEADER_HEIGHT=88;
const ROW_HEIGHT=338;
const IMAGE=268;
const FOOTER_HEIGHT=72;

function checkItems(styles,materials){
  if(!Array.isArray(styles)||styles.length<1||styles.length>12)
    throw Error('Select at least one art direction for PNG export');
  if(!Array.isArray(materials)||materials.length<1||materials.length>20)
    throw Error('No materials to export');
  const ids=new Set();
  for(const style of styles){
    if(typeof style?.id!=='string'||!style.id||
       typeof style?.label!=='string'||!style.label||ids.has(style.id))
      throw Error('Invalid or duplicate texture style');
    ids.add(style.id);
  }
  for(const material of materials)
    if(typeof material?.id!=='string'||!material.id||
       typeof material?.label!=='string'||!material.label)
      throw Error('Invalid texture material');
}
export function textureStudyExportLayout(styles,materials){
  checkItems(styles,materials);
  const width=PAD*2+LABEL+GAP+styles.length*CELL+
    Math.max(0,styles.length-1)*GAP;
  const rowsTop=HEADER_TOP+HEADER_HEIGHT+12;
  const footerTop=rowsTop+materials.length*ROW_HEIGHT+12;
  return Object.freeze({
    width,height:footerTop+FOOTER_HEIGHT,padding:PAD,
    labelWidth:LABEL,cellWidth:CELL,gap:GAP,
    headerTop:HEADER_TOP,headerHeight:HEADER_HEIGHT,
    rowsTop,rowHeight:ROW_HEIGHT,imageSize:IMAGE,footerTop,
  });
}
function wrapped(ctx,text,x,y,maxWidth,lineHeight,maxLines=2){
  const words=String(text).split(/\s+/).filter(Boolean),lines=[];
  let line='';
  for(const word of words){
    const candidate=line?line+' '+word:word;
    if(line&&ctx.measureText(candidate).width>maxWidth){
      lines.push(line);
      line=word;
    }else line=candidate;
  }
  if(line)lines.push(line);
  for(let row=0;row<Math.min(lines.length,maxLines);row++){
    let content=row===maxLines-1?lines.slice(row).join(' '):lines[row];
    if(ctx.measureText(content).width>maxWidth){
      while(content.length>1&&ctx.measureText(content+'…').width>maxWidth)
        content=content.slice(0,-1);
      content+='…';
    }
    ctx.fillText(content,x,y+row*lineHeight);
  }
}
const asTitle=value=>String(value??'').trim();
export function textureStudyExportFilename({view='albedo',seed=null,
  styles=[]}={}){
  const clean=value=>String(value).toLowerCase()
    .replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'');
  const channel=clean(view)||'albedo';
  const source=seed===null?'reference':'seed-'+clean(seed);
  return '1400-texture-style-study-'+channel+'-'+source+'-'+
    styles.length+'-styles.png';
}
export function drawTextureStudyExport(canvas,{
  styles,materials,cells,view='albedo',profile='panel',
  seed=null,tiling=false,
}){
  const layout=textureStudyExportLayout(styles,materials);
  if(!cells||typeof cells.get!=='function')
    throw Error('Texture preview cells are required');
  // Fail before allocating or downloading a misleading partial contact sheet.
  for(const material of materials)for(const style of styles){
    const cell=cells.get(material.id+'/'+style.id);
    if(!cell?.canvas||cell.canvas.width<1||cell.canvas.height<1)
      throw Error('Missing rendered preview: '+material.id+' / '+style.id);
  }
  canvas.width=layout.width;
  canvas.height=layout.height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Canvas 2D context required for PNG export');
  ctx.textBaseline='top';
  ctx.fillStyle='#101b1d';
  ctx.fillRect(0,0,layout.width,layout.height);

  // Cover information not inferable from the pixels themselves.
  ctx.fillStyle='#d9bd8c';ctx.font='700 14px Segoe UI, sans-serif';
  ctx.fillText('1400  /  ASSET PROCGEN',PAD,27);
  ctx.fillStyle='#f2e6d0';ctx.font='500 35px Georgia, serif';
  ctx.fillText('Texture Style Study',PAD,57);
  const timber={panel:'Wide face',beam:'Long grain',end:'End grain'};
  const channel=asTitle(view).toUpperCase();
  const seedText=seed===null?'Reference seeds':'Master seed: '+seed;
  const metadata=channel+'    ·    Timber: '+(timber[profile]??profile)+
    '    ·    '+seedText+'    ·    Tiling: '+(tiling?'2 × 2':'Off')+
    '    ·    '+styles.length+' styles / '+materials.length+' materials';
  ctx.fillStyle='#b6c9bd';ctx.font='13px Segoe UI, sans-serif';
  wrapped(ctx,metadata,PAD,116,layout.width-PAD*2,18,2);

  ctx.fillStyle='#233532';
  ctx.fillRect(PAD,layout.headerTop,layout.labelWidth,layout.headerHeight);
  ctx.fillStyle='#a8b8a9';ctx.font='700 13px Segoe UI, sans-serif';
  ctx.fillText('MATERIAL',PAD+14,layout.headerTop+29);
  for(let j=0;j<styles.length;j++){
    const style=styles[j],x=PAD+LABEL+GAP+j*(CELL+GAP);
    ctx.fillStyle=style.id==='current'?'#263d38':'#35382d';
    ctx.fillRect(x,layout.headerTop,CELL,layout.headerHeight);
    ctx.fillStyle=style.id==='current'?'#d6e3d7':'#f0d6aa';
    ctx.font='700 18px Segoe UI, sans-serif';
    wrapped(ctx,style.label,x+14,layout.headerTop+13,CELL-28,21,2);
    ctx.fillStyle='#b4c3b8';ctx.font='11px Segoe UI, sans-serif';
    wrapped(ctx,style.description??'',x+14,layout.headerTop+49,
      CELL-28,15,2);
  }
  for(let i=0;i<materials.length;i++){
    const material=materials[i],y=layout.rowsTop+i*ROW_HEIGHT;
    ctx.fillStyle=i%2===0?'#1b2a2a':'#1a2828';
    ctx.fillRect(PAD,y,LABEL,ROW_HEIGHT-GAP);
    ctx.fillStyle='#b8c5b6';ctx.font='700 12px Segoe UI, sans-serif';
    ctx.fillText(material.group??'Material',PAD+14,y+32);
    ctx.fillStyle='#f0e3d0';ctx.font='500 22px Georgia, serif';
    wrapped(ctx,material.label,PAD+14,y+63,LABEL-28,26,2);
    ctx.fillStyle='#97afa3';ctx.font='12px Segoe UI, sans-serif';
    ctx.fillText(material.id,PAD+14,y+129);
    for(let j=0;j<styles.length;j++){
      const style=styles[j],x=PAD+LABEL+GAP+j*(CELL+GAP);
      const cell=cells.get(material.id+'/'+style.id);
      ctx.fillStyle=i%2===0?'#1c2b29':'#192724';
      ctx.fillRect(x,y,CELL,ROW_HEIGHT-GAP);
      ctx.fillStyle=style.id==='current'?'#537467':'#635841';
      ctx.fillRect(x,y,3,ROW_HEIGHT-GAP);
      const imageX=x+(CELL-IMAGE)/2,imageY=y+13;
      // Retro texels must remain crisp when scaled.
      ctx.imageSmoothingEnabled=style.id!=='retro-3d-study';
      ctx.imageSmoothingQuality='high';
      ctx.drawImage(cell.canvas,imageX,imageY,IMAGE,IMAGE);
      ctx.imageSmoothingEnabled=true;
      ctx.fillStyle='#a8bcb1';ctx.font='11px Segoe UI, sans-serif';
      wrapped(ctx,cell.info?.textContent??'',
        x+17,y+IMAGE+25,CELL-34,15,2);
    }
  }
  ctx.fillStyle='#a7b9ae';ctx.font='12px Segoe UI, sans-serif';
  ctx.fillText('Generated preview comparison  ·  Identical source seeds per material  ·  No saved assets changed',
    PAD,layout.footerTop+17);
  ctx.fillStyle='#7f968d';ctx.font='11px Segoe UI, sans-serif';
  ctx.fillText('Styles are experimental art-direction studies, not production presets.',
    PAD,layout.footerTop+37);
  return layout;
}
