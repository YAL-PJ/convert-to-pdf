const { test, expect } = require('@playwright/test');
const { openApp, addFiles, convertAndGetPdf, statusText } = require('./helpers');
const { makePng, makeCorruptDocx, makeCorruptPng } = require('./fixtures');

test('a corrupt DOCX is rejected with a readable message, not a crash', async ({ page }) => {
  const { pageErrors, errorReports } = await openApp(page);

  await addFiles(page, [{
    name: 'broken.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: makeCorruptDocx(),
  }]);

  await expect(statusText(page)).toHaveClass(/is-error/);
  await expect(statusText(page)).not.toHaveText('');
  await expect(page.locator('.file-card')).toHaveCount(0);
  await expect(page.locator('#convert-button')).toBeDisabled();
  expect(pageErrors).toEqual([]);

  // The failure is reported with a safe breadcrumb describing the input's shape.
  await expect.poll(() => errorReports.length, { timeout: 5000 }).toBeGreaterThan(0);
  const report = errorReports.find((r) => r.action === 'error_report');
  expect(report.feature).toBe('add-files');
  expect(report.fileName).toBe('broken.docx');
  expect(report.userNote).toContain('step=read');
  expect(report.userNote).toContain('kind=office');
  expect(report.userNote).toContain('eocd=false');
});

test('an unsupported file type is skipped and the app stays usable', async ({ page }) => {
  const { pageErrors } = await openApp(page);

  await addFiles(page, [{ name: 'archive.tar.gz', mimeType: 'application/gzip', buffer: Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00]) }]);

  await expect(statusText(page)).toContainText('not a supported file');
  await expect(page.locator('#convert-button')).toBeDisabled();

  // Not hung: a good file added afterwards still converts.
  await addFiles(page, [{ name: 'ok.png', mimeType: 'image/png', buffer: makePng() }]);
  await expect(page.locator('#convert-button')).toBeEnabled();
  const pdf = await convertAndGetPdf(page);
  expect(pdf.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(pageErrors).toEqual([]);
});

test('a PNG with a valid header but garbage pixels fails gracefully', async ({ page }) => {
  const { pageErrors } = await openApp(page);

  await addFiles(page, [{ name: 'half-written.png', mimeType: 'image/png', buffer: makeCorruptPng() }]);

  await expect(statusText(page)).toHaveClass(/is-error/);
  await expect(page.locator('.file-card')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
