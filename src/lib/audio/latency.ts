/**
 * Round-trip latency from a strum-along test: the person strums on each click;
 * the delay between when a click was scheduled and when the strum arrives at the
 * microphone (output + human alignment + input latency) is what timing
 * feedback has to subtract.
 */
export interface LatencyResult {
  latencyMs: number;
  /** Median absolute deviation, ms. */
  spreadMs: number;
  matched: number;
}

export function computeLatency(clickTimes: number[], onsetTimes: number[], opts: { minMatched?: number; maxMs?: number } = {}): LatencyResult | { error: string } {
  const maxMs = opts.maxMs ?? 450;
  const minMatched = opts.minMatched ?? 5;
  const offsets: number[] = [];
  for (const c of clickTimes) {
    const candidates = onsetTimes.filter((o) => o >= c - 0.08 && o <= c + maxMs / 1000);
    if (!candidates.length) continue;
    const nearest = candidates.reduce((a, b) => (Math.abs(b - c) < Math.abs(a - c) ? b : a));
    offsets.push((nearest - c) * 1000);
  }
  if (offsets.length < minMatched) return { error: `Only ${offsets.length} strums were heard on the clicks. Strum a little louder, closer to the microphone, right on each click.` };
  const sorted = [...offsets].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const dev = offsets.map((o) => Math.abs(o - median)).sort((a, b) => a - b);
  const mad = dev[Math.floor(dev.length / 2)];
  if (mad > 45) return { error: "The strums were too uneven to measure reliably. Try again and strum exactly with each click." };
  return { latencyMs: Math.round(Math.max(0, median)), spreadMs: Math.round(mad), matched: offsets.length };
}
