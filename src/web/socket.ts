import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { summarizeError } from "../player/errors.js";
import type { ClientToServerEvents, PlayerSnapshot, PlayerStatus, ServerToClientEvents } from "../shared/types.js";
import type { WebContext } from "./server.js";

/** Each server's updates go to its own Socket.IO room, so a browser only receives the server it's watching. */
const roomFor = (guildId: string) => `guild:${guildId}`;

/**
 * Live updates for the website. The browser says which server it's watching ("guild:watch"); from then on
 * every PlayerManager event for that server is pushed to it. Sockets only push updates: changes (from
 * milestone 5) go through the REST API, so permissions are checked in one place.
 */
export function attachSocket(httpServer: HttpServer, { client, players }: WebContext): void {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

  io.on("connection", (socket) => {
    socket.on("guild:watch", (guildId) => {
      // Milestone 5: also check that the logged-in user is a member of this server.
      if (typeof guildId !== "string" || !client.guilds.cache.has(guildId)) return;

      for (const room of socket.rooms) {
        if (room.startsWith("guild:")) void socket.leave(room);
      }
      void socket.join(roomFor(guildId));
      socket.emit("state", players.getState(guildId));
    });
  });

  players.on("queue:update", (guildId, state) => io.to(roomFor(guildId)).emit("queue:update", state));
  players.on("player:update", (guildId, state) => io.to(roomFor(guildId)).emit("player:update", toStatus(state)));
  players.on("track:start", (guildId, item) => io.to(roomFor(guildId)).emit("track:start", item));
  players.on("track:end", (guildId, item, reason) => io.to(roomFor(guildId)).emit("track:end", item, reason));
  players.on("error", (guildId, item, error) => {
    const reason = summarizeError(error instanceof Error ? error.message : String(error));
    const message = item ? `Couldn't play "${item.title}": ${reason}` : `Playback error: ${reason}`;
    io.to(roomFor(guildId)).emit("error", message);
  });
}

function toStatus({ positionMs, paused, volume, loopMode, filter }: PlayerSnapshot): PlayerStatus {
  return { positionMs, paused, volume, loopMode, filter };
}
