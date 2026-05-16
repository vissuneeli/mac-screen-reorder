// Generates 16x16 and 32x32 black-circle PNG template images for the macOS menu-bar tray.
// Run once: node scripts/gen-tray-icon.js
const fs   = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = (table[(crc ^ b) & 0xFF] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typ = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typ, data])));
  return Buffer.concat([len, typ, data, crc]);
}

function circlePNG(size) {
  const sig  = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA

  const cx = size / 2, cy = size / 2, r = size / 2 - 1.5;
  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0); // filter byte
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const a = Math.max(0, Math.min(255, Math.round((r - Math.sqrt(dx*dx+dy*dy) + 0.5) * 255)));
      raw.push(0, 0, 0, a); // black RGBA
    }
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync('src/assets', { recursive: true });
fs.writeFileSync('src/assets/tray-icon.png',    circlePNG(16));
fs.writeFileSync('src/assets/tray-icon@2x.png', circlePNG(32));
console.log('Generated src/assets/tray-icon.png + tray-icon@2x.png');
