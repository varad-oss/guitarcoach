import type { Metadata } from "next";
import { Tuner } from "@/components/pages/Tuner";

export const metadata: Metadata = { title: "Tuner" };

export default function TunerPage() {
  return <Tuner />;
}
