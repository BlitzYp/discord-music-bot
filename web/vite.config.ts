import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The website's build setup. In development, src/web/frontend.ts runs this inside the bot's web server.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
