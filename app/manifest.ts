import type { MetadataRoute } from "next";

// Web app manifest (App Router file convention). Next serves this at
// /manifest.webmanifest and auto-injects <link rel="manifest"> into <head> — do
// NOT also set metadata.manifest in layout.tsx (that would double-link it).
//
// display:"standalone" is what makes AUGUST installable to the iPhone home screen
// (and, per iOS 16.4+, what unlocks web push at all — push only works from the
// INSTALLED standalone PWA, never a Safari tab). Icons point at stable Route
// Handlers (/icon-192, /icon-512, /icon-maskable) rather than the hashed metadata
// icon routes, so the manifest src URLs never drift.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AUGUST",
    short_name: "AUGUST",
    description: "A private intelligence companion.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png" },
      { src: "/icon-512", sizes: "512x512", type: "image/png" },
      // Maskable: Android/adaptive launchers crop to a platform shape; the orb sits
      // in the central safe zone so it's never clipped.
      { src: "/icon-maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
