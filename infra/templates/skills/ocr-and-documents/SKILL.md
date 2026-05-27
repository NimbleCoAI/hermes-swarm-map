# OCR & Document Extraction

Extract text from PDFs, images, and scanned documents.

## Usage

### Text-based PDFs (fast, lightweight)
```bash
python scripts/extract_pymupdf.py document.pdf --markdown
python scripts/extract_pymupdf.py document.pdf --tables
python scripts/extract_pymupdf.py document.pdf --pages 0-4
```

### Remote URLs
Use the `web_extract` tool — it handles PDFs and web pages automatically.

### Scanned Documents / OCR
For scanned PDFs with no selectable text:
```bash
pip install marker-pdf  # ~3-5GB download on first use
marker_single document.pdf --output_dir ./output
```

## Decision Tree

1. Is it a URL? → Use `web_extract`
2. Is it a text-based PDF? → Use `pymupdf` (instant, pre-installed)
3. Is it scanned/image-based? → Use `marker-pdf` (requires download)
4. Is it an image with text? → Use `vision_analyze` with OCR prompt

## Dependencies

- `pymupdf` — pre-installed in Docker image (~25MB)
- `marker-pdf` — optional, install on demand (~3-5GB)
