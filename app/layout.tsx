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
  maximumScale: 1,
  viewportFit: "cover", // draw under notches; safe-area insets handle the rest
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
              // THEME — light is the default stage; the toggle cycles
              // light → gotham(batman) → dark. One-time migration: a previously
              // stored 'dark' (the old default) is reset to light once; an
              // explicit re-pick of dark/gotham after that is honored forever.
              // MOOD — orthogonal to the theme (it re-tints only the accent
              // family); same pre-paint contract so a saved mood boots without
              // a flash. A theme failure must not cost the mood, and vice versa,
              // so each resolves in its own try/catch with its own safe default.
              "(function(){var d=document.documentElement;" +
              "try{var f=localStorage.getItem('aug-theme-lightdefault');var t=localStorage.getItem('aug-theme');if(!f){localStorage.setItem('aug-theme-lightdefault','1');if(t==='dark'){t='light';localStorage.setItem('aug-theme','light');}}d.setAttribute('data-theme',t==='dark'?'dark':t==='batman'?'batman':'light');}catch(e){d.setAttribute('data-theme','light');}" +
              "try{var m=localStorage.getItem('aug-mood');d.setAttribute('data-mood',m==='ember'||m==='phosphor'||m==='graphite'?m:'steel');}catch(e){d.setAttribute('data-mood','steel');}" +
              "})();",
          }}
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
