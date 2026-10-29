import type { LiveFolder, LiveItem, PullRequestSection } from "./types";

export type FolderRow =
  | { kind: "item"; key: string; item: LiveItem }
  | { kind: "stack"; key: string; id: string; repo: string; items: LiveItem[] }
  | { kind: "header"; key: string; title: string }
  | { kind: "more"; key: string; section: string; count: number };

export const SECTION_TITLES: Record<PullRequestSection, string | null> = {
  authored: null,
  review: "Review Requests",
  team: "Team Review Requests",
};

export const PAGE_SIZE = 8;

export const inHiddenRepo = (folder: Pick<LiveFolder, "hiddenRepos">, item: LiveItem) => !!item.pr && folder.hiddenRepos.includes(item.pr.repo);

export const shownItems = (folder: Pick<LiveFolder, "hiddenRepos">, items: LiveItem[]) => (folder.hiddenRepos.length ? items.filter((it) => !inHiddenRepo(folder, it)) : items);

export const hasShownUnread = (folder: Pick<LiveFolder, "hiddenRepos">, items: LiveItem[], unread: string[] = []) =>
  unread.length > 0 && (!folder.hiddenRepos.length || items.some((it) => unread.includes(it.id) && !inHiddenRepo(folder, it)));

export function folderRepos(folder: Pick<LiveFolder, "hiddenRepos">, items: LiveItem[]): string[] {
  return [...new Set([...items.flatMap((it) => (it.pr ? [it.pr.repo] : [])), ...folder.hiddenRepos])].sort();
}

export type LiveTabPlace = "row" | "stray" | "hidden";

export function liveTabPlace(itemId: string, shown: Set<string>, hidden: Set<string>): LiveTabPlace {
  return shown.has(itemId) ? "row" : hidden.has(itemId) ? "hidden" : "stray";
}

export function folderRows(folder: Pick<LiveFolder, "id" | "kind" | "groupStacks">, items: LiveItem[], showAll: Record<string, boolean>, page = PAGE_SIZE): FolderRow[] {
  const sections: [string, LiveItem[]][] =
    folder.kind === "pullRequests"
      ? (["authored", "review", "team"] as const).map((s) => [s, items.filter((it) => (it.section ?? "authored") === s)])
      : [["documents", items]];
  const rows: FolderRow[] = [];
  for (const [section, members] of sections) {
    if (!members.length) continue;
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
    const all = showAll[`${folder.id}:${section}`];
    rows.push(...(all ? entries : entries.slice(0, page)));
    if (!all && entries.length > page) rows.push({ kind: "more", key: `m:${section}`, section, count: entries.length - page });
  }
  return rows;
}
