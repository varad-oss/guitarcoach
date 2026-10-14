/**
 * Ultimate Guitar adapter.
 *
 * Reads the chord sheet that the public tab page embeds in its HTML (the same
 * data a browser receives when someone opens the page). It does not log in,
 * does not use any separate API, and refuses paid ("Pro"/"Official") content.
 * Page structure is not a documented interface, so every step is defensive and
 * failures fall back to manual import.
 */

import { ImportError, type ImportedContent, type SourceAdapter } from "../types";
import { convertApplicature, decodeUgStrumming, sourceMetaOf, type UgTab, type UgTabView } from "./ugData";

// Paid product lines (and non-text formats) are never imported.
const UNSUPPORTED_TYPES = new Set(["guitar-pro", "pro", "power", "official", "video", "drums"]);

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Parses "/tab/ed-sheeran/perfect-chords-1956589" into its parts. */
export function parseUgPath(pathname: string): { artist: string; title: string; type: string; id: string } | null {
  const m = /^\/tab\/([a-z0-9-]+)\/([a-z0-9-]+?)-(chords|tabs|tab|ukulele|bass|guitar-pro|pro|power|official|video|drums)(?:-(\d+))?-(\d+)\/?$/i.exec(
    pathname,
  );
  if (!m) return null;
  return { artist: titleFromSlug(m[1]), title: titleFromSlug(m[2]), type: m[3].toLowerCase(), id: m[5] };
}

export function decodeHtmlAttribute(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

export function findStoreJson(html: string): string | null {
  const m = /<div[^>]+class="js-store"[^>]+data-content="([^"]*)"/.exec(html) ?? /<div[^>]+data-content="([^"]*)"[^>]+class="js-store"/.exec(html);
  return m ? decodeHtmlAttribute(m[1]) : null;
}

interface UgPageData {
  tab?: UgTab;
  tab_view?: UgTabView;
}

/**
 * Extracts content from the page's embedded data. Exported separately so the
 * browser-tab import can reuse it on data read in the user's own browser.
 */
export function extractFromStore(storeJson: string, url: string): ImportedContent {
  let data: { store?: { page?: { data?: UgPageData } } };
  try {
    data = JSON.parse(storeJson);
  } catch {
    throw new ImportError("parse_failed");
  }
  return extractFromPageData(data.store?.page?.data ?? {}, url);
}

export function extractFromPageData(page: UgPageData, url: string): ImportedContent {
  const tab = page.tab;
  const view = page.tab_view;
  if (!tab || !view) throw new ImportError("parse_failed");
  if (tab.tab_access_type && tab.tab_access_type !== "public") throw new ImportError("paid_content");
  if (view.blocked) throw new ImportError("blocked", "The site marks this version as unavailable in your region.");
  const content = view.wiki_tab?.content;
  if (!content || !content.trim()) throw new ImportError("parse_failed");

  const hints: string[] = [];
  const type = (tab.type ?? tab.type_name ?? "").trim();
  if (/^tabs?$/i.test(type)) hints.push("This is a tablature version, so chords may be missing. A \"Chords\" version usually imports better.");

  const capo = typeof view.meta?.capo === "number" ? view.meta.capo : undefined;
  const tuningValue = view.meta?.tuning?.value;
  const tuning = tuningValue ? tuningValue.split(/\s+/).filter(Boolean) : undefined;
  const strumPatterns = (view.strummings ?? []).map((s, i) => decodeUgStrumming(s, i)).filter((p): p is NonNullable<typeof p> => !!p);
  const skippedPatterns = (view.strummings?.length ?? 0) - strumPatterns.length;
  const bpm = view.strummings?.find((s) => typeof s.bpm === "number" && s.bpm > 30 && s.bpm < 300)?.bpm;
  if (bpm) hints.push(`The site lists a tempo of ${bpm} BPM. It hasn't been checked against a recording.`);
  if (strumPatterns.length) hints.push(`Imported ${strumPatterns.length} strumming pattern${strumPatterns.length === 1 ? "" : "s"} from the site.`);
  if (skippedPatterns > 0) hints.push(`${skippedPatterns} strumming pattern${skippedPatterns === 1 ? " uses" : "s use"} notation GuitarCoach doesn't know, so ${skippedPatterns === 1 ? "it was" : "they were"} left out.`);
  const compoundHint = strumPatterns.length > 0 && strumPatterns[0].slotsPerBeat % 3 === 0;
  if (compoundHint) hints.push("The main strumming pattern uses triplets, so the song may be in 6/8 or 12/8. Check the time signature.");
  const shapes = convertApplicature(view.applicature);
  const meta = sourceMetaOf(tab, view, url);
  if (meta.versions?.length) hints.push(`The site has ${meta.versions.length} other version${meta.versions.length === 1 ? "" : "s"} of this song; you can import a different one below.`);

  return {
    adapterId: "ultimate-guitar",
    site: "Ultimate Guitar",
    url,
    title: tab.song_name?.trim(),
    artist: tab.artist_name?.trim(),
    text: content,
    format: "ug",
    meta: {
      key: view.meta?.tonality || tab.tonality_name || undefined,
      capo,
      tuning: tuning && tuning.length === 6 ? tuning : undefined,
      bpm,
      versionType: type || undefined,
    },
    shapes,
    strumPatterns,
    sourceMeta: meta,
    compoundHint,
    hints,
  };
}

export const ultimateGuitarAdapter: SourceAdapter = {
  id: "ultimate-guitar",
  site: "Ultimate Guitar",
  hosts: ["tabs.ultimate-guitar.com"],
  contentTypes: /^text\/html\b/i,
  maxBytes: 3 * 1024 * 1024,
  matches(url) {
    return this.hosts.includes(url.hostname) && /^\/tab\//.test(url.pathname);
  },
  partialFromUrl(url) {
    const p = parseUgPath(url.pathname);
    return p ? { title: p.title, artist: p.artist } : {};
  },
  extract(body, url) {
    const p = parseUgPath(url.pathname);
    if (p && UNSUPPORTED_TYPES.has(p.type)) throw new ImportError("paid_content");
    const store = findStoreJson(body);
    if (!store) throw new ImportError("parse_failed");
    return extractFromStore(store, url.toString());
  },
};
