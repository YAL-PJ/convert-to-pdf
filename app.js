const state = {
  items: [],
  dragDepth: 0,
};

const elements = {
  dropzone: document.querySelector('#dropzone'),
  fileInput: document.querySelector('#file-input'),
  browseButton: document.querySelector('#browse-button'),
  queue: document.querySelector('#queue'),
  queueHelp: document.querySelector('#queue-help'),
  clearButton: document.querySelector('#clear-button'),
  convertButton: document.querySelector('#convert-button'),
  status: document.querySelector('#status'),
  pdfName: document.querySelector('#pdf-name'),
  pageSize: document.querySelector('#page-size'),
  marginSize: document.querySelector('#margin-size'),
  fillPage: document.querySelector('#fill-page'),
  template: document.querySelector('#image-card-template'),
};

const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'];
const TEXT_EXTENSIONS = ['txt', 'text', 'md', 'markdown', 'csv', 'tsv', 'rtf', 'html', 'htm'];
const OFFICE_EXTENSIONS = ['docx', 'xlsx'];
const SUPPORTED_EXTENSIONS = [...TEXT_EXTENSIONS, ...OFFICE_EXTENSIONS, ...IMAGE_EXTENSIONS];
const TEXT_PAGE_SIZE = 'letter';
const TEXT_FONT_SIZE = 11;
const TEXT_LINE_HEIGHT = 15;
const TEXT_MIN_MARGIN = 42;

function setStatus(message, tone = 'neutral') {
  elements.status.textContent = message;
  elements.status.classList.toggle('is-good', tone === 'good');
  elements.status.classList.toggle('is-error', tone === 'error');
}

function sanitizeFileName(name) {
  const clean = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.pdf$/i, '');
  return `${clean || 'converted-files'}.pdf`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function extensionFor(file) {
  return file.name.split('.').pop()?.toLowerCase() || '';
}

function describeSupportedFormats() {
  return SUPPORTED_EXTENSIONS.map((extension) => extension.toUpperCase()).join(', ');
}

function isSupportedFile(file) {
  return file.type.startsWith('image/') || SUPPORTED_EXTENSIONS.includes(extensionFor(file));
}

async function readFile(file) {
  if (!isSupportedFile(file)) {
    throw new Error(`${file.name} is not a supported file. Try ${describeSupportedFormats()}.`);
  }

  if (file.type.startsWith('image/') || IMAGE_EXTENSIONS.includes(extensionFor(file))) {
    return readImage(file);
  }

  if (OFFICE_EXTENSIONS.includes(extensionFor(file))) {
    return readOfficeDocument(file);
  }

  return readTextDocument(file);
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(`Could not decode ${file.name}.`));
      image.onload = () => {
        normalizeImage(image).then((normalized) => {
          resolve({
            id: makeId(),
            kind: 'image',
            file,
            name: file.name,
            type: normalized.type,
            size: file.size,
            width: image.naturalWidth,
            height: image.naturalHeight,
            dataUrl: reader.result,
            bytes: normalized.bytes,
          });
        }).catch(() => reject(new Error(`Could not prepare ${file.name} for PDF export.`)));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function normalizeImage(image) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      reject(new Error('Canvas is unavailable.'));
      return;
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not encode image.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read encoded image.'));
      reader.onload = () => resolve({ type: 'image/jpeg', bytes: new Uint8Array(reader.result) });
      reader.readAsArrayBuffer(blob);
    }, 'image/jpeg', 0.92);
  });
}

async function readTextDocument(file) {
  const extension = extensionFor(file);
  const text = await file.text();
  const normalized = extension === 'html' || extension === 'htm' ? htmlToText(text) : text;
  return makeTextItem(file, normalized, extension.toUpperCase() || 'TEXT');
}

function htmlToText(markup) {
  const document = new DOMParser().parseFromString(markup, 'text/html');
  document.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
  return document.body?.innerText || document.documentElement.textContent || '';
}

function makeTextItem(file, text, label) {
  const cleaned = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').trim();
  return {
    id: makeId(),
    kind: 'text',
    file,
    name: file.name,
    size: file.size,
    text: cleaned || '(No readable text found.)',
    sourceLabel: label,
  };
}

async function readOfficeDocument(file) {
  const entries = await unzipEntries(await file.arrayBuffer());
  const extension = extensionFor(file);
  if (extension === 'docx') {
    return makeTextItem(file, docxToText(entries), 'DOCX');
  }
  return makeTextItem(file, xlsxToText(entries), 'XLSX');
}

