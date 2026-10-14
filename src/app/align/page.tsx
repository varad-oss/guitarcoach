import type { Metadata } from "next";
import { Suspense } from "react";
import { AlignPage } from "@/components/pages/AlignEditor";

export const metadata: Metadata = { title: "Align timing" };

export default function Page() {
  return (
    <Suspense>
      <AlignPage />
    </Suspense>
  );
}
