import { type DragEvent, useState } from "react";

/**
 * Drag-and-drop reordering for a list (the queue, a playlist's songs), using the browser's built-in drag and drop.
 *
 * Spread `rowProps(item, index)` on each row. While a row is dragged, the row under the pointer gets the class
 * `drop-before` or `drop-after` (a line showing where it will land). On drop, `onMove(item, position)` is called
 * with the new 1-based position, the same number the ↑↓ buttons send. Nothing moves on the page until the bot's
 * update arrives, as with every other control.
 *
 * Phones mostly don't support this kind of dragging, which is why the ↑↓ buttons stay.
 */
export function useDragReorder<T extends { id: string | number }>(
  items: T[],
  onMove: (item: T, toPosition: number) => void,
  { enabled }: { enabled: boolean },
) {
  /** The row being dragged. */
  const [draggedId, setDraggedId] = useState<T["id"] | null>(null);
  /** Where it would land: 0 = before the first row, items.length = after the last one. */
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  function reset() {
    setDraggedId(null);
    setDropIndex(null);
  }

  function drop() {
    const from = items.findIndex((item) => item.id === draggedId);
    if (from === -1 || dropIndex === null) return reset();
    // Taking the row out first shifts everything after it up by one.
    const to = dropIndex > from ? dropIndex - 1 : dropIndex;
    if (to !== from) onMove(items[from]!, to + 1);
    reset();
  }

  function rowProps(item: T, index: number) {
    if (!enabled) return {};

    const classes = [];
    if (item.id === draggedId) classes.push("dragging");
    if (draggedId !== null && dropIndex === index) classes.push("drop-before");
    if (draggedId !== null && dropIndex === items.length && index === items.length - 1) classes.push("drop-after");

    return {
      draggable: true,
      className: classes.join(" "),
      onDragStart: (event: DragEvent) => {
        setDraggedId(item.id);
        event.dataTransfer.effectAllowed = "move";
        // Firefox only starts a drag if some data is set.
        event.dataTransfer.setData("text/plain", String(item.id));
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (draggedId === null) return; // something else is being dragged over the page, e.g. a link
        event.preventDefault(); // allows dropping here
        // The top half of a row means "before it", the bottom half "after it".
        const rect = event.currentTarget.getBoundingClientRect();
        const inBottomHalf = event.clientY > rect.top + rect.height / 2;
        setDropIndex(inBottomHalf ? index + 1 : index);
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        drop();
      },
      onDragEnd: reset, // dropped outside the list, or cancelled with Esc
    };
  }

  return { rowProps };
}
