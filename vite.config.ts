import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "icon-maskable-512.png"],
      manifest: {
        name: "myAnalyst",
        short_name: "myAnalyst",
        description: "NSE equity valuation on Brian's own model.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#F7FAF8",
        theme_color: "#237352",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
        // pdf.js and its worker are 1.7 MB between them and most sessions
        // never open a PDF. Both stay out of the precache and are cached the
        // first time one is read: installing the app stays a small download,
        // and after one PDF the reader works offline like everything else.
        globIgnores: ["**/pdf.worker*", "**/assets/pdf-*"],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/pdf[-.].*\.m?js$/,
            handler: "CacheFirst",
            options: { cacheName: "pdf-reader", expiration: { maxEntries: 4 } },
          },
        ],
        // The shell is precached, so the app opens with no network. Prices are
        // never cached here: they are private data and belong in the store.
        navigateFallback: "index.html",
      },
    }),
  ],
});
