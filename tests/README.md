# Browser tests for converttopdffree.com

The site is dependency-free static HTML/JS. These Playwright tests serve the repo
root with `python3 -m http.server`, open `index.html` in headless Chromium and
drive the real UI — no mocks of the conversion code.

## Run it

```bash
npm install     # installs @playwright/test only
npm test        # headless; starts and stops the static server for you
```

Chromium is preinstalled in the automation image (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).
**Do not run `npx playwright install`.** `@playwright/test` is pinned to `1.56.1`
because that is the version matching the preinstalled browser build; bumping it
without a matching browser makes every test fail with "Executable doesn't exist".

Useful variants:

```bash
npm test -- happy-path                  # one file
npm test -- -g "corrupt DOCX"           # one test by name
npm run test:headed                     # watch it happen
PORT=5000 npm test                      # if 4173 is taken
```

## What is covered

| File | Covers |
| --- | --- |
| `happy-path.spec.js` | image → PDF, and a mixed image+text queue → one multi-page PDF (asserts real `%PDF-` bytes from the download) |
| `failure-path.spec.js` | corrupt DOCX, unsupported file type, PNG with garbage pixel data: a user-facing error, no hang, no unhandled exception, and the app still works afterwards |
| `input-metadata.spec.js` | the privacy boundary of `input-metadata.js`: safe fields present, forbidden fields (document text, PDF Title/Author, EXIF, pixels, bytes) absent, and extraction never throwing |

Every test asserts `pageErrors` is empty, so any uncaught exception fails the run
even if the UI looks fine.

## Adding a regression case for a new bug

A crash report from the error sheet gives you a `userNote` breadcrumb such as
`mode=single;step=read;files=1;kind=image;size=524288;dims=4000x3000;depth=24;format=jpeg`.
Turn that into a test:

1. **Build the input in code, not as a committed binary.** Add a generator to
   `tests/fixtures.js` (see `makePng`, `makeSmallPdf`, `makeCorruptDocx`) shaped
   like the breadcrumb — same kind, dimensions, depth, PDF version, etc.
2. **Write the test** in the matching spec file (or a new `*.spec.js`) using the
   helpers:

   ```js
   const { test, expect } = require('@playwright/test');
   const { openApp, addFiles, convertAndGetPdf, statusText } = require('./helpers');
   const { makePng } = require('./fixtures');

   test('issue 123: huge greyscale PNG still converts', async ({ page }) => {
     const { pageErrors } = await openApp(page);
     await addFiles(page, [{ name: 'scan.png', mimeType: 'image/png', buffer: makePng(4000, 3000) }]);
     const pdf = await convertAndGetPdf(page);
     expect(pdf.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
     expect(pageErrors).toEqual([]);
   });
   ```

3. **Watch it fail first**, then fix the app code, then watch it pass. A test that
   passes before the fix is not a regression test for this bug.

`openApp()` also blocks analytics and intercepts the Apps Script endpoint, and
returns `{ pageErrors, consoleErrors, errorReports }`. Assert on `errorReports`
when the bug is about *reporting* (see the corrupt-DOCX test) — it holds the exact
JSON payloads the app would have posted, so you can check the breadcrumb without
sending anything anywhere.

Traces for failures land in `test-results/`; open one with
`npx playwright show-trace test-results/<dir>/trace.zip`.
