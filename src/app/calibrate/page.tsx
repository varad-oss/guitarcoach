import type { Metadata } from "next";
import { Calibrate } from "@/components/pages/Calibrate";

export const metadata: Metadata = { title: "Chord calibration" };

export default function Page() {
  return <Calibrate />;
}
