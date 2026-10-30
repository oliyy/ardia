import type { CompletedItem, CompletionState, LiveFolder, LiveItem, PullRequestSection } from "./types";
import { showAllKey } from "./store";

export type FolderRow =
  | { kind: "item"; key: string; item: LiveItem; done?: CompletionState }
  | { kind: "stack"; key: string; id: string; repo: string; items: LiveItem[] }
  | { kind: "header"; key: string; title: string }
  | { kind: "more"; key: string; section: string; count: number };

export const SECTION_TITLES: Record<PullRequestSection, string | null> = {
  authored: null,
  review: "Review Requests",
  team: "Team Review Requests",
};

export const PAGE_SIZE = 8;

export const COMPLETED_SHOWN_MS = 10 * 60_000;

export const completedExpired = (c: CompletedItem, now = Date.now()) => now - c.at >= COMPLETED_SHOWN_MS;

export const completedExpiry = (completed: CompletedItem[]) => (completed.length ? Math.min(...completed.map((c) => c.at)) + COMPLETED_SHOWN_MS : null);

export const awaitsReview = (item: LiveItem) => (item.section === "review" || item.section === "team") && !item.tracked;

export const reviewAnswered = (item: LiveItem) => !!item.tracked && (item.section === "team" || (item.section === "review" && !!item.pr?.reviewed));

export const inHiddenRepo = (folder: Pick<LiveFolder, "hiddenRepos">, item: LiveItem) => !!item.pr && folder.hiddenRepos.includes(item.pr.repo);

export const shownItems = (folder: Pick<LiveFolder, "hiddenRepos">, items: LiveItem[]) => (folder.hiddenRepos.length ? items.filter((it) => !inHiddenRepo(folder, it)) : items);

export const hasShownUnread = (folder: Pick<LiveFolder, "hiddenRepos">, items: LiveItem[], unread: string[] = []) =>
  unread.length > 0 && (!folder.hiddenRepos.length || items.some((it) => unread.includes(it.id) && !inHiddenRepo(folder, it)));

export function shownCompleted(folder: Pick<LiveFolder, "showCompleted" | "hiddenRepos">, completed: CompletedItem[], now = Date.now()): CompletedItem[] {
  if (!folder.showCompleted) return [];
  return completed.filter((c) => !completedExpired(c, now) && !inHiddenRepo(folder, c.item));
}

export const openItems = (items: LiveItem[], completed: CompletedItem[]) => (completed.length ? items.filter((it) => !completed.some((c) => c.item.id === it.id)) : items);

export function folderRepos(folder: Pick<LiveFolder, "hiddenRepos">, items: LiveItem[]): string[] {
  return [...new Set([...items.flatMap((it) => (it.pr ? [it.pr.repo] : [])), ...folder.hiddenRepos])].sort();
}

export type LiveTabPlace = "row" | "stray" | "hidden";

export function liveTabPlace(itemId: string, shown: Set<string>, hidden: Set<string>): LiveTabPlace {
  return shown.has(itemId) ? "row" : hidden.has(itemId) ? "hidden" : "stray";
}

export function folderRows(
  folder: Pick<LiveFolder, "id" | "kind" | "groupStacks">,
  items: LiveItem[],
  showAll: Record<string, boolean>,
  completed: CompletedItem[] = [],
  page = PAGE_SIZE,
): FolderRow[] {
  const inSection = (s: string) => (it: LiveItem) => folder.kind !== "pullRequests" || (it.section ?? "authored") === s;
  const sections: [string, LiveItem[], CompletedItem[]][] = (folder.kind === "pullRequests" ? (["authored", "review", "team"] as const) : ["documents"]).map((s) => [
    s,
    items.filter(inSection(s)),
    completed.filter((c) => inSection(s)(c.item)),
  ]);
  const rows: FolderRow[] = [];
  for (const [section, members, done] of sections) {
    if (!members.length && !done.length) continue;
    const title = SECTION_TITLES[section as PullRequestSection];
    if (title) rows.push({ kind: "header", key: `h:${section}`, title });
    const entries: FolderRow[] = [];
    const stacked = new Set<string>();
    for (const it of members) {
      const stack = folder.groupStacks ? it.pr?.stack : undefined;
      if (!stack) {
        entries.push({ kind: "item", key: it.id, item: it });
        continue;
      }
      if (stacked.has(stack.id)) continue;
      stacked.add(stack.id);
      const inStack = members.filter((m) => m.pr?.stack?.id === stack.id).sort((a, b) => a.pr!.stack!.position - b.pr!.stack!.position);
      entries.push({ kind: "stack", key: stack.id, id: stack.id, repo: it.pr!.repo, items: inStack });
    }
    for (const c of done) entries.push({ kind: "item", key: c.item.id, item: c.item, done: c.state });
    const all = showAll[showAllKey(folder.id, section)];
    rows.push(...(all ? entries : entries.slice(0, page)));
    if (!all && entries.length > page) rows.push({ kind: "more", key: `m:${section}`, section, count: entries.length - page });
  }
  return rows;
}
