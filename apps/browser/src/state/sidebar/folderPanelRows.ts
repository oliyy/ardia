import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBrowser } from "../browser/store";
import { tabTitle, viewTabIds } from "../browser/model";
import type { Tab } from "../browser/types";
import { inHiddenRepo, openItems, shownCompleted } from "../live/rows";
import { useLive } from "../live/store";
import type { CompletionState, LiveItem } from "../live/types";
import { displayedSubtree, groupNode, isLiveNode, isTabNode, keyOfNode } from "../pins/pinTree";
import { pinKeyOf } from "../browser/model";
import { sharedTabsForPanel } from "./current";
import { windowHierarchy } from "./entries";
import { byRecentUse, groupTabIds, type GroupPanelTab } from "./groupPanelRows";

export type FolderPanelRow = GroupPanelTab & {
  favicon: string | null;
  icon: string | null;
  profileId: string;
  tabId?: string;
  liveItem?: { folderId: string; item: LiveItem; done: CompletionState | null };
};

const NO_MEMBERS: string[] = [];

export function useFolderPanelRows(groupId: string, windowId: string): FolderPanelRow[] {
  const members = useBrowser(
    useShallow((s) => {
      const group = s.groups[groupId];
      if (!group || group.windowId !== windowId) return NO_MEMBERS;
      const h = windowHierarchy(s, windowId, group.profileId);
      const node = groupNode(pinKeyOf(group));
      if (!group.pinned || !h.tree.parent.has(node)) return groupTabIds(s.groups, groupId).map((id) => `t:${id}`);
      return displayedSubtree(h.tree, node).flatMap((child) => {
        if (isLiveNode(child)) return s.windows[windowId]?.kind === "private" ? [] : [child];
        const id = isTabNode(child) ? h.tabs.get(child) : undefined;
        return id ? [`t:${id}`] : [];
      });
    }),
  );
  const tabs = useBrowser(
    useShallow((s) => {
      const folders = new Set(members.filter(isLiveNode).map(keyOfNode));
      const ids = [
        ...new Set([...members.filter(isTabNode).map(keyOfNode), ...viewTabIds(s, windowId).filter((id) => !s.tabs[id]?.pin && folders.has(s.tabs[id]?.liveItem?.folderId ?? ""))]),
      ];
      return ids.map((id) => s.tabs[id]).filter((t): t is Tab => !!t);
    }),
  );
  const data = useLive(useShallow((s) => ({ folders: s.folders, items: s.items, hidden: s.hidden, completed: s.completed })));
  return useMemo(() => {
    const group = useBrowser.getState().groups[groupId];
    const shared = sharedTabsForPanel(windowId);
    const folderIds = members.filter(isLiveNode).map(keyOfNode);
    const regular = (t: Tab): FolderPanelRow => ({ id: t.id, tabId: t.id, title: tabTitle(t), url: t.url, usedAt: shared?.lastUsed(t) ?? t.lastActiveAt, favicon: t.favicon, icon: t.customIcon, profileId: t.profileId });
    const rows: FolderPanelRow[] = tabs.filter((t) => t.pin || !t.liveItem || !folderIds.includes(t.liveItem.folderId)).map(regular);
    for (const folderId of folderIds) {
      const folder = data.folders[folderId];
      if (!folder || folder.profileId !== group?.profileId) continue;
      const hidden = new Set([...(data.hidden[folderId] ?? []), ...(data.items[folderId] ?? []).filter((item) => inHiddenRepo(folder, item))].map((item) => item.id));
      const done = shownCompleted(folder, data.completed[folderId] ?? []);
      const items = [...openItems(data.items[folderId] ?? [], done).filter((item) => !hidden.has(item.id)), ...done.map((c) => c.item)];
      const doneStates = new Map(done.map((c) => [c.item.id, c.state]));
      const loaded = new Map(tabs.filter((t) => !t.pin && t.liveItem?.folderId === folderId).map((t) => [t.liveItem!.itemId, t]));
      for (const item of items) {
        const tab = loaded.get(item.id);
        const imageIcon = !!item.icon && /^https?:/.test(item.icon);
        rows.push({
          id: `live|${folderId}|${item.id}`,
          tabId: tab?.id,
          title: item.title,
          url: item.url,
          usedAt: tab ? (shared?.lastUsed(tab) ?? tab.lastActiveAt) : item.updatedAt,
          favicon: tab?.favicon ?? (imageIcon ? item.icon : null),
          icon: imageIcon ? null : item.icon,
          profileId: folder.profileId,
          liveItem: { folderId, item, done: doneStates.get(item.id) ?? null },
        });
      }
      const known = new Set(items.map((item) => item.id));
      for (const [id, tab] of loaded) if (!known.has(id) && !hidden.has(id)) rows.push(regular(tab));
    }
    return byRecentUse(rows);
  }, [tabs, members, data, groupId, windowId]);
}
