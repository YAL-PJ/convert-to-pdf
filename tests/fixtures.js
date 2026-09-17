/**
 * Test inputs, generated in code instead of committed as binaries so the repo
 * stays reviewable and a new regression case is a few lines, not a blob.
 */
const zlib = require('zlib');

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Valid 8-bit RGB PNG (colour type 2 -> 24-bit colour depth), solid colour. */
function makePng(width = 24, height = 16, rgb = [200, 60, 40]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 3;
      raw[p] = rgb[0];
      raw[p + 1] = rgb[1];
      raw[p + 2] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A PNG whose pixel stream is garbage: header parses, decode fails. */
function makeCorruptPng() {
  const good = makePng();
  const broken = Buffer.from(good);
  // Trash everything after the IHDR chunk, keeping the signature + header.
  broken.fill(0x41, 40);
  return broken;
}

/** Looks like a ZIP (PK header) but has no central directory -> DOCX read fails. */
function makeCorruptDocx() {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('this is not a real office document'.repeat(4), 'ascii'),
  ]);
}

/**
 * Minimal PDF. `title`/`author` exist so tests can prove those user-authored
 * fields are NOT picked up by the metadata extractor.
 */
function makeSmallPdf({
  producer = 'Fixture Writer',
  pages = 1,
  title = '',
  author = '',
} = {}) {
  const sensitive = `${title ? ` /Title (${title})` : ''}${author ? ` /Author (${author})` : ''}`;
  return Buffer.from(
    '%PDF-1.7\n'
    + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    + `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count ${pages} >>\nendobj\n`
    + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n'
    + `4 0 obj\n<< /Producer (${producer}) /Creator (Fixture Creator)${sensitive} >>\nendobj\n`
    + 'trailer\n<< /Size 5 /Root 1 0 R /Info 4 0 R >>\n%%EOF\n',
    'ascii',
  );
}

function makeTextFile(body = 'Hello from the test suite.\nSecond line.\n') {
  return Buffer.from(body, 'utf8');
}

/** Windows-1255 bytes: not valid UTF-8, exercises the encoding fallback path. */
function makeNonUtf8Text() {
  return Buffer.from([0xe9, 0xec, 0xe5, 0xed, 0x20, 0xe8, 0xe5, 0xe1, 0x0a]);
}

module.exports = {
  makePng,
  makeCorruptPng,
  makeCorruptDocx,
  makeSmallPdf,
  makeTextFile,
  makeNonUtf8Text,
};
