/**
 * Rebuilds monospace-style text from positioned text fragments (PDF text
 * items or OCR words), so chords keep roughly their column above the lyrics.
 */

export interface PositionedText {
  text: string;
  x: number;
  /** Baseline / top coordinate; larger y means lower on the page when topDown is true. */
  y: number;
  width: number;
  height: number;
}

export function layoutFragments(items: PositionedText[], opts: { topDown: boolean }): string {
  const frags = items.filter((i) => i.text.length > 0);
  if (frags.length === 0) return "";
  const charWidths = frags
    .filter((f) => f.text.trim().length > 0 && f.width > 0)
    .map((f) => f.width / f.text.length)
    .sort((a, b) => a - b);
  const charW = charWidths[Math.floor(charWidths.length / 2)] || 6;
  const heights = frags.map((f) => f.height).filter((h) => h > 0).sort((a, b) => a - b);
  const lineH = heights[Math.floor(heights.length / 2)] || 12;
  const minX = Math.min(...frags.map((f) => f.x));

  const sorted = [...frags].sort((a, b) => (opts.topDown ? a.y - b.y : b.y - a.y) || a.x - b.x);
  const lines: PositionedText[][] = [];
  for (const f of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - f.y) <= lineH * 0.45) last.push(f);
    else lines.push([f]);
  }

  const out: string[] = [];
  let prevY: number | null = null;
  for (const line of lines) {
    const y = line[0].y;
    if (prevY !== null && Math.abs(y - prevY) > lineH * 2.1) out.push("");
    prevY = y;
    line.sort((a, b) => a.x - b.x);
    let s = "";
    for (const f of line) {
      const col = Math.max(0, Math.round((f.x - minX) / charW));
      if (col > s.length) s = s.padEnd(col, " ");
      else if (s.length > 0 && !s.endsWith(" ") && !f.text.startsWith(" ")) s += " ";
      s += f.text;
    }
    out.push(s.replace(/\s+$/, ""));
  }
  return out.join("\n");
}
