/**
 * Plain-text / ChordPro files hosted as raw files on GitHub or Gist.
 */

import { ImportError, type SourceAdapter } from "../types";

function fileName(url: URL): string {
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
  return last.replace(/\.(txt|cho|chopro|chordpro|crd|pro|chord)$/i, "").replace(/[_-]+/g, " ").trim();
}

export const rawTextAdapter: SourceAdapter = {
  id: "raw-text",
  site: "GitHub",
  hosts: ["raw.githubusercontent.com", "gist.githubusercontent.com"],
  contentTypes: /^text\/plain\b/i,
  maxBytes: 512 * 1024,
  matches(url) {
    return this.hosts.includes(url.hostname) && url.pathname.split("/").filter(Boolean).length >= 3;
  },
  partialFromUrl(url) {
    const name = fileName(url);
    return name ? { title: name } : {};
  },
  extract(body, url) {
    if (!body.trim()) throw new ImportError("parse_failed");
    if (/^\s*<(!doctype|html)/i.test(body)) throw new ImportError("parse_failed");
    return {
      adapterId: "raw-text",
      site: url.hostname.startsWith("gist") ? "GitHub Gist" : "GitHub",
      url: url.toString(),
      title: fileName(url) || undefined,
      text: body,
      format: "auto",
      meta: {},
      hints: [],
    };
  },
};
