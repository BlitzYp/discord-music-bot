import { useEffect, useState } from "react";
import type { PlayerSnapshot, PlayerStatus } from "./shared";
import { socket } from "./socket";

export interface GuildState {
  /** The latest state from the bot, or null until the first one arrives. */
  snapshot: PlayerSnapshot | null;
  /** When `snapshot.positionMs` was received, so the progress bar can keep moving between updates. */
  receivedAt: number;
  /** The latest playback error, cleared after a few seconds. */
  error: string | null;
  /** Whether the live connection to the bot is up. */
  connected: boolean;
}

const ERROR_SHOWN_FOR_MS = 10_000;

/** Subscribes to a server's live playback state over Socket.IO. */
export function useGuildState(guildId: string | null): GuildState {
  const [snapshot, setSnapshot] = useState<PlayerSnapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    // The socket may have connected after the first render but before these listeners existed.
    setConnected(socket.connected);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  useEffect(() => {
    setSnapshot(null);
    if (!guildId) return;

    // Ask for this server's updates now, and again after every reconnect (e.g. when the bot restarted).
    const watch = () => socket.emit("guild:watch", guildId);
    const onFullState = (state: PlayerSnapshot) => {
      setSnapshot(state);
      setReceivedAt(Date.now());
    };
    const onStatus = (status: PlayerStatus) => {
      setSnapshot((previous) => (previous ? { ...previous, ...status } : previous));
      setReceivedAt(Date.now());
    };
    let errorTimer: ReturnType<typeof setTimeout> | undefined;
    const onError = (message: string) => {
      setError(message);
      clearTimeout(errorTimer);
      errorTimer = setTimeout(() => setError(null), ERROR_SHOWN_FOR_MS);
    };

    socket.on("connect", watch);
    socket.on("state", onFullState);
    socket.on("queue:update", onFullState);
    socket.on("player:update", onStatus);
    socket.on("error", onError);
    if (socket.connected) watch();

    return () => {
      socket.off("connect", watch);
      socket.off("state", onFullState);
      socket.off("queue:update", onFullState);
      socket.off("player:update", onStatus);
      socket.off("error", onError);
      clearTimeout(errorTimer);
    };
  }, [guildId]);

  return { snapshot, receivedAt, error, connected };
}