async function unzipEntries(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map();
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decodeUtf8(bytes.slice(offset + 46, offset + 46 + fileNameLength));
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);

    if (!name.endsWith('/')) {
      entries.set(name, decodeUtf8(await decompressZipEntry(compressed, compression)));
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(view) {
  const minimumOffset = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error('Could not read this Office file.');
}

async function decompressZipEntry(bytes, compression) {
  if (compression === 0) return bytes;
  if (compression !== 8 || !('DecompressionStream' in globalThis)) {
    throw new Error('This browser cannot unpack compressed Office files. Try saving as TXT, CSV, or HTML.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeUtf8(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

function xmlToDocument(xml) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function textFromXmlNode(node) {
  return (node.textContent || '').trim();
}

function docxToText(entries) {
  const xml = entries.get('word/document.xml');
  if (!xml) throw new Error('Could not find readable DOCX content.');
  const doc = xmlToDocument(xml);
  return [...doc.getElementsByTagName('w:p')].map((paragraph) => (
    [...paragraph.getElementsByTagName('w:t')].map(textFromXmlNode).join('')
  )).filter(Boolean).join('\n\n');
}

function xlsxToText(entries) {
  const sharedStrings = readSharedStrings(entries.get('xl/sharedStrings.xml'));
  const sheetNames = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!sheetNames.length) throw new Error('Could not find readable XLSX sheets.');

  return sheetNames.map((name, index) => {
    const doc = xmlToDocument(entries.get(name));
    const rows = [...doc.getElementsByTagName('row')].map((row) => (
      [...row.getElementsByTagName('c')].map((cell) => readCellValue(cell, sharedStrings)).join('    ').trimEnd()
    )).filter(Boolean);
    return `Sheet ${index + 1}\n${rows.join('\n')}`;
  }).join('\n\n');
}

function readSharedStrings(xml) {
  if (!xml) return [];
  const doc = xmlToDocument(xml);
  return [...doc.getElementsByTagName('si')].map((item) => (
    [...item.getElementsByTagName('t')].map(textFromXmlNode).join('')
  ));
}

function readCellValue(cell, sharedStrings) {
  const type = cell.getAttribute('t');
  if (type === 'inlineStr') return [...cell.getElementsByTagName('t')].map(textFromXmlNode).join('');
  const value = cell.getElementsByTagName('v')[0]?.textContent || '';
  if (type === 's') return sharedStrings[Number(value)] || '';
  return value;
}

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  setStatus(`Adding ${files.length} file${files.length === 1 ? '' : 's'}…`);
  const results = await Promise.allSettled(files.map(readFile));
  const accepted = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  const rejected = results.filter((result) => result.status === 'rejected');

  state.items.push(...accepted);
  renderQueue();

  if (accepted.length && !rejected.length) {
    setStatus(`${accepted.length} file${accepted.length === 1 ? '' : 's'} ready.`, 'good');
  } else if (accepted.length) {
    setStatus(`${accepted.length} added. ${rejected.length} skipped because they are not simple supported conversions.`, 'error');
  } else {
    setStatus(rejected[0]?.reason?.message || 'No supported files found.', 'error');
  }
}

function renderQueue() {
  elements.queue.replaceChildren();
  state.items.forEach((item, index) => {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    const thumbnail = card.querySelector('.file-card__preview');
    const title = card.querySelector('strong');
    const details = card.querySelector('span');
    const upButton = card.querySelector('[data-action="up"]');
    const downButton = card.querySelector('[data-action="down"]');

    card.dataset.id = item.id;
    if (item.kind === 'image') {
      const image = document.createElement('img');
      image.src = item.dataUrl;
      image.alt = `Preview of ${item.name}`;
      thumbnail.replaceChildren(image);
      details.textContent = `Image · ${item.width}×${item.height}px · ${formatBytes(item.size)}`;
    } else {
      thumbnail.textContent = item.sourceLabel;
      details.textContent = `${item.sourceLabel} document · ${formatBytes(item.size)}`;
    }
    title.textContent = `${index + 1}. ${item.name}`;
    upButton.disabled = index === 0;
    downButton.disabled = index === state.items.length - 1;
    elements.queue.append(card);
  });

  const hasItems = state.items.length > 0;
  elements.convertButton.disabled = !hasItems;
  elements.clearButton.disabled = !hasItems;
  elements.queueHelp.classList.toggle('is-hidden', hasItems);
  if (!hasItems) setStatus('Add files to begin.');
}

function moveItem(id, direction) {
  const index = state.items.findIndex((item) => item.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.items.length) return;
  [state.items[index], state.items[nextIndex]] = [state.items[nextIndex], state.items[index]];
  renderQueue();
}

function removeItem(id) {
  state.items = state.items.filter((item) => item.id !== id);
  renderQueue();
}

function calculatePage(image) {
  const selected = elements.pageSize.value;
  const margin = Number(elements.marginSize.value);
  if (selected === 'fit') {
    return {
      width: Math.max(1, image.width * 72 / 96 + margin * 2),
      height: Math.max(1, image.height * 72 / 96 + margin * 2),
    };
  }
  return PAGE_SIZES[selected];
}

function calculateTextPage() {
  return PAGE_SIZES[elements.pageSize.value] || PAGE_SIZES[TEXT_PAGE_SIZE];
}

function calculatePlacement(image, page) {
  const margin = Number(elements.marginSize.value);
  const box = {
    width: Math.max(1, page.width - margin * 2),
    height: Math.max(1, page.height - margin * 2),
  };
  const imageRatio = image.width / image.height;
  const boxRatio = box.width / box.height;
  const shouldCover = elements.fillPage.checked && elements.pageSize.value !== 'fit';
  const useWidth = shouldCover ? imageRatio < boxRatio : imageRatio > boxRatio;
  const width = useWidth ? box.width : box.height * imageRatio;
  const height = useWidth ? box.width / imageRatio : box.height;

  return {
    width,
    height,
    x: margin + (box.width - width) / 2,
    y: margin + (box.height - height) / 2,
    clip: shouldCover ? { x: margin, y: margin, width: box.width, height: box.height } : null,
  };
}

function pdfEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function pdfSafeText(value) {
  return pdfEscape(String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\uFFFF]/g, '?'));
}

