import type { Metadata } from "next";
import { Suspense } from "react";
import { SongDetail } from "@/components/pages/SongDetail";

export const metadata: Metadata = { title: "Song" };

export default function SongPage() {
  return (
    <Suspense>
      <SongDetail />
    </Suspense>
  );
}
