import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { z } from "zod";
import { UserError } from "../player/errors.js";

/** An error with an HTTP status, e.g. 401 (not logged in), 403 (not allowed) or 404 (no such server). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Wraps an async route handler so errors become proper HTTP answers:
 * - HttpError: its status and message.
 * - UserError: 400 with its message (the user's mistake, or something they should know).
 * - anything else: 500, with the details in the console only.
 */
export function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    handler(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof UserError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error(`[web] ${req.method} ${req.originalUrl} failed:`, error);
      res.status(500).json({ error: "Something went wrong. Check the bot's console." });
    });
  };
}

/**
 * Refuses changes (POST, PATCH, DELETE) that aren't sent as JSON. Browsers only let a page send JSON to another
 * site after a CORS check, which this server never passes, so other websites can't make changes through a
 * logged-in user's browser. (The session cookie's `sameSite: "lax"` already blocks that; this is a second lock.)
 */
export const requireJsonForChanges: RequestHandler = (req, res, next) => {
  const isChange = req.method === "POST" || req.method === "PATCH" || req.method === "DELETE";
  if (isChange && !req.is("application/json")) {
    res.status(415).json({ error: "Send the request body as JSON." });
    return;
  }
  next();
};

/**
 * Checks a request body with a zod schema. A mistake becomes a 400 answer naming the setting, e.g.
 * "defaultVolume: Too big: expected number to be <=150".
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0]!;
  throw new UserError(issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message);
}
