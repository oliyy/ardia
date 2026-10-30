import type { CompletionState, LiveItem } from "./types";
import type { LiveState } from "./store";

const MAX_KNOWN = 600;
const MAX_COMPLETED = 20;

const sameItem = (a: LiveItem, b: LiveItem) => a === b || JSON.stringify(a) === JSON.stringify(b);

function reuseItems(prev: LiveItem[], next: LiveItem[]): LiveItem[] {
  const byId = new Map(prev.map((it) => [it.id, it]));
  const items = next.map((it) => {
    const old = byId.get(it.id);
    return old && sameItem(old, it) ? old : it;
  });
  return items.length === prev.length && items.every((it, i) => it === prev[i]) ? prev : items;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

export const revised = (s: Pick<LiveState, "revisions">, folderId: string) => ({ ...s.revisions, [folderId]: (s.revisions[folderId] ?? 0) + 1 });

export function fetchedState(s: LiveState, folderId: string, fetched: LiveItem[], gone: Record<string, CompletionState>, now: number, quiet: Set<string>, token: number): Partial<LiveState> {
  if (!s.folders[folderId]) return {};
  const closed = (id: string) => gone[id] === "merged" || gone[id] === "closed";
  const stillHidden = (s.hidden[folderId] ?? []).filter((it) => !closed(it.id));
  const hiddenIds = new Set(stillHidden.map((it) => it.id));
  const next = fetched.filter((it) => !hiddenIds.has(it.id));
  const known = new Set(s.known[folderId] ?? []);
  const first = known.size === 0 && !s.status[folderId]?.lastFetch;
  const fresh = next.filter((it) => !known.has(it.id)).map((it) => it.id);
  const unreadFresh = fresh.filter((id) => !quiet.has(id));
  const ids = new Set(next.map((it) => it.id));
  const prev = s.items[folderId] ?? [];
  const animating = new Set(s.completing[folderId] ?? []);
  const leaving = prev.filter((it) => !ids.has(it.id) && gone[it.id] && !animating.has(it.id));
  const merged = [...next];
  for (const it of prev) if (!ids.has(it.id) && (animating.has(it.id) || leaving.includes(it))) merged.splice(Math.min(prev.indexOf(it), merged.length), 0, it);
  const completed = [
    ...leaving.map((item) => ({ item, state: gone[item.id]!, at: now })),
    ...(s.completed[folderId] ?? []).filter((c) => !ids.has(c.item.id) && !leaving.some((l) => l.id === c.item.id)),
  ].slice(0, MAX_COMPLETED);
  const stillThere = new Set(merged.map((it) => it.id));
  const items = reuseItems(prev, merged);
  const unread = first ? [] : [...new Set([...(s.unread[folderId] ?? []), ...unreadFresh])].filter((id) => stillThere.has(id));
  const completionChanged = leaving.length > 0 || [...animating].some((id) => ids.has(id));
  return {
    items: items === prev && s.items[folderId] ? s.items : { ...s.items, [folderId]: items },
    hidden: stillHidden.length === (s.hidden[folderId] ?? []).length ? s.hidden : { ...s.hidden, [folderId]: stillHidden },
    known: fresh.length || !s.known[folderId] ? { ...s.known, [folderId]: [...known, ...fresh].slice(-MAX_KNOWN) } : s.known,
    unread: s.unread[folderId] && sameIds(unread, s.unread[folderId]) ? s.unread : { ...s.unread, [folderId]: unread },
    completed: leaving.length || (s.completed[folderId] ?? []).length !== completed.length ? { ...s.completed, [folderId]: completed } : s.completed,
    completing: completionChanged ? { ...s.completing, [folderId]: [...[...animating].filter((id) => !ids.has(id)), ...leaving.map((l) => l.id)] } : s.completing,
    completions: completionChanged
      ? { ...s.completions, [folderId]: Object.fromEntries([...Object.entries(s.completions[folderId] ?? {}).filter(([id]) => !ids.has(id)), ...leaving.map((l) => [l.id, token] as const)]) }
      : s.completions,
    status: { ...s.status, [folderId]: { state: "idle", lastFetch: now, error: null } },
    revisions: revised(s, folderId),
  };
}
