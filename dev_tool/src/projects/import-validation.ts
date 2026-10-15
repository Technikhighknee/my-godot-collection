// Verify bytes behind an imported asset source; metadata validation belongs
// to asset-source.ts and persistence belongs to ProjectLibrary.
import {MAX_IMPORTED_ASSET_BYTES} from './asset-source.ts';
import type {ImportFormat} from './asset-source.ts';
const crcTable=new Uint32Array(256);
for(let i=0;i<256;i++){
  let c=i;
  for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;
  crcTable[i]=c>>>0;
}
function pngCrc32(bytes:Uint8Array):number{
  let crc=0xffffffff;
  for(const value of bytes)crc=crcTable[(crc^value)&255]!^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}

export function validateImportBytes(format:ImportFormat,bytes:Buffer):void{
  if(bytes.length<24||bytes.length>MAX_IMPORTED_ASSET_BYTES)
    throw Error('Invalid import size');
  if(format==='glb'){
    if(bytes.length<20||bytes.toString('ascii',0,4)!=='glTF'||
      bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)
      throw Error('Invalid binary glTF 2.0 header');
    let offset=12,first=true;
    while(offset<bytes.length){
      if(offset+8>bytes.length)throw Error('Truncated GLB chunk');
      const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4);
      if(length%4!==0||offset+8+length>bytes.length)
        throw Error('Invalid GLB chunk length');
      if(first){
        if(type!==0x4e4f534a)throw Error('GLB requires JSON as its first chunk');
        let json:unknown;
        try{json=JSON.parse(bytes.toString('utf8',offset+8,offset+8+length).trim());}
        catch{throw Error('Invalid GLB JSON chunk');}
        if(!json||typeof json!=='object'||!('asset' in json)||
          typeof json.asset!=='object'||json.asset===null||
          !('version' in json.asset)||json.asset.version!=='2.0')
          throw Error('Invalid glTF asset version');
      }
      first=false;offset+=8+length;
    }
    if(first||offset!==bytes.length)throw Error('Invalid GLB chunks');
  }else if(format==='png'){
    if(bytes.length<45||
      !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
      bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'||
      bytes.readUInt32BE(16)===0||bytes.readUInt32BE(20)===0)
      throw Error('Invalid PNG image header');
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    if(width*height>128_000_000)throw Error('PNG dimensions exceed limit');
    let offset=8,hasImage=false,ended=false;
    while(offset<bytes.length){
      if(offset+12>bytes.length)throw Error('Truncated PNG chunk');
      const length=bytes.readUInt32BE(offset);
      if(length>bytes.length-offset-12)throw Error('Invalid PNG chunk length');
      const expected=bytes.readUInt32BE(offset+8+length);
      if(pngCrc32(bytes.subarray(offset+4,offset+8+length))!==expected)
        throw Error('Corrupt PNG checksum');
      const tag=bytes.toString('ascii',offset+4,offset+8);
      if(tag==='IDAT')hasImage=true;
      if(tag==='IEND'){
        if(length!==0||offset+12!==bytes.length)
          throw Error('Invalid PNG end chunk');
        ended=true;
      }
      offset+=length+12;
    }
    if(!hasImage||!ended)throw Error('Incomplete PNG image');
  }else throw Error('Unsupported import format');
}
