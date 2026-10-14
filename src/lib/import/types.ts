import type { SheetFormat } from "../parse/common";
import type { SourceMeta, StrumPattern, Voicing } from "../song/model";

export interface ImportedContent {
  adapterId: string;
  site: string;
  url: string;
  title?: string;
  artist?: string;
  /** Raw sheet text (may contain source markup such as [ch]…[/ch]). */
  text: string;
  format: SheetFormat | "auto";
  meta: {
    key?: string;
    capo?: number;
    tuning?: string[];
    bpm?: number;
    /** Source's own label for the version, e.g. "Chords" or "Tabs". */
    versionType?: string;
  };
  /** Chord voicings from the source, with alternates. */
  shapes?: Record<string, Voicing & { alternates?: Voicing[] }>;
  strumPatterns?: StrumPattern[];
  sourceMeta?: SourceMeta;
  /** The source suggests a compound (6/8, 12/8) feel. */
  compoundHint?: boolean;
  /** Plain-language notes for the person reviewing the import. */
  hints: string[];
}

export type ImportErrorCode =
  | "invalid_url"
  | "unsupported_site"
  | "not_a_song_page"
  | "paid_content"
  | "not_found"
  | "blocked"
  | "rate_limited"
  | "timeout"
  | "too_large"
  | "network"
  | "parse_failed"
  | "offline"
  | "disabled";

export interface PartialInfo {
  url: string;
  site?: string;
  title?: string;
  artist?: string;
}

export interface ImportFailure {
  code: ImportErrorCode;
  message: string;
  retryable: boolean;
  partial?: PartialInfo;
}

export type ImportResponse = { ok: true; content: ImportedContent } | { ok: false; error: ImportFailure };

export class ImportError extends Error {
  constructor(
    public code: ImportErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface SourceAdapter {
  id: string;
  /** Display name of the site. */
  site: string;
  /** Exact hostnames this adapter may fetch from. */
  hosts: string[];
  /** Whether the URL points at something this adapter can import. */
  matches(url: URL): boolean;
  /** Best-effort metadata from the URL alone, kept if the import fails. */
  partialFromUrl(url: URL): { title?: string; artist?: string };
  /** Extracts the sheet from a fetched page. Throws ImportError on failure. */
  extract(body: string, url: URL): ImportedContent;
  /** Content types the adapter accepts. */
  contentTypes: RegExp;
  maxBytes: number;
}
