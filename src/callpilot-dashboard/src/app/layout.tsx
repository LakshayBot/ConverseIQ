import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata: Metadata = {
  title: "CallPilot AI Dashboard",
  description: "Real-Time AI Sales Intelligence Platform",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the landing's theme bootstrap sets
    // data-theme on <html> before hydration; React must not treat it
    // as a mismatch.
    <html lang="en" suppressHydrationWarning>
      <body className="bg-gray-50 min-h-screen">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
