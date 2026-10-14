import type { Metadata } from "next";
import { Progress } from "@/components/pages/Progress";

export const metadata: Metadata = { title: "Progress" };

export default function ProgressPage() {
  return <Progress />;
}
