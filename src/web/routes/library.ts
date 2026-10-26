import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { type Request, type Response, Router } from "express";
import multer from "multer";
import type { LibraryManager } from "../../library/LibraryManager.js";
import { INCOMING_DIR } from "../../library/paths.js";
import { UserError } from "../../player/errors.js";
import { formatBytes } from "../../shared/library.js";
import { requireGuildAccess } from "../access.js";
import { HttpError, route } from "../http.js";
import type { WebContext } from "../server.js";

/**
 * The website's Library tab. Like the other routes, each one checks permission, reads its input and calls
 * LibraryManager, which holds the rules (sizes, the quota, checking and converting files).
 *
 * Everyone may look. Uploading follows the server's `uploadPermission` setting; deleting needs a DJ. Neither
 * controls playback, so the server's `requireSameVoiceChannel` setting doesn't apply. Queuing a library file is
 * `POST /guilds/:id/queue { fileId }` (src/web/routes/player.ts).
 */
export function libraryRoutes({ client, library, settings }: WebContext): Router {
  const router = Router();
  const ctx = { client, settings };
  const notPlayback = { controlsPlayback: false };

  router.get(
    "/guilds/:id/library",
    route(async (req, res) => {
      const { guild } = await requireGuildAccess(req, ctx, "member");
      res.json(library.overview(guild.id));
    }),
  );

  // A multipart upload with one file in the field "file". The website also sends UPLOAD_HEADER (see src/web/http.ts).
  router.post(
    "/guilds/:id/library",
    route(async (req, res) => {
      const { guild, user, level } = await requireGuildAccess(req, ctx, "member", notPlayback);
      // Checked before receiving anything, so nobody uploads a big file only to be told they may not.
      library.checkCanUpload(guild.id, level);

      const upload = await receiveUpload(req, res, library);
      const file = await library.addFile(guild.id, upload.path, upload.originalName, { id: user.id, name: user.name });
      res.json(file);
    }),
  );

  router.delete(
    "/guilds/:id/library/:fileId",
    route(async (req, res) => {
      const { guild, user } = await requireGuildAccess(req, ctx, "dj", notPlayback);
      const file = await library.delete(guild.id, req.params.fileId as string);
      console.log(`[web] ${user.name} deleted "${file.title}" from the library of "${guild.name}"`);
      res.json(library.overview(guild.id));
    }),
  );

  return router;
}

/**
 * Receives an upload into the incoming folder with multer, stopping at the owner's `maxUploadMb`. Returns where it
 * was saved and the name it was uploaded with. multer deletes a half-received file itself when it stops.
 */
function receiveUpload(req: Request, res: Response, library: LibraryManager): Promise<{ path: string; originalName: string }> {
  const maxBytes = library.maxUploadBytes();
  const receive = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, done) => {
        mkdir(INCOMING_DIR, { recursive: true }).then(
          () => done(null, INCOMING_DIR),
          (error: Error) => done(error, INCOMING_DIR),
        );
      },
      // A random name: the uploaded name is never used as a path.
      filename: (_req, _file, done) => done(null, randomUUID()),
    }),
    limits: { fileSize: maxBytes, files: 1, fields: 0 },
  }).single("file");

  return new Promise((resolve, reject) => {
    receive(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          return reject(new HttpError(413, `That file is too big: files can be at most ${formatBytes(maxBytes)}.`));
        }
        return reject(new UserError(`Upload one file at a time, in the field "file" (${error.message}).`));
      }
      if (error) return reject(error);
      if (!req.file) return reject(new UserError("Choose a file to upload."));
      resolve({ path: req.file.path, originalName: decodeFileName(req.file.originalname) });
    });
  });
}

/**
 * Browsers send the file's name as UTF-8, but multer reads it as Latin-1, so "Café.mp3" arrives as "CafÃ©.mp3".
 * Reading the same bytes again as UTF-8 undoes that.
 */
function decodeFileName(name: string): string {
  return Buffer.from(name, "latin1").toString("utf8");
}
