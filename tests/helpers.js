/**
 * Shared page helpers. Keep new tests to these three moves:
 *   openApp(page) -> addFiles(page, [...]) -> convertAndGetPdf(page)
 */
const { expect } = require('@playwright/test');

/**
 * Load index.html and start collecting anything the browser complains about, so
 * a test can assert "no unhandled error" instead of hoping.
 */
async function openApp(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error && error.message)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // The live site loads Google Analytics; block it so tests never touch the network.
  await page.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.abort());
  // The error reporter posts to Apps Script. Capture the payloads instead of sending them.
  const errorReports = [];
  await page.route(/script\.google\.com/, async (route) => {
    try {
      errorReports.push(JSON.parse(route.request().postData() || '{}'));
    } catch (_) {
      errorReports.push({ unparsed: true });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.goto('/index.html');
  await expect(page.locator('#convert-button')).toBeVisible();
  return { pageErrors, consoleErrors, errorReports };
}

/** files: [{ name, mimeType, buffer }] */
async function addFiles(page, files) {
  await page.setInputFiles('#file-input', files);
}

/** Click Convert and return the downloaded PDF as a Buffer. */
async function convertAndGetPdf(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.click('#convert-button');
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

function statusText(page) {
  return page.locator('#status');
}

module.exports = { openApp, addFiles, convertAndGetPdf, statusText };
