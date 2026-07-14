import type { NextConfig } from "next";
const isGitHubPages = process.env.GITHUB_PAGES === "true";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ||
      (isGitHubPages ? "https://leadfindersitora.nl" : "http://localhost:3001"),
    NEXT_PUBLIC_STATIC_EXPORT: isGitHubPages ? "true" : "false",
  },
  ...(isGitHubPages
    ? {
        output: "export",
        basePath: process.env.GITHUB_PAGES_BASE_PATH || "",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};
export default nextConfig;
