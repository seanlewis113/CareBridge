import { writeFileSync, mkdirSync } from 'fs';
import { deflateSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(iconsDir, { recursive: true });

function makePng(size) {
  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0);
    for (let x = 0; x < size; x++) {
      const cx = size / 2;
      const dist = Math.hypot(x - cx, y - size * 0.38);
      const inCircle = dist < size * 0.18;
      const inArc = y > size * 0.55 && y < size * 0.72 && Math.abs(x - cx) < size * 0.35;
      if (inCircle || inArc) raw.push(230, 126, 34, 255);
      else raw.push(253, 246, 236, 255);
    }
  }
  return buildPng(size, size, deflateSync(Buffer.from(raw)));
}

function buildPng(width, height, idat) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 6; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  return Buffer.concat([
    signature,
    createChunk('IHDR', ihdrData),
    createChunk('IDAT', idat),
    createChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

writeFileSync(join(iconsDir, 'icon-192.png'), makePng(192));
writeFileSync(join(iconsDir, 'icon-512.png'), makePng(512));
console.log('Icons generated');
