"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input, Notice, PageHeader, Spinner, cx } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { DraftEditor } from "./DraftEditor";
import { AudioImport } from "./AudioImport";
import { absorbParsedMeta, draftFromImported, emptyDraft, parseDraft, requestImport, type Draft } from "@/lib/import/draft";
import type { ImportFailure, PartialInfo } from "@/lib/import/types";
import { contentFromPayload, decodePayload, bookmarkletSource } from "@/lib/import/bookmarklet";
import { restoreBackup, isBackupFile } from "@/lib/db/backup";
import { nowIso } from "@/lib/song/model";
import { useOnline, useSettings } from "@/lib/hooks";
import { ADAPTERS } from "@/lib/import/registry";

type Method = "link" | "paste" | "file" | "audio" | "blank" | "tab";

const METHODS: Array<{ id: Method; label: string; icon: IconName }> = [
  { id: "link", label: "Paste a link", icon: "link" },
  { id: "paste", label: "Paste chords", icon: "doc" },
  { id: "file", label: "Upload a file", icon: "upload" },
  { id: "audio", label: "Recording only", icon: "wave" },
  { id: "blank", label: "Start blank", icon: "pen" },
  { id: "tab", label: "From a browser tab", icon: "eye" },
];

const TEXT_EXT = /\.(txt|cho|chopro|chordpro|crd|pro|chord|text)$/i;

function withMeta(d: Draft): Draft {
  return absorbParsedMeta(d, parseDraft(d));
}

