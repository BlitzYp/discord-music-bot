import { UserError } from "../../player/errors.js";
import type { PlayerSnapshot, QueueItem } from "../../shared/types.js";

/**
 * Finds the queue item a user means by its number in /queue (1 = next up).
 * PlayerManager works with item ids, so commands that take a position translate it here.
 */
export function itemAtPosition(state: PlayerSnapshot, position: number): QueueItem {
  const item = state.queue[position - 1];
  if (item) return item;
  if (state.queue.length === 0) throw new UserError("The queue is empty.");
  throw new UserError(`There's no #${position}. Pick a number from 1 to ${state.queue.length} (see /queue).`);
}
