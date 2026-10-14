/** In-place iterative radix-2 FFT with cached tables, plus helpers for real signals. */

interface Tables {
  rev: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}

const cache = new Map<number, Tables>();

function tables(n: number): Tables {
  let t = cache.get(n);
  if (t) return t;
  if (n & (n - 1)) throw new Error("FFT size must be a power of two");
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  t = { rev, cos, sin };
  cache.set(n, t);
  return t;
}

export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  const { rev, cos, sin } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

const hannCache = new Map<number, Float64Array>();
export function hann(n: number): Float64Array {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return w;
}

/**
 * Magnitude spectrum (bins 0..n/2) of a windowed real frame.
 * `frame` may be shorter than n (zero-padded).
 */
export function magnitudeSpectrum(frame: ArrayLike<number>, n: number, out?: Float64Array): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const w = hann(frame.length);
  for (let i = 0; i < frame.length; i++) re[i] = frame[i] * w[i];
  fft(re, im);
  const mag = out ?? new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

export function rms(frame: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < frame.length; i++) s += frame[i] * frame[i];
  return Math.sqrt(s / Math.max(1, frame.length));
}

export function toDb(x: number): number {
  return 20 * Math.log10(Math.max(x, 1e-9));
}

export function nextPow2(x: number): number {
  return 1 << Math.ceil(Math.log2(Math.max(2, x)));
}
