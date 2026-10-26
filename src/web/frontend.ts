import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type Express } from "express";
import { isLocalRequest } from "./requests.js";

/** The React app's folder (web/), from both src/web/ and the compiled dist/web/. */
const WEB_ROOT = resolve(import.meta.dirname, "../../web");

/**
 * Serves the React website.
 * - Running from TypeScript source (`npm run dev`): Vite runs inside this server, so edits to web/ show up
 *   in the browser immediately. Only for this computer: Vite's development server can hand out the project's
 *   files, so the public URL shows a message saying to run the built website (`npm start`) instead.
 * - Running the compiled build (`npm start`): the files Vite built into web/dist are served as they are.
 */
export async function serveFrontend(app: Express): Promise<void> {
  const runningFromSource = import.meta.filename.endsWith(".ts");
  if (runningFromSource) {
    // Imported only here, so the compiled build never needs Vite.
    const { createServer } = await import("vite");
    const vite = await createServer({
      configFile: join(WEB_ROOT, "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use((req, res, next) => {
      if (isLocalRequest(req)) return next();
      res
        .status(503)
        .send("The bot's website is running in development mode, which only works on the bot's own computer. Ask the owner to run it with npm start.");
    });
    app.use(vite.middlewares);
    return;
  }

  const distDir = join(WEB_ROOT, "dist");
  const indexHtml = join(distDir, "index.html");
  if (!existsSync(indexHtml)) {
    app.use((_req, res) => {
      res.status(503).send("The website hasn't been built yet. Run: npm run build");
    });
    return;
  }

  app.use(express.static(distDir));
  // Any other page (the app handles its own URLs) gets index.html.
  app.use((_req, res) => res.sendFile(indexHtml));
}
