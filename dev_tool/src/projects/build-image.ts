// Deterministic, dependency-free RGBA8 PNG output for baked texture maps.
// No native canvas, browser, WebGL, or image library is required.
import {deflateSync} from 'node:zlib';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=new Uint32Array(256);
for(let i=0;i<256;i++){
  let v=i;
  for(let j=0;j<8;j++)v=(v&1)?0xedb88320^(v>>>1):v>>>1;
  crcTable[i]=v>>>0;
}
function crc32(bytes:Uint8Array):number{
  let c=0xffffffff;
  for(const n of bytes)c=crcTable[(c^n)&255]!^(c>>>8);
  return (c^0xffffffff)>>>0;
}
function chunk(name:string,payload:Buffer):Buffer{
  const out=Buffer.alloc(12+payload.length);
  out.writeUInt32BE(payload.length,0);
  out.write(name,4,4,'ascii');
  payload.copy(out,8);
  out.writeUInt32BE(crc32(out.subarray(4,8+payload.length)),8+payload.length);
  return out;
}
export function encodeRgbaPng(width:number,height:number,pixels:Uint8Array):Buffer{
  if(!Number.isInteger(width)||!Number.isInteger(height)||
    width<1||height<1||width>4096||height>4096||
    width*height>16_000_000||pixels.length!==width*height*4)
    throw Error('Invalid RGBA texture dimensions or payload');
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);
  ihdr[8]=8;ihdr[9]=6; // RGBA8
  const stride=width*4;
  const raw=Buffer.alloc(height*(1+stride));
  for(let y=0;y<height;y++)
    raw.set(pixels.subarray(y*stride,(y+1)*stride),y*(stride+1)+1);
  return Buffer.concat([signature,chunk('IHDR',ihdr),
    chunk('IDAT',deflateSync(raw,{level:6})),chunk('IEND',Buffer.alloc(0))]);
}
export interface BakedPixels {width:number;height:number;rgba:Uint8Array;}
export function capturePaintedPixels(asset:{
  paint:(canvas:HTMLCanvasElement,view?:string,profile?:string)=>unknown;
},view:string,profile?:string):BakedPixels{
  let result:Uint8Array|null=null;
  const canvas={
    width:0,height:0,
    getContext(type:string){
      if(type!=='2d')throw Error('Baker needs a 2D image context');
      return {
        createImageData(w:number,h:number){
          if(!Number.isInteger(w)||!Number.isInteger(h)||
            w<1||h<1||w>4096||h>4096||w*h>16_000_000)
            throw Error('Invalid baked texture size');
          return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};
        },
        putImageData(data:{width:number;height:number;data:Uint8ClampedArray},
          x:number,y:number){
          if(x!==0||y!==0||canvas.width!==data.width||
            canvas.height!==data.height||
            data.data.length!==data.width*data.height*4)
            throw Error('Invalid image data placement');
          if(result)throw Error('Texture baker received multiple image buffers');
          result=new Uint8Array(data.data);
        },
      };
    },
  };
  asset.paint(canvas as unknown as HTMLCanvasElement,view,profile);
  if(!result)throw Error('Generator does not support headless pixel baking');
  return {width:canvas.width,height:canvas.height,rgba:result};
}
