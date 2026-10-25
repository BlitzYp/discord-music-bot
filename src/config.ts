import "dotenv/config";
import { z } from "zod";

// Only the values milestone 1 needs are required; the web/OAuth ones become required in later milestones.
const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));

const schema = z.object({
  DISCORD_TOKEN: z.string().trim().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().trim().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_CLIENT_SECRET: optional,
  OAUTH_REDIRECT_URI: optional,
  OWNER_ID: optional,
  SESSION_SECRET: optional,
  PUBLIC_URL: optional,
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  LAVALINK_HOST: z.string().trim().default("localhost"),
  LAVALINK_PORT: z.coerce.number().int().positive().default(2333),
  LAVALINK_PASSWORD: z.string().trim().min(1, "LAVALINK_PASSWORD is required"),
  DEV_GUILD_ID: optional,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid .env:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
