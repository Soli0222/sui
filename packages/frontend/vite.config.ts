import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeManifestIcons: true,
      manifest: {
        name: "sui - 可処分資産予測",
        short_name: "sui",
        description: "可処分資産の残高予測を管理するアプリ",
        theme_color: "#0d111c",
        background_color: "#0d111c",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
        navigateFallback: "index.html",
        navigateFallbackAllowlist: [/^\/(?!api\/).*/],
        runtimeCaching: [
          {
            urlPattern: ({ request, sameOrigin, url }) =>
              sameOrigin &&
              !url.pathname.startsWith("/api/") &&
              ["font", "image", "manifest", "script", "style"].includes(request.destination),
            handler: "CacheFirst",
            options: {
              cacheName: "sui-static-assets",
              expiration: {
                maxAgeSeconds: 60 * 60 * 24 * 30,
                maxEntries: 120,
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        navigateFallbackAllowlist: [/^\/(?!api\/).*/],
        suppressWarnings: true,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
