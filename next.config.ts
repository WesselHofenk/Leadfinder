import type { NextConfig } from "next";
const isGitHubPages = process.env.GITHUB_PAGES === "true";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(isGitHubPages
    ? {
        output: "export",
        basePath: process.env.GITHUB_PAGES_BASE_PATH || "",
        images: { unoptimized: true },
      }
    : {}),
};
export default nextConfig;
