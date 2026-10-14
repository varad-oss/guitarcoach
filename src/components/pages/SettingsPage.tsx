"use client";

import { useEffect, useRef, useState } from "react";
import { Button, ConfirmDialog, Field, Input, Notice, PageHeader, Select, Toggle, Spinner, Segmented } from "@/components/ui";
import { MicProblem } from "@/components/studio/parts";
import { clearAllData, saveSettings } from "@/lib/db/db";
import { createBackup, restoreBackup } from "@/lib/db/backup";
import { downloadFile, useOnline, useSettings } from "@/lib/hooks";
import { listInputDevices } from "@/lib/audio/mic";
import { useMic } from "@/lib/studio/useMic";
import { Metronome } from "@/lib/audio/metronome";
import { resumeAudio } from "@/lib/audio/engine";
import { computeLatency } from "@/lib/audio/latency";
import { ADAPTERS } from "@/lib/import/registry";

async function readStorage(): Promise<{ usage: number; quota: number; persisted: boolean } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  const persisted = (await navigator.storage.persisted?.()) ?? false;
  return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
}

function Section({ id, title, children, description }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-line-soft pt-6 grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-text-3 mt-1">{description}</p>}
      </div>
      <div className="flex flex-col gap-5 max-w-[620px]">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const [settings, update, ready] = useSettings();
  const online = useOnline();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [swState, setSwState] = useState<string>("checking");
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshStorage = () => readStorage().then((s) => s && setStorage(s));

  useEffect(() => {
    void listInputDevices().then(setDevices);
    void readStorage().then((s) => s && setStorage(s));
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then((r) => setSwState(r?.active ? "ready" : process.env.NODE_ENV === "production" ? "installing" : "dev"));
    } else queueMicrotask(() => setSwState("unsupported"));
  }, []);

  if (!ready) return <div className="p-8"><Spinner /></div>;
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div className="px-4 md:px-8 py-6 max-w-[1000px] flex flex-col gap-8">
      <PageHeader title="Settings" description="Saved on this device." />

      <Section id="appearance" title="Display" description="For reading at a distance from your guitar.">
        <Field label="Theme" htmlFor="theme">
          <Segmented label="Theme" value={settings.theme} onChange={(v) => update({ theme: v })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
        </Field>
        <Field label={`Sheet text size: ${Math.round(settings.fontScale * 100)}%`} htmlFor="font-scale">
          <input id="font-scale" type="range" min={0.8} max={2.2} step={0.1} value={settings.fontScale} onChange={(e) => update({ fontScale: Number(e.target.value) })} />
        </Field>
        <Toggle checked={settings.largeChords} onChange={(v) => update({ largeChords: v })} label="Large chord names" description="Makes chords stand out above the lyrics." />
        <Toggle checked={settings.showDiagrams} onChange={(v) => update({ showDiagrams: v })} label="Show chord diagrams while practising" />
        <Toggle checked={settings.followMode} onChange={(v) => update({ followMode: v })} label="Follow playback by default" description="The sheet scrolls to the current line." />
      </Section>

      <Section id="audio" title="Microphone and audio" description="Audio is analysed in this browser and never uploaded.">
        <Field label="Microphone" htmlFor="mic-device" hint={devices.some((d) => d.label) ? undefined : "Device names appear after you allow microphone access once."}>
          <Select id="mic-device" value={settings.micDeviceId ?? ""} onChange={(e) => update({ micDeviceId: e.target.value || undefined })}>
            <option value="">System default</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference pitch (A4)" htmlFor="a4" hint="440 Hz is standard. Change it only if you tune to a different reference.">
          <Input id="a4" type="number" min={415} max={466} value={settings.a4} onChange={(e) => update({ a4: Math.max(415, Math.min(466, Number(e.target.value) || 440)) })} className="w-28" />
        </Field>
        <Field label={`Metronome volume: ${Math.round(settings.metronome.volume * 100)}%`} htmlFor="metro-vol">
          <input id="metro-vol" type="range" min={0} max={1.2} step={0.05} value={settings.metronome.volume} onChange={(e) => update((s) => ({ ...s, metronome: { ...s.metronome, volume: Number(e.target.value) } }))} />
        </Field>
        <div className="rounded-xl border border-line-soft p-4 flex flex-col gap-2">
          <p className="font-semibold">Chord calibration</p>
          <p className="text-sm text-text-3">Record a few takes of your chords so judging is tuned to your guitar and microphone.</p>
          <Toggle checked={settings.usePersonalCalibration} onChange={(v) => update({ usePersonalCalibration: v })} label="Use my calibration" />
          <a href="/calibrate" className="text-accent hover:underline text-sm self-start">
            Open chord calibration
          </a>
        </div>
        <LatencyCalibration latencyMs={settings.latencyMs} onSave={(ms) => update({ latencyMs: ms, latencyMeasuredAt: new Date().toISOString() })} onReset={() => update({ latencyMs: null, latencyMeasuredAt: undefined })} deviceId={settings.micDeviceId} a4={settings.a4} />
      </Section>

      <Section id="coaching" title="Timing feedback" description="How strict the timing coach is.">
        <Field label={`On time within ±${settings.timing.onTimeMs} ms`} htmlFor="ontime" hint="Beginners: 90–120 ms. Tighter values suit experienced players.">
          <input id="ontime" type="range" min={20} max={150} step={5} value={settings.timing.onTimeMs} onChange={(e) => update((s) => ({ ...s, timing: { ...s.timing, onTimeMs: Number(e.target.value) } }))} />
        </Field>
        <Field label={`Look for a strum within ±${settings.timing.windowMs} ms of each change`} htmlFor="window" hint="Strums further away count as a missed change.">
          <input id="window" type="range" min={150} max={600} step={25} value={settings.timing.windowMs} onChange={(e) => update((s) => ({ ...s, timing: { ...s.timing, windowMs: Number(e.target.value) } }))} />
        </Field>
      </Section>

      <Section id="sources" title="Import sources" description="Sites GuitarCoach may fetch a song page from when you paste a link. Each import is a single request you start.">
        {ADAPTERS.map((a) => (
          <div key={a.id}>
            <Toggle
              checked={!settings.disabledAdapters.includes(a.id)}
              onChange={(v) => update((s) => ({ ...s, disabledAdapters: v ? s.disabledAdapters.filter((x) => x !== a.id) : [...s.disabledAdapters, a.id] }))}
              label={a.site}
              description={a.hosts.join(", ")}
            />
            {a.id === "ultimate-guitar" && (
              <p className="text-sm text-text-3 mt-2">
                Imports the free versions: chords, lyrics, strumming patterns, chord voicings, ratings and the list of other versions. Paid versions (Official,
                Pro, Guitar Pro) are listed but not imported. Imported songs stay in this browser.
              </p>
            )}
          </div>
        ))}
        <p className="text-sm text-text-3">Importing from a link needs an internet connection. Pasting, files, practice and the tuner all work offline.</p>
      </Section>

      <Section id="data" title="Your data" description="There's no account. Everything lives in this browser profile.">
        <Notice tone="warn">Clearing this site&apos;s data in your browser deletes your songs, recordings and history. Make a backup first.</Notice>
        {storage && (
          <p className="text-sm text-text-2">
            Using {mb(storage.usage)} of about {mb(storage.quota)} available.{" "}
            {storage.persisted ? "Storage is marked as persistent." : "The browser may clear it if the device runs low on space."}
          </p>
        )}
        {storage && !storage.persisted && navigator.storage?.persist && (
          <div>
            <Button
              onClick={async () => {
                await navigator.storage.persist();
                await refreshStorage();
              }}
            >
              Ask the browser to keep my data
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            icon="download"
            variant="primary"
            disabled={backupBusy}
            onClick={async () => {
              setBackupBusy(true);
              const b = await createBackup({ includeAudio: false });
              downloadFile(`guitarcoach-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b));
              setBackupBusy(false);
            }}
          >
            Back up songs and history
          </Button>
          <Button
            icon="download"
            disabled={backupBusy}
            onClick={async () => {
              setBackupBusy(true);
              const b = await createBackup({ includeAudio: true });
              downloadFile(`guitarcoach-backup-with-audio-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b));
              setBackupBusy(false);
            }}
          >
            Back up including recordings
          </Button>
          <Button icon="upload" onClick={() => fileRef.current?.click()}>
            Restore a backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Choose a backup file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const r = await restoreBackup(JSON.parse(await f.text()));
                setRestoreMsg({
                  tone: "good",
                  text: `Restored ${r.songsAdded} songs, ${r.recordingsAdded} recordings and ${r.sessionsAdded} sessions.${r.songsCopied ? ` ${r.songsCopied} songs you'd edited were kept, and the backup's versions were added as copies.` : ""}${r.songsSkipped ? ` ${r.songsSkipped} were already here.` : ""}`,
                });
              } catch (err) {
                setRestoreMsg({ tone: "bad", text: err instanceof Error ? err.message : "That file couldn't be restored." });
              }
            }}
          />
        </div>
        {restoreMsg && <Notice tone={restoreMsg.tone}>{restoreMsg.text}</Notice>}
        <div>
          <Button variant="danger" icon="trash" onClick={() => setConfirmClear(true)}>
            Delete everything
          </Button>
        </div>
      </Section>

      <Section id="offline" title="Offline and install">
        <p className="text-text-2">
          {swState === "ready"
            ? "GuitarCoach is cached for offline use. Your library, practice, tuner and analysis work without a connection."
            : swState === "dev"
              ? "Offline caching is switched off while developing. It's active in the production build."
              : swState === "unsupported"
                ? "This browser doesn't support offline caching."
                : "Preparing offline support…"}
        </p>
        <p className="text-sm text-text-3">
          You&apos;re {online ? "online" : "offline"}. To install, use your browser&apos;s “Install app” or “Add to Home Screen” option.
        </p>
      </Section>

      <ConfirmDialog
        open={confirmClear}
        title="Delete all GuitarCoach data?"
        body="Every song, recording, practice session and setting on this device will be deleted. This can't be undone without a backup."
        confirmLabel="Delete everything"
        danger
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => {
          await clearAllData();
          await saveSettings({});
          setRestoreMsg({ tone: "good", text: "All data deleted." });
        }}
      />
    </div>
  );
}

