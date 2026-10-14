"use client";

import { layoutFragments, type PositionedText } from "./layoutText";

/** Extracts the text layer of a PDF in the browser (no upload). */
export async function extractPdfText(file: Blob): Promise<{ text: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 30); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: PositionedText[] = [];
    for (const it of content.items) {
      if (!("str" in it)) continue;
      const t = it.transform as number[];
      items.push({ text: it.str, x: t[4], y: t[5], width: it.width, height: Math.abs(it.height || t[3]) });
    }
    pages.push(layoutFragments(items, { topDown: false }));
  }
  const numPages = doc.numPages;
  await task.destroy();
  return { text: pages.join("\n\n"), pages: numPages };
}
