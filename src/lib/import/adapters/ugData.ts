/**
 * Conversion of Ultimate Guitar's page data (as embedded in the public tab
 * page) into GuitarCoach structures: strumming patterns, chord voicings,
 * versions and metadata. Shared by the server adapter and the browser-tab
 * bookmarklet.
 */

import { newId, sectionKindFromName, type SectionKind, type SourceMeta, type SourceVersion, type StrumPattern, type StrumSlot, type Voicing } from "../../song/model";
import type { Frets } from "../../music/shapes";

// ---------- strumming ----------

type Stroke = "down" | "up" | "pm" | "pause" | "realPause";
type Effect = "none" | "mute" | "accent";

/** UG's measure codes, as interpreted by the site's own pattern renderer. */
const STRUM_CODES: Record<number, { stroke: Stroke; effect: Effect }> = {
  1: { stroke: "down", effect: "none" },
  2: { stroke: "down", effect: "mute" },
  3: { stroke: "down", effect: "accent" },
  101: { stroke: "up", effect: "none" },
  102: { stroke: "up", effect: "mute" },
  103: { stroke: "up", effect: "accent" },
  201: { stroke: "pm", effect: "none" },
  202: { stroke: "pause", effect: "none" },
  203: { stroke: "realPause", effect: "none" },
};

export interface UgStrumming {
  part?: string;
  denuminator?: number;
  bpm?: number;
  is_triplet?: number | boolean;
  measures?: Array<{ measure: number } | number>;
}

