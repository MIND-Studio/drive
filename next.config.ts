import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone/server.js) for the prod
  // Docker image — see Dockerfile + .github/workflows/release.yml.
  output: "standalone",
  transpilePackages: ["@mind-studio/core", "@mind-studio/ui"],
};

export default nextConfig;
