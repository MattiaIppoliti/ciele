import type { Metadata } from "next";
import { Sorts_Mill_Goudy, Host_Grotesk, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Brand wordmark ("Ciele"). Self-hosted Solitus (SIL OFL) — see
// src/fonts/Solitus-OFL.txt. Single style; italic is synthesized by the browser.
const solitus = localFont({
  src: "../fonts/Solitus.ttf",
  variable: "--font-solitus",
  display: "swap",
});

// Body / UI text.
const hostGrotesk = Host_Grotesk({
  variable: "--font-host-grotesk",
  subsets: ["latin"],
});

// Display / headings. Sorts Mill Goudy ships a single 400 weight (+ italic).
const sortsMillGoudy = Sorts_Mill_Goudy({
  variable: "--font-goudy",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ciele",
  description: "Admin superapp to create and manage AI assistants",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // next-themes sets the theme class on <html> before hydration (admin
      // shell only), so the server-rendered attribute won't match.
      suppressHydrationWarning
      className={`${hostGrotesk.variable} ${sortsMillGoudy.variable} ${solitus.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="app-backdrop h-screen overflow-hidden font-sans">
        {children}
        <Toaster richColors position="bottom-right" />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
