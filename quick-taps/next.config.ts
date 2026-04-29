import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Prevent webpack from trying to bundle Rapier WASM — load natively in Node.js
  serverExternalPackages: ['@dimforge/rapier3d-compat'],
};

export default nextConfig;
