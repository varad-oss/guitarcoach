"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { cx } from "./ui";
import { useLiveQuery, useOnline, useSettings } from "@/lib/hooks";
import { getCalibration } from "@/lib/db/db";
import { buildProfile } from "@/lib/dsp/calibration";
import { setPersonalProfile } from "@/lib/dsp/chordTemplates";
import { startAccount, useAccount, type AccountState } from "@/lib/sync/account";
import { setGetReadySeconds } from "@/lib/studio/getReady";
import { GetReadyOverlay } from "./GetReadyOverlay";

/** Sidebar / header button for the account, showing whether sync is healthy. */
function AccountLink({ account, compact, online }: { account: AccountState; compact?: boolean; online: boolean }) {
  if (!account.enabled) return null;
  const signedIn = Boolean(account.user);
  const problem = signedIn && (account.status === "error" || !online);
  const label = !signedIn ? "Sign in to sync" : problem ? "Not synced" : account.status === "syncing" ? "Syncing…" : "Synced";
  return (
    <Link
      href="/account"
      title={compact ? label : undefined}
      aria-label={compact ? `Account: ${label}` : undefined}
      className={cx(
        "flex items-center gap-3 rounded-lg text-text-2 hover:text-text hover:bg-surface transition-colors",
        compact ? "justify-center h-10 w-10" : "h-10 px-3",
      )}
    >
      <Icon name={!signedIn ? "user" : problem ? "cloudOff" : "cloud"} size={19} className={problem ? "text-warn" : signedIn ? "text-accent" : undefined} />
      {!compact && <span className="text-[15px] truncate">{label}</span>}
    </Link>
  );
}

const NAV: Array<{ href: string; label: string; icon: IconName; match: (p: string) => boolean }> = [
  { href: "/", label: "Home", icon: "home", match: (p) => p === "/" },
  { href: "/songs", label: "My Songs", icon: "library", match: (p) => p.startsWith("/songs") || p.startsWith("/song") },
  { href: "/add", label: "Add Song", icon: "plus", match: (p) => p.startsWith("/add") },
  { href: "/studio", label: "Practice Studio", icon: "studio", match: (p) => p.startsWith("/studio") || p.startsWith("/tuner") || p.startsWith("/align") || p.startsWith("/calibrate") },
  { href: "/progress", label: "Progress", icon: "chart", match: (p) => p.startsWith("/progress") || p.startsWith("/report") },
  { href: "/settings", label: "Settings", icon: "settings", match: (p) => p.startsWith("/settings") },
];

function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg" aria-label="GuitarCoach home">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--accent-wash)" stroke="var(--accent-line)" />
        {[9, 14, 19, 24].map((x) => (
          <line key={x} x1={x} y1="7" x2={x} y2="25" stroke="var(--text-3)" strokeWidth="1" />
        ))}
        <line x1="7" y1="13" x2="26" y2="13" stroke="var(--text-3)" strokeWidth="1" />
        <circle cx="14" cy="16.5" r="2.6" fill="var(--accent)" />
        <circle cx="19" cy="20.5" r="2.6" fill="var(--accent)" />
      </svg>
      {!compact && <span className="chord-face text-[21px] tracking-tight text-text">GuitarCoach</span>}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const online = useOnline();
  const [settings] = useSettings();
  const immersive = pathname.startsWith("/studio") || pathname.startsWith("/tuner");
  const calibration = useLiveQuery(getCalibration, []);
  const account = useAccount();

  useEffect(() => startAccount(), []);
  useEffect(() => setGetReadySeconds(settings.getReadySec), [settings.getReadySec]);

  // Apply the player's personal chord templates everywhere chords are judged.
  useEffect(() => {
    const takes = calibration.status === "ready" ? calibration.data.takes : [];
    setPersonalProfile(settings.usePersonalCalibration && takes.length ? buildProfile(takes) : null);
  }, [calibration, settings.usePersonalCalibration]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme === "light" ? "light" : "dark";
  }, [settings.theme]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is optional */
    });
  }, []);

  return (
    <div className="min-h-dvh flex">
      <GetReadyOverlay />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 bg-surface px-3 py-2 rounded-lg">
        Skip to content
      </a>
      <nav
        aria-label="Main"
        className={cx(
          "hidden md:flex flex-col shrink-0 border-r border-line-soft bg-bg sticky top-0 h-dvh",
          immersive ? "w-[68px] items-center py-4" : "w-[228px] px-3 py-5",
        )}
      >
        <div className={cx(immersive ? "mb-6" : "px-2 mb-7")}>
          <Wordmark compact={immersive} />
        </div>
        <ul className="flex flex-col gap-0.5 w-full">
          {NAV.map((n) => {
            const active = n.match(pathname);
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  title={immersive ? n.label : undefined}
                  className={cx(
                    "flex items-center gap-3 rounded-lg transition-colors",
                    immersive ? "justify-center h-11 w-11 mx-auto" : "h-10 px-3",
                    active ? "bg-surface-2 text-text" : "text-text-2 hover:text-text hover:bg-surface",
                  )}
                >
                  <Icon name={n.icon} size={19} className={active ? "text-accent" : undefined} />
                  {!immersive && <span className="text-[15px]">{n.label}</span>}
                  {immersive && <span className="sr-only">{n.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className={cx("mt-auto flex flex-col gap-1 w-full", immersive && "items-center")}>
          {!online && (
            <div className={cx("flex items-center gap-2 text-sm text-warn h-8", immersive ? "justify-center" : "px-3")} role="status">
              <Icon name="wifiOff" size={17} />
              {!immersive && <span>Offline</span>}
            </div>
          )}
          <AccountLink account={account} compact={immersive} online={online} />
        </div>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden flex items-center justify-between px-4 h-14 border-b border-line-soft sticky top-0 z-30 bg-bg/95 backdrop-blur">
          <Wordmark />
          <div className="flex items-center gap-1">
            {!online && (
              <span className="text-warn text-sm flex items-center gap-1" role="status">
                <Icon name="wifiOff" size={16} /> Offline
              </span>
            )}
            <AccountLink account={account} compact online={online} />
            <Link href="/settings" aria-label="Settings" className="h-10 w-10 inline-flex items-center justify-center text-text-2 rounded-lg">
              <Icon name="settings" size={20} />
            </Link>
          </div>
        </div>
        <main id="main" className="flex-1 min-w-0 pb-20 md:pb-0">
          {children}
        </main>
      </div>

      <nav aria-label="Main" className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line-soft bg-bg/95 backdrop-blur">
        <ul className="grid grid-cols-5">
          {NAV.slice(0, 5).map((n) => {
            const active = n.match(pathname);
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cx("flex flex-col items-center justify-center h-16 gap-0.5 text-[11px]", active ? "text-accent" : "text-text-3")}
                >
                  <Icon name={n.icon} size={21} />
                  <span>{n.label.replace("Practice ", "").replace("My ", "")}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
