/**
 * Time signatures and beat structure.
 *
 * Convention: BPM always counts the felt beat. In simple meters (4/4, 3/4, 2/2)
 * that is the denominator note. In compound meters (6/8, 9/8, 12/8) the beat is
 * a dotted quarter made of three eighth-note subdivisions, so 12/8 has four
 * beats per bar and three subdivisions per beat.
 */

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export interface MeterInfo {
  beatsPerBar: number;
  /** Natural subdivisions of one beat (3 in compound meters, 2 otherwise). */
  subdivisionsPerBeat: number;
  isCompound: boolean;
  /** Human-readable name of the beat unit. */
  beatUnit: string;
}

export const COMMON_TIME: TimeSignature = { numerator: 4, denominator: 4 };

export function meterInfo(ts: TimeSignature): MeterInfo {
  const { numerator: n, denominator: d } = ts;
  const isCompound = d === 8 && n % 3 === 0 && n > 3;
  if (isCompound) {
    return { beatsPerBar: n / 3, subdivisionsPerBeat: 3, isCompound, beatUnit: "dotted quarter note" };
  }
  if (d === 8) {
    // Irregular eighth-note meters (5/8, 7/8, 3/8): count every eighth.
    return { beatsPerBar: n, subdivisionsPerBeat: 1, isCompound: false, beatUnit: "eighth note" };
  }
  return {
    beatsPerBar: n,
    subdivisionsPerBeat: 2,
    isCompound: false,
    beatUnit: d === 2 ? "half note" : d === 4 ? "quarter note" : `1/${d} note`,
  };
}

export function parseTimeSignature(s: string | undefined | null): TimeSignature | null {
  if (!s) return null;
  const m = /^\s*(\d{1,2})\s*\/\s*(1|2|4|8|16)\s*$/.exec(s);
  if (!m) return null;
  const numerator = Number(m[1]);
  const denominator = Number(m[2]);
  if (numerator < 1 || numerator > 16) return null;
  return { numerator, denominator };
}

export function formatTimeSignature(ts: TimeSignature): string {
  return `${ts.numerator}/${ts.denominator}`;
}

export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

export function barsToBeats(bars: number, ts: TimeSignature): number {
  return bars * meterInfo(ts).beatsPerBar;
}

export function beatsToBars(beats: number, ts: TimeSignature): number {
  return beats / meterInfo(ts).beatsPerBar;
}

export const SUPPORTED_TIME_SIGNATURES: TimeSignature[] = [
  { numerator: 4, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 2, denominator: 4 },
  { numerator: 2, denominator: 2 },
  { numerator: 6, denominator: 8 },
  { numerator: 9, denominator: 8 },
  { numerator: 12, denominator: 8 },
  { numerator: 5, denominator: 4 },
  { numerator: 7, denominator: 8 },
];
