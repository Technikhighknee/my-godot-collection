import { deflateSync, inflateSync } from 'node:zlib';

export interface IndexedSurface { width: number; height: number; data: Uint8Array; }
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PIXELS = 32_000_000;
function ensure(test: unknown, message: string): void { if (!test) throw new Error(`PNG: ${message}`); }
const crcTable = new Uint32Array(256);
for (let k = 0; k < 256; k++) { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[k] = c >>> 0; }
function crc32(buf: Uint8Array): number { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii'), result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, 8 + data.length)), 8 + data.length);
  return result;
}
const paeth = (a: number, b: number, c: number) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
/** Preserves grayscale index values exactly; rejects RGB and indexed-palette PNGs. */
export function decodeSurfacePng(bytes: Uint8Array): IndexedSurface {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  ensure(b.length >= 8 && b.subarray(0, 8).equals(SIG), 'bad signature');
  let pos = 8, width = 0, height = 0, ihdr = false, iend = false, idatEnded = false, sawData = false;
  const parts: Buffer[] = [];
  while (pos + 12 <= b.length && !iend) {
    const length = b.readUInt32BE(pos);
    ensure(length <= b.length - pos - 12, 'truncated chunk');
    const name = b.toString('ascii', pos + 4, pos + 8), data = b.subarray(pos + 8, pos + 8 + length);
    ensure(crc32(b.subarray(pos + 4, pos + 8 + length)) === b.readUInt32BE(pos + 8 + length), `CRC mismatch in ${name}`);
    if (!ihdr) ensure(name === 'IHDR', 'IHDR must be first');
    if (name === 'IHDR') {
      ensure(!ihdr && length === 13, 'invalid IHDR'); ihdr = true;
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      ensure(width > 0 && height > 0 && width * height <= MAX_PIXELS, 'invalid dimensions');
      ensure(data[8] === 8 && data[9] === 0 && data[10] === 0 && data[11] === 0 && data[12] === 0, 'requires grayscale 8-bit noninterlaced PNG');
    } else if (name === 'IDAT') {
      ensure(!idatEnded && ihdr, 'IDAT out of order'); parts.push(data); sawData = true;
    } else if (name === 'IEND') { ensure(length === 0 && sawData, 'invalid IEND'); iend = true; }
    else {
      if (sawData) idatEnded = true;
      ensure(!/^[A-Z]/.test(name), `unsupported critical chunk ${name}`);
    }
    pos += 12 + length;
  }
  ensure(iend && pos === b.length, 'missing IEND or trailing bytes');
  const expected = (width + 1) * height;
  const raw = inflateSync(Buffer.concat(parts), { maxOutputLength: expected });
  ensure(raw.length === expected, 'unexpected uncompressed data size');
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)]; ensure(filter <= 4, `bad filter ${filter}`);
    for (let x = 0; x < width; x++) {
      const current = raw[y * (width + 1) + x + 1], p = y * width + x;
      const a = x > 0 ? result[p - 1] : 0, above = y > 0 ? result[p - width] : 0;
      const upperLeft = y > 0 && x > 0 ? result[p - width - 1] : 0;
      const correction = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? above : filter === 3 ? Math.floor((a + above) / 2) : paeth(a, above, upperLeft);
      result[p] = (current + correction) & 255;
    }
  }
  return { width, height, data: result };
}
export function encodeSurfacePng(surface: IndexedSurface): Buffer {
  const { width, height, data } = surface;
  ensure(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= MAX_PIXELS, 'invalid dimensions');
  ensure(data instanceof Uint8Array && data.length === width * height, 'invalid surface data');
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 0;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  return Buffer.concat([SIG, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
