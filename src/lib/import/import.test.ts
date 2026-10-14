// Synthetic fixtures only; lyrics are invented.
import { describe, expect, it } from "vitest";
import { checkImportUrl } from "./registry";
import { isPublicAddress } from "./server/netguard";
import { safeFetch, type FetchLike } from "./server/safeFetch";
import { importFromUrl } from "./server/importFromUrl";
import { extractFromStore, findStoreJson, parseUgPath, ultimateGuitarAdapter } from "./adapters/ultimateGuitar";
import { parseSongText } from "../parse";

const UG_URL = "https://tabs.ultimate-guitar.com/tab/test-artist/lantern-song-chords-123456";
const UG_URL_CONST = UG_URL;

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function ugPage(overrides: Record<string, unknown> = {}, content?: string): string {
  const store = {
    store: {
      page: {
        data: {
          tab: { song_name: "Lantern Song", artist_name: "Test Artist", type: "Chords", type_name: "Chords", version: 1, rating: 4.856, votes: 1234, username: "tester", tab_access_type: "public", tonality_name: "G", ...overrides },
          tab_view: {
            wiki_tab: {
              content:
                content ??
                "Capo 2\n\n[Intro]\n[ch]G[/ch]  [ch]D[/ch]\n\n[Verse 1]\n[tab]   [ch]G[/ch]             [ch]Em[/ch]\nLanterns swing on the old pier\n[ch]C[/ch]            [ch]D[/ch]\nSalt & \"spray\" in the cold air[/tab]",
            },
            meta: { capo: 2, tonality: "G", difficulty: "novice", tuning: { name: "Standard", value: "E A D G B E" } },
            strummings: [
              { part: "Main Pattern", denuminator: 16, bpm: 76, is_triplet: 0, measures: [3, 1, 1, 3, 1, 1].map((measure) => ({ measure })) },
              { part: "Pre-Chorus - Alternative Pattern", denuminator: 8, bpm: 76, is_triplet: 1, measures: [1, 202, 101, 201, 102, 203].map((measure) => ({ measure })) },
              { part: "Weird", denuminator: 8, bpm: 76, is_triplet: 0, measures: [{ measure: 999 }] },
            ],
            applicature: {
              G: [
                { frets: [3, 0, 0, 0, 2, 3], fingers: [3, 0, 0, 0, 1, 2], fret: 0, listCapos: [] },
                { frets: [3, 3, 4, 5, 5, 3], fingers: [0, 0, 2, 4, 3, 0], fret: 3, listCapos: [{ fret: 3, startString: 0, lastString: 5, finger: 1 }] },
              ],
              D: [{ frets: [2, 3, 2, 0, -1, -1], fret: 0 }],
              Uke: [{ frets: [0, 2, 3, 2], fret: 0 }],
            },
            versions: [
              { id: 9, type: "Official", type_name: "Official", version: 1, rating: 4.8, votes: 500, tab_url: "https://tabs.ultimate-guitar.com/tab/test-artist/lantern-song-official-9", tab_access_type: "public" },
              { id: 8, type: "Chords", type_name: "Chords", version: 2, rating: 4.61234, votes: 40, tab_url: "https://tabs.ultimate-guitar.com/tab/test-artist/lantern-song-chords-8", difficulty: "intermediate", tab_access_type: "public" },
              { id: 123456, type: "Chords", version: 1, tab_url: UG_URL_CONST },
            ],
            stats: { view_total: 1200, favorites_count: 34 },
            contributors: [{}, {}],
          },
        },
      },
    },
  };
  return `<!doctype html><html><head><title>x</title></head><body><div class="js-store" data-content="${escapeAttr(JSON.stringify(store))}"></div></body></html>`;
}

const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, ...init });

