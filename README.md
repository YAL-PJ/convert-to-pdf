# Local PDF Converter

A tiny, private, browser-only file-to-PDF converter. It focuses on the simple conversions people reach for most: common image formats, lightweight documents, spreadsheets, and text-based files.

## What it does

- Adds common browser-readable images plus DOCX, XLSX, TXT, Markdown, CSV, TSV, RTF, and HTML files with drag-and-drop or the file picker.
- Shows local previews for images and clear file badges for document formats.
- Lets you reorder or remove files before export.
- Builds the PDF entirely in the browser with no dependencies or server calls.
- Converts DOCX and XLSX by reading their text/cell content locally, then laying that content out as PDF pages.
- Offers simple page options: fit each image, A4, Letter, margins, and optional image crop-to-fill.

## Run locally

Open `index.html` directly in a browser, or serve the folder with any static server:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.
