const { test, expect } = require('@playwright/test');
const { openApp, addFiles, convertAndGetPdf, statusText } = require('./helpers');
const { makePng, makeTextFile } = require('./fixtures');

test('converts an image to a downloadable PDF', async ({ page }) => {
  const { pageErrors } = await openApp(page);

  await addFiles(page, [{ name: 'photo.png', mimeType: 'image/png', buffer: makePng(48, 32) }]);

  await expect(page.locator('.file-card')).toHaveCount(1);
  await expect(page.locator('.file-card span')).toContainText('48×32px');
  await expect(page.locator('#convert-button')).toBeEnabled();

  const pdf = await convertAndGetPdf(page);
  expect(pdf.name).toMatch(/\.pdf$/);
  expect(pdf.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(pdf.bytes.toString('latin1')).toContain('%%EOF');
  // One input image -> exactly one page.
  expect(pdf.bytes.toString('latin1')).toMatch(/\/Type \/Pages[^>]*\/Count 1/);

  await expect(statusText(page)).toContainText('Done');
  expect(pageErrors).toEqual([]);
});

test('converts a mixed image + text queue into one multi-page PDF', async ({ page }) => {
  const { pageErrors } = await openApp(page);

  await addFiles(page, [
    { name: 'photo.png', mimeType: 'image/png', buffer: makePng(40, 40) },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: makeTextFile('Line one\nLine two\n') },
  ]);

  await expect(page.locator('.file-card')).toHaveCount(2);
  await expect(statusText(page)).toContainText('2 files ready');

  const pdf = await convertAndGetPdf(page);
  expect(pdf.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(pdf.bytes.toString('latin1')).toMatch(/\/Type \/Pages[^>]*\/Count 2/);
  expect(pageErrors).toEqual([]);
});
