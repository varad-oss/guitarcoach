import type { Metadata } from "next";
import { SongsLibrary } from "@/components/pages/SongsLibrary";

export const metadata: Metadata = { title: "My Songs" };

export default function SongsPage() {
  return <SongsLibrary />;
}
