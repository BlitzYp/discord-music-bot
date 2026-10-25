import type { Server as HttpServer } from "node:http";
import type { RequestHandler } from "express";
import { Server } from "socket.io";
import { getPermissionLevel } from "../permissions.js";
import { summarizeError } from "../player/errors.js";
import type { ClientToServerEvents, PlayerSnapshot, PlayerStatus, ServerToClientEvents } from "../shared/types.js";
import type { WebContext } from "./server.js";
import { sessionUserOf } from "./session.js";

/** Each server's updates go to its own Socket.IO room, so a browser only receives the server it's watching. */
const roomFor = (guildId: string) => `guild:${guildId}`;

/**
 * Live updates for the website. The browser says which server it's watching ("guild:watch"); after checking
 * that the logged-in user is a member there, every PlayerManager event for that server is pushed to it.
 * Sockets only push updates: changes go through the REST API, so permissions are checked in one place.
 */
export function attachSocket(httpServer: HttpServer, { client, players, settings }: WebContext, session: RequestHandler): void {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  // Runs the session middleware on the socket's opening request, so we know who is connected.
  io.engine.use(session);

  io.on("connection", (socket) => {
    socket.on("guild:watch", async (guildId) => {
      const user = sessionUserOf(socket.request);
      const guild = typeof guildId === "string" ? client.guilds.cache.get(guildId) : undefined;
      if (!user || !guild) return;
      const level = await getPermissionLevel(guild, user.id, settings);
      if (!level) return; // not a member of that server

      for (const room of socket.rooms) {
        if (room.startsWith("guild:")) void socket.leave(room);
      }
      void socket.join(roomFor(guild.id));
      socket.emit("state", players.getState(guild.id));
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
