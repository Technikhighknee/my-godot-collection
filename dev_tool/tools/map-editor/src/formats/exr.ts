import { deflateSync, inflateSync } from 'node:zlib';

/** Narrow, explicitly validated OpenEXR scanline interchange contract.
 * Single R or Y channel, FLOAT32, no subsampling; NO/ZIPS/ZIP compression.
 * No multipart, tiles, deep data, 16-bit floats or image transforms.
 */
export interface FloatImage { width: number; height: number; data: Float32Array; }
const MAGIC = 20000630;
const MAX_PIXELS = 32_000_000;
function requireExr(ok: unknown, message: string): void { if (!ok) throw new Error(`EXR: ${message}`); }
function u32(b: Buffer, p: number) { requireExr(p >= 0 && p + 4 <= b.length, 'truncated uint32'); return b.readUInt32LE(p); }
function i32(b: Buffer, p: number) { requireExr(p >= 0 && p + 4 <= b.length, 'truncated int32'); return b.readInt32LE(p); }
function readString(b: Buffer, state: { offset: number }, limit: number): string {
  const begin = state.offset;
  while (state.offset < limit && b[state.offset] !== 0) state.offset++;
  requireExr(state.offset < limit, 'unterminated string');
  const result = b.toString('ascii', begin, state.offset);
  state.offset++;
  return result;
}
function uncompressBlock(encoded: Buffer, expected: number, compressed: boolean): Buffer {
  if (!compressed || encoded.length === expected) {
    requireExr(encoded.length === expected, 'wrong raw block length');
    return encoded;
  }
  const reordered = inflateSync(encoded, { maxOutputLength: expected });
  requireExr(reordered.length === expected, 'ZIP decompression length mismatch');
  for (let k = 1; k < expected; k++) reordered[k] = (reordered[k] + reordered[k - 1] - 128) & 255;
  const original = Buffer.allocUnsafe(expected);
  const evenCount = Math.ceil(expected / 2);
  for (let k = 0; k < evenCount; k++) original[k * 2] = reordered[k];
  for (let k = 0; k < Math.floor(expected / 2); k++) original[k * 2 + 1] = reordered[evenCount + k];
  return original;
}
function compressBlock(raw: Buffer): Buffer {
  const reordered = Buffer.allocUnsafe(raw.length), evenCount = Math.ceil(raw.length / 2);
  for (let k = 0; k < evenCount; k++) reordered[k] = raw[k * 2];
  for (let k = 0; k < Math.floor(raw.length / 2); k++) reordered[evenCount + k] = raw[k * 2 + 1];
  let previous = reordered[0];
  for (let k = 1; k < reordered.length; k++) {
    const current = reordered[k];
    reordered[k] = (current - previous + 128) & 255;
    previous = current;
  }
  const zipped = deflateSync(reordered, { level: 6 });
  return zipped.length < raw.length ? zipped : raw;
}
export function decodeExr(bytes: Uint8Array): FloatImage {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  requireExr(b.length >= 16 && u32(b, 0) === MAGIC, 'invalid signature');
  requireExr(u32(b, 4) === 2, 'unsupported version or flags (multipart/tiled/deep not supported)');
  const cursor = { offset: 8 }, fields = new Map<string, { type: string; value: Buffer }>();
  while (true) {
    requireExr(cursor.offset < b.length && cursor.offset < 65536, 'header too large or truncated');
    const name = readString(b, cursor, b.length);
    if (!name) break;
    const type = readString(b, cursor, b.length);
    const length = u32(b, cursor.offset); cursor.offset += 4;
    requireExr(length < 65536 && cursor.offset + length <= b.length && !fields.has(name), 'invalid attribute');
    fields.set(name, { type, value: b.subarray(cursor.offset, cursor.offset + length) });
    cursor.offset += length;
  }
  function field(name: string, type: string): Buffer {
    const f = fields.get(name); requireExr(f?.type === type, `missing or wrong ${name}`); return f!.value;
  }
  const channels = field('channels', 'chlist');
  const chCursor = { offset: 0 }, channel = readString(channels, chCursor, channels.length);
  requireExr(channel === 'R' || channel === 'Y', 'expected a single R or Y channel');
  requireExr(u32(channels, chCursor.offset) === 2, 'expected FLOAT32 pixels');
  requireExr(chCursor.offset + 16 <= channels.length, 'truncated channel');
  requireExr(u32(channels, chCursor.offset + 8) === 1 && u32(channels, chCursor.offset + 12) === 1, 'subsampled channels not supported');
  chCursor.offset += 16;
  requireExr(chCursor.offset + 1 === channels.length && channels[chCursor.offset] === 0, 'exactly one channel required');
  const box = field('dataWindow', 'box2i'); requireExr(box.length === 16, 'invalid data window');
  const minX = i32(box, 0), minY = i32(box, 4), maxX = i32(box, 8), maxY = i32(box, 12);
  const width = maxX - minX + 1, height = maxY - minY + 1;
  requireExr(minX === 0 && minY === 0, 'nonzero dataWindow origin not supported');
  requireExr(width > 0 && height > 0 && width * height <= MAX_PIXELS, 'invalid or oversized dimensions');
  const compression = field('compression', 'compression');
  requireExr(compression.length === 1 && [0, 2, 3].includes(compression[0]), 'supported compression: none, ZIPS, ZIP');
  const mode = compression[0], blockLines = mode === 3 ? 16 : 1;
  const order = field('lineOrder', 'lineOrder'); requireExr(order.length === 1 && order[0] === 0, 'unsupported line order');
  const count = Math.ceil(height / blockLines);
  const offsetTable = cursor.offset;
  requireExr(offsetTable + count * 8 <= b.length, 'truncated offset table');
  const data = new Float32Array(width * height);
  const seen = new Set<number>();
  for (let k = 0; k < count; k++) {
    const pos = Number(b.readBigUInt64LE(offsetTable + k * 8));
    requireExr(Number.isSafeInteger(pos) && pos >= offsetTable + count * 8 && pos + 8 <= b.length, 'invalid scanline offset');
    const y = i32(b, pos), length = u32(b, pos + 4);
    requireExr(y >= 0 && y < height && y % blockLines === 0 && !seen.has(y), 'invalid or duplicate block y');
    seen.add(y);
    requireExr(pos + 8 + length <= b.length, 'block extends past file');
    const lines = Math.min(blockLines, height - y), rawLength = lines * width * 4;
    const raw = uncompressBlock(b.subarray(pos + 8, pos + 8 + length), rawLength, mode !== 0);
    for (let i = 0; i < lines * width; i++) data[y * width + i] = raw.readFloatLE(i * 4);
  }
  for (let k = 0; k < data.length; k++) requireExr(Number.isFinite(data[k]), `nonfinite pixel at ${k}`);
  return { width, height, data };
}
function attribute(name: string, type: string, value: Buffer): Buffer {
  const header = Buffer.alloc(4); header.writeUInt32LE(value.length);
  return Buffer.concat([Buffer.from(name + '\0' + type + '\0', 'ascii'), header, value]);
}
function box2i(width: number, height: number): Buffer {
  const b = Buffer.alloc(16); b.writeInt32LE(width - 1, 8); b.writeInt32LE(height - 1, 12); return b;
}
/** Writes a single-channel FLOAT32 ZIP-scanline EXR, preserving all Float32 bits. */
export function encodeExr(image: FloatImage): Buffer {
  const { width, height, data } = image;
  requireExr(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= MAX_PIXELS, 'invalid dimensions');
  requireExr(data instanceof Float32Array && data.length === width * height, 'invalid float data');
  for (const value of data) requireExr(Number.isFinite(value), 'nonfinite float');
  const ch = Buffer.alloc(19); ch.write('Y\0', 0, 'ascii'); ch.writeUInt32LE(2, 2); ch.writeUInt32LE(1, 10); ch.writeUInt32LE(1, 14);
  const center = Buffer.alloc(8), aspect = Buffer.alloc(4), winWidth = Buffer.alloc(4);
  aspect.writeFloatLE(1); winWidth.writeFloatLE(1);
  const header = Buffer.concat([
    attribute('channels', 'chlist', ch), attribute('compression', 'compression', Buffer.from([3])),
    attribute('dataWindow', 'box2i', box2i(width, height)),
    attribute('displayWindow', 'box2i', box2i(width, height)),
    attribute('lineOrder', 'lineOrder', Buffer.from([0])),
    attribute('pixelAspectRatio', 'float', aspect),
    attribute('screenWindowCenter', 'v2f', center),
    attribute('screenWindowWidth', 'float', winWidth), Buffer.from([0])
  ]);
  const signature = Buffer.alloc(8); signature.writeUInt32LE(MAGIC); signature.writeUInt32LE(2, 4);
  const count = Math.ceil(height / 16), blocks: Buffer[] = [];
  for (let y = 0; y < height; y += 16) {
    const lines = Math.min(16, height - y), raw = Buffer.allocUnsafe(width * lines * 4);
    for (let i = 0; i < width * lines; i++) raw.writeFloatLE(data[y * width + i], i * 4);
    const payload = compressBlock(raw), b = Buffer.allocUnsafe(payload.length + 8);
    b.writeInt32LE(y, 0); b.writeUInt32LE(payload.length, 4); payload.copy(b, 8); blocks.push(b);
  }
  const offsets = Buffer.allocUnsafe(count * 8);
  let current = signature.length + header.length + offsets.length;
  for (let k = 0; k < count; k++) { offsets.writeBigUInt64LE(BigInt(current), k * 8); current += blocks[k].length; }
  return Buffer.concat([signature, header, offsets, ...blocks]);
}
