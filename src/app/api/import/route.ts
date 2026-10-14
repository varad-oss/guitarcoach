import { NextResponse } from "next/server";
import { importFromUrl } from "@/lib/import/server/importFromUrl";
import { makeFailure } from "@/lib/import/registry";

// Small in-memory limiter: this server is meant for one person, not as a public proxy.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > MAX_PER_WINDOW;
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (tests, curl) send no Origin
  try {
    return new URL(origin).host === new URL(req.url).host || new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(req)) {
    return NextResponse.json({ ok: false, error: makeFailure("invalid_url") }, { status: 403, headers });
  }
  const client = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(client)) {
    return NextResponse.json({ ok: false, error: makeFailure("rate_limited") }, { status: 429, headers });
  }
  const raw = await req.text();
  if (raw.length > 4096) {
    return NextResponse.json({ ok: false, error: makeFailure("invalid_url") }, { status: 413, headers });
  }
  let url = "";
  try {
    const body = JSON.parse(raw) as { url?: unknown };
    url = typeof body.url === "string" ? body.url : "";
  } catch {
    url = "";
  }
  const disabled = (process.env.GUITARCOACH_DISABLED_ADAPTERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const result = await importFromUrl(url, { disabledAdapters: disabled });
  return NextResponse.json(result, { status: 200, headers });
}