function LatencyCalibration({ latencyMs, onSave, onReset, deviceId, a4 }: { latencyMs: number | null; onSave: (ms: number) => void; onReset: () => void; deviceId?: string; a4: number }) {
  // Raw microphone times are needed here, so compensation is set to zero.
  const mic = useMic({ mode: "chords", a4, deviceId, latencyMs: 0 });
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [result, setResult] = useState<{ ms: number; spread: number } | { error: string } | null>(null);
  const onsets = useRef<number[]>([]);

  useEffect(() => mic.onOnset((t) => onsets.current.push(t)), [mic]);

  async function run() {
    setResult(null);
    onsets.current = [];
    if (mic.status !== "on") await mic.start();
    await resumeAudio();
    const metro = new Metronome(null);
    metro.setVolume(1);
    setPhase("running");
    const beats = 12;
    const bpm = 90;
    const end = await metro.countIn(beats, bpm, 1);
    const clicks = metro.history.slice(-beats).map((c) => c.ctxTime);
    await new Promise((r) => setTimeout(r, 600));
    metro.dispose();
    void end;
    const r = computeLatency(clicks.slice(4), onsets.current);
    setResult("error" in r ? r : { ms: r.latencyMs, spread: r.spreadMs });
    setPhase("done");
    mic.stop();
  }

  return (
    <div id="latency" className="scroll-mt-6 rounded-xl border border-line-soft p-4 flex flex-col gap-3">
      <div>
        <p className="font-semibold">Timing calibration</p>
        <p className="text-sm text-text-3">
          Speakers and microphones add delay. Strum along with 12 clicks (the first four are a lead-in) so GuitarCoach can subtract it from timing feedback.
          Use the same speakers or headphones you practise with.
        </p>
      </div>
      <p className="text-sm text-text-2">
        {latencyMs === null ? "Not calibrated yet: an estimate from the browser is used." : `Current calibration: ${latencyMs} ms.`}
      </p>
      <MicProblem mic={mic} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={run} disabled={phase === "running"}>
          {phase === "running" ? "Strum on every click…" : "Start calibration"}
        </Button>
        {latencyMs !== null && (
          <Button variant="ghost" onClick={onReset}>
            Clear calibration
          </Button>
        )}
      </div>
      {result && "error" in result && <Notice tone="warn">{result.error}</Notice>}
      {result && !("error" in result) && (
        <Notice tone="good" title={`Measured ${result.ms} ms (±${result.spread} ms)`} action={<Button size="sm" variant="primary" onClick={() => onSave(result.ms)}>Use this</Button>} />
      )}
    </div>
  );
}
