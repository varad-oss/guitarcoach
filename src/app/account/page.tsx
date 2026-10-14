import type { Metadata } from "next";
import { AccountPage } from "@/components/pages/Account";

export const metadata: Metadata = { title: "Account" };

export default function Page() {
  return <AccountPage />;
}
