import type { ContentKind } from "./types";
export type HandheldTab = "continue" | "library" | "discover" | "mine";
export interface SessionSnapshot {
  tab: HandheldTab;
  kind: ContentKind | "all";
  filter: "all" | "favorites" | "local";
  sort: "recent" | "title";
  selectedId: string | null;
  scrollOffset: number;
  focusKey: string | null;
  query: string;
  albumId: string | null;
  albumMemberId: string | null;
  libraryView: "all" | "albums";
}
function empty(tab: HandheldTab): SessionSnapshot { return { tab, kind: "all", filter: "all", sort: "recent", selectedId: null, scrollOffset: 0, focusKey: null, query: "", albumId: null, albumMemberId: null, libraryView: "albums" }; }
let active = $state<HandheldTab>("continue");
let snapshots = $state<Record<HandheldTab, SessionSnapshot>>({ continue: empty("continue"), library: empty("library"), discover: { ...empty("discover"), kind: "anime" }, mine: empty("mine") });
export const handheldSession = {
  get tab() { return active; },
  get current() { return snapshots[active]; },
  select(tab: HandheldTab) { active = tab; },
  patch(patch: Partial<Omit<SessionSnapshot, "tab">>) { snapshots[active] = { ...snapshots[active], ...patch }; },
};