export function AddSong() {
  const params = useSearchParams();
  const router = useRouter();
  const online = useOnline();
  const [settings] = useSettings();
  const [method, setMethod] = useState<Method>((params.get("method") as Method) || "link");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [url, setUrl] = useState(params.get("url") ?? "");
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [carry, setCarry] = useState<PartialInfo | null>(null);
  const [pasted, setPasted] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileBusy, setFileBusy] = useState<string | null>(null);
  const [blank, setBlank] = useState({ title: "", artist: "" });
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const [pendingAudio, setPendingAudio] = useState<File | null>(null);
  const autoStarted = useRef(false);

  const runImport = useCallback(
    async (target: string) => {
      setLoading(true);
      setFailure(null);
      const res = await requestImport(target);
      setLoading(false);
      if (res.ok) {
        const disabled = settings.disabledAdapters.includes(res.content.adapterId);
        if (disabled) {
          setFailure({ code: "disabled", message: `Importing from ${res.content.site} is turned off in Settings.`, retryable: false, partial: { url: res.content.url, site: res.content.site, title: res.content.title, artist: res.content.artist } });
          return;
        }
        setDraft(withMeta(draftFromImported(res.content, "url")));
      } else {
        setFailure(res.error);
        setCarry(res.error.partial ?? { url: target });
      }
    },
    [settings.disabledAdapters],
  );

  // ?url=… from the home screen starts the import straight away.
  useEffect(() => {
    const u = params.get("url");
    if (u && !autoStarted.current) {
      autoStarted.current = true;
      void runImport(u);
    }
  }, [params, runImport]);

  // Data sent by the browser-tab bookmarklet arrives in the URL fragment.
  useEffect(() => {
    const p = decodePayload(window.location.hash);
    if (!p) return;
    // The fragment only exists in the browser, so it can't be read during render.
    /* eslint-disable react-hooks/set-state-in-effect */
    history.replaceState(null, "", window.location.pathname + window.location.search);
    const content = contentFromPayload(p);
    if (content) {
      setMethod("tab");
      setDraft(withMeta(draftFromImported(content, "browser-tab")));
    } else {
      setMethod("tab");
      setFailure({ code: "parse_failed", message: "Nothing usable came through from that tab. Select the chord sheet on the page first, then click the bookmarklet.", retryable: false, partial: { url: p.url } });
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const carriedSource = (kind: Draft["source"]["kind"]) => ({
    kind,
    url: carry?.url,
    site: carry?.site,
    importedAt: nowIso(),
  });

  function startPaste() {
    if (!pasted.trim()) return;
    setDraft(
      withMeta(
        emptyDraft(carriedSource("paste"), {
          title: carry?.title ?? "",
          artist: carry?.artist ?? "",
          text: pasted,
        }),
      ),
    );
  }

  async function handleFile(file: File) {
    setFileError(null);
    setRestoreMsg(null);
    const base = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    try {
      if (file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm|opus)$/i.test(file.name)) {
        setMethod("audio");
        setPendingAudio(file);
        return;
      }
      if (file.size > 25 * 1024 * 1024) throw new Error("That file is too large for a chord sheet (over 25 MB).");
      if (/\.json$/i.test(file.name) || file.type === "application/json") {
        const data = JSON.parse(await file.text());
        if (!isBackupFile(data)) throw new Error("This JSON file isn't a GuitarCoach song or backup.");
        setFileBusy("Restoring…");
        const r = await restoreBackup(data);
        setFileBusy(null);
        setRestoreMsg(
          `Added ${r.songsAdded} song${r.songsAdded === 1 ? "" : "s"}${r.songsCopied ? `, ${r.songsCopied} as copies to avoid overwriting your edits` : ""}${r.songsSkipped ? `, ${r.songsSkipped} already in your library` : ""}.`,
        );
        return;
      }
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        setFileBusy("Reading PDF…");
        const { extractPdfText } = await import("@/lib/import/pdf");
        const { text } = await extractPdfText(file);
        setFileBusy(null);
        if (!text.trim()) throw new Error("This PDF has no selectable text (it may be a scanned image). Try uploading it as an image instead, or paste the chords.");
        setDraft(
          withMeta(
            emptyDraft(
              { kind: "file", fileName: file.name, importedAt: nowIso(), url: carry?.url, site: carry?.site },
              {
                title: carry?.title ?? base,
                artist: carry?.artist ?? "",
                text,
                lowConfidenceReason: "Chord positions in PDFs can shift. Check that each chord sits over the right word.",
              },
            ),
          ),
        );
        return;
      }
      if (file.type.startsWith("image/")) {
        setFileBusy("Reading text from the image… this runs on your device and can take a little while.");
        const { ocrImage } = await import("@/lib/import/ocr");
        const { text, confidence } = await ocrImage(file, (p) => setFileBusy(`Reading text from the image… ${Math.round(p * 100)}%`));
        setFileBusy(null);
        if (!text.trim()) throw new Error("No text could be read from that image.");
        setDraft(
          withMeta(
            emptyDraft(
              { kind: "file", fileName: file.name, importedAt: nowIso(), url: carry?.url, site: carry?.site },
              {
                title: carry?.title ?? base,
                artist: carry?.artist ?? "",
                text,
                lowConfidenceReason: `Text was recognised from an image (about ${Math.round(confidence)}% confident). Check chords and their positions carefully.`,
              },
            ),
          ),
        );
        return;
      }
      if (TEXT_EXT.test(file.name) || file.type.startsWith("text/") || file.type === "") {
        const text = await file.text();
        if (!text.trim()) throw new Error("That file is empty.");
        setDraft(
          withMeta(
            emptyDraft({ kind: "file", fileName: file.name, importedAt: nowIso(), url: carry?.url, site: carry?.site }, { title: carry?.title ?? "", artist: carry?.artist ?? "", text }),
          ),
        );
        if (!parseDraft(emptyDraft({ kind: "file", importedAt: "" }, { text })).title) {
          setDraft((d) => (d && !d.title ? { ...d, title: base } : d));
        }
        return;
      }
      throw new Error("GuitarCoach can't read this kind of file. Use a text, ChordPro, PDF, image, audio or GuitarCoach JSON file.");
    } catch (e) {
      setFileBusy(null);
      setFileError(e instanceof Error ? e.message : "The file couldn't be read.");
    }
  }

  if (draft) {
    return (
      <div className="px-4 md:px-8 py-6 mx-auto w-full max-w-[1280px]">
        <PageHeader
          title="Check and save"
          description={
            draft.source.kind === "url" || draft.source.kind === "browser-tab"
              ? `Imported from ${draft.source.site ?? "the web"}. Fix anything that was read wrongly, then save.`
              : "Fix anything that was read wrongly, then save."
          }
        />
        <DraftEditor
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onImportVersion={(u) => {
            setDraft(null);
            setUrl(u);
            setMethod("link");
            void runImport(u);
          }}
        />
      </div>
    );
  }

  return (
    <div className="px-4 md:px-8 py-6 mx-auto w-full max-w-[1200px]">
      <PageHeader title="Add a song" description="Bring in a song from a link, a file, a recording, or by typing it. Everything is saved on this device." />

      <div role="tablist" aria-label="Ways to add a song" className="flex flex-wrap gap-2 mb-6">
        {METHODS.map((m) => (
          <button
            key={m.id}
            role="tab"
            type="button"
            aria-selected={method === m.id}
            onClick={() => setMethod(m.id)}
            className={cx(
              "inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border text-[15px] transition-colors",
              method === m.id ? "border-accent/60 bg-accent-wash text-text" : "border-line-soft text-text-2 hover:text-text hover:bg-surface",
            )}
          >
            <Icon name={m.icon} size={17} />
            {m.label}
          </button>
        ))}
      </div>

      {carry && method !== "link" && (
        <div className="mb-4 text-sm text-text-2">
          Keeping from your link: {[carry.title && `“${carry.title}”`, carry.artist, carry.url].filter(Boolean).join(", ")}
        </div>
      )}

      <div role="tabpanel">
        {method === "link" && (
          <div className="flex flex-col gap-5 max-w-[720px]">
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) void runImport(url.trim());
              }}
            >
              <label htmlFor="song-url" className="sr-only">
                Song link
              </label>
              <Input
                id="song-url"
                className="flex-1 h-12 text-base"
                placeholder="https://tabs.ultimate-guitar.com/tab/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
                inputMode="url"
              />
              <Button type="submit" variant="primary" size="lg" disabled={!url.trim() || loading}>
                {loading ? "Importing…" : "Import"}
              </Button>
            </form>
            {!online && <Notice tone="warn">You&apos;re offline. Importing from a link needs an internet connection; pasting and files work offline.</Notice>}
            {loading && <Spinner label="Fetching the chord sheet…" />}
            {failure && <FailurePanel failure={failure} onRetry={() => runImport(url)} onChoose={(m) => setMethod(m)} />}
            <div className="text-sm text-text-3 leading-relaxed">
              <p>
                Supported links: {ADAPTERS.map((a) => a.site).filter((v, i, arr) => arr.indexOf(v) === i).join(", ")} (raw text and ChordPro files). Any other
                site works through &ldquo;From a browser tab&rdquo; or by pasting.
              </p>
            </div>
          </div>
        )}

        {method === "paste" && (
          <div className="flex flex-col gap-3 max-w-[820px]">
            <label htmlFor="paste-area" className="text-text-2">
              Paste a chord sheet. Chords above lyrics, inline [G]chords, and ChordPro all work.
            </label>
            <textarea
              id="paste-area"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              spellCheck={false}
              placeholder={"[Verse 1]\nG              Em\nFirst line of the lyrics\nC              D\nSecond line of the lyrics"}
              className="min-h-[340px] rounded-xl border border-line bg-sunk px-4 py-3 font-mono text-[14px] leading-[1.45] focus:border-accent focus:outline-none whitespace-pre"
            />
            <div>
              <Button variant="primary" size="lg" onClick={startPaste} disabled={!pasted.trim()}>
                Read chord sheet
              </Button>
            </div>
          </div>
        )}

        {method === "file" && (
          <div className="flex flex-col gap-4 max-w-[720px]">
            <DropZone onFile={handleFile} accept=".txt,.cho,.chopro,.chordpro,.crd,.pro,.json,.pdf,image/*,audio/*,text/plain,application/pdf,application/json" />
            {fileBusy && <Spinner label={fileBusy} />}
            {fileError && <Notice tone="bad">{fileError}</Notice>}
            {restoreMsg && (
              <Notice tone="good" title="Restored" action={<Button size="sm" onClick={() => router.push("/songs")}>Open My Songs</Button>}>
                {restoreMsg}
              </Notice>
            )}
            <p className="text-sm text-text-3">
              Text, ChordPro, PDF and images are read on this device. Images use on-device text recognition; PDFs and images need a careful check afterwards.
            </p>
          </div>
        )}

        {method === "audio" && (
          <AudioImport key={pendingAudio ? `${pendingAudio.name}:${pendingAudio.size}` : "none"} initialFile={pendingAudio} carry={carry} />
        )}

        {method === "blank" && (
          <form
            className="flex flex-col gap-4 max-w-[480px]"
            onSubmit={(e) => {
              e.preventDefault();
              setDraft(
                emptyDraft(carriedSource("manual"), {
                  title: blank.title || carry?.title || "",
                  artist: blank.artist || carry?.artist || "",
                  text: "[Verse 1]\nG                C\nType your lyrics here\n",
                }),
              );
            }}
          >
            <Field label="Title" htmlFor="b-title">
              <Input id="b-title" value={blank.title || carry?.title || ""} onChange={(e) => setBlank({ ...blank, title: e.target.value })} required />
            </Field>
            <Field label="Artist" htmlFor="b-artist">
              <Input id="b-artist" value={blank.artist || carry?.artist || ""} onChange={(e) => setBlank({ ...blank, artist: e.target.value })} />
            </Field>
            <div>
              <Button type="submit" variant="primary" size="lg">
                Create song
              </Button>
            </div>
          </form>
        )}

        {method === "tab" && <BrowserTabImport />}
      </div>
    </div>
  );
}

