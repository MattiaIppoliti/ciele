import type { Metadata, Viewport } from "next";
import { Sorts_Mill_Goudy, Host_Grotesk, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { AuthHintScript } from "@/components/auth-hint-script";
import { ThemeScript } from "@/components/theme-script";
import { CookieConsent } from "@/components/cookie-consent/cookie-consent";
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

/**
 * The console is a full-height app, not a scrolling document: it must fill the
 * *visible* viewport on a phone (where the URL bar steals height — hence `dvh`
 * on the body) and paint under the notch/home indicator rather than letterbox
 * itself. `maximumScale` is deliberately left at the default so pinch-zoom
 * keeps working — the reason iOS zooms a focused input is font size, and the
 * form primitives use 16px on touch instead (see `globals.css`).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
      {/* `h-dvh`, not `h-screen`: on iOS/Android `100vh` is the *largest*
          viewport (URL bar hidden), so a `h-screen` app shell hides its own
          bottom row behind the browser chrome until the user scrolls. */}
      <body className="app-backdrop h-dvh overflow-hidden font-sans">
        {/* Both must stay in the root layout — see theme-script.tsx. */}
        <ThemeScript />
        <AuthHintScript />
        {children}
        <Toaster richColors position="bottom-right" />
        {/* Owns the consent banner *and* the Vercel analytics scripts, which it
            renders only once the visitor has allowed the analytics category —
            see components/cookie-consent/cookie-consent-ui.tsx. Mounting the
            trackers here unconditionally is what the banner exists to prevent. */}
        <CookieConsent />
      </body>
    </html>
  );
}
