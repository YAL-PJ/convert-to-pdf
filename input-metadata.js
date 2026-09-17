/**
 * Safe input metadata for error reports.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Crash reports from this app reach a Google Sheet as a message, a stack, a user
 * agent and a file NAME. That is not enough to reproduce a bug that only happens
 * for one particular file, because the file itself never leaves the browser --
 * and it never will: 100% client-side conversion is the product.
 *
 * So instead of the file, we ship a small, fixed set of *structural* facts about
 * it: how big it is, what type the browser thinks it is, the pixel dimensions and
 * colour depth of an image, the version / page count of a PDF. Those describe the
 * container, not its contents.
 *
 * NEVER CAPTURED HERE -- these carry real user data, and adding any of them would
 * defeat the point of a privacy-first converter:
 *   - file bytes or any hash/excerpt of them (a hash still identifies a document)
 *   - document text (TXT / CSV / MD / HTML / DOCX / XLSX body, cell values, ...)
 *   - image pixel data, thumbnails or data URLs
 *   - EXIF at all: GPS coordinates, camera owner / artist / serial, timestamps
 *   - PDF /Title, /Author, /Subject, /Keywords (user-authored document metadata)
 *   - the full file name (the caller passes a name separately as `fileName`;
 *     nothing in here embeds it in the breadcrumb)
 * Producer / Creator ARE captured for PDFs: they name the *software* that wrote
 * the file ("Microsoft Word", "Skia/PDF"), which is exactly what reproduces a
 * parser bug. They are truncated hard and never merged with the fields above.
 *
 * If you are unsure whether a new field is safe, leave it out.
 *
 * EVERYTHING HERE IS BEST-EFFORT. An error reporter that throws while reporting
 * an error is worse than no metadata, so every public entry point resolves to a
 * partial/empty result instead of rejecting, reads only bounded slices of the
 * file, and is wrapped in an overall timeout.
 */
