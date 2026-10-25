import { Client, GatewayIntentBits } from "discord.js";

// No privileged intents: voice states are all the bot needs to find the requester's channel.
export function createClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
}
