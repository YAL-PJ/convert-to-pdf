# Local PDF Maker

A tiny, private, browser-only image-to-PDF converter. It does one thing: turns JPG and PNG images into a single downloadable PDF without uploading anything.

## What it does

- Adds JPG and PNG images with drag-and-drop or file picker.
- Shows local previews, dimensions, and file sizes.
- Lets you reorder or remove pages before export.
- Builds the PDF entirely in the browser with no dependencies or server calls.
- Offers simple page options: fit each image, A4, Letter, margins, and optional crop-to-fill.

## Run locally

Open `index.html` directly in a browser, or serve the folder with any static server:

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.
