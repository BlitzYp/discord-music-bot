import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./shared";

/** The one Socket.IO connection to the bot. It reconnects by itself if the bot restarts. */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();
