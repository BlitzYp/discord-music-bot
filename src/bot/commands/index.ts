import { filter } from "./filter.js";
import { library } from "./library.js";
import { loop } from "./loop.js";
import { move } from "./move.js";
import { pause } from "./pause.js";
import { playlist } from "./playlist.js";
import { playnow } from "./playnow.js";
import { play } from "./play.js";
import { queue } from "./queue.js";
import { remove } from "./remove.js";
import { resume } from "./resume.js";
import { seek } from "./seek.js";
import { shuffle } from "./shuffle.js";
import { skip } from "./skip.js";
import { stop } from "./stop.js";
import { volume } from "./volume.js";
import type { Command } from "./types.js";

/** Every slash command. Adding one here is all it takes to register it with Discord on the next start. */
export const commands: Command[] = [
  play, playnow, pause, resume, skip, stop, seek, queue, remove, move, shuffle, loop, volume, filter, playlist, library,
];
export const commandsByName = new Map(commands.map((c) => [c.data.name, c]));
