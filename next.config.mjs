/** @type {import('next').NextConfig} */
const nextConfig = {
  // The contract schemas are read from disk at runtime, so keep them out of
  // any bundling assumptions.
  outputFileTracingIncludes: {
    "/api/**": ["./contracts/**"],
  },
};

export default nextConfig;