function asciiBytes(text) {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

function makeStream(header, bytes, footer = '\nendstream') {
  return concatBytes([asciiBytes(header), bytes, asciiBytes(footer)]);
}

function wrapText(text, maxCharacters) {
  const lines = [];
  text.split('\n').forEach((rawLine) => {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      return;
    }

    let line = '';
    words.forEach((word) => {
      if (word.length > maxCharacters) {
        if (line) lines.push(line);
        for (let index = 0; index < word.length; index += maxCharacters) {
          lines.push(word.slice(index, index + maxCharacters));
        }
        line = '';
        return;
      }

      const nextLine = line ? `${line} ${word}` : word;
      if (nextLine.length > maxCharacters) {
        lines.push(line);
        line = word;
      } else {
        line = nextLine;
      }
    });
    if (line) lines.push(line);
  });
  return lines;
}

function paginateTextItem(item, page) {
  const margin = Math.max(TEXT_MIN_MARGIN, Number(elements.marginSize.value));
  const maxCharacters = Math.max(28, Math.floor((page.width - margin * 2) / (TEXT_FONT_SIZE * 0.55)));
  const bodyLines = wrapText(item.text, maxCharacters);
  const headerLines = wrapText(item.name, maxCharacters);
  const usableHeight = page.height - margin * 2 - TEXT_LINE_HEIGHT * 2;
  const linesPerPage = Math.max(1, Math.floor(usableHeight / TEXT_LINE_HEIGHT));
  const pages = [];

  for (let index = 0; index < bodyLines.length; index += linesPerPage) {
    pages.push({
      title: headerLines[0] || item.name,
      lines: bodyLines.slice(index, index + linesPerPage),
      margin,
    });
  }

  return pages.length ? pages : [{ title: item.name, lines: [''], margin }];
}

function buildTextContent(textPage, page, pageIndex, pageCount) {
  const startY = page.height - textPage.margin;
  const header = `${textPage.title}${pageCount > 1 ? ` (${pageIndex + 1}/${pageCount})` : ''}`;
  const lines = [
    'BT',
    `/F1 13 Tf 15 TL ${textPage.margin.toFixed(3)} ${startY.toFixed(3)} Td`,
    `(${pdfSafeText(header)}) Tj`,
    `0 -${(TEXT_LINE_HEIGHT * 1.5).toFixed(3)} Td`,
    `/F1 ${TEXT_FONT_SIZE} Tf ${TEXT_LINE_HEIGHT} TL`,
    ...textPage.lines.map((line) => `(${pdfSafeText(line)}) Tj T*`),
    'ET',
  ];
  return lines.join('\n');
}

