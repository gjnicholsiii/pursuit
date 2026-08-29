/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Scribe OCR ships a platform-specific native canvas binding. Route handlers are
  // Node-only, so let Node resolve the package at runtime instead of asking webpack
  // to parse the .node binary into the server bundle.
  serverExternalPackages: [
    "scribe.js-ocr",
    "@scribe.js/canvas",
    "@scribe.js/canvas-linux-x64-gnu",
  ],
};

export default nextConfig;
