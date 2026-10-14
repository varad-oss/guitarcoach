/**
 * Chord-symbol parsing, normalisation, transposition and pitch-class sets.
 *
 * Supports the notation found on typical chord sheets: major/minor, sevenths,
 * extensions, suspended, added-tone, diminished/augmented, power chords,
 * alterations and slash (alternate bass) chords. Unicode accidentals and the
 * common synonyms (min, -, M7, Δ, °, ø, +) are accepted.
 */

export const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export type ChordFamily = "maj" | "min" | "dim" | "aug" | "sus2" | "sus4" | "5";

export interface ParsedChord {
  /** Normalised symbol, e.g. "F#m7", "Cmaj7", "D/F#". */
  symbol: string;
  root: number;
  rootName: string;
  /** Normalised quality suffix ("" for a major triad). */
  suffix: string;
  bass: number | null;
  bassName: string | null;
  /** Semitone intervals above the root (may exceed 12 for extensions). */
  intervals: number[];
  /** Sorted pitch classes sounded, including an alternate bass note. */
  pcs: number[];
  family: ChordFamily;
}

export function noteToPc(name: string): number | null {
  const m = /^([A-Ga-g])([#b♯♭]{0,2})$/.exec(name.trim());
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const acc of m[2]) pc += acc === "#" || acc === "♯" ? 1 : -1;
  return ((pc % 12) + 12) % 12;
}

export function pcToName(pc: number, preferFlats = false): string {
  const i = ((pc % 12) + 12) % 12;
  return preferFlats ? FLAT_NAMES[i] : SHARP_NAMES[i];
}

function normaliseUnicode(s: string): string {
  return s
    .replace(/♯/g, "#")
    .replace(/♭/g, "b")
    .replace(/[−–]/g, "-")
    .replace(/Δ/g, "maj")
    .replace(/°/g, "dim")
    .replace(/ø7?/g, "m7b5");
}

interface QualityState {
  third: number | null;
  fifth: number | null;
  seventh: number | null;
  extras: Set<number>;
  sus: 2 | 4 | null;
  power: boolean;
}

/**
 * Parses the quality suffix into intervals. Returns null when the suffix
 * contains anything that is not chord notation (so ordinary words are rejected).
 */
function parseSuffix(raw: string): { state: QualityState; normalised: string } | null {
  const s = raw.replace(/[()\s,]/g, "");
  const st: QualityState = { third: 4, fifth: 7, seventh: null, extras: new Set(), sus: null, power: false };
  let i = 0;
  let norm = "";
  let majorSeventh = false;

  const startsWith = (tok: string) => s.startsWith(tok, i);

  // Leading quality.
  if (startsWith("maj") || startsWith("Maj") || startsWith("MAJ")) {
    i += 3;
    majorSeventh = true;
    norm += "maj";
  } else if (startsWith("ma") && /\d/.test(s[i + 2] ?? "")) {
    i += 2;
    majorSeventh = true;
    norm += "maj";
  } else if (s[i] === "M" && (i + 1 >= s.length || /\d/.test(s[i + 1]))) {
    i += 1;
    majorSeventh = true;
    norm += "maj";
  } else if (startsWith("min")) {
    i += 3;
    st.third = 3;
    norm += "m";
  } else if (startsWith("mi") && !startsWith("mis")) {
    i += 2;
    st.third = 3;
    norm += "m";
  } else if (s[i] === "m" && !startsWith("maj")) {
    i += 1;
    st.third = 3;
    norm += "m";
  } else if (s[i] === "-" && i === 0) {
    i += 1;
    st.third = 3;
    norm += "m";
  } else if (startsWith("dim")) {
    i += 3;
    st.third = 3;
    st.fifth = 6;
    norm += "dim";
    if (s[i] === "7") {
      i += 1;
      st.seventh = 9;
      norm += "7";
    }
  } else if (s[i] === "o" && s[i + 1] === "7") {
    // Only "o7" is accepted: a bare "o" would turn words like "Go" or "Do" into chords.
    i += 2;
    st.third = 3;
    st.fifth = 6;
    st.seventh = 9;
    norm += "dim7";
  } else if (startsWith("aug")) {
    i += 3;
    st.fifth = 8;
    norm += "aug";
  } else if (s[i] === "+" && !/\d/.test(s[i + 1] ?? "")) {
    i += 1;
    st.fifth = 8;
    norm += "aug";
  }

  // Minor-major seventh: "mmaj7", "m(maj7)", "mM7".
  if (st.third === 3 && st.fifth === 7) {
    if (startsWith("maj") || startsWith("Maj")) {
      i += 3;
      majorSeventh = true;
      norm += "maj";
    } else if (s[i] === "M" && /\d/.test(s[i + 1] ?? "")) {
      i += 1;
      majorSeventh = true;
      norm += "maj";
    }
  }

  // Main number.
  const num = /^(13|11|9|7|69|6\/9|6|5|4|2)/.exec(s.slice(i));
  if (num) {
    const n = num[1];
    i += n.length;
    const sev = majorSeventh ? 11 : st.seventh ?? 10;
    switch (n) {
      case "5":
        if (norm === "") {
          st.power = true;
          st.third = null;
        } else return null;
        break;
      case "6":
        st.extras.add(9);
        break;
      case "69":
      case "6/9":
        st.extras.add(9);
        st.extras.add(14);
        break;
      case "7":
        st.seventh = sev;
        break;
      case "9":
        st.seventh = sev;
        st.extras.add(14);
        break;
      case "11":
        st.seventh = sev;
        st.extras.add(14);
        st.extras.add(17);
        break;
      case "13":
        st.seventh = sev;
        st.extras.add(14);
        st.extras.add(21);
        break;
      case "2":
        st.extras.add(2);
        break;
      case "4":
        st.sus = 4;
        break;
    }
    norm += n === "6/9" ? "69" : n;
  } else if (majorSeventh) {
    // Bare "maj" means a major triad: "Cmaj".
    norm = norm.replace(/maj$/, "");
  }

  // Modifiers, in any order.
  const modifiers: Array<[RegExp, (m: RegExpExecArray) => boolean]> = [
    [/^sus2/, () => ((st.sus = 2), true)],
    [/^sus4/, () => ((st.sus = 4), true)],
    [/^sus/, () => ((st.sus = 4), true)],
    [/^add(2|4|6|9|11|13)/, (m) => {
      const map: Record<string, number> = { "2": 2, "4": 5, "6": 9, "9": 14, "11": 17, "13": 21 };
      st.extras.add(map[m[1]]);
      return true;
    }],
    [/^(?:no|omit)3/, () => ((st.third = null), true)],
    [/^(?:no|omit)5/, () => ((st.fifth = null), true)],
    [/^alt/, () => true],
    [/^(?:b|-)5/, () => ((st.fifth = 6), true)],
    [/^(?:#|\+)5/, () => ((st.fifth = 8), true)],
    [/^(?:b|-)9/, () => (st.extras.add(13), true)],
    [/^(?:#|\+)9/, () => (st.extras.add(15), true)],
    [/^(?:#|\+)11/, () => (st.extras.add(18), true)],
    [/^(?:b|-)13/, () => (st.extras.add(20), true)],
    [/^(?:maj|M)7/, () => ((st.seventh = 11), true)],
  ];

  while (i < s.length) {
    const rest = s.slice(i);
    let matched = false;
    for (const [re, apply] of modifiers) {
      const m = re.exec(rest);
      if (m && apply(m)) {
        i += m[0].length;
        norm += m[0].replace(/^-(\d)/, "b$1").replace(/^\+(\d)/, "#$1").replace(/^M7/, "maj7");
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }

  if (st.sus !== null) st.third = null;
  return { state: st, normalised: norm };
}

/**
 * Parses a chord symbol. Returns null for anything that is not a chord, so it
 * doubles as the "is this token a chord?" test used by the sheet parser.
 */
export function parseChord(input: string): ParsedChord | null {
  if (!input) return null;
  let s = normaliseUnicode(input.trim());
  // Tolerate wrapping parentheses: "(G)".
  if (/^\(.+\)$/.test(s)) s = s.slice(1, -1);
  if (s.length > 16) return null;

  const m = /^([A-G])([#b]?)(.*)$/.exec(s);
  if (!m) return null;
  let rest = m[3];
  let bassName: string | null = null;
  let bass: number | null = null;

  const slash = /\/([A-Ga-g][#b]?)$/.exec(rest);
  if (slash && !/6\/9$/.test(rest)) {
    const b = noteToPc(slash[1]);
    if (b === null) return null;
    bass = b;
    bassName = slash[1][0].toUpperCase() + slash[1].slice(1);
    rest = rest.slice(0, -slash[0].length);
  }

  const parsed = parseSuffix(rest);
  if (!parsed) return null;
  const { state, normalised } = parsed;

  const root = noteToPc(m[1] + m[2])!;
  const rootName = m[1] + m[2];
  const intervals = new Set<number>([0]);
  if (state.third !== null) intervals.add(state.third);
  if (state.sus !== null) intervals.add(state.sus === 2 ? 2 : 5);
  if (state.fifth !== null) intervals.add(state.fifth);
  if (state.seventh !== null) intervals.add(state.seventh);
  for (const e of state.extras) intervals.add(e);

  const ivs = [...intervals].sort((a, b) => a - b);
  const pcsSet = new Set(ivs.map((iv) => (root + iv) % 12));
  if (bass !== null) pcsSet.add(bass);

  let family: ChordFamily;
  if (state.power) family = "5";
  else if (state.sus === 2) family = "sus2";
  else if (state.sus === 4) family = "sus4";
  else if (state.third === 3 && state.fifth === 6) family = "dim";
  else if (state.third === 4 && state.fifth === 8) family = "aug";
  else if (state.third === 3) family = "min";
  else if (state.third === null && !state.power) family = "5";
  else family = "maj";

  return {
    symbol: rootName + normalised + (bassName ? `/${bassName}` : ""),
    root,
    rootName,
    suffix: normalised,
    bass,
    bassName,
    intervals: ivs,
    pcs: [...pcsSet].sort((a, b) => a - b),
    family,
  };
}

export function isChord(token: string): boolean {
  return parseChord(token) !== null;
}

/** Returns the normalised spelling of a chord, or the input unchanged if it does not parse. */
export function normaliseChord(token: string): string {
  return parseChord(token)?.symbol ?? token.trim();
}

/** Transposes a chord symbol by a number of semitones. */
export function transposeChord(symbol: string, semitones: number, preferFlats?: boolean): string {
  const c = parseChord(symbol);
  if (!c) return symbol;
  const flats = preferFlats ?? (c.rootName.includes("b") || (c.bassName?.includes("b") ?? false));
  const root = pcToName(c.root + semitones, flats);
  const bass = c.bass === null ? "" : `/${pcToName(c.bass + semitones, flats)}`;
  return root + c.suffix + bass;
}

/**
 * Whether a detected chord is an acceptable rendition of the expected chord:
 * same root and same basic triad family. Colour tones (7, add9), alternate bass
 * notes and power-chord voicings of a major/minor chord all count as correct.
 */
export function chordsCompatible(expected: string, detected: string): boolean {
  const e = parseChord(expected);
  const d = parseChord(detected);
  if (!e || !d) return false;
  if (e.root !== d.root) return false;
  if (e.family === d.family) return true;
  const openFifth = (f: ChordFamily) => f === "5";
  if (openFifth(e.family) && (d.family === "maj" || d.family === "min")) return true;
  if (openFifth(d.family) && (e.family === "maj" || e.family === "min")) return true;
  return false;
}

/** A compact label describing a chord's family, used for UI copy. */
export function familyLabel(f: ChordFamily): string {
  return {
    maj: "major",
    min: "minor",
    dim: "diminished",
    aug: "augmented",
    sus2: "suspended 2nd",
    sus4: "suspended 4th",
    "5": "power chord",
  }[f];
}

/** Which accidental spelling a key prefers. */
export function keyPrefersFlats(key: string | undefined | null): boolean {
  if (!key) return false;
  const k = parseChord(key);
  if (!k) return false;
  const flatMajors = new Set([5, 10, 3, 8, 1, 6]); // F Bb Eb Ab Db Gb
  const flatMinors = new Set([2, 7, 0, 5, 10, 3]); // Dm Gm Cm Fm Bbm Ebm
  return k.family === "min" ? flatMinors.has(k.root) : flatMajors.has(k.root) || k.rootName.includes("b");
}
