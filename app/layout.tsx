import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Inter, Geist } from "next/font/google";
import "./globals.css";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// The home landing's face (docs/design/AUGUST Home.dc.html) — scoped to the
// landing via --font-geist; the rest of the app keeps Inter + JetBrains Mono.
const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist",
  display: "swap",
});

// metadataBase makes the OG image URL absolute when the link is unfurled. Set it
// ONLY when NEXT_PUBLIC_SITE_URL is configured: an explicit value beats Next's
// built-in Vercel fallback (VERCEL_PROJECT_PRODUCTION_URL), so hardcoding a
// localhost default would ship localhost og:image URLs to production.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const TAGLINE = "A private intelligence companion.";

export const metadata: Metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: "AUGUST",
  description: TAGLINE,
  applicationName: "AUGUST",
  // feat/v4-2-today — the stage is paper: "default" gives the installed PWA a
  // light status bar with dark text. ("black-translucent" drew WHITE status
  // text over the paper stage — unreadable.)
  appleWebApp: { capable: true, statusBarStyle: "default", title: "AUGUST" },
  openGraph: {
    title: "AUGUST",
    description: TAGLINE,
    siteName: "AUGUST",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AUGUST",
    description: TAGLINE,
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f5f7", // the paper stage (--paper-stage): browser + PWA chrome match the page
  width: "device-width",
  initialScale: 1,
  // No maximumScale — pinch-zoom must stay available (a11y). Inputs are ≥16px,
  // so iOS won't auto-zoom on focus anyway.
  viewportFit: "cover", // draw under notches; safe-area insets handle the rest
  // Browsers that support it resize the layout viewport for the on-screen
  // keyboard (Android Chrome) — in-flow inputs (the command bar) stay visible.
  // iOS overlays instead and scrolls the focused input into view natively.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // ONE THEME (feat/v4-2-today, DESIGN_LAWS L1): the paper stage is set on
    // the server-rendered <html> — no pre-paint choice, no flash. The attribute
    // stays because the terminal's paper block keys on it. The theme menu, the
    // mood axis and the rain dial are retired (tag archive/theme-menu).
    <html
      lang="en"
      data-theme="light"
      className={`${mono.variable} ${sans.variable} ${geist.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Pre-paint: the rail's persisted collapse (below) — plus a one-time
            sweep of the retired theme / mood / rain preferences, so no stale
            key lingers in a visitor's storage. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var d=document.documentElement;" +
              "try{['aug-theme','aug-theme-paperdefault','aug-mood','aug-rain-level'].forEach(function(k){localStorage.removeItem(k);});}catch(e){}" +
              // RAIL (UX1) — a persisted collapse must apply before first paint,
              // exactly like the theme, or the sidebar flashes open then slides shut.
              "try{if(localStorage.getItem('aug-rail')==='collapsed'){d.setAttribute('data-rail','collapsed');}}catch(e){}" +
              "})();",
          }}
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
