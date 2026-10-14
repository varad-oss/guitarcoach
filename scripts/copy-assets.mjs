// Copies browser-side vendor assets into public/vendor so they are served
// locally (and cached for offline use) instead of loaded from a CDN.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "public", "vendor");
mkdirSync(out, { recursive: true });

const copies = [["node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"]];

// OCR (optional dependency): worker, one WASM core build, English model.
const tess = "node_modules/tesseract.js/dist/worker.min.js";
if (existsSync(path.join(root, tess))) {
  mkdirSync(path.join(out, "tesseract"), { recursive: true });
  copies.push([tess, "tesseract/worker.min.js"]);
  // Loaded at runtime with a <script> tag; bundling tesseract.js stalls Turbopack.
  copies.push(["node_modules/tesseract.js/dist/tesseract.min.js", "tesseract/tesseract.min.js"]);
  const coreDir = "node_modules/tesseract.js-core";
  for (const f of readdirSync(path.join(root, coreDir))) {
    // Only the LSTM builds are used (oem 1); tesseract.js picks the variant the browser supports.
    if (/^tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(f)) copies.push([`${coreDir}/${f}`, `tesseract/${f}`]);
  }
  const dataDir = "node_modules/@tesseract.js-data/eng/4.0.0_best_int";
  if (existsSync(path.join(root, dataDir, "eng.traineddata.gz"))) copies.push([`${dataDir}/eng.traineddata.gz`, "tesseract/eng.traineddata.gz"]);
}

for (const [from, to] of copies) {
  cpSync(path.join(root, from), path.join(out, to));
}
console.log(`copied ${copies.length} vendor asset(s) to public/vendor`);