function sectionKindsOf(part: string): SectionKind[] | undefined {
  const kinds = part
    .split(/\s+-\s+|,|\//)
    .map((p) => sectionKindFromName(p.trim()))
    .filter((k) => k !== "other");
  return kinds.length ? [...new Set(kinds)] : undefined;
}

export function decodeUgStrumming(s: UgStrumming, index = 0): StrumPattern | null {
  const codes = (s.measures ?? []).map((m) => (typeof m === "number" ? m : m.measure));
  if (codes.length === 0) return null;
  const slots: StrumSlot[] = [];
  const accents: number[] = [];
  const palmMutes: number[] = [];
  for (const [i, code] of codes.entries()) {
    const beat = STRUM_CODES[code];
    if (!beat) return null; // unknown notation: better no pattern than a wrong one
    if (beat.stroke === "pause" || beat.stroke === "realPause") slots.push("-");
    else if (beat.effect === "mute") slots.push("x");
    else slots.push(beat.stroke === "up" ? "U" : "D");
    if (beat.effect === "accent") accents.push(i);
    if (beat.stroke === "pm") palmMutes.push(i);
  }
  const denominator = s.denuminator && [4, 8, 16, 32].includes(s.denuminator) ? s.denuminator : 8;
  const triplet = !!s.is_triplet;
  const slotsPerBeat = (denominator / 4) * (triplet ? 1.5 : 1);
  const part = (s.part ?? "").trim();
  return {
    id: newId("pat"),
    name: part || `Pattern ${index + 1}`,
    slots,
    slotsPerBeat,
    accents: accents.length ? accents : undefined,
    palmMutes: palmMutes.length ? palmMutes : undefined,
    bpm: s.bpm && s.bpm > 20 ? s.bpm : undefined,
    sectionKinds: sectionKindsOf(part),
    source: "source-site",
  };
}

// ---------- chord voicings ----------

export interface UgVoicing {
  frets?: number[];
  fingers?: number[];
  fret?: number;
  listCapos?: Array<{ fret: number; startString: number; lastString: number; finger?: number }>;
}

/** UG lists strings from high E to low E and uses -1 for muted strings; frets are absolute. */
export function convertUgVoicing(v: UgVoicing): Voicing | null {
  if (!v.frets || v.frets.length !== 6) return null; // guitar only (ukulele/bass voicings are skipped)
  const frets: Frets = [...v.frets].reverse().map((f) => (f < 0 ? null : f));
  const fingers = v.fingers && v.fingers.length === 6 ? [...v.fingers].reverse().map((f) => (f > 0 ? f : null)) : undefined;
  const barres = (v.listCapos ?? [])
    .filter((b) => b.fret > 0)
    .map((b) => {
      const a = 5 - b.startString;
      const c = 5 - b.lastString;
      return { fret: b.fret, fromString: Math.min(a, c), toString: Math.max(a, c) };
    });
  return { frets, fingers, barres: barres.length ? barres : undefined };
}

export function convertApplicature(app: Record<string, UgVoicing[]> | undefined, maxAlternates = 12): Record<string, Voicing & { alternates?: Voicing[] }> {
  const out: Record<string, Voicing & { alternates?: Voicing[] }> = {};
  for (const [name, variations] of Object.entries(app ?? {})) {
    const voicings = (variations ?? []).map(convertUgVoicing).filter((v): v is Voicing => !!v);
    if (!voicings.length) continue;
    const [first, ...rest] = voicings;
    out[name] = { ...first, alternates: rest.length ? rest.slice(0, maxAlternates) : undefined };
  }
  return out;
}

// ---------- versions and metadata ----------

const PAID_TYPES = /^(official|pro|guitar pro|power|power tab)$/i;

export interface UgVersion {
  id?: number;
  type?: string;
  type_name?: string;
  version?: number;
  rating?: number;
  votes?: number;
  tab_url?: string;
  tonality_name?: string;
  difficulty?: string;
  tab_access_type?: string;
}

export function convertVersions(versions: UgVersion[] | undefined, currentUrl: string): SourceVersion[] {
  const out: SourceVersion[] = [];
  for (const v of versions ?? []) {
    if (!v.tab_url || v.tab_url === currentUrl) continue;
    const type = v.type_name || v.type || "Version";
    out.push({
      url: v.tab_url,
      type,
      version: v.version ?? 1,
      rating: typeof v.rating === "number" ? Math.round(v.rating * 100) / 100 : undefined,
      votes: v.votes,
      difficulty: v.difficulty || undefined,
      key: v.tonality_name || undefined,
      paid: PAID_TYPES.test(type) || (!!v.tab_access_type && v.tab_access_type !== "public"),
    });
  }
  return out.sort((a, b) => Number(a.paid) - Number(b.paid) || (b.votes ?? 0) - (a.votes ?? 0));
}

export interface UgTab {
  song_name?: string;
  artist_name?: string;
  type?: string;
  type_name?: string;
  version?: number;
  rating?: number;
  votes?: number;
  difficulty?: string;
  username?: string;
  tonality_name?: string;
  version_description?: string;
  tab_access_type?: string;
}

export interface UgTabView {
  wiki_tab?: { content?: string };
  meta?: { capo?: number; tonality?: string; difficulty?: string; tuning?: { value?: string; name?: string } };
  strummings?: UgStrumming[];
  applicature?: Record<string, UgVoicing[]>;
  versions?: UgVersion[];
  stats?: { view_total?: number; favorites_count?: number };
  contributors?: unknown[] | number;
  ug_difficulty?: string;
  blocked?: boolean;
}

export function sourceMetaOf(tab: UgTab, view: UgTabView, url: string): SourceMeta {
  return {
    site: "Ultimate Guitar",
    rating: typeof tab.rating === "number" ? Math.round(tab.rating * 100) / 100 : undefined,
    votes: tab.votes,
    difficulty: view.meta?.difficulty || tab.difficulty || view.ug_difficulty || undefined,
    author: tab.username || undefined,
    contributors: Array.isArray(view.contributors) ? view.contributors.length : typeof view.contributors === "number" ? view.contributors : undefined,
    views: view.stats?.view_total,
    favorites: view.stats?.favorites_count,
    version: tab.version,
    versionType: tab.type_name || tab.type,
    versionNote: tab.version_description || undefined,
    originalKey: view.meta?.tonality || tab.tonality_name || undefined,
    tuningName: view.meta?.tuning?.name || undefined,
    versions: convertVersions(view.versions, url),
  };
}
