/**
 * Server-side fetch hardened against SSRF:
 * - only hosts listed by the matching adapter, https only, default port only
 * - DNS answers are checked at connect time, so private/loopback/link-local
 *   addresses are refused even if a public name resolves to one (rebinding)
 * - redirects are followed manually and every hop is re-validated
 * - overall timeout and a hard response-size cap
 * Bot challenges and access controls are reported, never worked around.
 */

import dns from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { ImportError, type SourceAdapter } from "../types";
import { isPublicAddress } from "./netguard";

export const USER_AGENT = "GuitarCoach/0.1 (personal song import; one request per user action)";

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      const e: NodeJS.ErrnoException = new Error(`Refusing to connect to non-public address for ${hostname}`);
      e.code = "EBLOCKEDADDR";
      return callback(e);
    }
    if (options?.all) callback(null, list);
    else callback(null, list[0].address, list[0].family);
  });
}

let agent: Agent | null = null;
function guardedAgent(): Agent {
  agent ??= new Agent({
    connect: { lookup: guardedLookup as never, timeout: 8_000 },
    headersTimeout: 10_000,
    bodyTimeout: 10_000,
  });
  return agent;
}

export interface FetchedPage {
  url: URL;
  status: number;
  contentType: string;
  body: string;
}

export type FetchLike = (url: string, init: { redirect: "manual"; headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

const defaultFetch: FetchLike = (url, init) =>
  undiciFetch(url, { ...init, dispatcher: guardedAgent() }) as unknown as Promise<Response>;

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  fetchImpl?: FetchLike;
}

export function validateHop(next: URL, adapter: SourceAdapter): void {
  if (next.protocol !== "https:") throw new ImportError("blocked", "Redirected to a non-https address.");
  if (next.username || next.password || (next.port && next.port !== "443")) throw new ImportError("blocked");
  if (!adapter.hosts.includes(next.hostname)) throw new ImportError("blocked", `Redirected away from ${adapter.site}.`);
}

const CHALLENGE_MARKERS = [/cf-chl-/i, /challenge-platform/i, /<title>\s*Just a moment/i, /captcha/i, /Access denied/i];

export async function safeFetch(start: URL, adapter: SourceAdapter, opts: SafeFetchOptions = {}): Promise<FetchedPage> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const maxRedirects = opts.maxRedirects ?? 3;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 12_000);
  let current = new URL(start.toString());
  validateHop(current, adapter);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current.toString(), {
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
          "Accept-Language": "en",
        },
      });
    } catch (e) {
      throw mapNetworkError(e);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new ImportError("network");
      const next = new URL(loc, current);
      validateHop(next, adapter);
      current = next;
      continue;
    }
    if (res.status === 404 || res.status === 410) throw new ImportError("not_found");
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 451) {
      await res.body?.cancel().catch(() => {});
      throw new ImportError("blocked", `HTTP ${res.status}`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new ImportError("network", `HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!adapter.contentTypes.test(contentType)) {
      await res.body?.cancel().catch(() => {});
      throw new ImportError("parse_failed", `Unexpected content type ${contentType}`);
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > adapter.maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new ImportError("too_large");
    }
    const body = await readCapped(res, adapter.maxBytes);
    if (CHALLENGE_MARKERS.some((re) => re.test(body.slice(0, 20_000))) && !/js-store/.test(body)) {
      throw new ImportError("blocked", "The site answered with a bot check.");
    }
    return { url: current, status: res.status, contentType, body };
  }
  throw new ImportError("blocked", "Too many redirects.");
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let r: ReadableStreamReadResult<Uint8Array>;
    try {
      r = await reader.read();
    } catch (e) {
      throw mapNetworkError(e);
    }
    if (r.done) break;
    total += r.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ImportError("too_large");
    }
    chunks.push(r.value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(all);
}

function mapNetworkError(e: unknown): ImportError {
  if (e instanceof ImportError) return e;
  const err = e as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  const name = err?.name ?? err?.cause?.name;
  const code = err?.code ?? err?.cause?.code;
  if (name === "TimeoutError" || name === "AbortError" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT") {
    return new ImportError("timeout");
  }
  if (code === "EBLOCKEDADDR") return new ImportError("blocked", "The site's address is not a public internet address.");
  return new ImportError("network", String(code ?? name ?? e));
}
