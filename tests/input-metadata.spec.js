/**
 * The privacy boundary, under test. These assertions are the point of the
 * feature: safe structural fields in, user data out.
 */
const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers');
const { makePng, makeSmallPdf, makeTextFile, makeNonUtf8Text } = require('./fixtures');

const FORBIDDEN_SUBSTRINGS = [
  'title', 'author', 'subject', 'keywords', 'exif', 'gps', 'pixel',
  'dataurl', 'bytes', 'hash', 'thumbnail', 'content',
];

/** Run InputMetadata.describeFile in the page against a generated file. */
async function describe(page, buffer, name, type) {
  return page.evaluate(async ({ b64, name: fileName, type: mimeType }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], fileName, { type: mimeType });
    const meta = await window.InputMetadata.describeFile(file);
    return { meta, note: window.InputMetadata.describeForBreadcrumb(meta) };
  }, { b64: buffer.toString('base64'), name, type });
}

function expectNoForbiddenKeys(meta) {
  const keys = Object.keys(meta).map((k) => k.toLowerCase());
  for (const banned of FORBIDDEN_SUBSTRINGS) {
    expect(keys.filter((k) => k.includes(banned)), `field containing "${banned}"`).toEqual([]);
  }
}

test('image metadata: safe shape fields only', async ({ page }) => {
  await openApp(page);
  const { meta, note } = await describe(page, makePng(24, 16), 'holiday.png', 'image/png');

  expect(meta).toMatchObject({
    kind: 'image',
    mimeType: 'image/png',
    format: 'png',
    width: 24,
    height: 16,
    colorDepth: 24,
    hasAlpha: false,
  });
  expect(meta.fileSize).toBeGreaterThan(0);
  expectNoForbiddenKeys(meta);
  expect(note).toContain('dims=24x16');
  expect(note).toContain('depth=24');
  expect(note).toContain('mime=image/png');
  // The file name is reported separately as `fileName`; it is not in the note.
  expect(note).not.toContain('holiday');
});

test('PDF metadata: version/pages/encryption/producer, never Title or Author', async ({ page }) => {
  await openApp(page);
  const pdf = makeSmallPdf({ producer: 'Acme PDF 3.1', title: 'TOP-SECRET-TITLE', author: 'Jane Q Public' });
  const { meta, note } = await describe(page, pdf, 'statement.pdf', 'application/pdf');

  expect(meta).toMatchObject({
    kind: 'pdf',
    pdfVersion: '1.7',
    pageCount: 1,
    isEncrypted: false,
    producer: 'Acme PDF 3.1',
    creator: 'Fixture Creator',
  });
  expectNoForbiddenKeys(meta);

  const serialized = JSON.stringify(meta) + note;
  expect(serialized).not.toContain('TOP-SECRET-TITLE');
  expect(serialized).not.toContain('Jane Q Public');
  expect(note).toContain('pdfVersion=1.7');
  expect(note).toContain('pages=1');
});

test('text metadata: encoding shape only, never document text', async ({ page }) => {
  await openApp(page);
  const secret = 'BANK-ACCOUNT-0042-DO-NOT-LEAK';
  const { meta, note } = await describe(page, makeTextFile(`${secret}\n`), 'private.txt', 'text/plain');

  expect(meta).toMatchObject({ kind: 'text', bom: 'none', utf8Valid: true });
  expectNoForbiddenKeys(meta);
  expect(JSON.stringify(meta) + note).not.toContain('BANK-ACCOUNT');

  const legacy = await describe(page, makeNonUtf8Text(), 'hebrew.csv', 'text/csv');
  expect(legacy.meta.utf8Valid).toBe(false);
  expect(legacy.note).toContain('utf8=false');
});

test('office metadata: container health only', async ({ page }) => {
  await openApp(page);
  const { meta, note } = await describe(
    page,
    Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('junk')]),
    'report.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );

  expect(meta).toMatchObject({ kind: 'office', zipSignature: true, hasEndOfCentralDirectory: false });
  expectNoForbiddenKeys(meta);
  expect(note).toContain('zip=true');
});

test('extraction never throws, whatever it is handed', async ({ page }) => {
  await openApp(page);
  const results = await page.evaluate(async () => {
    const fake = { name: 'weird.png', type: 'image/png', size: 999 }; // no slice()
    const empty = new File([], 'empty.png', { type: 'image/png' });
    const hostile = {
      name: 'hostile.png',
      get type() { throw new Error('boom'); },
      get size() { throw new Error('boom'); },
      slice() { throw new Error('boom'); },
    };
    const out = [];
    for (const input of [null, undefined, {}, fake, empty, hostile]) {
      try {
        out.push({ ok: true, meta: await window.InputMetadata.describeFile(input) });
      } catch (error) {
        out.push({ ok: false, error: String(error && error.message) });
      }
    }
    // And the breadcrumb builder on garbage input.
    out.push({ ok: true, note: window.InputMetadata.describeForBreadcrumb(undefined) });
    return out;
  });

  expect(results.every((r) => r.ok)).toBe(true);
  expect(results[results.length - 1].note).toBe('');
});

test('the error payload carries the breadcrumb and nothing user-identifying', async ({ page }) => {
  await openApp(page);
  const payload = await page.evaluate(async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'thing.png', { type: 'image/png' });
    const userNote = await window.InputMetadata.buildUserNote(
      { mode: 'single', step: 'convert', files: 1, kind: 'image', totalBytes: 3 },
      file,
    );
    return window.buildErrorPayload(new Error('canvas blew up'), {
      feature: 'convert',
      code: 'build-pdf-failed',
      fileName: file.name,
      userNote,
    });
  });

  expect(Object.keys(payload).sort()).toEqual([
    'action', 'app', 'code', 'feature', 'fileName', 'message',
    'sessionId', 'stack', 'url', 'userAgent', 'userNote',
  ]);
  expect(payload.userNote).toContain('mode=single');
  expect(payload.userNote).toContain('step=convert');
  expect(payload.userNote).toContain('totalBytes=3');
  expect(payload.sessionId).not.toBe('');
  expectNoForbiddenKeys(payload);
});
