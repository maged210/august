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
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "AUGUST" },
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
  themeColor: "#13151A",
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
    <html lang="en" className={`${mono.variable} ${sans.variable} ${geist.variable}`} suppressHydrationWarning>
      <head>
        {/* Set the theme + mood attributes before first paint so neither flashes. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              // THEME — matrix is the CORE V2 default stage; the toggle cycles
              // matrix → dark → light → gotham(batman) → matrix. One-time
              // migration (the house lightdefault precedent): every stored
              // theme is reset to matrix once so the new default actually
              // lands; an explicit re-pick after that is honored forever.
              // Unknown/absent values also resolve to matrix.
              // MOOD — orthogonal to the theme (it re-tints only the accent
              // family); same pre-paint contract so a saved mood boots without
              // a flash. A theme failure must not cost the mood, and vice versa,
              // so each resolves in its own try/catch with its own safe default.
              "(function(){var d=document.documentElement;" +
              "try{var f=localStorage.getItem('aug-theme-matrixdefault');var t=localStorage.getItem('aug-theme');if(!f){localStorage.setItem('aug-theme-matrixdefault','1');t='matrix';localStorage.setItem('aug-theme','matrix');}d.setAttribute('data-theme',t==='dark'?'dark':t==='batman'?'batman':t==='light'?'light':'matrix');}catch(e){d.setAttribute('data-theme','matrix');}" +
              "try{var m=localStorage.getItem('aug-mood');d.setAttribute('data-mood',m==='ember'||m==='phosphor'||m==='graphite'?m:'steel');}catch(e){d.setAttribute('data-mood','steel');}" +
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
