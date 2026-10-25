import "dotenv/config";
import { z } from "zod";

const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));
const required = (name: string) => z.string().trim().min(1, `${name} is required`);

const schema = z
  .object({
    DISCORD_TOKEN: required("DISCORD_TOKEN"),
    DISCORD_CLIENT_ID: required("DISCORD_CLIENT_ID"),
    // For "Log in with Discord" on the website.
    DISCORD_CLIENT_SECRET: required("DISCORD_CLIENT_SECRET (Developer Portal → OAuth2 → Reset Secret)"),
    SESSION_SECRET: z
      .string()
      .trim()
      .min(32, "SESSION_SECRET must be a random string of at least 32 characters (see the README)"),
    /** The bot owner's Discord user id: can control every server and (later) the admin panel. */
    OWNER_ID: optional,
    WEB_PORT: z.coerce.number().int().positive().default(3000),
    /** Where people open the website. Defaults to http://localhost:<WEB_PORT>. */
    PUBLIC_URL: optional,
    /** Defaults to <PUBLIC_URL>/api/auth/callback. Must also be added in the Developer Portal under OAuth2 → Redirects. */
    OAUTH_REDIRECT_URI: optional,
    LAVALINK_HOST: z.string().trim().default("localhost"),
    LAVALINK_PORT: z.coerce.number().int().positive().default(2333),
    LAVALINK_PASSWORD: required("LAVALINK_PASSWORD"),
    DEV_GUILD_ID: optional,
  })
  .transform((env) => {
    const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${env.WEB_PORT}`).replace(/\/$/, "");
    return {
      ...env,
      PUBLIC_URL: publicUrl,
      OAUTH_REDIRECT_URI: env.OAUTH_REDIRECT_URI ?? `${publicUrl}/api/auth/callback`,
    };
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid .env:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
