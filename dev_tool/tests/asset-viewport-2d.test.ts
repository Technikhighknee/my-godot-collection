import test from 'node:test';
import assert from 'node:assert/strict';
import {IMAGE_MIN_ZOOM,IMAGE_MAX_ZOOM,imageFitScale,imageTileRect,
  imageZoomAt,validateImageAsset,createImageViewport}
  from '../tools/asset-procgen/web/viewport-2d.mjs';

const image={id:'test',kind:'image' as const,width:1024,height:512,
  channels:'RGBA',tiles:8,atlas:{columns:4,rows:2},
  paint(){return null;}};

test('image fit stays bounded and pixel scale never exceeds 1',()=>{
  assert.equal(imageFitScale(1024,1024,512,768),.5);
  assert.equal(imageFitScale(256,256,1500,1500),1);
  assert.equal(imageFitScale(2048,256,512,1024),.25);
  assert.equal(imageFitScale(256,2048,1024,512),.25);
  assert.equal(imageFitScale(4096,4096,1,1),IMAGE_MIN_ZOOM);
  assert.equal(IMAGE_MAX_ZOOM,16);
  for(const invalid of [0,-1,NaN,Infinity])
    assert.throws(()=>imageFitScale(256,256,invalid,500));
});
test('tile extraction follows an explicit atlas grid, not a square guess',()=>{
  assert.deepEqual(imageTileRect(image,null),
    {x:0,y:0,width:1024,height:512});
  assert.deepEqual(imageTileRect(image,0),
    {x:0,y:0,width:256,height:256});
  assert.deepEqual(imageTileRect(image,5),
    {x:256,y:256,width:256,height:256});
  assert.deepEqual(imageTileRect(image,7),
    {x:768,y:256,width:256,height:256});
  for(const tile of [-1,8,1.5,NaN,undefined])
    assert.throws(()=>imageTileRect(image,tile as number));
  assert.throws(()=>imageTileRect({...image,atlas:undefined},0));
});
test('cursor-anchored zoom leaves source image point invariant',()=>{
  for(const oldZoom of [.1,.5,1,4]){
    for(const nextZoom of [.05,.3,1,8,16]){
      const pointer={x:320,y:180},offset={x:-111,y:42};
      const original=[(pointer.x-offset.x)/oldZoom,
        (pointer.y-offset.y)/oldZoom];
      const moved=imageZoomAt(oldZoom,nextZoom,pointer.x,pointer.y,
        offset.x,offset.y);
      const after=[(pointer.x-moved.x)/nextZoom,
        (pointer.y-moved.y)/nextZoom];
      for(let k=0;k<2;k++)assert.ok(Math.abs(after[k]-original[k])<1e-9);
    }
  }
  assert.throws(()=>imageZoomAt(0,1,20,20,0,0));
  assert.throws(()=>imageZoomAt(1,NaN,20,20,0,0));
});
test('image contract refuses oversized, contradictory and partial atlases',()=>{
  assert.equal(validateImageAsset(image),image);
  for(const bad of [null,{}, {...image,width:0}, {...image,height:5000},
    {...image,width:Infinity},{...image,height:1.5},
    {...image,paint:null},{...image,tiles:0},{...image,kind:'model'},
    {...image,atlas:{columns:3,rows:2}},
    {...image,atlas:{columns:4,rows:3}},
    {...image,atlas:{columns:4,rows:2.5}},
    {...image,width:1023},{...image,atlas:null}])
    assert.throws(()=>validateImageAsset(bad));
});
// The browser-only surface is driven with a small in-memory DOM / Canvas.
// These are not pixel appearance snapshots: they check the inspector's
// coordinate, interaction, channel isolation and atomic-swap behavior.
test('image preview supports alpha, tile isolation and retains a failed render',()=>{
  class Node {
    children:Node[]=[];
    className='';
    style:Record<string,string>={};
    hidden=false;
    clientWidth=760;
    clientHeight=680;
    tabIndex=-1;
    handlers=new Map<string,(event:any)=>void>();
    classList={add:(_name:string)=>{},remove:(_name:string)=>{}};
    captured:number|null=null;
    append(...nodes:Node[]){this.children.push(...nodes);}
    replaceChildren(...nodes:Node[]){this.children=nodes;}
    setAttribute(_name:string,_value:string){}
    addEventListener(name:string,handler:(event:any)=>void){this.handlers.set(name,handler);}
    fire(name:string,event:any){this.handlers.get(name)?.({...event,type:name});}
    setPointerCapture(id:number){this.captured=id;}
    hasPointerCapture(id:number){return this.captured===id;}
    releasePointerCapture(id:number){if(this.captured===id)this.captured=null;}
    getBoundingClientRect(){return {left:0,top:0};}
  }
  class Canvas extends Node {
    width=0;height=0;
    pixels=new Uint8ClampedArray(0);
    getContext(_name:string){
      const current=this;
      return {
        drawImage(src:Canvas,sx:number,sy:number,sw:number,sh:number){
          current.pixels=new Uint8ClampedArray(current.width*current.height*4);
          for(let y=0;y<sh;y++)
            for(let x=0;x<sw;x++)
              for(let c=0;c<4;c++)
                current.pixels[(y*current.width+x)*4+c]=
                  src.pixels[((sy+y)*src.width+sx+x)*4+c]!;
        },
        getImageData(){return {data:current.pixels.slice()};},
        putImageData(img:{data:Uint8ClampedArray}){
          current.pixels=img.data.slice();
        },
      };
    }
  }
  const savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const savedObserver=Object.getOwnPropertyDescriptor(globalThis,'ResizeObserver');
  try{
    Object.defineProperty(globalThis,'document',{configurable:true,value:{
      createElement:(tag:string)=>tag==='canvas'?new Canvas():new Node(),
    }});
    Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:
      class {observe(){}}
    });
    const host=new Node(),updates:any[]=[];
    const preview=createImageViewport(host as unknown as HTMLElement,
      state=>updates.push(state));
    const sourcePixels=new Uint8ClampedArray(4*4*4);
    for(let i=0;i<16;i++){
      sourcePixels.set([10+i,60+i,120+i,i%2===0?0:128],i*4);
    }
    const asset={id:'small',kind:'image' as const,width:4,height:4,
      tiles:4,atlas:{columns:2,rows:2},channels:'RGBA',
      paint(canvas:HTMLCanvasElement){
        (canvas as unknown as Canvas).pixels=sourcePixels.slice();
      },
    };
    assert.deepEqual(preview.render(asset),
      {width:4,height:4,channels:'RGBA',tiles:4});
    assert.equal(preview.state().mode,'fit');
    const surface=host.children[0]!;
    const mat=surface.children[0]!;
    let visible=mat.children[0] as Canvas;
    assert.deepEqual([...visible.pixels], [...sourcePixels]);
    preview.setChannel('alpha');
    visible=mat.children[0] as Canvas;
    assert.deepEqual([...visible.pixels.slice(0,8)],
      [0,0,0,255,128,128,128,255]);
    assert.deepEqual([...sourcePixels.slice(0,8)],
      [10,60,120,0,11,61,121,128],'The source is never rewritten');
    preview.setChannel('rgb');
    visible=mat.children[0] as Canvas;
    assert.deepEqual([...visible.pixels.slice(0,8)],
      [10,60,120,255,11,61,121,255]);
    preview.selectTile(3);
    assert.equal(preview.state().tile,3);
    assert.deepEqual([preview.state().viewWidth,preview.state().viewHeight],[2,2]);
    assert.deepEqual([...((mat.children[0] as Canvas).pixels.slice(0,4))],
      [20,70,130,255]);
    preview.zoomStep(1);
    assert.equal(preview.state().mode,'custom');
    const before=preview.state().scale;
    const wheel={clientX:300,clientY:200,deltaY:-150,
      preventDefault(){this.prevented=true;},prevented:false};
    surface.fire('wheel',wheel);
    assert.ok(preview.state().scale>before);
    preview.setMode('actual');
    assert.equal(preview.state().scale,1);
    preview.setMode('fit');
    assert.equal(preview.state().mode,'fit');
    preview.selectTile(null);
    assert.equal(preview.state().tile,null);
    preview.setChannel('rgba');
    const beforeDrag=mat.style.transform;
    surface.fire('pointerdown',{pointerId:8,button:0,clientX:320,
      clientY:300,preventDefault(){}});
    surface.fire('pointermove',{pointerId:8,clientX:350,clientY:330});
    surface.fire('pointerup',{pointerId:8,button:0,clientX:350,clientY:330});
    assert.notEqual(mat.style.transform,beforeDrag,'Dragging moves the image');
    assert.equal(preview.state().mode,'custom');
    // Click an atlas cell after panning: the hit test uses inverse
    // zoom/translation, not viewport percentages.
    const transform=mat.style.transform.match(
      /translate\(([-0-9.]+)px,([-0-9.]+)px\) scale\(([-0-9.]+)\)/);
    assert.ok(transform);
    const clickX=Number(transform[1])+3*Number(transform[3]);
    const clickY=Number(transform[2])+3*Number(transform[3]);
    surface.fire('pointerdown',{pointerId:9,button:0,clientX:clickX,
      clientY:clickY,preventDefault(){}});
    surface.fire('pointerup',{pointerId:9,button:0,clientX:clickX,
      clientY:clickY});
    assert.equal(preview.state().tile,3,'Click isolates the matching tile');
    preview.selectTile(null);
    assert.deepEqual([...((mat.children[0] as Canvas).pixels)],[...sourcePixels]);
    const oldCanvas=mat.children[0],oldSourcePixels=sourcePixels.slice();
    assert.throws(()=>preview.render({...asset,paint(){throw Error('no paint');}}),
      /no paint/);
    assert.equal(mat.children[0],oldCanvas);
    assert.deepEqual([...((mat.children[0] as Canvas).pixels)],[...oldSourcePixels]);
    assert.throws(()=>preview.selectTile(5),/Invalid image tile/);
    assert.throws(()=>preview.setChannel('height' as Parameters<typeof preview.setChannel>[0]),
      /Invalid image channel/);
    assert.ok(updates.length>=7);
  }finally{
    if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument);
    else Reflect.deleteProperty(globalThis,'document');
    if(savedObserver)Object.defineProperty(globalThis,'ResizeObserver',savedObserver);
    else Reflect.deleteProperty(globalThis,'ResizeObserver');
  }
});
