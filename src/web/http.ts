import type { NextFunction, Request, RequestHandler, Response } from "express";
import { UserError } from "../player/errors.js";

/**
 * Wraps an async route handler so errors become proper HTTP answers:
 * a UserError is the user's mistake or something they should know (400, with its message);
 * anything else is unexpected (500, details in the console only).
 */
export function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, _next: NextFunction) => {
    handler(req, res).catch((error: unknown) => {
      if (error instanceof UserError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error(`[web] ${req.method} ${req.originalUrl} failed:`, error);
      res.status(500).json({ error: "Something went wrong. Check the bot's console." });
    });
  };
}
