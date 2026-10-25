import { play } from "./play.js";
import { queue } from "./queue.js";
import { skip } from "./skip.js";
import { stop } from "./stop.js";
import type { Command } from "./types.js";

export const commands: Command[] = [play, skip, stop, queue];
export const commandsByName = new Map(commands.map((c) => [c.data.name, c]));
