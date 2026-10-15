import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Standalone server bundle for the Docker image (infra/Dockerfile.web).
  output: "standalone",
  outputFileTracingRoot: path.resolve(__dirname),
  // Pin Turbopack's workspace root to this app — silences the lockfile warning
  // when developing inside a parent that has its own package-lock.json.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Avoid bundling the heavy Prisma binary into route bundles.
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    // File uploads travel through server actions; default is 1 MB. Per-file
    // limits are enforced in lib/upload-validation.ts.
    serverActions: { bodySizeLimit: "60mb" },
  },
  poweredByHeader: false,
  async headers() {
    // Security headers for every response. Notes:
    //  - No full CSP on purpose: Next.js injects inline bootstrap scripts and the
    //    pdf.js worker/avatars (api.dicebear.com) need tuning; a wrong CSP breaks
    //    the app. Only `frame-ancestors` is set (clickjacking), which cannot
    //    affect script/style loading. File downloads add their own sandbox CSP
    //    (lib/upload-validation.ts downloadHeaders).
    //  - Nothing in the app is iframed (verified by grep), so SAMEORIGIN is safe.
    //  - Mic/geolocation are unused; clipboard-write IS used (copy-link buttons)
    //    so it is not restricted. Camera is blocked everywhere EXCEPT the kiosk
    //    (punch photos): the second rule below matches later, and when two rules
    //    set the same key the last one wins (Next docs, "Header Overriding").
    //  - HSTS is set by Caddy (infra/Caddyfile), which terminates TLS.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        // Same policy as above, but the kiosk may use its own camera.
        source: "/kiosk/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.dicebear.com",
      },
    ],
  },
};

export default nextConfig;
