import { describe, expect, it } from "vitest";
import { projectUrl } from "./supabase";

describe("projectUrl", () => {
  it("accepts the project URL in the forms the dashboard shows", () => {
    for (const raw of ["https://abc.supabase.co", "https://abc.supabase.co/", "https://abc.supabase.co/rest/v1/", " https://abc.supabase.co/rest/v1 "]) {
      expect(projectUrl(raw)).toBe("https://abc.supabase.co");
    }
    expect(projectUrl("")).toBeUndefined();
    expect(projectUrl(undefined)).toBeUndefined();
  });
});
