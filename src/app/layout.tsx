import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Barlow_Semi_Condensed } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

const ui = Atkinson_Hyperlegible_Next({ variable: "--font-ui", subsets: ["latin"], display: "swap" });
const code = Atkinson_Hyperlegible_Mono({ variable: "--font-code", subsets: ["latin"], display: "swap" });
const chordFace = Barlow_Semi_Condensed({ variable: "--font-chordface", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "GuitarCoach", template: "%s · GuitarCoach" },
  description: "Your personal guitar practice studio: import songs, play along, and get feedback from your actual playing.",
  applicationName: "GuitarCoach",
  appleWebApp: { capable: true, title: "GuitarCoach", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#1d1f21",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${ui.variable} ${code.variable} ${chordFace.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
