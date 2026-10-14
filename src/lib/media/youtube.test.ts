import { describe, expect, it } from "vitest";
import { parseYouTubeId } from "./youtube";

describe("parseYouTubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=2Vv-BfVoq4g", "2Vv-BfVoq4g"],
    ["https://youtube.com/watch?v=2Vv-BfVoq4g&t=42s", "2Vv-BfVoq4g"],
    ["https://m.youtube.com/watch?v=2Vv-BfVoq4g", "2Vv-BfVoq4g"],
    ["https://music.youtube.com/watch?v=2Vv-BfVoq4g", "2Vv-BfVoq4g"],
    ["https://youtu.be/2Vv-BfVoq4g?si=abc", "2Vv-BfVoq4g"],
    ["youtu.be/2Vv-BfVoq4g", "2Vv-BfVoq4g"],
    ["https://www.youtube.com/shorts/2Vv-BfVoq4g", "2Vv-BfVoq4g"],
    ["https://www.youtube.com/embed/2Vv-BfVoq4g", "2Vv-BfVoq4g"],
    ["https://www.youtube-nocookie.com/embed/2Vv-BfVoq4g", "2Vv-BfVoq4g"],
    ["2Vv-BfVoq4g", "2Vv-BfVoq4g"],
  ])("%s", (input, id) => expect(parseYouTubeId(input)).toBe(id));

  it("rejects other links", () => {
    for (const bad of ["https://vimeo.com/123", "https://www.youtube.com/channel/abc", "https://evil.example/watch?v=2Vv-BfVoq4g", "not a link", "https://youtu.be/short"]) {
      expect(parseYouTubeId(bad), bad).toBeNull();
    }
  });
});
