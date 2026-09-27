import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "USDT Verify | Allowance Spending",
  description: "BEP-20 USDT allowance security and execution dashboard.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "USDT Verify" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }