import { checkImportUrl, makeFailure, partialFor } from "../registry";
import { ImportError, type ImportResponse } from "../types";
import { safeFetch, type SafeFetchOptions } from "./safeFetch";

export interface ImportDeps {
  fetchOptions?: SafeFetchOptions;
  disabledAdapters?: string[];
}

export async function importFromUrl(input: string, deps: ImportDeps = {}): Promise<ImportResponse> {
  const check = checkImportUrl(input);
  if (!check.ok) return { ok: false, error: makeFailure(check.code, check.partial ?? (input ? { url: input } : undefined)) };
  const { url, adapter } = check;
  const partial = partialFor(url, adapter);
  if (deps.disabledAdapters?.includes(adapter.id)) {
    return { ok: false, error: makeFailure("disabled", partial, adapter.site) };
  }
  try {
    const page = await safeFetch(url, adapter, deps.fetchOptions);
    const content = adapter.extract(page.body, page.url);
    if (!content.title && partial.title) content.title = partial.title;
    if (!content.artist && partial.artist) content.artist = partial.artist;
    return { ok: true, content };
  } catch (e) {
    const code = e instanceof ImportError ? e.code : "parse_failed";
    if (!(e instanceof ImportError)) console.error("[import] unexpected error", e);
    else if (e.message && e.message !== e.code) console.warn(`[import] ${adapter.id}: ${e.code}: ${e.message}`);
    return { ok: false, error: makeFailure(code, partial, adapter.site) };
  }
}
