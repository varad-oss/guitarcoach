"use client";

import type Tesseract from "tesseract.js";
import { layoutFragments, type PositionedText } from "./layoutText";

type TesseractGlobal = typeof Tesseract;

let loading: Promise<TesseractGlobal> | null = null;

/** Loads the OCR engine from this app's own files (public/vendor), not a CDN. */
function loadTesseract(): Promise<TesseractGlobal> {
  const w = window as unknown as { Tesseract?: TesseractGlobal };
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/tesseract/tesseract.min.js";
    s.async = true;
    s.onload = () => (w.Tesseract ? resolve(w.Tesseract) : reject(new Error("The text-recognition engine didn't load.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("The text-recognition engine couldn't be loaded."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * On-device text recognition for photos/screenshots of chord sheets. The OCR
 * engine and English model are served from this app, so no image or text
 * leaves the device.
 */
export async function ocrImage(image: Blob, onProgress?: (p: number) => void): Promise<{ text: string; confidence: number }> {
  const T = await loadTesseract();
  const worker = await T.createWorker("eng", 1, {
    workerPath: "/vendor/tesseract/worker.min.js",
    corePath: "/vendor/tesseract",
    langPath: "/vendor/tesseract",
    gzip: true,
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(m.progress);
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(image, {}, { blocks: true, text: true });
    const words: PositionedText[] = [];
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines)
          for (const w of l.words) {
            if (!w.text.trim()) continue;
            words.push({
              text: w.text,
              x: w.bbox.x0,
              y: (w.bbox.y0 + w.bbox.y1) / 2,
              width: w.bbox.x1 - w.bbox.x0,
              height: w.bbox.y1 - w.bbox.y0,
            });
          }
    const text = words.length ? layoutFragments(words, { topDown: true }) : data.text;
    return { text, confidence: data.confidence };
  } finally {
    await worker.terminate();
  }
}
