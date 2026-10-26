import { ActivityType, type Client, Events, type PresenceData } from "discord.js";
import type { SettingsStore } from "../db/settingsStore.js";
import type { PlayerManager } from "../player/PlayerManager.js";
import { type BotStatus, type BotStatusType, MAX_BOT_STATUS_LENGTH } from "../shared/settings.js";
import type { PlayerSnapshot } from "../shared/types.js";

/**
 * At most one status change per this many milliseconds. PlayerManager reports the position about once a second
 * while playing, and Discord limits how often a bot may send updates, so changes are gathered and sent together.
 */
const MIN_UPDATE_INTERVAL_MS = 5_000;

/** How each kind of status is sent to Discord. */
const ACTIVITY_TYPES: Record<BotStatusType, ActivityType> = {
  custom: ActivityType.Custom,
  listening: ActivityType.Listening,
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
};

/**
 * Keeps the bot's Discord status ("Listening to …", "Idle · /play to start") in step with what it's doing, or
 * shows the owner's fixed status (`statusOverride`, set on the Admin page) instead.
 */
export function registerPresence(client: Client, players: PlayerManager, settings: SettingsStore): void {
  /** What was sent last, as text, so an unchanged status isn't sent again. */
  let lastSent = "";
  let lastSentAt = 0;
  let pendingUpdate: NodeJS.Timeout | null = null;

  function sendNow(): void {
    pendingUpdate = null;
    if (!client.isReady()) return; // sent again once Discord is ready
    const { overridden: _overridden, ...status } = currentStatus(client, players, settings);
    const key = JSON.stringify(status);
    if (key === lastSent) return;

    client.user.setPresence(toPresence(status));
    lastSent = key;
    lastSentAt = Date.now();
  }

  /** Sends the status soon: right away if the last change was long enough ago, otherwise when it's allowed. */
  function scheduleUpdate(): void {
    if (pendingUpdate) return; // already coming; it reads the newest state when it runs
    const wait = Math.max(0, lastSentAt + MIN_UPDATE_INTERVAL_MS - Date.now());
    pendingUpdate = setTimeout(sendNow, wait);
  }

  client.on(Events.ClientReady, scheduleUpdate);
  players.on("queue:update", scheduleUpdate);
  players.on("player:update", scheduleUpdate);
  // The owner changed the fixed status (or cleared it) on the Admin page.
  settings.on("global:change", scheduleUpdate);
}

/**
 * The status the bot shows: the owner's fixed one if there is one, otherwise the automatic one. Also used by the
 * Admin page, to show what Discord shows right now.
 */
export function currentStatus(client: Client, players: PlayerManager, settings: SettingsStore): BotStatus & { overridden: boolean } {
  const override = settings.global().statusOverride;
  if (override) return { ...override, text: shorten(override.text), overridden: true };

  const states = [...client.guilds.cache.keys()].map((guildId) => players.getState(guildId));
  return { ...describe(states), overridden: false };
}

/**
 * The automatic status: every server's player summed up (a bot has one status for all its servers), the busiest
 * state first:
 * 1. playing: "Listening to <title – artist>", or "music in N servers" when it plays in several;
 * 2. paused: "⏸ Paused: <title>";
 * 3. stopped by a restart: "Waiting for /resume: <title>";
 * 4. in a voice channel with nothing to play: "Waiting for a song · /play";
 * 5. nowhere: "Idle · /play to start".
 */
export function describe(states: PlayerSnapshot[]): BotStatus {
  const playing = states.filter((state) => state.current && !state.paused && !state.interrupted);
  if (playing.length > 1) return { dot: "online", type: "listening", text: `music in ${playing.length} servers` };
  if (playing.length === 1) {
    const { title, author } = playing[0]!.current!;
    return { dot: "online", type: "listening", text: shorten(author ? `${title} – ${author}` : title) };
  }

  const paused = states.find((state) => state.current && state.paused && !state.interrupted);
  if (paused) return { dot: "online", type: "custom", text: shorten(`⏸ Paused: ${paused.current!.title}`) };

  const interrupted = states.find((state) => state.current && state.interrupted);
  if (interrupted) return { dot: "idle", type: "custom", text: shorten(`Waiting for /resume: ${interrupted.current!.title}`) };

  if (states.some((state) => state.voiceChannelId)) return { dot: "online", type: "custom", text: "Waiting for a song · /play" };
  return { dot: "idle", type: "custom", text: "Idle · /play to start" };
}

function toPresence({ dot, type, text }: BotStatus): PresenceData {
  const activity =
    type === "custom"
      ? // A custom status shows `state` on its own. Discord requires a `name` too, but doesn't show it.
        { type: ActivityType.Custom, name: "Custom Status", state: text }
      : { type: ACTIVITY_TYPES[type], name: text };
  return { status: dot, activities: [activity] };
}

function shorten(text: string): string {
  return text.length > MAX_BOT_STATUS_LENGTH ? `${text.slice(0, MAX_BOT_STATUS_LENGTH - 1)}…` : text;
}
