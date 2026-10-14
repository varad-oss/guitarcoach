"use client";

import { useEffect, useState } from "react";
import { Button, ConfirmDialog, Field, Input, Notice, PageHeader, Panel, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { clearAllData } from "@/lib/db/db";
import { relativeDate, useOnline } from "@/lib/hooks";
import { sendEmailCode, signInWithGoogle, signOut, syncNow, useAccount, verifyEmailCode } from "@/lib/sync/account";

export function AccountPage() {
  const account = useAccount();
  const online = useOnline();
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    // Google or the email link can come back with an error in the address.
    const params = new URLSearchParams(window.location.search + "&" + window.location.hash.slice(1));
    const err = params.get("error_description");
    if (err) queueMicrotask(() => setUrlError(err.replace(/\+/g, " ")));
  }, []);

  return (
    <div className="px-4 md:px-8 py-6 max-w-[760px]">
      <PageHeader
        title="Account"
        description="Sign in to keep your songs, edits, recordings, practice history and chord calibration in sync between this device and your others. Everything still works offline and syncs when you're back online."
      />
      {urlError && (
        <div className="mb-5">
          <Notice tone="bad" title="Sign-in didn't finish">
            {urlError}
          </Notice>
        </div>
      )}
      {!account.enabled ? (
        <Notice title="Accounts aren't switched on for this copy of GuitarCoach">
          Everything is saved on this device only. To turn on sign-in and sync, connect a Supabase project (see &ldquo;Accounts and sync&rdquo; in the README).
        </Notice>
      ) : !account.ready ? (
        <Spinner />
      ) : account.user ? (
        <SignedIn online={online} />
      ) : (
        <SignInForm online={online} />
      )}
    </div>
  );
}

function SignInForm({ online }: { online: boolean }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"google" | "send" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel className="p-5 md:p-6 flex flex-col gap-5">
      {!online && <Notice tone="warn">You&apos;re offline. Signing in needs a connection.</Notice>}
      <Button variant="secondary" size="lg" disabled={!online || busy !== null} onClick={() => run("google", signInWithGoogle)}>
        <GoogleMark /> Continue with Google
      </Button>
      <div className="flex items-center gap-3 text-sm text-text-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line-soft" /> or with your email <span className="h-px flex-1 bg-line-soft" />
      </div>
      {!sentTo ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const to = email.trim();
            void run("send", async () => {
              await sendEmailCode(to);
              setSentTo(to);
            });
          }}
        >
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Button type="submit" variant="primary" icon="mail" disabled={!online || busy !== null || !email.trim()}>
            {busy === "send" ? "Sending…" : "Email me a sign-in link"}
          </Button>
          <p className="text-sm text-text-3">No password. A new account is created the first time.</p>
        </form>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run("verify", () => verifyEmailCode(sentTo, code.replace(/\s/g, "")));
          }}
        >
          <Notice tone="good" title={`Email sent to ${sentTo}`}>
            Open the link in the email in this same browser, or, if the email shows a code, type it below.
          </Notice>
          <Field label="Code from the email (if it has one)" htmlFor="code">
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="chord-face text-xl tracking-[0.3em]"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy !== null || code.replace(/\s/g, "").length < 6}>
              {busy === "verify" ? "Signing in…" : "Sign in"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSentTo(null);
                setCode("");
                setError(null);
              }}
            >
              Use a different email
            </Button>
          </div>
        </form>
      )}
      {error && <Notice tone="bad">{error}</Notice>}
    </Panel>
  );
}

function SignedIn({ online }: { online: boolean }) {
  const account = useAccount();
  const [confirmOut, setConfirmOut] = useState(false);
  const [removeLocal, setRemoveLocal] = useState(false);
  const r = account.lastResult;

  const status =
    account.status === "syncing"
      ? { icon: "cloud" as const, tone: "text-text-2", text: "Syncing…" }
      : !online || account.status === "offline"
        ? { icon: "cloudOff" as const, tone: "text-warn", text: "Offline. Changes are saved here and sync when you're back online." }
        : account.status === "error"
          ? { icon: "cloudOff" as const, tone: "text-bad", text: "The last sync didn't finish. It will try again." }
          : account.lastSyncedAt
            ? { icon: "check" as const, tone: "text-accent", text: `Up to date, synced ${relativeDate(new Date(account.lastSyncedAt).toISOString())}` }
            : { icon: "cloud" as const, tone: "text-text-2", text: "Waiting to sync" };

  return (
    <div className="flex flex-col gap-5">
      <Panel className="p-5 md:p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="h-10 w-10 rounded-full bg-accent-wash border border-accent-line inline-flex items-center justify-center text-accent">
            <Icon name="user" size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-text-3">Signed in as</p>
            <p className="font-semibold truncate">{account.user?.email ?? "your account"}</p>
          </div>
        </div>
        <p className={`flex items-start gap-2 text-[15px] ${status.tone}`} role="status" data-testid="sync-status">
          <Icon name={status.icon} size={18} className="mt-0.5 shrink-0" />
          {status.text}
        </p>
        {account.status === "error" && account.error && <p className="text-sm text-text-3">Details: {account.error}</p>}
        {r && r.audioTooLarge.length > 0 && (
          <Notice tone="warn" title="Some audio stays on this device only">
            Files over 50 MB can&apos;t be uploaded on the free plan: {r.audioTooLarge.join(", ")}. Their songs and timing still sync.
          </Notice>
        )}
        {r && r.errors.length > 0 && (
          <Notice tone="warn" title="Some audio didn't upload">
            {r.errors.join(" ")} It will try again on the next sync.
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button icon="restart" disabled={!online || account.status === "syncing"} onClick={() => void syncNow()}>
            Sync now
          </Button>
          <Button variant="ghost" onClick={() => setConfirmOut(true)}>
            Sign out
          </Button>
        </div>
      </Panel>
      <p className="text-sm text-text-3 max-w-[62ch]">
        What syncs: songs and your edits, display settings, recordings (including uploaded audio, up to 50 MB each), alignments, practice sessions and reports,
        chord calibration and most settings. Latency, microphone choice and text size stay per device. Microphone audio from practice is analysed on the
        device and never uploaded.
      </p>

      <ConfirmDialog
        open={confirmOut}
        title="Sign out?"
        confirmLabel="Sign out"
        danger={removeLocal}
        onClose={() => setConfirmOut(false)}
        onConfirm={async () => {
          await signOut();
          if (removeLocal) await clearAllData();
        }}
        body={
          <div className="flex flex-col gap-3">
            <p>Anything not yet synced is sent first. Your account keeps everything.</p>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={removeLocal} onChange={(e) => setRemoveLocal(e.target.checked)} />
              <span>Also remove my songs and recordings from this device</span>
            </label>
          </div>
        }
      />
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