function buildPdf(items) {
  const objects = [];
  const pages = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const catalogId = addObject('');
  const pagesId = addObject('');
  const infoId = addObject(`<< /Producer (Local PDF Maker) /Title (${pdfEscape(elements.pdfName.value)}) >>`);
  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  items.forEach((item) => {
    if (item.kind === 'image') {
      const page = calculatePage(item);
      const placement = calculatePlacement(item, page);
      const imageObjectId = addObject('');
      const contentId = addObject('');
      const pageId = addObject('');
      const imageHeader = `<< /Type /XObject /Subtype /Image /Width ${item.width} /Height ${item.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${item.bytes.length} >>\nstream\n`;
      objects[imageObjectId - 1] = makeStream(imageHeader, item.bytes);

      const clip = placement.clip ? `${placement.clip.x.toFixed(3)} ${placement.clip.y.toFixed(3)} ${placement.clip.width.toFixed(3)} ${placement.clip.height.toFixed(3)} re W n\n` : '';
      const content = `q\n${clip}${placement.width.toFixed(3)} 0 0 ${placement.height.toFixed(3)} ${placement.x.toFixed(3)} ${(page.height - placement.y - placement.height).toFixed(3)} cm\n/Im${imageObjectId} Do\nQ`;
      objects[contentId - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
      objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width.toFixed(3)} ${page.height.toFixed(3)}] /Resources << /XObject << /Im${imageObjectId} ${imageObjectId} 0 R >> >> /Contents ${contentId} 0 R >>`;
      pages.push(pageId);
      return;
    }

    const page = calculateTextPage();
    const textPages = paginateTextItem(item, page);
    textPages.forEach((textPage, index) => {
      const content = buildTextContent(textPage, page, index, textPages.length);
      const contentId = addObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width.toFixed(3)} ${page.height.toFixed(3)}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pages.push(pageId);
    });
  });

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pages.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;

  const chunks = [asciiBytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  const offsets = [0];
  let position = chunks[0].length;

  objects.forEach((object, index) => {
    offsets.push(position);
    const objectBytes = object instanceof Uint8Array ? object : asciiBytes(object);
    const chunk = concatBytes([asciiBytes(`${index + 1} 0 obj\n`), objectBytes, asciiBytes('\nendobj\n')]);
    chunks.push(chunk);
    position += chunk.length;
  });

  const xrefOffset = position;
  const xrefRows = offsets.map((offset, index) => (
    index === 0 ? '0000000000 65535 f ' : `${String(offset).padStart(10, '0')} 00000 n `
  ));
  const trailer = `xref\n0 ${offsets.length}\n${xrefRows.join('\n')}\ntrailer\n<< /Size ${offsets.length} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(asciiBytes(trailer));

  return new Blob(chunks, { type: 'application/pdf' });
}

async function convert() {
  if (!state.items.length) return;
  elements.convertButton.disabled = true;
  setStatus('Building your PDF locally…');

  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const blob = buildPdf(state.items);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = sanitizeFileName(elements.pdfName.value);
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Done — ${state.items.length} file${state.items.length === 1 ? '' : 's'} converted to PDF.`, 'good');
  } catch (error) {
    setStatus(error.message || 'Something went wrong while making the PDF.', 'error');
  } finally {
    elements.convertButton.disabled = false;
  }
}

elements.browseButton.addEventListener('click', () => elements.fileInput.click());
elements.fileInput.addEventListener('change', (event) => {
  addFiles(event.target.files);
  event.target.value = '';
});

elements.dropzone.addEventListener('dragenter', (event) => {
  event.preventDefault();
  state.dragDepth += 1;
  elements.dropzone.classList.add('is-dragging');
});

elements.dropzone.addEventListener('dragover', (event) => event.preventDefault());
elements.dropzone.addEventListener('dragleave', () => {
  state.dragDepth -= 1;
  if (state.dragDepth <= 0) {
    state.dragDepth = 0;
    elements.dropzone.classList.remove('is-dragging');
  }
});
elements.dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  state.dragDepth = 0;
  elements.dropzone.classList.remove('is-dragging');
  addFiles(event.dataTransfer.files);
});

elements.queue.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  const card = event.target.closest('.file-card');
  if (!button || !card) return;
  const { action } = button.dataset;
  if (action === 'up') moveItem(card.dataset.id, -1);
  if (action === 'down') moveItem(card.dataset.id, 1);
  if (action === 'remove') removeItem(card.dataset.id);
});

elements.clearButton.addEventListener('click', () => {
  state.items = [];
  renderQueue();
});
elements.convertButton.addEventListener('click', convert);
renderQueue();