(function attachInputMetadata(globalScope) {
  'use strict';

  // Budgets. Extraction runs on an already-broken path, so it must stay cheap.
  const HEADER_BYTES = 64 * 1024; // image/zip/PDF headers live in the first chunk
  const TRAILER_BYTES = 64 * 1024; // PDF trailer + zip end-of-central-directory
  const PDF_SCAN_LIMIT = 8 * 1024 * 1024; // above this, skip the page-count scan
  const EXTRACT_TIMEOUT_MS = 1500;
  const TEXT_FIELD_LIMIT = 80;

  // Documented for the test suite: fields that must never appear in output.
  const FORBIDDEN_FIELDS = [
    'bytes', 'data', 'dataUrl', 'content', 'text', 'preview', 'thumbnail', 'hash',
    'exif', 'gps', 'latitude', 'longitude', 'cameraOwner', 'artist', 'serialNumber',
    'title', 'author', 'subject', 'keywords',
  ];

  const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'];
  const TEXT_EXTENSIONS = ['txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'rtf', 'html', 'htm'];
  const OFFICE_EXTENSIONS = ['docx', 'xlsx'];

  function extensionOf(name) {
    const parts = String(name || '').toLowerCase().split('.');
    return parts.length > 1 ? parts.pop() : '';
  }

  function kindOf(file) {
    const extension = extensionOf(file && file.name);
    const type = String((file && file.type) || '');
    if (type.startsWith('image/') || IMAGE_EXTENSIONS.includes(extension)) return 'image';
    if (type === 'application/pdf' || extension === 'pdf') return 'pdf';
    if (OFFICE_EXTENSIONS.includes(extension)) return 'office';
    if (TEXT_EXTENSIONS.includes(extension) || type.startsWith('text/')) return 'text';
    return 'unsupported';
  }

  /** Software names only; still clamped so a hostile file cannot bloat the report. */
  function clamp(value) {
    return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim().slice(0, TEXT_FIELD_LIMIT);
  }

  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      Promise.resolve(promise).catch(() => fallback),
      new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  }

  /** Bounded read. Returns an empty view rather than throwing on any failure. */
  async function readSlice(file, start, end) {
    try {
      if (!file || typeof file.slice !== 'function') return new Uint8Array(0);
      const size = Number(file.size) || 0;
      const from = Math.max(0, Math.min(start, size));
      const to = Math.max(from, Math.min(end, size));
      const blob = file.slice(from, to);
      if (typeof blob.arrayBuffer === 'function') {
        return new Uint8Array(await blob.arrayBuffer());
      }
      return new Uint8Array(0);
    } catch (_) {
      return new Uint8Array(0);
    }
  }

  /** Latin1 view of raw bytes, used only for structural markers (%PDF-1.7, /Encrypt). */
  function asLatin1(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
    return out;
  }

  // ---------------------------------------------------------------- images

  /**
   * Pixel dimensions + colour depth straight from the format header.
   * Only the header is parsed; pixel data is never touched or decoded.
   */
  function readImageHeader(bytes, extension) {
    const out = {};
    if (!bytes.length) return out;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // PNG: 8-byte signature, then IHDR (width, height, bit depth, colour type).
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      if (bytes.byteLength >= 26) {
        out.format = 'png';
        out.width = view.getUint32(16);
        out.height = view.getUint32(20);
        const bitDepth = bytes[24];
        const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[bytes[25]] || 1;
        out.colorDepth = bitDepth * channels;
        out.hasAlpha = bytes[25] === 4 || bytes[25] === 6;
        out.indexed = bytes[25] === 3;
      }
      return out;
    }

    // JPEG: walk the marker chain to the SOFn frame header.
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      out.format = 'jpeg';
      let offset = 2;
      while (offset + 9 < bytes.byteLength) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const marker = bytes[offset + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
        const length = view.getUint16(offset + 2);
        const isFrameHeader = marker >= 0xc0 && marker <= 0xcf
          && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isFrameHeader) {
          out.precision = bytes[offset + 4];
          out.height = view.getUint16(offset + 5);
          out.width = view.getUint16(offset + 7);
          const components = bytes[offset + 9];
          out.components = components;
          out.colorDepth = out.precision * components;
          out.progressive = marker === 0xc2;
          break;
        }
        if (length <= 0) break;
        offset += 2 + length;
      }
      return out;
    }

    // GIF: logical screen descriptor; depth comes from the global colour table size.
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes.byteLength >= 13) {
      out.format = 'gif';
      out.width = view.getUint16(6, true);
      out.height = view.getUint16(8, true);
      out.colorDepth = (bytes[10] & 0x07) + 1;
      return out;
    }

    // BMP: DIB header carries dimensions and bits-per-pixel.
    if (bytes[0] === 0x42 && bytes[1] === 0x4d && bytes.byteLength >= 30) {
      out.format = 'bmp';
      out.width = Math.abs(view.getInt32(18, true));
      out.height = Math.abs(view.getInt32(22, true));
      out.colorDepth = view.getUint16(28, true);
      return out;
    }

    // WEBP (RIFF container): VP8/VP8L/VP8X dimension fields.
    if (bytes.byteLength >= 30 && asLatin1(bytes.subarray(0, 4)) === 'RIFF' && asLatin1(bytes.subarray(8, 12)) === 'WEBP') {
      out.format = 'webp';
      const chunk = asLatin1(bytes.subarray(12, 16));
      if (chunk === 'VP8X') {
        out.width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        out.height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      } else if (chunk === 'VP8 ') {
        out.width = view.getUint16(26, true) & 0x3fff;
        out.height = view.getUint16(28, true) & 0x3fff;
      } else if (chunk === 'VP8L') {
        const bits = view.getUint32(21, true);
        out.width = (bits & 0x3fff) + 1;
        out.height = ((bits >> 14) & 0x3fff) + 1;
      }
      return out;
    }

    // SVG is markup, not raster. Record only that it looks like SVG at all --
    // reading width/height attributes would mean parsing user content.
    if (extension === 'svg' || /<svg[\s>]/i.test(asLatin1(bytes.subarray(0, 512)))) {
      out.format = 'svg';
      out.vector = true;
      return out;
    }

    out.format = 'unrecognized';
    return out;
  }

  // ------------------------------------------------------------------- pdf

  /**
   * PDF structure only. Deliberately reads /Producer and /Creator (software
   * names) and deliberately does NOT read /Title, /Author, /Subject, /Keywords.
   */
  function readPdfStructure(headBytes, tailBytes, fileSize) {
    const out = {};
    const head = asLatin1(headBytes.subarray(0, 4096));
    const tail = asLatin1(tailBytes);
    const version = head.match(/%PDF-(\d+\.\d+)/);
    if (version) out.pdfVersion = version[1];
    out.isEncrypted = /\/Encrypt[\s\d<]/.test(tail);
    out.linearized = /\/Linearized/.test(head);

    const producer = tail.match(/\/Producer\s*\(([^)]{0,120})\)/) || head.match(/\/Producer\s*\(([^)]{0,120})\)/);
    if (producer) out.producer = clamp(producer[1]);
    const creator = tail.match(/\/Creator\s*\(([^)]{0,120})\)/) || head.match(/\/Creator\s*\(([^)]{0,120})\)/);
    if (creator) out.creator = clamp(creator[1]);

    const count = tail.match(/\/Type\s*\/Pages[^>]{0,200}?\/Count\s+(\d+)/);
    if (count) out.pageCount = Number(count[1]);
    if (fileSize > PDF_SCAN_LIMIT) out.pageCountScan = 'skipped-large-file';
    return out;
  }

  function scanPdfPageCount(bytes) {
    const matches = asLatin1(bytes).match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : undefined;
  }

  // ------------------------------------------------------- text and office

  /** Byte-level encoding facts. No decoded text is ever kept. */
  function readTextShape(bytes) {
    const out = {};
    if (!bytes.length) return out;
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) out.bom = 'utf-8';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) out.bom = 'utf-16be';
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) out.bom = 'utf-16le';
    else out.bom = 'none';
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      out.utf8Valid = true;
    } catch (_) {
      // Only the yes/no answer is kept -- this is the branch that sends the app
      // into its legacy-encoding fallback, so it is the interesting bit.
      out.utf8Valid = false;
    }
    return out;
  }

  /** Is the container even a readable ZIP? DOCX/XLSX crashes are usually this. */
  function readZipShape(headBytes, tailBytes) {
    const out = {};
    out.zipSignature = headBytes.length >= 4
      && headBytes[0] === 0x50 && headBytes[1] === 0x4b
      && (headBytes[2] === 0x03 || headBytes[2] === 0x05 || headBytes[2] === 0x07);
    const tail = asLatin1(tailBytes);
    out.hasEndOfCentralDirectory = tail.includes('PK');
    return out;
  }

  // ------------------------------------------------------------ public API

  /**
   * Describe one input. Resolves to a plain object of safe scalars, always --
   * malformed input, a missing API or a slow disk all end up as a partial
   * result, never a throw.
   */
  function describeFile(file) {
    return withTimeout(describeFileInner(file), EXTRACT_TIMEOUT_MS, { extractError: 'timeout' });
  }

  async function describeFileInner(file) {
    const meta = {};
    try {
      if (!file) return { extractError: 'no-file' };
      meta.kind = kindOf(file);
      meta.extension = extensionOf(file.name);
      meta.mimeType = clamp(file.type) || 'unknown';
      meta.fileSize = Number(file.size) || 0;
      if (typeof file.lastModified === 'number') {
        // Only whether a timestamp exists; the value itself is user-identifying.
        meta.hasLastModified = true;
      }

      if (meta.fileSize === 0) {
        meta.empty = true;
        return meta;
      }

      const head = await readSlice(file, 0, HEADER_BYTES);
      if (meta.kind === 'image') {
        Object.assign(meta, readImageHeader(head, meta.extension));
      } else if (meta.kind === 'pdf') {
        const tail = await readSlice(file, Math.max(0, meta.fileSize - TRAILER_BYTES), meta.fileSize);
        Object.assign(meta, readPdfStructure(head, tail, meta.fileSize));
        if (meta.pageCount === undefined && meta.fileSize <= PDF_SCAN_LIMIT) {
          const whole = await readSlice(file, 0, meta.fileSize);
          const scanned = scanPdfPageCount(whole);
          if (scanned !== undefined) meta.pageCount = scanned;
        }
      } else if (meta.kind === 'office') {
        const tail = await readSlice(file, Math.max(0, meta.fileSize - TRAILER_BYTES), meta.fileSize);
        Object.assign(meta, readZipShape(head, tail));
      } else {
        Object.assign(meta, readTextShape(head));
      }
    } catch (error) {
      meta.extractError = clamp((error && error.name) || 'extract-failed');
    }
    return meta;
  }

  /** `k=v;k=v` breadcrumb, matching the convention used by the sibling apps. */
  function buildBreadcrumb(fields) {
    try {
      return Object.keys(fields || {})
        .filter((key) => fields[key] !== undefined && fields[key] !== null && fields[key] !== '')
        .map((key) => `${key}=${String(fields[key]).replace(/[;=\r\n]+/g, ' ').trim()}`)
        .join(';')
        .slice(0, 1000);
    } catch (_) {
      return '';
    }
  }

  /** Per-file tail of a breadcrumb: the shape facts worth reading in a sheet. */
  function describeForBreadcrumb(meta) {
    const m = meta || {};
    const fields = {
      kind: m.kind,
      mime: m.mimeType,
      size: m.fileSize,
      format: m.format,
      dims: m.width && m.height ? `${m.width}x${m.height}` : undefined,
      depth: m.colorDepth,
      alpha: m.hasAlpha === undefined ? undefined : String(m.hasAlpha),
      progressive: m.progressive === undefined ? undefined : String(m.progressive),
      pdfVersion: m.pdfVersion,
      pages: m.pageCount,
      encrypted: m.isEncrypted === undefined ? undefined : String(m.isEncrypted),
      producer: m.producer,
      creator: m.creator,
      bom: m.bom,
      utf8: m.utf8Valid === undefined ? undefined : String(m.utf8Valid),
      zip: m.zipSignature === undefined ? undefined : String(m.zipSignature),
      eocd: m.hasEndOfCentralDirectory === undefined ? undefined : String(m.hasEndOfCentralDirectory),
      empty: m.empty ? 'true' : undefined,
      extractError: m.extractError,
    };
    return buildBreadcrumb(fields);
  }

  /**
   * Full `userNote` for an error report: the context breadcrumb first, then the
   * shape of the file that failed. Never rejects.
   */
  async function buildUserNote(context, file) {
    try {
      const ctx = context || {};
      const head = buildBreadcrumb({
        mode: ctx.mode,
        step: ctx.step,
        files: ctx.files,
        kind: ctx.kind,
        totalBytes: ctx.totalBytes,
        pageSize: ctx.pageSize,
        margin: ctx.margin,
        fillPage: ctx.fillPage === undefined ? undefined : String(ctx.fillPage),
      });
      if (!file) return head;
      const tail = describeForBreadcrumb(await describeFile(file));
      return [head, tail].filter(Boolean).join(';').slice(0, 1000);
    } catch (_) {
      return '';
    }
  }

  globalScope.InputMetadata = {
    FORBIDDEN_FIELDS,
    describeFile,
    describeForBreadcrumb,
    buildBreadcrumb,
    buildUserNote,
    kindOf,
  };
}(typeof globalThis !== 'undefined' ? globalThis : window));
