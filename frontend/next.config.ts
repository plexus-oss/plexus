import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// X-Frame-Options DENY everywhere EXCEPT /embed/* — published embeds are meant
// to be iframed on customers' sites (gated by the durable token + verified
// origins). The negative-lookahead source excludes only /embed/ paths.
const frameGuard = [{ key: "X-Frame-Options", value: "DENY" }];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/((?!embed/).*)", headers: frameGuard },
    ];
  },
  images: {
    remotePatterns: [
      {
        // Retained post-Clerk: users backfilled from Clerk still have
        // img.clerk.com avatar URLs (no avatar re-upload yet). Remove only
        // after those image_urls are re-hosted or cleared, or avatars break.
        protocol: "https",
        hostname: "img.clerk.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
  // @huggingface/transformers + onnxruntime-node: native binaries — must load
  // from node_modules at runtime, not be bundled (Lab's local embedder).
  serverExternalPackages: [
    "ssh2",
    "pg",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
};

export default nextConfig;