function FailurePanel({ failure, onRetry, onChoose }: { failure: ImportFailure; onRetry: () => void; onChoose: (m: Method) => void }) {
  const p = failure.partial;
  return (
    <div className="rounded-xl border border-warn/35 bg-warn-wash p-4 flex flex-col gap-3" role="alert" data-testid="import-failure">
      <div className="flex gap-3">
        <Icon name="alert" className="text-warn mt-0.5 shrink-0" size={18} />
        <div>
          <p className="font-semibold">The song wasn&apos;t imported</p>
          <p className="text-text-2">{failure.message}</p>
          {(p?.title || p?.artist) && (
            <p className="text-sm text-text-3 mt-1">
              We kept what the link tells us: {[p.title && `“${p.title}”`, p.artist].filter(Boolean).join(" by ")}.
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" icon="doc" onClick={() => onChoose("paste")}>
          Paste chord sheet
        </Button>
        <Button size="sm" icon="restart" onClick={onRetry}>
          Retry import
        </Button>
        <Button size="sm" icon="upload" onClick={() => onChoose("file")}>
          Upload a file
        </Button>
        <Button size="sm" icon="pen" onClick={() => onChoose("blank")}>
          Create manually
        </Button>
        {failure.code === "blocked" && (
          <Button size="sm" icon="eye" onClick={() => onChoose("tab")}>
            Use a browser tab
          </Button>
        )}
      </div>
    </div>
  );
}

function DropZone({ onFile, accept }: { onFile: (f: File) => void; accept: string }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={cx(
        "rounded-xl border-2 border-dashed px-6 py-10 flex flex-col items-center gap-3 text-center transition-colors",
        over ? "border-accent bg-accent-wash" : "border-line",
      )}
    >
      <Icon name="upload" size={28} className="text-text-3" />
      <p className="text-text-2">Drop a file here, or</p>
      <Button onClick={() => input.current?.click()}>Choose a file</Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label="Choose a file to import"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function BrowserTabImport() {
  const linkRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // React blocks javascript: URLs in JSX, so the bookmarklet href is set directly.
    linkRef.current?.setAttribute("href", bookmarkletSource(window.location.origin));
  }, []);
  return (
    <div className="flex flex-col gap-5 max-w-[720px]">
      <p className="text-text-2">
        Use this when a site can&apos;t be imported from a link. It reads the song page you already have open in your own browser and sends it straight
        to GuitarCoach on this device.
      </p>
      <ol className="flex flex-col gap-4">
        <li className="flex gap-3">
          <span className="chord-face text-accent text-xl w-6 shrink-0">1</span>
          <div className="flex flex-col gap-2">
            <span>Drag this button to your bookmarks bar:</span>
            <a
              ref={linkRef}
              href="#"
              onClick={(e) => e.preventDefault()}
              className="self-start inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-accent/50 bg-accent-wash text-text cursor-grab"
              title="Drag to your bookmarks bar"
            >
              <Icon name="plus" size={17} /> Send to GuitarCoach
            </a>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="chord-face text-accent text-xl w-6 shrink-0">2</span>
          <span>Open the song page. On other sites, select the chords and lyrics first for the cleanest result.</span>
        </li>
        <li className="flex gap-3">
          <span className="chord-face text-accent text-xl w-6 shrink-0">3</span>
          <span>Click &ldquo;Send to GuitarCoach&rdquo; in your bookmarks bar. A new GuitarCoach tab opens with the song ready to check.</span>
        </li>
      </ol>
      <p className="text-sm text-text-3">
        Nothing is sent to a server: the song travels in the part of the address after “#”, which browsers keep on your device. Paid or locked content is not
        read.
      </p>
    </div>
  );
}
