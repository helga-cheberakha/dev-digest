import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  // `src/vendor/shared/**` (hand-mirrored from the server) writes relative
  // imports/re-exports with an explicit `.js` extension, per the project's
  // ESM/TS convention (see server/INSIGHTS.md). tsc resolves this fine
  // ("moduleResolution": "Bundler"), but webpack's default resolver does
  // not map a written `.js` extension back to a `.ts`/`.tsx` source file —
  // it only ever surfaced once a client file needed a runtime VALUE (not
  // just an erased `import type`) from that barrel.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
