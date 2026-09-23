export interface FocusContext {
  listVersion: unknown;
  layoutVersion: unknown;
  overlayId: string | null;
}

export interface FocusTicket {
  sequence: number;
  id: string;
  context: FocusContext;
}

/** A delayed DOM focus must never outlive a newer input, layout, or overlay. */
export function createFocusTransactions(readContext: () => FocusContext) {
  let sequence = 0;
  return {
    begin(id: string): FocusTicket {
      return { sequence: ++sequence, id, context: { ...readContext() } };
    },
    cancel() { sequence += 1; },
    isCurrent(ticket: FocusTicket): boolean {
      const current = readContext();
      return ticket.sequence === sequence
        && ticket.context.listVersion === current.listVersion
        && ticket.context.layoutVersion === current.layoutVersion
        && ticket.context.overlayId === current.overlayId;
    },
  };
}

/** Prefer the same content, then the nearest surviving neighbour in the old order. */
export function restoreFocusId(previous: readonly string[], next: readonly string[], selected: string | null): string | null {
  if (!next.length) return null;
  const available = new Set(next);
  if (selected && available.has(selected)) return selected;
  const oldIndex = selected ? previous.indexOf(selected) : -1;
  if (oldIndex >= 0) {
    for (let distance = 1; distance < previous.length; distance += 1) {
      const after = previous[oldIndex + distance];
      if (after && available.has(after)) return after;
      const before = previous[oldIndex - distance];
      if (before && available.has(before)) return before;
    }
    return next[Math.min(oldIndex, next.length - 1)];
  }
  return next[0];
}

export function includePinnedRow(range: readonly number[], pinnedIndex: number, rowCount: number): number[] {
  if (pinnedIndex < 0 || pinnedIndex >= rowCount || range.includes(pinnedIndex)) return [...range];
  return [...range, pinnedIndex].sort((a, b) => a - b);
}

export type FocusDirection = "up" | "down" | "left" | "right";

/** Row/column boundaries are handed back to the surrounding navigation scope. */
export function adjacentItemIndex(index: number, count: number, columns: number, direction: FocusDirection): number | null {
  if (index < 0 || index >= count) return null;
  const width = Math.max(1, Math.floor(columns));
  if (direction === "left" && index % width === 0) return null;
  if (direction === "right" && (index + 1) % width === 0) return null;
  const next = index + (direction === "up" ? -width : direction === "down" ? width : direction === "left" ? -1 : 1);
  return next >= 0 && next < count ? next : null;
}
