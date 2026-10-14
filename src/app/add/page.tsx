import type { Metadata } from "next";
import { Suspense } from "react";
import { AddSong } from "@/components/import/AddSong";

export const metadata: Metadata = { title: "Add a song" };

export default function AddPage() {
  return (
    <Suspense>
      <AddSong />
    </Suspense>
  );
}
