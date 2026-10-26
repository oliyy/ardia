import type { BrowserState } from "./browser";
import { isIncognitoProfile, tabLabel } from "./model";
import { cleanedTabsFor } from "./organize";
import type { ClosedGroup, ClosedTab } from "./types";

export type ArchiveSource = "closedTab" | "closedGroup" | "cleaned";

export type ArchivedRow = {
  key: string;
  source: ArchiveSource;
  id: string;
  ids: string[];
  closedAt: number;
  title: string;
  url: string;
  favicon: string | null;
  profileId: string;
  count: number;
};

type ArchiveState = Pick<BrowserState, "windows" | "tabs" | "parkedPins" | "closedTabs" | "closedGroups" | "cleanedTabs" | "privateCleanedTabs">;

const retainedPin = (s: ArchiveState, c: ClosedTab) =>
  !!c.pinnedTile && !!c.tabId && (!!s.tabs[c.tabId] || !!s.parkedPins[c.tab.profileId]?.tabs.some((p) => p.id === c.tabId));

const publicGroup = (g: ClosedGroup) => g.tabs.every((t) => !isIncognitoProfile(t.profileId)) && !(g.tree && isIncognitoProfile(g.tree.profileId));

const tabRow = (source: ArchiveSource, c: ClosedTab, ids: string[]): ArchivedRow => ({
  key: `${source}:${c.id}`,
  source,
  id: c.id,
  ids,
  closedAt: c.closedAt,
  title: c.tab.customTitle || c.tab.title || tabLabel(c.tab),
  url: c.tab.url,
  favicon: c.tab.favicon,
  profileId: c.tab.profileId,
  count: 1,
});

const groupRow = (g: ClosedGroup): ArchivedRow => ({
  key: `closedGroup:${g.id}`,
  source: "closedGroup",
  id: g.id,
  ids: [g.id],
  closedAt: g.closedAt,
  title: g.group.name,
  url: g.tabs[0]?.url ?? "",
  favicon: null,
  profileId: g.tree?.profileId ?? g.tabs[0]?.profileId ?? "",
  count: g.tabs.length || (g.tree?.tabs.length ?? 0),
});

export function archivedEntries(s: ArchiveState, windowId: string): ArchivedRow[] {
  const w = s.windows[windowId];
  if (!w) return [];
  const mine = (c: ClosedTab) => (w.incognito ? isIncognitoProfile(c.tab.profileId) && c.windowId === windowId : !isIncognitoProfile(c.tab.profileId));
  const rows: ArchivedRow[] = [];
  const byTab = new Map<string, ClosedTab[]>();
  for (const c of s.closedTabs) {
    if (!mine(c) || retainedPin(s, c)) continue;
    if (!c.tabId) {
      rows.push(tabRow("closedTab", c, [c.id]));
      continue;
    }
    const same = byTab.get(c.tabId);
    if (same) same.push(c);
    else byTab.set(c.tabId, [c]);
  }
  for (const same of byTab.values()) {
    const newest = same.reduce((a, b) => (b.closedAt >= a.closedAt ? b : a));
    rows.push(tabRow("closedTab", newest, same.map((c) => c.id)));
  }
  if (!w.incognito) for (const g of s.closedGroups) if (publicGroup(g)) rows.push(groupRow(g));
  for (const c of cleanedTabsFor(s, windowId)) if (w.incognito || !isIncognitoProfile(c.tab.profileId)) rows.push(tabRow("cleaned", c, [c.id]));
  return rows.sort((a, b) => b.closedAt - a.closedAt);
}
