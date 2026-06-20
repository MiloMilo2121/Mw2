import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Live Dashboard — Instantly",
  description: "Real-time outbound analytics dashboard powered by Instantly.ai",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