describe("URL validation", () => {
  it("accepts supported song URLs and normalises them", () => {
    const r = checkImportUrl("tabs.ultimate-guitar.com/tab/ed-sheeran/perfect-chords-1956589#x");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.url.toString()).toBe("https://tabs.ultimate-guitar.com/tab/ed-sheeran/perfect-chords-1956589");
      expect(r.adapter.id).toBe("ultimate-guitar");
    }
    const www = checkImportUrl("http://www.ultimate-guitar.com/tab/a/b-chords-1");
    expect(www.ok && www.url.hostname).toBe("tabs.ultimate-guitar.com");
  });

  it("rejects malformed, unsafe and unsupported destinations", () => {
    expect(checkImportUrl("not a url")).toMatchObject({ ok: false, code: "invalid_url" });
    expect(checkImportUrl("ftp://example.com/x")).toMatchObject({ ok: false, code: "invalid_url" });
    expect(checkImportUrl("javascript:alert(1)")).toMatchObject({ ok: false, code: "invalid_url" });
    expect(checkImportUrl("https://user:pw@tabs.ultimate-guitar.com/tab/a/b-chords-1")).toMatchObject({ ok: false, code: "invalid_url" });
    expect(checkImportUrl("http://127.0.0.1/tab/a")).toMatchObject({ ok: false, code: "unsupported_site" });
    expect(checkImportUrl("http://localhost:3000/api")).toMatchObject({ ok: false, code: "unsupported_site" });
    expect(checkImportUrl("https://[::1]/x")).toMatchObject({ ok: false, code: "unsupported_site" });
    expect(checkImportUrl("https://tabs.ultimate-guitar.com:8443/tab/a/b-chords-1")).toMatchObject({ ok: false, code: "unsupported_site" });
    expect(checkImportUrl("https://example.com/song")).toMatchObject({ ok: false, code: "unsupported_site" });
    expect(checkImportUrl("https://tabs.ultimate-guitar.com/explore")).toMatchObject({ ok: false, code: "not_a_song_page" });
  });

  it("parses metadata out of UG paths for fallback", () => {
    expect(parseUgPath("/tab/ed-sheeran/perfect-chords-1956589")).toEqual({ artist: "Ed Sheeran", title: "Perfect", type: "chords", id: "1956589" });
    expect(parseUgPath("/tab/the-band/song-name-chords-2-99")).toMatchObject({ title: "Song Name", type: "chords" });
  });
});

