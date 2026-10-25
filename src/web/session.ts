import type { IncomingMessage } from "node:http";
import cookieSession from "cookie-session";
import type { RequestHandler } from "express";
import type { Config } from "../config.js";
import type { SessionUser } from "../shared/types.js";

/**
 * Who is logged in, stored in a signed cookie. Only the user's id, name and avatar are kept: no Discord token,
 * because the bot checks servers and roles itself (src/permissions.ts). The signature (SESSION_SECRET) stops
 * anyone from editing the cookie, and keeping it in a cookie means logins survive bot restarts.
 */
interface SessionData {
  user?: SessionUser;
  /** A random value that ties the OAuth callback to the login that started it (see routes/auth.ts). */
  oauthState?: string;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function createSessionMiddleware(config: Config): RequestHandler {
  return cookieSession({
    name: "session",
    keys: [config.SESSION_SECRET],
    maxAge: THIRTY_DAYS_MS,
    httpOnly: true, // page scripts can't read it
    sameSite: "lax", // other websites can't send it along with their requests
    secure: config.PUBLIC_URL.startsWith("https://"), // https-only once the site is public (milestone 9)
  });
}

/** The session of a request that went through the session middleware (Express or Socket.IO). */
export function sessionOf(req: IncomingMessage): SessionData {
  const session = (req as IncomingMessage & { session?: SessionData | null }).session;
  return session ?? {};
}

export function sessionUserOf(req: IncomingMessage): SessionUser | null {
  return sessionOf(req).user ?? null;
}
