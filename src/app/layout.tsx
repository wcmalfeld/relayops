import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/app/toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RelayOps", template: "%s | RelayOps" },
  description: "AI-assisted operations for small businesses, with human approval for every consequential action.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f5f7f6" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
