// Copy the pdf.js worker into /public, pinned to the installed pdfjs-dist version
// so the worker never drifts from the API. Run on postinstall.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const src = "node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
const dest = "public/pdf.worker.min.mjs";

if (!existsSync(src)) {
  console.warn("[copy-pdf-worker] source not found, skipping:", src);
  process.exit(0);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("[copy-pdf-worker] copied", src, "->", dest);
