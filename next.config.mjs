/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project. Without this, Next infers the root
  // from a stray lockfile in the home directory and warns on every build.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
