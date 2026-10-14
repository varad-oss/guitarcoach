import type { Metadata } from "next";
import { Suspense } from "react";
import { Report } from "@/components/pages/Report";

export const metadata: Metadata = { title: "Session report" };

export default function ReportPage() {
  return (
    <Suspense>
      <Report />
    </Suspense>
  );
}
