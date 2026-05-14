const state = {
  images: [],
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


function setStatus(message, tone = 'neutral') {
  elements.status.textContent = message;
  elements.status.classList.toggle('is-good', tone === 'good');
  elements.status.classList.toggle('is-error', tone === 'error');
}

function sanitizeFileName(name) {
  const clean = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.pdf$/i, '');
  return `${clean || 'converted-images'}.pdf`;
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

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      reject(new Error(`${file.name} is not a JPG or PNG image.`));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error(`Could not decode ${file.name}.`));
      image.onload = () => {
        normalizeImage(image).then((normalized) => {
          resolve({
            id: makeId(),
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

async function addFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  setStatus(`Adding ${files.length} image${files.length === 1 ? '' : 's'}…`);
  const results = await Promise.allSettled(files.map(readImage));
  const accepted = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  const rejected = results.filter((result) => result.status === 'rejected');

  state.images.push(...accepted);
  renderQueue();

  if (accepted.length && !rejected.length) {
    setStatus(`${accepted.length} image${accepted.length === 1 ? '' : 's'} ready.`, 'good');
  } else if (accepted.length) {
    setStatus(`${accepted.length} added. ${rejected.length} skipped because they were not valid JPG/PNG images.`, 'error');
  } else {
    setStatus(rejected[0]?.reason?.message || 'No valid images found.', 'error');
  }
}

function renderQueue() {
  elements.queue.replaceChildren();
  state.images.forEach((item, index) => {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    const thumbnail = card.querySelector('img');
    const title = card.querySelector('strong');
    const details = card.querySelector('span');
    const upButton = card.querySelector('[data-action="up"]');
    const downButton = card.querySelector('[data-action="down"]');

    card.dataset.id = item.id;
    thumbnail.src = item.dataUrl;
    thumbnail.alt = `Preview of ${item.name}`;
    title.textContent = `${index + 1}. ${item.name}`;
    details.textContent = `${item.width}×${item.height}px · ${formatBytes(item.size)}`;
    upButton.disabled = index === 0;
    downButton.disabled = index === state.images.length - 1;
    elements.queue.append(card);
  });

  const hasImages = state.images.length > 0;
  elements.convertButton.disabled = !hasImages;
  elements.clearButton.disabled = !hasImages;
  elements.queueHelp.classList.toggle('is-hidden', hasImages);
  if (!hasImages) setStatus('Add images to begin.');
}

function moveImage(id, direction) {
  const index = state.images.findIndex((item) => item.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.images.length) return;
  [state.images[index], state.images[nextIndex]] = [state.images[nextIndex], state.images[index]];
  renderQueue();
}

function removeImage(id) {
  state.images = state.images.filter((item) => item.id !== id);
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

function buildPdf(images) {
  const objects = [];
  const pages = [];
  const addObject = (content) => {
    objects.push(content);
    return objects.length;
  };

  const catalogId = addObject('');
  const pagesId = addObject('');
  const infoId = addObject(`<< /Producer (Local PDF Maker) /Title (${pdfEscape(elements.pdfName.value)}) >>`);

  images.forEach((image) => {
    const page = calculatePage(image);
    const placement = calculatePlacement(image, page);
    const imageObjectId = addObject('');
    const contentId = addObject('');
    const pageId = addObject('');
    const imageHeader = `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`;
    objects[imageObjectId - 1] = makeStream(imageHeader, image.bytes);

    const clip = placement.clip ? `${placement.clip.x.toFixed(3)} ${placement.clip.y.toFixed(3)} ${placement.clip.width.toFixed(3)} ${placement.clip.height.toFixed(3)} re W n\n` : '';
    const content = `q\n${clip}${placement.width.toFixed(3)} 0 0 ${placement.height.toFixed(3)} ${placement.x.toFixed(3)} ${(page.height - placement.y - placement.height).toFixed(3)} cm\n/Im${imageObjectId} Do\nQ`;
    objects[contentId - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width.toFixed(3)} ${page.height.toFixed(3)}] /Resources << /XObject << /Im${imageObjectId} ${imageObjectId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    pages.push(pageId);
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
  if (!state.images.length) return;
  elements.convertButton.disabled = true;
  setStatus('Building your PDF locally…');

  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const blob = buildPdf(state.images);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = sanitizeFileName(elements.pdfName.value);
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Done — ${state.images.length} page PDF downloaded.`, 'good');
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
  const card = event.target.closest('.image-card');
  if (!button || !card) return;
  const { action } = button.dataset;
  if (action === 'up') moveImage(card.dataset.id, -1);
  if (action === 'down') moveImage(card.dataset.id, 1);
  if (action === 'remove') removeImage(card.dataset.id);
});

elements.clearButton.addEventListener('click', () => {
  state.images = [];
  renderQueue();
});
elements.convertButton.addEventListener('click', convert);
renderQueue();
