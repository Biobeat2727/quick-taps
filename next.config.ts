import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Lets a phone on the LAN load dev assets (e.g. http://192.168.4.27:3000)
  allowedDevOrigins: ['192.168.4.27'],
  // Prevent webpack from trying to bundle Rapier WASM — load natively in Node.js
  serverExternalPackages: ['@dimforge/rapier3d-compat'],
};

export default nextConfig;
