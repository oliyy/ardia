import type { BrowserState } from "../browser/store";
import { live } from "../live/store";
import { liveNode } from "../pins/pinTree";
import { liveAsOf, retainedLiveHeights, type LiveHeights } from "./pinnedTree";

export type LiveData = ReturnType<typeof live>;
export type ReorderIntent = { windowId: string; profileId: string; key: string };
export type ListSnapshot = { state: BrowserState; list: string[]; live: LiveData; heights: LiveHeights; intent?: ReorderIntent };
export type Capture = { state: BrowserState | null; list: string[] | null; live: LiveData | null; pending: ListSnapshot | null };

export const newCapture = (): Capture => ({ state: null, list: null, live: null, pending: null });

const placedAnywhere = (s: BrowserState, folderId: string) => Object.values(s.pinPlace).some((table) => !!table[liveNode(folderId)]);

let reorderIntent: ReorderIntent | null = null;

export function withReorderIntent<T>(intent: ReorderIntent, apply: () => T): T {
  reorderIntent = intent;
  try {
    return apply();
  } finally {
    reorderIntent = null;
  }
}

export function reordered(before: string[], after: string[], key: string): boolean {
  if (before.length !== after.length || !after.includes(key)) return false;
  const had = new Set(before);
  return after.every((e) => had.has(e)) && after.some((e, i) => e !== before[i]);
}

export const movedBy = (before: ListSnapshot, after: ListSnapshot, windowId: string, profileId: string): string | null => {
  const intent = before.intent;
  return intent && intent.windowId === windowId && intent.profileId === profileId && reordered(before.list, after.list, intent.key) ? intent.key : null;
};

export function capture<T>(into: Capture, s: BrowserState, list: string[], value: T): T {
  if (into.list && into.state && into.live && list !== into.list && !into.pending) {
    const intent = reorderIntent && reordered(into.list, list, reorderIntent.key) ? reorderIntent : null;
    into.pending = { state: into.state, list: into.list, live: liveAsOf(into.live), heights: retainedLiveHeights(), ...(intent ? { intent } : {}) };
  }
  const current = live();
  const lost = into.live && list === into.list ? Object.keys(into.live.folders).filter((id) => !current.folders[id]) : [];
  const awaiting = lost.length > 0 && (s === into.state || lost.some((id) => placedAnywhere(s, id)));
  into.list = list;
  into.state = s;
  if (!awaiting) into.live = current;
  return value;
}
