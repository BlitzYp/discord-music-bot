import { randomBytes } from "node:crypto";
import { Router } from "express";
import type { Config } from "../../config.js";
import type { CurrentUser, SessionUser } from "../../shared/types.js";
import { isOwner } from "../access.js";
import { HttpError, route } from "../http.js";
import { sessionUserOf } from "../session.js";

const DISCORD_API = "https://discord.com/api/v10";

/**
 * "Log in with Discord" (OAuth2). The flow:
 * 1. GET /auth/login sends the browser to Discord's consent page, with a random `state` saved in the cookie.
 * 2. Discord sends the browser back to GET /auth/callback with a one-time `code` and the same `state`.
 * 3. The bot swaps the code for an access token, asks Discord who the user is, and stores that in the cookie.
 * Only the `identify` scope is requested: the bot looks up servers and roles itself.
 */
export function authRoutes(config: Config): Router {
  const router = Router();

  router.get("/auth/login", (req, res) => {
    const state = randomBytes(16).toString("hex");
    req.session!.oauthState = state;
    const params = new URLSearchParams({
      client_id: config.DISCORD_CLIENT_ID,
      redirect_uri: config.OAUTH_REDIRECT_URI,
      response_type: "code",
      scope: "identify",
      state,
      prompt: "none", // skip the consent screen if the user already allowed it before
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  router.get(
    "/auth/callback",
    route(async (req, res) => {
      const { code, state, error } = req.query;
      if (error) {
        // The user pressed "Cancel" on Discord's page (or Discord refused).
        res.redirect("/");
        return;
      }
      // `state` must match the one saved at login, so another site can't log the user in as someone else.
      if (typeof code !== "string" || typeof state !== "string" || state !== req.session!.oauthState) {
        throw new HttpError(400, "That login link is invalid or expired. Try logging in again.");
      }

      const accessToken = await exchangeCodeForToken(config, code);
      const user = await fetchDiscordUser(accessToken);
      req.session = { user }; // replaces the old session, dropping oauthState
      res.redirect("/");
    }),
  );

  router.post("/auth/logout", (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    const user = sessionUserOf(req);
    if (!user) {
      res.status(401).json({ error: "Not logged in." });
      return;
    }
    const me: CurrentUser = { ...user, isOwner: isOwner(user.id) };
    res.json(me);
  });

  return router;
}

async function exchangeCodeForToken(config: Config, code: string): Promise<string> {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.DISCORD_CLIENT_ID,
      client_secret: config.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.OAUTH_REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    console.error(`[web] Discord refused the login code: HTTP ${res.status} ${await res.text()}`);
    throw new HttpError(502, "Discord didn't accept the login. Check DISCORD_CLIENT_SECRET and OAUTH_REDIRECT_URI.");
  }
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

async function fetchDiscordUser(accessToken: string): Promise<SessionUser> {
  const res = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new HttpError(502, "Couldn't read your Discord profile. Try logging in again.");
  const user = (await res.json()) as { id: string; username: string; global_name: string | null; avatar: string | null };

  // Users without an avatar get one of Discord's default ones, picked from their id.
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
  return { id: user.id, name: user.global_name ?? user.username, avatarUrl };
}
