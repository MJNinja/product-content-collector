// Writes a large transparent PNG used to test resizing / format conversion.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
export function png(w, h) {
  const row = Buffer.alloc(1 + w * 4);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const r = Buffer.from(row);
    for (let x = 0; x < w; x++) {
      const o = 1 + x * 4;
      const inside = x > w * 0.1 && x < w * 0.9 && y > h * 0.1 && y < h * 0.9;
      r[o] = 30; r[o + 1] = 90; r[o + 2] = 200; r[o + 3] = inside ? 255 : 0; // transparent border
    }
    rows.push(r);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync('tests/fixtures/pages/img/big-front.png', png(2400, 1600));
console.log('fixture images written');
