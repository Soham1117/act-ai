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
