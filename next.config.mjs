/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project. Without this, Next infers the root
  // from a stray lockfile in the home directory and warns on every build.
  outputFileTracingRoot: import.meta.dirname,
  // Kill Next's dev-tools indicator. Its compile/HMR activity painted as a stray
  // pink line across the very top of the viewport (visible on surfaces without a
  // WebGL canvas covering it). Dev-only chrome — production never had it.
  devIndicators: false,
  // CORE V2 — retired-surface bookmarks. The globe/feeds/mail surfaces never
  // had these routes in this codebase generation, but old links may exist in
  // the wild; /intel and /feed redirect via their own page stubs (they carry
  // the ?view=terminal target).
  async redirects() {
    return [
      { source: "/globe", destination: "/", permanent: true },
      { source: "/feeds", destination: "/", permanent: true },
      { source: "/mail", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
