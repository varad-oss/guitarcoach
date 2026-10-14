import { describe, expect, it } from "vitest";
import { bookmarkletSource, contentFromPayload, decodePayload, encodePayload } from "./bookmarklet";

describe("bookmarklet payload", () => {
  it("round-trips unicode text through the URL fragment", () => {
    const hash = "#" + encodePayload({ v: 1, url: "https://example.com/song", text: "[Verse]\nG   Em\nCafé lights — ñ\n", selection: true });
    const p = decodePayload(hash)!;
    expect(p.text).toContain("Café lights — ñ");
    const c = contentFromPayload(p)!;
    expect(c.site).toBe("example.com");
    expect(c.format).toBe("auto");
    expect(c.hints[0]).toMatch(/selected/);
  });

  it("maps Ultimate Guitar page data", () => {
    const c = contentFromPayload({
      v: 1,
      url: "https://tabs.ultimate-guitar.com/tab/a/b-chords-1",
      ug: {
        tab: { song_name: "Song", artist_name: "Band", tab_access_type: "public" },
        tab_view: { wiki_tab: { content: "[ch]G[/ch]" }, meta: { capo: 3, tonality: "A", tuning: { value: "E A D G B E" } }, strummings: [{ bpm: 88, denuminator: 8, measures: [{ measure: 1 }, { measure: 101 }] }] },
      },
    })!;
    expect(c).toMatchObject({ adapterId: "ultimate-guitar", title: "Song", artist: "Band", format: "ug", meta: { capo: 3, key: "A", bpm: 88 } });
    expect(c.strumPatterns![0].slots).toEqual(["D", "U"]);
  });

  it("rejects garbage", () => {
    expect(decodePayload("#gc-import=%%%")).toBeNull();
    expect(decodePayload("#other")).toBeNull();
  });

  it("produces a javascript: URL that targets the app origin", () => {
    const src = decodeURIComponent(bookmarkletSource("http://localhost:3000"));
    expect(src.startsWith("javascript:(function(){")).toBe(true);
    expect(src).toContain('"http://localhost:3000"');
    // The generated code must at least parse.
    expect(() => new Function(src.slice("javascript:".length))).not.toThrow();
  });
});