describe("netguard", () => {
  it("blocks private, loopback, link-local and special addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "224.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["104.16.1.1", "8.8.8.8", "2606:4700::6810:1"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it("rejects non-IP strings", () => {
    expect(isPublicAddress("example.com")).toBe(false);
  });
});

describe("Ultimate Guitar extraction", () => {
  it("reads the embedded sheet and metadata", () => {
    const c = ultimateGuitarAdapter.extract(ugPage(), new URL(UG_URL));
    expect(c).toMatchObject({ title: "Lantern Song", artist: "Test Artist", format: "ug", meta: { capo: 2, key: "G", bpm: 76 } });
    expect(c.meta.tuning).toEqual(["E", "A", "D", "G", "B", "E"]);
    expect(c.shapes!.G).toMatchObject({ frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, null, null, null, 3] });
    expect(c.shapes!.G.alternates![0]).toEqual({ frets: [3, 5, 5, 4, 3, 3], fingers: [null, 3, 4, 2, null, null], barres: [{ fret: 3, fromString: 0, toString: 5 }] });
    expect(c.shapes!.D.frets).toEqual([null, null, 0, 2, 3, 2]);
    expect(c.shapes!.Uke).toBeUndefined();
    // Entities in the page attribute are decoded
    expect(c.text).toContain('Salt & "spray"');
    const parsed = parseSongText(c.text);
    expect(parsed.capo).toBe(2);
    const verse = parsed.sections.find((s) => s.name === "Verse 1")!;
    expect(verse.lines.map((l) => l.chords.map((x) => x.chord).join(" "))).toEqual(["G Em", "C D"]);
  });

  it("decodes the site's strumming patterns, skipping unknown notation", () => {
    const c = ultimateGuitarAdapter.extract(ugPage(), new URL(UG_URL));
    const [main, pre] = c.strumPatterns!;
    expect(c.strumPatterns).toHaveLength(2);
    expect(main).toMatchObject({ name: "Main Pattern", slots: ["D", "D", "D", "D", "D", "D"], slotsPerBeat: 4, accents: [0, 3], bpm: 76, source: "source-site" });
    expect(main.sectionKinds).toBeUndefined();
    expect(pre).toMatchObject({ slots: ["D", "-", "U", "D", "x", "-"], slotsPerBeat: 3, palmMutes: [3], sectionKinds: ["pre-chorus"] });
    expect(c.hints.join(" ")).toMatch(/1 strumming pattern uses notation/);
    expect(c.compoundHint).toBe(false);
  });

  it("reads ratings, difficulty and the other versions (paid ones listed last and marked)", () => {
    const m = ultimateGuitarAdapter.extract(ugPage(), new URL(UG_URL)).sourceMeta!;
    expect(m).toMatchObject({ site: "Ultimate Guitar", rating: 4.86, votes: 1234, difficulty: "novice", author: "tester", contributors: 2, views: 1200, favorites: 34, originalKey: "G", tuningName: "Standard" });
    expect(m.versions!.map((v) => [v.type, v.version, v.paid])).toEqual([
      ["Chords", 2, false],
      ["Official", 1, true],
    ]);
    expect(m.versions![0]).toMatchObject({ rating: 4.61, difficulty: "intermediate" });
  });

  it("refuses paid content", () => {
    expect(() => ultimateGuitarAdapter.extract(ugPage({ tab_access_type: "private" }), new URL(UG_URL))).toThrow(/paid_content/);
    expect(() => ultimateGuitarAdapter.extract(ugPage(), new URL("https://tabs.ultimate-guitar.com/tab/a/b-guitar-pro-123"))).toThrow(/paid_content/);
  });

  it("fails clearly when the page has no sheet", () => {
    expect(() => ultimateGuitarAdapter.extract("<html><body>nothing</body></html>", new URL(UG_URL))).toThrow(/parse_failed/);
    expect(() => extractFromStore("{not json", UG_URL)).toThrow(/parse_failed/);
    expect(() => ultimateGuitarAdapter.extract(ugPage({}, "   "), new URL(UG_URL))).toThrow(/parse_failed/);
  });

  it("finds the store regardless of attribute order", () => {
    expect(findStoreJson('<div data-content="{&quot;a&quot;:1}" class="js-store"></div>')).toBe('{"a":1}');
  });
});

describe("safeFetch", () => {
  const url = new URL(UG_URL);

  it("follows a same-site redirect and re-validates it", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (u) => {
      calls.push(u);
      if (calls.length === 1) return new Response(null, { status: 301, headers: { location: "/tab/test-artist/lantern-song-chords-123457" } });
      return html("ok page");
    };
    const page = await safeFetch(url, ultimateGuitarAdapter, { fetchImpl });
    expect(page.body).toBe("ok page");
    expect(calls[1]).toBe("https://tabs.ultimate-guitar.com/tab/test-artist/lantern-song-chords-123457");
  });

  it("refuses redirects to other hosts, http, or internal addresses", async () => {
    for (const location of ["https://evil.example/x", "http://tabs.ultimate-guitar.com/tab/x", "https://169.254.169.254/latest", "https://tabs.ultimate-guitar.com:8080/x"]) {
      const fetchImpl: FetchLike = async () => new Response(null, { status: 302, headers: { location } });
      await expect(safeFetch(url, ultimateGuitarAdapter, { fetchImpl }), location).rejects.toMatchObject({ code: "blocked" });
    }
  });

  it("stops redirect loops", async () => {
    const fetchImpl: FetchLike = async () => new Response(null, { status: 302, headers: { location: UG_URL } });
    await expect(safeFetch(url, ultimateGuitarAdapter, { fetchImpl })).rejects.toMatchObject({ code: "blocked" });
  });

  it("caps response size even without content-length", async () => {
    const big = "x".repeat(ultimateGuitarAdapter.maxBytes + 10);
    const fetchImpl: FetchLike = async () => html(big);
    await expect(safeFetch(url, ultimateGuitarAdapter, { fetchImpl })).rejects.toMatchObject({ code: "too_large" });
  });

  it("maps status codes and bot checks", async () => {
    const cases: Array<[Response, string]> = [
      [new Response("", { status: 404 }), "not_found"],
      [new Response("", { status: 403 }), "blocked"],
      [new Response("", { status: 429 }), "blocked"],
      [new Response("", { status: 503 }), "network"],
      [html("<title>Just a moment...</title><div class=cf-chl-widget>"), "blocked"],
      [new Response("{}", { status: 200, headers: { "content-type": "application/json" } }), "parse_failed"],
    ];
    for (const [res, code] of cases) {
      await expect(safeFetch(url, ultimateGuitarAdapter, { fetchImpl: async () => res })).rejects.toMatchObject({ code });
    }
  });

  it("times out", async () => {
    const fetchImpl: FetchLike = (_u, init) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" }))));
    await expect(safeFetch(url, ultimateGuitarAdapter, { fetchImpl, timeoutMs: 50 })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("importFromUrl", () => {
  it("returns content on success", async () => {
    const r = await importFromUrl(UG_URL, { fetchOptions: { fetchImpl: async () => html(ugPage()) } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.content.title).toBe("Lantern Song");
  });

  it("never reports a failure as success and keeps partial info", async () => {
    const r = await importFromUrl(UG_URL, { fetchOptions: { fetchImpl: async () => new Response("", { status: 403 }) } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("blocked");
      expect(r.error.retryable).toBe(true);
      expect(r.error.partial).toMatchObject({ url: UG_URL, title: "Lantern Song", artist: "Test Artist", site: "Ultimate Guitar" });
      expect(r.error.message).not.toMatch(/CORS|HTTP|403|fetch/);
    }
  });

  it("explains unsupported sites without jargon", async () => {
    const r = await importFromUrl("https://example.com/my-song");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("unsupported_site");
      expect(r.error.message).toMatch(/example\.com/);
      expect(r.error.partial?.url).toBe("https://example.com/my-song");
    }
  });

  it("respects disabled adapters", async () => {
    const r = await importFromUrl(UG_URL, { disabledAdapters: ["ultimate-guitar"] });
    expect(!r.ok && r.error.code).toBe("disabled");
  });
});
