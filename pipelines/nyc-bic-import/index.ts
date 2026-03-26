/**
 * This pipeline was rewritten in Python for reliable PDF table extraction.
 * See index.py in this directory.
 *
 * The BIC approval list PDF uses a structured table format that pdfplumber
 * (Python) extracts cleanly with correct column separation. The pdf-parse
 * (Node.js) text output concatenates BIC numbers into account names in raw
 * mode, making column splitting fragile.
 *
 * Usage:
 *   python pipelines/nyc-bic-import/index.py bic_approved_list.pdf
 *
 * GitHub Actions workflow: .github/workflows/nyc-bic-sync.yml
 */
