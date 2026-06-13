/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project. Without this, Next infers the root
  // from a stray lockfile in the home directory and warns on every build.
  outputFileTracingRoot: import.meta.dirname,
  // Kill Next's dev-tools indicator. Its compile/HMR activity painted as a stray
  // pink line across the very top of the viewport (visible on surfaces without a
  // WebGL canvas covering it). Dev-only chrome — production never had it.
  devIndicators: false,
};

export default nextConfig;
