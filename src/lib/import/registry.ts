/**
 * Source-adapter registry and URL validation shared by the browser and the
 * server route. Adding a source means writing an adapter and listing it here.
 */

import { rawTextAdapter } from "./adapters/rawText";
import { ultimateGuitarAdapter } from "./adapters/ultimateGuitar";
import type { ImportErrorCode, ImportFailure, PartialInfo, SourceAdapter } from "./types";

export const ADAPTERS: SourceAdapter[] = [ultimateGuitarAdapter, rawTextAdapter];

export function adapterById(id: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

export const ALLOWED_HOSTS = new Set(ADAPTERS.flatMap((a) => a.hosts));

export type UrlCheck =
  | { ok: true; url: URL; adapter: SourceAdapter }
  | { ok: false; code: ImportErrorCode; partial?: PartialInfo };

const IP_LITERAL = /^\[?[0-9a-f:.]+\]?$/i;

/** Validates user input and picks an adapter. Never performs network access. */
export function checkImportUrl(input: string): UrlCheck {
  const raw = input.trim();
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return { ok: false, code: "invalid_url" };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") return { ok: false, code: "invalid_url" };
  if (url.username || url.password) return { ok: false, code: "invalid_url" };
  if (url.port && url.port !== "443") return { ok: false, code: "unsupported_site", partial: { url: url.toString() } };
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || IP_LITERAL.test(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, code: "unsupported_site", partial: { url: url.toString() } };
  }
  // Accept the site's other hostnames by mapping them to the canonical tab host.
  if (host === "www.ultimate-guitar.com" || host === "ultimate-guitar.com" || host === "m.ultimate-guitar.com") {
    if (url.pathname.startsWith("/tab/")) url.hostname = "tabs.ultimate-guitar.com";
  }
  url.hash = "";
  const adapter = ADAPTERS.find((a) => a.matches(url));
  if (!adapter) {
    const known = ADAPTERS.find((a) => a.hosts.includes(url.hostname));
    return {
      ok: false,
      code: known ? "not_a_song_page" : "unsupported_site",
      partial: { url: url.toString(), site: known?.site },
    };
  }
  return { ok: true, url, adapter };
}

export function partialFor(url: URL, adapter?: SourceAdapter): PartialInfo {
  return { url: url.toString(), site: adapter?.site, ...(adapter?.partialFromUrl(url) ?? {}) };
}

/** Plain-language explanation for each failure. */
export function failureMessage(code: ImportErrorCode, site = "The site", host?: string): string {
  switch (code) {
    case "invalid_url":
      return "That doesn't look like a web address. Check the link and try again.";
    case "unsupported_site":
      return `GuitarCoach can't import from ${host ?? "this site"} automatically yet. You can paste the chord sheet instead.`;
    case "not_a_song_page":
      return "This link doesn't point to a single song's chord sheet. Open the song itself and copy that link.";
    case "paid_content":
      return `This version is only available to paying members of ${site}, so it isn't imported. Try a free "Chords" version of the song, or paste the sheet.`;
    case "not_found":
      return "That page wasn't found. The link may be old or mistyped.";
    case "blocked":
      return `${site} didn't let GuitarCoach read this page. Open it in your browser and use "Import from a browser tab", or paste the chord sheet.`;
    case "rate_limited":
      return "That's a lot of imports in a short time. Wait a minute and try again.";
    case "timeout":
      return `${site} took too long to respond. Try again in a moment.`;
    case "too_large":
      return "That page is much larger than a chord sheet, so it wasn't imported.";
    case "network":
      return `Couldn't reach ${site}. Check your internet connection and try again.`;
    case "parse_failed":
      return "The page opened, but no chord sheet could be found on it.";
    case "offline":
      return "You're offline. Importing from a link needs an internet connection; everything else works offline.";
    case "disabled":
      return `Importing from ${site} is turned off in Settings.`;
  }
}

export function isRetryable(code: ImportErrorCode): boolean {
  return ["timeout", "network", "rate_limited", "offline", "blocked"].includes(code);
}

export function makeFailure(code: ImportErrorCode, partial?: PartialInfo, site?: string): ImportFailure {
  let host: string | undefined;
  try {
    host = partial?.url ? new URL(partial.url).hostname : undefined;
  } catch {
    host = undefined;
  }
  return { code, message: failureMessage(code, site ?? partial?.site, host), retryable: isRetryable(code), partial };
}
