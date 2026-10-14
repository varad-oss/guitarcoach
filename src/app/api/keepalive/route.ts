import { NextResponse } from "next/server";

/**
 * Called once a day by Vercel Cron (vercel.json). Free Supabase projects pause
 * after a week without any activity, so this makes one tiny database read to
 * count as activity. It reads nothing private: without a signed-in user the
 * access rules return no rows.
 */
export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store" };
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401, headers });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: true, skipped: "accounts not configured" }, { headers });
  try {
    const res = await fetch(`${url}/rest/v1/records?select=id&limit=1`, {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json({ ok: res.ok, status: res.status }, { status: res.ok ? 200 : 502, headers });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502, headers });
  }
}
