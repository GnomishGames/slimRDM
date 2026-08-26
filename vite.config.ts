import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM == "darwin" ? "safari16" : "chrome105",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    rollupOptions: {
      output: {
        // Split the two large vendor groups out of the app chunk. Assets are
        // loaded from local disk, so this is about keeping each chunk under
        // Vite's size warning and letting the app chunk rebuild independently —
        // not about download size.
        manualChunks: {
          // Only addons the app actually imports: object-form manualChunks
          // values are entry modules, so an id that stops resolving is a hard
          // build failure — and one that only shows up in a production build.
          xterm: ["@xterm/xterm", "@xterm/addon-fit",
                  "@xterm/addon-web-links", "@xterm/addon-webgl"],
          react: ["react", "react-dom"],
        },
      },
    },
  },
}));
